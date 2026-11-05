// The «Lernen · <Modul>» Übung a tutorial runs on («Üben», 05.11.2026): the client side of
// POST /api/incidents/lernen (create or reuse + rename, seeded server-side), the rename when the
// learner goes on to the next tutorial on the done card, and the delete the done card offers.
// The runner (CORE) and the done card call these three; nothing here opens or switches incidents.
//
// Owner picks (05.11.2026): an `el` may open a Lern-Übung (Übung-since-creation only, may delete
// that one); «Weiter mit …» reuses the SAME Übung renamed; the done card deletes by default,
// «Behalten» beside it. The server holds the rest (docs/roles-and-access.md · «Üben»): who may,
// the seed, the reuse. Every call throws the api's `ApiError` on a refusal – `openLernUebung` a
// 403 in the demo, where the runner goes on without a sandbox.

import { apiPost } from '../api'
import { deleteIncident, patchIncident } from '../api/incidents'
import type { Fits, In, Out } from '../api/wire'
import { tutorialsCopy } from '../../config/copy/de/tutorials'
import { tutorialMeta, type TutorialId } from './catalogue'

export interface LernUebung {
  incidentId: string
  /** an open «Lernen ·» Übung was reused (and renamed) instead of minting a new one */
  reused: boolean
}

/** the tutorials the door seeds an Übung for – the server's list, `sandbox: 'uebung'` here */
type LernTutorial = In<'LernUebungIn'>['tutorial']
type _LernIsTutorial = Fits<LernTutorial, TutorialId>

// the backend test pins its Literal to the catalogue's `uebung` rows, so the check is the type
const isLernTutorial = (id: TutorialId): id is LernTutorial => tutorialMeta(id).sandbox === 'uebung'

function lernTutorial(id: TutorialId): LernTutorial {
  if (!isLernTutorial(id)) throw new Error(`tutorials/sandbox: ${id} runs without a Lern-Übung`)
  return id
}

/** The record's title, German like the one the server gives a new Lern-Übung (tutorial_seed ·
 *  lern_title) – the Einsatz title is the record's, not the device's language. */
const lernTitle = (id: LernTutorial): string => `Lernen · ${tutorialsCopy.tutorials.titles[id]}`

/** create – or reuse and rename – the Lern-Übung for `tutorial`; opens nothing by itself */
export async function openLernUebung(tutorial: TutorialId): Promise<LernUebung> {
  const body: In<'LernUebungIn'> = { tutorial: lernTutorial(tutorial) }
  const r = await apiPost<Out<'LernUebungOut'>>('/api/incidents/lernen', body)
  return { incidentId: r.id, reused: r.reused }
}

/** the learner goes on to the next tutorial: the same Übung, new title (an el may: EL_META_FIELDS) */
export async function renameLernUebung(incidentId: string, tutorial: TutorialId): Promise<void> {
  await patchIncident(incidentId, { title: lernTitle(lernTutorial(tutorial)) })
}

/** «Übung löschen» on the done card – hard delete, allowed because it was born as Übung */
export async function deleteLernUebung(incidentId: string): Promise<void> {
  await deleteIncident(incidentId)
}
