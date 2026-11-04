import { describe, expect, it } from 'vitest'
import { fitSimilarity, type GeorefPair } from './georef'
import { liveOverlay, photoOverlay, projectOnto } from './planProjection'
import { applyBoardToObjects, bakeGeoBody, sheetAnnos, viewsOf, type PlanFit, type TacticalObject } from './tacticalObjects'
import { SHAPE_DEFS } from './shapes'
import type { BoardAnno, Drawing, Entity } from '../types'

/* The Karte in one sheet's own words. This is the mirror of `bakeGeoBody`, and the pair has to
 * stay inverse: a projected anno that comes back off the sheet becomes the object's stored sheet
 * body verbatim, so anything this derivation does that the bake does not undo would rotate,
 * resize or displace the object a little on every anchor flip. */

const ORIGIN = { lng: 7.5525, lat: 47.5145 }
const mEast = (m: number) => ({ lng: ORIGIN.lng + m / (111320 * Math.cos((ORIGIN.lat * Math.PI) / 180)), lat: ORIGIN.lat })
const coordEast = (m: number): [number, number] => { const p = mEast(m); return [p.lng, p.lat] }
const PAIRS: GeorefPair[] = [
  { plan: { x: 0, y: 0 }, lngLat: ORIGIN },
  { plan: { x: 1, y: 0 }, lngLat: mEast(100) },
]
const PLAN: PlanFit = { fit: fitSimilarity(PAIRS, 1)!, aspect: 1 }

const ent = (over: Partial<Entity> & { id: string }): Entity =>
  ({ kind: 'symbol', layer: 'taktisch', coord: [ORIGIN.lng, ORIGIN.lat], ...over })
const geo = (e: Entity): TacticalObject => ({ id: e.id, entity: e })
const drawn = (d: Drawing): TacticalObject => ({ id: d.id, drawing: d })

describe('projectOnto — what a sheet shows of the Karte', () => {
  it('puts a map symbol at its place on the paper, under its own id', () => {
    const a = projectOnto(geo(ent({ id: 'e1', symbol: 'Feuer', label: 'Brandherd', coord: coordEast(50) })), PLAN)!
    expect(a.id).toBe('e1') // the SAME object — that is what lets an edit be matched back
    expect(a.kind).toBe('symbol')
    expect(a.label).toBe('Brandherd')
    expect(a.x).toBeCloseTo(0.5, 6)
    expect(a.y).toBeCloseTo(0, 6)
  })

  it('drops what is not on the sheet, and keeps what is a hair past its edge', () => {
    expect(projectOnto(geo(ent({ id: 'far', coord: coordEast(2000) })), PLAN)).toBeNull()
    expect(projectOnto(geo(ent({ id: 'edge', coord: coordEast(101) })), PLAN)).not.toBeNull()
  })

  it('shows nothing of an object anchored on a sheet — plan A never clutters plan B', () => {
    const onSheet: TacticalObject = { id: 's1', sheet: { planId: 'modul3', anno: { id: 's1', kind: 'symbol', x: 0.5, y: 0.5 } } }
    expect(projectOnto(onSheet, PLAN)).toBeNull()
  })

  it('a live vehicle is a moment, not a record — it is no part of the document', () => {
    expect(projectOnto(geo(ent({ id: 'v1', live: true })), PLAN)).toBeNull()
    expect(liveOverlay([ent({ id: 'v1', live: true, coord: coordEast(50) })], PLAN)).toHaveLength(1)
  })

  it('a circle stays a circle — the ring the twins drew could never round-trip', () => {
    const a = projectOnto(drawn({ id: 'c1', kind: 'circle', coords: [coordEast(50)], radiusM: 25 }), PLAN)!
    expect(a.kind).toBe('circle')
    expect(a.radiusN).toBeCloseTo(0.25, 4)
  })

  it('a Fläche whose vertices are all just off the paper still meets it', () => {
    const around = drawn({ id: 'a1', kind: 'area', coords: [coordEast(-40), coordEast(140), [mEast(50).lng, ORIGIN.lat - 0.002]] })
    expect(projectOnto(around, PLAN)).not.toBeNull()
  })
})

