// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest'
import { act, renderHook } from '@testing-library/react'
import { useState } from 'react'
import {
  dropLine, dropRow, findForms, formAnno, formForPdf, formHasContent, isFormData, newFormPage, nextTrend, normalizeTime, pageStamp, pageTitles, putField, putLine, putRow, tableRows,
  type BoardFormData,
} from './boardForm'
import { BUNDLED_TEMPLATES } from './boardTemplates'
import { isBoardTemplate, isUsableSection, labelText, shownSections, type BoardTemplate, type TableSection } from './boardTemplate'
import { isBoardAnno, sanitizeWorkspace } from './workspace'
import { objectsFromLegacy, viewsOf } from './tacticalObjects'
import { useBoardDoc, type BoardHistory } from '../components/useBoardDoc'
import type { BoardAnno } from '../types'

const FKS = BUNDLED_TEMPLATES[0]
const EF = FKS.pages.find((p) => p.id === 'ef')!
const fresh = (vehicles: string[] = []) => newFormPage(FKS, EF, { vehicles }, '2026-10-10T09:24:00.000Z')
const WORDS = { up: 'wird schlimmer', same: 'gleich', down: 'entspannt sich' }

describe('the bundled FKS «Erste Führung» — strict 1:1 with the poster', () => {
  it('is a valid board-template/1 with the six boxes in the poster’s order', () => {
    expect(isBoardTemplate(FKS)).toBe(true)
    expect(EF.sections.map((s) => s.id)).toEqual(['problem', 'lagekarte', 'massnahmen', 'mittel', 'verbindungen', 'absprachen'])
    expect(EF.columns).toBe(2)
  })
  // owner, round 2
  it('switches the staging extras OFF — header, Stichwort, Erledigt, Wasserbezug / Absperrung — and the Tendenz ON', () => {
    const problem = EF.sections[0]
    expect(EF.header).toBe(false)
    expect(problem.type === 'quad' && [problem.trend, problem.tag]).toEqual([true, false])
    const mass = EF.sections.find((s) => s.id === 'massnahmen') as TableSection
    expect(mass.done).toBe(false)
    const abs = EF.sections.find((s) => s.id === 'absprachen') as TableSection
    const shown = (abs.fixedRows ?? []).filter((r) => !r.hidden).map((r) => r.id)
    expect(shown).toEqual(['patientensammelstelle', 'sanitaetshilfsstelle', 'rettungsachse', 'standort-einsatzleitung', 'sammelstelle-unverletzte', 'warteraum'])
    expect((abs.fixedRows ?? []).filter((r) => r.hidden).map((r) => r.id)).toEqual(['wasserbezug', 'absperrung'])
  })
  it('carries the official French and Italian words', () => {
    expect(labelText(EF.title, 'fr')).toBe('Première Conduite')
    expect(labelText(EF.title, 'it-CH')).toBe('Prima coordinazione')
    expect(labelText(EF.sections[0].title, 'fr')).toBe('Saisie du problème')
    expect(labelText(EF.title, 'rm')).toBe('Erste Führung') // German is the fallback
  })
})

// review of #338
describe('keeping and drawing are two questions', () => {
  const patched = (patch: (t: BoardTemplate) => void) => { const t = JSON.parse(JSON.stringify(FKS)) as BoardTemplate; patch(t); return t }
  it.each([
    ['another schema', (t: BoardTemplate) => { (t as { schema: string }).schema = 'board-template/2' }],
    ['a page without sections', (t: BoardTemplate) => { t.pages[0].sections = [] }],
    ['duplicate section ids', (t: BoardTemplate) => { t.pages[0].sections[1].id = 'problem' }],
    ['a label without German', (t: BoardTemplate) => { t.pages[0].title = { fr: 'x' } as never }],
  ])('a file that is not a template at all is refused: %s', (_n, patch) => expect(isBoardTemplate(patched(patch))).toBe(false))
  it.each([
    ['an unknown section type', (t: BoardTemplate) => { (t.pages[0].sections[1] as { type: string }).type = 'sketch' }, 1],
    ['a fixed cell for a typed column', (t: BoardTemplate) => { ((t.pages[0].sections[5] as TableSection).fixedRows![0].cells as Record<string, string>).ort = 'x' }, 5],
  ])('a newer or odd section is KEPT and merely not drawn: %s', (_n, patch, i) => {
    const t = patched(patch)
    expect(isBoardTemplate(t)).toBe(true)
    expect(isUsableSection(t.pages[0].sections[i])).toBe(false)
    expect(shownSections(t.pages[0]).map((s) => s.id)).not.toContain(t.pages[0].sections[i].id)
  })
  it('an unknown column type is drawn as text, never a reason to drop the table', () => {
    const t = patched((x) => { (x.pages[0].sections[2] as TableSection).columns[1].type = 'signature' as never })
    expect(isUsableSection(t.pages[0].sections[2])).toBe(true)
  })
})

