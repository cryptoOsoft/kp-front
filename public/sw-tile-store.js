// Map and plan tiles in IndexedDB, not Cache Storage (08.11.2026). WebKit reads every entry of
// EVERY cache of the origin before its first Cache Storage answer after a launch – the precached
// index.html included – so the installed iPhone app waited 0.85 s (3.9 s on a cold phone) for
// its first byte while 4000 map tiles and up to 12 000 plan tiles sat in Cache Storage. A local
// WebKit cold relaunch: 16 ms with no tiles, 105 ms with 3000, 200 ms with 6000, and 16 ms with
// 6000 in IndexedDB. Tiles are by far the most entries; this script owns their routes (imported
// after sw-media-cache, whose link-client rule still answers first, and before Workbox).
//
// One record per URL: { kind, at, type, body: Blob }. The page reads the same database
// (lib/tileStore) – keep the names, the schema and the kinds below in sync with it.
const KP_TILE_DB = 'kp-tiles'
const KP_TILE_STORE = 'tiles'
const KP_TILE_DAY = 24 * 60 * 60 * 1000
const KP_TILE_KINDS = {
  // Base-map tiles (cross-origin). Cache-first so a previously viewed or pre-downloaded area
  // renders with no signal; a miss is fetched past the browser's HTTP cache (lib/tilePurge: CARTO
  // serves its tiles `immutable`, a purged tile would otherwise come back in the old look).
  // `tiles-a…d.` is CARTO's vector host: the street names drawn over its unlabelled raster.
  map: {
    max: 4000, maxAge: 30 * KP_TILE_DAY, legacy: 'map-tiles', fetchOptions: { cache: 'no-cache' },
    match: (url) => /^https:\/\/([a-d]\.|tiles-[a-d]\.)?(basemaps\.cartocdn\.com|tile\.openstreetmap\.org|[a-c]\.tile\.opentopomap\.org|server\.arcgisonline\.com|wmts\.geo\.admin\.ch|geowms\.bl\.ch)\//.test(url.href),
  },
  // A plan TILE (backend · app/plan_tiles): the revision is part of the path, so cache-first for
  // good. A dense A1 is ~1 500 tiles, prefetched per Einsatzobjekt (lib/planTilePrefetch).
  plan: {
    max: 12000, maxAge: 90 * KP_TILE_DAY, legacy: 'plan-tiles', session: true,
    match: (url) => url.origin === self.location.origin && /^\/api\/reference\/[^/?]+\/tiles\/\d+\/\d+\/\d+\/\d+\/\d+$/.test(url.pathname) && !url.search,
  },
  // …and its manifest: geometry plus a live `complete` flag, so network first, the copy offline.
  manifest: {
    max: 400, maxAge: 90 * KP_TILE_DAY, legacy: 'plan-tile-manifests', session: true, networkFirstMs: 3000,
    match: (url) => url.origin === self.location.origin && /^\/api\/reference\/[^/?]+\/tiles$/.test(url.pathname) && !!url.search,
  },
}

let kpTileDbPromise = null

/** The shared connection; null when IndexedDB cannot be opened (the tiles then go network-only). */
function kpTileDb() {
  kpTileDbPromise ??= new Promise((resolve) => {
    let req
    // open() itself can throw (a locked-down context): the tiles then go to the network
    try { req = indexedDB.open(KP_TILE_DB, 1) } catch { kpTileDbPromise = null; return resolve(null) }
    req.onupgradeneeded = () => req.result.createObjectStore(KP_TILE_STORE).createIndex('age', ['kind', 'at'])
    req.onsuccess = () => {
      const db = req.result
      // WebKit closes connections on its own; the next call opens a fresh one
      db.onclose = () => { kpTileDbPromise = null }
      resolve(db)
    }
    req.onerror = () => { kpTileDbPromise = null; resolve(null) }
  })
  return kpTileDbPromise
}

/** Run `fn` on the tile store in one transaction: its request's result once committed (undefined
 *  without one), or null when the store cannot be opened or the transaction fails. */
async function kpTileTx(mode, fn) {
  const db = await kpTileDb()
  if (!db) return null
  return new Promise((resolve) => {
    let result
    try {
      const tx = db.transaction(KP_TILE_STORE, mode)
      const out = fn(tx.objectStore(KP_TILE_STORE))
      if (out) out.onsuccess = () => { result = out.result }
      tx.oncomplete = () => resolve(result)
      tx.onerror = tx.onabort = () => resolve(null)
    } catch { resolve(null) }
  })
}

