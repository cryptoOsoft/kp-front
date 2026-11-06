import { useCallback, useEffect, useState } from 'react'
import { idbGet, idbSet } from './idb'

/** The Tafel's free sheet in the page strip — the board itself, not a form. */
export const SKIZZE = 'skizze'

/**
 * Which Tafel page THIS DEVICE is looking at, per Einsatz (10.10.2026; kept across reloads since
 * staging round 2).
 *
 * Device-local on purpose, like a plan's zoom: the page you are on is a way of reading the Tafel,
 * so it never reaches the synced workspace — another tablet stays on its own page. Operational
 * VIEW state, so it lives in IndexedDB (lib/idb, docs/sync-and-offline.md · «Operational browser state lives in
 * IndexedDB»), mirrored in a module-level map so a surface switch (the Whiteboard unmounts every
 * time) comes back on the same page without waiting for the read. A page that no longer exists
 * falls back to the Skizze by construction (Whiteboard · `page`).
 *
 * `fallback` is what a device that has never picked a page on this Einsatz sees: the Skizze,
 * except on the public demo, whose seeded Einsatz opens on its filled «Erste Führung» rather than
 * an empty sheet (Whiteboard passes the first page there, `isDemoMode`). A page the device picked
 * — the Skizze included — always wins over it.
 */
const memory = new Map<string, string>()
const idbKey = (incidentId: string) => `kp-front-tafel-page:${incidentId}`
/** every mounted `useTafelPage`, so a page set from outside the Whiteboard (`setTafelPage`: the
 *  Präsentationsmodus following the presenter's page, the Verlauf's «von der Tafel» opening the
 *  «Aufträge / Pendenzen» page) shows at once */
const listeners = new Set<(key: string) => void>()

/** Put this device on `page` of the Tafel – what the page strip does, from elsewhere. */
export function setTafelPage(incidentId: string, page: string) {
  memory.set(incidentId, page)
  void idbSet(idbKey(incidentId), page)
  for (const l of listeners) l(incidentId)
}

/** The page this device picked on the Tafel, or null when it never picked one (it then sees the
 *  hook's fallback – see `useTafelPage`). */
export const pickedTafelPage = (incidentId: string): string | null => memory.get(incidentId) ?? null

export function useTafelPage(incidentId: string | undefined, fallback: string = SKIZZE): [string, (page: string) => void] {
  const key = incidentId ?? ''
  /** null: this device has not picked a page on this Einsatz (yet) */
  const [page, setPageState] = useState<string | null>(() => memory.get(key) ?? null)
  const [seenKey, setSeenKey] = useState(key)
  // another Einsatz in the same component: its own memory (React's «adjust state while rendering»)
  if (seenKey !== key) { setSeenKey(key); setPageState(memory.get(key) ?? null) }
  // a reload: what this device last had open on this Einsatz, once it is read
  useEffect(() => {
    if (!key || memory.has(key)) return
    let live = true
    void idbGet<string>(idbKey(key)).then((p) => {
      if (!live || typeof p !== 'string' || memory.has(key)) return
      memory.set(key, p)
      setPageState(p)
    }).catch(() => {})
    return () => { live = false }
  }, [key])
  // …and a page set from outside the Tafel (setTafelPage) while it is mounted
  useEffect(() => {
    const hear = (k: string) => { if (k === key) setPageState(memory.get(k) ?? null) }
    listeners.add(hear)
    return () => { listeners.delete(hear) }
  }, [key])
  const setPage = useCallback((p: string) => {
    if (key) setTafelPage(key, p)
    else { memory.set(key, p); setPageState(p) }
  }, [key])
  return [page ?? fallback, setPage]
}

/** test seam */
export const resetTafelPageMemory = () => memory.clear()

/** The page after / before `current` in the strip, for PageDown / PageUp (no wrap: the ends stop). */
export function stepPage(order: readonly string[], current: string, dir: 1 | -1): string {
  const i = order.indexOf(current)
  const j = Math.min(order.length - 1, Math.max(0, (i < 0 ? 0 : i) + dir))
  return order[j] ?? current
}

export { TAFEL_ID } from './boardForm'
