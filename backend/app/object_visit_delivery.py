"""The Objektbesuche delivery outbox — files each visit, one way, into a SharePoint destination.

docs/object-visits.md «Delivery» is the contract; this is the worker. One scheduler job ticks
every 30 s on the scheduler leader (``scheduler._object_visit_delivery_tick``) and is registered
unconditionally: it no-ops while no destination is enabled or the ``sharepoint_export``
credentials are incomplete, which an admin can change from the browser at any time.

A tick:

1. **Housekeeping** — rows of a destination that is disabled or gone are PAUSED (kept), rows of
   one that is back resume; a ``failed`` row whose destination config or credentials changed
   since it failed goes back to ``pending`` (one of the three ways out of ``failed``; the other
   two are «Erneut versuchen» and a new credential, which is the same fingerprint change).
2. **Claim** — one due ``pending`` row, ``FOR UPDATE SKIP LOCKED`` and a 5-minute lease (the
   plan-alignment pattern, ``plan_alignment_worker.claim_job``), committed at once.
3. **Read** — the revisions ``delivered+1 … wanted``, their reports rendered, the photos read.
4. **Write remotely** (no database transaction open): for each eligible revision, in order,
   ``Verlauf/r{n} {YYYY-MM-DD HHmm}.pdf`` + ``.json``; then — after checking that the remote
   ``Objektbesuch.json`` does not already carry a HIGHER revision (a newer worker won: stop) —
   ``Objektbesuch.pdf`` and ``Objektbesuch.json`` (the latter with ``If-Match``); then every photo
   not yet in ``remote_items`` into ``Fotos/``; photos no longer in the document move to
   ``Entfernt/``. Nothing remote is ever deleted.
5. **Finish** — ``delivered_revision`` advances by compare-and-swap on the lease token, in a
   transaction that locks the visit first and bumps the feed counter last (the lock order every
   writer of these tables keeps).

Failures: 401/403/404 → ``failed`` (actionable). 409/412/429/5xx/network → backoff 1 min · 5 min
· 15 min · 1 h · 6 h, still ``pending``.
"""

from __future__ import annotations

import json
import logging
import uuid
from collections.abc import Callable
from dataclasses import dataclass, field
from datetime import UTC, datetime, timedelta
from typing import Any

import httpx
from sqlalchemy import and_, or_, select, update
from sqlalchemy.ext.asyncio import AsyncSession

from . import object_visits as ov
from . import storage
from .credentials import load as load_credentials
from .database import async_session_maker
from .models import (
    ObjectSite,
    ObjectVisit,
    ObjectVisitDelivery,
    ObjectVisitDeliveryLog,
    ObjectVisitRevision,
)
from .object_visit_report import local_time
from .object_visit_sharepoint import (
    GraphPreconditionError,
    GraphWriter,
    backoff,
    expand,
    export_credentials,
    fingerprint,
    join_path,
    sanitize_segment,
)
from .object_visit_sharepoint import export_writer as _writer
from .object_visit_sharepoint import short_error as _short
from .schemas import ObjectVisitDestination, ObjectVisitsConfig
from .sharepoint_graph import GraphAuthError, GraphError

logger = logging.getLogger("kpfront.objectvisits")

TICK_SECONDS = 30
LEASE = timedelta(minutes=5)
#: Rows a tick works through at most — a backlog drains steadily, a tick stays bounded.
BATCH = 10

CURRENT_PDF = "Objektbesuch.pdf"
CURRENT_JSON = "Objektbesuch.json"

SessionFactory = Callable[[], Any]


class SupersededError(Exception):
    """The remote already holds a newer revision than this pass — this pass stops."""

    def __init__(self, remote: int, local: int) -> None:
        super().__init__(f"remote Objektbesuch.json is r{remote}, this pass holds r{local}")
        self.remote = remote
        self.local = local


@dataclass
class Claim:
    id: uuid.UUID
    destination: str
    visit_id: str
    wanted: int
    delivered: int
    token: str
    attempts: int
    remote_items: dict[str, Any] = field(default_factory=dict)
    remote_folder_id: str | None = None


# --- helpers ---------------------------------------------------------------------------------


def is_actionable(error: Exception) -> bool:
    """401/403/404, a refused token and a report that cannot be rendered need a person;
    everything else is weather."""
    if isinstance(error, (GraphAuthError, RenderError)):
        return True
    return isinstance(error, GraphError) and error.status == 404


