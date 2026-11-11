import { useEffect } from 'react'
import { isTypingTarget } from './hotkeys'
import { useKeyboardInset, visibleViewportBottom } from './useKeyboardInset'
import { inScrollPort } from './pointAtField'

/**
 * Keeps the FOCUSED text field above the on-screen keyboard, app-wide. Mounted once, at the
 * workspace root (IncidentWorkspace) — a keyboard is one thing per screen, so this is one
 * listener, not one per surface.
 *
 * Why the browser does not already do it: `body { position: fixed }` (02-base.css) leaves the
 * document with nothing to scroll, so Safari's native "reveal the caret" pass can only work
 * inside a NESTED scroller — and it gets exactly one shot, fired the moment the field takes
 * focus, i.e. while the keyboard is still sliding in and the geometry is still pre-shrink. On an
 * iPad the field it just "revealed" then ends up under the keys anyway.
 *
 * So there are two triggers, and the second one is the point:
 *   · `focusin` — covers moving between fields while the keyboard is already up, where the
 *     geometry is already correct;
 *   · a new non-zero `useKeyboardInset` value — re-aims at whatever is focused NOW, once the
 *     keyboard has actually settled and any React re-render it caused has landed.
 *
 * ⚠️ Both triggers go through the same OVERFLOW GUARD, and it is load-bearing: scroll only when
 * the field's box actually falls outside the visible band – or outside the box that scrolls it –
 * and then only by `block: 'nearest'`.
 * An unconditional `block: 'center'` re-enters the pan/re-aim feedback loop documented in
 * useKeyboardInset — we move the field, iOS pans to keep the caret visible, which moves the field
 * again. «Nearest» moves the minimum and stops; a field already on screen is left alone entirely.
 */
export function useScrollFocusIntoView(): void {
  // the committed inset — deadbanded and rAF-coalesced by the hook, so this effect re-runs
  // once per keyboard, not once per frame of its animation
  const inset = useKeyboardInset()
  useEffect(() => {
    let frame = 0
    const reveal = (el: Element | null) => {
      if (!isTypingTarget(el) || !(el instanceof HTMLElement)) return
      if (frame) cancelAnimationFrame(frame)
      // one frame late: on `focusin` the field's own surface may still be laying out (a sheet
      // that caps its height against `--kb-inset` re-renders in the same tick)
      frame = requestAnimationFrame(() => {
        frame = 0
        // getBoundingClientRect is in LAYOUT-viewport coordinates; `offsetTop` is how far the
        // visual viewport has been panned inside it, so the visible band starts there. Read only —
        // writing offsetTop into layout is the loop useViewportPan warns about.
        // ⚠️ The band's BOTTOM comes off `visibleViewportBottom` (occlusion sweep O4, 11.11.2026):
        // under Android's `overlays-content` the visual viewport never shrinks, only the
        // VirtualKeyboard API knows the keys, so every field «was visible» and stayed 55–190px
        // under them. And «inside the band» is not enough: the page shell ends on the keys
        // (`--vv-foot`), so a field can be cut by its own scroller while the band still has it.
        const top = window.visualViewport?.offsetTop ?? 0
        const box = el.getBoundingClientRect()
        if (box.bottom <= visibleViewportBottom() && box.top >= top && inScrollPort(el)) return
        el.scrollIntoView({ block: 'nearest' })
      })
    }
    const onFocusIn = (e: FocusEvent) => reveal(e.target as Element | null)
    document.addEventListener('focusin', onFocusIn)
    // the keyboard just opened (or grew): whatever is focused was measured against the OLD,
    // taller viewport, so give it a second look now that the real one is known
    if (inset > 0) reveal(document.activeElement)
    return () => {
      if (frame) cancelAnimationFrame(frame)
      document.removeEventListener('focusin', onFocusIn)
    }
  }, [inset])
}
