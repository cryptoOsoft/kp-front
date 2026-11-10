import { test as base, expect, type BrowserContext, type Page, type Request, type TestInfo } from '@playwright/test'

// ── The client-error guard (24.09.2026) ─────────────────────────────────────────────────────
// Every spec imports `test` from ./helpers (which re-exports this one), never from
// '@playwright/test' — eslint enforces it — and so every spec fails when the app reports a
// client error or a render storm, even if everything it asserts still holds. On 23.09.2026 the
// Karte of every device sat in a render loop for hours, and the only witness was
// `POST /api/diag/client-error` (lib/reportError, fed by the ErrorBoundary, the window handlers,
// MapView's map errors and lib/useRenderStorm): it lands in the server log and never failed a
// build. Now it fails the test that caused it, with the payload attached.
//
// Two signals, because either can be the one that got out: the report request itself (every
// kind — render, error, unhandledrejection, surface-recrash, render-storm), and the console /
// uncaught-error line of the loop itself (React #185, «Maximum update depth exceeded»), which
// is there even when the report is still waiting for lib/reportError's budget.
//
// A test that provokes a report ON PURPOSE names it, report by report, with
// `test.use({ expectedClientErrors: [OFFLINE_FETCH_FAILURE] })` — matched against
// «kind: message» of the report body. Nothing else is excused. A crash is never excused, whatever
// the list says: not the kinds render / surface-recrash / render-storm, and not the console /
// uncaught line of a render loop. There is deliberately no switch that turns the guard off.
//
// One thing is excused without asking (09.10.2026): a basemap tile that broke — see
// `TILE_BREAK`. A reload while the Karte is still fetching its tiles makes WebKit fail the
// in-flight tile fetches («Load failed») and the half-read tile blobs («…createImageBitmap»),
// and MapLibre hands both to MapView's error event — on CI, at random, in whichever smoke reloads
// on the Karte. Third-party tiles failing is not a client error of ours. The network events do
// not reliably show it: in the trace of one such failure, 15 «Load failed» reports came with 3
// `requestfailed` events for tiles, so the test is «tiles were loading then», not «a tile failed».

export interface ClientErrorReport {
  /** which browser context («device») saw it — `device 1` is the test's own `page` */
  device: string
  source: 'client-error' | 'console' | 'pageerror'
  at: string
  /** the report body as sent (JSON), or the console / error text */
  detail: string
  /** why the guard let it pass on its own (only in client-errors-expected.json) */
  excused?: string
  /** why a report that looked like a broken tile was not excused */
  notExcused?: string
}

interface ClientErrorSink {
  /** what fails the test */
  reports: ClientErrorReport[]
  /** what the test said it would provoke (attached, never failing) */
  expected: ClientErrorReport[]
  allow: readonly RegExp[]
  /** reports that are a broken basemap tile if the network says so — decided when the test ends,
   *  because the tile traffic and the report arrive in either order (so a mid-test
   *  `expectNoClientErrors` does not see them yet) */
  tileBreaks: { report: ClientErrorReport; notATileBreak: () => string }[]
}

const CLIENT_ERROR_PATH = '/api/diag/client-error'
/** the loop's own words: React's minified #185 (prod build), its dev text, and the storm beacon */
const LOOP_SIGNS = /Minified React error #185|Maximum update depth exceeded|render storm/i

/** report kinds that ARE a crash — never excused by `expectedClientErrors` */
const NEVER_EXCUSED = new Set(['render', 'surface-recrash', 'render-storm'])

/** The basemap tile hosts — the same list as the service worker's `map` tiles (public/sw-tile-store.js). */
const BASEMAP_TILE = /^https:\/\/([a-d]\.|tiles-[a-d]\.)?(basemaps\.cartocdn\.com|tile\.openstreetmap\.org|[a-c]\.tile\.opentopomap\.org|server\.arcgisonline\.com|wmts\.geo\.admin\.ch|geowms\.bl\.ch)\//
/** «kind: message» of what a broken tile reports: WebKit's words for a fetch that failed (bare, or
 *  as MapLibre 6 wraps it: `AJAXError: Load failed (0): <url>`, and then only for a basemap tile's
 *  url) and for a tile blob cut off while it was being decoded. Chromium's «Failed to fetch» is
 *  not here — no Chromium run has shown it outside the offline drills, which list it themselves. */
