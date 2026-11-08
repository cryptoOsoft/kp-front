// «Karte & Objekte» offline — what the viewer can honestly show without a network
// (docs/karte-objekte.md · Offline). Nothing here downloads anything: the viewer only READS what
// the device already holds and says so.
//
//   · the catalogue and the register answers of buildings looked at: IndexedDB
//     (lib/api/stationReference — one catalogue entry, one entry per building asked for);
//   · a plan: its PDF in the service worker's `reference-plans` cache (lib/pdfBytes · one plain GET
//     per pinned revision) OR its tile pyramid — manifest and tiles in the worker's tile store
//     (lib/tileStore), which the reader fetches whole once a sheet is open online
//     (lib/planTilePrefetch). ⚠️ A TILED sheet opened online never fetches its PDF (review round 3:
//     the Karte then said «PDF nicht gespeichert» offline for a plan that opens perfectly from its
//     tiles). The rule is what the reader that will open it needs: the PDF (pdf.js), or the
//     tiles (`planLamp`) — never an extra PDF download to make a lamp green;
//   · the Gebäude storeys and the aligned plan: that PDF plus the revision's alignment metadata
//     (lib/api/reference · getApprovedPlanAlignments keeps it in IndexedDB);
//   · the base map: the worker's tile store (lib/tileStore) — what was looked at, plus what an
//     Einsatz's Offline-Vorbereitung warmed around its scene. No whole-station download (owner,
//     16.10.2026: that would be several GB).
//
// ⚠️ A lamp says «● auf diesem Gerät» ONLY for what a probe actually found. Without a service
// worker controlling the page (a dev server, a first visit) nothing is served from the device
// once the network is gone, so every cache-backed thing reads «nur online» — never a guess.

import type { LngLat } from '../../types'
import { tilesForBounds, type LngLatBounds } from '../offlineTiles'
import { referenceUrl } from '../api/reference'
import { allTileUrls, sourcePages, tileManifestUrl, tileSource, tileUrl, underlayLevel, visibleTiles, type TileManifest, type TileSource } from '../planTiles'
import type { StationObject, StationPlan } from '../api/stationReference'
import { LEGACY_TILE_CACHES, readTile, tileUrls as storedUrls, type TileKind } from '../tileStore'

/** ● on this device · ◐ partly · ○ only online */
export type Lamp = 'device' | 'part' | 'online'

/** Does the device hold this exact URL? */
export type CacheProbe = (url: string) => Promise<boolean>

/** A plan revision's identity — what the PDF cache and the alignment cache are keyed on. */
export const planKey = (p: Pick<StationPlan, 'id' | 'version'>): string => `${p.id}@${p.version}`
/** The exact address `PdfScroller` / the Gebäude bake fetch, i.e. the `reference-plans` key. */
export const planPdfUrl = (p: Pick<StationPlan, 'id' | 'version'>): string => referenceUrl(p.id, p.version)

/** What the device holds of a revision's tile pyramid (`tilesHeld`): `all` = every tile of every
 *  level; `underlay` = every tile of the small level the reader always draws (lib/planTiles ·
 *  underlayLevel) — the whole sheet opens, a deeper zoom stays soft; `none` = less; null = no
 *  manifest stored (no pyramid known on this device). */
export type TilesHeld = 'all' | 'underlay' | 'none' | null

/** What the device holds of one plan revision: the PDF, its tiles, and the alignment metadata
 *  (null = not stored; else how many storeys its floor pack names). */
export interface PlanHeld { pdf: boolean; tiles?: TilesHeld; meta: { floors: number } | null }

/**
 * How one plan opens without a network — what the reader that will open it needs
 * (components/PdfViewport: the tiles when a manifest answers, pdf.js on the PDF otherwise, and
 * pdf.js again when a tile cannot be had):
 *   · ● `device` — the PDF is stored, or every tile of the pyramid is;
 *   · ◐ `part` — no PDF, but the underlay tiles of every page: the whole sheet opens, a zoom past
 *     what is stored says «Schärfere Ansicht nur mit Netz» (lib/planSharpness);
 *   · ○ `online` — neither.
 */
export function planLamp(h: PlanHeld | undefined): Lamp {
  if (!h) return 'online'
  if (h.pdf || h.tiles === 'all') return 'device'
  return h.tiles === 'underlay' ? 'part' : 'online'
}

/** Which of a pyramid's tiles `has` (a stored tile address) finds. Pure. */
export function tilesHeld(m: TileManifest, s: TileSource, has: (url: string) => boolean): Exclude<TilesHeld, null> {
  const every = allTileUrls(m, s)
  if (every.length && every.every(has)) return 'all'
  const under = sourcePages(m, s).flatMap((page) => {
    const level = underlayLevel(page)
    return visibleTiles(level, m.tileSize, [0, 0, 1, 1]).map((t) => tileUrl(s, page.page, level.z, t.x, t.y))
  })
  return under.length && under.every(has) ? 'underlay' : 'none'
}

