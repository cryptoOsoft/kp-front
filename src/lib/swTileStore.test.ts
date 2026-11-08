import 'fake-indexeddb/auto'
import { readFileSync } from 'node:fs'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { clearTiles, hasTile, readTile, tileUrls } from './tileStore'
import { seedTiles } from './tileStore.test-utils'

// public/sw-tile-store.js run against fake-indexeddb, read back through the page's lib/tileStore –
// so the two halves are pinned to one schema.

type Handler = (event: Record<string, unknown>) => void
const source = readFileSync(new URL('../../public/sw-tile-store.js', import.meta.url), 'utf8')

const MAP = (i: number) => `https://a.basemaps.cartocdn.com/rastertiles/voyager/17/${i}/1.png`
const PLAN = 'https://kp.test/api/reference/plan:a/tiles/3/1/2/0/0'
const MANIFEST = 'https://kp.test/api/reference/plan:a/tiles?v=3'

function worker({ allowed = true, legacy = {} as Record<string, string[]> } = {}) {
  const handlers = new Map<string, Handler>()
  const caches = new Map(Object.entries(legacy).map(([name, urls]) => [name, new Map(urls.map((u) => [u, `old ${u}`]))]))
  const cacheStorage = {
    has: async (name: string) => caches.has(name),
    open: async (name: string) => {
      const c = caches.get(name) ?? new Map<string, string>()
      caches.set(name, c)
      const key = (r: RequestInfo) => (typeof r === 'string' ? r : r.url)
      return {
        match: async (r: RequestInfo) => (c.has(key(r)) ? new Response(c.get(key(r)), { headers: { 'content-type': 'image/png' } }) : undefined),
        keys: async () => [...c.keys()].map((u) => new Request(u)),
        delete: async (r: RequestInfo) => c.delete(key(r)),
      }
    },
    delete: async (name: string) => caches.delete(name),
  }
  let n = 0
  let offline = false
  const fetchMock = vi.fn(async (_req: Request, _init?: RequestInit) => {
    if (offline) throw new TypeError('Load failed')
    return new Response(`net-${++n}`, { headers: { 'content-type': 'image/png' } })
  })
  // the store's 2 s trims, fired by hand
  const trims: Array<() => void> = []
  const timer = (fn: () => void, ms: number) => (ms === 2000 ? trims.push(fn) : setTimeout(fn, ms))
  const self = {
    location: { origin: 'https://kp.test' },
    addEventListener: (type: string, h: Handler) => { handlers.set(type, h) },
    kpReferenceCacheAllowed: async () => allowed,
    kpClearTiles: undefined as undefined | ((kinds: string[]) => Promise<void>),
  }
  new Function('self', 'caches', 'fetch', 'setTimeout', source)(self, cacheStorage, fetchMock, timer)

  /** One fetch through the worker: its body, or null when the worker let it pass. */
  async function get(url: string): Promise<string | null> {
    let response: Promise<Response> | undefined
    const waits: Promise<unknown>[] = []
    handlers.get('fetch')!({
      request: new Request(url),
      clientId: 'tablet',
      stopImmediatePropagation: () => {},
      respondWith: (p: Promise<Response>) => { response = p },
      waitUntil: (p: Promise<unknown>) => { waits.push(p) },
    })
    if (!response) return null
    const body = await (await response).text()
    for (let i = 0; i < waits.length; i++) await waits[i]
    return body
  }

  async function message(data: object) {
    let pending: Promise<unknown> = Promise.resolve()
    handlers.get('message')!({ data, waitUntil: (p: Promise<unknown>) => { pending = p } })
    await pending
  }

  async function trim() {
    for (const fn of trims.splice(0)) fn()
    await new Promise((r) => setTimeout(r, 50))
  }

  return { get, message, trim, fetchMock, caches, self, goOffline: () => { offline = true } }
}

beforeEach(async () => {
  vi.stubGlobal('location', { href: 'https://kp.test/' })
  await clearTiles()
})
afterEach(() => vi.unstubAllGlobals())

describe('sw-tile-store', () => {
  it('keeps a map tile after its first fetch, and the page sees it', async () => {
    const w = worker()
    expect(await w.get(MAP(1))).toBe('net-1')
    expect(await w.get(MAP(1))).toBe('net-1')
    expect(w.fetchMock).toHaveBeenCalledOnce()
    // past the HTTP cache: a purged tile must not come back in the old look (lib/tilePurge)
    expect(w.fetchMock.mock.calls[0][1]).toEqual({ cache: 'no-cache' })
    expect(await hasTile(MAP(1))).toBe(true)
    expect(await tileUrls('map')).toEqual([MAP(1)])
  })

  it('lets everything else pass to Workbox', async () => {
    const w = worker()
    expect(await w.get('https://kp.test/api/reference/plan:a?v=3')).toBeNull()
    expect(await w.get('https://kp.test/assets/index.js')).toBeNull()
  })

  it('fetches an expired tile again, and offline still answers with it', async () => {
    await seedTiles('map', [MAP(1), MAP(2)], () => Date.now() - 31 * 24 * 3600 * 1000)
    const w = worker()
    expect(await w.get(MAP(1))).toBe('net-1')
    w.goOffline()
    expect(await w.get(MAP(2))).toBe('t')
  })

  it('sends a plan tile of a client that is no account to the network, unstored', async () => {
    const w = worker({ allowed: false })
    expect(await w.get(PLAN)).toBe('net-1')
    expect((w.fetchMock.mock.calls[0][0]).cache).toBe('no-store')
    expect(await tileUrls('plan')).toEqual([])
  })

  it('asks the network first for a manifest and answers from the copy offline', async () => {
    const w = worker()
    expect(await w.get(MANIFEST)).toBe('net-1')
    expect(await w.get(MANIFEST)).toBe('net-2')
    w.goOffline()
    expect(await w.get(MANIFEST)).toBe('net-2')
    expect(await (await readTile(MANIFEST))?.text()).toBe('net-2')
  })

  it('keeps a kind to its maximum, oldest first', async () => {
    await seedTiles('map', Array.from({ length: 4000 }, (_, i) => MAP(i)))
    const w = worker()
    await w.get(MAP(9999))
    await w.trim()
    const held = await tileUrls('map')
    expect(held).toHaveLength(4000)
    expect(held).not.toContain(MAP(0))
    expect(held).toContain(MAP(9999))
  })

  it('answers from the old Cache Storage copy and moves it all over', async () => {
    const other = 'https://kp.test/api/reference/plan:a/tiles/3/1/2/0/1'
    const w = worker({ legacy: { 'plan-tiles': [PLAN, other] } })
    expect(await w.get(PLAN)).toBe(`old ${PLAN}`)
    expect(w.fetchMock).not.toHaveBeenCalled()
    await w.message({ type: 'kp-tile-migrate' })
    expect(w.caches.has('plan-tiles')).toBe(false)
    expect((await tileUrls('plan'))?.sort()).toEqual([PLAN, other].sort())
    expect(await w.get(other)).toBe(`old ${other}`)
  })

  it('drops only the station plans on a denial (sw-media-cache · kpClearOnDenial)', async () => {
    await seedTiles('map', [MAP(1)])
    await seedTiles('plan', [PLAN])
    await seedTiles('manifest', [MANIFEST])
    const w = worker()
    await w.self.kpClearTiles!(['plan', 'manifest'])
    expect(await tileUrls('map')).toEqual([MAP(1)])
    expect(await tileUrls('plan')).toEqual([])
    expect(await tileUrls('manifest')).toEqual([])
  })
})
