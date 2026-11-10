"""Einsatzrapport PDF endpoint: composes a valid PDF from the client payload + figures.

We assert the endpoint returns a real PDF (``%PDF`` magic) for a minimal payload, a full one
with an embedded figure, and that it's robust to edge inputs — visual fidelity is verified by
hand against the print view. Also covers auth (any user, incl. viewer) and the 404/422 paths.
"""

import ctypes
import io
import json

import pypdfium2 as pdfium
import pypdfium2.raw as pdfium_raw
import pytest
from PIL import Image as PILImage
from sqlalchemy import select

from app.report import compose_report_pdf

pytestmark = pytest.mark.asyncio


def _link_annots(pdf_bytes: bytes) -> list[tuple[int, str, tuple[float, float, float, float]]]:
    """Every Link annotation in the PDF, in on-page order: ``(page index, URI, rect)``.

    pypdfium2's high-level API has no annotation helpers, so this drops to the raw FPDF_*
    bindings the library wraps — same approach the journal-link test uses to prove a
    ``<a href>`` in journal markup actually became a clickable PDF link, not just underlined text.
    """
    pdf = pdfium.PdfDocument(pdf_bytes)
    out: list[tuple[int, str, tuple[float, float, float, float]]] = []
    for page_i, page in enumerate(pdf):
        raw_page = page.raw
        for i in range(pdfium_raw.FPDFPage_GetAnnotCount(raw_page)):
            annot = pdfium_raw.FPDFPage_GetAnnot(raw_page, i)
            try:
                if pdfium_raw.FPDFAnnot_GetSubtype(annot) != pdfium_raw.FPDF_ANNOT_LINK:
                    continue
                link = pdfium_raw.FPDFAnnot_GetLink(annot)
                if not link:
                    continue
                action = pdfium_raw.FPDFLink_GetAction(link)
                if not action:
                    continue
                buflen = pdfium_raw.FPDFAction_GetURIPath(pdf.raw, action, None, 0)
                if not buflen:
                    continue
                buf = ctypes.create_string_buffer(buflen)
                pdfium_raw.FPDFAction_GetURIPath(pdf.raw, action, buf, buflen)
                rect = pdfium_raw.FS_RECTF()
                pdfium_raw.FPDFAnnot_GetRect(annot, ctypes.byref(rect))
                uri = buf.raw[: buflen - 1].decode("utf-8", "replace")
                out.append((page_i, uri, (rect.left, rect.bottom, rect.right, rect.top)))
            finally:
                pdfium_raw.FPDFPage_CloseAnnot(annot)
    return out


def _link_uris(pdf_bytes: bytes) -> list[str]:
    """URI targets of every Link annotation in the PDF, in on-page order."""
    return [uri for _, uri, _ in _link_annots(pdf_bytes)]


def _png(w: int = 12, h: int = 8) -> bytes:
    buf = io.BytesIO()
    PILImage.new("RGB", (w, h), (200, 210, 220)).save(buf, "PNG")
    return buf.getvalue()


async def _login(client, user) -> None:
    r = await client.post("/api/auth/login", json={"user_id": str(user.id), "pin": "135790"})
    assert r.status_code == 200


async def _create_incident(client) -> str:
    r = await client.post("/api/incidents", json={"title": "Brand Hauptstrasse 4"})
    assert r.status_code == 201, r.text
    return r.json()["id"]


def _minimal_payload(inc_id: str) -> dict:
    return {
        "incident": {"title": "Brand Hauptstrasse 4", "id": inc_id},
        "generatedAt": "30.06.2026 03:00",
        "proof": {"statusLabel": "intakt", "count": 12, "head": "abcdef0123456789"},
    }


async def test_report_pdf_minimal(client, editor):
    await _login(client, editor)
    inc = await _create_incident(client)
    r = await client.post(f"/api/incidents/{inc}/report/pdf", data={"payload": json.dumps(_minimal_payload(inc))})
    assert r.status_code == 200, r.text
    assert r.headers["content-type"] == "application/pdf"
    assert r.content[:5] == b"%PDF-"
    assert "attachment" in r.headers.get("content-disposition", "")