export interface ObjectAvailability {
  /** planKey → how it opens without a network (`planLamp`): ● ◐ ○ */
  plans: Record<string, Lamp>
  /** the Gebäude stack; null when the object has no prepared storeys */
  gebaeude: Lamp | null
  /** the station-aligned plan can be laid on the map without a network */
  georef: boolean
}

/**
 * The availability of one object's plans, from what the probes found.
 *
 * Gebäude needs, for EVERY revision whose floor pack names storeys, its pages (the storeys are
 * regions of them: the PDF or the tiles, `planLamp`) and its alignment metadata (which says where
 * the storeys are). A revision whose metadata is not stored might hold storeys nobody can see
 * offline, so the stack is only «on this device» when every revision's metadata is there and
 * every storey's pages are fully stored; some storeys, or storeys only as soft underlay, is
 * «part» — the surface then says that storeys are missing.
 */
export function objectAvailability(obj: Pick<StationObject, 'plans' | 'floors'>, held: Record<string, PlanHeld>): ObjectAvailability {
  const plans: Record<string, Lamp> = {}
  for (const p of obj.plans) plans[planKey(p)] = planLamp(held[planKey(p)])
  let gebaeude: Lamp | null = null
  if (obj.floors.length) {
    const unknown = obj.plans.filter((p) => !held[planKey(p)]?.meta)
    const floorPlans = obj.plans.filter((p) => (held[planKey(p)]?.meta?.floors ?? 0) > 0)
    const drawable = floorPlans.filter((p) => plans[planKey(p)] !== 'online')
    const whole = drawable.filter((p) => plans[planKey(p)] === 'device')
    gebaeude = !drawable.length ? 'online' : !unknown.length && whole.length === floorPlans.length ? 'device' : 'part'
  }
  const g = obj.plans.find((p) => p.georef)
  const gh = g ? held[planKey(g)] : undefined
  return { plans, gebaeude, georef: !!g && plans[planKey(g)] !== 'online' && !!gh?.meta }
}

// ── the base map ────────────────────────────────────────────────────────────────────────────

export interface TileXY { z: number; x: number; y: number }

/** MapLibre's transform counts zoom in 512-px tiles; a 256-px raster source therefore loads
 *  level round(zoom + 1) (maplibre · coveringZoomLevel, raster sources round). */
export function rasterTileZoom(mapZoom: number, maxzoom = 22): number {
  return Math.max(0, Math.min(maxzoom, Math.round(mapZoom + 1)))
}

/** Never probe more tiles than this for one view (a zoomed-out pan) — the answer is then «unknown». */
export const MAX_VIEW_TILES = 96
/** How far up MapLibre may borrow a parent tile it holds for a child that failed to load. */
export const PARENT_DEPTH = 4

/** The base tiles a view draws, or null when that is more than is worth asking about. */
export function viewTiles(bounds: LngLatBounds, mapZoom: number, maxzoom?: number): TileXY[] | null {
  const z = rasterTileZoom(mapZoom, maxzoom)
  const tiles = tilesForBounds(bounds, z, z)
  return tiles.length > MAX_VIEW_TILES ? null : tiles
}

/** Every address one tile may be stored under: the downloader cycles a host's subdomains, so a
 *  tile lands under ANY of the templates (workspace/useOfflinePrefetch · offlineProbeUrls). */
export function tileUrls(templates: readonly string[], t: TileXY): string[] {
  return templates.map((tpl) => tpl.replace('{z}', String(t.z)).replace('{x}', String(t.x)).replace('{y}', String(t.y)))
}

/**
 * Which of the view's tiles have NO map behind them: neither the tile itself nor a parent up to
 * `PARENT_DEPTH` levels is stored. A tile only its parent covers still draws (blurred, MapLibre
 * scales the parent up), so it does not count as missing — the hatching marks where the map is
 * really blank, nothing more.
 */
export async function missingTiles(tiles: readonly TileXY[], templates: readonly string[], has: CacheProbe): Promise<TileXY[]> {
  const memo = new Map<string, Promise<boolean>>()
  const stored = (t: TileXY): Promise<boolean> => {
    const k = `${t.z}/${t.x}/${t.y}`
    let p = memo.get(k)
    if (!p) {
      p = (async () => {
        for (const url of tileUrls(templates, t)) if (await has(url).catch(() => false)) return true
        return false
      })()
      memo.set(k, p)
    }
    return p
  }
  const covered = async (t: TileXY): Promise<boolean> => {
    for (let d = 0; d <= PARENT_DEPTH && t.z - d >= 0; d++) {
      if (await stored({ z: t.z - d, x: t.x >> d, y: t.y >> d })) return true
    }
    return false
  }
  const flags = await Promise.all(tiles.map(covered))
  return tiles.filter((_, i) => !flags[i])
}

