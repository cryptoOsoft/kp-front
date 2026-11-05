"""Präsentationsmodus (app/presentation, api/presentation).

Contract under test:
- an editor starts and ends a presentation; the Verlauf gets exactly «gestartet» / «beendet»
  (server rows, derived ids), and nothing else of the feature is ever stored;
- it ends on Beenden, on a takeover, on the Einsatz closing (before the close row) and when the
  presenter goes quiet – observed by the next poll of anybody;
- a parked poll wakes on a signal and carries the pointer/view to every joined device;
- only the presenter's client moves the room; a pointer needs a joined client;
- the «Einsatz · lesen» view link may follow and point – and still writes nothing else.
"""

import asyncio
import time
import uuid

import httpx
import pytest
from sqlalchemy import select

from app import live_wait
from app import presentation as broker
from app.auth.cookies import ACCESS_COOKIE
from app.models import JournalEntry

PRESENTER = "pc1730800000000-01abc"
FOLLOWER = "pc1730800000001-02def"
LINKER = "pc1730800000002-03ghi"


@pytest.fixture(autouse=True)
def _clean(monkeypatch):
    broker.reset()
    monkeypatch.setattr(live_wait, "LONG_POLL_TIMEOUT_S", 0.2)
    yield
    broker.reset()


@pytest.fixture
async def second(client):
    """A second device: its own cookie jar on the same app (the `client` fixture's overrides)."""
    from app.main import app

    async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://test") as ac:
        yield ac


async def _login(client, user) -> None:
    r = await client.post("/api/auth/login", json={"user_id": str(user.id), "pin": "135790"})
    assert r.status_code == 200, r.text


async def _incident(client) -> str:
    r = await client.post("/api/incidents", json={"title": "Präsentation"})
    assert r.status_code == 201, r.text
    return r.json()["id"]


async def _start(client, inc: str, cid: str = PRESENTER) -> dict:
    r = await client.post(f"/api/incidents/{inc}/presentation", json={"client": cid})
    assert r.status_code == 200, r.text
    return r.json()


async def _texts(db_session, inc: str) -> list[str]:
    rows = (
        await db_session.execute(
            select(JournalEntry.row_json).where(JournalEntry.incident_id == uuid.UUID(inc)).order_by(JournalEntry.seq)
        )
    ).scalars()
    return [r["text"] for r in rows]


async def _signal(client, inc: str, pid: str, cid: str, kind: str, **extra) -> httpx.Response:
    body = {"presentation": pid, "client": cid, "kind": kind, **extra}
    return await client.post(f"/api/incidents/{inc}/presentation/signal", json=body)


async def _open_view_link(client, editor, inc: str) -> None:
    """Mint the view link as an editor, then become the outsider holding the URL."""
    await _login(client, editor)
    r = await client.post(f"/api/incidents/{inc}/view-link")
    assert r.status_code == 200, r.text
    token = r.json()["token"]
    client.cookies.delete(ACCESS_COOKIE)
    r = await client.post("/api/incident-link/session", json={"token": token})
    assert r.status_code == 200, r.text


POINT = {"surface": "map", "lng": 7.55, "lat": 47.51}


# --- lifecycle ----------------------------------------------------------------------------


async def test_start_and_end_write_only_the_two_verlauf_rows(client, editor, db_session):
    await _login(client, editor)
    inc = await _incident(client)

    state = await _start(client, inc)
    assert state["active"] and state["presenter"] == {"client": PRESENTER, "name": "Cmd", "link": False}
    # a double tap keeps the one presentation
    assert (await _start(client, inc))["id"] == state["id"]

    view = {"mode": "map", "map": {"lng": 7.5, "lat": 47.5, "zoom": 17, "bearing": 0}}
    assert (await _signal(client, inc, state["id"], PRESENTER, "view", view=view)).status_code == 204
    assert (await _signal(client, inc, state["id"], PRESENTER, "pointer", at=POINT)).status_code == 204

    assert (await client.delete(f"/api/incidents/{inc}/presentation")).status_code == 204
    assert (await client.get(f"/api/incidents/{inc}/presentation?client={FOLLOWER}")).json()["active"] is False
    assert await _texts(db_session, inc) == ["Präsentation gestartet (Cmd)", "Präsentation beendet (Cmd)"]
    rows = (
        await db_session.execute(select(JournalEntry.client_id).where(JournalEntry.incident_id == uuid.UUID(inc)))
    ).scalars()
    assert all(r.startswith("syspr") for r in rows)
    # …and nothing of the views or pointers reached the workspace
    ws = (await client.get(f"/api/incidents/{inc}/workspace")).json()
    assert "presentation" not in str(ws).lower()


