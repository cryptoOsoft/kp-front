"""The ``el`` role (Einsatzleiter function, 07.09.2026): may write the RECORD domains through
the scoped ``workspace/record`` slice — Anwesenheit (+ Zeitplan), Mittel, Checklisten,
Rapport (+ Beilagen) — and append journal rows / record-vocabulary events, plus (10.09.2026)
correct the EINSATZDATEN at the head of that record. The tactical picture stays editor-only:
the full workspace PUT, the trupps slice and the tactical event vocabulary all refuse an ``el``
session, the incident LIFECYCLE refuses it too, and a plain viewer stays read-only everywhere."""

import pytest
import pytest_asyncio
from sqlalchemy.ext.asyncio import AsyncSession

from tests.conftest import _make_user

pytestmark = pytest.mark.asyncio


@pytest_asyncio.fixture
async def el(db_session: AsyncSession):
    return await _make_user(db_session, username="el", role="el")


async def _login(client, user) -> None:
    r = await client.post("/api/auth/login", json={"user_id": str(user.id), "pin": "135790"})
    assert r.status_code == 200


async def _create_incident(client) -> str:
    # with an Einsatzort: correcting ONE coordinate must leave a whole pair (schemas · Latitude)
    r = await client.post("/api/incidents", json={"title": "Test Einsatz", "lat": 47.5, "lng": 7.5})
    assert r.status_code == 201, r.text
    return r.json()["id"]


async def _as_el_on_editor_incident(client, editor, el) -> str:
    await _login(client, editor)
    inc_id = await _create_incident(client)
    r = await client.put(
        f"/api/incidents/{inc_id}/workspace",
        json={"base_rev": 0, "workspace": {"entities": [{"id": "e1"}], "attendance": {"p1": {"status": "present"}}}},
    )
    assert r.status_code == 200
    await client.post("/api/auth/logout")
    await _login(client, el)
    return inc_id


async def test_el_record_slice_applies_only_the_record_keys(client, editor, el):
    inc_id = await _as_el_on_editor_incident(client, editor, el)
    r = await client.put(
        f"/api/incidents/{inc_id}/workspace/record",
        json={
            "base_rev": 1,
            "workspace": {
                "attendance": {"p2": {"status": "present"}},
                "mittel": [{"id": "m1", "kind": "use"}],
                "checklists": {"t1": {"ticked": {"i1": True}}},
                "reportMeta": {"einsatzort": "Dorfplatz 1"},
                # tactical keys ride along in the payload and MUST be dropped by the server
                "entities": [],
                "drawings": [{"id": "d1"}],
                "trupps": [{"name": "X"}],
            },
        },
    )
    assert r.status_code == 200, r.text
    assert r.json()["workspace_rev"] == 2
    assert r.json()["workspace"] is None  # slice callers read nothing but the rev

    ws = (await client.get(f"/api/incidents/{inc_id}/workspace")).json()["workspace"]
    assert ws["attendance"] == {"p2": {"status": "present"}}
    assert ws["mittel"] == [{"id": "m1", "kind": "use"}]
    assert ws["checklists"] == {"t1": {"ticked": {"i1": True}}}
    assert ws["reportMeta"] == {"einsatzort": "Dorfplatz 1"}
    # the tactical picture is the server's own, untouched by the el payload
    assert ws["entities"] == [{"id": "e1"}]
    assert "drawings" not in ws or ws["drawings"] == []
    assert "trupps" not in ws


async def test_el_record_slice_unions_the_crew_filing_markers_and_nothing_else(client, editor, el):
    # RBAC audit S4: the el files a Link's crew onto the Anwesenheit; the marker saying so lives on
    # the Trupp it may not write. The slice carries the markers, the server unions them — and
    # reads nothing else of a Trupp, adds no Trupp, and never shrinks a marker.
    await _login(client, editor)
    inc_id = await _create_incident(client)
    trupps = [
        {"id": "t1", "name": "Müller", "status": "aktiv", "crewFiled": ["p1"]},
        {"id": "t2", "name": "Meier", "status": "aktiv"},
    ]
    r = await client.put(f"/api/incidents/{inc_id}/workspace", json={"base_rev": 0, "workspace": {"trupps": trupps}})
    assert r.status_code == 200
    await client.post("/api/auth/logout")
    await _login(client, el)
    r = await client.put(
        f"/api/incidents/{inc_id}/workspace/record",
        json={
            "base_rev": 1,
            "workspace": {
                "attendance": {"g-t1-x": {"status": "present"}},
                "truppCrewFiled": {"t1": ["g-t1-x"], "t2": ["p2", 7], "t9": ["p9"]},
                "trupps": [{"id": "t1", "name": "Umbenannt"}],
            },
        },
    )
    assert r.status_code == 200, r.text
    ws = (await client.get(f"/api/incidents/{inc_id}/workspace")).json()["workspace"]
    assert ws["trupps"] == [
        {"id": "t1", "name": "Müller", "status": "aktiv", "crewFiled": ["g-t1-x", "p1"]},
        {"id": "t2", "name": "Meier", "status": "aktiv", "crewFiled": ["p2"]},
    ]
    assert "truppCrewFiled" not in ws


async def test_el_cannot_write_the_tactical_picture(client, editor, el):
    inc_id = await _as_el_on_editor_incident(client, editor, el)
    full = await client.put(f"/api/incidents/{inc_id}/workspace", json={"base_rev": 1, "workspace": {"x": 1}})
    assert full.status_code == 403
    trupps = await client.put(f"/api/incidents/{inc_id}/workspace/trupps", json={"base_rev": 1, "trupps": []})
    assert trupps.status_code == 403


