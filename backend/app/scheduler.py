"""APScheduler jobs with PostgreSQL-backed singleton leadership.

Started/stopped from the FastAPI lifespan. Only the process holding the deployment-wide
advisory lock runs jobs; standby replicas retry and take over after leader failure.
"""

import asyncio
import logging
import time
from contextlib import suppress
from datetime import UTC, datetime, timedelta
from zoneinfo import ZoneInfo

import httpx
from apscheduler.schedulers.asyncio import AsyncIOScheduler
from apscheduler.triggers.cron import CronTrigger
from fastapi import FastAPI
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncConnection, AsyncSession

from .config import settings
from .database import async_session_maker, engine, execute_dml
from .models import INCIDENT_ACTIVE_STATUSES, LERN_UEBUNG_SOURCE

logger = logging.getLogger(__name__)

_scheduler: AsyncIOScheduler | None = None
#: The jobs that run in EVERY serving process, leader or standby — see `_start_process_jobs`.
_process_scheduler: AsyncIOScheduler | None = None
_scheduler_leader_connection: AsyncConnection | None = None
_leadership_task: asyncio.Task[None] | None = None

# Session-level PostgreSQL advisory lock. It belongs to the dedicated connection below,
# so PostgreSQL releases it atomically when the leader exits or loses the connection.
# Decimal value of the ASCII bytes ``KPFRONT``; fixed forever so every release competes
# for the same lock during a rolling deploy.
SCHEDULER_ADVISORY_LOCK_ID = int.from_bytes(b"KPFRONT", "big")
SCHEDULER_LEADERSHIP_RETRY_SECONDS = 10


#: How often the integration-credential snapshot is refreshed from the database.
#:
#: The jobs below are all registered UNCONDITIONALLY now (see `start_scheduler`), because a
#: credential set in the browser must start working without a restart — and a job that was
#: never scheduled cannot start working at all. Each one instead checks its own credential on
#: every tick and returns immediately when there is none, which is what makes «configured
#: while I was already running» a state they handle rather than a state they miss.
CREDENTIALS_REFRESH_SECONDS = 30


async def _refresh_credentials() -> None:
    """Keep the process-wide credential snapshot warm for the SYNCHRONOUS readers.

    Request paths await `credentials.load(db)` themselves and are never stale. This exists
    for the readers that have no session to await with — `push_enabled()`, the Traccar
    client, the provider registry — so that a value written by another process (or before
    this one booted) reaches them within half a minute rather than at the next deploy.
    """
    from .credentials import load

    try:
        await load(force=True)
    except Exception:  # noqa: BLE001 — a stale snapshot is survivable, a wedged scheduler is not
        logger.warning("Credential refresh failed (keeping the previous snapshot)", exc_info=True)


async def _poll_divera() -> None:
    """Poll Divera for new alarms, and record whether the connector is still alive.

    ⚠️ The connector state is written on BOTH outcomes, and the webhook writes the same row on a
    successful delivery (api/divera · webhook) — the webhook is the primary intake and the poll
    is the fallback, so a station whose webhook is healthy must not read as stale here.
    """
    global _divera_backoff_s, _divera_backoff_until
    from . import connector_state
    from .credentials import get as credential
    from .credentials import load as load_credentials
    from .divera import DiveraApiError, fetch_and_upsert

    async with async_session_maker() as db:
        # Re-read every tick: the key may have been set in the browser since boot, and may
        # have been cleared since the last tick.
        await load_credentials(db)
        if not credential("divera_access_key"):
            return
        try:
            new = await fetch_and_upsert(db)
            await connector_state.record(
                db, connector_state.DIVERA_ALARMS, ok=True, detail={"trigger": "poll", "new": new}
            )
            await db.commit()
            _divera_backoff_s = 0.0
            if new:
                logger.info("Divera poll: %d new alarm(s)", new)
        except Exception as e:  # never let diagnostics wedge the scheduler
            await db.rollback()
            if isinstance(e, DiveraApiError) and e.status_code == 429:
                # Divera says we poll too hard: back off, doubling, capped — the webhook is the
                # primary intake and keeps delivering meanwhile.
                _divera_backoff_s = min(
                    DIVERA_BACKOFF_MAX_SECONDS, (_divera_backoff_s * 2) or DIVERA_BACKOFF_BASE_SECONDS
                )
                _divera_backoff_until = _divera_now() + _divera_backoff_s
                logger.warning("Divera poll rate-limited (429); next poll in %ds", int(_divera_backoff_s))
            else:
                logger.exception("Divera poll failed")
            await connector_state.record_failure(db, connector_state.DIVERA_ALARMS, e)


#: The Divera poll's two cadences (24.09.2026, D2). Every editor device used to POST
#: `/divera/pool/refresh` every 30 s, even with no Einsatz open — 469 Divera calls in one Übung.
#: The devices now only READ the pool, and the server alone polls: every 30 s while NO Einsatz is
#: running (the fallback that brings a dispatch the webhook missed within half a minute), at the
#: configured `divera_poll_interval_seconds` (120 s) while one is — the dispatch is in, and the
#: webhook, which stays the primary intake, carries the rest. For the first 10 min after an alarm
#: the fast cadence stays on although the Einsatz runs: the crew's Rückmeldungen ride in this poll
#: (divera · RESPONSE_WINDOW_SECONDS).
DIVERA_IDLE_POLL_SECONDS = 30
#: On a 429 the poll waits BASE, then doubles per further 429, up to MAX; a success resets it.
DIVERA_BACKOFF_BASE_SECONDS = 60.0
DIVERA_BACKOFF_MAX_SECONDS = 900.0

_divera_last_poll: float | None = None
_divera_backoff_s = 0.0
_divera_backoff_until = 0.0


def _divera_now() -> float:
    """The cadence's clock (monotonic; a module function so a test can move it)."""
    return time.monotonic()


def divera_tick_seconds() -> int:
    return max(1, min(DIVERA_IDLE_POLL_SECONDS, settings.divera_poll_interval_seconds))


#: How often the stored Rückmeldungen are swept for ones nobody may read any more
#: (divera · prune_responses). Runs whether or not a key is set: a key removed after an Einsatz
#: must not keep that Einsatz's notes forever.
DIVERA_PRUNE_SECONDS = 600
_divera_last_prune: float | None = None


