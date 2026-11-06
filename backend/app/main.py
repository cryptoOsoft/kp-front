"""FastAPI application entrypoint.

Single service: serves the API under /api and (in production) the built SPA from the
same origin — so cookies are SameSite=Lax and there is no CORS.
"""

import ipaddress
import logging
import re
from contextlib import asynccontextmanager, suppress

logging.basicConfig(level=logging.INFO)
# httpx logs every request at INFO with the FULL URL incl. query string — that leaks the
# Divera accesskey (passed as ?accesskey=...) into the logs. Silence its per-request line;
# our own code logs what matters without the secret.
logging.getLogger("httpx").setLevel(logging.WARNING)


#: Query parameters whose VALUE is a credential, as they appear in a URL anywhere in a log
#: line. `accesskey` is Divera's own spelling; `secret` is how both webhook intakes and the
#: capture/stats links accept theirs (`?secret=…`), which uvicorn's access log writes out in
#: full on every legitimate call.
_SECRET_QUERY_PARAM = re.compile(
    r"(?i)([?&](?:accesskey|access_key|api_key|apikey|key|secret|token|t|password|passwd|pwd))=[^&\s'\"]*"
)
_SECRET_LINK_PATH = re.compile(r"(/(?:e|l)/)[^/?#\s'\"]+")


def _redact(value: object) -> object:
    """Mask query credentials and QR bootstrap paths, including initial SPA access logs."""
    if not isinstance(value, str):
        return value
    return _SECRET_LINK_PATH.sub(r"\1<redacted>", _SECRET_QUERY_PARAM.sub(r"\1=<redacted>", value))


class RedactSecretsInUrls(logging.Filter):
    """The last line of defence against a credential in a log line.

    ⚠️ THE SAME MITIGATION AS THE `httpx` LINE ABOVE, one step further along. Silencing httpx
    covered the request log httpx emits itself. It does not cover a URL that reaches a log any
    OTHER way, and two do:

      * an exception message rendered into a traceback — `httpx.HTTPStatusError` stringifies
        as «… for url '…?accesskey=<the key>'», which is how `scheduler._poll_divera`'s
        `logger.exception` wrote the station's Divera key to the container log on every failed
        poll;
      * uvicorn's access log, which writes the full query string of every request — so an
        alerting system posting to `/api/divera/webhook?secret=…` printed the station's
        webhook secret once per alarm.

    Attached to HANDLERS rather than loggers, because `uvicorn.access` sets `propagate = False`
    and never reaches the root handler.

    ⚠️ `exc_text` is pre-rendered here on purpose. `logging.Formatter.format` reuses a record's
    `exc_text` when it is already set and only falls back to formatting `exc_info` itself, so
    filling it in with a redacted rendering is what lets a FILTER — which otherwise sees only
    `msg` and `args` — reach the traceback where the leak actually lived.

    ⚠️ Belt, not braces. The braces are that no credential reaches a message in the first place
    (`divera.check_response`, `audio.transcribe`, `api/personnel._divera_unreachable`). A
    scrubber can only redact shapes it was taught — this one knows nothing about a secret that
    appears without a `?name=` in front of it — so it must never become the reason a call site
    stops being careful.
    """

    def filter(self, record: logging.LogRecord) -> bool:
        record.msg = _redact(record.msg)
        if record.args:
            if isinstance(record.args, dict):
                record.args = {k: _redact(v) for k, v in record.args.items()}
            else:
                record.args = tuple(_redact(a) for a in record.args)
        if record.exc_info and not record.exc_text:
            record.exc_text = logging.Formatter().formatException(record.exc_info)
        if record.exc_text:
            record.exc_text = _redact(record.exc_text)  # type: ignore[assignment]
        return True


def install_log_redaction() -> None:
    """Put :class:`RedactSecretsInUrls` on every configured handler.

    ⚠️ Called TWICE, and both times are load-bearing. At import time it covers the root handler
    `basicConfig` just made, which is where this app's own loggers land. At lifespan startup it
    covers `uvicorn.*`, configured by uvicorn's own `dictConfig` at a moment this module cannot
    order itself against. Idempotent, so the second pass cannot double-redact.
    """
    handlers = list(logging.getLogger().handlers)
    for name in ("uvicorn", "uvicorn.error", "uvicorn.access"):
        handlers.extend(logging.getLogger(name).handlers)
    for handler in handlers:
        if not any(isinstance(f, RedactSecretsInUrls) for f in handler.filters):
            handler.addFilter(RedactSecretsInUrls())


