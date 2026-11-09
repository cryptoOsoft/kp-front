"""Paragraph styles, colours, markup and the flowables every Rapport sheet is built from.

Split out of the former ``report_pdf.py``; rules for this area: docs/rapport.md.
"""

from __future__ import annotations

import io
import logging
import re
from html.parser import HTMLParser

from PIL import Image as PILImage
from PIL import ImageOps
from reportlab.lib import colors
from reportlab.lib.enums import TA_CENTER, TA_LEFT, TA_RIGHT
from reportlab.lib.styles import ParagraphStyle, getSampleStyleSheet
from reportlab.lib.units import mm
from reportlab.lib.utils import ImageReader
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfgen import canvas as _canvas
from reportlab.platypus import (
    Flowable,
    Image,
    NextPageTemplate,
    PageBreak,
    Paragraph,
    Spacer,
    Table,
    TableStyle,
)

from .labels import _TIME_STUB
from .schema import SignatureStrokesIn

logger = logging.getLogger(__name__)

# ----------------------------------------------------------------------------- styles


class _NumberedCanvas(_canvas.Canvas):
    """Two-pass canvas: buffers pages, then stamps «n / total» bottom-right on save —
    ReportLab has no forward page count in a single pass. The Einsatz is named bottom-left:
    a rapport is 2 pages or 25, it gets stapled, unstapled and passed around, and a sheet that
    does not say which Einsatz it belongs to cannot be put back."""

    footer_label = ""

    def __init__(self, *args, **kwargs):
        super().__init__(*args, **kwargs)
        self._saved_states: list[dict] = []

    def showPage(self):  # noqa: N802 — ReportLab API name
        self._saved_states.append(dict(self.__dict__))
        self._startPage()

    def save(self):
        total = len(self._saved_states)
        for state in self._saved_states:
            self.__dict__.update(state)
            w = self._pagesize[0]
            self.setFont("Helvetica", 8)
            self.setFillColor(colors.HexColor("#8a94a3"))
            self.drawRightString(w - 14 * mm, 8 * mm, f"{self._pageNumber} / {total}")
            if self.footer_label:
                self.drawString(14 * mm, 8 * mm, _fit_text(self, self.footer_label, w - 40 * mm, size=8))
            _canvas.Canvas.showPage(self)
        _canvas.Canvas.save(self)


def _collapse_breaks(story: list) -> list:
    """Drop the empty pages that fall out of composing the Anhang section by section.

    ⚠️ Every Anhang section both OPENS with «switch template, break» and CLOSES by switching
    back — so two adjacent sections put two page breaks in a row and eject a sheet carrying
    nothing but the footer (observed between the Kroki and the Beilagen), and a rapport whose
    last section is the Kroki, the plans or the Beilagen ends on one. Sections stay independent —
    each may legitimately be absent — so the fix belongs here: keep at most ONE break per run,
    with the last template switch that preceded it, and drop the run at the end entirely.
    """
    out: list = []
    i, n = 0, len(story)
    while i < n:
        if not isinstance(story[i], (PageBreak, NextPageTemplate, Spacer)):
            out.append(story[i])
            i += 1
            continue
        j, tmpl, brk = i, None, False
        while j < n and isinstance(story[j], (PageBreak, NextPageTemplate, Spacer)):
            if isinstance(story[j], NextPageTemplate):
                tmpl = story[j]
            elif isinstance(story[j], PageBreak):
                brk = True
            j += 1
        if j < n:  # a run in the MIDDLE: one template switch, one break
            if tmpl is not None:
                out.append(tmpl)
            if brk:
                out.append(PageBreak())
            else:
                out.extend(f for f in story[i:j] if isinstance(f, Spacer))
        i = j
    return out


