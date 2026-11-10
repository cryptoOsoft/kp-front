import { describe, expect, it } from 'vitest'
import { drawingEditChanges, drawingLogName, endingFlags, endingOf, endingWireFlags, pumpWarningRows, type LineEnding } from './drawingEdit'
import { fillTemplate } from './format'
import { RELAY } from './hydraulics'
import { replayEmits } from './replay.test-utils'
import type { Drawing } from '../types'
import { appConfig } from '../config/appConfig'

const line = (over: Partial<Drawing>): Drawing => ({
  id: 'd1', kind: 'line', coords: [[7.5, 47.4], [7.51, 47.41]], ...over,
})

// The same gap entityEditChanges closed for symbols: a Leitung's meaning-bearing attributes
// used to change the Kroki without a Verlauf row.
describe('drawingEditChanges (the Verlauf line for editing a drawing)', () => {
  it('names the Typ letter as the word it means', () => {
    expect(drawingEditChanges(line({}), line({ content: 'S' }))).toEqual(['Typ: Schaum'])
    expect(drawingEditChanges(line({ content: 'S' }), line({ content: 'H' }))).toEqual(['Typ auf Hydroschild geändert'])
  })

  it('unsetting the Typ is Wasser, not a cleared field', () => {
    expect(drawingEditChanges(line({ content: 'S' }), line({}))).toEqual(['Typ auf Wasser geändert'])
  })

  it('carries the Leitungs-Nummer — the identity the Atemschutzüberwachung reads', () => {
    expect(drawingEditChanges(line({}), line({ lineNo: 3 }))).toEqual(['Leitung Nr.: 3'])
    expect(drawingEditChanges(line({ lineNo: 3 }), line({}))).toEqual(['Leitung Nr. entfernt'])
  })

  it('names the Stockwerk the line works on, same wording as a symbol', () => {
    expect(drawingEditChanges(line({}), line({ floorTag: 2 }))).toEqual(['Geschoss 2. OG'])
    expect(drawingEditChanges(line({ floorTag: 2 }), line({ floorTag: 0 }))).toEqual(['Geschoss EG'])
    expect(drawingEditChanges(line({ floorTag: -1 }), line({}))).toEqual(['Geschoss entfernt'])
  })

  // ⚠️ 03.09. Rapport: «Pfeil: Abschluss: Pfeil». The caller writes «{name}: {changes}», and a
  // line whose Abschluss is an arrow IS called «Pfeil» — so naming the value spelled the row's
  // own name a second time. The value is the first word of the line; the change names the field.
  it('does not stutter when the value would repeat the drawing’s own name', () => {
    expect(drawingEditChanges(line({}), line({ arrow: true }))).toEqual(['Abschluss gesetzt'])
    // …and a CORRECTION says so, with the same word left out
    expect(drawingEditChanges(line({ teilstueck: true }), line({ arrow: true }))).toEqual(['Abschluss geändert'])
    // the value survives wherever it is not the name — «Linie: Abschluss auf Teilstück geändert»
    expect(drawingLogName(line({ teilstueck: true }))).not.toBe('Teilstück')
    expect(drawingEditChanges(line({ arrow: true }), line({ teilstueck: true })))
      .toEqual(['Abschluss auf Teilstück geändert'])
  })

  it('reports the Abschluss as one statement, whatever combination of flags carries it', () => {
    expect(drawingEditChanges(line({ arrow: true }), line({ arrow: true, arrowStop: true })))
      .toEqual(['Abschluss auf Pfeil mit Stopp geändert'])
    expect(drawingEditChanges(line({ arrow: true }), line({ teilstueck: true })))
      .toEqual(['Abschluss auf Teilstück geändert'])
    expect(drawingEditChanges(line({ arrow: true, arrowStop: true }), line({})))
      .toEqual(['Abschluss auf Keiner geändert'])
  })

  it('stays silent on styling and geometry — arranging the picture is not an event', () => {
    const prev = line({ color: '#f00', width: 4, dashed: false, label: 'alt' })
    const next = line({
      color: '#00f', width: 8, dashed: true, coords: [[7.6, 47.5]],
      // the label writes its OWN row (useMapDrawing · noteDrawingLabel) — no duplicate here
      label: 'neu', labelDx: 12, labelAt: [7.6, 47.5], endDx: 3, marker: 'R',
      showDistance: true, locked: true, fillOpacity: 0.5,
    })
    expect(drawingEditChanges(prev, next)).toEqual([])
  })

  it('names a new Schlauch, and stays quiet on the Wassertransport planning', () => {
    expect(drawingEditChanges(line({}), line({ hose: '110' }))).toEqual(['Schlauch: 110 mm'])
    expect(drawingEditChanges(line({ hose: '75' }), line({ hose: '2x75' }))).toEqual(['Schlauch auf 2× 75 geändert'])
    expect(drawingEditChanges(line({}), line({ relay: { flow: 1200, pumps: [{ atM: 100 }] } }))).toEqual([])
    // …but «Pumpen auf Karte» puts Motorspritzen on the Karte, or takes them off
    expect(drawingEditChanges(line({ relay: {} }), line({ relay: { showPumps: true } }))).toEqual([appConfig.copy.log.pumpsShown])
    expect(drawingEditChanges(line({ relay: { showPumps: true } }), line({ relay: { pumps: [{ atM: 9 }] } }))).toEqual([appConfig.copy.log.pumpsHidden])
  })

  it('an unchanged drawing produces no lines', () => {
    const d = line({ content: 'S', lineNo: 1, floorTag: 2, arrow: true })
    expect(drawingEditChanges(d, { ...d })).toEqual([])
  })
})

