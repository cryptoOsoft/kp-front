// Pure helpers extracted from MapView: world-scaled symbol/shape sizing, GeoJSON
// feature builders, and the symbol-kind predicates. No React — safe to unit-test.
import type { Feature, FeatureCollection, LineString, Polygon } from 'geojson'
import type { Entity, LayerId, LngLat } from '../types'
import { appConfig } from '../config/appConfig'
import { VEHICLE_SYMBOLS } from '../lib/symbols'
import { lookbackPoint } from './lineStyle'
import { dockSlotOffset } from './docking'
import { cachedLabelSize } from './labelPass'
import type { LineTone } from './truppLines'

/** Our own glyph ranges (public/fonts, scripts/vendor-map-labels.mjs) – the one text the map
 *  draws itself is the basemap's names (lib/basemapLabels); everything else is DOM markers. */
export const MAP_GLYPHS = '/fonts/{fontstack}/{range}.pbf'

export const EMPTY_STYLE = { version: 8 as const, glyphs: MAP_GLYPHS, sources: {}, layers: [] }

/** The map's own ceiling (14.09.): one step past the tiles, for placing a symbol precisely —
 *  past a base's `maxzoom` MapLibre stretches the last tile level. The Einsatz map keeps it. */
export const MAP_MAX_ZOOM = 21
/** The deepest map zoom on a base map for «Karte & Objekte» (owner on #383, review round 4: «the
 *  map must not zoom past the last level the current base map serves sharply» — the Karte ONLY; the
 *  Einsatz keeps MAP_MAX_ZOOM for precise placement). The rasters are 256 px tiles on MapLibre's
 *  512 px zoom grid (MapLayers · tileSize), so a base's LAST tile level `maxzoom` is drawn 1:1 at map
 *  zoom `maxzoom − 1`; one step further would stretch it twice over (CARTO 20 → 19, swissimage 20 →
 *  19, OSM 19 → 18). A base without a `maxzoom` keeps the map's ceiling. */
export const baseMaxMapZoom = (base: { maxzoom?: number } | null | undefined): number =>
  base?.maxzoom != null ? Math.min(MAP_MAX_ZOOM, base.maxzoom - 1) : MAP_MAX_ZOOM
/** MapView's `maxZoom`: the base's sharp limit where the surface asks for it (`zoomCapAtBase`,
 *  the Karte), else the map's own ceiling (the Einsatz). */
export const mapMaxZoom = (base: { maxzoom?: number } | null | undefined, capAtBase = false): number =>
  capAtBase ? baseMaxMapZoom(base) : MAP_MAX_ZOOM

export const vis = (on: boolean) => ({ visibility: (on ? 'visible' : 'none') as 'visible' | 'none' })

/** Native Lage drawing chrome must leave with its canvas strokes during Karte ↔ Modul pairing. */
export const nativeDrawingChromeVisible = (drawingsVisible: boolean, georefOn: boolean) =>
  drawingsVisible && !georefOn

/** A label is the line's tap target, except when it carries the one alarm that needs immediate
 * action: an overdue linked Atemschutz-Trupp. Warn/fine/out labels still open line details. */
export const lineLabelAction = (truppId: string | undefined, tone: LineTone | undefined) =>
  truppId && tone === 'crit'
    ? { kind: 'trupp' as const, id: truppId }
    : { kind: 'drawing' as const }

// ── Trupp marker geometry (mirrors `.team-dot` / `.wb-resource-pill`, 09-whiteboard.css) ────
// A Trupp marker is a STRIP — [dot][gap][name] — so where the strip is anchored decides what the
// coordinate MEANS. Both halves of the map have to agree on it: MapMarkers anchors the marker,
// MapView's label pass measures the same boxes without a DOM.
/** `.team-dot i` — the dot IS the position, so it is what sits on the coordinate. */
export const TEAM_DOT_PX = 13
/** `.team-dot` gap — the distance the name hangs off the dot. */
export const TEAM_DOT_GAP = 8
/** The selected pill's accent cap, centre-to-left-edge: 1px border + 8px padding + half of the
 *  4px cap — so selecting a Trupp swaps the chrome without moving the point it states. */
