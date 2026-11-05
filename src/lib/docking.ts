// Gefahrentafel andocken (Feldtest Manuel, 07.09.: «Evtl. noch andocken?») — the placard
// dropped beside an object becomes ITS placard: `Entity.dockedTo` records the bond, and from
// then on the host drags its placard along, the way a Gefahrentafel physically hangs on the
// tank it describes.
//
// …and since 15.09. a TRUPP MARKER docks the same way: dropped beside a symbol (a door, a
// hydrant, a vehicle) it is «bei» that object — the board card says so, and the marker rides
// along when the host is moved. Same bond, same radius, same release gesture.
//
// Deliberately narrower than the magnetic line machinery (lib/lineAttachments): no dwell ring,
// no ports, no resolve-at-render — the bond is decided once, on drop, and the placard keeps its
// own honest coordinate. Karte-only, like the ERG rings: on a Plan the placard sits inside a
// drawn Kroki where «daneben» already says everything, and a normalized surface has no metric
// drop radius to reason about.

import type { Entity, LngLat } from '../types'
import { appConfig } from '../config/appConfig'

/** Drop radius in SCREEN pixels, centre to centre. Wider than the line magnet's 32: a placard
 *  is parked NEXT to a ~40 px glyph, not on top of it, so the honest drop zone is the glyph
 *  plus one placard width. Farther than this on release and an existing bond is let go — the
 *  same gesture in reverse. */
export const DOCK_RADIUS_PX = 56
/** …and for a Trupp marker (15.09.). Its anchor is the dot at the LEFT of a ~200 px pill: parked
 *  «beside» a symbol the way a hand does it – pill under or next to the glyph – the dot ends up
 *  two glyph widths away. Measured on a real drop: 57 px, one over the placard radius, and
 *  nothing happened. */
export const TEAM_DOCK_RADIUS_PX = 120

/** The drop radius that fits the thing being dropped. */
export const dockRadiusFor = (e: Entity | undefined): number => (e?.kind === 'team' ? TEAM_DOCK_RADIUS_PX : DOCK_RADIUS_PX)

/** May this entity carry a placard? Symbols and parked vehicles — never a live (GPS-fed)
 *  vehicle, whose position updates bypass the drag funnel the carry lives in, and never
 *  another placard: a placard describes an object, not a second placard. */
export function isDockHost(e: Entity): boolean {
  return (e.kind === 'symbol' || e.kind === 'vehicle') && !e.live && e.symbol !== appConfig.symbols.placardName
}

export function isPlacard(e: Entity | undefined): boolean {
  return e?.kind === 'symbol' && e.symbol === appConfig.symbols.placardName
}

/** May this entity dock to a host on drop? A placard, or a team (Trupp) marker. */
export function isDockable(e: Entity | undefined): boolean {
  return isPlacard(e) || e?.kind === 'team'
}

// ── Der feste Andock-Platz (Bastian, 15.09.2026) ────────────────────────────────────────────
//
// «always show the trupp at the same clean place». A docked Trupp marker used to be DRAWN where
// the hand happened to let go of it — below the tile, left of it, half over the caption — so the
// same bond looked different on every symbol and the eye had to hunt for the crew.
//
// It is now drawn at ONE place: the host tile's bottom-left corner, mirroring the storey badge on
// the top-right (03-map.css · .sym-floor). Only the RENDERED position snaps — the marker keeps
// its own honest coordinate (the drop point, carried along by `carryDocked` when the host moves),
// so dragging it away past the detach radius, or «Lösen» on either side, puts it straight back
// where it stands.
//
// ⚠️ Several Trupps on one host stack DOWNWARDS, not sideways. A Trupp marker is a strip —
// [dot][gap][name] — anchored by its left edge, so a second one beside the first would lay its
// name straight across the first one's. Downwards each strip gets its own horizontal band, which
// is also the only arrangement the label pass can book without measuring text it never renders
// (components/useLabelPass · mapLabelDecisions).

/** The vertical pitch of the stack: one name plate (~19.6px; the dot's 16px box fits inside it),
 *  so the plates meet and the dots keep 3px of air. */
export const DOCK_SLOT_STEP_PX = 19

/** The strip's dot (lib/mapView · TEAM_DOT_PX – not imported: mapView imports this file) and
 *  the air between the tile's bottom edge and the first strip. */
const DOT_PX = 16
const DOCK_GAP_PX = 5

/** Where a docked Trupp marker's DOT is drawn, in screen px from the HOST glyph's centre: the
 *  strip sits BELOW the tile, centred on it when the caller knows the strip's width (`stripPx`,
 *  lib/mapView · teamStripPx), else flush with the tile's left edge. `hostPx` is the host tile's
 *  on-screen edge length (lib/mapView · symPx); `index` is the marker's place in its host's stack
 *  (0 = the first strip under the tile). */
export function dockSlotOffset(hostPx: number, index: number, stripPx?: number): { dx: number; dy: number } {
  // with the strip's width known it is CENTRED under the tile (15.09., «align the bottom row to
  // the middle»); the dot then sits half a strip left of the host's centre
  const dx = stripPx != null ? -stripPx / 2 + DOT_PX / 2 : -hostPx / 2 + DOT_PX / 2
  return { dx, dy: hostPx / 2 + DOCK_GAP_PX + DOT_PX / 2 + index * DOCK_SLOT_STEP_PX }
}

/** Every docked Trupp marker's place in its host's stack, by entity id.
 *  Ordered by id, so the stack does not re-shuffle under a sync that re-orders the array — a
 *  marker that swapped slots between two frames would read as the crew moving. */
export function dockSlots(entities: readonly Entity[]): Map<string, number> {
  const out = new Map<string, number>()
  const byHost = new Map<string, string[]>()
  for (const e of entities) {
    if (e.kind !== 'team' || !e.dockedTo) continue
    byHost.set(e.dockedTo, [...(byHost.get(e.dockedTo) ?? []), e.id])
  }
  for (const ids of byHost.values()) {
    [...ids].sort((a, b) => a.localeCompare(b)).forEach((id, i) => out.set(id, i))
  }
  return out
}

/** The host a just-dropped placard bonds to: the nearest dockable entity within
 *  DOCK_RADIUS_PX of the drop, or null — which also means «release the current bond».
 *  `project` is the map's lngLat→screen conversion, injected so this stays pure. */
export function nearestDockHost(
  coord: LngLat,
  entities: readonly Entity[],
  project: (c: LngLat) => { x: number; y: number },
  radius = DOCK_RADIUS_PX,
): Entity | null {
  const at = project(coord)
  let best: Entity | null = null
  let bestD = radius
  for (const e of entities) {
    if (!isDockHost(e) || !e.coord) continue
    const p = project(e.coord)
    const d = Math.hypot(p.x - at.x, p.y - at.y)
    if (d <= bestD) { best = e; bestD = d }
  }
  return best
}

/** The host moved: shift every placard docked to it by the same delta, so the pair keeps the
 *  offset the operator chose. Pure — the caller decides which document write it happens in
 *  (mid-drag `setDocRaw` and the final commit both run through this). */
export function carryDocked(entities: readonly Entity[], hostId: string, from: LngLat, to: LngLat): Entity[] {
  const dx = to[0] - from[0]
  const dy = to[1] - from[1]
  if (dx === 0 && dy === 0) return [...entities]
  return entities.map((e) =>
    e.dockedTo === hostId && e.coord ? { ...e, coord: [e.coord[0] + dx, e.coord[1] + dy] as LngLat } : e,
  )
}