describe('projection ⇄ bake are inverse', () => {
  const roundTrip = (o: TacticalObject): TacticalObject => {
    const anno = projectOnto(o, PLAN)!
    return bakeGeoBody({ id: o.id, sheet: { planId: 'modul2', anno } }, PLAN, 'taktisch')
  }

  it('a symbol comes back where it stood, pointing where it pointed', () => {
    const o = geo(ent({ id: 'e1', symbol: 'VKF Fahrzeug', coord: coordEast(50), rotation: 30, label: 'Brandherd', count: 2 }))
    const back = roundTrip(o).entity!
    expect(back.coord[0]).toBeCloseTo(o.entity!.coord[0], 8)
    expect(back.rotation).toBeCloseTo(30, 6)
    expect(back).toMatchObject({ label: 'Brandherd', count: 2, symbol: 'VKF Fahrzeug' })
  })

  it('…a Form keeps its metres, a Hubretter its reach, a Trupp its breadcrumbs', () => {
    const shape = roundTrip(geo(ent({ id: 'sh', kind: 'shape', shape: 'square', coord: coordEast(50), sizeM: 30 }))).entity!
    expect(shape.sizeM).toBeCloseTo(30, 3)
    const reach = roundTrip(geo(ent({ id: 'hr', symbol: 'Feuer', coord: coordEast(50), reachM: 18 }))).entity!
    expect(reach.reachM).toBeCloseTo(18, 3)
    const team = roundTrip(geo(ent({ id: 'tm', kind: 'team', coord: coordEast(50), label: 'Trupp 1', t: '10:15', trail: [{ coord: coordEast(20), t: '10:00' }] }))).entity!
    expect(team.trail).toHaveLength(1)
    expect(team.trail![0].coord[0]).toBeCloseTo(mEast(20).lng, 8)
  })

  it('…and a line every vertex, its FKS annotations with it', () => {
    const o = drawn({ id: 'l1', kind: 'line', coords: [coordEast(10), coordEast(60)], lineNo: 2, content: 'S', teilstueck: true })
    const back = roundTrip(o).drawing!
    expect(back.coords[1][0]).toBeCloseTo(mEast(60).lng, 8)
    expect(back).toMatchObject({ lineNo: 2, content: 'S', teilstueck: true })
  })

  it('…and a Leitung keeps its hose and Wassertransport across (the sheet only carries them)', () => {
    const relay = { flow: 1200, source: 'weier' as const, pumps: [null, { atM: 420, bar: 8 }] }
    const o = drawn({ id: 'l2', kind: 'line', coords: [coordEast(10), coordEast(60)], hose: '2x75', relay })
    expect(roundTrip(o).drawing).toMatchObject({ hose: '2x75', relay })
  })

  it('…and a Wand drawn on the Karte stays a Wand on the sheet and back (sweep 28.10.2026)', () => {
    const o = drawn({ id: 'w1', kind: 'line', coords: [coordEast(10), coordEast(60)], role: 'wand' })
    expect(roundTrip(o).drawing?.role).toBe('wand')
  })

  it('⚠️ a turned sheet turns the glyph on the paper, and only on the paper', () => {
    // the fit's own turn is a FRAME change: paper-relative in the anno, north-relative on the
    // ground. Applied on one side and not undone on the other, a flip would spin the symbol.
    const turned: PlanFit = {
      fit: fitSimilarity([{ plan: { x: 0, y: 0 }, lngLat: ORIGIN }, { plan: { x: 1, y: 0 }, lngLat: { lng: ORIGIN.lng, lat: ORIGIN.lat - 0.0009 } }], 1)!,
      aspect: 1,
    }
    const o = geo(ent({ id: 'e1', symbol: 'VKF Fahrzeug', coord: coordEast(0), rotation: 0 }))
    const anno = projectOnto(o, turned)!
    expect(anno.rotation).not.toBe(0) // …turned into the paper's frame
    // …and back to north, where «points north» is said the shorter way: absent
    expect(bakeGeoBody({ id: 'e1', sheet: { planId: 'm', anno } }, turned, 'taktisch').entity!.rotation).toBeUndefined()
    const turnedOnPaper = { ...anno, rotation: (anno.rotation ?? 0) + 30 }
    expect(bakeGeoBody({ id: 'e1', sheet: { planId: 'm', anno: turnedOnPaper } }, turned, 'taktisch').entity!.rotation).toBeCloseTo(30, 6)
  })

  it('…but a symbol with no direction never acquires one from the paper it lies on', () => {
    const o = geo(ent({ id: 'e1', symbol: 'Feuer', coord: coordEast(50) })) // no rotation control
    expect(projectOnto(o, PLAN)!.rotation).toBeUndefined()
  })
})

