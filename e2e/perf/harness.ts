import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { crc32, deflateSync } from 'node:zlib'
import type { APIRequestContext, BrowserContext, CDPSession, Page, Request } from '@playwright/test'
import { FAT_PRESETS, fatIncident } from '../../src/lib/fatIncident'
import { PIN, EINSATZ_RAIL } from '../helpers'

// The measuring half of the performance journeys (e2e/journeys.journey.ts, docs/testing/perf-journeys.md).
// A journey drives the built app the way a crew does. This file turns what the browser saw into
// numbers: requests and bytes per kind, main-thread blocking, interaction latency, and heap, DOM
// nodes and listeners after a forced GC. `scripts/perf-report.mjs` compares those numbers against
// e2e/perf/baseline.json and fails CI on a regression.
//
// Every number is LOWER-IS-BETTER, and its unit decides how much noise the gate tolerates
// (perf-report.mjs · TOLERANCE): a count or a byte size is close to deterministic, a time is not.

export type Unit = 'ms' | 'count' | 'kb' | 'mb'
export interface Metric { value: number; unit: Unit }

/** where every journey writes its numbers — the report merges the directory */
export const OUT_DIR = process.env.PERF_OUT || 'perf-results'
/**
 * CPU throttle, off by default. A field tablet is ~4× slower than a runner, but headless Chromium
 * has no GPU: the Karte renders through software WebGL on the main thread's budget, and at 4× a
 * busy Karte fell to 2–10 frames a second and a single evaluate waited minutes (05.10.2026). The
 * journeys judge a build against its baseline, so a relative change is what counts, and it shows
 * unthrottled too. `PERF_CPU=4` is there for a local look at tablet speed.
 */
export const CPU_THROTTLE = Number(process.env.PERF_CPU ?? 1)

const median = (xs: number[]) => {
  const s = [...xs].sort((a, b) => a - b)
  return s.length ? (s.length % 2 ? s[(s.length - 1) / 2] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2) : NaN
}
export { median }

/** One journey's numbers, written to `<OUT_DIR>/<journey>.json` by `save()`. */
export class Results {
  readonly metrics: Record<string, Metric> = {}
  constructor(readonly journey: string) {}
  set(name: string, value: number, unit: Unit) {
    this.metrics[`${this.journey}.${name}`] = { value: unit === 'count' ? Math.round(value) : Math.round(value * 10) / 10, unit }
  }
  save(extra: Record<string, unknown> = {}) {
    mkdirSync(OUT_DIR, { recursive: true })
    writeFileSync(join(OUT_DIR, `${this.journey}.json`), JSON.stringify({ journey: this.journey, ...extra, metrics: this.metrics }, null, 2))
    // eslint-disable-next-line no-console -- the numbers ARE the output of a local run
    for (const [k, m] of Object.entries(this.metrics)) console.log(`  ${k.padEnd(44)} ${String(m.value).padStart(9)} ${m.unit}`)
  }
}

// ── The world outside the stack ──────────────────────────────────────────────────────────────
// A journey must measure THIS build, not the basemap CDN, MeteoSwiss or Overpass on the day.
// External tiles get one fixed 256×256 PNG; the two backend routes that only proxy a third party
// (the weather, the building outlines) get a canned answer. Every external request is still
// counted: for an offline-first app a new external dependency is a regression of its own.

function solidPng(size = 256, rgb: [number, number, number] = [232, 228, 220]): Buffer {
  const chunk = (type: string, data: Buffer) => {
    const len = Buffer.alloc(4); len.writeUInt32BE(data.length)
    const body = Buffer.concat([Buffer.from(type, 'ascii'), data])
    const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(body) >>> 0)
    return Buffer.concat([len, body, crc])
  }
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(size, 0); ihdr.writeUInt32BE(size, 4)
  ihdr[8] = 8; ihdr[9] = 2 // 8-bit RGB
  const row = Buffer.concat([Buffer.from([0]), Buffer.from(Array.from({ length: size }, () => rgb).flat())])
  const raw = Buffer.concat(Array.from({ length: size }, () => row))
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0))])
}
const TILE = solidPng()

