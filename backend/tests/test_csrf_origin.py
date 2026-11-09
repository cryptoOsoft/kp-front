"""Browser origin boundaries: the same-origin gate on cookie mutations (SEC-12) and the
app-wide security-header layer (hardening item 1).

SameSite=Lax already stops an unrelated website from attaching this station's cookies to a
cross-site POST. What it does not stop is a *same-site sibling* — another host under the
station's own registrable domain, hostile or merely compromised — for which the browser
happily sends them. A credentialed empty POST with a foreign `Origin` rotated the capture
poster secret in the audit, which is the whole of this file's subject.

The rule, and why it is drawn where it is:

- it applies to unsafe methods only (POST/PUT/PATCH/DELETE) and only when the request
  actually carries one of this app's session cookies — a caller with no cookie has nothing
  to be ridden;
- **no `Origin` header → allowed.** The admin CLI, the print agent, the alerting webhooks and
  every `curl` send none, and they carry their own explicit credential. This is the same
  browser/non-browser split `PUT /api/config` already draws on `Sec-Fetch-Site`/`Origin`;
- an explicit credential HEADER (capture token, webhook secret, …) exempts the request, even
  with a foreign origin: a cross-origin page cannot set a custom header without a preflight,
  and this app answers no preflight;
- `Sec-Fetch-Site` is a second signal, never the only one.
"""

import pytest

STATION = "http://test"  # the conftest client's own base_url → the app's own origin here
FOREIGN = "https://boese.example"


async def _login(client, user) -> None:
    r = await client.post("/api/auth/login", json={"user_id": str(user.id), "pin": "135790"})
    assert r.status_code == 200, r.text


async def _capture_secret(client) -> str | None:
    r = await client.get("/api/capture/secret")
    assert r.status_code == 200, r.text
    return r.json()["token"]


# --- the gate -------------------------------------------------------------------------


async def test_foreign_origin_cookie_mutation_is_refused(client, admin_login):
    """⚠️ THE FINDING. An admin session cookie plus a foreign `Origin` rotated the poster
    secret — every printed Erfassungs-Poster in the station invalidated by a page the operator
    merely visited."""
    await admin_login(client)
    before = await _capture_secret(client)

    r = await client.post("/api/capture/secret/rotate", headers={"Origin": FOREIGN})

    assert r.status_code == 403, r.text
    assert await _capture_secret(client) == before, "the mutation must not have happened"


async def test_same_origin_browser_mutation_is_allowed(client, admin_login):
    await admin_login(client)
    r = await client.post(
        "/api/capture/secret/rotate",
        headers={"Origin": STATION, "Sec-Fetch-Site": "same-origin"},
    )
    assert r.status_code == 200, r.text


async def test_cli_request_without_an_origin_is_allowed(client, admin_login):
    """`admin_config load`, `admin_geodata push`, the print agent, curl — none send `Origin`."""
    await admin_login(client)
    r = await client.post("/api/capture/secret/rotate")
    assert r.status_code == 200, r.text


async def test_cross_site_fetch_metadata_is_refused_without_an_origin(client, admin_login):
    """The second signal, for the browser request that somehow arrives without `Origin`."""
    await admin_login(client)
    r = await client.post("/api/capture/secret/rotate", headers={"Sec-Fetch-Site": "cross-site"})
    assert r.status_code == 403, r.text


async def test_public_url_counts_as_the_apps_own_origin(client, admin_login, monkeypatch):
    """A deployment behind a proxy that rewrites `Host` still knows its public address."""
    from app.config import settings

    monkeypatch.setattr(settings, "public_url", "https://front.example.org/")
    await admin_login(client)
    r = await client.post("/api/capture/secret/rotate", headers={"Origin": "https://front.example.org"})
    assert r.status_code == 200, r.text


async def test_safe_methods_are_never_gated(client, admin_login):
    await admin_login(client)
    r = await client.get("/api/capture/secret", headers={"Origin": FOREIGN})
    assert r.status_code == 200, r.text


async def test_credential_header_is_exempt_from_the_origin_gate(client, editor, admin_login):
    """A request authorized by an explicit header credential is not a ridden session.

    The capture poster gate reads `X-Capture-Token`; a cross-origin page cannot set that header
    without a CORS preflight, and this app has no CORS layer to answer one. So the foreign
    `Origin` here can only come from a caller that already holds the secret — the gate must not
    turn the poster gate's own 401 into a 403 and hide which door actually refused.
    """
    await admin_login(client)
    assert (await client.post("/api/capture/secret/rotate")).status_code == 200
    await _login(client, editor)  # session cookies ride along on top

    r = await client.put(
        "/api/capture/incidents/00000000-0000-0000-0000-000000000000/workspace",
        json={"workspace": {}},
        headers={"Origin": FOREIGN, "X-Capture-Token": "wrong-but-explicit"},
    )
    assert r.status_code == 401, r.text  # the poster gate refused, not the origin gate
    assert "Erfassungs-Token" in r.json()["detail"]


