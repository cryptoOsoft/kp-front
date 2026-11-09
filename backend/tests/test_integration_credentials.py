"""Integration credentials: encrypted at rest, write-only, `.env`-first, live without a restart.

Each test here pins one property the design stands on. They are deliberately about
BEHAVIOUR at the doors — «can a value get out», «does a dump contain it», «does the consumer
see it» — rather than about the shape of the module, because those are the properties that
would still matter if the implementation were rewritten.
"""

import re
from pathlib import Path

import pytest
from sqlalchemy import select

from app import credentials as creds
from app.config import settings
from app.models import IntegrationCredential, IntegrationCredentialAudit

pytestmark = pytest.mark.asyncio


@pytest.fixture
def blank_env(monkeypatch):
    """A deployment whose `.env` names none of these — the state a fresh station is in.

    ⚠️ Two kinds of field now. The ones that predate this table have a ``Settings`` attribute
    and are blanked there; a credential introduced after it (the SharePoint app registration)
    has none — `Settings` is `extra="ignore"`, so it is read straight off the environment
    (credentials · `_env_value`) and is blanked by removing the variable. `setattr` on a
    pydantic model for a field it does not declare raises whatever `raising=` says.
    """
    for f in creds.FIELDS:
        if f.declared:
            monkeypatch.setattr(settings, f.name, f.default, raising=False)
        else:
            monkeypatch.delenv(f.env, raising=False)
    creds.reset_cache()


# --- write-only ----------------------------------------------------------------------


async def test_a_stored_secret_is_never_returned_by_any_endpoint(client, admin_login, blank_env):
    """The whole point: an admin session can rotate a credential and cannot exfiltrate one."""
    await admin_login(client)
    secret = "divera-accesskey-8f2c1d"
    r = await client.put("/api/integrations/credentials/divera_access_key", json={"value": secret})
    assert r.status_code == 200, r.text
    assert r.json()["configured"] is True
    assert r.json()["value"] is None

    # …not in the list it was just written through,
    listed = (await client.get("/api/integrations/credentials")).json()
    row = next(c for c in listed if c["name"] == "divera_access_key")
    assert row["source"] == "stored"
    assert row["value"] is None

    # …and not anywhere else that reports on integrations. `secret in body` is the assertion
    # that survives a refactor: it does not care WHICH field a leak would come out through.
    for path in (
        "/api/integrations/credentials",
        "/api/integrations/credentials-audit",
        "/api/config",
        "/api/system",
    ):
        body = (await client.get(path)).text
        assert secret not in body, f"{path} leaked the stored credential"


async def test_a_non_secret_field_is_readable_and_a_secret_one_is_not(client, admin_login, blank_env):
    await admin_login(client)
    await client.put("/api/integrations/credentials/traccar_url", json={"value": "https://gps.example.org"})
    await client.put("/api/integrations/credentials/traccar_password", json={"value": "hunter2-but-longer"})

    listed = {c["name"]: c for c in (await client.get("/api/integrations/credentials")).json()}
    # The server name is a diagnostic — an operator who cannot see it cannot tell a typo from
    # an outage — so it comes back.
    assert listed["traccar_url"]["value"] == "https://gps.example.org"
    # The password never does, and neither does the user name (half of a credential pair).
    assert listed["traccar_password"]["value"] is None
    assert listed["traccar_email"]["value"] is None


# --- encrypted at rest ---------------------------------------------------------------


async def test_the_stored_bytes_are_not_the_plaintext(client, admin_login, db_session, blank_env):
    """A stolen database dump must be useless without the `.env` that was never in it."""
    await admin_login(client)
    secret = "stt-api-key-plaintext-marker"
    await client.put("/api/integrations/credentials/stt_api_key", json={"value": secret})

    row = (
        await db_session.execute(select(IntegrationCredential).where(IntegrationCredential.name == "stt_api_key"))
    ).scalar_one()
    assert secret.encode() not in row.value_encrypted
    assert secret not in repr(row.value_encrypted)
    # …and it really is a sealed blob, not an encoding: version byte + 12-byte nonce + tag.
    assert row.value_encrypted[0] == creds.SCHEME_VERSION
    assert len(row.value_encrypted) > len(secret) + 12
    assert creds.unseal("stt_api_key", row.value_encrypted) == secret


