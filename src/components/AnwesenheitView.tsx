import { useEffect, useMemo, useRef, useState, type MouseEvent } from 'react'
import { Icon } from '../lib/icons'
import { SearchField } from './SearchField'
import type { AttendanceState, LngLat, Person, PresenceInterval, Shift, ShiftBand } from '../types'
import { ageMinutes, type LivePerson } from '../lib/usePersonPositions'
import { fmtDistance, haversineM } from '../lib/geo'
import type { ZeitplanSheet } from '../lib/zeitplanPrint'
import { cx } from '../lib/cx'
import { appConfig } from '../config/appConfig'
import { useIsPhone } from '../lib/useIsPhone'
import { incidentSlot, useIncidentSlot } from '../lib/draftKeep'
import { usePageHeadFit } from '../lib/pageHeadFit'
import { fillTemplate, fmtSpanShort, hhmm, stripUnprintable } from '../lib/format'
import { personnelProviderName } from '../lib/deploymentConfig'
import { applyTimeToIso, isoOnDay } from '../lib/abschluss'
import { rankDisplay, rankOrder } from '../lib/rank'
import { RankBadge } from './RankBadge'
import { matchesQuery, searchQuery } from '../lib/search'
import { intervalsOf, isPresent } from '../lib/attendanceIntervals'
import { isOnlyPresentMatch, matchesAny, stateMatches, toggled, type StateKey } from '../lib/attendanceFilter'
import { ortCounts, ortOf } from '../lib/attendanceOrt'
import { fmtDayShort, fmtStartValue, incidentDays, isOtherDay } from '../lib/zeitplanFormat'
import { fitSpan, nextHorizon, timelineSpan } from '../lib/shifts'
import { CaptureUsageChip, type CaptureUsage } from './CaptureUsageChip'
import { Segmented } from './Segmented'
import { PhoneTabBar } from './PhoneTabBar'
import { Menu, Sheet } from '../lib/overlays'
import { TimeBlockSheet } from './TimeBlockSheet'
import { timeBlockLabels } from '../lib/timeBlockLabels'
import { EmptyState } from './EmptyState'
import { SyncGlyph } from './SyncGlyph'
import { Button, IconButton } from './Button'
import { ShellLoader } from './ShellLoader'
import { ZeitplanView } from './ZeitplanView'
import { BandGrid } from './BandGrid'
import { AnrueckendBlock } from './AnrueckendBlock'
import s from './Anwesenheit.module.css'
import c from './SurfaceControls.module.css'

/** Zeitraum stops for the Zeitplan axis, in hours — from one watch to a WEEK. The long tail
 *  (120 h, 168 h) is for the deployment that does not end on day four: an Elementarereignis
 *  with a Pikett rota runs into a second week, and a plan that cannot show it is planned
 *  somewhere else. */
/** The head's ladder (lib/pageHeadFit): the poster read-out steps aside first, then the retry's word. */
const HEAD_FOLD = { qr: 1, reload: 2 } as const

const HORIZONS = [3, 6, 9, 12, 18, 24, 36, 48, 72, 96, 120, 168]

/** the Zeitplan's and the Schichten grid's writers on a session that has none (see planAvailable) */
const noop = () => {}



/** The three readings of this surface. `bands` is the Schichten grid — shift-major over discrete
 *  time, the transpose of the Zeitplan (see BandGrid). It is a TAB and not an entry in the ⋯ menu
 *  on purpose: a whole way of working does not belong behind three dots. */
type AnwesenheitTab = 'list' | 'plan' | 'bands'

/** Which tab was open, remembered in `sessionStorage` and stamped with the incident
 *  (lib/draftKeep · incidentSlot).
 *
 *  Deliberately not the device cookie it used to be. Coming back to the tab you were working
 *  in matters across a RELOAD mid-incident — that is what the memory is for — but a choice
 *  made last week should not decide where a fresh launch lands, and it should certainly not
 *  follow you into a different Einsatz. sessionStorage dies with the app; the incident stamp
 *  covers switching. Anything else falls back to the crew list, which is what this surface is
 *  for and the only one of the three that is useful before anyone has planned anything. */
const keptTab = incidentSlot<AnwesenheitTab>('kp-front-anwesenheit-tab', 'session')

/** A Zeitraum length for the read-out: «12», or «2,5» for a fitted half-hour window. */
const fmtHours = (h: number): string =>
  h.toLocaleString(appConfig.locale, { maximumFractionDigits: 1 })

/** …and whether «Nur Anwesende» was on, remembered exactly the same way and for the same reason:
 *  a narrowing survives the reload you did mid-Einsatz, and dies with the app. Default OFF — a
 *  list that opens already hiding people is a list that lies about the Mannschaft. */
const keptOnlyPresent = incidentSlot<boolean>('kp-front-anwesenheit-present-only', 'session')

// HH:MM of an ISO stamp — the tappable time chip / the <input type="time"> value
function toHM(iso: string): string {
  const d = new Date(iso)
  return Number.isNaN(d.getTime()) ? '' : hhmm(d)
}


/** a block's duration for the card head — nothing (not «NaN min») when an end is unparseable */
const spanOrNothing = (ms: number) => (Number.isFinite(ms) ? fmtSpanShort(ms) : undefined)

/**
 * Every recorded block of one person, opened from the row's «+».
 *
 * A single chip on the row can only ever show the LATEST block, which reads as the whole story
 * when somebody has come and gone twice. This lists them all, corrects any of them, and is where
 * a return is opened. Built on the SAME sheet the Zeitplan's Schichten use, so the two stay
 * identical rather than drifting apart.
 */
