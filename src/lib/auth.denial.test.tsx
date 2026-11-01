// @vitest-environment jsdom
import { act, cleanup, renderHook, waitFor } from '@testing-library/react'
import type { ReactNode } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// SEC-10. `kp:session-expired` is fired by api.ts when a 401 could not be repaired — but the
// refresh POST that decides it counts a NETWORK failure as a refusal too, so the event alone
// cannot be trusted to mean «the server said no». AuthProvider therefore asks once more, and
// only a reachable server's 401/403 locks the device out of its caches. Silence changes nothing:
// the cached session, the cached media and the cached workspace stay exactly as they were.
const { apiGet, apiPost } = vi.hoisted(() => ({ apiGet: vi.fn(), apiPost: vi.fn() }))
vi.mock('./api', async () => {
  const actual = await vi.importActual<typeof import('./api')>('./api')
  return { ...actual, apiGet, apiPost }
})
const { idbGet, idbSet, idbDel } = vi.hoisted(() => ({ idbGet: vi.fn(), idbSet: vi.fn(), idbDel: vi.fn() }))
vi.mock('./idb', () => ({ idbGet, idbSet, idbDel }))
const { syncMediaCacheAuth } = vi.hoisted(() => ({ syncMediaCacheAuth: vi.fn() }))
vi.mock('./authMediaCache', () => ({ syncMediaCacheAuth }))
const { denyWorkspaceCache, setWorkspaceCacheOwner } = vi.hoisted(() => ({
  denyWorkspaceCache: vi.fn(), setWorkspaceCacheOwner: vi.fn(),
}))
vi.mock('./api/workspaceSync', () => ({ denyWorkspaceCache, setWorkspaceCacheOwner }))

import { ApiError, SESSION_EXPIRED_EVENT } from './api'
import * as deploymentConfig from './deploymentConfig'
import { AuthProvider, useAuth } from './auth'

const EDITOR_USER = { id: 'ed-1', username: 'fu', display_name: 'FU', role: 'editor', color: null, last_login: null }
const wrapper = ({ children }: { children: ReactNode }) => <AuthProvider>{children}</AuthProvider>

/** boot straight into a signed-in session, with the config re-read out of the way */
async function signedIn() {
  vi.spyOn(deploymentConfig, 'isDemoMode').mockReturnValue(false)
  vi.spyOn(deploymentConfig, 'getDeploymentConfig').mockReturnValue({ integrations: { cartoBasemapKey: 'k' } })
  apiGet.mockResolvedValueOnce(EDITOR_USER)
  const { result } = renderHook(() => useAuth(), { wrapper })
  await waitFor(() => expect(result.current.user).toEqual(EDITOR_USER))
  syncMediaCacheAuth.mockClear(); idbDel.mockClear(); setWorkspaceCacheOwner.mockClear()
  return result
}

beforeEach(() => {
  apiGet.mockReset(); apiPost.mockReset(); idbSet.mockReset(); idbDel.mockReset()
  idbGet.mockReset().mockResolvedValue(null) // no cached user unless a test seeds one
  syncMediaCacheAuth.mockReset(); denyWorkspaceCache.mockReset(); setWorkspaceCacheOwner.mockReset()
})
// ⚠️ No global RTL auto-cleanup in this repo (vite.config · test has no setupFiles), and these
// tests fire a WINDOW event: a provider left mounted by the previous test would answer it too.
afterEach(() => { cleanup(); vi.restoreAllMocks() })

