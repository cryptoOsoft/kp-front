// Per-device dismissal of Divera pool alarms (localStorage `kp.divera.dismissed`). A given
// alarm nags only once on THIS device — across reloads, and whether it was X'd or taken. This
// is a purely LOCAL "hide it on my tablet" action; it NEVER archives/removes the dispatch for
// the crew (that would be a server-side, everyone-sees-it delete). Shared by the incoming-alarm
// banner and the landing launch list so both behave the same.
import type { DiveraAlarm } from './incidents'

const KEY = 'kp.divera.dismissed'
const CAP = 50 // keep the tiny pref bounded

export function loadDismissedAlarms(): Set<number> {
  try {
    return new Set(JSON.parse(localStorage.getItem(KEY) ?? '[]') as number[])
  } catch {
    return new Set()
  }
}

/** Add `id` to this device's dismissed set (bounded) and return the new set. */
export function dismissAlarm(id: number): Set<number> {
  const ids = [...loadDismissedAlarms().add(id)].slice(-CAP)
  try {
    localStorage.setItem(KEY, JSON.stringify(ids))
  } catch {
    /* private mode — dismissal is best-effort, session-only then */
  }
  return new Set(ids)
}

const ALARM_MAX_AGE_MS = 3 * 60 * 60 * 1000 // only surface dispatches < 3h old

/** The pool alarms the row can actually show: not dismissed on this device, younger than 3 h.
 *  ⚠️ Whoever asks «is the alarm row busy» asks THIS, never the raw pool – the pool endpoint has
 *  no age limit, and one stale or ×-ed alarm used to hide the «Neuer Einsatz» row for good
 *  (sweep 09.11.2026, UX.6). */
export function shownAlarms(alarms: DiveraAlarm[], dismissed: ReadonlySet<number>, now = Date.now()): DiveraAlarm[] {
  return alarms.filter((a) => {
    if (dismissed.has(a.divera_id)) return false
    // age < 3h; no lower bound so minor server/device clock skew can't hide a fresh alarm
    const age = now - new Date(a.received_at).getTime()
    return Number.isFinite(age) && age < ALARM_MAX_AGE_MS
  })
}