async def _prune_divera_responses() -> None:
    global _divera_last_prune
    from .divera import prune_responses

    clock = _divera_now()
    if _divera_last_prune is not None and clock - _divera_last_prune < DIVERA_PRUNE_SECONDS:
        return
    _divera_last_prune = clock
    async with async_session_maker() as db:
        try:
            cleared = await prune_responses(db, datetime.now(UTC))
            await db.commit()
            if cleared:
                logger.info("Divera Rückmeldungen cleared on %d alarm(s) (Einsatz over or past retention)", cleared)
        except Exception:  # noqa: BLE001 — a failed sweep is retried on the next one
            await db.rollback()
            logger.warning("Clearing Divera Rückmeldungen failed", exc_info=True)


async def _divera_tick() -> None:
    """Decide whether this tick polls Divera: backed off, or not due at the current cadence."""
    global _divera_last_poll
    from .vehicle_presence import running_incident_exists

    await _prune_divera_responses()
    clock = _divera_now()
    if clock < _divera_backoff_until:
        return
    from .divera import response_window_open

    async with async_session_maker() as db:
        try:
            now = datetime.now(UTC)
            running = await running_incident_exists(db, now)
            # …except while the crew is still answering the alarm (divera · RESPONSE_WINDOW_SECONDS)
            if running and await response_window_open(db, now):
                running = False
        except Exception:  # noqa: BLE001 — unsure is «running»: the slower, cheaper cadence
            logger.warning("Divera cadence check failed; polling at the running cadence", exc_info=True)
            running = True
    due = max(settings.divera_poll_interval_seconds, DIVERA_IDLE_POLL_SECONDS) if running else DIVERA_IDLE_POLL_SECONDS
    # a tick's own jitter must not skip a due poll: «due» means «within a second of it»
    if _divera_last_poll is not None and clock - _divera_last_poll < due - 1:
        return
    _divera_last_poll = clock
    await _poll_divera()


async def _push_sweep() -> None:
    from .credentials import load as load_credentials
    from .push import check_and_push, push_enabled

    async with async_session_maker() as db:
        await load_credentials(db)
        if not push_enabled():
            return  # no VAPID pair yet — the in-app tone/notification path is unaffected
        try:
            sent = await check_and_push(db)
            await db.commit()
            if sent:
                logger.info("Push sweep: %d alert(s) sent", sent)
        except Exception:
            await db.rollback()
            logger.exception("Push sweep failed")


async def _auto_archive_sweep() -> None:
    from .alarms import auto_archive_sweep

    async with async_session_maker() as db:
        try:
            n = await auto_archive_sweep(db)
            await db.commit()
            if n:
                logger.info("Auto-archive sweep: %d incident(s)", n)
        except Exception:
            await db.rollback()
            logger.exception("Auto-archive sweep failed")


async def _object_footprints_tick() -> None:
    """«Karte & Objekte»: ask the official sources about objects that have no buildings yet
    (app/object_footprints). Idle once every object has been asked; off when either source URL
    is empty."""
    from .houses import tick as houses_tick
    from .object_footprints import tick
    from .underground import tick as underground_tick

    async with async_session_maker() as db:
        try:
            await tick(db)
        except Exception:
            logger.exception("Object footprint tick failed")
        # the region's underground buildings ride the same job (app/underground): idle but for
        # one small read until the stored set is a week old
        try:
            await underground_tick(db)
        except Exception:
            logger.exception("Underground buildings tick failed")
        # …and the region's houses, one footprint each, for a building tap (app/houses): the same
        # area, idle the same way
        try:
            await houses_tick(db)
        except Exception:
            logger.exception("Houses tick failed")


async def _plan_pull() -> None:
    from .plans import pull_plans

    async with async_session_maker() as db:
        try:
            res = await pull_plans(db)
            await db.commit()
            if res.get("updated"):
                logger.info("Objektplan-Pull: %s plan(s) updated", res["updated"])
        except Exception:
            await db.rollback()
            logger.exception("Objektplan-Pull failed")


#: How often the alignment worker looks for pending plan-preparation jobs. The tick is cheap
#: (one indexed claim query) when the queue is empty; when plans arrive it drains up to
#: PLAN_ALIGNMENT_BATCH per tick so a bulk import prepares steadily without monopolising the
#: process — each job renders one PDF and runs one CV match.
PLAN_ALIGNMENT_TICK_SECONDS = 10
PLAN_ALIGNMENT_BATCH = 20


async def _plan_alignment_tick() -> None:
    from .plan_alignment_worker import run_once

    try:
        for _ in range(PLAN_ALIGNMENT_BATCH):
            if not await run_once():
                break
    except Exception:
        logger.exception("Plan alignment worker tick failed")


#: The tile pyramids (app/plan_tiles): one tick advances ONE revision by a few seconds of PDFium,
#: so a bulk import fills steadily and a Rapport never waits behind a whole sheet. Idle, the tick
#: is one query and no file access (the settled keys are remembered per process).
PLAN_TILES_TICK_SECONDS = 15


async def _plan_tiles_tick() -> None:
    from .plan_tiles import fill_once

    try:
        await fill_once()
    except Exception:
        logger.exception("Plan tile fill tick failed")


#: How often the SharePoint pull ticks. NOT the poll interval — the station's own cadence lives
#: in the config document (`sharepoint.intervalMinutes`), which an admin can change from the
#: browser, and a job registered at boot could not follow it. So the timer is fixed and short
#: and the job decides on each tick whether enough time has passed. A tick with nothing to do
#: is one cached credential lookup and one already-loaded config row.
SHAREPOINT_TICK_SECONDS = 60

#: When the last run started, per process. In memory rather than queried back for the same
#: reason `_last_sample` is: the question is «did WE run recently», the answer is worth nothing
#: after a restart, and the cost of getting it wrong is one extra poll of a folder.
_sharepoint_last_run: datetime | None = None


