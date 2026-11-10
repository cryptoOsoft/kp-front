"""The Rapport's payload models — what the client sends, validated and bounded.

Split out of the former ``report_pdf.py``; rules for this area: docs/rapport.md.
"""

from __future__ import annotations

import re
from typing import Literal

from pydantic import BaseModel, ConfigDict, field_validator, model_validator

from ..report_board import BoardPageIn
from .labels import L

# ----------------------------------------------------------------------------- payload models


#: Helvetica has no glyph for a pictograph, so ReportLab draws a black box — and only on the
#: PAPER, which is where nobody sees it until it is in their hand. The app blocks these where
#: text is typed (`src/lib/format.ts` · stripUnprintable), but that reach stops at text WE own:
#: the Stichwort, the Kategorie and the address arrive from the alerting system exactly as the
#: ELZ wrote them, and nobody at this station can edit them in a field the guard covers. Those
#: are stripped here instead. Everything a human typed keeps the input-side guard — a rapport
#: must print what was written, not a version of it this file decided on.
_PICTOGRAPHS = re.compile(
    "[\U0001f000-\U0001faff\u2190-\u21ff\u2300-\u27bf\u2b00-\u2bff\ue000-\uf8ff\ufe00-\ufe0f\u200d\u20e3]"
)


def _strip_pictographs(v: str | None) -> str | None:
    """Drop emoji/dingbats and the joiners that glue them together, then close the gap.

    A value that is NOTHING BUT pictographs is left alone: a sheet whose Stichwort prints as a
    box is bad, a sheet whose Stichwort is blank is worse — the box at least says something was
    sent. Emptying a field is never the better answer on a form that gets signed.
    """
    if not v:
        return v
    return re.sub(" {2,}", " ", _PICTOGRAPHS.sub("", v)).strip() or v.strip()


class PartnerContact(BaseModel):
    org: str | None = None
    name: str | None = None
    phone: str | None = None
    note: str | None = None


class ReportMetaIn(BaseModel):
    #: dispatch text, not ours to edit — see _strip_pictographs
    _no_emoji = field_validator("alarmText")(_strip_pictographs)

    alarmText: str | None = None
    summary: str | None = None
    endedAt: str | None = None  # already display-formatted by the client
    remarks: str | None = None
    lehren: str | None = None
    kontaktperson: str | None = None
    #: their phone number — printed beside the name so the callback in the Nachbearbeitung
    #: (the owner who has to be reached tomorrow) is on the paper, not in someone's memory
    kontaktpersonTelefon: str | None = None
    #: «Entfällt» — the Kontaktperson was ANSWERED, not left open (src/lib/workspace.ts). The
    #: Fehlalarm in an empty Altersheim and the Ölspur on a Kantonsstrasse have nobody to name,
    #: and on a signed sheet that must not read like a field somebody forgot: the row then prints
    #: the word instead of the empty write-in rule.
    kontaktpersonNone: bool = False
    einsatzleiter: str | None = None
    kommandant: str | None = None  # station Kdt from the deployment config (identity.kommandant)
    alarmiertAt: str | None = None
    ausgeruecktAt: str | None = None
    partnerContacts: list[PartnerContact] = []
    gerettete: str | None = None  # pre-formatted, e.g. "2 Personen · 1 Tier"
    rueckmeldungElz: str | None = None  # pre-formatted, e.g. "Muster Hans · 17:15"
    #: «Entfällt» for the Rückmeldung ELZ — the same deliberate answer as ``kontaktpersonNone``,
    #: for the Einsatz the ELZ was never told about because there was nothing to tell.
    rueckmeldungNone: bool = False
    # Alarmierungs-/Ausrückzeiten grid rows, pre-formatted [label, value] pairs — one row
    # per configured Gruppe/Fahrzeug, value empty where nothing was recorded (the composer
    # prints `__:__` there for the pen). See metaExtrasForPdf in src/lib/report.ts.
    zeiten: list[list[str]] = []
    erfasser: str | None = None  # who recorded via the capture view (comma-joined)


class IncidentFacts(BaseModel):
    #: ⚠️ Stichwort, Kategorie and Adresse come from the ELZ verbatim — see _strip_pictographs.
    #: The title is set 20pt at the top of the sheet, so a box there is the loudest one there is.
    _no_emoji = field_validator("title", "type", "address")(_strip_pictographs)

    title: str
    type: str | None = None  # the Einsatz KATEGORIE (wizard «Kategorie»); the Stichwort is `title`
    address: str | None = None
    id: str
    #: An Übung must be legible AS an Übung on the paper. It is excluded from the statistics, so
    #: a drill rapport that looks like a deployment puts paper and data in disagreement — and
    #: nothing else on the sheet distinguishes the two.
    isExercise: bool = False
    #: The number WinFAP and the cantonal statistics are joined on — the alerting system's own
    #: reference for the alarm («fwo-sms-761610d931ac»), whose short form is its FIRST four hex.
    #: Filled server-side in ``api.report.compose_report_from_payload``, never by the client:
    #: the pool row that carries it is the authority, and a number typed into WinFAP from this
    #: sheet has to be the one the exporter sends.
    alarmRef: str | None = None


