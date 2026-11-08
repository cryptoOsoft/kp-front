// Auth-aware incident-media cache. Imported before Workbox registers its routes, so this
// listener owns /api/media/* and stops Workbox from installing a second, auth-blind route.
// Reference caches belong to real account clients only. A link or unknown client must ask the
// server, past BOTH Workbox and the browser's HTTP cache: a cached station register/plan must
// never bypass the link's incident scope. Account reference reads keep Workbox's offline cache.
// A worker's memory disappears on idle termination, without controllerchange. Unknown clients
// re-announce their CURRENT context on request; Workbox's async plugins await that handshake.
const KP_MEDIA_CACHE = 'incident-media'
const KP_MEDIA_OWNER_CACHE = 'kp-media-cache-owner'
// Station reference data (symbols + geojson), cached by Workbox (vite.config · reference-data).
// Not owner-scoped, so an EXPLICIT denial has to purge it here too — otherwise a revoked device
// keeps reading the station's reference datasets. A mere loss of connectivity never reaches this
// worker with «logged-out», so offline reads of reference data are untouched.
const KP_REFERENCE_CACHE = 'reference-data'
// …and the pinned plan revisions, cached separately because they are PDFs of tens of megabytes
// (vite.config · reference-plans). Same rule: a revoked device keeps nothing of the station.
const KP_REFERENCE_PLAN_CACHE = 'reference-plans'
// …and the same sheets as tiles, with their manifests (sw-tile-store.js), plus the Cache Storage
// copies of releases before 08.11.2026 that are not moved over yet.
const KP_PLAN_TILE_CACHES = ['plan-tiles', 'plan-tile-manifests']
// …and the checklist images: Anleitung step pictures + playbook diagrams (vite.config · checklist-assets).
const KP_CHECKLIST_ASSET_CACHE = 'checklist-assets'
const KP_MEDIA_OWNER_URL = new URL('/__kp/media-cache-owner', self.location.origin).toString()
const KP_MEDIA_MAX_ENTRIES = 200
const KP_MEDIA_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000
const kpMediaClients = new Map()
const kpMediaAuthRequests = new Map()

function kpFinishMediaAuth(clientId) {
  kpMediaAuthRequests.get(clientId)?.finish(kpMediaClients.get(clientId) ?? null)
}

async function kpClientAuth(event) {
  const known = kpMediaClients.get(event.clientId)
  if (known || !event.clientId || !self.clients?.get) return known ?? null
  const pending = kpMediaAuthRequests.get(event.clientId)
  if (pending) return pending.promise

  // Deduplicate concurrent plan/tile reads after an idle restart. No cached permission is
  // inferred from a cookie, URL or an old owner: the live page must report its latest state.
  let finish
  const promise = new Promise((resolve) => {
    let settled = false
    const timeout = setTimeout(() => finish(null), 1000)
    finish = (auth) => {
      if (settled) return
      settled = true
      clearTimeout(timeout)
      kpMediaAuthRequests.delete(event.clientId)
      resolve(auth)
    }
  })
  kpMediaAuthRequests.set(event.clientId, { promise, finish })
  void self.clients.get(event.clientId).then((client) => {
    if (client) client.postMessage({ type: 'kp-media-auth-request' })
    else finish(null)
  }).catch(() => finish(null))
  return promise
}

// Called by the generated Workbox plugins before reading/storing a reference response or
// choosing network cache mode. Async here preserves CacheFirst/NetworkFirst/SWR unchanged.
self.kpReferenceCacheAllowed = async (event, request) => {
  if (request.headers.get('X-Incident-Link') === 'use') return false
  return (await kpClientAuth(event))?.kind === 'user'
}

async function kpReadMediaOwner() {
  const cache = await caches.open(KP_MEDIA_OWNER_CACHE)
  const response = await cache.match(KP_MEDIA_OWNER_URL)
  return response ? response.text() : null
}

async function kpSetMediaOwner(userId) {
  const previous = await kpReadMediaOwner()
  if (previous !== userId) {
    // This also retires auth-blind entries left by releases before ownership existed.
    await caches.delete(KP_MEDIA_CACHE)
    const cache = await caches.open(KP_MEDIA_OWNER_CACHE)
    await cache.put(KP_MEDIA_OWNER_URL, new Response(userId))
  }
}

