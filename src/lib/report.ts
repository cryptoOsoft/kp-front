// The Rapport's content, as pure data: the print options, the Verlauf as journal rows, Pendenzen,
// Trupp words and crew cycles, Personal / Mittel tables and the Kroki framing. No rendering –
// `reportPdfDirect` composes the PDF payload from these, the backend draws it.
// The labels here are ALSO the words on screen (the Atemschutz board, the Journal): the printed
// word and the shown word come from one function, so a view that needs other wording swaps it at
// the view layer, never here.
// Rules for this area: docs/rapport.md.

import type { AttendanceState, BoardDoc, Drawing, Entity, LngLat, MittelEntry, PlanDocument, TimelineEvent, Trupp, TruppReading } from '../types'
import type { FahrzeugZeit, GruppeZeit, PartnerContact, ReportMeta } from './workspace'
import { allAuftragTypes, appConfig } from '../config/appConfig'
import { fmtDistance } from './geo'
import { fillTemplate, fmtDuration, hhmm, pad2, restoreUmlauts, unitLabel, compareText, formatLocale } from './format'
import { fahrzeugRows, gruppenRows } from './alarmzeiten'
import { fahrtenText } from './vehiclePresence'
import { intervalsOf, mergeCloseBlocks } from './attendanceIntervals'
import { truppNeverDeployed } from './atemschutz'
import { atemschutzEquipment, attendanceMergeGapMin, getDeploymentConfig } from './deploymentConfig'
import { mittelReportRows } from './mittel'
import { isNachtrag, repeatRuns, rowPhotos, rowText } from './verlauf'
import { linkMarkup, type JournalLink } from './journalLinks'
import { jsonEqual } from './jsonEqual'

export interface KrokiView {
  center: LngLat
  zoom: number
  /** Exact north-up MapLibre viewport: [west, south, east, north]. The server uses this
   *  instead of translating camera zoom conventions, so the selected crop is literal. */
  bounds?: [number, number, number, number]
}

export interface ReportOptions {
  kroki: boolean
  /** the framing chosen in the Kroki modal (WYSIWYG crop) — null until picked;
   *  the server auto-fits the annotations only as headless fallback */
  krokiView: KrokiView | null
  /** WHEN the printed Kroki shows. Null = the live picture. An ISO instant reconstructs the
   *  Lage as it stood then (lib/replay · stateAt), which is how a rapport can still show the
   *  Rettung that has long since left — and the caption then names that moment, so the sheet
   *  never claims to be «Stand jetzt» while showing something else. */
  krokiAt: string | null
  /** Kroki page shape. A tall Lage in a landscape frame prints postage-stamp small with white
   *  down both sides; seeded from the crop's own aspect and overridable in the framing modal. */
  krokiLandscape: boolean
  annotatedPlans: boolean
  allPlans: boolean
  /** the Gebäude floor stack — its OWN section, not one of the «Pläne» (see defaultReportOptions) */
  gebaeude: boolean
  atemschutz: boolean
  attendance: boolean
  mittel: boolean
  journal: boolean
  /** «Aufträge / Pendenzen» — its OWN section, deliberately not folded into `journal`: dropping
   *  the long Einsatzjournal is a normal choice, and the outstanding items are the last thing
   *  that should go with it. */
  pendenzen: boolean
  /** print the Rapport-Beilagen (document/damage photos) as full-width plates at the end */
  attachments: boolean
  detailedAudit: boolean
  /** the «Auswertung» Beilage — key figures, swimlanes, Lehren (lib/auswertung). Internal: it
   *  prints on its own landscape sheet at the very end, after everything that gets signed. */
  auswertung: boolean
  /** the Tafel's pages (10.10.2026): every board-template page in its own layout, and the
   *  Skizze when it carries ink. Optional, because a draft saved before it existed lacks it —
   *  absent reads as ON (reportPdfDirect · `tafel !== false`). */
  tafel?: boolean
}

export const defaultReportOptions: ReportOptions = {
  // ⚠️ The SHEET overrides this from the live scene (`kroki: mapContentCount > 0`) — a rapport
  // with nothing drawn prints no empty map. This stays true for the callers that have no scene
  // to judge by (the QR-Erfassung's own PDF), where the option is moot anyway.
  kroki: true,
  krokiView: null,
  krokiAt: null,
  // ⚠️ HOCH. The rapport is a portrait document; a landscape Kroki turns the one page people
  // actually look at sideways in the middle of the stack. See ReportPreflight for the same
  // default on the sheet itself.
  krokiLandscape: false,
  // ⚠️ OFF (18.09.2026). The Kroki is the rapport's picture; an Objektplan is reference material
  // the station already owns, and a linked sheet counts as «annotated» the moment the Karte's
  // objects project onto it — so «on when there are any» stapled every linked plan to every
  // rapport. The operator adds them from the ▾ menu when a sheet carries work of its own.
  annotatedPlans: false,
  allPlans: false,
  // ⚠️ Its own section, and ON (18.09.2026). It used to ride the «Pläne» switch, but it is the
  // opposite kind of page: an Objektplan is reference material the station already owns, the
  // Gebäude carries the Einsatz's own work — where each Trupp stood, on which storey. Same
  // reasoning as `pendenzen`: not seeded from a count read once at mount, because the payload
  // simply carries no page while no storey has anything on it (reportPdfDirect · floorStackPages).
  gebaeude: true,
  atemschutz: true,
  attendance: true,
  mittel: true,
  journal: true,
  // ⚠️ ITS OWN section, not a part of the Verlauf. It was gated on `journal` at first, and that is
  // wrong twice over: suppressing the long Einsatzjournal is a common and reasonable choice, and
  // the one thing you would never want to drop with it is the list of what is still outstanding.
  pendenzen: true,
  attachments: true,
  detailedAudit: false,
  // ⚠️ OFF by default (owner, 10.10.2026), and the sheet no longer seeds it from the record (it
  // was «ticked when a crew went in under PA» on 09.10.): an internal debrief is something to
  // ASK for. Its own last sheet, so the signed part goes out without it; the operator's own tick
  // is kept per Einsatz (ReportPreflight · optionOverrides). The QR-Erfassung's PDF has it off too.
  auswertung: false,
  // ON: the Erste Führung is the Einsatz's own work, like the Gebäude; a Tafel with nothing on it
  // simply carries no page (reportPdfDirect · tafelPayload)
  tafel: true,
}

export interface AuditProof {
  intact: boolean | null
  brokenAtSeq?: number | null
  count?: number
  head?: string
  checkedAt: string
  offline?: boolean
}

export interface ReportDraft {
  meta: ReportMeta
  generatedAt: string
  proof: AuditProof
  options: ReportOptions
}

export function hasVisiblePlanAnnotation(board: BoardDoc, planId: string): boolean {
  return (board[planId] ?? []).some((a) => {
    if (a.kind === 'text') return !!(a.text ?? '').trim()
    if (a.kind === 'draw' || a.kind === 'area') return Array.isArray(a.pts) && a.pts.length > 0
    if (a.kind === 'circle') return (a.radiusN ?? 0) > 0
    if (a.kind === 'symbol' || a.kind === 'shape' || a.kind === 'resource') return true
    return false
  })
}

/** ⚠️ `board` is the WHOLE answer: a sheet's list is its own annos plus the Karte's objects
 *  projected onto it (lib/useObjectStore · board), so a plan whose only marks come from the map
 *  counts as annotated by construction. It used to take a second list beside this one, and the
 *  two then had to be concatenated everywhere — which is how every anno came to print twice. */
export function annotatedPlans(plans: PlanDocument[], board: BoardDoc, includeAll: boolean): PlanDocument[] {
  // the Gebäude floor stack is not a «Plan» on paper — it has its own section (options.gebaeude)
  const sheets = plans.filter((p) => !p.floorStack)
  return includeAll ? sheets : sheets.filter((p) => hasVisiblePlanAnnotation(board, p.id))
}

export function planLabel(plan: PlanDocument | undefined, floor?: number): string {
  const fallback = appConfig.copy.report.planFallback
  if (!plan) return fallback
  if (plan.floorStack && floor != null) {
    const c = appConfig.copy.floor
    const label = floor === 0 ? c.eg : floor > 0 ? fillTemplate(c.og, { n: floor }) : fillTemplate(c.ug, { n: Math.abs(floor) })
    return `${plan.code} ${label}`
  }
  return plan.code || plan.title || fallback
}

export function eventIso(e: TimelineEvent, fallbackDate?: string): string | null {
  if (e.at) return e.at
  if (!fallbackDate || !/^\d{2}:\d{2}$/.test(e.t)) return null
  const d = new Date(fallbackDate)
  if (Number.isNaN(d.getTime())) return null
  const [hh, mm] = e.t.split(':').map(Number)
  d.setHours(hh, mm, 0, 0)
  return d.toISOString()
}

// ⚠️ NOT the ↶/↷ rows any more (staging walk-through, 25.09.2026): the Verlauf is append-only, so
// a taken-back act is TWO rows, and the paper has to print both — with only the first, the
// printed Einsatzjournal said «Symbol «Feuer» gesetzt» about a fire the Kroki beside it did not
// show. `journalRows` prints `kind: 'history'` rows for the same reason.
const OMIT_TEXT = [
  appConfig.copy.log.objectMoved.replace('{name}', ''),
]

/** Does the act this ↶ / ↷ row names print a row of its own? The row is «{action} rückgängig
 *  gemacht» / «{action} wiederhergestellt» (copy · log.undoNamed / redoNamed); the action is held
 *  to the same rule its own row is printed by. A row that names no action (the generic «Aktion
 *  rückgängig gemacht», a domain word) cannot be matched and prints — it is the record's only
 *  statement that something was taken back. */
function historyCountersPrintedRow(e: TimelineEvent): boolean {
  const text = e.text.trim()
  for (const tpl of [appConfig.copy.log.undoNamed, appConfig.copy.log.redoNamed]) {
    const [, suffix = ''] = tpl.split('{action}')
    if (suffix && text.endsWith(suffix)) {
      const action = text.slice(0, text.length - suffix.length).trim()
      return !action || printableTacticalText({ ...e, text: action })
    }
  }
  return true
}

function printableTacticalText(e: TimelineEvent): boolean {
  const text = e.text.trim()
  if (!text) return false
  if (OMIT_TEXT.some((p) => p && text.includes(p))) return false
  if (/verschoben$/i.test(text)) return false
  return true
}

