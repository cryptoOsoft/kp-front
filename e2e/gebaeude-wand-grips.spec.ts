import type { Locator, Page } from '@playwright/test'
import { EINSATZ_RAIL, expect, expectNoCrash, login, openApp, test } from './helpers'

// The Wand's grips on the Gebäude stack, with a real mouse (owner, round 3 of the Gebäude
// drawing, 27.10.2026). Two things jsdom cannot see, so the browser measures them:
//
//   · «Verlängern» keeps its distance from the end node in EVERY direction. The cause was CSS:
//     .draw-grow's `position: relative` beat .wb-grow's `absolute`, the grips flowed, and the
//     arrow of a Wand ending upwards sat right on its node (14 px instead of 46);
//   · a node of the OPEN Wand (it stays open while it is drawn) snaps when dragged onto the
//     building outline, ring shown – the Vitest twin is Whiteboard.test · «a node of the OPEN Wand».
//
// It opens an Einsatz of its own at a fixed spot and answers the Overpass building lookup with a
// rectangular building (no network); the Einsatz is archived again afterwards. A hand-run script
// until 09.11.2026 (e2e/gebaeude-wand-grips.mjs).
//
// ⚠️ OPT-IN (E2E_WORKFLOWS=1), chromium only: it writes an Einsatz – never against a station in use.

test.skip(!process.env.E2E_WORKFLOWS, 'workflow e2e is opt-in (E2E_WORKFLOWS=1): it opens an Einsatz — run it on a private stack')
// the mouse layout the bug was found on; dark, as the owner's desktop was
test.use({ viewport: { width: 1440, height: 900 }, colorScheme: 'dark', serviceWorkers: 'block' })

type Point = readonly [x: number, y: number]

/** lng, lat – where the Einsatz and its building stand */
const AT = [7.570345, 47.523718] as const
const HALF = [0.00028, 0.00012] as const
const BUILDING = [[-1, -1], [1, -1], [1, 1], [-1, 1], [-1, -1]].map(([x, y]) => ({ lon: AT[0] + x * HALF[0], lat: AT[1] + y * HALF[1] }))
/** how far «Verlängern» stands off a line's end node (lib/lineStyle · EXTEND_STEP_PX) */
const EXTEND_STEP_PX = 46

let incidentId = ''

test.beforeEach(async ({ page, context, browserName }, testInfo) => {
  test.skip(browserName !== 'chromium', 'runs on chromium only')
  const config = await page.request.get('/api/config')
  test.skip(config.ok() && (await config.json()).identity?.demoMode === true, 'opens Einsätze — never against a shared demo')
  await context.route('**/api/overpass/buildings', async (route) => {
    const box = route.request().postDataJSON() as { south: number; north: number; west: number; east: number }
    const inside = AT[1] > box.south && AT[1] < box.north && AT[0] > box.west && AT[0] < box.east
    await route.fulfill({ json: { elements: inside ? [{ type: 'way', id: 1, geometry: BUILDING }] : [] } })
  })
  await login(page)
  // an Einsatz at AT, remembered as the one picked by hand (lib/prefs) so the next open lands in it
  const created = await page.request.post('/api/incidents', { data: { title: `E2E ${testInfo.title.slice(0, 40)}`, lat: AT[1], lng: AT[0] } })
  expect(created.status(), 'creating the Einsatz').toBe(201)
  incidentId = (await created.json() as { id: string }).id
  await context.addCookies([{
    name: 'kp-front-prefs', url: new URL(page.url()).origin,
    value: encodeURIComponent(JSON.stringify({ incidentId, incidentChosenAt: Date.now() })),
  }])
  await openApp(page, '/')
  await expect(page.locator(EINSATZ_RAIL)).toBeVisible()
  await page.getByRole('button', { name: 'Gebäude', exact: true }).click()
  await page.getByRole('button', { name: /^Übernehmen/ }).click()
  await expect(storeys(page).first()).toBeVisible()
})

test.afterEach(async ({ page }) => {
  if (incidentId) await page.request.patch(`/api/incidents/${incidentId}`, { data: { is_archived: true } })
  incidentId = ''
})

/** the storeys' outlines on the stack – a fresh Gebäude has one, the EG */
const storeys = (page: Page) => page.locator('.wb-floor-svg polygon')

