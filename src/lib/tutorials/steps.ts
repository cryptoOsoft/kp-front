// The steps of each tutorial and how the app knows one is done («Üben», 05.11.2026). One `Step`
// per goal: the surface it happens on, the controls the Sprechblase may point at, and a
// predicate over the workspace (./snapshot) – or 'manual' where nothing observable happens
// (the step then offers «Weiter»). The words live in appConfig.copy.tutorialRun.steps, keyed by
// tutorial and step id; the types below make tsc refuse a step without its copy.
//
// Predicates accept the BROAD reading (plan §8): «a Leitung from the TLF to the Hydrant» is
// asked for in the copy, «any new line» is what passes – a learner who drew it slightly wrong
// has still learned the tool. Each compares against the snapshot from the moment the step began,
// so the seeded scene (two symbols, one Leitung) never counts as the learner's.
//
// Round 1 ships T2 «lageZeichnen» only; Round 2 adds the rest, one tutorial per builder.

import type { Copy } from '../../config/copy'
import { appConfig } from '../../config/appConfig'
import type { WorkspaceMode } from '../../workspace/types'
import type { TutAnchor } from './anchors'
import type { TutorialId } from './catalogue'
import { eventsSince, movedEntities, newDrawings, newEntities, type Snapshot } from './snapshot'

type StepsCopy = Copy['tutorialRun']['steps']

export interface Step<Id extends string = string> {
  id: Id
  /** where it happens; standing elsewhere, the bubble points at that surface's rail tile */
  surface?: WorkspaceMode
  /** the controls to point at, first one on screen wins – so ONE list serves the tablet's rail
   *  and the phone's two pointers (O1: «Hinzufügen», then «Linie» in its sheet). A function when
   *  the pointer moves within the step (↶, then ↷). None = the bubble hangs under the pill. */
  anchor?: readonly TutAnchor[] | ((now: Snapshot, start: Snapshot) => readonly TutAnchor[])
  /** done once true for the current snapshot against the one the step began with */
  done: ((now: Snapshot, start: Snapshot) => boolean) | 'manual'
}

const placed = (kind: 'symbol' | 'vehicle' | 'note') => (e: { kind: string }) => e.kind === kind
/** a TLF from the palette is a symbol; one from the station's fleet list a vehicle */
const isVehicleish = (e: { kind: string }) => placed('symbol')(e) || placed('vehicle')(e)

/** the phone keeps the draw tools in the «+» sheet: point at the entry while it is open, at the
 *  rail tool on a tablet, and at «+ Hinzufügen» otherwise */
const drawTool = (t: 'line' | 'circle' | 'note'): readonly TutAnchor[] => [`add.${t}`, `tool.${t}`, 'tool.add']

/** every tutorial with steps, its ids checked against the copy */
type StepTable = { [T in keyof StepsCopy]: readonly Step<Extract<keyof StepsCopy[T], string>>[] }

const STEPS: StepTable = {
  // T2 «Karte – die Lage zeichnen»: the mock's seven (owner pick K = B, 05.11.2026)
  lageZeichnen: [
    { id: 'place', surface: 'map', anchor: ['add.search', 'tool.add'],
      done: (now, start) => newEntities(now, start).some(isVehicleish) },
    { id: 'move', surface: 'map', anchor: ['tool.select'],
      done: (now, start) => movedEntities(now, start).some(isVehicleish) },
    { id: 'line', surface: 'map', anchor: drawTool('line'),
      done: (now, start) => newDrawings(now, start).some((d) => d.kind === 'line') },
    { id: 'circle', surface: 'map', anchor: drawTool('circle'),
      done: (now, start) => newDrawings(now, start).some((d) => d.kind === 'circle') },
    { id: 'note', surface: 'map', anchor: drawTool('note'),
      done: (now, start) => newEntities(now, start).some(placed('note')) },
    // ↶ first, then ↷ – the pointer follows once the ↶ was seen
    { id: 'undoRedo', surface: 'map',
      anchor: (now, start) => (eventsSince(now, start).includes('undo') ? ['top.redo'] : ['top.undo']),
      done: (now, start) => {
        const ev = eventsSince(now, start)
        const u = ev.indexOf('undo')
        return u >= 0 && ev.lastIndexOf('redo') > u
      } },
    // W: the colour scheme is a device pref, and a learner already at night has nothing to switch
    { id: 'theme', anchor: ['menu.einsatz'], done: 'manual' },
  ],
}

/** the steps of a tutorial; empty for one that has none yet (Round 2) */
export function stepsOf(id: TutorialId): readonly Step[] {
  return (STEPS as Partial<Record<TutorialId, readonly Step[]>>)[id] ?? []
}

/** a tutorial the runner can run (it has steps) */
export const runnable = (id: TutorialId): boolean => stepsOf(id).length > 0

/** is the step done, given now and the snapshot it began with? A manual step never is by itself. */
export const stepDone = (step: Step, now: Snapshot, start: Snapshot): boolean =>
  step.done !== 'manual' && step.done(now, start)

/** the anchors the step points at right now, in preference order */
export function stepAnchors(step: Step, now: Snapshot, start: Snapshot): readonly TutAnchor[] {
  if (step.surface && now.ui.mode !== step.surface) return [`rail.${step.surface}`]
  return typeof step.anchor === 'function' ? step.anchor(now, start) : (step.anchor ?? [])
}

/** a step's words (appConfig.copy.tutorialRun.steps) – read late, so the locale is the live one */
export interface StepWords { title: string; instruction: string; hint: string; hintPhone?: string; done: string }
export function stepWords(id: TutorialId, stepId: string): StepWords {
  const all: Partial<Record<TutorialId, Record<string, StepWords>>> = appConfig.copy.tutorialRun.steps
  return all[id]?.[stepId] ?? { title: stepId, instruction: stepId, hint: '', done: stepId }
}
