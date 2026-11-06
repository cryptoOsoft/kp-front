// @vitest-environment jsdom
import { StrictMode } from 'react'
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest'
import { act, render, screen, cleanup, fireEvent, waitFor } from '@testing-library/react'
import { Journal } from './Journal'
import type { BoardAnno, TimelineEvent } from '../types'
import { liveTargets } from '../lib/verlauf'
import type { OpenReminder } from '../lib/reminders'

afterEach(cleanup)

const row = (id: string, at: number, text: string): TimelineEvent => ({
  id, t: '', at: new Date(at).toISOString(), text, icon: 'type', kind: 'journal',
})

// newest first, the order the Verlauf renders in
const events = [
  row('r3', 1_060_000, 'Feuer aus'),
  row('r2', 1_040_000, 'Trupp 1 im Einsatz'),
  row('r1', 1_010_000, 'Erkundung Nordseite läuft'),
]

const cls = (id: string) => document.querySelector(`[data-ev="${id}"]`)?.className ?? ''

/** ⚠️ Rendered in <StrictMode>, like the app itself (main.tsx). React runs every effect twice in
 *  development — effect, cleanup, effect — and an «already done» ref written on the first run
 *  makes the second run a no-op. That is not a hypothetical: the landing below shipped with such
 *  a guard and was dead code in dev, so «im Verlauf» opened the Verlauf and never scrolled. A
 *  test that mounts plainly cannot see it. */
function setup(over: Partial<React.ComponentProps<typeof Journal>> = {}) {
  const props: React.ComponentProps<typeof Journal> = {
    events, plans: [], live: liveTargets([], [{ id: 'geb' }], { geb: [{ id: 's7' } as BoardAnno] }), onSelect: vi.fn(), onClose: vi.fn(), ...over,
  }
  render(<StrictMode><Journal {...props} /></StrictMode>)
  return props
}

describe('Journal · landing on one row («im Verlauf» on the Wiedergabe caption)', () => {
  // ⚠️ The frames are the TEST's to hand out, not the machine's. jsdom never lays the list out, so
  // the landing waits its ~20 frames for a height that never comes and then lands anyway — and on
  // real frames that is ~350 ms idle but well over a second under a loaded full suite, where a
  // `waitFor` (1 s) gave up first. Faked, the same frames run in the same order every time.
  beforeEach(() => { vi.useFakeTimers({ toFake: ['requestAnimationFrame', 'cancelAnimationFrame', 'setTimeout', 'clearTimeout'] }) })
  afterEach(() => { vi.useRealTimers() })

  it('⚠️ survives StrictMode’s double mount — the landing must not be a one-shot', () => {
    setup({ landOn: { id: 'r2', nonce: 1 } })
    // a second of frames — past the give-up-on-layout, short of the flash's 2 s fade
    act(() => { vi.advanceTimersByTime(1000) })
    expect(cls('r2')).toContain('jr-flash')
    expect(cls('r1')).not.toContain('jr-flash')
    expect(cls('r3')).not.toContain('jr-flash')
  })
})

describe('Journal · alongside a Wiedergabe', () => {
  it('⚠️ dims the rows the playhead has not reached — they had not been written yet', () => {
    setup({ replayAtMs: 1_040_000 })
    expect(cls('r3')).toContain('jr-future')
    // the row the playhead stands in, and everything before it, are the present and the past
    expect(cls('r2')).not.toContain('jr-future')
    expect(cls('r1')).not.toContain('jr-future')
  })

  it('a row sets the MOMENT instead of flying to a place', () => {
    const onSeekTo = vi.fn()
    const onSelect = vi.fn()
    setup({ replayAtMs: 1_040_000, onSeekTo, onSelect })
    fireEvent.click(screen.getByText('Erkundung Nordseite läuft'))
    expect(onSeekTo).toHaveBeenCalledWith(expect.objectContaining({ id: 'r1' }))
    expect(onSelect).not.toHaveBeenCalled()
  })

  it('…and with no replay running a row that has no place stays inert', () => {
    const onSelect = vi.fn()
    setup({ onSelect })
    fireEvent.click(screen.getByText('Erkundung Nordseite läuft'))
    expect(onSelect).not.toHaveBeenCalled()
  })
})

// ── Pendenzen ───────────────────────────────────────────────────────────────────────────────
// The box no longer measures itself — it is its own scroll container, so «does this fit» stopped
// being a question the component has to answer. jsdom has no layout, so what is asserted here is
// structure, content and actions; the heights are a browser's business.

const pendenz = (id: string, text: string, over: Partial<OpenReminder> = {}): OpenReminder => ({
  id, rowId: `row-${id}`, text, createdAt: new Date(1_000_000).toISOString(), notes: [], ...over,
})

