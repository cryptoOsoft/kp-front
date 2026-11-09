"""Station print relay: fail-closed contract, enqueue→claim→status lifecycle, cancel-only-queued.

The relay is off unless PRINT_AGENT_SECRET is set (agent endpoints 403, status reports
unavailable, enqueue refuses). With the secret set, the agent claims the oldest queued job
exactly once, downloads the composed PDF, and reports done/failed; the app can cancel a job
only while it is still queued (the Rückgängig toast).
"""

import json

import pytest

from app.config import settings

pytestmark = pytest.mark.asyncio

AGENT_SECRET = "print-agent-secret-0123456789ab"
H = {"X-Print-Agent-Secret": AGENT_SECRET}


@pytest.fixture
def relay_secret(monkeypatch):
    monkeypatch.setattr(settings, "print_agent_secret", AGENT_SECRET)
    # heartbeat is module state — reset so tests don't leak freshness into each other
    from app.api import print_relay

    monkeypatch.setattr(print_relay, "_last_seen", None)
    # collapse the long-poll hang so an idle claim returns 204 immediately instead of hanging
    # the production CLAIM_HANG_SEC (the claim-with-a-job path is unaffected — it never waits)
    monkeypatch.setattr(print_relay, "CLAIM_HANG_SEC", 0.0)


async def _login(client, user) -> None:
    r = await client.post("/api/auth/login", json={"user_id": str(user.id), "pin": "135790"})
    assert r.status_code == 200


async def _create_incident(client) -> str:
    r = await client.post("/api/incidents", json={"title": "Brand Hauptstrasse 4"})
    assert r.status_code == 201, r.text
    return r.json()["id"]


def _payload(inc_id: str) -> dict:
    return {
        "incident": {"title": "Brand Hauptstrasse 4", "id": inc_id},
        "generatedAt": "30.06.2026 03:00",
        "proof": {"statusLabel": "intakt", "count": 12, "head": "abcdef0123456789"},
    }


async def _enqueue(client, inc: str) -> str:
    r = await client.post(f"/api/incidents/{inc}/report/print", data={"payload": json.dumps(_payload(inc))})
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["status"] == "queued"
    return body["job_id"]


# --- fail-closed (no secret) ----------------------------------------------------------


async def test_fail_closed_without_secret(client, editor, monkeypatch):
    monkeypatch.setattr(settings, "print_agent_secret", "")
    await _login(client, editor)
    inc = await _create_incident(client)

    r = await client.get("/api/print/status")
    assert r.status_code == 200
    assert r.json() == {"available": False, "online": False}

    r = await client.post(f"/api/incidents/{inc}/report/print", data={"payload": json.dumps(_payload(inc))})
    assert r.status_code == 403

    r = await client.post("/api/print-agent/claim", headers=H)
    assert r.status_code == 403


async def test_agent_wrong_secret_401(client, relay_secret):
    r = await client.post("/api/print-agent/claim", headers={"X-Print-Agent-Secret": "wrong"})
    assert r.status_code == 401
    r = await client.post("/api/print-agent/claim")
    assert r.status_code == 401


# --- lifecycle ------------------------------------------------------------------------


async def test_enqueue_claim_file_done(client, editor, relay_secret):
    await _login(client, editor)
    inc = await _create_incident(client)
    job_id = await _enqueue(client, inc)

    # status flips online after the first agent contact
    r = await client.get("/api/print/status")
    assert r.json() == {"available": True, "online": False}

    r = await client.post("/api/print-agent/claim", headers=H)
    assert r.status_code == 200, r.text
    meta = r.json()
    assert meta["id"] == job_id
    assert meta["kind"] == "report"
    assert meta["filename"].startswith("Einsatzrapport_") and meta["filename"].endswith(".pdf")
    assert meta["color"] is False  # no Kroki in the minimal payload → monochrome print

    r = await client.get("/api/print/status")
    assert r.json() == {"available": True, "online": True}

    # a second claim finds nothing (single queued job already claimed)
    r = await client.post("/api/print-agent/claim", headers=H)
    assert r.status_code == 204

    r = await client.get(f"/api/print-agent/jobs/{job_id}/file", headers=H)
    assert r.status_code == 200
    assert r.headers["content-type"] == "application/pdf"
    assert r.content[:5] == b"%PDF-"

    r = await client.post(f"/api/print-agent/jobs/{job_id}/status", headers=H, json={"status": "done"})
    assert r.status_code == 200
    assert r.json()["status"] == "done"

    # done is terminal — a second report conflicts
    r = await client.post(f"/api/print-agent/jobs/{job_id}/status", headers=H, json={"status": "failed"})
    assert r.status_code == 409


