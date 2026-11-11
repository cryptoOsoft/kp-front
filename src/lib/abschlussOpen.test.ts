import { describe, it, expect, vi } from 'vitest'
import { abschlussEndeItem, abschlussOpenItems, abschlussOpenLabel, abschlussOpenPoints, abschlussSheet, controlChipLabel, countsAsOpen, insideAbschlussSpec, registeredAbschlussMessage } from './abschlussOpen'
import type { Trupp } from '../types'
import { ABSCHLUSS_STEPS } from './abschluss'
import { appConfig } from '../config/appConfig'

/**
 * «Einsatz abschliessen» named its offene Punkte and then left the operator to find them — the
 * print warning beside it had been offering the same list as links for weeks (18.09.2026). What
 * is pinned here is that EVERY kind of open point has a target, because a row that looks like a
 * link and goes nowhere is worse than the plain text it replaced.
 */
describe('abschlussOpenPoints', () => {
  it('lists the Mindestangaben first, then the Trupps, then the queue', () => {
    expect(abschlussOpenPoints(['zeiten', 'kurzbericht'], 2, 3)).toEqual([
      { kind: 'step', step: 'zeiten' },
      { kind: 'step', step: 'kurzbericht' },
      { kind: 'trupps', n: 2 },
      { kind: 'media', n: 3 },
    ])
  })
  it('says nothing about a Trupp that came back or a queue that is empty', () => {
    expect(abschlussOpenPoints([], 0, 0)).toEqual([])
  })
})

describe('what makes the Abschluss a «trotzdem»', () => {
  it('counts every missing Angabe and every Trupp still out — but not a pending upload', () => {
    expect(countsAsOpen({ kind: 'step', step: 'zeiten' })).toBe(true)
    expect(countsAsOpen({ kind: 'trupps', n: 1 })).toBe(true)
    // the Abschluss drains the queue itself; it is a fact about this device, not a gap
    expect(countsAsOpen({ kind: 'media', n: 4 })).toBe(false)
  })
})

describe('every open point is a link', () => {
  it('gives each of the eight Mindestangaben its own named row and target', () => {
    const go = { step: vi.fn(), trupps: vi.fn(), media: vi.fn() }
    const items = abschlussOpenItems(abschlussOpenPoints([...ABSCHLUSS_STEPS], 0, 0), go)
    expect(items).toHaveLength(ABSCHLUSS_STEPS.length)
    items.forEach((it, i) => {
      expect(it.label).toBe(appConfig.copy.abschluss.steps[ABSCHLUSS_STEPS[i]])
      expect(it.label.trim()).not.toBe('')
      it.onClick()
      expect(go.step).toHaveBeenLastCalledWith(ABSCHLUSS_STEPS[i])
    })
    expect(go.trupps).not.toHaveBeenCalled()
    expect(go.media).not.toHaveBeenCalled()
  })

  it('sends a Trupp still out to the Tafel and a queued capture to the Bereitschaft', () => {
    const go = { step: vi.fn(), trupps: vi.fn(), media: vi.fn() }
    const items = abschlussOpenItems(abschlussOpenPoints([], 2, 3), go)
    expect(items.map((i) => i.label)).toEqual([
      abschlussOpenLabel({ kind: 'trupps', n: 2 }),
      abschlussOpenLabel({ kind: 'media', n: 3 }),
    ])
    items[0].onClick()
    expect(go.trupps).toHaveBeenCalledTimes(1)
    items[1].onClick()
    expect(go.media).toHaveBeenCalledTimes(1)
  })

  it('names the counts, so a row reads as the fact it is', () => {
    expect(abschlussOpenLabel({ kind: 'trupps', n: 2 })).toContain('2')
    expect(abschlussOpenLabel({ kind: 'media', n: 3 })).toContain('3')
    expect(abschlussOpenLabel({ kind: 'trupps', n: 2 })).not.toContain('{n}')
    expect(abschlussOpenLabel({ kind: 'media', n: 3 })).not.toContain('{n}')
  })
})

