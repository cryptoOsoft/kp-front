import { afterEach, describe, expect, it } from 'vitest'
import { bboxSizeM, distanceAlongPath, fmtArea, fmtDistance, fmtLV95, haversineM, hoseCount, hoseLengthHint, lv95ToWgs84, pathLengthM, pointAlongPath, polygonAreaM2, wgs84ToLV95 } from './geo'
import type { LngLat } from '../types'
import { applyLocale } from '../config/copy'

describe('wgs84ToLV95', () => {
  // swisstopo's canonical reference: the old observatory in Bern is the LV95 origin,
  // 7.438632495°E / 46.951082563°N → 2 600 000 E / 1 200 000 N. The Näherungsformel
  // resolves it to within ~2 cm, well inside the ~1 m accuracy the formula advertises.
  it('maps the Bern reference point to the LV95 origin', () => {
    const [e, n] = wgs84ToLV95(7.438632495, 46.951082563)
    expect(e).toBeCloseTo(2_600_000, 0) // within 0.5 m
    expect(n).toBeCloseTo(1_200_000, 0)
  })

  it('places a local (north-west Swiss) point in the expected LV95 quadrant', () => {
    const [e, n] = wgs84ToLV95(7.5547, 47.5072)
    // E/N grow east/north of the origin; sanity-bound to the Swiss extent.
    expect(e).toBeGreaterThan(2_480_000)
    expect(e).toBeLessThan(2_840_000)
    expect(n).toBeGreaterThan(1_070_000)
    expect(n).toBeLessThan(1_300_000)
  })

  it('is monotonic: moving east/north increases E/N', () => {
    const [e0, n0] = wgs84ToLV95(7.55, 47.5)
    const [eEast] = wgs84ToLV95(7.56, 47.5)
    const [, nNorth] = wgs84ToLV95(7.55, 47.51)
    expect(eEast).toBeGreaterThan(e0)
    expect(nNorth).toBeGreaterThan(n0)
  })

  it('round-trips through a metric area calc consistently', () => {
    // A ~100 m × 100 m box should measure ~10 000 m² via the LV95 shoelace.
    const lat = 47.5072
    const lon = 7.5547
    const dLat = 100 / 110540
    const dLon = 100 / (111320 * Math.cos((lat * Math.PI) / 180))
    const ring: [number, number][] = [
      [lon - dLon / 2, lat - dLat / 2],
      [lon + dLon / 2, lat - dLat / 2],
      [lon + dLon / 2, lat + dLat / 2],
      [lon - dLon / 2, lat + dLat / 2],
    ]
    const area = polygonAreaM2(ring)
    expect(area).toBeGreaterThan(9_800)
    expect(area).toBeLessThan(10_200)
  })
})

describe('lv95ToWgs84', () => {
  // Inverse of the LV95 origin: 2 600 000 E / 1 200 000 N → the Bern observatory.
  it('maps the LV95 origin back to the Bern reference point', () => {
    const [lon, lat] = lv95ToWgs84(2_600_000, 1_200_000)
    expect(lon).toBeCloseTo(7.438632495, 4)
    expect(lat).toBeCloseTo(46.951082563, 4)
  })

  it('round-trips a Swiss-area point (wgs84 → LV95 → wgs84) within ~1 m', () => {
    const lon = 7.5547
    const lat = 47.5072
    const [e, n] = wgs84ToLV95(lon, lat)
    const [lon2, lat2] = lv95ToWgs84(e, n)
    // The two approximate (Näherungsformel) directions compose to a few metres of
    // residual; 4 decimals ≈ ~5 m is the honest tolerance for this transform pair.
    expect(lon2).toBeCloseTo(lon, 4)
    expect(lat2).toBeCloseTo(lat, 4)
  })
})

describe('haversineM', () => {
  it('measures ~111 km for one degree of latitude', () => {
    const d = haversineM([7.5, 47.0], [7.5, 48.0])
    expect(d).toBeGreaterThan(111_000)
    expect(d).toBeLessThan(111_400)
  })

  it('is zero for identical points', () => {
    expect(haversineM([7.5547, 47.5072], [7.5547, 47.5072])).toBeCloseTo(0, 5)
  })
})

