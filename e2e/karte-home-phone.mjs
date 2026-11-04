// The Karte home on a phone, two owner checks (25.10.2026, iPhone screenshot):
//   1. a toast never covers the alarm card under the bar – «Rapport abgeschlossen · Wieder öffnen»
//      lay on «Alarm auf diesem Gerät noch nie getestet» (karte/AlarmReadiness · AlarmNudgeCard);
//      nor does the Meldeleiste – «Update bereit» lay on it too (31.10.2026, Safari on a Mac);
//   2. one hand zooms the map: a double tap whose second touch is held and dragged down zooms in
//      (MapLibre's tap-drag-zoom, off only while a tap tool is armed – MapView, UX sweep M4).
// A device-class check, not a Playwright spec: WebKit at iPhone 13 size (and the tablet for 1),
// run by hand against a running dev stack (it imports the app's toast module through Vite):
//
//   LD_LIBRARY_PATH=… node e2e/karte-home-phone.mjs http://127.0.0.1:5188   (PIN 000000 stack)
//
// The local stack has no VAPID key, so `/api/push/vapid-key` is answered with a stand-in – push
// counts as available – and the page answers as the installed app (ios-standalone · standalone):
// the card shows only there, as on a station phone. WebKit on Linux has no touch
// drag: the gesture is dispatched as touch + pointer EVENTS, which is what MapLibre listens to.
// Exit code 1 and «✗» lines when a check fails.
import { createRequire } from 'node:module'
import path from 'node:path'
import { standalone } from './ios-standalone.mjs'

const require = createRequire(path.join(process.cwd(), 'package.json'))
const { webkit, devices } = require('@playwright/test')
const BASE = process.argv[2] ?? process.env.E2E_BASE_URL ?? 'http://127.0.0.1:5188'
const PIN = process.env.E2E_PIN ?? '000000'
const DEVICES = {
  phone: { ...devices['iPhone 13'], viewport: { width: 390, height: 844 } },
  tablet: { viewport: { width: 1180, height: 820 }, deviceScaleFactor: 2, hasTouch: true },
}
// the app's toast module, fetched through Vite inside the page (a computed path, so knip does not
// read it as an import of this script)
const TOAST_MODULE = ['', 'src', 'lib', 'ui.tsx'].join('/')
let failed = 0
const check = (ok, what) => { console.log(`${ok ? '✓' : '✗'} ${what}`); if (!ok) failed++ }
const browser = await webkit.launch()

for (const [name, dev] of Object.entries(DEVICES)) {
  const ctx = await browser.newContext({ ...dev, baseURL: BASE, serviceWorkers: 'block' })
  await ctx.route(/\/api\/push\/vapid-key/, (r) => r.fulfill({ json: { key: 'stand-in', enabled: true } }))
  await ctx.addInitScript(standalone)
  await ctx.addInitScript(() => sessionStorage.setItem('kp.karte.view', JSON.stringify({ center: [7.555, 47.515], zoom: 16, bearing: 0, objectId: null, surface: 'karte' })))
  const page = await ctx.newPage()
  await page.goto('/')
  await page.locator('.roster-tile, [data-karte]').first().waitFor({ timeout: 30000 })
  if (await page.locator('.roster-tile').first().isVisible().catch(() => false)) {
    await page.locator('.roster-tile').first().click()
    await page.locator('.pinpad').waitFor()
    for (const d of PIN) await page.keyboard.press(d)
    await page.keyboard.press('Enter')
    await page.locator('[data-karte], .topbar').first().waitFor({ timeout: 30000 })
  }
  await page.goto('/karte')
  await page.locator('[data-karte]').first().waitFor({ timeout: 30000 })
  const card = page.locator('[data-alarm-nudge]')
  await card.waitFor({ timeout: 15000 })
  await page.evaluate((mod) => import(mod).then((m) => m.toast('Rapport abgeschlossen', {
    icon: 'check', tone: 'success', duration: 10_000, action: { label: 'Wieder öffnen', onClick: () => {} },
  })), TOAST_MODULE)
  const pill = page.locator('.toaster > *').first()
  await pill.waitFor({ timeout: 5000 })
  await page.waitForTimeout(400) // the pill's entrance
  const [p, c] = [await pill.boundingBox(), await card.boundingBox()]
  const overlap = p.y < c.y + c.height && c.y < p.y + p.height && p.x < c.x + c.width && c.x < p.x + p.width
  check(!overlap, `${name}: toast (y ${Math.round(p.y)}–${Math.round(p.y + p.height)}) clear of the alarm card (y ${Math.round(c.y)}–${Math.round(c.y + c.height)})`)
  // the Meldeleiste's lane: a bare `.ml` takes the strip's real geometry (08-toasts / 15-mobile)
  const ml = await page.evaluate(() => {
    const el = Object.assign(document.createElement('div'), { className: 'ml' })
    el.style.height = '60px'
    document.body.append(el)
    const r = el.getBoundingClientRect()
    el.remove()
    return { y: r.y, height: r.height }
  })
  check(ml.y >= c.y + c.height, `${name}: Meldeleiste (y ${Math.round(ml.y)}) under the alarm card (ends y ${Math.round(c.y + c.height)})`)

  if (name === 'phone') {
    await page.evaluate(() => document.querySelectorAll('.toaster > *').forEach((t) => t.remove()))
    const zoom = () => page.evaluate(() => JSON.parse(sessionStorage.getItem('kp.karte.view') || '{}').zoom)
    const z0 = await zoom()
    await page.evaluate(async () => {
      const x = 195, y = 650, target = document.elementFromPoint(x, y)
      const wait = (ms) => new Promise((r) => setTimeout(r, ms))
      const send = (type, cy) => {
        const pt = type === 'touchstart' ? 'pointerdown' : type === 'touchend' ? 'pointerup' : 'pointermove'
        target.dispatchEvent(new PointerEvent(pt, { bubbles: true, cancelable: true, pointerId: 9, pointerType: 'touch', isPrimary: true, clientX: x, clientY: cy, buttons: pt === 'pointerup' ? 0 : 1 }))
        const t = { identifier: 3, target, clientX: x, clientY: cy, pageX: x, pageY: cy, screenX: x, screenY: cy }
        const e = new Event(type, { bubbles: true, cancelable: true, composed: true })
        const l = type === 'touchend' ? [] : [t]
        for (const [k, v] of Object.entries({ touches: l, targetTouches: l, changedTouches: [t] })) Object.defineProperty(e, k, { value: v })
        target.dispatchEvent(e)
      }
      send('touchstart', y); await wait(40); send('touchend', y); await wait(120)
      send('touchstart', y); await wait(40)
      for (let i = 1; i <= 12; i++) { send('touchmove', y + i * 12); await wait(16) }
      send('touchend', y + 144); await wait(800)
    })
    await page.waitForTimeout(600)
    const z1 = await zoom()
    check(z1 > z0 + 0.5, `phone: one-finger double-tap-drag zooms the Karte (${z0} → ${z1})`)
  }
  await ctx.close()
}
await browser.close()
process.exit(failed ? 1 : 0)