install_log_redaction()

logger = logging.getLogger(__name__)

import json
from collections.abc import AsyncGenerator
from datetime import UTC, datetime
from pathlib import Path
from urllib.parse import urlsplit

from fastapi import Depends, FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from starlette.datastructures import Headers
from starlette.exceptions import HTTPException as StarletteHTTPException

from . import visits
from .auth.cookies import ACCESS_COOKIE, ADMIN_COOKIE, REFRESH_COOKIE
from .auth.incident_link import LINK_COOKIE, enforce_link_scope
from .auth.microsoft import router as microsoft_login_router
from .auth.router import router as auth_router
from .auth.token_blocklist import token_blocklist
from .config import settings
from .csp import csp_for
from .database import Base, engine
from .i18n import set_locale, translate_detail
from .object_visits import ObjectVisitError
from .spa import mount_spa, spa_index_path
from .webmanifest import register_manifest_route


@asynccontextmanager
async def lifespan(app: FastAPI) -> AsyncGenerator[None, None]:
    # Second pass, now that uvicorn has installed its own handlers — `uvicorn.access` does not
    # propagate to root, and it is the log that prints `?secret=…` on every webhook call.
    install_log_redaction()

    # Dev convenience: create tables from models. Production uses Alembic migrations.
    if settings.dev_create_all and not settings.is_production:
        async with engine.begin() as conn:
            await conn.run_sync(Base.metadata.create_all)
        logger.info("dev_create_all: tables ensured")

    if settings.seed_database:
        from .seed import seed_users
        from .seed_config import seed_deployment_config

        # ⚠️ ACCOUNTS FIRST, AND LOUDLY. This used to share one try/except with the two blocks
        # below, which logged and continued — so a production boot with no SEED_PIN (the state
        # `scripts/init-env.sh` used to leave behind) came up with NO USER ACCOUNTS, reported
        # `/ready` ok, passed the SETUP smoke test, and met the operator as «Keine Benutzer
        # hinterlegt» on a login screen, while the docs told them the PIN was 000000. It also
        # took the symbol pack and the config row with it, because they were in the same block.
        # A first boot that cannot create a login is not a running deployment; failing here is
        # the cheapest place to find that out. `seed.py` says so and now it is true.
        await seed_users()

        # ⚠️ The symbol pack is NOT seeded into the database any more (01.09.). It used to be
        # copied into `reference.symbols:tactical` on a deployment's FIRST boot and never again,
        # while the frontend overlaid its artwork on top of the bundled pack — so that frozen row
        # silently reverted every symbol we redrew afterwards, for the life of the station. The
        # bundled pack is now the only source (lib/useSymbols), and a copy of ourselves in the
        # station's own data is exactly the shadow that caused it.
        #
        # Best-effort on purpose: a missing config row is served as an empty config
        # (api/config · get_config), so a station degrades visibly rather than breaking.
        try:
            await seed_deployment_config()
        except Exception:
            logger.exception("Config seeding failed (continuing — the app degrades safely)")

    # Load the deployment locale for error-detail i18n (null-safe; stays de-CH otherwise).
    try:
        from sqlalchemy import select

        from .database import async_session_maker
        from .models import DeploymentConfig

        async with async_session_maker() as db:
            row = (await db.execute(select(DeploymentConfig).where(DeploymentConfig.id == 1))).scalar_one_or_none()
        cfg = (row.config_json if (row and row.config_json) else {}) or {}
        identity = cfg.get("identity") or {}
        set_locale(identity.get("locale"))
    except Exception:
        logger.exception("Loading deployment locale failed (defaulting to de-CH)")

    # Prime the integration-credential snapshot BEFORE anything serves a request. The
    # synchronous readers (push_enabled, the Traccar client, the provider registry) read this
    # snapshot, so a cold one would make a configured integration look off for the first few
    # seconds of a boot. `load` never raises — a database that isn't up yet leaves the
    # snapshot empty, which is the fail-closed state those consumers already handle.
    try:
        from .credentials import load as load_credentials

        await load_credentials(force=True)
    except Exception:
        logger.exception("Priming the integration credentials failed (continuing — they reload on demand)")

    await token_blocklist.start_cleanup_task()

    # Divera poll scheduler (Phase 3) is started here once that module lands.
    try:
        from .scheduler import start_scheduler

        await start_scheduler(app)
    except ImportError:
        pass

    yield

    await token_blocklist.stop_cleanup_task()
    try:
        from .scheduler import stop_scheduler

        await stop_scheduler()
    except ImportError:
        pass
    await engine.dispose()


