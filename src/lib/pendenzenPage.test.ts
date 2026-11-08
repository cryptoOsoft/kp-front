import { describe, expect, it } from 'vitest'
import { formAnno, newFormPage, TAFEL_ID } from './boardForm'
import { isTemplatePage, isUsableSection, type LiveSection, type TemplatePage } from './boardTemplate'
import { BUNDLED_TEMPLATES } from './boardTemplates'
import { createdRow, editRow, isPendenzenPage, pendenzenForPdf } from './pendenzenPage'
import { deriveReminders } from './reminders'
import { tafelPayload } from './reportPdfDirect'
import type { TimelineEvent } from '../types'

const FKS = BUNDLED_TEMPLATES[0]
const PAGE = FKS.pages.find((p) => p.id === 'pendenzen')!
const SEC = PAGE.sections[0] as LiveSection
const row = (id: string, text: string, reminder: TimelineEvent['reminder'], at: string): TimelineEvent =>
  ({ id, t: '', at, icon: 'easel', text, kind: 'reminder', reminder })

describe('a row typed on the «Aufträge / Pendenzen» page', () => {
  it('becomes ONE created row with Was, Wer and Prio. together, marked as from the Tafel', () => {
    const r = createdRow({ text: ' Gemeinde informieren ', assignee: 'EL', urgent: true }, 'pnd-1', 'Aufträge / Pendenzen')!
    expect(r.reminder).toEqual({ op: 'created', id: 'pnd-1', text: 'Gemeinde informieren', origin: 'tafel', assignee: 'EL', urgent: true })
    expect(r.text).toBe('Pendenz von der Tafel (Aufträge / Pendenzen): Gemeinde informieren · Wer: EL · dringend')
    // …and the Verlauf's own reducer reads it as an open Pendenz like any other
    expect(deriveReminders([{ ...r, id: 'j1', t: '', at: '2026-11-05T14:31:00.000Z' }])[0]).toMatchObject({ text: 'Gemeinde informieren', assignee: 'EL', urgent: true, origin: 'tafel' })
  })

  it('without a Was is no Auftrag', () => {
    expect(createdRow({ text: '  ', assignee: 'EL' }, 'pnd-1', 'P')).toBeNull()
  })
})

describe('a change of Was / Wer / Prio. on the page', () => {
  const item = { id: 'a', text: 'Strom abschalten', assignee: 'Of Zürcher', urgent: false }

  it('appends a correction carrying only what changed', () => {
    const r = editRow(item, { assignee: 'Lt Brunner', text: 'Strom abschalten' })!
    expect(r.reminder).toEqual({ op: 'note', id: 'a', edit: { assignee: 'Lt Brunner' } })
    expect(r.text).toBe('Auf der Tafel geändert (Strom abschalten): Wer: Lt Brunner')
    // a Prio. alone is a correction too: `edit` marks it, so the thread of Meldungen never lists it
    expect(editRow(item, { urgent: true })!.reminder).toEqual({ op: 'note', id: 'a', edit: {}, urgent: true })
  })

  it('writes nothing when nothing changes — an emptied Was keeps its words', () => {
    expect(editRow(item, { text: 'Strom abschalten', assignee: 'Of Zürcher', urgent: false })).toBeNull()
    expect(editRow(item, { text: '   ' })).toBeNull()
  })
})

describe('the page on paper', () => {
  const tl = [
    row('j3', 'Erledigt auf der Tafel', { op: 'done', id: 'b' }, '2026-11-05T13:18:00.000Z'),
    row('j2', 'Erinnerung', { op: 'created', id: 'a', text: 'Rückmeldung 2. OG', dueAt: '2026-11-05T13:35:00.000Z', urgent: true, assignee: 'AS-Trupp 2' }, '2026-11-05T13:22:00.000Z'),
    row('j1', 'Pendenz', { op: 'created', id: 'b', text: 'Wasserbezug melden' }, '2026-11-05T13:09:00.000Z'),
  ]

  it('prints as a table of the BGV columns, in issue order, with ruled rows for the hand', () => {
    const out = pendenzenForPdf(SEC, { id: SEC.id, type: 'live' }, tl, Date.parse('2026-11-05T13:40:00.000Z'), 'de')
    expect(out).toMatchObject({ type: 'table', adds: true })
    expect((out.columns as { label: string }[]).map((c) => c.label)).toEqual(['Was', 'Wer', 'Prio.', 'Status', 'Zeit'])
    const rows = (out.rows as { cells: string[]; done: boolean }[])
    expect(rows.map((r) => r.cells[0])).toEqual(['Wasserbezug melden', 'Rückmeldung 2. OG'])
    expect(rows[0].done).toBe(true)
    expect(rows[1].cells[1]).toBe('AS-Trupp 2')
    expect(rows[1].cells[2]).toBe('1')
    expect(rows[1].cells[4]).toMatch(/überfällig$/)
    expect(rows[1].cells[3].split('\n')).toEqual([expect.stringMatching(/^Erteilt \d\d:\d\d$/), 'Erledigt –'])
  })

  it('is left out of the Rapport while its «Aufträge / Pendenzen» section prints the same list', () => {
    const board = { [TAFEL_ID]: [formAnno(newFormPage(FKS, PAGE, {}, '2026-11-05T13:00:00.000Z'))] }
    expect(tafelPayload(board, [], undefined, [], '', undefined, { timeline: tl, inRapport: true }).boardPages).toEqual([])
    const [page] = tafelPayload(board, [], undefined, [], '', undefined, { timeline: tl, inRapport: false }).boardPages as { sections: { type: string; rows: unknown[] }[] }[]
    expect(page.sections[0]).toMatchObject({ type: 'table' })
    expect(page.sections[0].rows).toHaveLength(2)
  })
})

describe('the live section in the board-template/1 contract', () => {
  it('the bundled page is drawn by this build, and is found as the Pendenzen page', () => {
    expect(isUsableSection(SEC)).toBe(true)
    expect(isPendenzenPage(newFormPage(FKS, PAGE))).toBe(true)
  })

  // ⚠️ what an older build does with it, by the same rule: kept, just not drawn
  it('a source this build does not know is kept but not drawn', () => {
    const page: TemplatePage = { ...PAGE, sections: [{ ...SEC, source: 'probleme' as LiveSection['source'] }] }
    expect(isTemplatePage(page)).toBe(true)
    expect(isUsableSection(page.sections[0])).toBe(false)
  })
})
