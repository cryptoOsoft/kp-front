// @vitest-environment jsdom
import { createElement } from 'react'
import { describe, it, expect } from 'vitest'
import { render } from '@testing-library/react'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { luefterVariant, LUEFTER, LUEFTER_EXTRACT, boomKnuckle, TacticalSymbol, needsWhite } from './symbolRender'
import { bareBlack } from './glyphTile'
import { symbolControls } from './symbols'

describe('luefterVariant — Lüfter airflow direction', () => {
  it('swaps the mobile Lüfter to the reversed-arrow glyph only when extract is set', () => {
    expect(luefterVariant(LUEFTER, true)).toBe(LUEFTER_EXTRACT)
    expect(luefterVariant(LUEFTER, false)).toBe(LUEFTER)
    expect(luefterVariant(LUEFTER, undefined)).toBe(LUEFTER)
  })

  it('never touches other symbols, even with extract set', () => {
    expect(luefterVariant('VKF Feuer', true)).toBe('VKF Feuer')
    expect(luefterVariant('Grosslüfter', true)).toBe('Grosslüfter')
    expect(luefterVariant(undefined, true)).toBeUndefined()
  })

  it('offers the airflow control on the mobile Lüfter (and not on a plain symbol)', () => {
    expect(symbolControls(LUEFTER).has('airflow')).toBe(true)
    expect(symbolControls('VKF Feuer').has('airflow')).toBe(false)
  })
})

describe('boomKnuckle — auto-articulated Hubretter boom knuckle', () => {
  it('sits ~55% along the base→tip line, pushed perpendicular by ~18% of the length', () => {
    // horizontal boom of length 100 to the right: knuckle at x=55, offset +18 in +y (perp of +x is +y)
    const [x, y] = boomKnuckle([0, 0], [100, 0])
    expect(x).toBeCloseTo(55, 5)
    expect(y).toBeCloseTo(18, 5)
  })

  it('keeps the perpendicular offset on the same side when the boom points up', () => {
    // boom of length 100 pointing up (−y): perp of (0,−100) rotated +90° is (+100,0)→ scaled 0.18
    const [x, y] = boomKnuckle([0, 0], [0, -100])
    expect(y).toBeCloseTo(-55, 5)
    expect(x).toBeCloseTo(18, 5)
  })

  it('is length-proportional (a longer boom bows wider) and honours a base offset', () => {
    const [x, y] = boomKnuckle([10, 10], [10, 210]) // length 200 down from (10,10)
    expect(y).toBeCloseTo(10 + 110, 5) // 55% of 200
    expect(x).toBeCloseTo(10 - 36, 5)  // perp of (0,200)/+90° = (−200,0) → 0.18·(−200) = −36
  })

  it('a zero-length boom degenerates to the base point', () => {
    expect(boomKnuckle([7, 3], [7, 3])).toEqual([7, 3])
  })
})

describe('TacticalSymbol — legacy `floor` keeps rendering after a symbol moves to floorRange', () => {
  // ⚠️ Several symbols (VKF Feuer, GB Kamin, …) moved from the single `floor` control to the
  // von/bis `floorRange` control (03.09.) — but an already-placed symbol still carries its old
  // plain `floor` value, not floorFrom/floorTo. TacticalSymbol must keep drawing that as a
  // normal badge when no explicit range exists, regardless of its current preset.
  it('renders a plain storey badge for a legacy floor value, not an empty range', () => {
    const { container } = render(createElement(TacticalSymbol, { svg: '<svg></svg>', sizePx: 32, floor: 2 }))
    const badge = container.querySelector('.sym-floor')
    expect(badge?.textContent).toBe('+2')
    expect(container.querySelectorAll('.sym-floor')).toHaveLength(1)
  })
})

