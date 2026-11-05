"""The Lern-Übung door («Üben», 05.11.2026): `POST /api/incidents/lernen` and the el's delete.

Contract under test:
- an editor AND an el may open one; a viewer may not; the demo answers 403;
- it is always an Übung since creation, `source='training'`, titled «Lernen · <German title>»;
- the newest OPEN one is reused and renamed, a closed one is not;
- an el may delete it but no other Übung and never a real Einsatz, and may not mark a Lern-Übung
  real — so the el still cannot make a real Einsatz (RBAC audit S1); an editor keeps deleting
  any Übung since creation;
- the seed: the client's schema version, ids in `newId`'s shape, the station's centre and roster,
  no board kind outside board_kinds.json, the title map in step with the client's catalogue.
"""

import re
from datetime import UTC, datetime
from pathlib import Path

import pytest_asyncio
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.ids import new_id
from app.models import DeploymentConfig, IncidentEvent, Personnel
from app.tutorial_seed import SEED_SCHEMA_VERSION, TUTORIAL_TITLES, build_lern_scene, station_lern_scene
from app.workspace_kinds import BOARD_KIND_SINCE
from tests.conftest import _make_user

REPO = Path(__file__).resolve().parents[2]
#: `src/lib/ids.ts · newId`: `<prefix><ms>-<seq:2><rand:3>`
NEW_ID = re.compile(r"^[a-z]+\d{13}-[0-9a-z]{5}$")


@pytest_asyncio.fixture
async def el(db_session: AsyncSession):
    return await _make_user(db_session, username="el", role="el")


async def _login(client, user) -> None:
    await client.post("/api/auth/logout")
    r = await client.post("/api/auth/login", json={"user_id": str(user.id), "pin": "135790"})
    assert r.status_code == 200, r.text


async def _open(client, tutorial: str = "lageZeichnen") -> dict:
    r = await client.post("/api/incidents/lernen", json={"tutorial": tutorial})
    assert r.status_code == 200, r.text
    return r.json()


async def _config(db_session, cfg: dict) -> None:
    row = (await db_session.execute(select(DeploymentConfig).where(DeploymentConfig.id == 1))).scalar_one_or_none()
    if row is None:
        db_session.add(DeploymentConfig(id=1, config_json=cfg))
    else:
        row.config_json = cfg
    await db_session.commit()


# ── the door ──────────────────────────────────────────────────────────────────────────────────


async def test_editor_opens_a_seeded_lern_uebung(client, editor, db_session):
    await _login(client, editor)
    body = await _open(client)
    assert body["reused"] is False
    assert body["title"] == "Lernen · Karte – die Lage zeichnen"
    assert (body["is_exercise"], body["exercise_since_creation"], body["source"]) == (True, True, "training")
    ws = body["map_workspace_json"]
    assert len(ws["trupps"]) == 2 and len(ws["entities"]) == 2 and len(ws["drawings"]) == 1

    rows = (await client.get(f"/api/incidents/{body['id']}/journal")).json()["entries"]
    assert len(rows) == 3
    ops = (
        (await db_session.execute(select(IncidentEvent.op_type).where(IncidentEvent.incident_id == body["id"])))
        .scalars()
        .all()
    )
    assert ops == ["incident.create"]


async def test_el_opens_and_deletes_its_lern_uebung(client, el):
    await _login(client, el)
    body = await _open(client, "trupps")
    assert body["created_by"] == str(el.id)
    assert (await client.delete(f"/api/incidents/{body['id']}")).status_code == 204
    assert (await client.get(f"/api/incidents/{body['id']}")).status_code == 404


async def test_viewer_cannot_open_one(client, viewer):
    await _login(client, viewer)
    assert (await client.post("/api/incidents/lernen", json={"tutorial": "trupps"})).status_code == 403


async def test_unknown_or_self_made_tutorial_is_refused(client, editor):
    await _login(client, editor)
    # T1 makes its own Übung through the intake; the peace-time ones need none
    for tutorial in ("einsatzEroeffnen", "zurechtfinden", "nope"):
        assert (await client.post("/api/incidents/lernen", json={"tutorial": tutorial})).status_code == 422


async def test_demo_answers_403(client, editor, db_session):
    await _config(db_session, {"identity": {"demoMode": True}})
    await _login(client, editor)
    r = await client.post("/api/incidents/lernen", json={"tutorial": "trupps"})
    assert r.status_code == 403


async def test_newest_open_one_is_reused_and_renamed(client, editor, el, db_session):
    await _login(client, editor)
    first = await _open(client, "lageZeichnen")
    # another account on the same station goes on in the same Übung (per station, not per account)
    await _login(client, el)
    again = await _open(client, "trupps")
    assert (again["id"], again["reused"], again["title"]) == (first["id"], True, "Lernen · Trupps")
    # the learner's work stays: the scene is not seeded twice
    assert again["map_workspace_json"] == first["map_workspace_json"]
    rename = (
        (
            await db_session.execute(
                select(IncidentEvent.payload_json).where(
                    IncidentEvent.incident_id == first["id"], IncidentEvent.op_type == "meta.change"
                )
            )
        )
        .scalars()
        .one()
    )
    assert rename["fields"]["title"] == {"from": "Lernen · Karte – die Lage zeichnen", "to": "Lernen · Trupps"}


async def test_closed_or_other_incidents_are_not_reused(client, editor):
    await _login(client, editor)
    first = await _open(client)
    assert (await client.patch(f"/api/incidents/{first['id']}", json={"is_archived": True})).status_code == 200
    # an ordinary Übung that happens to carry the prefix is not the door's
    r = await client.post("/api/incidents", json={"title": "Lernen · von Hand", "is_exercise": True})
    assert r.status_code == 201
    fresh = await _open(client)
    assert fresh["reused"] is False and fresh["id"] not in (first["id"], r.json()["id"])


