import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { TimelineEvent } from '../types'
import { appConfig } from '../config/appConfig'
import { deriveReminders, isDue, type OpenReminder } from './reminders'
import { notify, startAlarm, stopAlarm } from './alarm'
import { toast } from './ui'
import type { UndoTimeline } from './undoTimeline'

/** payload App turns into an appended timeline row (keeps all timeline writes in one place) */
export interface ReminderEvent {
  icon: string
  text: string
  reminder: NonNullable<TimelineEvent['reminder']>
}

interface Copy {
  /** OS-notification title when a reminder comes due */
  dueTitle: string
  /** Verlauf text for a done row on a timed Erinnerung, `{text}` = the item's text */
  doneLog: string
  /** …and on an undatierte Pendenz, which never called itself an Erinnerung */
  pendenzDoneLog: string
  /** Verlauf text for a snooze row, `{mins}` + `{text}` */
  snoozeLog: string
  /** Verlauf text for the row that takes a done back, on a timed Erinnerung / a Pendenz */
  reopenLog: string
  pendenzReopenLog: string
}

/** the four row wordings of a tick and its taking-back */
export type DoneWords = Pick<Copy, 'doneLog' | 'pendenzDoneLog' | 'reopenLog' | 'pendenzReopenLog'>

/**
 * «Erledigt» with the house confirm-with-undo (decided 23.09.2026, option A of the UX review).
 *
 * Ticking a Pendenz off was the one irreversible tap on the Verlauf: a 26px ring, no ask, and the
 * item left the pinned block for good. Now it is the same act as every other one-shot that makes
 * something disappear — it happens at once, a toast says «Pendenz erledigt: {text} · Rückgängig»,
 * and the act sits on the Einsatz's ONE undo timeline for ↶ as well. Both doors (the ring in the
 * Verlauf, «Erledigt» on the Meldeleiste) come through here.
 *
 * ⚠️ APPEND-ONLY both ways. The Verlauf never loses a row, so «Rückgängig» is not a removal of the
 * done row but a NEW `reopened` row beside it («Pendenz wieder offen: …»), and ↷ appends a fresh
 * done row. `deriveReminders` folds the sequence; nothing is edited.
 * ⚠️ Each direction checks the item's CURRENT state first (`isOpen`) and does nothing — returning
 * `false`, the timeline's soft failure — when it already stands where the step would put it: a
 * colleague may have reopened or closed it meanwhile, and a second «wieder offen» row for an item
 * that is open is a record of something that did not happen.
 * ⚠️ The toast's «Rückgängig» does the inverse itself and DROPS the timeline entry, so the act
 * is never undoable twice (docs/undo.md · confirm-with-undo).
 */
export function completeReminder(r: Pick<OpenReminder, 'id' | 'text' | 'dueAt'>, deps: {
  append: (ev: ReminderEvent) => void
  /** is this item open RIGHT NOW — read at step time, never at push time */
  isOpen: (id: string) => boolean
  copy: Pick<Copy, 'doneLog' | 'pendenzDoneLog' | 'reopenLog' | 'pendenzReopenLog'>
  timeline?: Pick<UndoTimeline, 'push'>
  /** the toast; `onUndo` is its «Rückgängig» */
  announce?: (text: string, onUndo: () => void) => void
}): void {
  flipReminder(r, true, deps)
}

/**
 * The same act the other way: an «Erledigt» taken back by un-ticking it (the Tafel's «Aufträge /
 * Pendenzen» page, 05.11.2026). A `reopened` row with confirm-with-undo; ↶ / «Rückgängig» append
 * a fresh `done` row. Does nothing when the item is already open.
 */
export function reopenReminder(r: Pick<OpenReminder, 'id' | 'text' | 'dueAt'>, deps: Parameters<typeof completeReminder>[1]): void {
  flipReminder(r, false, deps)
}