describe('writing on a page — keyed by ids, so a rename never loses a word', () => {
  it('Mittel starts with the vehicles the Einsatz knows, once each, as seed rows', () => {
    const d = fresh(['TLF 1', 'tlf 1', ' ADL ', ''])
    const mittel = EF.sections.find((s) => s.id === 'mittel') as TableSection
    expect(tableRows(d, mittel).map((r) => [r.cells.formation, r.seed])).toEqual([['TLF 1', true], ['ADL', true]])
    expect(formHasContent(d)).toBe(false)
  })
  it('a trailing line becomes a line on its first words; emptied, it goes again', () => {
    const a = putLine(fresh(), 'problem', 'front', 'l1', { text: 'Rettungen Haus 19' })
    expect(a.values.problem.lines?.front).toEqual([{ id: 'l1', text: 'Rettungen Haus 19', ord: 'V' }])
    expect(putLine(a, 'problem', 'front', 'l1', { text: '  ' }).values.problem.lines?.front).toEqual([])
    expect(putLine(fresh(), 'problem', 'front', 'l9', { text: '' })).toEqual(fresh()) // nothing to write
    expect(formHasContent(a)).toBe(true)
  })
  it('a no-op hands back the SAME object (no empty ↶ step)', () => {
    const a = putRow(fresh(), 'massnahmen', 'r1', { cells: { was: 'Riegel Seite C', wer: 'TLF 1' } })
    expect(putRow(a, 'massnahmen', 'r1', { cells: { was: 'Riegel Seite C' } })).toBe(a)
    expect(putField(a, 'nope', 'text', '')).toBe(a)
  })
  it('a written row with only a tick is dropped; a fixed row is kept and never invented', () => {
    const a = putRow(fresh(), 'massnahmen', 'r1', { cells: { was: 'x' } })
    expect(putRow(a, 'massnahmen', 'r1', { cells: { was: '' } }).values.massnahmen.rows).toEqual([])
    const b = putRow(fresh(), 'absprachen', 'warteraum', { cells: { ort: 'Parkplatz Coop' } })
    const abs = EF.sections.find((s) => s.id === 'absprachen') as TableSection
    expect(tableRows(b, abs).map((r) => r.cells.ort ?? '')).toEqual(['', '', '', '', '', 'Parkplatz Coop'])
    expect(putRow(b, 'absprachen', 'warteraum', { cells: { ort: '' } }).values.absprachen.rows).toEqual([])
  })
  it('the bin deletes a written row or a line in one write, stamped for the merge; nothing there = same object', () => {
    const a = putRow(putRow(fresh(), 'massnahmen', 'r1', { cells: { was: 'Riegel', wer: 'TLF 1' } }), 'massnahmen', 'r2', { cells: { was: 'Lüften' } })
    const b = dropRow(a, 'massnahmen', 'r1', 42)
    expect(b.values.massnahmen.rows?.map((r) => r.id)).toEqual(['r2'])
    expect(b.t?.['r|massnahmen|r1|was']).toBe(42)
    expect(dropRow(b, 'massnahmen', 'r1')).toBe(b)
    const l = putLine(fresh(), 'problem', 'front', 'l1', { text: 'Rauch' })
    expect(dropLine(l, 'problem', 'front', 'l1').values.problem.lines?.front).toEqual([])
    expect(dropLine(l, 'problem', 'ordnung', 'l1')).toBe(l)
  })
  it('an edited seed row is the operator’s from then on', () => {
    const d = fresh(['TLF 1'])
    const id = d.values.mittel.rows![0].id
    const e = putRow(d, 'mittel', id, { cells: { auftrag: 'Riegel Seite C' } })
    expect(e.values.mittel.rows![0]).toEqual({ id, cells: { formation: 'TLF 1', auftrag: 'Riegel Seite C' }, ord: 'V' })
  })
  it('a label renamed in a newer station file still finds every value by id', () => {
    const d = putRow(fresh(), 'massnahmen', 'r1', { cells: { was: 'Personensuche', wer: 'AS Schmid' } })
    const renamed: BoardFormData = JSON.parse(JSON.stringify(d))
    const mass = renamed.page.sections.find((s) => s.id === 'massnahmen') as TableSection
    mass.columns[1].label = 'Zuständig'
    mass.title = 'Sofortmassnahmen'
    const pdf = formForPdf(renamed, WORDS, 'de') as { sections: { title: string; columns?: { label: string }[]; rows?: { cells: string[] }[] }[] }
    const m = pdf.sections.find((s) => s.title === 'Sofortmassnahmen')!
    expect(m.columns!.map((c) => c.label)).toEqual(['Was/Wo', 'Zuständig', 'Wann'])
    expect(m.rows![0].cells).toEqual(['Personensuche', 'AS Schmid', ''])
  })
  it('«1124» in a Wann is 11:24', () => {
    expect(['1124', '924', '9.05', '7', '11:24', '2460', 'gleich'].map(normalizeTime)).toEqual(['11:24', '09:24', '09:05', '07:00', '11:24', '2460', 'gleich'])
  })
  it('the trend cycles ➚ = ➘ and back to open', () => {
    expect([nextTrend(undefined), nextTrend('up'), nextTrend('same'), nextTrend('down')]).toEqual(['up', 'same', 'down', undefined])
  })
})

