// The tutorial catalogue («Üben», 05.11.2026): WHICH tutorials exist, for whom, on what surface,
// and what each needs to run. Steps and their done-predicates live in ./steps (the runner's),
// the words in appConfig.copy.tutorials — this file is the index both the «Üben» sheet and the
// runner read, so it carries no React and no copy.
//
// Numbering T0–T14 is the plan's (docs/planning/tutorials-2026-11-05.md §4); the ids are slugs
// because a number says nothing in a progress store or a copy key.

/** one tutorial, by slug (T-number of the plan in the comment) */
export type TutorialId =
  | 'zurechtfinden'      // T0  Karte home, no Übung
  | 'einsatzEroeffnen'   // T1  the intake – creates the Lern-Übung itself
  | 'lageZeichnen'       // T2  Karte – die Lage zeichnen
  | 'planGebaeude'       // T3
  | 'tafel'              // T4
  | 'checkliste'         // T5  Checkliste im Einsatz
  | 'trupps'             // T6
  | 'notfall'            // T7  Atemschutznotfall
  | 'anwesenheit'        // T8  Anwesenheit & Zeitplan
  | 'material'           // T9
  | 'verlauf'            // T10
  | 'rapport'            // T11 Rapport & Abschluss – ends with the delete/keep card
  | 'nachschlagen'       // T12 Checkliste & Anleitungen on the Karte home, no Übung
  | 'wiedergabe'         // T13 Wiedergabe, Offline, zweites Gerät
  | 'objektbesuch'       // T14 only when the Objektbesuche module is on

/** the tracks of the «Üben» sheet (owner, 05.11.2026: tracks by function + the full list) */
export type Track = 'fu' | 'el' | 'as' | 'alle'

/** where a tutorial runs: the Karte home outside an Einsatz, inside an Einsatz, the Objektbesuche */
export type TutorialSurface = 'karte' | 'einsatz' | 'visit'

/** what a tutorial needs before its first step: nothing, a seeded «Lernen · <Modul>» Übung
 *  (POST /api/incidents/lernen, lib/tutorials/sandbox), or – T1 only – the Übung the learner
 *  creates through the intake as the lesson itself */
export type Sandbox = 'none' | 'uebung' | 'uebung-self'

export interface TutorialMeta {
  id: TutorialId
  tracks: readonly Track[]
  surface: TutorialSurface
  sandbox: Sandbox
  /** a rough reading of how long it takes; shown on the rows */
  minutes: number
  /** listed only when this deployment has the module (objectVisits.enabled) */
  optional?: 'objectVisits'
}

/** the plan's order = the FU track's order */
export const TUTORIALS: readonly TutorialMeta[] = [
  { id: 'zurechtfinden', tracks: ['alle'], surface: 'karte', sandbox: 'none', minutes: 4 },
  { id: 'einsatzEroeffnen', tracks: ['fu', 'el'], surface: 'karte', sandbox: 'uebung-self', minutes: 3 },
  { id: 'lageZeichnen', tracks: ['fu', 'el'], surface: 'einsatz', sandbox: 'uebung', minutes: 5 },
  { id: 'planGebaeude', tracks: ['fu'], surface: 'einsatz', sandbox: 'uebung', minutes: 5 },
  { id: 'tafel', tracks: ['fu'], surface: 'einsatz', sandbox: 'uebung', minutes: 4 },
  { id: 'checkliste', tracks: ['fu'], surface: 'einsatz', sandbox: 'uebung', minutes: 3 },
  { id: 'trupps', tracks: ['fu', 'as'], surface: 'einsatz', sandbox: 'uebung', minutes: 6 },
  { id: 'notfall', tracks: ['fu', 'as'], surface: 'einsatz', sandbox: 'uebung', minutes: 4 },
  { id: 'anwesenheit', tracks: ['fu', 'el'], surface: 'einsatz', sandbox: 'uebung', minutes: 5 },
  { id: 'material', tracks: ['fu', 'el'], surface: 'einsatz', sandbox: 'uebung', minutes: 3 },
  { id: 'verlauf', tracks: ['fu', 'el'], surface: 'einsatz', sandbox: 'uebung', minutes: 5 },
  { id: 'rapport', tracks: ['fu', 'el'], surface: 'einsatz', sandbox: 'uebung', minutes: 6 },
  { id: 'nachschlagen', tracks: ['alle'], surface: 'karte', sandbox: 'none', minutes: 3 },
  { id: 'wiedergabe', tracks: ['fu'], surface: 'einsatz', sandbox: 'uebung', minutes: 4 },
  { id: 'objektbesuch', tracks: ['alle'], surface: 'visit', sandbox: 'none', minutes: 4, optional: 'objectVisits' },
] as const

export const TRACKS: readonly Track[] = ['fu', 'el', 'as', 'alle']

export const tutorialMeta = (id: TutorialId): TutorialMeta => {
  const m = TUTORIALS.find((t) => t.id === id)
  if (!m) throw new Error(`unknown tutorial ${id}`)
  return m
}

/** the tutorials of one track, in the plan's order (the FU track is the whole Einsatz set) */
export const tutorialsOf = (track: Track): TutorialMeta[] => TUTORIALS.filter((t) => t.tracks.includes(track))
