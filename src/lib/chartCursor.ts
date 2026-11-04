import { useEffect, useState, useSyncExternalStore, type PointerEvent as ReactPointerEvent } from 'react'
import type { LngLat } from '../types'

// Where a chart along a route is being read, marked on the map (round 4, device test 04.11.2026):
// the Wassertransport's chart (WaterRelay · RelayChart) and the plain Höhenprofil (ProfileChart)
// both put a dot on the map at the spot the pointer reads. ⚠️ A module store, not props – the same
// reasoning as lib/useRelay · usePublishRelay: the charts live in panels that are siblings of the
// map, several prop layers away; the map's ChartCursorMarker draws whatever is published. One
// chart is read at a time, and the owner token keeps one chart's late clear from wiping another's.

/** The read spot: `m` metres along `coords` (WGS84, first point = the chart's left edge). */
export interface ChartCursorSpot { coords: LngLat[]; m: number }

let current: { owner: symbol; spot: ChartCursorSpot } | null = null
const listeners = new Set<() => void>()
const notify = () => { for (const l of listeners) l() }
const subscribe = (l: () => void) => { listeners.add(l); return () => { listeners.delete(l) } }
const snapshot = () => current?.spot ?? null

/** The spot a chart is read at right now (null = nobody points at a chart). */
export function useChartCursor(): ChartCursorSpot | null {
  return useSyncExternalStore(subscribe, snapshot, snapshot)
}

/**
 * A chart's pointer read-out, and its spot on the map. `toM` turns a share of the element's width
 * (0 = its left edge, 1 = its right) into metres along `coords`. Spread `handlers` on the element
 * the pointer reads: the mouse reads by hovering and clears on leaving; a finger reads by touching
 * and scrubbing, and the read-out stays where it let go. Without `coords` nothing reaches the map.
 * The spot leaves the map when the chart unmounts.
 */
export function useChartReadout(coords: LngLat[] | undefined, toM: (frac: number) => number) {
  const [owner] = useState(() => Symbol('chart'))
  const [m, setM] = useState<number | null>(null)
  const set = (next: number | null) => {
    setM(next)
    if (next != null && coords) { current = { owner, spot: { coords, m: next } }; notify() }
    else if (current?.owner === owner) { current = null; notify() }
  }
  useEffect(() => () => { if (current?.owner === owner) { current = null; notify() } }, [owner])
  const read = (e: ReactPointerEvent<Element>) => {
    const r = e.currentTarget.getBoundingClientRect()
    set(toM(r.width ? Math.max(0, Math.min(1, (e.clientX - r.left) / r.width)) : 0))
  }
  const handlers = {
    onPointerDown: (e: ReactPointerEvent<Element>) => {
      if (e.pointerType !== 'mouse') e.currentTarget.setPointerCapture(e.pointerId)
      read(e)
    },
    onPointerMove: (e: ReactPointerEvent<Element>) => { if (e.pointerType === 'mouse' || e.buttons) read(e) },
    onPointerLeave: (e: ReactPointerEvent<Element>) => { if (e.pointerType === 'mouse') set(null) },
  }
  return { m, handlers }
}
