"""Journal (Verlauf) store: append-only per-incident rows, read by seq cursor.

The operational journal no longer rides the workspace blob (unbounded growth → the whole
document re-synced on every edit). Editors append rows here — idempotent on the client row
id, so the offline outbox can retry a batch safely — and every device pulls new rows with
`since_seq` on its live-poll tick (an empty page is a few bytes). Rows are never mutated or
deleted; lifecycle changes (reminder done/snoozed, corrections) are NEW rows, as everywhere
else in the incident record.
"""

import re
import uuid
from datetime import UTC, datetime

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from .. import live_wait
from ..auth.dependencies import CurrentAppendWriter, CurrentUser, atemschutz_link_source, is_atemschutz_link
from ..auth.incident_link import _Denied
from ..database import get_db
from ..incident_service import INCIDENT_NOT_FOUND, happened_after_close, incident_closed, incident_lifecycle
from ..models import Incident, JournalEntry
from ..schemas import JournalAppendIn, JournalEntryOut, JournalPage

router = APIRouter(prefix="/incidents", tags=["journal"])

MAX_BATCH = 500

#: The Verlauf rows a CLOSED Einsatz no longer takes (N3, 25.09.2026 — see api/incidents ·
#: `incident_closed`): what the running Einsatz writes about ITSELF. «team» is the whole
#: Atemschutz-Tafel — Kontakt, Druck, Austritt and the alarm clock's own «Atemschutz-Alarm …
#: Überfällig» (`azal-`/`azcl-`); «symbol»/«layer» are the Karte and the Pläne, whose workspace
#: writes are refused beside them; «vehicle» is the live GPS feed. Everything else — a Meldung, a
#: Foto, a Pendenz's lifecycle, a transcript or upload patch — is the record, and a late one is
#: a Nachtrag, which the Verlauf and the Rapport already print as such.
CLOSED_REFUSED_KINDS = frozenset({"team", "symbol", "layer", "vehicle"})


def _live_row(row: dict) -> bool:
    # ⚠️ A row carrying a `conflict` is a record divergence and its answer (lib/attendanceConflict,
    # the Trupp merge notes `tc…`) — settling one is record-keeping, closed or not.
    return row.get("kind") in CLOSED_REFUSED_KINDS and not row.get("conflict")


async def _ensure(db: AsyncSession, incident_id: uuid.UUID, *, lock: bool = False) -> None:
    q = select(Incident.id).where(Incident.id == incident_id)
    if lock:
        # serialise concurrent appenders on the incident row so seq stays gapless-monotonic
        q = q.with_for_update()
    exists = (await db.execute(q)).scalar_one_or_none()
    if exists is None:
        raise HTTPException(status_code=404, detail=INCIDENT_NOT_FOUND)


async def _rows_since(db: AsyncSession, incident_id: uuid.UUID, since_seq: int) -> list[JournalEntryOut]:
    rows = (
        await db.execute(
            select(JournalEntry)
            .where(JournalEntry.incident_id == incident_id, JournalEntry.seq > since_seq)
            .order_by(JournalEntry.seq.asc())
        )
    ).scalars()
    return [JournalEntryOut(seq=r.seq, row=r.row_json) for r in rows]


@router.get("/{incident_id}/journal", response_model=JournalPage)
async def read_journal(
    incident_id: uuid.UUID,
    _user: CurrentUser,
    since_seq: int = 0,
    wait: bool = False,
    db: AsyncSession = Depends(get_db),
) -> JournalPage:
    """All rows with seq > since_seq, oldest first. since_seq=0 → the full journal.

    `wait=1` makes an EMPTY answer a long poll: the request parks until a row is appended —
    by any device or by the server itself — or ~20 s pass and the empty page goes out anyway.
    A Verlaufszeile dictated on one device is on the others as soon as it is committed, and a
    quiet Verlauf costs one request per 20 s per device instead of one every 2–15 s.
    """
    # Subscribe BEFORE the read, so an append landing between read and park is not missed.
    async with live_wait.subscribe(live_wait.journal_topic(incident_id)) as changes:
        await _ensure(db, incident_id)
        entries = await _rows_since(db, incident_id, since_seq)
        if not entries and wait:
            # Hand the pooled DB connection back before parking for ~20 s (see app/live_wait).
            await db.commit()
            if await changes.wait():
                entries = await _rows_since(db, incident_id, since_seq)
    latest = entries[-1].seq if entries else since_seq
    return JournalPage(entries=entries, latest_seq=latest)