async def test_a_lan_dev_origin_is_allowed_off_production(client, admin_login):
    """SEC-12 regression (05.09.): `VITE_LAN=1` serves the SPA from a private LAN address for
    iPad testing and proxies `/api` with `changeOrigin`, so the tablet's `Origin` is that LAN
    host while the derived own-origin is the backend's. Off production that must pass — an iPad
    on the bench is not the hostile same-site sibling the gate exists for."""
    await admin_login(client)
    r = await client.post("/api/capture/secret/rotate", headers={"Origin": "http://192.168.7.20:5188"})
    assert r.status_code == 200, r.text


async def test_an_empty_credential_header_does_not_disable_the_gate(client, admin_login):
    """SEC-12 residual (05.09.): the exemption was presence-only, so a blank `X-Stats-Token:`
    (no credential at all) switched the origin gate off on unrelated routes."""
    await admin_login(client)
    before = await _capture_secret(client)
    r = await client.post("/api/capture/secret/rotate", headers={"Origin": FOREIGN, "X-Stats-Token": ""})
    assert r.status_code == 403, r.text
    assert await _capture_secret(client) == before, "the mutation must not have happened"


def _fake_request(headers: dict[str, str], scheme: str = "http"):
    from starlette.requests import Request

    raw = [(k.lower().encode(), v.encode()) for k, v in headers.items()]
    scope = {
        "type": "http",
        "method": "POST",
        "scheme": scheme,
        "path": "/",
        "query_string": b"",
        "headers": raw,
        "server": ("app", 80),
    }
    return Request(scope)


def test_a_forwarded_host_cannot_add_an_allowed_origin_in_production(monkeypatch):
    """SEC-12 residual (05.09.): `X-Forwarded-Host` was unioned into the own-origin set, and it is
    client-suppliable — so an attacker header could ADD an allowed origin. In production only the
    platform `Host` and `PUBLIC_URL` count."""
    from app.config import settings
    from app.main import _own_origins

    monkeypatch.setattr("app.config.is_production", lambda: True)
    monkeypatch.setattr(settings, "public_url", "https://front.example.org/")
    req = _fake_request(
        {"host": "front.example.org", "x-forwarded-host": "boese.example", "x-forwarded-proto": "https"}
    )
    origins = _own_origins(req)
    # Exact set: PUBLIC_URL and the platform Host both resolve to the one origin, and the
    # client-suppliable X-Forwarded-Host is not among them. (Equality, not membership, so the
    # attacker origin's absence is proven and no URL-substring check is implied.)
    assert origins == {"https://front.example.org"}


def test_a_forwarded_host_still_recovers_the_dev_origin_off_production(monkeypatch):
    """The dev proxy rewrites `Host`, so off production the forwarded headers are trusted to
    recover the origin the browser actually loaded — there is no hostile sibling to exploit them."""
    from app.main import _own_origins

    monkeypatch.setattr("app.config.is_production", lambda: False)
    req = _fake_request(
        {"host": "backend.internal", "x-forwarded-host": "192.168.1.5:5188", "x-forwarded-proto": "http"}
    )
    # Exact-match membership (==, not a URL-substring `in`): the LAN origin the browser loaded is
    # recovered from the forwarded headers off production.
    assert any(o == "http://192.168.1.5:5188" for o in _own_origins(req))


def test_a_lan_origin_is_a_dev_only_exemption(monkeypatch):
    """Production never accepts the LAN exemption — the gate is not weakened there."""
    from app.main import _dev_origin

    monkeypatch.setattr("app.config.is_production", lambda: False)
    assert _dev_origin("http://192.168.7.20:5188")
    assert _dev_origin("http://10.1.2.3:5188")
    assert not _dev_origin("https://boese.example")  # a public host is never a dev origin

    monkeypatch.setattr("app.config.is_production", lambda: True)
    assert not _dev_origin("http://192.168.7.20:5188")


