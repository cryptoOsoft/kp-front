"""The PIN login's two lanes (sweep 2026-11-09, SEC.1).

A caller rotating source addresses used to guess at the bcrypt ceiling — the 6-digit space in
under a day. Now every device an account does not know shares one budget of wrong PINs for it,
and a device that has signed in before (the signed `known_device` cookie) is never behind it.
"""

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


async def test_a_pin_reset_makes_every_device_a_stranger_again(client, editor, admin_login, behind_proxy):
    async with _device("9.9.9.9") as phone:
        assert (await _try(phone, editor, PIN)).status_code == 200
        cookie = phone.cookies[DEVICE_COOKIE]

    await admin_login(client)
    assert (await client.post(f"/api/auth/users/{editor.id}/pin", json={"pin": "864209"})).status_code == 200
    await _lock(editor)

    async with _device("9.9.9.9", **{DEVICE_COOKIE: cookie}) as lost_phone:
        assert (await _try(lost_phone, editor, "864209")).status_code == 429


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


async def test_the_first_lock_tells_the_editors_and_the_admin_sees_it(
    client, editor, admin_login, behind_proxy, monkeypatch
):
    from app.auth import router as auth_router

    told: list[dict] = []
    monkeypatch.setattr(auth_router, "notify_login_lock", lambda _db, **kw: told.append(kw))

    await _lock(editor, refused=3)  # three refused, ONE push

    assert [t["display_name"] for t in told] == [editor.display_name]
    assert told[0]["minutes"] == NEW_DEVICE_LOCK_STEPS_SECONDS[0] // 60

    await admin_login(client)
    locks = (await client.get("/api/system")).json()["loginLocks"]
    assert [(lock["userId"], lock["displayName"]) for lock in locks] == [(str(editor.id), editor.display_name)]


async def test_an_invented_account_locks_nobody_and_tells_nobody(client, editor, behind_proxy, monkeypatch):
    import uuid
    from types import SimpleNamespace

    from app.auth import router as auth_router

    told: list[dict] = []
    monkeypatch.setattr(auth_router, "notify_login_lock", lambda _db, **kw: told.append(kw))
    await _lock(SimpleNamespace(id=uuid.uuid4()))

    assert told == []
    async with _device("6.6.6.6") as phone:
        assert (await _try(phone, editor, PIN)).status_code == 200
