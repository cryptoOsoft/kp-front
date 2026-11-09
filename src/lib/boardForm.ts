import { fillTemplate, localeDate, localeDateTime } from './format'
import { dayBreaks } from './formDays'
import { newId } from './ids'
import { compareOrder, isOrderKey, keyBetween, keysFor } from './orderKey'
import {
  editableColumns, isLabel, isTemplatePage, labelText, shownColumns, shownFixedRows, shownSections, tableAddsRows, writtenColumns,
  type BoardTemplate, type Label, type LiveSection, type TableSection, type TemplatePage,
} from './boardTemplate'
import type { BoardAnno } from '../types'

/**
 * A Tafel PAGE — one board-template page added to an Einsatz, with everything written on it
 * (10.10.2026; generalises the staging «Erstes Plakat», lib/plakat on feat/tafel-start).
 *
 * ⚠️ ONE board anno of kind `form` on the Tafel's own sheet (`board['tafel']`), carrying the page
 * SNAPSHOT and its values. That is the whole persistence story, on purpose: the anno rides the
 * board's write path (useBoardDoc · add / patchCommit / remove), so adding a page is one ↶ step,
 * every committed cell is one ↶ step, removing a page is one ↶ step, and it syncs, survives a
 * reload and works offline exactly like a note on the same sheet. It has no x/y/pts, so nothing
 * positional (lasso, bake onto the Karte, projection, plan print) ever sees it — the Whiteboard
 * splits it off before any of that runs (Whiteboard · formAnnos). A merge is per object, so two
 * devices on two different pages never collide; two on the same page keep the later write.
 *
 * Values are keyed by section / cell / column / row id — never by position or label — so a
 * station renaming «Wer» to «Zuständig» in its file loses nothing, and the page's own snapshot
 * (`page`) keeps an open or archived Einsatz printing exactly what it was filled in against.
 */

/** The Tafel's plan id — the one sheet that has pages (data/demoIncident · planDocuments). Here,
 *  not in lib/tafelPages: the Rapport needs it too, and this module is already where they meet. */
export const TAFEL_ID = 'tafel'

export type FormTrend = 'up' | 'same' | 'down'
/** Where a problem shown on a page comes from, in the VIEW a page is drawn from (lib/problemLink ·
 *  problemView) – never stored: `checklist` = a ticked checklist item (its words are the
 *  checklist's, a small icon says so). */
export type EntrySource = 'checklist'
/** one written line in a Problemerfassung box. `ord`: its place in the box (lib/orderKey · see
 *  `ordered`); `slot` is the ruling it was written on by the builds of 10.10.2026 only — read once,
 *  for the order, never written again */
export interface FormLine { id: string; text: string; trend?: FormTrend; tag?: string; ord?: string; slot?: number; src?: EntrySource }
/** one table row: the typed cells by column id (a trend column holds 'up' | 'same' | 'down').
 *  `seed` marks a row the page pre-filled (a vehicle in «Mittel») until somebody edits it.
 *  `ord` / `slot`: as on a line — the row's place among the written rows */
export interface FormRow { id: string; cells: Record<string, string>; done?: boolean; seed?: boolean; ord?: string; slot?: number; src?: EntrySource }
export interface FormSectionValue {
  /** quad: lines per box id */
  lines?: Record<string, FormLine[]>
  /** table: rows — the fixed rows under their template ids, written rows after them */
  rows?: FormRow[]
  /** text: field values by field id */
  fields?: Record<string, string>
}
export interface FormHead { title?: string; address?: string; alarm?: string; el?: string }
export interface BoardFormData {
  v: 1
  /** which template, which version — the station file it came from, as it was then */
  tpl: { id: string; version: number; title: Label; source?: string }
  /** the page as it stood in that file when it was added (the snapshot) */
  page: TemplatePage
  /** when the page was added — the order of the page strip */
  at: string
  /** the optional header line (page.header) */
  head?: FormHead
  values: Record<string, FormSectionValue>
  /** when each written atom was last changed (`formAtoms` key → server ms) — what settles a
   *  cell two devices changed at once (lib/boardFormMerge): the later edit stands */
  t?: Record<string, number>
  /** when the page was taken off the Tafel (server ms) — a tombstone, not a deletion (re-review
   *  of #338): a device still writing on it meanwhile must be able to tell whether its writing
   *  came after the removal (lib/mergeWorkspace · resolveTactical). Kept for ↶ and that merge;
   *  never shown, printed or offered (`findForms`). */
  removedAt?: number
}
export type FormAnno = BoardAnno & { kind: 'form'; form: BoardFormData }

