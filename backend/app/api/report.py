"""Einsatzrapport PDF endpoint.

The client POSTs a JSON `payload` (Form field) with the rapport DATA — including the Kroki
scene and plan references; the server renders the map itself (app/kroki.py, raster tiles +
the shared symbol pack) and the plan pages (pdfium), and loads journal photos straight from
its own media store. Legacy clients may still upload captured figure PNGs (one-release
compat window). Any authenticated user may generate a report (read-only output), so this
uses CurrentUser, not CurrentEditor.
"""

import re
import unicodedata
import uuid
from dataclasses import dataclass
from urllib.parse import quote, unquote

import anyio
from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile
from fastapi.responses import Response
from pydantic import ValidationError
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from .. import storage
from ..auth.dependencies import CurrentUser
from ..auth.viewer_scope import is_viewer
from ..database import get_db
from ..incident_archive import keep_report_safely
from ..incident_service import get_incident_or_404
from ..models import DeploymentConfig as DeploymentConfigRow
from ..models import DiveraEmergency, Media, PlanRevision, ReferenceDataset
from ..report import ReportPayload, TafelPrintPayload, compose_report_pdf, compose_tafel_pdf
from ..schichtplan_pdf import compose_schichtplan_pdf
from ..zeitplan_pdf import ZeitplanPayload, compose_zeitplan_pdf

router = APIRouter(tags=["report"])

#: Whose composed Rapport the Einsatz-Ablage keeps – the roles that write the record.
ARCHIVE_ROLES = frozenset({"editor", "el"})

_MAX_FIGURES = 40
_MAX_FIGURE_BYTES = 12 * 1024 * 1024  # 12 MB per captured page — generous for a full-res map PNG
_ALLOWED_FIGURE_TYPES = {"image/png", "image/jpeg", "image/webp"}

# ⚠️ The canonical 8-4-4-4-12 UUID shape, NOT a loose 36 hex-or-dash characters: `uuid.UUID()`
# on a matching-but-invalid string («0»×36, dashes in the wrong places) raised a ValueError that
# surfaced as a 500 for everyone on the incident — reachable with a low-trust capture/poster token
# (SEC-06, 05.09.). Every string this now matches is a UUID the constructor accepts, so a malformed
# media URL simply fails to match and is skipped like a missing row.
_MEDIA_URL = re.compile(r"^/api/media/([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12})$")
#: ⚠️ The query string is OPTIONAL, and ignored. Plan URLs carry the dataset's version
#: (`?v=3`) so that re-uploading a Modul-PDF produces a NEW url and every cache — the service
#: worker's, pdf.js' document cache, the rendered-bitmap cache — misses instead of serving the
#: sheet somebody replaced. Anchored without it, this pattern matched none of those urls and
#: the plan page dropped out of the printed rapport in silence, exactly like the logo below.
_REFERENCE_URL = re.compile(r"^/api/reference/([^/?#]+)(?:\?[^#]*)?$")
#: The pinned revision a plan-page URL names (`?v=3`): the printed rapport must show the exact
#: original the incident worked on, not whatever replaced it since (plan_revisions).
_REFERENCE_VERSION = re.compile(r"[?&]v=(\d+)(?:&|$)")
#: ⚠️ `.+`, not `[^/]+`: the storage key IS a path («branding/<uuid>.png»), which is why the
#: route itself declares `{key:path}`. A slash-free pattern here matched nothing, so the logo
#: was skipped in silence — stored, served, configured, and absent from the sheet.
_BRANDING_URL = re.compile(r"^/api/branding/file/(.+)$")

#: The station's logo on the printed rapport, under the composer's `logo` figure key. Resolved
#: HERE rather than uploaded by the client: the deployment config is the server's own record of
#: which brigade this is, and a client-supplied logo would let a poster token print any picture
#: it liked at the top of a document that gets signed.
_LOGO_KEY = "logo"