const tile2lng = (x: number, z: number) => (x / 2 ** z) * 360 - 180
const tile2lat = (y: number, z: number) => {
  const n = Math.PI - (2 * Math.PI * y) / 2 ** z
  return (180 / Math.PI) * Math.atan(0.5 * (Math.exp(n) - Math.exp(-n)))
}

/** A tile's square as a map ring (NW, NE, SE, SW). */
export function tileRing(t: TileXY): LngLat[] {
  const w = tile2lng(t.x, t.z), e = tile2lng(t.x + 1, t.z)
  const n = tile2lat(t.y, t.z), s = tile2lat(t.y + 1, t.z)
  return [[w, n], [e, n], [e, s], [w, s]]
}

/** Lamp for «held / asked about». */
export function shareLamp(held: number, total: number): Lamp {
  if (total > 0 && held >= total) return 'device'
  return held > 0 ? 'part' : 'online'
}

// ── «Auf diesem Gerät» ──────────────────────────────────────────────────────────────────────

export interface DeviceFacts {
  offline: boolean
  /** the catalogue as stored on the device; null = none stored */
  catalogue: { count: number; generatedAt: string | null } | null
  /** the base tiles of this view: held / total; 'far' = too many to ask; null = cannot tell */
  map: { held: number; total: number } | 'far' | null
  /** plan PDFs of the whole catalogue: held / total; null = cannot tell (no service worker) */
  plans: { held: number; total: number } | null
  /** buildings whose register answer is stored */
  buildings: number
  /** free storage in bytes, null = unknown */
  storageFree: number | null
}

export interface DeviceRow { key: string; lamp: Lamp; title: string; sub: string }

/** The copy the rows are made of (appConfig.copy.karte.device). */
export interface DeviceCopy {
  catalogue: string; catalogueSub: string; catalogueSubOne: string; catalogueNone: string; catalogueStand: string
  map: string; mapAll: string; mapPart: string; mapPartOffline: string; mapNone: string; mapFar: string; mapUnknown: string
  plans: string; plansAll: string; plansPart: string; plansNone: string; plansEmpty: string; plansUnknown: string
  buildings: string; buildingsSome: string; buildingsOne: string; buildingsNone: string
  hazmat: string; hazmatSub: string
  address: string; weather: string; onlineOnly: string
  storage: string; storageFree: string; storageLow: string
}

/** Below this much free space the device cannot keep much more for offline. */
export const STORAGE_LOW_BYTES = 300 * 1024 * 1024

const fill = (t: string, v: Record<string, string | number>) => t.replace(/\{(\w+)\}/g, (_, k: string) => String(v[k] ?? `{${k}}`))

/**
 * The rows of the «Auf diesem Gerät» sheet, in the mockup's order. Pure: the sheet probes, this
 * decides. Gebäuderegister is never «●» — only buildings already looked at are stored — and the
 * address search, weather and vehicles are always «nur online».
 */
export function deviceRows(f: DeviceFacts, C: DeviceCopy, fmt: { day: (iso: string) => string; size: (bytes: number) => string }): DeviceRow[] {
  const rows: DeviceRow[] = []
  rows.push(f.catalogue
    ? { key: 'catalogue', lamp: 'device', title: C.catalogue, sub: [fill(f.catalogue.count === 1 ? C.catalogueSubOne : C.catalogueSub, { n: f.catalogue.count }), f.catalogue.generatedAt ? fill(C.catalogueStand, { d: fmt.day(f.catalogue.generatedAt) }) : ''].filter(Boolean).join(' · ') }
    : { key: 'catalogue', lamp: 'online', title: C.catalogue, sub: C.catalogueNone })
  if (f.map === null) rows.push({ key: 'map', lamp: 'online', title: C.map, sub: C.mapUnknown })
  else if (f.map === 'far') rows.push({ key: 'map', lamp: 'part', title: C.map, sub: C.mapFar })
  else {
    const lamp = shareLamp(f.map.held, f.map.total)
    rows.push({ key: 'map', lamp, title: C.map, sub: lamp === 'device' ? C.mapAll : lamp === 'part' ? (f.offline ? C.mapPartOffline : C.mapPart) : C.mapNone })
  }
  if (f.plans === null) rows.push({ key: 'plans', lamp: 'online', title: C.plans, sub: C.plansUnknown })
  else if (!f.plans.total) rows.push({ key: 'plans', lamp: 'online', title: C.plans, sub: C.plansEmpty })
  else {
    const lamp = shareLamp(f.plans.held, f.plans.total)
    const v = { n: f.plans.held, total: f.plans.total }
    rows.push({ key: 'plans', lamp, title: C.plans, sub: fill(lamp === 'device' ? C.plansAll : lamp === 'part' ? C.plansPart : C.plansNone, v) })
  }
  rows.push(f.buildings > 0
    ? { key: 'buildings', lamp: 'part', title: C.buildings, sub: fill(f.buildings === 1 ? C.buildingsOne : C.buildingsSome, { n: f.buildings }) }
    : { key: 'buildings', lamp: 'online', title: C.buildings, sub: C.buildingsNone })
  // bundled with the app (precached), like the Offline-Bereitschaft's own Gefahrgut row
  rows.push({ key: 'hazmat', lamp: 'device', title: C.hazmat, sub: C.hazmatSub })
  rows.push({ key: 'address', lamp: 'online', title: C.address, sub: C.onlineOnly })
  rows.push({ key: 'weather', lamp: 'online', title: C.weather, sub: C.onlineOnly })
  if (f.storageFree != null) {
    const low = f.storageFree < STORAGE_LOW_BYTES
    rows.push({ key: 'storage', lamp: low ? 'part' : 'device', title: C.storage, sub: fill(low ? C.storageLow : C.storageFree, { free: fmt.size(f.storageFree) }) })
  }
  return rows
}

