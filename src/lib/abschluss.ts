// Abschluss-Assistent step model: which of the guided closing steps are satisfied by the
// incident data. Pure derivation — the assistant never stores its own progress; reopening
// it weeks later shows the true state (the 3am tenet: recognition, no memorized state).

/*
 * ⚠️ The «Einsatz» tile's badge is what the Rapport still has OPEN, in amber (26.09.2026, owner:
 * «why is there 3 in the bottom when 6 are open?» — it was the head count). ONE number from ONE
 * derivation: `lib/abschluss · abschlussFacts` → `missingSteps`, read by the Rapport's «⚠ n noch
 * offen» chip and — through `useAbschluss`, which now counts the unsettled Abweichungen too — by
 * the badge, the chooser's Rapport row (in the chip's words, `controlChipLabel`), the Abschluss
 * confirm and the archive count (`rapportOneCount.test.tsx`). The head count lives on the
 * chooser's Anwesenheit row.
 */

import type { ReportMeta } from './workspace'

// 'verlauf' was dropped 2026-07-08: system rows make the journal non-empty on every real
// incident, so the check was always-green noise on the closing list.
//
// 'einsatzleiter' was added 2026-08-03: the four Mindestangaben for the digital close are
// Einsatzende, Einsatzleiter, Kurzbericht and at least one person — but only three of them
// were ever checked, so a rapport could close with nobody named as having led the incident.
// Printing is deliberately unaffected: it never blocks, a missing field prints as an empty
// line to fill in by hand (form model 2026-07-17).
// 'abschluss' → 'kurzbericht' 2026-08-07: the step checks `summary`, the Kurzbericht — but it was
// named after the thing it is a step OF, so the confirm read «Noch offen: Abschluss. Trotzdem
// abschliessen?» in a dialog titled «Einsatz abschliessen». A step has to name the field it wants
// filled in; that sentence named the button that was already pressed.
//
// 'rueckmeldung' was added 2026-08-08: whether the ELZ was told the Einsatz is over is a fact
// with a right answer, unlike the Bemerkungen and Lehren it shares its section with — those are
// prose and are legitimately empty on a routine Einsatz, so requiring them would leave the chip
// amber on nearly every rapport and teach the eye to skip it. Named after the FIELD, not after
// the «Nachbearbeitung» section it sits in — see the note above about 'abschluss'.
// 'kontaktperson' was split out from 'einsatzleiter' on 2026-08-11. They are two different
// people answering two different questions — who LED the Einsatz, and who on site the Wehr
// dealt with (Hauswart, Betreiber, Anwohner) — and they sit in one grid, so a single chip
// pointed at both and highlighted both. It is also a fact with a right answer, like the
// Einsatzleiter and unlike the prose beside it.
//
// 'kontaktperson' and 'rueckmeldung' got an «Entfällt» on 2026-08-22, the escape 'mittel' had
// had all along. Both are facts with a right answer AND with a legitimate «gibt es nicht» — a
// Fehlalarm has no contact, an Ölspur is not reported back to the ELZ — so without one the
// rapport of a routine Einsatz could never reach complete, and the «Angaben fehlen noch»
// confirm stood in front of every print until it was being dismissed unread.
//
// 'abweichungen' was added 2026-09-04, out of the 03.09. Rapport review. When the QR-Bogen and a
// tablet wrote the same person at the same moment, the merge kept one value and the Verlauf got
// a «bitte prüfen» line — and that Rapport was closed at 11:41 with three of them standing. A
// warning in the journal is not proof that anybody looked: it is proof that the app noticed.
// So an unsettled divergence is a step like the seven above it, and it BLOCKS NOTHING — the
// button reads «Trotzdem abschliessen», exactly as it does for a missing Kurzbericht. A hard
// refusal at 02:00 over a Funktion nobody can reconstruct would leave the Einsatz standing open
// in the Historie for ever, which is the worse record. The step is satisfied by zero open
// divergences, which is the ordinary case: most Einsätze never produce one at all.
export type AbschlussStep = 'zeiten' | 'anwesenheit' | 'mittel' | 'einsatzleiter' | 'kontaktperson' | 'kurzbericht' | 'rueckmeldung' | 'abweichungen'
// ⚠️ In the Rapport's PAGE order (sweep 28.10.2026, 14x): the head's «n offen» list, the guide strip
// that walks it (`nextOpenStep`), the «Angaben fehlen noch» confirm and the Abschluss confirm all
// read `missingSteps` in this order, so «next» on the strip is the next field down the page –
// Bericht (Kurzbericht · Einsatzleiter · Kontaktperson · Einsatzende · Rückmeldung), then
// Personal & Mittel (Anwesenheit · Material · Abweichungen). ReportPreflight's DOM is the source.
export const ABSCHLUSS_STEPS: AbschlussStep[] = ['kurzbericht', 'einsatzleiter', 'kontaktperson', 'zeiten', 'rueckmeldung', 'anwesenheit', 'mittel', 'abweichungen']

