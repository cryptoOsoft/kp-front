import { useMemo, useState } from 'react'
import type { Drawing, LngLat } from '../types'
import { pathLengthM, fmtDistance, polygonAreaM2, fmtArea } from './geo'
import { hoseDefaults } from './hydraulics'
import type { ProfileResult } from './profile'
import { useLineProfile } from './useLineProfile'
import type { RelayValue } from './useRelay'

// Measurement tool, extracted from App's god component. All state here is EPHEMERAL —
// it is never written to the workspace blob, so this hook is fully self-contained and
// safe to own outside the persistence/hydrate core.

export type MeasureMode = 'line' | 'area'
export interface MeasureLabel { coord: LngLat; text: string; strong: boolean }

/** Cumulative-distance labels at each vertex (line) or area at the centroid (area).
 *  Pure + exported so the geometry/formatting is unit-testable without React. */
export function measureLabels(mode: MeasureMode, path: LngLat[]): MeasureLabel[] {
  if (path.length < 2) return []
  if (mode === 'line') {
    let cum = 0
    return path.slice(1).map((c, i) => {
      cum += pathLengthM([path[i], c])
      return { coord: c, text: fmtDistance(cum), strong: i === path.length - 2 }
    })
  }
  if (path.length < 3) return []
  const cx = path.reduce((s, c) => s + c[0], 0) / path.length
  const cy = path.reduce((s, c) => s + c[1], 0) / path.length
  return [{ coord: [cx, cy] as LngLat, text: fmtArea(polygonAreaM2(path)), strong: true }]
}

export interface Measure {
  mode: MeasureMode
  setMode: (m: MeasureMode) => void
  /** the active path (line OR area, depending on mode) — each mode keeps its own points */
  path: LngLat[]
  setPath: (fn: (pts: LngLat[]) => LngLat[]) => void
  /** clear BOTH line + area paths (the dock × / cancel) */
  reset: () => void
  labels: MeasureLabel[]
  profile: ProfileResult | null
  loading: boolean
  /** the Strecke's Wassertransport (components/WaterRelay): its hose + relay assumptions, and
   *  whether the section was opened in this measurement — only then do the pumps show on the map
   *  and in the folded readout, and does «Als Linie übernehmen» carry them onto the line */
  relay: MeasureRelay
}

export interface MeasureRelay {
  value: RelayValue
  onChange: (patch: RelayValue) => void
  open: boolean
  setOpen: (open: boolean) => void
}

/**
 * What «Als Linie übernehmen» / «Als Leitung auf die Karte» carries onto the new Leitung
 * (MapToolDocks · onAdopt → useMapDrawing · createLine): nothing unless the Wassertransport was
 * opened. Opened on its defaults it is still one – an empty `relay`, so the Leitung shows it – and
 * its Ø is written OUT, as adding a relay in the line editor does (lib/hydraulics ·
 * relayAddPatch): the Leitung keeps the Ø it was computed on whatever the station's defaults do.
 * …and it DRAWS its pumps (`showPumps`, owner 05.11.2026): what Messen showed on the map while it
 * measured stays there, now as the Leitung's Motorspritzen (lib/linePumps) – switched off in its
 * editor like any other.
 */
export function adoptedRelay({ open, value }: Pick<MeasureRelay, 'open' | 'value'>): Pick<Drawing, 'hose' | 'relay'> | undefined {
  return open ? { hose: value.hose ?? hoseDefaults().relay, relay: { ...value.relay, showPumps: true } } : undefined
}

/**
 * Measurement tool state: a line (distance + height profile) or area (area + perimeter).
 * `active` (the measure tool being selected) gates the labels + the swisstopo profile
 * fetch, mirroring the previous `tool === 'measure'` guards. Switching mode never reuses
 * the other mode's points; results are ephemeral and never saved.
 */
export function useMeasure(active: boolean): Measure {
  const [mode, setMode] = useState<MeasureMode>('line')
  const [line, setLine] = useState<LngLat[]>([])
  const [area, setArea] = useState<LngLat[]>([])

  const path = mode === 'line' ? line : area
  const setPath = (fn: (pts: LngLat[]) => LngLat[]) => (mode === 'line' ? setLine(fn) : setArea(fn))
  const reset = () => { setLine([]); setArea([]) }

  const labels = useMemo(() => (active ? measureLabels(mode, path) : []), [active, mode, path])

  // the swisstopo height profile for a measured line — same fetch the line editor's Höhenprofil
  // uses; a null result (outside CH / API down) just leaves the panel showing distance
  const { profile, loading } = useLineProfile(line, active && mode === 'line')

  // Wassertransport: hose / flow / source stay for the session; what belongs to ONE Strecke — the
  // section having been opened, a pump moved or set by hand — ends with it (cleared, or reset)
  const [relayValue, setRelayValue] = useState<RelayValue>({})
  const [relayOpen, setRelayOpen] = useState(false)
  // (adjusted during render, React's own pattern for state that follows a prop)
  const ended = line.length < 2
  const [wasEnded, setWasEnded] = useState(ended)
  if (wasEnded !== ended) {
    setWasEnded(ended)
    if (ended) {
      setRelayOpen(false)
      setRelayValue((v) => (v.relay?.pumps ? { ...v, relay: { ...v.relay, pumps: undefined } } : v))
    }
  }
  const relay: MeasureRelay = {
    value: relayValue,
    onChange: (patch) => setRelayValue((v) => ({ ...v, ...patch })),
    open: relayOpen,
    setOpen: setRelayOpen,
  }

  return { mode, setMode, path, setPath, reset, labels, profile, loading, relay }
}
