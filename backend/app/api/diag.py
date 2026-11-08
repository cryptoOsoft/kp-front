"""Diagnostics: the station's own error sink, and the bundle an operator can hand over.

The sink came first and is still the primary thing this module does — a solo operator can't
see a frontend crash that the ErrorBoundary swallows, so the browser posts uncaught errors
here and they surface in the SERVER log, on the station's own machine, where the deployer
already looks. That path needs no consent and no network: it is the app telling its own
operator what happened.

* ``POST /client-error`` — the sink. Always logged and always buffered locally
  (``telemetry/recent.py``); additionally queued for an upstream ingest only when an admin
  has switched telemetry on AND the deployer configured a DSN. Unauthenticated (a crash can
  happen on the login screen), so it is throttled per source (a token bucket, 429 past it)
  and the upstream queue is capped per hour, on top of the client's own budget. Reachable
  from every kind of Einsatz-Link session too (auth/incident_link, 24.09.2026): the 403 a
  link page got here on 23.09. is why that phone's crash never reached the log.
* ``POST /boot`` — one line per app launch with the phone's own boot timings (lib/bootTiming),
  added 08.11.2026 for the «black screen for 5 s on the iPhone» launch: only the device can say
  where its launch goes. Same contract as the sink: unauthenticated (the login screen is a
  launch too), throttled per source, bounded fields, log only — nothing is stored or forwarded.
* ``GET /export`` — the bundle an operator downloads and attaches to a mail or a GitHub
  issue. Any logged-in user, no consent involved: it hands them their own instance's
  sanitised error traces so a Rückmeldung can say more than "es ist abgestürzt". Nothing is
  transmitted by this route — the operator is, quite literally, the transport.

There used to be a third, ``POST /report``: the Rückmeldung sheet posted the operator's text
here and the forwarder carried it upstream. It went when the maintainer's ingest did. A
queued report with no destination is worse than no route at all, because the sheet says
«gesendet» and nothing ever arrives — so the sheet now opens a mail or an issue form
directly, and the only thing this module owes it is the export above.

The contract for all of it: never 500, never trust the payload. A diagnostics sink that
becomes a source of errors is worse than no sink.
"""

import logging
from datetime import UTC, datetime, timedelta

from fastapi import APIRouter, Depends, HTTPException, Request, status
from pydantic import BaseModel, Field
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from ..auth.capture_limiter import CaptureLimiter
from ..auth.client_ip import client_ip
from ..auth.dependencies import CurrentAdmin, CurrentUser
from ..config import settings
from ..database import get_db
from ..models import TelemetryOutbox
from ..telemetry import consent as consent_mod
from ..telemetry import outbox, recent, scrub
from ..telemetry.envelope import build_event

logger = logging.getLogger("kpfront.clienterror")

router = APIRouter(prefix="/diag", tags=["diag"])

# Ceiling on background payloads queued per hour, per instance. The client already budgets
# itself (lib/reportError), but that budget lives in code an attacker controls — this one is
# ours. A wedged app producing 60 distinct errors an hour is a story we can already tell
# from the first 60; everything after that is noise we'd pay to store.
MAX_QUEUED_PER_HOUR = 60

# ⚠️ The sink ITSELF is throttled per source too (24.09.2026). The hourly cap above only ever
# guarded the upstream queue: the log line and the in-memory buffer were free for anyone to
# fill, and since this route is open to a link session — i.e. to a URL that leaves the
# station — «the client caps itself» is not a control. Sized far above what a real client
# sends: lib/reportError spends at most CLIENT_ERROR_BURST requests at once and one per 30 s
# after that, so a whole Wache behind one NAT still fits.
CLIENT_ERROR_BURST = 60
CLIENT_ERROR_PER_MINUTE = 20
client_error_limiter = CaptureLimiter(lambda: (float(CLIENT_ERROR_BURST), CLIENT_ERROR_PER_MINUTE / 60.0))

# One log RECORD per report, on ONE line: Railway (like most log shippers) splits on newlines,
# and on 23.09. the stack and the component stack of every report landed as separate,
# unattributed lines — the `client-error` line itself carried the message and nothing else.
# Newlines become LOG_NEWLINE, and each field is bounded so one report cannot become a wall.
LOG_NEWLINE = " ⏎ "
LOG_MAX_MESSAGE = 1000
LOG_MAX_STACK = 3000
LOG_MAX_COMPONENT_STACK = 2000

APP_NAME = "kp-front"

