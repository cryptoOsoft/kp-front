"""FastAPI auth dependencies. Two roles: editor (edit) / viewer (read-only)."""

import logging
import uuid
from typing import Annotated

from fastapi import Cookie, Depends, HTTPException, Request, status
from jwt import InvalidTokenError as JWTError
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from ..config import settings
from ..database import get_db
from ..models import User
from .incident_link import link_page_owns_session, read_link_session
from .security import admin_token_is_current, decode_token
from .token_blocklist import token_blocklist
from .viewer_scope import enforce_viewer_window

logger = logging.getLogger(__name__)

_credentials_exc = HTTPException(
    status_code=status.HTTP_401_UNAUTHORIZED,
    detail="Nicht angemeldet",
    headers={"WWW-Authenticate": "Bearer"},
)

# Deployment-admin gate uses two distinct failures so the /admin UI can tell them apart:
# 403 = admin surface not configured on this server; 401 = configured but not unlocked.
_admin_disabled_exc = HTTPException(
    status_code=status.HTTP_403_FORBIDDEN,
    detail="Admin-Zugang ist auf diesem Server nicht eingerichtet (ADMIN_SECRET fehlt).",
)
_admin_auth_exc = HTTPException(
    status_code=status.HTTP_401_UNAUTHORIZED,
    detail="Admin-Anmeldung erforderlich",
)


#: JWT claim carrying `User.auth_generation` — the counter a PIN reset or a deactivation bumps
#: to end every session an account holds (auth/router.revoke_sessions).
AUTH_GENERATION_CLAIM = "gen"


def token_generation(payload: dict) -> int:
    """The generation a token was minted under; 0 for one minted before the claim existed.

    Reading a missing claim as 0 is what carries cookies in flight across the deploy: every
    row starts at generation 0, so nobody is signed out by the upgrade itself, and the first
    reset or deactivation after it still ends those sessions. A claim of the wrong shape is
    not a generation and is treated as `-1`, which matches nothing.
    """
    raw = payload.get(AUTH_GENERATION_CLAIM, 0)
    return raw if isinstance(raw, int) and not isinstance(raw, bool) else -1


#: Identity of a logged-out incident-link visitor. A fixed sentinel rather than a real row:
#: there is no account behind a link, and inventing one would put a fake person into the
#: roster, the audit trail and every `created_by` a future writer might stamp.
LINK_GUEST_ID = uuid.UUID("00000000-0000-0000-0000-00000000110c")


def _link_kind(claims: dict) -> str:
    """Which of the link kinds minted this session — see auth/incident_link.

    Read off the claim that already decides the session's liveness rule, so there is one
    source of truth rather than a second marker that could disagree with it.
    """
    if claims.get("ak"):
        return "atemschutz"
    if claims.get("sk"):
        return "atemschutz-standing"
    if claims.get("tk"):
        return "terminal"
    if claims.get("vk"):
        return "view"
    return "alarm"


def _link_guest(claims: dict) -> User:
    """A transient `viewer` principal for an incident-link session.

    Never added to the session and never flushed — it exists so the ~25 allowlisted read
    endpoints can keep taking `CurrentUser` unchanged instead of growing a second auth
    shape each. What stops it doing more than a viewer is `enforce_link_scope`, not this
    object; `role="viewer"` here is belt to that braces (it also fails `CurrentEditor`).

    An Atemschutz link writes, and it does so as this same `viewer` guest: the narrow routes
    it may reach take `CurrentAtemschutzWriter`, which lets a link session through on the
    `ak` claim rather than on a role. Nothing here is widened for it.
    """
    incident_id = str(claims["inc"])
    guest = User(
        id=LINK_GUEST_ID,
        username="einsatz-link",
        display_name="Einsatz-Link",
        role="viewer",
        is_active=True,
        # Column defaults are applied on flush, and this object is deliberately never
        # flushed — so every column the response schema reads has to be set by hand here.
        # Left implicit it stays None, and `UserOut.el_view_default: bool` rejects None
        # (a field default fills a MISSING attribute, not a present-but-None one), which
        # turns /api/auth/me into a 500 for exactly one kind of visitor.
        el_view_default=False,
        color=None,
        last_login=None,
    )
    # Attached to the instance, deliberately not declared on the model: they exist only
    # on this transient principal, and a `Mapped[...]` column would put two columns on
    # every real user row to describe a session that has no row at all. `UserOut` reads
    # them by attribute and falls back to its own defaults for a real user, where they
    # are simply absent. SQLAlchemy 2.0 rejects non-`Mapped` annotations on a declarative
    # class (MappedAnnotationError), so there is no way to declare them for the type
    # checker either — hence the narrow ignores rather than a model change.
    guest.link_scoped = True  # type: ignore[attr-defined]  # read by /api/auth/me
    guest.link_incident_id = incident_id  # type: ignore[attr-defined]
    guest.link_kind = _link_kind(claims)  # type: ignore[attr-defined]
    # which SESSION this is (the cookie's own random jti): every link holder shares the one guest
    # identity above, so a per-device owner needs this – api/presentation · _owner
    guest.link_session = str(claims.get("jti") or "")  # type: ignore[attr-defined]
    return guest


