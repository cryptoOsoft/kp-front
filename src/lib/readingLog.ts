/*
 * **Every reading of a Messpunkt is a Verlauf row** (owner pick 2A, 10.11.2026, `lib/readingLog`).
 * Until then a gas value lived only in the symbol's props: the Verlauf of the Plan said nothing,
 * the Karte's edit row said «Messpunkt: CO: 180» without a stage, and the Rapport printed neither.
 * `readingAct` is THE act for both surfaces (MapDetailPanels · the Karte's panel, Whiteboard · the
 * plan's): the history with its new row and the sentence for it – the point, its storey, the gases
 * this commit changed with their unit and stage, a crossing of A1/A2 worded as one («A2 Hauptalarm
 * erreicht», «wieder im Normalbereich»). The caller writes the props as ONE undoable step named by
 * that sentence and logs the row; the ↶ then writes «… rückgängig gemacht» like every act
 * (docs/undo.md). The Karte's settle row leaves the measured fields to this one (`entityEdit`).
 * ⚠️ On paper these rows are NOT part of the Einsatzjournal (owner: «in the pdf just in the
 * separate table»): `report · journalRows` drops them by `isReadingRow`, and the Rapport's
 * «Messungen» section prints the readings themselves (`readingsForReport`).
 */

import { appConfig } from '../config/appConfig'
import { fillTemplate, formatLocale, formatTime } from './format'
import { doneName, donePlace } from './objectDone'
import { compareReadings, isMeasuredSymbol, measuredOf, readingRows, readingScale, readingState, recordReading, stateLevel, symbolReading, worstGas, type ReadingState } from './symbols'
import { GEBAEUDE_PLAN_ID } from './whiteboard'
import type { BoardDoc, Entity, Reading, SymbolProps, TimelineEvent } from '../types'

/** The icon every reading row wears – the Messgerät of the pill (lib/icons). Also how a row is
 *  recognised as one, whatever language it was written in (`isReadingRow`). */
export const READING_ICON = 'messgeraet'

const unitOf = (key: string): string => appConfig.copy.contextPanel.readingUnits[key] ?? ''

/** «180 ppm», «>100 ppm» – a value with its gas's unit. What holds no number stays as written:
 *  an unreadable value, and the bare «>» of an over-range tick without one. */
export function readingValueText(key: string, value: string): string {
  const m = measuredOf(value)
  const unit = unitOf(key)
  return unit && (m.kind === 'number' || (m.kind === 'over' && m.n != null)) ? `${value.trim()} ${unit}` : value.trim()
}

/** What a row says about one gas beyond its value: its stage, and whether this reading crossed
 *  into or out of it. `prev` is the gas's value in the reading before (undefined = first). */
function stageText(symbol: string | undefined, key: string, value: string, prev: string | undefined): string {
  const C = appConfig.copy.readingLog
  const state = readingState(symbol, key, value)
  const level = stateLevel(state)
  const before = prev == null ? 'ok' : stateLevel(readingState(symbol, key, prev))
  if (state === 'unreadable') return C.state.unreadable
  if (level === 'ok') return before === 'ok' ? '' : C.calmAgain
  const stage = C.state[level]
  const crossed = level === before ? stage : fillTemplate(before === 'a2' ? C.backTo : C.reached, { stage })
  return state === 'over' ? `${C.state.over}, ${crossed}` : crossed
}

/** «Keller Heizraum (UG)» – the room the Trupp reported (else the symbol's name) and its storey. */
export function readingPointName(props: Pick<SymbolProps, 'label' | 'symbol' | 'fields'>, place: string): string {
  const name = props.fields?.Raum?.trim() || doneName(props)
  return place ? `${name} (${place})` : name
}

/**
 * THE act: `fields` committed on a measured symbol at `now`. Null when no reading comes of it
 * (not a measured symbol, no measured value changed and not `again`). `again` = «Gleich gemessen»
 * (pick 4A): the values as they stand, measured once more – its row lists every gas and says so.
 * `place` is the storey as the surface means it (objectDone · donePlace).
 */
export function readingAct(
  props: SymbolProps, fields: Record<string, string>,
  opts: { now: number; place: string; again?: boolean },
): { readings: Reading[]; text: string } | null {
  const readings = recordReading(props, fields, opts.now, opts.again)
  if (!readings || readings === props.readings) return null
  const C = appConfig.copy.readingLog
  const v = readings[readings.length - 1].v
  const last = props.readings?.[props.readings.length - 1]?.v
  // a field commit names the gases it changed – one radio report typed gas by gas is three short
  // rows, never the same values three times; a gas emptied again reads «CO –»
  const keys = opts.again ? Object.keys(v) : [...new Set([...Object.keys(v), ...Object.keys(last ?? {})])].filter((k) => v[k] !== last?.[k])
  const values = keys.map((k) => {
    if (v[k] == null) return `${k} –`
    const stage = stageText(props.symbol, k, v[k], last?.[k])
    return `${k} ${readingValueText(k, v[k])}${stage ? ` – ${stage}` : ''}`
  }).join(' · ')
  const name = readingPointName({ ...props, fields }, opts.place)
  return { readings, text: fillTemplate(opts.again ? C.rowAgain : C.row, { name, values }) }
}

