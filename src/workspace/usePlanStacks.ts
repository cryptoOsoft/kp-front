// The Plan's undo, per document: each plan sheet keeps its own stack of whole-sheet snapshots, and
// every step on one is ALSO an entry on the Einsatz's one timeline (docs/undo.md), so the header's
// ↶ reaches a plan the operator has since left. One plan gesture is one step on whichever stack
// owns what it touched (lib/planStepLink): opened by `rememberPlanStep`, captioned by
// `onPlanStepLabel`, closed by `endPlanStep`. Also the handles the Whiteboard reports up — its open
// history, view memory, fit and keys — for the top bar and the keyboard layer. Split out of
// IncidentWorkspace (A.3, 25.10.2026) verbatim; the stacks live here and not in the Whiteboard,
// which is mounted only while the Plan is on screen.

import { useRef, useState, type RefObject } from 'react'
import { planStackTouches, type BoardHistory } from '../components/useBoardDoc'
import type { BoardViews } from '../components/useBoardView'
import { appConfig } from '../config/appConfig'
import { fillTemplate } from '../lib/format'
import { createPlanStepLink, type PlanStepLink } from '../lib/planStepLink'
import type { UndoTimeline } from '../lib/undoTimeline'
import type { SetBoard } from '../lib/useObjectStore'
import type { BoardDoc, TimelineEvent } from '../types'
import type { ToolCmd } from '../lib/hotkeys'

export interface PlanStacksDeps {
  undoHist: UndoTimeline
  /** the workspace's delegating step: the Verlauf row only if the stack actually moved */
  histStep: (moved: boolean, dir: 'undo' | 'redo', label: string, op: string, icon?: string, kind?: TimelineEvent['kind']) => boolean
  beginSheetStep: () => void
  endSheetStep: () => void
  setBoard: SetBoard
  /** the live board, active plan and plan titles — a step is pressed long after it was recorded */
  boardRef: RefObject<BoardDoc>
  activePlanIdRef: RefObject<string>
  planLabelRef: RefObject<(id: string) => string>
  /** the one-shot caption for the next PLAN step, and the store step's — a plan act names both */
  planStepLabelRef: RefObject<string | null>
  stepLabelRef: RefObject<string | null>
  /** ONE gesture on a plan is ONE undo step, whichever stack takes it (lib/planStepLink) */
  planStepLinkRef: RefObject<PlanStepLink | null>
}

