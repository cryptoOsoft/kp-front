// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  CHECK_DAYS, LATER_DAYS, SESSION_WARN_DAYS, SUBSCRIPTION_STALE_DAYS,
  alarmReady, nudgeDue, onReadinessStore, patchReadinessStore, readReadinessStore, readinessRows, readinessSummary, type ReadinessFacts, type ReadinessStore,
} from './alarmReadiness'

const DAY = 24 * 3600 * 1000
const NOW = Date.UTC(2026, 9, 23, 3, 0)
const green: ReadinessFacts = { now: NOW, standalone: true, platform: 'ios', permission: 'granted', subscribedAt: NOW - 10 * DAY, sessionUntil: NOW + 80 * DAY }
const byKey = (f: ReadinessFacts) => Object.fromEntries(readinessRows(f).map((r) => [r.key, r]))

describe('the four rows', () => {
  it('a device that would wake is green on every row', () => {
    const rows = readinessRows(green)
    expect(rows.map((r) => r.state)).toEqual(['ok', 'ok', 'ok', 'ok'])
    expect(alarmReady(rows)).toBe(true)
    expect(rows).toEqual([
      { key: 'installed', state: 'ok', fix: null, sub: 'installed', at: null },
      { key: 'permission', state: 'ok', fix: null, sub: 'granted', at: null },
      { key: 'subscription', state: 'ok', fix: null, sub: 'subscribed', at: NOW - 10 * DAY },
      { key: 'session', state: 'ok', fix: null, sub: 'valid', at: NOW + 80 * DAY },
    ])
  })

  it('an iOS browser tab is red on «installiert» – push exists only in the installed app; Android is a hint', () => {
    expect(byKey({ ...green, standalone: false }).installed).toMatchObject({ state: 'red', fix: 'install', sub: 'browserIos' })
    expect(byKey({ ...green, standalone: false, platform: 'android' }).installed).toMatchObject({ state: 'warn', fix: 'install', sub: 'browser' })
  })

  it('permission: not yet asked → «Erlauben», denied → the system, no Notification global on iOS → install first', () => {
    expect(byKey({ ...green, permission: 'default' }).permission).toMatchObject({ state: 'red', fix: 'allow', sub: 'ask' })
    expect(byKey({ ...green, permission: 'denied' }).permission).toMatchObject({ state: 'red', fix: 'system', sub: 'denied' })
    expect(byKey({ ...green, standalone: false, permission: 'unsupported' }).permission).toMatchObject({ state: 'red', fix: 'install', sub: 'afterInstall' })
  })

  it('the registration is red when absent or past 150 days, and borrows «Erlauben» while the permission is missing', () => {
    expect(byKey({ ...green, subscribedAt: null }).subscription).toMatchObject({ state: 'red', fix: 'renew', sub: 'none' })
    expect(byKey({ ...green, subscribedAt: null, permission: 'default' }).subscription).toMatchObject({ state: 'red', fix: 'allow' })
    expect(byKey({ ...green, subscribedAt: NOW - (SUBSCRIPTION_STALE_DAYS + 1) * DAY }).subscription).toMatchObject({ state: 'red', fix: 'renew', sub: 'stale' })
    expect(byKey({ ...green, subscribedAt: NOW - (SUBSCRIPTION_STALE_DAYS - 1) * DAY }).subscription.state).toBe('ok')
  })

  it('the login: expired is red, under two weeks a warning, unknown a warning – never a button', () => {
    expect(byKey({ ...green, sessionUntil: NOW - 1 }).session).toMatchObject({ state: 'red', fix: null, sub: 'gone' })
    expect(byKey({ ...green, sessionUntil: NOW + (SESSION_WARN_DAYS - 1) * DAY }).session).toMatchObject({ state: 'warn', sub: 'soon' })
    expect(byKey({ ...green, sessionUntil: null }).session).toMatchObject({ state: 'warn', sub: 'unknown' })
  })
})