// Caches of releases before the move: answered from while they exist, moved over by
// kpMigrateTiles. Remembered per worker once gone, so a new worker asks Cache Storage once.
const kpLegacyGone = new Set()

async function kpLegacyMatch(name, url) {
  if (kpLegacyGone.has(name)) return undefined
  try {
    if (!(await caches.has(name))) { kpLegacyGone.add(name); return undefined }
    return await (await caches.open(name)).match(url)
  } catch { return undefined }
}

const kpOfKind = (kind) => IDBKeyRange.bound([kind, -Infinity], [kind, Infinity])

async function kpTrimTiles(kind) {
  const range = kpOfKind(kind)
  const count = await kpTileTx('readonly', (store) => store.index('age').count(range))
  const extra = (count ?? 0) - KP_TILE_KINDS[kind].max
  if (extra <= 0) return
  // oldest stored first
  await kpTileTx('readwrite', (store) => {
    let left = extra
    const cursor = store.index('age').openKeyCursor(range)
    cursor.onsuccess = () => {
      const c = cursor.result
      if (!c || left-- <= 0) return
      store.delete(c.primaryKey)
      c.continue()
    }
  })
}

/** When a legacy cache's copy was stored: its `Date`, or 0 – of unknown age, so it counts as old
 *  (fetched again online, still answering offline) rather than fresh. */
const kpKeptAt = (response) => Date.parse(response.headers.get('date') ?? '') || 0

/** The record of a 200 response, or null: opaque responses cannot be read into a Blob and stay
 *  network-only. A copy `kept` in a legacy cache keeps its age, so the move does not make an old
 *  tile fresh again. */
async function kpTileRecord(url, response, kept = false) {
  if (!response || response.status !== 200 || response.type === 'opaque') return null
  const body = await response.blob()
  const at = kept ? kpKeptAt(response) : Date.now()
  return { url, at, type: response.headers.get('content-type') ?? body.type, body }
}

// Bumped by every denial purge (kpClearTiles): a write whose body was read before it must not
// commit after it and bring the revoked station's plans back.
let kpTileEpoch = 0
// writes per kind in this worker's life: the first one and every 100th trim the kind, inside the
// event that wrote (a timer would die with an idle worker)
const kpTileWrites = new Map()

/** Store these records in one transaction; false when it failed (quota) or a denial came between. */
async function kpPutTiles(kind, records, epoch) {
  let stale = false
  const done = await kpTileTx('readwrite', (store) => {
    // checked as the transaction is created: a purge's transaction, created later, runs after it
    if (epoch !== kpTileEpoch) { stale = true; return }
    for (const { url, at, type, body } of records) store.put({ kind, at, type, body }, url)
  })
  if (done === null || stale) return false
  const before = kpTileWrites.get(kind)
  const after = (before ?? 0) + records.length
  kpTileWrites.set(kind, after)
  if (before === undefined || Math.floor(after / 100) > Math.floor(before / 100)) await kpTrimTiles(kind)
  return true
}

/** `epoch`: kpTileEpoch when the request STARTED – an answer to a request from before a denial
 *  arrives after it. */
async function kpWriteTile(url, kind, response, epoch, kept = false) {
  const record = await kpTileRecord(url, response, kept)
  if (record) await kpPutTiles(kind, [record], epoch)
}

/** The stored copy of `url` (or the legacy cache's), and whether it is past its kind's maxAge. */
async function kpReadTile(event, url, kind, epoch) {
  const rec = await kpTileTx('readonly', (store) => store.get(url))
  if (rec && rec.kind === kind) {
    return {
      response: new Response(rec.body, { headers: { 'content-type': rec.type } }),
      expired: Date.now() - rec.at > KP_TILE_KINDS[kind].maxAge,
    }
  }
  const legacy = await kpLegacyMatch(KP_TILE_KINDS[kind].legacy, url)
  if (!legacy) return null
  // moved on read, so the page's probes (lib/tileStore) see it before the migration gets there
  event.waitUntil(kpWriteTile(url, kind, legacy.clone(), epoch, true).catch(() => {}))
  return { response: legacy, expired: Date.now() - kpKeptAt(legacy) > KP_TILE_KINDS[kind].maxAge }
}

