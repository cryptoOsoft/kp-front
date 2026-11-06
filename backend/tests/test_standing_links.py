"""Standing links (2026-09-09) — Stations-Terminal (`tk`) and fixe Atemschutz-URL (`sk`).

Both are station-level secrets on the deployment row that bind to «whichever Einsatz is
open», resolved at exchange time (api/incident_link · the standing exchange). Contract under
test:

- an unknown or revoked standing secret answers the uniform 401; a station with the feature
  never enabled answers the same (nothing to compare against);
- resolution: exactly one open Einsatz → bound; none → «idle» (a structured answer, not the
  probing 404 — the holder is station-internal); several → «choose», and the pick binds and
  STICKS across the poll until that Einsatz closes; Übungen count as open, a Lern-Übung never;
- scope: the terminal is the alarm link's read surface and never writes; the standing AS
  session writes exactly the ak slice, stamped `atemschutz-fix` so the record says which
  credential wrote (a 16-char column budget — see test_the_stamp_fits_the_source_columns);
- revocation: rotating the standing key ends sessions already open, the vk property; closing
  the Einsatz ends the session but NOT the URL — the next exchange answers «idle»;
- the terminal's device cookie polls without the secret, dies with rotation, and a deleted
  key answers the recognisable «feature off» 403;
- the external Rapport view link must not reach the standing surface.
"""

from datetime import UTC, datetime

import pytest
from sqlalchemy import select

from app.auth.cookies import ACCESS_COOKIE, ADMIN_COOKIE, TERMINAL_COOKIE
from app.models import DeploymentConfig, Incident, IncidentEvent

TERMINAL_KEY = "terminal-standing-key-0123456789-32-bytes"  # gitleaks:allow
STANDING_AS_KEY = "atemschutz-standing-key-0123456789-32b"  # gitleaks:allow

INVALID_TOKEN_DETAIL = "Einsatz-Link ungültig oder abgelaufen"
DENIED_DETAIL = "Für diesen Einsatz-Link nicht freigegeben"
NO_KEY_CODE = "link_key_missing"


# --- fixtures ---------------------------------------------------------------------------


async def _config_row(db) -> DeploymentConfig:
    row = (await db.execute(select(DeploymentConfig).where(DeploymentConfig.id == 1))).scalar_one_or_none()
    if row is None:
        row = DeploymentConfig(id=1, config_json=None)
        db.add(row)
    return row


@pytest.fixture
async def terminal_key(db_session):
    row = await _config_row(db_session)
    row.terminal_link_key = TERMINAL_KEY
    await db_session.commit()
    return TERMINAL_KEY


@pytest.fixture
async def standing_as_key(db_session):
    row = await _config_row(db_session)
    row.atemschutz_standing_key = STANDING_AS_KEY
    await db_session.commit()
    return STANDING_AS_KEY


def _incident(**kw) -> Incident:
    base = {"title": "Brand Hauptstrasse 4", "source": "manual", "status": "offen"}
    return Incident(**{**base, **kw})


@pytest.fixture
async def incident(db_session):
    inc = _incident()
    db_session.add(inc)
    await db_session.commit()
    await db_session.refresh(inc)
    return inc


async def _exchange(client, token: str, incident_id: str | None = None):
    body: dict = {"token": token}
    if incident_id is not None:
        body["incident_id"] = incident_id
    return await client.post("/api/incident-link/session", json=body)


async def _close(db_session, inc: Incident) -> None:
    inc.status = "abgeschlossen"
    await db_session.commit()


# --- the exchange: refusals -------------------------------------------------------------


async def test_unknown_standing_secret_is_the_uniform_401(client, terminal_key, standing_as_key):
    """Wrong secret, and no secret behind the prefix at all — one message each time."""
    for token in ("twrong-secret", "swrong-secret", "t", "s", "sä-not-ascii"):
        r = await _exchange(client, token)
        assert r.status_code == 401, f"{token!r}: {r.text}"
        assert r.json()["detail"] == INVALID_TOKEN_DETAIL


async def test_a_never_enabled_feature_answers_the_same_401(client):
    """No key on the row → nothing to compare against → the same refusal as a wrong secret.
    A caller must not learn from the refusal whether the station uses standing links."""
    for token in (f"t{TERMINAL_KEY}", f"s{STANDING_AS_KEY}"):
        r = await _exchange(client, token)
        assert r.status_code == 401, r.text


# --- resolution -------------------------------------------------------------------------


