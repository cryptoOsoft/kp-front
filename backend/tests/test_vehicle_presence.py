"""The server observes «vor Ort» / «verlassen» (app.vehicle_presence, 24.09.2026 — D2).

What the Übung of 23.09.2026 showed: GPS had the first three vehicles on scene at 19:23–19:24, the Verlauf
said 19:43 for all five — the moment a tablet woke up. What this file pins:

* the RULES are the client hook's, number for number (rings, band, settle, silent baseline);
* the STAMP is the first GPS fix in the new zone, not when anybody (the server included) noticed;
* the Verlauf gets the first arrival and the last departure, the trips between are counted;
* the record CONVERGES: a restart or a second worker writes nothing twice;
* first writer wins against the external geofence, and `manual` times are never touched;
* an older client's own presence rows are acknowledged and dropped.
"""

from datetime import UTC, datetime, timedelta

import pytest
from sqlalchemy import select

from app import vehicle_presence as vp
from app.api.alarms import apply_milestones
from app.models import DeploymentConfig, Incident, IncidentEvent, JournalEntry
from app.schemas import MilestonesIn
from app.traccar import VehiclePosition

LAT, LNG = 46.9480, 7.4474
#: ~1 km east — «weg»
AWAY = (LAT, LNG + 0.0133)
#: ~200 m east — the band between the rings
BAND = (LAT, LNG + 0.00266)
T0 = datetime(2026, 9, 23, 17, 20, tzinfo=UTC)


def _pos(where: tuple[float, float], ts: datetime, *, device_id: int = 3, name: str = "TLF") -> VehiclePosition:
    return VehiclePosition(
        device_id=device_id,
        device_name=name,
        unique_id=name.lower(),
        status="online",
        latitude=where[0],
        longitude=where[1],
        last_update=ts,
    )


SCENE = (LAT, LNG)


@pytest.fixture(autouse=True)
def _clean_state():
    vp.reset_state()
    yield
    vp.reset_state()


# --- the pure state machine -------------------------------------------------------------


def test_the_rings_are_the_client_hooks_numbers():
    assert (vp.AT_SCENE_M, vp.LEFT_M, vp.SETTLE_S) == (150.0, 300.0, 90)
    assert vp.zone_of(150) == "scene"
    assert vp.zone_of(151) is None and vp.zone_of(299) is None
    assert vp.zone_of(300) == "away"


def test_the_first_reading_is_a_silent_baseline_and_the_band_says_nothing():
    s = vp.step(None, 220, T0, T0)
    assert s.state is None and not s.baseline  # the band starts nothing
    s = vp.step(None, 40, T0, T0)
    assert s.baseline and s.transition is None
    assert s.state is not None and s.state.zone == "scene" and s.state.fahrten == 1
    assert s.state.first_arrival is None  # nobody knows when it came


def test_a_transition_is_stamped_with_the_first_fix_in_the_new_zone():
    st = vp.step(None, 1000, T0, T0).state
    first = T0 + timedelta(seconds=30)
    st = vp.step(st, 40, first, first + timedelta(seconds=5)).state
    # 60 s of fix time — not settled
    s = vp.step(st, 30, first + timedelta(seconds=60), first + timedelta(seconds=65))
    assert s.transition is None
    # 90 s of fix time — settled, stamped with the FIRST fix, not with this one
    s = vp.step(s.state, 30, first + timedelta(seconds=90), first + timedelta(seconds=95))
    assert s.transition == "scene"
    assert s.state is not None
    assert s.state.first_arrival == first and s.state.n == 1 and s.state.fahrten == 1


def test_a_tracker_that_stops_reporting_still_settles_on_the_servers_clock():
    """Traccar re-serves a parked tracker's last fix forever; the fix time never advances."""
    st = vp.step(None, 1000, T0, T0).state
    fix = T0 + timedelta(seconds=30)
    st = vp.step(st, 40, fix, fix).state
    s = vp.step(st, 40, fix, fix + timedelta(seconds=91))
    assert s.transition == "scene" and s.state is not None and s.state.first_arrival == fix


