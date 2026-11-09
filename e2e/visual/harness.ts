import { request as apiRequest, type Browser, type BrowserContext, type Page } from '@playwright/test'
import type { StationObjects } from '../../src/lib/api/stationReference'
import type { KarteView } from '../../src/lib/karte/session'
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

// ── «Karte & Objekte», the home outside an Einsatz ───────────────────────────────────────────
// The station catalogue is canned like the outside world: the server fills an object's footprint
// and the region's houses from registers on the internet, minutes after the object was created,
// so a real catalogue would draw a different map from one run to the next.

/** where the Karte home stands in the shots: the fat incident's village, the same frame every
 *  time, with the three catalogue objects inside a phone's width */
const KARTE_VIEW: KarteView = { center: [7.5557, 47.5138], zoom: 16.4, bearing: 0, objectId: null, surface: 'karte' }

/** a rectangular footprint of `w` × `h` metres around a point */
function footprint([lng, lat]: [number, number], w: number, h: number): NonNullable<StationObjects['objects'][number]['footprint']> {
  const dx = w / 2 / (111_320 * Math.cos((lat * Math.PI) / 180)), dy = h / 2 / 111_320
  return { type: 'MultiPolygon', coordinates: [[[[lng - dx, lat - dy], [lng + dx, lat - dy], [lng + dx, lat + dy], [lng - dx, lat + dy], [lng - dx, lat - dy]]]] }
}

const stationObject = (n: number, name: string, kind: 'einsatzobjekt' | 'objekt', address: string, at: [number, number], size: [number, number]): StationObjects['objects'][number] => ({
  id: `00000000-0000-4000-8000-00000000000${n}`, name, kind, address, lng: at[0], lat: at[1],
  aliases: [], plans: [], floors: [], egid: null, footprint: footprint(at, ...size), lastVisit: null,
})

const CATALOGUE: StationObjects = {
  generatedAt: new Date(SHOT).toISOString(),
  objects: [
    stationObject(1, 'Schulhaus Musterdorf', 'einsatzobjekt', 'Schulstrasse 4, 9999 Musterdorf', [7.5551, 47.5142], [46, 22]),
    stationObject(2, 'Alterszentrum Lindenhof', 'einsatzobjekt', 'Lindenweg 12, 9999 Musterdorf', [7.5564, 47.5134], [38, 30]),
    stationObject(3, 'Werkhof', 'objekt', 'Industriestrasse 9, 9999 Musterdorf', [7.5559, 47.5147], [28, 18]),
  ],
}

/** Sign the context in and open «Karte & Objekte» in `theme`, on the canned catalogue. The stack
 *  must have no open Einsatz (every state retires its own) or the bar would show it running. */
export async function openKarte(page: Page, theme: 'day' | 'night' = 'day') {
  const context = page.context()
  await context.route('**/api/reference/objects', (route) => route.fulfill({ json: CATALOGUE }))
  for (const set of ['houses', 'underground']) await context.route(`**/api/reference/${set}*`, (route) => route.fulfill({ json: { enabled: false } }))
  // what the device remembers, written before any app code runs: its theme (lib/prefs, the prefs
  // cookie) and where the Karte was looking (lib/karte/session)
  await context.addInitScript(([prefs, view]) => {
    document.cookie = `kp-front-prefs=${encodeURIComponent(prefs)}; path=/`
    sessionStorage.setItem('kp.karte.view', view)
  }, [JSON.stringify({ theme }), JSON.stringify(KARTE_VIEW)] as const)
  await signIn(context.request)
  await startClock(page)
  await page.goto('/karte')
  await page.locator('[data-karte]').waitFor({ state: 'visible', timeout: 60_000 })
  // every catalogue object has its mark on the map
  await page.waitForFunction((n) => document.querySelectorAll('[data-karte] .maplibregl-marker').length >= n, CATALOGUE.objects.length, { polling: POLL_MS, timeout: 30_000 })
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
