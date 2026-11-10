"""Station print relay (`/api/print/*`, `/api/print-agent/*`).

One tap «An Stationsdrucker» queues the server-composed Einsatzrapport-PDF; a tiny on-site
agent (kp-rueck's `tools/print-agent/`, see tools/PRINT-AGENT.md) polls the claim endpoint
over plain HTTPS and prints via
CUPS. Pull-based on purpose: the backend never needs to reach the station LAN.

Fail-closed: without ``PRINT_AGENT_SECRET`` the agent endpoints answer 403, ``/print/status``
reports ``available: false``, and the client never shows the button. The agent secret grants
exactly claim/read queued PDFs + write job status — no incident data, no roster, no admin.

The agent heartbeat is in-memory (module global): prod runs a single uvicorn worker
(backend/start.sh), and a restart heals within one poll interval (~5 s).
"""

import asyncio
import contextlib
import io
import logging
import uuid
from datetime import UTC, datetime

import anyio
from fastapi import APIRouter, Depends, Form, Header, HTTPException, Response, status
from pydantic import BaseModel
from sqlalchemy import func, select, update
from sqlalchemy.ext.asyncio import AsyncSession

from ..alarms import get_config_model
from ..auth.dependencies import CurrentUser
from ..auth.secret_token import SecretGate
from ..auth.viewer_scope import is_viewer
from ..credentials import get as credential
from ..credentials import load as load_credentials
from ..database import execute_dml, get_db
from ..models import Incident, PrintJob
from ..report import ReportPayload
from .incidents import get_incident_or_404
from .report import (
    ReportAssetScope,
    _resolve_logo_bytes,
    compose_report_from_payload,
    compose_zeitplan_from_payload,
    report_filename,
    warm_report_from_payload,
    zeitplan_filename,
)

logger = logging.getLogger(__name__)

router = APIRouter(tags=["print-relay"])

# The agent's claim request LONG-POLLS: it hangs on the server for up to CLAIM_HANG_SEC,
# woken the instant a job is enqueued (`_job_ready`), instead of the agent re-polling every
# few seconds. Idle HTTP traffic drops ~10× and a freshly queued job is claimed near-
# instantly. CLAIM_RECHECK_SEC is the correctness backstop: enqueue sets the event *before*
# its own COMMIT, so a woken claim may briefly not see the row yet — it re-queries every
# RECHECK regardless, so a raced wake-up costs at most one recheck, never the full hang.
CLAIM_HANG_SEC = 25.0
CLAIM_RECHECK_SEC = 2.0

# Heartbeat marks on connect (start of each hang), so last_seen refreshes about once per
# hang; the online window must comfortably exceed the hang or the dot would flicker offline
# mid-hang. The agent's claim request timeout (KP_CLAIM_TIMEOUT_SEC, default 60) also exceeds
# the hang.
ONLINE_WINDOW_SEC = 45

# Set by enqueue, awaited by the long-polling claim. Module-global: prod runs one uvicorn
# worker; a move to multiple workers wants Postgres LISTEN/NOTIFY here instead (the SQLite
# test harness has no NOTIFY, which is why this stays an in-process Event for now).
_job_ready: asyncio.Event | None = None
_job_loop: asyncio.AbstractEventLoop | None = None


def _job_event() -> asyncio.Event:
    """The enqueue→claim wake-up, lazily bound to the running loop. Recreated only if the loop
    changes — which happens across the test harness's per-test loops; prod has one long-lived
    loop, so the single agent and every enqueue share one event."""
    global _job_ready, _job_loop
    loop = asyncio.get_running_loop()
    if _job_ready is None or _job_loop is not loop:
        _job_ready = asyncio.Event()
        _job_loop = loop
    return _job_ready


_last_seen: datetime | None = None


def relay_available() -> bool:
    """Whether the print relay is switched on at all — read live, not at boot, so a station
    that pastes its agent secret into /admin sees the «An Stationsdrucker» button appear."""
    return bool(credential("print_agent_secret"))


