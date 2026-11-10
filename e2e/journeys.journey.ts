import { request as apiRequest, type Page } from '@playwright/test'
import { expect, PIN, test, EINSATZ_RAIL } from './helpers'
import {
  Results, blocking, buildingAlreadyRead, calibrate, cdpFor, centre, counters, drain, instrument, isAppApi, isolateFromOutside, median,
  painted, recordNetwork, remember, retained, retire, routeTally, seedIncident, signIn, timeTo,
  waitForWorkspace, watchNetwork, CPU_THROTTLE, POLL_MS, type Seeded,
} from './perf/harness'

// Performance journeys — what a crew does with the app, measured, against a baseline. Each journey
// opens its own busy Einsatz (the busiest one on record, harness · seedIncident) in Chromium, with
// the outside world stubbed (harness · isolateFromOutside). Every number lands in
// perf-results/<journey>.json; `scripts/perf-report.mjs` compares them against e2e/perf/baseline.json
// and fails CI on a regression. The how and the why: docs/testing/perf-journeys.md.
//
// The specs assert only that the journey could be walked. The judging is the report's: one place
// knows the tolerances, and a slow run still writes every number it got.
//
// ⚠️ OPT-IN (PERF_JOURNEYS=1): it writes Einsätze. CI's «Performance» job and `just perf` set it.

test.skip(!process.env.PERF_JOURNEYS, 'performance journeys are opt-in (PERF_JOURNEYS=1) — run `just perf`')
// independent journeys, one after another (workers: 1): a failed one does not skip the rest
test.describe.configure({ retries: 0 })
test.setTimeout(5 * 60_000)

/** the rail's surfaces in the order a crew goes through them, with the `.app` mode each one sets */
const SURFACES = [
  ['Karte', 'map'], ['Gebäude', 'plans'], ['Tafel', 'plans'], ['Checkliste', 'checklists'],
  ['Trupps', 'atemschutz'], ['Anwesenheit', 'anwesenheit'], ['Material', 'mittel'], ['Rapport', 'rapport'],
] as const

interface Journey { page: Page; seeded: Seeded; r: Results; net: ReturnType<typeof watchNetwork>; cdp: Awaited<ReturnType<typeof cdpFor>>; external: string[] }

/** Seed an Einsatz, sign the context in and open the app on it. The cold start journey logs in
 *  through the kiosk instead (`viaKiosk`), because that IS what it measures. */
async function open(page: Page, baseURL: string, name: string, { viaKiosk = false } = {}): Promise<Journey> {
  const context = page.context()
  const external: string[] = []
  await isolateFromOutside(context, baseURL, external)
  // the seeding has a session of its own: the browser starts signed out, like a tablet at the kiosk
  const station = await apiRequest.newContext({ baseURL })
  await signIn(station)
  const seeded = await seedIncident(station, `Perf · ${name} · ${Date.now().toString(36)}`)
  await station.dispose()
  test.info().annotations.push({ type: 'incident', description: seeded.id })
  await remember(context, baseURL, seeded.id)
  await buildingAlreadyRead(context, seeded)
  if (!viaKiosk) await signIn(context.request)
  await instrument(page)
  const net = watchNetwork(context, baseURL)
  const cdp = await cdpFor(page)
  return { page, seeded, r: new Results(name), net, cdp, external }
}

/** a workspace save, whichever route it takes: the whole document, or the trupp / record slice
 *  (an editor's Trupp-only save goes the slice since 18.10.2026 — counting `/workspace` alone
 *  would read that as «no saves») */
const isSave = (x: { method: string; path: string }) => x.method === 'PUT' && /\/workspace(\/(trupps|record))?$/.test(x.path)

/** what the live follow DOWNLOADED: the workspace reads that carried the blob. On a walk with one
 *  device every one of them is this device's own save coming back — which the follow no longer
 *  fetches since 18.10.2026 (the poll's `writer=`, answered 304 + X-Workspace-Rev). */
function recordFollowPulls(r: Results, reqs: { method: string; path: string; bytes: number }[]) {
  const pulls = reqs.filter((x) => x.method === 'GET' && /\/workspace$/.test(x.path) && x.bytes > 0)
  r.set('workspace_pulls', pulls.length, 'count')
  r.set('workspace_pull_kb', pulls.reduce((a, x) => a + x.bytes, 0) / 1024, 'kb')
}

const railButton = (page: Page, label: string) => page.locator('nav.navrail').getByRole('button', { name: label, exact: true })