async def test_report_pdf_full_with_figures(client, editor):
    await _login(client, editor)
    inc = await _create_incident(client)
    payload = _minimal_payload(inc)
    payload["incident"].update({"type": "Brand", "address": "Hauptstrasse 4", "coords": "47.5, 7.5"})
    payload["meta"] = {
        "summary": "Zimmerbrand im 2. OG, rasch gelöscht.",
        "lehren": "Zugang Hinterhof früher sichern.",
        "verteiler": "Kdt, Gemeinde",
        "einsatzleiter": "M. Muster",
        "eigentuemer": "A. Beispiel",
        "ursache": "Blitzschlag",
        "verursacher": "unbekannt",
        "partnerContacts": [{"org": "Polizei", "name": "Wache", "phone": "117"}],
    }
    payload["options"] = {"kroki": True, "atemschutz": True, "attendance": True, "mittel": True, "journal": True}
    payload["mittel"] = [{"label": "Ölbinder", "menge": "3 Sack", "sources": "TLF"}]
    payload["retablierung"] = [{"label": "Ölbinder", "menge": "3 Sack", "status": "Nachfüllen / ersetzen"}]
    payload["kroki"] = {
        "tiles": "https://tiles.invalid/{z}/{x}/{y}.png",
        "entities": [{"coord": [7.55, 47.51], "symbol": "VKF Feuer"}],
    }
    payload["krokiCaption"] = "Stand 03:00"
    payload["planPages"] = [{"label": "Gebäude · EG", "caption": "Stand 03:00", "blankAspect": 1.4, "annos": []}]
    payload["trupps"] = [
        {
            "name": "AT 1",
            "statusLabel": "im Einsatz",
            "members": ["A", "B"],
            "auftrag": "Löschangriff",
            "entryTime": "03:05",
            "readings": [{"t": "03:05", "kindLabel": "Eintritt", "bar": "300"}],
        }
    ]
    payload["attendance"] = [{"name": "C. Beispiel", "statusLabel": "Anwesend", "checkedInAt": "03:01"}]
    payload["journal"] = [
        {"timeLabel": "03:02", "area": "Kroki", "text": "Erkundung Vorderseite", "transcript": "..."},
        {"timeLabel": "03:08", "area": "M1", "text": "Foto Lage", "photoKey": "photo_e1"},
    ]

    files = [
        ("figures", ("photo_e1", _png(20, 15), "image/png")),
    ]
    r = await client.post(f"/api/incidents/{inc}/report/pdf", data={"payload": json.dumps(payload)}, files=files)
    assert r.status_code == 200, r.text
    assert r.content[:5] == b"%PDF-"
    assert len(r.content) > 1500  # embedded figures + tables → a non-trivial document


async def test_report_pdf_viewer_allowed(client, viewer, editor):
    # a viewer (read-only) may still generate the report — it's read-only output
    await _login(client, editor)
    inc = await _create_incident(client)
    await client.post("/api/auth/logout")
    await _login(client, viewer)
    r = await client.post(f"/api/incidents/{inc}/report/pdf", data={"payload": json.dumps(_minimal_payload(inc))})
    assert r.status_code == 200, r.text
    assert r.content[:5] == b"%PDF-"


async def test_report_pdf_embeds_media_of_its_own_einsatz_only(client, viewer, editor, db_session, monkeypatch):
    """RBAC audit S6: a viewer reads only the Einsätze inside its window, but a foreign
    `/api/media/<id>` in the payload made the composer open an out-of-window photo it could not
    GET. The rapport is OF its path incident; anything else is refused before a file opens."""
    from datetime import UTC, datetime, timedelta

    from app import storage
    from app.models import Incident, Media

    old = Incident(
        title="Alt",
        source="manual",
        status="abgeschlossen",
        is_archived=True,
        started_at=datetime.now(UTC) - timedelta(days=400),
        closed_at=datetime.now(UTC) - timedelta(days=399),
        last_closed_at=datetime.now(UTC) - timedelta(days=399),
    )
    db_session.add(old)
    await db_session.flush()
    photo = Media(incident_id=old.id, kind="photo", storage_key="media/old/secret.jpg", content_type="image/jpeg")
    db_session.add(photo)
    await db_session.commit()
    opened: list[str] = []

    async def spy(key):
        opened.append(key)
        return _png()

    monkeypatch.setattr(storage, "aget_bytes", spy)
    await _login(client, editor)
    inc = await _create_incident(client)
    await _login(client, viewer)
    assert (await client.get(f"/api/media/{photo.id}")).status_code == 404  # outside its window

    payload = {**_minimal_payload(inc), "attachments": [{"url": f"/api/media/{photo.id}"}]}
    r = await client.post(f"/api/incidents/{inc}/report/pdf", data={"payload": json.dumps(payload)})
    assert r.status_code == 403, r.text
    assert "media/old/secret.jpg" not in opened


async def test_report_pdf_unknown_incident_404(client, editor):
    await _login(client, editor)
    missing = "99999999-9999-9999-9999-999999999999"
    r = await client.post(
        f"/api/incidents/{missing}/report/pdf", data={"payload": json.dumps(_minimal_payload(missing))}
    )
    assert r.status_code == 404


async def test_report_pdf_bad_payload_422(client, editor):
    await _login(client, editor)
    inc = await _create_incident(client)
    r = await client.post(f"/api/incidents/{inc}/report/pdf", data={"payload": "{not json"})
    assert r.status_code == 422


async def test_report_pdf_unknown_option_422(client, editor):
    # a renamed switch must fail loudly, not print the default (ReportOptionsIn · extra=forbid)
    await _login(client, editor)
    inc = await _create_incident(client)
    payload = {**_minimal_payload(inc), "options": {"kroki": False, "krokiView": None}}
    r = await client.post(f"/api/incidents/{inc}/report/pdf", data={"payload": json.dumps(payload)})
    assert r.status_code == 422, r.text


