// 24h time / date-time entry. ONE way in on every device: the trigger opens the WheelPicker
// popover, which offers the wheels for a finger AND a text field for a keyboard, side by side.
// The split by pointer type it replaced (wheels on touch, a bare text box on the desktop) meant
// every choice added to the popover — the day wheel, «ab Start», «noch da» — was unreachable
// with a mouse. Always 24h regardless of OS language: a native picker renders AM/PM on an
// English device, which is why none is used.

/*
 * - Time popovers join the shared dismissal guard: one Escape closes only the picker. Invalid
 *   typed times stay open with an error; optional values expose «Leeren» left of «Jetzt» and «OK»
 *   in the action row. Named state choices such as «noch da» stay above the wheels. Hold-repeat
 *   buttons support click-only assistive activation without doubling pointer taps.
 * - ONE time picker: every clock entry is `TimeField`/`WheelPopover` – no per-surface ± time
 *   stepper. The Verlauf composer's «Uhrzeit …» (Wiedervorlage) opens `WheelPopover` straight off
 *   the clock button (`title`, a day column of today + 6 days, `noNow`, and a `note` that shows the
 *   resolved «Morgen · Fr 09.10. · 07:30» and BLOCKS «OK» on a past instant – never rolled to
 *   tomorrow). The imported memo's «Aufnahme begann» is a `required` `TimeField`.
 * - ONE date+time control: `DateTimeField` (`components/TimeField`, ISO in/out). The date is a
 *   bounded day column («Mo 05.10.», `lib/zeitplanFormat · fmtWheelDay`) from `days` – the incident's (`incidentDays`)
 *   or by default the last 60 days – never day/month/year wheels and never a native
 *   `datetime-local`. A bare clock with an optional day column is `TimeField` (+`days`/`valueDay`).
 */

import { useRef, useState } from 'react'
import { WheelPopover, type WheelValue } from './WheelPicker'
import { hhmm, pad2 } from '../lib/format'
import { dayRange, RECENT_DAYS } from '../lib/zeitplanFormat'

export function TimeField({ value, valueDay, onCommit, disabled, ariaLabel, nowLabel, className, shortcut, clearLabel, clearActive, days, placeholder, token, required }: {
  /** current value as 'HH:MM' ('' = unset) */
  value: string
  /**
   * The calendar day `value` actually sits on — what the day wheel opens on.
   *
   * ⚠️ Only matters together with `days`, and then it matters a great deal: the picker used to
   * seed itself from `new Date()` and copy only the clock off `value`, so the day wheel opened
   * on TODAY whatever day the stamp was on. Because the popover hands a day back on every
   * commit once the incident spans more than one (see onCommit below), correcting 22:15 → 22:10
   * on Wednesday morning moved a Monday-night arrival to Wednesday — a silent two-day jump on a
   * field nobody re-reads. Omit it and nothing changes: the picker still opens on today, which
   * is right for an empty field.
   */
  valueDay?: Date
  /** 'HH:MM' from wheels/typing/«Jetzt»; null when cleared. `day` comes back only when the picker
   *  offered a day wheel and the operator moved it — the caller then knows the calendar day for
   *  certain and does not have to infer it from the old stamp. */
  onCommit: (hhmm: string | null, day?: Date) => void
  disabled?: boolean
  ariaLabel: string
  /** render an inline «Jetzt» button with this label (fast path) */
  nowLabel?: string
  className?: string
  /** a one-tap answer offered inside the picker — «ab Einsatzbeginn 07:29» */
  shortcut?: { label: string; value?: string; tone?: 'blue' | 'green'; active?: boolean; onPick: () => void }
  /** names the clear action in the picker instead of the bin glyph — «noch da» */
  clearLabel?: string
  /** «noch da» is the current state — the tab stays, drawn as pressed */
  clearActive?: boolean
  /** the incident's own days — a bounded day wheel, shown only when the incident spans more than
   *  one. On a single-day incident nothing changes. */
  days?: Date[]
  /** what an EMPTY field reads instead of «--:--» — «noch da» for a stretch that has not ended.
   *  It stays a real field, so the end can be set from here; it was a plain <em> before, which
   *  looked like a value and could not be tapped. */
  placeholder?: string
  /** Shown INSTEAD of the clock, because the value is not really a clock reading: «ab Start» for a
   *  beginning tied to the alarm, «noch da» for an end that has not happened. The instant behind
   *  it is still stored in full (date included) — this is how it reads, not what it is. */
  token?: { label: string; tone: 'start' | 'open' }
  /** a value that is always there (an imported memo's recording start): no «Leeren» */
  required?: boolean
}) {
  const [open, setOpen] = useState(false)
  const btnRef = useRef<HTMLButtonElement>(null)

  const initial = (() => {
    const m = /^(\d{2}):(\d{2})$/.exec(value)
    const d = valueDay && Number.isFinite(valueDay.getTime()) ? new Date(valueDay) : new Date()
    if (m) d.setHours(Number(m[1]), Number(m[2]), 0, 0)
    return d
  })()
  const stampNow = () => {
    const d = new Date()
    // …carrying the DAY wherever a day wheel is on offer. Without it the caller has to infer the
    // day from a neighbouring stamp, and every such rule can only reach one day either side: on
    // an Einsatz that has been running since Monday, «Jetzt» pressed on Wednesday was filed on
    // Tuesday. Callers that pass no `days` are untouched — the day stays undefined for them.
    onCommit(hhmm(d), days && days.length > 1 ? d : undefined)
  }

  return (
    <span className={`timefield${className ? ` ${className}` : ''}`}>
      {/* ONE way in, on every device. The desktop used to get a bare text input instead of this,
          which is why the day wheel, «ab Start» and «noch da» were unreachable with a mouse —
          three rounds of fixes landed in a branch half the users never saw. Typing did not go
          away: it moved INSIDE the popover, where it sits beside those same choices. */}
      <button
        type="button" ref={btnRef}
        className={`timefield-trigger${value || token ? '' : ' empty'}${token ? ` tok-${token.tone}` : ''}`}
        disabled={disabled} aria-label={token ? `${ariaLabel}: ${token.label}` : ariaLabel}
        onClick={() => setOpen(true)}
      >
        {token ? token.label : (value || placeholder || '--:--')}
      </button>
      {nowLabel && (
        <button type="button" className="timefield-now" disabled={disabled} onClick={stampNow}>{nowLabel}</button>
      )}
      {open && btnRef.current && (
        <WheelPopover
          anchor={btnRef.current.getBoundingClientRect()}
          initial={initial}
          onClose={() => setOpen(false)}
          onCommit={(v: WheelValue) => {
            setOpen(false)
            onCommit(`${pad2(v.h)}:${pad2(v.mi)}`,
              days && days.length > 1 ? new Date(v.y, v.mo - 1, v.d) : undefined)
          }}
          days={days}
          // a named clear is offered even on an empty field: «noch da» is a state to SET, not a
          // value to erase, so it must not vanish once the field is already empty
          onClear={!required && (value || clearLabel) ? () => { setOpen(false); onCommit(null) } : undefined}
          clearLabel={clearLabel}
          clearActive={clearActive}
          shortcut={shortcut && { ...shortcut, onPick: () => { setOpen(false); shortcut.onPick() } }}
        />
      )}
    </span>
  )
}

