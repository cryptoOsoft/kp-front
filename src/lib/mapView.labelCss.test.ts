import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { CRUMB_LABEL_STYLE, END_TAG_LABEL_STYLE, READOUT_LABEL_STYLE, SYM_CAPTION_GAP, SYM_CAPTION_STYLE, SYM_PILL_STYLE, TEAM_LABEL_STYLE } from './mapView'

// The label pass books every on-map label's box from these numbers, never from the DOM. They have to
// follow the CSS they stand for: when a type step moved the CSS (stage 2: 11.5 → 11px, 6 → 4px
// padding) and the numbers stayed, the pass booked boxes that were not on the screen.
const css = (f: string) => readFileSync(`src/styles/${f}`, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '')
const tokens = css('01-tokens.css')
const token = (name: string) => {
  const m = tokens.match(new RegExp(`${name}:\\s*([\\d.]+)px`))
  if (!m) throw new Error(`no ${name}`)
  return Number(m[1])
}
/** the declarations of the first rule whose selector is exactly `sel` */
const rule = (file: string, sel: string) => {
  const esc = sel.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const m = css(file).match(new RegExp(`(?:^|\\})\\s*${esc}\\s*\\{([^}]*)\\}`))
  if (!m) throw new Error(`no ${sel} in ${file}`)
  return m[1]
}
const px = (v: string) => (v.startsWith('var(') ? token(v.slice(4, -1)) : Number(v.replace('px', '')))
const decl = (body: string, prop: string) => {
  const m = body.match(new RegExp(`(?:^|[;\\s])${prop}:\\s*([^;]+)`))
  if (!m) throw new Error(`no ${prop}`)
  return m[1].trim()
}
/** `padding: V H` → [V, H] */
const padding = (body: string) => {
  const [v, h = v] = decl(body, 'padding').split(/\s+/)
  return [px(v), px(h)]
}
const fontPx = (font: string) => Number(font.match(/ ([\d.]+)px /)![1])

describe('on-map label metrics follow their CSS', () => {
  it('.sym-caption', () => {
    const b = rule('03-map.css', '.sym-caption')
    const size = px(decl(b, 'font-size'))
    const [v, h] = padding(b)
    expect(fontPx(SYM_CAPTION_STYLE.font)).toBe(size)
    expect(SYM_CAPTION_STYLE.chromeW).toBe(2 * h)
    expect(SYM_CAPTION_STYLE.chromeH).toBe(2 * v)
    expect(SYM_CAPTION_STYLE.lineH).toBeCloseTo(size * Number(decl(b, 'line-height')), 2)
    expect(SYM_CAPTION_GAP).toBe(px(decl(b, 'margin-top')))
    expect(SYM_CAPTION_STYLE.maxTextW).toBe(px(decl(rule('03-map.css', '.sym-caption > span'), 'max-width')))
  })
  it('.sym-pill', () => {
    const b = rule('03-map.css', '.sym-pill')
    const [v, h] = padding(b)
    const icon = px(decl(rule('03-map.css', '.sym-pill .i'), 'width'))
    expect(fontPx(SYM_PILL_STYLE.font)).toBe(px(decl(b, 'font-size')))
    expect(SYM_PILL_STYLE.chromeW).toBe(2 * h + icon + px(decl(b, 'gap')))
    expect(SYM_PILL_STYLE.chromeH).toBe(2 * v)
    expect(SYM_PILL_STYLE.lineH).toBe(px(decl(b, 'height')))
  })
  it('.measure-label.draw-label', () => {
    const b = rule('11-measure.css', '.measure-label')
    const size = px(decl(b, 'font-size'))
    const [v, h] = padding(b)
    expect(fontPx(READOUT_LABEL_STYLE.font)).toBe(size)
    expect(READOUT_LABEL_STYLE.chromeW).toBe(2 * h)
    expect(READOUT_LABEL_STYLE.chromeH).toBe(2 * v)
    const lh = Number(decl(rule('11-measure.css', '.measure-label.draw-label'), 'line-height'))
    expect(READOUT_LABEL_STYLE.lineH).toBeCloseTo(size * lh, 1)
  })
  it('.line-end-tag', () => {
    const b = rule('09-whiteboard.css', '.line-end-tag')
    const [v, h] = padding(b)
    const border = 2 * 1.5
    expect(fontPx(END_TAG_LABEL_STYLE.font)).toBe(token('--fs-micro'))
    expect(decl(b, 'font')).toMatch(/var\(--fs-micro\)\/1 /)
    expect(END_TAG_LABEL_STYLE.chromeW).toBe(2 * h + border)
    expect(END_TAG_LABEL_STYLE.chromeH).toBe(2 * v + border)
  })
  it('.map-trail-dot i', () => {
    const b = rule('09-whiteboard.css', '.map-trail-dot i')
    const [v, h] = padding(b)
    const size = px(decl(b, 'font-size'))
    expect(fontPx(CRUMB_LABEL_STYLE.font)).toBe(size)
    expect(CRUMB_LABEL_STYLE.chromeW).toBe(2 * h)
    expect(CRUMB_LABEL_STYLE.chromeH).toBe(2 * v)
    expect(CRUMB_LABEL_STYLE.lineH).toBeCloseTo(size * Number(decl(b, 'line-height')), 2)
  })
  it('.team-dot b', () => {
    const b = rule('09-whiteboard.css', '.team-dot b')
    const [v, h] = padding(b)
    expect(fontPx(TEAM_LABEL_STYLE.font)).toBe(px(decl(b, 'font-size')))
    expect(TEAM_LABEL_STYLE.chromeW).toBe(2 * h)
    expect(TEAM_LABEL_STYLE.chromeH).toBe(2 * v)
  })
})