app = FastAPI(
    title=settings.project_name,
    version=settings.version,
    lifespan=lifespan,
    # Incident-link containment, applied at the app level so it covers EVERY route —
    # including ones added long after auth/incident_link.py was written. A per-router
    # opt-in would make the safe case the one someone has to remember. No-ops unless the
    # caller holds a link session. See auth/incident_link.py for why it is default-deny.
    dependencies=[Depends(enforce_link_scope)],
    docs_url="/docs" if settings.api_docs_enabled else None,
    redoc_url="/redoc" if settings.api_docs_enabled else None,
    openapi_url="/openapi.json" if settings.api_docs_enabled else None,
)


async def _asgi_json(send, status: int, detail: str) -> None:
    """Answer straight from the ASGI layer — the middlewares below run before routing, so
    there is no `Response` machinery available to them yet."""
    payload = json.dumps({"detail": detail}).encode()
    await send(
        {
            "type": "http.response.start",
            "status": status,
            "headers": [
                (b"content-type", b"application/json"),
                (b"content-length", str(len(payload)).encode()),
            ],
        }
    )
    await send({"type": "http.response.body", "body": payload})


class _BodyTooLargeError(Exception):
    """Raised inside :class:`LimitRequestBody`'s receive wrapper and caught by it. It travels
    through the app to get there, which is the point: whatever was mid-parse stops."""


#: Bare image bodies — the only non-multipart uploads (``PUT …/object-visits/{id}/attachments/…``).
_RAW_IMAGE_UPLOADS = frozenset({"image/jpeg", "image/png", "image/webp"})


class LimitRequestBody:
    """Cap the RAW bytes a request may deliver, counted as they arrive (pure ASGI).

    ⚠️ THE DECLARED LENGTH IS NOT THE LIMIT. This used to be a `Content-Length` check and
    nothing else, so a client that simply omitted the header — chunked, streamed, trivially
    scripted, and unauthenticated — walked past it with a body of any size and reached request
    parsing and validation. The header check stays because refusing before reading a byte is
    strictly better, but it is now the fast path, not the guarantee.

    The guarantee is the receive wrapper: every `http.request` chunk is counted, and the first
    one that crosses the cap ends the request. Nothing further is read from the connection, and
    the exception unwinds out of whatever `await request.body()`/multipart parse asked for it,
    so the app never sees the truncated body either.

    Two caps, chosen per request: `multipart/form-data` is a file upload (media, plans,
    reference data) and gets ``max_upload_mb``; everything else gets the much smaller
    ``max_json_body_mb``. ⚠️ ``max_upload_mb`` must stay ABOVE the media route's own 100 MB
    per-file cap plus multipart overhead, or an imported voice memo dies here instead of
    getting the media route's own answer (see config · max_upload_mb).

    Settings are read per request, not captured at construction: `/admin` and the tests move
    them, and a middleware holding a stale copy would be the one place that disagreed.

    ⚠️ Installed OUTSIDE `GzipRequestMiddleware` on purpose. This bounds the WIRE size; the
    decompressed size is that middleware's own separate cap, and neither substitutes for the
    other — a gzip bomb is tiny on the wire, and a plain 2 GB POST never inflates at all.
    """

    def __init__(self, app) -> None:
        self.app = app

    async def __call__(self, scope, receive, send) -> None:
        if scope["type"] != "http":
            await self.app(scope, receive, send)
            return

        headers = Headers(scope=scope)
        # ⚠️ The MEDIA type itself, not a substring: `"multipart/form-data" in header` also matched
        # `application/json; charset=multipart/form-data`, so an unauthenticated caller could pick
        # the 110 MB upload cap for a JSON body (SEC-04). Split off the parameters and compare the
        # bare type.
        media_type = headers.get("content-type", "").split(";", 1)[0].strip().lower()
        # A raw photo PUT (Objektbesuche attachments, docs/object-visits.md) is an upload too;
        # its route caps it far lower itself (15 MB).
        is_upload = media_type == "multipart/form-data" or media_type in _RAW_IMAGE_UPLOADS
        cap_mb = settings.max_upload_mb if is_upload else settings.max_json_body_mb
        cap = cap_mb * 1024 * 1024
        too_large = f"Anfrage zu gross (max. {cap_mb} MB)"

        declared = headers.get("content-length")
        if declared is not None:
            try:
                size = int(declared)
                if size < 0:
                    raise ValueError
            except ValueError:
                await _asgi_json(send, 400, "Ungültige Content-Length")
                return
            if size > cap:
                await _asgi_json(send, 413, too_large)
                return

        received = 0
        exceeded = False
        responded = False

        async def limited_receive():
            nonlocal received, exceeded
            message = await receive()
            if message["type"] == "http.request":
                received += len(message.get("body", b""))
                if received > cap:
                    exceeded = True
                    raise _BodyTooLargeError
            return message

        async def guarded_send(message) -> None:
            nonlocal responded
            # ⚠️ `exceeded` outranks whatever the app decided. FastAPI wraps ANY failure of
            # `await request.body()` in its own «There was an error parsing the body» 400
            # (and a multipart parser has its own opinions), so the raise alone stops the
            # parse but does not own the answer — this does. Once a response has genuinely
            # gone out (a streamed download that read the body afterwards) it stands.
            if exceeded and not responded:
                return
            if message["type"] == "http.response.start":
                responded = True
            await send(message)

        with suppress(_BodyTooLargeError):
            await self.app(scope, limited_receive, guarded_send)
        if exceeded and not responded:
            await _asgi_json(send, 413, too_large)