// sweep 28.10.2026, 17A: the rows fold into one line that names the worst state and its count
describe('the one line', () => {
  it('green with nothing to count, amber counts the hints, red counts what is missing and wins', () => {
    expect(readinessSummary(readinessRows(green))).toEqual({ state: 'ok', count: 0 })
    expect(readinessSummary(readinessRows({ ...green, standalone: false, platform: 'android' }))).toEqual({ state: 'warn', count: 1 })
    // an iOS tab: not installed AND no Notification global — two red rows, the session hint does not count
    expect(readinessSummary(readinessRows({ ...green, standalone: false, permission: 'unsupported', sessionUntil: null }))).toEqual({ state: 'red', count: 2 })
  })
})

describe('the nudge card', () => {
  const store = (p: Partial<ReadinessStore> = {}): ReadinessStore => ({ subscribedAt: null, lastTest: null, lastCheck: NOW - DAY, optedOut: false, laterUntil: null, ...p })
  const ctx = (p: Partial<Parameters<typeof nudgeDue>[1]> = {}) => ({ now: NOW, standalone: true, inIncident: false, linkSession: false, pushUnavailable: false, store: store(), ...p })
  const red = readinessRows({ ...green, permission: 'default' })
  const ok = readinessRows(green)

  it('shows for a red row, and for a device nobody checked in 90 days', () => {
    expect(nudgeDue(red, ctx())).toBe(true)
    expect(nudgeDue(ok, ctx())).toBe(false)
    expect(nudgeDue(ok, ctx({ store: store({ lastCheck: null }) }))).toBe(true)
    expect(nudgeDue(ok, ctx({ store: store({ lastCheck: NOW - (CHECK_DAYS + 1) * DAY }) }))).toBe(true)
  })

  it('never in a browser tab', () => {
    expect(nudgeDue(red, ctx({ standalone: false }))).toBe(false)
  })

  it('never inside an Einsatz, for a link session, without push on the deployment, after an opt-out, or inside «Später»', () => {
    expect(nudgeDue(red, ctx({ inIncident: true }))).toBe(false)
    expect(nudgeDue(red, ctx({ linkSession: true }))).toBe(false)
    expect(nudgeDue(red, ctx({ pushUnavailable: true }))).toBe(false)
    expect(nudgeDue(red, ctx({ store: store({ optedOut: true }) }))).toBe(false)
    expect(nudgeDue(red, ctx({ store: store({ laterUntil: NOW + LATER_DAYS * DAY }) }))).toBe(false)
    expect(nudgeDue(red, ctx({ store: store({ laterUntil: NOW - 1 }) }))).toBe(true)
  })
})

