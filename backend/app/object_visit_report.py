"""The readable Objektbesuch report (ReportLab) — what a reviewer, a SharePoint folder and a
printer get (docs/object-visits.md).

One A4 portrait document per revision: head (station, object, date, people, the
ENTWURF/ABGESCHLOSSEN/VERWORFEN stamp, «Revision n · Stand …», the work list), the Mängel summary,
the checklist table (answer + note, «nicht geprüft» where nothing was answered — never «Nein»),
Bemerkungen, the Korrekturvorschläge («zur Prüfung, nicht übernommen»), the photos two-up with
their captions, and a footer naming the checklist id/version, the visit id and its URL.

Labels are German, like the Einsatzrapport (app/report). A photo whose bytes are not stored yet
prints as a «Foto ausstehend» placeholder: the report must render the moment a revision exists,
and a missing picture is a fact about the visit, not a reason to fail the document.

Synchronous and CPU-bound — call ``render_visit_pdf`` through ``anyio.to_thread``.
"""

from __future__ import annotations

import io
import logging
import unicodedata
from datetime import UTC, datetime
from typing import Any
from zoneinfo import ZoneInfo

from PIL import Image as PILImage
from PIL import ImageOps
from reportlab.lib import colors
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import ParagraphStyle, getSampleStyleSheet
from reportlab.lib.units import mm
from reportlab.platypus import (
    Image,
    LayoutError,
    Paragraph,
    SimpleDocTemplate,
    Spacer,
    Table,
    TableStyle,
)

from .checklist_templates import visit_items
from .geo_util import wgs84_to_lv95

logger = logging.getLogger("kpfront.objectvisits")

TZ = ZoneInfo("Europe/Zurich")
_STAMPS = {"draft": "ENTWURF", "completed": "ABGESCHLOSSEN", "discarded": "VERWORFEN"}
_STAMP_COLORS = {"draft": "#a15c00", "completed": "#1f6f3a", "discarded": "#8a1c14"}
_GRID = colors.HexColor("#d7dde5")
_PANEL = colors.HexColor("#eef2f7")
_DIM = "#5b6573"
#: Long edge a photo is downscaled to before it goes into the PDF (two-up on A4 needs ~85 mm).
_PHOTO_EDGE = 1400
_PHOTO_QUALITY = 82

_CHECK = {"ok": "OK", "defect": "Mangel", "na": "n. a."}
_YESNO = {"yes": "Ja", "no": "Nein"}


def _nfc(s: Any) -> str:
    """Composed text. Folder names from a Mac arrive decomposed («u» + combining diaeresis), and
    the PDF's base-14 fonts draw the combining mark as a box («Mu■hlematt», staging 03.10.2026)."""
    return unicodedata.normalize("NFC", str(s if s is not None else ""))


def _esc(s: Any) -> str:
    return _nfc(s).replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;")


def _multiline(s: Any) -> str:
    return _esc(s).replace("\n", "<br/>")


def local_time(value: Any) -> datetime | None:
    if isinstance(value, datetime):
        at = value
    elif isinstance(value, str) and value.strip():
        try:
            at = datetime.fromisoformat(value.strip().replace("Z", "+00:00"))
        except ValueError:
            return None
    else:
        return None
    if at.tzinfo is None:
        at = at.replace(tzinfo=UTC)
    return at.astimezone(TZ)


def _fmt(value: Any, pattern: str = "%d.%m.%Y %H:%M") -> str:
    at = local_time(value)
    return at.strftime(pattern) if at else "–"


def _styles() -> dict[str, ParagraphStyle]:
    base = getSampleStyleSheet()["Normal"]
    return {
        "body": ParagraphStyle("ovBody", parent=base, fontName="Helvetica", fontSize=9.5, leading=12.5),
        "small": ParagraphStyle("ovSmall", parent=base, fontName="Helvetica", fontSize=8, leading=10, textColor=_DIM),
        "label": ParagraphStyle("ovLabel", parent=base, fontName="Helvetica-Bold", fontSize=8.5, leading=11),
        "h1": ParagraphStyle("ovH1", parent=base, fontName="Helvetica-Bold", fontSize=15, leading=18),
        "h2": ParagraphStyle(
            "ovH2", parent=base, fontName="Helvetica-Bold", fontSize=11, leading=14, spaceBefore=8, spaceAfter=4
        ),
        "stamp": ParagraphStyle("ovStamp", parent=base, fontName="Helvetica-Bold", fontSize=12, leading=14),
        "caption": ParagraphStyle("ovCaption", parent=base, fontName="Helvetica", fontSize=8.5, leading=10.5),
    }


