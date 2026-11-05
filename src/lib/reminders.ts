// Pendenzen (open items), derived from the append-only Verlauf stream.
//
// The journal never edits or removes a row (see the kp-front-journal note), so an open item's
// lifecycle is a SEQUENCE of events sharing one `reminder.id`:
//   - `created`  → carries the text, and a `dueAt` only if it is a timed Erinnerung
//   - `note`     → a later row reporting what happened, without closing it. It MAY carry a new
//                  `dueAt` — a Meldung that moves the Wiedervorlage («Werkhof meldet 20 Minuten»)
//   - `snoozed`  → a later row with a new `dueAt` (timed Erinnerungen only)
//   - `done`     → a later row that closes it
//   - `reopened` → a later row that takes a `done` back («Rückgängig» on the erledigt toast, or ↶,
//                  23.09.2026). The done row STAYS — the record says it was ticked off and then
//                  reopened, in that order — and the item is open again with the due it had.
// The open set, each item's *effective* due time and its latest Meldung are derived here — never
// stored as mutable fields. This keeps everything correct under offline merge + replay for free.
//
// ⚠️ Two kinds live in one list, and the difference that matters is the `dueAt`:
//   - WITHOUT one: a Pendenz. Open until done, never alarms. There are no check-ins on a
//     Schadenplatz, so a due time on an Auftrag would be a fiction — you would only be alerting
//     yourself. What you want to know is how long it has been running, which the created time says.
//   - WITH one: today's Erinnerung, unchanged — banner, tone, OS notification, +10 min.

import { appConfig } from '../config/appConfig'
import { fuzzyScore, norm } from './quickPhrases'
import type { Surface, TimelineEvent } from '../types'

/**
 * «wieder in …» on a done row (Journal · JournalRow): the items re-raised from a closed one that are
 * still OPEN, keyed by the item they re-raise (`reminder.again`), with how far ahead each was set
 * (whole minutes, its `dueAt` less its row's `at`). That done row shows ✓ «↻ in 30 min gesetzt»
 * instead of its chips – the one-time action's done state, read off the record
 * (docs/ui-conventions.md · One-time actions); once the re-raise is closed too, the chips are back.
 */
export function openReRaises(timeline: readonly TimelineEvent[], open: readonly Pick<OpenReminder, 'id'>[]): Map<string, number> {
  const openIds = new Set(open.map((r) => r.id))
  const out = new Map<string, number>()
  for (const e of timeline) {
    const r = e.reminder
    if (r?.op !== 'created' || !r.again || !openIds.has(r.id) || !r.dueAt || !e.at) continue
    out.set(r.again, Math.max(1, Math.round((Date.parse(r.dueAt) - Date.parse(e.at)) / 60_000)))
  }
  return out
}

/** The latest Meldung on an open item — what the list shows under the item's own text. */
export interface PendenzNote {
  /** the note row's id, so the list can jump to it */
  rowId: string
  text: string
  /** ISO instant, for the list's time column */
  at: string
}

export interface OpenReminder {
  /** stable id (the `created` row's reminder.id) */
  id: string
  /** timeline row id of the `created` event — target for "In Verlauf öffnen" */
  rowId: string
  /** the bare item — «Lüfter prüfen», NOT the `created` row's own text («Erinnerung gesetzt für
   *  22:10: Lüfter prüfen», or «Auftrag · Lüfter prüfen»). Everything that re-shows an item
   *  prints its own context, so the prefixes arrived as a stutter. */
  text: string
  /** effective due time (ISO) for a timed Erinnerung: the latest snooze, else the original.
   *  ABSENT on a Pendenz — which is the whole difference between the two (see the note above). */
  dueAt?: string
  /** when it was raised (ISO) — the list's time column and the Rapport's «Erteilt». '' if an
   *  older row lacked `at`. */
  createdAt: string
  /** sorts to the top and prints a marker. The LATEST event carrying it wins. */
  urgent?: boolean
  /** «Wer» for the Rapport column, read off the sentence when it was written */
  assignee?: string
  /** EVERY Meldung on this item, oldest first.
   *  ⚠️ Not just the latest. The Meldungen stand in the Verlauf where they happened, scattered
   *  among everything else, and nothing there says which item each belongs to — so the item's own
   *  row is the only place the thread can be read as a thread. Showing one of three was worse than
   *  showing none: it looked like the whole story. */
  notes: PendenzNote[]
  /** surface it was raised on, for the Verlauf chip / jump */
  surface?: Surface
}

