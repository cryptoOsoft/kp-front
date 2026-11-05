import { describe, expect, it } from 'vitest'
import { groupByDay, isHandWritten, rowGlyph, isNachtrag, rowText, rowTime, rowPhotos, rowTarget, liveTargets, swapUrl, repeatRuns, stripScale, stripDensity, pendenzenCut, pendenzenBelow } from './verlauf'
import type { BoardAnno, TimelineEvent } from '../types'

const row = (id: string, at?: string): TimelineEvent =>
  ({ id, t: '09:00', at, icon: 'flag', text: id })

const NOW = new Date('2026-07-02T15:00:00')

describe('groupByDay', () => {
  it('keeps a single-day (today) journal as one unlabeled group', () => {
    const g = groupByDay([row('b', '2026-07-02T14:00:00'), row('a', '2026-07-02T09:00:00')], NOW)
    expect(g).toHaveLength(1)
    expect(g[0].label).toBeNull()
    expect(g[0].events.map((e) => e.id)).toEqual(['b', 'a'])
  })

  it('separates calendar days and labels the older ones', () => {
    const g = groupByDay(
      [row('new', '2026-07-02T10:00:00'), row('mid', '2026-07-01T22:00:00'), row('old', '2026-06-10T08:00:00')],
      NOW,
    )
    expect(g).toHaveLength(3)
    expect(g[0].label).toBeNull() // today
    expect(g[1].label).toMatch(/01\.07\.2026|07\/01\/2026|2026/)
    expect(g[2].label).toMatch(/10\.06\.2026|06\/10\/2026|2026/)
  })

  it('rows without `at` (old data) stick to the running group instead of fragmenting', () => {
    const g = groupByDay([row('a', '2026-07-02T10:00:00'), row('legacy'), row('b', '2026-07-02T08:00:00')], NOW)
    expect(g).toHaveLength(1)
    expect(g[0].events.map((e) => e.id)).toEqual(['a', 'legacy', 'b'])
  })
})

describe('isNachtrag', () => {
  const closed = '2026-07-02T18:00:00Z'
  it('flags rows after the Einsatzende, not rows during the incident', () => {
    expect(isNachtrag(row('during', '2026-07-02T14:00:00Z'), closed)).toBe(false)
    expect(isNachtrag(row('after', '2026-07-20T10:00:00Z'), closed)).toBe(true)
    expect(isNachtrag(row('after', '2026-07-20T10:00:00Z'), null)).toBe(false) // never closed
    expect(isNachtrag(row('no-at'), closed)).toBe(false) // legacy rows can't be judged
  })

  // staging r3
  it('flags a row the server RECEIVED after the close, whatever time it carries', () => {
    // a Kontakt from 17:55 that reached the server at 18:05, after an 18:00 close: in its time
    // order — and late on paper
    expect(isNachtrag({ ...row('late', '2026-07-02T17:55:00Z'), receivedAfterClose: true }, closed)).toBe(true)
  })

  // staging r6, F3
  it('a row the Abschluss itself wrote is part of the close, not a Nachtrag', () => {
    // «Trupp 2 beim Abschluss noch drin», stamped 0.6 s past the server's closed_at
    const own = { ...row('inside', '2026-07-02T18:00:00.600Z'), atClose: true }
    expect(isNachtrag(own, closed)).toBe(false)
    // …delivered after the close as well
    expect(isNachtrag({ ...own, receivedAfterClose: true }, closed)).toBe(false)
    // the same row WITHOUT the mark is late, as before
    expect(isNachtrag(row('inside', '2026-07-02T18:00:00.600Z'), closed)).toBe(true)
    // …and the mark carries nothing off the paper that happened later than the close's tolerance
    expect(isNachtrag({ ...row('later', '2026-07-02T18:05:00Z'), atClose: true }, closed)).toBe(true)
    expect(isNachtrag({ ...row('undated'), atClose: true, receivedAfterClose: true }, closed)).toBe(true)
  })
})

