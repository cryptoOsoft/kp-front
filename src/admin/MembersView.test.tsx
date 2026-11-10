// @vitest-environment jsdom
import { act, render, screen, cleanup, fireEvent, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// What this pins is the reason the Rolle stopped being a dropdown: it defaulted to «Betrachter»,
// which reads as a filled-in field rather than an open question, and a tester created three crew
// accounts that all came out read-only — discovered only when somebody could not write during an
// incident. So: no default, «Anlegen» refuses until the question is answered, and the answer is
// what actually reaches the server.

const { apiGet, apiPost, apiPatch, ApiError } = vi.hoisted(() => {
  class ApiError extends Error {
    status: number
    detail: string
    constructor(status: number, detail: string) { super(detail); this.status = status; this.detail = detail }
  }
  return { apiGet: vi.fn(), apiPost: vi.fn(), apiPatch: vi.fn(), ApiError }
})
vi.mock('../lib/api', () => ({ apiGet, apiPost, apiPatch, ApiError }))

import { MembersView } from './MembersView'
import { appConfig } from '../config/appConfig'

const C = appConfig.copy.admin.members
const Cc = appConfig.copy.admin.common2

const EXISTING = {
  id: 'u1',
  username: 'fu',
  display_name: 'Führungsunterstützung',
  role: 'editor' as const,
  color: '#c0392b',
  is_active: true,
  created_at: '2026-08-01T10:00:00Z',
  last_login: null,
  el_view_default: false,
}

beforeEach(() => {
  vi.clearAllMocks()
  apiGet.mockResolvedValue([EXISTING])
  apiPost.mockResolvedValue({})
})
afterEach(cleanup)

/** Render and let the mocked user list land INSIDE act(), so React has rendered the rows AND run
 *  their effects before the test touches anything. Waiting for a row's text is not enough: that
 *  update lands outside act, its commit shows the text at once, but the effects it scheduled run
 *  a task later — and under a loaded full suite the click below came first. Base UI's row menu is
 *  not wired up until those effects have run, so the click was swallowed and «Bearbeiten» never
 *  appeared (CI and local full runs since 20.09.2026, never the file alone). */
const renderMembers = async () => {
  render(<MembersView />)
  await act(() => apiGet.mock.results[0].value)
}

/** Open the add-member form and fill everything EXCEPT the role. */
const fillFormWithoutRole = async () => {
  await renderMembers()
  expect(screen.getByText('fu')).toBeTruthy()
  fireEvent.click(screen.getByRole('button', { name: C.add }))
  const inputs = document.querySelectorAll<HTMLInputElement>('.adm-members-addbox .adm-input')
  fireEvent.change(inputs[0], { target: { value: 'kunz' } })
  fireEvent.change(inputs[1], { target: { value: 'Kunz Bea' } })
  // the PIN field is the mono input in the second row
  const pin = screen.getByPlaceholderText('••••••')
  fireEvent.change(pin, { target: { value: '481592' } })
}

const createBtn = () => screen.getByRole('button', { name: Cc.create })

describe('Mitglied anlegen — die Rolle ist eine Frage, keine Voreinstellung', () => {
  it('keeps «Anlegen» disabled until a role is chosen, and names why', async () => {
    await fillFormWithoutRole()

    expect((createBtn() as HTMLButtonElement).disabled).toBe(true)
    expect(screen.getByText(C.rolePickFirst)).toBeTruthy()
    // neither card starts selected
    expect(screen.getAllByRole('radio').every((r) => r.getAttribute('aria-checked') === 'false')).toBe(true)

    fireEvent.click(screen.getByRole('radio', { name: new RegExp(C.roleEditor) }))

    expect((createBtn() as HTMLButtonElement).disabled).toBe(false)
    expect(screen.queryByText(C.rolePickFirst)).toBeNull()
  })

  it('sends the CHOSEN role — «Bearbeiter» does not silently become a viewer', async () => {
    await fillFormWithoutRole()
    fireEvent.click(screen.getByRole('radio', { name: new RegExp(C.roleEditor) }))
    fireEvent.click(createBtn())

    await waitFor(() => expect(apiPost).toHaveBeenCalled())
    expect(apiPost.mock.calls[0][0]).toBe('/api/auth/users')
    expect((apiPost.mock.calls[0][1] as { role: string }).role).toBe('editor')
  })

  it('sends viewer when viewer is the card that was picked', async () => {
    await fillFormWithoutRole()
    fireEvent.click(screen.getByRole('radio', { name: new RegExp(C.roleViewer) }))
    fireEvent.click(createBtn())

    await waitFor(() => expect(apiPost).toHaveBeenCalled())
    expect((apiPost.mock.calls[0][1] as { role: string }).role).toBe('viewer')
  })
})

// Die Rolle in der Tabelle stand jahrelang auf einem binären Ternär ohne `el`-Zweig: JEDER
// Einsatzleiter las sich als «Betrachter» — auf genau der Seite, auf der man nachschaut, warum
// jemand nichts schreiben darf.
describe('die Rolle in der Tabelle', () => {
  it('nennt einen Einsatzleiter «Einsatzleiter»', async () => {
    apiGet.mockResolvedValue([{ ...EXISTING, id: 'u3', username: 'el1', display_name: 'Meier El', role: 'el' }])
    await renderMembers()

    expect(screen.getByText('el1')).toBeTruthy()
    expect(document.querySelector('.adm-members-role')?.textContent).toBe(C.roleEl)
    expect(screen.queryByText(C.roleViewer)).toBeNull()
  })

  it('unterscheidet Bearbeiter und Betrachter weiterhin', async () => {
    apiGet.mockResolvedValue([
      EXISTING,
      { ...EXISTING, id: 'u2', username: 'kunz', display_name: 'Kunz Bea', role: 'viewer' },
    ])
    await renderMembers()

    expect(screen.getByText('kunz')).toBeTruthy()
    expect(Array.from(document.querySelectorAll('.adm-members-role')).map((e) => e.textContent))
      .toEqual([C.roleEditor, C.roleViewer])
  })
})

// Die Status-Pille ist jetzt der gemeinsame StatusBadge statt handgezeichneter Spans. Die Spalte
// heisst «Status», also trägt die Pille kein eigenes Label mehr — Text und Ton müssen bleiben.
describe('der Status in der Tabelle', () => {
  it('sagt weiterhin Aktiv bzw. Inaktiv, mit dem passenden Ton', async () => {
    apiGet.mockResolvedValue([
      EXISTING,
      { ...EXISTING, id: 'u2', username: 'kunz', display_name: 'Kunz Bea', is_active: false },
    ])
    await renderMembers()

    expect(screen.getByText('kunz')).toBeTruthy()
    expect(Array.from(document.querySelectorAll('.adm-badge-state')).map((e) => e.textContent))
      .toEqual([C.active, C.inactive])
    expect(document.querySelectorAll('.adm-badge.on')).toHaveLength(1)
    expect(document.querySelectorAll('.adm-badge.off')).toHaveLength(1)
  })
})

describe('Mitglied bearbeiten — dort EXISTIERT der Wert', () => {
  it('preselects the member\'s current role and never returns to «nothing chosen»', async () => {
    apiGet.mockResolvedValue([EXISTING, { ...EXISTING, id: 'u2', username: 'kunz', display_name: 'Kunz Bea', role: 'viewer' }])
    await renderMembers()
    expect(screen.getByText('kunz')).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: `Geschützte Aktionen für Kunz Bea` }))
    fireEvent.click(await screen.findByText(Cc.edit))

    const viewerCard = screen.getByRole('radio', { name: new RegExp(C.roleViewer) })
    expect(viewerCard.getAttribute('aria-checked')).toBe('true')

    // switching to Bearbeiter and saving patches the role along with the rest
    fireEvent.click(screen.getByRole('radio', { name: new RegExp(C.roleEditor) }))
    apiPatch.mockResolvedValue({})
    fireEvent.click(screen.getByRole('button', { name: Cc.save }))
    await waitFor(() => expect(apiPatch).toHaveBeenCalled())
    expect((apiPatch.mock.calls[0][1] as { role: string }).role).toBe('editor')
  })
})

