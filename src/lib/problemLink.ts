import {
  dropLine, dropRow, ordered, putLine, putRow, withSection, writtenRows,
  type BoardFormData, type FormAnno, type FormLine, type FormRow, type FormTrend,
} from './boardForm'
import { problemColumns, shownSections, type QuadSection, type TableSection } from './boardTemplate'
import { isProblemTemplate, type ChecklistState, type ChecklistTemplate } from './checklists'

/**
 * The Einsatz's PROBLEMS, one list behind every surface that shows them (feedback round
 * 05.11.2026, owner pick 7A): the ticked items of a `problems` checklist (the Problemerfassung), the
 * lines of the Tafel's problem quad (Erste Führung › Problemerfassung: Front · Ordnung · Sanität ·
 * Spezialprobleme) and the rows of its problem table (the page «Problemerfassung», with a Bereich
 * column). A problem written on any of them stands on all of them.
 *
 * ⚠️ DERIVED, never copied: every problem has ONE home – the tick, the quad line or the table row
 * it was made as – and every other surface shows it in a VIEW (`problemView`) built from those
 * homes at draw time. So a tick made while no page is on the Tafel shows the moment the page is
 * added, an un-tick takes the line off every page, and two devices can never end with two copies
 * that disagree. An edit on a view is split back (`splitProblemEdit`): the problem's words, Tendenz
 * and Bereich go to its home (the checklist's Tendenz beside the tick, the other page's line or
 * row); what only THIS surface has for it (the table's Reaktion and Priorität, its place in the
 * order, a quad's Stichwort) is kept here, on a SATELLITE: a stored row or line under the problem's
 * view id (`ck~<template>~<item>`, `ln~<line>`, `rw~<row>`). Both kinds of write are form cells and
 * checklist keys, which already merge per cell (lib/boardFormMerge) and per item (mergeWorkspace ·
 * mergeChecklists).
 *
 * ⚠️ A problem typed on the Tafel is never matched to, nor written into, the checklist (owner): the
 * checklist's items are only ever its own. Deleting a checklist-born problem on the Tafel un-ticks
 * it; an un-tick (here or in the checklist) keeps the satellite and the Tendenz, so ↶ (or ticking
 * it again) brings back what was written beside it. A checklist problem's words are the checklist's: read-only on the Tafel,
 * like a pre-printed cell. Which sections take part is the template's (`problems: true`), which
 * checklist and which Bereich per phase the checklist's (`problems`, `phases[].area`) – nothing here
 * knows a station.
 */

/** What the Tafel needs of the Checklisten: the templates and the Einsatz's tick state. */
export interface ProblemSource { templates: readonly ChecklistTemplate[]; checklists: ChecklistState }

/** Where a problem lives. */
export type ProblemHome =
  | { kind: 'tick'; tpl: string; item: string }
  | { kind: 'line'; page: string; sec: string; box: string; id: string }
  | { kind: 'row'; page: string; sec: string; id: string }

export interface Problem {
  /** the id every OTHER surface shows it under */
  vid: string
  home: ProblemHome
  text: string
  trend?: FormTrend
  /** its Bereich: a quad box id */
  area?: string
  /** born in a checklist (the Tafel marks it, its words are read-only there) */
  checklist?: boolean
}

/** A checklist's or the Tafel's write the split hands back for the Checklisten slice. */
export type TickWrite = { tpl: string; item: string } & ({ untick: true } | { trend: FormTrend | null })

/** What one edit on a page's view writes: the page itself, other pages, ticks. */
export interface ProblemEdit {
  form: BoardFormData
  /** other pages whose stored form changed (a problem's home), by anno id */
  others: Map<string, BoardFormData>
  ticks: TickWrite[]
  /** the words of each checklist problem the edit un-ticked – what the toast names */
  unticked: string[]
}

const PREFIXES = ['ck~', 'ln~', 'rw~'] as const
/** an entry stored under a problem's view id: a satellite, never a problem of its own */
export const isLinkedId = (id: string) => PREFIXES.some((p) => id.startsWith(p))
/** the marker cell a table satellite carries: a row with no cell at all is no row to the merge
 *  (lib/boardFormMerge) – and a satellite may hold nothing but its place in the order */
const SAT = '@'

const TRENDS: readonly string[] = ['up', 'same', 'down']
const asTrend = (v: unknown): FormTrend | undefined => (typeof v === 'string' && TRENDS.includes(v) ? (v as FormTrend) : undefined)

type Surface =
  | { kind: 'quad'; sec: QuadSection }
  | { kind: 'table'; sec: TableSection; cols: { text: string; trend?: string; area?: string } }

