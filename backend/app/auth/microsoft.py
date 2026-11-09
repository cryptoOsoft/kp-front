"""Optional «Mit Microsoft anmelden» — Entra ID sign-in onto an EXISTING named account.

WHAT IT IS, AND WHAT IT IS NOT
------------------------------
A second door onto the same accounts the kiosk PIN opens. It never creates a user, never
changes a role and never replaces the PIN: an Entra identity gets in only if the admin has
listed it against a username (``entra_login_accounts``), and what it gets is exactly that
account's ordinary session (the same cookies, the same ``auth_generation`` revocation).
Deployment administration stays behind ``ADMIN_SECRET`` — a Microsoft login is never an
admin session.

Zero impact when unconfigured: :func:`enabled` is false until the tenant, client, secret AND
the allow-list are all set, and then both routes answer 404 and the public config says
``microsoftLoginConfigured: false``, so the login screen draws no button. Nothing on the PIN
path reads this module — a tablet at the Schadenplatz with no internet never meets it.

THE FLOW (OIDC authorization code + PKCE, confidential client)
--------------------------------------------------------------
``GET /api/auth/microsoft/start`` mints state, nonce and a PKCE verifier, keeps them in a
short-lived signed cookie scoped to this path (no table, no migration), and redirects to the
tenant's authorize endpoint. Microsoft redirects back to ``…/callback``, which checks the
state against that cookie, redeems the code with the verifier and the client secret, validates
the ID token (RS256 against the tenant's JWKS, audience, issuer, nonce), maps ``oid`` through
the allow-list, and sets the session. Only the object id: a sign-in name (``preferred_username``)
can be renamed and handed to somebody else in the tenant, so it is no identity to grant an
account on (RBAC audit, 22.10.2026). Every refusal redirects
to ``/?msLogin=<reason>`` so the login screen can say what happened — never a JSON page.

Setup (what to register in Entra): docs/microsoft-login.md.
"""

from __future__ import annotations

import base64
import hashlib
import logging
import secrets
import uuid
from datetime import UTC, datetime, timedelta
from typing import Annotated, Any
from urllib.parse import urlencode

import anyio
import httpx
import jwt
from fastapi import APIRouter, Cookie, Depends, HTTPException, Request
from fastapi.responses import RedirectResponse
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from .. import credentials
from ..config import settings
from ..database import get_db
from ..models import User
from .cookies import set_auth_cookies
from .known_device import DEVICE_COOKIE, read_known_device, remember_device
from .router import _claims
from .security import create_access_token, create_refresh_token

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/auth/microsoft", tags=["auth"])

FIELDS = ("entra_login_tenant_id", "entra_login_client_id", "entra_login_client_secret", "entra_login_accounts")
TX_COOKIE = "ms_login_tx"
TX_PATH = "/api/auth/microsoft"
TX_SECONDS = 600
#: Audience of the transaction cookie's JWT, so it can never pass for any other token this
#: app signs with SECRET_KEY (an access token has no `aud`; this one requires it).
_TX_AUD = "kp-front/ms-login"
CALLBACK_PATH = "/api/auth/microsoft/callback"
SCOPE = "openid profile"


def enabled() -> bool:
    # Environment values bypass the admin's write validation. A pasted display name or
    # malformed allow-list must not advertise a sign-in that cannot work.
    try:
        return all(credentials.validate(name, credentials.get(name)) for name in FIELDS)
    except credentials.CredentialRefusedError:
        return False


def parse_accounts(raw: str) -> dict[str, str]:
    """``objectid=username`` pairs, separated by commas or semicolons → {object id: username}.

    The identity is the person's Entra object id (a GUID), normalised to lower case. A sign-in
    name («anna.muster@feuerwehr.ch») is refused like any malformed entry: ``ValueError``, which
    credentials.validate turns into the admin's error line — and which keeps the button hidden
    while such a list is configured, rather than leaving a line that silently lets nobody in.
    """
    out: dict[str, str] = {}
    for chunk in raw.replace(";", ",").split(","):
        entry = chunk.strip()
        if not entry:
            continue
        identity, sep, username = (part.strip() for part in entry.partition("="))
        if not sep or not identity or not username:
            raise ValueError(entry)
        out[str(uuid.UUID(identity))] = username  # ValueError for anything but a GUID
    return out


