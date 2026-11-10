"""Incidents: CRUD and the workspace routes (optimistic concurrency + snapshots).

The incident service underneath – loading an incident, its lifecycle and the closed-Einsatz
rule, the shared workspace save – is `app/incident_service`; the per-incident link routes
(view-, Einsatz- and Atemschutz-Link) live next to their secrets in `api/incident_link`.
"""

import logging
import uuid
from copy import deepcopy
from datetime import UTC, datetime
from decimal import Decimal
from typing import NamedTuple

from fastapi import APIRouter, Cookie, Depends, Header, HTTPException, Query, Response, status
from sqlalchemy import delete, func, select, update
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import defer

from .. import audit, live_wait, storage
from ..alarm_validation import validate_trupp
from ..alarms import is_demo_deployment
from ..auth.dependencies import (
    CurrentAtemschutzWriter,
    CurrentEditor,
    CurrentRecordWriter,
    CurrentUser,
    EditorOrAdmin,
    UserOrAdmin,
    _admin_session_valid,
    atemschutz_link_source,
    is_atemschutz_link,
    is_link_session,
)
from ..auth.viewer_scope import is_viewer, viewer_history, viewer_window_clause
from ..database import execute_dml, get_db
from ..geocode import geocode
from ..incident_service import (
    INCIDENT_NOT_FOUND,
    IncidentLifecycle,
    apply_workspace_put,
    current_close,
    get_incident_or_404,
    happened_after_close,
    incident_closed,
    resolved_lifecycle,
    workspace_revision_conflict,
)
from ..models import INCIDENT_ACTIVE_STATUSES, Incident, lifecycle_open
from ..schemas import (
    IncidentCreate,
    IncidentFull,
    IncidentMeta,
    IncidentPatch,
    TruppsPut,
    WorkspaceOut,
    WorkspacePut,
    _scrub_drawing_props,
)
from ..vehicle_presence import keep_server_gps
from ..workspace_kinds import UNVERSIONED_SLICE_VERSION, keep_newer_board_kinds, schema_version_of

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/incidents", tags=["incidents"])


#: The Einsatzdaten a correction is worth recording. Everything a reconstruction needs to say
#: «the sheet was signed with THIS address» — and nothing that is not a dispatch fact.
_TRACKED_META = ("title", "type", "priority", "address", "lng", "lat", "started_at")


def _numeric(v: object) -> object:
    """A `Numeric` column's value as the plain float everything else in this app treats it as.

    ⚠️ `lat`/`lng` are `Numeric(10, 7)`, and a row read back from the database hands them over
    as `Decimal` — while the patch that is about to overwrite them carries a `float`. Two
    consequences, both bugs: `Decimal('47.5123456') != 47.5123456`, so re-sending an untouched
    coordinate looked like a correction, and a `Decimal` cannot be encoded into the JSONB
    payload below at all.
    """
    return float(v) if isinstance(v, Decimal) else v


def _json_safe(v: object) -> object:
    """A value the audit payload can hold. The tracked fields are strings, two coordinates and
    one datetime; the payload is stored as JSONB *and* hashed as JSON, so a datetime has to
    become a string and a `Decimal` a float HERE rather than at serialisation time — the hash
    must be reproducible from the stored row.

    ⚠️ Not cosmetic. The JSONB encoder is plain `json.dumps`, which refuses a `Decimal`
    outright: correcting the Einsatzort of an incident that already HAD one — moving the pin,
    picking another address, clearing it — died on the INSERT and answered «Interner Fehler».
    Every other tracked field is a string, which is why this only ever hit the location.
    """
    return v.isoformat() if isinstance(v, datetime) else _numeric(v)


#: Workspace keys that are the VIEW of the Einsatz, not an operation in it (the closed-Einsatz
#: rule itself: app/incident_service): which plan is open,
#: the Ebenen, the recent symbols, the saved views, the picked object, the frozen plan bindings,
#: the review stamp. A save that changes only these (and the record) is not refused on a closed
#: Einsatz — refusing it took the Rapport edit riding in the same save down with it.
VIEW_WORKSPACE_KEYS = frozenset(
    {
        "activePlanId",
        "activeModule",
        "layerState",
        "recent",
        "cameraViews",
        "pickedObjectId",
        "intakeReviewedAt",
        # which build wrote the blob: a v3 device correcting the Rapport of an Einsatz last saved
        # by a v2 one is not an operation in it (review of #338 — every closed Einsatz on prod)
        "schemaVersion",
    }
)
# ⚠️ NOT `planBindings`: a binding FREEZES which plan revision and fit this Einsatz ran on
# (lib/incidentPlanBindings) — part of what the record says, not a way of looking at it.


def operational_keys_changed(stored: dict, submitted: dict) -> list[str]:
    """The workspace keys OUTSIDE the record that a full save would change — what a closed
    Einsatz refuses. Both sides are compared scrubbed (`_scrub_drawing_props`, the same pass the
    save applies), so an untouched legacy key resubmitted as-is compares equal. Deep copies,
    because the scrub mutates; this runs only for a closed Einsatz, never on the live save path."""
    keys = (set(stored) | set(submitted)) - RECORD_WORKSPACE_KEYS - VIEW_WORKSPACE_KEYS
    before = deepcopy({k: stored[k] for k in keys if k in stored})
    after = deepcopy({k: submitted[k] for k in keys if k in submitted})
    _scrub_drawing_props(before)
    _scrub_drawing_props(after)
    return sorted(k for k in keys if before.get(k) != after.get(k))


