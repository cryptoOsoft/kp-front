"""The Einsatz-Ablage (docs/incident-archive.md) against a fake, writable SharePoint drive.

Pinned: the config is refused at load when a pattern cannot work; folder names come from the
alarm date and the Stichwort without the address; a close queues one row and never waits for
SharePoint; an Übung is never filed; a re-run uploads nothing twice, also after a lost response;
a Nachtrag files a NEW Rapport version and the old one stays; weather backs off, a refused grant
fails visibly and «Erneut versuchen» takes it back; two Einsätze never share a folder; a folder a
person moved still receives the late photo.
"""

from __future__ import annotations

import json
import uuid
from datetime import UTC, datetime, timedelta

import pytest
import pytest_asyncio
from pydantic import ValidationError
from sqlalchemy import select

from app import credentials as creds
from app import incident_archive as archive
from app import storage as storage_mod
from app.models import DeploymentConfig, Incident, IncidentArchiveDelivery, IncidentArchiveReport
from app.schemas import IncidentArchiveConfig
from tests.ov_support import jpeg, login
from tests.sharepoint_write_fake import CLIENT_ID, CLIENT_SECRET, SITE_URL, TENANT_ID, FakeDrive

PHOTOS = "Fotoarchiv/Laufendes Jahr"
REPORTS = "Einsatzakten"
DEST = {
    "id": "sp",
    "kind": "sharepoint",
    "siteUrl": SITE_URL,
    "photoFolder": f"{PHOTOS}/{{date}} {{stichwort}}",
    "reportFolder": f"{REPORTS}/{{year}}/{{date}} {{stichwort}}",
}
#: 14.07.2026 23:30 UTC is already the 15th in Zurich – the folder carries the local alarm date
ALARM = "2026-07-14T23:30:00+00:00"


@pytest.fixture(autouse=True)
def isolated_storage(tmp_path, monkeypatch):
    monkeypatch.setattr(storage_mod, "_ROOT", str(tmp_path))


async def _config(db, section: dict | None) -> None:
    row = (await db.execute(select(DeploymentConfig).where(DeploymentConfig.id == 1))).scalar_one_or_none()
    doc = {"incidentArchive": section} if section is not None else {}
    if row is None:
        db.add(DeploymentConfig(id=1, config_json=doc))
    else:
        row.config_json = doc
    await db.commit()


@pytest_asyncio.fixture
async def drive(db_session):
    for name, value in (
        ("sharepoint_export_tenant_id", TENANT_ID),
        ("sharepoint_export_client_id", CLIENT_ID),
        ("sharepoint_export_client_secret", CLIENT_SECRET),
    ):
        await creds.set_value(db_session, name, value, actor_id=None)
    await _config(db_session, {"enabled": True, "destinations": [DEST]})
    return FakeDrive(seed=[PHOTOS, REPORTS])


async def _incident(client, editor, **over) -> str:
    await login(client, editor)
    body = {"title": "Ölspur Hauptstrasse 4", "address": "Hauptstrasse 4, 4100 Musterdorf", "started_at": ALARM}
    r = await client.post("/api/incidents", json={**body, **over})
    assert r.status_code == 201, r.text
    return r.json()["id"]


async def _upload(client, inc: str, kind: str = "photo", data: bytes | None = None) -> str:
    name, ctype = {"photo": ("a.jpg", "image/jpeg"), "audio": ("a.webm", "audio/webm")}[kind]
    r = await client.post(
        f"/api/incidents/{inc}/media", files={"file": (name, data or jpeg(), ctype)}, data={"kind": kind}
    )
    assert r.status_code == 201, r.text
    return r.json()["id"]


async def _report(client, inc: str, summary: str = "Ölspur gebunden.", at: str = "15.07.2026 01:00") -> None:
    payload = {"incident": {"title": "Ölspur", "id": inc}, "generatedAt": at, "meta": {"summary": summary}}
    r = await client.post(f"/api/incidents/{inc}/report/pdf", data={"payload": json.dumps(payload)})
    assert r.status_code == 200, r.text


async def _close(client, inc: str) -> None:
    assert (await client.patch(f"/api/incidents/{inc}", json={"is_archived": True})).status_code == 200


