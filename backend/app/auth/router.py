"""Auth endpoints: roster → login (PIN) → me / refresh / logout.

Account updates lock active editors in stable id order before checking the last-editor
guard. Two admin requests must not each count the editor the other is about to remove.
"""

import logging
import uuid
from datetime import UTC, datetime, timedelta
from typing import Annotated

from fastapi import APIRouter, Cookie, Depends, HTTPException, Request, Response, status
from jwt import InvalidTokenError as JWTError
from sqlalchemy import delete, func, select, update
from sqlalchemy.ext.asyncio import AsyncSession

from ..config import settings
from ..database import get_db
from ..models import PushSubscription, User
from ..push import notify_login_lock
from ..schemas import (
    LoginRequest,
    PinReset,
    RosterUser,
    UserAdminOut,
    UserCreate,
    UserOut,
    UserUpdate,
)
from .client_ip import client_ip
from .cookies import (
    REFRESH_COOKIE,
    clear_auth_cookies,
    revoke_refresh_token,
    revoke_token,
    set_auth_cookies,
)
from .dependencies import AUTH_GENERATION_CLAIM, CurrentAdmin, CurrentUser, OptionalUser, token_generation
from .known_device import DEVICE_COOKIE, read_known_device, remember_device
from .pin_limiter import new_device_budget, pin_limiter
from .security import (
    TRIVIAL_PINS,
    create_access_token,
    create_refresh_token,
    decode_token,
    hash_pin,
    successor_jti,
    verify_pin_async,
)
from .token_blocklist import token_blocklist

router = APIRouter(prefix="/auth", tags=["auth"])

logger = logging.getLogger(__name__)


async def _refuse_new_device(db: AsyncSession, account: str, wait: int, engaged: int) -> HTTPException:
    """The 429 for a device the account does not know, while its new-device budget is spent
    (pin_limiter · NewDeviceBudget). On the call that ENGAGES a lock it also says so: a log
    line every time, and a push to the editors for the first lock of an episode — somebody is
    guessing at an account, and a colleague with a new phone is about to ask why it says no."""
    minutes = max(1, round(wait / 60))
    if engaged:
        logger.warning("New-device login lock engaged: user=%s lock=%d for %d min", account, engaged, minutes)
    if engaged == 1:
        try:
            user = (await db.execute(select(User).where(User.id == uuid.UUID(account)))).scalar_one_or_none()
        except ValueError:
            user = None
        if user is not None and user.is_active:
            notify_login_lock(db, display_name=user.display_name, minutes=minutes, tag=f"login-lock:{account}")
    return HTTPException(
        status_code=status.HTTP_429_TOO_MANY_REQUESTS,
        detail=(
            f"Zu viele falsche PINs von neuen Geräten. Auf einem neuen Gerät ist die Anmeldung für dieses "
            f"Konto noch {minutes} min gesperrt. Bereits angemeldete Geräte sind nicht betroffen."
        ),
        headers={"Retry-After": str(wait)},
    )


def _refuse_cross_site(request: Request) -> None:
    """Same-origin gate for the roster (L5) — the READ counterpart of `enforce_request_origin`.

    The roster is unauthenticated by design (the kiosk login screen needs it before anyone is
    logged in), but display names plus login UUIDs are not for any internet caller. The gate
    middleware only covers unsafe methods, so this GET draws the same line itself, with the
    middleware's own helpers rather than a second opinion on what «own origin» means:

    * an `Origin` that is not ours (nor a dev origin) → 403;
    * a `Sec-Fetch-Site` that is neither `same-origin` nor `none` → 403;
    * NO origin evidence at all → through. That is the middleware's browser/non-browser split:
      curl, the e2e harness and the backend tests send neither header, and every real browser
      loading the kiosk sends `Sec-Fetch-Site: same-origin` (or `none` for a typed address) —
      so nothing a browser actually does gets refused, only a page that is provably elsewhere.
    """
    # Deferred import — app.main imports this router at startup, so a module-level import
    # here would be circular. The helpers are main's on purpose: one definition of own-origin.
    from ..main import _OWN_FETCH_SITES, _dev_origin, _own_origins

    origin = request.headers.get("origin")
    site = (request.headers.get("sec-fetch-site") or "").lower()
    foreign_origin = origin is not None and not (
        origin.lower().rstrip("/") in _own_origins(request) or _dev_origin(origin)
    )
    if foreign_origin or (site and site not in _OWN_FETCH_SITES):
        logger.warning(
            "Roster request from a foreign origin refused (origin=%r, sec-fetch-site=%r)",
            origin,
            site or None,
        )
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Anfrage von einer fremden Herkunft")


