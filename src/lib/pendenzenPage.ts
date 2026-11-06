// The Tafel's «Aufträge / Pendenzen» page (05.11.2026, owner pick 6A) — the PURE half: which
// columns a live section shows, the rows a write on the page appends to the Verlauf, and the
// sheet it prints. The page itself is components/TafelPendenzen; the writers are
// workspace/useTafelPendenzen.
//
// ⚠️ A DERIVED VIEW, never a copy. The page's rows are the Verlauf's Pendenzen and Erinnerungen
// (lib/reminders · pendenzLedger) — nothing of them lives in the page's form anno, which carries
// its snapshot and no values. So a Pendenz typed in the composer is on the page the moment it is
// written, a tick in the Verlauf is a tick here and the other way round, and two devices cannot
// diverge: every act on the page APPENDS a Verlauf row, exactly as the Verlauf's own controls do.
//   - a row typed on the page → a `created` row (`origin: 'tafel'`), «Pendenz von der Tafel …»
//   - Was / Wer / Prio. changed on an item → a `note` row carrying `edit` (+ `urgent`): the
//     append-only correction (types · reminder.edit says why it rides on `note`)
//   - Erledigt ticked / un-ticked → the Verlauf's own `done` / `reopened` (useReminders · setDone)
// «Erteilt» is the item's creation time, always ticked (owner, 05.11.: no new state).

import { appConfig } from '../config/appConfig'
import { fillTemplate, hhmm } from './format'
import { LIVE_COLUMNS, labelText, type Label, type LiveSection, type TemplateColumn } from './boardTemplate'
import { pendenzLedger, type PendenzItem } from './reminders'
import type { BoardFormData } from './boardForm'
import type { TimelineEvent } from '../types'

/** What a row typed on the page says — Was, Wer, Prio. 1. */
export interface PendenzDraft { text: string; assignee?: string; urgent?: boolean }

/** A Verlauf row the page asks the workspace to append (the workspace stamps id, time, surface). */
export interface PageRow {
  icon: string
  text: string
  kind: 'reminder'
  reminder: NonNullable<TimelineEvent['reminder']>
}

/**
 * What the page needs from the Einsatz (workspace/useTafelPendenzen) — absent for a session that
 * has no Tafel pages (an Einsatz-Link).
 */
export interface PendenzenPort {
  timeline: readonly TimelineEvent[]
  /** the session writes the Verlauf (editor, el; not a viewer, a link, a replay, a closed Einsatz) */
  canWrite: boolean
  /** this device's user, for the «eingetragen» hint */
  author?: string
  setDone: (item: PendenzItem, done: boolean) => void
  /** a row typed on the page; answers the new Verlauf row's id and time */
  create: (d: PendenzDraft, pageTitle: string) => { rowId: string; at: string } | null
  edit: (item: PendenzItem, patch: Partial<PendenzDraft>) => void
  /** the Verlauf, opened on that row (the ◷ at a row's end) */
  showInVerlauf: (rowId: string) => void
}

export type PendenzColumn = (typeof LIVE_COLUMNS)['pendenzen'][number]

/** The columns a live section shows: the source's own, as the station ordered and named them. */
export function liveColumns(s: LiveSection): (TemplateColumn & { id: PendenzColumn })[] {
  const known: readonly string[] = LIVE_COLUMNS[s.source]
  return s.columns.filter((c): c is TemplateColumn & { id: PendenzColumn } => !c.hidden && known.includes(c.id))
}

/** Is this page the «Aufträge / Pendenzen» page (one live `pendenzen` section)? */
export const isPendenzenPage = (d: BoardFormData): boolean =>
  d.page.sections.some((s) => s.type === 'live' && (s as LiveSection).source === 'pendenzen' && !s.hidden)

/** An Erinnerung past its time and not ticked off. A Pendenz (no due) is never overdue. */
export const isOverdue = (p: Pick<PendenzItem, 'dueAt' | 'doneAt'>, nowMs: number): boolean =>
  p.dueAt != null && p.doneAt == null && Date.parse(p.dueAt) <= nowMs

const C = () => appConfig.copy.tafelPendenzen

