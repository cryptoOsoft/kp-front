// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest'
import { clearStep, loadProgress, markDone, markStep, resumeFor } from './progress'

// The run a Lern-Übung opened again picks up (08.11.2026, owner: the tutorial showed no bubbles on
// a Lern-Übung reopened in a new tab or after a relaunch – the session lives per tab).

afterEach(() => localStorage.clear())

const lern = { id: 'lern-1', title: 'Lernen · Karte – die Lage zeichnen', source: 'training', exercise_since_creation: true }

describe('resumeFor', () => {
  it('picks this device\'s run on its step', () => {
    markStep('lageZeichnen', 3, { lern: 'lern-1' })
    expect(resumeFor(loadProgress(), lern)).toEqual({ id: 'lageZeichnen', step: 3 })
  })

  it('keeps the Übung binding while the run moves, and the pill\'s ✕ stops a restart unasked', () => {
    markStep('lageZeichnen', 0, { lern: 'lern-1' })
    markStep('lageZeichnen', 2)
    markStep('lageZeichnen', 2, { paused: true })
    expect(loadProgress().lageZeichnen).toEqual({ step: 2, lern: 'lern-1', paused: true })
    expect(resumeFor(loadProgress(), lern)).toBeNull()
    // «Fortsetzen» moves it again: no longer paused
    markStep('lageZeichnen', 2, { lern: 'lern-1' })
    expect(resumeFor(loadProgress(), lern)).toEqual({ id: 'lageZeichnen', step: 2 })
  })

  it('never restarts a run this device finished or ended', () => {
    markStep('lageZeichnen', 4, { lern: 'lern-1' })
    markDone('lageZeichnen')
    expect(resumeFor(loadProgress(), lern)).toBeNull()
    markStep('lageZeichnen', 1, { lern: 'lern-1' })
    clearStep('lageZeichnen')
    expect(resumeFor(loadProgress(), lern)).toBeNull()
  })

  it('starts a Lern-Übung\'s tutorial from the top on a device that knows nothing of it', () => {
    expect(resumeFor({}, lern)).toEqual({ id: 'lageZeichnen', step: 0 })
  })

  it('leaves every other Einsatz alone – a real one, a hand-made «Lernen ·» Übung', () => {
    expect(resumeFor({}, { ...lern, source: 'divera' })).toBeNull()
    expect(resumeFor({}, { ...lern, source: 'manual', exercise_since_creation: true })).toBeNull()
    expect(resumeFor({}, { ...lern, exercise_since_creation: false })).toBeNull()
    expect(resumeFor({}, { ...lern, title: 'Zimmerbrand Hauptstrasse' })).toBeNull()
  })
})
