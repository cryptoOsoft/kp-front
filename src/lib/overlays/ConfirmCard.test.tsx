// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, cleanup, waitFor } from '@testing-library/react'
import { ConfirmCard } from './ConfirmCard'

afterEach(cleanup)

const ask = { title: 'Abmelden?', message: 'Danach …', confirmLabel: 'Abmelden', cancelLabel: 'Abbrechen' }

describe('ConfirmCard · initial focus', () => {
  // a keyboard cover's Enter pressed «to get the dialog away» must not confirm a destructive ask
  it('focuses «Abbrechen» first on a danger ask', async () => {
    render(<ConfirmCard open {...ask} danger onResolve={vi.fn()} />)
    await waitFor(() => expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Abbrechen' })))
  })

  it('focuses the confirm on an ordinary ask — the operator came here to do it', async () => {
    render(<ConfirmCard open {...ask} onResolve={vi.fn()} />)
    await waitFor(() => expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Abmelden' })))
  })
})

// the double-contact question: «OK» (writes nothing) is the one a reflex presses (25.09.2026)
describe('ConfirmCard · safeAnswer', () => {
  const echo = { message: 'T1: Kontakt wurde vor 21 s schon bestätigt.', confirmLabel: 'Nochmals', cancelLabel: 'OK' }

  it('makes the safe answer the filled, focused, right-hand button and the confirm the quiet one', async () => {
    render(<ConfirmCard open {...echo} safeAnswer="cancel" onResolve={vi.fn()} />)
    const ok = screen.getByRole('button', { name: 'OK' })
    const again = screen.getByRole('button', { name: 'Nochmals' })
    await waitFor(() => expect(document.activeElement).toBe(ok))
    expect(ok.className).toContain('primary')
    expect(again.className).not.toContain('primary')
    const order = Array.from(document.querySelectorAll('.confirm-actions button')).map((b) => b.textContent)
    expect(order).toEqual(['Nochmals', 'OK'])
  })

  it('still answers true for the confirm and false for the safe answer', () => {
    const onResolve = vi.fn()
    render(<ConfirmCard open {...echo} safeAnswer="cancel" onResolve={onResolve} />)
    screen.getByRole('button', { name: 'OK' }).click()
    expect(onResolve).toHaveBeenLastCalledWith(false)
    screen.getByRole('button', { name: 'Nochmals' }).click()
    expect(onResolve).toHaveBeenLastCalledWith(true)
  })
})

describe('ConfirmCard · safeAnswer on the alternative', () => {
  it('focuses and fills the alternative, and the confirm goes quiet', async () => {
    render(<ConfirmCard open message="1 Trupp noch angemeldet." confirmLabel="Schliessen" cancelLabel="Abbrechen"
      altLabel="Zur Tafel" safeAnswer="alt" onResolve={vi.fn()} />)
    const alt = screen.getByRole('button', { name: 'Zur Tafel' })
    await waitFor(() => expect(document.activeElement).toBe(alt))
    expect(alt.className).toContain('primary')
    expect(screen.getByRole('button', { name: 'Schliessen' }).className).not.toContain('primary')
  })

  // owner pick «Trupps noch drin» mock 4 (06.11.2026): one order on every device, the safe answer
  // last – on its own full-width row (08-toasts · .confirm-card-safe); the crews one per line
  it('stands Abbrechen · confirm · safe answer, and names each item on its own line', () => {
    render(<ConfirmCard open message="2 Trupps sind noch drin:" confirmLabel="Trotzdem abschliessen" cancelLabel="Abbrechen"
      altLabel="Zur Tafel" safeAnswer="alt" onResolve={vi.fn()}
      items={[{ head: 'Trupp 4', text: 'Weber Fabian / Moser Simon' }, { text: 'Frei Nora' }]} />)
    expect(document.querySelector('.confirm-card')?.classList.contains('confirm-card-safe')).toBe(true)
    const order = Array.from(document.querySelectorAll('.confirm-actions button')).map((b) => b.textContent)
    expect(order).toEqual(['Abbrechen', 'Trotzdem abschliessen', 'Zur Tafel'])
    const lines = Array.from(document.querySelectorAll('.confirm-line'))
    expect(lines.map((l) => l.textContent)).toEqual(['Trupp 4 – Weber Fabian / Moser Simon', 'Frei Nora'])
    expect(lines[0].querySelector('b')?.textContent).toBe('Trupp 4')
  })
})

describe('ConfirmCard · open-point rows', () => {
  it('a done row shows its read-out and a check, no chevron', () => {
    render(<ConfirmCard open {...ask} items={[{ label: 'Einsatzende', end: 'jetzt 23:41', done: true, onClick: vi.fn() }]} onResolve={vi.fn()} />)
    expect(screen.getByText('jetzt 23:41')).toBeTruthy()
    expect(document.querySelector('.confirm-list-done')).toBeTruthy()
    expect(document.querySelector('.confirm-list-chev')).toBeNull()
  })
})
