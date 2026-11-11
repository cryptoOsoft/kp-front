// The Anwesenheit's «Anrückend» block, as data: who answered the Divera alarm «kommt» / «kommt
// nicht» (that one a count only), laid over the Mannschaft and over who is already here. Yes / no and names only (owner,
// 09.10.2026: «just yes/no is enough») — no answer time, no status words, no notes.
//
// ⚠️ A Divera answer is NEVER presence. This module only sorts the answers into what the block
// shows; somebody is anwesend once a person on the scene taps «da», which is the ordinary
// attendance write (useAttendanceActions · markPresent) and nothing here.
import type { AttendanceState, Person } from '../types'
import type { DiveraResponses } from './api/divera'
import { rankOrder } from './rank'

export interface Anrueckend {
  /** every answer, whoever gave it — the head line («9 kommen · 2 kommen nicht») */
  counts: { coming: number; notComing: number }
  /** answered and already recorded here (anwesend, or here and gone again) */
  here: number
  /** said they come, not recorded yet — the way the crew list below sorts them. «kommt nicht»
   *  has no list, only its count (owner, 11.11.2026: «the people not here are useless»). */
  coming: Person[]
  /** answers from somebody this device's roster does not know — only ever a number */
  unmapped: number
}

const byRankThenName = (a: Person, b: Person) =>
  rankOrder(a.rank) - rankOrder(b.rank) || a.displayName.localeCompare(b.displayName, 'de')

export function buildAnrueckend(
  resp: DiveraResponses | null | undefined,
  people: Person[],
  attendance: AttendanceState,
): Anrueckend | null {
  if (!resp?.available) return null
  const roster = new Map(people.map((p) => [p.id, p]))
  let here = 0
  // the server already counted the people it could not name; a row this device lacks joins them
  let unmapped = resp.counts?.unmapped ?? 0
  const pick = (ids: string[] | undefined): Person[] => {
    const out: Person[] = []
    for (const id of ids ?? []) {
      const person = roster.get(id)
      if (!person) { unmapped++; continue }
      // Recorded here in ANY state — anwesend, or here and gone again. Either way the Anwesenheit
      // below already carries them; listing them again as «anrückend» would be a second row.
      if (attendance[person.id]) { here++; continue }
      out.push(person)
    }
    return out.sort(byRankThenName)
  }
  const coming = pick(resp.coming)
  // walked for the counts only: one of them recorded here after all (a misclick in Divera) is
  // «da» in the head line, one this roster lacks is unmapped – the names are not shown
  pick(resp.not_coming)
  return {
    counts: {
      coming: resp.counts?.coming ?? (resp.coming?.length ?? 0),
      notComing: resp.counts?.not_coming ?? (resp.not_coming?.length ?? 0),
    },
    here, unmapped, coming,
  }
}
