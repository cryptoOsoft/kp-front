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

// hidden at ANY point between the bundle starting and the line going out: such a launch's
// timings ran (partly) in the background and must not pass for a visible one
let wasHidden = document.visibilityState === 'hidden'
const onVisibility = () => { if (document.visibilityState === 'hidden') wasHidden = true }
document.addEventListener('visibilitychange', onVisibility)

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
  // the entry stylesheet (index.html's own link), not a lazy chunk's that loaded since
  const href = document.querySelector<HTMLLinkElement>('head link[rel="stylesheet"]')?.href
  const css = href ? performance.getEntriesByName(href)[0] as PerformanceResourceTiming | undefined : undefined
  if (css) out.css = css.responseEnd
  const fcp = performance.getEntriesByName('first-contentful-paint')[0]
  if (fcp) out.fcp = fcp.startTime
  for (const k of Object.keys(out)) out[k] = Math.round(out[k])
  return out
}

/** The worker's half (public/sw-boot-timing.js): `swe` when its script started evaluating
 *  (negative: it was already running), `swn` when this page's navigation reached it. Nothing
 *  without a controlling worker or an answer within 500 ms. */
function workerMarks(): Promise<Record<string, number>> {
  const worker = navigator.serviceWorker?.controller
  if (!worker) return Promise.resolve({})
  return new Promise((resolve) => {
    const channel = new MessageChannel()
    const timer = setTimeout(() => resolve({}), 500)
    channel.port1.onmessage = ({ data }: MessageEvent<{ evalAt?: number; navAt?: number }>) => {
      clearTimeout(timer)
      const out: Record<string, number> = {}
      if (typeof data?.evalAt === 'number') out.swe = Math.round(data.evalAt - performance.timeOrigin)
      if (typeof data?.navAt === 'number') out.swn = Math.round(data.navAt - performance.timeOrigin)
      resolve(out)
    }
    worker.postMessage({ type: 'kp-boot-timing' }, [channel.port2])
  })
}

/** Send the launch's line once the boot splash is gone (or after 30 s, whatever it shows then).
 *  `send` is the app's beacon, passed in so this module stays import-free. */
export function reportBoot(send: (body: unknown) => void, build: string): void {
  const flags = {
    // the page booted without a controlling worker: the document came from the network
    nosw: navigator.serviceWorker?.controller ? 0 : 1,
    // the boot cover continues a previous page's clock: this load IS an automatic update reload
    upd: document.querySelector('[data-snail-offset]') ? 1 : 0,
  }
  const standalone = window.matchMedia?.('(display-mode: standalone)').matches === true
    || (navigator as Navigator & { standalone?: boolean }).standalone === true
  let sent = false
  const finish = () => {
    if (sent) return
    sent = true
    observer.disconnect()
    clearTimeout(cap)
    document.removeEventListener('visibilitychange', onVisibility)
    const nav = (performance.getEntriesByType('navigation')[0] as PerformanceNavigationTiming | undefined)?.type ?? '?'
    void workerMarks().then((sw) => {
      send({ nav, build, standalone, marks: { ...browserMarks(), ...sw, ...marks, ...flags, hid: wasHidden ? 1 : 0 } })
    })
  }
  const lifted = () => {
    if (document.querySelector('.splash, .boot-splash')) return
    markBoot('lift')
    finish()
  }
  const observer = new MutationObserver(lifted)
  observer.observe(document.body, { childList: true, subtree: true })
  const cap = setTimeout(finish, 30_000)
}