def test_the_band_interrupts_a_settle():
    st = vp.step(None, 1000, T0, T0).state
    st = vp.step(st, 40, T0 + timedelta(seconds=10), T0 + timedelta(seconds=10)).state
    st = vp.step(st, 220, T0 + timedelta(seconds=60), T0 + timedelta(seconds=60)).state  # scatter
    s = vp.step(st, 40, T0 + timedelta(seconds=100), T0 + timedelta(seconds=100))
    assert s.transition is None  # a fresh settle starts here
    assert s.state is not None and s.state.pending_fix == T0 + timedelta(seconds=100)


def _drive(st, zones_and_times):
    """Settle into each zone at each time (first fix = the given time)."""
    transitions = []
    for zone, t in zones_and_times:
        d = 20 if zone == "scene" else 1000
        st = vp.step(st, d, t, t).state
        s = vp.step(st, d, t + timedelta(seconds=90), t + timedelta(seconds=90))
        transitions.append(s.transition)
        st = s.state
    return st, transitions


def test_a_shuttle_is_counted_and_keeps_its_first_arrival_and_last_departure():
    st = vp.step(None, 1000, T0, T0).state
    st, tr = _drive(
        st,
        [
            ("scene", T0 + timedelta(minutes=8)),  # 19:28 in the Übung
            ("away", T0 + timedelta(minutes=20)),
            ("scene", T0 + timedelta(minutes=30)),
            ("away", T0 + timedelta(minutes=40)),
            ("scene", T0 + timedelta(minutes=50)),
            ("away", T0 + timedelta(minutes=77)),
        ],
    )
    assert tr == ["scene", "away", "scene", "away", "scene", "away"]
    assert st.fahrten == 3 and st.n == 6
    assert st.first_arrival == T0 + timedelta(minutes=8)
    assert st.last_departure == T0 + timedelta(minutes=77)
    assert st.departure_owed == T0 + timedelta(minutes=77)  # only the LAST one is owed


def test_a_departure_is_owed_until_the_vehicle_stayed_away_or_the_einsatz_ends():
    st = vp.step(None, 20, T0, T0).state
    st, _ = _drive(st, [("away", T0 + timedelta(minutes=5))])
    assert not vp.departure_due(st, T0 + timedelta(minutes=10))
    assert vp.departure_due(st, T0 + timedelta(minutes=10), closing=True)
    assert vp.departure_due(st, T0 + timedelta(minutes=5, seconds=vp.FINAL_AWAY_S))
    # …and a vehicle that came back owes nothing: that departure was a trip
    st, _ = _drive(st, [("scene", T0 + timedelta(minutes=15))])
    assert st.departure_owed is None


def test_a_vehicle_already_on_scene_at_the_opening_has_no_arrival_time():
    st = vp.step(None, 20, T0, T0).state
    st, _ = _drive(st, [("away", T0 + timedelta(minutes=5)), ("scene", T0 + timedelta(minutes=15))])
    assert st.first_arrival is None and st.fahrten == 2


# --- the blob: first writer wins, manual never touched ---------------------------------


def _presence(**kw) -> vp.Presence:
    base = {"zone": "scene", "n": 1, "fahrten": 1, "first_arrival": T0}
    base.update(kw)
    return vp.Presence(**base)  # type: ignore[arg-type]


def test_the_server_stamps_vor_ort_when_nobody_did():
    ws, changed, ours = vp.apply_gps_presence(None, "tlf", _presence())
    row = ws["reportMeta"]["fahrzeuge"][0]
    assert changed and ours
    assert row["vorOrt"] == T0.isoformat()
    assert row["gps"] == {"zone": "scene", "fahrten": 1, "an": T0.isoformat(), "owns": ["vorOrt"]}


def test_the_external_geofence_was_first_so_its_vor_ort_stands():
    ext = "2026-09-23T17:23:00+00:00"
    ws = {"reportMeta": {"fahrzeuge": [{"id": "tlf", "vorOrt": ext}]}}
    ws, _, ours = vp.apply_gps_presence(ws, "tlf", _presence())
    row = ws["reportMeta"]["fahrzeuge"][0]
    assert row["vorOrt"] == ext and not ours
    assert "owns" not in row["gps"]