/** The sections of a page that show the Einsatz's problems. */
function surfaces(d: BoardFormData): Surface[] {
  return shownSections(d.page).flatMap((s): Surface[] => {
    if (s.type === 'quad') return s.problems ? [{ kind: 'quad', sec: s }] : []
    if (s.type !== 'table') return []
    const cols = problemColumns(s)
    return cols ? [{ kind: 'table', sec: s, cols }] : []
  })
}

/** Does this page show the Einsatz's problems? */
export const hasProblems = (d: BoardFormData) => surfaces(d).length > 0

/**
 * Every problem of the Einsatz, in a fixed order: the ticked checklist items in the order they were
 * ticked, then the Tafel's own entries page by page, box by box, in their order. `pages`: the
 * Tafel's live pages (lib/boardForm · findForms).
 */
export function problemRegister(pages: readonly FormAnno[], source?: ProblemSource): Problem[] {
  const ticked: { at: string; p: Problem }[] = []
  const seen = new Set<string>()
  for (const t of source?.templates ?? []) {
    if (!isProblemTemplate(t)) continue
    const state = source?.checklists[t.id]
    const ticks = state?.ticks ?? {}
    for (const ph of t.phases ?? []) {
      for (const it of [...ph.items, ...(ph.branches ?? []).flatMap((b) => b.items)]) {
        const tk = ticks[it.id]
        const vid = `ck~${t.id}~${it.id}`
        if (!tk || seen.has(vid)) continue
        seen.add(vid)
        const trend = asTrend(state?.trends?.[it.id])
        ticked.push({
          at: typeof tk.t === 'string' ? tk.t : '',
          p: { vid, home: { kind: 'tick', tpl: t.id, item: it.id }, text: it.text, ...(trend ? { trend } : {}), ...(ph.area ? { area: ph.area } : {}), checklist: true },
        })
      }
    }
  }
  const out = ticked.sort((a, b) => a.at.localeCompare(b.at)).map((x) => x.p)
  for (const a of pages) {
    for (const sf of surfaces(a.form)) {
      const sec = sf.sec.id
      if (sf.kind === 'quad') {
        for (const c of sf.sec.cells) {
          for (const l of ordered(a.form.values[sec]?.lines?.[c.id] ?? [])) {
            if (isLinkedId(l.id) || !l.text.trim()) continue
            out.push({ vid: `ln~${l.id}`, home: { kind: 'line', page: a.id, sec, box: c.id, id: l.id }, text: l.text, ...(l.trend ? { trend: l.trend } : {}), area: c.id })
          }
        }
      } else {
        for (const r of writtenRows(a.form, sf.sec)) {
          if (isLinkedId(r.id)) continue
          const trend = sf.cols.trend ? asTrend(r.cells[sf.cols.trend]) : undefined
          const area = sf.cols.area ? r.cells[sf.cols.area] : undefined
          out.push({ vid: `rw~${r.id}`, home: { kind: 'row', page: a.id, sec, id: r.id }, text: r.cells[sf.cols.text] ?? '', ...(trend ? { trend } : {}), ...(area ? { area } : {}) })
        }
      }
    }
  }
  return out
}

/** whether `p` lives in this very section (then the section shows it as its own entry) */
const livesIn = (p: Problem, page: string, sec: string) => p.home.kind !== 'tick' && p.home.page === page && p.home.sec === sec

/**
 * The page `a` as it is DRAWN: each problem section with every problem of the Einsatz – its own
 * entries, and each problem from elsewhere under its view id, with this surface's satellite
 * folded in. Satellites without a problem (an un-ticked item) are left out. The same object when
 * the page shows no problems. Print it, draw it, edit it: never store it (`splitProblemEdit`).
 */
