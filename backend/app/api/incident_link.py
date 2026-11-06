"""Incident view links (`/api/incident-link/*`) — the alert-link exchange.

An alerting system puts a URL carrying a signed token into the alarm it sends out; a
responder taps it on a personal phone and this endpoint trades that token for a logged-out,
read-only session scoped to exactly one incident (what the session may then reach is the
allowlist in `auth/incident_link.py`). The trust model is possession of the alert — the same
authority as knowing the Einsatz happened at all, and it expires with the Einsatz.

Two keys, and the split is the point. The station's `incident_link_key` (this file's admin
trio mints it) is shared with the alerting system and can do exactly one thing: ask for a
link session. It is NOT `SECRET_KEY`, which peppers PINs and mints admin sessions and never
leaves kp-front. The alerting system signs offline, with no call to us — it sits on the
life-critical path and must not depend on this app being reachable.

Fail-closed twice over: no key configured → 403, and a link only opens a session while its
incident is still running (not archived, not closed). A closed Einsatz answers the same 404
as one that never existed — a link holder must not be able to enumerate the station's
incidents by watching which refusals differ.

The exchange also *opens* an alarm that is still waiting in an intake pool (2026-08-02): the
link used to be dead until an editor had taken the alarm on a tablet, which put a colleague
between the responder and the Lage. Opening grants nothing extra — the session that follows
is the same read-only viewer — and the incident stays unconfirmed (`editor_opened_at` NULL),
so a link nobody at the station ever worked never reaches the statistics.

THE SECOND KIND OF LINK (2026-09-01)
------------------------------------
`/l/v<secret>` is the Rapport's own view link, minted in the app by an editor
(the `view-link` trio below) and handed to somebody OUTSIDE the station: a Gemeinde,
a Nachbarwehr, an insurer — «so they can see in one go what we did». It lands on the same door
and opens the same read-only session, and every other rule above still holds: one incident,
the same allowlist, the same scope check.

Two things differ, and both follow from who it is for:
  · it does NOT expire with the Einsatz — the Einsatz being over is the normal case for it;
  · it is revoked ON ITS OWN, per incident, by clearing `Incident.view_link_key`, rather than
    by rotating the station's minting key, which would take every alarm link with it.
Because it cannot expire, revoking has to be complete: the check runs on every request, so a
session already open on somebody's phone dies together with the URL.

THE THIRD KIND OF LINK (2026-09-01)
-----------------------------------
`/l/a<secret>` is the Atemschutz link, minted in the app by an editor from a RUNNING Einsatz
(the `atemschutz-link` trio below) and handed to somebody who is not on the FU — the
colleague at the Eingang who keeps the Atemschutzüberwachung. Same door, same secret-is-the-
credential lookup, same per-incident revocation as the view link; the lifetime is the alarm
link's instead (the Einsatz closes, the link dies), and it is the one kind that may write.
What it may write is three routes and two content rules, all in auth/incident_link.

THE ALARM LINK, MINTED IN THE APP (2026-09-02)
----------------------------------------------
Not a fourth kind — the *first* one, produced by somebody other than the alerting system. An
editor on the Schadenplatz hands the Zentrale, the EL or a Nachbarwehr a live read-only view
mid-Einsatz (`create_einsatz_link` → `mint_incident_link_token` below). The
token is signed with the station's own minting key, opens the same read-only session, and dies
under exactly the same two conditions: the Einsatz closes, or the key is rotated.

The one thing that differs is how the token NAMES its Einsatz. `src`/`ref` exist so an alerting
system never has to learn our incident UUIDs; we are not an alerting system, and a manually
created Einsatz or an Übung carries no `source_ref` at all — so an app-minted token names the
incident by its id (`inc`). Same signature, same key, same authority: the key already means «may
open a read session on any incident this station has».

THE STANDING LINKS (2026-09-09)
-------------------------------
`/l/t<secret>` (Stations-Terminal) and `/l/s<secret>` (fixe Atemschutz-URL) are station-level:
the secret lives on `deployment_config`, printed/enrolled ONCE, and the URL names no Einsatz —
«whichever is open» is resolved here, at exchange time. Exactly one open → the session is bound
to it and everything downstream is an ordinary one-incident link session. None open → a
structured «idle» answer, NOT the uniform 404: the holder is station-internal by trust model
(physical presence at the station / the laminated QR at the Eingang), and the idle screen has to
tell «nichts läuft» apart from «revoked». More than one open → a «choose» answer listing the
open Einsätze (enumeration is acceptable for exactly these two kinds, and must never reach the
external view link); the client re-posts with its pick, which is re-verified against the open
set. A poll passes its currently bound incident the same way, so an already-made choice sticks
while that Einsatz runs and re-resolves the moment it closes.

The terminal additionally leaves a DEVICE cookie behind on first exchange (auth/cookies ·
TERMINAL_COOKIE): the PC re-exchanges on `/terminal-session` with that cookie alone, so the
secret appears once — in the admin's enrollment QR — and never again, not even in a bookmark.
Both standing keys revoke the vk way, checked on every request: rotate/delete the column and
every printed QR, every enrolled device and every open session dies at once.
"""

