"""Station plan-scale calibration + georeferencing endpoint.

- GET needs a session (any role) and starts empty; PUT is editor-only and round-trips; a viewer cannot write.
- The georeference (landmark pairs per plan) shares the document and stays backward compatible:
  a body without it still validates, and the PUT replaces the WHOLE document.
- A stored document that is partly malformed is served entry by entry, never blanked wholesale.
- The whole-document PUT is guarded by `If-Match` (409 on a stale token), and still accepted
  without one for one release — see `put_plan_scales`.
"""

import logging

import pytest

pytestmark = pytest.mark.asyncio

SCALE = {"mPerU": 12.5, "refM": 20.0, "ar": 1.414}
PAIRS = [
    {"plan": {"x": 0.21, "y": 0.78}, "lngLat": {"lng": 7.5461, "lat": 47.5072}, "kind": "gesetzt"},
    {"plan": {"x": 0.79, "y": 0.31}, "lngLat": {"lng": 7.5489, "lat": 47.5091}, "kind": "korrigiert"},
]


async def _login(client, user) -> None:
    r = await client.post("/api/auth/login", json={"user_id": str(user.id), "pin": "135790"})
    assert r.status_code == 200


async def test_an_anonymous_caller_reads_nothing(client):
    """The document says where every referenced building's sheet sits — not for the open internet."""
    assert (await client.get("/api/plan-scales")).status_code == 401


async def test_a_viewer_reads_it_and_it_is_empty_by_default(client, viewer):
    await _login(client, viewer)
    r = await client.get("/api/plan-scales")
    assert r.status_code == 200
    assert {k: v for k, v in r.json().items() if k != "version"} == {
        "default": None,
        "byPlan": {},
        "georefByPlan": {},
        "measuredArByPlan": {},
    }


async def test_editor_puts_and_it_round_trips(client, editor):
    await _login(client, editor)
    body = {"default": SCALE, "byPlan": {"modul1": {"mPerU": 8.0, "refM": 10.0, "ar": 1.414}}}
    r = await client.put("/api/plan-scales", json=body)
    assert r.status_code == 200
    # public GET now returns the stored document
    got = (await client.get("/api/plan-scales")).json()
    assert got["default"] == SCALE
    assert got["byPlan"]["modul1"]["mPerU"] == 8.0


async def test_viewer_cannot_write(client, editor, viewer):
    await _login(client, viewer)
    r = await client.put("/api/plan-scales", json={"default": SCALE, "byPlan": {}})
    assert r.status_code in (401, 403)


async def test_unauthenticated_cannot_write(client):
    r = await client.put("/api/plan-scales", json={"default": SCALE, "byPlan": {}})
    assert r.status_code in (401, 403)


async def test_rejects_degenerate_scale(client, editor):
    await _login(client, editor)
    r = await client.put("/api/plan-scales", json={"default": {"mPerU": 0, "refM": 5, "ar": 1}, "byPlan": {}})
    assert r.status_code == 422


async def test_georef_round_trips(client, editor):
    await _login(client, editor)
    body = {"default": SCALE, "byPlan": {}, "georefByPlan": {"modul1": {"pairs": PAIRS}}}
    assert (await client.put("/api/plan-scales", json=body)).status_code == 200
    got = (await client.get("/api/plan-scales")).json()
    assert got["georefByPlan"]["modul1"]["pairs"] == PAIRS


async def test_document_without_georef_still_validates(client, editor):
    """A body (and therefore a row) written before georeferencing existed stays readable."""
    await _login(client, editor)
    assert (await client.put("/api/plan-scales", json={"default": SCALE, "byPlan": {}})).status_code == 200
    got = (await client.get("/api/plan-scales")).json()
    assert got["georefByPlan"] == {}


async def test_put_replaces_the_whole_document(client, editor):
    """The client must read-modify-write: a body that omits the georef half DROPS it."""
    await _login(client, editor)
    await client.put(
        "/api/plan-scales", json={"default": SCALE, "byPlan": {}, "georefByPlan": {"m1": {"pairs": PAIRS}}}
    )
    await client.put("/api/plan-scales", json={"default": SCALE, "byPlan": {}})
    assert (await client.get("/api/plan-scales")).json()["georefByPlan"] == {}


