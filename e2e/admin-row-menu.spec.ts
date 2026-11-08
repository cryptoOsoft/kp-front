import { test, expect } from './helpers'

// Regression guard for a stacking-order bug that made EVERY row action in the admin
// unreachable (shipped in v0.6.0): the kebab (⋮) menu opened, Base UI portalled its popup to
// <body>, and the popup painted BEHIND the admin shell (`.adm` is position:fixed, z-index:100).
// Nothing was visible and nothing was clickable — Bearbeiten, Rolle ändern, Deaktivieren and
// PIN zurücksetzen were all dead on «Mitglieder & Zugriff» and on «Personal».
//
// A screenshot cannot catch this and neither can jsdom (it has no compositor), so the check is
// the one that found it: open the menu, then ask the browser what is ACTUALLY on top at the
// popup's centre. If it is anything but the popup itself, the menu is unclickable.
//
// Runs against the same live stack as the smoke (see playwright.config.ts) and needs the
// deployment's admin secret, since the admin is gated on it alone.
const ADMIN_SECRET = process.env.E2E_ADMIN_SECRET

test.describe('admin row action menu', () => {
  test.skip(!ADMIN_SECRET, 'set E2E_ADMIN_SECRET to the deployment ADMIN_SECRET to run this')

  test('the row menu is on top and its actions fire', async ({ page }) => {
    await page.goto('/admin')
    // the admin is inert under the boot cover until it lifts (lib/snailLaunch · liftBootCover), and
    // a `fill` – unlike a click – does not wait for it: the secret just vanished (CI 08.11.2026)
    await expect(page.locator('.boot-splash')).toHaveCount(0)

    // Admin gate: the deployment ADMIN_SECRET (no kiosk login needed).
    await page.locator('#adm-secret').fill(ADMIN_SECRET!)
    await page.locator('form.adm-denied-card button[type=submit]').click()
    await expect(page.locator('.adm')).toBeVisible()

    await page.getByRole('button', { name: 'Mitglieder & Zugriff' }).first().click()
    const kebab = page.locator('.adm-menu-btn').first()
    await expect(kebab, 'seeded members should render at least one row').toBeVisible()
    await kebab.click()

    const popup = page.locator('.adm-menu-list')
    await expect(popup).toBeVisible()

    // The actual defect: hit-testing. `toBeVisible()` stays true for a popup that is painted
    // under an opaque surface, so ask who owns the pixel at the popup's centre.
    const onTop = await popup.evaluate((el) => {
      const r = el.getBoundingClientRect()
      const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2)
      return { inside: !!hit && el.contains(hit), hit: hit ? `${hit.tagName}.${hit.className}` : 'null' }
    })
    expect(onTop.inside, `the open menu is covered by ${onTop.hit} — it paints behind the admin shell`).toBe(true)

    // …and a row action really fires (Playwright's own hit-target check re-proves the above).
    await page.getByRole('menuitem', { name: 'Bearbeiten' }).click()
    await expect(page.locator('.adm-members-editbox')).toBeVisible()
  })
})
