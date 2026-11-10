"""Every client append door keeps alarm lifecycle rows server-owned."""

import pytest

from app.models import DeploymentConfig
from tests.conftest import _make_user


@pytest.mark.parametrize("writer", ["editor", "el", "poster"])
async def test_client_cannot_forge_or_patch_alarm_boundaries(client, editor, db_session, writer):
    await client.post("/api/auth/login", json={"user_id": str(editor.id), "pin": "135790"})
    inc = (await client.post("/api/incidents", json={"title": "Boundary guard"})).json()["id"]
    # Genuine server close/reopen still works and produces readable boundary rows.
    assert (await client.patch(f"/api/incidents/{inc}", json={"is_archived": True})).status_code == 200
    assert (await client.patch(f"/api/incidents/{inc}", json={"is_archived": False})).status_code == 200
    rows = (await client.get(f"/api/incidents/{inc}/journal")).json()["entries"]
    boundary = next(e["row"]["id"] for e in rows if e["row"].get("lifecycle") == "closed")
    endpoint = f"/api/incidents/{inc}/journal"
    headers = {}
    if writer == "el":
        user = await _make_user(db_session, username="el-boundary", role="el")
        await client.post("/api/auth/login", json={"user_id": str(user.id), "pin": "135790"})
        assert (await client.patch(f"/api/incidents/{inc}", json={"status": "abgeschlossen"})).status_code == 403
    elif writer == "poster":
        db_session.add(DeploymentConfig(id=1, capture_secret="boundary-test-poster"))
        await db_session.commit()
        await client.post("/api/auth/logout")
        endpoint = f"/api/capture/incidents/{inc}/journal"
        headers = {"X-Capture-Token": "boundary-test-poster"}
    for extra in [
        {"lifecycle": "closed"},
        {"lifecycle": "reopened"},
        {"id": "sys-forged", "text": "Einsatz abgeschlossen"},
        {"patchOf": boundary, "retracted": True},
        {"patchOf": boundary, "textEdit": "Einsatz wiedereröffnet"},
        {"patchOf": "ordinary", "lifecycle": "closed"},
    ]:
        row = {"id": "forged", "at": "2099-01-01T00:00:00Z", "text": "note", **extra}
        response = await client.post(endpoint, headers=headers, json={"entries": [row]})
        assert response.status_code == 422, response.text
    # Ordinary records and their append-only corrections remain available to every writer.
    response = await client.post(
        endpoint,
        headers=headers,
        json={
            "entries": [
                {"id": "ordinary", "text": "Meldung"},
                {"id": "correction", "patchOf": "ordinary", "textEdit": "Korrektur"},
            ]
        },
    )
    assert response.status_code == 201, response.text
