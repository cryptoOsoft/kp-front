import { useRef, useState, type PointerEvent as ReactPointerEvent } from 'react'
import { appConfig } from '../config/appConfig'
import { useChartReadout } from '../lib/chartCursor'
import { cx } from '../lib/cx'
import { fillTemplate } from '../lib/format'
import { fmtDistance, pointAlongPath } from '../lib/geo'
import { HOSE_SIZES, HOSES, RELAY, type RelayPlan } from '../lib/hydraulics'
import { Icon } from '../lib/icons'
import { Popover } from '../lib/overlays'
import { useIsPhone } from '../lib/useIsPhone'
import { fmtBar, parseFlow, pumpsText, PUMP_ATTR, type RelayController } from '../lib/useRelay'
import type { LngLat, RelaySource } from '../types'
import { Button, IconButton } from './Button'
import { Combo } from './Combo'
import { ProfileStats } from './ProfileChart'
import { PumpBubble } from './PumpBubble'
import { Segmented } from './Segmented'
import { LoadingStatus } from './ShellLoader'
import { Stepper } from './Stepper'
import m from './MeasurePanel.module.css'
import s from './WaterRelay.module.css'

// The Wassertransport section – ONE component for both places that ask the question: Messen ›
// Strecke (MeasurePanel, with a Schlauch-Ø row) and a drawn Leitung (DrawEditor · Messung, where
// the Ø is the line's own «Schlauch» row). The host owns the controller (lib/useRelay) and the
// button that adds the section; this renders the heading («Wassertransport» alone on the left, its
// actions together on the right: ⇄ the water runs the other way, ⓘ the sources in a popover that
// changes nothing in the panel's size, × close), the inputs as the editor's own rows (segments,
// pickers and steppers inline – no sheets: owner 04.11.2026, «feels native»), ONE chart (the
// pressure over the terrain, its legend above it and a bar scale beside it – it stands in for the
// Höhenprofil, with the same Aufstieg / Abstieg row under it; a tapped pump opens its bubble at
// the dot – components/PumpBubble, portalled, so it never grows the panel), then «Druck am Ende»,
// the warnings and the ways to keep the result. WIDE (the Messen panel off a phone): the chart down
// the left, inputs, result and actions down the right; ONE column (a phone, the Leitung editor):
// heading, inputs, chart, result.
// Approved design: mockups/wt-nov04-m4b.html, refined by round 3 mock F-A, 04.11.2026; the pump
// card became the bubble on the device test that evening (owner: «one number you rarely change»),
// and round 4 (device test 04.11.2026) dropped «Planungshilfe» from the heading, moved the sources
// into a popover and the bubble out of the panel's flow.

const SOURCES: RelaySource[] = ['hydrant', 'weier', 'pumpe']

/** The section. `showHose`: Messen offers the Schlauch-Ø row; a Leitung takes it from its own.
 *  `wide`: two columns – the Messen
 *  panel off a phone. `onClose`: the heading's ×. `onAdoptLine`: Messen's «Als Leitung auf die
 *  Karte» (the host's adopt, which carries the relay onto the new line). `onPlacePumps`: «Pumpen
 *  als Symbole setzen», every pump's spot at once – only where the surface may place symbols (the
 *  Lage, not read-only; never the Karte app). Each action is hidden while its prop is absent. */