@router.get("", response_model=list[IncidentMeta])
async def list_incidents(
    user: UserOrAdmin,
    archived: bool | None = None,
    # Bounded at the edge: a negative LIMIT/OFFSET reached Postgres, which refuses it, and
    # the caller got a 500 for a malformed query string. 500 is the most the admin history asks for.
    limit: int = Query(default=100, ge=1, le=500),
    skip: int = Query(default=0, ge=0),
    db: AsyncSession = Depends(get_db),
) -> list[Incident]:
    # IncidentMeta never carries the heavy JSONB blobs — defer them so the list (hit on open
    # and every 30 s) doesn't drag every workspace + details out of Postgres.
    q = select(Incident).options(defer(Incident.map_workspace_json), defer(Incident.details_json))
    if archived is not None:
        q = q.where(Incident.is_archived.is_(archived))
    if user is not None and is_viewer(user):
        q = q.where(viewer_window_clause(await viewer_history(db)))  # running + the last days (auth/viewer_scope)
    q = q.order_by(Incident.started_at.desc()).limit(limit).offset(skip)
    return list((await db.execute(q)).scalars())


@router.post("", response_model=IncidentFull, status_code=status.HTTP_201_CREATED)
async def create_incident(body: IncidentCreate, user: CurrentEditor, db: AsyncSession = Depends(get_db)) -> Incident:
    # The public demo is a single living incident everyone edits — block spawning new ones
    # server-side (the UI already hides the action). Editing the existing incident stays open.
    if await is_demo_deployment(db):
        raise HTTPException(status_code=403, detail="In der Demo können keine neuen Einsätze erstellt werden.")
    if (body.lat is None) != (body.lng is None):
        raise HTTPException(status_code=422, detail="lat und lng müssen beide oder keine gesetzt sein")
    # Geocode the address via swisstopo when coords are missing (map-click is the fallback).
    if body.lat is None and body.address:
        coords = await geocode(body.address)
        if coords:
            body.lat, body.lng = coords
    inc = Incident(
        title=body.title,
        type=body.type,
        priority=body.priority,
        text=body.text,
        address=body.address,
        lat=body.lat,
        lng=body.lng,
        details_json=body.details_json,
        source="manual",
        status="offen",
        is_exercise=body.is_exercise,
        # the one stamp that lets an editor delete without the Verwaltung (models · Incident)
        exercise_since_creation=body.is_exercise,
        created_by=user.id,
    )
    if body.started_at:
        # The wizard sends the Alarmierungszeit field on every manual create (prefilled with
        # «now», backdated when an analog Einsatz is nachgetragen) — either way a human saw
        # and accepted it, which is what makes it an alarm time rather than an insert time.
        inc.started_at = body.started_at
        inc.started_at_source = "manual"
    db.add(inc)
    await db.flush()
    await audit.append_event(
        db,
        incident_id=inc.id,
        op_type="incident.create",
        source="status",
        user_id=user.id,
        payload={"title": inc.title, "source": inc.source},
    )
    from ..webhooks import notify_incident_created

    await notify_incident_created(db, inc)
    await db.refresh(inc)
    return inc


@router.get("/{incident_id}", response_model=IncidentFull)
async def get_incident(
    incident_id: uuid.UUID, user: CurrentUser, db: AsyncSession = Depends(get_db)
) -> Incident | IncidentFull:
    inc = await get_incident_or_404(db, incident_id)
    if is_link_session(user):  # who opened it is an account UUID — not for a page off the station
        return IncidentFull.model_validate(inc).model_copy(update={"created_by": None})
    return inc


async def _latch_editor_opened(db: AsyncSession, incident_id: uuid.UUID) -> None:
    """Cross-visibility latch: stamp the FIRST authenticated-editor workspace read/write —
    the QR capture view shows it as «KP-Tablet aktiv». Deliberately once-only semantics
    (conditional UPDATE, no rows matched after the first hit): «the KP has opened this
    incident at all», never a last-active tracker. updated_at is pinned to itself so the
    latch doesn't count as a content change («geändert nach Abschluss» derives from it)."""
    await db.execute(
        update(Incident)
        .where(Incident.id == incident_id, Incident.editor_opened_at.is_(None))
        .values(editor_opened_at=func.now(), updated_at=Incident.updated_at)
    )


class _LiveState(NamedTuple):
    rev: int
    lifecycle: IncidentLifecycle


async def _live_state(db: AsyncSession, incident_id: uuid.UUID, *, lock: bool = False) -> _LiveState:
    """The revision AND the lifecycle — still four cheap columns, no JSONB. What the live-follow
    poll decides on and answers with (see `_lifecycle_headers`). `lock` takes the row FOR UPDATE:
    the full save holds it from this read to its UPDATE, so a close cannot commit in between."""
    stmt = select(Incident.workspace_rev, Incident.is_archived, Incident.status, Incident.closed_at).where(
        Incident.id == incident_id
    )
    if lock:
        stmt = stmt.with_for_update()
    row = (await db.execute(stmt)).one_or_none()
    if row is None:
        raise HTTPException(status_code=404, detail=INCIDENT_NOT_FOUND)
    lc = await resolved_lifecycle(db, incident_id, IncidentLifecycle(bool(row.is_archived), row.status, row.closed_at))
    return _LiveState(row.workspace_rev, lc)