async def _resolve_logo(db: AsyncSession, figs: dict[str, bytes]) -> None:
    row = (await db.execute(select(DeploymentConfigRow))).scalars().first()
    assets = ((row.config_json if row else None) or {}).get("identity", {}).get("assets", {})
    # the rapport's own letterhead wins; the app brandmark is the fallback, so a station that
    # only ever uploaded one logo still gets a sensible sheet
    url = assets.get("reportLogo") or assets.get("logo")
    if not isinstance(url, str):
        return
    m = _BRANDING_URL.match(url)
    if not m:
        return
    key = m.group(1)
    # same guard the public route applies — this key comes from our own config, but a resolver
    # that reads whatever a path says is one config edit away from being an arbitrary-file read
    if not key.startswith("branding/") or ".." in key:
        return
    try:
        figs[_LOGO_KEY] = await storage.aget_bytes(key)
    except OSError:
        return  # the rapport prints without it — a missing logo is never worth failing over


async def _resolve_logo_bytes(db: AsyncSession) -> bytes | None:
    """The same resolution `_resolve_logo` does for the rapport's figs dict, for the
    Schichtplan/Verfügbarkeiten composers — they take the logo as a plain argument rather than
    through the figs-dict convention the rapport's asset pipeline uses (they have no other
    server-resolved assets to share that dict with)."""
    figs: dict[str, bytes] = {}
    await _resolve_logo(db, figs)
    return figs.get(_LOGO_KEY)


#: The one refusal for every way a payload can reach past the incident its route authorised.
#: One message, like the incident link's `_Denied`: «gibt es nicht» and «gehört nicht dir» must
#: not be distinguishable, or the refusal draws a map of the media store.
OUT_OF_SCOPE_DETAIL = "Rapport enthält Inhalte ausserhalb dieses Einsatzes"


@dataclass(frozen=True)
class ReportAssetScope:
    """Which server-owned assets a caller may pull into the rapport it asks us to compose.

    Only a caller whose read surface is NARROWER than the station needs one, which is why the
    parameter is optional everywhere and defaults to ``None`` = no extra restriction: an editor
    or el already reads every incident's media and every reference dataset through the plain
    API, so scoping its own rapport would remove legitimate documents and close nothing.

    A signed-in ``viewer`` is narrower: it reads only the Einsätze inside its window
    (auth/viewer_scope), and a foreign ``/api/media/<id>`` in the payload let it print an
    out-of-window photo it could not GET (RBAC audit S6, 22.10.2026). Its rapport takes the
    path incident's media only; the plans stay open (``plan_dataset_ids=None``) — a viewer reads
    every reference dataset anyway.

    The Erfassungs-Poster is narrower still: no plans at all. Its token reaches a window of
    incidents, never the map and never the Pläne, and each of its routes authorises exactly one
    incident. The route knew that; the resolver below — the code that actually opens files —
    did not, so a payload could name an archived incident's photo UUID and get the bytes back
    inside a PDF for an incident the poster may reach (SEC-06). The authorisation now travels
    with the payload.
    """

    #: The incident the route authorised. A payload claiming a different one is refused.
    incident_id: uuid.UUID
    #: Incidents whose media may be embedded.
    media_incident_ids: frozenset[uuid.UUID]
    #: Reference datasets whose plan PDFs may be printed. Empty = no plans at all, None = any.
    plan_dataset_ids: frozenset[str] | None


def _out_of_scope() -> HTTPException:
    return HTTPException(status_code=403, detail=OUT_OF_SCOPE_DETAIL)


def _media_urls(data: ReportPayload) -> list[str]:
    """Every `/api/media/<uuid>` the payload asks the server to open — journal pictures (incl.
    the legacy single `photoUrl`) and Beilagen. One list so the scope check and the resolver
    below cannot drift apart on which doors exist."""
    urls: list[str] = []
    for row in data.journal:
        urls.extend(row.photoUrls or ([row.photoUrl] if row.photoUrl else []))
    urls.extend(att.url for att in data.attachments if att.url)
    return urls


