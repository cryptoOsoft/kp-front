// @vitest-environment jsdom
import { act, renderHook } from '@testing-library/react'
import { useEffect, useState } from 'react'
import { describe, expect, it } from 'vitest'
import { milestoneRows, useChecklistActions } from './useChecklistActions'
import { useUndoableSlice, type UndoableSlice } from './useUndoableSlice'
import { createUndoTimeline } from './undoTimeline'
import type { ChecklistState, ChecklistTemplate, Item } from './checklists'

const standort: Item = { id: 'i1', text: 'Standort Führungsunterstützung bestimmen', milestone: true }
const plain: Item = { id: 'i2', text: 'Funkkanal prüfen' }
const template = { id: 'fu', kind: 'action', title: 'Aufgaben FU', version: 1, source: 'test', phases: [] } as unknown as ChecklistTemplate

describe('milestoneRows — what a change of ticks writes', () => {
  const on: ChecklistState = { fu: { ticks: { i1: { t: '2026-09-23T08:24:00Z' } } } }
  const off: ChecklistState = { fu: { ticks: {} } }
  const known = new Map([['fu\u0000i1', standort.text]])

  it('☑ for a milestone that became ticked, the correction for one that became un-ticked', () => {
    expect(milestoneRows(off, on, known)).toEqual([{ icon: 'check', text: '☑ Standort Führungsunterstützung bestimmen' }])
    expect(milestoneRows(on, off, known)).toEqual([{ icon: 'undo', text: 'Meilenstein zurückgenommen: Standort Führungsunterstützung bestimmen' }])
  })

  it('nothing for an unchanged state, nor for an item that is no milestone', () => {
    expect(milestoneRows(on, on, known)).toEqual([])
    expect(milestoneRows({ fu: { ticks: {} } }, { fu: { ticks: { i2: { t: 'x' } } } }, known)).toEqual([])
  })
})

/** The Checklisten wired the way IncidentWorkspace wires them: the slice's own history, one
 *  timeline entry per write, and the entry asking `describeStep` before the generic row. The
 *  live pieces sit in a plain box beside the hook — the entries outlive the render that pushed
 *  them, which is what the workspace's refs are for. */
function harness() {
  const timeline = createUndoTimeline()
  const rows: string[] = []
  const box: { hist?: UndoableSlice<ChecklistState>; describe?: (m: { from: ChecklistState; to: ChecklistState }) => boolean } = {}
  const stepOf = (moved: { from: ChecklistState; to: ChecklistState } | null, dir: string) => {
    if (!moved) return false
    if (!box.describe?.(moved)) rows.push(`Checkliste ${dir}`)
    return true
  }
  const set: UndoableSlice<ChecklistState>['set'] = (u) => {
    const laid = box.hist!.set(u)
    timeline.push({
      domain: 'checkliste', label: 'Checkliste',
      undo: () => stepOf(box.hist!.undo(), 'rückgängig gemacht'),
      redo: () => stepOf(box.hist!.redo(), 'wiederhergestellt'),
    })
    return laid
  }
  const log = (_icon: string, text: string) => { rows.push(text) }
  function useHarness() {
    const [checklists, setChecklists] = useState<ChecklistState>({})
    const hist = useUndoableSlice(checklists, setChecklists)
    const actions = useChecklistActions({ canTick: true, checklists, setChecklists: set, authorName: 'FU', log, emit: () => {} })
    useEffect(() => { box.hist = hist; box.describe = actions.describeStep })
    return { ...actions, timeline, rows, checklists }
  }
  return useHarness
}