#: Kinds newer than the vendored scrubber's enum (see report_client_error).
_RENDER_SUBKINDS = frozenset({"surface-recrash", "render-storm"})


def _one_line(text: str | None, limit: int) -> str:
    """``text`` as a single bounded log line: CR/LF become ``LOG_NEWLINE``, other control
    characters a space, and anything past ``limit`` is cut with a marker saying so. A client
    cannot forge a second log record this way either — which it could before."""
    if not text:
        return ""
    flat = text.replace("\r\n", "\n").replace("\r", "\n").strip("\n").replace("\n", LOG_NEWLINE)
    # DEL and the two Unicode line separators end a record in some viewers too (23.09.2026)
    flat = "".join(" " if (ch < " " and ch != "\t") or ch in "\x7f\u2028\u2029" else ch for ch in flat)
    if len(flat) > limit:
        flat = f"{flat[:limit]}…[+{len(flat) - limit}]"
    return flat


class ClientError(BaseModel):
    """A bounded report of a frontend error. All fields optional/length-capped."""

    message: str = Field(default="", max_length=2000)
    stack: str | None = Field(default=None, max_length=8000)
    component_stack: str | None = Field(default=None, max_length=8000, alias="componentStack")
    # 'render' (ErrorBoundary) | 'error' (window.onerror) | 'unhandledrejection'
    # | 'surface-recrash' (a SurfaceBoundary's «stürzt wiederholt ab») | 'render-storm'
    kind: str = Field(default="error", max_length=40)
    path: str | None = Field(default=None, max_length=400)
    build: str | None = Field(default=None, max_length=120)
    # which SurfaceBoundary caught it (`map`, `board`, …) — absent for everything else
    surface: str | None = Field(default=None, max_length=60)
    # A REPEAT report (lib/reportError): the same signature happened `repeat` more times between
    # `since` and `last` (ISO). The first occurrence went out in full; this one carries no stack.
    repeat: int | None = Field(default=None, ge=1, le=10_000_000)
    since: str | None = Field(default=None, max_length=40)
    last: str | None = Field(default=None, max_length=40)


class BootTiming(BaseModel):
    """One launch: milliseconds since navigation start per boot milestone (lib/bootTiming)."""

    marks: dict[str, int] = Field(default_factory=dict, max_length=24)
    # PerformanceNavigationTiming.type: navigate | reload | back_forward | prerender
    nav: str = Field(default="?", max_length=16)
    build: str | None = Field(default=None, max_length=120)
    standalone: bool = False


boot_limiter = CaptureLimiter(lambda: (float(CLIENT_ERROR_BURST), CLIENT_ERROR_PER_MINUTE / 60.0))
logger_boot = logging.getLogger("kpfront.boot")


@router.post("/boot", status_code=204)
async def report_boot(payload: BootTiming, request: Request) -> None:
    """Log one launch's timings at INFO as ``boot-timing build=… nav=… app=1 ws=… fcp=… ua=…``."""
    wait = boot_limiter.check(client_ip(request))
    if wait:
        raise HTTPException(status_code=429, detail="Zu viele Startberichte", headers={"Retry-After": str(wait)})
    # names are the client's, so they go through the same flattening as every other field; values
    # are signed: the worker's own marks are negative when it was already running before the page
    marks = " ".join(f"{_one_line(name, 16)}={max(-600_000, min(ms, 600_000))}" for name, ms in payload.marks.items())
    try:  # noqa: SIM105 — same as the sink: a diagnostics route must never raise
        logger_boot.info(
            "boot-timing build=%s srv=%s nav=%s app=%d %s ua=%s",
            _one_line(payload.build, 120) or "?",
            settings.version,
            _one_line(payload.nav, 16),
            payload.standalone,
            marks,
            _one_line(request.headers.get("user-agent", "?"), 300),
        )
    except Exception:  # noqa: BLE001, S110
        pass


async def _queued_last_hour(db: AsyncSession) -> int:
    since = datetime.now(UTC) - timedelta(hours=1)
    return int(
        (
            await db.execute(
                select(func.count()).select_from(TelemetryOutbox).where(TelemetryOutbox.created_at >= since)
            )
        ).scalar()
        or 0
    )


def _hhmm(iso: str | None) -> str:
    """``2026-09-23T20:28:14.123Z`` → ``20:28:14Z`` for the log; anything else, as sent (bounded)."""
    if not iso:
        return "?"
    try:
        return datetime.fromisoformat(iso.replace("Z", "+00:00")).astimezone(UTC).strftime("%H:%M:%SZ")
    except ValueError:
        return _one_line(iso, 40)


