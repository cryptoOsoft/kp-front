import type { Page } from '@playwright/test'
import { readFile } from 'node:fs/promises'

// White-screen smoke: log in, open an incident, render each core surface, and
// survive a reload with state intact. This is the catastrophic-regression guard
// (build broke / a surface throws on mount / login or session is wedged) that the
// pure-logic unit suite cannot see. Kept deliberately robust over deep: it asserts
// "every major surface renders and the session/incident persist", not pixel detail.
//
// Runs against a live, seeded stack (see playwright.config.ts). The German strings
// below mirror src/config/copy/de.ts (the default de-CH deployment locale).

import { test, expect, expectNoCrash, login, ensureIncidentOpen, OFFLINE_FETCH_FAILURE } from './helpers'

test('core surfaces render and survive reload', async ({ page }) => {
  await login(page)
  await ensureIncidentOpen(page)

  // Karte (map): the MapLibre canvas must actually mount, not just the chrome.
  await page.getByRole('button', { name: 'Karte', exact: true }).click()
  await expect(page.locator('canvas.maplibregl-canvas').first()).toBeVisible()
  await expectNoCrash(page, 'Karte')

  // Plan: the always-present generic sheet ("Tafel" = Leeres Blatt) renders the whiteboard.
  await page.getByRole('button', { name: 'Tafel', exact: true }).click()
  await expect(page.locator('.whiteboard').first()).toBeVisible()
  await expectNoCrash(page, 'Plan')

  // Trupps (the Atemschutz/SCBA board, renamed 04.09. — it carries work squads too) — a heavy
  // surface; prove it switches in and mounts clean.
  await page.getByRole('button', { name: 'Trupps', exact: true }).click()
  await expect(page.getByRole('button', { name: 'Trupps', exact: true })).toHaveAttribute('aria-pressed', 'true')
  await expectNoCrash(page, 'Trupps')

  // Assert mounted content: rail selection alone cannot detect a lazy surface crashing.
  await page.getByRole('button', { name: 'Checkliste', exact: true }).click()
  await expect(page.locator('[class*="cl-surface"]')).toBeVisible()
  await expectNoCrash(page, 'Checkliste')
  for (const name of ['Anwesenheit', 'Material']) {
    await page.locator('nav.navrail').getByRole('button', { name, exact: true }).click()
    await expect(page.getByRole('heading', { name, exact: true })).toBeVisible()
    await expectNoCrash(page, name)
  }
  await page.locator('nav.navrail').getByRole('button', { name: 'Rapport', exact: true }).click()
  await expect(page.locator('.report-preflight-body')).toBeVisible()
  await expectNoCrash(page, 'Rapport')

  // Reload: the session cookie + the synced incident workspace + the surface pref must
  // all survive — i.e. no white-screen, no kicked-to-login, no lost incident.
  await page.reload()
  await expect(page.locator('nav.navrail'), 'still authenticated and in an incident after reload').toBeVisible()
  await expectNoCrash(page, 'after reload')
})

async function enterJournalRow(page: Page, text: string) {
  await page.getByRole('button', { name: 'Eintrag', exact: true }).click()
  await page.getByPlaceholder('Was ist passiert? Meldung, Beobachtung, Entscheid …').fill(text)
  await page.getByRole('button', { name: 'Erfassen', exact: true }).click()
  await page.getByRole('button', { name: 'Verlauf', exact: true }).click()
}

