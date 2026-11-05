import { afterEach, describe, expect, it, vi } from 'vitest'
import type { DeploymentConfig } from './deploymentConfig'
import { hoseDefaults, hoseLines, lineHose, lossPer100m, planRelay, pumpRange, resolveRelay, sourceBar, withPumpOverride, withoutPins, RELAY, type RelayRequest } from './hydraulics'

// the station's doctrine, swapped per test (hoseDefaults reads it at use)
let deployment: DeploymentConfig = {}
vi.mock('./deploymentConfig', () => ({ getDeploymentConfig: () => deployment }))
afterEach(() => { deployment = {} })

// A flat 75 mm line at 800 l/min loses 0.98 bar / 100 m (AGV KB 06.07) — 0.0098 bar per metre —
// which makes every position below a hand calculation.
const K75 = 0.98 / 100
const flat = (over: Partial<RelayRequest> = {}): RelayRequest =>
  ({ profile: null, lengthM: 1000, hose: '75', flow: 800, startBar: 6, ...over })

describe('lossPer100m — the AGV tables', () => {
  it('reads a table row as printed', () => {
    expect(lossPer100m(75, 800)).toEqual({ bar: 0.98, inTable: true, above: false })
  })

  it('interpolates linearly between two rows', () => {
    expect(lossPer100m(75, 850).bar).toBeCloseTo((0.98 + 1.25) / 2, 6)
    expect(lossPer100m(75, 850).inTable).toBe(true)
  })

  it('estimates above the table quadratically from the last row, and flags it', () => {
    const l = lossPer100m(55, 1200) // the 55 mm table ends at 1000 l/min, 7.85 bar
    expect(l.bar).toBeCloseTo(7.85 * 1.2 ** 2, 6)
    expect(l).toMatchObject({ inTable: false, above: true })
  })

  // GVB Behelf TLF/MS, ø 40 at 100 m: the table ends at 500 l/min (one Strahlrohr's worth)
  it('reads the 40 mm table, and flags a flow past its end', () => {
    expect(lossPer100m(40, 300)).toEqual({ bar: 3.35, inTable: true, above: false })
    expect(lossPer100m(40, 500)).toEqual({ bar: 10, inTable: true, above: false })
    const l = lossPer100m(40, 800)
    expect(l.bar).toBeCloseTo(10 * 1.6 ** 2, 6)
    expect(l.above).toBe(true)
  })

  it('estimates below the table too, but does not flag a loss that small', () => {
    const l = lossPer100m(110, 300) // the 110 mm table starts at 600 l/min, 0.11 bar
    expect(l.bar).toBeCloseTo(0.11 * 0.5 ** 2, 6)
    expect(l.above).toBe(false)
  })
})