def placeholders(visit_id: str, doc: dict[str, Any], obj: ObjectSite | None) -> dict[str, str]:
    snapshot = doc.get("object") or {}
    place = ov.doc_target(doc)
    name = (obj.name if obj else None) or snapshot.get("name") or ""
    address = (obj.address if obj else None) or snapshot.get("address") or ""
    if obj is not None:
        folder = ov.object_folder(obj)
    else:
        folder = snapshot.get("folder") or (f"{address} - {name}" if address and name else name or visit_id)
    visited = local_time(doc.get("visitedAt"))
    checklist = doc.get("checklist") if isinstance(doc.get("checklist"), dict) else None
    return {
        "object.folder": str(folder),
        "object.name": str(name),
        "object.address": str(address),
        "date": visited.strftime("%Y-%m-%d") if visited else "ohne-datum",
        "checklist": str((checklist or {}).get("title") or "Besuch"),
        "short": visit_id[-4:],
        "location.label": str(place.get("label") or "") if place["kind"] == "location" else str(name),
        "location.address": str(place.get("address") or "") if place["kind"] == "location" else str(address),
    }


def folder_segments(dest: ObjectVisitDestination, values: dict[str, str], *, at_location: bool) -> list[str]:
    """The visit's folder below ``root``: objectFolder + visitFolder for a visit at an object, the
    one general ``locationFolder`` (no object folder, no year) for a visit at a place."""
    if at_location:
        return expand(dest.locationFolder, values)
    return expand(dest.objectFolder, values) + expand(dest.visitFolder, values)


def photo_name(n: int, photo: dict[str, Any], content_type: str) -> str:
    caption = photo.get("caption") or "Foto"
    stem = sanitize_segment(f"{n:02d} {caption}")[:80].rstrip(" .")
    ext = ov.PHOTO_TYPES.get(content_type, ".jpg")
    return sanitize_segment(f"{stem} ({photo['id'][-4:]}){ext}")


def revision_json(visit_id: str, row: ObjectVisitRevision) -> bytes:
    payload = {
        **row.doc,
        "revision": row.revision,
        "ready": row.ready,
        "acceptedAt": row.accepted_at.isoformat() if row.accepted_at else None,
        "acceptedBy": {"id": str(row.accepted_by) if row.accepted_by else None, "name": row.accepted_by_name},
        "url": ov.visit_url(visit_id),
    }
    return json.dumps(payload, ensure_ascii=False, indent=2).encode("utf-8")


async def _log(db: AsyncSession, delivery_id: uuid.UUID, event: str, revision: int | None, detail: str | None) -> None:
    db.add(
        ObjectVisitDeliveryLog(
            id=uuid.uuid4(), delivery_id=delivery_id, event=event, revision=revision, detail=(detail or None)
        )
    )


# --- housekeeping + claim ------------------------------------------------------------------------


async def housekeeping(db: AsyncSession, cfg: ObjectVisitsConfig, now: datetime) -> int:
    """Pause, resume and un-fail rows to match the config. Returns how many rows moved.

    ⚠️ Lock order (module docstring of object_visits): every visit this touches is locked FIRST,
    in sorted id order, then its delivery rows are re-read and changed, and the feed counter is
    bumped ONCE at the end — a PUT holding one visit and waiting for the counter can then never
    be waiting on a lock this transaction holds while it waits on that PUT's visit.
    """
    by_id = {d.id: d for d in cfg.destinations}
    enabled = {d.id for d in cfg.destinations if d.enabled} if cfg.enabled else set()

    def decide(row: ObjectVisitDelivery) -> tuple[str, str] | None:
        if row.destination not in enabled and row.state in ("pending", "failed"):
            return "paused", "paused"
        if row.destination in enabled and row.state == "paused":
            return ("pending" if row.wanted_revision > row.delivered_revision else "delivered"), "resumed"
        if (
            row.destination in enabled
            and row.state == "failed"
            and row.failed_fingerprint != fingerprint(by_id.get(row.destination))
        ):
            return "pending", "resumed"
        return None

    candidates = (
        (
            await db.execute(
                select(ObjectVisitDelivery).where(ObjectVisitDelivery.state.in_(("pending", "failed", "paused")))
            )
        )
        .scalars()
        .all()
    )
    visit_ids = sorted({row.visit_id for row in candidates if decide(row) is not None})
    if not visit_ids:
        return 0
    visits = [v for v in [await ov.lock_visit(db, vid) for vid in visit_ids] if v is not None]
    rows = (
        (
            await db.execute(
                select(ObjectVisitDelivery)
                .where(ObjectVisitDelivery.visit_id.in_(visit_ids))
                .execution_options(populate_existing=True)
            )
        )
        .scalars()
        .all()
    )
    moved = 0
    touched: set[str] = set()
    for row in rows:
        decision = decide(row)
        if decision is None:
            continue
        new_state, event = decision
        row.state = new_state
        row.updated_at = now
        if new_state == "pending":
            row.attempts = 0
            row.next_attempt_at = now
            row.failed_fingerprint = None
        await _log(db, row.id, event, None, "Ziel ausgeschaltet oder entfernt" if event == "paused" else None)
        touched.add(row.visit_id)
        moved += 1
    await ov.bump_seq_many(db, [v for v in visits if v.id in touched])
    await db.flush()
    return moved


