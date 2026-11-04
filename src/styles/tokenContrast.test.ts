// THE contrast floor of the palette (23.10.2026, sweep G.4–G.6). 01-tokens.css is parsed for both
// themes and every pair below is measured with the WCAG 2 formula, so a token tweak that drops a
// text colour under AA fails here instead of in a field report. Three tokens had drifted under it
// unnoticed (--ink-faint in both themes, day --amber-strong, white on amber) – 12 of the 60 most
// common text pairs.
//
// The pairs, and the floor each one is held to:
//   · the three ink tiers on --surface (sheets, cards), --canvas-bg (the stage) and --glass (the
//     bars and panels, composited over --map-bg)                                        4.5
//   · --ink-faint stays a visible step under --ink-dim (≥ 1.25× its contrast)
//   · a word on a fill: --on-btn-primary on --btn-primary, --on-accent-ink on --ink-fill (the «on»
//     pill), --on-fill on --blue, --on-amber on --amber, --surface on --ink-faint (a grey badge) 4.5
//   · a «strong» hue on its own 16 % tint over --surface (the ÜBUNG badge, the overdue «Kontakt»,
//     the selected chip)                                                                    4.5
//   · --on-fill on --green-fill and --red-fill – the green «go» button, the red rec buttons, the
//     running chip (24.10.2026, sweep Q1: white on the day --green / --red was 4.4 and 4.2)  4.5
// It also holds the ONE primary (sweep G.2): a control is never filled with --ink – the near-white
// glare at night that --btn-primary exists to avoid. A filled control with a label uses
// --btn-primary / --on-btn-primary; --ink stays for dots, swatches and ticks (rules with no text colour).
// The same guard keeps a labelled green/red fill on --green-fill / --red-fill: the plain hues stay
// for dots, lamps and edges, which carry no word.
import { globSync, readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const TOKENS = readFileSync('src/styles/01-tokens.css', 'utf8').replace(/\/\*[\s\S]*?\*\//g, '')

/** the declarations of the first block opened by `head` (blocks in 01-tokens.css do not nest) */
function block(head: string): Map<string, string> {
  const start = TOKENS.indexOf(head)
  if (start < 0) throw new Error(`no block ${head}`)
  const body = TOKENS.slice(TOKENS.indexOf('{', start) + 1, TOKENS.indexOf('\n}', start))
  return new Map([...body.matchAll(/(--[\w-]+)\s*:\s*([^;]+);/g)].map(m => [m[1], m[2].trim()]))
}

const DAY = block(':root {')
const NIGHT = new Map([...DAY, ...block(':root[data-theme="night"] {')])
const THEMES = { day: DAY, night: NIGHT } as const
type Theme = keyof typeof THEMES

type Rgba = [r: number, g: number, b: number, a: number]

/** a token's colour in a theme, following var() chains; only hex and rgba() are expected here */
function colour(theme: Theme, token: string): Rgba {
  const raw = THEMES[theme].get(token)
  if (raw === undefined) throw new Error(`${token} is not declared`)
  const ref = /^var\((--[\w-]+)\)$/.exec(raw)
  if (ref) return colour(theme, ref[1])
  const hex = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(raw)
  if (hex) {
    const h = hex[1].length === 3 ? [...hex[1]].map(c => c + c).join('') : hex[1]
    return [0, 2, 4].map(i => parseInt(h.slice(i, i + 2), 16)).concat(1) as Rgba
  }
  const rgba = /^rgba?\(([^)]+)\)$/.exec(raw)
  if (rgba) {
    const [r, g, b, a = 1] = rgba[1].split(',').map(Number)
    return [r, g, b, a]
  }
  throw new Error(`${token}: cannot read «${raw}»`)
}

/** `fg` laid over `bg` at `share` (alpha × share), the way a tint or a translucent glass lands */
const over = ([r, g, b, a]: Rgba, [R, G, B]: Rgba, share = 1): Rgba => {
  const k = a * share
  return [r * k + R * (1 - k), g * k + G * (1 - k), b * k + B * (1 - k), 1]
}

const luminance = ([r, g, b]: Rgba) => {
  const lin = (v: number) => (v /= 255) <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b)
}