async def test_report_pdf_prints_beilagen_from_the_media_store(client, editor):
    """A Rapport-Beilage (ID document, damage photo) is resolved from the media store and
    printed as its own plate — the same server-side lookup a journal photo uses. A URL that
    resolves to nothing must drop that plate, not the rapport."""
    await _login(client, editor)
    inc = await _create_incident(client)
    up = await client.post(
        f"/api/incidents/{inc}/media",
        files={"file": ("ausweis.png", io.BytesIO(_png(60, 40)), "image/png")},
        data={"kind": "photo"},
    )
    assert up.status_code in (200, 201), up.text
    url = up.json()["url"]

    payload = _minimal_payload(inc)
    payload["attachments"] = [
        {"url": url, "caption": "Ausweis Lenker"},
        {"url": "/api/media/00000000-0000-0000-0000-000000000000"},  # gone → skipped, not fatal
    ]
    r = await client.post(f"/api/incidents/{inc}/report/pdf", data={"payload": json.dumps(payload)})
    assert r.status_code == 200, r.text
    assert r.content[:5] == b"%PDF-"

    # …and the same rapport WITHOUT the Beilage is smaller: the plate really is in there
    bare = await client.post(f"/api/incidents/{inc}/report/pdf", data={"payload": json.dumps(_minimal_payload(inc))})
    assert len(r.content) > len(bare.content)


async def test_report_pdf_survives_a_pasted_essay_in_a_remark(client, editor):
    """A free remark rides in a fixed-width table cell, and ReportLab cannot split a cell
    across pages: a long enough one raised LayoutError and the WHOLE compose 500'd with an
    error naming no field — the rapport simply could not be printed any more.

    Printing must never be blocked by what someone typed, so the remark is truncated. The
    lengths here are past the measured failure points (~3.1k person / ~3.8k Mittel); the
    Mittel one matters most because the client JOINS every source line's remark into one cell.
    """
    await _login(client, editor)
    inc = await _create_incident(client)
    payload = _minimal_payload(inc)
    essay = "Lorem ipsum dolor sit amet, consetetur sadipscing elitr. " * 120  # ~6.7k chars
    payload["personal"] = [{"name": "Meier A.", "erfasst": True, "note": essay}]
    payload["mittelForm"] = [{"label": "Ölbindemittel", "menge": "3", "unit": "Sack", "note": essay}]

    r = await client.post(f"/api/incidents/{inc}/report/pdf", data={"payload": json.dumps(payload)})
    assert r.status_code == 200, r.text
    assert r.content[:5] == b"%PDF-"


async def test_over_long_remarks_are_truncated_not_rejected():
    """Rejecting (422) would only move the failure — the text is already in the workspace and
    the operator has no way to shorten it from the print sheet."""
    from app.report import MittelFormRowIn, PersonalRowIn
    from app.report.schema import _NOTE_MAX

    long = "x" * (_NOTE_MAX + 500)
    assert len(PersonalRowIn(name="A", note=long).note) == _NOTE_MAX
    assert PersonalRowIn(name="A", note=long).note.endswith("…")
    assert len(MittelFormRowIn(label="L", note=long).note) == _NOTE_MAX
    # a remark that fits is left exactly as typed
    assert PersonalRowIn(name="A", note="Fahrer TLF").note == "Fahrer TLF"
    assert PersonalRowIn(name="A", note=None).note is None


async def test_the_station_logo_actually_reaches_the_sheet(client, editor, db_session):
    """⚠️ End-to-end on purpose. The logo was stored, served and named in the config — and still
    absent from the PDF, because the resolver matched the URL with a slash-free pattern while the
    storage key IS a path («branding/<uuid>.png»). Every piece passed its own unit test; only the
    whole path together shows it. So this walks the real one: write the blob, point the config at
    it, compose, and require the sheet to be bigger than the same sheet without it.
    """
    from app import storage
    from app.api.report import _LOGO_KEY, resolve_report_assets
    from app.models import DeploymentConfig
    from app.report import ReportPayload

    key = "branding/test-logo.png"
    storage.put_bytes(key, _png(120, 60))
    row = (await db_session.execute(select(DeploymentConfig))).scalars().first()
    if row is None:
        row = DeploymentConfig(id=1, config_json={})
        db_session.add(row)
    row.config_json = {**(row.config_json or {}), "identity": {"assets": {"reportLogo": f"/api/branding/file/{key}"}}}
    await db_session.flush()

    payload = ReportPayload.model_validate(_minimal_payload("x"))
    figs: dict[str, bytes] = {}
    await resolve_report_assets(db_session, payload, figs)
    assert _LOGO_KEY in figs, "the configured logo did not reach the composer"

    with_logo = compose_report_pdf(payload, figs)
    without = compose_report_pdf(payload, {})
    assert len(with_logo) > len(without)


async def test_a_branding_url_cannot_read_outside_its_own_store(client, editor, db_session):
    """The key is server-owned, but a resolver that reads whatever a path says is one bad config
    edit away from being an arbitrary-file read — so it applies the same guard the public route
    does."""
    from app.api.report import _LOGO_KEY, resolve_report_assets
    from app.models import DeploymentConfig
    from app.report import ReportPayload

    row = (await db_session.execute(select(DeploymentConfig))).scalars().first()
    if row is None:
        row = DeploymentConfig(id=1, config_json={})
        db_session.add(row)
    row.config_json = {
        **(row.config_json or {}),
        "identity": {"assets": {"reportLogo": "/api/branding/file/branding/../../../etc/passwd"}},
    }
    await db_session.flush()

    figs: dict[str, bytes] = {}
    await resolve_report_assets(db_session, ReportPayload.model_validate(_minimal_payload("x")), figs)
    assert _LOGO_KEY not in figs