import secrets
import uuid
from dataclasses import dataclass

import jwt
from fastapi import APIRouter, Depends, HTTPException, Request, Response, status
from jwt import InvalidTokenError as JWTError
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from .. import audit
from ..alarms import open_pooled_alarm
from ..auth.cookies import TERMINAL_COOKIE, set_link_cookie, set_terminal_cookie
from ..auth.dependencies import CurrentAdmin, CurrentEditor
from ..auth.incident_link import (
    LINK_TOKEN_TYPE,
    ClosedForLink,
    create_atemschutz_session_token,
    create_link_session_token,
    create_standing_atemschutz_session_token,
    create_terminal_device_token,
    create_terminal_session_token,
    create_view_session_token,
    incident_closed_at,
    key_fingerprint,
    read_terminal_device_fingerprint,
)
from ..auth.secret_token import secret_matches
from ..database import get_db
from ..deployment_config import config_row
from ..incident_service import get_incident_or_404
from ..models import INCIDENT_ACTIVE_STATUSES, LERN_UEBUNG_SOURCE, DeploymentConfig, Incident
from ..schemas import ViewLinkOut

router = APIRouter(prefix="/incident-link", tags=["incident-link"])

# Pinned here rather than read from settings.algorithm: this is the signature algorithm of a
# contract with an OUTSIDE system, so it changes only when both ends do — never as a side
# effect of retuning kp-front's own tokens.
LINK_ALGORITHM = "HS256"


class LinkTokenIn(BaseModel):
    token: str
    # Standing links only (`t…`/`s…`): the pick out of a previous «choose» answer, or the
    # incident a poll is already bound to. Ignored for the per-incident kinds — their token
    # names its Einsatz and a body field must not be able to rebind it.
    incident_id: str | None = None


# --- admin: the minting key -------------------------------------------------------------
# Gated by the deployment admin (ADMIN_SECRET session), NOT the editor role: handing this key
# to an alerting system grants it the power to open read sessions on every incident the
# station will ever have, which is deployment administration.


#: The refusal both link doors share: the station never set a minting key, so nothing can mint a
#: link and nothing can redeem one. Answered with a STRUCTURED detail so a caller can tell this
#: 403 apart from every other one — «In der Verwaltung einrichten» is an instruction, and offering
#: it for a 403 that means something else sends the operator to a screen that cannot help.
#: ⚠️ No screen in kp-front reads `code` any more (03.09.: nothing mints an Einsatz-Link by hand
#: — see src/lib/viewLink). It stays because it is part of the wire answer the alerting
#: integration and the exchange below share; the German sentence is for the readers who are
#: people, `code` for the ones that are not.
NO_MINTING_KEY_CODE = "link_key_missing"
NO_MINTING_KEY_DETAIL = "Einsatz-Links deaktiviert (kein Link-Schlüssel gesetzt)"


def no_minting_key() -> HTTPException:
    """One 403, raised from both directions — the exchange that verifies a token and the in-app
    mint that signs one. Fail CLOSED: no key configured → the whole link surface is off."""
    return HTTPException(
        status_code=status.HTTP_403_FORBIDDEN,
        detail={"code": NO_MINTING_KEY_CODE, "message": NO_MINTING_KEY_DETAIL},
    )


async def station_minting_key(db: AsyncSession) -> str | None:
    """The station's minting key, or None when the feature was never set up.

    One lookup for both directions — the exchange below reads it to VERIFY a token, and the
    in-app mint (`create_einsatz_link` below) reads it to SIGN one. «Kein Schlüssel»
    has to mean the same thing on both sides or the app would offer a link nothing can redeem.
    """
    return (
        await db.execute(select(DeploymentConfig.incident_link_key).where(DeploymentConfig.id == 1))
    ).scalar_one_or_none()


def mint_incident_link_token(incident_id: str, key: str) -> str:
    """An alarm link for one Einsatz we already know the id of — see «THE ALARM LINK, MINTED IN
    THE APP» above. The inverse of `open_link_session`, kept beside it so the two cannot drift.

    Deliberately carries no `exp`. The session it opens is bounded on EVERY request by the two
    conditions that matter (the Einsatz still running, the station's key unchanged), and PyJWT
    serialises the same claims to the same string — so re-opening the sheet shows the QR that is
    already circulating rather than a second, equally valid address.
    """
    return jwt.encode({"type": LINK_TOKEN_TYPE, "inc": str(incident_id)}, key, algorithm=LINK_ALGORITHM)


@router.get("/secret")
async def get_link_key(_admin: CurrentAdmin, db: AsyncSession = Depends(get_db)) -> dict:
    row = await config_row(db)
    return {"configured": bool(row.incident_link_key), "token": row.incident_link_key}