def _accounts() -> dict[str, str]:
    try:
        return parse_accounts(credentials.get("entra_login_accounts"))
    except ValueError:
        return {}


def _authority() -> str:
    return f"https://login.microsoftonline.com/{credentials.get('entra_login_tenant_id')}"


def _redirect_uri(request: Request) -> str:
    """The callback address Microsoft sends the browser back to. ``PUBLIC_URL`` when set (the
    production answer — it is what gets registered in Entra); otherwise the origin this request
    came in on, which is what `just dev` needs. A forged Host only yields an address Entra
    refuses, since the redirect URI must match the registration exactly."""
    if settings.public_url:
        return settings.public_url.strip().rstrip("/") + CALLBACK_PATH
    headers = request.headers
    scheme = (headers.get("x-forwarded-proto") or request.url.scheme).split(",")[0].strip()
    host = (headers.get("x-forwarded-host") or headers.get("host") or request.url.netloc).split(",")[0].strip()
    return f"{scheme}://{host}{CALLBACK_PATH}"


def _back(reason: str | None = None) -> RedirectResponse:
    response = RedirectResponse("/" if reason is None else f"/?msLogin={reason}", status_code=303)
    response.delete_cookie(TX_COOKIE, path=TX_PATH)
    return response


def _require_enabled() -> None:
    if not enabled():
        raise HTTPException(status_code=404, detail="Microsoft-Anmeldung ist nicht eingerichtet")


@router.get("/start")
async def start(request: Request, db: AsyncSession = Depends(get_db)) -> RedirectResponse:
    await credentials.load(db)
    _require_enabled()
    state, nonce, verifier = secrets.token_urlsafe(32), secrets.token_urlsafe(32), secrets.token_urlsafe(64)
    redirect_uri = _redirect_uri(request)
    challenge = base64.urlsafe_b64encode(hashlib.sha256(verifier.encode()).digest()).rstrip(b"=").decode()
    query = urlencode(
        {
            "client_id": credentials.get("entra_login_client_id"),
            "response_type": "code",
            "redirect_uri": redirect_uri,
            "response_mode": "query",
            "scope": SCOPE,
            "state": state,
            "nonce": nonce,
            "code_challenge": challenge,
            "code_challenge_method": "S256",
            "prompt": "select_account",
        }
    )
    tx = jwt.encode(
        {
            "aud": _TX_AUD,
            "exp": datetime.now(UTC) + timedelta(seconds=TX_SECONDS),
            "state": state,
            "nonce": nonce,
            "verifier": verifier,
            "redirect_uri": redirect_uri,
        },
        settings.secret_key,
        algorithm=settings.algorithm,
    )
    response = RedirectResponse(f"{_authority()}/oauth2/v2.0/authorize?{query}", status_code=303)
    # Lax: Microsoft's redirect back is a top-level GET, which Lax carries.
    response.set_cookie(
        TX_COOKIE, tx, max_age=TX_SECONDS, httponly=True, samesite="lax", secure=settings.cookie_secure, path=TX_PATH
    )
    return response


async def exchange_code(code: str, verifier: str, redirect_uri: str) -> dict[str, Any]:
    """Redeem the authorization code at the tenant's token endpoint (a seam for the tests)."""
    async with httpx.AsyncClient(timeout=10.0) as client:
        response = await client.post(
            f"{_authority()}/oauth2/v2.0/token",
            data={
                "client_id": credentials.get("entra_login_client_id"),
                "client_secret": credentials.get("entra_login_client_secret"),
                "grant_type": "authorization_code",
                "code": code,
                "code_verifier": verifier,
                "redirect_uri": redirect_uri,
                "scope": SCOPE,
            },
        )
    if response.status_code != 200:
        raise ValueError(f"token endpoint answered {response.status_code}: {response.text[:300]}")
    return response.json()