describe('rowTime', () => {
  it('localises from `at` when present (server rows ship t="")', () => {
    const t = rowTime({ ...row('x', '2026-07-02T14:05:00'), t: '' })
    expect(t).toMatch(/14:05|02:05/) // local vs 12h formats
  })
  it('falls back to the baked t for legacy rows', () => {
    expect(rowTime(row('x'))).toBe('09:00')
  })
})

// Several pictures on one row: attaching a second used to REPLACE the first. Rows written
// before 2026-08-06 carry a single `photoUrl`, so every reader has to take both shapes.
describe('rowPhotos / swapUrl', () => {
  it('reads the new list, the old single field, and neither', () => {
    expect(rowPhotos({ photoUrls: ['/a', '/b'] })).toEqual(['/a', '/b'])
    expect(rowPhotos({ photoUrl: '/legacy' })).toEqual(['/legacy'])
    expect(rowPhotos({})).toEqual([])
    // a list wins over the legacy field (a patched row can carry both)
    expect(rowPhotos({ photoUrl: '/legacy', photoUrls: ['/a'] })).toEqual(['/a'])
  })

  it('swaps ONE uploaded picture and leaves the others alone', () => {
    expect(swapUrl(['blob:1', 'blob:2'], 'blob:2', '/api/media/2')).toEqual(['blob:1', '/api/media/2'])
  })

  it('appends when the local url is already gone (a late upload must not vanish)', () => {
    expect(swapUrl(['/api/media/1'], 'blob:gone', '/api/media/2')).toEqual(['/api/media/1', '/api/media/2'])
    expect(swapUrl(undefined, 'blob:gone', '/api/media/2')).toEqual(['/api/media/2'])
  })
})

describe('isHandWritten', () => {
  const e = (over: Partial<TimelineEvent>): TimelineEvent =>
    ({ id: 'x', t: '', at: '2026-08-18T10:00:00.000Z', icon: 'type', text: 'x', ...over })

  it('takes everything the composer writes', () => {
    expect(isHandWritten(e({ kind: 'journal', icon: 'type' }))).toBe(true)
    expect(isHandWritten(e({ kind: 'audio', icon: 'mic' }))).toBe(true)
    expect(isHandWritten(e({ kind: 'photo', icon: 'photo' }))).toBe(true)
  })

  // ⚠️ the app reporting an action — rewriting one of these would make the record state
  // something that did not happen
  it('takes nothing the app wrote about an action', () => {
    expect(isHandWritten(e({ kind: 'team', icon: 'people' }))).toBe(false)
    expect(isHandWritten(e({ kind: 'symbol', icon: 'pin' }))).toBe(false)
    expect(isHandWritten(e({ kind: 'reminder', icon: 'clock' }))).toBe(false)
    // ⚠️ a Checklisten-Haken IS kind 'journal' — the icon is what separates it
    expect(isHandWritten(e({ kind: 'journal', icon: 'check' }))).toBe(false)
  })
})