/** `close`: tick off (done row) or take back (reopened row) — each the other's inverse. */
function flipReminder(r: Pick<OpenReminder, 'id' | 'text' | 'dueAt'>, close: boolean, deps: Parameters<typeof completeReminder>[1]): void {
  const { append, isOpen, copy, timeline, announce } = deps
  // ⚠️ Two wordings, picked off the item itself: an undatierte Pendenz never called itself an
  // Erinnerung, so «Erinnerung erledigt: Absperrmaterial» would name a thing that never existed.
  const doneText = (r.dueAt ? copy.doneLog : copy.pendenzDoneLog).replace('{text}', r.text)
  const reopenText = (r.dueAt ? copy.reopenLog : copy.pendenzReopenLog).replace('{text}', r.text)
  // each direction checks the item's live state first and declines (false) when it already
  // stands where the step would put it (see completeReminder)
  const done = () => {
    if (!isOpen(r.id)) return false
    append({ icon: 'check', text: doneText, reminder: { op: 'done', id: r.id } })
    return true
  }
  // 'undo', the glyph of a taking-back; the Bereich still comes from the `reminder` payload
  // (report · journalArea answers «Pendenz» before it ever looks at the icon)
  const reopen = () => {
    if (isOpen(r.id)) return false
    append({ icon: 'undo', text: reopenText, reminder: { op: 'reopened', id: r.id } })
    return true
  }
  const [act, back, label] = close ? [done, reopen, doneText] : [reopen, done, reopenText]
  if (!act()) return
  // ⚠️ `touches: []` — both directions APPEND a Verlauf row and write nothing of the workspace, so
  // no workspace merge can invalidate them; each checks the item's live state itself (isOpen)
  const drop = timeline?.push({ domain: 'pendenz', label, touches: () => [], undo: back, redo: act }) ?? (() => {})
  announce?.(label, () => { if (back()) drop() })
}

/** Same ids in the same order — the due set is derived from an ordered `open`, so order is stable. */
function sameIds(a: readonly string[], b: readonly string[]): boolean {
  return a.length === b.length && a.every((id, i) => id === b[i])
}

/**
 * Drives Wiedervorlagen off the append-only timeline: derives the open set and appends
 * done/snooze rows via `onEvent` — nothing here mutates the timeline. The CLOCK is not here:
 * which of the open ones are due, and the alert when one crosses, live in `RemindersHost`,
 * which the caller mounts with `<RemindersHost {...host} alert={…} />`. The parent only learns the due
 * set when it CHANGES, so the 10 s tick never re-renders the caller.
 *
 * `enabled` is false during replay so historical reminders don't re-alarm while scrubbing.
 */
export function useReminders(
  timeline: readonly TimelineEvent[],
  onEvent: (ev: ReminderEvent) => void,
  copy: Copy,
  enabled = true,
  /** the Einsatzende — reminders due before it are expired by closure (no stale alarms on reopen) */
  closedAt?: string | null,
  /** the Einsatz's undo timeline — an «Erledigt» joins it (completeReminder) */
  undo?: Pick<UndoTimeline, 'push'>,
) {
  const open = useMemo(() => deriveReminders(timeline, closedAt), [timeline, closedAt])
  // ⚠️ Both read through refs: an undo entry and a toast outlive the render that made them, and
  // must see the item's state — and the writer — as they are when the step is TAKEN.
  const openRef = useRef(open)
  const onEventRef = useRef(onEvent)
  useEffect(() => { openRef.current = open; onEventRef.current = onEvent })

  // the host's verdict — ids, so a re-derived `open` (a new row anywhere) never has to wait for
  // the next tick to show the right banner
  const [dueIds, setDueIds] = useState<readonly string[]>([])
  const onDue = useCallback((ids: readonly string[]) => setDueIds((prev) => (sameIds(prev, ids) ? prev : ids)), [])
  const due = useMemo(() => open.filter((r) => dueIds.includes(r.id)), [open, dueIds])

  // confirm-with-undo — see completeReminder above
  const { doneLog, pendenzDoneLog, reopenLog, pendenzReopenLog } = copy
  /** tick off (`done`) or take back an item, in the given words (the Tafel page says where it
   *  happened — «Erledigt auf der Tafel: …») or the Verlauf's own */
  const setDone = useCallback((r: Pick<OpenReminder, 'id' | 'text' | 'dueAt'>, done: boolean, words?: DoneWords) => {
    ;(done ? completeReminder : reopenReminder)(r, {
      append: (ev) => onEventRef.current(ev),
      isOpen: (id) => openRef.current.some((o) => o.id === id),
      copy: words ?? { doneLog, pendenzDoneLog, reopenLog, pendenzReopenLog },
      timeline: undo,
      announce: (text, onUndo) => toast(text, { icon: done ? 'check' : 'undo', action: { label: appConfig.copy.undo, onClick: onUndo } }),
    })
  }, [doneLog, pendenzDoneLog, reopenLog, pendenzReopenLog, undo])
  const markDone = useCallback((r: OpenReminder) => setDone(r, true), [setDone])

  // ⚠️ 'bell', not 'clock' (23.08.). On the Verlauf the 26px disc IS the Bereich now, and 'clock'
  // was also the glyph the QR poster writes on an Anwesenheits-Zeitenzeile — one glyph, two
  // Bereiche, unreadable as a classification. The bell is the glyph the Erinnerung already wears
  // where the operator meets it (ReminderBanner), so nothing new has to be learned. Rows written
  // before the change keep 'clock' and still classify as Pendenz: they carry a `reminder`, which
  // `journalArea` answers long before it looks at the icon.
  const snooze = useCallback((r: OpenReminder, mins: number) => {
    const dueAt = new Date(Date.now() + mins * 60_000).toISOString()
    onEvent({
      icon: 'bell',
      text: copy.snoozeLog.replace('{mins}', String(mins)).replace('{text}', r.text),
      reminder: { op: 'snoozed', id: r.id, dueAt },
    })
  }, [onEvent, copy.snoozeLog])

  const host = useMemo(
    () => ({ open, enabled, dueTitle: copy.dueTitle, onDue }),
    [open, enabled, copy.dueTitle, onDue],
  )

  return { open, due, openCount: open.length, dueCount: due.length, markDone, setDone, snooze, host }
}

