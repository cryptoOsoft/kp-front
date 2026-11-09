import { request as apiRequest, type APIRequestContext, type Page } from '@playwright/test'
import { expect } from './guard'

// Specs take `test` and `expect` from here: `test` carries the client-error guard (./guard.ts).
export { test, expect, expectNoClientErrors, OFFLINE_FETCH_FAILURE, type ClientErrorReport } from './guard'

// The login / open-an-incident steps every flow spec starts with — moved here verbatim from
// smoke.spec.ts (23.09.2026) so workspace-flows.spec.ts reuses them instead of copying them.
// The German strings mirror src/config/copy/de.ts (the default de-CH deployment locale).

// Seed kiosk PIN — the committed dev seed (backend/app/seed_users.json). Override
// with E2E_PIN if a deployment seeds a different one.
export const PIN = process.env.E2E_PIN || '000000'

/** The deployment's ADMIN_SECRET – the admin API is gated on it alone. A spec that prepares
 *  station data (an object, a checklist, a config section) skips without it; CI always sets it. */
export const ADMIN_SECRET = process.env.E2E_ADMIN_SECRET

/** An admin API session of its own (never the page's cookie jar). Dispose it when done. */
export async function adminContext(baseURL: string | undefined): Promise<APIRequestContext> {
  const api = await apiRequest.newContext({ baseURL, extraHTTPHeaders: { 'X-Incident-Link': 'off' } })
  const r = await api.post('/api/admin/login', { data: { secret: ADMIN_SECRET } })
  expect(r.ok(), `admin login: ${r.status()}`).toBe(true)
  return api
}

// The ErrorBoundary render-throw fallback (copy/de/session.ts → errorBoundary.title). If this
// is on screen a surface crashed on mount — the exact failure this smoke exists to catch.
const CRASH_TITLE = 'Ein Fehler ist aufgetreten'

export async function expectNoCrash(page: Page, where: string) {
  await expect(
    page.getByText(CRASH_TITLE),
    `${where}: surface crashed (ErrorBoundary fallback shown)`,
  ).toHaveCount(0)
}

/**
 * Open `path` and wait until the boot cover has lifted (lib/snailLaunch · liftBootCover). The app
 * is inert beneath the cover, and a `fill` or a key press – unlike a click – does not wait for
 * it: the text just vanishes (the admin secret, CI 08.11.2026). Every spec that navigates and
 * then types opens the app through this; only the boot-cover timing tests use a bare `goto`.
 */
export async function openApp(page: Page, path: string) {
  await page.goto(path)
  await expect(page.locator('.boot-splash'), 'the boot cover must lift').toHaveCount(0)
}

export async function login(page: Page) {
  await openApp(page, '/')
  // A station starts on kiosk login; the public demo auto-authenticates and lands directly in
  // its prepared incident. Accept both so the same production-image smoke covers both entryways.
  // ⚠️ ONE locator, not `Promise.race` over two `waitFor`s: the loser of that race stays
  // pending and rejects with a TimeoutError ~30 s later, with nobody left to catch it. Playwright
  // fails the run on an unhandled rejection — typically inside whichever test happens to be
  // running by then, which is not this one.
  const tile = page.locator('.roster-tile').first()
  await page.locator('.roster-tile, nav.navrail').first().waitFor({ state: 'visible' })
  if (await tile.isVisible()) {
    await tile.click()
    await expect(page.locator('.pinpad')).toBeVisible()
    for (const digit of PIN) await page.keyboard.press(digit)
    // the pad no longer auto-submits on a fixed length (06.09.) — Enter is the ✓
    const authenticated = page.waitForResponse((response) => response.url().endsWith('/api/auth/login') && response.request().method() === 'POST')
    await page.keyboard.press('Enter')
    const response = await authenticated
    expect(response.ok(), 'seeded kiosk login must succeed').toBe(true)
    await response.finished()
  }

  // The demo's first-visit contract intentionally owns the screen until acknowledged. Read the
  // deployment flag rather than racing an immediate isVisible() against the async config load.
  const config = await page.request.get('/api/config')
  const demoMode = config.ok() && (await config.json()).identity?.demoMode === true
  if (demoMode) {
    const demoWelcome = page.locator('.dw-card')
    await expect(demoWelcome).toBeVisible()
    await demoWelcome.locator('.dw-cta').click()
  }
}

// After login the app shows either home (no open incident: «Karte & Objekte») or, if one is
// already open server-side, the incident surfaces directly. Normalise to "an incident
// is open" so the smoke is idempotent across a fresh container and a re-run.
/** The Einsatz's rail – NOT the Karte & Objekte home's, which shares the `navrail` look and is
 *  on screen whenever no Einsatz is open (its left rail always shows since the «Checkliste»
 *  surface, 19.10.2026). Wait on this to know an Einsatz is open. */
export const EINSATZ_RAIL = 'nav.navrail:not([data-karte] nav)'

export async function ensureIncidentOpen(page: Page) {
  const navrail = page.locator(EINSATZ_RAIL)

  // Home can briefly FLASH before the workspace loads and swaps in an
  // already-open incident, so we can't branch on the CTA being momentarily visible.
  // Instead: give the navrail a chance to appear (incident loaded); only if it never
  // does is the deployment genuinely empty — then open a manual incident.
  try {
    await expect(navrail).toBeVisible({ timeout: 12_000 })
    return
  } catch {
    /* no incident open — fall through to create one */
  }

  // Nothing open → open a manual incident (no Divera, no coordinate needed). With no Einsatz
  // open an account lands on «Karte & Objekte» (16.10.2026), whose menu button («FWO ▾», round 5) opens the app
  // menu (17.10.2026: the same rows as the Einsatz menu); «Einsatz eröffnen» there opens the
  // create wizard form directly.
  await page.locator('[data-karte]').waitFor({ state: 'visible' })
  await page.locator('[data-karte-menu]').click()
  await page.getByRole('button', { name: 'Einsatz eröffnen' }).click()
  await page.getByPlaceholder('z. B. Gebäudebrand Schulhaus').fill('E2E Smoke Test')
  await page.getByRole('dialog').getByRole('button', { name: 'Einsatz eröffnen', exact: true }).click()
  await expect(navrail).toBeVisible()
}