# Sync-channel compression, both directions: responses (workspace/journal/reference JSON is
# highly repetitive → ~8–10× smaller on field LTE) and gzip-encoded request bodies from the
# frontend (large workspace saves). Request inflation enforces a decompressed-size cap so a
# gzip bomb can't expand past the JSON body limit; LimitRequestBody above it bounds the wire
# size. No streaming/SSE endpoints exist, so response gzip is safe globally.
from starlette.middleware.gzip import GZipMiddleware

from .gzip_request import GzipRequestMiddleware

app.add_middleware(GZipMiddleware, minimum_size=1024)
app.add_middleware(GzipRequestMiddleware, max_decompressed_bytes=settings.max_json_body_mb * 1024 * 1024)
# ⚠️ ADDED AFTER the gzip pair, and that is what puts it OUTSIDE them: `add_middleware`
# prepends, so the last one added is the outermost. It must see the bytes as they came off
# the wire, before anything inflates them.
app.add_middleware(LimitRequestBody)


@app.exception_handler(StarletteHTTPException)
async def http_exception_handler(request: Request, exc: StarletteHTTPException) -> JSONResponse:
    """Same JSON shape as Starlette's default ({"detail": ...}) but with the detail run
    through the configured-locale translation. Status code and headers (e.g. the
    WWW-Authenticate header on 401s) are preserved; non-string details pass through.
    """
    detail = exc.detail
    if isinstance(detail, str):
        detail = translate_detail(detail)
    return JSONResponse(
        {"detail": detail},
        status_code=exc.status_code,
        headers=exc.headers,
    )


#: How much of a rejected request may appear in its own 422. Enough to say what is wrong with
#: which field, never enough to be worth sending a big body to provoke.
_MAX_VALIDATION_ERRORS = 8
_MAX_VALIDATION_MSG_CHARS = 200
#: `loc` is caller-influenced too — a rejected field's path can contain a dict key the caller
#: chose — so the number of parts and each part's length are bounded like `msg` (SEC-04).
_MAX_VALIDATION_LOC_PARTS = 10
_MAX_VALIDATION_LOC_PART_CHARS = 100