describe('drawingLogName', () => {
  it('prefers the label, else names the kind', () => {
    expect(drawingLogName(line({ label: 'Sammelplatz' }))).toBe('Sammelplatz')
    expect(drawingLogName(line({}))).toBe('Linie')
    expect(drawingLogName({ id: 'a1', kind: 'area', coords: [] })).toBe('Fläche')
    expect(drawingLogName({ id: 'c1', kind: 'circle', coords: [] })).toBe('Absperrkreis')
  })

  // An unlabelled line reports the preset it was drawn with, so «Rettungsachse gezeichnet» and
  // «Rettungsachse gelöscht» are the same object — before 31.08. both ends said «Zeichnung».
  it('names an unlabelled line by its preset', () => {
    expect(drawingLogName(line({ arrow: true }))).toBe('Pfeil')
    expect(drawingLogName(line({ arrow: true, marker: 'R' }))).toBe('Rettungsachse')
    expect(drawingLogName(line({ arrow: true, marker: 'R', dashed: false }))).toBe('Rettungsachse')
  })

  it('lets a typed label beat the preset', () => {
    expect(drawingLogName(line({ arrow: true, marker: 'R', label: 'Fluchtweg Ost' }))).toBe('Fluchtweg Ost')
  })
})

// The same field now also answers «welche Haltelinie» for a Vegetationsbrand — the letter is the
// kind of line, whether that is a Druckleitung's device or a Haltelinie's water state.
describe('drawingEditChanges — the Vegetationsbrand letters', () => {
  it('names N / T / G the way it names S / H / P', () => {
    expect(drawingEditChanges(line({}), line({ content: 'N' }))).toEqual(['Typ: Nasse Haltelinie'])
    expect(drawingEditChanges(line({ content: 'N' }), line({ content: 'G' }))).toEqual(['Typ auf Gegenfeuer geändert'])
  })
})

// The two fields that make a drawn Sektor an Abschnitt (FKS Einsatzführung 3.5.2) — who led
// which Abschnitt with what Auftrag is exactly what the Rapport is later read for.
describe('Abschnitt fields on a Fläche', () => {
  const area = (over: Partial<Drawing>): Drawing => ({
    id: 'a1', kind: 'area', coords: [[7.5, 47.4], [7.51, 47.41], [7.51, 47.4]], ...over,
  })

  it('records Abschnittschef set / changed / cleared', () => {
    expect(drawingEditChanges(area({}), area({ abschnittLeiter: 'Oblt Steiner' }))).toEqual(['Abschnittschef: Oblt Steiner'])
    expect(drawingEditChanges(area({ abschnittLeiter: 'Oblt Steiner' }), area({ abschnittLeiter: 'Lt Hofer' }))).toEqual(['Abschnittschef auf Lt Hofer geändert'])
    expect(drawingEditChanges(area({ abschnittLeiter: 'Lt Hofer' }), area({}))).toEqual(['Abschnittschef entfernt'])
  })

  it('records the Auftrag the same way', () => {
    expect(drawingEditChanges(area({}), area({ abschnittAuftrag: 'Brandbekämpfung Trakt B' }))).toEqual(['Auftrag: Brandbekämpfung Trakt B'])
    expect(drawingEditChanges(area({ abschnittAuftrag: 'Brandbekämpfung' }), area({ abschnittAuftrag: 'Wasserversorgung' }))).toEqual(['Auftrag auf Wasserversorgung geändert'])
    expect(drawingEditChanges(area({ abschnittAuftrag: 'x' }), area({}))).toEqual(['Auftrag entfernt'])
  })
})

// The Abschluss as the audit stream carries it (IncidentWorkspace · changeMapEnding): whatever the
// line ended in before, the replayed line ends in the chosen Abschluss — «Pfeil + Stopp» included,
// and a flag switched OFF stays off (JSON drops an `undefined`).
describe('endingWireFlags — the Abschluss in replay', () => {
  const endings: LineEnding[] = ['none', 'arrow', 'arrowStop', 'teilstueck']
  it.each(endings.flatMap((from) => endings.map((to) => [from, to] as const)))('%s → %s', async (from, to) => {
    const drawings = [{ id: 'd', kind: 'line', coords: [[7, 47], [8, 48]], ...endingFlags(from) } as Drawing]
    const replayed = await replayEmits({ drawings }, [['draw.edit', { id: 'd', patch: endingWireFlags(to) }]])
    expect(endingOf(replayed.drawings[0])).toBe(to)
  })
})

// Manuel 09.11.2026: the Rapport named «Pumpen auf der Karte», never the warning under the chart.
// ~1.3 km, 75 mm at 800 l/min from a hydrant, flat: the water reaches 2 bar at ~400 m, so a pump
// pinned at 500 m gets about 1 bar.
describe('pumpWarningRows (a pump warning, as it appears)', () => {
  const low = (atM = 500) => line({ relay: { pumps: [{ atM }] } })
  const row = fillTemplate(appConfig.copy.log.pumpLowInlet, { n: 1, min: RELAY.minInletBar })

  it('writes the warning the edit brings, in the drawing edit row', () => {
    expect(pumpWarningRows(line({ relay: {} }), low())).toEqual([row])
    expect(drawingEditChanges(line({ relay: {} }), low())).toEqual([row])
  })

  it('stays quiet while the same warning stands through later edits, or goes away', () => {
    expect(pumpWarningRows(low(500), low(520))).toEqual([])
    expect(pumpWarningRows(low(), line({ relay: {} }))).toEqual([])
  })

  it('names what a Leitung adopted from Messen arrives with', () => {
    expect(pumpWarningRows(null, low())).toEqual([row])
  })

  it('compares nothing across a moved path (the profile would be the old one\'s)', () => {
    expect(pumpWarningRows(line({ relay: {} }), { ...low(), coords: [[7.5, 47.4], [7.52, 47.41]] })).toEqual([])
  })
})
