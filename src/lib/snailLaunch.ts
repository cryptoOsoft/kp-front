/**
 * One animation clock for the static boot cover and all pre-app React loading stages.
 * The cover sits OVER #root (index.html) and React mounts beneath it as soon as the boot is
 * ready; `liftBootCover` takes it away once its entrance has played and React shows the app
 * (08.11.2026 – before, React waited out the 630 ms entrance, then revealed its own splashes one
 * after another, and on the owner's iPhone one of those handovers replayed the entrance).
 * An automatic worker-update reload carries it through sessionStorage, written only as the
 * reload commits. index.html consumes that one-shot before paint and seeds this page's clock;
 * a surrendered reload retires it, and ordinary opens/reloads still show the entrance.
 * Keep its key/shape in sync with that script.
 */
let startedAt: number | undefined
const RESUME_KEY = 'kp-snail-resume'

/** Preserve the visible launch through an automatic update, including its reload watchdog. */
export function rememberSnailLaunch() {
  try {
    const svg = document.querySelector('.boot-splash .firefighter-snail')
    if (startedAt === undefined && !svg) return
    const time = startedAt === undefined && svg ? elapsed(svg, false) : Math.max(0, performance.now() - (startedAt ?? 0))
    sessionStorage.setItem(RESUME_KEY, JSON.stringify({ at: Date.now(), elapsed: time }))
  } catch { /* storage unavailable — the update must still proceed */ }
}

/** A browser that swallowed the reload must not affect a later deliberate one. */
export function forgetSnailLaunch() {
  try { sessionStorage.removeItem(RESUME_KEY) } catch { /* storage unavailable */ }
}

function arrival(svg: Element) {
  return svg.getAnimations?.().find(animation => (animation as CSSAnimation).animationName?.endsWith('-arrival'))
}

function duration(svg: Element) {
  // The bundled SVG owns this value, in milliseconds, along with the keyframes it times.
  return Number.parseFloat(getComputedStyle(svg).getPropertyValue('--snail-arrival-duration')) || 0
}

/** The launch clock: the shell loop keeps the full launch time, including its initial delay,
 * while an ended one-shot's clock stops at 630 ms, so a slow boot must read the loop. */
function launchClock(svg: Element) {
  return svg.getAnimations?.({ subtree: true }).find(animation => (animation as CSSAnimation).animationName?.endsWith('-shell')) ?? arrival(svg)
}

/** Time since the launch clock's zero. `settle` fixes that zero for every later loader. */
function elapsed(svg: Element, settle = true) {
  let start = startedAt
  if (start === undefined) {
    // While the static cover is up it owns the clock: a React loader mounted beneath it continues
    // the cover's, not the fresh one it just started.
    const source = document.querySelector('.boot-splash .firefighter-snail') ?? svg
    // The static cover may already be continuing a previous page's clock via negative CSS
    // delays. Its new animation.startTime alone would lose that offset and replay in React.
    const resumed = Number(source.getAttribute('data-snail-offset'))
    const offset = Number.isFinite(resumed) ? Math.max(0, resumed) : 0
    const clock = launchClock(source)
    // ⚠️ The animation's `startTime`, not `now - currentTime`: `currentTime` is the clock of the
    // LAST frame and stands still until the next one, so on a loaded device that placed the zero
    // too late by however long the frame was overdue and React rewound its copy of the entrance
    // (609 ms instead of ≥ 630 ms at the handover, 08.10.2026). `startTime` shares
    // `performance.now()`'s origin and stays fixed once the animation runs. Only a launch without
    // one (no animation API, or still pending before its first frame) falls back.
    if (typeof clock?.startTime === 'number') start = clock.startTime
    else start = performance.now() - (typeof clock?.currentTime === 'number' ? clock.currentTime : 0)
    start -= offset
    // A pending animation gets its start time with a coming frame: settle only when asked – and
    // never on behalf of ANOTHER loader. React mounts beneath the cover, possibly before the
    // cover's first frame; settling then fixed the zero at React's mount, ahead of the cover's
    // real start, and the cover lifted ~60 ms short of its entrance (WebKit CI 08.11.2026).
    if ((settle && source === svg) || typeof clock?.startTime === 'number') startedAt = start
  }
  return Math.max(0, performance.now() - start)
}

/** How long the hold waits for the cover's first frame, the zero of the entrance's clock. A
 *  visible page renders long before this; it only bounds a renderer that sends no frames. */
