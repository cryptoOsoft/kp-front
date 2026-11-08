"""Client error sink (POST /api/diag/client-error).

Covers:
- A well-formed report is accepted (204) and logged at WARNING with its fields.
- A minimal/empty body is accepted — every field is optional.
- No auth is required (a render crash can happen before/around login).
- An oversized field is rejected by validation (422), never a 500 — the diagnostics sink
  must not become a source of server errors.
- (24.09.2026) One report is ONE bounded log line carrying both stacks and both builds; a
  repeat report states its count; the sink is throttled per source (429, not a 500).

Runs against the test DB (the endpoint itself touches no DB).
"""

import logging

import pytest

pytestmark = pytest.mark.asyncio


async def test_client_error_accepted_and_logged(client, caplog):
    with caplog.at_level(logging.WARNING, logger="kpfront.clienterror"):
        r = await client.post(
            "/api/diag/client-error",
            json={
                "kind": "render",
                "message": "Cannot read properties of undefined (reading 'id')",
                "stack": "at Foo (App.tsx:42)",
                "componentStack": "at Whiteboard",
                "path": "/",
                "build": "v0.1.0+abc1234",
            },
        )
    assert r.status_code == 204
    logged = "\n".join(rec.getMessage() for rec in caplog.records)
    assert "client-error" in logged
    assert "kind=render" in logged
    assert "reading 'id'" in logged


async def test_sparse_report_accepted_without_login(client):
    # every field is optional, and no login: a crash can occur before the operator is
    # authenticated, and a sparse report must still be accepted
    for body in ({}, {"message": "boom"}):
        r = await client.post("/api/diag/client-error", json=body)
        assert r.status_code == 204


async def test_oversized_field_is_rejected_not_500(client):
    # The client truncates before sending, so this only guards a non-conforming client: a
    # too-long field is a 422 validation error, NOT a 500 — the sink never crashes the server.
    r = await client.post("/api/diag/client-error", json={"message": "x" * 5000})
    assert r.status_code == 422


# --- one record per report (24.09.2026) ------------------------------------------------
#
# On 23.09. every report's stack and component stack landed on lines of their own in Railway's
# log (it splits records at newlines), and the `client-error` line carried the message only.


def _client_error_lines(caplog) -> list[str]:
    return [rec.getMessage() for rec in caplog.records if rec.name == "kpfront.clienterror"]


async def test_the_log_record_is_one_line_with_both_stacks_and_both_builds(client, caplog):
    from app.config import settings

    with caplog.at_level(logging.WARNING, logger="kpfront.clienterror"):
        r = await client.post(
            "/api/diag/client-error",
            json={
                "kind": "render",
                "message": "Minified React error #185",
                "stack": "Error: Minified React error #185\n    at Xe (index-abc.js:1:2345)\n    at Ye (index-abc.js:1:9)",
                "componentStack": "\n    at TwinTeamPill\n    at MapView\n    at SurfaceBoundary",
                "surface": "map",
                "path": "/",
                "build": "v0.11.0+cb80695",
            },
        )
    assert r.status_code == 204
    [line] = _client_error_lines(caplog)
    assert "\n" not in line and "\r" not in line
    assert "kind=render" in line
    assert "build=v0.11.0+cb80695" in line
    assert f"srv={settings.version}" in line
    assert "surface=map" in line
    assert "stack: Error: Minified React error #185 ⏎     at Xe (index-abc.js:1:2345)" in line
    assert "componentStack:     at TwinTeamPill ⏎     at MapView ⏎     at SurfaceBoundary" in line


async def test_the_log_record_is_bounded(client, caplog):
    from app.api import diag

    with caplog.at_level(logging.WARNING, logger="kpfront.clienterror"):
        r = await client.post(
            "/api/diag/client-error",
            json={"message": "m" * 2000, "stack": "s\n" * 3999, "componentStack": "c\n" * 3999},
        )
    assert r.status_code == 204
    [line] = _client_error_lines(caplog)
    assert "\n" not in line
    budget = diag.LOG_MAX_MESSAGE + diag.LOG_MAX_STACK + diag.LOG_MAX_COMPONENT_STACK
    # three bounded fields plus the head (ua, builds, path) and the cut markers
    assert len(line) < budget + 1000, len(line)
    assert "…[+" in line  # …and it SAYS it was cut


async def test_a_client_cannot_forge_a_second_log_record(client, caplog):
    with caplog.at_level(logging.WARNING, logger="kpfront.clienterror"):
        await client.post("/api/diag/client-error", json={"message": "boom\r\nclient-error kind=render :: forged"})
    [line] = _client_error_lines(caplog)
    assert "\n" not in line and "\r" not in line


