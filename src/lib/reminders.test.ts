import { describe, expect, it } from 'vitest'
import { deriveReminders, isDue, openReRaises, suggestPendenzen } from './reminders'
import type { TimelineEvent } from '../types'

// timeline is stored newest-first (App prepends), so fixtures list newest rows first.
const row = (id: string, text: string, reminder: TimelineEvent['reminder'], at = '2026-06-24T03:00:00.000Z'): TimelineEvent =>
  ({ id, t: '03:00', at, icon: 'clock', text, kind: 'reminder', surface: 'map', reminder })

describe('deriveReminders', () => {
  it('returns a created reminder as open with its due time', () => {
    const tl = [row('r1', 'Lüfter prüfen', { op: 'created', id: 'a', dueAt: '2026-06-24T03:10:00.000Z' })]
    const open = deriveReminders(tl)
    expect(open).toHaveLength(1)
    expect(open[0]).toMatchObject({ id: 'a', rowId: 'r1', text: 'Lüfter prüfen', dueAt: '2026-06-24T03:10:00.000Z' })
  })

  // The pinned block and the fällig banner print the Fälligkeit themselves, so what they want
  // from the row is the bare Wiedervorlage — not «Erinnerung gesetzt für 12:06: Pizza …», which
  // read as the same time twice on one line.
  it('prefers the bare reminder text over the composed row text', () => {
    const tl = [row('r1', 'Erinnerung gesetzt für 12:06: Pizza bestellen',
      { op: 'created', id: 'a', dueAt: '2026-06-24T10:06:00.000Z', text: 'Pizza bestellen' })]
    expect(deriveReminders(tl)[0].text).toBe('Pizza bestellen')
  })

  // …and rows written before `reminder.text` existed are still in the append-only record and
  // still open, so the lead-in is peeled off their text instead.
  it('strips the «Erinnerung gesetzt für …» lead-in from an older row', () => {
    const tl = [row('r1', 'Erinnerung gesetzt für 12:06: Pizza bestellen',
      { op: 'created', id: 'a', dueAt: '2026-06-24T10:06:00.000Z' })]
    expect(deriveReminders(tl)[0].text).toBe('Pizza bestellen')
  })

  it('leaves a row that does not carry the lead-in untouched', () => {
    const tl = [row('r1', 'Lüfter prüfen', { op: 'created', id: 'a', dueAt: '2026-06-24T03:10:00.000Z' })]
    expect(deriveReminders(tl)[0].text).toBe('Lüfter prüfen')
  })

  it('drops a reminder once a later done row references it', () => {
    const tl = [
      row('r2', 'erledigt', { op: 'done', id: 'a' }),
      row('r1', 'Lüfter prüfen', { op: 'created', id: 'a', dueAt: '2026-06-24T03:10:00.000Z' }),
    ]
    expect(deriveReminders(tl)).toHaveLength(0)
  })

  // «Rückgängig» on an erledigt toast is a NEW row beside the done one — append-only — and the
  // item is open again with the due time it had
  it('reopens an item a later `reopened` row takes back, keeping its due time', () => {
    const tl = [
      row('r3', 'wieder offen', { op: 'reopened', id: 'a' }),
      row('r2', 'erledigt', { op: 'done', id: 'a' }),
      row('r1', 'Lüfter prüfen', { op: 'created', id: 'a', dueAt: '2026-06-24T03:10:00.000Z' }),
    ]
    expect(deriveReminders(tl)).toMatchObject([{ id: 'a', rowId: 'r1', dueAt: '2026-06-24T03:10:00.000Z' }])
    // …and a done AFTER the reopen closes it again: the latest op wins
    expect(deriveReminders([row('r4', 'erledigt', { op: 'done', id: 'a' }), ...tl])).toHaveLength(0)
  })

  it('applies the latest snooze as the effective due time', () => {
    const tl = [
      row('r2', '+10', { op: 'snoozed', id: 'a', dueAt: '2026-06-24T03:20:00.000Z' }),
      row('r1', 'Lüfter prüfen', { op: 'created', id: 'a', dueAt: '2026-06-24T03:10:00.000Z' }),
    ]
    expect(deriveReminders(tl)[0].dueAt).toBe('2026-06-24T03:20:00.000Z')
  })

  it('a snooze without an explicit dueAt keeps the previous due', () => {
    const tl = [
      row('r2', 'snooze', { op: 'snoozed', id: 'a' }),
      row('r1', 'x', { op: 'created', id: 'a', dueAt: '2026-06-24T03:10:00.000Z' }),
    ]
    expect(deriveReminders(tl)[0].dueAt).toBe('2026-06-24T03:10:00.000Z')
  })

  // ⚠️ REVERSED, deliberately. A `created` row without a due used to be treated as malformed and
  // dropped, because the only way to make one was the Erinnerung mode, which demands a Fälligkeit.
  // No due is now the ordinary Pendenz — so the same shape has to be kept, not skipped.
  it('keeps a created row that has no due (that is a Pendenz, not a malformed reminder)', () => {
    const tl = [row('r1', 'x', { op: 'created', id: 'a' })]
    expect(deriveReminders(tl)).toHaveLength(1)
  })

  it('ignores non-reminder rows', () => {
    const tl: TimelineEvent[] = [{ id: 'x', t: '03:00', icon: 'type', text: 'note', kind: 'journal' }]
    expect(deriveReminders(tl)).toHaveLength(0)
  })
})

