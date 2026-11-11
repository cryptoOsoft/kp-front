"""The Einsatz-Ablage – files a closed Einsatz, one way, into the station's SharePoint.

docs/incident-archive.md is the contract; this is the module. The copy is also the station's
off-site backup of its closed Einsätze, so it is built like the Objektbesuche delivery
(``object_visit_delivery``): a database outbox, a lease, retries with backoff, the same writer
(``object_visit_sharepoint.GraphWriter``, credential group ``sharepoint_export``), and nothing
remote is ever deleted or silently overwritten.

What owes a pass (``enqueue``, always inside the caller's transaction – one row, no Graph call,
so a close is never slowed down and works the same with SharePoint down):

* the close of an Einsatz that is not an Übung, or an Übung marked real after its close
  (api/incidents · patch_incident);
* a photo, Sprachnotiz or Beilage that reaches a closed Einsatz late (api/media · upload_media);
* a Rapport-PDF of different content composed for a closed Einsatz (``keep_report``).

A pass (``scheduler._incident_archive_tick`` every 30 s on the scheduler leader):

1. **Housekeeping** – rows of a destination that is off or gone pause (kept) and resume when it is
   on again; a ``failed`` row whose destination or credentials changed goes back to ``pending``.
2. **Claim** – one due ``pending`` row, ``FOR UPDATE SKIP LOCKED`` and a lease, committed at once.
3. **Upload** what ``remote_items`` does not hold yet, one file in memory at a time: the newest
   Rapport-PDF as the next version, the Sprachnotizen and Beilagen into the report folder, the
   photos into the photo folder. Progress is recorded per file, so a failure half way keeps it.
4. **Finish** – by compare-and-swap on the lease: ``delivered``, or ``pending`` again when the
   pass hit its file budget or something new was enqueued meanwhile.

Failures: 401/403/404 and a file missing from storage → ``failed`` (a person has to look; it
waits for «Erneut versuchen», a config change or new credentials). Everything else (409, 429,
5xx, network) → backoff 1 min · 5 min · 15 min · 1 h · 6 h, still ``pending`` – until it works.
"""

from __future__ import annotations

import hashlib
import logging
import mimetypes
import os
import re
import uuid
from collections.abc import Callable
from dataclasses import dataclass, field
from datetime import UTC, datetime, timedelta
from typing import TYPE_CHECKING, Any

import httpx
from sqlalchemy import and_, case, literal, or_, select, update
from sqlalchemy.dialects.postgresql import insert

from . import storage
from .credentials import load as load_credentials
from .database import async_session_maker
from .models import DeploymentConfig, Incident, IncidentArchiveDelivery, IncidentArchiveReport, Media
from .object_visit_report import local_time
from .object_visit_sharepoint import (
    GraphWriter,
    backoff,
    expand,
    export_credentials,
    export_writer,
    fingerprint,
    join_path,
    sanitize_segment,
    short_error,
)
from .schemas import IncidentArchiveConfig, IncidentArchiveDestination, load_stored_config
from .sharepoint_graph import GraphAuthError, GraphError

if TYPE_CHECKING:
    from sqlalchemy.ext.asyncio import AsyncSession

    from .report import ReportPayload

logger = logging.getLogger("kpfront.incidentarchive")

TICK_SECONDS = 30
LEASE = timedelta(minutes=10)
#: Rows a tick works through at most, and files one pass uploads at most – a big Einsatz is
#: filed over several passes, each one short and each one keeping its progress.
BATCH = 5
PASS_FILES = 25
REPORT_STEM = "Einsatzrapport"

T = IncidentArchiveDelivery
SessionFactory = Callable[[], Any]


class MissingFileError(Exception):
    """A medium's bytes are not in storage. Actionable: retrying reads the same nothing."""


@dataclass
class Claim:
    id: uuid.UUID
    destination: str
    incident_id: uuid.UUID
    wanted: int
    lease: str
    attempts: int
    remote_items: dict[str, Any] = field(default_factory=dict)


#: What a medium is filed as: the prefix of its name. Each kind counts on its own (the counters
#: live in ``remote_items["counters"]``), so «Beilage 03» and photo «03» are two different files.
PREFIXES = {"photo": "", "audio": "Sprachnotiz ", "beilage": "Beilage "}
_MEDIA_URL = re.compile(r"^/api/media/([0-9a-fA-F-]{36})$")