async def test_one_open_einsatz_binds_and_reports_its_kind(client, terminal_key, incident):
    r = await _exchange(client, f"t{TERMINAL_KEY}")
    assert r.status_code == 200, r.text
    assert r.json() == {"status": "ok", "incident_id": str(incident.id)}

    me = (await client.get("/api/auth/me")).json()
    assert me["role"] == "viewer" and me["link_scoped"] is True
    assert me["link_kind"] == "terminal"
    assert me["link_incident_id"] == str(incident.id)
    # …and the surface it was given actually answers.
    assert (await client.get(f"/api/incidents/{incident.id}/journal")).status_code == 200


async def test_standing_as_binds_and_reports_its_kind(client, standing_as_key, incident):
    r = await _exchange(client, f"s{STANDING_AS_KEY}")
    assert r.status_code == 200, r.text
    assert r.json() == {"status": "ok", "incident_id": str(incident.id)}
    me = (await client.get("/api/auth/me")).json()
    assert me["link_kind"] == "atemschutz-standing"


async def test_no_open_einsatz_answers_idle(client, terminal_key, standing_as_key):
    for token in (f"t{TERMINAL_KEY}", f"s{STANDING_AS_KEY}"):
        r = await _exchange(client, token)
        assert r.status_code == 200, r.text
        assert r.json() == {"status": "idle"}


async def test_an_uebung_counts_as_open(client, standing_as_key, db_session):
    """The laminated QR is exactly what gets drilled — a fixed URL that goes dead in the
    Übung defeats the training purpose."""
    inc = _incident(title="Übung Schulhaus", is_exercise=True)
    db_session.add(inc)
    await db_session.commit()
    await db_session.refresh(inc)
    r = await _exchange(client, f"s{STANDING_AS_KEY}")
    assert r.status_code == 200 and r.json()["status"] == "ok"
    assert r.json()["incident_id"] == str(inc.id)


async def test_a_lern_uebung_is_never_bound(client, terminal_key, standing_as_key, db_session):
    """A learner's tutorial («Üben», source 'training') must not capture the station's terminal,
    and a real Einsatz beside it must not turn into «choose»."""
    lern = _incident(title="Lernen · Trupps", source="training", is_exercise=True)
    db_session.add(lern)
    await db_session.commit()
    for token in (f"t{TERMINAL_KEY}", f"s{STANDING_AS_KEY}"):
        r = await _exchange(client, token)
        assert r.status_code == 200 and r.json() == {"status": "idle"}, r.text
        # not even when asked for by id
        assert (await _exchange(client, token, incident_id=str(lern.id))).json() == {"status": "idle"}

    real = _incident()
    db_session.add(real)
    await db_session.commit()
    await db_session.refresh(real)
    for token in (f"t{TERMINAL_KEY}", f"s{STANDING_AS_KEY}"):
        r = await _exchange(client, token)
        assert r.json() == {"status": "ok", "incident_id": str(real.id)}


async def test_two_open_einsaetze_answer_choose_and_the_pick_binds(client, terminal_key, db_session):
    a = _incident(title="Brand Hauptstrasse 4")
    b = _incident(title="Übung Schulhaus", is_exercise=True)
    db_session.add_all([a, b])
    await db_session.commit()
    await db_session.refresh(a)
    await db_session.refresh(b)

    r = await _exchange(client, f"t{TERMINAL_KEY}")
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["status"] == "choose"
    got = {c["id"]: c for c in body["candidates"]}
    assert set(got) == {str(a.id), str(b.id)}
    assert got[str(b.id)]["is_exercise"] is True
    assert got[str(a.id)]["title"] == "Brand Hauptstrasse 4"

    # the pick binds…
    r = await _exchange(client, f"t{TERMINAL_KEY}", incident_id=str(b.id))
    assert r.status_code == 200 and r.json() == {"status": "ok", "incident_id": str(b.id)}
    # …and STICKS across the poll while both are open.
    r = await _exchange(client, f"t{TERMINAL_KEY}", incident_id=str(b.id))
    assert r.json() == {"status": "ok", "incident_id": str(b.id)}


async def test_a_closed_pick_reresolves_instead_of_erroring(client, terminal_key, db_session):
    a = _incident(title="Brand Hauptstrasse 4")
    b = _incident(title="Verkehrsunfall A18")
    db_session.add_all([a, b])
    await db_session.commit()
    await db_session.refresh(a)
    await db_session.refresh(b)

    await _close(db_session, b)
    # The terminal was bound to b; b closed → the honest answer is a fresh resolution, and
    # with exactly one Einsatz left it binds there without anyone touching the PC.
    r = await _exchange(client, f"t{TERMINAL_KEY}", incident_id=str(b.id))
    assert r.status_code == 200, r.text
    assert r.json() == {"status": "ok", "incident_id": str(a.id)}