async def _row(db, inc: str) -> IncidentArchiveDelivery | None:
    db.expire_all()
    return (
        await db.execute(select(IncidentArchiveDelivery).where(IncidentArchiveDelivery.incident_id == uuid.UUID(inc)))
    ).scalar_one_or_none()


def _puts(drive: FakeDrive) -> list[str]:
    return [url for method, url in drive.seen if method == "PUT"]


# --- config + names ----------------------------------------------------------------------------


@pytest.mark.parametrize(
    ("over", "message"),
    [
        ({"photoFolder": "Fotos/{datum} {stichwort}"}, "unknown placeholder"),
        ({"photoFolder": "Fotos/{year}/alle"}, "last level"),
        ({"reportFolder": "Akten/../{date}"}, "plain folder pattern"),
        ({"siteUrl": "http://example.sharepoint.com"}, "https://"),
        ({"id": "SP 1"}, "'id'"),
    ],
)
def test_a_pattern_that_cannot_work_is_refused_at_load(over, message):
    with pytest.raises(ValidationError, match=message):
        IncidentArchiveConfig.model_validate({"enabled": True, "destinations": [{**DEST, **over}]})


def test_two_destinations_need_two_ids():
    with pytest.raises(ValidationError, match="used twice"):
        IncidentArchiveConfig.model_validate({"destinations": [DEST, DEST]})


def test_the_section_defaults_to_off():
    assert IncidentArchiveConfig().enabled is False


@pytest.mark.parametrize(
    ("title", "address", "expected"),
    [
        ("Ölspur", "Hauptstrasse 4, 4100 Musterdorf", "Ölspur"),
        ("Brand Dachstock, Hauptstrasse 4", "Hauptstrasse 4, 4100 Musterdorf", "Brand Dachstock"),
        ("BMA Alarm Industriestrasse", "Industriestrasse 12, 4100 Musterdorf", "BMA Alarm"),
        ("Hauptstrasse 4", "Hauptstrasse 4", ""),
    ],
)
def test_the_stichwort_leaves_the_address_out(title, address, expected):
    assert archive.stichwort(title, address) == expected


def test_placeholders_and_sanitising():
    inc = Incident(
        id=uuid.UUID("00000000-0000-4000-8000-00000000beef"),
        title='Brand: "Scheune"/Stall?',
        type=None,
        address=None,
        started_at=datetime(2026, 7, 14, 23, 30, tzinfo=UTC),
    )
    values = archive.placeholders(inc)
    assert values == {
        "date": "2026.07.15",
        "year": "2026",
        "stichwort": 'Brand: "Scheune"/Stall?',
        "kategorie": "Einsatz",
        "short": "beef",
    }
    # a «/» in a value never adds a level, and what SharePoint refuses is removed
    assert archive.expand("Akten/{year}/{date} {stichwort}", values) == [
        "Akten",
        "2026",
        "2026.07.15 Brand ScheuneStall",
    ]
    # only the title's address goes; an Einsatz with just an address is named by its Kategorie
    inc.title, inc.address, inc.type = "Hauptstrasse 4", "Hauptstrasse 4", "Ölwehr"
    assert archive.placeholders(inc)["stichwort"] == "Ölwehr"


async def test_the_destinations_reach_an_admin_only(client, editor, drive):
    await login(client, editor)
    assert (await client.get("/api/config")).json()["incidentArchive"]["destinations"] == []


# --- close → filed -----------------------------------------------------------------------------


