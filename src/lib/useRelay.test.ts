// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest'
import { act, renderHook } from '@testing-library/react'
import { dismissRelayBubble, parseFlow, usePublishRelay, useRelay, useRelayOverlay, type RelayValue } from './useRelay'
import { RELAY } from './hydraulics'
import type { LngLat } from '../types'

// ~1.5 km east–west in Oberwil, no profile (friction only): one automatic pump at ~408 m
const route: LngLat[] = [[7.55, 47.5], [7.57, 47.5]]
const setup = (value: RelayValue = {}) => {
  const onChange = vi.fn()
  const hook = renderHook(({ v }) => useRelay({ coords: route, profile: null, profileLoading: false, value: v, onChange }), { initialProps: { v: value } })
  return { ...hook, onChange }
}

// The edits a Leitung records: each one an ordinary prop edit — a whole `relay` object, so a
// replayed `draw.edit` replaces the old one — and a dragged pump written ONCE, on release.
describe('useRelay — what an edit writes', () => {
  it('a drag previews without writing, commits the pin once on release — and opens no card', () => {
    const { result, onChange } = setup()
    const auto = result.current.plan!.pumps[0].dist
    act(() => result.current.dragPump(0, 250, 'move'))
    act(() => result.current.dragPump(0, 260, 'move'))
    expect(onChange).not.toHaveBeenCalled()
    expect(result.current.plan!.pumps[0]).toMatchObject({ dist: 260, pinned: true })
    expect(auto).not.toBe(260)
    act(() => result.current.dragPump(0, 270, 'end'))
    expect(onChange).toHaveBeenCalledTimes(1)
    expect(onChange).toHaveBeenCalledWith({ relay: { pumps: [{ atM: 270 }] } })
    expect(result.current.selected).toBeNull()
  })

  it('a new source drops the pumps set by hand — a Löschweier renumbers them', () => {
    const { result, onChange } = setup({ relay: { flow: 1000, startBar: 7, pumps: [{ atM: 300, bar: 8 }] } })
    act(() => result.current.set({ source: 'weier' }))
    expect(onChange).toHaveBeenCalledWith({ relay: { flow: 1000, source: 'weier' } })
  })

  // a line drawn from the fire back to the hydrant: the water runs from its last point
  it('a reversed relay runs from the far end and drops the pumps set by hand', () => {
    const { result, rerender, onChange } = setup({ relay: { pumps: [{ atM: 300 }] } })
    act(() => result.current.toggleReverse())
    expect(onChange).toHaveBeenCalledWith({ relay: { reverse: true } })
    rerender({ v: { relay: { reverse: true } } })
    expect(result.current.coords).toEqual([...route].reverse())
    expect(result.current.reversed).toBe(true)
  })

  it('the hose is its own key, the relay untouched', () => {
    const { result, onChange } = setup({ relay: { flow: 1000 } })
    act(() => result.current.set({ hose: '110' }))
    expect(onChange).toHaveBeenCalledWith({ hose: '110' })
  })

  it('a pump back at the default output stores no override', () => {
    const { result, onChange } = setup({ relay: { pumps: [{ bar: 8 }] } })
    act(() => result.current.setPumpBar(0, 10))
    expect(onChange).toHaveBeenCalledWith({ relay: {} })
  })

  it('read-only without a writer', () => {
    const { result } = renderHook(() => useRelay({ coords: route, profile: null, profileLoading: false, value: {} }))
    expect(result.current.readOnly).toBe(true)
  })
})

// the Wasser picker: a preset or a typed amount, read as l/min within the engine's range
describe('parseFlow', () => {
  it('reads a preset, a bare number and a Swiss thousands mark', () => {
    expect(parseFlow('800 l/min')).toBe(800)
    expect(parseFlow('950')).toBe(950)
    expect(parseFlow("1'200 l/min")).toBe(1200)
  })

  it('clamps into the range and ignores junk', () => {
    expect(parseFlow('20')).toBe(RELAY.flowMin)
    expect(parseFlow('99999')).toBe(RELAY.flowMax)
    expect(parseFlow('viel')).toBeNull()
    expect(parseFlow('0')).toBeNull()
  })
})

// A pump tapped on the map opens its bubble there; the next tap on the empty map only closes it
// (MapView · handleClick asks first, so Messen does not also add a point under it).
describe('dismissRelayBubble — the map tap that only closes the map bubble', () => {
  // the panel that publishes and the map that reads are two components, as in the app
  const published = () => {
    const panel = renderHook(() => {
      const ctrl = useRelay({ coords: route, profile: null, profileLoading: false, value: {}, onChange: () => {} })
      usePublishRelay(ctrl, true)
      return ctrl
    })
    const map = renderHook(() => useRelayOverlay())
    return { panel, map, unmount: () => { map.unmount(); panel.unmount() } }
  }

  it('closes a bubble opened on the map, once', () => {
    const { panel, map, unmount } = published()
    act(() => map.result.current!.onSelect(0))
    expect(map.result.current).toMatchObject({ selected: 0, selectedFrom: 'map' })
    let first = false
    act(() => { first = dismissRelayBubble() })
    expect(first).toBe(true)
    expect(panel.result.current.selected).toBeNull()
    expect(dismissRelayBubble()).toBe(false)
    unmount()
  })

  it('leaves the chart\'s bubble alone – the map tap is an ordinary one', () => {
    const { panel, unmount } = published()
    act(() => panel.result.current.tapPump(0, 'chart'))
    expect(dismissRelayBubble()).toBe(false)
    expect(panel.result.current.selected).toBe(0)
    unmount()
  })
})
