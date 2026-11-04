import { describe, it, expect } from 'vitest'
import { resolveHotkey, isTypingTarget, railToolKey, SURFACE_KEY, TOOL_KEY, type HotkeyCommand, type SurfaceCmd, type ToolCmd } from './hotkeys'

// minimal KeyboardEvent stand-in — resolveHotkey only reads these five fields
const ev = (key: string, mod: Partial<KeyboardEvent> = {}): KeyboardEvent =>
  ({ key, metaKey: false, ctrlKey: false, shiftKey: false, altKey: false, ...mod }) as KeyboardEvent

const resolve = (key: string, mod?: Partial<KeyboardEvent>): HotkeyCommand | null => resolveHotkey(ev(key, mod))

describe('resolveHotkey — modules & fit (numbers address the plan modules)', () => {
  it('digits 1..9 map to the module with that number', () => {
    for (let n = 1; n <= 9; n++) expect(resolve(String(n))).toEqual({ type: 'module', n })
  })
  it('0 is einpassen/fit, not a module', () => {
    expect(resolve('0')).toEqual({ type: 'fit' })
  })
})

describe('resolveHotkey — non-module surfaces carry their own letter', () => {
  it('K/C/A/P/M/R select the fixed surfaces — the German first letter of each', () => {
    expect(resolve('k')).toEqual({ type: 'surface', surface: 'map' })
    expect(resolve('c')).toEqual({ type: 'surface', surface: 'checklists' })
    expect(resolve('a')).toEqual({ type: 'surface', surface: 'atemschutz' })
    expect(resolve('p')).toEqual({ type: 'surface', surface: 'anwesenheit' })
    expect(resolve('m')).toEqual({ type: 'surface', surface: 'mittel' })
    expect(resolve('r')).toEqual({ type: 'surface', surface: 'rapport' })
  })
  // the rail prints SURFACE_KEY on the button and the keyboard has to agree with it — a badge
  // that says R over a key that does something else is worse than no badge at all
  it('every badge in SURFACE_KEY resolves to exactly its own surface', () => {
    for (const [surface, key] of Object.entries(SURFACE_KEY) as [SurfaceCmd, string][]) {
      expect(resolve(key.toLowerCase())).toEqual({ type: 'surface', surface })
      expect(resolve(key)).toEqual({ type: 'surface', surface }) // caps-lock / Shift
    }
  })
})

describe('resolveHotkey — doc-level ops need Cmd/Ctrl', () => {
  it('Cmd+Z undo, Cmd+Shift+Z redo, Ctrl+Y redo', () => {
    expect(resolve('z', { metaKey: true })).toEqual({ type: 'undo' })
    expect(resolve('z', { metaKey: true, shiftKey: true })).toEqual({ type: 'redo' })
    expect(resolve('y', { ctrlKey: true })).toEqual({ type: 'redo' })
  })
  it('handles capital Z (Shift produces uppercase key)', () => {
    expect(resolve('Z', { metaKey: true, shiftKey: true })).toEqual({ type: 'redo' })
  })
  it('Cmd+D duplicates; bare d is the Messen tool (no collision)', () => {
    expect(resolve('d', { metaKey: true })).toEqual({ type: 'duplicate' })
    expect(resolve('d')).toEqual({ type: 'tool', tool: 'measure' })
  })
  it('Cmd+[ / Cmd+] step surfaces, Cmd+, opens settings', () => {
    expect(resolve('[', { metaKey: true })).toEqual({ type: 'nav', dir: -1 })
    expect(resolve(']', { ctrlKey: true })).toEqual({ type: 'nav', dir: 1 })
    expect(resolve(',', { metaKey: true })).toEqual({ type: 'panel', panel: 'settings' })
  })
})

