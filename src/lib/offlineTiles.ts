// Pre-download a map area for offline use. We just `fetch()` each tile URL — the service
// worker's tile store (public/sw-tile-store.js) keeps the responses, so the
// base map renders later with no signal. Downloads stay CORS-only because opaque responses are
// padded heavily in iOS Cache Storage; supported raster hosts must therefore send CORS headers.

import { eitherSignal, timeoutSignal } from './api'

export interface LngLatBounds {
  west: number
  south: number
  east: number
  north: number
}

function lon2tile(lon: number, z: number): number {
  return Math.floor(((lon + 180) / 360) * 2 ** z)
}
function lat2tile(lat: number, z: number): number {
  const r = (lat * Math.PI) / 180
  return Math.floor(((1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2) * 2 ** z)
}

/** All {z,x,y} tiles covering `bounds` across the inclusive zoom range. */
export function tilesForBounds(b: LngLatBounds, minZ: number, maxZ: number): Array<{ z: number; x: number; y: number }> {
  const out: Array<{ z: number; x: number; y: number }> = []
  for (let z = minZ; z <= maxZ; z++) {
    const max = 2 ** z - 1
    const x0 = Math.max(0, lon2tile(b.west, z))
    const x1 = Math.min(max, lon2tile(b.east, z))
    const y0 = Math.max(0, lat2tile(b.north, z)) // north = smaller y
    const y1 = Math.min(max, lat2tile(b.south, z))
    for (let x = x0; x <= x1; x++) for (let y = y0; y <= y1; y++) out.push({ z, x, y })
  }
  return out
}

const WEB_MERCATOR_HALF_WORLD = 20037508.342789244

/** EPSG:3857 bounds for one XYZ tile, in the order WMS BBOX expects. */
export function tileBbox3857(z: number, x: number, y: number): string {
  const span = (WEB_MERCATOR_HALF_WORLD * 2) / 2 ** z
  const west = -WEB_MERCATOR_HALF_WORLD + x * span
  const north = WEB_MERCATOR_HALF_WORLD - y * span
  return `${west},${north - span},${west + span},${north}`
}

/** Fill both ordinary XYZ/WMTS templates and MapLibre's WMS bbox placeholder. */
export function fillTileTemplate(tpl: string, z: number, x: number, y: number): string {
  return tpl
    .replace('{z}', String(z))
    .replace('{x}', String(x))
    .replace('{y}', String(y))
    .replace('{bbox-epsg-3857}', tileBbox3857(z, x, y))
}

/** The OSM Foundation's tile servers forbid bulk pre-fetching in their usage policy
 *  (operations.osmfoundation.org/policies/tiles). Viewing them is fine; warming 1200 tiles at a
 *  time is not. A base on such a host is pre-downloaded from the fallback (Carto) instead. */
const NO_BULK_HOSTS = ['tile.openstreetmap.org']

export function bulkFetchAllowed(tpl: string): boolean {
  let host: string
  try { host = new URL(tpl).hostname } catch { return true }
  return !NO_BULK_HOSTS.some((h) => host === h || host.endsWith(`.${h}`))
}

/**
 * What the download actually achieved — attempts AND hits, separately.
 *
 * ⚠️ Every `fetch` failure in here is swallowed on purpose (offline, no CORS, a blocked host):
 * one dead tile must not abort the other 1200. That is fine as long as the OUTCOME is honest,
 * and until 22.08. it was not: the caller only ever saw a progress bar that reached 100 % either
 * way and toasted «Karte offline verfügbar (0 Kacheln)» in green at somebody standing on dead
 * WLAN in the Magazin. Both halves are counted so the caller can tell vollständig / teilweise /
 * nichts / keine Abdeckung apart — four different messages, not one message with different
 * numbers (see the notFound/failed split below for why a 404 is not a miss).
 */
export interface PredownloadResult {
  /** tiles that actually came back */
  fetched: number
  /** tiles attempted (after the cap) */
  total: number
  /** warm resources (plan PDFs, symbol library, GeoJSON overlays) that actually came back */
  warmFetched: number
  /** warm resources attempted */
  warmTotal: number
  /** Requests (tiles + warm) answered 404 — the resource genuinely does not exist: a tile
   *  outside the provider's coverage at that zoom, a layer edge. DONE, not retryable — a
   *  «Weiterladen» can never fill these, so counting them as misses made «Teilweise geladen»
   *  a state some areas could never leave. */
  notFound: number
  /** requests (tiles + warm) that failed retryably — a network error or a 5xx. These are the
   *  only ones «Weiterladen» can still fetch. */
  failed: number
  capped: boolean
}

export interface PredownloadOpts {
  templates: string[] // base-layer tile URL template(s); cycled per tile to spread hosts
  /** One template group per raster reference layer. A group's entries are equivalent hosts and
   *  are cycled; every group is fetched for every covered tile. */
  overlayTemplates?: string[][]
  bounds: LngLatBounds
  minZoom?: number
  maxZoom?: number
  cap?: number // hard tile-count limit (avoid runaway downloads)
  warmUrls?: string[] // extra same-origin URLs (plans, symbols, geojson)
  onProgress?: (done: number, total: number) => void
  concurrency?: number
  /** Abort: no further request is issued, the in-flight ones are cut, and the promise REJECTS
   *  with the signal's reason — a cancelled download must not toast «teilweise geladen». */
  signal?: AbortSignal
}

/** Per-tile bound. A tile is a few KB; on a half-open link the three workers used to hang for
 *  ever, and with them the bar, the button and the automatic self-warm for the rest of the
 *  session. Ten seconds is generous for a tile and short enough that a dead host is over in
 *  minutes, not never. */
const TILE_TIMEOUT_MS = 10_000

/** Warm the SW caches for an area + a set of extra resources. */
export async function predownloadArea(opts: PredownloadOpts): Promise<PredownloadResult> {
  const minZ = opts.minZoom ?? 14
  // Default to z17 (building-level): z18 roughly QUADRUPLES the tile count of the whole stack,
  // and pushing that many through the SW into Cache Storage OOMs an iPad. z17 keeps the scene
  // legible at a fraction of the bytes.
  const maxZ = opts.maxZoom ?? 17
  const cap = opts.cap ?? 1500
  const tiles = tilesForBounds(opts.bounds, minZ, maxZ)
  const capped = tiles.length > cap
  const use = capped ? tiles.slice(0, cap) : tiles

  const urlsFor = (templates: string[]) => use.map((t, i) => fillTileTemplate(templates[i % templates.length], t.z, t.x, t.y))
  const tileUrls = [
    ...urlsFor(opts.templates),
    ...(opts.overlayTemplates ?? []).flatMap((templates) => templates.length ? urlsFor(templates) : []),
  ]
  const warm = opts.warmUrls ?? []
  // Weight each warm item so the bar reflects real time: tiles (many, fast) fill ~70% and the
  // slow SEQUENTIAL warm phase (few, large) fills the rest — instead of snapping to ~97% on the
  // tiles then crawling through the warm tail (which read as "stuck at 99%").
  const warmW = warm.length && tileUrls.length ? Math.max(1, Math.round((tileUrls.length * 0.4) / warm.length)) : 1
  const total = tileUrls.length + warm.length * warmW
  let progressed = 0
  let tilesFetched = 0
  let warmFetched = 0
  let notFound = 0
  let failed = 0

  const fetchOne = async (url: string, weight: number, isTile: boolean) => {
    try {
      // CORS-ONLY: opaque (no-cors) responses are padded to several MB EACH in iOS Cache
      // Storage, so caching hundreds of cross-origin tiles that way reloads the tab (the OOM).
      // We never fall back to no-cors — a tile that lacks CORS is simply skipped (it still
      // loads online). Carto/swisstopo/OSM/Esri all send CORS headers. Don't read the body:
      // the SW caches it independently; reading would pull big GeoJSON/PDFs into page memory.
      const res = await fetch(url, { mode: 'cors', signal: eitherSignal(timeoutSignal(TILE_TIMEOUT_MS), opts.signal) })
      // ⚠️ `fetch` resolving is not «the tile is cached». A 404 or a 502 resolves perfectly
      // happily, and counting it as a hit is how «1240 Kacheln» came to mean «1240 attempts».
      // Opaque responses (status 0) are never produced here — the request is cors-only.
      // A 404 is its own bucket: the tile does not EXIST (out of coverage at a layer's edge),
      // which is final — filing it under «failed» kept «Teilweise geladen» on screen for ever
      // over an area that was as complete as it can get.
      if (res.ok) {
        if (isTile) tilesFetched++
        else warmFetched++
      } else if (res.status === 404) notFound++
      else failed++
    } catch {
      /* offline / no CORS / blocked — skip; SW caches whatever succeeds. The MISS is reported
         through the result counts, so the caller can say what did and did not arrive. */
      failed++
    } finally {
      progressed += weight
      opts.onProgress?.(progressed, total)
    }
  }

  const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms))

  // Run a URL list with bounded concurrency. `pauseMs` (used for the heavy warm pass) inserts a
  // real gap after each fetch so the SW can flush a large body to DISK and free it before the
  // next — a 0ms micro-yield isn't enough time for a multi-MB GeoJSON/PDF to commit.
  const runPool = async (urls: string[], conc: number, weight: number, isTile: boolean, pauseMs = 0) => {
    let cursor = 0
    await Promise.all(
      Array.from({ length: Math.min(conc, urls.length) }, async () => {
        while (cursor < urls.length && !opts.signal?.aborted) {
          const idx = cursor++
          await fetchOne(urls[idx], weight, isTile)
          if (pauseMs) await sleep(pauseMs)
          else if ((idx & 15) === 15) await sleep(0) // yield every 16 tiles
        }
      }),
    )
  }

  // Tiles: many but small → modest concurrency. Warm resources (plan PDFs, GeoJSON) are few but
  // can be large → SEQUENTIAL with a real pause after each, so only one big body is ever in
  // flight and it's flushed to disk before the next starts.
  await runPool(tileUrls, opts.concurrency ?? 3, 1, true)
  await runPool(warm, 1, warmW, false, 150)
  if (opts.signal?.aborted) throw opts.signal.reason ?? new DOMException('Download abgebrochen', 'AbortError')

  return { fetched: tilesFetched, total: tileUrls.length, warmFetched, warmTotal: warm.length, notFound, failed, capped }
}
