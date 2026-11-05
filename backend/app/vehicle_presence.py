"""Vehicle presence, observed ONCE, by the server: «vor Ort» / «hat den Einsatzort verlassen».

Why this is server-side (24.09.2026, post-mortem of the Übung on 23.09.2026, design D2). The
client hook this replaces (`src/lib/useVehiclePresenceLog.ts`, deleted) ran on every editor
device and stamped a transition at the moment THAT device noticed it. #204 made its row ids
deterministic, so three tablets converged on one row — but the time on the row was still «when
some device woke up»: the trackers had the first three vehicles on scene at 19:23–19:24, the
Verlauf had all five at 19:43, the moment a tablet was unlocked. A vehicle's arrival is a fact
about the track, not about a screen, so the one process that sees every position whether or not
anybody is looking — the scheduler's 30 s sweep — records it.

⚠️ «The time» is the tracker's own report time: Traccar's `deviceTime` (`VehiclePosition.
last_update`), which is the device clock at the fix, not Traccar's `fixTime` and not the server's
receipt. A time in the FUTURE (a tracker with a wrong clock) is capped at the server's now — an
event dated after «now» would stop the replay short of it.

The rules are the client's, number for number (keep them identical — a mixed-version day
compares the two):

* ≤ ``AT_SCENE_M`` is «vor Ort», ≥ ``LEFT_M`` is «weg», the band between says nothing (it
  neither starts nor ends a state — see `zone_of`);
* a new zone has to hold for ``SETTLE_S`` before it counts, and the transition is stamped with
  the FIRST reading in the new zone;
* the first reading of a vehicle is a silent BASELINE, never a row: an Einsatz opened with the
  TLF already parked at the scene has no arrival time anybody can know.

What reaches the record (D2, ★ picks):

* one ``vehicle.presence`` audit event per transition (and one for the baseline), under the
  derived id ``vp:<device>:<n>`` — the machine record every later tick, restart or second
  worker rebuilds from and converges on;
* the Verlauf gets the FIRST arrival and the LAST departure per vehicle, nothing in between
  (D2-a): a vehicle shuttling to the depot has its runs counted («3 Fahrten») in
  `reportMeta.fahrzeuge[].gps` and shown in the vehicle table and the Rapport. «Last» is only
  known once the vehicle stays away, so a departure's row is written when the vehicle has been
  gone ``FINAL_AWAY_S`` — or when observation of the Einsatz ends — stamped with the departure's
  own time. The Verlauf orders by `at`, so the row stands where it happened;
* the Rapport's «vor Ort» clock (`reportMeta.fahrzeuge[].vorOrt`) through the same CAS the
  milestone webhook writes with (`api/alarms · cas_workspace`). FIRST WRITER WINS against the
  external geofence (D2-b), `manual` rows keep their time, and the server records that the
  clock is its own in ``gps.owns``. ⚠️ `zurueck` is NOT the server's: in the milestone vocabulary
  it means «back at the depot», which the geofence knows and the scene rings do not. The scene
  departure lives in ``gps.ab`` only (decided 25.09.2026).

Row ids are the server's own shape, ``vps-<n>-<zone>-gps-<device>``. A device still on the
previous build writes ``vp-<n>-<zone>-gps-<device>`` — an old row under that id must never
swallow the server's (the journal skips a known id), and a new one is dropped at the endpoint
(`api/journal · observed_by_server`).

«Active» (`observed_incidents`): open, not a Lern-Übung, with a real coordinate, and started OR worked on within
the last 24 h. «Worked on» is a human write — a journal row or an audit event that is not one of
the observers' own — so the observers never keep an Einsatz alive by themselves. When an open
Einsatz goes quiet for 24 h its observation ends with ONE Verlauf row (``obs-end-…``), and
resumes by itself as soon as somebody writes again.
"""

from __future__ import annotations

import logging
import uuid
from dataclasses import dataclass, field, replace
from datetime import UTC, datetime, timedelta
from typing import Literal

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from .geo_util import haversine_m
from .traccar import VehiclePosition

logger = logging.getLogger(__name__)