describe('useChecklistActions — un-ticking a milestone is a correction row, by every door', () => {
  it('a tap un-tick appends «Meilenstein zurückgenommen», a re-tick ☑ again', () => {
    const { result } = renderHook(harness())
    act(() => result.current.toggleTick(template, standort))
    act(() => result.current.toggleTick(template, standort))
    act(() => result.current.toggleTick(template, standort))
    expect(result.current.rows).toEqual([
      '☑ Standort Führungsunterstützung bestimmen',
      'Meilenstein zurückgenommen: Standort Führungsunterstützung bestimmen',
      '☑ Standort Führungsunterstützung bestimmen',
    ])
  })

  it('↶ of a tick writes exactly ONE correction, ↷ one ☑ — every time round the loop', () => {
    const { result } = renderHook(harness())
    act(() => result.current.toggleTick(template, standort))
    for (let i = 0; i < 2; i++) {
      act(() => { result.current.timeline.undo() })
      act(() => { result.current.timeline.redo() })
    }
    expect(result.current.rows).toEqual([
      '☑ Standort Führungsunterstützung bestimmen',
      'Meilenstein zurückgenommen: Standort Führungsunterstützung bestimmen',
      '☑ Standort Führungsunterstützung bestimmen',
      'Meilenstein zurückgenommen: Standort Führungsunterstützung bestimmen',
      '☑ Standort Führungsunterstützung bestimmen',
    ])
    expect(result.current.checklists.fu.ticks.i1).toBeTruthy()
  })

  it('↶ of a tap UN-tick puts the ☑ back, and never adds the generic row beside it', () => {
    const { result } = renderHook(harness())
    act(() => result.current.toggleTick(template, standort))
    act(() => result.current.toggleTick(template, standort))
    act(() => { result.current.timeline.undo() })
    expect(result.current.rows.slice(-1)).toEqual(['☑ Standort Führungsunterstützung bestimmen'])
    expect(result.current.rows.some((r) => r.startsWith('Checkliste'))).toBe(false)
  })

  it('a non-milestone stays silent on a tap and keeps the generic row on ↶', () => {
    const { result } = renderHook(harness())
    act(() => result.current.toggleTick(template, plain))
    expect(result.current.rows).toEqual([])
    act(() => { result.current.timeline.undo() })
    expect(result.current.rows).toEqual(['Checkliste rückgängig gemacht'])
  })
})

describe('useChecklistActions — a problem\'s Tendenz outlives an un-tick (staging review 06.11.2026, S4)', () => {
  const problems = { ...template, id: 'pe', problems: true } as ChecklistTemplate
  const energie: Item = { id: 'f1', text: 'Energieträger' }
  const trendOf = (cl: ChecklistState) => cl.pe?.trends?.f1

  it('un-ticked in the checklist and ticked again, the problem has its Tendenz back', () => {
    const { result } = renderHook(harness())
    act(() => result.current.toggleTick(problems, energie))
    act(() => result.current.setTrend(problems, energie, 'up'))
    act(() => result.current.toggleTick(problems, energie))
    expect(result.current.checklists.pe.ticks.f1).toBeUndefined()
    act(() => result.current.toggleTick(problems, energie))
    expect(result.current.checklists.pe.ticks.f1).toBeTruthy()
    expect(trendOf(result.current.checklists)).toBe('up')
  })

  it('deleted on the Tafel (un-ticked there), the Tendenz stays for a re-tick; none is set on an item not ticked', () => {
    const { result } = renderHook(harness())
    act(() => result.current.toggleTick(problems, energie))
    act(() => result.current.applyTickWrites([{ tpl: 'pe', item: 'f1', trend: 'down' }]))
    act(() => result.current.applyTickWrites([{ tpl: 'pe', item: 'f1', untick: true }]))
    expect(result.current.checklists.pe.ticks.f1).toBeUndefined()
    expect(trendOf(result.current.checklists)).toBe('down')
    act(() => result.current.setTrend(problems, energie, 'same')) // not ticked: nothing to set
    expect(trendOf(result.current.checklists)).toBe('down')
    act(() => result.current.applyTickWrites([{ tpl: 'pe', item: 'f1', trend: null }])) // nor to clear
    expect(trendOf(result.current.checklists)).toBe('down')
  })
})
