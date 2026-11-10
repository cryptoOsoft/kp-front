// Midnight on a Tafel table (owner pick 09.11.2026, mock nov09-mitternacht B): a «Wann» column holds
// a clock time only («23:59», «00:01»), so a table that runs past midnight read as if 00:01 came
// before 23:59. Where the day changes, a date row stands between the entries – «Di., 10.11.» in the
// app (TafelFormPage), «Di., 10.11.2026» on paper (lib/boardForm · formForPdf → report_board). On
// the paper's fixed rulings the date row takes one of them; that is accepted.
//
// ⚠️ The rows carry no date, so the day is INFERRED, walking the entries in their order from the
// page's own creation (`BoardFormData.at`): each time is put on the earliest day that is not more
// than BACK_MS before the entry above it – the entries run forward, but one written a little out of
// order («14:00» under «14:10», a forgotten «23:50» under «00:20») stays on the same day instead of
// jumping a day ahead. Rows without a time keep the day of the row above.

/** How far back an entry may stand from the one above it before it counts as the next day. */
const BACK_MS = 6 * 3600_000

const TIME = /^(\d{1,2}):(\d{2})$/

const midnight = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate())

/** For each row (its «Wann», in display order): the day it begins when that is another day than the
 *  row above it (the first dated row: another day than the page's creation), else null. All null
 *  for a table that never leaves the day the page was made on. */
export function dayBreaks(times: readonly (string | undefined)[], anchorIso: string): (Date | null)[] {
  const out: (Date | null)[] = times.map(() => null)
  const anchor = new Date(anchorIso)
  if (Number.isNaN(anchor.getTime())) return out
  let prev = anchor.getTime()
  let shown = midnight(anchor).getTime()
  times.forEach((t, i) => {
    const m = TIME.exec((t ?? '').trim())
    if (!m) return
    const base = midnight(new Date(prev))
    // yesterday, today, tomorrow – the first not too far back from the row above
    const at = [-1, 0, 1, 2]
      .map((d) => new Date(base.getFullYear(), base.getMonth(), base.getDate() + d, Number(m[1]), Number(m[2])))
      .find((c) => c.getTime() >= prev - BACK_MS)
    if (!at) return
    prev = at.getTime()
    const day = midnight(at).getTime()
    if (day !== shown) { out[i] = new Date(day); shown = day }
  })
  return out
}
