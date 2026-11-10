// Alarm-created incident awareness: which incident a cold start should land on, and which
// newly appeared incident deserves the «Neuer Einsatz» banner. Pure logic — the polling
// hook lives in useIncidentWatch.ts.

import type { IncidentMeta } from './incidents'
import { isLooping, readCrash, type CrashRecord } from './crashLoop'

// Everything that is not human-created counts as alarm-created: 'divera' (taken OR
// auto-opened) and any generic-intake source slug.
const HUMAN_SOURCES = new Set(['manual', 'migrated'])
export const isAlarmCreated = (i: IncidentMeta): boolean => !HUMAN_SOURCES.has(i.source)

// Same freshness window as the Divera pool banner: don't announce stale alarms.
export const INCIDENT_ALERT_MAX_AGE_MS = 3 * 60 * 60 * 1000

const ts = (iso: string): number => {
  const n = new Date(iso).getTime()
  return Number.isFinite(n) ? n : 0
}

/**
 * Cold-start incident selection. The remembered incident normally wins, but a NEWER
 * alarm-created incident takes precedence — a killed app reopens onto the live alarm,
 * not onto yesterday's Einsatz. Archived incidents are never picked (an all-archived
 * deployment boots to the clean landing screen).
 *
 * ⚠️ That override is BOUNDED, twice, and both bounds were missing until 23.08. — where the
 * other two rules in this file each carry a freshness window AND a per-device «I have seen
 * this» memory, this one had neither, so:
 *   - `now`: an alarm older than the window has stopped being the reason you picked up the
 *     tablet. Without this the comparison was against a fixed `started_at`, so an open alarm
 *     Einsatz kept winning next week, not just tonight.
 *   - `chosenAt`: an alarm that already existed when the operator DELIBERATELY opened something
 *     else does not get to drag them back on every reload. It is the same signal a dismissed
 *     banner carries, read from the cookie rather than a set (lib/prefs · incidentChosenAt).
 * A genuinely new alarm still wins, which is the case the rule exists for.
 *
 * An incident whose crash record is LOOPING (lib/crashLoop) is never picked: after «Einsatz
 * schliessen» on the boundary card the poisoned Einsatz used to come straight back on the next
 * launch whenever it was the only open one, so the escape led back into the crash. `crash` is
 * injectable for tests and defaults to the device's own record.
 *
 * `landedAt` (lib/prefs) — the operator closed an Einsatz here and was put on the launcher. With
 * no remembered Einsatz the boot then stays there instead of falling back to the first open one;
 * only a fresh alarm that arrived after the close opens by itself (05.10.2026: after every
 * Abschluss the next launch stood inside another open Einsatz).
 */
export function pickBootIncident(
  list: IncidentMeta[],
  savedId: string | null | undefined,
  opts: { now: number; chosenAt?: number; landedAt?: number; crash?: CrashRecord | null } = { now: Date.now() },
): IncidentMeta | undefined {
  const crash = opts.crash === undefined ? readCrash() : opts.crash
  const open = list.filter((i) => !i.is_archived && !isLooping(crash, i.id, opts.now))
  const saved = savedId ? open.find((i) => i.id === savedId) : undefined
  const newestAlarm = open
    .filter(isAlarmCreated)
    .reduce<IncidentMeta | undefined>((best, i) => (!best || ts(i.started_at) > ts(best.started_at) ? i : best), undefined)
  if (opts.landedAt != null && !saved) {
    const fresh = newestAlarm != null
      && opts.now - ts(newestAlarm.started_at) < INCIDENT_ALERT_MAX_AGE_MS
      && ts(newestAlarm.started_at) > opts.landedAt
    return fresh ? newestAlarm : undefined
  }
  const overrides = newestAlarm != null
    && opts.now - ts(newestAlarm.started_at) < INCIDENT_ALERT_MAX_AGE_MS
    && (opts.chosenAt == null || ts(newestAlarm.started_at) > opts.chosenAt)
    && (!saved || ts(newestAlarm.started_at) > ts(saved.started_at))
  if (overrides) return newestAlarm
  return saved ?? open[0]
}

