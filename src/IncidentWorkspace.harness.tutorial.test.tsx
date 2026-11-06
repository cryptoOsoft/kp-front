// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, fireEvent, screen } from '@testing-library/react'
import { useState } from 'react'
import type { MittelEntry } from './types'
import { AUTH, SYM, rec, registerHarnessHooks, mount, settle } from './IncidentWorkspace.harness.setup'
import { PHONE_QUERY } from './lib/breakpoints'
import { findAnchor, type TutAnchor } from './lib/tutorials/anchors'
import { stepsOf } from './lib/tutorials/steps'
import { TUTORIALS } from './lib/tutorials/catalogue'
import { setTutorialSession, startTutorial } from './lib/tutorials/session'
import type { Snapshot } from './lib/tutorials/snapshot'

/*
 * The workspace harness (shared setup: IncidentWorkspace.harness.setup.tsx) — «Üben»:
 *
 *   (t) every control a tutorial step points at is in the DOM of the step's surface, on the
 *       tablet's rails AND on the phone's bars + «+» sheet (O1) – the drift catcher: a control
 *       that moves or loses its `tut()` spread turns this red instead of a silent broken step.
 *   (u) a started tutorial loads the runner's chunk, binds to the open Übung and shows its pill.
 */

vi.mock('./lib/auth', async (importOriginal) => {
  const mod = await importOriginal<typeof import('./lib/auth')>()
  const logout = () => Promise.resolve()
  // one stable value per role, so a render never hands the workspace a «new» user
  const valueOf = (role: typeof AUTH.role) => ({
    user: { id: 'u1', username: 'fu', display_name: 'FU Test', role, color: null, last_login: null },
    loading: false, probeUnreachable: false, sessionExpired: false, login: () => Promise.resolve(), logout,
  })
  const values = { editor: valueOf('editor'), el: valueOf('el'), viewer: valueOf('viewer') }
  return { ...mod, useAuth: () => values[AUTH.role] }
})
vi.mock('./lib/useSymbols', async (importOriginal) => ({ ...(await importOriginal<typeof import('./lib/useSymbols')>()), useSymbols: () => SYM }))
vi.mock('./components/MapView', () => ({
  MapView: (p: Record<string, unknown>) => { rec.map.push(p); return <div data-testid="mapview" /> },
}))
vi.mock('./components/Whiteboard', async () => {
  const { useBoardDoc } = await vi.importActual<typeof import('./components/useBoardDoc')>('./components/useBoardDoc')
  type P = Omit<Parameters<typeof useBoardDoc>[0], 'selId' | 'setSelId' | 'editId' | 'setEditId'> & { keysRef?: { current: unknown }; fitRef?: { current: unknown } }
  function FakeBoard(p: P) {
    rec.board.push(p as unknown as Record<string, unknown>)
    const [selId, setSelId] = useState<string | null>(null)
    const [editId, setEditId] = useState<string | null>(null)
    const doc = useBoardDoc({ ...p, selId, setSelId, editId, setEditId })
    rec.boardDoc = doc as unknown as { commit: (next: unknown[]) => void }
    if (p.keysRef) p.keysRef.current = rec.planKeys
    if (p.fitRef) p.fitRef.current = rec.planFit
    return <div data-testid="whiteboard" />
  }
  return { Whiteboard: FakeBoard }
})
// the Mittel surface as a prop recorder: the entries it is handed, and its save door
vi.mock('./components/MittelView', () => ({
  MittelView: (p: Record<string, unknown> & { entries: MittelEntry[] }) => {
    rec.mittel.push(p)
    return <ul data-testid="mittel">{p.entries.map((e) => <li key={e.id}>{e.label}</li>)}</ul>
  },
}))
// the Rapport's own chunk, prefetched on idle — not part of any contract here
// …recording its props: `events` is the Verlauf as the workspace holds it, which is how (e) reads
// the rows an act wrote without mounting the Verlauf drawer
vi.mock('./components/ReportPreflight', () => ({
  ReportPreflight: (p: { events: { text?: string }[] }) => { rec.report = p; return null },
  requestReportStep: () => {},
}))
vi.mock('./lib/ui', async (importOriginal) => {
  const mod = await importOriginal<typeof import('./lib/ui')>()
  return { ...mod, confirmDialog: () => { rec.confirms++; return Promise.resolve(rec.answers.length ? rec.answers.shift()! : rec.answer) } }
})
// a surface that crashes is caught by its SurfaceBoundary, remounted, and the assertions would run
// against the fresh tree and pass — so every boundary report is recorded and fails the test
vi.mock('./lib/reportError', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./lib/reportError')>()),
  reportClientError: (err: unknown, ctx: { kind?: string; surface?: string } = {}) => {
    rec.reported.push(`${ctx.kind ?? '?'}${ctx.surface ? `(${ctx.surface})` : ''}: ${err instanceof Error ? err.message : String(err)}`)
  },
}))
vi.mock('./lib/mediaQueue', async (importOriginal) => {
  const mod = await importOriginal<typeof import('./lib/mediaQueue')>()
  return { ...mod, flushMediaQueue: async (...a: Parameters<typeof mod.flushMediaQueue>) => { rec.order.push('flush'); return mod.flushMediaQueue(...a) } }
})