def relay_online() -> bool:
    if _last_seen is None:
        return False
    return (datetime.now(UTC) - _last_seen).total_seconds() < ONLINE_WINDOW_SEC


def _mark_seen() -> None:
    global _last_seen
    _last_seen = datetime.now(UTC)


#: Header-only (no ``?secret=``): the sole caller is the print agent we ship, and a secret in
#: the URL would ride along into every proxy log. Fail-closed — no secret configured means
#: the whole relay surface is off.
_AGENT = SecretGate(
    disabled_detail="Druck-Relay deaktiviert (PRINT_AGENT_SECRET nicht gesetzt)",
    invalid_detail="Ungültiges Print-Agent-Secret",
)


def _check_agent_secret(provided: str | None) -> None:
    _AGENT.check(credential("print_agent_secret"), provided)


def print_status() -> dict:
    return {"available": relay_available(), "online": relay_online()}


def relay_status() -> dict:
    """Read-only admin/system view of the relay connection (incl. the raw heartbeat)."""
    return {
        "configured": relay_available(),
        "online": relay_online(),
        "last_seen": _last_seen.isoformat() if _last_seen else None,
    }


# --- app-facing (kiosk cookie; capture twins live in capture.py) ----------------------


@router.get("/print/status")
async def get_print_status(_user: CurrentUser, db: AsyncSession = Depends(get_db)) -> dict:
    """Availability + heartbeat freshness for the «An Stationsdrucker» button.

    Reads the credential store fresh: this is what makes the button appear on the tablets
    minutes after an admin pastes the agent secret, with nothing restarted."""
    await load_credentials(db)
    return print_status()


def reverse_pdf_pages(pdf: bytes) -> bytes:
    """Return the same document with its pages in reverse order.

    For the STATION PRINTER only. A printer that ejects face-up hands over a stack that is
    back-to-front, and re-sorting a 12-page Rapport by hand is exactly the job nobody has time
    for at 03:00. Reversing the document makes the stack come out in reading order.

    Best-effort by construction: any failure returns the original bytes — a rapport in the wrong
    order is a nuisance, a rapport that never prints is a problem.
    """
    try:
        import pypdfium2 as pdfium

        from ..pdfium_lock import pdfium_lock

        with pdfium_lock:
            src = pdfium.PdfDocument(pdf)
            try:
                n = len(src)
                if n < 2:
                    return pdf
                out = pdfium.PdfDocument.new()
                try:
                    out.import_pages(src, list(reversed(range(n))))
                    buf = io.BytesIO()
                    out.save(buf)
                    return buf.getvalue()
                finally:
                    out.close()
            finally:
                src.close()
    except Exception:  # noqa: BLE001 — see the docstring: never lose the print over the order
        logger.warning("Reversing the Rapport pages failed; printing in reading order", exc_info=True)
        return pdf


async def wants_reverse_order(db: AsyncSession) -> bool:
    """Station setting `report.reversePrintOrder` (default on) — see the schema for why."""
    report = (await get_config_model(db)).report
    return bool(report is None or report.reversePrintOrder)


def payload_wants_color(data: ReportPayload) -> bool:
    """Colour only when the Kroki actually renders — everything else (forms, journal,
    plans) prints monochrome at the agent."""
    return bool(data.options.kroki and data.kroki is not None)


#: Jobs one Einsatz may have waiting for the printer. Every account may print (the shared viewer
#: PIN too) and each job stores a whole PDF, so without a ceiling a script fills the tray and
#: the table. Five is past anything a crew queues by hand: Rapport, two Zeitplan sheets, a retry.
MAX_QUEUED_PER_INCIDENT = 5


