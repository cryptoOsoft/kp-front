// Which tutorials this session is offered, and how the «Üben» sheet and the Hilfe's
// «Ausprobieren» read them (ENTRY, 05.11.2026): the offer per session, the Hilfe section map,
// the sheet's filter chips, a row's state, and the one way both doors start a tutorial. Pure but
// for `startOrResume`, which hands over to the session store (./session); the UI is
// components/tutorial/UebenSheet and components/HelpOverlay.

import type { AuthUser } from '../auth'
import { objectVisitsConfig } from '../deploymentConfig'
import { TUTORIALS, type TutorialId, type TutorialMeta } from './catalogue'
import { isDone, loadProgress, resumeStep, type ProgressMap } from './progress'
import { getTutorialSession, startTutorial, type TutorialSession } from './session'

/** Who may practise what (plan §5 · Guards): a link session nothing; a viewer only what needs no
 *  Lern-Übung (the door creates an Einsatz – editor and el only); an optional tutorial only where
 *  this deployment has its module. Catalogue order. */
export function offeredTutorials(
  session: { role: AuthUser['role'] | undefined; linkScoped: boolean },
  modules: Record<NonNullable<TutorialMeta['optional']>, boolean> = { objectVisits: objectVisitsConfig().enabled },
): TutorialMeta[] {
  if (session.linkScoped) return []
  const mayOpenUebung = session.role === 'editor' || session.role === 'el'
  return TUTORIALS.filter((t) => (!t.optional || modules[t.optional]) && (mayOpenUebung || t.sandbox === 'none'))
}

/** The Hilfe section → the tutorials that practise it (owner pick H = A: a button per tutorial
 *  under the section title). A section not listed gets no button. */
const HELP_TUTORIALS: Partial<Record<string, readonly TutorialId[]>> = {
  navigation: ['zurechtfinden'],
  lage: ['lageZeichnen'],
  zeichnen: ['lageZeichnen'],
  plan: ['planGebaeude'],
  atemschutz: ['trupps', 'notfall'],
  anwesenheit: ['anwesenheit'],
  mittel: ['material'],
  zeitplan: ['anwesenheit'],
  checkliste: ['checkliste'],
  verlauf: ['verlauf'],
  rapport: ['rapport'],
  einsatz: ['einsatzEroeffnen'],
  sync: ['wiedergabe'],
}

/** the offered tutorials for one Hilfe section, in the section's order */
export const helpTutorials = (sectionId: string, offered: readonly TutorialMeta[]): TutorialMeta[] =>
  (HELP_TUTORIALS[sectionId] ?? []).flatMap((id) => offered.filter((t) => t.id === id))

/** the sheet's chips, in their order: «Alle», then one per function */
export const FILTERS = ['all', 'fu', 'el', 'as'] as const
export type UebenFilter = (typeof FILTERS)[number]

/** «Alle» is every offered tutorial; a function chip is exactly that track (so FU narrows to the
 *  Einsatz set and the «für alle» ones stand under «Alle» only) */
export const filterTutorials = (list: readonly TutorialMeta[], f: UebenFilter): TutorialMeta[] =>
  f === 'all' ? [...list] : list.filter((t) => t.tracks.includes(f))

/** What a row says about this device's runs: ✓ and where a run stands (0-based) – the one running
 *  now wins over the stored resume point. */
export function rowState(id: TutorialId, progress: ProgressMap, session: TutorialSession | null): {
  done: boolean
  resume: { step: number; running: boolean } | null
} {
  const running = session?.id === id
  const step = running ? session.step : resumeStep(progress, id)
  return { done: isDone(progress, id), resume: step == null ? null : { step, running } }
}

/** start a tutorial from a sheet row or a Hilfe button – one rule for both doors: where its run
 *  stands (`rowState`), else step 0 */
export function startOrResume(id: TutorialId): void {
  startTutorial(id, { step: rowState(id, loadProgress(), getTutorialSession()).resume?.step })
}
