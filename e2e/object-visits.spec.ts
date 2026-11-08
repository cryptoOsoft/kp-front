import { request as pwRequest, type APIRequestContext, type Page } from '@playwright/test'
import { expect, expectNoCrash, login, OFFLINE_FETCH_FAILURE, test } from './helpers'

// Objektbesuche on a phone, offline first (docs/object-visits.md · Device):
//
//   prepare online (the catalogue lands on the device) → go offline → start a visit, answer it,
//   take a photo → reload WHILE offline: the draft and its photo are still there (IndexedDB +
//   the precached shell) → online: the save point that failed offline goes up by itself → the
//   status line reaches «Gespeichert» only once the server holds the revision AND the photo → one
//   more change is saved ~20 s later without any tap → «Abschliessen» → the read view.
//
// Needs the deployment's admin secret: the module is switched on through the config API, and
// one object + one visit checklist are put in through the admin API. Writes to its own object
// and checklist; restores the `objectVisits` section afterwards. Never run it against a station
// in use.
const ADMIN_SECRET = process.env.E2E_ADMIN_SECRET
/** a visit's save point this long after the last change (src/components/objectVisits/VisitPage · QUIET_SAVE_MS) */
const QUIET_SAVE_MS = 20_000

const TEMPLATE_ID = 'e2e-objektbesuch'
const PLACE_TEMPLATE_ID = 'e2e-fehlermeldung'
const template = {
  id: TEMPLATE_ID,
  kind: 'visit',
  version: 1,
  title: 'E2E Kontrolle',
  source: 'e2e',
  order: 1,
  phases: [{
    id: 'huelse', title: 'Schlüsselhülse', items: [
      { id: 'zugaenglich', text: 'Schlüsselhülse zugänglich', input: 'check' },
      { id: 'gereinigt', text: 'Grob gereinigt', input: 'yesno' },
    ],
  }],
}

async function adminContext(baseURL: string): Promise<APIRequestContext> {
  const api = await pwRequest.newContext({ baseURL, extraHTTPHeaders: { 'X-Incident-Link': 'off' } })
  const r = await api.post('/api/admin/login', { data: { secret: ADMIN_SECRET } })
  expect(r.ok(), `admin login: ${r.status()}`).toBe(true)
  return api
}

/** PUT the config with one section changed (the full-document PUT wants the version). */
async function patchConfig(api: APIRequestContext, section: unknown): Promise<unknown> {
  const cfg = await (await api.get('/api/config')).json() as Record<string, unknown>
  const before = cfg.objectVisits
  const { integrations: _i, symbols: _s, version, ...doc } = cfg
  const r = await api.put('/api/config', {
    data: { ...doc, objectVisits: section },
    headers: version ? { 'If-Match': String(version) } : {},
  })
  expect(r.ok(), `config PUT: ${r.status()} ${await r.text()}`).toBe(true)
  return before
}

type Api = APIRequestContext