/** What the Einsatz already knows, handed in when a page is added (lib/boardSeed). */
export interface FormSeed {
  title?: string | null
  address?: string | null
  /** «11:24», already formatted */
  alarm?: string | null
  einsatzleiter?: string | null
  /** vehicle names known to the Einsatz — deduplicated here */
  vehicles?: readonly string[]
}

// ── making a page ─────────────────────────────────────────────────────────────────────────────

const dedupe = (names: readonly string[]) => {
  const seen = new Set<string>()
  return names.map((v) => v.trim()).filter((v) => {
    const k = v.toLowerCase()
    if (!v || seen.has(k)) return false
    seen.add(k)
    return true
  })
}

/** A fresh page off a template: empty but for what a section asks to be seeded with. */
export function newFormPage(tpl: BoardTemplate, page: TemplatePage, seed: FormSeed = {}, at: string = new Date().toISOString()): BoardFormData {
  const values: Record<string, FormSectionValue> = {}
  const vehicles = dedupe(seed.vehicles ?? [])
  for (const s of page.sections) {
    if (s.type === 'table' && s.seed === 'vehicles' && vehicles.length && tableAddsRows(s)) {
      const first = editableColumns(s)[0]
      const keys = keysFor(vehicles.length)
      if (first) values[s.id] = { rows: vehicles.map((name, i) => ({ id: newId('fr'), cells: { [first.id]: name }, seed: true, ord: keys[i] })) }
    }
  }
  return {
    v: 1,
    tpl: { id: tpl.id, version: tpl.version, title: tpl.title, ...(tpl.source ? { source: tpl.source } : {}) },
    page: JSON.parse(JSON.stringify(page)) as TemplatePage,
    at,
    ...(page.header ? { head: { title: seed.title?.trim() ?? '', address: seed.address?.trim() ?? '', alarm: seed.alarm?.trim() ?? '', el: seed.einsatzleiter?.trim() ?? '' } } : {}),
    values,
  }
}

/** The anno that carries a page. */
export const formAnno = (form: BoardFormData): FormAnno => ({ id: newId('fm'), kind: 'form', form })

/** A Tafel page this build can draw (see isFormData for why that is not «kept»). */
export const isFormAnno = (a: BoardAnno): a is FormAnno => a.kind === 'form' && isFormData(a.form)

/** The pages on a sheet, in the order they were added (the array order is the store's, not ours). */
export const findForms = (annos: readonly BoardAnno[]): FormAnno[] =>
  annos.filter((a): a is FormAnno => isFormAnno(a) && a.form.removedAt == null).sort((a, b) => a.form.at.localeCompare(b.form.at) || a.id.localeCompare(b.id))

/**
 * What each page is called on screen and on paper (owner, 10.10. evening: «multiple pages of the
 * same thing since there could be multiple concepts»): its title, and from the second instance
 * of a repeatable page on, a number — «Konzept», «Konzept 2», … — in the order they were added.
 * A number is a page's place among the pages of its kind that are there NOW (a removed one
 * leaves no hole).
 */
export function pageTitles(annos: readonly BoardAnno[], locale?: string): Map<string, string> {
  const seen = new Map<string, number>()
  const out = new Map<string, string>()
  for (const a of findForms(annos)) {
    const key = `${a.form.tpl.id}/${a.form.page.id}`
    const n = (seen.get(key) ?? 0) + 1
    seen.set(key, n)
    const title = labelText(a.form.page.title, locale)
    out.set(a.id, n > 1 ? `${title} ${n}` : title)
  }
  return out
}

// ── the gate a synced page passes (lib/workspace · isBoardAnno) ─────────────────────────────────

const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v)
const isStrMap = (v: unknown) => isObj(v) && Object.values(v).every((x) => typeof x === 'string')
const TRENDS: readonly unknown[] = ['up', 'same', 'down']
/** a slot (10.10.2026 builds) was a ruling on the page: a small whole number; an order key is
 *  lib/orderKey's. A malformed one is not a reason to drop the entry — it is ignored (`ordered`). */
const isSlot = (v: unknown) => v === undefined || (Number.isInteger(v) && (v as number) >= 0)
const isOrd = (v: unknown) => v === undefined || typeof v === 'string'
const isLine = (v: unknown) => isObj(v) && typeof v.id === 'string' && typeof v.text === 'string'
  && (v.trend === undefined || TRENDS.includes(v.trend)) && (v.tag === undefined || typeof v.tag === 'string') && isSlot(v.slot) && isOrd(v.ord)
