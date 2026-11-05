import { describe, expect, it, vi } from 'vitest'
import { completeReminder, reopenReminder, type ReminderEvent } from './useReminders'
import { deriveReminders } from './reminders'
import { createUndoTimeline } from './undoTimeline'
import type { TimelineEvent } from '../types'

const copy = {
  doneLog: 'Erinnerung erledigt: {text}', pendenzDoneLog: 'Pendenz erledigt: {text}',
  reopenLog: 'Erinnerung wieder offen: {text}', pendenzReopenLog: 'Pendenz wieder offen: {text}',
}

/** An append-only Verlauf (newest first, the way the workspace stores it), with the open set
 *  derived from it exactly as useReminders does — so every step is checked against the record. */
function verlauf() {
  let seq = 0
  const rows: TimelineEvent[] = [{
    id: 'e0', t: '03:00', at: '2026-09-23T03:00:00.000Z', icon: 'type', text: 'Auftrag · Absperrmaterial holen', kind: 'journal',
    reminder: { op: 'created', id: 'p1', text: 'Absperrmaterial holen' },
  }]
  const append = (ev: ReminderEvent) => {
    seq += 1
    rows.unshift({ id: `e${seq}`, t: '03:00', at: `2026-09-23T03:${String(seq).padStart(2, '0')}:00.000Z`, icon: ev.icon, text: ev.text, kind: 'reminder', reminder: ev.reminder })
  }
  const isOpen = (id: string) => deriveReminders(rows).some((r) => r.id === id)
  return { rows, append, isOpen, item: () => deriveReminders(rows)[0] }
}

describe('completeReminder — «Erledigt» is confirm-with-undo', () => {
  it('closes at once and announces «Pendenz erledigt: …» with a Rückgängig', () => {
    const v = verlauf()
    const announce = vi.fn()
    completeReminder(v.item(), { ...v, copy, announce })
    expect(v.isOpen('p1')).toBe(false)
    expect(v.rows[0]).toMatchObject({ text: 'Pendenz erledigt: Absperrmaterial holen', reminder: { op: 'done', id: 'p1' } })
    expect(announce).toHaveBeenCalledWith('Pendenz erledigt: Absperrmaterial holen', expect.any(Function))
  })

  it('the toast\'s Rückgängig APPENDS «wieder offen» and drops its ↶ entry — never undoable twice', () => {
    const v = verlauf()
    const timeline = createUndoTimeline()
    let onUndo = () => {}
    completeReminder(v.item(), { ...v, copy, timeline, announce: (_t, u) => { onUndo = u } })
    expect(timeline.canUndo()).toBe(true)
    onUndo()
    expect(v.isOpen('p1')).toBe(true)
    expect(v.rows.map((r) => r.text)).toEqual([
      'Pendenz wieder offen: Absperrmaterial holen', 'Pendenz erledigt: Absperrmaterial holen', 'Auftrag · Absperrmaterial holen',
    ])
    expect(v.rows[0]).toMatchObject({ icon: 'undo', reminder: { op: 'reopened', id: 'p1' } })
    expect(timeline.canUndo()).toBe(false)
    expect(timeline.canRedo()).toBe(false)
    // a second tap on the same toast writes nothing: the item is already open
    onUndo()
    expect(v.rows).toHaveLength(3)
  })

  it('↶ reopens and ↷ closes again, each one appended row, and a stale step writes nothing', () => {
    const v = verlauf()
    const timeline = createUndoTimeline()
    let onUndo = () => {}
    completeReminder(v.item(), { ...v, copy, timeline, announce: (_t, u) => { onUndo = u } })
    expect(timeline.undo().status).toBe('done')
    expect(v.isOpen('p1')).toBe(true)
    expect(timeline.redo().status).toBe('done')
    expect(v.isOpen('p1')).toBe(false)
    expect(v.rows.map((r) => r.reminder?.op)).toEqual(['done', 'reopened', 'done', 'created'])
    // ↶ already took it back → the toast's Rückgängig must not write a second «wieder offen»
    timeline.undo()
    const before = v.rows.length
    onUndo()
    expect(v.rows).toHaveLength(before)
    // somebody else closed it meanwhile → ↷ is lost, not a second done row
    v.append({ icon: 'check', text: 'Pendenz erledigt: Absperrmaterial holen', reminder: { op: 'done', id: 'p1' } })
    expect(timeline.redo().status).toBe('lost')
    expect(v.rows).toHaveLength(before + 1)
  })

  it('an Erinnerung keeps its own word both ways', () => {
    const v = verlauf()
    const r = { ...v.item(), dueAt: '2026-09-23T04:00:00.000Z' }
    let onUndo = () => {}
    completeReminder(r, { ...v, copy, announce: (_t, u) => { onUndo = u } })
    onUndo()
    expect(v.rows.slice(0, 2).map((x) => x.text)).toEqual(['Erinnerung wieder offen: Absperrmaterial holen', 'Erinnerung erledigt: Absperrmaterial holen'])
  })
})

// the Tafel's «Aufträge / Pendenzen» page un-ticks an «Erledigt» (05.11.2026)
describe('reopenReminder — un-ticking is the same act the other way', () => {
  it('appends «wieder offen», ↶ closes again, and an item already open writes nothing', () => {
    const v = verlauf()
    const timeline = createUndoTimeline()
    const item = v.item()
    reopenReminder(item, { ...v, copy, timeline })
    expect(v.rows).toHaveLength(1) // open already: nothing happened, nothing to take back
    expect(timeline.canUndo()).toBe(false)
    completeReminder(item, { ...v, copy })
    reopenReminder(item, { ...v, copy, timeline })
    expect(v.isOpen('p1')).toBe(true)
    expect(v.rows[0]).toMatchObject({ text: 'Pendenz wieder offen: Absperrmaterial holen', reminder: { op: 'reopened', id: 'p1' } })
    expect(timeline.undo().status).toBe('done')
    expect(v.isOpen('p1')).toBe(false)
    expect(v.rows.map((r) => r.reminder?.op)).toEqual(['done', 'reopened', 'done', 'created'])
  })
})