// A state the app re-states («Trupp X überfällig» every few seconds while nothing changes, an
// undo tapped six times in two seconds) is one line that repeated — not twenty lines. Display
// only: every row stays in the record, and the count is shown rather than swallowed.
describe('repeatRuns', () => {
  const row = (id: string, at: string, text: string, over: Partial<TimelineEvent> = {}): TimelineEvent =>
    ({ id, t: at.slice(11, 16), at, icon: 'warn', text, kind: 'team', ...over })

  it('reports when a run stopped, so «6×» can be told from «6× over two minutes»', () => {
    const { counts, lastAt } = repeatRuns([
      row('a', '2026-09-01T14:32:00.000Z', 'Kontakt überfällig'),
      row('b', '2026-09-01T14:32:40.000Z', 'Kontakt überfällig'),
      row('c', '2026-09-01T14:33:10.000Z', 'Kontakt überfällig'),
    ])
    expect(counts.get('a')).toBe(3)
    expect(lastAt.get('a')).toBe('2026-09-01T14:33:10.000Z')
  })

  // staging 25.09.2026 (F2c): dock, ↶, dock again folded into ONE «angedockt 2×»
  it('ends every run at a ↶ / ↷ — the same line after it is a new act, not a repeat', () => {
    const { hidden } = repeatRuns([
      row('d1', '2026-09-01T14:32:00.000Z', 'Gefahrentafel angedockt an «TLF»', { kind: 'symbol', entityId: 'p' }),
      row('u1', '2026-09-01T14:32:20.000Z', 'Änderung auf der Karte rückgängig gemacht', { kind: 'history', icon: 'undo' }),
      row('d2', '2026-09-01T14:32:40.000Z', 'Gefahrentafel angedockt an «TLF»', { kind: 'symbol', entityId: 'p' }),
    ])
    expect(hidden.size).toBe(0)
  })

  // D6: storey rows name their storey as subject — entfernt, wiederhergestellt, entfernt,
  // wiederhergestellt within two minutes are four acts, and two storeys never fold together
  it('keeps a storey’s removals and restores apart, and two storeys apart', () => {
    const at = (s: number) => `2026-09-01T14:3${s}:00.000Z`
    const { hidden } = repeatRuns([
      row('r1', at(0), 'Geschoss 3. OG entfernt', { kind: 'symbol', subjectId: 'storey:3' }),
      row('w1', at(1), 'Geschoss 3. OG wiederhergestellt', { kind: 'symbol', subjectId: 'storey:3' }),
      row('r2', at(2), 'Geschoss 3. OG entfernt', { kind: 'symbol', subjectId: 'storey:3' }),
      row('w2', at(3), 'Geschoss 3. OG wiederhergestellt', { kind: 'symbol', subjectId: 'storey:3' }),
      row('a4', at(4), 'Geschoss 4. OG hinzugefügt', { kind: 'symbol', subjectId: 'storey:4' }),
      row('a5', at(5), 'Geschoss 5. OG hinzugefügt', { kind: 'symbol', subjectId: 'storey:5' }),
    ])
    expect(hidden.size).toBe(0)
  })

  it('leaves lastAt empty for a line that never repeated', () => {
    const { lastAt } = repeatRuns([row('a', '2026-09-01T14:32:00.000Z', 'Kontakt überfällig')])
    expect(lastAt.has('a')).toBe(false)
  })

  it('collapses a run of the same line into the first, counting the repeats', () => {
    const rows = [
      row('a', '2026-08-19T20:00:00.000Z', 'Atemschutz-Alarm: Trupp Weber Marco – Überfällig'),
      row('b', '2026-08-19T20:00:05.000Z', 'Atemschutz-Alarm: Trupp Weber Marco – Überfällig'),
      row('c', '2026-08-19T20:00:11.000Z', 'Atemschutz-Alarm: Trupp Weber Marco – Überfällig'),
    ]
    const { counts, hidden } = repeatRuns(rows)
    expect(hidden).toEqual(new Set(['b', 'c']))
    expect(counts.get('a')).toBe(3)
  })

  // two Trupps pinging alternately are two runs, not one — each keeps its own first line
  it('keeps interleaved runs apart', () => {
    const rows = [
      row('a1', '2026-08-19T20:00:00.000Z', 'Alarm: Weber'),
      row('b1', '2026-08-19T20:00:01.000Z', 'Alarm: Müller'),
      row('a2', '2026-08-19T20:00:06.000Z', 'Alarm: Weber'),
      row('b2', '2026-08-19T20:00:07.000Z', 'Alarm: Müller'),
    ]
    const { counts, hidden } = repeatRuns(rows)
    expect(hidden).toEqual(new Set(['a2', 'b2']))
    expect(counts.get('a1')).toBe(2)
    expect(counts.get('b1')).toBe(2)
  })

  // ⚠️ the SECOND turnus is news. A line that comes back after the window is its own row, so a
  // Trupp that went overdue again after a Funkkontakt can never be hidden behind the first alarm.
  it('never collapses across a gap longer than the window', () => {
    const rows = [
      row('a', '2026-08-19T20:00:00.000Z', 'Atemschutz-Alarm: Trupp Weber Marco – Überfällig'),
      row('b', '2026-08-19T20:07:00.000Z', 'Atemschutz-Alarm: Trupp Weber Marco – Überfällig'),
    ]
    const { counts, hidden } = repeatRuns(rows)
    expect(hidden.size).toBe(0)
    expect(counts.size).toBe(0)
  })

  // ⚠️ SAME TEXT, DIFFERENT OBJECT is not a repeat. Two Notizen dropped in the same breath
  // both log «Notiz gesetzt»; keying on the sentence alone printed «Notiz gesetzt 2×» and lost one
  // of the two notes from the Verlauf and from the printed Rapport.
  it('never merges the same sentence about two different objects', () => {
    const rows = [
      row('n1', '2026-08-19T20:00:00.000Z', 'Notiz gesetzt', { kind: 'symbol', entityId: 'e100' }),
      row('n2', '2026-08-19T20:00:03.000Z', 'Notiz gesetzt', { kind: 'symbol', entityId: 'e200' }),
    ]
    const { counts, hidden } = repeatRuns(rows)
    expect(hidden.size).toBe(0)
    expect(counts.size).toBe(0)
  })

  // …the board's side of the same key: two shapes drawn in one burst are two annotations
  it('never merges the same sentence about two different plan annotations', () => {
    const rows = [
      row('a1', '2026-08-19T20:00:00.000Z', 'Fläche gezeichnet', { kind: 'symbol', annoId: 'sh1' }),
      row('a2', '2026-08-19T20:00:02.000Z', 'Fläche gezeichnet', { kind: 'symbol', annoId: 'sh2' }),
    ]
    expect(repeatRuns(rows).hidden.size).toBe(0)
  })

  // ⚠️ …and the third key, for the rows that name an object they cannot POINT at. On 03.09. the
  // Rapport printed «Feuerwehr gelöscht 2×», «Polizei gelöscht 2×» and «Lüfter gelöscht 2×» —
  // every one of those pairs was two different symbols removed a few seconds apart, and «2×»
  // said one thing had happened twice.
  it('⚠️ never merges two deletions of different objects, which carry no jump target', () => {
    const rows = [
      row('d1', '2026-09-03T04:49:03.000Z', 'Feuerwehr gelöscht', { kind: undefined, icon: 'close', subjectId: 'p1788410546821' }),
      row('d2', '2026-09-03T04:49:08.000Z', 'Feuerwehr gelöscht', { kind: undefined, icon: 'close', subjectId: 'p1788410533547' }),
    ]
    const { counts, hidden } = repeatRuns(rows)
    expect(hidden.size).toBe(0)
    expect(counts.size).toBe(0)
  })

  it('still collapses a run about ONE object', () => {
    const rows = [
      row('n1', '2026-08-19T20:00:00.000Z', 'Notiz gesetzt', { kind: 'symbol', entityId: 'e100' }),
      row('n2', '2026-08-19T20:00:03.000Z', 'Notiz gesetzt', { kind: 'symbol', entityId: 'e100' }),
      row('n3', '2026-08-19T20:00:06.000Z', 'Notiz gesetzt', { kind: 'symbol', entityId: 'e100' }),
    ]
    const { counts, hidden } = repeatRuns(rows)
    expect(hidden).toEqual(new Set(['n2', 'n3']))
    expect(counts.get('n1')).toBe(3)
  })

  /* ── A run ENDS when something else happens to the same object (04.09., Manuel's Rapport) ──
   * His card read «Austritt 16:19 · Eingerückt 16:20 · Austritt 16:20» and the printed sheet
   * carried one row, «Austritt 2×» at 16:19: a second, real deployment cycle folded into the
   * first because the two Austritte matched each other across the Eintritt between them. */
  it('⚠️ breaks the run when the same Trupp does something else in between', () => {
    const rows = [
      row('x1', '2026-09-04T14:19:00.000Z', 'Trupp Brunner Thomas: Austritt', { subjectId: 'tr1' }),
      row('e1', '2026-09-04T14:20:00.000Z', 'Trupp Brunner Thomas: Eintritt', { subjectId: 'tr1' }),
      row('x2', '2026-09-04T14:20:40.000Z', 'Trupp Brunner Thomas: Austritt', { subjectId: 'tr1' }),
    ]
    const { counts, hidden } = repeatRuns(rows)
    expect(hidden.size).toBe(0)
    expect(counts.size).toBe(0)
  })

  // …and the other side of the same rule: a burst with nothing in between is still one row
  it('still folds a burst about one Trupp that nothing interrupts', () => {
    const rows = [
      row('x1', '2026-09-04T14:19:00.000Z', 'Trupp Brunner Thomas: Austritt', { subjectId: 'tr1' }),
      row('x2', '2026-09-04T14:19:01.000Z', 'Trupp Brunner Thomas: Austritt', { subjectId: 'tr1' }),
    ]
    const { counts, hidden } = repeatRuns(rows)
    expect(hidden).toEqual(new Set(['x2']))
    expect(counts.get('x1')).toBe(2)
  })

  // …and a row about ANOTHER object does not break it: the run belongs to its own object
  it('is not broken by what happens to a different Trupp in between', () => {
    const rows = [
      row('x1', '2026-09-04T14:19:00.000Z', 'Trupp Brunner Thomas: Austritt', { subjectId: 'tr1' }),
      row('o1', '2026-09-04T14:19:20.000Z', 'Trupp Meier Anna: Eintritt', { subjectId: 'tr2' }),
      row('x2', '2026-09-04T14:19:40.000Z', 'Trupp Brunner Thomas: Austritt', { subjectId: 'tr1' }),
    ]
    const { counts, hidden } = repeatRuns(rows)
    expect(hidden).toEqual(new Set(['x2']))
    expect(counts.get('x1')).toBe(2)
  })

  // ⚠️ Rows that name NO object keep the old rule — the app re-stating a state («Kontakt
  // überfällig») is the case the fold exists for, and there is no object to break the run with.
  it('keeps folding objectless rows across whatever stands between them', () => {
    const rows = [
      row('a', '2026-09-04T14:19:00.000Z', 'Kontakt überfällig'),
      row('b', '2026-09-04T14:19:10.000Z', 'Etwas anderes ist passiert'),
      row('c', '2026-09-04T14:19:20.000Z', 'Kontakt überfällig'),
    ]
    const { counts, hidden } = repeatRuns(rows)
    expect(hidden).toEqual(new Set(['c']))
    expect(counts.get('a')).toBe(2)
  })

  it('leaves hand-written rows alone — somebody who typed it twice meant it twice', () => {
    const rows = [
      row('a', '2026-08-19T20:00:00.000Z', 'Wasser marsch', { kind: 'journal', icon: 'type' }),
      row('b', '2026-08-19T20:00:04.000Z', 'Wasser marsch', { kind: 'journal', icon: 'type' }),
    ]
    expect(repeatRuns(rows).hidden.size).toBe(0)
  })
})

