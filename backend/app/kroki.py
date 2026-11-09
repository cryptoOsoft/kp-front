"""Server-side Kroki compositor — renders the Lage map to a bitmap without a browser.

Every kp-front basemap is raster XYZ tiles (CARTO PNG / swisstopo WMTS JPEG), so the Kroki
needs no WebGL: stitch tiles for the fitted view, then draw the workspace's drawings and
tactical symbols on top with Pillow. The symbol artwork is the SAME pack the client uses
(public/tactical-symbols.json), rasterised with resvg — identical glyphs, no porting drift.

This replaces the browser capture path (html2canvas + preserveDrawingBuffer) so the whole
rapport can be composed server-side — the prerequisite for the print relay's «Einsatzrapport
drucken» button working without a tablet in the loop.

Deliberately mirrors the client's sizing rules (src/lib/mapView.ts): symbols live in a
28..48 px band derived from real-world metres × zoom (floor 34 for a vehicle, whose name is
inside the glyph), scaled by the Kroki multiplier (0.85..1)
(ReportPrintView symMul). Rendering is supersampled 2× and downscaled for clean edges.
"""

from __future__ import annotations

import hashlib
import io
import itertools
import json
import logging
import math
import re
import xml.etree.ElementTree as ElementTree
from dataclasses import dataclass, field
from pathlib import Path

import httpx
from PIL import Image, ImageChops, ImageDraw, ImageFont

from . import carto

logger = logging.getLogger(__name__)

TILE = 256
_UA = {"User-Agent": "kp-front-kroki/1.0 (+https://github.com/feuerwehr-oberwil/kp-front)"}

# ----------------------------------------------------------------------------- projection


def world_px(lng: float, lat: float, z: float) -> tuple[float, float]:
    """WebMercator world pixel of a WGS84 coordinate at zoom z (256px tiles)."""
    scale = TILE * (2**z)
    x = (lng + 180.0) / 360.0 * scale
    siny = min(max(math.sin(math.radians(lat)), -0.9999), 0.9999)
    y = (0.5 - math.log((1 + siny) / (1 - siny)) / (4 * math.pi)) * scale
    return x, y


def px_per_m(lat: float, z: float) -> float:
    """Pixels per ground metre (client lib/mapView.ts pxPerM)."""
    return (2**z) / (156543.03392 * math.cos(math.radians(lat)))


_SYM_MIN_KIND = {"vehicle": 34.0}


def sym_px(kind: str, lat: float, z: float, mul: float = 1.0) -> float:
    """Symbol size band (client lib/mapView.ts symPx): metres × zoom clamped to 28..48.

    A vehicle has a HIGHER floor of its own (34), because its name is baked into the glyph body
    and can only grow with the glyph (client lib/mapView.ts SYM_MIN_KIND, 20.10.2026). The sheet
    must use the same floor as the screen: this size also places the legend's numbered disc
    (`_caption` / client lib/krokiLegend · discOffsetPx) and snaps attached Leitung ends to the
    glyph rectangle (`_snap_attached_ends`), so a server that kept 28 would print the hose short
    and the disc high on exactly the vehicles the floor was raised for.
    """
    size_m = {"vehicle": 11, "command": 10, "hydrant": 6, "symbol": 8, "area": 8}.get(kind, 8)
    return max(_SYM_MIN_KIND.get(kind, 28.0), min(48.0, size_m * px_per_m(lat, z))) * mul


def kroki_symbol_mul(z: float) -> float:
    """Print-specific scale: close-up crops need less marker growth than the live map.

    Keep overview maps unchanged through z17, then ease down by 10% per zoom level and
    stop at 85%. Mirrored by ``krokiSymbolMul`` in ``src/lib/krokiPayload.ts`` so the
    framing modal remains WYSIWYG.

    ⚠️ The floor was 0.70 until 18.08. Held against the live map side by side, the printed
    symbols came out about half the relative size — 0.70 of the band, on a crop that also covers
    more ground than the phone view it was compared with. 0.85 keeps the reason the reduction
    exists (a close-up crop does not need the full on-screen growth, or four glyphs merge into one
    blob) while leaving the Lage recognisable as the same picture.
    """
    return max(0.85, 1.0 - max(0.0, z - 17.0) * 0.1)


@dataclass
class View:
    z: float  # fractional, like MapLibre — tiles are fetched at ceil(z) and downscaled
    origin: tuple[float, float]  # world px (at zoom z) of the image's top-left
    width: int
    height: int
    # MapLibre defines camera zoom against a 512 px world, while traditional XYZ raster
    # tiles (and this compositor's projection) use 256 px. Explicit views therefore need
    # z+1 for projection/tile selection, but overlay sizing must keep using the camera zoom.
    overlay_z: float | None = None

    def project(self, lng: float, lat: float) -> tuple[float, float]:
        wx, wy = world_px(lng, lat, self.z)
        return wx - self.origin[0], wy - self.origin[1]


def fit_view(
    points: list[tuple[float, float]],
    width: int,
    height: int,
    pad_frac: float = 0.08,
    min_z: float = 10.0,
    max_z: float = 20.0,
) -> View:
    """Fractional zoom at which all points fill the frame (with padding), centered —
    the same framing feel as MapLibre's fitBounds.

    max_z 20 > the z19 tile ceiling on purpose: a single-building incident has its whole
    extent within a few metres, and at z19 the 48px-capped glyphs pile up into one clump
    on a ~320m frame. z20 halves the frame (~160m) so they separate; render_base upscales
    the z19 tiles 2× (slightly soft basemap — the readable symbols matter more)."""
    pts = points or [(8.2275, 46.8182)]
    p0 = [world_px(lng, lat, 0) for lng, lat in pts]
    ext_x = max(p[0] for p in p0) - min(p[0] for p in p0)
    ext_y = max(p[1] for p in p0) - min(p[1] for p in p0)
    z = min(
        math.log2(width * (1 - 2 * pad_frac) / ext_x) if ext_x > 0 else max_z,
        math.log2(height * (1 - 2 * pad_frac) / ext_y) if ext_y > 0 else max_z,
    )
    z = max(min_z, min(max_z, z))
    proj = [world_px(lng, lat, z) for lng, lat in pts]
    cx = (max(p[0] for p in proj) + min(p[0] for p in proj)) / 2
    cy = (max(p[1] for p in proj) + min(p[1] for p in proj)) / 2
    return View(z=z, origin=(cx - width / 2, cy - height / 2), width=width, height=height)


def center_view(center: tuple[float, float], z: float, width: int, height: int) -> View:
    """View for an explicit MapLibre center+zoom from the framing modal.

    MapLibre's camera has a constant 512 px tile size; its zoom 16 therefore covers the
    same geographic extent as a 256 px XYZ projection at zoom 17. Keeping the raw camera
    zoom here made the PDF twice as wide/high as the crop the operator had selected.
    """
    projection_z = z + math.log2(512 / TILE)
    cx, cy = world_px(center[0], center[1], projection_z)
    return View(
        z=projection_z,
        origin=(cx - width / 2, cy - height / 2),
        width=width,
        height=height,
        overlay_z=z,
    )


def bounds_view(bounds: tuple[float, float, float, float], width: int, height: int) -> View:
    """Render the literal north-up viewport bounds selected in MapLibre.

    Bounds avoid any dependency on the client's camera/tile zoom convention. With the
    selector and output sharing an aspect ratio, the two corners land on the image edges.
    """
    west, south, east, north = bounds
    return fit_view([(west, south), (east, north)], width, height, pad_frac=0.0, min_z=0.0, max_z=24.0)


# ----------------------------------------------------------------------------- tiles

#: The basemap providers this server will fetch tiles from. The Rapport payload NAMES the
#: basemap the operator was looking at (src/lib/krokiPayload.ts), and that name is a caller
#: string like any other — before this table it was fetched as given, which made the report
#: composer a request forwarder from the server's own network position (SEC-03, 05.09.).
#:
#: Hosts, not whole templates: a provider's style path is theirs to change (CARTO adds a
#: basemap, swisstopo a layer) and pinning every path would break printing on a config the
#: station never touched. The host is what decides where the request goes.
#:
#: ⚠️ These are the three base layers the app itself offers (src/data/demoIncident.ts). A
#: station running its OWN tile server adds its host through REPORT_TILE_HOSTS — an env
#: setting, i.e. whoever runs the deployment, never a caller and never the admin UI.
_TILE_PROVIDER_HOSTS = frozenset(
    {
        "basemaps.cartocdn.com",
        "a.basemaps.cartocdn.com",
        "b.basemaps.cartocdn.com",
        "c.basemaps.cartocdn.com",
        "d.basemaps.cartocdn.com",
        "wmts.geo.admin.ch",
        "tile.openstreetmap.org",
    }
)

#: One tile, capped. A 256px raster tile is a few dozen KB; anything past this is either a
#: provider fault or a body meant to be read rather than drawn.
MAX_TILE_BYTES = 2 * 1024 * 1024
#: Tiles the on-disk cache keeps before it starts dropping its oldest. ~20k × ≤2 MB is the
#: worst case; in practice a station's repeated renders sit in the low hundreds of MB.
MAX_CACHE_ENTRIES = 20_000
#: The `{z}`/`{x}`/`{y}` slots and nothing else — the template is `.format()`ed, and any other
#: field would either raise or reach into the objects passed in («{z.__class__}»).
_TILE_SLOTS_RE = re.compile(r"\{(?!(?:z|x|y)\})[^}]*\}")


def approved_tile_template(tile_url: str | None) -> str:
    """The template `render_base` may fetch, or `""` when this server does not know the source.

    Empty rather than an exception on purpose: an unknown basemap prints a grey base under the
    drawings and symbols, which is what an unreachable tile CDN has always produced. Failing the
    whole Rapport would make the sheet nobody can redraw by hand hostage to a map style.
    """
    from .egress import EgressRefusedError, require_public_https

    url = (tile_url or "").strip()
    if not url:
        return ""
    try:
        # resolve=True: an approved/configured tile host that resolves INWARDS (a provider name
        # pointed at 10.x, or a malformed authority) is refused at validation time, not fetched
        # from the server's own network position (SEC-03, 05.09.).
        host = require_public_https(url, what="Kartenquelle", resolve=True)
    except EgressRefusedError as e:
        logger.warning("Kartenquelle abgelehnt (%s): %.120s", e, url)
        return ""
    if host not in _TILE_PROVIDER_HOSTS and host not in _extra_tile_hosts():
        logger.warning("Kartenquelle ist kein bekannter Kartenanbieter — grauer Kartenhintergrund: %.120s", url)
        return ""
    if _TILE_SLOTS_RE.search(url):
        logger.warning("Kartenquelle enthält unbekannte Platzhalter: %.120s", url)
        return ""
    # Any brace left after the three known slots (a lone `}` the slot regex cannot see, a
    # `{z}.png}`) makes `.format()` raise a ValueError in render_base — a 500 instead of the
    # intended neutral grey base (SEC-03, 05.09.). An unknown template renders grey, never 500.
    residual = url.replace("{z}", "").replace("{x}", "").replace("{y}", "")
    if "{" in residual or "}" in residual:
        logger.warning("Kartenquelle enthält unausgeglichene Klammern: %.120s", url)
        return ""
    return url


def _extra_tile_hosts() -> frozenset[str]:
    """Additional tile hosts this deployment's operator configured (REPORT_TILE_HOSTS)."""
    from .config import settings

    return frozenset(h.strip().lower() for h in settings.report_tile_hosts.split(",") if h.strip())