def test_the_server_was_first_so_the_webhook_does_not_overwrite_it():
    ws, _, _ = vp.apply_gps_presence(None, "tlf", _presence())
    late = MilestonesIn(divera_id=1, vehicles=[{"id": "tlf", "vorOrt": "2026-09-23T17:43:00Z"}])
    ws2, changed, journal = apply_milestones(ws, late, {}, {"tlf": "TLF"})
    assert ws2["reportMeta"]["fahrzeuge"][0]["vorOrt"] == T0.isoformat()
    assert changed == 0 and journal == []


def test_a_manual_row_keeps_its_times_but_the_table_still_learns():
    ws = {"reportMeta": {"fahrzeuge": [{"id": "tlf", "vorOrt": "2026-09-23T17:30:00+00:00", "manual": True}]}}
    ws, changed, ours = vp.apply_gps_presence(ws, "tlf", _presence(zone="away", n=2, last_departure=T0))
    row = ws["reportMeta"]["fahrzeuge"][0]
    assert row["vorOrt"] == "2026-09-23T17:30:00+00:00" and "zurueck" not in row
    assert changed and row["gps"]["zone"] == "away" and ours  # a person's time: the row is still ours


def test_the_scene_departure_lives_in_gps_ab_and_zurueck_stays_the_geofences():
    """Decided 25.09.2026: `zurueck` is «back at the DEPOT» in the milestone vocabulary. The scene
    rings cannot know that, so the server never writes it — the departure is `gps.ab`."""
    ws, _, _ = vp.apply_gps_presence(None, "mtf", _presence(zone="away", n=2, last_departure=T0))
    later = T0 + timedelta(minutes=30)
    ws, _, _ = vp.apply_gps_presence(ws, "mtf", _presence(zone="away", n=4, fahrten=2, last_departure=later))
    row = ws["reportMeta"]["fahrzeuge"][0]
    assert "zurueck" not in row and row["gps"]["ab"] == later.isoformat() and row["gps"]["fahrten"] == 2
    assert row["gps"]["owns"] == ["vorOrt"]
    # …and the geofence's «zurück» lands, before or after the server's observation
    back = MilestonesIn(divera_id=1, vehicles=[{"id": "mtf", "zurueck": "2026-09-23T18:10:00Z"}])
    ws, changed, _ = apply_milestones(ws, back, {}, {"mtf": "MTF"})
    assert changed == 1 and ws["reportMeta"]["fahrzeuge"][0]["zurueck"] == "2026-09-23T18:10:00+00:00"


# --- the tick, against the database ------------------------------------------------------


@pytest.fixture
async def incident(db_session):
    db_session.add(DeploymentConfig(id=1, config_json={"fleet": {"vehicles": [{"id": "tlf", "label": "TLF"}]}}))
    inc = Incident(
        title="Übung Musterstrasse",
        source="manual",
        status="offen",
        is_exercise=True,  # Übungen are observed too
        lat=LAT,
        lng=LNG,
        started_at=datetime.now(UTC) - timedelta(minutes=30),
    )
    db_session.add(inc)
    await db_session.commit()
    await db_session.refresh(inc)
    return inc


async def _run(db, positions, now: datetime) -> int:
    """A tick the way the scheduler runs it: observe, commit, THEN apply the memory."""
    tick = await vp.observe(db, positions, now)
    await db.commit()
    tick.commit()
    return tick.written


async def _tick(db, where, fix: datetime, now: datetime | None = None, **kw) -> int:
    return await _run(db, [_pos(where, fix, **kw)], now or fix)


async def _settle(db, where, first: datetime, **kw) -> None:
    for s in (0, 30, 60, 90):
        await _tick(db, where, first + timedelta(seconds=s), **kw)


