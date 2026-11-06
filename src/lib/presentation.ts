// Präsentationsmodus – the pure half: where this device stands in a presentation (the follow
// state machine), the fading pointer rings and lines, fitting the presenter's section into
// another screen, the edge arrows, the send throttle and the small naming helpers.
// The hook that runs it is workspace/usePresentation; the server's broker is
// backend/app/presentation; the rules are in docs/presentation.md.
//
// Nothing here is synced or stored: a presentation is a live way of LOOKING at the Einsatz
// together, so none of it reaches the workspace, the Verlauf or IndexedDB.

import type { Out } from './api/wire'

export type PresentationState = Out<'PresentationState'>
export type PresentedView = Out<'PresentationView'>
export type PointerAt = Out<'PresentationPointerAt'>
export type StrokeData = Out<'PresentationStroke'>
export type Anchor = Out<'PresentationAnchor'>

// --- following ---------------------------------------------------------------------------

/**
 * This device's place in the presentation running on its Einsatz:
 *   none       – nothing running (no pill)
 *   presenting – this device presents («Du präsentierst · N folgen · Zeigen · Beenden»)
 *   invited    – somebody else presents, not joined («Bastian präsentiert · Folgen»)
 *   following  – joined and mirroring («Folgst Bastian · Zeigen · ✕»)
 *   detached   – joined, but panned or switched surface («Wieder folgen»)
 * `id` is the presentation it belongs to, so a new one (a takeover) starts over at `invited`.
 */
export interface Follow {
  kind: 'none' | 'presenting' | 'invited' | 'following' | 'detached'
  id: string | null
}

export type FollowEvent =
  /** a poll answered: what is running, and whether this device is its presenter */
  | { type: 'server'; id: string | null; mine: boolean }
  /** «Folgen» / «Wieder folgen» */
  | { type: 'follow' }
  /** ✕ on the follower pill */
  | { type: 'leave' }
  /** the follower panned, zoomed or switched surface by hand */
  | { type: 'moved' }

export const NOT_PRESENTING: Follow = { kind: 'none', id: null }

export function nextFollow(f: Follow, ev: FollowEvent): Follow {
  switch (ev.type) {
    case 'server':
      if (ev.id === null) return f.kind === 'none' ? f : NOT_PRESENTING
      if (ev.mine) return f.kind === 'presenting' && f.id === ev.id ? f : { kind: 'presenting', id: ev.id }
      // a new presentation, or this device's own was taken over: asked again, never auto-joined
      if (f.id !== ev.id || f.kind === 'presenting' || f.kind === 'none') return { kind: 'invited', id: ev.id }
      return f
    case 'follow':
      return f.kind === 'invited' || f.kind === 'detached' ? { ...f, kind: 'following' } : f
    case 'leave':
      return f.kind === 'following' || f.kind === 'detached' ? { ...f, kind: 'invited' } : f
    case 'moved':
      return f.kind === 'following' ? { ...f, kind: 'detached' } : f
  }
}

/** Joined the room (sends pointers, is counted, sees the others' rings). */
export const isJoined = (f: Follow) => f.kind === 'presenting' || f.kind === 'following' || f.kind === 'detached'

// --- pointer rings -----------------------------------------------------------------------

/** How long a ring stands before it is gone; the fade is the last part of it (CSS, 21-presentation). */
export const RING_MS = 4000
/** A person tapping fast leaves at most this many rings at once. */
const RINGS_PER_PERSON = 3

export interface Ring {
  key: string
  client: string
  name: string
  link: boolean
  at: PointerAt
  born: number
}

/** Add a pointer's ring (newest last) and drop what has faded. */
export function addRing(rings: readonly Ring[], ring: Ring, now: number): Ring[] {
  const live = liveRings(rings, now).filter((r) => r.key !== ring.key)
  const mine = live.filter((r) => r.client === ring.client)
  const drop = new Set(mine.slice(0, Math.max(0, mine.length - RINGS_PER_PERSON + 1)).map((r) => r.key))
  return [...live.filter((r) => !drop.has(r.key)), ring]
}