@router.post("/secret/rotate")
async def rotate_link_key(_admin: CurrentAdmin, db: AsyncSession = Depends(get_db)) -> dict:
    """Mint a fresh minting key — every link already sent out stops working at once, so the
    alerting system has to be reconfigured with the new one in the same breath."""
    row = await config_row(db)
    # HS256 requires at least 256 bits of key material (RFC 7518 §3.2). Older releases
    # minted 18 bytes; those keys remain valid for compatibility, while every rotation now
    # meets the full requirement.
    row.incident_link_key = secrets.token_urlsafe(32)
    await db.flush()
    return {"configured": True, "token": row.incident_link_key}


@router.delete("/secret")
async def disable_link(_admin: CurrentAdmin, db: AsyncSession = Depends(get_db)) -> dict:
    row = await config_row(db)
    row.incident_link_key = None
    await db.flush()
    return {"configured": False}


# --- admin: the two standing keys ---------------------------------------------------------
# The same trio twice more, on the deployment's standing columns (models · DeploymentConfig).
# Deployment-admin gated like the minting key: a standing secret opens (terminal) or writes
# into (Atemschutz) every Einsatz the station will ever run, which is deployment
# administration. Rotation is the revocation: the printed QR, every enrolled device and every
# open session die together (auth/incident_link · _deployment_key_unchanged).


@router.get("/terminal/secret")
async def get_terminal_key(_admin: CurrentAdmin, db: AsyncSession = Depends(get_db)) -> dict:
    row = await config_row(db)
    return {"configured": bool(row.terminal_link_key), "token": row.terminal_link_key}


@router.post("/terminal/secret/rotate")
async def rotate_terminal_key(_admin: CurrentAdmin, db: AsyncSession = Depends(get_db)) -> dict:
    row = await config_row(db)
    row.terminal_link_key = secrets.token_urlsafe(32)
    await db.flush()
    return {"configured": True, "token": row.terminal_link_key}


@router.delete("/terminal/secret")
async def disable_terminal(_admin: CurrentAdmin, db: AsyncSession = Depends(get_db)) -> dict:
    row = await config_row(db)
    row.terminal_link_key = None
    await db.flush()
    return {"configured": False}


@router.get("/atemschutz/secret")
async def get_standing_atemschutz_key(_admin: CurrentAdmin, db: AsyncSession = Depends(get_db)) -> dict:
    row = await config_row(db)
    return {"configured": bool(row.atemschutz_standing_key), "token": row.atemschutz_standing_key}


@router.post("/atemschutz/secret/rotate")
async def rotate_standing_atemschutz_key(_admin: CurrentAdmin, db: AsyncSession = Depends(get_db)) -> dict:
    row = await config_row(db)
    row.atemschutz_standing_key = secrets.token_urlsafe(32)
    await db.flush()
    return {"configured": True, "token": row.atemschutz_standing_key}


@router.delete("/atemschutz/secret")
async def disable_standing_atemschutz(_admin: CurrentAdmin, db: AsyncSession = Depends(get_db)) -> dict:
    row = await config_row(db)
    row.atemschutz_standing_key = None
    await db.flush()
    return {"configured": False}


# --- the exchange (link token → session cookie) ------------------------------------------


def _invalid_token() -> HTTPException:
    """One message for every rejected token — bad signature, wrong type, missing claims and
    expiry are all «this link doesn't work», and telling them apart only helps a forger."""
    return HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail="Einsatz-Link ungültig oder abgelaufen",
    )


#: A Rapport view-link URL carries the incident's own secret, not a signed token — so the two
#: kinds of link have to be told apart before anything tries to verify a signature. The marker is
#: the leading character, and it cannot collide: a JWT is three base64url segments and always
#: starts with `eyJ` (the encoded `{"`), so no alerting-system token begins with this.
VIEW_TOKEN_PREFIX = "v"  # noqa: S105 — a URL marker, not a credential

#: …and the Atemschutz link's marker, for the same reason and with the same guarantee: a JWT
#: is three base64url segments and always starts with `eyJ` (the encoded `{"`), so no alerting
#: system token begins with an "a" either. The two app-minted secrets are `secrets.token_urlsafe`
#: output and carry no prefix of their own, so one leading character tells all three kinds apart.
ATEMSCHUTZ_TOKEN_PREFIX = "a"  # noqa: S105 — a URL marker, not a credential

#: The standing kinds' markers (see «THE STANDING LINKS» above) — same guarantee: no JWT
#: begins with either, and the secret behind the prefix carries no marker of its own.
TERMINAL_TOKEN_PREFIX = "t"  # noqa: S105 — a URL marker, not a credential
STANDING_ATEMSCHUTZ_TOKEN_PREFIX = "s"  # noqa: S105 — a URL marker, not a credential


