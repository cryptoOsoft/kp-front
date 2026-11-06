import { useRef, type Dispatch, type SetStateAction } from 'react'
import type { ChecklistState, ChecklistTemplate, Item } from './checklists'
import type { FormTrend } from './boardForm'
import type { TickWrite } from './problemLink'
import type { TimelineEvent } from '../types'
import { appConfig } from '../config/appConfig'
import { fillTemplate } from './format'

interface ChecklistActionsDeps {
  /** editor + not replay/EL-view — viewers can't tick. */
  canTick: boolean
  checklists: ChecklistState
  setChecklists: Dispatch<SetStateAction<ChecklistState>>
  /** who ticked (user?.display_name), stamped on the Tick. */
  authorName: string | undefined
  log: (icon: string, text: string, kind?: TimelineEvent['kind']) => void
  emit: (op_type: string, payload?: Record<string, unknown>) => void
}

/** A Verlauf row a milestone's tick state writes. */
export interface MilestoneRow { icon: string; text: string }

const key = (templateId: string, itemId: string) => `${templateId}\u0000${itemId}`

/** The row for a milestone that became ticked (☑) or un-ticked (the correction). */
export function milestoneRow(text: string, checked: boolean): MilestoneRow {
  return checked
    ? { icon: 'check', text: `☑ ${text}` }
    // ⚠️ A CORRECTION, appended — the ☑ row it answers stays where it stands (the Verlauf is
    // append-only). Verb first, like «Pendenz erledigt: …»: on paper and at 3am «☐ …» next to
    // «☑ …» is a difference of one glyph nobody catches. The ↶ glyph is the taking-back; the
    // Bereich still reads «Checkliste» (report · journalArea knows the template).
    : { icon: 'undo', text: fillTemplate(appConfig.copy.checklists.milestoneUndone, { text }) }
}

/**
 * The rows one step over the Checklisten slice writes: ☑ for each milestone that became ticked,
 * the correction for each one that became un-ticked — whichever door the step came through (a
 * tap, ↶, ↷). Pure. `milestones` maps a (template, item) key to the milestone's text; an item
 * not in it is silent, as a non-milestone tick always was.
 */
export function milestoneRows(from: ChecklistState, to: ChecklistState, milestones: ReadonlyMap<string, string>): MilestoneRow[] {
  const rows: MilestoneRow[] = []
  const templates = new Set([...Object.keys(from), ...Object.keys(to)])
  for (const t of templates) {
    const a = from[t]?.ticks ?? {}
    const b = to[t]?.ticks ?? {}
    for (const item of new Set([...Object.keys(a), ...Object.keys(b)])) {
      const was = !!a[item]
      const is = !!b[item]
      const text = milestones.get(key(t, item))
      if (was !== is && text !== undefined) rows.push(milestoneRow(text, is))
    }
  }
  return rows
}

/**
 * Checklist tick + branch mutations, lifted out of the IncidentWorkspace god-component. Ticks
 * are per-incident synced state; milestone ticks also surface in the Verlauf and every tick emits
 * an audit event for the time-travel replay. (The item `action` deep-link — journal/plan/draw
 * navigation — stays inline in App next to the nav setters it drives.)
 *
 * Un-ticking a milestone appends its correction row (23.09.2026, option B of the UX review), and
 * so does taking a tick back with ↶ — `describeStep` is what the undo timeline's checklist entry
 * asks, so a step writes the SAME row a tap would have, exactly one per changed milestone, and
 * never the generic «Checkliste rückgängig gemacht» beside it. ↷ writes ☑ again, as a re-tick does.
 */
