import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createEditSettle, entityEditChanges, entityLogName, rosterFieldsToRefile } from './entityEdit'
import type { Entity } from '../types'

const sym = (over: Partial<Entity>): Entity => ({
  id: 'e1', kind: 'symbol', layer: 'taktisch', coord: [7.5, 47.4], symbol: 'Einsatzleiter', ...over,
})

// The Kroki is the picture the Einsatz is led from. It used to earn a Verlauf row when a symbol
// appeared and when it went, and nothing for the two hours in between during which it changed.
describe('entityEditChanges (the Verlauf line for editing the Kroki)', () => {
  it('names the field AND the value that was typed into it', () => {
    const prev = sym({ fields: {} })
    expect(entityEditChanges(prev, sym({ fields: { Name: 'Widmer Céline' } })))
      .toEqual(['Name: Widmer Céline'])
  })

  it('says a field was CHANGED when it already said something else', () => {
    const prev = sym({ fields: { Name: 'Meier Hans' } })
    expect(entityEditChanges(prev, sym({ fields: { Name: 'Widmer Céline' } })))
      .toEqual(['Name auf Widmer Céline geändert'])
  })

  it('reports a cleared field as cleared, not as an empty value', () => {
    const prev = sym({ fields: { Name: 'Meier Hans' } })
    expect(entityEditChanges(prev, sym({ fields: { Name: '  ' } }))).toEqual(['Name entfernt'])
  })

  it('names the Stockwerk it turned out to be on', () => {
    expect(entityEditChanges(sym({}), sym({ floor: 2 }))).toEqual(['Geschoss 2. OG'])
    expect(entityEditChanges(sym({ floor: 2 }), sym({}))).toEqual(['Geschoss entfernt'])
  })

  it('carries a Stockwerk range — what a Treppe or a Lift covers', () => {
    expect(entityEditChanges(sym({}), sym({ floorFrom: -1, floorTo: 3 })))
      .toEqual(['Geschosse 1. UG – 3. OG'])
  })

  it('counts, and treats an absent count as one', () => {
    expect(entityEditChanges(sym({}), sym({ count: 3 }))).toEqual(['Anzahl 3'])
    expect(entityEditChanges(sym({ count: 1 }), sym({}))).toEqual([])
  })

  // Reversed 11.08.: the note is QUOTED. It used to say only that one had been written, which on
  // a printed Rapport — where the Kroki cannot be clicked — is a row pointing at nothing.
  it('quotes a Notiz written on a symbol', () => {
    expect(entityEditChanges(sym({}), sym({ notes: 'Gasgeruch im Treppenhaus' })))
      .toEqual(['Notiz «Gasgeruch im Treppenhaus»'])
  })

  it('folds a multi-line note onto one row', () => {
    expect(entityEditChanges(sym({}), sym({ notes: ' Keller\n  verraucht \n' })))
      .toEqual(['Notiz «Keller verraucht»'])
  })

  it('says a note was emptied without quoting the emptiness', () => {
    expect(entityEditChanges(sym({ notes: 'alt' }), sym({ notes: '  ' }))).toEqual(['Notiz entfernt'])
  })

  // A Notiz box keeps its TEXT in `label`, so it must not be announced as a «Beschriftung».
  it('calls a Notiz box’s text a Notiz, not a Beschriftung', () => {
    const note = (over: Partial<Entity>): Entity =>
      ({ ...sym({}), kind: 'note', ...over })
    expect(entityEditChanges(note({}), note({ label: 'Sammelplatz Ost' })))
      .toEqual(['Notiz «Sammelplatz Ost»'])
  })

  it('stays silent on pure geometry — arranging the picture is not an event', () => {
    const prev = sym({ coord: [7.5, 47.4], rotation: 0 })
    expect(entityEditChanges(prev, sym({ coord: [7.6, 47.5], rotation: 90, sizeM: 2 }))).toEqual([])
  })

  it('collects several edits into one line, in the order they are read', () => {
    const prev = sym({ fields: {} })
    expect(entityEditChanges(prev, sym({ fields: { Name: 'Widmer Céline' }, floor: 2, count: 3 })))
      .toEqual(['Name: Widmer Céline', 'Geschoss 2. OG', 'Anzahl 3'])
  })

  // ⚠️ The caller wraps these lines in «{name}: {changes}», so a field named after the symbol it
  // sits on said the word twice: «FW Gefahr allgemein» is labelled «Gefahr» and its one preset
  // field is «Gefahr» too, and the record read «Gefahr: Gefahr: Wassertiefe 10m».
  it('does not repeat a field name that IS the object’s own name', () => {
    const gefahr = (over: Partial<Entity>): Entity =>
      sym({ symbol: 'FW Gefahr allgemein', label: 'Gefahr', ...over })
    expect(entityEditChanges(gefahr({ fields: { Gefahr: '' } }), gefahr({ fields: { Gefahr: 'Wassertiefe 10m' } })))
      .toEqual(['Wassertiefe 10m'])
    // …and the other two statements keep their verb, minus the doubled word
    expect(entityEditChanges(gefahr({ fields: { Gefahr: 'Einsturz' } }), gefahr({ fields: { Gefahr: 'Wassertiefe 10m' } })))
      .toEqual(['auf Wassertiefe 10m geändert'])
    expect(entityEditChanges(gefahr({ fields: { Gefahr: 'Einsturz' } }), gefahr({ fields: { Gefahr: '' } })))
      .toEqual(['entfernt'])
  })

  it('matches the name case-insensitively and untrimmed, and leaves other fields named', () => {
    const g = (over: Partial<Entity>): Entity => sym({ label: '  gefahr ', ...over })
    expect(entityEditChanges(g({ fields: { 'Gefahr': '' } }), g({ fields: { 'Gefahr': 'Einsturz' } })))
      .toEqual(['Einsturz'])
    // a second field on the same symbol is NOT the name and keeps saying which field it is
    expect(entityEditChanges(g({ fields: { Stoff: '' } }), g({ fields: { Stoff: 'Diesel' } })))
      .toEqual(['Stoff: Diesel'])
  })

  it('calls the symbol by its label, falling back to the symbol name', () => {
    expect(entityLogName(sym({ label: 'EL Widmer' }))).toBe('EL Widmer')
    expect(entityLogName(sym({ label: '  ' }))).toBe('Einsatzleiter')
  })
})