async def _rows(db, incident) -> list[dict]:
    return [
        r.row_json
        for r in (
            await db.execute(
                select(JournalEntry).where(JournalEntry.incident_id == incident.id).order_by(JournalEntry.seq)
            )
        ).scalars()
    ]


async def _events(db, incident) -> list[IncidentEvent]:
    return list(
        (
            await db.execute(
                select(IncidentEvent)
                .where(IncidentEvent.incident_id == incident.id, IncidentEvent.op_type == vp.OP_TYPE)
                .order_by(IncidentEvent.seq)
            )
        ).scalars()
    )


async def test_an_arrival_reaches_the_verlauf_and_the_rapport_with_the_fix_time(db_session, incident):
    now = datetime.now(UTC)
    await _tick(db_session, AWAY, now - timedelta(minutes=10))
    arrived = now - timedelta(minutes=8)
    await _settle(db_session, SCENE, arrived)

    rows = await _rows(db_session, incident)
    assert [(r["id"], r["text"], r["at"]) for r in rows] == [("vps-1-scene-gps-3", "TLF vor Ort", arrived.isoformat())]
    assert rows[0]["entityId"] == "gps-3"
    events = await _events(db_session, incident)
    assert [e.client_id for e in events] == ["vp:3:0", "vp:3:1"]
    assert events[1].occurred_at.replace(tzinfo=UTC) == arrived
    await db_session.refresh(incident)
    row = incident.map_workspace_json["reportMeta"]["fahrzeuge"][0]
    assert row["id"] == "tlf" and row["vorOrt"] == arrived.isoformat() and row["gps"]["zone"] == "scene"


async def test_a_vehicle_that_never_came_has_no_line_in_the_table(db_session, incident):
    """Every station vehicle starts «away» from every open Einsatz — the second, unrelated one
    too. Only a vehicle that has been on scene gets a row (found on the live check, 24.09.2026)."""
    now = datetime.now(UTC)
    await _tick(db_session, AWAY, now - timedelta(minutes=2))
    await _tick(db_session, AWAY, now)
    await db_session.refresh(incident)
    assert not (incident.map_workspace_json or {}).get("reportMeta")
    assert [e.client_id for e in await _events(db_session, incident)] == ["vp:3:0"]  # the baseline is recorded


async def test_the_trips_between_are_counted_not_written(db_session, incident):
    now = datetime.now(UTC)
    t = now - timedelta(hours=2)
    await _tick(db_session, AWAY, t)
    await _settle(db_session, SCENE, t + timedelta(minutes=5))
    await _settle(db_session, AWAY, t + timedelta(minutes=15))
    await _settle(db_session, SCENE, t + timedelta(minutes=25))
    last = t + timedelta(minutes=35)
    await _settle(db_session, AWAY, last)
    # still owed: the vehicle has been gone for less than FINAL_AWAY_S
    assert [r["id"] for r in await _rows(db_session, incident)] == ["vps-1-scene-gps-3"]
    # …and once it stayed away, the LAST departure is written, stamped when it left
    await _tick(db_session, AWAY, last + timedelta(seconds=vp.FINAL_AWAY_S + 60))
    rows = await _rows(db_session, incident)
    assert [r["id"] for r in rows] == ["vps-1-scene-gps-3", "vps-4-away-gps-3"]
    assert rows[1]["at"] == last.isoformat() and rows[1]["text"] == "TLF hat den Einsatzort verlassen"
    await db_session.refresh(incident)
    gps = incident.map_workspace_json["reportMeta"]["fahrzeuge"][0]["gps"]
    assert gps["fahrten"] == 2 and gps["ab"] == last.isoformat()


async def test_a_restart_rebuilds_from_the_record_and_writes_nothing_twice(db_session, incident):
    now = datetime.now(UTC)
    await _tick(db_session, AWAY, now - timedelta(minutes=10))
    await _settle(db_session, SCENE, now - timedelta(minutes=8))
    before = (len(await _rows(db_session, incident)), len(await _events(db_session, incident)))

    vp.reset_state()  # the deploy
    await _tick(db_session, SCENE, now - timedelta(minutes=1))
    await _tick(db_session, SCENE, now)
    assert (len(await _rows(db_session, incident)), len(await _events(db_session, incident))) == before
    # and the rebuilt state carries on counting from where the record stood
    state = vp._state[(str(incident.id), 3)]
    assert state is not None and state.zone == "scene" and state.n == 1