async def get_current_user(
    request: Request,
    access_token: Annotated[str | None, Cookie()] = None,
    db: AsyncSession = Depends(get_db),
) -> User:
    # An incident-link session, when THIS page is one — which the page says rather than the
    # cookie jar implying it (auth/incident_link · LINK_MODE_HEADER · read_link_session). On
    # the ordinary app that is never true, so a link cookie left over from an alert tapped
    # this morning changes nothing about who this device is; on a link page it is the answer
    # even where the device also holds a login, whose own cookies are left untouched.
    claims = read_link_session(request)
    if claims and claims.get("inc"):
        guest = _link_guest(claims)
        request.state.user = guest
        return guest
    if link_page_owns_session(request):
        # …and a page that said "use" is that session or it is NOBODY. Falling through to the
        # device's access token here was the whole feature inverted: a handed-over Atemschutz
        # board whose link cookie had expired (or was never set, or was shed) quietly became
        # the phone OWNER's full login — no link allowlist, no incident scope, writes stamped
        # with their user_id, and revoking the link changing nothing. 401 instead, which is
        # also what `get_user_or_admin` below already answers, so the two agree. The link app
        # recovers by re-exchanging the token still standing in its own address bar
        # (src/link/LinkApp · LinkSession → reload → openIncidentLink).
        raise _credentials_exc
    if not access_token:
        raise _credentials_exc
    try:
        payload = decode_token(access_token)
        if payload.get("type") != "access":
            raise _credentials_exc
        jti = payload.get("jti")
        if jti and await token_blocklist.is_revoked(jti):
            raise _credentials_exc
        sub = payload.get("sub")
        if sub is None:
            raise _credentials_exc
        user_id = uuid.UUID(sub)
    except (JWTError, ValueError) as e:
        raise _credentials_exc from e

    user = (await db.execute(select(User).where(User.id == user_id))).scalar_one_or_none()
    if user is None or not user.is_active:
        raise _credentials_exc
    # A cookie minted before the account's credential was rotated is not a session any more.
    if token_generation(payload) != user.auth_generation:
        raise _credentials_exc
    # A viewer reads the running Einsätze and the last week, every route alike (viewer_scope).
    await enforce_viewer_window(request, db, user)
    request.state.user = user
    return user


async def get_current_editor(current_user: Annotated[User, Depends(get_current_user)]) -> User:
    if current_user.role != "editor":
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Bearbeiter-Berechtigung erforderlich")
    return current_user


async def get_record_writer(current_user: Annotated[User, Depends(get_current_user)]) -> User:
    """An editor, OR the ``el`` role (Einsatzleiter function, 07.09.2026) — the door on the
    RECORD surfaces: the ``workspace/record`` slice, journal/event appends, and the Rapport's
    media uploads. An ``el`` session reads like a viewer everywhere else and never reaches the
    full workspace PUT, so the tactical picture (Karte, Pläne, Trupps, Settings) stays
    editor-only however the frontend evolves. Link sessions are NOT admitted here — a link's
    writes go through its own allowlist (``get_atemschutz_writer``)."""
    if current_user.role not in ("editor", "el") or getattr(current_user, "link_kind", None):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Bearbeiter-Berechtigung erforderlich")
    return current_user