async def claim(db: AsyncSession, enabled: set[str], now: datetime) -> Claim | None:
    """Lease one due row (compare-and-swap, SKIP LOCKED). The caller commits."""
    if not enabled:
        return None
    due = and_(
        ObjectVisitDelivery.state == "pending",
        ObjectVisitDelivery.destination.in_(sorted(enabled)),
        or_(ObjectVisitDelivery.next_attempt_at.is_(None), ObjectVisitDelivery.next_attempt_at <= now),
        or_(ObjectVisitDelivery.lease_until.is_(None), ObjectVisitDelivery.lease_until < now),
    )
    candidate = (
        select(ObjectVisitDelivery.id)
        .where(due)
        .order_by(ObjectVisitDelivery.next_attempt_at, ObjectVisitDelivery.created_at)
        .limit(1)
        .with_for_update(skip_locked=True)
        .scalar_subquery()
    )
    lease_id = uuid.uuid4().hex
    row = (
        await db.execute(
            update(ObjectVisitDelivery)
            .where(ObjectVisitDelivery.id == candidate, due)
            .values(lease_owner=lease_id, lease_until=now + LEASE, attempts=ObjectVisitDelivery.attempts + 1)
            .returning(
                ObjectVisitDelivery.id,
                ObjectVisitDelivery.destination,
                ObjectVisitDelivery.visit_id,
                ObjectVisitDelivery.wanted_revision,
                ObjectVisitDelivery.delivered_revision,
                ObjectVisitDelivery.attempts,
                ObjectVisitDelivery.remote_items,
                ObjectVisitDelivery.remote_folder_id,
            )
        )
    ).one_or_none()
    if row is None:
        return None
    await _log(db, row.id, "claimed", row.wanted_revision, None)
    return Claim(
        id=row.id,
        destination=row.destination,
        visit_id=row.visit_id,
        wanted=row.wanted_revision,
        delivered=row.delivered_revision,
        token=lease_id,
        attempts=row.attempts,
        remote_items=dict(row.remote_items or {}),
        remote_folder_id=row.remote_folder_id,
    )


# --- the work ----------------------------------------------------------------------------------


class RenderError(Exception):
    """A report could not be rendered. Actionable (`failed`): retrying renders the same bytes."""


class NothingOwedError(Exception):
    """No eligible revision between ``delivered`` and ``wanted`` — e.g. the destination was
    switched from every-sync to completed while drafts were queued. Nothing to do, no error."""


@dataclass
class Plan:
    """What one pass will file — revision NUMBERS and storage keys, never bytes: each report is
    rendered and each photo read right before its upload, one at a time."""

    placeholders: dict[str, str]
    #: a visit at a place (no object): filed under the destination's ``locationFolder``
    at_location: bool
    #: eligible revisions delivered+1 … wanted, in order (empty on a heal pass)
    history: list[int]
    current: int
    #: the current document's photos, in order: (n, photo entry)
    listed: list[tuple[int, dict[str, Any]]]
    #: att id → (storage key, content type) for stored photos not yet filed
    pending_photos: dict[str, tuple[str, str]]