export function useChecklistActions({ canTick, checklists, setChecklists, authorName, log, emit }: ChecklistActionsDeps) {
  // every milestone ticked or un-ticked in this session, by (template, item). A step on the undo
  // timeline can only be about one of these: the timeline is per session and dropped whole by a
  // remote hydrate, so the template is never needed again to name what a step changed.
  const milestones = useRef(new Map<string, string>())
  const toggleTick = (template: ChecklistTemplate, item: Item) => {
    if (!canTick) return
    setChecklists((cl) => {
      const prev = cl[template.id] ?? { ticks: {}, activeBranch: {} }
      const ticks = { ...prev.ticks }
      const wasChecked = !!ticks[item.id]
      if (wasChecked) delete ticks[item.id]
      else ticks[item.id] = { t: new Date().toISOString(), by: authorName }
      return { ...cl, [template.id]: { ...prev, ticks } }
    })
    const checking = !checklists[template.id]?.ticks[item.id]
    // Milestone ticks surface in the Verlauf (kept clean — non-milestones stay silent), and so
    // does taking one back; every tick still emits an audit event for the time-travel replay.
    if (item.milestone) {
      milestones.current.set(key(template.id, item.id), item.text)
      const row = milestoneRow(item.text, checking)
      log(row.icon, row.text, 'journal')
    }
    emit('checklist.tick', { template: template.id, item: item.id, checked: checking, milestone: !!item.milestone })
  }
  /** A problem's Tendenz on a `problems` checklist (the ➚ = ➘ beside a ticked item). `undefined`
   *  clears it. Silent in the Verlauf, like every non-milestone tick (docs/verlauf-coverage.md). */
  const setTrend = (template: ChecklistTemplate, item: Item, trend: FormTrend | undefined) => {
    if (!canTick || !checklists[template.id]?.ticks[item.id]) return
    applyTickWrites([{ tpl: template.id, item: item.id, trend: trend ?? null }])
  }
  /**
   * The Tafel's writes into the ticks (lib/problemLink · splitProblemEdit): a problem's Tendenz set
   * on a page, a checklist problem deleted there (un-ticked). ONE slice write, so the act joins the
   * undo timeline as one step – grouped with the page write by the caller. Only ever an existing
   * tick: a problem typed on the Tafel never becomes one. A Tendenz lives beside the ticks
   * (`TemplateState.trends`), so an un-tick – here or by a tap – leaves it for the re-tick.
   */
  const applyTickWrites = (writes: readonly TickWrite[]) => {
    if (!canTick || !writes.length) return
    setChecklists((cl) => {
      let out = cl
      for (const w of writes) {
        const prev = out[w.tpl]
        if (!prev?.ticks[w.item]) continue
        if ('untick' in w) {
          const { [w.item]: _gone, ...ticks } = prev.ticks
          out = { ...out, [w.tpl]: { ...prev, ticks } }
          continue
        }
        const { [w.item]: _old, ...trends } = prev.trends ?? {}
        out = { ...out, [w.tpl]: { ...prev, trends: w.trend ? { ...trends, [w.item]: w.trend } : trends } }
      }
      return out
    })
    for (const w of writes) {
      if ('untick' in w) emit('checklist.tick', { template: w.tpl, item: w.item, checked: false, milestone: false, from: 'tafel' })
      else emit('checklist.trend', { template: w.tpl, item: w.item, trend: w.trend })
    }
  }
  const setBranch = (templateId: string, phaseId: string, branchId: string) => {
    if (!canTick) return
    setChecklists((cl) => {
      const prev = cl[templateId] ?? { ticks: {}, activeBranch: {} }
      return { ...cl, [templateId]: { ...prev, activeBranch: { ...prev.activeBranch, [phaseId]: branchId } } }
    })
    emit('checklist.branch', { template: templateId, phase: phaseId, branch: branchId })
  }
  /** An undo-timeline step over the slice moved it `from` → `to`: write its milestone rows.
   *  `true` = it wrote them, and the step needs no generic row of its own. */
  const describeStep = (moved: { from: ChecklistState; to: ChecklistState }): boolean => {
    const rows = milestoneRows(moved.from, moved.to, milestones.current)
    for (const r of rows) log(r.icon, r.text, 'journal')
    return rows.length > 0
  }
  return { toggleTick, setTrend, applyTickWrites, setBranch, describeStep }
}