export interface JournalPrintRow {
  id: string
  iso: string | null
  timeLabel: string
  area: string
  text: string
  kind?: TimelineEvent['kind']
  photoUrls?: string[]
  audioUrl?: string
  transcript?: string
  /** a memo transcribed in sections: one line per section, offset-prefixed («0:05  Rückzug …»).
   *  `transcript` still carries the joined words so an older server prints something. */
  transcriptLines?: string[]
  /** the entry with its linked terms in <b>…</b>, for the PDF. Absent when nothing is linked —
   *  the composer then prints `text` verbatim, as it always did. */
  markup?: string
  /** row was appended AFTER the Einsatzende (closed_at) — printed under «Nachträge» */
  nachtrag?: boolean
  /** HH:MM of the LAST correction + the FIRST wording — the print shows both («korrigiert
   *  HH:MM · ursprünglich: …») and skips intermediate revisions. Absent on untouched rows. */
  correctedAt?: string
  textOriginal?: string
  /** how often this line repeated within the repeat window (lib/verlauf · repeatRuns). >1 prints
   *  as «6×» after the entry; the repeats themselves are in the record, not on the paper. */
  repeats?: number
}

/** ReportLab's Paragraph takes a tiny HTML subset, so anything that is not our own markup has
 *  to be escaped before it goes in — an «&» or a «<» in a note would otherwise break the row.
 *  Quotes too: this escaper also fills ATTRIBUTE positions (`linkMarkup` puts it inside
 *  `href="…"`), where an unescaped «"» ends the attribute and whatever follows becomes markup.
 *  «'» as the numeric «&#39;» — every XML/HTML parser takes it, unlike the XML-only «&apos;». */
const escapeXml = (v: string) => v
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;').replace(/'/g, '&#39;')

/**
 * The «Bereich» column: WHERE in the app this entry came from.
 *
 * ⚠️ `kind` alone cannot answer this and never could. `'team'` is written by the Atemschutz
 * board, by Anwesenheit, by Mittel, by a role note and by the live-position sharing switch — so
 * every one of them printed as «Atemschutz» — and everything with no kind at all fell through to
 * the map, which is how a change to the Rapportangaben came out under «Kroki» with the entry
 * «Rapportangaben: Einsatzleiter Meier Anna» (08.08. Einsatz). The `icon` is what actually
 * separates those writers, so the two are read together.
 *
 * The names are the app's own surface names (copy.modes), so a reader looking for the row can go
 * to the surface it names. Nothing here is stored — an old record classifies the same way a new
 * one does, because the rule reads only fields both have.
 */
export function journalArea(e: TimelineEvent, plans: PlanDocument[]): string {
  const r = appConfig.copy.report
  // ── the rows the SERVER wrote about the incident itself, before anything else ──
  // «Rapport abgeschlossen», «Einsatz abgeschlossen», «Einsatz wiedereröffnet» carry neither
  // `kind` nor `surface` (backend · journal.append_system_row), so until 04.09. every one of
  // them fell through the whole chain to `areaLage` and printed as «Kroki Rapport
  // abgeschlossen» — a Bereich that sends the reader to the map for an act performed in the
  // Rapport. The `sys` id prefix is the handle: the server mints it, no client id starts with
  // it (lib/ids · newId, IncidentWorkspace · pushEvent), and it is already on every such row
  // in every existing record — which an append-only journal needs, because these rows can
  // never be rewritten to carry a new field.
  if (e.id.startsWith('sys')) return r.areaSystem
  // ── hand-written first, whatever surface it was written on ──
  // a Checklisten-Haken is a documented decision, not a free note — and it is the only other
  // thing `journal` is written for besides the composer
  if (e.kind === 'journal' && e.icon === 'check') return r.areaChecklist
  // …and so is taking one back: its ↶ glyph is shared, the template it was written from is not
  if (e.kind === 'journal' && startsWithTemplate(e.text, appConfig.copy.checklists.milestoneUndone)) return r.areaChecklist
  // ⚠️ A row that WAS given a type says so in this column — and the type was already in the
  // text as a «Auftrag · » prefix, so `withoutAreaPrefix` drops the duplicate from the text.
  // A hand-written row without one is «Info», the composer's own word for the plain entry: the
  // operator who wrote «Info» finds it under «Info» in the filter and on paper (sweep E.5,
  // 23.10.2026 – it used to be a third word, «Manuell»).
  const info = appConfig.copy.journal.entryTypes.info
  if (e.entryType && e.entryType !== 'info') {
    return appConfig.copy.journal.entryTypes[e.entryType] ?? info
  }
  // …and a row raised by the ring is a Pendenz even without a typed tag — on screen the row
  // carries the «Pendenz» chip, so the printed column says the same word. AFTER the entryType
  // branch: an «Auftrag» with an Erinnerung is still an Auftrag. Covers the whole lifecycle
  // (created, Meldung, erledigt) — every one of those rows is about the item.
  if (e.kind === 'reminder' || e.reminder) return appConfig.copy.journal.noteChip
  // ⚠️ …and a divergence the sync merge raised is about the ANWESENHEIT, whatever glyph it wears.
  // Those rows carry icon 'warn' — they ARE a warning, and the Verlauf's disc has to say so
  // (lib/attendanceConflict · conflictRows) — which the icon chain below cannot map, so «Anwesenheit
  // Stich Markus: … bitte prüfen» printed under «Kroki» on the 03.09. Rapport. The `conflict`
  // payload is the honest handle: only the Anwesenheit's rows carry one, both the `raised` and the
  // `resolved` half of the pair, and it is on every such row ever written.
  if (e.conflict) return r.areaAnwesenheit
  if (e.kind === 'audio' || e.kind === 'photo' || e.kind === 'journal' || e.pinned) return info
  // ── then by ICON, which is what actually separates the writers ──
  // ⚠️ Every row the QR poster writes has NO kind at all (lib/captureClient · row), so a rule
  // that went by kind classified all of them as map-tactical. The icon is the only thing the
  // tablet's rows and the poster's rows have in common.
  // ⚠️ …and by TEXT where the icon is shared. The Anwesenheit's undo wrote icon 'undo', which is
  // also the Atemschutz-Rückzug's, so «Anwesenheit zurückgenommen: Studer Corinne» printed under
  // «Atemschutz». New rows carry 'people' (IncidentWorkspace · stepAttendance); this reads the
  // ones already in the record, off the same copy template that wrote them.
  if (startsWithTemplate(e.text, appConfig.copy.anwesenheit.undone)
    || startsWithTemplate(e.text, appConfig.copy.anwesenheit.redone)) return r.areaAnwesenheit
  if (e.icon === 'clipboard') return r.areaRapport
  // Beilage added/removed at the poster. TWO glyphs, one Bereich: 'attach' is what
  // `captureClient` writes since 23.08., 'photo' is what it wrote before — and the record is
  // append-only, so the old rows have to keep classifying as they always did. Same problem, and
  // the same answer, as `startsWithTemplate` below. The split exists for the SCREEN: the Verlauf
  // row's disc is now the whole classification (Journal · journalDisc), and #photo was also the
  // glyph of a composer photo entry, which is «Info» two branches further up.
  if (e.icon === 'attach' || e.icon === 'photo') return r.areaRapport
  // ⚠️ 'clock' means Anwesenheit here and nothing else: the poster's Zeiten rows carry it. Snooze
  // rows carried it too until 23.08., but every one of them has a `reminder` and is answered as
  // «Pendenz» above, so they never reach this line — new ones carry 'bell' (lib/useReminders).
  if (e.icon === 'people' || e.icon === 'user' || e.icon === 'clock') return r.areaAnwesenheit
  if (e.icon === 'box') return r.areaMittel
  // everything else the Atemschutz board writes: Kontakt, Druck, Leitung, Alarm, Sicherheitswerte
  if (e.kind === 'team') return r.areaAtemschutz
  if (e.surface === 'plan') return planLabel(plans.find((p) => p.id === e.planId), e.floor)
  return r.areaLage
}

/**
 * The Verlauf's icon disc, in words: the Bereich as the SCREEN names it, plus which of the two
 * drawing surfaces it is — the disc's tint — or null for everything that is neither.
 *
 * This is what the Bereich chip used to be. The chip printed the word on every row, beside a
 * sentence that already carried it («Auftrag · …») and beside a second chip saying «Pendenz»;
 * the disc says it once, in the one slot every row already has. The word survives here for the
 * disc's title and for the Verlauf's legend.
 *
 * ⚠️ The tint is derived from the RESOLVED Bereich, never from `e.surface`: the generic logger
 * stamps 'map' on everything, which is how a Lage-blue chip once sat under the word «Atemschutz».
 * ⚠️ One name differs between screen and paper on purpose — the print says «Kroki» (the word
 * people search the export for), the tab on screen is called «Lage». See copy · report.areaLage.
 */
export function journalDisc(e: TimelineEvent, plans: PlanDocument[]): { label: string; surface: 'map' | 'plan' | null } {
  const area = journalArea(e, plans)
  if (area === appConfig.copy.report.areaLage) return { label: appConfig.copy.journal.surfaceMap, surface: 'map' }
  const onPlan = e.surface === 'plan' && area === planLabel(plans.find((p) => p.id === e.planId), e.floor)
  return { label: area, surface: onPlan ? 'plan' : null }
}

/** Does this row's text begin with what a copy template writes before its first placeholder?
 *  The only handle on rows whose icon cannot say where they came from — read from the live copy,
 *  so it answers in whatever locale wrote them. */
function startsWithTemplate(text: string, template: string): boolean {
  const prefix = template.split('{')[0].trim()
  return prefix.length > 0 && text.startsWith(prefix)
}

/** Prefixes a printed entry no longer needs, because the Bereich beside it now says the same
 *  thing. The RECORD keeps its wording — it is append-only, and the live Verlauf has no column
 *  to lean on, so «Rapportangaben: …» is exactly right there. Only the printed row drops it —
 *  and the Verlauf row's detail sheet, whose title is the message and whose meta line under it
 *  names the Art / Bereich (Journal · the detail sheet, sweep E.4). Returns '' for a row that is
 *  the bare type tag (see below); the caller decides what stands there instead. */