async def _check_asset_scope(db: AsyncSession, data: ReportPayload, scope: ReportAssetScope) -> None:
    """Refuse — never silently drop — a payload that reaches past `scope`.

    Refusing rather than skipping is deliberate: a missing picture is an accident the rapport
    survives (see the resolver's own `continue`s), but a picture from another Einsatz is a
    request nobody's form can produce, and answering it with a quietly incomplete PDF would
    make the boundary invisible to whoever is holding the paper.
    """
    claimed = (data.incident.id or "").strip()
    if claimed and claimed != str(scope.incident_id):
        raise _out_of_scope()

    for url in _media_urls(data):
        m = _MEDIA_URL.match(url)
        if not m:
            continue  # not a media reference at all — the resolver ignores it too
        media = (await db.execute(select(Media).where(Media.id == uuid.UUID(m.group(1))))).scalar_one_or_none()
        # A row that is GONE stays the resolver's "ship without it" case: deleting a Beilage
        # mid-Erfassung must not turn the next print into a refusal.
        if media is not None and media.incident_id not in scope.media_incident_ids:
            raise _out_of_scope()

    if scope.plan_dataset_ids is None:
        return
    for pp in data.planPages:
        if not pp.url:
            continue
        m = _REFERENCE_URL.match(pp.url)
        if not m:
            continue
        # Checked against the allowed set BEFORE any lookup, so «no such dataset» and «not
        # yours» stay one answer.
        if unquote(m.group(1)) not in scope.plan_dataset_ids:
            raise _out_of_scope()


#: How much of a rejected Rapport payload may echo back in its 422 — enough to name the offending
#: field, never enough to be worth POSTing a big body to provoke. Mirrors the caps the app-wide
#: RequestValidationError handler applies in app/main.py.
_MAX_PAYLOAD_ERRORS = 5
_MAX_PAYLOAD_MSG_CHARS = 200
_MAX_LOC_PARTS = 10
_MAX_LOC_PART_CHARS = 100


def parse_report_payload(payload: str) -> ReportPayload:
    """The one place the wire payload is validated, so every caller answers 422 identically."""
    try:
        return ReportPayload.model_validate_json(payload)
    except ValidationError as e:
        # ⚠️ Redacted, never `e.errors()` raw: pydantic puts the offending value back under `input`
        # (and again inside `ctx`), so a 200 KB invalid field answered with a ~200 KB body — an
        # amplifier a caller with report access (a poster token included) could aim at the one
        # service every tablet talks to (SEC-04, 05.09.). `loc`/`msg`/`type` name the field and what
        # was expected; the value is gone, and `loc` itself is bounded — a caller-chosen dict key
        # lives there too.
        fields = [
            {
                "loc": [str(p)[:_MAX_LOC_PART_CHARS] for p in err.get("loc", ())[:_MAX_LOC_PARTS]],
                "msg": str(err.get("msg", ""))[:_MAX_PAYLOAD_MSG_CHARS],
                "type": str(err.get("type", "")),
            }
            for err in e.errors(include_url=False)[:_MAX_PAYLOAD_ERRORS]
        ]
        raise HTTPException(status_code=422, detail={"error": "Ungültige Rapport-Daten", "fields": fields}) from e


