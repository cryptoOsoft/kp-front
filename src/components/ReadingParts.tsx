import { useState } from 'react'
import { appConfig } from '../config/appConfig'
import { fillTemplate, formatLocale, formatTime } from '../lib/format'
import { useMinuteClock } from '../lib/minuteClock'
import { Icon } from '../lib/icons'
import { alarmBar, cleanMeasured, compareReadings, measuredInput, measuredValue, readingLevel, readingRows, readingScale, readingState, symbolReading } from '../lib/symbols'
import { ReadingPill } from '../lib/symbolRender'
import type { SymbolProps } from '../types'
import { Button } from './Button'
import { InfoToggle } from './InfoToggle'
import { TickRow } from './TickRow'

// The Messpunkt's additions to the symbol panel (owner picks 27.10.2026): the input box itself is
// the visualisation – a colour bar under each measured field – and the history sits under all
// fields as one list. No numbers on the bar, only the stages: calm, Voralarm (amber), Hauptalarm
// (red); the numbers behind the stages are one ⓘ away (ReadingInfo, 28.10.2026). Since 10.11.2026
// (owner picks 3B / 4A) the box takes a number only, «über Messbereich» is a tick beside it, and
// «Gleich gemessen» under the fields records a Nachmessung that confirmed the values. The ticks
// are bare boxes (owner review 10.11.2026: «just with a tick and not the entire text»): the words
// stand ONCE, as the column's caption above the first gas (ReadingOverHead).

/**
 * One measured gas of the panel (ContextPanel's row for a `readout` field): the number box – digits
 * and one decimal mark, on the decimal keypad with a «Fertig» key; type="text", because a number
 * input refuses the «20,9» a radio report is typed as – the tick «über Messbereich» beside it, and
 * the bar under both. The tick is the box alone, named per gas («CO: über Messbereich» – its
 * aria-label, which the hold-tooltip reads); the column's words are ReadingOverHead. It commits at once and is stored in the value («>100», lib/symbols ·
 * measuredOf): over range draws, sorts and records as the Hauptalarm. A value from before the box
 * took numbers only («ca. 60») stays as written under an amber «Unlesbar – Zahl eingeben» until
 * somebody types over it.
 */
export function MeasuredField({ symbol, fieldKey, value, placeholder, onInput, onCommit }: {
  symbol?: string
  fieldKey: string
  value: string
  placeholder?: string
  /** live edit while typing (no commit) */
  onInput: (v: string) => void
  /** commit – the box's blur, the tick's tap */
  onCommit: (v: string) => void
}) {
  const C = appConfig.copy.contextPanel
  const { text, over } = measuredInput(value)
  const unreadable = readingState(symbol, fieldKey, value) === 'unreadable'
  return (
    <span className="reading-field">
      <span className={`reading-entry${unreadable ? ' unreadable' : ''}`}>
        <input className="kv-val" value={text} placeholder={placeholder} aria-label={fieldKey}
          inputMode="decimal" enterKeyHint="done"
          onChange={(e) => onInput(measuredValue(cleanMeasured(e.target.value), over))}
          onBlur={() => onCommit(value)}
          onKeyDown={(e) => e.key === 'Enter' && e.currentTarget.blur()} />
        <TickRow className="reading-over" checked={over} aria-label={`${fieldKey}: ${C.readingOver}`} title={C.readingOver}
          onToggle={() => onCommit(measuredValue(unreadable ? '' : text, !over))} />
      </span>
      <ReadingBar symbol={symbol} fieldKey={fieldKey} value={value} />
      {unreadable && <span className="reading-unreadable" role="status"><Icon id="warn" />{C.readingUnreadable}</span>}
    </span>
  )
}

/** What the column of bare ticks means, said once: «über Messbereich» above the first measured
 *  field, at the control edge the ticks end on – the way a table header sits above its column.
 *  Read-only text; every tick carries the words in its own name, so this is hidden from a reader. */
export function ReadingOverHead() {
  return <div className="reading-over-head" aria-hidden>{appConfig.copy.contextPanel.readingOver}</div>
}

/** «Gleich gemessen» (pick 4A) under the measured fields: the values as they stand, measured once
 *  more – a history row with the time now, so the point stops ageing. Nothing before a first value.
 *  The app's ordinary secondary button, right-aligned under the value column (owner review
 *  10.11.2026 – it was a full-width block), on a phone too. */
export function ReadingAgain({ entity, onAgain }: { entity: SymbolProps; onAgain: () => void }) {
  if (!symbolReading(entity)?.text) return null
  return (
    <Button className="reading-again" icon={<Icon id="rotate" />} onClick={onAgain}>
      {appConfig.copy.contextPanel.readingAgain}
    </Button>
  )
}

/** Calm / amber / red bar under one measured field, with a tick where the value as typed sits. */
export function ReadingBar({ symbol, fieldKey, value }: { symbol?: string; fieldKey: string; value: string }) {
  const bar = alarmBar(symbol, fieldKey, value)
  if (!bar) return null
  return (
    <span className={`reading-bar${bar.at == null ? ' empty' : ''}`} aria-hidden>
      {bar.zones.map((z) => (
        <i key={z.from} className={z.level === 'ok' ? undefined : z.level} style={{ left: `${z.from * 100}%`, width: `${(z.to - z.from) * 100}%` }} />
      ))}
      {bar.at != null && <b style={{ left: `${bar.at * 100}%` }} />}
    </span>
  )
}