const isRow = (v: unknown) => isObj(v) && typeof v.id === 'string' && isStrMap(v.cells)
  && (v.done === undefined || typeof v.done === 'boolean') && (v.seed === undefined || typeof v.seed === 'boolean') && isSlot(v.slot) && isOrd(v.ord)
const isSectionValue = (v: unknown) => isObj(v)
  && (v.lines === undefined || (isObj(v.lines) && Object.values(v.lines).every((ls) => Array.isArray(ls) && ls.every(isLine))))
  && (v.rows === undefined || (Array.isArray(v.rows) && v.rows.every(isRow)))
  && (v.fields === undefined || isStrMap(v.fields))

/**
 * A page this build can DRAW. ⚠️ Not the gate that decides whether it is KEPT: a page this build
 * cannot draw (a newer template feature, a value it does not know) rides through load and save
 * untouched as a passenger (lib/workspace · isPassengerAnno) — dropping it would make this
 * device's next save delete it for everybody. Deliberately structural: an unknown section type
 * or column type passes here and is merely not drawn (lib/boardTemplate · isUsableSection).
 */
export function isFormData(v: unknown): v is BoardFormData {
  if (!isObj(v) || v.v !== 1 || typeof v.at !== 'string' || !isTemplatePage(v.page)) return false
  if (v.t !== undefined && !(isObj(v.t) && Object.values(v.t).every((x) => typeof x === 'number'))) return false
  if (v.removedAt !== undefined && typeof v.removedAt !== 'number') return false
  const t = v.tpl
  if (!isObj(t) || typeof t.id !== 'string' || typeof t.version !== 'number' || !isLabel(t.title)) return false
  if (v.head !== undefined && !isStrMap(v.head)) return false
  return isObj(v.values) && Object.values(v.values).every(isSectionValue)
}

// ── the order of a list ───────────────────────────────────────────────────────────────────────

type Orderable = { id: string; ord?: string; slot?: number }

/**
 * ⚠️ The entries of a list STACK FROM THE TOP, in the order they are kept in (owner, 10.10.2026
 * evening: «allow for manual reordering … and then we can skip the different placed entry thing
 * altogether»): no gaps, an emptied entry closes up, and the order is the operator's — moved by
 * hand (`moveRow` / `moveLine`), never by an array position (a merge, an undo or a removal
 * reorders arrays). Each entry carries an order key (`ord`, lib/orderKey): a move writes ONE key,
 * so two devices reordering merge without losing anything, the same on every device.
 *
 * A list from before the keys is read in the order it showed: by `slot` (the builds of 10.10.,
 * whose gaps collapse now), else as stored. Its first write gives every entry a key (`pinOrder`).
 */
export function ordered<T extends Orderable>(items: readonly T[]): T[] {
  const keyed = (x: T) => typeof x.ord === 'string' && isOrderKey(x.ord)
  if (items.every(keyed)) return [...items].sort(compareOrder)
  // the old order: by slot (two on one slot — the later in the list after), else the list's own
  const rank = new Map<T, number>()
  let prev = -1
  const slots = items.map((it) => {
    const at = typeof it.slot === 'number' && Number.isInteger(it.slot) && it.slot >= 0 ? it.slot : prev + 1
    prev = at
    return at
  })
  items.map((it, i) => [it, slots[i], i] as const).sort((x, y) => x[1] - y[1] || x[2] - y[2]).forEach(([it], i) => rank.set(it, i))
  return [...items].sort((a, b) => (keyed(a) && keyed(b) ? compareOrder(a, b) : keyed(a) ? -1 : keyed(b) ? 1 : rank.get(a)! - rank.get(b)!))
}

/** Every entry with an order key and no slot — the list as it shows, kept (a list from before the
 *  keys gets them on its first write, in the order it showed). Same array where nothing changes. */
function pinOrder<T extends Orderable>(items: readonly T[]): T[] {
  if (items.every((x) => typeof x.ord === 'string' && isOrderKey(x.ord) && x.slot === undefined)) return items as T[]
  const order = ordered(items)
  const keys = keysFor(order.length)
  const key = new Map(order.map((it, i) => [it, keys[i]]))
  return items.map((it) => {
    const { slot: _s, ...rest } = it
    void _s
    return { ...rest, ord: key.get(it) } as T
  })
}

/** The key a new entry takes: after the last one (it lands directly under it). */
const appendKey = (items: readonly Orderable[]): string => {
  const o = ordered(items)
  return keyBetween(o[o.length - 1]?.ord ?? null, null)
}

/** `list` with entry `id` moved to place `to` of the order (0 = top), its key the only thing
 *  written; null when it is not there or already stands there. */
