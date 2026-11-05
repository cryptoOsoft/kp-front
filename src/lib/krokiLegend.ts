// The client's mirror of the LAST pass in backend/app/kroki.py (`render_kroki`, the block under
// «words last, and they go in the LEGEND, not on the picture»): every drawing label and every
// symbol caption is replaced on the picture by a numbered disc, and its words move into a legend
// printed under the crop. Decided 09.08. after the 08.08. Einsatz printed three caption chips on
// top of one another — on paper, where nothing can be dragged aside.
//
// Pure, so the framing preview and a test can ask the sheet's own question: does this disc fit
// INSIDE the crop, and therefore what number does it carry — or none at all?
//
// ⚠️ The server does NOT disc everything. End tags, Trupp chips and Notizzettel keep printing
// inline (`_end_tag` / `_caption` / `_label_box` — the `if not svg` branch returns before the
// caption list is touched). A sweep that collected every label on the map would put lines in the
// legend that the sheet never prints.

import type { CaptionMode, Drawing, Entity, LngLat } from '../types'
import { circlePolygon, fmtDistance, hoseLengthHint, pathLengthM } from './geo'
import { hoseLines } from './hydraulics'
import { krokiEntity, krokiSymbolMul } from './krokiPayload'
import { shapePx, symPx } from './mapView'

/** kroki.py · `_NUM_R` — the printed disc's radius in the server's 1050px reference units, so
 *  the radius on any surface is `KROKI_DISC_R * u` with `u = width / 1050`. */
export const KROKI_DISC_R = 9.5

/** …and the smallest disc worth DRAWING in the preview. At true print scale the disc is ~8.3px
 *  across in Quer and ~4.6px in Hoch: a digit cannot live in that.
 *  ⚠️ Two radii, deliberately. The fit test below uses the TRUE radius; drawing uses this floor.
 *  Testing with the drawn radius would make the preview drop things the sheet prints — a lie in
 *  the opposite direction from the one this whole legend exists to end. */
export const KROKI_DISC_MIN_PX = 15

/** One labelled thing the sheet turns into a numbered disc. */
export interface KrokiLabel {
  key: string
  /** the anchor the disc is centred on (before `glyph`'s downward nudge) */
  at: LngLat
  /** the legend line — the server joins a chip's stacked lines with « · » */
  text: string
  /** a symbol CAPTION hangs under its glyph, so its disc hangs under it too; `null` on a drawing
   *  label, which the server centres on its own anchor (`marker_xy`) */
  glyph: { kind: string; lat: number; sizeM?: number } | null
}

/** Where the disc sits relative to its anchor, in surface px. Mirrors kroki.py: a caption is
 *  anchored at the TOP edge of the chip that would have hung under the glyph
 *  (`y + size/2 + 3·u`), and `marker_xy` then nudges the disc down by its own radius. */
export function discOffsetPx(label: KrokiLabel, zoom: number, printScale: number): number {
  if (!label.glyph) return 0
  const { kind, lat, sizeM } = label.glyph
  const size = sizeM != null ? shapePx(sizeM, lat, zoom) : symPx(kind, lat, zoom, krokiSymbolMul(zoom))
  return (size / 2 + 3 + KROKI_DISC_R) * printScale
}

/**
 * Everything the sheet will number, in the server's own order: the drawings as they are walked
 * (circle radius · area label · line distance+label), then the symbol captions. The numbers
 * therefore follow the SCENE, not the reading flow — «1» can sit in the middle of the picture.
 *
 * Pass the same collections the preview draws: drawings only when the drawing layer is visible,
 * entities already filtered by layer visibility.
 */
export function krokiLabels(args: {
  drawings: Drawing[]
  entities: Entity[]
  byName: Record<string, string>
  captionMode?: CaptionMode
}): KrokiLabel[] {
  const { drawings, entities, byName, captionMode = 'auto' } = args
  const out: KrokiLabel[] = []
  for (const d of drawings) {
    const coords = d.coords ?? []
    if (d.kind === 'circle' && coords.length) {
      if (d.radiusM) {
        // the server labels the circle at `pts[len // 8]` of its own 72-gon — 45°, up and to the
        // right. The client's ring has 96 segments (97 points), and `length / 8` lands on the
        // same angle, which is why the same expression is the same place on both sides.
        const ring = circlePolygon(coords[0], d.radiusM)[0]
        out.push({ key: `d${d.id}`, at: ring[Math.floor(ring.length / 8)] as LngLat, text: `r = ${Math.round(d.radiusM)} m`, glyph: null })
      }
      continue
    }
    if (d.kind === 'area' && coords.length >= 3) {
      if (d.label) {
        // the server takes the centroid of the PROJECTED corners; over an Einsatz-sized polygon
        // the mean of the coordinates lands on the same pixel (Mercator is near-linear here)
        const cx = coords.reduce((s, c) => s + c[0], 0) / coords.length
        const cy = coords.reduce((s, c) => s + c[1], 0) / coords.length
        out.push({ key: `d${d.id}`, at: [cx, cy], text: d.label, glyph: null })
      }
      continue
    }
    if (coords.length >= 2) {
      const lines: string[] = []
      if (d.showDistance) {
        const m = pathLengthM(coords)
        lines.push(`${fmtDistance(m)} · ${hoseLengthHint(m, hoseLines(d))}`)
      }
      // ⚠️ NOT `d.labelAt`. A label dragged by hand moves on the Lage map, but no payload carries
      // that anchor to kroki.py — the sheet always uses the midpoint VERTEX (same rule as the end
      // tag, see KrokiFramingPanel · tagNormal).
      if (d.label) lines.push(d.label)
      const text = lines.filter((t) => t.trim()).join(' · ')
      if (text) out.push({ key: `d${d.id}`, at: coords[(coords.length - 1) >> 1], text, glyph: null })
    }
  }
  for (const e of entities) {
    const printable = krokiEntity(e, byName, captionMode)
    if (!printable?.caption) continue
    // no glyph → the server's `if not svg` branch: a Trupp dot and a Notizzettel print their text
    // INLINE and are never numbered; anything else glyph-less prints nothing at all
    if (!(printable.symbolSvg || byName[printable.symbol ?? ''])) continue
    out.push({
      key: `e${e.id}`,
      at: e.coord,
      text: printable.caption.split('\n').map((t) => t.trim()).filter(Boolean).join(' · '),
      glyph: { kind: e.kind, lat: e.coord[1], sizeM: printable.sizeM },
    })
  }
  return out
}

