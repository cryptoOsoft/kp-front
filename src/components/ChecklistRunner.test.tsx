// @vitest-environment jsdom
import { describe, it, expect, afterEach, vi } from 'vitest'
import { render, cleanup, fireEvent, within } from '@testing-library/react'
import { ChecklistRunner } from './ChecklistRunner'
import type { ChecklistTemplate } from '../lib/checklists'

afterEach(cleanup)

// 30.09.2026 (owner): «n/m erledigt», no «%» beside it. 05.10.2026 (owner): no progress bar
// either, «occupies too much space» — not in the head, not under a phase. The phases keep n/m.
const template = {
  id: 'fu-aktion', kind: 'action', title: 'Aufgaben FU', subtitle: 'Aktions-Checkliste Führungsunterstützung',
  phases: [
    { id: 'a', title: 'Auf Anfahrt', items: [{ id: 'a1', text: 'Objektplan bereitlegen' }, { id: 'a2', text: 'Journal vorbereiten' }] },
    { id: 'b', title: 'Vor Ort', items: [{ id: 'b1', text: 'Absprache mit Einsatzleitung' }, { id: 'b2', text: 'Standort bestimmen' }] },
  ],
} as unknown as ChecklistTemplate

describe('ChecklistRunner head', () => {
  it('says the progress as «n/m erledigt», without a bar or a percentage', () => {
    const { container } = render(
      <ChecklistRunner template={template} state={{ ticks: { a1: { t: '2026-09-30T21:14:00.000Z' } } }} canTick
        onToggle={() => {}} onBranch={() => {}} onAction={() => {}} />,
    )
    const head = container.querySelector('header')!
    expect(head.textContent).toContain('1/4 erledigt')
    expect(head.textContent).not.toMatch(/\d\s*%/)
    expect(container.querySelector('[class*="cl-bar"]')).toBeNull()
    expect(container.textContent).toContain('1/2')
    // the subtitle is whole — the ladder folds it away as a unit, never cuts it
    expect(head.querySelector('p')?.textContent).toBe('Aktions-Checkliste Führungsunterstützung')
  })
})

// owner pick 7A, 05.11.2026: on a `problems` list a tick is «ist ein Problem»; only then the Tendenz
describe('ChecklistRunner · a problems list', () => {
  const problems = {
    id: 'pe', kind: 'action', problems: true, title: 'Problemerfassung',
    phases: [{ id: 'front', title: 'Front', area: 'front', items: [{ id: 'f1', text: 'Energieträger' }, { id: 'f2', text: 'Brand' }] }],
  } as unknown as ChecklistTemplate

  it('a ticked item says where it stands and offers ➚ = ➘; the picked one again clears it', () => {
    const onTrend = vi.fn()
    const { getByRole, queryByRole, getByText } = render(
      <ChecklistRunner template={problems} state={{ ticks: { f1: { t: '2026-11-05T14:14:00.000Z', trend: 'same' } } }} canTick problemsOnTafel
        onToggle={() => {}} onBranch={() => {}} onAction={() => {}} onTrend={onTrend} />,
    )
    expect(queryByRole('group', { name: 'Tendenz von «Brand»' })).toBeNull() // not a problem: no trend
    const seg = getByRole('group', { name: 'Tendenz von «Energieträger»' })
    expect(getByText('auf der Tafel')).toBeTruthy()
    fireEvent.click(within(seg).getByRole('button', { name: 'wird schlimmer' }))
    fireEvent.click(within(seg).getByRole('button', { name: 'gleich' }))
    expect(onTrend.mock.calls.map(([item, t]) => [item.id, t])).toEqual([['f1', 'up'], ['f1', undefined]])
  })
})
