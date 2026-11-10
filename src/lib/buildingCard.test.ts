import { describe, expect, it } from 'vitest'
import { buildingChipSummary, buildingChips, buildingSources, fmtDay, hasBuildingContent, noteLines, objectCaption, visitLine } from './buildingCard'
import type { BuildingInfo } from './api/building'

// What the Gebäude card draws (KP Front F5). Hazards first and always a WORD (the component adds
// the warn glyph to exactly these); nothing to say → nothing drawn.

const info = (over: Partial<BuildingInfo> = {}): BuildingInfo => ({
  registers: 'on',
  egid: '408319',
  address: 'Hauptstrasse 10, 4104 Oberwil',
  gwr: {
    stand: '2026-10-07', floors: 2, flats: 2, year: 1926, period: null, heating: ['gas'],
    heating_date: '2022-06-29', hot_water: ['gas'], shelter: null, status: null,
  },
  gwr_status: 'ok',
  plants: [{ kind: 'pv', label: 'Photovoltaik', power_kw: 35.64, since: '2024-09-30' }],
  pv_status: 'ok',
  registers_fetched_at: '2026-10-09T10:00:00+02:00',
  object: null,
  visit: null,
  ...over,
})
const gwr = info().gwr!

describe('buildingChips', () => {
  it('hazards first, each with its word', () => {
    const chips = buildingChips(info())
    expect(chips.map((c) => [c.text, c.hazard])).toEqual([
      ['Heizung Gas', true],
      ['PV 35.6 kW', true],
      ['2 Geschosse', false],
      ['2 Wohnungen', false],
      ['Baujahr 1926', false],
    ])
    expect(chips[1].title).toContain('seit 30.09.2024')
  })

  it('heating without fuel on site is a plain fact; a hidden gas boiler for the tap is a hazard', () => {
    const chips = buildingChips(info({ gwr: { ...gwr, heating: ['air'], hot_water: ['gas'] }, plants: [] }))
    expect(chips.filter((c) => c.hazard).map((c) => c.text)).toEqual(['Warmwasser Gas'])
    expect(chips.map((c) => c.text)).toContain('Heizung Wärmepumpe (Luft)')
  })

  it('period, shelter, status, singular forms, oil, and «unbestimmt» says nothing', () => {
    const chips = buildingChips(info({
      gwr: { ...gwr, year: null, period: '1919–1945', floors: 1, flats: 1, shelter: true, status: 'under_construction', heating: ['oil', 'unknown'], hot_water: [] },
      plants: [],
    }))
    expect(chips.map((c) => c.text)).toEqual(['Heizung Heizöl', 'im Bau', '1 Geschoss', '1 Wohnung', 'Bauperiode 1919–1945', 'Schutzraum'])
  })

  it('a failed or skipped source draws nothing of its own', () => {
    expect(buildingChips(info({ gwr_status: 'error', gwr: null, pv_status: 'error', plants: [] }))).toEqual([])
    expect(buildingChips(info({ pv_status: 'error' })).some((c) => c.key.startsWith('pv'))).toBe(false)
    expect(buildingChips(null)).toEqual([])
  })

  it('one PV tag per roof: two registrations add up, the earliest start is the «seit»', () => {
    const chips = buildingChips(info({ plants: [
      { kind: 'pv', label: 'Photovoltaik', power_kw: 331.87, since: '2024-06-21' },
      { kind: 'pv', label: 'Photovoltaik', power_kw: 256.8, since: '2014-06-10' },
    ] }))
    const pv = chips.filter((c) => c.key === 'pv')
    expect(pv.map((c) => c.text)).toEqual(['PV 589 kW'])
    expect(pv[0].title).toContain('seit 10.06.2014')
  })

  it('PV without a power reading still says PV; other plants by their register label', () => {
    const chips = buildingChips(info({ gwr: null, gwr_status: 'none', plants: [
      { kind: 'pv', label: null, power_kw: null, since: null },
      { kind: 'other', label: 'Biomasse', power_kw: 120, since: null },
    ] }))
    expect(chips.map((c) => [c.text, c.hazard])).toEqual([['PV', true], ['Biomasse 120 kW', false]])
  })
})

