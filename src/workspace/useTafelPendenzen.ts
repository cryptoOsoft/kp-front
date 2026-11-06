// The Tafel's «Aufträge / Pendenzen» page, as the workspace serves it (05.11.2026): the Verlauf it
// lists and the writers its acts go through (lib/pendenzenPage says which row each act appends).
// Called after useJournalWriters, whose Wiedervorlagen (`reminders`) own the tick, and merged
// into the Tafel's props (workspace/useTafelPages) — the Whiteboard hands it to the page.
//
// Every write APPENDS a Verlauf row through the workspace's one `pushEvent`, on the Tafel's sheet
// (so its jump-back opens the Tafel), and mirrors it into the hash-chained audit like the
// composer does. ↶: a tick is the Verlauf's own confirm-with-undo (useReminders · setDone); a
// correction of Was / Wer / Prio. joins the timeline as a closure whose inverse is ANOTHER
// correction row back to the old words (append-only); a created Pendenz is a record row, as from
// the composer, and is ticked off rather than taken back (docs/undo.md).

import { useEffect, useMemo, useRef, type Dispatch, type SetStateAction } from 'react'
import type { TafelPagesProps } from '../components/Whiteboard'
import { TAFEL_ID, findForms } from '../lib/boardForm'
import { newId, newRowId } from '../lib/ids'
import { createdRow, editRow, isPendenzenPage, tafelDoneWords, type PageRow, type PendenzDraft, type PendenzenPort } from '../lib/pendenzenPage'
import { pendenzLedger, type PendenzItem } from '../lib/reminders'
import { serverNowIso } from '../lib/serverClock'
import { showTafelPage } from '../lib/tafelPages'
import type { UndoTimeline } from '../lib/undoTimeline'
import type { useReminders } from '../lib/useReminders'
import type { BoardDoc, TimelineEvent } from '../types'

export interface TafelPendenzenSources {
  tafel: TafelPagesProps | undefined
  timeline: TimelineEvent[]
  reminders: Pick<ReturnType<typeof useReminders>, 'setDone'>
  pushEvent: (ev: Omit<TimelineEvent, 'id' | 't' | 'at'> & { at?: string }, id?: string) => void
  emit: (op_type: string, payload?: Record<string, unknown>) => void
  /** the session writes the Verlauf (access · readOnly is false) */
  canWrite: boolean
  author?: string
  setJournalOpen: Dispatch<SetStateAction<boolean>>
  setJournalLandOn: Dispatch<SetStateAction<{ id: string; nonce: number } | null>>
  undoHist: Pick<UndoTimeline, 'push'>
  incidentId: string
  /** the sheets — the page is looked up on the Tafel's */
  board: BoardDoc
  /** close the Verlauf and show that plan (the workspace's surface switch) */
  showPlan: (planId: string) => void
}

/** the fields a correction changed, as they stand in `item` */
const fieldsOf = (item: Pick<PendenzItem, 'text' | 'assignee' | 'urgent'>, keys: readonly (keyof PendenzDraft)[]): Partial<PendenzDraft> =>
  Object.fromEntries(keys.map((k) => [k, k === 'text' ? item.text : k === 'assignee' ? item.assignee ?? '' : !!item.urgent]))

/** The Tafel's props with the page's port, and the Verlauf's way back to the page («von der Tafel»). */
export function useTafelPendenzen(src: TafelPendenzenSources): { tafel: TafelPagesProps | undefined; openPage: () => void } {
  // an undo entry is pressed long after the render that pushed it: it reads the Verlauf as it is then
  const latest = useRef(src)
  useEffect(() => { latest.current = src })
  const { tafel, timeline, canWrite, author } = src

  const port = useMemo((): PendenzenPort => {
    const append = (row: PageRow, id?: string, at?: string) =>
      latest.current.pushEvent({ ...row, surface: 'plan', planId: TAFEL_ID, ...(at ? { at } : {}) }, id)
    const now = (id: string) => pendenzLedger(latest.current.timeline).find((i) => i.id === id)
    /** append the correction `patch` on the item as it stands now; false when nothing changes */
    const correct = (id: string, patch: Partial<PendenzDraft>): boolean => {
      const item = now(id)
      const row = item && editRow(item, patch)
      if (!row) return false
      append(row)
      latest.current.emit('reminder.note', { id })
      return true
    }
    return {
      timeline, canWrite, author,
      setDone: (item, done) => latest.current.reminders.setDone(item, done, tafelDoneWords()),
      create: (d, pageTitle) => {
        const id = newId('pnd')
        const row = createdRow(d, id, pageTitle)
        if (!row) return null
        const rowId = newRowId('j')
        const at = serverNowIso()
        append(row, rowId, at)
        latest.current.emit('reminder.create', { id })
        return { rowId, at }
      },
      edit: (item, patch) => {
        const row = editRow(item, patch)
        if (!row) return
        const keys = (Object.keys(patch) as (keyof PendenzDraft)[]).filter((k) => patch[k] !== undefined)
        const before = fieldsOf(item, keys)
        if (!correct(item.id, patch)) return
        const after = { ...before, ...patch }
        // ⚠️ each direction checks the item first: only when it still says what this step left it
        // saying — a colleague's correction meanwhile is not overwritten by a stale ↶
        const says = (want: Partial<PendenzDraft>) => {
          const cur = now(item.id)
          return !!cur && JSON.stringify(fieldsOf(cur, keys)) === JSON.stringify(fieldsOf({ text: want.text ?? '', assignee: want.assignee, urgent: want.urgent }, keys))
        }
        latest.current.undoHist.push({
          domain: 'pendenz', label: row.text, touches: () => [],
          undo: () => says(after) && correct(item.id, before),
          redo: () => says(before) && correct(item.id, after),
        })
      },
      showInVerlauf: (rowId) => {
        latest.current.setJournalOpen(true)
        latest.current.setJournalLandOn({ id: rowId, nonce: Date.now() })
      },
    }
  }, [timeline, canWrite, author])

  const withPort = useMemo(() => (tafel ? { ...tafel, pendenzen: port } : undefined), [tafel, port])
  const openPage = () => {
    const s = latest.current
    const page = findForms(s.board[TAFEL_ID] ?? []).find((a) => isPendenzenPage(a.form))
    if (page) showTafelPage(s.incidentId, page.id)
    s.showPlan(TAFEL_ID)
  }
  return { tafel: withPort, openPage }
}