async function boxOf(target: Locator) {
  const box = await target.boundingBox()
  if (!box) throw new Error('nothing on screen to measure')
  return box
}

/** the centres of everything `selector` matches */
const centres = (page: Page, selector: string): Promise<Point[]> => page.locator(selector).evaluateAll((els) => els.map((el) => {
  const b = el.getBoundingClientRect()
  return [b.x + b.width / 2, b.y + b.height / 2] as const
}))

async function arm(page: Page, tool: string) {
  const button = page.getByRole('button', { name: tool, exact: true })
  await button.click()
  await expect(button).toHaveAttribute('aria-pressed', 'true')
}

/** Arm the Wand and click it through `points`; it stays open, and armed. */
async function drawWand(page: Page, points: Point[]) {
  await arm(page, 'Linie')
  await page.getByRole('button', { name: 'Wand', exact: true }).click()
  for (const [x, y] of points) {
    await page.mouse.click(x, y)
    await page.waitForTimeout(200) // two clicks closer together than this read as a double click
  }
}

test('a Wand\'s «Verlängern» keeps a full step off its end node, and an open Wand\'s node snaps to the outline', async ({ page }) => {
  const eg = await boxOf(storeys(page).last())
  const mid: Point = [eg.x + eg.width / 2, eg.y + eg.height / 2]

  // a Wand from the middle out, ending up / down / left / right: the end's arrow stays a full
  // step off the node, and a press on the node is the node's
  for (const [name, dx, dy] of [['up', 0, -1], ['down', 0, 1], ['left', -1, 0], ['right', 1, 0]] as const) {
    const end: Point = [mid[0] + dx * 60, mid[1] + dy * 50]
    await drawWand(page, [mid, end, end])
    await arm(page, 'Auswahl')
    await page.mouse.click(mid[0] + dx * 45, mid[1] + dy * 38)
    await expect.poll(async () => {
      const node = (await centres(page, '.wb-vertex')).at(-1)
      if (!node) return 'no end node'
      const gap = Math.min(...(await centres(page, '.wb-grow')).map(([x, y]) => Math.hypot(x - node[0], y - node[1])))
      const onNode = await page.evaluate(([x, y]) => !!document.elementFromPoint(x, y)?.closest('.wb-vertex'), node)
      return Math.abs(gap - EXTEND_STEP_PX) < 1 && onNode ? 'ok' : `«Verlängern» ${gap.toFixed(1)} px from the end node, a press on the node ${onNode ? 'takes' : 'misses'} it`
    }, `Wand ending ${name}: «Verlängern» a full step off its end node, and a press there takes the node`).toBe('ok')
    await page.keyboard.press('Escape')
    await page.getByRole('button', { name: /^Rückgängig/ }).first().click()
    await expect(page.locator('.wb-vertex')).toHaveCount(0)
  }

  // the open Wand's last node dragged to 7 px short of the right outline edge, a little askew:
  // the snap ring shows while it moves, and it lands on the edge, level with its first point
  const y = eg.y + eg.height * 0.75
  await drawWand(page, [[eg.x + 40, y], [eg.x + 160, y]])
  const [first, last] = await centres(page, '.wb-vertex')
  const to: Point = [eg.x + eg.width - 7, y + 5]
  await page.mouse.move(last[0], last[1])
  await page.mouse.down()
  for (let i = 1; i <= 10; i++) {
    await page.mouse.move(last[0] + ((to[0] - last[0]) * i) / 10, last[1] + ((to[1] - last[1]) * i) / 10)
    await page.waitForTimeout(30)
  }
  await expect(page.locator('.wb-snap-ring'), 'the snap ring shows while the node is dragged').toBeVisible()
  await page.mouse.up()
  await expect.poll(async () => {
    const dropped = (await centres(page, '.wb-vertex')).at(-1)
    if (!dropped) return 'no node'
    const off = [dropped[0] - (eg.x + eg.width), dropped[1] - first[1]]
    return off.every((d) => Math.abs(d) < 1.5) ? 'ok' : `${off.map((d) => d.toFixed(1)).join(' / ')} px off the edge / the first point's level`
  }, 'the node lands on the outline edge, level with the Wand\'s first point').toBe('ok')
  await expectNoCrash(page, 'Gebäude · Wand')
})
