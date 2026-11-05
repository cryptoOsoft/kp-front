import { describe, expect, it } from 'vitest'
import { dropRow, formAnno, newFormPage, putLine, putRow, tableRows, boxLines, moveRow, type FormAnno } from './boardForm'
import type { BoardTemplate, TableSection } from './boardTemplate'
import type { ChecklistTemplate } from './checklists'
import { problemRegister, problemView, splitProblemEdit, type ProblemSource } from './problemLink'

const tpl: BoardTemplate = {
  schema: 'board-template/1', id: 't', version: 1, title: 'T',
  pages: [
    { id: 'ef', title: 'Erste Führung', sections: [{ id: 'problem', type: 'quad', trend: true, problems: true, cells: [{ id: 'front', label: 'Front' }, { id: 'ordnung', label: 'Ordnung' }] }] },
    {
      id: 'pt', title: 'Problemerfassung', sections: [{
        id: 'probleme', type: 'table', problems: true, columns: [
          { id: 'bereich', label: 'Bereich', type: 'area', options: [{ id: 'front', label: 'Front' }, { id: 'ordnung', label: 'Ordnung' }] },
          { id: 'problem', label: 'Problem' }, { id: 'tendenz', label: 'Tendenz', type: 'trend' }, { id: 'reaktion', label: 'Reaktion' },
        ],
      }],
    },
  ],
}
const checklist: ChecklistTemplate = {
  id: 'pe', kind: 'action', problems: true, title: 'Problemerfassung', version: 1, source: '',
  phases: [{ id: 'front', title: 'Front', area: 'front', items: [{ id: 'f1', text: 'Energieträger' }, { id: 'f2', text: 'Brand' }] }],
}
const page = (id: string, at: string): FormAnno => ({ ...formAnno(newFormPage(tpl, tpl.pages.find((p) => p.id === id)!, {}, at)), id })
const source = (ticks: Record<string, { t: string; trend?: 'up' | 'same' | 'down' }>): ProblemSource => ({ templates: [checklist], checklists: { pe: { ticks } } })
const table = (d: FormAnno['form']) => d.page.sections[0] as TableSection