class JournalRowIn(BaseModel):
    timeLabel: str
    area: str
    text: str
    #: The entry with its linked terms wrapped in ``<b>`` — people, Mittel, Partnerorganisationen,
    #: Fahrzeuge, Alarmgruppen (see src/lib/journalLinks). Absent when nothing was linked, and
    #: then ``text`` prints verbatim as it always did.
    #:
    #: ⚠️ Already escaped by the client, because only the client can tell its own markup from an
    #: «&» somebody typed. It is therefore NOT run through ``_esc`` again here — it goes through
    #: ``safe_markup``, which keeps that escaping and drops every tag outside the app's own
    #: vocabulary (ReportLab markup can read files; see the class comment there).
    markup: str | None = None
    transcript: str | None = None
    #: a memo transcribed in SECTIONS — one pre-formatted line per section, offset-prefixed
    #: («0:05  Rückzug eingeleitet»). Preferred over ``transcript`` when present; that field
    #: still carries the joined words so an older server prints something.
    transcriptLines: list[str] = []
    #: how often this line repeated within the client's repeat window (src/lib/verlauf ·
    #: repeatRuns). >1 prints as a «6×» marker after the entry — the repeats themselves stay in
    #: the append-only record; a sheet that prints the same sentence twenty times is unreadable.
    repeats: int | None = None
    #: A corrected line prints as latest wording + a muted «korrigiert HH:MM · ursprünglich: …»
    #: sub-line — the record's first wording; intermediate revisions stay unprinted (the journal
    #: store keeps them all, the paper shows where it started and where it ended, 19.08.).
    correctedAt: str | None = None  # client-formatted HH:MM of the LAST correction
    textOriginal: str | None = None
    #: the row reached the record after the Einsatzende — written after the close, or written
    #: before it and received after it (src/lib/report · journalRows, `receivedAfterClose`). The
    #: paper marks it the way the app does (D4, 25.09.2026: the flag was computed and dropped).
    nachtrag: bool = False
    photoKey: str | None = None  # legacy: figure key of a client-uploaded photo
    photoUrl: str | None = None  # single photo — the shape rows written before 2026-08-06 carry
    #: several photos on one row (one damage is rarely one picture). Readers take both.
    photoUrls: list[str] = []


class PendenzNoteIn(BaseModel):
    """One Meldung on an open item — an indented sub-line under its «Was»."""

    timeLabel: str
    text: str


class PendenzRowIn(BaseModel):
    """One Auftrag / Pendenz, derived by the client from the append-only journal.

    The columns are the BGV form's (KKO BS / KFS BL 2022-09 «AUFTRÄGE / PENDENZEN»): Was · Wer ·
    Erteilt · Erledigt. Two of them fall out of the record for free — ``erteilt`` is the entry's
    own timestamp, ``erledigt`` the timestamp of the row that closed it — which is why this prints
    without anybody filling a form in.

    ⚠️ No Prio COLUMN. Priority is two-state, so a column for it would be blank on almost every
    row while taking the width «Was» needs; ``urgent`` prints as a short marker before the text
    instead, where the reading actually happens.
    """

    text: str
    #: «Wer» — the first vocabulary name in the sentence, not a field anybody filled in
    assignee: str | None = None
    urgent: bool = False
    erteilt: str  # client-formatted HH:MM (or the full stamp when the Einsatz spans days)
    #: absent ⇒ still open at the Einsatzende, and the cell prints «offen». That is the whole
    #: point of the section: what somebody still has to take away from the incident.
    erledigt: str | None = None
    #: HH:MM of the Erinnerung, when the item carried one — the latest Wiedervorlage, the same
    #: value the pinned block runs on. Prints as a sub-line under «Was»; a column would be blank
    #: on every untimed row (same reasoning as Prio above).
    faellig: str | None = None
    notes: list[PendenzNoteIn] = []


