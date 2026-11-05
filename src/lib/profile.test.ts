import { describe, expect, it } from 'vitest'
import type { LngLat } from '../types'
import { labelledNodes, profileNodes, reverseProfile, type ProfileResult } from './profile'

const profile = (pts: [number, number][]): ProfileResult => ({
  points: pts.map(([dist, alt]) => ({ dist, alt })), min: 0, max: 0, gain: 0, loss: 0, start: pts[0][1], end: pts[pts.length - 1][1],
})

describe('profileNodes', () => {
  // three taps due east along one parallel: the middle one a third of the way
  const path: LngLat[] = [[7.5, 47.5], [7.501, 47.5], [7.503, 47.5]]

  it('places every tapped node by its share of the path, first tap on the left', () => {
    const nodes = profileNodes(profile([[0, 300], [100, 310], [200, 330], [300, 320]]), path)
    expect(nodes.map((n) => +n.frac.toFixed(3))).toEqual([0, 0.333, 1])
    expect(nodes[0].dist).toBe(0)
    expect(nodes[2].dist).toBeGreaterThan(200)
  })

  it('reads the altitude off the profile between its samples, whatever the service calls a metre', () => {
    // the service's total (300) is not the geodesic one (~226 m) – the FRACTION is what agrees
    const nodes = profileNodes(profile([[0, 300], [150, 330], [300, 300]]), path)
    expect(nodes[0].alt).toBe(300)
    expect(nodes[1].alt).toBeCloseTo(320, 0) // a third of the way = 100 of 300 → 300 + 100/150 · 30
    expect(nodes[2].alt).toBe(300)
  })

  it('has nothing to say about a path that is not one', () => {
    expect(profileNodes(profile([[0, 1], [1, 1]]), [[7.5, 47.5]])).toEqual([])
    expect(profileNodes(profile([[0, 1], [1, 1]]), [[7.5, 47.5], [7.5, 47.5]])).toEqual([])
  })
})

describe('labelledNodes', () => {
  const at = (...fracs: number[]) => fracs.map((frac) => ({ frac, dist: frac * 100, alt: 0 }))
  it('always labels both ends and drops an inner label that would collide', () => {
    expect([...labelledNodes(at(0, 0.05, 0.5, 0.55, 0.95, 1))].sort()).toEqual([0, 2, 5])
  })
})

// a Wassertransport drawn from the fire back to the hydrant runs the profile the other way round
describe('reverseProfile', () => {
  it('measures from the far end and swaps the climbs', () => {
    const p = { ...profile([[0, 300], [40, 320], [100, 310]]), gain: 20, loss: 10 }
    expect(reverseProfile(p)).toMatchObject({
      points: [{ dist: 0, alt: 310 }, { dist: 60, alt: 320 }, { dist: 100, alt: 300 }],
      gain: 10, loss: 20, start: 310, end: 300,
    })
  })
})
