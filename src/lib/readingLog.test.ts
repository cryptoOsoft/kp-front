import { describe, expect, it } from 'vitest'
import { isReadingRow, readingAct, readingLimitsText, readingsForReport, READING_ICON } from './readingLog'
import { journalRows } from './report'
import { GEBAEUDE_PLAN_ID } from './whiteboard'
import { formatTime } from './format'
import type { BoardAnno, Entity, Reading, TimelineEvent } from '../types'

const MIN = 60_000
const mp = (fields: Record<string, string>, readings?: Reading[]) => ({ symbol: 'FW Messpunkt', label: 'Messpunkt', fields, readings })

describe('readingAct — a Messpunkt reading and its Verlauf row (owner pick 2A)', () => {
  it('the first value: the point, its storey, the gas with unit – and the stage it reached', () => {
    const act = readingAct(mp({ Raum: 'Keller Heizraum' }), { Raum: 'Keller Heizraum', CO: '180' }, { now: 5, place: 'UG' })
    expect(act).toEqual({
      readings: [{ t: 5, v: { CO: '180' } }],
      text: 'Messung Keller Heizraum (UG): CO 180 ppm – A2 Hauptalarm erreicht',
    })
  })

  it('names only the gases this commit changed – a report typed gas by gas is three short rows', () => {
    const p = mp({ Raum: 'Gang', CO: '12' }, [{ t: 1, v: { CO: '12' } }])
    expect(readingAct(p, { Raum: 'Gang', CO: '12', 'O₂': '20,9' }, { now: 2, place: '' })?.text)
      .toBe('Messung Gang: O₂ 20,9 Vol-%')
  })

  it('words a crossing as one, up and down, and a stage that merely holds as the stage', () => {
    const at = (prev: string, next: string) =>
      readingAct(mp({ CO: prev }, [{ t: 1, v: { CO: prev } }]), { CO: next }, { now: 2, place: '' })?.text
    expect(at('12', '35')).toBe('Messung Messpunkt: CO 35 ppm – A1 Voralarm erreicht')
    expect(at('35', '95')).toBe('Messung Messpunkt: CO 95 ppm – A2 Hauptalarm erreicht')
    expect(at('95', '180')).toBe('Messung Messpunkt: CO 180 ppm – A2 Hauptalarm')
    expect(at('95', '42')).toBe('Messung Messpunkt: CO 42 ppm – zurück auf A1 Voralarm')
    expect(at('42', '8')).toBe('Messung Messpunkt: CO 8 ppm – wieder im Normalbereich')
    expect(at('8', '0')).toBe('Messung Messpunkt: CO 0 ppm')
  })

  it('records over range as the Hauptalarm and an unreadable older value as unreadable', () => {
    const at = (prev: string, next: string) =>
      readingAct(mp({ CO: prev }, [{ t: 1, v: { CO: prev } }]), { CO: next }, { now: 2, place: '' })?.text
    expect(at('95', '>100')).toBe('Messung Messpunkt: CO >100 ppm – über Messbereich, A2 Hauptalarm')
    expect(at('12', '>')).toBe('Messung Messpunkt: CO > – über Messbereich, A2 Hauptalarm erreicht')
    expect(at('12', 'ca. 60')).toBe('Messung Messpunkt: CO ca. 60 – unlesbar')
  })

  it('«Gleich gemessen» appends the values as they stand and says so, every gas named', () => {
    const p = mp({ Raum: 'Wohnung', CO: '0', 'O₂': '20,9' }, [{ t: 1, v: { CO: '0', 'O₂': '20,9' } }])
    expect(readingAct(p, p.fields, { now: 20 * MIN, place: '1. OG', again: true })).toEqual({
      readings: [{ t: 1, v: { CO: '0', 'O₂': '20,9' } }, { t: 20 * MIN, v: { CO: '0', 'O₂': '20,9' } }],
      text: 'Messung Wohnung (1. OG): CO 0 ppm · O₂ 20,9 Vol-% – gleich gemessen',
    })
  })

  it('is nothing when no measured value changed, and for a symbol that measures nothing', () => {
    const p = mp({ Raum: 'Gang', CO: '12' }, [{ t: 1, v: { CO: '12' } }])
    expect(readingAct(p, { Raum: 'Gang Nord', CO: '12' }, { now: 2, place: '' })).toBeNull()
    expect(readingAct({ symbol: 'VKF Feuer', fields: {} }, { Typ: 'x' }, { now: 2, place: '', again: true })).toBeNull()
  })
})

