import { readFileSync } from 'node:fs'
import { inflateSync } from 'node:zlib'
import { describe, expect, it } from 'vitest'
import { gradientPngs, splashGradients, startupImages } from './startup-images.mjs'

const gradients = splashGradients(readFileSync(new URL('../index.html', import.meta.url), 'utf-8'))

/** pixel (x, y) of one of our PNGs: RGB, every row filtered «Sub» */
function pixel(png, x, y) {
  const w = png.readUInt32BE(16)
  const raw = inflateSync(png.subarray(41, png.length - 16)) // IDAT data: after sig+IHDR+IDAT head, before CRC+IEND
  const row = raw.subarray(y * (1 + w * 3) + 1, (y + 1) * (1 + w * 3))
  const px = [0, 0, 0]
  for (let i = 0; i <= x; i++) for (let k = 0; k < 3; k++) px[k] = (px[k] + row[i * 3 + k]) & 0xff
  return px
}

describe('iOS startup images', () => {
  it('take their colours from the boot splash in index.html', () => {
    expect(gradients.day[0].rgb).toEqual([0xee, 0xf3, 0xf7])
    expect(gradients.night.at(-1).rgb).toEqual([0x0d, 0x11, 0x18])
  })

  it('refuse a stop they cannot read instead of dropping it', () => {
    const html = readFileSync(new URL('../index.html', import.meta.url), 'utf-8').replace('#e7edf2 45%', '#f00 45%')
    expect(() => splashGradients(html)).toThrow(/unsupported --app-bg stop «#f00 45%»/)
  })

  it('paint the splash gradient: the CSS ellipse at the top centre, the last stop in the bottom corner', () => {
    const { night } = gradientPngs(120, 260, gradients)
    expect([night.readUInt32BE(16), night.readUInt32BE(20)]).toEqual([120, 260])
    const near = (a, b) => a.every((v, k) => Math.abs(v - b[k]) <= 1)
    // radial-gradient(120% 90% at 50% -10%): the top centre pixel sits (0.5 + 26) / 234 into it
    const [c0, c1] = gradients.night
    const f = (0.5 + 26) / 234 / c1.at
    expect(near(pixel(night, 60, 0), c0.rgb.map((v, k) => v + (c1.rgb[k] - v) * f))).toBe(true)
    expect(near(pixel(night, 119, 259), gradients.night.at(-1).rgb)).toBe(true)
  })

  it('paint the day image from the day stops', () => {
    const { day } = gradientPngs(120, 260, gradients)
    const near = (a, b) => a.every((v, k) => Math.abs(v - b[k]) <= 1)
    // the same ellipse as the night image above; the day stops #eef3f7 → #e7edf2 → #e1e8ee
    const f = (0.5 + 26) / 234 / 0.45
    expect(near(pixel(day, 60, 0), [0xee, 0xf3, 0xf7].map((v, k) => v + ([0xe7, 0xed, 0xf2][k] - v) * f))).toBe(true)
    expect(pixel(day, 119, 259)).toEqual([0xe1, 0xe8, 0xee])
  })

  it('cover the owner\'s iPhone in both appearances, one file each', () => {
    const files = startupImages().flatMap((s) => Object.values(s.files))
    expect(new Set(files.map((f) => f.file)).size).toBe(files.length)
    expect(files.filter((f) => f.media.includes('(device-width: 393px) and (device-height: 852px)')).map((f) => f.file))
      .toEqual(['startup/1179x2556-day.png', 'startup/1179x2556-night.png'])
  })
})
