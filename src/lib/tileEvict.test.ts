import 'fake-indexeddb/auto'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { EVICT_BATCH, EVICT_MIN_GAP_MS, evictOldTiles, withTileEviction } from './tileEvict'
import { clearTiles, tileUrls } from './tileStore'
import { seedTiles } from './tileStore.test-utils'

// The precedence this encodes: a map tile is re-downloadable in a second, the Lagekarte is not.
// So when the device is full it is the scenery that goes, not the incident record.

const urls = (n: number) => Array.from({ length: n }, (_, i) => `https://a.basemaps.cartocdn.com/t${i}.png`)
const held = async () => (await tileUrls('map')) ?? []

/** A Cache Storage holding a legacy `map-tiles` cache of these URLs (tiles before 08.11.2026). */
function legacyCaches(urls: string[]) {
  const held = new Set(urls)
  const cache = { keys: async () => [...held].map((url) => ({ url })), delete: async (r: { url: string }) => held.delete(r.url) }
  vi.stubGlobal('caches', {
    has: async (n: string) => n === 'map-tiles' && held.size > 0,
    open: async () => cache,
    delete: async (n: string) => { if (n !== 'map-tiles') return false; held.clear(); return true },
  })
  return held
}

// The rate limit is module state, so every test starts a full window after the last one — a
// monotonic clock, because real time would sit behind the fake time the previous test left.
let clock = Date.now()
// only Date: IndexedDB needs the real timers
beforeEach(async () => { await clearTiles(); clock += EVICT_MIN_GAP_MS + 1; vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(clock) })
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals() })

describe('evictOldTiles', () => {
  it('drops the OLDEST stored tiles first', async () => {
    // stored newest-first: the order of the URLs is not the order of their age
    await seedTiles('map', urls(10), (i) => 100 - i)
    expect(await evictOldTiles(3)).toBe(3)
    expect(await held()).toEqual(urls(7).reverse())
  })

  it('drops a legacy map-tile cache first, whole – it is older than everything stored', async () => {
    const legacy = legacyCaches(['https://a.basemaps.cartocdn.com/old0.png', 'https://a.basemaps.cartocdn.com/old1.png'])
    await seedTiles('map', urls(3))
    expect(await evictOldTiles()).toBe(2)
    expect(legacy.size).toBe(0)
    expect(await held()).toHaveLength(3)
  })

  it('leaves plan tiles alone – they are station records', async () => {
    await seedTiles('plan', ['https://kp.test/api/reference/plan:a/tiles/1/0/0/0/0'], () => 0)
    await seedTiles('map', urls(2), (i) => 1 + i)
    expect(await evictOldTiles(5)).toBe(2)
    expect(await tileUrls('plan')).toHaveLength(1)
  })

  it('caps at the batch size, so one rescue cannot wipe a prefetched area', async () => {
    await seedTiles('map', urls(EVICT_BATCH + 250))
    expect(await evictOldTiles()).toBe(EVICT_BATCH)
    expect(await held()).toHaveLength(250)
  })

  it('is a no-op when nothing is stored', async () => {
    expect(await evictOldTiles()).toBe(0)
  })

  it('runs at most once per window — a burst of refused writes costs one batch, not one per key', async () => {
    await seedTiles('map', urls(10))
    expect(await evictOldTiles(3)).toBe(3)
    expect(await evictOldTiles(3)).toBe(0) // inside the window: nothing more is sacrificed
    expect(await held()).toHaveLength(7)
    vi.setSystemTime(clock + EVICT_MIN_GAP_MS)
    expect(await evictOldTiles(3)).toBe(3)
    expect(await held()).toHaveLength(4)
  })

  it('never becomes its own failure', async () => {
    vi.stubGlobal('indexedDB', undefined)
    await expect(evictOldTiles()).resolves.toBe(0)
  })
})

describe('withTileEviction', () => {
  it('does not touch the cache when the write succeeds', async () => {
    await seedTiles('map', urls(1))
    const write = vi.fn().mockResolvedValue(true)
    expect(await withTileEviction(write)).toBe(true)
    expect(write).toHaveBeenCalledTimes(1)
    expect(await held()).toHaveLength(1) // nothing sacrificed for a write that was fine
  })

  it('evicts and retries once when the write is refused', async () => {
    await seedTiles('map', urls(2))
    const write = vi.fn().mockResolvedValueOnce(false).mockResolvedValueOnce(true)
    expect(await withTileEviction(write)).toBe(true)
    expect(write).toHaveBeenCalledTimes(2)
    expect(await held()).toHaveLength(0)
  })

  it('retries ONCE, not in a loop — if tiles were not the problem, stop destroying them', async () => {
    await seedTiles('map', urls(EVICT_BATCH + 10))
    const write = vi.fn().mockResolvedValue(false)
    expect(await withTileEviction(write)).toBe(false)
    expect(write).toHaveBeenCalledTimes(2)
  })

  it('a second refused write inside the window is not retried — tiles were not the problem', async () => {
    await seedTiles('map', urls(EVICT_BATCH + 10))
    const write = vi.fn().mockResolvedValue(false)
    expect(await withTileEviction(write)).toBe(false)
    expect(write).toHaveBeenCalledTimes(2) // first: evict + retry
    expect(await withTileEviction(write)).toBe(false)
    expect(write).toHaveBeenCalledTimes(3) // second: rate-limited eviction = nothing freed = no retry
  })

  it('does not retry when there was nothing to evict', async () => {
    const write = vi.fn().mockResolvedValue(false)
    expect(await withTileEviction(write)).toBe(false)
    expect(write).toHaveBeenCalledTimes(1) // no point re-running against unchanged space
  })
})
