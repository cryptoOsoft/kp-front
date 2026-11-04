// «Karte & Objekte» — the rules about PLACES (docs/karte-objekte.md): which object a building is,
// what is near a point, what a dropped pin is called, and the addresses the viewer links to.
//
// ⚠️ Two rules that are easy to break and expensive at 3am:
//   · a building is an object ONLY on an exact street + number match (`objectAtAddress`), when
//     the object's own coordinate lies INSIDE its outline (`outlineFor`), or when official data
//     puts it on the object's own use area / parcel (`objectBuildings`, derived server-side) —
//     never by proximity alone, because a neighbour's gas valve reads exactly like this one's;
//   · «In der Nähe» is distance and nothing else (`nearbyPlaces`): the panel lists it under its
//     own heading with the sentence that it does not belong to the selected building.

import type { LngLat } from '../../types'
import { haversineM } from '../geo'
import { ringContains } from '../footprintPick'
import type { StationObject } from '../api/stationReference'
import { coordOf } from './search'

/** An address label as its two lines: «Hauptstrasse 10, 4104 Oberwil», the geocoder's
 *  «Hauptstrasse 10 4104 Oberwil» and «Schloss # 6246 Altishofen» all → [street, place]. */
export function splitAddress(label: string | null | undefined): [string, string] {
  const t = (label ?? '').trim()
  const cut = /[,#]/.exec(t)
  if (cut) return [t.slice(0, cut.index).trim(), t.slice(cut.index + 1).trim()]
  const m = /^(.*?\S)\s+(\d{4}\s+\S.*)$/.exec(t)
  return m ? [m[1], m[2]] : [t, '']
}

/** «Hauptstrasse 10, 4104 Oberwil» → «hauptstrasse10» — street and number, folded, without the
 *  place; the same key the backend matches on (building_facts · _street_of). */
export function streetKey(address: string | null | undefined): string {
  const head = splitAddress(address)[0]
  return head.normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]/g, '')
}

// --- an object's address, as every list and head prints it (review round 2, 17.10.2026) --------
//
// Owner: «why do we have the keybox labelled in some places instead of the address?». Key boxes
// and plain `objekt`s are often NAMED by their address («Mühlemattstrasse 24», «Bienenstrasse 28
// (EH)») with `address: null`, and the lists fell back to the KIND word («Schlüsseldepot») where
// the address belongs. ⚠️ The kind word is never a stand-in for an address: an address is the
// stored one, else the name when the name is one, else none — and when the name already says it,
// it is printed once, as the title.

/** Folded for comparing two spellings of one street: no accents, lower case, single spaces. */
function foldWords(s: string): string {
  return s.normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()
}

/** «Mühlemattstrasse 24», «Schulstrasse 4», «Bienenstrasse 28 (EH)», «Hauptstr. 10a»: a street
 *  (a word of 4+ letters, more words allowed) and a house number, maybe a letter and a note after
 *  it. «Gemeindehaus Musterdorf» is not one. */