def _log_line(payload: ClientError, ua: str) -> str:
    """The one line a report becomes in the server log. Built by hand rather than with logging's
    %-args so the bounding and flattening cover every field, the client's and ours alike."""
    head = [
        "client-error",
        f"kind={_one_line(payload.kind, 40)}",
        f"build={_one_line(payload.build, 120) or '?'}",
        # the SERVER's version beside the client's: a tablet on a stale precache is a finding
        f"srv={settings.version}",
    ]
    if payload.surface:
        head.append(f"surface={_one_line(payload.surface, 60)}")
    if payload.repeat:
        head.append(f"repeat=×{payload.repeat} since={_hhmm(payload.since)} last={_hhmm(payload.last)}")
    head += [f"path={_one_line(payload.path, 400) or '?'}", f"ua={_one_line(ua, 300)}"]
    line = " ".join(head) + " :: " + _one_line(payload.message, LOG_MAX_MESSAGE)
    if payload.stack:
        line += " :: stack: " + _one_line(payload.stack, LOG_MAX_STACK)
    if payload.component_stack:
        line += " :: componentStack: " + _one_line(payload.component_stack, LOG_MAX_COMPONENT_STACK)
    return line


@router.post("/client-error", status_code=204)
async def report_client_error(
    payload: ClientError,
    request: Request,
    db: AsyncSession = Depends(get_db),
) -> None:
    """Log a client-reported error at WARNING (visible without DEBUG). Never raises a 500.

    Past the per-source throttle it answers 429 and records nothing — the client keeps
    counting and its next report carries the tally (lib/reportError)."""
    wait = client_error_limiter.check(client_ip(request))
    if wait:
        raise HTTPException(status_code=429, detail="Zu viele Fehlerberichte", headers={"Retry-After": str(wait)})
    ua = request.headers.get("user-agent", "?")[:300]
    try:  # noqa: SIM105 — contextlib.suppress would hide which call is the fragile one
        logger.warning("%s", _log_line(payload, ua))
    except Exception:  # noqa: BLE001, S110 — a diagnostics sink must never raise
        pass

    # Sanitised once, read twice. The local buffer below and the upstream envelope further
    # down share this object, so there is no path by which one of them carries a field the
    # other scrubbed away. A repeat report says so in its message: the export is read by a
    # person, and «×37 seit 20:28» is the whole content of that report.
    message = payload.message
    if payload.repeat:
        message = f"{message} (×{payload.repeat} seit {_hhmm(payload.since)})"
    # ⚠️ The two newer kinds are not in the vendored scrubber's enum (telemetry/scrub.py is kept
    # byte-identical with kp-rueck, shared/MANIFEST.json), which would flatten them to
    # «error». Both are render trouble, so they travel as `render` with the real kind at the head
    # of the message. The log line above carries the real kind as its own field.
    kind = payload.kind
    if kind in _RENDER_SUBKINDS:
        message = f"[{kind}] {message}"
        kind = "render"
    error = scrub.build_error(
        kind=kind,
        message=message,
        stack=payload.stack,
        component_stack=payload.component_stack,
        path=payload.path,
    )

    # The local buffer, filled BEFORE and REGARDLESS of consent — it is what an operator's
    # diagnostics export attaches to a mail, and it never leaves this machine on its own.
    # Consent gates transmission; this is not transmission. See telemetry/recent.py.
    recent.record(error=error, release=payload.build or settings.version, device=scrub.device_class(ua))

    # Second hop: only with consent, and only if we haven't already queued enough this hour.
    try:
        if await consent_mod.get_consent(db) != consent_mod.CONSENT_ERRORS:
            return
        if await _queued_last_hour(db) >= MAX_QUEUED_PER_HOUR:
            logger.debug("telemetry: hourly queue cap reached, dropping")
            return
        install_id = await consent_mod.get_install_id(db, mint=True)
        event = build_event(
            channel="error",
            context=scrub.build_context(
                install_id=install_id or "unknown",
                app=APP_NAME,
                release=payload.build or settings.version,
                user_agent=ua,
            ),
            error=error,
        )
        await outbox.enqueue(db, channel="error", payload=event)
        await db.commit()
    except Exception:  # noqa: BLE001 — telemetry must never break the sink it hangs off
        await db.rollback()
        logger.debug("telemetry: could not queue client error", exc_info=True)