#: Inside this ring the vehicle is «vor Ort» (same number as the client hook it replaces).
AT_SCENE_M = 150.0
#: …and it has to get this far out before it counts as gone. The gap is hysteresis: one
#: threshold plus 30–40 m of GPS scatter writes arrivals and departures for a parked truck.
LEFT_M = 300.0
#: How long a new zone has to hold before it is a transition.
SETTLE_S = 90
#: How long a vehicle has to stay away before its departure is the LAST one — see the module
#: docstring. Longer than a shuttle run to the depot, short enough that the Verlauf has the row
#: while the Einsatz is still being worked.
FINAL_AWAY_S = 20 * 60
#: An open Einsatz nobody has written to for this long is no longer observed.
ACTIVE_WINDOW = timedelta(hours=24)
#: A closed Einsatz is still checked for owed departures this long after its last change.
CLOSE_OUT_WINDOW = timedelta(hours=48)

Zone = Literal["scene", "away"]

OP_TYPE = "vehicle.presence"
EVENT_SOURCE = "gps"
#: the observers' own audit sources (app/observations uses "weather") — not «activity»
OBSERVER_SOURCES = ("gps", "weather")
#: the observers' own Verlauf rows — not «activity» either (vps- presence, wxd- wind, obs- end)
SERVER_ROW_PREFIXES = ("vps-", "wxd-", "obs-")


def zone_of(distance_m: float) -> Zone | None:
    """The ring this reading is in, or None for the band between — «unchanged», not a zone."""
    if distance_m <= AT_SCENE_M:
        return "scene"
    if distance_m >= LEFT_M:
        return "away"
    return None


def vehicle_key(device_id: int) -> str:
    """The id the map gives the vehicle (`useVehiclePositions · toEntity`) — the row's
    `entityId`, so a tap on the row finds the vehicle."""
    return f"gps-{device_id}"


def row_id(n: int, zone: Zone, device_id: int) -> str:
    return f"vps-{n}-{zone}-{vehicle_key(device_id)}"


def event_id(device_id: int, n: int) -> str:
    return f"vp:{device_id}:{n}"


@dataclass(frozen=True)
class Presence:
    """What is known about one vehicle at one Einsatz."""

    zone: Zone
    #: transition number of the last recorded transition; 0 = only the baseline so far
    n: int
    #: stays on scene so far — a baseline «scene» is the first
    fahrten: int
    first_arrival: datetime | None = None
    last_departure: datetime | None = None
    #: a departure whose Verlauf row is not written yet (its time); None = nothing owed
    departure_owed: datetime | None = None
    #: the zone being settled into, its first reading (the stamp), and when the server saw it
    pending: Zone | None = None
    pending_fix: datetime | None = None
    pending_seen: datetime | None = None


@dataclass(frozen=True)
class Step:
    #: None only while a vehicle with no record has been read in the band
    state: Presence | None
    #: this reading established the baseline (record it; no row)
    baseline: bool = False
    #: this reading completed a transition into this zone
    transition: Zone | None = None


def step(state: Presence | None, distance_m: float, fix_at: datetime, now: datetime) -> Step:
    """Advance one vehicle by one reading. Pure; mirrors the client hook's state machine.

    `fix_at` is the tracker's report time (the stamp); `now` the server clock (the settle also
    completes on wall time, so a tracker that stops reporting once parked — Traccar re-serves its
    last position forever — still settles, exactly as it did on the devices).
    """
    zone = zone_of(distance_m)
    if zone is None:
        # the band: no state starts, no state ends
        return Step(replace(state, pending=None, pending_fix=None, pending_seen=None) if state else None)
    if state is None:
        return Step(Presence(zone=zone, n=0, fahrten=1 if zone == "scene" else 0), baseline=True)
    if zone == state.zone:
        return Step(replace(state, pending=None, pending_fix=None, pending_seen=None))
    if state.pending != zone or state.pending_fix is None or state.pending_seen is None:
        return Step(replace(state, pending=zone, pending_fix=fix_at, pending_seen=now))
    settled = (fix_at - state.pending_fix).total_seconds() >= SETTLE_S or (
        now - state.pending_seen
    ).total_seconds() >= SETTLE_S
    if not settled:
        return Step(state)
    at = state.pending_fix
    if zone == "scene":
        nxt = Presence(
            zone="scene",
            n=state.n + 1,
            fahrten=state.fahrten + 1,
            # the FIRST stay only: a vehicle that was already on scene when the Einsatz opened
            # (baseline «scene») and comes back from a trip has no arrival anybody can know
            first_arrival=state.first_arrival or (at if state.fahrten == 0 else None),
            last_departure=state.last_departure,
            # the vehicle came back: the departure before was a trip, not the last one
            departure_owed=None,
        )
    else:
        nxt = Presence(
            zone="away",
            n=state.n + 1,
            fahrten=state.fahrten,
            first_arrival=state.first_arrival,
            last_departure=at,
            departure_owed=at,
        )
    return Step(nxt, transition=zone)