async def plan(db: AsyncSession, c: Claim, dest: ObjectVisitDestination) -> Plan:
    visit = await db.get(ObjectVisit, c.visit_id)
    if visit is None:
        raise GraphError("visit vanished", status=404)
    rows = (
        await db.execute(
            select(ObjectVisitRevision.revision, ObjectVisitRevision.lifecycle, ObjectVisitRevision.ready)
            .where(ObjectVisitRevision.visit_id == c.visit_id, ObjectVisitRevision.revision <= c.wanted)
            .order_by(ObjectVisitRevision.revision)
        )
    ).all()
    # «Filed before» (the condition a discarded revision needs under `completed` timing) is true
    # once this destination holds the visit — from an earlier run, or from an earlier revision of
    # this same run.
    filed = c.delivered > 0
    eligible: list[int] = []
    for r in rows:
        if ov.eligible(dest.timing, r.lifecycle, r.ready, filed):
            eligible.append(r.revision)
            filed = filed or r.lifecycle != "discarded"
    history = [n for n in eligible if n > c.delivered]
    if history:
        current = history[-1]
    elif c.wanted <= c.delivered and eligible:
        current = eligible[-1]  # a heal pass: rewrite the current files at what is delivered
    else:
        raise NothingOwedError(f"no eligible revision in r{c.delivered + 1}…r{c.wanted}")
    row = await ov.revision_row(db, c.visit_id, current)
    stored = await ov.stored_attachments(db, c.visit_id)
    listed = [
        (n, ph)
        for n, ph in enumerate(row.doc.get("photos") or [], start=1)
        if isinstance(ph, dict) and isinstance(ph.get("id"), str)
    ]
    pending_photos = {
        ph["id"]: (stored[ph["id"]].storage_key, stored[ph["id"]].content_type)
        for _, ph in listed
        if ph["id"] in stored and ph["id"] not in c.remote_items
    }
    obj = await db.get(ObjectSite, visit.object_id) if visit.object_id else None
    return Plan(
        placeholders=placeholders(c.visit_id, row.doc, obj),
        at_location=ov.doc_target(row.doc)["kind"] == "location",
        history=history,
        current=current,
        listed=listed,
        pending_photos=pending_photos,
    )


async def render_revision(
    factory: SessionFactory, visit_id: str, revision: int, cache: dict[str, bytes | None]
) -> tuple[bytes, bytes]:
    """(report PDF, revision JSON) of one revision, in a session of its own. ``cache`` holds this
    pass's DOWNSCALED photos, so the n-th history report does not decode every original again."""
    try:
        async with factory() as db:
            visit = await db.get(ObjectVisit, visit_id)
            if visit is None:
                raise GraphError("visit vanished", status=404)
            row = await ov.revision_row(db, visit_id, revision)
            pdf = await ov.render_report(db, visit, revision, cache=cache)
            return pdf, revision_json(visit_id, row)
    except GraphError:
        raise
    except Exception as e:
        raise RenderError(f"Bericht r{revision} konnte nicht erstellt werden: {_short(e)}") from e