describe('AuthProvider — a session the server has explicitly refused', () => {
  it('locks the device out of its caches at once, and keeps the unsynced work', async () => {
    const result = await signedIn()
    apiGet.mockRejectedValueOnce(new ApiError(401, 'Nicht angemeldet')) // the confirming /me

    act(() => { window.dispatchEvent(new Event(SESSION_EXPIRED_EVENT)) })

    // the app falls back to the kiosk login (main · Gate renders it on a null user)
    await waitFor(() => expect(result.current.user).toBeNull())
    // …the worker is told, so the media cache stops answering (authMediaCache · «logged-out»)
    await waitFor(() => expect(syncMediaCacheAuth).toHaveBeenCalledWith(null))
    expect(denyWorkspaceCache).toHaveBeenCalled()
    expect(idbDel).toHaveBeenCalledWith('kp-front-user') // no offline restore of a dead session
    expect(setWorkspaceCacheOwner).toHaveBeenLastCalledWith(null)
  })

  it.each([0, 503])('changes NOTHING when the server could not be asked (%i)', async (status) => {
    const result = await signedIn()
    apiGet.mockRejectedValueOnce(new ApiError(status, 'Netzwerkfehler'))

    act(() => { window.dispatchEvent(new Event(SESSION_EXPIRED_EVENT)) })

    await waitFor(() => expect(apiGet).toHaveBeenCalledTimes(2)) // asked, and got silence
    expect(result.current.sessionExpired).toBe(true) // the Meldung says so — honestly
    expect(result.current.user).toEqual(EDITOR_USER) // …and the workspace keeps working offline
    expect(denyWorkspaceCache).not.toHaveBeenCalled()
    expect(syncMediaCacheAuth).not.toHaveBeenCalledWith(null)
    expect(idbDel).not.toHaveBeenCalled()
  })

  it('withdraws the warning when the session turns out to be alive after all', async () => {
    const result = await signedIn()
    apiGet.mockResolvedValueOnce(EDITOR_USER) // another tab had refreshed it

    act(() => { window.dispatchEvent(new Event(SESSION_EXPIRED_EVENT)) })

    await waitFor(() => expect(result.current.sessionExpired).toBe(false))
    expect(result.current.user).toEqual(EDITOR_USER)
    expect(denyWorkspaceCache).not.toHaveBeenCalled()
  })

  it('asks only once while the answer is still outstanding', async () => {
    const result = await signedIn()
    apiGet.mockRejectedValue(new ApiError(401, 'Nicht angemeldet'))

    act(() => {
      window.dispatchEvent(new Event(SESSION_EXPIRED_EVENT))
      window.dispatchEvent(new Event(SESSION_EXPIRED_EVENT))
      window.dispatchEvent(new Event(SESSION_EXPIRED_EVENT))
    })
    await waitFor(() => expect(result.current.user).toBeNull())
    expect(apiGet).toHaveBeenCalledTimes(2) // the boot probe and ONE confirmation
  })
})

// The other end of the same signal. `syncMediaCacheAuth(null)` posts «logged-out» to the worker
// (authMediaCache), and the worker has to answer it for the whole BROWSER: every tab rides the
// one cookie the server just refused, so a second tab must not keep reading the media cache
// until it happens to make its own failing request. Driven straight against the worker source,
// the way authMediaCache.test.ts does — there is no other way to exercise a service worker.
describe('sw-media-cache — a denial converges across tabs', () => {
  it('drops every tab’s grant, not just the one that noticed', async () => {
    const handlers = new Map<string, (event: Record<string, unknown>) => void>()
    const stores = new Map<string, Map<string, Response>>()
    const cachesMock = {
      open: async (name: string) => {
        const store = stores.get(name) ?? new Map<string, Response>()
        stores.set(name, store)
        const keyOf = (i: RequestInfo | URL) => (typeof i === 'string' ? i : i instanceof URL ? i.toString() : i.url)
        return {
          match: async (i: RequestInfo | URL) => store.get(keyOf(i))?.clone(),
          put: async (i: RequestInfo | URL, r: Response) => { store.set(keyOf(i), r.clone()) },
          keys: async () => [...store.keys()].map((url) => new Request(url)),
          delete: async (i: RequestInfo | URL) => store.delete(keyOf(i)),
        }
      },
      delete: async (name: string) => stores.delete(name),
    }
    let n = 0
    const fetchMock = vi.fn(async () => new Response(`network-${++n}`, { status: 200 }))
    const selfMock = {
      location: { origin: 'https://kp.test' },
      addEventListener: (type: string, h: (event: Record<string, unknown>) => void) => { handlers.set(type, h) },
    }
    // …from the repo root: under jsdom `import.meta.url` is an http URL, not a file one.
    const source = (await import('node:fs')).readFileSync(`${process.cwd()}/public/sw-media-cache.js`, 'utf8')
    new Function('self', 'caches', 'fetch', 'URL', 'Request', 'Response', 'Headers', source)(
      selfMock, cachesMock, fetchMock, URL, Request, Response, Headers,
    )
    const message = async (clientId: string, data: object) => {
      let pending: Promise<unknown> = Promise.resolve()
      handlers.get('message')?.({ data, source: { id: clientId }, waitUntil: (p: Promise<unknown>) => { pending = p } })
      await pending
    }
    const media = async (clientId: string) => {
      let response: Promise<Response> | undefined
      handlers.get('fetch')?.({
        clientId,
        request: new Request('https://kp.test/api/media/m1'),
        stopImmediatePropagation: () => {},
        respondWith: (p: Promise<Response>) => { response = p },
      })
      return (await response!).text()
    }

    // two tabs of the same session; the cache answers the second read without the network
    await message('tab-a', { type: 'kp-media-auth', kind: 'user', userId: 'ed-1' })
    await message('tab-b', { type: 'kp-media-auth', kind: 'user', userId: 'ed-1' })
    expect(await media('tab-a')).toBe('network-1')
    expect(await media('tab-b')).toBe('network-1')

    // Station reference data (symbols/geojson) is not owner-scoped, so an explicit denial must
    // purge it too — otherwise a revoked device keeps reading it. Seed it as Workbox would.
    stores.set('reference-data', new Map([['https://kp.test/api/reference/symbols', new Response('ref')]]))

    // tab A is the one whose request 401s → the whole device loses the cache and every grant
    await message('tab-a', { type: 'kp-media-auth', kind: 'logged-out' })
    expect(stores.has('incident-media')).toBe(false)
    expect(stores.has('reference-data')).toBe(false) // …the reference cache is gone as well
    expect(await media('tab-b')).toBe('network-2')
    expect(await media('tab-b')).toBe('network-3') // …and nothing is being cached for it either
  })
})