/** The `created` row a page row becomes. `null` when there is no Was — a Wer alone is no Auftrag. */
export function createdRow(d: PendenzDraft, id: string, pageTitle: string): PageRow | null {
  const text = d.text.trim()
  if (!text) return null
  const assignee = d.assignee?.trim() || undefined
  const w = C()
  return {
    icon: 'easel', kind: 'reminder',
    text: fillTemplate(w.createdLog, { page: pageTitle, text })
      + (assignee ? fillTemplate(w.createdWer, { wer: assignee }) : '')
      + (d.urgent ? w.createdUrgent : ''),
    reminder: { op: 'created', id, text, origin: 'tafel', ...(assignee ? { assignee } : {}), ...(d.urgent ? { urgent: true } : {}) },
  }
}

/**
 * The correction row for an item whose Was, Wer or Prio. changed on the page — `null` when
 * nothing actually changes (an emptied Was keeps the old words: an item without words is not one).
 */
export function editRow(item: Pick<PendenzItem, 'id' | 'text' | 'assignee' | 'urgent'>, patch: Partial<PendenzDraft>): PageRow | null {
  const w = C()
  const text = patch.text?.trim()
  const newText = text && text !== item.text ? text : undefined
  const wer = patch.assignee?.trim()
  const newWer = wer !== undefined && wer !== (item.assignee ?? '') ? wer : undefined
  const newUrgent = patch.urgent !== undefined && patch.urgent !== !!item.urgent ? patch.urgent : undefined
  if (newText === undefined && newWer === undefined && newUrgent === undefined) return null
  const changes = [
    newText !== undefined ? fillTemplate(w.editWas, { v: newText }) : '',
    newWer !== undefined ? (newWer ? fillTemplate(w.editWer, { v: newWer }) : w.editWerCleared) : '',
    newUrgent !== undefined ? (newUrgent ? w.editUrgent : w.editNotUrgent) : '',
  ].filter(Boolean).join(' · ')
  return {
    icon: 'easel', kind: 'reminder',
    text: fillTemplate(w.editLog, { text: item.text, changes }),
    reminder: {
      // ⚠️ `edit` always, even when only Prio. changed (`{}`): it is what marks the row as a
      // correction, so the reducer keeps it out of the item's thread of Meldungen
      op: 'note', id: item.id,
      edit: { ...(newText !== undefined ? { text: newText } : {}), ...(newWer !== undefined ? { assignee: newWer } : {}) },
      ...(newUrgent !== undefined ? { urgent: newUrgent } : {}),
    },
  }
}

/** The Verlauf wording of a tick on the page — it says where it was ticked (mock 6A, Verlauf side). */
export const tafelDoneWords = () => {
  const w = C()
  return { doneLog: w.doneLog, pendenzDoneLog: w.doneLog, reopenLog: w.reopenLog, pendenzReopenLog: w.reopenLog }
}

/**
 * The live section, resolved for the paper (lib/boardForm · formForPdf → backend
 * app/report_board): a plain TABLE of the BGV columns, so the server draws it like every other
 * table — ruled empty rows under the entries included, for the hand. Status prints as two lines,
 * «Erteilt 14:09» / «Erledigt 14:18» («–» while open); an Erinnerung's time in «Zeit», with
 * «überfällig» when it was past and open at print time.
 */
export function pendenzenForPdf(s: LiveSection, base: Record<string, unknown>, timeline: readonly TimelineEvent[], nowMs: number, locale?: string): Record<string, unknown> {
  const w = C()
  const L = (l: Label) => labelText(l, locale)
  const cols = liveColumns(s)
  const clock = (iso: string | undefined) => hhmm(iso) || '–'
  const cell = (p: PendenzItem, id: PendenzColumn): string => {
    switch (id) {
      case 'was': return p.text
      case 'wer': return p.assignee ?? ''
      case 'prio': return p.urgent ? '1' : ''
      case 'status': return `${w.erteilt} ${clock(p.createdAt)}\n${w.erledigt} ${p.doneAt != null ? clock(p.doneAt) : '–'}`
      case 'zeit': return p.dueAt ? `${hhmm(p.dueAt)} ${isOverdue(p, nowMs) ? w.overdue : w.erinnerung}` : ''
    }
  }
  return {
    ...base, type: 'table', done: false, adds: true,
    columns: cols.map((c) => ({ label: L(c.label), kind: 'text', w: c.w ?? 1 })),
    rows: pendenzLedger(timeline).map((p) => ({ fixed: false, done: p.doneAt != null, cells: cols.map((c) => cell(p, c.id)) })),
  }
}
