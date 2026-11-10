// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest'
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { useState } from 'react'
import type { MittelEntry } from './types'
import { AUTH, SYM, rec, registerHarnessHooks, lastMap, meta, truck, workspaceTree, settle, mount, key, mode, type WsProps } from './IncidentWorkspace.harness.setup'
import { Meldeleiste } from './components/Meldeleiste'
import { WorkspaceSync } from './lib/api/workspaceSync'
import type { IncidentMeta } from './lib/api/incidents'
import type { Saved } from './lib/workspace'
import { appConfig } from './config/appConfig'
import { getMeldeleisteHost } from './lib/meldeleisteHost'

/*
 * The workspace harness (shared setup: IncidentWorkspace.harness.setup.tsx) — the Einsatz's
 * lifecycle around the open workspace:
 *
 *   (c) the Abschluss: cancel closes nothing; OK drains the media queue FIRST, then hands over.
 *   (i) a close on ANOTHER device: the same mount goes read-only, the alarm stops, one row says so.
 *   (j) a reopen with a crew inside: no instant «Überfällig» — the clock restarts at the reopen.
 *   (k) covered by «Karte & Objekte»: the alarm still rings, «Zum Trupp» comes back; and the
 *       workspace is where the Meldeleiste paints.
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

describe('(c) the Abschluss', () => {
  const pressAbschluss = async () => {
    // the Einsatz menu (the title pill), then its «Einsatz abschliessen» row
    fireEvent.click(screen.getByRole('button', { name: 'Harness' }))
    await settle()
    fireEvent.click(screen.getByRole('button', { name: appConfig.copy.incidentSwitcher.archive }))
    await settle()
  }

  it('cancel closes nothing and hands nothing over', async () => {
    const { onCompleteRapport } = await mount()
    rec.answer = false
    await pressAbschluss()
    expect(rec.confirms).toBe(1)
    expect(onCompleteRapport).not.toHaveBeenCalled()
  })

  /* «Alle Einsätze» is opened FROM the Einsatz menu, which stays logically open under it. Its
     «Abschliessen» asks through `abschlussRef`, and the menu stood open behind that question
     (sweep 09.11.2026). */
  it('asked from «Alle Einsätze», the confirm puts the Einsatz menu away first', async () => {
    const abschlussRef: WsProps['abschlussRef'] = { current: null }
    await mount({ abschlussRef })
    rec.answer = false
    fireEvent.click(screen.getByRole('button', { name: 'Harness' }))
    await settle()
    const menuRow = () => screen.queryByRole('button', { name: appConfig.copy.incidentSwitcher.archive })
    expect(menuRow()).toBeTruthy()
    await act(async () => { await abschlussRef?.current?.() })
    expect(rec.confirms).toBe(1)
    expect(menuRow()).toBeNull()
  })

  /* A Sicherungstrupp still angemeldet (24.09.2026, D1 ⑦): the workspace wires the Abschluss's
     «nicht eingesetzt» to the card's own stand-down, and only after the final «Abschliessen». */
  const standing = {
    id: 'sich', no: 6, name: 'Muster Leo', entryPressureBar: 280, entryTime: '', lastContactTime: '',
    status: 'angemeldet', auftrag: 'sichern', readings: [],
  }
  const withSafety = () => ({ workspace: { entities: [truck], trupps: [standing] } as unknown as Saved })
  const statusOnBoard = async () => {
    key('a')
    await settle()
    return document.body.textContent ?? ''
  }

  it('«nicht eingesetzt», then «Abbrechen»: the Sicherungstrupp is still angemeldet', async () => {
    const { onCompleteRapport } = await mount(withSafety())
    rec.answers.push(true, false)
    await pressAbschluss()
    expect(rec.confirms).toBe(2)
    expect(onCompleteRapport).not.toHaveBeenCalled()
    // still at the door: its card offers «Im Einsatz», not the way back in of a closed Trupp
    expect(await statusOnBoard()).not.toContain(appConfig.copy.atemschutz.actEnterFirst)
  })

  it('«nicht eingesetzt», then «Abschliessen»: stood down through the card\'s own close-out, then handed over', async () => {
    const { onCompleteRapport } = await mount(withSafety())
    rec.answers.push(true, true)
    await pressAbschluss()
    // the stand-down takes one task before the handover (useAbschluss) — wait for it, not a clock
    await waitFor(() => expect(onCompleteRapport).toHaveBeenCalledTimes(1), { timeout: 10_000 })
    expect(await statusOnBoard()).toContain(appConfig.copy.atemschutz.actEnterFirst)
  })

  it('OK drains the media queue FIRST, then hands the Einsatz over', async () => {
    const { onCompleteRapport } = await mount()
    rec.answer = true
    rec.order.length = 0
    await pressAbschluss()
    // the Verlauf and audit outboxes drain between the media and the handover (review of #235) —
    // an await more, which a loaded runner can stretch past the fixed settle
    await waitFor(() => expect(onCompleteRapport).toHaveBeenCalledTimes(1))
    expect(rec.order.slice(-2)).toEqual(['flush', 'complete'])
  })
})