async def _open_view_session(token: str, response: Response, db: AsyncSession) -> dict:
    """Trade a Rapport view link for a session on the ONE incident that link belongs to.

    No signature to check and none needed: the secret IS the credential, 32 bytes from
    `secrets.token_urlsafe`, and it is looked up rather than decoded. Which means there is
    nothing to expire and exactly one way to end it — the station revoking the link, which
    clears the column and takes every open session with it (auth/incident_link ·
    `_view_key_unchanged`).

    Deliberately says nothing about WHY a token failed. An unknown secret, a revoked link and
    a deleted Einsatz answer alike; telling them apart only helps somebody guessing.
    """
    secret = token[len(VIEW_TOKEN_PREFIX) :]
    if not secret:
        raise _invalid_token()
    inc = (await db.execute(select(Incident).where(Incident.view_link_key == secret))).scalar_one_or_none()
    if inc is None:
        raise _invalid_token()
    # NOTE: `is_open` is NOT consulted, and that is the whole point of this link — it is handed
    # out to show a FINISHED Einsatz to somebody outside the station.
    set_link_cookie(response, create_view_session_token(str(inc.id), secret))
    return {"incident_id": str(inc.id)}


async def _open_atemschutz_session(token: str, response: Response, db: AsyncSession) -> dict:
    """Trade an Atemschutz link for a write-narrowed session on the ONE Einsatz it belongs to.

    Looked up, not decoded — the secret IS the credential, exactly like the view link. What
    differs is the lifecycle: this one is minted while the Einsatz runs, so a closed or
    archived Einsatz is refused. An unknown or revoked secret answers the same 401 as every other
    bad token: the two refusals stay apart because they mean different things to the person
    holding the phone, and neither tells them anything about an Einsatz they don't already have
    the link for.

    ⚠️ CLOSED IS SAID AS «CLOSED» here (staging r6, F2, 26.09.2026) — the same 409
    `incident_closed` a running session gets on the Einsatz's own routes (auth/incident_link ·
    ClosedForLink), not the alarm link's blind 404. The Atemschutz page reloaded after the close
    used to read that 404 as «the alarm has only just come in», spin, and settle on «nicht
    abrufbar» — and stayed there after «Wieder öffnen» until someone tapped «Erneut versuchen».
    With the reason it shows the closed card and keeps asking once a minute, so a reopen brings
    the board back by itself. Nothing is disclosed: the secret was minted for this one Einsatz,
    so its holder already knows it exists; the alarm link's (src, ref) token keeps its one 404
    (no probing). No cookie is set — a closed Einsatz still grants no session.
    """
    secret = token[len(ATEMSCHUTZ_TOKEN_PREFIX) :]
    if not secret:
        raise _invalid_token()
    inc = (await db.execute(select(Incident).where(Incident.atemschutz_link_key == secret))).scalar_one_or_none()
    if inc is None:
        raise _invalid_token()
    if not inc.is_open:
        raise ClosedForLink(await incident_closed_at(db, str(inc.id)))
    set_link_cookie(response, create_atemschutz_session_token(str(inc.id), secret))
    return {"incident_id": str(inc.id)}


# --- the standing exchange ----------------------------------------------------------------


async def _open_incident_rows(db: AsyncSession) -> list[Incident]:
    """Every Einsatz a standing link may bind to right now — `Incident.is_open`, as a query.
    Übungen INCLUDED, deliberately: the Atemschutzüberwachung is exactly what gets drilled,
    and a laminated QR that goes dead in the Übung defeats the training purpose. A Lern-Übung
    («Üben», `models · LERN_UEBUNG_SOURCE`) is NOT: one learner's tutorial must never capture
    the station's terminal, nor turn a real Einsatz beside it into «choose»."""
    rows = (
        await db.execute(
            select(Incident)
            .where(
                Incident.is_archived.is_(False),
                Incident.status.in_(INCIDENT_ACTIVE_STATUSES),
                Incident.source != LERN_UEBUNG_SOURCE,
            )
            .order_by(Incident.started_at.desc())
        )
    ).scalars()
    return list(rows)


def _candidate(inc: Incident) -> dict:
    """One row of a «choose» answer — enough to pick by, nothing that isn't on the chooser."""
    return {
        "id": str(inc.id),
        "title": inc.title,
        "address": inc.address,
        "started_at": inc.started_at.isoformat() if inc.started_at else None,
        "is_exercise": inc.is_exercise,
    }


async def _resolve_standing(db: AsyncSession, chosen: str | None) -> tuple[str, Incident | None, list[Incident]]:
    """Which Einsatz a standing credential binds to → ("ok", incident, _) | ("idle", None, _) |
    ("choose", None, candidates).

    A `chosen` id that is still open wins — that is how a made choice STICKS across the poll
    while others open and close around it. A chosen id that is not in the open set any more is
    not an error: the poll's Einsatz just closed, and the honest answer is a fresh resolution.
    """
    rows = await _open_incident_rows(db)
    if chosen:
        for inc in rows:
            if str(inc.id) == chosen:
                return "ok", inc, rows
    if not rows:
        return "idle", None, rows
    if len(rows) == 1:
        return "ok", rows[0], rows
    return "choose", None, rows


