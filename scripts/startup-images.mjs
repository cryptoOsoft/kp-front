// iOS launch images (`apple-touch-startup-image`) for the installed app, generated at build time
// by vite.config · startupImages. Without them iOS shows plain black from the tap until the web
// view's first paint – ~4 s on the owner's iPhone (screen recording 08.11.2026). With them it
// shows the boot splash's own background, so the snail's entrance lands on the colour that was
// already there (owner pick 08.11.: «1A» – background only, no snail; day/night follows the
// phone's appearance, the only signal iOS offers before any of our code runs).
//
// The gradient is READ from index.html's inline boot CSS (`--app-bg`, day and night), so the
// image cannot drift from the splash it hands over to. Plain Node (zlib PNG), no image library.
// iOS matches an image only on the exact device size, hence one per screen and orientation.
import { constants, deflateSync } from 'node:zlib'

/** CSS px (portrait) and pixel ratio of the screens we ship an image for. Phones portrait only;
 *  iPads (the KP tablets) both orientations. */
export const SCREENS = {
  phone: [
    [375, 667, 2], [414, 736, 3], [375, 812, 3], [414, 896, 2], [414, 896, 3], [390, 844, 3],
    [428, 926, 3], [393, 852, 3], [430, 932, 3], [402, 874, 3], [440, 956, 3], [420, 912, 3],
  ],
  tablet: [
    [768, 1024, 2], [810, 1080, 2], [834, 1112, 2], [820, 1180, 2], [834, 1194, 2], [834, 1210, 2],
    [744, 1133, 2], [1024, 1366, 2], [1032, 1376, 2],
  ],
}

/** `{ day, night }` colour stops of index.html's `--app-bg: radial-gradient(120% 90% at 50% -10%, …)`. */
export function splashGradients(html) {
  const grab = (selector) => {
    const block = html.match(new RegExp(`${selector}\\s*\\{([^}]*)\\}`))?.[1] ?? ''
    const g = block.match(/--app-bg:\s*radial-gradient\(120% 90% at 50% -10%,([^;]+)\);/)?.[1]
    const stops = [...(g ?? '').matchAll(/#([0-9a-f]{6})\s+(\d+(?:\.\d+)?)%/gi)]
      .map(([, hex, at]) => ({ rgb: [0, 2, 4].map((i) => parseInt(hex.slice(i, i + 2), 16)), at: Number(at) / 100 }))
    if (stops.length < 2) throw new Error(`startup-images: no --app-bg radial gradient under ${selector} in index.html – did the boot CSS change shape?`)
    return stops
  }
  return { day: grab(':root'), night: grab(':root\\[data-theme="night"\\]') }
}

function crc32(buf) {
  let c = ~0
  for (const b of buf) { c ^= b; for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (0xedb88320 & -(c & 1)) }
  return ~c >>> 0
}

function chunk(type, data) {
  const out = Buffer.alloc(12 + data.length)
  out.writeUInt32BE(data.length, 0)
  out.write(type, 4, 'latin1')
  data.copy(out, 8)
  out.writeUInt32BE(crc32(out.subarray(4, 8 + data.length)), 8 + data.length)
  return out
}

const N = 4096 // gradient positions over t ∈ [0, 2): finer than one 8-bit step

/** Colour per gradient position for one stop list. */
function lookup(stops) {
  const lut = new Uint8Array(N * 3)
  for (let i = 0; i < N; i++) {
    const t = (i / N) * 2
    let j = 1
    while (j < stops.length - 1 && t > stops[j].at) j++
    const a = stops[j - 1], b = stops[j]
    const f = Math.min(1, Math.max(0, (t - a.at) / (b.at - a.at)))
    for (let k = 0; k < 3; k++) lut[i * 3 + k] = Math.round(a.rgb[k] + (b.rgb[k] - a.rgb[k]) * f)
  }
  return lut
}

/** `w`×`h` px RGB PNGs of the splash gradient, one per entry of `schemes` (stop lists): ellipse
 *  120 % × 90 % of the box, centred at 50 % / −10 %, stops linear in sRGB like the browser's.
 *  The geometry is computed once per size (and once per mirrored half) for every scheme. */
export function gradientPngs(w, h, schemes) {
  const rx = 1.2 * w, ry = 0.9 * h, cx = 0.5 * w, cy = -0.1 * h
  const at = new Uint16Array(w * h)
  for (let y = 0; y < h; y++) {
    const dy = (y + 0.5 - cy) / ry
    for (let x = 0; x < Math.ceil(w / 2); x++) {
      const dx = (x + 0.5 - cx) / rx
      const i = Math.min(N - 1, Math.floor((Math.sqrt(dx * dx + dy * dy) / 2) * N))
      at[y * w + x] = i
      at[y * w + w - 1 - x] = i
    }
  }
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(w, 0)
  ihdr.writeUInt32BE(h, 4)
  ihdr.set([8, 2, 0, 0, 0], 8) // 8-bit, truecolour, no interlace
  const row = 1 + w * 3
  return Object.fromEntries(Object.entries(schemes).map(([name, stops]) => {
    const lut = lookup(stops)
    const raw = Buffer.alloc(row * h)
    for (let y = 0; y < h; y++) {
      raw[y * row] = 1 // filter «Sub»: neighbours differ by ±1 at most, so the rows deflate to almost nothing
      let p0 = 0, p1 = 0, p2 = 0
      for (let x = 0; x < w; x++) {
        const i = at[y * w + x] * 3, o = y * row + 1 + x * 3
        raw[o] = (lut[i] - p0) & 0xff; raw[o + 1] = (lut[i + 1] - p1) & 0xff; raw[o + 2] = (lut[i + 2] - p2) & 0xff
        p0 = lut[i]; p1 = lut[i + 1]; p2 = lut[i + 2]
      }
    }
    const png = Buffer.concat([
      Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
      chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw, { level: 9, strategy: constants.Z_RLE })), chunk('IEND', Buffer.alloc(0)),
    ])
    return [name, png]
  }))
}

/** Every screen to emit images for: pixel size, and per scheme its file and `<link media>`. */
export function startupImages() {
  const out = []
  const add = ([w, h, dpr], orientation) => {
    const [pw, ph] = orientation === 'portrait' ? [w * dpr, h * dpr] : [h * dpr, w * dpr]
    const media = (scheme) => `(device-width: ${w}px) and (device-height: ${h}px) and (-webkit-device-pixel-ratio: ${dpr}) and (orientation: ${orientation}) and (prefers-color-scheme: ${scheme === 'night' ? 'dark' : 'light'})`
    out.push({ w: pw, h: ph, files: Object.fromEntries(['day', 'night'].map((s) => [s, { file: `startup/${pw}x${ph}-${s}.png`, media: media(s) }])) })
  }
  for (const s of SCREENS.phone) add(s, 'portrait')
  for (const s of SCREENS.tablet) { add(s, 'portrait'); add(s, 'landscape') }
  return out
}
