import { describe, expect, it } from 'vitest'
import { alarmBar, compareReadings, countFieldValue, readingRows, readingScale, recordReading, symbolCaptionBoxText, symbolCaptionText, symbolControls, symbolFieldKind, symbolFieldOptions, symbolLegendText, symbolOriginText, symbolPresetFieldKeys, symbolReading, symbolReadoutText } from './symbols'
import type { SymbolControl } from '../types'
import { appConfig } from '../config/appConfig'

// Sorted set → array for order-independent comparison.
const got = (s: Set<SymbolControl>) => [...s].sort()
const want = (...cs: SymbolControl[]) => [...cs].sort()

describe('symbolControls — gating of which steppers a symbol exposes', () => {
  it('returns the exact preset controls for a known symbol (rotation only)', () => {
    expect(got(symbolControls('VKF Fahrzeug'))).toEqual(want('rotation'))
  })

  it('returns the exact preset controls for a known symbol (floorRange + spread)', () => {
    // ⚠️ VKF Feuer moved from a single 'floor' to 'floorRange' (03.09.) — damage spans storeys
    // as often as it sits on one; a single-storey fire is still one tap (fill only «von»).
    expect(got(symbolControls('VKF Feuer'))).toEqual(want('floorRange', 'spread'))
  })

  it('returns count + floor for a symbol whose preset lists both', () => {
    expect(got(symbolControls('VKF Rettungen'))).toEqual(want('count', 'floor'))
  })

  it('returns rotation + floorRange for a building wall symbol', () => {
    // ⚠️ the F30/F60/F180 walls moved to 'floorRange' alongside stairs/lift (03.09.) — a
    // Brandabschnitt boundary is drawn once for the storeys it separates.
    expect(got(symbolControls('GB BA Wand F30'))).toEqual(want('rotation', 'floorRange'))
  })

  it('returns floorRange for a stairs/lift symbol', () => {
    expect(got(symbolControls('GB Lift'))).toEqual(want('floorRange'))
  })

  it('returns floorRange (not floor+floorRange) for a symbol newly extended to the range control', () => {
    // the design choice (03.09.): 'floorRange' REPLACES 'floor' rather than joining it — declaring
    // both would show a redundant floor stepper alongside the von/bis pair in ContextPanel (see
    // ContextPanel.test.tsx), so every extended symbol drops 'floor' the same way Treppe/Lift do.
    expect(got(symbolControls('GB Kamin'))).toEqual(want('floorRange'))
    expect(got(symbolControls('FW Gefahr G'))).toEqual(want('floorRange'))
  })

  it('an explicit by-name match takes precedence over the category fallback', () => {
    // 'VKF Feuer' is in category 'Schadenlage' (byCat → ['floor']) but its by-name
    // preset (['floorRange','spread']) must win.
    expect(got(symbolControls('VKF Feuer', 'Schadenlage'))).toEqual(want('floorRange', 'spread'))
  })

  it('falls back to the category preset when the name is unknown', () => {
    expect(got(symbolControls('No Such Symbol', 'Gebäude'))).toEqual(want('floor'))
  })

  it('a category whose preset lists no controls yields an empty set', () => {
    expect(got(symbolControls('Unknown', 'Wasser'))).toEqual([])
  })

  it('an unknown symbol with no category falls back to ALL THREE built-in steppers', () => {
    expect(got(symbolControls())).toEqual(want('rotation', 'count', 'floor'))
    expect(got(symbolControls('Totally Unknown'))).toEqual(want('rotation', 'count', 'floor'))
  })

  it('an unknown symbol AND unknown category still falls back to all three', () => {
    expect(got(symbolControls('Totally Unknown', 'No Such Category'))).toEqual(
      want('rotation', 'count', 'floor'),
    )
  })
})

