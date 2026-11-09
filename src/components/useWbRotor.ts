import { useEffect, useRef, useState } from 'react'
import type React from 'react'
import type { BoardAnno, BoardTool } from '../types'
import { appConfig } from '../config/appConfig'
import { buzz } from '../lib/haptics'
import { MAGNET_DWELL_MS, MAGNET_RADIUS_PX } from '../lib/lineAttachments'
import { SHAPE_AXIS_GRIPS, SHAPE_DEFS, SHAPE_FREE_ASPECT, SHAPE_MAX_N, SHAPE_MIN_N, rotationBoundsN, rotationBox, rotationGripOffPx, rotationRun, shapeAspect, shapeAspectMax } from '../lib/shapes'
import { freeResizeLocal, rotationEnd, rotationEndDeg, rotorDeg } from '../lib/rotorMath'

/** How far an Absperrkreis may be dragged out on a plan, in plan-width fractions: twice the
 *  sheet. A cordon legitimately reaches past the paper (the Karte's radius stepper caps at
 *  100 km for the same reason), so the ceiling is only there to stop a runaway drag. */
export const CIRCLE_MAX_N = 2

interface Args {
  /** the ARMED tool as the board reads it (a select-only surface reads 'pan') */
  tool: BoardTool
  readOnly: boolean
  annos: BoardAnno[]
  boardRef: React.RefObject<HTMLDivElement | null>
  /** the board's placement press in flight (usePlanCreate · inkDown) — a claim made under it pauses the pan */
  inkTap: React.RefObject<unknown>
  toNorm: (clientX: number, clientY: number) => [number, number] | null
  localY: (y: number, floor: number) => number
  mapY: (floor: number | undefined, ly: number) => number
  sW: number
  /** the Rotation's length ceiling and width on this sheet (lib/shapes · rotationBoundsN) */
  rotN: ReturnType<typeof rotationBoundsN>
  /** the board document's funnel (useBoardDoc): checkpoint, silent write */
  pushPast: () => void
  patch: (id: string, p: Partial<BoardAnno>) => void
  emit: (op: string, payload?: Record<string, unknown>) => void
  activeId: string
  onStepEnd?: () => void
}

/**
 * The on-object turn and size grips of the plan, lifted out of the Whiteboard (23.09.2026): the
 * rotor knob(s) of a directional symbol or composite, the Hubretter cage, a Form's resize grips,
 * an Absperrkreis's radius grip, a Rotation's two ends — and the Rotation's claim ring («Halten,
 * dann verbindet es») that both its placement taps and its end drags ride. One gesture is one
 * undo step (checkpoint on the first move) and one board.edit on release.
 *
 * The state, refs and the dwell timer's unmount cleanup moved in together and in their original
 * order, and the hook is called where they used to be declared, so the effect order is
 * unchanged. The handlers are the former inline ones, unchanged, re-created on every render with
 * that render's values (no memo).
 */