async def _sharepoint_pull() -> None:
    """Pull the station's SharePoint folders, at the cadence the config asks for.

    ⚠️ Registered unconditionally and idle without credentials, like the four jobs above and for
    the same reason: the tenant id, the client id and the secret are all set FROM THE BROWSER,
    so a job gated at boot would never run on the station that just configured it — «I entered
    the keys and nothing happened» until the next deploy.
    """
    global _sharepoint_last_run
    from .credentials import load as load_credentials
    from .sharepoint_sync import sharepoint_credentials, sharepoint_settings, sync_sharepoint

    async with async_session_maker() as db:
        await load_credentials(db)
        if sharepoint_credentials() is None:
            return
        try:
            config = await sharepoint_settings(db)
            if not config.sources:
                return
            due = timedelta(minutes=max(1, config.intervalMinutes))
            now = datetime.now(UTC)
            if _sharepoint_last_run is not None and now - _sharepoint_last_run < due:
                return
            _sharepoint_last_run = now
            res = await sync_sharepoint(db)
            # ⚠️ ONE commit, and it persists the state rows as much as the imported data. An
            # area that failed does NOT reach here as an exception any more — it rolled back its
            # own writes inside a savepoint (sharepoint_sync · _sync_one) and reports `error`,
            # so the rollback below can no longer take three healthy areas and every area's
            # report down with the fourth.
            await db.commit()
            areas: dict[str, dict] = res.get("areas", {})
            imported = sum(a.get("imported", 0) for a in areas.values())
            if imported:
                logger.info("SharePoint-Pull: %d file(s) imported", imported)
            for area, report in areas.items():
                if report.get("status") not in ("ok", "unchanged"):
                    logger.warning(
                        "SharePoint-Pull: %s is %s — %s",
                        area,
                        report.get("status"),
                        report.get("detail") or "no detail",
                    )
        except Exception:
            await db.rollback()
            logger.exception("SharePoint-Pull failed")


#: The Objektbesuche delivery outbox (app/object_visit_delivery). Registered unconditionally and
#: idle while the module is off, no destination is enabled or the `sharepoint_export` credentials
#: are incomplete — all three are set from the browser.
OBJECT_VISIT_DELIVERY_TICK_SECONDS = 30


async def _object_visit_delivery_tick() -> None:
    from .object_visit_delivery import tick

    try:
        await tick()
    except Exception:
        logger.exception("Objektbesuche delivery tick failed")


#: The Einsatz-Ablage outbox (app/incident_archive, docs/incident-archive.md). Registered
#: unconditionally like the Objektbesuche one, idle while it is off or the credentials are incomplete.
INCIDENT_ARCHIVE_TICK_SECONDS = 30


async def _incident_archive_tick() -> None:
    from .incident_archive import tick

    try:
        await tick()
    except Exception:
        logger.exception("Einsatz-Ablage tick failed")


PRINT_JOB_RETENTION_DAYS = 7  # the paper is the artefact — the queue is transient
PRINT_JOB_SWEEP_SECONDS = 3600


async def _print_jobs_sweep() -> None:
    from sqlalchemy import delete

    from .models import PrintJob

    # Not gated on the relay secret: every row is a full Rapport-PDF with names in it, and a
    # station that switched the relay off must still lose them after the retention window.
    async with async_session_maker() as db:
        try:
            cutoff = datetime.now(UTC) - timedelta(days=PRINT_JOB_RETENTION_DAYS)
            res = await execute_dml(db, delete(PrintJob).where(PrintJob.created_at < cutoff))
            await db.commit()
            if res.rowcount:
                logger.info("Print-job sweep: %d job(s) removed", res.rowcount)
        except Exception:
            await db.rollback()
            logger.exception("Print-job sweep failed")


#: How often the vehicle feed is sampled into the incident record. Not the 15 s the map polls
#: at: this is a TRACK for the replay, and half-minute resolution draws the same route with a
#: fraction of the rows.
VEHICLE_SAMPLE_SECONDS = 30

#: A vehicle that has not moved this far is not sampled again — a fleet parked at the Magazin
#: would otherwise write a row per truck every 30 s for the whole Einsatz, and the replay would
#: scrub through hours of nothing. Roughly GPS noise plus a truck length.
VEHICLE_SAMPLE_MIN_MOVE_M = 20.0

#: …but a stationary vehicle still gets one row this often, so a replay can tell «parked here
#: the whole time» from «we stopped hearing from it». Measured in DEVICE time, like the move
#: threshold — see the note in the sweep.
VEHICLE_SAMPLE_HEARTBEAT_SECONDS = 600

#: What we last wrote per (incident, device): the device fix time and where it was.
#:
#: In memory rather than queried back, because the question is «what did WE last record for
#: this device», and the table cannot answer it — `VehicleSample.ts` is the DEVICE's fix time,
#: which for a parked tracker stops advancing and can be hours behind the wall clock. The first
#: version asked the table with a `ts >= now - 20min` filter and compared against `ts`, so a
#: parked vehicle matched nothing and looked permanently stale: it wrote a row on every single
#: tick, 8 rows a minute across the fleet, every one at an identical position. A restart simply
#: costs one extra row per vehicle, which is honest — it is where things stood when we came up.
_last_sample: dict[tuple[str, int], tuple[datetime, float, float]] = {}