@dataclass
class Upload:
    """One medium a pass may owe, and where its bytes are. Its name is given at upload time."""

    media_id: str
    #: photo | audio | beilage (see PREFIXES)
    category: str
    created_at: datetime
    storage_key: str
    content_type: str


@dataclass
class Plan:
    values: dict[str, str]
    #: the newest kept Rapport-PDF: (content sha, storage key, composed at), or None
    report: tuple[str, str, datetime] | None
    #: Sprachnotizen and Beilagen – into the report folder
    documents: list[Upload]
    photos: list[Upload]


# --- config, enqueue, the kept Rapport ---------------------------------------------------------


async def archive_config(db: AsyncSession) -> IncidentArchiveConfig:
    """The section of the stored config document. A broken document reads as «off»."""
    row = (await db.execute(select(DeploymentConfig).where(DeploymentConfig.id == 1))).scalar_one_or_none()
    raw = row.config_json if (row and row.config_json) else {}
    try:
        return load_stored_config(raw).incidentArchive
    except Exception:  # noqa: BLE001 – a bad stored row must not break a close
        logger.warning("deployment config failed validation – Einsatz-Ablage read as off", exc_info=True)
        return IncidentArchiveConfig()


def active(cfg: IncidentArchiveConfig) -> list[IncidentArchiveDestination]:
    return [d for d in cfg.destinations if d.enabled] if cfg.enabled else []


def is_filed(inc: Incident) -> bool:
    """An Einsatz the Ablage files: closed, and not an Übung."""
    return bool(inc.is_archived) and not inc.is_exercise


async def enqueue(db: AsyncSession, incident_id: uuid.UUID, *, now: datetime | None = None) -> int:
    """Owe every active destination a pass over this Einsatz (creating its row). In the caller's
    transaction; never talks to Graph. Returns how many destinations were told."""
    dests = active(await archive_config(db))
    now = now or datetime.now(UTC)
    for dest in dests:
        stmt = insert(T).values(
            id=uuid.uuid4(),
            destination=dest.id,
            incident_id=incident_id,
            wanted=1,
            state="pending",
            attempts=0,
            next_attempt_at=now,
            remote_items={},
            created_at=now,
            updated_at=now,
        )
        await db.execute(
            stmt.on_conflict_do_update(
                constraint="uq_incident_archive_deliveries_dest_incident",
                set_={
                    "wanted": T.wanted + 1,
                    "state": "pending",
                    "attempts": 0,
                    "next_attempt_at": now,
                    "failed_fingerprint": None,
                    "updated_at": now,
                },
            )
        )
    return len(dests)


def report_content_sha(data: ReportPayload) -> str:
    """What the Rapport SAYS – the payload without its print time, so the same Rapport printed
    twice is one version and a Nachtrag, a signature or another Beilage is a new one."""
    return hashlib.sha256(data.model_dump_json(exclude={"generatedAt"}).encode()).hexdigest()


async def keep_report(db: AsyncSession, inc: Incident, data: ReportPayload, pdf: bytes) -> None:
    """Keep the Rapport-PDF just composed for ``inc`` as the one the Ablage files (only while the
    Ablage is on). A closed Einsatz is enqueued when its content changed.

    ⚠️ Best-effort for its caller: the download / print must never fail because of the Ablage –
    the callers run this in a savepoint and swallow what it raises."""
    if not active(await archive_config(db)):
        return
    sha = report_content_sha(data)
    row = await db.get(IncidentArchiveReport, inc.id)
    if row is not None and row.content_sha == sha:
        return
    key = storage.new_key(f"incident-archive/{inc.id}", ".pdf")
    await storage.aput_bytes(key, pdf)
    now = datetime.now(UTC)
    if row is None:
        storage.created_in_transaction(db, key)
        db.add(
            IncidentArchiveReport(incident_id=inc.id, content_sha=sha, storage_key=key, size=len(pdf), composed_at=now)
        )
    else:
        storage.replaced_in_transaction(db, new_key=key, old_key=row.storage_key)
        row.content_sha, row.storage_key, row.size, row.composed_at = sha, key, len(pdf), now
    if is_filed(inc):
        await enqueue(db, inc.id, now=now)
    await db.flush()


async def keep_report_safely(db: AsyncSession, inc: Incident, data: ReportPayload, pdf: bytes) -> None:
    """``keep_report`` in a savepoint: whatever goes wrong is logged and rolled back alone."""
    try:
        async with db.begin_nested():
            await keep_report(db, inc, data, pdf)
    except Exception:  # the Rapport the person asked for goes out regardless
        logger.exception("Einsatz-Ablage: could not keep the Rapport-PDF of %s", inc.id)


