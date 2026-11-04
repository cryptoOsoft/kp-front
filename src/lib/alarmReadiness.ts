// «Alarm auf diesem Gerät» — would a «Neuer Einsatz» push open THIS device right now? (3am sweep
// §1, 23.10.2026.) Four preconditions lapse silently for exactly the operator the tenet
// describes: the app is a browser tab (iOS pushes only to the installed app), notification
// permission was never asked for at a calm moment, the push registration ran past its 180-day
// TTL, the login's refresh token expired. This module turns the facts into rows with one fix
// each, decides when the Karte home's nudge card may show, and keeps the device's own small
// record (last registration, last Testalarm, last green check, «Später», opt-out). Pure — the
// facts are gathered by the component (components/karte/AlarmReadiness); the store is the one
// side effect, in localStorage like the install dismissal (lib/installPrompt).

import type { InstallPlatform } from './installPolicy'

export type ReadinessKey = 'installed' | 'permission' | 'subscription' | 'session'
/** ok = green · warn = a hint, still alarm-capable · red = no alarm reaches this device */
export type ReadinessState = 'ok' | 'warn' | 'red'
/** the one-tap fix a row offers: install → the InstallGuide · allow → the permission ask +
 *  subscribe · renew → re-register · system → none (the OS has the switch; the sub-line says so) */
export type ReadinessFix = 'install' | 'allow' | 'renew' | 'system' | null

export interface ReadinessFacts {
  now: number
  standalone: boolean
  platform: InstallPlatform
  /** `Notification.permission`, or 'unsupported' where the global does not exist (an iOS Safari tab) */
  permission: NotificationPermission | 'unsupported'
  /** when this browser last (re-)registered its push subscription with the server (store) */
  subscribedAt: number | null
  /** when the login's refresh token runs out — `session_until` from /api/auth/me */
  sessionUntil: number | null
}

export interface ReadinessRow {
  key: ReadinessKey
  state: ReadinessState
  fix: ReadinessFix
  /** which wording the sub-line takes (copy · karte.device.alarm) */
  sub: 'installed' | 'browser' | 'browserIos' | 'granted' | 'ask' | 'denied' | 'afterInstall' | 'subscribed' | 'stale' | 'none' | 'valid' | 'soon' | 'gone' | 'unknown'
  /** the date the sub-line names, where it names one */
  at: number | null
}

const DAY = 24 * 3600 * 1000
/** a registration older than this is red: the server drops it at 180 d (push.py · SUBSCRIPTION_TTL_DAYS) */
export const SUBSCRIPTION_STALE_DAYS = 150
/** a login with less than this left is a warning — opening the app renews it */
export const SESSION_WARN_DAYS = 14
/** «Später» on the nudge card */
export const LATER_DAYS = 30
/** the nudge comes back when nothing was checked (a Testalarm, the rows opened green) for this long */
export const CHECK_DAYS = 90

/** The four rows, in the order they are read: the first red one is the nudge card's one fix. */
export function readinessRows(f: ReadinessFacts): ReadinessRow[] {
  const ios = f.platform === 'ios'
  const installed: ReadinessRow = f.standalone
    ? { key: 'installed', state: 'ok', fix: null, sub: 'installed', at: null }
    : ios
      ? { key: 'installed', state: 'red', fix: 'install', sub: 'browserIos', at: null }
      : { key: 'installed', state: 'warn', fix: 'install', sub: 'browser', at: null }
  let permission: ReadinessRow
  switch (f.permission) {
    case 'granted': permission = { key: 'permission', state: 'ok', fix: null, sub: 'granted', at: null }; break
    case 'denied': permission = { key: 'permission', state: 'red', fix: 'system', sub: 'denied', at: null }; break
    case 'default': permission = { key: 'permission', state: 'red', fix: 'allow', sub: 'ask', at: null }; break
    default: permission = ios && !f.standalone
      ? { key: 'permission', state: 'red', fix: 'install', sub: 'afterInstall', at: null }
      : { key: 'permission', state: 'red', fix: 'system', sub: 'denied', at: null }
  }
  // a registration needs the permission: while that is missing, «Erlauben» does both, so the
  // subscription row names the same fix rather than a second button
  const subscription: ReadinessRow = f.subscribedAt == null
    ? { key: 'subscription', state: 'red', fix: f.permission === 'granted' ? 'renew' : permission.fix, sub: 'none', at: null }
    : f.now - f.subscribedAt > SUBSCRIPTION_STALE_DAYS * DAY
      ? { key: 'subscription', state: 'red', fix: 'renew', sub: 'stale', at: f.subscribedAt }
      : { key: 'subscription', state: 'ok', fix: null, sub: 'subscribed', at: f.subscribedAt }
  const session: ReadinessRow = f.sessionUntil == null
    ? { key: 'session', state: 'warn', fix: null, sub: 'unknown', at: null }
    : f.sessionUntil <= f.now
      ? { key: 'session', state: 'red', fix: null, sub: 'gone', at: f.sessionUntil }
      : f.sessionUntil - f.now < SESSION_WARN_DAYS * DAY
        ? { key: 'session', state: 'warn', fix: null, sub: 'soon', at: f.sessionUntil }
        : { key: 'session', state: 'ok', fix: null, sub: 'valid', at: f.sessionUntil }
  return [installed, permission, subscription, session]
}

