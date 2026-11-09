"""Response gzip: text shrinks, bytes that are compressed already pass untouched.

`SelectiveGZipMiddleware` widens a flag inside Starlette's responder, so this is also the test
that goes red when a Starlette upgrade renames it.
"""

import httpx
import pytest
from starlette.applications import Starlette
from starlette.responses import Response
from starlette.routing import Route

from app.gzip_response import SelectiveGZipMiddleware

pytestmark = pytest.mark.asyncio

BODY = b"plan tile " * 400  # well past the minimum size, and it would shrink


def _app() -> Starlette:
    def serve(media_type: str):
        async def endpoint(_request) -> Response:
            return Response(BODY, media_type=media_type)

        return endpoint

    app = Starlette(
        routes=[
            Route("/json", serve("application/json")),
            Route("/svg", serve("image/svg+xml")),
            Route("/tile", serve("image/webp")),
            Route("/pdf", serve("application/pdf")),
        ]
    )
    app.add_middleware(SelectiveGZipMiddleware, minimum_size=1024)
    return app


@pytest.mark.parametrize(("path", "encoded"), [("/json", True), ("/svg", True), ("/tile", False), ("/pdf", False)])
async def test_only_compressible_types_are_gzipped(path: str, encoded: bool):
    async with httpx.AsyncClient(transport=httpx.ASGITransport(app=_app()), base_url="http://test") as client:
        r = await client.get(path, headers={"Accept-Encoding": "gzip"})
    assert r.content == BODY
    assert (r.headers.get("content-encoding") == "gzip") is encoded
