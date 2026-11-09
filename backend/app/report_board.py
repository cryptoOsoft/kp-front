"""The Tafel's pages in the Rapport (10.10.2026) — every board-template page prints as its PAPER.

The client resolves a page for print (src/lib/boardForm.ts · formForPdf): every label in the
deployment's language, every row as the strings that go on paper, trends as WORDS (Helvetica has
no ➚ ➘). This module never needs a template — it draws what it is handed, in the layout the page
says: the FKS «Erste Führung» as the A3 poster scaled onto A4 portrait (the same proportions),
2 × 3 grey-barred boxes, ruled rows, the six Signaturen; the Handbuch sheets as theirs.

⚠️ Nothing written is ever cut off the record. A table holding more rows than its box fits at a
legible size first shrinks the type (down to 6.5 pt), and whatever still does not fit is printed
as a «Fortsetzung» table right after the page (`overflow`). The Lagekarte box takes the server's
own Kroki render of the scene at print time (app/report · compose_report_pdf); without one it is
an empty box to sketch in by hand, as on the poster.
"""

from __future__ import annotations

import io
import logging
from dataclasses import dataclass, field

from pydantic import BaseModel
from reportlab.lib import colors
from reportlab.lib.units import mm
from reportlab.lib.utils import ImageReader
from reportlab.pdfbase.pdfmetrics import stringWidth
from reportlab.platypus import Flowable

logger = logging.getLogger(__name__)

# ----------------------------------------------------------------------------- payload


class BoardLineIn(BaseModel):
    text: str = ""
    #: the trend as a word («wird schlimmer») and as a direction (up · same · down) — the paper
    #: draws the arrow itself, Helvetica has none
    trend: str = ""
    dir: str = ""
    tag: str = ""


class BoardHeadIn(BaseModel):
    """One field of the optional header line, its label in the deployment's words."""

    label: str = ""
    value: str = ""


class BoardCellIn(BaseModel):
    """One box of a Problemerfassung."""

    label: str = ""
    lines: list[BoardLineIn] = []


class BoardColumnIn(BaseModel):
    label: str = ""
    #: text · time · trend · symbol · index (lib/boardTemplate · ColumnType)
    kind: str = "text"
    w: float = 1.0


class BoardRowIn(BaseModel):
    fixed: bool = False
    done: bool = False
    #: one string per column, in the columns' order (a symbol column carries the Signatur key)
    cells: list[str] = []


class BoardFieldIn(BaseModel):
    label: str = ""
    tone: str = ""
    value: str = ""


class BoardSectionIn(BaseModel):
    id: str = ""
    #: quad · map · table · text
    type: str = "table"
    title: str = ""
    subtitle: str = ""
    span: int = 1
    #: height on paper in ruled rows (0 = the type's default)
    height: int = 0
    # quad
    trend: bool = False
    tag: bool = False
    cells: list[BoardCellIn] = []
    # table
    done: bool = False
    #: rows may be written below the fixed ones — a fixed list (the Absprachepunkte) shares its
    #: whole body out among its rows instead of ruling empty ones under them
    adds: bool = True
    columns: list[BoardColumnIn] = []
    rows: list[BoardRowIn] = []
    # text
    layout: str = "stack"
    fields: list[BoardFieldIn] = []


class BoardPageIn(BaseModel):
    """One Tafel page, resolved by the client (lib/boardForm · formForPdf)."""

    title: str = ""
    source: str = ""
    #: the page's timeline, «Erstellt … · zuletzt bearbeitet …» (lib/boardForm · pageStamp)
    stamp: str = ""
    landscape: bool = False
    columns: int = 1
    #: the optional header line: Einsatz, Adresse, Alarm, Einsatzleiter (empty = switched off)
    head: list[BoardHeadIn] = []
    sections: list[BoardSectionIn] = []


# ----------------------------------------------------------------------------- the paper

#: the poster's grey section bar and its ruling
BAR = colors.HexColor("#9d9d9d")
RULE = colors.HexColor("#141414")
HAIR = colors.HexColor("#3c3c3c")
SIG = colors.HexColor("#1b75bc")
TONE = {"plus": colors.HexColor("#c6dfb0"), "minus": colors.HexColor("#f4a183"), "shade": colors.HexColor("#d0d2d3")}
DIM = colors.HexColor("#5b6573")