def _styles() -> dict[str, ParagraphStyle]:
    base = getSampleStyleSheet()
    ink = colors.HexColor("#1b2330")
    dim = colors.HexColor("#5b6573")

    # ⚠️ THIN underlines, hung a little lower — for every style that can carry an `<a><u>…</u></a>`
    # (src/lib/journalLinks.ts · linkMarkup writes them, `_tel_markup` writes the partner ones).
    # ReportLab's default rule is heavy and sits tight under the baseline, and on the 03.09.
    # Rapport the addresses and callback numbers in the journal read as struck through rather than
    # as something to follow. 0.4pt, 18 % of the type size below the baseline: a link on paper is
    # a hint, not a second sentence. The colour follows the text so the rule is never the darkest
    # thing in its own line.
    def link(color: colors.Color) -> dict[str, object]:
        return {"underlineWidth": 0.4, "underlineOffset": "-0.18*F", "underlineColor": color}

    return {
        # the built-in Title style is CENTERED; force left so titles/headings sit at the margin
        # (the real alignment fix is zeroing the Frame side padding below).
        "title": ParagraphStyle(
            "rp_title",
            parent=base["Title"],
            fontSize=20,
            leading=24,
            textColor=ink,
            spaceAfter=2,
            alignment=TA_LEFT,
            leftIndent=0,
        ),
        "eyebrow": ParagraphStyle(
            "rp_eyebrow",
            parent=base["Normal"],
            fontSize=10,
            leading=12,
            textColor=dim,
            spaceAfter=1,
            fontName="Helvetica-Bold",
            alignment=TA_LEFT,
            leftIndent=0,
        ),
        # section heading matching the Erfassungsblatt: 11.5pt bold with a solid dark rule
        # right underneath (the rule is a separate HRFlowable, see head() in the composer)
        "h2": ParagraphStyle(
            "rp_h2",
            parent=base["Heading2"],
            fontSize=12.5,
            leading=14,
            textColor=ink,
            spaceBefore=16,
            spaceAfter=2,
            alignment=TA_LEFT,
            leftIndent=0,
            # the rule under it carries the same flag — see head()
            keepWithNext=1,
        ),
        "h3": ParagraphStyle(
            "rp_h3",
            parent=base["Heading3"],
            fontSize=10.5,
            leading=13,
            textColor=ink,
            spaceBefore=6,
            spaceAfter=3,
            alignment=TA_LEFT,
            leftIndent=0,
        ),
        "body": ParagraphStyle(
            "rp_body",
            parent=base["Normal"],
            fontSize=10,
            leading=13.5,
            textColor=ink,
            alignment=TA_LEFT,
            **link(ink),
        ),
        "label": ParagraphStyle(
            "rp_label",
            parent=base["Normal"],
            fontSize=8.5,
            leading=11,
            textColor=dim,
            fontName="Helvetica-Bold",
            spaceAfter=0,
        ),
        # the journal's Eintrag column — where nearly every link on the sheet actually lands
        "cell": ParagraphStyle("rp_cell", parent=base["Normal"], fontSize=9, leading=12, textColor=ink, **link(ink)),
        "exercise": ParagraphStyle(
            "rp_exercise",
            parent=base["Normal"],
            fontSize=11,
            leading=13,
            textColor=colors.HexColor("#b4690a"),
            fontName="Helvetica-Bold",
            spaceAfter=3,
        ),
        "cellhead": ParagraphStyle(
            "rp_cellhead", parent=base["Normal"], fontSize=8, leading=10, textColor=dim, fontName="Helvetica-Bold"
        ),
        # a Meldung under its Pendenz: indented and quieter, so the item's own «Was» still reads
        # as the line and the updates read as what came back on it
        "subline": ParagraphStyle(
            "rp_subline", parent=base["Normal"], fontSize=8, leading=10.5, textColor=dim, leftIndent=8
        ),
        "muted": ParagraphStyle("rp_muted", parent=base["Normal"], fontSize=9, leading=12, textColor=dim, **link(dim)),
        "mono": ParagraphStyle(
            "rp_mono", parent=base["Normal"], fontSize=8.5, leading=11, textColor=ink, fontName="Courier"
        ),
        "stub": ParagraphStyle(
            "rp_stub", parent=base["Normal"], fontSize=9, leading=12, textColor=colors.HexColor("#969696")
        ),
        # the tick inside a checkbox square — centered in its narrow cell
        "check": ParagraphStyle(
            "rp_check", parent=base["Normal"], fontSize=8.5, leading=10, textColor=ink, alignment=TA_CENTER
        ),
        # compact worksheet rows (roster / Material) — tight leading so a 66er roster
        # plus Material plus signatures still lands on two sheets
        # …and the partner table's callback numbers ride in this one (see `_tel_markup`)
        "rcell": ParagraphStyle(
            "rp_rcell", parent=base["Normal"], fontSize=8.5, leading=10, textColor=ink, **link(ink)
        ),
        "rstub": ParagraphStyle(
            "rp_rstub", parent=base["Normal"], fontSize=8.5, leading=10, textColor=colors.HexColor("#969696")
        ),
        # right-hanging variants for the Material amount column — a quantity is read down the
        # column, so it has to end on the same edge whatever the label beside it does
        "ramt": ParagraphStyle(
            "rp_ramt", parent=base["Normal"], fontSize=8.5, leading=10, textColor=ink, alignment=TA_RIGHT
        ),
        "rstubr": ParagraphStyle(
            "rp_rstubr",
            parent=base["Normal"],
            fontSize=8.5,
            leading=10,
            textColor=colors.HexColor("#969696"),
            alignment=TA_RIGHT,
        ),
        # The unit sits in its own column beside the amount, so «Stk» / «Sack» / «l» form one
        # column and the write-in rule beside them is one width — see _mittel_table.
        "runit": ParagraphStyle("rp_runit", parent=base["Normal"], fontSize=8.5, leading=10, textColor=dim),
        # the dash between «von» and «bis», centred in its own narrow column so it lands on
        # one x down the whole roster — see _personal_table
        "rdash": ParagraphStyle(
            "rp_rdash", parent=base["Normal"], fontSize=8.5, leading=10, textColor=dim, alignment=TA_CENTER
        ),
        # A remark is its OWN paragraph, not an inline <font size="6.5"> inside the label. Inline,
        # it inherited the label's 10pt leading — 3.5pt of lead on a 6.5pt face against 1.5pt on
        # the 8.5pt name above it — so a remark hung away from the line it belongs to and the
        # amount beside it aligned with neither. Its own style also gets it its own colour, which
        # was hardcoded twice as #5b6472 against the #5b6573 every other dim thing uses.
        "rnote": ParagraphStyle(
            "rp_rnote", parent=base["Normal"], fontSize=6.5, leading=8, spaceBefore=1, textColor=dim
        ),
    }


