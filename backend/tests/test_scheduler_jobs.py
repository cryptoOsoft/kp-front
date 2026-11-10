"""The unattended scheduler jobs: what a tick writes, what it refuses to do, what it swallows.

Every job in ``app/scheduler.py`` runs on a timer with nobody watching, so its failure mode is
silence — a sweep that stops sweeping, a credential that never reaches its consumer, a leader
that lost its lock and kept its jobs. What this file pins is therefore three things:

* the **gate** — a job whose credential is missing must do nothing at all, and must start
  working on the tick after that credential appears (the whole reason these jobs are
  registered unconditionally instead of at boot);
* the **write** — each sweep's effect measured in a SECOND session, because the part of these
  jobs that is theirs alone is the ``await db.commit()``: a sweep that deletes and does not
  commit is indistinguishable from one that works, until the next restart;
* the **swallow** — a collaborator that raises must leave the transaction clean and say so in
  the log, never wedge the scheduler.

``_vehicle_samples_sweep`` has its own file (``test_vehicle_samples.py``); the advisory-lock
primitives are shared with ``test_scheduler_leadership.py``, which covers the two happy paths.
"""

import asyncio
import importlib
import logging
from contextlib import suppress
from datetime import UTC, datetime, timedelta
from types import SimpleNamespace

import pytest
from fastapi import FastAPI
from sqlalchemy import select

from app import scheduler
from app.config import settings
from app.models import Incident, Personnel, PersonPosition, PrintJob, VisitHash, VisitStat

MARKER = "rolled-back-by-the-job"


class _SessionCtx:
    """Hand a job the test's session without letting its ``async with`` close it."""

    def __init__(self, session):
        self._session = session

    async def __aenter__(self):
        return self._session

    async def __aexit__(self, *exc):
        return False


@pytest.fixture(autouse=True)
def _module_state(monkeypatch):
    """The scheduler holds its APScheduler, its leader connection and its watch task in module
    globals. Pinning them through monkeypatch means a test that promotes a fake leader or starts
    real jobs cannot leave either behind for the next one."""
    monkeypatch.setattr(scheduler, "_scheduler", None)
    monkeypatch.setattr(scheduler, "_scheduler_leader_connection", None)
    monkeypatch.setattr(scheduler, "_leadership_task", None)


@pytest.fixture
def run_job(db_session, monkeypatch):
    """Run a job body against the test's session, the way a tick would."""
    monkeypatch.setattr(scheduler, "async_session_maker", lambda: _SessionCtx(db_session))

    async def _run(job) -> None:
        await job()

    return _run


@pytest.fixture
def fresh(session_factory):
    """A second session, so an assertion reads what was COMMITTED rather than what is pending."""

    async def _scalars(stmt):
        async with session_factory() as s:
            return list((await s.execute(stmt)).scalars().all())

    return _scalars


async def _incident(db_session, **over) -> Incident:
    inc = Incident(title=over.pop("title", "Brand Hauptstrasse 4"), source=over.pop("source", "manual"), **over)
    db_session.add(inc)
    await db_session.commit()
    await db_session.refresh(inc)
    return inc


# --- credential refresh ---------------------------------------------------------------


async def test_the_refresh_forces_a_reload_rather_than_waiting_for_the_cache(monkeypatch):
    """The synchronous readers (`push_enabled`, the Traccar client) have no session to await
    with, so this job is their only path to a value another process wrote. A plain `load()`
    would honour the 30 s cache and refresh nothing on most ticks — `force=True` is the job."""
    import app.credentials as credentials_mod

    calls: list[bool] = []

    async def _load(db=None, *, force=False):
        calls.append(force)
        return {}

    monkeypatch.setattr(credentials_mod, "load", _load)
    await scheduler._refresh_credentials()

    assert calls == [True]


async def test_a_failed_refresh_keeps_the_last_known_credentials(db_session, monkeypatch, caplog):
    """A stale snapshot is survivable; a scheduler that dies on a database blip is not. The
    value that was already loaded must still be the one every consumer reads."""
    import app.credentials as credentials_mod

    await credentials_mod.set_value(db_session, "divera_access_key", "key-from-the-browser", actor_id=None)
    assert credentials_mod.get("divera_access_key") == "key-from-the-browser"

    async def _boom(db=None, *, force=False):
        raise RuntimeError("database unreachable")

    monkeypatch.setattr(credentials_mod, "load", _boom)
    with caplog.at_level(logging.WARNING, logger="app.scheduler"):
        await scheduler._refresh_credentials()

    assert credentials_mod.get("divera_access_key") == "key-from-the-browser"
    assert "Credential refresh failed" in caplog.text


# --- Divera poll ----------------------------------------------------------------------


async def test_divera_starts_being_polled_on_the_tick_after_its_key_appears(run_job, monkeypatch):
    """The reason the job is registered unconditionally: a key typed into /admin has to take
    effect without a restart, and a job that was never scheduled cannot start working at all.
    So «no key» is a state this tick handles, not a state it was configured out of."""
    import app.divera as divera_mod

    polls: list[int] = []

    async def _fetch(db):
        polls.append(1)
        return 0

    monkeypatch.setattr(divera_mod, "fetch_and_upsert", _fetch)

    await run_job(scheduler._poll_divera)
    assert polls == []  # nothing configured — the tick is a dictionary lookup and done

    monkeypatch.setattr(settings, "divera_access_key", "set-while-we-were-running")
    await run_job(scheduler._poll_divera)
    assert polls == [1]


