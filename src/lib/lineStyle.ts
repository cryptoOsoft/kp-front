import { appConfig } from '../config/appConfig'

// Single source of truth for ANNOTATED-LINE behaviour shared by BOTH drawing surfaces — the Lage
// map (MapLibre line layers) and the Plan whiteboard (SVG polylines). The two render with totally
// different primitives (GL symbol layers vs DOM/SVG), so they can't share the final draw calls; but
// everything ABOVE the renderer — the preset bundles, the repeated-marker spacing math, the vertex-
// handle cap — lives here so the two surfaces can never drift apart in feature or behaviour.
//
// (The dash geometry + the solid/dashed picker live alongside in ./draw; the post-draw style editor
// is the shared <DrawEditor>. Together those three modules ARE the unified line system.)

/** A line preset (Freihand / Messpfeil / Rettungsachse) is a bundle of style fields seeded on a new
 *  line + re-applied from the editor. Each field stays editable afterwards. */
export interface LinePresetFields {
  arrow?: boolean
  marker?: string
  showDistance?: boolean
  dashed?: boolean
  color?: string
}

/** Look up a preset by id (defaults to the first = Freihand if unknown). */
export function getLinePreset(id: string) {
  const presets = appConfig.drawing.linePresets
  return presets.find((p) => p.id === id) ?? presets[0]
}

/** The style patch a preset applies — the SAME bundle on both surfaces (the Plan simply doesn't
 *  RENDER `showDistance`, since a building plan has no metric scale; the flag is still carried so the
 *  data model and preset-inference stay identical). Empty flags coerce to `undefined` so switching
 *  back to Freihand cleanly REMOVES a previous preset's arrow/marker/distance (rather than persisting
 *  `false`/`''` noise into the synced blob); `dashed` falls back to the line's current value when the
 *  preset doesn't own it (Freihand keeps whatever dash the line/dock had). Both surfaces — the map
 *  (useMapDrawing) and the plan (Whiteboard) — apply this ONE bundle, so they can't drift. */
export function resolveLinePreset(id: string, currentDashed?: boolean): LinePresetFields {
  const p = getLinePreset(id).defaults
  return {
    arrow: p.arrow || undefined,
    marker: p.marker || undefined,
    showDistance: p.showDistance || undefined,
    dashed: p.dashed ?? currentDashed,
  }
}

/**
 * What a finished line should be CALLED — «Rettungsachse», «Pfeil», or nothing.
 *
 * The preset id is never stored (only the style bundle it seeded), so this reads the line back:
 * the last preset whose own arrow/marker/showDistance the line still carries wins. `dashed` is
 * deliberately NOT part of the match — Freihand doesn't own it and the dock toggles it freely, so
 * matching on it would rename a Rettungsachse the moment somebody made it solid.
 *
 * Returns undefined for the fallback preset (Freihand) and for an operator-styled one-off: both
 * are just «Zeichnung», and a row that guessed a name for them would be worse than the kind.
 * Used by the Verlauf rows (lib/drawingEdit · drawingLogName), so Lage and Plan name a line alike.
 */
export function linePresetLabel(d: Pick<LinePresetFields, 'arrow' | 'marker' | 'showDistance'>): string | undefined {
  const presets = appConfig.drawing.linePresets
  let label: string | undefined
  for (const p of presets.slice(1)) { // [0] is the fallback — its "defaults" are the absence of any
    const want = resolveLinePreset(p.id)
    const owns = (['arrow', 'marker', 'showDistance'] as const).filter((k) => want[k] !== undefined)
    if (owns.length && owns.every((k) => d[k] === want[k])) label = p.label
  }
  return label
}

/** The colour a line, Fläche or Form is born with when nothing picked one for it.
 *
 *  ⚠️ A literal, deliberately NOT `var(--blue)`: this is DATA. It is written into the synced
 *  workspace, printed on paper and re-read years later, so it must not change when the theme,
 *  the station accent or the day/night flip does — a shape drawn at 3am in night mode has to
 *  come back the same colour on the Rapport. It happens to equal the light-theme `--blue`
 *  (01-tokens.css); the chrome around it follows the token, this does not. */
export const DEFAULT_INK = '#1f6feb'

/** Repeated inline marker (e.g. —R— on a Rettungsachse): how far apart, in screen/board px, the
 *  letters are dropped along the polyline. Identical rhythm on both surfaces. */
export const MARKER_SPACING_PX = 46

/** How far past an open end the «Verlängern» arrow tip sits — and therefore how far ONE tap on it
 *  grows the line. Screen px on the map, board px on the plan; both surfaces read this one number. */
