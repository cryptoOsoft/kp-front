// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { markDone, markStep } from '../../lib/tutorials/progress'
import { getTutorialSession, setTutorialSession } from '../../lib/tutorials/session'
import { offeredTutorials } from '../../lib/tutorials/offer'
import { UebenSheet } from './UebenSheet'

const editor = { role: 'editor' as const, linkScoped: false }
const withVisits = { objectVisits: true }

beforeEach(() => { localStorage.clear(); setTutorialSession(null) })
afterEach(cleanup)

describe('UebenSheet', () => {
  const rowOf = (id: string) => document.querySelector<HTMLElement>(`[data-tutorial="${id}"]`)!

  it('says ✓ for done, «Fortsetzen» with the step for an interrupted run, minutes otherwise', () => {
    markDone('lageZeichnen')
    markStep('planGebaeude', 2)
    render(<UebenSheet tutorials={offeredTutorials(editor, withVisits)} onClose={vi.fn()} />)
    expect(within(rowOf('lageZeichnen')).getByRole('img', { name: 'Erledigt' })).toBeTruthy()
    expect(rowOf('planGebaeude').textContent).toContain('Fortsetzen')
    expect(rowOf('planGebaeude').textContent).toContain('Unterbrochen · Schritt 3')
    expect(rowOf('trupps').textContent).toContain('6\u00A0Min.')
    expect(rowOf('trupps').textContent).toContain('Lern-Übung')
    expect(rowOf('zurechtfinden').textContent).toContain('offline')
    expect(screen.getByText('1 von 15 erledigt')).toBeTruthy()
  })

  it('shows the running tutorial’s step over the stored one', () => {
    markStep('trupps', 1)
    setTutorialSession({ id: 'trupps', step: 4 })
    render(<UebenSheet tutorials={offeredTutorials(editor, withVisits)} onClose={vi.fn()} />)
    expect(rowOf('trupps').textContent).toContain('Läuft · Schritt 5')
  })

  it('filters by chip and counts the done ones of what is shown', () => {
    markDone('trupps')
    render(<UebenSheet tutorials={offeredTutorials(editor, withVisits)} onClose={vi.fn()} />)
    fireEvent.click(within(screen.getByRole('group', { name: 'Nach Funktion filtern' })).getByRole('button', { name: /Atemschutz/ }))
    expect(document.querySelectorAll('[data-tutorial]')).toHaveLength(5)
    expect(rowOf('zurechtfinden')).toBeTruthy()
    expect(screen.getByText('1 von 5 erledigt')).toBeTruthy()
  })

  it('pins the interrupted run above the list, once, under every chip', () => {
    markStep('planGebaeude', 2)
    render(<UebenSheet tutorials={offeredTutorials(editor, withVisits)} onClose={vi.fn()} />)
    const group = screen.getByRole('region', { name: 'Alle' })
    expect(within(group).queryByText('Plan & Gebäude')).toBeNull()
    expect(document.querySelectorAll('[data-tutorial="planGebaeude"]')).toHaveLength(1)
    expect(document.querySelector('[data-tutorial]')).toBe(rowOf('planGebaeude'))
    expect(screen.getByText('0 von 15 erledigt')).toBeTruthy()
    // Plan & Gebäude is FU only – it stays pinned under «Einsatzleitung»
    fireEvent.click(within(screen.getByRole('group', { name: 'Nach Funktion filtern' })).getByRole('button', { name: /Einsatzleitung/ }))
    expect(rowOf('planGebaeude').textContent).toContain('Fortsetzen')
    expect(screen.getByText('0 von 9 erledigt')).toBeTruthy()
  })

  it('pins nothing without a run to finish', () => {
    render(<UebenSheet tutorials={offeredTutorials(editor, withVisits)} onClose={vi.fn()} />)
    expect(document.querySelector('[data-tutorial]')).toBe(rowOf('zurechtfinden'))
    expect(document.querySelectorAll('[data-tutorial]')).toHaveLength(15)
  })

  it('draws no chip row when only «Alle» has anything (a viewer)', () => {
    render(<UebenSheet tutorials={offeredTutorials({ role: 'viewer', linkScoped: false }, withVisits)} onClose={vi.fn()} />)
    expect(screen.queryByRole('group', { name: 'Nach Funktion filtern' })).toBeNull()
  })

  it('starts the tutorial at its resume point and closes', () => {
    markStep('planGebaeude', 2)
    const onClose = vi.fn()
    render(<UebenSheet tutorials={offeredTutorials(editor, withVisits)} onClose={onClose} />)
    fireEvent.click(rowOf('planGebaeude'))
    expect(getTutorialSession()).toMatchObject({ id: 'planGebaeude', step: 2 })
    expect(onClose).toHaveBeenCalled()
    fireEvent.click(rowOf('verlauf'))
    expect(getTutorialSession()).toMatchObject({ id: 'verlauf', step: 0 })
  })
})
