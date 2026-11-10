import type { BrowserContext } from '@playwright/test'
import { test, expect } from './helpers'
import { buildingAlreadyRead, isolateFromOutside, remember, retire, seedIncident, signIn, waitForWorkspace } from './perf/harness'

// Opening an Einsatz must not write it (18.10.2026). The perf journeys measure what an open costs
// on the wire (`cold-start.writes`, docs/testing/perf-journeys.md), but their count gate tolerates
// +2, so a new save on open would pass it. This holds the open of an Einsatz this build has
// already saved at exactly 0 writes.
//
// ⚠️ OPT-IN like workspace-flows (E2E_WORKFLOWS=1, chromium only): it seeds and archives an
// Einsatz, so never against a shared demo or a station in use. CI enables it against its
// disposable image container; locally, a private stack (workspace-flows.spec.ts says how).

test.skip(!process.env.E2E_WORKFLOWS, 'opt-in (E2E_WORKFLOWS=1): it writes an Einsatz — run it on a private stack')

test.beforeEach(async ({ page, browserName }) => {
  test.skip(browserName !== 'chromium', 'chromium only')
  const config = await page.request.get('/api/config')
  test.skip(config.ok() && (await config.json()).identity?.demoMode === true, 'writes an Einsatz — never against a shared demo')
  await signIn(page.request)
})

/** Every write this context sends to the Einsatz (the journey's `cold-start.writes` filter: sign-in,
 *  the launch timing line and the building outlines — a read that happens to be a POST — are not
 *  writes). */
function writesOf(context: BrowserContext): string[] {
  const seen: string[] = []
  context.on('request', (r) => {
    const { pathname } = new URL(r.url())
    if (r.method() !== 'GET' && pathname.startsWith('/api/') && !/^\/api\/(auth|overpass|diag)\//.test(pathname)) seen.push(`${r.method()} ${pathname}`)
  })
  return seen
}

test('opening an Einsatz this build has already saved writes nothing', async ({ page, browser, baseURL }) => {
  // The perf journeys count 2 writes per open (cold-start.writes: a workspace PUT and a Verlauf
  // POST). Measured 18.10.2026, both are the ONE-TIME upgrade of the seeded Einsatz, not a no-op:
  // the seed is schemaVersion 2 (→ 3, planBindings derived) and its Trupps' crews were never filed
  // on the Anwesenheit (lib/crewFiling: attendance rows + `crewFiled` + one «Unter AS» row per
  // Trupp, all under derived ids). Those stay. What must cost nothing is the open AFTER that —
  // the same device reloading, and a second device — or every tablet that opens a running
  // Einsatz writes it back (a save on open: docs/testing/perf-journeys.md).
  test.setTimeout(120_000)
  const seeded = await seedIncident(page.request, `E2E open writes · ${Date.now().toString(36)}`)
  const id = seeded.id
  try {
    const context = page.context()
    await isolateFromOutside(context, baseURL!, [])
    await buildingAlreadyRead(context, seeded)
    await remember(context, baseURL!, id)
    const first = writesOf(context)
    await page.goto('/')
    await waitForWorkspace(page)
    // the first open's upgrade has gone out once the server's copy holds still — the workspace
    // revision AND the Verlauf — for longer than the save debounce (3 s)
    const stamp = async () => {
      const ws = await (await page.request.get(`/api/incidents/${id}/workspace`)).json()
      const journal = await (await page.request.get(`/api/incidents/${id}/journal`)).json()
      return `${ws.workspace_rev}|${JSON.stringify(journal).length}`
    }
    let last = '', still = 0
    for (let i = 0; i < 40 && still < 5; i++) {
      const now = await stamp()
      still = now === last ? still + 1 : 0
      last = now
      await page.waitForTimeout(1_000)
    }
    expect(still, 'the first open never settled').toBe(5)
    // not asserted (a current seed would write nothing), only reported: the counter sees writes
    test.info().annotations.push({ type: 'first open', description: first.join(', ') || 'no writes' })

    // the same device, again (its offline cache is warm)
    const reload = writesOf(context)
    await page.reload()
    await waitForWorkspace(page)
    await page.waitForTimeout(6_000) // the save debounce (3 s) twice
    expect(reload, 'the reload wrote').toEqual([])

    // a second device (nothing cached)
    const other = await browser.newContext({ baseURL })
    try {
      await isolateFromOutside(other, baseURL!, [])
      await buildingAlreadyRead(other, seeded)
      await remember(other, baseURL!, id)
      await signIn(other.request)
      const second = writesOf(other)
      const p2 = await other.newPage()
      await p2.goto('/')
      await waitForWorkspace(p2)
      await p2.waitForTimeout(6_000)
      expect(second, 'the second device wrote').toEqual([])
    } finally {
      await other.close()
    }
  } finally {
    await retire(page.request, id)
  }
})
