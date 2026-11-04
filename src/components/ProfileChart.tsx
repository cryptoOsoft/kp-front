import { useMemo } from 'react'
import { altitudeAt, labelledNodes, profileNodes, type ProfileResult } from '../lib/profile'
import { fmtDistance, pathLengthM } from '../lib/geo'
import type { LngLat } from '../types'
import { Icon } from '../lib/icons'
import { appConfig } from '../config/appConfig'
import { useChartReadout } from '../lib/chartCursor'
import { cx } from '../lib/cx'
import { fillTemplate } from '../lib/format'
import s from './MeasurePanel.module.css'

const W = 300, H = 96, PAD = 4 // chart geometry

/**
 * Elevation-profile sparkline: distance → x, altitude → y (inverted), scaled to the profile's own
 * min/max so small undulations stay visible. Shared by the Messen tool's panel and the line
 * editor's Höhenprofil section, which is why it lives outside MeasurePanel — it keeps that file's
 * stylesheet (the `.mp-*` classes are sized off `width: 100%`, so it fits the narrower ctx dock).
 * Pointing at it READS it, as the Wassertransport's chart does (round 4, device test 04.11.2026):
 * a guide and a dot on the profile, distance and height in a tag at the top edge, and the spot on
 * the map (lib/chartCursor) – the mouse by hovering, a finger by touching; it stays where the
 * finger let go.
 */
export function ProfileChart({ p, path }: {
  p: ProfileResult
  /** the measured path itself – its nodes are marked on the profile (lib/profile · profileNodes) */
  path?: LngLat[]
}) {
  const { line, fill } = useMemo(() => {
    const maxDist = p.points[p.points.length - 1].dist || 1
    const span = Math.max(1, p.max - p.min)
    const x = (d: number) => PAD + (d / maxDist) * (W - 2 * PAD)
    const y = (a: number) => PAD + (1 - (a - p.min) / span) * (H - 2 * PAD)
    const pts = p.points.map((q) => `${x(q.dist).toFixed(1)},${y(q.alt).toFixed(1)}`)
    return { line: `M${pts.join(' L')}`, fill: `M${x(0).toFixed(1)},${(H - PAD).toFixed(1)} L${pts.join(' L')} L${x(maxDist).toFixed(1)},${(H - PAD).toFixed(1)} Z` }
  }, [p])
  // The tapped nodes: a guide and a dot on the profile, and under the axis the SAME cumulative
  // distance the map writes beside that node – so «the dip after 120 m» is a place one can point
  // at, and the unlabelled first tap is the left edge. ⚠️ The dots and labels are HTML over the
  // chart, in per cent: the SVG is stretched (preserveAspectRatio none), which would turn a
  // <circle> into an ellipse and squash any <text>.
  const nodes = useMemo(() => (path ? profileNodes(p, path) : []), [p, path])
  const labelled = useMemo(() => labelledNodes(nodes), [nodes])
  const span = Math.max(1, p.max - p.min)
  const pct = (frac: number) => ((PAD + frac * (W - 2 * PAD)) / W) * 100
  const left = (frac: number) => `${pct(frac)}%`
  const top = (alt: number) => `${((PAD + (1 - (alt - p.min) / span) * (H - 2 * PAD)) / H) * 100}%`
  // The read-out works in the PATH's metres (the ones the map writes beside its nodes – see
  // lib/profile · profileNodes on why by fraction), the profile's own without a path.
  const maxDist = p.points[p.points.length - 1].dist || 1
  const total = path && path.length >= 2 ? pathLengthM(path) : maxDist
  const { m: cur, handlers } = useChartReadout(path, (f) => Math.max(0, Math.min(1, (f * W - PAD) / (W - 2 * PAD))) * total)
  const curFrac = cur != null ? cur / (total || 1) : null
  const curAlt = curFrac != null ? altitudeAt(p, curFrac * maxDist) : 0
  return (
    <div className={s['mp-chart-wrap']}>
      <div className={s['mp-chart-plot']} {...handlers}>
        <svg className={s['mp-chart']} viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none">
          <path d={fill} className={s['mp-chart-fill']} />
          {nodes.map((n, i) => {
            const x = PAD + n.frac * (W - 2 * PAD)
            return <line key={i} x1={x} x2={x} y1={PAD} y2={H - PAD} className={s['mp-chart-guide']} />
          })}
          <path d={line} className={s['mp-chart-line']} />
          {curFrac != null && (
            <line x1={PAD + curFrac * (W - 2 * PAD)} x2={PAD + curFrac * (W - 2 * PAD)} y1={0} y2={H} className={s['mp-chart-cursor']} />
          )}
        </svg>
        {nodes.map((n, i) => (
          <span key={i} className={cx(s['mp-chart-node'], (i === 0 || i === nodes.length - 1) && s.end)}
            style={{ left: left(n.frac), top: top(n.alt) }} aria-hidden />
        ))}
        {cur != null && curFrac != null && (
          <>
            <span className={s['mp-chart-dot']} style={{ left: left(curFrac), top: top(curAlt) }} aria-hidden />
            {/* kept inside the chart's edges, as the Wassertransport's tag is */}
            <div className={s['mp-readout']} style={{ left: `${Math.min(80, Math.max(20, pct(curFrac)))}%` }} role="status">
              <b>{fmtDistance(cur)}</b>
              <span>{fillTemplate(appConfig.copy.measure.altitude, { m: Math.round(curAlt) })}</span>
            </div>
          </>
        )}
      </div>
      {nodes.length > 0 && (
        <div className={s['mp-chart-axis']} aria-hidden>
          {nodes.map((n, i) => labelled.has(i) && (
            <span key={i} className={cx(s['mp-chart-tick'], i === 0 && s.first, i === nodes.length - 1 && s.last)}
              style={{ left: left(n.frac) }}>{fmtDistance(n.dist)}</span>
          ))}
        </div>
      )}
    </div>
  )
}

/** A climb or a drop in whole metres, signed – but a flat «0 m», never «+0 m» / «−0 m». */
function signedM(m: number, sign: '+' | '−') {
  const r = Math.round(m)
  return r ? `${sign}${r} m` : '0 m'
}

/** Aufstieg / Abstieg / Tiefster–Höchster under the chart. */
export function ProfileStats({ p }: { p: ProfileResult }) {
  const C = appConfig.copy.measure // read per-render so the resolved locale applies
  return (
    <div className={cx(s['mp-stat-row'], s['mp-prof-stats'])}>
      <div className={s['mp-stat']}><span className={s['mp-k']}><Icon id="arrow" />{C.ascent}</span><b className={cx(s['mp-v'], s.up)}>{signedM(p.gain, '+')}</b></div>
      <div className={s['mp-stat']}><span className={s['mp-k']}><Icon id="arrow" />{C.descent}</span><b className={cx(s['mp-v'], s.down)}>{signedM(p.loss, '−')}</b></div>
      <div className={s['mp-stat']}><span className={s['mp-k']}>{C.min} / {C.max}</span><b className={s['mp-v']}>{Math.round(p.min)} / {Math.round(p.max)} m</b></div>
    </div>
  )
}
