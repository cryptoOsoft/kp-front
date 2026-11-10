import { beforeEach, expect, it, vi } from 'vitest'
import type { RosterEntry } from './auth'

// Sweep 09.11.2026, UX.2: the login screen says WHOSE unsent work this device holds. These pin
// which slots count as «unsent work of an account», that asking moves and deletes nothing, and how
// the accounts become banner lines.
const state = vi.hoisted(() => ({ store: new Map<string, unknown>() }))
vi.mock('./idb', () => ({
  idbGet: async (key: string) => structuredClone(state.store.get(key) ?? null),
  idbRead: async (key: string) => ({ ok: true, value: structuredClone(state.store.get(key) ?? null) }),
  idbSet: async (key: string, value: unknown) => { state.store.set(key, structuredClone(value)); return true },
  idbDel: async (key: string) => { state.store.delete(key) },
  idbKeys: async (prefix: string) => ({ ok: true, value: [...state.store.keys()].filter((k) => k.startsWith(prefix)) }),
}))

const { unsentAccounts, unsentLines } = await import('./unsentAccounts')

const entry = (owner: string | undefined, dirty: boolean, editedAt?: number) =>
  ({ workspace: { entities: [{ id: `of-${owner}` }] }, baseRev: 1, dirty, lastSyncedAt: null, owner, editedAt })
const journal = (...ats: string[]) =>
  ({ rows: [], latestSeq: 0, outbox: ats.map((at, i) => ({ id: `r${i}`, t: '', at, icon: '', text: 'x' })) })
const person = (id: string, display_name: string): RosterEntry => ({ id, display_name, role: 'editor', color: null })

beforeEach(() => { state.store.clear() })

it('lists the accounts with unsent work, most recent first, and leaves every slot as it was', async () => {
  const seed: Record<string, unknown> = {
    // a session that expired left its edits in the main slot
    'kp-front-ws-i1': entry('anna', true, 1_000),
    // parked for its owner when somebody else opened the Einsatz
    'kp-front-ws-i2::ben': entry('ben', true, 3_000),
    // the server has it: nothing unsent
    'kp-front-ws-i3': entry('cleo', false, 9_000),
    // no sign-in sends these: orphan, refused, role
    'kp-front-ws-i4::__preupgrade__': entry(undefined, true, 9_000),
    'kp-front-ws-i4::__refused__': [{ workspace: {}, baseRev: 1, refusedAt: 9_000, owner: 'dora' }],
    'kp-front-ws-i4::__role__:dora': [{ workspace: {}, baseRev: 1, refusedAt: 9_000, owner: 'dora' }],
    // Verlauf rows waiting in a login's outbox — the only unsent thing of this account
    'kp-journal-i1:emil:login': journal('1970-01-01T00:00:02.000Z'),
    // an empty outbox, a link page's slot and the shared pre-owner slot name nobody
    'kp-journal-i1:anna:login': journal(),
    'kp-journal-i1:fritz:atemschutz': journal('1970-01-01T00:00:09.000Z'),
    'kp-journal-i1': journal('1970-01-01T00:00:09.000Z'),
  }
  for (const [k, v] of Object.entries(seed)) state.store.set(k, v)

  expect(await unsentAccounts()).toEqual([{ id: 'ben', at: 3_000 }, { id: 'emil', at: 2_000 }, { id: 'anna', at: 1_000 }])
  expect(Object.fromEntries(state.store)).toEqual(seed)
})

it('one account with work in two Einsätze is one entry, dated by its newest edit', async () => {
  state.store.set('kp-front-ws-i1', entry('anna', true, 1_000))
  state.store.set('kp-front-ws-i2::anna', entry('anna', true, 5_000))
  expect(await unsentAccounts()).toEqual([{ id: 'anna', at: 5_000 }])
})

it('a line per account in the given order, three at most, the rest counted', () => {
  const roster = ['a', 'b', 'c', 'd', 'e'].map((id) => person(id, `Name ${id}`))
  const accounts = ['d', 'a', 'e', 'b', 'c'].map((id, i) => ({ id, at: 100 - i }))
  const { lines, more } = unsentLines(accounts, roster)
  expect(lines.map((l) => l.entry?.id)).toEqual(['d', 'a', 'e'])
  expect(more).toBe(2)
})

it('accounts the roster no longer lists share one nameless line', () => {
  const { lines, more } = unsentLines([{ id: 'gone1', at: 3 }, { id: 'a', at: 2 }, { id: 'gone2', at: 1 }], [person('a', 'Keller Mara')])
  expect(lines).toEqual([{ key: 'former', entry: null }, { key: 'a', entry: person('a', 'Keller Mara') }])
  expect(more).toBe(0)
})
