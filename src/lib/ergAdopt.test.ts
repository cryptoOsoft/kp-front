import { describe, expect, it } from 'vitest'
import { ergAdoptedRadii, isErgAdopted } from './ergAdopt'
import type { Drawing, LngLat } from '../types'

// «Absperrkreis übernehmen» is a one-time action whose done state is READ off the Karte
// (05.11.2026: re-selecting the placard offered the same circle again)
const at: LngLat = [7.55, 47.5]
const circle = (id: string, c: LngLat, radiusM: number): Drawing => ({ id, kind: 'circle', coords: [c], radiusM })

describe('ergAdoptedRadii', () => {
  it('names the radius of a circle standing on the placard, and only that one', () => {
    const radii = ergAdoptedRadii([circle('a', at, 200), circle('b', [7.56, 47.5], 800), { id: 'l', kind: 'line', coords: [at, at] }], at)
    expect(radii).toEqual([200])
    expect(isErgAdopted(radii, 200)).toBe(true)
    expect(isErgAdopted(radii, 800)).toBe(false) // another placard's cordon
  })

  it('is gone again with the circle (Rückgängig, ↶, deleted)', () => {
    expect(isErgAdopted(ergAdoptedRadii([], at), 200)).toBe(false)
  })
})
