// @vitest-environment jsdom
// The Gebäude card's first open (owner, 10.10.2026): once per device per Einsatz per building,
// for every building with something to show (sweep 30.10.2026 #6), never under the opening cover,
// again for a new building.
import 'fake-indexeddb/auto'
import { IDBFactory } from 'fake-indexeddb'
import { act, renderHook, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { BOOT_COVER_FADE_MS, useBootCover } from './bootCover'
import { __resetIdbForTests, idbGet } from './idb'
import type { BuildingInfo } from './api/building'
import {
  buildingReadKey, loadReadBuildings, markBuildingRead, resetBuildingReadMemory,
  shouldAutoOpenBuilding, useBuildingFirstOpen,
} from './buildingFirstOpen'

beforeEach(() => {
  globalThis.indexedDB = new IDBFactory()
  __resetIdbForTests()
  resetBuildingReadMemory()
})

const calm: BuildingInfo = {
  registers: 'on', egid: '401344', address: 'Schlossgasse 9, 4103 Bottmingen',
  gwr: { stand: '2026-10-08', floors: 3, flats: 2, year: 1650, period: null, heating: ['district'], heating_date: null, hot_water: [], shelter: true, status: null },
  gwr_status: 'ok', plants: [], pv_status: 'ok', registers_fetched_at: null,
  object: null, visit: { id: 'v', visited_at: '2026-05-12', findings: 0 },
  where: 'schlossgasse 9|47.50000|7.56000',
}
const gas: BuildingInfo = { ...calm, gwr: { ...calm.gwr!, heating: ['gas'] } }
const measures: BuildingInfo = {
  ...calm,
  object: { id: 'o1', name: 'Schloss', address_match: true, distance_m: 0, measures: 'Gashauptschieber schliessen', remarks: null, measures_source: 'Modul 1', updated_at: null },
}
/** no register answer, no Objekt, no visit: nothing to show, no chip, no card */
const empty: BuildingInfo = { ...calm, gwr: null, gwr_status: 'error', visit: null }

describe('which building', () => {
  it('a building is the Einsatzort it was asked for plus its Objekt', () => {
    expect(buildingReadKey(gas)).toBe(buildingReadKey({ ...gas, gwr: { ...gas.gwr!, floors: 4 } }))
    expect(buildingReadKey(gas)).not.toBe(buildingReadKey({ ...gas, where: 'hauptstrasse 1|47.4|7.5' }))
    expect(buildingReadKey(measures)).not.toBe(buildingReadKey({ ...measures, object: { ...measures.object!, id: 'o2' } }))
  })
})

describe('shouldAutoOpenBuilding', () => {
  it('opens only when eligible, the flag is read, and this building is unread', () => {
    expect(shouldAutoOpenBuilding({ info: gas, read: [], eligible: true })).toBe(true)
    expect(shouldAutoOpenBuilding({ info: gas, read: [], eligible: false })).toBe(false) // cover, replay, closed …
    expect(shouldAutoOpenBuilding({ info: gas, read: null, eligible: true })).toBe(false) // flag not read yet
    expect(shouldAutoOpenBuilding({ info: gas, read: [buildingReadKey(gas)], eligible: true })).toBe(false)
    expect(shouldAutoOpenBuilding({ info: null, read: [], eligible: true })).toBe(false)
  })
  // sweep 30.10.2026 #6: not only a hazard or notes – Geschosse, Baujahr, a visit open it too
  it('opens for a building with register facts alone; never for one with nothing to show', () => {
    expect(shouldAutoOpenBuilding({ info: calm, read: [], eligible: true })).toBe(true)
    expect(shouldAutoOpenBuilding({ info: calm, read: [buildingReadKey(calm)], eligible: true })).toBe(false)
    expect(shouldAutoOpenBuilding({ info: empty, read: [], eligible: true })).toBe(false)
  })
})

describe('the device flag (IndexedDB)', () => {
  it('survives a reload, per Einsatz', async () => {
    await markBuildingRead('inc-1', 'a#')
    await markBuildingRead('inc-1', 'b#o1')
    resetBuildingReadMemory() // a reload
    expect(await loadReadBuildings('inc-1')).toEqual(['a#', 'b#o1'])
    expect(await loadReadBuildings('inc-2')).toEqual([])
    expect(await idbGet('kp-front-building-read:inc-1')).toEqual(['a#', 'b#o1'])
  })
  it('a close before the first read never writes over what was read on an earlier day', async () => {
    await markBuildingRead('inc-1', 'old#')
    resetBuildingReadMemory()
    expect(await markBuildingRead('inc-1', 'new#')).toEqual(['old#', 'new#'])
  })
  it('a store that cannot answer reads as «none read»; the session still remembers', async () => {
    const broken = async () => ({ ok: false as const, error: new Error('x') })
    expect(await loadReadBuildings('inc-1', broken)).toEqual([])
    await markBuildingRead('inc-1', 'a#', async () => false, broken)
    expect(await loadReadBuildings('inc-1', broken)).toEqual(['a#'])
  })
})

describe('useBuildingFirstOpen', () => {
  const run = (initial: { info: BuildingInfo | null; eligible: boolean; id?: string }) =>
    renderHook((p: { info: BuildingInfo | null; eligible: boolean; id?: string }) => useBuildingFirstOpen(p.id ?? 'inc-1', p.info, p.eligible), { initialProps: initial })

  it('waits for the opening cover, opens once, and a close marks it read across a reload', async () => {
    const h = run({ info: gas, eligible: false }) // under the snail
    await act(async () => { await Promise.resolve() })
    expect(h.result.current.autoOpen).toBe(false)
    h.rerender({ info: gas, eligible: true }) // the cover lifted
    await waitFor(() => expect(h.result.current.autoOpen).toBe(true))
    act(() => h.result.current.markRead())
    expect(h.result.current.autoOpen).toBe(false)
    await waitFor(async () => expect(await idbGet('kp-front-building-read:inc-1')).toEqual([buildingReadKey(gas)]))
    h.unmount()
    resetBuildingReadMemory() // the next open of the same Einsatz on this device
    const again = run({ info: gas, eligible: true })
    await act(async () => { await new Promise((r) => setTimeout(r, 20)) })
    expect(again.result.current.autoOpen).toBe(false)
    // …another Einsatz with the same building is its own
    const other = run({ info: gas, eligible: true, id: 'inc-2' })
    await waitFor(() => expect(other.result.current.autoOpen).toBe(true))
  })

  it('left open (not closed), it comes back the next time', async () => {
    const h = run({ info: measures, eligible: true })
    await waitFor(() => expect(h.result.current.autoOpen).toBe(true))
    h.unmount()
    resetBuildingReadMemory()
    const again = run({ info: measures, eligible: true })
    await waitFor(() => expect(again.result.current.autoOpen).toBe(true))
  })

  it('data that arrives later opens it when it arrives — and only with something to show', async () => {
    const h = run({ info: null, eligible: true })
    await act(async () => { await Promise.resolve() })
    expect(h.result.current.autoOpen).toBe(false)
    h.rerender({ info: empty, eligible: true })
    expect(h.result.current.autoOpen).toBe(false)
    h.rerender({ info: gas, eligible: true })
    await waitFor(() => expect(h.result.current.autoOpen).toBe(true))
  })

  it('the Einsatzort changes to a building with content: shown once again', async () => {
    const h = run({ info: gas, eligible: true })
    await waitFor(() => expect(h.result.current.autoOpen).toBe(true))
    act(() => h.result.current.markRead())
    expect(h.result.current.autoOpen).toBe(false)
    const moved = { ...measures, where: 'hauptstrasse 1|47.40000|7.50000' }
    h.rerender({ info: moved, eligible: true })
    expect(h.result.current.autoOpen).toBe(true)
    act(() => h.result.current.markRead())
    // …and back to the first one, already read
    h.rerender({ info: gas, eligible: true })
    expect(h.result.current.autoOpen).toBe(false)
  })
})

describe('never under the opening cover (lib/bootCover)', () => {
  it('opens only once the snail has faded out — not while it is on, not while it leaves', async () => {
    const h = renderHook((p: { ready: boolean }) => {
      const phase = useBootCover(true, p.ready)
      return { phase, ...useBuildingFirstOpen('inc-1', gas, phase === 'off') }
    }, { initialProps: { ready: false } })
    await waitFor(() => expect(h.result.current.phase).toBe('on'))
    await act(async () => { await new Promise((r) => setTimeout(r, 20)) }) // the flag has been read
    expect(h.result.current.autoOpen).toBe(false)
    vi.useFakeTimers()
    try {
      h.rerender({ ready: true })
      expect(h.result.current.phase).toBe('leaving')
      expect(h.result.current.autoOpen).toBe(false)
      act(() => { vi.advanceTimersByTime(BOOT_COVER_FADE_MS) })
      expect(h.result.current.phase).toBe('off')
      expect(h.result.current.autoOpen).toBe(true)
    } finally { vi.useRealTimers() }
  })
})
