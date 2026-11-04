import { useEffect, useState, useSyncExternalStore } from 'react'
import type { HoseSize, LngLat, RelaySettings, RelaySource } from '../types'
import { pathLengthM } from './geo'
import { fillTemplate, formatLocale } from './format'
import { appConfig } from '../config/appConfig'
import { planFor, pumpRange, resolveRelay, withPumpOverride, withoutPins, RELAY, type RelayInput, type RelayPlan, type RelayPump } from './hydraulics'
import { reverseProfile, type ProfileResult } from './profile'

// The Wassertransport controller: what Messen › Strecke and the Leitung editor share around the
// pure engine (lib/hydraulics) — the resolved assumptions, the plan, the tapped pump and where it
// was tapped, a pump being dragged — and the little store that puts its pumps on the map
// (components/RelayPumpMarkers). The chart's read-out spot is lib/chartCursor's, not this one's.

/** Where a pump was tapped: its bubble opens there and only there (round 4, device test
 *  04.11.2026) – at the chart's dot, or at the map's marker. */
export type PumpOrigin = 'chart' | 'map'

/** A hose + relay pair as stored on a Leitung (Drawing · hose/relay) or held by Messen. */
export interface RelayValue { hose?: HoseSize; relay?: RelaySettings }

export interface RelayController {
  /** the route (WGS84) the water takes, first point = the source – the drawn path, or that path
   *  backwards while `reversed` */
  coords: LngLat[]
  /** the height profile along `coords` (turned round with it), for the Aufstieg / Abstieg row */
  profile: ProfileResult | null
  reversed: boolean
  /** the water runs the other way: the far end becomes the source */
  toggleReverse: () => void
  input: RelayInput
  /** null: no route yet, or the height profile is still on its way for the first time */
  plan: RelayPlan | null
  lengthM: number
  profileLoading: boolean
  readOnly: boolean
  /** the tapped pump (its ring shows on the chart AND the map), and where it was tapped */
  selected: number | null
  selectedFrom: PumpOrigin | null
  select: (i: number | null, from?: PumpOrigin) => void
  /** a tap on pump `i` at `from`: opens its bubble there, or closes it when it is open there */
  tapPump: (i: number, from: PumpOrigin) => void
  set: (patch: { hose?: HoseSize; flow?: number; source?: RelaySource; startBar?: number }) => void
  setPumpBar: (i: number, bar: number) => void
  unpinAll: () => void
  /** a pump moved on the chart or the map: `move` previews (nothing is written), `end` commits */
  dragPump: (i: number, atM: number, phase: 'move' | 'end') => void
  /** where pump `i` may go (lib/hydraulics · pumpRange) */
  range: (i: number) => [number, number]
  /** the same route with another hose or flow — what the alternatives would take (RelayMessages) */
  planWith: (over: Partial<RelayInput>) => RelayPlan | null
}

/** Drop the keys a relay leaves at their default, so the stored object says only what was set. */
const compact = ({ flow, source, startBar, pumps, reverse }: RelaySettings): RelaySettings => ({
  ...(flow != null ? { flow } : null), ...(source ? { source } : null),
  ...(startBar != null ? { startBar } : null), ...(pumps?.length ? { pumps } : null),
  ...(reverse ? { reverse } : null),
})

/**
 * One relay along `coords`. `value` is the stored pair (absent fields = defaults); every edit
 * hands `onChange` the changed keys only — a whole `relay` object each time, never `undefined`,
 * so a replayed `draw.edit` replaces it rather than keeping the old one. A drag previews locally
 * and writes once, on release (one undo step, never a stream).
 */
