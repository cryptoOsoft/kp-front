// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, renderHook } from '@testing-library/react'
import type { Entity } from '../../types'
import { TICK_MS, useTutorial, type TutorialInput } from './useTutorial'
import { getTutorialSession, setTutorialSession, startTutorial } from './session'
import { loadProgress, resumeStep } from './progress'
import { tutorialEvent } from './bus'
import { appConfig } from '../../config/appConfig'

// The runner: binds a started tutorial to the open Einsatz, sees a step done, stands the ✓ for
// TICK_MS, moves on by itself, writes the progress – and resumes where a reload left it.

const toast = vi.hoisted(() => vi.fn())
vi.mock('../ui', async (orig) => ({ ...(await orig<typeof import('../ui')>()), toast }))
// the door is SANDBOX's (Round 1: a stub that throws) – here it always refuses, so the run stays
// on the open Übung
vi.mock('./sandbox', () => ({
  openLernUebung: vi.fn(async () => { throw new Error('no door') }),
  renameLernUebung: vi.fn(async () => {}),
  deleteLernUebung: vi.fn(async () => {}),
}))
// a station, not the public demo – there the door's 403 is the normal case
vi.mock('../deploymentConfig', async (orig) => ({ ...(await orig<typeof import('../deploymentConfig')>()), isDemoMode: () => false }))

const tlf = { id: 'e-tlf', kind: 'symbol', layer: 'tactical', coord: [7.6, 47.5], symbol: 'VKF TLF' } as Entity
const input = (over: Partial<TutorialInput> = {}): TutorialInput => ({
  incident: { id: 'inc-1', title: 'Lernen · Karte', isExercise: true },
  enabled: true, entities: [], drawings: [], trupps: [], journalRows: 0, present: 0,
  mode: 'map', tool: 'select', palette: false, phone: false, setMode: vi.fn(),
  ...over,
})
/** let the door's rejection and the bind land */
const flush = () => act(async () => { await Promise.resolve(); await Promise.resolve() })

beforeEach(() => {
  vi.useFakeTimers()
  localStorage.clear(); sessionStorage.clear()
  setTutorialSession(null)
  toast.mockClear()
})
// every mounted runner is a workspace on screen – one left over would end the next test's run
afterEach(() => { cleanup(); vi.useRealTimers() })

describe('useTutorial', () => {
  it('binds to the open Übung when the door fails, then steps on by itself after the ✓', async () => {
    startTutorial('lageZeichnen')
    const props = input()
    const { result, rerender } = renderHook((p: TutorialInput) => useTutorial(p), { initialProps: props })
    await flush()
    expect(toast).toHaveBeenCalledWith(appConfig.copy.tutorialRun.sandboxFailed, expect.anything())
    expect(getTutorialSession()?.host).toBe('inc-1')
    expect(props.setMode).toHaveBeenCalledWith('map')
    expect(result.current?.phase).toBe('step')
    expect(result.current?.step).toBe(0)

    // the learner places a TLF: one frame later the ✓ stands, the progress already says step 2
    rerender({ ...props, entities: [tlf] })
    act(() => { vi.advanceTimersByTime(20) })
    expect(result.current?.phase).toBe('tick')
    expect(resumeStep(loadProgress(), 'lageZeichnen')).toBe(1)

    // …and after the ✓ the next step comes without a tap
    act(() => { vi.advanceTimersByTime(TICK_MS) })
    expect(result.current?.phase).toBe('step')
    expect(result.current?.step).toBe(1)
  })

  it('never practises on a real Einsatz when the door fails', async () => {
    startTutorial('lageZeichnen')
    const { result } = renderHook(() => useTutorial(input({ incident: { id: 'real', title: 'Brand', isExercise: false } })))
    await flush()
    expect(toast).toHaveBeenCalledWith(appConfig.copy.tutorialRun.sandboxRefused, expect.anything())
    expect(getTutorialSession()).toBeNull()
    expect(result.current).toBeNull()
  })

  it('resumes on the step a reload left: the session comes back from sessionStorage', async () => {
    startTutorial('lageZeichnen', { step: 2 })
    renderHook(() => useTutorial(input()))
    await flush()
    const saved = getTutorialSession()
    expect(saved?.step).toBe(2)
    // a reload: the module starts over and reads the tab's copy
    vi.resetModules()
    const fresh = await import('./session')
    expect(fresh.getTutorialSession()).toEqual(saved)
  })

  it('a different Einsatz opening ends the run silently – the progress keeps the step', async () => {
    startTutorial('lageZeichnen', { step: 3 })
    const { unmount } = renderHook(() => useTutorial(input()))
    await flush()
    unmount()
    renderHook(() => useTutorial(input({ incident: { id: 'other', title: 'Brand', isExercise: false } })))
    await flush()
    expect(getTutorialSession()).toBeNull()
    expect(resumeStep(loadProgress(), 'lageZeichnen')).toBe(3)
    expect(toast).toHaveBeenCalledTimes(1) // the bind's «geübt wird auf dieser Übung», nothing for the end
  })

  it('↶ then ↷ on the bus finishes the undo step; «Weiter» the manual one; then the end', async () => {
    startTutorial('lageZeichnen', { step: 5 })
    const { result } = renderHook(() => useTutorial(input()))
    await flush()
    act(() => { tutorialEvent('undo') })
    act(() => { vi.advanceTimersByTime(20) })
    expect(result.current?.phase).toBe('step')
    expect(result.current?.anchors).toEqual(['top.redo'])
    act(() => { tutorialEvent('redo') })
    act(() => { vi.advanceTimersByTime(20) })
    expect(result.current?.phase).toBe('tick')
    act(() => { vi.advanceTimersByTime(TICK_MS) })
    expect(result.current?.step).toBe(6)
    act(() => { result.current?.confirm() })
    expect(result.current?.phase).toBe('end')
    expect(loadProgress().lageZeichnen?.doneAt).toBeTruthy()
    // no Lern-Übung on this run: nothing to delete, the card only closes
    expect(result.current?.lern).toBeNull()
  })

  it('«Überspringen» moves on at once and the done card does not tick it', async () => {
    startTutorial('lageZeichnen')
    const { result } = renderHook(() => useTutorial(input()))
    await flush()
    act(() => { result.current?.skip() })
    expect(result.current?.step).toBe(1)
    expect(result.current?.skipped).toEqual([0])
  })

  it('nothing runs in a link session', async () => {
    startTutorial('lageZeichnen')
    const { result } = renderHook(() => useTutorial(input({ enabled: false })))
    await flush()
    expect(result.current).toBeNull()
    expect(getTutorialSession()?.host).toBeUndefined()
  })
})
