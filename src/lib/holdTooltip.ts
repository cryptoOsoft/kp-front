// The touch answer to the title-tooltip (28.08. field feedback, decision B of
// the Atemschutz head labelling mock): every icon-only button in the app already carries
// its word as `aria-label`/`title`, and on a mouse the hover tooltip shows it — but the primary
// devices are tablets, where `title` never appears and an untrained operator is left guessing
// what 👣 or 💧 does. Holding such a button ~350 ms now shows that word as a bubble (with the
// short arm buzz) and does NOT fire the action; releasing early taps as always.
//
// ONE document-level listener rather than a hook per button: the rule is app-wide by design
// («every icon-only button explains itself the same way»), and threading a hook through dozens
// of components would guarantee gaps exactly where nobody thought of it.
//
// What is eligible — decided at press time, from the DOM alone:
//  · a <button> (or role="button") whose accessible name lives ONLY in aria-label/title, i.e.
//    it renders no visible text — a labelled button already says its word;
//  · …or one marked `data-holdexplain`, whose visible content does not say what it does — a CODE
//    (the FKS letter chips: «S», «N», «G») or a PICTURE (the Abschluss endings, via Segmented ·
//    `explain`, where the drawing shows the arrow but not that a deleted Teilstück releases the
//    lines docked to it). Opt-in, so nothing becomes explainable by accident;
//  · not `[data-holdaction]`: controls whose press-and-hold IS a gesture of their own
//    (±steppers via useHoldRepeat, the Eintrag hold via useHoldEntry) opt out at the source;
//  · not a disclosure (`aria-expanded`: the ⓘ InfoToggle and DockInfo, a menu or a card toggle):
//    a TAP already opens what it explains, and DockInfo's label IS its help text – held, the same
//    words showed twice (owner, sweep 28.10.2026 #21);
//  · touch/pen presses only — the mouse keeps its native hover tooltip …
//
// …EXCEPT on `[data-holdexplain]`, which also answers a MOUSE hover with the same bubble (01.09.).
// Those controls are the ones whose visible text is a code — «S», «N», «G» — so the question they
// raise is identical whichever device is asking, and the native `title` was the wrong answer for
// it: it takes about a second, it cannot be styled, and on the letter chips it duplicated a bubble
// the tablet already had. They carry no `title` any more, so there is exactly one explanation.
//
// The suppressed tap: once the bubble has shown, the release must not also trigger the button —
// «I asked what it is» and «I did it» cannot be the same gesture. The click that follows
// pointerup is swallowed by a one-shot capture listener; Android's long-press contextmenu is
// suppressed for the same press. ⚠️ One-shot means THIS release only: a browser that sends no
// click after a long press would leave the blocker armed, so every new press disarms it first –
// the next real tap always acts (28.10.2026).

import { buzz } from './haptics'

// 350, not 500 (28.08. field feedback: «takes too long») — the same window the Eintrag hold
// (useHoldEntry · HOLD_MS) uses, so every still hold in the app answers on one beat.
const HOLD_MS = 350
const MOVE_TOL_PX = 8
const LINGER_MS = 1100
/** Mouse dwell before the same bubble appears on a coded chip. Shorter than the touch hold —
 *  a pointer resting on a control is already a question, where a finger might just be on its way. */
const HOVER_MS = 220

function labelOf(el: HTMLElement): string | null {
  const aria = el.getAttribute('aria-label') || el.getAttribute('title')
  if (!aria) return null
  // icon-only means no visible words of its own — an <svg> icon has no textContent.
  //
  // `data-holdexplain` is the opt-in for the other case: a control whose visible text is a CODE
  // rather than a word. An FKS letter chip says «N» — which is a full explanation to somebody who
  // has learned the sheet and nothing at all to anybody else, which is the exact gap this bubble
  // exists to close. A button with a real word still opts out, because it has already answered.
  if ((el.textContent ?? '').trim() !== '' && !el.hasAttribute('data-holdexplain')) return null
  return aria
}

function eligible(target: EventTarget | null): { el: HTMLElement; label: string } | null {
  if (!(target instanceof Element)) return null
  const el = target.closest<HTMLElement>('button, [role="button"]')
  if (!el || el.closest('[data-holdaction]') || el.hasAttribute('aria-expanded')) return null
  const label = labelOf(el)
  return label ? { el, label } : null
}

/** Paint the bubble above `el` (below it when there is no room), clamped into the viewport.
 *
 *  Exported because the hold-tooltip is not its only caller any more: the header's ↶ answers
 *  «Rückgängig: Kontakt Trupp 2» when it is HELD, and flashes the very same words when it is
 *  PRESSED (`undoFlash.ts`) – the promise and the confirmation have to look alike, or the second
 *  one reads as a different kind of message. */