function moved<T extends Orderable>(list: readonly T[], id: string, to: number): T[] | null {
  const pinned = pinOrder(list)
  const order = ordered(pinned)
  const from = order.findIndex((x) => x.id === id)
  if (from < 0) return null
  const rest = order.filter((x) => x.id !== id)
  const k = Math.max(0, Math.min(rest.length, Math.round(to)))
  if (k === from) return null
  const ord = keyBetween(rest[k - 1]?.ord ?? null, rest[k]?.ord ?? null)
  return pinned.map((x) => (x.id === id ? { ...x, ord } : x))
}

/** A box's lines in their order (see `ordered`). */
export const boxLines = (d: BoardFormData, sec: string, box: string): FormLine[] => ordered(d.values[sec]?.lines?.[box] ?? [])

// ── writing ───────────────────────────────────────────────────────────────────────────────────

/** «1124» → «11:24», «9.05» → «09:05», «7» → «07:00»; anything that is not a clock stays as typed. */
export function normalizeTime(raw: string): string {
  const s = raw.trim()
  const m = /^(\d{1,2})(?:[.:,h ]?(\d{2}))?$/.exec(s)
  if (!m) return s
  const h = Number(m[1]), min = Number(m[2] ?? '0')
  if (h > 23 || min > 59) return s
  return `${String(h).padStart(2, '0')}:${String(min).padStart(2, '0')}`
}

const sectionValue = (d: BoardFormData, sec: string): FormSectionValue => d.values[sec] ?? {}
export const withSection = (d: BoardFormData, sec: string, v: FormSectionValue): BoardFormData => ({ ...d, values: { ...d.values, [sec]: v } })
/** Field-wise JSON equality of two plain objects (a line, a row, a row's cells). */
const same = (a: object, b: object) => {
  const va = new Map(Object.entries(a)), vb = new Map(Object.entries(b))
  return [...new Set([...va.keys(), ...vb.keys()])].every((k) => JSON.stringify(va.get(k)) === JSON.stringify(vb.get(k)))
}

/** A line is content when it has words — a trend or a tag on its own is not (as on staging). */
const lineIsEmpty = (l: FormLine) => !l.text.trim() && !(l.tag ?? '').trim()

type LinePatch = Partial<Omit<FormLine, 'id' | 'ord' | 'slot'>>

/**
 * Write one line of a Problemerfassung box: patch it, add it under the last one when it is new,
 * drop it when the patch left it without words (the lines below close up — `ordered`). Hands
 * back the SAME object for a no-op, so the caller lays no empty ↶ step.
 */
export function putLine(d: BoardFormData, sec: string, cell: string, id: string, patch: LinePatch, at?: number): BoardFormData {
  return stamped(d, putLineRaw(d, sec, cell, id, patch), at)
}
function putLineRaw(d: BoardFormData, sec: string, cell: string, id: string, patch: LinePatch): BoardFormData {
  const v = sectionValue(d, sec)
  const list = v.lines?.[cell] ?? []
  const i = list.findIndex((l) => l.id === id)
  const before: FormLine = i >= 0 ? list[i] : { id, text: '' }
  const after: FormLine = { ...before, ...patch }
  for (const k of ['trend', 'tag'] as const) if (after[k] === undefined || after[k] === '') delete after[k]
  if (i >= 0 && same(before, after)) return d
  const empty = lineIsEmpty(after)
  if (i < 0 && empty) return d
  const pinned = pinOrder(list)
  const next = i < 0 ? [...pinned, { ...after, ord: appendKey(pinned) }]
    : empty ? pinned.filter((l) => l.id !== id) : pinned.map((l) => (l.id === id ? { ...after, slot: undefined, ord: l.ord } : l))
  for (const l of next) if (l.slot === undefined) delete l.slot
  return withSection(d, sec, { ...v, lines: { ...v.lines, [cell]: next } })
}

/** Move a line of a box to place `to` (0 = top) — one ↶ step, one key written. */
export function moveLine(d: BoardFormData, sec: string, cell: string, id: string, to: number, at?: number): BoardFormData {
  const v = sectionValue(d, sec)
  const next = moved(v.lines?.[cell] ?? [], id, to)
  return next ? stamped(d, withSection(d, sec, { ...v, lines: { ...v.lines, [cell]: next } }), at) : d
}

/** Move a written table row to place `to` among the written rows (the fixed rows stay fixed). */
export function moveRow(d: BoardFormData, sec: string, id: string, to: number, at?: number): BoardFormData {
  const s = tableOf(d, sec)
  if (!s) return d
  const v = sectionValue(d, sec)
  const list = v.rows ?? []
  const fixedIds = new Set((s.fixedRows ?? []).map((r) => r.id))
  if (fixedIds.has(id)) return d
  const next = moved(list.filter((r) => !fixedIds.has(r.id)), id, to)
  if (!next) return d
  return stamped(d, withSection(d, sec, { ...v, rows: [...list.filter((r) => fixedIds.has(r.id)), ...next] }), at)
}

