// @vitest-environment jsdom
import { render, screen, cleanup, fireEvent, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

// Deleting an Einsatz takes its Verlauf, Prüfkette and media with it for good, so its guard is a
// modal (ConfirmCard) and not the inline Ja/Nein the re-creatable config rows use (A2, UX sweep).
const { listIncidents, deleteIncident } = vi.hoisted(() => ({ listIncidents: vi.fn(), deleteIncident: vi.fn() }))
vi.mock('../lib/incidents', () => ({ listIncidents, deleteIncident }))
// the Einsatz-Ablage's status; refused = not switched on (no column)
const { apiGet, apiPost } = vi.hoisted(() => ({ apiGet: vi.fn(), apiPost: vi.fn() }))
vi.mock('../lib/api', () => ({ apiGet, apiPost }))
apiGet.mockRejectedValue(new Error('403'))

import { IncidentHistoryView } from './IncidentHistoryView'
import { appConfig } from '../config/appConfig'
import { fillTemplate } from '../lib/format'

const C = appConfig.copy.admin.incidentHistory
const closed = {
  id: 'inc-1', title: 'Brand Gewerbe', address: null, type: null, source: 'manual', status: 'closed',
  is_archived: true, closed_at: '2026-10-01T10:00:00Z', is_exercise: false, report_done_at: null,
  started_at: '2026-10-01T08:00:00Z', updated_at: '2026-10-01T10:00:00Z',
}

afterEach(cleanup)

describe('IncidentHistoryView — deleting an Einsatz', () => {
  it('opens a modal on the first tap and deletes nothing until it is confirmed', async () => {
    listIncidents.mockResolvedValue([closed])
    deleteIncident.mockResolvedValue(undefined)
    render(<IncidentHistoryView />)
    fireEvent.click(await screen.findByLabelText(fillTemplate(C.deleteAria, { title: closed.title })))
    const dialog = await screen.findByRole('alertdialog')
    expect(dialog.textContent).toContain(fillTemplate(C.deleteQuestion, { title: closed.title }))
    expect(deleteIncident).not.toHaveBeenCalled()

    fireEvent.click(screen.getByText(appConfig.copy.admin.common2.cancel))
    expect(deleteIncident).not.toHaveBeenCalled()

    fireEvent.click(screen.getByLabelText(fillTemplate(C.deleteAria, { title: closed.title })))
    const again = await screen.findByRole('alertdialog')
    fireEvent.click(Array.from(again.querySelectorAll('button')).find((b) => b.textContent === C.delete)!)
    await waitFor(() => expect(deleteIncident).toHaveBeenCalledWith('inc-1'))
  })
})

// «MANUAL» printed the stored slug, and an Übung – the one kind that deletes while open – looked
// like every other row (sweep F.5, 23.10.2026)
describe('IncidentHistoryView — what a row says', () => {
  it('names the Herkunft in words, keeps an unknown slug, and marks an Übung', async () => {
    listIncidents.mockResolvedValue([
      closed,
      { ...closed, id: 'inc-2', title: 'Übung Steiger', source: 'pager-x', is_exercise: true },
    ])
    render(<IncidentHistoryView />)
    expect(await screen.findByText(C.sources.manual)).toBeTruthy()
    expect(screen.getByText('pager-x')).toBeTruthy()
    expect(screen.queryByText('manual')).toBeNull()
    expect(screen.getAllByText(appConfig.copy.exerciseBadge)).toHaveLength(1)
  })
})

// The Einsatz-Ablage (docs/incident-archive.md): «abgelegt / ausstehend / Fehler: …» per Einsatz,
// and the one way out of a Fehler
describe('IncidentHistoryView – the Ablage column', () => {
  const A = C.archive
  const row = {
    incidentId: 'inc-1', destination: 'sp', state: 'failed', attempts: 1, nextAttemptAt: null,
    lastError: 'folder Fotoarchiv does not exist', deliveredAt: null, folders: [], reportVersions: 0, filedMedia: 0,
  }

  it('is not there while the Ablage is off', async () => {
    listIncidents.mockResolvedValue([closed])
    apiGet.mockResolvedValueOnce({ enabled: false, deliveries: [] })
    render(<IncidentHistoryView />)
    await screen.findByText(closed.title)
    expect(screen.queryByText(A.column)).toBeNull()
  })

  it('says Fehler with the reason and retries that Einsatz', async () => {
    listIncidents.mockResolvedValue([closed, { ...closed, id: 'inc-2', title: 'Übung Steiger', is_exercise: true }])
    apiGet.mockResolvedValue({ enabled: true, deliveries: [row] })
    apiPost.mockResolvedValue({ retried: 1 })
    render(<IncidentHistoryView />)
    expect(await screen.findByText(A.column)).toBeTruthy()
    expect(screen.getByText(A.states.failed)).toBeTruthy()
    expect(screen.getByText(row.lastError)).toBeTruthy()
    expect(screen.getByText(A.exercise)).toBeTruthy()
    fireEvent.click(screen.getByText(A.retry))
    await waitFor(() => expect(apiPost).toHaveBeenCalledWith('/api/admin/incident-archive/retry', { incidentId: 'inc-1' }))
    apiGet.mockRejectedValue(new Error('403'))
  })
})
