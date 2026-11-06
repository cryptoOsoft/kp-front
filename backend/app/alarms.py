"""Alarm auto-open + auto-archive: the source-agnostic half of alarm intake.

`create_incident_from_alarm` is the one place an alarm becomes an Incident without a human
(generic `/api/alarms` intake, the Divera poller and the Einsatz-Link's rescue path all land
here); manual creation keeps its own endpoint. Auto-opened incidents are marked `auto_opened`
so the sweep can archive the untouched ones (`workspace_rev == 0`, nobody ever synced a
workspace) after `alarms.autoArchiveDays` — and the same sweep closes an Übung nobody has changed
for `alarms.exerciseAutoCloseHours`, and clears out incidents that WERE worked on but never closed,
on their own much longer `alarms.staleIncidentDays` clock.

An alarm opens on arrival, with no human in the loop — so «an incident exists» no longer
means «the station attended an Einsatz». That line is `Incident.editor_opened_at`: stamped on
the first authenticated *editor* workspace read/write, deliberately never for a viewer (an
Einsatz-Link responder is one). Unconfirmed incidents stay out of the stats export.
"""

import asyncio
import logging
import uuid
from datetime import UTC, datetime, timedelta
from weakref import WeakValueDictionary

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from . import audit, live_wait
from .config import settings
from .geocode import geocode
from .models import LERN_UEBUNG_SOURCE, DeploymentConfig, Incident
from .schemas import AlarmsConfig, DeploymentConfigIn, load_stored_config
from .transaction_hooks import after_completion
from .vehicle_presence import last_activity

logger = logging.getLogger(__name__)

# SQLite is used by the local suite. It has no transaction-scoped advisory locks, so
# serialize identical identities in-process there. Production Postgres uses a database lock
# below, shared across workers/instances. Weak values release old test identities naturally.
_local_alarm_locks: WeakValueDictionary[str, asyncio.Lock] = WeakValueDictionary()
_HELD_ALARM_LOCKS = "kp_held_alarm_locks"


async def lock_alarm_identity(db: AsyncSession, source: str, source_ref: str) -> None:
    """Serialize check+create for one upstream alarm until this transaction completes.

    The unique index remains the final invariant; this lock turns its concurrent loser from
    an IntegrityError/500 into the endpoint's ordinary idempotent ``created: false`` reply.
    """
    # Length-prefix instead of a NUL separator: PostgreSQL text rejects U+0000, while the
    # prefix still makes ("ab", "c") distinct from ("a", "bc").
    identity = f"{len(source)}:{source}{source_ref}"
    dialect = db.bind.dialect.name if db.bind is not None else "postgresql"
    if dialect == "postgresql":
        await db.execute(select(func.pg_advisory_xact_lock(func.hashtextextended(identity, 0))))
        return

    held = db.sync_session.info.setdefault(_HELD_ALARM_LOCKS, set())
    if identity in held:
        return
    lock = _local_alarm_locks.setdefault(identity, asyncio.Lock())
    await lock.acquire()
    held.add(identity)

    def release() -> None:
        held.discard(identity)
        lock.release()

    after_completion(db, release)


async def get_config_model(db: AsyncSession) -> DeploymentConfigIn:
    """The full validated deployment config; safe defaults on a missing/corrupt row."""
    row = (await db.execute(select(DeploymentConfig).where(DeploymentConfig.id == 1))).scalar_one_or_none()
    raw = row.config_json if (row and row.config_json) else {}
    try:
        # a STORED row (see schemas · load_stored_config): a field that has grown a rule since it
        # was written is dropped, not refused — intake must not lose the station's whole alarm
        # vocabulary to it and fall through to the defaults below.
        return load_stored_config(raw)
    except Exception:  # noqa: BLE001 — a bad stored row must never break intake
        logger.warning("deployment_config failed validation; using defaults")
        return DeploymentConfigIn()


async def get_alarms_config(db: AsyncSession) -> AlarmsConfig:
    """The deployment's `alarms` config section; safe defaults on a missing/corrupt row."""
    return (await get_config_model(db)).alarms


async def is_demo_deployment(db: AsyncSession) -> bool:
    """True on the public demo, even if a stale config publish cleared its display flag.

    The reset schedule is the robust server identity; `identity.demoMode` is also accepted so a
    local/demo-configured deployment gets the same guards without running an automatic reset.
    """
    if settings.is_public_demo:
        return True
    identity = (await get_config_model(db)).identity
    return bool(identity and identity.demoMode)