/** the surface is on: the app is in its mode and its rail button is the pressed one (Gebäude and
 *  Tafel share the mode `plans`) */
const surfaceOn = async (page: Page, label: string, mode: string) => {
  const on = await page.waitForFunction(([l, m]) => {
    if (!document.querySelector('.app')?.classList.contains(`mode-${m}`)) return false
    return [...document.querySelectorAll('nav.navrail button[aria-pressed="true"]')].some((b) => (b.getAttribute('aria-label') || b.textContent || '').trim() === l)
  }, [label, mode] as const, { polling: POLL_MS, timeout: 30_000 }).then(() => true, () => false)
  if (on) return
  const seen = await page.evaluate(() => ({
    app: [...document.querySelectorAll('.app')].map((e) => e.className),
    pressed: [...document.querySelectorAll('nav.navrail button[aria-pressed="true"]')].map((b) => b.getAttribute('aria-label')),
    dialogs: [...document.querySelectorAll('[role="dialog"], [role="alertdialog"]')].map((d) => (d.textContent ?? '').slice(0, 80)),
  }))
  throw new Error(`«${label}» never came on (mode-${mode}): ${JSON.stringify(seen)}`)
}

async function goTo(page: Page, label: string, mode: string) {
  await railButton(page, label).click()
  await surfaceOn(page, label, mode)
}

/** One timed surface switch: a raw tap on the rail button, until the surface reports itself. */
async function timedSwitch(page: Page, label: string, mode: string) {
  const at = await centre(page, railButton(page, label))
  return timeTo(page, () => page.mouse.click(at.x, at.y), () => surfaceOn(page, label, mode))
}

test.afterEach(async ({ baseURL }, info) => {
  const id = info.annotations.find((a) => a.type === 'incident')?.description
  if (!id) return
  const station = await apiRequest.newContext({ baseURL })
  await signIn(station)
  await retire(station, id)
  await station.dispose()
})

// ─────────────────────────────────────────────────────────────────────────────────────────────

test('calibration: how fast is this machine today', async ({ page }) => {
  await page.goto('about:blank')
  const r = new Results('env')
  const runs = [await calibrate(page), await calibrate(page), await calibrate(page)]
  r.set('calibration', median(runs), 'ms')
  r.save({ cpuThrottle: CPU_THROTTLE, node: process.version })
})