// Reversed 31.08.: a wordless picture row reads «Foto» again. Blanking it left the Verlauf — and
// the printed Rapport, read by people who were not there — as a column of bare timestamps.
describe('rowText — a wordless photo row falls back to «Foto»', () => {
  const photoRow = (text: string, photoUrls?: string[]) =>
    ({ id: 'e1', t: '10:00', icon: 'photo', text, photoUrls }) as TimelineEvent

  it('labels a picture row that carries no caption of its own', () => {
    expect(rowText(photoRow('', ['/api/media/1']))).toBe('Foto')
  })

  it('keeps a caption somebody actually typed', () => {
    expect(rowText(photoRow('Fotos vom Dachstock', ['/api/media/1']))).toBe('Fotos vom Dachstock')
  })

  // rows written before 06.08. carry the word in the record; it must survive verbatim
  it('keeps the word on an older row that stored it', () => {
    expect(rowText(photoRow('Foto', ['/api/media/1']))).toBe('Foto')
  })

  // the one thing left saying a picture was meant, on a row whose upload never arrived
  it('leaves a row without any picture exactly as written', () => {
    expect(rowText(photoRow(''))).toBe('')
    expect(rowText(photoRow('Foto'))).toBe('Foto')
  })

  it('reads the old single-photo shape too', () => {
    expect(rowText({ id: 'e1', t: '10:00', icon: 'photo', text: '', photoUrl: '/api/media/1' } as TimelineEvent)).toBe('Foto')
  })
})

