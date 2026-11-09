"""The sanitiser, tested as a guarantee rather than as a function.

These tests are the enforcement half of the promise in PRIVACY.md. Most of them are written
as "this string must NOT appear in the output" rather than "the output equals X", because the
thing being defended is an absence: a future refactor that widens a payload should fail here
even if it produces perfectly reasonable-looking JSON.

The realistic-leak cases at the bottom are taken from the shapes this app actually produces —
a stack trace through a Swiss address, a route carrying an incident UUID, a helpful operator
typing their own phone number into the feedback box.
"""

import json

import pytest

from app.telemetry import scrub

# --- Free-text scrubbing --------------------------------------------------------------


@pytest.mark.parametrize(
    "raw",
    [
        "/Users/beichenberger/Github/kp-front/src/App.tsx",
        "at Foo (/srv/kp-front/backend/app/api/incidents.py:42)",
        "C:\\Users\\Wache\\kp-front\\dist\\index.js",
        "file:///home/operator/kp/src/lib/idb.ts",
    ],
)
def test_absolute_paths_lose_everything_but_the_basename(raw: str):
    out = scrub.scrub_text(raw)
    assert "beichenberger" not in out
    assert "Users" not in out and "srv" not in out and "home" not in out
    # the useful half survives — a frame with no module name is a frame worth nothing
    assert any(part in out for part in ("App.tsx", "incidents.py", "index.js", "idb.ts"))


@pytest.mark.parametrize(
    "raw,gone",
    [
        ("melden an feuerwehr@oberwil.ch bitte", "feuerwehr@oberwil.ch"),
        ("Tel +41 79 123 45 67 anrufen", "79 123 45 67"),
        ("Nummer 079 123 45 67", "079 123 45 67"),
        ("client 192.168.1.44 disconnected", "192.168.1.44"),
        ("peer fe80::1ff:fe23:4567:890a gone", "fe80::1ff:fe23:4567:890a"),
        ("incident 3f2504e0-4f89-11d3-9a0c-0305e82c3301 failed", "3f2504e0"),
        ("pos 47.123456, 7.654321 invalid", "47.123456"),
        ("LV95 2611000.5, 1265000.2 out of range", "2611000"),
        ("Einsatz Hauptstrasse 12", "Hauptstrasse 12"),
        ("Brand Bahnhofweg 7a", "Bahnhofweg 7a"),
        # The FIXTURE for the rule that strips tokens, not a token. gitleaks reading it
        # as one is the rule working, so it is annotated rather than weakened.
        ("token=abc123def456", "abc123def456"),  # gitleaks:allow
        ("Bearer eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxIn0.abc", "eyJhbGciOiJIUzI1NiJ9"),
        ("GET /api/incidents?token=s3cret&address=Dorfstrasse", "s3cret"),
        # --- The integration credentials, now that a station can set them from the browser
        # (app/credentials.py). They are stored encrypted and never returned by an endpoint,
        # but they still pass through this process in plain text on their way to Divera /
        # Traccar / the STT server — so the shapes an exception would carry them in are the
        # ones that must not reach anybody's ingest.
        ("Divera 401: accesskey=abcd1234efgh", "abcd1234efgh"),  # gitleaks:allow
        ("HTTPError with access_key ABCD-1234-EFGH", "ABCD-1234-EFGH"),  # gitleaks:allow
        ("vapid_private_key=k9QhVh5T0m2LqO", "k9QhVh5T0m2LqO"),  # gitleaks:allow
        ("Traccar login failed for password=Sommer2026!", "Sommer2026!"),  # gitleaks:allow
        ("STT rejected the request: stt_api_key sk-live-9f8e7d", "sk-live-9f8e7d"),  # gitleaks:allow
        ("Traccar passwort: geheim-123", "geheim-123"),  # gitleaks:allow
        # The monitor ping URL is not label-shaped, so it leans on the host rule instead —
        # what leaves is the shape of a request, never which check it belongs to.
        ("heartbeat GET https://hc-ping.com/2b9f-uuid failed", "hc-ping.com"),
        # ⚠️ …and not just the host. For THIS credential the PATH is the secret: whoever holds
        # `https://<monitor>/<token>` can ping it and keep the monitor believing a dead station
        # is alive. The absolute-path rule used to run first and keep the basename — right for
        # a stack frame, exactly wrong here — so the token left the building inside `…/<token>`.
        ("ping https://uptime.example.org/api/push/abc123XY failed", "abc123XY"),  # gitleaks:allow
        ("HEALTHCHECK_PING_URL=https://hc-ping.com/deadbeefcafe", "deadbeefcafe"),
    ],
)
def test_personal_and_secret_shapes_never_survive(raw: str, gone: str):
    assert gone not in scrub.scrub_text(raw)


def test_scrubbing_is_idempotent():
    # A second pass must not change the text, or the operator's preview would stop matching
    # the file they attach.
    once = scrub.scrub_text("crash at /Users/x/a.ts near Hauptstrasse 12, mail a@b.ch")
    assert scrub.scrub_text(once) == once


def test_scrubber_does_not_eat_the_whole_message():
    # An over-eager scrubber is a scrubber that gets switched off. Ordinary words that merely
    # resemble the patterns must survive intact.
    kept = "Strassenzustand schlecht, Fahrzeug Pin 3 defekt am Platz"
    out = scrub.scrub_text(kept)
    assert "Strassenzustand" in out
    assert "Fahrzeug" in out


