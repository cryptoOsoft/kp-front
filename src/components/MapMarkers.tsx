import { Fragment, useCallback, useEffect, useRef, useState } from 'react'
import { Marker } from 'react-map-gl/maplibre'
import type { CaptionMode, Entity, LngLat, Trupp } from '../types'
import { buzz } from '../lib/haptics'
import { appConfig } from '../config/appConfig'
import { DRAG_DEADZONE_PX, useHoldToDrag } from '../lib/useHoldToDrag'
import { beginSheetPeek, endSheetPeek } from '../lib/sheetPeek'
import { Icon } from '../lib/icons'
import { ROTATION_MAX_M, ROTATION_W_M, SHAPE_AXIS_GRIPS, SHAPE_DEFS, SHAPE_FREE_ASPECT, SHAPE_MAX_M, SHAPE_MIN_M, rotationBox, rotationGripOffPx, rotationRun, shapeAspect, shapeAspectMax } from '../lib/shapes'
import { isMagnetEntity, MAGNET_DWELL_MS, MAGNET_RADIUS_PX } from '../lib/lineAttachments'
import type { TeamLineBadge } from '../lib/truppLines'
import { ghostTrailLabel, type TruppTrail } from '../lib/truppTrails'
import { fillTemplate } from '../lib/format'
import { ConnectRing } from './NodeDeleteChip'
import { EntityMarker, type ShapeGripMode } from './EntityMarker'
import { useHazardData } from '../lib/useHazardData'
import { fanOffsets, pileAt } from '../lib/labelPass'
import { pxPerM, symPx, effectiveLayer } from '../lib/mapView'
import { dockSlots } from '../lib/docking'
import { freeResizeLocal, rotationEnd, rotationEndDeg, rotorDeg } from '../lib/rotorMath'

/** Kinds the nearest-centre hit test arbitrates: compact glyphs, centred on their coordinate. */
const PILE_KINDS: Entity['kind'][] = ['symbol', 'vehicle', 'person']

/** Park the caret AFTER the existing text instead of selecting all of it. Re-opening a note is
 *  almost always "add a line", and a full selection means the next keystroke silently wipes
 *  what was already written — the worst possible default with gloves on. */
function caretToEnd(el: HTMLTextAreaElement) {
  const n = el.value.length
  el.setSelectionRange?.(n, n)
}

/** Grow a note's textarea to its content, so the editable box is exactly as tall as the note it
 *  replaces. Height must be reset first — scrollHeight never shrinks while a height is still set.
 *  (Width comes from React: every note carries one.)
 *
 *  The `> 0` guard is load-bearing: at mount the element has not been laid out yet and
 *  scrollHeight reads 0. Writing `height: 0px` collapses the textarea, and a collapsed element
 *  DROPS FOCUS — which showed up as "the note is placed but I can't type into it", with the
 *  keystrokes falling through to the global hotkeys instead. */
function autoGrow(el: HTMLTextAreaElement | null) {
  if (!el) return
  el.style.height = 'auto'
  const h = el.scrollHeight
  if (h > 0) el.style.height = `${h}px`
  else el.style.removeProperty('height')
}

