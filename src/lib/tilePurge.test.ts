import 'fake-indexeddb/auto'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { purgeStaleTiles, TILE_PURGES } from './tilePurge'
import { clearTiles, tileUrls } from './tileStore'
import { seedTiles } from './tileStore.test-utils'

beforeEach(() => clearTiles())

/** The map tiles held now, oldest first. */
const held = async () => (await tileUrls('map')) ?? []

function fakeStorage(init: Record<string, string> = {}) {
  const m = new Map(Object.entries(init))
  return { m, api: { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => { m.set(k, v) } } }
}

const CARTO_DARK = 'https://b.basemaps.cartocdn.com/dark_all/18/136574/91654.png?key=k'
const CARTO_DAY = 'https://basemaps.cartocdn.com/rastertiles/voyager/17/68287/45827.png'
const OSM = 'https://tile.openstreetmap.org/17/68287/45827.png'
const SWISSIMAGE = 'https://wmts.geo.admin.ch/1.0.0/ch.swisstopo.swissimage/default/current/3857/17/68287/45827.jpeg'

describe('purgeStaleTiles', () => {
  it('deletes the stale provider tiles once and keeps every other base map', async () => {
    await seedTiles('map', [CARTO_DARK, CARTO_DAY, OSM, SWISSIMAGE])
    const st = fakeStorage()
    expect(await purgeStaleTiles({ storage: st.api, online: true, retina: true })).toBe(2)
    expect(await held()).toEqual([OSM, SWISSIMAGE])
    expect(JSON.parse(st.m.get('kp.tilePurges')!)).toEqual(TILE_PURGES.map((p) => p.id))
    // a tile fetched afresh after the purge is the new look: never thrown away again
    await seedTiles('map', [CARTO_DARK], () => 10)
    expect(await purgeStaleTiles({ storage: st.api, online: true })).toBe(0)
    expect(await held()).toContain(CARTO_DARK)
  })

  it('never runs offline — an old look beats no map — and runs on the next boot online', async () => {
    await seedTiles('map', [CARTO_DARK])
    const st = fakeStorage()
    expect(await purgeStaleTiles({ storage: st.api, online: false })).toBe(0)
    expect(await held()).toEqual([CARTO_DARK])
    expect(st.m.has('kp.tilePurges')).toBe(false)
    expect(await purgeStaleTiles({ storage: st.api, online: true })).toBe(1)
  })

  it('a store that cannot be read is not marked done', async () => {
    vi.stubGlobal('indexedDB', undefined)
    try {
      const st = fakeStorage()
      expect(await purgeStaleTiles({ storage: st.api, online: true })).toBe(0)
      expect(st.m.has('kp.tilePurges')).toBe(false)
    } finally { vi.unstubAllGlobals() }
  })

  it('only the purges this device has not run yet', async () => {
    await seedTiles('map', [CARTO_DARK, OSM])
    const st = fakeStorage({ 'kp.tilePurges': JSON.stringify(['carto-gl-2026-10']) })
    const purges = [...TILE_PURGES, { id: 'osm-test', match: /tile\.openstreetmap\.org/ }]
    expect(await purgeStaleTiles({ storage: st.api, online: true, purges })).toBe(1)
    expect(await held()).toEqual([CARTO_DARK])
  })

  // review round 4: a retina screen asks CARTO for `@2x` tiles (lib/carto · withCartoRetina); the
  // 1× ones it held are addresses the map never asks for again
  it('drops the 1× CARTO tiles on a retina screen only, and keeps the 2× ones', async () => {
    const done = fakeStorage({ 'kp.tilePurges': JSON.stringify(['carto-gl-2026-10']) })
    const RETINA = 'https://b.basemaps.cartocdn.com/dark_all/18/136574/91654@2x.png?key=k'
    await seedTiles('map', [CARTO_DARK, CARTO_DAY, RETINA, OSM])
    // a 1× screen still draws its 1× tiles: nothing goes, and it is asked again on the next boot
    expect(await purgeStaleTiles({ storage: done.api, online: true, retina: false })).toBe(0)
    expect(await held()).toHaveLength(4)
    expect(JSON.parse(done.m.get('kp.tilePurges')!)).toEqual(['carto-gl-2026-10'])
    expect(await purgeStaleTiles({ storage: done.api, online: true, retina: true })).toBe(2)
    expect(await held()).toEqual([RETINA, OSM])
    expect(JSON.parse(done.m.get('kp.tilePurges')!)).toContain('carto-retina-2026-10')
  })
})