_GRID = colors.HexColor("#d7dde5")
_PANEL = colors.HexColor("#eef2f7")
#: the «!» that marks a dringende Pendenz. Dark enough to survive a monochrome
#: printer as a solid mark rather than a grey smudge — most station printers are one.
_URGENT = "#b21f14"
_WRITE = colors.HexColor("#969696")  # write-in dotted leaders/stubs (jsPDF gray 150)
#: a clock the app derived rather than one somebody recorded — same grey as a write-in stub,
#: because both mean «this is not a measured value»
_DERIVED = "#969696"
_INK = colors.HexColor("#141414")  # form ink (jsPDF gray 20)
#: the dim ink every secondary line uses (styles · dim), as a string for inline <font> markup
_DIM_INK = "#5b6573"
_LABEL = colors.HexColor("#3c3c3c")  # field labels (jsPDF gray 60)


def _esc(s: str | None) -> str:
    return (s or "").replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;")


def _esc_attr(s: str | None) -> str:
    """`_esc` for a double-quoted ReportLab attribute value — the quote characters too. A decoded
    link (`&quot;` in the source becomes a literal `"` after the parser) would otherwise close the
    `href="…"` and make ReportLab's mini-parser raise, breaking the whole print, besides being an
    escaping gap (SEC-07, 05.09.)."""
    return _esc(s).replace('"', "&quot;").replace("'", "&#39;")


#: The whole formatting vocabulary a journal row can arrive with — what
#: `src/lib/journalLinks.ts · linkMarkup` produces and nothing else: a bold vocabulary name, the
#: link around an address or a callback number with its underline, and a line break.
_MARKUP_TAGS = frozenset({"b", "i", "u", "br", "a"})
#: Schemes a printed link may carry. The PDF reader turns an anchor into a tap — `tel:` straight
#: into a call — so the set is the three that mean something on paper.
_LINK_SCHEMES = ("http://", "https://", "mailto:", "tel:")


class _MarkupFilter(HTMLParser):
    """Rewrites client markup into the tags ReportLab may be handed.

    ⚠️ THE THREAT. ``Paragraph`` markup is not text with some bold in it — it is a document
    language with `<img src>` (read a file or a URL), `<onDraw>` and `<font face>` in it, and the
    row it renders arrives from the client already escaped, i.e. trusted (SEC-07, 05.09.). A
    caller with report access could name any image file the container can read and have it
    printed into the Rapport. Everything outside `_MARKUP_TAGS` is dropped — the tag, not its
    words: a Meldung whose formatting this server does not know still has to print its sentence.
    """

    def __init__(self) -> None:
        super().__init__(convert_charrefs=True)
        self.out: list[str] = []
        self._open: list[str] = []  # kept tags still to be closed, innermost last

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        if tag == "br":
            self.out.append("<br/>")
            return
        if tag not in _MARKUP_TAGS:
            return
        if tag == "a":
            href = next((v or "" for k, v in attrs if k == "href"), "")
            if not href.lower().startswith(_LINK_SCHEMES):
                return  # not a link anybody can follow off paper — keep the words, drop the tag
            self.out.append(f'<a href="{_esc_attr(href)}">')
        else:
            self.out.append(f"<{tag}>")  # attributes are never carried through
        self._open.append(tag)

    def handle_startendtag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        if tag == "br":
            self.out.append("<br/>")

    def handle_endtag(self, tag: str) -> None:
        if tag not in self._open:
            return  # a stray close tag would unbalance the paragraph
        while self._open:
            open_tag = self._open.pop()
            self.out.append(f"</{open_tag}>")
            if open_tag == tag:
                break

    def handle_data(self, data: str) -> None:
        self.out.append(_esc(data))

    def result(self) -> str:
        return "".join(self.out) + "".join(f"</{t}>" for t in reversed(self._open))


def safe_markup(markup: str | None) -> str:
    """Client journal markup, reduced to the formatting this app itself produces.

    Unparseable input falls back to the escaped source text: a row that cannot be formatted
    still has to appear in the Beilage — it is the legal record, not decoration.
    """
    if not markup:
        return ""
    try:
        f = _MarkupFilter()
        f.feed(markup)
        f.close()
        return f.result()
    except Exception:  # noqa: BLE001 — a malformed row must not cost the whole Rapport
        logger.warning("Journal-Markup unlesbar — die Zeile wird als reiner Text gedruckt", exc_info=True)
        return _esc(re.sub(r"<[^>]*>", "", markup))