export function showHoldBubble(el: HTMLElement, label: string): HTMLElement {
  const b = document.createElement('div')
  b.className = 'hold-tip'
  b.textContent = label
  b.setAttribute('role', 'tooltip')
  document.body.appendChild(b)
  const r = el.getBoundingClientRect()
  // above the button, clamped into the viewport; below it when there is no room above
  // ⚠️ Measured AFTER `text-wrap: balance` has settled the line break, so `bw` is the pill's real
  // width and not the pre-wrap one — clamping on a stale width is what would push it off-screen.
  const bw = b.getBoundingClientRect().width
  const left = Math.max(8, Math.min(window.innerWidth - bw - 8, r.left + r.width / 2 - bw / 2))
  const top = r.top - b.offsetHeight - 8
  b.style.left = `${Math.round(left)}px`
  b.style.top = `${Math.round(top >= 6 ? top : r.bottom + 8)}px`
  return b
}

/** Install the app-wide hold-tooltip listeners. Returns the uninstaller (for tests / HMR). */
export function installHoldTooltip(): () => void {
  let press: { el: HTMLElement; label: string; x: number; y: number; timer: number } | null = null
  let bubble: HTMLElement | null = null
  let bubbleFor: HTMLElement | null = null // set while the NEXT click must be swallowed
  let lingerTimer = 0

  const dropBubble = () => {
    if (lingerTimer) { clearTimeout(lingerTimer); lingerTimer = 0 }
    bubble?.remove()
    bubble = null
  }
  const cancelPress = () => {
    if (press) { clearTimeout(press.timer); press = null }
  }

  // ── mouse hover, for the coded chips only ──
  let hoverTimer = 0
  let hoverEl: HTMLElement | null = null
  const cancelHover = () => {
    if (hoverTimer) { clearTimeout(hoverTimer); hoverTimer = 0 }
    hoverEl = null
  }
  const onOver = (e: PointerEvent) => {
    if (e.pointerType !== 'mouse') return
    const hit = eligible(e.target)
    // opt-in only: an icon-only button keeps its native tooltip, which is what the mouse already
    // expects everywhere else in the app. Widening this is a one-word change if it is wanted.
    if (!hit || !hit.el.hasAttribute('data-holdexplain')) { if (hoverEl) { cancelHover(); dropBubble() } return }
    if (hit.el === hoverEl) return
    cancelHover()
    dropBubble()
    hoverEl = hit.el
    hoverTimer = window.setTimeout(() => { bubble = showHoldBubble(hit.el, hit.label) }, HOVER_MS)
  }
  const onOut = (e: PointerEvent) => {
    if (e.pointerType !== 'mouse' || !hoverEl) return
    if (e.relatedTarget instanceof Node && hoverEl.contains(e.relatedTarget)) return
    cancelHover()
    dropBubble()
  }

  const onDown = (e: PointerEvent) => {
    // a new press is a new gesture: the click of the last one has come (or never will)
    bubbleFor = null
    if (e.pointerType !== 'touch' && e.pointerType !== 'pen') return
    const hit = eligible(e.target)
    if (!hit) return
    dropBubble()
    const timer = window.setTimeout(() => {
      if (!press) return
      bubble = showHoldBubble(press.el, press.label)
      bubbleFor = press.el
      press = null
      buzz() // the hold latched into an answer — same cue as every other armed hold
    }, HOLD_MS)
    press = { ...hit, x: e.clientX, y: e.clientY, timer }
  }
  const onMove = (e: PointerEvent) => {
    if (press && Math.hypot(e.clientX - press.x, e.clientY - press.y) > MOVE_TOL_PX) cancelPress()
  }
  const onUp = () => {
    cancelPress()
    if (bubble) lingerTimer = window.setTimeout(dropBubble, LINGER_MS)
  }
  // the release after a shown bubble must not act — swallow exactly that one click
  const onClick = (e: MouseEvent) => {
    if (!bubbleFor) return
    if (e.target instanceof Element && bubbleFor.contains(e.target as Node)) {
      e.preventDefault()
      e.stopPropagation()
    }
    bubbleFor = null
  }
  // Android fires contextmenu on a long press — ours, here, is the tooltip
  const onContextMenu = (e: Event) => {
    if ((press || bubble) && eligible(e.target)) e.preventDefault()
  }

  document.addEventListener('pointerover', onOver, true)
  document.addEventListener('pointerout', onOut, true)
  document.addEventListener('pointerdown', onDown, true)
  document.addEventListener('pointermove', onMove, true)
  document.addEventListener('pointerup', onUp, true)
  document.addEventListener('pointercancel', onUp, true)
  document.addEventListener('click', onClick, true)
  document.addEventListener('contextmenu', onContextMenu, true)
  return () => {
    cancelPress(); cancelHover(); dropBubble(); bubbleFor = null
    document.removeEventListener('pointerover', onOver, true)
    document.removeEventListener('pointerout', onOut, true)
    document.removeEventListener('pointerdown', onDown, true)
    document.removeEventListener('pointermove', onMove, true)
    document.removeEventListener('pointerup', onUp, true)
    document.removeEventListener('pointercancel', onUp, true)
    document.removeEventListener('click', onClick, true)
    document.removeEventListener('contextmenu', onContextMenu, true)
  }
}
