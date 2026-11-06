import { describe, expect, it, vi } from 'vitest'
import type { SetStateAction } from 'react'
import { useShiftActions } from './useShiftActions'
import type { Person, Shift } from '../types'

vi.mock('./ui', () => ({ undoToast: vi.fn() }))
import { undoToast } from './ui'

// «Schicht erstellen» is a one-time action (05.11.2026: a double tap planned two identical
// shifts): the sheet latches its button (TimeBlockSheet · addedLabel), and the shift a tap made
// is one «Rückgängig» from gone – the toast the grid sweep already had.
describe('useShiftActions · addShift', () => {
  it('plans one shift and offers it back through the undo toast', () => {
    let shifts: Shift[] = []
    const setShifts = (u: SetStateAction<Shift[]>) => { shifts = typeof u === 'function' ? u(shifts) : u }
    const { addShift } = useShiftActions({ shifts, setShifts, startedAt: null })
    addShift({ id: 'p1', displayName: 'Meier Anna' } as Person)
    expect(shifts).toHaveLength(1)
    expect(undoToast).toHaveBeenCalledTimes(1)
    const [text, undo] = vi.mocked(undoToast).mock.calls[0]
    expect(text).toContain('Meier Anna')
    undo()
    expect(shifts).toHaveLength(0)
  })
})