def answer_text(item: dict[str, Any], answer: dict[str, Any] | None) -> str:
    """What the checklist table prints for one item. No answer is «nicht geprüft», never «Nein»."""
    if not isinstance(answer, dict) or "v" not in answer:
        return "nicht geprüft"
    value = answer.get("v")
    kind = item.get("input", "check")
    if kind == "check":
        return _CHECK.get(str(value), str(value))
    if kind == "yesno":
        return _YESNO.get(str(value), str(value))
    if kind == "choice":
        for option in item.get("options") or []:
            if isinstance(option, dict) and option.get("id") == value:
                return str(option.get("label") or value)
        return str(value)
    if kind == "number":
        unit = item.get("unit")
        return f"{value} {unit}" if unit else str(value)
    if kind == "photo":
        return "Foto" if value == "photo" else str(value)
    return str(value)


def downscale_photo(data: bytes) -> bytes | None:
    """The photo as the report prints it: upright, at most ``_PHOTO_EDGE`` px, JPEG. None when
    PIL cannot read it. A delivery pass caches this, so a history of n revisions decodes each
    original once instead of n times."""
    try:
        with PILImage.open(io.BytesIO(data)) as opened:
            im = ImageOps.exif_transpose(opened) or opened
            im.thumbnail((_PHOTO_EDGE, _PHOTO_EDGE))
            buf = io.BytesIO()
            im.convert("RGB").save(buf, format="JPEG", quality=_PHOTO_QUALITY, optimize=True)
            return buf.getvalue()
    except Exception:  # noqa: BLE001 — an unreadable photo prints as a placeholder
        logger.warning("object visit report: a photo could not be read; it prints as a placeholder", exc_info=True)
        return None


def _photo_flowable(data: bytes | None, max_w: float, max_h: float) -> Image | None:
    """Upright, downscaled, re-encoded — or None for bytes PIL cannot read."""
    if not data:
        return None
    try:
        with PILImage.open(io.BytesIO(data)) as opened:
            im = ImageOps.exif_transpose(opened) or opened
            im.thumbnail((_PHOTO_EDGE, _PHOTO_EDGE))
            buf = io.BytesIO()
            im.convert("RGB").save(buf, format="JPEG", quality=_PHOTO_QUALITY, optimize=True)
            width, height = im.size
    except Exception:  # noqa: BLE001 — an unreadable photo prints as a placeholder
        logger.warning("object visit report: a photo could not be read; it prints as a placeholder", exc_info=True)
        return None
    if width <= 0 or height <= 0:
        return None
    scale = min(max_w / width, max_h / height)
    buf.seek(0)
    return Image(buf, width=width * scale, height=height * scale)


def _placeholder(text: str, width: float, height: float, st: dict[str, ParagraphStyle]) -> Table:
    t = Table([[Paragraph(_esc(text), st["small"])]], colWidths=[width], rowHeights=[height])
    t.setStyle(
        TableStyle(
            [
                ("BOX", (0, 0), (-1, -1), 0.6, _GRID),
                ("BACKGROUND", (0, 0), (-1, -1), _PANEL),
                ("ALIGN", (0, 0), (-1, -1), "CENTER"),
                ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
            ]
        )
    )
    return t


#: A cell value longer than this does not go INTO a table cell: a row taller than a page is a
#: ReportLab LayoutError (a 500, and a delivery that never finishes). It is printed in full under
#: the table as «Anmerkung n», and the cell says «→ Anm. n».
_CELL_MAX = 280
_CELL_MAX_LINES = 8
#: The linked checklist item under a photo — a template's item text is not bounded.
_CAPTION_ITEM_MAX = 120


