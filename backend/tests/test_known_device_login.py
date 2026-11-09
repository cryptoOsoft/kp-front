"""The PIN login's two lanes (sweep 2026-11-09, SEC.1).

A caller rotating source addresses used to guess at the bcrypt ceiling — the 6-digit space in
under a day. Now every device an account does not know shares one budget of wrong PINs for it,
and a device that has signed in before (the signed `known_device` cookie) is never behind it.
"""

from types import SimpleNamespace

import httpx
import pytest

from app.auth.known_device import DEVICE_COOKIE
from app.auth.pin_limiter import NEW_DEVICE_FREE_FAILURES, NEW_DEVICE_LOCK_STEPS_SECONDS, new_device_budget
from app.config import settings

pytestmark = pytest.mark.asyncio

PIN = "135790"
WRONG_PIN = "246803"


def _device(source: str | None = None, **cookies: str) -> httpx.AsyncClient:
    """A browser of its own: an empty cookie jar, optionally behind its own address."""
    from app.main import app

    headers = {"x-forwarded-for": source} if source else {}
    device = httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://test", headers=headers)
    for name, value in cookies.items():
        device.cookies.set(name, value)
    return device


async def _try(device: httpx.AsyncClient, user, pin: str) -> httpx.Response:
    return await device.post("/api/auth/login", json={"user_id": str(user.id), "pin": pin})


async def _guess_from_rotating_sources(user, count: int = NEW_DEVICE_FREE_FAILURES) -> list[int]:
    """`count` wrong PINs, each from its own address and its own empty browser."""
    codes = []
    for i in range(count):
        async with _device(f"1.1.{i // 250}.{i % 250 + 1}") as attacker:
            codes.append((await _try(attacker, user, WRONG_PIN)).status_code)
    return codes


async def _lock(user, refused: int = 1) -> None:
    """Spend the account's budget, then knock `refused` more times: the first engages the lock."""
    codes = await _guess_from_rotating_sources(user, NEW_DEVICE_FREE_FAILURES + refused)
    assert codes == [401] * NEW_DEVICE_FREE_FAILURES + [429] * refused


@pytest.fixture
def behind_proxy(monkeypatch):
    monkeypatch.setattr(settings, "trusted_forwarded_hops", 1)


async def test_rotating_sources_run_out_of_guesses(client, editor, behind_proxy):
    """The attack itself: a fresh address per guess. After the budget every unknown device is
    refused for the account — the CORRECT PIN included, or the lock would throttle nothing."""
    assert await _guess_from_rotating_sources(editor) == [401] * NEW_DEVICE_FREE_FAILURES

    async with _device("2.2.2.2") as attacker:
        refused = await _try(attacker, editor, PIN)
    assert refused.status_code == 429
    assert int(refused.headers["retry-after"]) == NEW_DEVICE_LOCK_STEPS_SECONDS[0]
    assert "neuen Gerät" in refused.json()["detail"]


async def test_a_known_device_signs_in_through_the_lock(client, editor, behind_proxy):
    """The 3am property: whatever the internet does to the account, the tablet that has signed
    in to it before gets in at the first correct PIN."""
    async with _device("9.9.9.9") as tablet:
        assert (await _try(tablet, editor, PIN)).status_code == 200
        cookie = tablet.cookies[DEVICE_COOKIE]

    await _lock(editor)
    assert str(editor.id) in new_device_budget.locked()

    async with _device("9.9.9.9", **{DEVICE_COOKIE: cookie}) as tablet:
        assert (await _try(tablet, editor, PIN)).status_code == 200


async def test_a_correct_pin_on_a_new_device_costs_no_budget(client, editor, behind_proxy):
    for i in range(NEW_DEVICE_FREE_FAILURES * 2):
        async with _device(f"3.3.3.{i + 1}") as phone:
            assert (await _try(phone, editor, PIN)).status_code == 200


async def test_another_accounts_cookie_buys_no_fast_lane(client, editor, viewer, behind_proxy):
    """A device is known PER ACCOUNT: a viewer's own login must not open the editor's tile."""
    async with _device("4.4.4.4") as insider:
        assert (await _try(insider, viewer, PIN)).status_code == 200
        cookie = insider.cookies[DEVICE_COOKIE]

    await _lock(editor)

    async with _device("4.4.4.4", **{DEVICE_COOKIE: cookie}) as insider:
        assert (await _try(insider, editor, PIN)).status_code == 429


async def test_a_pin_reset_under_attack_does_not_lock_the_crew_out(client, editor, admin_login, behind_proxy):
    """Resetting the PIN is the natural answer to «Anmeldung gesperrt». The tablet that was
    known before the reset signs in with the NEW PIN while new devices are still refused."""
    async with _device("9.9.9.9") as tablet:
        assert (await _try(tablet, editor, PIN)).status_code == 200
        cookie = tablet.cookies[DEVICE_COOKIE]

    await _lock(editor)
    await admin_login(client)
    assert (await client.post(f"/api/auth/users/{editor.id}/pin", json={"pin": "864209"})).status_code == 200

    async with _device("9.9.9.9", **{DEVICE_COOKIE: cookie}) as tablet:
        assert (await _try(tablet, editor, "864209")).status_code == 200