@router.get("/export")
async def export_diagnostics(
    request: Request,
    _user: CurrentUser,
    db: AsyncSession = Depends(get_db),
) -> dict:
    """The diagnostics bundle an operator attaches to a Rückmeldung.

    This is the answer to "pls fix". A mailed report carries a sentence and a build number;
    what makes a bug findable is the stack trace, and until this endpoint existed there was
    no way for the person who hit it to get one out of the app — the traces were in the
    server log, which needs a shell and is not something you attach to an e-mail.

    Logged-in user, not admin, deliberately: the person who hit the bug is whoever was
    holding the tablet, and a report they cannot complete is a report that does not arrive.
    Nothing here is new exposure — every field is the same sanitised text the app already
    shows that user verbatim in the Rückmeldung sheet before they send anything.

    Returns JSON rather than a file download so the caller keeps its session headers; the
    frontend turns it into the ``.json`` the operator attaches.
    """
    return {
        "generatedAt": datetime.now(UTC).isoformat(timespec="seconds").replace("+00:00", "Z"),
        "app": APP_NAME,
        "release": settings.version,
        # Same random per-instance id the reports carry, so a mailed bundle and a report that
        # arrived some other way can be recognised as the same station without naming it.
        "install": await consent_mod.get_install_id(db),
        "device": scrub.device_class(request.headers.get("user-agent")),
        "errors": recent.snapshot(),
        # Stated so the absence of a trace is readable as "the process restarted" rather than
        # "the app has no errors" — the two look identical in an empty list.
        "errorsKept": recent.MAX_RECENT,
        "note": (
            "Bereinigte Fehlerprotokolle dieser Installation, seit dem letzten Neustart des "
            "Servers. Keine Einsatzdaten, keine Adressen, keine Namen, keine Zugangsdaten – "
            "siehe PRIVACY.md."
        ),
    }


# --- Admin surface --------------------------------------------------------------------


class ConsentUpdate(BaseModel):
    consent: str = Field(max_length=16)


@router.get("/telemetry")
async def telemetry_status(_admin: CurrentAdmin, db: AsyncSession = Depends(get_db)) -> dict:
    """Everything the admin screen needs to answer "what is this instance sending".

    Includes the last few payloads verbatim. The queue is the honest answer to that
    question and there is no reason to summarise it — a fire station should be able to read
    the actual JSON without opening psql.
    """
    rows = list(
        (await db.execute(select(TelemetryOutbox).order_by(TelemetryOutbox.created_at.desc()).limit(10)))
        .scalars()
        .all()
    )
    pending = sum(1 for r in rows if r.sent_at is None)
    return {
        "consent": await consent_mod.get_consent(db),
        # NULL consent is off, but it is not an ANSWER — the UI asks once rather than
        # letting "nobody looked at it yet" read as a decision.
        "decided": await consent_mod.is_decided(db),
        "installId": await consent_mod.get_install_id(db),
        # False when the DEPLOYER disabled it in env — the UI must then explain that the
        # switch it is showing cannot do anything, rather than pretend it can.
        "outboundAllowed": consent_mod.env_allows_outbound(),
        "ingestConfigured": bool(settings.telemetry_dsn),
        "pending": pending,
        "recent": [
            {
                "id": str(r.id),
                "channel": r.channel,
                "createdAt": r.created_at.isoformat() if r.created_at else None,
                "sentAt": r.sent_at.isoformat() if r.sent_at else None,
                "attempts": r.attempts,
                "lastError": r.last_error,
                "payload": r.payload_json,
            }
            for r in rows
        ],
    }


@router.put("/telemetry/consent")
async def update_consent(body: ConsentUpdate, _admin: CurrentAdmin, db: AsyncSession = Depends(get_db)) -> dict:
    """Turn the background channel on or off. Off also discards whatever is still queued."""
    try:
        value = await consent_mod.set_consent(db, body.consent)
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from None
    discarded = 0
    if value == consent_mod.CONSENT_OFF:
        discarded = await outbox.drop_unsent(db, channel="error")
    await db.commit()
    return {"consent": value, "discarded": discarded}


@router.post("/telemetry/install-id")
async def rotate_install_id(_admin: CurrentAdmin, db: AsyncSession = Depends(get_db)) -> dict:
    """Mint a fresh install id, cutting the link to everything sent so far."""
    new_id = await consent_mod.regenerate_install_id(db)
    await db.commit()
    return {"installId": new_id}