async def resolve_report_assets(
    db: AsyncSession,
    data: ReportPayload,
    figs: dict[str, bytes],
    scope: ReportAssetScope | None = None,
) -> dict[str, bytes]:
    """Load the server-owned assets the composer needs: journal photos from the media
    store (keyed `photo:<url>` into `figs`) and plan PDFs from the reference store
    (returned as url→bytes). Missing/foreign assets are skipped — the rapport ships
    without that picture rather than failing.

    `scope`, when given, is the narrower caller's authorisation (see `ReportAssetScope`): the
    payload is refused outright before a single file is opened if it names anything outside it.
    """
    if scope is not None:
        await _check_asset_scope(db, data, scope)
    await _resolve_logo(db, figs)

    for row in data.journal:
        # a row may carry several pictures; the legacy single `photoUrl` is just the one-element case
        for url in row.photoUrls or ([row.photoUrl] if row.photoUrl else []):
            if f"photo:{url}" in figs:
                continue
            m = _MEDIA_URL.match(url)
            if not m:
                continue
            media = (await db.execute(select(Media).where(Media.id == uuid.UUID(m.group(1))))).scalar_one_or_none()
            if media is None or not media.storage_key:
                continue
            try:
                figs[f"photo:{url}"] = await storage.aget_bytes(media.storage_key)
            except OSError:
                continue

    # Beilagen resolve exactly like a journal photo — same media store, same `photo:<url>` key,
    # so the composer needs one lookup path and a missing file drops that plate rather than the
    # whole rapport.
    for att in data.attachments:
        if not att.url or f"photo:{att.url}" in figs:
            continue
        m = _MEDIA_URL.match(att.url)
        if not m:
            continue
        media = (await db.execute(select(Media).where(Media.id == uuid.UUID(m.group(1))))).scalar_one_or_none()
        if media is None or not media.storage_key:
            continue
        try:
            figs[f"photo:{att.url}"] = await storage.aget_bytes(media.storage_key)
        except OSError:
            continue

    plan_pdfs: dict[str, bytes] = {}
    for pp in data.planPages:
        if not pp.url:
            continue
        m = _REFERENCE_URL.match(pp.url)
        if not m:
            continue
        # ⚠️ unquote: the client percent-encodes the dataset id (referenceUrl uses
        # encodeURIComponent), and every real plan id carries colons («plan:<obj>:<module>»)
        # — so the raw match is `plan%3A…` and the DB lookup found nothing. The serving route
        # never noticed because FastAPI decodes its path params; this resolver reads the raw
        # URL string, so it has to decode itself or every annotated Objektplan page drops out
        # of the printed rapport in silence.
        ds_id = unquote(m.group(1))
        ds = (await db.execute(select(ReferenceDataset).where(ReferenceDataset.id == ds_id))).scalar_one_or_none()
        if ds is None or not ds.storage_key or ds.kind != "pdf":
            continue
        key = ds.storage_key
        vm = _REFERENCE_VERSION.search(pp.url)
        if vm and int(vm.group(1)) != ds.current_version:
            revision = await db.get(PlanRevision, (ds_id, int(vm.group(1))))
            if revision is None:
                continue  # a revisioned URL that names nothing prints nothing, not the wrong sheet
            key = revision.storage_key
        try:
            plan_pdfs[pp.url] = await storage.aget_bytes(key)
        except OSError:
            continue
    return plan_pdfs


async def _alarm_ref(db: AsyncSession, incident_id: str) -> str | None:
    """The alerting system's own reference for this incident's alarm — the number WinFAP and
    the cantonal statistics join on, and the same one ``api.stats`` exports as ``alarm_ref``.

    Resolved HERE rather than sent by the client: the pool row is the authority, and a rapport
    printed from a stale tab must not put a different number on paper from the one the exporter
    sends. Earliest arrival wins, exactly as ``stats._alarm_refs`` does it — an incident can
    absorb a second pool alarm (split dispatch), and the first alarm is the one whose slip was
    printed. Best-effort: a rapport never fails to compose over a missing reference.
    """
    try:
        iid = uuid.UUID(incident_id)
    except (ValueError, AttributeError):
        return None
    return (
        await db.execute(
            select(DiveraEmergency.divera_number)
            .where(DiveraEmergency.taken_incident_id == iid)
            .where(DiveraEmergency.divera_number.is_not(None))
            .order_by(DiveraEmergency.received_at.asc())
            .limit(1)
        )
    ).scalar_one_or_none()


