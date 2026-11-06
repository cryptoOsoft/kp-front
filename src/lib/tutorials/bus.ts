// The tutorial bus («Üben», 05.11.2026): the acts that leave no state for a step to read – a ↶
// that put a symbol back looks exactly like the state before the symbol was placed. The place
// where such an act happens says so in one line (`tutorialEvent('undo')`), and the runner's
// snapshot carries the recent ones. Checks stay state predicates; this is the state of «what
// was just done», nothing more. Cheap when no tutorial runs: a push onto a short ring.

export type TutorialEventName = 'undo' | 'redo'

export interface TutorialEvent {
  name: TutorialEventName
  /** strictly increasing – a step compares against the last seq it saw when it began */
  seq: number
}

const KEEP = 20
let seq = 0
let recent: readonly TutorialEvent[] = []
const listeners = new Set<() => void>()

/** say that an act happened (IncidentWorkspace · stepHistory for ↶ ↷) */
export function tutorialEvent(name: TutorialEventName): void {
  recent = [...recent.slice(-(KEEP - 1)), { name, seq: ++seq }]
  listeners.forEach((l) => l())
}

/** the last few events, oldest first; a new array after every event, stable in between */
export const recentTutorialEvents = (): readonly TutorialEvent[] => recent

export function subscribeTutorialEvents(fn: () => void): () => void {
  listeners.add(fn)
  return () => { listeners.delete(fn) }
}
