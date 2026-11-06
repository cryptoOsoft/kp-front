// @vitest-environment jsdom
import { afterEach, describe, it, expect, vi } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import { TopBar, windArrowRotation } from './TopBar'
import { loadPrefs, savePrefs } from '../lib/prefs'
import type { Incident } from '../types'

afterEach(() => { cleanup(); savePrefs({ ...loadPrefs(), keyHints: undefined }) })

const INCIDENT: Incident = {
  type: 'Brand', title: 'Brand Hauptstrasse', address: 'Hauptstrasse 1', center: [7.55, 47.51],
  startedAt: '2026-11-06T10:00:00Z', durationSec: 0, offline: false, cachedTiles: 0, recording: false, recDurationSec: 0,
}
const bar = () => render(<TopBar incident={INCIDENT} recording={false} recStartedAt={null} journalOpen={false}
  onToggleJournal={vi.fn()} onAddEntry={vi.fn()} onUndo={vi.fn()} onRedo={vi.fn()} canUndo={false} canRedo={false} />)
const letters = () => [...document.querySelectorAll('.tb-act .tb-key')].map((el) => el.textContent)

// S6 (staging review 06.11.2026): Verlauf and Eintrag are listed with their keys like the rail tiles
describe('the top bar\'s shortcut letters', () => {
  it('Verlauf wears J and Eintrag E, and both tooltips name the key', () => {
    bar()
    expect(letters()).toEqual(['J', 'E'])
    expect(screen.getByRole('button', { name: /Verlauf/ }).title).toBe('Verlauf – Taste J')
    expect(screen.getByRole('button', { name: 'Eintrag' }).title).toMatch(/– Taste E$/)
  })

  it('follow the device pref «Tastenkürzel anzeigen»', () => {
    savePrefs({ ...loadPrefs(), keyHints: false })
    bar()
    expect(letters()).toEqual([])
  })
})

// The bar's own «Teilen» button was removed on 06.09. — the Einsatz-Karte's «Teilen» row
// (panels/IncidentSwitcher) is now the one door to the share sheet on every width.

// The wind arrow's one piece of maths, kept here since WindBadge (its old home) was deleted as
// dead code on 05.09. — it aims the arrow DOWNWIND, and it has to follow the map's rotation.
describe('windArrowRotation', () => {
  it('rotates by the FROM bearing on a north-up map (aims the arrow downwind)', () => {
    expect(windArrowRotation(225)).toBe(225)
    expect(windArrowRotation(0)).toBe(0)
  })

  it('follows the map rotation by subtracting the bearing (like the compass needle)', () => {
    // map rotated 90° clockwise → the same wind reads 90° less on screen
    expect(windArrowRotation(225, 90)).toBe(135)
    expect(windArrowRotation(45, 45)).toBe(0)
    expect(windArrowRotation(10, 40)).toBe(-30)
  })
})