export async function isolateFromOutside(context: BrowserContext, baseURL: string, external: string[], now = () => Date.now()) {
  const own = new URL(baseURL).origin
  await context.route((url) => url.protocol.startsWith('http') && url.origin !== own, async (route) => {
    const req = route.request()
    external.push(new URL(req.url()).host)
    // CARTO's vector label tiles (lib/basemapLabels): an empty body is a valid empty tile – no
    // names, so no glyphs fetched and the baselines stay the flat stand-in map. A PNG would not decode.
    if (/\.mvt(\?|$)/.test(req.url())) {
      return route.fulfill({ status: 200, contentType: 'application/x-protobuf', body: Buffer.alloc(0), headers: { 'access-control-allow-origin': '*' } })
    }
    if (req.resourceType() === 'image' || /\.(png|jpe?g|webp)(\?|$)/.test(req.url()) || /\/\d+\/\d+\/\d+(@2x)?(\.\w+)?(\?|$)/.test(req.url())) {
      return route.fulfill({ status: 200, contentType: 'image/png', body: TILE, headers: { 'access-control-allow-origin': '*' } })
    }
    return route.continue()
  })
  await context.route('**/api/weather?*', (route) => route.fulfill({ json: {
    wind_dir_deg: 240, wind_speed_kmh: 9, wind_gust_kmh: 18, temp_c: 14, precip_mm: 0, weather_code: 1,
    observed_at: new Date(now()).toISOString(), source: 'meteoswiss', station: 'Basel-Binningen',
  } }))
  await context.route('**/api/overpass/buildings', (route) => route.fulfill({ json: { elements: [] } }))
  // The Gebäude chip's register half (api/building) asks geo.admin from the SERVER, so routing the
  // page's outside calls does not reach it: the answer itself is canned — one building with gas
  // heating, no PV, no Objekt notes — or a GWR hiccup would take the chip off the Karte's baseline.
  await context.route('**/api/incidents/*/building?*', (route) => route.fulfill({ json: {
    registers: 'on', egid: '1000001', address: 'Hauptstrasse 1, 9999 Musterdorf',
    gwr: { stand: '2026-09-15', floors: 4, flats: 6, year: 1962, period: null, heating: ['gas'],
      heating_date: '2021-03-01', hot_water: ['gas'], shelter: null, status: null },
    gwr_status: 'ok', plants: [], pv_status: 'ok', registers_fetched_at: new Date(now()).toISOString(),
    object: null, visit: null,
  } }))
  // The Karte's weather layer (backend app/weather_layer, off in CI's stack): a fixed answer, so the
  // journeys pay for its poll – no radar frame (the radar row is off by default).
  await context.route('**/api/weather/layer*', (route) => route.fulfill({ json: cannedWeatherLayer(now()) }))
}

function cannedWeatherLayer(at: number) {
  const iso = new Date(at).toISOString()
  const status = { last_attempt_at: iso, last_success_at: iso, last_error: null, last_error_at: null }
  return {
    enabled: true,
    generated_at: iso,
    radar: {
      frames: [], coordinates: null, data_time: null, stale: true, stale_after_seconds: 900, status,
      legend: [{ min_mm_h: 0.1, color: '#9bd7ff' }, { min_mm_h: 10, color: '#ff9a00' }],
      attribution: 'MeteoSchweiz', source_url: 'https://www.meteoschweiz.admin.ch',
    },
  }
}

// ── Network accounting ───────────────────────────────────────────────────────────────────────

export type ReqKind = 'api' | 'js' | 'css' | 'font' | 'data' | 'image' | 'document' | 'other'
export interface SeenRequest { at: number; method: string; path: string; kind: ReqKind; bytes: number; upBytes: number; viaSw: boolean; bySw: boolean; external: boolean }

function kindOf(req: Request, path: string): ReqKind {
  if (path.startsWith('/api/')) return 'api'
  const t = req.resourceType()
  if (t === 'document') return 'document'
  if (/\.m?js$/.test(path) || t === 'script') return 'js'
  if (/\.css$/.test(path) || t === 'stylesheet') return 'css'
  if (/\.(woff2?|ttf|otf)$/.test(path) || t === 'font') return 'font'
  if (/\.(json|geojson|pbf|webmanifest)$/.test(path)) return 'data'
  if (/\.(png|jpe?g|svg|webp|ico)$/.test(path) || t === 'image') return 'image'
  return 'other'
}