async def _standing_key(db: AsyncSession, column: str) -> str | None:
    return (
        await db.execute(select(getattr(DeploymentConfig, column)).where(DeploymentConfig.id == 1))
    ).scalar_one_or_none()


def _standing_secret_ok(secret: str, key: str) -> bool:
    """The vk lookup, inverted: the standing key is one column on a singleton row, so the
    secret is COMPARED rather than looked up — constant-time, like every credential check, and
    as bytes so a non-ASCII secret is the uniform 401, not a 500 (`secret_matches`)."""
    return secret_matches(secret, key)


async def _open_standing_atemschutz_session(
    token: str, chosen: str | None, response: Response, db: AsyncSession
) -> dict:
    """Trade the fixed Atemschutz URL for a write-narrowed session on whichever Einsatz is
    open. An unknown or revoked secret answers the uniform 401; a station with nothing running
    answers «idle», because the laminated QR's holder is inside the station and the board page
    has to say «kein Einsatz» rather than pretend the link died."""
    secret = token[len(STANDING_ATEMSCHUTZ_TOKEN_PREFIX) :]
    key = await _standing_key(db, "atemschutz_standing_key")
    if key is None or not _standing_secret_ok(secret, key):
        raise _invalid_token()
    state, inc, rows = await _resolve_standing(db, chosen)
    if state == "ok" and inc is not None:
        set_link_cookie(response, create_standing_atemschutz_session_token(str(inc.id), key))
        return {"status": "ok", "incident_id": str(inc.id)}
    if state == "idle":
        return {"status": "idle"}
    return {"status": "choose", "candidates": [_candidate(i) for i in rows]}


async def _terminal_answer(key: str, chosen: str | None, response: Response, db: AsyncSession) -> dict:
    """The terminal's half of the standing resolution — shared by the enrollment exchange
    (token in the URL, once) and the device-cookie poll (every ~10 s thereafter)."""
    state, inc, rows = await _resolve_standing(db, chosen)
    if state == "ok" and inc is not None:
        set_link_cookie(response, create_terminal_session_token(str(inc.id), key))
        return {"status": "ok", "incident_id": str(inc.id)}
    if state == "idle":
        return {"status": "idle"}
    return {"status": "choose", "candidates": [_candidate(i) for i in rows]}


async def _open_terminal_session(token: str, chosen: str | None, response: Response, db: AsyncSession) -> dict:
    """The ENROLLMENT: the one time the terminal secret travels. Verifies it, leaves the
    long-lived device cookie behind (auth/cookies · TERMINAL_COOKIE), and answers like the
    poll — the page then drops the secret from its address bar and lives on the cookie."""
    secret = token[len(TERMINAL_TOKEN_PREFIX) :]
    key = await _standing_key(db, "terminal_link_key")
    if key is None or not _standing_secret_ok(secret, key):
        raise _invalid_token()
    set_terminal_cookie(response, create_terminal_device_token(key))
    return await _terminal_answer(key, chosen, response, db)


class TerminalSessionIn(BaseModel):
    """The poll's body — no token (the device cookie is the credential), only the incident the
    terminal is currently bound to, if any, so a made choice sticks (see `_resolve_standing`)."""

    incident_id: str | None = None


@router.post("/terminal-session")
async def open_terminal_session(
    body: TerminalSessionIn,
    request: Request,
    response: Response,
    db: AsyncSession = Depends(get_db),
) -> dict:
    """The enrolled terminal's poll: no token, just the device cookie. Runs idle on the PC
    every few seconds, so its answers are the terminal's whole world — «ok» (mount the
    Einsatz), «idle» (kein Einsatz), «choose» (more than one running).

    One 401 for a missing, expired, mistyped or ROTATED-AWAY cookie: they all mean the same
    thing to the person at the PC («Terminal neu einrichten»), and telling them apart helps
    only a probe. Fail-closed on a deleted key like every other link door: 403, feature off.
    """
    fingerprint = read_terminal_device_fingerprint(request.cookies.get(TERMINAL_COOKIE))
    if fingerprint is None:
        raise _invalid_token()
    key = await _standing_key(db, "terminal_link_key")
    if not key:
        raise no_minting_key()
    if not secrets.compare_digest(fingerprint, key_fingerprint(key)):
        raise _invalid_token()
    return await _terminal_answer(key, body.incident_id, response, db)


