/** The PLAN half of «Karte verknüpfen» — crosses, tap capture, loupe, popover and mode panel.
 *
 *  The map half lives in GeorefMapLayer (inside MapView); the state both sides share lives in
 *  lib/georefMode. Nothing here owns state that has to survive: on a phone this whole component
 *  is unmounted between the plan tap and the map tap.
 */
import { useEffect, useRef, useState, useSyncExternalStore, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { appConfig } from '../config/appConfig'
import { fillTemplate } from '../lib/format'
import { Icon } from '../lib/icons'
import { confirmDialog, toast } from '../lib/ui'
import { beginTap, endGeorefMode, georefDispatch, georefLamp, georefOnPlan, georefOpenHint, georefPairIndex, georefPhoneTargetPoint, peekGeorefPhoneTarget, georefOpenCount, georefPlacing, georefSideCount, georefSlotLabel, GEOREF_TAP_SLOP_PX, isPlacingTap, placeGeorefPhoneTarget, registerGeorefPhoneTarget, trackTap, useGeorefEscape, useGeorefMode, type GeorefModeState, type GeorefSide, type TapGesture } from '../lib/georefMode'
import { approvedUntouched, fitSimilarity, hasAutoPairs, residualClaim } from '../lib/georef'
import { incidentBindingApproved } from '../lib/incidentPlanBindings'
import { useIsPhone } from '../lib/useIsPhone'
import { SheetGrab, useSwipeDismiss } from '../lib/overlays'
import { getMeldeleisteHost, subscribeMeldeleisteHost } from '../lib/meldeleisteHost'
import type { GeorefPair, PlanPt } from '../lib/georef'
import { InfoToggle } from './InfoToggle'
import { Button } from './Button'
import { Segmented } from './Segmented'
import { Slider } from './Slider'
import { planLoupeDraws } from '../lib/planLoupe'
import s from './GeorefMode.module.css'
import pv from './PdfViewport.module.css'

/** The loupe's magnification over the plan as it is currently displayed. */
const LOUPE_MUL = 4

/** The bits of the board's view the mode has to drive: where a client point lands on the sheet,
 *  and how to pan/zoom it (both sides stay normally operable while the mode runs). */
export interface PlanViewApi {
  toNorm: (clientX: number, clientY: number) => [number, number] | null
  applyView: (scale: number, pos: { x: number; y: number }) => void
  zoomTo: (factor: number, cx: number, cy: number) => void
  scaleRef: React.MutableRefObject<number>
  posRef: React.MutableRefObject<{ x: number; y: number }>
  /** the canvas whose coordinate system is used for pinch zoom */
  canvasEl: HTMLDivElement | null
  /** the board itself, as a REF — where the plan's baked bitmap lives, for the loupe's crop.
   *  A ref rather than the element, so nothing reads `.current` during render. */
  boardRef: React.RefObject<HTMLDivElement | null>
}

/** Where the aim currently is on the plan bitmap. */
interface Aim { pt: PlanPt }

const crossSvg = (
  <svg viewBox="0 0 26 26" fill="none" stroke="currentColor" strokeWidth="1.9" aria-hidden>
    <circle cx="13" cy="13" r="7.5" />
    <path d="M13 0v6M13 20v6M0 13h6M20 13h6" />
    <circle cx="13" cy="13" r="1.7" fill="currentColor" stroke="none" />
  </svg>
)

/**
 * Everything the mode draws ON the sheet, mounted INSIDE `.wb-board` so the crosses pan and zoom
 * with the plan exactly like an annotation. The loupe is portalled up into the canvas — it must
 * stay pinned to a screen corner while the board underneath it moves.
 *
 * Rendered whenever there is something to show: armed (crosses + capture) or merely linked with
 * the chip open (crosses only, so a reference can be found again months later).
 */
export function GeorefBoardLayer({ pairs, mode, armed, sW, sH, view }: {
  /** the STORED pairs, drawn when the layer only shows a finished reference (Passung open).
   *  While armed the layer draws `mode.slots` instead — pairs and open halves alike. */
  pairs: GeorefPair[]
  mode: GeorefModeState
  /** the mode is armed on THIS plan — only then is anything placeable */
  armed: boolean
  sW: number
  sH: number
  view: PlanViewApi
}) {
  const isPhone = useIsPhone()
  const [aim, setAim] = useState<Aim | null>(null)
  const targetCanvasEl = view.canvasEl
  const targetToNorm = view.toNorm
  // the current gesture is moving the sheet, not aiming at it — the loupe steps aside for it and
  // the cursor says so (a magnifier over a sliding plan magnifies nothing but the slide)
  const [panning, setPanning] = useState(false)
  // Pointer bookkeeping for the capture overlay. ⚠️ The layer takes the taps and NOTHING else:
  // a drag pans the sheet exactly as it does with no mode running, a second finger pinches, and
  // only a gesture that never left the tap radius places a point. `moved` is sticky, so a pan of
  // half a screen that happens to end where it began still places nothing.
  const tap = useRef<(TapGesture & { id: number; px: number; py: number }) | null>(null)
  const ptrs = useRef<Map<number, { x: number; y: number }>>(new Map())
  const pinch = useRef<number | null>(null)
  // dragging an existing cross: slot index, whether it has passed the tap threshold yet, and
  // whether the gesture is allowed to move anything at all (see `crossDown` · locked)
  const drag = useRef<{ id: number; idx: number; x: number; y: number; moved: boolean; locked: boolean } | null>(null)

  const placing = georefPlacing(mode)
  // the mode owns every tap on the sheet while it is armed — leaving the create tools live
  // underneath would mean a mis-aimed reference tap silently drops a symbol on the plan
  const showCapture = armed

  const pinchPts = () => {
    const [a, b] = [...ptrs.current.values()]
    if (!a || !b) return null
    return { dist: Math.hypot(a.x - b.x, a.y - b.y), mx: (a.x + b.x) / 2, my: (a.y + b.y) / 2 }
  }

  // ⚠️ The mode owns the WHOLE gesture, not just its first event. `down` alone used to stop
  // propagation, so every move and every up still bubbled to `.wb-canvas` and ran `stageMove` /
  // `stageUp` in parallel with the handlers below: a pinch was zoomed twice per frame (once here,
  // once by the stage's own pinch, which the capture-phase `trackDown` had armed), and lifting to
  // one finger left the stage panning from a different origin than this layer — two pans fighting
  // over the same sheet. That is what «unusable for moving/dragging» was.
  const own = (e: React.PointerEvent) => e.stopPropagation()
  /** Where the loupe opens before anything has been pointed at: the middle of the sheet. */
  const centreAim = (): Aim | null => {
    const r = view.boardRef.current?.getBoundingClientRect()
    if (!r || !r.width) return null
    return { pt: { x: 0.5, y: 0.5 } }
  }
  /** Aim at a client point, if it is over the sheet at all. */
  const aimAt = (x: number, y: number) => {
    const n = view.toNorm(x, y)
    if (n) setAim({ pt: { x: n[0], y: n[1] } })
  }
  /**
   * The pointer LEFT the sheet (or its gesture was taken away): with a hovering pointer nothing
   * is being aimed at here any more, so this half's magnifier goes down. ⚠️ That is the
   * single-loupe rule, and it is what the admin pairing needs: there the sheet and the map stand
   * side by side under ONE pointer, and each half keeping its own last aim put two magnifiers on
   * screen at once, one of them over a pane nobody was pointing at (15.09.2026).
   * ⚠️ A TOUCH pointer is destroyed at every lift, so its `pointerleave` is not a departure —
   * there the last aim stays up, which is the whole reason the loupe opens without a hover.
   */
  const leave = (e: React.PointerEvent) => {
    if (e.pointerType === 'touch') return
    // a gesture in flight owns the aim — a captured pointer reports its boundaries against the
    // capturing element, so a drag that travels off a 26px cross must not put the loupe down
    if (drag.current || tap.current) return
    // the crosses lie OVER the capture layer as siblings, so stepping onto one is a `pointerleave`
    // without having left the sheet at all — anything still inside the board keeps the loupe up
    const to = e.relatedTarget
    if (to instanceof Node && view.boardRef.current?.contains(to)) return
    setAim(null)
  }
  // ⚠️ The loupe is up for the whole armed mode, not only while something is pressed. A touch
  // screen has no hover, so a magnifier that waited for a pointer was never seen at all: you
  // placed the point and only then found out what you had been aiming at. It opens on the middle
  // of the sheet, follows every move (hover or press), keeps the last aim after a release until
  // the pointer leaves the sheet (`leave`), and steps aside for a pan.
  useEffect(() => {
    if (!armed) { setAim(null); setPanning(false); return }
    setAim((cur) => cur ?? centreAim())
  }, [armed]) // eslint-disable-line react-hooks/exhaustive-deps

  // Phone placement is deliberately two-step: move the sheet under one fixed reticle, then use
  // the explicit action in the mode card. The resolver reads the geometry only at commit time,
  // so panning stays frame-local and the crosshair can never drift away from the point saved.
  useEffect(() => {
    if (!isPhone || !armed || !targetCanvasEl) return
    return registerGeorefPhoneTarget('plan', () => {
      const surface = targetCanvasEl.getBoundingClientRect()
      if (!surface) return null
      const top = document.querySelector('.topbar')?.getBoundingClientRect().bottom
      const bottom = document.querySelector<HTMLElement>('[data-georef-controls]')?.getBoundingClientRect().top
      const target = georefPhoneTargetPoint(surface, { top, bottom })
      if (!target) return null
      const n = targetToNorm(target.x, target.y)
      return n && n[0] >= 0 && n[0] <= 1 && n[1] >= 0 && n[1] <= 1
        ? { x: n[0], y: n[1] }
        : null
    })
  }, [armed, isPhone, targetCanvasEl, targetToNorm])

  const down = (e: React.PointerEvent) => {
    // ⚠️ The mode OWNS this pointer, exactly the way `.wb-ink` owns a placement pointer one file
    // over («placement owns this pointer — don't let the stage ALSO start a board pan»). Without
    // this the event bubbled on to `.wb-canvas`, whose `stageDown` → `panDown` calls
    // `setPointerCapture` on the CANVAS — which takes the capture away from this layer, so every
    // following move and the pointerUP were retargeted and this component's handlers never ran
    // again. The board panned, and not one reference point was ever placed. The capture-phase
    // bookkeeping (`trackDown`/`trackUp`) still sees every finger: it runs before this.
    e.stopPropagation()
    georefDispatch({ type: 'goPlan' })
    ptrs.current.set(e.pointerId, { x: e.clientX, y: e.clientY })
    if (ptrs.current.size >= 2) {
      // a second finger means pinch-zoom, never a placement — mark the gesture rather than
      // dropping it, so the first finger's release cannot still be read as a tap
      if (tap.current) tap.current.multi = true
      setPanning(true); pinch.current = pinchPts()?.dist ?? null; return
    }
    ;(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId)
    tap.current = { ...beginTap(e.clientX, e.clientY), id: e.pointerId, px: view.posRef.current.x, py: view.posRef.current.y }
    aimAt(e.clientX, e.clientY)
  }
  const move = (e: React.PointerEvent) => {
    own(e)
    if (ptrs.current.has(e.pointerId)) ptrs.current.set(e.pointerId, { x: e.clientX, y: e.clientY })
    if (pinch.current != null) {
      const m = pinchPts(), el = view.canvasEl
      if (m && el && pinch.current > 0 && m.dist > 0) {
        const r = el.getBoundingClientRect(); view.zoomTo(m.dist / pinch.current, m.mx - r.left, m.my - r.top)
      }
      if (m) pinch.current = m.dist
      return
    }
    const st = tap.current
    // no gesture in flight — a mouse simply hovering. Track it: the loupe is what says which
    // pixel a tap would take, and it must say so BEFORE the tap.
    if (!st) { georefDispatch({ type: 'goPlan' }); aimAt(e.clientX, e.clientY); return }
    if (st.id !== e.pointerId) return
    const dx = e.clientX - st.x, dy = e.clientY - st.y
    const wasTap = !st.moved
    trackTap(st, e.clientX, e.clientY)
    if (wasTap && st.moved) setPanning(true) // it became a pan — the loupe steps out of the way
    // panning from the recorded origin, the same arithmetic `useBoardGestures` uses, so the
    // sheet moves under an armed mode exactly as it does under no mode at all
    if (st.moved) { view.applyView(view.scaleRef.current, { x: st.px + dx, y: st.py + dy }); return }
    aimAt(e.clientX, e.clientY)
  }
  const up = (e: React.PointerEvent) => {
    own(e)
    const wasPinch = pinch.current != null
    ptrs.current.delete(e.pointerId)
    if (ptrs.current.size < 2) pinch.current = null
    if (ptrs.current.size === 0) setPanning(false)
    const st = tap.current; if (!st) return
    // ⚠️ A pinch that ends while the FIRST finger stays down must re-baseline the gesture.
    // `down` snapshotted the board's position once, but the pinch has been moving the board via
    // `zoomTo` — so the continuing `move()` would pan from the stale pre-pinch origin, and the
    // sheet (crosses and all) snapped visibly on the first sample after the second finger lifted.
    // New origin: the surviving pointer where it stands, the view as the pinch left it.
    if (wasPinch && pinch.current == null && st.id !== e.pointerId) {
      const rest = ptrs.current.get(st.id)
      if (rest) {
        st.x = rest.x; st.y = rest.y
        st.px = view.posRef.current.x; st.py = view.posRef.current.y
      }
      return
    }
    if (st.id !== e.pointerId) return
    tap.current = null
    // the aim STAYS where the finger left it — the loupe is up for the whole mode, so the last
    // thing looked at is what it keeps showing until something else is pointed at
    aimAt(e.clientX, e.clientY)
    if (e.type !== 'pointerup' || !isPlacingTap(st) || isPhone) return // phone commits only through the fixed target action
    const n = view.toNorm(e.clientX, e.clientY)
    // Only points ON the sheet can be references — the grey around it is not part of the plan.
    if (!n || n[0] < 0 || n[0] > 1 || n[1] < 0 || n[1] > 1) return
    georefDispatch({ type: 'planTap', pt: { x: n[0], y: n[1] } })
  }

  // --- an existing cross: drag = fine-tune with a live refit, tap = select (halo + popover) ---
  // ⚠️ …and NOT while a popover is open. The card stands right over the cross it is about to
  // act on, so the thumb that reaches for «Verschieben» was regularly dragging the point it
  // meant to press a button about — silently, because a live refit looks like nothing until
  // the finger lifts. With the card up there is exactly one way to move a point, and it is the
  // one the card names. `locked` is snapshotted at pointerdown, so the very gesture that OPENS
  // a popover (tap on a cross with nothing selected) still fine-tunes as before.
  const crossDown = (idx: number) => (e: React.PointerEvent) => {
    e.stopPropagation()
    ;(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId)
    drag.current = { id: e.pointerId, idx, x: e.clientX, y: e.clientY, moved: false, locked: !!mode.sel }
    aimAt(e.clientX, e.clientY)
  }
  const crossMove = (e: React.PointerEvent) => {
    own(e) // the stage must not ALSO pan the sheet under a cross being fine-tuned
    const d = drag.current; if (!d || d.id !== e.pointerId) return
    if (!d.moved && Math.hypot(e.clientX - d.x, e.clientY - d.y) <= GEOREF_TAP_SLOP_PX) return
    // the flag is still set past the slop even when locked: a wandering finger is not a tap,
    // so lifting it must not toggle the popover either
    d.moved = true
    if (d.locked) return
    const n = view.toNorm(e.clientX, e.clientY); if (!n) return
    setAim({ pt: { x: n[0], y: n[1] } })
    georefDispatch({ type: 'dragPlan', idx: d.idx, pt: { x: n[0], y: n[1] } })
  }
  const crossUp = (e: React.PointerEvent) => {
    own(e)
    const d = drag.current; if (!d || d.id !== e.pointerId) return
    drag.current = null
    aimAt(e.clientX, e.clientY)
    // a cross that was tapped, not dragged, gets the halo and its little popover
    if (!d.moved && e.type === 'pointerup') georefDispatch({ type: 'select', idx: d.idx, side: 'plan' })
  }

  const C = appConfig.copy.whiteboard.georef
  return (
    <>
      {showCapture && (
        <div className={`${s.capture} ${panning ? s.capturePan : ''}`}
          onPointerDown={down} onPointerMove={move} onPointerUp={up}
          onPointerCancel={(e) => { up(e); leave(e) }} onPointerLeave={leave} />
      )}
      {/* NOT armed: the stored reference, as plain marks. ⚠️ A cross is only a CONTROL while the
          mode is armed — it is a 26px glyph with a 44px touch pad above every annotation, so a
          «button» here swallows taps meant for the symbol underneath it, which is exactly what
          opening the Passung on a linked plan did before 26.08.
          ⚠️ No cross for a synthetic 'auto' pair: it sits at a corner nobody tapped, and two
          numbered crosses on landmarks the operator never set read as the app inventing points
          («despite not using points», field 08.09.). They reappear as editable slots when the
          pairing mode is armed, because there they anchor a fit that can be corrected. */}
      {!armed && pairs.filter((p) => p.kind !== 'auto').map((p, i) => (
        <span key={i} className={`${s.cross} ${s.inert}`} style={{ left: p.plan.x * sW, top: p.plan.y * sH }} aria-hidden>
          {crossSvg}
          <span className={s.badge}>{i + 1}</span>
        </span>
      ))}
      {/* ARMED: every slot's plan half — paired ones blue, open halves amber, the numbers shared
          with the map so a mispairing is something the eye catches. Selection halo and the
          stepped-back «being re-placed» look ride on top; only an armed re-place of a PLAN half
          makes the crosses inert, because that landing tap belongs to the sheet beneath them. */}
      {armed && mode.slots.map((sl, i) => {
        if (!sl.plan) return null
        const open = !sl.map
        // a synthetic auto anchor: ghosted, badged «A», never numbered — the operator's own
        // first point must read «1», matching every count the mode speaks (georefSlotNo)
        const isAuto = sl.kind === 'auto'
        const no = georefSlotLabel(mode.slots, i)
        const isSel = mode.sel?.side === 'plan' && mode.sel.idx === i
        const isMove = mode.move?.side === 'plan' && mode.move.idx === i
        const cls = `${s.cross} ${open ? s.pending : ''} ${isMove ? s.picked : ''} ${isSel ? s.selHalo : ''} ${isAuto ? s.autoAnchor : ''}`
        if (placing) {
          return (
            <span key={i} className={`${cls} ${s.inert}`} style={{ left: sl.plan.x * sW, top: sl.plan.y * sH }}
              aria-hidden>
              {crossSvg}
              <span className={s.badge}>{no}</span>
            </span>
          )
        }
        const label = fillTemplate(open ? C.pendingCrossTitle : C.crossTitle, { n: no })
        return (
          <button
            key={i}
            type="button"
            className={cls}
            style={{ left: sl.plan.x * sW, top: sl.plan.y * sH }}
            title={label}
            aria-label={label}
            onPointerDown={crossDown(i)}
            onPointerMove={crossMove}
            onPointerUp={crossUp}
            onPointerCancel={crossUp}
            onPointerLeave={leave}
          >
            {crossSvg}
            <span className={s.badge}>{no}</span>
          </button>
        )
      })}
      {/* the marker popover — Verschieben / Punkt löschen / Behalten, anchored over the selected
          cross. Portalled and rAF-followed: the board moves under it without a React render. */}
      {armed && mode.sel?.side === 'plan' && createPortal(
        <PlanMarkerPopover mode={mode} boardRef={view.boardRef} />, document.body,
      )}
      {/* …and NOT during «Deckung prüfen»: coverage is inspection, nothing is placeable, and the
          Karte owns the whole screen — a plan magnifier portalled over it answers no question.
          ⚠️ `inset` portals into the PANE (the sheet's stage), not to the body: there the
          magnifier is the map half's own inset, in the same corner of the half being aimed at,
          and `position: absolute` needs the pane as its positioned parent (15.09.2026). */}
      {armed && !mode.check && mode.want === 'plan' && aim && !panning && !isPhone && createPortal(
        <PlanLoupe aim={() => aim.pt} boardRef={view.boardRef} />,
        (mode.loupe === 'inset' && view.canvasEl?.parentElement) || document.body,
      )}
      {/* …and on a PHONE the same magnifier, aimed at the fixed reticle rather than at a pointer
          there is none of. It was dropped when the fixed-target workflow arrived, on the grounds
          that a centred loupe was a second, ambiguous drag surface — true of a loupe UNDER the
          finger, not of an inset in the corner. Without it the sheet is placed blind: at the
          zoom where a whole Modul fits a phone screen, a house corner is three pixels wide. */}
      {armed && !mode.check && mode.want === 'plan' && isPhone && createPortal(
        <PlanLoupe aim={phonePlanAim} boardRef={view.boardRef} corner />, document.body,
      )}
    </>
  )
}

/**
 * The tapped cross's popover — the visible replacement for the old invisible «picked up» state,
 * whose only exits were Esc (invisible on touch), delete, or re-placing the point somewhere.
 * Three named ways out: «Verschieben» arms the re-place, «Punkt löschen» drops this ONE point,
 * «Behalten» (or a tap beside) changes nothing. Shared by both surfaces; each anchors it itself.
 */
export function GeorefPopoverCard({ mode, idx, side }: { mode: GeorefModeState; idx: number; side: GeorefSide }) {
  const C = appConfig.copy.whiteboard.georef
  const sl = mode.slots[idx]
  if (!sl) return null
  const open = side === 'plan' ? !sl.map : !sl.plan
  const fit = fitSimilarity(mode.pairs, mode.aspect)
  const pairIdx = georefPairIndex(mode, idx)
  // this point's own rest — only from three pairs on (georef · residualClaim's honesty rule)
  const r = !open && fit && fit.n >= 3 && pairIdx != null ? fit.residuals[pairIdx] : null
  const detail = open ? C.popOpen : r != null ? fillTemplate(C.popResidual, { m: r < 10 ? r.toFixed(1) : String(Math.round(r)) }) : null
  // `data-georef-pop` is how the outside-tap dismissal (GeorefModeBars) recognises the card's own
  // buttons — «Verschieben» must never be unpicked out from under itself.
  return (
    <div className={s.pop} data-georef-pop>
      <div className={s.popHead}>
        {fillTemplate(C.pointN, { n: georefSlotLabel(mode.slots, idx) })}
        <i>· {side === 'plan' ? C.checkPlan : C.checkMap}{detail ? ` · ${detail}` : ''}</i>
      </div>
      <div className={s.popActs}>
        <button type="button" onClick={() => georefDispatch({ type: 'beginMove' })}>
          <Icon id="move" />{C.popMove}
        </button>
        <button type="button" className={s.popWarn} onClick={() => georefDispatch({ type: 'remove', idx })}>
          <Icon id="trash" />{C.removePoint}
        </button>
      </div>
      {/* an open half can be paired BY HAND: this popover plus a tap on its counterpart */}
      {open && <div className={s.popHint}>{C.popPairHint}</div>}
      <Button variant="quiet" block className={s.popKeep} onClick={() => georefDispatch({ type: 'unpick' })}>{C.popKeep}</Button>
    </div>
  )
}

/**
 * Anchors the popover over the selected PLAN cross, in screen space.
 *
 * ⚠️ Its own rAF, like the phone loupe: the board pans and zooms through direct style writes
 * (PlanViewApi · applyView), so nothing re-renders when the cross moves under the card. Only
 * this little anchor repaints, once per frame, while it is open.
 */
function PlanMarkerPopover({ mode, boardRef }: { mode: GeorefModeState; boardRef: React.RefObject<HTMLDivElement | null> }) {
  const sel = mode.sel
  const pt = sel ? mode.slots[sel.idx]?.plan : undefined
  const [pos, setPos] = useState<{ x: number; y: number } | null>(null)
  useEffect(() => {
    let raf = 0
    const loop = () => {
      const r = boardRef.current?.getBoundingClientRect()
      const next = pt && r && r.width ? { x: r.left + pt.x * r.width, y: r.top + pt.y * r.height } : null
      // same place ⇒ same object, so an idle board costs no re-render per frame
      setPos((prev) => (prev && next && prev.x === next.x && prev.y === next.y ? prev : next))
      raf = requestAnimationFrame(loop)
    }
    raf = requestAnimationFrame(loop)
    return () => cancelAnimationFrame(raf)
  }, [boardRef, pt])
  if (!sel || !pos) return null
  // half the card's widest possible width (GeorefMode.module.css · .pop max-width), so a cross
  // near a screen edge still gets the whole popover rather than a clipped one
  const x = Math.min(Math.max(pos.x, 152), window.innerWidth - 152)
  // near the top edge the card flips below the cross instead of sliding off screen
  const below = pos.y < 170
  return (
    <div className={`${s.popAnchor} ${below ? s.popBelow : ''}`} style={{ left: x, top: pos.y }}>
      <GeorefPopoverCard mode={mode} idx={sel.idx} side="plan" />
    </div>
  )
}

/** The pictures the sheet is made of, in paint order: PlanTileLayer's tiles (underlay, retained,
 *  current) or pdf.js's base blit and refine crop (PdfViewport). Annotations are not part of it –
 *  the loupe magnifies the PLAN, which is what a reference point is read off. */
const SHEET_PICTURES = [pv['wb-tile'], pv['wb-pdf-base'], pv['wb-pdf-refine']].map((c) => `.${c}`).join(',')

/** The phone's plan aim: the fixed reticle, read every frame (never `place` – reading commits nothing). */
const phonePlanAim = () => peekGeorefPhoneTarget('plan')

/**
 * The plan-side magnifier: a crop of the sheet as it stands on screen, blown up `LOUPE_MUL`× around
 * the aim. On a phone the aim is the fixed reticle, elsewhere the pointer.
 *
 * It copies the pictures PdfViewport already painted (`SHEET_PICTURES`, through lib/planLoupe)
 * rather than rendering the PDF again — the cheapest possible magnifier, and the one that cannot
 * disagree with what is on screen. Deep zoom makes it soft (the tiles are sized for the viewport,
 * not for ×4), which is the honest trade: a soft magnifier that always matches beats a sharp one
 * that lags.
 *
 * ⚠️ ONE rAF loop for the loupe's whole life, reading the aim through a getter. It used to take
 * the aim as a prop: the phone's wrapper handed it a new object every frame, so the paint effect
 * re-ran every frame — re-allocating a 3×-dpr backing store, clearing it and binding a fresh
 * observer 60 times a second. The loop repaints only when something it shows has changed (the
 * aim, the board's box, a picture that finished loading), and never re-renders the plan tree —
 * the battery bug this app has already paid for once (see MapView · onView).
 */
function PlanLoupe({ aim, boardRef, corner = false }: {
  /** where the loupe looks, on the sheet; null = off the sheet, nothing to show */
  aim: () => PlanPt | null
  boardRef: React.RefObject<HTMLDivElement | null>
  corner?: boolean
}) {
  const ref = useRef<HTMLCanvasElement | null>(null)
  const aimRef = useRef(aim)
  useEffect(() => { aimRef.current = aim })
  // off the sheet ⇒ the circle goes away: an empty one would read as «nothing is there»
  const [off, setOff] = useState(false)

  useEffect(() => {
    let raf = 0, last = ''
    const loop = () => {
      raf = requestAnimationFrame(loop)
      const out = ref.current, board = boardRef.current
      if (!out || !board) return
      const pt = aimRef.current()
      setOff(!pt)
      if (!pt) { last = ''; return }
      const pics = [...board.querySelectorAll<HTMLImageElement | HTMLCanvasElement>(SHEET_PICTURES)]
      const px = (el: HTMLImageElement | HTMLCanvasElement) => el instanceof HTMLImageElement
        ? (el.complete ? [el.naturalWidth, el.naturalHeight] : [0, 0])
        : [el.width, el.height]
      const b = board.getBoundingClientRect()
      const w = out.clientWidth, h = out.clientHeight
      // the picture count and their pixel sizes stand in for «a tile arrived» / «the bake landed»
      const key = [pt.x, pt.y, b.left, b.top, b.width, b.height, w, h, ...pics.flatMap(px)].join()
      if (key === last) return
      last = key
      const ctx = out.getContext('2d'); if (!ctx) return
      // ⚠️ The FULL device pixel ratio, not a cap of 2: this inset is ~120px across on a phone
      // that paints 3 device px per CSS px. Resized only when it changes — a resize clears.
      const dpr = Math.min(window.devicePixelRatio || 1, 3)
      const bw = Math.round(w * dpr), bh = Math.round(h * dpr)
      if (out.width !== bw || out.height !== bh) { out.width = bw; out.height = bh }
      // ⚠️ AFTER the resize — setting width/height resets the whole 2D context, this flag included
      ctx.imageSmoothingQuality = 'high'
      ctx.clearRect(0, 0, bw, bh)
      const at = { x: b.left + pt.x * b.width, y: b.top + pt.y * b.height }
      const size = { w, h }
      // the paper first: a tile still loading is white on the glass (PdfViewport · .wb-tiles)
      ctx.fillStyle = '#fff'
      for (const d of planLoupeDraws(at, size, LOUPE_MUL, dpr, [{ left: b.left, top: b.top, width: b.width, height: b.height, pxW: 1, pxH: 1 }])) {
        ctx.fillRect(d.dx, d.dy, d.dw, d.dh)
      }
      const boxes = pics.map((el) => {
        const r = el.getBoundingClientRect(), [pxW, pxH] = px(el)
        return { left: r.left, top: r.top, width: r.width, height: r.height, pxW, pxH }
      })
      for (const d of planLoupeDraws(at, size, LOUPE_MUL, dpr, boxes)) {
        try {
          ctx.drawImage(pics[d.index], d.sx, d.sy, d.sw, d.sh, d.dx, d.dy, d.dw, d.dh)
        } catch { /* a torn-down picture mid-gesture — the rest of the crop still paints */ }
      }
    }
    raf = requestAnimationFrame(loop)
    return () => cancelAnimationFrame(raf)
  }, [boardRef])

  return (
    <div className={`${s.loupe} ${corner ? s.loupeCorner : ''}`} style={off ? { display: 'none' } : undefined} aria-hidden>
      <canvas ref={ref} style={{ width: '100%', height: '100%' }} />
      <span className={s.xh} />
      <span className={s.ring} />
    </div>
  )
}

/**
 * The Passung's dock — the frame around `GeorefQuality` (Whiteboard).
 * On a tablet a card one row above the chip that opened it; on a PHONE a slide-up bottom sheet
 * (29.09.2026, owner – docs/ui-conventions.md · «What a surface IS on a phone»): flush with the bottom edge and
 * both sides, over the two bars, the grab bar on top, pushed down to close (`useSwipeDismiss`,
 * the head is the handle). It stays NON-modal (no scrim, no trap), the dock's own rule: the plan
 * above is live, so a tap on a symbol is a tap on that symbol.
 * ⚠️ On the phone it PORTALS into the Einsatz's `.app` (the Meldeleiste's host): `.whiteboard`
 * is its own stacking context at `--z-surface`, and nothing inside it can cover the bars (z 35).
 */
export function GeorefDock({ label, onClose, children }: { label: string; onClose: () => void; children: ReactNode }) {
  const isPhone = useIsPhone()
  const host = useSyncExternalStore(subscribeMeldeleisteHost, getMeldeleisteHost, () => null)
  const swipe = useSwipeDismiss({ onClose, enabled: isPhone })
  const dock = (
    <div className="wb-georef-dock" role="group" aria-label={label} {...swipe}>
      <SheetGrab />
      {children}
    </div>
  )
  return isPhone && host ? createPortal(dock, host) : dock
}

/**
 * The seam — and ONLY the seam. It marks the boundary the split created, so it belongs to the
 * plan half, whose right edge IS that boundary.
 *
 * ⚠️ No labels. It carried two until 26.08.: «KARTE VERKNÜPFEN» along its length and «Karte ·
 * geliehen» in the borrowed corner. The first repeated the instrument bar across the foot of
 * both halves — one mode, one indicator. The second explained the LAYOUT («this map is on
 * loan»), which is the app talking about its own design: nobody in an Einsatz parses it, and it
 * answers a question the operator never asked. The dashed line says «two surfaces, one job»
 * without a word, and the bar says what to tap.
 *
 * ⚠️ No cross-seam pair lines either. One day of them (29.08.) was enough: with 4–5 pairs the
 * dashed bridges turned the split into a cat's cradle. The numbered badges on the crosses ARE
 * the pairing statement — «just markers are enough» (field decision 30.08.).
 */
export function GeorefSplitSeam() {
  return <div className={s.seam} />
}

/** The status the panel leads with: the Ampel line and — because the amber cross saying so may be
 *  on the surface a phone is not even showing — WHICH half is still open, or what the armed
 *  «Verschieben» is waiting for. One derivation for both form factors.
 *
 *  ⚠️ «Karte n · Modul m» only when the two DIFFER (15.09.). Equal counts are the normal case, so
 *  the line sat under every fit saying nothing, beside the Ampel that is the actual traffic
 *  light. Unequal counts mean a half is dangling — which is the warning the counter was for, and
 *  the only state in which it earns its place. `sub` is then empty, and both bars drop it. */
function georefStatus(mode: GeorefModeState, { planLabel, phone = false }: { planLabel?: string; phone?: boolean } = {}) {
  const C = appConfig.copy.whiteboard.georef
  const fit = fitSimilarity(mode.pairs, mode.aspect)
  const lamp = georefLamp(fit, mode)
  const mapN = georefSideCount(mode, 'map')
  const planN = georefSideCount(mode, 'plan')
  const counts = mapN === planN ? null : fillTemplate(C.sideProgress, { map: String(mapN), plan: String(planN) })
  // a phone does not tap the surface — it aims the reticle and presses «+», so its armed
  // «Verschieben» says that instead
  const sub = mode.move
    ? fillTemplate(phone ? C.movePhone : mode.move.side === 'plan' ? C.movePlan : C.moveMap, { n: georefSlotLabel(mode.slots, mode.move.idx) })
    : [counts, georefOpenHint(mode, planLabel)].filter(Boolean).join(' – ')
  // the folded quality detail behind the (i): the pair count, the claimable ⌀, and the one
  // instruction-shaped sentence (georefLamp body — what the next point should do)
  const claim = residualClaim(fit)
  // ⚠️ An APPROVED automatic fit reads «Verknüpft», not «ungemessen» (18.09.2026 — the station
  // published it; see georefMode · georefLamp). It still claims no ⌀: there is none to claim.
  // ⚠️ `approvedUntouched`, exactly as the Ampel reads it (lib/georef): a hand-set point beside
  // the Automatik is a correction in progress, and the fold value must not read «Verknüpft»
  // while the lamp two lines above it stands amber about the same fit.
  const approved = approvedUntouched(mode.pairs, !!mode.storageKey && incidentBindingApproved(mode.storageKey))
  const foldValue = fit
    ? hasAutoPairs(mode.pairs)
      ? approved ? C.chipLinked : C.chipAuto
      : claim == null ? C.chipTwoPoints : fillTemplate(C.chipResidual, { m: claim.toFixed(1) })
    : null
  return { lamp, sub, foldPairs: `${mode.pairs.length} ${C.pairs}`, foldValue, foldBody: lamp.body }
}

/** «Alle Punkte zurücksetzen» — the one destructive action inside the running mode, behind the
 *  app's confirm. Shared by the desktop instrument and the phone bar, so the two cannot end up
 *  asking differently (or one of them not asking at all). */
async function clearGeorefPoints() {
  const C = appConfig.copy.whiteboard.georef
  const ok = await confirmDialog({
    title: C.clearTitle,
    message: C.clearBody,
    confirmLabel: C.clearPoints,
    cancelLabel: C.cancel,
    danger: true,
  })
  if (ok) georefDispatch({ type: 'clear' })
}

/** The Karte↔Modul opacity slider of the coverage view. The app's own `Slider` (20.10.2026, UX
 *  sweep M3), the one the Ebenen' Deckkraft wears. */
function CheckBlend({ mode }: { mode: GeorefModeState }) {
  const C = appConfig.copy.whiteboard.georef
  const pct = Math.round(mode.checkOpacity * 100)
  return (
    <div className={s.checkBlend}>
      <span aria-hidden>{C.checkMap}</span>
      <Slider
        value={pct} min={0} max={100} step={5}
        ariaLabel={C.checkOpacity} valueText={`${pct} %`}
        onChange={(v) => georefDispatch({ type: 'checkOpacity', opacity: v / 100 })}
      />
      <span aria-hidden>{C.checkPlan}</span>
    </div>
  )
}

function GeorefActions({ mode, onReset }: { mode: GeorefModeState; onReset?: () => void }) {
  const C = appConfig.copy.whiteboard.georef
  // Coverage is a full-screen visual comparison, not another point-placement step. Its bar is
  // intentionally one line: blend the two pictures, then return to the exact map/plan side the
  // operator came from. Finishing the alignment remains a separate, deliberate action.
  if (mode.check) {
    return (
      <>
        <CheckBlend mode={mode} />
        <button className={`btn primary ${s.finishAction}`} onClick={() => georefDispatch({ type: 'finishCheck' })}>
          <Icon id="check" />{C.done}
        </button>
      </>
    )
  }
  const done = mode.pairs.length >= 2 && georefOpenCount(mode) === 0
  return (
    <>
      {/* «Verschieben» armed: the visible way to put the cross back down — Esc alone is not an
          exit on the tablet this mode was built for. Deleting the point stays in the popover. */}
      {mode.move
        ? (
          <button className={`btn ${s.resetAction}`} onClick={() => georefDispatch({ type: 'unpick' })}>
            <Icon id="close" />{C.popKeep}
          </button>
        )
        // …offered as soon as ANYTHING stands, open halves included. Gated on `pairs` alone,
        // a mode full of unmatched points (28.08.: nine of them, courtesy of the tap-double-fire
        // bug) had NO way to start over — only «Punkt löschen», one by one.
        //
        // ⚠️ With an `onReset` the pairs are somebody's DRAFT (the admin's plan editor), so this
        // throws the draft away instead of deleting points, and asks nothing: what it restores is
        // what is stored. It then stands whatever the draft holds — an emptied draft is exactly
        // the state that needs it most.
        : (onReset != null || mode.slots.length > 0)
          && <button className={`btn warn ${s.resetAction}`} onClick={() => onReset ? onReset() : void clearGeorefPoints()}><Icon id="trash" />{C.clearPoints}</button>}
      {/* «Deckung prüfen» — the sheet's own outline, laid on the map. The check belongs HERE
          because this is the one screen where both pictures are up at once. */}
      {!mode.move && mode.pairs.length >= 2 && (
        <button className={`btn link ${s.checkAction}${mode.check ? ' on' : ''}`} aria-pressed={mode.check}
          onClick={() => georefDispatch({ type: 'check', on: !mode.check })}><Icon id="eye" />{C.checkFit}</button>
      )}
      {/* One way out, with the word matching what it does. Once a usable fit stands it says so
          («Fertig»); before that it is «Schliessen».
          ⚠️ NOT «Abbrechen», which it said until 27.08. and never once did: pairs are saved as
          they are placed (georefMode · the debounced save), so leaving keeps every one of them.
          Somebody who pressed it to get rid of a crooked alignment found the plan georeferenced
          anyway. Throwing the points away is «Alle Punkte zurücksetzen», and that one asks. */}
      <button className={`btn ${s.finishAction} ${done ? 'primary' : ''}`}
        onClick={() => endGeorefMode()}>
        <Icon id={done ? 'check' : 'close'} />
        {done ? C.done : C.closeMode}
      </button>
    </>
  )
}

/**
 * The armed mode ON A TABLET OR DESKTOP: one bar across the whole foot of the screen.
 *
 * ⚠️ ONE indicator, and it is a STATUS line first (the decided «minimal» panel, 29.08.): the
 * Ampel head with the per-surface counts and the one open half named, a single free-order
 * instruction, and the quality detail folded behind the (i) — the amber dot is what makes the
 * fold findable without being open. It spans the plan half AND the borrowed map half (`.pill`
 * is fixed; see the stylesheet), because that is exactly the extent of what the mode owns.
 *
 * It is rendered INSIDE the plan's `.wb-botleft` row — the row the chip that armed it lives in,
 * which shows nothing else while the mode runs — and positioned out of it. The phone does the
 * mirror image in GeorefModeBars: same content, in the tool bar's lane.
 */
export function GeorefInstrument({ mode, inline = false, onReset }: { mode: GeorefModeState
  /** in the flow of its container instead of pinned to the viewport — the admin's plan editor
   *  mounts the same instrument below its two panes */
  inline?: boolean
  /** replaces «Zurücksetzen»'s meaning where the pairs are a draft rather than the stored
   *  georeference: the admin's editor discards its draft instead of deleting every point */
  onReset?: () => void }) {
  const C = appConfig.copy.whiteboard.georef
  const [detail, setDetail] = useState(false)
  const st = georefStatus(mode)
  return (
    <div className={`${s.pill}${inline ? ` ${s.pillInline}` : ''}`} role="status" aria-label={C.title}>
      <span className={`${s.dot} ${s[`dot_${st.lamp.tone}`]}`} />
      <span className={s.pillText}>
        {/* the one instruction. No per-point prompt: the free order means the app no longer
            knows better than the operator which surface is «next». */}
        <span className={s.promptText}>{mode.check
          ? C.checkFit
          : mode.move ? st.sub : C.freeOrderTap}</span>
        {!mode.check && (
          <span className={`${s.lampLine} ${s[`lampLine_${st.lamp.tone}`]}`}>
            <b>{st.lamp.head}</b>{!mode.move && st.sub ? <>{' · '}<i>{st.sub}</i></> : null}
          </span>
        )}
        {/* the quality detail, the (rewritten, instruction-shaped) warning AND — since the
            instruction itself is one short sentence — what makes a good point, live behind the (i) */}
        {!mode.check && detail && <>
          <span className={s.promptHint}>{st.foldBody}</span>
          <span className={s.promptHint}>{C.freeOrderTip}</span>
        </>}
      </span>
      {!mode.check && (
        <InfoToggle className={s.infoBtn} open={detail} onToggle={() => setDetail((v) => !v)} label={C.detailsTitle} />
      )}
      <span className={s.acts}><GeorefActions mode={mode} onReset={onReset} /></span>
    </div>
  )
}

/**
 * The armed mode ON A PHONE: one slim bar in the tool bar's lane (sweep 27.10.2026 #13, the
 * owner's pick «A»): the status «n/2 Paare» · the Karte | plan switch with each half's count · a
 * round «+». «Schliessen» (✓ «Fertig» once a fit stands) sits top right, the loupe bottom left
 * just above the bar, by the thumb.
 *
 * ⚠️ The instruction lives behind the STATUS, not under the button. It used to be a sentence below
 * «Punkt setzen» («Wirkt auf der sichtbaren Fläche …») that said where the button acts and not
 * what to do; the owner had to guess the steps. Now the status is the ⓘ: it opens the steps in
 * the order they are done (set it on the plan, the same spot on the Karte, twice, order free), the
 * quality once there is a fit, and the two rarer actions (Deckung prüfen, Alle Punkte
 * zurücksetzen). Counting to «/2» because two pairs link the plan; the third is offered there
 * as the optional check it is.
 *
 * ⚠️ Rendered by the APP SHELL, not by either surface — the mode spans both, and on a phone the
 * plan is unmounted while the map takes the second half of every pair. A prompt that vanished at
 * exactly that moment would leave the operator on a map with no idea why it was showing.
 *
 * Renders nothing on a wider screen: there the chip IS the instrument (GeorefInstrument), and
 * two indicators at once is the thing this component exists NOT to be.
 */
export function GeorefModeBars({ planLabel }: { planLabel?: string }) {
  const mode = useGeorefMode()
  const isPhone = useIsPhone()
  // Esc lives here too, for the same reason: on the Karte surface the plan's own keyboard
  // handler is not mounted, and «the way out» must not depend on which half you are in.
  useGeorefEscape(!!mode.planId, mode.check, !!mode.move || !!mode.sel)
  const C = appConfig.copy.whiteboard.georef
  const shownSurface = mode.check ? 'map' : mode.want
  // the dock: the bar plus whatever stands on it (the steps, the armed «Verschieben»). Its top is
  // where the reticle's free band ends and what the loupe stands on (`--georef-dock-clear`).
  const barRef = useRef<HTMLDivElement | null>(null)
  const [fixedTarget, setFixedTarget] = useState<{ x: number; y: number } | null>(null)
  const [topbarBottom, setTopbarBottom] = useState<number | null>(null)
  // The steps + quality behind the status. ⚠️ Sticky while open: whoever opened it is reading,
  // and having it snap shut after every point would be the app deciding they were done. It
  // starts closed on every fresh arming.
  const [detail, setDetail] = useState(false)

  useEffect(() => {
    if (!mode.planId || !isPhone) return
    let frame = 0
    const surfaceSelector = shownSurface === 'map' ? '.maplibregl-map' : '.wb-canvas'
    const root = document.documentElement
    const measure = () => {
      cancelAnimationFrame(frame)
      frame = requestAnimationFrame(() => {
        const bar = barRef.current?.getBoundingClientRect()
        const top = document.querySelector('.topbar')?.getBoundingClientRect().bottom
        setTopbarBottom(top ?? null)
        // the loupe stands on the dock, whatever it currently holds (GeorefMode.module.css · .loupeCorner)
        if (bar) root.style.setProperty('--georef-dock-clear', `${Math.round(window.innerHeight - bar.top)}px`)
        const surface = document.querySelector<HTMLElement>(surfaceSelector)?.getBoundingClientRect()
        if (!surface || !bar || mode.check) { setFixedTarget(null); return }
        setFixedTarget(georefPhoneTargetPoint(surface, { top, bottom: bar.top }))
      })
    }
    measure()
    const observed = [document.querySelector<HTMLElement>(surfaceSelector), barRef.current].filter(Boolean) as HTMLElement[]
    const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(measure) : null
    observed.forEach((el) => ro?.observe(el))
    window.addEventListener('resize', measure)
    window.visualViewport?.addEventListener('resize', measure)
    return () => {
      cancelAnimationFrame(frame)
      ro?.disconnect()
      window.removeEventListener('resize', measure)
      window.visualViewport?.removeEventListener('resize', measure)
      root.style.removeProperty('--georef-dock-clear')
    }
  }, [isPhone, mode.check, mode.planId, shownSurface])

  // ⚠️ On a PHONE nothing puts the marker popover away by itself. The two reducer branches that
  // do it (georefMode · planTap / mapTap · «popover open on this surface: a tap beside it puts it
  // away») are never reached here: the plan's capture layer deliberately places nothing on a
  // phone tap (the fixed reticle commits instead) and the map's tap handler is desktop-only. So
  // the card sat there — over the very corner somebody was trying to see — with «Behalten» and
  // Esc as its only exits, and Esc is not a thing on glass.
  //
  // Capture phase, because the plan's capture layer stops propagation on `pointerdown`. The card
  // itself and the crosses own their taps; everything else on the surface dismisses.
  useEffect(() => {
    if (!isPhone || !mode.planId || !mode.sel) return
    const onDown = (e: PointerEvent) => {
      const el = e.target instanceof Element ? e.target : null
      if (el?.closest(`[data-georef-pop], .${s.cross}`)) return
      georefDispatch({ type: 'unpick' })
    }
    window.addEventListener('pointerdown', onDown, true)
    return () => window.removeEventListener('pointerdown', onDown, true)
  }, [isPhone, mode.planId, mode.sel])

  if (!mode.planId || !isPhone) return null
  const st = georefStatus(mode, { planLabel, phone: true })
  const n = mode.pairs.length
  const open = georefOpenCount(mode)
  const done = n >= 2 && open === 0
  const onPlan = georefOnPlan(planLabel)
  const place = () => {
    if (!placeGeorefPhoneTarget(shownSurface)) toast(C.targetOutside, { icon: 'warn', tone: 'warn' })
  }
  // the status: «n/2» up to the two pairs that link the plan, then just the count; under it what
  // is outstanding (amber), «Paare» while counting, «Verknüpft» once it stands
  const head = n <= 2 ? `${n}/2` : String(n)
  const sub = open ? fillTemplate(C.barOpen, { n: String(open) }) : n < 2 ? C.pairs : C.chipLinked
  return (
    <>
    {!mode.check && fixedTarget && (
      <div className={s.fixedTarget} style={{ left: fixedTarget.x, top: fixedTarget.y }} aria-hidden>
        {crossSvg}
      </div>
    )}
    {/* the way out, top right under the TopBar — the word matches what it does: «Schliessen»,
        never «Abbrechen» (see the same button in GeorefActions), and «Fertig» once a fit stands.
        Hidden during «Deckung prüfen», whose own bar carries its «Fertig». */}
    {!mode.check && (
      <button type="button" className={`${s.exitPill} ${done ? s.exitDone : ''}`}
        style={topbarBottom != null ? { top: topbarBottom + 10 } : undefined}
        onClick={() => endGeorefMode()}>
        <Icon id={done ? 'check' : 'close'} />{done ? C.done : C.closeMode}
      </button>
    )}
    <div ref={barRef} data-georef-controls className={s.dock}>
      {/* ── the steps, the quality and the two rarer actions, behind the status ── */}
      {!mode.check && detail && (
        <div className={s.fold} id="georef-how">
          <b className={s.foldTitle}>{C.howTitle}</b>
          {st.sub && !mode.move && <p className={s.foldOpen}>{st.sub}</p>}
          <ol className={s.steps}>
            <li>{fillTemplate(C.howStep1, { onPlan })}</li>
            <li>{C.howStep2}</li>
            <li>{C.howStep3}</li>
          </ol>
          <p className={s.foldNote}>{C.howOrder}</p>
          <p className={s.foldNote}>{C.howThird}</p>
          {st.foldValue && <div className={s.qrow}><span>{st.foldPairs}</span><strong>{st.foldValue}</strong></div>}
          {n >= 2 && <p className={s.foldNote}>{st.foldBody}</p>}
          {(n >= 2 || mode.slots.length > 0) && !mode.move && (
            <div className={s.foldActs}>
              {n >= 2 && (
                <button type="button" className={`btn link ${s.quietBtn}`}
                  onClick={() => georefDispatch({ type: 'check', on: true })}><Icon id="eye" />{C.checkFit}</button>
              )}
              {/* open halves count too — a card full of unmatched points must not strand the
                  operator without a «start over» */}
              {mode.slots.length > 0 && (
                <button type="button" className={`btn link ${s.quietBtn} ${s.quietWarn}`} onClick={() => void clearGeorefPoints()}>
                  <Icon id="trash" />{C.clearPoints}
                </button>
              )}
            </div>
          )}
        </div>
      )}
      {/* ── an armed «Verschieben»: what the next «+» does, and the visible way to put the cross
          back down — Esc must never be the only exit, least of all on glass ── */}
      {!mode.check && mode.move && (
        <div className={s.moveNote} role="status">
          <span>{st.sub}</span>
          <button type="button" className={`btn link ${s.quietBtn}`} onClick={() => georefDispatch({ type: 'unpick' })}>
            <Icon id="close" />{C.popKeep}
          </button>
        </div>
      )}
      <div className={s.bar} role="status" aria-label={C.title}>
        {mode.check
          ? <span className={s.acts}><GeorefActions mode={mode} /></span>
          : <>
            {/* the status IS the ⓘ: one 54×64 target instead of a 12px glyph beside a word */}
            <button type="button" className={s.stat} aria-expanded={detail} aria-controls="georef-how"
              aria-label={`${head} ${sub} – ${C.howTitle}`} onClick={() => setDetail((v) => !v)}>
              <span className={s.statHead}><span className={`${s.sdot} ${s[`sdot_${st.lamp.tone}`]}`} />{head}</span>
              <small className={open ? s.statOpen : n >= 2 ? s[`statTone_${st.lamp.tone}`] : undefined}>
                {sub}{!open && <Icon id="info" />}
              </small>
            </button>
            {/* the two surfaces of this one task, each with its count. Never disabled — free
                order means there is no wrong surface to be on. */}
            <div className={s.surfaceSwitch}>
              <Segmented ariaLabel={C.title} value={shownSurface}
                onChange={(v) => georefDispatch({ type: v === 'map' ? 'goMap' : 'goPlan' })}
                options={[
                  { value: 'map', label: <><Icon id="map" />{appConfig.copy.navRail.map}<span className={s.surfaceCount} aria-hidden>{georefSideCount(mode, 'map')}</span></> },
                  { value: 'plan', label: <><Icon id="doc" /><span className={s.surfaceName}>{planLabel ?? C.checkPlan}</span><span className={s.surfaceCount} aria-hidden>{georefSideCount(mode, 'plan')}</span></> },
                ]} />
            </div>
            {/* the one thing that ADDS: places at the reticle on whichever surface is up — the
                pairing is the reducer's job, so the button carries no number that could lie */}
            <button type="button" className={s.fab} aria-label={C.placePoint} title={C.placePoint} onClick={place}>
              <Icon id="plus" />
            </button>
          </>}
      </div>
    </div>
    </>
  )
}