describe('symbolFieldOptions — roster fields stay separate from category lists', () => {
  const ROSTER = ['Hans Muster', 'Anna Beispiel']

  it('Offizier exposes a «Funktion» field (config-listed) distinct from the person «Name»', () => {
    const opts = symbolFieldOptions('FW Offizier', 'Führung', ROSTER)
    // Funktion is a config-listable field: present as a key, empty without config (no code default)
    expect(opts.Funktion).toEqual([])
    // …and the person field carries ONLY the roster names — never any function labels
    expect(opts.Name).toEqual(ROSTER)
  })

  it('a person field (Name) is filled with roster names only — no preset/custom merge', () => {
    const opts = symbolFieldOptions('FW Offizier', 'Führung', ROSTER)
    expect(opts.Name).toEqual(ROSTER)
  })

  it('the vehicle Fahrer field (also a roster field) gets roster names only', () => {
    const opts = symbolFieldOptions('VKF Fahrzeug', 'Fahrzeuge / Mittel', ROSTER)
    expect(opts.Fahrer).toEqual(ROSTER)
  })

  it('every driven vehicle exposes a Fahrer roster picker', () => {
    for (const v of ['VKF Fahrzeug', 'VKF Drehleiter', 'VKF Hubretter', 'Grosslüfter', 'FW Boot']) {
      const opts = symbolFieldOptions(v, 'Fahrzeuge / Mittel', ROSTER)
      expect(opts.Fahrer, `${v} must carry a Fahrer field`).toEqual(ROSTER)
    }
  })
})

