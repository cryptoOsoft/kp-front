import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const manifest = (complete: boolean) => ({
  tileSize: 512, complete,
  pages: [{ page: 0, widthPt: 595, heightPt: 842, levels: [
    { z: 0, width: 310, height: 438, cols: 1, rows: 1 },
    { z: 1, width: 620, height: 877, cols: 2, rows: 2 },
  ] }],
})

describe('prefetchPlanTiles', () => {
  let fetched: string[]
  let store: Set<string>
  let complete: boolean
  const settle = () => new Promise((r) => setTimeout(r, 20))

  beforeEach(() => {
    vi.resetModules()
    fetched = []; store = new Set(); complete = true
    vi.stubGlobal('navigator', { onLine: true, serviceWorker: { controller: {} } })
    vi.doMock('./tileStore', () => ({ hasTile: async (u: string) => store.has(u) }))
    vi.stubGlobal('fetch', async (u: string) => {
      if (u.endsWith('/tiles?v=3')) return { ok: true, status: 200, json: async () => manifest(complete) }
      fetched.push(u); store.add(u)
      return { ok: true, status: 200, arrayBuffer: async () => new ArrayBuffer(1) }
    })
  })
  afterEach(() => vi.unstubAllGlobals())

  it('fetches every tile of a complete pyramid once, whatever page the URL names', async () => {
    const { prefetchPlanTiles } = await import('./planTilePrefetch')
    prefetchPlanTiles(['/api/reference/plan%3Ax%3Amodul6?v=3#page=0', '/api/reference/plan%3Ax%3Amodul6?v=3'])
    await settle()
    expect(fetched).toHaveLength(5)
    expect(new Set(fetched).size).toBe(5)
    prefetchPlanTiles(['/api/reference/plan%3Ax%3Amodul6?v=3'])
    await settle()
    expect(fetched).toHaveLength(5)
  })

  it('leaves a pyramid the server has not finished for the next visit', async () => {
    complete = false
    const { prefetchPlanTiles } = await import('./planTilePrefetch')
    prefetchPlanTiles(['/api/reference/plan%3Ax%3Amodul6?v=3'])
    await settle()
    expect(fetched).toEqual([])
  })

  it('skips a sheet whose last tile is already kept, and tiles already kept within one', async () => {
    const { prefetchPlanTiles } = await import('./planTilePrefetch')
    store.add('/api/reference/plan%3Ax%3Amodul6/tiles/3/0/1/1/1')
    prefetchPlanTiles(['/api/reference/plan%3Ax%3Amodul6?v=3'])
    await settle()
    expect(fetched).toEqual([])
  })

  it('does nothing without a controlling service worker, on «Datensparmodus», or for a sheet without tiles', async () => {
    const { prefetchPlanTiles } = await import('./planTilePrefetch')
    prefetchPlanTiles(['/plans/bundled.pdf', '/api/reference/plan%3Ax%3Amodul6'])
    vi.stubGlobal('navigator', { onLine: true, serviceWorker: { controller: null } })
    prefetchPlanTiles(['/api/reference/plan%3Ax%3Amodul6?v=3'])
    vi.stubGlobal('navigator', { onLine: true, serviceWorker: { controller: {} }, connection: { saveData: true } })
    prefetchPlanTiles(['/api/reference/plan%3Ay%3Amodul6?v=3'])
    await settle()
    expect(fetched).toEqual([])
  })
})
