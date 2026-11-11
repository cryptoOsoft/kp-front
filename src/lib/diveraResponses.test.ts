import { describe, expect, it } from 'vitest'
import { buildAnrueckend } from './diveraResponses'
import { FIXTURE, ROSTER } from './diveraResponses.fixture'
import type { AttendanceState } from '../types'

describe('the «Anrückend» block, as data — yes / no and names', () => {
  it('lists who comes, and counts every answer in the head line', () => {
    const a = buildAnrueckend(FIXTURE, ROSTER, {})!
    expect(a.counts).toEqual({ coming: 4, notComing: 2 })
    // the crew list's own order: Grad first, then the name
    expect(a.coming.map((p) => p.id)).toEqual(['p103', 'p101', 'p102'])
    // 999 is on nobody's roster: the server sent a number, never who
    expect(a.unmapped).toBe(1)
  })

  it('maps by OUR id; a row this device lacks is only counted', () => {
    const a = buildAnrueckend(FIXTURE, ROSTER.filter((p) => p.id !== 'p102'), {})!
    expect(a.coming.map((p) => p.id)).toEqual(['p103', 'p101'])
    expect(a.unmapped).toBe(2)
    expect(a.counts.coming).toBe(4) // the head line still says what Divera said
  })

  it('takes somebody out of the block once they are recorded here — in any state', () => {
    const att: AttendanceState = {
      p101: { status: 'present', displayNameSnapshot: 'Muster Hans', intervals: [{ from: '2026-10-08T17:05:00Z' }] },
      p104: { status: 'left', displayNameSnapshot: 'Huber Lea', intervals: [{ from: '2026-10-08T17:05:00Z', to: '2026-10-08T17:30:00Z' }] },
    }
    const a = buildAnrueckend(FIXTURE, ROSTER, att)!
    expect(a.here).toBe(2)
    expect(a.coming.map((p) => p.id)).toEqual(['p103', 'p102'])
    expect(a.counts.coming).toBe(4)
  })

  it('is nothing at all without Divera answers', () => {
    expect(buildAnrueckend(null, ROSTER, {})).toBeNull()
    expect(buildAnrueckend({ available: false, reason: 'no_data' }, ROSTER, {})).toBeNull()
  })
})
