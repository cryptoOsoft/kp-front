"""SEC-05: rotating a credential must end the sessions that credential opened.

An admin who resets a PIN is doing the one thing an operator reasonably reads as «throw the
intruder out». Until the auth generation existed, the old access cookie and the old refresh
cookie both kept working, and each refresh minted a fresh seven-day successor — so the reset
changed nothing for whoever was already inside.
"""

import asyncio

import httpx
import pytest
from sqlalchemy import select

from app.auth.security import create_access_token, create_refresh_token
from app.models import User

pytestmark = pytest.mark.asyncio

PIN = "135790"
NEW_PIN = "246803"


async def _login(user, pin: str = PIN) -> tuple[str, str]:
    """Log in on a throwaway cookie jar; return that session's (access, refresh) tokens.

    Deliberately not on the shared `client`: the admin calls below run on that one, and an
    admin request that also carries the user's own login is refused as self-administration.
    """
    async with _bearer() as fresh:
        r = await fresh.post("/api/auth/login", json={"user_id": str(user.id), "pin": pin})
    assert r.status_code == 200, r.text
    return r.cookies["access_token"], r.cookies["refresh_token"]


def _bearer(**cookies: str) -> httpx.AsyncClient:
    """A client carrying exactly the cookies named — never the shared jar's."""
    from app.main import app

    contender = httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://test")
    for name, value in cookies.items():
        contender.cookies.set(name, value)
    return contender


async def _reset_pin(client, admin_login, user, pin: str = NEW_PIN) -> None:
    await admin_login(client)
    r = await client.post(f"/api/auth/users/{user.id}/pin", json={"pin": pin})
    assert r.status_code == 200, r.text


async def test_pin_reset_invalidates_the_old_access_cookie(client, editor, admin_login):
    access, _refresh = await _login(editor)

    await _reset_pin(client, admin_login, editor)

    async with _bearer(access_token=access) as old:
        assert (await old.get("/api/auth/me")).status_code == 401


async def test_pin_reset_invalidates_the_old_refresh_cookie(client, editor, admin_login):
    _access, refresh = await _login(editor)

    await _reset_pin(client, admin_login, editor)

    async with _bearer(refresh_token=refresh) as old:
        assert (await old.post("/api/auth/refresh")).status_code == 401


async def test_concurrent_refresh_of_a_revoked_token_mints_no_successor(client, editor, admin_login):
    """The rotation race must not leave a window where one contender still gets a new pair."""
    _access, refresh = await _login(editor)
    await _reset_pin(client, admin_login, editor)

    async def present_once():
        async with _bearer(refresh_token=refresh) as contender:
            return await contender.post("/api/auth/refresh")

    first, second = await asyncio.gather(present_once(), present_once())

    assert [first.status_code, second.status_code] == [401, 401]


async def test_refresh_issued_before_the_reset_cannot_outlive_it_via_rotation(client, editor, admin_login):
    """Refreshing once before the reset does not buy a session that survives it."""
    _access, refresh = await _login(editor)

    async with _bearer(refresh_token=refresh) as session:
        rotated = await session.post("/api/auth/refresh")
        assert rotated.status_code == 200
        successor_access = rotated.cookies["access_token"]
        successor_refresh = rotated.cookies["refresh_token"]

    await _reset_pin(client, admin_login, editor)

    async with _bearer(access_token=successor_access, refresh_token=successor_refresh) as old:
        assert (await old.get("/api/auth/me")).status_code == 401
        assert (await old.post("/api/auth/refresh")).status_code == 401


async def test_login_with_the_new_pin_still_works_after_the_reset(client, editor, admin_login):
    await _reset_pin(client, admin_login, editor)

    access, _refresh = await _login(editor, pin=NEW_PIN)

    async with _bearer(access_token=access) as fresh:
        assert (await fresh.get("/api/auth/me")).status_code == 200


async def test_resetting_one_pin_leaves_other_users_signed_in(client, editor, viewer, admin_login):
    other_access, other_refresh = await _login(viewer)

    await _reset_pin(client, admin_login, editor)

    async with _bearer(access_token=other_access, refresh_token=other_refresh) as bystander:
        assert (await bystander.get("/api/auth/me")).status_code == 200
        assert (await bystander.post("/api/auth/refresh")).status_code == 200


async def test_reactivation_does_not_revive_sessions_from_before_the_deactivation(client, editor, admin_login):
    """Deactivating is the other «throw them out» gesture; reactivating must not undo it."""
    access, refresh = await _login(editor)
    await admin_login(client)
    # The last active editor may not be deactivated at all — give the station a second one.
    spare = await client.post(
        "/api/auth/users",
        json={"username": "spare", "display_name": "Spare", "role": "editor", "pin": PIN},
    )
    assert spare.status_code == 201, spare.text

    off = await client.patch(f"/api/auth/users/{editor.id}", json={"is_active": False})
    assert off.status_code == 200, off.text
    on = await client.patch(f"/api/auth/users/{editor.id}", json={"is_active": True})
    assert on.status_code == 200, on.text

    async with _bearer(access_token=access, refresh_token=refresh) as revived:
        assert (await revived.get("/api/auth/me")).status_code == 401
        assert (await revived.post("/api/auth/refresh")).status_code == 401


