import { describe, expect, it } from 'vitest'
import { clamp01, floorGeometry, floorLabel, OFF_BOARD_Y, planUrl, storeyTowards, TILE_AR, tileAspectOf, TOP_INSET, pdfPageOf, signedFloor, withPdfPage, floorSections, floorCrossings, containFit, bottomInset, sideInsets } from './whiteboard'

describe('planUrl', () => {
  it('leaves absolute http(s) URLs untouched', () => {
    expect(planUrl('https://example.com/p.pdf')).toBe('https://example.com/p.pdf')
    expect(planUrl('http://example.com/p.pdf')).toBe('http://example.com/p.pdf')
  })

  it('leaves protocol-relative and root-absolute URLs untouched', () => {
    expect(planUrl('//cdn/p.pdf')).toBe('//cdn/p.pdf')
    expect(planUrl('/api/reference/plan:obj:modul1')).toBe('/api/reference/plan:obj:modul1')
  })

  it('prefixes a relative path with BASE_URL', () => {
    const base = import.meta.env.BASE_URL
    expect(planUrl('plans/x.pdf')).toBe(`${base}plans/x.pdf`)
  })
})

describe('clamp01', () => {
  it('clamps below 0 and above 1', () => {
    expect(clamp01(-0.5)).toBe(0)
    expect(clamp01(1.5)).toBe(1)
  })
  it('passes in-range values through, including the bounds', () => {
    expect(clamp01(0)).toBe(0)
    expect(clamp01(1)).toBe(1)
    expect(clamp01(0.42)).toBe(0.42)
  })
})

describe('floorLabel', () => {
  it('labels the ground floor as EG', () => expect(floorLabel(0)).toBe('EG'))
  it('labels upper floors as "N. OG"', () => {
    expect(floorLabel(1)).toBe('1. OG')
    expect(floorLabel(3)).toBe('3. OG')
  })
  it('labels basements as "N. UG" (sign flipped)', () => {
    expect(floorLabel(-1)).toBe('1. UG')
    expect(floorLabel(-2)).toBe('2. UG')
  })
})

describe('constants', () => {
  it('exposes the tile aspect ratio and top inset', () => {
    expect(TILE_AR).toBeCloseTo(0.72)
    expect(TOP_INSET).toBe(80)
  })
})

describe('floorGeometry — single-sheet (identity) mode', () => {
  const g = floorGeometry(false, [0], 1)
  it('mapY is the identity', () => expect(g.mapY(0, 0.4)).toBe(0.4))
  it('localY is the identity', () => expect(g.localY(0.4, 0)).toBe(0.4))
})

describe('floorGeometry — stack mode', () => {
  // 3 storeys top-to-bottom: [2, 1, 0] (top = highest). N = 3.
  const floorsTTB = [2, 1, 0]
  const g = floorGeometry(true, floorsTTB, 3)

  it('mapY lifts a tile-local y into the storey band (top storey first)', () => {
    // storey 2 is the top tile (idx 0) → y stays in [0, 1/3]
    expect(g.mapY(2, 0)).toBeCloseTo(0)
    expect(g.mapY(2, 1)).toBeCloseTo(1 / 3)
    // storey 0 is the bottom tile (idx 2) → y in [2/3, 1]
    expect(g.mapY(0, 0)).toBeCloseTo(2 / 3)
    expect(g.mapY(0, 1)).toBeCloseTo(1)
  })

  // ⚠️ 16.09.2026: a storey the board does not draw — folded away per device (lib/floorPrefs) or
  // deleted under stale ink — must land OFF the board, not on the top tile, which is where the
  // old «unknown floor → tile-local y» fallback put it.
  it('maps a storey that is not on the board off the board', () => {
    expect(g.mapY(99, 0.5)).toBe(OFF_BOARD_Y)
    // floor ?? 0 resolves to storey 0, which IS a known floor (idx 2, bottom tile)
    expect(g.mapY(undefined, 0.3)).toBeCloseTo((2 + 0.3) / 3)
  })

  it('localY inverts mapY for a given storey (clamped to [0,1])', () => {
    // board-normalized 0.5 sits in storey 1 (idx 1) → local 0.5
    expect(g.localY(0.5, 1)).toBeCloseTo(0.5)
    // outside the storey band clamps to 0/1
    // storey 2 band is [0,1/3]; ny=0.9 is above it → clamp01(0.9*3 - 0) = 1
    expect(g.localY(0.9, 2)).toBe(1)
    // storey 0 band is [2/3,1]; ny=0.1 is below it → clamp01(0.1*3 - 2) = 0
    expect(g.localY(0.1, 0)).toBe(0)
  })

  it('floorAt resolves which storey a board-normalized y falls into', () => {
    expect(g.floorAt(0.0)).toBe(2) // top tile
    expect(g.floorAt(0.5)).toBe(1) // middle tile
    expect(g.floorAt(0.99)).toBe(0) // bottom tile
  })

  it('floorAt clamps out-of-range y to the first/last storey', () => {
    expect(g.floorAt(-1)).toBe(2)
    expect(g.floorAt(2)).toBe(0)
  })

  it('mapY ∘ localY round-trips a mid-storey point', () => {
    const ny = g.mapY(1, 0.3)
    expect(g.localY(ny, 1)).toBeCloseTo(0.3)
  })
})

describe('a floor sheet names its page in the URL', () => {
  it('pdfPageOf ⇄ withPdfPage (1-based on the wire, 0-based in code)', () => {
    expect(pdfPageOf('/api/reference/plan%3Ax?v=2')).toBeNull()
    expect(pdfPageOf('/api/reference/plan%3Ax?v=2#page=3')).toBe(2)
    expect(withPdfPage('/api/reference/plan%3Ax?v=2#page=3', 0)).toBe('/api/reference/plan%3Ax?v=2#page=1')
    expect(signedFloor(2)).toBe('+2'); expect(signedFloor(-1)).toBe('−1'); expect(signedFloor(0)).toBe('0')
  })
})

