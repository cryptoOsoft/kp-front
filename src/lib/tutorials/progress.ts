// Per-DEVICE tutorial progress («Üben», 05.11.2026). A tiny preference, not operational state,
// so localStorage is the right home – like kp.demo.welcomed. Per device on purpose: tablets and
// kiosk logins are shared, an account is not a person; a ✓ means «done on this device».
//
// Shape: { [tutorialId]: { doneAt?: ISO string; step?: number } } – `step` is where an
// interrupted run stands (the sheet offers «Fortsetzen»), `doneAt` the last completion.

import type { TutorialId } from './catalogue'

const KEY = 'kp.tutorials'

export interface TutorialProgress { doneAt?: string; step?: number }
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

/** remember where an interrupted run stands (0-based step) */
export function markStep(id: TutorialId, step: number): void {
  const map = loadProgress()
  map[id] = { ...map[id], step }
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
  const { step: _step, ...rest } = map[id]
  map[id] = rest
  save(map)
}

export const isDone = (map: ProgressMap, id: TutorialId): boolean => !!map[id]?.doneAt
export const resumeStep = (map: ProgressMap, id: TutorialId): number | undefined => map[id]?.step
