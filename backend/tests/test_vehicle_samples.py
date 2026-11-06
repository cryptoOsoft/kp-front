"""The Traccar → vehicle_samples capture job (scheduler._vehicle_samples_sweep).

`GET /incidents/{id}/samples`, its schema and the client-side replay all shipped long ago and
read an empty table: nothing ever wrote a row (the endpoint's own docstring said so —
"PLAN-audit-trail §4, Phase 6"). So the Verlauf could replay drawings and journal rows but not
where the vehicles went, which is the one part of a replay nobody can reconstruct from memory.

What this file pins is the sampling RULE, because that is the part with a judgement in it: a
track dense enough to redraw the route, without a row per truck per tick for a fleet that
spent six hours parked at the Magazin.
"""

from datetime import UTC, datetime, timedelta

import pytest

from app import scheduler
from app.models import Incident, VehicleSample
from app.traccar import VehiclePosition


class _SessionCtx:
    """Hand the sweep the test's session without letting `async with` close it."""

    def __init__(self, session):
        self._session = session

    async def __aenter__(self):
        return self._session

    async def __aexit__(self, *exc):
        return False


def _pos(device_id: int, lat: float, lng: float, *, ts: datetime | None = None) -> VehiclePosition:
    return VehiclePosition(
        device_id=device_id,
        device_name=f"TLF {device_id}",
        unique_id=f"u{device_id}",
        status="online",
        latitude=lat,
        longitude=lng,
        speed=0.0,
        course=90.0,
        last_update=ts or datetime.now(UTC),
    )


@pytest.fixture
def traccar(monkeypatch):
    """A configured Traccar whose feed the test drives."""
    feed: list[VehiclePosition] = []

    class _Client:
        is_configured = True

        async def get_vehicle_positions(self):
            return list(feed)

    import app.traccar as traccar_mod

    monkeypatch.setattr(traccar_mod, "traccar_client", _Client())
    return feed


@pytest.fixture
async def incident(db_session):
    inc = Incident(title="Brand Hauptstrasse 4", source="manual", status="offen")
    db_session.add(inc)
    await db_session.commit()
    await db_session.refresh(inc)
    return inc


@pytest.fixture(autouse=True)
def _clean_memo():
    """The sweep remembers what it last wrote per (incident, device) in module state."""
    scheduler._last_sample.clear()
    yield
    scheduler._last_sample.clear()


async def _sweep(db_session, monkeypatch) -> None:
    monkeypatch.setattr(scheduler, "async_session_maker", lambda: _SessionCtx(db_session))
    await scheduler._vehicle_samples_sweep()


async def _rows(db_session, incident) -> list[tuple]:
    from sqlalchemy import select

    return list(
        (
            await db_session.execute(
                select(VehicleSample.device_id, VehicleSample.lat, VehicleSample.lng)
                .where(VehicleSample.incident_id == incident.id)
                .order_by(VehicleSample.ts.asc())
            )
        ).all()
    )


async def test_a_moving_vehicle_is_recorded(db_session, incident, traccar, monkeypatch):
    t0 = datetime.now(UTC) - timedelta(minutes=5)
    traccar.append(_pos(1, 47.5163, 7.5617, ts=t0))
    await _sweep(db_session, monkeypatch)
    assert len(await _rows(db_session, incident)) == 1

    # ~150 m east — a real move
    traccar[0] = _pos(1, 47.5163, 7.5637, ts=t0 + timedelta(seconds=30))
    await _sweep(db_session, monkeypatch)
    assert len(await _rows(db_session, incident)) == 2


async def test_a_parked_vehicle_does_not_fill_the_table(db_session, incident, traccar, monkeypatch):
    """The whole reason for a movement threshold: a fleet at the Magazin would otherwise write
    a row per truck every 30 s, and a replay would scrub through hours of nothing."""
    traccar.append(_pos(1, 47.5163, 7.5617))
    await _sweep(db_session, monkeypatch)
    for _ in range(5):
        await _sweep(db_session, monkeypatch)
    assert len(await _rows(db_session, incident)) == 1