describe('applyBoardToObjects — a sheet edit of what it was only SHOWING', () => {
  const store = () => [geo(ent({ id: 'e1', symbol: 'Feuer', coord: coordEast(50), label: 'Brandherd' }))]
  const sheet = (o: TacticalObject[]) => o.map((x) => projectOnto(x, PLAN)).filter((a): a is BoardAnno => !!a)

  it('handing the projection straight back changes nothing at all', () => {
    const objects = store()
    expect(applyBoardToObjects(objects, 'modul2', sheet(objects), PLAN, 'taktisch')).toBe(objects)
  })

  it('a prop edit lands on the MAP body and the object stays geo-anchored', () => {
    const objects = store()
    const [a] = sheet(objects)
    const next = applyBoardToObjects(objects, 'modul2', [{ ...a, label: 'Rauch', color: '#f00' }], PLAN, 'taktisch')
    expect(next[0].sheet).toBeUndefined()
    expect(next[0].entity).toMatchObject({ label: 'Rauch', color: '#f00' })
    expect(next[0].entity!.coord).toEqual(objects[0].entity!.coord) // …and exactly where it stood
  })

  it('a MOVE on the sheet flips the anchor, and the bake follows the paper', () => {
    const objects = store()
    const [a] = sheet(objects)
    const next = applyBoardToObjects(objects, 'modul2', [{ ...a, x: 0.25, y: 0.5 }], PLAN, 'taktisch')
    expect(next[0].sheet?.planId).toBe('modul2')
    const baked = bakeGeoBody(next[0], PLAN, 'taktisch')
    expect(baked.entity!.coord[0]).toBeCloseTo(mEast(25).lng, 6) // the map position moved with it
  })

  it('…while a MACHINE move writes through and leaves the anchor alone', () => {
    const objects = store()
    const [a] = sheet(objects)
    const next = applyBoardToObjects(objects, 'modul2', [{ ...a, x: 0.25, y: 0 }], PLAN, 'taktisch', false)
    expect(next[0].sheet).toBeUndefined()
    expect(next[0].entity!.coord[0]).toBeCloseTo(mEast(25).lng, 6)
  })

  it('deleting it on the sheet deletes the object — it is the object', () => {
    expect(applyBoardToObjects(store(), 'modul2', [], PLAN, 'taktisch')).toEqual([])
  })

  it('an object the sheet never showed is untouched by anything that happens on it', () => {
    const objects = [...store(), geo(ent({ id: 'far', coord: coordEast(3000) }))]
    const next = applyBoardToObjects(objects, 'modul2', [], PLAN, 'taktisch')
    expect(next.map((o) => o.id)).toEqual(['far'])
  })

  it('the sheet’s own annos keep their paint order; a shown object keeps its place in the store', () => {
    const objects = [geo(ent({ id: 'e1', coord: coordEast(50) })), { id: 'n1', sheet: { planId: 'modul2', anno: { id: 'n1', kind: 'symbol' as const, x: 0.1, y: 0.1 } } }]
    const annos = [...sheet(objects), objects[1].sheet!.anno]
    const next = applyBoardToObjects(objects, 'modul2', [annos[1], annos[0]], PLAN, 'taktisch')
    // e1 stayed geo-anchored at its index; the native anno is still the only thing on the sheet
    expect(viewsOf(next).board.modul2?.map((a) => a.id)).toEqual(['n1'])
    expect(next[0].id).toBe('e1')
  })
})