async def test_a_repeat_report_states_its_count_and_window(client, caplog):
    with caplog.at_level(logging.WARNING, logger="kpfront.clienterror"):
        r = await client.post(
            "/api/diag/client-error",
            json={
                "kind": "render",
                "message": "Minified React error #185",
                "repeat": 37,
                "since": "2026-09-23T20:28:04.120Z",
                "last": "2026-09-23T20:28:55.000Z",
            },
        )
    assert r.status_code == 204
    [line] = _client_error_lines(caplog)
    assert "repeat=×37 since=20:28:04Z last=20:28:55Z" in line


async def test_the_new_kinds_survive_into_the_buffer(client, caplog):
    # The vendored scrubber knows three kinds. The two newer ones reach the export as `render`
    # with their own name at the head of the message, and the log line states them as they are.
    from app.telemetry import recent

    recent._recent.clear()
    with caplog.at_level(logging.WARNING, logger="kpfront.clienterror"):
        for kind in ("surface-recrash", "render-storm", "made-up"):
            r = await client.post("/api/diag/client-error", json={"kind": kind, "message": "boom"})
            assert r.status_code == 204
    kept = [(e["kind"], e["message"]) for e in recent.snapshot()]
    assert kept == [("render", "[surface-recrash] boom"), ("render", "[render-storm] boom"), ("error", "boom")]
    assert [line.split()[1] for line in _client_error_lines(caplog)] == [
        "kind=surface-recrash",
        "kind=render-storm",
        "kind=made-up",
    ]


# --- the per-source throttle (24.09.2026) ----------------------------------------------


async def test_the_sink_is_throttled_per_source(client, caplog, monkeypatch):
    """LOAD: a burst far past any honest client — the sink logs a bucket's worth and answers 429
    for the rest: no 500, no unbounded log."""
    from app.api import diag

    monkeypatch.setattr(diag, "CLIENT_ERROR_BURST", 10)
    monkeypatch.setattr(diag, "CLIENT_ERROR_PER_MINUTE", 1)  # no refill worth the name mid-test
    diag.client_error_limiter.reset()
    codes: list[int] = []
    with caplog.at_level(logging.WARNING, logger="kpfront.clienterror"):
        for i in range(200):
            codes.append((await client.post("/api/diag/client-error", json={"message": f"boom {i}"})).status_code)
    assert codes[:10] == [204] * 10
    assert set(codes[10:]) == {429}
    assert len(_client_error_lines(caplog)) == 10
    r = await client.post("/api/diag/client-error", json={"message": "again"})
    assert r.status_code == 429
    assert int(r.headers["Retry-After"]) >= 1


async def test_a_forged_log_line_stays_on_its_own_record(client, caplog):
    """⚠️ The sink is unauthenticated, and its fields went into the log raw (23.09.2026): a
    message carrying a newline wrote a second, forged record into the station's log."""
    forged = "boom\n2026-09-23 03:00:00 ERROR kpfront.auth admin login from 10.0.0.1\r\x1b[2J\x7f\u2028x\u2029"
    with caplog.at_level(logging.WARNING, logger="kpfront.clienterror"):
        r = await client.post(
            "/api/diag/client-error",
            json={"message": forged, "stack": "at A\nat B", "path": "/\n/x", "kind": "error x"},
            headers={"User-Agent": "UA\r\nforged"},
        )
    assert r.status_code == 204
    [line] = _client_error_lines(caplog)
    for ch in ("\n", "\r", "\x1b", "\x7f", "\u2028", "\u2029"):
        assert ch not in line
    assert "boom ⏎ 2026-09-23" in line and "at A ⏎ at B" in line


async def test_a_boot_report_is_one_bounded_line(client, caplog):
    """POST /api/diag/boot (lib/bootTiming): no login, one INFO line, names flattened, values clamped."""
    with caplog.at_level(logging.INFO, logger="kpfront.boot"):
        r = await client.post(
            "/api/diag/boot",
            json={"nav": "navigate", "standalone": True, "build": "abc@1", "marks": {"fcp": 4100, "evil\nx": 10**9}},
            headers={"user-agent": "iPhone"},
        )
    assert r.status_code == 204
    [line] = [rec.getMessage() for rec in caplog.records if rec.getMessage().startswith("boot-timing")]
    assert "nav=navigate app=1 fcp=4100" in line
    assert "evil ⏎ x=600000" in line
    assert line.endswith("ua=iPhone")
    assert "\n" not in line


async def test_a_boot_report_with_too_many_marks_is_refused(client):
    r = await client.post("/api/diag/boot", json={"marks": {f"m{i}": i for i in range(30)}})
    assert r.status_code == 422