// A Pendenz is a `created` event WITHOUT a dueAt. It never alarms — there are no check-ins on a
// Schadenplatz, so a Fälligkeit on an Auftrag would only be alerting yourself.
describe('deriveReminders — Pendenzen (no due time)', () => {
  it('keeps a created row that has no dueAt', () => {
    const tl = [row('r1', 'Absperrmaterial', { op: 'created', id: 'a', text: 'Absperrmaterial' })]
    const open = deriveReminders(tl)
    expect(open).toHaveLength(1)
    expect(open[0].dueAt).toBeUndefined()
  })

  it('an undated Pendenz is never due', () => {
    const tl = [row('r1', 'x', { op: 'created', id: 'a', text: 'x' })]
    expect(isDue(deriveReminders(tl)[0], Date.now() + 10 ** 9)).toBe(false)
  })

  // The closure rule exists to stop stale ALARMS on a reopened incident. An undatierte Pendenz
  // cannot alarm and is genuinely unfinished — dropping it would hide the one thing somebody has
  // to take away from the Einsatz.
  it('survives the Einsatzende, unlike a stale timed Erinnerung', () => {
    const tl = [
      row('r2', 'stale', { op: 'created', id: 'timed', dueAt: '2026-06-24T01:00:00.000Z' }),
      row('r1', 'offen', { op: 'created', id: 'pend', text: 'offen' }),
    ]
    expect(deriveReminders(tl, '2026-06-24T02:00:00.000Z').map((r) => r.id)).toEqual(['pend'])
  })

  it('sorts dringend first, then oldest first', () => {
    const tl = [
      row('r3', 'neu', { op: 'created', id: 'c', text: 'neu' }, '2026-06-24T03:30:00.000Z'),
      row('r2', 'dringend', { op: 'created', id: 'b', text: 'dringend', urgent: true }, '2026-06-24T03:20:00.000Z'),
      row('r1', 'alt', { op: 'created', id: 'a', text: 'alt' }, '2026-06-24T03:00:00.000Z'),
    ]
    expect(deriveReminders(tl).map((r) => r.id)).toEqual(['b', 'a', 'c'])
  })

  it('carries the assignee read off the sentence', () => {
    const tl = [row('r1', 'x', { op: 'created', id: 'a', text: 'x', assignee: 'Werkhof Oberwil' })]
    expect(deriveReminders(tl)[0].assignee).toBe('Werkhof Oberwil')
  })
})

// Meldungen: a third op that reports on an item without opening or closing it.
describe('deriveReminders — Meldungen', () => {
  const created = row('r1', 'Absperrmaterial', { op: 'created', id: 'a', text: 'Absperrmaterial' }, '2026-06-24T03:00:00.000Z')

  it('lists every Meldung on the item, oldest first', () => {
    const tl = [
      row('r3', 'Material vor Ort', { op: 'note', id: 'a' }, '2026-06-24T03:33:00.000Z'),
      row('r2', 'Fahrzeug unterwegs', { op: 'note', id: 'a' }, '2026-06-24T03:19:00.000Z'),
      created,
    ]
    const [r] = deriveReminders(tl)
    // ⚠️ ALL of them, oldest first — the item's row is the only place the thread reads as one
    expect(r.notes.map((n) => n.text)).toEqual(['Fahrzeug unterwegs', 'Material vor Ort'])
  })

  // ⚠️ The one that matters: a Meldung must never resurrect a closed item, whatever order the
  // rows merged in.
  it('does not reopen an item a later done row closed', () => {
    const tl = [
      row('r3', 'noch was', { op: 'note', id: 'a' }, '2026-06-24T03:40:00.000Z'),
      row('r2', 'erledigt', { op: 'done', id: 'a' }, '2026-06-24T03:35:00.000Z'),
      created,
    ]
    expect(deriveReminders(tl)).toHaveLength(0)
  })

  // ⚠️ Nothing WRITES this today — the composer's switch is hidden while writing a Meldung, because
  // a control on one Meldung that re-ranks the whole Pendenz is not what it looks like. The reducer
  // stays tolerant of it so the action can be given its own control without a second reducer.
  it('takes urgency from whatever event carries it, latest wins', () => {
    const tl = [
      row('r2', 'wird eng', { op: 'note', id: 'a', urgent: true }, '2026-06-24T03:20:00.000Z'),
      created,
    ]
    expect(deriveReminders(tl)[0].urgent).toBe(true)
  })

  // ⚠️ «Werkhof meldet 20 Minuten» is exactly the moment the Wiedervorlage moves — and it has to
  // move WITHOUT taking the sentence out of the item's thread, which a separate snooze row would.
  it('moves the due time when a Meldung carries one, and stays in the thread', () => {
    const tl = [
      row('r2', 'Werkhof meldet 20 Minuten', { op: 'note', id: 'a', dueAt: '2026-06-24T03:40:00.000Z' }, '2026-06-24T03:20:00.000Z'),
      row('r1', 'Absperrmaterial', { op: 'created', id: 'a', text: 'Absperrmaterial', dueAt: '2026-06-24T03:10:00.000Z' }),
    ]
    const [r] = deriveReminders(tl)
    expect(r.dueAt).toBe('2026-06-24T03:40:00.000Z')
    expect(r.notes.map((n) => n.text)).toEqual(['Werkhof meldet 20 Minuten'])
  })

  // …and it stays a note in every other respect: it must not reopen what a done row closed.
  it('does not reopen a closed item through a Meldung that carries a due time', () => {
    const tl = [
      row('r3', 'doch noch offen?', { op: 'note', id: 'a', dueAt: '2026-06-24T03:50:00.000Z' }, '2026-06-24T03:45:00.000Z'),
      row('r2', 'erledigt', { op: 'done', id: 'a' }, '2026-06-24T03:35:00.000Z'),
      created,
    ]
    expect(deriveReminders(tl)).toHaveLength(0)
  })
})

