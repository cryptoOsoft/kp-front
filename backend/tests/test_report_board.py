"""The Tafel's pages in the Rapport (10.10.2026, app/report_board): every board-template page
prints as its paper, nothing written is cut off, and an older client prints what it always did."""

from __future__ import annotations

import io
from itertools import pairwise

import pypdfium2 as pdfium
import pytest
from reportlab.lib.units import mm
from reportlab.pdfbase.pdfmetrics import stringWidth

from app.report import ReportPayload, compose_report_pdf
from app.report_board import fit_size, wrap

SHY = "­"


def _ef(massnahmen_rows: int = 2) -> dict:
    """The Erste Führung as the client resolves it (lib/boardForm · formForPdf), abridged."""
    return {
        "title": "Erste Führung",
        "source": "FKS Plakat «Erste Führung» A3 V 1.0/10.09.2019",
        "columns": 2,
        "sections": [
            {
                "id": "problem",
                "type": "quad",
                "title": "Problemerfassung",
                "height": 11,
                "cells": [
                    {"label": "Front", "lines": [{"text": "Rettungen Haus 19"}, {"text": "Brand Haus 21"}]},
                    {"label": "Ordnung", "lines": [{"text": "R-Achse"}]},
                    {"label": "Sanität", "lines": [{"text": "> 5 Patienten"}]},
                    {"label": "Spezialprobleme", "lines": []},
                ],
            },
            {"id": "lagekarte", "type": "map", "title": "Lagekarte", "height": 11},
            {
                "id": "massnahmen",
                "type": "table",
                "title": "Massnahmen",
                "height": 11,
                "columns": [
                    {"label": "Was/Wo", "w": 4.2},
                    {"label": "Wer", "w": 1.75},
                    {"label": "Wann", "kind": "time"},
                ],
                "rows": [{"cells": [f"Massnahme {i + 1}", "TLF 1", "17:42"]} for i in range(massnahmen_rows)],
            },
            {
                "id": "absprachen",
                "type": "table",
                "title": "Abspracherapport",
                "subtitle": "Feuerwehr – Polizei – Rettungsdienst",
                "height": 12,
                "adds": False,
                "columns": [
                    {"label": "Signatur", "kind": "symbol", "w": 1.55},
                    {"label": "Bezeichnung", "w": 1.5},
                    {"label": "Ort", "w": 2.4},
                ],
                "rows": [
                    {"fixed": True, "cells": ["patientensammelstelle", f"Patienten{SHY}sammelstelle", ""]},
                    {"fixed": True, "cells": ["warteraum", "Warteraum", "Parkplatz Coop"]},
                ],
            },
        ],
    }


def _text(pdf: bytes) -> str:
    doc = pdfium.PdfDocument(io.BytesIO(pdf))
    return "\n".join(doc[i].get_textpage().get_text_range() for i in range(len(doc)))


def _compose(**extra) -> bytes:
    payload = ReportPayload.model_validate(
        {"incident": {"title": "Brand Schlossgasse", "id": "x"}, "generatedAt": "10.10.2026 18:05", **extra}
    )
    return compose_report_pdf(payload, {})


def test_the_erste_fuehrung_prints_as_its_poster():
    text = _text(_compose(boardPages=[_ef()]))
    for word in (
        "Erste Führung",
        "Problemerfassung",
        "Lagekarte",
        "Rettungen Haus 19",
        "Feuerwehr – Polizei – Rettungsdienst",
        "Parkplatz Coop",
        "Massnahme 2",
    ):
        assert word in text, word
    # the poster's own split, from the template's soft hyphen (pdfium reads a line-end hyphen
    # back as U+FFFE)
    assert ("Patienten-" in text or "Patienten\ufffe" in text) and "sammelstelle" in text
    assert "FKS Plakat" in text  # where the page comes from, in its footer


def _glyph_height(pdf: bytes, needle: str) -> float:
    """The printed height (pt) of the first character of `needle`, wherever it lands."""
    doc = pdfium.PdfDocument(io.BytesIO(pdf))
    for i in range(len(doc)):
        tp = doc[i].get_textpage()
        found = tp.search(needle, match_whole_word=True).get_next()
        if found:
            left, bottom, right, top = tp.get_charbox(found[0], loose=False)
            return top - bottom
    raise AssertionError(f"{needle!r} is not on the paper")


@pytest.mark.parametrize("rows", [80, 350])
def test_nothing_written_is_cut_off_or_shrunk_away(rows):
    """A box holding more than fits at a legible size continues after the page, at full size and
    over as many pages as it needs — measured on the paper, not read back as text."""
    pdf = _compose(boardPages=[_ef(massnahmen_rows=rows)])
    assert "Fortsetzung: Massnahmen" in _text(pdf)
    # the last row is there, and as legible as the first one on the continuation
    last = _glyph_height(pdf, f"Massnahme {rows}")
    assert last >= 5.0, last
    assert abs(last - _glyph_height(pdf, "Massnahme 40")) < 0.5
    # …which takes pages: ~45 rows a page at that size
    pages = len(pdfium.PdfDocument(io.BytesIO(pdf)))
    assert pages >= 2 + (rows - 20) // 60