describe('the device record', () => {
  beforeEach(() => localStorage.clear())
  afterEach(() => vi.restoreAllMocks())

  it('reads empty, patches, and survives a corrupt value', () => {
    expect(readReadinessStore()).toEqual({ subscribedAt: null, lastTest: null, lastCheck: null, optedOut: false, laterUntil: null })
    patchReadinessStore({ subscribedAt: NOW, optedOut: true })
    expect(readReadinessStore()).toMatchObject({ subscribedAt: NOW, optedOut: true, lastTest: null })
    localStorage.setItem('kp-alarm-readiness', '{not json')
    expect(readReadinessStore().optedOut).toBe(false)
  })

  it('preserves every timestamp across partial patches, including epoch zero', () => {
    const record = { subscribedAt: NOW, lastTest: NOW - 1, lastCheck: 0, optedOut: true, laterUntil: NOW + DAY }
    expect(patchReadinessStore(record)).toEqual(record)
    expect(readReadinessStore()).toEqual(record)
    expect(patchReadinessStore({ optedOut: false })).toEqual({ ...record, optedOut: false })
    expect(readReadinessStore()).toEqual({ ...record, optedOut: false })
  })

  it.each(['wrong', true, {}, null])('discards nonnumeric timestamps and truthy opt-out values: %j', (value) => {
    localStorage.setItem('kp-alarm-readiness', JSON.stringify({ subscribedAt: value, lastTest: value, lastCheck: value, laterUntil: value, optedOut: 'true' }))
    expect(readReadinessStore()).toEqual({ subscribedAt: null, lastTest: null, lastCheck: null, optedOut: false, laterUntil: null })
  })

  it('notifies subscribers after persistence and supports unsubscribe', () => {
    const snapshots: ReadinessStore[] = []
    const off = onReadinessStore(() => snapshots.push(readReadinessStore()))
    try {
      patchReadinessStore({ lastTest: NOW })
      expect(snapshots).toEqual([{ subscribedAt: null, lastTest: NOW, lastCheck: null, optedOut: false, laterUntil: null }])
      off()
      patchReadinessStore({ lastTest: NOW + 1 })
      expect(snapshots).toHaveLength(1)
    } finally { off() }
  })

  it('keeps live updates usable when storage reads and writes fail', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new Error('blocked') })
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('quota') })
    expect(readReadinessStore().lastTest).toBeNull()
    const seen = vi.fn()
    const off = onReadinessStore(seen)
    try {
      expect(patchReadinessStore({ lastTest: NOW }).lastTest).toBe(NOW)
      expect(seen).toHaveBeenCalledTimes(1)
    } finally { off() }
  })

  it('rejects valid JSON numbers that overflow JavaScript timestamps', () => {
    localStorage.setItem('kp-alarm-readiness', '{"subscribedAt":1e400,"lastTest":-1e400,"lastCheck":1e400,"laterUntil":-1e400}')
    expect(readReadinessStore()).toEqual({ subscribedAt: null, lastTest: null, lastCheck: null, optedOut: false, laterUntil: null })
  })
})

describe('readiness policy boundaries', () => {
  it.each([
    [150 * DAY - 1, 'ok', 'subscribed'], [150 * DAY, 'ok', 'subscribed'], [150 * DAY + 1, 'red', 'stale'],
  ] as const)('a registration aged %i ms follows the 150-day boundary', (age, state, sub) => {
    expect(byKey({ ...green, subscribedAt: NOW - age }).subscription).toEqual({
      key: 'subscription', state, sub, fix: state === 'red' ? 'renew' : null, at: NOW - age,
    })
  })

  it.each([
    [0, 'red', 'gone'], [1, 'warn', 'soon'], [14 * DAY - 1, 'warn', 'soon'], [14 * DAY, 'ok', 'valid'],
  ] as const)('a session with %i ms remaining follows expiry and the two-week warning', (remaining, state, sub) => {
    expect(byKey({ ...green, sessionUntil: NOW + remaining }).session).toEqual({
      key: 'session', state, fix: null, sub, at: NOW + remaining,
    })
  })

  it('directs an unsupported installed device to system settings and treats hints as alarm-capable', () => {
    expect(byKey({ ...green, permission: 'unsupported' }).permission).toEqual({
      key: 'permission', state: 'red', fix: 'system', sub: 'denied', at: null,
    })
    expect(byKey({ ...green, standalone: false, platform: 'android', permission: 'unsupported' }).permission.fix).toBe('system')
    expect(alarmReady(readinessRows({ ...green, sessionUntil: null }))).toBe(true)
    expect(alarmReady(readinessRows({ ...green, sessionUntil: NOW }))).toBe(false)
  })

  it('allows a nudge at the snooze deadline and only after 90 full days since a green check', () => {
    const store = { subscribedAt: null, lastTest: null, lastCheck: NOW - 90 * DAY, optedOut: false, laterUntil: NOW }
    const ctx = { now: NOW, standalone: true, inIncident: false, linkSession: false, pushUnavailable: false, store }
    expect(nudgeDue(readinessRows({ ...green, permission: 'default' }), ctx)).toBe(true)
    expect(nudgeDue(readinessRows(green), ctx)).toBe(false)
    expect(nudgeDue(readinessRows(green), { ...ctx, store: { ...store, lastCheck: store.lastCheck - 1 } })).toBe(true)
    expect(LATER_DAYS).toBe(30)
  })
})
