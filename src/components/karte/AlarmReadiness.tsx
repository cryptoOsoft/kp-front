// «Alarm auf diesem Gerät» (3am sweep §1, 23.10.2026): the readiness line at the top of «Auf
// diesem Gerät» and under Einstellungen › Gerät (one line that opens, sweep 28.10.2026), and the
// Karte home's nudge card. The rules —
// which row is red, which fix it offers, when the card may show — are lib/alarmReadiness; this
// file gathers the facts (display mode, Notification.permission, the device record, the login's
// expiry) and wires the fixes: «Erlauben» = the permission ask + the push registration,
// «Erneuern» = re-register, «Installieren» = the InstallGuide, «Testalarm senden» = one push to
// this browser, «Keine Alarme auf diesem Gerät» = push off (reversible in the rows).
// The 3am rule: nothing modal by itself, no OS dialog without a tap.

import { useCallback, useEffect, useState } from 'react'
import { appConfig } from '../../config/appConfig'
import { useAuth } from '../../lib/auth'
import { cx } from '../../lib/cx'
import { fillTemplate } from '../../lib/format'
import { fmtDay } from '../../lib/buildingCard'
import { Icon } from '../../lib/icons'
import { toast } from '../../lib/ui'
import { ensureNotifyPermission } from '../../lib/alarm'
import { getInstallPlatform, isStandalone, onInstallStateChange } from '../../lib/installPrompt'
import {
  LATER_DAYS, alarmReady, nudgeDue, onReadinessStore, patchReadinessStore, readReadinessStore, readinessRows, readinessSummary,
  type ReadinessFix, type ReadinessRow, type ReadinessState, type ReadinessStore,
} from '../../lib/alarmReadiness'
import { disablePush, enablePush, ensurePushSubscription, pushAvailable, renewPushSubscription, sendTestPush } from '../../lib/push'
import { Button, IconButton } from '../Button'
import { InstallGuide } from '../InstallGuide'
import { ListCard, ListRow } from '../ListRow'
import s from './Karte.module.css'
import { publishHeight } from '../../lib/publishHeight'

const DAY = 24 * 3600 * 1000
const permissionNow = (): NotificationPermission | 'unsupported' =>
  typeof Notification === 'undefined' ? 'unsupported' : Notification.permission

/** The facts, re-read whenever something that moves them happens: the device record, the
 *  install state, the page coming back (the person may have allowed notifications in the
 *  system settings meanwhile), or a fix this surface ran. */
function useAlarmReadiness() {
  const { user } = useAuth()
  // the clock the rows are judged against — moved on every re-read, never read in render
  const [now, setNow] = useState(() => Date.now())
  const refresh = useCallback(() => setNow(Date.now()), [])
  const [store, setStore] = useState<ReadinessStore>(readReadinessStore)
  const [available, setAvailable] = useState<boolean | null>(null)
  useEffect(() => onReadinessStore(() => { setStore(readReadinessStore()); refresh() }), [refresh])
  useEffect(() => onInstallStateChange(refresh), [refresh])
  useEffect(() => {
    const onVisible = () => { if (document.visibilityState === 'visible') refresh() }
    document.addEventListener('visibilitychange', onVisible)
    return () => document.removeEventListener('visibilitychange', onVisible)
  }, [refresh])
  useEffect(() => {
    let alive = true
    void pushAvailable().then((v) => { if (alive) setAvailable(v) })
    return () => { alive = false }
  }, [])
  const sessionUntil = user?.session_until ? new Date(user.session_until).getTime() : null
  const rows = readinessRows({
    now, standalone: isStandalone(), platform: getInstallPlatform(), permission: permissionNow(),
    subscribedAt: store.subscribedAt, sessionUntil: Number.isFinite(sessionUntil) ? sessionUntil : null,
  })
  return { now, rows, store, available, refresh, linkSession: !!user?.link_scoped }
}

/** The fixes. Each ends in a re-read so the row it belongs to answers at once. */
function useFixes(refresh: () => void) {
  const [guide, setGuide] = useState(false)
  const A = appConfig.copy.karte.device.alarm
  const run = async (fix: ReadinessFix) => {
    if (fix === 'install') { setGuide(true); return }
    if (fix === 'allow') {
      if (await ensureNotifyPermission()) await ensurePushSubscription(true)
    } else if (fix === 'renew') {
      // with a login the normal registration; without one the subscription is its own credential
      if (!(await ensurePushSubscription(true))) await renewPushSubscription()
    }
    refresh()
  }
  const test = async () => {
    const r = await sendTestPush()
    const text = r === 'sent' ? A.testSent : r === 'wait' ? A.testWait : r === 'unavailable' ? A.unavailable : r === 'unregistered' ? A.testUnregistered : A.testFailed
    toast(text, r === 'sent' ? { icon: 'bell' } : { icon: 'warn', tone: 'warn' })
    refresh()
  }
  const optOut = async () => { await disablePush(); refresh() }
  const optIn = async () => {
    // the permission may never have been asked for: this tap is the gesture that may ask
    if (permissionNow() === 'default') await ensureNotifyPermission()
    await enablePush()
    refresh()
  }
  const guideEl = guide ? <InstallGuide onClose={() => setGuide(false)} /> : null
  return { run, test, optOut, optIn, guideEl }
}