export function liveRings(rings: readonly Ring[], now: number): Ring[] {
  return rings.filter((r) => now - r.born < RING_MS)
}

/** A surface a ring or a line can stand on: the Karte, one plan (on the Tafel, its Skizze), or
 *  one Tafel form page. */
export type Where = { surface: 'map' } | { surface: 'plan'; planId: string; page?: string | null } | { surface: 'page'; planId: string; page: string }

function onSurface(at: { surface: string; plan_id: string | null; page: string | null }, where: Where): boolean {
  if (at.surface !== where.surface) return false
  if (where.surface === 'map') return true
  if (at.plan_id !== where.planId) return false
  return where.surface === 'page' ? at.page === where.page : at.page == null || where.page == null || at.page === where.page
}

/** The rings that belong on the Karte, on one plan, or on one Tafel form page. */
export function ringsOn(rings: readonly Ring[], where: Where): Ring[] {
  return rings.filter((r) => onSurface(r.at, where))
}

// --- lines («Zeigen»: press and drag) ----------------------------------------------------

/** A line in progress goes out at most this often (ms) – the whole line so far each time, so a
 *  follower sees it grow (≤ 4 updates a second) and one lost update loses nothing. */
export const STROKE_MS = 250
/** The server's cap (app/presentation · MAX_STROKE_POINTS); `capPoints` simplifies to fit. */
export const MAX_STROKE_POINTS = 120
/** A line whose finger never came up (the page went away mid-draw) is gone after this long. */
const STROKE_STALE_MS = 15_000
/** A person drawing fast keeps at most this many lines at once. */
const STROKES_PER_PERSON = 3

export interface Stroke {
  key: string
  client: string
  name: string
  link: boolean
  line: StrokeData
  /** the last update (ms) – a done line fades RING_MS from here, like a ring */
  born: number
}

const strokeLive = (s: Stroke, now: number) => now - s.born < (s.line.done ? RING_MS : STROKE_STALE_MS)

/** Put a line's newest update in place of its older one, and drop what has faded. */
export function addStroke(strokes: readonly Stroke[], stroke: Stroke, now: number): Stroke[] {
  const live = liveStrokes(strokes, now).filter((s) => s.key !== stroke.key)
  const mine = live.filter((s) => s.client === stroke.client)
  const drop = new Set(mine.slice(0, Math.max(0, mine.length - STROKES_PER_PERSON + 1)).map((s) => s.key))
  return [...live.filter((s) => !drop.has(s.key)), stroke]
}

export function liveStrokes(strokes: readonly Stroke[], now: number): Stroke[] {
  return strokes.filter((s) => strokeLive(s, now))
}

/** When the next of these lines fades (ms from `now`), or null when none will. */
export function nextFade(strokes: readonly Stroke[], now: number): number | null {
  const ends = strokes.map((s) => s.born + (s.line.done ? RING_MS : STROKE_STALE_MS) - now)
  return ends.length ? Math.max(50, Math.min(...ends)) : null
}

/** The lines that belong on the Karte, on one plan, or on one Tafel form page. */
export function strokesOn(strokes: readonly Stroke[], where: Where): Stroke[] {
  return strokes.filter((s) => onSurface(s.line, where))
}

type Point = readonly number[]

/** Distance of `p` from the segment a–b (any unit). */
function offSegment(p: Point, a: Point, b: Point): number {
  const dx = b[0] - a[0], dy = b[1] - a[1]
  const len = dx * dx + dy * dy
  const t = len ? Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / len)) : 0
  return Math.hypot(p[0] - a[0] - t * dx, p[1] - a[1] - t * dy)
}

/** Douglas–Peucker at `eps`: the points that carry the line's shape. */
function simplify(points: readonly Point[], eps: number): Point[] {
  if (points.length < 3) return [...points]
  const keep = new Uint8Array(points.length)
  keep[0] = keep[points.length - 1] = 1
  const stack: [number, number][] = [[0, points.length - 1]]
  for (let next = stack.pop(); next; next = stack.pop()) {
    const [i, j] = next
    let far = -1, at = -1
    for (let k = i + 1; k < j; k++) {
      const d = offSegment(points[k], points[i], points[j])
      if (d > far) { far = d; at = k }
    }
    if (at >= 0 && far > eps) { keep[at] = 1; stack.push([i, at], [at, j]) }
  }
  return points.filter((_, k) => keep[k])
}