// A refusal in one tab must lock the others, because every tab rides the one session cookie the
// server just refused. A BroadcastChannel carries the denial; a receiving tab runs the same
// lockdown WITHOUT re-broadcasting (no echo loop). Immediate where a tab is listening; a tab still
// converges on its own next 401 regardless. Driven from a second channel, the way another tab would.
describe('AuthProvider — a denial broadcast from another tab', () => {
  it('locks this tab too: drops the view, denies the workspace cache, tells the worker', async () => {
    const result = await signedIn()
    const otherTab = new BroadcastChannel('kp-auth-denial')
    otherTab.postMessage('denied')

    await waitFor(() => expect(result.current.user).toBeNull()) // …the gate falls back to the kiosk login
    expect(denyWorkspaceCache).toHaveBeenCalled()
    await waitFor(() => expect(syncMediaCacheAuth).toHaveBeenCalledWith(null))
    expect(idbDel).toHaveBeenCalledWith('kp-front-user') // no offline restore of a dead session
    expect(setWorkspaceCacheOwner).toHaveBeenLastCalledWith(null)
    otherTab.close()
  })
})

// The other worker hole the auditor named (authMediaCache · controllerchange): a new service
// worker taking over re-sends the CURRENT context. Once a denial has set that to «logged-out», the
// re-send can only be «logged-out» — a refused session is never re-granted media access. Driven
// against the REAL authMediaCache (the rest of this file mocks it) with a stubbed worker container.
describe('authMediaCache — a denied session is never re-granted on controllerchange', () => {
  it('re-sends «logged-out», never the stale user grant', async () => {
    const posted: unknown[] = []
    let onControllerChange: () => void = () => {}
    let onWorkerMessage: (event: MessageEvent) => void = () => {}
    const controller = { postMessage: (m: unknown) => { posted.push(m) } }
    const fakeSW = {
      controller,
      ready: Promise.resolve({ active: controller }),
      addEventListener: (type: string, h: (event?: MessageEvent) => void) => {
        if (type === 'controllerchange') onControllerChange = () => h()
        if (type === 'message') onWorkerMessage = h
      },
    }
    const nav = navigator as unknown as { serviceWorker?: unknown }
    nav.serviceWorker = fakeSW
    try {
      const { syncMediaCacheAuth: real } = (await vi.importActual('./authMediaCache')) as typeof import('./authMediaCache')
      real({ id: 'u1' })        // a legitimate grant
      real(null)                // …then the session is denied → current becomes «logged-out»
      await fakeSW.ready        // let the ready.then re-send settle before we isolate the controllerchange
      await Promise.resolve()

      const before = posted.length
      onControllerChange()      // a new worker takes over
      expect(posted.slice(before)).toEqual([{ type: 'kp-media-auth', kind: 'logged-out' }])
      const afterController = posted.length
      onWorkerMessage(new MessageEvent('message', { data: { type: 'kp-media-auth-request' } }))
      expect(posted.slice(afterController)).toEqual([{ type: 'kp-media-auth', kind: 'logged-out' }])
      real({ id: 'u2' }) // only a new sign-in changes the answer to an idle restart's request
      const afterSignIn = posted.length
      onWorkerMessage(new MessageEvent('message', { data: { type: 'kp-media-auth-request' } }))
      expect(posted.slice(afterSignIn)).toEqual([{ type: 'kp-media-auth', kind: 'user', userId: 'u2' }])
    } finally {
      delete nav.serviceWorker
    }
  })
})

