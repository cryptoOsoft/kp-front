import { useRef } from 'react'
import type React from 'react'
import type { BoardAnno, BoardPoint, BoardTool } from '../types'
import { DRAG_DEADZONE_PX } from '../lib/useHoldToDrag'
import { formatTime } from '../lib/format'
import { serverNow } from '../lib/serverClock'
import { applyRouting, nearestFreeEndpoint, objectAttachment, type AttachableLine } from '../lib/lineAttachments'
import { normalizeStackEdit } from '../lib/stackFloors'
import { DOOR_SNAP_PX, isDoor, nearestWall, seatDoor } from '../lib/grundriss'

interface Args {
  /** the ARMED tool as the board reads it (a select-only surface reads 'pan') */
  tool: BoardTool
  readOnly: boolean
  annos: BoardAnno[]
  editId: string | null
  setSelId: (id: string | null) => void
  setSelIds: (ids: string[]) => void
  setNotePanelId: (id: string | null) => void
  /** client point → normalized 0..1 in plan space */
  toNorm: (clientX: number, clientY: number) => [number, number] | null
  /** floor-stack document: the chip drags freely across storeys */
  stack: boolean
  floorAt: (y: number) => number
  localY: (y: number, floor: number) => number
  mapY: (floor: number | undefined, ly: number) => number
  sW: number
  sH: number
  /** a storey tile's height / width – a dragged Durchgang turns along the Wand it lands on */
  tileAR: number
  attachmentLines: AttachableLine<BoardPoint>[]
  /** the board document's funnel (useBoardDoc): checkpoint, silent writes */
  pushPast: () => void
  set: (next: BoardAnno[]) => void
  patch: (id: string, p: Partial<BoardAnno>) => void
  emit: (op: string, payload?: Record<string, unknown>) => void
  activeId: string
  onLinkLineTrupp?: (lineId: string, truppId: string) => void
}

/**
 * Dragging a placed chip on the plan — a Trupp, a symbol, a note — lifted out of the Whiteboard
 * (23.09.2026): the press that selects (and opens a note's panel), the drag past the shared
 * deadzone that checkpoints ONCE and carries every trace-routed Leitung end along, and the
 * release that stamps a Trupp's time, writes the audit rows and joins a Trupp's chip dropped on a
 * free hose end to that hose. The handlers are the former inline ones, unchanged, re-created on
 * every render with that render's values (no memo). The drag ref is handed back for the stage
 * dispatcher (Whiteboard · manipMove).
 */