@router.post("/session")
async def open_link_session(body: LinkTokenIn, response: Response, db: AsyncSession = Depends(get_db)) -> dict:
    """Trade a link token minted by the alerting system for a link-session cookie.

    The token names its incident the way the alerting system knows it — `src`/`ref`, which
    mirror `Incident.source` / `Incident.source_ref`, the same pair the intake deduplicates
    on. That is what keeps this provider-neutral: nothing here knows what Divera is, and an
    alerting system never has to learn our incident UUIDs to link to one.
    """
    # One door, five kinds of link — the SPA forwards whatever stood in `/l/<…>` and does not
    # need to know which it is holding. Only the standing kinds read `incident_id`.
    if body.token.startswith(VIEW_TOKEN_PREFIX):
        return await _open_view_session(body.token, response, db)
    if body.token.startswith(ATEMSCHUTZ_TOKEN_PREFIX):
        return await _open_atemschutz_session(body.token, response, db)
    if body.token.startswith(TERMINAL_TOKEN_PREFIX):
        return await _open_terminal_session(body.token, body.incident_id, response, db)
    if body.token.startswith(STANDING_ATEMSCHUTZ_TOKEN_PREFIX):
        return await _open_standing_atemschutz_session(body.token, body.incident_id, response, db)

    # Through the same helper the in-app mint uses, so «kein Schlüssel» cannot come to mean two
    # different things: the app must never offer a link this exchange would then refuse.
    key = await station_minting_key(db)
    if not key:
        raise no_minting_key()

    try:
        # Signature AND `exp` are checked here; an expired token raises a JWTError subclass.
        claims = jwt.decode(body.token, key, algorithms=[LINK_ALGORITHM])
    except JWTError:
        raise _invalid_token() from None

    if claims.get("type") != LINK_TOKEN_TYPE:
        # A credential minted for anything else must not become a link session, even when it
        # carries a valid signature from this key. Plain `!=`, like read_link_session does:
        # this is a discriminator compared after the signature already held, not a secret.
        raise _invalid_token()

    # An app-minted token names the Einsatz by our own id; the alerting system's names it by the
    # (src, ref) pair it knows. Both are signed with the same key and carry the same authority —
    # only the lookup differs. `inc` first, because a token carrying it has nothing else to try.
    ours = claims.get("inc")
    if ours is not None:
        if not isinstance(ours, str):
            raise _invalid_token()
        try:
            ident = uuid.UUID(ours)
        except (ValueError, AttributeError, TypeError):
            raise _invalid_token() from None
        inc = (await db.execute(select(Incident).where(Incident.id == ident))).scalar_one_or_none()
    else:
        src, ref = claims.get("src"), claims.get("ref")
        if not isinstance(src, str) or not isinstance(ref, str | int) or not src or str(ref) == "":
            raise _invalid_token()

        inc = (
            await db.execute(select(Incident).where(Incident.source == src, Incident.source_ref == str(ref)))
        ).scalar_one_or_none()
        if inc is None:
            # No incident under that (src, ref) — but the alarm may still be waiting in an intake
            # pool, in which case the responder holding this link is the reason to open it. This
            # is the whole point of the exchange: the link must not depend on someone else having
            # picked the alarm up on a tablet first (production, 2026-08-02). The lookup is
            # source-agnostic and lives in `alarms`, so nothing here learns what Divera is.
            inc = await open_pooled_alarm(db, source=src, ref=str(ref))
    if inc is None or not inc.is_open:
        # Unknown, archived, or already closed — one answer for all three (no probing). An
        # alarm that no pool knows either falls in here, indistinguishable from the rest.
        raise HTTPException(status_code=404, detail="Einsatz nicht (mehr) verfügbar")

    # The session records which minting key it was born from, so rotating that key ends
    # sessions that are already open — not just links that have not been tapped yet.
    set_link_cookie(response, create_link_session_token(str(inc.id), key))
    # The id the SPA needs to open the incident; the session itself lives in the cookie.
    return {"incident_id": str(inc.id)}


# --- the per-incident links, minted in the app ----------------------------------------------
#
# The editor's side of three of the kinds above (sweep A.20, 23.10.2026: moved here from
# api/incidents, next to the secrets they mint). Their URLs stay `/api/incidents/{id}/…`, so they
# hang off their own router, registered in main.py beside the incidents router.
#
# THE VIEW LINK («so people outside our station can see everything we did, in one go») and THE
# ATEMSCHUTZ LINK («der am Eingang soll die Atemschutzüberwachung auf seinem eigenen Handy
# führen») are one shape, `_StoredLink`: the secret IS the link, stored per incident; minting is
# idempotent — asking twice hands back the same URL rather than quietly invalidating the one
# already sent, because «I can't find the link» must not be the same gesture as «I want the old
# one dead»; revoking clears the column and every session already open on it ends (checked per
# request in auth/incident_link). Minting and revoking each write a row into the hash chain — the
# moment the Einsatz became readable (or writable) outside the FU — and the secret never goes in:
# an audit trail is read by more people than the link is meant for.
#
# They differ in lifetime. The view link does not die when the Einsatz closes (that is its normal
# case) and can be minted on a closed one; the Atemschutz link has the alarm link's lifetime — it
# cannot be minted on a finished Einsatz (409, the caller is an editor who knows the Einsatz
# exists, so not the exchange's blind 404) and dies when it is closed or archived. Its GET still
# answers on a closed Einsatz: the QR panel has to show that a link is still standing, which is
# what makes revoking it a deliberate act rather than something forgotten.

