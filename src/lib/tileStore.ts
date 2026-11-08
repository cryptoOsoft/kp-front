// The page's half of the tile store. Map tiles, plan tiles and plan-tile manifests live in
// IndexedDB, written by the service worker (public/sw-tile-store.js says why – Cache Storage's
// size is a launch cost on iOS – and owns the routes). The page only asks what is held and drops
// what must go. Keep the database name, the schema and the kinds in sync with that script.

export type TileKind = 'map' | 'plan' | 'manifest'

interface TileRecord { kind: TileKind; at: number; type: string; body: Blob }

const DB = 'kp-tiles'
const STORE = 'tiles'

let dbPromise: Promise<IDBDatabase | null> | null = null

function tileDb(): Promise<IDBDatabase | null> {
  if (typeof indexedDB === 'undefined') return Promise.resolve(null)
  dbPromise ??= new Promise((resolve) => {
    let req: IDBOpenDBRequest
    // open() itself can throw (a locked-down context): «no store», not a rejected promise
    try { req = indexedDB.open(DB, 1) } catch { dbPromise = null; return resolve(null) }
    req.onupgradeneeded = () => req.result.createObjectStore(STORE).createIndex('age', ['kind', 'at'])
    req.onsuccess = () => {
      const db = req.result
      // WebKit closes connections on its own (lib/idb · forgetConnection); the next call reopens
      db.onclose = () => { dbPromise = null }
      resolve(db)
    }
    req.onerror = () => { dbPromise = null; resolve(null) }
  })
  return dbPromise
}

/** One transaction: the request's result once it commits (undefined without one), or null when
 *  the store cannot be opened or the transaction fails. */
async function run<T>(mode: IDBTransactionMode, fn: (store: IDBObjectStore) => IDBRequest<T> | void): Promise<T | undefined | null> {
  const db = await tileDb()
  if (!db) return null
  return new Promise((resolve) => {
    let result: T | undefined
    try {
      const tx = db.transaction(STORE, mode)
      const req = fn(tx.objectStore(STORE))
      if (req) req.onsuccess = () => { result = req.result }
      tx.oncomplete = () => resolve(result)
      tx.onerror = tx.onabort = () => resolve(null)
    } catch {
      resolve(null)
    }
  })
}

const ofKind = (kind: TileKind) => IDBKeyRange.bound([kind, -Infinity], [kind, Infinity])
/** Records are keyed by the worker's absolute request URL. */
const absolute = (url: string) => new URL(url, location.href).href

/** Every stored URL of a kind, oldest first; null when the store cannot be read. */
export async function tileUrls(kind: TileKind): Promise<string[] | null> {
  const keys = await run('readonly', (store) => store.index('age').getAllKeys(ofKind(kind)))
  return keys ? keys.map(String) : null
}

export async function hasTile(url: string): Promise<boolean> {
  return (await run('readonly', (store) => store.getKey(absolute(url)))) != null
}

/** The stored body of `url`, or null. */
export async function readTile(url: string): Promise<Blob | null> {
  const rec = await run<TileRecord | undefined>('readonly', (store) => store.get(absolute(url)))
  return rec?.body ?? null
}

/** Delete these URLs; how many went (0 when the store cannot be written). */
export async function deleteTiles(urls: readonly string[]): Promise<number> {
  if (!urls.length) return 0
  const done = await run('readwrite', (store) => { for (const url of urls) store.delete(url) })
  return done === null ? 0 : urls.length
}

export async function countTiles(kind: TileKind): Promise<number> {
  return (await run('readonly', (store) => store.index('age').count(ofKind(kind)))) ?? 0
}

/** Drop every stored tile (admin · Offline-Cache leeren); false when that failed. */
export async function clearTiles(): Promise<boolean> {
  return (await run('readwrite', (store) => store.clear())) !== null
}

/** The Cache Storage caches tiles lived in before 08.11.2026 – read and dropped like the store
 *  until the worker has moved them over (public/sw-tile-store.js · kpMigrateTiles). */
export const LEGACY_TILE_CACHES: Record<TileKind, string> = { map: 'map-tiles', plan: 'plan-tiles', manifest: 'plan-tile-manifests' }