# --- names ---------------------------------------------------------------------------------------

_SEPARATORS = re.compile(r"(?:\s*[,;/–-]\s*){2,}")
_HOUSE_NUMBER = re.compile(r"\s*\d+\s*[a-zA-Z]?$")


def stichwort(title: str | None, address: str | None) -> str:
    """The Einsatz title without its address – the short word a station names its folders by
    («Ölspur», «Fahrzeugbrand»). Alerting systems often append the address to the title; the
    address must not end up in a folder name, so the incident's own address is cut out of it
    (whole, as «Strasse Nr» and as the bare street name)."""
    text = title or ""
    if address:
        street = address.split(",")[0].strip()
        for needle in sorted({address.strip(), street, _HOUSE_NUMBER.sub("", street)}, key=len, reverse=True):
            if len(needle) >= 4:
                text = re.sub(re.escape(needle), " ", text, flags=re.IGNORECASE)
    text = _SEPARATORS.sub(" ", " ".join(text.split())).strip(" ,;:/–-.")
    return text[:60].rstrip(" ,;:/–-.")


def placeholders(inc: Incident) -> dict[str, str]:
    """The folder-pattern values of an Einsatz. Never empty: an empty level would collapse."""
    at = local_time(inc.started_at) or datetime.now(UTC)
    kategorie = (inc.type or "").strip() or "Einsatz"
    return {
        "date": at.strftime("%Y.%m.%d"),
        "year": at.strftime("%Y"),
        "stichwort": stichwort(inc.title, inc.address) or kategorie,
        "kategorie": kategorie,
        "short": inc.id.hex[-4:],
    }


def report_name(version: int) -> str:
    """«Einsatzrapport.pdf», after a Nachtrag «Einsatzrapport v2.pdf» – never the same name twice."""
    return f"{REPORT_STEM}.pdf" if version <= 1 else f"{REPORT_STEM} v{version}.pdf"


def media_name(u: Upload, n: int) -> str:
    """«03 14.32.jpg», «Sprachnotiz 01 14.40.m4a» – the number and the upload time, nothing personal.

    ``n`` is the next number of the medium's kind for this Einsatz at this destination, counted
    over what is already FILED – never an index into today's list, so a name once given is never
    given to another file, whatever is added, removed or reclassified later."""
    stamp = local_time(u.created_at)
    ext = os.path.splitext(u.storage_key)[1] or mimetypes.guess_extension(u.content_type) or ""
    return sanitize_segment(f"{PREFIXES[u.category]}{n:02d} {stamp.strftime('%H.%M') if stamp else ''}".strip() + ext)


def beilage_ids(workspace: dict[str, Any] | None) -> set[str]:
    """The media the Rapport lists as Beilagen (workspace ``attachments[].url``). They are photos
    by kind, but documents by purpose («Ausweis Lenker»): they go to the report folder, never into
    the photo archive."""
    out: set[str] = set()
    for a in (workspace or {}).get("attachments") or []:
        m = _MEDIA_URL.match(str(a.get("url") or "")) if isinstance(a, dict) else None
        if m:
            out.add(m.group(1).lower())
    return out


def static_levels(pattern: str) -> int:
    """How many leading levels of a pattern hold no placeholder – the part that must exist."""
    levels = pattern.split("/")
    return next((i for i, level in enumerate(levels) if "{" in level), len(levels))


# --- housekeeping + claim ------------------------------------------------------------------------


async def housekeeping(db: AsyncSession, cfg: IncidentArchiveConfig, now: datetime) -> None:
    """Pause, resume and un-fail rows to match the config. Each change is a conditional UPDATE,
    so a close enqueued meanwhile is never overwritten by a stale read."""
    by_id = {d.id: d for d in cfg.destinations}
    enabled = sorted(d.id for d in active(cfg))
    await db.execute(
        update(T)
        .where(T.state.in_(("pending", "failed")), T.destination.not_in(enabled))
        .values(state="paused", updated_at=now)
    )
    await db.execute(
        update(T)
        .where(T.state == "paused", T.destination.in_(enabled))
        .values(state="pending", attempts=0, next_attempt_at=now, updated_at=now)
    )
    failed = (await db.execute(select(T.id, T.destination, T.failed_fingerprint).where(T.state == "failed"))).all()
    for row in failed:
        if row.destination in by_id and row.failed_fingerprint != fingerprint(by_id[row.destination]):
            await db.execute(
                update(T)
                .where(T.id == row.id, T.state == "failed")
                .values(state="pending", attempts=0, next_attempt_at=now, failed_fingerprint=None, updated_at=now)
            )


