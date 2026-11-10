"""The Rapport's «Messungen» section (app/report/messungen): a Messpunkt's gas readings on paper.

Composed from the payload alone — no database. The text is read back out of the PDF, so every
assertion is about what a reader finds on the sheet.
"""

import io

import pypdfium2 as pdfium

from app.report import ReportPayload, compose_report_pdf


def _text(payload: dict) -> str:
    doc = pdfium.PdfDocument(io.BytesIO(compose_report_pdf(ReportPayload.model_validate(payload), {})))
    # one line of text: where a cell wraps is layout, not content
    return " ".join("\n".join(doc[i].get_textpage().get_text_range() for i in range(len(doc))).split())


def _payload(**extra) -> dict:
    return {
        "incident": {"id": "x", "title": "Brand Mehrfamilienhaus", "type": "Brand", "address": "Hauptstrasse 1"},
        "generatedAt": "09.11.2026 20:00",
        **extra,
    }


KELLER = {
    "name": "Keller Heizraum",
    "place": "UG",
    "rows": [
        {"time": "18:02", "gas": "CO", "value": "180 ppm", "stage": "a2", "others": "O₂ 20,4 Vol-%"},
        {"time": "18:38", "gas": "CO", "value": "42 ppm", "stage": "a1"},
        {"time": "19:04", "gas": "CO", "value": "0 ppm", "stage": "ok"},
    ],
}


def test_a_point_prints_its_last_reading_on_the_head_row_and_its_history_under_it():
    text = _text(_payload(messungen=[KELLER], messungenLimits="CO A1 ab 30 ppm, A2 ab 60 ppm"))
    assert "Messungen" in text
    assert "Grenzwerte dieses Einsatzes: CO A1 ab 30 ppm, A2 ab 60 ppm." in text
    # the head row: the point, its Geschoss, how often, and the LAST reading
    assert "Keller Heizraum · UG · 3 Messungen" in text
    assert "zuletzt 19:04 · CO 0 ppm" in text
    # the history, oldest first
    assert text.index("18:02") < text.index("18:38") < text.index("42 ppm")
    assert "180 ppm" in text


def test_the_stage_is_a_word_so_a_monochrome_print_still_says_it():
    over = {"name": "Garage", "rows": [{"time": "18:10", "gas": "Ex", "value": ">100 %UEG", "stage": "over"}]}
    odd = {"name": "Gang", "rows": [{"time": "18:12", "gas": "CO", "value": "ca. 60", "stage": "unreadable"}]}
    text = _text(_payload(messungen=[KELLER, over, odd]))
    assert "A2 Hauptalarm" in text
    assert "A1 Voralarm" in text
    assert "über Messbereich (A2 Hauptalarm)" in text
    assert "unlesbar" in text
    # the last reading's stage stands on the head row too
    assert "zuletzt 18:10 · Ex >100 %UEG · über Messbereich (A2 Hauptalarm)" in text
    assert "Garage · 1 Messung" in text


def test_a_subscript_gas_prints_as_text_not_as_a_missing_glyph():
    point = {"name": "Schacht", "rows": [{"time": "18:20", "gas": "O₂", "value": "16 Vol-%", "stage": "a2"}]}
    text = _text(_payload(messungen=[point]))
    assert "₂" not in text and "\ufffe" not in text
    assert "O2 16 Vol-%" in text or "O 2 16 Vol-%" in text


def test_the_legend_under_a_picture_names_a_subscript_gas_without_a_missing_glyph():
    """The numbered legend under the Kroki and under a plan is one table (`_legend_table`); a
    Messpunkt's line there carries its gas. A blank plan page reaches it without map tiles."""
    anno = {"kind": "symbol", "x": 0.5, "y": 0.5, "symbol": "VKF Feuer", "caption": "Schacht · O₂ 16 · H₂S 12"}
    text = _text(_payload(planPages=[{"label": "Gebäude · EG", "blankAspect": 1.0, "annos": [anno]}]))
    assert "Schacht" in text
    assert "₂" not in text and "\ufffe" not in text
    # the subscript is its own text run: where the extractor puts a space around it is layout
    assert "Schacht·O216·H2S12" in text.replace(" ", "")


def test_no_readings_no_section():
    assert "Messungen" not in _text(_payload())
    # a point placed but never measured is not a reading either
    assert "Messungen" not in _text(_payload(messungen=[{"name": "Keller", "place": "UG", "rows": []}]))