// N3, staging 25.09.2026
describe('(i) closed on ANOTHER device while open here', () => {
  // App flips the live meta when the close is heard (useIncidentLifecycle · onIncidentClosed) and hands the moment
  // down — no remount. The same mount must go read-only, stop the Atemschutz alarm (its Meldung is
  // the audible alarm's own row) and say what happened, with the time.
  it('the Karte locks, the alarm stops and one row says «auf einem anderen Gerät abgeschlossen»', async () => {
    const m = meta()
    const longAgo = new Date(Date.now() - 60 * 60_000).toISOString()
    const overdue = { id: 'tr-k', name: 'Tst Karl', status: 'aktiv', entryPressureBar: 300, entryTime: longAgo, lastContactTime: longAgo }
    const sync = new WorkspaceSync(m.id)
    const ws = { entities: [truck], trupps: [overdue] } as unknown as Saved
    const tree = (im: IncidentMeta, lifecycleElsewhere?: WsProps['lifecycleElsewhere']) => <><Meldeleiste />{workspaceTree(im, { sync, workspace: ws, lifecycleElsewhere }).tree}</>
    const { rerender } = render(tree(m))
    await settle(60); await settle(1_100) // the 1 Hz alarm tick
    const rows = () => [...document.querySelectorAll('.ml-row')].map((r) => r.textContent ?? '')
    expect(lastMap().readOnly).toBe(false)
    expect(rows().some((t) => t.includes('Tst Karl'))).toBe(true) // überfällig — the alarm is on

    const closedAt = new Date()
    rerender(tree({ ...m, is_archived: true, closed_at: closedAt.toISOString() }, { event: 'closed', at: closedAt.getTime() }))
    await settle(60); await settle(1_100)

    expect(lastMap().readOnly).toBe(true)
    expect(rows().some((t) => t.includes('Tst Karl'))).toBe(false) // the alarm stopped with the Einsatz
    const title = document.querySelector('.ml-title')?.textContent ?? ''
    expect(title).toBe(`Einsatz wurde auf einem anderen Gerät abgeschlossen (${String(closedAt.getHours()).padStart(2, '0')}:${String(closedAt.getMinutes()).padStart(2, '0')})`)
    expect(document.querySelector('.app')).toBeTruthy() // the same workspace, not a jump elsewhere
    // …and never over the Rapport, whose head carries the page's own actions (V3)
    key('r'); await settle()
    expect([...document.querySelectorAll('.ml-title')].some((t) => t.textContent?.includes('anderen Gerät'))).toBe(false)
    key('k'); await settle()

    // …and «Wieder öffnen» on another device: live again, in place, the alarm back, one row
    const reopenedAt = new Date()
    rerender(tree({ ...m, is_archived: false, closed_at: closedAt.toISOString() }, { event: 'reopened', at: reopenedAt.getTime() }))
    await settle(60); await settle(1_100)
    expect(lastMap().readOnly).toBe(false)
    expect(rows().some((t) => t.includes('Tst Karl'))).toBe(true) // the Tafel is watched again
    const hhmm = `${String(reopenedAt.getHours()).padStart(2, '0')}:${String(reopenedAt.getMinutes()).padStart(2, '0')}`
    const titles = [...document.querySelectorAll('.ml-title')].map((t) => t.textContent)
    expect(titles).toContain(`Einsatz wurde auf einem anderen Gerät wieder geöffnet (${hhmm})`)
    expect(titles.some((t) => t?.includes('abgeschlossen'))).toBe(false) // the close's row is gone
  })

  it('an Einsatz OPENED closed says nothing of the kind — nobody saw it happen', async () => {
    const m = { ...meta(), is_archived: true, closed_at: '2026-09-25T10:00:00Z' }
    render(<><Meldeleiste />{workspaceTree(m, { forceReadOnly: true }).tree}</>)
    await settle(60)
    expect(document.querySelector('.ml-title')?.textContent ?? '').not.toMatch(/anderen Gerät/)
  })
})