function PresenceSheet({ person, blocks, note, canEdit, startedAt, onSetTimes, onRemoveBlock, onSetNote, onRemoveGuest, onBack, onClose }: {
  person: Person
  blocks: PresenceInterval[]
  /** free remark on this person for this incident («Fahrer TLF», «abgelöst 21:40») */
  note?: string
  onSetNote?: (personId: string, note: string) => void
  /** take a hand-added person off the sheet entirely — never offered for a roster row */
  onRemoveGuest?: (p: Person) => void
  canEdit: boolean
  /** incident alarm time — drives the day labels and the «ab Beginn» shortcut */
  startedAt?: string | null
  onSetTimes?: (personId: string, patch: { from?: string; to?: string }, index?: number) => void
  /** drop one recorded block — the sheet was the only place it was visible and the only place it
   *  could not be removed, so a mis-tapped «Weiterer Block» was permanent */
  onRemoveBlock?: (personId: string, index: number) => void
  onBack: () => void
  onClose: () => void
}) {
  const A = appConfig.copy.anwesenheit
  const open = blocks.length > 0 && !blocks[blocks.length - 1].to
  // One clock, read once when the sheet opens, for «seit 29 min» on a running stretch. A lazy
  // initialiser rather than a bare Date.now() in the body: reading the wall clock during render is
  // impure and re-runs on every keystroke in a time field. The number then stands still while the
  // sheet is open, which is the right trade — this surface is transient, and a ticking hook here
  // is exactly the shape that once cost the phone its battery.
  const [openedAt] = useState(() => Date.now())
  return (
    <TimeBlockSheet
      title={fillTemplate(A.blocksTitle, { name: person.displayName })}
      subject={person.displayName}
      sectionTitle={A.blocksSection}
      emptyLabel={A.blocksNone}
      // no closing note (sweep 30.10.2026, owner: «a somewhat useless info field»): the rows are
      // plainly this person's times and plainly editable — the Zeitplan keeps its own hint
      // Always offered. While a block is still running, adding one closes it at this moment and
      // opens the next — that is a relief in place, and waiting for the row to be cycled to
      // «gegangen» first made the common case take two surfaces.
      addLabel={canEdit ? (open ? A.addBlock : A.backAgain) : undefined}
      onAdd={canEdit ? onBack : undefined}
      onClose={onClose}
      labels={timeBlockLabels(A.blockRemove)}
      days={incidentDays(startedAt, openedAt)}
      // The remark belongs to the person on THIS Einsatz, not to their roster entry: «Fahrer
      // TLF», «abgelöst 21:40». It sits with the times because that is the one surface that is
      // already about what this person did here, and it prints on the Personalblatt beside them.
      extra={canEdit && onSetNote ? (
        <label className="ip-field">
          <span>{A.noteLabel}</span>
          <input
            className="ip-input" defaultValue={note ?? ''} placeholder={A.notePlaceholder}
            // a remark is one line beside the name on the Personalblatt; an essay pasted in
            // here used to make the whole Rapport fail to compose (app/report · _clip_note)
            maxLength={240}
            onBlur={(e) => onSetNote(person.id, stripUnprintable(e.target.value))}
            onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur() }}
          />
        </label>
      ) : note ? (
        <div className="ip-field"><span>{A.noteLabel}</span><b>{note}</b></div>
      ) : null}
      // Only for somebody who is not on the Mannschaftsliste. A roster row cannot be «removed» —
      // it goes back to frei by tapping — but a hand-added person can be a mistake, and then there
      // has to be a way off the sheet. It lives HERE rather than on the row, because the row's tap
      // is the one gesture that must never delete anybody. In the footer, far left (the one
      // footer rule, UX sweep F5) — it used to trail the Bemerkung in the body.
      danger={canEdit && person.guest && onRemoveGuest ? (
        <Button variant="danger" icon={<Icon id="trash" />} onClick={() => onRemoveGuest(person)}>
          {A.removeGuest}
        </Button>
      ) : undefined}

      blocks={blocks.map((iv, i) => ({
        key: String(i),
        from: toHM(iv.from),
        to: iv.to ? toHM(iv.to) : undefined,
        // the day each end sits on — see TimeBlock.fromDay. Latent here today (the wheel only
        // appears once the incident spans more than one day) and wrong the moment it does.
        fromDay: new Date(iv.from),
        toDay: iv.to ? new Date(iv.to) : undefined,
        openLabel: A.stillHere,
        // Same card as the Zeitplan, but the head is a READ-OUT here: a stretch of presence has no
        // second state to flip into — it is running or it is finished, and that is decided by the
        // row in the list, not in this sheet. So no switch, and no «umschalten» on hover.
        head: iv.to
          ? { label: A.ended, tone: 'done' as const }
          : { label: A.running, tone: 'open' as const },
        duration: spanOrNothing((iv.to ? Date.parse(iv.to) : openedAt) - Date.parse(iv.from)),
        // mirror of onTo: a von typed after the bis means the block STARTED the previous day
        onFrom: canEdit && onSetTimes ? (v, day) => { const iso = day ? isoOnDay(day, v) : applyTimeToIso(iv.from, v, { prevDayIfAfter: iv.to }); if (iso) onSetTimes(person.id, { from: iso }, i) } : undefined,
        // ALWAYS, not only on a multi-day Einsatz: the clock alone never says which day, and a
        // recorded time is the half of this surface that ends up on the Rapport.
        dayLabel: fmtDayShort(new Date(iv.from)),
        toDayLabel: iv.to ? fmtDayShort(new Date(iv.to)) : undefined,
        warn: !!iv.to && Date.parse(iv.to) <= Date.parse(iv.from),
        // FIRST block only, and never when it would swallow this block's own end: pulling a
        // LATER block back to the alarm time made it span every earlier block, and totalMinutes
        // simply sums — a 2 h return became 38 h on the Rapport, counting block 1 twice.
        // Offered even when the start ALREADY is the alarm time — the tab then shows as pressed
        // and says so, instead of disappearing at the one moment you might want to return to it.
        // Still the FIRST stretch only: pulling a later one back to the alarm time makes it span
        // every earlier one, and totalMinutes simply sums — a 2 h return once reached the Rapport
        // as 38 h that way.
        onFromStart: canEdit && onSetTimes && startedAt && i === 0
          && (!iv.to || Date.parse(startedAt) < Date.parse(iv.to))
          ? () => onSetTimes(person.id, { from: startedAt }, i) : undefined,
        fromStartValue: startedAt ? fmtStartValue(startedAt, incidentDays(startedAt, openedAt)) : undefined,
        fromIsStart: !!startedAt && iv.from === startedAt,
        // «noch da» on EVERY end, as asked: emptying it says the person never left, and an open
        // stretch runs to the Einsatzende for the Rapport (attendanceIntervals.totalMinutes).
        // ⚠ It is deliberately NOT restricted to the last row any more — see the note in the
        // handover: opening an earlier stretch while a later one exists double-counts those hours.
        onReopen: canEdit && onSetTimes
          ? () => onSetTimes(person.id, { to: undefined }, i) : undefined,
        onRemove: canEdit && onRemoveBlock ? () => onRemoveBlock(person.id, i) : undefined,
        // also offered while the stretch is still OPEN — that is how it gets closed from here.
        // With no end yet, the start is the base the clock is written onto.
        onTo: canEdit && onSetTimes ? (v, day) => { const iso = day ? isoOnDay(day, v) : applyTimeToIso(iv.to ?? iv.from, v, { nextDayIfBefore: iv.from }); if (iso) onSetTimes(person.id, { to: iso }, i) } : undefined,
      }))}
    />
  )
}

/**
 * The chosen sheet, before it goes anywhere.
 *
 * Two menu entries and two ways out would be four entries; this is the fold. The sheet names what
 * it is about to produce — how many people, how many bands, as of when — which is both the
 * confirmation (paper is out of the machine before a toast has faded, and it does not undo) and
 * the sanity check on whether the search + rank filter above are set the way you meant.
 */
function PaperSheet({ sheet, people, bands, printOnline, onPrint, onDownload, onClose }: {
  sheet: ZeitplanSheet
  people: Person[]
  bands: number
  printOnline?: boolean
  onPrint?: () => Promise<void>
  onDownload?: () => Promise<void>
  onClose: () => void
}) {
  const Z = appConfig.copy.zeitplan
  const schicht = sheet === 'schichtplan'
  // read once, as the sheet opens: this is «Stand», the moment the sheet was asked for
  const [openedAt] = useState(() => new Date())
  // The sheet stays open with the loader in its button until the PDF is there (owner, 28.10.2026:
  // every print and download shows that it is working) – it used to close at once, and the
  // seconds the server takes looked like nothing had happened.
  const [busy, setBusy] = useState(false)
  // the PDF and the station printer both keep the sheet (and its loader) until they are done
  const run = async (act?: () => Promise<void>) => {
    if (!act) return
    setBusy(true)
    try { await act() } finally { setBusy(false) }
    onClose()
  }
  return (
    <Sheet open onClose={onClose} fit title={schicht ? Z.sheetSchichtplanTitle : Z.sheetVerfuegbarkeitenTitle}
      footer={
        <>
          {onDownload && (
            <Button disabled={busy} aria-busy={busy || undefined} icon={busy ? <ShellLoader /> : undefined}
              onClick={() => void run(onDownload)}>{busy ? Z.pdfBusy : Z.pdf}</Button>
          )}
          {onPrint && (
            <Button variant="primary" icon={<Icon id="printer" />} disabled={busy} onClick={() => void run(onPrint)}>
              {appConfig.copy.printRelay.send}
              <span className={`dot print-relay-dot${printOnline ? ' online' : ''}`} aria-hidden />
            </Button>
          )}
        </>
      }
    >
      <p className={s.paperContent}>
        {schicht
          ? fillTemplate(Z.sheetContentBands, { people: Z.peopleCount(people.length), bands: Z.bandsCount(bands), t: hhmm(openedAt) })
          : fillTemplate(Z.sheetContent, { people: Z.peopleCount(people.length), t: hhmm(openedAt) })}
      </p>
      <p className={s.paperHint}>{schicht ? Z.sheetSchichtplanHint : Z.sheetVerfuegbarkeitenHint}</p>
    </Sheet>
  )
}

// The Anwesenheit surface: one unified, compact grid of the whole Mannschaft. Each name is a
// button whose tap cycles its state — frei → anwesend → gegangen → frei — so a single view
// both shows and edits attendance with no mode switching (3am tenet: recognition over recall).
// A member in an active Atemschutz-Trupp is locked: tapping jumps to the Trupp instead of
/**
 * Where a person is, next to their name.
 *
 * This is the surface the whole live-position feature exists for: the FU is looking at the
 * crew list and wants to know that the two sent on the Wassertransport really are at the
 * Weiher — and how to reach them if not. So the chip is deliberately **neutral**: distance is
 * information, never a warning. Somebody 3 km out is doing what they were told, and colouring
 * that amber would turn a working picture into an accusation.
 *
 * Renders nothing at all when that person is not sharing — an empty slot says "no data",
 * which is honest, where a dash or a «kein Standort» label would imply something is missing.
 */