const fixLabel = (fix: ReadinessFix, A: typeof appConfig.copy.karte.device.alarm) =>
  fix === 'install' ? A.install : fix === 'allow' ? A.allow : fix === 'renew' ? A.renew : null

/** One readiness row: dot · name · what is the matter · its fix (where it has a button). */
function Row({ row, onFix }: { row: ReadinessRow; onFix: (fix: ReadinessFix) => void }) {
  const A = appConfig.copy.karte.device.alarm
  const d = row.at != null ? fmtDay(new Date(row.at).toISOString()) : ''
  const sub = row.key === 'installed' ? A.installedSub[row.sub as keyof typeof A.installedSub]
    : row.key === 'permission' ? A.permissionSub[row.sub as keyof typeof A.permissionSub]
      : row.key === 'subscription' ? fillTemplate(A.subscriptionSub[row.sub as keyof typeof A.subscriptionSub], { d })
        : fillTemplate(A.sessionSub[row.sub as keyof typeof A.sessionSub], { d })
  const label = fixLabel(row.fix, A)
  return (
    <ListRow data-alarm-row={row.key} data-state={row.state}
      lead={<span className={cx(s.alarmDot, row.state === 'warn' && s.alarmWarn, row.state === 'red' && s.alarmRed)} aria-hidden />}
      title={A[row.key]} sub={<>{sub}<span className="sr-only"> · {A.state[row.state]}</span></>}
      end={label && <Button variant={row.state === 'red' ? 'primary' : 'secondary'} onClick={() => onFix(row.fix)}>{label}</Button>} />
  )
}

/** «Alarm auf diesem Gerät» as ONE line that opens — at the top of «Auf diesem Gerät» and under
 *  Einstellungen › Gerät (owner's pick 17A, sweep 28.10.2026: «drop the title, since the card is
 *  already its own title»). Closed: «✓ Alarm bereit · Getestet am …» with the Testalarm on it, the
 *  one button anyone presses here. A row that is not green always stands open under it, fix and
 *  all (amber reads «Alarm bereit · 1 Hinweis», red «Kein Alarm auf diesem Gerät»); ⌄ opens the
 *  green rows and the opt-out. Nothing for a link session (no login, no push). Seeing the rows
 *  green counts as a check (the nudge card's 90-day clock). */
export function AlarmReadinessRows({ className }: { className?: string }) {
  const A = appConfig.copy.karte.device.alarm
  const { rows, store, available, refresh, linkSession } = useAlarmReadiness()
  const { run, test, optOut, optIn, guideEl } = useFixes(refresh)
  const [open, setOpen] = useState(false)
  const ready = alarmReady(rows)
  useEffect(() => {
    if (!ready || !available || store.optedOut) return
    if (store.lastCheck == null || Date.now() - store.lastCheck > DAY) patchReadinessStore({ lastCheck: Date.now() })
  }, [ready, available, store.optedOut, store.lastCheck])
  if (linkSession) return null
  // a deployment without push (no VAPID pair) wakes no device: never «bereit», and no Testalarm
  const s0 = available === false ? { state: 'warn' as const, sub: A.unavailable } : summary(rows, store.lastTest)
  const toggle = (
    <IconButton label={open ? A.hideAll : A.showAll} aria-expanded={open} onClick={() => setOpen((v) => !v)} data-alarm-toggle="">
      <Icon id="chevron-down" className="chev" />
    </IconButton>
  )
  const head = store.optedOut ? (
    <ListRow className={s.alarmSum} lead={<Icon id="bell-off" />} title={A.optedOut} sub={A.optedOutSub} data-alarm-summary="off"
      end={<span className={s.alarmSumEnd}><Button variant="primary" onClick={() => void optIn()}>{A.optIn}</Button>{toggle}</span>} />
  ) : (
    <ListRow className={s.alarmSum} data-alarm-summary={s0.state}
      lead={s0.state === 'ok' ? <Icon id="check" className={s.alarmOk} /> : <span className={cx(s.alarmDot, s0.state === 'warn' ? s.alarmWarn : s.alarmRed)} aria-hidden />}
      title={<span className={cx(s0.state === 'red' && s.alarmHeadRed)}>{s0.state === 'red' || available === false ? A.notReady : A.ready}</span>}
      sub={s0.sub}
      end={<span className={s.alarmSumEnd}>
        {available !== false && <Button onClick={() => void test()} aria-label={A.test} data-alarm-test="">{A.testShort}</Button>}
        {toggle}
      </span>} />
  )
  // closed: only what needs a look; open: every row, and the opt-out where push is still on
  const shown = open ? rows : rows.filter((r) => r.state !== 'ok')
  return (
    <div className={cx(s.alarmRows, className)} data-alarm-rows="">
      <ListCard>
        {head}
        {shown.map((r) => <Row key={r.key} row={r} onFix={(f) => void run(f)} />)}
        {open && !store.optedOut && (
          <ListRow lead={<Icon id="bell-off" />} title={A.optOut} sub={A.optOutSub} chevron={false} onClick={() => void optOut()} data-alarm-optout="" />
        )}
      </ListCard>
      {guideEl}
    </div>
  )
}

