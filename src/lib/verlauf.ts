import { appConfig } from '../config/appConfig'
import { formatTime, formatLocale } from './format'
import type { BoardDoc, JournalEntryType, TimelineEvent } from '../types'

/**
 * Verlauf display helpers: localized row times, the Nachtrag boundary, and day grouping.
 *
 * An incident's journal can span days (Hochwasser) or carry corrections appended weeks
 * after the Einsatzende (archive → reopen, the correction path). Bare HH:MM rows made a
 * three-weeks-later Nachtrag look like it happened on incident day — these helpers give
 * the drawer date separators and let rows after `closed_at` carry a Nachtrag badge.
 */

/** Display time from the absolute timestamp when present (server rows ship t='' and the
 *  server clock is UTC — the client localises); legacy rows fall back to their baked t. */
export const rowTime = (e: TimelineEvent): string => (e.at ? formatTime(new Date(e.at)) : e.t)

/** How far past the Einsatzende a row written BY the Abschluss may be stamped and still count as
 *  part of the close — the backend's clock tolerance for a closed Einsatz (api/incidents ·
 *  CLOSED_CLOCK_TOLERANCE), so the flag can never carry a real Nachtrag off the paper. */
export const AT_CLOSE_TOLERANCE_MS = 120_000

/** What the Einsatz still holds – the second half of «is this row a way somewhere»
 *  (`rowTarget`). Built by `liveTargets` from the workspace's current state and handed to the
 *  Verlauf; the lookups build their sets on first use, so an unopened drawer costs nothing. */
export interface LiveTargets {
  /** a Karte object or drawing the jump can select (useJournalWriters · focusEvent looks in the
   *  same lists) */
  entity: (id: string) => boolean
  /** a plan document in this Einsatz's catalog (the Gebäude only while its stack exists) */
  plan: (planId: string) => boolean
  /** an object still standing on that plan */
  anno: (planId: string, annoId: string) => boolean
}

/** The `LiveTargets` of a workspace: its Karte objects and drawings, its plan catalog and its
 *  plans' objects. */
export function liveTargets(mapObjects: readonly { id: string }[], plans: readonly { id: string }[], board: BoardDoc): LiveTargets {
  let ents: Set<string> | undefined, planIds: Set<string> | undefined
  const annos = new Map<string, Set<string>>()
  return {
    entity: (id) => (ents ??= new Set(mapObjects.map((x) => x.id))).has(id),
    plan: (id) => (planIds ??= new Set(plans.map((p) => p.id))).has(id),
    anno: (planId, annoId) => {
      let on = annos.get(planId)
      if (!on) annos.set(planId, on = new Set((board[planId] ?? []).map((a) => a.id)))
      return on.has(annoId)
    },
  }
}

/** A row that took something away: «… gelöscht», «n Objekte vom Plan gelöscht», a storey removed.
 *  Every removal writer stamps the ✕ glyph (useMapActions, useMapDrawing, usePlanRemoval,
 *  useGebaeudeActions) – and so did the rows written before `subjectId` existed (03.09.). */
const isRemoval = (e: TimelineEvent) => e.icon === 'close'

