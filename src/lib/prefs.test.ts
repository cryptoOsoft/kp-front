import { describe, it, expect } from 'vitest'
import { SYMBOL_SCALE, clampSymbolScale, initialMode, keyHintsFor, legacySymbolMul, planSymbolScale, railLabelsFor, symbolScales, type Prefs } from './prefs'

// The Symbolgrösse rework: one global S/M/L pref became one multiplier PER SURFACE (Karte /
// Module). Two things have to hold — the bands the sliders offer, and that nobody's stored
// setting is lost on the way over.

describe('SYMBOL_SCALE bands', () => {
  // ⚠️ The board's default is no longer the midpoint of its band, and that is the point: the
  // slider is symmetric around «Lage size», the plan is not. Every default still has to sit
  // INSIDE its own band, and on a step of it, or the slider opens on a value it cannot return to.
  it('keeps every default inside its own band and on a step of it', () => {
    for (const r of Object.values(SYMBOL_SCALE)) {
      expect(r.default).toBeGreaterThanOrEqual(r.min)
      expect(r.default).toBeLessThanOrEqual(r.max)
      expect(clampSymbolScale('board', r.default)).toBeCloseTo(r.default)
    }
    // the map is still centred on 1 — a Lage symbol needs no rescaling by default
    expect(SYMBOL_SCALE.map.default).toBe(1)
    expect((SYMBOL_SCALE.map.min + SYMBOL_SCALE.map.max) / 2).toBeCloseTo(SYMBOL_SCALE.map.default)
    // …and the plan opens smaller than the Lage, because an A4 of a building is not the Lage
    expect(SYMBOL_SCALE.board.default).toBeLessThan(SYMBOL_SCALE.map.default)
  })

  it('lets the board go meaningfully below the old S — the reason for the rework', () => {
    expect(SYMBOL_SCALE.board.min).toBeLessThan(legacySymbolMul('S'))
    expect(SYMBOL_SCALE.board.min).toBe(0.2)
    // the map keeps the old S as its floor and the old L stays reachable on both surfaces
    expect(SYMBOL_SCALE.map.min).toBe(legacySymbolMul('S'))
    expect(SYMBOL_SCALE.map.max).toBeGreaterThan(legacySymbolMul('L'))
    expect(SYMBOL_SCALE.board.max).toBeGreaterThan(legacySymbolMul('L'))
  })
})

describe('clampSymbolScale', () => {
  it('snaps to the step without float dust', () => {
    expect(clampSymbolScale('map', 0.71)).toBe(0.7)
    expect(clampSymbolScale('map', 1.23)).toBe(1.25)
    expect(clampSymbolScale('board', 0.42)).toBe(0.4)
  })

  it('clamps into each surface’s own band', () => {
    expect(clampSymbolScale('map', 0.1)).toBe(SYMBOL_SCALE.map.min)
    expect(clampSymbolScale('map', 9)).toBe(SYMBOL_SCALE.map.max)
    // 0.45 is a legal board size but below the map floor
    expect(clampSymbolScale('board', 0.45)).toBe(0.45)
    expect(clampSymbolScale('map', 0.45)).toBe(SYMBOL_SCALE.map.min)
  })

  it('falls back to the surface’s OWN default for anything unusable', () => {
    expect(clampSymbolScale('map', undefined)).toBe(SYMBOL_SCALE.map.default)
    expect(clampSymbolScale('board', NaN)).toBe(SYMBOL_SCALE.board.default)
    expect(clampSymbolScale('board', 'M' as unknown as number)).toBe(SYMBOL_SCALE.board.default)
  })
})

