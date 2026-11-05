import { useEffect, useRef, useState } from 'react'
import { Marker, useMap } from 'react-map-gl/maplibre'
import { appConfig } from '../config/appConfig'
import { cx } from '../lib/cx'
import { fillTemplate } from '../lib/format'
import { distanceAlongPath, pointAlongPath } from '../lib/geo'
import { MARKER_Z } from '../lib/labelPass'
import { RELAY } from '../lib/hydraulics'
import { beginSheetPeek, endSheetPeek } from '../lib/sheetPeek'
import { PUMP_ATTR, useRelayOverlay, type RelayOverlay } from '../lib/useRelay'
import type { LngLat } from '../types'
import { PumpBubble } from './PumpBubble'
import s from './RelayPumpMarkers.module.css'

// The Wassertransport's pumps on the map — whatever relay a panel has open (lib/useRelay ·
// usePublishRelay: Messen › Strecke, or the selected Leitung's «Messung»). Rendered by MapView
// inside its <Map>, on the Lage and in the Karte app alike; nothing is drawn while no relay is
// open. A pump is DRAGGED along its line to move it — snapped to the line, clamped between its
// neighbours (lib/hydraulics · pumpRange) — and TAPPED to open its bubble right here at the
// marker (round 4, device test 04.11.2026: the same PumpBubble the chart opens, not one in the
// panel). The bubble follows a dragged pump; the map moving under it closes it (Base UI positions
// from the anchor's box and has no per-frame tracking for a CSS-transformed marker), and a tap on
// the empty map only closes it (MapView · handleClick → lib/useRelay · dismissRelayBubble).

const PUMP_Z = { zIndex: MARKER_Z.selected + 1 }
const SOURCE_Z = { zIndex: MARKER_Z.selected }
const NUDGE_PX = 4

/** Mounted inside MapView's <Map>; reads the published relay itself, so a drag re-renders only this. */
export function RelayPumpMarkers() {
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
            <PumpGrip relay={relay} i={i} low={p.low} pinned={p.pinned} at={at} />
          </Marker>
        )
      })}
    </>
  )
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
function PumpGrip({ relay, i, low, pinned, at }: { relay: RelayOverlay; i: number; low: boolean; pinned: boolean; at: LngLat }) {
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
  const open = relay.selected === i && relay.selectedFrom === 'map'
  return (
    <>
      <button ref={setGrip} type="button" {...PUMP_ATTR}
        className={cx(s.pump, relay.selected === i && s.sel, pinned && s.pinned, low && s.low, relay.readOnly && s.static)}
        aria-label={name} aria-expanded={open} title={relay.readOnly ? name : `${name} · ${R.dragHint}`}>
        {relay.pumps.length > RELAY.manyPumps ? i + 1 : fillTemplate(R.pumpShort, { n: i + 1 })}
      </button>
      {open && grip && <MapPumpBubble relay={relay} i={i} grip={grip} at={at} />}
    </>
  )
}