class TileCache:
    """Tiny on-disk tile cache — polite to the tile CDNs and fast for repeated renders.

    Bounded: once the directory holds more than `max_entries` files it drops the oldest half.
    Unbounded, it grew for the lifetime of the volume — one render of a wide view at z19 writes
    a few hundred files, and nothing ever removed one.
    """

    def __init__(self, cache_dir: Path, max_entries: int = MAX_CACHE_ENTRIES):
        self.dir = cache_dir
        self.max_entries = max_entries
        self.dir.mkdir(parents=True, exist_ok=True)

    def get(self, url: str) -> bytes | None:
        p = self.dir / hashlib.sha256(url.encode()).hexdigest()
        return p.read_bytes() if p.exists() else None

    def put(self, url: str, data: bytes) -> None:
        if len(data) > MAX_TILE_BYTES:
            return
        try:
            (self.dir / hashlib.sha256(url.encode()).hexdigest()).write_bytes(data)
        except OSError:  # a cache that cannot be written to must not fail a Rapport (see _prune)
            logger.warning("Tile konnte nicht zwischengespeichert werden", exc_info=True)
            return
        self._prune()

    def _prune(self) -> None:
        """Drop the oldest half once the cache is over its entry cap. Halving rather than
        trimming to the line keeps this off the hot path — one scan per few thousand writes."""
        try:
            entries = list(self.dir.iterdir())
            if len(entries) <= self.max_entries:
                return
            entries.sort(key=lambda p: p.stat().st_mtime)
            for p in entries[: len(entries) - self.max_entries // 2]:
                p.unlink(missing_ok=True)
        except OSError:  # a cache that cannot be pruned must not fail a Rapport
            logger.warning("Tile-Cache konnte nicht aufgeräumt werden", exc_info=True)


def _fetch_tile(client: httpx.Client, url: str) -> bytes | None:
    """One tile, with the response-byte cap enforced WHILE reading rather than after.

    A caller-named destination is gone (see `approved_tile_template`), but a provider that
    answers with an endless body would still be read into memory whole; the cap is what makes
    that a dropped tile instead of a dead container. Injected clients that are not real httpx
    clients (tests, in-process doubles) have no `stream` and take the plain path.
    """
    if not hasattr(client, "stream"):
        r = client.get(url)
        r.raise_for_status()
        return r.content if len(r.content) <= MAX_TILE_BYTES else None
    with client.stream("GET", url) as r:
        r.raise_for_status()
        ctype = r.headers.get("content-type", "")
        if ctype and not ctype.startswith("image/"):
            return None  # a tile is a picture; anything else is a body meant to be read
        if int(r.headers.get("content-length") or 0) > MAX_TILE_BYTES:
            return None
        buf = bytearray()
        for chunk in r.iter_bytes():
            buf += chunk
            if len(buf) > MAX_TILE_BYTES:
                return None
        return bytes(buf)


def render_base(
    view: View, tile_url: str, cache: TileCache | None = None, client: httpx.Client | None = None, max_tile_z: int = 19
) -> Image.Image:
    """Stitch the XYZ raster tiles covering the view. `tile_url` has {z}/{x}/{y} slots.
    Fractional view zoom: tiles come from ceil(z) (crisper than upscaling from floor)
    and the stitched canvas is resized down to the view's pixel size.

    ⚠️ `tile_url` must already have passed `approved_tile_template` — the caller-supplied value
    from a Rapport payload never arrives here unresolved (app/report). An empty template
    means «no approved basemap»: the neutral background is returned without a single request.
    """
    # The credential is the SERVER's, never the client's: strip whatever came in, apply ours,
    # and key the cache on the bare template (app/carto.py explains why both halves exist).
    fetch_tpl, cache_tpl = carto.for_fetch(tile_url)
    tz = min(max_tile_z, math.ceil(view.z))
    f = 2.0 ** (tz - view.z)  # tile-zoom px per view px (≥ 1)
    tw, th = math.ceil(view.width * f), math.ceil(view.height * f)
    x0, y0 = view.origin[0] * f, view.origin[1] * f
    img = Image.new("RGB", (tw, th), "#e8ecef")
    if not fetch_tpl:  # no approved basemap — the neutral canvas, and not one request made
        return img.resize((view.width, view.height), Image.Resampling.LANCZOS)
    own = client is None
    # ⚠️ `follow_redirects` stays off (httpx's default, pinned here because it is a control):
    # an approved provider answering «301 → 169.254.169.254» must not move the destination.
    client = client or httpx.Client(timeout=10, headers=_UA, follow_redirects=False)
    try:
        n = 2**tz
        tx0, ty0 = int(x0 // TILE), int(y0 // TILE)
        tx1, ty1 = int((x0 + tw) // TILE), int((y0 + th) // TILE)
        coords = [(tx, ty) for tx in range(tx0, tx1 + 1) for ty in range(ty0, ty1 + 1) if 0 <= ty < n]

        def fetch(txy: tuple[int, int]) -> tuple[int, int, bytes | None]:
            tx, ty = txy
            slots = {"z": tz, "x": tx % n, "y": ty}
            cache_url = cache_tpl.format(**slots)
            data = cache.get(cache_url) if cache else None
            if data is None:
                try:
                    data = _fetch_tile(client, fetch_tpl.format(**slots))
                    if data and cache:
                        cache.put(cache_url, data)
                except httpx.HTTPError:
                    return tx, ty, None  # missing tile → keep the neutral background
            return tx, ty, data

        from concurrent.futures import ThreadPoolExecutor

        with ThreadPoolExecutor(max_workers=8) as ex:
            for tx, ty, data in ex.map(fetch, coords):
                if data is None:
                    continue
                try:
                    tile = Image.open(io.BytesIO(data)).convert("RGB")
                except Exception:  # noqa: BLE001, S112 — one corrupt tile must not sink the map
                    continue
                img.paste(tile, (int(tx * TILE - x0), int(ty * TILE - y0)))
    finally:
        if own:
            client.close()
    return (
        img.resize((view.width, view.height), Image.Resampling.LANCZOS)
        if (tw, th) != (view.width, view.height)
        else img
    )


# ----------------------------------------------------------------------------- symbols


#: A CSS `url(...)` reference (gradients, patterns, `@import`) inside an attribute value or a
#: `<style>` body. Quote-aware; the value may also be unquoted, as `url(#id)` and `url(data:…)`
#: are. This one stays a regex on purpose: a url() lives WITHIN a value the XML parser hands
#: back already unescaped, so there is no markup left to misparse — the SEC-07 trap was parsing
#: the SVG's element/attribute structure with a regex, not scanning a single decoded string.
_CSS_URL_RE = re.compile(r"""url\(\s*(?:"(?P<ud>[^"]*)"|'(?P<us>[^']*)'|(?P<uu>[^)"'\s]*))\s*\)""", re.IGNORECASE)
#: A DTD / entity declaration — the XXE half of an SVG parser. Stripped before the parse so
#: expat cannot expand an internal entity whose value smuggles a `file://` reference.
_DOCTYPE_RE = re.compile(r"<!DOCTYPE[^>[]*(\[[^\]]*\])?[^>]*>|<!ENTITY[^>]*>", re.IGNORECASE)
#: An inline event handler (`onload`, `onclick`, …) — a scripting hook, stripped wherever it sits.
_ON_ATTR_RE = re.compile(r"^on\w+$", re.IGNORECASE)

_SVG_NS = "http://www.w3.org/2000/svg"
_XLINK_NS = "http://www.w3.org/1999/xlink"
#: Re-serialise with the conventional prefixes resvg expects, not ElementTree's auto ns0:/ns1:.
ElementTree.register_namespace("", _SVG_NS)
ElementTree.register_namespace("xlink", _XLINK_NS)
#: What a malformed SVG becomes: a valid, empty document that rasterises to a transparent box.
_EMPTY_SVG = f'<svg xmlns="{_SVG_NS}"/>'


def _local_ref(value: str) -> bool:
    """A reference the renderer can satisfy WITHOUT leaving this process: a fragment («#g»,
    for the defs the SVG carries itself) or an inline `data:` payload (how an SVG brandmark
    carries its raster half). A path, a `file://` and an http(s) URL are all somebody asking
    this server to go and read something."""
    v = value.strip()
    return v.startswith("#") or v.lower().startswith("data:")


def _local_name(tag: str) -> str:
    """The element/attribute local name without ElementTree's `{namespace}` prefix."""
    return tag.rsplit("}", 1)[-1]


def sanitize_svg(svg: str) -> str:
    """Strip every external-resource reference from an SVG before it reaches the rasteriser.

    ⚠️ resvg resolves `<image href="…">` against the FILESYSTEM. A client-resolved glyph
    (`symbolSvg` — dynamic vehicles, placards, composed Hubretter artwork) is caller-authored
    text, so without this a Rapport could name any image file the container can read and get it
    printed into the PDF (SEC-07, 05.09.). Applied to every SVG this module rasterises, not just
    the client's: the pack's own artwork and the sheets' generated overlays reference nothing
    external, so the scrub is a no-op on them and there is no second path to forget.

    ⚠️ PARSE, don't regex. A quote-aware regex still cannot tell a real `href` from one PLANTED
    inside another attribute («data-note="href='#"») — it starts on the decoy, runs across the
    genuine local-file `href`, and keeps the whole span because the captured value opens with a
    «#» (SEC-07 round 2, 05.09.). Only a parser knows which text is an attribute and which is a
    value. We walk the tree with the stdlib `xml.etree.ElementTree` (expat) and drop, per element:
    `<script>`/`<foreignObject>`, `on*` event handlers, non-local `href`/`xlink:href`, and every
    non-local `url(...)` in a presentation attribute or `<style>` body. Comments/PIs are dropped
    by the default parser; the DTD is stripped first so no entity survives to be expanded.

    Scrubbed rather than rejected — a Rapport that loses one decorative reference still prints,
    and every glyph the app actually produces (paths, text, fills, its own `#defs`) is untouched.
    On a parse error the result is a valid empty SVG: the raster path must not raise (SEC-01).
    """
    text = _DOCTYPE_RE.sub("", svg)
    # ElementTree rejects an undeclared prefix, but SVGs in the wild — and glyphs the client
    # composes — use `xlink:href` without declaring `xmlns:xlink`, and resvg renders them anyway.
    # Inject the declaration lexically so the parse can proceed. This is a namespace fixup on the
    # first tag, not an attempt to read the SVG's structure — which is the part a regex got wrong.
    if "xlink:" in text and "xmlns:xlink" not in text:
        text = re.sub(r"<\s*([A-Za-z][\w.\-]*)", rf'<\1 xmlns:xlink="{_XLINK_NS}"', text, count=1)
    try:
        # The XML attacks the linter warns about here are already closed: the DTD/entity subset
        # is stripped above (no internal-entity expansion, so no billion-laughs), and expat fetches
        # no external DTD or entity on its own. stdlib is a hard constraint (no defusedxml).
        root = ElementTree.fromstring(text)  # noqa: S314
    except ElementTree.ParseError:
        return _EMPTY_SVG
    _scrub_element(root)
    try:
        return ElementTree.tostring(root, encoding="unicode")
    except (TypeError, ValueError):  # a tree ElementTree cannot re-serialise must still not raise
        return _EMPTY_SVG


def _scrub_element(elem: ElementTree.Element) -> None:
    """Depth-first scrub of one element: strip scripting and external references in place, and
    remove `<script>`/`<foreignObject>` children entirely (recursing into the rest)."""
    for name in list(elem.attrib):
        local = _local_name(name)
        value = elem.attrib[name]
        if _ON_ATTR_RE.match(local):
            del elem.attrib[name]  # onload/onclick/… — a scripting hook has no place in a glyph
        elif local == "href":  # bare `href` or `{xlink}href` — resvg reads both off the filesystem
            if not _local_ref(value):
                elem.attrib[name] = ""
        elif "url(" in value.lower():
            # fill/stroke/filter/mask/clip-path/marker-*/style may all carry a url(); keep the
            # local ones (a gradient's `url(#id)`) and neutralise anything that would fetch.
            elem.attrib[name] = _scrub_css(value)
    if _local_name(elem.tag) == "style" and elem.text:
        elem.text = _scrub_css(elem.text)
    for child in list(elem):
        if _local_name(child.tag) in ("script", "foreignObject"):
            elem.remove(child)
        else:
            _scrub_element(child)


def _scrub_css(css: str) -> str:
    """Neutralise every non-local `url(...)` in a CSS fragment (a presentation attribute or a
    `<style>` body). A `url(#id)` / `data:image/…` reference stays; everything else becomes
    `none`, so a gradient survives but an `@import`/background fetch does not."""
    return _CSS_URL_RE.sub(lambda m: m.group(0) if _local_ref(_group(m, "ud", "us", "uu")) else "none", css)


def _group(m: re.Match[str], *names: str) -> str:
    """The first of the alternation's named groups that actually matched — the quote-aware
    `_CSS_URL_RE` captures its value under one of three names depending on the quoting."""
    return next((v for n in names if (v := m.group(n)) is not None), "")


# Native-raster pixel budget. Every native raster allocates one RGBA buffer of width·height —
# resvg for the try path below, PIL for the fallback. A caller-controlled dimension flows in
# unbounded: a plan annotation's `sizeN` is scaled by the page width (`_overlay_board_annos`),
# so `sizeN:10` on a 3200 px page asks resvg for 32000×32000 ≈ 4 GB — a one-request
# memory-exhaustion DoS of the single service every command tablet shares. No legitimate report
# raster comes near this: the widest is the ~4160 px kroki canvas, the tallest the ~12800 px
# aspect-4 blank plan (whose base is built directly, not here). Cap every edge well above the
# largest legitimate size and far below the exhaustion range; the square render at max(w, h) is
# then bounded to _RASTER_MAX_EDGE² ≈ 268 MB, and an over-budget request degrades to the clamped
# size rather than allocating gigabytes or 500-ing the whole Rapport.
_RASTER_MAX_EDGE = 8192


def _clamp_raster_edge(px: int) -> int:
    """Bound a raster edge to the native-render pixel budget (see _RASTER_MAX_EDGE)."""
    return max(1, min(int(px), _RASTER_MAX_EDGE))


def raster_svg(svg: str, size_px: int, height_px: int | None = None) -> Image.Image:
    """Rasterise an SVG string to an RGBA image (resvg — same renderer for pack
    symbols and the client-resolved dynamic glyphs like vehicles/placards). Every string goes
    through `sanitize_svg` first — the client-resolved half is caller-authored text, and resvg
    reads image references off the filesystem.
    Square by default; `height_px` stretches it (generic shapes with an `aspect`). resvg
    itself keeps the SVG's intrinsic ratio whatever target box it is given, so the stretch
    is done as a PIL resize of a square render at the LARGER side — never an upscale, and
    anisotropic exactly like the client's preserveAspectRatio="none" CSS box.

    The pack's letters use `font-family="Arial,sans-serif"`. The Linux container has no
    Arial, and resvg's built-in generic-family defaults don't exist there either — the
    letters silently VANISH (empty blue boxes on the prod Kroki). Pin every generic
    family to DejaVu Sans (fonts-dejavu-core, see Dockerfile); on macOS dev Arial matches
    first, so the pin is inert there."""
    import resvg_py

    # Clamp both edges before anything allocates: the native call, the exception fallback and
    # the final resize all read these, so no path escapes the budget (see _RASTER_MAX_EDGE).
    h = _clamp_raster_edge(height_px or size_px)
    size_px = _clamp_raster_edge(size_px)
    s = max(size_px, h)
    try:
        png = bytes(
            resvg_py.svg_to_bytes(
                svg_string=sanitize_svg(svg),
                width=s,
                height=s,
                font_family="DejaVu Sans",
                sans_serif_family="DejaVu Sans",
                serif_family="DejaVu Serif",
                monospace_family="DejaVu Sans Mono",
            )
        )
        img = Image.open(io.BytesIO(png)).convert("RGBA")
    except Exception:  # noqa: BLE001
        # ⚠️ A client-resolved `symbolSvg` (vehicles, placards, composed artwork) is caller-authored
        # text, and this rasteriser feeds the whole-incident Rapport. A glyph resvg refuses to parse
        # — an unquoted href, a DOCTYPE whose entity value carries a «]», a duplicate attribute — must
        # become an empty box, never a 500 for everyone on the incident (SEC-01, 05.09.). The pack's
        # own artwork is static and tested, so this only ever fires on hostile input.
        logger.warning("SVG konnte nicht gerastert werden — leeres Symbol", exc_info=True)
        return Image.new("RGBA", (size_px, h), (0, 0, 0, 0))
    if (size_px, h) != (s, s):
        img = img.resize((size_px, h), Image.Resampling.LANCZOS)
    return img


class SymbolPack:
    """The client's own tactical-symbol pack (name → SVG), rasterised on demand."""

    def __init__(self, pack_path: Path):
        data = json.loads(pack_path.read_text())
        self.by_name: dict[str, str] = {s["name"]: s["svg"] for s in data["symbols"]}
        self._raster: dict[tuple[str, int], Image.Image | None] = {}

    def raster(self, name: str, size_px: int) -> Image.Image | None:
        key = (name, size_px)
        if key not in self._raster:
            svg = self.by_name.get(name)
            self._raster[key] = raster_svg(svg, size_px) if svg else None
        return self._raster[key]


def default_pack_path() -> Path | None:
    """The tactical-symbol pack as deployed: the built SPA copy (dist) in production,
    the repo's public/ next to the backend in dev. Env override for exotic setups."""
    import os

    here = Path(__file__).resolve().parent  # backend/app
    candidates = [
        Path(p) if (p := os.environ.get("KP_SYMBOLS_PACK")) else None,
        here.parent / "dist" / "tactical-symbols.json",  # container: dist copied next to app
        here.parent.parent / "dist" / "tactical-symbols.json",  # repo build
        here.parent.parent / "public" / "tactical-symbols.json",  # repo dev
    ]
    for c in candidates:
        if c and c.exists():
            return c
    return None


_PACK: SymbolPack | None = None
_TILE_CACHE: TileCache | None = None


def get_pack() -> SymbolPack | None:
    global _PACK
    if _PACK is None:
        p = default_pack_path()
        _PACK = SymbolPack(p) if p else None
    return _PACK


def get_tile_cache() -> TileCache:
    """Process-wide tile cache next to the media storage (persists across renders)."""
    global _TILE_CACHE
    if _TILE_CACHE is None:
        from .config import settings

        _TILE_CACHE = TileCache(Path(settings.media_storage_dir) / "tilecache")
    return _TILE_CACHE


# ----------------------------------------------------------------------------- symbol decor

# the client's own accent-colour pick (symbolRender.tsx symColor): first non-black
# fill/stroke, else the app blue; black is the glyph outline
_COLOR_RE = __import__("re").compile(r'(?:fill|stroke)="(#[0-9a-fA-F]{6})"')


def sym_color(svg: str) -> str:
    for c in _COLOR_RE.findall(svg):
        if c.lower() != "#000000":
            return c
    return "#1f6feb"


def needs_white(svg: str) -> bool:
    """Outline symbols (KP Front, hydrants, …) get a white legibility chip behind them."""
    return 'fill="none"' in svg


def floor_badge(f: int) -> str:
    return f"+{f}" if f > 0 else str(f)


# FKS Entwicklung block arrow (symbolRender.tsx BLOCK_ARROW), hollow, in the symbol colour
_BLOCK_ARROW = "M42 30 L42 20 L34 20 L50 8 L66 20 L58 20 L58 30 Z"


# Degrees to rotate the up-pointing arrow onto each edge (symbolRender.tsx SPREAD_DEG).
_SPREAD_DEG = {"up": 0, "right": 90, "down": 180, "left": 270}


def _spread_dirs(spread: dict) -> dict[str, bool]:
    """Which arrows are set and which of them carry their Entwicklungsgrenze bar.

    ⚠️ Mirrors `normalizeSpread` in `src/lib/spread.ts`, and must keep mirroring it: the printed
    Kroki is rendered here from the SAME workspace blob the client draws from, so a field one
    side understands and the other does not is paper that stops matching the screen.

    Two shapes live in stored incidents. Until 2026-08 horizontal spread was one exclusive
    `h: 'E' | 'W'` with a single `hBounded`, and `up`/`down` shared one `vBounded`; the blob is
    never migrated in place, so every archived Rapport still reprints from that. Now each of the
    four directions is independent and carries its own bar.
    """
    out: dict[str, bool] = {}
    legacy_h = spread.get("h")
    for d in ("left", "right", "up", "down"):
        on = bool(spread.get(d))
        if d == "left" and legacy_h == "W":
            on = True
        if d == "right" and legacy_h == "E":
            on = True
        if not on:
            continue
        bounded = bool(spread.get(f"{d}Bounded"))
        if d in ("left", "right") and legacy_h == {"left": "W", "right": "E"}[d]:
            bounded = bounded or bool(spread.get("hBounded"))
        if d in ("up", "down") and f"{d}Bounded" not in spread:
            bounded = bounded or bool(spread.get("vBounded"))
        out[d] = bounded
    return out


#: A colour a client may have written — the mirror of ``_COLOR_RE`` in app/schemas.py, which
#: scrubs the same field on the way into a workspace (SEC-01). Hex, an rgb()/hsl() function or
#: a CSS keyword; nothing that could close an attribute.
_SAFE_COLOR_RE = re.compile(
    r"^#(?:[0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})$|^(?:rgb|hsl)a?\([\d\s.,%/+-]*\)$|^[a-z]{3,20}$",
    re.IGNORECASE,
)

#: The app blue, and the ink anything unrecognisable falls back to (client symbolRender).
_DEFAULT_INK = "#1f6feb"


def _safe_color(color: str | None) -> str:
    """A colour that may be interpolated into an SVG attribute.

    The Rapport payload carries its own copy of every drawing's colour and does NOT pass through
    the workspace scrub, so the string arrives here caller-authored. Substituted, never rejected:
    a hostile colour has nothing to say, and the object still has to print.
    """
    c = (color or "").strip()
    return c if _SAFE_COLOR_RE.match(c) else _DEFAULT_INK


def spread_overlay_svg(spread: dict, color: str) -> str:
    """The SpreadArrows overlay as one SVG (same paths/rotations as the client)."""
    color = _safe_color(color)

    def arrow(deg: int, bounded: bool) -> str:
        bar = '<rect x="33" y="1" width="34" height="6" rx="1.5" stroke-width="3"/>' if bounded else ""
        return (
            f'<g transform="rotate({deg} 50 50)" fill="#fff" stroke="{color}" '
            f'stroke-width="3.5" stroke-linejoin="round"><path d="{_BLOCK_ARROW}"/>{bar}</g>'
        )

    dirs = _spread_dirs(spread)
    # drawn in the client's order (up, down, right, left) so the two SVGs stay diffable
    parts = [arrow(_SPREAD_DEG[d], dirs[d]) for d in ("up", "down", "right", "left") if d in dirs]
    return f'<svg viewBox="0 0 100 100" xmlns="http://www.w3.org/2000/svg">{"".join(parts)}</svg>'


def _badge(draw: ImageDraw.ImageDraw, xy: tuple[float, float], text: str, h: float, bg: str, fg: str) -> None:
    """A small rounded chip (floor / count badge), centred on xy."""
    f = _font(int(h * 0.72))
    w = max(h, draw.textlength(text, font=f) + h * 0.5)
    x, y = xy
    draw.rounded_rectangle(
        [x - w / 2, y - h / 2, x + w / 2, y + h / 2],
        radius=h * 0.3,
        fill=bg,
        outline="#d4dae3" if bg == "white" else None,
        width=1,
    )
    draw.text((x, y - h * 0.04), text, font=f, fill=fg, anchor="mm")


#: «Gelöscht / erledigt» on paper — the client's `--done-filter: grayscale(1)` and
#: `--done-opacity: .5` (src/styles/01-tokens.css), so a symbol reads as over on the sheet exactly
#: as it does on both screens. Keep the two in step.
DONE_ALPHA = 0.5


def _greyed(img: Image.Image) -> Image.Image:
    """The glyph as a done symbol prints it: desaturated, at `DONE_ALPHA` of its own alpha."""
    alpha = img.getchannel("A").point(lambda a: int(a * DONE_ALPHA))
    grey = img.convert("LA").convert("RGBA")
    grey.putalpha(alpha)
    return grey


def _place_symbol(
    overlay: Image.Image,
    draw: ImageDraw.ImageDraw,
    svg: str,
    xy: tuple[float, float],
    size: int,
    rotation: float | None,
    spread: dict | None,
    height: int | None = None,
    done: bool = False,
) -> None:
    """Paint one tactical glyph with the decor that belongs to the glyph itself: the FKS
    Entwicklung arrows outside it (client `.sym-spread`, a 250% box), the white legibility chip
    behind outline symbols, then the rotated glyph on top.

    Shared by the Kroki and the plan pages — a symbol carries the same decor wherever it was
    placed, which is also what the two screens show. `height` stretches the glyph box
    (generic shapes with an `aspect`); symbols stay square.

    `done` («Gelöscht / erledigt», client lib/objectDone): glyph, arrows and chip go grey — the
    symbol STAYS on the record, it only recedes. Its badges keep full ink (`_symbol_badges`).
    """
    x, y = xy
    h = height or size
    glyph = raster_svg(svg, size, h)
    if spread:
        osize = int(size * 2.5)
        oimg = raster_svg(spread_overlay_svg(spread, sym_color(svg)), osize)
        overlay.alpha_composite(_greyed(oimg) if done else oimg, (int(x - osize / 2), int(y - osize / 2)))
    if needs_white(svg):
        draw.rounded_rectangle(
            [x - size / 2, y - h / 2, x + size / 2, y + h / 2],
            radius=min(size, h) * 0.14,
            fill=(255, 255, 255, int(235 * DONE_ALPHA) if done else 235),
        )
    if done:
        glyph = _greyed(glyph)
    if rotation:
        glyph = glyph.rotate(-rotation, expand=True, resample=Image.Resampling.BICUBIC)
    overlay.alpha_composite(glyph, (int(x - glyph.width / 2), int(y - glyph.height / 2)))


def _symbol_badges(
    draw: ImageDraw.ImageDraw,
    xy: tuple[float, float],
    size: float,
    u: float,
    storey: int | None,
    floor_from: int | None,
    floor_to: int | None,
    count: int | None,
    done: str | None = None,
) -> None:
    """Storey badge top-right, count badge bottom-right — both a WHITE chip with ink text (the
    client's `.sym-floor` / `.sym-count`) — and, on a symbol marked «Gelöscht / erledigt», its
    HH:MM top-LEFT (the client's `.sym-done`), in the same chip, the dimmer ink the screen uses.

    ⚠️ On screen the count is an INK chip. Not on paper (18.09.2026): since every symbol carries a
    numbered legend disc, a dark «2» in the glyph's corner read as a second legend number right
    beside the dark ❷ under it. The discs are the only dark marks on the sheet; the two badges
    stay apart by corner and by sign (a storey is «+2» / «0» / «-1», a count is bare). `u` is the sheet's px-per-unit factor (u · ss).

    The storey is a single value or a von/bis RANGE (stairs, lift). On the Kroki it comes from
    the entity's `floor`, on a plan page from the anno's `storey` — two names because on a plan
    `floor` is already the floor-stack's tile index (see types.ts · BoardAnno).

    ⚠️ The storey was once printed in the SYMBOL's colour, which is the one legibility this
    chip exists to provide: a yellow symbol's «+1» came out yellow on white — on paper, where
    nobody can zoom in.
    """
    x, y = xy
    bh = max(16.0 * u / 2, size * 0.46)
    fnt = _font(int(bh * 0.72))
    #: where the storey chip's LEFT edge lands, so the «erledigt» time below can keep clear of it
    storey_left: float | None = None
    storey_text: str | None = None
    if storey is not None:
        storey_text = floor_badge(storey)
    elif floor_from is not None or floor_to is not None:
        # a single storey said as a span (Von = Bis, the Gebäude's default) is ONE value — the
        # client's floorRangeBadge says «0», and «0/0» on paper read as two storeys
        ends = [v for v in (floor_from, floor_to) if v is not None]
        storey_text = floor_badge(ends[0]) if len(set(ends)) == 1 else "/".join(floor_badge(v) for v in ends)
    if storey_text is not None:
        _badge(draw, (x + size / 2, y - size / 2), storey_text, bh, "white", "#1b2330")
        storey_left = x + size / 2 - max(bh, draw.textlength(storey_text, font=fnt) + bh * 0.5) / 2
    if (count or 0) > 1:
        _badge(draw, (x + size / 2, y + size / 2), str(count), bh, "white", "#1b2330")
    if done:
        # anchored by its RIGHT edge a little inside the glyph's left side, so a wide «20:40» grows
        # OUTWARDS, away from the storey badge — and never closer to that badge than a quarter
        # chip: on a Modul page's small glyph a «-1/+3» reaches back past the left edge (the same
        # width `_badge` computes)
        w = max(bh, draw.textlength(done, font=fnt) + bh * 0.5)
        right = x - size / 2 + bh * 0.9
        if storey_left is not None:
            right = min(right, storey_left - bh * 0.25)
        _badge(draw, (right - w / 2, y - size / 2), done, bh, "white", "#4a5568")


def _caption(draw: ImageDraw.ImageDraw, xy: tuple[float, float], lines: list[str], fs: int) -> None:
    """White caption chip under a glyph — the map's .sym-caption (bold, stacked lines)."""
    f = _font(fs)
    lh = fs * 1.25
    bw = max(draw.textlength(t, font=f) for t in lines)
    bh = lh * len(lines)
    pad = fs * 0.4
    x, y = xy  # top-centre of the chip
    draw.rounded_rectangle(
        [x - bw / 2 - pad, y, x + bw / 2 + pad, y + bh + pad],
        radius=max(2, fs // 4),
        fill=(255, 255, 255, 240),
        outline="#d4dae3",
        width=1,
    )
    for i, t in enumerate(lines):
        draw.text((x, y + pad / 2 + lh * (i + 0.5)), t, font=f, fill="#1b2330", anchor="mm")


# ----------------------------------------------------------------------------- line decor


def _fork_dims(width: float) -> tuple[float, float]:
    """(half, prong) of the Teilstück fork for a stroke `width`, in the same px the width is in —
    the ONE definition the drawn glyph and the branch ports share (client lib/lineAttachments ·
    forkDims plays the same role on screen). Slightly longer + thinner than the on-screen fork so
    the E reads crisply on paper."""
    half = max(10.0, width * 2.1)
    return half, half * 1.25


def _fork_bearing(pts: list[tuple[float, float]], width: float) -> tuple[float, float]:
    """Forward unit vector at the line's tip — the direction the fork opens in."""
    tip = pts[-1]
    back = _lookback(pts, max(10.0, width * 2.5))
    dx, dy = tip[0] - back[0], tip[1] - back[1]
    n = math.hypot(dx, dy) or 1.0
    return dx / n, dy / n


def _teilstueck_fork(overlay: Image.Image, pts: list[tuple[float, float]], color: str, width: int) -> None:
    """The forward «E»-fork Teilstück coupling at the line tip — the client's
    TeilstueckFork SVG (round caps, clean joins) rasterised via resvg and composited
    at the tip; PIL's fat butt-capped strokes turned into blobs."""
    color = _safe_color(color)
    tip = pts[-1]
    fx, fy = _fork_bearing(pts, width)
    ang = math.degrees(math.atan2(fy, fx))
    half, prong = _fork_dims(width)
    sw = max(2.0, width * 0.55)
    box = (half + prong) * 2 + 8
    svg = (
        f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="{-box / 2} {-box / 2} {box} {box}">'
        f'<g transform="rotate({ang})" stroke="{color}" stroke-width="{sw}" '
        f'stroke-linecap="round" fill="none">'
        f'<path d="M0,{-half} L0,{half}"/>'
        f'<path d="M0,{-half} L{prong},{-half}"/>'
        f'<path d="M0,0 L{prong},0"/>'
        f'<path d="M0,{half} L{prong},{half}"/>'
        f"</g></svg>"
    )
    size = round(box)
    fork = raster_svg(svg, size)
    overlay.alpha_composite(fork, (int(tip[0] - size / 2), int(tip[1] - size / 2)))


def _end_tag(
    draw: ImageDraw.ImageDraw,
    pts: list[tuple[float, float]],
    parts: list[str],
    color: str,
    fs: int,
    line_w: float = 0,
    bounds: tuple[int, int] | None = None,
) -> None:
    """Boxed tag BESIDE the line near its tip (72 % along the last segment): «1 · S · +2».

    ⚠️ It used to sit ON the line, and its box is opaque — so it covered the last quarter of the
    very Leitung it names. On paper the line appeared to stop dead at the tag, and the Teilstück
    fork beyond it read as a second, unattached mark; a reader could not tell which line the tag
    belonged to where two ran close. It is pushed clear along the segment's normal now, far
    enough that the stroke and the box never touch, so the geometry stays one continuous line
    and the words sit next to it the way a hand-drawn Kroki labels a hose.

    Which side: away from the polyline's own centre of mass, so a hose that loops back gets its
    tag on the outside rather than inside its own bend. `bounds` (the overlay size) keeps a tag
    near the sheet edge from being pushed half off it — a tag that is cut off says nothing.
    """
    a, b = pts[-2], pts[-1]
    x, y = a[0] + (b[0] - a[0]) * 0.72, a[1] + (b[1] - a[1]) * 0.72
    text = " · ".join(parts)
    f = _font(fs)
    tw = draw.textlength(text, font=f)
    pad = fs * 0.4
    half_w, half_h = tw / 2 + pad, fs * 0.8 + pad / 2
    dx, dy = b[0] - a[0], b[1] - a[1]
    seg = math.hypot(dx, dy) or 1.0
    nx, ny = -dy / seg, dx / seg
    cx = sum(p[0] for p in pts) / len(pts)
    cy = sum(p[1] for p in pts) / len(pts)
    if nx * (x - cx) + ny * (y - cy) < 0:  # normal points back into the line — take the other one
        nx, ny = -nx, -ny
    # how far the BOX reaches in that direction (support function of an axis-aligned rectangle),
    # plus half the stroke and a hair of air. Offsetting by half the height alone would leave a
    # wide tag lying across a vertical line.
    off = abs(nx) * half_w + abs(ny) * half_h + line_w / 2 + fs * 0.45
    x, y = x + nx * off, y + ny * off
    if bounds:
        x = min(max(x, half_w + 2), bounds[0] - half_w - 2)
        y = min(max(y, half_h + 2), bounds[1] - half_h - 2)
    draw.rounded_rectangle(
        [x - half_w, y - half_h, x + half_w, y + half_h],
        radius=max(2, fs // 4),
        fill=(255, 255, 255, 240),
        outline=color,
        width=max(1, fs // 7),
    )
    draw.text((x, y), text, font=f, fill=color, anchor="mm")


# ----------------------------------------------------------------------------- drawing


def _font(size: int) -> ImageFont.FreeTypeFont:
    # macOS' Helvetica.ttc throws division-by-zero below 8pt (bitmap-strike quirk); a
    # sub-8px label is unreadable on paper anyway, so floor instead of special-casing
    size = max(8, int(size))
    for cand in (
        "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf",  # container
        "/System/Library/Fonts/Helvetica.ttc",  # macOS dev
        "/Library/Fonts/Arial.ttf",
    ):
        try:
            return ImageFont.truetype(cand, size)
        except OSError:
            continue
    return ImageFont.load_default()  # type: ignore[return-value]


def _dashed(
    draw: ImageDraw.ImageDraw, pts: list[tuple[float, float]], color: str, width: int, dash: float = 14, gap: float = 10
) -> None:
    """PIL has no dash pattern — walk the polyline and emit dash segments, keeping the
    dash phase continuous across vertices."""
    period = dash + gap
    dist = 0.0  # cumulative length along the polyline
    for (x1, y1), (x2, y2) in itertools.pairwise(pts):
        seg = math.hypot(x2 - x1, y2 - y1)
        if seg == 0:
            continue
        ux, uy = (x2 - x1) / seg, (y2 - y1) / seg
        t = 0.0
        while t < seg:
            phase = (dist + t) % period
            if phase < dash:
                step = min(dash - phase, seg - t)
                draw.line(
                    [(x1 + ux * t, y1 + uy * t), (x1 + ux * (t + step), y1 + uy * (t + step))], fill=color, width=width
                )
            else:
                step = min(period - phase, seg - t)
            t += max(step, 0.05)  # epsilon floor — a phase landing exactly on a boundary must still advance
        dist += seg


def _lookback(pts: list[tuple[float, float]], dist: float) -> tuple[float, float]:
    """Point `dist` px back from the END — stable arrowhead bearing (client lookbackPoint)."""
    acc = 0.0
    for i in range(len(pts) - 1, 0, -1):
        a, b = pts[i], pts[i - 1]
        seg = math.hypot(a[0] - b[0], a[1] - b[1])
        if seg > 0 and acc + seg >= dist:
            t = (dist - acc) / seg
            return (a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t)
        acc += seg
    return pts[0]


def _arrow_head(
    draw: ImageDraw.ImageDraw, pts: list[tuple[float, float]], color: str, width: int, stop: bool = False
) -> None:
    """Filled triangle terminating the line: its BASE sits on the last vertex and the tip
    extends beyond it, so the stroke visibly ends in the arrow (not under it). ``stop`` adds
    the Entwicklungsgrenze bar just past the tip — the same statement the fire's bounded
    spread arrow prints, on a line (client Drawing.arrowStop)."""
    end = pts[-1]
    back = _lookback(pts, max(12.0, width * 3.5))
    ang = math.atan2(end[1] - back[1], end[0] - back[0])
    ln, half = max(12.0, width * 3.2), max(6.0, width * 1.7)
    tip = (end[0] + ln * math.cos(ang), end[1] + ln * math.sin(ang))
    nx, ny = -math.sin(ang), math.cos(ang)
    draw.polygon([tip, (end[0] + half * nx, end[1] + half * ny), (end[0] - half * nx, end[1] - half * ny)], fill=color)
    if stop:
        gap = max(3.0, width * 0.8)
        bar = max(7.0, half * 1.3)
        bx, by = tip[0] + gap * math.cos(ang), tip[1] + gap * math.sin(ang)
        draw.line(
            [(bx + bar * nx, by + bar * ny), (bx - bar * nx, by - bar * ny)],
            fill=color,
            width=max(3, round(width * 0.9)),
        )


# ⚠️ MIRRORS src/lib/draw.tsx · HATCH_PERIOD_PX / HATCH_WIDTH_PX. The FKS draws an affected AREA
# hatched rather than washed (Brandzone/Flächenbrand); screen and paper have to agree about which
# Fläche is which, so the geometry is one set of numbers copied here on purpose.
_HATCH_PERIOD = 16
_HATCH_WIDTH = 1.6


def _hatch_polygon(overlay: Image.Image, pts: list[tuple[float, float]], color: str, scale: float) -> None:
    """Rule 45° lines through a polygon — the print's half of the Schraffur.

    Drawn onto a scratch layer and pasted through the polygon as its own mask, because PIL has no
    clip region: ruling the lines straight onto the overlay would hatch the whole bounding box.
    """
    if len(pts) < 3:
        return
    xs = [p[0] for p in pts]
    ys = [p[1] for p in pts]
    x0, y0 = int(min(xs)) - 2, int(min(ys)) - 2
    x1, y1 = int(max(xs)) + 2, int(max(ys)) + 2
    w, h = max(1, x1 - x0), max(1, y1 - y0)
    period = max(3.0, _HATCH_PERIOD * scale)
    lines = Image.new("RGBA", (w, h), (0, 0, 0, 0))
    ld = ImageDraw.Draw(lines)
    step = period * math.sqrt(2)  # spacing measured along the axis, for 45° lines
    c = float(-h)
    while c <= w + h:
        ld.line([(c, 0), (c + h, h)], fill=color, width=max(1, round(_HATCH_WIDTH * scale)))
        c += step
    mask = Image.new("L", (w, h), 0)
    ImageDraw.Draw(mask).polygon([(x - x0, y - y0) for x, y in pts], fill=255)
    # the lines' own alpha TIMES the polygon mask = the lines, clipped to the shape
    lines.putalpha(ImageChops.multiply(lines.getchannel("A"), mask))
    overlay.alpha_composite(lines, (x0, y0))


def _marker_points(pts: list[tuple[float, float]], spacing: float) -> list[tuple[float, float, float]]:
    """Positions for a repeated inline marker, every `spacing` px along the polyline, starting
    half a step in (client markerParamsAlong). Returns (x, y, degrees-of-this-segment) — the
    bearing is what lets a chain glyph stand ON the line the way the client draws it."""
    out: list[tuple[float, float, float]] = []
    carry = spacing / 2
    for i in range(1, len(pts)):
        (ax, ay), (bx, by) = pts[i - 1], pts[i]
        seg = math.hypot(bx - ax, by - ay)
        if seg < 1e-3:
            continue
        deg = math.degrees(math.atan2(by - ay, bx - ax))
        while carry <= seg:
            t = carry / seg
            out.append((ax + (bx - ax) * t, ay + (by - ay) * t, deg))
            carry += spacing
        carry -= seg
    return out


# ── FKS chain markers ────────────────────────────────────────────────────────────────────────
# ⚠️ MIRRORS src/lib/lineStyle.ts · MARKER_GLYPHS. A Haltelinie drawn on the tablet and the same
# Haltelinie on the printed Kroki have to be the same picture — the screen/paper split is exactly
# the bug the stale symbol dataset caused (01.09.), and it is not worth repeating for lines.
# Keyed by the character the client stores, sizes as fractions of the client's screen px so the
# print's own scale factor carries through.
_CHAIN_GLYPHS: dict[str, dict] = {
    "▲": {"size": 30, "spacing": 15, "fill": True, "rotate": True},
    "▼": {"size": 30, "spacing": 15, "fill": True, "rotate": True},
    "◯": {"size": 29, "spacing": 28, "fill": False, "rotate": False},
}


def _chain_marker(
    overlay: Image.Image, xy: tuple[float, float], marker: str, deg: float, size: int, color: str
) -> None:
    """One chain glyph, rasterised from the SAME path the client draws and pasted rotated."""
    color = _safe_color(color)
    g = _CHAIN_GLYPHS[marker]
    # ⚠️ The triangle's BASE sits at y=0, not its centre — rotated by the segment bearing that
    # puts the base ON the line, teeth to one side, line still visible (mirrors lineStyle.ts).
    path = {
        "▲": "M -0.62 0 L 0 -1.05 L 0.62 0 Z",
        "▼": "M -0.62 0 L 0 1.05 L 0.62 0 Z",
    }.get(marker, "M 0 -0.86 A 0.86 0.86 0 1 1 -0.001 -0.86 Z")
    fill = color if g["fill"] else "none"
    sw = 0 if g["fill"] else 0.16
    # halo on the OPEN glyph only — see the client's LineMarker: on the filled teeth it outlined
    # every triangle and let the line show between them.
    halo = (
        ""
        if g["fill"]
        else f'<path d="{path}" fill="none" stroke="#ffffff" stroke-width="0.22" stroke-linejoin="round" opacity="0.9"/>'
    )
    svg = (
        f'<svg viewBox="-1.15 -1.15 2.3 2.3" xmlns="http://www.w3.org/2000/svg">'
        f"{halo}"
        f'<path d="{path}" fill="{fill}" stroke="{color}" stroke-width="{sw}" stroke-linejoin="round"/>'
        f"</svg>"
    )
    img = raster_svg(svg, size)
    if img is None:
        return
    # The bearing itself, as on the client: the path is authored standing on a line running east.
    # Negated because PIL rotates counter-clockwise while screen y grows downward.
    if g["rotate"]:
        img = img.rotate(-deg, expand=True, resample=Image.Resampling.BICUBIC)
    overlay.alpha_composite(img, (int(xy[0] - img.width / 2), int(xy[1] - img.height / 2)))


def _halo_text(
    draw: ImageDraw.ImageDraw,
    xy: tuple[float, float],
    text: str,
    fs: int,
    color: str,
    anchor: str = "mm",
) -> None:
    """Bold letter with a white halo — the marker letters must read on any base map.

    Also carries a background-less "Klartext" note, which needs the same treatment for the same
    reason; those lines are left-anchored ("lm"), hence the parameter.
    """
    f = _font(fs)
    r = max(1, fs // 7)
    for dx in (-r, 0, r):
        for dy in (-r, 0, r):
            if dx or dy:
                draw.text((xy[0] + dx, xy[1] + dy), text, font=f, fill="white", anchor=anchor)
    draw.text(xy, text, font=f, fill=color, anchor=anchor)


# Note text sizes — MUST match NOTE_SIZE_SCALE in src/lib/notes.ts, or a note that reads as a
# heading on screen prints as body text.
NOTE_SIZE_SCALE = {"s": 0.8, "m": 1.0, "l": 1.45}
# Default note widths — MUST match NOTE_WN.def / NOTE_W_PX.def in src/lib/notes.ts. A note stored
# before notes had a width falls back to these, exactly as the client does, so an old note prints
# the same wrapped box the operator now sees on screen.
NOTE_WN_DEFAULT = 0.2
NOTE_W_PX_DEFAULT = 220


def _note_scale(size: str | None) -> float:
    return NOTE_SIZE_SCALE.get(size or "m", 1.0)


def _wrap_text(draw: ImageDraw.ImageDraw, text: str, font: ImageFont.FreeTypeFont, max_w: float) -> list[str]:
    """Greedy word wrap to a pixel width, honouring the writer's own line breaks first.

    A word longer than the box (a hydrant code, a chemical name) is NOT broken — it overhangs
    instead. Splitting mid-token would make an already-hard word unreadable on paper, and the
    on-screen box does the same thing (`overflow-wrap: break-word` only breaks when it must).
    """
    out: list[str] = []
    for para in text.split("\n"):
        if not para:
            out.append("")
            continue
        line = ""
        for word in para.split(" "):
            probe = f"{line} {word}" if line else word
            if line and draw.textlength(probe, font=font) > max_w:
                out.append(line)
                line = word
            else:
                line = probe
        out.append(line)
    return out


def _note_lines(
    draw: ImageDraw.ImageDraw,
    text: str,
    font: ImageFont.FreeTypeFont,
    box_w: float | None,
) -> list[str]:
    """The note's laid-out lines, wrapped to `box_w`.

    EVERY note is a wrapping box (there used to be a one-line variant; see src/lib/notes.ts).
    A caller passing no width means a stored note that predates the width — it has already
    substituted the surface default, so a falsy width here can only be a team chip, which is
    a single line by nature.
    """
    if box_w and box_w > 0:
        return _wrap_text(draw, text, font, box_w)
    return [text.replace("\n", " ")]


def _label_box(
    draw: ImageDraw.ImageDraw,
    xy: tuple[float, float],
    lines: list[str],
    fs: int,
    plain: bool = False,
    color: str | None = None,
    box_w: float = 0,
) -> None:
    """White label chip; multiple lines stack (distance line + free label, like the map).

    A map note reuses this: `box_w` makes it a fixed-width, left-aligned paragraph rather than a
    chip hugging its longest line, and `plain` drops the chip entirely for a "Klartext" note —
    which then gets the halo, because bare text over an aerial is unreadable without it.
    """
    f = _font(fs)
    lh = fs * 1.25
    widths = [draw.textlength(t, font=f) for t in lines]
    bw, bh = (box_w if box_w else max(widths)), lh * len(lines)
    pad = fs * 0.4
    x, y = xy
    ink = color or "#1b2330"
    if not plain:
        draw.rounded_rectangle(
            [x - bw / 2 - pad, y - bh / 2 - pad, x + bw / 2 + pad, y + bh / 2 + pad],
            radius=max(2, fs // 4),
            fill=(255, 255, 255, 238),
            outline="#d4dae3",
            width=1,
        )
    tx = (x - bw / 2) if box_w else x
    anchor = "lm" if box_w else "mm"
    for i, t in enumerate(lines):
        ty = y - bh / 2 + lh * (i + 0.5)
        if plain:
            _halo_text(draw, (tx, ty), t, fs, ink, anchor)
        else:
            draw.text((tx, ty), t, font=f, fill=ink, anchor=anchor)


#: A board (Objektplan) symbol, in px at the reference width.
#:
#: ⚠️ TWO numbers multiplied, and both have a home on the client: the unscaled base a symbol gets
#: from the sheet's width (`fit.w * 0.085`, ~42 on a single A4 portrait — Whiteboard.tsx ·
#: symBase) times the DEFAULT of the plan surface's Symbolgrösse (lib/prefs · SYMBOL_SCALE.board).
#:
#: ⚠️ The default, NOT the device's slider position. `krokiPayload.ts` sets out at length why a
#: per-device legibility setting must never reach the paper — two tablets printing one Einsatz
#: have to produce the same sheet — and none of those reasons applies to the default, which is
#: the app's own opinion about how big a symbol on a Modul sheet should be. When that opinion
#: changed (1.0 → 0.7 on 27.08.) and this number did not, the plan page printed its symbols ~43 %
#: larger than the board showed them, which is precisely the WYSIWYG break that was closed for
#: the map Kroki on 18.08. `test_board_symbol_scale_mirrors_prefs` fails if they part again.
_BOARD_SYMBOL_PX = 42 * 0.7

#: A numbered marker is this many px across at the reference width — big enough to read on
#: paper, small enough not to become the picture. Scaled by `u` like everything else.
#: ⚠️ 9.5, up from 8.0 (18.08.): these discs ARE the labels on paper, and at 8 they were the
#: smallest thing on the sheet while carrying the most-needed information on it.
_NUM_R = 9.5


def _numbered_marker(draw: ImageDraw.ImageDraw, xy: tuple[float, float], n: int, r: float) -> None:
    """A dark disc with a number in it, where a label chip would have been."""
    x, y = xy
    draw.ellipse([x - r, y - r, x + r, y + r], fill="#12161c", outline="white", width=max(1, int(r / 5)))
    draw.text((x, y + r * 0.04), str(n), font=_font(int(r * 1.25)), fill="white", anchor="mm")


def _number_words(
    draw: ImageDraw.ImageDraw,
    words: list[tuple[tuple[float, float], list[str], bool]],
    r: float,
    canvas: tuple[int, int],
    legend: list[str],
) -> None:
    """The sheet's ONE way of printing words that belong to a picture: a numbered disc where the
    words were, and the words themselves in `legend`, in the order the items are given.

    Shared by the Kroki and the plan pages so a reader who turns from one sheet to the next meets
    the same convention and the same wording. `under` says the anchor is the TOP edge of the chip
    that would have hung under a glyph, so the disc is nudged down onto it; a label chip is
    centred on its anchor already.

    ⚠️ ONLY what the picture actually shows. A disc that cannot sit WHOLLY inside the canvas is
    drawn off it and silently clipped, and a legend line for it then sends the reader looking for
    a number that is not there — worse than not listing it at all (11.08.). Such an item is
    skipped entirely, so the numbering stays 1..n with no gaps.
    """
    w_px, h_px = canvas
    for xy, lines, under in words:
        x, y = xy
        mx, my = x, (y + r if under else y)
        if not (r <= mx <= w_px - r and r <= my <= h_px - r):
            continue
        legend.append(" · ".join(t for t in lines if t.strip()))
        _numbered_marker(draw, (mx, my), len(legend), r)


def _fmt_distance(m: float) -> str:
    return f"{round(m)} m" if m < 1000 else f"{m / 1000:.2f} km".replace(".", ",")


def _hose_hint(m: float, hose_len: float = 20.0, reserve: float = 0.10) -> str:
    """Messpfeil helper line (client hoseLengthHint): length + reserve ÷ hose length, up."""
    return f"~{math.ceil(m * (1 + reserve) / hose_len)} Schläuche"


def _geodesic_m(coords: list[tuple[float, float]]) -> float:
    total = 0.0
    for (lng1, lat1), (lng2, lat2) in itertools.pairwise(coords):
        dx = (lng2 - lng1) * 111320 * math.cos(math.radians((lat1 + lat2) / 2))
        dy = (lat2 - lat1) * 110540
        total += math.hypot(dx, dy)
    return total


@dataclass
class KrokiScene:
    """The drawable subset of a workspace: entities + drawings (matching src/types.ts)."""

    entities: list[dict] = field(default_factory=list)
    drawings: list[dict] = field(default_factory=list)

    def extent_points(self) -> list[tuple[float, float]]:
        pts: list[tuple[float, float]] = [tuple(e["coord"]) for e in self.entities]
        for d in self.drawings:
            pts.extend(tuple(c) for c in d.get("coords", []))
            if d.get("kind") == "circle" and d.get("radiusM") and d.get("coords"):
                lng, lat = d["coords"][0]
                dlat = d["radiusM"] / 110540
                dlng = d["radiusM"] / (111320 * math.cos(math.radians(lat)))
                pts += [(lng - dlng, lat - dlat), (lng + dlng, lat + dlat)]
        return pts


def _circle_points(lng: float, lat: float, radius_m: float, n: int = 72) -> list[tuple[float, float]]:
    out = []
    for i in range(n + 1):
        a = 2 * math.pi * i / n
        out.append(
            (
                lng + (radius_m * math.cos(a)) / (111320 * math.cos(math.radians(lat))),
                lat + (radius_m * math.sin(a)) / 110540,
            )
        )
    return out


def _hex_alpha(color: str, alpha: float) -> tuple[int, int, int, int]:
    c = color.lstrip("#")
    if len(c) == 3:
        c = "".join(ch * 2 for ch in c)
    r, g, b = int(c[0:2], 16), int(c[2:4], 16), int(c[4:6], 16)
    return (r, g, b, int(alpha * 255))


#: THE north mark, for every surface that carries one — the Kroki, the Gebäude floor-stack page,
#: and the dial on screen (src/components/Whiteboard.tsx, matched by hand).
#:
#: ⚠️ There were three of them and they disagreed: the Kroki drew an ink dart with the N inside
#: the ring, the floor-stack page a red triangle with the N under the centre, and the screen a
#: red dart with the N floating above the ring. Three marks for one convention, two of them on
#: pages that get stapled together.
#:
#: The Kroki's is the one that survived print review, so it is the one that stayed: the N sits
#: INSIDE the ring (above it, the mark ran off the top edge of the sheet), and it is a DART
#: rather than a two-tone needle because at print size a needle turns to mush. `deg` rotates the
#: whole dial for the Gebäudeview, whose footprint is auto-rotated; the Kroki is always north-up
#: and passes 0, so there it states the convention rather than measuring anything.
def north_dial_svg(deg: float = 0) -> str:
    return (
        '<svg viewBox="-25 -25 50 50" xmlns="http://www.w3.org/2000/svg">'
        '<circle r="24" fill="#ffffff" fill-opacity="0.90" stroke="#5b6573" stroke-width="1.5"/>'
        f'<g transform="rotate({deg})">'
        '<text y="-13" text-anchor="middle" font-family="Helvetica, Arial, sans-serif"'
        ' font-size="13" font-weight="700" fill="#1c1c1c">N</text>'
        '<path d="M0 -8 L10 16 L0 7 L-10 16 Z" fill="#1c1c1c"/>'
        "</g></svg>"
    )


def _center_lat(view: View) -> float:
    """Latitude at the image centre — inverse WebMercator of the view's middle row."""
    scale = TILE * (2**view.z)
    wy = view.origin[1] + view.height / 2
    t = 4 * math.pi * (0.5 - wy / scale)
    return math.degrees(math.asin(math.tanh(t / 2)))


#: candidate bar lengths — the usual cartographic 1/2/2.5/5 ladder, in metres
_SCALE_STEPS = [5, 10, 20, 25, 50, 100, 200, 250, 500, 1000, 2000]


def _scale_bar(draw: ImageDraw.ImageDraw, img_w: int, img_h: int, u: float, view: View) -> None:
    """Massstabsbalken, bottom-left — the paper's answer to «wie weit ist das?».

    On screen distances are measured by the Messen tool; on paper the only distance the sheet
    used to state was an Absperrkreis's radius, and only when one was drawn. Four alternating
    segments, length picked from the map ladder so the number is one people can halve and
    quarter in their head."""
    ppm = px_per_m(_center_lat(view), view.z)
    target = img_w * 0.16
    metres = min(_SCALE_STEPS, key=lambda m: abs(m * ppm - target))
    bar_w = metres * ppm
    if not (img_w * 0.06 <= bar_w <= img_w * 0.4):  # degenerate zoom — no bar beats a wrong bar
        return
    x0, bar_h = 14 * u, 5 * u
    label = f"{metres} m"
    f = _font(int(11 * u))
    y_text = img_h - 30 * u
    y0 = img_h - 16 * u
    # white backing so the bar reads on any ground
    pad = 5 * u
    draw.rectangle(
        [x0 - pad, y_text - pad, x0 + bar_w + draw.textlength(f"  {label}", font=f) + pad, y0 + bar_h + pad],
        fill=(255, 255, 255, 220),
    )
    seg = bar_w / 4
    for i in range(4):
        draw.rectangle(
            [x0 + i * seg, y0, x0 + (i + 1) * seg, y0 + bar_h],
            fill="#1c1c1c" if i % 2 == 0 else "#ffffff",
            outline="#1c1c1c",
        )
    draw.text((x0, y_text), "0", font=f, fill="#1c1c1c")
    tw = draw.textlength(label, font=f)
    draw.text((x0 + bar_w - tw, y_text), label, font=f, fill="#1c1c1c")


def _north_arrow(img: Image.Image, img_w: float, u: float) -> None:
    """Nordpfeil, top-right of the Kroki.

    On screen the map can be turned and the operator knows which way they are looking; on paper
    it cannot, and a Kroki without a north mark cannot be laid next to a plan or read against
    the terrain."""
    size = int(34 * u)
    dial = raster_svg(north_dial_svg(), size)
    # `paste` with the glyph as its own mask, not alpha_composite: this runs on the FLATTENED
    # RGB image, after the overlay has been merged and downsampled
    img.paste(dial, (int(img_w - size - 14 * u), int(14 * u)), dial)


def _glyph_box(e: dict, lat: float, overlay_z: float, sym_mul: float) -> tuple[float, float]:
    """(width, height) of an entity's printed glyph in the 1050-px reference units — the ONE sizing
    the renderer draws with and the attachment pass couples to, so the two cannot disagree about
    where a glyph's edge is. Symbols use the zoom band and stay square; a generic shape prints at
    its ground size with its own aspect (height/width).

    ⚠️ The limits are PER KIND, mirroring lib/shapes · SHAPE_MAX_PX / shapeAspect. A Rotation is a
    shuttle RUN and spans the map: the flat 900 px ceiling truncated a Wasserpendel on paper the
    same way it used to stop the drag on screen, and the 0.2 aspect floor fattened it tenfold,
    because a run's width is capped in metres and a long one legitimately stores a few
    thousandths (01.09.)."""
    if e.get("sizeM"):
        run = e.get("shape") == "rotation"
        w = max(24.0, min(12000.0 if run else 900.0, e["sizeM"] * px_per_m(lat, overlay_z)))
        return w, w * max(0.002 if run else 0.02, min(5.0, float(e.get("aspect") or 1)))
    w = sym_px(e.get("kind", "symbol"), lat, overlay_z, sym_mul)
    return w, w


def _snap_attached_ends(scene: KrokiScene, view: View, sym_mul: float, u: float, ss: int = 2) -> None:
    """Couple every Leitung end that is attached to an object to the glyph AS PRINTED.

    The client resolves attachments before it sends the scene, but without a projection: it ends
    the line on a fixed ~4 m GROUND footprint (lib/lineAttachments · resolveMapDrawings). A printed
    glyph is sized in PIXELS (`sym_px`), so the two only agree at one zoom — on a close crop 4 m is
    several glyph widths and the hose stopped visibly short of the vehicle it was coupled to
    (18.09.2026). The screen has always used the real glyph rectangle (MapView · objectPoint); this
    is the same rule with the sheet's own view, which only the server knows.

    Mutates the scene's line coords in place. Port of the client's `boundaryPoint`, including its
    slightly NEGATIVE padding: the glyph paints over the line, so an end just inside the tile reads
    as coupled and one just outside as «not quite joined».
    """
    by_id = {e["id"]: e for e in scene.entities if e.get("id")}
    overlay_z = view.overlay_z if view.overlay_z is not None else view.z
    for d in scene.drawings:
        coords = d.get("coords") or []
        if d.get("kind") != "line" or len(coords) < 2:
            continue
        for key, idx, nb in (("startAt", 0, 1), ("endAt", len(coords) - 1, len(coords) - 2)):
            e = by_id.get(d.get(key) or "")
            if e is None:
                continue
            lng, lat = e["coord"][0], e["coord"][1]
            cx, cy = view.project(lng, lat)
            tx, ty = view.project(coords[nb][0], coords[nb][1])
            dx, dy = tx - cx, ty - cy
            if math.hypot(dx, dy) < 1e-6:
                continue
            gw, gh = _glyph_box(e, lat, overlay_z, sym_mul)
            w, h = gw * u, gh * u
            r = -math.radians(float(e.get("rotation") or 0))
            lx = dx * math.cos(r) - dy * math.sin(r)
            ly = dx * math.sin(r) + dy * math.cos(r)
            pad = -2.0 * u
            k = min((w / 2 + pad) / max(abs(lx), 1e-9), (h / 2 + pad) / max(abs(ly), 1e-9))
            if k >= 1:  # the neighbour vertex is already inside the tile — nothing to pull in
                continue
            # back to WGS84 along the same ray: the ray is short (half a glyph), so scaling the
            # coordinate delta by k is exact to well under a pixel
            coords[idx] = [lng + (coords[nb][0] - lng) * k, lat + (coords[nb][1] - lat) * k, *coords[idx][2:]]
    _snap_line_joints(scene, view, u, ss)


def _snap_line_joints(scene: KrokiScene, view: View, u: float, ss: int) -> None:
    """…and the same for an end attached to ANOTHER LINE's end. A plain joint simply shares the
    target's point. A branch off a Teilstück sits on one of the fork's three PRONG TIPS — and the
    fork is a glyph sized in pixels (`_fork_dims`), while the client fans the branches out by a
    fixed 1.5 m on the ground. On a close crop the branch started a whole fork-length away from
    the prong it belongs to (18.09.2026). Runs AFTER the object pass, because a target's own end
    may just have moved; three rounds settle any chain a hand would draw."""
    by_id = {d["id"]: d for d in scene.drawings if d.get("id") and len(d.get("coords") or []) >= 2}
    if not by_id:
        return
    for _ in range(3):
        for d in scene.drawings:
            coords = d.get("coords") or []
            if d.get("kind") != "line" or len(coords) < 2:
                continue
            for key, idx in (("startAtLine", 0), ("endAtLine", len(coords) - 1)):
                ref = d.get(key) or {}
                target = by_id.get(ref.get("id") or "")
                if target is None or target is d:
                    continue
                t_coords = target["coords"]
                at_end = ref.get("endpoint") != "start"
                tip = t_coords[-1] if at_end else t_coords[0]
                lng, lat = tip[0], tip[1]
                port = ref.get("port")
                if at_end and target.get("teilstueck") and port is not None:
                    # the prong tip, in the px the fork is rastered in — then back to WGS84 through
                    # the local scale (north-up Mercator: no cross terms, linear over a few px)
                    w = max(1, round((target.get("width") or 4) * u * ss))
                    proj = [view.project(c0[0], c0[1]) for c0 in t_coords]
                    pts = [(x * ss, y * ss) for x, y in proj]
                    fx, fy = _fork_bearing(pts, w)
                    half, prong = _fork_dims(w)
                    perp = (int(port) - 1) * half
                    ox, oy = (fx * prong - fy * perp) / ss, (fy * prong + fx * perp) / ss
                    x0, y0 = view.project(lng, lat)
                    x1, y1 = view.project(lng + 1e-5, lat + 1e-5)
                    lng, lat = lng + ox * 1e-5 / (x1 - x0), lat + oy * 1e-5 / (y1 - y0)
                coords[idx] = [lng, lat, *coords[idx][2:]]


def render_kroki(
    scene: KrokiScene,
    pack: SymbolPack,
    tile_url: str,
    width: int = 1600,
    height: int = 980,
    view: View | None = None,
    cache: TileCache | None = None,
    sym_mul: float = 0.85,
    attribution: str = "© CARTO, © OpenStreetMap-Mitwirkende",
    supersample: int = 2,
    ref_width: int = 1050,
    max_tile_z: int = 19,
    legend_out: list[str] | None = None,
) -> Image.Image:
    """Compose one Kroki bitmap: base tiles + drawings + tactical symbols + attribution.

    `ref_width`: the on-screen viewport width the client sizing rules assume (~the print
    view's map container). Symbol sizes, line widths and label fonts scale by
    width/ref_width so the printed proportions match the app regardless of render DPI.

    `legend_out`: filled with «1 · 2 · 3 …» in picture order. Drawing labels and symbol captions
    are ALWAYS numbered, not only on collision — the fallback this once described was dropped
    09.08. (end tags, Trupp chips and Notizzettel still print inline and never enter the legend). An out-parameter rather than a second return value so every existing
    caller — and the tile warmer — stays exactly as it was."""
    legend = legend_out if legend_out is not None else []
    ss = supersample
    u = width / ref_width  # UI scale: screen-px rules → render-px
    view = view or fit_view(scene.extent_points(), width, height)
    overlay_z = view.overlay_z if view.overlay_z is not None else view.z
    _snap_attached_ends(scene, view, sym_mul, u, ss)
    # supersampled view: same world extent, ss× the pixels (tiles are stitched at 1× then
    # upscaled — map detail stays honest, but every overlay edge is drawn at ss× and
    # downsampled, which is where the crispness matters)
    base = render_base(view, tile_url, cache=cache, max_tile_z=max_tile_z)
    img = base.resize((width * ss, height * ss), Image.Resampling.LANCZOS).convert("RGBA")
    overlay = Image.new("RGBA", img.size, (0, 0, 0, 0))
    draw = ImageDraw.Draw(overlay)

    def pt(lng: float, lat: float) -> tuple[float, float]:
        x, y = view.project(lng, lat)
        return x * ss, y * ss

    # --- drawings below symbols; TWO passes like the map's layer order: every polygon
    # FILL first, then every stroke + decor — so an area's fill can never sit on top of a
    # neighbouring line (prod feedback 2026-07-18) ---
    labels: list[tuple[tuple[float, float], list[str], int]] = []
    # symbol captions ride in their own list because they are drawn by a different function and
    # hang DOWNWARDS from their anchor; both go through one collision pass at the end
    captions: list[tuple[tuple[float, float], list[str], int]] = []
    markers: list[tuple[tuple[float, float], str, int, str]] = []
    # ⚠️ End tags are DEFERRED like the marker letters, and drawn after them. Drawn inline they
    # went down before the —R—R— letters of their own line, so a Leitung running under its own
    # tag had the letters painted straight through «1 · W · Meier A.». The tag is the one thing
    # on a hose line that has to stay readable, and the screen puts it on top too (MapView).
    end_tags: list[tuple[list[tuple[float, float]], list[str], str, int, float]] = []
    for d in scene.drawings:
        color = d.get("color") or "#1f6feb"
        kind = d.get("kind")
        raw_alpha = d.get("fillOpacity")
        alpha = float(raw_alpha) if raw_alpha is not None else 0.14
        if kind == "circle" and d.get("coords"):
            lng, lat = d["coords"][0]
            ring = [pt(a, b) for a, b in _circle_points(lng, lat, d.get("radiusM") or 50)]
            # an Absperrkreis answers the Füllung question the same way a Fläche does — the editor
            # offers it the same row, so the paper has to know both answers (client DrawEditor)
            if d.get("hatch"):
                _hatch_polygon(overlay, ring, color, u * ss)
            else:
                draw.polygon(ring, fill=_hex_alpha(color, alpha))
        elif kind == "area" and len(d.get("coords", [])) >= 3:
            poly = [pt(a, b) for a, b in d["coords"]]
            if d.get("hatch"):
                _hatch_polygon(overlay, poly, color, u * ss)
            else:
                draw.polygon(poly, fill=_hex_alpha(color, alpha))
    for d in scene.drawings:
        color = d.get("color") or "#1f6feb"
        w = max(1, round((d.get("width") or 4) * u * ss))
        kind = d.get("kind")
        if kind == "circle" and d.get("coords"):
            lng, lat = d["coords"][0]
            pts = [pt(a, b) for a, b in _circle_points(lng, lat, d.get("radiusM") or 50)]
            _dashed(draw, pts, color, w, dash=14 * u * ss, gap=10 * u * ss) if d.get("dashed") else draw.line(
                pts, fill=color, width=w, joint="curve"
            )
            if d.get("radiusM"):
                labels.append((pts[len(pts) // 8], [f"r = {round(d['radiusM'])} m"], int(13 * u * ss)))
        elif kind == "area" and len(d.get("coords", [])) >= 3:
            pts = [pt(a, b) for a, b in d["coords"]]
            draw.line([*pts, pts[0]], fill=color, width=w, joint="curve")
            # Abschnitt fields ride the label chip: Leiter on the name line («Abschnitt 1 ·
            # Oblt Steiner»), Auftrag on its own. ⚠️ Same composition as the live map
            # (MapView · drawLabels) — screen and paper must say the same thing.
            head = " · ".join(x for x in (d.get("label"), d.get("abschnittLeiter")) if x)
            chip_lines = [x for x in (head, d.get("abschnittAuftrag")) if x]
            if chip_lines:
                cx = sum(p[0] for p in pts) / len(pts)
                cy = sum(p[1] for p in pts) / len(pts)
                labels.append(((cx, cy), chip_lines, int(14 * u * ss)))
        elif len(d.get("coords", [])) >= 2:
            pts = [pt(a, b) for a, b in d["coords"]]
            if d.get("dashed"):
                _dashed(draw, pts, color, w, dash=14 * u * ss, gap=10 * u * ss)
            else:
                draw.line(pts, fill=color, width=w, joint="curve")
            if d.get("arrow"):
                _arrow_head(draw, pts, color, w, stop=bool(d.get("arrowStop")))
            if d.get("marker"):
                # A LETTER repeats at the client's 46 px rhythm, once per character («WT» at 92 –
                # lib/lineStyle · markerSpacing), and is drawn with the halo text pass below; a
                # CHAIN GLYPH has its own denser rhythm and is painted here, because it is a shape
                # and not a font.
                mk = str(d["marker"])
                chain = _CHAIN_GLYPHS.get(mk)
                step = (chain["spacing"] if chain else 46 * max(1, len(mk))) * u * ss
                for mx, my, mdeg in _marker_points(pts, step):
                    if chain:
                        _chain_marker(overlay, (mx, my), mk, mdeg, max(6, int(chain["size"] * u * ss)), color)
                    else:
                        markers.append(((mx, my), mk, int(13 * u * ss), color))
            # FKS hose-line decorations: Teilstück fork at the tip + boxed end tag
            # («Leitungsnummer · Inhaltsbuchstabe · Stockwerk») just before it
            if d.get("teilstueck"):
                _teilstueck_fork(overlay, pts, color, w)
            tag_parts: list[str] = []
            if d.get("lineNo") is not None:
                tag_parts.append(str(d["lineNo"]))
            if d.get("content"):
                tag_parts.append(str(d["content"]))
            if d.get("floorTag") is not None:
                tag_parts.append(floor_badge(d["floorTag"]))
            # who worked this Leitung. No alarm tint on paper: a printed rapport is the record of
            # an incident, not a live board — a red hose would freeze one moment as the outcome.
            if d.get("trupp"):
                tag_parts.append(str(d["trupp"]))
            if tag_parts:
                end_tags.append((pts, tag_parts, color, int(12 * u * ss), w))
            # label chip at the midpoint VERTEX (like the map): distance line + free label stack
            lines: list[str] = []
            if d.get("showDistance"):
                ln_m = _geodesic_m(d["coords"])
                lines.append(f"{_fmt_distance(ln_m)} · {_hose_hint(ln_m)}")
            if d.get("label"):
                lines.append(d["label"])
            if lines:
                labels.append((pts[(len(pts) - 1) // 2], lines, int(13 * u * ss)))

    # --- tactical symbols (the client's own pack, same size band + decor: white chip
    # for outline glyphs, FKS spread arrows, floor/count badges, caption below) ---
    for e in scene.entities:
        # dynamic glyphs (live vehicles, placards, shapes) arrive as client-resolved SVG
        # strings; everything else is looked up in the shared pack by name
        svg = e.get("symbolSvg") or (pack.by_name.get(e["symbol"]) if e.get("symbol") else None)
        lng, lat = e["coord"]
        x0_, y0_ = pt(lng, lat)
        if not svg:
            # glyph-less markers: Trupp dot (team colour + name chip) and note pill
            if e.get("kind") == "team" and e.get("caption"):
                r = 7 * u * ss
                tc = e.get("color") or "#1f6feb"
                draw.ellipse(
                    [x0_ - r, y0_ - r, x0_ + r, y0_ + r], fill=tc, outline="white", width=max(1, int(1.5 * u * ss))
                )
                _caption(draw, (x0_, y0_ + r + 2 * u * ss), [str(e["caption"])], int(11.5 * u * ss))
            elif e.get("kind") == "note" and e.get("caption"):
                # a map note carries its box width in SCREEN px (noteW) — scale it into sheet px
                # with the same u·ss factor as the font, so the paper wraps where the screen did
                nfs = int(12 * u * ss * _note_scale(e.get("noteSize")))
                nbox = (e.get("noteW") or NOTE_W_PX_DEFAULT) * u * ss
                _label_box(
                    draw,
                    (x0_, y0_),
                    _note_lines(draw, str(e["caption"]), _font(nfs), nbox),
                    nfs,
                    plain=bool(e.get("notePlain")),
                    color=e.get("color"),
                    box_w=nbox,
                )
            continue
        # one sizing with the attachment pass — see _glyph_box
        gw, gh_ = _glyph_box(e, lat, overlay_z, sym_mul)
        size, gh = round(gw * u * ss), round(gh_ * u * ss)
        x, y = x0_, y0_
        done = e.get("done") or None
        _place_symbol(overlay, draw, svg, (x, y), size, e.get("rotation"), e.get("spread"), height=gh, done=bool(done))
        _symbol_badges(
            draw, (x, y), size, u * ss, e.get("floor"), e.get("floorFrom"), e.get("floorTo"), e.get("count"), done
        )
        # metadata caption under the glyph (the map's .sym-caption) — DEFERRED into the same
        # collision pass the drawing labels go through: on the 08.08. Kroki two of these
        # («Kurmann Thomas» over «Lüfter Akku 3. OG») printed straight on top of one another,
        # and a chip drawn inline cannot know what is coming after it.
        if e.get("caption"):
            captions.append(((x, y + gh / 2 + 3 * u * ss), str(e["caption"]).split("\n"), int(11.5 * u * ss)))

    # marker letters over the lines, then the end tags over THOSE, label chips on top of all
    for xy, letter, fs, color in markers:
        _halo_text(draw, xy, letter, fs, color)
    for tag_pts, tag_parts, tag_color, tag_fs, tag_w in end_tags:
        _end_tag(draw, tag_pts, tag_parts, tag_color, tag_fs, tag_w, overlay.size)

    # ── words last, and they go in the LEGEND, not on the picture ──
    #
    # ⚠️ Chips used to be drawn where their own anchor was, with no idea what else was already
    # there. Three symbols within ten metres therefore printed three chips on top of one
    # another and the middle one was simply unreadable — on PAPER, where nothing can be dragged
    # aside (08.08. Einsatz).
    #
    # So every labelled thing gets a NUMBER and the words go into a list beside the picture.
    # Numbering only on collision was tried and dropped (decided 09.08.): it made the same
    # Einsatz print differently before and after one more symbol, and «where did the names go»
    # is a question the sheet must never raise. Predictable beats clever here — and the legend
    # has room for the full text where a chip had to be cut short, which is the other half of
    # why it is the better shape.
    #
    # The disc, the fit test and the « · »-joined legend line all live in `_number_words`, which
    # the PLAN pages call too — one convention across every sheet of the same rapport.
    words = [(xy, lines, False) for xy, lines, _fs in labels]
    words += [(xy, lines, True) for xy, lines, _fs in captions]
    _number_words(draw, words, _NUM_R * u * ss, overlay.size, legend)

    out = Image.alpha_composite(img, overlay).resize((width, height), Image.Resampling.LANCZOS).convert("RGB")
    d2 = ImageDraw.Draw(out)
    _north_arrow(out, out.width, u)
    _scale_bar(d2, out.width, out.height, u, view)
    # attribution (tile ToS) bottom-right
    f = _font(int(11 * u))
    tw = d2.textlength(attribution, font=f)
    d2.rectangle([out.width - tw - 12 * u, out.height - 18 * u, out.width, out.height], fill=(255, 255, 255, 200))
    d2.text((out.width - tw - 6 * u, out.height - 15 * u), attribution, font=f, fill="#5b6573")
    return out


# ----------------------------------------------------------------------------- plan pages


def render_plan_page(
    pdf_bytes: bytes,
    annos: list[dict],
    pack: SymbolPack | None,
    width: int = 1600,
    supersample: int = 2,
    ref_width: int = 1050,
    legend_out: list[str] | None = None,
    page: int = 0,
) -> Image.Image:
    """Render an annotated Objektplan page: the plan PDF's page ``page`` (0-based, first by
    default; a floor-pack sheet names its own) via pdfium, then the
    board annotations (relative 0..1 coords — the Whiteboard's model) drawn on top with the
    same primitives as the Kroki. Mirrors what the Whiteboard shows on screen
    (`_BOARD_SYMBOL_PX` symbols, non-scaling ~`width`px strokes).

    `legend_out`: like `render_kroki`'s — filled with «1 · 2 · 3 …» for the symbol captions this
    page turned into numbered discs, in placement order. An out-parameter for the same reason:
    every existing caller stays exactly as it was."""
    import pypdfium2 as pdfium

    from .pdfium_lock import pdfium_lock

    ss = supersample
    with pdfium_lock:
        doc = pdfium.PdfDocument(pdf_bytes)
        try:
            page_obj = doc[min(max(page, 0), len(doc) - 1)]
            pw, _ph = page_obj.get_size()
            scale = (width * ss) / pw
            bitmap = page_obj.render(scale=scale)
            try:
                base = bitmap.to_pil().convert("RGBA")
            finally:
                bitmap.close()
        finally:
            doc.close()
    return _overlay_board_annos(base, annos, pack, width, supersample, ref_width, legend_out)


def render_blank_page(
    aspect: float,
    annos: list[dict],
    pack: SymbolPack | None,
    width: int = 1600,
    supersample: int = 2,
    ref_width: int = 800,
    legend_out: list[str] | None = None,
) -> Image.Image:
    """A plan page WITHOUT a PDF behind it (the Gebäude floor-stack): a white base of the
    given aspect (h/w), with the whole page — footprint outlines, floor labels, north dial
    and the board annos — expressed as the client-sent anno list.

    ref_width 800 (not the plan pages' 1050): the sparse outline sheet needs bigger
    glyphs/text/strokes than a dense Modul-PDF to read well on paper."""
    aspect = max(0.2, min(4.0, aspect))
    ss = supersample
    base = Image.new("RGBA", (width * ss, round(width * aspect) * ss), (255, 255, 255, 255))
    return _overlay_board_annos(base, annos, pack, width, supersample, ref_width, legend_out)


def _overlay_board_annos(
    base: Image.Image,
    annos: list[dict],
    pack: SymbolPack | None,
    width: int,
    supersample: int,
    ref_width: int,
    legend_out: list[str] | None = None,
) -> Image.Image:
    ss = supersample
    u = width / ref_width
    w, h = base.size
    overlay = Image.new("RGBA", base.size, (0, 0, 0, 0))
    draw = ImageDraw.Draw(overlay)

    def pp(x: float, y: float) -> tuple[float, float]:
        return x * w, y * h

    legend = legend_out if legend_out is not None else []
    labels: list[tuple[tuple[float, float], list[str], int]] = []
    # symbol captions ride in their own list: they become numbered DISCS + legend lines at the
    # end (the Kroki's rule, `_number_words`), so the whole page has to be walked first
    captions: list[tuple[tuple[float, float], list[str]]] = []
    for a in annos:
        kind = a.get("kind")
        color = a.get("color") or "#1f6feb"
        sw = max(1, round((a.get("width") or 4) * u * ss))
        if kind in ("draw", "area") and len(a.get("pts") or []) >= 2:
            # ⚠️ A plan point is `[x, y, floor]` since 22.07.2026 (types · BoardAnno) and arrives
            # as stored; the floor is the client's business (it lifts floor-stack tiles into page
            # space before sending), so the page reads x and y only.
            pts = [pp(p[0], p[1]) for p in a["pts"]]
            if kind == "area" and len(pts) >= 3:
                raw_alpha = a.get("fillOpacity")
                if a.get("hatch"):
                    _hatch_polygon(overlay, pts, color, u * ss)
                else:
                    draw.polygon(pts, fill=_hex_alpha(color, float(raw_alpha) if raw_alpha is not None else 0.14))
                draw.line([*pts, pts[0]], fill=color, width=sw, joint="curve")
                if a.get("label"):
                    cx = sum(p[0] for p in pts) / len(pts)
                    cy = sum(p[1] for p in pts) / len(pts)
                    labels.append(((cx, cy), [a["label"]], int(14 * u * ss)))
            else:
                if a.get("dashed"):
                    _dashed(draw, pts, color, sw, dash=14 * u * ss, gap=10 * u * ss)
                else:
                    draw.line(pts, fill=color, width=sw, joint="curve")
        elif kind == "north":
            # The floor-stack page's dial, drawn from the SAME source as the Kroki's (see
            # north_dial_svg). It used to arrive as a `symbol` anno carrying an SVG the CLIENT
            # had written — a second dial, a red triangle with its N under the centre, on a page
            # that gets stapled to the Kroki. The client now sends the angle and nothing else.
            # sizeN is a caller-sent fraction of the page width; bound the pixel size at the
            # source so an absurd value never drives the raster (see _RASTER_MAX_EDGE).
            size = min(round((a.get("sizeN") or 0.055) * w), _RASTER_MAX_EDGE)
            dial = raster_svg(north_dial_svg(float(a.get("deg") or 0)), size)
            x, y = pp(a.get("x") or 0, a.get("y") or 0)
            overlay.alpha_composite(dial, (int(x - dial.width / 2), int(y - dial.height / 2)))
        elif kind == "symbol":
            svg = a.get("symbolSvg") or (pack.by_name.get(a["symbol"]) if pack and a.get("symbol") else None)
            if not svg:
                continue
            # symbols print at a fixed 42px; generic shapes carry their size as a
            # fraction of the plan width (sizeN) — mirror of the on-screen sizing —
            # and may be stretched (aspect = height/width, clamp as lib/shapes · shapeAspect).
            # `gh`, not `h` — `h` is this function's page height.
            if a.get("sizeN"):
                # sizeN (and the aspect below) are caller-sent; bound both derived edges at the
                # source so an absurd anno cannot drive a huge canvas (see _RASTER_MAX_EDGE).
                size = min(round(a["sizeN"] * w), _RASTER_MAX_EDGE)
                # per kind, as on the map above: a Rotation is far leaner than any box
                gh = min(
                    round(
                        size
                        * max(0.002 if a.get("shape") == "rotation" else 0.02, min(5.0, float(a.get("aspect") or 1)))
                    ),
                    _RASTER_MAX_EDGE,
                )
            else:
                size = round(_BOARD_SYMBOL_PX * u * ss)
                gh = size
            x, y = pp(a.get("x") or 0, a.get("y") or 0)
            # ⚠️ Same decor as the Kroki, deliberately: a plan symbol printed BARE until 26.08.
            # — no Entwicklung arrows, no white chip, no storey and no count — so «3 Brände im
            # 2. OG», drawn once on the board, came off the printer as one nameless flame.
            done = a.get("done") or None
            _place_symbol(
                overlay, draw, svg, (x, y), size, a.get("rotation"), a.get("spread"), height=gh, done=bool(done)
            )
            # `storey`, never `floor`: on a plan anno that name is the floor-stack's tile index.
            # On the Gebäude floor-stack `storey` is always absent — the sheet the symbol sits on
            # IS the storey, so the client never offers the control there (Whiteboard · onFloor)
            # and the page needs no second answer that could disagree with the first. A von/bis
            # RANGE and the count are placed things, not page facts, and print on every page.
            _symbol_badges(
                draw, (x, y), size, u * ss, a.get("storey"), a.get("floorFrom"), a.get("floorTo"), a.get("count"), done
            )
            # …and the WORDS the board shows under the glyph («Melder 3. OG», a Fahrer, the typed
            # detail fields). They print the way the Kroki prints them: a numbered disc under the
            # symbol and the text in a legend below the picture — the anchor is the top edge of
            # the chip that would have hung there, exactly as on the map.
            # ⚠️ The caption arrives COMPOSED (client · lib/symbols · symbolCaptionText, the same
            # call the Kroki payload and the board itself make). Deriving it here from `fields`
            # would be a second answer to «what does this symbol say», and the two sheets of one
            # rapport would eventually disagree.
            if (a.get("caption") or "").strip():
                captions.append(((x, y + gh / 2 + 3 * u * ss), str(a["caption"]).split("\n")))
        elif kind in ("text", "resource") and (a.get("text") or "").strip():
            x, y = pp(a.get("x") or 0, a.get("y") or 0)
            dark = kind == "resource"  # resource chips are ink-on-dark like the app
            # A note carries its size step and, once it is a text box, a width as a fraction of
            # the plan width (wN) — the same fraction the screen uses, so the paper breaks the
            # lines in the same places. A team chip is always the one-line pill it was.
            fs = int(12 * u * ss * (1.0 if dark else _note_scale(a.get("noteSize"))))
            f = _font(fs)
            # ⚠️ Absent `wN` means the one-line PILL, not a default-width box — that is what
            # both PlanAnnoIn and the client say, and the `or NOTE_WN_DEFAULT` here said the
            # opposite. It stretched every wN-less label into a wide bordered rectangle: the
            # Geschoss-Skizze's «2. OG» printed as an empty box four times its own width.
            wn = a.get("wN")
            box_w = wn * w if (wn and not dark) else 0
            lines = _note_lines(draw, a["text"], f, box_w)
            lh = fs * 1.35
            pad = fs * 0.45
            half_w = (box_w / 2 + pad) if box_w else (max(draw.textlength(t, font=f) for t in lines) / 2 + pad)
            half_h = lh * len(lines) / 2 + pad * 0.55
            # a Trupp chip wears its Truppfarbe as the cap bar on its left edge (client
            # .wb-resource-cap) — the colour IS the team's identity on both surfaces, and the
            # printed chip was the one place it got lost. The bar takes its own width out of the
            # chip, so the name stays centred in what is left of it.
            cap_w = fs * 0.3 if (dark and a.get("color")) else 0
            cap_gap = fs * 0.4 if cap_w else 0
            half_w += (cap_w + cap_gap) / 2
            # keep the note on the sheet: an anchor near the edge must not clip the text
            x = max(half_w + 2, min(w - half_w - 2, x))
            plain = bool(a.get("notePlain")) and not dark
            ink = "white" if dark else (a.get("color") or "#1b2330")
            if not plain:
                draw.rounded_rectangle(
                    [x - half_w, y - half_h, x + half_w, y + half_h],
                    radius=max(2, fs // 4),
                    fill="#1b2330" if dark else (255, 255, 255, 240),
                    outline=None if dark else "#d4dae3",
                    width=1,
                )
            if cap_w:
                draw.rounded_rectangle(
                    [
                        x - half_w + pad * 0.6,
                        y - half_h + pad * 0.7,
                        x - half_w + pad * 0.6 + cap_w,
                        y + half_h - pad * 0.7,
                    ],
                    radius=cap_w / 2,
                    fill=a["color"],
                )
            # a box is left-aligned (it is a paragraph); the one-line pill stays centred on its
            # anchor, exactly as both have always rendered on screen
            tx = (x - half_w + pad) if box_w else x + (cap_w + cap_gap) / 2
            anchor = "lm" if box_w else "mm"
            for i, t in enumerate(lines):
                ty = y - half_h + pad * 0.55 + lh * (i + 0.5)
                # "Klartext" has no paper behind it, so on a busy plan it needs the same halo the
                # screen gives it — otherwise it vanishes over hatching and thick outlines.
                if plain:
                    _halo_text(draw, (tx, ty), t, fs, ink, anchor)
                else:
                    draw.text((tx, ty), t, font=f, fill=ink, anchor=anchor)
    for xy, lines, fs in labels:
        _label_box(draw, xy, lines, int(fs))
    # ⚠️ Only the SYMBOL captions are numbered. A plan's area label, its Notizzettel and its Trupp
    # chip keep printing inline — the same carve-out the Kroki makes for the things that are not
    # a glyph with words hanging under it (`if not svg` returns before the caption list). Sweeping
    # them in would put lines in the legend for text the reader is already looking straight at.
    _number_words(draw, [(xy, lines, True) for xy, lines in captions], _NUM_R * u * ss, base.size, legend)

    out = Image.alpha_composite(base, overlay)
    return out.resize((width, round(h / ss)), Image.Resampling.LANCZOS).convert("RGB")
