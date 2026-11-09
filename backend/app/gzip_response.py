"""Response gzip that leaves already-compressed bodies alone.

Starlette's `GZipMiddleware` compresses every response above the minimum size, at level 9, on
the one server process that also answers the saves. Two things were wasted: level 9 buys 0.3 %
over level 6 on the app's JS, and WebP plan tiles, JPEG photos, PDFs and the media ZIP do not
shrink at all — a crew opening an object makes every tablet prefetch its tiles at once.
"""

from starlette.datastructures import Headers
from starlette.middleware.gzip import GZipMiddleware, GZipResponder, IdentityResponder
from starlette.types import ASGIApp, Message, Receive, Scope, Send

#: Content types whose bytes are compressed already. `image/svg+xml` is text and stays in.
ALREADY_COMPRESSED = ("image/", "audio/", "video/", "application/pdf", "application/zip", "font/woff")
COMPRESS_LEVEL = 6


class _SelectiveResponder(GZipResponder):
    async def send_with_compression(self, message: Message) -> None:
        # The parent only RECORDS the start message (it decides about headers at the first body
        # chunk), so widening its own «excluded content type» flag here is the whole override.
        await super().send_with_compression(message)
        if message["type"] == "http.response.start":
            content_type = Headers(raw=message["headers"]).get("content-type", "")
            if content_type.startswith(ALREADY_COMPRESSED) and not content_type.startswith("image/svg"):
                self.content_type_is_excluded = True


class SelectiveGZipMiddleware(GZipMiddleware):
    """Used once, in `main.py`, in place of Starlette's own."""

    def __init__(self, app: ASGIApp, minimum_size: int = 500) -> None:
        super().__init__(app, minimum_size=minimum_size, compresslevel=COMPRESS_LEVEL)

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] != "http":
            await self.app(scope, receive, send)
            return
        responder: ASGIApp
        if "gzip" in Headers(scope=scope).get("Accept-Encoding", ""):
            responder = _SelectiveResponder(self.app, self.minimum_size, compresslevel=self.compresslevel)
        else:
            responder = IdentityResponder(self.app, self.minimum_size)
        await responder(scope, receive, send)