async def compose_report_from_payload(
    db: AsyncSession,
    payload: str,
    figs: dict[str, bytes] | None = None,
    scope: ReportAssetScope | None = None,
) -> tuple[bytes, ReportPayload]:
    """Validate the JSON `payload` and compose the Rapport-PDF — the one path shared by
    the download endpoints (editor + capture) and the print-relay enqueue endpoints.

    `scope` narrows which server-owned assets the payload may reach (`ReportAssetScope`);
    omitting it keeps the station-wide behaviour every logged-in session already has.
    """
    data = parse_report_payload(payload)
    figs = figs if figs is not None else {}
    data.incident.alarmRef = await _alarm_ref(db, data.incident.id)
    plan_pdfs = await resolve_report_assets(db, data, figs, scope)
    try:
        # composition does real work now (tile fetch + rasterising) — off the event loop
        pdf = await anyio.to_thread.run_sync(compose_report_pdf, data, figs, plan_pdfs)
    except Exception as e:  # composition is best-effort — never 500 silently
        raise HTTPException(status_code=500, detail="Rapport-PDF konnte nicht erstellt werden.") from e
    return pdf, data


async def warm_report_from_payload(payload: str) -> None:
    """Best-effort tile-cache prewarm (fired when the rapport modal opens). Validates the
    payload and warms the Kroki base tiles off the event loop so a later compose skips the
    slow network round-trips. Swallows everything — a warm miss just means the real render
    pays the cost, exactly as before."""
    try:
        data = ReportPayload.model_validate_json(payload)
    except ValidationError:
        return
    from ..report.kroki_view import warm_report_tiles

    await anyio.to_thread.run_sync(warm_report_tiles, data)


def attachment_headers(filename: str) -> dict[str, str]:
    """`Content-Disposition` for a download named after an Einsatz title.

    Header values are Latin-1, and a title keeps every letter `str.isalnum` accepts: «Čapek AG»
    raised `UnicodeEncodeError` while the response was built, after the whole PDF was composed.
    So the plain `filename=` carries an ASCII fold and `filename*` (RFC 5987) the real name."""
    fallback = unicodedata.normalize("NFKD", filename).encode("ascii", "ignore").decode() or "download.pdf"
    return {"Content-Disposition": f"attachment; filename=\"{fallback}\"; filename*=UTF-8''{quote(filename)}"}


def report_filename(title: str) -> str:
    safe = "".join(c for c in title if c.isalnum() or c in " -_").strip().replace(" ", "_")[:60] or "Einsatzrapport"
    return f"Einsatzrapport_{safe}.pdf"


@router.post("/incidents/{incident_id}/report/pdf")
async def report_pdf(
    incident_id: uuid.UUID,
    user: CurrentUser,
    payload: str = Form(...),
    figures: list[UploadFile] = File(default=[]),
    db: AsyncSession = Depends(get_db),
) -> Response:
    inc = await get_incident_or_404(db, incident_id)

    # Uploaded figures are keyed by the multipart filename (a journal row's photoKey, the logo).
    figs: dict[str, bytes] = {}
    for f in figures[:_MAX_FIGURES]:
        if not f.filename or (f.content_type or "") not in _ALLOWED_FIGURE_TYPES:
            continue
        blob = await f.read()
        if 0 < len(blob) <= _MAX_FIGURE_BYTES:
            figs[f.filename] = blob

    # A viewer's rapport embeds its own Einsatz's media only (ReportAssetScope says why).
    scope = (
        ReportAssetScope(incident_id=inc.id, media_incident_ids=frozenset({inc.id}), plan_dataset_ids=None)
        if is_viewer(user)
        else None
    )
    pdf, data = await compose_report_from_payload(db, payload, figs, scope)
    # The Einsatz-Ablage keeps the newest Rapport an editor or EL composed (docs/incident-archive.md);
    # a viewer's narrowed print is not the station's Rapport. Never fails the download.
    if user.role in ARCHIVE_ROLES:
        await keep_report_safely(db, inc, data, pdf)
    return Response(
        content=pdf,
        media_type="application/pdf",
        headers=attachment_headers(report_filename(inc.title)),
    )


