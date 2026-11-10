import { describe, expect, it } from 'vitest'
import { freshAlarmCandidate, needsIntakeReview, pickBootIncident, sameIncidentList, shouldReopenClosed, undoTakeReturn } from './incidentAlerts'
import type { IncidentMeta } from './incidents'

const NOW = new Date('2026-07-08T12:00:00Z').getTime()

const inc = (over: Partial<IncidentMeta>): IncidentMeta => ({
  id: 'i1',
  divera_id: null,
  title: 'Einsatz',
  type: null,
  priority: null,
  address: null,
  lat: null,
  lng: null,
  status: 'offen',
  source: 'manual',
  source_ref: null,
  auto_opened: false,
  is_exercise: false,
  report_done_at: null,
  started_at: '2026-07-08T11:00:00Z',
  closed_at: null,
  is_archived: false,
  workspace_rev: 0,
  created_by: null,
  created_at: '2026-07-08T11:00:00Z',
  updated_at: '2026-07-08T11:00:00Z',
  ...over,
})

describe('pickBootIncident', () => {
  // the fixtures live on 2026-07-08; «now» sits just after them, inside the 3h window
  const NOW = Date.parse('2026-07-08T12:00:00Z')

  it('prefers the remembered incident when nothing newer arrived', () => {
    const saved = inc({ id: 'a', source: 'manual', started_at: '2026-07-08T10:00:00Z' })
    const olderAlarm = inc({ id: 'b', source: 'divera', started_at: '2026-07-08T09:00:00Z' })
    expect(pickBootIncident([saved, olderAlarm], 'a', { now: NOW })?.id).toBe('a')
  })

  it('a NEWER alarm-created incident overrides the remembered one (killed-app reopen)', () => {
    const saved = inc({ id: 'a', started_at: '2026-07-08T09:00:00Z' })
    const alarm = inc({ id: 'b', source: 'divera', auto_opened: true, started_at: '2026-07-08T11:30:00Z' })
    expect(pickBootIncident([alarm, saved], 'a', { now: NOW })?.id).toBe('b')
  })

  // ⚠️ Both bounds below were missing until 23.08., and together they made a remembered Einsatz
  // permanently unreachable: an open alarm Einsatz won every reload for as long as it existed,
  // and the boot then stamped ITS id over the operator's choice.
  it('a STALE alarm no longer overrides — the window is the pool banner\'s', () => {
    const saved = inc({ id: 'a', started_at: '2026-07-08T09:00:00Z' })
    const alarm = inc({ id: 'b', source: 'divera', started_at: '2026-07-08T11:30:00Z' })
    const wellAfter = Date.parse('2026-07-09T12:00:00Z')
    expect(pickBootIncident([alarm, saved], 'a', { now: wellAfter })?.id).toBe('a')
  })

  it('an alarm that already existed when the operator chose does not drag them back', () => {
    const saved = inc({ id: 'a', started_at: '2026-07-08T09:00:00Z' })
    const alarm = inc({ id: 'b', source: 'divera', started_at: '2026-07-08T11:30:00Z' })
    const chosenAt = Date.parse('2026-07-08T11:45:00Z') // opened BY HAND after that alarm landed
    expect(pickBootIncident([alarm, saved], 'a', { now: NOW, chosenAt })?.id).toBe('a')
  })

  it('…but a genuinely new alarm still wins, which is what the rule is for', () => {
    const saved = inc({ id: 'a', started_at: '2026-07-08T09:00:00Z' })
    const alarm = inc({ id: 'b', source: 'divera', started_at: '2026-07-08T11:30:00Z' })
    const chosenAt = Date.parse('2026-07-08T10:00:00Z') // chosen BEFORE the alarm landed
    expect(pickBootIncident([alarm, saved], 'a', { now: NOW, chosenAt })?.id).toBe('b')
  })

  it('generic-intake sources count as alarm-created, manual does not', () => {
    const saved = inc({ id: 'a', started_at: '2026-07-08T09:00:00Z' })
    const webhook = inc({ id: 'b', source: 'leitstelle', started_at: '2026-07-08T11:30:00Z' })
    const manualNewer = inc({ id: 'c', source: 'manual', started_at: '2026-07-08T11:45:00Z' })
    expect(pickBootIncident([manualNewer, webhook, saved], 'a', { now: NOW })?.id).toBe('b')
  })

  // 05.10.2026: after an Abschluss every launch stood inside whatever other Einsatz was open
  describe('after an Abschluss on this device (landedAt)', () => {
    const open = inc({ id: 'u', source: 'manual', started_at: '2026-07-08T08:00:00Z' })
    const landedAt = Date.parse('2026-07-08T11:00:00Z')

    it('stays on the launcher instead of falling back to the first open Einsatz', () => {
      expect(pickBootIncident([open], undefined, { now: NOW })?.id).toBe('u') // unchanged without it
      expect(pickBootIncident([open], undefined, { now: NOW, landedAt })).toBeUndefined()
    })

    it('an alarm that was already open at the close does not open either', () => {
      const alarm = inc({ id: 'b', source: 'divera', started_at: '2026-07-08T10:30:00Z' })
      expect(pickBootIncident([alarm, open], undefined, { now: NOW, landedAt })).toBeUndefined()
    })

    it('…but a fresh alarm that arrived after the close still opens', () => {
      const alarm = inc({ id: 'b', source: 'divera', started_at: '2026-07-08T11:30:00Z' })
      expect(pickBootIncident([alarm, open], undefined, { now: NOW, landedAt })?.id).toBe('b')
      expect(pickBootIncident([alarm, open], undefined, { now: Date.parse('2026-07-09T12:00:00Z'), landedAt })).toBeUndefined()
    })

    it('an Einsatz opened by hand since then is remembered as usual', () => {
      expect(pickBootIncident([open], 'u', { now: NOW, landedAt })?.id).toBe('u')
    })
  })

  it('never picks archived incidents — all archived boots to the clean landing', () => {
    const arch = inc({ id: 'a', source: 'divera', is_archived: true })
    expect(pickBootIncident([arch], 'a')).toBeUndefined()
  })

  it('never boots into an incident whose crash record is looping — the escape must not lead back in', () => {
    const list = [inc({ id: 'i1' }), inc({ id: 'i2', started_at: '2026-07-08T10:00:00Z' })]
    const looping = { id: 'i1', n: 2, at: NOW }
    expect(pickBootIncident(list, 'i1', { now: NOW, crash: looping })?.id).toBe('i2') // remembered, but poisoned
    expect(pickBootIncident([list[0]], null, { now: NOW, crash: looping })).toBeUndefined() // the only open one → landing
    expect(pickBootIncident(list, 'i1', { now: NOW, crash: { id: 'i1', n: 1, at: NOW } })?.id).toBe('i1') // one crash is not a loop
    expect(pickBootIncident(list, 'i1', { now: NOW, crash: null })?.id).toBe('i1')
    // …and a fresh alarm that is itself crashing does not override anything either
    const alarm = inc({ id: 'a', source: 'divera', started_at: '2026-07-08T11:30:00Z' })
    expect(pickBootIncident([...list, alarm], 'i1', { now: NOW, crash: { id: 'a', n: 3, at: NOW } })?.id).toBe('i1')
  })

  it('falls back to the first open incident without a remembered id', () => {
    const a = inc({ id: 'a', started_at: '2026-07-08T11:00:00Z' })
    const b = inc({ id: 'b', started_at: '2026-07-08T10:00:00Z' })
    expect(pickBootIncident([a, b], undefined)?.id).toBe('a')
  })
})