#: A Swiss phone number, and deliberately only that — the mirror of ``phoneRanges`` in
#: src/lib/journalLinks.ts, which marks the numbers inside journal entries. Ten digits written
#: nationally («079 123 45 67», «044 123 45 67») or internationally («+41 79 123 45 67»), grouped
#: 3-3-2-2 the way the Post writes them, separated by a space, «/», «.», «-» or nothing at all.
#: A rapport is full of numbers that are not numbers to call — «14:31», «250 bar», «01.09.2026» —
#: and a guess costs a dead tap target in the middle of a signed document.
_PHONE_RE = re.compile(r"(?:\+41[ ./-]?|0)\d{2}[ ./-]?\d{3}[ ./-]?\d{2}[ ./-]?\d{2}")


def _phone_spans(text: str) -> list[tuple[int, int]]:
    """Where the dialable numbers sit in ``text`` — half-open ``(start, end)`` offsets.

    ⚠️ Glued to a letter or another digit it is a longer number that happens to contain ten of
    them (an Einsatz-ID, a Zählerstand, a reference), never a number anybody dials.
    """
    out: list[tuple[int, int]] = []
    for m in _PHONE_RE.finditer(text):
        before = text[m.start() - 1] if m.start() else ""
        after = text[m.end() : m.end() + 1]
        if before.isalnum() or before == "+" or after.isalnum():
            continue
        out.append((m.start(), m.end()))
    return out


def _tel(number: str) -> str:
    """The dialable form: digits only, keeping the country code's «+». Never escaped, because
    that character class cannot carry anything XML would have to be told about."""
    return "tel:" + re.sub(r"[^\d+]", "", number)


def _tel_markup(text: str) -> str:
    """``text`` escaped for a Paragraph, with every phone number in it wrapped in a ``tel:``
    anchor — underlined like an address, because the sheet has no colour to spend and both mean
    «this can be followed». The segment is built BEFORE escaping so the markup escapes nothing
    of its own (the same order src/lib/journalLinks.ts uses)."""
    out: list[str] = []
    at = 0
    for start, end in _phone_spans(text):
        number = text[start:end]
        out.append(_esc(text[at:start]))
        out.append(f'<a href="{_tel(number)}"><u>{_esc(number)}</u></a>')
        at = end
    out.append(_esc(text[at:]))
    return "".join(out)


def _str_w(text: str, font: str, size: float) -> float:
    """Text width without a canvas — for sizing a column before there is anything to draw on."""
    return pdfmetrics.stringWidth(text, font, size)


def _fit_text(c, text: str, max_w: float, font: str = "Helvetica", size: float = 9) -> str:
    """Truncate to the field width with an ellipsis (jsPDF splitTextToSize[0] equivalent)."""
    if c.stringWidth(text, font, size) <= max_w:
        return text
    while text and c.stringWidth(text + "…", font, size) > max_w:
        text = text[:-1]
    return text + "…"


#: How far a wrapped form value's second line hangs under the first. Two-thirds of a `pitch`
#: slot: enough air under 9pt type to read as a continuation of the line above rather than a
#: field of its own, and short enough that the row still sits clear of the one below it.
_WRAP_LEAD = 4.0 * mm

#: A form field is not a paragraph — two lines, then the ellipsis. Past that the value is not a
#: name any more, and letting it grow would push the Details box off the page it shares with the
#: Kurzbericht.
_WRAP_MAX_LINES = 2


def _break_at(text: str, max_w: float, font: str, size: float) -> int:
    """Where to cut ``text`` so the first piece fits ``max_w`` — after the last space that still
    fits, or mid-word when a single unbroken token (a long e-mail address, a Liegenschafts-Nummer)
    is already too wide on its own. Returns an index ≥ 1, so a caller looping over the remainder
    always advances."""
    fit = 0
    for i in range(1, len(text) + 1):
        if _str_w(text[:i], font, size) > max_w:
            break
        fit = i
    if fit >= len(text):
        return len(text)
    space = text.rfind(" ", 0, fit + 1)
    return space if space > 0 else max(1, fit)


def _wrap_value(text: str, max_w: float, font: str = "Helvetica", size: float = 9) -> list[str]:
    """Break a form value into the lines it will be drawn on, at most ``_WRAP_MAX_LINES``.

    ⚠️ Measured with `_str_w` rather than a canvas, because `_FormRows` has to know its own
    height in `__init__` — long before ReportLab hands it something to draw on. Same font and
    size the drawing uses, or the box would reserve room for a different number of lines than it
    prints. The LAST line is returned whole: `draw()` runs it through `_fit_text`, so a value too
    long even for two lines ends in an ellipsis instead of being clipped silently.
    """
    if _str_w(text, font, size) <= max_w:
        return [text]
    lines: list[str] = []
    rest = text
    while rest and len(lines) < _WRAP_MAX_LINES:
        if len(lines) == _WRAP_MAX_LINES - 1:
            lines.append(rest)
            break
        cut = _break_at(rest, max_w, font, size)
        lines.append(rest[:cut].rstrip())
        rest = rest[cut:].lstrip()
    return [ln for ln in lines if ln] or [text]