/**
 * Reduce the timeline to the still-open items, each with its effective state.
 * Order-independent: events are folded oldest→newest so the latest op wins regardless of how the
 * (newest-first) timeline is stored or merged.
 *
 * `closedAt` (the Einsatzende): timed Erinnerungen due BEFORE the incident was closed are expired
 * by closure — reopening a weeks-old incident for a Nachtrag must not fire stale überfällig alarms
 * the moment it opens.
 * ⚠️ That rule is about ALARMS, so it applies only to items that have a due time. An undatierte
 * Pendenz that was never ticked off is genuinely unfinished; dropping it on reopen would hide the
 * one thing somebody has to take away from the Einsatz.
 */
export function deriveReminders(timeline: readonly TimelineEvent[], closedAt?: string | null): OpenReminder[] {
  const created = new Map<string, TimelineEvent>()
  const latest = new Map<string, { op: 'created' | 'snoozed' | 'done' | 'reopened'; dueAt?: string }>()
  const urgency = new Map<string, boolean>()
  const notes = new Map<string, PendenzNote[]>()

  for (let i = timeline.length - 1; i >= 0; i--) {
    const e = timeline[i]
    const r = e.reminder
    if (!r) continue
    // Urgency is taken from whatever event carries it, latest wins — the same append-only pattern
    // as `snoozed`/`dueAt`. ⚠️ Only `created` writes it today: re-ranking an item from one of its
    // Meldungen was tried and pulled (see types · reminder.urgent). The tolerance stays, so the
    // action can be given its own control later without a second reducer.
    if (r.urgent !== undefined) urgency.set(r.id, r.urgent)
    if (r.op === 'note') {
      // ⚠️ Does NOT touch the item's OP. A Meldung reports on an item; it never opens or closes
      // one, and it must not resurrect an item that a later `done` already closed.
      // …but it may carry a new `dueAt` — «Werkhof meldet 20 Minuten» is exactly when the
      // Wiedervorlage moves. That is a snooze in everything but the row it rides on, and it has to
      // ride on the note: a separate snooze row would take the sentence out of the item's thread.
      const st = latest.get(r.id)
      if (r.dueAt && st) latest.set(r.id, { ...st, dueAt: r.dueAt })
      const list = notes.get(r.id) ?? []
      list.push({ rowId: e.id, text: e.text, at: e.at ?? '' })
      notes.set(r.id, list)
      continue
    }
    if (r.op === 'created') {
      created.set(r.id, e)
      latest.set(r.id, { op: 'created', dueAt: r.dueAt })
    } else {
      // a snooze without an explicit dueAt keeps the previous due — and so do `done` and
      // `reopened`, which is what hands a reopened Erinnerung back the Fälligkeit it had
      latest.set(r.id, { op: r.op, dueAt: r.dueAt ?? latest.get(r.id)?.dueAt })
    }
  }

  const closedMs = closedAt ? Date.parse(closedAt) : NaN
  const open: OpenReminder[] = []
  for (const [id, c] of created) {
    const st = latest.get(id)
    if (!st || st.op === 'done') continue
    const dueAt = st.dueAt ?? c.reminder?.dueAt
    // expired by closure — timed Erinnerungen only (see the doc comment)
    if (dueAt && Number.isFinite(closedMs) && Date.parse(dueAt) < closedMs) continue
    const mine = notes.get(id) ?? []
    open.push({
      id, rowId: c.id, text: bareText(c), dueAt, createdAt: c.at ?? '',
      urgent: urgency.get(id) || undefined,
      assignee: c.reminder?.assignee,
      notes: mine,
      surface: c.surface,
    })
  }
  // dringend first, then the OLDEST first: the position carries the age, so the time column can
  // stay a plain clock. Undated and dated sort together — one list, one question («was ist offen»).
  return open.sort((a, b) =>
    Number(!!b.urgent) - Number(!!a.urgent)
    || a.createdAt.localeCompare(b.createdAt)
    || a.id.localeCompare(b.id))
}

