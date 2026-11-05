/*
 * **The keyboard, on iOS (30.09.2026, owner: «this strange» / «check this strange gap»).** iOS
 * pans the visual viewport by `offsetTop` to reveal a caret; everything `position: fixed` is laid
 * out in the LAYOUT viewport. So ONE hook publishes the visible band (`lib/useViewportPan`):
 * `--vv-pan` (its top) and `--vv-foot` (the layout viewport's hidden foot = the keyboard LESS the
 * pan, `keyboardFootNow`), plus `html[data-kb]` while a keyboard is up — per frame, never a
 * render. A bottom sheet's LIFT is `--vv-foot` (`keyboardLift` / `keyboardMargin`), its height
 * CAP the whole keyboard (`--kb-inset`, `--jc-kb`): lifting by the keyboard stood the sheet the
 * pan above the keys, capping by the foot hides the caret (the pan/re-aim loop) — never mix the
 * two numbers up. A frame anchored at the TOP while the keyboard is up (`.is-kb` rides, the phone
 * Trupp sheet, the tablet composer and Verlauf) adds `--vv-pan` to its `top`. A page
 * (`Surface.module.css · .shell`) ends one `--float-gap` above the higher of the bars (their
 * reserve less the pan — they ride down behind the keys) and the keyboard (`--vv-foot`); its TOP
 * stays put and slides under the pinned top bar, whose `::before` covers the strip above it as
 * tall as the pan. Never translate the box that holds the caret. The Eintrag FAB is hidden while
 * `data-kb` (a running recording excepted). On the phone Verlauf the home-indicator inset + 16px
 * is `.history-list`'s padding, not the drawer's, so rows scroll to the sheet's edge («there is
 * a gap at the bottom where things don't scroll down below»).
 */

import { useEffect } from 'react'
import { keyboardFootNow, keyboardInsetNow } from './useKeyboardInset'

/**
 * Pins the app's chrome to the SCREEN while iOS pans the page under a keyboard.
 *
 * The document itself can no longer scroll (02-base.css · `body { position: fixed }`), which is
 * what stopped the whole app being draggable and stopped `position: fixed` chrome riding up with
 * a focus scroll. What is left is the VISUAL viewport: to keep a focused field above the
 * keyboard iOS pans it, and everything laid out in the layout viewport — which is all of the
 * chrome — appears to slide up with it. A native app's top bar and tab bar do not travel; they
 * stay put and let the keyboard cover what it covers.
 *
 * `visualViewport.offsetTop` is exactly how far that pan has gone, so writing it to `--vv-pan`
 * lets the two bars translate straight back down to where they belong (see 15-mobile.css).
 *
 * ⚠️ CHROME ONLY, never the content. Counter-translating the box that CONTAINS the caret is the
 * feedback loop this app has already been bitten by (see useKeyboardInset): the field moves back
 * under the keyboard, iOS pans further to reveal it, which moves it again. The top bar and the
 * nav rail hold no text field, so moving them cannot make iOS re-aim.
 *
 * ⚠️ Written to the documentElement rather than returned as state. The pan updates continuously
 * while iOS animates, and a per-frame React re-render of the whole workspace is the shape of the
 * battery bug this app has had once already (the media-queue commit storm). A CSS custom property
 * moves the bars on the compositor and costs no render at all.
 *
 * …and the BOTTOM of the visible band, as `--vv-foot` (30.09.2026, staging phone pass: «this
 * strange» — the Rapport ended ~115px above the keys, the Trupp sheet stood off them). Everything
 * placed from the layout viewport's bottom needs it once iOS pans: the keyboard's height alone
 * (`innerHeight − vv.height`) ignores the pan, so a sheet lifted by it floated `offsetTop` above
 * the keys, and a page that kept its reserve for the bars — which this hook sends down behind the
 * keyboard — ended that reserve plus the pan above them. `keyboardFootNow` is the keyboard less
 * the pan; sheets stand on it (keyboardLift), pages end on it (Surface.module.css · .shell), and
 * `data-kb` on the root says a keyboard is up at all (15-mobile.css). The same one write per
 * frame, never a render.
 */
export function useViewportPan(): void {
  useEffect(() => {
    const vv = window.visualViewport
    if (!vv) return
    const root = document.documentElement
    const vk = (navigator as Navigator & { virtualKeyboard?: EventTarget }).virtualKeyboard
    let frame = 0
    let last = -1
    let lastFoot = -1
    let lastKb: boolean | null = null
    const measure = () => {
      frame = 0
      // rounded: sub-pixel churn during the pan animation would rewrite the property on every
      // frame for a difference nobody can see
      const pan = Math.max(0, Math.round(vv.offsetTop))
      if (pan !== last) {
        last = pan
        root.style.setProperty('--vv-pan', `${pan}px`)
      }
      const foot = keyboardFootNow()
      if (foot !== lastFoot) {
        lastFoot = foot
        root.style.setProperty('--vv-foot', `${foot}px`)
      }
      // a keyboard is up whether or not the pan has swallowed its whole height (foot 0 with the
      // page panned by exactly the keyboard — CodeRabbit on #245), so ask the inset, not the foot
      const kb = keyboardInsetNow() > 0
      if (kb !== lastKb) {
        lastKb = kb
        root.toggleAttribute('data-kb', kb)
      }
    }
    const update = () => { if (!frame) frame = requestAnimationFrame(measure) }
    // the foot also depends on WHAT has focus (no caret, no keyboard — keyboardFootNow), and iOS
    // does not always fire a viewport event when a field lets go: ask again a beat later too
    let late: ReturnType<typeof setTimeout> | undefined
    const onFocus = () => { update(); clearTimeout(late); late = setTimeout(update, 300) }
    vv.addEventListener('resize', update)
    vv.addEventListener('scroll', update)
    vk?.addEventListener('geometrychange', update)
    window.addEventListener('focusin', onFocus)
    window.addEventListener('focusout', onFocus)
    update()
    return () => {
      if (frame) cancelAnimationFrame(frame)
      clearTimeout(late)
      vv.removeEventListener('resize', update)
      vv.removeEventListener('scroll', update)
      vk?.removeEventListener('geometrychange', update)
      window.removeEventListener('focusin', onFocus)
      window.removeEventListener('focusout', onFocus)
      root.style.removeProperty('--vv-pan')
      root.style.removeProperty('--vv-foot')
      root.removeAttribute('data-kb')
    }
  }, [])
}