describe('a Leitung across storeys', () => {
  it('splits into one run per storey and names the crossings', () => {
    const pts: [number, number, number?][] = [[0.1, 0.9], [0.3, 0.7], [0.3, 0.7, 1], [0.5, 0.5, 1], [0.6, 0.4, 2]]
    expect(floorSections(pts as never, 0).map((r) => r.length)).toEqual([2, 2, 1])
    expect(floorCrossings(pts as never, 0)).toEqual([1, 3])
    expect(floorSections([[0, 0], [1, 1]], 2)).toHaveLength(1)
    expect(floorCrossings([[0, 0], [1, 1]], 2)).toEqual([])
  })
})

// ⚠️ The band became a per-document value on 16.09.2026 (the card follows the drawing). Every
// stack created before that has no `tileAR` and MUST keep the old constant: its ink is stored
// against the box centred in a 0.72 band, and a band that changed under it would move it.
describe('tileAspectOf', () => {
  it('is the document\'s own band, and the historical constant without one', () => {
    expect(tileAspectOf({ tileAR: 0.33 })).toBe(0.33)
    expect(tileAspectOf({})).toBe(TILE_AR)
    expect(tileAspectOf(null)).toBe(TILE_AR)
    expect(tileAspectOf(undefined)).toBe(TILE_AR)
  })
})

// Stepping a Leitung's Geschoss walks the BUILDING, not the number line: a pack whose sheet
// carries EG and 2. OG has no +1 to stop on (17.09.2026).
describe('storeyTowards', () => {
  const floors = [-1, 0, 2, 3]

  it('takes the storey asked for when the building has it', () => {
    expect(storeyTowards(floors, 0, -1)).toBe(-1)
    expect(storeyTowards(floors, 2, 3)).toBe(3)
  })

  it('skips to the next one it does have, and never past the one asked for', () => {
    expect(storeyTowards(floors, 0, 1)).toBe(2)   // no +1 drawn — the step lands on +2
    expect(storeyTowards(floors, 2, 1)).toBe(0)   // …and back down again
  })

  it('answers null at the ends and for a step that goes nowhere', () => {
    expect(storeyTowards(floors, 3, 4)).toBeNull()
    expect(storeyTowards(floors, -1, -2)).toBeNull()
    expect(storeyTowards(floors, 0, 0)).toBeNull()
  })
})

describe('containFit — a plan opens WHOLE between the bars (sweep B8)', () => {
  const A4P = Math.SQRT2 // portrait sheet: height / width
  const A4L = 1 / Math.SQRT2 // landscape sheet
  const insets = (w: number, phone: boolean) => {
    const side = sideInsets(w, phone)
    return { top: TOP_INSET, bottom: bottomInset(phone), l: side.l, r: side.r }
  }

  it('laptop 1440×900, portrait: fitted to the HEIGHT, its foot above the chip row and the view bar', () => {
    const f = containFit({ w: 1440, h: 900 }, A4P, insets(1440, false))
    expect(f.h).toBe(900 - TOP_INSET - bottomInset(false))
    expect(f.w).toBeCloseTo(f.h / A4P, 6)
    // the sheet's foot (centred in the free lane) ends at the view bar's top less its air — the
    // taller of the two bottom corners (07-toolrail · --view-bar-reserve)
    expect(TOP_INSET + f.h).toBe(900 - 94)
  })

  it('laptop 1440×900, landscape: whole sheet inside both the rails and the bars', () => {
    const f = containFit({ w: 1440, h: 900 }, A4L, insets(1440, false))
    expect(f.w).toBeLessThanOrEqual(1440 - 88 - 92)
    expect(f.h).toBeLessThanOrEqual(900 - TOP_INSET - 94)
    expect(f.h / f.w).toBeCloseTo(A4L, 6)
  })

  it('phone 390, portrait: never wider than the screen nor taller than the lane above the chips', () => {
    // the phone canvas ends at the tool bar (700px tall at 390×844)
    const f = containFit({ w: 390, h: 700 }, A4P, insets(390, true))
    expect(f.w).toBeLessThanOrEqual(390)
    expect(f.h).toBeLessThanOrEqual(700 - TOP_INSET - bottomInset(true))
    expect(f.w === 390 || f.h === 700 - TOP_INSET - bottomInset(true)).toBe(true)
  })

  it('iPad 820×1180 (portrait) and 1180×820 (landscape) contain either sheet', () => {
    for (const vp of [{ w: 820, h: 1180 }, { w: 1180, h: 820 }]) {
      for (const ar of [A4P, A4L]) {
        const f = containFit(vp, ar, insets(vp.w, false))
        expect(f.w).toBeLessThanOrEqual(vp.w - 180 + 1e-9)
        expect(f.h).toBeLessThanOrEqual(vp.h - TOP_INSET - 76 + 1e-9)
        expect(f.h / f.w).toBeCloseTo(ar, 6)
      }
    }
  })

  it('degenerate inputs give an empty box rather than NaN', () => {
    expect(containFit({ w: 0, h: 900 }, A4P, insets(0, true))).toEqual({ w: 0, h: 0 })
    expect(containFit({ w: 1440, h: 100 }, A4P, insets(1440, false))).toEqual({ w: 0, h: 0 })
    expect(containFit({ w: 1440, h: 900 }, NaN, insets(1440, false))).toEqual({ w: 0, h: 0 })
  })
})