test.describe(() => {
  // A service worker can forward requests outside page.route (observed on Linux WebKit).
  // This drill needs a guaranteed server rejection; actual service-worker coverage stays
  // in the core reload and separate offline-recovery tests.
  test.use({ serviceWorkers: 'block' })

  test('session renewal and rejected journal delivery recover', async ({ page, context }) => {
    await login(page)
    const config = await page.request.get('/api/config')
    test.skip((await config.json()).identity?.demoMode === true, 'Recovery drill requires an ordinary station session')
    await ensureIncidentOpen(page)
    // ⚠️ The old page is still alive between these two lines: a request of its own may 401 and
    // start a refresh that the reload then tears down mid-flight. The server has rotated by
    // then, the browser never stored the successor — and until 24.09.2026 that signed the
    // device out (3 in 40 locally; backend auth/router · refresh now re-delivers it). Kept
    // racy on purpose: it is the reload-while-renewing a real tablet does too.
    await context.clearCookies({ name: 'access_token' })
    await page.reload()
    await expect(
      page.locator('nav.navrail'),
      'the refresh cookie must renew the session after a reload – the container log says why a refresh was refused',
    ).toBeVisible()

    // A locally visible row must never masquerade as accepted by the server.
    const endpoint = '**/api/incidents/*/journal'
    let rejectedPosts = 0
    await page.route(endpoint, async (route) => {
      if (route.request().method() !== 'POST') return route.continue()
      await route.fulfill({ status: 422, contentType: 'application/json', body: '{"detail":"Synthetic rejection drill"}' })
      rejectedPosts++
    })
    const rejected = `E2E recovery ${Date.now()}`
    await enterJournalRow(page, rejected)
    await expect.poll(() => rejectedPosts, 'The journal POST must receive the synthetic 422').toBeGreaterThan(0)
    const notice = page.locator('.jr-delivery')
    await expect(notice).toContainText('Auf diesem Gerät gespeichert')
    const downloading = page.waitForEvent('download')
    await notice.getByRole('button', { name: 'Einträge sichern' }).click()
    const path = await (await downloading).path()
    if (!path) throw new Error('Recovery export was not downloaded')
    expect(await readFile(path, 'utf8')).toContain(rejected)
    await expect(notice).toBeVisible() // exporting does not acknowledge delivery
    await page.unroute(endpoint)
    await notice.getByRole('button', { name: 'Erneut versuchen' }).click()
    await expect(notice).toHaveCount(0)
  })
})

