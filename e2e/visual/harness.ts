import { request as apiRequest, type Browser, type BrowserContext, type Page } from '@playwright/test'
import { buildingAlreadyRead, isolateFromOutside, retire, seedIncident, signIn, waitForWorkspace, POLL_MS, type Seeded } from '../perf/harness'

// The freezing half of the screenshot regression tests (e2e/screens.visual.ts,
// docs/testing/visual-regression.md). A screenshot test is only worth anything if the same
// build gives the same pixels on every run, so everything that is not the build is pinned here:
//
//   - the CLOCK: the page's `Date` is fixed at SHOT (startClock) — every «vor 3 min», contact
//     clock, Einsatzuhr and «Gespeichert um» reads the same instant on every run. The backend's
//     `X-Server-Time` is hidden from the page, so `lib/serverClock` keeps offset 0 and
//     `serverNow()` is that same instant (with the header, the real date would pull every clock
//     weeks ahead);
//   - the DATA: the `real` fat incident (src/lib/fatIncident — seeded RNG, the same Einsatz
//     every time), started five hours before SHOT, three Trupps inside, on a fresh stack;
//   - the OUTSIDE WORLD: basemap tiles are one flat PNG (a dark one at night), weather and
//     building outlines canned (perf/harness · isolateFromOutside) — nothing on screen comes from
//     the internet;
//   - the DEVICE: fixed viewport, DPR 1, de-CH / Europe/Zurich, reduced motion, an explicit
//     day/night theme (the default «auto» follows daylight), no service worker.

/** The instant every screenshot shows: Sunday 20.09.2026, 19:05 in Oberwil — the end of the fat
 *  incident's five hours. Dusk, so a theme left on «auto» would flip; every state sets one. */
export const SHOT = Date.parse('2026-09-20T17:05:00Z')

export const TABLET = { viewport: { width: 1180, height: 820 }, isMobile: false, hasTouch: true } as const
export const PHONE = { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true } as const
type Device = typeof TABLET | typeof PHONE

/** The app's two faces (src/fonts.css), as `document.fonts.load` wants them. */
const FACES = ['400 16px Sora', '400 16px "Spline Sans Mono"']

export type Surface = 'map' | 'plans' | 'atemschutz' | 'rapport'

/** A browser context that renders the same pixels every time. */
export async function frozenContext(browser: Browser, baseURL: string, device: Device): Promise<BrowserContext> {
  const context = await browser.newContext({
    ...device,
    baseURL,
    deviceScaleFactor: 1,
    locale: 'de-CH',
    timezoneId: 'Europe/Zurich',
    reducedMotion: 'reduce',
    colorScheme: 'light',
    // a service worker answers out of its precache and can fetch past page.route
    serviceWorkers: 'block',
  })
  // The backend's clock must not reach lib/serverClock: its real date would pull every clock on
  // screen weeks past SHOT. The page never sees the header (lib/api reads it with `headers.get`).
  // Not a page.route that rewrites answers: proxying every /api/ call through `route.fetch` met
  // ECONNRESET and hung the opening behind its cover (09.10.2026).
  await context.addInitScript(() => {
    const get = Headers.prototype.get
    Headers.prototype.get = function (name: string) {
      return name.toLowerCase() === 'x-server-time' ? null : get.call(this, name)
    }
  })
  // The fonts load before anything is measured. The Karte's label pass measures its labels on a
  // canvas (lib/labelPass · textWidth) and caches the widths; a canvas does not wait for a web
  // font, so a label measured before Spline Sans Mono arrived keeps a fallback width — the
  // likeliest cause of one early run whose labels sat 1–2 px off (09.10.2026). The browser
  // fetches a face only once text needs it, so ask for both as soon as the stylesheet is in.
  await context.addInitScript((faces) => {
    document.addEventListener('DOMContentLoaded', () => { for (const face of faces) void document.fonts.load(face) })
  }, FACES)
  await isolateFromOutside(context, baseURL, [], () => SHOT)
  return context
}