async def test_a_tracker_that_repeats_one_fix_is_recorded_once(db_session, incident, traccar, monkeypatch):
    """THE production bug (2026-08-06). A parked tracker stops advancing its fix time and
    Traccar re-serves that one fix forever. The first version measured the heartbeat against
    that DEVICE time, so every vehicle looked permanently stale and got a row on every tick —
    8 rows a minute across the fleet, every one at an identical position.

    Nothing new from the device means nothing to record. It also keeps «we stopped hearing
    from it» legible: the track stops, instead of filling with copies of its last position.
    """
    fixed = datetime.now(UTC) - timedelta(hours=3)  # a fix far older than any heartbeat
    traccar.append(_pos(1, 47.5163, 7.5617, ts=fixed))
    for _ in range(40):
        await _sweep(db_session, monkeypatch)
    assert len(await _rows(db_session, incident)) == 1


async def test_a_stationary_vehicle_still_gets_a_heartbeat(db_session, incident, traccar, monkeypatch):
    """«Parked here the whole time» has to be distinguishable from «we stopped hearing from it».

    A tracker that keeps REPORTING while standing still advances its fix time without moving,
    and that earns a row once per heartbeat — enough to draw «still here» without a track made
    of duplicates.
    """
    t0 = datetime.now(UTC) - timedelta(hours=1)
    traccar.append(_pos(1, 47.5163, 7.5617, ts=t0))
    await _sweep(db_session, monkeypatch)

    # same spot, fresher fix, but not yet a heartbeat later
    traccar[0] = _pos(1, 47.5163, 7.5617, ts=t0 + timedelta(seconds=60))
    await _sweep(db_session, monkeypatch)
    assert len(await _rows(db_session, incident)) == 1

    # …and now past it
    traccar[0] = _pos(1, 47.5163, 7.5617, ts=t0 + timedelta(seconds=scheduler.VEHICLE_SAMPLE_HEARTBEAT_SECONDS + 30))
    await _sweep(db_session, monkeypatch)
    assert len(await _rows(db_session, incident)) == 2


async def test_a_restart_does_not_duplicate_the_fix_it_comes_up_on(db_session, incident, traccar, monkeypatch):
    """Every deploy restarts the process and empties the memo. Without seeding it from the
    table, the first tick would re-record whatever fix the tracker is currently repeating —
    one duplicate per vehicle per deploy, quietly, forever."""
    fixed = datetime.now(UTC) - timedelta(hours=2)
    traccar.append(_pos(1, 47.5163, 7.5617, ts=fixed))
    await _sweep(db_session, monkeypatch)
    assert len(await _rows(db_session, incident)) == 1

    scheduler._last_sample.clear()  # ← the restart
    await _sweep(db_session, monkeypatch)
    await _sweep(db_session, monkeypatch)
    assert len(await _rows(db_session, incident)) == 1


async def test_nothing_is_recorded_for_a_finished_einsatz(db_session, incident, traccar, monkeypatch):
    incident.is_archived = True
    await db_session.commit()
    traccar.append(_pos(1, 47.5163, 7.5617))
    await _sweep(db_session, monkeypatch)
    assert await _rows(db_session, incident) == []


async def test_a_lern_uebung_gets_no_track(db_session, traccar, monkeypatch):
    """A tutorial («Üben», source 'training') is not an Einsatz the fleet drives to."""
    lern = Incident(title="Lernen · Trupps", source="training", status="offen", is_exercise=True)
    db_session.add(lern)
    await db_session.commit()
    traccar.append(_pos(1, 47.5163, 7.5617))
    await _sweep(db_session, monkeypatch)
    assert await _rows(db_session, lern) == []


async def test_every_open_einsatz_gets_its_own_track(db_session, traccar, monkeypatch):
    """Two Einsätze running at once each need the full picture — a shared fleet is sampled into
    both, because a replay of one must not depend on what the other was doing."""
    a = Incident(title="A", source="manual", status="offen")
    b = Incident(title="B", source="manual", status="in_arbeit")
    db_session.add_all([a, b])
    await db_session.commit()
    await db_session.refresh(a)
    await db_session.refresh(b)

    traccar.append(_pos(1, 47.5163, 7.5617))
    await _sweep(db_session, monkeypatch)
    assert len(await _rows(db_session, a)) == 1
    assert len(await _rows(db_session, b)) == 1