// A row is clickable only when it carries a real jump target that STILL EXISTS: a map entity, a
// pinned map point, or something ON a plan. Plain log lines (undo/redo, surface-only journal
// notes) are read-only — the journal is a record, not a UI.
//
// ⚠️ A removal row is never a target (owner, sweep 28.10.2026 #6): the thing it names is gone.
// `logPlan` stamps every plan row `kind: 'symbol'` unless told otherwise, so a plan deletion used
// to pass the placement test below and offer a jump to a plan that no longer showed it.
//
// ⚠️ …and neither is a row whose object has since gone (same sweep): an `entityId` no longer on
// the Karte, a plan no longer in the catalog (a Gebäude whose stack was removed), an `annoId` no
// longer on its plan. A row whose object went but which also carries a map point (`coord`) still
// lands on the point – a place outlives the thing that stood on it.
//
// ⚠️ A plan row is a target when it is about a THING on the plan: it names the annotation
// (`annoId`) or its spot (`px`), or — for the rows written before either was recorded — it is one
// of the kinds only a placement writes (`symbol` · `team`; a Pendenz or a typed note on a plan is
// about neither, and an undo is `history`).
//
// How well it lands is the second question. A placement logged since 23.08. carries annoId · px/py
// · floor, and the jump selects the object and brings it into view, the way the Lage's `entityId`
// jump always has (IncidentWorkspace · focusEvent). One logged before that carries the plan
// document alone and lands on it — which is all any plan row ever did. The record is append-only,
// so those rows are never going to grow coordinates; landing them on the right plan with nothing
// selected is the graceful floor, not a bug to guard against.
//
// (During a Wiedergabe every row is a way into the picture regardless – JournalRow · seekable.)
export const rowTarget = (e: TimelineEvent, live: LiveTargets): 'map-entity' | 'map-pin' | 'plan' | null => {
  if (isRemoval(e)) return null
  if (e.entityId && live.entity(e.entityId)) return 'map-entity'
  if (e.coord) return 'map-pin'
  if (e.entityId) return null
  const placedOnPlan = e.annoId != null || e.px != null || e.kind === 'symbol' || e.kind === 'team'
  if (e.surface !== 'plan' || !e.planId || !placedOnPlan || !live.plan(e.planId)) return null
  return e.annoId == null || live.anno(e.planId, e.annoId) ? 'plan' : null
}

/** appended after the Einsatzende (closed_at) → renders as a Nachtrag — and so does a row the
 *  server received while the Einsatz was closed, whatever time it carries (`receivedAfterClose`).
 *  ⚠️ …except what the Abschluss wrote on its way to the close (staging r6, F3): «Trupp … beim
 *  Abschluss noch drin» was stamped 0.6 s after the server's `closed_at` and printed as a
 *  Nachtrag beside an «Einsatz abgeschlossen» of the same minute that did not. */
export const isNachtrag = (e: TimelineEvent, closedAt?: string | null): boolean => {
  const close = closedAt ? Date.parse(closedAt) : Number.NaN
  const at = e.at ? Date.parse(e.at) : Number.NaN
  if (e.atClose && Number.isFinite(close) && Number.isFinite(at) && at <= close + AT_CLOSE_TOLERANCE_MS) return false
  return !!e.receivedAfterClose || (Number.isFinite(close) && Number.isFinite(at) && at > close)
}

export interface DayGroup {
  /** localized date label for the separator — null for today's rows (no separator) */
  label: string | null
  events: TimelineEvent[]
}

const dayKey = (d: Date) => `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`

/** Group a newest-first Verlauf into calendar-day runs. Rows without `at` (old data)
 *  stick to the running group rather than fragmenting the list. */
export function groupByDay(events: readonly TimelineEvent[], now: Date = new Date()): DayGroup[] {
  const todayKey = dayKey(now)
  const groups: DayGroup[] = []
  let currentKey: string | undefined
  for (const e of events) {
    const d = e.at ? new Date(e.at) : null
    const k = d && !Number.isNaN(d.getTime()) ? dayKey(d) : (currentKey ?? todayKey)
    if (k !== currentKey || groups.length === 0) {
      currentKey = k
      groups.push({
        label:
          k === todayKey
            ? null
            : (d ?? now).toLocaleDateString(formatLocale(), {
                weekday: 'short', day: '2-digit', month: '2-digit', year: 'numeric',
              }),
        events: [],
      })
    }
    groups[groups.length - 1].events.push(e)
  }
  return groups
}

/** Every picture on a row, old shape and new: rows written before 2026-08-06 carry a single
 *  `photoUrl`, newer ones a `photoUrls` list. Readers use THIS, never the fields. */
export function rowPhotos(e: { photoUrl?: string; photoUrls?: string[] }): string[] {
  return e.photoUrls?.length ? e.photoUrls : e.photoUrl ? [e.photoUrl] : []
}