/** Every request of the context, the service worker's own included. `viaSw` = the page asked and
 *  the service worker answered (no network of its own); `bySw` = the service worker fetched it. */
export function watchNetwork(context: BrowserContext, baseURL: string) {
  const own = new URL(baseURL).origin
  const seen: SeenRequest[] = []
  context.on('requestfinished', async (req) => {
    const url = new URL(req.url())
    if (!url.protocol.startsWith('http')) return
    const res = await req.response().catch(() => null)
    const sizes = await req.sizes().catch(() => null)
    const path = url.origin === own ? url.pathname : `${url.host}${url.pathname}`
    seen.push({
      at: Date.now(), method: req.method(), path, kind: kindOf(req, url.pathname),
      bytes: Math.max(0, sizes?.responseBodySize ?? 0), upBytes: Math.max(0, sizes?.requestBodySize ?? 0),
      viaSw: res?.fromServiceWorker() ?? false, bySw: !!req.serviceWorker(), external: url.origin !== own,
    })
  })
  return {
    seen,
    /** what went over the wire since `from` — a page request the service worker answered is not network */
    since(from: number) { return seen.filter((r) => r.at >= from && !r.viaSw) },
    /** resolve once no request has finished for `ms` (or after `max`) — basemap tiles excluded:
     *  MapLibre keeps fetching them as long as the Karte has edges to fill */
    async quiet(ms: number, max: number) {
      const until = Date.now() + max
      const last = () => Math.max(0, ...seen.filter((r) => !r.external).map((r) => r.at))
      while (Date.now() < until && Date.now() - last() < ms) await new Promise((r) => setTimeout(r, 100))
    },
  }
}

const KB = 1024
/** Record what a stretch of network traffic cost: API requests and bytes, static requests.
 *  Static BYTES are not measured here: the bundle budget (scripts/check-bundle-size.mjs) owns
 *  them, and a static request where none belongs (a precache miss, a new chunk) is a count. */
/** An API request of the app itself – not its diagnostics (/api/diag: the launch timing line and
 *  the crash sink), which a device sends once per launch or per error, whatever the app does. */
export const isAppApi = (x: SeenRequest) => x.kind === 'api' && !x.path.startsWith('/api/diag/')

export function recordNetwork(r: Results, prefix: string, reqs: SeenRequest[]) {
  const page = reqs.filter((x) => !x.bySw)
  const api = page.filter(isAppApi)
  r.set(`${prefix}api_requests`, api.length, 'count')
  r.set(`${prefix}api_kb`, api.reduce((a, x) => a + x.bytes, 0) / KB, 'kb')
  r.set(`${prefix}static_requests`, page.filter((x) => x.kind !== 'api' && !x.external).length, 'count')
  // hosts, not requests: how many basemap tiles land inside a window is timing; a host the app
  // never talked to before is a new dependency of an offline-first app
  r.set(`${prefix}external_hosts`, new Set(reqs.filter((x) => x.external).map((x) => x.path.split('/')[0].replace(/^[a-d]\./, ''))).size, 'count')
}

/** A tally of API routes, for the report's «what changed» detail — ids collapsed to `:id`. */
export function routeTally(reqs: SeenRequest[]) {
  const out: Record<string, number> = {}
  for (const x of reqs) {
    if (x.kind !== 'api') continue
    const key = `${x.method} ${x.path.replace(/[0-9a-f]{8}-[0-9a-f-]{27,}/g, ':id')}`
    out[key] = (out[key] ?? 0) + 1
  }
  return Object.fromEntries(Object.entries(out).sort(([a], [b]) => a.localeCompare(b)))
}

// ── In-page probes: long tasks and interaction latency ───────────────────────────────────────

interface PageProbe { long: number[]; events: Record<number, number> }