/** The cells that decide whether a WRITTEN row is empty: every column typed there but a trend. */
const contentCols = (s: TableSection) => writtenColumns(s).filter((c) => c.type !== 'trend').map((c) => c.id)

/** Find a table section on the page snapshot. */
export const tableOf = (d: BoardFormData, sec: string): TableSection | undefined => {
  const s = d.page.sections.find((x) => x.id === sec)
  return s?.type === 'table' ? s : undefined
}

/**
 * Write one table row. A fixed row (one of the template's) is never dropped — clearing its cells
 * just leaves the printed row empty again. A written row is appended when it is the trailing new
 * row and dropped when the patch left all its typed cells empty (a tick or a trend alone is not
 * content). Empty cell values are not stored. Same-object return for a no-op.
 */
export function putRow(d: BoardFormData, sec: string, id: string, patch: { cells?: Record<string, string>; done?: boolean }, at?: number): BoardFormData {
  return stamped(d, putRowRaw(d, sec, id, patch), at)
}
function putRowRaw(d: BoardFormData, sec: string, id: string, patch: { cells?: Record<string, string>; done?: boolean }): BoardFormData {
  const s = tableOf(d, sec)
  if (!s) return d
  const v = sectionValue(d, sec)
  const list = v.rows ?? []
  const fixed = (s.fixedRows ?? []).some((r) => r.id === id)
  const i = list.findIndex((r) => r.id === id)
  const before: FormRow = i >= 0 ? list[i] : { id, cells: {} }
  const cells = { ...before.cells, ...patch.cells }
  for (const [k, x] of Object.entries(cells)) if (!x.trim()) delete cells[k]
  const after: FormRow = { ...before, cells, ...(patch.done !== undefined ? { done: patch.done } : {}) }
  if (!after.done) delete after.done
  // an edited seed row is the operator's row from now on
  if (after.seed && patch.cells && !same(before.cells, cells)) delete after.seed
  if (i >= 0 && same(before, after)) return d
  const empty = !contentCols(s).some((c) => (after.cells[c] ?? '').trim())
  if (fixed) {
    const bare = !Object.keys(after.cells).length && !after.done
    if (i < 0 && bare) return d
    const next = i < 0 ? [...list, after] : bare ? list.filter((r) => r.id !== id) : list.map((r) => (r.id === id ? after : r))
    return withSection(d, sec, { ...v, rows: next })
  }
  if (i < 0 && empty) return d
  // a new written row goes under the last one; an emptied one goes and the rows below close up
  // (`ordered`) — only the fixed rows have no order key, they stand where the template put them
  const fixedIds = new Set((s.fixedRows ?? []).map((r) => r.id))
  const written = list.filter((r) => !fixedIds.has(r.id))
  const pinned = new Map(pinOrder(written).map((r) => [r.id, r]))
  const keep = list.map((r) => pinned.get(r.id) ?? r)
  const next = i < 0 ? [...keep, { ...after, ord: appendKey([...pinned.values()]) }]
    : empty ? keep.filter((r) => r.id !== id) : keep.map((r) => (r.id === id ? { ...after, ord: r.ord } : r))
  for (const r of next) if (r.slot !== undefined && !fixedIds.has(r.id)) delete r.slot
  return withSection(d, sec, { ...v, rows: next })
}

/** Delete a written table row (the bin at its end, 05.11.2026) – one ↶ step; the rows below close
 *  up. A fixed row is the template's and stays: its typed cells are cleared instead. */
export function dropRow(d: BoardFormData, sec: string, id: string, at?: number): BoardFormData {
  const v = sectionValue(d, sec)
  const list = v.rows ?? []
  if (!list.some((r) => r.id === id)) return d
  return stamped(d, withSection(d, sec, { ...v, rows: list.filter((r) => r.id !== id) }), at)
}

/** Delete a line of a Problemerfassung box – as emptying it does, in one tap. */
export function dropLine(d: BoardFormData, sec: string, box: string, id: string, at?: number): BoardFormData {
  const v = sectionValue(d, sec)
  const list = v.lines?.[box] ?? []
  if (!list.some((l) => l.id === id)) return d
  return stamped(d, withSection(d, sec, { ...v, lines: { ...v.lines, [box]: list.filter((l) => l.id !== id) } }), at)
}