test('cold start: kiosk login → the Einsatz on the Karte', async ({ page, baseURL }) => {
  const j = await open(page, baseURL!, 'cold-start', { viaKiosk: true })
  const from = Date.now()
  const t0 = performance.now()
  await page.goto('/')
  await page.locator('.roster-tile').first().waitFor({ state: 'visible' })
  j.r.set('login_screen_ms', performance.now() - t0, 'ms')
  // the PIN typed, the ✓ pressed: from here on it is the app's time, not the test's
  await page.locator('.roster-tile').first().click()
  await page.locator('.pinpad').waitFor({ state: 'visible' })
  for (const digit of PIN) await page.keyboard.press(digit)
  const loginAt = performance.now()
  await page.keyboard.press('Enter')
  await page.locator(EINSATZ_RAIL).waitFor({ state: 'visible', timeout: 60_000 })
  j.r.set('pin_to_workspace_ms', performance.now() - loginAt, 'ms')
  // the opening cover lifts once the first screen is whole — or at its 8 s cap (lib/bootCover):
  // a number near 8 000 here means something it waits for never arrived
  await waitForWorkspace(page)
  j.r.set('pin_to_ready_ms', performance.now() - loginAt, 'ms')
  j.r.set('total_ms', performance.now() - t0, 'ms')
  const { long } = await drain(page)
  j.r.set('blocking_ms', blocking(long), 'ms')
  j.r.set('long_tasks', long.length, 'count')
  // what an Einsatz opening costs on the wire. Until the wire goes quiet, not a fixed wait: a lazy data file landed inside a 3 s window on
  // one run and after it on the next (51.6 vs 56.2 KB).
  await j.net.quiet(2_000, 30_000)
  const reqs = j.net.since(from)
  recordNetwork(j.r, '', reqs)
  // opening an Einsatz should not have to write it: every save here is one per device per open
  // (the building outlines are a read that happens to be a POST; /api/diag is the launch timing line)
  j.r.set('writes', reqs.filter((x) => x.kind === 'api' && x.method !== 'GET' && !/^\/api\/(auth|overpass|diag)\//.test(x.path)).length, 'count')
  const held = await retained(j.cdp)
  j.r.set('heap_mb', held.heapMb, 'mb')
  j.r.set('dom_nodes', held.nodes, 'count')
  j.r.set('listeners', held.listeners, 'count')
  j.r.save({ routes: routeTally(reqs), external: [...new Set(j.external)] })
})

test('warm reload: the installed app opens the Einsatz again', async ({ page, baseURL }) => {
  const j = await open(page, baseURL!, 'warm-reload')
  await page.goto('/')
  await waitForWorkspace(page)
  // the service worker has to own the page before a reload can be served from its precache
  await page.evaluate(async () => { await navigator.serviceWorker.ready })
  await page.waitForTimeout(2_000)
  const shell: number[] = []
  const ready: number[] = []
  const blocked: number[] = []
  let reqs: ReturnType<typeof j.net.since> = []
  for (let i = 0; i < 3; i++) {
    const from = Date.now()
    const t0 = performance.now()
    await page.reload()
    await page.locator(EINSATZ_RAIL).waitFor({ state: 'visible', timeout: 60_000 })
    shell.push(performance.now() - t0)
    await waitForWorkspace(page)
    ready.push(performance.now() - t0)
    await page.waitForTimeout(2_000)
    blocked.push(blocking((await drain(page)).long))
    reqs = j.net.since(from)
  }
  j.r.set('reload_to_workspace_ms', median(shell), 'ms')
  j.r.set('reload_to_ready_ms', median(ready), 'ms')
  j.r.set('blocking_ms', median(blocked), 'ms')
  // the last reload's traffic: a static request here means the precache missed something
  recordNetwork(j.r, '', reqs)
  j.r.save({ routes: routeTally(reqs) })
})

test('surface tour: every surface, four laps — switch time and what each lap leaves behind', async ({ page, baseURL }) => {
  const j = await open(page, baseURL!, 'surface-tour')
  await page.goto('/')
  await waitForWorkspace(page)
  // lap 0 loads every lazy chunk and warms the caches; it is not timed. It reads each surface as
  // long as a timed lap does: a surface left before it painted has not decoded its CSS mask images
  // yet, and each SVG mask is a small image document the renderer keeps (3 nodes for one circle).
  // Two masks first painted in lap 1 (Gebäude's grey lamp, the Rapport's open mark) read as
  // `dom_node_growth` 6, flat over laps 1–4 (06.11.2026). One read of 250ms was enough locally
  // but not on the slower CI runner, so the warm-up walks twice – a one-time cost lands in it,
  // a leak still grows over the four timed laps.
  for (let warm = 0; warm < 2; warm++) {
    for (const [label, mode] of SURFACES) {
      await goTo(page, label, mode)
      await page.waitForTimeout(250)
    }
  }
  await goTo(page, ...SURFACES[0])
  await page.waitForTimeout(1_000)
  const first = await retained(j.cdp)
  await drain(page)
  const per: Record<string, number[]> = {}
  const LAPS = 4
  for (let lap = 0; lap < LAPS; lap++) {
    for (const [label, mode] of [...SURFACES.slice(1), SURFACES[0]]) {
      ;(per[label] ??= []).push(await timedSwitch(page, label, mode))
      await page.waitForTimeout(250) // a crew reads before it taps again
    }
  }
  const { long, interactions } = await drain(page)
  await page.waitForTimeout(1_000)
  const last = await retained(j.cdp)
  for (const [label, ts] of Object.entries(per)) j.r.set(`switch_${label.toLowerCase().replace('ä', 'ae')}_ms`, median(ts), 'ms')
  j.r.set('switch_p50_ms', median(Object.values(per).flat()), 'ms')
  j.r.set('interaction_max_ms', Math.max(0, ...interactions), 'ms')
  j.r.set('blocking_ms', blocking(long), 'ms')
  // a surface that leaks on unmount leaves something behind every lap
  j.r.set('heap_growth_mb', Math.max(0, last.heapMb - first.heapMb), 'mb')
  j.r.set('dom_node_growth', Math.max(0, last.nodes - first.nodes), 'count')
  j.r.set('listener_growth', Math.max(0, last.listeners - first.listeners), 'count')
  j.r.save()
})

test('karte & tafel: draw ten Linien, drop ten Absperrkreise', async ({ page, baseURL }) => {
  const j = await open(page, baseURL!, 'edit')
  await page.goto('/')
  await waitForWorkspace(page)
  await goTo(page, 'Karte', 'map')
  const canvas = page.locator('canvas.maplibregl-canvas').first()
  await expect(canvas).toBeVisible()
  await page.waitForTimeout(1_500)
  // ⚠️ The Karte draws UNTHROTTLED even under PERF_CPU, and its number is the app's own script
  // time, not the wall clock. Headless Chromium has no GPU: MapLibre renders through software
  // WebGL, and a drawn Linie spent ~95 % of its time there (CPU profile, 05.10.2026: «(program)»
  // 6.9 s of 7.3 s), in 0.5–2 s swings from one Linie to the next. Throttled 4×, the page stopped
  // producing frames for minutes. A wall-clock number here would measure SwiftShader on the day.
  await j.cdp.send('Emulation.setCPUThrottlingRate', { rate: 1 })
  await drain(page)
  const from = Date.now()
  const c0 = await counters(j.cdp)
  const box = (await canvas.boundingBox())!
  // freehand Linien across a band of the Karte where the seeded symbols are sparse: a drag that
  // starts on a marker would move the symbol instead
  for (let i = 0; i < 10; i++) {
    await page.keyboard.press('l')
    const x = box.x + box.width * 0.15, y = box.y + box.height * (0.12 + i * 0.02)
    await page.mouse.move(x, y)
    await page.mouse.down()
    for (let s = 1; s <= 10; s++) await page.mouse.move(x + s * 18, y + (s % 2) * 5)
    await page.mouse.up()
    await painted(page)
    await page.keyboard.press('Escape')
  }
  const c1 = await counters(j.cdp)
  const karte = await drain(page)
  await expect(page.locator('.tb-act-history').first(), 'no Linie was drawn').toBeEnabled()
  j.r.set('karte_script_ms', (c1.ScriptDuration - c0.ScriptDuration) * 1000, 'ms')
  j.r.set('karte_long_tasks', karte.long.length, 'count')
  if (CPU_THROTTLE > 1) await j.cdp.send('Emulation.setCPUThrottlingRate', { rate: CPU_THROTTLE })

  await goTo(page, 'Tafel', 'plans')
  const board = page.locator('.whiteboard').first()
  await expect(board).toBeVisible()
  const cordonTool = page.getByRole('button', { name: 'Absperrkreis', exact: true })
  await cordonTool.click() // the ink layer is there only while a drawing tool is armed
  await page.locator('.wb-ink').first().waitFor({ state: 'visible' })
  const ink = (await page.locator('.wb-ink').first().boundingBox())!
  const rings = page.locator('.wb-ink-svg circle')
  await drain(page)
  const taps: number[] = []
  for (let i = 0; i < 10; i++) {
    // a placed circle hands the board back to «Auswahl»: arm the tool again, untimed
    if (i) await cordonTool.click()
    const before = await rings.count()
    const x = ink.x + ink.width * (0.2 + (i % 5) * 0.15), y = ink.y + ink.height * (i < 5 ? 0.35 : 0.65)
    taps.push(await timeTo(page, () => page.mouse.click(x, y),
      () => page.waitForFunction((n) => document.querySelectorAll('.wb-ink-svg circle').length > n, before, { polling: POLL_MS, timeout: 30_000 })))
    await page.waitForTimeout(400) // two taps in quick succession would read as a double-tap
  }
  const tafel = await drain(page)
  j.r.set('tafel_tap_ms', median(taps), 'ms')
  j.r.set('tafel_interaction_max_ms', Math.max(0, ...tafel.interactions), 'ms')
  j.r.set('tafel_blocking_ms', blocking(tafel.long), 'ms')

  // let every debounced save go out, then count what twenty edits cost on the wire
  await page.waitForTimeout(6_000)
  const reqs = j.net.since(from)
  const saves = reqs.filter(isSave)
  j.r.set('saves', saves.length, 'count')
  // per save, not in total: how many saves twenty edits make depends on the debounce's timing,
  // what one save weighs does not (it grows with the blob — or with a field that should not be in it)
  j.r.set('kb_per_save', saves.length ? saves.reduce((a, x) => a + x.upBytes, 0) / 1024 / saves.length : 0, 'kb')
  recordFollowPulls(j.r, reqs)
  recordNetwork(j.r, '', reqs)
  j.r.save({ routes: routeTally(reqs) })
})

test('verlauf: ten Meldungen, the full Verlauf, another device\'s entry', async ({ page, baseURL }) => {
  const j = await open(page, baseURL!, 'verlauf')
  await page.goto('/')
  await waitForWorkspace(page)
  await page.waitForTimeout(1_500)
  // ⚠️ The live positions poll ticks every 15 s (usePersonPositions · pollMs). Start right after a
  // tick, so the walk holds at most the next one: with the untimed waits below it runs close to
  // 15 s, and CI counted that tick in one of two runs (32 / 33, 13.10.2026) – the best-of-two takes
  // the 32. Waited for, not required: no tick in 20 s is no tick to count.
  await page.waitForEvent('requestfinished', { predicate: (r) => /\/positions$/.test(new URL(r.url()).pathname), timeout: 20_000 }).catch(() => null)
  await drain(page)
  const from = Date.now()
  const field = page.getByPlaceholder('Was ist passiert? Meldung, Beobachtung, Entscheid …')
  const submits: number[] = []
  for (let i = 0; i < 10; i++) {
    await page.getByRole('button', { name: 'Eintrag', exact: true }).click()
    await field.fill(`Perf Meldung ${i + 1}: Lage unverändert, Angriff läuft`)
    const at = await centre(page, page.getByRole('button', { name: 'Erfassen', exact: true }))
    // the long poll this Meldung wakes, asked again — the first held request issued after the tap
    const rearmed = page.waitForRequest((r) => /\/journal\?.*\bwait=1\b/.test(r.url()), { timeout: 15_000 })
    submits.push(await timeTo(page, () => page.mouse.click(at.x, at.y), () => field.waitFor({ state: 'hidden' })))
    // ⚠️ Untimed: let the Meldung land before the next one — its POST, the pull after it, and the
    // long poll it woke, asked again. Typed back to back, a POST fell into the long poll's 250 ms
    // re-arm gap (pollBackoff · LONG_POLL_SPACING_MS) on some runs and woke nothing, or two
    // Meldungen shared a POST: what ten of them cost then followed the runner's speed — 26–30 for
    // the same build in CI, 16–19 GETs (08.10.2026). Now each costs a POST, a pull and a wake.
    await rearmed
  }
  const auditFlushed = page.waitForEvent('requestfinished', { predicate: (r) => r.method() === 'POST' && /\/events$/.test(new URL(r.url()).pathname), timeout: 10_000 }).catch(() => null)
  const compose = await drain(page)
  j.r.set('submit_ms', median(submits), 'ms')
  j.r.set('compose_interaction_max_ms', Math.max(0, ...compose.interactions), 'ms')

  // the whole Verlauf: 316 seeded rows and the ten new ones — opened three times, the median
  // (one opening swung 224 → 374 ms between two runs of the same build)
  const toggle = page.getByRole('button').filter({ has: page.getByText('Verlauf', { exact: true }) }).first()
  const newest = page.getByText('Perf Meldung 10', { exact: false }).first()
  const opens: number[] = []
  const blocked: number[] = []
  for (let i = 0; i < 3; i++) {
    // by its visible word: with open Pendenzen the button is NAMED by the count («6 offen»)
    const at = await centre(page, toggle)
    await drain(page)
    opens.push(await timeTo(page, () => page.mouse.click(at.x, at.y), () => newest.waitFor({ state: 'visible' })))
    blocked.push(blocking((await drain(page)).long))
    if (i < 2) {
      await page.keyboard.press('Escape') // the open drawer covers its own button
      await newest.waitFor({ state: 'hidden', timeout: 30_000 })
      await page.waitForTimeout(500)
    }
  }
  j.r.set('open_verlauf_ms', median(opens), 'ms')
  j.r.set('open_verlauf_blocking_ms', median(blocked), 'ms')

  // another tablet writes a Meldung: how long until this one shows it (the Verlauf's long poll)
  const remote = `Fremdgerät ${Date.now().toString(36)}`
  const t0 = performance.now()
  const res = await page.context().request.post(`/api/incidents/${j.seeded.id}/journal`, {
    data: { entries: [{ id: `perf-remote-${Date.now()}`, t: new Date().toTimeString().slice(0, 5), at: new Date().toISOString(), icon: 'note', kind: 'journal', text: remote }] },
  })
  expect(res.ok(), `remote journal POST: HTTP ${res.status()} ${await res.text()}`).toBeTruthy()
  await page.getByText(remote).first().waitFor({ state: 'visible', timeout: 30_000 })
  j.r.set('remote_entry_visible_ms', performance.now() - t0, 'ms')

  // ⚠️ Settle for 2 s AND until the audit outbox has gone out: it flushes 4 s after the last act
  // (auditEventStore · append), which the fixed 2 s alone caught on some runs and not on others
  // (the same build, 08.10.2026). Waited for, not required: a build that writes no audit event
  // for a Meldung is not a failure of this walk.
  await Promise.all([page.waitForTimeout(2_000), auditFlushed])
  const reqs = j.net.since(from)
  j.r.set('journal_posts', reqs.filter((x) => x.method === 'POST' && /\/journal$/.test(x.path)).length, 'count')
  recordNetwork(j.r, '', reqs)
  j.r.save({ routes: routeTally(reqs) })
})

test('trupps: three rounds of Funkkontakt for every Trupp inside', async ({ page, baseURL }) => {
  const j = await open(page, baseURL!, 'trupps')
  expect(j.seeded.trupps.length, 'the seeded Einsatz has no Trupp inside').toBeGreaterThan(0)
  await page.goto('/')
  await waitForWorkspace(page)
  await goTo(page, 'Trupps', 'atemschutz')
  await page.waitForTimeout(1_500)
  await drain(page)
  const from = Date.now()
  const taps: number[] = []
  // a Trupp's card: the innermost element holding its name and a «Kontakt» (the board holds them all)
  const kontakt = page.getByRole('button', { name: 'Kontakt', exact: true })
  const card = (name: string) => page.locator('div').filter({ has: page.getByText(name, { exact: true }) }).filter({ has: kontakt }).last()
  for (let round = 0; round < 3; round++) {
    for (const name of j.seeded.trupps) {
      const at = await centre(page, card(name).getByRole('button', { name: 'Kontakt', exact: true }))
      // confirmed = the card's contact clock starts again from 0:00
      taps.push(await timeTo(page, () => page.mouse.click(at.x, at.y),
        () => card(name).getByText(/^0:0[01]$/).first().waitFor({ state: 'visible', timeout: 30_000 })))
      await page.waitForTimeout(2_500) // the radio exchange with the next Trupp
    }
  }
  const { long, interactions } = await drain(page)
  j.r.set('contact_ms', median(taps), 'ms')
  j.r.set('interaction_max_ms', Math.max(0, ...interactions), 'ms')
  j.r.set('blocking_ms', blocking(long), 'ms')
  await page.waitForTimeout(6_000)
  const reqs = j.net.since(from)
  const saves = reqs.filter(isSave)
  j.r.set('saves', saves.length, 'count')
  // what one Funkkontakt puts on the wire: a Trupp-only save goes the trupp slice route (18.10.2026)
  j.r.set('kb_per_save', saves.length ? saves.reduce((a, x) => a + x.upBytes, 0) / 1024 / saves.length : 0, 'kb')
  recordFollowPulls(j.r, reqs)
  recordNetwork(j.r, '', reqs)
  j.r.save({ routes: routeTally(reqs), contacts: taps.length })
})

test('idle: a minute on the Karte with nobody touching it', async ({ page, baseURL }) => {
  const j = await open(page, baseURL!, 'idle')
  await page.goto('/')
  await waitForWorkspace(page)
  await goTo(page, 'Karte', 'map')
  await page.waitForTimeout(5_000) // the opening's own traffic and renders are not idle
  const start = await retained(j.cdp)
  const c0 = await counters(j.cdp)
  await drain(page)
  const from = Date.now()
  const IDLE_MS = 60_000
  await page.waitForTimeout(IDLE_MS)
  const c1 = await counters(j.cdp)
  const { long } = await drain(page)
  const reqs = j.net.since(from)
  const end = await retained(j.cdp)
  const perMin = 60_000 / IDLE_MS
  // a tablet on the table for hours: every wake-up here is battery and radio
  j.r.set('api_requests_per_min', reqs.filter(isAppApi).length * perMin, 'count')
  j.r.set('saves', reqs.filter(isSave).length, 'count')
  j.r.set('script_ms_per_min', (c1.ScriptDuration - c0.ScriptDuration) * 1000 * perMin, 'ms')
  j.r.set('task_ms_per_min', (c1.TaskDuration - c0.TaskDuration) * 1000 * perMin, 'ms')
  j.r.set('layouts_per_min', (c1.LayoutCount - c0.LayoutCount) * perMin, 'count')
  j.r.set('style_recalcs_per_min', (c1.RecalcStyleCount - c0.RecalcStyleCount) * perMin, 'count')
  j.r.set('long_tasks', long.length, 'count')
  j.r.set('heap_growth_mb', Math.max(0, end.heapMb - start.heapMb), 'mb')
  j.r.set('dom_node_growth', Math.max(0, end.nodes - start.nodes), 'count')
  j.r.save({ routes: routeTally(reqs) })
})