def _link_tel_on_canvas(c, text: str, x: float, y: float, size: float) -> None:
    """Underline and anchor each phone number in canvas-drawn text as a ``tel:`` link.

    ⚠️ The Details box is painted straight onto the canvas (`_FormRows`), not assembled from
    Paragraphs, so there is no markup to hang an `<a>` on: the hotspot has to be measured off the
    very x/y/font the `drawString` used. Without it the one number on the sheet that actually gets
    dialled — the Kontaktperson's, in the Nachbearbeitung the next morning — is the one number
    nobody can tap. `relative=1` because a Flowable draws in its own translated coordinate system.

    ⚠️ …and the RULE is drawn here too (04.09.). A link annotation is invisible on paper and
    invisible in most PDF readers, so this number was the only address on the whole Rapport with
    nothing under it — the sheet marked every journal address and every partner's number and then
    said nothing about the one in its own Details box. Same 0.4pt at 18 % of the type size the
    Paragraph styles use (`_styles` · link), so a reader sees one treatment everywhere.
    """
    for start, end in _phone_spans(text):
        x0 = x + c.stringWidth(text[:start], "Helvetica", size)
        x1 = x0 + c.stringWidth(text[start:end], "Helvetica", size)
        c.saveState()
        c.setStrokeColor(_INK)
        c.setLineWidth(0.4)
        c.line(x0, y - 0.18 * size, x1, y - 0.18 * size)
        c.restoreState()
        # `y` is the baseline; a finger needs the line box, so descend a quarter and rise
        # three quarters of the type size around it
        c.linkURL(_tel(text[start:end]), (x0, y - 0.25 * size, x1, y + 0.75 * size), relative=1)


def _draw_signature(c, strokes: SignatureStrokesIn, x0: float, x1: float, base_y: float, max_h: float) -> None:
    """Draw a signature's strokes so their lowest point sits just under `base_y` (the rule) and
    they fill at most `x1 - x0` × `max_h`, aspect kept. The same curve the app draws
    (lib/reportSignature · strokesPath): quadratic segments through the midpoints, each written
    as the cubic it equals."""
    pts = [(s[i], s[i + 1]) for s in strokes.d for i in range(0, len(s) - 1, 2)]
    if not pts or x1 <= x0:
        return
    minx = min(p[0] for p in pts)
    maxx = max(p[0] for p in pts)
    miny = min(p[1] for p in pts)
    maxy = max(p[1] for p in pts)
    k = min((x1 - x0) / max(maxx - minx, 1), max_h / max(maxy - miny, 1))
    # a hand dips a little below the line, never into the small line under it
    bottom = base_y - 0.4 * mm

    def tx(px: float, py: float) -> tuple[float, float]:
        return x0 + (px - minx) * k, bottom + (maxy - py) * k

    c.saveState()
    c.setStrokeColor(colors.HexColor("#1b2330"))
    c.setLineWidth(0.9)
    c.setLineCap(1)
    c.setLineJoin(1)
    path = c.beginPath()
    for s in strokes.d:
        n = len(s) // 2
        if n < 2:
            continue
        p = [tx(s[2 * i], s[2 * i + 1]) for i in range(n)]
        path.moveTo(*p[0])
        cur = p[0]
        for i in range(1, n - 1):
            q = p[i]
            end = ((p[i][0] + p[i + 1][0]) / 2, (p[i][1] + p[i + 1][1]) / 2)
            c1 = (cur[0] + 2 / 3 * (q[0] - cur[0]), cur[1] + 2 / 3 * (q[1] - cur[1]))
            c2 = (end[0] + 2 / 3 * (q[0] - end[0]), end[1] + 2 / 3 * (q[1] - end[1]))
            path.curveTo(*c1, *c2, *end)
            cur = end
        path.lineTo(*p[-1])
    c.drawPath(path, stroke=1, fill=0)
    c.restoreState()