/**
 * Null-rendering host for the reminder clock — the same shape as `AtemschutzAlarmHost`, for the
 * same reason: the tick is component state, so whoever holds it re-renders on every beat. Held
 * by `useReminders` in IncidentWorkspace that was the whole 5800-line workspace — map overlays,
 * twin layers, whiteboard props — every 10 s from the first second of every Einsatz, reminders
 * or not. Here the tick re-renders only this empty component, and `onDue` reaches the parent
 * only when the SET of due ids changes (a crossing, a done, a snooze), never on a plain tick.
 *
 * Also owns the alert itself: a short tone (no loop — reminders aren't life-safety like the
 * SCBA clock) plus an OS notification when the app isn't in the foreground, once per crossing.
 * ⚠️ Only where `alert` says so — the WRITERS of the Verlauf, editor and el (owner, 22.10.2026):
 * a Wiedervorlage is a to-do for whoever can tick it off, so a viewer's tablet or a link's phone
 * shows the due row (the banner, from `onDue`) without ringing. Their one alarm is Atemschutz's.
 */
export function RemindersHost({ open, enabled, alert, dueTitle, onDue }: {
  open: readonly OpenReminder[]
  enabled: boolean
  /** tone + OS notification on a crossing (the session writes the Verlauf); the due set is kept either way */
  alert: boolean
  dueTitle: string
  onDue: (ids: readonly string[]) => void
}): null {
  // coarse tick (10s) — promptly enough for a minute-granularity reminder without busy-looping.
  // ALSO recompute the instant the app resumes (visibility/focus): a device backgrounded or locked
  // throttles/pauses timers, so a reminder that came due while away would otherwise surface up to
  // 10s late in-app — recompute on resume so an overdue reminder is shown immediately at 3am.
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const tick = () => setNow(Date.now())
    const id = setInterval(tick, 10_000)
    const onResume = () => { if (!document.hidden) tick() }
    document.addEventListener('visibilitychange', onResume)
    window.addEventListener('focus', onResume)
    return () => {
      clearInterval(id)
      document.removeEventListener('visibilitychange', onResume)
      window.removeEventListener('focus', onResume)
    }
  }, [])

  const due = useMemo(() => (enabled ? open.filter((r) => isDue(r, now)) : []), [open, now, enabled])

  // alert once per reminder as it crosses into due
  const fired = useRef<Set<string>>(new Set())
  const toneTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  useEffect(() => {
    if (!enabled || !alert) return
    const fresh = due.filter((r) => !fired.current.has(r.id))
    if (fresh.length === 0) return
    for (const r of fresh) {
      fired.current.add(r.id)
      if (typeof document !== 'undefined' && document.hidden) void notify(dueTitle, { body: r.text, tag: `reminder-${r.id}`, target: 'journal' })
    }
    startAlarm('warn')
    if (toneTimer.current) clearTimeout(toneTimer.current)
    toneTimer.current = setTimeout(() => stopAlarm(), 4000)
  }, [due, enabled, alert, dueTitle])

  // a reminder that's resolved/snoozed before re-firing should be able to alert again later
  useEffect(() => {
    const openIds = new Set(open.map((r) => r.id))
    const dueIds = new Set(due.map((r) => r.id))
    for (const id of fired.current) if (!openIds.has(id) || !dueIds.has(id)) fired.current.delete(id)
  }, [open, due])

  useEffect(() => () => { if (toneTimer.current) clearTimeout(toneTimer.current); stopAlarm() }, [])

  // the parent hears about the SET, and only when it changes — `due` is a fresh array every
  // tick, so a reference check here would push a state update up on every beat
  const last = useRef<readonly string[]>([])
  useEffect(() => {
    const ids = due.map((r) => r.id)
    if (sameIds(last.current, ids)) return
    last.current = ids
    onDue(ids)
  }, [due, onDue])

  return null
}