async def test_a_polled_alarm_is_committed_and_counted(db_session, run_job, fresh, monkeypatch, caplog):
    import app.divera as divera_mod

    async def _fetch(db):
        db.add(Incident(title="Divera-Alarm", source="divera"))
        return 1

    monkeypatch.setattr(divera_mod, "fetch_and_upsert", _fetch)
    monkeypatch.setattr(settings, "divera_access_key", "k")

    with caplog.at_level(logging.INFO, logger="app.scheduler"):
        await run_job(scheduler._poll_divera)

    assert await fresh(select(Incident.title).where(Incident.source == "divera")) == ["Divera-Alarm"]
    assert "Divera poll: 1 new alarm(s)" in caplog.text


@pytest.fixture
def divera_clock(monkeypatch):
    """The Divera cadence reads the event loop's clock; the test moves it by hand."""
    now = [1000.0]
    monkeypatch.setattr(scheduler, "_divera_now", lambda: now[0])
    monkeypatch.setattr(scheduler, "_divera_last_poll", None)
    monkeypatch.setattr(scheduler, "_divera_backoff_s", 0.0)
    monkeypatch.setattr(scheduler, "_divera_backoff_until", 0.0)
    return now


async def test_the_server_polls_every_30s_while_nothing_runs_and_every_120s_while_something_does(
    db_session, run_job, divera_clock, monkeypatch
):
    """D2 (24.09.2026): the devices stopped POSTing `/divera/pool/refresh` every 30 s each (469
    Divera calls in one Übung). The server alone polls — fast while it is waiting for a dispatch,
    slow once the Einsatz is running and the webhook carries it."""
    polls: list[float] = []

    async def _poll():
        polls.append(divera_clock[0])

    monkeypatch.setattr(scheduler, "_poll_divera", _poll)
    monkeypatch.setattr(settings, "divera_poll_interval_seconds", 120)
    assert scheduler.divera_tick_seconds() == 30
    for _ in range(4):
        await run_job(scheduler._divera_tick)
        divera_clock[0] += 30
    assert len(polls) == 4  # idle: every tick polls

    await _incident(db_session, status="offen", started_at=datetime.now(UTC) - timedelta(minutes=5))
    polls.clear()
    for _ in range(8):
        await run_job(scheduler._divera_tick)
        divera_clock[0] += 30
    assert len(polls) == 2  # running: every fourth tick

    # an Einsatz that has been open for more than a day is not «running» for this question
    await db_session.execute(Incident.__table__.update().values(started_at=datetime.now(UTC) - timedelta(hours=30)))
    await db_session.commit()
    polls.clear()
    for _ in range(4):
        await run_job(scheduler._divera_tick)
        divera_clock[0] += 30
    assert len(polls) == 4


async def test_a_429_backs_the_poll_off_doubling_and_capped_and_a_success_resets_it(
    run_job, divera_clock, monkeypatch, caplog
):
    import app.divera as divera_mod

    answers: list[int] = []

    async def _fetch(db):
        status = answers.pop(0)
        if status != 200:
            err = divera_mod.DiveraApiError(f"Divera antwortete mit HTTP {status}")
            err.status_code = status
            raise err
        return 0

    monkeypatch.setattr(divera_mod, "fetch_and_upsert", _fetch)
    monkeypatch.setattr(settings, "divera_access_key", "k")

    waits = []
    for _ in range(6):
        answers.append(429)
        await run_job(scheduler._poll_divera)
        waits.append(scheduler._divera_backoff_s)
    assert waits == [60.0, 120.0, 240.0, 480.0, 900.0, 900.0]
    # while backed off, the tick does not reach Divera at all
    polled: list[int] = []
    real_poll = scheduler._poll_divera

    async def _poll():
        polled.append(1)

    monkeypatch.setattr(scheduler, "_poll_divera", _poll)
    await run_job(scheduler._divera_tick)
    assert polled == []
    divera_clock[0] += 901
    await run_job(scheduler._divera_tick)
    assert polled == [1]

    monkeypatch.setattr(scheduler, "_poll_divera", real_poll)
    answers.append(200)
    await run_job(scheduler._poll_divera)
    assert scheduler._divera_backoff_s == 0.0


# --- push sweep -----------------------------------------------------------------------


async def test_no_vapid_pair_means_the_sender_is_never_reached(run_job, monkeypatch, caplog):
    """Fail-closed and silent: without keys there is no server-side push, and the in-app
    tone/notification path is unaffected. Half a pair is still no pair — and a station that
    generates one in the browser is sending on the next sweep, not after a restart."""
    import app.push as push_mod

    sent: list[int] = []

    async def _check(db, now_ms=None):
        sent.append(1)
        return 2

    monkeypatch.setattr(push_mod, "check_and_push", _check)

    await run_job(scheduler._push_sweep)
    monkeypatch.setattr(settings, "vapid_public_key", "pub")  # only one half
    await run_job(scheduler._push_sweep)
    assert sent == []

    monkeypatch.setattr(settings, "vapid_private_key", "priv")
    with caplog.at_level(logging.INFO, logger="app.scheduler"):
        await run_job(scheduler._push_sweep)
    assert sent == [1]
    # What went out is the only trace an unattended alert leaves — «Trupp überfällig» reached
    # a killed app, or it did not, and nobody was watching either way.
    assert "Push sweep: 2 alert(s) sent" in caplog.text