async def test_a_credential_cannot_be_moved_into_another_slot(blank_env):
    """The name is the AAD, so swapping two rows in a dump fails instead of silently
    re-pointing a value at a different integration."""
    blob = creds.seal("stt_api_key", "value-for-stt")
    with pytest.raises(creds.UndecryptableCredentialError):
        creds.unseal("divera_access_key", blob)


async def test_a_rotated_secret_key_reports_unreadable_not_unset(client, admin_login, db_session, blank_env):
    """The legibility requirement: an operator must be told «set it again», never sent
    looking for a setting they already made — and never handed a 500."""
    await admin_login(client)
    await client.put("/api/integrations/credentials/alarm_webhook_secret", json={"value": "alarm-secret-abc"})

    # Rotate SECRET_KEY the way a panicking operator would, then re-read.
    row = (
        await db_session.execute(
            select(IntegrationCredential).where(IntegrationCredential.name == "alarm_webhook_secret")
        )
    ).scalar_one()
    row.value_encrypted = b"\x01" + b"\x00" * 12 + b"garbage-that-will-not-open"
    await db_session.commit()
    creds.reset_cache()

    r = await client.get("/api/integrations/credentials")
    assert r.status_code == 200
    entry = next(c for c in r.json() if c["name"] == "alarm_webhook_secret")
    assert entry["source"] == "unreadable"
    assert entry["configured"] is False  # an unreadable credential is a dead integration

    # …and the consumer treats it as absent (fail-closed), not as an empty-string secret that
    # would match an empty header.
    assert creds.get("alarm_webhook_secret") == ""
    bad = await client.post("/api/alarms", json={"source": "x", "source_id": "1", "title": "t"})
    assert bad.status_code == 403


# --- .env precedence ------------------------------------------------------------------


async def test_env_wins_and_the_field_refuses_to_be_written(client, admin_login, monkeypatch):
    """Oberwil's production deployment and the demo must change behaviour not at all."""
    monkeypatch.setattr(settings, "divera_access_key", "from-dot-env")
    creds.reset_cache()
    await admin_login(client)

    listed = {c["name"]: c for c in (await client.get("/api/integrations/credentials")).json()}
    assert listed["divera_access_key"]["source"] == "env"
    assert listed["divera_access_key"]["configured"] is True
    assert listed["divera_access_key"]["value"] is None  # env or not, a secret is a secret

    # Storing under a shadowing env var would be the «typed it in and nothing happened»
    # failure this whole surface exists to end.
    r = await client.put("/api/integrations/credentials/divera_access_key", json={"value": "from-the-browser"})
    assert r.status_code == 409
    assert "DIVERA_ACCESS_KEY" in r.json()["detail"]
    assert await _stored_names(client) == []


async def test_env_still_wins_over_a_value_stored_before_it_was_set(client, admin_login, monkeypatch, blank_env):
    """A station that sets the variable later gets the deployer's answer, not the old one."""
    await admin_login(client)
    await client.put("/api/integrations/credentials/stt_api_key", json={"value": "stored-key"})
    assert creds.get("stt_api_key") == "stored-key"

    monkeypatch.setattr(settings, "stt_api_key", "env-key")
    # No refresh needed: the environment half is never cached, precisely so «.env wins» is
    # not something that becomes true half a minute later.
    assert creds.get("stt_api_key") == "env-key"
    assert creds.resolved("stt_api_key").source == "env"