incidents_router = APIRouter(prefix="/incidents", tags=["incidents"])


@dataclass(frozen=True)
class _StoredLink:
    """One per-incident link kind whose secret lives in an `Incident` column."""

    #: the `Incident` column holding the secret
    column: str
    #: the token's kind marker (`VIEW_TOKEN_PREFIX` / `ATEMSCHUTZ_TOKEN_PREFIX`)
    prefix: str
    #: `IncidentEvent.source` and the payload key of its chain rows
    source: str
    payload_key: str
    #: the 409 detail when minting on a closed Einsatz; None = mintable whatever the state
    closed_detail: str | None = None

    def out(self, inc: Incident) -> ViewLinkOut:
        secret = getattr(inc, self.column)
        return ViewLinkOut(enabled=bool(secret), token=f"{self.prefix}{secret}" if secret else None)

    async def _record(self, db: AsyncSession, inc: Incident, user_id: uuid.UUID, enabled: bool) -> None:
        await audit.append_event(
            db,
            incident_id=inc.id,
            op_type="meta.change",
            source=self.source,
            user_id=user_id,
            payload={self.payload_key: enabled},
        )

    async def read(self, db: AsyncSession, incident_id: uuid.UUID) -> ViewLinkOut:
        return self.out(await get_incident_or_404(db, incident_id))

    async def mint(self, db: AsyncSession, incident_id: uuid.UUID, user_id: uuid.UUID) -> ViewLinkOut:
        """Mint it, or hand back the one that already exists. The row is locked: two editors
        reading no secret in the same window would otherwise both write one, and the QR the first
        already showed would encode a secret the second overwrote."""
        inc = await get_incident_or_404(db, incident_id, lock=True)
        if self.closed_detail and not inc.is_open:
            raise HTTPException(status_code=409, detail=self.closed_detail)
        if not getattr(inc, self.column):
            setattr(inc, self.column, secrets.token_urlsafe(32))
            await db.flush()
            await self._record(db, inc, user_id, True)
        return self.out(inc)

    async def revoke(self, db: AsyncSession, incident_id: uuid.UUID, user_id: uuid.UUID) -> ViewLinkOut:
        inc = await get_incident_or_404(db, incident_id)
        if getattr(inc, self.column):
            setattr(inc, self.column, None)
            await db.flush()
            await self._record(db, inc, user_id, False)
        return ViewLinkOut(enabled=False, token=None)


VIEW_LINK = _StoredLink(column="view_link_key", prefix=VIEW_TOKEN_PREFIX, source="view-link", payload_key="view_link")
ATEMSCHUTZ_LINK = _StoredLink(
    column="atemschutz_link_key",
    prefix=ATEMSCHUTZ_TOKEN_PREFIX,
    source="atemschutz-link",
    payload_key="atemschutz_link",
    closed_detail="Einsatz ist abgeschlossen — für die Atemschutzüberwachung kann kein Link mehr erstellt werden",
)


@incidents_router.get("/{incident_id}/view-link", response_model=ViewLinkOut)
async def get_view_link(
    incident_id: uuid.UUID, _user: CurrentEditor, db: AsyncSession = Depends(get_db)
) -> ViewLinkOut:
    """What the Rapport shows: the live link, or that there is none."""
    return await VIEW_LINK.read(db, incident_id)


@incidents_router.post("/{incident_id}/view-link", response_model=ViewLinkOut)
async def create_view_link(
    incident_id: uuid.UUID, user: CurrentEditor, db: AsyncSession = Depends(get_db)
) -> ViewLinkOut:
    """Mint the link, or hand back the one that already exists."""
    return await VIEW_LINK.mint(db, incident_id, user.id)


@incidents_router.delete("/{incident_id}/view-link", response_model=ViewLinkOut)
async def revoke_view_link(
    incident_id: uuid.UUID, user: CurrentEditor, db: AsyncSession = Depends(get_db)
) -> ViewLinkOut:
    """Revoke it. The URL stops working AND every session already open on it ends — checked per
    request in auth/incident_link, because a link that cannot expire has to be killable."""
    return await VIEW_LINK.revoke(db, incident_id, user.id)


@incidents_router.get("/{incident_id}/atemschutz-link", response_model=ViewLinkOut)
async def get_atemschutz_link(
    incident_id: uuid.UUID, _user: CurrentEditor, db: AsyncSession = Depends(get_db)
) -> ViewLinkOut:
    """The live link, or that there is none. Readable on a closed Einsatz too — the QR panel
    has to be able to show that a link is still standing, which is what makes revoking it a
    deliberate act rather than something forgotten."""
    return await ATEMSCHUTZ_LINK.read(db, incident_id)


