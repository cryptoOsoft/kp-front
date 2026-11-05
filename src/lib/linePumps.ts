import { appConfig } from '../config/appConfig'
import type { Drawing, Entity, LngLat } from '../types'
import { pathLengthM, pointAlongPath } from './geo'
import { hoseDefaults, planFor, resolveRelay, RELAY_PUMP_SYMBOL } from './hydraulics'
import { cachedProfile, loadProfile, reverseProfile, type ProfileResult } from './profile'

// The pumps a Leitung draws on the Karte («Pumpen auf Karte», RelaySettings · showPumps; owner
// 05.11.2026: «the Leitung draws its own pumps»). They are DERIVED, never stored: every render
// asks the Wassertransport calculation (lib/hydraulics) where the pumps stand along the line's
// path today, so they move with the line and with every changed assumption, and there is nothing
// to duplicate. A pump dragged on the map is a pin on the relay (`pumps[i].atM`), as on the chart.
// The live map runs the editor's own controller per line (components/RelayPumpMarkers ·
// LinePumpMarkers, lib/useRelay); the printed Kroki reads `drawnPumpEntities` (lib/krokiPayload) –
// the same steps, so screen = editor = paper. ⚠️ The terrain comes from lib/profile's cache, which
// all three share: no profile (offline, outside CH) plans on flat ground, as the editor does then.
// The «Pumpen als Symbole setzen» symbols placed between #536 and this (04.–05.11.2026) are
// ordinary Motorspritzen and stay so – nothing migrates them.

/** The Leitung draws its pumps: a hose line (not a Wand) with the switch on and a path. */
export const drawsPumps = (d: Pick<Drawing, 'kind' | 'role' | 'relay' | 'coords'>): boolean =>
  d.kind === 'line' && !d.role && !!d.relay?.showPumps && Array.isArray(d.coords) && d.coords.length >= 2

/** Where the pumps of a Leitung's Wassertransport stand on the map, source side first: the plan
 *  along the route the water takes (the path, backwards on a reversed relay) with the line's Ø
 *  (lib/useRelay's reading: a shown relay IS a Wassertransport, so an absent Ø is the relay
 *  default). `profile`: the DRAWN path's, as fetched; null plans on flat ground. */
export function linePumpSpots(d: Pick<Drawing, 'coords' | 'hose' | 'relay'>, profile: ProfileResult | null): LngLat[] {
  const reversed = !!d.relay?.reverse
  const coords = reversed ? [...d.coords].reverse() : d.coords
  const lengthM = pathLengthM(coords)
  if (coords.length < 2 || lengthM < 1) return []
  const prof = profile && reversed ? reverseProfile(profile) : profile
  const plan = planFor(resolveRelay(d.hose, d.relay, hoseDefaults().relay), lengthM, prof?.points ?? null)
  return plan.pumps.map((p) => pointAlongPath(coords, p.dist))
}

/** Every drawn pump of `drawings` as the Motorspritze the PAPER prints (krokiPayload, and the
 *  Rapport's Kroki preview, KrokiFramingPanel): a plain symbol on the drawings' layer, so it hides
 *  with them. From the profiles already fetched – sync; a print awaits `readyLinePumps` first.
 *  Never stored: built for the one payload or preview, and gone with it. */
export function drawnPumpEntities(drawings: readonly Drawing[]): Entity[] {
  return drawings.filter(drawsPumps).flatMap((d) => linePumpSpots(d, cachedProfile(d.coords) ?? null).map((coord, i): Entity => ({
    id: `${d.id}:pump${i + 1}`, kind: 'symbol', layer: appConfig.defaults.drawingLayerId, coord, symbol: RELAY_PUMP_SYMBOL,
  })))
}

/** Fetch the profile of every Leitung that draws its pumps, so `drawnPumpEntities` plans on terrain –
 *  awaited before a print is composed (lib/reportPdfDirect · readyDirectReportPayload). */
export async function readyLinePumps(drawings: readonly Drawing[]): Promise<void> {
  await Promise.all(drawings.filter(drawsPumps).map((d) => loadProfile(d.coords)))
}