async def write_remote(
    writer: GraphWriter,
    dest: ObjectVisitDestination,
    c: Claim,
    p: Plan,
    factory: SessionFactory,
) -> None:
    """Steps 4a–4d of the module docstring. Mutates ``c.remote_items`` as it goes, so progress
    survives a failure half way through (the caller persists it either way). Holds at most one
    report and one photo in memory at a time."""
    drive = await writer.resolve_drive(site_url=dest.siteUrl, drive_id=None, library=dest.library)
    base = dest.root
    visit_path = c.remote_items.get("_path")
    if not isinstance(visit_path, str) or not visit_path:
        segments = folder_segments(dest, p.placeholders, at_location=p.at_location)
        folder_id = await writer.ensure_folder(drive, base, segments)
        visit_path = join_path(base, *segments)
        c.remote_items["_path"] = visit_path
        c.remote_items["_folder"] = folder_id
        c.remote_folder_id = folder_id
    else:
        c.remote_folder_id = await writer.ensure_folder(drive, visit_path, [])

    cache: dict[str, bytes | None] = {}
    current_pdf: bytes | None = None
    current_json: bytes | None = None
    if p.history:
        await writer.ensure_folder(drive, visit_path, ["Verlauf"])
    for n in p.history:
        pdf, data = await render_revision(factory, c.visit_id, n, cache)
        async with factory() as db:
            accepted = (await ov.revision_row(db, c.visit_id, n)).accepted_at
        stamp = local_time(accepted)
        name = f"r{n} {stamp.strftime('%Y-%m-%d %H%M') if stamp else ''}".strip()
        await writer.upload(drive, join_path(visit_path, "Verlauf", f"{name}.pdf"), pdf, "application/pdf")
        await writer.upload(drive, join_path(visit_path, "Verlauf", f"{name}.json"), data, "application/json")
        current_pdf, current_json = (pdf, data) if n == p.current else (None, None)
    if current_pdf is None or current_json is None:
        current_pdf, current_json = await render_revision(factory, c.visit_id, p.current, cache)
    cache.clear()

    # The fence: a remote current file of a HIGHER revision means a newer worker already won —
    # or the remote is ahead of this server altogether (finish_superseded tells the two apart).
    json_path = join_path(visit_path, CURRENT_JSON)
    remote, etag = await writer.read_json(drive, json_path)
    remote_rev = remote.get("revision") if isinstance(remote, dict) else None
    if isinstance(remote_rev, int) and remote_rev > p.current:
        raise SupersededError(remote_rev, p.current)
    await writer.upload(drive, join_path(visit_path, CURRENT_PDF), current_pdf, "application/pdf")
    await writer.upload(drive, json_path, current_json, "application/json", if_match=etag or None)
    del current_pdf, current_json

    if p.pending_photos:
        await writer.ensure_folder(drive, visit_path, ["Fotos"])
    for n, photo in p.listed:
        pid = photo["id"]
        if pid in c.remote_items or pid not in p.pending_photos:
            continue
        key, ctype = p.pending_photos[pid]
        data = await storage.aget_bytes(key)
        item = await writer.upload(drive, join_path(visit_path, "Fotos", photo_name(n, photo, ctype)), data, ctype)
        del data
        c.remote_items[pid] = str(item["id"])

    current_ids = {ph["id"] for _, ph in p.listed}
    gone = [k for k in list(c.remote_items) if not k.startswith("_") and k not in current_ids]
    if gone:
        removed_folder = await writer.ensure_folder(drive, visit_path, ["Entfernt"])
        removed: dict[str, Any] = dict(c.remote_items.get("_removed") or {})
        for pid in gone:
            item_id = str(c.remote_items[pid])
            try:
                # conflictBehavior=rename: an «Entfernt/» that already holds this name (a photo
                # removed, re-added and removed again) gets «… 1.jpg», never a silent no-op.
                await writer.move(drive, item_id, removed_folder)
            except GraphError as e:
                if e.status != 404:
                    raise
                # 404: somebody removed it by hand already — nothing left to move
            removed[pid] = item_id
            del c.remote_items[pid]
        c.remote_items["_removed"] = removed


# --- finishing ---------------------------------------------------------------------------------


async def finish_ok(db: AsyncSession, c: Claim, delivered: int, now: datetime) -> bool:
    """CAS: only the lease holder, only from the revision it claimed, only forward."""
    visit = await ov.lock_visit(db, c.visit_id)
    row = (
        await db.execute(
            update(ObjectVisitDelivery)
            .where(
                ObjectVisitDelivery.id == c.id,
                ObjectVisitDelivery.lease_owner == c.token,
                ObjectVisitDelivery.delivered_revision == c.delivered,
            )
            .values(
                delivered_revision=max(c.delivered, delivered),
                lease_owner=None,
                lease_until=None,
                attempts=0,
                last_error=None,
                failed_fingerprint=None,
                remote_items=c.remote_items,
                remote_folder_id=c.remote_folder_id,
                updated_at=now,
            )
            .returning(ObjectVisitDelivery.wanted_revision)
        )
    ).one_or_none()
    if row is None:
        return False
    more = row.wanted_revision > max(c.delivered, delivered)
    await db.execute(
        update(ObjectVisitDelivery)
        .where(ObjectVisitDelivery.id == c.id)
        .values(state="pending" if more else "delivered", next_attempt_at=now if more else None)
    )
    await _log(db, c.id, "delivered", delivered, None)
    if visit is not None:
        await ov.bump_seq(db, visit)
    return True