async def test_a_close_files_photos_audio_and_the_rapport(client, editor, drive, session_factory, db_session):
    inc = await _incident(client, editor)
    await _upload(client, inc)
    await _upload(client, inc)
    await _upload(client, inc, "audio", b"\x1a\x45\xdf\xa3webm")
    await _report(client, inc)
    assert await _row(db_session, inc) is None  # nothing owed while it runs
    await _close(client, inc)
    assert (await _row(db_session, inc)).state == "pending"

    assert await archive.run_once(session_factory, transport=drive.transport) == "delivered"
    photo_dir = f"{PHOTOS}/2026.07.15 Ölspur"
    report_dir = f"{REPORTS}/2026/2026.07.15 Ölspur"
    photos = sorted(p.rsplit("/", 1)[1] for p in drive.files(photo_dir))
    assert len(photos) == 2 and photos[0].startswith("01 ") and photos[1].startswith("02 ")
    assert all(p.endswith(".jpg") for p in photos)
    docs = sorted(p.rsplit("/", 1)[1] for p in drive.files(report_dir))
    assert docs[0] == "Einsatzrapport.pdf" and docs[1].startswith("Sprachnotiz 01 ") and docs[1].endswith(".webm")
    assert drive.files(report_dir)[f"{report_dir}/Einsatzrapport.pdf"].startswith(b"%PDF")
    # the originals, byte for byte
    assert drive.files(photo_dir)[f"{photo_dir}/{photos[0]}"] == jpeg()
    row = await _row(db_session, inc)
    assert row.state == "delivered" and row.last_error is None and row.delivered_at is not None


async def test_an_uebung_is_never_filed(client, editor, drive, session_factory, db_session):
    inc = await _incident(client, editor, is_exercise=True)
    await _upload(client, inc)
    await _close(client, inc)
    assert await _row(db_session, inc) is None
    assert await archive.run_once(session_factory, transport=drive.transport) is None
    assert drive.files() == {}


async def test_switched_off_nothing_is_queued_or_kept(client, editor, drive, db_session):
    await _config(db_session, {"enabled": False, "destinations": [DEST]})
    inc = await _incident(client, editor)
    await _report(client, inc)
    await _close(client, inc)
    assert await _row(db_session, inc) is None
    assert await db_session.get(IncidentArchiveReport, uuid.UUID(inc)) is None


async def test_closing_works_while_sharepoint_refuses(client, editor, drive, session_factory, db_session):
    drive.forbid()
    inc = await _incident(client, editor)
    await _upload(client, inc)
    await _close(client, inc)  # 200, whatever SharePoint says
    assert await archive.run_once(session_factory, transport=drive.transport) == "failed"
    row = await _row(db_session, inc)
    assert row.state == "failed" and "read-only grant" in row.last_error
    # the same Einsatz still reopens and closes
    assert (await client.patch(f"/api/incidents/{inc}", json={"is_archived": False})).status_code == 200
    await _close(client, inc)
    assert (await _row(db_session, inc)).state == "pending"


# --- idempotency, versions ---------------------------------------------------------------------


async def test_a_rerun_uploads_nothing_twice(client, editor, drive, session_factory, db_session):
    inc = await _incident(client, editor)
    await _upload(client, inc)
    await _upload(client, inc)
    await _close(client, inc)
    drive.lose("PUT", "02 ")  # the second photo lands remotely, its answer is lost
    assert await archive.run_once(session_factory, transport=drive.transport) == "retry"
    assert len(_puts(drive)) == 2
    row = await _row(db_session, inc)
    assert row.state == "pending" and len(row.remote_items["media"]) == 1  # the first one is remembered
    # due again after the backoff: only the lost one is sent once more, to the same name
    later = datetime.now(UTC) + timedelta(minutes=2)
    assert await archive.run_once(session_factory, transport=drive.transport, now=lambda: later) == "delivered"
    assert len(_puts(drive)) == 3
    assert len(drive.files(f"{PHOTOS}/2026.07.15 Ölspur")) == 2
    # closing again owes a pass – and it sends nothing
    assert (await client.patch(f"/api/incidents/{inc}", json={"is_archived": False})).status_code == 200
    await _close(client, inc)
    assert await archive.run_once(session_factory, transport=drive.transport, now=lambda: later) == "delivered"
    assert len(_puts(drive)) == 3


