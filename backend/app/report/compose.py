"""The Einsatzrapport's composition: compose_report_pdf and its section builders.

Split out of the former ``report_pdf.py``; rules for this area: docs/rapport.md.
"""

from __future__ import annotations

import io
import logging

from reportlab.lib import colors
from reportlab.lib.pagesizes import A4, landscape
from reportlab.lib.styles import ParagraphStyle
from reportlab.lib.units import mm
from reportlab.platypus import (
    BaseDocTemplate,
    Frame,
    HRFlowable,
    KeepTogether,
    NextPageTemplate,
    PageBreak,
    PageTemplate,
    Paragraph,
    Spacer,
    Table,
    TableStyle,
)

from .auswertung import _auswertung_story
from .kroki_view import _KROKI_PX, _KROKI_PX_PORTRAIT, _kroki_view
from .labels import _LINE_STUB, _WRITE_DASH, L
from .messungen import _messungen_story
from .schema import (
    _PAD_ROW,
    AttachmentIn,
    MittelFormRowIn,
    PartnerContact,
    PersonalRowIn,
    PersonalTimeIn,
    ReportPayload,
    _alarm_ref_text,
    _clip_print,
    _trupp_heading,
)
from .styles import (
    _DERIVED,
    _DIM_INK,
    _LABEL,
    _URGENT,
    _WRITE,
    _collapse_breaks,
    _esc,
    _fit_image,
    _FormRows,
    _legend_height,
    _legend_table,
    _logo_flowable,
    _NumberedCanvas,
    _str_w,
    _styles,
    _table_style,
    _tel_markup,
    safe_markup,
)
from .tafel import _tafel_story

logger = logging.getLogger(__name__)