async function kpClearOnDenial() {
  await Promise.all([
    caches.delete(KP_MEDIA_CACHE),
    caches.delete(KP_MEDIA_OWNER_CACHE),
    caches.delete(KP_REFERENCE_CACHE),
    caches.delete(KP_REFERENCE_PLAN_CACHE),
    ...KP_PLAN_TILE_CACHES.map((name) => caches.delete(name)),
    self.kpClearTiles?.(['plan', 'manifest']),
    caches.delete(KP_CHECKLIST_ASSET_CACHE),
  ])
}

self.addEventListener('message', (event) => {
  if (!event.data || event.data.type !== 'kp-media-auth' || !event.source?.id) return
  const clientId = event.source.id
  if (event.data.kind === 'user' && typeof event.data.userId === 'string' && event.data.userId) {
    kpMediaClients.set(clientId, { kind: 'user', userId: event.data.userId })
    event.waitUntil(kpSetMediaOwner(event.data.userId).then(() => kpFinishMediaAuth(clientId)))
  } else if (event.data.kind === 'link') {
    // A link may fetch media/reference data the backend authorizes, never the account's cache.
    kpMediaClients.set(clientId, { kind: 'link' })
    kpFinishMediaAuth(clientId)
  } else if (event.data.kind === 'logged-out') {
    // Sign-out AND explicit server denial arrive here (lib/auth · denySession). Both are about
    // the whole browser, not one tab: every client shares the one cookie the server just
    // refused, so every grant is dropped, not only the sender's. Other tabs must affirm their
    // latest context before any cache read; auth's cross-tab denial updates that context too.
    // The media, owner AND station reference caches are all purged — see kpClearOnDenial.
    kpMediaClients.clear()
    for (const pending of kpMediaAuthRequests.values()) pending.finish(null)
    event.waitUntil(kpClearOnDenial())
  }
})

async function kpStoreMedia(cache, request, response) {
  const copy = response.clone()
  const headers = new Headers(copy.headers)
  headers.set('x-kp-cached-at', String(Date.now()))
  await cache.put(request, new Response(copy.body, {
    status: copy.status,
    statusText: copy.statusText,
    headers,
  }))
  const keys = await cache.keys()
  await Promise.all(keys.slice(0, Math.max(0, keys.length - KP_MEDIA_MAX_ENTRIES)).map((key) => cache.delete(key)))
}

async function kpNetworkMedia(request, cache) {
  const response = await fetch(request)
  if (cache && response.status === 200) await kpStoreMedia(cache, request, response)
  return response
}

async function kpHandleMedia(event) {
  const auth = await kpClientAuth(event)
  if (!auth || auth.kind !== 'user') return kpNetworkMedia(event.request, null)

  const owner = await kpReadMediaOwner()
  if (owner !== auth.userId) return kpNetworkMedia(event.request, null)

  // Range responses are request-specific and must not be confused with the complete object.
  if (event.request.headers.has('range')) return kpNetworkMedia(event.request, null)

  const cache = await caches.open(KP_MEDIA_CACHE)
  const cached = await cache.match(event.request)
  if (cached) {
    const storedAt = Number(cached.headers.get('x-kp-cached-at'))
    if (Number.isFinite(storedAt) && Date.now() - storedAt <= KP_MEDIA_MAX_AGE_MS) return cached
  }

  try {
    return await kpNetworkMedia(event.request, cache)
  } catch (error) {
    // Preserve the old offline promise even after max-age; refresh it when signal returns.
    if (cached) return cached
    throw error
  }
}

self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET') return
  const url = new URL(event.request.url)
  if (url.origin !== self.location.origin) return

  const auth = kpMediaClients.get(event.clientId)
  if (url.pathname.startsWith('/api/reference/') &&
      (auth?.kind === 'link' || event.request.headers.get('X-Incident-Link') === 'use')) {
    // Workbox matches URLs, not the session whose cookie/header answers the request. Its
    // StaleWhileRevalidate would return the account's cached 200 even while the server says
    // 403 to this link; pinned PDFs/tiles are CacheFirst and never ask the server at all.
    // A headerless <img> is gated by its client, and an explicit link header wins even before
    // the page's new auth message arrives. Unknown clients are resolved by Workbox's async
    // session plugins; no reply or a denied context remains network-only.
    event.stopImmediatePropagation()
    event.respondWith(fetch(event.request, { cache: 'no-store' }))
    return
  }
  if (!url.pathname.startsWith('/api/media/')) return

  event.stopImmediatePropagation()
  event.respondWith(kpHandleMedia(event))
})