@app.exception_handler(ObjectVisitError)
async def object_visit_error_handler(request: Request, exc: ObjectVisitError) -> JSONResponse:
    """Objektbesuche refusals carry a ``code`` at the TOP of the body (docs/object-visits.md:
    ``409 {code: "revision_conflict", revision, visit}``), plus the usual ``detail``."""
    return JSONResponse(exc.body(), status_code=exc.status)


@app.exception_handler(RequestValidationError)
async def validation_exception_handler(request: Request, exc: RequestValidationError) -> JSONResponse:
    """422 with the same `{"detail": [{loc, msg, type}, …]}` shape clients already read — minus
    the submitted data.

    ⚠️ FastAPI's default puts every offending value back in the response under `input` (and
    again inside `ctx`), so a rejected 1 MiB body answered with a 2 MB error. That is an
    amplifier an unauthenticated caller can aim at the one service every tablet talks to, and
    it is also the request's own contents echoed to whoever sent it. Both go: `loc` names the
    field, `msg` says what was expected, and neither needs the value to do it.
    """
    errors = [
        {
            "loc": [
                str(part)[:_MAX_VALIDATION_LOC_PART_CHARS] for part in err.get("loc", ())[:_MAX_VALIDATION_LOC_PARTS]
            ],
            # A custom validator's message can quote what it was given; the cap bounds that too.
            "msg": str(err.get("msg", ""))[:_MAX_VALIDATION_MSG_CHARS],
            "type": str(err.get("type", "")),
        }
        for err in exc.errors()[:_MAX_VALIDATION_ERRORS]
    ]
    return JSONResponse({"detail": errors}, status_code=422)


@app.exception_handler(Exception)
async def unhandled_exception_handler(request: Request, exc: Exception) -> JSONResponse:
    """Unhandled errors must still answer JSON: clients surface {"detail": ...} from every
    error response (the capture client parses it), and Starlette's plain-text default
    "Internal Server Error" breaks that. Neutral detail only — the traceback stays in the
    server log, nothing internal leaks to the client. HTTPExceptions never reach this
    (they're handled above), so the normal error flow is untouched.
    """
    logger.exception("Unhandled error on %s %s", request.method, request.url.path, exc_info=exc)
    return JSONResponse({"detail": translate_detail("Interner Fehler")}, status_code=500)


@app.middleware("http")
async def api_server_time(request: Request, call_next):
    """Every /api/* response carries the server clock so clients can warn about device
    clock skew. Contract with the frontend: header `X-Server-Time`, ISO-8601 UTC. Two
    consumers: the capture client (times are typed on whatever phone scanned the poster)
    and the workspace live-follow poll (Atemschutz contact/pressure timestamps are
    device-local Date.now(), so a tablet minutes off corrupts the legal record silently).
    On every API response — errors included, so the skew check works even before auth.
    """
    response = await call_next(request)
    if request.url.path.startswith(f"{settings.api_prefix}/"):
        response.headers["X-Server-Time"] = datetime.now(UTC).isoformat()
    return response


@app.middleware("http")
async def api_json_no_store(request: Request, call_next):
    """API JSON must never be HTTP-cached: without Cache-Control, Safari's heuristic cache
    served stale poll results (an STT status stuck on "none" hid finished transcriptions).
    The client also sends cache:'no-store', but the header protects devices still running
    an older PWA bundle. Media streaming (audio/images) stays cacheable — range requests
    and repeat playback benefit from it.
    """
    response = await call_next(request)
    if request.url.path.startswith("/api/") and response.headers.get("content-type", "").startswith("application/json"):
        response.headers.setdefault("Cache-Control", "no-store")
    return response


#: Unsafe methods — the ones a cross-origin page could use to CHANGE something.
_UNSAFE_METHODS = frozenset({"POST", "PUT", "PATCH", "DELETE"})

#: Every cookie in this app that authenticates something (auth/cookies · auth/incident_link).
#: One of these riding along is what makes a request worth stealing.
_SESSION_COOKIES = (ACCESS_COOKIE, REFRESH_COOKIE, ADMIN_COOKIE, LINK_COOKIE)

#: The explicit non-cookie credentials, as the routes that read them spell them (api/capture,
#: api/divera, api/alarms, api/firehub, api/traccar, api/stats, api/print_relay).
_CREDENTIAL_HEADERS = ("x-capture-token", "x-webhook-secret", "x-stats-token", "x-print-agent-secret")

