"""Media: upload photos/audio/generic Beilagen to object storage, stream them back (auth required).

The workspace blob references a media id/URL instead of an inline blob, so history keeps
the file. Returned URL is same-origin (`/api/media/{id}`).
"""

import asyncio
import hashlib
import io
import json
import logging
import mimetypes
import os
import re
import tempfile
import uuid
import zipfile
from datetime import UTC, datetime
from typing import Literal

from fastapi import APIRouter, Depends, File, Form, HTTPException, Request, UploadFile
from fastapi.responses import FileResponse, JSONResponse
from PIL import Image, ImageOps
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from starlette.background import BackgroundTask

from .. import audio, database, incident_archive, storage
from ..auth.dependencies import CurrentEditor, CurrentRecordWriter, CurrentUser
from ..auth.incident_link import link_session_incident
from ..credentials import get as credential
from ..credentials import load as load_credentials
from ..database import get_db
from ..incident_service import INCIDENT_NOT_FOUND, get_incident_or_404
from ..models import Incident, Media, SttJob

router = APIRouter(tags=["media"])
logger = logging.getLogger(__name__)

_EXT = {
    "image/jpeg": ".jpg",
    "image/png": ".png",
    "image/webp": ".webp",
    "audio/webm": ".webm",
    "audio/mpeg": ".mp3",
    "audio/ogg": ".ogg",
    "audio/wav": ".wav",
    "audio/mp4": ".m4a",
    "audio/x-m4a": ".m4a",
    "audio/m4a": ".m4a",
    "application/pdf": ".pdf",
    "text/plain": ".txt",
    "text/csv": ".csv",
    "application/zip": ".zip",
    "application/msword": ".doc",
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document": ".docx",
    "application/vnd.ms-excel": ".xls",
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": ".xlsx",
    "application/vnd.oasis.opendocument.text": ".odt",
    "application/vnd.oasis.opendocument.spreadsheet": ".ods",
}

# Allowlist: only the types we know how to store and serve back. Anything else (executables,
# html, octet-stream) is rejected with 415 so a stored blob can't be a vector.
# The M4A trio covers Apple Voice Memos exports across inconsistent browser MIME labelling.
_ALLOWED_PHOTO = {"image/jpeg", "image/png", "image/webp"}
_ALLOWED_AUDIO = {"audio/webm", "audio/mpeg", "audio/ogg", "audio/wav", "audio/mp4", "audio/x-m4a", "audio/m4a"}
# kind='file' — the generic Beilage the journal's upload button takes (a PDF from the
# Gebäudeeigentümer, a Stoffdatenblatt, a list). ⚠️ Served back as a DOWNLOAD, never inline
# (see get_media): these are documents, and an inline document is a rendering engine.
_ALLOWED_FILE = {
    "application/pdf",
    "text/plain",
    "text/csv",
    "application/zip",
    "application/msword",
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    "application/vnd.ms-excel",
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    "application/vnd.oasis.opendocument.text",
    "application/vnd.oasis.opendocument.spreadsheet",
}
_M4A_TYPES = {"audio/mp4", "audio/x-m4a", "audio/m4a"}

# External Voice Memos can be hours long — stream to disk in chunks (never file.read() the
# whole body into memory) and cap the size. Cap is a module constant so tests can shrink it.
MAX_UPLOAD_BYTES = 100 * 1024 * 1024
_CHUNK = 1024 * 1024


def _looks_like_isobmff(head: bytes) -> bool:
    """M4A is an ISO-BMFF container: box size (4 bytes) then the literal 'ftyp'."""
    return len(head) >= 12 and head[4:8] == b"ftyp"


# The declared content type is whatever the client claims, and get_media serves the stored
# bytes back UNDER that label — so for the types a decoder or viewer will open, the head
# bytes have to actually be that type. Hand-rolled prefix checks on the first chunk (which
# is read anyway), deliberately not python-magic. Types without an entry (txt/csv/zip/office)
# pass unsniffed; audio keeps its own M4A check above.
_MAGIC_PREFIXES = {
    "image/jpeg": b"\xff\xd8\xff",
    "image/png": b"\x89PNG\r\n\x1a\n",
    "application/pdf": b"%PDF-",
}


def _matches_declared_type(content_type: str, head: bytes) -> bool:
    if content_type == "image/webp":  # RIFF container: 'RIFF' <size> 'WEBP'
        return len(head) >= 12 and head[:4] == b"RIFF" and head[8:12] == b"WEBP"
    prefix = _MAGIC_PREFIXES.get(content_type)
    return prefix is None or head.startswith(prefix)