_jwks: dict[str, jwt.PyJWKClient] = {}


def signing_key(id_token: str) -> Any:
    """The tenant's public key for this token (cached per tenant; blocking, so run in a thread)."""
    url = f"{_authority()}/discovery/v2.0/keys"
    client = _jwks.setdefault(url, jwt.PyJWKClient(url, cache_keys=True))
    return client.get_signing_key_from_jwt(id_token).key


async def validate_id_token(id_token: str, nonce: str) -> dict[str, Any]:
    key = await anyio.to_thread.run_sync(signing_key, id_token)
    tenant = credentials.get("entra_login_tenant_id")
    claims: dict[str, Any] = jwt.decode(
        id_token,
        key,
        algorithms=["RS256"],
        audience=credentials.get("entra_login_client_id"),
        issuer=f"https://login.microsoftonline.com/{tenant}/v2.0",
        options={"require": ["exp", "iss", "aud", "nonce"]},
    )
    if not secrets.compare_digest(str(claims.get("nonce", "")).encode(), nonce.encode()):
        raise jwt.InvalidTokenError("nonce mismatch")
    return claims


def username_for(claims: dict[str, Any]) -> str | None:
    """The allow-listed username for this identity — by its object id (``oid``) only."""
    try:
        oid = str(uuid.UUID(str(claims.get("oid", ""))))
    except ValueError:
        return None
    return _accounts().get(oid)


@router.get("/callback")
async def callback(
    request: Request,
    tx: Annotated[str | None, Cookie(alias=TX_COOKIE)] = None,
    db: AsyncSession = Depends(get_db),
) -> RedirectResponse:
    await credentials.load(db)
    _require_enabled()
    params = request.query_params
    if params.get("error"):
        # The user cancelled at Microsoft, or the tenant refused (no consent, blocked account).
        logger.info("Microsoft login ended at Microsoft: %s", params.get("error"))
        return _back("cancelled" if params.get("error") == "access_denied" else "failed")
    try:
        payload = jwt.decode(tx or "", settings.secret_key, algorithms=[settings.algorithm], audience=_TX_AUD)
    except jwt.InvalidTokenError:
        return _back("expired")
    sent = params.get("state", "").encode()
    if not secrets.compare_digest(str(payload.get("state", "")).encode(), sent) or not params.get("code"):
        logger.warning("Microsoft login refused: state mismatch")
        return _back("failed")
    try:
        tokens = await exchange_code(params["code"], payload["verifier"], payload["redirect_uri"])
        claims = await validate_id_token(str(tokens.get("id_token", "")), payload["nonce"])
    except (ValueError, httpx.HTTPError, jwt.PyJWTError) as e:
        logger.warning("Microsoft login refused: %s", e)
        return _back("failed")

    username = username_for(claims)
    if username is None:
        # oid + sign-in name only — enough for the admin to add the line, no token contents.
        logger.warning(
            "Microsoft login refused: not on the allow-list (oid=%s, upn=%s)",
            claims.get("oid"),
            claims.get("preferred_username"),
        )
        return _back("unknown")
    user = (await db.execute(select(User).where(func.lower(User.username) == username.lower()))).scalar_one_or_none()
    if user is None or not user.is_active:
        logger.warning("Microsoft login refused: account %r missing or inactive", username)
        return _back("inactive")

    user.last_login = datetime.now(UTC)
    claims_out = _claims(user)
    logger.info("Microsoft login: oid=%s → user=%s", claims.get("oid"), user.id)
    response = _back()
    set_auth_cookies(response, create_access_token(claims_out), create_refresh_token(claims_out))
    # a later PIN login on this browser is a known device's (auth/known_device)
    remember_device(response, read_known_device(request.cookies.get(DEVICE_COOKIE)), user)
    return response