export interface MapMarkersProps {
  entities: Entity[]
  byName: Record<string, string>
  isVisible: (id: Entity['layer']) => boolean
  selectedId: string | null
  /** entities in the current marquee multi-selection — shown with a halo (no per-item
   *  handles; the group hub carries the move/delete) */
  groupSelectedIds?: string[]
  /** relationship-network highlight only; never broadens selection or movement */
  networkEntityIds?: string[]
  zoom: number
  /** current map bearing (deg). Placed symbols are pinned to GEOGRAPHIC orientation, so every
   *  glyph/handle CSS rotation is offset by −bearing and a drag stores rotation + bearing. */
  bearing?: number
  /** per-device map symbol-size multiplier (lib/prefs · symbolScales, Einstellungen slider) — scales the symPx band */
  symMul?: number
  /** device default for on-canvas symbol captions; a symbol's own `caption` overrides it.
   *  Whether a caption actually FITS is decided once for the whole map — see suppressedLabels. */
  captionMode?: CaptionMode
  /** Keys the one label pass (MapView · lib/labelPass) decided cannot be drawn without covering
   *  something that outranks them: `cap:<id>` for a symbol caption, `team:<id>` for a Trupp's
   *  name. Their owners paint the 6px ink dot instead. The SELECTED entity is never in here. */
  suppressedLabels?: ReadonlySet<string>
  /** tactical editing is locked (viewer / Führungsansicht / replay): a tap still selects
   *  so the read-only detail panel opens, but no mutating grip is rendered (see MapView) —
   *  the rotate / resize handles are drawn only where `onRotate` / `onShapeTransform` are
   *  wired, and a locked surface wires neither. Read in here for the selected Trupp marker:
   *  a locked surface keeps the bar's two doors that change nothing, «Im Atemschutz zeigen»
   *  and «Spur ein/aus» (RBAC audit 22.10.2026). */
  readOnly?: boolean
  draggable: boolean
  /** project lng/lat → container px, through the map's LIVE transform (re-anchors a hold-drag on
   *  every move, so a zoom/resize mid-drag can't teleport the symbol) */
  project: (c: LngLat) => { x: number; y: number } | undefined
  /** unproject container px → lng/lat (turns the dragged pointer position back into a coord) */
  unproject: (p: { x: number; y: number }) => LngLat | undefined
  /** toggle the map's own pan so a hold-drag of a symbol doesn't also pan the map under it */
  setDragPan: (on: boolean) => void
  onSelect: (e: Entity) => void
  onMarkerDragStart: (id: string) => void
  onMarkerMove: (id: string, c: LngLat) => void
  onMarkerDragEnd: (id: string, c: LngLat) => void
  onDelete: (id: string) => void
  onRotate?: (id: string, deg: number) => void
  /** ⚠️ `coord` too: dragging one END of a Rotation moves its centre as well as its size and
   *  bearing — the box is derived from the two ends, so all four change together. */
  onShapeTransform?: (id: string, patch: { coord?: LngLat; rotation?: number; rotation2?: number; sizeM?: number; aspect?: number; reachM?: number }, phase: 'start' | 'move' | 'end') => void
  /** unlock a locked shape (short-hold on its centre chip) → unlocks + selects. Absent ⇒ the
   *  chip is not drawn (viewer / tactically locked), matching MapView · onUnlockDrawing. */
  onUnlockShape?: (id: string) => void
  /** which note is in raw inline-text edit mode (mirrors the Plan whiteboard's text notes) */
  editNoteId?: string | null
  /** stream a note's text live as it's typed */
  onNoteText?: (id: string, text: string) => void
  /** commit a note's text on blur */
  onNoteCommit?: (id: string, text: string) => void
  /** enter inline edit on a note (double-click; placement enters edit via editNoteId) */
  onNoteEdit?: (id: string) => void
  /** open a note's detail panel. Since 29.08. this rides on the SELECT tap itself (see
   *  selectEntity) — tap = panel, drag = move, the same grammar as a symbol. */
  onNotePanel?: (id: string) => void
  // --- kind 'team' (Trupp markers — the map mirror of the plan board's resource chips) ---
  /** monitored Trupps, for the «raus» dim/strike on a linked team marker */
  trupps?: Trupp[]
  /** open the linked Trupp on the Atemschutz surface */
  onShowTrupp?: (truppId: string) => void
  /** join this marker to an Atemschutz-Trupp — `undefined` lets go of the one it has. The mirror
   *  of the line editor's «Gehört zu Trupp …»: a marker put down before anybody was registered
   *  finds its Trupp afterwards, and joining never touches a contact clock (useTruppActions ·
   *  adoptTruppMarker). Absent ⇒ no picker (read-only / tactically locked). */
  onTeamTrupp?: (entityId: string, truppId: string | undefined) => void
  /** «Neuer Trupp» on that same menu: open the Anmeldung for a Trupp that adopts this marker on
   *  save (IncidentWorkspace · newTruppFromMarker). Absent ⇒ no row. */
  onTeamNewTrupp?: (entityId: string) => void
  /** stamp the marker's current spot + time into its trail (the ONLY way positions are recorded) */
  onTeamMark?: (id: string) => void
  /** rename an untracked team marker — the map twin of the plan chip's rename pen */
  onTeamRename?: (id: string, name: string) => void
  /** recolour a team marker (null = back to automatic). Takes the ENTITY, because the two cases
   *  write different things: a marker bound to a Trupp recolours the TRUPP (board card and plan
   *  chip follow), a loose one recolours just itself. */
  /** «Spur löschen» on the selected marker's trash menu — the marker stays, its recorded
   *  positions go, behind a confirm; the everyday bar button only TOGGLES visibility */
  onTeamClearTrail?: (id: string) => void
  /** «Marker und Spur löschen» on that same menu (18.09.2026): both go, and no ghost trail is
   *  left standing (IncidentWorkspace · removeTeamWithTrail) */
  onTeamRemoveWithTrail?: (id: string) => void
  /** per-team hidden trails (entity ids) — mirrors the plan's hiddenTrails; the eye on a
   *  selected team toggles just that team's lines + breadcrumb dots */
  hiddenTrails?: ReadonlySet<string>
  onToggleTrail?: (id: string) => void
  /** the incident's ghost «Spuren» recorded in geo (lib/truppTrails · mapGhostTrails) — drawn
   *  read-only; the surface offers a delete only where `onGhostTrail` is supplied */
  ghostTrails?: TruppTrail[]
  onGhostTrail?: (id: string) => void
  /** Per team-marker id, the Leitung that marker's Trupp works (MapView · teamLineBadges): the
   *  hose's ink and, where the hose really ends there, a coupling. No number since 11.10.2026 —
   *  the Leitung's number is the hose's own end tag, as on the Gebäude storeys; a marker with no
   *  entry looks exactly as it always did. */
  teamLines?: ReadonlyMap<string, TeamLineBadge>
  /** «Lösen» on the selected joined pill: let go of the Leitung (useTruppActions ·
   *  unlinkTruppLine, with a confirm-with-undo toast at the call site). */
  onTeamUnlink?: (entityId: string, lineId: string) => void
  /** let a docked Trupp marker go of its symbol (lib/docking) – the pill's «Lösen» */
  onTeamUndock?: (entityId: string) => void
}

/**
 * The placed-entity layer: one Marker per entity (shape / note / photo / symbol /
 * vehicle) plus its selection affordances — delete, rotor (live vehicles), and the
 * shape/symbol transform handles. Owns the rotor/transform pointer-drag refs.
 */