export const EXTEND_STEP_PX = 46

/** How many node handles a shape may show AT ONCE. Not a limit on how many points a line may
 *  have — a 66-point freehand stroke keeps all 66 — but on how many pads are on screen competing
 *  for the same finger. Shared so the map and the plan cut over at the same size. */
export const MAX_VERTEX_HANDLES = 28

/** Minimum screen (map) / board (plan) px between two shown handles. Two pads closer than this
 *  cannot be told apart with a glove on, so the denser one is not offered. */
export const HANDLE_MIN_SPACING_PX = 26

/** `count` indices spread evenly over `n` points, both ends always included. The fallback for
 *  when there is no pixel geometry to measure against yet (the map still initialising). */
export function evenIndices(n: number, count = MAX_VERTEX_HANDLES): number[] {
  if (n <= 0) return []
  if (n <= count || count < 2) return Array.from({ length: n }, (_, i) => i)
  const out: number[] = []
  for (let k = 0; k < count; k++) {
    const i = Math.round((k * (n - 1)) / (count - 1))
    if (out[out.length - 1] !== i) out.push(i)
  }
  return out
}

/**
 * Which vertices of a polyline get an on-canvas edit handle, given the path in PIXEL space
 * (projected screen px on the map, board px on the plan).
 *
 * ⚠️ Until 25.08. a line above `MAX_VERTEX_HANDLES` points showed NO handles at all — a 66-point
 * freehand «Zeichnung» could be moved, rotated and deleted, but not reshaped, and nothing on
 * screen said why. That is the wrong end of the trade: the cap exists because pads pile up on
 * each other, not because the operator stopped needing the line.
 *
 * So the cap degrades instead of switching off. Handles are thinned by SCREEN distance — a node
 * closer than `minSpacingPx` to the last one shown is skipped — and the survivors are capped at
 * `budget`. Both ends always keep a handle. Because the spacing is measured in the CURRENT
 * projection, zooming in spreads the nodes apart and more of them earn a pad, until at close
 * range every point is grabbable again; zooming out collapses them back. That is the same
 * bargain the map already makes with labels: show what can be aimed at, here and now.
 *
 * Returns indices into `px`, ascending. `px.length <= budget` short-circuits to all of them, so
 * an ordinary node line is untouched by any of this.
 */
export function vertexHandleIndices(px: [number, number][], budget = MAX_VERTEX_HANDLES, minSpacingPx = HANDLE_MIN_SPACING_PX): number[] {
  const n = px.length
  if (n <= budget || budget < 2) return Array.from({ length: n }, (_, i) => i)
  const keep: number[] = [0]
  for (let i = 1; i < n - 1; i++) {
    const [ax, ay] = px[keep[keep.length - 1]]
    if (Math.hypot(px[i][0] - ax, px[i][1] - ay) >= minSpacingPx) keep.push(i)
  }
  keep.push(n - 1)
  if (keep.length <= budget) return keep
  // still too dense (a long line at low zoom): thin the survivors evenly, ends included
  return evenIndices(keep.length, budget).map((k) => keep[k])
}

/**
 * A repeated marker that is a SHAPE rather than a letter — the FKS chains.
 *
 * The Vegetationsbrand-Handbuch draws a Haltelinie as a row of filled triangles standing on the
 * line and a Wasserabwurfzone as a row of overlapping circles (S. 52, in use on S. 53). Both are
 * the same mechanism the «—R—» Rettungsachse already uses — repeat something along the polyline —
 * so they are markers, not stamps: one object that reshapes, moves and deletes as a line.
 *
 * Keyed by the character the marker field holds, so the stored value still SAYS what it is and a
 * renderer that does not know the glyph falls back to drawing that character. `marker` stays one
 * free-text field (DrawEditor), and a letter behaves exactly as before.
 */
export interface LineMarkerGlyph {
  /** on-screen box of one glyph, px */
  size: number
  /** distance between repeats, px — the chain's own rhythm, not the letter rhythm */
  spacing: number
  /** path in a −1…1 box, drawn in the line's colour */
  path: string
  fill: boolean
  /** turn with the line. The Haltelinie's teeth stand ON it; the Abwurfzone's circles don't care. */
  rotate: boolean
}