def departure_due(state: Presence, now: datetime, *, closing: bool = False) -> bool:
    """Is the owed departure row due — the vehicle stayed away, or observation is ending?"""
    if state.zone != "away" or state.departure_owed is None:
        return False
    return closing or (now - state.departure_owed).total_seconds() >= FINAL_AWAY_S


def _iso(dt: datetime | None) -> str | None:
    return dt.isoformat() if dt else None


def _utc(dt: datetime) -> datetime:
    return dt if dt.tzinfo else dt.replace(tzinfo=UTC)


def _parse(raw: object) -> datetime | None:
    if not isinstance(raw, str) or not raw:
        return None
    try:
        return _utc(datetime.fromisoformat(raw))
    except ValueError:
        return None


def event_payload(p: VehiclePosition, state: Presence, vehicle: str | None) -> dict:
    """The event carries the whole state after the step, so the LAST event is a restart's
    complete memory (no fold over the chain needed). Nothing device-local, nothing that differs
    between two workers computing the same transition."""
    return {
        "device_id": p.device_id,
        "name": p.device_name,
        "vehicle": vehicle,
        "zone": state.zone,
        "n": state.n,
        "fahrten": state.fahrten,
        "first_arrival": _iso(state.first_arrival),
        "last_departure": _iso(state.last_departure),
    }


def state_from_event(payload: dict, *, departure_logged: bool) -> Presence | None:
    zone = payload.get("zone")
    if zone not in ("scene", "away"):
        return None
    last_departure = _parse(payload.get("last_departure"))
    return Presence(
        zone=zone,
        n=int(payload.get("n") or 0),
        fahrten=int(payload.get("fahrten") or 0),
        first_arrival=_parse(payload.get("first_arrival")),
        last_departure=last_departure,
        departure_owed=last_departure if zone == "away" and not departure_logged and last_departure else None,
    )


def fleet_vehicle_for(p: VehiclePosition, fleet: list) -> str | None:
    """The `fleet.vehicles[].id` this tracker is. The config's rule is «`id` equals the
    sender's device name»; compared without case (a Traccar name «TLF», an id «tlf»), and the
    label and the tracker's unique id are accepted too. None = not a station vehicle (a private
    tracker, a vehicle nobody configured) — no line in the Rapport's Fahrzeugzeiten, and its
    Verlauf rows only where the external geofence is not writing (see `_geofence_writes`)."""
    names = {n.strip().lower() for n in (p.device_name, p.unique_id) if n}
    for v in fleet:
        if v.id.strip().lower() in names or v.label.strip().lower() in names:
            return str(v.id)
    return None


# --- the blob ----------------------------------------------------------------------------


