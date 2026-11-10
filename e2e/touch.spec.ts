import { test, expect, login, ensureIncidentOpen, expectNoCrash } from './helpers'

// Runs in real coarse-pointer browser contexts at phone and tablet sizes. Writes only on
// explicitly opted-in disposable stacks, like workspace-flows.spec.ts.
test.skip(!process.env.E2E_WORKFLOWS, 'touch workflows require a private stack (E2E_WORKFLOWS=1)')
test('touch time picker stays reachable, commits a wheel selection and can clear it', async ({ page }) => {
  const config = await page.request.get('/api/config')
  test.skip((await config.json()).identity?.demoMode === true, 'Never mutate a shared demo')
  await login(page)
  await ensureIncidentOpen(page)
  expect(await page.evaluate(() => matchMedia('(pointer: coarse)').matches)).toBe(true)
  const rail = page.locator('nav.navrail')
  // one tile on every width since 10.11.2026 («Rapport», with its open count on a phone). On a
  // phone it is the group's door: with nobody present yet it opens the Anwesenheit, and a second
  // tap offers the three pages.
  const tile = rail.getByRole('button', { name: /^Rapport(?: ·|$)/ })
  await tile.tap()
  const body = page.locator('.report-preflight-body')
  if (!(await body.waitFor({ timeout: 3000 }).then(() => true, () => false))) {
    await tile.tap()
    await page.getByRole('dialog').getByRole('option', { name: /^Rapport/ }).tap()
  }
  await expect(page.locator('.report-preflight-body')).toBeVisible()
  const field = page.getByRole('button', { name: 'Einsatzende', exact: true })
  await field.tap()
  const picker = page.locator('.wheelpop')
  // one date-time control (05.10.2026): hour + minute, plus a day column when the Einsatz spans days
  await expect(picker.locator('.wheel').nth(1)).toBeVisible()
  expect(await picker.locator('.wheel').count()).toBeLessThanOrEqual(3)
  await expect(picker.getByRole('textbox')).toHaveCount(0)
  const ok = picker.getByRole('button', { name: 'OK', exact: true })
  const box = (await ok.boundingBox())!
  expect(box.height).toBeGreaterThanOrEqual(44)
  expect(box.y + box.height).toBeLessThanOrEqual(page.viewportSize()!.height)
  await ok.tap()
  await expect(picker).toHaveCount(0)
  await expect(field).not.toHaveText('--.--.---- --:--')
  await field.tap()
  const clear = picker.getByRole('button', { name: 'Leeren', exact: true })
  expect((await clear.boundingBox())!.height).toBeGreaterThanOrEqual(44)
  await clear.tap()
  await expect(field).toHaveText('--.--.---- --:--')
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
  await expectNoCrash(page, 'touch time controls')
})