def _with_session(user: User, until: datetime | None) -> UserOut:
    """The account as the client sees it, plus when its refresh token runs out (UserOut ·
    session_until). The readiness rows on the Karte home read it; nothing else does."""
    out = UserOut.model_validate(user)
    out.session_until = until
    return out


def _refresh_until() -> datetime:
    return datetime.now(UTC) + timedelta(days=settings.refresh_token_expire_days)


def _claims(user: User) -> dict:
    # The generation travels in every token this app mints; `dependencies.get_current_user`
    # and /auth/refresh refuse one that is behind the row's (see revoke_sessions).
    return {
        "sub": str(user.id),
        "username": user.username,
        "role": user.role,
        AUTH_GENERATION_CLAIM: user.auth_generation,
    }


async def revoke_sessions(db: AsyncSession, user: User) -> None:
    """End every session this account currently holds — access cookies AND refresh tokens.

    The one lever behind «throw them out»: a PIN reset and a deactivation both pull it, so an
    admin rotating a compromised credential actually removes whoever was already inside
    (security audit SEC-05). Deactivation pulling it too is what stops a later reactivation
    from reviving the sessions the deactivation denied. A role change pulls it so the device
    signs in again and learns the new role (RBAC audit S4, 22.10.2026).

    The bump is an atomic ``gen = gen + 1`` at the row, NOT a read-modify-write on the ORM
    value: two overlapping resets that both read generation 0 would each write 1, leaving a
    session minted after the first reset alive through the second (SEC-05). Serialising at the
    row makes N resets advance the generation by N. ``synchronize_session=False`` leaves the
    identity-mapped value stale, so it is expired here — the callers' own ``db.refresh(user)``
    then re-reads the bumped value without clobbering their other pending edits.
    """
    await db.execute(
        update(User)
        .where(User.id == user.id)
        .values(auth_generation=User.auth_generation + 1)
        .execution_options(synchronize_session=False)
    )
    db.expire(user, ["auth_generation"])


@router.get("/roster", response_model=list[RosterUser])
async def roster(request: Request, db: AsyncSession = Depends(get_db)) -> list[User]:
    """Tappable login tiles for the kiosk — active users only, no secrets, same-origin only."""
    _refuse_cross_site(request)
    result = await db.execute(select(User).where(User.is_active.is_(True)).order_by(User.display_name))
    return list(result.scalars().all())