def apply_gps_presence(
    ws: dict | None, vehicle_id: str, state: Presence, device_id: int | None = None
) -> tuple[dict, bool, bool]:
    """Pure upsert of one vehicle's GPS presence into `reportMeta.fahrzeuge`.

    Writes the `gps` block (zone, an, ab, fahrten, device, owns — the vehicle table and the
    Rapport's «n Fahrten» read it) and the Rapport's «vor Ort» clock where the server may: only
    if nobody wrote it first, never on a `manual` row. Never `zurueck` (= back at the depot, the
    geofence's). Returns (new_ws, changed, arrival_is_ours) — the last says whether the Rapport's
    «vor Ort» is this observation's, i.e. whether the server's arrival row is not a duplicate of
    the geofence's «TLF vor Ort 19:23».
    """
    base = dict(ws or {})
    rm = dict(base.get("reportMeta") or {})
    fahrzeuge = [dict(v) for v in (rm.get("fahrzeuge") or []) if isinstance(v, dict)]
    cur = next((v for v in fahrzeuge if v.get("id") == vehicle_id), None)
    if cur is None:
        cur = {"id": vehicle_id}
        fahrzeuge.append(cur)
    before = dict(cur)
    prev_gps = cur.get("gps")
    prev_owns = prev_gps.get("owns") if isinstance(prev_gps, dict) else None
    owns = [f for f in (prev_owns or []) if f == "vorOrt"]
    if not cur.get("manual") and state.first_arrival is not None and (cur.get("vorOrt") is None or "vorOrt" in owns):
        cur["vorOrt"] = state.first_arrival.isoformat()
        if "vorOrt" not in owns:
            owns.append("vorOrt")
    gps: dict = {"zone": state.zone, "fahrten": state.fahrten}
    if device_id is not None:
        # the tracker, so the vehicle table can put the live report age beside the row
        gps["device"] = device_id
    if state.first_arrival:
        gps["an"] = state.first_arrival.isoformat()
    if state.last_departure:
        gps["ab"] = state.last_departure.isoformat()
    if owns:
        gps["owns"] = owns
    cur["gps"] = gps
    changed = cur != before
    arrival_ours = "vorOrt" in owns or bool(cur.get("manual"))
    rm["fahrzeuge"] = fahrzeuge
    base["reportMeta"] = rm
    return base, changed, arrival_ours


def keep_server_gps(workspace: dict, stored: dict | None) -> None:
    """The `gps` block of every `reportMeta.fahrzeuge` row is SERVER-OWNED: a client save carries
    whatever copy the device last saw (and the merge lets the device's version win), so the
    stored block is put back on every PUT — and a row a device dropped keeps its `gps` as a bare
    `{id, gps}` row. Covers an older client too, which knows nothing of the block. Mutates
    `workspace` in place (the body about to be stored)."""
    stored_rm = (stored or {}).get("reportMeta") if isinstance(stored, dict) else None
    stored_rows = stored_rm.get("fahrzeuge") if isinstance(stored_rm, dict) else None
    kept = {
        r["id"]: r["gps"]
        for r in (stored_rows if isinstance(stored_rows, list) else [])
        if isinstance(r, dict) and isinstance(r.get("id"), str) and isinstance(r.get("gps"), dict)
    }
    rm = workspace.get("reportMeta")
    incoming = rm.get("fahrzeuge") if isinstance(rm, dict) else None
    rows = incoming if isinstance(incoming, list) else []
    if not kept and not any(isinstance(r, dict) and "gps" in r for r in rows):
        return
    out: list = []
    seen: set = set()
    for r in rows:
        if not isinstance(r, dict):
            out.append(r)
            continue
        r = dict(r)
        seen.add(r.get("id"))
        if r.get("id") in kept:
            r["gps"] = kept[r["id"]]
        else:
            r.pop("gps", None)
        out.append(r)
    out.extend({"id": vid, "gps": gps} for vid, gps in kept.items() if vid not in seen)
    rm = dict(rm) if isinstance(rm, dict) else {}
    rm["fahrzeuge"] = out
    workspace["reportMeta"] = rm


# --- which Einsätze are observed ------------------------------------------------------------


@dataclass
class ObservedIncident:
    id: uuid.UUID
    lat: float
    lng: float
    last_activity: datetime