# CurrentRecordWriter, not CurrentEditor (07.09.2026): the ``el`` role adds Rapport-Beilagen,
# and the bytes come through here. Links stay excluded; the transcription routes below stay
# editor-only — they belong to the Verlauf, not the record slice.
@router.post("/incidents/{incident_id}/media", status_code=201)
async def upload_media(
    incident_id: uuid.UUID,
    user: CurrentRecordWriter,
    file: UploadFile = File(...),
    kind: str = Form(...),
    db: AsyncSession = Depends(get_db),
) -> dict:
    if kind not in ("photo", "audio", "file"):
        raise HTTPException(status_code=422, detail="kind muss 'photo', 'audio' oder 'file' sein")
    inc = (
        await db.execute(select(Incident.is_archived, Incident.is_exercise).where(Incident.id == incident_id))
    ).one_or_none()
    if inc is None:
        raise HTTPException(status_code=404, detail=INCIDENT_NOT_FOUND)

    content_type = file.content_type or "application/octet-stream"
    allowed = {"photo": _ALLOWED_PHOTO, "audio": _ALLOWED_AUDIO}.get(kind, _ALLOWED_FILE)
    if content_type not in allowed:
        raise HTTPException(
            status_code=415,
            detail=f"Dateityp {content_type!r} nicht erlaubt (erwartet: {', '.join(sorted(allowed))})",
        )
    # Peek the first chunk before allocating storage: a file merely *named* .m4a (or a
    # mislabelled octet-stream) must not be stored, so verify the ISO-BMFF signature here.
    first = await file.read(_CHUNK)
    if content_type in _M4A_TYPES and not _looks_like_isobmff(first):
        raise HTTPException(status_code=415, detail="Datei ist keine gültige M4A-Aufnahme")
    # Same rule for images and PDF: a body merely LABELLED as one must not be stored under
    # that trusted label.
    if not _matches_declared_type(content_type, first):
        raise HTTPException(status_code=415, detail=f"Dateiinhalt entspricht nicht dem Typ {content_type!r}")

    ext = _EXT.get(content_type) or mimetypes.guess_extension(content_type) or ""
    key = storage.new_key(f"media/{incident_id}", ext)

    async def _chunks():
        chunk = first
        while chunk:
            yield chunk
            chunk = await file.read(_CHUNK)

    try:
        await storage.put_astream(key, _chunks(), max_bytes=MAX_UPLOAD_BYTES)
    except storage.TooLargeError:
        raise HTTPException(
            status_code=413,
            detail=f"Datei zu gross (Maximum {MAX_UPLOAD_BYTES // (1024 * 1024)} MB)",
        ) from None
    storage.created_in_transaction(db, key)

    # The DB row exists only after a complete, size-checked write — an aborted upload leaves
    # neither a partial blob (put_astream cleans up) nor a dangling Media record.
    media = Media(incident_id=incident_id, kind=kind, storage_key=key, content_type=content_type, created_by=user.id)
    db.add(media)
    await db.flush()
    # A capture that reaches an Einsatz after its close (the offline queue, a late Beilage) is
    # owed to the Einsatz-Ablage too (docs/incident-archive.md) – one outbox row, no Graph call.
    if inc.is_archived and not inc.is_exercise:
        await incident_archive.enqueue(db, incident_id)
    return {"id": str(media.id), "url": f"/api/media/{media.id}", "kind": kind, "content_type": content_type}


def _deny_media_outside_link_scope(request: Request, media: Media) -> None:
    """A link session may only read media belonging to the incident it was minted for.

    ``enforce_link_scope`` binds an allowlisted route to the token's incident by matching an
    ``incident_id`` PATH PARAMETER (``_INCIDENT_PARAMS``). ``/api/media/{media_id}`` carries
    none, so that check has nothing to bind to: the allowlist let the request through and the
    query never mentioned the incident, which made every media row reachable from any link.

    Media ids are UUID4, so this was a broken guarantee rather than an open door — but D57
    says the token is *incident-scoped*, and a route that cannot express its scope has to
    enforce it here instead. 404 rather than 403: a link holder must not learn that a media
    id exists on some other Einsatz.

    A full user session is unaffected — ``link_session_incident`` returns None for it.
    """
    scoped = link_session_incident(request)
    if scoped is not None and str(media.incident_id) != str(scoped):
        raise HTTPException(status_code=404, detail="Medium nicht gefunden")