#: `Sec-Fetch-Site` values a request from our own page (or a typed address) carries.
_OWN_FETCH_SITES = frozenset({"same-origin", "none"})


def _own_origins(request: Request) -> set[str]:
    """The origins this deployment answers as, lowercased and without a trailing slash.

    The app IS its origin: frontend and API are one service behind one hostname (see the module
    docstring). `PUBLIC_URL`, when set, is the authoritative answer — the browser loaded the page
    from it and no caller can forge it.

    ⚠️ In production the `Host` header is trusted (the platform sets it), but `X-Forwarded-Host`
    is NOT unioned in: it is client-suppliable, so unioning it would let a caller ADD an allowed
    origin and walk through this gate (SEC-12). Off production the SPA reaches `/api` through
    Vite's proxy with `changeOrigin`, which rewrites `Host`, so the forwarded headers are trusted
    there to recover the origin the browser actually loaded — there is no hostile sibling on a
    developer's machine to exploit them.
    """
    headers = request.headers
    origins: set[str] = set()
    if settings.public_url:
        origins.add(settings.public_url.strip().rstrip("/").lower())
    if settings.is_production:
        scheme = (headers.get("x-forwarded-proto") or request.url.scheme).split(",")[0].strip()
        host = (headers.get("host") or "").split(",")[0].strip()
    else:
        scheme = (headers.get("x-forwarded-proto") or request.url.scheme).split(",")[0].strip()
        host = (headers.get("x-forwarded-host") or headers.get("host") or "").split(",")[0].strip()
    if host:
        origins.add(f"{scheme}://{host}".lower())
    return origins


def _dev_origin(origin: str) -> bool:
    """`just dev` serves the SPA from Vite (loopback on :5188, or a LAN address under `VITE_LAN=1`
    for iPad testing) and proxies `/api` with `changeOrigin: true`, which rewrites `Host` to the
    backend's — so the derived own-origin can never match the browser's and every logged-in write
    would 403. Accept the developer's own machine and the private LAN it serves from, never in
    production (SEC-12's threat is a hostile same-site sibling, which only exists on a real
    deployment; a developer's LAN has no such sibling)."""
    if settings.is_production:
        return False
    host = urlsplit(origin).hostname or ""
    if host in {"localhost", "127.0.0.1", "::1"}:
        return True
    try:
        ip = ipaddress.ip_address(host)
    except ValueError:
        return False
    return ip.is_private or ip.is_link_local


@app.middleware("http")
async def enforce_request_origin(request: Request, call_next):
    """Same-origin gate for cookie-authenticated mutations (the CSRF half of SEC-12).

    SameSite=Lax stops an unrelated site from attaching this station's cookies to a cross-site
    POST. It does NOT stop a same-site sibling — another host under the station's own domain,
    hostile or merely compromised — and for that one the browser sends them. A credentialed
    empty POST with a foreign `Origin` rotated the Erfassungs-Poster secret, invalidating every
    printed poster in the station.

    Who this applies to, and why each exemption is safe:

    * **unsafe methods only.** A GET changes nothing; gating reads would break `<img>` and the
      service worker for no gain.
    * **only when a session cookie rides along.** A caller with none has no ambient authority
      to borrow — whatever authorized it travelled in the request on purpose.
    * **no `Origin` header → through.** The admin CLI, the print agent and the alerting
      webhooks send none (nor does curl), and they carry their own explicit credential. Only a
      browser adds `Origin`, and this is the same browser/non-browser split `PUT /api/config`
      already draws to decide whether `If-Match` is mandatory.
    * **an explicit credential HEADER → through**, foreign origin and all. A cross-origin page
      cannot set `X-Capture-Token` without a CORS preflight, and this app answers none — so
      such a header means a caller that already holds the secret, and its route's own 401 is
      the honest answer rather than this one's 403.

    `Sec-Fetch-Site` is a SECOND signal, never the only one: it catches the browser request
    that arrives without `Origin`, and a client that omits both is by then indistinguishable
    from the CLI it must not break.
    """
    if request.method in _UNSAFE_METHODS and any(c in request.cookies for c in _SESSION_COOKIES):
        headers = request.headers
        # ⚠️ A non-empty VALUE, not mere presence: an empty `X-Stats-Token:` (or any of these sent
        # blank) is no credential, and presence-only let it switch the gate off on unrelated routes
        # (SEC-12). A real header credential still exempts the request — its own route answers 401.
        if not any(headers.get(h, "").strip() for h in _CREDENTIAL_HEADERS):
            origin = headers.get("origin")
            site = (headers.get("sec-fetch-site") or "").lower()
            foreign_origin = origin is not None and not (
                origin.lower().rstrip("/") in _own_origins(request) or _dev_origin(origin)
            )
            if foreign_origin or (site and site not in _OWN_FETCH_SITES):
                logger.warning(
                    # %r on the path: a decoded %0a in it would otherwise forge log lines (CWE-117).
                    "Fremde Herkunft abgewiesen: %s %r (origin=%r, sec-fetch-site=%r)",
                    request.method,
                    request.url.path,
                    origin,
                    site or None,
                )
                return JSONResponse({"detail": "Anfrage von einer fremden Herkunft"}, status_code=403)
    return await call_next(request)