async def last_activity(db: AsyncSession, incident_id: uuid.UUID, started_at: datetime) -> datetime:
    """The last HUMAN write to an Einsatz: its start, its newest journal row or audit event that
    is not one of the observers' own. An observer's writes never count — otherwise the sweep
    would keep every never-closed Einsatz observed forever."""
    from sqlalchemy import and_, not_

    from .models import IncidentEvent, JournalEntry

    j = (
        await db.execute(
            select(func.max(JournalEntry.created_at)).where(
                JournalEntry.incident_id == incident_id,
                and_(*[not_(JournalEntry.client_id.like(f"{p}%")) for p in SERVER_ROW_PREFIXES]),
            )
        )
    ).scalar_one_or_none()
    e = (
        await db.execute(
            select(func.max(IncidentEvent.recorded_at)).where(
                IncidentEvent.incident_id == incident_id, IncidentEvent.source.not_in(OBSERVER_SOURCES)
            )
        )
    ).scalar_one_or_none()
    return max(_utc(t) for t in (started_at, j, e) if t is not None)


async def _open_incidents(db: AsyncSession, *, with_coordinate: bool) -> list[tuple]:
    """Every open Einsatz the observers watch — never a Lern-Übung (`models · LERN_UEBUNG_SOURCE`):
    the vehicles parked at the depot would write «vor Ort» rows into a tutorial seeded at the
    station's centre, and a drill must not consume the real presence (the `_state` baseline)."""
    from .models import INCIDENT_ACTIVE_STATUSES, LERN_UEBUNG_SOURCE, Incident

    q = select(Incident.id, Incident.lat, Incident.lng, Incident.started_at).where(
        Incident.is_archived.is_(False),
        Incident.status.in_(INCIDENT_ACTIVE_STATUSES),
        Incident.source != LERN_UEBUNG_SOURCE,
    )
    if with_coordinate:
        q = q.where(Incident.lat.is_not(None), Incident.lng.is_not(None))
    rows: list[tuple] = [
        tuple(r) for r in (await db.execute(q)).all() if not with_coordinate or (float(r[1]), float(r[2])) != (0.0, 0.0)
    ]
    # ⚠️ ONE order for every observer: each takes the incident row lock (journal/audit appends,
    # the blob CAS) and holds it until its commit, so two jobs walking the same Einsätze in
    # different orders could deadlock. Both walk them by id.
    return sorted(rows, key=lambda r: str(r[0]))


async def observed_incidents(db: AsyncSession, now: datetime) -> tuple[list[ObservedIncident], list[ObservedIncident]]:
    """(active, ended): open Einsätze with a real coordinate, split by whether a human wrote
    to them within ``ACTIVE_WINDOW``. Übungen included — the Übung is where this gets tested;
    Lern-Übungen not (`_open_incidents`)."""
    active: list[ObservedIncident] = []
    ended: list[ObservedIncident] = []
    for iid, lat, lng, started in await _open_incidents(db, with_coordinate=True):
        started = _utc(started)
        last = started if now - started < ACTIVE_WINDOW else await last_activity(db, iid, started)
        (active if now - last < ACTIVE_WINDOW else ended).append(ObservedIncident(iid, float(lat), float(lng), last))
    return active, ended


async def active_incidents(db: AsyncSession, now: datetime) -> list[ObservedIncident]:
    return (await observed_incidents(db, now))[0]


async def running_incident_exists(db: AsyncSession, now: datetime) -> bool:
    """An Einsatz is running — the Divera poll's cadence question. Same «active» as above, but
    no coordinate is asked for: a dispatch without a location still means «an Einsatz runs»."""
    for iid, _lat, _lng, started in await _open_incidents(db, with_coordinate=False):
        started = _utc(started)
        if now - started < ACTIVE_WINDOW or now - await last_activity(db, iid, started) < ACTIVE_WINDOW:
            return True
    return False


# --- the tick ----------------------------------------------------------------------------

#: (incident, device) → what is known; a key present with None = «no record, no reading yet
#: outside the band». ⚠️ Only ever changed by `Tick.commit`, AFTER the database committed: a
#: tick that fails rolls its writes back, and a memory that had moved on without them would
#: never write them (a lost arrival, found in review 25.09.2026).
_state: dict[tuple[str, int], Presence | None] = {}
#: Einsätze whose close-out (owed departures, the «observation ended» row) is done — so a
#: closed or quiet Einsatz costs one check, not one every 30 s. Dropped when it is active again.
_closed_out: set[str] = set()