export function useRelay({ coords: drawn, profile: drawnProfile, profileLoading, value, onChange, readOnly = false }: {
  coords: LngLat[]
  profile: ProfileResult | null
  profileLoading: boolean
  value: RelayValue
  onChange?: (patch: RelayValue) => void
  readOnly?: boolean
}): RelayController {
  const [pick, setPick] = useState<{ i: number; from: PumpOrigin } | null>(null)
  const setSelected = (i: number | null, from: PumpOrigin = 'chart') => setPick(i == null ? null : { i, from })
  const [preview, setPreview] = useState<{ i: number; atM: number } | null>(null)
  const stored = resolveRelay(value.hose, value.relay)
  const input: RelayInput = preview
    ? { ...stored, pumps: withPumpOverride(stored.pumps, preview.i, { atM: preview.atM }) ?? [] }
    : stored
  // «Richtung umkehren»: the calculation runs along the path backwards; nothing drawn changes
  const reversed = !!value.relay?.reverse
  const coords = reversed ? [...drawn].reverse() : drawn
  const profile = reversed && drawnProfile ? reverseProfile(drawnProfile) : drawnProfile
  const lengthM = pathLengthM(coords)
  // a stale profile stays in use while the next one loads (useLineProfile keeps it), so moving a
  // point does not blank the chart; only the very first fetch has nothing to show yet
  const points = profile?.points ?? null
  const waiting = profileLoading && !points
  // not memoized: ~200 profile samples, a few microseconds — cheaper than keying a memo on it
  const plan = coords.length >= 2 && lengthM >= 1 && !waiting ? planFor(input, lengthM, points) : null
  const write = (relay: RelaySettings) => onChange?.({ relay: compact(relay) })
  const pins = input.pumps.map((o) => o?.atM)
  return {
    coords, profile, reversed, input, plan, lengthM, profileLoading, readOnly: readOnly || !onChange,
    selected: pick?.i ?? null, selectedFrom: pick?.from ?? null, select: setSelected,
    // the same pump tapped again where its bubble is open closes it; tapped in the OTHER place, the
    // bubble moves there
    tapPump: (i, from) => setPick(pick?.i === i && pick.from === from ? null : { i, from }),
    // the pumps count from the source, so what was moved or set by hand would land elsewhere:
    // the overrides go with the old direction, as with a new source
    toggleReverse: () => {
      write({ ...value.relay, reverse: !reversed, pumps: undefined })
      setSelected(null)
    },
    set: ({ hose, ...rest }) => {
      if (hose) onChange?.({ hose })
      if (!Object.keys(rest).length) return
      // a new source renumbers the pumps (a Löschweier puts one AT the source), so what was set
      // by hand on «Pumpe 2» would land on another pump: the overrides go with the old source
      const fresh = rest.source && rest.source !== stored.source
      write({ ...value.relay, ...rest, ...(fresh ? { startBar: undefined, pumps: undefined } : null) })
      if (fresh) setSelected(null)
    },
    setPumpBar: (i, bar) => write({ ...value.relay, pumps: withPumpOverride(stored.pumps, i, { bar: bar === RELAY.defaultPumpBar ? undefined : bar }) }),
    unpinAll: () => write({ ...value.relay, pumps: withoutPins(stored.pumps) }),
    // a drag only MOVES the pump — its card opens on a tap, not on every move (owner 04.11.2026:
    // the card popping up mid-drag threw the whole panel around); the moved pump wears its ring
    dragPump: (i, atM, phase) => {
      if (phase === 'move') { setPreview({ i, atM }); return }
      setPreview(null)
      write({ ...value.relay, pumps: withPumpOverride(stored.pumps, i, { atM: Math.round(atM * 10) / 10 }) })
    },
    range: (i) => (plan ? pumpRange(plan, pins, i, lengthM) : [0, lengthM]),
    planWith: (over) => (plan ? planFor({ ...input, ...over }, lengthM, points) : null),
  }
}

/** «keine Pumpe» / «1 Pumpe» / «3 Pumpen» */
export function pumpsText(n: number): string {
  const R = appConfig.copy.relay
  return n === 0 ? R.pumpsNone : n === 1 ? R.pumpsOne : fillTemplate(R.pumpsMany, { n })
}

/** What the Wasser picker hands back — a preset («800 l/min») or whatever was typed — as l/min:
 *  the leading whole number (a Swiss «1'200» included), clamped to the engine's range; null for
 *  anything without one, which then changes nothing. */
