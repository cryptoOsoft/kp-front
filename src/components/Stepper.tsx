import { useState } from 'react'
import { Icon } from '../lib/icons'
import { appConfig } from '../config/appConfig'
import { useHoldRepeat } from '../lib/useHoldRepeat'

/** Keep a typed value numeric while it is being typed — digits plus ONE leading minus, so a
 *  Untergeschoss can be written straight in («-1»). A minus that is out of the field's range is
 *  no special case: `commit` clamps it like any other number. With `decimals` the FIRST '.' or
 *  ',' stays too (Swiss keyboards type both: «5,2» and «5.2» are the same 5.2 bar). */
const numericDraft = (s: string, decimals = 0) => {
  const sign = s.startsWith('-') ? '-' : ''
  const sep = decimals ? s.search(/[.,]/) : -1
  if (sep < 0) return sign + s.replace(/\D/g, '')
  return sign + s.slice(0, sep).replace(/\D/g, '') + s[sep] + s.slice(sep + 1).replace(/\D/g, '')
}

/**
 * The canonical compact ±stepper (global `.step` chrome). Three behaviours, consistent everywhere:
 *  - press-and-HOLD the ±buttons to repeat fast (reach e.g. 40 without 40 taps)
 *  - TAP the value to type an exact number in directly
 *  - the reset ✕ is ALWAYS rendered (no layout shift); it just greys out when there's nothing
 *    to reset (`canClear` false), instead of appearing/disappearing.
 *
 * `value` may be null for OPTIONAL fields (no badge yet): the display shows `placeholder` and the
 * first tap on + seeds `seed ?? min` — on − too when `seedOnDec` is set. `onChange` always
 * receives a concrete clamped number.
 */