describe('inverse in the details, not just in the geometry', () => {
  const TURNED: PlanFit = {
    fit: fitSimilarity([{ plan: { x: 0, y: 0 }, lngLat: ORIGIN }, { plan: { x: 1, y: 0 }, lngLat: { lng: ORIGIN.lng, lat: ORIGIN.lat - 0.0009 } }], 1)!,
    aspect: 1,
  }
  const roundTrip = (o: TacticalObject, plan = PLAN): TacticalObject =>
    bakeGeoBody({ id: o.id, sheet: { planId: 'm', anno: projectOnto(o, plan)! } }, plan, 'taktisch')

  it('an UNSIZED Form comes back the size it was drawn at', () => {
    // ⚠️ a flat default here meant an unsized Pfeil visibly resized the moment it was flipped
    const arrow = geo(ent({ id: 'a1', kind: 'shape', shape: 'arrow', coord: coordEast(50) }))
    const back = roundTrip(arrow).entity!
    expect(back.sizeM).toBeCloseTo(SHAPE_DEFS.arrow.defaultSizeM, 3)
    expect(back.rotation).toBeUndefined() // …and it did not acquire a bearing on the way
  })

  it('a SECOND bearing turns with the paper too — the boom stays on its truck', () => {
    const mid = TURNED.fit.toMap({ x: 0.5, y: 0.5 })
    const hubretter = geo(ent({ id: 'h1', symbol: 'VKF Hubretter', coord: [mid.lng, mid.lat], rotation: 10, rotation2: 80 }))
    const anno = projectOnto(hubretter, TURNED)!
    expect(anno.rotation2).not.toBe(80) // …expressed in the paper's frame
    const back = bakeGeoBody({ id: 'h1', sheet: { planId: 'm', anno } }, TURNED, 'taktisch').entity!
    expect(back.rotation).toBeCloseTo(10, 6)
    expect(back.rotation2).toBeCloseTo(80, 6)
  })

  it('absent stays absent — nothing materializes as 0 or an empty string', () => {
    // ⚠️ a ROTATABLE glyph, because that is the case the frame change touches: an ordinary
    // unturned Fahrzeug used to come back carrying `rotation: 0` the first time it was flipped
    const bare = geo(ent({ id: 'b1', symbol: 'VKF Fahrzeug', coord: coordEast(50) }))
    const back = roundTrip(bare).entity!
    expect(back.rotation).toBeUndefined()
    expect(back.rotation2).toBeUndefined()
    expect(back.label).toBeUndefined()
    const note = roundTrip(geo(ent({ id: 'n1', kind: 'note', coord: coordEast(50) }))).entity!
    expect(note.label).toBeUndefined()
  })
})

describe('the Gebäude stack shows a map object on the tile of its badge', () => {
  const STACK: PlanFit = { ...PLAN, stack: { floors: [-1, 0, 1] } }
  const at = PLAN.fit.toMap({ x: 0.5, y: 0.5 })
  const fire = (over: Partial<Entity>): TacticalObject => ({ id: 'f', entity: { id: 'f', kind: 'symbol', symbol: 'brand', layer: 'taktisch', coord: [at.lng, at.lat], ...over } })
  it('Von picks the tile (else the badge, else 0); a span shows on every tile up to Bis; storeys the stack lacks show nothing', () => {
    expect(projectOnto(fire({ floor: 1 }), STACK)).toMatchObject({ id: 'f', floor: 1 })
    expect(projectOnto(fire({}), STACK)).toMatchObject({ id: 'f', floor: 0 })
    expect(projectOnto(fire({ floor: 0 }), STACK)).toMatchObject({ id: 'f', floor: 0 })
    expect(projectOnto(fire({ floor: 3 }), STACK)).toBeNull()
    expect(projectOnto(fire({ floorFrom: -1, floorTo: 1 }), STACK)).toMatchObject({ id: 'f', floor: -1, floorFrom: -1, floorTo: 1 })
    expect(projectOnto(fire({ floorFrom: 2, floorTo: 5 }), STACK)).toBeNull()
    expect(projectOnto(fire({ floor: 1 }), STACK)).not.toHaveProperty('storey') // the tile says the floor
    expect(projectOnto(fire({ floor: 1 }), PLAN)).toMatchObject({ storey: 1 }) // an ordinary sheet badges it
  })
  it('a Leitung follows its floorTag the same way', () => {
    const hose: TacticalObject = { id: 'h', drawing: { id: 'h', kind: 'line', coords: [[at.lng, at.lat], [at.lng + 0.0001, at.lat]], floorTag: -1 } }
    expect(projectOnto(hose, STACK)).toMatchObject({ id: 'h', floor: -1 })
    expect(projectOnto({ ...hose, drawing: { ...hose.drawing!, floorTag: 2 } }, STACK)).toBeNull()
  })
})