// Cold-start sweep 01.11.2026: a device with a cached session opens on it without waiting for
// /me — the probe runs behind the app, and its refusal locks the device as a mid-use one does.
describe('AuthProvider — a cached session opens at once', () => {
  it('is signed in before /me answers', async () => {
    vi.spyOn(deploymentConfig, 'isDemoMode').mockReturnValue(false)
    idbGet.mockResolvedValue(EDITOR_USER)
    apiGet.mockReturnValueOnce(new Promise(() => { /* /me still on its way */ }))
    const { result } = renderHook(() => useAuth(), { wrapper })
    await waitFor(() => expect(result.current.loading).toBe(false))
    expect(result.current.user).toEqual(EDITOR_USER)
    expect(setWorkspaceCacheOwner).toHaveBeenLastCalledWith('ed-1')
  })

  it('locks the opened app when /me then refuses', async () => {
    vi.spyOn(deploymentConfig, 'isDemoMode').mockReturnValue(false)
    idbGet.mockResolvedValue(EDITOR_USER)
    let rejectProbe!: (e: unknown) => void
    apiGet.mockReturnValueOnce(new Promise((_res, rej) => { rejectProbe = rej }))
    const { result } = renderHook(() => useAuth(), { wrapper })
    await waitFor(() => expect(result.current.user).toEqual(EDITOR_USER))

    await act(async () => { rejectProbe(new ApiError(401, 'Nicht angemeldet')); await Promise.resolve() })
    await waitFor(() => expect(result.current.user).toBeNull())
    expect(denyWorkspaceCache).toHaveBeenCalled()
    expect(idbDel).toHaveBeenCalledWith('kp-front-user')
    await waitFor(() => expect(syncMediaCacheAuth).toHaveBeenLastCalledWith(null))
  })
})

describe('AuthProvider — the boot probe is refused', () => {
  it.each([401, 403])('an explicit %i clears the cached identity, so no offline boot restores a dead session', async (status) => {
    vi.spyOn(deploymentConfig, 'isDemoMode').mockReturnValue(false)
    apiGet.mockRejectedValueOnce(new ApiError(status, 'refused'))
    const { result } = renderHook(() => useAuth(), { wrapper })
    await waitFor(() => expect(result.current.loading).toBe(false))
    expect(result.current.user).toBeNull()
    expect(idbDel).toHaveBeenCalledWith('kp-front-user') // the 403 used to leave the identity behind
  })

  it.each([0, 503])('keeps the cached identity when the server could not be asked (%i)', async (status) => {
    vi.spyOn(deploymentConfig, 'isDemoMode').mockReturnValue(false)
    apiGet.mockRejectedValueOnce(new ApiError(status, 'Netzwerkfehler'))
    const { result } = renderHook(() => useAuth(), { wrapper })
    await waitFor(() => expect(result.current.loading).toBe(false))
    expect(idbDel).not.toHaveBeenCalled() // silence refuses nothing — the cached session stands
  })
})