def compose_report_pdf(
    payload: ReportPayload, figures: dict[str, bytes], plan_pdfs: dict[str, bytes] | None = None
) -> bytes:
    """Compose the full rapport. `figures` carries the uploaded journal photos and the
    server-resolved ones (key `photo:<url>`) plus the logo; `plan_pdfs` maps a planPage url
    to the plan-PDF bytes the API layer loaded from the reference store."""
    st = _styles()
    buf = io.BytesIO()
    plan_pdfs = plan_pdfs or {}

    pw, ph = A4
    lw, lh = landscape(A4)
    margin = 14 * mm
    doc = BaseDocTemplate(
        buf,
        pagesize=A4,
        leftMargin=margin,
        rightMargin=margin,
        topMargin=margin,
        bottomMargin=margin,
        title=f"Einsatzrapport — {payload.incident.title}",
        author="KP Front",
    )
    # leftPadding/rightPadding=0: ReportLab Frames default to 6pt side padding, which paragraphs
    # honour but the full-width tables render flush to the frame edge — so headings/paragraphs sat
    # ~6pt right of the tables. Zero it so every flowable is flush at the doc margin.
    portrait_frame = Frame(margin, margin, pw - 2 * margin, ph - 2 * margin, id="p", leftPadding=0, rightPadding=0)
    land_frame = Frame(margin, margin, lw - 2 * margin, lh - 2 * margin, id="l", leftPadding=0, rightPadding=0)
    doc.addPageTemplates(
        [
            PageTemplate(id="portrait", frames=[portrait_frame], pagesize=A4),
            PageTemplate(id="landscape", frames=[land_frame], pagesize=landscape(A4)),
        ]
    )
    inner_w = pw - 2 * margin
    land_inner_w, land_inner_h = lw - 2 * margin, lh - 2 * margin

    story: list = []
    m, opt = payload.meta, payload.options

    def head(text: str) -> list:
        """Section heading matching the Erfassungsblatt: bold line + solid dark rule.

        ⚠️ It used to reserve 26mm with a CondPageBreak, which cannot be right: the reserve is
        measured BEFORE the heading is laid out, the heading block itself eats 38pt of it, and the
        first content of Personal/Material/Partner is a two-up outer row — one indivisible
        flowable whose height depends on the roster. «Partnerorganisationen» duly printed as the
        last thing on page 1 with every one of its rows on page 2.
        keepWithNext on the heading AND its rule makes ReportLab bundle heading + rule + the next
        flowable into a KeepTogether, so a heading can never be the last thing on a page whatever
        follows it. A block taller than a full frame still splits normally — KeepTogether.split()
        hands the content back unchanged when it does not fit anywhere.
        """
        hr = HRFlowable(
            width="100%",
            thickness=1.1,
            color=colors.HexColor("#282828"),
            spaceBefore=0,
            # 7, not 10: the rule needs a little air under it for the hand that writes against
            # it, but a form that floats reads as unfinished and costs a page.
            spaceAfter=7,
            lineCap="butt",
        )
        hr.keepWithNext = 1
        return [Paragraph(_esc(text), st["h2"]), hr]

    def write_lines(n: int, row_h: float = 8 * mm) -> Table:
        """N dotted write-in lines (the Erfassungsblatt's Notizen look).

        The FIRST row is short by the heading's own `spaceAfter`, so the first rule sits the same
        distance under the heading as the following rules sit under each other. At a full row it
        carried the heading gap AND a whole writing height, which made the block start with a
        visibly wider band than it ever repeats — the section looked like it began with a blank.
        """
        heights = [row_h - 7, *[row_h] * (n - 1)] if n else []
        t = Table([[Paragraph(_LINE_STUB, st["body"])] for _ in range(n)], colWidths=[inner_w], rowHeights=heights)
        t.setStyle(
            TableStyle(
                [
                    ("LINEBELOW", (0, 0), (-1, -1), 0.5, _WRITE, *_WRITE_DASH),
                    ("VALIGN", (0, 0), (-1, -1), "BOTTOM"),
                    ("LEFTPADDING", (0, 0), (-1, -1), 0),
                ]
            )
        )
        return t

    # --- page 1: Haupt-Rapport ------------------------------------------------------------
    # The station's own mark above the title — the rapport leaves the building (Gemeinde,
    # Versicherung, GVB) and should say whose it is before it says what happened. Modest by
    # design: a letterhead, not a banner. Missing, unreadable or SVG-without-a-renderer simply
    # prints nothing — a logo is never worth failing a rapport over.
    # An Übung says so ABOVE the title, before anything else is read. It is the one fact that
    # changes what the whole document is, and it is excluded from the statistics — a drill
    # rapport that reads like a deployment is a record that contradicts the numbers.
    if payload.incident.isExercise:
        story.append(Paragraph(_esc(L["exercise"]), st["exercise"]))
    title = Paragraph(_esc(payload.incident.title), st["title"])
    # ⚠️ NO Einsatz-ID here. It was this app's own incident UUID, shortened for display — it joins
    # nothing in WinFAP, and printing a number-looking thing beside the one that DOES join is how
    # the wrong one gets typed into the case-number field. The Einsatz-Nr is in the details box
    # below, where somebody filling in a form reads.
    footer_bits = [f"{L['generatedAt']}: {payload.generatedAt}"]
    # The join number rides HERE, on the line under the title, rather than in the details box: it
    # is not a fact about the Einsatz the way an address or an Einsatzleiter is — it is the
    # handle this sheet is filed under, which is what the rest of this line already carries.
    if payload.incident.alarmRef:
        footer_bits.append(f"{L['alarmRef']}: {_alarm_ref_text(payload.incident.alarmRef)}")
    if m.erfasser:
        footer_bits.append(f"{L['erfasser']}: {m.erfasser}")
    subtitle = Paragraph(_esc(" · ".join(footer_bits)), st["muted"])

    logo = _logo_flowable(figures.get("logo"))
    if logo is None:
        story.append(title)
        story.append(subtitle)
    else:
        # Mark and title on ONE line, the way a letterhead reads. Stacked, the logo pushed the
        # Einsatz — the thing the sheet is about — a third of the way down the page, and the two
        # read as separate blocks rather than as one heading.
        #
        # The «Erstellt: …» line goes INSIDE the title cell rather than full-width underneath it
        # (09.08.): hung at the page margin it started under the LOGO, so the mark had a caption
        # it does not have and the two blocks stopped lining up. Stacked with the title it is
        # what it is — a subtitle — and the letterhead becomes one block of two lines, which is
        # also what let the mark grow (see _LOGO_H).
        lw = logo.drawWidth + 5 * mm
        head_tbl = Table([[logo, [title, subtitle]]], colWidths=[lw, inner_w - lw])
        head_tbl.setStyle(
            TableStyle(
                [
                    ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
                    ("LEFTPADDING", (0, 0), (-1, -1), 0),
                    ("RIGHTPADDING", (0, 0), (-1, -1), 0),
                    ("TOPPADDING", (0, 0), (-1, -1), 0),
                    ("BOTTOMPADDING", (0, 0), (-1, -1), 0),
                ]
            )
        )
        story.append(head_tbl)
    story.append(Spacer(1, 10))

    # The Details box — same frame + dotted-leader fields as the Erfassungsblatt, with the
    # automatic facts and any recorded human facts printed ON the lines. Missing values stay
    # writable by hand; nothing blocks the print.
    #
    # ⚠️ The two fields that can be answered «Entfällt» print that word instead of an empty
    # write-in rule. «Es gibt keine Kontaktperson» and «das hat niemand ausgefüllt» are two
    # different statements on a sheet that gets signed, and a blank line only ever said the
    # second one — which is exactly what the app's «Entfällt» exists to say (lib/workspace.ts).
    kontaktperson = m.kontaktperson or (L["entfaellt"] if m.kontaktpersonNone else None)
    rueckmeldung = m.rueckmeldungElz or (L["entfaellt"] if m.rueckmeldungNone else None)
    # Name and Telefon share the row (one person, one line) — except under «Entfällt», where a
    # separate empty Telefon rule would read as a second field somebody forgot to fill in.
    kontakt_row = (
        [{"label": L["kontaktperson"], "w": 1.0, "value": kontaktperson}]
        if m.kontaktpersonNone
        else [
            # half/half like every other two-field row, so «Telefon» aligns with the right
            # column («Gerettet», «Einsatzende») instead of floating 10% off it
            {"label": L["kontaktperson"], "w": 0.5, "value": kontaktperson},
            # …and the number is dialable from the PDF: this rapport is read on a phone the
            # morning after, by whoever has to call the owner back
            {"label": L["kontaktpersonTelefon"], "w": 0.5, "value": m.kontaktpersonTelefon, "tel": True},
        ]
    )
    half = 0.5
    story.append(
        _FormRows(
            inner_w,
            [
                [
                    {"label": L["category"], "w": half, "value": payload.incident.type},
                    {"label": L["alarmierung"], "w": half, "value": m.alarmiertAt},
                ],
                [{"label": L["address"], "w": 1.0, "value": payload.incident.address}],
                [
                    {"label": L["ausgerueckt"], "w": half, "value": m.ausgeruecktAt},
                    {"label": L["incidentEnd"], "w": half, "value": m.endedAt},
                ],
                [
                    {"label": L["einsatzleiter"], "w": half, "value": m.einsatzleiter},
                    {"label": L["gerettete"], "w": half, "value": m.gerettete},
                ],
                kontakt_row,
                [{"label": L["rueckmeldungElz"], "w": 1.0, "value": rueckmeldung}],
            ],
            boxed=True,
        )
    )
    story.append(Spacer(1, 2))

    # Kurzbericht — the form's central human field: printed text or dotted write lines
    story.extend(head(L["summary"]))
    if m.summary:
        story.append(Paragraph(_esc(m.summary), st["body"]))
    else:
        story.append(write_lines(4))

    # Alarmierungs-/Ausrückzeiten: always printed when the deployment configures groups or
    # vehicles — recorded times as times, the rest as `__:__` for the pen. Empty only when
    # the config declares neither.
    if m.zeiten:
        story.extend(head(L["zeiten"]))
        # ⚠️ An unrecorded time is a dotted RULE, like every other write-in field on the sheet.
        # It was «__:__» — the sheet's second «write here» texture, and the two sat a few
        # centimetres apart: the Zeiten grid in underscores, the roster clocks right below it in
        # dotted leaders. Underscores also never line up with the digits of a filled row, since
        # Helvetica's «_» is narrower than its figures, so a column of half-filled times came out
        # ragged. One texture; see the roster and the Material amounts.
        # ⚠️ VALUE first, then its label. The grid is 3-up, so with the label first each rule
        # ended up sitting BETWEEN its own label and the next column's — «Gr. 1 (Rot) ____
        # Tagespikett» reads as if the line belonged to Tagespikett. Value-first puts every rule
        # immediately in front of the thing it is the time for, which is the one arrangement
        # that cannot be misread (09.08., after trying it the other way round).
        zrows = [
            [Paragraph(_esc(val), st["cell"]) if val else None, Paragraph(_esc(lab), st["cell"])]
            for lab, val in m.zeiten
        ]
        # 3-up columns to keep the grid compact
        cols = 3
        n_rows = -(-len(zrows) // cols)
        cw = inner_w / cols
        # ⚠️ The value column is sized to what it HAS TO HOLD, not to a fixed third of the cell.
        # A bare «22:47» fits 0.32 of a 3-up column; «08.08. 22:47» — which is what every clock
        # on the sheet reads once the Einsatz runs past midnight (lib/report · spanAwareClock) —
        # does not, so every row broke onto two lines with the date orphaned above the time, and
        # the empty ones showed a write-in rule the width of a dash (08.08. Einsatz). Measured,
        # then clamped: a stray long value must not eat the label beside it either.
        widest_val = max((_str_w(val, "Helvetica", 9) for _, val in m.zeiten if val), default=0.0)
        val_pad = 6  # the RIGHTPADDING below, which the text cannot use
        # the floor keeps the write-in rule a field somebody can write a date into, on a sheet
        # where nothing has been recorded at all and there is no value to measure
        val_w = min(max(widest_val + val_pad + 2, cw * 0.34), cw * 0.58)
        # an unrecorded time is a rule ON the row's own line — see _write_rule for why this is
        # not a LINEBELOW any more
        for i, (_lab, val) in enumerate(m.zeiten):
            if not val:
                zrows[i][0] = _write_rule(val_w - val_pad)
        grid: list[list] = []
        for ri in range(n_rows):
            row: list = []
            for c in range(cols):
                i = c * n_rows + ri
                row.extend(zrows[i] if i < len(zrows) else ["", ""])
            grid.append(row)
        zt = Table(grid, colWidths=[val_w, cw - val_w] * cols)
        zt.setStyle(
            TableStyle(
                [
                    ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
                    ("TOPPADDING", (0, 0), (-1, -1), 3),
                    ("BOTTOMPADDING", (0, 0), (-1, -1), 3),
                    ("LEFTPADDING", (0, 0), (-1, -1), 0),
                    # the rule is inset from the next column so it reads as a field rather than
                    # as a bar running across the whole grid
                    ("RIGHTPADDING", (0, 0), (-1, -1), 6),
                ]
            )
        )
        story.append(zt)

    # Bemerkungen only when digitally filled (2026-07-18): the Kurzbericht is the
    # hand-writing field — an extra empty ruled block just cost paper
    if m.remarks:
        story.extend(head(L["remarks"]))
        story.append(Paragraph(_esc(m.remarks), st["body"]))
    if m.lehren:
        story.extend(head(L["lehren"]))
        story.append(Paragraph(_esc(m.lehren), st["body"]))

    # --- Anwesenheit · Material · Partnerorganisationen, in THAT order -------------------
    # The same order the Rapport dialog asks for them on screen, so filling in and checking the
    # paper follow one sequence: our own people, our own material, then everyone else. No forced
    # page break — each table splits at a row boundary, so a small Einsatz stays on one sheet.
    if opt.attendance and payload.personal:
        story.extend(head(L["personal"]))
        # The two numbers a Fourier is asked for, on the sheet that gets signed. RAW first —
        # what actually happened — and the Sold figure behind it, with the rule that produced it
        # spelled out, because a rounded number nobody can reproduce is a number nobody trusts.
        ps = payload.personalSummary
        if ps and ps.present:
            # `hours` empty = nothing to total (a running Einsatz has no Einsatzende, so every
            # open block is unresolvable). Printing «0:00» there states a measurement.
            if ps.hours:
                story.append(
                    Paragraph(
                        L["personalTotals"].format(n=ps.present, h=_esc(ps.hours), r=_esc(ps.hoursRounded)),
                        st["cell"],
                    )
                )
                # only worth saying when there IS a total for them to be missing from
                # ⚠️ «N Person(en) ohne verwertbare Zeiten» is NOT printed. On paper it was a count
                # of an abstraction that nobody could act on — the affected person is already in
                # the roster above with their times, and the sentence named neither them nor the
                # reason. It belongs where it can be fixed: the Rapport surface raises it as a
                # Hinweis beside the button that makes the paper (ReportPreflight · Kontrolle).
            else:
                story.append(Paragraph(L["personalCount"].format(n=ps.present), st["cell"]))
        # No «Abhaken, ggf. von–bis ergänzen» above the table. The tick boxes and the empty
        # von–bis cells say that themselves, on a sheet whose readers fill one in every week —
        # and the line sat exactly where the pen needs room.
        story.append(Spacer(1, 4))
        story.append(_personal_table(payload.personal, inner_w, st))

    # --- Material worksheet: the full catalogue with amount stubs --------------------------
    if opt.mittel and payload.mittelForm:
        story.extend(head(L["mittel"]))
        story.append(_mittel_table(payload.mittelForm, inner_w, st))

    # EVERY organisation the station works with is listed — ticked where it was involved, blank
    # where it was not — the way the Personalblatt lists the whole Mannschaft. A list of only the
    # ticked ones cannot say «die Polizei war NICHT da», and on paper that difference is the whole
    # point of the block. Anything recorded beyond the station's own list (a neighbouring Wehr, a
    # Werkhof) is appended, and a blank row closes it off for the one nobody thought of — exactly
    # the write-in rows the roster ends with. Printed unconditionally: the rapport is a FORM, and
    # a station with no configured list still has a Polizei to tick.
    story.extend(head(L["partnerOrgs"]))
    by_org = {(c.org or "").strip().lower(): c for c in m.partnerContacts}
    listed = [(org, by_org.pop(org.strip().lower(), None)) for org in payload.partnerPresets]
    listed += [(c.org or "", c) for c in by_org.values()]
    # TWO blank write-in rows, like the Personalblatt — this is where «die zwei leeren» belong.
    # They were briefly put in the Rapport SURFACE instead, where two empty Organisation/Bemerkung
    # pairs plus their bins just stacked up under a list that already offers «+ Weitere». On paper
    # there is no «+», so a partner nobody configured can only be written where there is a rule.
    listed += [("", None), ("", None)]
    story.append(_partner_table(listed, inner_w, st))

    # Unterschriften close the SIGNED part (Haupt-Rapport + Personal + Material — one
    # unit, kantonale Vorlage 11-01-003): Einsatzleitung AND Kommandant, each with an own
    # Ort/Datum leader — same Visum look as the Erfassungsblatt. The signed paper is the
    # record — no digital proof section replaces it (field-classification decision E).
    # «Einsatzleiter: Céline Widmer ______», not «Einsatzleiter · Céline Widmer: ______». The
    # name belongs to the ROLE that is signing, so it reads as a value of that label; glued into
    # the label it made the colon land after the name and the signature line start past it.
    # `line` keeps the rule under a filled field here — unlike the Details box, this one is
    # signed on the line whether or not the name above it is already known.
    #
    # A DRAWN signature (15.10.2026) changes none of that: it is put on the same line a pen would
    # use, «Ort, Datum» is filled in for it, and the paper that comes out is still what gets filed.
    # Only signatures that still hold arrive here; a line without one prints empty, as always.
    signed = {g.role: g for g in payload.signatures}

    def visum(role: str, label: str, default_name: str | None) -> list[dict]:
        g = signed.get(role)
        if g is None:
            return [
                # «Ort, Datum: ______» is written ON its line like every other field on the sheet —
                # it is a value somebody fills in, not a signature. Only the NAME field signs
                # underneath, because that is the one that needs empty paper beneath it.
                {"label": L["sigOrtDatum"], "w": 0.4},
                {"label": label, "w": 0.6, "value": default_name, "sign": True},
            ]
        return [
            {"label": L["sigOrtDatum"], "w": 0.4, "value": g.placeDate or None},
            {
                "label": label,
                "w": 0.6,
                "value": g.name or default_name,
                "sign": True,
                "ink": g.strokes,
                "foot": L["sigOnScreen"].format(at=g.at, sum=g.checksum),
            },
        ]

    sig = _FormRows(
        inner_w,
        [
            visum("el", L["einsatzleiter"], m.einsatzleiter),
            visum("kdt", L["sigKommandant"], m.kommandant),
        ],
        # Room to sign BESIDE the name, not under it — the rule is on the row's own line now,
        # so the pitch only has to keep the two Visum rows from crowding each other.
        pitch=11.5 * mm,
    )
    story.append(KeepTogether([*head(L["signoff"]), sig]))

    # --- Einsatzjournal (Beilage) — only when there are entries; an empty journal table
    # would just cost paper on the blank form -----------------------------------------------
    if opt.journal and payload.journal:
        # The Journal is a BEILAGE, like the Kroki and the plans — an addition to the rapport,
        # not a part of it. It started wherever the signed part happened to end, which put the
        # first entries in the white space under the Unterschriften and made the two read as one
        # document. Its own sheet says what it is. (_collapse_breaks drops the double if a
        # section boundary already broke here.)
        story.append(PageBreak())
        story.extend(head(f"{L['journal']} · {payload.journalDay}" if payload.journalDay else L["journal"]))

        # ⚠️ Zeit and Bereich are as wide as their widest label, never wider than a cap — a word
        # that does not fit its cell is BROKEN mid-word by ReportLab, and a fixed 24mm Bereich
        # printed «Sofortmassna / hme» on every such row (23.10.2026). The Zeit column shrinks to
        # «07:03» on a one-day Einsatz (`journalDay`) and gives the Eintrag the difference; a
        # date label («16.08.2026 15:35», 24.7mm at 9pt) still fits under the 29mm cap.
        # +10pt: the two 5pt side paddings _table_style() puts inside every cell.
        def col_w(labels: list[str], heading: str, lo: float, hi: float) -> float:
            widest = max([_str_w(t, "Helvetica", 9) + 1 for t in labels] + [_str_w(heading, "Helvetica-Bold", 8)])
            return min(hi, max(lo, widest + 10))

        # …and the «Nachtrag» mark under a row's time is a label of that column too
        time_labels = [r.timeLabel for r in payload.journal] + [L["nachtrag"] for r in payload.journal if r.nachtrag]
        time_w = col_w(time_labels, L["colTime"], 14 * mm, 29 * mm)
        area_w = col_w([r.area for r in payload.journal], L["colArea"], 18 * mm, 38 * mm)
        # the Eintrag column's content width — mirrors the colWidths below, minus the paddings
        entry_w = inner_w - time_w - area_w - 10
        thead = [Paragraph(_esc(L[c]), st["cellhead"]) for c in ("colTime", "colArea", "colEntry")]
        body: list[list] = []
        for r in payload.journal:
            rep = f' <font color="{_LABEL}">{r.repeats}×</font>' if (r.repeats or 1) > 1 else ""
            entry_cells: list = [Paragraph((safe_markup(r.markup) or _esc(r.text)) + rep, st["cell"])]
            if r.correctedAt and r.textOriginal:
                corrected = L["correctedLine"].format(t=_esc(r.correctedAt), text=_esc(r.textOriginal))
                entry_cells.append(Paragraph(corrected, st["muted"]))
            if r.transcriptLines:
                for i, line in enumerate(r.transcriptLines):
                    lead = f"<b>{_esc(L['transcript'])}:</b> " if i == 0 else ""
                    entry_cells.append(Paragraph(f"{lead}{_esc(line)}", st["muted"]))
            elif r.transcript:
                entry_cells.append(Paragraph(f"<b>{_esc(L['transcript'])}:</b> {_esc(r.transcript)}", st["muted"]))
            urls = r.photoUrls or ([r.photoUrl] if r.photoUrl else [])
            shots = [figures.get(r.photoKey)] if r.photoKey else []
            shots += [figures.get(f"photo:{u}") for u in urls]
            # ⚠️ SIDE BY SIDE from the second picture on. One photo is an illustration and gets the
            # column's full width; four stacked at that width push the next entry a page and a half
            # down, and «one damage is rarely one picture» is exactly the case the multi-photo entry
            # was built for. The width is the Eintrag column's own content width, never a fraction
            # of the page: at `inner_w * 0.45` a landscape shot used 69 % of its column and a
            # portrait one was height-capped to 2.1 cm across — unreadable on paper.
            data_shots = [d for d in shots if d]
            if len(data_shots) == 1:
                photo = _fit_image(data_shots[0], entry_w, 55 * mm)
                if photo:
                    entry_cells.append(Spacer(1, 2))
                    entry_cells.append(photo)
            elif data_shots:
                per_row = 2 if len(data_shots) <= 4 else 3
                gap = 2 * mm
                cell_w = (entry_w - gap * (per_row - 1)) / per_row
                # …and a height cap that scales with the cell, so a portrait shot in a narrow cell
                # is not blown up past what its neighbours occupy
                cell_h = 45 * mm if per_row == 2 else 32 * mm
                shot_grid: list[list] = []
                for i in range(0, len(data_shots), per_row):
                    shot_row = [_fit_image(d, cell_w, cell_h) or "" for d in data_shots[i : i + per_row]]
                    shot_row += [""] * (per_row - len(shot_row))  # keep the last row's columns aligned
                    shot_grid.append(shot_row)
                shot_tbl = Table(shot_grid, colWidths=[cell_w] * per_row, hAlign="LEFT")
                shot_tbl.setStyle(
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
                entry_cells.append(Spacer(1, 2))
                entry_cells.append(shot_tbl)
            time_cell: list = [Paragraph(_esc(r.timeLabel), st["cell"])]
            if r.nachtrag:
                time_cell.append(Paragraph(_esc(L["nachtrag"]), st["muted"]))
            body.append([time_cell, Paragraph(_esc(r.area), st["cell"]), entry_cells])
        # splitInRow: an entry longer than a page (a pasted Lagebericht) splits across pages
        # instead of failing the whole Rapport with a LayoutError (review of #338)
        tbl = Table([thead, *body], colWidths=[time_w, area_w, inner_w - time_w - area_w], repeatRows=1, splitInRow=1)
        tbl.setStyle(_table_style())
        story.append(tbl)

    # --- Aufträge / Pendenzen — a SECTION on the Verlauf's sheet, not a page of its own ------
    # It is derived from the rows just above it, so it belongs with them: checking a line means
    # turning back one page, not hunting the document. And it stays out of the main part on
    # purpose — that part mirrors the WinFAP-Vorlage field for field, and a section inserted
    # there breaks the correspondence the whole sheet is built on.
    if opt.pendenzen and payload.pendenzen:
        story.append(Spacer(1, 7 * mm))
        story.extend(head(L["pendenzen"]))
        p_head = [Paragraph(_esc(L[c]), st["cellhead"]) for c in ("colWas", "colWer", "colErteilt", "colErledigt")]
        p_body: list[list] = []
        for pdz in payload.pendenzen:
            # «dringend» as a marker before the text, not as a column: with two priority levels a
            # column is blank on nearly every row and costs the width «Was» needs.
            # ⚠️ A single red «!», not the word «dringend ·». The word plus a middot in front of
            # the text read as a broken sentence — two punctuation marks and a label competing
            # with the Auftrag itself, on the column that carries the most prose on the page.
            # One glyph marks the row without being read as part of it; the footer says what it
            # means, once, instead of every row saying it.
            lead = f'<font color="{_URGENT}"><b>!</b></font>  ' if pdz.urgent else ""
            cells: list = [Paragraph(f"{lead}{_esc(pdz.text)}", st["cell"])]
            # the Erinnerung, when the item carried one — a fact about the Auftrag, so it sits
            # under «Was» with the Meldungen rather than claiming a column of its own
            if pdz.faellig:
                cells.append(Paragraph(L["pendenzDue"].format(t=_esc(pdz.faellig)), st["subline"]))
            for n in pdz.notes:
                cells.append(Paragraph(f"{_esc(n.timeLabel)}  {_esc(n.text)}", st["subline"]))
            p_body.append(
                [
                    cells,
                    Paragraph(_esc(pdz.assignee or ""), st["cell"]),
                    Paragraph(_esc(pdz.erteilt), st["cell"]),
                    Paragraph(_esc(pdz.erledigt) if pdz.erledigt else f"<b>{_esc(L['pendenzOpen'])}</b>", st["cell"]),
                ]
            )
        p_tbl = Table(
            [p_head, *p_body],
            colWidths=[inner_w - 74 * mm, 34 * mm, 20 * mm, 20 * mm],
            repeatRows=1,
            splitInRow=1,
        )
        # ⚠️ `flush_left=False` — the first column keeps its 5pt like every other. The default
        # drops it to zero so a grid table lines up with the section rule above it, which is right
        # where that column holds a short label; here it holds the Auftrag in full AND its
        # Meldungen as indented sub-lines, and with no padding the text sat on the grid line while
        # each sub-line's own indent was measured from the border rather than from the text. Five
        # points of daylight against five points of heading alignment is not a close call here.
        p_tbl.setStyle(_table_style())
        story.append(p_tbl)
        # ⚠️ No legend line under this table (18.08.). It explained four things the table already
        # says out loud — «!» sits next to the word «dringend», an indented line under an Auftrag
        # reads as belonging to it, «offen» is the word in the column — and a caption that repeats
        # its own table teaches the reader to skip captions.

    # --- Messungen — the Messpunkte with their gas readings (10.11.2026, app/report/messungen) --
    # A Beilage like the Journal, and after it: the journal carries none of the reading rows, so
    # this table is where a reader finds «was the room free when we handed over». No switch — it
    # prints whenever a point was measured and costs nothing when none was. On the Journal's
    # sheet when there is one; with neither Journal nor Pendenzen before it, on its own.
    messungen = _messungen_story(payload.messungen, payload.messungenLimits, inner_w, head, st)
    if messungen:
        follows = (opt.journal and payload.journal) or (opt.pendenzen and payload.pendenzen)
        story.append(Spacer(1, 7 * mm) if follows else PageBreak())
        story.extend(messungen)

    # --- Die Tafel — every board-template page on a sheet of its own, in its own layout --------
    # (10.10.2026, app/report_board). After the Aufträge: the Erste Führung is the Einsatz's own
    # first record, not reference material, so it does not wait for the Anhang. Its Lagekarte box
    # carries the server's own Kroki of the scene, framed on the Lage, rendered now.
    if opt.tafel and payload.boardPages:
        story.extend(
            _tafel_story(payload.boardPages, payload.boardMap, payload.incident.title, payload.generatedAt, head, st)
        )

    # --- Anhang: Kroki + annotated plans ALWAYS at the end (decided 2026-07-14) — the data
    # sections above are the identical main section; visual material is appended, never
    # interleaved. The Kroki is rendered HERE, server-side (app/kroki.py); the figure-based
    # branches remain as the one-release compat window for old clients.
    kroki_png: bytes | None = None
    #: filled by the renderer when the labels could not all fit as words and the picture
    #: fell back to numbers — «1 · 2 · 3» then print as a legend under the Kroki
    kroki_legend: list[str] = []
    if opt.kroki and payload.kroki is not None:
        from .. import kroki as kk

        pack = kk.get_pack()
        if pack is not None and payload.kroki.tiles:
            kw, kh = _KROKI_PX if opt.krokiLandscape else _KROKI_PX_PORTRAIT
            scene = kk.KrokiScene(
                entities=[e.model_dump() for e in payload.kroki.entities],
                drawings=[d.model_dump() for d in payload.kroki.drawings],
            )
            view = _kroki_view(payload.kroki, kw, kh)
            symbol_zoom = view.overlay_z if view.overlay_z is not None else view.z
            img_out = kk.render_kroki(
                scene,
                pack,
                kk.approved_tile_template(payload.kroki.tiles),
                width=kw,
                height=kh,
                view=view,
                cache=kk.get_tile_cache(),
                sym_mul=kk.kroki_symbol_mul(symbol_zoom),
                max_tile_z=payload.kroki.maxTileZoom or 19,
                attribution=payload.kroki.attribution,
                legend_out=kroki_legend,
            )
            b = io.BytesIO()
            img_out.save(b, "PNG")
            kroki_png = b.getvalue()

    # ONE list of figure pages — the Kroki first, then the Gebäude / Objektplan pages — and ONE
    # template that lays every one of them out (`figure_page` below). They used to be two blocks
    # that had drifted: only the Kroki said when its picture was taken.
    #: heading, caption, PNG, landscape, legend — every page numbers its symbol captions the same
    #: way, so the words travel back out of the renderer the same way (legend_out). No PNG = the
    #: renderer threw on that sheet: it keeps its place, with a line saying so instead of a picture.
    figure_pages: list[tuple[str, str | None, bytes | None, bool, list[str]]] = []
    if kroki_png:
        figure_pages.append((L["kroki"], payload.krokiCaption, kroki_png, opt.krokiLandscape, kroki_legend))
    for pp in payload.planPages:
        pdf_bytes = plan_pdfs.get(pp.url or "")
        if not pdf_bytes and not pp.blankAspect:
            continue
        plan_legend: list[str] = []
        try:
            from .. import kroki as kk

            rendered = (
                kk.render_plan_page(
                    pdf_bytes, [a.model_dump() for a in pp.annos], kk.get_pack(), legend_out=plan_legend, page=pp.page
                )
                if pdf_bytes
                else kk.render_blank_page(
                    pp.blankAspect or 1.0, [a.model_dump() for a in pp.annos], kk.get_pack(), legend_out=plan_legend
                )
            )
        except Exception:  # a broken plan PDF must not sink the whole rapport
            # …but it must not vanish without a word either: until 23.10.2026 every Tafel-Skizze
            # with a Linie left the Rapport this way, logged as a warning nobody read, while
            # preflight and toast said all was well. The reader is told which sheet is missing.
            logger.error("Plan page %r could not be rendered; placeholder printed", pp.label, exc_info=True)
            figure_pages.append((pp.label, L["pageFailed"].format(t=pp.label), None, False, []))
            continue
        b = io.BytesIO()
        rendered.save(b, "PNG")
        # ⚠️ Orientation follows the BITMAP here, while the Kroki's is the operator's choice. Not
        # an inconsistency: a Kroki is a free crop, so its shape is a decision; a plan sheet has
        # the shape its author gave it, and the page that wastes least of it is the right one.
        figure_pages.append((pp.label, pp.caption, b.getvalue(), rendered.width >= rendered.height, plan_legend))

    for heading, caption, data, is_landscape, legend in figure_pages:
        story.append(NextPageTemplate("landscape" if is_landscape else "portrait"))
        story.append(PageBreak())
        story.extend(head(heading))
        # what the picture shows and WHEN — on every figure page, not only the Kroki: a Gebäude
        # sheet pulled out of the stapled rapport has to say which Einsatz and which moment it is
        if caption:
            story.append(Paragraph(_esc(caption), st["muted"]))
        mw = land_inner_w if is_landscape else inner_w
        mh = (land_inner_h if is_landscape else (ph - 2 * margin)) - 22 * mm
        # the legend claims its room first, so the picture is sized to what is left and the words
        # stay on the SAME sheet as the discs they explain — never squeezed under a block that
        # then overflows onto a second sheet
        img = _fit_image(data, mw, mh - _legend_height(legend))
        if img:
            story.append(Spacer(1, 4))
            story.append(img)
        # ⚠️ Numbers on the picture are useless without this. The renderer numbers every drawing
        # label and symbol caption (kroki · not a collision fallback, that was dropped 09.08.),
        # and the legend is where the words go — with room for the FULL text.
        if legend:
            story.append(Spacer(1, 4))
            story.append(_legend_table(legend, mw, st))
    # each figure page issues its own template+break, so only the LAST one hands back to portrait
    # (two breaks in a row print an empty sheet)
    if figure_pages:
        story.append(NextPageTemplate("portrait"))
        story.append(PageBreak())

    # Beilagen — laid out for the number of them there actually are (see _attachment_block).
    # A Beilage whose bytes are gone drops its plate, not the rapport.
    att_data = [(a, figures.get(f"photo:{a.url}")) for a in payload.attachments]
    att_shown: list[tuple[AttachmentIn, bytes]] = [(a, d) for a, d in att_data if d]
    if att_shown:
        story.append(NextPageTemplate("portrait"))
        story.append(PageBreak())
        story.extend(head(f"{L['attachments']} ({len(att_shown)})"))
        story.append(_attachment_block(att_shown, inner_w, st))

    # Atemschutzüberwachung closes the Anhang: protocol for reconstruction, not primary
    if opt.atemschutz and payload.trupps:
        story.extend(head(L["atemschutz"]))
        # The rule this Einsatz ran on, once, under the heading — every «überfällig» below
        # is measured against it, and a reader six months later has nowhere else to find it.
        if payload.atemschutzIntervalMin:
            grace_min = round((payload.atemschutzGraceSec or 0) / 60)
            story.append(
                Paragraph(
                    _esc(
                        L["azInterval"].format(n=payload.atemschutzIntervalMin, g=grace_min)
                        if grace_min
                        else L["azIntervalNoGrace"].format(n=payload.atemschutzIntervalMin)
                    ),
                    st["muted"],
                )
            )

        def _meta_bits(tr):
            bits = []
            # One row per AdF, numbered the way the Trupp form numbers them — «AdF 1», «AdF 2».
            # A single «AdF: Laura Keller, Nina Frei» line made the sheet name the crew
            # differently from the screen the operator filled in, and a comma list gives no
            # position to point at when somebody asks who the second man was. The Gruppenführer
            # gets no row of his own: the heading above IS his name.
            # ⚠️ …unless the payload carries the crew PER CYCLE (12.09.): then the cycle rows below
            # name who went in each time, and a static «AdF n» list would contradict the second
            # cycle of a crew that changed.
            if not tr.cycles:
                for i, member in enumerate(tr.members, start=1):
                    if member.strip():
                        bits.append((L["memberN"].format(n=i), member))
            if tr.auftrag or tr.ziel:
                bits.append((L["auftrag"], " · ".join([x for x in (tr.auftrag, tr.ziel) if x])))
            if tr.lineNumber:
                bits.append((L["line"], str(tr.lineNumber)))
            if tr.equipment:
                bits.append((L["equipment"], tr.equipment))
            # One row per deployment — «Einsatz 1: 13:44 – 14:10 · Meier Anna / Dürring Jan» — and
            # under it, unlabelled, the dated crew changes that fell into that cycle. Replaces the
            # Eintritt/Austritt rows: the span IS those two stamps, per cycle rather than as two
            # comma lists the reader has to zip up by position.
            if tr.cycles:
                for i, c in enumerate(tr.cycles, start=1):
                    span = f"{c.entry} – {c.exit}" if c.exit else c.entry
                    bits.append((L["cycle"].format(n=i), f"{span} · {c.crew}" if c.crew else span))
                    for ch in c.changes:
                        bits.append(("", f"{ch.t} {ch.text}"))
                return bits
            # ⚠️ ONE row each, listing EVERY cycle — «Eintritt: 13:44, 15:16». A Trupp that came
            # out, got a fresh cylinder and went back in has two of each, and the header used to
            # carry the card's last pair alone: it printed «Eintritt 15:16 · Austritt 15:22» over
            # a table whose first row said «Eintritt 13:44», so the two halves of one block
            # disagreed. One row per cycle was the alternative and reads worse here — the section
            # has ONE label column sized to the widest label on the page (see below), so repeating
            # «Eintritt:» four times would spend four lines saying one thing.
            if tr.entryTimes:
                bits.append((L["entry"], ", ".join(tr.entryTimes)))
                if tr.exitTimes:
                    bits.append((L["exit"], ", ".join(tr.exitTimes)))
            elif tr.exitTimes:
                # closed without ever going under PA (atemschutz · truppNeverDeployed). Printing
                # it as «Austritt» claimed the Trupp came out of something it never went into —
                # on a Sicherungstrupp that is the difference between a crew that was exposed
                # and one that was not, which is exactly what this sheet is read for.
                #
                # ⚠️ As a SPAN, like every other row in this block (04.09.). The bare Draussen
                # stamp read as the one thing that happened to this crew — the 03.09. sheet said
                # «Nicht eingesetzt: 06:50» about a Sicherungstrupp that had stood ready since
                # 06:32, and how long they stood there is the whole of what that row records.
                # No Anmeldung in the log (a Trupp from before 09.08.) → the old single stamp.
                bits.append(
                    (
                        L["notDeployed"],
                        f"{tr.registeredTimes[0]} – {tr.exitTimes[-1]}"
                        if tr.registeredTimes
                        else ", ".join(tr.exitTimes),
                    )
                )
            return bits

        # ⚠️ ONE tab stop for the whole section, not one per Trupp. Sized per block, a Trupp with
        # an «Auftrag / Ziel» put its values ~14mm in and the next Trupp — three «AdF n» rows and
        # nothing else — put them ~8mm in, so every block on the page started at a different x
        # and the pressure logs stepped in and out with them. Widest label anywhere wins.
        _all_bits = [_meta_bits(tr) for tr in payload.trupps]
        label_w = 0.0
        _labels = [k for bits in _all_bits for k, _ in bits if k]
        if _labels:
            label_w = max(_str_w(f"{k}:", "Helvetica-Bold", 9) for k in _labels) + 3 * mm

        for tr, meta_bits in zip(payload.trupps, _all_bits, strict=True):
            # No status word. A rapport is written after the fact, and «Im Einsatz» on a
            # finished Einsatz states something that stopped being true before the sheet was
            # printed. The ONE state that outlives the Einsatz — a Trupp that never went under
            # PA — is carried by its own «Nicht eingesetzt» row above (see _meta_bits).
            # ⚠️ ONE block, kept together (02.09.). Name, crew, Auftrag and the Eintritt/Austritt
            # rows are the KEY to the pressure log under them, and laid out as loose flowables a
            # page break fell between the two: the header sat at the foot of one sheet and its
            # Zeiten table opened the next, under nothing. On a safety document read months later
            # a column of clocks with no crew name above it is unusable. A block taller than a
            # full frame still splits normally (KeepTogether hands its content back when it fits
            # nowhere), so a very long log is never made unprintable by this.
            heading = _trupp_heading(tr)
            block: list = [Paragraph(_esc(heading), st["h3"])]
            # A TABLE, not one Paragraph per line: as free lines each value started right after
            # its own label, so «AdF 1», «Auftrag / Ziel» and «Eintritt» put their values at three
            # different indents and nothing under the Trupp name lined up. One label column,
            # sized above to the widest label on the PAGE, gives every value the same tab stop.
            if meta_bits:
                meta_tbl = Table(
                    [
                        [Paragraph(f"<b>{_esc(k)}:</b>" if k else "", st["cell"]), Paragraph(_esc(v), st["cell"])]
                        for k, v in meta_bits
                    ],
                    colWidths=[label_w, inner_w - label_w],
                )
                meta_tbl.setStyle(
                    TableStyle(
                        [
                            ("VALIGN", (0, 0), (-1, -1), "TOP"),
                            ("TOPPADDING", (0, 0), (-1, -1), 0.5),
                            ("BOTTOMPADDING", (0, 0), (-1, -1), 0.5),
                            ("LEFTPADDING", (0, 0), (-1, -1), 0),
                            ("RIGHTPADDING", (0, 0), (-1, -1), 0),
                        ]
                    )
                )
                block.append(meta_tbl)
            thead = [Paragraph(_esc(L[c]), st["cellhead"]) for c in ("colTime", "colKind", "colPressure")]
            body = [
                [
                    Paragraph(_esc(r.t), st["cell"]),
                    Paragraph(_esc(r.kindLabel), st["cell"]),
                    Paragraph(_esc(r.bar), st["cell"]),
                ]
                for r in tr.readings
            ]
            if not body:
                body = [[Paragraph(_esc(L["noPressureLog"]), st["muted"]), "", ""]]
            # A pressure log is three short values — a clock, one word and a number. At 45/35/20
            # of the full width it read as a table of mostly empty space.
            tbl = Table([thead, *body], colWidths=[inner_w * x for x in (0.26, 0.16, 0.12)], repeatRows=1)
            tbl.setStyle(_table_style())
            # ⚠️ Indented to the Trupp's VALUE column, not to the frame edge. The log belongs to
            # the Trupp above it the same way «Eintritt: 20:29» does, and starting it at the page
            # margin made it read as a new full-width section that happened to follow. Its own
            # 5pt cell padding is subtracted, so the «Zeit» heading lands exactly on the tab stop
            # that «Anna Meier» and «Retten · 2. OG» sit on.
            indent = max(0.0, label_w - 5)
            wrapped = Table([["", tbl]], colWidths=[indent, inner_w - indent])
            wrapped.setStyle(TableStyle(_SPLIT_OUTER))
            # Narrower than the frame, so ReportLab's default CENTER floated it into the middle of
            # the page — the pressure log sat off to the side of the Trupp name and «Auftrag / Ziel»
            # lines it belongs under.
            wrapped.hAlign = "LEFT"
            block.append(Spacer(1, 3))
            block.append(wrapped)
            story.append(KeepTogether(block))
            story.append(Spacer(1, 6))

    # Auswertung — the internal debrief Beilage, LAST, on its own landscape sheet: everything
    # above it is the record that gets signed and handed out; this comes off the stack first.
    if opt.auswertung and payload.auswertung is not None:
        story.append(NextPageTemplate("landscape"))
        story.append(PageBreak())
        story.extend(_auswertung_story(payload.auswertung, land_inner_w, st, head))

    story = _collapse_breaks(story)
    # ⚠️ The page footer carries the ALARM time, not the moment the file was made. Every page
    # said «Erstellt: …» twice — once under the title, once at the foot of every sheet — and the
    # print time is the least useful stamp on a document that gets reprinted after a correction:
    # two printings of the same Einsatz footed differently and read as two Einsätze. The
    # Alarmierung is what a stack of rapports is sorted and found by. Falls back to the print
    # time only when nothing recorded the alarm, so the foot is never blank.
    stamp = m.alarmiertAt or payload.generatedAt
    label = " · ".join(x for x in (payload.incident.title, stamp) if x)

    class _Stamped(_NumberedCanvas):
        footer_label = label

    doc.build(story, canvasmaker=_Stamped)
    return buf.getvalue()


# Every two-up section (Personal · Material · Partner) hangs its two halves side by side with a
# 3 mm gutter. Top-aligned and un-padded, so each column starts at the section's top edge and the
# gutter is the only thing between them.
_SPLIT_OUTER = [
    ("VALIGN", (0, 0), (-1, -1), "TOP"),
    ("TOPPADDING", (0, 0), (-1, -1), 0),
    ("BOTTOMPADDING", (0, 0), (-1, -1), 0),
    ("LEFTPADDING", (0, 0), (-1, -1), 0),
    ("RIGHTPADDING", (0, 0), (-1, -1), 0),
]


def _write_rule(width: float, fs: float = 8.5) -> Table:
    """A dotted write-in rule that sits ON the text line, not at the bottom of the row.

    ⚠️ ``LINEBELOW`` draws at the bottom of the CELL, and a table row is as tall as its tallest
    cell — which in every tick-off block on this sheet is the checkbox. So an empty row's rule
    dropped a line below the box beside it and read as a second, lower row: box on one line,
    the thing to write on the next (08.08. sheet, three blocks at once). Reported 09.08. as
    «the empty lines where things aren't all on one line».

    This is a one-cell table of exactly one text line's height, so the rule lands where the
    words would have been no matter what else shares the row. Left-aligned and given an
    explicit width, so every rule in a column starts and ends at the same x.
    """
    t = Table([[""]], colWidths=[width], rowHeights=[fs * 1.2])
    t.setStyle(TableStyle([*_SPLIT_OUTER, ("LINEBELOW", (0, 0), (0, 0), 0.5, _WRITE, *_WRITE_DASH)]))
    t.hAlign = "LEFT"
    return t


#: How TALL one indivisible chunk of a two-up block may get — i.e. how coarsely the block is
#: allowed to break across a page boundary.
#:
#: ⚠️ NOT a page. It was 660pt — nearly the whole frame — which made the 66-name roster ONE
#: indivisible row: with the header, the Kurzbericht and its own heading already on page 1
#: there was never 660pt left for it, so ReportLab moved the entire roster to page 2 and the
#: rapport's first page ended two thirds empty under a heading with nothing beneath it.
#: At five rows the block simply continues where the page ran out, and the most that can be
#: pushed down is those five rows. Reading order is untouched: the left/right split is made
#: ONCE over the whole list and every chunk slices both halves in parallel, so the left column
#: still reads 1…33 straight down and across the break.
_SPLIT_BUDGET = 72
# ⚠️ The gutter between the two halves of EVERY two-up block, stated once. It was a literal in
# four places and the callers disagreed with it: Personal and Material each subtracted the whole
# 3mm from their half instead of half of it, so both blocks came out 8.5pt narrower than the
# frame and ReportLab centre-floated them — the roster's checkboxes sat at x=46.8 and Material's
# labels at 43.9 while the section rule above them started at 39.7 and the Partner tick-offs at
# 42.5. Nothing in the two biggest blocks lined up with anything. Derive both halves from here
# and a caller can no longer disagree with the table it is filling.
_SPLIT_GUTTER = 3 * mm
#: The tick-off square, drawn at a FIXED size so every checkbox in a column matches whatever
#: the row around it does — see _personal_table.
_CHECK_W = 4 * mm


def _check_box(ticked: bool) -> Table:
    """ONE tick-off square for the whole sheet: 4mm, square, whatever the row does.

    ⚠️ Not a BOX on the table cell. As a cell border it takes the ROW's height — so a person
    with a remark, or a Partner row whose Bemerkung wrapped, got a checkbox twice as tall as its
    neighbour's, and a tick-off column whose boxes are different sizes reads as a form somebody
    drew by hand. The roster had worked this out locally; the Partner block still carried the
    cell-border version, at a third size again.
    """
    st = _styles()
    box = Table([[Paragraph("<b>X</b>" if ticked else "", st["check"])]], colWidths=[_CHECK_W], rowHeights=[_CHECK_W])
    box.setStyle(
        TableStyle([*_SPLIT_OUTER, ("BOX", (0, 0), (-1, -1), 0.5, _WRITE), ("VALIGN", (0, 0), (-1, -1), "MIDDLE")])
    )
    return box


def _split_col_w(inner_w: float) -> float:
    """Width of ONE half of a two-up block — the gutter is shared, so each side gives up half."""
    return inner_w / 2 - _SPLIT_GUTTER / 2


def _two_up(items: list, make_column, col_w: float) -> Table:
    """Lay `items` out in two independent columns that can still break across pages.

    Each half gets its OWN sub-table, so a four-line remark on one side never sets the row
    height on the other — the drift that made the printed sheet look broken. But a sub-table is
    one indivisible flowable: put both halves in a single outer row and a roster longer than a
    page raises a LayoutError and takes the whole rapport down with it (observed at 120 people).

    So the outer table gets one row per PAGE-SIZED CHUNK. ReportLab splits between those rows,
    each chunk is measured against the real frame rather than guessed at, and the usual case —
    everything fits on one page — is a single row, i.e. exactly two independent columns.
    """
    half = -(-len(items) // 2)
    left, right = items[:half], items[half:]
    rows: list[list] = []
    i = 0
    while i < half:
        # grow the chunk while BOTH halves still fit; always take at least one item so a single
        # oversized row (a pasted essay in a remark) cannot spin here forever
        k = 1
        while i + k <= half:
            lt, rt = make_column(left[i : i + k]), make_column(right[i : i + k])
            tallest = max(lt.wrap(col_w, _SPLIT_BUDGET * 4)[1], rt.wrap(col_w, _SPLIT_BUDGET * 4)[1])
            if tallest > _SPLIT_BUDGET and k > 1:
                k -= 1
                break
            if tallest > _SPLIT_BUDGET:
                break
            k += 1
        rows.append([make_column(left[i : i + k]), "", make_column(right[i : i + k])])
        i += k
    outer = Table(rows or [["", "", ""]], colWidths=[col_w, _SPLIT_GUTTER, col_w])
    outer.setStyle(TableStyle(_SPLIT_OUTER))
    return outer


def _personal_table(personal: list[PersonalRowIn], inner_w: float, st: dict[str, ParagraphStyle]) -> Table:
    """Two-up roster: [☐|Name|von–bis] × 2 — recorded people get a printed tick + clocks,
    the rest stays blank for the pen. Long rosters flow onto the next page."""
    check_w = _CHECK_W
    # ⚠️ ONE stub shape per sheet. The stub was always «__:__» while a recorded value on an
    # Einsatz over midnight reads «02.08. 14:41» — so a column of blanks was visibly a different
    # length from the rows above it, and what somebody has to write in did not match what the
    # row beside it shows. When ANY row on the sheet carries a date, every stub carries the
    # space for one.
    ends = [v for p in personal for t in p.times for v in (t.von, t.bis)]
    dated = any("." in (v or "") for v in ends)
    # the two clock cells are EMPTY and carry a dotted rule instead of an underscore stub —
    # one texture means «hier schreiben» across the whole sheet (see _WRITE_DASH)
    stub = ""
    _ = dated  # the shape no longer changes with it; the column width still does
    # The clock column is sized to what it actually has to hold. A fixed 30 mm was enough for
    # «14:41 – 11:00» and not for «02.08. 14:41 – 04.06. 11:00», so an Einsatz over midnight
    # wrapped every row onto two lines — the remark under the name then had a stack of dates
    # beside it. Capped, so a stray long value cannot eat the name column instead.
    widest_end = max((_str_w(v or stub, "Helvetica", 8.5) for v in ends or [None]), default=0.0)
    dash_w = 4 * mm
    end_w = min(widest_end + 1.5 * mm, 21 * mm)
    time_w = max(32 * mm, min(2 * end_w + dash_w, 46 * mm))
    end_w = (time_w - dash_w) / 2
    name_w = _split_col_w(inner_w) - check_w - time_w

    def cells(p: PersonalRowIn | None) -> list:
        if p is None:
            return ["", "", ""]

        # each end is coloured on its own: a recorded arrival next to a derived departure has
        # to read as exactly that, so the two are not one string in one colour any more
        def stamp(v: str | None, derived: bool) -> str:
            if not v:
                return f'<font color="{_DERIVED}">{stub}</font>'
            return f'<font color="{_DERIVED}">{_esc(v)}</font>' if derived else _esc(v)

        # ⚠️ THREE columns, so the dash is at one x down the whole sheet. As one string the two
        # ends were set proportionally — «__:__» and «02.08. 14:41» are not the same width, and
        # Helvetica's underscore is narrower than its digits, so even two stubs of equal shape
        # drifted — and every row put its dash somewhere else. «von» hangs right against the
        # dash, «bis» starts left of it, which is also how the two are read: inwards, from the
        # dash. Fixed widths mean no wrap either, so the old &nbsp; guard is unnecessary.
        # ONE line per stretch, stacked — a person who left and came back has two, under the one
        # printing of their name.
        spans = p.times or [PersonalTimeIn()]
        vonbis = Table(
            [
                [
                    Paragraph(stamp(t.von, t.vonDerived), st["ramt"]),
                    Paragraph(f'<font color="{_DERIVED}">–</font>', st["rdash"]),
                    Paragraph(stamp(t.bis, t.bisDerived), st["rcell"]),
                ]
                for t in spans
            ],
            colWidths=[end_w, dash_w, end_w],
        )
        # an EMPTY clock cell gets the sheet's write-in rule under it. The stub used to be
        # «__.__. __:__», which is a third texture on a sheet that already has a dotted
        # leader — and its underscores never lined up with the digits of a filled row,
        # because Helvetica's underscore is narrower than its figures.
        vonbis.setStyle(
            TableStyle(
                [
                    *_SPLIT_OUTER,
                    ("TOPPADDING", (0, 1), (-1, -1), 2),
                    *[
                        ("LINEBELOW", (col, r), (col, r), 0.5, _WRITE, *_WRITE_DASH)
                        for r, t in enumerate(spans)
                        for col, v in ((0, t.von), (2, t.bis))
                        if not v
                    ],
                ]
            )
        )
        # The remark rides INLINE behind the name — «Meier Anna · Einsatzleiter» — whenever it
        # fits the column. As its own line under the name it made that row two lines tall, and
        # since the two halves of the sheet are independent tables (see _two_up), every remark
        # opened a one-row gap in the column OPPOSITE it: a hole that reads as a missing person
        # on a roster whose whole job is «who was here». A role is short, which is the case this
        # is for; anything too long to fit still gets its own line and its own two-line room.
        # «Gast» leads the remark — it says what KIND of entry this row is, which is read before
        # what the person did on it. One suffix, so a guest with a job prints «Gast · Fahrer TLF»
        # rather than two competing marks.
        note = _clip_print(p.note) if p.note else ""
        if p.guest:
            note = f"{L['guest']} · {note}" if note else L["guest"]
        inline = bool(note) and (
            _str_w(p.name, "Helvetica", 8.5) + _str_w(f" · {note}", "Helvetica", 6.5) <= name_w - 11
        )
        # ⚠️ A write-in row's rule is part of the CELL, not a LINEBELOW on the row: the row is as
        # tall as the checkbox beside it, so the rule dropped onto the next line and the sheet
        # read as a box on one line and a blank on the one under it (see _write_rule).
        if not p.name:
            return [_check_box(False), _write_rule(name_w - 5), ""]
        label = _esc(p.name)
        if inline:
            label += f'<font size="6.5" color="{_DIM_INK}"> · {_esc(note)}</font>'
        name: list = [Paragraph(label, st["rcell"])]
        if note and not inline:
            name.append(Paragraph(_esc(note), st["rnote"]))
        box = _check_box(p.erfasst)
        return [
            box,
            name,
            # ⚠️ A WRITE-IN row prints no clocks. The roster deliberately carries two blank rows
            # at the end for somebody who turned up and is not on the Mannschaftsliste (see
            # lib/report.ts) — and they printed the full «__:__ – __:__» stub beside an empty
            # tick box, so the sheet ended in two people nobody had got round to naming. The
            # ruled underline is the affordance for a blank row; the stub is for a NAMED person
            # whose times are still to be filled in.
            vonbis if p.name else "",
        ]

    def column(people: list[PersonalRowIn]) -> Table:
        style: list[tuple] = [
            # TOP, not MIDDLE. A person with a remark has a two-line name cell, and a
            # middle-aligned row floated their clocks between the two lines — aligned with
            # neither the name above nor the remark below. The Material worksheet beside it
            # already uses TOP for exactly this reason.
            ("VALIGN", (0, 0), (-1, -1), "TOP"),
            # A roster row is filled in with a PEN — the tick, and usually the two clocks — so it
            # cannot go back to the 1.8 pt it had. 2.8 is the compromise: writable, and still
            # dense enough that a village Wehr's roster does not sprawl.
            ("TOPPADDING", (0, 0), (-1, -1), _PAD_ROW),
            ("BOTTOMPADDING", (0, 0), (-1, -1), _PAD_ROW),
            ("LEFTPADDING", (0, 0), (-1, -1), 1),
            # breathing room between the checkbox square and the name (jsPDF gap ~1.6mm);
            # the check cells lose ALL side padding so the X centers in its square
            ("LEFTPADDING", (1, 0), (1, -1), 5),
            ("LEFTPADDING", (0, 0), (0, -1), 0),
            ("RIGHTPADDING", (0, 0), (0, -1), 0),
            ("FONTSIZE", (0, 0), (-1, -1), 8.5),
        ]
        t = Table([cells(p) for p in people] or [["", "", ""]], colWidths=[check_w, name_w, time_w])
        t.setStyle(TableStyle(style))
        return t

    # a shared row meant one person's remark set the height for whoever happened to sit opposite
    # them, and from there down the two halves no longer shared a baseline
    return _two_up(personal, column, check_w + name_w + time_w)


# Beilagen come in three sizes, because «how many are there» changes what the pages are FOR.
#
#   ≤2   full plates — a driving licence is photographed to be read off the paper afterwards
#   ≤8   two-up — still readable, and half the sheets. Four plates down a single column left
#        the right half of every page empty for no gain: at 62 % width a plate is not using
#        the page it costs.
#   >8   a numbered contact sheet, three across. Nobody reads plate 30, and what the paper is
#        for becomes «which pictures exist», which a thumbnail answers. 50 large plates are
#        ~20 sheets appended to a 2-page rapport, and the signed part disappears behind them.
_ATT_PLATE_MAX = 2
_ATT_GRID_MAX = 8


def _attachment_block(
    att: list[tuple[AttachmentIn, bytes]],
    inner_w: float,
    st: dict[str, ParagraphStyle],
) -> Table:
    """Beilagen, laid out for the number of them there actually are.

    One or two print LARGE — the reason to photograph a driving licence is to read it off the
    paper afterwards. A handful go two-up, which is still readable and halves the sheets. Many
    print as a numbered contact sheet: at 50 photos nobody reads plate 30, and what the paper is
    for becomes «which pictures exist», which a thumbnail answers.

    Either way each carries its number «Bild 7», so the Verlauf, a phone call and the paper can
    all name the same picture.
    """
    n = len(att)
    grid = n > _ATT_PLATE_MAX
    if n <= _ATT_PLATE_MAX:
        cols, cell_h = 1, 92 * mm
    elif n <= _ATT_GRID_MAX:
        # 74, not 84: at 84 the row pitch was 260pt against ~735pt of usable page, so only TWO
        # rows fitted and every sheet ended with ~79mm of nothing. 74 brings the row to 232pt —
        # three rows to a page, the same plates on half the paper.
        cols, cell_h = 2, 74 * mm
    else:
        cols, cell_h = 3, 62 * mm
    # 6, not 4: two photographs butted almost together read as one wide picture, and a contact
    # sheet needs the eye to find the boundaries without looking for them.
    gutter = 6 * mm
    cell_w = (inner_w - gutter * (cols - 1)) / cols
    img_w = cell_w if grid else inner_w * 0.62

    def cell(i: int, a: AttachmentIn, data: bytes):
        # The NUMBER is the contract — it is what lets the Verlauf, a phone call and the paper
        # name the same picture, so the label spells itself out around a number that never moves.
        # A caption is extra: «ohne Bildlegende» printed under all seven plates of an ordinary
        # rapport, which is a placeholder repeated until it is noise.
        cap = _esc((a.caption or "").strip())
        ref = _esc(L["figure"].format(n=i))
        caption = Paragraph(f"<b>{ref}</b>" + (f" · {cap}" if cap else ""), st["muted"])
        img = _fit_image(data, img_w, cell_h)
        if img is None:
            return [caption]
        img.hAlign = "LEFT"  # share a left edge with the caption underneath
        if not grid:
            return [img, Spacer(1, 3), caption]
        # ⚠️ On a contact sheet the pictures are NOT the same height — a portrait Ausweis next to
        # a landscape damage shot — so a plain stack put every caption at its own height and the
        # row read as scattered. A fixed picture box bottom-aligns them onto one shelf and puts
        # every caption in the row on the same line.
        box = Table([[img], [caption]], colWidths=[cell_w], rowHeights=[cell_h, None])
        box.setStyle(
            TableStyle(
                [
                    # MIDDLE, not BOTTOM. The box is a fixed height and the plates are not, so
                    # bottom-aligning left a short one hanging under a void — measured at 63mm
                    # of white above a 58pt plate beside one that filled its box. The captions
                    # still share a shelf either way: the picture row height is fixed.
                    ("VALIGN", (0, 0), (0, 0), "MIDDLE"),
                    ("VALIGN", (0, 1), (0, 1), "TOP"),
                    ("TOPPADDING", (0, 0), (-1, -1), 0),
                    ("BOTTOMPADDING", (0, 0), (0, 0), 3),
                    ("BOTTOMPADDING", (0, 1), (0, 1), 0),
                    ("LEFTPADDING", (0, 0), (-1, -1), 0),
                    ("RIGHTPADDING", (0, 0), (-1, -1), 0),
                ]
            )
        )
        return [box]

    cells: list = [cell(i, a, d) for i, (a, d) in enumerate(att, start=1)]
    rows = [cells[r : r + cols] for r in range(0, len(cells), cols)]
    rows[-1] = rows[-1] + [""] * (cols - len(rows[-1]))  # pad the tail row out to `cols`
    # ⚠️ The gutter is drawn as RIGHTPADDING INSIDE each cell, so it has to be part of that
    # cell's width. As `[cell_w] * cols` the table came out `gutter * (cols-1)` narrower than
    # the frame — ReportLab then centre-floated the whole block (left edge 48.2 against a
    # section rule at 39.7) AND the images, sized at cell_w, overflowed their own padding: two
    # photographs measured as touching, Bild 1 ending at 297.64 and Bild 2 starting at 297.64.
    t = Table(rows, colWidths=[cell_w + (gutter if c < cols - 1 else 0) for c in range(cols)])
    t.hAlign = "LEFT"
    t.setStyle(
        TableStyle(
            [
                ("VALIGN", (0, 0), (-1, -1), "TOP"),
                ("TOPPADDING", (0, 0), (-1, -1), 0),
                ("BOTTOMPADDING", (0, 0), (-1, -1), 10),
                ("LEFTPADDING", (0, 0), (-1, -1), 0),
                # the gutter rides on the right of every cell but the last in its row
                *[("RIGHTPADDING", (c, 0), (c, -1), gutter if c < cols - 1 else 0) for c in range(cols)],
            ]
        )
    )
    return t


def _partner_table(
    listed: list[tuple[str, PartnerContact | None]], inner_w: float, st: dict[str, ParagraphStyle]
) -> Table:
    """Two-up Partnerliste: [☐|Organisation|Bemerkung] × 2, the same shape as the roster.

    Box · Organisation · one free line — the same three things the app asks for. The old
    Name/Telefon columns were almost always empty and pushed the remark to the far edge, where it
    read as belonging to nothing; whatever is worth noting («Wm. Keller, Verkehr ab Kreisel») goes
    in the one line and sits right next to its organisation.
    """
    check_w = _CHECK_W
    col_w = _split_col_w(inner_w)
    org_w = (col_w - check_w) * 0.42

    def column(part: list[tuple[str, PartnerContact | None]]) -> Table:
        # ⚠️ ONE look for every row. Ticked organisations were ink, unticked ones muted grey and
        # the write-in row empty — three type treatments and three row heights in a block whose
        # whole point is that the entries are comparable. A tick says «this one was there»; the
        # typography must not say it a second time, more quietly.
        # ⚠️ CLAMPED, like every other remark on this sheet. A partner's name and remark are free
        # text with no length rule behind them, and a long one wrapped to four or five lines —
        # which on a two-up block means the row opposite it opens a hole that size (see
        # `_personal_table`), and the two halves stop sharing baselines from there down.
        # ⚠️ Clipped FIRST, then marked up: `_clip_print` counts characters, and letting it cut a
        # string that already carries an `<a href>` would leave a half-open tag on the page. The
        # phone number in that line is the partner's callback — the reason to print it at all.
        notes = [
            _tel_markup(_clip_print(" · ".join(x for x in (c.name, c.phone, c.note) if x))) if c else ""
            for _, c in part
        ]
        note_w = col_w - check_w - org_w
        # each write-in cell carries its OWN rule, on its own text line — a LINEBELOW would sit
        # at the bottom of a row whose height comes from the checkbox (see _write_rule)
        rows = [
            [
                _check_box(bool(c)),
                Paragraph(_esc(_clip_print(org)), st["rcell"]) if org else _write_rule(org_w - 5),
                Paragraph(note, st["rcell"]) if note else _write_rule(note_w - 5),
            ]
            for (org, c), note in zip(part, notes, strict=True)
        ]
        style: list[tuple] = [
            # ⚠️ TOP, not MIDDLE — the same rule the roster beside it follows. An organisation or
            # a remark that wraps makes the row three lines tall, and a middle-aligned tick then
            # floated down beside the SECOND line: on a sheet somebody reads down the boxes of,
            # the box no longer sat next to the name it belongs to.
            ("VALIGN", (0, 0), (-1, -1), "TOP"),
            ("TOPPADDING", (0, 0), (-1, -1), _PAD_ROW),
            ("BOTTOMPADDING", (0, 0), (-1, -1), _PAD_ROW),
            ("LEFTPADDING", (0, 0), (-1, -1), 1),
            ("LEFTPADDING", (1, 0), (1, -1), 5),
            ("LEFTPADDING", (0, 0), (0, -1), 0),
            ("RIGHTPADDING", (0, 0), (0, -1), 0),
            ("FONTSIZE", (0, 0), (-1, -1), 8.5),
        ]
        t = Table(rows or [["", "", ""]], colWidths=[check_w, org_w, note_w])
        t.setStyle(TableStyle(style))
        return t

    return _two_up(listed, column, col_w)


def _mittel_table(mittel: list[MittelFormRowIn], inner_w: float, st: dict[str, ParagraphStyle]) -> Table:
    """Two-up Material worksheet: label + «______ Stk» amount stub / bold recorded amount."""
    # ⚠️ THREE columns, because the write-in rule has to be a RULE and not six underscores in a
    # string. As `f"______ {unit}"` right-aligned, it was the UNIT that landed on the shared edge
    # and the rule started wherever the unit happened to begin — measured on one sheet, «Stk»
    # rules began at x=250.3, «Sack» at 243.7 and «l» at 260.7, and the «l» of Liter read as a
    # stray glyph hanging off the end of a rule. A recorded «1 Stk» sat on a fourth edge again.
    # Amount and unit get their own columns and the stub is drawn with LINEBELOW, so every rule
    # on the sheet starts and ends at the same x and every unit sits in one column.
    unit_w = 12 * mm
    amt_w = 14 * mm
    label_w = _split_col_w(inner_w) - amt_w - unit_w

    def cells(row: MittelFormRowIn | None) -> list:
        if row is None:
            return ["", "", ""]
        # the remark rides UNDER the label, small: «3 Sack» says how much, «an Werkhof
        # übergeben» says what happened to it, and only the second one is worth reading twice
        label: list = [Paragraph(_esc(row.label), st["rcell"])]
        if row.note:
            label.append(Paragraph(_esc(_clip_print(row.note)), st["rnote"]))
        return [
            label,
            Paragraph(_esc(row.menge) if row.menge else "", st["ramt"]),
            Paragraph(_esc(row.unit), st["runit"]),
        ]

    def column(rows_in: list[MittelFormRowIn]) -> Table:
        t = Table([cells(r) for r in rows_in] or [["", "", ""]], colWidths=[label_w, amt_w, unit_w])
        t.setStyle(
            TableStyle(
                [
                    # amounts hang on the RIGHT edge: «1 Stk» and «______ Stk» are read as a
                    # column of quantities, and a recorded amount that started where its label
                    # happened to end sat at a different x on every row. TOP, not MIDDLE — a
                    # three-line remark under the label must not drag the amount down with it.
                    ("VALIGN", (0, 0), (-1, -1), "TOP"),
                    ("TOPPADDING", (0, 0), (-1, -1), _PAD_ROW),
                    ("BOTTOMPADDING", (0, 0), (-1, -1), _PAD_ROW),
                    ("LEFTPADDING", (0, 0), (-1, -1), 0),
                    ("RIGHTPADDING", (0, 0), (-1, -1), 0),
                    # air between the number and its unit, so «1» and «Stk» do not touch
                    ("RIGHTPADDING", (1, 0), (1, -1), 4),
                    # the write-in rule, under the amount cell only — one x, one width, and only
                    # on the rows that are actually still to be filled in
                    *[
                        ("LINEBELOW", (1, r), (1, r), 0.5, _WRITE, *_WRITE_DASH)
                        for r, rr in enumerate(rows_in)
                        if rr is not None and not rr.menge
                    ],
                ]
            )
        )
        return t

    # ⚠️ Each half is its OWN table inside one outer row. Sharing rows across the fold meant a
    # material with a four-line remark stretched the row on the FAR side too, and from there
    # down the two columns no longer sat on the same baselines — the sheet looked broken even
    # though every value was right. Independent columns simply flow past each other.
    return _two_up(mittel, column, label_w + amt_w + unit_w)