/** The closed line's state and words (lib/alarmReadiness · readinessSummary), each with when
 *  this device was last tested. */
function summary(rows: readonly ReadinessRow[], lastTest: number | null): { state: ReadinessState; sub: string } {
  const A = appConfig.copy.karte.device.alarm
  const d = lastTest != null ? fmtDay(new Date(lastTest).toISOString()) : null
  // the hint line is longer, so its date drops the year («getestet 20.10.»)
  const dm = d ? d.slice(0, 6) : null
  const { state, count } = readinessSummary(rows)
  const n = { n: String(count) }
  if (state === 'red') return { state, sub: count === 1 ? A.missingOne : fillTemplate(A.missingMany, n) }
  if (state === 'warn') {
    const hints = count === 1 ? A.hintOne : fillTemplate(A.hintMany, n)
    return { state, sub: `${hints} · ${dm ? fillTemplate(A.testedShort, { d: dm }) : A.neverShort}` }
  }
  return { state, sub: d ? fillTemplate(A.testedOn, { d }) : A.testNever }
}

// the card's height as `--nudge-h`: the toasts stand under it, not on its head (08-toasts / 15-mobile ·
// `--nudge-reserve`; owner 25.10.2026: «Rapport abgeschlossen» covered «… noch nie getestet»)
const nudgeHeight = publishHeight('--nudge-h')

/** The Karte home's card (owner's pick, round 1): only in the installed app, only when a row is
 *  red or nothing was checked for 90 days, never inside an Einsatz. The first red row with its fix, or — all green — the
 *  Testalarm; «Später» hides it 30 days, «Keine Alarme auf diesem Gerät» for good (push off).
 *  Collapses to nothing when there is nothing to say — not to a line. */
export function AlarmNudgeCard({ inIncident, phone }: { inIncident: boolean; phone: boolean }) {
  const A = appConfig.copy.karte.device.alarm
  const { now, rows, store, available, refresh, linkSession } = useAlarmReadiness()
  const { run, test, optOut, guideEl } = useFixes(refresh)
  if (available == null || !nudgeDue(rows, { now, standalone: isStandalone(), inIncident, linkSession, pushUnavailable: !available, store })) return guideEl
  const red = rows.find((r) => r.state === 'red') ?? null
  const head = red ? A.nudgeRed : store.lastCheck == null ? A.nudgeCheck : A.nudgeCheckOld
  return (
    <>
      <section ref={nudgeHeight} className={cx(s.alarmCard, phone && s.alarmCardPhone)} aria-label={A.title} data-alarm-nudge={red ? 'red' : 'check'}>
        <div className={s.alarmEyebrow}>{A.title}</div>
        <h2 className={cx(s.alarmHead, red && s.alarmHeadRed)}>{head}</h2>
        {red ? (
          <ListCard><Row row={red} onFix={(f) => void run(f)} /></ListCard>
        ) : (
          <Button icon={<Icon id="bell" />} onClick={() => void test()} data-alarm-test="">{A.test}</Button>
        )}
        <div className={s.alarmActs}>
          <Button variant="quiet" onClick={() => patchReadinessStore({ laterUntil: Date.now() + LATER_DAYS * DAY })} data-alarm-later="">{A.later}</Button>
          <Button variant="quiet" onClick={() => void optOut()} data-alarm-optout="">{A.optOut}</Button>
        </div>
      </section>
      {guideEl}
    </>
  )
}
