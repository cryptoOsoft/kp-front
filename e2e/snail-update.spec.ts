import { createServer } from 'node:http'
import type { AddressInfo } from 'node:net'
import { test, expect } from './helpers'

// The real production shell and Workbox run under a disposable local origin. Only the worker
// bytes change between launches; API answers stay anonymous, so the drill touches no station
// data. Page routing cannot reliably intercept the browser's worker-update script fetch.
// Pin every outgoing request to the configured origin and reject redirects: incoming request
// targets may be absolute URLs or network-path references, not only ordinary asset paths.
test('a startup worker update continues the snail instead of replaying its entrance', async ({ page, baseURL }) => {
  if (!baseURL) throw new Error('A production stack is required for the worker-update drill')
  const upstreamOrigin = new URL(baseURL).origin
  let version = 1
  const server = createServer(async (request, response) => {
    try {
      const target = new URL(request.url || '/', upstreamOrigin)
      if (target.origin !== upstreamOrigin) {
        response.writeHead(400)
        response.end()
        return
      }
      const path = target.pathname
      if (path.startsWith('/api/')) {
        if (path === '/api/auth/me') await new Promise(resolve => setTimeout(resolve, 300))
        const denied = path === '/api/auth/me' || path === '/api/auth/refresh'
        response.writeHead(denied ? 401 : 200, { 'Content-Type': 'application/json' })
        response.end(JSON.stringify(denied ? { detail: 'Not authenticated' } : path === '/api/auth/roster' ? [] : {}))
        return
      }
      const upstream = await fetch(`${upstreamOrigin}${path}${target.search}`, { redirect: 'error' })
      const body = Buffer.from(await upstream.arrayBuffer())
      response.writeHead(upstream.status, {
        'Content-Type': upstream.headers.get('Content-Type') || 'application/octet-stream',
        'Cache-Control': 'no-store',
      })
      response.end(path === '/sw.js' ? Buffer.concat([body, Buffer.from(`\n// Snail update drill ${version}\n`)]) : body)
    } catch {
      response.writeHead(502)
      response.end()
    }
  })
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  const origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
  try {
    // A network-path reference must not override the configured upstream. Point at this
    // disposable server's own anonymous API, so a regression never contacts an outside host.
    const escaped = await page.request.get(`${origin}//${new URL(origin).host}/api/auth/me`, { maxRedirects: 0 })
    expect(escaped.status(), 'the proxy must reject requests that replace the upstream origin').toBe(400)
    await page.emulateMedia({ reducedMotion: 'no-preference' })
    await page.addInitScript(() => {
      const record = (entry: object) => {
        const entries = JSON.parse(sessionStorage.getItem('snail-update-observations') || '[]') as object[]
        sessionStorage.setItem('snail-update-observations', JSON.stringify([...entries, entry]))
      }
      record({ event: 'document' })
      document.addEventListener('animationstart', event => {
        if (event.animationName.endsWith('-arrival')) {
          const node = event.target as Element
          if (node.closest('.boot-splash')) record({ event: 'arrival', elapsed: event.elapsedTime })
          else {
            const animation = node.getAnimations().find(item => (item as CSSAnimation).animationName === event.animationName)
            record({ event: 'react-arrival', progress: animation?.effect?.getComputedTiming().progress })
          }
        }
      }, true)
    })
    const observations = () => page.evaluate(() => JSON.parse(sessionStorage.getItem('snail-update-observations') || '[]') as { event: string; elapsed?: number; progress?: number }[])
    await page.goto(origin)
    await expect(page.locator('.login-state')).toBeVisible()
    await page.evaluate(async () => { await navigator.serviceWorker.ready })
    await expect.poll(() => page.evaluate(() => !!navigator.serviceWorker.controller)).toBe(true)

    // An ordinary reload still gets its own complete entrance.
    await page.evaluate(() => sessionStorage.setItem('snail-update-observations', '[]'))
    await page.reload()
    await expect(page.locator('.login-state')).toBeVisible()
    expect((await observations()).filter(entry => entry.event !== 'react-arrival')).toEqual([{ event: 'document' }, { event: 'arrival', elapsed: 0 }])

    // An update found during the next opening really reloads the page, but its second cover
    // must begin past the entrance. Trigger the check explicitly instead of waiting for the
    // browser's update-check throttle; every install/activation/reload handler is the real one.
    await page.evaluate(() => sessionStorage.setItem('snail-update-observations', '[]'))
    await page.reload()
    await expect(page.locator('.login-state')).toBeVisible()
    // the login renders BENEATH the cover (lib/snailLaunch · liftBootCover): the entrance has
    // ended once the cover is gone
    await expect(page.locator('.boot-splash')).toHaveCount(0)
    version++ // discover only after this entrance ends, still inside the untouched boot window
    await page.evaluate(async () => { await (await navigator.serviceWorker.getRegistration())?.update() }).catch(error => {
      if (!String(error).includes('Execution context was destroyed')) throw error
    })
    await expect.poll(async () => {
      try { return (await observations()).filter(entry => entry.event === 'document').length }
      catch (error) {
        if (String(error).includes('Execution context was destroyed')) return 0
        throw error
      }
    }).toBe(2)
    await expect(page.locator('.login-state')).toBeVisible()
    const arrivals = (await observations()).filter(entry => entry.event === 'arrival')
    expect(arrivals).toHaveLength(2)
    expect(arrivals[0].elapsed).toBe(0)
    expect(arrivals[1].elapsed, 'the update reload must not replay the 630 ms entrance').toBeGreaterThanOrEqual(0.63)
    // React's loaders on the RELOADED page only: on the first one React mounts beneath the cover
    // mid-entrance, in step with it (lib/snailLaunch · liftBootCover), so its progress is <1 there
    const all = await observations()
    const reloaded = all.slice(all.map(entry => entry.event).lastIndexOf('document'))
    const reactArrivals = reloaded.filter(entry => entry.event === 'react-arrival')
    expect(reactArrivals.length).toBeGreaterThan(0)
    for (const arrival of reactArrivals) expect(arrival.progress, 'React must also continue past the entrance').toBe(1)

    // The resume is one-shot: a later deliberate reload gets a fresh entrance again.
    await page.evaluate(() => sessionStorage.setItem('snail-update-observations', '[]'))
    await page.reload()
    await expect(page.locator('.login-state')).toBeVisible()
    expect((await observations()).filter(entry => entry.event !== 'react-arrival')).toEqual([{ event: 'document' }, { event: 'arrival', elapsed: 0 }])
  } finally {
    server.closeAllConnections()
    await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()))
  }
})
