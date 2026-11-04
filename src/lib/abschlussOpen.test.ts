import { describe, it, expect, vi } from 'vitest'
import { abschlussEndeItem, abschlussOpenItems, abschlussOpenLabel, abschlussOpenPoints, abschlussSheet, abschlussStepAction, controlChipLabel, countsAsOpen, insideAbschlussMessage, registeredAbschlussMessage } from './abschlussOpen'
import type { Trupp } from '../types'
import { ABSCHLUSS_STEPS, type AbschlussStep } from './abschluss'
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

describe('insideAbschlussMessage — the crews still inside, by name', () => {
  const t = (over: Partial<Trupp>): Trupp => ({
    id: 'x', name: 'Muster Leo', entryPressureBar: 300, entryTime: '2026-09-25T10:00:00Z', lastContactTime: '', status: 'aktiv', ...over,
  })
  it('names each Trupp with its number and whole crew', () => {
    expect(insideAbschlussMessage([t({ no: 1, members: ['Graf Eva'] })]))
      .toBe('1 Trupp ist noch drin: Trupp 1 (Muster Leo / Graf Eva).')
    expect(insideAbschlussMessage([t({ no: 1 }), t({ id: 'y', no: 2, name: 'Frei Nora' })]))
      .toBe('2 Trupps sind noch drin: Trupp 1 (Muster Leo), Trupp 2 (Frei Nora).')
  })
})

/* The rows' own BUTTONS (3am sweep, 23.10.2026, owner's point 4): «tappable buttons where you can
   clearly just tap on them … and don't have to infer that the whole line is clickable». */
describe('abschlussStepAction — each row answers itself', () => {
  const go = { step: vi.fn(), trupps: vi.fn(), media: vi.fn() }
  const F = appConfig.copy.abschluss.fix
  const now = () => '2026-10-23T21:41:00.000Z'

  it('the four in-place answers write what the Rapport\'s own buttons write, and say so', () => {
    const fix = vi.fn()
    const expected: Partial<Record<AbschlussStep, object>> = {
      zeiten: { endedAt: now() },
      mittel: { mittelConfirmedNone: true },
      kontaktperson: { kontaktperson: undefined, kontaktpersonTelefon: undefined, kontaktpersonNone: true },
      rueckmeldung: { rueckmeldungElz: undefined, rueckmeldungNone: true },
    }
    for (const [step, over] of Object.entries(expected) as [AbschlussStep, object][]) {
      const a = abschlussStepAction(step, go, fix, now)!
      expect(a.label).toBe(F[step as keyof typeof F])
      expect(a.leaves).toBeUndefined()
      a.onClick()
      expect(fix).toHaveBeenLastCalledWith(step, over, F[step as keyof typeof F])
    }
    expect(go.step).not.toHaveBeenCalled()
  })

  it('«Wählen» and «Schreiben» LEAVE for the field — the answer needs a name or words', () => {
    for (const step of ['einsatzleiter', 'kurzbericht'] as const) {
      const a = abschlussStepAction(step, go, vi.fn(), now)!
      expect(a.leaves).toBe(true)
      a.onClick()
      expect(go.step).toHaveBeenLastCalledWith(step)
    }
  })

  it('a head count and a divergence have no one-tap answer', () => {
    expect(abschlussStepAction('anwesenheit', go, vi.fn(), now)).toBeUndefined()
    expect(abschlussStepAction('abweichungen', go, vi.fn(), now)).toBeUndefined()
  })

  it('a settled row stays in place as a done one — its answer at the end, still a link', () => {
    const settled = new Map<AbschlussStep, string>([['mittel', F.mittel]])
    const items = abschlussOpenItems(abschlussOpenPoints(['mittel', 'kurzbericht'], 0, 0), go, { fix: vi.fn(), now, settled })
    expect(items[0]).toMatchObject({ done: true, end: F.mittel })
    expect(items[0].action).toBeUndefined()
    expect(items[1]).toMatchObject({ action: { label: F.kurzbericht, leaves: true } })
    // …and without a fix (a caller that may not edit the Rapport) the rows are links only
    expect(abschlussOpenItems(abschlussOpenPoints(['mittel'], 0, 0), go)[0].action).toBeUndefined()
  })
})