describe('what a storey tile carries onto the Karte', () => {
  const STACK: PlanFit = { ...PLAN, stack: { floors: [0, 1, 2] } }
  const tile = (anno: Partial<BoardAnno>): TacticalObject => ({ id: 'o', sheet: { planId: 'gebaeude', anno: { id: 'o', kind: 'symbol', symbol: 'brand', x: 0.5, y: 0.5, ...anno } } })
  it('the tile is Von = Bis on the Karte, explicit – tile 0 included; a span set on the tile goes as it is', () => {
    expect(bakeGeoBody(tile({ floor: 2 }), STACK, 'taktisch').entity).toMatchObject({ floorFrom: 2, floorTo: 2 })
    expect(bakeGeoBody(tile({}), STACK, 'taktisch').entity).toMatchObject({ floorFrom: 0, floorTo: 0 })
    expect(bakeGeoBody(tile({ floor: 0, floorFrom: 0, floorTo: 2 }), STACK, 'taktisch').entity).toMatchObject({ floorFrom: 0, floorTo: 2 })
    expect(bakeGeoBody(tile({ floor: 2 }), STACK, 'taktisch').entity?.floor).toBeUndefined()
    expect(bakeGeoBody(tile({ storey: 1 }), PLAN, 'taktisch').entity?.floor).toBe(1) // an ordinary sheet: the storey badge, as before
    expect(bakeGeoBody(tile({}), PLAN, 'taktisch').entity?.floor).toBeUndefined()
  })
  // 18.09.2026: the Trupp marker shows its storey on the Karte too. A resource chip is the one
  // symbol whose storey is a signed BADGE rather than a Von/Bis span — it stands on one floor.
  it('a Trupp chip hands the Karte its storey as a signed floor badge', () => {
    const teamOn = (floor?: number): TacticalObject => ({ id: 'r', sheet: { planId: 'gebaeude', anno: { id: 'r', kind: 'resource', text: 'Müller', x: 0.5, y: 0.5, floor } } })
    expect(bakeGeoBody(teamOn(2), STACK, 'taktisch').entity?.floor).toBe(2)
    expect(bakeGeoBody(teamOn(), STACK, 'taktisch').entity?.floor).toBe(0)
    // off a stack there is no storey to state, and a 0 would assert an EG nobody said
    expect(bakeGeoBody(teamOn(2), PLAN, 'taktisch').entity?.floor).toBeUndefined()
  })
  it('a line gets the floorTag, a note the floor', () => {
    const line: TacticalObject = { id: 'l', sheet: { planId: 'gebaeude', anno: { id: 'l', kind: 'draw', floor: 1, pts: [[0.1, 0.1], [0.4, 0.4]] } } }
    expect(bakeGeoBody(line, STACK, 'taktisch').drawing?.floorTag).toBe(1)
    // a Leitung laid from 0 up to +2 across the tiles: the end tag names where it ended
    const up: TacticalObject = { id: 'u', sheet: { planId: 'gebaeude', anno: { id: 'u', kind: 'draw', floor: 0, pts: [[0.1, 0.9, 0], [0.5, 0.5, 1], [0.6, 0.4, 2]] } } }
    expect(bakeGeoBody(up, STACK, 'taktisch').drawing?.floorTag).toBe(2)
    const note: TacticalObject = { id: 'n', sheet: { planId: 'gebaeude', anno: { id: 'n', kind: 'text', text: 'Zugang', x: 0.2, y: 0.2, floor: 2 } } }
    expect(bakeGeoBody(note, STACK, 'taktisch').entity).toMatchObject({ floorFrom: 2, floorTo: 2 })
  })
})