def tafel_filename(title: str) -> str:
    safe = "".join(c for c in title if c.isalnum() or c in " -_").strip().replace(" ", "_")[:60] or "Einsatz"
    return f"Tafel_{safe}.pdf"


@router.post("/incidents/{incident_id}/tafel/pdf")
async def tafel_pdf(
    incident_id: uuid.UUID,
    _user: CurrentUser,
    payload: str = Form(...),
    db: AsyncSession = Depends(get_db),
) -> Response:
    """The Tafel's own print (10.10.2026, owner): one page or all of them, the same sheets the
    Rapport carries (app/report_board), without the Rapport around them. Read-only output like
    the rapport, so CurrentUser: whoever may read the Tafel may print it."""
    inc = await get_incident_or_404(db, incident_id)
    try:
        data = TafelPrintPayload.model_validate_json(payload)
    except ValidationError as e:
        raise HTTPException(status_code=422, detail=e.errors(include_url=False)) from e
    if not data.boardPages:
        raise HTTPException(status_code=422, detail="Keine Tafel-Seite zum Drucken.")
    try:
        pdf = await anyio.to_thread.run_sync(compose_tafel_pdf, data)
    except Exception as e:  # never a silent 500
        raise HTTPException(status_code=500, detail="Tafel-PDF konnte nicht erstellt werden.") from e
    return Response(
        content=pdf,
        media_type="application/pdf",
        headers=attachment_headers(tafel_filename(inc.title)),
    )


def zeitplan_filename(title: str, sheet: str = "verfuegbarkeiten") -> str:
    """Named after the SHEET, not after the endpoint. The two must differ: they answer different
    questions, and two downloads landing on one name means the second silently replaces the first
    in a Downloads folder somebody is about to print from."""
    safe = "".join(c for c in title if c.isalnum() or c in " -_").strip().replace(" ", "_")[:60] or "Einsatz"
    stem = "Schichtplan" if sheet == "schichtplan" else "Verfuegbarkeiten"
    return f"{stem}_{safe}.pdf"


def compose_zeitplan_from_payload(payload: str, logo: bytes | None = None) -> tuple[bytes, ZeitplanPayload]:
    """Parse + render one of the two Schichtenplanung sheets. Its own path: no map tiles, no plan
    PDFs, no media — either sheet is names and times, so neither needs the rapport's full asset
    resolution. The one server-resolved asset both DO want, for the same reason the rapport does
    (a Führungsformular that leaves the building should say whose it is), is the station logo —
    resolved by the caller (`_resolve_logo_bytes`) and handed in here, never re-resolved per sheet.

    The two composers are separate modules and neither carries a switch: they are different
    questions with different shapes (Wer × Zeit over continuous time vs Wer × Schicht over discrete
    time). All that is shared is the wire payload, so the surface can ask which sheet it wants.
    """
    try:
        data = ZeitplanPayload.model_validate_json(payload)
    except ValidationError as e:
        raise HTTPException(status_code=422, detail=e.errors(include_url=False)) from e
    compose = compose_schichtplan_pdf if data.sheet == "schichtplan" else compose_zeitplan_pdf
    return compose(data, logo), data


@router.post("/incidents/{incident_id}/zeitplan/pdf")
async def zeitplan_pdf(
    incident_id: uuid.UUID,
    _user: CurrentUser,
    payload: str = Form(...),
    db: AsyncSession = Depends(get_db),
) -> Response:
    """The Schichtenplanung as the printable «Zeitplan» Führungsformular (A4 quer).

    Read-only output like the rapport, so CurrentUser rather than CurrentEditor: a viewer
    coming to relieve the shift may print the sheet they are walking into.
    """
    inc = await get_incident_or_404(db, incident_id)
    logo = await _resolve_logo_bytes(db)
    pdf, data = await anyio.to_thread.run_sync(compose_zeitplan_from_payload, payload, logo)
    return Response(
        content=pdf,
        media_type="application/pdf",
        headers=attachment_headers(zeitplan_filename(inc.title, data.sheet)),
    )
