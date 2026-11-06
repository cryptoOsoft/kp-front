// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, renderHook, waitFor } from '@testing-library/react'
import { resetPresentationMarkers, setPresentationMarker } from '../lib/presentationMarker'

const api = vi.hoisted(() => ({
  pollPresentation: vi.fn(),
  startPresentation: vi.fn(),
  endPresentation: vi.fn(),
  sendPresentationSignal: vi.fn(async () => undefined),
}))
vi.mock('../lib/api/presentation', () => api)

import { usePresentation } from './usePresentation'

const running = {
  active: true, id: 'p1', seq: 1, started_at: '2026-11-06T08:00:00Z',
  presenter: { client: 'pc-other', name: 'Bastian', link: false }, participants: [], view: null, messages: [],
}

function mount(canPresent = false) {
  return renderHook(() => usePresentation({
    incidentId: 'inc-1', enabled: true, canPresent, isLink: false, mode: 'map', setMode: () => {},
    activePlanId: 'tafel', setActivePlanId: () => {}, mapRef: { current: null }, setPlanFocus: () => {},
  }))
}

describe('the presentation follow runs only while one is presented', () => {
  afterEach(() => { resetPresentationMarkers(); vi.clearAllMocks() })

  it('asks nothing while the workspace follow says none runs – and an editor may still start one', async () => {
    const h = mount(true)
    await act(async () => { await new Promise((r) => setTimeout(r, 2500)) }) // past the loop's first spacing
    expect(api.pollPresentation).not.toHaveBeenCalled()
    expect(h.result.current.available).toBe(false)
    expect(h.result.current.canStart).toBe(true)
    h.unmount()
  })

  it('starts at once when the marker names one, and lets go when it is gone', async () => {
    api.pollPresentation.mockImplementation(async () => running)
    const h = mount()
    act(() => setPresentationMarker('inc-1', 'p1'))
    await waitFor(() => expect(h.result.current.follow).toEqual({ kind: 'invited', id: 'p1' }), { timeout: 1000 })
    expect(h.result.current.available).toBe(true)

    act(() => setPresentationMarker('inc-1', null))
    expect(h.result.current.follow.kind).toBe('none')
    expect(h.result.current.available).toBe(false)
    const asked = api.pollPresentation.mock.calls.length
    await act(async () => { await new Promise((r) => setTimeout(r, 600)) })
    expect(api.pollPresentation.mock.calls.length).toBe(asked)
    h.unmount()
  })
})