#: Headers every workspace read answers with — the 304 included, because on a quiet Einsatz the
#: 304 is the ONLY answer a follower ever gets. Closing an Einsatz does not touch the workspace
#: revision, so without them a device learnt of a close only by reloading (N3, 25.09.2026): the
#: other phone and the tablet ran the Tafel for minutes afterwards. `patch_incident` wakes the
#: parked followers on a lifecycle change, and the client (api/workspace · pollWorkspaceSince)
#: reads these on every round.
INCIDENT_OPEN_HEADER = "X-Incident-Open"
INCIDENT_CLOSED_AT_HEADER = "X-Incident-Closed-At"
#: Which device saved — sent with every workspace save, as the follower read's `writer=` (see
#: `live_wait · only_own_writes`). And on a 304 that answers «only your own saves since then»:
#: the revision the server is at, so the follower parks there next (api/workspace · pollWorkspaceSince).
WORKSPACE_WRITER_HEADER = "X-Workspace-Writer"
WORKSPACE_REV_HEADER = "X-Workspace-Rev"


def _lifecycle_headers(lc: IncidentLifecycle) -> dict[str, str]:
    headers = {INCIDENT_OPEN_HEADER: "1" if lc.is_open else "0"}
    if not lc.is_open and lc.closed_at is not None:
        headers[INCIDENT_CLOSED_AT_HEADER] = lc.closed_at.isoformat()
    return headers


#: The Präsentationsmodus marker on every workspace read, the 304 included: the running
#: presentation's id, or «none». It is how a device learns that one runs WITHOUT a loop of its
#: own – the presentation follow (api/presentation) runs only while this says one does, so an
#: Einsatz nobody presents costs no request (perf journey `idle`, 06.11.2026). A start or an end
#: wakes the parked workspace polls (app/presentation · `_wake`), so a follower hears it at once.
PRESENTATION_HEADER = "X-Presentation"


async def _presentation_marker(db: AsyncSession, incident_id: uuid.UUID, is_open: bool) -> str:
    """The marker – after the lazy watchdog, so a presenter gone quiet reads as «none» (and its
    «beendet» row is written) even while nobody runs the presentation follow."""
    from .. import presentation

    p = await presentation.expire(db, incident_id, is_open=is_open)
    return p.id if p is not None else "none"


@router.get("/{incident_id}/workspace", response_model=WorkspaceOut)
async def get_workspace(
    incident_id: uuid.UUID,
    user: CurrentUser,
    response: Response,
    since: int | None = None,
    wait: bool = False,
    open_: bool | None = Query(default=None, alias="open"),
    writer: str | None = None,
    presentation: str | None = Query(default=None, max_length=32),
    db: AsyncSession = Depends(get_db),
):
    """The workspace blob, or a 304 when the caller's `since` revision is still current.

    `writer` is the asking device's id, the one its saves carry (`X-Workspace-Writer`). When every
    revision after `since` is a save of that device, it already holds them: the answer is the 304
    with `X-Workspace-Rev` instead of the blob it just sent (18.10.2026 — every save woke the
    saving device's own long poll and cost it the whole blob). Any revision this process cannot
    vouch for — another device's, an unrecorded writer's — is the blob, as before.

    `open` is what the CALLER believes about the lifecycle. When the Einsatz is no longer in that
    state the poll is answered at once instead of parking — a close or a reopen that committed
    between the device's last answer and this request would otherwise wait out the whole timeout
    (the wake fires only for followers already parked). Absent (an older client) → parks as
    before.

    `presentation` is the Präsentationsmodus marker the caller holds (`PRESENTATION_HEADER`), the
    same way: a poll whose marker is no longer true is answered at once. A device that knows
    none sends «none», the common case, so it parks as usual.

    `wait=1` (only meaningful together with `since`) makes that 304 a LONG POLL: instead of
    answering «unchanged» right away and being asked again two seconds later, the request parks
    until another device's save bumps the revision — or ~20 s pass, and the answer is the same
    304 it would have been. The follower gets a cross-device edit in the time it takes to commit,
    and a quiet incident costs one request per 20 s instead of one every 2–15 s.
    """
    # Editors latch on read too (opening an incident GETs the workspace before any edit);
    # viewers (EL-Ansicht) don't — a read-only follower is not "the KP has it".
    latch = user.role == "editor"
    # Light live-follow: on a since= poll, read ONLY the revision (a cheap int column) to decide
    # 304 — don't drag the whole workspace JSONB out of Postgres just to return a bodyless
    # response. The full blob is loaded only on first open or when the caller is behind.
    if since is not None:
        # Subscribe BEFORE the read: a save committing between the two would otherwise go unheard
        # and this follower would sit out the whole timeout with the new blob already in the DB.
        async with live_wait.subscribe(live_wait.workspace_topic(incident_id)) as changes:
            state = await _live_state(db, incident_id)
            marker = await _presentation_marker(db, incident_id, state.lifecycle.is_open)
            if latch:
                await _latch_editor_opened(db, incident_id)
            # ⚠️ A follower of a CLOSED Einsatz parks too. Answering it at once would spin every
            # device showing the closed Einsatz in a tight loop (the client goes straight into the
            # next round after an answer); the ones parked at the moment of the close are woken by
            # `patch_incident`, and a later poll hears it on its first answer.
            believed = (open_ is None or open_ == state.lifecycle.is_open) and presentation in (None, marker)
            if since == state.rev and wait and believed:
                # Commit BEFORE parking. It persists the latch above and — the load-bearing half —
                # hands the pooled DB connection back: a dozen followers asleep on a checked-out
                # connection would drain the pool and stall every write in the station.
                await db.commit()
                if await changes.wait():
                    state = await _live_state(db, incident_id)
                    marker = await _presentation_marker(db, incident_id, state.lifecycle.is_open)
        unchanged = {**_lifecycle_headers(state.lifecycle), PRESENTATION_HEADER: marker}
        if since == state.rev:
            return Response(status_code=status.HTTP_304_NOT_MODIFIED, headers=unchanged)
        if live_wait.only_own_writes(incident_id, live_wait.writer_id(writer), since, state.rev):
            return Response(
                status_code=status.HTTP_304_NOT_MODIFIED, headers={**unchanged, WORKSPACE_REV_HEADER: str(state.rev)}
            )
    inc = await get_incident_or_404(db, incident_id)
    if latch and since is None:
        await _latch_editor_opened(db, incident_id)
    lifecycle = await resolved_lifecycle(db, incident_id, IncidentLifecycle(inc.is_archived, inc.status, inc.closed_at))
    response.headers.update(_lifecycle_headers(lifecycle))
    response.headers[PRESENTATION_HEADER] = await _presentation_marker(db, incident_id, lifecycle.is_open)
    return WorkspaceOut(workspace=inc.map_workspace_json, workspace_rev=inc.workspace_rev)