export function withoutAreaPrefix(text: string): string {
  const prefixes = [
    appConfig.copy.preflight.logMetaChanged,
    appConfig.copy.capture.logMeta,
  ].map((tpl) => tpl.replace('{fields}', '').trimEnd()).filter(Boolean)
  for (const p of prefixes) {
    // ⚠️ The `|| text` fallback stays HERE on purpose. «Rapportangaben» is not the word the
    // column prints («Rapport»), so a row stripped to nothing would leave the line with no
    // content at all and nothing beside it saying what it was.
    if (text.startsWith(p)) return text.slice(p.length).trimStart() || text
  }
  // …and the entry-type tag the composer writes into the text («Auftrag · Trupp 2 sichert»),
  // now that the Bereich column carries the same word. Only the printed row drops it — the
  // record keeps its wording, and the live Verlauf has no column to lean on.
  for (const [key, label] of Object.entries(appConfig.copy.journal.entryTypes)) {
    if (key === 'info') continue
    // ⚠️ The BARE tag counts too. A photo-only entry has no body, so the composer returns the
    // tag alone (lib/journalEntry · composeJournalText) and the row's entire text is the word
    // «Sofortmassnahme» — which printed twice on one line, once here and once in the Bereich.
    // Empty is the right Eintrag: the column carries the word and the picture IS the content,
    // so unlike the meta prefixes above this deliberately does NOT fall back to the text.
    if (text.trim() === label) return ''
    const tag = `${label} · `
    if (text.startsWith(tag)) return text.slice(tag.length).trimStart() || text
  }
  return text
}

/**
 * Paper NAMES the Beilagen a row carries.
 *
 * ⚠️ A generic Beilage (PDF, Dokument) has no plate in the Rapport the way a photo does — the
 * file itself travels in the Beilagen-ZIP. Without this, a row whose only content IS a document
 * printed as an empty timestamped line, and the record lost the one thing it can still say:
 * which document belonged to that moment. Appended to the text, so it reaches the PDF through
 * `markup` (and its escaping) like every other word of the row.
 */
function withFileNames(text: string, files?: { name: string }[]): string {
  if (!files?.length) return text
  const C = appConfig.copy.journal
  const label = fillTemplate(files.length > 1 ? C.attachPrintMany : C.attachPrint, {
    names: files.map((f) => f.name).join(', '),
  })
  return text.trim() ? `${text} · ${label}` : label
}

export function journalRows(
  events: TimelineEvent[], plans: PlanDocument[], fallbackDate?: string, closedAt?: string | null,
  /** `truppIds`: which subjects are Trupps, so a row that enumerates a crew can print the
   *  Gruppenführer alone instead of a Funktion behind every name (journalLinks · linkMarkup ·
   *  crewRow). Rows carry their Trupp in `subjectId` (useTruppActions); one written before that
   *  existed simply keeps every suffix, which is what it printed yesterday. */
  opts?: { includeBookkeeping?: boolean; vocab?: JournalLink[]; truppIds?: ReadonlySet<string> },
): JournalPrintRow[] {
  // …and a line the app repeated while nothing changed prints ONCE, with its count — the same
  // rule the Verlauf reads by, so paper and screen tell the same story (lib/verlauf).
  const repeats = repeatRuns(events)
  return events
    .filter((e) => {
      if (repeats.hidden.has(e.id)) return false
      // attendance/material bookkeeping rows («X anwesend», «Ölbinder: 3 Sack») duplicate
      // the Anwesenheit/Mittel sections — hidden from the default print, shown only with
      // the detailed audit option (then EVERY action counts). Decided 2026-07-14.
      if (!opts?.includeBookkeeping && e.kind === 'team' && (e.icon === 'people' || e.icon === 'box')) return false
      if (e.kind === 'audio' || e.kind === 'photo' || e.kind === 'journal' || e.kind === 'team') return true
      if (e.kind === 'layer') return false
      // a ↶ / ↷ row is the second half of an act that was taken back (or put back) — printed, or
      // the journal describes a picture that is not the one on the paper beside it. ⚠️ …but only
      // WITH its first half (D6, 26.09.2026): a move prints no row (below), so «KP Front
      // verschoben rückgängig gemacht» stood alone on paper, countering nothing it had said.
      if (e.kind === 'history') return historyCountersPrintedRow(e)
      return printableTacticalText(e)
    })
    .map((e) => {
      const iso = eventIso(e, fallbackDate)
      // …and through `rowText` first, so a picture on paper carries no «Foto» caption either —
      // then the row's Beilagen by name, so a files-only line is not an empty line
      const text = withFileNames(withoutAreaPrefix(rowText(e)), e.files)
      return {
        id: e.id,
        iso,
        timeLabel: iso ? formatDateTime(iso) : e.t,
        area: journalArea(e, plans),
        text,
        // the same links the app marks, as bold on paper — the Rapport has no colour to spend,
        // and bold is what a reader already reads as «this is a name» (lib/journalLinks).
        // ⚠️ NOT gated on the vocabulary: an address is not vocabulary, so a row whose only mark
        // is a URL has to reach the PDF as markup too. `linkMarkup` returns undefined when the
        // row marked nothing, and that is the only case the backend escapes the text itself.
        markup: linkMarkup(text, opts?.vocab ?? [], escapeXml,
          { crewRow: !!e.subjectId && !!opts?.truppIds?.has(e.subjectId) }),
        kind: e.kind,
        photoUrls: rowPhotos(e),
        audioUrl: e.audioUrl,
        transcript: e.transcript ?? (e.transcriptSections?.length
          ? e.transcriptSections.map((s) => s.text).join(' · ')
          : undefined),
        transcriptLines: e.transcriptSections?.length
          ? [
              ...(e.transcript ? [e.transcript] : []),
              ...e.transcriptSections.map((s) => `${fmtDuration(s.at)}  ${s.text}`),
            ]
          : undefined,
        // …or received by the server while the Einsatz was closed, whatever time it carries: a
        // Kontakt from before the close that arrived after it is late on paper (staging r3)
        // …and a row the Abschluss itself wrote is part of the close (lib/verlauf · isNachtrag)
        nachtrag: isNachtrag(iso != null && iso !== e.at ? { ...e, at: iso } : e, closedAt),
        repeats: repeats.counts.get(e.id),
        correctedAt: e.correctedAt && e.textOriginal ? hhmm(new Date(e.correctedAt)) : undefined,
        // the original through the same prefix-strip as the latest text, or the two would
        // differ by the «Auftrag · » tag alone and read as a phantom correction
        textOriginal: e.correctedAt && e.textOriginal ? withoutAreaPrefix(e.textOriginal) : undefined,
      }
    })
    .sort((a, b) => {
      if (a.iso && b.iso) return new Date(a.iso).getTime() - new Date(b.iso).getTime()
      if (a.iso) return -1
      if (b.iso) return 1
      return a.timeLabel.localeCompare(b.timeLabel)
    })
}

/** One row of the Rapport's «Aufträge / Pendenzen» section — the BGV form's columns. */
export interface PendenzPrintRow {
  text: string
  assignee?: string
  urgent: boolean
  erteilt: string
  /** absent ⇒ still open when the Rapport was written; the cell prints «offen» */
  erledigt?: string
  /** HH:MM of the Erinnerung, when the item carried one — the LATEST Wiedervorlage (a Meldung
   *  can move it), the same rule the pinned block runs on (lib/reminders). */
  faellig?: string
  notes: { timeLabel: string; text: string }[]
}

/**
 * Every Auftrag / Pendenz the Einsatz raised — the OPEN ones and the closed ones alike.
 *
 * ⚠️ Not `deriveReminders`, which answers a different question: that one is «what is still open»,
 * for the block in the Verlauf. The paper is a record, so it prints the ones that were dealt with
 * too — a section that showed only the leftovers would say what went wrong and nothing about what
 * was ordered and done, which is most of an Einsatz.
 *
 * Both times come out of the record for free: `erteilt` is the entry's own timestamp, `erledigt`
 * the timestamp of the row that closed it. Nobody fills a form in for this.
 */
export function pendenzRows(events: TimelineEvent[], fallbackDate?: string): PendenzPrintRow[] {
  const clock = (e: TimelineEvent) => {
    const iso = eventIso(e, fallbackDate)
    return iso ? hhmm(new Date(iso)) : e.t
  }
  const created = new Map<string, TimelineEvent>()
  const doneAt = new Map<string, string>()
  const urgency = new Map<string, boolean>()
  const due = new Map<string, string>()
  const notes = new Map<string, { timeLabel: string; text: string }[]>()
  /** the Tafel page's corrections of Was / Wer (types · reminder.edit), latest wins per field */
  const edits = new Map<string, { text?: string; assignee?: string }>()
  // oldest → newest, so «the latest wins» falls out of the iteration order
  for (let i = events.length - 1; i >= 0; i--) {
    const e = events[i]
    const r = e.reminder
    if (!r) continue
    if (r.urgent !== undefined) urgency.set(r.id, r.urgent)
    // any later row carrying a dueAt MOVES the Wiedervorlage (snooze, or a Meldung that
    // reschedules) — same rule as lib/reminders, so paper and pinned block agree
    if (r.dueAt) due.set(r.id, r.dueAt)
    if (r.op === 'created') created.set(r.id, e)
    else if (r.op === 'done') doneAt.set(r.id, clock(e))
    // an «Erledigt» taken back (lib/reminders · reopened): open again on paper too, until a later
    // done row closes it with ITS time
    else if (r.op === 'reopened') doneAt.delete(r.id)
    // a correction is not a Meldung: it changes the item's words, and the Journal prints its row
    else if (r.op === 'note' && r.edit) {
      const was = edits.get(r.id) ?? {}
      edits.set(r.id, {
        text: r.edit.text?.trim() || was.text,
        assignee: typeof r.edit.assignee === 'string' ? r.edit.assignee.trim() : was.assignee,
      })
    } else if (r.op === 'note') notes.set(r.id, [...(notes.get(r.id) ?? []), { timeLabel: clock(e), text: e.text }])
  }
  return [...created.entries()]
    .map(([id, e]) => ({
      // the BARE text — the row's own text carries the «Auftrag · » tag or the «Erinnerung gesetzt
      // für …» lead-in, and the section's own heading already says what these are
      text: edits.get(id)?.text || e.reminder?.text?.trim() || e.text,
      assignee: (edits.get(id)?.assignee ?? e.reminder?.assignee) || undefined,
      urgent: !!urgency.get(id),
      erteilt: clock(e),
      erledigt: doneAt.get(id),
      faellig: due.has(id) ? hhmm(new Date(due.get(id)!)) : undefined,
      notes: notes.get(id) ?? [],
    }))
    // chronological by Erteilt, like the paper form it replaces — NOT the screen's
    // dringend-first order, which is a working order for a list you act on
    .sort((a, b) => a.erteilt.localeCompare(b.erteilt))
}