class KrokiEntityIn(BaseModel):
    """One placed tactical symbol for the server-rendered Kroki. Dynamic glyphs
    (live vehicles, placards) arrive as the client-resolved SVG string."""

    coord: list[float]  # [lng, lat] WGS84
    #: only on an entity a Leitung is attached to — what `KrokiDrawingIn.startAt/endAt` name
    id: str | None = None
    symbol: str | None = None
    symbolSvg: str | None = None
    kind: str = "symbol"
    rotation: float | None = None
    floor: int | None = None
    floorFrom: int | None = None
    floorTo: int | None = None
    count: int | None = None
    spread: dict | None = None  # {h: 'E'|'W', hBounded, up, down, vBounded}
    caption: str | None = None
    #: «Gelöscht / erledigt» (client lib/objectDone): the HH:MM the symbol was declared over. The
    #: glyph prints GREY with this time in its top-left corner (kroki · _place_symbol /
    #: _symbol_badges); the legend's word («gelöscht 20:40») already rides in `caption`.
    done: str | None = None
    sizeM: float | None = None  # generic shapes: ground size in metres (client shapePx)
    # which generic shape — the size and aspect limits are per kind (app/kroki.py), because a
    # Rotation is a run across the map and far leaner than any box
    shape: str | None = None
    # generic shapes: height/width ratio (client sends it only when != 1); without this
    # field pydantic would silently drop it and every Rechteck would print square
    aspect: float | None = None
    color: str | None = None  # team dot colour / note ink
    # free-text note styling. noteW (SCREEN px, since map notes don't scale with zoom) is what
    # makes a note a wrapping text box; absent = the legacy one-line pill.
    noteW: float | None = None
    noteSize: str | None = None  # 's' | 'm' | 'l'
    notePlain: bool = False


class KrokiLineEndIn(BaseModel):
    """An end attached to ANOTHER Leitung's end (`KrokiDrawingIn.id`) — see kroki · _snap_line_joints."""

    id: str
    endpoint: str = "end"  # 'start' | 'end' of the TARGET line
    #: 0..2 when the target is a Teilstück: which of the fork's three prongs this branch leaves from
    port: int | None = None


class KrokiDrawingIn(BaseModel):
    """One Lage drawing (client src/types.ts Drawing, incl. FKS hose-line decor)."""

    kind: str  # 'line' | 'area' | 'circle'
    coords: list[list[float]] = []
    color: str | None = None
    width: float | None = None
    dashed: bool = False
    arrow: bool = False
    marker: str | None = None
    label: str | None = None
    showDistance: bool = False
    fillOpacity: float | None = None
    # Schraffur instead of a wash — the FKS reading of an AFFECTED area (client lib/draw). A field
    # pydantic does not know is dropped silently, which is how the paper lost the hatch entirely.
    hatch: bool = False
    radiusM: float | None = None
    teilstueck: bool = False
    #: the `KrokiEntityIn.id` this end is ATTACHED to. The client has already resolved the end,
    #: but against a fixed ground footprint; the renderer re-couples it to the glyph as printed
    #: (kroki · _snap_attached_ends). Absent = a free end, drawn where it is.
    startAt: str | None = None
    endAt: str | None = None
    #: only on a line another line is attached to — what `startAtLine` / `endAtLine` name
    id: str | None = None
    startAtLine: KrokiLineEndIn | None = None
    endAtLine: KrokiLineEndIn | None = None
    lineNo: int | None = None
    content: str | None = None
    floorTag: int | None = None
    # the Atemschutz-Trupp working this Leitung, resolved + abbreviated by the client (the server
    # has no Trupp records to match against). Printed as the last part of the end tag.
    trupp: str | None = None


class KrokiIn(BaseModel):
    """The Kroki as DATA — the server stitches tiles + draws everything (app/kroki.py)."""

    entities: list[KrokiEntityIn] = []
    drawings: list[KrokiDrawingIn] = []
    # explicit extent (operationalExtentPoints) — empty → derived from the scene
    fitPoints: list[list[float]] = []
    # «aktuelle Ansicht»: explicit centre + zoom win over the fit
    center: list[float] | None = None
    zoom: float | None = None
    # literal MapLibre viewport [west, south, east, north] — preferred over center/zoom
    bounds: list[float] | None = None
    maxTileZoom: int | None = None
    #: The active base layer's XYZ template, as the operator's map had it. ⚠️ A caller string,
    #: and the server fetches from it — every read of this field goes through
    #: ``kroki.approved_tile_template`` first, which answers with the empty template (grey base)
    #: for anything that is not one of this deployment's known providers (SEC-03, 05.09.).
    tiles: str | None = None
    attribution: str = "© CARTO, © OpenStreetMap-Mitwirkende"