# One warning, not one per request: a deployment behind a proxy that never set
# TRUSTED_FORWARDED_HOPS keys every per-client throttle on the proxy's own IP — attacker
# failures then share cooldown buckets with the operator's tablet. The header's presence is
# the tell, and it has to be said out loud because everything still WORKS, just badly.
_xff_unconfigured_warned = False


@app.middleware("http")
async def security_headers(request: Request, call_next):
    """Browser-defence header layer.

    `nosniff` so a response's declared type is its only type; a referrer policy so an incident
    URL (which carries an incident id, and on the link pages a token) does not travel to a
    third-party host; `frame-ancestors 'self'` — with `X-Frame-Options` for the browsers
    that still only read that — so the app cannot be framed and clickjacked.

    Since 06.09. also the script half (app/csp.py): `script-src 'self'` + the hashed inline
    boot script + `'wasm-unsafe-eval'` (pdf.js codecs), `worker-src 'self' blob:` (MapLibre
    builds its worker from a Blob URL), `object-src 'none'`, `base-uri 'self'`. Verified
    against the built app — see csp.py for the per-library reasoning.

    `setdefault` throughout: a route that already decided something stricter for its own
    response keeps it — api/branding's sandboxed CSP for admin-uploaded SVG is exactly that,
    and so is api/reference's.
    """
    global _xff_unconfigured_warned
    if not _xff_unconfigured_warned and settings.trusted_forwarded_hops == 0 and "x-forwarded-for" in request.headers:
        _xff_unconfigured_warned = True
        logger.warning(
            "Requests carry X-Forwarded-For but TRUSTED_FORWARDED_HOPS=0 — every per-client "
            "throttle (PIN cooldown, capture/position limiter) is keying on the proxy IP. "
            "Behind Railway/Caddy set TRUSTED_FORWARDED_HOPS=1."
        )
    response = await call_next(request)
    response.headers.setdefault("X-Content-Type-Options", "nosniff")
    response.headers.setdefault("Referrer-Policy", "strict-origin-when-cross-origin")
    response.headers.setdefault("X-Frame-Options", "SAMEORIGIN")
    response.headers.setdefault("Content-Security-Policy", csp_for(Path(spa_index_path())))
    return response


@app.middleware("http")
async def count_visit(request: Request, call_next):
    """Demo-only visit statistics — a no-op on every deployment that is not the public demo.

    ⚠️ The `visits.enabled()` check is the FIRST thing here and it is the whole safety story:
    stations run this same image, and `VISIT_STATS` is unset for them, so this middleware
    returns before it has looked at a header. See app/visits.py for the second gate (the
    beacon origin allowlist) and for why nothing here can identify a visitor.

    What it counts: an HTML document served by the SPA fallback is one `demo` visit, and an
    API call that matches the coarse bucket map is one `feature` hit. Everything else — the
    health probes, /assets, the beacon route itself, and the large majority of API routes —
    counts nothing. Only responses the server was happy with, so a bot rattling a 401 does
    not read as somebody using the app.
    """
    response = await call_next(request)
    if not visits.enabled() or response.status_code >= 400:
        return response

    path = request.url.path
    if path.startswith(f"{settings.api_prefix}/hit"):
        return response  # the beacon counts itself; it must not also be a hit
    if path.startswith(f"{settings.api_prefix}/"):
        bucket = visits.bucket_for(path)
        if bucket:
            await visits.record("feature", bucket, request)
    elif request.method == "GET" and response.headers.get("content-type", "").startswith("text/html"):
        # The SPA shell — index.html is served no-cache, so a returning tablet still asks.
        await visits.record("demo", "app", request)
    return response