/**
 * A drawn line in at most `max` points: as drawn while it fits, else simplified – the tolerance
 * starts at a thousandth of the line's extent and doubles until it fits, so a long scribble
 * keeps its shape and only loses the wiggles.
 */
export function capPoints(points: readonly Point[], max = MAX_STROKE_POINTS): [number, number][] {
  if (points.length <= max) return points.map(([a, b]): [number, number] => [a, b])
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity
  for (const [a, b] of points) { x0 = Math.min(x0, a); y0 = Math.min(y0, b); x1 = Math.max(x1, a); y1 = Math.max(y1, b) }
  let eps = Math.max(Math.hypot(x1 - x0, y1 - y0), 1e-9) / 1000
  let out = simplify(points, eps)
  while (out.length > max) { eps *= 2; out = simplify(points, eps) }
  return out.map(([a, b]): [number, number] => [a, b])
}

// --- fitting the presenter's section (owner pick 06.11.2026: «Fit + edge arrows») ---------

/** The zoom at which a follower's free area (`to`, px) holds the presenter's (`from`, px, at
 *  `zoom`) whole: a portrait phone following a laptop zooms out, a wall screen in. */
export function fitZoom(zoom: number, from: { w: number; h: number }, to: { w: number; h: number }): number {
  if (!(from.w > 0 && from.h > 0 && to.w > 0 && to.h > 0)) return zoom
  return zoom + Math.log2(Math.min(to.w / from.w, to.h / from.h))
}

/** The board scale («eingepasst» = 1) at which a follower's work area (`area`, px) shows the
 *  presenter's visible extent (`span`, in board units: 1 = the whole board, `fit` px wide/high). */
export function fitScale(span: { w: number; h: number }, area: { w: number; h: number }, fit: { w: number; h: number }): number | null {
  if (!(span.w > 0 && span.h > 0 && area.w > 0 && area.h > 0 && fit.w > 0 && fit.h > 0)) return null
  return Math.min(area.w / (fit.w * span.w), area.h / (fit.h * span.h))
}

/** A box in screen px. */
export interface Rect { left: number; top: number; right: number; bottom: number }

/**
 * The small named arrow for a ring or a line's tip that stands outside `view` (the follower's
 * free area): where on the edge it sits (inset by `inset`) and the angle it points at (deg, 0 =
 * right, clockwise). Null when the point is inside – it is drawn where it is.
 */
export function edgeArrow(pt: { x: number; y: number }, view: Rect, inset = 28): { x: number; y: number; angle: number } | null {
  if (pt.x >= view.left && pt.x <= view.right && pt.y >= view.top && pt.y <= view.bottom) return null
  const cx = (view.left + view.right) / 2, cy = (view.top + view.bottom) / 2
  const hw = Math.max(1, (view.right - view.left) / 2 - inset), hh = Math.max(1, (view.bottom - view.top) / 2 - inset)
  const dx = pt.x - cx, dy = pt.y - cy
  // along the ray from the centre to the point, to where it leaves the inset box
  const t = Math.min(hw / Math.max(Math.abs(dx), 1e-9), hh / Math.max(Math.abs(dy), 1e-9))
  return { x: cx + dx * t, y: cy + dy * t, angle: (Math.atan2(dy, dx) * 180) / Math.PI }
}

/** Where a ring's name tag stands: beside it on the right (the default) or left, lifted by `dy` px. */
export interface TagPlace { side: 'right' | 'left'; dy: number }

/** The geometry of a ring and its tag (components/Presentation, 08-toasts.css · .present-ring*):
 *  the circle's radius, the gap from the centre to the tag, the tag's height and an estimate of
 *  its width per character of 12.5px bold – generous, so an estimate never lets two tags touch. */