export function useWbChipDrag({
  tool, readOnly, annos, editId, setSelId, setSelIds, setNotePanelId, toNorm, stack, floorAt, localY, mapY, sW, sH, tileAR,
  attachmentLines, pushPast, set, patch, emit, activeId, onLinkLineTrupp,
}: Args) {
  const chipDrag = useRef<{ id: string; moved: boolean; sx: number; sy: number; floorOffset: number } | null>(null)

  // --- chip dragging (resource / symbol / text in pan mode) ---
  const chipDown = (e: React.PointerEvent, id: string, shownFloor?: number) => {
    if (tool !== 'pan') return
    // (a locked shape never reaches this handler: its anno div is pointer-events:none —
    // click-through ink, the LockChip is the only door, same as a locked drawn Fläche)
    // Notiz-Grammatik (29.08., unified with symbols across Karte AND Plan): tapping a note opens
    // its detail panel, exactly as tapping a symbol opens its ContextPanel — the ⚙ grip that used
    // to be the panel's only door is gone. Not while the note is mid-edit (its textarea owns the
    // taps then), and never on placement: placeNode arms editId, not this.
    const isNote = annos.find((x) => x.id === id)?.kind === 'text'
    if (readOnly) {
      // view-only (viewer / replay / EL view): a tap still SELECTS — so the read-only
      // detail panel can open, parity with the Lage map — but never arms a drag
      e.stopPropagation()
      setSelId(id); setSelIds([])
      if (isNote) setNotePanelId(id)
      return
    }
    e.stopPropagation()
    // ⚠️ A FORM has no body drag (02.09., Karte parity): it is moved from the bar's ✥, and its
    // body only selects — so a press on a Rotation's loop cannot nudge it away from the end grip
    // somebody was aiming for.
    if (annos.find((x) => x.id === id)?.kind !== 'shape') {
      chipDrag.current = { id, moved: false, sx: e.clientX, sy: e.clientY, floorOffset: (shownFloor ?? 0) - (annos.find((a) => a.id === id)?.floor ?? 0) }
      ;(e.target as HTMLElement).setPointerCapture(e.pointerId)
    }
    setSelId(id); setSelIds([])
    if (isNote && editId !== id) setNotePanelId(id)
  }
  const chipMove = (e: React.PointerEvent) => {
    if (!chipDrag.current) return
    const a = annos.find((x) => x.id === chipDrag.current!.id); if (!a) return
    const n = toNorm(e.clientX, e.clientY); if (!n) return
    // deadzone (shared with the Lage map's hold-to-drag): don't move until the pointer travels
    // past DRAG_DEADZONE_PX, so a tap-to-select can't nudge a placed chip a pixel.
    if (!chipDrag.current.moved && Math.hypot(e.clientX - chipDrag.current.sx, e.clientY - chipDrag.current.sy) < DRAG_DEADZONE_PX) return
    if (!chipDrag.current.moved) pushPast() // one checkpoint per drag, before the first move
    chipDrag.current.moved = true
    // on the floor-stack the chip drags FREELY across storeys: the floor follows the cursor,
    // y is re-localised into whichever storey the pointer is over. Single-sheet docs unchanged.
    const f = stack ? floorAt(n[1]) : a.floor
    const point: BoardPoint = [n[0], localY(n[1], f ?? 0), f ?? 0]
    set(annos.map((anno) => {
      if (anno.id === chipDrag.current!.id) {
        let moved: BoardAnno = { ...anno, x: point[0], y: point[1], ...(stack ? { floor: (f ?? 0) - chipDrag.current!.floorOffset } : {}) }
        // a Durchgang dropped near a Wand sits on it again, turned along it; elsewhere it stands free
        if (stack && isDoor(anno) && sW) moved = seatDoor(moved, nearestWall(annos, moved.floor ?? 0, point[0], point[1], tileAR, DOOR_SNAP_PX / sW))
        return stack ? normalizeStackEdit(anno, moved) : moved
      }
      if (anno.kind !== 'draw' || !anno.pts?.length) return anno
      let next = anno
      for (const endpoint of ['start', 'end'] as const) {
        const rel = endpoint === 'start' ? next.startAttachment : next.endAttachment
        if (rel?.target.kind === 'object' && rel.target.id === a.id && rel.routing === 'trace') next = { ...next, pts: applyRouting(next.pts!, endpoint, point, 'trace', 0.002) }
      }
      return next
    }))
  }
  const chipUp = () => {
    const d = chipDrag.current; chipDrag.current = null
    if (!d || !d.moved) return
    // moving just relocates the team's live position — it does NOT record a
    // breadcrumb. Positions are logged only via markPosition (explicit), so the
    // rule is unambiguous: a dot exists exactly where you chose to log one.
    const a = annos.find((x) => x.id === d.id)
    if (a?.kind === 'resource') patch(d.id, { t: formatTime(new Date(serverNow())) })
    // record the relocation in the audit trail (the drag itself was silent patches)
    if (a) emit('board.move', { id: d.id, x: a.x, y: a.y, floor: a.floor, ...(stack && a.kind === 'symbol' ? { floorFrom: a.floorFrom, floorTo: a.floorTo } : {}), planId: activeId })
    // …and a Durchgang's seat, which a position does not carry (its turn, the Wand it sits on)
    if (a && stack && isDoor(a)) emit('board.edit', { id: d.id, patch: { rotation: a.rotation, onWall: a.onWall ?? null }, planId: activeId })
    annos.filter((line) => [line.startAttachment, line.endAttachment].some((rel) => rel?.target.kind === 'object' && rel.target.id === d.id && rel.routing === 'trace'))
      .forEach((line) => emit('board.edit', { id: line.id, patch: { pts: line.pts }, planId: activeId }))
    // Ein Trupp auf dem Leitungsende (15.09.): a Trupp's chip dropped on the FREE end of a hose
    // joins the two, the same link snapping the hose onto the chip makes — the picture is the
    // pick, from whichever side the operator works. The Karte does exactly this on its own marker
    // release (IncidentWorkspace · finishEntityMove). The chip's own DOT is what is measured (its
    // body hangs to the right of it — see attachBox), only ends that hang free count, and the
    // middle of a hose says nothing about who works it.
    if (a?.kind !== 'resource' || !a.truppId || a.x == null || a.y == null || !sW || !sH) return
    const join = nearestFreeEndpoint<BoardPoint>(
      [a.x * sW, mapY(a.floor, a.y) * sH],
      attachmentLines,
      (p) => [p[0] * sW, mapY(p[2] ?? 0, p[1]) * sH],
    )
    if (!join) return
    // the chip's own coupling, written exactly as the endpoint magnet writes one (routed «Direkt»
    // by default — lib/lineAttachments · DEFAULT_OBJECT_ROUTING)
    const out: Partial<BoardAnno> = join.endpoint === 'start'
      ? { startAttachment: objectAttachment(d.id) }
      : { endAttachment: objectAttachment(d.id) }
    patch(join.lineId, out) // the drag's own checkpoint already stands — one gesture, one step
    emit('board.edit', { id: join.lineId, patch: out, planId: activeId })
    // …and the link itself, unless this hose is already anchored to this very Trupp — nudging the
    // chip beside its own Leitung is not a new fact, and every link writes a Verlauf row
    if (annos.find((x) => x.id === join.lineId)?.truppId !== a.truppId) onLinkLineTrupp?.(join.lineId, a.truppId)
  }

  return { chipDrag, chipDown, chipMove, chipUp }
}
