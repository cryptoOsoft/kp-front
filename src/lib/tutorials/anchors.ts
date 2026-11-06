// The controls a tutorial step points at («Üben», 05.11.2026). A surface spreads `tut(id)` onto
// the control – `<button {...tut('tool.line')}>` – and the runner finds it by `[data-tut="…"]`
// to hang the Sprechblase on it. Product, not test: the e2e's `data-testid`s stay theirs, and a
// control that moves keeps its anchor because the anchor travels with the JSX.
//
// ⚠️ Drift catcher: `IncidentWorkspace.harness.tutorial.test.tsx` mounts the workspace and asserts
// every anchor a step names is in the DOM of its surface. Rename one here and tsc finds the
// spreads; move a control off its surface and that test goes red.

/** the tool ids of the Karte's rail (copy.mapTools) and the Plan's spellings of the same tools */
type ToolId = 'select' | 'lasso' | 'symbol' | 'line' | 'area' | 'circle' | 'note' | 'team' | 'measure' | 'text' | 'resource' | 'pan'
/** the rail's surfaces (workspace/types · WorkspaceMode) plus the phone's folded «Pläne» tile */
type RailId = 'map' | 'plans' | 'checklists' | 'atemschutz' | 'anwesenheit' | 'mittel' | 'rapport'

export type TutAnchor =
  /** the NavRail's tiles – the vertical rail on a tablet, the phone's bottom nav bar */
  | `rail.${RailId}`
  /** a ToolRail tool (tablet rail; on the phone bar only Auswahl · Messen keep a tile) */
  | `tool.${ToolId}`
  /** the rail's «Symbol» slot – «+ Hinzufügen» on the phone bar, the one door to the sheet */
  | 'tool.add'
  /** an entry of the «+ Hinzufügen» sheet's tool section (phone only, lib/toolFold · ADD_TOOLS) */
  | `add.${ToolId}`
  /** the sheet's search field */
  | 'add.search'
  /** the top bar's ↶ ↷ and its Verlauf door */
  | 'top.undo' | 'top.redo' | 'top.verlauf'
  /** the Einsatz menu (the incident title's chevron) – Einstellungen, Hilfe, Üben live in it */
  | 'menu.einsatz'
  /** «+ Trupp anmelden» in the Trupps head */
  | 'trupps.new'
  /** the phone's Eintrag FAB and the Verlauf composer's text field */
  | 'fab.entry' | 'verlauf.composer'

/** the attribute a control carries; spread it: `<button {...tut('tool.line')}>` */
export const tut = (id: TutAnchor): { 'data-tut': TutAnchor } => ({ 'data-tut': id })

/** a rail tool's or a «+» sheet entry's anchor from the tool's runtime id (`tool.line`,
 *  `add.circle`) – the tool lists are copy, so their ids are strings; the steps name them through
 *  the `TutAnchor` union and the harness test checks the two meet */
export const toolAnchor = (where: 'tool' | 'add', id: string): { 'data-tut': string } => ({ 'data-tut': `${where}.${id}` })

/** the DOM node an anchor names right now, or null when it is not on screen */
export function findAnchor(id: TutAnchor, root: ParentNode = document): HTMLElement | null {
  return root.querySelector<HTMLElement>(`[data-tut="${id}"]`)
}
