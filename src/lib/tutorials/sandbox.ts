// The «Lernen · <Modul>» Übung a tutorial runs on («Üben», 05.11.2026): the client side of
// POST /api/incidents/lernen (create or reuse + rename, seeded server-side), the rename when the
// learner goes on to the next tutorial on the done card, and the delete the done card offers.
//
// Round-1 skeleton (lead, 05.11.2026): signatures only – the SANDBOX builder implements them
// against the backend door; the runner (CORE) and the done card call them.
//
// Owner picks (05.11.2026): an `el` may open a Lern-Übung (Übung-since-creation only, may delete
// that one); «Weiter mit …» reuses the SAME Übung renamed; the done card deletes by default,
// «Behalten» beside it.

import type { TutorialId } from './catalogue'

export interface LernUebung {
  incidentId: string
  /** an open «Lernen ·» Übung was reused (and renamed) instead of minting a new one */
  reused: boolean
}

/** create – or reuse and rename – the Lern-Übung for `tutorial`; opens nothing by itself */
export async function openLernUebung(_tutorial: TutorialId): Promise<LernUebung> {
  throw new Error('tutorials/sandbox: not implemented (Round 1 · SANDBOX)')
}

/** the learner goes on to the next tutorial: the same Übung, new title */
export async function renameLernUebung(_incidentId: string, _tutorial: TutorialId): Promise<void> {
  throw new Error('tutorials/sandbox: not implemented (Round 1 · SANDBOX)')
}

/** «Übung löschen» on the done card – hard delete, allowed because it was born as Übung */
export async function deleteLernUebung(_incidentId: string): Promise<void> {
  throw new Error('tutorials/sandbox: not implemented (Round 1 · SANDBOX)')
}