# --- auto-archive ---------------------------------------------------------------------


async def test_an_untouched_alarm_is_archived_and_the_archive_is_committed(db_session, run_job, fresh):
    """`alarms.autoArchiveDays` (7) sweeps auto-opened incidents nobody ever recorded anything
    on. A human-created one of the same age is not that clock's business — and neither archive
    is worth anything unless the job commits it, which is the half that belongs to this file."""
    await _incident(
        db_session,
        title="Auto-Alarm",
        source="divera",
        auto_opened=True,
        started_at=datetime.now(UTC) - timedelta(days=10),
    )
    await _incident(db_session, title="Von Hand", started_at=datetime.now(UTC) - timedelta(days=10))

    await run_job(scheduler._auto_archive_sweep)

    archived = await fresh(select(Incident.title).where(Incident.is_archived.is_(True)))
    assert archived == ["Auto-Alarm"]


# --- Objektplan pull ------------------------------------------------------------------


async def test_the_plan_pull_survives_a_result_without_a_count(run_job, monkeypatch, caplog):
    """`pull_plans` answers `{'status': 'unreachable'}` (or `'disabled'`) for a store problem —
    no `updated` key at all. The job reads it with `.get`, so an unreachable bucket is a quiet
    tick rather than a KeyError on a timer."""
    import app.plans as plans_mod

    result: dict[str, int | str] = {"status": "unreachable"}
    monkeypatch.setattr(plans_mod, "pull_plans", lambda db: _returning(result))

    with caplog.at_level(logging.INFO, logger="app.scheduler"):
        await run_job(scheduler._plan_pull)
        assert "Objektplan-Pull" not in caplog.text

        result.clear()
        result.update({"updated": 2, "unchanged": 5})
        await run_job(scheduler._plan_pull)

    assert "Objektplan-Pull: 2 plan(s) updated" in caplog.text


async def _returning(value):
    return value


# --- SharePoint pull --------------------------------------------------------------------


async def test_the_sharepoint_pull_is_idle_until_an_app_registration_exists(run_job, monkeypatch):
    """Registered unconditionally, like the four jobs above and for the same reason: all three
    SharePoint credentials are set FROM THE BROWSER, so a job gated at boot would never run on
    the station that just configured it."""
    import app.sharepoint_sync as sp
    from app.schemas import SharePointConfig

    calls: list[bool] = []
    monkeypatch.setattr(sp, "sync_sharepoint", lambda db, **kw: _returning(calls.append(True) or {}))
    monkeypatch.setattr(
        sp,
        "sharepoint_settings",
        lambda db: _returning(SharePointConfig(sources=[{"area": "plans", "driveId": "b!x", "path": "p"}])),
    )

    monkeypatch.setattr(sp, "sharepoint_credentials", lambda: None)
    await run_job(scheduler._sharepoint_pull)
    assert calls == [], "no credentials — the tick must cost nothing"

    monkeypatch.setattr(sp, "sharepoint_credentials", lambda: ("t", "c", "s"))
    monkeypatch.setattr(scheduler, "_sharepoint_last_run", None)
    await run_job(scheduler._sharepoint_pull)
    assert calls == [True], "…and it starts working on the tick after the keys appear"


async def test_the_configured_cadence_decides_when_a_tick_actually_polls(run_job, monkeypatch):
    """⚠️ The timer ticks every minute; `sharepoint.intervalMinutes` is the real cadence. It lives
    in the config document precisely so an admin can change it without a restart — which a fixed
    APScheduler interval could not follow."""
    import app.sharepoint_sync as sp
    from app.schemas import SharePointConfig

    runs: list[bool] = []
    monkeypatch.setattr(sp, "sharepoint_credentials", lambda: ("t", "c", "s"))
    monkeypatch.setattr(sp, "sync_sharepoint", lambda db, **kw: _returning(runs.append(True) or {}))
    monkeypatch.setattr(
        sp,
        "sharepoint_settings",
        lambda db: _returning(
            SharePointConfig(intervalMinutes=60, sources=[{"area": "plans", "driveId": "b!x", "path": "p"}])
        ),
    )
    monkeypatch.setattr(scheduler, "_sharepoint_last_run", None)

    await run_job(scheduler._sharepoint_pull)
    await run_job(scheduler._sharepoint_pull)
    assert runs == [True], "a second tick a minute later is not another poll"

    monkeypatch.setattr(scheduler, "_sharepoint_last_run", datetime.now(UTC) - timedelta(hours=2))
    await run_job(scheduler._sharepoint_pull)
    assert runs == [True, True], "…and an hour later it is"


# --- print-job sweep ------------------------------------------------------------------


