// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest'
import { renderHook } from '@testing-library/react'
import { useTafelPendenzen, type TafelPendenzenSources } from './useTafelPendenzen'
import { pendenzLedger } from '../lib/reminders'
import { createUndoTimeline } from '../lib/undoTimeline'
import type { TimelineEvent } from '../types'

/** the workspace's append-only Verlauf, newest first, re-rendered into the hook after each write */
function setup() {
  let rows: TimelineEvent[] = [{ id: 'j1', t: '', at: '2026-11-05T13:14:00.000Z', icon: 'type', text: 'Auftrag · Strom abschalten', kind: 'journal', reminder: { op: 'created', id: 'a', text: 'Strom abschalten', assignee: 'Of Zürcher' } }]
  let n = 1
  const undoHist = createUndoTimeline()
  const emit = vi.fn()
  const append: TafelPendenzenSources['pushEvent'] = (ev, id) => { n += 1; rows = [{ id: id ?? `j${n}`, t: '', at: ev.at ?? `2026-11-05T13:${20 + n}:00.000Z`, ...ev }, ...rows]; hook.rerender() }
  const src = (): TafelPendenzenSources => ({
    tafel: { seed: () => ({}) }, timeline: rows, reminders: { setDone: vi.fn() }, emit, canWrite: true, pushEvent: append,
    setJournalOpen: vi.fn(), setJournalLandOn: vi.fn(), undoHist, incidentId: 'inc', board: {}, showPlan: vi.fn(),
  })
  const hook = renderHook(() => useTafelPendenzen(src()))
  const port = () => hook.result.current.tafel!.pendenzen!
  const item = () => pendenzLedger(rows)[0]
  return { rows: () => rows, port, item, undoHist, emit, append }
}

describe('the «Aufträge / Pendenzen» page writes the Verlauf', () => {
  it('a row typed on the page is a created row on the Tafel sheet, in the audit too', () => {
    const t = setup()
    const made = t.port().create({ text: 'Gemeinde informieren', assignee: 'EL' }, 'Aufträge / Pendenzen')!
    expect(t.rows()[0]).toMatchObject({ id: made.rowId, at: made.at, surface: 'plan', planId: 'tafel', reminder: { op: 'created', origin: 'tafel', assignee: 'EL' } })
    expect(t.emit).toHaveBeenCalledWith('reminder.create', { id: t.rows()[0].reminder!.id })
  })

  it('a correction of Wer is one ↶ step, taken back by a correction to the old Wer', () => {
    const t = setup()
    t.port().edit(t.item(), { assignee: 'Lt Brunner' })
    expect(t.item().assignee).toBe('Lt Brunner')
    expect(t.undoHist.undo().status).toBe('done')
    expect(t.item().assignee).toBe('Of Zürcher')
    expect(t.rows().map((r) => r.reminder?.op)).toEqual(['note', 'note', 'created']) // append-only both ways
    expect(t.undoHist.redo().status).toBe('done')
    expect(t.item().assignee).toBe('Lt Brunner')
  })

  it('a stale ↶ does not overwrite a colleague\'s correction made meanwhile', () => {
    const t = setup()
    t.port().edit(t.item(), { assignee: 'Lt Brunner' })
    // another device's correction, merged into the same Verlauf (no step on THIS timeline)
    t.append({ icon: 'easel', kind: 'reminder', text: 'geändert', reminder: { op: 'note', id: 'a', edit: { assignee: 'Fourier Meier' } } })
    const before = t.rows().length
    expect(t.undoHist.undo().status).toBe('lost')
    expect(t.rows().length).toBe(before)
    expect(t.item().assignee).toBe('Fourier Meier')
  })
})
