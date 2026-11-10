// @vitest-environment jsdom
import { act, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const listIncidentsShared = vi.fn()
vi.mock('./incidents', () => ({ listIncidentsShared: () => listIncidentsShared() }))

import type { IncidentMeta } from './incidents'
import { useIncidentWatch } from './useIncidentWatch'
import { WATCH_POLL_MS } from './useResumingPoll'

const NOW = Date.parse('2026-11-09T03:00:00Z')
const alarm = (id: string) =>
  ({ id, source: 'divera', is_archived: false, started_at: new Date(NOW - 60_000).toISOString() }) as IncidentMeta
const answer = (...ids: string[]) => ({ list: ids.map(alarm), offline: false })

beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(NOW); localStorage.clear() })
afterEach(() => { vi.useRealTimers(); listIncidentsShared.mockReset() })

describe('useIncidentWatch', () => {
  // 09.11.2026: `activeId` was a dependency of the round, so every Einsatz open or switch
  // rebuilt the poll, and a rebuilt poll starts with a request of its own.
  it('does not ask again when an Einsatz is opened or switched', async () => {
    listIncidentsShared.mockResolvedValue(answer('a'))
    const onList = vi.fn()
    const closed: { activeId: string | null } = { activeId: null }
    const { rerender } = renderHook(({ activeId }) => useIncidentWatch(true, activeId, onList), { initialProps: closed })
    await act(async () => {})
    expect(listIncidentsShared).toHaveBeenCalledTimes(1)

    rerender({ activeId: 'a' })
    await act(async () => {})
    rerender({ activeId: 'b' })
    await act(async () => {})
    expect(listIncidentsShared).toHaveBeenCalledTimes(1)

    // the cadence is untouched
    await act(async () => { vi.advanceTimersByTime(WATCH_POLL_MS) })
    expect(listIncidentsShared).toHaveBeenCalledTimes(2)
  })

  it('still judges an arrival against the Einsatz that is open NOW', async () => {
    listIncidentsShared.mockResolvedValue(answer('a'))
    const { result, rerender } = renderHook(({ activeId }) => useIncidentWatch(true, activeId, () => {}), {
      initialProps: { activeId: 'a' },
    })
    await act(async () => {}) // baseline: a

    // the operator switches to «b» just as it arrives in the list: nothing to announce
    listIncidentsShared.mockResolvedValue(answer('a', 'b'))
    rerender({ activeId: 'b' })
    await act(async () => { vi.advanceTimersByTime(WATCH_POLL_MS) })
    expect(result.current.fresh).toBeNull()

    // «c» arrives while «b» is open: announced
    listIncidentsShared.mockResolvedValue(answer('a', 'b', 'c'))
    await act(async () => { vi.advanceTimersByTime(WATCH_POLL_MS) })
    expect(result.current.fresh?.id).toBe('c')
  })
})