async def test_viewer_is_still_read_only_on_the_record_slice(client, editor, viewer):
    await _login(client, editor)
    inc_id = await _create_incident(client)
    await client.post("/api/auth/logout")
    await _login(client, viewer)
    r = await client.put(
        f"/api/incidents/{inc_id}/workspace/record",
        json={"base_rev": 0, "workspace": {"attendance": {}}},
    )
    assert r.status_code == 403


async def test_el_record_slice_shares_the_optimistic_409(client, editor, el):
    inc_id = await _as_el_on_editor_incident(client, editor, el)
    r = await client.put(
        f"/api/incidents/{inc_id}/workspace/record",
        json={"base_rev": 0, "workspace": {"attendance": {}}},  # stale base_rev
    )
    assert r.status_code == 409


async def test_el_appends_journal_rows_and_record_events_but_no_tactical_ops(client, editor, el):
    inc_id = await _as_el_on_editor_incident(client, editor, el)
    j = await client.post(
        f"/api/incidents/{inc_id}/journal",
        json={"entries": [{"id": "r1", "t": "22:10", "kind": "note", "text": "EL: Material nachgeführt"}]},
    )
    assert j.status_code == 201, j.text

    ok = await client.post(
        f"/api/incidents/{inc_id}/events",
        json={
            "events": [{"op_type": "checklist.tick", "payload": {"item": "i1"}, "occurred_at": "2026-09-07T22:10:00Z"}]
        },
    )
    assert ok.status_code == 201, ok.text

    denied = await client.post(
        f"/api/incidents/{inc_id}/events",
        json={"events": [{"op_type": "entity.edit", "payload": {}, "occurred_at": "2026-09-07T22:10:00Z"}]},
    )
    assert denied.status_code == 403


# --- the Einsatzdaten (10.09.2026) ------------------------------------------------------
#
# Exactly what «Einsatzdaten bearbeiten» PATCHes (api/incidents · EL_META_FIELDS). One field the
# panel sends and the allowlist misses is a 403 on the whole correction, so each is asserted on
# its own rather than as one wide body.
EINSATZDATEN = {
    "title": "Brand Werkhof",
    "type": "Brandbekämpfung",
    "priority": "HIGH",
    "text": "Rauch aus dem Dach, Person vermisst",
    "address": "Hauptstrasse 3, Oberwil",
    "lat": 47.51234,
    "lng": 7.51234,
    "started_at": "2026-09-10T20:15:00Z",
    "is_exercise": True,
}


@pytest.mark.parametrize(("field", "value"), sorted(EINSATZDATEN.items()))
async def test_el_corrects_every_einsatzdaten_field(client, editor, el, field, value):
    inc_id = await _as_el_on_editor_incident(client, editor, el)
    r = await client.patch(f"/api/incidents/{inc_id}", json={field: value})
    assert r.status_code == 200, r.text
    got = r.json()[field]
    assert got == value or str(got).startswith(str(value)[:10])  # datetimes come back normalised


async def test_el_corrects_the_whole_panel_in_one_save(client, editor, el):
    inc_id = await _as_el_on_editor_incident(client, editor, el)
    r = await client.patch(f"/api/incidents/{inc_id}", json=EINSATZDATEN)
    assert r.status_code == 200, r.text
    assert r.json()["title"] == "Brand Werkhof"
    assert r.json()["address"] == "Hauptstrasse 3, Oberwil"


async def test_el_closes_and_reopens_the_einsatz(client, editor, el):
    """The Abschluss is the EL's too (EL phone sweep, 10.11.2026): the stamp and the close the
    Rapport's band sends, then «Wieder öffnen»."""
    inc_id = await _as_el_on_editor_incident(client, editor, el)
    assert (
        await client.patch(f"/api/incidents/{inc_id}", json={"report_done_at": "2026-09-10T21:00:00Z"})
    ).status_code == 200
    closed = await client.patch(f"/api/incidents/{inc_id}", json={"is_archived": True})
    assert closed.status_code == 200, closed.text
    assert closed.json()["is_archived"] is True
    assert closed.json()["closed_at"] is not None
    reopened = await client.patch(f"/api/incidents/{inc_id}", json={"is_archived": False})
    assert reopened.status_code == 200, reopened.text
    assert reopened.json()["is_archived"] is False


async def test_el_cannot_set_the_status(client, editor, el):
    inc_id = await _as_el_on_editor_incident(client, editor, el)
    r = await client.patch(f"/api/incidents/{inc_id}", json={"status": "abgeschlossen"})
    assert r.status_code == 403


async def test_a_refused_field_refuses_the_whole_correction(client, editor, el):
    """Not «apply what you may» — a partly-written save is the one outcome nobody can read back."""
    inc_id = await _as_el_on_editor_incident(client, editor, el)
    r = await client.patch(f"/api/incidents/{inc_id}", json={"title": "Brand Werkhof", "status": "abgeschlossen"})
    assert r.status_code == 403
    inc = (await client.get(f"/api/incidents/{inc_id}")).json()
    assert inc["title"] == "Test Einsatz"
    assert inc["status"] != "abgeschlossen"


async def test_viewer_cannot_correct_the_einsatzdaten(client, editor, viewer):
    await _login(client, editor)
    inc_id = await _create_incident(client)
    await client.post("/api/auth/logout")
    await _login(client, viewer)
    r = await client.patch(f"/api/incidents/{inc_id}", json={"title": "Brand Werkhof"})
    assert r.status_code == 403