async def get_append_writer(
    request: Request,
    access_token: Annotated[str | None, Cookie()] = None,
    db: AsyncSession = Depends(get_db),
) -> User:
    """An editor, the ``el`` role, or an Atemschutz-link session — the door on the two
    APPEND-ONLY streams (journal rows, audit events). What each caller may append stays the
    handlers' business: the link its ``team`` rows / ``atemschutz.*`` ops, an ``el`` session
    any Verlauf row and the record vocabulary of events (api/events.py · ``EL_EVENT_PREFIXES``). ⚠️ Deliberately NOT the
    trupps slice: the safety watch is tactical and stays editor-or-link
    (``get_atemschutz_writer`` below)."""
    user = await get_current_user(request, access_token, db)
    if user.role in ("editor", "el") or is_atemschutz_link(user):
        return user
    raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Bearbeiter-Berechtigung erforderlich")


async def get_atemschutz_writer(
    request: Request,
    access_token: Annotated[str | None, Cookie()] = None,
    db: AsyncSession = Depends(get_db),
) -> User:
    """An editor, OR an Atemschutz-link session — the door on the three routes that link may
    write (auth/incident_link · ``ATEMSCHUTZ_LINK_ALLOWED``).

    This is the FIRST of two gates and the weaker one: it only says «this caller may write
    something here». Which routes, which journal rows and which op_types is the allowlist's
    and the handlers' business. A viewer account, an alarm link and a Rapport view link all
    fall through to the same 403 an editor-only route would have given them.
    """
    user = await get_current_user(request, access_token, db)
    if user.role == "editor" or is_atemschutz_link(user):
        return user
    raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Bearbeiter-Berechtigung erforderlich")


def is_atemschutz_link(user: User) -> bool:
    """True when the caller is an Atemschutz LINK session — per-incident (`ak`) or standing
    (`sk`), which share the write surface — rather than a signed-in editor. Decides who a
    write is attributed to (`user_id=None`) and that it is stamped as a link's."""
    return getattr(user, "link_kind", None) in ("atemschutz", "atemschutz-standing")


def is_link_session(user: User | None) -> bool:
    """True for any incident-link session (alarm, view, Atemschutz, terminal) — a page that may
    leave the station (a Rapport view link is forwarded by design). Such a caller reads the
    record without the station's internal keys: no account UUIDs (an Einsatz's ``created_by``,
    an event's ``user_id``) and no Divera ids on the roster (RBAC audit, 22.10.2026)."""
    return getattr(user, "link_kind", None) is not None


def atemschutz_link_source(user: User) -> str:
    """The provenance stamp for an Atemschutz-link write: which CREDENTIAL wrote. The record
    keeps it (journal `via`, event/journal `source`), so the two must stay distinguishable —
    a laminated standing QR and a link an editor handed out mid-Einsatz are different levers
    with different revocations. Only meaningful when `is_atemschutz_link` already said yes.

    ⚠️ "atemschutz-fix", not "-standing": the stamp lands in `String(16)` source columns
    (models · IncidentEvent.source), and Postgres enforces that where the SQLite test DB does
    not — a longer stamp 500s every board write in production only (test_standing_links pins
    the budget)."""
    return "atemschutz-fix" if getattr(user, "link_kind", None) == "atemschutz-standing" else "atemschutz-link"


async def get_optional_user(
    request: Request,
    access_token: Annotated[str | None, Cookie()] = None,
    db: AsyncSession = Depends(get_db),
) -> User | None:
    """Resolve the logged-in user if a valid session cookie is present, else None.

    Admin endpoints authorize on the admin SECRET (``get_current_admin``), not on a user;
    this lets them still stamp ``updated_by`` for audit when a person is driving the /admin
    UI, while the CLI (admin secret, no user) cleanly stamps NULL.
    """
    if not access_token:
        return None
    try:
        return await get_current_user(request, access_token, db)
    except HTTPException:
        return None