describe('isDue', () => {
  const r = { id: 'a', rowId: 'r1', text: 'x', dueAt: '2026-06-24T03:10:00.000Z', createdAt: '', notes: [] }
  it('is false before the due time', () => {
    expect(isDue(r, Date.parse('2026-06-24T03:09:59.000Z'))).toBe(false)
  })
  it('is true at/after the due time', () => {
    expect(isDue(r, Date.parse('2026-06-24T03:10:00.000Z'))).toBe(true)
    expect(isDue(r, Date.parse('2026-06-24T03:11:00.000Z'))).toBe(true)
  })
})

describe('deriveReminders — expired by closure (Einsatzende)', () => {
  const created = (id: string, dueAt: string): TimelineEvent => ({
    id: `row-${id}`, t: '10:00', at: '2026-07-02T10:00:00Z', icon: 'clock', text: id,
    kind: 'reminder', reminder: { op: 'created', id, dueAt },
  })

  it('drops reminders due before closed_at, keeps ones due after', () => {
    const closed = '2026-07-02T18:00:00Z'
    const open = deriveReminders(
      [created('stale', '2026-07-02T12:00:00Z'), created('future', '2026-07-30T09:00:00Z')],
      closed,
    )
    expect(open.map((r) => r.id)).toEqual(['future'])
  })

  it('without a closed_at everything stays open (live incident unchanged)', () => {
    const open = deriveReminders([created('a', '2026-07-02T12:00:00Z')])
    expect(open.map((r) => r.id)).toEqual(['a'])
  })
})

// What the composer offers while an entry is being typed: an open item the sentence already names.
describe('suggestPendenzen', () => {
  const open = deriveReminders([
    row('r2', 'Patient an Sanität übergeben', { op: 'created', id: 'b', text: 'Patient an Sanität übergeben' }, '2026-06-24T03:10:00.000Z'),
    row('r1', 'Absperrmaterial Kreuzung, Werkhof Oberwil', { op: 'created', id: 'a', text: 'Absperrmaterial Kreuzung, Werkhof Oberwil' }, '2026-06-24T03:00:00.000Z'),
  ])

  it('offers the item a word of the sentence names', () => {
    expect(suggestPendenzen('Werkhof meldet Fahrzeug unterwegs', open).map((r) => r.id)).toEqual(['a'])
  })

  // ⚠️ The one that matters. Accepting a suggestion changes what the entry IS, so a subsequence
  // coincidence («…s-A-N-I-tät» inside an unrelated sentence) must not offer itself.
  it('does not match letters scattered through unrelated words', () => {
    expect(suggestPendenzen('Sonstige Anmerkung ist tabellarisch', open)).toEqual([])
  })

  it('matches across punctuation inside the item', () => {
    expect(suggestPendenzen('Kreuzung gesperrt', open).map((r) => r.id)).toEqual(['a'])
  })

  it('says nothing for a sentence that names none of them', () => {
    expect(suggestPendenzen('Lüfter im Erdgeschoss gestellt', open)).toEqual([])
  })

  it('ignores single letters and empty input', () => {
    expect(suggestPendenzen('a', open)).toEqual([])
    expect(suggestPendenzen('', open)).toEqual([])
  })
})

// «wieder in …» is a one-time action (05.11.2026: a double tap raised two): its done state is read
// off the record – the item a re-raise points back at (`again`), while that re-raise is open
describe('openReRaises', () => {
  const again = row('n1', 'Erinnerung gesetzt für 03:30: Lagerapport', { op: 'created', id: 'p2', dueAt: '2026-06-24T03:30:00.000Z', text: 'Lagerapport', again: 'p1' })
  it('names the closed item and how far ahead its open re-raise was set', () => {
    expect(openReRaises([again], [{ id: 'p2' }])).toEqual(new Map([['p1', 30]]))
  })
  it('lets go once the re-raise is closed too – its own done row offers the next one', () => {
    expect(openReRaises([again], []).size).toBe(0)
  })
})