describe('symbolCaptionText — metadata printed under a symbol glyph', () => {
  it('off mode (global or per-symbol) shows nothing', () => {
    expect(symbolCaptionText({ symbol: 'FW Kleinloeschgeraet', fields: { Typ: 'CO2' } }, 'off')).toBeNull()
    expect(symbolCaptionText({ symbol: 'FW Kleinloeschgeraet', fields: { Typ: 'CO2' }, caption: 'off' }, 'auto')).toBeNull()
  })

  it('auto shows the primary field value (value-only, no key)', () => {
    expect(symbolCaptionText({ symbol: 'FW Kleinloeschgeraet', fields: { Typ: 'CO2' } }, 'auto')).toBe('CO2')
  })

  it('auto follows the preset `caption` key, not just the first field', () => {
    // Gefahrentafel leads with UN-Nr but captions on Stoff (appConfig preset)
    expect(symbolCaptionText({ symbol: 'FW Gefahr Tafel', fields: { 'UN-Nr.': '1203', Stoff: 'Benzin' } }, 'auto')).toBe('Benzin')
  })

  it('auto falls back to the first filled field when the primary is empty', () => {
    expect(symbolCaptionText({ symbol: 'FW Gefahr Tafel', fields: { 'UN-Nr.': '1203', Stoff: '' } }, 'auto')).toBe('1203')
  })

  it('an Offizier composes «Funktion · Name» when both halves are filled (auto)', () => {
    // one generic glyph for many roles: «Front» alone says what without the who, «Meier» the
    // reverse — the auto caption carries both
    expect(symbolCaptionText({ symbol: 'FW Offizier', fields: { Funktion: 'Front', Name: 'Meier' } }, 'auto'))
      .toBe('Front · Meier')
  })

  it('an Offizier with only one half filled keeps the single-value rule', () => {
    expect(symbolCaptionText({ symbol: 'FW Offizier', fields: { Funktion: 'Front', Name: '' } }, 'auto')).toBe('Front')
    expect(symbolCaptionText({ symbol: 'FW Offizier', fields: { Funktion: '', Name: 'Meier' } }, 'auto')).toBe('Meier')
  })

  it('a per-symbol override opts a single symbol in even when the global default is off', () => {
    expect(symbolCaptionText({ symbol: 'FW Kleinloeschgeraet', fields: { Typ: 'CO2' }, caption: 'auto' }, 'off')).toBe('CO2')
  })

  it('all mode joins every filled field with newlines, in preset field order', () => {
    expect(symbolCaptionText({ symbol: 'FW Gefahr Tafel', fields: { 'UN-Nr.': '1203', Stoff: 'Benzin' } }, 'all')).toBe('1203\nBenzin')
  })

  it('all mode includes custom (non-preset) fields after the preset ones, then notes', () => {
    // preset fields first (canonical order), then any custom key the operator added, then notes
    expect(symbolCaptionText({
      symbol: 'FW Gefahr Tafel',
      fields: { 'UN-Nr.': '1203', Stoff: 'Benzin', Menge: '200 l' },
      notes: 'ausgelaufen',
    }, 'all')).toBe('1203\nBenzin\n200 l\nausgelaufen')
  })

  it('all mode shows notes even when the symbol has no filled fields', () => {
    expect(symbolCaptionText({ symbol: 'SI Ueberflurhydrant', notes: 'defekt' }, 'all')).toBe('defekt')
  })

  it('auto shows a custom label when the symbol has no filled fields', () => {
    // a user-named vehicle/title differs from the auto-formatted symbol name
    expect(symbolCaptionText({ symbol: 'VKF Einsatzleiter', label: 'Müller', fields: { Name: '' } }, 'auto')).toBe('Müller')
  })

  it('auto does NOT echo the auto-formatted symbol name (the glyph already says it)', () => {
    // 'FW Sammelplatz' → label equals its formatted name → nothing worth printing
    expect(symbolCaptionText({ symbol: 'FW Sammelplatz', label: 'Sammelplatz' }, 'auto')).toBeNull()
  })

  it('returns null when there is no field value and no custom label', () => {
    expect(symbolCaptionText({ symbol: 'SI Ueberflurhydrant' }, 'auto')).toBeNull()
  })

  it('a vehicle stays silent in auto — its name is drawn inside the glyph', () => {
    expect(symbolCaptionText({
      symbol: appConfig.symbols.vehicleName, label: 'TLF 1', fields: { Fahrer: 'Céline Widmer' },
    }, 'auto')).toBeNull()
  })

  it('all mode gives a vehicle everything EXCEPT its name (Fahrer, custom fields, notes)', () => {
    expect(symbolCaptionText({
      symbol: appConfig.symbols.vehicleName,
      label: 'TLF 1',
      fields: { Fahrer: 'Céline Widmer', Test: 'Test', 'Test 2': 'Test 2' },
      notes: 'Tank halb',
    }, 'all')).toBe('Céline Widmer\nTest\nTest 2\nTank halb')
  })

  // owner pick 3A (05.11.2026): the Herkunft is its own grey line, never the caption itself
  it('the Herkunft never becomes the caption – it is the grey line under it', () => {
    const dl = { symbol: 'VKF Drehleiter', fields: { Fahrer: '', Herkunft: 'Stützpunkt' } }
    expect(symbolCaptionText(dl, 'auto')).toBeNull()
    expect(symbolCaptionText(dl, 'all')).toBeNull()
    expect(symbolOriginText(dl, 'auto')).toBe('Stützpunkt')
    expect(symbolCaptionBoxText({ ...dl, fields: { Fahrer: 'Meier', Herkunft: 'Stützpunkt' } }, 'auto')).toBe('Meier\nStützpunkt')
  })

  it('no Herkunft line for the own Feuerwehr (empty) or where captions are off', () => {
    expect(symbolOriginText({ symbol: 'VKF Drehleiter', fields: { Herkunft: ' ' } }, 'auto')).toBeNull()
    expect(symbolOriginText({ symbol: 'VKF Drehleiter', fields: { Herkunft: 'Stützpunkt' } }, 'off')).toBeNull()
    expect(symbolOriginText({ symbol: 'VKF Drehleiter', fields: { Herkunft: 'Stützpunkt' }, caption: 'off' }, 'auto')).toBeNull()
  })

  it('the printed legend says what the Herkunft is – placed and live vehicle alike', () => {
    expect(symbolLegendText({ symbol: appConfig.symbols.vehicleName, label: 'TLF', fields: { Fahrer: 'Meier', Herkunft: 'Stützpunkt' } }, 'auto'))
      .toBe('Fahrzeug · TLF · Meier · Herkunft: Stützpunkt')
    expect(symbolLegendText({ label: 'TLF 2', fields: { Herkunft: 'Wache Nord' } }, 'auto')).toBe('TLF 2 · Herkunft: Wache Nord')
  })

  it('an off override still silences a vehicle in the all default', () => {
    expect(symbolCaptionText({
      symbol: appConfig.symbols.vehicleName, label: 'TLF 1', fields: { Fahrer: 'Céline Widmer' }, caption: 'off',
    }, 'all')).toBeNull()
  })
})