async def test_a_departure_owed_across_a_restart_is_still_written_once(db_session, incident):
    now = datetime.now(UTC)
    t = now - timedelta(hours=1)
    await _tick(db_session, SCENE, t)
    await _settle(db_session, AWAY, t + timedelta(minutes=5))
    vp.reset_state()
    await _tick(db_session, AWAY, now)  # rebuilt, and 55 min away: due
    vp.reset_state()
    await _tick(db_session, AWAY, now + timedelta(seconds=30))  # rebuilt again: already written
    assert [r["id"] for r in await _rows(db_session, incident)] == ["vps-1-away-gps-3"]


async def test_closing_the_einsatz_writes_the_owed_departure(db_session, incident):
    now = datetime.now(UTC)
    await _tick(db_session, SCENE, now - timedelta(minutes=10))
    left = now - timedelta(minutes=5)
    await _settle(db_session, AWAY, left)
    assert await _rows(db_session, incident) == []
    incident.status = "abgeschlossen"
    incident.is_archived = True
    await db_session.commit()
    await _run(db_session, [], now)
    rows = await _rows(db_session, incident)
    assert [(r["id"], r["at"]) for r in rows] == [("vps-1-away-gps-3", left.isoformat())]


async def test_the_external_geofence_first_means_no_second_vor_ort_row(db_session, incident):
    incident.map_workspace_json = {"reportMeta": {"fahrzeuge": [{"id": "tlf", "vorOrt": "2026-09-23T17:23:00+00:00"}]}}
    await db_session.commit()
    now = datetime.now(UTC)
    await _tick(db_session, AWAY, now - timedelta(minutes=10))
    await _settle(db_session, SCENE, now - timedelta(minutes=8))
    assert await _rows(db_session, incident) == []  # the webhook's «TLF vor Ort 19:23» is the row
    await db_session.refresh(incident)
    assert incident.map_workspace_json["reportMeta"]["fahrzeuge"][0]["vorOrt"] == "2026-09-23T17:23:00+00:00"


async def test_a_tracker_that_is_not_a_station_vehicle_gets_rows_but_no_rapport_line(db_session, incident):
    now = datetime.now(UTC)
    await _tick(db_session, AWAY, now - timedelta(minutes=10), device_id=9, name="Privat")
    await _settle(db_session, SCENE, now - timedelta(minutes=8), device_id=9, name="Privat")
    assert [r["text"] for r in await _rows(db_session, incident)] == ["Privat vor Ort"]
    await db_session.refresh(incident)
    assert not (incident.map_workspace_json or {}).get("reportMeta")


@pytest.mark.parametrize(
    "change",
    [
        {"lat": 0.0, "lng": 0.0},  # Divera's «no location»
        {"lat": None, "lng": None},
        {"started_at": datetime.now(UTC) - timedelta(hours=25)},
        {"status": "abgeschlossen"},
        # a Lern-Übung, seeded at the station's centre: the TLF parked there is no «vor Ort»
        {"source": "training"},
    ],
)
async def test_only_an_active_einsatz_is_observed(db_session, incident, change):
    for k, v in change.items():
        setattr(incident, k, v)
    await db_session.commit()
    assert await vp.active_incidents(db_session, datetime.now(UTC)) == []
    assert await _tick(db_session, SCENE, datetime.now(UTC)) == 0


# --- the fake fleet reaches the sweep ------------------------------------------------------


