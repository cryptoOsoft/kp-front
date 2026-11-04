// @vitest-environment jsdom
// (labels are measured with a canvas, which needs a `document`; jsdom falls back to an estimate)
import { describe, expect, it } from 'vitest'
import type { Drawing, Entity, LngLat } from '../types'
import { SYM_CAPTION_GAP, symPx } from '../lib/mapView'
import { mapLabelDecisions, type LabelPassScene } from './useLabelPass'

/** a flat screen: 1° = 1000 px, no camera */
const px = ([lng, lat]: LngLat) => ({ x: lng * 1000, y: lat * 1000 })
const scene = (over: Partial<LabelPassScene>): LabelPassScene => ({
  initialCenter: [0, 0], entities: [], isVisible: () => true, zoom: 18, symMul: 1, captionMode: 'all',
  selectedId: null, selectedEntityIds: [], teamLines: new Map(), drawingsVisible: true,
  lineDecor: [], drawLabels: [], circleLabels: [], selectedDrawingId: null, storedDrawings: [], hiddenTrails: new Set(), ...over,
})

describe('mapLabelDecisions — a Trupp\'s name is never the one that yields', () => {
  const team: Entity = { id: 'T', kind: 'team', layer: 'taktisch', coord: [0, 0], label: 'Trupp Meier' }
  // a symbol whose caption hangs right over the name strip: the caption's top edge on the marker's row
  const g = symPx('symbol', 0, 18, 1)
  const symbolAt = (lng: number): Entity => ({ id: 'S', kind: 'symbol', layer: 'taktisch', symbol: 'Hydrant',
    coord: [lng, -(g / 2 + SYM_CAPTION_GAP) / 1000], notes: 'Wasserbezug Weiher' })

  it('a caption over the name is dropped to its dot; the name stays', () => {
    const hidden = mapLabelDecisions(px, scene({ entities: [team, symbolAt(0.04)] }))
    expect(hidden.has('cap:S')).toBe(true)
    expect(hidden.has('team:T')).toBe(false)
  })

  it('…and the same caption well clear of it is drawn', () => {
    expect(mapLabelDecisions(px, scene({ entities: [team, symbolAt(0.4)] })).size).toBe(0)
  })
})

describe('mapLabelDecisions — Leitung end tags', () => {
  const line = (id: string, lineNo: number): Drawing => ({ id, kind: 'line', coords: [[0, 0], [0.1, 0]], lineNo } as Drawing)
  // two tags on the same spot: one on a Leitung whose Trupp is überfällig, one at rest
  const lineDecor = [
    { d: line('due', 1), anchor: [0, 0] as LngLat, tone: 'crit' as const },
    { d: line('calm', 2), anchor: [0, 0] as LngLat, tone: 'idle' as const },
  ]

  it('the tag somebody\'s air depends on outranks a resting one', () => {
    expect(mapLabelDecisions(px, scene({ lineDecor }))).toEqual(new Set(['tag:calm']))
  })

  it('…but the selected Leitung\'s tag is never suppressed', () => {
    expect(mapLabelDecisions(px, scene({ lineDecor, selectedDrawingId: 'calm' }))).toEqual(new Set(['tag:due']))
  })

  it('hidden drawings take no part in the pass', () => {
    expect(mapLabelDecisions(px, scene({ lineDecor, drawingsVisible: false })).size).toBe(0)
  })
})

describe('mapLabelDecisions — a trail\'s times', () => {
  // three crumbs 5 px apart: their times would stack into one pile
  const trupp: Entity = { id: 'T', kind: 'team', layer: 'taktisch', coord: [0.5, 0.5], label: 'Trupp Meier',
    trail: [{ coord: [0, 0], t: '15:02' }, { coord: [0, 0.005], t: '15:07' }, { coord: [0, 0.2], t: '15:15' }] }

  it('a time that would cover a newer one is dropped; the newest of a pile stands', () => {
    expect(mapLabelDecisions(px, scene({ entities: [trupp] }))).toEqual(new Set(['crumb:T:0']))
  })

  it('a hidden trail books nothing', () => {
    expect(mapLabelDecisions(px, scene({ entities: [trupp], hiddenTrails: new Set(['T']) })).size).toBe(0)
  })
})