class PlanAnnoIn(BaseModel):
    """One Whiteboard annotation on a plan page (relative 0..1 coords)."""

    kind: str  # 'draw' | 'area' | 'symbol' | 'text' | 'resource'
    x: float | None = None
    y: float | None = None
    pts: list[list[float]] | None = None
    color: str | None = None
    width: float | None = None
    dashed: bool = False
    fillOpacity: float | None = None
    # an `area` hatched instead of washed (the same flag KrokiDrawingIn carries). A `circle` or a
    # `shape` needs none: the client bakes its Schraffur into the symbolSvg it resolves.
    hatch: bool = False
    label: str | None = None
    text: str | None = None
    symbol: str | None = None
    symbolSvg: str | None = None
    rotation: float | None = None
    #: a `north` dial's bearing (floor-stack pages: the operator-dialled view angle). ⚠️ Has to be
    #: DECLARED: an undeclared field is dropped on validation, and until 18.09.2026 this one was —
    #: so kroki · _overlay_board_annos read no `deg` and every turned Gebäude page printed a dial
    #: claiming north-up.
    deg: float | None = None
    # --- symbol badges, the same decor the Kroki prints (KrokiEntityIn) and the board shows ---
    #: signed STOREY badge (+2 / 0 / -1). ⚠️ `storey`, not `floor`: on a plan anno `floor` is
    #: the Gebäude floor-stack's TILE INDEX (client types.ts · BoardAnno), and the client lifts
    #: that into page coordinates before sending — the server has no floor model. Absent on
    #: floor-stack pages by design: there the sheet a symbol sits on already is its storey.
    storey: int | None = None
    #: lower / upper storey of a vertical span (stairs, lift) — printed as a `-1/+3` range badge
    #: in the storey's slot. Placed on the object, so it prints on floor-stack pages too.
    floorFrom: int | None = None
    floorTo: int | None = None
    #: quantity badge at the bottom-right; 1 or absent = no badge
    count: int | None = None
    #: the words the board shows UNDER the glyph — already composed by the client (lib/symbols ·
    #: symbolCaptionText, the same call the Kroki payload makes), newline-separated for a
    #: multi-line caption. The page prints them as a numbered disc + a legend line, never as a
    #: chip: three chips within a few centimetres of one another on a plan are as unreadable on
    #: paper as they were on the 08.08. Kroki, and a plan has no zoom.
    caption: str | None = None
    #: «Gelöscht / erledigt» — the same field, the same print as `KrokiEntityIn.done`: on a Modul
    #: sheet and on every Gebäude storey the symbol stays, greyed, with the time
    done: str | None = None
    #: FKS Entwicklung arrows around the glyph — {left, right, up, down, …Bounded} (+ the legacy
    #: {h, hBounded, vBounded} shape); see kroki._spread_dirs
    spread: dict | None = None
    # generic shapes (Pfeil/Rauch/Rechteck) arrive as kind 'symbol' with a client-resolved
    # svg + their size as a fraction of the plan width (overrides the fixed symbol size)
    sizeN: float | None = None
    shape: str | None = None  # which generic shape — see KrokiEntityIn.shape
    # generic shapes: height/width ratio (only sent when != 1, see KrokiEntityIn.aspect)
    aspect: float | None = None
    # free-text note styling. wN (a fraction of the plan width, like sizeN) is what makes a note
    # a wrapping text box; absent = the legacy one-line pill.
    wN: float | None = None
    noteSize: str | None = None  # 's' | 'm' | 'l'
    notePlain: bool = False


class PlanPageIn(BaseModel):
    """An annotated Objektplan: the server loads the PDF from its own reference store
    (`url` = /api/reference/<dataset_id>) and renders page 1 + annotations."""

    label: str
    #: the muted line under the heading — which Einsatz, which moment (client-formatted, like
    #: `ReportPayload.krokiCaption`)
    caption: str | None = None
    url: str | None = None
    #: 0-based page of the PDF – a floor-pack sheet is one page of its Modul-6 PDF
    page: int = 0
    annos: list[PlanAnnoIn] = []
    # Gebäude floor-stack pages have no PDF: a white base of this aspect (h/w) instead,
    # with outline/labels/dial travelling as regular annos (composed client-side)
    blankAspect: float | None = None


class ReadingIn(BaseModel):
    t: str
    kindLabel: str
    bar: str | None = None


class CrewChangeIn(BaseModel):
    t: str
    text: str


class TruppCycleIn(BaseModel):
    """One deployment of a Trupp: its Eintritt/Austritt, the crew that went in («Meier Anna /
    Dürring Jan», already joined by the client), and what changed about that crew while it ran,
    as dated lines — see lib/report · truppCrewHistory."""

    entry: str
    exit: str | None = None
    crew: str = ""
    changes: list[CrewChangeIn] = []


def _trupp_heading(tr: TruppIn) -> str:
    """«Trupp 1 – Meier Anna»; «Trupp 3 (zuerst Trupp 1) – Meier Anna» for a renumbered Trupp;
    the bare name for a payload without a number (an older client)."""
    if tr.no is None:
        return tr.name
    leader = tr.leader or tr.name
    former = [n for n in tr.formerNos if n != tr.no]
    if former:
        nos = ", ".join(f"Trupp {n}" for n in former)
        return L["truppHeadingFormer"].format(no=tr.no, former=nos, leader=leader)
    return L["truppHeading"].format(no=tr.no, leader=leader)