async def refuse_when_backed_up(db: AsyncSession, incident_id: uuid.UUID) -> None:
    """429 when this Einsatz already has `MAX_QUEUED_PER_INCIDENT` jobs waiting. Called before
    the PDF is composed, by every route that queues one."""
    queued = await db.scalar(
        select(func.count())
        .select_from(PrintJob)
        .where(PrintJob.incident_id == incident_id, PrintJob.status == "queued")
    )
    if (queued or 0) >= MAX_QUEUED_PER_INCIDENT:
        raise HTTPException(
            status_code=429,
            detail=f"Es warten schon {MAX_QUEUED_PER_INCIDENT} Druckaufträge dieses Einsatzes auf den Stationsdrucker.",
        )


async def enqueue_print_job(
    db: AsyncSession,
    inc: Incident,
    payload: str,
    *,
    kind: str,
    requested_by: uuid.UUID | None,
    scope: ReportAssetScope | None = None,
) -> PrintJob:
    """Compose the Rapport-PDF (same path as the download endpoints) and queue it.

    `scope` is the download's own narrowing (`ReportAssetScope`): paper may reach no more than
    the PDF the same caller could download."""
    if not relay_available():
        raise HTTPException(status_code=403, detail="Stationsdrucker nicht konfiguriert")
    await refuse_when_backed_up(db, inc.id)
    pdf, data = await compose_report_from_payload(db, payload, scope=scope)
    # the PRINTER gets the stack it can deliver in order; the downloaded PDF stays as it reads
    if await wants_reverse_order(db):
        # Waiting for another PDFium operation must not block the API event loop.
        pdf = await anyio.to_thread.run_sync(reverse_pdf_pages, pdf)
    job = PrintJob(
        incident_id=inc.id,
        kind=kind,
        filename=report_filename(inc.title),
        pdf=pdf,
        status="queued",
        color=payload_wants_color(data),
        requested_by=requested_by,
    )
    db.add(job)
    await db.flush()
    # Wake a long-polling agent. Set before this request commits: the claim's re-check window
    # (CLAIM_RECHECK_SEC) covers the brief gap until the row is visible to its own session.
    _job_event().set()
    return job


async def cancel_print_job(db: AsyncSession, job_id: uuid.UUID) -> dict:
    """Cancel iff still queued — this backs the Rückgängig toast. Already claimed → 409."""
    job = (await db.execute(select(PrintJob).where(PrintJob.id == job_id))).scalar_one_or_none()
    if job is None:
        raise HTTPException(status_code=404, detail="Druckauftrag nicht gefunden")
    if job.status != "queued":
        raise HTTPException(status_code=409, detail="Druckauftrag ist nicht mehr in der Warteschlange")
    job.status = "cancelled"
    job.finished_at = datetime.now(UTC)
    await db.flush()
    return {"job_id": str(job.id), "status": job.status}


def job_view(job: PrintJob) -> dict:
    """Lifecycle snapshot the client polls to drive the live «wird gedruckt … ✓» toast."""
    return {
        "id": str(job.id),
        "status": job.status,  # queued | printing | done | failed | cancelled
        "kind": job.kind,
        "filename": job.filename,
        "error": job.error,
        "created_at": job.created_at.isoformat() if job.created_at else None,
        "claimed_at": job.claimed_at.isoformat() if job.claimed_at else None,
        "finished_at": job.finished_at.isoformat() if job.finished_at else None,
    }


@router.post("/incidents/{incident_id}/report/print")
async def report_print(
    incident_id: uuid.UUID,
    user: CurrentUser,
    payload: str = Form(...),
    db: AsyncSession = Depends(get_db),
) -> dict:
    inc = await get_incident_or_404(db, incident_id)
    # A viewer's rapport embeds its own Einsatz's media only — the same scope as report/pdf.
    scope = (
        ReportAssetScope(incident_id=inc.id, media_incident_ids=frozenset({inc.id}), plan_dataset_ids=None)
        if is_viewer(user)
        else None
    )
    job = await enqueue_print_job(db, inc, payload, kind="report", requested_by=user.id, scope=scope)
    return {"job_id": str(job.id), "status": job.status}