describe('a map-placed object keeps its heading on a Gebäude tile', () => {
  // Rotation parity (15.09.2026, Bastian): the tile is a sheet like any other, so a bearing
  // placed on the Karte is stated in the tile's own frame — the stack's fit turns with the
  // building, and the glyph turns with it. The inverse gives the north-referenced bearing back
  // untouched, which is what lets the sheet's rotor write straight through to the map object.
  const TURNED: PlanFit = { fit: { ...PLAN.fit, rotationDeg: 30 }, aspect: 1 }
  const STACK: PlanFit = { ...TURNED, stack: { floors: [0, 1, 2] } }
  const at = PLAN.fit.toMap({ x: 0.5, y: 0.5 })
  const truck = (over: Partial<Entity> = {}): TacticalObject =>
    ({ id: 'v', entity: ent({ id: 'v', symbol: 'VKF Fahrzeug', coord: [at.lng, at.lat], ...over }) })

  it('composes the map heading with the tile\'s own turn, exactly as it composes the position', () => {
    expect(projectOnto(truck({ rotation: 80 }), PLAN)).toMatchObject({ rotation: 80 })
    expect(projectOnto(truck({ rotation: 80 }), STACK)).toMatchObject({ rotation: 110, floor: 0 })
    // a Hubretter's boom is a bearing too, and it must not swing while the truck stands still
    expect(projectOnto(truck({ symbol: 'VKF Hubretter', rotation: 80, rotation2: 100 }), STACK))
      .toMatchObject({ rotation: 110, rotation2: 130 })
    // …and a glyph with no direction acquires none from the paper it lies on
    expect(projectOnto(geo(ent({ id: 'f', symbol: 'VKF Feuer', coord: [at.lng, at.lat] })), STACK)!.rotation).toBeUndefined()
  })

  it('a turn taken ON the tile writes the ground bearing back to the map object, anchor unmoved', () => {
    const objects = [truck({ rotation: 80 })]
    const shown = sheetAnnos(objects, 'gebaeude', STACK)
    expect(shown[0].rotation).toBe(110)
    const turned = applyBoardToObjects(objects, 'gebaeude', [{ ...shown[0], rotation: 200 }], STACK)
    expect(turned[0].entity).toMatchObject({ rotation: 170 }) // 200 back out of the paper's frame
    expect(turned[0].sheet).toBeUndefined()                    // a bearing is a prop, not a placement
    expect(projectOnto(turned[0], STACK)).toMatchObject({ rotation: 200 }) // …and it round-trips
  })
})

describe('the Gebäude stack\'s ink shows on the other linked sheets', () => {
  const at = PLAN.fit.toMap({ x: 0.5, y: 0.5 })
  // a Brand marked on tile +2, already baked onto the Karte with its badge
  const stackFire: TacticalObject = {
    id: 'f', sheet: { planId: 'gebaeude', anno: { id: 'f', kind: 'symbol', symbol: 'brand', x: 0.5, y: 0.5, floor: 2 } },
    entity: { id: 'f', kind: 'symbol', symbol: 'brand', layer: 'taktisch', coord: [at.lng, at.lat], floor: 2 },
  }
  const sheetFire: TacticalObject = { ...stackFire, sheet: { planId: 'modul3', anno: stackFire.sheet!.anno } }
  it('with the storey as badge; another sheet\'s ink stays on its sheet; the stack shows only its own', () => {
    expect(projectOnto(stackFire, PLAN)).toMatchObject({ id: 'f', storey: 2 })
    expect(projectOnto(sheetFire, PLAN)).toBeNull()
    expect(projectOnto(stackFire, { ...PLAN, stack: { floors: [0, 1, 2] } })).toBeNull()
  })
  // ⚠️ With no fit for the STACK to write through, a drag here has nowhere else to land and this
  // sheet takes it. With one, the Gebäude keeps it (24.09.2026, lib/sheetAnchor.test.ts).
  it('handing the sheet\'s list back unchanged leaves it on its tile; without the stack\'s fit a drag makes the sheet its anchor', () => {
    const objects = [stackFire]
    const shownList = sheetAnnos(objects, 'modul1', PLAN)
    expect(shownList).toHaveLength(1)
    expect(applyBoardToObjects(objects, 'modul1', shownList, PLAN)).toBe(objects)
    const moved = applyBoardToObjects(objects, 'modul1', [{ ...shownList[0], x: 0.7 }], PLAN)
    expect(moved[0].sheet).toMatchObject({ planId: 'modul1', anno: { x: 0.7 } })
    // a props-only edit from the other sheet does not steal the anchor
    const relabelled = applyBoardToObjects(objects, 'modul1', [{ ...shownList[0], count: 2 }], PLAN)
    expect(relabelled[0].sheet?.planId).toBe('gebaeude')
    expect(relabelled[0].sheet?.anno.count).toBe(2)
  })
})