describe('controlChipLabel — the Rapport head\'s one Kontrolle chip', () => {
  it('counts the open steps and the warnings each in its own words', () => {
    expect(controlChipLabel(4, 0)).toBe('4 offen')
    expect(controlChipLabel(0, 1)).toBe('1 Hinweis')
    expect(controlChipLabel(0, 3)).toBe('3 Hinweise')
    expect(controlChipLabel(4, 2)).toBe('4 offen · 2 Hinweise')
    expect(controlChipLabel(1, 1)).toBe('1 offen · 1 Hinweis')
  })
})

describe('registeredAbschlussMessage — who is still angemeldet', () => {
  const t = (over: Partial<Trupp>): Trupp => ({
    id: 'x', name: 'Muster Leo', entryPressureBar: 300, entryTime: '', lastContactTime: '', status: 'angemeldet', ...over,
  })

  it('names one Trupp by number and Gruppenführer, and says it is the Sicherungstrupp', () => {
    expect(registeredAbschlussMessage([t({ no: 6, auftrag: 'sichern' })]))
      .toBe('1 Trupp noch angemeldet (#6 Muster Leo, Sicherungstrupp).')
  })

  it('counts several, and leaves out a number the record does not have', () => {
    expect(registeredAbschlussMessage([t({ no: 6, auftrag: 'sichern' }), t({ id: 'y', name: 'Meier', auftrag: 'loeschen' })]))
      .toBe('2 Trupps noch angemeldet (#6 Muster Leo, Sicherungstrupp · Meier).')
  })
})

describe('insideAbschlussSpec — the crews still inside, one line each', () => {
  const t = (over: Partial<Trupp>): Trupp => ({
    id: 'x', name: 'Muster Leo', entryPressureBar: 300, entryTime: '2026-09-25T10:00:00Z', lastContactTime: '', status: 'aktiv', ...over,
  })
  it('names each Trupp by its number, then its whole crew', () => {
    expect(insideAbschlussSpec([t({ no: 1, members: ['Graf Eva'] })]))
      .toEqual({ message: '1 Trupp ist noch drin:', items: [{ head: 'Trupp 1', text: 'Muster Leo / Graf Eva' }] })
    expect(insideAbschlussSpec([t({ no: 1 }), t({ id: 'y', name: 'Frei Nora' })]))
      .toEqual({ message: '2 Trupps sind noch drin:', items: [{ head: 'Trupp 1', text: 'Muster Leo' }, { head: undefined, text: 'Frei Nora' }] })
  })
})

describe('abschlussEndeItem — the Einsatzende pre-filled with «jetzt»', () => {
  it('shows the clock as already set; a tap on the row changes it', () => {
    const change = vi.fn()
    const d = new Date(2026, 9, 23, 23, 41)
    const row = abschlussEndeItem(d.toISOString(), change)
    expect(row).toMatchObject({ label: appConfig.copy.abschluss.ende, done: true, end: 'jetzt 23:41' })
    row.onClick()
    expect(change).toHaveBeenCalledTimes(1)
  })
})

/* ONE list for both confirms (31.10.2026); since 11.11.2026 a row only opens its field. */
describe('abschlussSheet — the open points both confirms show', () => {
  it('a pre-filled row stands in its step\'s place and counts as answered; a Trupp out stays open', () => {
    const go = { step: vi.fn(), trupps: vi.fn(), media: vi.fn() }
    const ende = abschlussEndeItem('2026-10-31T21:41:00.000Z', vi.fn())
    const sheet = abschlussSheet(abschlussOpenPoints(['zeiten'], 0, 2), go, { zeiten: ende })
    expect(sheet.items.map((i) => i.label)).toEqual([appConfig.copy.abschluss.ende, abschlussOpenLabel({ kind: 'media', n: 2 })])
    expect(sheet.items[0]).toBe(ende)
    // only the queue is left, and a queue is not a «trotzdem» … a crew nobody reported out is
    expect(sheet.anyOpen).toBe(false)
    expect(abschlussSheet(abschlussOpenPoints([], 1, 0), go).anyOpen).toBe(true)
  })
})