async def _vehicle_samples_sweep() -> None:
    """Record where the vehicles were, so the Verlauf can replay them.

    This is the job `api/events.samples` has been reading an empty table for: the endpoint, the
    schema and the client-side replay all shipped, and nothing ever wrote a row
    (PLAN-audit-trail §4, Phase 6). Vehicles are station assets, not people — unlike the
    self-reported crew positions this one IS a history, kept with the incident and cascading
    with it.

    It is also where the Traccar connector reports its health — the feed is polled here and
    nowhere else on a timer. ⚠️ Those writes are THROTTLED (``TRACCAR_THROTTLE_SECONDS``): this
    job ticks every 30 s, and «still working» is not a fact that changes twice a minute. A
    transition is never throttled, so the first failure after a run of successes lands at once.

    And since 24.09.2026 it is where «vor Ort» / «hat den Einsatzort verlassen» are OBSERVED
    (`app.vehicle_presence`) — once, by the server, on the GPS fix time — instead of by whichever
    device happened to be awake. The feed is `traccar.fleet_positions`: Traccar, or the injected
    fake fleet on a dev/demo deployment (which never reached this job before, so none of this
    could be exercised without real trackers).
    """
    from sqlalchemy import select

    from . import connector_state
    from .credentials import load as load_credentials
    from .geo_util import haversine_m
    from .models import Incident, VehicleSample
    from .traccar import fleet_positions, fleet_source

    async with async_session_maker() as db:
        # ⚠️ The configured-check moved INSIDE the job (it used to gate registration in
        # `start_scheduler`). A station that connects Traccar from the browser gets its
        # vehicle track from the next tick instead of the next restart.
        await load_credentials(db)
        source = fleet_source()
        now = datetime.now(UTC)
        if source is None:
            # no feed — but an Einsatz that closed may still owe its vehicles' last departures,
            # and a quiet one its «observation ended» row (the feed may have been switched off)
            await _observe_presence(db, [], now)
            return
        try:
            open_ids = list(
                (
                    await db.execute(
                        select(Incident.id).where(
                            Incident.is_archived.is_(False),
                            Incident.status.in_(INCIDENT_ACTIVE_STATUSES),
                            # no track in a tutorial (models · LERN_UEBUNG_SOURCE)
                            Incident.source != LERN_UEBUNG_SOURCE,
                        )
                    )
                ).scalars()
            )
            if not open_ids:
                # nothing was asked of Traccar, so there is nothing to report about it — but an
                # Einsatz that just closed may still owe its vehicles' last departures
                await _observe_presence(db, [], now)
                return
            positions = await fleet_positions()
            if source == "traccar":
                # The feed answered — that is the health question, whether or not any tracker
                # had something to say. The count goes on the card so «connected but nobody
                # reporting» is legible as itself rather than as a green tick with an empty map.
                # (The fake fleet is not Traccar and says nothing about it.)
                await connector_state.record(
                    db,
                    connector_state.TRACCAR,
                    ok=True,
                    detail={"vehicles": len(positions)},
                    throttle_seconds=connector_state.TRACCAR_THROTTLE_SECONDS,
                )
            if not positions:
                await db.commit()
                await _observe_presence(db, [], now)
                return

            live = {str(i) for i in open_ids}
            for key in [k for k in _last_sample if k[0] not in live]:
                del _last_sample[key]  # an Einsatz that ended takes its memo with it

            written = 0
            for incident_id in open_ids:
                for p in positions:
                    key = (str(incident_id), p.device_id)
                    ts = p.last_update if p.last_update.tzinfo else p.last_update.replace(tzinfo=UTC)
                    prev = _last_sample.get(key)
                    if prev is None:
                        # Cold memo — a restart, or the first tick of a new Einsatz. Seed it from
                        # the newest row we already have for this device, or the deploy would
                        # re-record whatever fix the tracker is currently repeating and put a
                        # duplicate of it in the track. No time filter: the whole point is that a
                        # parked tracker's fix can be arbitrarily old.
                        seed = (
                            await db.execute(
                                select(VehicleSample.ts, VehicleSample.lat, VehicleSample.lng)
                                .where(
                                    VehicleSample.incident_id == incident_id,
                                    VehicleSample.device_id == p.device_id,
                                )
                                .order_by(VehicleSample.ts.desc())
                                .limit(1)
                            )
                        ).first()
                        if seed is not None:
                            seed_ts = seed[0] if seed[0].tzinfo else seed[0].replace(tzinfo=UTC)
                            prev = (seed_ts, float(seed[1]), float(seed[2]))
                            _last_sample[key] = prev
                    if prev is not None:
                        prev_ts, prev_lat, prev_lng = prev
                        # Nothing NEW from the device — Traccar re-serves the last fix on every
                        # poll, and re-recording it would stamp the same instant again and again.
                        # This is also what makes «we stopped hearing from it» legible: the track
                        # simply stops, instead of filling with copies of its final position.
                        if ts <= prev_ts:
                            continue
                        moved = haversine_m(prev_lat, prev_lng, p.latitude, p.longitude)
                        elapsed = (ts - prev_ts).total_seconds()
                        if moved < VEHICLE_SAMPLE_MIN_MOVE_M and elapsed < VEHICLE_SAMPLE_HEARTBEAT_SECONDS:
                            continue
                    db.add(
                        VehicleSample(
                            incident_id=incident_id,
                            device_id=p.device_id,
                            ts=ts,
                            lat=p.latitude,
                            lng=p.longitude,
                            course=p.course,
                            speed=p.speed,
                        )
                    )
                    _last_sample[key] = (ts, p.latitude, p.longitude)
                    written += 1
            await db.commit()
            if written:
                logger.info("Vehicle samples: %d row(s) recorded", written)
        except Exception as e:
            await db.rollback()
            logger.exception("Vehicle sample sweep failed")
            if source == "traccar":
                await connector_state.record_failure(
                    db, connector_state.TRACCAR, e, throttle_seconds=connector_state.TRACCAR_THROTTLE_SECONDS
                )
            return
        # After the samples are committed, in its own transaction: a presence failure must not
        # cost the replay its track.
        await _observe_presence(db, positions, now)


async def _observe_presence(db: AsyncSession, positions: list, now: datetime) -> None:
    """«vor Ort» / «verlassen» for every vehicle at every active Einsatz (app.vehicle_presence).
    ⚠️ The scheduler's advisory lock makes this ONE writer per deployment; the derived ids
    (`vp:<device>:<n>`, `vps-<n>-<zone>-gps-<device>`) make a second one harmless anyway.
    ⚠️ The tick's memory is applied only AFTER the commit (`Tick.commit`): a failed tick leaves
    both the database and the memory where they were, so the next tick writes what it missed."""
    from .vehicle_presence import observe

    try:
        tick = await observe(db, positions, now)
        await db.commit()
        tick.commit()
        if tick.written:
            logger.info("Vehicle presence: %d record(s) written", tick.written)
    except Exception:
        await db.rollback()
        logger.exception("Vehicle presence sweep failed")


async def _weather_sweep() -> None:
    """The weather at every active Einsatz, observed once per reading, and the wind shift it
    implies (app.observations). Registered unconditionally; a no-op without an active Einsatz
    with a coordinate, or with the weather providers unconfigured."""
    from .observations import observe_weather
    from .weather import weather_client

    if not weather_client.is_configured:
        return
    async with async_session_maker() as db:
        try:
            n = await observe_weather(db, datetime.now(UTC))
            await db.commit()
            if n:
                logger.info("Weather observations: %d record(s) written", n)
        except Exception:
            await db.rollback()
            logger.exception("Weather observation sweep failed")