// Sweep 09.11.2026, UX.14: both sign the person out on their devices, and both fired on one tap
// from the ⋮ menu. They ask first now, with the Verwaltung's two-step confirm.
describe('«Deaktivieren» und der Rollenwechsel im ⋮-Menü', () => {
  const twoMembers = [EXISTING, { ...EXISTING, id: 'u2', username: 'kunz', display_name: 'Kunz Bea' }]
  const pick = async (label: string) => {
    apiGet.mockResolvedValue(twoMembers)
    apiPatch.mockResolvedValue({})
    await renderMembers()
    fireEvent.click(screen.getByRole('button', { name: 'Geschützte Aktionen für Kunz Bea' }))
    fireEvent.click(await screen.findByText(label))
  }

  it.each([
    ['Deaktivieren', C.deactivate, { is_active: false }],
    ['Rollenwechsel', C.toViewer, { role: 'viewer' }],
  ])('%s fragt zuerst und schreibt erst nach «Ja»', async (_name, label, patch) => {
    await pick(label)
    expect(apiPatch).not.toHaveBeenCalled()
    const ask = screen.getByRole('alertdialog')
    expect(ask.textContent).toContain('Kunz Bea')
    fireEvent.click(screen.getByRole('button', { name: appConfig.copy.admin.common.confirmYes }))
    await waitFor(() => expect(apiPatch).toHaveBeenCalledWith('/api/auth/users/u2', patch))
  })

  it('«Abbrechen» schreibt nichts und bringt das Menü zurück', async () => {
    await pick(C.deactivate)
    fireEvent.click(screen.getByRole('button', { name: appConfig.copy.admin.common.confirmNo }))
    expect(apiPatch).not.toHaveBeenCalled()
    expect(screen.getByRole('button', { name: 'Geschützte Aktionen für Kunz Bea' })).toBeTruthy()
  })
})