@app.get("/health")
async def health() -> dict:
    """Liveness only — static by design. Readiness (DB + storage) is /ready; point container
    and platform healthchecks THERE, or an unreachable database still reports healthy.

    Carries the BUILD, not just the version: `curl /health` is the first thing anybody does to
    a deployment that is behaving oddly, and `{"version": "0.6.0"}` is the same answer from a
    from-source build of `main` and from a three-day-old published image. `commit`/`built_at`
    say which one is actually running (see `Settings.build`).
    """
    build = settings.build
    return {
        "status": "ok",
        "service": settings.project_name,
        "version": settings.version,  # == build["release"]; the pre-existing key, kept for callers
        "commit": build["commit"],
        "built_at": build["built_at"],
    }


@app.get("/ready")
async def ready() -> JSONResponse:
    """Readiness: can this instance do real work? Probes the database and the storage volume
    so the orchestrator restarts/alerts on a data-layer outage instead of serving green."""
    from .readiness import check_readiness

    checks = await check_readiness(engine)
    ok = all(v == "ok" for v in checks.values())
    return JSONResponse(
        {"status": "ok" if ok else "error", "version": settings.version, **checks},
        status_code=200 if ok else 503,
    )


# --- API routers (each phase registers here) ---
P = settings.api_prefix
app.include_router(auth_router, prefix=P)
app.include_router(microsoft_login_router, prefix=P)


def _register_optional_routers() -> None:
    """Routers added by later phases; imported defensively so Phase 1 runs alone."""
    for module_name, attr in [
        ("app.api.admin", "router"),
        ("app.api.config", "router"),
        ("app.api.plan_scales", "router"),
        ("app.api.branding", "router"),
        ("app.api.incidents", "router"),
        ("app.api.incident_link", "incidents_router"),
        ("app.api.person_positions", "router"),
        ("app.api.presentation", "router"),
        ("app.api.media", "router"),
        ("app.api.divera", "router"),
        ("app.api.alarms", "router"),
        ("app.api.firehub", "router"),
        ("app.api.capture", "router"),
        ("app.api.incident_link", "router"),
        ("app.api.personnel", "router"),
        ("app.api.station_workbook", "router"),
        ("app.api.traccar", "router"),
        ("app.api.weather", "router"),
        ("app.api.geocode", "router"),
        ("app.api.overpass", "router"),
        # before api/reference: its `/{dataset_id}` would swallow `/reference/objects`
        ("app.api.station_reference", "router"),
        ("app.api.reference", "router"),
        ("app.api.plan_alignments", "router"),
        ("app.api.objects", "router"),
        ("app.api.objects", "incidents_objects_router"),
        ("app.api.building", "router"),
        ("app.api.events", "router"),
        ("app.api.journal", "router"),
        ("app.api.push", "router"),
        ("app.api.report", "router"),
        ("app.api.print_relay", "router"),
        ("app.api.stats", "router"),
        ("app.api.system", "router"),
        ("app.api.credentials", "router"),
        ("app.api.sharepoint", "router"),
        ("app.api.diag", "router"),
        ("app.api.visits", "router"),
        ("app.api.object_visits", "router"),
        ("app.api.integrations", "router"),
        ("app.api.object_visits_admin", "router"),
    ]:
        try:
            mod = __import__(module_name, fromlist=[attr])
            app.include_router(getattr(mod, attr), prefix=P)
        except ImportError:
            continue


_register_optional_routers()

# The PWA manifest is generated per-deployment from the station's identity, so it must be a
# route — and it must be registered BEFORE mount_spa, whose catch-all would otherwise serve
# the build-time file straight from dist/. See webmanifest.py.
register_manifest_route(app)

# SPA fallback must be mounted LAST so it doesn't shadow /api, /health, or /ready.
mount_spa(app)