export function usePlanStacks({
  undoHist, histStep, beginSheetStep, endSheetStep, setBoard, boardRef, activePlanIdRef, planLabelRef,
  planStepLabelRef, stepLabelRef, planStepLinkRef,
}: PlanStacksDeps) {
  // the Plan keeps its own per-document history (inside Whiteboard); it reports its
  // step fns up here so the GLOBAL TopBar undo/redo drives whichever
  // surface is showing — one control, both surfaces, no rail-level duplication.
  const planHist = useRef<{ undo: (expect?: string) => boolean; redo: (expect?: string) => boolean } | null>(null)
  // ⚠️ …and the STACKS live here rather than inside the Whiteboard, because the Whiteboard is
  // mounted only while `mode === 'plans'`: as component state the plan's history was thrown away
  // every time somebody glanced at the Verlauf or the Karte and came back — «nichts, was sich
  // nicht rückgängig machen lässt» broken by a tab switch. Keyed by plan id (see BoardHistory),
  // so surviving the unmount never leaks one plan's undo into another plan's.
  // ⚠️ They snapshot ONE plan's ANNOS, not the tactical store — deliberately, now that the board
  // is a view of it (lib/useObjectStore). A plan step is a statement about one sheet, and
  // restoring it through `setBoard` is exactly that statement: `applyBoardToObjects` folds the
  // restored list back and re-bakes those objects, leaving every other sheet and the whole Karte
  // where they stand. Snapshotting the store here would make a plan's ↶ reach across surfaces,
  // which is the opposite of what these per-document stacks exist for.
  const [planHistory, setPlanHistory] = useState<BoardHistory>({})
  // ⚠️ Live copies for the timeline's entries. An entry is pushed in one render and pressed in
  // another, and both of these move constantly — a plan's step read off the render that recorded
  // it would restore an annotation array from before everything that happened since.
  const planHistoryRef = useRef(planHistory); planHistoryRef.current = planHistory
  /**
   * Record that ONE plan document moved, on the global timeline.
   *
   * ⚠️ Scoped by plan id, and stepped by plan id — never through `planHist` (which points at
   * whichever plan is OPEN). The header's ↶ is chronological now, so the last thing that happened
   * may well be on a plan the operator has since navigated away from; delegating to the open
   * plan's history would then quietly undo a step on the wrong document. Where the plan IS open
   * we still go through `planHist`, because that path also clears the board's selection and
   * writes the Verlauf row the Whiteboard has always written.
   */
  // `step` = the plan step the timeline entry stands for: a stack whose top is another is not
  // stepped (the entry is then «lost», never applied to the wrong snapshot)
  const planStepAt = (planId: string, dir: 'undo' | 'redo', step: string): boolean => {
    if (planId === activePlanIdRef.current && planHist.current) {
      return dir === 'undo' ? planHist.current.undo(step) : planHist.current.redo(step)
    }
    const cur = planHistoryRef.current[planId]
    const to = dir === 'undo' ? cur?.past[cur.past.length - 1] : cur?.future[0]
    if (!to || to.id !== step) return false
    const from = { id: to.id, snap: boardRef.current[planId] ?? [] }
    setPlanHistory((m) => {
      const c = m[planId]
      if (!c) return m
      return { ...m, [planId]: dir === 'undo'
        ? { past: c.past.slice(0, -1), future: [from, ...c.future] }
        : { past: [...c.past, from], future: c.future.slice(1) } }
    })
    // ⚠️ a RESTORE, not a placement (`gesture: false`): the snapshot is the sheet's whole view,
    // projections included, and read as a hand it flipped any it still held at an older spot
    setBoard((all) => ({ ...all, [planId]: to.snap }), { gesture: false })
    return true
  }
  /** Record on the timeline that one plan document just gained a step. The Whiteboard pushes its
   *  own checkpoint (useBoardDoc · pushPast) and calls only this — it is the ONLY writer of these
   *  per-document stacks. A writer that reaches a plan while the board is unmounted (the Trupp
   *  sweeps, a Gebäude amend) goes through the store's `setBoard` instead, which lays its step on
   *  the STORE's stack where the write touched an object the sheet does not own (lib/useObjectStore
   *  · touchedForeign) — the one stack such a write can reach. */
  const rememberPlanStep = (planId: string, step: string) => {
    // ⚠️ …and the STORE is told too, because a plan gesture may reach an object the sheet does
    // not own (lib/useObjectStore · setBoard): one gesture is one step on whichever stack owns
    // what it touched, and this is the signal that keeps it to one.
    beginSheetStep()
    const label = planStepLabelRef.current ?? fillTemplate(appConfig.copy.undoDomains.plan, { plan: planLabelRef.current(planId) })
    planStepLabelRef.current = null
    const drop = undoHist.push({
      domain: 'plan',
      scope: planId,
      label,
      // ⚠️ A plan's stack holds whole-sheet VIEW snapshots, not per-object steps, so it survives a
      // merge only WHOLE: every entry of it names every object the sheet's history or view holds,
      // plus the sheet's view itself — a merge that touches any of them drops the plan's steps
      // together (useBoardDoc · planStackTouches / keepPlanSteps). `step` is the snapshot's own id.
      step,
      touches: () => planStackTouches(planId, planHistoryRef.current[planId], boardRef.current[planId]),
      undo: () => histStep(planStepAt(planId, 'undo', step), 'undo', label, ''),
      redo: () => histStep(planStepAt(planId, 'redo', step), 'redo', label, ''),
    })
    // if the fold that follows reaches an object this sheet does not own, the STORE takes the
    // step and this entry (and its snapshot) is withdrawn — one gesture, one ↶ (lib/planStepLink)
    planStepLinkRef.current ??= createPlanStepLink((pid) => setPlanHistory((m) => {
      const c = m[pid]
      return c?.past.length ? { ...m, [pid]: { ...c, past: c.past.slice(0, -1) } } : m
    }))
    planStepLinkRef.current.opened(planId, drop)
  }
  // …and the zoom/pan of each plan, for the same reason: coming back from the Karte to a board
  // that had reset itself to «eingepasst» means finding your place on it again, every time.
  // Same scope as the Lage map's own view memory (MapView · viewRef): this component is keyed
  // per Einsatz and dies with it, and nothing here is written to the synced workspace — where a
  // viewer stands on a plan is private to their device. A REF, so a pan re-renders only the board.
  const planViews = useRef<BoardViews>({})
  // the Plan exposes its fit-to-view here so the phone top bar can offer Fit (the plan's
  // equivalent of the map's locate) instead of a floating zoom cluster on a small screen.
  const planFit = useRef<(() => void) | null>(null)
  // the Plan exposes tool-pick + zoom here so the global keyboard-shortcut layer can drive it
  // while the Plan is the active surface (parity with how it drives the Lage map).
  const planKeys = useRef<{ pickTool: (tool: ToolCmd) => void; zoom: (f: number) => void; duplicate: () => void } | null>(null)
  // the words of a plan act for its ↶ — on both stacks, since whichever owns the object
  // takes the step (lib/planStepLink)
  const onPlanStepLabel = (label: string) => { planStepLabelRef.current = label; stepLabelRef.current = label }
  /** the Whiteboard's gesture ended: the plan step closes, and the store's with it */
  const endPlanStep = () => { planStepLinkRef.current?.closed(); endSheetStep() }

  return { planHist, planHistory, setPlanHistory, rememberPlanStep, onPlanStepLabel, endPlanStep, planViews, planFit, planKeys }
}