def test_never_raises_and_always_returns_a_string():
    assert scrub.scrub_text(None) == ""
    assert scrub.scrub_text("") == ""
    assert isinstance(scrub.scrub_text("x" * 50_000), str)
    assert len(scrub.scrub_text("x" * 50_000)) <= scrub.MAX_TEXT


def test_stack_is_bounded_by_frames():
    stack = "\n".join(f"at frame{i} (/Users/x/src/mod{i}.ts:{i})" for i in range(200))
    out = scrub.scrub_stack(stack)
    assert len(out.splitlines()) <= 30
    assert "/Users" not in out


# --- Allow-list construction ----------------------------------------------------------


def test_user_agent_is_reduced_to_a_device_class():
    ipad = (
        "Mozilla/5.0 (iPad; CPU OS 17_5_1 like Mac OS X) AppleWebKit/605.1.15 "
        "(KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1"
    )
    ctx = scrub.build_context(install_id="i", app="kp-front", release="0.2.0", user_agent=ipad)
    assert ctx["device"] == "iPad Safari"
    # The raw UA is a fingerprint (patch version, device model, MDM build) — it must be gone
    # entirely, not merely truncated.
    assert "17_5_1" not in json.dumps(ctx)
    assert "AppleWebKit" not in json.dumps(ctx)


def test_context_drops_unparseable_extras_rather_than_passing_them_through():
    ctx = scrub.build_context(install_id="i", app="kp-front", release="0.2.0", viewport="Dorfstrasse 3")
    assert "viewport" not in ctx


def test_context_is_constructed_not_merged():
    # Rule 1: an unexpected keyword cannot ride along, because there is no **kwargs.
    with pytest.raises(TypeError):
        scrub.build_context(  # type: ignore[call-arg]
            install_id="i", app="kp-front", release="0.2.0", incident_address="Hauptstrasse 12"
        )


def test_error_kind_is_an_enum_not_free_text():
    assert scrub.build_error(kind="../../etc/passwd", message="x")["kind"] == "error"
    assert scrub.build_error(kind="render", message="x")["kind"] == "render"


def test_report_trouble_kind_is_an_enum_not_free_text():
    assert scrub.build_report(message="x", trouble_kind="nonsense", trouble_at=None)["trouble"] is None
    assert scrub.build_report(message="x", trouble_kind="crash", trouble_at=None)["trouble"] == "crash"


# --- End to end: a realistic leak must not reach the Diagnose-Datei --------------------


def _wire(*parts: dict) -> str:
    """The scrubbed parts as the JSON text they become in the export, for substring assertions."""
    return json.dumps(parts, ensure_ascii=False)


def test_a_realistic_crash_leaks_nothing():
    # The shape this app really produces: a render throw whose message carries the Einsatzort,
    # a stack through the deployer's home directory, and a route carrying the incident id.
    wire = _wire(
        scrub.build_context(
            install_id="11111111-1111-1111-1111-111111111111",
            app="kp-front",
            release="0.2.0+a1b2c3d",
            user_agent="Mozilla/5.0 (iPad; CPU OS 17_5) Safari/604.1",
        ),
        scrub.build_error(
            kind="render",
            message="TypeError: cannot read 'lat' of Einsatz Hauptstrasse 12, 4104 Oberwil",
            stack="at MapView (/Users/beichenberger/Github/kp-front/src/components/MapView.tsx:88)",
            path="/incident/3f2504e0-4f89-11d3-9a0c-0305e82c3301",
        ),
    )
    for forbidden in (
        "Hauptstrasse 12",
        "beichenberger",
        "/Users",
        "3f2504e0",
        "17_5",
    ):
        assert forbidden not in wire, f"{forbidden!r} reached the wire"
    # ...while the parts that make it a usable bug report survive
    assert "TypeError" in wire
    assert "MapView.tsx" in wire
    assert "0.2.0+a1b2c3d" in wire


def test_a_helpful_operator_cannot_leak_by_being_helpful():
    # The most likely real leak in the whole feature: someone types the useful details in.
    wire = _wire(
        scrub.build_report(
            message=(
                "Beim Einsatz Bahnhofstrasse 4 ist der Bildschirm weg. Rückruf 079 123 45 67 oder wache@oberwil.ch"
            ),
            trouble_kind="crash",
            trouble_at="2026-07-25T02:14:00Z",
        )
    )
    for forbidden in ("Bahnhofstrasse 4", "079 123 45 67", "wache@oberwil.ch"):
        assert forbidden not in wire
    # The sentence still reads as a bug report, which is the entire value of this channel
    assert "Bildschirm weg" in wire


def test_never_included_fields_are_absent_from_every_payload():
    # The list is the contract; this asserts it against every builder at once.
    wire = _wire(
        scrub.build_context(install_id="i", app="kp-front", release="0.2.0", user_agent="Mozilla/5.0 (iPad)"),
        scrub.build_error(kind="error", message="boom"),
        scrub.build_report(message="kaputt", trouble_kind=None, trouble_at=None),
    )
    for field in (*scrub.NEVER_INCLUDED, "user", "ip_address"):
        assert f'"{field}"' not in wire