POSITION_SWEEP_SECONDS = 3600


async def _visit_hashes_sweep() -> None:
    """Drop the per-day visitor hashes past ``visits.RETAIN_DAYS``. The counters stay.

    A no-op on every deployment where VISIT_STATS is off, which is every station — the table
    is empty there. The rows are already inert after their own day (their salt is gone), so
    this is housekeeping rather than the privacy control; ``visit_stats`` is the record.
    """
    from . import visits

    async with async_session_maker() as db:
        try:
            removed = await visits.prune(db)
            await db.commit()
            if removed:
                logger.info("Visit sweep: %d dedup row(s) removed", removed)
        except Exception:
            await db.rollback()
            logger.exception("Visit sweep failed")


async def _positions_sweep() -> None:
    """Drop self-reported crew positions that have gone quiet (`position_ttl_hours`).

    Closing the Einsatz already deletes them; this is the backstop for the one nobody ever
    closes, so a name-and-coordinate pair can't sit in the database for days after the phone
    that reported it went home. The row is the only copy — there is no history to keep.
    """
    from sqlalchemy import delete

    from .models import PersonPosition

    async with async_session_maker() as db:
        try:
            cutoff = datetime.now(UTC) - timedelta(hours=settings.position_ttl_hours)
            res = await execute_dml(db, delete(PersonPosition).where(PersonPosition.updated_at < cutoff))
            await db.commit()
            if res.rowcount:
                logger.info("Position sweep: %d stale position(s) removed", res.rowcount)
        except Exception:
            await db.rollback()
            logger.exception("Position sweep failed")


#: When the unattended Mannschaft sync runs, Europe/Zurich. Nightly and deliberately odd: the
#: quietest hour of a fire station's day, and a minute nobody else's cron is on. `jitter` spreads
#: it further, so a fleet of self-hosted stations does not hit Divera in the same second.
PERSONNEL_SYNC_CRON = {"hour": 4, "minute": 17, "jitter": 600}


async def _personnel_autosync() -> None:
    """Bring the roster in line with Divera overnight, at the level the station configured.

    ⚠️ Registered unconditionally like every other credential-driven job, and a no-op on the two
    states that are not failures — ``roster.autoSync: "off"``, and no Divera key at all. The
    level is re-read on every run, so switching it in Verwaltung takes effect tonight.

    The connector state is what makes this SAFE to run unattended. A sync that quietly stopped
    working leaves the roster looking plausible and steadily wrong, so «zuletzt synchronisiert»
    and «zuletzt versucht» are recorded separately, and at level ``"safe"`` the departures the
    run declined to apply are counted into the detail rather than forgotten.
    """
    from . import connector_state
    from .credentials import load as load_credentials
    from .personnel import auto_sync, sync_detail

    async with async_session_maker() as db:
        await load_credentials(db)
        try:
            result = await auto_sync(db)
            if result is None:
                return  # level 'off', or no key — nothing was attempted, so nothing is reported
            await connector_state.record(
                db,
                connector_state.DIVERA_PERSONNEL,
                ok=True,
                detail=sync_detail(result, trigger="scheduled", level=result["level"]),
            )
            await db.commit()
            logger.info(
                "Mannschaft autosync (%s): +%d new, %d updated, %d deactivated, %d stale",
                result["level"],
                result["created"],
                result["updated"],
                result["deactivated"],
                result["stale"] - result["deactivated"],
            )
        except Exception as e:
            await db.rollback()
            logger.exception("Mannschaft autosync failed")
            await connector_state.record_failure(db, connector_state.DIVERA_PERSONNEL, e)


async def _roster_snapshot_tick() -> None:
    """Poll the station's published roster file, when one is configured and it is due.

    ⚠️ Registered unconditionally and a no-op without a ``roster_snapshot_source`` — the same
    shape as every credential-driven job, so a source pasted into Verwaltung is read within
    one tick, without a restart. The tick is short (``TICK_SECONDS``); the run itself happens
    only once ``roster.snapshotIntervalMin`` has passed since the last attempt, and an
    unchanged file is recognised by its checksum and skipped. Every rule about what a run may
    write is in app/roster_snapshot_ingest.py; failures are recorded by ``run`` itself.
    """
    from . import roster_snapshot_sync
    from .credentials import load as load_credentials

    async with async_session_maker() as db:
        await load_credentials(db)
        if not roster_snapshot_sync.configured() or not await roster_snapshot_sync.due(db):
            return
        try:
            await roster_snapshot_sync.run(db, trigger="scheduled", skip_unchanged=True)
        except Exception:
            logger.exception("Roster snapshot poll failed")


async def _demo_reset() -> None:
    """DEMO ONLY: wipe + reseed the synthetic Musterdorf incident/roster (see demo_reset.reset).
    Runs in-process so the public demo self-cleans on an exact cadence, instead of relying on the
    GitHub Actions cron, which delays/skips scheduled runs (the demo drifted to 2.5 h+ between
    resets). `reset()` owns its own session + commit, so there's nothing to manage here.

    `wipe_objects=False`: the in-process job never reloads the reference Einsatzobjekte (only the
    GitHub workflow's `scripts/demo-reset.sh` does), so it must NOT delete them — otherwise the
    Schloss's Modul 1 / 2-3 / 6 plans vanish from the plan rail until the next GitHub reload."""
    from .demo_reset import reset

    try:
        await reset(wipe_objects=False)
    except Exception:
        logger.exception("Demo reset sweep failed")


async def _heartbeat() -> None:
    """Dead-man's-switch: ping an external check URL (healthchecks.io / cron-monitor) on a short
    cadence. If the app or its event loop dies, the pings stop and the monitor alerts — catching
    the "silently down / scheduler wedged" class a plain HTTP probe of /ready can miss. Fail-open:
    no URL = disabled; a failed ping never disturbs the app. Success also requires the
    same bounded DB/storage check as /ready, so a live process with an unusable data layer
    cannot keep the external monitor green.

    ⚠️ Registered unconditionally and no-oping without a URL, rather than gated at boot the way
    it used to be. The thing that tells anybody the station is down was the one setting an
    operator could not switch on without a terminal and a restart — and «I turned the monitor
    on and no ping ever arrived» is the exact shape of failure it exists to prevent."""
    from .credentials import get as credential
    from .credentials import load as load_credentials

    await load_credentials()
    url = credential("healthcheck_ping_url")
    if not url:
        return
    from .readiness import check_readiness

    if any(value != "ok" for value in (await check_readiness(engine)).values()):
        logger.warning("Heartbeat success withheld: station data layer is unavailable")
        return
    try:
        async with httpx.AsyncClient(timeout=10) as client:
            await client.get(url)
    except Exception:  # noqa: BLE001 — fail-open: a dead monitor must not disturb the app
        logger.warning("Heartbeat ping failed (non-fatal)")