def test_an_older_client_prints_what_it_always_did():
    assert "Erste Führung" not in _text(_compose())


def test_the_operator_can_leave_the_tafel_out():
    assert "Problemerfassung" not in _text(_compose(boardPages=[_ef()], options={"tafel": False}))


def test_a_landscape_sheet_and_a_text_page():
    konzept = {
        "title": "Konzept",
        "columns": 2,
        "sections": [
            {
                "id": "auftrag",
                "type": "text",
                "title": "Auftrag",
                "span": 2,
                "height": 3,
                "fields": [{"tone": "shade", "value": "Personen retten, Ausbreitung verhindern"}],
            },
            {
                "id": "v1",
                "type": "text",
                "title": "Variante 1",
                "layout": "split",
                "height": 15,
                "fields": [
                    {"value": "Innenangriff"},
                    {"label": "+", "tone": "plus", "value": "schnell"},
                    {"label": "–", "tone": "minus"},
                ],
            },
            {
                "id": "v2",
                "type": "text",
                "title": "Variante 2",
                "layout": "split",
                "height": 15,
                "fields": [
                    {"value": "Aussenangriff"},
                    {"label": "+", "tone": "plus"},
                    {"label": "–", "tone": "minus", "value": "langsam"},
                ],
            },
        ],
    }
    tendenz = {
        "title": "Problemerfassung",
        "landscape": True,
        "columns": 1,
        "sections": [
            {
                "id": "p",
                "type": "table",
                "height": 10,
                "columns": [{"label": "Problem/Ereignis", "w": 4}, {"label": "Entwicklungstendenz", "kind": "trend"}],
                "rows": [{"cells": ["Brand Zisternenfahrzeug", "wird schlimmer"]}],
            }
        ],
    }
    pdf = _compose(boardPages=[konzept, tendenz])
    text = _text(pdf)
    for word in (
        "Konzept",
        "Personen retten",
        "Innenangriff",
        "langsam",
        "Brand Zisternenfahrzeug",
        "wird schlimmer",
    ):
        assert word in text, word
    doc = pdfium.PdfDocument(io.BytesIO(pdf))
    sizes = [doc[i].get_size() for i in range(len(doc))]
    assert any(w > h for w, h in sizes)  # the 8.1 sheet is landscape, like the Handbuch's


def test_wrapping_splits_where_the_template_says():
    assert wrap(f"Patienten{SHY}sammelstelle", 25 * mm, size=9) == ["Patienten-", "sammelstelle"]
    assert wrap(f"Sanitäts{SHY}hilfsstelle", 60 * mm, size=9) == ["Sanitätshilfsstelle"]  # no hyphen when it fits
    # …nor when the word fits whole on the next line (round 2: «Standort / Einsatz- / leitung»)
    w = stringWidth("Einsatzleitung", "Helvetica", 9) + 2
    assert wrap(f"Standort Einsatz{SHY}leitung", w, size=9) == ["Standort", "Einsatzleitung"]
    assert wrap("Erste Zeile\nzweite", 60 * mm) == ["Erste Zeile", "zweite"]
    # Helvetica has no trend arrows: a label keeps its meaning instead of printing «?»
    assert wrap("Entwicklungstendenz ➚ = ➘", 90 * mm) == ["Entwicklungstendenz (+) = (–)"]
    # a narrow column shrinks the type before it splits a word
    assert fit_size("Polycom", 9 * mm, 8.5) < 8.5


def test_the_tendenz_prints_as_an_arrow_beside_the_problem(monkeypatch):
    """The Erste Führung's Problemerfassung carries the trend (owner, round 2): the paper draws
    ➚ = ➘ as vector arrows — Helvetica has none — in front of the line."""
    import app.report_board as rb

    drawn: list[str] = []
    real = rb.trend_arrow
    monkeypatch.setattr(rb, "trend_arrow", lambda c, d, *a: (drawn.append(d), real(c, d, *a)))
    page = _ef()
    page["sections"][0]["trend"] = True
    page["sections"][0]["cells"][0]["lines"] = [
        {"text": "Rettungen Haus 19", "trend": "wird schlimmer", "dir": "up"},
        {"text": "Rauch", "trend": "gleich", "dir": "same"},
        {"text": "Brand Haus 21"},
    ]
    text = _text(_compose(boardPages=[page]))
    assert drawn == ["up", "same"]
    assert "Rettungen Haus 19" in text and "Rauch" in text