# A Content-Disposition filename must survive every OS and every proxy — and it BEATS the
# client's `download` attribute, so it is the only place the operator's own name can come from.
_MAX_DISPOSITION_LEN = 150


def _disposition_name(given: str | None, media_id: uuid.UUID, ext: str) -> str:
    """The name a Beilage is saved under: the operator's own, sanitised, or the id fallback.

    The store has no filename column, so the journal row hands its name over as ``?name=``.
    Path separators and non-printable characters are dropped and the length is capped; the
    STORED content type stays authoritative for the extension (a name lacking it — or claiming
    a different one — gets the stored one appended), so the MIME allowlist keeps deciding what
    the saved file is, never the query string. Anything that sanitises to nothing falls back.
    """
    fallback = f"beilage-{media_id}{ext}"
    cleaned = "".join(c for c in (given or "")[: _MAX_DISPOSITION_LEN * 2] if c.isprintable() and c not in "/\\")
    stem = cleaned.strip().strip(".")
    if ext and stem.lower().endswith(ext.lower()):
        stem = stem[: -len(ext)]
    stem = stem[: max(_MAX_DISPOSITION_LEN - len(ext), 1)].strip().strip(".")
    return f"{stem}{ext}" if stem else fallback


@router.get("/media/{media_id}")
async def get_media(
    media_id: uuid.UUID,
    request: Request,
    _user: CurrentUser,
    name: str | None = None,
    db: AsyncSession = Depends(get_db),
) -> FileResponse:
    media = (await db.execute(select(Media).where(Media.id == media_id))).scalar_one_or_none()
    if media is None or not storage.exists(media.storage_key):
        raise HTTPException(status_code=404, detail="Medium nicht gefunden")
    _deny_media_outside_link_scope(request, media)
    # ⚠️ A generic Beilage goes out as a DOWNLOAD (`filename=` sets Content-Disposition:
    # attachment), never inline: a stored document must not be rendered by the browser inside
    # the app's own origin. That header also OVERRIDES the client's `download` attribute, so the
    # operator's own filename has to arrive here — the journal chip appends `?name=` (Journal.tsx)
    # and `_disposition_name` sanitises it; without it the row falls back to `beilage-<id><ext>`.
    if media.kind == "file":
        ext = _EXT.get(media.content_type or "") or mimetypes.guess_extension(media.content_type or "") or ""
        return FileResponse(
            storage.local_path(media.storage_key),
            media_type=media.content_type or None,
            filename=_disposition_name(name, media.id, ext),
        )
    return FileResponse(storage.local_path(media.storage_key), media_type=media.content_type or None)


# ─── thumbnails ────────────────────────────────────────────────────────────────────────
#
# ⚠️ Not an optimisation — a crash fix (31.08.). The Verlauf paints every picture of an Einsatz
# as a ~40 px chip and the Lage paints photo markers at 56 px, but both were pointed at the FULL
# stored image. `imagePrep` caps an upload at 2200 px on the long edge, and a browser decodes
# that whole thing whatever box it is drawn in: ~2200 × 1650 × 4 B ≈ 14 MB of bitmap per picture.
# An iPhone's WebKit content process gets a fraction of what an iPad's does, so a Verlauf with a
# dozen photos in it blew the budget and iOS killed the tab — «A problem repeatedly occurred»,
# reported from the field on a phone while the same Einsatz was fine on the tablets.
#
# 320 px on the long edge covers a 56 px marker at 3× DPR with room to spare, and lands at ~20 kB
# — so the same dozen pictures now cost about what ONE of them used to.
#
# Written next to the original in storage on first request and served from there afterwards:
# rendering is one PIL decode, the file is tiny, and the incident's own media directory keeps
# everything belonging to that Einsatz together (a hard delete of the incident removes the
# original, and an orphaned 20 kB derivative is harmless where a missing one is a broken row).
THUMB_EDGE = 320
_THUMB_QUALITY = 78


def _thumb_key(storage_key: str) -> str:
    return f"{storage_key}.thumb{_EXT['image/jpeg']}"