FONT, BOLD = "Helvetica", "Helvetica-Bold"
_BAR_H = 7.5 * mm
_GAP_X = 6 * mm
_GAP_Y = 5 * mm
_TITLE_H = 17 * mm
_FOOT_H = 7 * mm
_MIN_FS = 6.5
_FS = 8.5


def printable(s: str | None) -> str:
    """What Helvetica can draw: the trend arrows of a label («Entwicklungstendenz ➚ = ➘») as (+)
    and (–), anything else outside Windows-1252 as «?» rather than a black box."""
    t = (s or "").replace("➚", "(+)").replace("➘", "(–)").replace("→", "->").replace("←", "<-")
    return t.encode("cp1252", "replace").decode("cp1252")


SHY = "\u00ad"


def _hard_break(w: str, width: float, font: str, size: float) -> list[str]:
    """A word wider than the line, cut with a hyphen — never leaving a stub of under 3 letters."""
    out: list[str] = []
    while stringWidth(w, font, size) > width and len(w) > 1:
        cut = len(w) - 1
        while cut > 1 and (stringWidth(w[:cut] + "-", font, size) > width or len(w) - cut < 3):
            cut -= 1
        out.append(w[:cut] + "-")
        w = w[cut:]
    return [*out, w]


def wrap(text: str, width: float, font: str = FONT, size: float = _FS) -> list[str]:
    """Greedy word wrap that keeps line breaks. A word too long for the line breaks at its soft
    hyphens first (a template writes «Patienten\u00adsammelstelle» to split where the poster
    does), and only then anywhere, with a hyphen."""
    out: list[str] = []
    for para in printable(text).split("\n"):
        line = ""
        for word in para.split(" "):
            whole = word.replace(SHY, "")
            cand = f"{line} {whole}" if line else whole
            if stringWidth(cand, font, size) <= width:
                line = cand
                continue
            parts = word.split(SHY)
            # as many syllables as still fit behind what the line already holds
            while len(parts) > 1:
                k = len(parts) - 1
                while k > 0:
                    head = "".join(parts[:k]) + "-"
                    if stringWidth(f"{line} {head}" if line else head, font, size) <= width:
                        break
                    k -= 1
                if k == 0:
                    if not line:
                        break
                    out.append(line)
                    line = ""
                    # on a fresh line the rest of the word may fit whole: no hyphen then
                    if stringWidth("".join(parts), font, size) <= width:
                        break
                    continue
                head = "".join(parts[:k]) + "-"
                out.append(f"{line} {head}" if line else head)
                line = ""
                parts = parts[k:]
            rest = "".join(parts)
            if line:
                out.append(line)
            *full, line = _hard_break(rest, width, font, size)
            out.extend(full)
        out.append(line)
    return out


def fit_size(text: str, width: float, size: float, floor: float = _MIN_FS, font: str = FONT) -> float:
    """The largest type size ≤ `size` at which every WORD (every syllable, where the word has soft
    hyphens) fits the width — a «Polycom» in a narrow Kanal column shrinks a step before it would
    ever be split."""
    units: list[str] = []
    for w in printable(text).replace("\n", " ").split(" "):
        parts = [x for x in w.split(SHY) if x]
        units += [p + "-" for p in parts[:-1]] + parts[-1:]
    while size > floor and any(stringWidth(u, font, size) > width for u in units):
        size -= 0.5
    return max(size, floor)


def _default_height(s: BoardSectionIn) -> int:
    if s.height:
        return s.height
    return {"quad": 11, "map": 11, "text": 3}.get(s.type, max(6, len(s.rows) + 1))


def _units(s: BoardSectionIn) -> float:
    """A section's height in ruled rows: its body plus its bar, column head and subtitle."""
    u = float(_default_height(s))
    if s.title and s.type != "text":
        u += 1
    if s.subtitle:
        u += 1
    if s.type == "table":
        u += 1
    return u