export const TEAM_PILL_CAP_PX = 11
/** `.team-link` + its gap — the «angedockt» glyph at the right end of the same strip. */
/** the resting strip's name chip, as the label pass measures it (`.team-dot b` – 700 11px
 *  Sora, 4px padding each side, 15px line). ONE definition: MapView books the box with it and
 *  MapMarkers centres a docked strip with it, so the two can never disagree. */
export const TEAM_LABEL_STYLE = { font: '700 11px Sora, system-ui, sans-serif', maxTextW: Infinity, chromeW: 8, chromeH: 2, lineH: 15 }
/** The label-pass boxes of the other on-map labels, as their CSS draws them. ONE place, held to the
 *  CSS by mapView.labelCss.test.ts: a type step there (stage 2 took them 11.5 → 11px, the 4px grid)
 *  that is not copied here books boxes that are wider or taller than what is on screen.
 *  `.sym-caption` (03-map.css) — 700 --fs-micro Sora, wraps at compound seams inside its 120px
 *  span, 1px/4px padding, line-height 1.25, hung `margin-top` under the glyph. */
export const SYM_CAPTION_STYLE = { font: '700 11px Sora, system-ui, sans-serif', maxTextW: 120, chromeW: 8, chromeH: 2, lineH: 13.75 }
/** `.sym-pill` (03-map.css) — 700 --fs-micro mono, never wraps, 20px tall; the chrome is the
 *  0/8px padding plus the 13px Messgerät and its 4px gap. Centred on the glyph's anchor. */
export const SYM_PILL_STYLE = { font: '700 11px "Spline Sans Mono", ui-monospace, monospace', maxTextW: Infinity, chromeW: 2 * 8 + 13 + 4, chromeH: 0, lineH: 20 }
/** `.sym-caption { margin-top }` (03-map.css) */
export const SYM_CAPTION_GAP = 4
/** `.measure-label.draw-label` (11-measure.css) — 700 --fs-micro mono, never wraps, 2px/8px padding, line-height 1.25 */
export const READOUT_LABEL_STYLE = { font: '700 11px "Spline Sans Mono", ui-monospace, monospace', maxTextW: Infinity, chromeW: 16, chromeH: 4, lineH: 13.75 }
/** `.map-trail-dot i` (09-whiteboard.css) — a breadcrumb's time: 700 --fs-micro mono, 1px/4px
 *  padding, line-height 1.25, hung CRUMB_LABEL_DX right of the coordinate (12px off the 9px dot's
 *  left edge, the dot centred on the point). */
export const CRUMB_LABEL_STYLE = { font: '700 11px "Spline Sans Mono", ui-monospace, monospace', maxTextW: Infinity, chromeW: 8, chromeH: 2, lineH: 13.75 }
export const CRUMB_LABEL_DX = 12 - 9 / 2
/** `.line-end-tag` (09-whiteboard.css) — 800 --fs-micro/1, 2px/4px padding plus a 1.5px border; `inline-grid` stacks the Trupp row */
export const END_TAG_LABEL_STYLE = { font: '800 11px Sora, system-ui, sans-serif', maxTextW: Infinity, chromeW: 11, chromeH: 7, lineH: 11 }
/** the whole resting strip's width: [dot][gap][name]. ⚠️ No Leitung field any more (11.10.2026,
 *  owner: «on the map the trupps are numbered – which we don't need»): the Karte's marker is the
 *  Gebäude chip's — name only — and the Leitung's number stays on the hose's own end tag. */
export const teamStripPx = (label: string): number =>
  TEAM_DOT_PX + TEAM_DOT_GAP + cachedLabelSize(label, TEAM_LABEL_STYLE).w