async def test_a_compose_default_does_not_count_as_a_deployer_decision(client, admin_login, monkeypatch):
    """docker-compose.yml materialises the app's own default for STT_MODEL / STT_LANGUAGE /
    VAPID_SUBJECT, so «present in the environment» would lock three fields on every install."""
    monkeypatch.setattr(settings, "stt_model", creds.BY_NAME["stt_model"].default)
    creds.reset_cache()
    await admin_login(client)

    r = await client.put("/api/integrations/credentials/stt_model", json={"value": "whisper-tiny"})
    assert r.status_code == 200, r.text
    assert creds.get("stt_model") == "whisper-tiny"


async def test_compose_and_env_example_name_every_credential():
    """«.env wins» is only true on compose for a variable `docker-compose.yml` passes through:
    compose's .env is interpolation-only, so an unlisted one never reaches the process. Sixteen
    credentials (SharePoint, Objektbesuche, station index, roster, Microsoft login) were missing
    there until 2026-10-13, and from `.env.example` with them."""
    root = Path(__file__).resolve().parents[2]
    compose = (root / "docker-compose.yml").read_text(encoding="utf-8")
    env_example = (root / ".env.example").read_text(encoding="utf-8")
    assert [f.env for f in creds.FIELDS if f"{f.env}: ${{{f.env}:-" not in compose] == []
    assert [f.env for f in creds.FIELDS if not re.search(rf"^#? ?{f.env}=", env_example, re.M)] == []


# --- live without a restart -----------------------------------------------------------


async def test_a_secret_set_at_runtime_reaches_its_consumer(client, admin_login, blank_env):
    """The property the whole change is FOR. Same process, no restart, no re-import."""
    payload = {"source": "leitstelle", "source_id": "E-1", "title": "BMA Industriestrasse"}

    # Fail-closed before: the intake is off because no secret is configured.
    assert (await client.post("/api/alarms", json=payload)).status_code == 403

    await admin_login(client)
    r = await client.put("/api/integrations/credentials/alarm_webhook_secret", json={"value": "webhook-secret-xyz"})
    assert r.status_code == 200, r.text

    # …and live immediately afterwards, through the real door with the real header.
    good = await client.post("/api/alarms", json=payload, headers={"X-Webhook-Secret": "webhook-secret-xyz"})
    assert good.status_code == 201, good.text
    # A wrong secret is still 401 rather than 403 — i.e. the endpoint is genuinely enabled.
    assert (await client.post("/api/alarms", json=payload, headers={"X-Webhook-Secret": "nope"})).status_code == 401


async def test_clearing_a_credential_switches_the_integration_back_off(client, admin_login, blank_env):
    await admin_login(client)
    await client.put("/api/integrations/credentials/alarm_webhook_secret", json={"value": "webhook-secret-xyz"})
    r = await client.delete("/api/integrations/credentials/alarm_webhook_secret")
    assert r.status_code == 200
    assert r.json()["source"] == "unset"
    assert (await client.post("/api/alarms", json={"source": "s", "source_id": "2", "title": "t"})).status_code == 403


async def test_the_public_config_reflects_a_connection_made_in_the_browser(client, admin_login, blank_env):
    """`integrations.diveraConfigured` is what the app reads to decide whether to offer the
    Divera surfaces at all — it used to be frozen at boot."""
    assert (await client.get("/api/config")).json()["integrations"]["diveraConfigured"] is False
    await admin_login(client)
    await client.put("/api/integrations/credentials/divera_access_key", json={"value": "divera-key-1"})
    assert (await client.get("/api/config")).json()["integrations"]["diveraConfigured"] is True