@router.post("/incidents/{incident_id}/zeitplan/print")
async def zeitplan_print(
    incident_id: uuid.UUID,
    user: CurrentUser,
    payload: str = Form(...),
    db: AsyncSession = Depends(get_db),
) -> dict:
    """Queue one of the two Schichtenplanung sheets for the station printer — «Verfügbarkeiten»
    or «Schichtplan», whichever the payload names. The sheet you hang at the front. Always
    monochrome: it is rules, marks and bars, and a colour cartridge is a consumable."""
    if not relay_available():
        raise HTTPException(status_code=403, detail="Stationsdrucker nicht konfiguriert")
    inc = await get_incident_or_404(db, incident_id)
    await refuse_when_backed_up(db, inc.id)
    # same letterhead as the downloaded sheet — the relay print is not the poor sibling
    pdf, data = compose_zeitplan_from_payload(payload, await _resolve_logo_bytes(db))
    job = PrintJob(
        incident_id=inc.id,
        kind="zeitplan",
        filename=zeitplan_filename(inc.title, data.sheet),
        pdf=pdf,
        status="queued",
        color=False,
        requested_by=user.id,
    )
    db.add(job)
    await db.flush()
    _job_event().set()
    return {"job_id": str(job.id), "status": job.status}


@router.post("/incidents/{incident_id}/report/print/prewarm")
async def report_print_prewarm(
    incident_id: uuid.UUID,
    _user: CurrentUser,
    payload: str = Form(...),
    db: AsyncSession = Depends(get_db),
) -> dict:
    """Speculatively warm the map-tile cache when the rapport modal opens, so the real
    enqueue render is near-instant. Best-effort: no printer side effects, never fails hard."""
    if not relay_available():
        return {"ok": False}
    await get_incident_or_404(db, incident_id)  # 404 rather than warming a cache for nothing
    await warm_report_from_payload(payload)
    return {"ok": True}


@router.get("/print-jobs/{job_id}")
async def report_print_job(
    job_id: uuid.UUID,
    _user: CurrentUser,
    db: AsyncSession = Depends(get_db),
) -> dict:
    job = (await db.execute(select(PrintJob).where(PrintJob.id == job_id))).scalar_one_or_none()
    if job is None:
        raise HTTPException(status_code=404, detail="Druckauftrag nicht gefunden")
    return job_view(job)


@router.delete("/print-jobs/{job_id}")
async def report_print_cancel(
    job_id: uuid.UUID,
    user: CurrentUser,
    db: AsyncSession = Depends(get_db),
) -> dict:
    """Cancel a queued job. Enqueue and status stay open to every authenticated user
    (printing a rapport is read-only output, see api/report.py) — but cancelling destroys
    somebody ELSE's queued paper, which is an edit. So: an editor may cancel any job, a
    viewer only one they queued themselves (the Rückgängig on their own toast). The UI
    disables the buttons for viewers too; this is the floor under that."""
    if user.role != "editor":
        job = (await db.execute(select(PrintJob).where(PrintJob.id == job_id))).scalar_one_or_none()
        if job is None:
            raise HTTPException(status_code=404, detail="Druckauftrag nicht gefunden")
        if job.requested_by != user.id:
            raise HTTPException(status_code=403, detail="Nur eigene Druckaufträge können abgebrochen werden")
    return await cancel_print_job(db, job_id)


# --- agent-facing (X-Print-Agent-Secret) ----------------------------------------------


class AgentJobStatus(BaseModel):
    status: str  # 'done' | 'failed'
    error: str | None = None