def _render_thumb(source_path: str, dest_key: str) -> None:
    """Decode, downscale and store one thumbnail. Blocking — call it in a worker thread."""
    with Image.open(source_path) as opened:
        # EXIF orientation is applied here, not in CSS: the chip is square-cropped by the layout,
        # and a sideways thumbnail next to an upright viewer reads as a different picture.
        # (Its own name — exif_transpose returns a plain Image, not the ImageFile it was given.)
        im = ImageOps.exif_transpose(opened) or opened
        im.thumbnail((THUMB_EDGE, THUMB_EDGE))
        buf = io.BytesIO()
        im.convert("RGB").save(buf, format="JPEG", quality=_THUMB_QUALITY, optimize=True)
    storage.put_bytes(dest_key, buf.getvalue())


@router.get("/media/{media_id}/thumb")
async def get_media_thumb(
    media_id: uuid.UUID,
    request: Request,
    _user: CurrentUser,
    db: AsyncSession = Depends(get_db),
) -> FileResponse:
    """A small JPEG for list chips and map markers. Photos only — everything else is a 404, so a
    caller can never make this route decode an arbitrary stored blob."""
    media = (await db.execute(select(Media).where(Media.id == media_id))).scalar_one_or_none()
    if media is None or media.kind != "photo" or not storage.exists(media.storage_key):
        raise HTTPException(status_code=404, detail="Medium nicht gefunden")
    _deny_media_outside_link_scope(request, media)
    key = _thumb_key(media.storage_key)
    if not storage.exists(key):
        try:
            await asyncio.to_thread(_render_thumb, storage.local_path(media.storage_key), key)
        except (OSError, ValueError, Image.DecompressionBombError):
            # An undecodable image (or one too large to open safely) must not cost the row its
            # picture: fall back to the original, which is what every caller used to get.
            logger.warning("thumbnail failed for media %s — serving the original", media_id, exc_info=True)
            return FileResponse(storage.local_path(media.storage_key), media_type=media.content_type or None)
    return FileResponse(storage.local_path(key), media_type="image/jpeg")


def _ascii_slug(text: str) -> str:
    """Filename-safe ASCII slug — a Content-Disposition filename must survive every OS."""
    cleaned = re.sub(r"[^a-z0-9]+", "-", text.lower().replace("ä", "ae").replace("ö", "oe").replace("ü", "ue"))
    return cleaned.strip("-") or "einsatz"


@router.get("/incidents/{incident_id}/media.zip")
async def download_media_archive(
    incident_id: uuid.UUID, _user: CurrentUser, db: AsyncSession = Depends(get_db)
) -> FileResponse:
    """Every Beilage of the Einsatz — photos and recordings in ORIGINAL quality — as one ZIP
    for digital archiving, plus a ``manifest.json`` naming each file with its SHA-256, so an
    archive copy can be checked against the record years later.

    Full user session only (viewer included: archiving is reading). A link session never
    reaches this route — it is not on the allowlist, and must not be: the QR poster's scope
    is contributing, not carrying away the whole Einsatz's media.
    """
    inc = await get_incident_or_404(db, incident_id)
    rows = list(
        (await db.execute(select(Media).where(Media.incident_id == incident_id).order_by(Media.created_at))).scalars()
    )
    stored = [m for m in rows if storage.exists(m.storage_key)]
    if not stored:
        raise HTTPException(status_code=404, detail="Keine Beilagen vorhanden")

    manifest: dict = {
        "incident": {"id": str(inc.id), "title": inc.title, "started_at": inc.started_at.isoformat()},
        "exported_at": datetime.now(UTC).isoformat(),
        "files": [],
    }
    fd, tmp_path = tempfile.mkstemp(suffix=".zip")
    os.close(fd)
    try:
        # blocking file IO in a worker thread — an archive of hour-long recordings must not
        # stall every other request while it is written
        await asyncio.to_thread(_build_archive, stored, manifest, tmp_path)
    except BaseException:
        os.unlink(tmp_path)
        raise
    filename = f"beilagen-{_ascii_slug(inc.title)}-{inc.started_at:%Y%m%d}.zip"
    return FileResponse(
        tmp_path,
        media_type="application/zip",
        filename=filename,
        background=BackgroundTask(os.unlink, tmp_path),
    )


