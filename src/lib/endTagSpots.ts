// Where a Leitung's end tag sits, on the Plan and on the Karte alike: pinned to its line, its near
// edge just short of the line's end so the arrowhead stays visible (endTagOffset – hill climb r16,
// Opus 4). On the Plan it also dodges, on the first free spot (sweep 28.10.2026 #8b) – pure geometry
// in board px, shared by the Whiteboard (which places every tag of the sheet in one pass) and
// PlanLineDecor (which draws one); MapView hands the same offset to the tag's Marker and the label
// pass. The tag itself: lib/lineDecor · EndTag.

import { floorBadge } from './symbolRender'
import { boxesOverlap, type LabelBox } from './labelPass'
import { arrowTipLeadPx } from './lineAttachments'
import { lookbackPoint } from './lineStyle'
import type { BoardAnno } from '../types'

/** a storey's board y for a normalized y (Whiteboard · floorGeometry · mapY) */
type MapY = (floor: number | undefined, ly: number) => number

/** The end tag's own facts as one string – «1 · S · +2» (Leitung-Nr, content letter, storey); the
 *  Trupp rides after it (EndTag). Empty for a line without any. */
export function endTagText({ lineNo, content, floorTag }: { lineNo?: number; content?: string; floorTag?: number }): string {
  return [lineNo != null ? String(lineNo) : '', content ?? '', floorTag != null ? floorBadge(floorTag) : ''].filter(Boolean).join(' · ')
}

/** clearance between the stroke and the tag's near edge, px – 14 px centre-lift on a level line */
const TAG_GAP_PX = 5.5
/** how far short of the line's end (or of its arrowhead's back) the tag's near edge stands, along
 *  the line, px (hill climb r16, Opus 4: centred on the end, the tag covered the arrowhead and the
 *  Leitung read as ending in a box) */
const TAG_END_CLEAR_PX = 4
/** how far back along the stroke the end's direction is sampled, px: about where the tag stands, so
 *  it follows the chord of a curving freehand hose instead of its last few jittery px (r16 – on the
 *  16 px the arrowhead samples, a hose curving into its end put the tag back on its own stroke) */
const TAG_LOOKBACK_PX = 32

/** The Plan's arrowhead, sized to the stroke (PlanLineDecor draws it): half-width, length back from
 *  the tip, and how far the tip leads past the end vertex (lib/lineAttachments · arrowTipLeadPx). */
export function planArrowHead(width = 5) {
  const halfW = Math.max(7, width * 1.7)
  return { halfW, len: halfW * 2.1, lead: arrowTipLeadPx(width) }
}
/** how far a Plan Linie's arrowhead reaches back behind its end vertex, px – 0 without one */
export function planArrowBackPx(a: { arrow?: boolean; width?: number }): number {
  if (!a.arrow) return 0
  const { len, lead } = planArrowHead(a.width ?? 5)
  return Math.max(0, len - lead)
}
/** …and the Karte's (lib/mapImages · arrowImage): a 48 px icon at pixelRatio 2 × the layer's
 *  icon-size 1.1, centred on the end; its wings stand 16/48 of it behind the centre. */
export const MAP_ARROW_BACK_PX = ((48 / 2) * 1.1 * 16) / 48

/** A hand-placed Karte tag (`endLabelAt`) keeps its old Marker offset: the drag stores the ground
 *  point under the grab (MapView · labelDown), the tag stands this far above it. */
export const END_TAG_HELD_OFFSET: readonly [number, number] = [0, -14]

/** the unit direction a line travels at its end, in px (the chord from TAG_LOOKBACK_PX back) */
export function endDirection(pts: readonly (readonly [number, number])[]): [number, number] {
  const pe = pts[pts.length - 1]
  const ref = lookbackPoint(pts, TAG_LOOKBACK_PX)
  const dx = pe[0] - ref[0], dy = pe[1] - ref[1]
  const len = Math.hypot(dx, dy)
  return len ? [dx / len, dy / len] : [1, 0]
}

/** the unit normal of `u` on the tag's default side: facing the top of the screen on a shallow
 *  line, its LEFT on a steep one (r16: on a hose falling steeply to the right «above» meant right of
 *  it, where the Trupp names beside it stand) */
function defaultNormal([ux, uy]: readonly [number, number]): [number, number] {
  const nx = -uy, ny = ux
  return (Math.abs(uy) > Math.abs(ux) ? nx > 0 : ny > 0) ? [-nx, -ny] : [nx, ny]
}

/** how far back the bend into the end is read, px, and how far the stroke must stand off the
 *  end's chord there to count as a bend (less is a straight end) */
const TAG_BEND_PX = 2 * TAG_LOOKBACK_PX
const TAG_BEND_MIN_PX = 3

/**
 * Which side of its end a tag stands on: 1 the default side (defaultNormal), -1 the other. On a
 * hose that BENDS into its end the tag takes the outside of the bend – on the inside its own stroke
 * wraps round the tag (r16: a Leitung curving into its tip put «3 · H» back on its own line).
 */
