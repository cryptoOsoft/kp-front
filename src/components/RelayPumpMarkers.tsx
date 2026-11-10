import { useEffect, useRef, useState } from 'react'
import { Marker, useMap } from 'react-map-gl/maplibre'
import { appConfig } from '../config/appConfig'
import { cx } from '../lib/cx'
import { fillTemplate } from '../lib/format'
import { distanceAlongPath, pointAlongPath } from '../lib/geo'
import { MARKER_Z } from '../lib/labelPass'
import { hoseDefaults, RELAY_PUMP_SYMBOL } from '../lib/hydraulics'
import { drawsPumps } from '../lib/linePumps'
import { symPx } from '../lib/mapView'
import { beginSheetPeek, endSheetPeek } from '../lib/sheetPeek'
import { TacticalSymbol } from '../lib/symbolRender'
import { useLineProfile } from '../lib/useLineProfile'
import { askLineMeasure, PUMP_ATTR, pumpLabel, relayOverlay, useRelay, useRelayOverlay, type RelayOverlay, type RelayValue } from '../lib/useRelay'
import type { Drawing, LngLat } from '../types'
import { PumpBubble } from './PumpBubble'
import s from './RelayPumpMarkers.module.css'

// The Wassertransport's pumps on the map — whatever relay a panel has open (lib/useRelay ·
// usePublishRelay: Messen › Strecke, or the selected Leitung's «Messung»), and the pumps every
// Leitung with «Pumpen auf Karte» draws while no panel has its relay open (LinePumpMarkers,
// lib/linePumps). Rendered by MapView inside its <Map>, on the Lage and in the Karte app alike. A
// pump is DRAGGED along its line to move it — snapped to the line, clamped between its neighbours
// (lib/hydraulics · pumpRange) — which pins it (`pumps[i].atM`, written once, on release). In a
// panel's relay a TAP opens its bubble right here at the marker (round 4, device test 04.11.2026:
// the same PumpBubble the chart opens, not one in the panel); on a resting Leitung a tap selects
// the Leitung, its «Messung» open. The bubble follows a dragged pump; the map moving under it closes it (Base UI
// positions from the anchor's box and has no per-frame tracking for a CSS-transformed marker), and
// a tap on the empty map only closes it (MapView · handleClick → lib/useRelay · dismissRelayBubble).
// A pump of a Leitung whose switch is on wears the pack's Motorspritze (lib/hydraulics ·
// RELAY_PUMP_SYMBOL) at a symbol's map size – in the open panel too, so the switch shows at once
// what it does, tagged with the chart's P1, P2 …; every other relay pump is the chart's numbered disc.

const PUMP_Z = { zIndex: MARKER_Z.selected + 1 }
const SOURCE_Z = { zIndex: MARKER_Z.selected }
const NUDGE_PX = 4

/** A pump that reads as a Motorspritze: the pack glyph at a symbol's map size. */
interface PumpGlyph { svg: string; px: number }

/** What both marker sets need from the map around them (MapView's own props / state). */
interface MapCtx { byName: Record<string, string>; zoom: number; symMul: number }

const glyphAt = ({ byName, zoom, symMul }: MapCtx, at: LngLat): PumpGlyph =>
  ({ svg: byName[RELAY_PUMP_SYMBOL] ?? '', px: symPx('symbol', at[1], zoom, symMul) })

/** Mounted inside MapView's <Map>; reads the published relay itself, so a drag re-renders only this. */
export function RelayPumpMarkers(ctx: MapCtx) {
  const relay = useRelayOverlay()
  if (!relay || relay.coords.length < 2) return null
  const start = relay.coords[0]
  return (
    <>
      {/* which end the water comes from — the letter of the source, at the line's first point */}
      <Marker longitude={start[0]} latitude={start[1]} anchor="center" style={SOURCE_Z}>
        <span className={s.source} aria-hidden>{appConfig.copy.relay.sourceLetters[relay.source]}</span>
      </Marker>
      {relay.pumps.map((p, i) => {
        const at = pointAlongPath(relay.coords, p.dist)
        return (
          <Marker key={`rp${i}`} longitude={at[0]} latitude={at[1]} anchor="center" style={PUMP_Z}>
            <PumpGrip relay={relay} i={i} low={p.low} pinned={p.pinned} at={at} glyph={relay.symbols ? glyphAt(ctx, at) : undefined} />
          </Marker>
        )
      })}
    </>
  )
}