async def test_carto_browser_key_reaches_a_session_but_not_an_anonymous_caller(client, admin_login, blank_env):
    """The raster provider requires `?key=` in browser requests, so this one credential is
    readable back over the API — while still staying out of git and encrypted at rest.

    Readable is not the same as public: the runtime config hands it to a caller with a session
    (here the admin's), and withholds it from one with none. See
    `test_config_carto_key_visibility.py` for the rule and the incident-link case."""
    await admin_login(client)
    key = "carto-browser-key"
    r = await client.put("/api/integrations/credentials/carto_api_key", json={"value": key})
    assert r.status_code == 200, r.text
    assert r.json()["value"] == key
    assert (await client.get("/api/config")).json()["integrations"]["cartoBasemapKey"] == key

    client.cookies.clear()
    assert (await client.get("/api/config")).json()["integrations"]["cartoBasemapKey"] is None


# --- audit ----------------------------------------------------------------------------


async def test_every_change_is_audited_and_no_audit_row_holds_a_value(
    client, admin_login, db_session, editor, blank_env
):
    await admin_login(client)
    await client.post("/api/auth/login", json={"user_id": str(editor.id), "pin": "135790"})
    await client.put("/api/integrations/credentials/stt_api_key", json={"value": "first-key"})
    await client.put("/api/integrations/credentials/stt_api_key", json={"value": "second-key"})
    await client.delete("/api/integrations/credentials/stt_api_key")

    rows = list((await db_session.execute(select(IntegrationCredentialAudit))).scalars())
    assert [r.action for r in sorted(rows, key=lambda r: r.id)] == ["set", "rotated", "cleared"]
    assert all(r.name == "stt_api_key" and r.source == "api" for r in rows)
    # The record says THAT it changed. Not even encrypted bytes of the value are kept: a
    # leaked SECRET_KEY must not expose every credential this station has ever held.
    assert not any("key" in str(v) for r in rows for k, v in vars(r).items() if k not in ("name", "_sa_instance_state"))

    listed = (await client.get("/api/integrations/credentials-audit")).json()
    assert [e["action"] for e in listed] == ["cleared", "rotated", "set"]  # newest first
    assert listed[0]["by"] == "Cmd"  # the signed-in admin, resolved to a name


# --- validation + gating ---------------------------------------------------------------


async def test_a_plain_http_traccar_url_is_refused_with_a_reason(client, admin_login, blank_env):
    """`TraccarClient.is_configured` pins https, so an http URL would store fine and then do
    nothing at all — the failure shape this surface exists to remove."""
    await admin_login(client)
    r = await client.put("/api/integrations/credentials/traccar_url", json={"value": "http://gps.example.org"})
    assert r.status_code == 422
    assert "https" in r.json()["detail"]


async def test_the_surface_is_admin_only(client, blank_env):
    assert (await client.get("/api/integrations/credentials")).status_code in (401, 403)
    assert (await client.put("/api/integrations/credentials/stt_api_key", json={"value": "x"})).status_code in (
        401,
        403,
    )
    assert (await client.delete("/api/integrations/credentials/stt_api_key")).status_code in (401, 403)
    assert (await client.get("/api/integrations/credentials-audit")).status_code in (401, 403)


async def test_settings_not_on_the_list_have_no_door_here(client, admin_login, blank_env):
    """SECRET_KEY, ADMIN_SECRET and REQUIRE_PLAN_DIGEST are `.env`-only ON PURPOSE — each one
    would be self-defeating in the database it gates. There must be no path to them."""
    await admin_login(client)
    for name in ("secret_key", "admin_secret", "require_plan_digest"):
        assert name not in creds.BY_NAME
        r = await client.put(f"/api/integrations/credentials/{name}", json={"value": "x"})
        assert r.status_code == 404


async def _stored_names(client) -> list[str]:
    listed = (await client.get("/api/integrations/credentials")).json()
    return [c["name"] for c in listed if c["source"] == "stored"]