class TruppIn(BaseModel):
    name: str
    #: The Trupp's number and its Gruppenführer AT REGISTRATION (docs/trupp-naming.md §5) — the
    #: heading prints «Trupp 1 – Meier Anna». Absent on a payload from an older client, whose
    #: heading is the bare name as before.
    no: int | None = None
    leader: str | None = None
    #: The numbers this Trupp carried before a merge renumbered it (25.09.2026, lib/truppNumbers):
    #: the heading then reads «Trupp 3 (zuerst Trupp 1) – Meier Anna». Empty for every other Trupp
    #: and on an older client's payload.
    formerNos: list[int] = []
    #: The crew per deployment cycle, replacing the «AdF n» rows and the Eintritt/Austritt rows
    #: when present: each cycle names who went in, and the changes fall into the cycle they
    #: happened in. Empty on an older client's payload — the old rows print then.
    cycles: list[TruppCycleIn] = []
    #: Sent by the client, deliberately NOT printed: a rapport is written after the fact, and
    #: «Im Einsatz» on a finished Einsatz asserts something that stopped being true before the
    #: sheet came out of the printer. Optional so a client may stop sending it.
    statusLabel: str = ""
    members: list[str] = []
    auftrag: str | None = None
    ziel: str | None = None
    lineNumber: str | None = None
    #: The Ausrüstung the crew took in, already resolved to labels client-side («Retthaube, WBK»,
    #: lib/report · truppEquipmentLabels). Absent on an older client or where nothing was recorded.
    equipment: str | None = None
    #: EVERY Eintritt / Austritt this Trupp's log records, oldest first — a crew that went in,
    #: came out and was sent in again has two of each. Read off the appended rows client-side
    #: (lib/report · truppRunTimes), never off the card's live `entryTime`/`exitTime`: those hold
    #: the LAST cycle only, so the header used to print one pair over a table showing another.
    entryTimes: list[str] = []
    exitTimes: list[str] = []
    #: The Anmeldung(en) of this Trupp — read ONLY by the «Nicht eingesetzt» line, which is the
    #: one row that has no Eintritt to pair its Draussen stamp with. Optional: a log written
    #: before 09.08. carries no `registered` row, and that line then prints as it always did.
    registeredTimes: list[str] = []
    #: legacy single-cycle fields, kept so a payload queued by an older client (a print job
    #: waiting in the relay across a deploy) still composes. Folded into the lists on validation.
    entryTime: str | None = None
    exitTime: str | None = None
    readings: list[ReadingIn] = []

    @model_validator(mode="after")
    def _fold_legacy_times(self) -> TruppIn:
        if not self.entryTimes and self.entryTime:
            self.entryTimes = [self.entryTime]
        if not self.exitTimes and self.exitTime:
            self.exitTimes = [self.exitTime]
        return self


#: A free remark rides inside a fixed-width table cell. ReportLab cannot split a cell across
#: pages, so a long enough one raises LayoutError and the WHOLE Rapport fails to compose —
#: a pasted paragraph made the report unprintable with an error naming no field. Printing must
#: never be blocked by what someone typed, so an over-long remark is TRUNCATED, not rejected:
#: rejecting would only move the failure to a 422, and the data is already in the workspace.
_NOTE_MAX = 400


def _clip_note(v: str | None) -> str | None:
    if v is None or len(v) <= _NOTE_MAX:
        return v
    return v[: _NOTE_MAX - 1].rstrip() + "…"


#: What a remark may occupy ON PAPER, which is a different question from what will crash the
#: composer. `_NOTE_MAX` is the crash guard; at 400 characters a remark still wraps to four lines
#: of 6.5pt in a ~62mm label column, and one such row measured 45pt tall against 13.6pt
#: neighbours — it stretched its own column's rhythm so far that the two halves of the Material
#: block visibly stopped sharing baselines. Two lines is what the row can carry.
_NOTE_PRINT_MAX = 110


def _clip_print(v: str) -> str:
    """Clamp a remark to what fits two printed lines. Never rejects — printing must not depend
    on what somebody typed (form model 2026-07-17); the full text lives in the workspace."""
    return v if len(v) <= _NOTE_PRINT_MAX else v[: _NOTE_PRINT_MAX - 1].rstrip() + "…"


def _alarm_ref_text(ref: str | None) -> str:
    """«7616 · fwo-sms-761610d931ac» — the short form first, because that is the one that
    gets typed into WinFAP's Schadenfall-Nr, then the full reference so the printed slip and
    this sheet can be checked against each other. The short form is the FIRST four hex of
    the suffix, which is what fwo-divera prints on the slip."""
    if not ref:
        return ""
    suffix = ref.rsplit("-", 1)[-1]
    short = suffix[:4] if len(suffix) >= 4 else ""
    return f"{short} · {ref}" if short else ref


