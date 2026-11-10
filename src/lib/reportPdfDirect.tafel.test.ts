import { describe, expect, it } from 'vitest'
import { buildDirectReportPayload } from './reportPdfDirect'
import { formAnno, newFormPage, putLine } from './boardForm'
import { BUNDLED_TEMPLATES } from './boardTemplates'
import { planDocuments } from '../data/demoIncident'
import type { BoardAnno, LayerDef } from '../types'

const FKS = BUNDLED_TEMPLATES[0]
const ef = formAnno(putLine(newFormPage(FKS, FKS.pages[0], {}), 'problem', 'front', 'l1', { text: 'Rettungen Haus 19 → 21' }))
const ink: BoardAnno = { id: 'l1', kind: 'draw', pts: [[0.1, 0.1], [0.4, 0.5]], color: '#c00' }
const scene = {
  entities: [{ id: 'e1', kind: 'symbol', symbol: 'VKF Feuer', coord: [7.5, 47.5], layer: 'tactical' }],
  drawings: [{ id: 'd1', kind: 'line', coords: [[7.5, 47.5], [7.501, 47.501]], label: 'Leitung 1' }],
  layers: [{ id: 'base', base: true, visible: true, tiles: ['https://tiles.example/{z}/{x}/{y}.png'] } as LayerDef],
  byName: {}, center: [7.5, 47.5] as [number, number], captionMode: 'auto' as const,
}

const build = (board: Record<string, BoardAnno[]>, options: Record<string, unknown> = {}) => buildDirectReportPayload({
  incident: { id: 'i1', title: 'Brand', started_at: '2026-10-10T15:40:00.000Z' } as never,
  draft: { meta: {}, generatedAt: '2026-10-10T16:05:00.000Z', proof: {}, options: { kroki: false, ...options } } as never,
  trupps: [], attendance: {}, events: [], plans: planDocuments, board, scene: scene as never,
}) as { boardPages: { title: string; sections: { type: string }[] }[]; boardMap?: { drawings: { label?: string }[]; entities: { caption?: string }[] }; planPages: { label: string; blankAspect?: number; annos: unknown[] }[]; options: { tafel: boolean } }

describe('the Tafel in the Rapport', () => {
  it('prints every page in its own layout, and the Skizze when it carries ink', () => {
    const out = build({ tafel: [ink, ef] })
    expect(out.boardPages.map((p) => p.title)).toEqual(['Erste Führung'])
    expect(out.boardPages[0].sections.map((s) => s.type)).toEqual(['quad', 'map', 'table', 'table', 'table', 'table'])
    // the Tafel's own drawing reaches paper at last — as a blank-base page of the sheet's shape
    const skizze = out.planPages.find((p) => p.label.endsWith('Skizze'))!
    expect(skizze.blankAspect).toBeCloseTo(1 / 1.414)
    expect(skizze.annos).toHaveLength(1) // the ink, never the page
    expect(out.options.tafel).toBe(true)
  })
  it('the Lagekarte box gets the scene auto-framed, without the labels it has no legend for', () => {
    const out = build({ tafel: [ef] })
    expect(out.boardMap?.drawings[0].label).toBeUndefined()
    expect(out.boardMap?.entities[0].caption).toBeUndefined()
    // no ink, no Skizze page
    expect(out.planPages.some((p) => p.label.endsWith('Skizze'))).toBe(false)
  })
  it('the paper words go through forPaper like the rest of the sheet', () => {
    const out = build({ tafel: [ef] }) as unknown as { boardPages: { sections: { cells?: { lines: { text: string }[] }[] }[] }[] }
    expect(out.boardPages[0].sections[0].cells![0].lines[0].text).toBe('Rettungen Haus 19 -> 21')
  })
  it('the operator can leave each part of the Tafel out — and an empty Tafel carries nothing', () => {
    const noEf = build({ tafel: [ink, ef] }, { tafelPages: { ef: false } })
    expect([noEf.boardPages, noEf.boardMap]).toEqual([[], undefined])
    expect(build({ tafel: [ink, ef] }, { tafel: false }).planPages).toEqual([])
    const empty = build({})
    expect([empty.boardPages, empty.boardMap]).toEqual([[], undefined])
  })
  // picker B (owner, 09.11.2026): the Rapport sheet is its own tick, OFF until asked for, and a
  // page with nothing on it does not print
  it('prints the Rapport sheet only when ticked, and never an empty Erste Führung', () => {
    const rapport = formAnno(newFormPage(FKS, FKS.pages.find((p) => p.id === 'rapport')!, {}))
    const blankEf = formAnno(newFormPage(FKS, FKS.pages[0], {}))
    expect(build({ tafel: [ef, rapport] }).boardPages.map((p) => p.title)).toEqual(['Erste Führung'])
    expect(build({ tafel: [ef, rapport] }, { tafelPages: { rapport: true } }).boardPages.map((p) => p.title).sort()).toEqual(['Erste Führung', 'Rapport'])
    expect(build({ tafel: [blankEf] }, { tafelPages: { ef: true } }).boardPages).toEqual([])
  })
})