/** The module on, one object of this test's own, the visit checklist. Returns the restore. */
async function prepare(api: Api, objectName: string): Promise<() => Promise<void>> {
  const previous = await patchConfig(api, { enabled: true, captureRoles: ['editor', 'el'], proposalFields: [{ id: 'owner_contact', label: 'Kontakt Eigentümer' }], destinations: [] })
  const obj = await api.post('/api/objects', { data: { name: objectName, address: 'Teststrasse 1' } })
  expect(obj.ok(), `object: ${obj.status()}`).toBe(true)
  const tpl = await api.put(`/api/reference/${encodeURIComponent(`checklists:${TEMPLATE_ID}`)}`, {
    multipart: {
      file: { name: 'e2e-objektbesuch.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(template)) },
      title: template.title,
    },
  })
  expect(tpl.ok(), `checklist: ${tpl.status()} ${await tpl.text()}`).toBe(true)
  return async () => { await patchConfig(api, previous ?? { enabled: false }).catch(() => {}) }
}

/** Sign in, open Objektbesuche online (the catalogue lands on the device), wait for the SW. */
async function openSurface(page: Page) {
  await login(page)
  // signed in: home («Karte & Objekte», whose menu button opens the menu with the Objektbesuche row), or
  // an Einsatz the boot reopened
  await page.locator('[data-karte], nav.navrail').first().waitFor({ state: 'visible' })
  if (await page.locator('[data-karte]').isVisible().catch(() => false)) {
    await page.locator('[data-karte-menu]').click()
    await page.getByRole('button', { name: 'Objektbesuche' }).click()
  } else await page.goto('/besuche')
  await expect(page).toHaveURL(/\/besuche$/)
  // the catalogue is on the device once its search and «In der Nähe» are drawn
  await expect(page.getByRole('button', { name: /In der Nähe/ })).toBeVisible()
  // …beneath the boot cover after a `goto`: the app is inert until it lifts (lib/snailLaunch ·
  // liftBootCover), and a `fill` – unlike a click – does not wait for it, the text just vanishes
  await expect(page.locator('.boot-splash')).toHaveCount(0)
  await page.evaluate(async () => { await navigator.serviceWorker.ready })
}

/** A real JPEG for the camera (the server checks the magic bytes). */
async function jpegOf(page: Page): Promise<Buffer> {
  return Buffer.from(await page.evaluate(async () => {
    const c = document.createElement('canvas')
    c.width = 64; c.height = 48
    const g = c.getContext('2d')!
    g.fillStyle = '#b9a27b'; g.fillRect(0, 0, 64, 48)
    const blob: Blob = await new Promise((res) => c.toBlob((b) => res(b!), 'image/jpeg', 0.8))
    return Array.from(new Uint8Array(await blob.arrayBuffer()))
  }))
}

/** From the Übersicht: start a visit of `objectName`, answer both items, take a photo. */
async function captureVisit(page: Page, objectName: string, jpeg: Buffer): Promise<string> {
  await page.getByPlaceholder('Objekt suchen …').fill(objectName)
  await page.getByRole('button', { name: new RegExp(objectName) }).click()
  const chooser = page.getByRole('button', { name: new RegExp(template.title) })
  if (await chooser.isVisible({ timeout: 2_000 }).catch(() => false)) await chooser.click()
  await page.waitForURL(/\/besuche\/ov[0-9a-z-]+$/)
  const visitId = page.url().split('/').pop()!
  await page.getByLabel('Von').fill('Muster Max')
  await page.getByRole('group', { name: 'Schlüsselhülse zugänglich' }).getByRole('button', { name: 'OK' }).click()
  await page.getByRole('group', { name: 'Grob gereinigt' }).getByRole('button', { name: 'Ja' }).click()
  await page.getByTestId('ov-photo-input').setInputFiles({ name: 'foto.jpg', mimeType: 'image/jpeg', buffer: jpeg })
  await expect(page.getByText('Auf diesem Gerät gespeichert – wird gesendet, sobald Netz da ist')).toBeVisible()
  await page.getByLabel('Beschriftung').fill('Zugang Nord')
  await page.getByRole('button', { name: 'Fertig' }).click()
  await expect(page.getByRole('button', { name: /^Foto öffnen: Zugang Nord/ })).toBeVisible()
  await expect(page.getByRole('button', { name: /^Stand anzeigen: Entwurf · auf Gerät/ })).toBeVisible()
  return visitId
}

/** The server holds the visit, ready, with the answers and the photo. */
async function expectSaved(api: Api, visitId: string, photos = 1) {
  await expect.poll(async () => {
    const r = await api.get(`/api/object-visits/${visitId}`)
    return r.ok() ? (await r.json()).ready : `HTTP ${r.status()}`
  }, { timeout: 45_000, message: 'the visit must reach the server, with its photo, by itself' }).toBe(true)
  const saved = await (await api.get(`/api/object-visits/${visitId}`)).json()
  expect(saved).toMatchObject({ lifecycle: 'draft', missing: [] })
  expect(saved.photos).toHaveLength(photos)
  expect(saved.answers).toEqual({ zugaenglich: { v: 'ok' }, gereinigt: { v: 'yes' } })
}

test.describe('Objektbesuche · offline capture on a phone', () => {
  test.skip(!ADMIN_SECRET, 'set E2E_ADMIN_SECRET to the deployment ADMIN_SECRET to run this')
  test.use({
    viewport: { width: 390, height: 844 },
    hasTouch: true,
    // Chromium's offline emulation reads navigator.onLine === true in a document reloaded while
    // offline, so a background fetch that fails then is reported (see smoke.spec · offline drill)
    expectedClientErrors: [OFFLINE_FETCH_FAILURE],
  })

  test('a visit taken offline survives a reload and is saved once the server answers', async ({ page, context, browserName, baseURL }) => {
    test.skip(browserName !== 'chromium', 'Offline service-worker automation requires Chromium')
    test.setTimeout(150_000)
    const api = await adminContext(baseURL!)
    const objectName = `E2E Objekt ${Date.now()}`
    const restore = await prepare(api, objectName)
    // the page's clock runs on its own (time flows), so the ~20 s save point below is a jump
    // (`fastForward`), not a 22 s sleep – the recovery suite's longest wait until 23.10.2026
    await page.clock.install()
    try {
      await openSurface(page)
      const jpeg = await jpegOf(page)

      // ── offline: start the visit, answer it, take a photo ──
      await context.setOffline(true)
      const visitId = await captureVisit(page, objectName, jpeg)
      // the save point ~20 s after the last change fires offline: the reconnect owes it now
      await page.clock.fastForward(QUIET_SAVE_MS + 2_000)

      // ── reload while offline: the draft and its photo come back from the device ──
      await page.reload({ waitUntil: 'domcontentloaded' })
      await expect(page.getByRole('heading', { name: objectName })).toBeVisible({ timeout: 30_000 })
      await expect(page.getByRole('group', { name: 'Schlüsselhülse zugänglich' }).getByRole('button', { name: 'OK' })).toHaveAttribute('aria-pressed', 'true')
      await expect(page.getByRole('group', { name: 'Grob gereinigt' }).getByRole('button', { name: 'Ja' })).toHaveAttribute('aria-pressed', 'true')
      await expect(page.getByRole('button', { name: /^Foto öffnen: Zugang Nord/ })).toBeVisible()
      expect((await api.get(`/api/object-visits/${visitId}`)).status(), 'nothing was sent while offline').toBe(404)

      // ── online: the reload was a save point offline — it goes up by itself; «Gespeichert» only
      //    with the revision AND the photo on the server ──
      await context.setOffline(false)
      await expect(page.getByRole('button', { name: /^Stand anzeigen: Entwurf · Gespeichert/ })).toBeVisible({ timeout: 45_000 })
      const saved = await (await api.get(`/api/object-visits/${visitId}`)).json()
      expect(saved).toMatchObject({ lifecycle: 'draft', ready: true, missing: [] })
      expect(saved.photos).toHaveLength(1)
      expect(saved.answers).toEqual({ zugaenglich: { v: 'ok' }, gereinigt: { v: 'yes' } })
      expect(saved.with).toEqual(['Muster Max'])

      // ── one more change: saved ~20 s after it, with no tap ──
      await page.getByLabel('Bemerkungen').fill('Hauswart neu')
      await expect(page.getByRole('button', { name: /^Stand anzeigen: Entwurf · Änderungen auf Gerät/ })).toBeVisible()
      await page.clock.fastForward(QUIET_SAVE_MS + 2_000)
      await expect(page.getByRole('button', { name: /^Stand anzeigen: Entwurf · Gespeichert/ })).toBeVisible({ timeout: 45_000 })
      expect((await (await api.get(`/api/object-visits/${visitId}`)).json()).notes).toBe('Hauswart neu')

      // ── «Abschliessen» → the read view ──
      await page.getByRole('button', { name: 'Abschliessen' }).click()
      await expect(page.getByRole('button', { name: /^Stand anzeigen: Abgeschlossen · Gespeichert/ })).toBeVisible({ timeout: 30_000 })
      await expect(page.getByRole('button', { name: /Bericht \(PDF\)/ })).toBeVisible()
      await expect(page.getByRole('button', { name: 'Abschliessen' })).toHaveCount(0)
      const done = await (await api.get(`/api/object-visits/${visitId}`)).json()
      expect(done).toMatchObject({ lifecycle: 'completed', ready: true })
      expect(done.revision).toBeGreaterThanOrEqual(2)
      await expectNoCrash(page, 'object visit')
    } finally {
      await context.setOffline(false)
      await restore()
      await api.dispose()
    }
  })

  // No «Jetzt senden» from here on: what a save point could not send must go up by itself
  // (handoff acceptance: «Reconnect and reload resume metadata and photo synchronization»).

  test('leaving the visit offline is a save point; the reconnect sends it without a tap', async ({ page, context, browserName, baseURL }) => {
    test.skip(browserName !== 'chromium', 'Offline service-worker automation requires Chromium')
    test.setTimeout(150_000)
    const api = await adminContext(baseURL!)
    const objectName = `E2E Objekt ${Date.now()}`
    const restore = await prepare(api, objectName)
    try {
      await openSurface(page)
      const jpeg = await jpegOf(page)
      await context.setOffline(true)
      const visitId = await captureVisit(page, objectName, jpeg)
      // several from the library at once: each its own photo, no caption sheet
      await page.getByTestId('ov-photo-input').setInputFiles([
        { name: 'a.jpg', mimeType: 'image/jpeg', buffer: jpeg },
        { name: 'b.jpg', mimeType: 'image/jpeg', buffer: jpeg },
      ])
      await expect(page.getByText('2 Fotos hinzugefügt')).toBeVisible()
      await expect(page.getByRole('button', { name: /^Foto öffnen/ })).toHaveCount(3)
      await page.getByRole('button', { name: 'Zurück' }).click() // leaving: the save point, offline
      const row = page.getByRole('button', { name: new RegExp(objectName) })
      await expect(row).toContainText('auf Gerät')
      expect((await api.get(`/api/object-visits/${visitId}`)).status(), 'nothing was sent while offline').toBe(404)

      await context.setOffline(false)
      // a saved draft wears a tick named «Gespeichert {Zeit}», not the word (sweep 28.10.2026 #16)
      await expect(row.locator('[aria-label^="Gespeichert"]'), 'the draft reaches «Gespeichert» by itself').toBeVisible({ timeout: 45_000 })
      await expectSaved(api, visitId, 3)
      await expectNoCrash(page, 'object visit · reconnect')
    } finally {
      await context.setOffline(false)
      await restore()
      await api.dispose()
    }
  })

  test('a visit left offline goes up when the app is opened again online — at home', async ({ page, context, browserName, baseURL }) => {
    test.skip(browserName !== 'chromium', 'Offline service-worker automation requires Chromium')
    test.setTimeout(150_000)
    const api = await adminContext(baseURL!)
    const objectName = `E2E Objekt ${Date.now()}`
    const restore = await prepare(api, objectName)
    try {
      await openSurface(page)
      const jpeg = await jpegOf(page)
      await context.setOffline(true)
      const visitId = await captureVisit(page, objectName, jpeg)
      await page.getByRole('button', { name: 'Zurück' }).click() // the save point, offline
      await page.getByRole('button', { name: 'Zurück' }).click() // back home
      await expect(page).not.toHaveURL(/\/besuche/)

      // the app is opened again, online, and nobody opens Objektbesuche
      await context.setOffline(false)
      await page.reload({ waitUntil: 'domcontentloaded' })
      await page.locator('[data-karte], nav.navrail').first().waitFor({ state: 'visible' })
      await expectSaved(api, visitId)

      await page.goto('/besuche')
      await expect(page.getByRole('button', { name: new RegExp(objectName) }).locator('[aria-label^="Gespeichert"]')).toBeVisible()
      await expectNoCrash(page, 'object visit · start')
    } finally {
      await context.setOffline(false)
      await restore()
      await api.dispose()
    }
  })

  // A report at a PLACE (16.10.2026, docs/object-visits.md · «The target»): Karte & Objekte opens
  // `/besuche/neu?lat=…&lng=…&label=…&from=karte` for a pin no catalogue object stands on. The
  // visit has no object, shows the «Ort» card, reaches the server with its place, and «Zurück zur
  // Karte» goes back to /karte.
  test('a Fehlermeldung at a pin, launched from the Karte, and back to the Karte', async ({ page, baseURL }) => {
    test.setTimeout(120_000)
    const api = await adminContext(baseURL!)
    const restore = await prepare(api, `E2E Objekt ${Date.now()}`)
    const placeTpl = {
      id: PLACE_TEMPLATE_ID, kind: 'visit', version: 1, title: 'E2E Fehlermeldung', source: 'e2e', order: 2,
      targets: ['object', 'location'],
      phases: [{ id: 'meldung', title: 'Meldung', items: [
        { id: 'was', text: 'Was betrifft es?', input: 'choice', options: [{ id: 'hydrant', label: 'Hydrant' }, { id: 'anderes', label: 'Anderes' }] },
        { id: 'beschreibung', text: 'Beschreibung', input: 'text', required: true },
        { id: 'dringend', text: 'Vor dem nächsten Einsatz nötig?', input: 'yesno' },
      ] }],
    }
    const up = await api.put(`/api/reference/${encodeURIComponent(`checklists:${PLACE_TEMPLATE_ID}`)}`, {
      multipart: { file: { name: 'f.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(placeTpl)) }, title: placeTpl.title },
    })
    expect(up.ok(), `place checklist: ${up.status()} ${await up.text()}`).toBe(true)
    try {
      await openSurface(page)
      const label = `bei E2E-Weg ${Date.now() % 1000}`
      await page.goto(`/besuche/neu?lat=47.52015&lng=7.57175&label=${encodeURIComponent(label)}&from=karte`)
      // only the checklists that may be used at a place (+ «Ohne Checkliste») — the object one is not offered
      const chooser = page.getByRole('button', { name: /E2E Fehlermeldung/ })
      if (await chooser.isVisible({ timeout: 5_000 }).catch(() => false)) {
        await expect(page.getByRole('button', { name: new RegExp(template.title) })).toHaveCount(0)
        await chooser.click()
      }
      await page.waitForURL(/\/besuche\/ov[0-9a-z-]+\?from=karte$/)
      const visitId = new URL(page.url()).pathname.split('/').pop()!
      await expect(page.getByRole('heading', { name: `Meldung ${label}` })).toBeVisible()
      const card = page.getByTestId('ov-place-card')
      await expect(card).toContainText(label)
      await expect(card).toContainText('Pin')
      await expect(card).toContainText(/LV95 2.610.0\d\d \/ 1.263.\d\d\d/)

      await page.getByRole('group', { name: 'Was betrifft es?' }).getByRole('button', { name: 'Hydrant' }).click()
      await page.getByLabel('Beschreibung').fill('Neuer Hydrant fehlt im Plan')
      await page.getByRole('group', { name: 'Vor dem nächsten Einsatz nötig?' }).getByRole('button', { name: 'Nein' }).click()
      await page.getByRole('button', { name: 'Abschliessen' }).click()
      await expect(page.getByRole('button', { name: /^Stand anzeigen: Abgeschlossen · Gespeichert/ })).toBeVisible({ timeout: 30_000 })
      // a report says what was reported — not «Keine Mängel»
      await expect(page.getByText('Hydrant · Neuer Hydrant fehlt im Plan')).toBeVisible()
      await expect(page.getByText('Keine Mängel')).toHaveCount(0)

      const saved = await (await api.get(`/api/object-visits/${visitId}`)).json()
      expect(saved).toMatchObject({ lifecycle: 'completed', object: null, target_kind: 'location' })
      expect(saved.target).toEqual({ kind: 'location', label, address: null, lat: 47.52015, lng: 7.57175 })
      expect(saved.location).toMatchObject({ label, lat: 47.52015, lng: 7.57175 })
      const pdf = await api.get(`/api/object-visits/${visitId}/report.pdf`)
      expect(pdf.ok()).toBe(true)

      await page.getByRole('button', { name: 'Zurück zur Karte' }).click()
      await expect(page).toHaveURL(/\/karte(\?.*)?$/)
      await expectNoCrash(page, 'object visit · place')
    } finally {
      await restore()
      await api.dispose()
    }
  })
})