async def test_a_flood_of_invented_accounts_does_not_reset_a_real_one(client, editor, behind_proxy):
    """The reviewer's attack: ten guesses, then invented ids to push the counter out, repeat."""
    import uuid

    assert await _guess_from_rotating_sources(editor) == [401] * NEW_DEVICE_FREE_FAILURES
    for _ in range(50):
        async with _device("7.7.7.7") as attacker:
            assert (await _try(attacker, SimpleNamespace(id=uuid.uuid4()), WRONG_PIN)).status_code == 401
    assert new_device_budget.account_count() == 1  # the real one; no invented id stayed

    async with _device("8.8.8.8") as attacker:
        assert (await _try(attacker, editor, WRONG_PIN)).status_code == 429


async def test_a_concurrent_burst_from_new_devices_cannot_outrun_the_budget(client, editor, behind_proxy):
    """Counted in the step that admits: forty simultaneous guesses from forty addresses reach
    the verify at most ten times."""
    import asyncio

    async def guess(i: int) -> int:
        async with _device(f"5.5.{i}.1") as attacker:
            return (await _try(attacker, editor, WRONG_PIN)).status_code

    codes = await asyncio.gather(*(guess(i) for i in range(40)))
    assert codes.count(401) == NEW_DEVICE_FREE_FAILURES
    assert codes.count(429) == 40 - NEW_DEVICE_FREE_FAILURES


async def test_a_forged_cookie_is_an_unknown_device(client, editor, behind_proxy):
    await _lock(editor)
    async with _device("5.5.5.5", **{DEVICE_COOKIE: "not-a-token"}) as attacker:
        assert (await _try(attacker, editor, PIN)).status_code == 429


async def test_a_session_from_before_the_cookie_becomes_known_on_refresh(client, editor):
    """The rollout: devices already signed in carry no cookie yet. Their next token refresh
    proves an earlier PIN login and hands them one."""
    async with _device() as tablet:
        assert (await _try(tablet, editor, PIN)).status_code == 200
        del tablet.cookies[DEVICE_COOKIE]
        assert (await tablet.post("/api/auth/refresh")).status_code == 200
        assert tablet.cookies[DEVICE_COOKIE]


async def test_signing_out_keeps_the_device_known(client, editor):
    async with _device() as tablet:
        assert (await _try(tablet, editor, PIN)).status_code == 200
        assert (await tablet.post("/api/auth/logout")).status_code == 200
        assert tablet.cookies[DEVICE_COOKIE]


async def test_a_lock_tells_the_editors_and_the_admin_sees_it(client, editor, admin_login, behind_proxy, monkeypatch):
    from app.auth import router as auth_router

    told: list[dict] = []
    monkeypatch.setattr(auth_router, "notify_login_lock", lambda _db, **kw: told.append(kw))

    await _lock(editor, refused=3)  # three refused, ONE call

    assert told == [{"display_name": editor.display_name, "minutes": NEW_DEVICE_LOCK_STEPS_SECONDS[0] // 60}]

    await admin_login(client)
    locks = (await client.get("/api/system")).json()["loginLocks"]
    assert [(lock["userId"], lock["displayName"]) for lock in locks] == [(str(editor.id), editor.display_name)]


async def test_locks_on_many_accounts_are_one_push_an_hour(db_session, monkeypatch):
    """The roster is public: one push per account was forty notifications for 440 requests."""
    from app import push

    sent: list[str] = []

    async def record(_factory, **kw) -> None:
        sent.append(kw["tag"])

    clock = [1000.0]
    monkeypatch.setattr(push, "push_enabled", lambda: True)
    monkeypatch.setattr(push, "_broadcast_committed", record)
    monkeypatch.setattr(push, "_last_login_lock_push", 0.0)
    monkeypatch.setattr(push, "time", SimpleNamespace(monotonic=lambda: clock[0]))

    assert push.notify_login_lock(db_session, display_name="A", minutes=15) is True
    assert push.notify_login_lock(db_session, display_name="B", minutes=15) is False
    clock[0] += push.LOGIN_LOCK_PUSH_INTERVAL_SECONDS + 1
    assert push.notify_login_lock(db_session, display_name="C", minutes=15) is True


async def test_an_invented_account_is_never_locked_and_tells_nobody(client, editor, behind_proxy, monkeypatch):
    import uuid

    from app.auth import router as auth_router

    told: list[dict] = []
    monkeypatch.setattr(auth_router, "notify_login_lock", lambda _db, **kw: told.append(kw))
    ghost = SimpleNamespace(id=uuid.uuid4())
    codes = await _guess_from_rotating_sources(ghost, NEW_DEVICE_FREE_FAILURES * 2)
    assert codes == [401] * (NEW_DEVICE_FREE_FAILURES * 2)

    assert told == []
    async with _device("6.6.6.6") as phone:
        assert (await _try(phone, editor, PIN)).status_code == 200