export function WaterRelay({ ctrl, showHose = false, wide = false, onClose, onAdoptLine, onPlacePumps }: {
  ctrl: RelayController
  showHose?: boolean
  wide?: boolean
  onClose?: () => void
  onAdoptLine?: () => void
  onPlacePumps?: (coords: LngLat[]) => void
}) {
  const R = appConfig.copy.relay
  const { input, plan, readOnly } = ctrl
  const flowText = (v: number) => `${v} ${R.flowUnit}`
  // a Pumpe at the start gives what a relay pump gives; a Hydrant from nothing up to its own maximum
  const pumpStart = input.source === 'pumpe'
  // «55 mm» … «110 mm» do not fit four abreast beside the label column on a phone: there the
  // segments say the bare Ø, as the Leitung editor's «Schlauch» row does
  const hoseLabels = useIsPhone() ? R.hoseShort : R.hoseLabels
  return (
    <div className={cx(s.relay, wide && s.wide)}>
      <div className={s.head}>
        <span className={s.title}>{R.title}</span>
        <div className={s.headActions}>
          {/* a line drawn from the fire back to the hydrant: turn the water round, not the drawing */}
          {!readOnly && (
            <IconButton label={R.reverse} aria-pressed={ctrl.reversed} onClick={ctrl.toggleReverse}>
              <Icon id="swap" />
            </IconButton>
          )}
          {/* where the numbers come from – one tap away, over the panel rather than in it */}
          <Popover side="bottom" align="end" zIndex={60} popupClassName={s.sourcesPop} ariaLabel={R.sourcesLabel}
            trigger={<IconButton label={R.sourcesLabel}><Icon id="info" /></IconButton>}>
            <p className={s.sources}>{fillTemplate(R.sourcesNote, { bar: RELAY.minInletBar })}</p>
          </Popover>
          {onClose && <IconButton label={appConfig.copy.closeDialog} onClick={onClose}><Icon id="close" /></IconButton>}
        </div>
      </div>
      <div className={s.fields}>
        {showHose && (
          <div className="field"><span>{R.hoseDiameter}</span>
            {readOnly ? <b>{R.hoseLabels[input.hose]}</b> : (
              <Segmented ariaLabel={R.hoseDiameter} value={input.hose} onChange={(hose) => ctrl.set({ hose })}
                options={HOSE_SIZES.map((h) => ({ value: h, label: hoseLabels[h] }))} />
            )}
          </div>
        )}
        {/* the presets, and the menu's own row to type any other amount (Combo · allowCustom) */}
        <div className="field"><span>{R.flow}</span>
          {readOnly ? <b>{flowText(input.flow)}</b> : (
            <Combo value={flowText(input.flow)} options={RELAY.flows.map(flowText)} placeholder={R.flowUnit}
              searchPlaceholder={R.flowSearch} allowCustom clearable={false}
              onChange={(v) => { const flow = parseFlow(v); if (flow != null) ctrl.set({ flow }) }} />
          )}
        </div>
        <div className="field"><span>{R.start}</span>
          {readOnly ? <b>{R.sources[input.source]}</b> : (
            <Combo value={R.sources[input.source]} options={SOURCES.map((v) => R.sources[v])} placeholder={R.start} clearable={false}
              onChange={(v) => { const source = SOURCES.find((x) => R.sources[x] === v); if (source) ctrl.set({ source }) }} />
          )}
        </div>
        {input.source === 'weier' ? <p className={s.hint}>{R.weierLine}</p> : (
          <div className="field"><span>{R.pressure}</span>
            <Stepper value={input.startBar} min={pumpStart ? RELAY.pumpBarMin : 0} max={pumpStart ? RELAY.pumpBarMax : RELAY.hydrantBarMax}
              step={RELAY.barStep} snap decimals={1} readOnly={readOnly} format={fmtBar}
              onChange={(startBar) => ctrl.set({ startBar })} ariaLabel={R.pressure} />
          </div>
        )}
      </div>
      {/* no plan and nothing loading: a route under a metre – nothing to compute along */}
      {!plan ? (ctrl.profileLoading && (
        <div className={cx(s.graph, s.loading)}><LoadingStatus>{appConfig.copy.measure.profileLoading}</LoadingStatus></div>
      )) : (
        <>
          <div className={s.graph}>
            <RelayChart ctrl={ctrl} plan={plan} />
            {/* the profile's own numbers, set apart from the chart and its legend as a block of their own */}
            {plan.terrain && ctrl.profile && <div className={s.stats}><ProfileStats p={ctrl.profile} /></div>}
          </div>
          <div className={s.result}>
            <div className="field"><span>{R.endBar}</span>
              <b className={cx(s.endBar, plan.endBar > RELAY.okBar ? s.ok : plan.endBar >= RELAY.minInletBar ? s.warn : s.bad)}>{fmtBar(plan.endBar)}</b>
            </div>
            <RelayMessages ctrl={ctrl} plan={plan} />
            <RelayActions ctrl={ctrl} plan={plan} onAdoptLine={onAdoptLine} onPlacePumps={onPlacePumps} />
          </div>
        </>
      )}
    </div>
  )
}

