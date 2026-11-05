// Where ComboMenu's portalled menu stands: under its trigger, or above it when the screen has run
// out below. Pure, so the arithmetic is tested without a layout engine; ComboMenu reads the DOM
// (the trigger's rect, the visible viewport, a modal frame's scroll body) and hands the numbers in.
//
// The menu is portalled to <body> as `position: fixed`, so nothing clips it: the room it has is
// the SCREEN's, in both directions. It used to measure the room below against the nearest
// clipping ancestor, and the detail panel's `.ctx-body` sizes to its content — so a short
// Fahrzeug panel left ~150px «below» with the whole map free under it, and «Bezeichnung» opened
// upward or as a 140px sliver (owner, 05.11.2026). The one deliberate exception is `frameBottom`.

/** Where the portalled menu goes. Recomputed on scroll/resize while it is open. */
export interface MenuPos {
  left: number
  top: number
  width: number
  maxH: number
  up: boolean
  /** a DOWN menu sized by the room to the screen's own foot – no keyboard and no modal frame in
   *  between – where the home indicator sits: the style takes `env(safe-area-inset-bottom)` off
   *  `maxH` (CSS knows that inset, script does not) */
  footInset: boolean
}

/** What `placeComboMenu` measures against, in `position: fixed` px. */
export interface MenuRoom {
  trigger: { left: number; top: number; bottom: number; width: number }
  /** the visual viewport's top (iOS pans it while aiming a caret) */
  visTop: number
  /** where the usable screen ends – the keyboard's top edge while it is up
   *  (lib/useKeyboardInset · visibleViewportBottom) */
  visBottom: number
  /** the app's full height (lib/iosKeyboard · fullViewHeight); `visBottom` short of it means
   *  the keyboard is up, and the safe area is under the keys */
  viewH: number
  /** the trigger sits in a MODAL frame (a Sheet / Overlay popup): the bottom of the scroll body
   *  inside it, which a down menu may not pass – else null. A dropdown that ran past a short
   *  centred sheet's bottom edge into the backdrop read as broken chrome (05.09.2026). Above is
   *  never bounded by it: over the backdrop is where a menu from a sheet's first field belongs. */
  frameBottom: number | null
  /** the layout viewport's width */
  viewW: number
}

/** Ceiling for the portalled menu. Not a target — the menu takes whatever room the trigger
 *  actually has; this only stops it from becoming a curtain over the form it belongs to. ~9 name
 *  rows, which is enough that a Mannschaft rarely needs scrolling before the search narrows it.
 *  It used to be 252px in one copy and 280px in the other: on a full-height Rapport the roster
 *  then scrolled inside a short box with half the sheet empty underneath it. */
export const MAX_MENU_H = 440
/** Floor: two or three rows and a search box. Below this a menu is a sliver, not a list — so a
 *  DOWN menu is allowed to spend it even where the room is shorter, and an UP menu may not,
 *  because an up menu's overflow goes off the top of the screen. */
export const MIN_MENU_H = 140
/** Below this much room the menu considers opening upward instead. */
const ROOMY_BELOW = 200
/** Breathing room kept between the menu and whichever edge it is measured against. */
const EDGE = 12
/** Floor for the menu's WIDTH: what the search row needs to show its longest placeholder whole
 *  (fr «Rechercher une personne …», 228px of 16px Sora + 63px of icon, paddings and menu pad).
 *  The menu used to take exactly the trigger's width, and a narrow field cut its own search to
 *  «Suchen oder ei…» (owner, 30.10.2026) — the names under it ellipsed for the same reason. The
 *  menu grows to the right from the trigger's left edge and steps left only to stay on screen.
 *  ⚠️ A longer placeholder in any language needs this raised. */
const MIN_MENU_W = 300

/**
 * The menu's place for one measurement. Down unless the room below has run out AND the screen
 * genuinely offers more above, with enough of it to be a list. Both anchors leave the trigger
 * uncovered: an up menu ends 4px above `trigger.top`, a down one starts 4px below
 * `trigger.bottom` — so a picker whose trigger is itself a field stays reachable.
 */
export function placeComboMenu({ trigger: r, visTop, visBottom, viewH, frameBottom, viewW }: MenuRoom): MenuPos {
  const foot = Math.min(frameBottom ?? Infinity, visBottom)
  const below = foot - r.bottom - EDGE
  const above = r.top - Math.max(0, visTop) - EDGE
  const up = below < ROOMY_BELOW && above > below && above >= MIN_MENU_H
  // TAKE the room that is there; MAX_MENU_H only keeps the menu from becoming a curtain.
  // ⚠️ The MIN floor is for the DOWN case only — an up menu capped above its room would run its
  // top (where the search row sits) off the top of the screen.
  const maxH = up ? Math.min(MAX_MENU_H, above) : Math.min(MAX_MENU_H, Math.max(MIN_MENU_H, below))
  const footInset = !up && maxH < MAX_MENU_H && frameBottom === null && visBottom >= viewH - 1
  // never narrower than MIN_MENU_W (or the screen), never off its right edge
  const width = Math.max(r.width, Math.min(MIN_MENU_W, viewW - 2 * EDGE))
  const left = width > r.width ? Math.max(0, Math.min(r.left, viewW - EDGE - width)) : r.left
  return { left, top: up ? r.top : r.bottom, width, maxH, up, footInset }
}