async def claim(db: AsyncSession, enabled: set[str], now: datetime) -> Claim | None:
    """Lease one due row (compare-and-swap, SKIP LOCKED). The caller commits."""
    if not enabled:
        return None
    due = and_(
        T.state == "pending",
        T.destination.in_(sorted(enabled)),
        or_(T.next_attempt_at.is_(None), T.next_attempt_at <= now),
        or_(T.lease_until.is_(None), T.lease_until < now),
    )
    candidate = (
        select(T.id).where(due).order_by(T.next_attempt_at, T.created_at).limit(1).with_for_update(skip_locked=True)
    ).scalar_subquery()
    lease = uuid.uuid4().hex
    row = (
        await db.execute(
            update(T)
            .where(T.id == candidate, due)
            .values(lease_owner=lease, lease_until=now + LEASE, attempts=T.attempts + 1)
            .returning(T.id, T.destination, T.incident_id, T.wanted, T.attempts, T.remote_items)
        )
    ).one_or_none()
    if row is None:
        return None
    return Claim(
        id=row.id,
        destination=row.destination,
        incident_id=row.incident_id,
        wanted=row.wanted,
        lease=lease,
        attempts=row.attempts,
        remote_items=dict(row.remote_items or {}),
    )


# --- the work ----------------------------------------------------------------------------------


async def plan(db: AsyncSession, c: Claim) -> Plan | None:
    """What this Einsatz holds – names and storage keys, never bytes. None when it is gone.
    An Übung (marked one after it was enqueued) owes nothing."""
    inc = await db.get(Incident, c.incident_id)
    if inc is None:
        return None
    values = placeholders(inc)
    if inc.is_exercise:
        return Plan(values=values, report=None, documents=[], photos=[])
    media = (
        (await db.execute(select(Media).where(Media.incident_id == inc.id).order_by(Media.created_at, Media.id)))
        .scalars()
        .all()
    )
    beilagen = beilage_ids(inc.map_workspace_json)

    def category(m: Media) -> str:
        if m.kind == "photo":
            return "beilage" if str(m.id) in beilagen else "photo"
        return "audio" if m.kind == "audio" else "beilage"

    uploads = [
        Upload(str(m.id), category(m), m.created_at, m.storage_key, m.content_type or "application/octet-stream")
        for m in media
    ]
    kept = await db.get(IncidentArchiveReport, inc.id)
    return Plan(
        values=values,
        report=(kept.content_sha, kept.storage_key, kept.composed_at) if kept else None,
        documents=[u for u in uploads if u.category == "audio"] + [u for u in uploads if u.category == "beilage"],
        photos=[u for u in uploads if u.category == "photo"],
    )


async def folder_id(
    writer: GraphWriter, drive: str, pattern: str, values: dict[str, str], items: dict[str, Any]
) -> str:
    """The id of this Einsatz's folder for ``pattern``, creating it on first use.

    The folder is chosen ONCE and remembered in ``remote_items["folders"]`` by its rendered path:
    a later Nachtrag files into the same folder, even after a person moved it (it is addressed by
    id). A name another Einsatz already uses gets « (2)», « (3)» – two Einsätze never share a
    folder. The chosen path is remembered before the folder is created, so a lost response finds
    it again instead of making « (2)». The levels before the first placeholder must exist."""
    folders: dict[str, Any] = items.setdefault("folders", {})
    segments = expand(pattern, values)
    key = "/".join(segments)
    entry = folders.get(key)
    if isinstance(entry, dict) and entry.get("id"):
        found = await writer.item_by_id(drive, str(entry["id"]))
        if found is not None and "folder" in found:
            return str(entry["id"])
        entry = None  # removed by hand: choose again
    if not isinstance(entry, dict) or not entry.get("path"):
        n = static_levels(pattern)
        base, parents, leaf = join_path(*segments[:n]), segments[n:-1], segments[-1]
        await writer.ensure_folder(drive, base, parents)
        parent = join_path(base, *parents)
        name = leaf
        for k in range(2, 100):
            if await writer.item(drive, join_path(parent, name)) is None:
                break
            name = f"{leaf} ({k})"
        else:
            raise GraphError(f"no free folder name for {leaf!r} in {parent}", status=409)
        entry = {"path": join_path(parent, name)}
        folders[key] = entry
    parent, _, name = str(entry["path"]).rpartition("/")
    entry["id"] = await writer.ensure_folder(drive, parent, [name])
    return str(entry["id"])