async function kpFetchTile(event, kind, epoch) {
  const response = await fetch(event.request, KP_TILE_KINDS[kind].fetchOptions)
  event.waitUntil(kpWriteTile(event.request.url, kind, response.clone(), epoch).catch(() => {}))
  return response
}

async function kpServeTile(event, kind) {
  const spec = KP_TILE_KINDS[kind]
  const epoch = kpTileEpoch
  // the plan routes follow the reference session rule of sw-media-cache: a client that is no
  // account asks the server, past this store and the HTTP cache
  if (spec.session && !(await self.kpReferenceCacheAllowed(event, event.request))) {
    return fetch(new Request(event.request, { cache: 'no-store' }))
  }
  if (spec.networkFirstMs) {
    const network = kpFetchTile(event, kind, epoch)
    const timedOut = new Promise((resolve) => setTimeout(() => resolve(null), spec.networkFirstMs))
    const first = await Promise.race([network.then((response) => ({ response }), () => null), timedOut])
    if (first) return first.response
    const held = await kpReadTile(event, event.request.url, kind, epoch)
    if (!held) return network
    event.waitUntil(network.catch(() => {}))
    return held.response
  }
  const held = await kpReadTile(event, event.request.url, kind, epoch)
  if (held && !held.expired) return held.response
  try {
    return await kpFetchTile(event, kind, epoch)
  } catch (error) {
    // an expired copy still beats no tile without signal
    if (held) return held.response
    throw error
  }
}

self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET') return
  const url = new URL(event.request.url)
  const kind = Object.keys(KP_TILE_KINDS).find((k) => KP_TILE_KINDS[k].match(url))
  if (!kind) return
  event.stopImmediatePropagation()
  event.respondWith(kpServeTile(event, kind))
})

let kpMigrating = null

/** Copy the legacy caches' tiles into the store, 100 per transaction, then delete each cache
 *  whole, not entry by entry. Plans first: they are station records, the
 *  base map comes back from the internet. Resumable: a worker stopped half-way copies only what
 *  the store does not hold yet; a failed write (quota) keeps the cache for the next launch. */
async function kpMigrateTiles() {
  // one epoch for the whole run: a denial anywhere in it ends the run – a Cache object already
  // open still reads after the purge deleted its cache
  const epoch = kpTileEpoch
  for (const kind of ['manifest', 'plan', 'map']) {
    if (epoch !== kpTileEpoch) return
    const { legacy, max } = KP_TILE_KINDS[kind]
    if (!(await caches.has(legacy))) { kpLegacyGone.add(legacy); continue }
    const cache = await caches.open(legacy)
    const held = new Set(await kpTileTx('readonly', (store) => store.index('age').getAllKeys(kpOfKind(kind))) ?? [])
    // the newest `max` (keys come oldest first): more would only be trimmed again, and re-copied
    // on every launch after
    const keys = (await cache.keys()).slice(-max).filter((req) => !held.has(req.url))
    for (let i = 0; i < keys.length; i += 100) {
      const batch = await Promise.all(keys.slice(i, i + 100).map(async (req) => kpTileRecord(req.url, await cache.match(req), true)))
      if (!(await kpPutTiles(kind, batch.filter(Boolean), epoch))) return
    }
    await caches.delete(legacy)
    kpLegacyGone.add(legacy)
  }
}

/** Drop stored tiles of these kinds – sw-media-cache's purge on an explicit denial. */
self.kpClearTiles = async (kinds) => {
  kpTileEpoch++
  await kpTileTx('readwrite', (store) => {
    for (const kind of kinds) {
      const cursor = store.index('age').openKeyCursor(kpOfKind(kind))
      cursor.onsuccess = () => {
        const c = cursor.result
        if (!c) return
        store.delete(c.primaryKey)
        c.continue()
      }
    }
  })
}

// the page asks once per launch, after the boot (main.tsx)
self.addEventListener('message', (event) => {
  if (event.data?.type !== 'kp-tile-migrate') return
  kpMigrating ??= kpMigrateTiles().catch(() => {}).finally(() => { kpMigrating = null })
  event.waitUntil(kpMigrating)
})