export function missingTranscriptCount(events: TimelineEvent[]): number {
  return events.filter((e) =>
    e.kind === 'audio' && e.audioUrl && !(e.transcript ?? '').trim() && !e.transcriptSections?.length).length
}

/** «Stand» of the printed Kroki — the instant the picture shows, as the framing panel's slider
 *  and the collapsed fold above it both say it.
 *
 *  Date AND time: on a long Einsatz «21:14» alone does not say which day, and the printed caption
 *  carries the full stamp — the control must not say less than the paper. No year, unlike
 *  formatDateTime: this is read against a slider that spans one Einsatz. */
export function krokiStandLabel(ms: number | null): string {
  return ms == null ? appConfig.copy.preflight.krokiAtNow
    : new Date(ms).toLocaleString(formatLocale(), { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })
}

/**
 * «16.08.2026 15:35» — date and time, one space between them.
 *
 * ⚠️ Composed from the two parts rather than taken from `toLocaleString`, which puts a COMMA
 * between them. On the printed Verlauf that comma cost the Zeit column real width — the column has
 * to fit the longest label without wrapping, and it is the narrowest column on the page beside the
 * one carrying every entry's text. It also says nothing: a date followed by a time is not a list.
 */
export function formatDateTime(iso: string): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return iso
  const date = d.toLocaleDateString(formatLocale(), { day: '2-digit', month: '2-digit', year: 'numeric' })
  const time = d.toLocaleTimeString(formatLocale(), { hour: '2-digit', minute: '2-digit' })
  return `${date} ${time}`
}

export function proofLabel(proof: AuditProof): string {
  const r = appConfig.copy.report
  if (proof.offline || proof.intact == null) return r.proofOffline
  if (proof.intact) return r.proofIntact
  return proof.brokenAtSeq ? fillTemplate(r.proofBrokenAt, { seq: proof.brokenAtSeq }) : r.proofBroken
}

/** The Trupp's state as a word. Takes the whole Trupp, not just `status`: a Sicherungstrupp that
 *  was closed without ever going under PA shares the `raus` state but must not be printed as
 *  «draussen» — see lib/atemschutz · truppNeverDeployed. A bare status is still accepted for the
 *  callers that only have one. */
export function truppStatusLabel(t: Trupp | Trupp['status']): string {
  const az = appConfig.copy.atemschutz
  // ⚠️ Taken off the Tafel outranks the status it was left in: the Rapport prints it (types ·
  // Trupp.removedAt), and a deleted Trupp still listed as «aktiv» would read as a crew nobody
  // ever brought back out.
  if (typeof t !== 'string' && t.removedAt) return az.statusRemoved
  if (typeof t !== 'string' && truppNeverDeployed(t)) return az.statusNotDeployed
  const status = typeof t === 'string' ? t : t.status
  return az.status[status] ?? status
}

/** The Auftrag TYPE as it reads, not as it is stored. The stored value is the config id
 *  (`loeschen`, `retten`), and the print sent it straight through — so the Atemschutz sheet
 *  said «loeschen», umlaut and capital and all. THE resolver: the board, the card chip, the
 *  «Auftrag» sort and the Rapport all read a label through here.
 *  ⚠️ It searches BOTH Auftrag lists (`allAuftragTypes`), never just the one matching the
 *  Trupp's kind — a Trupp recorded before the split, or one whose kind was mis-picked, carries
 *  an id from the other list and must still render its word rather than a blank chip. */
export function truppAuftragLabel(auftrag?: string): string | undefined {
  if (!auftrag) return undefined
  const known = appConfig.copy.atemschutz.auftragLabels[auftrag]
    ?? allAuftragTypes.find((a) => a.id === auftrag)?.label
  if (known) return known
  // An id neither list knows — a Trupp from an older workspace, or a station that renamed its
  // Auftrag types. Print it the way an id READS rather than the way it is stored: the ids are
  // ASCII-transliterated like the symbol keys, so «loeschen» became «loeschen» on paper instead
  // of «Löschen». Last resort, not the normal path.
  const spelled = restoreUmlauts(auftrag)
  return spelled.charAt(0).toUpperCase() + spelled.slice(1)
}

/**
 * The Ausrüstung ids a Trupp carries (types · Trupp.equipment) as the words the card and the
 * Rapport print, in the station's list order. Same resolution as `truppAuftragLabel`: the copy's
 * localised label for a shipped id, else the label the station's own list carries
 * (deploymentConfig · atemschutzEquipment), else the id as stored — an id from an older list is
 * still on the record and must still print. Unknown ids keep the order they were recorded in.
 */
export function truppEquipmentLabels(ids: readonly string[] | undefined): string[] {
  if (!ids?.length) return []
  const list = atemschutzEquipment()
  const labels = appConfig.copy.atemschutz.equipmentLabels
  const rank = (id: string) => { const i = list.findIndex((e) => e.id === id); return i < 0 ? list.length : i }
  return [...new Set(ids)]
    .sort((a, b) => rank(a) - rank(b))
    .map((id) => labels[id] ?? list.find((e) => e.id === id)?.label ?? id)
}

/**
 * Was this row's pressure MEASURED, or carried over?
 *
 * ⚠️ `contact` and `rueckzug` rows store `lastPressureBar ?? entryPressureBar` — the last value
 * anybody reported, not a reading taken at that moment (useTruppActions · recordContact,
 * setTruppStatus). On the board that is harmless context; in the Rapport's pressure column it is a
 * number that looks measured and is not, on a signed document — «300 bar» beside a Kontakt twenty
 * minutes after the last real reading. The record keeps the value (it is what was known then); the
 * column stays empty for it.
 */
export function readingBarIsMeasured(kind: TruppReading['kind']): boolean {
  // …and neither is the Austritt or the Wiedereinstieg: both carry the last reported value
  // forward exactly like a Kontakt does (useTruppActions · setTruppStatus). `paOff` is the same
  // shape — the Überwachung ended, nobody read a gauge for it — while `paOn` carries the
  // Eingangsdruck of the cylinder that was just opened, which IS a reading.
  // …and a `crew` row names people, not a pressure — its bar is carried like a Kontakt's
  // …and so do the two ends of a Notfall (F1): nobody read a gauge for them
  return kind !== 'contact' && kind !== 'rueckzug' && kind !== 'exit' && kind !== 'resume' && kind !== 'paOff' && kind !== 'crew'
    && kind !== 'notfall' && kind !== 'notfallEnde'
}

/**
 * …and whether this row may PRINT its bar at all.
 *
 * ⚠️ Zero is not a pressure. A Trupp that was registered without Atemschutz carries a bar of 0 on
 * every row of its log — nobody was ever asked for an Eingangsdruck — and those rows survive the
 * Trupp being upgraded later (types · TruppReading `paOn`), which puts them on the Atemschutz page
 * of the Rapport. «Eingerückt 0 bar» reads as an empty cylinder, which is the one number on that
 * sheet nobody may misread. The row stays, the column is blank for it.
 */
export function readingBarShown(r: Pick<TruppReading, 'kind' | 'bar' | 'measured'>): boolean {
  // …an Austritt that was asked its Restdruck carries a real reading (types · TruppReading.measured)
  return (readingBarIsMeasured(r.kind) || r.measured === true) && r.bar > 0
}

/**
 * Every Eintritt and every Austritt this Trupp's LOG records — the header of its
 * Atemschutz-Detailprotokoll, read off the same rows the table below it prints.
 *
 * ⚠️ The log, not `entryTime`/`exitTime`. Those two are the LIVE card's state: a Trupp that goes
 * in, comes out, is re-registered and goes in again (useTruppActions · reactivateTrupp) overwrites
 * both, so the header printed the last cycle's Eintritt over the first cycle's rows and a reader
 * comparing the two saw the sheet contradict itself. They are also the fields the sync merge is
 * free to re-resolve from ONE side (mergeWorkspace · mergeTrupp), so two devices can leave the
 * scalar naming an instant the log never recorded — which is exactly what the 02.09. field report
 * saw: a header «Austritt 15:22» above a table whose Draussen row said 15:27. The appended rows
 * ARE the record: one source for both halves of the block, and every cycle survives.
 *
 * The scalars stay as the per-side FALLBACK, for a Trupp whose log predates the row that would
 * carry it: `exit` rows only exist since 19.08., and a Trupp registered before 09.08. may carry no
 * log at all.
 */
export function truppRunTimes(
  readings: readonly Pick<TruppReading, 't' | 'kind'>[] | undefined,
  fallback: { entryTime?: string; exitTime?: string },
): { entries: string[]; exits: string[]; registered: string[] } {
  const of = (kind: TruppReading['kind']) =>
    (readings ?? []).filter((r) => r.kind === kind).map((r) => r.t).filter(Boolean)
  const entries = of('entry')
  const exits = of('exit')
  return {
    entries: entries.length ? entries : ([fallback.entryTime].filter(Boolean) as string[]),
    exits: exits.length ? exits : ([fallback.exitTime].filter(Boolean) as string[]),
    // ⚠️ The ANMELDUNG travels too (04.09.). A Trupp that never went in prints one line —
    // «Nicht eingesetzt: …» — and that line carried the Draussen stamp alone, so the sheet said
    // 06:50 about a crew that had stood ready since 06:32 and the reader had no way to see the
    // difference. It is a span like every other row in the block, so it prints as one. No
    // fallback: a log without a `registered` row simply has no Anmeldung to name, and the line
    // falls back to what it always printed (backend · _meta_bits).
    registered: of('registered'),
  }
}

/** One crew change on the Atemschutz page — dated, in the words of copy · atemschutz.crewChange. */
export interface TruppCrewChange { t: string; text: string }
/** One deployment cycle of a Trupp: its Eintritt/Austritt, the crew that went in, and what
 *  changed about that crew while it ran. */
export interface TruppCycle { entry: string; exit?: string; crew: string[]; changes: TruppCrewChange[] }

/** everybody a `crew` row names, leader first, blanks dropped */
const crewNames = (c: { name: string; members: string[] }): string[] =>
  [c.name, ...c.members].map((n) => (n ?? '').trim()).filter(Boolean)
const crewRowsOf = (t: Trupp) => (t.readings ?? [])
  .filter((r): r is TruppReading & { crew: NonNullable<TruppReading['crew']> } => r.kind === 'crew' && !!r.crew)
  .sort((a, b) => (Date.parse(a.t) || 0) - (Date.parse(b.t) || 0))