test.describe('loading snail', () => {
  test.use({ serviceWorkers: 'block' })

  type Launch = {
    /** The boot cover's entrance at the moment it starts to lift (lib/snailLaunch · liftBootCover):
     *  its own clock then (performance time since the animation's `startTime`), its length, its
     *  play state, the idle loop's clock, and what it lifts onto. */
    handover?: { clock: number; duration: number; playState: string; idleClock?: number; onto: { app: boolean; reactSplash: boolean; reactClock?: number } }
  }

  async function prepareLaunch(page: Page, { configDelay = 0, meDelay = 500 } = {}) {
    await page.emulateMedia({ reducedMotion: 'no-preference' })
    await page.route('**/api/config', async route => {
      if (configDelay) await new Promise(resolve => setTimeout(resolve, configDelay))
      await route.fulfill({ json: {} })
    })
    await page.route('**/api/plan-scales', route => route.fulfill({ json: {} }))
    await page.route('**/api/auth/me', async route => {
      // Keeps React's first Splash mounted beneath the cover for a while.
      await new Promise(resolve => setTimeout(resolve, meDelay))
      await route.fulfill({ status: 401, json: { detail: 'Not authenticated' } })
    })
    await page.route('**/api/auth/refresh', route => route.fulfill({ status: 401, json: { detail: 'Not authenticated' } }))
    await page.route('**/api/auth/roster', route => route.fulfill({ json: [] }))
    await page.addInitScript(() => {
      const state: Launch = {}
      Object.assign(window, { __snailLaunch: state })
      // ⚠️ Not `animationend`: WebKit and Chromium dispatch animation events only with a rendering
      // update, and on a loaded runner none came in time (CI 08.10.2026, run 37805366133). So read
      // the entrance's own clock at the moment the cover starts to lift – its `leaving` class.
      const handover = (cover: Element) => {
        const snail = cover.querySelector('.firefighter-snail')
        const arrival = snail?.getAnimations().find(animation => (animation as CSSAnimation).animationName === 'fs-arrival')
        if (state.handover || !arrival || typeof arrival.startTime !== 'number') return
        const shell = snail?.getAnimations({ subtree: true })
          .find(animation => (animation as CSSAnimation).animationName.endsWith('-shell'))
        const now = performance.now()
        const duration = Number(arrival.effect?.getComputedTiming().duration)
        // React's loader on the same footing: performance time since ITS shell's start (the
        // shell's delay equals the entrance, so both sides read «time since launch»)
        const reactShell = document.querySelector('#root .snail-loader svg')?.getAnimations({ subtree: true })
          .find(animation => (animation as CSSAnimation).animationName.endsWith('-shell'))
        const reactClock = typeof reactShell?.startTime === 'number' ? now - reactShell.startTime : undefined
        state.handover = {
          clock: now - arrival.startTime - Number(arrival.effect?.getTiming().delay || 0),
          duration,
          playState: arrival.playState,
          // A resumed one-shot is already finished and Chromium can report startTime=0 for it.
          // The still-running shell owns idle continuity; its delay includes the resume offset.
          idleClock: typeof shell?.startTime === 'number'
            ? now - shell.startTime - Number(shell.effect?.getTiming().delay || 0) + duration : undefined,
          onto: {
            app: !!document.querySelector('#root .login-state'),
            reactSplash: !!document.querySelector('#root .splash'),
            reactClock,
          },
        }
      }
      new MutationObserver(records => {
        for (const r of records) if (r.target instanceof Element && r.target.matches('.boot-splash.leaving')) handover(r.target)
      }).observe(document, { subtree: true, attributes: true, attributeFilter: ['class'] })
    })
  }

  const observation = (page: Page) => page.evaluate(() => Reflect.get(window, '__snailLaunch') as Launch)
  /** the cover's state at the moment it started to lift, once it has */
  async function lifted(page: Page, timeout = 5_000): Promise<NonNullable<Launch['handover']>> {
    await expect.poll(async () => (await observation(page)).handover, { timeout }).toBeDefined()
    const { handover } = await observation(page)
    if (!handover) throw new Error('the boot cover never started to lift')
    return handover
  }

  test('a fast startup shows the entire entrance, then lifts straight onto the app', async ({ page }) => {
    await prepareLaunch(page)
    await page.goto('/')
    const handover = await lifted(page)
    // The entrance ran, on its own clock, to its end (630 ms) before the cover began to lift.
    // Its clock is performance time since the animation's `startTime`: unlike `currentTime`, which
    // stands still between frames, it is exact at any moment, also when frames are overdue.
    expect(handover.duration).toBe(630)
    expect(['running', 'finished']).toContain(handover.playState)
    expect(handover.clock).toBeGreaterThanOrEqual(handover.duration)
    // React built the app beneath it: the cover lifts onto the login, no loading stage between.
    expect(handover.onto).toMatchObject({ app: true, reactSplash: false })
    await expect(page.locator('.boot-splash')).toHaveCount(0)
    await expect(page.locator('.login-state')).toBeVisible()
  })

  test('a slow boot keeps the cover idling and still lifts onto the app', async ({ page }) => {
    await prepareLaunch(page, { configDelay: 2_500 })
    await page.goto('/')
    const handover = await lifted(page)
    expect(handover.idleClock).toBeGreaterThan(2_500)
    expect(handover.onto).toMatchObject({ app: true, reactSplash: false })
    await expect(page.locator('.login-state')).toBeVisible()
    await expect(page.locator('.boot-splash')).toHaveCount(0)
  })

  test('a React loading stage the cover reveals continues its clock instead of replaying', async ({ page }) => {
    // React mounts ≥ 800 ms into the launch: a replayed loader would trail the cover by that much,
    // a continued one only by the frame a fresh animation takes to start (up to ~100 ms on a
    // loaded runner)
    await prepareLaunch(page, { configDelay: 800, meDelay: 4_000 })
    await page.goto('/')
    const handover = await lifted(page, 10_000)
    // still on the auth stage two seconds after the entrance: the cover reveals it (its status
    // and its «Neu laden» hint must be readable), and its snail is on the cover's clock
    expect(handover.onto.reactSplash).toBe(true)
    expect(handover.onto.reactClock).toBeGreaterThanOrEqual((handover.idleClock ?? Infinity) - 250)
    await expect(page.locator('.login-state')).toBeVisible()
  })

  test('an update reload resumes before the first paint and continues to the lift', async ({ page }) => {
    await prepareLaunch(page)
    await page.addInitScript(() => {
      sessionStorage.setItem('kp-snail-resume', JSON.stringify({ at: Date.now(), elapsed: 2_000 }))
    })
    await page.goto('/')
    const handover = await lifted(page)
    if (handover.idleClock === undefined) throw new Error('The resumed boot cover must retain its idle animation clock')
    expect(handover.clock).toBeGreaterThanOrEqual(2_000)
    expect(handover.idleClock).toBeGreaterThanOrEqual(2_000)
    expect(await page.evaluate(() => sessionStorage.getItem('kp-snail-resume'))).toBeNull()
    await expect(page.locator('.login-state')).toBeVisible()
  })
})