export function endTagSide(pts: readonly (readonly [number, number])[]): 1 | -1 {
  const pe = pts[pts.length - 1]
  const [nx, ny] = defaultNormal(endDirection(pts))
  const far = lookbackPoint(pts, TAG_BEND_PX)
  return (far[0] - pe[0]) * nx + (far[1] - pe[1]) * ny > TAG_BEND_MIN_PX ? -1 : 1
}

/**
 * Where a `w`×`h` end tag's centre stands relative to its line's END vertex, in px – one constant
 * offset, the same at every zoom: back along the end direction `u` (unit, pointing at the tip)
 * until the tag's near edge is TAG_END_CLEAR_PX short of `back` (how far the arrowhead reaches
 * behind the end, 0 without one), and lifted to `side` (endTagSide) so its edge is TAG_GAP_PX off
 * the stroke.
 */
export function endTagOffset(u: readonly [number, number], w: number, h: number, back = 0, side: 1 | -1 = 1): [number, number] {
  const [ux, uy] = u
  const [nx, ny] = defaultNormal(u)
  const along = (Math.abs(ux) * w) / 2 + (Math.abs(uy) * h) / 2 + back + TAG_END_CLEAR_PX
  const lift = ((Math.abs(nx) * w) / 2 + (Math.abs(ny) * h) / 2 + TAG_GAP_PX) * side
  return [-ux * along + nx * lift, -uy * along + ny * lift]
}

/**
 * Where a Leitung's end tag sits on the Plan (owner, sweep 28.10.2026 #8b: «pinned is ok but …
 * other symbols in the vicinity … get blocked»): PINNED beside the line's end (endTagOffset), on the
 * first spot whose `w`×`h` box hits nothing in `taken` – on its side (endTagSide), then on the
 * other, then the same one tag-length further back, each side in turn.
 * Deterministic (same picture, same spot – no drag, no search beyond these four), and when every
 * spot is taken the first one wins: a covered tag still sits on its own line. `pts`, `back` and the boxes are board px; returns the tag's centre.
 */
export function placeEndTag(pts: readonly (readonly [number, number])[], w: number, h: number, taken: readonly LabelBox[], back = 0): [number, number] {
  const pe = pts[pts.length - 1]
  const u = endDirection(pts)
  const step = Math.abs(u[0]) * w + Math.abs(u[1]) * h + TAG_GAP_PX
  const first = endTagSide(pts)
  const sides = [first, first === 1 ? -1 : 1] as const
  const spots = [back, back + step].flatMap((b) => sides.map((side): [number, number] => {
    const [ox, oy] = endTagOffset(u, w, h, b, side)
    return [pe[0] + ox, pe[1] + oy]
  }))
  const free = spots.find(([x, y]) => !taken.some((b) => boxesOverlap({ x: x - w / 2, y: y - h / 2, w, h }, b)))
  return free ?? spots[0]
}

/** The end tag's box as the sheet will draw it – estimated, not measured, so the spot is known
 *  before the first paint and never jumps: the `.line-end-tag` (--fs-1, 1 px/4 px + the 1.5 px ring)
 *  is ~17.5 px tall and ~6.25 px per character plus its 11 px of chrome wide. The height stays the
 *  17 it was at --fs-micro, so the tag keeps its 14 px centre-lift off the stroke. */
export const tagSize = (text: string) => ({ w: 11 + text.length * 6.25, h: 17 })

/** a Linie's points in board px, each on its own storey's section (`mapY`) */
export const boardPts = (a: BoardAnno, sW: number, sH: number, mapY: MapY) =>
  (a.pts ?? []).map(([x, y, floor]) => [x * sW, mapY(floor ?? a.floor, y) * sH] as [number, number])

/**
 * Every Linie's end-tag centre on this sheet, in board px (sweep 28.10.2026 #8b): each tag dodges
 * the `obstacles` (the placed symbols and Trupp chips) and every tag placed before it, in the
 * order `annos` lists them – lib/lineDecor · placeEndTag. The Whiteboard computes it once per
 * render and hands each PlanLineDecor (components/PlanLineDecor) its spot.
 */
export function planEndTagSpots(annos: readonly BoardAnno[], obstacles: readonly LabelBox[], sW: number, sH: number, mapY: MapY): Map<string, [number, number]> {
  const taken = [...obstacles]
  const spots = new Map<string, [number, number]>()
  for (const a of annos) {
    if (a.kind !== 'draw' || (a.pts?.length ?? 0) < 2) continue
    const text = endTagText(a)
    if (!text) continue
    const { w, h } = tagSize(text)
    const at = placeEndTag(boardPts(a, sW, sH, mapY), w, h, taken, planArrowBackPx(a))
    spots.set(a.id, at)
    taken.push({ x: at[0] - w / 2, y: at[1] - h / 2, w, h })
  }
  return spots
}