@router.post("/login", response_model=UserOut)
async def login(
    body: LoginRequest,
    request: Request,
    response: Response,
    known_device: Annotated[str | None, Cookie(alias=DEVICE_COOKIE)] = None,
    db: AsyncSession = Depends(get_db),
) -> UserOut:
    """PIN login behind two throttles, both taken BEFORE the first await (a concurrent burst is
    counted, not waved past a check nobody has failed yet — SEC-08 round 1):

    · the cooldown ladder per (account, device or source) — pin_limiter · PinLimiter;
    · for a device the account does not know, the account's new-device budget — NewDeviceBudget.

    A throttled attempt is REFUSED before the verify, a correct PIN included: verifying while
    throttled is what made the PIN space brute-forceable once (SEC-08 round 3). Both blocks are
    bounded and neither deepens while it stands, so the operator always gets a window — and a
    device the account knows is never behind the budget at all.
    """
    account = str(body.user_id)
    device = read_known_device(known_device)
    claims_known = device is not None and device.knows(account)
    # A known device is its own source: two tablets behind the station's one address must not
    # share a ladder, and a stolen cookie gains nothing by changing address.
    source = f"device:{device.id}" if device is not None and claims_known else client_ip(request)
    bucket = pin_limiter.key(account, source)

    budgeted = not claims_known
    if budgeted:
        wait, engaged = new_device_budget.reserve(account)
        if wait:
            raise await _refuse_new_device(db, account, wait, engaged)
    wait = pin_limiter.reserve(bucket)
    if wait:
        if budgeted:
            new_device_budget.release(account)  # refused before the verify: not a guess
        raise HTTPException(
            status_code=status.HTTP_429_TOO_MANY_REQUESTS,
            detail=f"Zu viele Fehlversuche. Bitte {wait}s warten.",
            headers={"Retry-After": str(wait)},
        )

    user = (await db.execute(select(User).where(User.id == body.user_id))).scalar_one_or_none()
    if device is not None and claims_known and (user is None or not device.is_current(user)):
        # The cookie names the account but under an older generation: the PIN was reset or the
        # account switched off since. That device is a stranger again. Its ladder slot above
        # bounds a burst here, so taking the budget after the fetch does not reopen the race.
        budgeted = True
        wait, engaged = new_device_budget.reserve(account)
        if wait:
            raise await _refuse_new_device(db, account, wait, engaged)

    # Spelled out rather than via an `ok` flag so the None-check actually narrows `user` for
    # everything below; short-circuiting keeps bcrypt off the unknown-user path as before.
    if user is None or not user.is_active or not await verify_pin_async(body.pin, user.pin_hash):
        # user UUID and limiter source key only — never the PIN or anything derived from it.
        logger.warning("PIN login failed: user=%s source=%s new_device=%s", body.user_id, source, budgeted)
        cooldown = pin_limiter.retry_after(bucket)  # installed by the reservation above
        detail = "Falsche PIN" if cooldown == 0 else f"Falsche PIN. Nächster Versuch in {cooldown}s."
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail=detail)

    # Knowing the PIN gives both reserved slots back and clears any cooldown the bucket was
    # carrying, so an operator's own mistyping never follows them in once they type it right.
    pin_limiter.record_success(bucket)
    if budgeted:
        new_device_budget.release(account)
    user.last_login = datetime.now(UTC)

    claims = _claims(user)
    set_auth_cookies(response, create_access_token(claims), create_refresh_token(claims))
    remember_device(response, device, user)
    return _with_session(user, _refresh_until())


@router.post("/refresh", response_model=UserOut)
async def refresh(
    response: Response,
    refresh_token: Annotated[str | None, Cookie(alias=REFRESH_COOKIE)] = None,
    known_device: Annotated[str | None, Cookie(alias=DEVICE_COOKIE)] = None,
    db: AsyncSession = Depends(get_db),
) -> UserOut:
    if not refresh_token:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Kein Refresh-Token")
    try:
        payload = decode_token(refresh_token)
    except JWTError as e:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Ungültiges Refresh-Token") from e
    if payload.get("type") != "refresh":
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Falscher Token-Typ")

    jti = payload.get("jti")
    exp = payload.get("exp")
    if not isinstance(jti, str) or not jti or not isinstance(exp, (int, float)):
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Ungültiges Refresh-Token")

    try:
        user_id = uuid.UUID(payload["sub"])
    except (KeyError, TypeError, ValueError) as e:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Ungültiges Refresh-Token") from e

    user = (await db.execute(select(User).where(User.id == user_id))).scalar_one_or_none()
    if user is None or not user.is_active:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Benutzer inaktiv")
    # A refresh token outlives the access cookie it came with and mints a fresh successor every
    # time, so this is the check that decides whether a revoked session can rebuild itself.
    if token_generation(payload) != user.auth_generation:
        logger.warning("Refresh refused: session revoked by a PIN reset or deactivation (user=%s)", user_id)
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Sitzung widerrufen")

    # Atomically consume before rotating. A check followed by a separate revoke lets two
    # concurrent requests both pass the check and each mint a valid successor token.
    try:
        expires_at = datetime.fromtimestamp(exp, tz=UTC)
    except (OverflowError, OSError, ValueError) as e:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Ungültiges Refresh-Token") from e
    # The successor's jti is DERIVED from this one, so there is exactly one successor however
    # many times this token is answered (security · successor_jti).
    successor = successor_jti(jti)
    if not await token_blocklist.consume(jti, expires_at):
        # Already consumed — but perhaps by a rotation whose answer this browser never got: a
        # reload while the old page's refresh was in flight, a dropped connection, the client's
        # own timeout. The server rotated, the cookie jar still holds this token, and strictly
        # one-time rotation signed the device out (24.09.2026, e2e «session renewal»: 3 in 40
        # locally). Within the grace window, and while the successor is still unused and
        # unrevoked, answer again with that same successor. Everything else is a replay.
        grace = timedelta(seconds=settings.refresh_reuse_grace_seconds)
        if not grace or not await token_blocklist.rotation_replayable(jti, successor, grace):
            logger.warning("Refresh refused: token already used (user=%s)", user_id)
            raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Refresh-Token widerrufen")
        logger.info("Refresh re-delivered: a rotation's answer was lost (user=%s)", user_id)
    claims = _claims(user)
    set_auth_cookies(response, create_access_token(claims), create_refresh_token(claims, jti=successor))
    # A live session proves an earlier PIN login here. This is also how the devices that were
    # signed in before the known-device cookie existed became known, without anyone noticing.
    remember_device(response, read_known_device(known_device), user)
    return _with_session(user, _refresh_until())