@router.put("/{incident_id}/workspace", response_model=WorkspaceOut)
async def put_workspace(
    incident_id: uuid.UUID,
    body: WorkspacePut,
    user: CurrentEditor,
    slim: bool = False,
    writer: str | None = Header(default=None, alias=WORKSPACE_WRITER_HEADER),
    db: AsyncSession = Depends(get_db),
) -> WorkspaceOut:
    # Rev-only precheck: the 404 answer this route used to open with, off the cheap int column
    # instead of the full JSONB row — and the doomed save (several tablets saving at once) is
    # refused HERE, before the full-blob SELECT and validation it would throw away. Purely an
    # optimization: the authoritative check stays the conditional UPDATE in apply_workspace_put,
    # and the success path skips no validation (the alarm-validation note above apply_workspace_put).
    # ⚠️ Under the row lock (review of #235): read open, then a close commits, then this save's
    # UPDATE — which checks the revision, not the lifecycle — would land in the closed record.
    state = await _live_state(db, incident_id, lock=True)
    await _latch_editor_opened(db, incident_id)
    if state.rev != body.base_rev:
        raise workspace_revision_conflict(state.rev, body.base_rev)
    inc: Incident | None = None
    if not state.lifecycle.is_open:
        # A closed Einsatz takes the record and nothing else (see `incident_closed`). The revision
        # check stays FIRST: a device a save behind merges and comes back, and only a write that
        # still changes the Tafel, the Karte or the Pläne after that is refused — a late Rapport
        # correction merged onto the current blob goes through — and so does a save whose edits
        # were all MADE before the close. Under the row lock, like the journal/audit appenders.
        inc = await get_incident_or_404(db, incident_id, lock=True)
        stored = inc.map_workspace_json if isinstance(inc.map_workspace_json, dict) else {}
        closed_at = state.lifecycle.closed_at
        # compare what the save would actually STORE: the server's own parts put back first —
        # the vehicles' gps, and the board objects a build older than their kind left out
        # (review of #338: an old build's save on a closed Einsatz otherwise read as «pages
        # deleted» and was refused before the guard that keeps them ever ran)
        keep_server_gps(body.workspace, stored)
        keep_newer_board_kinds(body.workspace, stored)
        if operational_keys_changed(stored, body.workspace) and happened_after_close(body.edited_at, closed_at):
            raise incident_closed(closed_at)
    # a full blob has carried its stamp since v1: none at all is the oldest build there is
    version = schema_version_of(body.workspace.get("schemaVersion"), 1)
    saved = await apply_workspace_put(db, incident_id, body, user_id=user.id, inc=inc, writer=writer, version=version)
    # `slim=1`: only the revision goes back — the caller sent the blob and reads nothing but
    # the rev (workspaceSync · pushCurrent), and echoing it doubled the wire cost of every
    # save. Opt-in per request so an older cached PWA build keeps the full echo it was built
    # against; drop the flag once no fielded client predates 11.09.2026.
    return WorkspaceOut(workspace=None, workspace_rev=saved.workspace_rev) if slim else saved


