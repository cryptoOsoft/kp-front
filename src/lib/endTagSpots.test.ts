import { describe, expect, it } from 'vitest'
import { endTagOffset, endTagSide, endTagText, placeEndTag, planArrowBackPx } from './endTagSpots'

// Sweep 28.10.2026 #8b: the plan's end tag is pinned to its line and dodges what stands there –
// «i'm a bit worried if there are other symbols in the vicinity that they'll get blocked».
describe('placeEndTag — a pinned tag that dodges', () => {
  const line: [number, number][] = [[0, 100], [300, 100]] // level, left to right
  const W = 36, H = 17
  const box = ([x, y]: [number, number]) => ({ x: x - 14, y: y - 14, w: 28, h: 28 }) // a 28 px glyph

  it('free: beside the end, its near edge 4 px short of it, 14 px above a level line', () => {
    expect(placeEndTag(line, W, H, [])).toEqual([300 - 4 - W / 2, 86])
  })

  it('a symbol on that spot sends it to the other side, then one tag further back', () => {
    expect(placeEndTag(line, W, H, [box([278, 80])])).toEqual([278, 114])
    expect(placeEndTag(line, W, H, [box([278, 80]), box([278, 120])])).toEqual([278 - W - 5.5, 86])
  })

  it('everything taken: the first spot – a covered tag still sits on its own line', () => {
    expect(placeEndTag(line, W, H, [{ x: -50, y: 0, w: 400, h: 300 }])).toEqual([278, 86])
  })

  it('beside a vertical line, clear of the stroke by half its width', () => {
    const [x, y] = placeEndTag([[100, 0], [100, 100]], W, H, [])
    expect(y).toBe(100 - 4 - H / 2)
    expect(100 - x).toBe(W / 2 + 5.5)
  })

  it('says the Leitung\'s facts as one string', () => {
    expect(endTagText({ lineNo: 1, content: 'S', floorTag: 2 })).toBe('1 · S · +2')
    expect(endTagText({})).toBe('')
  })
})

// Hill climb r16, Opus 4: a tag centred on the end covered the arrowhead – it stands short of it.
describe('endTagOffset — clear of the arrowhead', () => {
  it('the near edge stands 4 px short of the arrowhead\'s back, on any heading', () => {
    for (const u of [[1, 0], [0, -1], [Math.SQRT1_2, Math.SQRT1_2]] as const) {
      const [ox, oy] = endTagOffset(u, 40, 18, 9)
      // the box's reach along u, measured from the end: centre · u + its half-extent along u
      const reach = ox * u[0] + oy * u[1] + (Math.abs(u[0]) * 40) / 2 + (Math.abs(u[1]) * 18) / 2
      expect(reach).toBeCloseTo(-13)
    }
  })

  it('a hose bending into its end puts the tag outside the bend, a straight one above', () => {
    expect(endTagSide([[0, 100], [300, 100]])).toBe(1)
    // came down from the upper side, then ran level into the tip: the stroke fills the upper side
    expect(endTagSide([[200, 0], [260, 90], [300, 100]])).toBe(-1)
    // …and up from below: above is free
    expect(endTagSide([[200, 200], [260, 110], [300, 100]])).toBe(1)
  })

  it('a Plan arrowhead reaches back with the stroke; a plain end reaches nowhere', () => {
    expect(planArrowBackPx({ arrow: true, width: 8 })).toBeGreaterThan(planArrowBackPx({ arrow: true, width: 4 }))
    expect(planArrowBackPx({ width: 8 })).toBe(0)
  })
})
