import type { Page } from '@playwright/test'
import { expect, test } from './helpers'
import { closeFrozen, frozenContext, mapDrawn, openIncident, PHONE, retireIncident, settled, startClock, TABLET, type Surface } from './visual/harness'

// Screenshot regression tests — a handful of frozen states, compared pixel by pixel against the
// baselines in e2e/visual/baseline/. They catch what no assertion names: a merged visual pass that
// a later merge silently undid (#231, 26.09.2026), a token that changed under a surface, a bar
// that moved. Determinism lives in visual/harness.ts; the rules for accepting a new baseline in
// docs/testing/visual-regression.md · «Accepting a baseline».
//
// ⚠️ OPT-IN (VISUAL=1): CI's «Visual» job sets it on a fresh stack. It writes Einsätze.

test.skip(!process.env.VISUAL, 'screenshot tests are opt-in (VISUAL=1) — run `just visual`')
// a retry that passes would hide a flaky shot, and a flaky shot is a bug of this file
test.describe.configure({ retries: 0 })

interface State { name: string; device: typeof TABLET | typeof PHONE; surface: Surface; theme?: 'day' | 'night'; then?: (page: Page) => Promise<void> }

const rapportOpen = async (page: Page) => { await page.locator('.report-preflight-body').waitFor() }
/** the Trupps board's «Trupp anmelden» sheet – the one bottom sheet a phone opens most */
const truppAnmelden = async (page: Page) => {
  await page.getByRole('button', { name: 'Trupp anmelden', exact: true }).click()
  await page.getByRole('dialog', { name: 'Trupp anmelden' }).waitFor()
}

const STATES: State[] = [
  { name: 'lage-tablet', device: TABLET, surface: 'map', then: mapDrawn },
  { name: 'lage-tablet-night', device: TABLET, surface: 'map', theme: 'night', then: mapDrawn },
  { name: 'lage-phone', device: PHONE, surface: 'map', then: mapDrawn },
  // the Gebäude sheet the fat incident annotates (Plan surface, Lage ↔ Plan parity)
  { name: 'plan-tablet', device: TABLET, surface: 'plans', then: async (page) => { await page.locator('.whiteboard').first().waitFor() } },
  { name: 'trupps-tablet', device: TABLET, surface: 'atemschutz' },
  { name: 'trupps-phone', device: PHONE, surface: 'atemschutz' },
  { name: 'verlauf-phone', device: PHONE, surface: 'map', then: async (page) => {
    // TopBar's Verlauf toggle — named «6 offen» while Pendenzen are open, so found by its role
    await page.locator('button.tb-act[aria-pressed]').first().click()
    await page.locator('.journal-drawer').waitFor()
  } },
  { name: 'rapport-tablet', device: TABLET, surface: 'rapport', then: rapportOpen },
  // night on a phone, an open sheet in both themes, an editor: a token that breaks one of them
  // changes none of the states above (UI sweep 09.11.2026)
  { name: 'trupps-phone-night', device: PHONE, surface: 'atemschutz', theme: 'night' },
  { name: 'rapport-phone-night', device: PHONE, surface: 'rapport', theme: 'night', then: rapportOpen },
  { name: 'trupp-anmelden-phone', device: PHONE, surface: 'atemschutz', then: truppAnmelden },
  { name: 'trupp-anmelden-phone-night', device: PHONE, surface: 'atemschutz', theme: 'night', then: truppAnmelden },
  { name: 'symbol-editor-tablet', device: TABLET, surface: 'map', then: async (page) => {
    await mapDrawn(page)
    // the first symbol the fat incident places; a tap on it opens its editor
    await page.locator('.maplibregl-marker > .marker:not(.marker-note):not(.marker-shape)').first().click()
    await page.locator('.ctx-done:visible').first().waitFor()
    await mapDrawn(page)
  } },
]

for (const state of STATES) {
  test(state.name, async ({ browser, baseURL }) => {
    const context = await frozenContext(browser, baseURL!, state.device)
    const page = await context.newPage()
    const seeded = await openIncident(page, baseURL!, { surface: state.surface, theme: state.theme })
    try {
      await state.then?.(page)
      await settled(page)
      await expect(page).toHaveScreenshot(`${state.name}.png`)
    } finally {
      await closeFrozen(context)
      await retireIncident(baseURL!, seeded.id)
    }
  })
}

test('kiosk-tablet', async ({ browser, baseURL }) => {
  const context = await frozenContext(browser, baseURL!, TABLET)
  const page = await context.newPage()
  await startClock(page)
  await page.goto('/')
  await page.locator('.roster-tile').first().waitFor()
  await settled(page)
  await expect(page).toHaveScreenshot('kiosk-tablet.png')
  await closeFrozen(context)
})