def _grid_rows(page: BoardPageIn) -> list[list[BoardSectionIn]]:
    """Sections laid out row-major over the page's columns; a span-2 section takes a row."""
    cols = max(1, min(2, page.columns))
    rows: list[list[BoardSectionIn]] = []
    cur: list[BoardSectionIn] = []
    for s in page.sections:
        if cols > 1 and s.span >= 2:
            if cur:
                rows.append(cur)
                cur = []
            rows.append([s])
            continue
        cur.append(s)
        if len(cur) == cols:
            rows.append(cur)
            cur = []
    if cur:
        rows.append(cur)
    return rows


@dataclass
class Overflow:
    """Rows a box could not hold: printed as a «Fortsetzung» table after the page."""

    title: str
    columns: list[str]
    rows: list[list[str]] = field(default_factory=list)


def trend_arrow(c, direction: str, x: float, y_mid: float, size: float) -> None:
    """The Entwicklungstendenz as the Handbuch draws it — ➚ worse (red), = unchanged, ➘ easing
    (green) — a vector glyph in a `size` box starting at `x`, centred on `y_mid`."""
    c.saveState()
    c.setLineWidth(max(0.8, size / 7))
    color = {"up": colors.HexColor("#c62828"), "down": colors.HexColor("#2e7d32")}.get(direction, RULE)
    c.setStrokeColor(color)
    c.setFillColor(color)
    h = size / 2
    if direction == "same":
        c.line(x, y_mid + h * 0.35, x + size, y_mid + h * 0.35)
        c.line(x, y_mid - h * 0.35, x + size, y_mid - h * 0.35)
    elif direction in ("up", "down"):
        sign = 1 if direction == "up" else -1
        x0, y0 = x, y_mid - sign * h
        x1, y1 = x + size, y_mid + sign * h
        c.line(x0, y0, x1, y1)
        # the head: two short strokes back from the tip
        c.line(x1, y1, x1 - size * 0.45, y1)
        c.line(x1, y1, x1, y1 - sign * size * 0.45)
    c.restoreState()


def draw_signature(c, key: str, x: float, y: float, size: float) -> None:
    """The Abspracherapport's Signaturen — the SAME shapes as components/BoardSignature.tsx, in a
    48-unit box whose origin is the top-left (SVG) — `x, y` is the box's bottom-left corner."""
    u = size / 48.0

    def pt(px: float, py: float) -> tuple[float, float]:
        return x + px * u, y + (48 - py) * u

    def line(x1, y1, x2, y2):
        a, b = pt(x1, y1), pt(x2, y2)
        c.line(a[0], a[1], b[0], b[1])

    def rect(rx, ry, rw, rh):
        a = pt(rx, ry + rh)
        c.rect(a[0], a[1], rw * u, rh * u, stroke=1, fill=0)

    c.saveState()
    c.setStrokeColor(SIG)
    c.setFillColor(SIG)
    c.setLineWidth(max(0.6, 2 * u))
    if key in ("patientensammelstelle", "sanitaetshilfsstelle", "sammelstelle-unverletzte"):
        rect(12, 8, 24, 32)
        if key != "sammelstelle-unverletzte":
            line(24, 8, 24, 40)
        if key == "patientensammelstelle":
            line(12, 24, 36, 24)
        else:
            line(12, 18.7, 36, 18.7)
            line(12, 29.3, 36, 29.3)
    elif key == "rettungsachse":
        for a, b in ((1, 5), (13, 17), (21, 25), (33, 37)):
            line(a, 24, b, 24)
        p = c.beginPath()
        p.moveTo(*pt(40, 20.5))
        p.lineTo(*pt(46, 24))
        p.lineTo(*pt(40, 27.5))
        p.close()
        c.drawPath(p, stroke=0, fill=1)
        c.setFont(BOLD, 10 * u)
        for rx in (9.0, 29.0):
            px, py = pt(rx, 27.5)
            c.drawCentredString(px, py, "R")
    elif key == "standort-einsatzleitung":
        line(20, 4, 20, 34)
        line(20, 4, 29, 4)
        line(20, 10, 27, 10)
        line(20, 16, 29, 16)
        cx, cy = pt(20, 39)
        c.circle(cx, cy, 5 * u, stroke=1, fill=0)
    elif key == "warteraum":
        rect(12, 12, 24, 24)
        c.setFont(BOLD, 16 * u)
        px, py = pt(24, 30.5)
        c.drawCentredString(px, py, "W")
    elif key == "wasserbezug":
        cx, cy = pt(24, 24)
        c.circle(cx, cy, 11 * u, stroke=1, fill=0)
        line(24, 13, 24, 35)
        line(35, 24, 43, 24)
    elif key == "absperrung":
        line(2, 24, 46, 24)
        for a, b in ((10, 16), (32, 38)):
            line(a, 19, b, 29)
            line(b, 19, a, 29)
    c.restoreState()