/**
 * The pumps every Leitung with «Pumpen auf Karte» draws (lib/linePumps · drawsPumps), each from
 * its own controller – the one its editor runs (lib/useRelay), on the same cached profile – so
 * they stand where the editor puts them and move with the line. The Leitung whose relay a panel
 * has open is left to RelayPumpMarkers (its live pumps, preview and bubble). `onPin`: a dragged
 * pump's pin, as the line's edit; absent (read-only) the pumps only answer a tap.
 */
export function LinePumpMarkers({ drawings, onPin, onSelectLine, ...ctx }: MapCtx & {
  drawings: readonly Drawing[]
  onPin?: (id: string, patch: RelayValue) => void
  onSelectLine: (id: string) => void
}) {
  const open = useRelayOverlay()?.lineId
  return <>{drawings.filter((d) => drawsPumps(d) && d.id !== open).map((d) => (
    <LinePumps key={d.id} line={d} ctx={ctx} onPin={onPin} onSelectLine={onSelectLine} />
  ))}</>
}

function LinePumps({ line, ctx, onPin, onSelectLine }: {
  line: Drawing
  ctx: MapCtx
  onPin?: (id: string, patch: RelayValue) => void
  onSelectLine: (id: string) => void
}) {
  const { profile, loading } = useLineProfile(line.coords, true)
  const ctrl = useRelay({
    coords: line.coords, profile, profileLoading: loading, value: { hose: line.hose, relay: line.relay },
    defaultHose: hoseDefaults().relay, onChange: onPin ? (patch) => onPin(line.id, patch) : undefined,
  })
  const base = relayOverlay(ctrl, line.id)
  if (!base) return null
  // a tap selects the Leitung with its «Messung» open (its editor holds the numbers – lib/useRelay ·
  // askLineMeasure): a resting line opens no bubble
  const select = () => { askLineMeasure(line.id); onSelectLine(line.id) }
  const relay: RelayOverlay = { ...base, selected: null, selectedFrom: null, onSelect: select }
  return <>{relay.pumps.map((p, i) => {
    const at = pointAlongPath(relay.coords, p.dist)
    return (
      <Marker key={`lp${i}`} longitude={at[0]} latitude={at[1]} anchor="center" style={PUMP_Z}>
        <PumpGrip relay={relay} i={i} low={p.low} pinned={p.pinned} at={at} glyph={glyphAt(ctx, at)} />
      </Marker>
    )
  })}</>
}

/** The bubble of the pump tapped on the map, at its marker (`grip`). Closes when the map moves. */
function MapPumpBubble({ relay, i, grip, at }: { relay: RelayOverlay; i: number; grip: HTMLButtonElement; at: LngLat }) {
  const { current: map } = useMap()
  const { onClose } = relay
  useEffect(() => {
    const m = map?.getMap()
    if (!m) return
    m.on('movestart', onClose)
    return () => { m.off('movestart', onClose) }
  }, [map, onClose])
  const pump = relay.pumps[i]
  return (
    <PumpBubble anchor={grip} anchorAt={`${i}:${at[0]}:${at[1]}`} pump={pump} i={i}
      sourceLabel={appConfig.copy.relay.sources[relay.source]} terrain={relay.terrain} readOnly={relay.readOnly}
      onBar={(bar) => relay.onPumpBar(i, bar)} onClose={onClose}
      // the empty map is MapView's to answer (handleClick asks dismissRelayBubble first)
      keepOpenOn={(t) => t === map?.getCanvas()} />
  )
}

/**
 * One pump's grip. Its listeners are NATIVE and stop the press at the element — the reason
 * MapView · NewNodeHandle gives: React delegates at the root, after maplibre's own listener on
 * the canvas container has already turned the press into a map tap (which in Messen would add a
 * point under the pump). A press that does not travel NUDGE_PX is a tap.
 */