export interface AbschlussFacts {
  reportMeta: ReportMeta
  attendanceCount: number
  mittelCount: number
  /** Anwesenheits-Abweichungen still waiting for somebody (lib/attendanceConflict ·
   *  openConflicts). Absent on a caller that does not know about them yet — which reads as
   *  «none», so an older surface can never show the step as open. */
  openConflicts?: number
  /** The Einsatz is CLOSED. The Anwesenheit is then read-only until «Wieder öffnen», so an empty
   *  one is no longer an open point on the Rapport – it could not be answered there, and what was
   *  not recorded stays empty on the paper (owner pick C11, EL phone sweep 10.11.2026). */
  closed?: boolean
}

export function stepDone(step: AbschlussStep, f: AbschlussFacts): boolean {
  switch (step) {
    case 'zeiten':
      return !!f.reportMeta.endedAt
    case 'anwesenheit':
      return f.attendanceCount > 0 || !!f.closed
    case 'mittel':
      // zero entries is a legitimate rapport — but only when someone SAID so
      return f.mittelCount > 0 || !!f.reportMeta.mittelConfirmedNone
    case 'einsatzleiter':
      return !!f.reportMeta.einsatzleiter?.trim()
    case 'kontaktperson':
      // …or «Entfällt», the same escape `mittel` has: a Fehlalarm has nobody to name, and a step
      // that cannot be satisfied is a step that makes the «Angaben fehlen noch» dialog appear on
      // every print until it is tapped away unread (see workspace · kontaktpersonNone).
      return !!f.reportMeta.kontaktperson?.trim() || !!f.reportMeta.kontaktpersonNone
    case 'kurzbericht':
      return !!f.reportMeta.summary?.trim()
    case 'abweichungen':
      return (f.openConflicts ?? 0) === 0
    case 'rueckmeldung': {
      if (f.reportMeta.rueckmeldungNone) return true // «Entfällt» — see kontaktperson above
      // BOTH halves. A name with no time does not say when, and a time with nobody's name does
      // not say who reported — and the rapport prints the pair as one statement.
      const r = f.reportMeta.rueckmeldungElz
      return !!r?.name?.trim() && !!r.at
    }
  }
}

export function missingSteps(f: AbschlussFacts): AbschlussStep[] {
  return ABSCHLUSS_STEPS.filter((s) => !stepDone(s, f))
}

/**
 * Where the Rapport's guide strip points next (ReportPreflight, owner pick 14 «top strip»): the
 * first still-open step AFTER `from` in page order, wrapping round to the top, never `from`
 * itself. Null when nothing else is open – at the last open point the strip has nowhere to go.
 */
export function nextOpenStep(missing: readonly AbschlussStep[], from: AbschlussStep): AbschlussStep | null {
  const at = ABSCHLUSS_STEPS.indexOf(from)
  const ring = [...ABSCHLUSS_STEPS.slice(at + 1), ...ABSCHLUSS_STEPS.slice(0, at)]
  return ring.find((s) => missing.includes(s)) ?? null
}

/**
 * The facts the Rapport's «noch offen» is counted from — built ONE way for every reader on the KP
 * (26.09.2026): the Rapport's own «⚠ n noch offen» chip (ReportPreflight), and through useAbschluss
 * the phone's «Einsatz» badge, the chooser's «n noch offen» row, the Abschluss confirm and the
 * Einsatz-Menü's archive count. The workspace's copy used to leave `openConflicts` out, so an
 * unsettled Abweichung was open on the Rapport and «done» on every door leading to it — and the
 * badge counted heads besides (NavRail · openCount). The count is the caller's (attendanceConflict
 * · openConflicts over its Verlauf), because the Rapport already holds it memoised.
 * ⚠️ The Rapport passes the form AS IT STANDS ON SCREEN (ReportPreflight · editedMeta), the
 * workspace the blob: between a keystroke and its save the two may differ by the field being
 * typed. That is the only difference left, and it closes with the save.
 */
export function abschlussFacts(reportMeta: ReportMeta, attendanceCount: number, mittelCount: number, openConflictCount: number, closed: boolean): AbschlussFacts {
  return { reportMeta, attendanceCount, mittelCount, openConflicts: openConflictCount, closed }
}

/**
 * Apply an 'HH:MM' wall-clock time onto an existing ISO timestamp's calendar day (local
 * time). Used by the Stunden editor: the person edits times, the date rides along from
 * the original stamp — with `nextDayIfBefore` handling a span that crosses midnight
 * (bis 01:30 after von 22:00 lands on the following day).
 */