// staging r3, F4
describe('(j) «Wieder öffnen» with a crew still inside', () => {
  it('holds the alarm until the reopen row is there, then restarts the clock at it — one row, no instant «Überfällig»', async () => {
    const m = meta()
    const longAgo = new Date(Date.now() - 60 * 60_000).toISOString()
    const overdue = { id: 'tr-k', no: 1, name: 'Tst Karl', status: 'aktiv', entryPressureBar: 300, entryTime: longAgo, lastContactTime: longAgo }
    const closedAt = new Date(Date.now() - 30 * 60_000).toISOString()
    const reopenAt = new Date(Date.now() - 3 * 60_000).toISOString()
    const closeRow = { id: 'sysclose', t: '', at: closedAt, icon: 'flag', text: 'Einsatz abgeschlossen', lifecycle: 'closed' }
    const reopenRow = { id: 'sysreopen', t: '', at: reopenAt, icon: 'undo', text: 'Einsatz wiedereröffnet (Nachtrag)', lifecycle: 'reopened' }
    let serverRows: unknown[] = [closeRow]
    const posted: { id: string }[] = []
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      if (url.includes('/journal') && (init?.method ?? 'GET') === 'GET') {
        const entries = serverRows.map((row, i) => ({ seq: i + 1, row }))
        return new Response(JSON.stringify({ entries, latest_seq: entries.length }), { status: 200, headers: { 'content-type': 'application/json' } })
      }
      if (url.includes('/journal') && init?.method === 'POST') {
        const body = JSON.parse(String(init.body)) as { entries: { id: string }[] }
        posted.push(...body.entries)
        return new Response(JSON.stringify({ entries: [], latest_seq: serverRows.length }), { status: 201, headers: { 'content-type': 'application/json' } })
      }
      return new Response('{}', { status: 404, headers: { 'content-type': 'application/json' } })
    }))
    const sync = new WorkspaceSync(m.id)
    const ws = { entities: [truck], trupps: [overdue] } as unknown as Saved
    const heardAt = Date.now()
    const tree = (im: IncidentMeta, lifecycleElsewhere?: WsProps['lifecycleElsewhere']) => <><Meldeleiste />{workspaceTree(im, { sync, workspace: ws, lifecycleElsewhere }).tree}</>
    // the device opens it closed (a close heard earlier), then the reopen arrives by the poll…
    const { rerender } = render(tree({ ...m, is_archived: true, closed_at: closedAt }))
    await settle(60)
    rerender(tree({ ...m, is_archived: false, closed_at: closedAt }, { event: 'reopened', at: heardAt }))
    await settle(60); await settle(1_100)
    const rows = () => [...document.querySelectorAll('.ml-row')].map((r) => r.textContent ?? '')
    // …before the Verlauf has the reopen row: the alarm HOLDS rather than ring across the closed hour
    expect(rows().some((t) => t.includes('Tst Karl'))).toBe(false)

    // the reopen row arrives (the journal loop's next round)
    serverRows = [closeRow, reopenRow]
    await settle(2_600); await settle(1_100)
    // the clock restarted at the reopen: still no alarm, and ONE row under the derived id
    expect(rows().some((t) => t.includes('Tst Karl'))).toBe(false)
    const restart = posted.filter((r) => r.id === 'azro-sysreopen-tr-k')
    expect(restart).toHaveLength(1)
    // …and the notice names the REOPEN's time (the server row), not when this device heard it (N6)
    const hhmm = (ms: number) => `${String(new Date(ms).getHours()).padStart(2, '0')}:${String(new Date(ms).getMinutes()).padStart(2, '0')}`
    const titles = [...document.querySelectorAll('.ml-title')].map((t) => t.textContent)
    expect(titles).toContain(`Einsatz wurde auf einem anderen Gerät wieder geöffnet (${hhmm(Date.parse(reopenAt))})`)
  }, 20_000)
})