describe('the snapshot — a later station edit never changes an added page', () => {
  it('copies the page, so the template can change under it', () => {
    const tpl = JSON.parse(JSON.stringify(FKS)) as BoardTemplate
    const d = newFormPage(tpl, tpl.pages[0])
    tpl.pages[0].sections.pop()
    tpl.pages[0].title = 'Geändert'
    expect(d.page.sections).toHaveLength(6)
    expect(d.page.title).toEqual(EF.title)
    expect(d.tpl).toEqual({ id: 'fks-erste-fuehrung', version: FKS.version, title: FKS.title, source: FKS.source })
  })
})

describe('a page is ONE board anno — add, edit, undo, persist', () => {
  it('adding it is one ↶ step, an edit another, and ↶ ↶ leaves the empty Tafel', () => {
    const laid: string[] = []
    const { result } = renderHook(() => {
      const [annos, setAnnos] = useState<BoardAnno[]>([])
      const [hist, setHist] = useState<BoardHistory>({})
      const doc = useBoardDoc({
        annos, onChange: setAnnos, emit: vi.fn(), activeId: 'tafel', onCheckpoint: (_p, s) => laid.push(s),
        hist, setHist, selId: null, setSelId: vi.fn(), editId: null, setEditId: vi.fn(),
      })
      return { doc, annos }
    })
    const anno = formAnno(fresh())
    act(() => result.current.doc.add(anno))
    expect(findForms(result.current.annos).map((a) => a.id)).toEqual([anno.id])
    act(() => result.current.doc.patchCommit(anno.id, { form: putLine(anno.form!, 'problem', 'front', 'l1', { text: 'Rauch' }) }))
    expect(findForms(result.current.annos)[0].form.values.problem.lines?.front).toHaveLength(1)
    expect(laid).toHaveLength(2)
    act(() => { result.current.doc.undo() })
    expect(findForms(result.current.annos)[0].form.values.problem).toBeUndefined()
    act(() => { result.current.doc.undo() })
    expect(result.current.annos).toEqual([])
    act(() => { result.current.doc.redo() })
    expect(findForms(result.current.annos)[0].id).toBe(anno.id)
  })

  it('survives the object store and the save → load gate, values and snapshot alike', () => {
    const anno = formAnno(putRow(fresh(['TLF 1']), 'massnahmen', 'r1', { cells: { was: 'Personensuche', wer: 'AS Schmid', wann: '11:31' } }))
    expect(isBoardAnno(anno)).toBe(true)
    const objects = objectsFromLegacy([], [], { tafel: [anno] })
    expect(viewsOf(objects).board.tafel).toEqual([anno])
    const g = sanitizeWorkspace(JSON.parse(JSON.stringify({ board: { tafel: [anno] }, objects })))
    expect(g.dropped).toBe(0)
    expect(g.ws?.board?.tafel).toEqual([anno])
  })

  it('a malformed page is dropped at the gate, never drawn half', () => {
    const anno = formAnno(fresh())
    expect(isFormData({ ...anno.form, page: { id: 'x' } })).toBe(false)
    expect(isBoardAnno({ id: 'fm1', kind: 'form' })).toBe(false)
    expect(isBoardAnno({ ...anno, form: { ...anno.form, values: { problem: { rows: [{ cells: {} }] } } } })).toBe(false)
  })

  it('pages are ordered by when they were added, not by where the store keeps them', () => {
    const a = formAnno(newFormPage(FKS, EF, {}, '2026-10-10T09:00:00Z'))
    const b = formAnno(newFormPage(FKS, FKS.pages[1], {}, '2026-10-10T08:00:00Z'))
    expect(findForms([a, b]).map((x) => x.id)).toEqual([b.id, a.id])
  })
})