// SEC-10 — denial resurrection. Boot captures the cached user U and awaits GET /auth/me. While
// that await is in flight, another tab logs out; the broadcast runs denyLocally() HERE (denial
// set, user cleared, cache locked). Then this tab's probe fails with a NETWORK error (status 0),
// not a 401. The offline-fallback branch used to read that as «unverifiable → keep working» and
// restore U — and adoptUser(U) cleared the denial. The logout was silently undone. A denial epoch
// captured before the probe and re-checked after now makes the logout win.
describe('AuthProvider — a logout during the boot probe is not undone', () => {
  it('stays LOCKED when a broadcast denial lands mid-probe and the probe then fails on the network', async () => {
    vi.spyOn(deploymentConfig, 'isDemoMode').mockReturnValue(false)
    idbGet.mockResolvedValue(EDITOR_USER) // a cached session waiting behind the probe

    let rejectProbe!: (e: unknown) => void
    apiGet.mockReturnValueOnce(new Promise((_res, rej) => { rejectProbe = rej }))
    const { result } = renderHook(() => useAuth(), { wrapper })
    // let boot read the cache and fire the (now pending) /me probe
    await act(async () => { await Promise.resolve(); await Promise.resolve() })

    // another tab logs out while our /me is still in flight
    const otherTab = new BroadcastChannel('kp-auth-denial')
    otherTab.postMessage('denied')
    await waitFor(() => expect(denyWorkspaceCache).toHaveBeenCalled())
    expect(result.current.user).toBeNull()

    // …and only THEN does our probe fail with a NETWORK error (status 0), not a refusal
    await act(async () => { rejectProbe(new ApiError(0, 'Netzwerkfehler')); await Promise.resolve() })
    await waitFor(() => expect(result.current.loading).toBe(false))

    // the logout WON: the boot opened on the cached user, but the network failure does not
    // restore it — denial intact, the worker left on «logged-out»
    expect(result.current.user).toBeNull()
    expect(setWorkspaceCacheOwner).toHaveBeenLastCalledWith(null)
    expect(syncMediaCacheAuth).toHaveBeenLastCalledWith(null)
    otherTab.close()
  })

  it('still logs in on a live /me 200 mid-boot — a real answer legitimately lifts a denial', async () => {
    vi.spyOn(deploymentConfig, 'isDemoMode').mockReturnValue(false)
    vi.spyOn(deploymentConfig, 'getDeploymentConfig').mockReturnValue({ integrations: { cartoBasemapKey: 'k' } })
    idbGet.mockResolvedValue(EDITOR_USER)

    let resolveProbe!: (u: unknown) => void
    apiGet.mockReturnValueOnce(new Promise((res) => { resolveProbe = res }))
    const { result } = renderHook(() => useAuth(), { wrapper })
    await act(async () => { await Promise.resolve(); await Promise.resolve() })

    const otherTab = new BroadcastChannel('kp-auth-denial')
    otherTab.postMessage('denied')
    await waitFor(() => expect(denyWorkspaceCache).toHaveBeenCalled())

    // the server ANSWERS: this session is alive. The 200 lifts the denial (unlike the offline restore).
    await act(async () => { resolveProbe(EDITOR_USER); await Promise.resolve() })
    await waitFor(() => expect(result.current.user).toEqual(EDITOR_USER))
    expect(setWorkspaceCacheOwner).toHaveBeenLastCalledWith('ed-1')
    otherTab.close()
  })
})

describe('AuthProvider — signing out and back in', () => {
  it('treats an explicit logout as a refusal too', async () => {
    const result = await signedIn()
    apiPost.mockResolvedValue(undefined)

    await act(() => result.current.logout())

    expect(denyWorkspaceCache).toHaveBeenCalled()
    expect(setWorkspaceCacheOwner).toHaveBeenLastCalledWith(null)
    expect(idbDel).toHaveBeenCalledWith('kp-front-user')
  })

  it('hands the caches back to the account that signs in', async () => {
    vi.spyOn(deploymentConfig, 'isDemoMode').mockReturnValue(false)
    vi.spyOn(deploymentConfig, 'loadDeploymentConfig').mockResolvedValue({})
    apiGet.mockRejectedValue(new ApiError(401, 'unauth'))
    const { result } = renderHook(() => useAuth(), { wrapper })
    await waitFor(() => expect(result.current.loading).toBe(false))
    apiPost.mockResolvedValue(EDITOR_USER)

    await act(() => result.current.login('ed-1', '123456'))

    // the owner id is what lifts the denial in the sync engine — same user, same cache
    expect(setWorkspaceCacheOwner).toHaveBeenLastCalledWith('ed-1')
    expect(result.current.sessionExpired).toBe(false)
  })
})

describe('AuthProvider — the demo auto-login', () => {
  // Regression (06.09.): a cold boot with no cookies 401s its probe, the refused refresh fires
  // SESSION_EXPIRED_EVENT, and the flag it set outlived the auto-login — every demo visitor got
  // a permanent «Anmeldung abgelaufen» banner over a session that was seconds old.
  it('lifts the boot 401 expiry flag once the visitor is signed in', async () => {
    vi.spyOn(deploymentConfig, 'isDemoMode').mockReturnValue(true)
    vi.spyOn(deploymentConfig, 'loadDeploymentConfig').mockResolvedValue({})
    apiGet.mockImplementation((path: string) =>
      path === '/api/auth/roster'
        ? Promise.resolve([{ id: 'ed-1', role: 'editor' }])
        : Promise.reject(new ApiError(401, 'Nicht angemeldet')),
    )
    apiPost.mockResolvedValue(EDITOR_USER)

    const { result } = renderHook(() => useAuth(), { wrapper })
    // the boot's own failed refresh — fired while the probe is still deciding
    act(() => { window.dispatchEvent(new Event(SESSION_EXPIRED_EVENT)) })

    await waitFor(() => expect(result.current.user).toEqual(EDITOR_USER))
    await waitFor(() => expect(result.current.sessionExpired).toBe(false))
  })
})