export const MARKER_GLYPHS: Record<string, LineMarkerGlyph> = {
  // Haltelinie — a saw edge, in both directions.
  //
  // ⚠️ The triangle's BASE sits at y=0 in its own box, not its centre: rotated by the segment's
  // bearing that lands the base exactly ON the line, teeth to one side, with the line itself
  // still visible. Centring it instead buries the line inside the teeth.
  //
  // Which side matters operationally — the teeth face the fire — and it cannot be derived from
  // the geometry, because a line drawn left-to-right and the same line drawn right-to-left are
  // the same Haltelinie. So it is two styles the operator picks between, not a flag hidden
  // behind a second tap (decision 01.09.).
  // ⚠️ `spacing` is the tooth's own BASE width, so consecutive teeth touch and the chain reads as
  // ONE saw edge rather than a row of separate triangles with the line showing between them
  // (01.09.). Base = 2 × 0.62 of a 2.3-unit box at `size` px ⇒ 16.2 at size 30; 15 leaves a hair
  // of overlap so a rounded join can never open a gap. Keep the two in step when resizing.
  '▲': { size: 30, spacing: 15, path: 'M -0.62 0 L 0 -1.05 L 0.62 0 Z', fill: true, rotate: true },
  '▼': { size: 30, spacing: 15, path: 'M -0.62 0 L 0 1.05 L 0.62 0 Z', fill: true, rotate: true },
  // Wasserabwurfzone — a chain of rings threaded ON the line, so the line reads through them.
  // Round, so it has no orientation to keep and turning it would only shimmer. Sized up a little
  // from the first cut, which vanished exactly where it is read: zoomed in on the drop run.
  '◯': { size: 29, spacing: 28, path: 'M 0 -0.86 A 0.86 0.86 0 1 1 -0.001 -0.86 Z', fill: false, rotate: false },
}

/** The glyph a marker names, or undefined for an ordinary letter. */
export const markerGlyph = (marker?: string): LineMarkerGlyph | undefined =>
  (marker ? MARKER_GLYPHS[marker] : undefined)

/** The rhythm this marker repeats at — its glyph's own, else the letter spacing once per
 *  character: a «WT» at the one-letter rhythm left barely a letter's gap between repeats and read
 *  as a dotted band (Manuel 09.11.2026); «R» keeps its 46 px. Both surfaces read this one number. */
export const markerSpacing = (marker?: string): number =>
  markerGlyph(marker)?.spacing ?? MARKER_SPACING_PX * Math.max(1, [...(marker ?? '')].length)

/** Walk a polyline given in PIXEL space and return a parametric position `{seg, t, deg}` every
 *  `spacing` px (seg = segment start index, t = 0..1 along it, deg = that segment's screen
 *  bearing, for a glyph that stands on the line). The caller lerps its OWN coordinate list by
 *  `{seg, t}` — so the map feeds projected screen px and back-projects to lng/lat, while the plan
 *  feeds board px and lerps normalized board coords. One algorithm, both surfaces. */
export function markerParamsAlong(px: [number, number][], spacing = MARKER_SPACING_PX): { seg: number; t: number; deg: number }[] {
  const out: { seg: number; t: number; deg: number }[] = []
  let carry = spacing / 2 // start half a step in, so letters don't pile on the first vertex
  for (let i = 1; i < px.length; i++) {
    const [ax, ay] = px[i - 1], [bx, by] = px[i]
    const segLen = Math.hypot(bx - ax, by - ay)
    if (segLen < 1e-3) continue
    // screen bearing of THIS segment — the same for every glyph dropped on it, so a chain reads
    // as one saw edge and only turns where the line does.
    const deg = (Math.atan2(by - ay, bx - ax) * 180) / Math.PI
    while (carry <= segLen) { out.push({ seg: i - 1, t: carry / segLen, deg }); carry += spacing }
    carry -= segLen
  }
  return out
}

/** Lerp between two same-length coordinate tuples by `t` (used to turn a `{seg, t}` back into a
 *  point in whichever space the caller's coords live in). */
export function lerpPoint<T extends number[]>(a: T, b: T, t: number): T {
  return a.map((v, i) => v + (b[i] - v) * t) as T
}

/** Ramer–Douglas–Peucker: indices of the points to KEEP (always first + last) so the polyline stays
 *  within `epsilon` of the original. Used to thin a raw freehand stroke — which captures one point
 *  per pointer event, piling up clusters wherever the finger paused (typically the start/end) — into
 *  a clean, editable handful of nodes. `pts` + `epsilon` are in the SAME space (feed pixels). */