async def test_claim_oldest_first(client, editor, relay_secret):
    await _login(client, editor)
    inc = await _create_incident(client)
    first = await _enqueue(client, inc)
    second = await _enqueue(client, inc)

    r = await client.post("/api/print-agent/claim", headers=H)
    assert r.json()["id"] == first
    r = await client.post("/api/print-agent/claim", headers=H)
    assert r.json()["id"] == second


async def test_failed_status_records_error(client, editor, relay_secret):
    await _login(client, editor)
    inc = await _create_incident(client)
    job_id = await _enqueue(client, inc)
    await client.post("/api/print-agent/claim", headers=H)

    r = await client.post(
        f"/api/print-agent/jobs/{job_id}/status",
        headers=H,
        json={"status": "failed", "error": "CUPS: Drucker nicht erreichbar"},
    )
    assert r.status_code == 200
    assert r.json()["status"] == "failed"


async def test_client_reads_job_lifecycle(client, editor, relay_secret):
    """GET /api/print-jobs/{id} drives the live «wird gedruckt … → gedruckt» toast."""
    await _login(client, editor)
    inc = await _create_incident(client)
    job_id = await _enqueue(client, inc)

    assert (await client.get(f"/api/print-jobs/{job_id}")).json()["status"] == "queued"

    await client.post("/api/print-agent/claim", headers=H)
    assert (await client.get(f"/api/print-jobs/{job_id}")).json()["status"] == "printing"

    await client.post(f"/api/print-agent/jobs/{job_id}/status", headers=H, json={"status": "done"})
    body = (await client.get(f"/api/print-jobs/{job_id}")).json()
    assert body["status"] == "done"
    assert body["finished_at"]

    r = await client.get("/api/print-jobs/00000000-0000-0000-0000-000000000000")
    assert r.status_code == 404


async def test_prewarm_ok_when_available_noop_without_relay(client, editor, monkeypatch):
    await _login(client, editor)
    inc = await _create_incident(client)
    data = {"payload": json.dumps(_payload(inc))}

    monkeypatch.setattr(settings, "print_agent_secret", AGENT_SECRET)
    r = await client.post(f"/api/incidents/{inc}/report/print/prewarm", data=data)
    assert r.status_code == 200 and r.json() == {"ok": True}

    monkeypatch.setattr(settings, "print_agent_secret", "")
    r = await client.post(f"/api/incidents/{inc}/report/print/prewarm", data=data)
    assert r.status_code == 200 and r.json() == {"ok": False}


async def test_color_only_with_rendered_kroki():
    """Colour print iff the Kroki actually renders: payload has kroki data AND the option on."""
    from app.api.print_relay import payload_wants_color
    from app.report import ReportPayload

    base = {"incident": {"title": "T", "id": "i1"}, "generatedAt": "x"}
    kroki = {"entities": [], "drawings": [], "center": [7.5, 47.5], "zoom": 16}
    assert payload_wants_color(ReportPayload.model_validate(base)) is False
    assert payload_wants_color(ReportPayload.model_validate({**base, "kroki": kroki})) is True
    assert (
        payload_wants_color(ReportPayload.model_validate({**base, "kroki": kroki, "options": {"kroki": False}}))
        is False
    )


# --- cancel (Rückgängig) --------------------------------------------------------------


async def test_cancel_only_while_queued(client, editor, relay_secret):
    await _login(client, editor)
    inc = await _create_incident(client)
    job_id = await _enqueue(client, inc)

    r = await client.delete(f"/api/print-jobs/{job_id}")
    assert r.status_code == 200
    assert r.json()["status"] == "cancelled"

    # cancelled job is invisible to the agent
    r = await client.post("/api/print-agent/claim", headers=H)
    assert r.status_code == 204
    r = await client.get(f"/api/print-agent/jobs/{job_id}/file", headers=H)
    assert r.status_code == 409

    # once claimed, cancel conflicts
    job2 = await _enqueue(client, inc)
    await client.post("/api/print-agent/claim", headers=H)
    r = await client.delete(f"/api/print-jobs/{job2}")
    assert r.status_code == 409