async def test_tokens_minted_before_the_generation_claim_existed_keep_working(client, editor):
    """Deploy compatibility: a cookie in flight has no `gen` and is read as generation 0 —
    the generation every existing row starts at. The first revocation still ends it."""
    legacy = {"sub": str(editor.id), "username": editor.username, "role": editor.role}

    async with _bearer(access_token=create_access_token(legacy)) as inflight:
        assert (await inflight.get("/api/auth/me")).status_code == 200


# --- SEC-05 round-2: the bump must be atomic, not a read-modify-write --------------------


async def test_two_overlapping_resets_advance_the_generation_by_two(editor, session_factory):
    """The old bump read the ORM value and wrote value+1. Two resets that both read generation 0
    each wrote 1, so the account only advanced by ONE — a session minted after the first reset
    survived the second. `UPDATE ... SET gen = gen + 1` serialises at the row: N resets advance
    by N. The overlap is made deterministic here — both sessions load the user before either
    writes — so this fails on the buggy read-modify-write and passes on the atomic bump."""
    from app.auth.router import revoke_sessions

    async with session_factory() as a, session_factory() as b:
        ua = (await a.execute(select(User).where(User.id == editor.id))).scalar_one()
        ub = (await b.execute(select(User).where(User.id == editor.id))).scalar_one()
        assert ua.auth_generation == 0 and ub.auth_generation == 0

        await revoke_sessions(a, ua)
        await a.commit()
        # b read generation 0 before a committed — the read-modify-write bug rewrites 1 here.
        await revoke_sessions(b, ub)
        await b.commit()

    async with session_factory() as c:
        fresh = (await c.execute(select(User).where(User.id == editor.id))).scalar_one()
    assert fresh.auth_generation == 2


async def test_a_session_minted_between_two_overlapping_resets_is_dead(client, editor, session_factory):
    """The concrete SEC-05 failure: a session minted AFTER the first reset (generation 1) must not
    survive the second. The buggy non-atomic bump re-wrote 1, leaving that generation-1 token
    valid; the atomic bump takes the row to 2, so both the pre-reset and the between-resets token
    are dead at /auth/me."""
    from app.auth.router import _claims, revoke_sessions

    tok_gen0 = create_access_token(_claims(editor))  # before any reset

    async with session_factory() as a, session_factory() as b:
        ua = (await a.execute(select(User).where(User.id == editor.id))).scalar_one()
        ub = (await b.execute(select(User).where(User.id == editor.id))).scalar_one()  # reads gen 0

        await revoke_sessions(a, ua)  # first reset → generation 1
        await a.commit()
        await a.refresh(ua)
        tok_gen1 = create_access_token(_claims(ua))  # a session minted after the first reset

        await revoke_sessions(b, ub)  # b still holds generation 0
        await b.commit()

    async with _bearer(access_token=tok_gen0) as s0:
        assert (await s0.get("/api/auth/me")).status_code == 401
    async with _bearer(access_token=tok_gen1) as s1:
        assert (await s1.get("/api/auth/me")).status_code == 401


async def test_a_pre_deploy_token_dies_at_the_first_reset(client, editor, admin_login):
    legacy = {"sub": str(editor.id), "username": editor.username, "role": editor.role}
    access = create_access_token(legacy)
    refresh = create_refresh_token(legacy)

    await _reset_pin(client, admin_login, editor)

    async with _bearer(access_token=access, refresh_token=refresh) as old:
        assert (await old.get("/api/auth/me")).status_code == 401
        assert (await old.post("/api/auth/refresh")).status_code == 401


async def test_a_role_change_ends_the_sessions_of_the_old_role(client, editor, viewer, admin_login):
    """RBAC audit S4: a device keeps the role it signed in with, so an editor made `el`
    mid-Einsatz kept an editor UI whose tactical edits the server no longer stored. Signing in
    again is what hands the device its new role."""
    access, refresh = await _login(editor)
    await admin_login(client)
    assert (await client.patch(f"/api/auth/users/{viewer.id}", json={"role": "editor"})).status_code == 200
    assert (await client.patch(f"/api/auth/users/{editor.id}", json={"role": "el"})).status_code == 200

    async with _bearer(access_token=access) as old:
        assert (await old.get("/api/auth/me")).status_code == 401
    async with _bearer(refresh_token=refresh) as old:
        assert (await old.post("/api/auth/refresh")).status_code == 401


async def test_an_unchanged_role_keeps_the_sessions(client, editor, admin_login):
    """The members table re-sends the role with every edit; a rename must not log anybody out."""
    access, _refresh = await _login(editor)
    await admin_login(client)
    r = await client.patch(f"/api/auth/users/{editor.id}", json={"role": "editor", "display_name": "Neu"})
    assert r.status_code == 200, r.text

    async with _bearer(access_token=access) as same:
        assert (await same.get("/api/auth/me")).status_code == 200


async def test_pin_reset_drops_the_accounts_push_registrations(client, editor, viewer, admin_login, db_session):
    """The lock screen is a session too: a lost phone kept getting «Neuer Einsatz – Titel –
    Adresse» after the reset that signed it out, because push rows belong to the account and
    renew without a session. Another account's phone is untouched."""
    from app.models import PushSubscription

    for user, endpoint in ((editor, "https://push.example/lost"), (viewer, "https://push.example/other")):
        db_session.add(PushSubscription(user_id=user.id, endpoint=endpoint, p256dh="k", auth="a"))
    await db_session.commit()

    await _reset_pin(client, admin_login, editor)

    left = (await db_session.execute(select(PushSubscription.endpoint))).scalars().all()
    assert left == ["https://push.example/other"]