// Symbol size tied to the real world (m), scaling with zoom — but clamped into a
// NARROW band: at normal Einsatz zooms a symbol looks almost constant (like a map
// pin), never grows past the roof (no "Offizier as big as a house") and shrinks
// slightly when zooming out, so a cluster doesn't clump together.
const SIZE_M: Record<string, number> = { vehicle: 11, command: 10, hydrant: 6, symbol: 8, area: 8 }
// the band (px). `mul` is the global S/M/L factor (lib/prefs · symbolMul); it
// scales the whole band, so the ceiling/floor grow along with it.
const SYM_MIN = 28
// …except a VEHICLE, which has a higher floor of its own. A vehicle is the only kind whose NAME
// is baked into the glyph body (lib/useVehiclePositions · vehicleSymbolSvg), so the name can only
// grow with the glyph. At the owner's tablet zoom every GPS vehicle at the Magazin sits exactly
// ON the floor, where the name came out ~6.5px tall and was unreadable at arm's length (review 7
// point 3, 20.10.2026 — owner picked variant D: floor 28 → 34 px together with a bigger NAME_FS).
// Per kind on purpose, not a new global floor: a hydrant or a Schadenlage symbol carries no name
// and has no reason to grow, and a wider band would clump the Magazin cluster together.
const SYM_MIN_KIND: Record<string, number> = { vehicle: 34 }
const SYM_MAX = 48
export const pxPerM = (lat: number, z: number) => Math.pow(2, z) / (156543.03392 * Math.cos((lat * Math.PI) / 180))
export const symPx = (kind: string, lat: number, z: number, mul = 1) =>
  Math.max(SYM_MIN_KIND[kind] ?? SYM_MIN, Math.min(SYM_MAX, (SIZE_M[kind] ?? 8) * pxPerM(lat, z))) * mul

/**
 * Where a DOCKED Trupp marker is actually drawn: its host, and the screen-px offset from that
 * host's glyph centre to the marker's dot (lib/docking · dockSlotOffset — the tile's bottom-left
 * corner, stacking downwards). Null for everything that is not a docked Trupp marker, and for a
 * bond whose host is gone or has no coordinate — those simply keep standing on their own point.
 *
 * ⚠️ Both halves of the map read THIS, or they disagree about where the marker is: MapMarkers
 * anchors the `<Marker>` on the host and offsets it, MapView's label pass books the same box
 * without a DOM. A pass that arbitrated the marker's stored coordinate while the eye saw it on
 * the corner would clear labels for ground nothing is drawn on.
 */
export function teamDockAnchor(
  e: Entity, entities: readonly Entity[], slots: ReadonlyMap<string, number>, zoom: number, symMul = 1, stripPx?: number,
): { host: Entity; dx: number; dy: number } | null {
  if (e.kind !== 'team' || !e.dockedTo) return null
  const host = entities.find((h) => h.id === e.dockedTo)
  if (!host || !Array.isArray(host.coord)) return null
  return { host, ...dockSlotOffset(symPx(host.kind, host.coord[1], zoom, symMul), slots.get(e.id) ?? 0, stripPx) }
}
// shapes are sized in real-world metres so they grow/shrink with zoom like a
// ground footprint (a smoke cloud covering an area, an arrow spanning a street)
// `maxPx` is the per-kind ceiling (lib/shapes · SHAPE_MAX_PX) — the general 900 stops a stray
// value producing a mile-wide DOM box, but a Rotation is meant to span the map and needs its own.
export const shapePx = (sizeM: number | undefined, lat: number, z: number, maxPx = 900) => Math.max(24, Math.min(maxPx, (sizeM ?? 40) * pxPerM(lat, z)))
// directional tactical symbols that support drag-to-rotate, and the generic placed vehicle —
// one pair of predicates for the Karte and the Plan, defined beside ROTATABLE (lib/symbols)
export { isRotatableSym, isVehicleSym } from './symbols'