// The symbol pack's presets are config, and a missing entry is invisible rather than loud — the
// symbol simply offers nothing. These pin the ones that were found missing on 2026-08-11.
describe('Messpunkt — a measured symbol keys its values (26.10.2026)', () => {
  const mp = (fields: Record<string, string>, Raum?: string) => ({ symbol: 'FW Messpunkt', fields: Raum ? { Raum, ...fields } : fields })

  it('wears the first filled reading on its glyph, keyed', () => {
    expect(symbolReadoutText(mp({ CO: '180', Ex: '0' }, 'Zimmer 21'))).toBe('CO 180')
    // CO not reported (yet): the next channel that was, never a bare number
    expect(symbolReadoutText(mp({ CO: ' ', 'O₂': '19.8' }))).toBe('O₂ 19.8')
  })

  it('placed but not yet measured is just the glyph — and no other symbol has a readout', () => {
    expect(symbolReadoutText(mp({}))).toBeNull()
    expect(symbolReadoutText({ symbol: 'FW Kleinloeschgeraet', fields: { Typ: 'CO2' } })).toBeNull()
  })

  it('auto captions only the room — the value is already on the glyph', () => {
    expect(symbolCaptionText(mp({ CO: '180' }, 'Zimmer 21'), 'auto')).toBe('Zimmer 21')
    expect(symbolCaptionText(mp({ CO: '180' }), 'auto')).toBeNull()
  })

  it('every value that leaves the glyph keeps its key (caption «Alle», printed legend)', () => {
    const p = mp({ CO: '180', Ex: '0', 'O₂': '20.1' }, 'Zimmer 21')
    expect(symbolCaptionText(p, 'all')).toBe('Zimmer 21\nCO 180\nEx 0\nO₂ 20.1')
    expect(symbolLegendText(p, 'auto')).toBe('Messpunkt · Zimmer 21 · CO 180 · Ex 0 · O₂ 20.1')
  })
})

