import type { Browser, Page } from '@playwright/test'
import { test, expect, login, EINSATZ_RAIL } from './helpers'

// «Üben» end to end (08.11.2026, owner on staging: «I don't see any tooltips»). Started from the
// home screen, the run set its session and nothing else happened: the runner lived only inside a
// mounted Einsatz, so no Lern-Übung was opened and no pill or Sprechblase appeared. A Lern-Übung
// opened again later (a new tab, the PWA relaunched, another device) had no session either. This
// walks the owner's path in the built app:
//   · start T2 «Karte – die Lage zeichnen» from the menu of the screen in front – home with no
//     Einsatz, or home over an Einsatz left with «Einsatz verlassen» (whichever the stack boots
//     into; both are the owner's real paths) → the Lern-Übung opens, pill + Sprechblase stand;
//   · a new tab on this device → the run comes back on its step;
//   · a fresh device (no local progress) → the Lern-Übung's own tutorial starts.
//
// ⚠️ OPT-IN like workspace-flows (E2E_WORKFLOWS=1, chromium): it creates a Lern-Übung, deleted at
// the end. Never against the shared demo, whose door answers 403 anyway.

test.skip(!process.env.E2E_WORKFLOWS, '«Üben» e2e is opt-in (E2E_WORKFLOWS=1): it creates a Lern-Übung — run it on a private stack')

const FIRST_STEP = 'Setze ein TLF auf die Lage.'
const pill = (page: Page) => page.getByText(/^Üben \d+\/7$/)
const bubble = (page: Page) => page.getByText(FIRST_STEP)

/** an Einsatz is in front (its rail stands; home's bar wears the same menu-button class) */
const inEinsatz = (page: Page) => page.locator(EINSATZ_RAIL).isVisible()

/** the menu of whatever is in front: the Einsatz's title ▾, else home's «Menü» button */
async function openMenu(page: Page) {
  if (await inEinsatz(page)) await page.locator('.ip-switch-btn').first().click()
  else await page.getByRole('button', { name: /^Menü/ }).first().click()
}

/** the station's id of the Lern-Übung the run is bound to (the session, per tab) */
const lernId = (page: Page) => page.evaluate(() => JSON.parse(sessionStorage.getItem('kp.tutorial.session') ?? '{}').incidentId as string | undefined)

async function freshDevice(browser: Browser, baseURL: string) {
  const ctx = await browser.newContext({ baseURL, viewport: { width: 1180, height: 820 }, locale: 'de-CH', timezoneId: 'Europe/Zurich' })
  return { ctx, page: await ctx.newPage() }
}

test('«Üben» from the menu in front opens the Lern-Übung with its Sprechblase, and it comes back', async ({ page, browser, browserName, baseURL }) => {
  test.skip(browserName !== 'chromium', '«Üben» e2e runs on chromium only')
  // three app boots (this tab, a second tab, a second device) and a Lern-Übung seeded per run
  test.setTimeout(180_000)
  const config = await page.request.get('/api/config')
  test.skip(config.ok() && (await config.json()).identity?.demoMode === true, 'creates a Lern-Übung — never against a shared demo')
  await page.setViewportSize({ width: 1180, height: 820 })
  await login(page)

  // an Einsatz the stack booted into is left the way the owner leaves one – it keeps running
  // behind home – so the run starts from home either way
  await page.locator(`${EINSATZ_RAIL}, button[aria-label^="Menü"]`).first().waitFor()
  if (await inEinsatz(page)) {
    await page.locator('.ip-switch-btn').first().click()
    await page.getByRole('button', { name: /Einsatz verlassen/ }).click()
    await expect(page.getByRole('button', { name: /^Menü/ }).first()).toBeVisible()
  }

  await openMenu(page)
  await page.getByRole('button', { name: /^Üben$/ }).click()
  await page.getByText('Karte – die Lage zeichnen').first().click()

  await expect(pill(page)).toBeVisible({ timeout: 15_000 })
  await expect(bubble(page)).toBeVisible()
  await expect(page.locator('.ip-switch-btn')).toContainText('Lernen · Karte – die Lage zeichnen')
  const lern = await lernId(page)
  expect(lern, 'the run is bound to the Lern-Übung the door opened').toBeTruthy()

  try {
    await test.step('a new tab on this device picks the run up', async () => {
      // no session there; the progress knows the step and the Übung
      const tab = await page.context().newPage()
      await tab.goto('/')
      await expect(pill(tab)).toBeVisible({ timeout: 30_000 })
      await expect(bubble(tab)).toBeVisible()
      await tab.close()
    })

    await test.step('another device starts the Lern-Übung\'s tutorial', async () => {
      // nothing local – the Lern-Übung's title names its tutorial
      const other = await freshDevice(browser, baseURL ?? '')
      await login(other.page)
      await other.page.locator(`${EINSATZ_RAIL}, button[aria-label^="Menü"]`).first().waitFor()
      if (!(await inEinsatz(other.page))) {
        await openMenu(other.page)
        await other.page.getByText('Lernen · Karte – die Lage zeichnen').first().click()
      }
      await expect(pill(other.page)).toBeVisible({ timeout: 30_000 })
      await expect(bubble(other.page)).toBeVisible()
      await other.ctx.close()
    })
  } finally {
    // the Lern-Übung was born as Übung: an editor may delete it
    await page.request.delete(`/api/incidents/${lern}`)
  }
})