/** How long a reload (never a fresh launch) still returns to an Einsatz that is ABGESCHLOSSEN — longer than the alarm
 *  window, because it has to span the Einsatz you just closed plus the Rapport-Nacharbeit that
 *  follows it, and shorter than «für immer», because the next day's launch belongs on the clean
 *  launcher (see `shouldReopenClosed`). */
export const CLOSED_RETURN_MAX_AGE_MS = 12 * 60 * 60 * 1000

/**
 * Boot's SECOND door, for the Einsatz that is not in the open list at all because it is
 * abgeschlossen. `pickBootIncident` deliberately never picks an archived Einsatz, and the list
 * boot works from is the non-archived one — so an Einsatz being viewed read-only out of «Alle
 * Einsätze», and one a colleague closed while it was on screen, both vanished on reload and left
 * the operator on the launch card. With its Brand and its Anmelde-Untertitel that card reads as
 * «ich bin abgemeldet worden», which is the worst possible answer to a reload at 3am.
 *
 * The caller fetches the remembered Einsatz by id (it is not in the list to look up) and opens it
 * read-only when this says so. Bounded like every other rule in this file, on either half of
 * «I was actually there»:
 *   - `chosenAt` — the operator opened this Einsatz BY HAND recently (the Verlauf case: the
 *     Einsatz itself may be months old, the decision to look at it is minutes old), and
 *   - the Abschluss itself is recent (the mid-Einsatz case: an Einsatz that auto-opened never
 *     stamps `chosenAt`, so it has no hand-chosen moment to point at).
 * Neither → the clean launcher, unchanged. A crash-looping Einsatz is never returned to either:
 * the boundary's «Einsatz schliessen» escape must not lead back in through this door.
 *
 * And only on a RELOAD (`reload`, App · the navigation entry's type). A fresh launch – the app
 * closed and opened again – never comes back to a closed Einsatz: it put the owner back on the
 * Einsatz they had just left (20.10.2026).
 */
export function shouldReopenClosed(
  inc: IncidentMeta,
  opts: { now: number; reload: boolean; chosenAt?: number; crash?: CrashRecord | null },
): boolean {
  if (!opts.reload) return false
  const crash = opts.crash === undefined ? readCrash() : opts.crash
  if (isLooping(crash, inc.id, opts.now)) return false
  const chosenRecently = opts.chosenAt != null && opts.now - opts.chosenAt < CLOSED_RETURN_MAX_AGE_MS
  const ended = ts(inc.closed_at ?? inc.report_done_at ?? inc.updated_at)
  return chosenRecently || (ended > 0 && opts.now - ended < CLOSED_RETURN_MAX_AGE_MS)
}

/**
 * The incident (if any) the «Neuer Einsatz» banner should announce: alarm-created, fresh,
 * not the one already active, appeared AFTER this session's baseline poll, and not yet
 * dismissed on this device. Newest first when several qualify.
 */
export function freshAlarmCandidate(
  list: IncidentMeta[],
  opts: { activeId: string | null; baselineIds: ReadonlySet<string>; dismissed: ReadonlySet<string>; now: number },
): IncidentMeta | null {
  return (
    list
      .filter(
        (i) =>
          !i.is_archived &&
          isAlarmCreated(i) &&
          i.id !== opts.activeId &&
          !opts.baselineIds.has(i.id) &&
          !opts.dismissed.has(i.id) &&
          opts.now - ts(i.started_at) < INCIDENT_ALERT_MAX_AGE_MS,
      )
      .reduce<IncidentMeta | null>((best, i) => (!best || ts(i.started_at) > ts(best.started_at) ? i : best), null)
  )
}

/** Cheap change check so the 30 s poll doesn't re-render an unchanged list. capture_writes
 *  is compared explicitly: a QR journal append bumps only the counter (updated_at is pinned
 *  — bookkeeping, not a content change), and the QR-usage chip must still refresh. */