async def test_plan_page_url_with_a_version_query_still_resolves(client, editor):
    """⚠️ Plan URLs carry `?v=<current_version>` so a re-uploaded Modul-PDF busts every cache
    keyed on the URL. The resolver's pattern was anchored WITHOUT a query string, so those urls
    matched nothing and the plan page would have dropped out of the printed rapport in silence —
    the same failure the branding URL had."""
    from app.api.report import _REFERENCE_URL

    assert _REFERENCE_URL.match("/api/reference/plan:abc:modul1").group(1) == "plan:abc:modul1"
    assert _REFERENCE_URL.match("/api/reference/plan:abc:modul1?v=3").group(1) == "plan:abc:modul1"
    assert _REFERENCE_URL.match("/api/reference/plan:abc:modul1?v=3&x=1").group(1) == "plan:abc:modul1"
    # and it still refuses anything that is not one dataset id
    assert _REFERENCE_URL.match("/api/reference/a/b") is None
    assert _REFERENCE_URL.match("/api/media/x") is None


async def test_a_percent_encoded_plan_url_still_reaches_the_composer(client, editor, db_session):
    """⚠️ End-to-end through the resolver, with the URL the CLIENT actually sends. referenceUrl
    (src/lib/api/reference.ts) builds `encodeURIComponent(id)`, and every real plan id carries
    colons («plan:<obj>:<module>») — so the wire URL says `plan%3A…`. The regex test above passed
    on the unencoded form while the DB lookup ran with the still-encoded id and found nothing:
    stored, served, annotated on screen, and absent from the printed rapport in silence."""
    from app import storage
    from app.api.report import resolve_report_assets
    from app.models import ReferenceDataset
    from app.report import ReportPayload

    ds_id = "plan:test-obj:modul1"
    key = "reference/test-plan-modul1.pdf"
    buf = io.BytesIO()
    from reportlab.lib.pagesizes import A4
    from reportlab.pdfgen import canvas

    c = canvas.Canvas(buf, pagesize=A4)
    c.drawString(100, 100, "Modul 1")
    c.save()
    storage.put_bytes(key, buf.getvalue())
    db_session.add(ReferenceDataset(id=ds_id, kind="pdf", storage_key=key, current_version=2))
    await db_session.flush()

    url = "/api/reference/plan%3Atest-obj%3Amodul1?v=2"  # exactly what referenceUrl produces
    payload = ReportPayload.model_validate(
        {**_minimal_payload("x"), "planPages": [{"label": "Modul 1", "url": url, "annos": []}]}
    )
    plan_pdfs = await resolve_report_assets(db_session, payload, {})
    assert plan_pdfs.get(url, b"")[:5] == b"%PDF-", "the encoded plan URL did not resolve"


async def test_report_pdf_carries_the_pendenzen_section(client, editor):
    """⚠️ End to end through the real endpoint, not just the composer.

    The section is an ordinary extra field on ``ReportPayload``, and pydantic drops unknown keys
    without a word — so a backend that was not restarted, or a schema that lost the field, returns
    a perfectly valid PDF that simply has no Aufträge/Pendenzen on it. Nothing anywhere reports an
    error. This asserts the whole chain: HTTP → validation → composer → page text.
    """
    import io

    import pypdfium2 as pdfium

    await _login(client, editor)
    inc = await _create_incident(client)
    payload = _minimal_payload(inc)
    payload["journal"] = [{"timeLabel": "21:58", "area": "Lage", "text": "Blablabla"}]
    payload["pendenzen"] = [
        {
            "text": "Absperrmaterial Kreuzung",
            "assignee": "Werkhof Oberwil",
            "urgent": True,
            "erteilt": "21:02",
            "notes": [{"timeLabel": "21:19", "text": "Fahrzeug unterwegs"}],
        },
        {"text": "Öl binden Vorplatz", "erteilt": "21:18"},
    ]
    r = await client.post(f"/api/incidents/{inc}/report/pdf", data={"payload": json.dumps(payload)})
    assert r.status_code == 200, r.text

    doc = pdfium.PdfDocument(io.BytesIO(r.content))
    text = "\n".join(doc[i].get_textpage().get_text_range() for i in range(len(doc)))
    assert "Aufträge / Pendenzen" in text
    assert "Absperrmaterial Kreuzung" in text
    assert "Werkhof Oberwil" in text
    assert "Fahrzeug unterwegs" in text  # a Meldung, as an indented sub-line
    # ⚠️ No legend line under the table any more (18.08.): it explained four things the table
    # already says out loud, and a caption that repeats its own table teaches the reader to skip
    # captions. What it explained has to stand on its own — so that is what is asserted.
    assert "! = dringend" not in text
    assert "offen" in text  # the item nobody ticked off