describe('Messpunkt — the reading its mark wears (27.10.2026)', () => {
  const MIN = 60_000
  const mp = (fields: Record<string, string>, readings?: { t: number; v: Record<string, string> }[]) => ({ symbol: 'FW Messpunkt', fields, readings })

  it('the worst gas wins: an Ex at A1 beats a harmless CO, a CO at A2 beats that Ex', () => {
    expect(symbolReading(mp({ CO: '14', Ex: '12' }))).toMatchObject({ text: 'Ex 12', level: 'a1' })
    expect(symbolReading(mp({ CO: '65', Ex: '12' }))).toMatchObject({ text: 'CO 65', level: 'a2' })
    expect(symbolReading(mp({ CO: '14', Ex: '0' }))).toMatchObject({ text: 'CO 14', level: 'ok' })
  })

  it('O₂ alarms both ways, and a radio report\'s decimal comma is a number', () => {
    expect(symbolReading(mp({ 'O₂': '18,5' }))).toMatchObject({ text: 'O₂ 18,5', level: 'a1' })
    expect(symbolReading(mp({ 'O₂': '16' }))?.level).toBe('a2')
    expect(symbolReading(mp({ 'O₂': '23.5' }))?.level).toBe('a2')
    expect(symbolReading(mp({ 'O₂': '20.9' }))?.level).toBe('ok')
  })

  it('goes old 15 min after the last reading – a point without history never does', () => {
    const at = 1_000_000
    expect(symbolReading(mp({ CO: '65' }, [{ t: at, v: { CO: '65' } }]), at + 14 * MIN)).toMatchObject({ stale: false, ageMin: 14 })
    expect(symbolReading(mp({ CO: '65' }, [{ t: at, v: { CO: '65' } }]), at + 18 * MIN)).toMatchObject({ stale: true, ageMin: 18, level: 'a2' })
    expect(symbolReading(mp({ CO: '65' }), at)).toMatchObject({ stale: false, ageMin: null })
  })

  it('a field commit appends a row only when a measured value changed', () => {
    const p = mp({ Raum: 'Gang', CO: '20' }, [{ t: 1, v: { CO: '20' } }])
    expect(recordReading(p, { Raum: 'Gang 2', CO: '20' }, 5)).toBe(p.readings) // the room is no reading
    expect(recordReading(p, { Raum: 'Gang', CO: '45' }, 5)).toEqual([{ t: 1, v: { CO: '20' } }, { t: 5, v: { CO: '45' } }])
    expect(recordReading({ symbol: 'FW Kleinloeschgeraet', fields: {} }, { Typ: 'CO2' }, 5)).toBeUndefined()
  })

  it('one report typed gas by gas is one row in the list, newest first', () => {
    const p = mp({}, [{ t: 0, v: { CO: '20' } }, { t: 10 * MIN, v: { CO: '45' } }, { t: 10 * MIN + 20_000, v: { CO: '45', Ex: '0' } }])
    expect(readingRows(p).map((r) => r.v)).toEqual([{ CO: '45', Ex: '0' }, { CO: '20' }])
  })

  it('between two gases at the same stage, the one further past its limit wins', () => {
    // Ex 24 is 1.2 × its A2 of 20, CO 65 only 1.08 × its 60 – preset order no longer decides
    expect(symbolReading(mp({ CO: '65', Ex: '24' }))).toMatchObject({ text: 'Ex 24', level: 'a2' })
    // O₂'s low side counts the other way: 15 under an A2 of 17 is 1.13 ×, past CO 65's 1.08 ×
    expect(symbolReading(mp({ CO: '65', 'O₂': '15' }))?.text).toBe('O₂ 15')
    // calm says CO first, whatever is closer to amber
    expect(symbolReading(mp({ CO: '14', 'O₂': '19,5' }))?.text).toBe('CO 14')
  })

  it('the bar under a field: calm, amber, red, the tick at A1 where calm ends', () => {
    expect(alarmBar('FW Messpunkt', 'CO', '30')).toMatchObject({ at: 0.6 })
    expect(alarmBar('FW Messpunkt', 'CO', '30')?.zones.map((z) => z.level)).toEqual(['ok', 'a1', 'a2'])
    expect(alarmBar('FW Messpunkt', 'O₂', '20.9')?.zones.map((z) => z.level)).toEqual(['a2', 'a1', 'ok', 'a2'])
    expect(alarmBar('FW Messpunkt', 'CO', '')?.at).toBeNull()
    expect(alarmBar('FW Messpunkt', 'Raum', 'Gang')).toBeNull()
  })
})