async def finish_idle(db: AsyncSession, c: Claim, reason: str, now: datetime) -> None:
    """Nothing eligible was owed: the row rests at what it delivered, without an error. A row a
    newer revision raised meanwhile stays pending."""
    visit = await ov.lock_visit(db, c.visit_id)
    result = await db.execute(
        update(ObjectVisitDelivery)
        .where(
            ObjectVisitDelivery.id == c.id,
            ObjectVisitDelivery.lease_owner == c.token,
            ObjectVisitDelivery.wanted_revision == c.wanted,
        )
        .values(
            state="delivered",
            wanted_revision=c.delivered,
            lease_owner=None,
            lease_until=None,
            attempts=0,
            last_error=None,
            next_attempt_at=None,
            updated_at=now,
        )
        .returning(ObjectVisitDelivery.id)
    )
    if result.one_or_none() is None:
        await db.execute(
            update(ObjectVisitDelivery)
            .where(ObjectVisitDelivery.id == c.id, ObjectVisitDelivery.lease_owner == c.token)
            .values(lease_owner=None, lease_until=None, next_attempt_at=now, updated_at=now)
        )
        return
    await _log(db, c.id, "idle", c.delivered, reason[:400])
    if visit is not None:
        await ov.bump_seq(db, visit)


async def finish_error(
    db: AsyncSession, c: Claim, error: Exception, dest: ObjectVisitDestination, now: datetime
) -> None:
    visit = await ov.lock_visit(db, c.visit_id)
    actionable = is_actionable(error)
    values: dict[str, Any] = {
        "lease_owner": None,
        "lease_until": None,
        "last_error": _short(error),
        "remote_items": c.remote_items,
        "remote_folder_id": c.remote_folder_id,
        "updated_at": now,
    }
    if actionable:
        values.update(state="failed", failed_fingerprint=fingerprint(dest), next_attempt_at=None)
    else:
        values.update(next_attempt_at=now + backoff(c.attempts))
    result = await db.execute(
        update(ObjectVisitDelivery)
        .where(ObjectVisitDelivery.id == c.id, ObjectVisitDelivery.lease_owner == c.token)
        .values(**values)
        .returning(ObjectVisitDelivery.id)
    )
    if result.one_or_none() is None:
        return
    await _log(db, c.id, "failed" if actionable else "retry", c.wanted, _short(error))
    if visit is not None:
        await ov.bump_seq(db, visit)


async def finish_superseded(
    db: AsyncSession,
    c: Claim,
    dest: ObjectVisitDestination,
    now: datetime,
    *,
    remote_rev: int | None,
    local_rev: int | None,
) -> str:
    """The remote current files are not what this pass expected. Two very different causes:

    * this worker LOST A RACE — its lease expired and another pass already moved the row on.
      Then, because our current-file write may have landed after theirs, the row is asked for
      ONE more pass over the current files (pending, after the first backoff step): «superseded».
    * nobody else touched the row — the remote simply holds a NEWER revision than this server
      (a restored database, a second deployment writing the same folder). Retrying can never
      fix that: «failed», with a sentence an admin can act on. (A 412 without a known remote
      revision is weather: backoff.)

    Either way the folder path learned on the way is kept, and the feed hears about it.
    """
    visit = await ov.lock_visit(db, c.visit_id)
    row = (
        await db.execute(
            select(ObjectVisitDelivery).where(ObjectVisitDelivery.id == c.id).execution_options(populate_existing=True)
        )
    ).scalar_one_or_none()
    if row is None:
        return "superseded"
    items = dict(row.remote_items or {})
    if "_path" not in items and "_path" in c.remote_items:
        items["_path"] = c.remote_items["_path"]
        items["_folder"] = c.remote_items.get("_folder")
        row.remote_items = items
        row.remote_folder_id = row.remote_folder_id or c.remote_folder_id
    row.updated_at = now
    outcome = "superseded"
    if row.lease_owner == c.token and row.delivered_revision == c.delivered:
        row.lease_owner = None
        row.lease_until = None
        if remote_rev is not None:
            row.state = "failed"
            row.failed_fingerprint = fingerprint(dest)
            row.next_attempt_at = None
            row.last_error = f"Ablage hat neuere Revision r{remote_rev} als der Server (r{local_rev}) – prüfen"
            outcome = "failed"
        else:
            row.next_attempt_at = now + backoff(c.attempts)
            row.last_error = "Objektbesuch.json wurde während der Ablage geändert"
            outcome = "retry"
        await _log(db, c.id, outcome, c.wanted, row.last_error)
    else:
        if row.state == "delivered":
            row.state = "pending"
            row.next_attempt_at = now + backoff(1)
        await _log(db, c.id, "superseded", c.wanted, f"remote r{remote_rev}, this pass r{local_rev}")
    if visit is not None:
        await ov.bump_seq(db, visit)
    await db.flush()
    return outcome