def _build_archive(stored: list[Media], manifest: dict, path: str) -> None:
    """Write the ZIP + fill the manifest — sync on purpose, run via ``asyncio.to_thread``."""
    # counters per kind, so the names read «foto-01», «audio-02» in Aufnahme order
    counts: dict[str, int] = {}
    with zipfile.ZipFile(path, "w", zipfile.ZIP_STORED) as zf:  # media is already compressed
        for m in stored:
            counts[m.kind] = counts.get(m.kind, 0) + 1
            ext = _EXT.get(m.content_type or "") or mimetypes.guess_extension(m.content_type or "") or ""
            kind_name = {"photo": "foto", "file": "beilage"}.get(m.kind, m.kind)
            name = f"{kind_name}-{counts[m.kind]:02d}-{m.created_at:%Y%m%d-%H%M%S}{ext}"
            digest = hashlib.sha256()
            with (
                open(storage.local_path(m.storage_key), "rb") as src,
                zf.open(zipfile.ZipInfo(name, date_time=m.created_at.timetuple()[:6]), "w") as dst,
            ):
                while chunk := src.read(1 << 20):
                    digest.update(chunk)
                    dst.write(chunk)
            manifest["files"].append(
                {
                    "name": name,
                    "kind": m.kind,
                    "content_type": m.content_type,
                    "created_at": m.created_at.isoformat(),
                    "sha256": digest.hexdigest(),
                }
            )
        zf.writestr("manifest.json", json.dumps(manifest, ensure_ascii=False, indent=2))


# Waveform peaks. Lazily computed once per
# recording, cached next to the blob, single-flight per media id. A failed/impossible
# extraction caches {"peaks": null} — the player falls back to a flat bar, never an error.
_peaks_jobs: dict[str, asyncio.Task] = {}


@router.get("/media/{media_id}/peaks")
async def get_peaks(
    media_id: uuid.UUID, request: Request, _user: CurrentUser, db: AsyncSession = Depends(get_db)
) -> JSONResponse:
    media = (await db.execute(select(Media).where(Media.id == media_id))).scalar_one_or_none()
    if media is None or media.kind != "audio" or not storage.exists(media.storage_key):
        raise HTTPException(status_code=404, detail="Medium nicht gefunden")
    # Not on LINK_ALLOWED today, so a link session never reaches here — guarded anyway, so
    # that allowlisting it later cannot silently reopen what the route above just closed.
    _deny_media_outside_link_scope(request, media)
    pkey = audio.peaks_key(media.storage_key)
    if storage.exists(pkey):
        return JSONResponse(json.loads(storage.get_bytes(pkey)))
    job_id = str(media_id)
    task = _peaks_jobs.get(job_id)
    if task is None or task.done():
        task = asyncio.create_task(audio.compute_and_store_peaks(media.storage_key))
        _peaks_jobs[job_id] = task
        task.add_done_callback(lambda _t: _peaks_jobs.pop(job_id, None))
    return JSONResponse({"status": "pending"}, status_code=202)


# ---- Speech-to-text drafts --------------------------------------------------------
# Segments are DRAFTS the operator reviews in the player; confirming appends an ordinary
# journal row client-side and PATCHes the segment status back here. Fail-closed: without
# a configured engine (env stt_base_url) the trigger endpoint answers 503 and the client
# never shows the button (integrations.sttConfigured).

_stt_tasks: dict[str, asyncio.Task] = {}
_stt_gate = asyncio.Semaphore(1)  # one engine call at a time on the single instance


async def _run_stt(media_id: uuid.UUID, storage_key: str) -> None:
    async with _stt_gate:
        try:
            segments = await audio.transcribe(storage.local_path(storage_key))
            status, error = "done", None
            payload = [{**s, "status": "open"} for s in segments]
        except audio.SttError as e:
            status, error, payload = "failed", str(e), None
        except Exception:  # a crashed job must land as 'failed', not vanish
            logger.exception("STT job crashed for media %s", media_id)  # keep the detail server-side
            status, error, payload = "failed", "Unerwarteter Fehler", None
        # resolved through the module so tests can point it at their loop-local factory
        async with database.async_session_maker() as db:
            job = (await db.execute(select(SttJob).where(SttJob.media_id == media_id))).scalar_one_or_none()
            if job is None:
                return
            job.status, job.error, job.segments = status, error, payload
            job.finished_at = datetime.now(UTC)
            await db.commit()