/** Close a frozen context: answers still in flight through its canned routes are dropped, not failed. */
export async function closeFrozen(context: BrowserContext) {
  await context.unrouteAll({ behavior: 'ignoreErrors' })
  await context.close()
}

/**
 * Stop the page's wall clock at SHOT: `Date` reads SHOT for the whole test, timers keep running
 * in real time. Call before the first navigation.
 *
 * Not `clock.install` + `pauseAt`: jumping a running page minutes ahead fires every due timer at
 * once, and one baseline of four came out with «Offline» in its head (09.10.2026). With the wall clock fixed nothing jumps; polls, timeouts and MapLibre's frames
 * (performance.now) run as they always do, and everything the opening writes is stamped SHOT.
 */
export async function startClock(page: Page) {
  await page.clock.setFixedTime(SHOT)
}

/**
 * The Karte has drawn everything it is going to draw. Its instance is not reachable from the
 * page, so this asks the canvas itself: two pictures of it 400 ms apart that are identical.
 * (toHaveScreenshot also waits for two equal shots, but of the whole page and back to back —
 * a map still fetching a sprite can sit still for one frame.)
 */
export async function mapDrawn(page: Page) {
  const canvas = page.locator('canvas.maplibregl-canvas').first()
  await canvas.waitFor()
  let last: Buffer | null = null
  for (let i = 0; i < 40; i++) {
    const shot = await canvas.screenshot({ animations: 'allow' })
    if (last && shot.equals(last)) return
    last = shot
    await page.waitForTimeout(400)
  }
  throw new Error('the Karte never stopped drawing (20 s)')
}

/** Seed the fat incident, sign the context in, and open the app on `surface` in `theme`. */
export async function openIncident(page: Page, baseURL: string, { surface, theme = 'day' }: { surface: Surface; theme?: 'day' | 'night' }): Promise<Seeded> {
  const station = await apiRequest.newContext({ baseURL })
  await signIn(station)
  const seeded = await seedIncident(station, 'Brand Mehrfamilienhaus Hauptstrasse', SHOT)
  await station.dispose()
  const context = page.context()
  // the prefs cookie a device keeps (lib/prefs · Prefs): its Einsatz, the surface, the theme
  await context.addCookies([{
    name: 'kp-front-prefs', url: baseURL,
    value: encodeURIComponent(JSON.stringify({ incidentId: seeded.id, incidentChosenAt: SHOT, mode: surface, modeIncidentId: seeded.id, theme })),
  }])
  await buildingAlreadyRead(context, seeded)
  await signIn(context.request)
  await startClock(page)
  await page.goto('/')
  await waitForWorkspace(page)
  return seeded
}

/** Archive the Einsatz again, so the next state starts on a stack with no open incident. */
export async function retireIncident(baseURL: string, id: string) {
  const station = await apiRequest.newContext({ baseURL })
  await signIn(station)
  await retire(station, id)
  await station.dispose()
}

/** Nothing left to arrive: fonts in, no shell-trail loader (components/ShellLoader — its viewBox
 *  is its only stable mark), no opening cover, no image still decoding, and — inside an Einsatz —
 *  every outbox acknowledged: the head's mark is «Gespeichert» (panels/IncidentSwitcher ·
 *  `ip-status-synced`). The opening saves once; a shot taken while that save was in flight
 *  showed the amber «pending» dot instead of the ✓ (09.10.2026). */
export async function settled(page: Page) {
  await page.evaluate(() => document.fonts.ready)
  await page.waitForFunction((faces) => faces.every((face) => document.fonts.check(face)), FACES, { polling: POLL_MS, timeout: 10_000 })
  await page.waitForFunction(() => {
    if (document.querySelector('svg[viewBox="480 245 270 315"], .login.splash')) return false
    const sync = document.querySelector('.ip-status, .ip-offline-chip')
    if (sync && !sync.classList.contains('ip-status-synced')) return false
    return [...document.images].every((img) => img.complete)
  }, undefined, { polling: POLL_MS, timeout: 30_000 })
}