async def get_current_admin(admin_session: Annotated[str | None, Cookie()] = None) -> None:
    """Gate the deployment-admin surface on the shared ADMIN_SECRET session, NOT the
    incident editor role. Fail-closed: with no secret configured the surface is off (403)."""
    if not settings.admin_secret:
        raise _admin_disabled_exc
    if not admin_session:
        raise _admin_auth_exc
    try:
        payload = decode_token(admin_session)
        if not admin_token_is_current(payload):
            raise _admin_auth_exc
        jti = payload.get("jti")
        if jti and await token_blocklist.is_revoked(jti):
            raise _admin_auth_exc
    except (JWTError, ValueError) as e:
        raise _admin_auth_exc from e


async def _admin_session_valid(admin_session: str | None) -> bool:
    """True when a live admin session is presented (secret configured + valid cookie)."""
    if not (settings.admin_secret and admin_session):
        return False
    try:
        payload = decode_token(admin_session)
        if not admin_token_is_current(payload):
            return False
        jti = payload.get("jti")
        return not (jti and await token_blocklist.is_revoked(jti))
    except (JWTError, ValueError):
        return False


async def get_user_or_admin(
    request: Request,
    access_token: Annotated[str | None, Cookie()] = None,
    admin_session: Annotated[str | None, Cookie()] = None,
    db: AsyncSession = Depends(get_db),
) -> User | None:
    """Read access for surfaces shared by the field app AND the /admin UI (roster, Traccar
    status). The /admin surface is admin-secret-only (no kiosk login), so an admin session
    must satisfy these too — resolving to None (no user identity), like the CLI."""
    # …unless the caller is a LINK page, which answers as its own session even on a device that
    # is signed in — or as nothing at all (auth/incident_link · link_page_owns_session). Handled
    # first and completely, so this dependency cannot resolve such a page to the device's login
    # or to the operator's admin session. Same rule as get_current_user, whose comment says why.
    if link_page_owns_session(request):
        claims = read_link_session(request)
        if claims and claims.get("inc"):
            guest = _link_guest(claims)
            request.state.user = guest
            return guest
        raise _credentials_exc
    if access_token:
        try:
            return await get_current_user(request, access_token, db)
        except HTTPException:
            pass
    if await _admin_session_valid(admin_session):
        return None
    # Roster, objects, reference and Traccar status sit behind this dependency and are all
    # on the incident-link allowlist — the map is unreadable without them.
    claims = read_link_session(request)
    if claims and claims.get("inc"):
        guest = _link_guest(claims)
        request.state.user = guest
        return guest
    raise _credentials_exc


async def get_editor_or_admin(
    request: Request,
    access_token: Annotated[str | None, Cookie()] = None,
    admin_session: Annotated[str | None, Cookie()] = None,
    db: AsyncSession = Depends(get_db),
) -> User | None:
    """Write access for the same shared surfaces: an incident editor OR the deployment
    admin (roster CRUD/import, Divera pool refresh). Viewers stay read-only."""
    if access_token:
        try:
            user = await get_current_user(request, access_token, db)
        except HTTPException:
            user = None
        if user is not None:
            if user.role != "editor":
                # a kiosk viewer with an admin session unlocked still counts as admin
                if await _admin_session_valid(admin_session):
                    return None
                raise HTTPException(
                    status_code=status.HTTP_403_FORBIDDEN, detail="Bearbeiter-Berechtigung erforderlich"
                )
            return user
    if await _admin_session_valid(admin_session):
        return None
    raise _credentials_exc


CurrentUser = Annotated[User, Depends(get_current_user)]
CurrentEditor = Annotated[User, Depends(get_current_editor)]
CurrentRecordWriter = Annotated[User, Depends(get_record_writer)]
CurrentAppendWriter = Annotated[User, Depends(get_append_writer)]
CurrentAtemschutzWriter = Annotated[User, Depends(get_atemschutz_writer)]
OptionalUser = Annotated[User | None, Depends(get_optional_user)]
CurrentAdmin = Annotated[None, Depends(get_current_admin)]
UserOrAdmin = Annotated[User | None, Depends(get_user_or_admin)]
EditorOrAdmin = Annotated[User | None, Depends(get_editor_or_admin)]
