/*
 * The Mannschaft (roster) is cached there too (`kp-front-roster`, `usePersonnel`); a one-off
 *   read outside the hook — the Leeres Erfassungsblatt — goes through `loadRoster` (server, else the
 *   cache), never a bare `listPersonnel()`, and the launcher warms it at sign-in (05.10.2026: the
 *   blank sheet printed an empty «Personal / Anwesenheit» offline).
 */

import { useCallback, useEffect, useState } from 'react'
import { listPersonnel } from './incidents'
import { idbGet, idbSet } from './idb'
import type { Person } from '../types'

// Persist the roster across app restarts so a close→open (and especially an offline launch)
// shows the last-known Mannschaft instantly instead of an empty list — the API is NetworkOnly
// for the SW, so we cache it here, the same way the incident list is cached (see incidents.ts).
const ROSTER_CACHE = 'kp-front-roster'
function readCachedRoster(): Promise<Person[]> {
  return idbGet<Person[]>(ROSTER_CACHE).then((v) => v ?? [])
}
function cacheRoster(list: Person[]): void {
  void idbSet(ROSTER_CACHE, list)
}

/** The launcher's warm-up (App · loadRoster) and the hook's initial load are seconds apart at
 *  every launch into an Einsatz, and each used to ask the server for the same roster. The newest
 *  `loadRoster` request is kept here, and an initial load within ROSTER_WARM_MS of its start takes
 *  that answer instead of sending its own. Only the initial load: the background refresh and the
 *  retry exist to fetch a NEWER list. */
const ROSTER_WARM_MS = 30_000
let warmUp: { request: Promise<Person[]>; at: number } | null = null
/** The initial load's roster: the warm-up's answer while it is fresh, the server's otherwise –
 *  and the server's too when the warm-up failed. */
function initialRoster(): Promise<Person[]> {
  if (!warmUp || Date.now() - warmUp.at >= ROSTER_WARM_MS) return listPersonnel()
  return warmUp.request.catch(() => listPersonnel())
}

/** The roster for a one-off read OUTSIDE the hook — the Leeres Erfassungsblatt, the launcher's
 *  warm-up: the server's list (re-cached on the way), else the last one this device held.
 *
 *  ⚠️ Never a bare `listPersonnel()` for something a person needs offline. The blank sheet used
 *  to call it directly and came out with an empty «Personal / Anwesenheit» in airplane mode
 *  (05.10.2026, owner's Übung) although the same device showed the whole Mannschaft in the
 *  Anwesenheit a minute before. Rejects only when there is neither a server answer nor a cache. */
export async function loadRoster(): Promise<Person[]> {
  try {
    const request = listPersonnel()
    warmUp = { request, at: Date.now() }
    const list = await request
    cacheRoster(list)
    return list
  } catch (e) {
    const cached = await readCachedRoster().catch(() => [] as Person[])
    if (cached.length) return cached
    throw e
  }
}

/** Same roster, same order, same rows? Then hand the CALLER back its own array.
 *
 *  The background refresh below runs while somebody is ticking people in and out, and a fresh
 *  array identity every time would re-render the whole Mannschaft grid for a list that did not
 *  change — the exact shape of the bug that once cost the phone its battery. `updated_at` moves
 *  whenever anything about a person does, so it is enough to compare alongside the ids. */
function sameRoster(a: Person[], b: Person[]): boolean {
  return a.length === b.length && a.every((p, i) => p.id === b[i].id && p.updatedAt === b[i].updatedAt)
}

/** How often a visible surface re-checks the roster. Long on purpose: nothing in the app can
 *  change it — only an admin running the Divera sync or editing somebody — so this exists to
 *  notice THAT, not to keep up with anything. Attendance is live already (see useIncidentSync). */
const BACKGROUND_MS = 5 * 60_000

// Loads the brigade roster (Mannschaft) and keeps it fresh in the BACKGROUND: on regaining
// network, on coming back to the foreground, and on a slow heartbeat while visible. There used
// to be an «Aktualisieren» button in the Anwesenheit header for this, which was misleading twice
// over — it suggested the ATTENDANCE needed refreshing (it never did; the workspace blob follows
// live) and it sat permanently in a header short of width for a list that changes maybe monthly.
// What is left of it is a retry, shown only when a fetch actually failed.
//
// Offline-tolerant: seeds from the local cache so it survives a restart / offline launch,
// keeps the last list on failure, and flags `error` so the Anwesenheit surface can show a
// stale/offline hint instead of an empty screen.
export function usePersonnel(enabled = true) {
  const [people, setPeople] = useState<Person[]>([])
  const [loading, setLoading] = useState(enabled)
  const [error, setError] = useState(false)
  const [loaded, setLoaded] = useState(false)

  // Seed from the cache (IndexedDB, async) so the roster appears on the first frames even with
  // no signal; the server fetch below then refreshes + re-caches it. Only seed while we don't
  // yet have a (fresher) server result, so a slow cache read can't clobber a fast fetch.
  useEffect(() => {
    let alive = true
    void readCachedRoster().then((cached) => {
      if (alive && cached.length) setPeople((cur) => (cur.length ? cur : cached))
    })
    return () => { alive = false }
  }, [])

  /** Take a fetched roster without disturbing anything that did not change. */
  const apply = useCallback((list: Person[]) => {
    setPeople((cur) => (sameRoster(cur, list) ? cur : list))
    cacheRoster(list)
  }, [])

  // explicit retry — the only path that may show a spinner and raise `error`
  const reload = useCallback(async () => {
    setLoading(true)
    setError(false)
    try {
      apply(await listPersonnel())
    } catch {
      setError(true)
    } finally {
      setLoading(false)
      setLoaded(true)
    }
  }, [apply])

  // The background refresh. Deliberately QUIET: no spinner, and a failure does NOT raise `error`
  // — we still hold a good list, and putting a retry button on the header because a poll missed
  // once would be the surface crying about something the operator cannot act on and does not
  // need to. Only the initial load and an explicit retry can say the roster is broken.
  useEffect(() => {
    if (!enabled) return
    let alive = true
    const refresh = () => {
      if (document.visibilityState !== 'visible') return
      listPersonnel().then((list) => { if (alive) apply(list) }).catch(() => {})
    }
    const onVisible = () => { if (document.visibilityState === 'visible') refresh() }
    // the heartbeat keeps ticking while hidden but `refresh` returns immediately, so a
    // backgrounded tab costs nothing and the first tick after it returns is the visibility one
    const timer = setInterval(refresh, BACKGROUND_MS)
    window.addEventListener('online', refresh)
    document.addEventListener('visibilitychange', onVisible)
    return () => {
      alive = false
      clearInterval(timer)
      window.removeEventListener('online', refresh)
      document.removeEventListener('visibilitychange', onVisible)
    }
  }, [enabled, apply])

  // initial load — state changes only inside the promise callbacks (no sync setState in effect)
  useEffect(() => {
    if (!enabled) return
    let alive = true
    initialRoster()
      .then((list) => { if (alive) { apply(list); setError(false) } })
      .catch(() => { if (alive) setError(true) })
      .finally(() => { if (alive) { setLoading(false); setLoaded(true) } })
    return () => { alive = false }
  }, [enabled, apply])

  return { people, loading, error, loaded, reload }
}