def reset_state() -> None:
    """Forget everything in memory — a new scheduler leader starts from the record (and tests)."""
    _state.clear()
    _closed_out.clear()


@dataclass
class Tick:
    """What one tick wrote, and the memory it wants — applied only by `commit()`, which the
    caller runs after the database commit succeeded."""

    written: int = 0
    states: dict[tuple[str, int], Presence | None] = field(default_factory=dict)
    drop: set[tuple[str, int]] = field(default_factory=set)
    closed: set[str] = field(default_factory=set)
    live: set[str] = field(default_factory=set)

    def commit(self) -> None:
        for k in self.drop:
            _state.pop(k, None)
        _state.update(self.states)
        _closed_out.difference_update(self.live)
        _closed_out.update(self.closed)


async def _rebuild(db: AsyncSession, incident_id: uuid.UUID, device_id: int) -> Presence | None:
    """A cold memo (restart, new leader, failed tick) reads the LAST presence event back."""
    from .models import IncidentEvent

    ev = (
        await db.execute(
            select(IncidentEvent.payload_json)
            .where(
                IncidentEvent.incident_id == incident_id,
                IncidentEvent.op_type == OP_TYPE,
                IncidentEvent.client_id.like(f"vp:{device_id}:%"),
            )
            .order_by(IncidentEvent.seq.desc())
            .limit(1)
        )
    ).scalar_one_or_none()
    if not isinstance(ev, dict):
        return None
    logged = ev.get("zone") == "away" and await _row_exists(
        db, incident_id, row_id(int(ev.get("n") or 0), "away", device_id)
    )
    return state_from_event(ev, departure_logged=logged)


async def _row_exists(db: AsyncSession, incident_id: uuid.UUID, rid: str) -> bool:
    from .models import JournalEntry

    return (
        await db.execute(
            select(JournalEntry.id).where(JournalEntry.incident_id == incident_id, JournalEntry.client_id == rid)
        )
    ).first() is not None


async def _record_event(
    db: AsyncSession, incident_id: uuid.UUID, p: VehiclePosition, state: Presence, vehicle: str | None, at: datetime
) -> None:
    from . import audit

    try:
        await audit.append_event(
            db,
            incident_id=incident_id,
            op_type=OP_TYPE,
            source=EVENT_SOURCE,
            payload=event_payload(p, state, vehicle),
            occurred_at=at,
            client_id=event_id(p.device_id, state.n),
        )
    except audit.EventIdentityConflictError:
        # a second writer recorded this transition number first, with a different reading —
        # its record stands (first writer wins), and ours converges on it at the next rebuild
        logger.info("Presence event %s already recorded differently; keeping the first", event_id(p.device_id, state.n))


def _row(n: int, zone: Zone, device_id: int, at: datetime, label: str) -> dict:
    # German like every server-written row (api/journal · append_system_row): the Verlauf row
    # is the one string screen, paper and hash chain read, in the station's language.
    text = f"{label} vor Ort" if zone == "scene" else f"{label} hat den Einsatzort verlassen"
    return {
        "id": row_id(n, zone, device_id),
        "t": "",
        "at": at.isoformat(),
        "icon": "truck",
        "text": text,
        "kind": "symbol",
        "surface": "map",
        "entityId": vehicle_key(device_id),
    }


async def _store_blob(
    db: AsyncSession, incident_id: uuid.UUID, vehicle_id: str, state: Presence, device_id: int
) -> bool:
    """CAS the gps block into the blob; returns whether the Rapport's «vor Ort» is ours."""
    from .api.alarms import cas_workspace

    ours = False

    def mutate(ws: dict | None) -> tuple[dict, bool]:
        nonlocal ours
        new_ws, changed, ours = apply_gps_presence(ws, vehicle_id, state, device_id)
        return new_ws, changed

    await cas_workspace(db, incident_id, mutate)
    return ours