/**
 * Date + time — THE date-time control (05.10.2026). Same popover as TimeField: a bounded day
 * column («Mo 05.10.») beside the hour/minute wheels, «Jetzt» and «OK». Emits ISO.
 *
 * It used to open day/month/year wheels instead, so the Rapport asked for the same Einsatzende
 * as «TT · MM · JJJJ» on one screen and as «Mo 05.10.» on the phone's capture view (owner,
 * 05.10.2026: «some input fields use full ymd input while others use preselected days»).
 *
 * `days` = the days on offer, normally the incident's own (`incidentDays`). Omitted: the last
 * RECENT_DAYS days up to today. The value's own day is always added, so a stamp outside the list
 * still opens on itself instead of silently moving. With a single day no column shows — the
 * trigger still reads the full date.
 */
export function DateTimeField({ value, onCommit, disabled, ariaLabel, className, days, dayAlways, required }: {
  /** ISO datetime ('' /undefined = unset) */
  value?: string
  onCommit: (iso: string | null) => void
  disabled?: boolean
  ariaLabel: string
  className?: string
  /** the selectable days (see above); default: the last RECENT_DAYS days through today */
  days?: Date[]
  /** the day column shows for a single day too (WheelPicker · dayAlways) */
  dayAlways?: boolean
  /** a value that must always be there (a visit's «Besucht am»): the picker offers no «Leeren» */
  required?: boolean
}) {
  const [open, setOpen] = useState(false)
  const btnRef = useRef<HTMLButtonElement>(null)
  const d = value ? new Date(value) : null
  const valid = d && Number.isFinite(d.getTime())
  const display = valid
    ? `${pad2(d.getDate())}.${pad2(d.getMonth() + 1)}.${d.getFullYear()} ${hhmm(d)}`
    : ''
  const offered = () => {
    const now = new Date()
    const base = days && days.length ? days : dayRange(new Date(now.getFullYear(), now.getMonth(), now.getDate() - (RECENT_DAYS - 1)), now)
    // the day the wheels open on is always in the list — else the column shows one day and OK
    // commits another. WheelPopover de-duplicates and sorts.
    return [...base, valid ? d : now]
  }

  return (
    <span className={`timefield${className ? ` ${className}` : ''}`}>
      <button
        type="button" ref={btnRef} className={`timefield-trigger dt${valid ? '' : ' empty'}`}
        disabled={disabled} aria-label={ariaLabel} onClick={() => setOpen(true)}
      >
        {display || '--.--.---- --:--'}
      </button>
      {open && btnRef.current && (
        <WheelPopover
          anchor={btnRef.current.getBoundingClientRect()}
          initial={valid ? d : new Date()}
          days={offered()} dayAlways={dayAlways}
          onClose={() => setOpen(false)}
          onCommit={(v: WheelValue) => {
            setOpen(false)
            onCommit(new Date(v.y, v.mo - 1, v.d, v.h, v.mi, 0, 0).toISOString())
          }}
          onClear={valid && !required ? () => { setOpen(false); onCommit(null) } : undefined}
        />
      )}
    </span>
  )
}