function LivePositionChip({ live, center, onShow }: {
  live: LivePerson | undefined
  center?: LngLat
  onShow?: () => void
}) {
  const L = appConfig.copy.livePosition
  if (!live) return null
  const mins = ageMinutes(live.at, Date.now())
  const dist = center ? fmtDistance(haversineM(center, live.coord)) : ''
  // Under the GPS noise floor there is no meaningful distance to state — «12 m» would be a
  // precision the fix does not have. At the Einsatzort is the useful reading anyway.
  const atScene = center ? haversineM(center, live.coord) < 60 : false
  const text = atScene
    ? L.atScene
    : fillTemplate(mins === 0 ? L.chipNow : L.chip, { d: dist, n: String(mins) })
  // Icon ONLY on the row. «63 m · jetzt» is the answer to a question you ask about ONE person,
  // and printed behind every name it became a second column of numbers competing with the name
  // — the thing the list is actually read for. The reading is not lost: it is the tooltip and
  // the accessible name, and tapping still puts the person on the map, which is the real answer.
  const label = `${text}${onShow ? ` – ${L.tapHint}` : ''}`
  return (
    <button
      type="button"
      className={cx(s.livePos, atScene && s.livePosHere)}
      onClick={onShow}
      disabled={!onShow}
      title={label}
      aria-label={label}
    >
      <Icon id="locate" />
    </button>
  )
}