class _Notes:
    """Long cell values collected while a table is built, printed in full after it."""

    def __init__(self, st: dict[str, ParagraphStyle]) -> None:
        self.st = st
        self.items: list[tuple[str, str]] = []

    def cell(self, value: Any, *, label: str, markup: str | None = None) -> Paragraph:
        text = "" if value is None else str(value)
        if len(text) <= _CELL_MAX and text.count("\n") < _CELL_MAX_LINES:
            return Paragraph(markup if markup is not None else _multiline(text), self.st["body"])
        self.items.append((label, text))
        return Paragraph(f'<font color="{_DIM}">→ Anm. {len(self.items)}</font>', self.st["body"])

    def flush(self, story: list[Any]) -> None:
        for n, (label, text) in enumerate(self.items, start=1):
            story.append(Paragraph(f"<b>Anm. {n}</b> · {_esc(label)}", self.st["label"]))
            story.append(Paragraph(_multiline(text), self.st["body"]))
            story.append(Spacer(1, 1.5 * mm))
        self.items.clear()


def render_visit_pdf(
    doc: dict[str, Any],
    *,
    revision: int,
    stand: Any,
    station: str,
    url: str,
    created_by: str | None,
    photos: dict[str, bytes | None],
    filing: str | None = None,
) -> bytes:
    """One revision's report. ``photos`` maps attachment id → bytes (None = not stored yet);
    ``filing`` is where a visit at a place is filed («Allgemeine Meldungen/…»), printed as «Ablage».

    Rendered with tables; should a document still defeat the layout (a value no rule above
    anticipated), it is rendered again as plain flowing text — a report that prints everything
    less prettily beats a 500 and a delivery that retries forever.
    """
    args = (doc, revision, stand, station, url, created_by, photos)
    try:
        return _render(*args, plain=False, filing=filing)
    except LayoutError:
        logger.warning("object visit %s r%s: table layout failed — rendered as plain text", doc.get("id"), revision)
        return _render(*args, plain=True, filing=filing)


def answer_digest(items: list[dict[str, Any]], answers: dict[str, Any], limit: int = 400) -> str:
    """The answered choices and texts of a checklist, in order: «Hydrant · Neuer Hydrant fehlt»."""
    parts: list[str] = []
    for item in items:
        if item.get("input") not in ("choice", "text"):
            continue
        answer = answers.get(item["id"])
        if isinstance(answer, dict) and answer.get("v") not in (None, ""):
            parts.append(" ".join(answer_text(item, answer).split()))
    line = " · ".join(parts)
    return line if len(line) <= limit else line[: limit - 1].rstrip() + "…"


def place_kind(target: dict[str, Any]) -> str:
    """«Adresse» when the place was picked as an address (its label IS the address's first part),
    else «Pin» — the client's badge, same rule (src/objectVisits/place.ts · placeKind)."""
    label = " ".join(str(target.get("label") or "").split()).casefold()
    address = " ".join(str(target.get("address") or "").split()).casefold()
    return "Adresse" if label and address and address.split(",")[0].strip() == label else "Pin"


def fmt_ch(value: float) -> str:
    """2610027 → «2'610'027» (the Swiss grouping LV95 is read in)."""
    return f"{round(value):,}".replace(",", "’")


def coordinates_text(lat: Any, lng: Any) -> str | None:
    """«LV95 2'610'027 / 1'263'276 · WGS84 47.52015, 7.57175», or None without a position."""
    if not isinstance(lat, (int, float)) or not isinstance(lng, (int, float)) or isinstance(lat, bool):
        return None
    east, north = wgs84_to_lv95(float(lat), float(lng))
    return f"LV95 {fmt_ch(east)} / {fmt_ch(north)} · WGS84 {float(lat):.5f}, {float(lng):.5f}"