@router.put("/{incident_id}/workspace/trupps", response_model=WorkspaceOut)
async def put_workspace_trupps(
    incident_id: uuid.UUID,
    body: TruppsPut,
    user: CurrentAtemschutzWriter,
    writer: str | None = Header(default=None, alias=WORKSPACE_WRITER_HEADER),
    db: AsyncSession = Depends(get_db),
) -> WorkspaceOut:
    """Save ONLY the Atemschutz roster — the one write shape an Atemschutz link is given.

    It exists because the whole-document PUT would hand a link holder the entire Einsatz: the
    Karte, the Pläne, the Einstellungen, all of it replaceable in one request by a phone that
    never renders any of it. Here the server's own blob is the base and exactly one key is
    replaced, so what a link can damage is bounded by what it can see.

    Not a weaker save: `base_rev` goes through the same conditional UPDATE as the full PUT, so
    a concurrent save on the FU tablet makes this the identical 409 (client 3-way-merges and
    retries) rather than a silent overwrite. Editors may use it too — same route, same rules —
    and only they latch `editor_opened_at`; a link session is not «the KP has this incident».
    """
    inc = await get_incident_or_404(db, incident_id, lock=True)
    # The Tafel ends with the Einsatz: no Kontakt, Druck or Austritt made AFTER the close lands in
    # the closed record (N3, 25.09.2026). An Atemschutz-LINK never gets here then — its session
    # dies with the Einsatz (auth/incident_link) — so this is the editor on the slice route.
    if not inc.is_open:
        closed_at = await current_close(db, incident_id, inc.closed_at)
        if happened_after_close(body.edited_at, closed_at):
            raise incident_closed(closed_at)
    link = is_atemschutz_link(user)
    if not link:
        await _latch_editor_opened(db, incident_id)
    new_ws = {**(inc.map_workspace_json or {}), "trupps": body.trupps}
    # The rows are validated in apply_workspace_put against the stored blob, so a new or changed
    # Trupp must pass while an unchanged legacy row (or an old malformed reminder) still rides.
    scoped = WorkspacePut.model_construct(workspace=new_ws, base_rev=body.base_rev)
    saved = await apply_workspace_put(
        db,
        incident_id,
        scoped,
        user_id=None if link else user.id,
        source=atemschutz_link_source(user) if link else "client",
        inc=inc,
        writer=writer,
        version=schema_version_of(body.schemaVersion, UNVERSIONED_SLICE_VERSION),
    )
    # Only the revision goes back: the caller sent a slice and reads nothing but the rev
    # (workspaceSync · push), and a phone on one bar has no use for the whole blob per tap.
    return WorkspaceOut(workspace=None, workspace_rev=saved.workspace_rev)


# The workspace keys the Einsatzleiter function (role ``el``, 07.09.2026) may write: the
# operational RECORD — who is here (attendance + the Zeitplan pair shifts/bands, one surface),
# what was used (mittel), what was checked (checklists), and the Rapport (reportMeta +
# Beilagen). Everything else — entities, drawings, board, building, planScale, trupps,
# cameraViews, settings — is the tactical picture and stays with the editors. Same doctrine as
# capture.py · CAPTURE_WORKSPACE_KEYS: widening this set is a deliberate decision with a doc
# change attached (docs/API.md · roles).
RECORD_WORKSPACE_KEYS = frozenset(
    {"attendance", "shifts", "bands", "mittel", "checklists", "reportMeta", "attachments", "reportSignatures"}
)

#: The crew filing's markers on the record slice (RBAC audit S4, 22.10.2026) — mirrored by
#: src/lib/api/workspaceSync.ts · CREW_FILED_SLICE_KEY. ``trupps[].crewFiled`` says whom the
#: ANWESENHEIT was told about (lib/crewFiling): a record fact the ``el`` files, kept on the Trupps
#: it may not write. The slice sends ``{trupp_id: [key, …]}``; they are UNIONED onto the stored
#: Trupps and nothing else of a Trupp is read — never stored as a key of its own. Without it an
#: el phone beside an Atemschutz-Link (no FU tablet) filed the crew again on every reload, and a
#: member the el took off the Anwesenheit came back.
RECORD_CREW_FILED_KEY = "truppCrewFiled"
_CREW_FILED_MAX = 64  # keys per Trupp: one per crew member — a bad-client guard, not a limit


def _fold_crew_filed(trupps: object, marks: object) -> object:
    """``trupps`` with ``marks`` unioned onto their ``crewFiled`` (sorted, grow-only — the shape
    every client writes). Malformed marks are ignored; so is a stored Trupp the alarm validation
    would refuse once changed (an unchanged legacy row is only kept because it is unchanged)."""
    if not isinstance(trupps, list) or not isinstance(marks, dict):
        return trupps
    out = []
    for t in trupps:
        add = marks.get(t.get("id")) if isinstance(t, dict) and isinstance(t.get("id"), str) else None
        if isinstance(add, list):
            have = t.get("crewFiled") if isinstance(t.get("crewFiled"), list) else []
            keys = sorted({k for k in [*have, *add] if isinstance(k, str) and 0 < len(k) <= 200})
            if len(keys) <= _CREW_FILED_MAX and keys != have:
                try:
                    validate_trupp(t)
                except ValueError:
                    pass
                else:
                    t = {**t, "crewFiled": keys}
        out.append(t)
    return out