export function problemView(a: FormAnno, pages: readonly FormAnno[], source?: ProblemSource, register?: readonly Problem[]): BoardFormData {
  const sfs = surfaces(a.form)
  if (!sfs.length) return a.form
  const reg = register ?? problemRegister(pages, source)
  let d = a.form
  for (const sf of sfs) {
    const sec = sf.sec.id
    const foreign = reg.filter((p) => !livesIn(p, a.id, sec) && p.text.trim())
    const v = d.values[sec] ?? {}
    if (sf.kind === 'table') {
      const { text, trend, area } = sf.cols
      const rows = v.rows ?? []
      const sat = new Map(rows.filter((r) => isLinkedId(r.id)).map((r) => [r.id, r]))
      if (!foreign.length && !sat.size) continue
      const virt = foreign.map((p): FormRow => {
        const s = sat.get(p.vid)
        const cells: Record<string, string> = {}
        for (const [k, x] of Object.entries(s?.cells ?? {})) if (x && k !== SAT && k !== text && k !== trend && k !== area) cells[k] = x
        cells[text] = p.text
        if (trend && p.trend) cells[trend] = p.trend
        if (area && p.area) cells[area] = p.area
        return { id: p.vid, cells, ...(s?.ord ? { ord: s.ord } : {}), ...(s?.done ? { done: true } : {}), ...(p.checklist ? { src: 'checklist' as const } : {}) }
      })
      d = withSection(d, sec, { ...v, rows: [...rows.filter((r) => !isLinkedId(r.id)), ...virt] })
    } else {
      const stored = Object.values(v.lines ?? {}).flat()
      const sat = new Map(stored.filter((l) => isLinkedId(l.id)).map((l) => [l.id, l]))
      if (!foreign.length && !sat.size) continue
      const lines: Record<string, FormLine[]> = {}
      for (const [box, ls] of Object.entries(v.lines ?? {})) lines[box] = ls.filter((l) => !isLinkedId(l.id))
      for (const c of sf.sec.cells) {
        const virt = foreign.filter((p) => p.area === c.id).map((p): FormLine => {
          const s = sat.get(p.vid)
          return { id: p.vid, text: p.text, ...(p.trend ? { trend: p.trend } : {}), ...(s?.tag ? { tag: s.tag } : {}), ...(s?.ord ? { ord: s.ord } : {}), ...(p.checklist ? { src: 'checklist' as const } : {}) }
        })
        if (virt.length) lines[c.id] = [...(lines[c.id] ?? []), ...virt]
      }
      d = withSection(d, sec, { ...v, lines })
    }
  }
  return d
}

/** the words / Tendenz / Bereich an edit gave a problem from elsewhere (`null` = cleared) */
interface HomePatch { text?: string; trend?: FormTrend | null; area?: string }

/**
 * One edit on page `a`'s VIEW (`before` → `after`, both `problemView`s), split into what it writes:
 * the page as it is STORED (its own entries, and the satellites of the problems from elsewhere),
 * the other pages whose problems it changed, and the ticks it changed. A problem the edit took off
 * the page (deleted, or its words emptied) goes from its home, so from every surface.
 * `at`: the server-clock stamp of the cells it writes elsewhere (lib/boardForm · stamped).
 */
