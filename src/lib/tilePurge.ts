// Throw away base-map tiles a provider has since drawn differently — once per device.
//
// The service worker keeps base tiles CACHE-FIRST for 30 days (lib/tileStore, kind `map`), so a
// place looked at once renders with no signal. The price: when a provider re-renders its map
// under the SAME URL, a device shows the old look wherever it still holds a tile and the new one
// everywhere else, tile by tile. That is the «seam» of the owner's review (17.10.2026, staging on
// an iPhone, night): CARTO now renders Dark Matter from its GL style (ground #0e0e0e, buildings
// #393939 LIGHTER than the ground, minor roads a blue-grey #414758), where the tiles cached in
// September were the old raster style (buildings darker than the ground, a grain on the land).
// Under the night paint (components/MapLayers · DARK_BASE_PAINT) the two read as two different
// maps — pixel-exact: the light half of the screenshot is the new style, the stippled dark half
// the old one.
//
// So: each entry below names a provider change and the tile URLs it made stale; the first boot
// ONLINE after the entry ships deletes those stored tiles, and the map fetches them
// fresh. Never offline — a device without signal keeps the map it has, an old look beats no map —
// and never twice (the done ids are a tiny device flag in localStorage, docs/sync-and-offline.md).
// A provider changes its look again → add an entry; never edit or reuse an id.

import { deleteTiles, LEGACY_TILE_CACHES, tileUrls } from './tileStore'

export interface TilePurge {
  /** stable, never reused: it is what a device remembers as done */
  id: string
  /** the tile URLs this change made stale */
  match: RegExp
  /** only on a device where this holds (asked again on every boot until it does) */
  when?: (device: { retina: boolean }) => boolean
}

export const TILE_PURGES: readonly TilePurge[] = [
  // CARTO's GL-rendered Voyager / Dark Matter replaced the raster style under the same URLs
  // (seen 17.10.2026; the tiles measured on 20.09.2026 were still the old style)
  { id: 'carto-gl-2026-10', match: /^https:\/\/([a-d]\.)?basemaps\.cartocdn\.com\// },
  // A retina screen asks CARTO for its 2× tiles now (lib/carto · withCartoRetina, review round 4:
  // the blurry map). The 1× tiles it cached before sit under addresses the map never asks for
  // again — up to the cache's 4000 entries of dead weight in the one origin quota the incident
  // record shares — so they go. A 1× screen still uses them and keeps them.
  {
    id: 'carto-retina-2026-10',
    match: /^https:\/\/([a-d]\.)?basemaps\.cartocdn\.com\/.*\/\d+\/\d+\/\d+\.png(?:$|[?#])/,
    when: ({ retina }) => retina,
  },
]

const DONE_KEY = 'kp.tilePurges'

function readDone(storage: Pick<Storage, 'getItem'> | null): Set<string> {
  try {
    const v = JSON.parse(storage?.getItem(DONE_KEY) ?? '[]') as unknown
    return new Set(Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : [])
  } catch {
    return new Set()
  }
}

/**
 * Run every purge this device has not run yet. Returns how many tiles were deleted. Best-effort
 * and silent: no tile store, no localStorage or no network → nothing happens, and it is asked
 * again on the next boot.
 */
export async function purgeStaleTiles(env: {
  storage?: Pick<Storage, 'getItem' | 'setItem'> | null
  online?: boolean
  purges?: readonly TilePurge[]
  /** the screen takes 2× tiles — lib/carto · wantsRetinaTiles, spelled out (boot path, above) */
  retina?: boolean
} = {}): Promise<number> {
  let storage: Pick<Storage, 'getItem' | 'setItem'> | null
  try { storage = env.storage !== undefined ? env.storage : window.localStorage } catch { storage = null }
  const online = env.online ?? (typeof navigator === 'undefined' || navigator.onLine !== false)
  const purges = env.purges ?? TILE_PURGES
  if (!storage || !online) return 0
  const retina = env.retina ?? (typeof window !== 'undefined' && (window.devicePixelRatio || 1) > 1)
  const done = readDone(storage)
  const todo = purges.filter((p) => !done.has(p.id) && (!p.when || p.when({ retina })))
  if (!todo.length) return 0
  const isStale = (url: string) => todo.some((p) => p.match.test(url))
  const stale = (await tileUrls('map'))?.filter(isStale)
  const legacy = await purgeLegacy(isStale)
  const removed = stale ? await deleteTiles(stale) : 0
  // not marked done: the next boot tries again
  if (!stale || legacy === null || removed < stale.length) return 0
  for (const p of todo) done.add(p.id)
  try { storage.setItem(DONE_KEY, JSON.stringify([...done])) } catch { /* asked again next boot */ }
  return removed + legacy
}

/** …and from a legacy `map-tiles` cache not moved over yet (lib/tileStore), so the worker
 *  neither serves nor moves them; null when it could not be read. */
async function purgeLegacy(isStale: (url: string) => boolean): Promise<number | null> {
  try {
    if (typeof caches === 'undefined' || !(await caches.has(LEGACY_TILE_CACHES.map))) return 0
    const cache = await caches.open(LEGACY_TILE_CACHES.map)
    const gone = await Promise.all((await cache.keys()).filter((r) => isStale(r.url)).map((r) => cache.delete(r)))
    return gone.filter(Boolean).length
  } catch { return null }
}
