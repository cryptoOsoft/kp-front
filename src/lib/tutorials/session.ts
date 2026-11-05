// The running tutorial, app-wide («Üben», 05.11.2026): ONE at a time, started from the «Üben»
// sheet or a Hilfe section's «Ausprobieren», read by the runner (useTutorial) that mounts in the
// IncidentWorkspace and the Karte home. A module-level store rather than context, because the
// sheet that starts a tutorial and the surface that runs it are mounted in different trees
// (App's landing sheets vs. the covered IncidentWorkspace).
//
// Round-1 skeleton (lead, 05.11.2026): the signatures the «Üben» sheet (ENTRY) builds against;
// the runner builder (CORE) fills in what starting means – sandbox first where the catalogue says
// so, then the surface, then step 0 or the resume point.

import { useSyncExternalStore } from 'react'
import type { TutorialId } from './catalogue'

export interface TutorialSession {
  id: TutorialId
  /** 0-based current step */
  step: number
  /** the «Lernen · <Modul>» Übung this run uses, when it has one */
  incidentId?: string
}

let current: TutorialSession | null = null
const listeners = new Set<() => void>()
const emit = () => listeners.forEach((l) => l())

/** start (or resume) a tutorial – the runner takes it from here */
export function startTutorial(id: TutorialId, opts: { step?: number; incidentId?: string } = {}): void {
  current = { id, step: opts.step ?? 0, incidentId: opts.incidentId }
  emit()
}

export function setTutorialSession(next: TutorialSession | null): void {
  current = next
  emit()
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