/** Collect main-thread long tasks and Event Timing entries from the first byte on. */
export async function instrument(page: Page) {
  await page.addInitScript(() => {
    const w = window as unknown as { __perf: PageProbe }
    w.__perf = { long: [], events: {} }
    try {
      new PerformanceObserver((l) => { for (const e of l.getEntries()) w.__perf.long.push(e.duration) }).observe({ type: 'longtask', buffered: true })
      // Event Timing: input delay + handlers + the next paint, per interaction (what INP is made of)
      new PerformanceObserver((l) => {
        for (const e of l.getEntries() as PerformanceEventTiming[]) {
          if (!e.interactionId) continue
          w.__perf.events[e.interactionId] = Math.max(w.__perf.events[e.interactionId] ?? 0, e.duration)
        }
      }).observe({ type: 'event', durationThreshold: 16, buffered: true } as PerformanceObserverInit)
    } catch { /* not Chromium — the journeys run on Chromium only */ }
  })
}

/** Drain the probe: the long tasks and the interaction latencies seen since the last drain. */
export async function drain(page: Page): Promise<{ long: number[]; interactions: number[] }> {
  return page.evaluate(() => {
    const w = window as unknown as { __perf: PageProbe }
    const out = { long: [...w.__perf.long], interactions: Object.values(w.__perf.events) }
    w.__perf.long = []; w.__perf.events = {}
    return out
  })
}

/** Total blocking time: what each long task held the main thread beyond 50 ms. */
export const blocking = (long: number[]) => long.reduce((a, d) => a + Math.max(0, d - 50), 0)

/**
 * How often a readiness check is polled in the page. An interval, never `polling: 'raf'`: after a
 * few Linien in software WebGL the page's animation frames stalled, and a raf-polled check sat
 * for minutes over a surface that had switched in 266 ms (05.10.2026). 16 ms is one frame's worth
 * of jitter on a number whose tolerance is ≥ 60 ms.
 */
export const POLL_MS = 16

/** Resolve after the browser has painted the current state (two frames) — or after 250 ms, if no
 *  frame comes (see POLL_MS): a stalled frame must not hang the journey. */
export const painted = (page: Page) => page.evaluate(() => new Promise<void>((r) => {
  setTimeout(r, 250)
  requestAnimationFrame(() => requestAnimationFrame(() => r()))
}))

/** Time from a raw input to `ready()` holding in the page (polled every POLL_MS). The input is
 *  dispatched at a pre-measured point (page.mouse / keyboard), never through a locator action:
 *  Playwright's actionability waits would be part of the number. */
export async function timeTo(page: Page, input: () => Promise<unknown>, ready: () => Promise<unknown>) {
  const t0 = performance.now()
  await input()
  await ready()
  await painted(page)
  return performance.now() - t0
}

/** Centre of a locator — computed BEFORE the clock starts, once nothing lies on top of it. A
 *  raw tap hits whatever is there: the «Eintrag erfasst» toast of the previous Meldung sat over
 *  the composer's «Erfassen» (05.10.2026), and the tap dismissed the toast instead. A crew waits
 *  for the toast too, so the journey does, untimed. */
export async function centre(page: Page, selector: string | ReturnType<Page['locator']>) {
  const loc = typeof selector === 'string' ? page.locator(selector).first() : selector
  await loc.waitFor({ state: 'visible', timeout: 30_000 })
  const handle = await loc.elementHandle()
  await page.waitForFunction((el) => {
    if (!el) return false
    const b = el.getBoundingClientRect()
    const hit = document.elementFromPoint(b.x + b.width / 2, b.y + b.height / 2)
    return !!hit && (el === hit || el.contains(hit))
  }, handle, { polling: POLL_MS, timeout: 30_000 })
  const b = (await loc.boundingBox())!
  return { x: b.x + b.width / 2, y: b.y + b.height / 2 }
}

// ── CPU, heap, DOM ───────────────────────────────────────────────────────────────────────────

export async function cdpFor(page: Page): Promise<CDPSession> {
  const cdp = await page.context().newCDPSession(page)
  await cdp.send('Performance.enable')
  if (CPU_THROTTLE > 1) await cdp.send('Emulation.setCPUThrottlingRate', { rate: CPU_THROTTLE })
  return cdp
}