/**
 * The layer an entity actually belongs to. Vehicles answer «Fahrzeuge» whatever their stored
 * layer says: only the live GPS glyphs were ever put on that layer, so a TLF someone placed by
 * hand sat on «Taktische Zeichen» and could not be toggled away with the rest of the fleet —
 * two kinds of the same thing on two different switches.
 *
 * Resolved at read time rather than migrated, so every Einsatz already in the database toggles
 * correctly too, without rewriting a single stored workspace. New placements store the right
 * layer anyway (see IncidentWorkspace · placeSymbol), so this is a compatibility shim for old
 * data, not a permanent indirection.
 */
export const effectiveLayer = (e: Entity): LayerId =>
  (e.kind === 'symbol' && e.symbol && VEHICLE_SYMBOLS.has(e.symbol)
    ? appConfig.gps.layerId
    : e.layer)
/** `initialViewState` for a map instance: the live view when we have one (so a WebGL
 *  context-loss remount resumes the operator's framing instead of snapping back to the
 *  incident's initial one), else the incident's opening view. */
export const resumeViewState = (
  live: { center: LngLat; zoom: number; bearing: number } | null,
  center: LngLat,
  zoom: number,
  bearing: number,
) => (live
  ? { longitude: live.center[0], latitude: live.center[1], zoom: live.zoom, bearing: live.bearing }
  : { longitude: center[0], latitude: center[1], zoom, bearing })

/** How many insertable segments a measured / edited path has. An area closes back to its first
 *  point, so it has one more than a line of the same vertices — but only once it IS a ring
 *  (two points are still just a line). Shared by the tap-the-line hit test and the "+" handles
 *  drawn at each midpoint, so the two routes offer exactly the same insert positions. */
export const pathSegmentCount = (points: number, isArea: boolean): number =>
  points < 2 ? 0 : isArea && points >= 3 ? points : points - 1

export type FC = FeatureCollection
export const fc = (features: Feature[]): FC => ({ type: 'FeatureCollection', features })
export const lineFeat = (coords: LngLat[], props: Record<string, unknown> = {}): Feature<LineString> => ({ type: 'Feature', geometry: { type: 'LineString', coordinates: coords }, properties: props })
export const polyFeat = (coords: LngLat[], props: Record<string, unknown> = {}): Feature<Polygon> => ({ type: 'Feature', geometry: { type: 'Polygon', coordinates: [[...coords, coords[0]]] }, properties: props })

/** Web-Mercator northing — the y half of the projection, without a map instance. */
const mercY = (lat: number) => Math.log(Math.tan(Math.PI / 4 + (lat * Math.PI) / 360))

/** Web-Mercator world pixel at a zoom. On a NORTH-UP map these are screen pixels up to a pan,
 *  so a distance measured here is a distance on screen — which is what the decorations below
 *  need and what saves them from asking the map to project every vertex on every render. */
export function worldPx(c: LngLat, z: number): [number, number] {
  const s = 256 * Math.pow(2, z)
  return [((c[0] + 180) / 360) * s, (0.5 - mercY(c[1]) / (2 * Math.PI)) * s]
}

/**
 * Bearing (deg, screen) the Teilstück fork caps a hose line with.
 *
 * ⚠️ NOT the raw last segment. A hose is drawn with a finger or a mouse and its final vertex is
 * routinely a few pixels from the one before it — at that length the segment carries almost no
 * direction, so a fork aimed by it stands ACROSS the line instead of capping it. The printed
 * Kroki never had this because kroki.py looks a fixed distance back from the tip for its
 * reference point (`_lookback`), and `lineStyle · lookbackPoint` is the same walk for the same
 * reason on the arrowheads. `minPx` mirrors the server's `max(10, width · 2.5)`.
 */
export function forkBearing(coords: LngLat[], zoom: number, minPx: number): number {
  const px = coords.map((c) => worldPx(c, zoom))
  const tip = px[px.length - 1]
  const ref = lookbackPoint(px, minPx)
  return (Math.atan2(tip[1] - ref[1], tip[0] - ref[0]) * 180) / Math.PI
}