const RING_R = 22
const TAG_OFFSET = 28
const TAG_H = 24
const TAG_CHAR = 7.4
const TAG_PAD = 18
/** right, left, then a row down / up on either side, then further out */
const CANDIDATES: TagPlace[] = [0, 1, -1, 2, -2, 3, -3].flatMap((n) => [
  { side: 'right' as const, dy: n * (TAG_H + 2) }, { side: 'left' as const, dy: n * (TAG_H + 2) },
])

interface Box { x0: number; y0: number; x1: number; y1: number }
const hits = (a: Box, b: Box) => a.x0 < b.x1 && b.x0 < a.x1 && a.y0 < b.y1 && b.y0 < a.y1

/** The box a tag takes at `place` for a ring at (x, y) – exported for the test. */
export function tagBox(r: { x: number; y: number; label: string }, place: TagPlace): Box {
  const w = r.label.length * TAG_CHAR + TAG_PAD
  const y0 = r.y - TAG_H / 2 + place.dy
  return place.side === 'right'
    ? { x0: r.x + TAG_OFFSET, y0, x1: r.x + TAG_OFFSET + w, y1: y0 + TAG_H }
    : { x0: r.x - TAG_OFFSET - w, y0, x1: r.x - TAG_OFFSET, y1: y0 + TAG_H }
}

/**
 * Name tags that do not cover each other, nor another ring: two people pointing at the same
 * window put their rings a finger apart, and the second tag sat on the first («Sandra Meier ·
 * Link» half under «Führungsunterstützung»). Rings in screen px, OLDEST first: a ring keeps its
 * place when a newer one arrives – the newer one moves (right, left, a row down or up …).
 * When nothing is free, the default (right) stands.
 */
export function placeTags(rings: readonly { key: string; x: number; y: number; label: string }[]): Record<string, TagPlace> {
  const circles: Box[] = rings.map((r) => ({ x0: r.x - RING_R, y0: r.y - RING_R, x1: r.x + RING_R, y1: r.y + RING_R }))
  const taken: Box[] = []
  const out: Record<string, TagPlace> = {}
  rings.forEach((r, i) => {
    const free = (b: Box) => !taken.some((t) => hits(t, b)) && !circles.some((c, j) => j !== i && hits(c, b))
    const place = CANDIDATES.find((p) => free(tagBox(r, p))) ?? CANDIDATES[0]
    out[r.key] = place
    taken.push(tagBox(r, place))
  })
  return out
}

// --- sending -----------------------------------------------------------------------------

/**
 * Leading + trailing throttle for the presenter's view: the first change goes at once, then at
 * most one per `ms`, and the LAST one always goes (where the map came to rest). `cancel` drops a
 * pending trailing send (the presentation ended).
 */
export function throttle<T>(ms: number, send: (value: T) => void, now: () => number = Date.now) {
  let last = -Infinity
  let timer: ReturnType<typeof setTimeout> | null = null
  let pending: { value: T } | null = null
  const flush = () => {
    timer = null
    if (!pending) return
    const { value } = pending
    pending = null
    last = now()
    send(value)
  }
  return {
    push(value: T) {
      pending = { value }
      if (timer) return
      const wait = last + ms - now()
      if (wait <= 0) flush()
      else timer = setTimeout(flush, wait)
    },
    cancel() {
      if (timer) clearTimeout(timer)
      timer = null
      pending = null
    },
  }
}

// --- naming ------------------------------------------------------------------------------

/** «BA» for Bastian, «SM» for Sandra Meier – the avatar in the pill. */
export function initials(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean)
  if (words.length >= 2) return (words[0][0] + words[1][0]).toUpperCase()
  return (words[0] ?? '?').slice(0, 2).toUpperCase()
}

/** A person's ring and avatar colour (`--present-1` … `--present-6`): the presenter's is always
 *  the first (the pill's own magenta), everybody else's is stable for their client id. */
export function personTone(client: string, presenter: string | null | undefined): number {
  if (client === presenter) return 1
  let h = 0
  for (let i = 0; i < client.length; i++) h = (h * 31 + client.charCodeAt(i)) >>> 0
  return (h % 5) + 2
}