#: Cell padding for the pen-writable tick-off/worksheet tables (Personal, Partner, Material).
#: They carried 2.8 / 2.5 / 1.8 — three paddings for one row type, so two visually identical
#: tick-off blocks on the same sheet came out at a 15.0 and a 15.6pt pitch.
_PAD_ROW = 2.8


class PersonalTimeIn(BaseModel):
    """One stretch a person was on scene. Clocks are client-formatted HH:MM (or «02.08. 14:41»
    once the Einsatz runs past midnight)."""

    von: str | None = None
    bis: str | None = None
    #: this clock was DERIVED from the incident's bounds, not recorded by anybody — printed grey
    #: so a signed sheet says which times were measured and which the app worked out. A line that
    #: is grey on both ends is one nobody has to check.
    vonDerived: bool = False
    bisDerived: bool = False


class PersonalRowIn(BaseModel):
    """ONE row per person on the Personal-/Soldblatt, however many times they came and went:
    printed tick when digitally recorded, blank checkbox + write-in stubs otherwise."""

    name: str
    erfasst: bool = False
    #: every stretch, stacked in the time column. It used to be one ROW per stretch, so somebody
    #: who left and came back printed their name twice and was counted twice by anyone reading
    #: down the roster — the sheet answers «who was here», and a name is a person, not a shift.
    times: list[PersonalTimeIn] = []
    #: legacy single-stretch fields, kept so a payload queued by an older client (a print job
    #: waiting in the relay across a deploy) still composes. Folded into `times` on validation.
    von: str | None = None
    bis: str | None = None
    vonDerived: bool = False
    bisDerived: bool = False
    #: free remark on this person for this Einsatz («Fahrer TLF», «abgelöst 21:40») — printed
    #: small under the name, once, because it belongs to the person and not to a stretch
    note: str | None = None
    #: not on the Mannschaftsliste — a Gast, a Nachbarwehr, somebody not yet synced. Printed as a
    #: «Gast» mark behind the name, because the sheet is read weeks later by somebody who cannot
    #: ask: an unmarked guest sitting among our own roster reads as one of ours.
    guest: bool = False

    _clip = field_validator("note")(_clip_note)

    @model_validator(mode="after")
    def _fold_legacy(self) -> PersonalRowIn:
        if not self.times and (self.von or self.bis):
            self.times = [
                PersonalTimeIn(von=self.von, bis=self.bis, vonDerived=self.vonDerived, bisDerived=self.bisDerived)
            ]
        return self


class MittelFormRowIn(BaseModel):
    """One Material worksheet row: the full catalogue prints with amount stubs, recorded
    amounts print bold (client merges catalogue + recorded lines)."""

    label: str
    menge: str | None = None  # client-formatted "3" — None prints the write-in stub
    unit: str = "Stk."
    #: free remark on the line («an Werkhof übergeben») — printed under the label, because a
    #: quantity on its own has never explained what happened to the material. The client JOINS
    #: every source line's remark into this one string, so the cap matters more here than on a
    #: single field (see _clip_note).
    note: str | None = None

    _clip = field_validator("note")(_clip_note)


class MessungRowIn(BaseModel):
    """One reading of a Messpunkt (src/lib/readingLog · readingsForReport): the gas the map's pill
    wore for it, the others of the same radio report beside it. All client-formatted but `stage`,
    which the composer words itself — the Stufe has to read on a monochrome print."""

    time: str
    gas: str
    value: str
    stage: Literal["ok", "a1", "a2", "over", "unreadable"] = "ok"
    others: str = ""


class MessungPointIn(BaseModel):
    """One Messpunkt with its readings, oldest first; the last one is what the head row says."""

    name: str
    #: «UG», «1. OG» — empty when the point carries no Geschoss
    place: str = ""
    rows: list[MessungRowIn] = []


class ReportOptionsIn(BaseModel):
    #: ⚠️ A switch this model does not know is refused (422), not dropped: the client keeps more
    #: options than it sends (src/lib/report · ReportOptions – the framing, the plan choice …
    #: shape the payload itself), and a renamed one must fail loudly instead of printing the
    #: default. Every client build since 19.07.2026 sends a subset of these fields.
    model_config = ConfigDict(extra="forbid")

    kroki: bool = True
    #: Kroki page orientation. A tall Lage (a Hochhaus, a street running north) wasted half a
    #: landscape sheet and printed the map postage-stamp small; the operator picks the shape in
    #: the crop window and the page follows it. Default landscape = the historical behaviour.
    krokiLandscape: bool = True
    atemschutz: bool = True
    attendance: bool = True
    mittel: bool = True
    journal: bool = True
    #: «Aufträge / Pendenzen». ⚠️ Its OWN switch, not part of `journal`: suppressing the long
    #: Einsatzjournal is a normal choice, and the outstanding items are the last thing that should
    #: disappear with it. Defaults True so an older client that sends no option still prints them.
    pendenzen: bool = True
    #: the «Auswertung» Beilage — printed only when the payload also carries its block, so an
    #: older client (which sends neither) prints exactly what it always did
    auswertung: bool = True
    #: the Tafel's pages (10.10.2026, app/report_board) — like `auswertung`, they print only when
    #: the payload carries them, so the default changes nothing for an older client
    tafel: bool = True


