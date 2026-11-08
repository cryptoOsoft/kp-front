/**
 * «Is the plan on the glass as sharp as this view asks?» — what a plan reader tells the surface it
 * sits in (owner, Karte review round 3, 17.10.2026: «if you zoom in quickly before things have
 * loaded, everything is blurry … we need a way to indicate that the plan is still loading»).
 *
 * The reader draws a soft picture first and sharpens it as the detail arrives
 * (components/PlanTileLayer: an always-there underlay, then the tiles of the level the zoom asks
 * for). In an Einsatz the tiles are prepared on the device ahead of time (lib/planTilePrefetch);
 * on the Karte they come over the network on demand, so «soft» can last — or, offline, never end.
 *
 * ⚠️ Opt-in, by context: only a surface that PROVIDES `PlanSharpnessContext` hears anything (today
 * the Karte, components/karte/KartePlans · KartePlanBoard). The Einsatz's own Plan surface
 * provides none, so it neither shows the chip nor fetches ahead.
 */
import { createContext } from 'react'

/** sharp = nothing for the current view is missing · loading = detail tiles still on their way ·
 *  failed = some detail tile for this view could not be had (offline and not stored, a server error) */
export type PlanSharpness = 'sharp' | 'loading' | 'failed'

export interface PlanSharpnessHooks {
  /** called whenever the reader's answer for the CURRENT view changes; 'sharp' on unmount */
  report: (s: PlanSharpness) => void
  /** once the view is sharp and the device online, fetch the tiles a 2× zoom of the SAME area
   *  would ask for — so a quick zoom is sharp sooner. Never the whole plan (data cost). */
  prefetchNext: boolean
}

export const PlanSharpnessContext = createContext<PlanSharpnessHooks | null>(null)

/** The reader's answer from the current tile set: anything still pending wins over a failure. */
export function tileSetSharpness(ready: boolean, pending: number, failed: number): PlanSharpness {
  // the underlay is not even there: the reader's own «PDF wird geladen …» speaks, not the chip
  if (!ready) return 'sharp'
  return pending > 0 ? 'loading' : failed > 0 ? 'failed' : 'sharp'
}

/** What the surface says: a spinner while it loads, and — when a tile could not be had offline —
 *  that the sharper picture needs the network, instead of a spinner that would never end.
 *  ⚠️ «loading» stays a spinner offline too: a stored tile still arrives (the service worker answers
 *  at once, under the chip's delay), a missing one fails fast and turns this into «offline», and the
 *  pdf.js path sharpens from the PDF on the device with no network at all. */
export type SharpChip = 'loading' | 'offline' | 'failed' | null
export function sharpChip(s: PlanSharpness, offline: boolean): SharpChip {
  if (s === 'sharp') return null
  if (s === 'failed' && offline) return 'offline'
  return s
}

/** A quick load does not flash the chip: «not sharp» has to last this long before it shows. */
export const SHARP_CHIP_DELAY_MS = 300

/**
 * A `report` that holds back the first «not sharp» for `delayMs` and lets everything else through
 * at once: 'sharp' hides the chip immediately, and once the chip is up a change of reason
 * (loading → failed) does not blink it away for another delay. `cancel` on unmount.
 */
export function delayedSharpness(set: (s: PlanSharpness) => void, delayMs = SHARP_CHIP_DELAY_MS) {
  let shown: PlanSharpness = 'sharp'
  let timer: ReturnType<typeof setTimeout> | null = null
  const clear = () => { if (timer) { clearTimeout(timer); timer = null } }
  return {
    report(s: PlanSharpness) {
      clear()
      if (s === 'sharp' || shown !== 'sharp') { shown = s; set(s); return }
      timer = setTimeout(() => { timer = null; shown = s; set(s) }, delayMs)
    },
    cancel: clear,
  }
}

/** Tile URLs this session has already asked ahead for — each is fetched once. Capped like the
 *  reader's own «seen» set: it is a hint, and a forgotten URL is merely asked for again. */
const warmed = new Set<string>()
/** How many tiles one view may fetch ahead: about a phone screen at the next level. */
export const PREFETCH_CAP = 48

/**
 * Ask for `urls` (ahead of need) through the service worker, which keeps a tile for good
 * (cache-first, public/sw-tile-store.js). Low priority, never more than `PREFETCH_CAP` at a time,
 * nothing offline, nothing twice. Returns the URLs it asked for.
 */
export function warmTiles(urls: readonly string[], online = typeof navigator === 'undefined' || navigator.onLine): string[] {
  if (!online) return []
  const fresh = urls.filter((u) => !warmed.has(u)).slice(0, PREFETCH_CAP)
  for (const u of fresh) {
    warmed.add(u)
    // a failed warm-up is nothing: the reader asks for the tile itself when it is needed
    void fetch(u, { credentials: 'same-origin', priority: 'low' } as RequestInit).catch(() => { warmed.delete(u) })
  }
  if (warmed.size > 4000) for (const u of warmed) { warmed.delete(u); if (warmed.size <= 3000) break }
  return fresh
}

/** tests */
export const resetWarmedTiles = () => warmed.clear()