@router.post("/media/{media_id}/transcribe")
async def start_transcription(
    media_id: uuid.UUID, user: CurrentEditor, db: AsyncSession = Depends(get_db)
) -> JSONResponse:
    """First run → fresh engine call (202 + poll). An already-finished job → 200 with the
    existing segments, dismissed ones re-opened: tapping Transkribieren again re-presents
    the suggestions instead of returning nothing — and because POST responses are never
    HTTP-cached, this path also survives clients with a stale cached status GET. Confirmed
    segments stay confirmed (re-opening them would invite duplicate journal rows)."""
    await load_credentials(db)
    if not credential("stt_base_url"):
        raise HTTPException(status_code=503, detail="Kein STT-Server konfiguriert")
    media = (await db.execute(select(Media).where(Media.id == media_id))).scalar_one_or_none()
    if media is None or media.kind != "audio" or not storage.exists(media.storage_key):
        raise HTTPException(status_code=404, detail="Medium nicht gefunden")
    job = (await db.execute(select(SttJob).where(SttJob.media_id == media_id))).scalar_one_or_none()
    key = str(media_id)
    if job is not None and job.status in ("queued", "running") and key in _stt_tasks:
        return JSONResponse({"status": job.status}, status_code=202)
    if job is not None and job.status == "done" and job.segments is not None:
        segments = [{**s, "status": "open"} if s.get("status") == "dismissed" else dict(s) for s in job.segments]
        job.segments = segments
        await db.flush()
        return JSONResponse({"status": "done", "segments": segments})
    if job is None:
        job = SttJob(media_id=media_id)
        db.add(job)
    # a failed (or vanished) run is replaced by a fresh one (drafts are working data)
    job.status, job.error, job.segments, job.finished_at = "running", None, None, None
    job.created_by = user.id
    # COMMIT (not just flush) before spawning the background task: `_run_stt` opens its OWN
    # session and reads this SttJob by media_id. A bare flush leaves the row uncommitted, so a
    # freshly-created job (the re-transcribe-after-delete case) is invisible to that session —
    # it reads `job is None`, returns doing nothing, and the row is left stuck 'running' with no
    # live task, which the get_transcription orphan-check then force-fails ("Serverneustart …").
    await db.commit()
    task = asyncio.create_task(_run_stt(media_id, media.storage_key))
    _stt_tasks[key] = task
    task.add_done_callback(lambda _t: _stt_tasks.pop(key, None))
    return JSONResponse({"status": "running"}, status_code=202)


@router.get("/media/{media_id}/transcription")
async def get_transcription(media_id: uuid.UUID, _user: CurrentUser, db: AsyncSession = Depends(get_db)) -> dict:
    job = (await db.execute(select(SttJob).where(SttJob.media_id == media_id))).scalar_one_or_none()
    if job is None:
        return {"status": "none", "error": None, "segments": None}
    # a job orphaned by a server restart must not spin forever in the player
    if job.status in ("queued", "running") and str(media_id) not in _stt_tasks:
        job.status, job.error = "failed", "Serverneustart während der Transkription"
        await db.flush()
    return {"status": job.status, "error": job.error, "segments": job.segments}


@router.delete("/media/{media_id}/transcription")
async def delete_transcription(media_id: uuid.UUID, _user: CurrentEditor, db: AsyncSession = Depends(get_db)) -> dict:
    """Discard a transcription (drafts are working data — confirmed journal rows stay).
    Resets the recording to 'no job', so Transkribieren can run fresh."""
    job = (await db.execute(select(SttJob).where(SttJob.media_id == media_id))).scalar_one_or_none()
    if job is None:
        raise HTTPException(status_code=404, detail="Keine Transkription vorhanden")
    await db.delete(job)
    await db.flush()
    return {"ok": True}


class SegmentPatch(BaseModel):
    status: Literal["confirmed", "dismissed"]
    rowId: str | None = None  # noqa: N815 — mirrors the frontend's camelCase field
    text: str | None = None  # corrected utterance text (post-confirm edits stay in sync)


@router.patch("/media/{media_id}/transcription/segments/{index}")
async def patch_segment(
    media_id: uuid.UUID,
    index: int,
    body: SegmentPatch,
    _user: CurrentEditor,
    db: AsyncSession = Depends(get_db),
) -> dict:
    job = (await db.execute(select(SttJob).where(SttJob.media_id == media_id))).scalar_one_or_none()
    if job is None or job.status != "done" or not job.segments:
        raise HTTPException(status_code=404, detail="Keine Transkription vorhanden")
    if not (0 <= index < len(job.segments)):
        raise HTTPException(status_code=404, detail="Segment nicht gefunden")
    # reassign (not mutate) so SQLAlchemy's JSONB change detection persists it
    segments = [dict(s) for s in job.segments]
    segments[index]["status"] = body.status
    if body.rowId:
        segments[index]["rowId"] = body.rowId
    if body.text is not None and body.text.strip():
        segments[index]["text"] = body.text.strip()
    job.segments = segments
    await db.flush()
    return {"ok": True}
