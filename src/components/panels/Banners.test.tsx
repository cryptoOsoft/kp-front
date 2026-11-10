// @vitest-environment jsdom
import { describe, it, expect, afterEach } from 'vitest'
import { render, cleanup } from '@testing-library/react'
import { IncomingAlarmBanner, shownAlarms } from './Banners'
import { Meldeleiste } from '../Meldeleiste'
import { appConfig } from '../../config/appConfig'
import type { DiveraAlarm } from '../../lib/incidents'

// A dispatch that arrives while a hand-made Einsatz is open is the one case where taking it is
// the wrong tap: the Übung has no alarm behind it, so nothing routes times into its Zeiten
// until this alarm is attached — and a take would open a second Einsatz beside the one the
// crew is standing in. The row says so by which button is filled, and by reading order.

const alarm: DiveraAlarm = {
  divera_id: 36591264,
  title: 'Brandmeldeanlage',
  address: 'Bachweg 1, Musterdorf',
  received_at: new Date().toISOString(),
} as DiveraAlarm

const ix = appConfig.copy.intake

const labels = (attachFirst: boolean, canAttach = true) => {
  render(
    <>
      <IncomingAlarmBanner
        alarms={[alarm]} dismissed={new Set()} onDismiss={() => {}} taking={null} attachFirst={attachFirst}
        onTake={() => {}} onAttach={canAttach ? () => {} : undefined}
      />
      <Meldeleiste />
    </>,
  )
  const buttons = Array.from(document.querySelectorAll<HTMLElement>('.ml-act button'))
  return {
    order: buttons.map((b) => b.textContent?.trim()),
    primary: buttons.find((b) => b.classList.contains('primary') || b.classList.contains('go'))?.textContent?.trim(),
  }
}

afterEach(cleanup)

describe('IncomingAlarmBanner', () => {
  it('leads with Öffnen while the open Einsatz came from an alarm', () => {
    const { order, primary } = labels(false)
    expect(order).toEqual([ix.alarmOpen, ix.attachShort])
    expect(primary).toBe(ix.alarmOpen)
  })

  it('leads with «Zu Einsatz» while the open Einsatz was made by hand', () => {
    const { order, primary } = labels(true)
    // both actions stay reachable — only the emphasis moves
    expect(order).toEqual([ix.attachShort, ix.alarmOpen])
    expect(primary).toBe(ix.attachShort)
  })

  it('offers no «Zu Einsatz» at all while the open Einsatz is closed — and Öffnen is the one filled', () => {
    // review of #235: attached to a closed Einsatz, the dispatch's Zeiten and Meldung would land
    // in a closed record; App passes no onAttach then (isIncidentRunning)
    const { order, primary } = labels(true, false)
    expect(order).toEqual([ix.alarmOpen])
    expect(primary).toBe(ix.alarmOpen)
  })
})

// Sweep 09.11.2026, UX.6: «Neuer Einsatz» waited for an EMPTY pool, but the pool keeps every
// untaken alarm for ever – App gates on what this returns instead.
describe('shownAlarms', () => {
  const now = Date.parse('2026-11-09T03:00:00Z')
  const at = (id: number, minutesAgo: number) =>
    ({ ...alarm, divera_id: id, received_at: new Date(now - minutesAgo * 60_000).toISOString() })

  it('leaves out what is hidden on this device and what is older than 3 h', () => {
    const pool = [at(1, 5), at(2, 10), at(3, 181)]
    expect(shownAlarms(pool, new Set([2]), now).map((a) => a.divera_id)).toEqual([1])
  })

  it('is empty for a pool of only stale and hidden alarms', () => {
    expect(shownAlarms([at(2, 10), at(3, 600)], new Set([2]), now)).toEqual([])
  })
})
