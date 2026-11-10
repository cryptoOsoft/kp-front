import { useEffect, useState } from 'react'
import { appConfig } from '../config/appConfig'
import type { RosterEntry } from '../lib/auth'
import { fillTemplate } from '../lib/format'
import type { WorkspaceSync } from '../lib/incidents'
import { readCachedRoster, unsentLines, type UnsentLine } from '../lib/unsentAccounts'
import { useMeldung } from '../lib/useMeldung'

// «Nicht übertragene Änderungen von {Name} auf diesem Gerät – {Name} muss sich hier anmelden»
// (sweep 09.11.2026, UX.2 — owner pick «5B»). This Einsatz was opened by one account while unsent
// edits of ANOTHER account for it are parked on the device (api/workspaceSync · ownerCacheKey): the
// picture on screen is the server's, without them, and until now nothing said that they exist.
//
// ⚠️ The row informs and nothing else. It never shows, sends, moves or deletes the parked edits —
// they go out when their owner signs in here — and it blocks nothing: the ✕ puts it away for this
// account on this Einsatz until the app is loaded again. One row per account; accounts the roster
// no longer lists share one («einem früheren Konto»).

/** Rows waved away since the page loaded: `<viewer>:<incident>:<line>`. In memory on purpose — a
 *  reload, or another account signing in, is told again. */
const dismissed = new Set<string>()

export function ForeignUnsentMeldungen({ sync, incidentId, viewerId }: {
  sync: WorkspaceSync
  incidentId: string
  /** the signed-in account, part of the ✕'s memory; null (no settled account) shows nothing */
  viewerId: string | null
}) {
  const [owners, setOwners] = useState<string[]>([])
  useEffect(() => sync.subscribeForeignParked(setOwners), [sync])
  // names from the roster the login screen last received — the app fetches none while signed in
  const [roster, setRoster] = useState<RosterEntry[] | null>(null)
  useEffect(() => {
    let alive = true
    void readCachedRoster().then((r) => { if (alive) setRoster(r) })
    return () => { alive = false }
  }, [])
  const [, repaint] = useState(0)
  if (!viewerId || !roster) return null
  const { lines } = unsentLines(owners.map((id) => ({ id, at: 0 })), roster, owners.length)
  return lines.map((line) => {
    const key = `${viewerId}:${incidentId}:${line.key}`
    return dismissed.has(key) ? null : (
      <ForeignUnsentMeldung key={line.key} line={line} onDismiss={() => { dismissed.add(key); repaint((n) => n + 1) }} />
    )
  })
}

/** One account's row. */
function ForeignUnsentMeldung({ line, onDismiss }: { line: UnsentLine; onDismiss: () => void }) {
  // read per-render (not module-load) so the resolved locale is applied — see config/copy
  const C = appConfig.copy.session
  const name = line.entry?.display_name
  useMeldung({
    id: `foreign-unsent:${line.key}`,
    kind: 'session',
    tone: 'warn',
    icon: 'warn',
    title: fillTemplate(C.foreignUnsentTitle, { name: name ?? appConfig.copy.login.unsentFormer }),
    sub: name ? fillTemplate(C.foreignUnsentSub, { name }) : C.foreignUnsentFormerSub,
    // the whole sentence is the message, and the name sits at its end
    wrap: true,
    dismiss: { label: C.foreignUnsentDismiss, onClick: onDismiss },
  })
  return null
}
