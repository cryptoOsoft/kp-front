/** The live feed on a georeferenced sheet: the Karte's vehicles and shared responder positions
 *  (and, below, the Karte's photo markers — `PlanPhotoMarks`).
 *
 *  ⚠️ Everything else the Karte holds is an OBJECT now, and a sheet draws an object with its own
 *  native chrome (lib/planProjection). What is left here is the half that is not a record: a GPS
 *  fix is a moment, nothing places it, and it is drawn on the paper without ever entering the
 *  document the operator is editing — the exact mirror of the Karte, where the live layer is
 *  concatenated in at render time and never reaches the store.
 *
 *  The ONE gesture that survives with it is the vehicle drag: dropping a live Fahrzeug says
 *  «it is really here», which writes the same held-in-place override it writes on the Karte
 *  (IncidentWorkspace · vehicleOverrides). A responder's dot is somebody else's self-report and
 *  answers nothing at all.
 *
 *  ⚠️ Deliberately free of MapLibre — the Plan surface must not pull a WebGL map library in to
 *  draw a handful of glyphs.
 */
import { memo, useRef } from 'react'
import { appConfig } from '../config/appConfig'
import { fillTemplate } from '../lib/format'
import { vehicleSymbolSvg } from '../lib/useVehiclePositions'
import { isRotatableSym, isVehicleSym, TEAM_DOT_PX } from '../lib/mapView'
import { glyphFor, twinName } from '../lib/entityGlyph'
import { symbolCaptionText, symbolOriginText, isMeasuredSymbol } from '../lib/symbols'
import { softHyphenateText } from '../lib/symbolWrap'
import { beginSheetPeek, endSheetPeek } from '../lib/sheetPeek'
import { DRAG_DEADZONE_PX } from '../lib/useHoldToDrag'
import { TacticalSymbol } from '../lib/symbolRender'
import type { LiveMark, PhotoMark } from '../lib/planProjection'
import { openPhoto } from '../lib/ui'
import { thumbUrl } from '../lib/mediaUrl'
import { takenClock } from '../lib/photoGeo'
import type { CaptionMode } from '../types'
import s from './PlanLiveLayer.module.css'

/**
 * Mounted INSIDE `.wb-board`, so a mark pans and zooms with the sheet exactly like an annotation
 * — its position is the normalized plan point times the board's px size, which is the same
 * arithmetic every `.wb-anno` does.
 */