async def test_the_fake_fleet_is_what_the_sweep_reads(db_session, incident, monkeypatch):
    """The known gap of the design: `/api/traccar/fake` only ever reached the map."""
    from app import scheduler, traccar
    from app.config import settings

    class _Ctx:
        async def __aenter__(self):
            return db_session

        async def __aexit__(self, *exc):
            return False

    monkeypatch.setattr(settings, "traccar_fake", True)
    monkeypatch.setattr(scheduler, "async_session_maker", lambda: _Ctx())
    monkeypatch.setattr(traccar, "fake_positions", [_pos(SCENE, datetime.now(UTC))])
    scheduler._last_sample.clear()
    await scheduler._vehicle_samples_sweep()
    assert [e.client_id for e in await _events(db_session, incident)] == ["vp:3:0"]


# --- an older client's own rows ------------------------------------------------------------


async def test_an_older_clients_presence_rows_are_acknowledged_and_dropped(client, editor):
    r = await client.post("/api/auth/login", json={"user_id": str(editor.id), "pin": "135790"})
    assert r.status_code == 200
    inc = (await client.post("/api/incidents", json={"title": "Mixed"})).json()["id"]
    rows = [
        {"id": "vp-1-scene-gps-3", "t": "19:43", "icon": "truck", "text": "TLF vor Ort"},
        # a client must never write the server's own shape either
        {"id": "vps-2-away-gps-3", "t": "19:44", "icon": "truck", "text": "TLF hat den Einsatzort verlassen"},
        {"id": "t1", "t": "19:44", "icon": "flag", "text": "Lage erkundet"},
    ]
    r = await client.post(f"/api/incidents/{inc}/journal", json={"entries": rows})
    assert r.status_code == 201
    assert [e["row"]["id"] for e in r.json()["entries"]] == ["t1"]
    page = (await client.get(f"/api/incidents/{inc}/journal")).json()
    assert [e["row"]["id"] for e in page["entries"]] == ["t1"]


# --- review of 25.09.2026 ---------------------------------------------------------------------


async def test_a_tick_that_fails_midway_loses_no_transition(db_session, incident, monkeypatch):
    """The memory moves on only after the commit. A tick that raised used to leave `_state`
    advanced over a rolled-back database: the arrival was never written, and came back later
    stamped with the post-restart time."""
    import app.api.journal as journal_mod

    now = datetime.now(UTC)
    await _tick(db_session, AWAY, now - timedelta(minutes=10))
    first = now - timedelta(minutes=8)
    for s in (0, 30, 60):
        await _tick(db_session, SCENE, first + timedelta(seconds=s))

    real = journal_mod.append_rows

    async def _boom(*a, **k):
        raise RuntimeError("the database went away mid-tick")

    monkeypatch.setattr(journal_mod, "append_rows", _boom)
    with pytest.raises(RuntimeError):
        await vp.observe(db_session, [_pos(SCENE, first + timedelta(seconds=90))], first + timedelta(seconds=90))
    await db_session.rollback()  # what the scheduler does; tick.commit() never ran
    await db_session.refresh(incident)
    monkeypatch.setattr(journal_mod, "append_rows", real)

    assert await _rows(db_session, incident) == []
    await _tick(db_session, SCENE, first + timedelta(seconds=120))
    rows = await _rows(db_session, incident)
    assert [(r["id"], r["at"]) for r in rows] == [("vps-1-scene-gps-3", first.isoformat())]


async def test_every_observer_walks_the_einsaetze_in_one_order(db_session, incident):
    """Presence and weather each hold incident row locks until their commit; walking the same
    Einsätze in two orders is a deadlock. Both walk them by id."""
    for i in range(4):
        db_session.add(Incident(title=f"E{i}", source="manual", status="offen", lat=LAT, lng=LNG + i / 100))
    await db_session.commit()
    ids = [str(i.id) for i in await vp.active_incidents(db_session, datetime.now(UTC))]
    assert len(ids) == 5 and ids == sorted(ids)