/** Write one field of a text section (an empty one is not stored). */
export function putField(d: BoardFormData, sec: string, field: string, value: string, at?: number): BoardFormData {
  const v = sectionValue(d, sec)
  const cur = v.fields?.[field] ?? ''
  if (cur === value) return d
  const fields = { ...v.fields, [field]: value }
  if (!value.trim()) delete fields[field]
  return stamped(d, withSection(d, sec, { ...v, fields }), at)
}

/** Write one header field. */
export function putHead(d: BoardFormData, key: keyof FormHead, value: string, at?: number): BoardFormData {
  if ((d.head?.[key] ?? '') === value) return d
  return stamped(d, { ...d, head: { ...d.head, [key]: value } }, at)
}

// ── atoms: the smallest things two devices can write — what a merge and the audit speak of ───

/**
 * A page flattened to its written ATOMS: `h|<key>` (header), `f|<sec>|<field>`, `l|<sec>|<box>|<line>`
 * (a whole line: text, trend, Stichwort), `r|<sec>|<row>|<col>` and `r|<sec>|<row>|#done`. An atom
 * that is not in the map is empty. Values are strings (a line as its JSON), so equality is `===`.
 */
export function formAtoms(d: BoardFormData): Map<string, string> {
  const out = new Map<string, string>()
  for (const [k, v] of Object.entries(d.head ?? {})) if (typeof v === 'string' && v) out.set(`h|${k}`, v)
  for (const [sec, v] of Object.entries(d.values ?? {})) {
    if (!v || typeof v !== 'object') continue
    for (const [box, lines] of Object.entries(v.lines ?? {})) {
      for (const l of Array.isArray(lines) ? lines : []) {
        // its place is an atom of its own (`…|#ord`): a move and an edit of the same line on two
        // devices both stand
        const { id, slot: _slot, ord, ...rest } = l
        void _slot
        out.set(`l|${sec}|${box}|${id}`, JSON.stringify(rest))
        if (ord) out.set(`l|${sec}|${box}|${id}|#ord`, ord)
      }
    }
    for (const r of Array.isArray(v.rows) ? v.rows : []) {
      for (const [col, x] of Object.entries(r.cells ?? {})) if (x) out.set(`r|${sec}|${r.id}|${col}`, x)
      if (r.done) out.set(`r|${sec}|${r.id}|#done`, '1')
      if (r.ord) out.set(`r|${sec}|${r.id}|#ord`, r.ord)
    }
    for (const [f, x] of Object.entries(v.fields ?? {})) if (x) out.set(`f|${sec}|${f}`, x)
  }
  return out
}

/** What changed between two versions of a page, atom by atom — the audit's `board.edit` payload
 *  (a cell, not the whole ~5 KB page) and the input of `stamped`. */
export function formDelta(a: BoardFormData, b: BoardFormData): { k: string; old?: string; new?: string }[] {
  const x = formAtoms(a), y = formAtoms(b)
  const out: { k: string; old?: string; new?: string }[] = []
  for (const k of new Set([...x.keys(), ...y.keys()])) {
    if (x.get(k) !== y.get(k)) out.push({ k, ...(x.has(k) ? { old: x.get(k) } : {}), ...(y.has(k) ? { new: y.get(k) } : {}) })
  }
  return out
}

/**
 * A page with an audit row's `form.delta` applied (`formDelta`, the `board.edit` payload) — what
 * the Replay scrubber folds so it shows the page as it was at that moment (re-review of #338).
 * Through the same writers an edit uses; a row's atoms go in together, so a new row is made
 * with all its cells at once. A row or line the page did not have yet goes after the last one
 * (the audit names cells, not rulings).
 */