/**
 * The text a photo row should SHOW — its own caption, else the bare word «Foto».
 *
 * ⚠️ REVERSED 31.08. This used to blank the caption on a wordless picture, on the argument that
 * «Foto» over a photo says the one thing the reader can already see. In the field it read as a
 * broken row instead: a run of pictures came out as a column of timestamps with nothing beside
 * them, and neither the Verlauf nor the printed Rapport said what those rows even were. The
 * duplication is the cheaper mistake — a Rapport is read by people who were not there.
 *
 * Render-only, in both directions — the same rule (and the same reason) as `withoutAreaPrefix`
 * in lib/report: the Verlauf is append-only and hash-chained, so nothing here writes to the
 * record. Rows written before 06.08. carry the word themselves and simply keep it; newer ones
 * carry no text at all (IncidentWorkspace · addJournal) and borrow it from the live copy, so
 * the placeholder answers in the deployment's own locale.
 *
 * A row whose photo never arrived is NOT a photo row here — it keeps whatever it was written
 * with, which is the only thing left saying a picture was meant.
 */
export function rowText(e: { text: string; photoUrl?: string; photoUrls?: string[] }): string {
  if (!rowPhotos(e).length) return e.text
  return e.text.trim() || appConfig.copy.journal.photoNote
}

/** Replace one URL in a row's photo list, keeping the others and the order. Used when one of
 *  several attached pictures finishes uploading: the row's other photos (still local blob:
 *  URLs, or already uploaded) must survive that patch untouched. */
export function swapUrl(list: string[] | undefined, from: string, to: string): string[] {
  const arr = list ?? []
  return arr.includes(from) ? arr.map((u) => (u === from ? to : u)) : [...arr, to]
}

/**
 * Did a HUMAN write this line, in their own words?
 *
 * Only those rows may be corrected (see Journal · the pen). Everything else in the Verlauf is
 * the app reporting what happened — «Symbol gesetzt», «Trupp 2 eingerückt», «Haken bei
 * Bereitstellung» — and a sentence the app wrote about an action is not a sentence anybody may
 * rewrite: it would say the action went differently than it did, in a record whose whole point
 * is that it does not.
 *
 * ⚠️ The kind alone is not enough. A Checklisten-Haken is written as `kind: 'journal'` too (it
 * IS a documented decision, see report · journalArea), but its text is composed from the item —
 * so the icon has to agree as well. The three icons here are exactly what the composer stamps:
 * `type` for text, `mic` for a Sprachnotiz, `photo` for pictures.
 */
export function isHandWritten(e: TimelineEvent): boolean {
  if (e.kind !== 'journal' && e.kind !== 'audio' && e.kind !== 'photo') return false
  return e.icon === 'type' || e.icon === 'mic' || e.icon === 'photo'
}

/** The disc of a typed hand-written row — its Art (owner pick B, UI sweep 07.10.2026). */
export type ArtTone = 'auftrag' | 'sofort'
export const ART_DISC: Record<Exclude<JournalEntryType, 'info'>, { icon: string; tone: ArtTone }> = {
  auftrag: { icon: 'arrow', tone: 'auftrag' },
  sofort: { icon: 'warn', tone: 'sofort' },
}

/**
 * The glyph a Verlauf row's disc shows. Every row carries its own STORED icon (`e.icon`), and the
 * composer stamps `type` on every text entry — so seven rows of Info, Auftrag and Sofortmassnahme
 * read as seven identical «T» (UI sweep 07.10.2026, A11). A TEXT row that was given an Art now
 * shows it: Auftrag the arrow on a blue tint, Sofortmassnahme the warning on amber; Info keeps
 * the «T». Derived HERE, at render, from `entryType` — never written back — so every row ever
 * recorded, and every other device's, reads the same. A Sprachnotiz or a Foto keeps its mic/photo
 * (the medium is the more useful thing to see there), and every automatic row its own glyph.
 */
export function rowGlyph(e: TimelineEvent): { icon?: string; tone?: ArtTone } {
  if (e.kind === 'journal' && e.icon === 'type' && e.entryType && e.entryType !== 'info') {
    const art = ART_DISC[e.entryType]
    if (art) return art
  }
  return { icon: e.icon }
}

