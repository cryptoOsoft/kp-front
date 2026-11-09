"""Serve the built Vite SPA from FastAPI (single-service, same-origin in production).

Static assets are served from ``<spa_dir>/assets``; every other non-API GET falls back
to ``index.html`` so client-side routing works. If the build dir is absent (e.g. running
the API standalone in dev with Vite on :5188), this is a no-op.
"""

import asyncio
import logging
import os

from fastapi import FastAPI, Request
from fastapi.responses import FileResponse, HTMLResponse, JSONResponse
from fastapi.staticfiles import StaticFiles
from starlette.responses import Response
from starlette.types import Scope

from .config import settings

logger = logging.getLogger(__name__)


# The PWA update chain lives or dies on these files being revalidated on every fetch: without
# an explicit Cache-Control the browser applies HEURISTIC freshness (10% of file age), so hours
# after a deploy a tablet could keep re-reading a stale sw.js/index.html from its HTTP cache and
# never learn a new build exists. ETag/Last-Modified make the forced revalidation a cheap 304.
# sw-media-cache.js is an importScripts of sw.js: with the default `updateViaCache: 'imports'`
# the browser fetches it THROUGH the HTTP cache, so a new sw.js could install with an hour-old
# import. Same rule as sw-notify.js.
# Every script the worker imports (vite.config · workbox.importScripts) belongs here: with an
# hour of HTTP cache a NEW worker installs with an OLD import (tests/test_spa_cache.py compares).
_NO_CACHE_FILES = {
    "index.html",
    "sw.js",
    "sw-boot-timing.js",
    "sw-notify.js",
    "sw-media-cache.js",
    "sw-tile-store.js",
    "manifest.webmanifest",
    "registerSW.js",
}


def _cache_control(basename: str) -> str:
    return "no-cache" if basename in _NO_CACHE_FILES else "public, max-age=3600"


class ImmutableStaticFiles(StaticFiles):
    """/assets/* carries a content hash in the filename — safe to cache forever."""

    async def get_response(self, path: str, scope: Scope) -> Response:
        response = await super().get_response(path, scope)
        response.headers["Cache-Control"] = "public, max-age=31536000, immutable"
        return response


# The public demo advertises itself: a forwarded demo link shows a card in WhatsApp/Teams. The
# picture is the landing page's hero, so the two stay one image (site/capture.mjs refreshes
# both). A station never gets these — its Lagekarte is nobody's link preview.
_DEMO_OG = """<meta property="og:type" content="website">
<meta property="og:title" content="KP Front – Demo: Zimmerbrand in Musterdorf">
<meta property="og:description" content="Ohne Login ausprobieren – Karte, Pläne, Trupps, Verlauf und Rapport in einer App.">
<meta property="og:image" content="https://kp-front.ch/shots/lage.jpg">
<meta name="twitter:card" content="summary_large_image">
"""


def with_demo_og(html: str, public_url: str = "") -> str:
    """index.html with the demo's Open Graph tags inserted before </head> (unchanged if absent).
    Only meta tags go in, so the CSP's inline-script hashes (app/csp.py) still match."""
    tags = _DEMO_OG + (f'<meta property="og:url" content="{public_url.rstrip("/")}/">\n' if public_url else "")
    head, sep, tail = html.partition("</head>")
    return head + tags + sep + tail if sep else html


def _read_text(path: str) -> str:
    with open(path, encoding="utf-8") as f:
        return f.read()


def spa_index_path() -> str:
    """Absolute path of the served index.html — also the CSP's hash source (app/csp.py)."""
    return os.path.abspath(os.path.join(os.path.dirname(__file__), "..", settings.spa_dir, "index.html"))


def mount_spa(app: FastAPI) -> None:
    index = spa_index_path()
    spa_dir = os.path.dirname(index)
    if not os.path.isfile(index):
        logger.info("SPA build not found at %s — API runs standalone (Vite serves the SPA in dev).", spa_dir)
        return

    assets_dir = os.path.join(spa_dir, "assets")
    if os.path.isdir(assets_dir):
        app.mount("/assets", ImmutableStaticFiles(directory=assets_dir), name="assets")

    @app.get("/{full_path:path}", response_model=None, include_in_schema=False)
    async def spa_fallback(request: Request, full_path: str) -> FileResponse | HTMLResponse | JSONResponse:
        # Never swallow API routes.
        if full_path.startswith("api/"):
            return JSONResponse({"detail": "Not Found"}, status_code=404)
        # Serve a real file if it exists (favicon, plans, leitungskataster, …), but only
        # if it resolves to within spa_dir — never let "../" escape the build directory.
        candidate = os.path.abspath(os.path.join(spa_dir, full_path))
        if full_path and (candidate == spa_dir or candidate.startswith(spa_dir + os.sep)) and os.path.isfile(candidate):
            return FileResponse(candidate, headers={"Cache-Control": _cache_control(os.path.basename(candidate))})
        if settings.is_public_demo:
            html = await asyncio.to_thread(_read_text, index)
            return HTMLResponse(with_demo_og(html, settings.public_url), headers={"Cache-Control": "no-cache"})
        return FileResponse(index, headers={"Cache-Control": "no-cache"})

    logger.info("Serving SPA from %s", spa_dir)