async def open_pooled_alarm(db: AsyncSession, *, source: str, ref: str) -> Incident | None:
    """Resolve an alarm still sitting in an intake pool to its incident, opening it if nobody
    has yet. Returns None when no pool row matches — the caller decides what that means.

    This is the Einsatz-Link's rescue path. A link names the alarm (`src`/`ref`), never our
    incident UUID, so a responder could tap it before the alarm had become an Einsatz here and
    get «Einsatz nicht (mehr) verfügbar» until an editor took it on a tablet — verified in
    production 2026-08-02. Opening it here grants no new trust: possession of the alarm is the
    same authority the link session already runs on, and the incident stays UNCONFIRMED
    (`editor_opened_at` NULL — a link principal is a viewer) until an editor works it.

    Source-agnostic by signature. Divera's is the only intake pool that exists today, so it is
    the only branch; a second alerting system with a pool adds its lookup beside it.
    """
    if source != "divera":
        return None
    try:
        divera_id = int(ref)
    except (TypeError, ValueError):
        return None

    from .divera import open_emergency  # lazy — avoids an import cycle
    from .models import DiveraEmergency

    em = (await db.execute(select(DiveraEmergency).where(DiveraEmergency.divera_id == divera_id))).scalar_one_or_none()
    if em is None or em.is_archived:
        return None
    if em.taken_incident_id is not None:
        # Already open — or ATTACHED to a running Einsatz (split dispatch), in which case the
        # alarm's own (source, ref) names no incident at all and the pool row is the only
        # thing that knows where the alarm went. Send the responder to the Einsatz that
        # absorbed it rather than to a dead end.
        return await db.get(Incident, em.taken_incident_id)
    if em.is_taken or await is_demo_deployment(db):
        return None

    # The alarm is still pooled, and there are two reasons for that: nobody has got to it
    # yet, or the split-dispatch guard parked it because an Einsatz is already running.
    # Opening it blindly would recreate exactly the duplicate that guard exists to prevent
    # — and a link is the likeliest way to trip it, because a re-dispatched group taps it
    # within seconds while the EL is still working the first alarm.
    #
    # Sending the responder to the running Einsatz is not a compromise, it is the better
    # answer: a Nachalarm for the same incident wants that incident's Lage, not a fresh
    # empty one. The EL can still attach the pool row properly afterwards; this only
    # decides what the responder sees in the meantime.
    running = (
        await db.execute(
            select(Incident)
            .where(
                Incident.is_archived.is_(False),
                Incident.started_at > datetime.now(UTC) - timedelta(hours=4),
                Incident.source != LERN_UEBUNG_SOURCE,  # never a tutorial (models · LERN_UEBUNG_SOURCE)
            )
            .order_by(Incident.started_at.desc())
            .limit(1)
        )
    ).scalar_one_or_none()
    if running is not None:
        logger.info(
            "Einsatz-Link für Divera %s: laufender Einsatz %s statt zweitem Einsatz",
            em.divera_id,
            running.id,
        )
        return running

    return await open_emergency(db, em)


async def find_by_source_ref(db: AsyncSession, source: str, source_ref: str) -> Incident | None:
    return (
        await db.execute(select(Incident).where(Incident.source == source, Incident.source_ref == source_ref))
    ).scalar_one_or_none()


async def create_incident_from_alarm(
    db: AsyncSession,
    *,
    source: str,
    title: str,
    text: str | None = None,
    address: str | None = None,
    lat: float | None = None,
    lng: float | None = None,
    type_: str | None = None,
    priority: str | None = None,
    source_ref: str | None = None,
    divera_id: int | None = None,
    started_at: datetime | None = None,
    started_at_source: str = "alarm",
) -> Incident:
    """Create an auto-opened incident from an alarm (no human in the loop).

    Mirrors the pool-take path: type/priority inferred from the title keywords when the
    sender didn't provide them, address geocoded only when no coordinate is available.

    ``started_at`` is the Alarmierungszeit as the sender stated it. Senders that omit it get
    the server default — the insert time — and the provenance stays NULL to say so, because
    the alternative is publishing «when the webhook arrived» as an alarm time.
    """
    from .divera import active_vocabulary, detect_type, infer_priority  # lazy — avoids an import cycle

    title = title or "(ohne Titel)"
    # The deployment's own alarm words if it set any, else the shipped default. Resolved once
    # per incident, not per field — the two inferences below must never disagree about which
    # vocabulary they are reading.
    vocab = await active_vocabulary()
    # 0/0 is "no location", never a real coordinate (Divera's convention; also guards any
    # generic-intake sender) — clearing it lets the address geocoder below take over.
    if lat is not None and lng is not None and abs(lat) < 1e-6 and abs(lng) < 1e-6:
        lat = lng = None
    if (lat is None or lng is None) and address:
        coords = await geocode(address)
        if coords:
            lat, lng = coords
    if source == "divera" and source_ref is None and divera_id is not None:
        source_ref = str(divera_id)
    inc = Incident(
        # Deprecated dual-write for one compatibility release; source/source_ref is canonical.
        divera_id=divera_id if source == "divera" else None,
        source=source,
        source_ref=source_ref,
        title=title,
        type=type_ or detect_type(title, vocab=vocab),
        priority=priority or infer_priority(title, text, vocab=vocab),
        text=text,
        address=address,
        lat=lat,
        lng=lng,
        status="offen",
        auto_opened=True,
        created_by=None,
    )
    if started_at:
        inc.started_at = started_at
        inc.started_at_source = started_at_source
    db.add(inc)
    await db.flush()
    await audit.append_event(
        db,
        incident_id=inc.id,
        op_type="incident.create",
        source="status",
        user_id=None,
        payload={"title": inc.title, "source": inc.source, "auto": True},
    )
    from .webhooks import notify_incident_created  # lazy — avoids an import cycle

    await notify_incident_created(db, inc)
    return inc