# --- one claimed row, end to end -----------------------------------------------------------------


async def deliver(
    factory: SessionFactory,
    c: Claim,
    dest: ObjectVisitDestination,
    *,
    transport: httpx.AsyncBaseTransport | None = None,
    now: Callable[[], datetime] = lambda: datetime.now(UTC),
) -> str:
    """Work one claim to its end. Returns ``delivered`` | ``idle`` | ``lost_lease`` |
    ``superseded`` | ``failed`` | ``retry``."""
    try:
        async with factory() as db:
            p = await plan(db, c, dest)
        async with httpx.AsyncClient(transport=transport, timeout=60.0) as client:
            await write_remote(_writer(client), dest, c, p, factory)
    except NothingOwedError as e:
        async with factory() as db:
            await finish_idle(db, c, str(e), now())
            await db.commit()
        return "idle"
    except SupersededError as s:
        logger.info("object visit %s → %s: %s", c.visit_id, c.destination, s)
        async with factory() as db:
            outcome = await finish_superseded(db, c, dest, now(), remote_rev=s.remote, local_rev=s.local)
            await db.commit()
        return outcome
    except GraphPreconditionError as e:
        logger.info("object visit %s → %s: Objektbesuch.json changed under us (%s)", c.visit_id, c.destination, e)
        async with factory() as db:
            outcome = await finish_superseded(db, c, dest, now(), remote_rev=None, local_rev=None)
            await db.commit()
        return outcome
    except Exception as e:
        if not isinstance(e, (GraphError, RenderError)):
            logger.exception("object visit %s → %s: delivery crashed", c.visit_id, c.destination)
        else:
            logger.warning("object visit %s → %s: %s", c.visit_id, c.destination, _short(e))
        async with factory() as db:
            await finish_error(db, c, e, dest, now())
            await db.commit()
        return "failed" if is_actionable(e) else "retry"
    async with factory() as db:
        ok = await finish_ok(db, c, p.current, now())
        await db.commit()
    if ok:
        logger.info("object visit %s r%d filed to %s", c.visit_id, p.current, c.destination)
    return "delivered" if ok else "lost_lease"


async def run_once(
    factory: SessionFactory | None = None,
    *,
    transport: httpx.AsyncBaseTransport | None = None,
    now: Callable[[], datetime] = lambda: datetime.now(UTC),
) -> str | None:
    """Housekeeping + at most one claimed row. None when there was nothing to do."""
    factory = factory or async_session_maker
    async with factory() as db:
        await load_credentials(db)
        cfg = await ov.ov_config(db)
        await housekeeping(db, cfg, now())
        await db.commit()
        if not cfg.enabled or export_credentials() is None:
            return None
        enabled = {d.id for d in cfg.destinations if d.enabled}
        c = await claim(db, enabled, now())
        await db.commit()
    if c is None:
        return None
    dest = next(d for d in cfg.destinations if d.id == c.destination)
    return await deliver(factory, c, dest, transport=transport, now=now)


async def tick(factory: SessionFactory | None = None, *, transport: httpx.AsyncBaseTransport | None = None) -> int:
    done = 0
    for _ in range(BATCH):
        if await run_once(factory, transport=transport) is None:
            break
        done += 1
    return done


async def test_destination(
    dest: ObjectVisitDestination, *, transport: httpx.AsyncBaseTransport | None = None
) -> dict[str, Any]:
    """«Verbindung testen»: one small file into the destination root, and Graph's answer."""
    body = (
        "KP Front – Testdatei der Objektbesuche-Ablage.\n"
        f"Ziel: {dest.id} · {datetime.now(UTC).isoformat()}\n"
        "Diese Datei darf gelöscht werden.\n"
    ).encode()
    try:
        async with httpx.AsyncClient(transport=transport, timeout=30.0) as client:
            writer = _writer(client)
            drive = await writer.resolve_drive(site_url=dest.siteUrl, drive_id=None, library=dest.library)
            await writer.ensure_folder(drive, dest.root, [])
            item = await writer.upload(drive, join_path(dest.root, "_kp-front-test.txt"), body, "text/plain")
    except GraphError as e:
        return {"ok": False, "status": e.status, "detail": _short(e)}
    return {"ok": True, "status": 200, "detail": "Testdatei abgelegt", "webUrl": item.get("webUrl")}
