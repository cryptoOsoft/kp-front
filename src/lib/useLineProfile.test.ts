// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, renderHook } from '@testing-library/react'
import { useLineProfile } from './useLineProfile'
import { resetProfileCache } from './profile'
import type { LngLat } from '../types'

const PATH: LngLat[] = [[7.5, 47.5], [7.51, 47.51]]
// two swisstopo rows are the minimum a profile is built from
const rows = JSON.stringify([{ dist: 0, alts: { COMB: 400 } }, { dist: 100, alts: { COMB: 460 } }])

beforeEach(() => { vi.useFakeTimers(); resetProfileCache() })
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals() })

describe('useLineProfile', () => {
  it('makes no request while disabled — a tapped line stays offline-silent', async () => {
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    renderHook(() => useLineProfile(PATH, false))
    await act(async () => { await vi.advanceTimersByTimeAsync(2000) })
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('fetches once enabled and reports gain/loss', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(rows, { status: 200 }))
    vi.stubGlobal('fetch', fetchMock)
    const { result } = renderHook(() => useLineProfile(PATH, true))
    expect(result.current.loading).toBe(true)
    await act(async () => { await vi.advanceTimersByTimeAsync(600) })
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(result.current.profile?.gain).toBe(60)
    expect(result.current.loading).toBe(false)
  })

  it('does not re-fetch when the caller rebuilds an equal coords array each render', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(rows, { status: 200 }))
    vi.stubGlobal('fetch', fetchMock)
    // exactly what a `drawings.find(...)` caller does: same values, fresh array identity
    const { rerender } = renderHook(() => useLineProfile(PATH.map((c) => [...c] as LngLat), true))
    await act(async () => { await vi.advanceTimersByTimeAsync(600) })
    rerender(); rerender()
    await act(async () => { await vi.advanceTimersByTimeAsync(600) })
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  // the editor's Messung and the pumps a Leitung draws on the map ask for the same path
  it('a second consumer of a fetched path gets it at once, without a second request', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(rows, { status: 200 }))
    vi.stubGlobal('fetch', fetchMock)
    renderHook(() => useLineProfile(PATH, true))
    await act(async () => { await vi.advanceTimersByTimeAsync(600) })
    const second = renderHook(() => useLineProfile(PATH, true))
    await act(async () => { await vi.advanceTimersByTimeAsync(0) })
    expect(second.result.current.profile?.gain).toBe(60)
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('leaves the profile null when swisstopo has nothing (outside CH / offline)', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('offline')))
    const { result } = renderHook(() => useLineProfile(PATH, true))
    await act(async () => { await vi.advanceTimersByTimeAsync(600) })
    expect(result.current.profile).toBeNull()
    expect(result.current.loading).toBe(false)
  })
})