class PersonalSummaryIn(BaseModel):
    """Anwesende + Einsatzstunden, computed CLIENT-side where the ISO timestamps are.

    The rows print «19:12 – 21:40»; re-deriving minutes from that formatted clock text here
    would be a second answer that can disagree with the app's. ``hours`` is the raw sum — what
    actually happened — and ``hoursRounded`` the Sold figure (each person rounded up to the next
    ``stepMin`` block once ``graceMin`` past the previous one, then summed).

    The rule itself is deliberately NOT printed (see the ``personalTotals`` label below and
    ``docs/CONFIGURATION.md`` §1b) — it is identical on every rapport a station produces. It used
    to travel here as ``stepMin``/``graceMin`` for a line that was never written; the fields are
    gone rather than left as two numbers nothing reads.
    """

    present: int = 0
    hours: str = ""
    hoursRounded: str = ""
    #: people whose blocks could not be totalled (an end before its start — most often an open
    #: block borrowing an implausible Einsatzende). They are in NEITHER sum, so the sheet has to
    #: say so: a total that quietly leaves people out is worse than one that admits it.
    unresolved: int = 0


class AttachmentIn(BaseModel):
    """One Beilage: a photo that belongs to the REPORT — an ID document, a damage close-up.

    Printed one per row at the end, as large as the page allows, because the reason to
    photograph a document is to be able to READ it afterwards. That is the whole difference to a
    journal photo, which rides small beside its text as an illustration of a timed entry.
    """

    url: str  # server-relative /api/media/<id> — resolved server-side, same as a journal photo
    caption: str | None = None


class AuswertungBarIn(BaseModel):
    """One span on a swimlane, in MINUTES after the axis start (lib/auswertung · auswertungForPdf)."""

    start: float
    end: float
    #: travel · scene · return (a vehicle) · as · work · standby (a Trupp) · phase (a checklist phase)
    kind: str = "work"


class AuswertungGapIn(BaseModel):
    """The part of a contact interval past the Funkkontakt-Intervall: 1 fällig, 2 überfällig."""

    start: float
    end: float
    level: int = 1


class AuswertungLaneIn(BaseModel):
    label: str
    bars: list[AuswertungBarIn] = []
    #: single known instants with no span (a vehicle that rolled and never reported vor Ort)
    marks: list[float] = []
    contacts: list[float] = []
    gaps: list[AuswertungGapIn] = []


class AuswertungGroupIn(BaseModel):
    label: str
    lanes: list[AuswertungLaneIn] = []


class AuswertungTickIn(BaseModel):
    at: float
    label: str


class AuswertungMilestoneIn(BaseModel):
    at: float
    label: str
    time: str = ""


class AuswertungTimelineIn(BaseModel):
    #: the axis length in minutes; every `at`/`start`/`end` is measured from its start
    span: float
    ticks: list[AuswertungTickIn] = []
    groups: list[AuswertungGroupIn] = []
    milestonesLabel: str = "Meilensteine"
    milestones: list[AuswertungMilestoneIn] = []


class AuswertungFigureIn(BaseModel):
    label: str
    #: the finished value — «7 min», «92 %», or «—» when the record does not carry it
    value: str
    sub: str | None = None
    #: the figure's definition, printed as a numbered footnote under the timeline
    footnote: str | None = None
    #: the one figure that is a judgement (contact overruns > 0) — its value prints in the urgent ink
    alert: bool = False


class AuswertungLegendIn(BaseModel):
    travel: str = "Anfahrt"
    scene: str = "vor Ort"
    #: the same ink as `travel` on paper, so the two share one legend entry
    back: str = "Rückfahrt"
    pa: str = "unter Atemschutz"
    work: str = "im Einsatz ohne Atemschutz"
    standby: str = "bereit"
    contact: str = "Funkkontakt"
    faellig: str = "Kontakt fällig"
    ueberfaellig: str = "überfällig"
    milestone: str = "Meilenstein"
    phase: str = "Phase: erster bis letzter Haken"