/** «Wassertransport berechnen» – under the host's Höhenprofil, the app's standard button; it ADDS
 *  the section (owner 04.11.2026), which then closes with its own ×. */
export function AddRelayButton({ onClick }: { onClick: () => void }) {
  return <Button block icon={<Icon id="plus" />} onClick={onClick}>{appConfig.copy.relay.add}</Button>
}

/** The warnings, in the order they matter: a pump that gets no water first, then the estimate. */
function RelayMessages({ ctrl, plan }: { ctrl: RelayController; plan: RelayPlan }) {
  const R = appConfig.copy.relay
  const { input } = ctrl
  const n = plan.pumps.length
  // what the other hoses would need, so «too many» comes with its way out
  const others = n > RELAY.manyPumps
    ? HOSE_SIZES.filter((h) => h !== input.hose).map((h) => {
      const p = ctrl.planWith({ hose: h })
      return p ? `${R.hoseLabels[h]}: ${pumpsText(p.pumps.length)}` : ''
    }).filter(Boolean).join(' · ')
    : ''
  return (
    <>
      {plan.pumps.map((p, i) => p.low && (
        <p key={i} className={cx(s.msg, s.msgBad)}><Icon id="warn" />
          <span>{p.inBar > 0
            ? fillTemplate(R.lowInlet, { n: i + 1, min: RELAY.minInletBar })
            : fillTemplate(R.noInlet, { n: i + 1 })}</span>
        </p>
      ))}
      {!plan.terrain && <p className={cx(s.msg, s.msgWarn)}><Icon id="warn" /><span>{R.noTerrain}</span></p>}
      {plan.loss.above && (
        <p className={cx(s.msg, s.msgWarn)}><Icon id="warn" /><span>{fillTemplate(R.outsideTable, { flow: input.flow / HOSES[input.hose].lines })}</span></p>
      )}
      {n > RELAY.manyPumps && (
        <p className={cx(s.msg, s.msgWarn)}><Icon id="warn" />
          <span><b>{fillTemplate(R.manyPumps, { n })}</b>{others}</span>
        </p>
      )}
      {plan.stuck && <p className={cx(s.msg, s.msgWarn)}><Icon id="warn" /><span>{R.stuck}</span></p>}
    </>
  )
}

/** Keeping the result: the way back to automatic once a pump was moved, the Strecke as a Leitung
 *  WITH its calculation (Messen), and the pumps as ordinary Motorspritzen – one undo step and one
 *  Verlauf row for all of them (useMapActions · placePumpSymbols), on their own from then on. */
function RelayActions({ ctrl, plan, onAdoptLine, onPlacePumps }: {
  ctrl: RelayController
  plan: RelayPlan
  onAdoptLine?: () => void
  onPlacePumps?: (coords: LngLat[]) => void
}) {
  const R = appConfig.copy.relay
  const pinned = !ctrl.readOnly && ctrl.input.pumps.some((o) => o?.atM != null)
  // (not while the profile reloads: the pumps would stand on the previous route's terrain)
  const placeable = !!onPlacePumps && plan.pumps.length > 0 && !ctrl.profileLoading
  if (!pinned && !onAdoptLine && !placeable) return null
  return (
    <div className={s.actions}>
      {pinned && <Button variant="quiet" block onClick={ctrl.unpinAll}>{R.autoAll}</Button>}
      {onAdoptLine && <Button variant="primary" block icon={<Icon id="pen" />} onClick={onAdoptLine}>{R.adoptLine}</Button>}
      {placeable && (
        <Button block icon={<Icon id="plus" />} onClick={() => onPlacePumps(plan.pumps.map((p) => pointAlongPath(ctrl.coords, p.dist)))}>
          {R.placePumps}
        </Button>
      )}
    </div>
  )
}