def _render(
    doc: dict[str, Any],
    revision: int,
    stand: Any,
    station: str,
    url: str,
    created_by: str | None,
    photos: dict[str, bytes | None],
    *,
    plain: bool,
    filing: str | None = None,
) -> bytes:
    st = _styles()
    buf = io.BytesIO()
    lifecycle = str(doc.get("lifecycle") or "draft")
    obj = doc.get("object") or {}
    checklist = doc.get("checklist") if isinstance(doc.get("checklist"), dict) else None
    title = (checklist or {}).get("title") or "Objektbesuch"
    footer_bits = [
        f"Checkliste {checklist.get('id')} v{checklist.get('version', '–')}" if checklist else "ohne Checkliste",
        f"Besuch {doc.get('id')}",
        url,
    ]

    def _footer(canvas, document) -> None:
        canvas.saveState()
        canvas.setFont("Helvetica", 7)
        canvas.setFillColor(colors.HexColor(_DIM))
        canvas.drawString(15 * mm, 9 * mm, _nfc(" · ".join(str(b) for b in footer_bits))[:180])
        canvas.drawRightString(A4[0] - 15 * mm, 9 * mm, f"Seite {document.page}")
        canvas.restoreState()

    pdf = SimpleDocTemplate(
        buf,
        pagesize=A4,
        leftMargin=15 * mm,
        rightMargin=15 * mm,
        topMargin=14 * mm,
        bottomMargin=16 * mm,
        title=f"Objektbesuch {obj.get('name') or (doc.get('target') or {}).get('label') or ''}".strip(),
        author=station,
    )
    width = A4[0] - 30 * mm
    story: list[Any] = []

    # --- head -------------------------------------------------------------------------
    stamp = Paragraph(
        f'<font color="{_STAMP_COLORS.get(lifecycle, "#000000")}">{_STAMPS.get(lifecycle, lifecycle.upper())}</font>',
        st["stamp"],
    )
    head = Table(
        [
            [Paragraph(_esc(station), st["small"]), stamp],
            [Paragraph(f"Objektbesuch · {_esc(str(title)[:200])}", st["h1"]), ""],
        ],
        colWidths=[width - 45 * mm, 45 * mm],
    )
    head.setStyle(
        TableStyle(
            [
                ("ALIGN", (1, 0), (1, 0), "RIGHT"),
                ("VALIGN", (0, 0), (-1, -1), "TOP"),
                ("LEFTPADDING", (0, 0), (-1, -1), 0),
                ("RIGHTPADDING", (0, 0), (-1, -1), 0),
            ]
        )
    )
    story.append(head)
    story.append(Spacer(1, 3 * mm))
    # «Von» is who was THERE — the free-text people of the visit (`with`), because accounts are
    # generic (a station tablet, «fu»). The account that saved it follows, smaller; it stands in
    # for «Von» only when nobody was named.
    names = [p.strip() for p in doc.get("with") or [] if isinstance(p, str) and p.strip()]
    account = created_by.strip() if isinstance(created_by, str) and created_by.strip() else None
    target: dict[str, Any] = doc["target"] if isinstance(doc.get("target"), dict) else {}
    if target.get("kind") == "location":
        # a visit at a place: no station object, and the place itself travels with the report
        facts: list[tuple[str, str, str]] = [
            ("Objekt", "– (Ort ohne Stationsobjekt)", "body"),
            ("Ort", f"{target.get('label') or '–'} ({place_kind(target)})", "body"),
        ]
        if target.get("address"):
            facts.append(("Adresse", str(target["address"]), "body"))
        facts.append(("Koordinaten", coordinates_text(target.get("lat"), target.get("lng")) or "–", "body"))
        if filing:
            facts.append(("Ablage", filing, "body"))
    else:
        facts = [
            ("Objekt", obj.get("name") or "–", "body"),
            ("Adresse", obj.get("address") or "–", "body"),
        ]
    facts += [
        ("Besucht", _fmt(doc.get("visitedAt")), "body"),
        ("Von", ", ".join(names) or account or "–", "body"),
    ]
    if names and account:
        facts.append(("Konto", account, "small"))
    facts.append(("Stand", f"Revision {revision} · Stand {_fmt(stand)}", "body"))
    if doc.get("workRef"):
        facts.append(("Auftrag", doc["workRef"], "body"))
    if plain:
        story.extend(Paragraph(f"<b>{_esc(k)}</b>: {_esc(v)}", st[style]) for k, v, style in facts)
    info = Table(
        [[Paragraph(_esc(k), st["label"]), Paragraph(_esc(v), st[style])] for k, v, style in facts],
        colWidths=[28 * mm, width - 28 * mm],
    )
    info.setStyle(
        TableStyle(
            [
                ("BACKGROUND", (0, 0), (-1, -1), _PANEL),
                ("BOX", (0, 0), (-1, -1), 0.6, _GRID),
                ("VALIGN", (0, 0), (-1, -1), "TOP"),
                ("TOPPADDING", (0, 0), (-1, -1), 2),
                ("BOTTOMPADDING", (0, 0), (-1, -1), 2),
            ]
        )
    )
    if not plain:
        story.append(info)

    # --- findings ---------------------------------------------------------------------
    answers = doc.get("answers") or {}
    items = visit_items(checklist)
    by_id = {i["id"]: i for i in items}
    defects = [(k, a) for k, a in answers.items() if isinstance(a, dict) and a.get("v") == "defect"]
    unanswered = [i for i in items if i["id"] not in answers]
    story.append(Paragraph("Zusammenfassung", st["h2"]))
    if defects:
        lines = [
            f"• {_esc((by_id.get(k) or {}).get('text') or k)}" + (f" – {_esc(a.get('note'))}" if a.get("note") else "")
            for k, a in defects
        ]
        story.append(
            Paragraph(
                f"<b>{len(defects)} {'Mangel' if len(defects) == 1 else 'Mängel'}</b><br/>" + "<br/>".join(lines),
                st["body"],
            )
        )
    elif items and not any(i.get("input", "check") == "check" for i in items):
        # a checklist without OK/Mangel questions (a Fehlermeldung) is a report: say what was
        # reported, never «Keine Mängel» (the visit card does the same — ovFormat · answerDigest)
        story.append(Paragraph(_esc(answer_digest(items, answers)) or "–", st["body"]))
    else:
        story.append(Paragraph("Keine Mängel erfasst.", st["body"]))
    if checklist and unanswered:
        story.append(
            Paragraph(f"{len(unanswered)} {'Punkt' if len(unanswered) == 1 else 'Punkte'} nicht geprüft.", st["small"])
        )

    # --- checklist --------------------------------------------------------------------
    if checklist:
        story.append(Paragraph(f"Checkliste: {_esc(title)}", st["h2"]))
        notes_c = _Notes(st)
        rows: list[list[Any]] = [
            [Paragraph("Punkt", st["label"]), Paragraph("Antwort", st["label"]), Paragraph("Notiz", st["label"])]
        ]
        styles: list[tuple] = []
        phase = None
        for item in items:
            if item["_phase"] != phase:
                phase = item["_phase"]
                if phase:
                    if plain:
                        story.append(Paragraph(f"<b>{_esc(phase)}</b>", st["body"]))
                    else:
                        rows.append([notes_c.cell(phase, label="Abschnitt", markup=f"<b>{_esc(phase)}</b>"), "", ""])
                        styles.append(("SPAN", (0, len(rows) - 1), (-1, len(rows) - 1)))
                        styles.append(("BACKGROUND", (0, len(rows) - 1), (-1, len(rows) - 1), _PANEL))
            answer = answers.get(item["id"])
            text = answer_text(item, answer)
            shown = f'<font color="#8a1c14"><b>{_esc(text)}</b></font>' if text == "Mangel" else _multiline(text)
            if text == "nicht geprüft":
                shown = f'<font color="{_DIM}"><i>nicht geprüft</i></font>'
            note = answer.get("note") if isinstance(answer, dict) else None
            if plain:
                line = f"{_multiline(item.get('text'))}: {shown}"
                if note:
                    line += f" – {_multiline(note)}"
                story.append(Paragraph(line, st["body"]))
                continue
            label = str(item.get("text") or item["id"])[:60]
            rows.append(
                [
                    notes_c.cell(item.get("text"), label="Punkt"),
                    notes_c.cell(text, label=f"Antwort · {label}", markup=shown),
                    notes_c.cell(note, label=f"Notiz · {label}"),
                ]
            )
        if not plain:
            table = Table(rows, colWidths=[width * 0.48, width * 0.17, width * 0.35], repeatRows=1, splitInRow=1)
            table.setStyle(
                TableStyle(
                    [
                        ("GRID", (0, 0), (-1, -1), 0.4, _GRID),
                        ("VALIGN", (0, 0), (-1, -1), "TOP"),
                        ("BACKGROUND", (0, 0), (-1, 0), colors.HexColor("#dfe5ee")),
                        *styles,
                    ]
                )
            )
            story.append(table)
            notes_c.flush(story)

    # --- notes ------------------------------------------------------------------------
    story.append(Paragraph("Bemerkungen", st["h2"]))
    notes = doc.get("notes")
    story.append(Paragraph(_multiline(notes) if notes else "–", st["body"]))

    # --- proposals --------------------------------------------------------------------
    proposals = [p for p in doc.get("proposals") or [] if isinstance(p, dict)]
    if proposals:
        story.append(Paragraph("Korrekturvorschläge (zur Prüfung, nicht übernommen)", st["h2"]))
        if plain:
            for p in proposals:
                story.append(Paragraph(f"<b>{_esc(p.get('label') or p.get('field'))}</b>", st["body"]))
                for key, word in (("current", "Bisher"), ("proposed", "Neu"), ("reason", "Begründung")):
                    if p.get(key):
                        story.append(Paragraph(f"{word}: {_multiline(p.get(key))}", st["body"]))
        else:
            notes_p = _Notes(st)
            rows = [[Paragraph(h, st["label"]) for h in ("Feld", "Bisher", "Neu", "Begründung")]]
            for p in proposals:
                label = str(p.get("label") or p.get("field") or "")
                rows.append(
                    [
                        notes_p.cell(label, label="Feld"),
                        notes_p.cell(p.get("current"), label=f"Bisher · {label[:60]}"),
                        notes_p.cell(p.get("proposed"), label=f"Neu · {label[:60]}"),
                        notes_p.cell(p.get("reason"), label=f"Begründung · {label[:60]}"),
                    ]
                )
            table = Table(
                rows, colWidths=[width * 0.2, width * 0.25, width * 0.25, width * 0.3], repeatRows=1, splitInRow=1
            )
            table.setStyle(
                TableStyle(
                    [
                        ("GRID", (0, 0), (-1, -1), 0.4, _GRID),
                        ("VALIGN", (0, 0), (-1, -1), "TOP"),
                        ("BACKGROUND", (0, 0), (-1, 0), colors.HexColor("#dfe5ee")),
                    ]
                )
            )
            story.append(table)
            notes_p.flush(story)

    # --- photos -----------------------------------------------------------------------
    listed = [p for p in doc.get("photos") or [] if isinstance(p, dict) and isinstance(p.get("id"), str)]
    if listed:
        # the heading never stays behind alone at the foot of a page
        story.append(Paragraph(f"Fotos ({len(listed)})", ParagraphStyle("h2keep", parent=st["h2"], keepWithNext=1)))
        cell_w = (width - 6 * mm) / 2
        cell_h = 70 * mm
        cells: list[Any] = []
        for n, p in enumerate(listed, start=1):
            picture: Any = _photo_flowable(photos.get(p["id"]), cell_w, cell_h)
            if picture is None:
                picture = _placeholder(
                    "Foto ausstehend" if photos.get(p["id"]) is None else "Foto nicht lesbar", cell_w, cell_h, st
                )
            linked = by_id.get(p.get("item") or "")
            caption = f"{n:02d} {_esc(p.get('caption') or 'Foto')}"
            if linked:
                linked_text = str(linked.get("text") or "")[:_CAPTION_ITEM_MAX]
                caption += f' <font color="{_DIM}">· {_esc(linked_text)}</font>'
            if plain:
                story.extend([picture, Spacer(1, 1.5 * mm), Paragraph(caption, st["caption"]), Spacer(1, 3 * mm)])
                continue
            cells.append([picture, Spacer(1, 1.5 * mm), Paragraph(caption, st["caption"])])
    if listed and cells:
        grid = [cells[i : i + 2] + [""] * (2 - len(cells[i : i + 2])) for i in range(0, len(cells), 2)]
        table = Table(grid, colWidths=[cell_w + 3 * mm, cell_w + 3 * mm])
        table.setStyle(
            TableStyle(
                [
                    ("VALIGN", (0, 0), (-1, -1), "TOP"),
                    ("LEFTPADDING", (0, 0), (-1, -1), 0),
                    ("BOTTOMPADDING", (0, 0), (-1, -1), 4 * mm),
                ]
            )
        )
        story.append(table)

    pdf.build(story, onFirstPage=_footer, onLaterPages=_footer)
    return buf.getvalue()