describe('rowGlyph (a hand-written row shows its Art)', () => {
  const row = (over: Partial<TimelineEvent>): TimelineEvent =>
    ({ id: 'j1', at: '2026-10-07T14:30:00Z', text: 'x', kind: 'journal', icon: 'type', ...over }) as TimelineEvent
  it('Auftrag → arrow on blue, Sofortmassnahme → warn on amber, derived from the stored Art', () => {
    expect(rowGlyph(row({ entryType: 'auftrag' }))).toEqual({ icon: 'arrow', tone: 'auftrag' })
    expect(rowGlyph(row({ entryType: 'sofort' }))).toEqual({ icon: 'warn', tone: 'sofort' })
  })
  it('Info and an untyped text row keep the «T»', () => {
    expect(rowGlyph(row({ entryType: 'info' }))).toEqual({ icon: 'type' })
    expect(rowGlyph(row({}))).toEqual({ icon: 'type' })
  })
  it('a Sprachnotiz, a Foto and every automatic row keep their own glyph', () => {
    expect(rowGlyph(row({ kind: 'audio', icon: 'mic', entryType: 'auftrag' }))).toEqual({ icon: 'mic' })
    expect(rowGlyph(row({ kind: 'photo', icon: 'photo', entryType: 'sofort' }))).toEqual({ icon: 'photo' })
    expect(rowGlyph(row({ kind: 'team', icon: 'gauge' }))).toEqual({ icon: 'gauge' })
  })
})