// ── the probes (thin; the decisions above are what the tests pin) ───────────────────────────

const PLAN_CACHE = 'reference-plans'

/** Offline copies are only worth asking about when a service worker serves them back offline. */
export function cacheProbeable(): boolean {
  return typeof caches !== 'undefined' && typeof navigator !== 'undefined' && !!navigator.serviceWorker?.controller
}

/** A probe into ONE named cache, or null when the device cannot tell. A missing cache answers
 *  «not held» for everything. */
async function openProbe(cacheName: string): Promise<CacheProbe | null> {
  if (!cacheProbeable()) return null
  try {
    if (!(await caches.has(cacheName))) return async () => false
    const cache = await caches.open(cacheName)
    return async (url) => { try { return !!(await cache.match(url)) } catch { return false } }
  } catch {
    return null
  }
}

/** The URLs a legacy cache still holds (none once the worker moved it over). */
async function legacyUrls(kind: TileKind): Promise<string[]> {
  try {
    const name = LEGACY_TILE_CACHES[kind]
    if (!(await caches.has(name))) return []
    return (await (await caches.open(name)).keys()).map((r) => r.url)
  } catch { return [] }
}

/** The stored URLs of a tile kind – the store's and a legacy cache's, both of which the worker
 *  answers from – keyed as `key` says, or null when the device cannot tell. ONE read each
 *  answers every tile asked. */
async function storedTiles(kind: TileKind, key: (u: URL) => string): Promise<Set<string> | null> {
  if (!cacheProbeable()) return null
  // the legacy cache FIRST: a tile the worker moves in between is then seen on one side or the other
  const legacy = await legacyUrls(kind)
  const urls = await storedUrls(kind)
  if (!urls) return null
  const out = new Set<string>()
  for (const url of [...urls, ...legacy]) {
    try { out.add(key(new URL(url))) } catch { /* not a URL — skip */ }
  }
  return out
}

/** The base map's stored tiles (lib/tileStore, kind `map`). */
export async function openTileProbe(): Promise<CacheProbe | null> {
  const stored = await storedTiles('map', (u) => u.href)
  // parsed like the stored keys, as Cache Storage's `match` did
  return stored && (async (url) => { try { return stored.has(new URL(url).href) } catch { return false } })
}

export const openPlanProbe = () => openProbe(PLAN_CACHE)

/** What the device holds of a plan's pyramid, or null when the device cannot tell. The tiles
 *  and manifests are lib/tileStore's `plan` and `manifest` kinds. */
export async function openPlanTilesProbe(): Promise<((p: Pick<StationPlan, 'id' | 'version'>) => Promise<TilesHeld>) | null> {
  const stored = await storedTiles('plan', (u) => u.pathname + u.search)
  if (!stored) return null
  return async (p) => {
    const source = tileSource(planPdfUrl(p))
    if (!source) return null
    try {
      const url = tileManifestUrl(source)
      const body = await readTile(url) ?? await (await caches.match(url, { cacheName: LEGACY_TILE_CACHES.manifest }).catch(() => undefined))?.blob()
      if (!body) return null
      const m = JSON.parse(await body.text()) as TileManifest
      if (!m.pages?.length || !(m.tileSize > 0)) return null
      return tilesHeld(m, source, (url) => stored.has(url))
    } catch { return null }
  }
}
