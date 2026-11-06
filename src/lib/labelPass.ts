/**
 * ONE arbitration pass over every label the Lage map wants to draw.
 *
 * Until now six independent loops each put their label where their own geometry pointed, and
 * none of them looked at the others. The only declutter was a switch — `captionMinZoom`, i.e.
 * "below z16 no captions, from z16 ALL of them". At z16 a 28px glyph covers ~45m of ground and
 * its 120px caption covers ~194m; a Zimmerbrand Schadenplatz is ~50m wide. So the switch turned
 * every name on at exactly the moment they all overlapped, and `text-overflow: ellipsis` was
 * the collision strategy. Both are gone.
 *
 * The replacement is variant A · **Verdrängen**: one fixed rank order, one AABB test per
 * candidate, and **nothing ever moves**. A label either stands exactly where it belongs or it is
 * not drawn at all — and not drawn means NOTHING drawn. No spiral search, no displacement, no
 * leader lines, and (since 23.08.) no stand-in mark either: a 6px dot was tried for half a day
 * and dropped, because its whole message was «something is hidden here», which zooming in already
 * answers — this pass decides by collision in SCREEN pixels, so symbols spread apart as the
 * operator goes in and the names come back by themselves.
 *
 * What makes that safe is the exemption: **the current selection is never suppressed**, and
 * everything else yields to it. Any hidden name is one tap from readable, and the label that
 * appears is guaranteed to sit on its true position — so belonging is never ambiguous.
 *
 * ⚠️ Everything here is SCREEN PIXELS. A decision taken in world coordinates that cleared at
 * z17 is covered again at z16; the pass has to be re-run per view, which is why the caller
 * feeds it projected boxes and re-runs on `moveend`.
 */

/** An axis-aligned box in map-container pixels. */
export type LabelBox = { x: number; y: number; w: number; h: number }

/**
 * The rank order. Lower wins, and it is deliberately **fixed, not configurable**: on a phone
 * there is barely any free space, so this order alone decides which names the operator sees,
 * and "the critical tag of an overdue Trupp beats a capacity readout" is doctrine, not taste.
 */
export const LABEL_RANK = {
  /** the selected object (and any hand-placed label) — exempt from suppression entirely */
  selected: 0,
  /** a Leitung's end tag whose Atemschutz-Trupp is due or overdue */
  criticalTag: 1,
  /** a Trupp's name on the map */
  team: 2,
  /** every other Leitung end tag */
  tag: 3,
  /** a symbol's metadata caption ("CO₂", "1200 l/min ab Weiher") */
  caption: 4,
  /** a drawn line's distance / free-text readout */
  readout: 5,
  /** an Absperrkreis radius */
  radius: 6,
  /** the time beside a Trupp's recorded position (its trail breadcrumbs). Last of all: it is
   *  history, and the newest crumb of each trail wins its own ties (04.11.2026 – before, every
   *  crumb printed its time and a busy trail stacked into one illegible pile). */
  crumb: 7,
} as const

export type LabelRank = (typeof LABEL_RANK)[keyof typeof LABEL_RANK]

export type LabelCandidate = {
  /** stable, family-prefixed key — `cap:<entityId>`, `dl:<drawingId>`, … */
  key: string
  rank: LabelRank
  /**
   * Hand-placed: the operator dragged this label to a georeferenced anchor (`d.labelAt` /
   * `d.endLabelAt`). A manual dodge already exists and it outranks the machine — a pinned
   * label is placed unconditionally and never suppressed, exactly like the selection.
   */
  pinned?: boolean
  /** the label's box at its ONLY position — the one its own geometry asks for */
  box: LabelBox
  /** tie-break inside a rank: px from the incident point. Never the placement order. */
  dist: number
}

/** Breathing room between two labels, in px — touching boxes read as one smear. */
const PAD = 2

/** Do two boxes collide, allowing `pad` px of mandatory clearance? */
export function boxesOverlap(a: LabelBox, b: LabelBox, pad = PAD): boolean {
  return !(a.x + a.w + pad <= b.x || b.x + b.w + pad <= a.x
    || a.y + a.h + pad <= b.y || b.y + b.h + pad <= a.y)
}

/**
 * Decide which labels are drawn and which degrade to a dot.
 *
 * `occupied` seeds the pass with everything a label may never cover — every visible glyph, so
 * a caption can't sit on a foreign symbol. The returned set holds the keys that must NOT be
 * drawn; their owners paint the 6px ink dot instead.
 */
export function placeLabels(candidates: readonly LabelCandidate[], occupied: readonly LabelBox[]): ReadonlySet<string> {
  // key as the last tie-break, so the outcome depends only on the data — never on the order
  // the six render loops happened to run in ("later-drawn wins" was exactly that bug).
  const order = [...candidates].sort((a, b) => (a.rank - b.rank) || (a.dist - b.dist) || (a.key < b.key ? -1 : a.key > b.key ? 1 : 0))
  const taken: LabelBox[] = [...occupied]
  const suppressed = new Set<string>()
  // Exempt first, so their boxes are already claimed when the contested ones are tested:
  // the selection and any hand-placed label are the two things the operator asked for by name.
  for (const c of order) {
    if (c.rank !== LABEL_RANK.selected && !c.pinned) continue
    taken.push(c.box)
  }
  for (const c of order) {
    if (c.rank === LABEL_RANK.selected || c.pinned) continue
    if (taken.some((t) => boxesOverlap(c.box, t))) { suppressed.add(c.key); continue }
    taken.push(c.box)
  }
  return suppressed
}

