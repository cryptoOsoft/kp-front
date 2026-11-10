"""The Rapport's «Messungen» section — a Messpunkt's gas readings on paper.

Owner pick 1B (10.11.2026): one block per Messpunkt — a head row with the point, its Geschoss,
how often it was measured and the LAST reading, then its history. Rules for this area:
docs/rapport.md › Messungen.
"""

from __future__ import annotations

from typing import TYPE_CHECKING

from reportlab.lib import colors
from reportlab.lib.enums import TA_RIGHT
from reportlab.lib.styles import ParagraphStyle
from reportlab.lib.units import mm
from reportlab.platypus import Paragraph, Table, TableStyle

from .labels import L
from .styles import _URGENT, _esc, _esc_sub, _table_style

if TYPE_CHECKING:
    from collections.abc import Callable

    from .schema import MessungPointIn, MessungRowIn

#: A1 on paper: dark enough to read as text, and never the only thing that says «Voralarm»
_AMBER = "#8a5a00"
_HEAD_BG = colors.HexColor("#f6f8fb")


def stage_word(stage: str) -> str:
    """The Stufe in words — '' for a calm value. What a monochrome print reads."""
    return {
        "a1": L["stageA1"],
        "a2": L["stageA2"],
        "over": L["stageOver"],
        "unreadable": L["stageUnreadable"],
    }.get(stage, "")


def _stage_markup(stage: str) -> str:
    """The word, bold, behind a filled (A2) or open (A1) square, in the stage's colour. The square
    and the colour only repeat the word: printed black-and-white the cell still says it."""
    word = stage_word(stage)
    if not word:
        return ""
    alarm = stage in ("a2", "over")
    mark = "n" if alarm else "o"  # ZapfDingbats: ■ / ❏
    return (
        f'<font color="{_URGENT if alarm else _AMBER}">'
        f'<font name="ZapfDingbats" size="7">{mark}</font> <b>{_esc(word)}</b></font>'
    )


def _reading_text(r: MessungRowIn) -> str:
    """«19:04 · CO 0 ppm · A2 Hauptalarm» — one reading as a phrase, for the head row."""
    return " · ".join(
        p for p in (_esc(r.time), f"{_esc_sub(r.gas)} {_esc_sub(r.value)}", _esc(stage_word(r.stage))) if p
    )


def _messungen_story(
    points: list[MessungPointIn],
    limits: str | None,
    inner_w: float,
    head: Callable[[str], list],
    st: dict[str, ParagraphStyle],
) -> list:
    """The section's flowables; empty when no point has a reading — then nothing prints, not
    even the heading."""
    points = [p for p in points if p.rows]
    if not points:
        return []
    right = ParagraphStyle("rp_cell_right", parent=st["cell"], alignment=TA_RIGHT)
    time_w, gas_w, value_w = 16 * mm, 14 * mm, 30 * mm
    rest_w = inner_w - time_w - gas_w - value_w
    data: list[list] = [
        [
            Paragraph(_esc(L["colTime"]), st["cellhead"]),
            Paragraph(_esc(L["colGas"]), st["cellhead"]),
            Paragraph(
                _esc(L["colWert"]), ParagraphStyle("rp_cellhead_right", parent=st["cellhead"], alignment=TA_RIGHT)
            ),
            Paragraph(_esc(L["colStufe"]), st["cellhead"]),
        ]
    ]
    style = _table_style()
    for p in points:
        count = L["messungOne"] if len(p.rows) == 1 else L["messungMany"].format(n=len(p.rows))
        who = " · ".join(x for x in (f"<b>{_esc(p.name)}</b>", _esc(p.place), _esc(count)) if x)
        last = f"<b>{L['messungLast'].format(t=_reading_text(p.rows[-1]))}</b>"
        # the head row: the point at the left, its LAST reading at the right edge — the value the
        # building was handed over with is the first thing a reader finds
        inner = Table(
            [[Paragraph(who, st["cell"]), Paragraph(last, right)]],
            colWidths=[(inner_w - 10) * 0.42, (inner_w - 10) * 0.58],
        )
        inner.setStyle(
            TableStyle(
                [
                    ("VALIGN", (0, 0), (-1, -1), "TOP"),
                    ("LEFTPADDING", (0, 0), (-1, -1), 0),
                    ("RIGHTPADDING", (0, 0), (-1, -1), 0),
                    ("TOPPADDING", (0, 0), (-1, -1), 0),
                    ("BOTTOMPADDING", (0, 0), (-1, -1), 0),
                ]
            )
        )
        row = len(data)
        data.append([inner, "", "", ""])
        style.add("SPAN", (0, row), (-1, row))
        style.add("BACKGROUND", (0, row), (-1, row), _HEAD_BG)
        # a head row never stands alone at the foot of a page
        style.add("NOSPLIT", (0, row), (-1, row + 1))
        for i, r in enumerate(p.rows):
            newest = i == len(p.rows) - 1
            b = (lambda s: f"<b>{s}</b>") if newest else (lambda s: s)
            mark = _stage_markup(r.stage)
            # the other gases of the same radio report: beside the Stufe, muted
            others = f'<font color="#5b6573">{_esc_sub(r.others)}</font>' if r.others else ""
            tail = " · ".join(x for x in (mark, others) if x) or "–"
            data.append(
                [
                    Paragraph(b(_esc(r.time)), st["cell"]),
                    Paragraph(b(_esc_sub(r.gas)), st["cell"]),
                    Paragraph(b(_esc_sub(r.value)), right),
                    Paragraph(tail, st["cell"]),
                ]
            )
    tbl = Table(data, colWidths=[time_w, gas_w, value_w, rest_w], repeatRows=1)
    tbl.setStyle(style)
    story: list = [*head(L["messungen"])]
    if limits:
        story.append(Paragraph(_esc_sub(L["messungenLimits"].format(limits=limits)), st["muted"]))
    story.append(tbl)
    return story