async def write_remote(writer: GraphWriter, dest: IncidentArchiveDestination, c: Claim, p: Plan) -> bool:
    """Step 3 of the module docstring. Mutates ``c.remote_items`` as it goes (the caller persists
    it either way). Returns True when the file budget ran out and more is owed."""
    items = c.remote_items
    filed: dict[str, Any] = items.setdefault("media", {})
    counters: dict[str, int] = items.setdefault("counters", {})
    reports: list[dict[str, Any]] = items.setdefault("reports", [])
    owed_report = p.report is not None and p.report[0] not in {r.get("sha") for r in reports}
    owed = {
        "documents": [u for u in p.documents if u.media_id not in filed],
        "photos": [u for u in p.photos if u.media_id not in filed],
    }
    if not owed_report and not owed["documents"] and not owed["photos"]:
        return False
    drive = await writer.resolve_drive(site_url=dest.siteUrl, drive_id=None, library=dest.library)
    budget = PASS_FILES
    if p.report is not None and owed_report:
        sha, key, composed_at = p.report
        folder = await folder_id(writer, drive, dest.reportFolder, p.values, items)
        try:
            data = await storage.aget_bytes(key)
        except OSError as e:
            # replaced by a newer compose a moment ago – the next pass files that one
            raise GraphError("Rapport-PDF wurde eben ersetzt – nächster Versuch legt den neuen ab") from e
        version = len(reports) + 1
        # A try whose answer was lost may have landed: its name is reused only for the SAME
        # content (then it is the same bytes again), never for a newer Rapport.
        tried = items.get("reportTry")
        if isinstance(tried, dict) and tried.get("sha") != sha and int(tried.get("version") or 0) >= version:
            version = int(tried["version"]) + 1
        items["reportTry"] = {"sha": sha, "version": version}
        item = await writer.upload_into(drive, folder, report_name(version), data, "application/pdf")
        del data
        items.pop("reportTry", None)
        reports.append(
            {
                "sha": sha,
                "version": version,
                "name": report_name(version),
                "item": str(item["id"]),
                "composedAt": composed_at.isoformat(),
            }
        )
        budget -= 1
    missing: list[str] = []
    for pattern, todo in ((dest.reportFolder, owed["documents"]), (dest.photoFolder, owed["photos"])):
        if not todo:
            continue
        folder = await folder_id(writer, drive, pattern, p.values, items)
        for u in todo:
            if budget <= 0:
                return True
            try:
                data = await storage.aget_bytes(u.storage_key)
            except OSError:
                missing.append(f"{u.category} {u.media_id[-4:]}")
                continue
            n = int(counters.get(u.category, 0)) + 1
            item = await writer.upload_into(drive, folder, media_name(u, n), data, u.content_type)
            del data
            # counted only once it landed: a lost response retries with the same number = the same name
            filed[u.media_id] = str(item["id"])
            counters[u.category] = n
            budget -= 1
    if missing:
        raise MissingFileError(f"{len(missing)} Datei(en) fehlen im Speicher: {', '.join(missing[:5])}")
    return False


def is_actionable(error: Exception) -> bool:
    """401/403/404, a refused token and a file missing from storage need a person."""
    if isinstance(error, (GraphAuthError, MissingFileError)):
        return True
    return isinstance(error, GraphError) and error.status == 404


# --- finishing ---------------------------------------------------------------------------------


async def finish_ok(db: AsyncSession, c: Claim, now: datetime, *, more: bool) -> bool:
    """CAS on the lease. ``delivered`` unless more is owed or something was enqueued meanwhile."""
    again = or_(T.wanted != c.wanted, literal(more))
    result = await db.execute(
        update(T)
        .where(T.id == c.id, T.lease_owner == c.lease)
        .values(
            state=case((again, "pending"), else_="delivered"),
            next_attempt_at=case((again, now), else_=None),
            lease_owner=None,
            lease_until=None,
            attempts=0,
            last_error=None,
            failed_fingerprint=None,
            remote_items=c.remote_items,
            delivered_at=now,
            updated_at=now,
        )
        .returning(T.id)
    )
    return result.one_or_none() is not None


