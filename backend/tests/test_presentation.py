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
from datetime import UTC, datetime

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


# --- review 06.11.2026 --------------------------------------------------------------------


async def test_a_signal_that_finds_the_end_still_writes_the_row(
    client, second, editor, viewer, db_session, monkeypatch
):
    """The «beendet» row of a timeout noticed by a SIGNAL (refused with 409 right after) must not
    roll back with the refusal – the presentation is gone from memory, nobody would write it again."""
    await _login(client, editor)
    await _login(second, viewer)
    inc = await _incident(client)
    pid = (await _start(client, inc))["id"]
    assert (await _signal(second, inc, pid, FOLLOWER, "join")).status_code == 204
    later = time.monotonic() + broker.PRESENTER_TIMEOUT_S + 5
    monkeypatch.setattr(broker, "_now", lambda: later)
    assert (await _signal(second, inc, pid, FOLLOWER, "pointer", at=POINT)).status_code == 409
    assert await _texts(db_session, inc) == [
        "Präsentation gestartet (Cmd)",
        "Präsentation beendet (Cmd – Verbindung verloren)",
    ]


MINT = "presentation-mint-key-0123456789-at-least-32-bytes"  # gitleaks:allow


async def _link_session(db_session, inc: str, kind: str) -> httpx.AsyncClient:
    """A device holding a link of `kind` on this Einsatz: the key on its column, the session
    cookie minted from it (auth/incident_link)."""
    from app.auth import incident_link as il
    from app.main import app
    from app.models import DeploymentConfig, Incident

    row = (await db_session.execute(select(DeploymentConfig).where(DeploymentConfig.id == 1))).scalar_one_or_none()
    if row is None:
        row = DeploymentConfig(id=1, config_json=None)
        db_session.add(row)
    incident = (await db_session.execute(select(Incident).where(Incident.id == uuid.UUID(inc)))).scalar_one()
    if kind == "alarm":
        row.incident_link_key = MINT
        token = il.create_link_session_token(inc, MINT)
    elif kind == "atemschutz":
        incident.atemschutz_link_key = MINT
        token = il.create_atemschutz_session_token(inc, MINT)
    elif kind == "atemschutz-standing":
        row.atemschutz_standing_key = MINT
        token = il.create_standing_atemschutz_session_token(inc, MINT)
    else:
        row.terminal_link_key = MINT
        token = il.create_terminal_session_token(inc, MINT)
    await db_session.commit()
    ac = httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://test")
    ac.cookies.set(il.LINK_COOKIE, token)
    return ac


@pytest.mark.parametrize("kind", ["alarm", "atemschutz", "atemschutz-standing", "terminal"])
async def test_every_other_link_kind_follows_and_points_but_never_presents(client, editor, db_session, kind):
    await _login(client, editor)
    inc = await _incident(client)
    pid = (await _start(client, inc))["id"]
    async with await _link_session(db_session, inc, kind) as link:
        assert (await link.get(f"/api/incidents/{inc}/presentation?client={LINKER}")).json()["id"] == pid
        assert (await _signal(link, inc, pid, LINKER, "join", name="Hans")).status_code == 204
        assert (await _signal(link, inc, pid, LINKER, "pointer", at=POINT)).status_code == 204
        view = {"mode": "map", "map": {"lng": 7.5, "lat": 47.5, "zoom": 17, "bearing": 0}}
        assert (await link.post(f"/api/incidents/{inc}/presentation", json={"client": LINKER})).status_code == 403
        assert (await link.delete(f"/api/incidents/{inc}/presentation")).status_code == 403
        assert (await _signal(link, inc, pid, PRESENTER, "view", view=view)).status_code == 403
        assert (await _signal(link, inc, pid, LINKER, "view", view=view)).status_code == 403
    assert broker.current(uuid.UUID(inc)).presenter.client == PRESENTER


async def test_one_link_session_cannot_act_under_another_ones_id(client, editor, db_session):
    """Link holders all share one guest identity; the owner is the SESSION – a forwarded view
    link may not kick or point under the alarm-link phone's id."""
    await _login(client, editor)
    inc = await _incident(client)
    pid = (await _start(client, inc))["id"]
    alarm = await _link_session(db_session, inc, "alarm")
    other = await _link_session(db_session, inc, "terminal")
    async with alarm, other:
        assert (await _signal(alarm, inc, pid, LINKER, "join", name="Hans")).status_code == 204
        assert (await _signal(other, inc, pid, LINKER, "pointer", at=POINT)).status_code == 409
        assert (await _signal(other, inc, pid, LINKER, "join", name="Hans")).status_code == 403
        await _signal(other, inc, pid, LINKER, "leave")
    assert [q.client for q in broker.current(uuid.UUID(inc)).participants.values()] == [LINKER]