const TILE_BREAK = new RegExp(
  '^error: (?:Load failed|An error occured reading the Blob argument to createImageBitmap' +
  `|AJAXError: Load failed \\(0\\): ${BASEMAP_TILE.source.slice(1)}\\S*)$`,
)
/** For `expectedClientErrors` in an offline drill: the fetch failure Chromium reports while its
 *  offline emulation still says `navigator.onLine === true` — bare (our own fetches), or as
 *  MapLibre 6 wraps it for a tile (`AJAXError: Failed to fetch (0): <url>`). */
export const OFFLINE_FETCH_FAILURE = /^error: (?:Failed to fetch|AJAXError: Failed to fetch \(0\): \S+)$/
/** how far from the report the device's tile traffic may be */
const TILE_BREAK_WINDOW_MS = 3000
/** how long a tile request that never reported an end counts as loading */
const TILE_UNENDED_MS = 10_000
/** a request the browser cancelled (navigation, teardown) — WebKit, Chromium, Firefox */
const CANCELLED = /cancel|abort/i

/** «kind: message» of a report body, for `expectedClientErrors` — '' if it is not one, or if
 *  its kind can never be excused */
function kindAndMessage(body: string): string {
  try {
    const r = JSON.parse(body) as { kind?: unknown; message?: unknown }
    return NEVER_EXCUSED.has(`${r.kind}`) ? '' : `${r.kind}: ${r.message}`
  } catch { return '' }
}

/** Start collecting every client error `context` reports. */
function guardClientErrors(context: BrowserContext, device: string, sink: ClientErrorSink) {
  // this device's basemap tile requests (start, and end if one was ever reported — a cancelled
  // one often never is), and its other requests that failed for another reason than a cancel
  const tiles = new Map<Request, { start: number; end?: number }>()
  const ownFailures: { at: number; what: string }[] = []
  /** '' if it is a broken tile, else why not */
  const notATileBreak = (at: number) => {
    const own = ownFailures.filter((f) => Math.abs(f.at - at) <= TILE_BREAK_WINDOW_MS)
    if (own.length) return `another request failed then: ${own.slice(0, 3).map((f) => f.what).join('; ')}`
    const loading = [...tiles.values()].some((t) => t.start <= at + TILE_BREAK_WINDOW_MS && (t.end ?? t.start + TILE_UNENDED_MS) >= at - TILE_BREAK_WINDOW_MS)
    return loading ? '' : `no basemap tile was loading within ${TILE_BREAK_WINDOW_MS} ms (${tiles.size} tile requests in the test)`
  }
  const push = (source: ClientErrorReport['source'], detail: string) => {
    const now = Date.now()
    const report = { device, source, at: new Date(now).toISOString(), detail: detail.slice(0, 4000) }
    const said = source === 'client-error' ? kindAndMessage(detail) : ''
    const excused = said !== '' && sink.allow.some((re) => re.test(said))
    if (excused) sink.expected.push(report)
    // A broken tile, unless our own server's requests were failing at the same moment: then the
    // same words could be ours, and the guard stays strict.
    else if (TILE_BREAK.test(said)) sink.tileBreaks.push({ report, notATileBreak: () => notATileBreak(now) })
    else sink.reports.push(report)
  }
  const ended = (req: Request) => { const t = tiles.get(req); if (t) t.end = Date.now() }
  context.on('requestfinished', ended)
  context.on('requestfailed', (req) => {
    ended(req)
    const error = req.failure()?.errorText ?? ''
    if (!BASEMAP_TILE.test(req.url()) && !CANCELLED.test(error)) {
      ownFailures.push({ at: Date.now(), what: `${req.method()} ${req.url().slice(0, 120)} – ${error}` })
    }
  })
  const watch = (page: Page) => {
    page.on('console', (msg) => { if (msg.type() === 'error' && LOOP_SIGNS.test(msg.text())) push('console', msg.text()) })
    page.on('pageerror', (err) => { if (LOOP_SIGNS.test(err.message)) push('pageerror', `${err.message}\n${err.stack ?? ''}`) })
  }
  context.pages().forEach(watch)
  context.on('page', watch)
  // context-level, so a request the service worker forwards is seen too
  context.on('request', (req) => {
    if (BASEMAP_TILE.test(req.url())) tiles.set(req, { start: Date.now() })
    if (req.method() === 'POST' && new URL(req.url()).pathname === CLIENT_ERROR_PATH) push('client-error', req.postData() ?? '')
  })
}