describe('hoseCount', () => {
  it('adds a 10% reserve, then rounds UP to whole 20 m hose lengths', () => {
    expect(hoseCount(100)).toBe(6)  // 100·1.1 = 110 → 110/20 = 5.5 → 6
    expect(hoseCount(80)).toBe(5)   // 80·1.1 = 88 → 4.4 → 5
    expect(hoseCount(20)).toBe(2)   // 20·1.1 = 22 → 1.1 → 2
    expect(hoseCount(0)).toBe(0)
  })

  it('counts both hoses of a double line («2× 75»)', () => {
    expect(hoseCount(100, 2)).toBe(12)
  })
})

// a pump at «420 m» on the map and back (lib/hydraulics · the relay pumps)
describe('pointAlongPath / distanceAlongPath', () => {
  const path: LngLat[] = [[7.55, 47.5], [7.56, 47.5], [7.56, 47.51]]
  const legA = haversineM(path[0], path[1])

  it('walks the polyline, into the second segment and clamped at both ends', () => {
    const inSecond = pointAlongPath(path, legA + 100)
    expect(inSecond[0]).toBeCloseTo(7.56, 9)
    expect(haversineM(path[1], inSecond)).toBeCloseTo(100, 0)
    expect(pointAlongPath(path, -50)).toEqual(path[0])
    expect(pointAlongPath(path, 1e9)).toEqual(path[2])
  })

  it('finds the metres along the line of a point beside it — the inverse of the walk', () => {
    for (const d of [0, 250, legA, legA + 300]) {
      expect(distanceAlongPath(path, pointAlongPath(path, d))).toBeCloseTo(d, 0)
    }
    // dragged 20 m off the first leg, it still lands on that leg's metre
    const beside: LngLat = [pointAlongPath(path, 300)[0], 47.5 + 20 / 110540]
    expect(distanceAlongPath(path, beside)).toBeCloseTo(300, 0)
    expect(distanceAlongPath(path, [7.6, 47.6])).toBeCloseTo(pathLengthM(path), 0)
  })
})

describe('hoseLengthHint', () => {
  it('formats the hose count incl. the reserve', () => {
    expect(hoseLengthHint(100)).toBe('~6 Schläuche')
    expect(hoseLengthHint(0)).toBe('~0 Schläuche')
  })
  it('counts both lines of a «2× 75»', () => {
    expect(hoseLengthHint(100, 2)).toBe('~12 Schläuche')
  })
})


describe('bboxSizeM', () => {
  it('measures the ground box an outline occupies, east–west and north–south', () => {
    // a ~200 m × ~100 m box near Basel
    const sw = lv95ToWgs84(2611000, 1267000)
    const se = lv95ToWgs84(2611200, 1267000)
    const ne = lv95ToWgs84(2611200, 1267100)
    const nw = lv95ToWgs84(2611000, 1267100)
    const box = bboxSizeM([sw, se, ne, nw])!
    expect(box.widthM).toBeCloseTo(200, 0)
    expect(box.heightM).toBeCloseTo(100, 0)
  })

  it('has nothing to say about a single point', () => {
    expect(bboxSizeM([[7.59, 47.53]])).toBeNull()
  })
})

// sweep C.2: distances and areas formatted with the static `appConfig.locale` ('de-CH'), so a
// French station read «1.25 km» – the deployment's locale decides (format · formatLocale)
describe('numbers follow the deployment locale', () => {
  afterEach(async () => { await applyLocale('de-CH') })

  it('writes the French decimal comma, and keeps the Swiss apostrophe in LV95', async () => {
    await applyLocale('fr-CH')
    expect(fmtDistance(1250)).toBe('1,25 km')
    expect(fmtArea(25_000)).toBe('2,50 ha')
    expect(fmtLV95(7.4386, 46.9511)).toMatch(/^2'\d{3}'\d{3}/)
  })
})
