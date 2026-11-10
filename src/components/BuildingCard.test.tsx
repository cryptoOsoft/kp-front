// @vitest-environment jsdom
// The Gebäude card (KP Front F5): a hazard is the warn glyph AND its word, the Modul-1 notes are
// text, «Register-Hinweis» opens on a tap, and a card with nothing to say is not drawn at all.

import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { BuildingCard } from './BuildingCard'
import type { BuildingInfo } from '../lib/api/building'

afterEach(cleanup)

const base: BuildingInfo = {
  registers: 'on', egid: '408319', address: 'Hauptstrasse 10, 4104 Oberwil',
  gwr: { stand: '2026-10-07', floors: 2, flats: 2, year: 1926, period: null, heating: ['gas'], heating_date: '2022-06-29', hot_water: [], shelter: null, status: null },
  gwr_status: 'ok', plants: [], pv_status: 'ok', registers_fetched_at: null, object: null, visit: null,
}

describe('BuildingCard', () => {
  it('a hazard carries the warn glyph beside its word', () => {
    render(<BuildingCard info={base} />)
    const gas = screen.getByText('Heizung Gas').closest('li')!
    expect(gas.querySelector('use')?.getAttribute('href')).toBe('#warn')
    expect(screen.getByText('2 Geschosse').closest('li')!.querySelector('use')).toBeNull()
    expect(screen.getByText('Register-Hinweis')).toBeTruthy()
  })

  // owner, 27.10.2026: «convert this to bullet points instead of the tags» – the hazard line first
  // owner, 27.10.2026: «a clear two-step thing: first "Sofortmassnahmen" then "Gebäude"»
  it('reads Sofortmassnahmen, then Gebäude with the hazard first – no title in the head', () => {
    const { container } = render(<BuildingCard info={{ ...base, object: { id: 'o', name: 'Schloss Musterdorf', address_match: true, distance_m: 0, measures: 'Tor öffnen', remarks: null, measures_source: 'Modul 1', updated_at: null } }} onClose={() => {}} />)
    const text = container.textContent ?? ''
    expect(text.indexOf('Sofortmassnahmen')).toBeLessThan(text.indexOf('Gebäude'))
    expect(text.indexOf('Gebäude')).toBeLessThan(text.indexOf('Heizung Gas'))
    expect(text.match(/Gebäude/g)).toHaveLength(1)
    expect(screen.getByRole('region', { name: 'Gebäude' })).toBeTruthy()
  })

  // owner, 27.10.2026: no wasted head row – the first heading carries the ✕, «Register-Hinweis»
  // always sits on the Gebäude heading's row
  it('puts the ✕ on the first heading, «Register-Hinweis» on the Gebäude one', () => {
    const row = (word: string) => screen.getByText(word).parentElement!
    const { unmount } = render(<BuildingCard info={base} onClose={() => {}} />)
    expect(row('Gebäude').querySelector('button[aria-expanded]')).toBeTruthy()
    expect(row('Gebäude').querySelector('button[aria-label="Schliessen"]')).toBeTruthy()
    unmount()
    render(<BuildingCard info={{ ...base, object: { id: 'o', name: 'S', address_match: true, distance_m: 0, measures: 'Tor öffnen', remarks: null, measures_source: null, updated_at: null } }} onClose={() => {}} />)
    expect(row('Sofortmassnahmen').querySelector('button[aria-label="Schliessen"]')).toBeTruthy()
    expect(row('Gebäude').querySelector('button[aria-expanded]')).toBeTruthy()
    expect(row('Gebäude').querySelector('button[aria-label="Schliessen"]')).toBeNull()
    // opened, right under the Gebäude heading
    fireEvent.click(screen.getByRole('button', { name: /Register-Hinweis/ }))
    expect(row('Gebäude').nextElementSibling?.getAttribute('data-testid')).toBe('register-hint')
  })

  it('lists the register as bullets, the hazard first', () => {
    const { container } = render(<BuildingCard info={base} />)
    const lines = [...container.querySelectorAll('ul > li')].map((l) => l.textContent)
    expect(lines[0]).toBe('Heizung Gas')
    expect(lines).toContain('2 Geschosse')
  })

  // owner, 27.10.2026: «for Sofortmassnahmen, drop the source» – no «Schloss Musterdorf · Modul 1»
  it('shows the Sofortmassnahmen as lines, without a source line', () => {
    render(<BuildingCard info={{ ...base, object: { id: 'o', name: 'Schloss Musterdorf', address_match: true, distance_m: 0, measures: 'Prinzessin befreien\nTor öffnen', remarks: null, measures_source: 'Modul 1', updated_at: null } }} />)
    expect(screen.getByText('Sofortmassnahmen')).toBeTruthy()
    expect(screen.getByText('Tor öffnen').tagName).toBe('LI')
    expect(screen.queryByText(/Modul 1/)).toBeNull()
    expect(screen.queryByText('Bemerkungen')).toBeNull()
  })

  // owner, 20.10.2026 (s17): it was a `title=` tooltip — on the tablet a finger got nothing;
  // Manuel 09.11.2026: it stands folded each time the card opens, a tap opens it
  it('folds the register hint, and the source line with it; a tap opens it', () => {
    render(<BuildingCard info={{ ...base, registers_fetched_at: '2026-10-16T10:00:00Z' }} />)
    const hint = screen.getByRole('button', { name: /Register-Hinweis/ })
    expect(hint.getAttribute('aria-expanded')).toBe('false')
    expect(screen.queryByTestId('register-hint')).toBeNull()
    expect(screen.queryByText(/GWR Hauptstrasse 10/)).toBeNull()

    fireEvent.click(hint)
    expect(hint.getAttribute('aria-expanded')).toBe('true')
    expect(screen.getByText(/Aus den Bundesregistern/)).toBeTruthy()
    expect(screen.getByText(/GWR Hauptstrasse 10/)).toBeTruthy()
  })

  it('draws nothing when there is nothing to say', () => {
    const { container } = render(<BuildingCard info={{ ...base, gwr: null, gwr_status: 'error' }} />)
    expect(container.innerHTML).toBe('')
    const { container: none } = render(<BuildingCard info={null} />)
    expect(none.innerHTML).toBe('')
  })
})