def _print_job(incident_id, *, age_days: float) -> PrintJob:
    return PrintJob(
        incident_id=incident_id,
        kind="report",
        filename=f"rapport-{age_days}.pdf",
        pdf=b"%PDF-1.4",
        created_at=datetime.now(UTC) - timedelta(days=age_days),
    )


async def test_the_print_queue_is_retired_only_past_the_retention_window(db_session, run_job, fresh, monkeypatch):
    """The paper is the artefact — a claimed job is scrap the moment it is printed. But the
    window has to hold: sweeping a job the agent has not fetched yet loses the print."""
    monkeypatch.setattr(settings, "print_agent_secret", "relay-secret")
    inc = await _incident(db_session)
    db_session.add_all(
        [
            _print_job(inc.id, age_days=scheduler.PRINT_JOB_RETENTION_DAYS + 1),
            _print_job(inc.id, age_days=1),
        ]
    )
    await db_session.commit()

    await run_job(scheduler._print_jobs_sweep)

    assert await fresh(select(PrintJob.filename)) == ["rapport-1.pdf"]


async def test_a_station_that_switched_the_relay_off_still_loses_old_jobs(db_session, run_job, fresh):
    """Every row is a Rapport-PDF with names in it. Clearing the relay secret must not turn the
    7-day retention into forever (review on #524, 30.10.2026)."""
    inc = await _incident(db_session)
    db_session.add(_print_job(inc.id, age_days=scheduler.PRINT_JOB_RETENTION_DAYS + 30))
    await db_session.commit()

    await run_job(scheduler._print_jobs_sweep)

    assert len(await fresh(select(PrintJob.filename))) == 0


# --- visitor hashes -------------------------------------------------------------------


async def test_visitor_hashes_expire_but_the_counters_stay(db_session, run_job, fresh):
    """The hashes are dedup scratch space and inert after their own day (the salt is gone);
    `visit_stats` is the record and must survive the sweep that clears them."""
    from app import visits

    old = visits.today() - timedelta(days=visits.RETAIN_DAYS + 1)
    db_session.add_all(
        [
            VisitHash(day=old, kind="page", key="de", visitor="a" * 32),
            VisitHash(day=visits.today(), kind="page", key="de", visitor="b" * 32),
            VisitStat(day=old, kind="page", key="de", hits=9, uniques=3),
        ]
    )
    await db_session.commit()

    await run_job(scheduler._visit_hashes_sweep)

    assert await fresh(select(VisitHash.day)) == [visits.today()]
    assert await fresh(select(VisitStat.hits)) == [9]


# --- crew positions -------------------------------------------------------------------


async def test_a_position_that_went_quiet_is_deleted_and_a_live_one_is_not(db_session, run_job, fresh, monkeypatch):
    """The deletion half of a privacy promise: a name-and-coordinate pair may not sit in the
    database for days after the phone that reported it went home. The Einsatz nobody ever
    closes is exactly the case this backstop exists for, so it may not depend on closure."""
    monkeypatch.setattr(settings, "position_ttl_hours", 6)
    person = Personnel(display_name="M. Muster")
    db_session.add(person)
    await db_session.commit()
    await db_session.refresh(person)
    # One row per (incident, person) by constraint, so the two cases need two Einsätze.
    quiet = await _incident(db_session, title="Seit gestern offen")
    live = await _incident(db_session, title="Läuft gerade")

    now = datetime.now(UTC)
    db_session.add_all(
        [
            _position(quiet.id, person.id, device="gone-home", at=now - timedelta(hours=9)),
            _position(live.id, person.id, device="still-sharing", at=now),
        ]
    )
    await db_session.commit()

    await run_job(scheduler._positions_sweep)

    assert await fresh(select(PersonPosition.device_id)) == ["still-sharing"]


def _position(incident_id, person_id, *, device: str, at: datetime) -> PersonPosition:
    return PersonPosition(
        incident_id=incident_id,
        person_id=person_id,
        device_id=device,
        display_name="M. Muster",
        lat=47.5163,
        lng=7.5617,
        ts=at,
        updated_at=at,
    )


# --- demo reset -----------------------------------------------------------------------


async def test_the_in_process_demo_reset_never_wipes_the_reference_objects(monkeypatch):
    """`wipe_objects=True` belongs to the GitHub workflow, which reloads the objects in its
    very next step. The in-process job reloads nothing, so wiping here would strip the
    Schloss's Modul-PDFs and leave the demo's plan rail empty until the next workflow run."""
    import app.demo_reset as demo_reset_mod

    seen: list[bool] = []

    async def _reset(wipe_objects: bool = True) -> None:
        seen.append(wipe_objects)

    monkeypatch.setattr(demo_reset_mod, "reset", _reset)
    await scheduler._demo_reset()

    assert seen == [False]


async def test_the_demo_reset_refuses_to_run_against_a_database_nobody_marked_as_demo(
    db_session, fresh, monkeypatch, caplog
):
    """The guard lives inside `reset()` rather than in the CLI, precisely because this job
    walks straight past a CLI check — on a timer, against whatever DATABASE_URL names. So the
    real call is made here, unpatched: it must refuse, log, and leave the data alone."""
    monkeypatch.delenv("KP_DEMO_RESET", raising=False)
    await _incident(db_session, title="Echter Einsatz")

    with caplog.at_level(logging.ERROR, logger="app.scheduler"):
        await scheduler._demo_reset()

    assert "Demo reset sweep failed" in caplog.text
    assert await fresh(select(Incident.title)) == ["Echter Einsatz"]