@incidents_router.post("/{incident_id}/atemschutz-link", response_model=ViewLinkOut)
async def create_atemschutz_link(
    incident_id: uuid.UUID, user: CurrentEditor, db: AsyncSession = Depends(get_db)
) -> ViewLinkOut:
    """Mint it, or hand back the one that already exists.

    409 on a closed or archived Einsatz, the same shape as refusing to delete a running one:
    the caller is an authenticated editor who knows the Einsatz exists, so the honest answer is
    «not in this state», not the exchange's deliberately blind 404. A minted link would be dead
    on arrival anyway — `enforce_link_scope` requires the Einsatz to be open on every request.
    """
    return await ATEMSCHUTZ_LINK.mint(db, incident_id, user.id)


@incidents_router.delete("/{incident_id}/atemschutz-link", response_model=ViewLinkOut)
async def revoke_atemschutz_link(
    incident_id: uuid.UUID, user: CurrentEditor, db: AsyncSession = Depends(get_db)
) -> ViewLinkOut:
    """Take it back mid-Einsatz. The URL stops working AND the phone that already has it open
    is refused on its next request (auth/incident_link · `_atemschutz_key_unchanged`)."""
    return await ATEMSCHUTZ_LINK.revoke(db, incident_id, user.id)


# --- the Einsatz-Link, minted from inside the app -----------------------------------------
#
# «Die Zentrale soll live mitschauen.» Exactly the link a responder taps out of an alarm — the
# station's minting key signs it, the read-only allowlist bounds it, and it dies when the Einsatz
# is closed or the key is rotated (auth/incident_link). What is new is only who can produce one:
# until now that was the alerting system alone, so handing the EL or a Nachbarwehr a live view
# mid-Einsatz was something nobody at the Schadenplatz could do.
#
# NOTHING IS STORED, and that is the difference from the two stored links above. The token is
# derived from the incident id and the station key, so there is no per-incident secret, no GET to
# read one back and no DELETE to revoke one: taking it back is rotating the key in der Verwaltung
# — which takes every alarm link with it, deliberately — or closing the Einsatz. Deriving it also
# makes minting naturally idempotent: asking twice hands back the address already circulating.

#: `IncidentEvent.source` for the row below. String(16) in the model — keep it short.
EINSATZ_LINK_SOURCE = "einsatz-link"


@incidents_router.post("/{incident_id}/einsatz-link", response_model=ViewLinkOut)
async def create_einsatz_link(
    incident_id: uuid.UUID, user: CurrentEditor, db: AsyncSession = Depends(get_db)
) -> ViewLinkOut:
    """Hand back the read-only Einsatz-Link for this Einsatz, minting it on the spot.

    Two refusals, and they are deliberately different statuses because the operator can act on
    only one of them:
      · 403 — no minting key: the whole link surface is off, exactly as the exchange answers it
        (api/incident_link · `open_link_session`). Nothing to be done on the Schadenplatz, so the
        sheet points at der Verwaltung instead of offering a retry.
      · 409 — the Einsatz is finished: an alarm link dies the moment it closes, so minting one
        would hand over an address that never worked. Not the exchange's blind 404, because the
        caller is a signed-in editor who already knows this Einsatz exists.
    """
    inc = await get_incident_or_404(db, incident_id, lock=True)
    key = await station_minting_key(db)
    if not key:
        raise no_minting_key()
    if not inc.is_open:
        raise HTTPException(
            status_code=409,
            detail="Einsatz ist abgeschlossen – dafür kann kein Einsatz-Link mehr erstellt werden",
        )

    # One row per Einsatz, not per look: the moment worth recording is «the running Lage became
    # readable outside the FU», and re-opening the sheet to show the same QR again is not a
    # second such moment. There is no stored secret to tell the two apart, so the chain itself is
    # asked. The secret never goes in — an audit trail is read by more people than the link is.
    #
    # ⚠️ The SELECT is only the fast path. What ENFORCES «one row» is the partial unique index on
    # (incident_id) where source = 'einsatz-link' (models · IncidentEvent), because check-then-
    # append is a race and the incident-row lock above does not settle it everywhere: SQLite has
    # no row locks, so on a dev machine a StrictMode double mount wrote the row twice into the
    # hash chain. The savepoint is what lets the loser lose harmlessly — the duplicate INSERT is
    # rolled back to it, the winner's row and the chain stand, and both callers get the same
    # token, which is the answer they came for either way.
    from ..models import IncidentEvent

    seen = (
        await db.execute(
            select(IncidentEvent.id)
            .where(IncidentEvent.incident_id == inc.id, IncidentEvent.source == EINSATZ_LINK_SOURCE)
            .limit(1)
        )
    ).scalar_one_or_none()
    if seen is None:
        try:
            async with db.begin_nested():
                await audit.append_event(
                    db,
                    incident_id=inc.id,
                    op_type="meta.change",
                    source=EINSATZ_LINK_SOURCE,
                    user_id=user.id,
                    payload={"einsatz_link": True},
                )
        except IntegrityError:
            pass
    return ViewLinkOut(enabled=True, token=mint_incident_link_token(str(inc.id), key))