describe('reading rows on paper – in the «Messungen» table only', () => {
  const row = (id: string, text: string, extra: Partial<TimelineEvent>): TimelineEvent =>
    ({ id, t: '18:02', at: '2026-11-09T17:02:00.000Z', icon: 'pen', text, kind: 'symbol', ...extra })

  it('the Einsatzjournal leaves out a reading and the ↶ / ↷ of one', () => {
    const events = [
      row('m', 'Messung Keller (UG): CO 180 ppm – A2 Hauptalarm erreicht', { icon: READING_ICON }),
      row('mU', 'Messung Keller (UG): CO 180 ppm – A2 Hauptalarm erreicht rückgängig gemacht', { icon: 'undo', kind: 'history' }),
      row('f', 'Symbol «Feuer» gesetzt', { icon: 'hex' }),
      row('j', 'Messung im Keller angeordnet', { icon: 'pen', kind: 'journal' }),
    ]
    expect(events.map(isReadingRow)).toEqual([true, true, false, false])
    expect(journalRows(events, []).map((r) => r.id)).toEqual(['f', 'j'])
  })

  const reading = (min: number, v: Record<string, string>): Reading => ({ t: Date.UTC(2026, 10, 9, 17, min), v })
  const point = (id: string, extra: Partial<Entity>): Entity =>
    ({ id, kind: 'symbol', layer: 'tactical', symbol: 'FW Messpunkt', label: 'Messpunkt', coord: [7.5, 47.5], ...extra })

  it('one block per Messpunkt: worst first by its last reading, the history oldest first', () => {
    const keller = point('k', {
      floorFrom: -1, fields: { Raum: 'Keller Heizraum', CO: '0', 'O₂': '20,4' },
      readings: [reading(2, { CO: '180', 'O₂': '20,4' }), reading(38, { CO: '42', 'O₂': '20,4' }), reading(64, { CO: '0', 'O₂': '20,4' })],
    })
    const garage = point('g', { fields: { Raum: 'Garage', Ex: '>100' }, readings: [reading(10, { Ex: '>100' })] })
    const empty = point('e', { fields: { Raum: 'Dach' } })
    const { points, limits } = readingsForReport([keller, empty, garage], {})
    expect(points.map((p) => [p.name, p.place])).toEqual([['Garage', ''], ['Keller Heizraum', '1. UG']])
    expect(points[0].rows).toEqual([{ time: formatTime(new Date(reading(10, {}).t)), gas: 'Ex', value: '>100 %UEG', stage: 'over', others: '' }])
    expect(points[1].rows.map((r) => [r.gas, r.value, r.stage, r.others])).toEqual([
      ['CO', '180 ppm', 'a2', 'O₂ 20,4 Vol-%'],
      ['CO', '42 ppm', 'a1', 'O₂ 20,4 Vol-%'],
      ['CO', '0 ppm', 'ok', 'O₂ 20,4 Vol-%'],
    ])
    expect(limits).toBe(readingLimitsText('FW Messpunkt'))
    expect(limits).toContain('CO A1 ab 30 ppm, A2 ab 60 ppm')
    expect(limits).toContain('O₂ A1 unter 19 Vol-%, A2 unter 17 oder ab 23 Vol-%')
  })

  it('a point drawn on the Karte AND on the Gebäude is one block, with the Gebäude\'s Geschoss', () => {
    const readings = [reading(5, { CO: '65' })]
    const onMap = point('p', { fields: { Raum: 'Treppenhaus', CO: '65' }, readings })
    const onStack = { id: 'p', kind: 'symbol', symbol: 'FW Messpunkt', x: 0.5, y: 0.5, floor: 1, fields: { Raum: 'Treppenhaus', CO: '65' }, readings } as BoardAnno
    const { points } = readingsForReport([onMap], { [GEBAEUDE_PLAN_ID]: [onStack] })
    expect(points.map((p) => [p.name, p.place, p.rows.length])).toEqual([['Treppenhaus', '1. OG', 1]])
  })

  it('no reading anywhere: no points, no limits line', () => {
    expect(readingsForReport([point('e', { fields: { Raum: 'Dach' } })], {})).toEqual({ points: [], limits: '' })
  })
})