export function rdpIndices(pts: [number, number][], epsilon: number): number[] {
  if (pts.length <= 2) return pts.map((_, i) => i)
  const keep = new Array(pts.length).fill(false)
  keep[0] = keep[pts.length - 1] = true
  const stack: [number, number][] = [[0, pts.length - 1]]
  while (stack.length) {
    const [s, e] = stack.pop()!
    const [ax, ay] = pts[s], [bx, by] = pts[e]
    const dx = bx - ax, dy = by - ay
    const len2 = dx * dx + dy * dy || 1e-12
    let maxD = 0, idx = -1
    for (let i = s + 1; i < e; i++) {
      const [px, py] = pts[i]
      const t = Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / len2))
      const d = Math.hypot(px - (ax + t * dx), py - (ay + t * dy))
      if (d > maxD) { maxD = d; idx = i }
    }
    if (maxD > epsilon && idx > 0) { keep[idx] = true; stack.push([s, idx], [idx, e]) }
  }
  const out: number[] = []
  for (let i = 0; i < pts.length; i++) if (keep[i]) out.push(i)
  return out
}

/**
 * ── Abheben ist der Rückzieher ────────────────────────────────────────────────────────────────
 * How far a freehand stroke must actually travel from where it started, in screen (map) / board
 * (plan) px, before it counts as a LINE rather than a tap.
 *
 * ⚠️ This is the ONLY way out of a stroke that began on a target. Since the snapping model of
 * 25.08. a pointerdown inside a target's radius arms the start attachment INSTANTLY (the aim is
 * deliberate — see lineAttachments · armDwell), and from there any movement draws. So lifting off
 * has to be the cancel, and it has to leave nothing at all behind: no line, no attachment, no
 * Verlauf row. 12 px sits just above the 8–10 px the two surfaces already treat as «did not move».
 */
export const MIN_STROKE_PX = 12

/** Was that a tap rather than a stroke? Measured as the greatest distance the path ever reached
 *  from its own first point — a finger that wobbled in place has travelled some total distance but
 *  has been nowhere. `px` is the RAW stroke in pixel space. */
export function isTapStroke(px: [number, number][], minPx = MIN_STROKE_PX): boolean {
  if (px.length < 2) return true
  const [x0, y0] = px[0]
  for (let i = 1; i < px.length; i++) if (Math.hypot(px[i][0] - x0, px[i][1] - y0) >= minPx) return false
  return true
}

/** px tolerance for freehand simplification — how far the thinned line may stray from the raw stroke
 *  (≈ this many screen px). Tuned so a hand-drawn line keeps its shape but lands a editable node count. */
export const FREEHAND_SIMPLIFY_PX = 3.5

/** The point `dist` px back from the END of a pixel polyline — used to derive a STABLE arrowhead
 *  bearing. The final captured segment of a freehand stroke is tiny and jittery, so pointing the
 *  arrow along just the last segment makes it wobble/skew; sampling a fixed distance back gives the
 *  stroke's actual approach direction. Falls back to the first point for a very short line. */
export function lookbackPoint(px: readonly (readonly [number, number])[], dist: number): [number, number] {
  let acc = 0
  for (let i = px.length - 1; i > 0; i--) {
    const a = px[i], b = px[i - 1]
    const seg = Math.hypot(a[0] - b[0], a[1] - b[1])
    if (acc + seg >= dist) { const t = (dist - acc) / seg; return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t] }
    acc += seg
  }
  return [px[0][0], px[0][1]]
}

/**
 * Which vertex indices of a selected line carry an ARROWHEAD, and therefore get drawn as a hollow
 * ring instead of a white-filled dot (decision 18.09.2026).
 *
 * The node dot is the last thing painted at an end (a DOM marker on the Karte, z 7 on the Plan),
 * so a 24px white disc sat exactly on top of the spitze and swallowed it — the operator selected
 * a Pfeil and the pfeil disappeared. Hollowing the ring gives the head its own tip and flanks back
 * while the grip keeps its geometry: same 24px, same 3px `--blue` ring, same 44px hit pad.
 *
 * The rule mirrors what the two renderers actually draw a head for (MapView · `arrowFeats`,
 * Whiteboard · `a.arrow &&`): the END vertex only, an `arrow` line only, never a closed `area`,
 * and never a line too short to have a bearing. It is ONE function so the two surfaces cannot
 * disagree about which node is hollow — the Lage↔Plan parity rule applied to edit chrome.
 */
export function arrowEndIndices(d: { kind?: string; arrow?: boolean }, pointCount: number): number[] {
  if (!d.arrow || d.kind === 'area' || pointCount < 2) return []
  return [pointCount - 1]
}