describe('Journal · the Pendenzen block', () => {
  const open = [
    pendenz('p1', 'Absperrmaterial Kreuzung', { urgent: true }),
    pendenz('p2', 'Polizei aufgeboten', {
      notes: [
        { rowId: 'n1', text: 'Verkehrsdienst eingerichtet', at: new Date(1_020_000).toISOString() },
        { rowId: 'n2', text: 'Umleitung signalisiert', at: new Date(1_030_000).toISOString() },
      ],
    }),
  ]

  // ⚠️ EVERY item and EVERY Meldung. The block was capped at four rows once, with «12 offen» in
  // its own heading — and showed one Meldung of three, which read as the whole story.
  it('shows every open item with its whole thread', () => {
    setup({ openReminders: open })
    expect(screen.getByText('Absperrmaterial Kreuzung')).toBeTruthy()
    expect(screen.getByText('Polizei aufgeboten')).toBeTruthy()
    expect(screen.getByText('Verkehrsdienst eingerichtet')).toBeTruthy()
    expect(screen.getByText('Umleitung signalisiert')).toBeTruthy()
  })

  // ⚠️ TWO scroll areas, stacked — the box ENTIRELY above the log, never inside it. Nested, the
  // block was sticky and opaque over the list it belonged to: log rows ran behind it and were
  // sliced through their letters at its lower edge. This is the invariant that makes that
  // impossible, and it is the one thing about the arrangement jsdom can actually check.
  it('puts the Pendenzen box beside the log, not inside it', () => {
    setup({ openReminders: open })
    const box = document.querySelector('.jr-pinned')!
    const log = document.querySelector('.history-list')!
    expect(log.contains(box)).toBe(false)
    expect(box.compareDocumentPosition(log) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    // …and every row the landing/jump machinery can reach lives in the log's scrollport
    expect(box.querySelector('[data-ev]')).toBeNull()
  })

  // mock 6A, Verlauf side: who an item is for, and that it was typed on the Tafel — a tap opens it
  it('says «Wer» under an item that has one, and «von der Tafel» opens the page', () => {
    const onOpenTafel = vi.fn()
    setup({ openReminders: [pendenz('p3', 'Gemeinde informieren', { assignee: 'EL', origin: 'tafel' }), pendenz('p4', 'Lüfter holen')], onOpenTafel })
    const rows = document.querySelectorAll('.jr-pinned-row')
    expect(rows[0].querySelector('.jr-pinned-wer')?.textContent).toBe('Wer: EL')
    expect(rows[0].querySelector('.jr-pinned-meta .jr-pinned-from')?.textContent).toBe('von der Tafel')
    expect(rows[1].querySelector('.jr-pinned-meta')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: /von der Tafel/ }))
    expect(onOpenTafel).toHaveBeenCalledTimes(1)
  })

  // Nothing open ⇒ no box, and the log has the whole drawer. That is the state most of an
  // Einsatz is in, and an empty amber frame standing over it would cost height for no content.
  it('draws no box at all when nothing is open', () => {
    setup({ openReminders: [] })
    expect(document.querySelector('.jr-pinned')).toBeNull()
  })

  // ⚠️ «Aufklappen» is GONE. It was the way past a cap on a block that could not scroll itself;
  // the box scrolls now, so a second way to see the same rows would be exactly that.
  it('offers no expand/collapse control — the box scrolls', () => {
    setup({ openReminders: open })
    expect(document.querySelector('.jr-pinned-more')).toBeNull()
    expect(screen.queryByText('Aufklappen')).toBeNull()
  })

  it('tapping an item writes a Meldung on it; the ring ticks it off', () => {
    const onReminderNote = vi.fn()
    const onReminderDone = vi.fn()
    setup({ openReminders: open, onReminderNote, onReminderDone })
    fireEvent.click(screen.getByText('Absperrmaterial Kreuzung'))
    expect(onReminderNote).toHaveBeenCalledWith(expect.objectContaining({ id: 'p1' }))
    fireEvent.click(document.querySelectorAll('.jr-pinned-row .jr-rem')[0])
    expect(onReminderDone).toHaveBeenCalledWith(expect.objectContaining({ id: 'p1' }))
  })

  // A session with neither hand (a viewer, a link) reads the block: the ring and the text are
  // read-outs, not dead buttons (RBAC audit §4, 22.10.2026).
  it('without handlers the ring and the text are read-outs, not buttons', () => {
    setup({ openReminders: open })
    const row = document.querySelector('.jr-pinned-row')!
    expect(row.querySelector('.jr-rem')!.tagName).toBe('SPAN')
    expect(row.querySelector('.jr-pinned-text')!.tagName).toBe('SPAN')
    expect(row.querySelector('button:disabled')).toBeNull()
  })

  // ⚠️ The time column says WHEN IT WAS RAISED — an Auftrag has no Fälligkeit, because nobody
  // checks in on a Schadenplatz. One tap swaps the WHOLE column; a half-clock/half-age column
  // cannot be read.
  it('swaps the whole time column between the clock and the age', () => {
    setup({ openReminders: open })
    const times = () => [...document.querySelectorAll('.jr-when')].map((e) => e.textContent ?? '')
    expect(times().every((t) => /^\d{2}:\d{2}$/.test(t))).toBe(true)
    fireEvent.click(document.querySelector('.jr-when')!)
    expect(times().every((t) => /^\d{2}:\d{2}$/.test(t))).toBe(false)
    expect(times()).toHaveLength(open.length)
  })

  // ⚠️ The ring ticks off in BOTH places, and it is the same call in both — one appended `done`
  // row, never a mutation of the row that raised the item. The row's ring was taken away once on
  // the argument that two controls did the same thing; what was actually wrong was that they were
  // two different SHAPES. Same ring, same gesture, same handler.
  it('ticks the same item off from the log row as from the block', () => {
    const onReminderDone = vi.fn()
    setup({
      events: [{ id: 'e1', t: '', at: new Date(1_000_000).toISOString(), text: 'Absperrmaterial Kreuzung',
        icon: 'type', kind: 'journal', reminder: { op: 'created', id: 'p1', text: 'Absperrmaterial Kreuzung' } }],
      openReminders: [pendenz('p1', 'Absperrmaterial Kreuzung')],
      onReminderDone,
    })
    fireEvent.click(document.querySelector('.hist-ev .jr-ic-tick')!)
    expect(onReminderDone).toHaveBeenCalledWith(expect.objectContaining({ id: 'p1' }))
    fireEvent.click(document.querySelector('.jr-pinned-row .jr-rem')!)
    expect(onReminderDone).toHaveBeenCalledTimes(2)
    expect(onReminderDone).toHaveBeenLastCalledWith(expect.objectContaining({ id: 'p1' }))
  })

  // …and a row that is already closed is a FACT, not a switch: its green ring says what happened,
  // and there is nothing left to tick.
  it('a closed item’s ring is not a control', () => {
    setup({
      events: [{ id: 'e1', t: '', at: new Date(1_000_000).toISOString(), text: 'Absperrmaterial Kreuzung',
        icon: 'type', kind: 'journal', reminder: { op: 'created', id: 'p1', text: 'Absperrmaterial Kreuzung' } }],
      openReminders: [],
      onReminderDone: vi.fn(),
    })
    expect(document.querySelector('.jr-ring-done')).toBeTruthy()
    expect(document.querySelector('.jr-ic-tick')).toBeNull()
  })

  // ⚠️ A Meldung stands where it happened, among everything else — so it has to name the item it
  // answers, or three «Pendenz» rows in a row are three unrelated sentences.
  it('a Meldung row in the log names the item it belongs to, and jumps to it', () => {
    setup({
      events: [
        { id: 'n1', t: '', at: new Date(1_020_000).toISOString(), text: 'Fahrzeug unterwegs',
          icon: 'type', kind: 'journal', reminder: { op: 'note', id: 'p1' } },
        { id: 'e1', t: '', at: new Date(1_000_000).toISOString(), text: 'Auftrag · Absperrmaterial Kreuzung',
          icon: 'type', kind: 'journal', reminder: { op: 'created', id: 'p1', text: 'Absperrmaterial Kreuzung' } },
      ],
      openReminders: [pendenz('p1', 'Absperrmaterial Kreuzung')],
    })
    const ref = document.querySelector('.jr-note-on') as HTMLButtonElement
    expect(ref.textContent).toContain('Absperrmaterial Kreuzung')
    fireEvent.click(ref)
    expect(cls('e1')).toContain('jr-flash')
  })
})