async def append_rows(db: AsyncSession, incident_id: uuid.UUID, entries: list[dict]) -> list[JournalEntryOut]:
    """Core append (idempotent by row id, per-incident seq under the incident row lock).
    Shared by the HTTP endpoint and server-side system rows (archive/reopen boundary)."""
    await _ensure(db, incident_id, lock=True)

    ids = [e["id"] for e in entries]
    existing = set(
        (
            await db.execute(
                select(JournalEntry.client_id).where(
                    JournalEntry.incident_id == incident_id, JournalEntry.client_id.in_(ids)
                )
            )
        ).scalars()
    )
    next_seq = (
        (
            await db.execute(select(func.max(JournalEntry.seq)).where(JournalEntry.incident_id == incident_id))
        ).scalar_one()
        or 0
    ) + 1

    accepted: list[JournalEntryOut] = []
    seen: set[str] = set()
    for e in entries:
        cid = e["id"]
        if cid in existing or cid in seen:  # replayed batch / duplicate within batch
            continue
        seen.add(cid)
        db.add(JournalEntry(incident_id=incident_id, client_id=cid, seq=next_seq, row_json=e))
        accepted.append(JournalEntryOut(seq=next_seq, row=e))
        next_seq += 1

    await db.flush()
    if accepted:
        # Wake every device long-polling this Verlauf — after the commit, so they read the rows
        # they are woken for. Covers all appenders, HTTP and server-side alike (see live_wait).
        live_wait.notify_after_commit(db, live_wait.journal_topic(incident_id))
    return accepted


async def patches_stay_in_channel(db: AsyncSession, incident_id: uuid.UUID, entries: list[dict], via: str) -> bool:
    """True when every `patchOf` row in `entries` targets a row its own channel wrote.

    A patch row (`retracted`, `textEdit`, …) is folded onto its target on every device and in
    the printed Rapport, so a channel narrower than the KP — an Atemschutz link, the
    Erfassungs-Poster — may correct only its OWN rows (RBAC audit S2, 22.10.2026): a stored
    target must carry this channel's `via`, an unstored one must be a plain row of this very
    batch. ⚠️ Stored wins over «in the batch»: a batch that repeats a stored row's id is skipped
    as a replay, and its patch would otherwise land on the KP's row.
    """
    targets = {e["patchOf"] for e in entries if "patchOf" in e}
    if not targets:
        return True
    stored = dict(
        (
            await db.execute(
                select(JournalEntry.client_id, JournalEntry.row_json).where(
                    JournalEntry.incident_id == incident_id, JournalEntry.client_id.in_(targets)
                )
            )
        )
        .tuples()
        .all()
    )
    in_batch = {e.get("id") for e in entries if "patchOf" not in e}
    return all((stored[t] or {}).get("via") == via if t in stored else t in in_batch for t in targets)


async def append_system_row(
    db: AsyncSession, incident_id: uuid.UUID, *, icon: str, text: str, lifecycle: str | None = None
) -> None:
    """Server-authored boundary row (Einsatz abgeschlossen / wiedereröffnet). `t` stays empty —
    clients localise the display time from `at` (the server clock is UTC).

    A close ends the Einsatz's Präsentation first (app/presentation · end_for_close), so its
    «beendet» row stands before the close row – every close path writes this row, so this is
    the one place that catches them all."""
    if lifecycle == "closed":
        from .. import presentation

        await presentation.end_for_close(db, incident_id)
    at = datetime.now(UTC).isoformat()
    row: dict = {"id": f"sys{uuid.uuid4().hex[:12]}", "t": "", "at": at, "icon": icon, "text": text}
    # `lifecycle` ("closed" | "reopened") names the boundary for the clients, which must not parse
    # the German sentence: after a reopen the Atemschutz clocks of the crews still inside restart
    # from THIS row's `at` (lib/reopenClocks), and they hold the alarm until it has arrived.
    if lifecycle:
        row["lifecycle"] = lifecycle
    await append_rows(db, incident_id, [row])