# --- heartbeat ------------------------------------------------------------------------


def _stub_httpx(monkeypatch, *, on_get):
    """Replace the module's httpx handle only — patching the package would reach every test."""
    calls: list[str] = []

    class _Client:
        def __init__(self, **kw):
            self.kw = kw

        async def __aenter__(self):
            return self

        async def __aexit__(self, *exc):
            return False

        async def get(self, url):
            calls.append(url)
            return await on_get(url)

    monkeypatch.setattr(scheduler, "httpx", SimpleNamespace(AsyncClient=_Client))
    return calls


async def test_without_a_ping_url_the_heartbeat_makes_no_request_at_all(monkeypatch):
    class _Explode:
        def __init__(self, **kw):
            raise AssertionError("a heartbeat with no monitor configured must not open a client")

    monkeypatch.setattr(scheduler, "httpx", SimpleNamespace(AsyncClient=_Explode))
    monkeypatch.setattr(settings, "healthcheck_ping_url", "")

    await scheduler._heartbeat()


async def test_the_heartbeat_pings_exactly_the_url_that_was_configured(monkeypatch, engine):
    """A dead-man's-switch nobody could switch on without a restart is the failure it exists to
    prevent — so the URL is read from the credential snapshot on every tick, not at boot."""
    calls = _stub_httpx(monkeypatch, on_get=_ok)
    monkeypatch.setattr(scheduler, "engine", engine)
    monkeypatch.setattr(settings, "healthcheck_ping_url", "https://hc.example/ping/abc")

    await scheduler._heartbeat()

    assert calls == ["https://hc.example/ping/abc"]


async def test_a_dead_monitor_never_disturbs_the_app(monkeypatch, caplog, engine):
    """Fail-open, and deliberately at WARNING: the monitor being unreachable is not the
    station's problem, and it must not read as an incident in the log."""

    async def _refuse(url):
        raise OSError("connection refused")

    _stub_httpx(monkeypatch, on_get=_refuse)
    monkeypatch.setattr(scheduler, "engine", engine)
    monkeypatch.setattr(settings, "healthcheck_ping_url", "https://hc.example/ping/abc")

    with caplog.at_level(logging.WARNING, logger="app.scheduler"):
        await scheduler._heartbeat()

    # WARNING and nothing louder, and one line — a monitor nobody can reach is not an error
    # the station has to act on, and it must not drown the log it shares with real ones.
    ours = [r for r in caplog.records if r.name == "app.scheduler"]
    assert [(r.levelno, r.getMessage()) for r in ours] == [(logging.WARNING, "Heartbeat ping failed (non-fatal)")]


async def _ok(url):
    return None


# --- the swallow contract -------------------------------------------------------------


@pytest.mark.parametrize(
    ("job_name", "module", "attr", "message", "env"),
    [
        ("_poll_divera", "app.divera", "fetch_and_upsert", "Divera poll failed", {"divera_access_key": "k"}),
        (
            "_push_sweep",
            "app.push",
            "check_and_push",
            "Push sweep failed",
            {"vapid_private_key": "priv", "vapid_public_key": "pub"},
        ),
        ("_auto_archive_sweep", "app.alarms", "auto_archive_sweep", "Auto-archive sweep failed", {}),
        ("_plan_pull", "app.plans", "pull_plans", "Objektplan-Pull failed", {}),
        (
            "_print_jobs_sweep",
            "app.scheduler",
            "execute_dml",
            "Print-job sweep failed",
            {},
        ),
        ("_visit_hashes_sweep", "app.visits", "prune", "Visit sweep failed", {}),
        ("_positions_sweep", "app.scheduler", "execute_dml", "Position sweep failed", {}),
    ],
)
async def test_a_collaborator_that_raises_is_rolled_back_logged_and_survived(
    job_name, module, attr, message, env, run_job, fresh, monkeypatch, caplog
):
    """One tick's failure may cost that tick and nothing else. The half that is easy to lose is
    the rollback: without it the half-written work of the failed tick would ride along and be
    committed by the NEXT job to share the session, and on PostgreSQL every following statement
    on that session raises `current transaction is aborted` instead.
    """
    for name, value in env.items():
        monkeypatch.setattr(settings, name, value)

    async def _boom(db, *args, **kwargs):
        db.add(Incident(title=MARKER, source="manual"))
        raise RuntimeError("the collaborator is down")

    monkeypatch.setattr(importlib.import_module(module), attr, _boom)

    with caplog.at_level(logging.ERROR, logger="app.scheduler"):
        await run_job(getattr(scheduler, job_name))

    failure = next(r for r in caplog.records if r.getMessage() == message)
    assert failure.levelno == logging.ERROR
    assert failure.exc_info is not None  # the traceback is the only diagnosis an unattended job gets
    assert await fresh(select(Incident.title).where(Incident.title == MARKER)) == []


# --- job registration -----------------------------------------------------------------