def _start_scheduler_jobs() -> None:
    global _scheduler
    from .plans import plans_pull_enabled

    if _scheduler is not None:
        return
    # A new leader (boot, or taking over from another replica) must not trust memory from an
    # earlier leadership of its own: the other replica wrote in between. The observers rebuild
    # from the record.
    from .vehicle_presence import reset_state

    reset_state()
    jobs: list[str] = []
    _scheduler = AsyncIOScheduler()
    # ⚠️ EVERY CREDENTIAL-DRIVEN JOB BELOW IS REGISTERED UNCONDITIONALLY, and each no-ops on a
    # tick where its credential is missing. They used to be gated here, at boot, off `settings`
    # — which is exactly why none of these integrations could be connected from a browser: the
    # value is only half the problem, the other half is that the job which would have used it
    # was never scheduled. The cost is a handful of timers ticking on a station that uses none of
    # them, each one a dictionary lookup against a cached snapshot.
    _scheduler.add_job(
        _divera_tick,
        "interval",
        seconds=divera_tick_seconds(),
        id="divera_poll",
        max_instances=1,
        coalesce=True,
        # late rather than skipped — see the vehicle sweep below
        misfire_grace_time=divera_tick_seconds() // 2,
    )
    jobs.append(
        f"divera poll ({DIVERA_IDLE_POLL_SECONDS}s idle / {settings.divera_poll_interval_seconds}s "
        "while an Einsatz runs, idle without a key)"
    )
    _scheduler.add_job(
        _push_sweep,
        "interval",
        seconds=settings.push_check_seconds,
        id="push_sweep",
        max_instances=1,
        coalesce=True,
    )
    jobs.append(f"push sweep ({settings.push_check_seconds}s, idle without VAPID keys)")
    _scheduler.add_job(
        _print_jobs_sweep,
        "interval",
        seconds=PRINT_JOB_SWEEP_SECONDS,
        id="print_jobs_sweep",
        max_instances=1,
        coalesce=True,
    )
    jobs.append(f"print-job sweep ({PRINT_JOB_SWEEP_SECONDS}s)")
    _scheduler.add_job(
        _vehicle_samples_sweep,
        "interval",
        seconds=VEHICLE_SAMPLE_SECONDS,
        id="vehicle_samples",
        max_instances=1,
        coalesce=True,
        # ⚠️ APScheduler SKIPS a run that starts more than 1 s late (its default grace), and a
        # busy event loop makes that routine: 9 of 55 ticks were dropped on the live check
        # (24.09.2026). Late is fine for an observer; skipped is a hole in the track.
        misfire_grace_time=VEHICLE_SAMPLE_SECONDS // 2,
    )
    jobs.append(f"vehicle samples + presence ({VEHICLE_SAMPLE_SECONDS}s, idle without Traccar or a fake fleet)")
    from .observations import WEATHER_OBSERVE_SECONDS

    _scheduler.add_job(
        _weather_sweep,
        "interval",
        seconds=WEATHER_OBSERVE_SECONDS,
        id="weather_observe",
        max_instances=1,
        coalesce=True,
        # a skipped run is a 20-minute hole in the weather record (two were, on the live check)
        misfire_grace_time=WEATHER_OBSERVE_SECONDS // 2,
        # the first reading shortly after boot, not ten minutes into a running Einsatz
        next_run_time=datetime.now(UTC) + timedelta(seconds=20),
    )
    jobs.append(f"weather observations ({WEATHER_OBSERVE_SECONDS}s, idle without an active Einsatz)")
    _scheduler.add_job(_heartbeat, "interval", seconds=60, id="heartbeat", max_instances=1, coalesce=True)
    jobs.append("heartbeat (60s, idle without a ping URL)")
    _scheduler.add_job(
        _sharepoint_pull,
        "interval",
        seconds=SHAREPOINT_TICK_SECONDS,
        id="sharepoint_pull",
        max_instances=1,
        coalesce=True,
    )
    jobs.append(f"SharePoint-Pull ({SHAREPOINT_TICK_SECONDS}s tick, idle without an app registration)")
    _scheduler.add_job(
        _object_visit_delivery_tick,
        "interval",
        seconds=OBJECT_VISIT_DELIVERY_TICK_SECONDS,
        id="object_visit_delivery",
        max_instances=1,
        coalesce=True,
    )
    jobs.append(
        f"Objektbesuche-Ablage ({OBJECT_VISIT_DELIVERY_TICK_SECONDS}s tick, idle without an enabled destination)"
    )
    _scheduler.add_job(
        _incident_archive_tick,
        "interval",
        seconds=INCIDENT_ARCHIVE_TICK_SECONDS,
        id="incident_archive",
        max_instances=1,
        coalesce=True,
    )
    jobs.append(f"Einsatz-Ablage ({INCIDENT_ARCHIVE_TICK_SECONDS}s tick, idle without an enabled destination)")
    # Nightly, and idle on a station that has not asked for it (`roster.autoSync: "off"`) or has
    # no Divera key — the same unconditional registration as the jobs above, for the same reason.
    _scheduler.add_job(
        _personnel_autosync,
        CronTrigger(timezone=ZoneInfo("Europe/Zurich"), **PERSONNEL_SYNC_CRON),
        id="personnel_autosync",
        max_instances=1,
        coalesce=True,
    )
    jobs.append(
        f"Mannschaft-Autosync ({PERSONNEL_SYNC_CRON['hour']:02d}:{PERSONNEL_SYNC_CRON['minute']:02d} "
        "Europe/Zurich, idle at autoSync 'off')"
    )
    from .roster_snapshot_sync import TICK_SECONDS as ROSTER_SNAPSHOT_TICK_SECONDS

    _scheduler.add_job(
        _roster_snapshot_tick,
        "interval",
        seconds=ROSTER_SNAPSHOT_TICK_SECONDS,
        id="roster_snapshot",
        max_instances=1,
        coalesce=True,
    )
    jobs.append(f"Personenstamm-Snapshot ({ROSTER_SNAPSHOT_TICK_SECONDS}s tick, idle without a source)")
    # Keeps the snapshot the SYNCHRONOUS credential readers see from going stale — see
    # `_refresh_credentials`.
    _scheduler.add_job(
        _refresh_credentials,
        "interval",
        seconds=CREDENTIALS_REFRESH_SECONDS,
        id="credentials_refresh",
        max_instances=1,
        coalesce=True,
    )
    jobs.append(f"credential refresh ({CREDENTIALS_REFRESH_SECONDS}s)")
    # Still boot-gated, and correctly so: PLANS_S3_* is not on the browser-settable list (the
    # bucket credentials belong to the system that maintains the plan library, not to this
    # station's admin), so nothing about it can change while the process runs.
    if plans_pull_enabled():
        _scheduler.add_job(
            _plan_pull,
            "interval",
            minutes=max(1, settings.plans_pull_interval_minutes),
            id="plan_pull",
            max_instances=1,
            coalesce=True,
        )
        jobs.append(f"Objektplan-Pull ({settings.plans_pull_interval_minutes}min)")
    else:
        logger.info("Objektplan-Pull disabled (no PLANS_S3_* store configured)")
    # Always on: every stored plan revision carries a durable alignment job, and a station
    # without the georef extra simply completes each as an honest 'unavailable' for review.
    _scheduler.add_job(
        _plan_alignment_tick,
        "interval",
        seconds=PLAN_ALIGNMENT_TICK_SECONDS,
        id="plan_alignments",
        max_instances=1,
        coalesce=True,
    )
    jobs.append(f"plan alignments ({PLAN_ALIGNMENT_TICK_SECONDS}s tick, idle without pending plans)")
    # Always on: every current plan PDF gets its tile pyramid once; idle afterwards.
    _scheduler.add_job(
        _plan_tiles_tick,
        "interval",
        seconds=PLAN_TILES_TICK_SECONDS,
        id="plan_tiles",
        max_instances=1,
        coalesce=True,
    )
    jobs.append(f"plan tiles ({PLAN_TILES_TICK_SECONDS}s tick, idle once every plan has its pyramid)")
    # Always on: a cheap no-op unless there is something for one of its three clocks to sweep
    # (alarms.autoArchiveDays for untouched auto-opened ones, alarms.exerciseAutoCloseHours for
    # idle Übungen, alarms.staleIncidentDays for the worked-on-but-never-closed ones); all at 0
    # makes it a no-op.
    _scheduler.add_job(
        _auto_archive_sweep,
        "interval",
        seconds=settings.auto_archive_check_seconds,
        id="auto_archive",
        max_instances=1,
        coalesce=True,
    )
    jobs.append(f"auto-archive sweep ({settings.auto_archive_check_seconds}s)")
    # Always on: a cheap no-op unless somebody is sharing their position. Not optional — this
    # is the deletion half of a privacy promise, so it must not hang off a feature flag.
    _scheduler.add_job(
        _positions_sweep,
        "interval",
        seconds=POSITION_SWEEP_SECONDS,
        id="positions_sweep",
        max_instances=1,
        coalesce=True,
    )
    jobs.append(f"position sweep ({POSITION_SWEEP_SECONDS}s)")
    # Daily, always on, and empty-table cheap where nothing counts — see _visit_hashes_sweep.
    _scheduler.add_job(
        _visit_hashes_sweep,
        "interval",
        hours=24,
        id="visit_hashes_sweep",
        max_instances=1,
        coalesce=True,
    )
    jobs.append("visit dedup sweep (24h)")
    from .object_footprints import TICK_SECONDS as FOOTPRINT_TICK_SECONDS

    _scheduler.add_job(
        _object_footprints_tick,
        "interval",
        seconds=FOOTPRINT_TICK_SECONDS,
        id="object_footprints",
        max_instances=1,
        coalesce=True,
        next_run_time=datetime.now(UTC) + timedelta(seconds=90),
    )
    jobs.append(f"object footprints ({FOOTPRINT_TICK_SECONDS}s, idle once every object is asked)")
    # DEMO daily hard-reset. Prefer a crontab (Europe/Zurich local midnight) so the demo persists
    # edits during the day and only resets nightly; fall back to the legacy fixed-interval job.
    if settings.demo_reset_cron:
        _scheduler.add_job(
            _demo_reset,
            CronTrigger.from_crontab(settings.demo_reset_cron, timezone=ZoneInfo("Europe/Zurich")),
            id="demo_reset",
            max_instances=1,
            coalesce=True,
        )
        jobs.append(f"DEMO reset (cron '{settings.demo_reset_cron}' Europe/Zurich)")
        logger.warning(
            "DEMO auto-reset ACTIVE: this deployment WIPES + reseeds ALL incident data on cron "
            "'%s' (Europe/Zurich). If this is NOT the public demo, unset DEMO_RESET_CRON now.",
            settings.demo_reset_cron,
        )
    elif settings.demo_reset_seconds > 0:
        _scheduler.add_job(
            _demo_reset,
            "interval",
            seconds=settings.demo_reset_seconds,
            id="demo_reset",
            max_instances=1,
            coalesce=True,
        )
        jobs.append(f"DEMO reset ({settings.demo_reset_seconds}s)")
        # Loud, so an accidental prod activation is unmissable in the boot logs.
        logger.warning(
            "DEMO auto-reset ACTIVE: this deployment WIPES + reseeds ALL incident data every %ds. "
            "If this is NOT the public demo, unset DEMO_RESET_SECONDS now.",
            settings.demo_reset_seconds,
        )
    _scheduler.start()
    logger.info("Scheduler leader running: %s", ", ".join(jobs))