def test_the_header_line_prints_in_the_words_it_was_sent_in():
    page = _ef()
    page["head"] = [{"label": "Intervention", "value": "Feu de cuisine"}, {"label": "Adresse", "value": ""}]
    text = _text(_compose(boardPages=[page]))
    assert "Intervention: Feu de cuisine" in text
    assert "Einsatz:" not in text


def test_rows_written_under_the_absprachepunkte_print_on_the_sheet():
    """Owner round 2: a row typed under the six pre-printed Absprachepunkte is on the poster, not
    in a Fortsetzung — the pre-printed rows give up their double height before a word moves."""
    page = _ef()
    abs_ = page["sections"][3]
    abs_["adds"] = True
    names = [
        ("patientensammelstelle", f"Patienten{SHY}sammelstelle"),
        ("sanitaetshilfsstelle", f"Sanitäts{SHY}hilfsstelle"),
        ("rettungsachse", f"Rettungs{SHY}achse"),
        ("standort-einsatzleitung", f"Standort Einsatz{SHY}leitung"),
        ("sammelstelle-unverletzte", f"Sammel{SHY}stelle Un{SHY}verletzte"),
        ("warteraum", "Warteraum"),
    ]
    abs_["rows"] = [{"fixed": True, "cells": [k, v, ""]} for k, v in names] + [
        {"cells": ["", f"Helikopterlandeplatz {i}", "Sportplatz Bachmatten"]} for i in range(3)
    ]
    text = _text(_compose(boardPages=[page]))
    assert text.count("Helikopterlandeplatz") == 3
    assert "Fortsetzung" not in text


def test_a_long_source_line_stays_on_the_paper():
    page = _ef()
    page["source"] = (
        "FKS Plakat «Erste Führung» A3 V 1.0/10.09.2019; "
        + "FKS Handbuch Führung Grossereignisse, Kap. 8 " * 4
        + "ENDE"
    )
    doc = pdfium.PdfDocument(io.BytesIO(_compose(boardPages=[page])))
    for i in range(len(doc)):
        tp = doc[i].get_textpage()
        at = tp.get_text_range().find("ENDE")
        if at >= 0:
            # the last letter's box, not just the text: a line run off the paper still extracts
            assert tp.get_charbox(at + 3)[2] <= doc[i].get_width()
            return
    raise AssertionError("the source line is missing")


def test_every_ruling_is_the_standard_height_beside_a_taller_neighbour(monkeypatch):
    """Owner: «just keep things fixed». The Massnahmen stand beside the taller Abspracherapport
    (a subtitle, and three rows written under its six): their rulings are the sheet's standard
    height — more of them, never stretched to fill the box — on paper as on screen."""
    from reportlab.pdfgen.canvas import Canvas

    import app.report_board as rb

    lines: dict[str, list[float]] = {}
    seen = {"sec": "", "ruling": 0.0}
    real_line, real_table = Canvas.line, rb.BoardPageFlowable._table

    def line(self, x1, y1, x2, y2):
        if abs(y1 - y2) < 0.01 and seen["sec"]:
            lines.setdefault(seen["sec"], []).append(round(y1, 2))
        return real_line(self, x1, y1, x2, y2)

    def table(self, bx, by, bw, bh, s):
        seen["sec"], seen["ruling"] = s.title, self._ruling
        try:
            return real_table(self, bx, by, bw, bh, s)
        finally:
            seen["sec"] = ""

    monkeypatch.setattr(Canvas, "line", line)
    monkeypatch.setattr(rb.BoardPageFlowable, "_table", table)
    page = _ef()
    absprache = page["sections"][3]
    absprache["adds"] = True
    absprache["rows"] = absprache["rows"] + [{"cells": ["", f"Punkt {i}", "Ort"]} for i in range(3)]
    _compose(boardPages=[page])
    ys = sorted(set(lines["Massnahmen"]), reverse=True)
    gaps = [a - b for a, b in pairwise(ys)][1:]  # the first is the column head
    assert len(gaps) >= 11
    assert all(abs(g - seen["ruling"]) < 0.5 for g in gaps), (seen["ruling"], gaps)


def test_a_cell_longer_than_a_page_prints_and_its_fortsetzung_heading_stays_with_its_table():
    """Re-review of #338: one Massnahme of 600 words made the Tafel print AND the whole Rapport
    500 (a table row taller than a page cannot be placed), and the «Fortsetzung» heading printed
    alone at the foot of a page with its table on the next. Now the row splits across pages and
    the heading is the table's own repeated first row."""
    page = _ef()
    page["sections"][2]["rows"] = [{"cells": [" ".join(f"Wort{i}" for i in range(600)), "TLF", "17:00"]}] + [
        {"cells": [f"M {i}", "TLF", "17:00"]} for i in range(40)
    ]
    doc = pdfium.PdfDocument(io.BytesIO(_compose(boardPages=[page])))
    texts = [doc[i].get_textpage().get_text_range() for i in range(len(doc))]
    joined = "\n".join(texts)
    assert "Wort599" in joined and "M 39" in joined
    for t in texts:
        if "Fortsetzung" in t:
            # never the heading alone: the column heads and a row come with it on the same page
            assert "Was/Wo" in t and ("Wort" in t or "M " in t)