export const PlanLiveLayer = memo(function PlanLiveLayer({ marks, byName, sW, sH, sizePx, captionMode = 'off', suppressedCaptions, onMove }: {
  marks: LiveMark[]
  byName: Record<string, string>
  /** the board's rendered size in px (fit × zoom) */
  sW: number
  sH: number
  /** the plan's symbol base size in px, so a live vehicle matches the sheet's own symbols */
  sizePx: number
  captionMode?: CaptionMode
  /** captions the Karte is already hiding — one feed, one answer about what is legible */
  suppressedCaptions?: ReadonlySet<string>
  /** Drag a live VEHICLE: the point comes back in the sheet's normalized space, and the caller
   *  folds it through the fit onto the one live entity. Omitted ⇒ nothing here answers a press. */
  onMove?: (id: string, pt: { x: number; y: number }, phase: 'start' | 'move' | 'end') => void
}) {
  const C = appConfig.copy.whiteboard.georef
  /** Where the dragged mark STOOD when the finger went down. ⚠️ The delta is cumulative, so it
   *  has to be added to a FIXED base: this component re-renders mid-drag with the mark already
   *  moved, and adding it to the live point re-applied the whole travel on every sample. */
  const from = useRef<{ x: number; y: number } | null>(null)
  const drag = useRef<{ id: number; x: number; y: number; moved: boolean } | null>(null)
  if (!sW || !sH) return null
  return (
    <>
      {marks.map((m) => {
        const e = m.entity
        const at = { left: 0, top: 0, transform: `translate(${m.pt.x * sW}px, ${m.pt.y * sH}px) translate(-50%, -50%)` }
        // A responder's dot is a person's self-report. It carries their name and nothing else:
        // no glyph to aim, no size to scale, nothing to open and nothing to move.
        if (e.kind === 'person') {
          return (
            <span key={m.id} className={`${s.twin} ${s.inert}`} style={{ ...at, width: TEAM_DOT_PX, height: TEAM_DOT_PX }} aria-hidden>
              <TacticalSymbol svg={glyphFor(e, byName)} sizePx={TEAM_DOT_PX} rotation={0} caption={e.label} />
            </span>
          )
        }
        const name = twinName(e)
        // Map rotation is north-referenced; on a turned sheet it is expressed relative to
        // paper-up, and `fit.rotationDeg` is exactly that frame change (georef · GeorefFit).
        // ⚠️ Only for DIRECTIONAL glyphs — a badge whose text must stay readable is upright on
        // both surfaces, and turning it by the frame change tilted exactly those.
        const veh = isVehicleSym(e)
        const rot = veh || isRotatableSym(e) ? (e.rotation ?? 0) + m.rotationDeg : 0
        const caption = suppressedCaptions?.has(e.id) ? null : symbolCaptionText(e, captionMode)
        const origin = suppressedCaptions?.has(e.id) ? null : symbolOriginText(e, captionMode)
        const title = fillTemplate(C.twinFromMap, { name })
        const movable = !!onMove && veh
        const report = (phase: 'start' | 'move' | 'end', dx: number, dy: number) => {
          const base = from.current ?? m.pt
          // clamped to the sheet: a point off the paper is not a place on this document, and
          // would fold back through the fit as a coordinate nobody aimed at
          onMove?.(m.id, { x: Math.max(0, Math.min(1, base.x + dx / sW)), y: Math.max(0, Math.min(1, base.y + dy / sH)) }, phase)
        }
        return (
          <span key={m.id}
            className={`${s.twin} ${movable ? s.grab : s.inert}`}
            style={{ ...at, width: sizePx, height: sizePx, '--hbox': `${sizePx}px` } as React.CSSProperties}
            title={title} aria-label={title}
            onPointerDown={movable ? (ev) => {
              ev.stopPropagation() // the board must not start a pan under the same finger
              ev.currentTarget.setPointerCapture?.(ev.pointerId)
              drag.current = { id: ev.pointerId, x: ev.clientX, y: ev.clientY, moved: false }
            } : undefined}
            onPointerMove={movable ? (ev) => {
              const d = drag.current
              if (!d || d.id !== ev.pointerId) return
              const dx = ev.clientX - d.x, dy = ev.clientY - d.y
              // the SHARED deadzone every drag on both surfaces uses, so two marks side by side
              // answer a nudge the same way
              if (!d.moved) {
                if (Math.hypot(dx, dy) < DRAG_DEADZONE_PX) return
                d.moved = true
                from.current = m.pt
                beginSheetPeek() // the phone's .ctx sheet steps aside for the length of the drag
                report('start', 0, 0)
              }
              report('move', dx, dy)
            } : undefined}
            onPointerUp={movable ? (ev) => {
              const d = drag.current
              if (!d || d.id !== ev.pointerId) return
              drag.current = null
              endSheetPeek()
              if (d.moved) report('end', ev.clientX - d.x, ev.clientY - d.y)
              from.current = null
            } : undefined}
          >
            <TacticalSymbol
              svg={veh ? vehicleSymbolSvg(name, rot, e.directed ?? true) : glyphFor(e, byName)}
              sizePx={sizePx} rotation={veh ? 0 : rot} count={e.count}
              caption={caption ? softHyphenateText(caption) : caption}
              origin={origin}
              measured={isMeasuredSymbol(e) ? e : undefined} />
          </span>
        )
      })}
    </>
  )
})

/**
 * The Karte's PHOTO markers on a georeferenced sheet (lib/planProjection · photoOverlay): the
 * thumbnail where the picture was taken and its view cone, in the paper's frame. Read-only —
 * moving or removing one is the Karte's — and a tap opens the picture, which is the one thing
 * anybody wants from it here. Same chrome as on the Karte (`.ts.photo`, 03-map.css).
 */
export const PlanPhotoMarks = memo(function PlanPhotoMarks({ marks, sW, sH, inert }: {
  marks: PhotoMark[]
  sW: number
  sH: number
  /** a tool is armed: the marks stay visible but stop answering */
  inert?: boolean
}) {
  const G = appConfig.copy.photoGeo
  if (!sW || !sH) return null
  return (
    <>
      {marks.map((m) => {
        const t = takenClock(m.takenAt)
        const title = `${t ? fillTemplate(G.markerTaken, { t }) : G.marker}. ${G.planMark}`
        return (
          <button key={m.id} type="button" className={`${s.twin} ${inert ? s.inert : ''}`}
            style={{ left: 0, top: 0, transform: `translate(${m.pt.x * sW}px, ${m.pt.y * sH}px) translate(-50%, -50%)` }}
            title={title} aria-label={title}
            onPointerDown={(ev) => ev.stopPropagation()}
            onClick={(ev) => { ev.stopPropagation(); if (m.url) openPhoto(m.url, { caption: t ? fillTemplate(G.markerTaken, { t }) : G.marker, filename: 'foto.jpg' }) }}
          >
            <span className="ts photo">
              {m.heading != null && (
                <svg className="photo-cone" viewBox="0 0 120 120" aria-hidden
                  style={{ transform: `translate(-50%, -50%) rotate(${m.heading}deg)` }}>
                  <path d="M60 60 L28.4 11.4 A58 58 0 0 1 91.6 11.4 Z" />
                </svg>
              )}
              <img src={thumbUrl(m.url)} alt="" decoding="async" />
            </span>
          </button>
        )
      })}
    </>
  )
})