async def _weather_radar_round() -> None:
    from .weather_layer import weather_service

    await weather_service.poll_radar()


def _start_process_jobs() -> None:
    """The Karte's weather layer (app/weather_layer): the radar every 5 min.

    ⚠️ NOT on the leader's scheduler. Everything there is an observer that WRITES the record, so
    exactly one process may run it. The weather layer writes nothing: it is an in-memory display
    cache, and the process that answers `GET /api/weather/layer` has to be the one holding the
    frames — a standby replica (or the new container of a rolling deploy, which serves before the
    old one lets go of the lock) would otherwise answer «no radar» for as long as it stands by.
    The cost of two replicas each fetching is two polite clients; a frame is still fetched once
    per process, never again.

    Boot-gated on `WEATHER_LAYER_ENABLED` (env only, like Rück's WEATHER_ENABLED): a station
    outside Switzerland or without outbound access switches it off and nothing is scheduled.
    The round runs once right at boot, so a fresh process has radar within seconds."""
    global _process_scheduler
    from .weather_layer import weather_layer_enabled

    if _process_scheduler is not None:
        return
    if not weather_layer_enabled():
        logger.info("Weather layer disabled (WEATHER_LAYER_ENABLED=false)")
        return
    now = datetime.now(UTC)
    _process_scheduler = AsyncIOScheduler()
    _process_scheduler.add_job(
        _weather_radar_round,
        # :01:30, :06:30, … – 90 s after each 5-minute slot (MeteoSwiss publishes ~1 min after it)
        CronTrigger(minute="1-59/5", second=30),
        id="weather_radar",
        max_instances=1,
        coalesce=True,
        misfire_grace_time=120,
        next_run_time=now,
    )
    _process_scheduler.start()
    logger.info("Weather layer running in this process: radar (5 min)")