// Regression, reported 09.09.: reloading while an abgeschlossener Einsatz was on screen landed on
// the launch card — Brand plus Anmelde-Untertitel, i.e. «ich bin abgemeldet worden» — instead of
// back in that Einsatz. The open list boot works from cannot contain it, so `pickBootIncident`
// answers «nothing»; App's second door fetches it by id and reopens it read-only.
describe('shouldReopenClosed', () => {
  const NOW = Date.parse('2026-07-08T12:00:00Z')
  const closed = (over: Partial<IncidentMeta> = {}) =>
    inc({ id: 'a', is_archived: true, closed_at: '2026-07-08T11:40:00Z', updated_at: '2026-07-08T11:40:00Z', ...over })

  it('returns to the Einsatz the operator was looking at — the launcher is not an answer', () => {
    const justClosed = closed()
    expect(pickBootIncident([], 'a', { now: NOW, crash: null })).toBeUndefined() // why the door exists
    expect(shouldReopenClosed(justClosed, { now: NOW, reload: true, crash: null })).toBe(true)
  })

  it('an OLD Einsatz opened by hand out of the Verlauf comes back too — the decision is fresh', () => {
    const lastYear = closed({ closed_at: '2025-11-02T18:00:00Z', updated_at: '2025-11-02T18:00:00Z' })
    const chosenAt = Date.parse('2026-07-08T11:50:00Z') // opened from «Alle Einsätze» ten minutes ago
    expect(shouldReopenClosed(lastYear, { now: NOW, reload: true, chosenAt, crash: null })).toBe(true)
  })

  it('…and an Einsatz that closed itself around the operator, which never stamps chosenAt', () => {
    const byColleague = closed({ auto_opened: true, source: 'divera', closed_at: '2026-07-08T11:55:00Z' })
    expect(shouldReopenClosed(byColleague, { now: NOW, reload: true, crash: null })).toBe(true)
  })

  it('but yesterday belongs on the clean launcher, not in last night\'s Einsatz', () => {
    const yesterday = closed({ closed_at: '2026-07-07T02:00:00Z', updated_at: '2026-07-07T02:00:00Z' })
    const chosenAt = Date.parse('2026-07-07T01:00:00Z')
    expect(shouldReopenClosed(yesterday, { now: NOW, reload: true, chosenAt, crash: null })).toBe(false)
  })

  it('never back into a crash-looping Einsatz — the boundary\'s escape must stay an escape', () => {
    const poisoned = closed()
    expect(shouldReopenClosed(poisoned, { now: NOW, reload: true, crash: { id: 'a', n: 2, at: NOW } })).toBe(false)
  })

  // owner, 20.10.2026
  it('only a reload comes back: left, app closed, opened again → home', () => {
    const chosenAt = Date.parse('2026-07-08T11:50:00Z')
    expect(shouldReopenClosed(closed(), { now: NOW, reload: false, chosenAt, crash: null })).toBe(false)
  })
})