export function splitProblemEdit(a: FormAnno, before: BoardFormData, after: BoardFormData, pages: readonly FormAnno[], source?: ProblemSource, at?: number): ProblemEdit {
  const byVid = new Map(problemRegister(pages, source).map((p) => [p.vid, p]))
  const homes: { p: Problem; patch?: HomePatch; remove?: boolean }[] = []
  let form = after
  /** atoms of a view row that are its home's, not this page's: their stamps go too */
  const homeAtoms = new Set<string>()
  for (const sf of surfaces(a.form)) {
    const sec = sf.sec.id
    if (sf.kind === 'table') {
      const { text, trend, area } = sf.cols
      const bRows = new Map((before.values[sec]?.rows ?? []).map((r) => [r.id, r]))
      const aRows = after.values[sec]?.rows ?? []
      const aIds = new Set(aRows.map((r) => r.id))
      const val = (r: FormRow | undefined, col: string | undefined) => (col && r?.cells[col]) || ''
      const rows: FormRow[] = []
      for (const r of aRows) {
        if (!isLinkedId(r.id)) { rows.push(r); continue }
        const p = byVid.get(r.id)
        if (!p) continue
        const b = bRows.get(r.id)
        const patch: HomePatch = {}
        if (p.home.kind !== 'tick' && val(r, text) !== val(b, text)) patch.text = val(r, text)
        if (p.home.kind !== 'tick' && area && val(r, area) !== val(b, area)) patch.area = val(r, area)
        if (trend && val(r, trend) !== val(b, trend)) patch.trend = asTrend(val(r, trend)) ?? null
        if (Object.keys(patch).length) homes.push({ p, patch })
        for (const col of [text, trend, area]) if (col) homeAtoms.add(`r|${sec}|${r.id}|${col}`)
        const extras: Record<string, string> = {}
        for (const [k, x] of Object.entries(r.cells)) if (x && k !== SAT && k !== text && k !== trend && k !== area) extras[k] = x
        if (Object.keys(extras).length || r.ord || r.done) rows.push({ id: r.id, cells: { [SAT]: '1', ...extras }, ...(r.ord ? { ord: r.ord } : {}), ...(r.done ? { done: true } : {}) })
      }
      // a satellite whose problem is not shown (un-ticked in the checklist) stays – for ↶, and a re-tick
      for (const r of a.form.values[sec]?.rows ?? []) if (isLinkedId(r.id) && !bRows.has(r.id) && !aIds.has(r.id)) rows.push(r)
      for (const id of bRows.keys()) {
        const p = isLinkedId(id) && !aIds.has(id) ? byVid.get(id) : undefined
        if (p) homes.push({ p, remove: true })
      }
      form = withSection(form, sec, { ...after.values[sec], rows })
    } else {
      const bLines = new Map(Object.values(before.values[sec]?.lines ?? {}).flat().map((l) => [l.id, l]))
      const aBoxes = Object.entries(after.values[sec]?.lines ?? {})
      const aIds = new Set(aBoxes.flatMap(([, ls]) => ls.map((l) => l.id)))
      const lines: Record<string, FormLine[]> = {}
      for (const [box, ls] of aBoxes) {
        const kept: FormLine[] = []
        for (const l of ls) {
          if (!isLinkedId(l.id)) { kept.push(l); continue }
          const p = byVid.get(l.id)
          if (!p) continue
          const b = bLines.get(l.id)
          const patch: HomePatch = {}
          if (p.home.kind !== 'tick' && l.text !== (b?.text ?? '')) patch.text = l.text
          if ((l.trend ?? '') !== (b?.trend ?? '')) patch.trend = l.trend ?? null
          if (Object.keys(patch).length) homes.push({ p, patch })
          if (l.tag || l.ord) kept.push({ id: l.id, text: '', ...(l.tag ? { tag: l.tag } : {}), ...(l.ord ? { ord: l.ord } : {}) })
        }
        lines[box] = kept
      }
      for (const [box, ls] of Object.entries(a.form.values[sec]?.lines ?? {})) {
        for (const l of ls) if (isLinkedId(l.id) && !bLines.has(l.id) && !aIds.has(l.id)) lines[box] = [...(lines[box] ?? []), l]
      }
      for (const id of bLines.keys()) {
        const p = isLinkedId(id) && !aIds.has(id) ? byVid.get(id) : undefined
        if (p) homes.push({ p, remove: true })
      }
      form = withSection(form, sec, { ...after.values[sec], lines })
    }
  }
  if (form.t && homeAtoms.size) form = { ...form, t: Object.fromEntries(Object.entries(form.t).filter(([k]) => !homeAtoms.has(k))) }

  // …and each problem's home
  const others = new Map<string, BoardFormData>()
  const formOf = (id: string) => (id === a.id ? form : others.get(id) ?? pages.find((p) => p.id === id)?.form)
  const put = (id: string, f: BoardFormData) => { if (id === a.id) form = f; else others.set(id, f) }
  const ticks: TickWrite[] = []
  const unticked: string[] = []
  for (const { p, patch = {}, remove } of homes) {
    const home = p.home
    if (home.kind === 'tick') {
      if (remove) { ticks.push({ tpl: home.tpl, item: home.item, untick: true }); unticked.push(p.text) }
      else if (patch.trend !== undefined) ticks.push({ tpl: home.tpl, item: home.item, trend: patch.trend })
      continue
    }
    const f = formOf(home.page)
    if (!f) continue
    if (home.kind === 'row') {
      const table = f.page.sections.find((s): s is TableSection => s.id === home.sec && s.type === 'table')
      const cols = table && problemColumns(table)
      if (!cols) continue
      if (remove) { put(home.page, dropRow(f, home.sec, home.id, at)); continue }
      const cells: Record<string, string> = {}
      if (patch.text !== undefined) cells[cols.text] = patch.text
      if (patch.trend !== undefined && cols.trend) cells[cols.trend] = patch.trend ?? ''
      if (patch.area !== undefined && cols.area) cells[cols.area] = patch.area
      put(home.page, putRow(f, home.sec, home.id, { cells }, at))
      continue
    }
    if (remove) { put(home.page, dropLine(f, home.sec, home.box, home.id, at)); continue }
    const quad = f.page.sections.find((s): s is QuadSection => s.id === home.sec && s.type === 'quad')
    const line = f.values[home.sec]?.lines?.[home.box]?.find((l) => l.id === home.id)
    if (!quad || !line) continue
    const text = patch.text ?? line.text
    const trend = patch.trend !== undefined ? patch.trend ?? undefined : line.trend
    // a new Bereich moves the line into that box (a box this quad does not have: it stays)
    const box = patch.area && quad.cells.some((c) => c.id === patch.area) ? patch.area : home.box
    const g = box !== home.box ? dropLine(f, home.sec, home.box, home.id, at) : f
    put(home.page, putLine(g, home.sec, box, home.id, { text, trend, tag: line.tag }, at))
  }
  return { form, others, ticks, unticked }
}
