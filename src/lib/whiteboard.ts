// Pure helpers extracted from Whiteboard: plan URL resolution, floor labelling, and
// the floor-stack ↔ board-normalized coordinate maths. No React — safe to unit-test.

/*
 * *A plan opens with the WHOLE sheet between the bars* (sweep B8, 07.10.2026, owner option 1):
 * `lib/whiteboard · containFit` contains it in the canvas less the top bar (`TOP_INSET`), the
 * side rails (`sideInsets`) and the bottom-left chip row (`chipRowInset` — 76px on a tablet,
 * 58px on a phone, where the row stands just above the tool bar; the Gebäude keeps
 * `STACK_CHIP_ROW`). The chips never cover the sheet's legend at fit, and «Einpassen» is scale 1
 * of the same box. The constants mirror the CSS like `TOP_INSET` does: move the chip row and
 * they move with it. (The Karte has no inset-aware fit to follow: its `fitBounds` takes a flat
 * padding.)
 */

import { appConfig } from '../config/appConfig'
import { fillTemplate } from './format'
import type { BoardPoint } from '../types'

const BASE = import.meta.env.BASE_URL
// plan PDFs may live under /public (relative) OR be served by the backend per-object
// (absolute, e.g. /api/reference/plan:<obj>:modul1) — don't BASE-prefix absolute URLs.
export const planUrl = (u: string) => (/^(https?:)?\/\//.test(u) || u.startsWith('/') ? u : `${BASE}${u}`)

/** What a storey band measured before it followed its drawing (16.09.2026) — and what every stack
 *  created until then keeps: the tile box is centred in the band, so a band that changed under
 *  existing ink would take the ink with it. New stacks carry their own `tileAR`. */
export const TILE_AR = 0.72 // each floor tile's height/width in the stack
/** The band this Gebäude is drawn with. ⚠️ THE one resolver — the board's aspect, the measure
 *  space (`1 / tileAR`), the ground fit and the printed page must all read the same number. */
export const tileAspectOf = (b?: { tileAR?: number } | null): number => b?.tileAR ?? TILE_AR
/** the Gebäude floor-stack's plan id – the ONE sheet whose ink also shows on the other linked
 *  sheets (lib/planProjection · projectOnto), because the building view is where a Brand is
 *  marked and the Übersicht is where it is read. data/demoIncident · gebaeudeDoc carries it. */
export const GEBAEUDE_PLAN_ID = 'gebaeude'
// the canvas is full-bleed (content can pan up behind the floating top bar), but
// the default "fit" view is sized + vertically centred into the region BELOW the
// bar. Must match the top-bar clearance used in CSS.
export const TOP_INSET = 80
// …and the same for the SIDE rails. The plan pans under them happily once it is dragged
// there — what it must not do is OPEN underneath them, because the left edge of a plan is
// where its title block and its Zufahrt are. Left = NavRail (16 + --rail-w) plus air; right =
// the tool rail (16 + --vrail-w) plus air. Zero on a phone, where both are bottom BARS.
// Like TOP_INSET these must match the CSS; an EXPANDED rail is wider still, and the fit is
// deliberately not re-run for that — expanding the rail is a deliberate act with the plan
// already on screen, and re-fitting under the hand would move what somebody is looking at.
export const SIDE_INSET_L = 88
/** the Gebäude's Messungen column (ReadingParts · StackReadings, 09-whiteboard `.wb-readings`): its
 *  252px + the 16px gap to the stack, kept free left of the stack while a Messpunkt is on it */
export const STACK_READINGS_LANE = 268
export const SIDE_INSET_R = 92
/**
 * No side rails on a phone — they are the two stacked bottom bars there.
 *
 * ⚠️ `phone` is an OVERRIDE, because the canvas width alone lies during «Karte verknüpfen»:
 * the plan half of the split is often narrower than 600px while the floating rails are still
 * exactly where they were. Reading the phone rule off that width opened the sheet flush against
 * both edges — under the NavRail on the left, and against the mode's own seam on the right, so
 * the dashed boundary appeared to run straight through the plan.
 */
export const sideInsets = (viewportW: number, phone = viewportW <= 600) =>
  phone ? { l: 0, r: 0 } : { l: SIDE_INSET_L, r: SIDE_INSET_R }
// in the floor-stack (Gebäude) view the +OG / −UG pills stand just outside the top and bottom
// edges of the stack (09-whiteboard · .wb-floor-add: --sp-3 off the edge, a --tap tall = 56px).
// The default "fit" reserves this much room above AND below so both stay on-screen with 8px to
// spare — which is also how far «+ UG» ends above the chip row (15-mobile · --stack-foot-lift).
export const STACK_VPAD = 64
// …and, below that, the bottom-left chip row (09-whiteboard · .wb-botleft: 12px off the edge, a
// --tap tall). The stack's «+ UG» straddles its bottom edge, so a fit that ran down to the
// canvas edge put that pill ON the chips (3am test r2, 25.09.2026 — at 820 and at 360). The
// Gebäude fit reserves the row; an ordinary sheet does not, it has no pill down there.
export const STACK_CHIP_ROW = 56
/**
 * …and an ordinary sheet reserves the chip row too (sweep B8, 07.10.2026, owner option 1): the
 * fit is «the WHOLE sheet inside the free area between the bars», and the bottom-left chips
 * (Objekt · Ref. · Karte verknüpfen) are part of what bounds it. Without this a portrait sheet
 * ran to the canvas foot and the chips sat on its legend — at 1440 over the title block, on a
 * phone over the plan's footer. Like TOP_INSET these must match the CSS:
 * - tablet/desktop: `.wb-botleft` stands 16px off the canvas foot, --float-h (52px) tall, + 8px air;
 * - phone: the row is fixed at --float-bottom, 8px above the tool bar, where the canvas ends —
 *   so it reaches 50px into the canvas, + 8px air.
 * The Gebäude keeps its own STACK_CHIP_ROW (its «+ UG» pill straddles the edge besides).
 */
export const CHIP_ROW_INSET = 76
export const CHIP_ROW_INSET_PHONE = 58
export const chipRowInset = (phone: boolean): number => (phone ? CHIP_ROW_INSET_PHONE : CHIP_ROW_INSET)
/**
 * THE fitted board: the plan's sheet contained in the free area — the canvas less the top bar,
 * the side rails and the bottom reserve. Every «eingepasst» (the opening view, «Einpassen», a
 * zoom out through fit) is scale 1 of this box, so they cannot disagree.
 */
export function containFit(
  vp: { w: number; h: number }, aspect: number,
  inset: { top: number; bottom: number; l: number; r: number },
): { w: number; h: number } {
  const w = Math.max(0, vp.w - inset.l - inset.r)
  const h = Math.max(0, vp.h - inset.top - inset.bottom)
  if (!w || !h || !(aspect > 0)) return { w: 0, h: 0 }
  return w * aspect <= h ? { w, h: w * aspect } : { w: h / aspect, h }
}
export const clamp01 = (v: number) => Math.min(1, Math.max(0, v))
export const floorLabel = (f: number) => {
  const c = appConfig.copy.floor
  return f === 0 ? c.eg : f > 0 ? fillTemplate(c.og, { n: f }) : fillTemplate(c.ug, { n: -f })
}

/**
 * A Leitung's vertices split into the runs that lie on ONE storey (a vertex without its own
 * storey is on the anno's). On the Gebäude stack each run is drawn on its tile and the jump
 * between runs is not drawn at all – a stair mark stands at both ends instead (mock C,
 * 14.09.2026). A single-storey line is one run.
 */
export function floorSections(pts: BoardPoint[], floor: number | undefined): BoardPoint[][] {
  const out: BoardPoint[][] = []
  let cur: BoardPoint[] = []
  let curFloor: number | undefined
  for (const p of pts) {
    const f = p[2] ?? floor ?? 0
    if (cur.length && f !== curFloor) { out.push(cur); cur = [] }
    cur.push(p); curFloor = f
  }
  if (cur.length) out.push(cur)
  return out
}

/** the storey changes along a Leitung: index i where vertex i and i+1 lie on different storeys */
export const floorCrossings = (pts: BoardPoint[], floor: number | undefined): number[] =>
  pts.slice(0, -1).flatMap((p, i) => ((p[2] ?? floor ?? 0) !== (pts[i + 1][2] ?? floor ?? 0) ? [i] : []))

/** a floor index signed the way every Stockwerk badge is signed: «+2», «0», «−1» */
export const signedFloor = (index: number): string => index > 0 ? `+${index}` : index < 0 ? `−${-index}` : '0'

/** the `#page=N` (1-based) a floor-pack sheet's URL names → 0-based page index; null = the whole
 *  document (see types · PlanDocument.floor for why the page travels in the URL) */
export const pdfPageOf = (url: string): number | null => {
  const m = /#page=(\d+)/.exec(url)
  return m ? Math.max(0, Number(m[1]) - 1) : null
}
export const withPdfPage = (url: string, page: number): string => `${url.replace(/#.*$/, '')}#page=${page + 1}`

/**
 * The storey a step LANDS on: `wanted` when the building has it, otherwise the next one it does
 * have in that direction — a pack with EG and 2. OG steps from one straight to the other instead
 * of stopping at a +1 that was never drawn. Null when there is nothing further that way.
 */
export function storeyTowards(floors: readonly number[], from: number, wanted: number): number | null {
  if (wanted === from) return null
  if (floors.includes(wanted)) return wanted
  const beyond = floors.filter((f) => (wanted > from ? f > from : f < from))
  if (!beyond.length) return null
  // the nearest one in the direction travelled — never past the storey that was asked for
  return wanted > from ? Math.min(...beyond) : Math.max(...beyond)
}

/** Where the ink of a storey that is NOT on the board goes: one whole board above it, so it is
 *  clipped away by the SVG's own viewport instead of being drawn somewhere it does not belong.
 *  Reachable since a storey can be folded away per device (lib/floorPrefs) — before that it was
 *  only stale ink on a deleted storey, which the old fallback drew onto the TOP tile. */
export const OFF_BOARD_Y = -1

/**
 * Floor-stack coordinate maps for the current document. In stack mode the board is a
 * vertical stack of N storey tiles (top = highest); single-sheet docs are one tile
 * [0,1] → identity. `mapY` lifts a tile-local y into whole-board normalized space,
 * `localY` does the inverse for a given storey, and `floorAt` resolves which storey a
 * board-normalized y falls into.
 *
 * ⚠️ `floorsTTB` is what the board DRAWS, not what the building has: a folded-away storey is
 * absent from it, and its annotations therefore map off the board (OFF_BOARD_Y) rather than onto
 * a tile that is not theirs. Nothing is lost — the document still carries them, and unfolding the
 * storey puts them back.
 */
export function floorGeometry(stack: boolean, floorsTTB: number[], N: number) {
  // tile-local y (0..1 within a storey) → whole-board normalized y. x is unchanged
  // (tiles span the full width); single-sheet docs are one tile [0,1] → identity.
  const mapY = (floor: number | undefined, ly: number) => {
    if (!stack) return ly
    const idx = floorsTTB.indexOf(floor ?? 0)
    return idx < 0 ? OFF_BOARD_Y : (idx + ly) / N
  }
  // board-normalized y → tile-local y for a given storey
  const localY = (ny: number, floor: number) => {
    if (!stack) return ny
    return clamp01(ny * N - floorsTTB.indexOf(floor))
  }
  // which storey a board-normalized y falls into
  const floorAt = (ny: number) => floorsTTB[Math.min(N - 1, Math.max(0, Math.floor(ny * N)))]
  /** The snapshot `moveRigid` is handed: a stroke's stored vertices in board space, each keeping its
   *  storey exactly as stored (absent stays absent; `home` is what the absence means). */
  const boardPts = (pts: readonly BoardPoint[], home: number): BoardPoint[] =>
    pts.map((p): BoardPoint => (p[2] == null ? [p[0], mapY(home, p[1])] : [p[0], mapY(p[2], p[1]), p[2]]))
  /**
   * ⚠️ A whole stroke moved (and/or turned) as ONE BODY — `localY` for a shape, not for a point.
   *
   * `bpts` are the stroke's vertices in board space as the gesture STARTED (y through `mapY`),
   * each carrying its own storey exactly as stored — absent where the record has none; `home` is
   * the anno's storey that an absent one means. `to` is the gesture's frame: where a start point
   * is now. `pinned` names the vertices that must not move (an attached end stays on its target).
   *
   * Every free vertex stays on its OWN tile, and the stack keeps the stroke on those tiles by
   * limiting the TRANSLATION: past a tile's edge the whole shape stops at it (`rigidTileShift`),
   * so every vertex keeps its offset from every other. Clamping per point — `localY` on each
   * vertex, which is what the body drag and the SelectionBar did — flattened every vertex that
   * crossed onto y = 1 while the rest travelled on (prod 23.09.2026 18:22:19: 5 of 6 vertices of
   * a Leitung at y = 1, and the Karte hose baked off it collapsed with it).
   *
   * The storey a vertex was stored with is written back AS stored: `[x, y]` stays `[x, y]`. An
   * absent storey and `0` are different facts on the stack (absent = the anno's own storey), and
   * off it `0` states a storey the sheet does not have — it also made the store read an unmoved
   * projection as a drag (tacticalObjects · sameValue compares the arity).
   */
  const moveRigid = (
    bpts: readonly BoardPoint[], home: number,
    to: (x: number, by: number) => [number, number],
    pinned?: (i: number) => BoardPoint | null | undefined,
  ): BoardPoint[] => {
    const fixed = bpts.map((_, i) => pinned?.(i) ?? null)
    const moved = bpts.map((p, i) => (fixed[i] ? null : to(p[0], p[1])))
    // tile-local, UNclamped: the overshoot is what the shift is measured from
    const raw = moved.map((q, i) => (q == null ? 0 : stack ? q[1] * N - floorsTTB.indexOf(bpts[i][2] ?? home) : q[1]))
    const shift = stack ? rigidTileShift(raw.filter((_, i) => moved[i] != null)) : 0
    return bpts.map((p, i): BoardPoint => {
      const pin = fixed[i]; if (pin) return pin
      // clamp01 only bites when the shape is TALLER than a tile (a long stroke turned upright),
      // where no translation can keep it whole — see rigidTileShift
      const ly = stack ? clamp01(raw[i] + shift) : raw[i]
      return p[2] == null ? [moved[i]![0], ly] : [moved[i]![0], ly, p[2]]
    })
  }
  return { mapY, localY, floorAt, boardPts, moveRigid }
}

/**
 * How far a rigid shape has to be shifted (tile-local y) so all of it lies inside [0, 1] — 0 when
 * it already does. A shape taller than one tile cannot fit whichever way it is shifted; it is
 * centred, and the per-point clamp then flattens only what overhangs at either end — the least
 * a tile can do for it. (Moving it to ANOTHER storey is the caller's: on the Gebäude stack a drop
 * onto another tile shifts its storeys first – lib/grundriss · shiftStoreys – and hands moveRigid
 * the shifted stroke; a vertex changes storey by its own grip.)
 */
export function rigidTileShift(ys: readonly number[]): number {
  if (!ys.length) return 0
  let lo = Infinity, hi = -Infinity
  for (const y of ys) { if (y < lo) lo = y; if (y > hi) hi = y }
  if (hi - lo > 1) return 0.5 - (lo + hi) / 2
  return lo < 0 ? -lo : hi > 1 ? 1 - hi : 0
}