// Filing a name against the Anwesenheit marks somebody present and writes their Funktion — one
// Verlauf row each. So this has to answer «what actually moved» and nothing more.
describe('rosterFieldsToRefile (which names reach the Anwesenheit)', () => {
  const ROSTER = ['Name', 'Stv.', 'Fahrer']
  const refile = (
    before: Record<string, string> | undefined,
    fields: Record<string, string>,
    opts?: { force?: boolean },
  ) => rosterFieldsToRefile(before, fields, ROSTER, opts).map((f) => f.key)

  it('takes the field somebody typed into, and leaves the rest alone', () => {
    expect(refile({ 'Name': 'Widmer Céline' }, { 'Name': 'Widmer Céline', 'Stv.': 'Eichenberger Bastian' }))
      .toEqual(['Stv.'])
  })

  // ⚠️ 03.09.: naming the Einsatzleiter at 08:10 re-filed — and re-logged — the Stv. set at
  // 08:01. The panel seeds every preset field as a row and commits the whole record, so a
  // «Funktion» the symbol had never carried arrived as `''`; against a missing key that read as
  // a changed field, and a changed non-roster field re-files EVERY name on the symbol.
  it('⚠️ does not read a seeded blank as a field that moved', () => {
    expect(refile({ 'Name': 'Widmer Céline' }, { 'Name': 'Widmer Céline', 'Funktion': '' })).toEqual([])
    expect(refile(undefined, { 'Name': '' })).toEqual([])
  })

  it('skips a field that was emptied — there is no name left to file', () => {
    expect(refile({ 'Stv.': 'Eichenberger Bastian' }, { 'Stv.': '' })).toEqual([])
  })

  // …the deliberate half: the Bemerkung is built from the symbol and its other fields («Fahrer
  // TLF»), so when one of THOSE moves, the unchanged name beside it has to be filed again.
  it('re-files every name when the job around it changed, or the symbol was renamed', () => {
    expect(refile({ 'Fahrer': 'Meier Anna', 'Funktion': 'SiBe' }, { 'Fahrer': 'Meier Anna', 'Funktion': 'AS' }))
      .toEqual(['Fahrer'])
    expect(refile({ 'Fahrer': 'Meier Anna' }, { 'Fahrer': 'Meier Anna' }, { force: true })).toEqual(['Fahrer'])
  })

  it('leaves the Fahrer alone when only the Herkunft changed – no Bemerkung reads it', () => {
    expect(refile({ 'Fahrer': 'Meier Anna', 'Herkunft': '' }, { 'Fahrer': 'Meier Anna', 'Herkunft': 'Stützpunkt' })).toEqual([])
  })
})

// ⚠️ 03.09. Rapport: one Notiz reached the journal as three rows — «Notiz «1 Roller in en»»,
// «…in ennen», «…innen» — because a plain 4 s settle reads every pause as «the edit is over»,
// and a sentence typed on a tablet is nothing but pauses.
describe('createEditSettle (one row per edit, not per pause)', () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => vi.useRealTimers())

  const settle = (typing: () => boolean) => {
    const rows: { id: string; base: string; latest: string }[] = []
    const w = createEditSettle<string>({
      ms: 4000,
      stillEditing: typing,
      onSettled: (id, base, latest) => rows.push({ id, base, latest }),
    })
    return { w, rows }
  }

  it('writes ONE row from the state the edit started in to the freshest one', () => {
    const { w, rows } = settle(() => false)
    w.push('e1', 'leer', 'in en')
    vi.advanceTimersByTime(3000)
    w.push('e1', 'in en', 'in ennen')
    vi.advanceTimersByTime(4000)
    expect(rows).toEqual([{ id: 'e1', base: 'leer', latest: 'in ennen' }])
  })

  it('⚠️ waits while the sentence is still being written, however long the pauses are', () => {
    let typing = true
    const { w, rows } = settle(() => typing)
    w.push('e1', 'leer', 'in en')
    vi.advanceTimersByTime(60_000)   // several settle windows' worth of pauses
    expect(rows).toEqual([])
    w.push('e1', 'in ennen', 'innen')
    typing = false                    // the caret leaves the field
    vi.advanceTimersByTime(4000)
    expect(rows).toEqual([{ id: 'e1', base: 'leer', latest: 'innen' }])
  })

  it('keeps two objects edited in the same window apart', () => {
    const { w, rows } = settle(() => false)
    w.push('e1', 'a', 'a1')
    w.push('e2', 'b', 'b1')
    vi.advanceTimersByTime(4000)
    expect(rows.map((r) => r.id).sort()).toEqual(['e1', 'e2'])
  })
})
