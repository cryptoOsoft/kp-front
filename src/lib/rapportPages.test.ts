import { describe, it, expect } from 'vitest'
import {
  RAPPORT_PAGES, initialRapportPage, isRapportPage, readRapportPage, writeRapportPage,
} from './rapportPages'

/** a sessionStorage stand-in — the app's own store is not available in the node environment */
function store() {
  const map = new Map<string, string>()
  return {
    getItem: (k: string) => map.get(k) ?? null,
    setItem: (k: string, v: string) => { map.set(k, v) },
  }
}

describe('the Rapport group', () => {
  // ⚠️ The Rapport leads: it is the page the bar's tile is named after, and it is the stable
  // anchor — from any of the three, «Rapport» is in the same place.
  it('is Rapport · Anwesenheit · Material, in that order', () =>
    expect(RAPPORT_PAGES).toEqual(['rapport', 'anwesenheit', 'mittel']))

  it('recognises its three modes and nothing else', () => {
    expect(RAPPORT_PAGES.every(isRapportPage)).toBe(true)
    for (const m of ['map', 'plans', 'checklists', 'atemschutz', '']) expect(isRapportPage(m)).toBe(false)
  })
})

describe('the last page used — per incident, per device', () => {
  it('reads back what was written', () => {
    const s = store()
    writeRapportPage('i1', 'mittel', s)
    expect(readRapportPage('i1', s)).toBe('mittel')
  })

  // The stamp is part of the record: a page left at last week's Übung must not decide where
  // tonight's alarm opens.
  it('is null for a different Einsatz', () => {
    const s = store()
    writeRapportPage('i1', 'mittel', s)
    expect(readRapportPage('i2', s)).toBeNull()
  })

  it('is null with nothing written at all', () => expect(readRapportPage('i1', store())).toBeNull())

  // a box written by an older build (it held a Rapport TAB until 18.09.2026), or hand-edited,
  // must not select a mode that is not one of the three
  it('refuses a value that is not one of the three pages', () => {
    const s = store()
    s.setItem('kp-front-rapport-page', JSON.stringify({ incidentId: 'i1', page: 'beilagen' }))
    expect(readRapportPage('i1', s)).toBeNull()
  })

  it('survives a box that is not JSON at all', () => {
    const s = store()
    s.setItem('kp-front-rapport-page', 'not json')
    expect(readRapportPage('i1', s)).toBeNull()
  })
})

describe('initialRapportPage — where the bar\'s «Rapport» tile goes', () => {
  const opts = { incidentId: 'i1', presentCount: 0 }

  // ⚠️ Nobody marked present yet = the crew is arriving and the rapport has nothing in it to
  // read, so the arrival minutes are the only thing anybody opens this group for.
  it('opens the Anwesenheit while nobody is marked present', () =>
    expect(initialRapportPage({ ...opts, store: store() })).toBe('anwesenheit'))

  it('opens the Rapport itself once somebody is on scene', () =>
    expect(initialRapportPage({ ...opts, presentCount: 3, store: store() })).toBe('rapport'))

  // The Appell is «tile → correct a name → away → tile», several times over.
  it('prefers the page this Einsatz was last left on', () => {
    const s = store()
    writeRapportPage('i1', 'mittel', s)
    expect(initialRapportPage({ ...opts, presentCount: 3, store: s })).toBe('mittel')
  })

  it('…even when that page is the one the default would have picked anyway', () => {
    const s = store()
    writeRapportPage('i1', 'rapport', s)
    expect(initialRapportPage({ ...opts, store: s })).toBe('rapport')
  })

  // the `el` role and a closed Einsatz (EL phone sweep B3): the tile opens what its badge counts
  it('opens the Rapport whatever was remembered, where the Rapport comes first', () => {
    const s = store()
    writeRapportPage('i1', 'anwesenheit', s)
    expect(initialRapportPage({ ...opts, rapportFirst: true, store: s })).toBe('rapport')
  })

  it('does not take another Einsatz\'s page', () => {
    const s = store()
    writeRapportPage('i-other', 'mittel', s)
    expect(initialRapportPage({ ...opts, presentCount: 3, store: s })).toBe('rapport')
  })
})