async def test_another_editor_takes_over(client, second, editor, db_session):
    await _login(client, editor)
    await _login(second, editor)
    inc = await _incident(client)
    first = await _start(client, inc)
    taken = await _start(second, inc, FOLLOWER)
    assert taken["id"] != first["id"] and taken["presenter"]["client"] == FOLLOWER
    # the old presenter's signals now name a presentation that is gone
    assert (await _signal(client, inc, first["id"], PRESENTER, "pointer", at=POINT)).status_code == 409
    assert await _texts(db_session, inc) == [
        "Präsentation gestartet (Cmd)",
        "Präsentation beendet (Cmd)",
        "Präsentation gestartet (Cmd)",
    ]


async def test_a_quiet_presenter_ends_on_the_next_poll(client, second, editor, viewer, db_session, monkeypatch):
    await _login(client, editor)
    await _login(second, viewer)
    inc = await _incident(client)
    await _start(client, inc)

    later = time.monotonic() + broker.PRESENTER_TIMEOUT_S + 5
    monkeypatch.setattr(broker, "_now", lambda: later)
    r = await second.get(f"/api/incidents/{inc}/presentation?client={FOLLOWER}")
    assert r.json()["active"] is False
    assert await _texts(db_session, inc) == [
        "Präsentation gestartet (Cmd)",
        "Präsentation beendet (Cmd – Verbindung verloren)",
    ]


async def test_closing_the_einsatz_ends_it_before_the_close_row(client, editor, db_session):
    await _login(client, editor)
    inc = await _incident(client)
    await _start(client, inc)
    r = await client.patch(f"/api/incidents/{inc}", json={"is_archived": True})
    assert r.status_code == 200, r.text
    assert broker.current(uuid.UUID(inc)) is None
    texts = await _texts(db_session, inc)
    assert texts[-2:] == ["Präsentation beendet (Cmd – Einsatz abgeschlossen)", "Einsatz abgeschlossen"]
    # …and a closed Einsatz is presented by nobody
    r = await client.post(f"/api/incidents/{inc}/presentation", json={"client": PRESENTER})
    assert r.status_code == 409
    assert r.json()["detail"]["code"] == "incident_closed"


async def test_only_an_editor_presents(client, second, editor, viewer):
    await _login(client, editor)
    await _login(second, viewer)
    inc = await _incident(client)
    assert (await second.post(f"/api/incidents/{inc}/presentation", json={"client": FOLLOWER})).status_code == 403
    await _start(client, inc)
    assert (await second.delete(f"/api/incidents/{inc}/presentation")).status_code == 403


# --- fan-out and who may send what ---------------------------------------------------------


async def _parked() -> None:
    deadline = time.perf_counter() + 2.0
    while not live_wait._waiters:
        assert time.perf_counter() < deadline, "the poll never parked"
        await asyncio.sleep(0.005)


async def test_a_pointer_wakes_every_parked_follower(client, second, editor, viewer, monkeypatch):
    await _login(client, editor)
    await _login(second, viewer)
    inc = await _incident(client)
    pid = (await _start(client, inc))["id"]
    assert (await _signal(second, inc, pid, FOLLOWER, "join")).status_code == 204

    state = (await second.get(f"/api/incidents/{inc}/presentation?client={FOLLOWER}&known={pid}")).json()
    assert [p["name"] for p in state["participants"]] == ["View"]

    monkeypatch.setattr(live_wait, "LONG_POLL_TIMEOUT_S", 30.0)
    url = f"/api/incidents/{inc}/presentation?client={FOLLOWER}&known={pid}&since={state['seq']}&wait=1"
    poll = asyncio.create_task(second.get(url))
    await _parked()
    assert (await _signal(client, inc, pid, PRESENTER, "pointer", at=POINT)).status_code == 204

    got = (await asyncio.wait_for(poll, timeout=2)).json()
    at = [{k: v for k, v in m["at"].items() if v is not None} for m in got["messages"]]
    assert [(m["kind"], m["name"]) for m in got["messages"]] == [("pointer", "Cmd")]
    assert at == [POINT]
    assert not live_wait._waiters


async def test_only_the_presenter_moves_the_room_and_only_the_joined_point(client, second, editor, viewer):
    await _login(client, editor)
    await _login(second, viewer)
    inc = await _incident(client)
    pid = (await _start(client, inc))["id"]
    view = {"mode": "plans", "plan_id": "tafel", "page": "skizze", "plan": {"x": 0.5, "y": 0.5, "floor": 0, "scale": 1}}

    assert (await _signal(second, inc, pid, FOLLOWER, "view", view=view)).status_code == 403
    assert (await _signal(second, inc, pid, FOLLOWER, "pointer", at=POINT)).status_code == 409
    await _signal(second, inc, pid, FOLLOWER, "join")
    assert (await _signal(second, inc, pid, FOLLOWER, "pointer", at=POINT)).status_code == 204
    # an out-of-range or non-finite point never reaches anybody
    bad = {"surface": "map", "lng": 700, "lat": 47.5}
    assert (await _signal(second, inc, pid, FOLLOWER, "pointer", at=bad)).status_code == 422
    assert (await _signal(second, inc, pid, FOLLOWER, "pointer", at={"surface": "plan"})).status_code == 422