/** One stage's limit as said – «ab 60», «unter 17 oder ab 23». */
function limitText(lim: { atLeast?: number; below?: number }): string {
  const C = appConfig.copy.contextPanel
  const num = (n: number) => n.toLocaleString(formatLocale())
  return [lim.below != null && fillTemplate(C.readingBelow, { n: num(lim.below) }), lim.atLeast != null && fillTemplate(C.readingAtLeast, { n: num(lim.atLeast) })]
    .filter(Boolean).join(` ${C.readingOr} `)
}

/**
 * «What do the values mean?» (owner, sweep 28.10.2026 #2b): the shared ⓘ under the measured fields,
 * folding out each gas with its unit and its A1/A2 limits in the stage colours, what amber and red
 * mean and when a reading counts as old. Built from the preset's `alarm` (readingScale), so a
 * station override reads right. Limits and colours only – what to DO at a stage is station
 * doctrine, which the app does not have. Nothing for a symbol without limits.
 */
export function ReadingInfo({ symbol }: { symbol?: string }) {
  const [open, setOpen] = useState(false)
  const scale = readingScale(symbol)
  if (!scale) return null
  const C = appConfig.copy.contextPanel
  return (
    <div className="ctx-section reading-info">
      <div className="reading-info-head">
        <span className="ctx-section-label">{C.readingInfo}</span>
        <InfoToggle open={open} onToggle={() => setOpen((v) => !v)} label={C.readingInfoLabel} />
      </div>
      {open && (
        <>
          {/* four columns – gas, unit, A1, A2 – the stage codes heading their own column, so a long
              O₂ limit («unter 17 oder ab 23») wraps inside its cell instead of under the row */}
          <ul>
            <li className="head" aria-hidden><span /><span /><span className="a1">A1</span><span className="a2">A2</span></li>
            {scale.gases.map((g) => (
              <li key={g.key}>
                <b>{g.key}</b>
                <span className="unit">{C.readingUnits[g.key] ?? ''}</span>
                <span className="a1">{g.a1 ? limitText(g.a1) : '–'}</span>
                <span className="a2">{g.a2 ? limitText(g.a2) : '–'}</span>
              </li>
            ))}
          </ul>
          <p>{C.readingInfoLevels}</p>
          {scale.staleMin != null && <p>{fillTemplate(C.readingInfoStale, { min: scale.staleMin })}</p>}
        </>
      )}
    </div>
  )
}

/** The readings, newest first, one row per radio report: time, then every gas, red where it is
 *  amber/red where it reached A1/A2. Nothing before the first reading. */
export function ReadingHistory({ entity }: { entity: SymbolProps }) {
  const rows = readingRows(entity)
  if (!rows.length) return null
  return (
    <div className="ctx-section reading-history">
      <span className="ctx-section-label">{appConfig.copy.contextPanel.readingHistory}</span>
      <ol>
        {rows.map((r) => (
          <li key={r.t}>
            <time>{formatTime(new Date(r.t))}</time>
            {Object.entries(r.v).map(([k, v]) => (
              <span key={k} className={readingLevel(entity.symbol, k, v) === 'ok' ? undefined : readingLevel(entity.symbol, k, v)}>{k} {v}</span>
            ))}
          </li>
        ))}
      </ol>
    </div>
  )
}

/**
 * The Gebäude's Messungen (owner pick W2, 27.10.2026): every Messpunkt of the stack listed beside
 * the storey it is on, each storey's rows at that storey's own height – where it is worst reads
 * straight across from the plan, and a number per storey is never needed. Open whenever the stack
 * has a Messpunkt; it lives inside the board, so it pans and zooms with the storeys. Each storey's
 * rows in the one Messpunkt order (compareReadings), worst first; a tap selects the point.
 */
export function StackReadings({ points, floorsTTB, storeyName, boardH, onPick }: {
  /** the measured annos, one per storey they are on (stackFloors · stackInstances) */
  points: (SymbolProps & { id: string; floor?: number })[]
  floorsTTB: number[]
  storeyName: (f: number) => string
  boardH: number
  onPick: (id: string) => void
}) {
  const N = floorsTTB.length || 1
  const room = (p: SymbolProps) => p.fields?.Raum?.trim() || p.label || ''
  // the minute clock the pills age by: a reading turning stale re-sorts its storey
  const now = useMinuteClock()
  return (
    <div className="wb-readings" onPointerDown={(e) => e.stopPropagation()}>
      {floorsTTB.map((f, idx) => {
        const here = points.filter((p) => (p.floor ?? 0) === f)
        if (!here.length) return null
        const alarmFirst = here.map((p) => ({ p, r: symbolReading(p, now) }))
          .sort((a, b) => compareReadings(a.r, b.r)).map(({ p }) => p)
        return (
          <section key={f} style={{ top: (idx / N) * boardH, maxHeight: boardH / N }}>
            <h4>{storeyName(f)}</h4>
            {alarmFirst.map((p) => (
              <button key={p.id} type="button" onClick={() => onPick(p.id)}>
                <span>{room(p)}</span>
                <ReadingPill props={p} inline />
              </button>
            ))}
          </section>
        )
      })}
    </div>
  )
}