async def test_the_credential_backed_jobs_are_registered_before_their_credentials_exist(monkeypatch):
    """The invariant the whole «check inside the job» design rests on. Gating registration on
    `settings` at boot is what made browser-set integrations impossible: the missing value was
    only half the problem, the other half was that the job which would have used it was never
    scheduled. So with NOTHING configured, all of them must still be on the timer."""
    import app.plans as plans_mod

    monkeypatch.setattr(plans_mod, "plans_pull_enabled", lambda: False)
    monkeypatch.setattr(settings, "demo_reset_cron", "")
    monkeypatch.setattr(settings, "demo_reset_seconds", 0)
    try:
        scheduler._start_scheduler_jobs()
        ids = {j.id for j in scheduler._scheduler.get_jobs()}
    finally:
        scheduler._stop_scheduler_jobs()

    assert {
        "divera_poll",
        "push_sweep",
        "print_jobs_sweep",
        "vehicle_samples",
        "weather_observe",
        "heartbeat",
        "credentials_refresh",
        "auto_archive",
        "positions_sweep",
        "visit_hashes_sweep",
    } <= ids
    # The two that stay boot-gated, and correctly so: the plan store's bucket credentials are
    # not browser-settable, and a demo wipe is not something a station may switch on by accident.
    assert "plan_pull" not in ids
    assert "demo_reset" not in ids


async def test_the_observers_run_late_rather_than_not_at_all(monkeypatch):
    """APScheduler skips a run that starts >1 s late by default; on the live check (24.09.2026)
    a busy dev worker dropped 9 of 55 GPS sweeps and two 10-minute weather readings."""
    import app.plans as plans_mod

    monkeypatch.setattr(plans_mod, "plans_pull_enabled", lambda: False)
    monkeypatch.setattr(settings, "demo_reset_cron", "")
    monkeypatch.setattr(settings, "demo_reset_seconds", 0)
    try:
        scheduler._start_scheduler_jobs()
        grace = {j.id: j.misfire_grace_time for j in scheduler._scheduler.get_jobs()}
    finally:
        scheduler._stop_scheduler_jobs()
    assert grace["vehicle_samples"] >= 15
    assert grace["weather_observe"] >= 300
    assert grace["divera_poll"] >= 15


async def test_the_plan_pull_is_registered_once_a_plan_store_is_configured(monkeypatch):
    """The one job that is still boot-gated, and correctly so: `PLANS_S3_*` belongs to the
    system that maintains the plan library, so nothing about it can change while we run."""
    import app.plans as plans_mod

    monkeypatch.setattr(plans_mod, "plans_pull_enabled", lambda: True)
    try:
        scheduler._start_scheduler_jobs()
        first = scheduler._scheduler
        ids = {j.id for j in first.get_jobs()}
        count = len(first.get_jobs())
        # A second call must find the running scheduler and leave it alone — two schedulers on
        # one database would run every sweep twice.
        scheduler._start_scheduler_jobs()
        assert scheduler._scheduler is first
        assert len(scheduler._scheduler.get_jobs()) == count
    finally:
        scheduler._stop_scheduler_jobs()

    assert "plan_pull" in ids


@pytest.mark.parametrize(("field", "value"), [("demo_reset_cron", "0 3 * * *"), ("demo_reset_seconds", 900)])
async def test_a_demo_wipe_is_registered_only_with_a_schedule_and_says_so_loudly(field, value, monkeypatch, caplog):
    """This job deletes every incident in the database it runs against. An accidental
    activation on a real station has to be unmissable in the boot log, not a line in a list —
    and that holds for the legacy fixed-interval setting as much as for the cron."""
    monkeypatch.setattr(settings, "demo_reset_cron", "")
    monkeypatch.setattr(settings, "demo_reset_seconds", 0)
    monkeypatch.setattr(settings, field, value)
    try:
        with caplog.at_level(logging.WARNING, logger="app.scheduler"):
            scheduler._start_scheduler_jobs()
        ids = {j.id for j in scheduler._scheduler.get_jobs()}
    finally:
        scheduler._stop_scheduler_jobs()

    assert "demo_reset" in ids
    warned = [r.getMessage() for r in caplog.records if r.name == "app.scheduler" and r.levelno == logging.WARNING]
    assert any("WIPES + reseeds ALL incident data" in m for m in warned)


# --- leadership -----------------------------------------------------------------------


class _LeaderConnection:
    """A dedicated advisory-lock connection, with a scripted failure point."""

    def __init__(self, *, acquired: bool = True, fail_on: str | None = None):
        self.acquired = acquired
        self.fail_on = fail_on
        self.closed = False
        self.statements: list[str] = []

    def _maybe_fail(self, statement: str) -> None:
        if self.fail_on and self.fail_on in statement:
            raise RuntimeError("the leadership connection is gone")

    async def scalar(self, statement, params=None):
        self._maybe_fail(str(statement))
        self.statements.append(str(statement))
        return self.acquired

    async def execute(self, statement, params=None):
        self._maybe_fail(str(statement))
        self.statements.append(str(statement))
        return None

    async def commit(self):
        return None

    async def close(self):
        self.closed = True


def _fake_engine(connection=None, *, dialect: str = "postgresql"):
    async def _connect():
        if connection is None:
            raise AssertionError("no connection should be opened on this dialect")
        return connection

    return SimpleNamespace(dialect=SimpleNamespace(name=dialect), connect=_connect)


