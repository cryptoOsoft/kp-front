// Make room for the incident record by throwing away map tiles.
//
// Everything cached for offline use shares one origin quota, and when it runs out the loser is
// whatever tries to write next — which, on a working Lage, is the workspace. That ordering is
// backwards: a map tile is re-downloadable from the internet in a second, the Lagekarte is not
// reproducible at all. So when a workspace write is refused we evict tiles and try again.
//
// The base-map tiles are the right victim (lib/tileStore, kind `map`). They are the largest
// consumer by far (up to 4000 entries, plus whatever «Alles für offline laden» pushed in), and
// the only store holding purely derivative data — plan PDFs, reference geodata and incident
// media are all station or incident records.

import { deleteTiles, LEGACY_TILE_CACHES, tileUrls } from './tileStore'

/** How many tiles to drop per attempt. Big enough that one pass frees real space (≈ 15 MB at
 *  30 KB/tile, ≈ 45 MB of a retina screen's 2× tiles), small enough that an operator who prefetched an area doesn't lose all of it. */
export const EVICT_BATCH = 500
/** Minimum gap between two evictions. A burst of refused writes (every keystroke on a full
 *  device, before the cache write was debounced) used to cost one batch PER write — a 10-word
 *  Bemerkung wiped the prefetched map area in seconds. One batch per window is all the rescue a
 *  write needs; if that did not make room, tiles were not the problem. */
export const EVICT_MIN_GAP_MS = 30_000
let lastEvictAt = -Infinity

/**
 * Delete up to `batch` of the OLDEST stored map tiles. Returns how many were removed (0 when
 * nothing is stored, the store is unavailable, or an eviction ran less than EVICT_MIN_GAP_MS ago).
 * Oldest = least recently STORED (the worker's `at`), so an older area goes before the one just
 * downloaded. A legacy `map-tiles` cache not moved over yet (lib/tileStore) is older than all of
 * them and goes whole.
 */
export async function evictOldTiles(batch = EVICT_BATCH): Promise<number> {
  const now = Date.now()
  if (now - lastEvictAt < EVICT_MIN_GAP_MS) return 0 // rate-limited: reads as «nothing to evict»
  lastEvictAt = now
  try {
    return await dropLegacyTiles() || await deleteTiles((await tileUrls('map'))?.slice(0, batch) ?? [])
  } catch {
    return 0 // eviction is a best-effort rescue; never let it become its own failure
  }
}

/** Delete the legacy map-tile cache; how many tiles it held (0 without one). */
async function dropLegacyTiles(): Promise<number> {
  if (typeof caches === 'undefined' || !(await caches.has(LEGACY_TILE_CACHES.map))) return 0
  const held = (await (await caches.open(LEGACY_TILE_CACHES.map)).keys()).length
  return (await caches.delete(LEGACY_TILE_CACHES.map)) ? held : 0
}

/**
 * Run `write`, and if it reports failure, free tile space and try once more.
 *
 * One retry, not a loop: if a single 500-tile eviction didn't help, the pressure is not coming
 * from tiles and hammering the cache would only destroy the operator's prefetched area for
 * nothing. The caller still gets `false` and surfaces the degraded state.
 */
export async function withTileEviction(write: () => Promise<boolean>): Promise<boolean> {
  if (await write()) return true
  if ((await evictOldTiles()) === 0) return false
  return write()
}