/**
 * The bare item text of a `created` row.
 *
 * New rows carry it on `reminder.text`. Rows written before that — and the record is append-only,
 * so they are still there and still open — only have the composed row text, so the «Erinnerung
 * gesetzt für {t}: » lead-in is peeled off it. The pattern is derived FROM the copy template rather
 * than hard-coded, so it keeps working in every locale and stays correct if the wording changes;
 * anything that does not match is returned untouched.
 *
 * Exported for the «wieder in …» re-raise (IncidentWorkspace): the new `created` row has to
 * carry the ITEM, not the closed row's sentence — same one implementation, both directions.
 */
export function bareText(e: TimelineEvent): string {
  const explicit = e.reminder?.text?.trim()
  if (explicit) return explicit
  const tpl = appConfig.copy.journal.reminderCreated
  const lead = tpl.slice(0, tpl.indexOf('{text}'))
  if (!lead || !tpl.includes('{text}')) return e.text
  const esc = lead.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace('\\{t\\}', '.{0,12}?')
  const m = new RegExp(`^${esc}`).exec(e.text)
  return m ? e.text.slice(m[0].length).trim() || e.text : e.text
}

/** Only a TIMED Erinnerung can come due. A Pendenz has no due time and never alarms. */
export function isDue(r: OpenReminder, nowMs: number): boolean {
  return r.dueAt != null && Date.parse(r.dueAt) <= nowMs
}

/**
 * Open items whose own words match what is being typed — the composer offers them so an entry can
 * become a Meldung ON one of them without leaving the sheet.
 *
 * ⚠️ The match has to START A WORD of the item, at every length. `fuzzyScore` alone is a
 * subsequence match, which from three letters on hits almost anything — the same trap the name
 * suggestions documented and fixed (lib/journalEntry · startsAWord). Getting this wrong is worse
 * here than there: accepting a name inserts a word, accepting one of these changes what the entry
 * IS, so a coincidental match costs more than a wrong spelling.
 *
 * ⚠️ Matched against the WHOLE typed text, not the word under the cursor: «Werkhof meldet Fahrzeug
 * unterwegs» is a Meldung on «Absperrmaterial Kreuzung, Werkhof Oberwil», and the word that says so
 * («Werkhof») is nowhere near the caret by the time the sentence is finished.
 */
export function suggestPendenzen<T extends Pick<OpenReminder, 'text' | 'createdAt'>>(text: string, open: readonly T[], limit = 2): T[] {
  const words = norm(text).split(/[\s]+/).filter((w) => w.length >= 2)
  if (!words.length) return []
  return open
    .map((r) => ({ r, score: Math.max(...words.map((w) => (startsAWord(w, r.text) ? fuzzyScore(w, r.text) : 0))) }))
    .filter((m) => m.score > 0)
    .sort((a, b) => b.score - a.score || a.r.createdAt.localeCompare(b.r.createdAt))
    .slice(0, limit)
    .map((m) => m.r)
}

/** …the same «must begin one of the target's words» rule the name suggestions use. */
function startsAWord(word: string, target: string): boolean {
  return norm(target).split(/[\s(/,.-]+/).some((w) => w.startsWith(word))
}