// ─── measuring a label without rendering it ────────────────────────────────────────────────
// The pass runs during render, before the labels exist in the DOM, so it cannot read
// offsetWidth. Text is measured on a canvas with the label's real font instead — synchronous,
// cheap and cached — and the box is that text plus the padding/border the CSS adds. The
// numbers below MIRROR the stylesheet; when a label's chrome changes, they change with it.

/** U+00AD — the soft hyphen `symbolWrap.ts` puts at German compound seams. */
const SOFT = '\u00AD'

export type MeasureText = (text: string, font: string) => number

let sharedCtx: CanvasRenderingContext2D | null | undefined

/**
 * Text width in px for a CSS `font` shorthand. Soft hyphens are stripped: they are invisible
 * unless the line actually breaks there, and `wrapLine` adds the visible hyphen's width itself.
 */
export const textWidth: MeasureText = (text, font) => {
  if (sharedCtx === undefined) sharedCtx = document.createElement('canvas').getContext('2d')
  const bare = text.replace(/\u00AD/g, '')
  // no 2d context (jsdom, a locked-down webview): fall back to a coarse per-character estimate
  // rather than throwing — a slightly wrong box is a slightly wrong declutter, not a blank map.
  if (!sharedCtx) return bare.length * 6.4
  if (sharedCtx.font !== font) sharedCtx.font = font
  return sharedCtx.measureText(bare).width
}

/** A break opportunity: after a space, or at a compound seam (which renders a visible hyphen). */
type Chunk = { text: string; seam: boolean }

function chunksOf(text: string): Chunk[] {
  const out: Chunk[] = []
  let cur = ''
  for (const ch of text) {
    if (ch === SOFT) { out.push({ text: cur, seam: true }); cur = ''; continue }
    cur += ch
    if (ch === ' ') { out.push({ text: cur, seam: false }); cur = '' }
  }
  if (cur) out.push({ text: cur, seam: false })
  return out
}

/**
 * Greedy line break at spaces and compound seams — the same breaks the browser makes with
 * `hyphens: manual` and the soft hyphens from `symbolWrap.ts`. Never breaks mid-component:
 * that is the whole reason `hyphens: auto` is banned («Kontrollpos-ten»).
 */
export function wrapLine(text: string, maxW: number, measure: (s: string) => number): string[] {
  const chunks = chunksOf(text)
  const lines: string[] = []
  let cur = ''
  let seam = false
  const flush = (hyphenate: boolean) => {
    const t = cur.replace(/ +$/, '')
    if (t) lines.push(hyphenate && seam ? `${t}-` : t)
    cur = ''
  }
  for (const c of chunks) {
    const grown = cur + c.text
    const rendered = grown.replace(/ +$/, '') + (c.seam ? '-' : '')
    if (cur && measure(rendered) > maxW) { flush(true); cur = c.text; seam = c.seam }
    else { cur = grown; seam = c.seam }
  }
  flush(false)
  return lines.length ? lines : ['']
}

/** The CSS chrome around a label's text, as the stylesheet writes it. */
export type LabelStyle = {
  /** CSS `font` shorthand, e.g. `'700 11.5px Sora, system-ui, sans-serif'` */
  font: string
  /** widest the TEXT may run before it wraps */
  maxTextW: number
  /** horizontal padding + border, both sides together */
  chromeW: number
  /** vertical padding + border, both sides together */
  chromeH: number
  /** one text line's height */
  lineH: number
}

/**
 * The on-screen box a label will occupy, measured from its text and its chrome. `text` may
 * carry `\n` (a multi-value caption) and soft hyphens (compound seams).
 */
const sizeCache = new Map<string, { w: number; h: number }>()

/**
 * `labelSize` with a session cache. The pass re-runs on every map render — including every
 * frame of a symbol drag — and a label's text almost never changes between them, so the
 * canvas measurement is done once per distinct string.
 */
export function cachedLabelSize(text: string, style: LabelStyle): { w: number; h: number } {
  const key = `${style.font}|${style.maxTextW}|${style.lineH}|${style.chromeW}|${style.chromeH}|${text}`
  const hit = sizeCache.get(key)
  if (hit) return hit
  const size = labelSize(text, style)
  if (sizeCache.size > 2000) sizeCache.clear() // a long incident types a lot of distinct labels
  sizeCache.set(key, size)
  return size
}