async def test_viewer_cannot_write_a_georef(client, editor, viewer):
    await _login(client, viewer)
    r = await client.put("/api/plan-scales", json={"georefByPlan": {"m1": {"pairs": PAIRS}}})
    assert r.status_code in (401, 403)


async def test_rejects_plan_pixels_mistaken_for_normalized_coords(client, editor):
    await _login(client, editor)
    bad = {"plan": {"x": 1100, "y": 702}, "lngLat": {"lng": 7.54, "lat": 47.5}}
    r = await client.put("/api/plan-scales", json={"georefByPlan": {"m1": {"pairs": [bad]}}})
    assert r.status_code == 422


async def test_rejects_out_of_range_coordinates(client, editor):
    await _login(client, editor)
    bad = {"plan": {"x": 0.5, "y": 0.5}, "lngLat": {"lng": 7.54, "lat": 947.5}}
    r = await client.put("/api/plan-scales", json={"georefByPlan": {"m1": {"pairs": [bad]}}})
    assert r.status_code == 422


async def test_one_bad_georef_entry_does_not_blank_the_others(client, db_session, editor):
    """The 3am case: ONE plan holds a georef the current format rejects (here a latitude of 947,
    the kind of value a pre-format or hand-edited entry carries). All-or-nothing validation made
    GET return empty, so every plan station-wide reverted to «kalibrieren» at once, with the cause
    only in the server log. Everything that still parses must survive its neighbour."""
    from app.models import DeploymentConfig

    await _login(client, editor)
    db_session.add(
        DeploymentConfig(
            id=1,
            plan_scales_json={
                "default": SCALE,
                "byPlan": {"modul1": {"mPerU": 8.0, "refM": 10.0, "ar": 1.414}},
                "georefByPlan": {
                    "bad": {"pairs": [{"plan": {"x": 0.5, "y": 0.5}, "lngLat": {"lng": 7.54, "lat": 947.5}}]},
                    "good": {"pairs": PAIRS},
                },
            },
        )
    )
    await db_session.commit()

    got = (await client.get("/api/plan-scales")).json()
    assert got["default"] == SCALE
    assert got["byPlan"]["modul1"]["mPerU"] == 8.0
    assert got["georefByPlan"]["good"]["pairs"] == PAIRS
    assert "bad" not in got["georefByPlan"]


# --- optimistic concurrency ---------------------------------------------------------------------
# ⚠️ The hazard the token exists for: this is a full-document replace, and since the unified
# tactical object the georeference is BAKED into every symbol standing on the sheet. An overwritten
# reference no longer costs a calibration somebody can re-measure — it moves objects on the Karte.


async def test_every_answer_carries_a_version(client, editor):
    await _login(client, editor)
    assert (await client.get("/api/plan-scales")).json()["version"]
    r = await client.put("/api/plan-scales", json={"default": SCALE, "byPlan": {}})
    assert r.json()["version"] == (await client.get("/api/plan-scales")).json()["version"]


async def test_a_fresh_token_is_accepted_and_a_stale_one_refused(client, editor):
    await _login(client, editor)
    version = (await client.get("/api/plan-scales")).json()["version"]

    ok = await client.put(
        "/api/plan-scales", json={"georefByPlan": {"m1": {"pairs": PAIRS}}}, headers={"If-Match": version}
    )
    assert ok.status_code == 200

    # a second editor still holding the token from before that write
    stale = await client.put("/api/plan-scales", json={"default": SCALE, "byPlan": {}}, headers={"If-Match": version})
    assert stale.status_code == 409
    assert stale.headers["ETag"] == ok.json()["version"]  # …and says what to re-read
    # the refused body must NOT have landed: the georeference is still there
    assert (await client.get("/api/plan-scales")).json()["georefByPlan"]["m1"]["pairs"] == PAIRS


