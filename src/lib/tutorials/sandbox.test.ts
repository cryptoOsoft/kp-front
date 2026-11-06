import { beforeEach, describe, expect, it, vi } from 'vitest'

const { apiPost, patchIncident, deleteIncident } = vi.hoisted(() => ({
  apiPost: vi.fn(),
  patchIncident: vi.fn(),
  deleteIncident: vi.fn(),
}))
vi.mock('../api', () => ({ apiPost }))
vi.mock('../api/incidents', () => ({ patchIncident, deleteIncident }))

import { deleteLernUebung, openLernUebung, renameLernUebung } from './sandbox'

describe('tutorials/sandbox', () => {
  beforeEach(() => vi.clearAllMocks())

  it('opens through the door with the id only and reads back the incident and the reuse', async () => {
    apiPost.mockResolvedValue({ id: 'inc-1', reused: true, title: 'Lernen · Trupps' })
    await expect(openLernUebung('trupps')).resolves.toEqual({ incidentId: 'inc-1', reused: true })
    expect(apiPost).toHaveBeenCalledWith('/api/incidents/lernen', { tutorial: 'trupps' })
  })

  it('renames to the German title the server gives a new one', async () => {
    await renameLernUebung('inc-1', 'lageZeichnen')
    expect(patchIncident).toHaveBeenCalledWith('inc-1', { title: 'Lernen · Karte – die Lage zeichnen' })
  })

  it('refuses a tutorial that runs without a Lern-Übung before asking the server', async () => {
    await expect(openLernUebung('zurechtfinden')).rejects.toThrow(/without a Lern-Übung/)
    await expect(renameLernUebung('inc-1', 'einsatzEroeffnen')).rejects.toThrow(/without a Lern-Übung/)
    expect(apiPost).not.toHaveBeenCalled()
    expect(patchIncident).not.toHaveBeenCalled()
  })

  it('deletes the Übung', async () => {
    await deleteLernUebung('inc-1')
    expect(deleteIncident).toHaveBeenCalledWith('inc-1')
  })
})
