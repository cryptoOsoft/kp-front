// Where a Verlauf store keeps its rows in IndexedDB, and the one question that can be asked of
// those slots without a store: whose outbox still holds rows. Apart from lib/journalStore so the
// login screen can ask it without the store (and everything the store imports) in the entry chunk.

import { idbKeys, idbRead } from './idb'

/** The pre-22.10.2026 slot, shared by every identity. A device LOGIN adopts it once (see
 *  `JournalOwner.adoptsLegacy`) — on a shared device the login is who wrote those rows; a link
 *  page never reads it. */
export const legacyJournalSlot = (incidentId: string) => `kp-journal-${incidentId}`

/** The outbox slot of one identity on one Einsatz (RBAC audit S5, 22.10.2026) — like the audit
 *  store's (`kp-audit-<incident>:<owner>`). One slot per Einsatz used to be shared by every
 *  identity on the device: an Atemschutz-Link opened on the FU's own phone hydrated the FU's
 *  unsent rows and sent them as the link — a Meldung was the link's 403 (and the page froze as
 *  «Link widerrufen»), a Trupp row went in stamped `via: atemschutz-link`. */
export const journalSlot = (incidentId: string, owner: string | null) =>
  (owner ? `kp-journal-${incidentId}:${owner}` : legacyJournalSlot(incidentId))

/** One login's unsent Verlauf rows for one Einsatz on this device. */
export interface UnsentJournal {
  /** AuthUser.id of the login whose outbox it is */
  owner: string
  incidentId: string
  /** the newest waiting row's `at` in ms; 0 when none carries a readable one */
  at: number
}

/**
 * Every device LOGIN's outbox that still holds rows, read straight off the persisted slots — for
 * the login screen, which must say whose work is waiting on this device (sweep 09.11.2026, UX.2;
 * the workspace half is `workspaceSync · unsentWorkspaces`). Who and when, never the rows. A link
 * page's slot and the shared pre-owner slot name no account and are not listed; rejected and
 * refused rows are not either (no sign-in sends them). An unreadable store lists nothing.
 */
export async function unsentJournals(): Promise<UnsentJournal[]> {
  const prefix = legacyJournalSlot('')
  const keys = await idbKeys(prefix)
  if (!keys.ok) return []
  const found = await Promise.all((keys.value ?? []).map(async (key): Promise<UnsentJournal | null> => {
    // `<incident>:<user id>:<link kind | login>` (IncidentWorkspace · the journal's owner key)
    const [incidentId, owner, kind, ...rest] = key.slice(prefix.length).split(':')
    if (!incidentId || !owner || kind !== 'login' || rest.length) return null
    const read = await idbRead<{ outbox?: { at?: string }[] }>(key)
    const outbox = read.ok ? (read.value?.outbox ?? []) : []
    if (!outbox.length) return null
    const at = Math.max(0, ...outbox.map((r) => Date.parse(r.at ?? '')).filter(Number.isFinite))
    return { owner, incidentId, at }
  }))
  return found.filter((u) => u !== null)
}