@router.put("/{incident_id}/workspace/record", response_model=WorkspaceOut)
async def put_workspace_record(
    incident_id: uuid.UUID,
    body: WorkspacePut,
    user: CurrentRecordWriter,
    writer: str | None = Header(default=None, alias=WORKSPACE_WRITER_HEADER),
    db: AsyncSession = Depends(get_db),
) -> WorkspaceOut:
    """Save ONLY the record domains — the one write shape the ``el`` role has.

    Mirrors the capture endpoint's key merge: the server's own blob is the base and only
    RECORD_WORKSPACE_KEYS present in the submitted workspace are replaced, so what an ``el``
    session can change is bounded whatever its client sends — the full PUT stays editor-only
    (docs/roles-and-access.md). Same ``base_rev`` conditional UPDATE as every other save, so a
    concurrent editor makes this the identical 409, never a silent overwrite. Editors may use
    the route too, and only they latch ``editor_opened_at`` — an EL following along is not
    «the KP has this incident»."""
    inc = await get_incident_or_404(db, incident_id)
    if user.role == "editor":
        await _latch_editor_opened(db, incident_id)
    stored = inc.map_workspace_json if isinstance(inc.map_workspace_json, dict) else {}
    new_ws = {**stored, **{k: body.workspace[k] for k in RECORD_WORKSPACE_KEYS if k in body.workspace}}
    if RECORD_CREW_FILED_KEY in body.workspace and "trupps" in stored:
        new_ws["trupps"] = _fold_crew_filed(stored["trupps"], body.workspace[RECORD_CREW_FILED_KEY])
    # The incoming WorkspacePut is validated already; carrying over the editors' own keys must
    # not re-reject unchanged legacy fields (same reasoning as the trupps slice above).
    scoped = WorkspacePut.model_construct(workspace=new_ws, base_rev=body.base_rev)
    saved = await apply_workspace_put(
        db,
        incident_id,
        scoped,
        user_id=user.id,
        source="el" if user.role == "el" else "client",
        inc=inc,
        writer=writer,
        version=schema_version_of(body.workspace.get("schemaVersion"), UNVERSIONED_SLICE_VERSION),
    )
    # Only the revision goes back — the caller sent a slice and reads nothing but the rev.
    return WorkspaceOut(workspace=None, workspace_rev=saved.workspace_rev)


# The IncidentPatch fields the ``el`` role may correct — exactly the ones the «Einsatzdaten
# bearbeiten» panel sends (components/panels/EinsatzWizard · submit): the dispatch facts on the
# head of the record. Keeping the record and being unable to fix a wrong Stichwort or a wrong
# Einsatzort in it was the same half-role as a Rapport nobody may sign.
#
# The Abschluss is the EL's too (owner, 10.11.2026, EL phone sweep A2: the Einsatzleiter writes
# the Rapport, so they close the Einsatz and reopen it): `is_archived` and the `report_done_at`
# stamp the close sends with it. What stays editor-only is `status` – and creating and deleting
# an Einsatz, which are other routes. ⚠️ Keep in step with what that panel PATCHes: a field it
# sends and this set omits is a 403 on the whole save, not a partly-applied correction.
EL_META_FIELDS = frozenset({"title", "type", "priority", "text", "address", "lat", "lng", "started_at", "is_exercise"})
EL_LIFECYCLE_FIELDS = frozenset({"is_archived", "report_done_at"})