@router.post("/logout")
async def logout(
    request: Request,
    response: Response,
    access_token: Annotated[str | None, Cookie()] = None,
    refresh_token: Annotated[str | None, Cookie(alias=REFRESH_COOKIE)] = None,
) -> dict:
    await revoke_token(access_token)
    await revoke_refresh_token(refresh_token)
    clear_auth_cookies(response)
    return {"ok": True}


@router.get("/me", response_model=UserOut)
async def me(
    current_user: CurrentUser,
    refresh_token: Annotated[str | None, Cookie(alias=REFRESH_COOKIE)] = None,
) -> UserOut:
    # The refresh cookie's expiry is read, never consumed or verified beyond its signature: a
    # link session has no refresh cookie and answers None, so does a cookie this key cannot read.
    until: datetime | None = None
    if refresh_token and not getattr(current_user, "link_scoped", False):
        try:
            exp = decode_token(refresh_token).get("exp")
            if isinstance(exp, (int, float)):
                until = datetime.fromtimestamp(exp, tz=UTC)
        except (JWTError, OverflowError, OSError, ValueError):
            until = None
    return _with_session(current_user, until)


# --- User administration (Slice 2 — Members & access) -------------------------------
# Admin-only (the deployment ADMIN_SECRET session, NOT the incident editor role). These
# live under /api/auth/users (distinct from the PUBLIC active-only /api/auth/roster).
# pin_hash is NEVER serialised — UserAdminOut omits it. We DEACTIVATE, never hard-delete,
# so audit-log FKs (incident_events.user_id, notes, …) stay intact.


# Operator-facing German, like every other refusal this router returns ("Falsche PIN",
# "Benutzername bereits vergeben"). Both are the wording the admin PIN sheet already shows
# (src/config/copy · admin.members.pinTrivial / pinInvalid), so the sheet's own guard and the
# server's say the same sentence. `hash_pin`'s ValueError stays English: it is a console/CLI
# message and used to be the one raw English string that reached an operator's screen.
_PIN_TOO_SIMPLE = "Diese PIN ist zu einfach – bitte eine andere wählen."
_PIN_WRONG_LENGTH = f"PIN muss {settings.pin_min_length}–{settings.pin_max_length} Ziffern haben."


def _hash_pin_or_400(pin: str) -> str:
    """Hash a PIN for storage, refusing anything an operator must not be able to set.

    The single gate for BOTH PIN writers (create_user and reset_pin), so the well-known-PIN
    rule the seeder applies at boot (security.TRIVIAL_PINS) is the same rule the API applies.
    Checked before hashing — no point spending a bcrypt round on a PIN we are rejecting.
    """
    if pin in TRIVIAL_PINS:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=_PIN_TOO_SIMPLE)
    try:
        return hash_pin(pin)
    except ValueError as e:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=_PIN_WRONG_LENGTH) from e


async def _count_active_editors(db: AsyncSession, *, exclude_id: uuid.UUID | None = None) -> int:
    stmt = select(func.count()).select_from(User).where(User.role == "editor", User.is_active.is_(True))
    if exclude_id is not None:
        stmt = stmt.where(User.id != exclude_id)
    return int((await db.execute(stmt)).scalar_one())


@router.get("/users", response_model=list[UserAdminOut])
async def list_users(_admin: CurrentAdmin, db: AsyncSession = Depends(get_db)) -> list[User]:
    """ALL login users incl. inactive — the admin members table."""
    result = await db.execute(select(User).order_by(User.is_active.desc(), User.display_name))
    return list(result.scalars().all())