/** Is this Verlauf row a reading's, or the ↶ / ↷ of one? A reading by its icon – never by its
 *  words: «Messung im Keller angeordnet» is somebody's own entry. The counter-row carries the
 *  act's sentence but not its icon, so a `history` row is matched by the sentence's lead-in. */
export function isReadingRow(e: Pick<TimelineEvent, 'icon' | 'text' | 'kind'>): boolean {
  if (e.icon === READING_ICON) return true
  const lead = appConfig.copy.readingLog.row.split('{name}')[0]
  return e.kind === 'history' && !!lead.trim() && e.text.startsWith(lead)
}

/** One printed reading: the worst gas of that moment in its own columns, the others beside it. */
export interface ReportReading {
  time: string
  gas: string
  value: string
  stage: ReadingState
  /** «O₂ 20,4 Vol-%» – every other gas of the same reading, in preset order */
  others: string
}

/** One Messpunkt of the Rapport's «Messungen» section, its readings oldest first. */
export interface ReportReadingPoint {
  name: string
  /** «UG», «1. OG» – '' when the point carries no storey */
  place: string
  rows: ReportReading[]
}

/**
 * The Rapport's «Messungen» (owner pick 1B): every Messpunkt of the Einsatz that was measured,
 * each with its readings in time order – one row per radio report (readingRows, the panel's own
 * fold). A row leads with the gas the pill would wear for those values (worstGas: highest stage
 * first), so a point's last row is what stood on the map at the end. Points in the one Messpunkt
 * order of their LAST reading, worst first (compareReadings, staleness aside – paper does not age).
 * One block per object however many surfaces draw it (the Gebäude's annos, the Karte's entities,
 * the other sheets – the same two lists the done-milestones read, reportPdfDirect); the storey is
 * the first body's that names one. `limits` says what the stages were read against (below).
 */
export function readingsForReport(entities: readonly Entity[], board: BoardDoc): { points: ReportReadingPoint[]; limits: string } {
  const bodies = new Map<string, { props: SymbolProps; place: string }>()
  const add = (id: string, props: SymbolProps & { kind?: string }, place: string) => {
    if (props.kind !== 'symbol' || !isMeasuredSymbol(props)) return
    const seen = bodies.get(id)
    if (!seen) bodies.set(id, { props, place })
    else if (!seen.place) seen.place = place
  }
  const sheets = Object.entries(board).sort(([a], [b]) => Number(b === GEBAEUDE_PLAN_ID) - Number(a === GEBAEUDE_PLAN_ID))
  for (const [planId, annos] of sheets) {
    if (planId !== GEBAEUDE_PLAN_ID) continue
    for (const a of annos) { const from = a.floorFrom ?? a.floor ?? 0; add(a.id, a, donePlace(from, a.floorTo ?? from)) }
  }
  for (const e of entities) add(e.id, e, donePlace(e.floorFrom ?? e.floor, e.floorTo))
  for (const [planId, annos] of sheets) {
    if (planId === GEBAEUDE_PLAN_ID) continue
    for (const a of annos) add(a.id, a, donePlace(a.floorFrom ?? a.storey, a.floorTo))
  }
  const points = [...bodies.values()].flatMap(({ props, place }) => {
    const rows = readingRows(props).reverse().flatMap((r): ReportReading[] => {
      const gas = worstGas({ symbol: props.symbol, fields: r.v })
      if (!gas) return []
      return [{
        time: formatTime(new Date(r.t)), gas,
        value: readingValueText(gas, r.v[gas]),
        stage: readingState(props.symbol, gas, r.v[gas]),
        others: Object.keys(r.v).filter((k) => k !== gas).map((k) => `${k} ${readingValueText(k, r.v[k])}`).join(' · '),
      }]
    })
    if (!rows.length) return []
    const point: ReportReadingPoint = { name: readingPointName(props, ''), place, rows }
    return [{ point, symbol: props.symbol, last: symbolReading(props, props.readings?.[props.readings.length - 1]?.t) }]
  })
  const symbols = [...new Set(points.flatMap((p) => (p.symbol ? [p.symbol] : [])))]
  return {
    points: points.sort((a, b) => compareReadings(a.last, b.last)).map((p) => p.point),
    limits: symbols.map(readingLimitsText).filter(Boolean).join(' · '),
  }
}

/** «CO A1 ab 30 ppm, A2 ab 60 ppm · O₂ A1 unter 19 Vol-%, …» – the limits the stages on the
 *  page were read against, said once above the table: they are the station's own setting, and
 *  the paper outlives it. '' for a symbol without limits. */
export function readingLimitsText(symbol: string): string {
  const C = appConfig.copy.contextPanel
  const num = (n: number) => n.toLocaleString(formatLocale())
  const lim = (l: { atLeast?: number; below?: number } | undefined, key: string) => (l ? [
    l.below != null && fillTemplate(C.readingBelow, { n: num(l.below) }),
    l.atLeast != null && fillTemplate(C.readingAtLeast, { n: num(l.atLeast) }),
  ].filter(Boolean).join(` ${C.readingOr} `) + (unitOf(key) ? ` ${unitOf(key)}` : '') : '')
  return (readingScale(symbol)?.gases ?? []).map((g) =>
    [g.key, [g.a1 && `A1 ${lim(g.a1, g.key)}`, g.a2 && `A2 ${lim(g.a2, g.key)}`].filter(Boolean).join(', ')].join(' '),
  ).join(' · ')
}