/** How close two identical lines have to be for the second to read as a REPEAT rather than as
 *  news. Deliberately short: the ping that spams is a state the app re-states every few seconds
 *  (an überfällige Kontaktuhr) or a button tapped six times in two seconds, while a genuinely
 *  new Überfällig is at least one Funkkontakt-Intervall away. Nothing is ever collapsed across
 *  a gap longer than this, so a second turnus keeps its own line. */
const REPEAT_WINDOW_MS = 2 * 60_000

/**
 * Runs of the SAME line about the SAME object repeated within {@link REPEAT_WINDOW_MS} — the
 * Verlauf and the printed journal show the first of them and say how often it repeated, instead
 * of the same sentence twenty times.
 *
 * The run key is **text + object** (`entityId ?? annoId ?? subjectId`), never text alone. Two
 * different Notizen dropped seconds apart both write «Notiz gesetzt», and two shapes drawn in one
 * burst both write the same line — on text alone those collapsed to «Notiz gesetzt 2×», which
 * claims one thing happened twice where two things happened once. Rows about no object at all (an
 * überfällige Kontaktuhr) share the empty object key and collapse exactly as before.
 *
 * ⚠️ `subjectId` is the half that was missing (04.09.). A DELETION names its object and then
 * cannot point at it, and a drawing edit has no jump target at all, so both wrote rows with no
 * object key — and the 03.09. Rapport printed «Feuerwehr gelöscht 2×», «Polizei gelöscht 2×»,
 * «Lüfter gelöscht 2×» where each pair was two different symbols removed a few seconds apart.
 * See types · TimelineEvent.subjectId for why it is not simply `entityId`.
 *
 * ⚠️ A run ENDS when something else happens to the same object (04.09., Manuel's Rapport).
 * Brunner's card read «Austritt 16:19 · Eingerückt 16:20 · Austritt 16:20» and the sheet printed
 * one row, «Austritt 2×» — a second, real deployment cycle folded into the first, because the two
 * Austritte matched each other across the Eintritt standing between them. A repeat is a line the
 * app could not stop saying; a line that comes back AFTER the object has done something else is
 * news. So an object holds at most ONE open run: anything else about it closes what was open.
 *
 * ⚠️ Rows about no object at all keep the old, purely text+time rule. There the run key is all
 * that is known, and rows that share it are the app re-stating a state (an überfällige
 * Kontaktuhr); closing those runs against each other would collapse nothing at all.
 *
 * ⚠️ Display only. Every row stays in the append-only record and in the hash chain; this decides
 * what is worth READING. The count is shown («6×») rather than silently swallowed — a reader has
 * to be able to tell «this happened once» from «this happened and would not stop».
 *
 * ⚠️ Hand-written rows are never collapsed. Somebody who types the same sentence twice meant it
 * both times, and the journal is their record, not the app's.
 */