# --- scope ------------------------------------------------------------------------------


async def test_the_terminal_reads_but_never_writes(client, terminal_key, incident):
    """`tk` is the alarm link's surface: the Atemschutz slice stays out of reach, with the
    uniform refusal."""
    await _exchange(client, f"t{TERMINAL_KEY}")
    at = datetime.now(UTC).isoformat()
    refused = [
        ("PUT", f"/api/incidents/{incident.id}/workspace/trupps", {"trupps": [], "base_rev": 0}),
        (
            "POST",
            f"/api/incidents/{incident.id}/journal",
            {"entries": [{"id": "j1", "kind": "team", "at": at, "text": "x"}]},
        ),
        ("POST", f"/api/incidents/{incident.id}/events", {"events": []}),
    ]
    for method, url, body in refused:
        r = await client.request(method, url, json=body)
        assert r.status_code == 403, f"{method} {url} answered {r.status_code}: {r.text[:200]}"
        assert r.json()["detail"] == DENIED_DETAIL


def test_the_stamp_fits_the_source_columns():
    """The provenance stamps land in `String(16)` columns (IncidentEvent.source). Postgres
    enforces the length; the SQLite test DB does NOT — a too-long stamp passes every test here
    and 500s every board write in production. So the budget is pinned as a fact about the
    string itself. (Found the hard way, 09.09.2026: «atemschutz-standing» was 19 chars.)"""
    budget = IncidentEvent.source.type.length
    assert budget is not None
    for stamp in ("atemschutz-link", "atemschutz-fix"):
        assert len(stamp) <= budget, f"{stamp!r} exceeds String({budget})"


async def test_standing_as_writes_the_slice_stamped_as_its_own(client, standing_as_key, incident, db_session):
    """Same slice as the per-incident ak link, but the record says WHICH credential wrote:
    `atemschutz-fix`, not `atemschutz-link` — different lever, different revocation."""
    incident.map_workspace_json = {"trupps": [], "shapes": [{"id": "s1"}]}
    await db_session.commit()
    await _exchange(client, f"s{STANDING_AS_KEY}")

    r = await client.put(
        f"/api/incidents/{incident.id}/workspace/trupps",
        json={"trupps": [{"id": "t1", "name": "Trupp 1", "status": "aktiv"}], "base_rev": 0},
    )
    assert r.status_code == 200, r.text

    at = datetime.now(UTC).isoformat()
    r = await client.post(
        f"/api/incidents/{incident.id}/journal",
        json={"entries": [{"id": "j1", "kind": "team", "at": at, "text": "Trupp 1 Kontakt"}]},
    )
    assert r.status_code == 201, r.text
    rows = (await client.get(f"/api/incidents/{incident.id}/journal")).json()["entries"]
    assert rows[0]["row"]["via"] == "atemschutz-fix"

    # the untouched workspace keys survived the slice write
    await db_session.refresh(incident)
    assert incident.map_workspace_json["shapes"] == [{"id": "s1"}]
    # …and the non-team row is still the generic refusal, like the ak link's.
    r = await client.post(
        f"/api/incidents/{incident.id}/journal",
        json={"entries": [{"id": "j2", "kind": "note", "at": at, "text": "x"}]},
    )
    assert r.status_code == 403 and r.json()["detail"] == DENIED_DETAIL


# --- revocation & lifecycle -------------------------------------------------------------


async def test_rotation_ends_sessions_already_open(client, standing_as_key, incident, admin_login):
    await _exchange(client, f"s{STANDING_AS_KEY}")
    assert (await client.get(f"/api/incidents/{incident.id}/journal")).status_code == 200

    await admin_login(client)
    r = await client.post("/api/incident-link/atemschutz/secret/rotate")
    assert r.status_code == 200 and r.json()["configured"] is True
    client.cookies.delete(ADMIN_COOKIE)  # back to being the phone at the Eingang

    assert (await client.get(f"/api/incidents/{incident.id}/journal")).status_code == 403
    # …and the laminated URL itself is dead too.
    assert (await _exchange(client, f"s{STANDING_AS_KEY}")).status_code == 401