@router.post("/users", response_model=UserAdminOut, status_code=status.HTTP_201_CREATED)
async def create_user(body: UserCreate, _admin: CurrentAdmin, db: AsyncSession = Depends(get_db)) -> User:
    taken = (await db.execute(select(User).where(User.username == body.username))).scalar_one_or_none()
    if taken is not None:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Benutzername bereits vergeben")

    user = User(
        username=body.username,
        display_name=body.display_name,
        role=body.role,
        color=body.color,
        el_view_default=body.el_view_default,
        pin_hash=_hash_pin_or_400(body.pin),
        is_active=True,
    )
    db.add(user)
    await db.flush()
    await db.refresh(user)
    return user


@router.patch("/users/{user_id}", response_model=UserAdminOut)
async def update_user(
    user_id: uuid.UUID,
    body: UserUpdate,
    _admin: CurrentAdmin,
    current: OptionalUser,
    db: AsyncSession = Depends(get_db),
) -> User:
    # The invariant spans accounts, so locking only the target would leave two independent
    # demotions/deactivations free to remove the last two editors together. Acquire every
    # active editor in a stable order, then read the target afresh after any wait.
    await db.execute(
        select(User.id).where(User.role == "editor", User.is_active.is_(True)).order_by(User.id).with_for_update()
    )
    user = (
        await db.execute(select(User).where(User.id == user_id).execution_options(populate_existing=True))
    ).scalar_one_or_none()
    if user is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Benutzer nicht gefunden")

    # Detect the two dangerous transitions on a currently-active editor. ⚠️ Demoting is ANY
    # role but editor — `el` writes the record but not the Lage, so an `el` is no editor either;
    # checking for `viewer` alone let the last editor be demoted to `el` (RBAC audit, 22.10.2026).
    deactivating = body.is_active is False and user.is_active
    demoting = body.role is not None and body.role != "editor" and user.role == "editor"

    if (deactivating or demoting) and current is not None and user.id == current.id:
        verb = "deaktivieren" if deactivating else "herabstufen"
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Du kannst dein eigenes Konto nicht {verb}.",
        )

    # Last-active-editor guard: never let the count of active editors reach 0.
    if (deactivating or demoting) and user.role == "editor" and user.is_active:
        others = await _count_active_editors(db, exclude_id=user.id)
        if others == 0:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Der letzte aktive Bearbeiter kann nicht deaktiviert oder herabgestuft werden.",
            )

    if body.display_name is not None:
        user.display_name = body.display_name
    if body.color is not None:
        user.color = body.color
    if body.role is not None and body.role != user.role:
        # A device keeps the role it signed in with (the client reads it once, off /me), so a
        # role change ends every session like a PIN reset does. Left standing, an editor made
        # `el` mid-Einsatz kept an editor UI whose tactical edits the server no longer stored
        # (RBAC audit S4, 22.10.2026); signing in again is what hands the device the new role.
        await revoke_sessions(db, user)
        user.role = body.role
    if body.is_active is not None:
        if deactivating:
            # Denying access and leaving the sessions standing is only half a deactivation:
            # reactivating later would hand them back (SEC-05).
            await revoke_sessions(db, user)
        user.is_active = body.is_active
    if body.el_view_default is not None:
        user.el_view_default = body.el_view_default

    await db.flush()
    await db.refresh(user)
    return user


@router.post("/users/{user_id}/pin", response_model=UserAdminOut)
async def reset_pin(
    user_id: uuid.UUID,
    body: PinReset,
    _admin: CurrentAdmin,
    db: AsyncSession = Depends(get_db),
) -> User:
    user = (await db.execute(select(User).where(User.id == user_id))).scalar_one_or_none()
    if user is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Benutzer nicht gefunden")
    user.pin_hash = _hash_pin_or_400(body.pin)
    # The whole point of resetting a PIN is that the old one stops working — for the sessions
    # it already opened too, not just for the login screen.
    await revoke_sessions(db, user)
    # …and for the lock screens. Push rows belong to the ACCOUNT and renew without a session, so
    # a lost phone kept showing «Neuer Einsatz – Titel – Adresse» after the reset that signed it
    # out. A device that signs in with the new PIN registers again on its own.
    await db.execute(delete(PushSubscription).where(PushSubscription.user_id == user.id))
    await db.flush()
    await db.refresh(user)
    return user