// moved out of Journal with the row (sweep A.8): a row is a way somewhere only when it carries one
describe('rowTarget', () => {
  const base = row('r')
  const live = liveTargets([{ id: 'e1' }], [{ id: 'p1' }], { p1: [{ id: 'a1' } as BoardAnno] })
  it('jumps to a map entity, else a pinned point, else a thing placed on a plan', () => {
    expect(rowTarget({ ...base, entityId: 'e1', coord: [7.5, 47.5] }, live)).toBe('map-entity')
    expect(rowTarget({ ...base, coord: [7.5, 47.5] }, live)).toBe('map-pin')
    expect(rowTarget({ ...base, surface: 'plan', planId: 'p1', annoId: 'a1' }, live)).toBe('plan')
    // a pre-23.08. placement row carries only its kind, and still lands on its plan
    expect(rowTarget({ ...base, surface: 'plan', planId: 'p1', kind: 'symbol' }, live)).toBe('plan')
  })
  it('is read-only otherwise — a note on a plan is about no thing on it', () => {
    expect(rowTarget(base, live)).toBeNull()
    expect(rowTarget({ ...base, surface: 'plan', planId: 'p1', kind: 'journal' }, live)).toBeNull()
  })
  // owner, sweep 28.10.2026 #6: «only things we can actually click on if they still exist»
  it('never offers a jump from a removal row – logPlan stamps it a «symbol»', () => {
    const removed = { ...base, icon: 'close', text: 'Feuer gelöscht', subjectId: 'a1' }
    expect(rowTarget({ ...removed, surface: 'plan', planId: 'p1', kind: 'symbol' }, live)).toBeNull()
    expect(rowTarget({ ...removed, surface: 'map' }, live)).toBeNull()
  })
  it('offers none to an object that has since gone, but keeps a place that outlived it', () => {
    expect(rowTarget({ ...base, entityId: 'gone' }, live)).toBeNull()
    expect(rowTarget({ ...base, entityId: 'gone', coord: [7.5, 47.5] }, live)).toBe('map-pin')
    expect(rowTarget({ ...base, surface: 'plan', planId: 'p1', annoId: 'gone', px: 0.4, py: 0.6 }, live)).toBeNull()
    // a plan no longer in the catalog (a Gebäude whose stack was removed)
    expect(rowTarget({ ...base, surface: 'plan', planId: 'geb', kind: 'symbol' }, live)).toBeNull()
  })
})