describe('the Rapport gets the page resolved, in the deployment’s words', () => {
  it('quads, the table rows, the fixed Signaturen and the map box', () => {
    let d = putLine(fresh(), 'problem', 'front', 'l1', { text: 'Rettungen Haus 19' })
    d = putRow(d, 'absprachen', 'warteraum', { cells: { ort: 'Parkplatz Coop' } })
    const pdf = formForPdf(d, WORDS, 'fr') as Record<string, unknown> & { sections: Record<string, unknown>[] }
    expect(pdf.title).toBe('Première Conduite')
    expect(pdf.columns).toBe(2)
    expect(pdf.sections.map((s) => s.type)).toEqual(['quad', 'map', 'table', 'table', 'table', 'table'])
    const quad = pdf.sections[0] as { cells: { label: string; lines: { text: string }[] }[] }
    expect(quad.cells[0]).toEqual({ label: 'Front', lines: [{ text: 'Rettungen Haus 19', trend: '', dir: '', tag: '' }] })
    const abs = pdf.sections[5] as { rows: { cells: string[] }[] }
    expect(abs.rows).toHaveLength(6)
    expect(abs.rows[5].cells).toEqual(['warteraum', 'Zone d’attente', 'Parkplatz Coop'])
  })
  it('a trend column prints WORDS (the PDF font has no ➚ ➘), a Bereich its choice\'s label', () => {
    const p81 = FKS.pages.find((p) => p.id === 'problem-tendenz')!
    const d = putRow(newFormPage(FKS, p81), 'probleme', 'r1', { cells: { bereich: 'spezial', problem: 'Brand Zisternenfahrzeug', tendenz: 'up' } })
    const pdf = formForPdf(d, WORDS, 'de') as { landscape: boolean; sections: { columns: { kind: string }[]; rows: { cells: string[] }[] }[] }
    expect(pdf.landscape).toBe(true)
    expect(pdf.sections[0].rows[0].cells).toEqual(['Spezielles', 'Brand Zisternenfahrzeug', 'wird schlimmer', '', ''])
    expect(pdf.sections[0].columns[0].kind).toBe('text') // the paper knows no menus
  })
})