/** Mid-test form of the guard, for a spec that wants the failure AT the step that caused it. */
export function expectNoClientErrors(reports: ClientErrorReport[], where: string) {
  expect(reports, `${where}: the app reported a client error or render storm`).toEqual([])
}

async function settleClientErrors(sink: ClientErrorSink, testInfo: TestInfo) {
  let excused = 0
  for (const { report, notATileBreak } of sink.tileBreaks) {
    const why = notATileBreak()
    if (!why) { excused++; sink.expected.push({ ...report, excused: 'basemap tiles were loading on this device then' }) }
    else sink.reports.push({ ...report, notExcused: why })
  }
  // one line in the run log, so a green run still says the guard let something pass
  if (excused) console.warn(`client-error guard: excused ${excused} broken basemap tile report(s) in «${testInfo.title}» (client-errors-expected.json)`)
  if (sink.expected.length) {
    await testInfo.attach('client-errors-expected.json', { body: JSON.stringify(sink.expected, null, 2), contentType: 'application/json' })
  }
  if (!sink.reports.length) return
  await testInfo.attach('client-errors.json', { body: JSON.stringify(sink.reports, null, 2), contentType: 'application/json' })
  const first = sink.reports[0]
  throw new Error(
    `The app reported ${sink.reports.length} client error(s) / render storm(s) during this test ` +
    `(attachment client-errors.json; the server log has them as kpfront.clienterror). ` +
    `First, on ${first.device} via ${first.source}: ${first.detail.slice(0, 600)}` +
    (first.notExcused ? ` – not excused as a broken basemap tile: ${first.notExcused}` : ''),
  )
}

interface GuardOptions {
  /** reports this test provokes on purpose, as /«kind: message»/ — see the note at the top */
  expectedClientErrors: RegExp[]
}

interface GuardFixtures {
  clientErrorSink: ClientErrorSink
  /** every unexcused client error any context of this test reported, so far */
  clientErrors: ClientErrorReport[]
  /** A further browser context — another device on the SAME station — guarded like `page`,
   *  with the project's base URL and viewport, and closed at the end. (Playwright's own
   *  failure screenshot covers its pages too.) */
  openDevice: (name: string) => Promise<Page>
}

export const test = base.extend<GuardOptions & GuardFixtures>({
  expectedClientErrors: [[], { option: true }],
  // auto: it runs for every test of every spec, whether the test asks for it or not
  clientErrorSink: [async ({ context, expectedClientErrors }, use, testInfo) => {
    const sink: ClientErrorSink = { reports: [], expected: [], allow: expectedClientErrors, tileBreaks: [] }
    guardClientErrors(context, 'device 1', sink)
    await use(sink)
    await settleClientErrors(sink, testInfo)
  }, { auto: true }],
  clientErrors: async ({ clientErrorSink }, use) => { await use(clientErrorSink.reports) },
  openDevice: async ({ browser, baseURL, viewport, clientErrorSink }, use) => {
    const opened: BrowserContext[] = []
    await use(async (name) => {
      const context = await browser.newContext({ baseURL, viewport })
      guardClientErrors(context, name, clientErrorSink)
      opened.push(context)
      return context.newPage()
    })
    for (const context of opened) await context.close()
  },
})

export { expect }
