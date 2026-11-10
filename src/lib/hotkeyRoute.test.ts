import { describe, expect, it } from 'vitest'
import { routeEscape, routeHotkey, type EscapeAction, type EscapeState, type HotkeyState } from './hotkeyRoute'
import type { HotkeyCommand } from './hotkeys'

// The keyboard's routing table (23.09.2026): which action a decoded shortcut becomes on which
// surface, and — the half that is easy to get wrong — whether the key is CLAIMED. Some keys are
// claimed only where they act; others are claimed even when they end in nothing.
const base: HotkeyState = {
  modalOpen: false, mode: 'map', georefPlanId: null, moduleTargetId: (n) => (n === 2 ? 'm2' : undefined),
  tacticalLocked: false, replayActive: false, readOnly: false, linkScoped: false,
}
const at = (over: Partial<HotkeyState>) => ({ ...base, ...over })
const route = (cmd: HotkeyCommand | null, over: Partial<HotkeyState> = {}) => routeHotkey(cmd, at(over))

describe('routeHotkey', () => {
  it('stays out of the way of a modal and of a key that is no shortcut', () => {
    expect(route({ type: 'undo' }, { modalOpen: true })).toEqual({ action: { type: 'none' }, prevent: false })
    expect(route(null)).toEqual({ action: { type: 'none' }, prevent: false })
  })

  it('surface keys switch — and clear the map chrome only when the surface changes', () => {
    expect(route({ type: 'surface', surface: 'checklists' })).toEqual({ action: { type: 'surface', surface: 'checklists', clear: true }, prevent: true })
    expect(route({ type: 'surface', surface: 'map' })).toEqual({ action: { type: 'surface', surface: 'map', clear: false }, prevent: true })
  })

  it('a digit and 0 are claimed wherever they are pressed', () => {
    expect(route({ type: 'module', n: 7 })).toEqual({ action: { type: 'module', n: 7 }, prevent: true })
    expect(route({ type: 'fit' }).action).toEqual({ type: 'centerMap' })
    expect(route({ type: 'fit' }, { mode: 'plans' }).action).toEqual({ type: 'fitPlan' })
    expect(route({ type: 'fit' }, { mode: 'checklists' })).toEqual({ action: { type: 'none' }, prevent: true })
  })

  it('⌘Z / ⇧⌘Z reach the one timeline from every surface', () => {
    for (const mode of ['map', 'plans', 'rapport'] as const) {
      expect(route({ type: 'undo' }, { mode })).toEqual({ action: { type: 'undo' }, prevent: true })
      expect(route({ type: 'redo' }, { mode })).toEqual({ action: { type: 'redo' }, prevent: true })
    }
  })

  it('⌘D is each drawing surface’s own duplicate, and unclaimed anywhere else', () => {
    expect(route({ type: 'duplicate' }).action).toEqual({ type: 'duplicateMap' })
    expect(route({ type: 'duplicate' }, { mode: 'plans' }).action).toEqual({ type: 'duplicatePlan' })
    expect(route({ type: 'duplicate' }, { mode: 'atemschutz' }).prevent).toBe(false)
  })

  it('a tool key reaches the drawing surface — a locked one keeps only its read-only tools', () => {
    expect(route({ type: 'tool', tool: 'line' }).action).toEqual({ type: 'toolMap', tool: 'line' })
    expect(route({ type: 'tool', tool: 'line' }, { mode: 'plans' }).action).toEqual({ type: 'toolPlan', tool: 'line' })
    expect(route({ type: 'tool', tool: 'line' }, { tacticalLocked: true }).prevent).toBe(false)
    expect(route({ type: 'tool', tool: 'measure' }, { tacticalLocked: true }).action).toEqual({ type: 'toolMap', tool: 'measure' })
    expect(route({ type: 'tool', tool: 'select' }, { replayActive: true }).prevent).toBe(false)
    expect(route({ type: 'tool', tool: 'line' }, { mode: 'rapport' }).prevent).toBe(false)
  })

  it('panels: the composer and settings respect the session, Ebenen is the Karte’s', () => {
    expect(route({ type: 'panel', panel: 'journal' }, { mode: 'rapport' }).action).toEqual({ type: 'journal' })
    expect(route({ type: 'panel', panel: 'composer' }, { readOnly: true }).prevent).toBe(false)
    expect(route({ type: 'panel', panel: 'composer' }, { linkScoped: true }).prevent).toBe(false)
    expect(route({ type: 'panel', panel: 'composer' }).action).toEqual({ type: 'composer' })
    expect(route({ type: 'panel', panel: 'layers' }, { mode: 'plans' }).prevent).toBe(false)
    expect(route({ type: 'panel', panel: 'settings' }, { linkScoped: true }).prevent).toBe(false)
    expect(route({ type: 'panel', panel: 'help' }, { linkScoped: true }).action).toEqual({ type: 'help' })
  })

  it('view keys: zoom goes to the Plan on a plan and to the Karte everywhere else; G / X only on the Karte', () => {
    expect(route({ type: 'view', view: 'zoomIn' }, { mode: 'plans' }).action).toEqual({ type: 'zoomPlan', factor: 1.3 })
    expect(route({ type: 'view', view: 'zoomOut' }, { mode: 'plans' }).action).toEqual({ type: 'zoomPlan', factor: 1 / 1.3 })
    expect(route({ type: 'view', view: 'zoomIn' }, { mode: 'rapport' }).action).toEqual({ type: 'zoomMap', dir: 'in' })
    expect(route({ type: 'view', view: 'locate' }).action).toEqual({ type: 'locate' })
    expect(route({ type: 'view', view: 'coord' }, { mode: 'plans' }).prevent).toBe(false)
  })

  it('an alignment session swallows navigation — only its own Karte/Modul pair is reachable', () => {
    const g = { georefPlanId: 'm2' }
    expect(route({ type: 'nav', dir: 1 }, g)).toEqual({ action: { type: 'none' }, prevent: true })
    expect(route({ type: 'surface', surface: 'rapport' }, g)).toEqual({ action: { type: 'none' }, prevent: true })
    expect(route({ type: 'surface', surface: 'map' }, g)).toEqual({ action: { type: 'georef', go: 'goMap' }, prevent: true })
    expect(route({ type: 'module', n: 2 }, g)).toEqual({ action: { type: 'georef', go: 'goPlan' }, prevent: true })
    expect(route({ type: 'module', n: 3 }, g)).toEqual({ action: { type: 'none' }, prevent: true })
    // …and everything that is not navigation still works inside it
    expect(route({ type: 'undo' }, g).action).toEqual({ type: 'undo' })
  })
})

// Escape peels ONE layer per press, in a fixed order — pressing it on a Karte with everything open
// walks back to the plain map one step at a time, and a plain map ignores it.
describe('routeEscape', () => {
  const closes: Record<Exclude<EscapeAction, 'none'>, keyof EscapeState> = {
    cancelPlacement: 'placing', coordOff: 'coordOn', closeChrome: 'chromeOpen',
    disarmTool: 'toolArmed', closeNotePanel: 'notePanelOpen', clearSelection: 'selected',
  }

  it('walks back from everything open to the plain map, one layer per press', () => {
    let s: EscapeState = { placing: true, coordOn: true, chromeOpen: true, toolArmed: true, notePanelOpen: true, selected: true }
    const presses: EscapeAction[] = []
    for (let a = routeEscape(s); a !== 'none'; a = routeEscape(s)) {
      presses.push(a)
      s = { ...s, [closes[a]]: false }
    }
    expect(presses).toEqual(['cancelPlacement', 'coordOff', 'closeChrome', 'disarmTool', 'closeNotePanel', 'clearSelection'])
  })
})