export function applyFormDelta(d: BoardFormData, delta: readonly { k: string; old?: string; new?: string }[]): BoardFormData {
  let out = d
  const rows = new Map<string, { sec: string; row: string; cells: Record<string, string>; done?: boolean }>()
  /** order keys: set once the entries they belong to exist */
  const ords: { sec: string; box?: string; id: string; ord: string }[] = []
  for (const c of Array.isArray(delta) ? delta : []) {
    if (!c || typeof c.k !== 'string') continue
    const [kind, a, b, x, y] = c.k.split('|')
    const v = typeof c.new === 'string' ? c.new : ''
    if (kind === 'h' && a) out = putHead(out, a as keyof FormHead, v)
    else if (kind === 'f' && a && b) out = putField(out, a, b, v)
    else if (kind === 'l' && a && b && x && y === '#ord') { if (isOrderKey(v)) ords.push({ sec: a, box: b, id: x, ord: v }) }
    else if (kind === 'l' && a && b && x) {
      let line: Partial<FormLine> = { text: '', tag: '' }
      if (v) { try { line = { tag: '', ...(JSON.parse(v) as Partial<FormLine>) } } catch { continue } }
      out = putLine(out, a, b, x, { text: line.text ?? '', tag: line.tag ?? '', trend: line.trend })
    } else if (kind === 'r' && a && b && x === '#ord') { if (isOrderKey(v)) ords.push({ sec: a, id: b, ord: v }) }
    else if (kind === 'r' && a && b && x) {
      const key = `${a}|${b}`
      const r: { sec: string; row: string; cells: Record<string, string>; done?: boolean } = rows.get(key) ?? { sec: a, row: b, cells: {} }
      if (x === '#done') r.done = !!v
      else r.cells[x] = v
      rows.set(key, r)
    }
  }
  for (const r of rows.values()) out = putRow(out, r.sec, r.row, { cells: r.cells, ...(r.done !== undefined ? { done: r.done } : {}) })
  for (const o of ords) {
    const v = out.values[o.sec]
    if (!v) continue
    if (o.box) {
      const list = v.lines?.[o.box]
      if (list?.some((l) => l.id === o.id)) out = withSection(out, o.sec, { ...v, lines: { ...v.lines, [o.box]: list.map((l) => (l.id === o.id ? { ...l, ord: o.ord } : l)) } })
    } else if (v.rows?.some((r) => r.id === o.id)) {
      out = withSection(out, o.sec, { ...v, rows: v.rows.map((r) => (r.id === o.id ? { ...r, ord: o.ord } : r)) })
    }
  }
  return out
}

/** `next` with the edit time of every atom it changed against `prev` — or as it is without a time. */
function stamped(prev: BoardFormData, next: BoardFormData, at: number | undefined): BoardFormData {
  if (next === prev || at == null) return next
  const t = { ...prev.t }
  for (const c of formDelta(prev, next)) t[c.k] = at
  return { ...next, t }
}

/** A table's WRITTEN rows in their order, under its fixed ones (see `ordered`). */
export function writtenRows(d: BoardFormData, s: TableSection): FormRow[] {
  const fixedIds = new Set((s.fixedRows ?? []).map((r) => r.id))
  return ordered((d.values[s.id]?.rows ?? []).filter((r) => !fixedIds.has(r.id)))
}

/** The rows a table holds, in order: its shown fixed rows (written or not), then the written rows. */
export function tableRows(d: BoardFormData, s: TableSection): FormRow[] {
  const rows = d.values[s.id]?.rows ?? []
  const byId = new Map(rows.map((r) => [r.id, r]))
  return [...shownFixedRows(s).map((r) => byId.get(r.id) ?? { id: r.id, cells: {} }), ...writtenRows(d, s)]
}

/** ➚ → = → ➘ → (none) → ➚ — one tap per step, the order the sheet reads them. */
export function nextTrend(t: string | undefined): FormTrend | undefined {
  return !t ? 'up' : t === 'up' ? 'same' : t === 'same' ? 'down' : undefined
}

/** Anything written by a hand beyond what the page put there itself? (asks before removing) */
export function formHasContent(d: BoardFormData): boolean {
  if (d.head && Object.values(d.head).some((x) => (x ?? '').trim()) && !d.page.header) return true
  return Object.values(d.values).some((v) =>
    Object.values(v.lines ?? {}).some((ls) => ls.length > 0)
    || (v.rows ?? []).some((r) => !r.seed)
    || Object.values(v.fields ?? {}).some((x) => x.trim()))
}

/** The words of a page's timeline line — `appConfig.copy.tafel` fits as it is. */
export interface StampWords { stampCreated: string; stampEdited: string }

/**
 * A page's timeline, for the screen and the paper alike (owner, 26.10.2026: the page itself says
 * when it was started and last written on, not only the Verlauf): «Erstellt 26.10.2026, 11:24 ·
 * zuletzt bearbeitet 26.10.2026, 14:05». Both on the server clock — `at` when the page was added,
 * the latest cell stamp (`t`) for the edit. The edit half is left off while nothing is written
 * yet (and on pages from before the stamps).
 */