// owner, 26.10.2026: the page itself says when it was started and last written on
describe('the page’s timeline', () => {
  const STAMP = { stampCreated: 'Erstellt {at}', stampEdited: 'zuletzt bearbeitet {at}' }
  const started = newFormPage(FKS, EF, {}, new Date(2026, 9, 26, 11, 24).toISOString())
  it('names only the start while nothing is written', () => {
    expect(pageStamp(started, STAMP)).toBe('Erstellt 26.10.2026, 11:24')
  })
  it('adds the latest edit, on whichever day it was', () => {
    let d = putLine(started, 'problem', 'front', 'l1', { text: 'Brand Haus 21' }, new Date(2026, 9, 27, 0, 15).getTime())
    d = putLine(d, 'problem', 'front', 'l2', { text: 'Rettungen' }, new Date(2026, 9, 26, 23, 50).getTime())
    expect(pageStamp(d, STAMP)).toBe('Erstellt 26.10.2026, 11:24 · zuletzt bearbeitet 27.10.2026, 00:15')
    expect((formForPdf(d, WORDS, 'de', undefined, undefined, pageStamp(d, STAMP)) as { stamp: string }).stamp).toBe(pageStamp(d, STAMP))
  })
})

// owner, 10.10. evening: «multiple concepts»
describe('repeatable pages', () => {
  it('Konzept and Rapport repeat; the others are offered once', () => {
    expect(FKS.pages.filter((p) => p.repeatable).map((p) => p.id)).toEqual(['konzept', 'rapport'])
  })
  it('a second instance is numbered, on screen and on paper — and the numbers close up when one goes', () => {
    const k = FKS.pages.find((p) => p.id === 'konzept')!
    const a = formAnno(newFormPage(FKS, k, {}, '2026-10-10T09:01:00Z'))
    const b = formAnno(newFormPage(FKS, k, {}, '2026-10-10T09:02:00Z'))
    const c = formAnno(newFormPage(FKS, k, {}, '2026-10-10T09:03:00Z'))
    const titles = pageTitles([c, a, b])
    expect([titles.get(a.id), titles.get(b.id), titles.get(c.id)]).toEqual(['Konzept', 'Konzept 2', 'Konzept 3'])
    expect((formForPdf(b.form, WORDS, undefined, undefined, titles.get(b.id)) as { title: string }).title).toBe('Konzept 2')
    const gone = { ...b, form: { ...b.form, removedAt: 1 } }
    expect(pageTitles([a, gone, c]).get(c.id)).toBe('Konzept 2')
  })
})

// The demo's Tafel opens with pages on it (backend demo_reset · DEMO_TAFEL_MINUTES): a page the
// gate turns into a passenger would ride along unseen, and the demo would open on an empty strip.
describe('the demo scene’s Tafel pages', () => {
  it('pass the gate as drawable pages, Erste Führung first, every table row in a column it has', async () => {
    const { readFileSync } = await import('node:fs')
    const scene = JSON.parse(readFileSync('examples/demo-data/incident.workspace.json', 'utf-8'))
    const { ws, dropped } = sanitizeWorkspace(scene)
    expect(dropped).toBe(0)
    const annos = ws!.board!.tafel
    const pages = findForms(annos)
    expect(pages.map((a) => a.form.page.id)).toEqual(['ef', 'rapport'])
    expect([...pageTitles(annos).values()]).toEqual(['Erste Führung', 'Rapport'])
    for (const { form } of pages) {
      expect(formHasContent(form)).toBe(true)
      for (const s of form.page.sections) {
        if (s.type !== 'table') continue
        const ids = new Set(s.columns.map((c) => c.id))
        for (const r of tableRows(form, s)) expect(Object.keys(r.cells).every((k) => ids.has(k))).toBe(true)
      }
    }
    // the Massnahmen stack in the order they were written, the oldest on top
    const massn = tableRows(pages[0].form, pages[0].form.page.sections.find((s) => s.id === 'massnahmen') as TableSection)
    expect(massn[0].cells.was).toMatch(/^WV ab Hydrant/)
    expect(massn[massn.length - 1].cells.was).toMatch(/^Nachlöschen/)
  })
})