export function parseFlow(text: string): number | null {
  const m = /\d[\d'’]*/.exec(text)
  const n = m ? Number(m[0].replace(/['’]/g, '')) : 0
  return n > 0 ? Math.max(RELAY.flowMin, Math.min(RELAY.flowMax, n)) : null
}

/** «4.1 bar» in the deployment's own decimals */
export const fmtBar = (bar: number): string =>
  `${bar.toLocaleString(formatLocale(), { minimumFractionDigits: 1, maximumFractionDigits: 1 })} bar`

// ── The pumps on the map ─────────────────────────────────────────────────────────────────────
// ⚠️ A module store, not props (the lib/georefMode reasoning, smaller): the relay is open in a
// panel (MeasurePanel, DrawEditor) that is a sibling of the map, several prop layers away on both
// the Lage (MapStage) and the Karte app. The panel that has a relay open publishes its pumps; the
// map's RelayPumpMarkers draws whatever is published. Only ONE relay is open at a time (Messen and
// a selected Leitung are different tools), and the owner token keeps a late cleanup of one panel
// from clearing the other's. A pump tapped ON THE MAP opens its bubble there (RelayPumpMarkers),
// so the overlay carries what that bubble shows and sets, too.

/** Marks a pump's tap target – the chart's dot, the map's marker: an outside press there is that
 *  pump's own tap, not a dismissal of its bubble (components/PumpBubble). */
export const PUMP_ATTR = { 'data-relay-pump': '' }
export const PUMP_SELECTOR = '[data-relay-pump]'

export interface RelayOverlay {
  coords: LngLat[]
  source: RelaySource
  pumps: RelayPump[]
  selected: number | null
  selectedFrom: PumpOrigin | null
  /** the plan has a height profile (the bubble's «… m ü.M.» line) */
  terrain: boolean
  readOnly: boolean
  /** a tap on the map's marker of pump `i` (RelayController · tapPump) */
  onSelect: (i: number) => void
  onPumpBar: (i: number, bar: number) => void
  /** close the bubble (nothing selected) */
  onClose: () => void
  onDrag: (i: number, atM: number, phase: 'move' | 'end') => void
  range: (i: number) => [number, number]
}

let current: { owner: symbol; overlay: RelayOverlay } | null = null
const listeners = new Set<() => void>()
const notify = () => { for (const l of listeners) l() }
const subscribe = (l: () => void) => { listeners.add(l); return () => { listeners.delete(l) } }
const snapshot = () => current?.overlay ?? null

/** The relay whose pumps the map shows right now (null = none). */
export function useRelayOverlay(): RelayOverlay | null {
  return useSyncExternalStore(subscribe, snapshot, snapshot)
}

/** Publish `ctrl`'s pumps on the map while `on` (the panel's relay is open), and take them away
 *  when it closes or unmounts. Along `ctrl.coords` — the route the water takes, so the source
 *  letter stands at the right end of a reversed one. */
export function usePublishRelay(ctrl: RelayController, on: boolean) {
  const [owner] = useState(() => Symbol('relay'))
  const overlay: RelayOverlay | null = on && ctrl.plan ? {
    coords: ctrl.coords, source: ctrl.input.source, pumps: ctrl.plan.pumps, selected: ctrl.selected, selectedFrom: ctrl.selectedFrom,
    terrain: ctrl.plan.terrain, readOnly: ctrl.readOnly,
    onSelect: (i) => ctrl.tapPump(i, 'map'), onPumpBar: ctrl.setPumpBar, onClose: () => ctrl.select(null),
    onDrag: ctrl.dragPump, range: ctrl.range,
  } : null
  useEffect(() => {
    if (overlay) { current = { owner, overlay }; notify() }
    else if (current?.owner === owner) { current = null; notify() }
  })
  useEffect(() => () => { if (current?.owner === owner) { current = null; notify() } }, [owner])
}

/**
 * A tap on the empty map while a pump's bubble is open ON THE MAP only closes that bubble – in
 * Messen it must not also add a point (MapView · handleClick asks this first, as useMapActions ·
 * onMapClick closes an open Ebenen panel first). True when there was one to close.
 */
export function dismissRelayBubble(): boolean {
  const open = current?.overlay
  if (!current || open?.selected == null || open.selectedFrom !== 'map') return false
  // closed in the store at once, so a second tap before the panel re-publishes finds nothing open
  current = { owner: current.owner, overlay: { ...open, selected: null, selectedFrom: null } }
  notify()
  open.onClose()
  return true
}