export interface KrokiPlaced {
  key: string
  /** the disc's centre in surface px */
  x: number
  y: number
  /** the disc fits WHOLLY inside the frame — the server's one condition for a legend line */
  fits: boolean
  /** …and its centre is on the picture at all, so a hollow ring at the edge is worth drawing */
  onPicture: boolean
}

/** Project every label and answer the sheet's question for each. `project` is the surface's own
 *  projection (MapLibre `map.project`); `width`/`height` are the crop in the same px. */
export function placeKrokiLabels(
  labels: KrokiLabel[],
  project: (c: LngLat) => { x: number; y: number },
  frame: { width: number; height: number; zoom: number; printScale: number },
): KrokiPlaced[] {
  const r = KROKI_DISC_R * frame.printScale
  return labels.map((l) => {
    const p = project(l.at)
    const x = p.x
    const y = p.y + discOffsetPx(l, frame.zoom, frame.printScale)
    return {
      key: l.key,
      x,
      y,
      fits: x >= r && x <= frame.width - r && y >= r && y <= frame.height - r,
      onPicture: x >= -1 && x <= frame.width + 1 && y >= -1 && y <= frame.height + 1,
    }
  })
}

export interface KrokiLegend {
  /** label key → the figure printed in its disc; a key that fits nowhere is simply absent */
  numbers: Record<string, number>
  /** the legend, in disc order — `lines[0]` is «1» */
  lines: string[]
  /** on the picture, but the disc does not fit: no number, no legend line, clipped on paper */
  unnumbered: number
}

/** Number what fits, in label order, exactly as `render_kroki` does. */
export function numberKrokiLabels(labels: KrokiLabel[], placed: KrokiPlaced[]): KrokiLegend {
  const byKey = new Map(placed.map((p) => [p.key, p]))
  const numbers: Record<string, number> = {}
  const lines: string[] = []
  let unnumbered = 0
  for (const l of labels) {
    const p = byKey.get(l.key)
    if (!p) continue
    if (p.fits) {
      numbers[l.key] = lines.length + 1
      lines.push(l.text)
    } else if (p.onPicture) {
      unnumbered++
    }
  }
  return { numbers, lines, unnumbered }
}

/** kroki.py · `_SCALE_STEPS` — the usual cartographic 1/2/2.5/5 ladder, in metres */
export const KROKI_SCALE_STEPS = [5, 10, 20, 25, 50, 100, 200, 250, 500, 1000, 2000]

export interface KrokiScaleBar {
  metres: number
  /** the bar itself */
  barPx: number
  /** the OPAQUE white plate under it — what a symbol must not be centred behind */
  platePx: number
}

/**
 * The Massstabsbalken, mirroring `_scale_bar`. Everything is a fraction of the surface width, so
 * the preview picks the same rung of the ladder the sheet will.
 *
 * `null` at a degenerate zoom — «no bar beats a wrong bar», and the sheet leaves it out too.
 */
export function krokiScaleBar(pxPerMetre: number, width: number, u: number): KrokiScaleBar | null {
  const target = width * 0.16
  let metres = KROKI_SCALE_STEPS[0]
  for (const m of KROKI_SCALE_STEPS) {
    if (Math.abs(m * pxPerMetre - target) < Math.abs(metres * pxPerMetre - target)) metres = m
  }
  const barPx = metres * pxPerMetre
  if (barPx < width * 0.06 || barPx > width * 0.4) return null
  // the plate is `bar + textlength("  {n} m") + 2·pad` wide (pad = 5u, font = 11u). The advance
  // widths are DejaVuSans', the face `_font` loads — estimated rather than measured because what
  // this number is for is «where does the white end», not typesetting.
  const label = 11 * u * (2 * 0.318 + String(metres).length * 0.636 + 0.318 + 0.98)
  return { metres, barPx, platePx: barPx + label + 10 * u }
}