async def test_journal_photos_print_side_by_side(client, editor):
    """Several photos on ONE journal row are laid out across the column, not stacked.

    One picture is an illustration and gets the column's full width. Four at that width push the
    next entry a page and a half down — and «one damage is rarely one picture» is exactly the case
    the multi-photo entry was built for.
    """
    await _login(client, editor)
    inc = await _create_incident(client)

    urls = []
    for i in range(4):
        up = await client.post(
            f"/api/incidents/{inc}/media",
            files={"file": (f"schaden{i}.png", io.BytesIO(_png(60, 40)), "image/png")},
            data={"kind": "photo"},
        )
        assert up.status_code in (200, 201), up.text
        urls.append(up.json()["url"])

    payload = _minimal_payload(inc)
    payload["options"] = {"journal": True}
    payload["journal"] = [{"timeLabel": "03:08", "area": "Kroki", "text": "Schaden Vorplatz", "photoUrls": urls}]
    four = await client.post(f"/api/incidents/{inc}/report/pdf", data={"payload": json.dumps(payload)})
    assert four.status_code == 200, four.text

    payload["journal"] = [{"timeLabel": "03:08", "area": "Kroki", "text": "Schaden Vorplatz", "photoUrls": urls[:1]}]
    one = await client.post(f"/api/incidents/{inc}/report/pdf", data={"payload": json.dumps(payload)})
    assert one.status_code == 200, one.text

    # four pictures across two rows of two must not cost four full-width pictures' worth of page
    doc_four = pdfium.PdfDocument(io.BytesIO(four.content))
    doc_one = pdfium.PdfDocument(io.BytesIO(one.content))
    assert len(doc_four) <= len(doc_one) + 1


async def test_journal_link_prints_a_clickable_uri_annotation():
    """Journal markup now carries ``<a href="…"><u>…</u></a>`` alongside the existing ``<b>``
    name marks (see ``JournalRowIn.markup``). ReportLab's Paragraph turns ``<a href>`` into a
    real URI link annotation natively, so this proves the exact href round-trips into the PDF —
    and, since the markup sets no ``color``/``fg`` on the ``<a>``, that the link prints in the
    cell's own ink rather than ReportLab's link colour: the Rapport is paper, so a link is
    underlined (from the sent ``<u>``), not blue.
    """
    from xml.sax.saxutils import escape

    from app.report import ReportPayload

    url = "https://example.com/bericht?ref=42&team=Alpha"
    markup = f'<a href="{escape(url)}"><u>Bericht</u></a> an <b>Peter Muster</b> übergeben'
    payload = _minimal_payload("x")
    payload["journal"] = [
        {"timeLabel": "21:58", "area": "Lage", "text": "Bericht an Peter Muster übergeben", "markup": markup}
    ]
    pdf_bytes = compose_report_pdf(ReportPayload.model_validate(payload), {})
    assert _link_uris(pdf_bytes) == [url]


async def test_journal_link_with_a_very_long_url_does_not_blow_up_the_table():
    """A long, space-free URL as the link's own display text is the classic ReportLab table
    blow-up: an unbreakable word can make a cell demand infinite width and the layout explode
    into a runaway page count (or raise outright). ``splitLongWords`` (on by default) is
    supposed to save us even inside ``<a>``/``<u>`` — this proves it actually does for this
    markup shape, not just for plain text.
    """
    from xml.sax.saxutils import escape

    from app.report import ReportPayload

    long_url = "https://example.com/" + "a1b2c3d4e5f6g7h8i9j0" * 8  # 180 chars, no spaces
    esc = escape(long_url)
    markup = f'<a href="{esc}"><u>{esc}</u></a>'

    short_payload = _minimal_payload("x")
    short_payload["journal"] = [{"timeLabel": "21:59", "area": "Lage", "text": "kurz"}]
    baseline = compose_report_pdf(ReportPayload.model_validate(short_payload), {})

    long_payload = _minimal_payload("x")
    long_payload["journal"] = [{"timeLabel": "21:59", "area": "Lage", "text": long_url, "markup": markup}]
    pdf_bytes = compose_report_pdf(ReportPayload.model_validate(long_payload), {})

    # splitLongWords wraps the unbreakable word across several lines, and ReportLab annotates
    # each wrapped fragment with its own Link — so several annotations, all pointing at the
    # SAME full href (never a truncated piece of it).
    uris = _link_uris(pdf_bytes)
    assert uris, "the long-URL entry produced no link annotation at all"
    assert set(uris) == {long_url}
    base_pages = len(pdfium.PdfDocument(baseline))
    long_pages = len(pdfium.PdfDocument(pdf_bytes))
    # one unbreakable word must not cost more than a page or two over the same journal with a
    # short entry — a real blow-up runs into dozens/hundreds of pages, not a couple.
    assert long_pages <= base_pages + 2


# ── Phone numbers on the sheet ────────────────────────────────────────────────────────────────
# A rapport is read the morning after, on a phone, by whoever has to call somebody back — the
# Kontaktperson whose Keller is still wet, the Werkhof that took the Absperrmaterial. Every number
# it prints should be one tap, and no number it prints should be a tap that dials «14:31».