/** The one line the rows fold into (sweep 28.10.2026, 17A): red when any row is red, amber when
 *  any is a hint, else green — with how many rows make it so. The closed line shows exactly those. */
export function readinessSummary(rows: readonly ReadinessRow[]): { state: ReadinessState; count: number } {
  const red = rows.filter((r) => r.state === 'red').length
  if (red) return { state: 'red', count: red }
  const warn = rows.filter((r) => r.state === 'warn').length
  return warn ? { state: 'warn', count: warn } : { state: 'ok', count: 0 }
}

/** No row is red: an alarm would reach this device (a warning is a hint, not a gap). */
export const alarmReady = (rows: readonly ReadinessRow[]): boolean => rows.every((r) => r.state !== 'red')

/** What the nudge card needs beyond the rows: where the device is and what it chose. */
export interface NudgeContext {
  now: number
  /** the installed app (lib/installPrompt · isStandalone) — a browser tab never gets the card
   *  (owner, 31.10.2026); its rows stay in «Auf diesem Gerät» */
  standalone: boolean
  /** an Einsatz is open on this device — the card never shows inside one */
  inIncident: boolean
  /** a link session has no login and no push — nothing to nudge */
  linkSession: boolean
  /** the deployment has no VAPID pair: no push at all, nothing to fix on the device */
  pushUnavailable: boolean
  store: ReadinessStore
}

/** Whether the Karte home shows the nudge card: something is red, or nothing was checked for
 *  CHECK_DAYS — only in the installed app, never inside an Einsatz, for a link session, after an
 *  opt-out, or inside «Später». */
export function nudgeDue(rows: readonly ReadinessRow[], ctx: NudgeContext): boolean {
  const s = ctx.store
  if (!ctx.standalone || ctx.inIncident || ctx.linkSession || ctx.pushUnavailable || s.optedOut) return false
  if (s.laterUntil != null && s.laterUntil > ctx.now) return false
  if (!alarmReady(rows)) return true
  return s.lastCheck == null || ctx.now - s.lastCheck > CHECK_DAYS * DAY
}

// ── the device's own record ──────────────────────────────────────────────────────────────────

export interface ReadinessStore {
  /** last successful registration with the server (lib/push · ensurePushSubscription) */
  subscribedAt: number | null
  /** last Testalarm the push service accepted */
  lastTest: number | null
  /** last time the rows were seen green, or a Testalarm went out */
  lastCheck: number | null
  /** «Keine Alarme auf diesem Gerät»: push off, the nudge never shows — reversible in the rows */
  optedOut: boolean
  /** «Später» on the nudge card: hidden until then */
  laterUntil: number | null
}

const KEY = 'kp-alarm-readiness'
const EMPTY: ReadinessStore = { subscribedAt: null, lastTest: null, lastCheck: null, optedOut: false, laterUntil: null }
const listeners = new Set<() => void>()

export function readReadinessStore(): ReadinessStore {
  try {
    const raw = localStorage.getItem(KEY)
    if (!raw) return EMPTY
    const v = JSON.parse(raw) as Partial<ReadinessStore>
    const num = (x: unknown) => (typeof x === 'number' && Number.isFinite(x) ? x : null)
    return { subscribedAt: num(v.subscribedAt), lastTest: num(v.lastTest), lastCheck: num(v.lastCheck), optedOut: v.optedOut === true, laterUntil: num(v.laterUntil) }
  } catch { return EMPTY }
}

export function patchReadinessStore(patch: Partial<ReadinessStore>): ReadinessStore {
  const next = { ...readReadinessStore(), ...patch }
  try { localStorage.setItem(KEY, JSON.stringify(next)) } catch { /* private mode: the rows still read live facts */ }
  for (const cb of listeners) cb()
  return next
}

/** Re-render off a change made elsewhere (lib/push writes `subscribedAt` on boot). */
export function onReadinessStore(cb: () => void): () => void {
  listeners.add(cb)
  return () => { listeners.delete(cb) }
}
