import { useRef } from 'react'
import type React from 'react'
import type { BoardAnno, BoardPoint, BoardTool, LineAttachment, LineEndpoint } from '../types'
import { buzz } from '../lib/haptics'
import { advanceDwell, detachProgress, dwellFor, EMPTY_DWELL, nextFreePort, stickyMagneticTarget, type AttachableLine, type DwellState, type MagneticTarget } from '../lib/lineAttachments'
import { carryDoors, doorsOn } from '../lib/grundriss'
import { canDropVertex, extendEnd, insertAt, removeVertex, replaceVertex, segmentMid } from '../lib/vertexOps'

// `origin` + `attached` + `detach` are the RELEASE half of the ring language (see the Lage map's
// EndpointDrag — same shape, board coords instead of lng/lat).
export type PlanEndpointDrag = { id: string; endpoint: LineEndpoint; point: BoardPoint; origin: BoardPoint; attached: boolean; detach: number; dwell: DwellState; candidate: MagneticTarget | null }

interface Args {
  annos: BoardAnno[]
  selId: string | null
  /** the ARMED tool as the board reads it (a select-only surface reads 'pan') */
  tool: BoardTool
  readOnly: boolean
  /** floor-stack document: a Linie's node follows the pointer's storey */
  stack: boolean
  /** client point → normalized 0..1 in plan space */
  toNorm: (clientX: number, clientY: number) => [number, number] | null
  /** whole-board y ↔ storey-local y, and which storey a board y falls on (lib/whiteboard · floorGeometry) */
  localY: (y: number, floor: number) => number
  floorAt: (y: number) => number
  mapY: (floor: number | undefined, ly: number) => number
  /** the sheet's size in board px at the current zoom */
  sW: number
  sH: number
  /** every magnetic line resolved in board space, the dragged end already at the finger */
  resolvedPts: Map<string, BoardPoint[]>
  attachmentLines: AttachableLine<BoardPoint>[]
  planCandidatesAt: (sourceId: string, pointer: [number, number]) => MagneticTarget[]
  /** the board document's funnel (useBoardDoc): checkpoint, silent write, checkpoint + write */
  pushPast: () => void
  patch: (id: string, p: Partial<BoardAnno>) => void
  patchCommit: (id: string, p: Partial<BoardAnno>) => void
  emit: (op: string, payload?: Record<string, unknown>) => void
  activeId: string
  onLineAttached?: (annoId: string, attachment: LineAttachment) => void
  onLineDetached?: (annoId: string, previous: LineAttachment) => void
  /** ⚠️ The board's OWN endpoint-magnet ref and setter — the same objects the ink layer and the
   *  magnet ring read (Whiteboard · attachmentLines), never a copy: the drag writes it, the
   *  render reads it. */
  planEndpointDrag: React.MutableRefObject<PlanEndpointDrag | null>
  setPlanEndpointDrag: (next: PlanEndpointDrag | null) => void
  planDwellTimerRef: React.MutableRefObject<ReturnType<typeof setTimeout> | null>
  allFloorsTTB: number[]
  revealFloor: (f: number) => void
  centerOnPoint: (x: number, y: number, floor: number, atScale?: number) => void
  scaleRef: React.MutableRefObject<number>
  /** the storey the node draft was started on (a Fläche stays there) */
  draftFloor: React.MutableRefObject<number>
  setDraft: React.Dispatch<React.SetStateAction<BoardPoint[] | null>>
  /** the storey tile's height/width (Whiteboard · tileAspectOf) – a Durchgang's seat on its Wand depends on it */
  tileAR: number
  /** where a Wand's corner dragged to a board-normalized point lands, ring shown (usePlanDraft ·
   *  snapWallVertex); `null` for the point clears the ring */
  snapWallVertex: (wall: BoardAnno, idx: number, n: [number, number] | null) => BoardPoint | null
  /** the same for a node of the OPEN Wand (usePlanDraft · snapDraftVertex); `null` back = not a
   *  Wand draft, the plain move applies */
  snapDraftVertex: (idx: number, n: [number, number] | null) => BoardPoint | null
}

/**
 * Vertex editing on the plan, lifted out of the Whiteboard (23.09.2026): a selected Linie/Fläche's
 * node drag (with the endpoint magnet — «Ring lädt, dann schnappt es» — and its release ring),
 * «+» insert, hold-delete, «Verlängern» and the staircase climb; and the same grip vocabulary on
 * the in-progress node draft. One gesture is ONE undo step: a plain reshape checkpoints on its
 * first move, grow and insert before they change the shape (`pushed`), a docked end on release.
 *
 * The handlers are byte-for-byte what they were inline (only the dwell timer is `…Ref` here, as
 * the hooks linter reads refs by name); they still close over the board's live
 * values, because the hook is called on every render with that render's values. No memo, no
 * useCallback: the surface's commit count must not move (IncidentWorkspace.harness · render
 * budget). The Whiteboard routes pointer moves/ups here through its stage dispatcher
 * (manipMove/manipUp), which is why the two drag refs are handed back.
 */