describe('Gebäude range edits use the same storeys on every surface', () => {
  const STACK: PlanFit = { ...PLAN, stack: { floors: [-1, 0, 1, 2, 3] } }
  const original: BoardAnno = { id: 'span', kind: 'symbol', symbol: 'brand', x: .5, y: .5, floor: 0, floorFrom: 0, floorTo: 2 }
  const object = bakeGeoBody({ id: original.id, sheet: { planId: 'gebaeude', anno: original } }, STACK, 'taktisch')
  it('a one-floor drag shifts the full range without changing its length', () => {
    const moved = applyBoardToObjects([object], 'gebaeude', [{ ...original, floor: 1 }], STACK)
    expect(moved[0].sheet?.anno).toMatchObject({ floor: 1, floorFrom: 1, floorTo: 3 })
    expect(bakeGeoBody(moved[0], STACK, 'taktisch').entity).toMatchObject({ floorFrom: 1, floorTo: 3 })
  })
  it('a changed range moves the home tile inside the new range', () => {
    const changed = applyBoardToObjects([object], 'gebaeude', [{ ...original, floorFrom: 1 }], STACK)
    expect(changed[0].sheet?.anno).toMatchObject({ floor: 1, floorFrom: 1, floorTo: 2 })
  })
})

// F16
describe('photoOverlay — a Verlauf photo on a georeferenced sheet', () => {
  const photo = (over: Partial<Entity> = {}) => ent({
    id: 'ph1', kind: 'photo', layer: 'markup', coord: coordEast(50), photoUrl: '/api/media/a',
    photoOf: { row: 'j1', i: 0 }, heading: 90, ...over,
  })

  it('is never part of the sheet document — media, not a place on the paper', () => {
    expect(projectOnto(geo(photo()), PLAN)).toBeNull()
  })

  it('shows the marker where it was taken, with its URL and heading', () => {
    const [m] = photoOverlay([photo()], PLAN)
    expect(m.id).toBe('ph1')
    expect(m.url).toBe('/api/media/a')
    expect(m.pt.x).toBeCloseTo(0.5, 6)
    expect(m.heading).toBe(90)
  })

  it('turns the heading into the paper’s frame, the same way the live feed does', () => {
    const turned: PlanFit = { fit: { ...PLAN.fit, rotationDeg: 30 }, aspect: 1 }
    expect(photoOverlay([photo({ heading: 350 })], turned)[0].heading).toBe(20)
    expect('heading' in photoOverlay([photo({ heading: undefined })], turned)[0]).toBe(false)
  })

  it('shows nothing off the sheet, nothing on the Gebäude stack, and no legacy session photo', () => {
    expect(photoOverlay([photo({ coord: coordEast(2000) })], PLAN)).toEqual([])
    expect(photoOverlay([photo()], { ...PLAN, stack: { floors: [0, 1] } })).toEqual([])
    expect(photoOverlay([photo({ photoOf: undefined })], PLAN)).toEqual([])
    expect(photoOverlay([ent({ id: 's1', coord: coordEast(50) })], PLAN)).toEqual([])
  })
})
