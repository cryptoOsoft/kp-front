// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, renderHook, waitFor } from '@testing-library/react'

const listPersonnel = vi.fn()
vi.mock('./incidents', () => ({ listPersonnel: (...a: unknown[]) => listPersonnel(...a) }))
vi.mock('./idb', () => ({ idbGet: () => Promise.resolve(undefined), idbSet: () => Promise.resolve() }))

import { loadRoster, usePersonnel } from './usePersonnel'
import type { Person } from '../types'

const person = (id: string, updatedAt = 't0'): Person =>
  ({ id, displayName: id, active: true, updatedAt })

// shouldAdvanceTime: waitFor schedules its own timers, so a fully frozen clock deadlocks it
beforeEach(() => { listPersonnel.mockReset(); vi.useFakeTimers({ shouldAdvanceTime: true }) })
// this project does not auto-clean: without it every earlier test's hook stays mounted, its
// «online» listener still attached, and one dispatched event fires all of them
afterEach(() => { cleanup(); vi.useRealTimers() })

describe('usePersonnel — the roster keeps itself fresh', () => {
  it('refetches in the background and hands back the SAME array when nothing changed', async () => {
    // a fresh array identity every five minutes would re-render the whole Mannschaft grid for a
    // list that did not change — the shape of the bug that once cost the phone its battery
    listPersonnel.mockResolvedValue([person('a'), person('b')])
    const { result } = renderHook(() => usePersonnel())
    await waitFor(() => expect(result.current.loaded).toBe(true))
    const first = result.current.people
    expect(first).toHaveLength(2)

    await act(async () => { await vi.advanceTimersByTimeAsync(5 * 60_000) })
    expect(listPersonnel).toHaveBeenCalledTimes(2)
    expect(result.current.people).toBe(first) // identity preserved
  })

  it('takes a roster that HAS changed', async () => {
    listPersonnel.mockResolvedValueOnce([person('a')]).mockResolvedValueOnce([person('a'), person('b')])
    const { result } = renderHook(() => usePersonnel())
    await waitFor(() => expect(result.current.people).toHaveLength(1))
    await act(async () => { await vi.advanceTimersByTimeAsync(5 * 60_000) })
    await waitFor(() => expect(result.current.people).toHaveLength(2))
  })

  it('notices an edit to somebody who is already on the list', async () => {
    listPersonnel.mockResolvedValueOnce([person('a', 't0')]).mockResolvedValueOnce([person('a', 't1')])
    const { result } = renderHook(() => usePersonnel())
    await waitFor(() => expect(result.current.people[0].updatedAt).toBe('t0'))
    await act(async () => { await vi.advanceTimersByTimeAsync(5 * 60_000) })
    await waitFor(() => expect(result.current.people[0].updatedAt).toBe('t1'))
  })

  it('stays QUIET when a background refresh fails — the list we hold is still good', async () => {
    // a retry button appearing because one poll missed is the surface complaining about something
    // the operator cannot act on and does not need to
    listPersonnel.mockResolvedValueOnce([person('a')]).mockRejectedValueOnce(new Error('offline'))
    const { result } = renderHook(() => usePersonnel())
    await waitFor(() => expect(result.current.loaded).toBe(true))
    await act(async () => { await vi.advanceTimersByTimeAsync(5 * 60_000) })
    expect(result.current.error).toBe(false)
    expect(result.current.loading).toBe(false)
    expect(result.current.people).toHaveLength(1)
  })

  it('DOES report a failure on the initial load, which is the case with no list at all', async () => {
    listPersonnel.mockRejectedValue(new Error('offline'))
    const { result } = renderHook(() => usePersonnel())
    await waitFor(() => expect(result.current.error).toBe(true))
  })

  it('refetches on regaining the network, without waiting for the heartbeat', async () => {
    listPersonnel.mockResolvedValue([person('a')])
    const { result } = renderHook(() => usePersonnel())
    await waitFor(() => expect(result.current.loaded).toBe(true))
    await act(async () => { window.dispatchEvent(new Event('online')); await Promise.resolve() })
    expect(listPersonnel).toHaveBeenCalledTimes(2)
  })
})

// 09.11.2026: every launch into an Einsatz asked for the roster twice, seconds apart – the
// launcher's warm-up (App · loadRoster) and this hook's initial load.
describe('usePersonnel — the initial load takes the warm-up answer', () => {
  it('sends no request of its own right after the warm-up', async () => {
    listPersonnel.mockResolvedValue([person('a'), person('b')])
    await loadRoster()
    const { result } = renderHook(() => usePersonnel())
    await waitFor(() => expect(result.current.loaded).toBe(true))
    expect(result.current.people).toHaveLength(2)
    expect(listPersonnel).toHaveBeenCalledTimes(1)
  })

  it('asks itself once the warm-up is old', async () => {
    listPersonnel.mockResolvedValue([person('a')])
    await loadRoster()
    await vi.advanceTimersByTimeAsync(30_000)
    const { result } = renderHook(() => usePersonnel())
    await waitFor(() => expect(result.current.loaded).toBe(true))
    expect(listPersonnel).toHaveBeenCalledTimes(2)
  })

  it('asks itself when the warm-up failed', async () => {
    listPersonnel.mockRejectedValueOnce(new TypeError('Failed to fetch'))
    await loadRoster().catch(() => {})
    listPersonnel.mockResolvedValue([person('a')])
    const { result } = renderHook(() => usePersonnel())
    await waitFor(() => expect(result.current.loaded).toBe(true))
    expect(result.current.error).toBe(false)
    expect(result.current.people).toHaveLength(1)
  })
})