async def test_a_nachtrag_files_a_new_rapport_version(client, editor, drive, session_factory, db_session):
    inc = await _incident(client, editor)
    await _report(client, inc)
    await _close(client, inc)
    await archive.run_once(session_factory, transport=drive.transport)
    report_dir = f"{REPORTS}/2026/2026.07.15 Ölspur"
    first = drive.files(report_dir)[f"{report_dir}/Einsatzrapport.pdf"]

    # the same Rapport printed again later is the same version
    await _report(client, inc, at="16.07.2026 09:00")
    assert (await _row(db_session, inc)).state == "delivered"

    assert (await client.patch(f"/api/incidents/{inc}", json={"is_archived": False})).status_code == 200
    await _report(client, inc, summary="Ölspur gebunden. Nachtrag: Strasse gereinigt.")
    await _upload(client, inc)  # still open: owed at the next close
    assert (await _row(db_session, inc)).state == "delivered"
    await _close(client, inc)
    assert await archive.run_once(session_factory, transport=drive.transport) == "delivered"
    files = drive.files(report_dir)
    assert sorted(p.rsplit("/", 1)[1] for p in files) == ["Einsatzrapport v2.pdf", "Einsatzrapport.pdf"]
    assert files[f"{report_dir}/Einsatzrapport.pdf"] == first  # never overwritten
    assert len(drive.files(f"{PHOTOS}/2026.07.15 Ölspur")) == 1


async def test_a_late_upload_after_the_close_is_filed(client, editor, drive, session_factory, db_session):
    inc = await _incident(client, editor)
    await _close(client, inc)
    await archive.run_once(session_factory, transport=drive.transport)
    assert drive.files() == {}  # nothing to file yet, and no empty folders
    await _upload(client, inc)  # the offline queue arrives after the close
    assert (await _row(db_session, inc)).state == "pending"
    assert await archive.run_once(session_factory, transport=drive.transport) == "delivered"
    assert len(drive.files(f"{PHOTOS}/2026.07.15 Ölspur")) == 1


async def test_two_einsaetze_never_share_a_folder(client, editor, drive, session_factory, db_session):
    a = await _incident(client, editor)
    b = await _incident(client, editor)
    for inc in (a, b):
        await _upload(client, inc)
        await _close(client, inc)
        assert await archive.run_once(session_factory, transport=drive.transport) == "delivered"
    assert f"{PHOTOS}/2026.07.15 Ölspur" in drive.folders()
    assert f"{PHOTOS}/2026.07.15 Ölspur (2)" in drive.folders()


async def test_a_moved_folder_still_receives(client, editor, drive, session_factory, db_session):
    inc = await _incident(client, editor)
    await _upload(client, inc)
    await _close(client, inc)
    await archive.run_once(session_factory, transport=drive.transport)
    # the year ends: a person moves the folder into the archive
    drive.relocate(f"{PHOTOS}/2026.07.15 Ölspur", "Fotoarchiv/2026/2026.07.15 Ölspur")
    await _upload(client, inc)
    assert await archive.run_once(session_factory, transport=drive.transport) == "delivered"
    assert len(drive.files("Fotoarchiv/2026/2026.07.15 Ölspur")) == 2
    assert f"{PHOTOS}/2026.07.15 Ölspur" not in drive.folders()


# --- failures and the admin's view -------------------------------------------------------------


async def test_weather_backs_off_and_says_why(client, editor, drive, session_factory, db_session):
    inc = await _incident(client, editor)
    await _upload(client, inc)
    await _close(client, inc)
    drive.fail("PUT", "01 ", 503)
    assert await archive.run_once(session_factory, transport=drive.transport) == "retry"
    row = await _row(db_session, inc)
    assert row.state == "pending" and row.attempts == 1 and "503" in row.last_error
    assert row.next_attempt_at > datetime.now(UTC) + timedelta(seconds=50)
    assert await archive.run_once(session_factory, transport=drive.transport) is None  # not due yet
    later = datetime.now(UTC) + timedelta(minutes=2)
    assert await archive.run_once(session_factory, transport=drive.transport, now=lambda: later) == "delivered"
    assert (await _row(db_session, inc)).last_error is None