async def test_on_the_demo_every_link_holder_is_gast(client, second, editor, monkeypatch):
    from app.api import presentation as api

    async def demo(_db):
        return True

    monkeypatch.setattr(api, "is_demo_deployment", demo)
    await _login(client, editor)
    inc = await _incident(client)
    pid = (await _start(client, inc))["id"]
    await _open_view_link(second, editor, inc)
    await _signal(second, inc, pid, LINKER, "join", name="Irgendwer")
    assert [q.name for q in broker.current(uuid.UUID(inc)).participants.values()] == ["Gast"]


@pytest.mark.parametrize(
    ("raw", "shown"),
    [
        ("  Sandra\x00 Meier  ", "Sandra Meier"),
        ("Sandra\u202e Meier\u200b", "Sandra Meier"),  # bidi override, zero-width space
        ("\x85Hans\x9f", "Hans"),  # C1 controls
        ("\u3164\u2800\u115f", "Gast"),  # letters that draw nothing → blank → «Gast»
        ("e\u0301\u0301\u0301\u0301x", "\u00e9\u0301\u0301x"),  # a tower of marks: NFC, then two stay
        ("\u0301\u0301", "Gast"),  # marks with no base
        ("Cafe\u0301", "Caf\u00e9"),  # NFC
        ("", "Gast"),
    ],
)
def test_a_link_name_is_cleaned_before_anybody_sees_it(raw, shown):
    from app.api.presentation import clean_link_name

    assert clean_link_name(raw) == shown


def _room(monkeypatch):
    t = {"now": 1000.0}
    monkeypatch.setattr(broker, "_now", lambda: t["now"])
    p = broker.Presentation(
        id="p" * 12,
        incident_id=uuid.uuid4(),
        presenter=broker.Participant(client=PRESENTER, name="FU", link=False, seen=1000.0, owner="user:fu"),
        started_at=datetime.now(UTC),
    )
    return p, t


def test_the_links_share_of_the_room_is_capped_and_never_costs_a_signed_in_follower(monkeypatch):
    p, t = _room(monkeypatch)
    for i in range(broker.LINK_PARTICIPANTS):
        t["now"] += 1  # inside the link share's change budget
        assert broker.join(p, client=f"lk{i:04d}", name=f"L{i}", link=True, owner=f"link:view:{i}") is None
    t["now"] += 1
    assert broker.join(p, client="lk9999", name="L", link=True, owner="link:view:x") == "full"
    for i in range(20):
        assert broker.join(p, client=f"ac{i:04d}", name=f"A{i}", link=False, owner=f"user:{i}") is None
    assert len(p.participants) == broker.LINK_PARTICIPANTS + 20


def test_link_pointers_have_their_own_budget(monkeypatch):
    p, t = _room(monkeypatch)
    for i in range(4):
        t["now"] += 1
        broker.join(p, client=f"lk{i:04d}", name=f"L{i}", link=True, owner=f"link:view:{i}")
    t["now"] += 5
    before = len(p.messages)
    # four link devices tapping as fast as the per-client floor lets them, for one second
    for _ in range(8):
        t["now"] += 0.125
        for i in range(4):
            broker.send_pointer(p, f"lk{i:04d}", f"link:view:{i}", {"surface": "map", "lng": 7.5, "lat": 47.5})
        broker.send_pointer(p, PRESENTER, "user:fu", {"surface": "map", "lng": 7.6, "lat": 47.5})
    sent = list(p.messages)[before:]
    assert len([m for m in sent if m["link"]]) <= broker.LINK_POINTERS_PER_S + 1  # one window plus its edge
    assert len([m for m in sent if m["client"] == PRESENTER]) == 8  # the presenter loses none to the links


def test_join_leave_churn_is_bounded_and_a_rejoin_wakes_nobody(monkeypatch):
    p, t = _room(monkeypatch)
    assert broker.join(p, client=FOLLOWER, name="A", link=False, owner="user:a") is None
    t["now"] += 5
    seq = p.seq
    assert broker.join(p, client=FOLLOWER, name="A", link=False, owner="user:a") is None
    assert p.seq == seq  # the same name again is a presence refresh, not news
    # a link device cycling join/leave under fresh ids: only its budget's worth wakes the screens
    t["now"] += 5
    for i in range(200):
        broker.join(p, client=f"cy{i:04d}", name="X", link=True, owner="link:view:cy")
        broker.leave(p, f"cy{i:04d}", "link:view:cy")
    assert p.seq - seq <= broker.LINK_CHANGES_PER_S + 1
    assert not [k for k in p.last_sent if k[0].startswith("cy")]  # nothing left behind