describe('problemLink – one list behind the checklist, the quad and the table', () => {
  it('a tick made while no page is on the Tafel stands on both pages once they are added', () => {
    const src = source({ f1: { t: '2026-11-05T14:14:00Z', trend: 'same' } })
    expect(problemRegister([], src).map((p) => p.text)).toEqual(['Energieträger'])
    const ef = page('ef', '1'), pt = page('pt', '2')
    const efView = problemView(ef, [ef, pt], src)
    expect(boxLines(efView, 'problem', 'front').map((l) => [l.text, l.trend, l.src])).toEqual([['Energieträger', 'same', 'checklist']])
    const row = tableRows(problemView(pt, [ef, pt], src), table(pt.form))[0]
    expect(row.cells).toEqual({ problem: 'Energieträger', tendenz: 'same', bereich: 'front' })
  })

  it('a row typed on the page lands in its Bereich box, and a line typed in a box on the page', () => {
    let ef = page('ef', '1'), pt = page('pt', '2')
    pt = { ...pt, form: putRow(pt.form, 'probleme', 'r1', { cells: { problem: 'Bus 61 blockiert', bereich: 'ordnung', tendenz: 'down' } }) }
    ef = { ...ef, form: putLine(ef.form, 'problem', 'front', 'l1', { text: 'Rauch Schulhaus', trend: 'up' }) }
    const pages = [ef, pt]
    expect(boxLines(problemView(ef, pages), 'problem', 'ordnung').map((l) => [l.id, l.text, l.trend])).toEqual([['rw~r1', 'Bus 61 blockiert', 'down']])
    const rows = tableRows(problemView(pt, pages), table(pt.form))
    expect(rows.map((r) => [r.id, r.cells.problem, r.cells.bereich])).toEqual([['r1', 'Bus 61 blockiert', 'ordnung'], ['ln~l1', 'Rauch Schulhaus', 'front']])
  })

  it('writing a Reaktion on a box line keeps it on the page (satellite) and leaves the line alone', () => {
    let ef = page('ef', '1')
    const pt = page('pt', '2')
    ef = { ...ef, form: putLine(ef.form, 'problem', 'front', 'l1', { text: 'Rauch' }) }
    const before = problemView(pt, [ef, pt])
    const after = putRow(before, 'probleme', 'ln~l1', { cells: { reaktion: 'Fenster schliessen' } }, 5)
    const r = splitProblemEdit(pt, before, after, [ef, pt], undefined, 5)
    expect(r.others.size).toBe(0)
    // its place in this page's order is the page's own too (the write pinned the order keys)
    expect(r.form.values.probleme.rows).toEqual([{ id: 'ln~l1', cells: { '@': '1', reaktion: 'Fenster schliessen' }, ord: expect.any(String) }])
    // what the page shows again from what it stores
    const shown = tableRows(problemView({ ...pt, form: r.form }, [ef, { ...pt, form: r.form }]), table(pt.form))[0]
    expect(shown.cells).toEqual({ problem: 'Rauch', bereich: 'front', reaktion: 'Fenster schliessen' })
  })

  it('the words, Tendenz and Bereich of a problem from another page go to its home', () => {
    let ef = page('ef', '1')
    const pt = page('pt', '2')
    ef = { ...ef, form: putLine(ef.form, 'problem', 'front', 'l1', { text: 'Rauch' }) }
    const before = problemView(pt, [ef, pt])
    const after = putRow(before, 'probleme', 'ln~l1', { cells: { problem: 'Rauch dicht', tendenz: 'up', bereich: 'ordnung' } }, 7)
    const r = splitProblemEdit(pt, before, after, [ef, pt], undefined, 7)
    const home = r.others.get(ef.id)!
    expect(home.values.problem.lines?.front ?? []).toEqual([])
    expect(boxLines(home, 'problem', 'ordnung').map((l) => [l.id, l.text, l.trend])).toEqual([['l1', 'Rauch dicht', 'up']])
    // this page keeps the row's place only, never its words
    expect(r.form.values.probleme.rows).toEqual([{ id: 'ln~l1', cells: { '@': '1' }, ord: expect.any(String) }])
  })

  it('a checklist problem: its trend is the tick\'s, deleting it un-ticks, its words are never written', () => {
    const src = source({ f1: { t: '1' } })
    const pt = page('pt', '2')
    const before = problemView(pt, [pt], src)
    const trended = putRow(before, 'probleme', 'ck~pe~f1', { cells: { tendenz: 'up', problem: 'anders' } })
    expect(splitProblemEdit(pt, before, trended, [pt], src).ticks).toEqual([{ tpl: 'pe', item: 'f1', trend: 'up' }])
    const gone = splitProblemEdit(pt, before, dropRow(before, 'probleme', 'ck~pe~f1'), [pt], src)
    expect(gone.ticks).toEqual([{ tpl: 'pe', item: 'f1', untick: true }])
    expect(gone.unticked).toEqual(['Energieträger'])
  })

  it('a typed row never becomes a tick, and an un-tick in the checklist keeps the page\'s Reaktion for a re-tick', () => {
    const pt = page('pt', '2')
    const ticked = source({ f1: { t: '1' } })
    const before = problemView(pt, [pt], ticked)
    const after = putRow(before, 'probleme', 'ck~pe~f1', { cells: { reaktion: 'EBL rufen' } })
    const stored = { ...pt, form: splitProblemEdit(pt, before, after, [pt], ticked).form }
    // un-ticked in the checklist: the row is not shown, a new typed row does not touch the satellite
    const unticked = source({})
    const v2 = problemView(stored, [stored], unticked)
    expect(tableRows(v2, table(pt.form))).toEqual([])
    const typed = putRow(v2, 'probleme', 'r9', { cells: { problem: 'Energieträger' } })
    const r = splitProblemEdit(stored, v2, typed, [stored], unticked)
    expect(r.ticks).toEqual([])
    const back = { ...stored, form: r.form }
    const shown = tableRows(problemView(back, [back], ticked), table(pt.form))
    expect(shown.map((x) => x.id).sort()).toEqual(['ck~pe~f1', 'r9'])
    expect(shown.find((x) => x.id === 'ck~pe~f1')?.cells.reaktion).toBe('EBL rufen')
  })

  it('reordering keeps the place of a problem from elsewhere on this page, and its home untouched', () => {
    const src = source({ f1: { t: '1' }, f2: { t: '2' } })
    const pt = page('pt', '2')
    const before = problemView(pt, [pt], src)
    const after = moveRow(before, 'probleme', 'ck~pe~f2', 0, 3)
    const r = splitProblemEdit(pt, before, after, [pt], src, 3)
    expect(r.ticks).toEqual([])
    const back = { ...pt, form: r.form }
    expect(tableRows(problemView(back, [back], src), table(pt.form)).map((x) => x.cells.problem)).toEqual(['Brand', 'Energieträger'])
  })

  it('emptying a box line that came from the page deletes the page\'s row', () => {
    let pt = page('pt', '2')
    const ef = page('ef', '1')
    pt = { ...pt, form: putRow(pt.form, 'probleme', 'r1', { cells: { problem: 'Gaffer', bereich: 'ordnung' } }) }
    const before = problemView(ef, [ef, pt])
    const after = putLine(before, 'problem', 'ordnung', 'rw~r1', { text: '' })
    const r = splitProblemEdit(ef, before, after, [ef, pt])
    expect(r.others.get(pt.id)!.values.probleme.rows).toEqual([])
  })
})
