// Where a Leitung's end tag sits on the Plan (sweep 28.10.2026 #8b): pinned to its line, on the
// first free spot – pure geometry in board px, shared by the Whiteboard (which places every tag of
// the sheet in one pass) and PlanLineDecor (which draws one). The tag itself: lib/lineDecor · EndTag.

import { floorBadge } from './symbolRender'
import { boxesOverlap, type LabelBox } from './labelPass'
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
/** where along the last segment a tag may sit, in the order tried: the Karte's 72 %, then back
 *  towards the middle, then nearer the tip */
const TAG_ALONG = [0.72, 0.5, 0.85]

/**
 * Where a Leitung's end tag sits on the Plan (owner, sweep 28.10.2026 #8b: «pinned is ok but …
 * other symbols in the vicinity … get blocked»): PINNED to the last segment, its near edge
 * TAG_GAP_PX off the stroke, on the first spot whose `w`×`h` box hits nothing in `taken` – 72 %
 * along above the line, then below it, then 50 % and 85 %, each side in turn. Deterministic (same
 * picture, same spot – no drag, no search beyond these six), and when every spot is taken the
 * first one wins: a covered tag still sits on its own line. `pts` and the boxes are board px;
 * returns the tag's centre. «Above» is the side facing the top of the screen.
 */
export function placeEndTag(pts: readonly (readonly [number, number])[], w: number, h: number, taken: readonly LabelBox[]): [number, number] {
  const pe = pts[pts.length - 1]
  const pp = pts[pts.length - 2] ?? pe
  const dx = pe[0] - pp[0], dy = pe[1] - pp[1]
  const len = Math.hypot(dx, dy) || 1
  // the unit normal on the upper side (a vertical segment: its left)
  let nx = -dy / len, ny = dx / len
  if (ny > 0 || (ny === 0 && nx > 0)) { nx = -nx; ny = -ny }
  const lift = (Math.abs(nx) * w) / 2 + (Math.abs(ny) * h) / 2 + TAG_GAP_PX
  const spots = TAG_ALONG.flatMap((t) => [1, -1].map((side): [number, number] => [
    pp[0] + dx * t + nx * lift * side, pp[1] + dy * t + ny * lift * side,
  ]))
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
    const at = placeEndTag(boardPts(a, sW, sH, mapY), w, h, taken)
    spots.set(a.id, at)
    taken.push({ x: at[0] - w / 2, y: at[1] - h / 2, w, h })
  }
  return spots
}