async def test_a_row_an_older_client_wrote_before_the_deploy_does_not_swallow_the_servers(db_session, incident):
    """The old hook wrote `vp-1-scene-gps-3` stamped when a tablet noticed. The server's row has
    its own id shape, so the journal's skip-a-known-id cannot swallow it."""
    from app.api.journal import append_rows

    old = {
        "id": "vp-1-scene-gps-3",
        "t": "19:43",
        "at": datetime.now(UTC).isoformat(),
        "icon": "truck",
        "text": "TLF vor Ort",
    }
    await append_rows(db_session, incident.id, [old])
    await db_session.commit()
    now = datetime.now(UTC)
    await _tick(db_session, AWAY, now - timedelta(minutes=10))
    arrived = now - timedelta(minutes=8)
    await _settle(db_session, SCENE, arrived)
    rows = {r["id"]: r for r in await _rows(db_session, incident)}
    assert set(rows) == {"vp-1-scene-gps-3", "vps-1-scene-gps-3"}
    assert rows["vps-1-scene-gps-3"]["at"] == arrived.isoformat()


async def test_a_tracker_time_in_the_future_is_capped_at_now(db_session, incident):
    now = datetime.now(UTC)
    await _tick(db_session, AWAY, now + timedelta(hours=2), now=now)
    [ev] = await _events(db_session, incident)
    assert ev.occurred_at.replace(tzinfo=UTC) <= now


async def test_an_unnamed_tracker_writes_no_row_where_the_geofence_writes(db_session, incident):
    """Traccar says «TLF 1», the config and the geofence say «tlf»: the geofence has already
    written its own «TLF vor Ort», and a second row under another name would be a duplicate."""
    geofenced = {"reportMeta": {"fahrzeuge": [{"id": "tlf", "ausgerueckt": "2026-09-23T17:16:00+00:00"}]}}
    incident.map_workspace_json = geofenced
    await db_session.commit()
    now = datetime.now(UTC)
    await _tick(db_session, AWAY, now - timedelta(minutes=10), device_id=9, name="TLF 1")
    await _settle(db_session, SCENE, now - timedelta(minutes=8), device_id=9, name="TLF 1")
    assert await _rows(db_session, incident) == []
    assert [e.client_id for e in await _events(db_session, incident)] == ["vp:9:0", "vp:9:1"]  # still recorded


async def test_a_quiet_einsatz_stops_being_observed_with_one_row_and_resumes(db_session, incident):
    """«Active» is a human write within 24 h, not the start time. The observers' own writes do
    not count, so a never-closed Einsatz ends with ONE row and is not kept alive by the sweep."""
    from app.api.journal import append_rows

    now = datetime.now(UTC)
    await _tick(db_session, AWAY, now - timedelta(minutes=10))  # observed: a baseline event
    incident.started_at = now - timedelta(hours=30)
    await db_session.commit()
    # the only writes are the observer's own (the fixture has no human write) → quiet
    assert await vp.active_incidents(db_session, now) == []
    await _run(db_session, [_pos(SCENE, now)], now)
    await _run(db_session, [_pos(SCENE, now)], now + timedelta(seconds=30))
    vp.reset_state()  # a restart: still exactly one row
    await _run(db_session, [_pos(SCENE, now)], now + timedelta(seconds=60))
    ended = [r for r in await _rows(db_session, incident) if r["id"].startswith("obs-end-")]
    assert len(ended) == 1 and "24 h ohne Eintrag" in ended[0]["text"]

    # somebody writes → observed again
    await append_rows(db_session, incident.id, [{"id": "t-human", "t": "", "icon": "flag", "text": "Nachkontrolle"}])
    await db_session.commit()
    assert [i.id for i in await vp.active_incidents(db_session, datetime.now(UTC))] == [incident.id]


async def test_a_recent_human_write_keeps_an_old_einsatz_observed(db_session, incident):
    from app.api.journal import append_rows

    incident.started_at = datetime.now(UTC) - timedelta(hours=30)
    await db_session.commit()
    await append_rows(db_session, incident.id, [{"id": "t-late", "t": "", "icon": "flag", "text": "Brandwache"}])
    await db_session.commit()
    assert [i.id for i in await vp.active_incidents(db_session, datetime.now(UTC))] == [incident.id]