def test_a_verlauf_entry_longer_than_a_page_prints_instead_of_failing_the_rapport():
    """The same mechanism in the Einsatzjournal (pre-existing): a pasted Lagebericht of 3000
    words was a LayoutError for the whole Rapport. The row splits across pages."""
    payload = ReportPayload.model_validate(
        {
            "incident": {"title": "Brand", "id": "x"},
            "generatedAt": "10.10.2026 18:05",
            "journal": [{"timeLabel": "12:00", "area": "Manuell", "text": " ".join(f"lang{i}" for i in range(3000))}],
        }
    )
    text = _text(compose_report_pdf(payload, {}))
    assert "lang2999" in text


def test_a_long_column_head_prints_whole_with_its_symbol_group_together():
    """Owner, 10.10. evening: «Entwicklungstendenz ➚ = ➘» broke with «➘» alone on the next line.
    The label keeps «➚ = ➘» together (no-break spaces) and breaks the word at its soft hyphen; on
    paper the head takes the lines it needs, every one printed."""
    head = f"Entwicklungs{SHY}tendenz ➚ = ➘"
    lines = wrap(head, 30 * mm, size=8)
    assert lines[-1].endswith("(+) = (–)") or lines[-1] == "(+) = (–)"
    assert all("=" not in ln or ("(+)" in ln and "(–)" in ln) for ln in lines)
    page = _ef()
    page["sections"][2]["columns"][1] = {"label": head, "w": 1.0}
    text = _text(_compose(boardPages=[page]))
    assert "tendenz" in text and "(–)" in text


def test_the_page_prints_its_timeline_beside_a_long_source():
    """Owner, 26.10.2026: the paper says when the page was started and last written on — in the
    footer's right corner, where a long source line never runs into it."""
    page = _ef()
    page["source"] = "FKS Handbuch Führung Grossereignisse, Kap. 8 " * 4 + "ENDE"
    page["stamp"] = "Erstellt 26.10.2026, 11:24 · zuletzt bearbeitet 26.10.2026, 14:05"
    doc = pdfium.PdfDocument(io.BytesIO(_compose(boardPages=[page])))
    for i in range(len(doc)):
        tp = doc[i].get_textpage()
        text = tp.get_text_range()
        if page["stamp"] in text:
            # the stamp shares the source's first baseline, so the extracted text interleaves them
            s0 = text.find(page["stamp"])
            stamp = range(s0, s0 + len(page["stamp"]))
            stamp_left = tp.get_charbox(s0)[0]
            source = [
                j
                for j in range(text.find("FKS Handbuch"), text.find("ENDE") + 4)
                if j not in stamp and not text[j].isspace()
            ]
            source_right = max(tp.get_charbox(j)[2] for j in source)
            assert source_right < stamp_left
            return
    raise AssertionError("the timeline is missing")


def test_a_date_row_stands_where_the_wann_column_passes_midnight(monkeypatch):
    """Mitternacht B (owner, 09.11.2026): the client puts the new day before its first entry
    (lib/formDays); on paper it is one grey ruling across the table, never an entry's cells – and
    in the Fortsetzung it is a row of its own too."""
    import app.report_board as rb

    rows: list = []
    real = rb.BoardPageFlowable._row
    monkeypatch.setattr(
        rb.BoardPageFlowable, "_row", lambda self, xs, w, cols, r, *a: (rows.append(r), real(self, xs, w, cols, r, *a))
    )
    page = _ef()
    page["sections"][2]["rows"] = [
        {"cells": ["Sicherheitstrupp bereit", "Trupp Weber", "23:59"]},
        {"sep": "Di., 10.11.2026", "cells": []},
        {"cells": ["Personenrettung 2. OG Nord", "Trupp Schmid", "00:01"]},
    ]
    text = _text(_compose(boardPages=[page]))
    assert "Di., 10.11.2026" in text
    # between the two entries on the sheet (PDF y grows upwards)
    doc = pdfium.PdfDocument(io.BytesIO(_compose(boardPages=[page])))
    tp = next(t for t in (doc[i].get_textpage() for i in range(len(doc))) if "23:59" in t.get_text_range())

    def top(needle: str) -> float:
        found = tp.search(needle).get_next()
        assert found, needle
        return tp.get_charbox(found[0], loose=False)[3]

    assert top("23:59") > top("Di., 10.11.2026") > top("00:01")
    assert all(not r.sep for r in rows)  # drawn as a band, not as an entry