describe('freshAlarmCandidate', () => {
  const base = { activeId: null, baselineIds: new Set<string>(), dismissed: new Set<string>(), now: NOW }

  it('announces a fresh alarm-created arrival, newest first', () => {
    const older = inc({ id: 'a', source: 'divera', started_at: '2026-07-08T10:00:00Z' })
    const newer = inc({ id: 'b', source: 'leitstelle', started_at: '2026-07-08T11:30:00Z' })
    expect(freshAlarmCandidate([older, newer], base)?.id).toBe('b')
  })

  it('ignores manual incidents, the active one, baseline members, and dismissed ones', () => {
    const manual = inc({ id: 'm', source: 'manual' })
    const active = inc({ id: 'act', source: 'divera' })
    const known = inc({ id: 'k', source: 'divera' })
    const dismissed = inc({ id: 'd', source: 'divera' })
    const list = [manual, active, known, dismissed]
    expect(
      freshAlarmCandidate(list, { ...base, activeId: 'act', baselineIds: new Set(['k']), dismissed: new Set(['d']) }),
    ).toBeNull()
  })

  it('ignores stale alarms outside the 3 h window', () => {
    const stale = inc({ id: 's', source: 'divera', started_at: '2026-07-08T08:00:00Z' })
    expect(freshAlarmCandidate([stale], base)).toBeNull()
  })
})

describe('sameIncidentList', () => {
  it('detects unchanged lists and any id/updated_at drift', () => {
    const a = inc({ id: 'a' })
    expect(sameIncidentList([a], [inc({ id: 'a' })])).toBe(true)
    expect(sameIncidentList([a], [inc({ id: 'b' })])).toBe(false)
    expect(sameIncidentList([a], [inc({ id: 'a', updated_at: '2026-07-08T11:59:00Z' })])).toBe(false)
    expect(sameIncidentList(null, [a])).toBe(false)
    expect(sameIncidentList([], [])).toBe(true)
  })

  it('a QR capture write (counter only, pinned updated_at) still counts as a change', () => {
    const a = inc({ id: 'a' })
    expect(sameIncidentList([a], [inc({ id: 'a', capture_writes: 1 })])).toBe(false)
  })
})

describe('needsIntakeReview', () => {
  const base = { isEditor: true, reviewed: new Set<string>(), now: NOW }
  const auto = inc({ id: 'a', source: 'divera', auto_opened: true })

  it('offers the review on an Einsatz that opened itself — nobody checked the dispatch', () => {
    expect(needsIntakeReview(auto, base)).toBe(true)
  })

  it('stays quiet for a human-created incident: it was reviewed while it was typed', () => {
    expect(needsIntakeReview(inc({ id: 'm' }), base)).toBe(false)
  })

  it('stays quiet for a viewer — a read-only follower has nothing to correct', () => {
    expect(needsIntakeReview(auto, { ...base, isEditor: false })).toBe(false)
  })

  it('nags once per device, not on every reload', () => {
    expect(needsIntakeReview(auto, { ...base, reviewed: new Set(['a']) })).toBe(false)
  })

  it('is asked once of the CREW: a review on another device retires it here too', () => {
    expect(needsIntakeReview(auto, { ...base, reviewedAt: '2026-07-08T12:01:00Z' })).toBe(false)
  })

  it('an unreviewed device still gets asked while nobody has confirmed anywhere', () => {
    expect(needsIntakeReview(auto, { ...base, reviewedAt: undefined })).toBe(true)
    expect(needsIntakeReview(auto, { ...base, reviewedAt: null })).toBe(true)
  })

  it('lets go of stale and archived incidents', () => {
    expect(needsIntakeReview(inc({ ...auto, started_at: '2026-07-08T08:00:00Z' }), base)).toBe(false)
    expect(needsIntakeReview(inc({ ...auto, is_archived: true }), base)).toBe(false)
    expect(needsIntakeReview(null, base)).toBe(false)
  })
})

describe('undoTakeReturn', () => {
  const uebung = inc({ id: 'u', is_exercise: true })
  const real = inc({ id: 'r' })

  it('returns to the Einsatz that was open before the take, wherever it sits in the list', () => {
    expect(undoTakeReturn([uebung, real], 'r')).toBe(real)
  })

  it('is home when that Einsatz is gone, or when there was none', () => {
    expect(undoTakeReturn([uebung], 'r')).toBeNull()
    expect(undoTakeReturn([uebung, real], null)).toBeNull()
  })
})