// SEC-01 · TacticalSymbol is the render sink for a placed glyph. `svg` may be an entity's
// editor-supplied `symbolSvg` (a free string synced through the workspace PUT), written straight
// to the DOM through `dangerouslySetInnerHTML`. It must be sanitised HERE, once, for every caller.
describe('TacticalSymbol — sanitises editor-supplied glyph markup at the sink', () => {
  const HOSTILE = '<svg xmlns="http://www.w3.org/2000/svg"><image href="x" onerror="window.__pwned=1"/><script>window.__pwned=1</script></svg>'

  it('renders no event handler and no <script> from a hostile symbolSvg', () => {
    const { container } = render(createElement(TacticalSymbol, { svg: HOSTILE, sizePx: 32 }))
    const attrs = [...container.querySelectorAll('*')].flatMap((el) => [...el.attributes].map((a) => a.name.toLowerCase()))
    expect(attrs).not.toContain('onerror')
    expect(container.querySelector('script')).toBeNull()
  })

  it('also sanitises the composite overlay glyph', () => {
    const { container } = render(createElement(TacticalSymbol, {
      svg: '<svg xmlns="http://www.w3.org/2000/svg"><rect width="1" height="1"/></svg>', sizePx: 32,
      overlay: { svg: HOSTILE },
    }))
    const attrs = [...container.querySelectorAll('*')].flatMap((el) => [...el.attributes].map((a) => a.name.toLowerCase()))
    expect(attrs).not.toContain('onerror')
    expect(container.querySelector('.ts-overlay script')).toBeNull()
  })

  it('draws a legitimate glyph unchanged — the pack element and its fill survive', () => {
    const glyph = '<svg viewBox="0 0 100 100" xmlns="http://www.w3.org/2000/svg"><circle cx="50" cy="50" r="40" fill="none" stroke="#e8392b"/></svg>'
    const { container } = render(createElement(TacticalSymbol, { svg: glyph, sizePx: 32 }))
    const circle = container.querySelector('.ts-rot circle')
    expect(circle?.getAttribute('stroke')).toBe('#e8392b')
    // fill="none" still triggers the white-legibility chip (needsWhite reads the raw svg)
    expect(container.querySelector('.ts-rot.white')).not.toBeNull()
  })
})


it('an explicit range supersedes the old single-floor badge', () => {
  const { container } = render(createElement(TacticalSymbol, { svg: '', sizePx: 32, floor: 0, floorFrom: 1, floorTo: 2 }))
  expect(container.querySelectorAll('.sym-floor')).toHaveLength(1)
  expect(container.querySelector('.sym-floor')?.textContent).toBe('+1/+2')
})

// sweep 28.10.2026 #8a: a Messpunkt in the EG (Von 0, no Bis) wore a «0» circle on its pill
describe('TacticalSymbol — a «Von» alone is one storey', () => {
  const mp = { symbol: 'FW Messpunkt', fields: { CO: '5' } }
  const badges = (p: Parameters<typeof TacticalSymbol>[0]) =>
    [...render(createElement(TacticalSymbol, p)).container.querySelectorAll('.sym-floor')].map((b) => b.textContent)

  it('the Erdgeschoss shows no badge, on a Messpunkt pill and on a glyph', () => {
    expect(badges({ svg: '', sizePx: 32, floorFrom: 0, measured: mp })).toEqual([])
    expect(badges({ svg: '', sizePx: 32, floorFrom: 0 })).toEqual([])
    expect(badges({ svg: '', sizePx: 32, floorFrom: 0, floorTo: 0 })).toEqual([])
  })

  it('another storey rides on the pill like a single storey; a real span stays a span', () => {
    expect(badges({ svg: '', sizePx: 32, floorFrom: 2, measured: mp })).toEqual(['+2'])
    expect(badges({ svg: '', sizePx: 32, floorTo: -1 })).toEqual(['−1'])
    expect(badges({ svg: '', sizePx: 32, floorFrom: 0, floorTo: 3 })).toEqual(['0/+3'])
  })
})

describe('bareBlack — which glyphs need the white tile on a dark sheet', () => {
  const pack = JSON.parse(readFileSync(resolve(__dirname, '../../public/tactical-symbols.json'), 'utf8')) as { symbols: { name: string; svg: string }[] }
  const svgOf = (n: string) => pack.symbols.find((s) => s.name === n)!.svg

  it('tiles black line art and black solids, never a glyph that brings its own coloured plate', () => {
    for (const n of ['GB Lift', 'GB Brandmeldezentrale', 'SI Ueberflurhydrant', 'SI Schieber', 'SI Nordpfeil']) expect(bareBlack(svgOf(n)), n).toBe(true)
    for (const n of ['VKF Feuer', 'VKF Rauch', 'FW AED', 'GB BMA-Z', 'GB RWA-BS', 'FW Messpunkt', 'FW Gefahr allgemein']) expect(bareBlack(svgOf(n)), n).toBe(false)
  })

  it('so the Karte now tiles the solid black ones too', () => {
    expect(needsWhite(svgOf('SI Schieber'))).toBe(true)
    expect(needsWhite(svgOf('VKF Feuer'))).toBe(false)
  })
})