@router.patch("/{incident_id}", response_model=IncidentFull)
async def patch_incident(
    incident_id: uuid.UUID, body: IncidentPatch, user: CurrentRecordWriter, db: AsyncSession = Depends(get_db)
) -> Incident:
    inc = await get_incident_or_404(db, incident_id)
    data = body.model_dump(exclude_unset=True)
    # An ``el`` session corrects the Einsatzdaten and closes or reopens the Einsatz, nothing else
    # (the two sets above); every other field answers with the plain editor refusal, so probing
    # this route tells an el session no more than it tells a viewer.
    if user.role != "editor" and not set(data) <= EL_META_FIELDS | EL_LIFECYCLE_FIELDS:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Bearbeiter-Berechtigung erforderlich")
    # The coordinate PAIR as it would stand after this patch — the schema checked each value, only
    # the row knows the one the body left out. Half a position is no position: the same rule as
    # create, and clearing both (the panel's ✕) stays a valid patch. Only when the body touches
    # a coordinate: a legacy half pair must not block an unrelated correction.
    if ("lat" in data or "lng" in data) and (data.get("lat", inc.lat) is None) != (data.get("lng", inc.lng) is None):
        raise HTTPException(status_code=422, detail="lat und lng müssen beide oder keine gesetzt sein")
    # The public demo has exactly one prepared running incident and one prepared archive.
    # Visitors may edit their contents, but changing either lifecycle leaves the next magazine
    # reader with no promised entry point (or two running incidents) until the reset. The client
    # already blocks its own Abschluss paths; this is the server-side boundary for direct API
    # calls and older clients.
    if await is_demo_deployment(db):
        lifecycle_change = (
            ("is_archived" in data and data["is_archived"] != inc.is_archived)
            or ("report_done_at" in data and data["report_done_at"] != inc.report_done_at)
            or ("status" in data and data["status"] != inc.status and data["status"] not in INCIDENT_ACTIVE_STATUSES)
            or ("is_exercise" in data and data["is_exercise"] != inc.is_exercise)
        )
        if lifecycle_change:
            raise HTTPException(status_code=403, detail="In der Demo kann der Einsatz nicht abgeschlossen werden.")
    status_before = inc.status
    archived_before = inc.is_archived
    exercise_before = inc.is_exercise
    report_done_before = inc.report_done_at
    # ⚠️ Snapshot BEFORE the setattr loop. Correcting the Einsatzdaten used to leave no trace at
    # all — only the Übung toggle wrote an event — so the address on a signed rapport could differ
    # from the address the crew drove to and nothing recorded that. These are the facts a
    # reconstruction needs, and the frontend already documents `meta.change` as covering «a person
    # changing the record» (lib/replay.ts); until now only one field made that true.
    before = {k: getattr(inc, k) for k in _TRACKED_META}
    for k, v in data.items():
        setattr(inc, k, v)
    changed = {
        k: {"from": _json_safe(before[k]), "to": _json_safe(getattr(inc, k))}
        for k in _TRACKED_META
        # ⚠️ Compared through `_numeric`, not raw: a coordinate leaves the database as `Decimal`
        # and comes back from the client as `float`, so an untouched lat/lng compared unequal to
        # itself and every save re-recorded a correction that never happened. Datetimes stay
        # datetimes — the same instant written in another UTC offset must still compare equal.
        if k in data and _numeric(getattr(inc, k)) != _numeric(before[k])
    }
    if changed:
        await audit.append_event(
            db,
            incident_id=inc.id,
            op_type="meta.change",
            source="einsatzdaten",
            user_id=user.id,
            payload={"fields": changed},
        )
    if data.get("started_at") is not None:
        # A correction in the Einsatzdaten panel is a human asserting the Alarmierungszeit —
        # it overrides whatever the alerting system said, and it upgrades an unknown
        # (server-default) time to a known one.
        inc.started_at_source = "manual"
    if data.get("is_exercise") is False:
        # Marked real once, never cheaply deletable again — even if it is flipped back to Übung
        # (models · Incident.exercise_since_creation).
        inc.exercise_since_creation = False
    if "is_exercise" in data and data["is_exercise"] != exercise_before:
        await audit.append_event(
            db,
            incident_id=inc.id,
            op_type="meta.change",
            source="status",
            user_id=user.id,
            payload={"exercise": data["is_exercise"]},
        )
    if "report_done_at" in data and data["report_done_at"] != report_done_before:
        await audit.append_event(
            db,
            incident_id=inc.id,
            op_type="status.change",
            source="status",
            user_id=user.id,
            payload={"report_done": data["report_done_at"] is not None},
        )
        if data["report_done_at"] is not None:
            from .journal import append_system_row

            # A re-completion after late corrections self-documents: the journal shows when
            # each Rapport version was declared complete.
            # (a reopen clears report_done_at — see below — so an earlier close is what says
            # «again»: closed_at keeps the first Einsatzende across «Wieder öffnen»)
            text = (
                "Rapport abgeschlossen"
                if report_done_before is None and inc.closed_at is None
                else "Rapport erneut abgeschlossen (ersetzt frühere Version)"
            )
            await append_system_row(db, inc.id, icon="check", text=text)
    if "status" in data and data["status"] != status_before:
        await audit.append_event(
            db,
            incident_id=inc.id,
            op_type="status.change",
            source="status",
            user_id=user.id,
            payload={"from": status_before, "to": data["status"]},
        )
    if "is_archived" in data and data["is_archived"] != archived_before:
        await audit.append_event(
            db,
            incident_id=inc.id,
            op_type="status.change",
            source="status",
            user_id=user.id,
            payload={"archived": data["is_archived"]},
        )
        # Archive = the end of the incident (§6 record model): the FIRST archive stamps the
        # Einsatzende; a reopen (the correction path) keeps it — rows after closed_at render
        # as Nachträge. Both transitions self-document in the journal so a record read weeks
        # later explains its own gap.
        from .journal import append_system_row

        if data["is_archived"]:
            now = datetime.now(UTC)
            if inc.closed_at is None:
                inc.closed_at = now
            inc.last_closed_at = now
            await append_system_row(db, inc.id, icon="flag", text="Einsatz abgeschlossen", lifecycle="closed")
        else:
            # A RUNNING Einsatz carries no «Rapport fertig» (staging r3, F3): the reopen is the
            # Rapport becoming unfinished again, and every device read the stamp as «done». The
            # close stays in the record — the status.change event above and the Verlauf rows —
            # and `closed_at` stays too: it is the first Einsatzende, which marks the Nachträge.
            if inc.report_done_at is not None and "report_done_at" not in data:
                inc.report_done_at = None
                await audit.append_event(
                    db,
                    incident_id=inc.id,
                    op_type="status.change",
                    source="status",
                    user_id=user.id,
                    payload={"report_done": False, "reopened": True},
                )
            await append_system_row(
                db, inc.id, icon="undo", text="Einsatz wiedereröffnet (Nachtrag)", lifecycle="reopened"
            )
    # Self-reported crew positions live exactly as long as the Einsatz does — the promise
    # made on the phone when someone opted in. The link session that fed them is already
    # dead at this point (`_incident_still_open`), so the rows would only sit there going
    # stale; drop them the moment the Einsatz stops being open, by any of the three routes
    # that end it. Reopening a closed Einsatz does NOT resurrect them: the phones start
    # reporting again on their own, and inventing positions nobody currently vouches for
    # would be worse than an empty layer.
    if not inc.is_open:
        from ..models import PersonPosition

        await execute_dml(db, delete(PersonPosition).where(PersonPosition.incident_id == inc.id))
    # A close (or a reopen) does not move the workspace revision, so wake the devices parked on
    # it: their poll answers with the lifecycle (`_lifecycle_headers`), and that is how the OTHER
    # phone and the tablet learn within a second that this Einsatz is over (N3, 25.09.2026).
    if inc.is_open != lifecycle_open(archived_before, status_before):
        live_wait.notify_after_commit(db, live_wait.workspace_topic(inc.id))
    await db.flush()
    await db.refresh(inc)
    return inc


