// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { AnrueckendBlock } from './AnrueckendBlock'
import { appConfig } from '../config/appConfig'
import { fillTemplate } from '../lib/format'
import { FIXTURE, ROSTER } from '../lib/diveraResponses.fixture'
import type { AttendanceState } from '../types'

afterEach(cleanup)

const mount = (over: Partial<Parameters<typeof AnrueckendBlock>[0]> = {}) => {
  const props = {
    incidentId: 'i1', people: ROSTER, attendance: {} as AttendanceState, canEdit: true,
    onMarkPresent: vi.fn(), initial: FIXTURE, ...over,
  }
  const view = render(<AnrueckendBlock {...props} />)
  return { props, ...view }
}

describe('«Anrückend» — the Divera answers above the crew list', () => {
  it('says the counts in one line: kommen · kommen nicht', () => {
    mount()
    const R = appConfig.copy.anrueckend
    const head = screen.getByRole('button', { expanded: true })
    expect(head.textContent).toContain(`${R.coming(4)} · ${R.notComing(2)}`)
  })

  it('shows names and yes / no only — no times, no status words, no notes', () => {
    mount()
    const row = screen.getByText('Keller Peter').closest('li')!
    expect(row.textContent).not.toMatch(/\d\d:\d\d|ca\.|Komme|min/)
  })

  it('counts «kommt nicht» in the head line and lists none of them', () => {
    mount()
    expect(screen.queryByText('Huber Lea')).toBeNull()
    expect(screen.getAllByRole('listitem')).toHaveLength(3)
  })

  it('checks somebody in only on the explicit «da» tap', () => {
    const { props } = mount()
    expect(props.onMarkPresent).not.toHaveBeenCalled()
    const R = appConfig.copy.anrueckend
    fireEvent.click(screen.getByRole('button', { name: fillTemplate(R.checkInLabel, { name: 'Keller Peter' }) }))
    expect(props.onMarkPresent).toHaveBeenCalledWith(expect.objectContaining({ displayName: 'Keller Peter' }))
  })

  it('offers no «da» to a session that may not write', () => {
    mount({ canEdit: false })
    expect(screen.queryByRole('button', { name: /als anwesend erfassen/ })).toBeNull()
    expect(screen.getByText('Keller Peter')).toBeTruthy()
  })

  it('renders nothing at all when the Einsatz has no Divera answers', () => {
    const { container } = mount({ initial: { available: false } })
    expect(container.innerHTML).toBe('')
  })

  it('folds away on its head and names the unmapped answer', () => {
    mount()
    const R = appConfig.copy.anrueckend
    expect(screen.getByText((t) => t.includes(R.unmapped(1)))).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { expanded: true }))
    expect(screen.queryByText('Keller Peter')).toBeNull()
  })
})
