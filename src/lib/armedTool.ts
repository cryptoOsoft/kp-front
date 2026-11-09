// The armed tool's NAME – what the bottom-centre readout pill (components/ArmedToolPill) says
// while a tool is armed on the Karte, a Plan or the Tafel. Pure: the tool id, its input mode and
// the surface's tool list in, one short word out («Linie · Freihand», «Absperrkreis») – never a
// sentence, never a button (owner 23.10.2026: «a small little info thing at the bottom that now
// you're placing symbol XYZ and that's it»). A symbol's name is the symbol's own
// (format · formatSymbolName); this only covers the rail's tools.
import { appConfig } from '../config/appConfig'
import type { BoardTool, MapTool } from '../types'

/** the input mode of the two tools that have one (Linie, Fläche): drag, or tap the corners */
export type DrawMode = 'freehand' | 'nodes'

export interface ArmedToolModes {
  lineMode?: DrawMode
  areaMode?: DrawMode
}

type ToolEntry = { id: string; icon: string; label: string; alt?: { id: string; icon: string; label: string } }

/** the tool's rail entry – its own, or the tile whose second state it is (Mehrfach on Auswahl) */
const entryFor = (tool: MapTool | BoardTool, tools: readonly ToolEntry[]) => {
  for (const t of tools) {
    if (t.alt?.id === tool) return t.alt
    if (t.id === tool) return t
  }
  return null
}

const modeWord = (mode: DrawMode): string =>
  mode === 'nodes' ? appConfig.copy.drawingEditor.modeNodes : appConfig.copy.drawingEditor.modeFreehand

/**
 * The pill's word for `tool`, read from the surface's tool list (`mapTools` on the Karte,
 * `planTools` on a Plan) – so the pill always says what the rail tile says, in the deployment's
 * language. Auswahl (the rest state) and an unknown id answer null: nothing is armed, no pill.
 */
export function armedToolName(tool: MapTool | BoardTool, tools: readonly ToolEntry[], modes: ArmedToolModes = {}): string | null {
  const t = entryFor(tool, tools)
  if (!t) return null
  if (tool === 'line' && modes.lineMode) return `${t.label} · ${modeWord(modes.lineMode)}`
  if (tool === 'area' && modes.areaMode) return `${t.label} · ${modeWord(modes.areaMode)}`
  return t.label
}

/** the pill's glyph for `tool`: the rail tile's icon id (lib/icons) */
export function armedToolIcon(tool: MapTool | BoardTool, tools: readonly ToolEntry[]): string | null {
  return entryFor(tool, tools)?.icon ?? null
}
