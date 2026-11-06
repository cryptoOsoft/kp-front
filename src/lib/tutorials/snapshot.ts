// What a tutorial step can see («Üben», 05.11.2026): the workspace as the predicates read it –
// the Lage, the Trupps, the Verlauf, the Anwesenheit, the incident – plus a small UI slice and
// the bus's recent acts. Checks are state predicates, never DOM sniffing (plan §3): a step is
// done when this says so. The runner (useTutorial) builds one per change, memoised, and keeps
// the one from the moment the step began, so a predicate reads «what is NEW since then» and the
// seeded scene never counts as the learner's work.

import type { Drawing, Entity, Trupp } from '../../types'
import type { WorkspaceMode } from '../../workspace/types'
import type { TutorialEvent, TutorialEventName } from './bus'

export interface Snapshot {
  incident: { id: string; isExercise: boolean }
  /** the Lage as stored – no live vehicles or crew positions, which nobody placed */
  entities: readonly Entity[]
  drawings: readonly Drawing[]
  trupps: readonly Trupp[]
  /** Verlauf rows on this device */
  journalRows: number
  /** people marked present */
  present: number
  ui: {
    mode: WorkspaceMode
    /** the armed tool ('select' when none) */
    tool: string
    /** the «+ Hinzufügen» / Symbol sheet is open */
    palette: boolean
    phone: boolean
    night: boolean
  }
  events: readonly TutorialEvent[]
}

/** the newest bus seq a snapshot has seen (0 = none) */
const lastSeq = (s: Snapshot): number => s.events[s.events.length - 1]?.seq ?? 0

/** the bus events that came after `start` was taken, oldest first */
export const eventsSince = (now: Snapshot, start: Snapshot): TutorialEventName[] =>
  now.events.filter((e) => e.seq > lastSeq(start)).map((e) => e.name)

/** the entities that were not there when `start` was taken */
export function newEntities(now: Snapshot, start: Snapshot): Entity[] {
  const before = new Set(start.entities.map((e) => e.id))
  return now.entities.filter((e) => !before.has(e.id))
}

/** the drawings that were not there when `start` was taken */
export function newDrawings(now: Snapshot, start: Snapshot): Drawing[] {
  const before = new Set(start.drawings.map((d) => d.id))
  return now.drawings.filter((d) => !before.has(d.id))
}

/** the entities that were there at `start` and stand somewhere else now */
export function movedEntities(now: Snapshot, start: Snapshot): Entity[] {
  const at = new Map(start.entities.map((e) => [e.id, e.coord]))
  return now.entities.filter((e) => {
    const was = at.get(e.id)
    return !!was && (was[0] !== e.coord[0] || was[1] !== e.coord[1])
  })
}