describe('presets that were silently absent', () => {
  it('every Schadenlage symbol can name a storey', () => {
    // Beschädigung / Teil- / Totalzerstörung / Überschwemmung had NO preset at all, so they were
    // the only damage symbols with no floor — «Teilzerstörung» with no storey is exactly the
    // statement a Kroki cannot afford to leave vague. Most of these later moved from a single
    // 'floor' to the von/bis 'floorRange' (03.09.) — either still names a storey.
    for (const n of ['FW Beschaedigung', 'FW Teilzerstoerung', 'FW Totalzerstoerung', 'FW Ueberschwemmung',
                     'VKF Feuer', 'VKF Rauch', 'VKF Wasser']) {
      const c = symbolControls(n)
      expect(c.has('floor') || c.has('floorRange'), n).toBe(true)
    }
    // VKF Unfall wasn't extended — still the plain single-storey stepper.
    expect(symbolControls('VKF Unfall').has('floor')).toBe(true)
  })

  it('every place people are collected can count them', () => {
    for (const n of ['VKF Patientensammelstelle', 'VKF Sanitaetshilfsstelle', 'FW Verwundetennest',
                     'VKF Totensammelstelle', 'VKF Sammelstelle', 'VKF Rettungen']) {
      expect(symbolControls(n).has('count'), n).toBe(true)
    }
  })

  it('…and the Anzahl says WHAT it counts', () => {
    const byName = appConfig.copy.contextPanel.countBySymbol
    expect(byName['FW Verwundetennest']).toBe('Anzahl Verwundete')
    expect(byName['VKF Totensammelstelle']).toBe('Anzahl Verstorbene')
    // anything not listed keeps the plain word
    expect(byName['VKF Feuer']).toBeUndefined()
  })

  it('a Rettung counts the animals beside the people', () => {
    // «Anzahl Personen» is the count stepper; the animals are their own field, worded like the
    // Rapport's Gerettete (Personen / Tiere). Second field, so «Auto» still captions the Status.
    expect(symbolPresetFieldKeys('VKF Rettungen')).toEqual(['Status', 'Anzahl Tiere'])
    expect(appConfig.copy.contextPanel.countBySymbol['VKF Rettungen']).toBe('Anzahl Personen')
    expect(symbolCaptionText({ symbol: 'VKF Rettungen', fields: { Status: 'vermisst', 'Anzahl Tiere': '2' } }, 'auto'))
      .toBe('vermisst')
  })

  it('kit that is carried inside can name the storey it is on', () => {
    // cellar work and stairwell ventilation are the normal case, and the storey was the one
    // thing these could not say. The VEHICLES deliberately keep none — a Drehleiter is outside.
    for (const n of ['VKF Luefter mobil', 'Grosslüfter', 'FW Entrauchung', 'FW Kleinloeschgeraet',
                     'FW Tauchpumpe', 'FW Wassersauger', 'VKF Innenhydrant', 'SI Wasserloeschposten']) {
      expect(symbolControls(n).has('floor'), n).toBe(true)
    }
    for (const n of ['VKF Drehleiter', 'VKF Hubretter', 'FW Boot', 'VKF Fahrzeug']) {
      expect(symbolControls(n).has('floor'), n).toBe(false)
    }
  })

  it('the generic hazard can say WHAT the danger is', () => {
    // «Gefahr allgemein» carried no field at all, so the one symbol whose whole message is
    // "something dangerous here" could never name it — and its caption stayed empty on the map
    expect(symbolPresetFieldKeys('FW Gefahr allgemein')).toEqual(['Gefahr'])
    expect(symbolCaptionText({ symbol: 'FW Gefahr allgemein', fields: { Gefahr: 'Einsturz' } }, 'auto')).toBe('Einsturz')
  })

  // «Bedienung» (14.09.): the person operating a placed device. Hazards, building-fixed
  // elements, water sources, zones, orientation glyphs and the person symbols are not manned;
  // vehicles keep «Fahrer» instead. Always the LAST field, so captions keep their key.
  it('manned devices carry «Bedienung» as their last field; the excluded groups do not', () => {
    for (const n of ['VKF Luefter mobil', 'FW Absperrung', 'FW Kleinloeschgeraet', 'VKF Pumpe Typ2',
                     'FW Tauchpumpe', 'VKF Drohne', 'VKF Kontrollposten', 'FKS Beobachtungsposten',
                     'ZS Dekontaminationsstelle']) {
      expect(symbolPresetFieldKeys(n).slice(-1)[0], n).toBe('Bedienung')
    }
    for (const n of ['VKF Feuer', 'VKF Rettungen', 'FW Gefahr Tafel', 'FW Gefahr allgemein', 'FW Elektroanlage',
                     'GB Lift', 'GB Brandmeldezentrale', 'SI Ueberflurhydrant', 'WV Loeschweier', 'SI Schieber',
                     'VKF Bereich Polizei', 'VKF Helilandeplatz', 'SI Nordpfeil', 'SI Windrichtung',
                     'VKF Einsatzleiter', 'FW Offizier', 'VKF KP Front',
                     'VKF Fahrzeug', 'VKF Drehleiter', 'Grosslüfter', 'FW Boot']) {
      expect(symbolPresetFieldKeys(n), n).not.toContain('Bedienung')
    }
    // a preset that already names its caption keeps it — the Typ, not the person
    expect(symbolCaptionText({ symbol: 'VKF Luefter mobil', fields: { Typ: 'Elektro', Bedienung: 'Meier Anna' } }, 'auto'))
      .toBe('Elektro')
    // …and the picker is a roster picker like Fahrer
    expect(symbolFieldOptions('FW Absperrung', 'Führung', ['Hans Muster']).Bedienung).toEqual(['Hans Muster'])
  })

  it('a water source can state its capacity', () => {
    expect(symbolPresetFieldKeys('WV Loeschweier')).toContain('Kapazität')
    expect(symbolPresetFieldKeys('SI Wasserbezugsort')).toContain('Kapazität')
    // …and the box says which unit, because «Kapazität: 80» is ambiguous
    expect(appConfig.copy.contextPanel.fieldPlaceholders['Kapazität']).toContain('m³')
  })
})