async def test_a_quoted_token_matches_too(client, editor):
    """`If-Match` is conventionally quoted, and a client (or a proxy) may add the quotes."""
    await _login(client, editor)
    version = (await client.get("/api/plan-scales")).json()["version"]
    r = await client.put("/api/plan-scales", json={"default": SCALE}, headers={"If-Match": f'"{version}"'})
    assert r.status_code == 200


async def test_an_identical_document_is_not_a_conflict(client, editor):
    """A content hash, not a timestamp: storing what is already stored leaves the token alone, so
    a second device writing the same thing is not told it is out of date."""
    await _login(client, editor)
    body = {"default": SCALE, "byPlan": {}, "georefByPlan": {}}
    first = await client.put("/api/plan-scales", json=body)
    again = await client.put("/api/plan-scales", json=body, headers={"If-Match": first.json()["version"]})
    assert again.status_code == 200
    assert again.json()["version"] == first.json()["version"]


async def test_a_client_without_the_header_still_writes_and_says_so(client, editor, caplog):
    """The one-release compatibility window (see `put_plan_scales`): an old build must not lose the
    ability to save a Georeferenz in the field — but the window's closing condition («no build
    without the header is still writing») has to be OBSERVABLE, not assumed, so every headerless
    PUT leaves one line behind."""
    await _login(client, editor)
    await client.put("/api/plan-scales", json={"georefByPlan": {"m1": {"pairs": PAIRS}}})
    with caplog.at_level(logging.INFO, logger="app.api.plan_scales"):
        r = await client.put("/api/plan-scales", json={"default": SCALE, "byPlan": {}})
    assert r.status_code == 200
    assert r.json()["version"]
    assert any("without If-Match" in m for m in caplog.messages)


async def test_a_client_that_sends_the_header_leaves_no_line(client, editor, caplog):
    """…so the log answers the question rather than merely counting writes."""
    await _login(client, editor)
    version = (await client.get("/api/plan-scales")).json()["version"]
    with caplog.at_level(logging.INFO, logger="app.api.plan_scales"):
        r = await client.put("/api/plan-scales", json={"default": SCALE}, headers={"If-Match": version})
    assert r.status_code == 200
    assert not any("without If-Match" in m for m in caplog.messages)


# --- the measured aspect -------------------------------------------------------------------------
# ⚠️ Deliberately NOT `PlanScale.ar`: that one is half of a pair (the sheet's ground width is
# `ar · mPerU`), so correcting it in place would silently rescale every measured distance on the
# plan. This says only «the sheet is this shape» — what the georeference fit is solved in.


async def test_measured_aspect_round_trips_beside_the_calibration(client, editor):
    await _login(client, editor)
    body = {"default": SCALE, "measuredArByPlan": {"object:a:plan:modul2": 0.75}}
    assert (await client.put("/api/plan-scales", json=body)).status_code == 200
    got = (await client.get("/api/plan-scales")).json()
    assert got["measuredArByPlan"]["object:a:plan:modul2"] == 0.75
    assert got["default"] == SCALE  # untouched


async def test_rejects_an_aspect_that_is_not_one(client, editor):
    """A 0 and a pixel count are the two realistic ways this field goes wrong, and either would put
    every symbol on that plan somewhere else."""
    await _login(client, editor)
    assert (await client.put("/api/plan-scales", json={"measuredArByPlan": {"m1": 0}})).status_code == 422
    assert (await client.put("/api/plan-scales", json={"measuredArByPlan": {"m1": 1100}})).status_code == 422


async def test_one_implausible_aspect_does_not_blank_the_others(client, db_session, editor):
    from app.models import DeploymentConfig

    await _login(client, editor)
    db_session.add(DeploymentConfig(id=1, plan_scales_json={"measuredArByPlan": {"bad": 0, "good": 0.75}}))
    await db_session.commit()
    got = (await client.get("/api/plan-scales")).json()
    assert got["measuredArByPlan"] == {"good": 0.75}