async def test_the_close_out_runs_even_with_no_fleet_source(db_session, incident, monkeypatch):
    """The feed switched off (or Traccar unset) must not strand an owed departure."""
    from app import scheduler

    class _Ctx:
        async def __aenter__(self):
            return db_session

        async def __aexit__(self, *exc):
            return False

    now = datetime.now(UTC)
    await _tick(db_session, SCENE, now - timedelta(minutes=10))
    left = now - timedelta(minutes=5)
    await _settle(db_session, AWAY, left)
    incident.status = "abgeschlossen"
    await db_session.commit()
    monkeypatch.setattr(scheduler, "async_session_maker", lambda: _Ctx())
    await scheduler._vehicle_samples_sweep()  # no Traccar, no fake fleet
    assert [(r["id"], r["at"]) for r in await _rows(db_session, incident)] == [("vps-1-away-gps-3", left.isoformat())]


async def test_a_new_scheduler_leader_forgets_the_memory(monkeypatch):
    from app import scheduler
    from app.config import settings

    vp._state[("x", 1)] = None
    vp._closed_out.add("x")
    monkeypatch.setattr(settings, "demo_reset_cron", "")
    monkeypatch.setattr(settings, "demo_reset_seconds", 0)
    monkeypatch.setattr(scheduler, "_scheduler", None)
    try:
        scheduler._start_scheduler_jobs()
    finally:
        scheduler._stop_scheduler_jobs()
    assert vp._state == {} and vp._closed_out == set()


# --- the gps block is the server's -----------------------------------------------------------


def test_a_client_save_keeps_the_servers_gps_block():
    stored = {
        "reportMeta": {
            "fahrzeuge": [
                {"id": "tlf", "vorOrt": "A", "gps": {"zone": "scene", "fahrten": 2}},
                {"id": "mtf", "gps": {"zone": "away", "fahrten": 1}},
            ]
        }
    }
    incoming = {
        "reportMeta": {
            "fahrzeuge": [
                {"id": "tlf", "vorOrt": "A", "ausgerueckt": "B", "manual": True, "gps": {"zone": "away", "fahrten": 1}},
                {"id": "adl", "ausgerueckt": "C", "gps": {"zone": "scene"}},  # a device may not invent one
            ]
        }
    }
    vp.keep_server_gps(incoming, stored)
    rows = {r["id"]: r for r in incoming["reportMeta"]["fahrzeuge"]}
    assert rows["tlf"]["gps"] == {"zone": "scene", "fahrten": 2} and rows["tlf"]["manual"] is True
    assert rows["adl"] == {"id": "adl", "ausgerueckt": "C"}
    assert rows["mtf"] == {"id": "mtf", "gps": {"zone": "away", "fahrten": 1}}  # a dropped row keeps its block


async def test_an_old_clients_workspace_put_cannot_erase_the_gps_block(client, editor, db_session):
    import uuid as _uuid

    r = await client.post("/api/auth/login", json={"user_id": str(editor.id), "pin": "135790"})
    assert r.status_code == 200
    iid = (await client.post("/api/incidents", json={"title": "PUT"})).json()["id"]
    inc = await db_session.get(Incident, _uuid.UUID(iid))
    inc.map_workspace_json = {"reportMeta": {"fahrzeuge": [{"id": "tlf", "gps": {"zone": "scene", "fahrten": 1}}]}}
    await db_session.commit()
    rev = (await client.get(f"/api/incidents/{iid}/workspace")).json()["workspace_rev"]
    # an older build knows nothing of `gps` and saves its own Fahrzeugzeiten
    ws = {"reportMeta": {"fahrzeuge": [{"id": "tlf", "ausgerueckt": "2026-09-23T17:16:00+00:00"}]}}
    r = await client.put(f"/api/incidents/{iid}/workspace", json={"workspace": ws, "base_rev": rev})
    assert r.status_code == 200, r.text
    row = r.json()["workspace"]["reportMeta"]["fahrzeuge"][0]
    assert row == {"id": "tlf", "ausgerueckt": "2026-09-23T17:16:00+00:00", "gps": {"zone": "scene", "fahrten": 1}}