export function useWbVertexEdit({
  annos, selId, tool, readOnly, stack, toNorm, localY, floorAt, mapY, sW, sH,
  resolvedPts, attachmentLines, planCandidatesAt, pushPast, patch, patchCommit, emit, activeId,
  onLineAttached, onLineDetached, planEndpointDrag, setPlanEndpointDrag, planDwellTimerRef,
  allFloorsTTB, revealFloor, centerOnPoint, scaleRef, draftFloor, setDraft, tileAR, snapWallVertex, snapDraftVertex,
}: Args) {
  // drag a single VERTEX of a selected line/area (shared by both — they're both pts-based).
  // `pushed` = the undo checkpoint for this gesture was already taken BEFORE the shape changed
  // (extendLine/insertVertex grow it on pointer-down), so the release must not take a second one.
  const vertDrag = useRef<{ id: string; idx: number; floor: number; moved: boolean; pushed: boolean } | null>(null)

  // --- vertex editing of a selected line/area (drag a node, insert on a segment, delete a node).
  // Identical for both kinds — they're both just `pts`, so one code path serves Linie and Fläche. ---
  const vertDown = (idx: number, e: React.PointerEvent) => {
    if (tool !== 'pan' || readOnly) return
    e.stopPropagation()
    ;(e.target as HTMLElement).setPointerCapture?.(e.pointerId)
    const a = annos.find((x) => x.id === selId); if (!a?.pts) return
    // a Wand's ends dock onto nothing (it is layout, Whiteboard · planCandidatesAt): every one of
    // its corners takes the plain reshape, which snaps
    const docks = a.kind === 'draw' && !a.role
    const endpoint: LineEndpoint | null = docks && idx === 0 ? 'start' : docks && idx === a.pts.length - 1 ? 'end' : null
    if (endpoint) {
      const resolved = resolvedPts.get(a.id) ?? a.pts
      const attached = !!(endpoint === 'start' ? a.startAttachment : a.endAttachment)
      setPlanEndpointDrag({ id: a.id, endpoint, point: resolved[idx], origin: resolved[idx], attached, detach: 0, dwell: EMPTY_DWELL, candidate: null })
    }
    vertDrag.current = { id: a.id, idx, floor: a.floor ?? 0, moved: false, pushed: false }
  }
  const vertMove = (e: React.PointerEvent) => {
    const st = vertDrag.current; if (!st) return
    const n = toNorm(e.clientX, e.clientY); if (!n) return
    const magnetic = planEndpointDrag.current
    if (magnetic) {
      const floor = stack ? floorAt(n[1]) : st.floor
      const point: BoardPoint = [n[0], localY(n[1], floor), floor]
      const pointer: [number, number] = [n[0] * sW, n[1] * sH]
      if (planDwellTimerRef.current) clearTimeout(planDwellTimerRef.current)
      st.moved = true
      // Still hooked up? Then the only thing on offer is letting go, and the red ring at the OLD
      // socket runs on distance: pull past the detach radius and the link is off; stop short and
      // release, and it springs back. Mirrors the Lage map's moveEndpointDrag exactly.
      if (magnetic.attached) {
        const o = magnetic.origin
        const detach = detachProgress([o[0] * sW, mapY(o[2] ?? 0, o[1]) * sH], pointer)
        setPlanEndpointDrag({ ...magnetic, point, detach, attached: detach < 1, candidate: null, dwell: EMPTY_DWELL })
        if (detach >= 1) buzz()
        return
      }
      const targets = planCandidatesAt(st.id, pointer)
      const candidate = stickyMagneticTarget(pointer, targets, magnetic.candidate?.key ?? null)
      const dwell = advanceDwell(magnetic.dwell, candidate, Date.now())
      setPlanEndpointDrag({ ...magnetic, point, candidate, dwell })
      // a line target arms on acquisition (dwellFor = 0): the haptic says so, as the timer does
      if (dwell.armed && !magnetic.dwell.armed) buzz()
      // a finger that has found its target stops moving — and then nothing but this timer can
      // close the ring (the visible fill is its CSS twin)
      if (candidate && !dwell.armed) planDwellTimerRef.current = setTimeout(() => {
        const cur = planEndpointDrag.current
        if (!cur || cur.candidate?.key !== candidate.key) return
        setPlanEndpointDrag({ ...cur, dwell: { ...cur.dwell, armed: true } }); buzz()
      }, Math.max(0, dwellFor(candidate) - (Date.now() - dwell.since)))
      return
    }
    if (!st.moved) { pushPast(); st.moved = true; st.pushed = true }
    const a = annos.find((x) => x.id === st.id)
    // a Wand's corner lands like a drawn one (round 2, 27.10.2026): same targets, same ring, same
    // right-angle preference – and stays on its storey
    const walled = a?.role === 'wand' && stack ? snapWallVertex(a, st.idx, n) : null
    const floor = stack ? floorAt(n[1]) : st.floor
    patch(st.id, { pts: replaceVertex<BoardPoint>(a?.pts ?? [], st.idx, walled ?? [n[0], localY(n[1], floor), floor]) })
  }
  const vertUp = () => {
    const st = vertDrag.current; vertDrag.current = null
    const magnetic = planEndpointDrag.current
    if (magnetic && st?.moved) {
      if (planDwellTimerRef.current) clearTimeout(planDwellTimerRef.current)
      const a = annos.find((x) => x.id === magnetic.id)
      if (a?.pts) {
        // Ring lädt, dann schnappt es: ONLY a closed ring attaches, and only a closed RELEASE ring
        // (`attached` already flipped false mid-drag) frees an endpoint that had a link. Anything
        // in between — let go while either ring was still filling — leaves the endpoint where the
        // finger dropped it, or springs it back to the socket it never left.
        const floor = magnetic.point[2] ?? 0
        let attachment: LineAttachment | undefined
        let endPt = magnetic.point
        if (magnetic.dwell.armed && magnetic.candidate) {
          const target = magnetic.candidate.target
          attachment = { target, routing: magnetic.candidate.defaultRouting ?? 'direct', ...(target.kind === 'line' ? { port: magnetic.candidate.port ?? nextFreePort(attachmentLines, target.id, target.endpoint) ?? undefined } : {}) }
          if (sW && sH) endPt = [magnetic.candidate.point[0] / sW, localY(magnetic.candidate.point[1] / sH, floor), floor]
        } else if (magnetic.attached) { setPlanEndpointDrag(null); return }  // ring never closed → snap back, no change
        const pts = replaceVertex(a.pts, magnetic.endpoint === 'start' ? 0 : a.pts.length - 1, endPt)
        const out: Partial<BoardAnno> = { pts, ...(magnetic.endpoint === 'start' ? { startAttachment: attachment } : { endAttachment: attachment }) }
        // `pushed` = extendLine already checkpointed BEFORE it grew the line, so a second
        // checkpoint here would snapshot the already-grown shape and make one grow gesture cost
        // two undo presses. Write + emit without one instead; the emitted `pts` is the final
        // array either way, so the replay is identical.
        if (st.pushed) { patch(a.id, out); emit('board.edit', { id: a.id, patch: out, planId: activeId }) }
        else patchCommit(a.id, out)
        // the docked end is written only now, so its Durchgänge ride along in this write
        logDoorSeats(a.id, carryDoors(annos, annos.map((x) => (x.id === a.id ? { ...x, ...out } : x)), tileAR))
        // …and an end dragged ONTO a Trupp's chip joins the two, exactly as a fresh stroke's does;
        // dragged OFF it, they part
        const previous = magnetic.endpoint === 'start' ? a.startAttachment : a.endAttachment
        if (attachment) onLineAttached?.(a.id, attachment)
        else if (previous) onLineDetached?.(a.id, previous)
      }
      setPlanEndpointDrag(null)
      return
    }
    setPlanEndpointDrag(null)
    const wall = st && annos.find((x) => x.id === st.id && x.role)
    if (st && wall) snapWallVertex(wall, st.idx, null) // the ring goes with the finger
    // …and the ordinary, unmagnetic reshape: the points ARE what moved, so they travel with it
    // (an empty `board.edit` folds to nothing — see the magnetic branch above, which always said so)
    if (!st?.moved) return
    emit('board.edit', { id: st.id, planId: activeId, patch: { pts: annos.find((a) => a.id === st.id)?.pts } })
    logDoorSeats(st.id, annos)
  }
  /** the Durchgänge re-seated on a reshaped Wand (lib/grundriss · carryDoors) – their seat, for the
   *  replay. `board` holds them where they now sit: the last render for a live reshape, the
   *  carried release write for a docked end. */
  const logDoorSeats = (wallId: string, board: readonly BoardAnno[]) =>
    doorsOn(board, [wallId]).forEach((d) => emit('board.edit', { id: d.id, patch: { x: d.x, y: d.y, floor: d.floor, rotation: d.rotation }, planId: activeId }))
  /**
   * Grow the line past one of its open ends: append a point where the finger is, then hand the
   * gesture straight over to the ordinary vertex drag so the new point follows until release.
   * One undo step (pushPast once, at the start) — the same shape a reshape has.
   *
   * ⚠️ The grown point IS the line's new start/end, so the drag runs through the MAGNET path
   * (`planEndpointDrag`), not the plain vertex reshape. Without that, «Verlängern» was the one
   * way of moving an endpoint that could never dock — grow a Leitung onto a Fahrzeug and nothing
   * connected (field report 01.09.). The Lage map's grip had the identical hole and is fixed with
   * it (MapView · the «Verlängern» NewNodeHandle), so both surfaces grow AND dock the same way.
   * An end that is ALREADY attached keeps the plain reshape: unplugging is the node grip's and
   * the × chip's job, and a grip that could also detach would promise two things at once.
   */
  /** the staircase: the Leitung continues at the SAME x/y one storey up or down – one new vertex
   *  there, its own storey, one undo step. The stair marks then stand at both ends of the climb. */
  const climbLine = (end: 'start' | 'end', dir: 1 | -1) => {
    if (tool !== 'pan' || readOnly || !stack) return
    const a = annos.find((x) => x.id === selId); const pts = a?.pts; if (!a || !pts || a.kind !== 'draw') return
    const i = end === 'start' ? 0 : pts.length - 1
    const [x, y, f] = pts[i]
    const floor = (f ?? a.floor ?? 0) + dir
    if (!allFloorsTTB.includes(floor)) return
    revealFloor(floor) // a Leitung may climb into a storey this device folded away — it comes back
    // the way back: if the neighbouring vertex IS this spot one storey in that direction, the
    // tap undoes the climb (drops this end) instead of laying a second flight back down the same
    // stairs – which left the line 0 → +1 → 0 with two marks on top of each other
    const nb = pts[end === 'start' ? 1 : pts.length - 2]
    const retreat = !!nb && nb[0] === x && nb[1] === y && (nb[2] ?? a.floor ?? 0) === floor && pts.length > 2
    if (retreat) {
      patchCommit(a.id, { pts: end === 'start' ? pts.slice(1) : pts.slice(0, -1) })
      requestAnimationFrame(() => centerOnPoint(x, y, floor, Math.max(scaleRef.current, 2.5)))
      return
    }
    const point: BoardPoint = [x, y, floor]
    patchCommit(a.id, { pts: extendEnd(pts, end, point) })
    // …and the view follows the Leitung upstairs: the new end, close enough to place the next
    // vertex, so the climb is one tap and not a tap plus a scroll to find where it went
    requestAnimationFrame(() => centerOnPoint(x, y, floor, Math.max(scaleRef.current, 2.5)))
  }
  const extendLine = (end: 'start' | 'end', e: React.PointerEvent) => {
    if (tool !== 'pan' || readOnly) return
    e.stopPropagation()
    ;(e.target as HTMLElement).setPointerCapture?.(e.pointerId)
    const a = annos.find((x) => x.id === selId); const pts = a?.pts; if (!a || !pts) return
    const n = toNorm(e.clientX, e.clientY); if (!n) return
    const floor = a.kind === 'draw' && stack ? floorAt(n[1]) : (a.floor ?? 0)
    const point: BoardPoint = [n[0], localY(n[1], floor), floor]
    pushPast()
    const next = extendEnd(pts, end, point)
    patch(a.id, { pts: next })
    if (a.kind === 'draw' && !a.role && !(end === 'start' ? a.startAttachment : a.endAttachment)) {
      setPlanEndpointDrag({ id: a.id, endpoint: end, point, origin: point, attached: false, detach: 0, dwell: EMPTY_DWELL, candidate: null })
    }
    // …and from here it IS a vertex drag: `moved` is already true, so vertMove streams and
    // vertUp commits exactly as if the node had always been there.
    vertDrag.current = { id: a.id, idx: end === 'start' ? 0 : next.length - 1, floor, moved: true, pushed: true }
  }

  /**
   * Insert a node on the segment after vertex `idx` (at its midpoint) — and then hand the SAME
   * press over to the ordinary vertex drag, exactly as `extendLine` does, so the new node follows
   * the finger until it lifts. Letting go without moving leaves the node at the midpoint, which is
   * what a plain tap on the «+» always left. One undo step (pushPast once, at the start).
   *
   * No magnet here, unlike `extendLine`: the new node lands at `idx + 1`, which for an open line
   * is never index 0 nor the last one, and for a closed Fläche there is no endpoint at all. So it
   * is always an interior vertex — nothing to dock, and no attachment can change which point it
   * refers to.
   */
  const insertVertex = (idx: number, e: React.PointerEvent) => {
    if (tool !== 'pan' || readOnly) return
    e.stopPropagation()
    const a = annos.find((x) => x.id === selId); const pts = a?.pts; if (!a || !pts) return
    ;(e.target as HTMLElement).setPointerCapture?.(e.pointerId)
    const n = toNorm(e.clientX, e.clientY)
    const floor = a.kind === 'draw' && n && stack ? floorAt(n[1]) : (a.floor ?? 0)
    const mid: BoardPoint = n ? [n[0], localY(n[1], floor), floor] : [...segmentMid(pts, idx), floor] // wraps for the closing edge of an area
    pushPast()
    patch(a.id, { pts: insertAt(pts, idx + 1, mid) })
    // …and from here it IS a vertex drag: `moved` is already true, so vertMove streams and vertUp
    // commits — the new node never gets a chance to look like something you have to find again.
    vertDrag.current = { id: a.id, idx: idx + 1, floor, moved: true, pushed: true }
  }
  // delete vertex `idx`, keeping a valid shape (≥2 for a line, ≥3 for an area)
  const deleteVertex = (idx: number) => {
    if (readOnly) return
    const a = annos.find((x) => x.id === selId); const pts = a?.pts; if (!a || !pts) return
    if (!canDropVertex(a.kind, pts.length)) return
    // a long-press delete fires mid-pointer-session — drop the pending drag so further
    // finger movement can't reshape whichever point inherited this index
    vertDrag.current = null
    patchCommit(a.id, { pts: removeVertex(pts, idx) })
  }

  // --- vertex editing of the IN-PROGRESS node draft (A3, 29.08.) — the same grip/insert/hold
  // vocabulary a finished shape gets (WbDraftHandles), wired straight into the draft points and
  // never into the document: the draft is still ephemeral state until it commits. ---
  const draftVert = useRef<{ idx: number } | null>(null)
  const draftVertDown = (idx: number, e: React.PointerEvent) => {
    e.stopPropagation()
    ;(e.target as HTMLElement).setPointerCapture?.(e.pointerId)
    draftVert.current = { idx }
  }
  const draftVertMove = (e: React.PointerEvent) => {
    const st = draftVert.current; if (!st) return
    const n = toNorm(e.clientX, e.clientY); if (!n) return
    // a Linie's node follows the pointer's storey (a Leitung may cross floors); a Fläche stays
    // on the floor its ring was started on — the same rule placeNode applies to a fresh tap
    // …and a Wand's node lands like a tap (round 3, 27.10.2026): ring, targets, right angles –
    // on the Wand's own storey
    const floor = tool === 'line' && stack ? floorAt(n[1]) : draftFloor.current
    const walled = snapDraftVertex(st.idx, n)
    setDraft((d) => (d ? replaceVertex<BoardPoint>(d, st.idx, walled ?? [n[0], localY(n[1], floor), floor]) : d))
  }
  const draftVertUp = () => { if (draftVert.current) snapDraftVertex(draftVert.current.idx, null); draftVert.current = null }
  /** Insert a node on draft segment `idx` and keep the SAME press dragging it — the twin of
   *  insertVertex on a committed shape (releasing without moving leaves it where it appeared). */
  const draftInsert = (idx: number, e: React.PointerEvent) => {
    e.stopPropagation()
    ;(e.target as HTMLElement).setPointerCapture?.(e.pointerId)
    const n = toNorm(e.clientX, e.clientY)
    const floor = tool === 'line' && n && stack ? floorAt(n[1]) : draftFloor.current
    setDraft((d) => {
      if (!d) return d
      const mid: BoardPoint = n ? [n[0], localY(n[1], floor), floor] : [...segmentMid(d, idx), floor] // wraps for the closing edge of an area draft
      return insertAt(d, idx + 1, mid)
    })
    draftVert.current = { idx: idx + 1 }
  }
  // hold-to-delete a draft node — allowed all the way down: deleting the last node leaves no
  // draft at all, the same empty hand Escape leaves
  const draftDeleteVertex = (idx: number) => {
    draftVert.current = null
    setDraft((d) => { const next = d ? removeVertex(d, idx) : null; return next?.length ? next : null })
  }

  return {
    vertDrag, draftVert, vertDown, vertMove, vertUp, climbLine, extendLine, insertVertex, deleteVertex,
    draftVertDown, draftVertMove, draftVertUp, draftInsert, draftDeleteVertex,
  }
}