const contrast = (a: Rgba, b: Rgba) => {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x)
  return (hi + 0.05) / (lo + 0.05)
}

/** the backgrounds an ink tier stands on, solid */
const grounds = (t: Theme) => ({
  surface: colour(t, '--surface'),
  canvas: colour(t, '--canvas-bg'),
  glass: over(colour(t, '--glass'), colour(t, '--map-bg')),
})

const round = (n: number) => Math.round(n * 100) / 100

describe('token contrast (WCAG AA)', () => {
  it('measures what it says', () => {
    expect(round(contrast([0, 0, 0, 1], [255, 255, 255, 1]))).toBe(21)
    // the sweep's hand-computed number for the old night --ink-faint on --surface
    expect(round(contrast([0x76, 0x82, 0x9a, 1], [0x23, 0x2c, 0x3a, 1]))).toBe(3.64)
  })

  for (const theme of ['day', 'night'] as const) {
    describe(theme, () => {
      it('the ink tiers read on every ground', () => {
        const low: string[] = []
        for (const ink of ['--ink', '--ink-dim', '--ink-faint']) {
          for (const [name, bg] of Object.entries(grounds(theme))) {
            const c = contrast(colour(theme, ink), bg)
            if (c < 4.5) low.push(`${ink} on ${name}: ${round(c)}`)
          }
        }
        expect(low).toEqual([])
      })

      it('--ink-faint stays a visible step under --ink-dim', () => {
        const bg = colour(theme, '--surface')
        const dim = contrast(colour(theme, '--ink-dim'), bg)
        const faint = contrast(colour(theme, '--ink-faint'), bg)
        expect(dim / faint).toBeGreaterThanOrEqual(1.25)
      })

      it('a word on a fill reads', () => {
        const pairs: [fg: string, bg: string, floor: number][] = [
          ['--on-btn-primary', '--btn-primary', 4.5],
          ['--on-accent-ink', '--ink-fill', 4.5],
          ['--on-fill', '--blue', 4.5],
          ['--on-amber', '--amber', 4.5],
          ['--surface', '--ink-faint', 4.5],
          ['--on-fill', '--green-fill', 4.5],
          ['--on-fill', '--red-fill', 4.5],
        ]
        const low = pairs
          .map(([fg, bg, floor]) => [fg, bg, floor, contrast(colour(theme, fg), colour(theme, bg))] as const)
          .filter(([, , floor, c]) => c < floor)
          .map(([fg, bg, floor, c]) => `${fg} on ${bg}: ${round(c)} < ${floor}`)
        expect(low).toEqual([])
      })

      it('a strong hue reads on its own 16 % tint', () => {
        const low: string[] = []
        for (const hue of ['red', 'amber', 'blue', 'green']) {
          const tint = over(colour(theme, `--${hue}`), colour(theme, '--surface'), 0.16)
          const c = contrast(colour(theme, `--${hue}-strong`), tint)
          if (c < 4.5) low.push(`--${hue}-strong on --${hue}-16: ${round(c)}`)
        }
        expect(low).toEqual([])
      })
    })
  }
})

/** every CSS rule that fills with `var(<token>)` AND sets a text colour – a label on that fill */
function labelledFills(token: string): string[] {
  const fill = new RegExp(`(?:^|[;\\s])background(?:-color)?\\s*:\\s*var\\(${token}\\)\\s*(?:;|$)`)
  const offenders: string[] = []
  for (const file of globSync('src/**/*.css').sort()) {
    const css = readFileSync(file, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '')
    for (const [, selector, body] of css.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
      if (fill.test(body) && /(?:^|[;\s])color\s*:/.test(body)) offenders.push(`${file}: ${selector.trim()}`)
    }
  }
  return offenders
}

describe('one primary', () => {
  it('no control is filled with --ink', () => {
    expect(labelledFills('--ink'), 'a filled control wears --btn-primary / --on-btn-primary (01-tokens)').toEqual([])
  })
})

describe('labelled green / red fills', () => {
  it('a word on green or red stands on --green-fill / --red-fill', () => {
    expect([...labelledFills('--green'), ...labelledFills('--red')], 'use --green-fill / --red-fill (01-tokens)').toEqual([])
  })
})