export function MapMarkers({ entities, byName, isVisible, selectedId, groupSelectedIds = [], networkEntityIds = [], zoom, bearing = 0, symMul = 1, captionMode = 'off', suppressedLabels, draggable, project, unproject, setDragPan, onSelect, onMarkerDragStart, onMarkerMove, onMarkerDragEnd, onDelete, onRotate, onShapeTransform, onUnlockShape, readOnly = false, editNoteId = null, onNoteText, onNoteCommit, onNoteEdit, onNotePanel, trupps, onShowTrupp, onTeamTrupp, onTeamNewTrupp, onTeamMark, onTeamRename, onTeamClearTrail, onTeamRemoveWithTrail, hiddenTrails, onToggleTrail, teamLines, onTeamUnlink, onTeamUndock, ghostTrails, onGhostTrail }: MapMarkersProps) {
  const ghostLabel = (g: TruppTrail) => ghostTrailLabel(g, appConfig.copy.whiteboard.team, trupps ?? [])
  // repaint the baked placard glyphs (Kemler auto-derived via lookupUN) when the fetched
  // ADR dataset lands — see lib/useHazardData.
  useHazardData()
  // when the note input mounted — onBlur uses this to tell a real "done editing" click-away
  // (commit) apart from the placement focus-steal (bounce focus back). See onBlur below.
  const noteEditStart = useRef(0)
  // set on Enter so its blur() commits even inside the guard window (an explicit commit, not a steal)
  const noteForceCommit = useRef(false)
  // focus the note input when it mounts. MUST be stable (useCallback) — an inline ref callback
  // re-fires every render, which would re-focus/select on each keystroke (one-key-at-a-time).
  const focusNote = useCallback((el: HTMLTextAreaElement | null) => {
    if (!el) return
    noteEditStart.current = Date.now()
    // The note input is portaled into the MapLibre Marker element, whose constructor adds a
    // native `mousedown` → preventDefault() ("prevent focusing on click"). On desktop that kills
    // the input's focus-on-click. Stop the mousedown AT the input (a native listener, before it
    // bubbles to the marker element) so the default focus is preserved — pointerdown
    // stopPropagation alone doesn't help because the blocker listens for `mousedown`.
    el.addEventListener('mousedown', (ev) => ev.stopPropagation())
    // Focus synchronously on mount — stays inside the placement tap's gesture context so iPadOS
    // opens the on-screen keyboard (a deferred focus drops the gesture and the keyboard never
    // appears). Focus is then stolen by MapLibre's canvas (and/or a panel mounting on select),
    // but the onBlur guard below re-grabs it instead of letting that steal commit the note.
    el.focus(); caretToEnd(el)
    // …but that call is a SILENT NO-OP when it lands early: react-map-gl builds the Marker's
    // div and only then inserts it into the map container, so at ref time the node can still be
    // detached — and focusing a detached node does nothing at all, with no error. That is why a
    // freshly placed note could not be typed into: focus stayed on the MapLibre canvas and the
    // keystrokes fell through to the global hotkeys. Re-assert on the next frame if it did not
    // take. The synchronous attempt above is kept because when it DOES work it stays inside the
    // tap's gesture context, which is what makes iPadOS open the on-screen keyboard.
    requestAnimationFrame(() => {
      if (document.activeElement !== el) { el.focus(); caretToEnd(el) }
      // size only after layout too — scrollHeight reads 0 before it (see autoGrow)
      autoGrow(el)
    })
  }, [])
  // ⚠️ Which team pill is in inline rename is TwinTeamPill's own state — a rename never survives
  // selecting something else, and leaving the pill (which unmounts it) IS the commit/abort. What
  // stays here is the focus recipe: only this surface knows MapLibre's quirk.
  const focusTeam = useCallback((el: HTMLInputElement | null) => {
    if (!el) return
    // same MapLibre marker quirk as the note input: the Marker element preventDefaults
    // mousedown ("prevent focusing on click"), which would kill focus-on-click here too
    el.addEventListener('mousedown', (ev) => ev.stopPropagation())
    el.focus(); el.select()
    requestAnimationFrame(() => { if (document.activeElement !== el) { el.focus(); el.select() } })
  }, [])
  const rotateRef = useRef<{ id: string; cx: number; cy: number } | null>(null)
  // `rot` = the shape's SCREEN rotation at grab time and `free` = per-axis resize allowed —
  // both captured on pointer-down so the corner drag can be resolved in the shape's own frame
  const shapeRef = useRef<{
    id: string; cx: number; cy: number; lat: number
    mode: ShapeGripMode
    rot: number; free: boolean; keepHeightM: number | null; aspectMax: number; maxM: number
    /** end drags only: the end that stays put (client px), how far the grip floats past the cap,
     *  and the client→container offset the new centre is unprojected through */
    fixed: { x: number; y: number } | null; gripOffPx: number; toCont: { x: number; y: number }
  } | null>(null)
  // Press-and-hold to move a placed symbol. Markers are NOT react-map-gl-draggable (that would
  // claim every pan/zoom that starts on a symbol and drag it instead of the map); instead a still
  // hold past the delay arms a drag — a quick flick to pan/zoom passes straight through to the map.
  // cx/cy = the pointer's start client px (the deadzone's reference); lx/ly = the pointer's client
  // px at the previous move; `last` = the coord this drag put the symbol at, i.e. where it is now.
  const hold = useHoldToDrag()
  const entDrag = useRef<{ id: string; cx: number; cy: number; lx: number; ly: number; moved: boolean; last: LngLat | null } | null>(null)
  // id of the symbol currently being dragged — shows the same selection halo as a real select
  // (dropped on drop). Set only once the drag clears the deadzone, so a hold that never moves
  // shows nothing.
  const [draggingId, setDraggingId] = useState<string | null>(null)
  /** the entity the finger actually holds when a drag was redirected to a docked marker's HOST
   *  (see `grab` below): the host moves, but it is not the thing being handled, so it wears no
   *  halo – the halo on the symbol under a dragged Trupp read as «that symbol is selected» */
  const grabbedId = useRef<string | null>(null)

  // ── the pile ────────────────────────────────────────────────────────────────────────────
  // Screen-px offsets for the markers of a fanned pile, keyed by entity id. Computed ONCE, at
  // the tap: they are a transient answer to "which of these did you mean", not a layout — so
  // they ride along with a pan (the pile moves as one) and the next tap ends them either way.
  // The view they were computed for is stored with them: a zoom or a rotation re-lays the whole
  // map out under the spokes, so the answer expires by DERIVATION rather than by an effect that
  // would have to race the re-render.
  // ⚠️ …and so does a member that has MOVED since. A spoke is a promise — the hairline says «this
  // glyph really stands there» — and a live position reporting a new fix (or a symbol another
  // device pushed) broke it: the glyph kept hanging off the old offset while its true point had
  // gone, which reads as the label coming off its dot. Their coordinates are part of the key.
  type FanOffsets = Record<string, { dx: number; dy: number }>
  const fanKey = (offsets: FanOffsets) => `${zoom}|${bearing}|` + Object.keys(offsets).sort()
    .map((id) => {
      const at = entities.find((x) => x.id === id)?.coord
      return at ? `${id}@${at[0]},${at[1]}` : id
    })
    .join('|')
  const [fanState, setFan] = useState<{ key: string; offsets: FanOffsets } | null>(null)
  const fan = fanState && fanState.key === fanKey(fanState.offsets) ? fanState.offsets : null
  const openFan = (offsets: FanOffsets) => setFan({ key: fanKey(offsets), offsets })
  // A tap anywhere that is not a fanned glyph closes the fan — including a tap on the map, which
  // this component never sees otherwise. Capture phase, and bound only while a fan is open.
  useEffect(() => {
    if (!fan) return
    const away = (ev: PointerEvent) => {
      if ((ev.target as Element | null)?.closest?.('.marker.fanned')) return
      setFan(null)
    }
    const esc = (ev: KeyboardEvent) => { if (ev.key === 'Escape') setFan(null) }
    document.addEventListener('pointerdown', away, true)
    document.addEventListener('keydown', esc)
    return () => { document.removeEventListener('pointerdown', away, true); document.removeEventListener('keydown', esc) }
  }, [fan])

  /**
   * Every marker whose fat-finger pad this tap landed in, nearest centre first.
   *
   * Compact, centre-anchored glyphs only. A note is a wide pill and a shape is metres across,
   * so "distance to my centre" says nothing useful about either — those keep the browser's own
   * hit test, which for a big box is the right answer anyway.
   */
  const pileUnder = (el: EventTarget & Element, clientX: number, clientY: number, self: Entity) => {
    if (!PILE_KINDS.includes(self.kind)) return []
    const r = el.closest('.maplibregl-map')?.getBoundingClientRect()
    if (!r) return []
    const tap = { x: clientX - r.left, y: clientY - r.top }
    const pad = (kind: string, at: LngLat) => Math.max(symPx(kind, at[1], zoom, symMul) + 20, 44)
    return pileAt(tap, [
      ...entities.flatMap((x) => {
        if (!PILE_KINDS.includes(x.kind) || !Array.isArray(x.coord) || !isVisible(effectiveLayer(x))) return []
        const p = project(x.coord as LngLat)
        // pad diameter mirrors .marker::before in 03-map.css — the hit test has to measure the
        // same slop the operator can see the effect of
        return p ? [{ id: x.id, x: p.x, y: p.y, pad: pad(x.kind, x.coord as LngLat) }] : []
      }),
    ])
  }

  // rotate a marker by dragging its handle: angle from the glyph centre to the pointer becomes the
  // glyph rotation (0° = pointing right). NOTE: these run from TransformHandle's NATIVE listeners
  // (see below), which stop propagation before react-map-gl's marker-drag can start — React's
  // delegated stopPropagation fires too late, so the marker would otherwise drag at the same time.
  const rotDown = (clientX: number, clientY: number, el: HTMLElement, id: string) => {
    hold.cancel() // a handle press takes over from any pending/active marker hold
    const marker = el.parentElement
    const glyph = (marker?.querySelector('.ts') ?? marker) as HTMLElement | null
    if (!glyph) return
    const r = glyph.getBoundingClientRect()
    rotateRef.current = { id, cx: r.left + r.width / 2, cy: r.top + r.height / 2 }
  }
  const rotMove = (clientX: number, clientY: number) => {
    const st = rotateRef.current; if (!st) return
    // store the GEOGRAPHIC heading (+ bearing) so it renders as −bearing and survives map rotation
    onRotate?.(st.id, rotorDeg({ x: clientX, y: clientY }, { x: st.cx, y: st.cy }, 'aim', bearing))
  }
  const rotUp = () => { rotateRef.current = null }

  // ── «Halten, dann verbindet es», an einem Rotationsende ──────────────────────────────────
  // The same claim a Leitung's endpoint makes, drawn with the same chip and the same ring
  // (components/NodeDeleteChip · ConnectRing): the end keeps following the finger while the ring
  // fills, and only a FULL ring puts it on the symbol. Nothing is STORED by it — a Rotation has
  // no attachment field and deliberately none — so what it buys is exactness: the run starts on
  // the Wasserbezug's own spot instead of a few metres beside it, and it says so before it does it.
  const [endMagnet, setEndMagnet] = useState<{ coord: LngLat; since: number; armed: boolean } | null>(null)
  const endMagnetRef = useRef<{ key: string; coord: LngLat; since: number; armed: boolean } | null>(null)
  const endDwellTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const clearEndMagnet = () => {
    if (endDwellTimer.current) { clearTimeout(endDwellTimer.current); endDwellTimer.current = null }
    if (endMagnetRef.current) { endMagnetRef.current = null; setEndMagnet(null) }
  }
  useEffect(() => () => { if (endDwellTimer.current) clearTimeout(endDwellTimer.current) }, [])
  /** Track the claim under a dragged end and answer with the point it should snap to — which is
   *  `null` until the ring has closed. `pt` is in the same client px the drag works in. */
  const trackEndMagnet = (id: string, pt: { x: number; y: number }, toCont: { x: number; y: number }) => {
    const p = { x: pt.x + toCont.x, y: pt.y + toCont.y }
    let best: { key: string; coord: LngLat; d: number; q: { x: number; y: number } } | null = null
    // the same targets the PLACEMENT magnet accepts (usePlaceMagnet · trackPlaceMagnet) — an end laid
    // onto a TLF must be re-dockable when it is dragged later, plan-drawn TLF included: it is an
    // entity on this map like any other now (lib/tacticalObjects)
    const anchors: { key: string; coord: LngLat }[] = [
      ...entities.flatMap((x) => (x.id !== id && isMagnetEntity(x) && Array.isArray(x.coord) && isVisible(effectiveLayer(x))
        ? [{ key: x.id, coord: x.coord as LngLat }] : [])),
    ]
    for (const a of anchors) {
      const q = project(a.coord); if (!q) continue
      const d = Math.hypot(q.x - p.x, q.y - p.y)
      if (d < MAGNET_RADIUS_PX && (!best || d < best.d)) best = { ...a, d, q }
    }
    if (!best) { clearEndMagnet(); return null }
    const cur = endMagnetRef.current
    if (cur?.key !== best.key) {
      clearEndMagnet()
      const st = { key: best.key, coord: best.coord, since: Date.now(), armed: false }
      endMagnetRef.current = st
      setEndMagnet({ coord: st.coord, since: st.since, armed: false })
      // arm on a motionless finger — there is no pointermove to advance a dwell by itself
      endDwellTimer.current = setTimeout(() => {
        const now = endMagnetRef.current
        if (!now || now.key !== st.key) return
        now.armed = true
        setEndMagnet({ coord: now.coord, since: now.since, armed: true })
        buzz()
      }, MAGNET_DWELL_MS)
      return null
    }
    // re-project every frame rather than reusing the anchor: a map that moves under the drag
    // must not leave the snap pointing at where the symbol used to be
    return cur.armed ? { x: best.q.x - toCont.x, y: best.q.y - toCont.y } : null
  }

  // drag-to-transform a shape. Both handles measure from the glyph centre, so the maths is
  // rotation-invariant: rotate = angle centre→pointer (+90° so the top handle leads); resize =
  // pointer distance → ground size in metres. A 'start' / 'end' pair folds the gesture into one undo.
  const shapeDown = (clientX: number, clientY: number, el: HTMLElement, id: string, lat: number, mode: ShapeGripMode) => {
    hold.cancel() // a handle press takes over from any pending/active marker hold
    const marker = el.closest('.marker')
    const glyph = marker?.querySelector('.shape-glyph, .ts') as HTMLElement | null
    if (!glyph) return
    const r = glyph.getBoundingClientRect() // rotated/scaled AABB — centre is unchanged
    const ent = entities.find((x) => x.id === id)
    const shape = ent?.kind === 'shape' ? (ent.shape ?? 'square') : null
    const cx = r.left + r.width / 2, cy = r.top + r.height / 2
    // ── the two ends of a Rotation ──────────────────────────────────────────────────────────
    // Dragging one end pins the OTHER one, so a single grip sets the run's length and its bearing
    // at once — which is exactly why the loop needs neither a rotate knob nor a size grip. Both
    // are worked out from the fixed end, so the answer stays exact however far the drag travels.
    let fixed: { x: number; y: number } | null = null
    let gripOffPx = 0
    let toCont = { x: 0, y: 0 }
    if ((mode === 'endA' || mode === 'endB') && ent) {
      const size = ent.sizeM ?? SHAPE_DEFS.rotation.defaultSizeM
      const ppm = pxPerM(lat, zoom)
      const half = (rotationRun(size, ent.aspect) * ppm) / 2
      const rad = (((ent.rotation ?? 0) - bearing) * Math.PI) / 180
      const away = mode === 'endA' ? 1 : -1 // the end that stays put is the far one
      fixed = { x: cx + Math.cos(rad) * half * away, y: cy + Math.sin(rad) * half * away }
      gripOffPx = rotationGripOffPx(size * shapeAspect('rotation', ent.aspect) * ppm)
      // client px → container px, so the new centre can be unprojected. Snapshotted like every
      // other handle's anchor: it only goes stale if the map transform changes mid-gesture.
      const pc = project(ent.coord as LngLat)
      if (pc) toCont = { x: pc.x - cx, y: pc.y - cy }
    }
    shapeRef.current = {
      id, cx, cy, lat, mode, fixed, gripOffPx, toCont,
      rot: (ent?.rotation ?? 0) - bearing,
      free: (mode === 'resize' || mode === 'width') && !!shape && SHAPE_FREE_ASPECT[shape],
      // A shape with one grip per axis captures whichever axis the drag must LEAVE ALONE: the ↔
      // grip sets the x-axis and keeps the height, the ↕ grip sets the y-axis and keeps the
      // length. Without this the only way to make a Rotation long was to make it enormous in both.
      keepHeightM: !shape || !SHAPE_AXIS_GRIPS[shape] ? null
        : mode === 'width' ? Math.max(1, ent?.sizeM ?? SHAPE_DEFS[shape].defaultSizeM)
        : Math.max(1, (ent?.sizeM ?? SHAPE_DEFS[shape].defaultSizeM) * shapeAspect(shape, ent?.aspect)),
      aspectMax: shape ? shapeAspectMax(shape) : 5,
      // …and how far it may be stretched along its long axis. A Wasserpendel between the Weiher
      // and the Brandstelle is kilometres; every other shape stays inside the general cap
      // (lib/shapes · SHAPE_MAX_M — the same number the ± stepper clamps to).
      maxM: SHAPE_MAX_M[shape ?? 'square'],
    }
    onShapeTransform?.(id, {}, 'start')
  }
  const shapeMove = (clientX: number, clientY: number) => {
    const st = shapeRef.current; if (!st) return
    if ((st.mode === 'endA' || st.mode === 'endB') && st.fixed) {
      // One end moves, the other stays: length, bearing and centre all fall out of the pair, and
      // the width follows the run (lib/shapes · rotationBox). Everything the app stores about the
      // loop is rewritten from these two points, which is what makes them the only two grips.
      const f = st.fixed
      // the grip floats past the cap, so the END is the pointer pulled back along the run
      let { x: ex, y: ey } = rotationEnd({ x: clientX, y: clientY }, f, st.gripOffPx)
      const snap = trackEndMagnet(st.id, { x: ex, y: ey }, st.toCont)
      if (snap) { ex = snap.x; ey = snap.y }
      const ppm = pxPerM(st.lat, zoom)
      const runM = Math.max(SHAPE_MIN_M, Math.min(ROTATION_MAX_M, Math.hypot(ex - f.x, ey - f.y) / ppm))
      const { size, aspect } = rotationBox(runM, ROTATION_W_M)
      const c = unproject({ x: (f.x + ex) / 2 + st.toCont.x, y: (f.y + ey) / 2 + st.toCont.y })
      if (!c) return
      onShapeTransform?.(st.id, {
        coord: c,
        // the run points fixed→dragged when the far end is A, and the other way when it is B
        rotation: rotationEndDeg(st.mode, f, { x: ex, y: ey }, bearing),
        sizeM: Math.round(size),
        aspect: Math.round(aspect * 1000) / 1000,
      }, 'move')
      return
    }
    if (st.mode === 'cage') {
      // Hubretter cage tip: one handle sets BOTH the boom bearing (rotation2, geographic) AND the
      // reach (metres from the truck to the cage). No +90/−90 offset — the handle IS the tip, so its
      // angle is the boom direction directly.
      const rotation2 = rotorDeg({ x: clientX, y: clientY }, { x: st.cx, y: st.cy }, 'aim', bearing)
      const dist = Math.hypot(clientX - st.cx, clientY - st.cy)
      const reachM = Math.max(5, Math.min(120, Math.round(dist / pxPerM(st.lat, zoom))))
      onShapeTransform?.(st.id, { rotation2, reachM }, 'move')
    } else if (st.mode === 'rotate' || st.mode === 'rotate2') {
      // the body knob sits at the top (+90 → 0°); the fan knob sits at the BOTTOM (−90), so the two
      // are always on opposite sides of the ring and easy to grab apart. + bearing stores the
      // GEOGRAPHIC angle (renders as −bearing).
      const val = rotorDeg({ x: clientX, y: clientY }, { x: st.cx, y: st.cy }, st.mode, bearing)
      onShapeTransform?.(st.id, st.mode === 'rotate2' ? { rotation2: val } : { rotation: val }, 'move')
    } else if (st.free) {
      // free-aspect corner drag (Rechteck / Rauch): the pointer offset, rotated into the
      // shape's own frame, sets width from |dx| and height from |dy| independently. Same
      // maths as the Plan's resize (Whiteboard · rotMove), so the two surfaces feel identical.
      const { lx, ly } = freeResizeLocal({ x: clientX, y: clientY }, { x: st.cx, y: st.cy }, st.rot)
      const ppm = pxPerM(st.lat, zoom)
      // ⚠️ GROUND metres, not screen px (lib/shapes · SHAPE_MIN_M): a pixel floor would store a
      // different real-world size depending on the zoom the drag happened at, and one zoom step
      // in would let the same drag continue past it.
      const minM = SHAPE_MIN_M
      if (st.keepHeightM != null) {
        // ── one grip, one axis (lib/shapes · SHAPE_AXIS_GRIPS) ──
        // The captured axis is the one that must not move, so a drag says exactly what its glyph
        // promises: ↕ makes the box taller and leaves its length alone, ↔ makes it longer and
        // leaves its height alone. `aspectMax` is what keeps a Rotation from inverting into a
        // sliver with its arrows pointing at each other (it is 1 there, 5 for a Rechteck).
        const asp = (h: number, len: number) =>
          Math.max(0.02, Math.min(st.aspectMax, Math.round((h / len) * 1000) / 1000))
        if (st.mode === 'width') {
          const lengthM = st.keepHeightM // captured LENGTH in this mode
          const heightM = Math.max(minM, Math.min(lengthM * st.aspectMax, (2 * Math.abs(ly)) / ppm))
          onShapeTransform?.(st.id, { sizeM: Math.round(lengthM), aspect: asp(heightM, lengthM) }, 'move')
          return
        }
        const heightM = st.keepHeightM // captured HEIGHT in this mode
        // never shorter than `aspectMax` allows — that floor is what a Rotation's «never taller
        // than it is long» becomes once the cap is per-shape
        const floorM = Math.max(minM, heightM / st.aspectMax)
        const sizeM = Math.max(floorM, Math.min(st.maxM, Math.round((2 * Math.abs(lx)) / ppm)))
        onShapeTransform?.(st.id, { sizeM: Math.round(sizeM), aspect: asp(heightM, sizeM) }, 'move')
        return
      }
      const sizeM = Math.max(minM, Math.min(st.maxM, Math.round((2 * Math.abs(lx)) / ppm)))
      const heightM = Math.max(minM, Math.min(st.maxM, Math.round((2 * Math.abs(ly)) / ppm)))
      const aspect = Math.max(0.2, Math.min(5, Math.round((heightM / sizeM) * 100) / 100))
      onShapeTransform?.(st.id, { sizeM, aspect }, 'move')
    } else {
      const ppm = pxPerM(st.lat, zoom)
      const dist = Math.hypot(clientX - st.cx, clientY - st.cy)
      const sizeM = (dist * Math.SQRT2) / ppm // corner handle = half-diagonal
      // …and the same ground floor for a proportional shape (the Pfeil)
      onShapeTransform?.(st.id, { sizeM: Math.max(SHAPE_MIN_M, Math.min(st.maxM, Math.round(sizeM))) }, 'move')
    }
  }
  const shapeUp = () => { const st = shapeRef.current; clearEndMagnet(); if (!st) return; shapeRef.current = null; onShapeTransform?.(st.id, {}, 'end') }

  // ONE select path for every tap that means «this one». A NOTE opens its panel on that same
  // tap (decided 29.08.) — the symbol grammar, unified: tap = panel, drag = move. The panel
  // carries edit + Löschen, and a read-only surface opens it read-only.
  const selectEntity = (ent: Entity) => {
    onSelect(ent)
    if (ent.kind === 'note') onNotePanel?.(ent.id)
  }

  // ── the inline note editor (see focusNote above) ──
  const noteChange = (ev: React.ChangeEvent<HTMLTextAreaElement>, id: string) => { onNoteText?.(id, ev.target.value); autoGrow(ev.currentTarget) }
  const noteBlur = (ev: React.FocusEvent<HTMLTextAreaElement>, id: string) => {
    // A blur in the first moment after placement is NOT the user leaving the
    // field — it's MapLibre focusing its canvas (and/or a select-panel mount)
    // stealing focus. Committing here would set editNoteId=null and unmount the
    // input before a key can be pressed ("placed but not focused"). So inside a
    // short window, bounce focus straight back and skip the commit; a deliberate
    // click-away always lands well after this (human reaction ≥ ~200ms).
    const el = ev.currentTarget
    if (!noteForceCommit.current && Date.now() - noteEditStart.current < 350) { requestAnimationFrame(() => el.focus()); return }
    noteForceCommit.current = false
    onNoteCommit?.(id, ev.target.value)
  }
  // Enter makes a new line — the ✓, Esc and clicking away are the way out.
  // `noteForceCommit` tells the blur this is a deliberate commit, so the 350ms
  // focus-steal guard above lets it through instead of bouncing focus back.
  const noteKeyDown = (ev: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (ev.key === 'Escape') {
      ev.preventDefault(); noteForceCommit.current = true; (ev.target as HTMLTextAreaElement).blur()
    }
  }
  /** the ✓ Fertig (bound on pointerdown: the textarea's blur unmounts the button first) */
  const noteDone = (id: string, text: string) => { noteForceCommit.current = true; onNoteCommit?.(id, text) }

  /** A press on one marker's body (EntityMarker): tap selects, resolving the pile under the pad;
   *  press-and-hold (touch) / press-and-drag (mouse) moves. `dockDragStart` = where a docked
   *  Trupp marker is drawn, so its drag starts from the slot. See useHoldToDrag. */
  const pressMarker = (ev: React.PointerEvent<HTMLDivElement>, e: Entity, dockDragStart: () => LngLat | null) => {
    const cx = ev.clientX, cy = ev.clientY
    // Which marker did the finger MEAN? Not "whichever DOM node happened to be on
    // top" — that is placement order, and it is how a tap on the Wasserbezugsort
    // handed you the Kleinlöscher. Resolve the whole pile under the pad by nearest
    // centre; a SELECT then targets that one.
    // ⚠️ A DRAG does not: it acts on the marker actually pressed. Nearest-centre
    // only ever differs from it when the pad covers several markers — and there the
    // tap makes no choice either, it fans the pile out and asks. Letting the drag
    // guess there moved a neighbour the finger never touched (and, when the neighbour
    // was a live person position, silently refused to move anything at all).
    const pile = pileUnder(ev.currentTarget, cx, cy, e)
    const near = (pile.length ? entities.find((x) => x.id === pile[0].id) : undefined) ?? e
    const fanned = !!fan
    // A DOCKED Trupp marker is moved as one with its host (15.09., «dragging either
    // should move both»): the grip lands on the marker, the drag is the symbol's,
    // and the marker rides along in its slot (lib/docking · carryDocked). Parting
    // them is the pill's own «Lösen», never a drag.
    const host = e.kind === 'team' && e.dockedTo ? entities.find((h) => h.id === e.dockedTo && Array.isArray(h.coord)) : undefined
    const grab = host ?? e
    // pointerId/isPrimary ride along so the gesture stays bound to THIS finger: the
    // second finger of a pinch must go to the map, never steer a symbol (useHoldToDrag)
    hold.begin({ clientX: cx, clientY: cy, pointerId: ev.pointerId, isPrimary: ev.isPrimary }, {
      onTap: () => {
        // already fanned: the spokes ARE the choice, so this tap is the answer
        if (fanned) { setFan(null); selectEntity(e); return }
        // more than one candidate under the finger → fan them out instead of
        // guessing. One candidate → select it straight away, exactly as before.
        if (pile.length > 1) { openFan(fanOffsets(pile)); return }
        selectEntity(near)
      },
      onHoldStart: () => {
        // a rotor / shape-transform gesture owns the pointer — never also translate
        if (rotateRef.current || shapeRef.current) { hold.cancel(); return }
        entDrag.current = { id: grab.id, cx, cy, lx: cx, ly: cy, moved: false, last: host ? (host.coord as LngLat) : dockDragStart() }
        grabbedId.current = e.id
        // don't select here: a quick hold-drag to reposition shouldn't open the
        // ContextPanel. The move targets the symbol by id regardless of selection;
        // selection (→ panel) is deferred to onDragEnd and only if it never moved.
        setDragPan(false) // stop the map panning under the held symbol
      },
      onDragMove: (mx, my) => {
        const st = entDrag.current; if (!st || st.id !== grab.id) return
        // deadzone: don't move until the finger clears DRAG_DEADZONE_PX from the grab point
        if (!st.moved && Math.hypot(mx - st.cx, my - st.cy) < DRAG_DEADZONE_PX) return
        // Re-anchor on EVERY move: project where the symbol is NOW through the LIVE map
        // transform and add only the pointer travel since the last move. A screen-px
        // anchor snapshotted at the grab goes stale the instant the map moves under the
        // finger (a pinch, a container resize, a programmatic jumpTo) — unprojecting it
        // through the new transform then teleports the symbol, which is what «bugs out
        // when the map resizes» looked like. Incrementally, a changed transform costs
        // nothing: the symbol simply keeps its screen offset to the finger.
        const base = project((st.last ?? grab.coord) as LngLat)
        if (!base) return
        const nc = unproject({ x: base.x + (mx - st.lx), y: base.y + (my - st.ly) })
        if (!nc) return
        st.lx = mx; st.ly = my
        // snapshot for undo + show the selection halo on first real move — and on a
        // phone let the detail sheet peek away, so the drag has the whole surface
        if (!st.moved) { st.moved = true; onMarkerDragStart(grab.id); setDraggingId(grab.id); beginSheetPeek() }
        st.last = nc
        onMarkerMove(grab.id, nc)
      },
      onDragEnd: () => {
        const st = entDrag.current; entDrag.current = null
        setDragPan(true)
        setDraggingId(null) // drop the halo once it stops moving
        endSheetPeek() // …and the sheet comes back to the height it had
        if (st?.moved && st.last) onMarkerDragEnd(grab.id, st.last)
        // held but never dragged → treat as a select (open the panel). A SELECT
        // resolves the pile like a tap does — by nearest centre, never by whichever
        // node is on top — or a slow gloved tap would hand out the wrong marker
        // while a quick one on the same spot got it right.
        else if (selectedId !== near.id) selectEntity(near)
      },
      // An already-selected symbol (panel open) drags INSTANTLY like a mouse — move
      // on the first travel, no hold delay. Unselected touch still needs the deliberate
      // hold so a pan/flick starting on a symbol doesn't grab it.
      // A self-reported crew position is the one marker nobody may drag. A live
      // VEHICLE can be nudged — that override is a deliberate feature — but moving
      // a person's dot would have the operator assert where somebody is, which is
      // a different and unbacked claim from the one the dot makes.
      // While a pile is fanned nothing drags: the glyphs are standing off their
      // real positions, so a drag would write back a coordinate nobody chose.
    // ⚠️ A FORM has no body drag at all (02.09.): it is moved from the bar's ✥ — dragged
      // as the small adjustment, or armed for the whole surface. Its body is a
      // tap-select target and nothing else, so a press that starts on a Rotation's
      // loop still pans the map, and the shape can never be nudged by a mis-aimed
      // tap on the very grip somebody was reaching for.
    }, { mode: selectedId === e.id || ev.pointerType === 'mouse' ? 'mouse' : 'touch', canDrag: draggable && e.kind !== 'person' && e.kind !== 'shape' && !fanned && !e.locked })
  }

  // ── Andocken: der feste Platz (lib/docking, 15.09.2026) ────────────────────────────────────
  // A Trupp marker docked onto a symbol is DRAWN at that symbol's bottom-left corner — one place,
  // every time, whatever corner of the tile the hand let go over — and several of them stack
  // downwards. Resolved once per frame for the whole layer, because both sides of the bond read
  // it: the marker (its `<Marker>` anchors on the HOST and offsets into the slot) and the host
  // (the `link` badge on its tile, titled with the crews it carries).
  const dockedSlots = dockSlots(entities)
  const dockedHosts = new Map<string, string[]>()
  for (const e of entities) {
    if (!dockedSlots.has(e.id) || !e.dockedTo) continue
    dockedHosts.set(e.dockedTo, [...(dockedHosts.get(e.dockedTo) ?? []), e.label || appConfig.copy.entities.fallbackObjectName])
  }

  // entity markers — guard against malformed entities (e.g. a server workspace
  // missing a coord) so one bad row can't white-screen the whole map
  return (
    <>
      {entities.filter((e) => isVisible(effectiveLayer(e)) && Array.isArray(e.coord)).map((e) => (
        <EntityMarker
          key={e.id} e={e} entities={entities} byName={byName} selectedId={selectedId}
          groupSelectedIds={groupSelectedIds} networkEntityIds={networkEntityIds}
          zoom={zoom} bearing={bearing} symMul={symMul} captionMode={captionMode} suppressedLabels={suppressedLabels}
          readOnly={readOnly} draggable={draggable} editNoteId={editNoteId} project={project} unproject={unproject}
          spoke={fan?.[e.id]} draggingId={draggingId} grabbedId={grabbedId.current}
          dockedSlots={dockedSlots} dockedHosts={dockedHosts} onPress={pressMarker}
          rotDown={rotDown} rotMove={rotMove} rotUp={rotUp} shapeDown={shapeDown} shapeMove={shapeMove} shapeUp={shapeUp}
          focusNote={focusNote} focusTeam={focusTeam} noteChange={noteChange} noteBlur={noteBlur} noteKeyDown={noteKeyDown} noteDone={noteDone}
          onDelete={onDelete} onRotate={onRotate} onShapeTransform={onShapeTransform} onUnlockShape={onUnlockShape} onNoteEdit={onNoteEdit}
          trupps={trupps} onShowTrupp={onShowTrupp} onTeamTrupp={onTeamTrupp} onTeamNewTrupp={onTeamNewTrupp} onTeamMark={onTeamMark}
          onTeamRename={onTeamRename} onTeamClearTrail={onTeamClearTrail} onTeamRemoveWithTrail={onTeamRemoveWithTrail}
          hiddenTrails={hiddenTrails} onToggleTrail={onToggleTrail} teamLines={teamLines} onTeamUnlink={onTeamUnlink} onTeamUndock={onTeamUndock}
        />
      ))}
      {/* the attachment ring at a Rotation end's claimed symbol — the same chip the Leitungen
          raise, so «halten, dann verbindet es» is one thing to learn (see trackEndMagnet) */}
      {endMagnet && (
        <Marker key={`rotend:${endMagnet.since}`} longitude={endMagnet.coord[0]} latitude={endMagnet.coord[1]} anchor="center">
          <span className="magnet-anchor"><ConnectRing since={endMagnet.since} armed={endMagnet.armed} /></span>
        </Marker>
      )}
      {/* Geister-Spuren: the searched area a removed Trupp marker left behind (lib/truppTrails).
          Read-only and grey — it is a record, not a Trupp, so it is not selectable as one. The
          LABEL is the hit target: one tap offers «Spur löschen» with the same confirm the live
          trail has (IncidentWorkspace · deleteGhostTrail), and that is undoable. Without the
          writer (a locked surface) the label is a plain read-out. */}
      {ghostTrails?.map((g) => {
        const pts = g.geo ?? []
        const head = pts[pts.length - 1]
        return (
          <Fragment key={g.id}>
            {pts.map((p, i) => (
              <Marker key={`${g.id}-${i}`} longitude={p.coord[0]} latitude={p.coord[1]} anchor="center" draggable={false} style={{ pointerEvents: 'none' }}>
                <div className="map-trail-dot map-ghost-trail">
                  <span className="wb-trail-mark" />
                  <i>{p.t}</i>
                </div>
              </Marker>
            ))}
            {head && (
              <Marker longitude={head.coord[0]} latitude={head.coord[1]} anchor="center" draggable={false}>
                {onGhostTrail ? (
                  <button className="wb-ghost-label" style={{ position: 'relative', transform: 'translateY(-16px)' }}
                    title={fillTemplate(appConfig.copy.whiteboard.ghostTrailHint, { name: ghostLabel(g) })}
                    onClick={(ev) => { ev.stopPropagation(); onGhostTrail(g.id) }}>
                    <Icon id="footprint" />{ghostLabel(g)}
                  </button>
                ) : (
                  // a locked surface has no «Spur löschen»: the label is a read-out, not a dead button
                  <span className="wb-ghost-label" style={{ position: 'relative', transform: 'translateY(-16px)' }}
                    title={fillTemplate(appConfig.copy.whiteboard.ghostTrailHint, { name: ghostLabel(g) })}>
                    <Icon id="footprint" />{ghostLabel(g)}
                  </span>
                )}
              </Marker>
            )}
          </Fragment>
        )
      })}
      {/* team trail breadcrumbs (recorded via «Position markieren») — same dot + timestamp
          look as the plan board; pointer-transparent so they never block a map tap */}
      {entities.filter((e) => e.kind === 'team' && isVisible(effectiveLayer(e)) && Array.isArray(e.coord) && e.trail?.length && !hiddenTrails?.has(e.id)).flatMap((e) =>
        (e.trail ?? []).map((p, i) => (
          // style on the Marker itself: the WRAPPER div must be pointer-transparent too,
          // or a dot lying under the pill (marked without moving) swallows the pill's tap
          <Marker key={`${e.id}-trail-${i}`} longitude={p.coord[0]} latitude={p.coord[1]} anchor="center" draggable={false} style={{ pointerEvents: 'none' }}>
            <div className="map-trail-dot">
              <span className="wb-trail-mark" style={{ background: e.color || appConfig.drawing.teamColors[0] }} />
              {!suppressedLabels?.has(`crumb:${e.id}:${i}`) && <i>{p.t}</i>}
            </div>
          </Marker>
        )),
      )}
    </>
  )
}