// lead decision, 16.10.2026
describe('(k) covered by «Karte & Objekte» / the Objektbesuche', () => {
  // The viewer (or a visit) stands in front of the open Einsatz, which stays MOUNTED behind it
  // (App · `covered`): no map, no keys — but the Atemschutz alarm rings and its row stands in the
  // strip, and «Zum Trupp» brings the Einsatz back on the board at that card.
  it('an active Trupp\'s timer alarm fires while the viewer is in front, and «Zum Trupp» comes back to the board', async () => {
    const { Alarm } = await import('./lib/alarm')
    const tone = vi.spyOn(Alarm.prototype, 'set')
    const m = meta()
    const longAgo = new Date(Date.now() - 60 * 60_000).toISOString()
    const overdue = { id: 'tr-c', name: 'Tst Clara', status: 'aktiv', entryPressureBar: 300, entryTime: longAgo, lastContactTime: longAgo }
    const sync = new WorkspaceSync(m.id)
    const ws = { entities: [truck], trupps: [overdue] } as unknown as Saved
    const onUncover = vi.fn()
    const tree = (covered: boolean) => <><Meldeleiste />{workspaceTree(m, { sync, workspace: ws, covered, onUncover }).tree}</>
    const { rerender } = render(tree(true))
    await settle(60); await settle(1_100) // the 1 Hz alarm tick

    // nothing of the Einsatz is on screen…
    expect(document.querySelector('.app')).toBeNull()
    expect(rec.map).toHaveLength(0)
    // …but the alarm is: the tone at «überfällig», and the row with the Trupp and its way back
    expect(tone).toHaveBeenLastCalledWith(2)
    const row = [...document.querySelectorAll('.ml-row')].find((r) => r.textContent?.includes('Tst Clara'))
    expect(row).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: appConfig.copy.atemschutz.alarmRowGo }))
    expect(onUncover).toHaveBeenCalledTimes(1)
    // App uncovers: the SAME mount (no remount, no reopen) shows the Atemschutz board
    rerender(tree(false))
    await settle(60)
    expect(mode()).toBe('atemschutz')
    tone.mockRestore()
  })

  it('a covered Einsatz with nobody under air stays silent, and its keys are not live', async () => {
    const { Alarm } = await import('./lib/alarm')
    const tone = vi.spyOn(Alarm.prototype, 'set')
    const m = meta()
    const sync = new WorkspaceSync(m.id)
    const tree = (covered: boolean) => <><Meldeleiste />{workspaceTree(m, { sync, covered }).tree}</>
    const { rerender } = render(tree(true))
    await settle(60); await settle(1_100)
    expect(tone).not.toHaveBeenCalledWith(2)
    expect(document.querySelectorAll('.ml-row')).toHaveLength(0)
    // «R» typed in the viewer's search must not switch the Einsatz behind it to the Rapport
    key('r'); await settle()
    rerender(tree(false)); await settle(60)
    expect(mode()).toBe('map')
    tone.mockRestore()
  })
})

/* staging r5 N3: the Meldeleiste paints INSIDE the open Einsatz's `.app` (lib/meldeleisteHost) —
   beside it, at App root, it outranked the whole stacking context and lay over the Einsatz menu. */
describe('(k) the workspace is where the Meldeleiste paints', () => {
  it('registers its .app as the strip\'s host, and lets go when it unmounts', async () => {
    const { unmount } = await mount()
    expect(getMeldeleisteHost()?.classList.contains('app')).toBe(true)
    unmount()
    expect(getMeldeleisteHost()).toBeNull()
    // the last test of the file: let the unmounted workspace's IndexedDB round-trips (the media
    // queue's mount flush) land while jsdom still stands — under a loaded full run they settled
    // after the teardown and failed the suite with «window is not defined» (useMediaQueue)
    await settle(100)
  })
})