export function repeatRuns(events: TimelineEvent[]): {
  counts: Map<string, number>
  hidden: Set<string>
  /** ISO instant of the LAST repeat in each run — the detail sheet says «6× bis 14:34», because
   *  «6×» alone leaves a reader unable to tell a burst from something that ran for two minutes. */
  lastAt: Map<string, string>
} {
  const counts = new Map<string, number>()
  const hidden = new Set<string>()
  const lastAt = new Map<string, string>()
  const open = new Map<string, { id: string; lastMs: number }>()
  /** the ONE run each object currently has open — see the note above. Objectless rows are absent
   *  from here and fall back to the text+time rule alone. */
  const openOf = new Map<string, string>()
  const chrono = events
    .filter((e) => e.at && !isHandWritten(e))
    .sort((a, b) => Date.parse(a.at!) - Date.parse(b.at!))
  for (const e of chrono) {
    const text = e.text.trim()
    if (!text) continue
    const obj = e.entityId ?? e.annoId ?? e.subjectId ?? ''
    // NUL joins the two halves so an object id can never run into the text and fake a match.
    const key = `${obj}\u0000${text}`
    const ms = Date.parse(e.at!)
    if (!Number.isFinite(ms)) continue
    // ⚠️ A ↶ / ↷ row ends EVERY open run (staging walk-through 25.09.2026, F2c). It names no
    // object, yet it takes an act back — so the same line after it is a new act, not the app
    // repeating itself: «Gefahrentafel angedockt», ↶, «… angedockt» again printed as ONE row
    // «2×», and the paper then said the placard was docked twice with nothing in between.
    if (e.kind === 'history') { open.clear(); openOf.clear(); continue }
    const run = open.get(key)
    // …and, for a row that names its object, only while nothing else has happened to it since
    if (run && ms - run.lastMs <= REPEAT_WINDOW_MS && (!obj || openOf.get(obj) === key)) {
      counts.set(run.id, (counts.get(run.id) ?? 1) + 1)
      hidden.add(e.id)
      lastAt.set(run.id, e.at!)
      run.lastMs = ms
      continue
    }
    // a fresh run under the same key REPLACES the closed one, so the second Austritt keeps its own
    // row rather than joining a run the Eintritt between them had already ended
    open.set(key, { id: e.id, lastMs: ms })
    if (obj) openOf.set(obj, key)
  }
  return { counts, hidden, lastAt }
}

/** One mark on the Verlauf strip's time scale: where it stands (0–1 along the track) and the
 *  clock it prints, if there is room for it. A mark closer to a track end than half a label
 *  prints its clock flush with that `edge` instead of centred under it (Journal · `.jr-strip-edge`). */
export interface StripMark { frac: number; label?: string; edge?: 'start' | 'end' }

/** The scale steps the strip may use, in minutes — the first one whose marks stand far enough
 *  apart wins, so a 40-minute Einsatz gets quarter hours and a Hochwasser six-hour marks. */
const STRIP_STEPS = [5, 10, 15, 30, 60, 120, 180, 360, 720, 1440]
/** A «HH:MM» label at 12.5px mono is ~38px; this is that plus its breathing room. */
const STRIP_LABEL_PX = 46

/**
 * The time scale under the Verlauf strip's ticks (Journal · `.jr-strip`): marks on round local
 * times (full hours for an afternoon's Einsatz), and the Einsatz's first and last moment as the
 * two end stamps. `trackPx` is the track's measured width.
 * ⚠️ A mark's clock is never dropped for a stamp – the STAMP gives way (`start` / `end` undefined):
 * «14:08 · 16:00 · 17:00» with 15:00 swallowed read as one hour from the start to 16:00 (hill
 * climb r27, Opus 3). A mark only goes unlabelled when it would print over the previous mark's
 * clock, which the step's spacing rules out except on a track too narrow for any step.
 * Unmeasured (`trackPx` 0, e.g. jsdom) it draws at most six unlabelled marks and both stamps.
 */
export function stripScale(from: number, to: number, trackPx: number): { start?: string; end?: string; marks: StripMark[] } {
  const span = to - from
  const minPx = trackPx > 0 ? STRIP_LABEL_PX + 12 : 0
  const step = STRIP_STEPS.find((m) => (trackPx > 0 ? (m * 60_000 / span) * trackPx >= minPx : span / (m * 60_000) <= 6))
    ?? STRIP_STEPS[STRIP_STEPS.length - 1]
  const marks: StripMark[] = []
  const half = STRIP_LABEL_PX / 2
  // the labelled clocks' extent along the track, px: the stamps test against these
  let firstLeft = Infinity
  let lastRight = -Infinity
  // walk local wall-clock time from the hour before `from`, so DST and odd offsets stay on the clock
  const d = new Date(from)
  d.setMinutes(0, 0, 0)
  while (d.getTime() < to) {
    const t = d.getTime()
    const onStep = step < 60 ? d.getMinutes() % step === 0 : d.getMinutes() === 0 && d.getHours() % (step / 60) === 0
    if (t > from && onStep) {
      const frac = (t - from) / span
      const px = frac * trackPx
      const edge = px < half ? 'start' : px > trackPx - half ? 'end' : undefined
      const left = edge === 'start' ? 0 : edge === 'end' ? trackPx - STRIP_LABEL_PX : px - half
      if (trackPx > 0 && left >= lastRight) {
        firstLeft = Math.min(firstLeft, left)
        lastRight = left + STRIP_LABEL_PX
        marks.push(edge ? { frac, label: formatTime(d), edge } : { frac, label: formatTime(d) })
      } else marks.push({ frac })
    }
    d.setMinutes(d.getMinutes() + Math.min(step, 60))
  }
  return {
    start: firstLeft >= STRIP_LABEL_PX ? formatTime(new Date(from)) : undefined,
    end: lastRight <= trackPx - STRIP_LABEL_PX ? formatTime(new Date(to)) : undefined,
    marks,
  }
}