class AuswertungIn(BaseModel):
    """The «Auswertung» Beilage (F7, 09.10.2026): key figures, swimlanes, Lehren — derived on the
    CLIENT where the ISO stamps are (src/lib/auswertung.ts) and sent as finished strings and minute
    offsets, in the deployment's language. Printed last, on its own landscape sheet."""

    heading: str = "Auswertung"
    note: str | None = None
    figures: list[AuswertungFigureIn] = []
    timeline: AuswertungTimelineIn | None = None
    #: what prints instead of the timeline when nothing on it was recorded
    noTimeline: str | None = None
    legend: AuswertungLegendIn = AuswertungLegendIn()
    footnotesHead: str = "Definitionen"
    #: «Lehren / Sicherheit: siehe Seite 1» when the Lehren are filled. A pointer, not the text:
    #: the Lehren print on page 1 with the signed record (review of #303 — one answer, one place).
    lehrenNote: str | None = None


#: one stroke list of a drawn signature is bounded so a payload can never make the composer draw
#: millions of segments: a real signature is a few dozen strokes of a few hundred points
_SIG_MAX_STROKES = 200
_SIG_MAX_COORDS = 4000


class SignatureStrokesIn(BaseModel):
    """The SHAPE of a drawn signature (lib/reportSignature · SignatureStrokes): integer points
    in a `w`×`h` box, y down, flattened x,y,x,y… per stroke. No timing, no pressure."""

    w: int
    h: int
    d: list[list[int]] = []

    @field_validator("d")
    @classmethod
    def _bounded(cls, v: list[list[int]]) -> list[list[int]]:
        return [s[: _SIG_MAX_COORDS - (_SIG_MAX_COORDS % 2)] for s in v[:_SIG_MAX_STROKES] if len(s) >= 2]


class SignatureIn(BaseModel):
    """A digital signature that still holds, as the client decided (a signature that no longer
    matches the Rapport is simply not sent — its line prints empty)."""

    role: str  # "el" | "kdt"
    name: str = ""
    #: «Oberwil, 15.10.2026» — printed as the value of the row's «Ort, Datum»
    placeDate: str = ""
    #: «15.10.2026 04:12»
    at: str = ""
    #: «3fa9 c210 7be1» — the first digits of the SHA-256 over the signed part
    checksum: str = ""
    strokes: SignatureStrokesIn


class ReportPayload(BaseModel):
    incident: IncidentFacts
    meta: ReportMetaIn = ReportMetaIn()
    options: ReportOptionsIn = ReportOptionsIn()
    generatedAt: str  # client-formatted
    # server-side rendering (the current path): Kroki as data + plan refs
    kroki: KrokiIn | None = None
    krokiCaption: str | None = None
    planPages: list[PlanPageIn] = []
    trupps: list[TruppIn] = []
    # What «überfällig» MEANT on this Einsatz. The Atemschutz protocol is read to judge the
    # contact log — was a gap acceptable, when did the board go red — and that judgement is
    # against an interval the paper never named. It is a per-incident setting on top of a
    # per-station one, so it cannot be looked up afterwards: it travels with the document.
    atemschutzIntervalMin: int | None = None
    atemschutzGraceSec: int | None = None
    # Personal-/Soldblatt: the FULL roster (recorded people ticked), guests appended
    personal: list[PersonalRowIn] = []
    # Material worksheet: full catalogue with stubs, recorded amounts filled
    mittelForm: list[MittelFormRowIn] = []
    # Partnerorganisationen presets — tick-off row when none were recorded digitally
    partnerPresets: list[str] = []
    personalSummary: PersonalSummaryIn | None = None
    journal: list[JournalRowIn] = []
    #: the one date every journal row falls on (client-formatted), when they all do. The rows
    #: then carry the time alone and the date prints once, in the section heading.
    journalDay: str | None = None
    #: Aufträge / Pendenzen — printed right after the Verlauf they are derived from, so a reader
    #: checking one line only turns back a page.
    pendenzen: list[PendenzRowIn] = []
    #: «Messungen» — every Messpunkt with its gas readings (10.11.2026). The Journal carries none
    #: of them (the client leaves the reading rows out), so this table is their place on paper;
    #: printed whenever a point has a reading. `messungenLimits` is the A1/A2 line above it.
    messungen: list[MessungPointIn] = []
    messungenLimits: str | None = None
    attachments: list[AttachmentIn] = []
    #: the internal debrief Beilage — see AuswertungIn
    auswertung: AuswertungIn | None = None
    #: the Tafel's board-template pages, resolved by the client (lib/boardForm · formForPdf)
    boardPages: list[BoardPageIn] = []
    #: the scene for their «Lagekarte» boxes, auto-framed, rendered here at print time
    boardMap: KrokiIn | None = None
    #: drawn signatures on the Visum lines (15.10.2026) — at most one per role, the last wins
    signatures: list[SignatureIn] = []
