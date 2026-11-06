// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, renderHook, waitFor } from '@testing-library/react'
import { checklistPick } from '../lib/checklistPick'
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

describe('a follower follows more than the map', () => {
  afterEach(() => { resetPresentationMarkers(); vi.clearAllMocks() })

  it('opens the presenter\'s Checkliste and Verlauf, and draws the presenter\'s line', async () => {
    const view = {
      mode: 'checklists', plan_id: null, page: null, map: null, plan: null, scroll: null, detail: null,
      checklist: { kind: 'tpl', id: 'fu' }, journal: true, journal_scroll: null,
    }
    const line = { id: 'st1', surface: 'map', plan_id: null, page: null, floor: null, anchor: null, points: [[7.5, 47.5], [7.51, 47.5]], done: false }
    let round = 0
    api.pollPresentation.mockImplementation(async () => {
      round += 1
      if (round === 1) return running
      await new Promise((r) => setTimeout(r, 50))
      return { ...running, seq: 2 + round, view, messages: [
        { seq: 2 + round, kind: 'view', view },
        { seq: 2 + round, kind: 'stroke', client: 'pc-other', name: 'Bastian', link: false, stroke: line },
      ] }
    })
    const setMode = vi.fn()
    const setJournalOpen = vi.fn()
    const h = renderHook(() => usePresentation({
      incidentId: 'inc-2', enabled: true, canPresent: false, isLink: false, mode: 'map', setMode,
      activePlanId: 'tafel', setActivePlanId: () => {}, mapRef: { current: null }, setPlanFocus: () => {},
      journalOpen: false, setJournalOpen,
    }))
    act(() => setPresentationMarker('inc-2', 'p1'))
    await waitFor(() => expect(h.result.current.follow.kind).toBe('invited'), { timeout: 1000 })
    act(() => h.result.current.followNow())
    await waitFor(() => expect(setMode).toHaveBeenCalledWith('checklists'), { timeout: 8000 })
    expect(checklistPick('inc-2')).toEqual({ kind: 'tpl', id: 'fu' })
    expect(setJournalOpen).toHaveBeenCalledWith(true)
    await waitFor(() => expect(h.result.current.mapStrokes.map((x) => x.line.points.length)).toEqual([2]))
    h.unmount()
  })
})
