import { ADMIN_SECRET, adminContext, expect, login, openApp, test } from './helpers'

// A folded map name tag is as wide as its longest line (owner, Karte Haus round 3: «wrapped lines
// for objects should have their boxes fitted to the width rather than how they wouldve been»). CSS
// alone keeps a wrapped box at its max-width (280 px) – KarteApp measures the lines on the tag's
// off-screen twin and hands the folded tag its fitted width (docs/karte-objekte.md). A font, a
// padding or a cap that changes under the tag breaks the fit without breaking any unit test, so
// the browser measures: every name tag's box may be at most 2 px wider than its widest rendered
// line plus its padding and border.
//
// At phone size, where a long name folds. The object – a row of addresses as the station's
// catalogue names them – goes in through the admin API and stays on the disposable stack.
// A hand-run script over the station's own data until 09.11.2026 (e2e/karte-tag-fit.mjs).

test.use({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, serviceWorkers: 'block' })

/** lng, lat – where the object stands */
const AT = [7.5496535, 47.5136528] as const

test('a folded name tag on the Karte is fitted to its longest line', async ({ page, baseURL, browserName }) => {
  test.skip(!ADMIN_SECRET, 'set E2E_ADMIN_SECRET to the deployment ADMIN_SECRET to run this')
  test.skip(browserName !== 'chromium', 'a layout check; chromium draws the map in CI')
  // found by its mark: the tag sets a word joiner after every hyphen, so the text is not the name
  const mark = `(${Date.now() % 100_000})`
  const name = `Musterstrasse 1-14, Beispielweg 1-5, Probegasse 2-18 ${mark}`
  const admin = await adminContext(baseURL)
  const created = await admin.post('/api/objects', { data: { name, address: 'Musterstrasse 1', lat: AT[1], lng: AT[0] } })
  expect(created.ok(), `object: ${created.status()}`).toBe(true)
  const { id } = await created.json() as { id: string }
  await admin.dispose()

  await login(page)
  // opened ON the object: a selected object always wears its name tag, whatever else stands at
  // the same point (an earlier run's object would take the one tag the placement pass gives out)
  await openApp(page, `/karte?objekt=${id}`)
  await expect(page.locator('[data-karte] .maplibregl-marker button').filter({ hasText: mark })).toBeVisible()

  /** every name tag on the map: its box, its widest line plus its chrome, how many lines it has */
  const measure = () => page.locator('[data-karte] .maplibregl-marker button').evaluateAll((tags) => tags.flatMap((el) => {
    if (!el.textContent?.trim()) return []
    const range = document.createRange()
    range.selectNodeContents(el)
    const rows = new Map<number, number>()
    for (const r of range.getClientRects()) rows.set(Math.round(r.top), Math.max(rows.get(Math.round(r.top)) ?? 0, r.width))
    const style = getComputedStyle(el)
    const chrome = [style.paddingLeft, style.paddingRight, style.borderLeftWidth, style.borderRightWidth].reduce((sum, px) => sum + parseFloat(px), 0)
    return [{ name: el.textContent, lines: rows.size, slack: Math.round(el.getBoundingClientRect().width - (Math.max(...rows.values()) + chrome)) }]
  }))

  // the fit is handed to the tag after it is drawn, so poll: the long name has folded, and no
  // tag on the map is wider than its longest line
  await expect.poll(async () => {
    const tags = await measure()
    const folded = (tags.find((t) => t.name?.endsWith(mark))?.lines ?? 0) > 1
    return { folded, tooWide: tags.filter((t) => t.slack > 2) }
  }, 'the long name folds, and every name tag hugs its longest line (px of slack)').toEqual({ folded: true, tooWide: [] })
})
