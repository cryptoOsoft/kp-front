import type { Drawing, LngLat } from '../types'
import { haversineM } from './geo'

// Which ERG distances of a Gefahrentafel already stand as a real Absperrkreis (UnHazardSection ·
// «Absperrkreis übernehmen», MapDetailPanels). The done state of that one-time action is READ off
// the Karte, not latched (docs/ui-conventions.md · One-time actions): the row shows ✓ «Absperrkreis
// gesetzt» while a circle of that radius stands around the placard – after a reselect, on every
// device, and gone again with the circle (its toast's «Rückgängig», ↶, or a deletion).

/** A circle «stands around» the placard within this much (m): createCircle puts it exactly on the
 *  coordinate, so this only absorbs float round trips through sync. */
const CENTRE_M = 1
/** …and «has that radius» within this much (m): the ERG value is parsed from «0.2 km». */
const RADIUS_M = 0.5

/** The radii (m) of the circles centred on `coord`. */
export function ergAdoptedRadii(drawings: readonly Drawing[], coord: LngLat): number[] {
  return drawings.flatMap((d) => (d.kind === 'circle' && d.radiusM != null && d.coords[0] && haversineM(d.coords[0], coord) <= CENTRE_M ? [d.radiusM] : []))
}

/** Is `metres` one of them? */
export const isErgAdopted = (radii: readonly number[], metres: number): boolean => radii.some((r) => Math.abs(r - metres) <= RADIUS_M)
