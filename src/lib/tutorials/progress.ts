// Per-DEVICE tutorial progress («Üben», 05.11.2026). A tiny preference, not operational state,
// so localStorage is the right home – like kp.demo.welcomed. Per device on purpose: tablets and
// kiosk logins are shared, an account is not a person; a ✓ means «done on this device».
//
// Shape: { [tutorialId]: { doneAt?: ISO string; step?: number; lern?: id; paused?: true } } –
// `step` is where an interrupted run stands (the sheet offers «Fortsetzen»), `doneAt` the last
// completion, `lern` the Lern-Übung the run was bound to, `paused` the pill's ✕ (08.11.2026).
// The last two let a Lern-Übung opened again – a new tab, the PWA relaunched – pick its run up
// (`resumeFor`); the session itself lives per tab (./session) and is gone by then.

import { tutorialsCopy } from '../../config/copy/de/tutorials'
import { TUTORIALS, type TutorialId } from './catalogue'

const KEY = 'kp.tutorials'

export interface TutorialProgress {
  doneAt?: string
  step?: number
  /** the Lern-Übung the interrupted run is bound to */
  lern?: string
  /** stopped with the pill's ✕: reopening the Übung does not start it again by itself */
  paused?: boolean
}
export type ProgressMap = Partial<Record<TutorialId, TutorialProgress>>

/** fired on `window` after every write – the sheet and the pill re-read */
export const PROGRESS_EVENT = 'kp:tutorial-progress'

export function loadProgress(): ProgressMap {
  try {
    const raw = localStorage.getItem(KEY)
    const v: unknown = raw ? JSON.parse(raw) : {}
    return v && typeof v === 'object' ? (v as ProgressMap) : {}
  } catch { return {} }
}

function save(map: ProgressMap): void {
  try { localStorage.setItem(KEY, JSON.stringify(map)) } catch { /* private mode: progress lives for the tab */ }
  window.dispatchEvent(new Event(PROGRESS_EVENT))
}

/** remember where a run stands (0-based step) – and, once known, the Lern-Übung it runs on. A
 *  run that moves is not paused; only the pill's ✕ passes `paused`. */
export function markStep(id: TutorialId, step: number, opts: { lern?: string; paused?: boolean } = {}): void {
  const map = loadProgress()
  const { paused: _was, ...prev } = map[id] ?? {}
  map[id] = { ...prev, step, ...(opts.lern ? { lern: opts.lern } : {}), ...(opts.paused ? { paused: true } : {}) }
  save(map)
}

/** a completed run: the ✓ on the row; the resume point is cleared */
export function markDone(id: TutorialId, now = new Date()): void {
  const map = loadProgress()
  map[id] = { doneAt: now.toISOString() }
  save(map)
}

/** «Beenden» without finishing: keep the ✓ of an earlier run, drop the resume point */
export function clearStep(id: TutorialId): void {
  const map = loadProgress()
  if (!map[id]) return
  const { step: _step, paused: _paused, lern: _lern, ...rest } = map[id]
  map[id] = rest
  save(map)
}

export const isDone = (map: ProgressMap, id: TutorialId): boolean => !!map[id]?.doneAt
export const resumeStep = (map: ProgressMap, id: TutorialId): number | undefined => map[id]?.step

/** what an opened Einsatz needs to know to pick a run up: its id, its title, and whether the
 *  «Üben» door made it (IncidentMeta's fields) */
export interface LernCandidate { id: string; title: string; source?: string | null; exercise_since_creation?: boolean }

const LERN_PREFIX = 'Lernen · '
/** a Lern-Übung's tutorial from its title – the record's German one (tutorial_seed · lern_title) */
function tutorialOfTitle(title: string): TutorialId | null {
  if (!title.startsWith(LERN_PREFIX)) return null
  const rest = title.slice(LERN_PREFIX.length)
  return TUTORIALS.find((t) => tutorialsCopy.tutorials.titles[t.id] === rest)?.id ?? null
}

/**
 * The run to pick up when `inc` opens without one (08.11.2026, owner: a Lern-Übung you come back
 * to resumes its tutorial). This device's own run bound to it wins, on its step – unless it was
 * paused. Otherwise a Lern-Übung (made by the door) this device has no say about – another
 * device, a cleared browser – starts its tutorial from the top. A tutorial this device ended,
 * finished or paused is never started unasked; «Fortsetzen» under «Üben» still is.
 */
export function resumeFor(map: ProgressMap, inc: LernCandidate): { id: TutorialId; step: number } | null {
  for (const t of TUTORIALS) {
    const p = map[t.id]
    if (p?.lern === inc.id) return p.step != null && !p.paused ? { id: t.id, step: p.step } : null
  }
  if (inc.source !== 'training' || !inc.exercise_since_creation) return null
  const id = tutorialOfTitle(inc.title)
  if (!id) return null
  return map[id] ? null : { id, step: 0 }
}