// Sweep 28.10.2026 #3: the chip, the list and the Gebäude stack sort with ONE comparator.
describe('compareReadings — the one Messpunkt order', () => {
  const MIN = 60_000
  const NOW = 100 * MIN
  const at = (fields: Record<string, string>, t: number) =>
    symbolReading({ symbol: 'FW Messpunkt', fields, readings: [{ t, v: fields }] }, NOW)
  const order = (...rs: ReturnType<typeof at>[]) => rs.map((r, i) => ({ r, i })).sort((a, b) => compareReadings(a.r, b.r)).map((x) => x.i)

  it('the owner\'s case: an old Ex 24 and a new Ex 30, both at A2 – the 30 leads', () => {
    expect(order(at({ Ex: '24' }, NOW - 5 * MIN), at({ Ex: '30' }, NOW - MIN))).toEqual([1, 0])
    // …also when the old one has gone stale, and also the other way round in the store
    expect(order(at({ Ex: '24' }, NOW - 40 * MIN), at({ Ex: '30' }, NOW - MIN))).toEqual([1, 0])
    expect(order(at({ Ex: '30' }, NOW - MIN), at({ Ex: '24' }, NOW - 5 * MIN))).toEqual([0, 1])
  })

  it('stage first, then fresh before stale, then how far past, then the newest', () => {
    expect(order(at({ CO: '35' }, NOW), at({ CO: '61' }, NOW - 40 * MIN))).toEqual([1, 0]) // a stale A2 over a fresh A1
    expect(order(at({ Ex: '40' }, NOW - 40 * MIN), at({ Ex: '21' }, NOW))).toEqual([1, 0]) // same stage: fresh first
    expect(order(at({ CO: '5' }, NOW - 2 * MIN), at({ CO: '3' }, NOW))).toEqual([1, 0]) // calm: the newest
    expect(order(symbolReading({ symbol: 'FW Messpunkt', fields: {} }), at({ CO: '3' }, NOW))).toEqual([1, 0]) // measured over empty
  })
})

describe('readingScale — what the Messpunkt\'s ⓘ explains', () => {
  it('every gas with its two stages, in preset order, and when a reading goes old', () => {
    const scale = readingScale('FW Messpunkt')
    expect(scale?.gases.map((g) => g.key)).toEqual(['CO', 'Ex', 'O₂', 'H₂S'])
    expect(scale?.gases[2]).toEqual({ key: 'O₂', a1: { below: 19 }, a2: { below: 17, atLeast: 23 } })
    expect(scale?.staleMin).toBe(15)
    expect(readingScale('VKF Feuer')).toBeNull()
  })
})

describe('count fields (fieldKinds)', () => {
  it('marks the Rettung\'s «Anzahl Tiere» as a count, nothing else', () => {
    expect(symbolFieldKind('VKF Rettungen', 'Anzahl Tiere')).toBe('count')
    expect(symbolFieldKind('VKF Rettungen', 'Status')).toBeUndefined()
    expect(symbolFieldKind(undefined, 'Anzahl Tiere')).toBeUndefined()
  })

  it('a Messpunkt gas is a measured number (the decimal keypad), its room is not', () => {
    for (const k of ['CO', 'Ex', 'O₂', 'H₂S']) expect(symbolFieldKind('FW Messpunkt', k), k).toBe('measured')
    expect(symbolFieldKind('FW Messpunkt', 'Raum')).toBeUndefined()
  })

  it('reads empty as null, a whole number as the number, anything else as free text', () => {
    expect(countFieldValue('')).toBeNull()
    expect(countFieldValue(' 3 ')).toBe(3)
    expect(countFieldValue('2 Katzen')).toBeUndefined()
    expect(countFieldValue('-1')).toBeUndefined()
  })
})
