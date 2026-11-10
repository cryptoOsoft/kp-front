import { describe, expect, it } from 'vitest'
import { dayBreaks } from './formDays'
import { formForPdf, newFormPage, putRow } from './boardForm'
import { BUNDLED_TEMPLATES } from './boardTemplates'

// Einsatzbeginn Mo 09.11.2026 23:31 (mock nov09-mitternacht) – local time, whatever the runner's zone
const start = new Date(2026, 10, 9, 23, 31).toISOString()
const day = (d: Date | null) => (d ? `${d.getDate()}.${d.getMonth() + 1}.` : null)

describe('dayBreaks – midnight on a Tafel table', () => {
  it('marks the first entry after midnight, and only that one', () => {
    expect(dayBreaks(['23:48', '23:55', '23:59', '00:01', '00:07', '00:15'], start).map(day))
      .toEqual([null, null, null, '10.11.', null, null])
  })

  it('leaves a table that stays on its day alone, entries written a little out of order included', () => {
    const morning = new Date(2026, 10, 9, 11, 30).toISOString()
    expect(dayBreaks(['11:42', '11:46', '11:40', '', '12:10', '22:30'], morning).every((d) => d === null)).toBe(true)
  })

  it('a first entry after midnight already stands on the next day; a late «23:50» under «00:20» stays on the day before', () => {
    expect(dayBreaks(['00:05'], start).map(day)).toEqual(['10.11.'])
    expect(dayBreaks(['00:20', '23:50', '00:30'], start).map(day)).toEqual(['10.11.', '9.11.', '10.11.'])
  })

  it('rows without a time keep the day above, and an unreadable page date marks nothing', () => {
    expect(dayBreaks(['23:59', '', '00:10'], start).map(day)).toEqual([null, null, '10.11.'])
    expect(dayBreaks(['00:10'], 'nonsense')).toEqual([null])
  })
})

describe('the paper of a table past midnight (formForPdf)', () => {
  it('puts the date row before the first entry of the new day, and nowhere else', () => {
    const FKS = BUNDLED_TEMPLATES[0]
    let d = newFormPage(FKS, FKS.pages[0], {}, start)
    for (const [id, was, wann] of [['r1', 'Sicherheitstrupp bereit', '23:59'], ['r2', 'Personenrettung', '00:01']]) {
      d = putRow(d, 'massnahmen', id, { cells: { was, wann } })
    }
    const pdf = formForPdf(d, { up: '', same: '', down: '' }) as { sections: { id: string; rows?: { sep?: string; cells: string[] }[] }[] }
    const rows = pdf.sections.find((s) => s.id === 'massnahmen')!.rows!
    expect(rows.map((r) => r.sep ?? r.cells[2])).toEqual(['23:59', expect.stringContaining('10.11.2026'), '00:01'])
    // a table without a «Wann» column never gets one
    expect(pdf.sections.find((s) => s.id === 'absprachen')!.rows!.some((r) => r.sep)).toBe(false)
  })
})