async def auto_archive_sweep(db: AsyncSession) -> int:
    """Archive the incidents nobody is coming back to. Three clocks, deliberately separate.

    * ``alarms.autoArchiveDays`` — auto-opened incidents nobody ever touched
      (``workspace_rev == 0``): alarm noise, nothing was ever recorded on them. Human-created
      incidents are never swept by this clock, however empty they are.
    * ``alarms.exerciseAutoCloseHours`` — an Übung nobody has changed for that long (owner,
      27.10.2026: 12 h). Measured from the last HUMAN change (``vehicle_presence.last_activity``:
      a GPS or weather observer's write never keeps a drill open). Ernstfälle never.
    * ``alarms.staleIncidentDays`` — incidents that WERE worked on and then never closed.
      Closing is a deliberate act, and an operator who does not know it exists never performs
      it, so these accumulate forever. Much longer clock, because this one sweeps real work.

    All archive REVERSIBLY (Wieder öffnen) and none stamps ``report_done_at``: the Rapport
    was not finished, and the record must never claim otherwise. Each carries its own Verlauf
    row saying which clock ran out — an Einsatz that vanishes off the list without a word is
    the failure mode this whole sweep must not have.
    """
    cfg = await get_alarms_config(db)
    now = datetime.now(UTC)
    # (incident, why) — one list so a single pass writes the audit trail for both clocks, and
    # so an untouched incident old enough for BOTH is archived once, by the clock that names it
    # most precisely (`seen` keeps the first, i.e. the untouched one).
    rows: list[tuple[Incident, str]] = []
    seen: set[uuid.UUID] = set()
    if cfg.autoArchiveDays > 0:
        cutoff = now - timedelta(days=cfg.autoArchiveDays)
        untouched = (
            await db.execute(
                select(Incident).where(
                    Incident.is_archived.is_(False),
                    Incident.auto_opened.is_(True),
                    Incident.workspace_rev == 0,
                    Incident.started_at < cutoff,
                )
            )
        ).scalars()
        for inc in untouched:
            seen.add(inc.id)
            rows.append((inc, "Einsatz automatisch archiviert (nicht verwendet)"))
    if cfg.exerciseAutoCloseHours > 0:
        cutoff = now - timedelta(hours=cfg.exerciseAutoCloseHours)
        # started before the cutoff narrows it in SQL (nothing started since can be due); the
        # last human change is then asked per candidate — a station has a handful of Übungen open
        drills = (
            (
                await db.execute(
                    select(Incident).where(
                        Incident.is_archived.is_(False),
                        Incident.is_exercise.is_(True),
                        Incident.started_at < cutoff,
                    )
                )
            )
            .scalars()
            .all()
        )
        for inc in drills:
            if inc.id in seen or await last_activity(db, inc.id, inc.started_at) >= cutoff:
                continue
            seen.add(inc.id)
            rows.append((inc, "Automatisch abgeschlossen (Übung)"))
    if cfg.staleIncidentDays > 0:
        # `updated_at`, not `started_at`: the question is when anybody last did anything with
        # this Einsatz, not how long ago it was alarmed. A month-old Einsatz that somebody
        # corrected yesterday is still being worked on.
        cutoff = now - timedelta(days=cfg.staleIncidentDays)
        stale = (
            await db.execute(
                select(Incident).where(
                    Incident.is_archived.is_(False),
                    Incident.updated_at < cutoff,
                )
            )
        ).scalars()
        for inc in stale:
            if inc.id in seen:
                continue
            seen.add(inc.id)
            rows.append((inc, f"Einsatz automatisch archiviert ({cfg.staleIncidentDays} Tage ohne Bearbeitung)"))
    if not rows:
        return 0
    from .api.journal import append_system_row  # lazy — service module must not pull the API layer at import

    for inc, why in rows:
        inc.is_archived = True
        if inc.closed_at is None:
            inc.closed_at = now
        inc.last_closed_at = now
        await audit.append_event(
            db,
            incident_id=inc.id,
            op_type="status.change",
            source="status",
            user_id=None,
            payload={"archived": True, "auto": True},
        )
        await append_system_row(db, inc.id, icon="flag", text=why, lifecycle="closed")
        # the devices following it hear the close at once, as for a hand close (lib/incidentClosed)
        live_wait.notify_after_commit(db, live_wait.workspace_topic(inc.id))
    logger.info("Auto-archive sweep: %d incident(s) archived", len(rows))
    return len(rows)
