// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { DRAFT_ANTS, DRAFT_ANTS_STEP, DRAFT_ANTS_TICK_MS, marchDraftAnts } from './draftAnts'

beforeEach(() => { vi.useFakeTimers() })
afterEach(() => { vi.useRealTimers() })

const pointer = (type: string, pointerId = 1) => Object.assign(new Event(type, { bubbles: true }), { pointerId })

describe('marchDraftAnts', () => {
  it('keeps the original pace of one frame per 60 ms with a third of the repaints', () => {
    const paint = vi.fn()
    const stop = marchDraftAnts(document.createElement('div'), paint)
    vi.advanceTimersByTime(60 * DRAFT_ANTS.length) // one full period at the original pace
    stop()
    expect(DRAFT_ANTS_TICK_MS / DRAFT_ANTS_STEP).toBe(60)
    expect(paint.mock.calls.length).toBeLessThanOrEqual(Math.ceil(DRAFT_ANTS.length / DRAFT_ANTS_STEP))
    expect(paint).toHaveBeenNthCalledWith(1, DRAFT_ANTS[3])
    expect(paint).toHaveBeenNthCalledWith(2, DRAFT_ANTS[6])
  })

  it('stands still while a pointer is down on the map and goes on from there', () => {
    const surface = document.createElement('div')
    const handle = surface.appendChild(document.createElement('button'))
    document.body.appendChild(surface)
    const paint = vi.fn()
    const stop = marchDraftAnts(surface, paint)
    vi.advanceTimersByTime(DRAFT_ANTS_TICK_MS)
    expect(paint).toHaveBeenCalledTimes(1)

    // a vertex handle in the hand – it sits inside the map and keeps the event to itself
    handle.addEventListener('pointerdown', (e) => e.stopPropagation())
    handle.dispatchEvent(pointer('pointerdown'))
    vi.advanceTimersByTime(DRAFT_ANTS_TICK_MS * 5)
    expect(paint).toHaveBeenCalledTimes(1)

    // released anywhere, also outside the map
    window.dispatchEvent(pointer('pointerup'))
    vi.advanceTimersByTime(DRAFT_ANTS_TICK_MS)
    expect(paint).toHaveBeenCalledTimes(2)
    expect(paint).toHaveBeenLastCalledWith(DRAFT_ANTS[6])
    stop()
    surface.remove()
  })

  it('waits for the last finger of a two-finger gesture', () => {
    const surface = document.createElement('div')
    const paint = vi.fn()
    const stop = marchDraftAnts(surface, paint)
    surface.dispatchEvent(pointer('pointerdown', 1))
    surface.dispatchEvent(pointer('pointerdown', 2))
    window.dispatchEvent(pointer('pointercancel', 1))
    vi.advanceTimersByTime(DRAFT_ANTS_TICK_MS)
    expect(paint).not.toHaveBeenCalled()
    window.dispatchEvent(pointer('pointerup', 2))
    vi.advanceTimersByTime(DRAFT_ANTS_TICK_MS)
    expect(paint).toHaveBeenCalledTimes(1)
    stop()
  })
})