class _FormRows(Flowable):
    """Dotted-leader form fields exactly like the jsPDF Erfassungsblatt: `Label: ······`,
    with a recorded value printed ON the line (as handwriting would be). Each row is a list
    of fields `{label, w (fraction), value?, time?, tel?}`; `time` fields render the `__:__`
    stub instead of a leader, `tel` fields get a `tel:` hotspot over whatever number they
    printed. `boxed` draws the Details frame around the block."""

    def __init__(self, width: float, rows: list[list[dict]], boxed: bool = False, pitch: float = 8.5 * mm):
        super().__init__()
        self.width = width
        self.rows = rows
        self.boxed = boxed
        self.pitch = pitch
        self.pad = 3 * mm if boxed else 0
        # ⚠️ The TOP pad is smaller than the bottom one, and that is what makes them look equal.
        # Each row's text hangs at the BOTTOM of its own pitch slot, so the first row already
        # carries most of a slot of empty air above it: measured, the gap under the box's top rule
        # was 19pt against 13.4pt over the bottom one and 15.2pt between rows — the box read as
        # top-heavy, with «Kategorie» pushed away from the edge it belongs to.
        self.pad_top = max(0.0, self.pad - 5) if boxed else 0
        inner = self.width - 2 * self.pad
        self._stops = self._tab_stops(inner)
        # ⚠️ The geometry is resolved HERE, not in draw(): `height` has to be the truth before
        # ReportLab has laid anything out, or a wrapped row would print into the row below it and
        # through the box frame. One computation, read by both.
        self._geom = [self._row_fields(row, inner) for row in self.rows]
        self._extra = [max((len(g[4]) for g in row), default=1) - 1 for row in self._geom]
        # a drawn signature's small line hangs under its rule; under the LAST row it needs room of
        # its own, or it would print into whatever follows the block
        self._foot_pad = 3.2 * mm if rows and any(f.get("foot") for f in rows[-1]) else 0.0
        self.height = (
            len(rows) * self.pitch
            + sum(self._extra) * _WRAP_LEAD
            + self.pad
            + self.pad_top
            - (2.5 * mm if not boxed else 0)
            + self._foot_pad
        )

    def wrap(self, availWidth: float, availHeight: float):  # noqa: N803 — ReportLab API
        return self.width, self.height

    def _row_fields(self, row: list[dict], inner: float) -> list[tuple[dict, float, float, float, list[str]]]:
        """One row resolved to what draw() needs per field: `(field, x, width, value tab stop,
        value lines)`.

        A value that outruns its field WRAPS onto a second line rather than being ellipsised —
        on a document that is a legal record, a silently truncated Kontaktperson is data loss.
        The `sign` / `line` / `time` fields are deliberately left single-line: their rule starts
        where the printed value ends, and that rule belongs on the row's own baseline.
        """
        out: list[tuple[dict, float, float, float, list[str]]] = []
        offset = 0.0
        for f in row:
            x = self.pad + offset
            w = inner * f["w"]
            lx = x + self._stops[round(offset, 3)] + 2 * mm
            value = f.get("value") or ""
            wrappable = bool(value) and not (f.get("time") or f.get("sign") or f.get("line"))
            lines = _wrap_value(value, w - (lx - x) - 4 * mm) if wrappable else [value]
            out.append((f, x, w, lx, lines))
            offset += w
        return out

    def _tab_stops(self, inner: float) -> dict[float, float]:
        """One value column per label column: the widest label at a given x sets where every
        value at that x starts. Measuring each label on its own put «Stichwort: Brand» and
        «Adresse / Objekt: Schlossgasse 9» at different indents in the same box, so nothing in
        it lined up vertically. Keyed by the field's own x offset, so a full-width row and the
        left half of a split row share a stop and the right half gets its own."""
        stops: dict[float, float] = {}
        for row in self.rows:
            x = 0.0
            for f in row:
                key = round(x, 3)
                w = _str_w(f"{f['label']}:", "Helvetica", 9.5)
                stops[key] = max(stops.get(key, 0.0), w)
                x += inner * f["w"]
        return stops

    def draw(self):
        c = self.canv
        if self.boxed:
            c.setStrokeColor(colors.HexColor("#282828"))
            c.setLineWidth(1.1)
            c.rect(0, 0, self.width, self.height)
        # every wrapped line above this row pushes it — and everything under it — one lead down
        drop = 0.0
        for i, row_geom in enumerate(self._geom):
            y = self.height - self.pad_top - (i + 1) * self.pitch - drop + 2.4 * mm  # text baseline
            for f, x, w, lx, lines in row_geom:
                label = f"{f['label']}:"
                c.setFont("Helvetica", 9.5)
                c.setFillColor(_LABEL)
                c.drawString(x, y, label)
                value = f.get("value") or ""
                if f.get("time"):
                    c.setFont("Helvetica", 9.5)
                    c.setFillColor(_INK if value else _WRITE)
                    c.drawString(lx, y, value or _TIME_STUB)
                else:
                    # A leader is an invitation to write. It is drawn where there is nothing to
                    # read — an empty Kontaktperson still gets its line — and omitted under a
                    # value that is already printed.
                    #
                    # A SIGNATURE field always gets its rule, printed value or not — that is the
                    # only way it differs. It is drawn ON THE ROW'S OWN LINE and STARTS WHERE THE
                    # VALUE ENDS, so the whole thing reads as one line: «Einsatzleiter: Anna Meier
                    # ________». It used to hang a full writing height below the row, which put
                    # two rules at two heights in every Visum row and left the lower one nearer
                    # the NEXT row's «Ort, Datum» label than the name it belonged to. Signing
                    # happens on the rule, next to the name, exactly as «Ort, Datum: ____» works
                    # two centimetres to its left.
                    sig = bool(f.get("sign"))
                    rule_y = y - 0.6 * mm
                    shown = ""
                    drawn: list[str] = []
                    if value:
                        c.setFont("Helvetica", 9)
                        # the last line is the one that can still overrun — a value too long even
                        # for `_WRAP_MAX_LINES` ends in an ellipsis rather than being clipped
                        drawn = [*lines[:-1], _fit_text(c, lines[-1], w - (lx - x) - 4 * mm)]
                        shown = drawn[-1]  # what a rule has to start clear of
                    if not value or sig or f.get("line"):
                        # start clear of whatever is already printed, so the rule is somewhere to
                        # write rather than an underline through the name
                        start = lx + (_str_w(shown, "Helvetica", 9) + 2 * mm if shown else 0)
                        c.saveState()
                        c.setStrokeColor(_WRITE)
                        c.setLineWidth(0.5)
                        c.setDash(0.8, 0.8)
                        c.line(start, rule_y, x + w - 2 * mm, rule_y)
                        c.restoreState()
                        # a DRAWN signature (15.10.2026) sits on that rule, where a pen would
                        # have written it; its small line runs under the whole field, from the
                        # label — after the name there is not room for it
                        if f.get("ink") is not None:
                            _draw_signature(c, f["ink"], start + 1 * mm, x + w - 3 * mm, rule_y, 7.5 * mm)
                        if f.get("foot"):
                            c.saveState()
                            c.setFont("Helvetica", 6.5)
                            c.setFillColor(_LABEL)
                            c.drawString(x, rule_y - 3.2 * mm, _fit_text(c, f["foot"], w - 2 * mm, size=6.5))
                            c.restoreState()
                    if drawn:
                        c.setFont("Helvetica", 9)
                        c.setFillColor(_INK)
                        for n, line in enumerate(drawn):
                            # a continuation starts at the VALUE's tab stop, not under the label:
                            # the second half of a name is not a second field
                            ly = y - n * _WRAP_LEAD
                            c.drawString(lx, ly, line)
                            # measured on the line as DRAWN, not on the value: a hotspot must sit
                            # on the line its number actually landed on, and never over an
                            # ellipsis _fit_text put there
                            if f.get("tel"):
                                _link_tel_on_canvas(c, line, lx, ly, 9)
            drop += self._extra[i] * _WRAP_LEAD