# --- the view link --------------------------------------------------------------------------


async def test_the_view_link_follows_and_points_under_its_own_flagged_name(client, second, editor):
    await _login(client, editor)
    inc = await _incident(client)
    pid = (await _start(client, inc))["id"]
    await _open_view_link(second, editor, inc)

    state = (await second.get(f"/api/incidents/{inc}/presentation?client={LINKER}")).json()
    assert state["active"] and state["id"] == pid
    r = await _signal(second, inc, pid, LINKER, "join", name="  Sandra\x00 Meier\u202e  ")
    assert r.status_code == 204, r.text
    assert (await _signal(second, inc, pid, LINKER, "pointer", at=POINT)).status_code == 204

    got = (await client.get(f"/api/incidents/{inc}/presentation?client={PRESENTER}&known={pid}")).json()
    assert got["participants"] == [{"client": LINKER, "name": "Sandra Meier", "link": True}]
    assert got["messages"][-1]["name"] == "Sandra Meier" and got["messages"][-1]["link"] is True


async def test_the_view_link_still_writes_nothing_else(client, second, editor, db_session):
    await _login(client, editor)
    inc = await _incident(client)
    pid = (await _start(client, inc))["id"]
    await _open_view_link(second, editor, inc)
    await _signal(second, inc, pid, LINKER, "join", name="Sandra")

    view = {"mode": "map", "map": {"lng": 7.5, "lat": 47.5, "zoom": 17, "bearing": 0}}
    # it never presents: no start, no end, no view – even with the presenter's own client id
    assert (await second.post(f"/api/incidents/{inc}/presentation", json={"client": LINKER})).status_code == 403
    assert (await second.delete(f"/api/incidents/{inc}/presentation")).status_code == 403
    assert (await _signal(second, inc, pid, PRESENTER, "view", view=view)).status_code == 403
    # …and the record stays closed to it
    row = {"id": "e1730800000000-01abc", "t": "14:02", "icon": "flag", "text": "Hallo"}
    assert (await second.post(f"/api/incidents/{inc}/journal", json={"entries": [row]})).status_code == 403
    put = {"workspace": {"a": 1}, "base_rev": 0}
    assert (await second.put(f"/api/incidents/{inc}/workspace", json=put)).status_code == 403
    ev = {"events": [{"client_id": "x1", "op_type": "symbol.add", "payload": {}}]}
    assert (await second.post(f"/api/incidents/{inc}/events", json=ev)).status_code == 403
    assert broker.current(uuid.UUID(inc)).presenter.client == PRESENTER
    assert await _texts(db_session, inc) == ["Präsentation gestartet (Cmd)"]


async def test_a_client_id_belongs_to_the_session_that_registered_it(client, second, editor, db_session, monkeypatch):
    """Client ids are in every poll's answer. A link holder who reads the presenter's must not
    point under the FU's name, nor keep a vanished presenter's presentation alive by polling."""
    await _login(client, editor)
    inc = await _incident(client)
    pid = (await _start(client, inc))["id"]
    await _open_view_link(second, editor, inc)

    assert (await _signal(second, inc, pid, PRESENTER, "pointer", at=POINT)).status_code == 409
    assert (await _signal(second, inc, pid, PRESENTER, "join", name="FU")).status_code == 403
    state = (await client.get(f"/api/incidents/{inc}/presentation?client={PRESENTER}&known={pid}")).json()
    assert state["messages"] == [] and state["participants"] == []

    # the presenter goes quiet; the link holder polls under the presenter's id all the while
    t0 = time.monotonic()
    clock = {"now": t0}
    monkeypatch.setattr(broker, "_now", lambda: clock["now"])
    for step in range(1, 5):
        clock["now"] = t0 + step * 20
        await second.get(f"/api/incidents/{inc}/presentation?client={PRESENTER}&known={pid}")
    assert broker.current(uuid.UUID(inc)) is None
    assert (await _texts(db_session, inc))[-1] == "Präsentation beendet (Cmd – Verbindung verloren)"


async def test_a_faded_pointer_is_no_news(client, second, editor, viewer, monkeypatch):
    """A tab back from the background, or a device that just looked, gets no rings from before."""
    await _login(client, editor)
    await _login(second, viewer)
    inc = await _incident(client)
    pid = (await _start(client, inc))["id"]
    await _signal(client, inc, pid, PRESENTER, "pointer", at=POINT)
    url = f"/api/incidents/{inc}/presentation?client={FOLLOWER}"
    assert (await second.get(url)).json()["messages"] == []  # had not looked yet
    assert len((await second.get(f"{url}&known={pid}")).json()["messages"]) == 1
    later = time.monotonic() + broker.POINTER_TTL_S + 1
    monkeypatch.setattr(broker, "_now", lambda: later)
    broker.current(uuid.UUID(inc)).presenter.seen = later  # the presenter is still there
    assert (await second.get(f"{url}&known={pid}")).json()["messages"] == []
