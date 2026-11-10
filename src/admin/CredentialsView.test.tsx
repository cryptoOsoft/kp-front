// @vitest-environment jsdom
//
// What this pins is the page's half of the write-only contract. The server never sends a
// secret — that is tested in backend/tests/test_integration_credentials.py — and this file
// asserts the three things the UI could still get wrong on its own:
//
//   1. a field the SERVER supplies must not offer an input, because a box that cannot take
//      effect is the «typed it in and nothing happened» failure the whole change removes;
//   2. «unlesbar» must read as «set it again», not as «not configured»;
//   3. a saved value must be sent to the right endpoint and the box must clear, so nobody
//      is left looking at a secret they just typed.
//
// …and since 2026-09-11 a fourth, which is the one thing the page could now mislead about: the
// Einsatz-Link minting key sits here too and IS readable, because KP Front mints it rather than
// receiving it. The sheet of write-only credentials and the sheet holding that key must stay
// tellable apart — otherwise somebody looks for a «show» on a Divera key, or retypes a minting
// key they could simply have copied.

import { render, screen, cleanup, waitFor, fireEvent, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const apiGet = vi.fn()
const apiPut = vi.fn()
const apiPost = vi.fn()
const apiDelete = vi.fn()

vi.mock('../lib/api', async () => {
  const actual = await vi.importActual<typeof import('../lib/api')>('../lib/api')
  return {
    ...actual,
    apiGet: (p: string) => apiGet(p),
    apiPut: (p: string, b: unknown) => apiPut(p, b),
    apiPost: (p: string, b: unknown) => apiPost(p, b),
    apiDelete: (p: string) => apiDelete(p),
  }
})

import { CredentialsView } from './CredentialsView'
import { appConfig } from '../config/appConfig'

const C = appConfig.copy.admin.zugaenge

interface Cred {
  name: string; group: string; label: string; secret: boolean
  source: string; configured: boolean; env: string
  value: string | null; updatedAt: string | null; updatedByName: string | null
}

const cred = (over: Partial<Cred>): Cred => ({
  name: 'stt_api_key', group: 'stt', label: 'STT-API-Key', secret: true,
  source: 'unset', configured: false, env: 'STT_API_KEY',
  value: null, updatedAt: null, updatedByName: null, ...over,
})

/** The credential list, the audit list and — the third endpoint on this page — the minting key,
 *  which answers with its value on every GET (backend · api/incident_link.py). */
function serve(creds: Cred[], audit: unknown[] = [], key: { configured: boolean; token?: string } = { configured: false }) {
  apiGet.mockImplementation((p: string) => {
    if (p === '/api/incident-link/secret') return Promise.resolve(key)
    return Promise.resolve(p.startsWith('/api/integrations/credentials-audit') ? audit : creds)
  })
}

beforeEach(() => { apiGet.mockReset(); apiPut.mockReset(); apiPost.mockReset(); apiDelete.mockReset() })
afterEach(cleanup)

describe('a credential the server supplies', () => {
  it('names the variable instead of offering a box that could not take effect', async () => {
    serve([cred({ name: 'divera_access_key', group: 'divera', label: 'Divera Accesskey', source: 'env', configured: true, env: 'DIVERA_ACCESS_KEY' })])
    render(<CredentialsView />)

    expect(await screen.findByText(C.stateEnv)).toBeTruthy()
    expect(screen.getByText('DIVERA_ACCESS_KEY')).toBeTruthy()
    // No input, no save button — «.env wins» is visible, not merely enforced server-side.
    expect(document.querySelector('.adm-cred-edit')).toBeNull()
  })
})

/** The one credential here that is NOT a secret is the VAPID public key: 87 characters of
 *  base64url, no space, no hyphen, no slash. jsdom cannot tell us whether it wraps (that needs
 *  a real browser), but it can pin the hook the stylesheet needs — a shown value must
 *  carry `adm-cred-val`, never a bare `adm-mono`, or the key leaves its column and runs off the
 *  card at every width. */
describe('a credential whose value IS shown', () => {
  // ⚠️ SYNTHETIC, and it has to stay synthetic. A real VAPID public key was pasted in here from
  // a screenshot of the running admin; gitleaks blocked the push, rightly — a public key is not
  // a credential, but it is still this station's production material in a public repository, and
  // a fixture only has to have the SHAPE: 87 chars of base64url with no break opportunity.
  const VAPID = 'B'.concat('QWxsZXNGYWtlS2VpblNjaGx1ZXNzZWxOdXJGdWVyRGVuVGVzdA')
    .padEnd(87, '_Beispiel0123456789abcdefghijklmnop')

  it.each([
    ['from .env', 'env' as const],
    ['from the store', 'stored' as const],
  ])('marks the long token breakable (%s)', async (_case, source) => {
    serve([cred({
      name: 'vapid_public_key', group: 'push', label: 'VAPID Public Key', secret: false,
      source, configured: true, env: 'VAPID_PUBLIC_KEY', value: VAPID,
    })])
    render(<CredentialsView />)

    const shown = await screen.findByText(VAPID)
    expect(shown.className).toContain('adm-cred-val')
  })
})

describe('a credential that will not decrypt', () => {
  it('says «unlesbar» and asks for it again, never «nicht gesetzt»', async () => {
    serve([cred({ source: 'unreadable', configured: false, updatedAt: '2026-08-01T10:00:00Z' })])
    render(<CredentialsView />)

    expect(await screen.findByText(C.stateUnreadable)).toBeTruthy()
    expect(screen.getByText(C.unreadableHint)).toBeTruthy()
    expect(screen.queryByText(C.stateUnset)).toBeNull()
    // …and it still offers the box, because «set it again» is the whole instruction.
    expect(document.querySelector('.adm-cred-edit')).not.toBeNull()
  })
})

describe('saving', () => {
  it('sends the value to its own endpoint and clears the box afterwards', async () => {
    serve([cred({})])
    apiPut.mockResolvedValue({})
    render(<CredentialsView />)

    const box = await screen.findByLabelText('STT-API-Key')
    fireEvent.change(box, { target: { value: 'sk-live-abc' } })
    fireEvent.click(screen.getByRole('button', { name: C.saveBtn }))

    await waitFor(() => expect(apiPut).toHaveBeenCalledWith(
      '/api/integrations/credentials/stt_api_key', { value: 'sk-live-abc' }))
    // Cleared, so the one place the secret was visible stops being visible.
    await waitFor(() => expect((box as HTMLInputElement).value).toBe(''))
  })

  it('shows the server refusal verbatim — it is the useful sentence', async () => {
    serve([cred({ name: 'traccar_url', group: 'traccar', label: 'Traccar-Server', secret: false, env: 'TRACCAR_URL' })])
    apiPut.mockRejectedValue(new Error('Die Traccar-Adresse muss mit https:// beginnen – sonst bleibt die Ortung aus.'))
    render(<CredentialsView />)

    fireEvent.change(await screen.findByLabelText('Traccar-Server'), { target: { value: 'http://gps.example.org' } })
    fireEvent.click(screen.getByRole('button', { name: C.saveBtn }))

    expect(await screen.findByText(/muss mit https:\/\/ beginnen/)).toBeTruthy()
  })
})

describe('the settings table', () => {
  // ⚠️ The sheet is a CSS grid whose rows are `display: contents`, so a row wrapped in any
  // element at all loses its four cells to that wrapper and every column on the page collapses
  // — silently, with no error anywhere. A row must be a DIRECT child of `.adm-settings`.
  it('hangs every credential row straight off the grid, never inside a wrapper', async () => {
    serve([cred({}), cred({ name: 'traccar_url', group: 'traccar', label: 'Traccar-Server', secret: false })])
    render(<CredentialsView />)

    await screen.findByLabelText('STT-API-Key')
    // ⚠️ The FIRST grid: the minting key has a sheet of its own further down, and counting both
    // would say nothing about either.
    const sheet = document.querySelector('.adm-settings') as HTMLElement
    expect(sheet.querySelectorAll(':scope > .adm-set-row')).toHaveLength(2)
    // …and the integration is a group divider, not a card of its own.
    expect(sheet.querySelectorAll(':scope > .adm-set-grp')).toHaveLength(2)
  })

  // ⚠️ The state is the row's VALUE, drawn by the shared `StatusBadge` (a hand-rolled `StatePill`
  // lived here until the house-style pass) — and LABEL-LESS: the Einstellung column already names
  // the credential, so a labelled badge would read «Divera Accesskey — Divera Accesskey gesetzt».
  it('draws the state as a label-less StatusBadge, not a badge repeating the row name', async () => {
    serve([cred({ name: 'divera_access_key', group: 'divera', label: 'Divera Accesskey', source: 'stored', configured: true })])
    render(<CredentialsView />)

    const badge = await waitFor(() => {
      const el = document.querySelector('.adm-set-ctl .adm-badge')
      if (!el) throw new Error('no badge')
      return el
    })
    expect(badge.querySelector('.adm-badge-state')?.textContent).toBe(C.stateStored)
    expect(badge.querySelector('.adm-badge-label')?.textContent).toBe('')
  })
})

describe('the Einsatz-Link minting key', () => {
  const I = appConfig.copy.admin.einsatzlink

  // ⚠️ THE POINT OF THIS BLOCK: two kinds of secret share the page, and the reader has to be
  // able to tell which is which without trying. The readable one is the one on a copy chip,
  // in its own sheet with its own head; the write-only ones are boxes and badges, and no chip
  // anywhere in their sheet.
  it('stands in its own sheet, readable, where the write-only credentials never are', async () => {
    serve([cred({ name: 'divera_access_key', group: 'divera', label: 'Divera Accesskey', source: 'stored', configured: true })],
      [], { configured: true, token: 'mint-1' })
    render(<CredentialsView />)

    const chip = await waitFor(() => {
      const el = document.querySelector('.adm-copychip') as HTMLElement | null
      if (!el) throw new Error('no copy chip')
      return el
    })
    expect(chip.textContent).toContain('mint-1')

    // It is NOT in the credentials sheet — that sheet's contract is «never again», and one
    // readable row inside it would read as an exception to it.
    const sheets = [...document.querySelectorAll('.adm-settings')] as HTMLElement[]
    expect(sheets).toHaveLength(2)
    expect(sheets[0].querySelector('.adm-copychip')).toBeNull()
    expect(sheets[0].contains(chip)).toBe(false)
    expect(sheets[1].contains(chip)).toBe(true)
    // …and its head says so in words, so the difference does not rest on noticing a chip.
    expect(screen.getByText(C.minted.title)).toBeTruthy()
    expect(screen.getByText(C.minted.caption)).toBeTruthy()
    // The write-only side keeps its own shape: a box to replace, no value to read.
    expect(within(sheets[0]).getByLabelText('Divera Accesskey')).toBeTruthy()
  })

  it('offers «Aktivieren» while it is off, and rotates and disables in two clicks', async () => {
    serve([cred({})])
    render(<CredentialsView />)

    // off: no key to copy, one way to get one
    const enable = await screen.findByRole('button', { name: I.enableBtn })
    expect(document.querySelector('.adm-copychip')).toBeNull()
    apiPost.mockResolvedValue({ configured: true, token: 'mint-2' })
    fireEvent.click(enable)
    await waitFor(() => expect(apiPost).toHaveBeenCalledWith('/api/incident-link/secret/rotate', {}))

    // on: rotating destroys every link already sent out, so it asks first
    await screen.findByText('mint-2')
    fireEvent.click(screen.getByRole('button', { name: I.rotateBtn }))
    expect(await screen.findByText(I.rotateMsg)).toBeTruthy()
    expect(apiPost).toHaveBeenCalledTimes(1)
  })
})

describe('the page says what a browser deliberately cannot set', () => {
  it('names SECRET_KEY and ADMIN_SECRET with the reason each stays in .env', async () => {
    serve([cred({})])
    render(<CredentialsView />)

    expect(await screen.findByText('SECRET_KEY')).toBeTruthy()
    expect(screen.getByText('ADMIN_SECRET')).toBeTruthy()
  })
})