async def test_an_outbound_url_may_only_be_plain_http_on_the_station_network(client, admin_login, blank_env):
    """The STT server receives every voice memo an editor transcribes. Before this change only
    somebody with shell on the host could aim it somewhere; an admin session can now, and a
    stolen tablet with /admin open is a plausible way to hold one. Plain http off the station's
    own network is refused, so that redirection cannot also be a plaintext feed — while the
    documented self-hosted-whisper-on-the-LAN case (http, no certificate) keeps working.
    """
    await admin_login(client)
    bad = await client.put("/api/integrations/credentials/stt_base_url", json={"value": "http://evil.example.org"})
    assert bad.status_code == 422
    assert "eigenen Netz" in bad.json()["detail"]

    for ok in (
        "http://192.168.1.40:9000",
        "http://whisper:9000",
        "http://localhost:9000",
        "https://api.groq.com/openai",
    ):
        r = await client.put("/api/integrations/credentials/stt_base_url", json={"value": ok})
        assert r.status_code == 200, f"{ok} → {r.text}"


# --- the lookup must not damage the session it borrows --------------------------------


async def test_a_broken_credential_table_does_not_poison_the_callers_transaction(client, db_session, blank_env):
    """⚠️ POSTGRES-SHAPED. On SQLite this passes either way — write it for the CI job that runs
    Postgres, where a failed statement aborts the whole transaction.

    `load(db)` promises it «never raises», and that promise was not worth what it looked like:
    it swallowed the exception and handed the caller back a session Postgres had already marked
    aborted, so the NEXT `db.execute` — outside this function's try — died with
    `PendingRollbackError`. `GET /api/config` calls `load_credentials(db)` on its first line and
    queries on its second, and that endpoint is public and unauthenticated: it is what the login
    screen fetches before anybody signs in.

    The trigger needs no attacker. Restore a dump taken before this table existed, or interrupt
    a migration, and the station's login screen answers 500 for every visitor while naming
    neither the table nor the cause. Now the lookup runs in a SAVEPOINT, so its failure rolls
    back exactly itself.
    """
    from sqlalchemy import text

    await db_session.execute(text("DROP TABLE integration_credentials"))
    await db_session.commit()

    r = await client.get("/api/config")
    assert r.status_code == 200, r.text
    # …and the response is the real config, not an empty fallback that merely avoided a 500.
    assert "integrations" in r.json()

    # Twice, because the failure path must also not wedge: `_loaded_at` stays unset on failure,
    # so without a backoff this re-queried (and re-poisoned) on every single request forever.
    assert (await client.get("/api/config")).status_code == 200


async def test_the_lookup_borrows_the_session_inside_a_savepoint(db_session, blank_env):
    """The mechanism behind the test above, pinned so it cannot be quietly removed.

    Asserted directly because the consequence is invisible on SQLite — the local gate would go
    green on a change that breaks the public login screen on every real deployment.
    """
    calls: list[int] = []
    original = db_session.begin_nested

    def spy(*args, **kwargs):
        calls.append(1)
        return original(*args, **kwargs)

    db_session.begin_nested = spy  # type: ignore[method-assign]
    try:
        await creds.load(db_session, force=True)
    finally:
        db_session.begin_nested = original  # type: ignore[method-assign]
    assert calls, "load(db) must not run its query in the caller's own transaction"


# --- the Divera key must not come back out of a failed call ---------------------------

#: What the leak looked like: Divera authenticates with the key in the QUERY STRING, so the
#: URL of every call is itself a secret, and `httpx` renders the URL into its error message.
_LEAKY_KEY = "abcd1234efghSECRET"  # gitleaks:allow


def _divera_401() -> "object":
    """A 401 whose request carries the access key exactly the way the real one does."""
    import httpx

    request = httpx.Request("GET", "https://app.divera247.com/api/pull/all", params={"accesskey": _LEAKY_KEY})
    return httpx.Response(401, request=request)