# --- the roster gate (L5) -------------------------------------------------------------
# GET /api/auth/roster is unauthenticated by design (the kiosk needs it before anyone is
# logged in) but hands out display names + login UUIDs — so it draws the SAME line the
# mutation gate above draws, itself: a provably foreign browser request is refused, a
# request with no origin evidence at all (curl, the CLIs, this test client) passes.


async def test_roster_same_origin_fetch_is_allowed(client):
    """The kiosk's own fetch: a same-origin GET carries `Sec-Fetch-Site` but no `Origin`."""
    r = await client.get("/api/auth/roster", headers={"Sec-Fetch-Site": "same-origin"})
    assert r.status_code == 200, r.text


async def test_roster_cross_origin_is_refused(client):
    assert (await client.get("/api/auth/roster", headers={"Origin": FOREIGN})).status_code == 403
    # The second signal, for a browser request that somehow arrives without `Origin`.
    assert (await client.get("/api/auth/roster", headers={"Sec-Fetch-Site": "cross-site"})).status_code == 403


async def test_roster_without_origin_evidence_stays_open(client):
    """The browser/non-browser split: neither header → not provably foreign → served. This is
    what keeps curl, the e2e harness and a typed address (`Sec-Fetch-Site: none`) working."""
    assert (await client.get("/api/auth/roster")).status_code == 200
    assert (await client.get("/api/auth/roster", headers={"Sec-Fetch-Site": "none"})).status_code == 200


async def test_roster_own_origin_header_is_allowed(client):
    """A same-origin request that DOES carry `Origin` (e.g. a CORS-mode fetch) is ours too."""
    r = await client.get("/api/auth/roster", headers={"Origin": STATION, "Sec-Fetch-Site": "same-origin"})
    assert r.status_code == 200, r.text


# --- the header layer -----------------------------------------------------------------


@pytest.mark.parametrize("path", ["/api/health", "/health"])
async def test_security_headers_are_on_app_responses(client, path):
    r = await client.get(path)
    assert r.headers["x-content-type-options"] == "nosniff"
    assert r.headers["referrer-policy"] == "strict-origin-when-cross-origin"
    assert r.headers["x-frame-options"] == "SAMEORIGIN"
    assert "frame-ancestors 'self'" in r.headers["content-security-policy"]


async def test_hsts_is_sent_in_production_only(client, monkeypatch):
    """Production is HTTPS only; a dev stack on http://localhost must not pin itself to it."""
    assert "strict-transport-security" not in (await client.get("/api/health")).headers
    monkeypatch.setenv("ENVIRONMENT", "production")
    assert (await client.get("/api/health")).headers["strict-transport-security"] == "max-age=31536000"


async def test_branding_keeps_its_own_stricter_csp(client, editor, admin_login, tmp_path, monkeypatch):
    """The global header must not overwrite a route that already decided something stricter."""
    import app.storage as storage_mod

    monkeypatch.setattr(storage_mod, "_ROOT", str(tmp_path))
    await _login(client, editor)
    await admin_login(client)
    png = (
        b"\x89PNG\r\n\x1a\n\x00\x00\x00\rIHDR\x00\x00\x00\xc0\x00\x00\x00\xc0"
        b"\x08\x06\x00\x00\x00\x00\x00\x00\x00\x00IEND\xaeB`\x82"
    )
    up = await client.post("/api/branding/logo", files={"file": ("logo.png", png, "image/png")})
    assert up.status_code == 200, up.text
    served = await client.get(up.json()["identity"]["assets"]["logo"])
    assert "sandbox" in served.headers["content-security-policy"]


async def test_reference_svg_is_sandboxed_like_branding(client, editor, admin_login, tmp_path, monkeypatch):
    """An admin-uploaded checklist diagram may be an SVG, and an SVG is a document: navigate
    to it and its `<script>` runs on this origin. The branding route has said so since it was
    written; this route serves the same class of file and needs the same two headers."""
    import app.storage as storage_mod

    monkeypatch.setattr(storage_mod, "_ROOT", str(tmp_path))
    await _login(client, editor)
    await admin_login(client)
    svg = b'<svg xmlns="http://www.w3.org/2000/svg"><script>1</script></svg>'
    up = await client.put(
        "/api/reference/checklists:el-playbook:p1",
        files={"file": ("figure.svg", svg, "image/svg+xml")},
    )
    assert up.status_code == 200, up.text

    served = await client.get("/api/reference/checklists:el-playbook:p1")
    assert served.status_code == 200, served.text
    assert served.headers["x-content-type-options"] == "nosniff"
    csp = served.headers["content-security-policy"]
    assert "default-src 'none'" in csp
    assert "sandbox" in csp
