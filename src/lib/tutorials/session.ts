// The running tutorial, app-wide («Üben», 05.11.2026): ONE at a time, started from the «Üben»
// sheet or a Hilfe section's «Ausprobieren», read by the runner (useTutorial) that mounts in the
// IncidentWorkspace (Round 2: also the Karte home). A module-level store rather than context,
// because the sheet that starts a tutorial and the surface that runs it are mounted in different
// trees (App's landing sheets vs. the covered IncidentWorkspace).
//
// What starting means is the runner's: the Lern-Übung first where the catalogue says so
// (lib/tutorials/sandbox), then the step's surface, then step 0 or the resume point. The session
// is mirrored into sessionStorage, so a reload in the middle of a step comes back on that step
// (per TAB: another tab of the same browser never inherits a run).

import { useSyncExternalStore } from 'react'
import type { TutorialId } from './catalogue'

export interface TutorialSession {
  id: TutorialId
  /** 0-based current step */
  step: number
  /** the «Lernen · <Modul>» Übung this run uses, when it has one (sandbox.openLernUebung) */
  incidentId?: string
  /** the Einsatz the run is bound to – the Lern-Übung, or (no sandbox: demo, a refused door) the
   *  Übung it was started on. Set by the runner on its first mount; a DIFFERENT Einsatz opening
   *  ends the run silently (progress keeps the step). */
  host?: string
  /** steps passed with «Überspringen» – the done card does not tick them */
  skipped?: readonly number[]
  /** epoch ms the run began, for the done card's «5:40 Min.» */
  startedAt?: number
  /** epoch ms the last step was done (or «Beenden»), for the same read-out */
  endedAt?: number
  /** «Beenden» before the last step: the end card says «Beendet» and ticks nothing it did not see */
  endedEarly?: boolean
}

const KEY = 'kp.tutorial.session'

function restore(): TutorialSession | null {
  try {
    const raw = sessionStorage.getItem(KEY)
    const v: unknown = raw ? JSON.parse(raw) : null
    return v && typeof v === 'object' && typeof (v as TutorialSession).id === 'string' && typeof (v as TutorialSession).step === 'number'
      ? (v as TutorialSession) : null
  } catch { return null }
}

let current: TutorialSession | null = typeof sessionStorage === 'undefined' ? null : restore()
const listeners = new Set<() => void>()

function put(next: TutorialSession | null): void {
  current = next
  try {
    if (next) sessionStorage.setItem(KEY, JSON.stringify(next))
    else sessionStorage.removeItem(KEY)
  } catch { /* private mode: the run lives for the page */ }
  listeners.forEach((l) => l())
}

/** start (or resume) a tutorial – the runner takes it from here */
export function startTutorial(id: TutorialId, opts: { step?: number; incidentId?: string } = {}): void {
  put({ id, step: opts.step ?? 0, incidentId: opts.incidentId, startedAt: Date.now() })
}

export function setTutorialSession(next: TutorialSession | null): void {
  put(next)
}

export const getTutorialSession = (): TutorialSession | null => current

export function subscribeTutorial(listener: () => void): () => void {
  listeners.add(listener)
  return () => { listeners.delete(listener) }
}

/** the running tutorial, or null */
export function useTutorialSession(): TutorialSession | null {
  return useSyncExternalStore(subscribeTutorial, getTutorialSession, () => null)
}

/** What only the App shell can do for a run: open another Einsatz (the Lern-Übung the door
 *  returned) and leave the one in front (after the done card deleted it). App registers it once;
 *  without it (a test, a shell that never registered) the runner stays on the open Einsatz. */
export interface TutorialHost {
  open: (incidentId: string) => void
  leave: () => void
}

let host: TutorialHost | null = null
export function setTutorialHost(next: TutorialHost | null): void { host = next }
export const getTutorialHost = (): TutorialHost | null => host