async def _geofence_writes(db: AsyncSession, incident_id: uuid.UUID) -> bool:
    """Is the external geofence writing vehicle times for this Einsatz? Then a tracker the
    config cannot name gets NO server row: the geofence may name it differently («TLF» where
    Traccar says «TLF 1») and has written its own «TLF vor Ort 19:23» already."""
    from .models import Incident

    ws = (await db.execute(select(Incident.map_workspace_json).where(Incident.id == incident_id))).scalar_one_or_none()
    rm = ws.get("reportMeta") if isinstance(ws, dict) else None
    rows = rm.get("fahrzeuge") if isinstance(rm, dict) else None
    for r in rows if isinstance(rows, list) else []:
        if not isinstance(r, dict) or r.get("manual"):
            continue
        gps = r.get("gps")
        owns = (gps.get("owns") if isinstance(gps, dict) else None) or []
        if r.get("ausgerueckt") or r.get("zurueck") or (r.get("vorOrt") and "vorOrt" not in owns):
            return True
    return False


def _label(vehicle: str | None, name: str, fleet: list) -> str:
    return next((str(v.label) for v in fleet if v.id == vehicle), None) or name


async def _close_out(db: AsyncSession, inc_id: uuid.UUID, fleet: list, *, still_open: bool, last: datetime) -> int:
    """Observation of this Einsatz has ended (closed, archived, or 24 h without a human write).
    Write every departure still owed — from the RECORD, so a restart in between loses none —
    and, for an Einsatz that is still open, ONE row saying the observation ended."""
    from .api.journal import append_rows
    from .models import IncidentEvent

    written = 0
    events = (
        await db.execute(
            select(IncidentEvent.payload_json)
            .where(IncidentEvent.incident_id == inc_id, IncidentEvent.op_type == OP_TYPE)
            .order_by(IncidentEvent.seq.desc())
        )
    ).scalars()
    latest: dict[int, dict] = {}
    for ev in events:
        if isinstance(ev, dict) and isinstance(ev.get("device_id"), int):
            latest.setdefault(ev["device_id"], ev)
    geofence: bool | None = None
    rows: list[dict] = []
    for device_id, ev in sorted(latest.items()):
        left = _parse(ev.get("last_departure"))
        if ev.get("zone") != "away" or left is None:
            continue
        rid = row_id(int(ev.get("n") or 0), "away", device_id)
        if await _row_exists(db, inc_id, rid):
            continue
        if not ev.get("vehicle"):
            geofence = await _geofence_writes(db, inc_id) if geofence is None else geofence
            if geofence:
                continue
        rows.append(
            _row(int(ev.get("n") or 0), "away", device_id, left, _label(ev.get("vehicle"), str(ev.get("name")), fleet))
        )
    if still_open:
        observed = (
            await db.execute(
                select(IncidentEvent.id)
                .where(IncidentEvent.incident_id == inc_id, IncidentEvent.source.in_(OBSERVER_SOURCES))
                .limit(1)
            )
        ).first()
        if observed is not None:
            ended = last + ACTIVE_WINDOW
            rows.append(
                {
                    # one per quiet spell: a later write re-activates it, a later quiet ends it anew
                    "id": "obs-end-" + "".join(c for c in last.isoformat() if c.isdigit())[:14],
                    "t": "",
                    "at": ended.isoformat(),
                    "icon": "history",
                    "text": "Automatische Beobachtung beendet (24 h ohne Eintrag): Fahrzeug-GPS und Wetter "
                    "werden nicht mehr erfasst, bis wieder etwas eingetragen wird",
                }
            )
    if rows:
        written += len(await append_rows(db, inc_id, rows))
    return written


