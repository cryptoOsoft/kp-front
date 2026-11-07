import { describe, it, expect } from 'vitest'
import { KARTE_TOOL_KEY, karteToolKey, resolveKarteHotkey, type KarteHotkey, type KarteTool } from './hotkeys'
import { resolveHotkey } from '../hotkeys'

const ev = (key: string, mod: Partial<KeyboardEvent> = {}): KeyboardEvent =>
  ({ key, metaKey: false, ctrlKey: false, shiftKey: false, altKey: false, ...mod }) as KeyboardEvent
const resolve = (key: string, mod?: Partial<KeyboardEvent>): KarteHotkey | null => resolveKarteHotkey(ev(key, mod))

describe('resolveKarteHotkey — the keys it shares with the Einsatz mean the same thing', () => {
  it('K Karte · C Checkliste · digits a module · 0 Einpassen', () => {
    expect(resolve('k')).toEqual({ type: 'map' })
    expect(resolve('C')).toEqual({ type: 'library' })
    expect(resolve('3')).toEqual({ type: 'module', n: 3 })
    expect(resolve('0')).toEqual({ type: 'fit' })
  })
  it('B Ebenen · G Mein Standort · + − zoom · ⌘, Einstellungen · ? Hilfe', () => {
    expect(resolve('b')).toEqual({ type: 'layers' })
    expect(resolve('g')).toEqual({ type: 'locate' })
    expect(resolve('+')).toEqual({ type: 'zoom', dir: 'in' })
    expect(resolve('-')).toEqual({ type: 'zoom', dir: 'out' })
    expect(resolve(',', { metaKey: true })).toEqual({ type: 'settings' })
    expect(resolve('?')).toEqual({ type: 'help' })
  })
  // a key the viewer has no surface or tool for must decode to nothing, so it is never claimed
  it('the Einsatz-only keys do nothing here', () => {
    for (const k of ['a', 'm', 'r', 'v', 'w', 's', 'l', 'f', 'n', 't', 'j', 'e', 'x']) expect(resolve(k)).toBeNull()
    expect(resolve('z', { metaKey: true })).toBeNull()
    expect(resolve('[', { metaKey: true })).toBeNull()
  })
})

describe('resolveKarteHotkey — the viewer\'s own keys', () => {
  it('P Punkt setzen and U Gefahrgut win over the Einsatz\'s P (Anwesenheit) and U (Umkreis)', () => {
    expect(resolveHotkey(ev('p'))).toEqual({ type: 'surface', surface: 'anwesenheit' })
    expect(resolve('p')).toEqual({ type: 'tool', tool: 'pin' })
    expect(resolve('u')).toEqual({ type: 'tool', tool: 'erg' })
    expect(resolve('d')).toEqual({ type: 'tool', tool: 'measure' })
  })
  it('/ and ⌘K / Ctrl+K open the search; a bare K stays the Karte', () => {
    expect(resolve('/')).toEqual({ type: 'search' })
    expect(resolve('k', { metaKey: true })).toEqual({ type: 'search' })
    expect(resolve('K', { ctrlKey: true, shiftKey: true })).toEqual({ type: 'search' })
    expect(resolve('k', { altKey: true })).toBeNull()
  })
  // the rail prints KARTE_TOOL_KEY on the tile: the keyboard has to agree with every badge
  it('every badge resolves to exactly its own tool, in either case', () => {
    for (const [tool, key] of Object.entries(KARTE_TOOL_KEY) as [KarteTool, string][]) {
      expect(karteToolKey(tool)).toBe(key)
      expect(resolve(key.toLowerCase())).toEqual({ type: 'tool', tool })
      expect(resolve(key)).toEqual({ type: 'tool', tool })
    }
    expect(karteToolKey('layers')).toBeUndefined()
  })
})