describe('abschlussEndeItem — the Einsatzende pre-filled with «jetzt»', () => {
  it('shows the clock as already set, and «Ändern» leaves for the field', () => {
    const change = vi.fn()
    const d = new Date(2026, 9, 23, 23, 41)
    const it_ = abschlussEndeItem(d.toISOString(), change)
    expect(it_).toMatchObject({ label: appConfig.copy.abschluss.ende, done: true, end: 'jetzt 23:41' })
    expect(it_.action).toMatchObject({ label: appConfig.copy.abschluss.endeChange, leaves: true })
    it_.action!.onClick()
    expect(change).toHaveBeenCalledTimes(1)
  })
})

/* ONE list for both confirms (31.10.2026): the print's «Angaben fehlen noch» built plain links of
   its own, so the same Material row said «Nichts verwendet» in the Abschluss and nothing before a
   print. Both read `abschlussSheet` now; the words around the list stay each confirm's own. */
describe('abschlussSheet — the open points both confirms show', () => {
  const F = appConfig.copy.abschluss.fix
  const now = () => '2026-10-31T21:41:00.000Z'
  const steps = (...s: AbschlussStep[]) => s.map((step) => ({ kind: 'step' as const, step }))

  it('an answer is written at once, and the next reading keeps the row as done and is no longer open', () => {
    const write = vi.fn()
    const read = abschlussSheet(steps('zeiten', 'mittel'), { step: vi.fn() }, { write, now })
    const first = read()
    expect(first.anyOpen).toBe(true)
    // the print's Einsatzende is an open row with the step's own answer (nothing pre-filled)
    expect(first.items.map((i) => i.action?.label)).toEqual([F.zeiten, F.mittel])
    first.items[0].action!.onClick()
    first.items[1].action!.onClick()
    expect(write.mock.calls).toEqual([[{ endedAt: now() }], [{ mittelConfirmedNone: true }]])
    const next = read()
    expect(next.anyOpen).toBe(false)
    expect(next.items).toMatchObject([{ done: true, end: F.zeiten }, { done: true, end: F.mittel }])
  })

  it('a pre-filled row stands in its step\'s place and counts as answered; a Trupp out stays open', () => {
    const go = { step: vi.fn(), trupps: vi.fn(), media: vi.fn() }
    const ende = abschlussEndeItem(now(), vi.fn())
    const points = abschlussOpenPoints(['kontaktperson', 'zeiten'], 0, 2)
    const read = abschlussSheet(points, go, { write: vi.fn(), now, prefilled: { zeiten: ende } })
    expect(read().items.map((i) => i.label)).toEqual([
      appConfig.copy.abschluss.steps.kontaktperson, appConfig.copy.abschluss.ende, abschlussOpenLabel({ kind: 'media', n: 2 }),
    ])
    expect(read().items[1]).toBe(ende)
    read().items[0].action!.onClick()
    // only the queue is left, and a queue is not a «trotzdem» …
    expect(read().anyOpen).toBe(false)
    // … a crew nobody reported out is
    expect(abschlussSheet(abschlussOpenPoints([], 1, 0), go, { now })().anyOpen).toBe(true)
  })

  it('without a write (a session that may not edit the Rapport) the rows are links only', () => {
    const go = { step: vi.fn() }
    const { items } = abschlussSheet(steps('mittel', 'kurzbericht'), go, { now })()
    expect(items.every((i) => !i.action)).toBe(true)
    items[1].onClick()
    expect(go.step).toHaveBeenCalledWith('kurzbericht')
  })
})
