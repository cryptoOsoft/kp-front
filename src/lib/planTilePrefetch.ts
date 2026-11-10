/**
 * Every tile of an Einsatzobjekt's sheets, fetched once in the background — so a plan that was
 * on this device while it had a network is WHOLE without one (decided 21.09.2026: prefetch per
 * object, not lazily as you pan; a corner of a Geschossplan nobody happened to look at must not
 * be blank in a cellar at 3am).
 *
 * The fetches only exist to pass through the service worker, whose plan-tile route is
 * cache-first and keeps them (public/sw-tile-store.js · lib/tileStore); nothing is held here. So:
 *  · no controlling service worker (dev server, first visit) → nothing to fill, nothing fetched;
 *  · a source whose LAST tile is already cached is done — tiles are fetched in order, so the
 *    last one is only there when the rest are;
 *  · a pyramid the server has not finished (`complete: false`) is left for the next visit:
 *    asking for every tile now would make the server render the whole sheet on the spot;
 *  · «Datensparmodus» is respected, and two requests at a time leave the radio to the Einsatz.
 */
import { allTileUrls, loadTileManifest, tileSource } from './planTiles'
import { hasTile } from './tileStore'

const CONCURRENCY = 2
const started = new Set<string>()
let queue: Promise<unknown> = Promise.resolve()

const savingData = () =>
  (navigator as Navigator & { connection?: { saveData?: boolean } }).connection?.saveData === true

async function fillOne(url: string): Promise<void> {
  const source = tileSource(url)
  if (!source) return
  const manifest = await loadTileManifest(source).catch(() => null)
  if (!manifest?.complete) { started.delete(url); return } // not yet – the next visit asks again
  const urls = allTileUrls(manifest, source)
  if (!urls.length || (await hasTile(urls[urls.length - 1]))) return
  let next = 0
  const worker = async () => {
    while (next < urls.length) {
      const tile = urls[next++]
      if (!navigator.onLine) { started.delete(url); return } // dropped off the net: resume another time
      if (await hasTile(tile)) continue
      await fetch(tile, { credentials: 'same-origin' }).then((r) => r.arrayBuffer()).catch(() => {})
    }
  }
  await Promise.all(Array.from({ length: CONCURRENCY }, worker))
}

/** Queue the sheets behind these plan URLs for offline use. Cheap to call on every render of a
 *  plan list: a URL is taken up once per session, and the sheets are filled one after another. */
export function prefetchPlanTiles(urls: string[]): void {
  if (typeof navigator === 'undefined') return
  if (!navigator.serviceWorker?.controller || savingData()) return
  for (const url of urls) {
    const key = url.replace(/#.*$/, '')
    if (started.has(key)) continue
    started.add(key)
    queue = queue.then(() => fillOne(key)).catch(() => {})
  }
}