describe('resolveHotkey — bare tool/panel/view keys', () => {
  it('maps the tool letters (Umkreis is U — K/C/P/M all belong to surfaces now)', () => {
    expect(resolve('v')).toEqual({ type: 'tool', tool: 'select' })
    expect(resolve('w')).toEqual({ type: 'tool', tool: 'lasso' })
    expect(resolve('s')).toEqual({ type: 'tool', tool: 'symbol' })
    expect(resolve('l')).toEqual({ type: 'tool', tool: 'line' })
    expect(resolve('f')).toEqual({ type: 'tool', tool: 'area' })
    expect(resolve('u')).toEqual({ type: 'tool', tool: 'circle' })
    expect(resolve('n')).toEqual({ type: 'tool', tool: 'note' })
    expect(resolve('t')).toEqual({ type: 'tool', tool: 'team' })
  })
  it('maps the panel letters', () => {
    expect(resolve('j')).toEqual({ type: 'panel', panel: 'journal' })
    expect(resolve('e')).toEqual({ type: 'panel', panel: 'composer' })
    expect(resolve('b')).toEqual({ type: 'panel', panel: 'layers' })
  })
  it('maps the view keys', () => {
    expect(resolve('g')).toEqual({ type: 'view', view: 'locate' })
    expect(resolve('x')).toEqual({ type: 'view', view: 'coord' })
    expect(resolve('+')).toEqual({ type: 'view', view: 'zoomIn' })
    expect(resolve('=')).toEqual({ type: 'view', view: 'zoomIn' })
    expect(resolve('-')).toEqual({ type: 'view', view: 'zoomOut' })
  })
  // «Nach Norden» gave R up: it has the compass on every form factor (always on screen, rotating
  // to the live bearing), while the Rapport had no key at all. R must reach the Rapport, and the
  // remaining view keys must have survived the swap unshadowed.
  it('R is the Rapport surface, not «Nach Norden»', () => {
    expect(resolve('r')).toEqual({ type: 'surface', surface: 'rapport' })
    expect(resolve('g')).toEqual({ type: 'view', view: 'locate' })
    expect(resolve('x')).toEqual({ type: 'view', view: 'coord' })
  })
  it('? opens help', () => {
    expect(resolve('?')).toEqual({ type: 'panel', panel: 'help' })
  })
  it('is case-insensitive for letters', () => {
    expect(resolve('S')).toEqual({ type: 'tool', tool: 'symbol' })
  })
})

describe('resolveHotkey — non-shortcuts', () => {
  it('bare letters that are not bound return null', () => {
    for (const k of ['q', 'h', 'i', 'y', 'z']) expect(resolve(k)).toBeNull()
  })
  it('a bound letter with Cmd is NOT a bare tool (never hijack browser combos)', () => {
    expect(resolve('s', { metaKey: true })).toBeNull() // Cmd+S = browser save
    expect(resolve('l', { ctrlKey: true })).toBeNull()
  })
  it('Alt combos are ignored', () => {
    expect(resolve('v', { altKey: true })).toBeNull()
  })
})

describe('isTypingTarget', () => {
  it('detects inputs / textareas / contentEditable', () => {
    expect(isTypingTarget({ tagName: 'INPUT', isContentEditable: false } as unknown as Element)).toBe(true)
    expect(isTypingTarget({ tagName: 'TEXTAREA', isContentEditable: false } as unknown as Element)).toBe(true)
    expect(isTypingTarget({ tagName: 'DIV', isContentEditable: true } as unknown as Element)).toBe(true)
    expect(isTypingTarget({ tagName: 'DIV', isContentEditable: false } as unknown as Element)).toBe(false)
    expect(isTypingTarget(null)).toBe(false)
  })
})

// The ToolRail prints TOOL_KEY on its tiles: a badge may only name a letter that arms that tool.
describe('the ToolRail badges', () => {
  it('every letter in TOOL_KEY resolves to exactly its own tool', () => {
    for (const [tool, key] of Object.entries(TOOL_KEY) as [ToolCmd, string][]) {
      expect(resolve(key.toLowerCase())).toEqual({ type: 'tool', tool })
    }
  })

  it('reads the Karte\'s rail ids and the Plan\'s alike', () => {
    expect(railToolKey('select')).toBe('V')
    expect(railToolKey('pan')).toBe(railToolKey('select')) // the Plan\'s Auswahl
    expect(railToolKey('text')).toBe(railToolKey('note'))
    expect(railToolKey('resource')).toBe(railToolKey('team'))
    expect(railToolKey('lasso')).toBe('W')
  })

  it('gives a tile without a key no badge', () => {
    expect(railToolKey('pin')).toBeUndefined()
    expect(railToolKey('toString')).toBeUndefined()
  })
})