export function labelSize(text: string, style: LabelStyle, measure: MeasureText = textWidth): { w: number; h: number } {
  const m = (s: string) => measure(s, style.font)
  let w = 0
  let rows = 0
  for (const para of text.split('\n')) {
    for (const line of wrapLine(para, style.maxTextW, m)) { w = Math.max(w, m(line)); rows++ }
  }
  return { w: Math.ceil(w) + style.chromeW, h: Math.round(rows * style.lineH) + style.chromeH }
}

// ─── the pile: nearest centre, and the fan that opens it ───────────────────────────────────

export type PilePoint = { id: string; x: number; y: number; /** the marker's hit pad DIAMETER */ pad: number }

/**
 * Every marker whose fat-finger pad the tap landed in, **nearest centre first**.
 *
 * This replaces "later-drawn wins". Two symbols on a Schadenplatz are almost always closer
 * together than the 48px pad (39m of ground at z17, 78m at z16); both carry `zIndex: 6`, and
 * equal z-index falls back to DOM order — which is placement order, i.e. the alarm's history.
 * So tapping the Wasserbezugsort reliably handed you the Kleinlöscher you placed after it.
 * `09-whiteboard.css` already cured one instance of this by hand (the end tag gave up its
 * pointer events); resolving by distance generalises the cure instead of taking more away.
 */
export function pileAt(tap: { x: number; y: number }, points: readonly PilePoint[]): PilePoint[] {
  return points
    .filter((p) => Math.hypot(tap.x - p.x, tap.y - p.y) <= p.pad / 2)
    .sort((a, b) => Math.hypot(tap.x - a.x, tap.y - a.y) - Math.hypot(tap.x - b.x, tap.y - b.y))
}

/**
 * Spread a pile onto short spokes around its own centre of gravity, ordered by the angle each
 * member already sits at — so nothing crosses over and the direction information survives.
 * Returns the screen-px OFFSET each marker is drawn at; a hairline back to `0,0` (its true
 * position) is drawn inside the marker itself. Transient, on tap only: this is the one place
 * in the whole design where a leader line appears.
 */
export function fanOffsets(points: readonly PilePoint[]): Record<string, { dx: number; dy: number }> {
  if (points.length < 2) return {}
  const cx = points.reduce((s, p) => s + p.x, 0) / points.length
  const cy = points.reduce((s, p) => s + p.y, 0) / points.length
  const r = Math.max(34, points.length * 11)
  const ring = [...points].sort((a, b) => Math.atan2(a.y - cy, a.x - cx) - Math.atan2(b.y - cy, b.x - cx))
  const out: Record<string, { dx: number; dy: number }> = {}
  ring.forEach((p, i) => {
    const a = -Math.PI / 2 + (i / ring.length) * Math.PI * 2
    out[p.id] = { dx: Math.round(cx + Math.cos(a) * r - p.x), dy: Math.round(cy + Math.sin(a) * r - p.y) }
  })
  return out
}

// ─── who paints on top ─────────────────────────────────────────────────────────────────────

/**
 * The map's marker stacking order, in ONE place.
 *
 * Every MapLibre marker is its own stacking context (it carries a transform), so what is on top
 * is decided on the marker CONTAINER — a z-index inside a marker cannot lift it past a sibling.
 * That made the order easy to set in five different files and impossible to reason about, so it
 * lives here, next to the other overlap arbitration.
 *
 * The resting order is doctrine: a crew is the thing you must be able to see and hit, a label
 * about a hose is not — measured, the tag «1 · +2 · Müller H.» covered the Rettungstrupp, the
 * Einsatzort ring and two more symbols, and (being a drag handle) took their taps too.
 */
export const MARKER_Z = {
  /** a Leitung's end tag at rest — under everything tactical, and under its own line's decor */
  tag: 3,
  /** notes and photos: paper, not position */
  note: 4,
  /** shapes are metres across — they are the ground other things stand on */
  shape: 5,
  /** every placed symbol / vehicle / hydrant */
  symbol: 6,
  /** a Trupp: people outrank furniture */
  team: 8,
  /** the end tag of the SELECTED Leitung — then it is the handle you are working with */
  tagSelected: 9,
  /** whatever the operator just tapped or is dragging (see markerZ) */
  selected: 10,
  /** a fanned pile — transient, and it has to clear even the selection to be readable */
  fanned: 12,
} as const

/**
 * Where a marker paints, given what it is and what the operator is doing to it.
 *
 * **Selection lifts.** Resting order is placement-blind but static, so a symbol drawn under
 * another one stayed under it when tapped — the panel opened for something the operator could
 * not see. Selecting already exempts a label from suppression; it now also raises the marker
 * itself, for exactly as long as the selection lasts. A fanned pile still wins: its glyphs are
 * standing off their true positions on hairlines, and a spoke hidden behind a neighbour is
 * worse than useless.
 */
export function markerZ(kind: string, state: { selected?: boolean; fanned?: boolean } = {}): number {
  if (state.fanned) return MARKER_Z.fanned
  if (state.selected) return MARKER_Z.selected
  return kind === 'team' ? MARKER_Z.team
    : kind === 'note' || kind === 'photo' ? MARKER_Z.note
    : kind === 'shape' ? MARKER_Z.shape
    : MARKER_Z.symbol
}