export function Stepper({ value, min, max, step = 1, seed, seedOnDec, snap, decimals, format, placeholder = '–', onChange, onClear, canClear, readOnly, over, ariaLabel }: {
  value: number | null
  min: number
  max: number
  step?: number
  /** value to seed when stepping up from an empty (null) optional field; defaults to `min` */
  seed?: number
  /** − on an EMPTY field seeds too, instead of doing nothing. For fields whose `seed` is a neutral
   *  origin one steps down from as readily as up — a Geschoss: the first tap either way lands on
   *  EG (0), and the next − is the first Untergeschoss. Off ⇒ − stays disabled while empty (a
   *  count has nothing below its seed). */
  seedOnDec?: boolean
  /** ± from a value OFF the step grid lands on the grid's next line that way, not on
   *  value ± step (30.09.2026: a symbol turned by hand to −46.5° stepped to −31.5°, −16.5° …
   *  forever off the 15° marks). On the grid it is plain ± step. */
  snap?: boolean
  /** the typed entry takes a decimal number, rounded to this many places (a pressure: 1 →
   *  «5,2» is 5.2 bar). Absent ⇒ whole numbers only, as every counter and storey wants. */
  decimals?: number
  /** format the numeric value for display (e.g. signed floor "+2", "47 m") */
  format?: (v: number) => string
  placeholder?: string
  onChange: (v: number) => void
  /** reset to the default/empty state. Keep wired when the field supports reset and use
   *  `canClear` to disable it when empty; omit only for fields without a reset action. */
  onClear?: () => void
  /** whether a reset would do anything; false ⇒ the ✕ stays visible but greyed/disabled */
  canClear?: boolean
  readOnly?: boolean
  /** flag the value in red — e.g. Mittel usage past the available stock (allowed, but surfaced) */
  over?: boolean
  ariaLabel?: string
}) {
  const clamp = (v: number) => Math.max(min, Math.min(max, v))
  const has = value != null
  const seedVal = clamp(seed ?? min)
  // the grid line below / above `v`; a hair off a line (a stored 45.0000001) counts as ON it
  const line = (v: number, off: (q: number) => number) => {
    const q = v / step
    return Math.abs(q - Math.round(q)) < 1e-6 ? Math.round(q) : off(q)
  }
  const down = (v: number) => (snap ? (line(v, Math.ceil) - 1) * step : v - step)
  const up = (v: number) => (snap ? (line(v, Math.floor) + 1) * step : v + step)
  const dec = useHoldRepeat(() => {
    if (has) onChange(clamp(down(value)))
    else if (seedOnDec) onChange(seedVal)
  })
  const inc = useHoldRepeat(() => onChange(has ? clamp(up(value)) : seedVal))
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState('')

  // a whole number to type over — the field takes whole numbers only (parseInt below), and a stored
  // −46.50917745051447 is not a thing to edit character by character; with `decimals`, the value
  // to that many places
  const startEdit = () => {
    if (readOnly) return
    setDraft(has ? (decimals ? value.toFixed(decimals) : String(Math.round(value))) : '')
    setEditing(true)
  }
  const commit = () => {
    setEditing(false)
    if (!decimals) {
      const n = parseInt(draft, 10)
      if (!Number.isNaN(n)) onChange(clamp(n))
      return
    }
    const n = parseFloat(draft.replace(',', '.'))
    const f = 10 ** decimals
    if (!Number.isNaN(n)) onChange(clamp(Math.round(n * f) / f))
  }
  const display = has ? (format ? format(value) : String(value)) : placeholder
  const st = appConfig.copy.stepper

  return (
    <span className="step" role="group" aria-label={ariaLabel}>
      <button className="step-btn" disabled={readOnly || (has ? value <= min : !seedOnDec)} {...dec} aria-label={st.less}>−</button>
      {editing ? (
        <input
          className="step-val step-input" autoFocus value={draft} inputMode={decimals ? 'decimal' : 'numeric'} type="text" aria-label={ariaLabel}
          onFocus={(e) => e.currentTarget.select()}
          onChange={(e) => setDraft(numericDraft(e.target.value, decimals))} onBlur={commit}
          onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); else if (e.key === 'Escape') setEditing(false) }}
        />
      ) : (
        <button className={`step-val step-val-btn${over ? ' step-over' : ''}${has ? '' : ' step-empty'}`} onClick={startEdit} disabled={readOnly} title={st.typeToEnter}>{display}</button>
      )}
      <button className="step-btn" disabled={readOnly || (has && value >= max)} {...inc} aria-label={st.more}>+</button>
      {onClear && (
        <button className="step-clear" disabled={readOnly || !canClear} onClick={onClear} aria-label={st.reset}><Icon id="close" /></button>
      )}
    </span>
  )
}

/**
 * The same ±stepper for a value that has no absolute number to step to: a Form's size is a
 * ×-FACTOR on both surfaces, because the two of them do not measure it in the same unit — the
 * Karte stores metres on the ground, a Plan a share of the sheet's width, and a mirrored Form
 * writes whichever its source document keeps (ShapeEditor · onScale/onScaleLength). So the
 * caller is handed a factor and does its own clamping, and this face carries no editable value.
 * Everything else is the canonical stepper: the same `.step` chrome, and press-and-hold to
 * repeat rather than tapping a shape up a size at a time.
 */
export function ScaleStepper({ onScale, factor = 1.25, lessLabel, moreLabel, ariaLabel }: {
  /** called with the factor to scale by — >1 on +, its reciprocal on − */
  onScale: (factor: number) => void
  /** how big one step is; 1.25 = ±25 %, the step the corner handle's fixed alternative has used */
  factor?: number
  lessLabel: string
  moreLabel: string
  ariaLabel?: string
}) {
  const dec = useHoldRepeat(() => onScale(1 / factor))
  const inc = useHoldRepeat(() => onScale(factor))
  return (
    <span className="step" role="group" aria-label={ariaLabel}>
      <button className="step-btn" {...dec} aria-label={lessLabel}>−</button>
      <button className="step-btn" {...inc} aria-label={moreLabel}>+</button>
    </span>
  )
}
