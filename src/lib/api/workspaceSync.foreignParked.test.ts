import { beforeEach, expect, it, vi } from 'vitest'

// Sweep 09.11.2026, UX.2: account B opens an Einsatz for which account A's unsent edits sit on the
// device. B is TOLD that they exist (`subscribeForeignParked`) and nothing more: B's picture is the
// server's, A's copy stays whole under A's key, and A — who gets it back on signing in — is told
// nothing about their own work.
const state = vi.hoisted(() => ({ store: new Map<string, unknown>() }))
const get = vi.hoisted(() => vi.fn())
vi.mock('./workspace', () => ({
  getWorkspace: get, putWorkspace: vi.fn(), putWorkspaceBeacon: vi.fn(),
  putWorkspaceRecord: vi.fn(), putWorkspaceRecordBeacon: vi.fn(),
  putWorkspaceTrupps: vi.fn(), putWorkspaceTruppsBeacon: vi.fn(),
}))
vi.mock('../idb', () => ({
  idbGet: async (key: string) => structuredClone(state.store.get(key) ?? null),
  idbRead: async (key: string) => ({ ok: true, value: structuredClone(state.store.get(key) ?? null) }),
  idbSet: async (key: string, value: unknown) => { state.store.set(key, structuredClone(value)); return true },
  idbDel: async (key: string) => { state.store.delete(key) },
  idbKeys: async (prefix: string) => ({ ok: true, value: [...state.store.keys()].filter((k) => k.startsWith(prefix)) }),
}))
vi.mock('../tileEvict', () => ({ withTileEviction: (fn: () => Promise<boolean>) => fn() }))

const { WorkspaceSync, denyWorkspaceCache, setWorkspaceCacheOwner } = await import('./workspaceSync')

/** account A's unsynced edit, as its expired session left it in the main slot */
const annasEdit = { workspace: { entities: [{ id: 'annas' }] }, base: {}, baseRev: 3, dirty: true, lastSyncedAt: null, owner: 'anna', editedAt: 1_000 }

/** who an engine reports once its subscription has read the device */
async function foreignOwners(sync: InstanceType<typeof WorkspaceSync>): Promise<string[] | null> {
  let heard: string[] | null = null
  const off = sync.subscribeForeignParked((owners) => { heard = owners })
  await vi.waitFor(() => expect(heard).not.toBeNull())
  off()
  return heard
}

beforeEach(() => {
  state.store.clear()
  state.store.set('kp-front-ws-i1', structuredClone(annasEdit))
  // the refused and role slots of the same Einsatz share the key prefix and name no foreign account
  state.store.set('kp-front-ws-i1::__refused__', [])
  state.store.set('kp-front-ws-i1::__role__:ben', [])
  get.mockReset().mockResolvedValue({ workspace: { entities: [{ id: 'server' }] }, workspace_rev: 7 })
  denyWorkspaceCache() // anna's session was refused …
})

it('B is told that A has unsent work here, sees none of it, and A’s copy stays whole', async () => {
  setWorkspaceCacheOwner('ben') // … and ben signs in
  const sync = new WorkspaceSync('i1')
  try {
    const opened = await sync.init()
    expect(opened.workspace).toEqual({ entities: [{ id: 'server' }] })
    expect(await foreignOwners(sync)).toEqual(['anna'])
    expect(state.store.get('kp-front-ws-i1::anna')).toEqual(annasEdit)
  } finally { sync.dispose() }
})

it('A, signing in again, gets the work back and is told of nobody', async () => {
  setWorkspaceCacheOwner('ben')
  const bens = new WorkspaceSync('i1')
  await bens.init()
  bens.dispose()

  denyWorkspaceCache()
  setWorkspaceCacheOwner('anna')
  get.mockResolvedValue({ workspace: {}, workspace_rev: 3 })
  const sync = new WorkspaceSync('i1')
  try {
    const opened = await sync.init()
    expect(opened.workspace).toEqual(annasEdit.workspace)
    expect(await foreignOwners(sync)).toEqual([])
  } finally { sync.dispose() }
})
