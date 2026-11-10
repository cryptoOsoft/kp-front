// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, cleanup, fireEvent } from '@testing-library/react'
import { appConfig } from '../../config/appConfig'
import { clearAllDrafts } from '../../lib/draftKeep'
import type { IncidentMeta } from '../../lib/incidents'

// Sweep 09.11.2026, UX.5: an outside tap, a swipe or Esc closed the sheet and everything typed
// was gone. What was typed is kept (lib/draftKeep) and seeds the next open; «Abbrechen» drops it.

vi.mock('../../lib/incidents', () => ({
  createIncident: vi.fn(), patchIncident: vi.fn(),
  getIncident: vi.fn(() => Promise.resolve({ text: '' })),
  listObjects: vi.fn(() => Promise.resolve([])),
  geocodeSearch: vi.fn(() => Promise.resolve([])),
  geocodeReverse: vi.fn(() => Promise.resolve(null)),
}))
vi.mock('../MapPicker', () => ({ MapPicker: () => null }))
// the Sheet portals and traps focus; body + footer as plain markup is all this needs
vi.mock('./_shared', async (orig) => ({
  ...(await orig<typeof import('./_shared')>()),
  Modal: ({ children, footer }: { children: React.ReactNode; footer?: React.ReactNode }) => <div>{children}{footer}</div>,
}))

const { EinsatzWizard } = await import('./EinsatzWizard')
const ix = appConfig.copy.intake
afterEach(() => { cleanup(); clearAllDrafts() })

const open = (edit?: IncidentMeta) => render(<EinsatzWizard edit={edit} onClose={() => {}} onCreated={() => {}} />)
const stichwort = () => screen.getByPlaceholderText(ix.titlePlaceholder) as HTMLInputElement
const adresse = () => screen.getByPlaceholderText(ix.addressPlaceholder) as HTMLInputElement

describe('«Einsatz eröffnen» closed by an outside tap', () => {
  it('hands the typed Stichwort and Adresse back on the next open', () => {
    const first = open()
    fireEvent.change(stichwort(), { target: { value: 'Kellerbrand' } })
    fireEvent.change(adresse(), { target: { value: 'Hauptstrasse 12' } })
    first.unmount() // the backdrop, a swipe, Esc: the sheet just goes

    open()
    expect(stichwort().value).toBe('Kellerbrand')
    expect(adresse().value).toBe('Hauptstrasse 12')
  })

  it('starts empty again after «Abbrechen»', () => {
    const first = open()
    fireEvent.change(stichwort(), { target: { value: 'Kellerbrand' } })
    fireEvent.click(screen.getByRole('button', { name: ix.cancel }))
    first.unmount()

    open()
    expect(stichwort().value).toBe('')
  })

  it('keeps a correction for its own Einsatz only', () => {
    const a = { id: 'a', title: 'Gebäudebrand', address: 'Schulstrasse 4', started_at: '2026-09-18T03:14:00.000Z' } as IncidentMeta
    const b = { ...a, id: 'b', title: 'Ölspur' } as IncidentMeta
    const first = open(a)
    fireEvent.change(stichwort(), { target: { value: 'Gebäudebrand Schulhaus' } })
    first.unmount()

    const other = open(b)
    expect(stichwort().value).toBe('Ölspur')
    other.unmount()
    open(a)
    expect(stichwort().value).toBe('Gebäudebrand Schulhaus')
  })
})
