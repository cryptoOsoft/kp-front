// 24h wheel picker — the app's own time/date entry (decided 2026-07-14): native pickers
// render AM/PM on English-language devices and can't be themed, so this popover gives the
// iOS-style scroll wheels with a GUARANTEED 24h clock on every device. Columns are
// scroll-snap lists (hour/minute, plus a bounded day column when more than one day is on offer —
// the ONE date control, 05.10.2026: no day/month/year wheels anywhere); the value is whatever rests
// under the center band. «Jetzt» is the fast path (stamp current clock and close), «OK»
// commits a scrolled selection. Portalled to <body> so no card/accordion can clip it.

import { useEffect, useId, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { appConfig } from '../config/appConfig'
import { hhmm, pad2 } from '../lib/format'
import { fmtWheelDay } from '../lib/zeitplanFormat'
import { scrollBehavior } from '../lib/reducedMotion'
import { pointAtField } from '../lib/pointAtField'
import w from './WheelPicker.module.css'
import { usePopoverGuard } from '../lib/overlays/popoverGuard'

const ITEM_H = 44 // px, one wheel row — a full ≥44px tap target; must match .wheel-item/.wheel-pad/.wheelpop-band in app.css

/**
 * How many copies of the list a LOOPING wheel holds, and which one the finger is kept in.
 *
 * A clock has no first and no last minute, and the wheels behaved as if it did: at 23:59 the
 * only way to 00:05 was to drag the whole column back down through twenty-three hours. Seven
 * bands is what makes the loop invisible — the middle one leaves three bands of runway in each
 * direction (hours ≈ 3100px, minutes ≈ 7900px), which is further than a hard fling carries, so
 * the silent re-centre almost always happens while the wheel is already still.
 */
const LOOPS = 7
const MID_BAND = 3

function Wheel({ items, index, onIndex, ariaLabel, loop = false, day = false }: {
  items: string[]
  index: number
  onIndex: (i: number) => void
  ariaLabel: string
  /** wrap around — for the values that genuinely have no ends (hour, minute). A bounded list
   *  (the incident's days, a month, a year) must NOT loop: running off the end of those means
   *  the value does not exist, and a wheel that silently returns to January says it does. */
  loop?: boolean
  /** the day column: wider than hour/minute and never wrapping (see fmtWheelDay) */
  day?: boolean
}) {
  const ref = useRef<HTMLDivElement>(null)
  const settle = useRef(0)
  const n = items.length
  // the same list, several times over — identical content, so a jump between copies is invisible
  const rows = loop ? Array.from({ length: n * LOOPS }, (_, i) => items[i % n]) : items
  const base = loop ? MID_BAND * n : 0
  const top = (i: number) => (base + i) * ITEM_H

  // position on mount / external change (e.g. «Jetzt») without fighting the user's scroll
  useEffect(() => {
    const el = ref.current
    if (!el) return
    const at = Math.round(el.scrollTop / ITEM_H)
    if (!loop) { if (at !== index) el.scrollTop = index * ITEM_H; return }
    // already showing this value in SOME band → leave it alone, or every settle would yank the
    // column back to the middle under the finger
    if (((at % n) + n) % n !== index) el.scrollTop = top(index)
  }, [index, loop, n]) // eslint-disable-line react-hooks/exhaustive-deps -- `top` is derived from these

  const onScroll = () => {
    window.clearTimeout(settle.current)
    settle.current = window.setTimeout(() => {
      const el = ref.current
      if (!el) return
      const at = Math.round(el.scrollTop / ITEM_H)
      const i = loop ? ((at % n) + n) % n : Math.max(0, Math.min(n - 1, at))
      const target = loop ? top(i) : i * ITEM_H
      // The strip snaps with `scroll-snap-type: y PROXIMITY`, not `mandatory` (see
      // [data-scroll-physics] in the module CSS) — mandatory forces a hard stop at every 44px row
      // mid-fling, which is what made a real flick feel notchy/stiff instead of sailing through
      // several rows the way the native iOS wheel does.
      // Proximity gives up that guarantee, so this settle is what lands the row exactly once the
      // finger (and the browser's own momentum) has actually stopped — `scrollBehavior()` skips the
      // animated correction under reduced motion. Looping still hops the band edge instantly (see
      // LOOPS above): animating THAT jump would visibly scroll backwards through the whole list.
      if (loop && (at < n || at >= (LOOPS - 1) * n)) el.scrollTop = target
      else if (Math.round(el.scrollTop) !== target) el.scrollTo({ top: target, behavior: scrollBehavior() })
      if (i !== index) onIndex(i)
    }, 90)
  }
  return (
    <div className={`wheel${day ? ' wheel-day' : ''}`} data-scroll-physics ref={ref} onScroll={onScroll} role="listbox" aria-label={ariaLabel} tabIndex={0}>
      <div className="wheel-pad" aria-hidden />
      {rows.map((it, i) => {
        const value = loop ? i % n : i
        // ⚠️ the selected ROW, not every row holding the selected value: with seven copies on
        // the strip, marking them all would put `.on` on seven rows and read out seven
        // «selected» options. The one in the middle band is the one the picker commits.
        const on = value === index && (!loop || Math.floor(i / n) === MID_BAND)
        return (
          <button
            key={i} type="button" role="option" aria-selected={on}
            className={`wheel-item${on ? ' on' : ''}`}
            onClick={() => { onIndex(value); const el = ref.current; if (el) el.scrollTo({ top: i * ITEM_H, behavior: scrollBehavior() }) }}
          >{it}</button>
        )
      })}
      <div className="wheel-pad" aria-hidden />
    </div>
  )
}

const HOURS = Array.from({ length: 24 }, (_, i) => pad2(i))
const MINUTES = Array.from({ length: 60 }, (_, i) => pad2(i))

export interface WheelValue { y: number; mo: number; d: number; h: number; mi: number }

const isCoarse = () =>
  typeof window !== 'undefined' && window.matchMedia('(pointer: coarse)').matches

/** '930', '9:30', '09.30' → [h, mi]; null while it is still being typed or out of range. */
function parseTyped(raw: string): [number, number] | null {
  const t = raw.trim().replace(/[.\s]/g, ':')
  const m = /^(\d{1,2}):?(\d{2})$/.exec(t)
  if (!m) return null
  const h = Number(m[1])
  const mi = Number(m[2])
  return h <= 23 && mi <= 59 ? [h, mi] : null
}

/** The popover itself. A day column appears when `days` holds more than one day (`dayAlways`: one). */
export function WheelPopover({ anchor, initial, onCommit, onClose, onClear, shortcut, clearLabel, clearActive, days, dayAlways = false, title, note, noNow }: {
  anchor: DOMRect
  initial: Date
  onCommit: (v: WheelValue) => void
  onClose: () => void
  /** offered as «Leeren» when set (clears the underlying value) */
  onClear?: () => void
  /** A one-tap answer above the wheels — «ab Einsatzbeginn 07:29». It belongs here rather than
   *  beside the field because it answers the question the picker asks. */
  shortcut?: { label: string; value?: string; tone?: 'blue' | 'green'; active?: boolean; onPick: () => void }
  /** names the clear action instead of showing a bin — «noch da», which is what emptying a «bis»
   *  actually means. A bin glyph said «destroy» for an action that records presence. */
  clearLabel?: string
  /** the «noch da» tab is the CURRENT state — drawn as pressed, so the field says what it is even
   *  while the wheels are being scrolled past it */
  clearActive?: boolean
  /**
   * The days this value may fall on — the incident's own days, NOT a date picker.
   *
   * Times carry HH:MM only, and which day was meant used to be inferred from the old stamp. That
   * holds for one night and breaks past it: on a multi-day Einsatz there was no way to say «this
   * stretch belongs to the Wednesday» at all. A bounded wheel says it in one gesture and needs no
   * month or year — an incident touches a handful of days, and they are all known. Omitted or
   * single-day: no wheel appears, so the everyday case pays nothing.
   */
  days?: Date[]
  /** show the day column for a SINGLE day too: the Rapport's Einsatzende, whose wheel then says
   *  which date it sets instead of assuming today unseen (owner, EL phone sweep C10, 10.11.2026) */
  dayAlways?: boolean
  /** a heading over the wheels, for a popover opened from a menu row rather than from a field
   *  that already says what it holds — «Erinnern um» */
  title?: string
  /**
   * One line under the wheels saying what the current selection MEANS — «Morgen · Fr 09.10. ·
   * 07:30» — recomputed as the wheels move. `blocks` turns it red and disables «OK»: the value
   * exists on the wheels but is not an answer to this question (a Wiedervorlage in the past).
   * ⚠️ Disabled, never silently corrected: rolling a past time to tomorrow is the rule the
   * reminder dialog dropped on purpose (JournalComposer · DueSel).
   */
  note?: (v: WheelValue) => { text: string; blocks?: boolean } | null
  /** no «Jetzt»: for a time that has to lie AHEAD, «now» is never the answer */
  noNow?: boolean
}) {
  usePopoverGuard(true)
  const errorId = useId()
  const [invalid, setInvalid] = useState(false)
  const C = appConfig.copy.wheel
  const coarse = isCoarse()
  const [v, setV] = useState<WheelValue>({
    y: initial.getFullYear(), mo: initial.getMonth() + 1, d: initial.getDate(),
    h: initial.getHours(), mi: initial.getMinutes(),
  })
  // the incident's days, de-duplicated to midnight so «same day» is a stable key
  const dayList = useMemo(() => {
    const seen = new Map<number, Date>()
    for (const d of days ?? []) {
      const k = new Date(d.getFullYear(), d.getMonth(), d.getDate())
      if (Number.isFinite(k.getTime())) seen.set(k.getTime(), k)
    }
    return [...seen.values()].sort((a, b) => a.getTime() - b.getTime())
  }, [days])
  const dayShown = dayList.length > (dayAlways ? 0 : 1)
  const dayIndex = dayList.findIndex((d) =>
    d.getFullYear() === v.y && d.getMonth() + 1 === v.mo && d.getDate() === v.d)

  // what the keyboard is holding right now; the wheels follow as soon as it parses
  const [typed, setTyped] = useState(() => hhmm(initial))

  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    // An outside tap may ONLY dismiss the wheel — it must never also activate what sits
    // underneath (e.g. the capture view's status button flipping someone to «gegangen»
    // while they just wanted to finish the time entry, feedback 2026-07-18). Capture-phase
    // pointerdown swallows the gesture and a one-shot click-capture eats the synthesized
    // click that follows.
    const onDoc = (e: PointerEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        e.preventDefault()
        e.stopPropagation()
        const swallow = (ce: Event) => { ce.stopPropagation(); ce.preventDefault() }
        document.addEventListener('click', swallow, { capture: true, once: true })
        window.setTimeout(() => document.removeEventListener('click', swallow, { capture: true }), 400)
        onClose()
      }
    }
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); onClose() } }
    document.addEventListener('pointerdown', onDoc, true)
    window.addEventListener('keydown', onKey, true)
    return () => { document.removeEventListener('pointerdown', onDoc, true); window.removeEventListener('keydown', onKey, true) }
  }, [onClose])

  const said = note?.(v) ?? null
  const blocked = !!said?.blocks
  const noteRef = useRef<HTMLParagraphElement>(null)

  const commit = () => {
    if (!coarse) {
      const time = parseTyped(typed)
      if (!time) { setInvalid(true); return }
      const out = { ...v, h: time[0], mi: time[1] }
      // Enter reaches here without the button — the note's veto holds for it too
      if (note?.(out)?.blocks) { pointAtField(noteRef.current); return }
      onCommit(out)
    } else if (!blocked) onCommit(v)
    // a blocked «OK» stays tappable and rings the note that says why (lib/pointAtField)
    else pointAtField(noteRef.current)
  }

  const stampNow = () => {
    const n = new Date()
    onCommit({ y: n.getFullYear(), mo: n.getMonth() + 1, d: n.getDate(), h: n.getHours(), mi: n.getMinutes() })
  }

  // Below the anchor when there's room, else above — and then CLAMPED into the viewport either
  // way. The old estimate was a flat 300px and only chose a side; once the shortcut row was added
  // the popover grew past it, so «OK» ended up under the bottom edge of the screen with no way to
  // reach it. Measured: 9px padding ×2 + 5×44px of wheel + 40px actions + its 8px gap, plus the
  // shortcut row when there is one.
  const height = 18 + (title ? 30 : 0) + (coarse ? 220 : 52) + 48 + (shortcut || (onClear && clearLabel) ? 52 : 0)
    + (note ? 30 : 0) + (invalid ? 56 : 0)
  const up = window.innerHeight - anchor.bottom < height + 16
  // Leave room for all three footer actions, including longer translations such as «Maintenant».
  // A shortcut or a named state choice needs its sentence on one line; bare wheels do not.
  // The day column is the widest label in the popover («Mo 05.10.», «lun 05.10.») and gets the
  // room; hour and minute are two digits and keep a full-width 44px row each regardless.
  const dayWheel = dayShown ? 104 : 0
  const width = Math.min(window.innerWidth - 16,
    (onClear && !clearLabel ? 264 : shortcut || clearLabel ? 236 : 196) + dayWheel)
  const left = Math.max(8, Math.min(anchor.left, window.innerWidth - width - 8))
  // Always positioned by `top`, so one clamp covers both directions: a popover that would hang off
  // either edge slides back in rather than putting its actions out of reach.
  const wanted = up ? anchor.top - 6 - height : anchor.bottom + 6
  const top = Math.max(8, Math.min(wanted, window.innerHeight - height - 8))
  const style: React.CSSProperties = { position: 'fixed', left, width, top }

  // ⚠️ `role="dialog"` WITHOUT `aria-modal`. It claimed to be modal until 27.08. and never was:
  // there is no backdrop, no focus trap and no focus restore, so Tab walks straight out into the
  // page behind while a screen reader is told the rest of it is inert. It is a popover — an
  // outside tap and Esc close it (see the effect above) — and that is the honest contract.
  // Making it a real modal would mean routing it through overlays/Popover, which does not do the
  // outside-tap swallow this one needs.
  return createPortal(
    <div className="wheelpop" style={style} ref={ref} role="dialog" aria-label={title}>
      {title && <h3 className={w.title}>{title}</h3>}
      {/* KEYBOARD ENTRY, wherever there is a keyboard. The wheels used to be replaced wholesale by
          a bare text input on a fine pointer — which is why every feature added to this popover
          (day wheel, ab Start, noch da) simply did not exist at a desk. Now the popover is the one
          surface everywhere, and typing is an extra way INTO it rather than a second version of
          it. Partial input stays local until it parses, so «1» on the way to «14» is not rejected. */}

      {/* THE TABS: answers that are not a clock reading. «ab Start» and «noch da» replace the time
          rather than set one, so they stand apart from the wheels and from OK. */}
      {(shortcut || (onClear && clearLabel)) && (
        <div className={w.tabs}>
          {shortcut && (
            <button type="button" aria-pressed={!!shortcut.active}
              className={`${w.tab}${shortcut.tone === 'green' ? ` ${w.green}` : ''}${shortcut.active ? ` ${w.tabOn}` : ''}`}
              onClick={shortcut.onPick}>
              {shortcut.label}
              {shortcut.value && <span className={w.value}>{shortcut.value}</span>}
            </button>
          )}
          {onClear && clearLabel && (
            <button type="button" aria-pressed={!!clearActive}
              className={`${w.tab}${clearLabel ? ` ${w.green}` : ''}${clearActive ? ` ${w.tabOn}` : ''}`}
              onClick={onClear}>{clearLabel}</button>
          )}
        </div>
      )}
      <div className="wheelpop-cols">
        {dayShown && coarse && (
          <Wheel day ariaLabel={C.day} items={dayList.map(fmtWheelDay)} index={Math.max(0, dayIndex)}
            onIndex={(i) => {
              const d = dayList[i]
              if (d) setV((p) => ({ ...p, y: d.getFullYear(), mo: d.getMonth() + 1, d: d.getDate() }))
            }} />
        )}
        {/* ONE input, not two. A keyboard gets a field and a day list; a finger gets the wheels.
            Showing both at once meant the same value had two controls sitting on top of each
            other, and it was never clear which one the popover would actually commit. */}
        {coarse ? (
          <>
            {/* the two that loop: a clock has no first and no last minute, so 23:59 → 00:05 is
                one flick down rather than a drag back through the whole day */}
            <Wheel loop ariaLabel={C.hour} items={HOURS} index={v.h} onIndex={(i) => setV((p) => ({ ...p, h: i }))} />
            <Wheel loop ariaLabel={C.minute} items={MINUTES} index={v.mi} onIndex={(i) => setV((p) => ({ ...p, mi: i }))} />
            <div className="wheelpop-band" aria-hidden />
          </>
        ) : (
          <div className={w.typedRow}>
            <input
              className={w.typed} value={typed} inputMode="numeric" enterKeyHint="done" autoFocus
              aria-label={`${C.hour} / ${C.minute}`} placeholder="--:--"
              aria-invalid={invalid || undefined} aria-describedby={invalid ? errorId : undefined}
              onChange={(e) => {
                setTyped(e.target.value)
                setInvalid(false)
                const hhmm = parseTyped(e.target.value)
                if (hhmm) setV((p) => ({ ...p, h: hhmm[0], mi: hhmm[1] }))
              }}
              onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); commit() } }}
            />
            {dayShown && (
              <select className={w.daySel} aria-label={C.day} value={Math.max(0, dayIndex)}
                onChange={(e) => {
                  const d = dayList[Number(e.target.value)]
                  if (d) setV((p) => ({ ...p, y: d.getFullYear(), mo: d.getMonth() + 1, d: d.getDate() }))
                }}>
                {dayList.map((d, i) => <option key={i} value={i}>{fmtWheelDay(d)}</option>)}
              </select>
            )}
          </div>
        )}
      </div>
      {said && <p ref={noteRef} className={`${w.note}${blocked ? ` ${w.noteBad}` : ''}`} aria-live="polite">{said.text}</p>}
      {invalid && <p id={errorId} className={w.error} role="alert">{C.invalidTime}</p>}
      <div className="wheelpop-actions">
        {onClear && !clearLabel && (
          <button type="button" className="wheelpop-btn" onClick={onClear}>{appConfig.copy.clear}</button>
        )}
        {!noNow && <button type="button" className="wheelpop-btn" onClick={stampNow}>{C.now}</button>}
        <button type="button" className="wheelpop-btn primary" aria-disabled={blocked} onClick={commit}>{C.ok}</button>
      </div>
    </div>,
    document.body,
  )
}
