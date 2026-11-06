// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, renderHook } from '@testing-library/react'
import { drawnPumpEntities, drawsPumps, linePumpSpots, readyLinePumps } from './linePumps'
import { pointAlongPath } from './geo'
import { RELAY_PUMP_SYMBOL } from './hydraulics'
import { resetProfileCache } from './profile'
import { useMapDrawing } from './useMapDrawing'
import { useRelay } from './useRelay'
import { useUndoableDoc } from './useUndoableDoc'
import type { Doc } from './workspace'
import type { Drawing, LngLat } from '../types'
import { appConfig } from '../config/appConfig'

vi.mock('./ui', () => ({ toast: vi.fn(), confirmDialog: vi.fn() }))

// «Pumpen auf Karte» (owner 05.11.2026): a Leitung draws its pumps, DERIVED from its calculation.
// ~1.5 km east–west in Oberwil on 75 mm at 800 l/min, no profile (friction only): pumps at ~408 m steps.
const route: LngLat[] = [[7.55, 47.5], [7.57, 47.5]]
const line = (over: Partial<Drawing> = {}): Drawing =>
  ({ id: 'd1', kind: 'line', coords: route, hose: '75', relay: { showPumps: true }, ...over }) as Drawing
const near = (a: LngLat, b: LngLat) => { expect(a[0]).toBeCloseTo(b[0], 6); expect(a[1]).toBeCloseTo(b[1], 6) }

beforeEach(() => resetProfileCache())
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals() })

describe('linePumpSpots — where a Leitung\'s pumps stand', () => {
  it('stand where the editor\'s calculation puts them (the same controller the map runs)', () => {
    const d = line()
    const { result } = renderHook(() => useRelay({ coords: d.coords, profile: null, profileLoading: false, value: { hose: d.hose, relay: d.relay }, defaultHose: '75' }))
    const editor = result.current.plan!.pumps.map((p) => pointAlongPath(route, p.dist))
    expect(editor.length).toBeGreaterThan(0)
    expect(linePumpSpots(d, null)).toEqual(editor)
  })

  it('move with the line – nothing is stored that could stay behind', () => {
    const moved = route.map(([x, y]) => [x + 0.01, y] as LngLat)
    const before = linePumpSpots(line(), null)
    const after = linePumpSpots(line({ coords: moved }), null)
    expect(after).toHaveLength(before.length)
    after.forEach((p, i) => near(p, [before[i][0] + 0.01, before[i][1]]))
  })

  it('a pinned pump stands exactly at its pin along the route the water takes', () => {
    near(linePumpSpots(line({ relay: { showPumps: true, pumps: [{ atM: 300 }] } }), null)[0], pointAlongPath(route, 300))
    // reversed: measured from the far end
    near(linePumpSpots(line({ relay: { showPumps: true, reverse: true, pumps: [{ atM: 300 }] } }), null)[0], pointAlongPath([...route].reverse(), 300))
  })

  it('only a hose line with the switch on draws them', () => {
    expect(drawsPumps(line())).toBe(true)
    expect(drawsPumps(line({ relay: {} }))).toBe(false)
    expect(drawsPumps(line({ role: 'wand' }))).toBe(false)
    expect(drawsPumps(line({ kind: 'area' }))).toBe(false)
  })
})

describe('drawnPumpEntities — the paper\'s Motorspritzen', () => {
  it('one Motorspritze per pump on the drawings\' layer – none for a line with the switch off', () => {
    const ents = drawnPumpEntities([line(), line({ id: 'd2', relay: {} })])
    expect(ents).toHaveLength(linePumpSpots(line(), null).length)
    expect(ents.every((e) => e.symbol === RELAY_PUMP_SYMBOL && e.layer === appConfig.defaults.drawingLayerId)).toBe(true)
    expect(new Set(ents.map((e) => e.id)).size).toBe(ents.length)
  })

  it('plans on the terrain the screen fetched once the print has awaited the profiles', async () => {
    // a 100 m climb over the route: more pumps than on flat ground
    const rows = Array.from({ length: 11 }, (_, k) => ({ dist: k * 150, alts: { COMB: 300 + k * 10 } }))
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify(rows), { status: 200 })))
    const flat = drawnPumpEntities([line()]).length
    await readyLinePumps([line(), line({ id: 'off', relay: {} })])
    expect(fetch).toHaveBeenCalledTimes(1)
    expect(drawnPumpEntities([line()]).length).toBeGreaterThan(flat)
  })
})

// The chain the map runs (RelayPumpMarkers · LinePumps): the line's controller writes through
// patchDrawingById – one undo step on the Karte's document each, a Verlauf row for the switch only.
describe('the switch and a dragged pump, as edits of the Leitung', () => {
  const mount = () => {
    const log = vi.fn()
    const hook = renderHook(() => {
      const store = useUndoableDoc<Doc>({ entities: [], drawings: [line({ relay: {} })] } as unknown as Doc, false)
      const drawing = useMapDrawing({
        drawings: store.doc.drawings, selectedDrawingId: null, tacticalLocked: false, tool: 'select', setTool: vi.fn(),
        commit: store.commit, setDocRaw: vi.fn(), beginDrag: vi.fn(), endDrag: vi.fn(), emit: vi.fn(), log,
        setSelectedDrawingId: vi.fn(), setSelectedId: vi.fn(), setSelectedDrawIds: vi.fn(), setSelectedEntityIds: vi.fn(),
      })
      const d = store.doc.drawings[0]
      const ctrl = useRelay({ coords: d.coords, profile: null, profileLoading: false, value: { hose: d.hose, relay: d.relay }, defaultHose: '75',
        onChange: (patch) => drawing.patchDrawingById(d.id, patch) })
      return { store, ctrl, d }
    })
    return { ...hook, log }
  }

  it('«Pumpen auf Karte» on draws them, one ↶ takes them off again – and the Verlauf names it', () => {
    vi.useFakeTimers()
    const { result, log } = mount()
    expect(drawnPumpEntities([result.current.d])).toHaveLength(0)
    act(() => result.current.ctrl.setShowPumps(true))
    expect(result.current.d.relay).toEqual({ showPumps: true })
    expect(drawnPumpEntities([result.current.d]).length).toBeGreaterThan(0)
    // a second «on» changes nothing: there is no second set to place
    act(() => result.current.ctrl.setShowPumps(true))
    act(() => { vi.advanceTimersByTime(4000) })
    expect(log).toHaveBeenCalledTimes(1)
    expect(log.mock.calls[0][1]).toContain(appConfig.copy.log.pumpsShown)
    act(() => { result.current.store.undo() })
    expect(drawsPumps(result.current.d)).toBe(false)
  })

  it('a dragged pump is pinned where it was let go – one step, the switch kept, no Verlauf row', () => {
    vi.useFakeTimers()
    const { result, log } = mount()
    act(() => result.current.ctrl.setShowPumps(true))
    act(() => { vi.advanceTimersByTime(4000) })
    log.mockClear()
    act(() => result.current.ctrl.dragPump(0, 250, 'move'))
    act(() => result.current.ctrl.dragPump(0, 300, 'end'))
    expect(result.current.d.relay).toEqual({ showPumps: true, pumps: [{ atM: 300 }] })
    near(linePumpSpots(result.current.d, null)[0], pointAlongPath(route, 300))
    act(() => { vi.advanceTimersByTime(4000) })
    expect(log).not.toHaveBeenCalled()
    act(() => { result.current.store.undo() })
    expect(result.current.d.relay).toEqual({ showPumps: true })
  })
})