async def _try_claim(db: AsyncSession) -> dict | None:
    """Atomically claim the oldest queued job, or None when the queue is empty.
    Conditional UPDATE guards the claim (portable to the SQLite test harness, atomic on one
    row); the single agent makes real contention theoretical anyway."""
    for _ in range(3):
        job = (
            await db.execute(
                select(PrintJob).where(PrintJob.status == "queued").order_by(PrintJob.created_at.asc()).limit(1)
            )
        ).scalar_one_or_none()
        if job is None:
            return None
        claimed = await execute_dml(
            db,
            update(PrintJob)
            .where(PrintJob.id == job.id, PrintJob.status == "queued")
            .values(status="printing", claimed_at=datetime.now(UTC)),
        )
        if claimed.rowcount:
            await db.flush()
            return {
                "id": str(job.id),
                "kind": job.kind,
                "incident_id": str(job.incident_id),
                "filename": job.filename,
                "color": job.color,
                "created_at": job.created_at.isoformat() if job.created_at else None,
            }
    return None


@router.post("/print-agent/claim")
async def agent_claim(
    x_print_agent_secret: str | None = Header(default=None),
    db: AsyncSession = Depends(get_db),
):
    """Long-poll: claim the oldest queued job (→ metadata JSON), or hang up to CLAIM_HANG_SEC
    and answer 204 when the queue stays idle. Woken instantly by `_job_ready` on enqueue.
    Every call is also the heartbeat that keeps the relay «online» in the UI."""
    await load_credentials(db)
    _check_agent_secret(x_print_agent_secret)
    _mark_seen()
    loop = asyncio.get_running_loop()
    ev = _job_event()
    deadline = loop.time() + CLAIM_HANG_SEC
    while True:
        ev.clear()
        job = await _try_claim(db)
        if job is not None:
            return job
        # Nothing to claim — end the read transaction so we don't idle-in-transaction while
        # the request hangs, then wait to be woken (or re-check after CLAIM_RECHECK_SEC).
        await db.rollback()
        remaining = deadline - loop.time()
        if remaining <= 0:
            return Response(status_code=status.HTTP_204_NO_CONTENT)
        with contextlib.suppress(TimeoutError):
            await asyncio.wait_for(ev.wait(), timeout=min(CLAIM_RECHECK_SEC, remaining))


@router.get("/print-agent/jobs/{job_id}/file")
async def agent_job_file(
    job_id: uuid.UUID,
    x_print_agent_secret: str | None = Header(default=None),
    db: AsyncSession = Depends(get_db),
) -> Response:
    await load_credentials(db)
    _check_agent_secret(x_print_agent_secret)
    _mark_seen()
    job = (await db.execute(select(PrintJob).where(PrintJob.id == job_id))).scalar_one_or_none()
    if job is None:
        raise HTTPException(status_code=404, detail="Druckauftrag nicht gefunden")
    if job.status == "cancelled":
        raise HTTPException(status_code=409, detail="Druckauftrag wurde abgebrochen")
    return Response(content=job.pdf, media_type="application/pdf")


@router.post("/print-agent/jobs/{job_id}/status")
async def agent_job_status(
    job_id: uuid.UUID,
    body: AgentJobStatus,
    x_print_agent_secret: str | None = Header(default=None),
    db: AsyncSession = Depends(get_db),
) -> dict:
    await load_credentials(db)
    _check_agent_secret(x_print_agent_secret)
    _mark_seen()
    if body.status not in {"done", "failed"}:
        raise HTTPException(status_code=422, detail="status muss 'done' oder 'failed' sein")
    job = (await db.execute(select(PrintJob).where(PrintJob.id == job_id))).scalar_one_or_none()
    if job is None:
        raise HTTPException(status_code=404, detail="Druckauftrag nicht gefunden")
    if job.status != "printing":
        raise HTTPException(status_code=409, detail=f"Druckauftrag ist '{job.status}', nicht 'printing'")
    job.status = body.status
    job.error = (body.error or "").strip()[:2000] or None
    job.finished_at = datetime.now(UTC)
    await db.flush()
    return {"job_id": str(job.id), "status": job.status}