/** One density mark on the Verlauf strip: where it stands (0–1 along the track) and how many
 *  rows it stands for. */
export interface StripTick { frac: number; n: number }

/** The strip's density column, px: rows closer than this draw as ONE mark. */
const STRIP_COL_PX = 3

/**
 * The Verlauf strip's row marks (Journal · `.jr-strip i`): the rows' moments (`ticks`, ascending
 * ms) merged into `STRIP_COL_PX` columns of the measured track, one mark per column that holds
 * any, at the mean position of its rows and with their count — so 300 rows read as density
 * (a busy column a step darker), not as 300 equal hairlines. Look only: the tap still jumps
 * by time (Journal · jumpTo). Unmeasured (`trackPx` 0, e.g. jsdom) every row is its own mark.
 */
export function stripDensity(ticks: readonly number[], from: number, to: number, trackPx: number): StripTick[] {
  const span = to - from
  if (span <= 0) return []
  const fracs = ticks.map((t) => (t - from) / span)
  if (trackPx <= 0) return fracs.map((frac) => ({ frac, n: 1 }))
  const lastCol = Math.max(0, Math.ceil(trackPx / STRIP_COL_PX) - 1)
  const cols = new Map<number, { sum: number; n: number }>()
  for (const f of fracs) {
    const col = Math.min(lastCol, Math.floor((f * trackPx) / STRIP_COL_PX))
    const c = cols.get(col)
    if (c) { c.sum += f; c.n++ } else cols.set(col, { sum: f, n: 1 })
  }
  return [...cols.values()].map(({ sum, n }) => ({ frac: sum / n, n }))
}

/**
 * Where the Pendenzen box (Journal · `.jr-pinned`) ends at rest so it never shows a partly
 * visible row: the box's height when it is cut at the top of the first row that does not fit
 * whole, so its «more below» foot band lands where that row's separator rule stands and the row
 * above ends with its own padding (+ the flex gap) as clearance. Only asked while the box
 * overflows its CSS max-height. `rowTops` are the rows' top edges in the box's border-box
 * coordinates at scroll 0, ascending; `capPx` the box's height under that max-height; `footPx`
 * what the box needs below the cut (the foot band + its bottom border). `null` = keep the CSS cap:
 * not even the second row's top fits, so the first row is taller than the box and scrolls as it is.
 */
export function pendenzenCut(rowTops: readonly number[], capPx: number, footPx: number): number | null {
  let cut: number | null = null
  for (const top of rowTops.slice(1)) if (top + footPx <= capPx) cut = top + footPx
  return cut
}

/**
 * How many Pendenzen the box's foot strip announces («3 weitere»): the rows wholly or partly
 * below the fold at the current scroll. `rowBottoms` are the rows' bottom edges and `foldPx` the
 * foot strip's top edge, both in one coordinate space (Journal reads them as viewport rects); a
 * row ending within half a pixel of the fold is whole – subpixel layout, not a hidden row.
 */
export function pendenzenBelow(rowBottoms: readonly number[], foldPx: number): number {
  return rowBottoms.filter((bottom) => bottom > foldPx + 0.5).length
}
