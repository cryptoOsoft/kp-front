// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render } from '@testing-library/react'
import type { RosterEntry } from '../lib/auth'
import type { WorkspaceSync } from '../lib/incidents'

// Sweep 09.11.2026, UX.2: the one Meldeleiste row that tells account B about account A's parked
// unsent edits. It names A, can be put away, and offers nothing else — no action reaches the edits.
const cached = vi.hoisted(() => ({ roster: [] as RosterEntry[] }))
vi.mock(import('../lib/unsentAccounts'), async (importOriginal) => ({
  ...(await importOriginal()),
  readCachedRoster: async () => cached.roster,
}))

const { ForeignUnsentMeldungen } = await import('./ForeignUnsentMeldung')
const { Meldeleiste } = await import('./Meldeleiste')

/** an engine that reports these accounts as having parked work for the Einsatz */
const syncWith = (owners: string[]) =>
  ({ subscribeForeignParked: (l: (o: string[]) => void) => { l(owners); return () => {} } }) as unknown as WorkspaceSync

// a fresh Einsatz per test: a ✕ is remembered for the page's life (per viewer and Einsatz)
let incidentId = ''
let seq = 0
async function show(owners: string[], viewerId: string | null = 'ben') {
  const view = render(<><ForeignUnsentMeldungen sync={syncWith(owners)} incidentId={incidentId} viewerId={viewerId} /><Meldeleiste /></>)
  await act(async () => {}) // the cached roster resolves
  return view
}
const titles = () => [...document.querySelectorAll('.ml-title')].map((n) => n.textContent)

beforeEach(() => {
  cached.roster = [{ id: 'anna', display_name: 'Keller Mara', role: 'editor', color: null }]
  incidentId = `i${++seq}`
})
afterEach(cleanup)

it('names the account whose edits are parked and says who has to sign in', async () => {
  await show(['anna'])
  expect(titles()).toEqual(['Nicht übertragene Änderungen von Keller Mara auf diesem Gerät'])
  expect(document.querySelector('.ml-sub')?.textContent).toBe('Keller Mara muss sich hier anmelden')
  // it informs: no button that could act on somebody else's edits
  expect(document.querySelector('.ml-act button')).toBeNull()
})

it('shows nothing while no other account has parked work', async () => {
  await show([])
  expect(titles()).toEqual([])
})

it('an account the roster no longer lists is «einem früheren Konto»', async () => {
  await show(['gone'])
  expect(titles()).toEqual(['Nicht übertragene Änderungen von einem früheren Konto auf diesem Gerät'])
  expect(document.querySelector('.ml-sub')?.textContent).toBe('Sie bleiben auf diesem Gerät gespeichert')
})

it('the ✕ puts the row away for this account, and another account is still told', async () => {
  const first = await show(['anna'])
  fireEvent.click(document.querySelector('.ml-x')!)
  expect(titles()).toEqual([])
  first.unmount()
  // the Einsatz opened again by the same account: still put away
  const again = await show(['anna'])
  expect(titles()).toEqual([])
  again.unmount()
  await show(['anna'], 'cleo')
  expect(titles()).toHaveLength(1)
})