export function useWbRotor({ tool, readOnly, annos, boardRef, inkTap, toNorm, localY, mapY, sW, rotN, pushPast, patch, emit, activeId, onStepEnd }: Args) {
  // drag-to-rotate a selected directional symbol — mirrors the map's rotor handle
  // `rot` = the shape's rotation at grab time and `free` = per-axis resize allowed — captured
  // on pointer-down so a corner drag can be resolved in the shape's own rotated frame
  const rotate = useRef<{
    id: string; cx: number; cy: number; moved: boolean
    mode: 'rotate' | 'rotate2' | 'resize' | 'sizeY' | 'cage' | 'radius' | 'endA' | 'endB'
    rot: number; free: boolean; keepHeightN: number | null; aspectMax: number; maxN: number
    /** the shape's storey — stored y is storey-LOCAL (floorGeometry · localY), so every write
     *  of a board-global coordinate has to come back through it */
    floor: number
    /** end drags only: the end that stays put (client px) and how far the grip floats past the cap */
    fixed: { x: number; y: number } | null; gripOffPx: number
  } | null>(null)

  // --- drag-to-rotate a selected directional symbol (rotor handle) ---
  // ── «Halten, dann verbindet es», an einer Rotation ───────────────────────────────────────
  // The plan twin of the map's claim (MapMarkers · trackEndMagnet / usePlaceMagnet · trackPlaceMagnet),
  // down to the same chip, the same ring and the same rule: the point keeps following the finger
  // while the ring fills, and only a FULL ring puts it on the symbol. It serves both moments a
  // Rotation has — laying one of its two points down, and dragging an end afterwards — because
  // they are the same question asked twice.
  //
  // Nothing is STORED by it: a Rotation carries no attachment field and deliberately none. What
  // it buys is exactness — the run starts on the Wasserbezug's own spot rather than beside it —
  // and it says so before it does it.
  const [rotMagnet, setRotMagnet] = useState<{ x: number; y: number; floor: number; since: number; armed: boolean } | null>(null)
  const rotMagnetRef = useRef<{ key: string; x: number; y: number; floor: number; since: number; armed: boolean } | null>(null)
  const rotDwellTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  /** Board pan paused while a placement claim is live — the map does exactly this
   *  (MapView · placePanPaused): a finger holding still for the MAGNET_DWELL_MS dwell wobbles
   *  past the tap threshold, and the pan that started killed the claim AND discarded the tap, so
   *  on a real device the ring could never be ridden to the end. Paused, the full
   *  MAGNET_RADIUS_PX is the wobble budget; leaving the ring clears the claim and hands the pan
   *  back. Only the placement press pauses anything — an end drag owns its pointer already. */
  const rotPanPaused = useRef(false)
  const clearRotMagnet = () => {
    if (rotDwellTimer.current) { clearTimeout(rotDwellTimer.current); rotDwellTimer.current = null }
    if (rotMagnetRef.current) { rotMagnetRef.current = null; setRotMagnet(null) }
    rotPanPaused.current = false
  }
  useEffect(() => () => { if (rotDwellTimer.current) clearTimeout(rotDwellTimer.current) }, [])
  /** Track the claim under a point and answer with the symbol it has actually taken — `null`
   *  until the ring has closed. `pt` is in the client px both gestures work in. */
  const claimRotTarget = (pt: { x: number; y: number }, skipId?: string) => {
    const r = boardRef.current?.getBoundingClientRect()
    if (!r || !r.width) { clearRotMagnet(); return null }
    let best: { a: BoardAnno; d: number } | null = null
    for (const a of annos) {
      if (a.id === skipId || (a.kind !== 'symbol' && a.kind !== 'resource')) continue
      if (a.x == null || a.y == null) continue
      // mapY folds the sheet's own y into the stack's, so a claim lands on the floor it is drawn on
      const x = r.left + a.x * r.width, y = r.top + mapY(a.floor, a.y) * r.height
      const d = Math.hypot(x - pt.x, y - pt.y)
      if (d < MAGNET_RADIUS_PX && (!best || d < best.d)) best = { a, d }
    }
    if (!best) { clearRotMagnet(); return null }
    const cur = rotMagnetRef.current
    if (cur?.key !== best.a.id) {
      clearRotMagnet()
      const st = { key: best.a.id, x: best.a.x ?? 0, y: best.a.y ?? 0, floor: best.a.floor ?? 0, since: Date.now(), armed: false }
      rotMagnetRef.current = st
      if (inkTap.current) rotPanPaused.current = true // a placement press: hold the board still
      setRotMagnet({ ...st })
      // arm on a motionless finger — there is no pointermove to advance a dwell by itself
      rotDwellTimer.current = setTimeout(() => {
        const now = rotMagnetRef.current
        if (!now || now.key !== st.key) return
        now.armed = true
        setRotMagnet({ ...now })
        buzz()
      }, MAGNET_DWELL_MS)
      return null
    }
    return cur.armed ? cur : null
  }
  /** the same claim, answered in the client px an end drag needs */
  const trackEndMagnet = (id: string, pt: { x: number; y: number }) => {
    const hit = claimRotTarget(pt, id)
    const r = boardRef.current?.getBoundingClientRect()
    if (!hit || !r || !r.width) return null
    return { x: r.left + hit.x * r.width, y: r.top + mapY(hit.floor, hit.y) * r.height }
  }

  // angle from the glyph centre to the pointer becomes the rotation (+90° so the
  // top knob leads); the whole gesture is one undo step (checkpoint on first move).
  const rotDown = (e: React.PointerEvent, id: string, mode: 'rotate' | 'rotate2' | 'resize' | 'sizeY' | 'cage' | 'radius' | 'endA' | 'endB' = 'rotate') => {
    if (tool !== 'pan' || readOnly) return
    e.stopPropagation()
    const a = annos.find((x) => x.id === id)
    const shp = a?.kind === 'shape' ? (a.shape ?? 'square') : null
    let cx: number, cy: number
    if (mode === 'radius') {
      // an Absperrkreis is ink, not a `.wb-anno` chip: its centre is the stored point, read
      // through the same board rect every other plan gesture works in
      const rect = boardRef.current?.getBoundingClientRect()
      if (!rect?.width || !a) return
      cx = rect.left + (a.x ?? 0) * rect.width; cy = rect.top + mapY(a.floor, a.y ?? 0) * rect.height
    } else {
      const anno = (e.currentTarget as HTMLElement).closest('.wb-anno')
      const glyph = (anno?.querySelector('.ts, .shape-glyph') ?? anno) as HTMLElement | null
      if (!glyph) return
      const r = glyph.getBoundingClientRect()
      cx = r.left + r.width / 2; cy = r.top + r.height / 2
    }
    // ── the two ends of a Rotation (lib/shapes · SHAPE_TWO_POINT) ──────────────────────────
    // Identical to the Lage map (MapMarkers · shapeDown), in plan space: dragging one end pins
    // the other, so the grip sets the run's length and its bearing at once.
    let fixed: { x: number; y: number } | null = null
    let gripOffPx = 0
    if ((mode === 'endA' || mode === 'endB') && a) {
      const size = a.sizeN ?? SHAPE_DEFS.rotation.defaultSizeN
      const half = (rotationRun(size, a.aspect) * sW) / 2
      const rad = ((a.rotation ?? 0) * Math.PI) / 180
      const away = mode === 'endA' ? 1 : -1 // the end that stays put is the far one
      fixed = { x: cx + Math.cos(rad) * half * away, y: cy + Math.sin(rad) * half * away }
      gripOffPx = rotationGripOffPx(size * shapeAspect('rotation', a.aspect) * sW)
    }
    rotate.current = {
      id, cx, cy, moved: false, mode, fixed, gripOffPx,
      rot: a?.rotation ?? 0, floor: a?.floor ?? 0,
      free: (mode === 'resize' || mode === 'sizeY') && !!shp && SHAPE_FREE_ASPECT[shp],
      // One grip per axis: capture whichever axis the drag must LEAVE ALONE — the ↔ keeps the
      // height, the ↕ keeps the length. Identical to the Lage map (MapMarkers · shapeDown).
      keepHeightN: !shp || !SHAPE_AXIS_GRIPS[shp] ? null
        : mode === 'sizeY'
          ? Math.max(0.005, a?.sizeN ?? SHAPE_DEFS[shp].defaultSizeN)
          : Math.max(0.005, (a?.sizeN ?? SHAPE_DEFS[shp].defaultSizeN) * shapeAspect(shp, a?.aspect)),
      aspectMax: shp ? shapeAspectMax(shp) : 5,
      // a Wasserpendel spans the plan; every other form stays inside the ordinary cap
      // (lib/shapes · SHAPE_MAX_N — the same number the ± stepper clamps to). The loop's ceiling
      // is 20 km of GROUND, so on a scaled sheet it is that distance in the sheet's unit.
      maxN: shp === 'rotation' ? rotN.maxN : SHAPE_MAX_N[shp ?? 'square'],
    }
    ;(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId)
  }
  const rotMove = (e: React.PointerEvent) => {
    const st = rotate.current; if (!st) return
    if (!st.moved) { pushPast(); st.moved = true } // one checkpoint per rotate/resize gesture
    if ((st.mode === 'endA' || st.mode === 'endB') && st.fixed) {
      // One end moves, the other stays: position, length, bearing and width all fall out of the
      // pair (lib/shapes · rotationBox). Same maths as the map, in plan-width fractions.
      const f = st.fixed
      // the grip floats past the cap, so the END is the pointer pulled back along the run
      let { x: ex, y: ey } = rotationEnd({ x: e.clientX, y: e.clientY }, f, st.gripOffPx)
      const snap = trackEndMagnet(st.id, { x: ex, y: ey })
      if (snap) { ex = snap.x; ey = snap.y }
      const runN = Math.max(SHAPE_MIN_N, Math.min(st.maxN, Math.hypot(ex - f.x, ey - f.y) / sW))
      const box = rotationBox(runN, rotN.w)
      const mid = toNorm((f.x + ex) / 2, (f.y + ey) / 2)
      if (!mid) return
      patch(st.id, {
        // toNorm is board-global; stored y is storey-local — on a floor stack the raw value
        // would multiply through mapY and teleport the loop down the stack
        x: mid[0], y: localY(mid[1], st.floor),
        rotation: rotationEndDeg(st.mode, f, { x: ex, y: ey }),
        sizeN: box.size,
        aspect: Math.round(box.aspect * 1000) / 1000,
      })
      return
    }
    if (st.mode === 'resize' || st.mode === 'sizeY') {
      if (st.free) {
        // free-aspect drag: the pointer offset, rotated into the shape's own frame, gives the
        // two axes independently — identical maths to the map (MapMarkers · shapeMove), in plan
        // space, so a Form feels the same on both surfaces.
        const { lx, ly } = freeResizeLocal({ x: e.clientX, y: e.clientY }, { x: st.cx, y: st.cy }, st.rot)
        // ⚠️ A fraction of the PLAN, not screen px (lib/shapes · SHAPE_MIN_N): the plan zooms too,
        // and a pixel floor would store a different share of the sheet at every zoom.
        const minN = SHAPE_MIN_N
        if (st.keepHeightN != null) {
          // ── one grip, one axis (lib/shapes · SHAPE_AXIS_GRIPS) ──
          const asp = (h: number, len: number) =>
            Math.max(0.02, Math.min(st.aspectMax, Math.round((h / len) * 1000) / 1000))
          if (st.mode === 'sizeY') {
            const len = st.keepHeightN // captured LENGTH
            const hN = Math.max(minN, Math.min(len * st.aspectMax, (2 * Math.abs(ly)) / sW))
            patch(st.id, { sizeN: len, aspect: asp(hN, len) })
            return
          }
          const hN = st.keepHeightN // captured HEIGHT
          const len = Math.max(Math.max(minN, hN / st.aspectMax), Math.min(st.maxN, (2 * Math.abs(lx)) / sW))
          patch(st.id, { sizeN: len, aspect: asp(hN, len) })
          return
        }
        // the Rauch keeps its diagonal corner: both axes at once
        const wN = Math.max(minN, Math.min(st.maxN, (2 * Math.abs(lx)) / sW))
        const hN = Math.max(minN, Math.min(st.maxN, (2 * Math.abs(ly)) / sW))
        patch(st.id, { sizeN: wN, aspect: Math.max(0.2, Math.min(5, Math.round((hN / wN) * 100) / 100)) })
        return
      }
      // corner grip = half-diagonal from the glyph centre → full width, normalized to the
      // (scaled) plan width — same maths as the map's shape resize, in plan space
      const dist = Math.hypot(e.clientX - st.cx, e.clientY - st.cy)
      // …and the same floor for a proportional shape (the Pfeil)
      patch(st.id, { sizeN: Math.max(SHAPE_MIN_N, Math.min(st.maxN, (dist * Math.SQRT2) / sW)) })
      return
    }
    if (st.mode === 'radius') {
      // Absperrkreis: the grip rides the ring, so the pointer's distance from the centre IS the
      // radius — the same «drag from the centre outward» the placement gesture used, in
      // plan-width fractions (types · BoardAnno.radiusN)
      const rect = boardRef.current?.getBoundingClientRect(); if (!rect?.width) return
      patch(st.id, { radiusN: Math.max(appConfig.drawing.circleMinRadiusN, Math.min(CIRCLE_MAX_N, Math.hypot(e.clientX - st.cx, e.clientY - st.cy) / rect.width)) })
      return
    }
    if (st.mode === 'cage') {
      // Hubretter cage tip: one handle sets the boom bearing (rotation2, no offset — the handle IS the
      // tip) AND the reach as a fraction of the (scaled) plan width — the plan analogue of reachM.
      const dist = Math.hypot(e.clientX - st.cx, e.clientY - st.cy)
      patch(st.id, { rotation2: rotorDeg({ x: e.clientX, y: e.clientY }, { x: st.cx, y: st.cy }, 'aim'), reachN: Math.max(0.03, Math.min(0.6, dist / sW)) })
      return
    }
    // body knob at the top (+90), fan knob at the BOTTOM (−90) — opposite sides, easy to grab apart
    const val = rotorDeg({ x: e.clientX, y: e.clientY }, { x: st.cx, y: st.cy }, st.mode === 'rotate2' ? 'rotate2' : 'rotate')
    patch(st.id, st.mode === 'rotate2' ? { rotation2: val } : { rotation: val })
  }
  const rotUp = () => {
    const st = rotate.current; rotate.current = null
    clearRotMagnet()
    onStepEnd?.()
    if (!st?.moved) return
    const a = annos.find((x) => x.id === st.id)
    if (!a) return
    const patchOut = st.mode === 'endA' || st.mode === 'endB'
        ? { x: a.x, y: a.y, rotation: a.rotation, sizeN: a.sizeN, aspect: a.aspect }
      : st.mode === 'resize' || st.mode === 'sizeY' ? { sizeN: a.sizeN, aspect: a.aspect }
      : st.mode === 'radius' ? { radiusN: a.radiusN }
      : st.mode === 'cage' ? { rotation2: a.rotation2, reachN: a.reachN }
      : st.mode === 'rotate2' ? { rotation2: a.rotation2 } : { rotation: a.rotation }
    emit('board.edit', { id: st.id, patch: patchOut, planId: activeId })
  }

  return { rotMagnet, rotMagnetRef, rotPanPaused, clearRotMagnet, claimRotTarget, rotDown, rotMove, rotUp }
}