function PumpGrip({ relay, i, low, pinned, at, glyph }: { relay: RelayOverlay; i: number; low: boolean; pinned: boolean; at: LngLat; glyph?: PumpGlyph }) {
  const R = appConfig.copy.relay
  const { current: map } = useMap()
  // the element in state, not a ref: the bubble hangs from it, and a ref is not read during render
  const [grip, setGrip] = useState<HTMLButtonElement | null>(null)
  // the latest overlay, for listeners bound once per element
  const live = useRef(relay)
  useEffect(() => { live.current = relay })
  useEffect(() => {
    const el = grip
    if (!el || !map) return
    const swallow = (e: Event) => e.stopPropagation()
    const down = (e: PointerEvent) => {
      e.stopPropagation(); e.preventDefault()
      const sx = e.clientX, sy = e.clientY
      const range = live.current.range(i)
      let moved = false
      const atM = (ev: PointerEvent) => {
        const r = map.getContainer().getBoundingClientRect()
        const ll = map.unproject([ev.clientX - r.left, ev.clientY - r.top])
        const d = distanceAlongPath(live.current.coords, [ll.lng, ll.lat] as LngLat)
        return Math.max(range[0], Math.min(range[1], d))
      }
      const move = (ev: PointerEvent) => {
        if (live.current.readOnly) return
        if (!moved) {
          if (Math.hypot(ev.clientX - sx, ev.clientY - sy) < NUDGE_PX) return
          moved = true
          beginSheetPeek() // the pump is travelling — let the phone sheet peek away
        }
        live.current.onDrag(i, atM(ev), 'move')
      }
      const up = (ev: PointerEvent) => {
        window.removeEventListener('pointermove', move, true)
        window.removeEventListener('pointerup', up, true)
        window.removeEventListener('pointercancel', up, true)
        // a cancelled gesture (the browser took it) puts the pump back instead of committing
        if (moved) { endSheetPeek(); live.current.onDrag(i, atM(ev), ev.type === 'pointerup' ? 'end' : 'cancel') }
        else if (ev.type === 'pointerup') live.current.onSelect(i)
      }
      window.addEventListener('pointermove', move, true)
      window.addEventListener('pointerup', up, true)
      window.addEventListener('pointercancel', up, true)
    }
    const click = (e: MouseEvent) => {
      e.stopPropagation(); e.preventDefault()
      if (e.detail === 0) live.current.onSelect(i) // keyboard: Enter / Space on the focused grip
    }
    el.addEventListener('pointerdown', down)
    el.addEventListener('click', click)
    el.addEventListener('mousedown', swallow)
    el.addEventListener('touchstart', swallow, { passive: true })
    return () => {
      el.removeEventListener('pointerdown', down)
      el.removeEventListener('click', click)
      el.removeEventListener('mousedown', swallow)
      el.removeEventListener('touchstart', swallow)
    }
  }, [map, i, grip])
  const name = fillTemplate(R.pumpN, { n: i + 1 })
  const short = pumpLabel(i, relay.pumps.length)
  const open = relay.selected === i && relay.selectedFrom === 'map'
  return (
    <>
      <button ref={setGrip} type="button" {...PUMP_ATTR}
        className={cx(s.pump, glyph && s.symbol, relay.selected === i && s.sel, pinned && s.pinned, low && s.low, relay.readOnly && s.static)}
        aria-label={name} aria-expanded={open} title={relay.readOnly ? name : `${name} · ${R.dragHint}`}>
        {/* the glyph says «MS 2» on every pump alike, so it wears the chart's number too (P1, P2 …;
            Manuel 09.11.2026: two pumps on the map both read «MS2») */}
        {glyph ? <><TacticalSymbol svg={glyph.svg} sizePx={glyph.px} /><span className={s.tag} aria-hidden>{short}</span></> : short}
      </button>
      {open && grip && <MapPumpBubble relay={relay} i={i} grip={grip} at={at} />}
    </>
  )
}