async def test_the_kontaktperson_telefon_is_dialable():
    """⚠️ The Details box is raw-canvas (`_FormRows`), NOT a Paragraph — markup does nothing
    there, so the link is a rect measured off the same drawString and can silently be off by a
    field. This asserts the annotation exists with the dialable form of what was typed."""
    from app.report import ReportPayload

    payload = _minimal_payload("x")
    payload["meta"] = {"kontaktperson": "A. Beispiel", "kontaktpersonTelefon": "079 123 45 67"}
    pdf_bytes = compose_report_pdf(ReportPayload.model_validate(payload), {})
    hits = [a for a in _link_annots(pdf_bytes) if a[1] == "tel:0791234567"]
    assert len(hits) == 1

    # ⚠️ And it sits ON the number. A wrong coordinate system (the Flowable draws translated, so
    # the rect is `relative=1`) still produces a perfectly valid annotation — just one somewhere
    # else on the page, or off it. So: page 1, the right-hand half of the Details box near the
    # top, and about as wide as the number is set.
    page_i, _, (left, bottom, right, top) = hits[0]
    doc = pdfium.PdfDocument(io.BytesIO(pdf_bytes))
    page = doc[0]
    assert page_i == 0
    assert page.get_width() / 2 < left < right < page.get_width()
    assert page.get_height() * 0.6 < bottom < top < page.get_height()
    assert 40 < right - left < 90  # «079 123 45 67» at 9pt Helvetica ≈ 57pt
    assert 8 < top - bottom < 12  # the 9pt line box

    # the PRINTED number stays exactly as the operator typed it — spacing included
    assert "079 123 45 67" in page.get_textpage().get_text_range()


async def test_a_partner_callback_number_is_dialable():
    """The Partnerliste's remark line carries «Name · Telefon · Bemerkung» and IS a Paragraph, so
    the anchor is markup — built before escaping, so it escapes nothing of its own."""
    from app.report import ReportPayload

    payload = _minimal_payload("x")
    payload["meta"] = {
        "partnerContacts": [
            {"org": "Polizei", "name": "Wache & Co", "phone": "+41 61 123 45 67", "note": "Verkehr ab Kreisel"}
        ]
    }
    pdf_bytes = compose_report_pdf(ReportPayload.model_validate(payload), {})
    assert "tel:+41611234567" in _link_uris(pdf_bytes)
    doc = pdfium.PdfDocument(io.BytesIO(pdf_bytes))
    text = "\n".join(doc[i].get_textpage().get_text_range() for i in range(len(doc)))
    assert "Wache & Co" in text  # the «&» survived the markup that wrapped the number beside it


async def test_the_phone_matcher_takes_the_swiss_shapes_and_nothing_else():
    """⚠️ Conservative on purpose. A dead `tel:` hotspot over «250 bar» sits in a signed document
    and cannot be corrected there; a number that simply prints as text loses nothing."""
    from app.report.styles import _phone_spans, _tel

    dialable = {
        "079 123 45 67": "tel:0791234567",
        "+41 79 123 45 67": "tel:+41791234567",
        "044 123 45 67": "tel:0441234567",
        "079/123 45 67": "tel:0791234567",
        "079.123.45.67": "tel:0791234567",
        "079-123-45-67": "tel:0791234567",
        "0791234567": "tel:0791234567",
    }
    for typed, href in dialable.items():
        line = f"Melder {typed}, wartet vor dem Haus"
        spans = _phone_spans(line)
        assert len(spans) == 1, typed
        assert line[spans[0][0] : spans[0][1]] == typed
        assert _tel(typed) == href

    prose = [
        "Rückzug 14:31, Wiederbelebung ab 14:31:20",
        "Flasche 250 bar, zweite 300 bar",
        "Leitung 3 ab Verteiler 2, Ltg-Nr 12",
        "Ereignis vom 01.09.2026, Nachkontrolle 04.09.2026",
        "Zählerstand 20260901123456 abgelesen",
        "Polizei 117, Sanität 144",  # the short emergency numbers are not matched — nor needed
    ]
    for line in prose:
        assert _phone_spans(line) == [], line


async def test_a_photo_reference_spells_itself_out():
    """«B1» was a code the reader had to be told. The NUMBER is the contract — it is what a
    journal entry and a phone call name the picture by — so it stays put and stays the same;
    only the label spells out."""
    from app.report import ReportPayload

    payload = _minimal_payload("x")
    payload["attachments"] = [{"url": "/api/media/a", "caption": "Ausweis Lenker"}, {"url": "/api/media/b"}]
    figures = {"photo:/api/media/a": _png(60, 40), "photo:/api/media/b": _png(60, 40)}
    pdf_bytes = compose_report_pdf(ReportPayload.model_validate(payload), figures)
    doc = pdfium.PdfDocument(io.BytesIO(pdf_bytes))
    text = "\n".join(doc[i].get_textpage().get_text_range() for i in range(len(doc)))
    assert "Bild 1 · Ausweis Lenker" in text
    assert "Bild 2" in text  # no caption — the reference stands on its own
    assert "B1" not in text


# ── EXIF orientation ──────────────────────────────────────────────────────────────────────────
# A phone stores the sensor's pixels and a tag saying which way up they are. Screens read the tag;
# ReportLab does not — so a landscape photo of the Schadenplatz came off the printer on its side
# (03.09. Journal), while the very same picture stood upright in the app's own thumbnail.


def _exif_jpeg(w: int, h: int, orientation: int) -> bytes:
    """A JPEG of ``w×h`` STORED pixels carrying an EXIF Orientation tag."""
    im = PILImage.new("RGB", (w, h), (200, 30, 30))
    exif = im.getexif()
    exif[0x0112] = orientation
    buf = io.BytesIO()
    im.save(buf, format="JPEG", exif=exif)
    return buf.getvalue()