/** how the OTHER Trupp is named in a change line: its number, else its leader (a record from before 12.09.) */
const truppRef = (u: Trupp): string => (typeof u.no === 'number' ? String(u.no) : u.name.trim())

/**
 * The crew history the Atemschutz page prints (docs/trupp-naming.md §5), read off the `crew`
 * rows of the log (types · TruppReading) — never off the card's current `name`/`members`, which
 * are only who the Trupp is NOW.
 *
 * `leader` is the Gruppenführer AT REGISTRATION — the heading's name, which stays put when the
 * lead is handed over mid-Einsatz. Each cycle (every Eintritt the log records, paired with its
 * Austritt — lib/report · truppRunTimes) names the crew that went in: the latest `crew` row at or
 * before that Eintritt. A record with no crew rows at all (written before 12.09.) falls back to
 * the current crew, which is all it ever knew.
 *
 * Every later `crew` row is diffed against the one before it, and the differences become dated
 * lines in the cycle they fell into: the cycle that was running, or — between an Austritt and
 * the next Eintritt, and before the first one — the cycle about to start, because that is who
 * went in. A person who left is followed to the Trupp that next lists them — «Dürring Jan →
 * Trupp 2» — and one who arrived is traced back to the Trupp whose log dropped them just before
 * — «Frei Nina von Trupp 1». Where neither side has such a row, the line says only that they
 * left or joined; the registration row itself names only arrivals from another Trupp. A
 * handover prints as ONE line, «Gruppenführer Meier Anna → Keller Andreas»:
 * the two leaders are not repeated as left/joined unless another Trupp's log says where they
 * went or came from, which is news the leader line cannot carry.
 *
 * A Trupp with no cycle at all has nowhere to print a change; the Verlauf still carries it.
 */
export function truppCrewHistory(t: Trupp, all: readonly Trupp[] = []): { leader: string; cycles: TruppCycle[] } {
  const ms = (s: string) => Date.parse(s) || 0
  const rows = crewRowsOf(t)
  const leader = rows[0]?.crew.name.trim() || t.name.trim()
  const { entries, exits } = truppRunTimes(t.readings, { entryTime: t.entryTime, exitTime: t.exitTime })
  const crewAt = (at: string): string[] => {
    let best: (typeof rows)[number] | undefined
    for (const r of rows) if (ms(r.t) <= ms(at)) best = r
    return best ? crewNames(best.crew) : crewNames({ name: t.name, members: t.members ?? [] })
  }
  const cycles: TruppCycle[] = entries.map((entry, i) => ({ entry, exit: exits[i], crew: crewAt(entry), changes: [] }))
  if (!cycles.length) return { leader, cycles }

  const C = appConfig.copy.atemschutz.crewChange
  const others = all.filter((u) => u.id !== t.id)
  const SLACK = 1000 // two devices' clocks, or the same tap writing two rows in one frame
  /** the Trupp whose log next lists `who` at or after `at` — where they went */
  const destinationOf = (who: string, at: string): string | undefined => {
    let hit: { t: number; ref: string } | undefined
    for (const u of others) for (const r of crewRowsOf(u)) {
      if (ms(r.t) < ms(at) - SLACK || !crewNames(r.crew).includes(who)) continue
      if (!hit || ms(r.t) < hit.t) hit = { t: ms(r.t), ref: truppRef(u) }
    }
    return hit?.ref
  }
  /** the Trupp whose log dropped `who` at or before `at` — where they came from */
  const sourceOf = (who: string, at: string): string | undefined => {
    let hit: { t: number; ref: string } | undefined
    for (const u of others) {
      const rs = crewRowsOf(u)
      for (let i = 0; i + 1 < rs.length; i++) {
        const dropped = crewNames(rs[i].crew).includes(who) && !crewNames(rs[i + 1].crew).includes(who)
        if (!dropped || ms(rs[i + 1].t) > ms(at) + SLACK) continue
        if (!hit || ms(rs[i + 1].t) > hit.t) hit = { t: ms(rs[i + 1].t), ref: truppRef(u) }
      }
    }
    return hit?.ref
  }
  const cycleFor = (at: string): TruppCycle => {
    let i = 0
    for (let k = 0; k < cycles.length; k++) if (ms(cycles[k].entry) <= ms(at)) i = k
    // after that cycle's Austritt and before the next Eintritt → the next cycle, if there is one
    const c = cycles[i]
    if (c.exit && ms(c.exit) <= ms(at) && i + 1 < cycles.length) return cycles[i + 1]
    return c
  }
  for (let i = 0; i < rows.length; i++) {
    // the registration row diffs against nobody: it names no handover and no «joined», only
    // who arrived FROM another Trupp — «Frei Nina von Trupp 1» on the Trupp she was moved into
    const first = i === 0
    const prev = first ? { name: '', members: [] } : rows[i - 1].crew, cur = rows[i].crew
    const at = rows[i].t
    const texts: string[] = []
    const handover = !first && prev.name.trim() !== cur.name.trim() && !!cur.name.trim()
    if (handover) texts.push(fillTemplate(C.leader, { from: prev.name.trim(), to: cur.name.trim() }))
    const before = crewNames(prev), after = crewNames(cur)
    for (const who of before.filter((n) => !after.includes(n))) {
      const to = destinationOf(who, at)
      if (to) texts.push(fillTemplate(C.movedTo, { name: who, to }))
      else if (!(handover && who === prev.name.trim())) texts.push(fillTemplate(C.left, { name: who }))
    }
    for (const who of after.filter((n) => !before.includes(n))) {
      const from = sourceOf(who, at)
      if (from) texts.push(fillTemplate(C.movedFrom, { name: who, from }))
      else if (!first && !(handover && who === cur.name.trim())) texts.push(fillTemplate(C.joined, { name: who }))
    }
    const cycle = cycleFor(at)
    for (const text of texts) cycle.changes.push({ t: at, text })
  }
  return { leader, cycles }
}

/** `standDown`: this `exit` row closed a run that never went in (lib/atemschutz ·
 *  isStandDownExit) — it prints «Nicht eingesetzt», never «Austritt» (staging N8, 25.09.2026). */
export function readingKindLabel(kind: TruppReading['kind'], standDown = false): string {
  const r = appConfig.copy.report
  const az = appConfig.copy.atemschutz
  if (kind === 'exit' && standDown) return az.statusNotDeployed
  if (kind === 'registered') return az.readingKind.registered
  if (kind === 'entry') return r.truppEntry
  if (kind === 'contact') return az.readingKind.contact
  // the two rows the sheet is read for — see types · TruppReading
  if (kind === 'alarm') return az.readingKind.alarm
  if (kind === 'rueckzug') return az.readingKind.rueckzug
  // the two that complete the chronology — the crew came out, or went back in
  if (kind === 'exit') return az.readingKind.exit
  if (kind === 'resume') return az.readingKind.resume
  // …and the two ends of the monitored stretch, where the Art was changed after the fact
  if (kind === 'paOn') return az.readingKind.paOn
  if (kind === 'paOff') return az.readingKind.paOff
  // …and the two ends of an Atemschutznotfall (F1, 08.10.2026)
  if (kind === 'notfall') return az.readingKind.notfall
  if (kind === 'notfallEnde') return az.readingKind.notfallEnde
  return az.readingKind.pressure
}

export function operationalExtentPoints(
  incidentCenter: LngLat,
  entities: Entity[],
  drawings: Drawing[],
  includeLiveVehicles: boolean,
): LngLat[] {
  const pts: LngLat[] = []
  for (const e of entities) {
    if (!Array.isArray(e.coord)) continue
    const liveVehicle = !!e.live || e.layer === appConfig.gps.layerId
    if (liveVehicle && !includeLiveVehicles) continue
    pts.push(e.coord)
  }
  for (const d of drawings) {
    if (!Array.isArray(d.coords)) continue
    pts.push(...d.coords)
    // ⚠️ A circle contributes only its CENTRE, never its radius. The Absperrkreis is the
    // biggest and least informative object on the picture, and letting its rim drive the fit
    // shrank every symbol, Trupp and Leitung to an unreadable fleck in the middle (19.08.
    // print). The ring may clip — its radius is in the legend («r = 100 m») either way.
  }
  // the placed content DEFINES the frame; the incident address only anchors it when
  // nothing is placed — including it always dragged the fit to the far-away alarm pin
  // and pushed the action to the page edge (Kroki feedback 2026-07-18)
  return pts.length > 0 ? pts : [incidentCenter]
}

/** A Lage this small is «compact»: everything placed fits inside one building. */
export const KROKI_COMPACT_SPAN_M = 30
/** The auto-fit's zoom ceiling, as a MapLibre CAMERA zoom. 20 is the basemap's last sharp level;
 *  a COMPACT Lage may go one past it (18.09.2026): six symbols within 10 m stayed legible at 20,
 *  but filled 15 % of the sheet. One level doubles their separation for a slightly soft basemap
 *  that still shows the streets around the building — two levels lost the streets.
 *  ⚠️ Mirrored in backend/app/report · _kroki_fit_max_z (projection zoom = this + 1), so
 *  the crop the panel opens on is the crop a rapport without a reported crop prints. */
export function krokiFitMaxZoom(points: LngLat[]): number {
  if (points.length < 2) return 20
  const lngs = points.map((p) => p[0]), lats = points.map((p) => p[1])
  const lat = (Math.min(...lats) + Math.max(...lats)) / 2
  const spanM = Math.max(
    (Math.max(...lngs) - Math.min(...lngs)) * 111320 * Math.cos((lat * Math.PI) / 180),
    (Math.max(...lats) - Math.min(...lats)) * 110540,
  )
  return spanM < KROKI_COMPACT_SPAN_M ? 21 : 20
}

export function describeDrawing(d: Drawing): string {
  const r = appConfig.copy.report
  if (d.kind === 'circle') return `${r.drawCircle}${d.radiusM ? ` ${fmtDistance(d.radiusM)}` : ''}`
  if (d.kind === 'area') return d.label ? fillTemplate(r.drawAreaLabeled, { label: d.label }) : r.drawArea
  if (d.label) return d.label
  if (d.marker === 'R') return r.drawRescueAxis
  if (d.showDistance) return r.drawMeasureArrow
  return r.drawLine
}