#: Letterhead size for the station logo — tall enough to be recognised, short enough that the
#: incident title stays the first thing read on the page.
#:
#: Raised from 13mm on 09.08.: the mark sat against a title AND a subtitle line hung under it at
#: the page margin, so it read as the smallest thing in its own letterhead. With the subtitle
#: moved into the title cell the head is one two-line block ≈17mm tall, and the mark matches it.
_LOGO_H = 17 * mm
_LOGO_MAX_W = 60 * mm


def _logo_flowable(data: bytes | None) -> Image | None:
    """The station logo as a left-hung letterhead, or None when there is nothing printable.

    SVG is the default brandmark and ReportLab cannot read it, so it is rasterised through the
    same renderer the Kroki symbols use. Anything that fails to decode is skipped silently.
    """
    if not data:
        return None
    if data[:5] in (b"<?xml", b"<svg ") or b"<svg" in data[:512]:
        try:
            from .. import kroki as kk

            img = kk.raster_svg(data.decode("utf-8", "replace"), 512)
            b = io.BytesIO()
            img.save(b, "PNG")
            data = b.getvalue()
        except Exception:  # noqa: BLE001 — a logo never fails a rapport
            logger.warning("Logo konnte nicht gerendert werden — Rapport wird ohne Logo gedruckt.", exc_info=True)
            return None
    out = _fit_image(data, _LOGO_MAX_W, _LOGO_H)
    if out is not None:
        out.hAlign = "LEFT"
    return out


#: Re-encoding quality for the one case that needs it — see `_exif_upright`. High enough that a
#: photo turned the right way up is not visibly worse than the one that printed sideways.
_UPRIGHT_QUALITY = 92


def _exif_upright(data: bytes) -> bytes:
    """``data`` with its EXIF orientation applied — or the very same bytes, untouched.

    A phone writes the sensor's pixels plus a tag saying which way up they are. ReportLab reads
    the pixels and ignores the tag, so a landscape photo held upright came off the printer on its
    side (03.09. Journal). This is the same call `api/media.py · _render_thumb` makes on the
    thumbnails, for the same reason: a picture on paper has no viewer to rotate it.

    ⚠️ Only a picture that actually CARRIES a rotation is re-encoded. Everything else — the
    rasterised Kroki, the plan pages, the logo, every PNG — is handed back byte-for-byte, so
    nothing that already printed correctly can be changed by a round trip through the encoder.
    And an unreadable file returns unchanged: `_fit_image` below is the one that decides whether
    it is printable at all, and a rapport is never failed by a photo.
    """
    try:
        with PILImage.open(io.BytesIO(data)) as im:
            if im.getexif().get(0x0112, 1) in (1, None):  # 0x0112 = Orientation
                return data
            upright = ImageOps.exif_transpose(im) or im
            buf = io.BytesIO()
            if (im.format or "").upper() == "JPEG":
                upright.convert("RGB").save(buf, format="JPEG", quality=_UPRIGHT_QUALITY, optimize=True)
            else:
                # keeps the alpha a JPEG would flatten — a rotated PNG is rare, silently
                # losing its transparency on the one printed copy would not be
                upright.save(buf, format="PNG")
            return buf.getvalue()
    except Exception:  # noqa: BLE001 — an undecodable picture is _fit_image's problem, not ours
        return data