describe('symbolScales migration', () => {
  // ⚠️ NOT the same number on both. A Modul sheet is a building on an A4: a symbol sized for
  // the Lage covers a room on it, so the plan starts smaller and the slider goes up from there.
  it('defaults per surface when nothing is stored — the plan starts smaller than the map', () => {
    expect(symbolScales({})).toEqual({ map: 1, board: 0.7 })
  })

  it('carries a legacy S/M/L pref over to BOTH surfaces unchanged', () => {
    expect(symbolScales({ symbolSize: 'S' })).toEqual({ map: 0.6, board: 0.6 })
    expect(symbolScales({ symbolSize: 'M' })).toEqual({ map: 1, board: 1 })
    expect(symbolScales({ symbolSize: 'L' })).toEqual({ map: 1.3, board: 1.3 })
  })

  it('prefers an explicit per-surface value over the legacy one, surface by surface', () => {
    const p: Prefs = { symbolSize: 'L', symbolScaleBoard: 0.45 }
    // the board was moved by hand, the map still rides the old pref
    expect(symbolScales(p)).toEqual({ map: 1.3, board: 0.45 })
  })

  it('is lossless: resolving never touches the stored prefs object', () => {
    const p: Prefs = { symbolSize: 'S' }
    symbolScales(p)
    expect(p).toEqual({ symbolSize: 'S' })
  })
})

describe('planSymbolScale', () => {
  const scales = { map: 1.25, board: 0.45 }

  it('uses the Modul setting while a plan has no map georeference', () => {
    expect(planSymbolScale(scales, false)).toBe(0.45)
  })

  it('automatically follows the Karte setting once the plan is georeferenced', () => {
    expect(planSymbolScale(scales, true)).toBe(1.25)
  })
})

/* A new emergency opens on the Karte (Feldtest Manuel, 07.09.): the remembered surface only
 * applies to the Einsatz it was chosen in — yesterday's Atemschutz tab must not be the first
 * thing a fresh alarm shows. */
describe('initialMode', () => {
  it('restores the remembered surface only for the SAME Einsatz', () => {
    const prefs = { mode: 'atemschutz' as const, modeIncidentId: 'inc-1' }
    expect(initialMode(prefs, 'inc-1', false)).toBe('atemschutz')
    expect(initialMode(prefs, 'inc-2', false)).toBe('map')
  })

  it('defaults to the Karte with no remembered surface, and legacy prefs without an id', () => {
    expect(initialMode({}, 'inc-1', false)).toBe('map')
    // a pref saved before modeIncidentId existed names no Einsatz → treated as foreign
    expect(initialMode({ mode: 'mittel' }, 'inc-1', false)).toBe('map')
  })

  it('an Atemschutz-Link session always lands on its one surface', () => {
    expect(initialMode({ mode: 'map', modeIncidentId: 'inc-1' }, 'inc-1', true)).toBe('atemschutz')
  })
})

// «Beschriftung der Werkzeugleisten» (29.09.2026, sweep T8): a phone reads the words by default
describe('railLabelsFor', () => {
  it('gives a phone the words and a tablet the glyphs when nobody chose', () => {
    expect(railLabelsFor({}, true)).toBe('short')
    expect(railLabelsFor({}, false)).toBe('off')
  })

  it('reads a stored «off» without a choice as the old default, not a choice', () => {
    expect(railLabelsFor({ railLabels: 'off' }, true)).toBe('short')
    expect(railLabelsFor({ railLabels: 'off' }, false)).toBe('off')
  })

  it('keeps a device\'s own choice', () => {
    expect(railLabelsFor({ railLabels: 'off', railLabelsChosen: true }, true)).toBe('off')
    expect(railLabelsFor({ railLabels: 'short', railLabelsChosen: true }, false)).toBe('short')
    // «Wörter» was never a default, so a stored one is a choice even from before the flag
    expect(railLabelsFor({ railLabels: 'short' }, false)).toBe('short')
  })
})

// «Tastenkürzel anzeigen» (31.10.2026): on until somebody switches it off
describe('keyHintsFor', () => {
  it('defaults to on, including for a cookie written before the pref existed', () => {
    expect(keyHintsFor({})).toBe(true)
  })

  it('keeps a device\'s own choice', () => {
    expect(keyHintsFor({ keyHints: false })).toBe(false)
    expect(keyHintsFor({ keyHints: true })).toBe(true)
  })
})
