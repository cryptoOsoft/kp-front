import { describe, expect, it } from 'vitest'
import { ROTATABLE, seedSymbolProps } from './symbols'
import { appConfig } from '../config/appConfig'

// A tiny catalog: only `name` + `cat` matter to seedSymbolProps.
const catalog = [
  { name: 'VKF Feuer', cat: 'Schadenlage' },
  { name: 'VKF Rettungen', cat: 'Schadenlage' },
  { name: 'VKF Fahrzeug', cat: 'Fahrzeuge' },
  { name: 'GB BA Wand F30', cat: 'Gebäude' },
  { name: 'No Such Symbol', cat: 'Gebäude' },
]

describe('seedSymbolProps', () => {
  it('special-cases the generic vehicle: empty label, no subtitle, rotation 0, seeds the Fahrer field', () => {
    const p = seedSymbolProps(appConfig.symbols.vehicleName, catalog)
    expect(p).toEqual({ symbol: appConfig.symbols.vehicleName, label: '', rotation: 0, fields: { Fahrer: '', Herkunft: '' } })
    expect(p.subtitle).toBeUndefined()
  })

  it('seeds label (display name), subtitle (category) and empty field rows from the preset', () => {
    const p = seedSymbolProps('VKF Rettungen', catalog)
    expect(p.symbol).toBe('VKF Rettungen')
    expect(p.label).toBe('Rettung') // curated displayName
    expect(p.subtitle).toBe('Schadenlage')
    // VKF Rettungen preset carries fields (['Status']) → seeded as empty strings
    expect(p.fields).toBeTruthy()
    expect(Object.keys(p.fields ?? {})).toContain('Status')
    for (const v of Object.values(p.fields ?? {})) expect(v).toBe('')
  })

  it('leaves fields undefined for a symbol whose preset has no field template', () => {
    // VKF Feuer's preset is controls-only (floor+spread), no fields.
    const p = seedSymbolProps('VKF Feuer', catalog)
    expect(p.label).toBe('Feuer')
    expect(p.subtitle).toBe('Schadenlage')
    expect(p.fields).toBeUndefined()
  })

  it('falls back to the prefix-stripped name when there is no curated display name', () => {
    const p = seedSymbolProps('GB BA Wand F30', catalog)
    expect(p.label).toBe('Wand F30') // from displayNames override
    expect(p.subtitle).toBe('Gebäude')
  })

  it('falls back to the category preset for an unknown name (Gebäude → no fields, controls-only)', () => {
    // 'No Such Symbol' isn't a known by-name preset; the Gebäude category preset is
    // controls-only (['floor']) with no field template → fields stays undefined.
    const p = seedSymbolProps('No Such Symbol', catalog)
    expect(p.symbol).toBe('No Such Symbol')
    expect(p.subtitle).toBe('Gebäude')
    expect(p.fields).toBeUndefined()
  })

  it('omits subtitle when the symbol is absent from the catalog', () => {
    const p = seedSymbolProps('VKF Feuer', [])
    expect(p.subtitle).toBeUndefined()
  })

  it('leaves fields undefined when neither name nor category supply a field template', () => {
    const p = seedSymbolProps('Totally Unknown', [{ name: 'Totally Unknown', cat: 'No Cat' }])
    expect(p.fields).toBeUndefined()
  })
})

describe('ROTATABLE', () => {
  it('is a non-empty set of symbol names', () => {
    expect(ROTATABLE).toBeInstanceOf(Set)
    expect(ROTATABLE.size).toBeGreaterThan(0)
  })

  it('contains directional symbols whose preset lists rotation (e.g. the vehicle)', () => {
    expect(ROTATABLE.has('VKF Fahrzeug')).toBe(true)
  })

  it('excludes a symbol whose preset has no rotation control', () => {
    // VKF Feuer's preset is floor+spread (no rotation) — see symbols.test.ts.
    expect(ROTATABLE.has('VKF Feuer')).toBe(false)
  })

  it('only contains names that are real by-name presets', () => {
    const presets = appConfig.symbols.presets.byName
    for (const name of ROTATABLE) {
      expect(presets[name]).toBeTruthy()
      expect(presets[name].controls).toContain('rotation')
    }
  })
})
