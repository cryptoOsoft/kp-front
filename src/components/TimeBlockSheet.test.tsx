// @vitest-environment jsdom
//
// The block's delete is the bin, never a ✕ (UX sweep F1, 20.10.2026): the sheet's close ✕ sits
// two rows above it, and a look-alike that erases somebody's attendance is one tired tap away
// from the one that only closes.
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { TimeBlockSheet } from './TimeBlockSheet'
import { appConfig } from '../config/appConfig'
import { ONE_SHOT_HOLD_MS } from '../lib/useOneShot'

afterEach(cleanup)

function renderSheet(onRemove: () => void, onClose: () => void) {
  render(
    <TimeBlockSheet
      title="Zeiten" subject="Müller Hans" sectionTitle="Zeiten" emptyLabel="keine" onClose={onClose}
      labels={{ from: 'von', to: 'bis', remove: 'Zeit löschen', fromStart: 'ab Beginn', reopen: 'noch da', flip: 'umschalten' }}
      blocks={[{ key: 'a', from: '19:12', to: '21:40', head: { label: 'beendet', tone: 'done' as const }, onRemove }]}
    />,
  )
}

// A one-time add (docs/ui-conventions.md · One-time actions): the button gives way to ✓ for a
// moment, so a double tap adds ONE block, and comes back for a deliberate second one.
describe('TimeBlockSheet · a guarded add', () => {
  it('takes one tap, shows ✓ in its place, and is back after the hold', () => {
    vi.useFakeTimers()
    try {
      const onAdd = vi.fn()
      render(
        <TimeBlockSheet
          title="Zeiten" subject="Müller Hans" sectionTitle="Zeiten" emptyLabel="keine" onClose={vi.fn()}
          labels={{ from: 'von', to: 'bis', remove: 'Zeit löschen', fromStart: 'ab Beginn', reopen: 'noch da', flip: 'umschalten' }}
          blocks={[]} addLabel="Schicht erstellen" onAdd={onAdd} addedLabel="Schicht erstellt"
        />,
      )
      const add = screen.getByRole('button', { name: 'Schicht erstellen' })
      fireEvent.click(add)
      fireEvent.click(add) // the same press arriving twice, before the re-render
      expect(onAdd).toHaveBeenCalledTimes(1)
      expect(screen.queryByRole('button', { name: 'Schicht erstellen' })).toBeNull()
      expect(screen.getByRole('status').textContent).toContain('Schicht erstellt')
      act(() => { vi.advanceTimersByTime(ONE_SHOT_HOLD_MS) })
      fireEvent.click(screen.getByRole('button', { name: 'Schicht erstellen' }))
      expect(onAdd).toHaveBeenCalledTimes(2)
    } finally {
      vi.useRealTimers()
    }
  })
})

describe('TimeBlockSheet · deleting a block', () => {
  it('is the bin, and a different control from the close ✕', () => {
    const onRemove = vi.fn()
    const onClose = vi.fn()
    renderSheet(onRemove, onClose)
    const bin = screen.getByRole('button', { name: 'Zeit löschen – Müller Hans' })
    expect(bin.querySelector('use')?.getAttribute('href')).toBe('#trash')
    const close = screen.getByRole('button', { name: appConfig.copy.closeDialog })
    expect(close).not.toBe(bin)

    fireEvent.click(close)
    expect(onRemove).not.toHaveBeenCalled()
    fireEvent.click(bin)
    expect(onRemove).toHaveBeenCalledTimes(1)
  })
})