async def _closeout_candidates(db: AsyncSession, now: datetime, ended: list[ObservedIncident]) -> list[tuple]:
    """(id, still_open, last_activity) of every Einsatz whose observation has ended and whose
    close-out is not done yet: the quiet open ones, and the ones closed recently."""
    from .models import INCIDENT_ACTIVE_STATUSES, Incident

    out = [(i.id, True, i.last_activity) for i in ended if str(i.id) not in _closed_out]
    closed = (
        await db.execute(
            select(Incident.id, Incident.updated_at).where(
                (Incident.is_archived.is_(True)) | (Incident.status.not_in(INCIDENT_ACTIVE_STATUSES)),
                Incident.updated_at >= now - CLOSE_OUT_WINDOW,
            )
        )
    ).all()
    out += [(iid, False, _utc(upd)) for iid, upd in closed if str(iid) not in _closed_out]
    return out


async def observe(db: AsyncSession, positions: list[VehiclePosition], now: datetime) -> Tick:
    """One tick: close out what stopped being observed, advance every vehicle at every active
    Einsatz, write what became true. The caller commits, THEN calls `tick.commit()` — see
    `_state`. Works through the Einsätze in id order (see `_open_incidents`)."""
    from .alarms import get_config_model

    tick = Tick()
    active, ended = await observed_incidents(db, now)
    tick.live = {str(i.id) for i in active}
    tick.drop = {k for k in _state if k[0] not in tick.live}
    candidates = await _closeout_candidates(db, now, ended)
    fleet: list = (await get_config_model(db)).fleet.vehicles if (candidates or (active and positions)) else []

    actives = {str(i.id): i for i in active}
    closing = {str(c[0]): c for c in candidates}
    for key in sorted(actives.keys() | closing.keys()):
        if key in actives:
            tick.written += await _observe_incident(db, tick, actives[key], positions, fleet, now)
        else:
            iid, still_open, last = closing[key]
            tick.written += await _close_out(db, iid, fleet, still_open=still_open, last=last)
            tick.closed.add(key)
    return tick


async def _observe_incident(
    db: AsyncSession, tick: Tick, inc: ObservedIncident, positions: list[VehiclePosition], fleet: list, now: datetime
) -> int:
    from .api.journal import append_rows

    written = 0
    geofence: bool | None = None
    for p in positions:
        key = (str(inc.id), p.device_id)
        # the tracker's clock, never ahead of ours (a future stamp would stop the replay short)
        fix = min(_utc(p.last_update), now)
        vehicle = fleet_vehicle_for(p, fleet)
        label = _label(vehicle, p.device_name, fleet)
        before = _state[key] if key in _state else await _rebuild(db, inc.id, p.device_id)
        res = step(before, haversine_m(inc.lat, inc.lng, p.latitude, p.longitude), fix, now)
        st = res.state
        if vehicle is None and (res.transition or (st is not None and departure_due(st, now))):
            geofence = await _geofence_writes(db, inc.id) if geofence is None else geofence
        rows_allowed = vehicle is not None or not geofence
        if res.baseline and st is not None:
            await _record_event(db, inc.id, p, st, vehicle, fix)
            # a vehicle that has never been on scene has no line in this Einsatz's table —
            # every station vehicle starts as «away» from every open Einsatz
            if vehicle and st.fahrten:
                await _store_blob(db, inc.id, vehicle, st, p.device_id)
            written += 1
        elif res.transition and st is not None:
            # the stamp is the FIRST reading in the new zone, not the one that settled it
            stamp = before.pending_fix if before and before.pending_fix else fix
            await _record_event(db, inc.id, p, st, vehicle, stamp)
            written += 1
            arrival_ours = True
            if vehicle and st.fahrten:
                arrival_ours = await _store_blob(db, inc.id, vehicle, st, p.device_id)
            # the FIRST arrival is a Verlauf row; every later one is a trip (D2-a) — unless the
            # external geofence already wrote «TLF vor Ort …» for this vehicle
            if res.transition == "scene" and st.first_arrival == stamp and arrival_ours and rows_allowed:
                written += len(await append_rows(db, inc.id, [_row(st.n, "scene", p.device_id, stamp, label)]))
        if st is not None and departure_due(st, now):
            if rows_allowed and st.departure_owed is not None:
                written += len(
                    await append_rows(db, inc.id, [_row(st.n, "away", p.device_id, st.departure_owed, label)])
                )
            st = replace(st, departure_owed=None)
        tick.states[key] = st
    return written