class BoardPageFlowable(Flowable):
    """One Tafel page, filling the frame it is laid into (one sheet)."""

    def __init__(
        self, page: BoardPageIn, map_png: bytes | None, caption: str = "", map_caption: str = "", done_label: str = ""
    ):
        super().__init__()
        self.page = page
        self.map_png = map_png
        self.caption = caption
        self.map_caption = map_caption
        self.done_label = done_label
        self.overflow: list[Overflow] = []
        #: the sheet's standard ruling height, set when it is drawn (every table rules at it)
        self._ruling: float = 0.0
        self._w = self._h = 0.0

    def wrap(self, availWidth, availHeight):  # noqa: N803 — ReportLab API
        self._w, self._h = availWidth, availHeight - 1
        return self._w, self._h

    # -- drawing helpers -----------------------------------------------------------------------

    def _text(
        self,
        x: float,
        y_top: float,
        w: float,
        h: float,
        text: str,
        size: float = _FS,
        font: str = FONT,
        pad: float = 1.6 * mm,
    ) -> int:
        """Text wrapped into a box from its top; returns how many lines did NOT fit (0 = all)."""
        c = self.canv
        lead = size * 1.18
        lines = wrap(text, w - 2 * pad, font, size)
        room = max(0, int((h - pad) // lead))
        c.setFont(font, size)
        c.setFillColor(RULE)
        for i, ln in enumerate(lines[:room]):
            c.drawString(x + pad, y_top - pad - size * 0.82 - i * lead, ln)
        return max(0, len(lines) - room)

    def _box(self, x: float, y: float, w: float, h: float, s: BoardSectionIn) -> tuple[float, float, float, float]:
        """The frame and the grey bar; hands back the body rect (x, y, w, h)."""
        c = self.canv
        c.setStrokeColor(RULE)
        c.setLineWidth(0.8)
        top = y + h
        if s.type != "text":
            c.rect(x, y, w, h, stroke=1, fill=0)
        if s.title and s.type != "text":
            c.setFillColor(BAR)
            c.rect(x, top - _BAR_H, w, _BAR_H, stroke=1, fill=1)
            c.setFillColor(colors.white)
            c.setFont(BOLD, 10.5)
            c.drawString(x + 2.2 * mm, top - _BAR_H + 2.3 * mm, printable(s.title))
            top -= _BAR_H
        if s.subtitle:
            sub_h = _BAR_H * 0.82
            c.setLineWidth(0.5)
            c.line(x, top - sub_h, x + w, top - sub_h)
            c.setFillColor(RULE)
            c.setFont(FONT, 9)
            c.drawString(x + 1.8 * mm, top - sub_h + 2 * mm, printable(s.subtitle))
            top -= sub_h
        return x, y, w, top - y

    def _quad(self, bx, by, bw, bh, s: BoardSectionIn) -> None:
        c = self.canv
        n = max(1, len(s.cells))
        ncols = 2 if n > 2 else 1
        nrows = (n + ncols - 1) // ncols
        cw, ch = bw / ncols, bh / nrows
        c.setLineWidth(0.5)
        c.setStrokeColor(RULE)
        for i in range(1, ncols):
            c.line(bx + i * cw, by, bx + i * cw, by + bh)
        for j in range(1, nrows):
            c.line(bx, by + j * ch, bx + bw, by + j * ch)
        for k, cell in enumerate(s.cells):
            cx, cy_top = bx + (k % ncols) * cw, by + bh - (k // ncols) * ch
            c.setFont(FONT, 9)
            c.setFillColor(RULE)
            c.drawString(cx + 1.8 * mm, cy_top - 4.6 * mm, printable(cell.label))
            if not cell.lines:
                continue
            arrow_w = 4.2 * mm if any(ln.dir for ln in cell.lines) else 0.0
            text_w = cw - 3.6 * mm - arrow_w

            def line_text(ln: BoardLineIn) -> str:
                return f"{ln.text} ({ln.tag})" if ln.tag else ln.text

            size = _FS
            while True:
                # measure first, draw once
                n_lines = sum(len(wrap(line_text(ln), text_w, FONT, size)) for ln in cell.lines)
                room = int((ch - 7 * mm) // (size * 1.18))
                if n_lines <= room or size <= _MIN_FS:
                    break
                size -= 0.5
            lead = size * 1.18
            y = cy_top - 5.4 * mm - 1.6 * mm - size * 0.82
            floor = cy_top - ch + 1.2 * mm
            c.setFont(FONT, size)
            cut = False
            for ln in cell.lines:
                parts = wrap(line_text(ln), text_w, FONT, size)
                if y - (len(parts) - 1) * lead < floor:
                    cut = True
                    break
                if ln.dir:
                    trend_arrow(c, ln.dir, cx + 1.8 * mm, y + size * 0.3, 3.2 * mm)
                c.setFillColor(RULE)
                c.setFont(FONT, size)
                for j, part in enumerate(parts):
                    c.drawString(cx + 1.8 * mm + arrow_w, y - j * lead, part)
                y -= len(parts) * lead
            if cut:
                self.overflow.append(
                    Overflow(
                        f"{s.title} · {cell.label}",
                        [cell.label, ""] if arrow_w else [cell.label],
                        [[ln.text, ln.trend] if arrow_w else [ln.text] for ln in cell.lines],
                    )
                )

    def _map(self, bx, by, bw, bh) -> None:
        c = self.canv
        if not self.map_png:
            return
        try:
            img = ImageReader(io.BytesIO(self.map_png))
            iw, ih = img.getSize()
        except Exception:  # noqa: BLE001 — a broken render leaves the box to sketch in
            logger.warning("report: the Tafel's map render could not be decoded; its box stays empty", exc_info=True)
            return
        # cover the box (the render is framed on the Lage with room around it), clipped to it
        k = max(bw / iw, bh / ih)
        dw, dh = iw * k, ih * k
        c.saveState()
        p = c.beginPath()
        p.rect(bx + 0.4, by + 0.4, bw - 0.8, bh - 0.8)
        c.clipPath(p, stroke=0, fill=0)
        c.drawImage(img, bx + (bw - dw) / 2, by + (bh - dh) / 2, dw, dh)
        c.restoreState()
        if self.map_caption:
            c.setFont(FONT, 6.5)
            tw = stringWidth(printable(self.map_caption), FONT, 6.5)
            c.setFillColor(colors.white)
            c.rect(bx + 1 * mm, by + 1 * mm, tw + 2 * mm, 3.6 * mm, stroke=0, fill=1)
            c.setFillColor(RULE)
            c.drawString(bx + 2 * mm, by + 2 * mm, printable(self.map_caption))

    def _table(self, bx, by, bw, bh, s: BoardSectionIn) -> None:
        c = self.canv
        cols = s.columns
        extra = 7 * mm if s.done else 0
        total_w = sum(max(0.1, col.w) for col in cols) or 1
        widths = [(bw - extra) * max(0.1, col.w) / total_w for col in cols]
        if s.done:
            widths.append(extra)
        xs = [bx]
        for wd in widths:
            xs.append(xs[-1] + wd)
        # the column heads — on as many lines as the longest needs (up to three), each line whole:
        # «Entwicklungs-/tendenz ➚ = ➘», never «…tendenz ➚ =» with the «➘» cut off (owner,
        # 10.10. evening: the symbol group is kept together by its no-break spaces)
        heads = []
        for i, col in enumerate(cols):
            fs = fit_size(col.label, widths[i] - 2.4 * mm, 9, 6.5) if col.label else 9.0
            heads.append((fs, wrap(col.label, widths[i] - 2.4 * mm, FONT, fs)[:3] if col.label else []))
        lead = max([fs * 1.15 for fs, _ in heads] or [9 * 1.15])
        n_head = max([len(ls) for _, ls in heads] or [1])
        head_h = max(_BAR_H * 0.82, n_head * lead + 2.6 * mm)
        c.setLineWidth(0.5)
        c.setStrokeColor(RULE)
        top = by + bh
        c.line(bx, top - head_h, bx + bw, top - head_h)
        for i, (fs, head_lines) in enumerate(heads):
            c.setFont(FONT, fs)
            c.setFillColor(RULE)
            for j, line in enumerate(head_lines):
                # bottom-aligned, as the one-line heads always stood
                c.drawString(xs[i] + 1.2 * mm, top - head_h + 2 * mm + (len(head_lines) - 1 - j) * lead, line)
        body_top = top - head_h
        body_h = body_top - by
        n = len(s.rows)
        # ⚠️ every ruling is the page's STANDARD height (owner: «just keep things fixed») — never a
        # box's height shared out over its rows: a table beside a taller neighbour gets more
        # rulings of that height, and what is left under the last whole one stays plain paper.
        # A long cell gets the lines it needs, the type shrinking until it all fits; a
        # pre-printed row stands two rulings tall (the poster's Absprachepunkte, the Traktanden)
        # unless the rows written under it would then not fit — what was written beats the look.
        base = self._ruling or body_h / max(1, _default_height(s))
        for tall in (True, False):
            weight = [2 if r.fixed and tall else 1 for r in s.rows]
            size = _FS
            while True:
                need = []
                for r, wgt in zip(s.rows, weight, strict=False):
                    lines = 1
                    for i, col in enumerate(cols):
                        if col.kind in ("symbol", "index"):
                            continue
                        v = r.cells[i] if i < len(r.cells) else ""
                        if v:
                            cw = widths[i] - 2.4 * mm
                            fs = fit_size(v, cw, 9, 7) if r.fixed else fit_size(v, cw, size)
                            lines = max(lines, len(wrap(v, cw, FONT, fs)))
                    need.append(max(base * wgt, lines * size * 1.18 + 2.2 * mm))
                used = sum(need)
                if used <= body_h + 0.5 or size <= _MIN_FS:
                    break
                size -= 0.5
            if used <= body_h + 0.5:
                break
        # draw what fits; the rest goes to the Fortsetzung
        y = body_top
        drawn = 0
        for r, h in zip(s.rows, need, strict=False):
            if y - h < by - 0.5:
                break
            self._row(xs, widths, cols, r, y, h, size, s.done)
            y -= h
            c.setLineWidth(0.5)
            c.setStrokeColor(RULE)
            c.line(bx, y, bx + bw, y)
            drawn += 1
        # the ruled empty rows below, so the paper can still be filled by hand: as many whole
        # rulings as the rest of the box holds — a list that adds rows only (a fixed list has
        # none to add); a sliver under the last one stays plain, and the columns stop there
        k = int((y - by + 0.5) // base) if s.adds else 0
        for j in range(1, k + 1):
            yy = y - j * base
            if yy > by + 0.5:
                c.line(bx, yy, bx + bw, yy)
        foot = y - k * base
        foot = by if foot - by < 0.5 else foot
        for xv in xs[1:-1]:
            c.line(xv, foot, xv, top)
        if drawn < n:
            self.overflow.append(
                Overflow(
                    s.title or self.page.title,
                    [col.label for col in cols],
                    [r.cells for r in s.rows[drawn:]],
                )
            )

    def _row(self, xs, widths, cols, r: BoardRowIn, y_top: float, h: float, size: float, done: bool) -> None:
        c = self.canv
        for i, col in enumerate(cols):
            v = r.cells[i] if i < len(r.cells) else ""
            x, w = xs[i], widths[i]
            if col.kind == "symbol":
                side = min(h - 1.6 * mm, w - 2 * mm, 12 * mm)
                if side > 2 * mm:
                    draw_signature(c, v, x + (w - side) / 2, y_top - h + (h - side) / 2, side)
                continue
            if col.kind == "index":
                if not v:
                    continue
                rad = min(h, w) * 0.28
                c.setFillColor(SIG)
                c.circle(x + w / 2, y_top - h / 2, rad, stroke=0, fill=1)
                c.setFillColor(colors.white)
                c.setFont(BOLD, rad * 1.2)
                c.drawCentredString(x + w / 2, y_top - h / 2 - rad * 0.42, printable(v))
                continue
            font = FONT
            if r.fixed:
                # pre-printed text sits in the middle of its (taller) row, as on the poster
                fs = fit_size(v, w - 2.4 * mm, 9, 7)
                lines = wrap(v, w - 2.4 * mm, font, fs)
                lead = fs * 1.18
                y0 = y_top - (h - len(lines) * lead) / 2 - fs * 0.82
                c.setFont(font, fs)
                c.setFillColor(RULE)
                for k, ln in enumerate(lines):
                    c.drawString(x + 1.6 * mm, y0 - k * lead, ln)
                continue
            self._text(x, y_top, w, h, v, fit_size(v, w - 2.4 * mm, size), font, pad=1.2 * mm)
        if done:
            x, w = xs[-2], widths[-1]
            s = 3.6 * mm
            c.setLineWidth(0.6)
            c.rect(x + (w - s) / 2, y_top - h / 2 - s / 2, s, s, stroke=1, fill=0)
            if r.done:
                c.setFont(BOLD, 9)
                c.drawCentredString(x + w / 2, y_top - h / 2 - 1.1 * mm, "X")

    def _textsec(self, bx, by, bw, bh, s: BoardSectionIn) -> None:
        c = self.canv
        fields = s.fields or [BoardFieldIn()]

        def one(x, y, w, h, f: BoardFieldIn, label: str):
            if f.tone in TONE:
                c.setFillColor(TONE[f.tone])
                c.rect(x, y, w, h, stroke=0, fill=1)
            c.setStrokeColor(RULE)
            c.setLineWidth(0.8)
            c.rect(x, y, w, h, stroke=1, fill=0)
            top = y + h
            if label:
                c.setFillColor(RULE)
                c.setFont(BOLD, 9)
                c.drawString(x + 2 * mm, top - 4.6 * mm, printable(label if label in ("+", "–", "-") else f"{label}:"))
                top -= 5.4 * mm
            if f.value:
                self._text(x, top, w, top - y, f.value, _FS, FONT, pad=2 * mm)

        if s.layout == "split" and len(fields) > 1:
            main_h = bh * 0.68
            one(bx, by + bh - main_h, bw, main_h, fields[0], fields[0].label or s.title)
            rest = fields[1:]
            w = bw / len(rest)
            for i, f in enumerate(rest):
                one(bx + i * w, by, w, bh - main_h, f, f.label)
        elif s.layout == "row" and len(fields) > 1:
            gap = 4 * mm
            w = (bw - gap * (len(fields) - 1)) / len(fields)
            for i, f in enumerate(fields):
                one(bx + i * (w + gap), by, w, bh, f, f.label or (s.title if i == 0 else ""))
        else:
            h = bh / len(fields)
            for i, f in enumerate(fields):
                one(bx, by + bh - (i + 1) * h, bw, h, f, f.label or (s.title if i == 0 else ""))

    # -- the page ------------------------------------------------------------------------------

    def draw(self):
        c = self.canv
        p = self.page
        pw, ph = self._w, self._h
        # title, as large as the poster's
        c.setFillColor(RULE)
        c.setFont(BOLD, 24)
        title = printable(p.title)
        c.drawString(0, ph - 10 * mm, title)
        if self.caption:
            c.setFont(FONT, 7.5)
            c.setFillColor(DIM)
            c.drawRightString(pw, ph - 9.5 * mm, printable(self.caption))
        top = ph - _TITLE_H
        if any(h.value.strip() for h in p.head):
            c.setFont(FONT, 9)
            c.setFillColor(RULE)
            bits = [f"{h.label}: {h.value}" for h in p.head if h.value.strip()]
            c.drawString(0, top + 2 * mm, printable("   ·   ".join(bits)))
            top -= 6 * mm
        # footer: where the page comes from on the left, its timeline on the right
        c.setStrokeColor(RULE)
        c.setLineWidth(0.6)
        c.line(0, _FOOT_H - 1 * mm, pw, _FOOT_H - 1 * mm)
        src_w = pw
        if p.stamp:
            c.setFont(FONT, 6.5)
            c.setFillColor(RULE)
            c.drawRightString(pw, _FOOT_H - 4.5 * mm, printable(p.stamp))
            src_w -= stringWidth(printable(p.stamp), FONT, 6.5) + 6 * mm
        if p.source:
            # a long source (the FKS file names the poster and the Handbuch's sheets) never runs
            # off the paper or into the timeline: smaller first, then a second line
            fs = 6.5
            while fs > 5.5 and stringWidth(printable(p.source), FONT, fs) > src_w:
                fs -= 0.5
            c.setFont(FONT, fs)
            c.setFillColor(RULE)
            for j, part in enumerate(wrap(p.source, src_w, FONT, fs)[:2]):
                c.drawString(0, _FOOT_H - 4.5 * mm - j * fs * 1.15, part)
        rows = _grid_rows(p)
        if not rows:
            return
        avail = top - _FOOT_H - 3 * mm - _GAP_Y * (len(rows) - 1)
        weights = [max(_units(s) for s in r) for r in rows]
        unit = avail / sum(weights)
        # the one ruling height of this sheet: every table rules its rows at it
        self._ruling = unit
        cols = max(1, min(2, p.columns))
        y = top
        for r, wgt in zip(rows, weights, strict=False):
            h = wgt * unit
            y -= h
            span_w = (pw - _GAP_X * (cols - 1)) / cols
            for i, s in enumerate(r):
                full = len(r) == 1 and (s.span >= 2 or cols == 1)
                x = 0 if full else i * (span_w + _GAP_X)
                w = pw if full else span_w
                bx, by, bw, bh = self._box(x, y, w, h, s)
                if s.type == "quad":
                    self._quad(bx, by, bw, bh, s)
                elif s.type == "map":
                    self._map(bx, by, bw, bh)
                elif s.type == "table":
                    self._table(bx, by, bw, bh, s)
                elif s.type == "text":
                    self._textsec(bx, by, bw, bh, s)
            y -= _GAP_Y


def page_has_map(page: BoardPageIn) -> bool:
    return any(s.type == "map" for s in page.sections)


class Continuation(Flowable):
    """What the page before could not hold, as plain tables that FLOW over as many pages as they
    need (review of #338: a shrink-to-fit block made row 24 of 80 microscopic and dropped the rest
    of 350). Laid out only once that page has been DRAWN — Platypus wraps a flowable right before
    it draws it, in story order — so it knows exactly which rows were left over.

    It asks for more room than any frame has, so the frame hands it to `split`, which answers with
    the tables themselves; those split page by page like any table. The sheet before fills its
    frame, so they start on a fresh page. Nothing at all when everything fitted."""

    def __init__(self, page: BoardPageFlowable, make_tables):
        super().__init__()
        self.page = page
        self.make_tables = make_tables

    def wrap(self, availWidth, availHeight):  # noqa: N803 — ReportLab API
        if not self.page.overflow:
            return 0, 0
        return availWidth, availHeight + 1

    def split(self, availWidth, availHeight):  # noqa: N803 — ReportLab API
        # in the sliver the sheet left: nothing here — the frame then moves on to a fresh page and
        # asks again, which is where the tables start
        if not self.page.overflow or availHeight < 60 * mm:
            return []
        # a zero-height first piece: Platypus places the FIRST piece of a split as it is (no
        # further split), so a table that is taller than the page must not be it — after the
        # spacer the tables flow, and split, like any table in the story
        from reportlab.platypus import Spacer

        return [Spacer(0, 0), *self.make_tables(self.page.overflow, availWidth)]

    def draw(self):
        return