export function sameIncidentList(a: IncidentMeta[] | null, b: IncidentMeta[]): boolean {
  if (!a || a.length !== b.length) return false
  return a.every((x, n) => x.id === b[n].id && x.updated_at === b[n].updated_at && x.capture_writes === b[n].capture_writes)
}

// Per-device dismissal (same pattern as the Divera pool banner's kp.divera.dismissed):
// a given incident only nags once on this device, across reloads. Capped so the tiny
// localStorage entry can't grow unbounded.
const DISMISS_KEY = 'kp.incident.dismissed'
const DISMISS_CAP = 50

export function loadDismissedIncidents(): Set<string> {
  try {
    return new Set(JSON.parse(localStorage.getItem(DISMISS_KEY) ?? '[]') as string[])
  } catch {
    return new Set()
  }
}

export function saveDismissedIncident(id: string): void {
  try {
    const ids = [...loadDismissedIncidents().add(id)].slice(-DISMISS_CAP)
    localStorage.setItem(DISMISS_KEY, JSON.stringify(ids))
  } catch {
    /* private mode */
  }
}

// --- intake review (what the take wizard used to be) ---------------------------------
// An alarm opens its own Einsatz now, so the dispatch's guesses — Stichwort, Kategorie,
// Priorität, Ort — reach the live map uncorrected. The review banner is where the EL fixes
// them: on the surface they are already looking at, with the Lage running behind it, rather
// than in a wizard that has to be got through before anyone can work.
//
// ⚠️ Unlike every other banner in this file, this one retires ACROSS DEVICES (25.08.): the
// dispatch's guesses are checked once by whoever gets there first, and until then every tablet
// and phone that opened the Einsatz put the same question up again — the crew's report was that
// the banner kept coming back on device after device, long after it had been answered at the
// desk. Tapping «Passt» (or saving a correction) stamps `intakeReviewedAt` on the incident's
// workspace blob (lib/workspace), and the other devices drop the banner on their next poll.
// The per-device set below stays as the local half: it retires the banner INSTANTLY on the
// tapping device (no waiting for a save + poll round trip) and keeps an offline device that
// reviewed on its own from re-nagging after a reload.
const REVIEWED_KEY = 'kp.incident.reviewed'

export function loadReviewedIncidents(): Set<string> {
  try {
    return new Set(JSON.parse(localStorage.getItem(REVIEWED_KEY) ?? '[]') as string[])
  } catch {
    return new Set()
  }
}

export function saveReviewedIncident(id: string): void {
  try {
    const ids = [...loadReviewedIncidents().add(id)].slice(-DISMISS_CAP)
    localStorage.setItem(REVIEWED_KEY, JSON.stringify(ids))
  } catch {
    /* private mode */
  }
}

/**
 * Should the correct-in-place review banner show for this incident? Only for an EDITOR (a
 * viewer can't correct anything), only for an incident an alarm opened by itself
 * (`auto_opened` — a human-created one was already reviewed while it was typed), only while
 * it is fresh, and only until it has been reviewed ANYWHERE: `reviewedAt` is the incident
 * workspace's shared stamp (someone else already confirmed it), `reviewed` this device's own
 * memory of having done so.
 */
export function needsIntakeReview(
  inc: IncidentMeta | null | undefined,
  opts: { isEditor: boolean; reviewed: ReadonlySet<string>; reviewedAt?: string | null; now: number },
): boolean {
  if (!inc || !opts.isEditor || !inc.auto_opened || inc.is_archived) return false
  if (opts.reviewedAt || opts.reviewed.has(inc.id)) return false
  return opts.now - ts(inc.started_at) < INCIDENT_ALERT_MAX_AGE_MS
}

/** Where «Rückgängig» on a one-tap take returns to: the Einsatz that was open BEFORE the take, if
 *  it is still in the open list — otherwise null, which is home. Never «the first one in the
 *  list»: with an Übung and a real Einsatz open that was the other one, silently (sweep
 *  09.11.2026, UX.7 — the rule the close flow has had since 25.09.2026). */
export function undoTakeReturn(open: IncidentMeta[], previousId: string | null): IncidentMeta | null {
  return (previousId && open.find((i) => i.id === previousId)) || null
}