export function applyTimeToIso(baseIso: string, hhmm: string, opts?: { nextDayIfBefore?: string; prevDayIfAfter?: string }): string | null {
  const m = /^(\d{1,2}):(\d{2})$/.exec(hhmm)
  if (!m) return null
  const d = new Date(baseIso)
  if (!Number.isFinite(d.getTime())) return null
  d.setHours(Number(m[1]), Number(m[2]), 0, 0)
  if (opts?.nextDayIfBefore) {
    const floor = new Date(opts.nextDayIfBefore)
    if (Number.isFinite(floor.getTime()) && d.getTime() < floor.getTime()) d.setDate(d.getDate() + 1)
  }
  // The mirror of nextDayIfBefore: a START typed after its own end belongs to the previous day (a
  // night shift), not backwards in time — a reversed block renders as nothing and counts as zero
  // minutes. Pick whichever neighbouring day puts the start CLOSEST below the end: stepping back
  // unconditionally turned a correction inside an already-overnight block into a 25-hour one,
  // which is worse than the reversed block this guard exists to prevent, because it looks normal
  // and reaches the Rapport as 25 hours.
  if (opts?.prevDayIfAfter) {
    const DAY = 24 * 60 * 60 * 1000
    const ceil = new Date(opts.prevDayIfAfter).getTime()
    // Was this span ALREADY longer than a day before the edit? Then it is a multi-day stretch, not
    // a night shift, and the pull-forward below must keep its hands off it. Without this guard a
    // correction inside a 58-hour presence (Di 08:00 → Do 18:00, «von» nudged to 09:00) snapped
    // the start to within 24h of the end and silently moved it to the Wednesday — a whole day, ~24
    // hours off the Rapport, with nothing said. The 24h assumption only ever held for one night.
    const spanned = new Date(baseIso).getTime()
    const wasMultiDay = Number.isFinite(ceil) && Number.isFinite(spanned) && ceil - spanned > DAY
    if (Number.isFinite(ceil)) {
      if (d.getTime() > ceil) d.setDate(d.getDate() - 1)
      else if (!wasMultiDay && ceil - d.getTime() > DAY) d.setDate(d.getDate() + 1)
    }
  }
  return d.toISOString()
}

/** An 'HH:MM' placed on a KNOWN calendar day — used when the picker's day wheel said which one,
 *  so nothing has to be inferred from the previous stamp. */
/**
 * Keep an END after its START — by moving the DAY, never the clock.
 *
 * The time-only path already rolls an end past midnight (`applyTimeToIso`'s `nextDayIfBefore`),
 * but picking an explicit day from the wheel bypassed that: «bis» could be set to the day before
 * «von», and a reversed stretch renders as nothing on the grid, counts zero minutes on the Rapport
 * and is findable only by opening the sheet again.
 *
 * The clock the operator chose is kept exactly; only the calendar day steps forward until the
 * stretch runs the right way. That is the half they were choosing, and because both ends now
 * always show their date, the correction is visible rather than silent.
 */
export function keepEndAfterStart(fromIso: string, toIso: string): string {
  const from = new Date(fromIso)
  const to = new Date(toIso)
  if (!Number.isFinite(from.getTime()) || !Number.isFinite(to.getTime())) return toIso
  // one day at a time, and bounded: a start years in the past must not spin this forever
  for (let i = 0; i < 400 && to.getTime() <= from.getTime(); i++) to.setDate(to.getDate() + 1)
  return to.toISOString()
}

/** The mirror: a START set on or after its own end steps BACK a day at a time. */
export function keepStartBeforeEnd(fromIso: string, toIso: string): string {
  const from = new Date(fromIso)
  const to = new Date(toIso)
  if (!Number.isFinite(from.getTime()) || !Number.isFinite(to.getTime())) return fromIso
  for (let i = 0; i < 400 && from.getTime() >= to.getTime(); i++) from.setDate(from.getDate() - 1)
  return from.toISOString()
}

export function isoOnDay(day: Date, hhmm: string): string | null {
  const m = /^(\d{1,2}):(\d{2})$/.exec(hhmm)
  if (!m || !Number.isFinite(day.getTime())) return null
  const h = Number(m[1])
  const mi = Number(m[2])
  // The RANGE has to be checked, not just the shape: «99:99» matches the pattern, and the Date
  // constructor rolls the overflow silently into the following days rather than refusing it — so
  // a typo would land four days out with no complaint.
  if (h > 23 || mi > 59) return null
  const d = new Date(day.getFullYear(), day.getMonth(), day.getDate(), h, mi, 0, 0)
  return Number.isFinite(d.getTime()) ? d.toISOString() : null
}