/** The Einsatzleiter as drawn on the Lage, for pre-filling the Rapport field that would
 *  otherwise be typed a second time. Read in doctrine order:
 *    1. the Einsatzleiter glyph — its 'Name' (roster picker), else its own label,
 *    2. the KP Front's 'Name' — it carries the same EL/Stv. pair since 14.09. (no label
 *       fallback: its label is «KP Front», not a person),
 *    3. an Offizier whose Funktion says Einsatzleiter (a rank-led picture without the EL glyph),
 *    4. any symbol carrying a filled field literally named «Einsatzleiter» (a KP Front placed
 *       before 14.09. carried the EL that way — old data keeps working).
 *  Returns undefined when nothing names a person — the field then stays empty rather than
 *  guessing. Only a PRE-fill: whatever the operator types in the Rapport wins. */
export function einsatzleiterFromScene(entities: Entity[] = []): string | undefined {
  const syms = entities.filter((e) => e.kind === 'symbol')
  const val = (e: Entity, key: string) => e.fields?.[key]?.trim() || undefined
  for (const name of appConfig.symbols.einsatzleiterSymbols) {
    const labelOk = name === appConfig.symbols.einsatzleiterName
    const hit = syms.find((e) => e.symbol === name && (val(e, 'Name') || (labelOk && e.label?.trim())))
    if (hit) return val(hit, 'Name') ?? hit.label?.trim()
  }
  const officer = syms.find((e) => /einsatzleit|^el$/i.test(e.fields?.Funktion?.trim() ?? '') && val(e, 'Name'))
  if (officer) return val(officer, 'Name')
  return syms.map((e) => val(e, 'Einsatzleiter')).find(Boolean)
}

/** Pre-formatted meta extras for the SERVER-rendered PDF (facts rows are placed, not
 *  computed, by the composer): Gerettete, Rückmeldung ELZ
 *  and the Alarmierungs-/Ausrückzeiten grid as [label, value] pairs. The grid ALWAYS
 *  prints (revised 2026-07-31, superseding Beschluss A of the field-classification):
 *  recorded times print as times, missing ones as `__:__` stubs for the pen. The old rule
 *  suppressed the whole section as soon as anything had been captured digitally, so a
 *  fully automatic alarm — the case the milestone integration exists for — produced a
 *  signed rapport with no Alarm- or Ausrückzeiten on it at all. Per-vehicle Vor-Ort- and
 *  Zurück-Zeiten stay digital-only; they are not fields on the paper form. */
export function metaExtrasForPdf(meta: ReportMeta, bounds?: IncidentBounds): {
  gerettete?: string
  rueckmeldungElz?: string
  zeiten: [string, string][]
  erfasser?: string
} {
  // Same midnight rule as the Personalblatt directly above this grid on the sheet — it dated its
  // clocks and this one did not, on the same page. «23:50 → 00:15» is 25 minutes or 23 hours
  // depending on a date that was nowhere on the paper.
  const fmt = spanAwareClock(bounds)
  const clock = (iso?: string) => fmt(iso) ?? ''
  // ⚠️ «keine» is a VALUE on the paper, not a blank (04.09.). An empty Gerettet-box meant four
  // things at once to whoever read the Rapport afterwards; once somebody has answered the
  // question, the answer prints — and a blank now means only «nicht erfasst».
  const gerettete = _geretteteText(meta.gerettete)
    || (meta.geretteteNone ? appConfig.copy.preflight.geretteteNonePrint : '')
    || undefined
  const rk = meta.rueckmeldungElz
  const rueckmeldungElz = rk && (rk.name || rk.at)
    ? [rk.name, rk.at ? clock(rk.at) : null].filter(Boolean).join(' · ')
    : undefined
  const cfg = getDeploymentConfig()
  const gRows = gruppenRows(cfg.alarms?.groups ?? [], meta.gruppen)
  const vRows = fahrzeugRows(cfg.fleet?.vehicles ?? [], meta.fahrzeuge)
  const zeiten: [string, string][] = [
    ...gRows.map(({ config: c, value: v }): [string, string] => [
      c.color ? `${c.label} (${c.color})` : c.label, clock(v?.alarmedAt),
    ]),
    // «· 3 Fahrten» where the server's GPS saw a vehicle on scene more than once (a
    // shuttle to the depot) — the trips the Verlauf leaves out on purpose (D2-a, 24.09.2026)
    ...vRows.map(({ config: c, value: v }): [string, string] => [
      c.label, [clock(v?.ausgerueckt), fahrtenText(v)].filter(Boolean).join(' · '),
    ]),
  ]
  return {
    gerettete, rueckmeldungElz, zeiten,
    erfasser: meta.erfasser || undefined,
  }
}

/** The Personal-/Soldblatt rows for the SERVER-rendered PDF: the FULL roster as tick-off
 *  rows (recorded people get a printed tick + their recorded clocks, the rest stays blank
 *  for the pen — the printed rapport is a pre-filled Erfassungsblatt, decided 2026-07-17),
 *  then guests recorded outside the roster, then two blank write-in rows. Stunden are
 *  deliberately absent: WinFAP computes them from von–bis.
 *
 *  Someone who left and came back gets ONE ROW PER BLOCK (same name, own von–bis) rather than
 *  an outer span that would silently bill the hours they were away. */
/** One printed roster line. `vonDerived`/`bisDerived` mark a time the app worked out from the
 *  incident's own bounds rather than one somebody recorded — the sheet prints those grey. */
/** One stretch a person was on scene. A crew that came back after a break has several. */
export interface PersonalPdfTime {
  von?: string
  bis?: string
  /** this clock was DERIVED from the incident's bounds, not recorded — printed grey */
  vonDerived?: boolean
  bisDerived?: boolean
}

/** ONE row per person, however many times they came and went. It used to be one row per BLOCK,
 *  so somebody who left and came back printed their name twice on the roster and was counted
 *  twice by anyone reading down the column — the sheet has to say «who was here», and a name is
 *  a person, not a shift. The stretches stack in the time column instead. */
export interface PersonalPdfRow {
  name: string
  erfasst: boolean
  times?: PersonalPdfTime[]
  note?: string
  /** not on the Mannschaftsliste — a Gast, a Nachbarwehr, somebody not yet synced. The app has
   *  badged them on the Anwesenheit screen all along and the SHEET did not, so the one reader
   *  who cannot ask (a Gemeinde or a Versicherung reading a signed rapport weeks later) saw a
   *  name in the middle of our roster and had no way to know it was not one of ours. */
  guest?: boolean
}

/** «07.08.» — the day in front of a clock reading, for an Einsatz that runs past midnight. */
const dayShort = (d: Date) => `${pad2(d.getDate())}.${pad2(d.getMonth() + 1)}.`

/** The incident's own bounds — what decides whether a printed clock needs its date. */
export interface IncidentBounds { alarmedAt?: string | null; endedAt?: string | null }

/**
 * The one midnight rule for everything printed on the rapport: bare `08:23` on an ordinary
 * one-day sheet, `23.06. 08:23` once the Einsatz actually spans days.
 *
 * Bare HH:MM is a lie over midnight — «08:23 – 09:00» reads as 37 minutes when it was 25 hours.
 * The date rides along only when it has to, so the ordinary sheet stays as narrow as it was.
 * Shared rather than re-implemented: it lived inside personalForPdf, which is why the Zeiten
 * grid and the Rückmeldung ELZ on the SAME PAGE printed undated clocks.
 */
export function spanAwareClock(bounds?: IncidentBounds): (iso?: string | null) => string | undefined {
  const a = bounds?.alarmedAt ? new Date(bounds.alarmedAt) : null
  const e = bounds?.endedAt ? new Date(bounds.endedAt) : null
  const spansDays = !!a && !!e && Number.isFinite(a.getTime()) && Number.isFinite(e.getTime())
    && a.toDateString() !== e.toDateString()
  return (iso?: string | null) => {
    if (!iso) return undefined
    const d = new Date(iso)
    if (!Number.isFinite(d.getTime())) return undefined
    return spansDays ? `${dayShort(d)} ${hhmm(d)}` : hhmm(d)
  }
}

/** Human names for the Rapportangaben, for the Verlaufszeile that records a change to them –
 *  the copy catalogue's one map (copy.report.metaFieldLabels), read at call time so the
 *  resolved locale applies. The QR poster reads the same map (lib/captureClient). */
const metaFieldLabels = () => appConfig.copy.report.metaFieldLabels

/** Fields whose change is bookkeeping ABOUT the rapport rather than a statement about the
 *  Einsatz — logging them would bury the ones that matter.
 *
 *  `linksDone` is here DELIBERATELY, not by omission: ticking off the station's own paperwork
 *  (the Getränkeabrechnung, a Schadenmeldung — see lib/reportLinks) says nothing about what
 *  happened at the Einsatz, and the Verlauf is the record of the Einsatz. The tick itself is
 *  kept in the workspace blob with its timestamp, so it is neither invisible nor lost.
 *
 *  `printJob` is here for the same reason: which relay job a rapport is queued on is plumbing,
 *  not a statement about the Einsatz. The print itself is already recorded elsewhere. */
const META_QUIET = new Set(['erfasser', 'krokiPrint', 'linksDone', 'printJob'])

/** Fields short enough to print their new value in the Verlauf line. A Kurzbericht or a
 *  Bemerkung is a paragraph — quoting it would turn the log into a second copy of the rapport,
 *  so those report only THAT they were written (see `_prose`). */
const META_SHORT = new Set([
  'einsatzleiter', 'kontaktperson', 'kontaktpersonTelefon', 'kommandant', 'endedAt',
  'ausgeruecktAt', 'alarmiertAt',
])

/** Free-text fields: say what happened to them, never what they now say. */
const META_PROSE = new Set(['summary', 'remarks', 'lehren'])

const _hasText = (v: unknown) => typeof v === 'string' && v.trim().length > 0

/** What a Rapportangaben change produces, in the two shapes it comes in — see
 *  changedReportMetaLines. */
export interface ReportMetaLines {
  /** the scalar fields — label + quoted value / «geschrieben» verbs — alphabetical, like the
   *  one-row form always was */
  fields: string[]
  /** the structured blocks' complete standalone sentences («Partnerorganisation Sanität
   *  ergänzt …»), in DIFF order — adds before remark changes before removals — and NEVER
   *  re-sorted: each is its own statement, and alphabetising them scrambled the story
   *  («entfernt» before «ergänzt») when several landed in one row */
  statements: string[]
}