# The one accepted maintenance exception is whole-incident hard deletion through `/admin`:
# `DELETE /api/incidents/{id}` is deployment-admin-only, and a real Einsatz must already be
# archived (an Übung may be deleted in any state). It deliberately removes the full record and
# its audit chain, so do not widen this to editors, individual production rows, or a mutable
# history shortcut. Revisit external deletion evidence/retention policy before offering managed
# hosting; the current trust boundary is one station operating its own deployment.
@router.delete("/{incident_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_incident(
    incident_id: uuid.UUID,
    _actor: EditorOrAdmin,
    db: AsyncSession = Depends(get_db),
    admin_session: str | None = Cookie(default=None),
) -> None:
    """Hard delete. Child rows (journal, audit chain, people, media, snapshots) go via FK CASCADE;
    their storage blobs are removed best-effort after the database commit.

    TWO doors, because they answer different questions:

    · **Übungen** — any editor, any time. An exercise is not an operational record; it exists to
      be thrown away, and needing an admin for it would make the tidy-up cost more than the
      exercise. That is the whole point of the flag, and a Wehr that cannot clear its own
      practice runs stops marking them as practice runs. A viewer still cannot (403).
      «Übung» here means CREATED as one and never marked real since
      (``exercise_since_creation``) — a real Einsatz someone marked Übung later is a real
      Einsatz for this door.

    ⚠️ The door is ``EditorOrAdmin``, not ``CurrentEditor``: the Verwaltung's own incident list
      offers this button, and /admin is reached with an ADMIN cookie that need not be
      accompanied by an editor login. Requiring both made that control fail for exactly the
      person the Verwaltung exists for.

    · **Real Einsätze** — an ADMIN session, and only once the Einsatz is ARCHIVED. Deleting one
      destroys an Einsatzakte: the Verlauf, the hash-chained audit trail, the Anwesenheit, every
      photo and voice memo. That is a legal record, so it takes the same key as the Verwaltung
      and it cannot happen to something still running — the archive step is the operator saying
      the Einsatz is over, and it is the only moment at which «löschen» is a decision rather than
      an accident. (Was a flat 403 before, which left a real Einsatz — a mistaken duplicate, a
      test alarm taken in earnest — undeletable by anybody.)

    ⚠️ The deletion is logged at WARNING before it happens, because the audit chain that would
    otherwise record it is one of the things being deleted.
    """
    inc = await get_incident_or_404(db, incident_id)
    if await is_demo_deployment(db):
        raise HTTPException(status_code=403, detail="In der Demo können Einsätze nicht gelöscht werden.")
    # ⚠️ `exercise_since_creation`, not `is_exercise`: the flag is an Einsatzdaten field, so
    # «flip to Übung, then delete» used to hard-delete a real Einsatz without the key (RBAC audit
    # S1, 22.10.2026). A real Einsatz marked Übung later takes the admin door like any other.
    if not (inc.is_exercise and inc.exercise_since_creation):
        if not await _admin_session_valid(admin_session):
            raise HTTPException(
                status_code=403,
                detail="Nur als Übung angelegte Einsätze können gelöscht werden — ein echter Einsatz braucht die Verwaltung",
            )
        if not inc.is_archived:
            raise HTTPException(
                status_code=409, detail="Einsatz zuerst abschliessen — ein laufender Einsatz kann nicht gelöscht werden"
            )
        logger.warning(
            "ADMIN DELETE of a real incident %s (%r, started %s, archived=%s) — Verlauf, Prüfkette, "
            "Anwesenheit und Medien gehen mit.",
            inc.id,
            inc.title,
            inc.started_at,
            inc.is_archived,
        )
    from ..models import Media, WorkspaceSnapshot

    keys = list((await db.execute(select(Media.storage_key).where(Media.incident_id == incident_id))).scalars()) + list(
        (
            await db.execute(select(WorkspaceSnapshot.storage_key).where(WorkspaceSnapshot.incident_id == incident_id))
        ).scalars()
    )
    for key in keys:
        storage.delete_after_commit(db, key)
        # Cached waveform peaks ride next to the blob. It is harmless to queue the key for
        # photos/snapshots too: delete is deliberately idempotent for absent files.
        storage.delete_after_commit(db, key + ".peaks.json")
        # …and the list/marker thumbnail (api/media · _thumb_key). Same reasoning: delete is
        # idempotent for absent files, so queueing it for audio and snapshots costs nothing.
        storage.delete_after_commit(db, key + ".thumb.jpg")
    await db.delete(inc)
    await db.flush()
