// Whose unsent work is waiting on this device (sweep 09.11.2026, UX.2 — owner pick «5B»).
//
// On a shared tablet a session ends (expiry, sign-out) and whoever holds the tablet next taps
// their own face: the first person's unsent Karte/Tafel edits and Verlauf rows stay parked under
// that person's key and go out only when THAT account signs in here again. Nothing said so. This
// module answers the two questions the screens ask — which accounts have work waiting (the login
// screen's banner) and what an account id is called (the banner, the Meldeleiste row) — from what
// the device already holds. ⚠️ It reports who and when, never what: no edit is read out, moved or
// deleted here, and the httpOnly known-device cookie is not something a page can read.

import type { RosterEntry } from './auth'
import { idbGet, idbSet } from './idb'
import { unsentWorkspaces } from './api/workspaceSync'
import { unsentJournals } from './journalSlots'

/** The roster as the login screen last received it, so a name can be put to an account id while
 *  signed in (the roster is fetched on the login screen only) or without a connection. Names,
 *  roles and tile colours — what `/api/auth/roster` hands to anybody anyway. */
// ⚠️ not `kp-front-roster`: that slot is the Mannschaft's (lib/usePersonnel)
const ROSTER_CACHE = 'kp-front-login-roster'

/** Keep the roster the login screen just loaded. */
export function cacheRoster(roster: readonly RosterEntry[]): void {
  void idbSet(ROSTER_CACHE, roster)
}

/** The roster this device last saw, or `[]` when it never saw one. */
export async function readCachedRoster(): Promise<RosterEntry[]> {
  return (await idbGet<RosterEntry[]>(ROSTER_CACHE)) ?? []
}

/** An account with unsent work on this device, and when its newest waiting edit was made. */
export interface UnsentAccount { id: string; at: number }

/** Fold the per-Einsatz findings into one entry per account, most recent first. */
export function byAccount(found: ReadonlyArray<{ owner: string; at: number }>): UnsentAccount[] {
  const newest = new Map<string, number>()
  for (const f of found) newest.set(f.owner, Math.max(newest.get(f.owner) ?? 0, f.at))
  return [...newest].map(([id, at]) => ({ id, at })).sort((a, b) => b.at - a.at)
}

/** Every account whose unsent workspace edits or Verlauf rows this device holds, most recent first. */
export async function unsentAccounts(): Promise<UnsentAccount[]> {
  const [workspaces, journals] = await Promise.all([unsentWorkspaces(), unsentJournals()])
  return byAccount([
    ...workspaces.map((w) => ({ owner: w.owner, at: w.editedAt })),
    ...journals.map((j) => ({ owner: j.owner, at: j.at })),
  ])
}

/** One line of the login banner: an account still on the roster (`entry`, so it can be signed in
 *  from the line), or `null` for work of accounts the roster no longer lists. */
export interface UnsentLine { key: string; entry: RosterEntry | null }

/** How many lines the login banner shows before «und {n} weitere». */
export const UNSENT_LINES_MAX = 3

/**
 * The login banner's lines: one per account, most recent first, at most `max`, and how many
 * accounts are left over. Accounts gone from the roster share ONE line («einem früheren Konto») at
 * the place of the most recent of them — three nameless lines would say the same thing thrice.
 */
export function unsentLines(
  accounts: readonly UnsentAccount[], roster: readonly RosterEntry[], max = UNSENT_LINES_MAX,
): { lines: UnsentLine[]; more: number } {
  const all: UnsentLine[] = []
  for (const a of accounts) {
    const entry = roster.find((r) => r.id === a.id) ?? null
    if (entry) all.push({ key: entry.id, entry })
    else if (!all.some((l) => !l.entry)) all.push({ key: 'former', entry: null })
  }
  return { lines: all.slice(0, max), more: Math.max(0, all.length - max) }
}