/**
 * Which Rapportangaben actually changed between two versions, AS THE VERLAUF PRINTS THEM — the
 * content of the printed rapport (Einsatzleiter, Endezeit, Gerettete, Partnerorganisationen …)
 * used to change with no journal row at all, and then with a row that named the field and
 * nothing else: «Rapportangaben geändert: Bemerkungen» tells a reader that something happened
 * to something, which is the least a log can say.
 *
 * A short field now carries its new value; a free-text one says whether it was written,
 * rewritten or cleared. Both lists empty when nothing worth a line moved, so the caller stays
 * silent. Fields and statements come back SEPARATELY so a caller can give each statement its
 * own Verlauf row instead of cramming three sentences into one.
 */
export function changedReportMetaLines(prev: ReportMeta, next: ReportMeta): ReportMetaLines {
  const P = appConfig.copy.preflight
  const keys = new Set([...Object.keys(prev), ...Object.keys(next)])
  const fields: string[] = []
  const statements: string[] = []
  // ⚠️ The header Ausrückzeit is DERIVED from the Fahrzeug grid (deriveAusgerueckt), and one tap
  // in that grid persists both. Logged separately they printed the same fact twice in one row —
  // «Ausgerückt «10.08.2026, 14:05», Fahrzeugzeiten» — so when the vehicles moved, the vehicles
  // are the statement and the derived header is not.
  const fahrzeugeMoved = !jsonEqual(prev.fahrzeuge ?? null, next.fahrzeuge ?? null)
  for (const k of keys) {
    if (META_QUIET.has(k)) continue
    if (k === 'ausgeruecktAt' && fahrzeugeMoved) continue
    const a = (prev as Record<string, unknown>)[k]
    const b = (next as Record<string, unknown>)[k]
    // structural compare: gruppen/fahrzeuge/partnerContacts are arrays of objects, and an
    // identity check would report a change on every re-render that rebuilt them
    if (jsonEqual(a ?? null, b ?? null)) continue
    // the structured fields write their own sentences — see `_structuredMetaLines`
    const structured = _structuredMetaLines(k, a, b)
    if (structured) { statements.push(...structured); continue }
    const label = metaFieldLabels()[k]
    // A key with no human name is an internal one (`startedAt`, `alarmText`) — printing the
    // identifier put «startedAt» on the signed rapport, which is worse than saying nothing.
    if (!label) continue
    if (META_PROSE.has(k)) {
      const verb = !_hasText(b) ? P.metaCleared : _hasText(a) ? P.metaRewritten : P.metaWritten
      fields.push(`${label} ${verb}`)
    } else if (META_SHORT.has(k) && _hasText(b)) {
      const shown = k.endsWith('At') ? (formatDateTime(b as string) || String(b)) : String(b).trim()
      fields.push(fillTemplate(P.metaValue, { label, value: shown }))
    } else if (META_SHORT.has(k)) {
      fields.push(`${label} ${P.metaCleared}`)
    } else {
      fields.push(label)
    }
  }
  return { fields: fields.sort((x, y) => x.localeCompare(y, 'de')), statements }
}

/** The one-array view of changedReportMetaLines, for the callers that join everything into a
 *  single «Rapportangaben: …» row — everything sorted together, exactly as before the split. */
export function changedReportMetaFields(prev: ReportMeta, next: ReportMeta): string[] {
  const { fields, statements } = changedReportMetaLines(prev, next)
  return [...fields, ...statements].sort((x, y) => x.localeCompare(y, 'de'))
}

/**
 * Clears an «entfällt» flag the moment its answer arrives. «Entfällt» and a value are two
 * answers to the same question, and the sheet let both stand at once: type the Kontaktperson
 * after ticking «entfällt» and the record said «there is nobody to name — here is her name».
 *
 * Pure: takes the patch a save is about to apply and the state it applies to, and returns the
 * patch with the contradicted flags resolved — falsed when the flag was already ON (so the
 * Verlauf records the Widerruf), silently dropped when the same patch tried to set both.
 * The Mittel list lives outside ReportMeta, so its count comes in as context.
 */
export function normalizeReportMeta(
  patch: Partial<ReportMeta>,
  prev: ReportMeta,
  ctx: { mittelCount?: number } = {},
): Partial<ReportMeta> {
  const next = { ...prev, ...patch }
  const out = { ...patch }
  let changed = false
  const clear = (flag: 'kontaktpersonNone' | 'rueckmeldungNone' | 'mittelConfirmedNone' | 'geretteteNone') => {
    if (!next[flag]) return
    if (prev[flag]) { out[flag] = false; changed = true }
    else if (flag in out) { delete out[flag]; changed = true }
  }
  if (_hasText(next.kontaktperson) || _hasText(next.kontaktpersonTelefon)) clear('kontaktpersonNone')
  // a counted rescue and «keine» are the same contradiction the two above resolve
  const g = next.gerettete
  if ((g?.personen ?? 0) > 0 || (g?.tiere ?? 0) > 0) clear('geretteteNone')
  const rk = next.rueckmeldungElz
  if (rk && (_hasText(rk.name) || _hasText(rk.at))) clear('rueckmeldungNone')
  if ((ctx.mittelCount ?? 0) > 0) clear('mittelConfirmedNone')
  return changed ? out : patch
}

/** One stretch of the Einsatzleitung: who, and since when (`null` on a row without a usable
 *  timestamp). The «bis» of one span is the «ab» of the next — the caller renders that. */
export interface EinsatzleiterSpan {
  name: string
  fromTs: string | null
}

/** Matches the «Einsatzleiter «Name»» fragment a Rapportangaben row carries (the META_SHORT
 *  quoting above) — built from the LIVE metaValue template, so it reads rows in whatever locale
 *  wrote them, the same reasoning as startsWithTemplate. */
function _einsatzleiterPattern(): RegExp {
  const marker = '\u0000'
  const filled = fillTemplate(appConfig.copy.preflight.metaValue, { label: metaFieldLabels().einsatzleiter, value: marker })
  const escaped = filled.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  return new RegExp(escaped.replace(marker, '(.+?)'), 'g')
}

/**
 * The Einsatzleiter SUCCESSION, read out of the incident's own Verlauf — the rapport field only
 * holds the latest name, but a handover mid-Einsatz is exactly the kind of fact a signed record
 * is later read for. Every Rapportangaben row that quotes an Einsatzleiter (tablet and QR poster
 * both write the same metaValue fragment) contributes a span; oldest first, and re-saving the
 * unchanged name is no handover, so consecutive repeats fold away. A later return of an earlier
 * name stays — that IS a handover. Structured data only; the caller renders
 * «Einsatzleitung: A (bis 14:20), B (ab 14:20)».
 */
export function einsatzleiterSuccession(events: TimelineEvent[], fallbackDate?: string): EinsatzleiterSpan[] {
  const pattern = _einsatzleiterPattern()
  const out: EinsatzleiterSpan[] = []
  // oldest → newest, same iteration as pendenzRows — the Verlauf array is newest-first
  for (let i = events.length - 1; i >= 0; i--) {
    const e = events[i]
    let name: string | undefined
    pattern.lastIndex = 0
    // the LAST mention in a row wins — one debounced row can carry several joined fields
    for (const m of e.text.matchAll(pattern)) name = m[1]?.trim() || name
    if (!name) continue
    if (out.length && out[out.length - 1].name === name) continue
    out.push({ name, fromTs: eventIso(e, fallbackDate) })
  }
  return out
}

/** hh:mm for a Verlauf line about a Rapport time; the raw value if it will not parse. */
const _clock = (iso?: string) => (iso ? formatDateTime(iso) || iso : '')

/**
 * The Rapportangaben that are STRUCTURES rather than values — and therefore the ones that used
 * to log nothing but their own name. Returns one line per thing that actually moved, or
 * `undefined` for a key this does not handle (the caller falls back to the generic path).
 *
 * ⚠️ Each of these blocks is edited one row at a time — tick Polizei, tick Sanität, type a
 * remark — and every row starts its own debounce window. Naming the row is what makes three
 * consecutive entries three readable statements instead of three identical ones.
 */
function _structuredMetaLines(k: string, a: unknown, b: unknown): string[] | undefined {
  const P = appConfig.copy.preflight
  if (k === 'rueckmeldungElz') {
    const rk = (b ?? {}) as { name?: string; at?: string }
    const name = rk.name?.trim()
    const t = _clock(rk.at)
    if (name && t) return [fillTemplate(P.metaRueckmeldung, { name, t })]
    if (name) return [fillTemplate(P.metaRueckmeldungName, { name })]
    if (t) return [fillTemplate(P.metaRueckmeldungTime, { t })]
    return [`${metaFieldLabels().rueckmeldungElz} ${P.metaCleared}`]
  }
  if (k === 'gerettete') {
    const value = _geretteteText(b as { personen?: number; tiere?: number } | undefined)
    return [value ? fillTemplate(P.metaGerettete, { value }) : `${metaFieldLabels().gerettete} ${P.metaCleared}`]
  }
  // …and the answer «es gab keine», which is a statement of its own and not an empty field
  if (k === 'geretteteNone') return [b ? P.metaGeretteteNone : P.metaGeretteteNoneOff]
  if (k === 'mittelConfirmedNone') return [b ? P.metaMittelNoneOn : P.metaMittelNoneOff]
  // «Entfällt» is a deliberate ANSWER, so it is recorded as one — a blank line in the record
  // looks like something forgotten, which is the whole reason these two fields exist.
  if (k === 'kontaktpersonNone') {
    return [fillTemplate(b ? P.metaNoneOn : P.metaNoneOff, { label: metaFieldLabels().kontaktpersonNone })]
  }
  if (k === 'rueckmeldungNone') {
    return [fillTemplate(b ? P.metaNoneOn : P.metaNoneOff, { label: metaFieldLabels().rueckmeldungNone })]
  }
  if (k === 'partnerContacts') return _partnerLines((a ?? []) as PartnerContact[], (b ?? []) as PartnerContact[])
  if (k === 'gruppen') return _gruppenLines((a ?? []) as GruppeZeit[], (b ?? []) as GruppeZeit[])
  if (k === 'fahrzeuge') return _fahrzeugLines((a ?? []) as FahrzeugZeit[], (b ?? []) as FahrzeugZeit[])
  return undefined
}

/** «2 Personen · 1 Tier» — journal text AND the printed rapport's «Gerettet» box (the payload
 *  sends this string pre-formatted), so the count agrees with its noun exactly once, here. */