describe('planRelay', () => {
  it('«2× 75» carries half the flow in each line, from the same table', () => {
    const plan = planRelay(flat({ hose: '2x75', flow: 1600 }))
    expect(plan.loss).toEqual(lossPer100m(75, 800))
  })

  it('adds 1 bar per 10 m of climb (FKS 06.29)', () => {
    const climb = planRelay({ ...flat({ hose: '110', flow: 600, lengthM: 100 }), profile: [{ dist: 0, alt: 300 }, { dist: 100, alt: 310 }] })
    const level = planRelay(flat({ hose: '110', flow: 600, lengthM: 100 }))
    expect(level.endBar - climb.endBar).toBeCloseTo(1, 6)
    expect(climb.terrain).toBe(true)
  })

  it('scales the profile onto the route length (swisstopo measures in LV95)', () => {
    const plan = planRelay({ ...flat({ lengthM: 200 }), profile: [{ dist: 0, alt: 300 }, { dist: 198, alt: 300 }] })
    expect(plan.prof[plan.prof.length - 1].dist).toBe(200)
  })

  it('puts an automatic pump exactly where the pressure reaches 2 bar', () => {
    const plan = planRelay(flat())
    expect(plan.pumps).toHaveLength(1)
    const [p] = plan.pumps
    expect(p.dist).toBeCloseTo((6 - RELAY.minInletBar) / K75, 6)
    expect(p.inBar).toBeCloseTo(RELAY.minInletBar, 6)
    expect(p).toMatchObject({ outBar: RELAY.defaultPumpBar, pinned: false, low: false })
    expect(plan.endBar).toBeCloseTo(10 - (1000 - p.dist) * K75, 6)
  })

  it('needs no pump when the source carries the water to the end', () => {
    expect(planRelay(flat({ lengthM: 300 })).pumps).toEqual([])
  })

  it('a Löschweier (0 bar) gets its first pump at the source — not flagged, that is its job', () => {
    const plan = planRelay(flat({ startBar: 0 }))
    expect(plan.pumps[0]).toMatchObject({ dist: 0, inBar: 0, outBar: 10, low: false })
  })

  it('without a profile computes friction only', () => {
    const plan = planRelay(flat())
    expect(plan.terrain).toBe(false)
  })

  describe('a pump moved by hand', () => {
    it('stands exactly at its pin, earlier than the automatic spot', () => {
      const plan = planRelay(flat({ pins: [300] }))
      expect(plan.pumps).toHaveLength(1)
      expect(plan.pumps[0]).toMatchObject({ dist: 300, pinned: true, low: false })
      expect(plan.pumps[0].inBar).toBeCloseTo(6 - 300 * K75, 6)
    })

    it('stays there below 2 bar, flagged — and no automatic pump is slipped in before it', () => {
      const plan = planRelay(flat({ pins: [600] }))
      expect(plan.pumps).toHaveLength(1)
      expect(plan.pumps[0]).toMatchObject({ dist: 600, pinned: true, low: true })
      expect(plan.pumps[0].inBar).toBeCloseTo(6 - 600 * K75, 6)
    })

    it('re-plans the automatic pumps after it', () => {
      const plan = planRelay(flat({ lengthM: 2000, pins: [300] }))
      expect(plan.pumps[1].dist).toBeCloseTo(300 + (10 - RELAY.minInletBar) / K75, 6)
      expect(plan.pumps[1].pinned).toBe(false)
    })

    it('moved back onto a Löschweier, it is the source pump again – not flagged', () => {
      const plan = planRelay(flat({ startBar: 0, pins: [0] }))
      expect(plan.pumps[0]).toMatchObject({ dist: 0, pinned: true, low: false })
    })

    it('counts as automatic when the line got shorter than its pin', () => {
      const plan = planRelay(flat({ pins: [1500] }))
      expect(plan.pumps[0]).toMatchObject({ pinned: false })
      expect(plan.pumps[0].dist).toBeCloseTo(4 / K75, 6)
    })
  })

  it('a pump set to put out less moves the next one closer', () => {
    const plan = planRelay(flat({ lengthM: 2000, pumpBars: [8] }))
    expect(plan.pumps[0].outBar).toBe(8)
    expect(plan.pumps[1].dist - plan.pumps[0].dist).toBeCloseTo((8 - RELAY.minInletBar) / K75, 6)
  })

  it('gives up when a pump puts out no more than the minimum', () => {
    const plan = planRelay(flat({ lengthM: 2000, pumpBars: [2] }))
    expect(plan.stuck).toBe(true)
    expect(plan.pumps).toHaveLength(1)
  })

  it('gives up instead of running away on an absurd route', () => {
    const plan = planRelay(flat({ hose: '55', flow: 1000, lengthM: 10_000 }))
    expect(plan.stuck).toBe(true)
    expect(plan.pumps.length).toBe(61)
  })
})