describe('Gebäudeklasse, Wärmeerzeuger, Wohnungen per Geschoss', () => {
  // Amselstrasse 30, Oberwil (EGID 409220) as the register answered on 20.10.2026
  const amsel = info({
    address: 'Amselstrasse 30, 4104 Oberwil',
    plants: [],
    gwr: {
      ...gwr, floors: 2, flats: 9, year: 1986, shelter: true, heating: ['gas'], hot_water: ['gas'],
      building_class: 'multi_family',
      heaters: [{ generator: 'boiler', energy: 'gas', shared: true }],
      water_heaters: [{ generator: 'boiler', energy: 'gas', shared: false }],
      flats_by_floor: [{ level: 0, flats: 3, maisonettes: 0 }, { level: 1, flats: 6, maisonettes: 6 }],
      rooms_min: 2, rooms_max: 4,
    },
  })

  it('the class leads, the generator stands next to the fuel, the flats fold into one line', () => {
    expect(buildingChips(amsel).map((c) => [c.text, c.hazard])).toEqual([
      ['Heizung Gas, Heizkessel für mehrere Gebäude', true],
      ['Mehrfamilienhaus', false],
      ['2 Geschosse', false],
      ['9 Wohnungen · EG 3 · 1. OG 6 (Maisonette) · 2–4 Zi.', false],
      ['Baujahr 1986', false],
      ['Schutzraum', false],
    ])
    // hot water from the same kind of gas boiler says nothing new
    expect(buildingChips(amsel).some((c) => c.key.startsWith('water'))).toBe(false)
    expect(buildingChipSummary(amsel)?.words).toEqual(['Gas'])
  })

  it('a second system and hot water that differs each get their chip; a heat pump is not said twice', () => {
    const chips = buildingChips(info({ plants: [], gwr: {
      ...gwr, heating: ['air', 'wood'], hot_water: ['electricity'],
      heaters: [{ generator: 'heat_pump', energy: 'air', shared: false }, { generator: 'stove', energy: 'wood', shared: false }],
      water_heaters: [{ generator: 'electric_boiler', energy: 'electricity', shared: false }],
    } }))
    expect(chips.filter((c) => c.key.startsWith('heat') || c.key.startsWith('water')).map((c) => c.text)).toEqual([
      'Heizung Wärmepumpe (Luft)', 'Heizung Holz, Ofen', 'Warmwasser Elektro, Elektroboiler',
    ])
  })

  it('mixed Maisonettes, a basement flat, and a house whose class already says its one flat', () => {
    const mixed = buildingChips(info({ plants: [], gwr: { ...gwr, flats: 4, flats_by_floor: [
      { level: -1, flats: 1, maisonettes: 0 }, { level: 2, flats: 3, maisonettes: 1 },
    ] } }))
    expect(mixed.find((c) => c.key === 'flats')?.text).toBe('4 Wohnungen · 1. UG 1 · 2. OG 3 (1 Maisonette)')
    const house = buildingChips(info({ plants: [], gwr: {
      ...gwr, flats: 1, building_class: 'single_family', rooms_min: 5, rooms_max: 5,
      flats_by_floor: [{ level: 0, flats: 1, maisonettes: 1 }],
    } }))
    expect(house.map((c) => c.text)).toContain('Einfamilienhaus')
    expect(house.find((c) => c.key === 'flats')?.text).toBe('5 Zi.')
  })
})

describe('sources, notes, object, visit', () => {
  it('every fact names its source and date', () => {
    expect(buildingSources(info())).toBe('GWR Hauptstrasse 10 · Stand 07.10.2026 · Heizung erfasst 29.06.2022 · BFE abgefragt 09.10.2026')
    expect(buildingSources(info({ address: null, plants: [] }))).toBe('GWR Stand 07.10.2026 · Heizung erfasst 29.06.2022')
  })

  it('a kept register half says when it was saved', () => {
    expect(buildingSources(info({ plants: [], gwr_kept_from: '2026-10-01T08:00:00Z' }))).toContain('gespeichert 01.10.2026')
  })

  it('notes split by line; the object is named, and «in der Nähe» when not the address', () => {
    expect(noteLines(' Gas zu \n\n Abwart rufen')).toEqual(['Gas zu', 'Abwart rufen'])
    const obj = { id: 'o', name: 'Schloss Musterdorf', address_match: true, distance_m: 4, measures: 'x', remarks: null, measures_source: 'Modul 1', updated_at: null }
    // owner, 27.10.2026: no source line for the object at this address – only a neighbour's is named
    expect(objectCaption(info({ object: obj }))).toBe('')
    expect(objectCaption(info({ object: { ...obj, address_match: false, distance_m: 118.4 } }))).toBe('Schloss Musterdorf · in der Nähe (118 m)')
  })

  it('the last visit, with its Mängel', () => {
    const v = (findings: number) => info({ visit: { id: 'ov', visited_at: '2026-05-12T09:00:00Z', findings } })
    expect(visitLine(v(0))).toBe('Letzter Objektbesuch 12.05.2026')
    expect(visitLine(v(1))).toBe('Letzter Objektbesuch 12.05.2026 · 1 Mangel')
    expect(visitLine(v(2))).toBe('Letzter Objektbesuch 12.05.2026 · 2 Mängel')
  })

  it('nothing to say → no card (no Objekt, no EGID, no register)', () => {
    const empty = info({ egid: null, address: null, gwr: null, gwr_status: 'none', plants: [], pv_status: 'skipped' })
    expect(hasBuildingContent(empty)).toBe(false)
    expect(hasBuildingContent(info({ ...empty, registers: 'outside_ch', gwr_status: 'skipped' }))).toBe(false)
    expect(hasBuildingContent(null)).toBe(false)
    const notesOnly = { ...empty, object: { id: 'o', name: 'X', address_match: true, distance_m: 0, measures: null, remarks: 'Brandlast', measures_source: null, updated_at: null } }
    expect(hasBuildingContent(notesOnly)).toBe(true)
  })

  it('fmtDay', () => {
    expect(fmtDay('2026-10-07')).toBe('07.10.2026')
    expect(fmtDay('nonsense')).toBe('')
    expect(fmtDay(null)).toBe('')
  })
})

describe('buildingChipSummary', () => {
  it('hazard words deduplicated in order — gas heating and gas hot water are one «Gas»', () => {
    expect(buildingChipSummary(info())).toMatchObject({ hazard: true, words: ['Gas', 'PV'], measures: 0 })
    expect(buildingChipSummary(info({ gwr: { ...gwr, heating: ['air'], hot_water: ['oil'] }, plants: [] }))?.words).toEqual(['Heizöl'])
  })

  it('no hazard → the plain label; nothing at all → no chip', () => {
    const calm = buildingChipSummary(info({ gwr: { ...gwr, heating: ['district'], hot_water: [] }, plants: [] }))
    expect(calm).toMatchObject({ hazard: false, words: [], label: 'Gebäude-Steckbrief öffnen' })
    expect(buildingChipSummary(info({ gwr: null, gwr_status: 'error', plants: [], pv_status: 'error' }))).toBeNull()
  })
})
