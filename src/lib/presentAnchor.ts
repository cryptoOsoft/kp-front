// Präsentationsmodus (docs/presentation.md): a place in a SCROLLED surface – a Checkliste, a
// module, a Tafel form page, the Verlauf – that survives a different screen. Raw pixels do not:
// a phone reflows the same list three times as tall. So a place is an ELEMENT and a fraction of
// its box, found again on the other screen by the way down to it:
//   · a keyed step (`data-sec=front`) where the surface already renders an attribute that names
//     the element – a form section or box, a Verlauf row. Found anywhere below, so a different
//     layout around it (one column on a phone, two on a laptop) does not matter;
//   · a child index (`3`) below that, or from the scroller when nothing is keyed.
// `r` (the whole scroll's ratio) is the fallback where the way does not resolve.
//
// Used by workspace/usePresentation for the presenter's scroll (`topAnchor`), a follower's
// (`scrollToAnchor`), and the rings and lines on a Tafel form page (`anchorAt`, `anchorPoint`).
// The DOM is read, never written – except a follower's scrollTop.

import type { Anchor } from './presentation'

/** Attributes that name an element the same way on every device (rendered from data, never a
 *  React id): Tafel form sections/boxes (TafelFormPage), Verlauf rows (Journal). */
const KEYS = ['data-ev', 'data-box', 'data-sec', 'data-row'] as const
const MAX_STEPS = 32
/** The server's step pattern (api/presentation · _ANCHOR_STEP): a value it would refuse is not
 *  a key – the element is reached by index instead. */
const KEY_VALUE = /^[A-Za-z0-9_:.-]{1,80}$/
/** Descend from a block taller than this (px) to the row inside it at the top edge. */
const ROW_H = 96

const clamp01 = (v: number) => (Number.isFinite(v) ? Math.max(0, Math.min(1, v)) : 0)

function keyOf(el: Element): string | null {
  for (const k of KEYS) {
    const v = el.getAttribute(k)
    if (v && KEY_VALUE.test(v)) return `${k}=${v}`
  }
  return null
}

/** The way from `root` down to `el`: the nearest keyed ancestor (or `el` itself), then indices. */
export function pathTo(root: Element, el: Element): string[] {
  const steps: string[] = []
  let at: Element | null = el
  while (at && at !== root && root.contains(at)) {
    const key = keyOf(at)
    if (key) { steps.unshift(key); break }
    const parent: Element | null = at.parentElement
    if (!parent) break
    steps.unshift(String(Array.prototype.indexOf.call(parent.children, at)))
    at = parent
  }
  return steps.slice(0, MAX_STEPS)
}

/** How far a path resolves below `root`: the deepest element reached, and whether it is the one
 *  named. A keyed step is matched on the attribute's value by walking (no selector: the value is
 *  data, and jsdom has no `CSS.escape` – see Journal · findRow). A phone renders fewer ruled rows
 *  in a Tafel table than a laptop, so a path that ends in a row the phone lacks still lands in
 *  its table – near, not lost. */
export function resolveDeepest(root: Element, path: readonly string[]): { el: Element; exact: boolean } {
  let at: Element = root
  for (const step of path) {
    const eq = step.indexOf('=')
    let next: Element | null = null
    if (eq > 0) {
      const attr = step.slice(0, eq), value = step.slice(eq + 1)
      for (const c of at.querySelectorAll(`[${attr}]`)) if (c.getAttribute(attr) === value) { next = c; break }
    } else {
      next = at.children[Number(step)] ?? null
    }
    if (!next) return { el: at, exact: false }
    at = next
  }
  return { el: at, exact: true }
}

/** The element a path names below `root`, or null where it does not resolve all the way. */
export function resolvePath(root: Element, path: readonly string[]): Element | null {
  const hit = resolveDeepest(root, path)
  return hit.exact ? hit.el : null
}

/** The place under a client point inside `root` (a tap or a line's start on a form page). */
export function anchorAt(root: Element, x: number, y: number, target: Element | null): Anchor {
  const el = target && root.contains(target) ? target : root
  const r = el.getBoundingClientRect()
  return { path: pathTo(root, el), x: clamp01((x - r.left) / (r.width || 1)), y: clamp01((y - r.top) / (r.height || 1)), r: scrollRatio(root) }
}

/** Where an anchored place is on this screen (client px): in the element it names, or – where
 *  this layout lacks it – at the same fractions of the deepest one that is there. Null when not
 *  even the first step resolves. */
export function anchorPoint(root: Element, a: Anchor): { x: number; y: number; w: number } | null {
  const { el } = resolveDeepest(root, a.path)
  if (el === root && a.path.length) return null
  const r = el.getBoundingClientRect()
  return { x: r.left + a.x * r.width, y: r.top + a.y * r.height, w: r.width }
}

function scrollRatio(el: Element): number {
  const room = el.scrollHeight - el.clientHeight
  return room > 0 ? clamp01(el.scrollTop / room) : 0
}

/** The element at the scroller's top edge: the first child reaching below the edge, descended
 *  while it is a tall block, so the place is a row and not «the whole list». */
function topElement(scroller: Element): Element {
  const top = scroller.getBoundingClientRect().top + 1
  let at: Element = scroller
  for (let depth = 0; depth < MAX_STEPS; depth++) {
    const next = [...at.children].find((c) => { const r = c.getBoundingClientRect(); return r.height > 0 && r.bottom > top })
    if (!next) break
    at = next
    if (next.getBoundingClientRect().height <= ROW_H) break
  }
  return at
}

/** Where `scroller` is scrolled to, as a place. */
export function topAnchor(scroller: Element): Anchor {
  const el = topElement(scroller)
  const top = scroller.getBoundingClientRect().top
  const r = el.getBoundingClientRect()
  return { path: el === scroller ? [] : pathTo(scroller, el), x: 0, y: clamp01((top - r.top) / (r.height || 1)), r: scrollRatio(scroller) }
}

/** Scroll `scroller` so the anchored place stands at its top edge – or, where this layout lacks
 *  the element, the top of the deepest one that is there; the scroll's ratio where not even the
 *  first step resolves. False unless the place itself was found – the caller tries again while
 *  the surface is still rendering. */
export function scrollToAnchor(scroller: HTMLElement, a: Anchor): boolean {
  const { el, exact } = resolveDeepest(scroller, a.path)
  if (el === scroller) {
    const room = scroller.scrollHeight - scroller.clientHeight
    if (room > 0) scroller.scrollTop = a.r * room
    return a.path.length === 0
  }
  const r = el.getBoundingClientRect()
  scroller.scrollTop += r.top + (exact ? a.y * r.height : 0) - scroller.getBoundingClientRect().top
  return exact
}

const SKIP = '.journal-drawer, .navrail, .tool-rail, .present-row, [role="dialog"]'

/** The surface's own scroller under `root`: the largest element that scrolls vertically – not the
 *  rail, the tool rail, a dialog or the Verlauf drawer (that one has its own anchor). */
export function findScroller(root: Element | null): HTMLElement | null {
  if (!root) return null
  let best: HTMLElement | null = null, area = 0
  for (const el of root.querySelectorAll<HTMLElement>('*')) {
    if (el.scrollHeight <= el.clientHeight + 4) continue
    const skip = el.closest(SKIP)
    if (skip && skip !== root && root.contains(skip)) continue
    const oy = getComputedStyle(el).overflowY
    if (oy !== 'auto' && oy !== 'scroll') continue
    const a = el.clientWidth * el.clientHeight
    if (a > area) { area = a; best = el }
  }
  return best
}