#: Verlauf rows only the SERVER writes (24.09.2026): «vor Ort» / «hat den Einsatzort verlassen»
#: are observed by the scheduler's GPS sweep (app/vehicle_presence) and stamped with the fix
#: time. A device still running the previous build keeps writing its own under the same id
#: shape, stamped when IT noticed; those are acknowledged and dropped, so a mixed-version day
#: converges on the server's record instead of adding the device's late copy beside it.
#: `vp-` is what the previous client build wrote, `vps-` the server's own shape (25.09.2026) —
#: a device writes neither.
_OBSERVED_BY_SERVER = re.compile(r"^vps?-[0-9]+-(scene|away)-")


def observed_by_server(entry: dict) -> bool:
    rid = entry.get("id")
    return isinstance(rid, str) and _OBSERVED_BY_SERVER.match(rid) is not None


@router.post("/{incident_id}/journal", response_model=JournalPage, status_code=201)
async def append_journal(
    incident_id: uuid.UUID,
    body: JournalAppendIn,
    user: CurrentAppendWriter,
    db: AsyncSession = Depends(get_db),
) -> JournalPage:
    """Append a batch of rows. Idempotent on the client row id: rows this incident already
    holds are skipped silently, so an offline outbox may retry the same batch after a lost
    response without duplicating the record. Returns the accepted rows with their seqs.

    Editors — and since 07.09.2026 the ``el`` role, whose record edits log here — append
    anything: the Verlauf is append-only and rows are attributable, so a wider vocabulary
    costs the record nothing. An ATEMSCHUTZ-link session appends `kind == "team"` rows and
    nothing else — it holds the Atemschutzüberwachung, not the Verlauf — patches only its own
    rows, and every row it writes is stamped `via` so the record says where it came from. A
    refused row is the link refusal, never a 422: the generic message is what keeps a link
    holder from mapping this API by watching which rejections differ. Any other writer's
    `via` is dropped — only the server stamps it.
    """
    if len(body.entries) > MAX_BATCH:
        raise HTTPException(status_code=422, detail=f"Batch zu gross (max. {MAX_BATCH})")
    if is_atemschutz_link(user):
        via = atemschutz_link_source(user)
        # ⚠️ and a `patchOf` only onto the link's own rows: a «team» patch row with `retracted` /
        # `textEdit` used to hide or reword ANY Verlauf row (RBAC audit S2, 22.10.2026).
        if any(e.get("kind") != "team" for e in body.entries) or not await patches_stay_in_channel(
            db, incident_id, body.entries, via
        ):
            raise _Denied()
        for e in body.entries:
            e["via"] = via
    else:
        # `via` is the SERVER's provenance stamp; a signed-in writer claiming one would make its
        # row print as a link's (Journal · the «via Atemschutz-Link» footnote).
        for e in body.entries:
            e.pop("via", None)
    # acknowledged (2xx, so the device's outbox lets go of them) and not stored — see below. FIRST,
    # before the closed check: a server-owned observation an old build still writes is dropped
    # whether the Einsatz is closed or not (never stored ⇒ never refused).
    entries = [e for e in body.entries if not observed_by_server(e)]
    # The lifecycle, under the incident row lock `append_rows` takes next, so a close cannot commit
    # in between. A row made BEFORE the close is recorded; a row the Verlauf ALREADY holds (a retry
    # whose answer was lost) is the idempotent success it always was — only a new live row made
    # after the close is refused. Every row ACCEPTED while the Einsatz is closed is stamped
    # `receivedAfterClose`: a Kontakt from 14:44 that reached the server at 14:47, after a 14:45
    # close, is a true fact in its time order — and on paper it says it came late (a Nachtrag).
    lifecycle = await incident_lifecycle(db, incident_id, lock=True)
    if not lifecycle.is_open:
        for e in entries:
            e["receivedAfterClose"] = True
    live = [e for e in entries if _live_row(e)]
    if live and not lifecycle.is_open:
        stored = set(
            (
                await db.execute(
                    select(JournalEntry.client_id).where(
                        JournalEntry.incident_id == incident_id,
                        JournalEntry.client_id.in_([e.get("id") for e in live]),
                    )
                )
            ).scalars()
        )
        if any(e.get("id") not in stored and happened_after_close(e.get("at"), lifecycle.closed_at) for e in live):
            raise incident_closed(lifecycle.closed_at)
    accepted = await append_rows(db, incident_id, entries) if entries else []
    if accepted:
        latest = accepted[-1].seq
    else:
        latest = (
            await db.execute(select(func.max(JournalEntry.seq)).where(JournalEntry.incident_id == incident_id))
        ).scalar_one() or 0
    return JournalPage(entries=accepted, latest_seq=latest)
