// Seed the tile store (lib/tileStore · public/sw-tile-store.js) the way the worker writes it.
// Needs an IndexedDB in the test: `import 'fake-indexeddb/auto'`.
import type { TileKind } from './tileStore'

/** Store these URLs; `at` defaults to their order, so the first is the oldest. */
export async function seedTiles(kind: TileKind, urls: readonly string[], at = (i: number) => i): Promise<void> {
  const db = await new Promise<IDBDatabase>((resolve, reject) => {
    const req = indexedDB.open('kp-tiles', 1)
    req.onupgradeneeded = () => req.result.createObjectStore('tiles').createIndex('age', ['kind', 'at'])
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
  })
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction('tiles', 'readwrite')
    urls.forEach((url, i) => tx.objectStore('tiles').put({ kind, at: at(i), type: 'image/png', body: new Blob(['t']) }, url))
    tx.oncomplete = () => resolve()
    tx.onerror = () => reject(tx.error)
  })
  db.close()
}