// ⚠️ The row's text is the ONE string the Verlauf, the Rapport and the hash chain all read
// (lib/journalEntry). The classification column changed what is DRAWN around it, and this pins
// that it changed nothing about the string itself.
// ⚠️ The user's decision (24.09.2026): the pinned block is part of what the funnel narrows —
// hidden under a filter that leaves «Pendenz» unticked, back when it is ticked or cleared.
describe('Journal · the Pendenzen block under the funnel', () => {
  const rows: TimelineEvent[] = [
    { ...row('auf', 1_050_000, 'Auftrag · Trupp 2 sichert'), entryType: 'auftrag' },
    { ...row('pnd', 1_020_000, 'Lüfter nachfordern'), kind: 'reminder', reminder: { op: 'created', id: 'p1' } },
  ]
  const tick = async (word: string) => {
    fireEvent.click(await screen.findByRole('menuitemcheckbox', { name: new RegExp(word) }))
  }

  it('hides the block while only «Auftrag» is ticked, and shows it with «Pendenz» or «Alle zeigen»', async () => {
    setup({ events: rows, openReminders: [pendenz('p1', 'Lüfter nachfordern', { rowId: 'pnd' })] })
    expect(document.querySelector('.jr-pinned')).not.toBeNull()

    fireEvent.click(screen.getByRole('button', { name: 'Verlauf filtern' }))
    await tick('Auftrag')
    await waitFor(() => expect(document.querySelector('.jr-pinned')).toBeNull())

    await tick('Pendenz')
    await waitFor(() => expect(document.querySelector('.jr-pinned')).not.toBeNull())

    await tick('Pendenz') // untick: «Auftrag» alone again
    await waitFor(() => expect(document.querySelector('.jr-pinned')).toBeNull())
    fireEvent.click(document.querySelector('.jr-filter-all')!)
    await waitFor(() => expect(document.querySelector('.jr-pinned')).not.toBeNull())
  })

  // sweep E.9: an Auftrag raised with the ring counts under «Auftrag» AND «Pendenz» – «Alle zeigen»
  // still counts it once
  it('counts a typed Pendenz row under both, and «Alle zeigen» counts rows', async () => {
    const ringed = [...rows, { ...row('rauf', 1_010_000, 'Auftrag · Leiter stellen'), entryType: 'auftrag', reminder: { op: 'created', id: 'p2' } } as TimelineEvent]
    setup({ events: ringed })
    fireEvent.click(screen.getByRole('button', { name: 'Verlauf filtern' }))
    const count = async (word: RegExp) => (await screen.findByRole('menuitemcheckbox', { name: word })).querySelector('.jr-filter-count')?.textContent
    expect(await count(/Pendenz/)).toBe('2')
    expect(await count(/Auftrag/)).toBe('2')
    expect(document.querySelector('.jr-filter-reset .jr-filter-count')?.textContent).toBe('3')
  })
})