async def test_sqlite_runs_the_jobs_without_an_election(monkeypatch):
    """Advisory locks are a PostgreSQL thing. On SQLite (dev + this suite) there is exactly one
    process, so leadership is not merely unavailable but meaningless — and no connection may be
    opened looking for it."""
    monkeypatch.setattr(scheduler, "engine", _fake_engine(None, dialect="sqlite"))

    assert await scheduler._acquire_scheduler_lock() is None


async def test_a_failed_lock_probe_returns_its_connection_before_it_propagates(monkeypatch):
    """The election is retried every 10 s. Leaking the connection of each failed attempt would
    exhaust the pool of a replica that never becomes leader."""
    conn = _LeaderConnection(fail_on="pg_try_advisory_lock")
    monkeypatch.setattr(scheduler, "engine", _fake_engine(conn))

    with pytest.raises(RuntimeError):
        await scheduler._acquire_scheduler_lock()

    assert conn.closed


async def test_releasing_a_dead_connection_still_closes_it_and_clears_the_leader(monkeypatch, caplog):
    """A broken driver on the way out must not stop the shutdown: PostgreSQL has already
    released the session lock with the connection, so this is cleanup, not the release itself."""
    conn = _LeaderConnection(fail_on="pg_advisory_unlock")
    monkeypatch.setattr(scheduler, "_scheduler_leader_connection", conn)

    with caplog.at_level(logging.WARNING, logger="app.scheduler"):
        await scheduler._release_scheduler_lock()

    assert conn.closed
    assert scheduler._scheduler_leader_connection is None
    assert "connection was lost during release" in caplog.text


async def test_releasing_without_leadership_is_a_no_op():
    """Standby replicas call this on every shutdown and hold no lock."""
    await scheduler._release_scheduler_lock()

    assert scheduler._scheduler_leader_connection is None


async def _run_until_cancelled(coro) -> None:
    with suppress(asyncio.CancelledError):
        await coro


async def test_a_standby_promotes_itself_when_the_lock_frees_up(monkeypatch):
    """The failover the whole mechanism exists for: the standby holds no lock, retries, and
    starts the jobs the moment the old leader's connection died and released it."""
    monkeypatch.setattr(scheduler, "SCHEDULER_LEADERSHIP_RETRY_SECONDS", 0)
    started: list[int] = []
    monkeypatch.setattr(scheduler, "_start_scheduler_jobs", lambda: started.append(1))
    conn = _LeaderConnection()  # healthy: once promoted, the loop settles into probing it

    attempts: list[int] = []

    async def _acquire():
        attempts.append(1)
        if len(attempts) == 1:
            return None  # somebody else still holds it
        return conn

    monkeypatch.setattr(scheduler, "_acquire_scheduler_lock", _acquire)
    monkeypatch.setattr(scheduler, "_stop_scheduler_jobs", lambda: None)

    task = asyncio.create_task(scheduler._leadership_loop())
    for _ in range(6):  # let the loop turn: standby → election → promotion
        await asyncio.sleep(0)
    task.cancel()
    await _run_until_cancelled(task)

    assert started == [1]  # promoted exactly once, and only after the second election
    assert len(attempts) >= 2


async def test_an_election_that_raises_leaves_the_watch_standing(monkeypatch):
    """A database that refuses the election must not end the loop: this task IS the failover,
    so a replica that stops standing for election can never take over from a dead leader."""
    monkeypatch.setattr(scheduler, "SCHEDULER_LEADERSHIP_RETRY_SECONDS", 0)
    attempts: list[int] = []
    started: list[int] = []
    monkeypatch.setattr(scheduler, "_start_scheduler_jobs", lambda: started.append(1))

    async def _acquire():
        attempts.append(1)
        raise RuntimeError("no connection to be had")

    monkeypatch.setattr(scheduler, "_acquire_scheduler_lock", _acquire)

    task = asyncio.create_task(scheduler._leadership_loop())
    for _ in range(4):
        await asyncio.sleep(0)
    still_running = not task.done()
    task.cancel()
    await _run_until_cancelled(task)

    assert still_running
    assert len(attempts) >= 2  # it kept standing for election
    assert started == []


async def test_losing_the_connection_stops_the_jobs_before_re_electing(monkeypatch):
    """Order matters: a leader whose session lock is gone is no longer the leader, and a second
    process may already be running these jobs. Stop first, then stand for election again."""
    monkeypatch.setattr(scheduler, "SCHEDULER_LEADERSHIP_RETRY_SECONDS", 0)
    order: list[str] = []
    conn = _LeaderConnection(fail_on="SELECT 1")
    monkeypatch.setattr(scheduler, "_scheduler_leader_connection", conn)
    monkeypatch.setattr(scheduler, "_stop_scheduler_jobs", lambda: order.append("stopped"))
    monkeypatch.setattr(scheduler, "_start_scheduler_jobs", lambda: order.append("started"))

    async def _acquire():
        order.append("election")
        return None

    monkeypatch.setattr(scheduler, "_acquire_scheduler_lock", _acquire)

    task = asyncio.create_task(scheduler._leadership_loop())
    for _ in range(6):
        await asyncio.sleep(0)
    task.cancel()
    await _run_until_cancelled(task)

    assert order[:2] == ["stopped", "election"]
    assert "started" not in order  # the lock was not free again
    assert conn.closed
    assert scheduler._scheduler_leader_connection is None


