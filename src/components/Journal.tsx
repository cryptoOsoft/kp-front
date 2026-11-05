import { Fragment, useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import type { PlanDocument, TimelineEvent } from '../types'
import { linkParts, type JournalLink } from '../lib/journalLinks'
import { Icon } from '../lib/icons'
import { SearchField } from './SearchField'
import { InfoToggle } from './InfoToggle'
import { EmptyState } from './EmptyState'
import { Button } from './Button'
import { Disc, JournalRow, type AudioWindow, type RingState } from './JournalRow'
import { Menu, Overlay, Sheet } from '../lib/overlays'
import { openPhoto } from '../lib/ui'
import { appConfig } from '../config/appConfig'
import { dueClock, fillTemplate, fmtDuration, formatTime } from '../lib/format'
import { thumbUrl } from '../lib/mediaUrl'
import { ART_DISC, groupByDay, isHandWritten, isNachtrag, pendenzenBelow, pendenzenCut, repeatRuns, rowPhotos, rowTarget, rowText, stripDensity, stripScale, type ArtTone, type LiveTargets } from '../lib/verlauf'
import { journalDisc, withoutAreaPrefix } from '../lib/report'
import { journalQuery, matchesJournalQuery } from '../lib/journalSearch'
import { journalCategories, journalFacets, matchesJournalCategories, showsPinnedPendenzen, type JournalCategoryKind } from '../lib/journalFilter'
import type { OpenReminder } from '../lib/reminders'
import { cardinalIndex, fmtDistance, takenClock, type PhotoPlacement } from '../lib/photoGeo'

/** HH:MM of an ISO instant — the Pendenzen block's time column and its Meldung lines. */
function rowClock(iso: string): string {
  const d = new Date(iso)
  return Number.isNaN(d.getTime()) ? '–' : formatTime(d)
}

/** «vor 54 min» / «vor 3 h» — the other half of the time column, one tap away. */
function ageLabel(iso: string, nowMs: number, C: typeof appConfig.copy.journal): string {
  const t = Date.parse(iso)
  if (!Number.isFinite(t)) return '–'
  const mins = Math.max(0, Math.round((nowMs - t) / 60_000))
  return mins < 90 ? C.ageLabel.replace('{n}', String(mins)) : C.ageLabelHours.replace('{n}', String(Math.round(mins / 60)))
}

// One <audio> for the whole drawer: play toggles, a second tap pauses, and the row that
// is sounding shows a pause icon + a "playing" pulse so it's obvious what's playing.
function useAudioPlayer() {
  const ref = useRef<HTMLAudioElement | null>(null)
  const [playing, setPlaying] = useState<string | null>(null)
  useEffect(() => () => { ref.current?.pause(); ref.current = null }, [])
  const toggle = (id: string, url: string) => {
    if (playing === id && ref.current) { ref.current.pause(); setPlaying(null); return }
    ref.current?.pause()
    const a = new Audio(url)
    ref.current = a
    a.onended = () => setPlaying((p) => (p === id ? null : p))
    a.onpause = () => setPlaying((p) => (p === id ? null : p))
    void a.play().then(() => setPlaying(id)).catch(() => setPlaying(null))
  }
  return { playing, toggle }
}

/** Breathing room, in px, at each end of the activity strip. THE source of truth for it: the
 *  track is inset by this and the tap→time maths subtracts it, so the two cannot drift apart
 *  and leave a tap landing a few minutes off what the ticks show. */
const STRIP_INSET = 10
/** A strip column holding this many rows or more draws a step darker (`.jr-strip i[data-busy]`). */
const STRIP_BUSY = 3

/** Rows the log mounts at first, and how many more each scroll to the tail reveals. */
const PAGE_ROWS = 150

/** The Verlauf's icon legend, opened from the drawer head. Read at call time so the resolved
 *  locale applies. Deliberately NOT exhaustive: it names the Bereiche a reader meets, not every
 *  glyph the app can stamp on a row — a complete table would be a page, and the question it
 *  answers is «what is that circle beside the sentence». */
function legendEntries(): { label: string; icon?: string; surface?: 'map' | 'plan'; tone?: ArtTone; ring?: RingState }[] {
  const C = appConfig.copy.journal
  const R = appConfig.copy.report
  return [
    { icon: 'circle', surface: 'map', label: C.surfaceMap },
    { icon: 'flag', surface: 'plan', label: C.surfacePlan },
    { icon: 'people', label: R.areaAnwesenheit },
    { icon: 'gauge', label: R.areaAtemschutz },
    { icon: 'box', label: R.areaMittel },
    { icon: 'clipboard', label: R.areaRapport },
    { icon: 'check', label: R.areaChecklist },
    { icon: 'type', label: C.entryTypes.info },
    { ...ART_DISC.auftrag, label: C.entryTypes.auftrag },
    { ...ART_DISC.sofort, label: C.entryTypes.sofort },
    { ring: 'open', label: C.legendPendenzOpen },
    { ring: 'urgent', label: C.legendPendenzUrgent },
    { ring: 'done', label: C.legendPendenzDone },
  ]
}

/** The disc a filter row wears — the legend's disc for the same Bereich, so the menu reads as the
 *  legend with ticks. Auftrag and Sofortmassnahme wear their Art's disc, as their rows do
 *  (lib/verlauf · ART_DISC); «Info» keeps the composer's «T». */
const FILTER_DISC: Record<JournalCategoryKind, { icon?: string; surface?: 'map' | 'plan'; tone?: ArtTone; ring?: RingState }> = {
  manual: { icon: 'type' }, auftrag: ART_DISC.auftrag, sofort: ART_DISC.sofort, pendenz: { ring: 'open' },
  map: { icon: 'circle', surface: 'map' }, plan: { icon: 'flag', surface: 'plan' },
  anwesenheit: { icon: 'people' }, atemschutz: { icon: 'gauge' }, mittel: { icon: 'box' },
  rapport: { icon: 'clipboard' }, checklist: { icon: 'check' }, system: { icon: 'doc' },
}

/** The Verlauf drawer's props (JournalRow picks the ones a row needs). */
export type JournalProps = {
  deliveryNotice?: ReactNode
  events: TimelineEvent[]
  plans: PlanDocument[]
  /** what still exists in the Einsatz – a row whose object is gone is no jump (lib/verlauf · rowTarget) */
  live: LiveTargets
  /** the linkable vocabulary (lib/journalLinks) — the SAME memo the composer marks with, so a
   *  name that lit up while it was being typed still lights up once it is a row */
  vocab?: JournalLink[]
  /** the Einsatzende (incident closed_at) — rows appended after it render as Nachträge */
  closedAt?: string | null
  onSelect: (e: TimelineEvent) => void
  onClose: () => void
  onTranscript?: (id: string, transcript: string) => void
  /** start time-travel replay from the Verlauf (closes the drawer). Absent while
   *  replay is already running. */
  onReplay?: () => void
  /** still-open reminders (by derived state) — lets a `created` row show its due time
   *  and a checklist-style done toggle. Absent ⇒ reminder rows render as plain log lines. */
  openReminders?: OpenReminder[]
  /** mark a reminder done preemptively from its Verlauf row (appends a done event). */
  onReminderDone?: (r: OpenReminder) => void
  /** write a Meldung on an open item — opens the ordinary composer pre-linked to it. */
  onReminderNote?: (r: OpenReminder) => void
  /** «wieder in …»: re-raise a CLOSED item as a fresh timed Wiedervorlage (new id, same
   *  text — appends a new `created` row, the record stays whole). Offered on `done` rows,
   *  because the moment a Lagerapport-Pendenz is ticked off is exactly when the next one
   *  gets its time (Führungsrhythmus, Handbuch 2.4). Absent ⇒ no chips (viewer, replay). */
  onReminderAgain?: (reminderId: string, mins: number) => void
  /** offline-queue status of a row's media (photo/audio not yet on the server), or undefined
   *  once uploaded — drives the "wird geladen"/"nicht geladen" chip on media rows. */
  mediaStatusOf?: (rowId: string) => 'pending' | 'failed' | undefined
  /** open the Durchhören player sheet for a long recording (rows with audioMeta);
   *  seekSec jumps straight to a moment inside it (annotation rows link back) */
  onOpenPlayer?: (e: TimelineEvent, seekSec?: number) => void
  /** correct a HAND-WRITTEN row's text — append-only `textEdit` patch, same pattern as the
   *  transcript edit. Offered on everything a person typed (composer entries, Meldungen,
   *  Nachdokumentation in the player) and on nothing the app wrote about an action; the
   *  corrected line is marked «Korrigiert HH:MM». See lib/verlauf · isHandWritten. */
  onEditText?: (id: string, text: string) => void
  /** where picture `i` of a row was taken, and what it can do on the Karte (lib/photoGeo ·
   *  photoPlacement). `null` for a picture without a position — the sheet then says nothing. */
  photoPlacement?: (e: TimelineEvent, i: number) => PhotoPlacement | null
  /** «Auf Karte setzen»: place the row's pictures that know their place. Absent where the Karte
   *  may not be written (viewer, Einsatzleiter, replay) — the button is then not drawn. */
  onPhotoPlace?: (e: TimelineEvent) => void
  /** «Auf Karte zeigen»: a picture of this row is on the Karte already */
  onPhotoShow?: (entityId: string) => void
  /**
   * The replay playhead. Set ⇒ this Verlauf is being read alongside a Wiedergabe: rows after
   * this instant are the FUTURE and render dimmed, and the row the playhead stands in is marked.
   * ⚠️ It is not a live clock — it only changes when the playhead crosses a row (ReplayBar ·
   * onPlayhead), so this list does not re-render on every playback frame.
   */
  replayAtMs?: number | null
  /** during replay a row sets the MOMENT rather than flying to a place — the whole picture then
   *  reads as it did when the line was written, which is the question a pin only half answered */
  onSeekTo?: (e: TimelineEvent) => void
  /** scroll to one row and flash it when the drawer opens onto it (the Wiedergabe caption's
   *  «im Verlauf»). `nonce` so the same row twice in a row still lands. */
  landOn?: { id: string; nonce: number } | null
}

// The unified Verlauf — the single, append-only stream of everything that
// happens on either surface. Rendered as a slide-over so it can open over the
// map or the plan; a row jumps back to wherever its event happened. Each row is
// a <JournalRow>; the row's detail sheet is rendered here, at the bottom.
export function Journal({ events, plans, live, closedAt, vocab = [], onSelect, onClose, onTranscript, onReplay, openReminders, onReminderDone, onReminderNote, onReminderAgain, mediaStatusOf, onOpenPlayer, onEditText, replayAtMs, onSeekTo, landOn, deliveryNotice, photoPlacement, onPhotoPlace, onPhotoShow }: JournalProps) {
  // read per-render (not module-load) so the resolved locale is applied — see config/copy
  const C = appConfig.copy.journal
  const audio = useAudioPlayer()
  // open reminders keyed by id, plus a clock captured when the drawer opens (it remounts on
  // each open, so this is "now" at open time) to flag overdue rows
  const openMap = new Map((openReminders ?? []).map((r) => [r.id, r]))
  // id → the item's own words, so a Meldung row can name what it is an answer to. Built from the
  // `created` rows themselves (not from `openReminders`), or a Meldung on an item that has since
  // been ticked off would lose its anchor the moment it was closed.
  const pendenzTitles = useMemo(() => new Map(
    events.filter((e) => e.reminder?.op === 'created')
      .map((e) => [e.reminder!.id, (e.reminder!.text ?? e.text).trim()] as const),
  ), [events])
  /** …and the row each one was raised on, so the reference on a Meldung can jump back to it. */
  const pendenzRowIds = useMemo(() => new Map(
    events.filter((e) => e.reminder?.op === 'created').map((e) => [e.reminder!.id, e.id] as const),
  ), [events])
  const [now] = useState(() => Date.now())
  // Whether the Pendenzen box's time column shows the clock or the age. Per-opening (the drawer
  // remounts on each open) — a reading preference for the minute you are in, not a setting.
  // ⚠️ EVERY open item is rendered, and nothing measures whether they fit any more. The box is a
  // scroll container of its own (see `.jr-pinned`), so the eleventh item is reached by the same
  // flick as the second. The cap-and-«Aufklappen» pair this replaces existed only because the
  // block used to be sticky INSIDE the log, where it could not scroll itself.
  const [showAge, setShowAge] = useState(false)
  // the icon legend. Per-opening like `showAge`, and closed to begin with — see the button.
  const [showLegend, setShowLegend] = useState(false)
  // ── the search (mock verlauf-02, 14.09.) ──
  // `null` = closed; a string (even '') = the field has REPLACED the head row. Per-opening like
  // the legend: the drawer remounts on each open, so closing it is what resets the search.
  // Escape closes ONE thing, innermost first (Overlay · onEscape, 26.09.2026): an open search or
  // inline editor, and only then the drawer. It used to be `dismissEscape={false}` — the drawer
  // owned the key and never closed on it, so on a tablet Esc did nothing at all.
  const [search, setSearch] = useState<string | null>(null)
  const query = useMemo(() => (search == null ? null : journalQuery(search)), [search])
  const searching = search != null
  // ── the filter (feat 37 · option B, 23.09.2026) ──
  // The ticked categories (lib/journalFilter): empty = «alle». Per-opening like the search it
  // combines with — the drawer remounts on each open, so closing it resets both. Never stored,
  // never synced: it is how this reader is looking right now, not a fact about the Einsatz.
  // ⚠️ It narrows the LIST and nothing else. «Wiedergabe starten» closes the drawer (so the next
  // opening starts unfiltered), and the Wiedergabe always plays the whole picture — a replay
  // that left out what was filtered away would show a Lage that never existed. While a
  // Wiedergabe runs the Verlauf beside it may be filtered like any other; its rows still set
  // the moment (`onSeekTo`).
  const [filterSel, setFilterSel] = useState<ReadonlySet<string>>(() => new Set())
  const filtering = filterSel.size > 0
  // ⚠️ The phone sheet is `height: auto` (15-mobile · .journal-drawer), so narrowing the list
  // SHRANK it: tick «Karte» and the sheet dropped half a screen under the finger still in its menu
  // (24.09.2026). The height it had when the narrowing began is held until the list is whole
  // again – measured in the handler, before the rows go, and capped by the same budget `.is-kb`
  // gives the sheet, so a raised keyboard (the search) still wins.
  const [drawerEl, setDrawerEl] = useState<HTMLDivElement | null>(null)
  const [heldPx, setHeldPx] = useState<number | null>(null)
  const holdHeight = () => { if (!filtering && !searching) setHeldPx(drawerEl?.offsetHeight ?? null) }
  const heldStyle = (filtering || searching) && heldPx
    ? { minHeight: `min(${heldPx}px, calc(100dvh - 70px - env(safe-area-inset-top) - var(--kb-inset, 0px)))` }
    : undefined
  const categories = useMemo(() => journalCategories(events, plans), [events, plans])
  const [editTx, setEditTx] = useState<{ id: string; value: string } | null>(null)
  const saveTranscript = () => {
    if (!editTx) return
    onTranscript?.(editTx.id, editTx.value)
    setEditTx(null)
  }
  // text correction on an annotation row (same UI pattern as the transcript edit above)
  const [editRow, setEditRow] = useState<{ id: string; value: string } | null>(null)
  const saveRowText = () => {
    if (!editRow) return
    const v = editRow.value.trim()
    if (v) onEditText?.(editRow.id, v)
    setEditRow(null)
  }
  // ── the row's detail sheet (decided 29.08., variant 2) ──
  // The paperwork actions that used to sit as ~30px icons in the row's trail — Durchhören,
  // Transkript, the typed row's pen, and the jump to the row's place — live behind a tap on
  // the ROW now (rendered at the bottom). Only the play circle stays inline: of the row's
  // actions it is the one that happens mid-incident under time pressure, so it keeps (and
  // grows) its one-tap spot.
  const [detailId, setDetailId] = useState<string | null>(null)
  // the sheet's title is the row's message, capped at five lines (10-journal · .jr-detail-title);
  // a capped one stands whole in the body too, so no word of the record is out of reach
  const [detailClamped, setDetailClamped] = useState(false)
  // recordings as windows on the incident timeline: a row whose time falls inside one is
  // an annotation of that recording and links back into the player at its moment
  const audioWindows = useMemo((): AudioWindow[] => events
    .filter((e) => e.audioUrl && e.audioMeta?.startedAt && (e.audioMeta.durationSec ?? 0) > 0)
    .map((e) => {
      const start = Date.parse(e.audioMeta!.startedAt)
      return { row: e, start, end: start + (e.audioMeta!.durationSec ?? 0) * 1000 }
    })
    .filter((w) => !Number.isNaN(w.start)), [events])

  // A state the app re-states («Trupp X überfällig» every few seconds, an undo tapped six times)
  // reads as one line that repeated, not as twenty lines. Display only — see lib/verlauf.
  const repeats = useMemo(() => repeatRuns(events), [events])

  // ── the log, grouped once and mounted in pages ──
  // Grouping and the repeat filter run once per timeline, not per render — the drawer re-renders
  // on every store nonce (every poll that adopts a row, every overlay change). And the DOM holds
  // only the newest `visibleCount` rows: a long Einsatz reaches 1–2k of them (Funkkontakt every
  // 10 min per Trupp, Druckmeldungen, GPS vor Ort/zurück), each ~10 nodes with chips and actions,
  // and mounting all of them made opening the drawer a several-hundred-ms stall on an iPad. A
  // sentinel at the tail reveals the next page as it scrolls into view; a jump to an older row
  // reveals up to it first (`revealRow`), so the strip and a Meldung's reference still land.
  // …and, while a query is typed, only the rows it keeps (lib/journalSearch): a day whose rows
  // all fell out loses its separator too, so the list reads as hits and not as empty headings.
  // …and the filter's ticks AND with it (lib/journalFilter).
  const groups = useMemo(
    () => groupByDay(events)
      .map((g) => ({ ...g, events: g.events.filter((e) => !repeats.hidden.has(e.id) && matchesJournalQuery(e, query) && matchesJournalCategories(e, filterSel, categories)) }))
      .filter((g) => g.events.length > 0),
    [events, repeats, query, filterSel, categories],
  )
  // The filter menu's rows and counts. Counted over what the list would show WITHOUT the ticks —
  // the folded rows the search keeps — so each number is what ticking that row would add.
  // ⚠️ «Alle zeigen» counts ROWS, not the facets' sum: a typed Pendenz row counts under its Art
  // AND under «Pendenz» (lib/journalFilter), so the sum would count it twice.
  const { facets, facetTotal } = useMemo(() => {
    const folded = events.filter((e) => !repeats.hidden.has(e.id))
    const counted = folded.filter((e) => matchesJournalQuery(e, query))
    return { facets: journalFacets(folded, counted, categories, filterSel), facetTotal: counted.length }
  }, [events, repeats, query, categories, filterSel])
  const filterOn = facets.filter((f) => filterSel.has(f.key)).map((f) => f.label).join(' · ')
  const [pageCount, setVisibleCount] = useState(PAGE_ROWS)
  // no observer (jsdom, an old WebView): everything, as before
  const visibleCount = typeof IntersectionObserver === 'undefined' ? Infinity : pageCount
  /** rendered position of every row id — the count a reveal has to reach */
  const rowIndex = useMemo(() => {
    const m = new Map<string, number>()
    let i = 0
    for (const g of groups) for (const e of g.events) m.set(e.id, i++)
    return m
  }, [groups])
  const totalRows = rowIndex.size
  const shown = useMemo(() => {
    let left = visibleCount
    const out: typeof groups = []
    for (const g of groups) {
      if (left <= 0) break
      out.push(left >= g.events.length ? g : { ...g, events: g.events.slice(0, left) })
      left -= g.events.length
    }
    return out
  }, [groups, visibleCount])
  const listRef = useRef<HTMLDivElement>(null)
  const sentinelRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const el = sentinelRef.current
    if (!el) return
    const io = new IntersectionObserver((entries) => {
      if (entries.some((x) => x.isIntersecting)) setVisibleCount((c) => c + PAGE_ROWS)
    }, { root: listRef.current, rootMargin: '400px 0px' })
    io.observe(el)
    return () => io.disconnect()
  }, [visibleCount, totalRows])

  // The strip's own state: the incident's time span, one tick per dated row, and the jump.
  // Rows WITHOUT an absolute time (legacy HH:MM-only entries) are simply not on it — a tick at a
  // guessed position would send the operator to the wrong place, which is worse than no tick.
  const strideRef = useRef(0)
  const stripTicks = useMemo(
    () => events.map((e) => (e.at ? Date.parse(e.at) : NaN)).filter((t) => Number.isFinite(t)).sort((a, b) => a - b),
    [events],
  )
  const stripSpan = useMemo(() => {
    if (stripTicks.length < 2) return null // one moment is not a timeline
    const from = stripTicks[0]
    const to = stripTicks[stripTicks.length - 1]
    return to > from ? { from, to } : null
  }, [stripTicks])
  // …and its time scale: the end clocks and round times between them, labelled where they fit —
  // which needs the track's width, so the strip is measured (lib/verlauf · stripScale).
  const [stripTrackPx, setStripTrackPx] = useState(0)
  const measureStrip = useCallback((el: HTMLDivElement | null) => {
    if (!el || typeof ResizeObserver === 'undefined') return
    const ro = new ResizeObserver(() => setStripTrackPx(Math.max(0, el.clientWidth - STRIP_INSET * 2)))
    ro.observe(el)
    return () => ro.disconnect()
  }, [])
  const scale = useMemo(() => (stripSpan ? stripScale(stripSpan.from, stripSpan.to, stripTrackPx) : null), [stripSpan, stripTrackPx])
  // …and the rows' marks merged per 3px column, so a busy stretch reads as density, not barcode
  const density = useMemo(() => (stripSpan ? stripDensity(stripTicks, stripSpan.from, stripSpan.to, stripTrackPx) : []), [stripTicks, stripSpan, stripTrackPx])
  /** Scroll the list to the row nearest a moment on the strip. */
  const jumpTo = (ms: number) => {
    let best: string | null = null
    let bestD = Infinity
    for (const e of events) {
      if (!e.at) continue
      const d = Math.abs(Date.parse(e.at) - ms)
      if (d < bestD) { bestD = d; best = e.id }
    }
    if (!best) return
    jumpToRow(best)
  }
  /** The row element for an id. ⚠️ Matched on `dataset`, not through a `[data-ev="…"]` selector:
   *  that needs `CSS.escape` for ids it cannot predict, and reaching for a global that does not
   *  exist everywhere (jsdom has no `CSS`) threw inside a requestAnimationFrame, where nothing
   *  catches it. A row id is data; walking the rows is cheap and cannot be mis-escaped. */
  const findRow = (id: string) => {
    const list = listRef.current
    if (!list) return null
    for (const el of list.querySelectorAll<HTMLElement>('[data-ev]')) if (el.dataset.ev === id) return el
    return null
  }
  /** How far the row is from the middle of the list, in px. 0 = centred. */
  const offCentre = (list: HTMLElement, el: HTMLElement) => {
    const lr = list.getBoundingClientRect()
    const er = el.getBoundingClientRect()
    return (er.top - lr.top) - (lr.height - er.height) / 2
  }
  /**
   * Scroll to one row by id and flash it — the strip, the reference on a Meldung row and the
   * Wiedergabe's «im Verlauf» all share it. Returns whether the row was there to scroll to.
   *
   * ⚠️ It scrolls `.history-list`, which is the LOG's scrollport and only the log's: every row it
   * can land on carries `data-ev` and lives there. The Pendenzen box above is a second scrollport
   * with no landing targets of its own — a Meldung's reference points at the log row that raised
   * the item, not at the box's copy of it — so the two never fight over one scroll.
   *
   * ⚠️ The list is scrolled by a MEASURED delta first, and `scrollIntoView` is only the fallback.
   * That call walks up to whatever it decides is the scroll parent and animates it, and here it
   * is asked to do so on a drawer that is still animating open — so it scrolled the wrong box or
   * was undone by the layout that followed, and the Verlauf opened at the top with the row
   * nowhere in sight. Two rects and one assignment cannot pick the wrong container; but if the
   * assignment provably did not move the list (a scroll container this code did not expect),
   * the platform's own method still gets its turn rather than leaving the operator stranded.
   */
  // one marking for every piece of prose in the drawer — the row text and the transcript
  // subtitle lines mark the same vocabulary the composer marked while it was being typed
  // ⚠️ `subjectId`: a row ABOUT a Trupp links its «Trupp N» to that Trupp by id — after a
  // renumbering (docs/trupp-naming.md §7) its early rows say a number another crew holds now
  const marked = (text: string, subjectId?: string) => linkParts(text, vocab, { subjectId }).map((p, pi) => {
    if (!p.kind) return <span key={pi}>{p.text}</span>
    // ⚠️ An address is the one mark that DOES something, so it is the one that must not also do
    // what the row does. A row selects, seeks or opens a place under the finger; without the
    // stop, opening the link would fly the map somewhere at the same time.
    if (p.kind === 'url') {
      return (
        <a key={pi} className="jr-link jr-link-url" href={p.href}
          target="_blank" rel="noopener noreferrer" onClick={(e) => e.stopPropagation()}>{p.text}</a>
      )
    }
    // a name with its role is ONE unit on the line (`.jr-link-unit`, 10-journal.css): «(AS)»
    // never wraps away from «Weber Nina», while the row still wraps between people
    return (
      <b key={pi} className={`jr-link jr-link-${p.kind}${p.role ? ' jr-link-unit' : ''}`} title={p.hint} data-trupp={p.truppId}>
        {p.text}
        {p.role && <i className="jr-link-role"> ({p.role})</i>}
      </b>
    )
  })

  /** Make sure the row is mounted. True when that needed a reveal — the DOM has it only after
   *  the re-render, so the caller lands on it then (`pendingJump`, or the landing loop below).
   *  Checked against the DOM, not the count: the landing loop keeps calling through the closure
   *  of the render that asked, whose `visibleCount` is stale once the reveal has happened. */
  const revealRow = (id: string) => {
    if (findRow(id)) return false
    const idx = rowIndex.get(id)
    if (idx == null) return false
    setVisibleCount((c) => Math.max(c, idx + PAGE_ROWS))
    return true
  }
  const pendingJump = useRef<{ id: string; smooth: boolean } | null>(null)
  const jumpToRow = (id: string, smooth = false) => {
    if (revealRow(id)) { pendingJump.current = { id, smooth }; return true }
    const list = listRef.current
    const el = findRow(id)
    if (!list || !el) return false
    // ⚠️ removed + reflowed + re-added, so landing on the SAME row twice runs the ring again;
    // an animation that is already on the element does not restart by itself (the Rapport's
    // jumpToStep does the same for its chips)
    el.classList.remove('jr-flash')
    void el.offsetWidth
    el.classList.add('jr-flash')
    window.setTimeout(() => el.classList.remove('jr-flash'), 2000)
    const lr = list.getBoundingClientRect()
    // before layout (jsdom, or a frame too early) every rect is 0 — the flash above is what says
    // «this is the one» either way
    if (lr.height <= 0) return true
    const before = list.scrollTop
    const delta = offCentre(list, el)
    // ⚠️ `smooth` only where a PERSON asked to go somewhere (the reference on a Meldung): the
    // travel is what shows that the target row is a different row, further up, rather than the
    // list having silently redrawn. The landing loop below must stay instant — it re-corrects for
    // a few hundred ms as fonts and media settle, and an animation would be fighting the next
    // correction on every frame.
    if (smooth) list.scrollBy({ top: delta, behavior: 'smooth' })
    else {
      list.scrollTop += delta
      // it should have moved. If it did not, this list is not the box that scrolls.
      // (Not checked for a smooth scroll — nothing has moved yet by the time this line runs.)
      if (Math.abs(delta) > 2 && list.scrollTop === before) el.scrollIntoView({ block: 'center' })
    }
    return true
  }
  // a jump that had to reveal its row first lands once the page holding it is mounted
  useEffect(() => {
    const p = pendingJump.current
    if (!p) return
    pendingJump.current = null
    jumpToRow(p.id, p.smooth)
  }, [visibleCount]) // eslint-disable-line react-hooks/exhaustive-deps
  /**
   * Opened ONTO one row — «im Verlauf» on the Wiedergabe caption.
   *
   * Three things have to go right, and each of them bit:
   *   · LAYOUT — the drawer mounts on the same click that asks it to land, so for the first
   *     frames the row exists while the list has no box, and a delta computed from two
   *     zero-height rects moves nothing. So: wait for the list to have a height.
   *   · SETTLING — web fonts swap, media chips arrive, transcripts render. Every one of them
   *     changes the height of rows ABOVE the target, which slides it back out of the middle
   *     after a correct scroll. So: keep correcting for a few hundred ms until it holds still.
   *   · THE OPERATOR — who may start scrolling in the middle of all that, and must win. Any
   *     touch, wheel or drag on the list ends the settling immediately.
   *
   * ⚠️ NO «already landed» ref guard. There was one, and under <StrictMode> — which this app
   * mounts in — it made the whole thing dead code in development: React runs an effect, its
   * cleanup, then the effect again, so the first run recorded the nonce, the cleanup cancelled
   * its frame, and the second run saw its own nonce and returned. Nothing ever scrolled. The
   * dependency is the whole guard that is needed: `landOn` is state, so its identity changes
   * exactly when a new landing is requested.
   */
  useEffect(() => {
    if (!landOn) return
    revealRow(landOn.id) // an older row than the DOM holds — the attempt loop finds it once mounted
    let raf = 0
    let tries = 0
    let stable = 0
    let cancelled = false
    const stop = () => { cancelled = true }
    const list0 = listRef.current
    list0?.addEventListener('wheel', stop, { passive: true })
    list0?.addEventListener('touchstart', stop, { passive: true })
    list0?.addEventListener('pointerdown', stop)

    const settle = () => {
      if (cancelled) return
      const list = listRef.current
      const el = findRow(landOn.id)
      if (!list || !el || list.getBoundingClientRect().height <= 0) return
      const delta = offCentre(list, el)
      if (Math.abs(delta) > 2) { list.scrollTop += delta; stable = 0 } else stable += 1
      // three quiet frames, or ~40 frames of trying — whichever comes first
      if (stable < 3 && ++tries < 40) raf = requestAnimationFrame(settle)
    }
    const attempt = () => {
      if (cancelled) return
      const list = listRef.current
      const el = findRow(landOn.id)
      const laidOut = !!list && !!el && list.getBoundingClientRect().height > 0
      if (laidOut || ++tries > 20) {
        if (el) { jumpToRow(landOn.id); tries = 0; raf = requestAnimationFrame(settle) }
        return
      }
      raf = requestAnimationFrame(attempt)
    }
    raf = requestAnimationFrame(attempt)
    // fonts land late and re-flow every row above the target — one more correction when they do
    document.fonts?.ready.then(() => { if (!cancelled) settle() }).catch(() => {})
    return () => {
      cancelled = true
      cancelAnimationFrame(raf)
      list0?.removeEventListener('wheel', stop)
      list0?.removeEventListener('touchstart', stop)
      list0?.removeEventListener('pointerdown', stop)
    }
  }, [landOn])

  // ⚠️ NOT re-sorted here. lib/reminders already orders them — dringend first, then oldest first
  // — and it is the same order the Rapport prints. Two sorts in two places is how the list on
  // screen and the list on paper start disagreeing about what is most urgent.
  // …and HIDDEN while a filter is on that does not tick «Pendenz» (lib/journalFilter ·
  // showsPinnedPendenzen): the box is part of what the ticks narrow.
  const pinnedReminders = showsPinnedPendenzen(filterSel) ? openReminders ?? [] : []
  // How many Pendenzen lie wholly or partly below the box's fold — its foot cue «3 weitere ⌄»
  // (`.jr-pinned[data-more]`, lib/verlauf · pendenzenBelow; 0 = at the end, no strip). iOS hides
  // an idle scrollbar, so without it a box cut between two rows reads as complete. A callback ref, because the box mounts inside the Overlay's portal
  // after this component's own effects have run; re-read on scroll, when the drawer, the box or
  // any row resizes (capped at its max-height the box keeps its size while late fonts re-wrap the
  // rows under it) and when rows come and go.
  // …and on every resize the box is cut at the last WHOLE row (lib/verlauf · pendenzenCut): an
  // inline max-height under the CSS one, so at rest the foot band stands where the next row's
  // rule would and no row is sliced through its sentence (hill climb r4, 04.11.2026). The inline
  // cap is dropped first, so the CSS one is what is measured against.
  const [pinnedBelow, setPinnedBelow] = useState(0)
  const watchPinned = useCallback((el: HTMLDivElement | null) => {
    if (!el) { setPinnedBelow(0); return }
    // the scroll-end guard first: there the strip's natural spot overlaps the last row, which
    // would otherwise count itself as hidden
    const read = () => {
      const foot = el.querySelector<HTMLElement>('.jr-pinned-foot')
      const below = !foot || el.scrollHeight - el.scrollTop - el.clientHeight <= 1 ? 0
        : pendenzenBelow([...el.querySelectorAll('.jr-pinned-row')].map((r) => r.getBoundingClientRect().bottom), foot.getBoundingClientRect().top)
      setPinnedBelow(below)
    }
    const fit = () => {
      el.style.maxHeight = ''
      const foot = el.querySelector<HTMLElement>('.jr-pinned-foot')
      if (foot && el.scrollHeight - el.clientHeight > 1) {
        const box = el.getBoundingClientRect()
        const tops = [...el.querySelectorAll('.jr-pinned-row')].map((r) => r.getBoundingClientRect().top - box.top + el.scrollTop)
        // the band plus the bottom border (offset − client = both borders, clientTop = the top one)
        const cut = pendenzenCut(tops, el.offsetHeight, foot.offsetHeight + el.offsetHeight - el.clientHeight - el.clientTop)
        if (cut !== null) el.style.maxHeight = `${cut}px`
      }
      read()
    }
    // a frame later, not inside the callback: the cut resizes an observed box, and a resize the
    // observer has to deliver again in the same frame is its «loop completed» error
    let frame = 0
    const ro = typeof ResizeObserver === 'undefined' ? null
      : new ResizeObserver(() => { cancelAnimationFrame(frame); frame = requestAnimationFrame(fit) })
    const watch = () => {
      ro?.disconnect()
      for (const node of [el.parentElement, el, ...el.children]) if (node) ro?.observe(node)
      fit()
    }
    const mo = typeof MutationObserver === 'undefined' ? null : new MutationObserver(watch)
    mo?.observe(el, { childList: true })
    el.addEventListener('scroll', read, { passive: true })
    watch()
    return () => { el.removeEventListener('scroll', read); cancelAnimationFrame(frame); ro?.disconnect(); mo?.disconnect() }
  }, [])

  /** The funnel's menu: «Art des Eintrags», then «Bereich», each row a checkbox with the row's
   *  own disc and its count, and «Alle zeigen» last. Checkboxes keep the menu open (lib/overlays ·
   *  Menu), because a selection is several ticks in a row; «Alle zeigen» is an action and closes
   *  it — you asked to see everything, and the menu is in the way of seeing it. */
  const filterItems = () => {
    const toggle = (key: string) => (on: boolean) => { holdHeight(); setFilterSel((sel) => {
      const next = new Set(sel)
      if (on) next.add(key)
      else next.delete(key)
      return next
    }) }
    const group = (g: 'art' | 'bereich', head: string) => {
      const rows = facets.filter((f) => f.group === g)
      if (!rows.length) return []
      return [
        { kind: 'head' as const, label: head },
        ...rows.map((f) => ({
          kind: 'check' as const,
          checked: filterSel.has(f.key),
          onChange: toggle(f.key),
          label: (
            <span className="jr-filter-row">
              <Disc {...FILTER_DISC[f.kind]} />
              <span className="jr-filter-label">{f.label}</span>
              <b className="jr-filter-count">{f.count}</b>
            </span>
          ),
        })),
      ]
    }
    return [
      ...group('art', C.filterArt),
      ...group('bereich', C.filterArea),
      { kind: 'sep' as const },
      {
        label: (
          <span className="jr-filter-row jr-filter-reset">
            <span className="jr-filter-label">{C.filterAll}</span>
            <b className="jr-filter-count">{facetTotal}</b>
          </span>
        ),
        disabled: !filtering,
        onClick: () => setFilterSel(new Set()),
      },
    ]
  }

  /** Escape, innermost first (Overlay · onEscape): an inline editor, then the search, and only
   *  when neither is open does the drawer close. A field's own Esc handler may already have closed
   *  its layer in this same keydown — this still reads the render's state, so it answers «consumed»
   *  and the drawer stays. */
  const escapeInner = (): boolean => {
    if (editTx) { setEditTx(null); return true }
    if (editRow) { setEditRow(null); return true }
    if (search != null) { setSearch(null); return true }
    return false
  }

  return (
    <Overlay open onClose={onClose} className="journal-drawer" backdropClassName="journal-scrim" ariaLabel={C.title} onEscape={escapeInner} grab popupRef={setDrawerEl} style={heldStyle}>
        {/* ── the head STAYS while searching (22.09.2026) ──
            The field used to take the head's place – title · ⓘ · Replay · ✕ gone, a bare search
            box at the top – and with it went the answer to «where am I»: the drawer no longer said
            it was the Verlauf. The head is constant now; the field sits BELOW it, in the row the
            timeline strip vacates (the strip is hidden while searching anyway), with its own ✕.
            The lens in the head is lit while the field is open and closes it on a second tap. */}
        <div className="journal-head">
          {/* the title and its count as two pieces (hill climb r6): the count is a caption beside
              the name, not part of it — so «Verlauf» leads and «· 322» steps back (10-journal.css) */}
          <span className="journal-title"><Icon id="history" /><span className="journal-title-txt">{C.title}</span>{' '}<span className="journal-count">· {events.length}</span></span>
          {/* ⚠️ ON A TAP, never by itself. The disc carries the Bereich now, and a glyph has to be
              learned — but a panel that opens on its own, or one the app remembers having opened,
              is a thing to dismiss on the way to the record. This one is a question somebody asks
              once. No hover either: the primary device has none. */}
          <InfoToggle open={showLegend} onToggle={() => setShowLegend((v) => !v)} label={C.legend} />
          {/* the lens: same chip as the ⓘ, and it closes the legend on its way in – the legend
              explains discs the search is about to hide most of */}
          <button
            type="button" className={`journal-legend-btn${searching ? ' on' : ''}`}
            title={searching ? C.searchClose : C.search} aria-label={searching ? C.searchClose : C.search} aria-pressed={searching}
            onClick={() => { if (searching) { setSearch(null); return } holdHeight(); setShowLegend(false); setSearch('') }}
          ><Icon id="search" /></button>
          {/* the funnel (feat 37 · B): an active filter is the blue CHOICE fill and nothing else
              (29.09.2026 — it was the ink «where you are» pill plus a dot), like the Anwesenheit's
              filter buttons — WHAT is ticked is in its name, in the menu and in the strip below,
              never printed on the button, whose width then never changes under the finger. */}
          {/* ⚠️ Standing whenever there is a row, even while every row is in one category: a head
              whose buttons come and go with the content is a head that has to be re-read. */}
          {events.length > 0 && (
            <Menu
              trigger={
                <button
                  type="button" className={`journal-legend-btn${filtering ? ' jr-filter-on' : ''}`}
                  title={filtering ? `${C.filter} – ${filterOn}` : C.filter}
                  aria-label={filtering ? `${C.filter} – ${filterOn}` : C.filter}
                ><Icon id="filter" /></button>
              }
              align="start"
              popupClassName="jr-filter-menu"
              itemClassName={() => 'jr-filter-item'}
              items={filterItems()}
            />
          )}
          {/* ⚠️ `aria-label`, because the word inside it is hidden on a phone (10-journal.css) —
              the head is one item wider since the legend button joined it, and this is the label
              that can most afford to go. */}
          {/* THE button's framed secondary (hill climb, 04.11.2026): it was the filled primary, and
              playing back history out-shouted the title and the open Pendenzen below it. */}
          {onReplay && (
            <Button className="journal-replay" onClick={onReplay} title={C.replayHint} aria-label={C.replay} icon={<Icon id="play" />}>
              <span>{C.replay}</span>
            </Button>
          )}
          <button className="journal-x" title={appConfig.copy.closeDialog} aria-label={appConfig.copy.closeDialog} onClick={onClose}><Icon id="close" /></button>
        </div>
        {deliveryNotice}
        {searching && (
          <div className="journal-search-row">
            {/* the live count rides in the field's count slot, only once there is a query. ONE ✕
                (`noClear`, 29.09.2026, owner): the row's close beside it ends the search, query and all */}
            <SearchField
              className="journal-search" value={search ?? ''} onChange={setSearch} noClear
              autoFocus inputMode="search" maxLength={80}
              placeholder={C.searchPlaceholder} aria-label={C.search}
              onKeyDown={(ev) => { if (ev.key === 'Escape') { ev.preventDefault(); ev.stopPropagation(); setSearch(null) } }}
              count={query ? fillTemplate(C.searchCount, { n: totalRows, m: events.length }) : undefined}
            />
            <button type="button" className="journal-x" title={C.searchClose} aria-label={C.searchClose} onClick={() => setSearch(null)}><Icon id="close" /></button>
          </div>
        )}
        {/* what is filtered, on ONE line, with the way out beside it — the funnel's dot says THAT
            something is, and a reader who did not tick it (or forgot) has to learn WHAT without
            opening a menu. The count stands here only while there is no query: with one, the
            field's own «n von m» already counts both. */}
        {filtering && (
          <div className="jr-filter-strip">
            <span className="jr-filter-strip-text">{C.filterActive} <b>{filterOn}</b></span>
            {!query && (
              <span className="journal-search-count" aria-live="polite">
                {fillTemplate(C.searchCount, { n: totalRows, m: events.length })}
              </span>
            )}
            <button type="button" className="jr-filter-all" onClick={() => setFilterSel(new Set())}>{C.filterAll}</button>
          </div>
        )}
        {showLegend && !searching && (
          <div className="jr-legend">
            {legendEntries().map((l) => (
              <span className="jr-legend-item" key={l.label}>
                <Disc icon={l.icon} surface={l.surface} tone={l.tone} ring={l.ring} />{l.label}
              </span>
            ))}
          </div>
        )}
        {/* WHEN the Einsatz has substance, as one strip. A long Verlauf is a wall of rows in
            which «was war um halb zehn» means scrolling and reading — the strip answers it by
            position instead, and a tap on it lands on the nearest row. Ticks are not targets
            (the strip takes the tap as a whole), so nothing here needs a gloved-finger hit box.
            ⚠️ NOT while searching or filtering: its ticks and its jump are positioned over the FULL
            list, and above a narrowed one they would point at rows that are not there. */}
        {stripSpan && !searching && !filtering && (
          <div
            className="jr-strip" role="slider" tabIndex={0} ref={measureStrip}
            aria-label={C.stripLabel}
            aria-valuemin={0} aria-valuemax={100} aria-valuenow={0}
            onPointerDown={(ev) => {
              // …against the TRACK, not the strip: the ticks are inset by STRIP_INSET, so a tap
              // on the strip's rounded end has to land on the first tick and not somewhere
              // before it. Same inset on both, from the one constant.
              const box = ev.currentTarget.getBoundingClientRect()
              const span = Math.max(1, box.width - STRIP_INSET * 2)
              const frac = Math.min(1, Math.max(0, (ev.clientX - box.left - STRIP_INSET) / span))
              jumpTo(stripSpan.from + frac * (stripSpan.to - stripSpan.from))
            }}
            onKeyDown={(ev) => {
              const step = (stripSpan.to - stripSpan.from) / 20
              if (ev.key === 'ArrowRight') { ev.preventDefault(); jumpTo(stripSpan.from + step * ++strideRef.current) }
              if (ev.key === 'ArrowLeft') { ev.preventDefault(); jumpTo(stripSpan.from + step * --strideRef.current) }
            }}
          >
            {/* the ticks live on an INSET track. Positioned against the strip itself, the first
                and last tick sat on its rounded ends — half-swallowed by the corner radius and
                the inset hairline, so the two moments that bracket the whole Einsatz were the
                two you could not see. */}
            {/* …and on it, under the ticks, the scale: the first and last moment at the ends, round
                times between them as taller marks, labelled where a label fits (stripScale). */}
            <div className="jr-strip-track" style={{ insetInline: STRIP_INSET }} aria-hidden>
              {density.map((d, i) => (
                <i key={i} data-busy={d.n >= STRIP_BUSY || undefined} style={{ left: `${d.frac * 100}%` }} />
              ))}
              {scale?.marks.map((m) => (
                <Fragment key={m.frac}>
                  <b className="jr-strip-major" style={{ left: `${m.frac * 100}%` }} />
                  {m.label && <span className="jr-strip-lbl" style={{ left: `${m.frac * 100}%` }}>{m.label}</span>}
                </Fragment>
              ))}
              {scale && <>
                <span className="jr-strip-lbl jr-strip-end" style={{ left: 0 }}>{scale.start}</span>
                <span className="jr-strip-lbl jr-strip-end" style={{ right: 0 }}>{scale.end}</span>
              </>}
            </div>
          </div>
        )}
        {/* ── OFFENE ERINNERUNGEN · the upper of the drawer's TWO stacked scroll areas ──
            The one part of the drawer that is not the chronology. A Wiedervorlage is about what
            still has to be done, and on an Einsatz that writes a row a minute it was thirty rows
            up within ten — so it is held out of the stream in a box of its own, with the log
            ENTIRELY below it in a second box. Each scrolls itself; neither covers the other.
            ⚠️ This reverses «one scrollbar for the whole drawer». That argument — two scrollbars
            are two guesses about which one a flick will move — was about two that OVERLAPPED: the
            block was sticky and opaque INSIDE the log, so the rows ran behind it and one crossing
            its lower edge was sliced through its letters. Stacked, with the box's border and the
            gap below it as the seam, the finger is in one box or the other.
            ⚠️ No box at all when nothing is open — the log then has the whole drawer, which is
            the state most of an Einsatz is in. See `.jr-pinned` in 06-contextpanel.css. */}
        {pinnedReminders.length > 0 && (
          <div className="jr-pinned" ref={watchPinned} data-more={pinnedBelow > 0 || undefined}>
            <div className="jr-pinned-head">
              <Icon id="checklist" /><span>{C.openRemindersHead}</span>
              <b>{C.openCount.replace('{n}', String(pinnedReminders.length))}</b>
            </div>
            {pinnedReminders.map((r) => {
              // ⚠️ The time column says WHEN IT WAS RAISED, for every row, always. It used to
              // say «fällig 22:10 / überfällig», which only a timed Erinnerung can answer — an
              // Auftrag has no Fälligkeit, because nobody checks in on a Schadenplatz. What is
              // actually being asked here is «seit wann läuft das», and the sort order (oldest
              // first) already answers it positionally; tapping swaps the column to the age for
              // the times the clock stops answering it. Überfällig stays the banner's business.
              const dueLater = r.dueAt && Date.parse(r.dueAt) > now
              return (
                <div key={r.id} className={`jr-pinned-row ${r.urgent ? 'urgent' : ''}`}>
                  <button
                    type="button" className="jr-when"
                    title={C.ageToggle} aria-label={C.ageToggle}
                    onClick={() => setShowAge((v) => !v)}
                  >{showAge ? ageLabel(r.createdAt, now, C) : rowClock(r.createdAt)}</button>
                  {/* ⚠️ The ring sits in the VERLAUF'S ICON SLOT, before the text, not out at the
                      right margin. Two things come of it: the item's text starts on exactly the
                      same axis as every line in the log below, so the block reads as the same
                      list filtered rather than as a separate component — and the ring IS this
                      row's icon, which is what a checklist circle has always been. */}
                  {/* …a control only where there is a hand to tick it off: a session without one (a
                      viewer, a link) gets the same ring as a read-out, like the log row's (Disc) */}
                  {onReminderDone ? (
                    <button
                      type="button" className="jr-rem"
                      title={C.markDoneTitle} aria-label={C.markDoneTitle}
                      onClick={() => onReminderDone(r)}
                    ><span className="jr-rem-box"><Icon id="check" /></span></button>
                  ) : <span className="jr-rem" aria-hidden><span className="jr-rem-box" /></span>}
                  {/* ⚠️ The Meldungen are SIBLINGS of the button, not children of it. Inside it
                      they rendered outside its box: a <button> is a replaced-ish element whose
                      height does not follow block children the way a div's does, so a row with
                      three Meldungen kept the height of one and the next row was drawn straight
                      over them. The button stays a button — one line, one action — and the
                      thread hangs under it in an ordinary div. */}
                  <div className="jr-pinned-body">
                    {onReminderNote ? (
                      <button
                        type="button" className="jr-pinned-text"
                        title={C.noteOpen} aria-label={C.noteOpen}
                        onClick={() => onReminderNote(r)}
                      >{r.text}</button>
                    ) : <span className="jr-pinned-text">{r.text}</span>}
                    {/* ⚠️ EVERY Meldung, not the latest one. They stand scattered through the
                        Verlauf where they happened, so this is the only place the thread reads
                        as a thread — and showing one of three looked like the whole story. */}
                    {r.notes.map((n) => (
                      <span className="jr-pinned-note" key={n.rowId}>
                        <b>{rowClock(n.at)}</b>{n.text}
                      </span>
                    ))}
                  </div>
                  {/* ⚠️ …and it says WHEN, not just that there is a when. The bare clock glyph
                      answered «meldet sich selbst» and left the one thing to act on — «um wie
                      viel Uhr?» — inside a tooltip nobody on a tablet can open. The row's own
                      time column says when the item was RAISED, so the two are never the same
                      number. `dueClock` adds «· morgen» where the Fälligkeit fell to the next
                      day, which is exactly the case a bare «06:30» reads as long overdue. */}
                  {dueLater && (
                    <span className="jr-pinned-alarm" title={C.dueAtLabel.replace('{t}', dueClock(r.dueAt!))}>
                      <Icon id="clock" /><b>{dueClock(r.dueAt!)}</b>
                    </span>
                  )}
                </div>
              )
            })}
            {/* the foot: a band at the box's bottom edge, «3 weitere ⌄», shown while rows are
                below the fold (`data-more`). Always in the DOM so it never moves the rows it covers. */}
            <span className="jr-pinned-foot" aria-hidden>
              {pinnedBelow > 0 && C.pinnedMoreBelow.replace('{n}', String(pinnedBelow))}
              <Icon id="chevron-down" />
            </span>
          </div>
        )}
        <div className="history-list" ref={listRef}>
          {events.length === 0 && <EmptyState icon="history" title={C.empty} />}
          {/* a query that kept nothing says so – and what it looked in, because «Nichts» beside a
              name that IS in the Verlauf otherwise reads as the search being broken */}
          {/* …and with a filter on, the ticks are the likelier culprit, so they are what it names */}
          {(query || filtering) && totalRows === 0 && events.length > 0 && (
            filtering
              ? <EmptyState icon="filter" title={C.filterEmpty} sub={C.filterEmptyHint} />
              : <EmptyState icon="search" title={fillTemplate(C.searchEmpty, { q: (search ?? '').trim() })} sub={C.searchEmptyHint} />
          )}
          {shown.map((g, gi) => (
            <Fragment key={g.label ?? `today-${gi}`}>
              {g.label && <div className="jr-day-sep" role="separator">{g.label}</div>}
              {g.events.map((e) => (
                <JournalRow
                  key={e.id} e={e} plans={plans} live={live} closedAt={closedAt} now={now} replayAtMs={replayAtMs}
                  openMap={openMap} repeated={repeats.counts.get(e.id) ?? 1}
                  pendenzTitles={pendenzTitles} pendenzRowIds={pendenzRowIds} audioWindows={audioWindows}
                  playing={audio.playing === e.id} onTogglePlay={audio.toggle}
                  editTx={editTx} editRow={editRow} setEditTx={setEditTx} setEditRow={setEditRow}
                  saveTranscript={saveTranscript} saveRowText={saveRowText}
                  marked={marked} jumpToRow={jumpToRow} onOpenDetail={setDetailId}
                  onSelect={onSelect} onSeekTo={onSeekTo} onTranscript={onTranscript} onEditText={onEditText}
                  onOpenPlayer={onOpenPlayer} onReminderDone={onReminderDone} onReminderAgain={onReminderAgain}
                  mediaStatusOf={mediaStatusOf}
                />
              ))}
            </Fragment>
          ))}
          {/* the tail's sentinel: scrolling it into view mounts the next page (see `shown`) */}
          {visibleCount < totalRows && <div ref={sentinelRef} style={{ height: 1 }} aria-hidden />}
        </div>
        {/* ── the row's detail sheet (variant 2, 29.08.) — see `detailId` above ──
            One modal Sheet per open row, over the drawer (--z-dialog > --z-drawer). Every action
            hands over to the machinery that already existed: Durchhören opens the player sheet,
            Transkript/Text open the inline editors under the row, the jump is the row tap of old
            («zur Stelle springen» lives here now — the located-note trade-off the variant named). */}
        {(() => {
          if (!detailId) return null
          const e = events.find((x) => x.id === detailId)
          if (!e) return null
          const hasTx = !!e.transcript || !!e.transcriptSections?.length
          const target = rowTarget(e, live)
          const photos = rowPhotos(e)
          const G = appConfig.copy.photoGeo
          const placements = photos.map((_, i) => photoPlacement?.(e, i) ?? null)
          const toPlace = placements.filter((p) => p?.kind === 'place').length
          const placedId = placements.find((p) => p?.kind === 'placed')
          const disc = journalDisc(e, plans)
          const repeated = repeats.counts.get(e.id) ?? 1
          const lastRepeat = repeats.lastAt.get(e.id)
          // A row is «von Hand erfasst» exactly where the pen is offered (lib/verlauf ·
          // isHandWritten) — so the sheet answers «warum kann ich das nicht ändern» with the
          // same rule that decides it, instead of leaving an absent button to explain itself.
          const byHand = isHandWritten(e)
          // THE TITLE is the message itself (owner's pick 8, sweep E.4 — it reused the composer's
          // «Neuer Eintrag»), without the type tag the composer writes into the text («Auftrag · …»):
          // the meta line under it says the Art. A row that IS the bare tag (a photo-only
          // Sofortmassnahme) keeps its own word.
          const title = withoutAreaPrefix(rowText(e)) || rowText(e)
          // THE META LINE: when to the second · the Art (Info · Auftrag · Sofortmassnahme · Pendenz)
          // or the Bereich (Tafel, Lage …) — the filter's two groups (sweep E.5) — · who wrote it.
          // The time is the only place in the app that prints SECONDS: the list shows HH:MM, so «why
          // is this line above that one» has no answer anywhere else (the Verlauf sorts on the full
          // stamp — lib/journalStore · chronological).
          const meta = [
            e.at ? formatTime(new Date(e.at), true) : null,
            disc?.label,
            byHand ? C.detailSourceManual : C.detailSourceSystem,
          ].filter(Boolean).join(' · ')
          // THE FACTS: what the meta line does not say, in the order the questions get asked after
          // the fact — what came with it, and what happened to it afterwards
          const facts: { k: string; v: string; sub?: string }[] = [
            ...(photos.length
              ? [{ k: C.detailAttachments, v: photos.length === 1 ? C.detailAttachmentsOne : fillTemplate(C.detailAttachmentsN, { n: photos.length }) }]
              : []),
            // where each picture was taken — only for those that know it (lib/photoGeo)
            ...placements.flatMap((p, i) => (p ? [{
              k: photos.length > 1 ? fillTemplate(G.whereN, { n: i + 1 }) : G.where,
              v: fillTemplate(G.distance, { d: fmtDistance(p.distanceM) }),
              sub: p.kind === 'far' ? G.tooFar : [
                // where the position came from — the photo's own EXIF, or the device's position
                // when the picture arrived (lib/devicePosition), with how sure that fix was
                p.geo.source === 'device' ? G.sourceDevice : G.sourceExif,
                p.geo.source === 'device' && p.geo.acc != null ? fillTemplate(G.accuracy, { m: p.geo.acc }) : null,
                p.geo.heading != null ? fillTemplate(G.facing, { dir: appConfig.copy.weather.cardinalsLong[cardinalIndex(p.geo.heading)] }) : null,
                takenClock(p.geo.takenAt) ? fillTemplate(G.takenAt, { t: takenClock(p.geo.takenAt)! }) : null,
              ].filter(Boolean).join(' · ') || undefined,
            }] : [])),
            ...(e.correctedAt
              ? [{
                  k: C.detailCorrected,
                  v: formatTime(new Date(e.correctedAt), true),
                  ...(e.textOriginal ? { sub: fillTemplate(C.detailCorrectedFirst, { text: withoutAreaPrefix(e.textOriginal) || e.textOriginal }) } : {}),
                }]
              : []),
            ...(repeated > 1
              ? [{ k: C.detailRepeated, v: lastRepeat ? fillTemplate(C.detailRepeatedN, { n: repeated, t: formatTime(new Date(lastRepeat)) }) : fillTemplate(C.repeated, { n: repeated }) }]
              : []),
            ...(isNachtrag(e, closedAt) ? [{ k: C.detailNachtrag, v: C.detailNachtragHint }] : []),
          ]
          return (
            <Sheet open onClose={() => setDetailId(null)} fit sheetClassName="jr-detail"
              title={(
                <span className="jr-detail-title" ref={(el) => { if (el) setDetailClamped(el.scrollHeight > el.clientHeight + 1) }}>
                  {marked(title, e.subjectId)}
                </span>
              )}>
              <p className="jr-detail-meta">
                {meta}
                {!byHand && <small>{C.detailSourceSystemHint}</small>}
              </p>
              {/* THE PICTURES, before the paperwork. A photo row's text is «Foto» or the Bereich's
                  own word (lib/verlauf · rowText), so the sheet used to open on a sentence that
                  said nothing about the one thing the row was written to carry — and the picture
                  itself was only reachable from the thumbnail back in the list.
                  ⚠️ `thumbUrl`, not the full media URL: a strip of full-size pictures in a modal
                  is exactly what jetsammed the tab once (lib/mediaUrl). The tap opens `url`. */}
              {photos.length > 0 && (
                <div className="jr-detail-shots">
                  {photos.map((url, i) => (
                    <button
                      key={url} type="button" title={C.photoOpen} aria-label={C.photoOpen}
                      onClick={() => openPhoto(url, { caption: e.text, filename: `foto-${e.id}-${i + 1}.jpg` })}
                    >
                      <img src={thumbUrl(url)} alt="" loading="lazy" decoding="async" />
                    </button>
                  ))}
                </div>
              )}
              {/* the row's own words, whole, when the title had to stop at five lines */}
              {detailClamped && <p className="jr-detail-text">{marked(rowText(e), e.subjectId)}</p>}
              {/* …and on a memo what it says (the list's subtitle chrome) */}
              {e.audioUrl && hasTx && (
                <div className="jr-subs">
                  {e.transcript && <p><span>{marked(e.transcript)}</span></p>}
                  {(e.transcriptSections ?? []).map((s, i) => (
                    <p key={i}><i>{fmtDuration(s.at)}</i><span>{marked(s.text)}</span></p>
                  ))}
                </div>
              )}
              {/* ── THE FACTS ── what the meta line does not say (`facts` above). ⚠️ Only lines with
                  an answer are printed — a table of «–» teaches nothing and buries the one fact
                  that IS there; a plain row has no table at all. */}
              {facts.length > 0 && (
                <dl className="jr-detail-facts">
                  {facts.map((f) => (
                    <div key={f.k}>
                      <dt>{f.k}</dt>
                      <dd>{f.v}{f.sub && <small>{f.sub}</small>}</dd>
                    </div>
                  ))}
                </dl>
              )}
              <div className="jr-detail-acts">
                {e.audioUrl && e.audioMeta && onOpenPlayer && (
                  <Button block icon={<Icon id="wave" />}
                    onClick={() => { setDetailId(null); onOpenPlayer(e) }}>
                    {C.playerOpen}
                  </Button>
                )}
                {e.audioUrl && onTranscript && (
                  <Button block className={hasTx ? undefined : 'jr-da-miss'} icon={<Icon id={hasTx ? 'type' : 'warn'} />}
                    onClick={() => { setDetailId(null); setEditTx({ id: e.id, value: e.transcript ?? '' }) }}>
                    {hasTx ? C.transcriptEdit : C.transcriptAdd}
                  </Button>
                )}
                {onEditText && isHandWritten(e) && !e.audioUrl && (
                  <Button block icon={<Icon id="pen" />}
                    onClick={() => { setDetailId(null); setEditRow({ id: e.id, value: e.text }) }}>
                    {C.editEntry}
                  </Button>
                )}
                {/* the picture's own place — offered only for a picture that knows it */}
                {toPlace > 0 && onPhotoPlace ? (
                  <Button block icon={<Icon id="pin" />}
                    onClick={() => { setDetailId(null); onPhotoPlace(e) }}>
                    {toPlace === 1 ? G.place : fillTemplate(G.placeN, { n: toPlace })}
                  </Button>
                ) : placedId?.kind === 'placed' && onPhotoShow ? (
                  <Button block icon={<Icon id="pin" />}
                    onClick={() => { setDetailId(null); onPhotoShow(placedId.entityId) }}>
                    {G.show}
                  </Button>
                ) : null}
                {target != null && (
                  <Button block icon={<Icon id={target === 'plan' ? 'flag' : 'pin'} />}
                    onClick={() => { setDetailId(null); onSelect(e) }}>
                    {target === 'plan' ? appConfig.copy.atemschutz.showOnPlan : appConfig.copy.atemschutz.showOnMap}
                  </Button>
                )}
              </div>
            </Sheet>
          )
        })()}
    </Overlay>
  )
}