// marking them gone (the checkout rule). Order is stable alphabetical so chips don't reflow
// under your finger while you tap.
export function AnwesenheitView({
  people, attendance, canEdit, loading, error, blockedIds, truppOfPerson,
  onAddGuest, onMarkPresent, onMarkLeft, onClear, onSetOrt, onJumpToTrupp, onReload, onUndo, onRedo, canUndo = false, canRedo = false, topBarUndoHidden = false, onSetTimes, onRemoveBlock, onSetNote, captureUsage,
  shifts, bands, onCreateBand, onSaveBand, onRemoveBand, onCycleCell, onSetCellState, onPutCellState,
  startedAt, onAddShift, onAddShiftSpan, onReplaceShift, onSetShiftTime, onRemoveShift,
  onPrintZeitplan, onDownloadZeitplan, zeitplanPrintOnline,
  livePositions, incidentCenter, onShowOnMap, incidentId, diveraResponsesFor,
}: {
  people: Person[]
  attendance: AttendanceState
  canEdit: boolean
  loading: boolean
  error: boolean
  /** person ids assigned to an active Trupp — locked against "Gegangen" until released */
  blockedIds: Set<string>
  /** record somebody who is not on the Mannschaftsliste — see useAttendanceActions · addGuest */
  onAddGuest?: (name: string) => void
  onMarkPresent: (p: Person) => void
  /** flip a present person between Einsatzort and Magazin — «wen könnte ich noch
   *  nachziehen» (see lib/attendanceOrt). Absent for a session that may not write. */
  onSetOrt?: (p: Person) => void
  onMarkLeft: (p: Person) => void
  onClear: (p: Person) => void
  /** the Trupp a locked row belongs to — the jump POINTS at that card, it does not merely
   *  open the Überwachung and leave the finding to whoever tapped */
  truppOfPerson: Map<string, string>
  onJumpToTrupp: (truppId?: string) => void
  onReload: () => void
  /** Take back the last tap on THIS list — the same step the ↶ in the top bar makes.
   *
   * ⚠️ It renders here ONLY while `topBarUndoHidden` says the top bar has dropped its history
   * pair — which since 15.09.2026 happens at exactly one width, below 360px, where the bar's
   * three gloved 44px actions leave the Einsatzname nothing (15-mobile.css). Any other time the
   * top bar's pair is the one door (06.09. — the always-on phone copy here duplicated it).
   * ⚠️ It used to be «while an Atemschutz-Alarmchip is in the bar», and that was the one moment
   * it must not have been: the pair vanished exactly while a Trupp was überfällig, and a Leitung
   * deleted by mistake was unreachable behind it. The Einsatzuhr yields to the chip now.
   * Absent for a session that may not write.
   *
   * ⚠️ Since 08.09.2026 it drives the ONE global timeline, not a stack of this list's own — so
   * «der letzte Tipp» here means the last tap anywhere, and it can perfectly well take back
   * something that happened on the Karte. It is handed the event so the confirmation caption
   * can be anchored at this button (lib/undoFlash), which is what keeps that honest. */
  onUndo?: (e: MouseEvent<HTMLButtonElement>) => void
  onRedo?: (e: MouseEvent<HTMLButtonElement>) => void
  canUndo?: boolean
  canRedo?: boolean
  /** the top bar has dropped its ↶ ↷ (below 360px) — only then does this head offer its own
   *  pair, see onUndo */
  topBarUndoHidden?: boolean
  /** correct a wrong auto-stamped time via the row's time chip (e.g. "gegangen" marked
   *  after the person already left) — same handler as the Rapport Stunden editor. Patches the
   *  CURRENT presence block; `index` targets an earlier one. */
  onSetTimes?: (personId: string, patch: { from?: string; to?: string }, index?: number) => void
  /** drop one recorded presence block (never the last one — that is what «frei» is for) */
  onRemoveBlock?: (personId: string, index: number) => void
  /** write the free remark on a person's attendance row */
  onSetNote?: (personId: string, note: string) => void
  /** QR self-reporting in use — «QR: N Einträge · zuletzt HH:MM» chip (informational) */
  captureUsage?: CaptureUsage | null
  /** Schichtenplanung — the second view of this same Mannschaft (see ZeitplanView) */
  shifts?: Shift[]
  /** …and the third: the named windows the Schichten grid puts up as columns (see BandGrid) */
  bands?: ShiftBand[]
  onCreateBand?: (label: string, from: string, to: string) => void
  /** rename + re-time in one commit; a re-time asks whether to drag the assigned people along */
  onSaveBand?: (id: string, label: string, from: string, to: string) => void
  onRemoveBand?: (id: string) => void
  /** one cell tap: leer → verfügbar → eingeteilt → leer */
  onCycleCell?: (band: ShiftBand, person: Person) => void
  /** settle a window that holds BOTH states for one person */
  onSetCellState?: (band: ShiftBand, person: Person, state: 'available' | 'confirmed') => void
  /** the right-click menu's explicit setter — like onSetCellState, but also fills an empty cell */
  onPutCellState?: (band: ShiftBand, person: Person, state: 'available' | 'confirmed') => void
  startedAt?: string | null
  onAddShift?: (p: Person) => void
  /** plan exactly the stretch swept out on the grid */
  onAddShiftSpan?: (p: Person, from: number, to: number) => void
  /** a whole shift replaced after a drag */
  onReplaceShift?: (sh: Shift, undoName?: string) => void
  onSetShiftTime?: (id: string, patch: { from?: string; to?: string }) => void
  onRemoveShift?: (id: string, personName: string) => void
  /** print / download one of the two Schichtenplanung sheets (rendered server-side) */
  /** resolves once the job is queued (or its failure was told) – the sheet waits for it */
  onPrintZeitplan?: (people: Person[], sheet: ZeitplanSheet) => Promise<void>
  /** resolves once the PDF is downloaded (or its failure was told) – the sheet waits for it */
  onDownloadZeitplan?: (people: Person[], sheet: ZeitplanSheet) => Promise<void>
  zeitplanPrintOnline?: boolean
  /** Self-reported live positions, keyed by person id (see lib/usePersonPositions). Absent for
   *  a session that may not read them — a link-scoped phone gets no crew picture at all. */
  livePositions?: Map<string, LivePerson>
  /** Einsatzort, to measure the distance from */
  incidentCenter?: LngLat
  /** jump to that person's dot on the Lage — the reason the chip is tappable */
  onShowOnMap?: (personId: string) => void
  /** stamps the remembered tab, so switching Einsatz starts on the crew list again */
  incidentId?: string
  /** The incident whose Divera Rückmeldungen the «Anrückend» block reads (AnrueckendBlock) —
   *  set only for a running Einsatz on a station with Divera, for the EL and the editors.
   *  Absent = no block, and no request: a station without Divera never sees it. */
  diveraResponsesFor?: string
}) {
  const [q, setQ] = useState('')
  const [rankSel, setRankSel] = useState<ReadonlySet<string>>(() => new Set())
  // Anwesenheit, Zeitplan and Schichten are three readings of the SAME filtered, ordered
  // Mannschaft — the search + rank filter above apply to all of them, so a name sits in the same
  // place whichever one is open.
  const [view, setView] = useIncidentSlot(keptTab, incidentId, 'list')
  const pickView = (v: AnwesenheitTab) => {
    setView(v)
    // the Zeitplan's zoom lasts only while the Zeitplan is on screen; the next visit opens fitted
    if (v !== 'plan') setHorizonH(null)
  }
  // one clock for the whole surface: it drives the «jetzt» line and the growing open bar. Only
  // ticks while the Zeitplan is on screen — the attendance list has nothing that moves.
  const [nowMs, setNowMs] = useState(() => Date.now())
  // how many hours of axis fit on screen. null = not zoomed, and the grid shows the Einsatz so
  // far + 1 h (lib/shifts · fitSpan, sweep B5 07.10.2026). Deliberately NOT stored: every open
  // starts fitted, and a picked Zeitraum lasts while the Zeitplan stays on screen (switching to
  // another tab resets it, see pickView). A stored 12 h (or
  // a 48 h from last month's Unwetter) opened tonight's Zimmerbrand on an empty grid, and
  // leaving the view is the way back to the fit, so no extra button is needed.
  const [horizonH, setHorizonH] = useState<number | null>(null)
  // the fitted window's length, for the read-out and as the zoom's starting stop
  const fitted = fitSpan(startedAt ?? null, nowMs)
  const fittedH = (fitted.to - fitted.from) / 3_600_000
  const shownH = horizonH ?? fittedH
  // finer steps than a doubling ladder: the difference between «tonight» and «the next two days»
  // is worth several stops, not two. From the fit, a step goes to the next stop past the fitted
  // length in that direction, so the first tap always visibly zooms.
  const stepHorizon = (dir: 1 | -1) => setHorizonH(nextHorizon(HORIZONS, shownH, dir))
  // person whose recorded presence blocks are open in a sheet
  const [blocksFor, setBlocksFor] = useState<string | null>(null)
  // which paper sheet was picked from the printer menu, and is now naming itself before it goes
  const [paper, setPaper] = useState<ZeitplanSheet | null>(null)
  useEffect(() => {
    if (view !== 'plan') return
    const t = setInterval(() => setNowMs(Date.now()), 30_000)
    return () => clearInterval(t)
  }, [view])
  // «Erneut versuchen» reports on itself, the same way «Jetzt synchronisieren» does
  // (IncidentSwitcher): Shell trail runs while the roster loads, and on success gives way to a
  // tick — which has to be shown HERE, because success also clears `error` and with it the
  // button's reason to exist. So the button stays for the tick's 2.5s, then leaves. `floorDone`
  // is the same 420ms floor as the sync button: a LAN round trip can settle in ~50ms, and a trail
  // that flicks past reads as a glitch rather than as work done.
  const [reloadPhase, setReloadPhase] = useState<'idle' | 'busy' | 'done'>('idle')
  const [reloadFloorDone, setReloadFloorDone] = useState(true)
  const reloadTimers = useRef<ReturnType<typeof setTimeout>[]>([])
  useEffect(() => () => { reloadTimers.current.forEach(clearTimeout) }, [])
  const runReload = () => {
    if (reloadPhase === 'busy' || loading) return
    setReloadPhase('busy')
    setReloadFloorDone(false)
    reloadTimers.current.push(setTimeout(() => setReloadFloorDone(true), 420))
    onReload()
  }
  useEffect(() => {
    if (reloadPhase !== 'busy' || loading || !reloadFloorDone) return
    // the fetch settled: still failing → back to the retry face; cleared → tick, then leave
    if (error) { setReloadPhase('idle'); return }
    setReloadPhase('done')
    reloadTimers.current.push(setTimeout(() => setReloadPhase('idle'), 2500))
  }, [reloadPhase, loading, reloadFloorDone, error])
  const A = appConfig.copy.anwesenheit
  // …and whether this is a phone, which is the only place the head carries a ↶ (see below)
  const isPhone = useIsPhone()
  // the roster's source, named only where this station has one (see deploymentConfig)
  const rosterProvider = personnelProviderName()

  // Distinct ranks present in the roster, most senior first — drives the quick-filter chips.
  // Only shown when at least one member carries a rank (else the row is noise).
  const ranksPresent = useMemo(() => {
    const keys = [...new Set(people.map((p) => p.rank).filter((r): r is string => !!r))]
    return keys.sort((a, b) => rankOrder(a) - rankOrder(b))
  }, [people])

  const counts = useMemo(() => {
    let present = 0
    let left = 0
    for (const a of Object.values(attendance)) {
      if (a.status === 'present') present++
      else if (a.status === 'left') left++
    }
    const { scene, station } = ortCounts(attendance)
    return { present, left, scene, station }
  }, [attendance])

  /* «NUR ANWESENDE» — one tap, all three tabs (18.09.2026).
   *
   * It used to be a planning-tab-only toggle that started ON, on the argument that the whole
   * Mannschaft on the Zeitplan axis buries the handful actually on scene. That default is gone
   * rather than left to fight this one: two ways to the same narrowing, one of them invisible and
   * pre-set, is exactly the surface that answers «wo ist die Hälfte meiner Leute» with silence.
   * ONE state now, one button, one remembered value, and it starts OFF everywhere — the crew list
   * is where people are marked present, and a list that opens already hiding the absent hides the
   * work still to be done. Somebody arriving in two hours stays plannable by default.
   *
   * ⚠️ «Anwesend» here means «Vor Ort» (attendanceFilter · PRESENT_STATE): the Magazin is not
   * here. It ANDs with the search and with both facets, like every other narrowing. */
  const [presentOnly, setPresentOnly] = useIncidentSlot(keptOnlyPresent, incidentId, false)
  const toggleOnlyPresent = () => setPresentOnly(!presentOnly)
  // …and the state narrowing, plus the one genuinely orthogonal flag. Both are SETS: several
  // picks inside a facet OR together («anwesend oder gegangen» = wer war überhaupt da), an empty
  // set means «alle». Every row carries the MARK the person row carries — the row's own look in
  // that state (plain · green tint · dimmed, 29.09.2026), the pin, the house, the Bemerkung dot —
  // so picking a filter and looking up what a glyph means stay the same gesture.
  const [stateSel, setStateSel] = useState<ReadonlySet<StateKey>>(() => new Set())
  // «hat eine Bemerkung» is the one flag that really is independent: anybody in any state can
  // carry one, so it rides ALONGSIDE the state rather than competing with it.
  const [noteOnly, setNoteOnly] = useState(false)
  const stateEntries = [
    // the three states carry NO mark (r35, 06.11.2026): a 14×10 swatch of the row's tint beside
    // the menu's checkbox read as a second, empty checkbox, and the list itself has no status mark
    // to echo. The word is the state; the two Ort glyphs below stand indented under it.
    { key: 'frei', cls: [], mark: null, label: A.statusFrei },
    { key: 'present', cls: [], mark: null, label: A.statusPresent },
    { key: 'left', cls: [], mark: null, label: A.statusLeft },
    // the two places, under the state they refine — both mean «anwesend, und zwar dort»
    { key: 'scene', cls: [s.markOrt], mark: <Icon id="pin" />, label: A.ortScene },
    { key: 'station', cls: [s.markOrt, s.markOrtStation], mark: <Icon id="station" />, label: A.ortStation },
  ] satisfies { key: StateKey; cls: string[]; mark: React.ReactNode; label: string }[]
  /** ⚠️ What is on is named in the button's TOOLTIP and marked with a fixed-size dot — it is
   *  never printed on the button. A label that appears when a filter is set changes the button's
   *  width, which moves every control after it on the line AND re-anchors the dropdown: the menu
   *  jumped sideways the moment you picked something in it. The dot is absolutely positioned, so
   *  the geometry is identical filtered or not — which matters more now that a facet can hold
   *  several picks and the label would be arbitrarily long. */
  const stateOn = [
    ...stateEntries.filter((e) => stateSel.has(e.key)).map((e) => e.label),
    ...(noteOnly ? [A.statusNote] : []),
  ].join(' · ')
  const rankOn = ranksPresent.filter((r) => rankSel.has(r)).map(rankDisplay).join(' · ')
  /** Attendance entries with no roster row: guests, mutual aid, an AdF who never synced. They
   *  are shaped like a Person so every row action below works on them unchanged — and the
   *  Rapport already prints them as guest lines. */
  const guests = useMemo((): Person[] => {
    const known = new Set(people.map((p) => p.id))
    return Object.entries(attendance)
      .filter(([id]) => !known.has(id))
      .map(([id, a]) => ({ id, displayName: a.displayNameSnapshot || id, active: true, updatedAt: '', guest: true }))
  }, [people, attendance])

  const rows = useMemo(() => {
    // umlaut-neutral, and one typo forgiven (lib/search) — «Mueller» finds Müller, «Widemr»
    // finds Widmer. A 66-name Mannschaft searched with gloves on cannot demand exact spelling.
    const needle = searchQuery(q)
    return [...people, ...guests]
      .filter((p) => !needle || matchesQuery(needle, p.displayName))
      // within a facet the picks OR; the facets AND with each other and with the search
      .filter((p) => matchesAny(rankSel, (r) => p.rank === r))
      // the quick ✓ — one tap, ANDing with everything else on this line
      .filter((p) => !presentOnly || isOnlyPresentMatch(attendance[p.id]))
      .filter((p) => matchesAny(stateSel, (k) => stateMatches(k, attendance[p.id])))
      .filter((p) => !noteOnly || !!attendance[p.id]?.note)
      // grouped by seniority (most senior first), alpha within a rank
      .sort((a, b) => rankOrder(a.rank) - rankOrder(b.rank) || a.displayName.localeCompare(b.displayName, 'de'))
  }, [people, guests, q, rankSel, presentOnly, stateSel, noteOnly, attendance])

  /* A status set from a SEARCH hands the field straight back, empty and focused (owner,
   * 23.10.2026): people are found by typing one name after the other rather than by scrolling,
   * and having to delete «meier» before typing «studer» was a step on every single person. The
   * focus() runs inside the tap's own handler, so a phone keeps its keyboard up. Without a query
   * nothing moves – a scrolled list stays where it is. */
  const searchRef = useRef<HTMLInputElement>(null)
  const nextSearch = () => {
    if (!q) return
    setQ('')
    searchRef.current?.focus()
  }

  // frei → anwesend → gegangen → frei. A present+locked member jumps to the Trupp instead.
  const cycle = (p: Person) => {
    const status = attendance[p.id]?.status
    // a locked row jumps to its Trupp instead – that leaves the list, so the search stays as it is
    if (status === 'present' && blockedIds.has(p.id)) { onJumpToTrupp(truppOfPerson.get(p.id)); return }
    nextSearch()
    if (status === 'present') {
      onMarkLeft(p)
    } else if (status === 'left') {
      // A roster row cycles back to «frei» — it is still on the Mannschaftsliste either way.
      // A guest's attendance entry IS the only record that they were ever here, so the same tap
      // would delete the person. They cycle back to «anwesend» instead, and removing one is an
      // explicit act in the Zeiten sheet — same rule as a hand-added Mittel, where 0 is a value
      // and «gelöscht» is a decision.
      if (p.guest) onMarkPresent(p)
      else onClear(p)
    } else {
      onMarkPresent(p)
    }
  }

  // where the axis reaches, in words — the grid's own span, so the two can never disagree
  const horizonEndLabel = useMemo(() => {
    const sp = timelineSpan(startedAt ?? null, [], {}, nowMs, horizonH)
    const end = new Date(sp.to)
    return `${isOtherDay(end, new Date(sp.from)) ? `${fmtDayShort(end)} ` : ''}${hhmm(end)}`
  }, [startedAt, nowMs, horizonH])

  // ⚠️ Guests are NOT in `people` — they are synthesised from attendance entries that have no
  // roster row (see `guests` above). Looking the clock button's person up in `people` alone meant
  // the sheet simply never opened for one, and since a guest deliberately cannot be cycled back
  // to «frei» (that tap would delete the only record they were ever here), the sheet is their ONE
  // way out — «Gast entfernen» lives in it. So a guest could be added and then never removed.
  // Searched across both lists, not across `rows`: `rows` is filtered by the search box and the
  // rank/anwesend filters, and typing while the sheet is open would otherwise close it.
  const blocksPerson = people.find((p) => p.id === blocksFor) ?? guests.find((p) => p.id === blocksFor)
  // ⚠️ Empty means NOBODY: no roster AND nobody recorded. An empty Mannschaftsliste alone (a fresh
  // tablet offline, an import that has not run) used to hide the list of the 28 already recorded
  // and the search – the one way to enter a Gast (sweep F.1, 23.10.2026).
  const empty = !people.length && !guests.length
  /** Every name already on this surface — the roster and everybody recorded for this Einsatz. */
  const knownNames = useMemo(
    () => new Set([...people, ...guests].map((p) => p.displayName.trim())),
    [people, guests],
  )
  // ⚠️ Gated on the DATA, not on the handlers (RBAC audit 22.10.2026): a viewer reads the shift
  // slice (the server allows it, both views have a read-only mode) and may print it, but has no
  // writer wired – gating on those hid the two tabs and the paper menu from every driver.
  // The views take their writers unconditionally and call none of them while `canEdit` is off.
  const planAvailable = !!shifts
  const showPlan = planAvailable && view === 'plan'
  // the Schichten grid is a reading of the same shift slice, so it rides the same gate – for a
  // session that cannot create a band only once there IS one: an empty grid offering nothing to
  // a viewer is worse than no third tab
  const bandsAvailable = planAvailable && !!bands && (canEdit || bands.length > 0)
  const showBands = bandsAvailable && view === 'bands'

  /* the Zeitraum zoom. A tablet carries it at the end of the search line; a PHONE in the empty
     corner of the grid's clock row, over the names (30.09.2026, owner: «the +/- 12h thing … uses
     up a lot of vertical space»). The search line has no room left there — search · ✓ · rank
     filter fill 360px — so it wrapped to a row of its own that held nothing else: 56px of a
     screen whose job is showing the Mannschaft. The corner was dead space; it stays put while
     the names and the hours scroll under it, and it sits on the axis the zoom changes. */
  const horizonCtl = showPlan ? (
    <div className={s.horizon}>
      <span className={s.horizonLabel}>{appConfig.copy.zeitplan.horizon}</span>
      {/* A ZOOM, not a stepper. «−» shows MORE time (the axis zooms out), which is why
          the number beside it grows — magnifier glyphs rather than −/+ so nobody reads
          it as «make this number smaller». */}
      <IconButton variant="secondary" onClick={() => stepHorizon(1)}
        disabled={shownH >= HORIZONS[HORIZONS.length - 1]} label={appConfig.copy.zeitplan.zoomOut}><Icon id="zoom-out" /></IconButton>
      <b className={s.horizonValue}>{fmtHours(shownH)} h</b>
      {/* At a constant px-per-hour the view is pixel-identical when you widen the window —
          only this number moved, and the scrollbar that would have hinted at more axis is
          ignored by iPadOS. Naming the end makes the control answer its own question. */}
      <span className={s.horizonEnd}>{fillTemplate(appConfig.copy.zeitplan.horizonUntil, { t: horizonEndLabel })}</span>
      <IconButton variant="secondary" onClick={() => stepHorizon(-1)}
        disabled={shownH <= HORIZONS[0]} label={appConfig.copy.zeitplan.zoomIn}><Icon id="zoom-in" /></IconButton>
    </div>
  ) : null

  /* THE GAST DOOR — the same one the Trupp picker has had since 04.09.: the search field IS the
   * name entry. You look for somebody, the Mannschaftsliste cannot answer, and the last row of
   * the list offers to record them under exactly the name you typed. It replaced a «+» that
   * opened a dialog with a second name field (11.09.): the one case where the list has no answer
   * was the case that asked the same question («wer») twice, in two places.
   * It exists only while something is typed, only on the crew list (the two planning tabs are
   * about time), and never for a name that is already standing here — that offer could only
   * produce a second row reading exactly like the first. */
  const typedName = q.trim()
  /** anything typed or ticked that narrows the crew list (the «Anrückend» block steps aside) */
  const narrowed = !!typedName || presentOnly || stateSel.size > 0 || rankSel.size > 0 || noteOnly
  const guestOffer = !showPlan && !showBands && canEdit && onAddGuest && typedName && !knownNames.has(typedName)
    ? typedName : ''
  /* …and the query goes with it: the rows that answered «mus» are not the way to the next person,
   * and the freshly recorded one appears in the unfiltered list right where they belong. */
  const addGuest = () => { if (guestOffer && onAddGuest) { onAddGuest(guestOffer); nextSearch() } }

  /* the three readings — ONE list, rendered in the head on a tablet and in the docked strip on a
     phone, so the two can never offer a different set */
  const viewOptions: { value: AnwesenheitTab; label: string }[] = [
    { value: 'list', label: A.viewList },
    { value: 'plan', label: A.viewPlan },
    ...(bandsAvailable ? [{ value: 'bands' as const, label: A.viewBands }] : []),
  ]

  // ONE ROW (lib/pageHeadFit): refit when what the head carries changes
  const headRef = useRef<HTMLElement>(null)
  usePageHeadFit(headRef, [
    counts.present, counts.station, counts.scene, counts.left, captureUsage?.writes, captureUsage?.lastAt,
    !!error, reloadPhase, loading, view, showPlan, showBands,
  ].join('|'))

  return (
    <div className={s.surface}>
      <header ref={headRef} className={s.head}>
        <div className={s.headTitles}>
          <h2>{A.title}</h2>
          {/* «12 anwesend · 3 gegangen» — and, once anybody is at the Magazin,
              where those twelve are. That second half IS the answer to «wen könnte ich noch
              nachziehen», so it belongs in the head and not behind a filter. Hidden while
              everybody is at the scene: on the ordinary Einsatz it would say «12 vor Ort · 0
              Magazin» forever, which is a line that teaches you to stop reading the head.
              ⚠️ UNDER THE TITLE, the way every other surface head carries its quiet line
              (tokens · --head-*). It used to be a full-width row of its own BELOW the tabs and
              the buttons — which fixed the real problem it had (squeezed into a 250px column it
              stacked five lines deep) at the cost of a head that was a different object from the
              three next to it. It is never cut (`data-fit-check`): where the one row runs out,
              the head's ladder folds the tiles' words and, last, gives the titles a row of their
              own where the counts may wrap (lib/pageHeadFit). */}
          <p className={s.headSummary} data-fit-check>
            {fillTemplate(A.summary, { present: counts.present })}
            {counts.station > 0 && (
              <> · {fillTemplate(A.summaryOrt, { scene: counts.scene, station: counts.station })}</>
            )}
            {/* «gegangen» closes the line. Between «anwesend» and the Ort split it sat in the
                middle of the two numbers that describe the crew ON HAND, which is not what it
                counts. Hidden at zero: a «0 gegangen» is not news on most Einsätze. */}
            {counts.left > 0 && <> · {fillTemplate(A.summaryLeft, { left: counts.left })}</>}
          </p>
        </div>
        <div className={s.headActions}>
          {/* The poster read-out, at the head of the tiles (28.09.2026 — it stood on a row of its
              own under the counts, and the page head is one row). Beside the title it was a pill
              competing with the panel's own heading; folded into the counts it muddled «wie steht
              es» with «womit wurde erfasst». A footnote nobody acts on, so it is the first thing
              the ladder takes away (it is still on the Rapport). */}
          <span className={s.headQr} data-fold={HEAD_FOLD.qr}>
            <span className="fold-long"><CaptureUsageChip usage={captureUsage} /></span>
          </span>
          {/* ⚠️ Phone only, and ONLY while the top bar has dropped its own pair (below 360px —
              see topBarUndoHidden): any other time the bar's ↶ ↷ are the one door,
              and this head showing a second pair was pure duplication (06.09.). The pair is
              whole — a ↶ without its ↷ makes the step back the one thing that cannot itself be
              taken back, and this cluster has the room at phone width (the overflow it hit
              between 601 and ~850px is above this breakpoint). */}
          {isPhone && topBarUndoHidden && onUndo && (
            <button className={c.iconBtn} onClick={onUndo} disabled={!canUndo}
              aria-label={A.undoTap} title={A.undoTap}>
              <Icon id="undo" />
            </button>
          )}
          {isPhone && topBarUndoHidden && onRedo && (
            <button className={c.iconBtn} onClick={onRedo} disabled={!canRedo}
              aria-label={A.redoTap} title={A.redoTap}>
              <Icon id="redo" />
            </button>
          )}
          {/* The Zeitplan's paper output. Kept MOUNTED in both views and merely hidden in the
              list — mounting it only for the Zeitplan made the view toggle jump sideways every
              time you switched tabs, because the actions row is right-aligned and one more button
              pushes everything along. Reserving the width keeps the toggle under your thumb. */}
          {/* Paper lives in a menu. Two more buttons on this line is what pushed the header past
              its own width between 601 and ~850px — where `.headActions` is flex:none, so nothing
              shrank and `overflow: hidden` simply cut the end off, taking «Aktualisieren» with it
              on an iPad held upright. One trigger instead of two also ends the old trick of
              keeping the pair mounted-but-invisible in the list view just to stop the toggle
              sliding sideways. */}
          {/* TWO sheets, chosen separately — they answer different questions, so the menu names
              both instead of guessing which was meant. «Schichtplan» only exists once there are
              bands to put across the top; «Verfügbarkeiten» is the one that exists regardless, and
              the only one on which a freihändige Zeit appears at all. Picking one opens a sheet
              that names its own contents and offers PDF and printer — which keeps the
              confirmation before paper starts moving, without four menu entries.
              Offered on the Zeitplan AND the Schichten tab: one surface, one way to paper. */}
          {(showPlan || showBands) && (onPrintZeitplan || onDownloadZeitplan) && (
            <Menu
              trigger={
                <button className={c.iconBtn} aria-label={appConfig.copy.zeitplan.paperMenu}
                  title={appConfig.copy.zeitplan.paperMenu}>
                  {/* icon + relay dot side by side, like the Rapport's print button — .iconBtn is
                      inline-grid, so as two loose children they stacked (printer OVER the dot) */}
                  <span className="print-send-main">
                    <Icon id="printer" />
                    {onPrintZeitplan && (
                      <span className={`dot print-relay-dot${zeitplanPrintOnline ? ' online' : ''}`} aria-hidden />
                    )}
                  </span>
                </button>
              }
              popupClassName={c.menuPop}
              itemClassName={() => c.menuItem}
              items={[
                ...(bands?.length ? [{
                  label: appConfig.copy.zeitplan.sheetSchichtplan,
                  onClick: () => setPaper('schichtplan'),
                }] : []),
                {
                  label: appConfig.copy.zeitplan.sheetVerfuegbarkeiten,
                  onClick: () => setPaper('verfuegbarkeiten'),
                },
              ]}
            />
          )}
          {/* Only when a fetch actually FAILED. It used to sit here permanently as
              «Aktualisieren», which said the wrong thing twice: the attendance never needed it
              (the workspace blob follows live), and the roster it really refreshed cannot change
              during an incident — only an admin's Divera sync moves it, and usePersonnel now picks
              that up in the background. What is left means what it says: that did not load, try
              again. */}
          {(error || reloadPhase === 'done') && (
            <Button className={cx('head-tile', error && 'amber')} onClick={runReload} data-fold={HEAD_FOLD.reload}
              disabled={loading || reloadPhase !== 'idle'}
              aria-label={A.reload} title={error ? A.loadFailedHint : undefined}>
              {loading || reloadPhase !== 'idle'
                ? <SyncGlyph done={reloadPhase === 'done'}
                    label={reloadPhase === 'done' ? appConfig.copy.incidentSwitcher.syncDone : A.loading} />
                : <Icon id="warn" />}
              {reloadPhase !== 'done' && (
                <span className="fold-long">{loading || reloadPhase === 'busy' ? A.loading : A.retry}</span>
              )}
            </Button>
          )}
        </div>
        {/* The three readings of this Mannschaft, in a slot of their OWN rather than inside the
            action cluster. Only offered where a Zeitplan can actually be edited/read — the surface
            is inert without the shift slice wired up.
            ⚠️ NOT on a phone (owner, 27.09.2026: «move the anwesenheit / zeitplan / schichten
            toggle also to the bottom → same as for the einsatzrapport»). There the same three go
            into the docked strip above the nav bar (PhoneTabBar, at the foot of this surface), so
            the head is the title and the counts and nothing else — the control that changes what
            you are looking at sits where the thumb already is, and the list starts ~60px sooner. */}
        {!empty && planAvailable && !isPhone && (
          <div className={s.headTabs}>
            <Segmented<AnwesenheitTab> tabs ariaLabel={A.viewLabel} value={view} onChange={pickView}
              options={viewOptions} />
          </div>
        )}
      </header>

      {/* always, even on an empty surface: the search is also the Gast entry */}
      <div className={c.controls}>
        {/* ⚠️ This field is a search AND the entry for somebody who is not on the
              Mannschaftsliste (see `guestOffer`), so what is typed here can end up on the
              Personalblatt: `stripUnprintable` on the way in, and the NAME's length cap — there
              is no second field left to clean it. Enter takes the offer when the roster has no
              answer at all, which is the one case where the query can only have been a name. */}
        <SearchField
          ref={searchRef} className={c.search} value={q} onChange={(v) => setQ(stripUnprintable(v))} placeholder={A.searchPlaceholder}
          aria-label={A.searchPlaceholder} inputMode="search" maxLength={80}
          onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); if (!rows.length) addGuest() } }}
        />
        {/* THE QUICK FILTER — «Nur Anwesende», one tap, on all three tabs (see the note at
            `presentOnly`). It sits between the search and the funnel because that is the order
            the questions come in: who, then who right now, then which Grad / which Status. It
            is a plain pressed button rather than a row inside the funnel on purpose — the one
            narrowing asked for often enough to cost a tap and not a menu. */}
        <button
          type="button"
          className={cx(c.iconBtn, presentOnly && c.iconBtnOn)}
          aria-pressed={presentOnly}
          // The button NAMES the filter and lets `aria-pressed` carry the state, the way the two
          // facet buttons beside it do. A label that flips to «tippen für …» on every press is an
          // instruction, and it made the accessible name of a control change under the finger.
          title={A.onlyPresent}
          aria-label={A.onlyPresent}
          onClick={toggleOnlyPresent}
        >
          {/* a TICK, the same glyph Mittel's «In Verwendung» carries: both mean «show only
              the ones that count right now». It used to be the people glyph, which the Grad
              filter beside it has a better claim to. */}
          <Icon id="check" />
        </button>
        {/* ⚠️ TWO buttons, one per QUESTION — «welcher Grad» and «wer ist wo». They were one
            merged funnel for an afternoon and it was wrong: a menu you open to reach either
            answer is slower than two you aim at, and the two facets have nothing to do with
            each other. Different glyphs so they are told apart without reading: the crew
            glyph for the Dienstgrad, the funnel for the state narrowing.
            Both narrow independently and AND together — «Of» + «anwesend» is one question.
            Neither button PRINTS what it has on (that changed its width and re-anchored the
            dropdown); each carries a fixed-position dot and names it in its tooltip.
            Both are `modal={false}` (the app-wide default is modal): with the backdrop in place
            a tap on the OTHER filter button first hits that backdrop, so switching between the
            two — which is the whole point of splitting them — costs two taps. Safe exactly here,
            because what lies under this bar is the filter row and the list, not the map. */}
        {ranksPresent.length > 1 && (
          <Menu
            modal={false}
            trigger={
              <button className={cx(c.iconBtn, rankSel.size > 0 && c.iconBtnOn)}
                aria-label={rankOn ? `${A.rankFilterLabel} – ${rankOn}` : A.rankFilterLabel}
                title={rankOn ? `${A.rankFilterLabel} – ${rankOn}` : A.rankFilterLabel}>
                {/* the crew glyph — this is the facet that sorts PEOPLE. It cost the
                    «nur Anwesende» toggle its own people icon (that one is a tick now,
                    matching Mittel's «In Verwendung»), because two identical glyphs side
                    by side on the planning tabs is worse than either choice of icon. */}
                <Icon id="people" />
              </button>
            }
            popupClassName={c.menuPop}
            itemClassName={() => c.menuItem}
            // CHECKBOXES, not a one-of-N: «Of + Wm» is the Kader, and that is a real question.
            // Base UI keeps the menu open on a checkbox, which is what composing a set needs.
            // «Alle» stays as its own row — it is the readable «nothing is filtered» state, and
            // un-ticking your way back out is a gesture nobody would find at 3am.
            items={[
              { kind: 'head' as const, label: A.rankFilterLabel },
              { kind: 'check' as const, label: A.rankAll, checked: rankSel.size === 0, onChange: () => setRankSel(new Set()) },
              // rankDisplay, NOT rankLabel: a rank the station's list does not cover came out
              // as a blank row (see lib/rank)
              ...ranksPresent.map((r) => ({
                kind: 'check' as const,
                label: rankDisplay(r),
                checked: rankSel.has(r),
                onChange: () => setRankSel((sel) => toggled(sel, r)),
              })),
            ]}
          />
        )}
        {/* Status/Ort/Bemerkung only mean something on the crew list — the two planning tabs
            are about time, and «wer ist im Magazin» is not a question you ask of a Zeitplan. */}
        {view === 'list' && (
          <Menu
            modal={false} // one-tap switch with the rank filter beside it — see the note above
            trigger={
              /* «Nach Status filtern», not the bare «Filtern»: the rank filter beside it names
                 its facet and this popup's own heading already does, so the hold tooltip was
                 the one place answering «which filter is this?» with «Filtern». */
              <button className={cx(c.iconBtn, (stateSel.size > 0 || noteOnly) && c.iconBtnOn)}
                aria-label={stateOn ? `${A.statusFilterLabel} – ${stateOn}` : A.statusFilterLabel}
                title={stateOn ? `${A.statusFilterLabel} – ${stateOn}` : A.statusFilterLabel}>
                <Icon id="filter" />
              </button>
            }
            popupClassName={c.menuPop}
            itemClassName={() => c.menuItem}
            items={[
              { kind: 'head' as const, label: A.statusFilterLabel },
              // «Alle» clears the states but LEAVES the Bemerkung flag: they are separate
              // questions, and a row under «Status» that silently switched off a checkbox
              // below the rule would be the same trap the split Ort group was.
              { kind: 'check' as const, label: A.statusAll, checked: stateSel.size === 0, onChange: () => setStateSel(new Set()) },
              ...stateEntries.map((e) => ({
                kind: 'check' as const,
                label: <span className={cx(s.markRow, ...e.cls)}>{e.mark}{e.label}</span>,
                checked: stateSel.has(e.key),
                onChange: () => setStateSel((sel) => toggled(sel, e.key)),
              })),
              // a CHECKBOX, not one more state: «hat eine Bemerkung» is the one flag that
              // really is orthogonal — anybody in any state can carry one. Base UI keeps the
              // menu open on a checkbox, which is right: it is rarely the only thing set.
              { kind: 'sep' as const },
              {
                kind: 'check' as const,
                // ⚠️ `.markNote`, not `.statusNote` — the latter is the COPY key beside it
                // (`A.statusNote`), and there is no such CSS class. CSS Modules resolved it to
                // undefined and cx dropped it, so this was the one row of the menu whose mark
                // was an empty 9px hole while every other row carried its own.
                label: <span className={cx(s.markRow, s.markNote)}><i />{A.noteOnly}</span>,
                checked: noteOnly,
                onChange: setNoteOnly,
              },
            ]}
          />
        )}
        {/* (no «+» beside the search any more: the search field itself takes a name that is not
            on the Mannschaftsliste — see `guestOffer` and the last row of the list.) */}
        {/* (the inline legend strip and its phone ⓘ popover are gone — both facets live in
            the two filter buttons above, which is also where the marks are looked up now.) */}
        {/* how far the axis reaches — it belongs on the search line beside the thing it filters,
            not on a row of its own pushing the grid down (a phone has no room left on that
            line: there it stands in the grid's own clock row, see `horizonCtl`) */}
        {!isPhone && horizonCtl}
      </div>

      {/* The ranks used to have a row of their own here. They now sit inline with the search (see
          .controls above) — on a desk screen seeing them all is faster than opening anything, but
          not at the price of a second band of chrome. On a PHONE they stay one button that carries
          its own state: neutral for «Alle», tinted and naming the rank while a filter is on, so a
          filtered list can never look like the whole Mannschaft. */}

      {empty && !guestOffer ? (
        <EmptyState className="empty-fill" icon={error ? 'warn' : 'people'}
          title={error ? A.loadFailedTitle : A.emptyTitle}
          // «Synchronisiere das Personal aus …» is an instruction for whoever keeps the roster;
          // a session that cannot keep anything gets the title alone
          sub={error ? A.loadFailedHint
            : !canEdit ? undefined
            : rosterProvider ? fillTemplate(A.emptyHintSync, { provider: rosterProvider }) : A.emptyHint}
          // a retry only for a fetch that FAILED – an empty roster that loaded fine has nothing to retry
          action={error ? <Button icon={<Icon id="rotate" />} onClick={onReload} disabled={loading}>{A.retry}</Button> : undefined} />
      ) : !rows.length && !guestOffer ? (
        <div className="no-hits">{fillTemplate(appConfig.copy.noHits, { q: q.trim() })}</div>
      ) : showBands ? (
        <BandGrid
          people={rows}
          shifts={shifts!}
          bands={bands!}
          canEdit={canEdit && !!onCreateBand}
          startedAt={startedAt ?? null}
          attendance={attendance}
          onAddShift={onAddShift ?? noop}
          onSetShiftTime={onSetShiftTime ?? noop}
          onReplaceShift={onReplaceShift ?? noop}
          onRemoveShift={onRemoveShift ?? noop}
          onCreateBand={onCreateBand ?? noop}
          onSaveBand={onSaveBand ?? noop}
          onRemoveBand={onRemoveBand ?? noop}
          onCycleCell={onCycleCell ?? noop}
          onSetCellState={onSetCellState ?? noop}
          onPutCellState={onPutCellState ?? onSetCellState ?? noop}
        />
      ) : showPlan ? (
        <ZeitplanView
          people={rows}
          attendance={attendance}
          shifts={shifts!}
          canEdit={canEdit && !!onAddShift}
          startedAt={startedAt ?? null}
          nowMs={nowMs}
          onAdd={onAddShift ?? noop}
          onSetTime={onSetShiftTime ?? noop}
          onRemove={onRemoveShift ?? noop}
          onAddSpan={onAddShiftSpan ?? noop}
          onReplace={onReplaceShift ?? noop}
          horizonH={horizonH}
          zoom={isPhone ? horizonCtl : undefined}
        />
      ) : (
        <div className={s.grid}>
          {/* «Anrückend» — the Divera answers, as the grid's first cell across all columns. Only
              on the unfiltered list: a search or a narrowing asks about the Mannschaft, and a block
              that ignored it would stand there answering a different question. */}
          {diveraResponsesFor && !narrowed && (
            <AnrueckendBlock incidentId={diveraResponsesFor} people={people} attendance={attendance}
              canEdit={canEdit} onMarkPresent={onMarkPresent} />
          )}
          {rows.map((p) => {
            const a = attendance[p.id]
            const present = isPresent(a)
            const left = !!a && !present
            const locked = present && blockedIds.has(p.id)
            const blocks = intervalsOf(a)
            return (
              <div key={p.id} className={cx(s.person, present && s.isPresent, left && s.isLeft)}>
                <button
                  type="button"
                  className={s.personMain}
                  disabled={!canEdit}
                  onClick={() => cycle(p)}
                  // «zuerst über Raus melden austreten» tells a writer how to get the row free
                  title={locked && canEdit ? A.lockedTitle
                    : !p.active ? (rosterProvider ? fillTemplate(A.notInSource, { provider: rosterProvider }) : A.notInDivera)
                      : undefined}
                >
                  {/* no status dot (29.09.2026, owner: the tint alone says «anwesend»); the state
                      word rides in the button's name for a screen reader instead */}
                  <span className="sr-only">{present ? A.statusPresent : left ? A.statusLeft : A.statusFrei}: </span>
                  {/* the app's one Dienstgrad chip — it renders nothing for a rank the station's
                      list has no abbreviation for (an EMPTY badge in front of the name, once) */}
                  <RankBadge rank={p.rank} />
                  {/* somebody recorded for this Einsatz only — the badge sits where a Grad would,
                      so the row still reads «who is this» before it reads the name */}
                  {p.guest && <span className={cx(s.rank, s.guestBadge)}>{A.guestBadge}</span>}
                  <span className={s.name}>{p.displayName}</span>
                  {/* ⚠️ NO remark text in the row. It was shown here so it would not be
                      forgotten — and it took the width away from the NAME («Anna Me…»), which is
                      the one thing this list exists to show. The remark lives in the person's
                      sheet; a dot on the clock button says there IS one. */}
                  {locked && <Icon id="gauge" />}
                </button>
                {/* NO time on the row. It carried a whole editor — and once a start sitting on the
                    alarm time read «ab Beginn», that word alone took most of the width and crushed
                    the name to «B…», which is the one thing this list must never do. The times
                    belong to the sheet, where a person's several stretches are all visible at once
                    instead of just the latest. The row answers «who is here», the sheet «since
                    when, exactly». */}
                {/* Rückkehr — the tap cycle's third step CLEARS the row (frei), and it must keep
                    doing that (it is the only way back from a mis-tick). So coming back gets its
                    own control: it opens a NEW block instead of reopening the closed one. */}
                {/* THE one clock in the row, always there: it opens the sheet where several
                    stretches — came, went, came back — are added and corrected. The chip beside it
                    edits the single time shown; this is the way to all the others. */}
                {/* Am Einsatzort oder noch im Magazin. ONE tap flips it, and the chip says
                    which it is in a word — this is read at a glance down a column of 12 names,
                    so it must not be a colour alone. Only on somebody who is HERE: «wo ist
                    jemand, der gegangen ist» has no answer worth a control. */}
                {present && (
                  canEdit && onSetOrt ? (
                    <button
                      type="button"
                      className={cx(s.ort, ortOf(a) === 'station' ? s.ortStation : s.ortScene)}
                      title={fillTemplate(ortOf(a) === 'station' ? A.ortToScene : A.ortToStation, { name: p.displayName })}
                      aria-label={fillTemplate(ortOf(a) === 'station' ? A.ortToScene : A.ortToStation, { name: p.displayName })}
                      onClick={() => onSetOrt(p)}
                    >
                      <Icon id={ortOf(a) === 'station' ? 'station' : 'pin'} />
                    </button>
                  ) : (
                    <span className={cx(s.ort, ortOf(a) === 'station' ? s.ortStation : s.ortScene)}>
                      <Icon id={ortOf(a) === 'station' ? 'station' : 'pin'} />
                    </span>
                  )
                )}
                <LivePositionChip
                  live={livePositions?.get(p.id)}
                  center={incidentCenter}
                  onShow={onShowOnMap ? () => onShowOnMap(p.id) : undefined}
                />
                {/* for a session that cannot write too (RBAC audit 22.10.2026): the sheet is the
                    only place the Zeiten and the Bemerkung can be READ, and it has a read-only mode
                    – the «mit Bemerkung» filter found people whose remark nobody could open */}
                {blocks.length > 0 && (
                  <button
                    type="button"
                    className={cx(s.backBtn, attendance[p.id]?.note && s.hasNote)}
                    /* ⚠️ The blue dot on this button means «da steht eine Bemerkung» and nothing
                       on the row said so — a mark you have to be told about is a mark nobody
                       reads. It is named in the filter menu now, and the button says it too. */
                    title={fillTemplate(attendance[p.id]?.note ? A.openBlocksNote : A.openBlocks, { name: p.displayName })}
                    aria-label={fillTemplate(attendance[p.id]?.note ? A.openBlocksNote : A.openBlocks, { name: p.displayName })}
                    onClick={() => setBlocksFor(p.id)}
                  >
                    <Icon id="clock" />
                  </button>
                )}
              </div>
            )
          })}
          {/* THE GAST DOOR, LAST under the matches — the same place and the same shape the Trupp
              picker gives it. It carries the typed name itself, so the row says what the tap will
              do instead of opening a field to ask again; and it wears the «Gast» badge the row it
              is about to create will wear, in the slot a Grad would take. */}
          {guestOffer && (
            <div className={s.person}>
              <button type="button" className={s.personMain} onClick={addGuest}>
                <span className={cx(s.rank, s.guestBadge)}>{A.guestBadge}</span>
                <span className={s.name}>{fillTemplate(A.addGuest, { name: guestOffer })}</span>
              </button>
            </div>
          )}
        </div>
      )}

      {paper && (
        <PaperSheet
          sheet={paper}
          people={rows}
          bands={bands?.length ?? 0}
          printOnline={zeitplanPrintOnline}
          onPrint={onPrintZeitplan ? () => onPrintZeitplan(rows, paper) : undefined}
          onDownload={onDownloadZeitplan ? () => onDownloadZeitplan(rows, paper) : undefined}
          onClose={() => setPaper(null)}
        />
      )}

      {blocksPerson && (
        <PresenceSheet
          person={blocksPerson}
          blocks={intervalsOf(attendance[blocksPerson.id])}
          note={attendance[blocksPerson.id]?.note}
          canEdit={canEdit}
          startedAt={startedAt}
          onSetTimes={onSetTimes}
          onRemoveBlock={onRemoveBlock}
          onSetNote={onSetNote}
          onRemoveGuest={(p) => { setBlocksFor(null); onClear(p) }}
          /* stays open: the new block appears in the list you are looking at, so a mis-tap is
             seen and can be corrected on the spot */
          onBack={() => onMarkPresent(blocksPerson)}
          onClose={() => setBlocksFor(null)}
        />
      )}

      {/* PHONE: the three readings as the docked strip above the nav bar — the Rapport's own
          (PhoneTabBar · 15-mobile.css `.rp-tabs`). Rendering it is what reserves its lane:
          `--rp-tabs-safe` lifts this shell's bottom edge, the FAB and «Zurück zum Rapport». */}
      {!empty && planAvailable && isPhone && (
        <PhoneTabBar<AnwesenheitTab> ariaLabel={A.viewLabel} value={view} onChange={pickView} options={viewOptions} />
      )}
    </div>
  )
}