export interface Counters { ScriptDuration: number; TaskDuration: number; LayoutCount: number; RecalcStyleCount: number; Nodes: number; JSEventListeners: number; JSHeapUsedSize: number }

export async function counters(cdp: CDPSession): Promise<Counters> {
  const { metrics } = await cdp.send('Performance.getMetrics')
  const m = Object.fromEntries(metrics.map((x) => [x.name, x.value]))
  return { ScriptDuration: m.ScriptDuration, TaskDuration: m.TaskDuration, LayoutCount: m.LayoutCount, RecalcStyleCount: m.RecalcStyleCount, Nodes: m.Nodes, JSEventListeners: m.JSEventListeners, JSHeapUsedSize: m.JSHeapUsedSize }
}

/** Heap, DOM nodes and listeners as they stand after a full GC — what a leak leaves behind. */
export async function retained(cdp: CDPSession) {
  for (let i = 0; i < 3; i++) await cdp.send('HeapProfiler.collectGarbage')
  const { usedSize } = await cdp.send('Runtime.getHeapUsage')
  const c = await counters(cdp)
  return { heapMb: usedSize / 1024 / 1024, nodes: c.Nodes, listeners: c.JSEventListeners }
}

/**
 * How fast this machine is TODAY, in a fixed workload, unthrottled. A GitHub runner varies by
 * ±30 % from one run to the next; perf-report.mjs scales every time budget by this number against
 * the baseline's, so a slow runner is not read as a slow build.
 */
export async function calibrate(page: Page): Promise<number> {
  return page.evaluate(() => {
    const blob = { entities: Array.from({ length: 400 }, (_, i) => ({ id: `e${i}`, label: `Objekt ${i}`, coord: [7.55 + i / 1e4, 47.51], fields: { a: i, b: 'x'.repeat(i % 40) } })) }
    const nums = Array.from({ length: 60_000 }, (_, i) => (i * 7919) % 100_003)
    const runs: number[] = []
    for (let k = 0; k < 9; k++) {
      const t = performance.now()
      for (let j = 0; j < 4; j++) {
        nums.slice().sort((a, b) => a - b)
        JSON.parse(JSON.stringify(blob))
        const el = document.createElement('div')
        for (let n = 0; n < 400; n++) el.appendChild(document.createElement('span')).textContent = String(n)
        el.remove()
      }
      runs.push(performance.now() - t)
    }
    runs.sort((a, b) => a - b)
    return runs[4]
  })
}

// ── The Einsatz every journey runs on ────────────────────────────────────────────────────────

/** A station API session (the seeded kiosk login) sharing the context's cookie jar. */
export async function signIn(api: APIRequestContext) {
  const roster = await (await api.get('/api/auth/roster')).json()
  if (!roster.length) throw new Error('the seeded roster is empty')
  const res = await api.post('/api/auth/login', { data: { user_id: roster[0].id, pin: PIN } })
  if (!res.ok()) throw new Error(`station login: HTTP ${res.status()}`)
}

export interface Seeded { id: string; title: string; trupps: string[]; journalRows: number; objects: number; center: [number, number] }

/**
 * A realistic, busy Einsatz: the `real` fat incident (src/lib/fatIncident — the busiest Einsatz on
 * record: 19 Karte objects, ~25 people, Trupps in, 316 Verlauf rows), five hours in and running
 * now. Every journey gets a fresh one, so what one journey wrote never changes the next one's
 * numbers. Archived again by `retire()`.
 */
