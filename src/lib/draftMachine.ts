import { appConfig } from '../config/appConfig'
import type { BoardTool, MapTool } from '../types'
import { fillTemplate } from './format'
import { confirmDialog } from './ui'
import { minPoints } from './vertexOps'

/**
 * The draft contract both create surfaces run — the Karte (lib/useMapDrawing) and the Plan
 * (components/usePlanDraft): what a tapped-out Punkte-Linie or Fläche turns into on ✓ «Fertig»,
 * and when it is LEFT open (picking another tool or dock, Escape, a selection landing, leaving the
 * surface). Pure decisions over the armed tool, its mode and the draft's point count, plus the one
 * question both surfaces ask (`askOpenDraft`); each surface keeps its own storage, commit funnel
 * and toasts, and only asks here what to do, so the rule cannot fork again
 * (docs/tactical-objects.md · Lage ↔ Plan parity).
 */
export type DraftKind = 'line' | 'area'
export type DraftMode = 'freehand' | 'nodes'

/** What leaving the tool does to the draft in the hand. */
export type DraftRelease =
  /** nothing in the hand, or a draft that is not this tool's to touch */
  | { type: 'keep' }
  /** a Freihand remnant (a tool switch mid-stroke), or a fragment below the minimum: there is
   *  nothing worth keeping, and it goes silently (owner, 27.10.2026) */
  | { type: 'drop' }
  /** a surface that may no longer write: dropped, and an action-less toast says so — a shape
   *  that WAS committable is never lost without a word */
  | { type: 'discard' }
  /** a committable draft: ask «Speichern · Verwerfen · Weiterzeichnen» (`askOpenDraft`) */
  | { type: 'ask'; kind: DraftKind }
  /** a committable draft whose surface goes away under it (the document is left): nobody is
   *  left to answer, so it is committed through the ✓'s own funnel, with a «Rückgängig» toast */
  | { type: 'commit'; kind: DraftKind }

/** The shape ✓ «Fertig» commits for the armed tool — a Linie from 2 points, a Fläche from 3
 *  (lib/vertexOps · minPoints) — or null when the draft is not one yet. */
export function finishKind(tool: MapTool | BoardTool, count: number): DraftKind | null {
  const kind: DraftKind | null = tool === 'line' ? 'line' : tool === 'area' ? 'area' : null
  return kind && count >= minPoints(kind) ? kind : null
}

/** ✓ «Fertig» is enabled: a node-mode draft of the armed tool that would commit. */
export function draftActive(tool: MapTool | BoardTool, modes: { lineMode: DraftMode; areaMode: DraftMode }, count: number): boolean {
  const mode = tool === 'line' ? modes.lineMode : tool === 'area' ? modes.areaMode : null
  return mode === 'nodes' && finishKind(tool, count) != null
}

/**
 * The tool being LEFT (`from`) decides, never the one being armed: «Weiterzeichnen» restores a
 * draft WHILE re-arming its tool, and that arming must not read as one more leave that asks
 * again. A committable draft asks (27.10.2026, owner – it replaced the A6 auto-commit of
 * 29.08.); `ask: false` is the leave nobody can answer for (the document itself goes) and
 * commits instead. `locked` (replay, lost tab lock, Führungsansicht) makes every committable
 * draft a discard, because the create funnel would refuse it. Escape is a leave like any other.
 */
export function releaseDraft({ from, lineMode, count, locked = false, ask = true }: {
  from: string; lineMode: DraftMode; count: number; locked?: boolean; ask?: boolean
}): DraftRelease {
  if (!count) return { type: 'keep' }
  const kind: DraftKind | null = from === 'area' ? 'area' : from === 'line' && lineMode === 'nodes' ? 'line' : null
  if (!kind) return from === 'line' ? { type: 'drop' } : { type: 'keep' }
  if (count < minPoints(kind)) return { type: 'drop' }
  if (locked) return { type: 'discard' }
  return { type: ask ? 'ask' : 'commit', kind }
}

/** The answer to «… noch offen»: the three buttons, in the owner's words. */
export type OpenDraftAnswer = 'save' | 'discard' | 'continue'

/**
 * Ask what becomes of an open drawing that is being left – «Speichern» (commits, one ↶),
 * «Verwerfen», «Weiterzeichnen» (back to the tool, the drawing in the hand). `name` is what the
 * drawing is («Linie», «Wand», «Fläche»). Dismissing the dialog is «Weiterzeichnen»: the one
 * answer that loses nothing and writes nothing. Both surfaces call this, so the question reads
 * the same on the Karte and on a Plan.
 */
export async function askOpenDraft(name: string): Promise<OpenDraftAnswer> {
  const C = appConfig.copy.toolDock
  const answer = await confirmDialog({
    title: fillTemplate(C.openTitle, { name }),
    message: C.openMessage,
    confirmLabel: C.openSave,
    altLabel: C.openDiscard,
    altDanger: true,
    cancelLabel: C.openContinue,
  })
  return answer === true ? 'save' : answer === 'alt' ? 'discard' : 'continue'
}
