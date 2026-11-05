import type { LngLat } from '../types'
import { pathLengthM, wgs84ToLV95 } from './geo'

// Height profile along a path, from the swisstopo elevation service. Switzerland
// only (LV95 / EPSG:2056) — outside CH the API returns nothing, so callers treat
// a null result as "no profile available" and just show the distance.
export interface ProfilePoint { dist: number; alt: number }
export interface ProfileResult {
  points: ProfilePoint[]
  min: number          // lowest altitude (m)
  max: number          // highest altitude (m)
  gain: number         // cumulative ascent (m)
  loss: number         // cumulative descent (m)
  start: number        // first altitude (m)
  end: number          // last altitude (m)
}

const ENDPOINT = 'https://api3.geo.admin.ch/rest/services/profile.json'

// raw rows look like { dist, alts: { COMB: 412.3, ... }, easting, northing }
type Row = { dist: number; alts: Record<string, number | null> }
const altOf = (r: Row): number | null => r.alts.COMB ?? r.alts.DTM2 ?? r.alts.DTM25 ?? Object.values(r.alts).find((v) => v != null) ?? null

export async function fetchElevationProfile(coords: LngLat[], signal?: AbortSignal): Promise<ProfileResult | null> {
  if (coords.length < 2) return null
  const geom = JSON.stringify({ type: 'LineString', coordinates: coords.map(([lon, lat]) => wgs84ToLV95(lon, lat)) })
  const url = `${ENDPOINT}?geom=${encodeURIComponent(geom)}&sr=2056&nb_points=200&distinct_points=true`
  let rows: Row[]
  try {
    const res = await fetch(url, { signal })
    if (!res.ok) return null
    rows = await res.json()
  } catch { return null }
  if (!Array.isArray(rows) || rows.length < 2) return null

  const points: ProfilePoint[] = []
  for (const r of rows) { const alt = altOf(r); if (alt != null) points.push({ dist: r.dist, alt }) }
  if (points.length < 2) return null

  let min = Infinity, max = -Infinity, gain = 0, loss = 0
  for (let i = 0; i < points.length; i++) {
    const a = points[i].alt
    if (a < min) min = a
    if (a > max) max = a
    if (i > 0) { const d = a - points[i - 1].alt; if (d > 0) gain += d; else loss -= d }
  }
  return { points, min, max, gain, loss, start: points[0].alt, end: points[points.length - 1].alt }
}

// ── The shared cache ─────────────────────────────────────────────────────────────────────────
// One profile per path, for every consumer at once: the line editor's Messung (useLineProfile),
// the pumps a Leitung draws on the map (components/LinePumpMarkers) and the printed Kroki
// (krokiPayload · readyLinePumps). They agree on the terrain because they read the same answer,
// and a Leitung whose pumps stand on the map opens its Messung without a second request.
// ⚠️ Only an ANSWER is kept: a null (offline, outside CH) is asked again next time – offline now
// is not offline later. Bounded, oldest out: a Leitung dragged for a minute leaves a path per pause.

const CACHE_MAX = 64
const cache = new Map<string, ProfileResult>()
const inflight = new Map<string, Promise<ProfileResult | null>>()

/** The cache key of a path – its coordinates by value. */
export const profileKey = (coords: readonly LngLat[]): string => coords.map((c) => `${c[0]},${c[1]}`).join(' ')

/** The profile already fetched for exactly this path, if any (sync – the print payload reads it). */
export const cachedProfile = (coords: readonly LngLat[]): ProfileResult | undefined => cache.get(profileKey(coords))

/** The profile of a path – from the cache, a request already on its way, or a new one. Never
 *  aborted by one consumer: another may be waiting on the same request. */
export function loadProfile(coords: LngLat[]): Promise<ProfileResult | null> {
  const key = profileKey(coords)
  const hit = cache.get(key)
  if (hit) return Promise.resolve(hit)
  const running = inflight.get(key)
  if (running) return running
  const p = fetchElevationProfile(coords).then((res) => {
    inflight.delete(key)
    if (res) {
      cache.set(key, res)
      // oldest out: a Map iterates in insertion order
      for (const old of cache.keys()) { if (cache.size <= CACHE_MAX) break; cache.delete(old) }
    }
    return res
  })
  inflight.set(key, p)
  return p
}

/** Tests only: forget every cached profile. */
export function resetProfileCache() { cache.clear(); inflight.clear() }

/** The same profile walked from its far end (a Wassertransport whose water runs back along the
 *  drawn line, lib/useRelay): distances measured from the other end, ascent and descent swapped. */
export function reverseProfile(p: ProfileResult): ProfileResult {
  const total = p.points[p.points.length - 1]?.dist ?? 0
  const points = p.points.map((q) => ({ dist: total - q.dist, alt: q.alt })).reverse()
  return { points, min: p.min, max: p.max, gain: p.loss, loss: p.gain, start: p.end, end: p.start }
}

/** One tapped node of the measured path, placed on its own profile. */
export interface ProfileNode {
  /** 0‥1 along the chart's x axis */
  frac: number
  /** metres from the start, measured the way the map's own node labels measure it */
  dist: number
  /** the profile's altitude there (interpolated between the two samples around it) */
  alt: number
}

/**
 * Where the path's own nodes fall on its profile (20.09.2026). The chart alone is a silhouette
 * with no orientation: nothing said which end is the first tap, or which dip belongs to which
 * leg. The nodes are the one thing the operator placed by hand and can find again on the map.
 *
 * ⚠️ Placed by FRACTION of the path, not by the service's metres: swisstopo measures in LV95 and
 * the map labels measure geodesically, and the two totals differ by a few per mille. The fraction
 * agrees on both, and `dist` stays the number the map shows beside that node.
 */
export function profileNodes(p: ProfileResult, path: LngLat[]): ProfileNode[] {
  if (path.length < 2 || p.points.length < 2) return []
  const cum = [0]
  for (let i = 1; i < path.length; i++) cum.push(cum[i - 1] + pathLengthM([path[i - 1], path[i]]))
  const total = cum[cum.length - 1]
  if (!(total > 0)) return []
  const maxDist = p.points[p.points.length - 1].dist || 1
  return cum.map((dist) => ({ frac: dist / total, dist, alt: altitudeAt(p, (dist / total) * maxDist) }))
}

/** The profile's height at `d` (its own metres), between its samples; its ends beyond them. */
export function altitudeAt(p: ProfileResult, d: number): number {
  const pts = p.points
  const hi = pts.findIndex((q) => q.dist >= d)
  if (hi <= 0) return pts[hi === 0 ? 0 : pts.length - 1].alt
  const a = pts[hi - 1], b = pts[hi]
  return b.dist === a.dist ? b.alt : a.alt + ((d - a.dist) / (b.dist - a.dist)) * (b.alt - a.alt)
}

/** Which node labels fit: both ends always, an inner one only with `minGap` (a share of the axis)
 *  of room to the label before it AND to the end. Returns the indices to label. */
export function labelledNodes(nodes: ProfileNode[], minGap = 0.2): Set<number> {
  const out = new Set<number>()
  if (!nodes.length) return out
  const last = nodes.length - 1
  out.add(0); out.add(last)
  let prev = 0
  for (let i = 1; i < last; i++) {
    if (nodes[i].frac - prev >= minGap && 1 - nodes[i].frac >= minGap) { out.add(i); prev = nodes[i].frac }
  }
  return out
}