// chart geometry (viewBox units ≈ px in the wide panel's left column; uniform scale, so text stays
// round). PL leaves room for the bar scale down the left.
const W = 340, H = 160, PL = 30, PR = 4, PT = 10, PB = 8
/** a pump's dot (its bubble hangs from a spot this size at the dot) */
const DOT_R = 8
const IW = W - PL - PR, IH = H - PT - PB

/** The pressure at `d` along the line (a pump's two points share a dist: its inlet wins there). */
function barAt(plan: RelayPlan, d: number): number {
  const ln = plan.line
  for (let k = 1; k < ln.length; k++) {
    const a = ln[k - 1], b = ln[k]
    if (d <= b.dist && b.dist > a.dist) return a.bar + ((d - a.dist) / (b.dist - a.dist)) * (b.bar - a.bar)
  }
  return ln[ln.length - 1].bar
}

/** The terrain height at `d` (the profile is already scaled onto the route). */
function altAt(plan: RelayPlan, d: number): number {
  const pr = plan.prof
  for (let k = 1; k < pr.length; k++) {
    const a = pr[k - 1], b = pr[k]
    if (d <= b.dist) return b.dist > a.dist ? a.alt + ((d - a.dist) / (b.dist - a.dist)) * (b.alt - a.alt) : b.alt
  }
  return pr[pr.length - 1].alt
}

/**
 * The «Bänder» chart (round 3 D2): a legend strip under it, a bar scale down its left, the zones
 * (gut / knapp, and «zu wenig» only once a moved pump drops below the minimum), the terrain profile
 * behind them, the dashed minimum line, the pressure curve, the pumps. A pump is tapped to open
 * its bubble at the dot (a second tap closes it) and DRAGGED along the x axis to move it (the same
 * pin the map's marker sets – components/RelayPumpMarkers). Pointing anywhere else READS the
 * chart: distance, height and pressure at that spot, and the spot on the map (lib/chartCursor ·
 * useChartReadout – the mouse by hovering, a finger by touching; it stays where the finger let go).
 */