export async function seedIncident(api: APIRequestContext, title: string, now = Date.now()): Promise<Seeded> {
  const opts = FAT_PRESETS.real
  const fat = fatIncident({ ...opts, start: new Date(now - opts.hours * 3_600_000).toISOString() })
  const created = await api.post('/api/incidents', {
    data: { title, type: 'Brand', lat: fat.options.center[1], lng: fat.options.center[0], started_at: fat.startedAt },
  })
  if (!created.ok()) throw new Error(`create incident: HTTP ${created.status()} ${await created.text()}`)
  const { id } = await created.json()
  const base = `/api/incidents/${id}`
  for (let k = 0; k < fat.journal.length; k += 500) {
    const res = await api.post(`${base}/journal`, { data: { entries: fat.journal.slice(k, k + 500) } })
    if (!res.ok()) throw new Error(`seed journal: HTTP ${res.status()} ${await res.text()}`)
  }
  // Three Trupps inside, as on a running Einsatz. The fat incident ends five hours in, when every
  // Trupp is long out (each works 18–30 min), so the three latest go back in: entered ten minutes
  // ago, last contact two minutes ago — none goes überfällig during a journey (an alarm banner and
  // its saves would be the journey's numbers otherwise).
  const iso = (minAgo: number) => new Date(now - minAgo * 60_000).toISOString()
  const trupps = [...(fat.workspace.trupps ?? [])]
  const inside = new Set(trupps.slice(-3).map((t) => t.id))
  const ws = { ...fat.workspace, trupps: trupps.map((t) => (!inside.has(t.id) ? t : {
    ...t, status: 'aktiv' as const, exitTime: undefined, entryTime: iso(10),
    lastContactTime: iso(2), lastPressureTime: iso(2), lastPressureBar: 270, lowestBar: 270,
    readings: [{ t: iso(13), bar: 300, kind: 'registered' as const }, { t: iso(10), bar: 300, kind: 'entry' as const }, { t: iso(2), bar: 270, kind: 'pressure' as const }],
  })) }
  const cur = await (await api.get(`${base}/workspace`)).json()
  const put = await api.put(`${base}/workspace?slim=1`, { data: { workspace: ws, base_rev: cur.workspace_rev ?? 0 } })
  if (!put.ok()) throw new Error(`seed workspace: HTTP ${put.status()} ${await put.text()}`)
  return {
    id, title,
    trupps: ws.trupps.filter((t) => inside.has(t.id)).map((t) => t.name),
    journalRows: fat.journal.length,
    objects: fat.workspace.entities.length,
    center: fat.options.center,
  }
}

/** Archive the journey's Einsatz again, so the stack keeps no open incident behind. */
export async function retire(api: APIRequestContext, id: string) {
  await api.patch(`/api/incidents/${id}`, { data: { is_archived: true } }).catch(() => {})
}

/** Make this browser open `incident` on its next launch, as a device remembers its last Einsatz. */
export async function remember(context: BrowserContext, baseURL: string, incidentId: string) {
  await context.addCookies([{
    name: 'kp-front-prefs', url: baseURL,
    value: encodeURIComponent(JSON.stringify({ incidentId, incidentChosenAt: Date.now() })),
  }])
}

/**
 * This device has already read the Einsatz's Gebäude card (lib/buildingFirstOpen). The frozen
 * states and the journeys stand on a device that has been working the Einsatz for hours, so the
 * card's FIRST open — docked over the Karte's bottom-left, half the screen on a phone — is not
 * theirs to measure or to tap around. The flag is written where lib/idb reads first (its
 * localStorage fallback slot), before any app code runs. The key is `buildingReadKey` of the
 * canned answer above: the Einsatzort (`buildingWhere`: no address, the point to 5 decimals) and
 * no Objekt. Should that ever drift, the Lage baselines show the card and say so.
 */
export async function buildingAlreadyRead(context: BrowserContext, seeded: Pick<Seeded, 'id' | 'center'>) {
  const [lng, lat] = seeded.center
  const key = `|${lat.toFixed(5)}|${lng.toFixed(5)}#`
  await context.addInitScript(([slot, value]) => { localStorage.setItem(slot, value) },
    [`kp-idb-fb:kp-front-building-read:${seeded.id}`, JSON.stringify([key])] as const)
}

/** The Einsatz is on screen and its opening cover (lib/bootCover) has lifted. */
export async function waitForWorkspace(page: Page, timeout = 60_000) {
  await page.locator(EINSATZ_RAIL).waitFor({ state: 'visible', timeout })
  await page.waitForFunction(() => !document.querySelector('.login.splash'), undefined, { timeout, polling: POLL_MS })
}