async def test_a_missing_base_folder_fails_and_retry_takes_it_back(
    client, editor, drive, session_factory, db_session, admin_login
):
    del drive.items[PHOTOS]  # the configured base does not exist: a person has to look
    inc = await _incident(client, editor)
    await _upload(client, inc)
    await _close(client, inc)
    assert await archive.run_once(session_factory, transport=drive.transport) == "failed"
    await admin_login(client)
    status = (await client.get("/api/admin/incident-archive")).json()
    assert status["enabled"] is True
    [entry] = status["deliveries"]
    assert entry["incidentId"] == inc and entry["state"] == "failed" and "does not exist" in entry["lastError"]
    assert await archive.run_once(session_factory, transport=drive.transport) is None  # stays failed

    drive.mkdirs(PHOTOS)
    r = await client.post("/api/admin/incident-archive/retry", json={"incidentId": inc})
    assert r.status_code == 200 and r.json() == {"retried": 1}
    assert await archive.run_once(session_factory, transport=drive.transport) == "delivered"


async def test_ablegen_files_an_einsatz_closed_before_the_switch(
    client, editor, drive, session_factory, db_session, admin_login
):
    await _config(db_session, {"enabled": False, "destinations": [DEST]})
    inc = await _incident(client, editor)
    await _upload(client, inc)
    await _close(client, inc)
    await _config(db_session, {"enabled": True, "destinations": [DEST]})
    await admin_login(client)
    assert (await client.post("/api/admin/incident-archive/retry", json={"incidentId": inc})).json() == {"retried": 1}
    assert await archive.run_once(session_factory, transport=drive.transport) == "delivered"
    assert len(drive.files(f"{PHOTOS}/2026.07.15 Ölspur")) == 1


async def test_a_big_einsatz_is_filed_over_several_passes(
    client, editor, drive, session_factory, db_session, monkeypatch
):
    monkeypatch.setattr(archive, "PASS_FILES", 2)
    inc = await _incident(client, editor)
    for _ in range(3):
        await _upload(client, inc)
    await _close(client, inc)
    assert await archive.run_once(session_factory, transport=drive.transport) == "more"
    assert len((await _row(db_session, inc)).remote_items["media"]) == 2
    assert await archive.run_once(session_factory, transport=drive.transport) == "delivered"
    assert len(drive.files(f"{PHOTOS}/2026.07.15 Ölspur")) == 3


async def test_a_rapport_beilage_never_lands_in_the_photo_archive(client, editor, drive, session_factory, db_session):
    inc = await _incident(client, editor)
    await _upload(client, inc)  # a Lage photo
    beilage = await _upload(client, inc)  # «Ausweis Lenker» – a photo by kind, a document by purpose
    row = await db_session.get(Incident, uuid.UUID(inc))
    row.map_workspace_json = {"attachments": [{"id": "a1", "url": f"/api/media/{beilage}", "caption": "Ausweis"}]}
    await db_session.commit()
    await _close(client, inc)
    assert await archive.run_once(session_factory, transport=drive.transport) == "delivered"
    photos = [p.rsplit("/", 1)[1] for p in drive.files(f"{PHOTOS}/2026.07.15 Ölspur")]
    docs = [p.rsplit("/", 1)[1] for p in drive.files(f"{REPORTS}/2026/2026.07.15 Ölspur")]
    assert len(photos) == 1 and photos[0].startswith("01 ")
    assert len(docs) == 1 and docs[0].startswith("Beilage 01 ") and docs[0].endswith(".jpg")


async def test_a_lost_rapport_upload_never_hands_its_name_to_a_newer_rapport(
    client, editor, drive, session_factory, db_session
):
    inc = await _incident(client, editor)
    await _report(client, inc)
    await _close(client, inc)
    drive.lose("PUT", "Einsatzrapport.pdf")  # landed remotely, the answer is lost
    assert await archive.run_once(session_factory, transport=drive.transport) == "retry"
    await _report(client, inc, summary="Ölspur gebunden, Strasse gereinigt.")  # a newer Rapport meanwhile
    later = datetime.now(UTC) + timedelta(minutes=2)
    assert await archive.run_once(session_factory, transport=drive.transport, now=lambda: later) == "delivered"
    report_dir = f"{REPORTS}/2026/2026.07.15 Ölspur"
    assert sorted(p.rsplit("/", 1)[1] for p in drive.files(report_dir)) == [
        "Einsatzrapport v2.pdf",
        "Einsatzrapport.pdf",
    ]