async def finish_error(
    db: AsyncSession, c: Claim, error: Exception, dest: IncidentArchiveDestination, now: datetime
) -> None:
    values: dict[str, Any] = {
        "lease_owner": None,
        "lease_until": None,
        "last_error": short_error(error),
        "remote_items": c.remote_items,
        "updated_at": now,
    }
    if is_actionable(error):
        values.update(state="failed", failed_fingerprint=fingerprint(dest), next_attempt_at=None)
    else:
        values.update(next_attempt_at=now + backoff(c.attempts))
    await db.execute(update(T).where(T.id == c.id, T.lease_owner == c.lease).values(**values))


async def deliver(
    factory: SessionFactory,
    c: Claim,
    dest: IncidentArchiveDestination,
    *,
    transport: httpx.AsyncBaseTransport | None = None,
    now: Callable[[], datetime] = lambda: datetime.now(UTC),
) -> str:
    """Work one claim to its end. Returns ``delivered`` | ``more`` | ``gone`` | ``lost_lease`` |
    ``failed`` | ``retry``."""
    try:
        async with factory() as db:
            p = await plan(db, c)
        if p is None:
            return "gone"  # the Einsatz was deleted; its row went with it (CASCADE)
        async with httpx.AsyncClient(transport=transport, timeout=120.0) as client:
            more = await write_remote(export_writer(client), dest, c, p)
    except Exception as e:
        if not isinstance(e, (GraphError, MissingFileError)):
            logger.exception("Einsatz %s → %s: Ablage crashed", c.incident_id, c.destination)
        else:
            logger.warning("Einsatz %s → %s: %s", c.incident_id, c.destination, short_error(e))
        async with factory() as db:
            await finish_error(db, c, e, dest, now())
            await db.commit()
        return "failed" if is_actionable(e) else "retry"
    async with factory() as db:
        ok = await finish_ok(db, c, now(), more=more)
        await db.commit()
    if ok:
        logger.info("Einsatz %s filed to %s%s", c.incident_id, c.destination, " (more owed)" if more else "")
    return ("more" if more else "delivered") if ok else "lost_lease"


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
        cfg = await archive_config(db)
        await housekeeping(db, cfg, now())
        await db.commit()
        dests = {d.id: d for d in active(cfg)}
        if not dests or export_credentials() is None:
            return None
        c = await claim(db, set(dests), now())
        await db.commit()
    if c is None:
        return None
    return await deliver(factory, c, dests[c.destination], transport=transport, now=now)


async def tick(factory: SessionFactory | None = None, *, transport: httpx.AsyncBaseTransport | None = None) -> int:
    done = 0
    for _ in range(BATCH):
        if await run_once(factory, transport=transport) is None:
            break
        done += 1
    return done


# --- admin ---------------------------------------------------------------------------------------


def status_row(row: IncidentArchiveDelivery) -> dict[str, Any]:
    """One row of ``GET /api/admin/incident-archive`` (docs/incident-archive.md «Admin»)."""
    items = row.remote_items or {}
    folders = [str(f.get("path")) for f in (items.get("folders") or {}).values() if isinstance(f, dict)]
    return {
        "incidentId": str(row.incident_id),
        "destination": row.destination,
        "state": row.state,
        "attempts": row.attempts,
        "nextAttemptAt": row.next_attempt_at.isoformat() if row.next_attempt_at else None,
        "lastError": row.last_error,
        "deliveredAt": row.delivered_at.isoformat() if row.delivered_at else None,
        "folders": folders,
        "reportVersions": len(items.get("reports") or []),
        "filedMedia": len(items.get("media") or {}),
    }


async def retry(db: AsyncSession, incident_id: uuid.UUID | None, now: datetime) -> int:
    """«Erneut versuchen»: failed → pending (all, or one Einsatz). For one closed Einsatz that has
    no row yet – closed before the Ablage was switched on – it is enqueued («Ablegen»)."""
    stmt = (
        update(T)
        .where(T.state == "failed")
        .values(state="pending", attempts=0, next_attempt_at=now, failed_fingerprint=None, updated_at=now)
    )
    if incident_id is not None:
        stmt = stmt.where(T.incident_id == incident_id)
    count = len((await db.execute(stmt.returning(T.id))).all())
    if incident_id is not None and count == 0:
        inc = await db.get(Incident, incident_id)
        has_row = (await db.execute(select(T.id).where(T.incident_id == incident_id).limit(1))).first() is not None
        if inc is not None and is_filed(inc) and not has_row:
            count = await enqueue(db, incident_id, now=now)
    return count