export function RelayChart({ ctrl, plan }: { ctrl: RelayController; plan: RelayPlan }) {
  const R = appConfig.copy.relay
  const L = ctrl.lengthM
  const MIN = RELAY.minInletBar
  const minBar = Math.min(...plan.line.map((p) => p.bar))
  // red only once a MOVED pump drops below the minimum (an automatic one stands at exactly 2 bar,
  // give or take the float)
  const low = minBar < MIN - 1e-6
  // the scale starts at 0, so the dashed 2 bar line reads as «2 above nothing» (owner 04.11.2026:
  // from 2 up it was not obvious where the line stood); below 0 only for a pump that gets nothing
  const LO = Math.min(0, Math.floor(minBar))
  const HI = Math.max(10.5, ...plan.line.map((p) => p.bar + 0.5))
  const X = (d: number) => PL + (d / (L || 1)) * IW
  const Y = (b: number) => PT + (1 - (Math.max(b, LO) - LO) / (HI - LO)) * IH
  // the scale: every even bar from 0 up
  const ticks = Array.from({ length: Math.floor(HI / 2) + 1 }, (_, k) => k * 2)
  const svgRef = useRef<SVGSVGElement>(null)
  // the read-out: anywhere on the chart but a pump (those stop their own events)
  const { m: cur, handlers: read } = useChartReadout(ctrl.coords, (f) => Math.max(0, Math.min(L, ((f * W - PL) / IW) * L)))
  // the zero-size spot the chart's bubble hangs from, at the tapped pump's dot
  const [dot, setDot] = useState<HTMLSpanElement | null>(null)
  const drag = useRef<{ i: number; x0: number; moved: boolean; range: [number, number] } | null>(null)
  const atM = (clientX: number, range: [number, number]) => {
    const r = svgRef.current?.getBoundingClientRect()
    if (!r?.width) return range[0]
    const vx = ((clientX - r.left) / r.width) * W
    return Math.max(range[0], Math.min(range[1], ((vx - PL) / IW) * L))
  }
  const down = (i: number) => (e: ReactPointerEvent<SVGGElement>) => {
    e.preventDefault(); e.stopPropagation()
    e.currentTarget.setPointerCapture(e.pointerId)
    drag.current = { i, x0: e.clientX, moved: false, range: ctrl.range(i) }
  }
  const move = (e: ReactPointerEvent<SVGGElement>) => {
    e.stopPropagation() // a pump on the move is not a read-out
    const d = drag.current
    if (!d || ctrl.readOnly) return
    if (!d.moved && Math.abs(e.clientX - d.x0) < 4) return
    d.moved = true
    ctrl.dragPump(d.i, atM(e.clientX, d.range), 'move')
  }
  const up = (e: ReactPointerEvent<SVGGElement>) => {
    const d = drag.current
    drag.current = null
    if (!d) return
    if (d.moved) ctrl.dragPump(d.i, atM(e.clientX, d.range), 'end')
    else ctrl.tapPump(d.i, 'chart')
  }
  // the gesture taken away (a scroll, a system swipe): the pump goes back, nothing is written
  const cancel = () => {
    const d = drag.current
    drag.current = null
    if (d?.moved) ctrl.dragPump(d.i, 0, 'cancel')
  }
  const terrain = plan.terrain ? (() => {
    const alts = plan.prof.map((p) => p.alt)
    const mn = Math.min(...alts), span = Math.max(1, Math.max(...alts) - mn)
    // the silhouette lives in the lower 60 % of the plot: behind the bands, never over the curve's top
    const YH = (a: number) => PT + IH * 0.4 + (1 - (a - mn) / span) * IH * 0.6
    const pts = plan.prof.map((p) => `${X(p.dist).toFixed(1)},${YH(p.alt).toFixed(1)}`).join(' L')
    return { fill: `M${X(0)},${PT + IH} L${pts} L${X(L)},${PT + IH} Z`, line: `M${pts}` }
  })() : null
  const many = plan.pumps.length > RELAY.manyPumps
  const open = ctrl.selectedFrom === 'chart' && ctrl.selected != null ? plan.pumps[ctrl.selected] : undefined
  return (
    <>
      <div className={s.plot}>
        <div className={s.plotBox}>
        <svg ref={svgRef} className={s.chart} viewBox={`0 0 ${W} ${H}`} role="img"
          aria-label={`${R.title}: ${pumpsText(plan.pumps.length)}, ${R.endBar} ${fmtBar(plan.endBar)}`}
          {...read}>
          <rect className={s.zoneGood} x={PL} y={Y(HI)} width={IW} height={Y(RELAY.okBar) - Y(HI)} />
          <rect className={s.zoneTight} x={PL} y={Y(RELAY.okBar)} width={IW} height={Y(MIN) - Y(RELAY.okBar)} />
          {low && <rect className={s.zoneLow} x={PL} y={Y(MIN)} width={IW} height={Y(LO) - Y(MIN)} />}
          {terrain && <><path className={s.terrain} d={terrain.fill} /><path className={s.terrainLine} d={terrain.line} /></>}
          {ticks.map((b) => (
            <g key={b}>
              <line className={s.tickMark} x1={PL - 3} x2={PL} y1={Y(b)} y2={Y(b)} />
              <text className={s.tickText} x={PL - 5} y={Y(b) + 3.5} textAnchor="end" fontSize={9.5}>{b}</text>
            </g>
          ))}
          <text className={s.unitText} x={2} y={PT - 2} fontSize={9}>{R.barUnit}</text>
          <line className={s.minLine} x1={PL} x2={W - PR} y1={Y(MIN)} y2={Y(MIN)} />
          <path className={s.curve} d={`M${plan.line.map((p) => `${X(p.dist).toFixed(1)},${Y(p.bar).toFixed(1)}`).join(' L')}`} />
          {cur != null && (
            <g className={s.cursor}>
              <line x1={X(cur)} x2={X(cur)} y1={PT} y2={PT + IH} />
              <circle cx={X(cur)} cy={Y(barAt(plan, cur))} r={3.5} />
            </g>
          )}
          {plan.pumps.map((p, i) => {
            const x = X(p.dist), y = Y(p.inBar)
            return (
              <g key={i}>
                <line className={s.pumpGuide} x1={x} x2={x} y1={PT} y2={PT + IH} />
                {ctrl.selected === i && <circle className={s.pumpHalo} cx={x} cy={y} r={13} />}
                <g className={cx(s.pumpHit, ctrl.readOnly && s.pumpStatic)} role="button" tabIndex={0} {...PUMP_ATTR}
                  aria-label={fillTemplate(R.pumpN, { n: i + 1 })} aria-expanded={open === p}
                  onPointerDown={down(i)} onPointerMove={move} onPointerUp={up} onPointerCancel={cancel}
                  onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); ctrl.tapPump(i, 'chart') } }}>
                  <circle cx={x} cy={y} r={20} fill="transparent" />
                  <circle className={cx(s.pumpDot, p.low && s.pumpLow, p.pinned && s.pumpPinned)} cx={x} cy={y} r={DOT_R} />
                  <text className={s.pumpText} x={x} y={y + 3.2} textAnchor="middle" fontSize={many ? 7.5 : 8.5}>
                    {many ? i + 1 : fillTemplate(R.pumpShort, { n: i + 1 })}
                  </text>
                </g>
              </g>
            )
          })}
        </svg>
        {/* the read-out, over the top of the plot at the spot, kept inside the chart's edges */}
        {cur != null && (
          <div className={m['mp-readout']} style={{ left: `${Math.min(80, Math.max(20, (X(cur) / W) * 100))}%` }} role="status">
            <b>{fmtDistance(cur)}</b>
            {plan.terrain && <span>{fillTemplate(appConfig.copy.measure.altitude, { m: Math.round(altAt(plan, cur)) })}</span>}
            <span>{fmtBar(barAt(plan, cur))}</span>
          </div>
        )}
        {open && ctrl.selected != null && (
          <span ref={setDot} className={s.pumpAnchor} aria-hidden
            style={{ left: `${(X(open.dist) / W) * 100}%`, top: `${(Y(open.inBar) / H) * 100}%`, width: `${((2 * DOT_R) / W) * 100}%` }} />
        )}
        {open && ctrl.selected != null && dot && (
          <PumpBubble anchor={dot} anchorAt={`${ctrl.selected}:${open.dist}:${open.inBar}`} pump={open} i={ctrl.selected}
            sourceLabel={R.sources[ctrl.input.source]} terrain={plan.terrain} readOnly={ctrl.readOnly}
            onBar={(bar) => { if (ctrl.selected != null) ctrl.setPumpBar(ctrl.selected, bar) }} onClose={() => ctrl.select(null)} />
        )}
        </div>
        {/* the distance axis starts and ends where the plot does, not under the bar scale */}
        <div className={s.ticks} style={{ paddingLeft: `${(PL / W) * 100}%`, paddingRight: `${(PR / W) * 100}%` }}>
          <span>0 m</span>
          <span className={s.tickEnd}>{fmtDistance(L)}</span>
        </div>
      </div>
      {/* the legend, always in view, under the chart (owner 04.11.2026, moved from above it) – what
          the line, the blue and the bands mean */}
      <div className={s.key} style={{ paddingLeft: `${(PL / W) * 100}%` }}>
        <span><i className={s.keyLine} />{R.legendLine}</span>
        {plan.terrain && <span><i className={s.keyTerrain} />{R.legendTerrain}</span>}
        <span><i className={s.keyGood} />{fillTemplate(R.legendGood, { bar: RELAY.okBar })}</span>
        <span><i className={s.keyTight} />{fillTemplate(R.legendTight, { min: MIN, ok: RELAY.okBar })}</span>
        {low && <span><i className={s.keyLow} />{fillTemplate(R.legendLow, { bar: MIN })}</span>}
      </div>
    </>
  )
}