async def test_a_sideways_photo_is_turned_upright_before_it_is_placed():
    from app.report.styles import _fit_image

    # portrait pixels, tag says «a quarter turn» → the picture is landscape once it is upright
    img = _fit_image(_exif_jpeg(40, 60, 6), 300, 300)
    assert img is not None
    assert img.drawWidth > img.drawHeight


async def test_a_picture_with_nothing_to_turn_is_handed_on_untouched():
    """⚠️ The guard that keeps everything else out of the encoder. `_fit_image` places the Kroki,
    the plan pages, the Beilagen and the logo too — none of those may change because a photo
    needed rotating."""
    from app.report.styles import _exif_upright

    png = _png(40, 28)
    assert _exif_upright(png) is png
    upright_jpeg = _exif_jpeg(40, 28, 1)
    assert _exif_upright(upright_jpeg) is upright_jpeg
    assert _exif_upright(b"not an image at all") == b"not an image at all"


# ── The Atemschutz block's «Nicht eingesetzt» row ─────────────────────────────────────────────


async def test_a_trupp_that_never_went_in_prints_its_whole_wait():
    """⚠️ 03.09.: «Nicht eingesetzt: 06:50» — the Draussen stamp alone, for a Sicherungstrupp that
    had stood ready since 06:32. How long they stood there IS what that row records, so it prints
    as a span like every other row in the block."""
    from app.report import ReportPayload

    payload = _minimal_payload("x")
    payload["options"] = {"atemschutz": True}
    payload["trupps"] = [
        {
            "name": "Sicherungstrupp",
            "registeredTimes": ["03.09.2026 06:32"],
            "exitTimes": ["03.09.2026 06:50"],
            "readings": [{"t": "03.09.2026 06:32", "kindLabel": "Angemeldet", "bar": "300"}],
        }
    ]
    pdf_bytes = compose_report_pdf(ReportPayload.model_validate(payload), {})
    doc = pdfium.PdfDocument(io.BytesIO(pdf_bytes))
    text = "\n".join(doc[i].get_textpage().get_text_range() for i in range(len(doc)))
    assert "Nicht eingesetzt: 03.09.2026 06:32 – 03.09.2026 06:50" in text


async def test_a_trupp_from_before_the_anmeldung_was_logged_keeps_its_single_stamp():
    """A log written before 09.08. carries no `registered` row — there is no Anmeldung to name,
    and the line falls back to exactly what it always printed."""
    from app.report import ReportPayload

    payload = _minimal_payload("x")
    payload["options"] = {"atemschutz": True}
    payload["trupps"] = [{"name": "Sicherungstrupp", "exitTimes": ["03.09.2026 06:50"], "readings": []}]
    pdf_bytes = compose_report_pdf(ReportPayload.model_validate(payload), {})
    doc = pdfium.PdfDocument(io.BytesIO(pdf_bytes))
    text = "\n".join(doc[i].get_textpage().get_text_range() for i in range(len(doc)))
    assert "Nicht eingesetzt: 03.09.2026 06:50" in text


# ── What a link LOOKS like on paper ───────────────────────────────────────────────────────────
# A rapport has no colour to spend, so the underline is the whole signal — and ReportLab's default
# one is a heavy rule tight under the baseline, which reads as a strike-through rather than a link.


async def test_every_style_that_can_carry_a_link_underlines_it_thinly():
    from app.report.styles import _styles

    st = _styles()
    for name in ("cell", "rcell", "body", "muted"):
        assert st[name].underlineWidth == 0.4, name
        assert st[name].underlineOffset == "-0.18*F", name
        assert st[name].underlineColor is not None, name


async def test_the_kontaktperson_telefon_is_underlined_like_every_other_link():
    """⚠️ The Details box is raw canvas: a link annotation there is invisible on paper and in most
    readers, so this number was the ONE address on the sheet with nothing under it. The rule is
    drawn by hand, on the same x-span the hotspot claims."""
    from app.report.styles import _link_tel_on_canvas

    # the canvas ReportLab hands the Flowable, reduced to what this function touches — the
    # camel-case names are its API, not ours
    class _StubCanvas:
        def __init__(self):
            self.lines: list[tuple] = []
            self.links: list[tuple] = []
            self.width: float | None = None

        def stringWidth(self, text, font, size):  # noqa: N802 — ReportLab API
            return len(text) * size * 0.5

        def saveState(self):  # noqa: N802 — ReportLab API
            pass

        def restoreState(self):  # noqa: N802 — ReportLab API
            pass

        def setStrokeColor(self, color):  # noqa: N802 — ReportLab API
            pass

        def setLineWidth(self, w):  # noqa: N802 — ReportLab API
            self.width = w

        def line(self, x0, y0, x1, y1):
            self.lines.append((x0, y0, x1, y1))

        def linkURL(self, url, rect, relative=0):  # noqa: N802 — ReportLab API
            self.links.append((url, rect))

    c = _StubCanvas()
    _link_tel_on_canvas(c, "Tel. 079 123 45 67", x=100.0, y=500.0, size=9)
    assert len(c.lines) == 1
    (x0, y0, x1, y1) = c.lines[0]
    assert y0 == y1 < 500.0  # a rule, and it hangs BELOW the baseline
    assert c.width == 0.4
    # …exactly under the number the hotspot covers, and nowhere near the «Tel. » in front of it
    assert len(c.links) == 1
    _, (link_x0, _, link_x1, _) = c.links[0]
    assert (x0, x1) == (link_x0, link_x1)
    assert x0 > 100.0