const ADDRESS_NAME = /^\p{L}[\p{L}\p{M}'’.\- ]{3,}?\s\d{1,4}\s?[a-zA-Z]?(?=$|[\s,(/])/u

export function nameIsAddress(name: string | null | undefined): boolean {
  return ADDRESS_NAME.test((name ?? '').trim())
}

/** The object's address: the stored one, else its name when the name IS an address, else null. */
export function objectAddress(o: { name: string; address: string | null; locality?: string | null }): string | null {
  const a = o.address?.trim() || (nameIsAddress(o.name) ? o.name.trim() : null)
  if (!a) return null
  // the server names the town only when it is not the home town («Erlenstrasse 60, Therwil»)
  const town = o.locality?.trim()
  return town && !foldWords(a).includes(foldWords(town)) ? `${a}, ${town}` : a
}

/** Whether the object's name already says its street and number («Therwilerstrasse 18 (EH)»
 *  says «Therwilerstrasse 18»; «Therwilerstrasse 18a» does not). */
export function nameSaysAddress(o: { name: string; address: string | null; locality?: string | null }): boolean {
  const a = objectAddress(o)
  if (!a) return false
  const name = foldWords(o.name)
  const street = foldWords(splitAddress(a)[0])
  return !!street && (name === street || (name.startsWith(street) && name[street.length] === ' '))
}

/**
 * The line under an object's name in a list (search, In der Nähe): its address — or, when the
 * name already is the address, only what the name does not say (the place, if the address has
 * one) and the kind word, quietly, so the row still says what it is. An object with no address
 * at all is described by its kind (a description, not an address).
 */
export function objectRowSub(o: { name: string; address: string | null; locality?: string | null }, kindWord: string): string {
  const a = objectAddress(o)
  if (!a) return kindWord
  if (!nameSaysAddress(o)) return a
  return [splitAddress(a)[1], kindWord].filter(Boolean).join(' · ')
}

/** The line under the name in the panel's head, whose kicker already says the kind: the address,
 *  or the place alone when the name is the address, or nothing. */
export function objectHeadSub(o: { name: string; address: string | null; locality?: string | null }): string | null {
  const a = objectAddress(o)
  if (!a) return null
  return nameSaysAddress(o) ? splitAddress(a)[1] || null : a
}

/** The second line of an object row in the Einsatz wizard's picker: its address, then the plans text
 *  («Schlossgasse 9 · 2 Pläne»). Never a «—» for a missing address – the row then says the plans
 *  alone – and when the name already is the address, only what the name leaves out (the place). */
export function objectPicklistSub(o: { name: string; address: string | null; locality?: string | null }, plansText: string): string {
  return [objectHeadSub(o), plansText].filter(Boolean).join(' · ')
}

/** The label as «street, place» — the shape the server's own addresses have. */
export function normAddress(label: string | null | undefined): string {
  const [a, b] = splitAddress(label)
  return b ? `${a}, ${b}` : a
}

/**
 * The catalogue object whose address IS this address — exact street + number, never «close».
 * Two candidates → the one with plans, then by name.
 */
export function objectAtAddress(objects: readonly StationObject[], address: string | null | undefined): StationObject | null {
  const key = streetKey(address)
  if (!key) return null
  const hits = objects.filter((o) => streetKey(o.address) === key)
  hits.sort((a, b) => Number(b.plans.length > 0) - Number(a.plans.length > 0) || a.name.localeCompare(b.name, 'de'))
  return hits[0] ?? null
}

/** How far «In der Nähe» reaches, and how many rows it lists. */
export const NEARBY_RADIUS_M = 160
export const NEARBY_MAX = 5

export interface NamedPoint { id: string; label: string; coord: LngLat }

/** One row of «In der Nähe»: a station object, or a hydrant with the compass direction it lies in
 *  from the place (`dir`, 0 = north … 7 = north-west — `compass8`). */
export type NearRow =
  | { kind: 'object'; item: StationObject; distanceM: number }
  | { kind: 'hydrant'; item: NamedPoint; distanceM: number; dir: number }

/**
 * «In der Nähe» (owner, Karte Haus round 1): ONE list by distance, objects and hydrants mixed — at
 * most `NEARBY_MAX` rows of what lies within `NEARBY_RADIUS_M`. The nearest hydrant is always in
 * it (`nearest`), however far: it replaces the last row when five closer things fill the list.
 * Distance and nothing else decides — `exceptId` is the selected object (or the house's own).
 */
export function nearbyPlaces(objects: readonly StationObject[], hydrants: readonly NamedPoint[], at: LngLat, opts: { exceptId?: string | null } = {}): NearRow[] {
  const rows: NearRow[] = []
  for (const o of objects) {
    if (o.id === opts.exceptId) continue
    const c = coordOf(o)
    if (!c) continue
    const d = haversineM(at, c)
    if (d <= NEARBY_RADIUS_M) rows.push({ kind: 'object', item: o, distanceM: d })
  }
  let nearest: Extract<NearRow, { kind: 'hydrant' }> | null = null
  for (const h of hydrants) {
    const row = { kind: 'hydrant' as const, item: h, distanceM: haversineM(at, h.coord), dir: compass8(at, h.coord) }
    if (!nearest || row.distanceM < nearest.distanceM) nearest = row
    if (row.distanceM <= NEARBY_RADIUS_M) rows.push(row)
  }
  rows.sort((a, b) => a.distanceM - b.distanceM)
  const out = rows.slice(0, NEARBY_MAX)
  if (nearest) {
    // farther than every row kept, so it goes last: appended, or in place of the fifth
    if (!out.includes(nearest)) out.splice(Math.min(out.length, NEARBY_MAX - 1), 1, nearest)
  }
  return out
}

/** The compass direction `to` lies in from `from`, of eight: 0 = north, 2 = east … 7 = north-west. */
export function compass8(from: LngLat, to: LngLat): number {
  const dx = (to[0] - from[0]) * Math.cos((from[1] * Math.PI) / 180)
  const dy = to[1] - from[1]
  const deg = ((Math.atan2(dx, dy) * 180) / Math.PI + 360) % 360
  return Math.round(deg / 45) % 8
}

/** Point features of a GeoJSON FeatureCollection as named points (a hydrant layer). The label is
 *  whatever the feature calls itself (`name`, `nr`, `id`, …), else its index. */
export function pointsFromGeoJson(fc: unknown, prefix = 'p'): NamedPoint[] {
  const feats = (fc as { features?: unknown[] } | null)?.features
  if (!Array.isArray(feats)) return []
  const out: NamedPoint[] = []
  feats.forEach((f, i) => {
    const g = (f as { geometry?: { type?: string; coordinates?: unknown } })?.geometry
    if (g?.type !== 'Point' || !Array.isArray(g.coordinates)) return
    const [lng, lat] = g.coordinates as number[]
    if (typeof lng !== 'number' || typeof lat !== 'number') return
    const props = ((f as { properties?: Record<string, unknown> }).properties ?? {}) as Record<string, unknown>
    const raw = ['name', 'Name', 'nr', 'Nr', 'nummer', 'Nummer', 'bezeichnung', 'Bezeichnung', 'id', 'ID']
      .map((k) => props[k]).find((v) => typeof v === 'string' || typeof v === 'number')
    out.push({ id: `${prefix}${i}`, label: raw != null ? String(raw) : String(i + 1), coord: [lng, lat] })
  })
  return out
}

/** How far a pin may be from an address and still be named after it («bei …»). */
export const PIN_ADDRESS_M = 60

/** A pin's name: the nearest register address when it is close enough to be the way to describe
 *  the spot, never the address OF the spot (that would be an object it is not). The reverse
 *  geocoder answers with the ASKED point (app/geocode · reverse, a ~40 m search radius), so a hit
 *  at the pin itself has no known distance (`null`) — it is near by construction. */
export function pinNear(hit: { label: string; lat: number; lng: number } | null, at: LngLat): { label: string; distanceM: number | null } | null {
  if (!hit) return null
  const d = haversineM(at, [hit.lng, hit.lat])
  if (d > PIN_ADDRESS_M) return null
  return { label: splitAddress(hit.label)[0], distanceM: d < 1 ? null : d }
}

/**
 * Every building that IS an object, and the one its point lies in (`main`, where the tag hangs).
 *
 * First the server's set (`footprint`, backend app/object_footprints, review 17.10.2026): every
 * building on the object's official use area (a school campus) or parcel, derived from the
 * cadastral survey — never a neighbour's, never by distance. `under` are the object's structures
 * without a surface building (a named row's underground garage, review round 3), drawn dashed. Without one (not derived yet, the
 * sources off, nothing official at the point) the OSM outline the point lies in, as before
 * (`outlineFor`). Null = no building known: the map shows the object at its point.
 */
export function objectBuildings(obj: Pick<StationObject, 'lat' | 'lng' | 'kind' | 'footprint' | 'outline' | 'underground'>, rings: readonly LngLat[][]): { rings: LngLat[][]; main: LngLat[] | null; under: LngLat[][] } | null {
  const at = coordOf(obj)
  // the station said «no outline» (/admin · Lage korrigieren): not even the OSM fallback
  if (!at || obj.outline === 'none') return null
  const own = footprintRings(obj.footprint)
  // underground garages / shelters of a named row (review round 3): part of the object, dashed
  const under = footprintRings(obj.underground)
  if (own.length) return { rings: own, main: ringAt(own, at), under }
  const r = outlineFor(obj, rings)
  return r ? { rings: [r], main: r, under } : null
}

/** A GeoJSON Polygon / MultiPolygon as outer rings in [lng, lat], without the closing vertex.
 *  Anything else (null, a point, garbage) is no rings. */
export function footprintRings(g: unknown): LngLat[][] {
  const geo = g as { type?: string; coordinates?: unknown } | null
  const polys = geo?.type === 'Polygon' ? [geo.coordinates] : geo?.type === 'MultiPolygon' && Array.isArray(geo.coordinates) ? geo.coordinates : []
  const out: LngLat[][] = []
  for (const p of polys as unknown[]) {
    const outer = Array.isArray(p) ? p[0] : null
    if (!Array.isArray(outer)) continue
    const ring = outer.filter((c): c is [number, number] => Array.isArray(c) && typeof c[0] === 'number' && typeof c[1] === 'number').map((c) => [c[0], c[1]] as LngLat)
    if (ring.length > 1 && ring[0][0] === ring[ring.length - 1][0] && ring[0][1] === ring[ring.length - 1][1]) ring.pop()
    if (ring.length >= 3) out.push(ring)
  }
  return out
}

/**
 * The OSM outline that IS an object's building: the smallest ring containing the object's own
 * coordinate. No ring contains it → no outline (the map then shows a tag at the point). A ring that
 * merely lies close is NOT taken — that is exactly the guess this rule exists to forbid.
 */
export function outlineFor(obj: Pick<StationObject, 'lat' | 'lng' | 'kind'>, rings: readonly LngLat[][]): LngLat[] | null {
  const at = coordOf(obj)
  if (!at) return null
  return ringAt(rings, at)
}

/** The smallest ring that contains `at` (outlines can nest: a courtyard house in a block). */
export function ringAt(rings: readonly LngLat[][], at: LngLat): LngLat[] | null {
  let best: LngLat[] | null = null
  let bestArea = Infinity
  for (const r of rings) {
    if (r.length < 3 || !ringContains(r, at)) continue
    const a = ringAreaDeg(r)
    if (a < bestArea) { best = r; bestArea = a }
  }
  return best
}

function ringAreaDeg(r: readonly LngLat[]): number {
  let s = 0
  for (let i = 0, j = r.length - 1; i < r.length; j = i++) s += r[j][0] * r[i][1] - r[i][0] * r[j][1]
  return Math.abs(s) / 2
}

/** Overpass' JSON (as `/api/overpass/buildings` passes it through) → outlines in [lng, lat]. A
 *  relation contributes its outer member ways. */
export function ringsFromOverpass(data: unknown): LngLat[][] {
  type Node = { lat: number; lon: number }
  type El = { type?: string; geometry?: Node[]; members?: { type?: string; role?: string; geometry?: Node[] }[] }
  const rings: LngLat[][] = []
  const add = (g?: Node[]) => {
    if (g && g.length >= 3) rings.push(g.map((n) => [n.lon, n.lat] as LngLat))
  }
  for (const el of ((data as { elements?: El[] } | null)?.elements ?? [])) {
    if (el.type === 'way') add(el.geometry)
    else if (el.type === 'relation') for (const m of el.members ?? []) if (m.type === 'way' && (m.role === 'outer' || !m.role)) add(m.geometry)
  }
  return rings
}

// --- addresses the viewer links to (contract C1) -----------------------------------------------

/** The checklist «Melden» asks for (owner, 17.10.2026 · R2): the station's «Fehlermeldung» —
 *  something is wrong or missing here. Station data (kp-front-data), never bundled: a deployment
 *  without it gets the visit chooser instead (components/objectVisits/NewVisit). */
export const REPORT_CHECKLIST = 'fehlermeldung'

/** A new Objektbesuch at a catalogue object, coming from the viewer — with `checklist` already
 *  chosen for «Melden» (`?checkliste=`, objectVisits/route). */
export function objectVisitHref(objectId: string, checklist?: string): string {
  const q = new URLSearchParams({ object: objectId })
  if (checklist) q.set('checkliste', checklist)
  q.set('from', 'karte')
  return `/besuche/neu?${q}`
}

/** A new Objektbesuch / Meldung at a place without an object (C1). `address` only when known. */
export function placeVisitHref(p: { at: LngLat; label: string; address?: string | null; checklist?: string }): string {
  const q = new URLSearchParams({ lat: p.at[1].toFixed(6), lng: p.at[0].toFixed(6), label: p.label })
  if (p.address?.trim()) q.set('address', p.address.trim())
  if (p.checklist) q.set('checkliste', p.checklist)
  q.set('from', 'karte')
  return `/besuche/neu?${q}`
}
