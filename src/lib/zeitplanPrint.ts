// Führungsformular «Zeitplan» — building the print payload and getting the sheet out.
//
// The server composes the PDF (backend/app/zeitplan_pdf.py); nothing renders here. Two ways
// out, the same pair the Einsatzrapport offers: download the file, or queue it on the station
// printer for the sheet you hang at the front.

import type { AttendanceState, Person, Shift, ShiftBand } from '../types'
import { shiftsFor, sortBands } from './shifts'
import { rankAbbr, rankLabel } from './rank'
import { intervalsOf } from './attendanceIntervals'
import { editorPrintTransport, enqueuePrint } from './printRelay'
import { downloadPdf } from './download'

const BASE = import.meta.env.VITE_KP_RUECK_URL ?? ''

/**
 * The two sheets, chosen separately because they answer different questions — so the surface asks
 * which one rather than guessing (see the paper menu).
 *
 * `verfuegbarkeiten` — who can do what, from when to when, band or no band. Everyone's times,
 *   including the freihändig ones that belong to no column at all, and the only sheet on which
 *   those appear. This is the sheet that exists with or without bands.
 * `schichtplan` — the watches across the top, the names down the side, ticks in between: the
 *   Führungsformular the crew knows. Meaningless without bands, so it is only ever offered
 *   once one exists.
 */
export type ZeitplanSheet = 'verfuegbarkeiten' | 'schichtplan'

export interface ZeitplanPrintPayload {
  /** which of the two sheets to compose. Absent on an older client = the availability sheet, the
   *  only one that existed then. */
  sheet: ZeitplanSheet
  incidentTitle: string
  incidentAddress?: string
  startedAt?: string
  printedAt: string
  /** the named windows, in the grid's own order. Empty on the availability sheet, which knows
   *  nothing about columns. */
  bands: { id: string; label: string; from: string; to: string }[]
  rows: {
    name: string
    rank?: string
    blocks: { from: string; to?: string; confirmed: boolean; bandId?: string }[]
    /** recorded attendance — the thin rule under the plan on the sheet */
    actual: { from: string; to?: string }[]
  }[]
}

/**
 * The sheet's data: one row per person in the order the surface shows them, carrying BOTH halves
 * of that person's time — the plan (availability offered, and what was assigned from it) and the
 * attendance actually recorded.
 *
 * The attendance used to be left off deliberately, on the grounds that the sheet is a planning aid
 * and the record belongs in the Rapport. That was the wrong cut for the person holding it: the
 * sheet is read while deciding who to send home and who to call in, and a plan without the record
 * beside it cannot answer whether the plan held. The Rapport is still the record; this is a
 * working copy of it, and it is marked as one.
 *
 * Everyone gets a row, planned or not: a Führungsformular is written on, and an empty lane is
 * where the pen goes.
 */
export function buildZeitplanPayload(
  people: Person[],
  attendance: AttendanceState,
  shifts: Shift[],
  incident: { title: string; address?: string | null; startedAt?: string | null },
  nowIso: string,
  sheet: ZeitplanSheet = 'verfuegbarkeiten',
  bands: ShiftBand[] = [],
): ZeitplanPrintPayload {
  return {
    sheet,
    incidentTitle: incident.title,
    ...(incident.address ? { incidentAddress: incident.address } : {}),
    ...(incident.startedAt ? { startedAt: incident.startedAt } : {}),
    printedAt: nowIso,
    // one shape on the wire for both sheets: the Schichtplan groups the blocks by their bandId,
    // the availability sheet ignores both fields and prints every block it is given
    bands: sortBands(bands).map((b) => ({ id: b.id, label: b.label, from: b.from, to: b.to })),
    rows: people.map((p) => ({
      name: p.displayName,
      // the ABBREVIATION, not the key. The sheet used to print «gruppenfuehrer Amstad Manuel»,
      // because `rank` is a config key and only the client holds the station's rank table — the
      // backend has no way to turn it into «Grf».
      ...(rankAbbr(p.rank) || rankLabel(p.rank) ? { rank: rankAbbr(p.rank) || rankLabel(p.rank) } : {}),
      blocks: shiftsFor(shifts, p.id).map((s) => ({
        from: s.from, to: s.to, confirmed: !!s.confirmed, ...(s.bandId ? { bandId: s.bandId } : {}),
      })),
      // `to` omitted while somebody is still here — the sheet draws an open block up to the
      // moment it was printed, which is the only honest end for one
      actual: intervalsOf(attendance[p.id]).map((iv) => (iv.to ? { from: iv.from, to: iv.to } : { from: iv.from })),
    })),
  }
}

/** Download the sheet as a PDF. Resolves once the browser has the blob. */
export async function downloadZeitplanPdf(incidentId: string, payload: ZeitplanPrintPayload): Promise<void> {
  const form = new FormData()
  form.append('payload', JSON.stringify(payload))
  // named after the SHEET: two downloads on one name means the second silently replaces the
  // first in a Downloads folder somebody is about to print from
  const filename = payload.sheet === 'schichtplan' ? 'Schichtplan.pdf' : 'Verfuegbarkeiten.pdf'
  await downloadPdf(`/api/incidents/${encodeURIComponent(incidentId)}/zeitplan/pdf`, form, filename)
}

/** Queue the sheet on the station printer; resolves to the job id (for the live toast). */
export function printZeitplan(incidentId: string, payload: ZeitplanPrintPayload): Promise<string> {
  const t = editorPrintTransport(BASE)
  return enqueuePrint(
    { ...t, enqueueUrl: (id) => `${BASE}/api/incidents/${encodeURIComponent(id)}/zeitplan/print` },
    incidentId,
    payload,
  )
}