describe('stripScale', () => {
  const from = new Date('2026-07-02T14:33:00').getTime()
  const to = new Date('2026-07-02T19:05:00').getTime()

  it('labels every full hour; a stamp an hour would collide with gives way', () => {
    const s = stripScale(from, to, 330)
    expect(s.marks).toHaveLength(5) // 15, 16, 17, 18, 19 h
    expect(s.marks.every((m) => m.label)).toBe(true)
    expect(s.marks[1].label).toMatch(/16.00/)
    // 15:00 sits 33px in, over the start stamp; 19:00 6px before the end, flush with it
    expect(s.marks[0].label).toMatch(/15.00/)
    expect(s.marks[0].edge).toBeUndefined()
    expect(s.marks[4]).toMatchObject({ label: expect.stringMatching(/19.00/), edge: 'end' })
    expect(s.start).toBeUndefined()
    expect(s.end).toBeUndefined()
  })

  it('keeps a stamp that clears the first and last hour', () => {
    // 14:00 stands 75px in, 16:00 52px before the end: both stamps clear them
    const s = stripScale(new Date('2026-07-02T13:10:00').getTime(), new Date('2026-07-02T16:50:00').getTime(), 330)
    expect(s.marks.map((m) => m.label)).toEqual([/14.00/, /15.00/, /16.00/].map((t) => expect.stringMatching(t)))
    expect(s.start).toMatch(/13.10/)
    expect(s.end).toMatch(/16.50/)
  })

  it('never prints two labels closer than one label width', () => {
    const s = stripScale(from, to, 120)
    const lefts = s.marks.filter((m) => m.label).map((m) => (m.edge === 'start' ? 0 : m.edge === 'end' ? 120 - 46 : m.frac * 120 - 23))
    lefts.forEach((l, i) => { if (i) expect(l - lefts[i - 1]).toBeGreaterThanOrEqual(46) })
    expect(s.marks.length).toBeLessThanOrEqual(3)
  })

  it('unmeasured, it draws a few unlabelled marks', () => {
    const s = stripScale(from, to, 0)
    expect(s.marks.length).toBeLessThanOrEqual(6)
    expect(s.marks.every((m) => m.label === undefined)).toBe(true)
    expect(s.start).toMatch(/14.33/)
    expect(s.end).toMatch(/19.05/)
  })
})

describe('pendenzenCut', () => {
  // rows at 40, 90, 150, 230 in a 210px box; the foot band + border is 21px, so a cut must sit
  // at or above 189 — the last row top there is 150, and the box ends 21px below it
  it('ends the box at the top of the first row that does not fit whole', () => {
    expect(pendenzenCut([40, 90, 150, 230], 210, 21)).toBe(171)
  })

  it('cuts exactly at a row top that leaves just the foot', () => {
    expect(pendenzenCut([40, 90, 189], 210, 21)).toBe(210)
  })

  it('keeps the CSS cap when the first row alone is taller than the box', () => {
    expect(pendenzenCut([40, 300], 210, 21)).toBeNull()
  })
})

describe('pendenzenBelow', () => {
  it('counts the rows that end below the fold, the one it slices included', () => {
    expect(pendenzenBelow([86, 146, 226, 300, 380], 230)).toBe(2)
    expect(pendenzenBelow([86, 146, 226, 300, 380], 200)).toBe(3)
  })

  it('treats a subpixel overshoot as a whole row', () => {
    expect(pendenzenBelow([86, 146, 230.4], 230)).toBe(0)
  })
})

describe('stripDensity', () => {
  it('merges rows that fall in one 3px column into one mark with their count', () => {
    // a 300px track over 300 s: 1px per second, columns of 3 s
    const ticks = [0, 1000, 2000, 150_000, 300_000]
    expect(stripDensity(ticks, 0, 300_000, 300)).toEqual([
      { frac: 1 / 300, n: 3 },
      { frac: 0.5, n: 1 },
      { frac: 1, n: 1 }, // the last moment stays in the last column, not one past it
    ])
  })

  it('unmeasured, every row is its own mark', () => {
    expect(stripDensity([0, 5, 10], 0, 10, 0)).toEqual([{ frac: 0, n: 1 }, { frac: 0.5, n: 1 }, { frac: 1, n: 1 }])
  })
})