function _geretteteText(g?: { personen?: number; tiere?: number }): string {
  const R = appConfig.copy.report
  if (!g || (g.personen == null && g.tiere == null)) return ''
  const count = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`
  return [
    g.personen != null ? count(g.personen, R.gerettetePerson, R.gerettetePersonen) : null,
    g.tiere != null ? count(g.tiere, R.geretteteTier, R.geretteteTiere) : null,
  ].filter(Boolean).join(' · ')
}

/** «Partnerorganisation {org} ergänzt – Bemerkung: {note}» — the arrival and its remark as ONE
 *  statement. Composed from the two existing templates (metaPartnerAdded + the part of
 *  metaPartnerNote after its {org}), so every locale that translated those two says this the
 *  same way; a locale whose note template carries no {org} falls back to two lines. */
function _partnerAddedWithNote(org: string, note: string): string[] {
  const P = appConfig.copy.preflight
  const tail = P.metaPartnerNote.split('{org}')[1]
  if (!tail) return [fillTemplate(P.metaPartnerAdded, { org }), fillTemplate(P.metaPartnerNote, { org, note })]
  return [fillTemplate(P.metaPartnerAdded, { org }) + fillTemplate(tail, { note })]
}

/** Partnerorganisationen, diffed BY ORGANISATION: who was added, who was removed, whose remark
 *  changed — in that order, adds first, so the lines tell the edit the way it happened rather
 *  than the way it alphabetises. Blank rows (the two the block always keeps ready) are not
 *  organisations and are skipped, or opening the sheet would log two arrivals nobody recorded. */
function _partnerLines(before: PartnerContact[], after: PartnerContact[]): string[] {
  const P = appConfig.copy.preflight
  const key = (p: PartnerContact) => (p.org ?? '').trim().toLowerCase()
  const named = (xs: PartnerContact[]) => xs.filter((p) => [p.org, p.name, p.phone, p.note].some((v) => v?.trim()))
  const A = new Map(named(before).map((p) => [key(p), p]))
  const B = new Map(named(after).map((p) => [key(p), p]))
  const adds: string[] = []
  const changes: string[] = []
  for (const [k, p] of B) {
    const org = (p.org ?? '').trim()
    const note = (p.note ?? '').trim()
    const was = (A.get(k)?.note ?? '').trim()
    // ⚠️ An organisation arriving WITH its remark used to log only the arrival: «Sanität ergänzt»,
    // while «Ölwehr avisiert, ETA 20 min» — the operational half — never reached the Verlauf and
    // therefore never reached the printed journal either. ONE merged statement (two rows for one
    // tap read as two events; it is one arrival, remark and all).
    if (!A.has(k)) {
      if (org && note) adds.push(..._partnerAddedWithNote(org, note))
      else adds.push(org ? fillTemplate(P.metaPartnerAdded, { org }) : P.metaPartnerUnnamed)
      continue
    }
    if (note === was) continue
    // …and CLEARING one is a change too. `&& note` skipped it, so deleting a remark was the one
    // edit on this block that left no trace at all.
    changes.push(note
      ? fillTemplate(P.metaPartnerNote, { org, note })
      : fillTemplate(P.metaPartnerNoteCleared, { org }))
  }
  const removals: string[] = []
  for (const [k, p] of A) {
    if (!B.has(k)) removals.push(fillTemplate(P.metaPartnerRemoved, { org: (p.org ?? '').trim() }))
  }
  return [...adds, ...changes, ...removals]
}

/** Alarmzeit per Gruppe, named by its configured label — «g2» means nothing on paper. */
function _gruppenLines(before: GruppeZeit[], after: GruppeZeit[]): string[] {
  const P = appConfig.copy.preflight
  const labels = new Map((getDeploymentConfig().alarms?.groups ?? []).map((g) => [g.id, g.label || g.id]))
  const A = new Map(before.map((g) => [g.id, g]))
  const out: string[] = []
  for (const g of after) {
    if (A.get(g.id)?.alarmedAt === g.alarmedAt) continue
    const gruppe = labels.get(g.id) ?? g.id
    out.push(g.alarmedAt
      ? fillTemplate(P.metaGruppe, { gruppe, t: _clock(g.alarmedAt) })
      : fillTemplate(P.metaGruppeCleared, { gruppe }))
  }
  return out
}

/** The three Fahrzeug clocks, one line each — «Fahrzeugzeiten» named neither the vehicle nor
 *  which of its three times moved, on the grid where a whole Wehr's turnout is entered. */
function _fahrzeugLines(before: FahrzeugZeit[], after: FahrzeugZeit[]): string[] {
  const P = appConfig.copy.preflight
  const labels = new Map((getDeploymentConfig().fleet?.vehicles ?? []).map((v) => [v.id, v.label || v.id]))
  const A = new Map(before.map((v) => [v.id, v]))
  const out: string[] = []
  const slots: [keyof FahrzeugZeit, string][] = [
    ['ausgerueckt', P.metaFahrzeugAus], ['vorOrt', P.metaFahrzeugVorOrt], ['zurueck', P.metaFahrzeugZurueck],
  ]
  for (const v of after) {
    const fahrzeug = labels.get(v.id) ?? v.id
    const prev = A.get(v.id)
    for (const [slot, tpl] of slots) {
      const now = v[slot] as string | undefined
      if ((prev?.[slot] as string | undefined) === now) continue
      out.push(now ? fillTemplate(tpl, { fahrzeug, t: _clock(now) }) : fillTemplate(P.metaFahrzeugCleared, { fahrzeug }))
    }
  }
  return out
}

export function personalForPdf(
  roster: { id: string; name: string }[],
  attendance: AttendanceState,
  /** the incident's own bounds. They fill in what was never recorded: somebody ticked present
   *  with no check-in was there from the alarm, and somebody still present when the rapport is
   *  printed was there to the end. Both are DERIVED, and print grey so the paper says which
   *  times were measured and which the app worked out — a signed sheet must not blur the two. */
  bounds: { alarmedAt?: string | null; endedAt?: string | null } = {},
): { personal: PersonalPdfRow[] } {
  const clock = spanAwareClock(bounds)
  // Two ticks a minute apart are a correction, not a person who went home — see
  // attendanceIntervals · mergeCloseBlocks. The RECORD keeps both; the sheet prints one line.
  const gapMin = attendanceMergeGapMin()
  const rows = (name: string, a?: AttendanceState[string]): PersonalPdfRow[] => {
    const blocks = mergeCloseBlocks(intervalsOf(a), gapMin)
    if (!blocks.length) {
      const von = a ? clock(bounds.alarmedAt) : undefined
      const bis = a ? clock(bounds.endedAt) : undefined
      return [{ name, erfasst: !!a, times: [{ von, bis, vonDerived: !!von, bisDerived: !!bis }], note: a?.note }]
    }
    const alarmClock = clock(bounds.alarmedAt)
    const times = blocks.map((iv, i) => {
      const open = !iv.to
      const bis = open ? clock(bounds.endedAt) : clock(iv.to)
      const von = clock(iv.from)
      return {
        von, bis,
        // Somebody who was there from the alarm is the ordinary case, and their start is the
        // incident's own — nothing to check against. Only a check-in that DIFFERS from the
        // alarm says something the paper has to be read for. (First block only: a return
        // later in the Einsatz that happens to fall on the alarm minute is a real arrival.)
        vonDerived: i === 0 && !!von && von === alarmClock,
        // only the LAST open block inherits the incident's end — an earlier open block would
        // mean a missing check-out mid-incident, and filling that in would invent hours
        bisDerived: open && !!bis,
      }
    })
    // one row, every stretch — and the remark once, because it belongs to the person
    return [{ name, erfasst: true, times, note: a?.note }]
  }
  const rosterIds = new Set(roster.map((p) => p.id))
  const guests = Object.entries(attendance)
    .filter(([id]) => !rosterIds.has(id))
    .map(([, a]) => ({ name: a.displayNameSnapshot, a }))
    .sort((x, y) => x.name.localeCompare(y.name, 'de'))
    // …and they are MARKED as such on the sheet, the way the Anwesenheit screen marks them
    .flatMap(({ name, a }) => rows(name, a).map((r) => ({ ...r, guest: true })))
  return {
    personal: [
      ...roster.flatMap((p) => rows(p.name, attendance[p.id])),
      ...guests,
      { name: '', erfasst: false }, { name: '', erfasst: false },
    ],
  }
}

/** The Material worksheet rows for the SERVER-rendered PDF: the FULL catalogue,
 *  alphabetical (config load-out order reads as random on paper — 2026-07-18), with
 *  recorded totals filled in and amount stubs everywhere else — same shape as the blank
 *  Erfassungsblatt — plus recorded lines that aren't plain catalogue rows (custom
 *  labels / sourced positions) appended so nothing recorded is ever hidden. */
export function mittelFormForPdf(
  mittel: MittelEntry[],
  catalogue: { id: string; label: string; unit?: string }[],
): { mittelForm: { label: string; menge?: string; unit: string; note?: string }[] } {
  const noSource = appConfig.copy.mittel.noSource
  const recorded = mittelReportRows(mittel, noSource)
  const byKey = new Map(recorded.map((r) => [r.materialKey, r]))
  const rows: { label: string; menge?: string; unit: string; note?: string }[] = []
  // the remarks written on the line(s) behind this material — «an Werkhof übergeben», «defekt».
  // Joined because one material can be logged from two sources, each with its own note.
  const noteOf = (r: (typeof recorded)[number] | undefined) =>
    [...new Set((r?.items ?? []).map((i) => i.note?.trim()).filter(Boolean) as string[])].join(' · ') || undefined
  const sorted = [...catalogue].sort((a, b) => compareText(a.label, b.label))
  for (const c of sorted) {
    const unit = c.unit || appConfig.mittel.defaultUnit
    const hit = byKey.get(`${c.id}|${unit.trim().toLowerCase()}`)
    if (hit) byKey.delete(hit.materialKey)
    rows.push({ label: c.label, menge: hit && hit.total > 0 ? String(hit.total) : undefined, unit: unitLabel(unit), note: noteOf(hit) })
  }
  for (const r of byKey.values()) {
    if (r.total <= 0) continue
    const sources = r.sources.filter((s) => s !== noSource)
    rows.push({ label: sources.length ? `${r.label} · ${sources.join(', ')}` : r.label, menge: String(r.total), unit: unitLabel(r.unit), note: noteOf(r) })
  }
  return { mittelForm: rows }
}