async def test_closing_the_einsatz_ends_the_session_but_not_the_url(client, terminal_key, incident, db_session):
    await _exchange(client, f"t{TERMINAL_KEY}")
    assert (await client.get(f"/api/incidents/{incident.id}/journal")).status_code == 200

    await _close(db_session, incident)
    # the session is over — and, on the Einsatz's own route, says it is CLOSED (D1, 25.09.2026)
    r = await client.get(f"/api/incidents/{incident.id}/journal")
    assert r.status_code == 409 and r.json()["detail"]["code"] == "incident_closed"
    # The standing URL survives — that is the point. It just has nothing to bind to.
    r = await _exchange(client, f"t{TERMINAL_KEY}")
    assert r.status_code == 200 and r.json() == {"status": "idle"}


# --- the terminal device cookie ---------------------------------------------------------


async def test_the_device_cookie_polls_without_the_secret(client, terminal_key, incident):
    """Enrollment leaves the long-lived cookie behind; from then on the poll needs no token
    — the secret appeared once, in the admin's QR, and never again."""
    r = await _exchange(client, f"t{TERMINAL_KEY}")
    assert r.status_code == 200 and client.cookies.get(TERMINAL_COOKIE)

    r = await client.post("/api/incident-link/terminal-session", json={})
    assert r.status_code == 200, r.text
    assert r.json() == {"status": "ok", "incident_id": str(incident.id)}


async def test_the_poll_without_enrollment_is_refused(client, terminal_key, incident):
    r = await client.post("/api/incident-link/terminal-session", json={})
    assert r.status_code == 401 and r.json()["detail"] == INVALID_TOKEN_DETAIL


async def test_rotation_ends_enrolled_devices(client, terminal_key, incident, admin_login):
    await _exchange(client, f"t{TERMINAL_KEY}")

    await admin_login(client)
    assert (await client.post("/api/incident-link/terminal/secret/rotate")).status_code == 200
    client.cookies.delete(ADMIN_COOKIE)

    r = await client.post("/api/incident-link/terminal-session", json={})
    assert r.status_code == 401, r.text


async def test_a_deleted_key_is_the_recognisable_feature_off_403(client, terminal_key, incident, admin_login):
    """The one refusal the terminal page may answer with an instruction («in der Verwaltung
    einrichten») — so it has to stay tellable from a rotten cookie's 401."""
    await _exchange(client, f"t{TERMINAL_KEY}")

    await admin_login(client)
    assert (await client.delete("/api/incident-link/terminal/secret")).status_code == 200
    client.cookies.delete(ADMIN_COOKIE)

    r = await client.post("/api/incident-link/terminal-session", json={})
    assert r.status_code == 403, r.text
    assert r.json()["detail"]["code"] == NO_KEY_CODE


# --- the admin trios --------------------------------------------------------------------


async def test_the_trios_are_deployment_admin_gated(client):
    for path in ("/api/incident-link/terminal/secret", "/api/incident-link/atemschutz/secret"):
        assert (await client.get(path)).status_code in (401, 403)
        assert (await client.post(f"{path}/rotate")).status_code in (401, 403)
        assert (await client.delete(path)).status_code in (401, 403)


async def test_the_trios_mint_show_and_disable(client, admin_login):
    await admin_login(client)
    for path in ("/api/incident-link/terminal/secret", "/api/incident-link/atemschutz/secret"):
        assert (await client.get(path)).json() == {"configured": False, "token": None}
        minted = (await client.post(f"{path}/rotate")).json()
        assert minted["configured"] is True and minted["token"]
        shown = (await client.get(path)).json()
        assert shown == minted
        assert (await client.delete(path)).json() == {"configured": False}


# --- containment across kinds -----------------------------------------------------------


async def test_the_view_link_cannot_reach_the_standing_surface(client, editor, incident, db_session):
    """The Rapport view link goes OUTSIDE the station; the standing resolution enumerates
    open Einsätze and must never answer it."""
    from tests.conftest import TEST_PIN

    r = await client.post("/api/auth/login", json={"user_id": str(editor.id), "pin": TEST_PIN})
    assert r.status_code == 200, r.text
    r = await client.post(f"/api/incidents/{incident.id}/view-link")
    assert r.status_code == 200, r.text
    token = r.json()["token"]
    client.cookies.delete(ACCESS_COOKIE)

    assert (await client.post("/api/incident-link/session", json={"token": token})).status_code == 200
    r = await client.post("/api/incident-link/terminal-session", json={})
    assert r.status_code == 403 and r.json()["detail"] == DENIED_DETAIL
