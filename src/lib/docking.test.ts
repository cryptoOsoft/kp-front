// The bond is decided by pixel distance and carried by coordinate deltas — both of which fail
// silently when wrong (a placard that "just doesn't dock", a pair that drifts apart). These pin
// the host rules, the drop radius and the carry arithmetic.

import { describe, expect, it } from 'vitest'
import type { Entity, LngLat } from '../types'
import { appConfig } from '../config/appConfig'
import { DOCK_RADIUS_PX, DOCK_SLOT_STEP_PX, TEAM_DOCK_RADIUS_PX, carryDocked, dockRadiusFor, dockSlotOffset, dockSlots, isDockHost, isDockable, nearestDockHost } from './docking'

// a fake projection: 1° = 1000 px, so pixel thresholds are easy to stage
const project = (c: LngLat) => ({ x: c[0] * 1000, y: c[1] * 1000 })

const tank: Entity = { id: 'tank', kind: 'symbol', layer: 'taktisch', coord: [0, 0], symbol: 'VKF Feuer', label: 'Tank' }
const placard: Entity = {
  id: 'p1', kind: 'symbol', layer: 'taktisch', coord: [0.02, 0],
  symbol: appConfig.symbols.placardName, fields: { 'UN-Nr.': '1203' }, dockedTo: 'tank',
}

describe('isDockHost', () => {
  it('symbols and parked vehicles host; live vehicles and other placards never do', () => {
    expect(isDockHost(tank)).toBe(true)
    expect(isDockHost({ ...tank, kind: 'vehicle' })).toBe(true)
    expect(isDockHost({ ...tank, kind: 'vehicle', live: true })).toBe(false)
    expect(isDockHost({ ...placard, dockedTo: undefined })).toBe(false)
  })
})

describe('isDockable', () => {
  it('a placard and a team marker dock; a plain symbol never does', () => {
    expect(isDockable(placard)).toBe(true)
    expect(isDockable({ id: 't', kind: 'team', layer: 'taktisch', coord: [0, 0], label: 'Trupp 1' })).toBe(true)
    expect(isDockable(tank)).toBe(false)
    expect(isDockable(undefined)).toBe(false)
  })
})

describe('nearestDockHost', () => {
  it('finds the nearest dockable entity inside the drop radius, and nothing outside it', () => {
    const near: LngLat = [DOCK_RADIUS_PX / 2000, 0]
    const far: LngLat = [(DOCK_RADIUS_PX + 10) / 1000, 0]
    expect(nearestDockHost(near, [tank], project)?.id).toBe('tank')
    expect(nearestDockHost(far, [tank], project)).toBeNull()
  })

  // a Trupp pill's anchor dot sits two glyph widths from the symbol it was parked beside
  it('a team marker docks from farther away than a placard', () => {
    const team: Entity = { id: 't', kind: 'team', layer: 'taktisch', coord: [0, 0], label: 'Trupp 1' }
    const parked: LngLat = [(DOCK_RADIUS_PX + 20) / 1000, 0]
    expect(dockRadiusFor(team)).toBe(TEAM_DOCK_RADIUS_PX)
    expect(nearestDockHost(parked, [tank], project, dockRadiusFor(placard))).toBeNull()
    expect(nearestDockHost(parked, [tank], project, dockRadiusFor(team))?.id).toBe('tank')
  })

  it('never offers an undockable entity, however close', () => {
    const loosePlacard = { ...placard, dockedTo: undefined }
    expect(nearestDockHost([0.001, 0], [loosePlacard], project)).toBeNull()
  })
})

describe('carryDocked', () => {
  it('shifts a docked placard by the host delta, preserving the chosen offset', () => {
    const out = carryDocked([tank, placard], 'tank', [0, 0], [0.5, 0.25])
    expect(out.find((e) => e.id === 'p1')?.coord).toEqual([0.52, 0.25])
  })

  it('leaves undocked entities and other hosts alone', () => {
    const loose = { ...placard, id: 'p2', dockedTo: undefined }
    const out = carryDocked([tank, placard, loose], 'other-host', [0, 0], [1, 1])
    expect(out.find((e) => e.id === 'p1')?.coord).toEqual([0.02, 0])
    expect(out.find((e) => e.id === 'p2')?.coord).toEqual([0.02, 0])
  })
})

// ── Der feste Andock-Platz (Bastian, 15.09.2026) ────────────────────────────────────────────
// «always show the trupp at the same clean place». A docked Trupp marker is DRAWN on its host
// tile's bottom-left corner — mirroring the storey badge on the top-right — and several of them
// stack DOWNWARDS, so each strip [dot][gap][name] gets its own horizontal band. Both halves of
// the map read these numbers: MapMarkers offsets the marker, MapView's label pass books the box.
describe('dockSlotOffset (where a docked Trupp marker is drawn)', () => {
  it('puts the first one just under the tile, its dot flush with the tile\'s left edge', () => {
    expect(dockSlotOffset(40, 0)).toEqual({ dx: -20 + 8, dy: 20 + 5 + 8 })
  })

  it('stacks the next ones DOWNWARDS, one pitch apart, on the same left edge', () => {
    const three = [0, 1, 2].map((i) => dockSlotOffset(40, i))
    expect(three.map((s) => s.dx)).toEqual([-12, -12, -12])
    expect(three.map((s) => s.dy)).toEqual([33, 33 + DOCK_SLOT_STEP_PX, 33 + 2 * DOCK_SLOT_STEP_PX])
  })

  it('centres the strip under the tile once its width is known', () => {
    // a 60 px strip under a 40 px tile: the dot half a strip left of centre, same row
    expect(dockSlotOffset(40, 0, 60)).toEqual({ dx: -30 + 8, dy: 20 + 5 + 8 })
  })

  it('tracks the glyph: a bigger tile pushes the corner out with it', () => {
    expect(dockSlotOffset(48, 0)).toEqual({ dx: -24 + 8, dy: 24 + 5 + 8 })
  })
})

describe('dockSlots (which Trupp marker sits in which slot)', () => {
  const team = (id: string, dockedTo?: string): Entity =>
    ({ id, kind: 'team', layer: 'taktisch', coord: [0, 0], label: id, dockedTo }) as Entity

  it('numbers each host\'s stack from the corner, by id — never by array order', () => {
    // a sync that re-orders the array must not re-shuffle the stack: a marker that swapped
    // slots between two frames would read as the crew moving
    const slots = dockSlots([team('b', 'tank'), team('a', 'tank'), team('c', 'other')])
    expect(slots.get('a')).toBe(0)
    expect(slots.get('b')).toBe(1)
    expect(slots.get('c')).toBe(0)
  })

  it('ignores a loose marker and a docked PLACARD — only Trupp markers take a slot', () => {
    const slots = dockSlots([team('loose'), placard, tank])
    expect(slots.size).toBe(0)
  })
})
