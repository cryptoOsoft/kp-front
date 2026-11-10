import type { Browser, Page } from '@playwright/test'
import { expect, login, openApp, test } from './helpers'

// Day mode must come out LIGHT even when the browser is force-darkening pages (owner, Karte Haus
// round 7, point 2, on a Samsung tablet: «even though I set it to day, the map somehow turns to
// light mode but everything else stayed dark»).
//
// The mechanism: Blink's force-dark — "Dark mode" in Samsung Internet's settings, "Auto Dark
// Theme" in Chrome — repaints any page that declares a colour scheme it does not support. A bare
// `color-scheme: light` IS that declaration, so the whole day chrome was repainted dark while the
// WebGL map canvas, which no filter touches, stayed light. `color-scheme: only light` (CSS Color
// Adjust) opts out (01-tokens.css · the long note above the declaration, docs/ui-conventions.md) –
// one word that reads as redundant and is easy to tidy away.
//
// Force-dark is a paint-stage filter: getComputedStyle still reports the authored colour, so only
// real pixels can show it. CDP `Emulation.setAutoDarkModeOverride` is what DevTools' own «Emulate
// auto dark mode» does (the browser flag `--enable-features=WebContentsForceDark` does nothing
// headless, checked 20.10.2026). Chromium only; reads, writes nothing. A hand-run script until
// 09.11.2026 (e2e/blink-force-dark.mjs: 38 vs 242 mean luminance with a bare `light`).

// the OS preference force-dark keys off — the owner's tablet is in dark mode
test.use({ colorScheme: 'dark', serviceWorkers: 'block', viewport: { width: 1180, height: 820 } })

/** A light surface is far above this and a dark one far below it (they differ by ~200 of 255),
 *  so the threshold needs no tuning — it only has to sit between them. */
const LIGHT = 150

/** Mean relative luminance (0–255) of a PNG, decoded in a page of its own that is NOT
 *  force-darkened — the sampling itself must not be repainted. */
async function meanLuminance(browser: Browser, png: Buffer): Promise<number> {
  const context = await browser.newContext()
  try {
    const decoder = await context.newPage()
    return await decoder.evaluate(async (b64) => {
      const img = new Image()
      img.src = `data:image/png;base64,${b64}`
      await img.decode()
      const canvas = document.createElement('canvas')
      canvas.width = img.width
      canvas.height = img.height
      const g = canvas.getContext('2d')
      if (!g) throw new Error('no 2d context to decode the screenshot in')
      g.drawImage(img, 0, 0)
      const { data } = g.getImageData(0, 0, img.width, img.height)
      let sum = 0
      for (let i = 0; i < data.length; i += 4) sum += 0.2126 * data[i] + 0.7152 * data[i + 1] + 0.0722 * data[i + 2]
      return Math.round(sum / (data.length / 4))
    }, png.toString('base64'))
  } finally {
    await context.close()
  }
}

/** Open «Karte & Objekte» in `theme` and measure its top bar – pure chrome, no map canvas in it. */
async function topbarLuminance(page: Page, browser: Browser, theme: 'day' | 'night') {
  // the theme a device remembers (lib/prefs, the prefs cookie)
  await page.evaluate((prefs) => { document.cookie = `kp-front-prefs=${encodeURIComponent(prefs)}; path=/` }, JSON.stringify({ theme }))
  await openApp(page, '/karte')
  const bar = page.locator('.topbar').first()
  await expect(bar).toBeVisible()
  // lib/prefs · applyTheme: night is `<html data-theme="night">`, day is the bare root
  const root = page.locator('html')
  await (theme === 'night' ? expect(root).toHaveAttribute('data-theme', 'night') : expect(root).not.toHaveAttribute('data-theme', 'night'))
  return meanLuminance(browser, await bar.screenshot())
}

test('day stays light and night stays dark while the browser force-darkens pages', async ({ page, browser, browserName }) => {
  test.skip(browserName !== 'chromium', 'force-dark is Blink\'s; the override is a CDP call')
  await login(page)
  expect(await topbarLuminance(page, browser, 'day'), 'day, no force-dark: the measurement itself reads a light bar').toBeGreaterThan(LIGHT)

  const cdp = await page.context().newCDPSession(page)
  await cdp.send('Emulation.setAutoDarkModeOverride', { enabled: true })
  expect(await topbarLuminance(page, browser, 'day'), 'day, force-dark on: the top bar must STAY light').toBeGreaterThan(LIGHT)
  expect(await topbarLuminance(page, browser, 'night'), 'night, force-dark on: the top bar must stay dark').toBeLessThan(LIGHT)
})