# --- start / stop ---------------------------------------------------------------------


async def test_outside_production_the_jobs_run_without_an_election(monkeypatch):
    """Leadership is a production topology concern. Holding a pooled connection across
    pytest's per-test event loops is also how this suite would hang."""
    started: list[int] = []
    monkeypatch.setattr(scheduler, "_start_scheduler_jobs", lambda: started.append(1))
    monkeypatch.setattr(type(settings), "is_production", property(lambda _s: False))

    await scheduler.start_scheduler(FastAPI())

    assert started == [1]
    assert scheduler._leadership_task is None


async def test_starting_twice_does_not_register_a_second_set_of_jobs(monkeypatch):
    """The lifespan can be entered more than once (the reloading dev server, a re-mounted app);
    two schedulers on the same database would double every sweep."""
    started: list[int] = []
    monkeypatch.setattr(scheduler, "_start_scheduler_jobs", lambda: started.append(1))
    monkeypatch.setattr(scheduler, "_scheduler", object())

    await scheduler.start_scheduler(FastAPI())

    assert started == []


async def test_a_production_standby_keeps_watching_without_running_jobs(monkeypatch):
    monkeypatch.setattr(type(settings), "is_production", property(lambda _s: True))
    monkeypatch.setattr(scheduler, "engine", _fake_engine(_LeaderConnection(acquired=False)))
    started: list[int] = []
    monkeypatch.setattr(scheduler, "_start_scheduler_jobs", lambda: started.append(1))
    monkeypatch.setattr(scheduler, "_stop_scheduler_jobs", lambda: None)
    monkeypatch.setattr(scheduler, "_leadership_loop", _forever)

    await scheduler.start_scheduler(FastAPI())
    try:
        assert started == []
        assert scheduler._leadership_task is not None  # standby, but standing for re-election
    finally:
        await scheduler.stop_scheduler()


async def test_the_production_leader_starts_the_jobs_and_hands_the_lock_back_on_shutdown(monkeypatch):
    """The production happy path: one replica wins the advisory lock, runs the jobs, and gives
    the lock back explicitly on the way out so a rolling deploy's successor can take it."""
    monkeypatch.setattr(type(settings), "is_production", property(lambda _s: True))
    conn = _LeaderConnection(acquired=True)
    monkeypatch.setattr(scheduler, "engine", _fake_engine(conn))
    started: list[int] = []
    monkeypatch.setattr(scheduler, "_start_scheduler_jobs", lambda: started.append(1))
    monkeypatch.setattr(scheduler, "_stop_scheduler_jobs", lambda: None)
    monkeypatch.setattr(scheduler, "_leadership_loop", _forever)

    await scheduler.start_scheduler(FastAPI())
    assert started == [1]
    assert scheduler._scheduler_leader_connection is conn

    await scheduler.stop_scheduler()

    assert conn.statements == ["SELECT pg_try_advisory_lock(:lock_id)", "SELECT pg_advisory_unlock(:lock_id)"]
    assert conn.closed


async def test_a_failed_boot_election_enters_standby_instead_of_failing_the_boot(monkeypatch, caplog):
    """Serving the app is the job; running the sweeps is a bonus this replica can pick up
    later. A database that is not ready yet must not take the whole process down with it."""
    monkeypatch.setattr(type(settings), "is_production", property(lambda _s: True))
    monkeypatch.setattr(scheduler, "engine", _fake_engine(_LeaderConnection(fail_on="pg_try_advisory_lock")))
    started: list[int] = []
    monkeypatch.setattr(scheduler, "_start_scheduler_jobs", lambda: started.append(1))
    monkeypatch.setattr(scheduler, "_stop_scheduler_jobs", lambda: None)
    monkeypatch.setattr(scheduler, "_leadership_loop", _forever)

    with caplog.at_level(logging.WARNING, logger="app.scheduler"):
        await scheduler.start_scheduler(FastAPI())
    try:
        assert started == []
        assert "election failed" in caplog.text
        assert scheduler._leadership_task is not None
    finally:
        await scheduler.stop_scheduler()


async def test_stopping_cancels_the_watch_releases_the_lock_and_stops_the_jobs(monkeypatch):
    stopped: list[int] = []
    conn = _LeaderConnection()
    monkeypatch.setattr(scheduler, "_stop_scheduler_jobs", lambda: stopped.append(1))
    monkeypatch.setattr(scheduler, "_scheduler_leader_connection", conn)
    task = asyncio.create_task(_forever())
    monkeypatch.setattr(scheduler, "_leadership_task", task)

    await scheduler.stop_scheduler()

    assert task.cancelled()
    assert stopped == [1]
    assert conn.statements == ["SELECT pg_advisory_unlock(:lock_id)"]
    assert conn.closed
    assert scheduler._leadership_task is None


async def _forever() -> None:
    """A watch task that never finishes on its own — only `stop_scheduler` ends it."""
    await asyncio.Event().wait()