def _fit_image(data: bytes | None, max_w: float, max_h: float) -> Image | None:
    if not data:
        return None
    data = _exif_upright(data)
    try:
        iw, ih = ImageReader(io.BytesIO(data)).getSize()
    except Exception:  # noqa: BLE001 — unreadable image → no image, never a failed rapport
        # …but never a silent one: a photo missing from a signed Rapport has to be explainable.
        logger.warning("report: a picture could not be decoded and is left out", exc_info=True)
        return None
    if iw <= 0 or ih <= 0:
        return None
    scale = min(max_w / iw, max_h / ih)
    return Image(io.BytesIO(data), width=iw * scale, height=ih * scale)


# --- the numbered legend under a picture ---------------------------------------------------
# The renderer (app/kroki.py · _number_words) replaces every set of words on a picture with a
# numbered disc and hands back the words themselves. This is where they land — on the Kroki page
# and, since 26.08., on every annotated PLAN page, laid out identically so a reader who turns
# from one sheet to the next reads the same thing the same way.


def _legend_height(lines: list[str]) -> float:
    """The room a legend claims BELOW its picture, so the picture is sized to what is left over
    instead of pushing the block onto a second sheet. Two columns, hence half the rows."""
    return (5 * mm + ((len(lines) + 1) // 2) * 4.6 * mm) if lines else 0.0


def _legend_table(lines: list[str], width: float, st: dict[str, ParagraphStyle]) -> Table:
    """«1 · Brandherd – Melder 3. OG» — numbers down the left of each column, full text beside.

    ⚠️ TWO COLUMNS, directly under the picture (18.08.). One column of «1 …» ran the legend down
    half the page for a Lage with eight labelled things, which pushed the picture itself smaller
    (the block claims its room below) and put number 8 a hand's width away from the disc it
    belongs to. Reading «wo ist die 4» is a scan between two places; the shorter that distance,
    the less the numbering costs.
    """
    half = (len(lines) + 1) // 2
    left, right = lines[:half], lines[half:]
    num_w, col_gap = 7 * mm, 6 * mm
    text_w = (width - col_gap) / 2 - num_w
    rows = [
        [
            Paragraph(f"<b>{i + 1}</b>", st["cell"]),
            Paragraph(_esc(left[i]), st["cell"]),
            Paragraph(f"<b>{half + i + 1}</b>", st["cell"]) if i < len(right) else "",
            Paragraph(_esc(right[i]), st["cell"]) if i < len(right) else "",
        ]
        for i in range(len(left))
    ]
    lt = Table(rows, colWidths=[num_w, text_w, num_w, text_w])
    lt.setStyle(
        TableStyle(
            [
                ("VALIGN", (0, 0), (-1, -1), "TOP"),
                ("LEFTPADDING", (0, 0), (-1, -1), 0),
                ("RIGHTPADDING", (0, 0), (-1, -1), 0),
                ("TOPPADDING", (0, 0), (-1, -1), 1),
                ("BOTTOMPADDING", (0, 0), (-1, -1), 1),
            ]
        )
    )
    lt.hAlign = "LEFT"
    return lt


def _table_style() -> TableStyle:
    """The one grid-table look on the sheet: hairline grid, panel header row, 5pt inside cells.

    ⚠️ The first column once had its LEFTPADDING dropped to zero, so a table would line up with
    the section rule above it. Every one of these tables draws a GRID, so what that actually did
    was print the text ON the line — and in a column carrying prose with indented sub-lines
    («Aufträge / Pendenzen»), each sub-line's indent then measured from the border rather than
    from the text above it. Five points of daylight beats five points of heading alignment, and
    with the last caller gone the flag itself is no longer worth its explanation.
    """
    return TableStyle(
        [
            ("GRID", (0, 0), (-1, -1), 0.4, _GRID),
            ("BACKGROUND", (0, 0), (-1, 0), _PANEL),
            ("VALIGN", (0, 0), (-1, -1), "TOP"),
            ("TOPPADDING", (0, 0), (-1, -1), 4),
            ("BOTTOMPADDING", (0, 0), (-1, -1), 4),
            ("LEFTPADDING", (0, 0), (-1, -1), 5),
            ("RIGHTPADDING", (0, 0), (-1, -1), 5),
        ]
    )