describe('Journal · the classification column', () => {
  const auftrag: TimelineEvent = {
    id: 'a1', t: '', at: new Date(1_000_000).toISOString(), icon: 'type', kind: 'journal',
    entryType: 'auftrag', text: 'Auftrag · Trupp 1 Innenangriff über das Treppenhaus',
    reminder: { op: 'created', id: 'p1', text: 'Trupp 1 Innenangriff über das Treppenhaus' },
  }
  const textOf = (id: string) => document.querySelector(`[data-ev="${id}"] .jr-text`)?.textContent ?? ''

  // The PRINT drops the «Auftrag · » prefix because its Bereich column says the word (report ·
  // withoutAreaPrefix). The screen has no such column, so the sentence stays exactly as written.
  it('draws the record’s own string, prefix and all', () => {
    setup({ events: [auftrag], openReminders: [pendenz('p1', 'Trupp 1 Innenangriff über das Treppenhaus')] })
    expect(textOf('a1')).toBe(auftrag.text)
  })

  // ⚠️ It read «AUFTRAG  PENDENZ  Auftrag · Trupp 1 …» — the word twice in a chip and once more
  // in the sentence it was composed into.
  it('says each word once: no Bereich chip, no Pendenz chip', () => {
    setup({ events: [auftrag], openReminders: [pendenz('p1', 'Trupp 1 Innenangriff über das Treppenhaus')] })
    expect(document.querySelectorAll('.jr-chip')).toHaveLength(0)
    expect(document.querySelector('[data-ev="a1"]')!.textContent).not.toContain('Pendenz')
  })

  it('gives the row that raised an item the ring, and the closed one the closed ring', () => {
    setup({
      events: [
        { id: 'd1', t: '', at: new Date(1_030_000).toISOString(), icon: 'check', kind: 'reminder',
          text: 'Pendenz erledigt: Lüfter prüfen', reminder: { op: 'done', id: 'p2' } },
        { id: 'u1', t: '', at: new Date(1_020_000).toISOString(), icon: 'type', kind: 'journal',
          text: 'Lüftungsanlage prüfen', reminder: { op: 'created', id: 'p3' } },
        auftrag,
      ],
      openReminders: [pendenz('p3', 'Lüftungsanlage prüfen', { urgent: true })],
    })
    // p3 is still open and dringend; p1 is gone from the open set, so its row is erledigt
    expect(document.querySelector('[data-ev="u1"] .jr-ring-urgent')).toBeTruthy()
    expect(document.querySelector('[data-ev="a1"] .jr-ring-done')).toBeTruthy()
    expect(document.querySelector('[data-ev="d1"] .jr-ring-done')).toBeTruthy()
  })

  // «wieder in …» — the Führungsrhythmus move: the done row offers the next Wiedervorlage.
  it('offers «wieder in 30/60 min» on a done row, and reports id + minutes', () => {
    const onReminderAgain = vi.fn()
    setup({
      events: [
        { id: 'd1', t: '', at: new Date(1_030_000).toISOString(), icon: 'check', kind: 'reminder',
          text: 'Pendenz erledigt: Lagerapport durchführen', reminder: { op: 'done', id: 'p2' } },
        auftrag,
      ],
      onReminderAgain,
    })
    const chips = document.querySelectorAll('[data-ev="d1"] .jr-again-btn')
    expect(chips).toHaveLength(2)
    // under the sentence, not beside it: there they squeezed it to a word a line (27.10.2026)
    expect(chips[0].closest('.jr-meta')).toBeTruthy()
    fireEvent.click(chips[0])
    expect(onReminderAgain).toHaveBeenCalledWith('p2', 30)
    // …and never on the row that raised the item, or without the handler (viewer/replay)
    expect(document.querySelectorAll('[data-ev="a1"] .jr-again-btn')).toHaveLength(0)
  })

  // ⚠️ «Erledigt» → «Rückgängig» appends `reopened`: the item is open again, and the old done row
  // describes nothing current. It kept the closed ring and offered «wieder in 30», which raised a
  // DUPLICATE of the open item (review 24.09.2026).
  it('a done row whose item was reopened wears no closed ring and offers no «wieder in»', () => {
    const onReminderAgain = vi.fn()
    setup({
      events: [
        { id: 'r1', t: '', at: new Date(1_040_000).toISOString(), icon: 'type', kind: 'reminder',
          text: 'Pendenz wieder offen: Lagerapport durchführen', reminder: { op: 'reopened', id: 'p2' } },
        { id: 'd1', t: '', at: new Date(1_030_000).toISOString(), icon: 'check', kind: 'reminder',
          text: 'Pendenz erledigt: Lagerapport durchführen', reminder: { op: 'done', id: 'p2' } },
        { id: 'c1', t: '', at: new Date(1_000_000).toISOString(), icon: 'type', kind: 'journal',
          text: 'Lagerapport durchführen', reminder: { op: 'created', id: 'p2' } },
      ],
      openReminders: [pendenz('p2', 'Lagerapport durchführen', { rowId: 'c1' })],
      onReminderAgain,
    })
    expect(document.querySelector('[data-ev="d1"] .jr-ring-done')).toBeNull()
    expect(document.querySelectorAll('[data-ev="d1"] .jr-again-btn')).toHaveLength(0)
    // the row that raised it is open again, and says so
    expect(document.querySelector('[data-ev="c1"] .jr-ring-open')).toBeTruthy()
  })

  // a one-time action (05.11.2026: a double tap raised two) – while the item it raised is open,
  // the done row says so instead of offering the chips again
  it('a done row whose «wieder in» is still open shows ✓ «↻ in 30 min gesetzt», no chips', () => {
    setup({
      events: [
        { id: 'n1', t: '', at: new Date(1_040_000).toISOString(), icon: 'bell', kind: 'reminder',
          text: 'Erinnerung gesetzt: Lagerapport durchführen',
          reminder: { op: 'created', id: 'p3', dueAt: new Date(1_040_000 + 30 * 60_000).toISOString(), text: 'Lagerapport durchführen', again: 'p2' } },
        { id: 'd1', t: '', at: new Date(1_030_000).toISOString(), icon: 'check', kind: 'reminder',
          text: 'Pendenz erledigt: Lagerapport durchführen', reminder: { op: 'done', id: 'p2' } },
      ],
      openReminders: [pendenz('p3', 'Lagerapport durchführen', { rowId: 'n1' })],
      onReminderAgain: vi.fn(),
    })
    expect(document.querySelectorAll('[data-ev="d1"] .jr-again-btn')).toHaveLength(0)
    expect(document.querySelector('[data-ev="d1"] [role="status"]')?.textContent).toContain('↻ in 30 min gesetzt')
  })

  it('renders no «wieder in» chips when the handler is absent', () => {
    setup({
      events: [
        { id: 'd1', t: '', at: new Date(1_030_000).toISOString(), icon: 'check', kind: 'reminder',
          text: 'Pendenz erledigt: Lagerapport durchführen', reminder: { op: 'done', id: 'p2' } },
      ],
    })
    expect(document.querySelectorAll('.jr-again-btn')).toHaveLength(0)
  })

  // a Meldung and a snooze are log lines ABOUT the item — they keep their glyph and, for the
  // Meldung, the anchor that names which item it answers
  it('leaves a Meldung row its own glyph', () => {
    setup({
      events: [{ id: 'n1', t: '', at: new Date(1_020_000).toISOString(), icon: 'type', kind: 'journal',
        text: 'Lüfter läuft', reminder: { op: 'note', id: 'p1' } }],
    })
    expect(document.querySelector('[data-ev="n1"] .jr-ring')).toBeNull()
    expect(document.querySelector('[data-ev="n1"] .ic use')?.getAttribute('href')).toBe('#type')
  })

  // «Nachtrag» / «korrigiert HH:MM» / «6×» are footnotes on the row: they belong UNDER the
  // sentence – in front of it they pushed the text off its axis, beside it (in the trail) they
  // took half a phone row and broke «Audionotiz» mid-word (27.10.2026, #12).
  it('puts the footnotes under the sentence, not in the trail', () => {
    const at = new Date(1_060_000).toISOString()
    setup({ events: [{ ...events[0], correctedAt: at }, ...events.slice(1)] })
    const row = document.querySelector('[data-ev="r3"]')!
    const foot = row.querySelector('.jr-foot')!
    expect(foot.textContent).toMatch(/^korrigiert \d{1,2}:\d{2}$/)
    expect(foot.closest('.jr-main')).toBeTruthy()
    expect(foot.closest('.jr-trail')).toBeNull()
    expect(row.querySelector('.jr-text')!.compareDocumentPosition(foot) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  })
})

describe('Journal · correcting a line (append-only)', () => {
  const sysRow: TimelineEvent = {
    id: 's1', t: '', at: new Date(1_050_000).toISOString(),
    text: 'Trupp 2 eingerückt', icon: 'people', kind: 'team',
  }
  // the pen lives in the row's detail sheet since 29.08. (variant 2): tap the row, then the action
  const penInSheet = () => screen.queryByRole('button', { name: 'Text bearbeiten' })

  it('offers the pen — in the row’s detail sheet — on what a person typed', () => {
    setup({ onEditText: vi.fn() })
    fireEvent.click(screen.getByText('Feuer aus'))
    expect(penInSheet()).toBeTruthy()
  })

  // ⚠️ The whole point of the rule: rewriting «Trupp 2 eingerückt» would make the record state
  // an action that never happened that way. A system row opens no detail sheet at all.
  it('never offers it on a row the app wrote about an action', () => {
    setup({ events: [sysRow, ...events], onEditText: vi.fn() })
    fireEvent.click(screen.getByText('Trupp 2 eingerückt'))
    expect(penInSheet()).toBeNull()
  })

  it('is absent entirely for a viewer (no handler)', () => {
    setup()
    fireEvent.click(screen.getByText('Feuer aus'))
    expect(penInSheet()).toBeNull()
  })

  it('patches the row instead of editing it, and drops an empty correction', () => {
    const onEditText = vi.fn()
    setup({ onEditText })
    fireEvent.click(screen.getByText('Feuer aus'))
    fireEvent.click(penInSheet()!)
    const box = screen.getByRole('textbox')
    fireEvent.change(box, { target: { value: '   ' } })
    fireEvent.click(screen.getByText('Speichern'))
    expect(onEditText).not.toHaveBeenCalled()

    fireEvent.click(screen.getByText('Feuer aus'))
    fireEvent.click(penInSheet()!)
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'Feuer aus, Nachkontrolle läuft' } })
    fireEvent.click(screen.getByText('Speichern'))
    expect(onEditText).toHaveBeenCalledWith('r3', 'Feuer aus, Nachkontrolle läuft')
  })

  // the corrected words must never pass for the ones spoken at the time
  it('marks a corrected line with the time of the correction', () => {
    const at = new Date(1_060_000).toISOString()
    setup({ events: [{ ...events[0], correctedAt: at }, ...events.slice(1)] })
    expect(screen.getByText(/^korrigiert \d{1,2}:\d{2}$/)).toBeTruthy()
  })
})