describe('pumpRange — where a pump may be dragged', () => {
  it('between the pump before it and the next pinned pump, a gap from each', () => {
    const pins = [undefined, undefined, 1500]
    const plan = planRelay(flat({ lengthM: 3000, pins }))
    const [lo, hi] = pumpRange(plan, pins, 1, 3000)
    expect(lo).toBeCloseTo(plan.pumps[0].dist + RELAY.pinGapM, 6)
    expect(hi).toBe(1500 - RELAY.pinGapM)
  })

  it('stays on the route when the pump before stands within the gap of the end', () => {
    const plan = planRelay(flat({ lengthM: 1000, pins: [998] }))
    const [lo, hi] = pumpRange(plan, [998], 1, 1000)
    expect([lo, hi]).toEqual([1000, 1000])
  })

  it('the first one from the source, the last one up to the end', () => {
    const plan = planRelay(flat())
    expect(pumpRange(plan, [], 0, 1000)).toEqual([0, 1000 - RELAY.pinGapM])
  })
})

describe('the stored relay', () => {
  it('fills in the defaults: the host\'s Ø, 800 l/min, Hydrant 6 bar', () => {
    expect(resolveRelay(undefined, undefined, '75')).toEqual({ hose: '75', flow: 800, source: 'hydrant', startBar: 6, pumps: [] })
    expect(resolveRelay(undefined, undefined, '40').hose).toBe('40')
    expect(resolveRelay('110', undefined, '40').hose).toBe('110')
    expect(resolveRelay(undefined, { source: 'pumpe' }, '75').startBar).toBe(RELAY.defaultPumpBar)
  })

  it('a Löschweier starts at 0 bar whatever number it carries', () => {
    expect(sourceBar(resolveRelay(undefined, { source: 'weier', startBar: 6 }, '75'))).toBe(0)
  })

  it('keeps pump overrides by index, with nulls before and none after', () => {
    expect(withPumpOverride([], 2, { atM: 400 })).toEqual([null, null, { atM: 400 }])
    expect(withPumpOverride([{ bar: 8 }], 0, { atM: 120 })).toEqual([{ bar: 8, atM: 120 }])
    expect(withPumpOverride([null, { atM: 400 }], 1, { atM: undefined })).toBeUndefined()
  })

  it('«Alle automatisch» drops every pin and keeps a set output', () => {
    expect(withoutPins([{ atM: 100, bar: 8 }, { atM: 500 }])).toEqual([{ bar: 8 }])
    expect(withoutPins([{ atM: 100 }])).toBeUndefined()
  })
})

// owner 05.11.2026: a plain Linie is a 40 mm Druckleitung, a Wassertransport a 75 mm
// Transportleitung – both station doctrine
describe('hoseDefaults — the Ø a Leitung and a Messen relay start on', () => {
  it('ships 40 for a Linie and 75 for a Wassertransport', () => {
    expect(hoseDefaults()).toEqual({ line: '40', relay: '75' })
    expect(lineHose(undefined)).toBe('40')
  })

  it('takes the station\'s doctrine', () => {
    deployment = { doctrine: { defaultLineHose: '55', defaultRelayHose: '2x75' } }
    expect(hoseDefaults()).toEqual({ line: '55', relay: '2x75' })
    expect(lineHose(undefined)).toBe('55')
    expect(hoseLines(undefined)).toBe(1)
  })

  it('a Leitung\'s own Ø wins over the default', () => {
    deployment = { doctrine: { defaultLineHose: '2x75' } }
    expect(lineHose('40')).toBe('40')
    expect(hoseLines(undefined)).toBe(2)
    expect(hoseLines('75')).toBe(1)
  })

  it('falls back on a value this build does not know, and never starts a relay on 40', () => {
    deployment = { doctrine: { defaultLineHose: '90' as never, defaultRelayHose: '40' } }
    expect(hoseDefaults()).toEqual({ line: '40', relay: '75' })
  })
})

describe('a 40 mm Leitung in the relay', () => {
  it('computes with the 40 mm table: 400 l/min loses 6.15 bar per 100 m', () => {
    // 6 bar at the hydrant, 2 bar at the inlet: the first pump stands at 4 / 0.0615 m
    const plan = planRelay(flat({ hose: '40', flow: 400, lengthM: 200 }))
    expect(plan.loss).toEqual({ bar: 6.15, inTable: true, above: false })
    expect(plan.pumps[0].dist).toBeCloseTo(4 / 0.0615, 6)
  })
})