async def test_raise_for_status_would_have_leaked_the_key():
    """The fixture for the two tests below — and the reason `check_response` exists at all.

    Pinned as a test so that «httpx stopped putting the URL in the message» is something the
    suite notices, rather than a belief the defence quietly rests on.
    """
    import httpx

    with pytest.raises(httpx.HTTPStatusError) as caught:
        _divera_401().raise_for_status()
    assert _LEAKY_KEY in str(caught.value)


async def test_check_response_keeps_the_status_and_drops_the_url():
    from app.divera import DiveraApiError, check_response

    with pytest.raises(DiveraApiError) as caught:
        check_response(_divera_401())
    message = str(caught.value)
    assert _LEAKY_KEY not in message and "accesskey" not in message
    assert "401" in message, "the status code is the whole diagnosis — keep it"


async def test_an_editor_cannot_read_the_divera_key_out_of_a_failed_sync(client, editor, monkeypatch, blank_env):
    """⚠️ THE ONE THAT CROSSES A PRIVILEGE BOUNDARY.

    `/api/integrations/credentials` refuses a stored secret even to an ADMIN. This endpoint is
    `EditorOrAdmin` — a rung below — and its 502 used to interpolate the exception, so any
    incident editor who could make Divera answer non-2xx (a 429 will do; so will the day the key
    is rotated) read the key straight out of the error body.
    """
    import httpx

    monkeypatch.setattr(settings, "divera_access_key", "", raising=False)
    creds.reset_cache()
    monkeypatch.setattr(
        creds, "_stored", {"divera_access_key": creds.Resolved("divera_access_key", "stored", _LEAKY_KEY)}
    )
    monkeypatch.setattr(creds, "_loaded_at", 1e9)

    async def fake_get(self, url, **kwargs):
        return _divera_401()

    monkeypatch.setattr(httpx.AsyncClient, "get", fake_get)

    r = await client.post("/api/auth/login", json={"user_id": str(editor.id), "pin": "135790"})
    assert r.status_code == 200, r.text

    r = await client.post("/api/personnel/sync/preview")
    assert r.status_code == 502, r.text
    assert _LEAKY_KEY not in r.text
    assert "accesskey" not in r.text


async def test_the_log_redactor_strips_a_credential_out_of_a_query_string():
    """The belt to the braces above: even a message nobody sanitised must not print a key.

    `logging.exception` renders the traceback, and that is where an httpx URL used to arrive —
    so the redactor is attached to the HANDLERS and pre-renders `exc_text`, which a plain
    `logging.Filter` would never see.
    """
    import logging
    import sys

    from app.main import RedactSecretsInUrls

    try:
        _divera_401().raise_for_status()
    except Exception:  # noqa: BLE001 — the point is what the traceback would print
        record = logging.LogRecord("kp", logging.ERROR, __file__, 1, "Divera poll failed", None, sys.exc_info())
    RedactSecretsInUrls().filter(record)
    rendered = logging.Formatter().format(record)
    assert _LEAKY_KEY not in rendered
    assert "<redacted>" in rendered


@pytest.mark.parametrize(
    "url",
    [
        "/e/FAKE-BEARER",
        "/l/sFAKE-BEARER",
        "/l/tFAKE-BEARER",
        "/l/FAKE-BEARER",
        "/api/stats/incidents?t=FAKE-BEARER&format=json",
        "/api/capture/incidents?t=FAKE-BEARER",
        "https://station.example/e/FAKE-BEARER?view=1",
    ],
)
async def test_access_logs_mask_bootstrap_and_short_query_tokens(url):
    import logging

    from app.main import RedactSecretsInUrls

    record = logging.LogRecord(
        "uvicorn.access",
        logging.INFO,
        __file__,
        1,
        '%s - "%s %s HTTP/%s" %d',
        ("localhost", "GET", url, "1.1", 200),
        None,
    )
    RedactSecretsInUrls().filter(record)
    rendered = logging.Formatter().format(record)
    assert "FAKE-BEARER" not in rendered
    assert "<redacted>" in rendered
    assert "GET" in rendered