export function pageStamp(d: BoardFormData, words: StampWords): string {
  const when = (x: string | number) => localeDateTime(x, { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' })
  const created = fillTemplate(words.stampCreated, { at: when(d.at) })
  const edited = Math.max(...Object.values(d.t ?? {}))
  return edited > Date.parse(d.at) ? `${created} · ${fillTemplate(words.stampEdited, { at: when(edited) })}` : created
}

// ── the Rapport ───────────────────────────────────────────────────────────────────────────────

/** A live section's print, given its resolved heading (`base`) — see `formForPdf`. */
export type LivePrint = (s: LiveSection, base: Record<string, unknown>) => Record<string, unknown>

/** Trend words for the paper: Helvetica has no ➚ ➘ (the staging Plakat's lesson). */
export interface TrendWords { up: string; same: string; down: string }

/**
 * One page, resolved for the server (backend · app/report · BoardPageIn): every label in the
 * deployment's language, every row as the strings that print, in the layout's order. The server
 * draws the paper; it never has to know a template. `stamp`: the page's timeline (`pageStamp`),
 * printed in the footer. `live`: what a LIVE section prints — it has no values here, its rows
 * come from the Einsatz (lib/pendenzenPage · pendenzenForPdf); without one it prints its bar only.
 */
export function formForPdf(d: BoardFormData, words: TrendWords, locale?: string, headLabels?: Record<'title' | 'address' | 'alarm' | 'el', string>, title?: string, stamp = '', live?: LivePrint): Record<string, unknown> {
  const L = (l: Label | undefined) => labelText(l, locale)
  const trendWord = (t: string | undefined) => (t === 'up' ? words.up : t === 'same' ? words.same : t === 'down' ? words.down : '')
  const p = d.page
  return {
    title: title ?? L(p.title),
    source: d.tpl.source ?? '',
    stamp,
    landscape: p.paper === 'landscape',
    columns: p.columns ?? 1,
    // the header line's labels travel in the deployment's words (the server prints no German of its own here)
    head: p.header ? (['title', 'address', 'alarm', 'el'] as const).map((k) => ({ label: headLabels?.[k] ?? k, value: d.head?.[k] ?? '' })) : [],
    sections: shownSections(p).map((s) => {
      const base = { id: s.id, type: s.type, title: L(s.title), subtitle: L(s.subtitle), span: s.span ?? 1, height: s.height ?? 0 }
      const v = d.values[s.id] ?? {}
      if (s.type === 'quad') {
        return {
          ...base, trend: !!s.trend, tag: !!s.tag,
          cells: s.cells.map((c) => ({
            label: L(c.label),
            // `dir` too: the paper draws the arrow itself (Helvetica has no ➚ ➘), the word is its name.
            // In their order, no gaps — the paper shows what the Tafel shows
            lines: ordered(v.lines?.[c.id] ?? []).map((l) => ({ text: l.text, trend: s.trend ? trendWord(l.trend) : '', dir: s.trend ? l.trend ?? '' : '', tag: s.tag ? l.tag ?? '' : '' })),
          })),
        }
      }
      if (s.type === 'table') {
        const cols = shownColumns(s)
        const fixed = new Map((s.fixedRows ?? []).map((r) => [r.id, r]))
        const rows = tableRows(d, s)
        const timeCol = cols.find((c) => c.type === 'time')
        const breaks = timeCol ? dayBreaks(rows.map((r) => r.cells[timeCol.id]), d.at) : []
        return {
          ...base, done: !!s.done, adds: tableAddsRows(s),
          // an `area` column prints as the words of its choice – a text column to the paper
          columns: cols.map((c) => ({ label: L(c.label), kind: c.type === 'area' ? 'text' : c.type ?? 'text', w: c.w ?? 1 })),
          // the fixed rows, then the written ones in their order – and where a «Wann» column runs
          // past midnight, a date row before the first entry of the new day (lib/formDays)
          rows: rows.flatMap((r, i) => {
            const row = {
              fixed: fixed.has(r.id),
              done: !!r.done,
              cells: cols.map((c) => {
                if (c.fixed && fixed.has(r.id)) {
                  const x = fixed.get(r.id)?.cells[c.id]
                  return c.type === 'symbol' ? (typeof x === 'string' ? x : L(x)) : L(x)
                }
                const x = r.cells[c.id] ?? ''
                if (c.type === 'area') return L(c.options?.find((o) => o.id === x)?.label) || x
                return c.type === 'trend' ? trendWord(x) : x
              }),
            }
            const newDay = breaks[i]
            return newDay ? [{ sep: localeDate(newDay, { weekday: 'short', day: '2-digit', month: '2-digit', year: 'numeric' }), cells: [] }, row] : [row]
          }),
        }
      }
      if (s.type === 'text') {
        return { ...base, layout: s.layout ?? (s.fields.length > 1 ? 'row' : 'stack'), fields: s.fields.map((f) => ({ label: L(f.label), tone: f.tone ?? '', value: v.fields?.[f.id] ?? '' })) }
      }
      if (s.type === 'live') return live?.(s, base) ?? base
      return base
    }),
  }
}