async def test_cancel_gated_by_role_or_ownership(client, editor, viewer, relay_secret):
    """A viewer must not cancel an EDITOR's queued print — the UI disables the button, this is
    the floor under it. Enqueue stays open to every authenticated user (printing is read-only
    output), so the Rückgängig on a job the viewer queued THEMSELVES keeps working."""
    await _login(client, editor)
    inc = await _create_incident(client)
    editors_job = await _enqueue(client, inc)

    await _login(client, viewer)
    r = await client.delete(f"/api/print-jobs/{editors_job}")
    assert r.status_code == 403
    # …and the editor's job is untouched
    assert (await client.get(f"/api/print-jobs/{editors_job}")).json()["status"] == "queued"

    own_job = await _enqueue(client, inc)
    r = await client.delete(f"/api/print-jobs/{own_job}")
    assert r.status_code == 200
    assert r.json()["status"] == "cancelled"


# --- capture twins (poster token) -----------------------------------------------------


async def _set_capture_secret(db_session, token: str) -> None:
    from app.models import DeploymentConfig

    db_session.add(DeploymentConfig(id=1, config_json=None, capture_secret=token))
    await db_session.commit()


async def test_capture_print_flow(client, editor, db_session, relay_secret):
    await _set_capture_secret(db_session, "poster-token-1")
    ch = {"X-Capture-Token": "poster-token-1"}

    await _login(client, editor)
    inc = await _create_incident(client)
    await client.post("/api/auth/logout")

    r = await client.get("/api/capture/print/status", headers=ch)
    assert r.status_code == 200
    assert r.json() == {"available": True, "online": False}

    r = await client.post(
        f"/api/capture/incidents/{inc}/report/print",
        headers=ch,
        data={"payload": json.dumps(_payload(inc))},
    )
    assert r.status_code == 200, r.text
    job_id = r.json()["job_id"]

    r = await client.delete(f"/api/capture/print-jobs/{job_id}", headers=ch)
    assert r.status_code == 200
    assert r.json()["status"] == "cancelled"


async def test_capture_print_requires_token(client, editor, db_session, relay_secret):
    await _set_capture_secret(db_session, "poster-token-1")
    await _login(client, editor)
    inc = await _create_incident(client)
    await client.post("/api/auth/logout")

    r = await client.post(
        f"/api/capture/incidents/{inc}/report/print",
        headers={"X-Capture-Token": "wrong"},
        data={"payload": json.dumps(_payload(inc))},
    )
    assert r.status_code == 401


async def test_reverse_pdf_pages_turns_the_stack_around():
    """The station printer ejects face-up, so the Rapport is composed in reading order and sent
    reversed — the stack then comes out the right way round. Anything unreadable is returned
    untouched: a rapport in the wrong order is a nuisance, one that never prints is a problem."""
    import io as _io

    import pypdfium2 as pdfium

    from app.api.print_relay import reverse_pdf_pages

    doc = pdfium.PdfDocument.new()
    for _ in range(3):
        doc.new_page(200, 200)
    buf = _io.BytesIO()
    doc.save(buf)

    out = reverse_pdf_pages(buf.getvalue())
    assert len(pdfium.PdfDocument(out)) == 3
    # a one-page document has no order to reverse — same bytes back, no re-encode
    one = pdfium.PdfDocument.new()
    one.new_page(200, 200)
    b1 = _io.BytesIO()
    one.save(b1)
    assert reverse_pdf_pages(b1.getvalue()) == b1.getvalue()
    # garbage in → the original bytes out, never an exception
    assert reverse_pdf_pages(b"not a pdf") == b"not a pdf"


async def test_a_short_agent_secret_is_refused(client, admin_login):
    """The secret reads every queued Rapport-PDF over the internet, so a hand-typed one is
    refused at /admin → Anbindungen; the agent's own `openssl rand -hex 24` (48) passes."""
    await admin_login(client)
    url = "/api/integrations/credentials/print_agent_secret"
    assert (await client.put(url, json={"value": "kurz"})).status_code == 422
    assert (await client.put(url, json={"value": "a" * 48})).status_code == 200


async def test_an_einsatz_cannot_queue_without_end(client, editor, relay_secret):
    """Every account may print and each job stores a whole PDF: past the ceiling a new job is
    refused, and a cancelled one makes room again."""
    from app.api.print_relay import MAX_QUEUED_PER_INCIDENT

    await _login(client, editor)
    inc = await _create_incident(client)
    jobs = [await _enqueue(client, inc) for _ in range(MAX_QUEUED_PER_INCIDENT)]

    data = {"payload": json.dumps(_payload(inc))}
    assert (await client.post(f"/api/incidents/{inc}/report/print", data=data)).status_code == 429

    assert (await client.delete(f"/api/print-jobs/{jobs[0]}")).status_code == 200
    await _enqueue(client, inc)
