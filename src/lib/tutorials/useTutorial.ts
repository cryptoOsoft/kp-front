// The tutorial runner («Üben», 05.11.2026) – called by components/tutorial/TutorialRunner, which
// the IncidentWorkspace mounts (a lazy chunk) while a session exists, outside every surface, so a
// surface switch never unmounts it; covering the Einsatz remounts it. It reads the running session
// (./session), binds it to this Einsatz, watches the workspace and moves the steps:
//
//   start   – the Lern-Übung first where the catalogue says `uebung` (./sandbox · openLernUebung).
//             When the door fails, the run stays on the open Einsatz IF that is an Übung (or the
//             public demo) – never on a real one, where every practised Leitung would be record.
//   step    – every snapshot change (one frame debounced) runs the step's predicate against the
//             snapshot from the moment the step began; true → the ✓ for ~1.5 s (O3), then the
//             next step by itself. Progress (./progress) is written on every move, the session is
//             mirrored per tab, so a reload comes back on the step it left.
//   end     – after the last step (or «Beenden») the done card: delete the Lern-Übung, keep it,
//             or go on with the next tutorial on the SAME Übung renamed (O7).
//
// Guards: nothing runs in a link session (`enabled` false); a DIFFERENT Einsatz opening ends the
// run silently – the progress keeps the step, the «Üben» sheet offers «Fortsetzen».
// The UI is components/tutorial/TutorialLayer; this hook returns what it shows and its actions.

import { useEffect, useMemo, useState, useSyncExternalStore } from 'react'
import type { Drawing, Entity, Trupp } from '../../types'
import type { WorkspaceMode } from '../../workspace/types'
import { appConfig } from '../../config/appConfig'
import { isDemoMode } from '../deploymentConfig'
import { toast } from '../ui'
import { TUTORIALS, tutorialMeta, type TutorialId } from './catalogue'
import { clearStep, markDone, markStep } from './progress'
import { deleteLernUebung, openLernUebung, renameLernUebung } from './sandbox'
import { getTutorialHost, getTutorialSession, setTutorialSession, useTutorialSession, type TutorialSession } from './session'
import { recentTutorialEvents, subscribeTutorialEvents, type TutorialEvent } from './bus'
import { runnable, stepAnchors, stepDone, stepsOf, type Step } from './steps'
import type { Snapshot } from './snapshot'
import type { TutAnchor } from './anchors'

/** how long the ✓ stands before the next step comes by itself (owner pick O3) */
export const TICK_MS = 1500

export interface TutorialInput {
  incident: { id: string; title: string; isExercise: boolean }
  /** false in a link session – no tutorial there */
  enabled: boolean
  entities: readonly Entity[]
  drawings: readonly Drawing[]
  trupps: readonly Trupp[]
  journalRows: number
  present: number
  mode: WorkspaceMode
  tool: string
  palette: boolean
  phone: boolean
  /** a step's surface, opened when a run starts there */
  setMode: (m: WorkspaceMode) => void
}

export interface TutorialRun {
  id: TutorialId
  steps: readonly Step[]
  /** 0-based; === steps.length once the run is over */
  step: number
  phase: 'step' | 'tick' | 'end'
  /** the step whose ✓ stands (phase 'tick') */
  ticked: number | null
  skipped: readonly number[]
  /** «Beenden» before the last step */
  endedEarly: boolean
  /** the controls the bubble may point at, first one on screen wins */
  anchors: readonly TutAnchor[]
  /** the bubble asks for another surface first (anchors = that rail tile) */
  away: WorkspaceMode | null
  /** the Lern-Übung this run uses – only then does the end card offer «Übung löschen» */
  lern: string | null
  incidentTitle: string
  /** start to end of the run; 0 while it runs */
  elapsedMs: number
  /** «Weiter mit …» on the done card – the next tutorial that can run here, or null */
  nextTutorial: TutorialId | null
  skip: () => void
  /** «Weiter» on a step the app cannot see */
  confirm: () => void
  goTo: (i: number) => void
  /** the pill's ✕ – keep the step for «Fortsetzen» */
  pause: () => void
  /** «Beenden» in the step list */
  quit: () => void
  /** the end card's «Behalten» / ✕ / «Schliessen» */
  close: () => void
  deleteUebung: () => Promise<void>
  continueWith: () => void
}