# ── what the el may delete and change ─────────────────────────────────────────────────────────


async def test_el_cannot_delete_a_real_einsatz(client, editor, el):
    await _login(client, editor)
    real = (await client.post("/api/incidents", json={"title": "Echter Einsatz"})).json()["id"]
    flipped = (await client.post("/api/incidents", json={"title": "Später Übung"})).json()["id"]
    assert (await client.patch(f"/api/incidents/{flipped}", json={"is_exercise": True})).status_code == 200
    await _login(client, el)
    for inc_id in (real, flipped):
        assert (await client.delete(f"/api/incidents/{inc_id}")).status_code == 403
        assert (await client.get(f"/api/incidents/{inc_id}")).status_code == 200


async def test_el_deletes_only_a_lern_uebung_an_editor_any_uebung(client, editor, el):
    await _login(client, editor)
    station = (await client.post("/api/incidents", json={"title": "Übung Schulhaus", "is_exercise": True})).json()
    await _login(client, el)
    assert (await client.delete(f"/api/incidents/{station['id']}")).status_code == 403
    assert (await client.get(f"/api/incidents/{station['id']}")).status_code == 200
    # the editor's rule is unchanged: any Übung since creation
    await _login(client, editor)
    assert (await client.delete(f"/api/incidents/{station['id']}")).status_code == 204


async def test_el_cannot_mark_a_lern_uebung_real(client, editor, el):
    await _login(client, el)
    inc_id = (await _open(client))["id"]
    r = await client.patch(f"/api/incidents/{inc_id}", json={"is_exercise": False})
    assert r.status_code == 403
    # the editor's Einsatzdaten are untouched by the rule
    await _login(client, editor)
    assert (await client.patch(f"/api/incidents/{inc_id}", json={"is_exercise": False})).status_code == 200


async def test_el_still_cannot_create_an_incident(client, el):
    await _login(client, el)
    assert (await client.post("/api/incidents", json={"title": "Echt"})).status_code == 403


# ── the seed ──────────────────────────────────────────────────────────────────────────────────


def _all_ids(ws: dict) -> list[str]:
    return [o["id"] for key in ("entities", "drawings", "trupps") for o in ws[key]]


def test_seed_keeps_the_workspace_rules():
    scene = build_lern_scene((7.57, 47.52), [], "TLF", datetime(2026, 11, 5, 3, 0, tzinfo=UTC))
    ws = scene.workspace
    client_version = re.search(
        r"export const WORKSPACE_SCHEMA_VERSION = (\d+)", (REPO / "src/lib/workspace.ts").read_text(encoding="utf-8")
    )
    assert client_version and ws["schemaVersion"] == SEED_SCHEMA_VERSION == int(client_version[1])
    ids = _all_ids(ws) + [r["id"] for r in scene.journal]
    assert all(NEW_ID.match(i) for i in ids), ids
    assert len(set(ids)) == len(ids)
    board_kinds = {a["kind"] for annos in (ws.get("board") or {}).values() for a in annos}
    assert board_kinds <= set(BOARD_KIND_SINCE)
    # the Leitung and its Trupp point at each other
    line, trupp = ws["drawings"][0], ws["trupps"][0]
    assert (line["truppId"], trupp["lineId"], line["lineNo"], trupp["lineNo"]) == (trupp["id"], line["id"], 1, 1)


def test_seed_crews_from_the_roster_and_fills_the_rest():
    people = [("p1", "Müller Hans"), ("p2", "Meier Anna"), ("p3", "Graf Stefan"), ("p4", "Roth Petra")]
    ws = build_lern_scene((7.57, 47.52), people, "TLF", datetime.now(UTC)).workspace
    t1, t2 = ws["trupps"]
    assert (t1["name"], t1["leaderPersonId"], t1["memberPersonIds"]) == ("Müller Hans", "p1", ["p2", "p3"])
    assert (t2["name"], t2["members"], t2["memberPersonIds"]) == ("Roth Petra", ["AdF 3", "AdF 4"], [])
    assert set(ws["attendance"]) == {"p1", "p2", "p3", "p4"}


async def test_seed_stands_on_the_station(db_session):
    await _config(
        db_session,
        {
            "map": {"defaultView": {"centerLv95": [2610000, 1265000]}},
            "fleet": {"vehicles": [{"id": "hlf", "label": "HLF"}]},
        },
    )
    db_session.add_all(Personnel(display_name=f"Person {i}", is_active=True) for i in range(8))
    await db_session.commit()
    scene = await station_lern_scene(db_session, datetime.now(UTC))
    assert 7.5 < scene.lng < 7.7 and 47.5 < scene.lat < 47.6  # LV95 converted to WGS84
    assert scene.workspace["entities"][1]["label"] == "HLF"
    assert len(scene.workspace["attendance"]) == 6


def test_titles_match_the_client_catalogue():
    catalogue = (REPO / "src/lib/tutorials/catalogue.ts").read_text(encoding="utf-8")
    uebung = set(re.findall(r"\{ id: '(\w+)',[^}]*sandbox: 'uebung',", catalogue))
    copy = (REPO / "src/config/copy/de/tutorials.ts").read_text(encoding="utf-8")
    titles = dict(re.findall(r"^\s+(\w+): '([^']+)',$", copy[copy.index("titles: {") : copy.index("tracks: {")], re.M))
    assert set(TUTORIAL_TITLES) == uebung
    assert {k: titles[k] for k in uebung} == TUTORIAL_TITLES


def test_new_id_has_the_client_shape():
    ids = {new_id("e") for _ in range(2000)}
    assert len(ids) == 2000 and all(NEW_ID.match(i) for i in ids)