test.describe(() => {
  // Offline, the Karte's basemap tiles fail to load and MapView reports each failure (onError →
  // lib/reportError, kind «error», «AJAXError: Failed to fetch (0): <url>» since MapLibre 6). A
  // real device is quiet about it: reportError drops a bare fetch failure while `navigator.onLine`
  // is false. Chromium's offline
  // EMULATION is not: a document reloaded while offline reads `navigator.onLine === true`
  // (measured 24.09.2026), so the tiles of the reloaded Karte still report. That one report is
  // expected here; any other still fails the test (./guard.ts).
  test.use({ expectedClientErrors: [OFFLINE_FETCH_FAILURE] })

  test('offline journal entries survive reload and reconnect', async ({ page, context, browserName }) => {
    // Playwright's service-worker support is Chromium-only (playwright.dev/docs/service-workers).
    // WebKit offline emulation fails even for a minimal cached page; physical Safari remains
    // an acceptance gate. Core reload + session/rejection recovery above still run in WebKit.
    test.skip(browserName !== 'chromium', 'Offline service-worker automation requires Chromium')
    await login(page)
    const config = await page.request.get('/api/config')
    test.skip((await config.json()).identity?.demoMode === true, 'Recovery drill requires an ordinary station session')
    await ensureIncidentOpen(page)
    await page.evaluate(async () => { await navigator.serviceWorker.ready })
    await context.setOffline(true)
    const offline = `E2E offline ${Date.now()}`
    await enterJournalRow(page, offline)
    const notice = page.locator('.jr-delivery')
    await expect(notice).toBeVisible()
    await page.reload({ waitUntil: 'domcontentloaded' })
    await expect(page.locator('nav.navrail')).toBeVisible()
    await page.getByRole('button', { name: 'Verlauf', exact: true }).click()
    await expect(page.getByText(offline, { exact: true })).toBeVisible()
    await context.setOffline(false)
    // Delivery must come without a click, but not necessarily off the `online` event: after a
    // reload WHILE offline, Chromium's emulation sometimes never dispatches it (the top bar still
    // said «Offline» 15 s later, 24.09.2026). The outbox then goes out on the Verlauf's next poll
    // round, which pushes before it pulls (useJournal) and is at most `livePollMaxMs` (15 s) away.
    await expect(notice, 'the offline entry must be delivered on its own after reconnect').toHaveCount(0, { timeout: 30_000 })
    await expectNoCrash(page, 'after offline journal recovery')
  })
})