const NO_EVENTS: readonly TutorialEvent[] = []
const noSubscribe = () => () => {}
const noEvents = () => NO_EVENTS

/** the next tutorial after `id` that runs inside an Einsatz and has steps (Round 1: none) */
export function nextTutorialAfter(id: TutorialId): TutorialId | null {
  const i = TUTORIALS.findIndex((t) => t.id === id)
  return TUTORIALS.slice(i + 1).find((t) => t.surface === 'einsatz' && t.sandbox === 'uebung' && !t.optional && runnable(t.id))?.id ?? null
}

/** the session one step on; a skipped step is remembered so the done card does not tick it */
export function advanced(s: TutorialSession, opts: { skipped?: boolean } = {}): TutorialSession {
  return { ...s, step: s.step + 1, skipped: opts.skipped ? [...(s.skipped ?? []), s.step] : s.skipped }
}

export function useTutorial(input: TutorialInput): TutorialRun | null {
  const session = useTutorialSession()
  const { incident, enabled } = input
  // a run is LIVE here when it is bound to this Einsatz
  const live = !!session && enabled && session.host === incident.id
  const events = useSyncExternalStore(live ? subscribeTutorialEvents : noSubscribe, live ? recentTutorialEvents : noEvents, noEvents)

  const snap = useMemo<Snapshot>(() => ({
    incident: { id: incident.id, isExercise: incident.isExercise },
    entities: input.entities, drawings: input.drawings, trupps: input.trupps,
    journalRows: input.journalRows, present: input.present,
    ui: {
      mode: input.mode, tool: input.tool, palette: input.palette, phone: input.phone,
      night: typeof document !== 'undefined' && document.documentElement.dataset.theme === 'night',
    },
    events,
  }), [incident.id, incident.isExercise, input.entities, input.drawings, input.trupps, input.journalRows, input.present,
    input.mode, input.tool, input.palette, input.phone, events])

  // the snapshot from the moment the current step began – «derive state from props», so a new
  // step re-bases in the same render that shows it
  const stepKey = live ? `${session.id}:${session.step}:${session.startedAt ?? 0}` : ''
  const [start, setStart] = useState({ key: stepKey, snap })
  if (start.key !== stepKey) setStart({ key: stepKey, snap })
  const startSnap = start.key === stepKey ? start.snap : snap

  // the step whose ✓ is standing, keyed like the start so a step change drops it
  const [tick, setTick] = useState<{ key: string; step: number } | null>(null)
  const ticked = tick && tick.key === stepKey ? tick.step : null

  // ── bind the run to this Einsatz (or end it) ─────────────────────────────────────────────
  const setMode = input.setMode
  useEffect(() => {
    if (!session || !enabled) return
    // another Einsatz opened while a run was bound elsewhere: end it, progress keeps the step
    if (session.host && session.host !== incident.id) { setTutorialSession(null); return }
    if (session.host) return
    // the door handed out another Einsatz and App is opening it – that mount binds
    if (session.incidentId && session.incidentId !== incident.id) return
    const meta = tutorialMeta(session.id)
    // not a run this surface can carry (Round 2: the Karte home, the Objektbesuche)
    if (meta.surface !== 'einsatz' || !runnable(session.id)) return
    const bind = (lern?: string) => {
      setTutorialSession({ ...session, host: incident.id, incidentId: lern, startedAt: session.startedAt ?? Date.now() })
      markStep(session.id, session.step)
      const first = stepsOf(session.id)[session.step]?.surface
      if (first) setMode(first)
    }
    if (session.incidentId === incident.id || meta.sandbox !== 'uebung') { bind(session.incidentId); return }
    let stale = false
    openLernUebung(session.id).then(({ incidentId }) => {
      if (stale || getTutorialSession() !== session) return
      const host = getTutorialHost()
      if (incidentId === incident.id || !host) { bind(incidentId === incident.id ? incidentId : undefined); return }
      setTutorialSession({ ...session, incidentId })
      host.open(incidentId)
    }).catch(() => {
      if (stale || getTutorialSession() !== session) return
      const C = appConfig.copy.tutorialRun
      if (incident.isExercise || isDemoMode()) { toast(C.sandboxFailed, { icon: 'warn' }); bind() }
      else { toast(C.sandboxRefused, { icon: 'warn', tone: 'warn' }); setTutorialSession(null) }
    })
    return () => { stale = true }
  }, [session, enabled, incident.id, incident.isExercise, setMode])

  const steps = useMemo(() => (session ? stepsOf(session.id) : []), [session])
  const current: Step | undefined = live ? steps[session.step] : undefined

  // ── watch the step: one frame after a change, ask its predicate ─────────────────────────
  useEffect(() => {
    if (!current || ticked !== null) return
    const raf = requestAnimationFrame(() => {
      if (!stepDone(current, snap, startSnap)) return
      const s = getTutorialSession()
      if (!s) return
      // a reload during the ✓ lands on the next step, not back on this one
      markStep(s.id, s.step + 1)
      setTick({ key: stepKey, step: s.step })
    })
    return () => cancelAnimationFrame(raf)
  }, [current, snap, startSnap, ticked, stepKey])

  // …then the ✓ stands TICK_MS and the next step comes by itself
  useEffect(() => {
    if (ticked === null) return
    const t = setTimeout(() => {
      const s = getTutorialSession()
      if (!s) return
      const next = advanced(s)
      if (next.step >= stepsOf(s.id).length) { markDone(s.id); next.endedAt = Date.now() }
      setTutorialSession(next)
    }, TICK_MS)
    return () => clearTimeout(t)
  }, [ticked])

  if (!live) return null

  const total = steps.length
  const over = session.step >= total
  const s = session
  const go = (next: TutorialSession) => {
    if (next.step >= total) { markDone(next.id); next.endedAt = Date.now() }
    else markStep(next.id, next.step)
    setTutorialSession(next)
  }
  const lern = s.incidentId ?? null
  const away = current?.surface && input.mode !== current.surface ? current.surface : null

  return {
    id: s.id,
    steps,
    step: s.step,
    phase: over ? 'end' : ticked !== null ? 'tick' : 'step',
    ticked,
    skipped: s.skipped ?? [],
    endedEarly: !!s.endedEarly,
    anchors: current ? stepAnchors(current, snap, startSnap) : [],
    away,
    lern,
    incidentTitle: incident.title,
    elapsedMs: s.startedAt && s.endedAt ? s.endedAt - s.startedAt : 0,
    nextTutorial: nextTutorialAfter(s.id),
    skip: () => go(advanced(s, { skipped: true })),
    confirm: () => go(advanced(s)),
    goTo: (i) => go({ ...s, step: Math.max(0, Math.min(total - 1, i)) }),
    pause: () => {
      markStep(s.id, s.step)
      setTutorialSession(null)
      toast(appConfig.copy.tutorialRun.paused)
    },
    quit: () => {
      clearStep(s.id)
      // on a Lern-Übung the end card asks what becomes of it; anywhere else there is nothing to ask
      if (lern) setTutorialSession({ ...s, step: total, endedEarly: true, endedAt: Date.now() })
      else setTutorialSession(null)
    },
    close: () => setTutorialSession(null),
    deleteUebung: async () => {
      if (!lern) return
      setTutorialSession(null)
      // leave first: the workspace's sync is disposed before its Einsatz is gone
      getTutorialHost()?.leave()
      try { await deleteLernUebung(lern) } catch {
        toast(appConfig.copy.tutorialRun.done.deleteFailed, { icon: 'warn', tone: 'warn' })
      }
    },
    continueWith: () => {
      const next = nextTutorialAfter(s.id)
      if (!next) return
      // O7: the SAME Übung, renamed «Lernen · <nächstes>»; a failed rename only costs the title
      if (lern) void renameLernUebung(lern, next).catch(() => {})
      setTutorialSession({ id: next, step: 0, incidentId: lern ?? undefined, host: incident.id, startedAt: Date.now() })
      markStep(next, 0)
      const first = stepsOf(next)[0]?.surface
      if (first) input.setMode(first)
    },
  }
}