// ── the audio row (variant 2, 29.08.) ───────────────────────────────────────────────────────
// Durchhören and Transkript were ~30px icons beside the play circle — three equal-weight
// targets where only playback is time-critical. The row keeps ONLY the play circle inline;
// the paperwork actions live in the detail sheet the row's tap opens, and the amber
// missing-transcript state stays visible on the row itself.
describe('Journal · the audio row', () => {
  const memo: TimelineEvent = {
    id: 'm1', t: '', at: new Date(1_050_000).toISOString(), text: 'Audionotiz (6s)',
    icon: 'mic', kind: 'audio', audioUrl: 'blob:memo',
    audioMeta: { source: 'recorded', startedAt: new Date(1_044_000).toISOString(), durationSec: 6 },
  }

  it('keeps ONLY the play circle inline — Durchhören + Transkript moved into the sheet', () => {
    setup({ events: [memo], onTranscript: vi.fn(), onOpenPlayer: vi.fn() })
    const row = document.querySelector('[data-ev="m1"]')!
    expect(row.querySelector('.tl-play')).toBeTruthy()
    expect(row.querySelector('.jr-jump')).toBeNull()
    // the missing transcript keeps its amber ON the row, as a chip under the sentence (#12)
    expect(row.querySelector('.jr-meta .jr-tx-miss')).toBeTruthy()
    expect(row.querySelector('.jr-trail .jr-tx-miss')).toBeNull()
    fireEvent.click(screen.getByText('Audionotiz (6s)'))
    expect(screen.getByRole('button', { name: 'Durchhören' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Transkript ergänzen' })).toBeTruthy()
  })

  it('…and the chip goes once the memo has words', () => {
    setup({ events: [{ ...memo, transcript: 'Sanität eingetroffen' }], onTranscript: vi.fn() })
    expect(document.querySelector('[data-ev="m1"] .jr-tx-miss')).toBeNull()
  })

  it('hands Durchhören over to the player sheet', () => {
    const onOpenPlayer = vi.fn()
    setup({ events: [memo], onOpenPlayer })
    fireEvent.click(screen.getByText('Audionotiz (6s)'))
    fireEvent.click(screen.getByRole('button', { name: 'Durchhören' }))
    expect(onOpenPlayer).toHaveBeenCalledWith(expect.objectContaining({ id: 'm1' }))
  })
})

// ── the jump back from a Plan row ───────────────────────────────────────────────────────────
// The Lage's rows have always carried an `entityId` and flown to it. The Plan's carried the plan
// document and nothing else, so «Symbol "Löschleitung" auf Plan gesetzt» opened the Gebäude at
// whatever floor was showing and selected nothing. Placements record annoId + px/py + floor now
// (Whiteboard · PlanLogExtra); the record is append-only, so the rows written before that will
// never have them and must still land on their plan.
describe('Journal · a Plan row jumps back', () => {
  const planRow = (over: Partial<TimelineEvent>): TimelineEvent => ({
    id: 'p1', t: '', at: new Date(1_050_000).toISOString(), text: 'Symbol "Löschleitung" auf Plan gesetzt',
    icon: 'hex', kind: 'symbol', surface: 'plan', planId: 'geb', ...over,
  })

  it('carries the placed object and its spot', () => {
    const onSelect = vi.fn()
    setup({ events: [planRow({ annoId: 's7', px: 0.4, py: 0.6, floor: 2 })], onSelect })
    fireEvent.click(screen.getByText(/Löschleitung/))
    expect(onSelect).toHaveBeenCalledWith(expect.objectContaining({
      planId: 'geb', annoId: 's7', px: 0.4, py: 0.6, floor: 2,
    }))
  })

  it('⚠️ an old row without them still opens its plan rather than nothing', () => {
    const onSelect = vi.fn()
    setup({ events: [planRow({})], onSelect })
    fireEvent.click(screen.getByText(/Löschleitung/))
    expect(onSelect).toHaveBeenCalledWith(expect.objectContaining({ planId: 'geb' }))
  })

  // undo/redo, and a Pendenz that happened to be ticked off while the Plan was open, are lines
  // ABOUT the surface rather than places on it — the journal is a record, not a UI
  it('leaves lines that are not about a place inert', () => {
    const onSelect = vi.fn()
    setup({
      events: [
        planRow({ id: 'h1', text: 'Rückgängig', icon: 'undo', kind: 'history' }),
        planRow({ id: 'd1', text: 'Pendenz erledigt: Absperrmaterial', icon: 'check', kind: 'reminder' }),
      ],
      onSelect,
    })
    fireEvent.click(screen.getByText('Rückgängig'))
    fireEvent.click(screen.getByText('Pendenz erledigt: Absperrmaterial'))
    expect(onSelect).not.toHaveBeenCalled()
  })
})

// An entry that carries an address — the Meldung's ticket, a Merkblatt — should be openable
// where it is read, not a string somebody retypes into a browser at 3am.
describe('Journal · an address in an entry', () => {
  const withUrl = [row('u1', 1_010_000, 'Merkblatt unter www.vkf.ch beachten')]

  it('renders it as a link that opens away from the app', () => {
    setup({ events: withUrl })
    const a = screen.getByText('www.vkf.ch')
    expect(a.tagName).toBe('A')
    expect(a.getAttribute('href')).toBe('https://www.vkf.ch')
    expect(a.getAttribute('target')).toBe('_blank')
    expect(a.getAttribute('rel')).toBe('noopener noreferrer')
  })

  // ⚠️ …and the tap belongs to the link alone. A row seeks the Wiedergabe under the finger, so
  // without the stop, opening the address would also move the playhead.
  it('does not also tap the row it sits in', () => {
    const onSeekTo = vi.fn()
    setup({ events: withUrl, replayAtMs: 1_060_000, onSeekTo })
    fireEvent.click(screen.getByText('www.vkf.ch'))
    expect(onSeekTo).not.toHaveBeenCalled()
  })
})

// The Beilagen chip's href is row data another device wrote — the chip may only link to what
// safeHref (lib/mediaUrl) vouches for. Defence in depth beside the server's ingest validation.
describe('Journal · Beilagen chips (files on a row)', () => {
  const withFiles = [{
    ...row('f1', 1_000_000, 'Bericht angehängt'),
    files: [
      { url: '/api/media/abc', name: 'Bericht.pdf' },
      { url: 'javascript:alert(1)', name: 'Falle.pdf' },
    ],
  }]

  it('links the chip to the store URL, carrying the operator’s filename', () => {
    setup({ events: withFiles })
    const chips = [...document.querySelectorAll<HTMLAnchorElement>('.jr-file')]
    expect(chips.map((c) => c.getAttribute('href'))).toEqual(['/api/media/abc?name=Bericht.pdf', null])
    expect(chips[0].getAttribute('download')).toBe('Bericht.pdf')
  })

  it('a poisoned URL keeps the chip — the NAME is information — but never becomes a link', () => {
    setup({ events: withFiles })
    const dead = screen.getByText('Falle.pdf').closest('.jr-file')
    expect(dead?.getAttribute('href')).toBeNull()
    expect(dead?.getAttribute('download')).toBeNull()
  })
})

// ── the search (mock verlauf-02, 14.09.; head kept 22.09.) ──────────────────────────────────
// The lens opens the field UNDER the head — title · ⓘ · Replay · ✕ stay, so the drawer still says
// what it is — and lights up; the field filters the list live and its ✕ (or Escape in it, or the
// lens again) closes it and shows the full list. The matching itself is lib/journalSearch's.
describe('Journal · the search in the head', () => {
  const lens = () => screen.getByRole('button', { name: 'Im Verlauf suchen' })
  const rows = () => [...document.querySelectorAll<HTMLElement>('[data-ev]')].map((el) => el.dataset.ev)

  it('the lens opens the field UNDER the head, focused — the head stays; ✕ closes it and shows the list', () => {
    setup()
    fireEvent.click(lens())
    const field = screen.getByRole('textbox', { name: 'Im Verlauf suchen' })
    expect(document.activeElement).toBe(field)
    // the head is still there, and the lens in it is lit
    expect(screen.getByText(/Verlauf · 3/)).toBeTruthy()
    expect(screen.getAllByRole('button', { name: 'Suche schliessen' })[0].classList.contains('on')).toBe(true)
    fireEvent.change(field, { target: { value: 'feuer' } })
    expect(rows()).toEqual(['r3'])
    expect(screen.getByText('1 von 3')).toBeTruthy()
    // the field's own ✕ (the last of the two «Suche schliessen» — the lens is the first)
    const closers = screen.getAllByRole('button', { name: 'Suche schliessen' })
    fireEvent.click(closers[closers.length - 1])
    expect(screen.queryByRole('textbox')).toBeNull()
    expect(screen.getByText(/Verlauf · 3/)).toBeTruthy()
    expect(rows()).toEqual(['r3', 'r2', 'r1'])
  })

  it('the lit lens closes the search again', () => {
    setup()
    fireEvent.click(lens())
    expect(screen.getByRole('textbox')).toBeTruthy()
    fireEvent.click(screen.getAllByRole('button', { name: 'Suche schliessen' })[0])
    expect(screen.queryByRole('textbox')).toBeNull()
  })

  it('Escape in the field closes the SEARCH, not the drawer', () => {
    const { onClose } = setup()
    fireEvent.click(lens())
    fireEvent.keyDown(screen.getByRole('textbox'), { key: 'Escape' })
    expect(screen.queryByRole('textbox')).toBeNull()
    expect(onClose).not.toHaveBeenCalled()
  })

  it('a query that keeps nothing says so, and what it looked in', () => {
    setup()
    fireEvent.click(lens())
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'Pumpe' } })
    expect(rows()).toEqual([])
    expect(screen.getByText('Nichts zu «Pumpe»')).toBeTruthy()
    expect(screen.getByText(/Tippfehler ist erlaubt/)).toBeTruthy()
  })

  it('hides the legend and the strip while searching – both speak for the full list', () => {
    setup()
    fireEvent.click(screen.getByRole('button', { name: 'Legende' }))
    expect(document.querySelector('.jr-legend')).not.toBeNull()
    expect(document.querySelector('.jr-strip')).not.toBeNull()
    fireEvent.click(lens())
    expect(document.querySelector('.jr-legend')).toBeNull()
    expect(document.querySelector('.jr-strip')).toBeNull()
  })
})

describe('Journal · Escape closes one thing, innermost first', () => {
  // 3am test r4, 26.09.2026: on the tablet Esc did nothing — the drawer vetoed Escape wholesale
  // (dismissEscape={false}) and never closed on it itself
  it('Esc closes the drawer', () => {
    const { onClose } = setup()
    fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' })
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('with the search open, the first Esc closes the search and the second the drawer', () => {
    const { onClose } = setup()
    fireEvent.click(screen.getAllByRole('button', { name: 'Im Verlauf suchen' })[0])
    expect(screen.getByRole('textbox', { name: 'Im Verlauf suchen' })).toBeTruthy()
    fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' })
    expect(onClose).not.toHaveBeenCalled()
    expect(screen.queryByRole('textbox', { name: 'Im Verlauf suchen' })).toBeNull()
    fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' })
    expect(onClose).toHaveBeenCalledTimes(1)
  })
})