registerHarnessHooks()
afterEach(() => { setTutorialSession(null) })

/** a step's anchors as one list – a function anchor is asked in both of its states (↶, then ↷) */
function namedAnchors(): { step: string; anchors: readonly TutAnchor[] }[] {
  const blank = { events: [] } as unknown as Snapshot
  const afterUndo = { events: [{ name: 'undo', seq: 1 }] } as unknown as Snapshot
  return TUTORIALS.flatMap((t) => stepsOf(t.id).flatMap((st) => {
    const a = st.anchor
    if (!a) return []
    if (typeof a !== 'function') return [{ step: `${t.id}.${st.id}`, anchors: a }]
    return [blank, afterUndo].map((now) => ({ step: `${t.id}.${st.id}`, anchors: a(now, blank) }))
  }))
}
const onScreen = (anchors: readonly TutAnchor[]) => anchors.filter((a) => findAnchor(a))

describe('(t) the tutorial anchors are on their surface', () => {
  it('tablet: every step finds a control on the Karte (all steps of Round 1 live there)', async () => {
    await mount()
    for (const { step, anchors } of namedAnchors()) expect(onScreen(anchors), step).not.toEqual([])
    // the rail tile a step on another surface points back at
    expect(findAnchor('rail.map')).toBeTruthy()
  })

  it('phone: «Hinzufügen» first, then the tool inside its sheet (O1)', async () => {
    const before = window.matchMedia
    window.matchMedia = ((q: string) => ({
      matches: q === PHONE_QUERY, media: q, onchange: null, addListener: () => {}, removeListener: () => {},
      addEventListener: () => {}, removeEventListener: () => {}, dispatchEvent: () => false,
    })) as unknown as typeof window.matchMedia
    try {
      await mount()
      // the draw tools are off the phone bar – their steps point at «+ Hinzufügen»
      expect(findAnchor('tool.line')).toBeNull()
      expect(findAnchor('tool.add')).toBeTruthy()
      for (const { step, anchors } of namedAnchors()) expect(onScreen(anchors), step).not.toEqual([])
      act(() => { fireEvent.click(findAnchor('tool.add')!) })
      await settle()
      for (const a of ['add.search', 'add.line', 'add.circle', 'add.note'] as const) expect(findAnchor(a), a).toBeTruthy()
    } finally {
      window.matchMedia = before
    }
  })
})

describe('(u) a started tutorial runs on the open Übung', () => {
  it('binds (the Round-1 door refuses) and shows «Üben 1/7»', async () => {
    startTutorial('lageZeichnen')
    await mount()
    // the runner is its own chunk (components/tutorial/lazy): the pill comes once it has loaded
    expect(await screen.findByRole('button', { name: /Üben 1\/7/ }, { timeout: 5000 })).toBeTruthy()
  })
})
