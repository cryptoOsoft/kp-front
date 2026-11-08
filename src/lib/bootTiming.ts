// One log line per launch with the device's own boot timings, sent to `POST /api/diag/boot`
// (backend api/diag · report_boot). Added 08.11.2026 for «black screen for ~5 s before anything
// shows» in the installed iPhone app: the owner's screen recording showed ~4 s of black BEFORE the
// HTML's own splash painted, a window no desktop WebKit run reproduces – only the phone can say
// whether it is the service worker starting, the document arriving, or iOS itself.
//
// Every value is milliseconds since navigation start (performance.now()'s origin). iOS's own
// launch, before the navigation starts, is invisible to a page; the gap between a stopwatch and
// `fcp` is that part.
//
// main.tsx imports this module FIRST, so `entry` is the moment the bundle starts to evaluate.
// No imports on purpose: anything imported here would evaluate before that moment.

const marks: Record<string, number> = { entry: Math.round(performance.now()) }

/** Record a boot milestone (first call per name wins). */
export function markBoot(name: string): void {
  marks[name] ??= Math.round(performance.now())
}

/** milestones the browser already timed: navigation, the render-blocking stylesheet, first paint */
function browserMarks(): Record<string, number> {
  const out: Record<string, number> = {}
  const nav = performance.getEntriesByType('navigation')[0] as PerformanceNavigationTiming | undefined
  if (nav) {
    // workerStart is 0 when no service worker answered the navigation
    if (nav.workerStart > 0) out.ws = nav.workerStart
    out.rs = nav.responseStart
    out.re = nav.responseEnd
    out.di = nav.domInteractive
    out.dcl = nav.domContentLoadedEventEnd
  }
  const css = performance.getEntriesByType('resource')
    .find((r) => (r as PerformanceResourceTiming).initiatorType === 'link' && r.name.endsWith('.css'))
  if (css) out.css = (css as PerformanceResourceTiming).responseEnd
  const fcp = performance.getEntriesByName('first-contentful-paint')[0]
  if (fcp) out.fcp = fcp.startTime
  for (const k of Object.keys(out)) out[k] = Math.round(out[k])
  return out
}

/** Send the launch's line once the boot splash is gone (or after 30 s, whatever it shows then).
 *  `send` is the app's beacon, passed in so this module stays import-free. */
export function reportBoot(send: (body: unknown) => void, build: string): void {
  const flags = {
    // the page booted without a controlling worker: the document came from the network
    nosw: navigator.serviceWorker?.controller ? 0 : 1,
    // the boot cover continues a previous page's clock: this load IS an automatic update reload
    upd: document.querySelector('[data-snail-offset]') ? 1 : 0,
    hid: document.visibilityState === 'hidden' ? 1 : 0,
  }
  const standalone = window.matchMedia?.('(display-mode: standalone)').matches === true
    || (navigator as Navigator & { standalone?: boolean }).standalone === true
  let sent = false
  const finish = () => {
    if (sent) return
    sent = true
    observer.disconnect()
    clearTimeout(cap)
    const nav = (performance.getEntriesByType('navigation')[0] as PerformanceNavigationTiming | undefined)?.type ?? '?'
    send({ nav, build, standalone, marks: { ...browserMarks(), ...marks, ...flags } })
  }
  const lifted = () => {
    if (document.querySelector('.splash, .boot-splash')) return
    markBoot('lift')
    finish()
  }
  const observer = new MutationObserver(lifted)
  observer.observe(document.getElementById('root') ?? document.body, { childList: true, subtree: true })
  const cap = setTimeout(finish, 30_000)
}