def _stop_process_jobs() -> None:
    global _process_scheduler
    if _process_scheduler is not None:
        _process_scheduler.shutdown(wait=False)
        _process_scheduler = None


def _stop_scheduler_jobs() -> None:
    global _scheduler
    if _scheduler is not None:
        _scheduler.shutdown(wait=False)
        _scheduler = None


async def _acquire_scheduler_lock() -> AsyncConnection | None:
    """Try to hold the deployment-wide scheduler lock on a dedicated connection.

    SQLite is a single-process development/test convenience and has no advisory locks; it
    runs jobs directly. Production is PostgreSQL, where returning the connection to the
    pool would also return a still-held session lock, so the leader retains it explicitly.
    """
    if engine.dialect.name != "postgresql":
        return None

    conn = await engine.connect()
    try:
        acquired = bool(
            await conn.scalar(
                text("SELECT pg_try_advisory_lock(:lock_id)"),
                {"lock_id": SCHEDULER_ADVISORY_LOCK_ID},
            )
        )
        # End SQLAlchemy's implicit transaction. The session-level lock intentionally
        # survives commits and remains tied to this connection.
        await conn.commit()
        if acquired:
            return conn
    except BaseException:
        await conn.close()
        raise
    await conn.close()
    return None


async def _release_scheduler_lock() -> None:
    global _scheduler_leader_connection
    conn = _scheduler_leader_connection
    _scheduler_leader_connection = None
    if conn is None:
        return
    try:
        await conn.execute(
            text("SELECT pg_advisory_unlock(:lock_id)"),
            {"lock_id": SCHEDULER_ADVISORY_LOCK_ID},
        )
        await conn.commit()
    except Exception:  # noqa: BLE001 — cleanup must tolerate any broken-driver failure
        # A dead connection has already caused PostgreSQL to release its session locks.
        logger.warning("Scheduler leadership connection was lost during release", exc_info=True)
    finally:
        await conn.close()


async def _leadership_loop() -> None:
    """Monitor the held connection or promote this standby when the lock becomes free."""
    global _scheduler_leader_connection
    while True:
        if _scheduler_leader_connection is None:
            try:
                _scheduler_leader_connection = await _acquire_scheduler_lock()
            except Exception:  # noqa: BLE001 — election is retried; app serving must continue
                logger.warning("Scheduler leadership election failed; retrying", exc_info=True)
            if _scheduler_leader_connection is not None:
                _start_scheduler_jobs()
                logger.info("Scheduler leadership acquired")
        else:
            try:
                # A session advisory lock disappears with its connection. Probe that exact
                # connection: if it has died, stop jobs before attempting a new election.
                await _scheduler_leader_connection.execute(text("SELECT 1"))
                await _scheduler_leader_connection.commit()
            except Exception:
                logger.error("Scheduler leadership lost; stopping jobs before re-election", exc_info=True)
                _stop_scheduler_jobs()
                with suppress(Exception):
                    await _scheduler_leader_connection.close()
                _scheduler_leader_connection = None
        await asyncio.sleep(SCHEDULER_LEADERSHIP_RETRY_SECONDS)


async def start_scheduler(app: FastAPI) -> None:
    """Start jobs here or enter standby; PostgreSQL promotes exactly one replica."""
    del app  # lifespan symmetry; the scheduler does not retain the application object
    global _leadership_task, _scheduler_leader_connection
    if _leadership_task is not None or _scheduler is not None:
        return
    # every process, before (and whatever the outcome of) the election — see _start_process_jobs
    try:
        _start_process_jobs()
    except Exception:  # noqa: BLE001 — the weather layer must never keep the app from starting
        logger.warning("Weather layer jobs failed to start", exc_info=True)

    # Tests and the reloadable dev server run jobs in-process directly. Leadership is a
    # production topology concern, and keeping it off there also avoids holding a pooled
    # connection across pytest's per-test event loops.
    if not settings.is_production or engine.dialect.name != "postgresql":
        _start_scheduler_jobs()
        return

    try:
        _scheduler_leader_connection = await _acquire_scheduler_lock()
    except Exception:  # noqa: BLE001 — election is retried; app serving must continue
        logger.warning("Initial scheduler leadership election failed; entering standby", exc_info=True)
    if _scheduler_leader_connection is not None:
        _start_scheduler_jobs()
        logger.info("Scheduler leadership acquired")
    else:
        logger.info("Scheduler standby: another replica holds the PostgreSQL advisory lock")
    _leadership_task = asyncio.create_task(_leadership_loop(), name="scheduler-leadership")


async def stop_scheduler() -> None:
    global _leadership_task
    if _leadership_task is not None:
        _leadership_task.cancel()
        with suppress(asyncio.CancelledError):
            await _leadership_task
        _leadership_task = None
    _stop_process_jobs()
    _stop_scheduler_jobs()
    await _release_scheduler_lock()