# ── Trupp N and the crew per cycle (12.09., docs/trupp-naming.md §5) ─────────────────────────
# The heading names the number and the Gruppenführer at registration; each Einsatz names the crew
# that went in, and the crew changes are dated lines under the cycle they happened in.


async def test_a_numbered_trupp_prints_its_heading_and_the_crew_per_cycle():
    from app.report import ReportPayload

    payload = _minimal_payload("x")
    payload["options"] = {"atemschutz": True}
    payload["trupps"] = [
        {
            "name": "Keller Andreas",
            "no": 1,
            "leader": "Meier Anna",
            "members": ["Dürring Jan"],
            "auftrag": "Löschen",
            "entryTimes": ["12.09.2026 14:05", "12.09.2026 14:35"],
            "exitTimes": ["12.09.2026 14:30", "12.09.2026 14:50"],
            "cycles": [
                {
                    "entry": "12.09.2026 14:05",
                    "exit": "12.09.2026 14:30",
                    "crew": "Meier Anna / Dürring Jan",
                    "changes": [],
                },
                {
                    "entry": "12.09.2026 14:35",
                    "exit": "12.09.2026 14:50",
                    "crew": "Keller Andreas / Dürring Jan",
                    "changes": [{"t": "12.09.2026 14:31", "text": "Gruppenführer Meier Anna -> Keller Andreas"}],
                },
            ],
            "readings": [{"t": "12.09.2026 14:05", "kindLabel": "Eintritt", "bar": "300"}],
        }
    ]
    pdf_bytes = compose_report_pdf(ReportPayload.model_validate(payload), {})
    doc = pdfium.PdfDocument(io.BytesIO(pdf_bytes))
    text = "\n".join(doc[i].get_textpage().get_text_range() for i in range(len(doc)))
    assert "Trupp 1 – Meier Anna" in text
    assert "Einsatz 1: 12.09.2026 14:05 – 12.09.2026 14:30 · Meier Anna / Dürring Jan" in text
    assert "Einsatz 2: 12.09.2026 14:35 – 12.09.2026 14:50 · Keller Andreas / Dürring Jan" in text
    assert "12.09.2026 14:31 Gruppenführer Meier Anna -> Keller Andreas" in text
    # the cycle rows replace the static crew list and the Eintritt/Austritt rows
    assert "AdF 1" not in text
    assert "Eintritt: " not in text


async def test_a_renumbered_trupp_names_its_first_number_in_the_heading():
    # two devices minted «Trupp 1» at once and the merge gave this one 3 (docs/trupp-naming.md
    # §7): its early Verlauf rows still say «Trupp 1», so the Atemschutz page says both
    from app.report import ReportPayload

    payload = _minimal_payload("x")
    payload["options"] = {"atemschutz": True}
    payload["trupps"] = [
        {"name": "Meier Anna", "no": 3, "formerNos": [1], "leader": "Meier Anna", "members": [], "readings": []},
        {"name": "Keller Andreas", "no": 1, "leader": "Keller Andreas", "members": [], "readings": []},
    ]
    pdf_bytes = compose_report_pdf(ReportPayload.model_validate(payload), {})
    doc = pdfium.PdfDocument(io.BytesIO(pdf_bytes))
    text = "\n".join(doc[i].get_textpage().get_text_range() for i in range(len(doc)))
    assert "Trupp 3 (zuerst Trupp 1) – Meier Anna" in text
    assert "Trupp 1 – Keller Andreas" in text


async def test_an_older_payload_without_cycles_prints_exactly_as_before():
    from app.report import ReportPayload

    payload = _minimal_payload("x")
    payload["options"] = {"atemschutz": True}
    payload["trupps"] = [
        {"name": "Meier Anna", "members": ["Dürring Jan"], "entryTimes": ["12.09.2026 14:05"], "readings": []}
    ]
    pdf_bytes = compose_report_pdf(ReportPayload.model_validate(payload), {})
    doc = pdfium.PdfDocument(io.BytesIO(pdf_bytes))
    text = "\n".join(doc[i].get_textpage().get_text_range() for i in range(len(doc)))
    assert "Meier Anna" in text and "Trupp 1" not in text
    assert "AdF 1: Dürring Jan" in text
    assert "Eintritt: 12.09.2026 14:05" in text


async def test_a_title_outside_latin1_still_downloads(client, editor):
    """A header is Latin-1: «Čapek AG» in the title raised while the response was built, after
    the whole PDF was composed. The real name travels in `filename*`, an ASCII fold beside it."""
    await _login(client, editor)
    r = await client.post("/api/incidents", json={"title": "BMA Čapek AG"})
    inc = r.json()["id"]
    r = await client.post(f"/api/incidents/{inc}/report/pdf", data={"payload": json.dumps(_minimal_payload(inc))})
    assert r.status_code == 200, r.text
    disposition = r.headers["content-disposition"]
    assert 'filename="Einsatzrapport_BMA_Capek_AG.pdf"' in disposition
    assert "filename*=UTF-8''Einsatzrapport_BMA_%C4%8Capek_AG.pdf" in disposition