export const FIRST_FRAME_MAX_MS = 1_000

/** The next frame, or `bound` ms, whichever comes first: a hidden document gets no rAF. */
function nextFrame(bound: number) {
  return new Promise<void>(resolve => {
    const timer = setTimeout(resolve, Math.max(0, bound))
    requestAnimationFrame(() => { clearTimeout(timer); resolve() })
  })
}

/** Keep the static cover until the entrance is visible in full, even on a cached launch.
 * Boot requests/chunks are already running; only React's replacement of the cover waits.
 * Reduced motion needs no hold, and missing/cancelled animations must never wedge startup. */
export async function waitForSnailArrival() {
  const svg = document.querySelector('.boot-splash .firefighter-snail')
  if (!svg || matchMedia('(prefers-reduced-motion: reduce)').matches) return
  // ⚠️ The entrance starts with the cover's FIRST FRAME, not when this runs. WebKit can hold
  // that frame back well past the boot work: CI 09.10.2026 (run 37929169733) asked for a frame
  // at 145 ms and got it at 290-440 ms, and until then the SVG had no animation at all. The old
  // 50 ms wait then timed the hold from «now» and React took the cover over 12-170 ms before the
  // skid ended (clock 459-618 of 630 ms). So wait for the arrival's start time, frame by frame:
  // after a frame without an arrival there is none to wait for (no CSS), and a renderer that
  // sends no frames is bounded. A hidden document gets no frames, so it keeps the short wait.
  if (document.visibilityState === 'hidden') await nextFrame(50)
  else {
    const deadline = performance.now() + FIRST_FRAME_MAX_MS
    let frames = 0
    while (performance.now() < deadline) {
      const clock = arrival(svg)
      if (typeof clock?.startTime === 'number' || (frames > 0 && !clock)) break
      await nextFrame(deadline - performance.now())
      frames++
    }
  }
  const remaining = Math.max(0, duration(svg) - elapsed(svg, false))
  if (!remaining) return void elapsed(svg)
  await new Promise<void>(resolve => {
    const timer = setTimeout(resolve, remaining + 50)
    const done = () => { clearTimeout(timer); resolve() }
    arrival(svg)?.finished.then(done, done)
  })
  // Fix the launch clock while the cover still exists: React's copy continues it.
  elapsed(svg)
}

/** Longest the cover stays up after its entrance while React is still on a loading stage of its
 *  own: past it the operator should read that stage (its status line, its «Neu laden» hint). */
export const COVER_HOLD_MAX_MS = 2_000
/** …and it lifts with the Einsatz cover's fade (lib/bootCover · BOOT_COVER_FADE_MS). */
const COVER_FADE_MS = 240

/**
 * Take the static boot cover away once (a) its entrance has played in full and (b) React shows
 * the app – something in `root` and no React splash left on screen – so a normal launch goes
 * from the cover straight to the app. A React splash still up `COVER_HOLD_MAX_MS` after the
 * entrance is revealed instead (it continues the cover's clock). Never lifts onto an empty
 * root: a boot wedged before React rendered keeps the cover and its 12 s hint.
 */
export async function liftBootCover(root: Element) {
  await waitForSnailArrival()
  const cover = document.querySelector('.boot-splash')
  if (!cover) return
  const arrivedAt = performance.now()
  await new Promise<void>(resolve => {
    const ready = () => root.childElementCount > 0 && (
      performance.now() - arrivedAt >= COVER_HOLD_MAX_MS
      || !document.querySelector('.splash:not(.boot-splash):not(.leaving)'))
    if (ready()) return resolve()
    const observer = new MutationObserver(check)
    const timer = setTimeout(check, COVER_HOLD_MAX_MS)
    function check() {
      if (!ready()) return
      observer.disconnect()
      clearTimeout(timer)
      resolve()
    }
    observer.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ['class'] })
  })
  cover.classList.add('leaving')
  const still = matchMedia('(prefers-reduced-motion: reduce)').matches
  setTimeout(() => cover.remove(), still ? 0 : COVER_FADE_MS)
}

/** Continue before paint so a remount cannot replay the entrance or reset the idle. */
export function continueSnailAnimation(svg: Element, idleOnly = false) {
  const time = idleOnly ? duration(svg) : elapsed(svg)
  svg.getAnimations?.({ subtree: true }).forEach(animation => { animation.currentTime = time })
}
