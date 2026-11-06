// The Lage – the MapLibre map of an Einsatz, also «Karte & Objekte»'s station viewer: base and
// overlay layers, placed objects and Trupps, drawn lines / areas / circles with their handles,
// labels, measuring and georeferencing. Every coordinate is WGS84 `[lng, lat]`.
// Lage ↔ Plan parity is a review criterion: a tool, grip or gesture changed here is changed on
// the Plan too (Whiteboard, WbControls). Colour means a Trupp's IDENTITY on this map.
// Rules: docs/tactical-objects.md; the station viewer: docs/karte-objekte.md.

import { forwardRef, Fragment, Suspense, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties } from 'react'
import Map, { Marker, Source, Layer, type MapRef, type MapLayerMouseEvent } from 'react-map-gl/maplibre'
import type { Map as MlMap } from 'maplibre-gl'
import { useHiddenTrails } from '../lib/useHiddenTrails'
import 'maplibre-gl/dist/maplibre-gl.css'
import '../lib/maplibreWorker'
import type { Drawing, LineAttachment, LineEndpoint, LngLat } from '../types'
import { appConfig } from '../config/appConfig'
import { beginSheetPeek, endSheetPeek } from '../lib/sheetPeek'
import { motionDuration } from '../lib/reducedMotion'
import { createNorthSnap, gateTouchRotation, NORTH_SNAP_MS } from '../lib/mapTwist'
import { Icon } from '../lib/icons'
import { isDemoMode } from '../lib/deploymentConfig'
import { LockChip } from './LockChip'
import { LINE_DASH_ML } from '../lib/draw'
import { MapImages } from './MapImages'
import { markerParamsAlong, markerSpacing, lerpPoint, vertexHandleIndices, evenIndices, arrowEndIndices, DEFAULT_INK, EXTEND_STEP_PX } from '../lib/lineStyle'
import { centroid, rotateAround, turnedBy } from '../lib/selectionTransform'
import { SelectionBar } from './SelectionBar'
import { SelectionTurn } from './SelectionTurn'
import { useArmedTransform } from '../lib/useArmedTransform'
import { SHAPE_MAX_PX } from '../lib/shapes'
import { EMPTY_STYLE, END_TAG_LABEL_STYLE, mapMaxZoom, vis, fc, lineFeat, polyFeat, pathSegmentCount, resumeViewState, shapePx, symPx, effectiveLayer, nativeDrawingChromeVisible, lineLabelAction } from '../lib/mapView'
import { TeilstueckFork, EndTag, hasLineDecor } from '../lib/lineDecor'
import { WAND_MAP_PX } from '../lib/grundriss'
import { cachedLabelSize, MARKER_Z } from '../lib/labelPass'
import { END_TAG_HELD_OFFSET, endDirection, endTagOffset, endTagSide, endTagText, MAP_ARROW_BACK_PX } from '../lib/endTagSpots'
import { lineTakesTrupp, teamLineBadges, truppForLine, truppLineTone } from '../lib/truppLines'
import { pathLengthM, fmtDistance, fmtArea, polygonAreaM2, hoseLengthHint, circlePolygon, haversineM } from '../lib/geo'
import { hoseLines } from '../lib/hydraulics'
import { useVehicleTrails } from '../lib/useVehicleTrails'
import { useMapCanvasGestures } from './useMapCanvasGestures'
import { mapMagnetTargets } from './mapMagnetTargets'
import { useMapMagnet } from './useMapMagnet'
import { usePlaceMagnet } from './usePlaceMagnet'
import { useTruppMarkerAim } from './useTruppMarkerAim'
import { useLabelPass } from './useLabelPass'
import { routeMapClick } from './mapClick'
import { VIEWER_TACTICAL, type MapViewProps } from './mapViewProps'
import { LineMarker } from './LineMarker'
import { MapMarkers } from './MapMarkers'
import { RelayPumpMarkers } from './RelayPumpMarkers'
import { ChartCursorMarker } from './ChartCursorMarker'
import { MapLayers } from './MapLayers'
import { WeatherRadarSource } from './weatherLazy'
// long-press to delete a path vertex (touch — desktop right-click kept); the placed-object
// move threshold lives in MapMarkers with the entity-drag logic.
import { useNodeHold } from '../lib/nodeHold'
import { ConnectRing, NodeDeleteChip } from './NodeDeleteChip'
import { useGlRecovery } from '../lib/useGlRecovery'
import { useNightTheme } from '../lib/useNightTheme'
import { themeToken, uiBlue } from '../lib/themeToken'
import { fillTemplate } from '../lib/format'
import { useIsPhone } from '../lib/useIsPhone'
import { reportMapError } from '../lib/mapError'
import { isTypingTarget } from '../lib/hotkeys'
import { QuietAttributionControl } from './MapAttribution'
import { GeorefCheckOutline, GeorefMapLoupe, GeorefMapMarks } from './GeorefMapLayer'
import { georefDispatch, georefPhoneTargetPoint, georefTapOnMarker, georefWantsMap, registerGeorefPhoneTarget, useGeorefMapTap, useGeorefMode } from '../lib/georefMode'
import { DRAG_DEADZONE_PX } from '../lib/useHoldToDrag'
import { oneFingerZoom, setMapOneFingerZoom } from '../lib/tapDragZoom'
import { useFreshPoint } from '../lib/useFreshPoint'
import { setLiveBearing } from '../lib/liveBearing'
import { dismissRelayBubble } from '../lib/useRelay'
import { LABEL_ABOVE, measureLabelPlacement } from '../lib/measureLabelPlace'
import { attachInsetPx, lineJoints, boundaryPoint, DETACH_SHOW_PROGRESS, dwellFor, forkPortPoint, gpsGuard, moveLineBody, relationshipNetwork, resolveLinePoints, type AttachableLine, type MagneticTarget } from '../lib/lineAttachments'

/** The ink a ghost «Spur» is drawn in — neutral grey, not the Trupp's colour: colour means
 *  IDENTITY on this map (lib/teamColors), and a trail whose marker is gone must not claim that a
 *  Trupp is standing somewhere. A frozen value rather than a token because MapLibre's paint
 *  cannot read a CSS custom property; it is deliberately mid-grey, so it reads on both themes.
 *  An OUT Trupp's trail line wears it too (dimmed): its colour has stopped meaning «here». */
const GHOST_TRAIL_INK = '#8a8f98'
/** How much of a Fläche's / circle's stored wash (`fillOpacity`, data – never rewritten) is painted
 *  at NIGHT (hill climb r17, Opus 7): a translucent red over the dark base mixes into a muddy
 *  brown, so the night wash is thinner and the zone reads as its stroke's hue. Day paints it whole. */
const NIGHT_FILL_SCALE = 0.5
/** The open draft's marching dashes (27.10.2026): MapLibre cannot animate a dash offset, so the
 *  dash pattern itself steps through one period — MapLibre's own «animate a line» recipe. */
const DRAFT_ANTS: number[][] = [
  [0, 4, 3], [0.5, 4, 2.5], [1, 4, 2], [1.5, 4, 1.5], [2, 4, 1], [2.5, 4, 0.5], [3, 4, 0],
  [0, 0.5, 3, 3.5], [0, 1, 3, 3], [0, 1.5, 3, 2.5], [0, 2, 3, 2], [0, 2.5, 3, 1.5], [0, 3, 3, 1], [0, 3.5, 3, 0.5],
]

// Every edit handle of a SELECTED drawing (node pads, «+» midpoints, grow arrows, detach chips,
// the Absperrkreis's radius ring) rides at MARKER_Z.selected: a react-map-gl
// marker defaults to z-auto, which paints BELOW every resting symbol/team (MARKER_Z 4–8), so the
// very handles a selection exists for disappeared behind the symbols the line ran under — the
// endpoint could not be grabbed to extend it (28.08. field feedback). One stacking table for all
// of it (lib/labelPass), like the end tags directly below.
const handleZ: React.CSSProperties = { zIndex: MARKER_Z.selected }
/** …and a measuring point a tap JUST placed (lib/useFreshPoint): click-through for one tap gap, so
 *  the tap pair's second press reaches MapLibre's tap-and-drag zoom instead of grabbing the point.
 *  `auto` spelled out on the live one: react-map-gl writes the style keys it is given and never
 *  removes one, so a dropped `none` would stay on the element. */
const handleFresh: React.CSSProperties = { ...handleZ, pointerEvents: 'none' }
const handleLive: React.CSSProperties = { ...handleZ, pointerEvents: 'auto' }
/** the `measurePoints` default — a module constant, so an absent prop keeps ONE identity and the
 *  memoized measure source below is not rebuilt on every render */
const NO_POINTS: LngLat[] = []

/** a circle drawing as a closed polygon ring (LngLat[]) for rendering / selection outline. */
const circleRing = (d: Drawing): LngLat[] => circlePolygon(d.coords[0], d.radiusM ?? 0)[0] as LngLat[]
/** How far a press on a RESTING end tag may travel and still count as a tap. The drag deadzone
 *  (8px) is the wrong ruler for a finger: a gloved 3am tap wanders further than that, and every
 *  one of those was silently dropped — which is why a tag nobody's marker covered («50 · S · +1 ·
 *  Müller H.» on a Leitung whose Trupp is out) simply did nothing. Same slop useHoldToDrag gives
 *  a marker tap (TAP_TOL_PX). */
const TAG_TAP_TOL_PX = 16
/** How long after a pan/pinch a `click` still counts as the tail of that gesture. The browser
 *  synthesizes its mouse trail right after touchend, so the trailing click arrives a few ms AFTER
 *  MapLibre's dragend — but well inside this window, which no second deliberate tap fits in. */
const PAN_CLICK_TAIL_MS = 350
/** Keep MapLibre's own KeyboardHandler off while a text field owns focus — the map must not
 *  zoom/pan on a «+», «-» or an arrow that is being TYPED. Idempotent, so it is safe to call
 *  from a focus event and from every render (see the two effects that use it). */
function syncMapKeyboard(map: MlMap | null): void {
  if (!map?.keyboard) return
  if (isTypingTarget(document.activeElement)) map.keyboard.disable()
  else map.keyboard.enable()
}

// The grip that MAKES a node and hands it straight to the finger. Two of them are built on it: the
// "+" at the middle of a measured/selected segment, and the «Verlängern» arrow past an open line
// end. The "+" — the Plan already had one per segment
// (WbControls · Messen), and tapping a thin dashed line to land a point between two others is
// the aim that fails with gloves on. Its listeners are NATIVE, not React's: React delegates at
// the tree root, which is an ANCESTOR of the map container, so maplibre's own listener on the
// canvas container has already fired by then — the same tap would insert here AND append a
// point at the end of the path, which is the opposite of what was asked for.
//
// ⚠️ pointerdown INSERTS and hands the new node straight on to the caller's drag (25.08. field
// exercise): «tap the +, then find the node it left behind, then drag that» is three aims where
// there should be one. A release without movement leaves exactly what the old plain click left —
// one node at the segment's midpoint — so nothing was taken away. `onInsert` is called with the
// pointer event when there is one, and with `null` for a keyboard activation (Enter/Space on the
// focused button reports `detail === 0`), where there is no gesture to hand over.
function NewNodeHandle({ title, onInsert, className = 'measure-insert', icon = 'plus', style }: {
  title: string
  onInsert: (e: PointerEvent | null) => void
  /** the two grips built on this: the «+» midpoint insert (default) and the «Verlängern» arrow */
  className?: string
  icon?: string
  style?: React.CSSProperties
}) {
  const ref = useRef<HTMLButtonElement>(null)
  // re-bind each render so the closure sees the current onInsert (one element, one listener)
  useEffect(() => {
    const el = ref.current
    if (!el) return
    const swallow = (e: Event) => e.stopPropagation()
    const down = (e: PointerEvent) => { e.stopPropagation(); e.preventDefault(); onInsert(e) }
    const click = (e: Event) => {
      e.stopPropagation(); e.preventDefault()
      if ((e as MouseEvent).detail !== 0) return // a pointer already inserted on its way down
      onInsert(null)
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
  })
  return <button ref={ref} type="button" className={className} title={title} aria-label={title} style={style}><Icon id={icon} /></button>
}

/** The pairs of ADJACENT shown handles a «+» goes between: `[a, b]` index pairs into the stored
 *  coords, walking the path in order. An area adds the closing gap (last shown → first, through
 *  the wrap), which is the edge `pathSegmentCount` has always counted for it. */
export function handleGaps(shown: number[], n: number, isArea: boolean): [number, number][] {
  if (shown.length < 2) return []
  const out: [number, number][] = []
  for (let k = 0; k < shown.length - 1; k++) out.push([shown[k], shown[k + 1]])
  if (isArea && n >= 3) out.push([shown[shown.length - 1], shown[0]])
  return out
}

/** Where a «+» between the shown pads `a` and `b` sits, and at which index its node is inserted:
 *  the point half-way ALONG the stored path between them, not on the chord across it. So the node
 *  it leaves lies on the ink and the line does not change shape — on a line whose every vertex has
 *  a pad (b === a + 1) this is the plain segment midpoint.
 *
 *  Lengths are measured planar in degrees, like `editCentroid` beside it: the whole path is a few
 *  hundred metres, and «half-way» only has to land somewhere sensible in the gap. */
export function subPathInsert(coords: LngLat[], a: number, b: number): { index: number; coord: LngLat } {
  const n = coords.length
  const steps = ((b - a + n) % n) || n // the area's closing gap wraps past the last vertex
  const at = (k: number) => coords[(a + k) % n]
  const seg: number[] = []
  let total = 0
  for (let k = 0; k < steps; k++) {
    const p = at(k), q = at(k + 1)
    const d = Math.hypot(q[0] - p[0], q[1] - p[1])
    seg.push(d); total += d
  }
  let acc = 0
  for (let k = 0; k < steps; k++) {
    const last = k === steps - 1
    if (!last && acc + seg[k] < total / 2) { acc += seg[k]; continue }
    const t = seg[k] > 0 ? Math.min(1, Math.max(0, (total / 2 - acc) / seg[k])) : 0.5
    const p = at(k), q = at(k + 1)
    return { index: (a + k) % n + 1, coord: [p[0] + (q[0] - p[0]) * t, p[1] + (q[1] - p[1]) * t] }
  }
  // unreachable (steps ≥ 1), but a total of 0 must still hand back a usable point
  return { index: a + 1, coord: coords[a] }
}

/** Whether the Karte takes its automatic coarse own-position fix (the default blue dot,
 *  05.09.). NOT on the public demo (06.09.): the map is the first thing a visitor sees, so
 *  the un-gestured fix threw the browser's LOCATION dialog at them on arrival — the same
 *  data-protection line as the demo's notification ask, and Musterdorf is nobody's Standort
 *  anyway. «Mein Standort» stays: a tap is intent, demo or not (locateNonce path). */
export const autoCoarseFixWanted = (staticView: boolean): boolean => !staticView && !isDemoMode()

export const MapView = forwardRef<MapRef, MapViewProps>(function MapView(props, ref) {
  const { entities, layers, byName, symMul = 1, captionMode = 'off', onCaptionSuppressionChange, initialCenter, initialZoom = 17.6, initialBearing = 0, fitPoints, staticView = false, locateNonce = 0, preparedOverlays, isVisible, selectedId = VIEWER_TACTICAL.selectedId, onSelect, onMapClick, editNoteId = null, onNoteText, onNoteCommit, onNoteEdit, onNotePanel, trupps, truppSeverities, onShowTrupp, onTeamTrupp, onTeamNewTrupp, onTeamMark, onTeamRename, onTeamClearTrail, onTeamRemoveWithTrail, ghostTrails, onGhostTrail, onTeamUnlink, onTeamUndock,
    readOnly = false, drawings: storedDrawings = VIEWER_TACTICAL.drawings, drawingsVisible = VIEWER_TACTICAL.drawingsVisible, draft = VIEWER_TACTICAL.draft, draftKind = VIEWER_TACTICAL.draftKind, placing, tapsPlace, onDraftDrag, onDraftInsert, onDraftDelete, onDraftPointAttachment, draftStartAttachment, draggable = VIEWER_TACTICAL.draggable, onMarkerDragStart = VIEWER_TACTICAL.onMarkerDragStart, onMarkerMove = VIEWER_TACTICAL.onMarkerMove, onMarkerDragEnd = VIEWER_TACTICAL.onMarkerDragEnd, onRotate, onShapeTransform,
    onView, onBasemapUnavailable, onSettled, picking, onCursor, onPick, pickedPoint, placeMagnet = false, placeAnchor = null, freehand = VIEWER_TACTICAL.freehand, onFreehand = VIEWER_TACTICAL.onFreehand, drawColor = VIEWER_TACTICAL.drawColor, drawWidth = VIEWER_TACTICAL.drawWidth, drawDashed = VIEWER_TACTICAL.drawDashed, selectedDrawingId = VIEWER_TACTICAL.selectedDrawingId, flashDrawingId, onSelectDrawing = VIEWER_TACTICAL.onSelectDrawing, onUnlockDrawing, onUnlockShape, onDelete = VIEWER_TACTICAL.onDelete, measureLabels = [], measurePoints = NO_POINTS, measureKind = null, onMeasureDrag, onMeasureInsert, onMeasureDelete,
    selectedDrawing = null, onDrawingEdit, onDrawingVertexInsert, onDrawingVertexDelete, onDrawingRadius, onDrawingAttachment, onLabelMove,
    marqueeEnabled = false, selectedDrawIds = [], onMarquee, onGroupTransform, selectedEntityIds = [], circleEnabled = false, onCircle,
    onSelectionDone, georefPlanRasters = [], weatherRadar = null, children, showOrigin = true, zoomCapAtBase = false } = props
  const [zoom, setZoom] = useState(initialZoom)
  const isPhone = useIsPhone()
  // per-team trail visibility, the same as the plan board's (lib/useHiddenTrails)
  const { hiddenTrails, toggleTrail } = useHiddenTrails()
  /** measure vertex currently in the hand — while set, the cumulative label under that finger
   *  steps aside and the tool's number stands fixed at the top edge instead (mockup 03-B: a
   *  rapidly changing value is read where it stands still, never under the fingertip) */
  const [measureDragNode, setMeasureDragNode] = useState<number | null>(null)
  // current map bearing (deg) — placed symbols are pinned to GEOGRAPHIC orientation, so the
  // glyph CSS rotation is offset by −bearing and re-renders live as the map rotates (a vehicle
  // "facing south" keeps facing south when you spin the map). Streamed on every rotate frame.
  const [bearing, setBearing] = useState(initialBearing)
  const mapInst = useRef<MlMap | null>(null)
  // a hand turn that comes to rest just off north settles on it (lib/mapTwist · createNorthSnap)
  const [northSnap] = useState(createNorthSnap)
  // The live map transform + pan switch every dragging layer works against (MapMarkers and both
  // twin layers). Stable identities, so the memoised twin layer is not rebuilt on every render
  // just because its props are fresh lambdas.
  const projectLngLat = useCallback((c: LngLat) => mapInst.current?.project(c as [number, number]), [])
  const unprojectPoint = useCallback((p: { x: number; y: number }): LngLat | undefined => {
    const m = mapInst.current
    if (!m) return undefined
    const ll = m.unproject([p.x, p.y])
    return [ll.lng, ll.lat]
  }, [])
  const setDragPanEnabled = useCallback((on: boolean) => {
    const dp = mapInst.current?.dragPan
    if (!dp) return
    if (on) dp.enable(); else dp.disable()
  }, [])
  // hold a node to delete it — one gesture for draft, Messung and drawing vertices alike, with
  // the chip appearing only after the hold has armed (lib/nodeHold). Desktop right-click stays
  // as the mouse shortcut.
  const vertexPress = useNodeHold()
  // A long-press vertex-delete fires mid-gesture; the finger's release then lands a map click on
  // the reshaped background, which would deselect and close the editor. This swallows that one
  // click so the line stays selected and more nodes can be deleted in a row.
  const suppressClick = useRef(false)
  const deleteVertexKeepSelection = (id: string, i: number) => { suppressClick.current = true; onDrawingVertexDelete?.(id, i) }
  // ⚠️ …and the same for the Messung and the draft. Their delete used to be the ONLY one that
  // did not swallow the release: the finger came up where the node had been, the map read it as
  // a tap, and the Messen/Zeichnen tool put a fresh point back at exactly that spot — so a
  // deleted node reappeared and the hold looked broken (19.08.).
  const deletePointKeepTool = (fn?: (i: number) => void) => (i: number) => { suppressClick.current = true; fn?.(i) }
  const [mapReady, setMapReady] = useState(false)
  // MapLibre paint specs can't read CSS vars, so the two TRANSIENT overlays drawn in the UI blue —
  // the draft shape and the measure path — resolve `--blue` off the live theme (lib/themeToken)
  // rather than freezing a literal into the paint spec, where they stayed dark-on-dark over a
  // night basemap. `useNightTheme` is what re-renders this component on the flip, so the read
  // below lands on the token that is actually in force. A drawing's OWN colour is data and never
  // flips: its `d.color || DEFAULT_INK` fallbacks below are deliberately left alone.
  const night = useNightTheme()
  const blue = uiBlue()
  // an open drawing's amber (--open), the same token the Plan's dashes and pill wear
  const openTone = themeToken('--open', '#e2920a')
  // the rim of a joint dot (l-draw-join) — the same surface tone the DOM rings wear
  const surface = themeToken('--surface', '#ffffff')

  // ── «Karte verknüpfen»: the map half of the pairing mode (components/GeorefMapLayer) ────────
  // The mode is a module store, not a prop chain: on a phone the Plan surface is unmounted while
  // this map takes the second half of a pair, so there is nobody left to thread props through.
  const georef = useGeorefMode()
  const georefOn = !!georef.planId
  const nativeDrawingChrome = nativeDrawingChromeVisible(drawingsVisible, georefOn)
  const georefTurn = georefWantsMap(georef)
  // where the pairing aim sits. Cleared the moment the map's turn is over, so the shared loupe
  // never stays parked over a surface nobody is aiming at.
  // A REF, not state: this is written on every pointer sample of the georef turn, and the only
  // thing that needs it is the loupe (GeorefMapLayer · GeorefMapLoupe), which ticks itself off
  // it. As state it re-rendered this whole component — and with it the full label pass — per
  // sample, which is the very thing the note on `onView` below forbids.
  const georefPoint = useRef<{ lng: number; lat: number } | null>(null)
  // tap-vs-pan for the pairing mode, tracked by hand — MapLibre's `click` fires on a pan that
  // ends where it began (see GeorefMapLayer · useGeorefMapTap)
  const georefTap = useGeorefMapTap()
  // ── a pan is not a tap ──
  // ⚠️ MapLibre fires `click` after a touch PAN as well, however far the finger travelled: the
  // browser synthesizes a mousedown/mouseup pair at the release point, and both land on the same
  // pixel, so the 3px click tolerance is trivially met. That trailing click fell through to
  // `onMapClick`, whose empty-map branch deselects — which on a phone closed the detail sheet the
  // operator was reading the moment they panned the map to see what was under it. So the gesture
  // is remembered for a moment past its own end (the synthetic click arrives after `dragend`) and
  // the click trailing it is dropped. Real, stationary taps never set the flag and are unaffected.
  const panGesture = useRef({ active: false, endedAt: 0 })
  const beginPanGesture = () => { panGesture.current.active = true }
  const endPanGesture = () => { panGesture.current = { active: false, endedAt: performance.now() } }
  const clickTrailsPan = () => panGesture.current.active || performance.now() - panGesture.current.endedAt < PAN_CLICK_TAIL_MS
  /** the one place a map half of a pair is placed — true when it really was, so the touch path
   *  knows whether there is a synthetic click trail to cancel (see the note on onTouchEnd) */
  const placeGeoref = (lngLat: { lng: number; lat: number }): boolean => {
    if (!georefTurn) return false
    georefDispatch({ type: 'mapTap', lngLat: { lng: lngLat.lng, lat: lngLat.lat } })
    georefPoint.current = null
    return true
  }
  const aimGeorefMap = () => {
    if (georefTurn && georef.want !== 'map') georefDispatch({ type: 'goMap' })
  }
  // The phone does not place where a finger happens to lift after a pan. It pans/zooms the one
  // live map beneath the app-level fixed target, and the explicit button asks this resolver for
  // the WGS84 coordinate under that exact screen pixel. Desktop keeps its direct tap workflow.
  useEffect(() => {
    if (!isPhone || !georefOn || !mapReady) return
    return registerGeorefPhoneTarget('map', () => {
      const map = mapInst.current
      if (!map) return null
      const surface = map.getContainer().getBoundingClientRect()
      const top = document.querySelector('.topbar')?.getBoundingClientRect().bottom
      const bottom = document.querySelector<HTMLElement>('[data-georef-controls]')?.getBoundingClientRect().top
      const target = georefPhoneTargetPoint(surface, { top, bottom })
      if (!target) return null
      const ll = map.unproject([target.x - surface.left, target.y - surface.top])
      return { lng: ll.lng, lat: ll.lat }
    })
  }, [georefOn, isPhone, mapReady])
  // ⚠️ The container can now change size WITHOUT the window doing so: «Karte verknüpfen» hands
  // the map the right half of the screen (09-whiteboard.css) and takes it back again. MapLibre
  // only listens to the WINDOW, so without this it keeps rendering at the old width — a
  // stretched, mis-projected picture in which every tap lands metres off. A container observer
  // covers the split, its end, and any future layout that moves this element.
  useEffect(() => {
    const m = mapInst.current; if (!m || !mapReady) return
    const ro = new ResizeObserver(() => { try { m.resize() } catch { /* map gone */ } })
    ro.observe(m.getContainer())
    return () => ro.disconnect()
  }, [mapReady])
  // ⚠️ …and SYNCHRONOUSLY when the georef layout itself flips. The observer above fires a frame
  // late (after paint), so entering/leaving the split or «Deckung prüfen» left every DOM marker
  // projecting through the old transform for a frame or two — a visible jump of all crosses and
  // symbols. The width flip is React-rendered (Whiteboard's wb-georef-split/-check classes come
  // from the same georef store snapshot as this component's state), so a layout effect keyed on
  // that state resizes the map in the same commit, before the browser paints: `map.resize()`
  // reads the container's NEW size and re-places the markers synchronously. The observer stays
  // as the backstop for every other way the container can change size.
  useLayoutEffect(() => {
    const m = mapInst.current; if (!m || !mapReady) return
    try { m.resize() } catch { /* map gone */ }
  }, [georefOn, georef.check, mapReady])
  // ⚠️ Typing «+», «-» or an arrow into a field that sits ON the map used to zoom/pan it as well.
  // Our own hotkey layer is innocent (lib/hotkeys bails on isTypingTarget) — the culprit is
  // MapLibre's KeyboardHandler: it is bound to `map.getCanvasContainer()` and never inspects
  // `e.target`, and react-map-gl appends every <Marker> into exactly that container. The inline
  // Trupp rename input and the note textarea (MapMarkers) are therefore DOM descendants of it.
  //
  // The obvious `onKeyDown={(e) => e.stopPropagation()}` on the field does NOT work: React
  // delivers synthetic events at the React root, an ANCESTOR of the canvas container, so MapLibre
  // has already handled the key by then. A native listener on the field would stop it in time but
  // would also swallow the component's own Enter/Escape handling. So the handler itself is
  // switched off for as long as a text field owns focus, and switched back on when it leaves.
  useEffect(() => {
    if (!mapReady) return
    const sync = () => syncMapKeyboard(mapInst.current)
    document.addEventListener('focusin', sync)
    document.addEventListener('focusout', sync)
    sync()
    return () => {
      document.removeEventListener('focusin', sync)
      document.removeEventListener('focusout', sync)
      mapInst.current?.keyboard?.enable() // never leave the map deaf behind us
    }
  }, [mapReady])
  // …and once per render as the backstop, because a focused element that is simply REMOVED fires
  // no focusout in Chrome — the guest-name input does exactly that, and without this the handler
  // would stay off for the rest of the session. Every such removal is a render, so this reopens
  // it; enable/disable are idempotent, so running it every render costs nothing.
  useEffect(() => { syncMapKeyboard(mapInst.current) })
  // ── one finger zooms by the ONE rule of lib/tapDragZoom · oneFingerZoom, shared with the Plan
  // boards (sweep 27.10.2026 #8, owner: «I need it to work on the map, on the plans, and also on
  // the normal map in the peacetime view», and then: no one-finger zoom while a tap-to-place tool
  // is armed). Both gestures under Auswahl, Mehrfach (the Rahmen yields its second press,
  // useMapCanvasGestures) and with a sheet like Ebenen open; tap-and-drag under Messen (its fresh
  // point lets the second press through — `measureFresh` below); none under a tap-to-place tool
  // (Punkte, Hinzufügen, Notiz, Trupp, Koordinaten, Kreis — a tap places, the pinch zooms); the
  // double tap alone under Freihand, whose drag is the stroke (UX sweep M4). It used to follow `placing` alone, which on the Lage is «any tool
  // but Auswahl» and on the Karte «any tool at all», the Ebenen sheet included — hence
  // `tapsPlace`, which a caller narrows to the tools that really place. Pinch and the wheel stay
  // on throughout; the switching itself is lib/tapDragZoom · setMapOneFingerZoom. Per instance:
  // a WebGL remount builds a fresh map with both on.
  const dragTool = !!freehand || marqueeEnabled
  const measureFresh = useFreshPoint(measureKind ? measurePoints.length : 0)
  const zoomAllow = oneFingerZoom(
    freehand ? 'draw'
      : measureKind ? 'measure'
        : circleEnabled || ((tapsPlace ?? !!placing) && !dragTool) ? 'place' : 'navigate',
  )
  useEffect(() => {
    const m = mapInst.current
    if (!mapReady || !m) return
    setMapOneFingerZoom(m, { step: zoomAllow.step, drag: zoomAllow.drag })
  }, [mapReady, zoomAllow.step, zoomAllow.drag])
  // WebGL context recovery: iPadOS drops the context under memory pressure / after a long
  // background spell, and MapLibre stays blank without rebuilding. `gl.generation` keys the
  // <Map> below so recovery is a fresh instance; `viewRef` carries the CURRENT view across that
  // remount so the operator doesn't get thrown back to the incident's initial framing.
  const viewRef = useRef<{ center: LngLat; zoom: number; bearing: number } | null>(null)
  const gl = useGlRecovery(() => mapInst.current, mapReady, () => {
    mapInst.current = null
    setMapReady(false)
  })
  // ── the line-end magnets: a dragged end and a line being drawn (components/useMapMagnet) ──
  const {
    endpointDrag, attachmentLines, beginEndpointDrag, moveEndpointDrag, finishEndpointDrag,
    draftMagnetState, draftStart, updateDraftMagnet, nodeMagnetActive, finishDraftNodeMagnet, joinPreview,
  } = useMapMagnet({
    mapInst, storedDrawings, entities,
    candidates: (sourceId, at) => candidatesAt(sourceId, at),
    draft: { kind: draftKind, freehand, length: draft.length, onPointAttachment: onDraftPointAttachment, startAttachment: draftStartAttachment },
    onDrawingAttachment,
    // an end coupled to a Trupp marker drags the marker (the hose end rides with it)
    carry: {
      start: (id) => { onMarkerDragStart(id); setTeamDragId(id) },
      move: (id, c) => teamJoinMarkerMove(id, c),
      end: (id, c) => teamJoinMarkerDragEnd(id, c),
    },
  })

  // ⚠️ This chain (useMapMagnet · attachmentLines → resolvedCoords → drawings, relationship) is
  // MEMOIZED (perf sweep 23.09.2026): it was rebuilt on every render of the parent, so every
  // GeoJSON source below got a fresh object and react-map-gl deep-compared all of it per render.
  // Each step keeps its identity until one of its real inputs moves — which is what lets the
  // sources (drawFC, arrowFC, editFC …) keep theirs.
  /* ⚠️ No mirrored-magnet list any more. A plan-drawn Hydrant IS an entity on this map now
     (lib/tacticalObjects), so it offers itself to a Leitung end through the ordinary object
     targets below — and the attachment names an object in the SAME document, which is what the
     stored id always claimed and, until the store was unified, could not keep. */
  // ⚠️ Screen-space work (project → glyph boundary → unproject), yet keyed on the CAMERA STATE
  // (zoom, bearing), not on the live camera: with pitch locked at 0 a pan is a pure translation of
  // screen space, so the geo point it lands on does not depend on the centre. zoom/bearing are the
  // values the glyph sizes were already read from, and they land on moveend — the same moment the
  // map bumps a render so this re-resolves (bumpLabelFrame).
  const resolvedCoords = useMemo(() => {
  const resolved = new globalThis.Map<string, LngLat[]>()
  const objectPoint = (id: string, toward: LngLat, attachment: import('../types').LineAttachment, source: AttachableLine<LngLat>): LngLat | null => {
    const map = mapReady ? mapInst.current : null
    const e = entities.find((x) => x.id === id)
    if (!e || !map || !Array.isArray(e.coord)) return attachment.gps?.lastSafe ?? null
    let center = e.coord
    if (attachment.gps) {
      const guarded = gpsGuard(attachment.gps.state, attachment.gps.confirmedAt, attachment.gps.lastSafe, center,
        (a, b) => pathLengthM([a as LngLat, b as LngLat]))
      center = guarded.point as LngLat
    }
    const c = map.project(center), t = map.project(toward)
    const size = e.kind === 'shape' ? shapePx(e.sizeM, e.coord[1], zoom, SHAPE_MAX_PX[e.shape ?? 'square'])
      : e.kind === 'team' ? 56 : e.kind === 'note' || e.kind === 'photo' ? 56 : symPx(e.kind, e.coord[1], zoom, symMul)
    // negative padding = the endpoint lands just INSIDE the glyph, so the stroke disappears
    // under the marker instead of stopping short of it (see attachInsetPx)
    const p = boundaryPoint({ shape: 'rect', center: [c.x, c.y], width: size, height: e.kind === 'vehicle' ? size * 0.7 : size, rotation: (e.rotation ?? 0) - bearing }, [t.x, t.y], -attachInsetPx(source.width))
    const ll = map.unproject(p)
    return [ll.lng, ll.lat]
  }
  const linePoint = (target: AttachableLine<LngLat>, endpoint: LineEndpoint, attachment: LineAttachment, resolved: LngLat): LngLat => {
    const map = mapReady ? mapInst.current : null
    if (!map || !(endpoint === 'end' && target.teilstueck) || attachment.port == null || target.points.length < 2) return resolved
    const p = map.project(resolved), q = map.project(target.points[target.points.length - 2])
    const port = forkPortPoint([p.x, p.y], [q.x, q.y], target.width ?? 4, attachment.port)
    const ll = map.unproject(port)
    return [ll.lng, ll.lat]
  }
  for (const l of attachmentLines) resolved.set(l.id, resolveLinePoints(l, { lines: attachmentLines, objectPoint, linePoint }))
  return resolved
  }, [attachmentLines, entities, zoom, bearing, symMul, mapReady])
  // ⚠️ not seeded from a selected TRUPP marker (15.09.): its hose's other end lit up the symbol
  // the water comes from, which read as «that thing is selected» beside the pill. A selected
  // Leitung still shows what it hangs on, which is what the network halo is for.
  const relationship = useMemo(() => relationshipNetwork(attachmentLines, selectedDrawingId ? [selectedDrawingId] : [],
    selectedId && entities.find((e) => e.id === selectedId)?.kind !== 'team' ? [selectedId] : []),
  [attachmentLines, selectedDrawingId, selectedId, entities])
  // resolvedCoords already carries the dragged endpoint at the finger position (attachmentLines
  // injects it above), so downstream consumers see the live drag without a second override.
  const drawings = useMemo(() => storedDrawings.map((d): Drawing =>
    resolvedCoords.has(d.id) ? { ...d, coords: resolvedCoords.get(d.id)! } : d), [storedDrawings, resolvedCoords])
  const resolvedSelectedDrawing = useMemo(() => selectedDrawing && resolvedCoords.has(selectedDrawing.id)
    ? { ...selectedDrawing, coords: resolvedCoords.get(selectedDrawing.id)! } : selectedDrawing, [selectedDrawing, resolvedCoords])
  const hiddenAttachmentTargets = selectedDrawing ? [selectedDrawing.startAttachment, selectedDrawing.endAttachment].flatMap((a) => {
    if (a?.target.kind !== 'object') return []
    const e = entities.find((x) => x.id === a.target.id)
    return e && !isVisible(effectiveLayer(e)) ? [e] : []
  }) : []
  /** The magnet's targets for a line end of `sourceId` at `at` (components/mapMagnetTargets) —
   *  read fresh on every call, so the draft's start claim and the live camera are current. */
  const candidatesAt = (sourceId: string, at: LngLat): MagneticTarget[] => {
    const map = mapInst.current
    if (!map) return []
    return mapMagnetTargets(map, { entities, drawings, attachmentLines, trupps: trupps ?? [], zoom, bearing, symMul },
      sourceId, at, draftStart())
  }
  // a Rotation's two taps may each claim a symbol by dwelling (components/usePlaceMagnet)
  const place = usePlaceMagnet({ mapInst, entities, isVisible, enabled: placeMagnet })
  const placeMag = place.placeMag
  // no Karte, no live bearing – the readers fall back to the settled one (lib/liveBearing)
  useEffect(() => () => setLiveBearing(null), [])

  // own position (GPS) — a quiet blue dot so the crew can see where they stand relative to the
  // Einsatzort. ON DEMAND, not a continuous watch: a permanent high-accuracy watchPosition keeps
  // the GPS chip powered for the whole shift, one of the biggest battery drains — and once you know
  // where you are it rarely needs re-checking. So we take a single fix each time the operator taps
  // "Mein Standort" (locateNonce bumps), then fly to it. Best-effort: silently absent if
  // denied/unavailable. `maximumAge` lets a very recent fix answer instantly without waking the chip.
  const [userPos, setUserPos] = useState<LngLat | null>(null)
  useEffect(() => {
    if (staticView || !locateNonce) return
    if (!('geolocation' in navigator)) return
    navigator.geolocation.getCurrentPosition(
      (p) => {
        const c: LngLat = [p.coords.longitude, p.coords.latitude]
        setUserPos(c)
        const m = mapInst.current
        if (m) m.flyTo({ center: c, zoom: Math.max(m.getZoom(), 16), duration: motionDuration(600) })
      },
      () => { /* denied / unavailable — leave the last known dot (if any) as is */ },
      { enableHighAccuracy: true, maximumAge: 30_000, timeout: 15_000 },
    )
  }, [locateNonce, staticView])
  // …and the dot is THERE by default (05.09.), rather than only after somebody has thought to ask
  // for it: «wo stehe ich, relativ zum Einsatzort» is the question a phone is pulled out for, and
  // an indicator you must first discover a menu row for is not an indicator. So one COARSE fix is
  // taken when the Karte first opens — no `enableHighAccuracy`, a five-minute `maximumAge`, and
  // no flyTo: the map keeps the framing it was given, the dot simply appears on it.
  // ⚠️ Not a watch, and not the high-accuracy path: the battery reasoning above is untouched —
  // this asks the platform for whatever it already knows. The one thing that can turn it off is
  // the device's own location permission, and a denial is silently honoured (no dot, no prompt
  // twice, and the «Mein Standort» row still works the moment it is granted).
  useEffect(() => {
    if (!autoCoarseFixWanted(staticView)) return
    if (!('geolocation' in navigator)) return
    navigator.geolocation.getCurrentPosition(
      (p) => setUserPos((prev) => prev ?? [p.coords.longitude, p.coords.latitude]),
      () => { /* denied / unavailable — no dot, and nothing said about it */ },
      { enableHighAccuracy: false, maximumAge: 300_000, timeout: 15_000 },
    )
  }, [staticView])

  // Frame the incident's existing content — ONCE per incident, not once per map instance.
  // ⚠️ `didFit`, because `mapReady` is not a one-way flag: a lost WebGL context remounts <Map>
  // under a new key and sets it false→true again (see useGlRecovery). This effect then re-ran and
  // fitted to the whole incident extent a tick AFTER `resumeViewState` had put the operator's own
  // framing back — so every recovery threw away the zoom somebody was working at, and under memory
  // pressure that repeats every 60s (the auto-heal's rate limit). Which reads, from the operator's
  // side, as a map that keeps zooming out by itself.
  // The ref belongs to MapView, which stays mounted across surfaces for the whole incident, so it
  // outlives exactly what it has to: the <Map> instances underneath it.
  const didFit = useRef(false)
  useEffect(() => {
    const map = mapInst.current
    if (!map || !mapReady || !fitPoints?.length || didFit.current) return
    didFit.current = true
    setTimeout(() => {
      try {
        map.resize()
        if (fitPoints.length === 1) {
          map.jumpTo({ center: fitPoints[0], zoom: initialZoom, bearing: initialBearing })
          return
        }
        const lngs = fitPoints.map((p) => p[0])
        const lats = fitPoints.map((p) => p[1])
        const minLng = Math.min(...lngs), maxLng = Math.max(...lngs)
        const minLat = Math.min(...lats), maxLat = Math.max(...lats)
        if (minLng === maxLng && minLat === maxLat) map.jumpTo({ center: [minLng, minLat], zoom: initialZoom, bearing: initialBearing })
        else {
          map.setBearing(initialBearing)
          map.fitBounds([[minLng, minLat], [maxLng, maxLat]], { padding: 48, duration: 0, maxZoom: 18 })
        }
      } catch { /* map gone */ }
    }, 0)
  }, [fitPoints, initialBearing, initialZoom, mapReady])

  // The first COMPLETE frame: framed (the fit above runs in a timeout-0 scheduled before this
  // one) and every tile and source of that view loaded or failed — MapLibre's `idle`. Before it,
  // the basemap arrives in patches and the content sits where the initial center put it.
  const settled = useRef(false)
  const onSettledRef = useRef(onSettled)
  useEffect(() => { onSettledRef.current = onSettled })
  useEffect(() => {
    const map = mapInst.current
    if (!map || !mapReady || settled.current) return
    const fire = () => { if (!settled.current) { settled.current = true; onSettledRef.current?.() } }
    const t = setTimeout(() => { try { map.once('idle', fire) } catch { /* map gone */ } }, 0)
    return () => { clearTimeout(t); try { map.off('idle', fire) } catch { /* map gone */ } }
  }, [mapReady])

  // The point symbols (hydrant, Schieber …), the arrowheads and the Schraffur tiles are
  // registered by <MapImages> — the first child of <Map>, because an effect waiting for
  // `mapReady` ran after the first tile had already asked for them (lib/mapImages).

  // Keep the base raster(s) pinned BELOW the tactical drawings. react-map-gl appends every layer
  // without a `beforeId` and re-adds late-loading sources on each `styledata`, so a base raster
  // that loads (or re-loads on a day/night swap) AFTER the synchronous draw layers would stack on
  // top and paint over them ("drawings vanish"). On every styledata, move any base layer that has
  // drifted above `l-draw-sel` back beneath it — guarded so we only move when actually needed
  // (a no-op move would itself fire styledata → an event loop).
  useEffect(() => {
    const map = mapInst.current
    if (!map || !mapReady) return
    const keepBaseBelowDrawings = () => {
      if (!map.isStyleLoaded()) return
      const layerList = map.getStyle().layers ?? []
      const drawIdx = layerList.findIndex((l) => l.id === 'l-draw-sel')
      if (drawIdx < 0) return
      for (let i = drawIdx + 1; i < layerList.length; i++) {
        const id = layerList[i].id
        if (id.startsWith('l-base') && map.getLayer(id)) {
          try { map.moveLayer(id, 'l-draw-sel') } catch { /* order already fine */ }
        }
      }
    }
    map.on('styledata', keepBaseBelowDrawings)
    keepBaseBelowDrawings()
    return () => { map.off('styledata', keepBaseBelowDrawings) }
  }, [mapReady])


  // canvas-level pointer gestures (freehand drawing + marquee multi-select) live in a
  // dedicated hook; they bind directly to the MapLibre instance and toggle dragPan.
  // ⚠️ A7 · the magnet is raised for a freehand LINE only. An area's endpoints are not a thing
  // that attaches — `onFreehand` hands an area's attachments straight back (useMapDrawing) — so a
  // ring filling over a Hydrant while a Fläche is dragged across it was promising a link that was
  // then discarded. The Plan says the same thing in its own words (usePlanCreate · inkUp: «no
  // magnet and no attachments — those belong to a Leitung's ends»).
  const { fhPath, marquee, circle } = useMapCanvasGestures({ mapInst, mapReady, freehand: !!freehand, onFreehand, onFreehandPointer: freehand === 'area' ? undefined : updateDraftMagnet, marqueeEnabled, drawings, entities, onMarquee, circleEnabled, onCircle, circleMinRadiusM: appConfig.drawing.circleMinRadiusM, circleInitialRadiusM: appConfig.drawing.circleInitialRadiusM })

  // a point on a circle's edge at a SCREEN direction (0 = top of the screen, 180 = bottom),
  // compensated for the live map `bearing` so the chip stays put relative to the screen as the
  // map rotates. (Was pinned to geographic north, so the radius readout swung off the top edge
  // and ended up at the side/bottom once the operator turned the map.)
  const circleEdgeAtScreen = (center: LngLat, radiusM: number, screenDeg: number): LngLat => {
    const dir = ((bearing + screenDeg) * Math.PI) / 180
    const mPerLon = 111320 * Math.cos((center[1] * Math.PI) / 180)
    return [center[0] + (radiusM * Math.sin(dir)) / mPerLon, center[1] + (radiusM * Math.cos(dir)) / 110540]
  }

  const drawFC = useMemo(() => fc(drawings.filter((d) => Array.isArray(d.coords) && d.coords.length > 0).map((d) => {
    // `truppTone` drives the Atemschutz halo below: '' unless a Trupp on this Leitung is due
    // or überfällig. Resolved here (not per frame) so the paint expression stays a plain lookup.
    const linked = d.kind === 'line' ? truppForLine(d, trupps ?? []) : undefined
    const tone = linked ? truppLineTone(linked, truppSeverities?.[linked.id] ?? 0) : 'idle'
    // a Wand is drawn thicker than it is stored, over a light casing (lib/grundriss · WAND_MAP_PX)
    const wand = d.kind === 'line' && d.role === 'wand'
    const p = { id: d.id, color: d.color || DEFAULT_INK, width: wand ? WAND_MAP_PX.width : d.width || 4, wand, dashed: !!d.dashed, arrow: !!d.arrow, marker: d.marker || '', showDistance: !!d.showDistance, label: d.label || '', fillOpacity: d.fillOpacity ?? 0.14, hatch: !!d.hatch, networkDepth: relationship.depth.get(`line:${d.id}`) ?? -1, truppTone: tone === 'warn' || tone === 'crit' ? tone : '' }
    if (d.kind === 'circle') return polyFeat(circleRing(d), p)
    return d.kind === 'area' && d.coords.length >= 3 ? polyFeat(d.coords, p) : lineFeat(d.coords, p)
  })), [drawings, trupps, truppSeverities, relationship])

  // arrowheads: a Point per line carrying an `arrow` flag, placed at the LAST coord with
  // a `bearing` (deg, clockwise-from-north) derived from the final segment in a local
  // east/north frame (lng delta scaled by cos(lat)) so the rotation looks geographically
  // correct. Rendered by a symbol layer with a registered arrow icon.
  const arrowFC = useMemo(() => fc(drawings
    .filter((d) => d.kind !== 'area' && d.arrow && Array.isArray(d.coords) && d.coords.length >= 2)
    .map((d) => {
      const n = d.coords.length
      const [aLng, aLat] = d.coords[n - 2]
      const [bLng, bLat] = d.coords[n - 1]
      const cosL = Math.cos((bLat * Math.PI) / 180) || 1e-6
      const dx = (bLng - aLng) * cosL, dy = bLat - aLat
      const bearing = (Math.atan2(dx, dy) * 180) / Math.PI // 0 = north, +clockwise
      return { type: 'Feature', geometry: { type: 'Point', coordinates: d.coords[n - 1] }, properties: { id: d.id, color: d.color || DEFAULT_INK, bearing, icon: d.arrowStop ? 'draw-arrow-stop' : 'draw-arrow' } }
    })), [drawings])
  // «Angekuppelt» (11.10.2026): a dot in the hose's ink on every line → line joint, so a branch
  // coupled onto a Teilstück's prong (or a line continued from another's end) says so — a line
  // target attaches instantly and draws no ring, and a joined end looked exactly like a free end
  // lying on the node (lib/lineAttachments · lineJoints). Resolved coords: the dot sits where the
  // two ends actually meet. The Plan draws the same dot (WbControls · WbInkLayer).
  const joinFC = useMemo(() => {
    const lines = drawings.filter((d) => d.kind === 'line' && Array.isArray(d.coords) && d.coords.length >= 2)
    const byId = new globalThis.Map(lines.map((d) => [d.id, d]))
    return fc(lineJoints(lines.map((d) => ({ id: d.id, points: d.coords, startAttachment: d.startAttachment, endAttachment: d.endAttachment })))
      .map((j) => ({ type: 'Feature', geometry: { type: 'Point', coordinates: j.point },
        properties: { id: j.lineId, color: byId.get(j.lineId)?.color || DEFAULT_INK, width: byId.get(j.lineId)?.width || 4 } })))
  }, [drawings])

  // distance / free-text overlays pinned to each annotated line's midpoint (reuses the
  // measure-label HTML-marker pattern). Distance uses the SAME geodesic length the Measure
  // tool uses (pathLengthM), and adds the hose-length helper line on Messpfeil lines.
  const drawLabels = drawings
    .filter((d) => (d.showDistance || d.label || d.abschnittLeiter || d.abschnittAuftrag) && Array.isArray(d.coords) && d.coords.length >= 2)
    .map((d) => {
      // a labelled `area` (= a Sektor/Abschnitt) pins its label at the polygon centroid;
      // a line pins at its midpoint. Distance is line-only (an area has no path length).
      const isArea = d.kind === 'area' && d.coords.length >= 3
      const base: LngLat = isArea
        ? [d.coords.reduce((s, p) => s + p[0], 0) / d.coords.length, d.coords.reduce((s, p) => s + p[1], 0) / d.coords.length]
        : d.coords[Math.floor((d.coords.length - 1) / 2)]
      // `words`: free text set in the names' sans; a measured value stays mono (hill climb r7 –
      // «Trupp Polizei evakuiert» in mono beside sans names read as a second type language)
      const lines: { text: string; words: boolean }[] = []
      // A line states its length (plus the hose hint); a Fläche states what it covers. Same
      // toggle, same geodesic maths the Messen tool uses — the area used to be computed for
      // the editor panel only and could never reach the map.
      if (d.showDistance && !isArea) { const len = pathLengthM(d.coords); lines.push({ text: `${fmtDistance(len)} · ${hoseLengthHint(len, hoseLines(d))}`, words: false }) }
      if (d.showDistance && isArea) lines.push({ text: fmtArea(polygonAreaM2(d.coords)), words: false })
      // Abschnitt: the Leiter rides the name line («Abschnitt 1 · Oblt Steiner»), the Auftrag
      // gets its own — who leads where must be readable off the Lage, not only in the panel.
      // ⚠️ Same composition as the paper Kroki (backend/app/kroki.py): screen and print agree.
      const head = [d.label, d.abschnittLeiter].filter(Boolean).join(' · ')
      if (head) lines.push({ text: head, words: true })
      if (d.abschnittAuftrag) lines.push({ text: d.abschnittAuftrag, words: true })
      // a dragged label is pinned to its georeferenced anchor; otherwise the midpoint/centroid
      return { id: d.id, coord: d.labelAt ?? base, lines }
    })
    .filter((l) => l.lines.length > 0)
  // inline repeating letter marker (e.g. R on a Rettungsachse) rendered as DOM Markers
  // densely along the WHOLE line — NOT a MapLibre `text-field` symbol layer, which would
  // need a `glyphs` font source the offline-first style intentionally omits. We walk the
  // polyline in projected screen space and drop a letter every ~MARKER_SPACING_PX, so the
  // —R— rhythm reads at any zoom. Falls back to the midpoint until the map is ready.
  // walk the polyline in PROJECTED screen px (shared spacing math), then lerp the ORIGINAL lng/lat by
  // each {seg, t} so the —R— rhythm reads at any zoom. SAME helper the Plan whiteboard uses.
  // `deg` rides along so an FKS chain glyph (a Haltelinie's teeth) can stand on the line; a
  // letter ignores it. Spacing is the marker's own rhythm — a triangle chain is far denser than
  // the —R— letters (lib/lineStyle · markerSpacing).
  const markerPointsAlong = (coords: LngLat[], marker?: string): { coord: LngLat; deg: number }[] => {
    const m = mapInst.current
    const mid = coords[Math.floor((coords.length - 1) / 2)]
    if (!m) return [{ coord: mid, deg: 0 }]
    const px = coords.map((c) => { const p = m.project(c as [number, number]); return [p.x, p.y] as [number, number] })
    const out = markerParamsAlong(px, markerSpacing(marker))
      .map(({ seg, t, deg }) => ({ coord: lerpPoint(coords[seg], coords[seg + 1], t) as LngLat, deg }))
    if (out.length === 0) out.push({ coord: mid, deg: 0 })
    return out
  }
  const drawMarkers = drawings
    .filter((d) => d.kind !== 'area' && !!d.marker && Array.isArray(d.coords) && d.coords.length >= 2)
    .flatMap((d) => markerPointsAlong(d.coords, d.marker).map(({ coord, deg }, i) => ({ id: `${d.id}-${i}`, coord, deg, marker: d.marker!, color: d.color || DEFAULT_INK })))
  // committed Absperrkreis circles carry their radius at the SCREEN-TOP edge (not the centre,
  // which is the drag handle) so the size reads without sitting in the middle of the action.
  // The edge point tracks the map bearing so it stays at the top of the screen when rotated.
  const circleLabels = drawings
    .filter((d) => d.kind === 'circle' && (d.radiusM ?? 0) > 0 && Array.isArray(d.coords) && d.coords.length > 0)
    .map((d) => ({ id: d.id, coord: circleEdgeAtScreen(d.coords[0], d.radiusM ?? 0, 0), text: fmtDistance(d.radiusM!) }))
  // locked drawings: skipped by click-selection (click-through) and marked with a lock chip —
  // for a circle (Absperrkreis) the chip sits on the BOTTOM EDGE, not the centre, so it doesn't
  // cover the incident/evacuation point; area uses the centroid, a line its midpoint.
  const lockedIds = new Set(drawings.filter((d) => d.locked).map((d) => d.id))
  const lockChips = drawings
    .filter((d) => d.locked && Array.isArray(d.coords) && d.coords.length > 0)
    .map((d) => {
      const coord: LngLat = d.kind === 'circle'
        ? circleEdgeAtScreen(d.coords[0], d.radiusM ?? 0, 180) // screen-bottom edge of the ring
        : d.kind === 'area'
          ? [d.coords.reduce((s, p) => s + p[0], 0) / d.coords.length, d.coords.reduce((s, p) => s + p[1], 0) / d.coords.length]
          : d.coords[Math.floor((d.coords.length - 1) / 2)]
      return { id: d.id, coord }
    })
  // FKS hose-line decorations (Teilstück fork · content letter · Druckleitung/storey badge).
  // The fork rotates to the line's SCREEN angle (projected last segment) so it stays aligned
  // at any map bearing; the text chips stay upright. Mirrors the Plan whiteboard overlay.
  const lineDecor = drawings
    .filter((d) => d.kind === 'line' && Array.isArray(d.coords) && d.coords.length >= 2 && hasLineDecor(d))
    .map((d) => {
      const n = d.coords.length
      const end = d.coords[n - 1]
      const m = mapInst.current
      let angleDeg = 0
      let dir: [number, number] = [1, 0]
      let side: 1 | -1 = 1
      if (m) {
        const pe = m.project(end as [number, number])
        const pr = m.project(d.coords[n - 2] as [number, number])
        angleDeg = (Math.atan2(pe.y - pr.y, pe.x - pr.x) * 180) / Math.PI
        const screen = d.coords.map((c): [number, number] => { const p = m.project(c as [number, number]); return [p.x, p.y] })
        dir = endDirection(screen)
        side = endTagSide(screen)
      }
      // The end tag stands beside the tip, its near edge just short of the arrowhead, a constant px
      // offset from the end, outside the bend the hose makes into it (lib/endTagSpots · endTagOffset,
      // endTagSide – hill climb r16, Opus 4: at 72 % along a freehand stroke's tiny last segment it
      // sat ON the arrowhead). A hand-placed tag keeps its stored ground point and the drag's
      // offset (END_TAG_HELD_OFFSET).
      const tagSize = cachedLabelSize(endTagText(d), END_TAG_LABEL_STYLE)
      const tagAt: LngLat = d.endLabelAt ?? end
      const tagOffset = d.endLabelAt ? END_TAG_HELD_OFFSET : endTagOffset(dir, tagSize.w, tagSize.h, d.arrow ? MAP_ARROW_BACK_PX : 0, side)
      // the Atemschutz-Trupp working this Leitung (anchor or number) + how it is doing right now
      const trupp = truppForLine(d, trupps ?? [])
      const tone = trupp ? truppLineTone(trupp, truppSeverities?.[trupp.id] ?? 0) : 'idle'
      return { d, end, tagAt, tagOffset, angleDeg, color: d.color || DEFAULT_INK, width: d.width || 4, trupp, tone }
    })
  /** The ground point a tag drag starts from: the stored one, or the point the drag's held offset
   *  (END_TAG_HELD_OFFSET) puts exactly where the tag stands now – so the first move does not jump. */
  const heldTagAnchor = (ld: (typeof lineDecor)[number]): LngLat => {
    const m = mapInst.current
    if (ld.d.endLabelAt || !m) return ld.tagAt
    const p = m.project(ld.tagAt as [number, number])
    const g = m.unproject([p.x + ld.tagOffset[0] - END_TAG_HELD_OFFSET[0], p.y + ld.tagOffset[1] - END_TAG_HELD_OFFSET[1]])
    return [g.lng, g.lat]
  }
  // ── The Leitung a Trupp marker works (lib/truppLines · teamLineBadges) ─────────────────────
  // What the marker carries of it: the coupling in the hose's ink where the hose really ends
  // there. ⚠️ No NUMBER any more (11.10.2026, owner: «on the map the trupps are numbered – which
  // we don't need. keep the UI the same as on the building storeys … just the name»). «Ein
  // Etikett» (15.09.) had moved the Leitung's number into the marker and taken the hose's own end
  // tag away; the boxed «1» beside the name then read as a TRUPP number. The Karte is the Gebäude
  // chip's twin again: the marker says who, the hose's end tag says which Leitung (it never
  // repeats the Trupp's name — the marker beside it is that name).
  const { byMarker: teamLines } = teamLineBadges(
    lineDecor.map((ld) => ({
      id: ld.d.id, lineNo: ld.d.lineNo, color: ld.color, truppId: ld.trupp?.id, tone: ld.tone,
      endObjects: [ld.d.startAttachment, ld.d.endAttachment]
        .map((a) => (a?.target.kind === 'object' ? a.target.id : undefined)),
    })),
    entities.flatMap((e) => (e.kind === 'team' ? [{ id: e.id, truppId: e.truppId }] : [])),
  )
  /** Every hose end nobody hangs on — the drop targets of the marker join, and «Anschluss frei»
   *  while a Trupp marker is in the hand. Only the two ENDS: a marker beside the middle of a hose
   *  says nothing about who works it (lib/lineAttachments · nearestFreeEndpoint).
   *
   *  ⚠️ …and only on a Leitung that is still FREE (lib/truppLines · lineTakesTrupp, 15.09.). A
   *  hose whose other end already carries a crew — or that is linked to one by number — offers no
   *  ring at all: its far end is simply a free end, not an invitation to put a second Trupp on the
   *  same line. That is the rule seen from the gesture's side; the writers fail closed behind it. */
  const openHoseLines = drawings.filter((d) => lineTakesTrupp(d, trupps ?? []))
  // …at the hose's END only (15.09.): a Leitung has a water side and a crew side, and offering
  // both ends rang two couplings per hose where there is one place a Trupp goes
  const freeHoseEnds = openHoseLines.flatMap((d) => (
    d.kind !== 'line' || !Array.isArray(d.coords) || d.coords.length < 2 || d.endAttachment ? []
      : [{ lineId: d.id, endpoint: 'end' as const, color: d.color || DEFAULT_INK, coord: d.coords[d.coords.length - 1] as LngLat }]
  ))
  // a Trupp marker in the hand aims at a free hose end or a symbol to dock to (components/useTruppMarkerAim)
  const { teamJoin, dockAim, teamDragId, setTeamDragId, teamJoinMarkerMove, teamJoinMarkerDragEnd } =
    useTruppMarkerAim({ mapInst, entities, openHoseLines, nativeDrawingChrome, onMarkerMove, onMarkerDragEnd })
  // ── ONE label pass for the whole map (components/useLabelPass) ──
  const { suppressedLabels, bumpLabelFrame } = useLabelPass(mapInst, {
    initialCenter, entities, isVisible, zoom, symMul, captionMode, selectedId, selectedEntityIds, teamLines,
    drawingsVisible, lineDecor, drawLabels, circleLabels, selectedDrawingId, storedDrawings, hiddenTrails,
  }, onCaptionSuppressionChange)

  // the draft outline/fill; its vertices render as draggable Markers (not circles) below
  const draftFC = useMemo(() => fc(draft.length >= 2 ? [draftKind === 'area' && draft.length >= 3 ? polyFeat(draft) : lineFeat(draft)] : []), [draft, draftKind])
  // …and its dashes march while it is open (DRAFT_ANTS) — straight onto the layer, no re-render
  const draftShown = !!draftKind && draft.length >= 2
  useEffect(() => {
    const map = mapReady ? mapInst.current : null
    if (!map || !draftShown || window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) return
    let i = 0
    const t = window.setInterval(() => {
      i = (i + 1) % DRAFT_ANTS.length
      if (map.getLayer('l-draft-line')) map.setPaintProperty('l-draft-line', 'line-dasharray', DRAFT_ANTS[i])
    }, 60)
    return () => window.clearInterval(t)
  }, [mapReady, draftShown])
  // measure path: line / polygon only — the vertices are draggable Markers, not circles
  const measureFC = useMemo(() => fc(measurePoints.length >= 2
    ? [measureKind === 'area' && measurePoints.length >= 3 ? polyFeat(measurePoints) : lineFeat(measurePoints)]
    : []), [measurePoints, measureKind])

  // editing a selected drawing: show draggable vertex handles + a move handle.
  // read-only never gets handles: the app's edit callbacks are no-ops there, so grabbable-looking
  // vertices would move under the finger and snap back — the worst kind of 3am lie.
  const editDraw = !georefOn && !readOnly && !picking && !freehand && !draftKind && !measureKind && resolvedSelectedDrawing && Array.isArray(resolvedSelectedDrawing.coords) && resolvedSelectedDrawing.coords.length > 0 ? resolvedSelectedDrawing : null
  const editCircle = !!editDraw && editDraw.kind === 'circle'
  const editArea = !!editDraw && editDraw.kind === 'area' && editDraw.coords.length >= 3
  // circle: no per-vertex handles (it's centre + radius, not a polyline) — the centre
  // move-grip relocates it and the DrawEditor sets the radius.
  const editNodes = !!editDraw && !editCircle
  // Which of those vertices actually get a pad. A dense freehand stroke used to get NONE (the
  // old `coords.length <= MAX_VERTEX_HANDLES` gate) — it now gets an evenly spread subset that
  // densifies as the operator zooms in, since the thinning is measured in projected px. Recomputed
  // on every render; the map bumps a render on moveend (see bumpLabelFrame), so a pinch-zoom lands
  // the new spread when the fingers come off.
  const editHandleIdx = editNodes && editDraw
    ? mapInst.current
      ? vertexHandleIndices(editDraw.coords.map((c) => { const p = mapInst.current!.project(c as [number, number]); return [p.x, p.y] as [number, number] }))
      : evenIndices(editDraw.coords.length)
    : []
  // The vertex that carries the arrowhead is drawn HOLLOW, so the spitze stays visible through it
  // (the arrow is a symbol layer on the canvas and a node pad is a DOM marker — nothing can paint
  // the head above it). Same helper the Plan uses, so the two surfaces ring the same node.
  const editRingIdx = editDraw ? arrowEndIndices(editDraw, editDraw.coords.length) : []
  // A «+» in every gap between two SHOWN pads — one per gap, never one per stored segment.
  // ⚠️ Until 05.09. the «+» row was all-or-nothing: it appeared only while EVERY vertex still had
  // a pad, on the grounds that the midpoint of the chord between two shown nodes is nowhere near
  // the ink when real vertices sit between them. True, and the wrong conclusion — the line the
  // tool draws by default is FREEHAND (lib/useMapDrawing · lineMode), which carries a point every
  // 3.5px and is therefore thinned on any screen and hardest on a phone, where the whole stroke
  // fits in a few hundred px. So the affordance was missing exactly where the finger needs it
  // most, on the kind of line people actually draw. The «+» goes back ON the path instead
  // (subPathInsert): it sits at the
  // half-way point ALONG the stroke between the two pads, and inserting it changes no geometry at
  // all — it only leaves a grabbable node where there was none. On an unthinned line that is
  // exactly the segment midpoint the «+» has always been.
  const editInserts = editNodes && editDraw && editDraw.coords.length >= 2
    ? handleGaps(editHandleIdx, editDraw.coords.length, editArea).map(([a, b]) => subPathInsert(editDraw.coords, a, b))
    : []
  const editFC = useMemo(() => fc(editDraw ? [editCircle ? polyFeat(circleRing(editDraw)) : editArea ? polyFeat(editDraw.coords) : lineFeat(editDraw.coords)] : []), [editDraw, editCircle, editArea])
  const editCentroid: LngLat | null = editDraw
    ? [editDraw.coords.reduce((s, c) => s + c[0], 0) / editDraw.coords.length,
       editDraw.coords.reduce((s, c) => s + c[1], 0) / editDraw.coords.length]
    : null
  const moveRef = useRef<{ start: LngLat; coords: LngLat[] } | null>(null)
  // Translate from the geometry snapshotted at drag-start (moveRef.coords), NOT the live doc —
  // 'move' streams into the doc each frame, so reading it back would re-add the full delta and
  // race the line away. Attached endpoints stay pinned (moveLineBody) and re-resolve on render.
  const bodyMovedCoords = (id: string, dx: number, dy: number): LngLat[] => {
    const stored = storedDrawings.find((d) => d.id === id)
    const base = moveRef.current?.coords ?? stored?.coords
    if (!base || !stored) return stored?.coords ?? []
    return moveLineBody({ id, points: base, startAttachment: stored.startAttachment, endAttachment: stored.endAttachment }, [dx, dy])
  }
  // a marquee group (≥2 across drawings + entities): which objects light up as "selected" = the
  // group, else the single edit target. Both boxed drawings AND boxed symbols/entities join it.
  // It is moved, turned and deleted from the same bar every other selection uses (SelectionBar).
  const groupActive = (selectedDrawIds.length + selectedEntityIds.length) > 1 && !picking && !freehand && !draftKind && !measureKind
  const groupDraws = groupActive ? drawings.filter((d) => selectedDrawIds.includes(d.id) && Array.isArray(d.coords) && d.coords.length > 0) : []
  const groupEnts = groupActive ? entities.filter((e) => selectedEntityIds.includes(e.id) && Array.isArray(e.coord) && !e.live) : []
  const groupCentroid: LngLat | null = centroid([
    ...groupDraws.flatMap((d) => d.coords as [number, number][]),
    ...groupEnts.map((e) => e.coord as [number, number]),
  ])
  // dragging a line's distance/text label: the label is anchored at a GEOREFERENCED point
  // (the polyline midpoint, or a dragged `labelAt`). We keep the grab offset between the
  // pointer and that anchor constant, and on each move unproject (pointer − grab) back to a
  // lng/lat — so the label tracks the finger AND stays pinned to the ground at any zoom/bearing.
  const labelDrag = useRef<{ id: string; gx: number; gy: number; sx: number; sy: number; which: 'label' | 'end' } | null>(null)
  const labelMoved = useRef(false)
  /** press origin on a RESTING end tag (no drag armed there) — lets its release handler tell a
   *  tap from a map pan that happened to start and end on the tag */
  const tagRestPress = useRef<{ x: number; y: number; pointerId: number } | null>(null)
  /** the pointerup already answered that press — swallow the trailing synthetic click */
  const tagTapped = useRef(false)
  // pointer → georeferenced [lng,lat], minus the grab offset captured on pointerdown
  const labelAnchorAt = (e: React.PointerEvent): LngLat | null => {
    const m = mapInst.current, st = labelDrag.current; if (!m || !st) return null
    const r = m.getContainer().getBoundingClientRect()
    const p = m.unproject([e.clientX - r.left - st.gx, e.clientY - r.top - st.gy])
    return [p.lng, p.lat]
  }
  const labelDown = (e: React.PointerEvent, id: string, anchor: LngLat, which: 'label' | 'end' = 'label') => {
    e.stopPropagation(); e.preventDefault()
    labelMoved.current = false
    const m = mapInst.current
    const r = m?.getContainer().getBoundingClientRect()
    const a = m?.project(anchor as [number, number])
    // grab offset = pointer − the anchor's current screen position, so the label doesn't jump under the finger
    labelDrag.current = {
      id,
      gx: r && a ? e.clientX - r.left - a.x : 0,
      gy: r && a ? e.clientY - r.top - a.y : 0,
      sx: e.clientX,
      sy: e.clientY,
      which,
    }
    onLabelMove?.(id, null, 'start', which)
    ;(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId)
    // The label is a plain (non-draggable) Marker living INSIDE maplibre's canvas container,
    // whose DragPan arms on the native `mousedown`/`touchstart`. React's onPointerDown
    // stopPropagation only stops the pointerdown — the separate native mousedown still bubbles
    // to DragPan and pans the whole map under the finger. Disable the map's pan for the gesture
    // (same toggle-dragPan pattern the canvas-gesture hook uses) and re-enable it on release.
    mapInst.current?.dragPan.disable()
  }
  const labelMove = (e: React.PointerEvent) => {
    const st = labelDrag.current; if (!st) return
    e.stopPropagation()
    const at = labelAnchorAt(e)
    if (at) {
      if (Math.hypot(e.clientX - st.sx, e.clientY - st.sy) >= DRAG_DEADZONE_PX) labelMoved.current = true
      onLabelMove?.(st.id, at, 'move', st.which)
    }
  }
  const labelUp = (e: React.PointerEvent) => {
    mapInst.current?.dragPan.enable()
    const st = labelDrag.current; if (!st) return
    e.stopPropagation()
    const at = labelAnchorAt(e); if (at) onLabelMove?.(st.id, at, 'end', st.which)
    labelDrag.current = null
  }
  const activateLineLabel = (e: React.SyntheticEvent, id: string, truppId?: string, tone?: ReturnType<typeof truppLineTone>) => {
    e.stopPropagation()
    if (labelMoved.current) { labelMoved.current = false; return }
    const action = lineLabelAction(truppId, tone)
    if (action.kind === 'trupp' && onShowTrupp) onShowTrupp(action.id)
    else onSelectDrawing(id)
  }
  const selHighlight: (string | number)[] = selectedDrawIds.length ? selectedDrawIds : (selectedDrawingId ? [selectedDrawingId] : ['__none__'])
  const flashHighlight: (string | number)[] = flashDrawingId ? [flashDrawingId] : ['__none__']
  // ── the selection bar's one transform target ─────────────────────────────────────────────
  // Every native selection on this surface — one Linie/Fläche/Absperrkreis, one Form, or a
  // Mehrfach group — is moved, turned and deleted from ONE bar at the bottom of the map
  // (components/SelectionBar). What differs per kind is only which of the app's existing writers
  // the delta lands in, so undo, the Verlauf row and the attachment rules stay exactly as they
  // were for each of them.
  const selShape = !groupActive && !editDraw && draggable && !georefOn && !readOnly
    ? entities.find((e) => e.id === selectedId && e.kind === 'shape' && !e.locked && !e.live)
    : undefined
  /** the selection's centre, snapshotted at gesture start — the live one travels with the drag */
  const barFrom = useRef<{ at: LngLat; coords: LngLat[]; rotation: number } | null>(null)
  const barCentre: LngLat | null = groupCentroid ?? (editDraw ? editCentroid : selShape ? selShape.coord : null)
  /** client px → a lng/lat delta measured at `at`, so the selection travels with the finger at
   *  any zoom and bearing */
  const barDelta = (dx: number, dy: number, at: LngLat): [number, number] | null => {
    const m = mapInst.current
    if (!m) return null
    const p = m.project(at as [number, number])
    const ll = m.unproject([p.x + dx, p.y + dy])
    return [ll.lng - at[0], ll.lat - at[1]]
  }
  const barMove = (dx: number, dy: number, phase: 'start' | 'move' | 'end') => {
    if (phase === 'start') {
      if (!barCentre) return
      beginSheetPeek()
      barFrom.current = { at: barCentre, coords: editDraw?.coords ?? [], rotation: selShape?.rotation ?? 0 }
      if (editDraw) { moveRef.current = { start: barCentre, coords: editDraw.coords }; onDrawingEdit?.(editDraw.id, editDraw.coords, 'start') }
      else if (selShape) onMarkerDragStart(selShape.id)
      else if (groupActive) onGroupTransform?.(selectedDrawIds, selectedEntityIds, { dLng: 0, dLat: 0, deg: 0 }, 'start')
      return
    }
    const st = barFrom.current
    const d = st && barDelta(dx, dy, st.at)
    if (!st || !d) return
    // ⚠️ The writers run BEFORE the refs are cleared: bodyMovedCoords translates from the
    // snapshot in moveRef, and dropping it first would leave the final frame translating the
    // already-moved live geometry — the line would jump the whole delta a second time.
    if (editDraw) onDrawingEdit?.(editDraw.id, bodyMovedCoords(editDraw.id, d[0], d[1]), phase)
    else if (selShape) {
      const to: LngLat = [st.at[0] + d[0], st.at[1] + d[1]]
      if (phase === 'end') onMarkerDragEnd(selShape.id, to)
      else onMarkerMove(selShape.id, to)
    } else if (groupActive) onGroupTransform?.(selectedDrawIds, selectedEntityIds, { dLng: d[0], dLat: d[1], deg: 0 }, phase)
    if (phase === 'end') { endSheetPeek(); barFrom.current = null; moveRef.current = null }
  }
  // The free dial. A rigid turn in the geo frame IS a rigid turn on screen whatever the map's
  // bearing is (the screen frame is the geo one, rotated), so the bar's degrees go in unchanged;
  // `xScale` only compensates that a degree of longitude is shorter than one of latitude.
  const barRotate = (deg: number, phase: 'start' | 'move' | 'end') => {
    if (phase === 'end') setBarTurn(null)
    else if (phase === 'start') { const c = barCentreClient(); setBarTurn(c ? { cx: c.x, cy: c.y, deg: 0 } : null) }
    else setBarTurn((t) => (t ? { ...t, deg } : t))
    if (phase === 'start') {
      if (!barCentre) return
      barFrom.current = { at: barCentre, coords: editDraw?.coords ?? [], rotation: selShape?.rotation ?? 0 }
      if (editDraw) onDrawingEdit?.(editDraw.id, editDraw.coords, 'start')
      else if (selShape) onShapeTransform?.(selShape.id, {}, 'start')
      else if (groupActive) onGroupTransform?.(selectedDrawIds, selectedEntityIds, { dLng: 0, dLat: 0, deg: 0 }, 'start')
      return
    }
    const st = barFrom.current
    if (!st) return
    if (editDraw) {
      const xScale = Math.cos((st.at[1] * Math.PI) / 180) || 1e-6
      onDrawingEdit?.(editDraw.id, st.coords.map((c) => rotateAround(c as [number, number], st.at as [number, number], deg, { xScale, yUp: true }) as LngLat), phase)
    } else if (selShape) {
      // ⚠️ The bearing always rides a 'move': the entity writer deliberately ignores the patch on
      // 'end' (it only closes the undo step there — MapMarkers · shapeUp sends {} for the same
      // reason), so the last few degrees of the turn would be dropped on release.
      onShapeTransform?.(selShape.id, { rotation: turnedBy(st.rotation, deg) }, 'move')
      if (phase === 'end') onShapeTransform?.(selShape.id, {}, 'end')
    } else if (groupActive) onGroupTransform?.(selectedDrawIds, selectedEntityIds, { dLng: 0, dLat: 0, deg }, phase)
    if (phase === 'end') barFrom.current = null
  }
  /** «Fertig» — the editing state ends. The bar carries no Löschen any more: an object is
   *  deleted from its own editor sheet and with the Delete key, so the one destructive action
   *  is not sitting on chrome two taps from every grip. */
  const barDone = () => { onSelectionDone?.() }
  // ⟳ is absent, not inert, where the model carries no angle: an Absperrkreis is a centre and a
  // radius, and a dead button at 3am is a button you keep pressing.
  const barCanRotate = !!(groupActive ? onGroupTransform
    : editDraw ? !editCircle && onDrawingEdit
    : selShape ? onShapeTransform
    : false)
  const barShown = !!barCentre && !readOnly && !georefOn && !picking && !freehand && !draftKind && !measureKind
  /** the live turn, drawn on the surface beside its pivot instead of in the bar's far corner
   *  (components/SelectionTurn). Snapshotted in CLIENT px at the gesture's start, because the
   *  map moves under a turn and the pivot must not. */
  const [barTurn, setBarTurn] = useState<{ cx: number; cy: number; deg: number } | null>(null)
  /** ✥ / ⟳ tapped instead of dragged: the same two writers, taken on the map itself. The
   *  listeners capture on the map CONTAINER, so an armed drag beats the marquee, the pan and
   *  every marker without any of them knowing; MapLibre's own DragPan is held off by the same
   *  guard the bar's grip drag uses (lib/useArmedTransform). */
  const barCentreClient = () => {
    const m = mapInst.current
    if (!m || !barCentre) return null
    const r = m.getContainer().getBoundingClientRect()
    const p = m.project(barCentre as [number, number])
    return { x: r.left + p.x, y: r.top + p.y }
  }
  const arm = useArmedTransform({
    enabled: barShown,
    surface: () => mapInst.current?.getContainer() ?? null,
    centreClient: barCentreClient,
    onMove: barMove,
    onRotate: barCanRotate ? barRotate : undefined,
    onGrab: (grabbing) => setDragPanEnabled(!grabbing),
    // a different selection is a different thing to move, and an armed tool is a different
    // answer to the same press: neither carries the mode over. (The tools `barShown` already
    // rules out disarm through `enabled`; Mehrfach/Absperrkreis leave the bar standing.)
    resetKey: `${marqueeEnabled ? 'lasso' : ''}${circleEnabled ? 'circle' : ''}|${editDraw?.id ?? ''}|${selShape?.id ?? ''}|${selectedDrawIds.join(',')}|${selectedEntityIds.join(',')}`,
  })

  /**
   * Continue a gesture that started on a «+» as a drag of the node it just inserted — the second
   * half of NewNodeHandle's one-gesture insert. Listens on `window` in the capture phase for
   * the same reason nodeHold does: the pointer session began on a button inside a react-map-gl
   * Marker, which is not the element the rest of the gesture is delivered to.
   *
   * `NUDGE_PX` of slop first, so a plain tap on the «+» stays a plain tap and never writes a
   * reshape (or a Verlauf row) for a node that did not move.
   */
  const handOffNodeDrag = (ev: PointerEvent, apply: (at: LngLat | null, phase: 'start' | 'move' | 'end') => void) => {
    const m = mapInst.current
    if (!m) return
    const NUDGE_PX = 4
    const sx = ev.clientX, sy = ev.clientY
    let moved = false
    const at = (e: PointerEvent): LngLat | null => {
      const r = m.getContainer().getBoundingClientRect()
      const p = m.unproject([e.clientX - r.left, e.clientY - r.top])
      return [p.lng, p.lat]
    }
    const move = (e: PointerEvent) => {
      if (!moved) {
        if (Math.hypot(e.clientX - sx, e.clientY - sy) < NUDGE_PX) return
        moved = true
        beginSheetPeek() // the inserted node is now travelling — let the phone sheet peek away
        apply(null, 'start')
      }
      apply(at(e), 'move')
    }
    const up = (e: PointerEvent) => {
      window.removeEventListener('pointermove', move, true)
      window.removeEventListener('pointerup', up, true)
      window.removeEventListener('pointercancel', up, true)
      endSheetPeek()
      if (moved) apply(at(e), 'end')
    }
    window.addEventListener('pointermove', move, true)
    window.addEventListener('pointerup', up, true)
    window.addEventListener('pointercancel', up, true)
  }

  const handleClick = (e: MapLayerMouseEvent) => {
    // swallow the click that trails a long-press vertex delete (keeps the line selected)
    if (suppressClick.current) { suppressClick.current = false; return }
    // …and the one that trails a pan/pinch (see panGesture): moving the map is not a tap on it,
    // so it may neither deselect, nor place, nor pick.
    if (clickTrailsPan()) return
    // …and the one that only closes a Wassertransport pump's bubble open on the map: in Messen it
    // must not also add a point, anywhere else not also deselect (RelayPumpMarkers)
    if (dismissRelayBubble()) return
    // everything else is the dispatcher's call (components/mapClick · routeMapClick)
    const m = mapInst.current
    const click = routeMapClick({
      at: [e.lngLat.lng, e.lngLat.lat], point: e.point, features: e.features ?? [], georefOn, picking: !!picking,
      measure: measureKind ? { points: measurePoints, isArea: measureKind === 'area', canInsert: !!onMeasureInsert } : null,
      edit: editDraw && editNodes ? { id: editDraw.id, points: editDraw.coords, isArea: editArea, canInsert: !!onDrawingVertexInsert } : null,
      draft: draftKind ? { points: draft, isArea: draftKind === 'area', canInsert: !!onDraftInsert } : null,
      placing: !!placing, lockedIds,
    }, m ? (c) => m.project(c as [number, number]) : null)
    switch (click.kind) {
      case 'pick': onPick?.(click.at); return
      case 'measureInsert': onMeasureInsert?.(click.index, click.at); return
      case 'vertexInsert': onDrawingVertexInsert?.(click.id, click.index, click.at); return
      case 'draftInsert': onDraftInsert?.(click.index, click.at); return
      case 'selectDrawing': onSelectDrawing(click.id, click.at); return
      case 'place': onMapClick(placeMagnet ? place.placedCoord(click.at) : click.at); return
      case 'none': return
    }
  }
  const fhFC = useMemo(() => fc(fhPath && fhPath.length >= 2 ? [lineFeat(fhPath)] : []), [fhPath])
  // team trails: the dashed line through a Trupp's RECORDED positions (parity with the plan
  // board's ink polyline — the breadcrumb dots + timestamps stay DOM markers in MapMarkers).
  // An OUT Trupp's line wears its marker's done dim (`done`: the neutral grey at --done-opacity,
  // the paint's stand-in for `.raus`'s grayscale + opacity), so the whole group recedes together.
  const trailFC = useMemo(() => fc(entities
    .filter((e) => e.kind === 'team' && isVisible(effectiveLayer(e)) && (e.trail?.length ?? 0) >= 2 && !hiddenTrails.has(e.id))
    .map((e) => lineFeat((e.trail ?? []).map((p) => p.coord), {
      color: e.color || appConfig.drawing.teamColors[0],
      done: !!e.truppId && !!trupps?.some((t) => t.id === e.truppId && t.status === 'raus'),
    }))), [entities, isVisible, hiddenTrails, trupps])
  const doneOpacity = Number(themeToken('--done-opacity', '.5')) || 0.5
  // …and the same dashed line for a ghost trail, in the neutral ink: the marker is gone, so the
  // Trupp's own colour would claim a Trupp that is not standing anywhere (lib/truppTrails).
  const ghostTrailFC = useMemo(() => fc((ghostTrails ?? [])
    .filter((g) => (g.geo?.length ?? 0) >= 2)
    .map((g) => lineFeat((g.geo ?? []).map((p) => p.coord), { color: GHOST_TRAIL_INK }))), [ghostTrails])
  // Vehicle tracks from Traccar — their own layer, off by default, and only polled while it is
  // switched on. Distinct from the Trupp trails above: those are positions the operator recorded
  // by hand, these are recorded by the vehicles themselves.
  const vehicleTrailFC = useVehicleTrails(isVisible(appConfig.gps.trailsLayerId))

  return (
   <>
    <Map
      // A changed key rebuilds the whole map — the ONLY way back from a lost WebGL context.
      key={gl.generation}
      ref={ref}
      // Reading a ref during render is exactly right here and nowhere else: `initialViewState`
      // is consumed ONCE per map instance (on mount), so on a context-loss remount it must see
      // the view as it stood a moment ago — resuming the operator's framing instead of snapping
      // back to the incident's initial one. Putting the live view in state would re-render the
      // map on every pan.
      // eslint-disable-next-line react-hooks/refs
      initialViewState={resumeViewState(viewRef.current, initialCenter, initialZoom, initialBearing)}
      mapStyle={EMPTY_STYLE}
      // Map/style/tile errors were only console.error'd by react-map-gl's default handler, so a
      // field failure was invisible to the deployer. Report, but never rethrow: a failed tile
      // must not take the incident down.
      onError={(e) => {
        reportMapError(e.error)
        // A BASE tile failing while the device is offline = no cached basemap for this view: the
        // map is a flat colour with symbols on it and nothing says why. MapLibre re-fires a
        // source's error at the map with the `sourceId` it belongs to (style.ts · setEventedParent);
        // react-map-gl's ErrorEvent type does not carry it, hence the structural read.
        const sourceId = (e as { sourceId?: string }).sourceId
        if (sourceId && !navigator.onLine && layers.some((l) => l.base && `s-${l.id}` === sourceId)) onBasemapUnavailable?.()
      }}
      onClick={handleClick}
      // ⚠️ BOTH fill layers. `l-draw-hit` is line-only, so a polygon's INTERIOR is picked through
      // its fill — and a hatched Fläche lives in its own layer. Leaving it out made the
      // Schraffur selectable only by its outline, which is a 4px target around a shape whose
      // whole inside looks tappable. (A `fill` layer hit-tests by geometry, not by painted
      // pixels, so the gaps between the hatch lines are live too.)
      interactiveLayerIds={['l-draw-edit-hit', 'l-measure-hit', 'l-draft-hit', 'l-draw-hit', 'l-draw-line', 'l-draw-line-dash', 'l-draw-fill', 'l-draw-hatch']}
      onLoad={(e) => {
        const m = e.target as MlMap
        mapInst.current = m
        // two fingers turn the Karte only after a deliberate twist (lib/mapTwist) — never
        // incidentally inside a pan or a pinch, which is what turned it on an iPad (23.09.2026)
        gateTouchRotation(m)
        setMapReady(true)
        // PWA cold start can initialise the map before its container has a real size, leaving a
        // single tile stretched across the view (the "kaleidoscope"). Force a couple of resizes
        // once layout settles so MapLibre re-fetches tiles at the correct size.
        requestAnimationFrame(() => { try { m.resize() } catch { /* map gone */ } })
        setTimeout(() => { try { m.resize() } catch { /* map gone */ } }, 400)
      }}
      onMoveEnd={(e) => {
        // a hand turn resting within NORTH_SNAP_DEG of north settles on it (its own ease carries
        // no originalEvent, so its moveend lands here as an ordinary settle and never re-snaps)
        if (mapInst.current) northSnap.moveEnd(mapInst.current, e.originalEvent, motionDuration(NORTH_SNAP_MS))
        setZoom(e.viewState.zoom); setBearing(e.viewState.bearing); setLiveBearing(e.viewState.bearing); bumpLabelFrame()
        viewRef.current = { center: [e.viewState.longitude, e.viewState.latitude], zoom: e.viewState.zoom, bearing: e.viewState.bearing }
        onView({ bearing: e.viewState.bearing, center: [e.viewState.longitude, e.viewState.latitude], zoom: e.viewState.zoom })
      }}
      // Keep only the LOCAL bearing live per rotate frame (the tactical glyphs re-render with the
      // −bearing offset so they stay geographically pinned). Deliberately NOT calling onView here:
      // that re-renders all of IncidentWorkspace every frame of a two-finger rotate. onMoveEnd
      // fires at the end of the gesture and updates App's view state then — the coord readout
      // just settles on release instead of tracking every frame. The wind arrow and the compass
      // needle are the exceptions – they turn WITH the finger, through their own store
      // (lib/liveBearing), which re-renders only the two glyphs.
      onRotate={(e) => { setBearing(e.viewState.bearing); setLiveBearing(e.viewState.bearing) }}
      onRotateStart={(e) => northSnap.rotateStart(e.originalEvent)}
      // MapLibre says a genuine pan began. That (a) opens the pan gesture the trailing click is
      // measured against (see panGesture), (b) peeks the phone detail sheet down for as long as
      // the map moves — the same shrink a dragged object already gets (lib/sheetPeek), for the
      // same reason: the gesture is about the map, not about the sheet — and (c) settles the
      // gesture as a drag for the pairing mode, whatever the raw travel looked like, so an armed
      // mode never turns a pan into a reference point.
      // ⚠️ (a) is TOUCH gestures only — the same narrowing the onZoomStart/onZoomEnd pair below
      // makes, for the same reason: only touch leaves a synthesized click behind. A real mouse
      // drag never produces one (MapLibre's own 3px clickTolerance already eats it), so on the
      // desktop the window swallowed nothing but genuinely NEW clicks — pan, then click to place
      // within 350ms, and the placement silently did not happen.
      // ⚠️ (c) is MOUSE gestures only. MapLibre arms its touch drag-pan after ~3px, which every
      // finger tap exceeds by pure wobble — unconditional, a tablet could not place a map
      // reference point AT ALL: each tap «began a pan» and died. Touch keeps the tap/pan
      // distinction from its own travel instead (trackTap · GEOREF_TAP_SLOP_PX): a real pan
      // moves far past the slop before release, a tap does not.
      onDragStart={(e) => {
        if (e.originalEvent && 'touches' in e.originalEvent) beginPanGesture()
        beginSheetPeek()
        place.cancel() // panning away is not a tap on anything
        if (georefOn && !(e.originalEvent && 'touches' in e.originalEvent)) georefTap.panned()
      }}
      onDragEnd={(e) => { if (e.originalEvent && 'touches' in e.originalEvent) endPanGesture(); endSheetPeek() }}
      // A pinch that never armed drag-pan (two fingers down together) still moves the map, so it
      // closes the same gesture. Touch only: a wheel zoom leaves no click behind, and swallowing
      // one would cost the desktop operator the tap right after a zoom.
      onZoomStart={(e) => { if (e.originalEvent && 'touches' in e.originalEvent) { beginPanGesture(); beginSheetPeek() } }}
      onZoomEnd={(e) => { if (e.originalEvent && 'touches' in e.originalEvent) { endPanGesture(); endSheetPeek() } }}
      // North-snap on release (18.10.2026, owner): a turn by HAND (fingers or the mouse's
      // right-drag) that comes to rest within NORTH_SNAP_DEG (10°) of north settles on exactly
      // north in a short ease (onRotateStart + onMoveEnd above, lib/mapTwist · createNorthSnap);
      // a clear turn further stays, and «Nach Norden» is the way back. Not the old 6° self-heal
      // (removed 24.09.2026) – that healed a twist a pan/pinch leaked in, which the twist gate
      // now prevents; this one helps a deliberate turn LAND on north. Never mid-gesture, never
      // for the keyboard or a programmatic bearing (compass, saved view, a plan's alignment).
      // ⚠️ A press that begins on a CROSS never starts a placement gesture: the cross's own
      // handlers (pick / drag) own it, but their native events still bubble to this container —
      // without the filter, clicking a pending cross also dropped a stray point underneath it.
      onMouseDown={(nodeMagnetActive || georefOn || placeMagnet) ? (e) => { if (placeMagnet) place.down([e.lngLat.lng, e.lngLat.lat]); if (georefOn && !georefTapOnMarker(e.originalEvent?.target)) { aimGeorefMap(); georefTap.start(e.point) } if (nodeMagnetActive) updateDraftMagnet('start', [e.lngLat.lng, e.lngLat.lat]) } : undefined}
      onMouseMove={(picking || nodeMagnetActive || georefOn || placeMagnet) ? (e) => { if (placeMagnet) place.move([e.lngLat.lng, e.lngLat.lat]); if (picking) onCursor?.([e.lngLat.lng, e.lngLat.lat]); if (georefOn) georefTap.track(e.point); if (georefTurn) { aimGeorefMap(); georefPoint.current = { lng: e.lngLat.lng, lat: e.lngLat.lat } } if (nodeMagnetActive) updateDraftMagnet('move', [e.lngLat.lng, e.lngLat.lat]) } : undefined}
      onMouseUp={(nodeMagnetActive || georefOn || placeMagnet) ? (e) => { if (placeMagnet) place.up(); if (georefOn) { const tapped = georefTap.end(); if (!isPhone && tapped) placeGeoref(e.lngLat) } if (nodeMagnetActive) finishDraftNodeMagnet([e.lngLat.lng, e.lngLat.lat]) } : undefined}
      // ⚠️ The pairing aim is deliberately NOT cleared here. The loupe is up for the whole of the
      // map's turn and keeps showing the last thing aimed at — clearing it on mouse-out closed
      // the magnifier every time the hand crossed the seam back to the plan.
      onMouseOut={picking ? () => onCursor?.(null) : undefined}
      // mousemove never fires on touch — stream the aim coords from the drag as well,
      // so the crosshair readout tracks the finger on iPhone/iPad
      // same cross filter as onMouseDown — a finger on a cross is a pick, never a placement
      onTouchStart={(nodeMagnetActive || georefOn || placeMagnet) ? (e) => { if (placeMagnet) place.down([e.lngLat.lng, e.lngLat.lat]); if (georefOn && !georefTapOnMarker(e.originalEvent?.target)) { aimGeorefMap(); georefTap.start(e.point, e.points.length > 1) } if (nodeMagnetActive) updateDraftMagnet('start', [e.lngLat.lng, e.lngLat.lat]) } : undefined}
      // mousemove never fires on touch — the loupe follows the drag instead, which is exactly the
      // gesture the mock asks for («halten und schieben»)
      onTouchMove={(picking || nodeMagnetActive || georefOn || placeMagnet) ? (e) => { if (placeMagnet) place.move([e.lngLat.lng, e.lngLat.lat]); if (picking) onCursor?.([e.lngLat.lng, e.lngLat.lat]); if (georefOn) georefTap.track(e.point, e.points.length > 1); if (georefTurn) { aimGeorefMap(); georefPoint.current = { lng: e.lngLat.lng, lat: e.lngLat.lat } } if (nodeMagnetActive) updateDraftMagnet('move', [e.lngLat.lng, e.lngLat.lat]) } : undefined}
      // ⚠️ A placing tap CANCELS its touchend. The browser follows an uncancelled tap with a
      // synthesized mousedown/mouseup/click at the same position: the mouse pair re-ran this
      // very machine (one duplicate point per tap), and the click landed on the cross that had
      // JUST mounted under the finger — picking it up, so the next tap silently re-placed that
      // point instead of setting the next one. That loop, not finger wobble, is what made
      // tablet placement «very unreliable». MapLibre registers touchend non-passively, so
      // preventDefault here is honoured and stops the whole synthetic trail. Pans, pinches and
      // non-placing taps stay untouched — crosses keep receiving their real taps.
      onTouchEnd={(nodeMagnetActive || georefOn || placeMagnet) ? (e) => { if (placeMagnet) { place.up(); if (place.armed()) { onMapClick(place.placedCoord([e.lngLat.lng, e.lngLat.lat])); e.originalEvent?.preventDefault() } } if (georefOn) { const tapped = georefTap.end(); if (!isPhone && tapped && placeGeoref(e.lngLat)) e.originalEvent?.preventDefault() } if (nodeMagnetActive) finishDraftNodeMagnet([e.lngLat.lng, e.lngLat.lat]) } : undefined}
      /* ⚠️ an ARMED claim places on the RELEASE itself (above): past the browser's long-press
         threshold no synthetic click follows a touch, so waiting for handleClick left the ring
         closed and nothing placed — the same lesson the georef taps learned (28.08.).
         preventDefault() keeps the odd click that does follow from placing a second time. */
      // 'default', not maplibre's grab hand: panning is THE ambient gesture on this surface,
      // and a permanent hand implied a drag mode the operator never chose (field, 30.08.)
      cursor={picking || georefTurn ? 'crosshair' : 'default'}
      attributionControl={false}
      maxPitch={0}
      // ⚠️ MapLibre's OWN north-snap off: its default `bearingSnap: 7` eased back over a fixed 1 s
      // (so slowly nobody read it as a snap) and sat unseen under «no north-snap» from 24.09. to
      // 18.10.2026. The one rule is lib/mapTwist · createNorthSnap (5°, short ease).
      bearingSnap={0}
      // 21 (14.09., one more step than the tiles have) for the Einsatz: precise symbol placement
      // beats a soft base there (owner on #383). The raster SOURCES keep their own native `maxzoom`
      // (MapLayers), so past it MapLibre stretches the last tile level. The Karte asks for the
      // visible base's last SHARP level instead (`zoomCapAtBase`, lib/mapView · mapMaxZoom); a base
      // that ends sooner (OSM) then clamps the view. Symbols are pinned by symPx's band and a Form
      // by shapePx's ceiling, so nothing outgrows the screen on the extra step.
      maxZoom={mapMaxZoom(layers.find((l) => l.base && isVisible(l.id)), zoomCapAtBase)}
      // Only the print/report instance needs its GL back-buffer preserved (it captures the canvas
      // via getCanvas().toDataURL() — see ReportPrintView / reportPdf). On the always-live field
      // map keeping the buffer around just raises the per-repaint GPU/memory cost for the whole
      // shift, so gate it to the static instance. (A WebGL context attribute since MapLibre 5 —
      // the rest of the object keeps MapLibre's defaults, it is merged, not replaced.)
      canvasContextAttributes={{ preserveDrawingBuffer: staticView }}
    >
      <QuietAttributionControl />
      <MapImages layers={layers} byName={byName} />
      <MapLayers layers={layers} preparedOverlays={preparedOverlays} isVisible={isVisible} mapReady={mapReady} />

      {/* Literal georeferenced Modul sheets are separate from their symbol projections. Ebenen
          owns visibility + transparency; they sit above the basemap and below every tactical
          object, exactly like a reference raster rather than like an editable surface. */}
      {!georefOn && georefPlanRasters.map((p, i) => (
        <Source key={p.id} id={`s-georef-plan-${i}`} type="image" url={p.url} coordinates={p.coordinates}>
          <Layer id={`l-georef-plan-${i}`} type="raster"
            paint={{ 'raster-opacity': p.opacity, 'raster-fade-duration': 0 }} />
        </Source>
      ))}

      {/* «Karte verknüpfen»: the numbered reference crosses, drag-to-fine-tune, tap-to-re-place */}
      {!georef.check && <GeorefMapMarks mode={georef} map={mapInst.current} />}
      {/* …and the one-shot «Deckung prüfen»: the sheet's outline, where the fit puts it */}
      <GeorefCheckOutline mode={georef} map={mapInst.current} />

      {/* committed drawings (per-feature colour/width) — gated by the markup layer toggle */}
      <Source id="s-draw" type="geojson" data={drawFC}>
        {/* Atemschutz halo: the Leitung a due/überfällig Trupp works on keeps its own colour and
            gains a soft outline in the alarm tone — the picture says WHERE those people are,
            while the Atemschutz board stays the surface that actually alarms. */}
        <Layer id="l-draw-atemschutz" type="line" filter={['!=', ['get', 'truppTone'], '']}
          layout={{ 'line-cap': 'round', 'line-join': 'round', ...vis(drawingsVisible && !georefOn) }}
          paint={{
            'line-color': ['match', ['get', 'truppTone'], 'crit', appConfig.drawing.atemschutzTone.crit, appConfig.drawing.atemschutzTone.warn],
            'line-width': ['+', ['get', 'width'], 8],
            'line-opacity': 0.45,
          }} />
        <Layer id="l-draw-network" type="line" filter={['>=', ['get', 'networkDepth'], 0]}
          layout={{ 'line-cap': 'round', 'line-join': 'round', ...vis(drawingsVisible && !georefOn) }}
          paint={{ 'line-color': appConfig.drawing.selectColor, 'line-width': ['+', ['get', 'width'], 9], 'line-opacity': ['interpolate', ['linear'], ['get', 'networkDepth'], 0, 0.34, 4, 0.08] }} />
        {/* «zeigen» outline: wider and softer than the selection halo, and it goes away by itself.
            Deliberately NOT animated — a pulsing hose was tried and rejected on the Lage; the
            camera has just moved here, so a steady ring is enough to say which line. */}
        <Layer id="l-draw-flash" type="line" filter={['in', ['get', 'id'], ['literal', flashHighlight]]}
          layout={{ 'line-cap': 'round', 'line-join': 'round', ...vis(drawingsVisible && !georefOn) }}
          paint={{ 'line-color': appConfig.drawing.selectColor, 'line-width': ['+', ['get', 'width'], 14], 'line-opacity': 0.3 }} />
        <Layer id="l-draw-sel" type="line" filter={['in', ['get', 'id'], ['literal', selHighlight]]}
          layout={{ 'line-cap': 'round', 'line-join': 'round', ...vis(drawingsVisible && !georefOn) }}
          paint={{ 'line-color': appConfig.drawing.selectColor, 'line-width': ['+', ['get', 'width'], 6], 'line-opacity': 0.5 }} />
        {/* TWO fill layers, not one expression: `fill-pattern` overrides `fill-color` whenever it
            resolves, and a `case` that yields no image paints nothing at all — so the washed and
            the hatched Flächen are filtered apart and each gets the paint it can actually use. */}
        <Layer id="l-draw-fill" type="fill" filter={['all', ['==', ['geometry-type'], 'Polygon'], ['!', ['coalesce', ['get', 'hatch'], false]]]} layout={vis(drawingsVisible && !georefOn)} paint={{ 'fill-color': ['get', 'color'], 'fill-opacity': ['*', ['coalesce', ['get', 'fillOpacity'], 0.14], night ? NIGHT_FILL_SCALE : 1] }} />
        <Layer id="l-draw-hatch" type="fill" filter={['all', ['==', ['geometry-type'], 'Polygon'], ['coalesce', ['get', 'hatch'], false]]} layout={vis(drawingsVisible && !georefOn)} paint={{ 'fill-pattern': ['concat', 'hatch-', ['downcase', ['get', 'color']]] }} />
        {/* solid + dashed split: line-dasharray can't be data-driven, so dashed lines
            render in their own layer filtered on the feature's `dashed` property */}
        <Layer id="l-draw-wand-casing" type="line" filter={['==', ['get', 'wand'], true]} layout={{ 'line-cap': 'round', 'line-join': 'round', ...vis(drawingsVisible && !georefOn) }} paint={{ 'line-color': '#ffffff', 'line-opacity': 0.85, 'line-width': ['+', ['get', 'width'], WAND_MAP_PX.casing] }} />
        <Layer id="l-draw-line" type="line" filter={['!', ['get', 'dashed']]} layout={{ 'line-cap': 'round', 'line-join': 'round', ...vis(drawingsVisible && !georefOn) }} paint={{ 'line-color': ['get', 'color'], 'line-width': ['get', 'width'] }} />
        <Layer id="l-draw-line-dash" type="line" filter={['get', 'dashed']} layout={{ 'line-cap': 'butt', 'line-join': 'round', ...vis(drawingsVisible && !georefOn) }} paint={{ 'line-color': ['get', 'color'], 'line-width': ['get', 'width'], 'line-dasharray': LINE_DASH_ML }} />
        {/* fat transparent hit line over EVERY drawn line (solid + dashed) so a click on or
            near any line — including thin/styled ones like the Rettungsachse — selects it */}
        <Layer id="l-draw-hit" type="line" filter={['!=', ['geometry-type'], 'Polygon']} layout={{ ...vis(drawingsVisible && !georefOn) }} paint={{ 'line-color': '#000', 'line-opacity': 0, 'line-width': 18 }} />
        {/* the inline letter marker (e.g. R on a Rettungsachse) renders as a DOM Marker below
            — a MapLibre text-field symbol would require a `glyphs` font source this
            offline-first style intentionally omits (it would also break offline). */}
      </Source>
      {/* «Angekuppelt»: the joint dot (joinFC) — over the strokes it joins, under the arrowheads */}
      <Source id="s-draw-join" type="geojson" data={joinFC}>
        <Layer id="l-draw-join" type="circle" layout={vis(drawingsVisible && !georefOn)}
          paint={{ 'circle-radius': ['+', ['/', ['get', 'width'], 2], 2.5], 'circle-color': ['get', 'color'], 'circle-stroke-width': 2, 'circle-stroke-color': surface }} />
      </Source>
      {/* arrowheads at the end of annotated lines (Messpfeil / Rettungsachse) — a tintable
          SDF icon rotated to the final-segment bearing */}
      <Source id="s-draw-arrow" type="geojson" data={arrowFC}>
        <Layer id="l-draw-arrow" type="symbol"
          layout={{ 'icon-image': ['get', 'icon'], 'icon-rotate': ['get', 'bearing'], 'icon-rotation-alignment': 'map', 'icon-allow-overlap': true, 'icon-anchor': 'center', 'icon-size': 1.1, ...vis(drawingsVisible && !georefOn) }}
          paint={{ 'icon-color': ['get', 'color'] }} />
      </Source>
      {/* team trails — dashed path through the recorded positions, in the team's colour
          (same look as the plan board's trail polyline); under the DOM markers by nature.
          Hidden while «Karte verknüpfen» borrows the map, like every drawing layer above —
          a dashed breadcrumb reads exactly like a landmark-worthy path during calibration. */}
      <Source id="s-team-trails" type="geojson" data={trailFC}>
        <Layer id="l-team-trails" type="line" layout={{ 'line-join': 'round', ...vis(!georefOn) }}
          paint={{ 'line-color': ['case', ['get', 'done'], GHOST_TRAIL_INK, ['get', 'color']], 'line-width': 2, 'line-dasharray': [2.5, 2.5],
            'line-opacity': ['case', ['get', 'done'], 0.85 * doneOpacity, 0.85] }} />
      </Source>
      {/* …and the ghost trails behind them: the same dashed path, in the neutral ink, because the
          Trupp that walked it is no longer standing anywhere (lib/truppTrails). */}
      <Source id="s-ghost-trails" type="geojson" data={ghostTrailFC}>
        <Layer id="l-ghost-trails" type="line" layout={{ 'line-join': 'round', ...vis(!georefOn) }}
          paint={{ 'line-color': ['get', 'color'], 'line-width': 2, 'line-dasharray': [2, 3], 'line-opacity': 0.7 }} />
      </Source>
      {/* vehicle tracks (Traccar) — solid, thin and deliberately quiet: this is context behind
          the fleet, not a tactical statement, so it must not read like a drawn hose line. The
          hook returns an empty collection whenever the layer is off, so this costs nothing then. */}
      <Source id="s-vehicle-trails" type="geojson" data={vehicleTrailFC}>
        <Layer id="l-vehicle-trails" type="line" layout={{ 'line-join': 'round', 'line-cap': 'round', ...vis(!georefOn) }}
          paint={{ 'line-color': '#00a0ff', 'line-width': 2, 'line-opacity': 0.5 }} />
      </Source>
      {/* live draft (area/line tool) — vertices are draggable handles (rendered below),
          so the in-progress shape edits exactly like the measure path */}
      <Source id="s-draft" type="geojson" data={draftFC}>
        {/* the OPEN look (27.10.2026, the Plan's twin · .wb-draft-open): amber marching dashes
            until the drawing is saved — the march is useDraftAnts below */}
        <Layer id="l-draft-fill" type="fill" filter={['==', ['geometry-type'], 'Polygon']} paint={{ 'fill-color': openTone, 'fill-opacity': 0.1 }} />
        <Layer id="l-draft-line" type="line" layout={{ 'line-cap': 'butt' }} paint={{ 'line-color': openTone, 'line-width': 3, 'line-dasharray': DRAFT_ANTS[0] }} />
        {/* fat transparent hit line so segment clicks (insert vertex) are easy to land */}
        <Layer id="l-draft-hit" type="line" paint={{ 'line-color': '#000', 'line-opacity': 0, 'line-width': 18 }} />
      </Source>
      {/* live Absperrkreis preview while dragging centre → edge (the committed circle
          renders through the normal drawings source once released) */}
      {circle && circle.radiusM > 0 && (
        <Source id="s-circle" type="geojson" data={fc([polyFeat(circlePolygon(circle.center, circle.radiusM)[0] as LngLat[])])}>
          <Layer id="l-circle-fill" type="fill" paint={{ 'fill-color': appConfig.drawing.circleColor, 'fill-opacity': appConfig.drawing.circleFillOpacity }} />
          <Layer id="l-circle-line" type="line" paint={{ 'line-color': appConfig.drawing.circleColor, 'line-width': 2, 'line-dasharray': [2, 1.5] }} />
        </Source>
      )}
      {circle && circle.radiusM > 0 && (() => {
        const top = circleEdgeAtScreen(circle.center, circle.radiusM, 0)
        return (
          <Marker longitude={top[0]} latitude={top[1]} anchor="bottom" offset={[0, -4]}>
            <div className="measure-label draw-label">{fmtDistance(circle.radiusM)}</div>
          </Marker>
        )
      })()}

      {/* live freehand path */}
      <Source id="s-fh" type="geojson" data={fhFC}>
        <Layer id="l-fh" type="line" paint={{ 'line-color': drawColor, 'line-width': drawWidth, ...(drawDashed ? { 'line-dasharray': LINE_DASH_ML } : {}) }} layout={{ 'line-cap': drawDashed ? 'butt' : 'round', 'line-join': 'round' }} />
      </Source>

      {/* measurement path (line / polygon) — vertices rendered as draggable handles below */}
      <Source id="s-measure" type="geojson" data={measureFC}>
        {/* Polygon only. A fill layer closes a LineString into a ring and shades it, so a measured
            Strecke that bends back on itself came out tinted like an area — the same guard the
            draft layer has carried all along. */}
        <Layer id="l-measure-fill" type="fill" filter={['==', ['geometry-type'], 'Polygon']} paint={{ 'fill-color': blue, 'fill-opacity': 0.1 }} />
        <Layer id="l-measure-line" type="line" paint={{ 'line-color': blue, 'line-width': 2.5, 'line-dasharray': [2, 1.2] }} layout={{ 'line-cap': 'round', 'line-join': 'round' }} />
        {/* fat transparent hit line so segment clicks (insert vertex) are easy to land */}
        <Layer id="l-measure-hit" type="line" paint={{ 'line-color': '#000', 'line-opacity': 0, 'line-width': 18 }} />
      </Source>

      {/* selected drawing being edited: an outline + fat hit-line so a click on the edge
          inserts a vertex. The visible reshape handles are DOM Markers, rendered below. */}
      {editDraw && editNodes && (
        <Source id="s-draw-edit" type="geojson" data={editFC}>
          <Layer id="l-draw-edit-hit" type="line" paint={{ 'line-color': '#000', 'line-opacity': 0, 'line-width': 18 }} />
        </Source>
      )}

      {/* Einsatzort — a quiet ring marking the incident/object location so it stays
          findable after the map is panned away. Sits below the placed markers. */}
      {showOrigin && (
        <Marker longitude={initialCenter[0]} latitude={initialCenter[1]} anchor="center">
          <div className="map-here map-incident" title={appConfig.copy.map.incidentHere} />
        </Marker>
      )}

      {/* own live position (GPS) */}
      {userPos && (
        <Marker longitude={userPos[0]} latitude={userPos[1]} anchor="center">
          <div className="map-here map-me" title={appConfig.copy.map.youHere} />
        </Marker>
      )}

      {/* the first of a Rotation's two points, while the second is still being looked for */}
      {placeAnchor && (
        <Marker longitude={placeAnchor[0]} latitude={placeAnchor[1]} anchor="center">
          <span className="place-anchor" />
        </Marker>
      )}
      {/* …and the «halten, dann verbindet es» ring on the symbol either tap is claiming */}
      {placeMag && (
        <Marker key={`placemag:${placeMag.since}`} longitude={placeMag.coord[0]} latitude={placeMag.coord[1]} anchor="center">
          <span className="magnet-anchor"><ConnectRing since={placeMag.since} armed={placeMag.armed} /></span>
        </Marker>
      )}

      {/* locked coordinate reticle */}
      {pickedPoint && (
        <Marker longitude={pickedPoint[0]} latitude={pickedPoint[1]} anchor="center">
          <div className="pick-reticle" />
        </Marker>
      )}

      {/* a «+» at each draft segment's midpoint — the same affordance the Messung and the
          selected drawing carry. Inserting into the in-progress shape used to work only through
          the line's invisible 18px hit band (l-draft-hit · segInsertIndex), with no sign it was
          possible at all; the segments now say so, and both routes insert at the same index.
          Rendered BEFORE the vertices so a node handle wins wherever the two overlap. */}
      {draftKind && onDraftInsert && draft.length >= 2 && (() => {
        const n = draft.length
        return Array.from({ length: pathSegmentCount(n, draftKind === 'area') }, (_, i) => {
          const a = draft[i], b = draft[(i + 1) % n]
          const mid: LngLat = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2]
          return (
            <Marker key={`dfi${i}`} longitude={mid[0]} latitude={mid[1]} anchor="center" style={handleZ}>
              <NewNodeHandle title={appConfig.copy.measure.insertPoint}
                onInsert={(ev) => {
                  onDraftInsert(i + 1, mid)
                  // …and the same press keeps dragging the node it just made (see NewNodeHandle)
                  if (ev && onDraftDrag) handOffNodeDrag(ev, (ll) => { if (ll) onDraftDrag(i + 1, ll) })
                }} />
            </Marker>
          )
        })
      })()}

      {/* «Linie offen» at the open drawing's last point, pulsing — the Plan's .wb-open-pill */}
      {draftKind && draft.length > 0 && (
        <Marker longitude={draft[draft.length - 1][0]} latitude={draft[draft.length - 1][1]} anchor="bottom-left" offset={[14, -14]} style={{ pointerEvents: 'none' }}>
          <span className="map-open-pill">{fillTemplate(appConfig.copy.toolDock.openPill, { name: draftKind === 'area' ? appConfig.copy.drawingEditor.area : appConfig.copy.drawingEditor.line })}</span>
        </Marker>
      )}

      {/* draggable draft vertices (area/line tool) — drag to move, right-click to delete,
          identical to the measurement handles so the in-progress shape edits the same way */}
      {draftKind && draft.map((p, i) => (
        <Marker
          key={`dh${i}`}
          longitude={p[0]}
          latitude={p[1]}
          anchor="center"
          style={handleZ}
          draggable
          onDrag={(e) => { vertexPress.cancel(); onDraftDrag?.(i, [e.lngLat.lng, e.lngLat.lat]) }}
          onDragEnd={(e) => onDraftDrag?.(i, [e.lngLat.lng, e.lngLat.lat])}
        >
          <div
            className={`measure-handle ${vertexPress.armed?.key === `draft:${i}` ? 'doomed' : ''}`}
            title={appConfig.copy.measure.deleteNode}
            {...vertexPress.press(`draft:${i}`, () => deletePointKeepTool(onDraftDelete)(i))}
            onContextMenu={(ev) => { ev.stopPropagation(); ev.preventDefault(); onDraftDelete?.(i) }}
          >{vertexPress.armed?.key === `draft:${i}` && <NodeDeleteChip progress={vertexPress.armed.progress} />}</div>
        </Marker>
      ))}

      {/* a "+" at each segment's midpoint — the same segments segInsertIndex() recognises when the
          line itself is tapped (the area's closing edge included), so both routes insert the same
          node at the same index. Rendered before the vertices so a handle wins where they overlap. */}
      {measureKind && onMeasureInsert && measurePoints.length >= 2 && (() => {
        const n = measurePoints.length
        return Array.from({ length: pathSegmentCount(n, measureKind === 'area') }, (_, i) => {
          const a = measurePoints[i], b = measurePoints[(i + 1) % n]
          const mid: LngLat = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2]
          return (
            <Marker key={`mi${i}`} longitude={mid[0]} latitude={mid[1]} anchor="center" style={handleZ}>
              <NewNodeHandle title={appConfig.copy.measure.insertPoint}
                onInsert={(ev) => {
                  onMeasureInsert(i + 1, mid)
                  // …and the same press keeps dragging the point it just made (see NewNodeHandle)
                  if (ev && onMeasureDrag) handOffNodeDrag(ev, (ll, phase) => {
                    if (phase === 'start') setMeasureDragNode(i + 1)
                    if (phase === 'end') setMeasureDragNode(null)
                    if (ll) onMeasureDrag(i + 1, ll)
                  })
                }} />
            </Marker>
          )
        })
      })()}

      {/* draggable measurement vertices */}
      {measureKind && measurePoints.map((p, i) => (
        <Marker
          key={`mh${i}`}
          longitude={p[0]}
          latitude={p[1]}
          anchor="center"
          style={measureFresh === i ? handleFresh : handleLive}
          draggable
          onDragStart={() => setMeasureDragNode(i)}
          onDrag={(e) => { vertexPress.cancel(); onMeasureDrag?.(i, [e.lngLat.lng, e.lngLat.lat]) }}
          onDragEnd={(e) => { setMeasureDragNode(null); onMeasureDrag?.(i, [e.lngLat.lng, e.lngLat.lat]) }}
        >
          <div
            className={`measure-handle ${vertexPress.armed?.key === `measure:${i}` ? 'doomed' : ''}`}
            title={appConfig.copy.measure.deleteNode}
            {...vertexPress.press(`measure:${i}`, () => deletePointKeepTool(onMeasureDelete)(i), measurePoints.length > (measureKind === 'area' ? 3 : 2))}
            onContextMenu={(ev) => { ev.stopPropagation(); ev.preventDefault(); onMeasureDelete?.(i) }}
          >{vertexPress.armed?.key === `measure:${i}` && <NodeDeleteChip progress={vertexPress.armed.progress} />}</div>
        </Marker>
      ))}

      {/* the Wassertransport's pumps — of Messen's Strecke or the selected Leitung, whichever has
          its relay open (lib/useRelay · usePublishRelay); nothing while none is */}
      {!georefOn && <RelayPumpMarkers />}
      {!georefOn && <ChartCursorMarker />}

      {/* measurement readouts pinned to the path (cumulative distance / area), BESIDE the handles:
          each one steps off its segment's left so close-together nodes cannot cover it
          (lib/measureLabelPlace; owner, review round 7). The area's single centroid label has no
          segment and keeps its place above the point.
          While a vertex is in the hand its own label is 12px under the fingertip — that one is
          suppressed (decided BEFORE the <Marker>, per the null-child trap below) and the fixed
          .measure-readout at the top edge carries the number instead. */}
      {measureLabels.map((l, i) => {
        if (measureDragNode != null && measureKind === 'line' && i === measureDragNode - 1) return null
        // label i ends the segment measurePoints[i] → measurePoints[i + 1] (measureLabels drops
        // the first point); any other shape of readout stands above its point
        const from = measureKind === 'line' ? measurePoints[i] : undefined
        const to = measureKind === 'line' ? measurePoints[i + 1] : undefined
        const place = from && to ? measureLabelPlacement(from, to, bearing) : LABEL_ABOVE
        return (
          <Marker key={`ml${i}`} longitude={l.coord[0]} latitude={l.coord[1]} anchor={place.anchor} offset={place.offset}>
            <div className={`measure-label ${l.strong ? 'strong' : ''}`}>{l.text}</div>
          </Marker>
        )
      })}

      {/* annotated-line readouts (auto distance + hose-length helper / free-text label),
          pinned to each line's midpoint — reuses the measure-label chrome */}
      {/* ⚠️ The suppression is decided BEFORE the <Marker>, never as a null child inside one.
          react-map-gl reads «has children?» once, in a useMemo([]) at mount, and a marker that
          mounts with nothing in it gets MapLibre's own default pin — the stock teal drop —
          which it then keeps for good, label or no label. That is exactly what the field saw:
          teal pins scattered over the Lage next to perfectly readable labels. Filtering here
          means a suppressed label has no marker at all, and gets a fresh one when it fits again. */}
      {nativeDrawingChrome && drawLabels.filter((l) => !suppressedLabels.has(`dl:${l.id}`)).map((l) => (
        <Marker key={`dl${l.id}`} longitude={l.coord[0]} latitude={l.coord[1]} anchor="bottom" offset={[0, -10]}>
          {/* draggable: dragging pins the label to a georeferenced anchor (stays put on zoom/rotate) */}
          <div role="button" tabIndex={0}
            className={`measure-label draw-label draggable${l.id === selectedDrawingId ? ' sel' : ''}`}
            style={{ cursor: onLabelMove ? 'move' : undefined }}
            onPointerDown={(e) => onLabelMove ? labelDown(e, l.id, l.coord) : e.stopPropagation()}
            onPointerMove={onLabelMove ? labelMove : undefined}
            onPointerUp={onLabelMove ? labelUp : undefined}
            onPointerCancel={onLabelMove ? labelUp : undefined}
            onClick={(e) => {
              const ld = lineDecor.find((d) => d.d.id === l.id)
              activateLineLabel(e, l.id, ld?.trupp?.id, ld?.tone)
            }}
            onKeyDown={(e) => {
              if (e.key !== 'Enter' && e.key !== ' ') return
              e.preventDefault()
              const ld = lineDecor.find((d) => d.d.id === l.id)
              activateLineLabel(e, l.id, ld?.trupp?.id, ld?.tone)
            }}
          >
            {l.lines.map((t, j) => <div key={j} className={t.words ? 'dl-words' : undefined}>{t.text}</div>)}
          </div>
        </Marker>
      ))}

      {/* committed Absperrkreis radius readout, pinned just above the circle's top edge */}
      {/* suppressed ⇒ no marker (see the dl labels above: an empty <Marker> becomes a default pin) */}
      {nativeDrawingChrome && circleLabels.filter((c) => !suppressedLabels.has(`cl:${c.id}`)).map((c) => (
        <Marker key={`cl${c.id}`} longitude={c.coord[0]} latitude={c.coord[1]} anchor="bottom" offset={[0, -4]}>
          <div className={`measure-label draw-label${c.id === selectedDrawingId ? ' sel' : ''}`}>{c.text}</div>
        </Marker>
      ))}

      {/* lock chip on every locked drawing — the click-through shape's only tap target;
          tapping it unlocks + selects the shape (Figma/Miro-style lock affordance). Its only
          job is unlocking, so it stays away when editing is locked anyway. */}
      {nativeDrawingChrome && !readOnly && onUnlockDrawing && lockChips.map((c) => (
        <Marker key={`lk${c.id}`} longitude={c.coord[0]} latitude={c.coord[1]} anchor="center">
          <LockChip onUnlock={() => onUnlockDrawing(c.id)} />
        </Marker>
      ))}

      {/* FKS hose-line decorations: Teilstück fork + content letter at the tip, Druckleitung/storey badge at the start */}
      {nativeDrawingChrome && lineDecor.map((ld) => (
        <Fragment key={`ld${ld.d.id}`}>
          {ld.d.teilstueck && (
            <Marker longitude={ld.end[0]} latitude={ld.end[1]} anchor="center">
              <TeilstueckFork angleDeg={ld.angleDeg} color={ld.color} width={ld.width} />
            </Marker>
          )}
          {/* ⚠️ zIndex ABOVE the line's other decorations. Every MapLibre marker is its own
              stacking context (it carries a transform), so a z-index inside the tag cannot
              lift it past a SIBLING marker — it has to sit on the marker container. Without
              it the decorations of a line that runs under its own tag paint straight through
              the text, and the tag is the one thing on a Leitung that has to stay readable.
              Both levels come from the one stacking table (lib/labelPass · MARKER_Z). */}
          {/* …and suppressed ⇒ no marker at all, never an empty one (see the dl labels above). */}
          {(ld.d.content || ld.d.lineNo != null || ld.d.floorTag != null) && !suppressedLabels.has(`tag:${ld.d.id}`) && (
            <Marker longitude={ld.tagAt[0]} latitude={ld.tagAt[1]} anchor="center" offset={[ld.tagOffset[0], ld.tagOffset[1]]}
              // …and ABOVE the resting tactical symbols (MARKER_Z.note…team, 4–8) once its own
              // line is selected. At rest the tag stays under the symbols, so an overlapping
              // Trupp still owns the tap. Selected means «I am working on this Leitung» — then
              // its handle has to be the thing on top, or it cannot be grabbed where it matters:
              // right at the incident point, which is exactly where lines and symbols pile up.
              // A SELECTED symbol still clears it (MARKER_Z.selected) — only one of the two can
              // be the current selection, and the tapped object is the one that must be visible.
              style={{ zIndex: ld.d.id === selectedDrawingId ? MARKER_Z.tagSelected : MARKER_Z.tag }}>
              {/* the offset stands the tag beside the line end; dragging pins it to a
                  georeferenced anchor (held 14 px under it). ⚠️ DRAG only while its line is
                  selected (f4ad5c3's measured decision stands: at rest a pan starting on the tag must stay a pan) —
                  but the TAP answers at rest, that is the whole point of the 29.08. rework. The
                  rest-press ref lets the release handler drop a pan that ended on the tag. */}
              {(() => { const tagSel = ld.d.id === selectedDrawingId; return (
              <div role="button" tabIndex={0} className={`line-end-tag-wrap draggable${tagSel ? ' sel' : ''}`}
                style={{ cursor: onLabelMove && tagSel ? 'move' : undefined }}
                onPointerDown={(e) => {
                  if (onLabelMove && tagSel) labelDown(e, ld.d.id, heldTagAnchor(ld), 'end')
                  else { e.stopPropagation(); tagTapped.current = false; tagRestPress.current = { x: e.clientX, y: e.clientY, pointerId: e.pointerId } }
                }}
                onPointerMove={onLabelMove && tagSel ? labelMove : undefined}
                // ⚠️ The rest tap is answered on pointerUP, not on the click. A tap that let the
                // map pan a couple of px under the finger often fires no click at all, and one
                // that wandered past the DRAG deadzone was thrown away — so a tag nobody's marker
                // covers (a Leitung whose Trupp is out) «did nothing» on a phone. Same reason
                // useHoldToDrag reports marker taps itself instead of trusting `click`.
                onPointerUp={onLabelMove && tagSel ? labelUp : (e) => {
                  const p = tagRestPress.current; tagRestPress.current = null
                  if (!p || p.pointerId !== e.pointerId) return
                  if (Math.hypot(e.clientX - p.x, e.clientY - p.y) >= TAG_TAP_TOL_PX) return
                  tagTapped.current = true
                  activateLineLabel(e, ld.d.id, ld.trupp?.id, ld.tone)
                }}
                onPointerCancel={onLabelMove && tagSel ? labelUp : () => { tagRestPress.current = null }}
                onClick={(e) => {
                  // …the trailing click of a tap the pointerup already answered
                  if (tagTapped.current) { tagTapped.current = false; e.stopPropagation(); return }
                  const p = tagRestPress.current; tagRestPress.current = null
                  if (p && Math.hypot(e.clientX - p.x, e.clientY - p.y) >= TAG_TAP_TOL_PX) return
                  activateLineLabel(e, ld.d.id, ld.trupp?.id, ld.tone)
                }}
                onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); activateLineLabel(e, ld.d.id, ld.trupp?.id, ld.tone) } }}>
                <EndTag
                  lineNo={ld.d.lineNo} content={ld.d.content} floorTag={ld.d.floorTag}
                  tone={ld.tone}
                  color={ld.color}
                />
              </div>
              ) })()}
            </Marker>
          )}
        </Fragment>
      ))}

      {/* inline line marker — a letter (—R— on a Rettungsachse) or an FKS chain glyph, tinted to
          the line colour. `deg` is measured in PROJECTED screen px and a Marker's child is not
          rotated with the map, so a turned map needs no correction: the teeth stay on the line. */}
      {nativeDrawingChrome && drawMarkers.map((m) => (
        <Marker key={`dm${m.id}`} longitude={m.coord[0]} latitude={m.coord[1]} anchor="center">
          <LineMarker marker={m.marker} color={m.color} deg={m.deg} />
        </Marker>
      ))}

      {/* «Anschluss frei» — an open coupling in the hose's own ink at every end nobody hangs on.
          Shown while a Trupp marker is in the hand (it is the answer to THAT gesture) and on the
          selected Leitung, so a free end says what it is instead of lying there silently. Never
          permanently: a Lage with a dozen hoses would grow a dozen rings.
          ⚠️ The aimed end is filtered out BEFORE the <Marker>, never rendered as a null child —
          react-map-gl reads «has children?» once at mount and an empty marker keeps MapLibre's
          stock teal pin for good (see the dl labels above). Its blue ring is drawn below. */}
      {nativeDrawingChrome && freeHoseEnds
        .filter((f) => (teamDragId || f.lineId === selectedDrawingId)
          && !(teamJoin && teamJoin.lineId === f.lineId && teamJoin.endpoint === f.endpoint))
        .map((f) => (
          <Marker key={`fe${f.lineId}:${f.endpoint}`} longitude={f.coord[0]} latitude={f.coord[1]}
            anchor="center" style={{ zIndex: MARKER_Z.tag }}>
            <span className="free-coupling" style={{ '--line': f.color } as CSSProperties} />
          </Marker>
        ))}
      {/* The gesture seen from the HOSE's side (15.09.): while a hose end is in the hand, every
          Trupp marker that could take it wears the same open ring on its DOT – the point the
          magnet actually measures against, which a 13px dot beside a name never made clear. The
          aimed one is left out here: the endpoint magnet draws its filling ring below. */}
      {nativeDrawingChrome && endpointDrag && !endpointDrag.carry && entities
        .filter((e) => e.kind === 'team' && !!e.truppId && Array.isArray(e.coord) && isVisible(effectiveLayer(e))
          && endpointDrag.candidate?.key !== `object:${e.id}`
          && (trupps ?? []).some((t) => t.id === e.truppId && !t.removedAt && t.status !== 'raus'))
        .map((e) => (
          <Marker key={`ts${e.id}`} longitude={e.coord[0]} latitude={e.coord[1]} anchor="center" style={{ zIndex: MARKER_Z.tag }}>
            <span className="free-coupling team-socket" style={{ '--line': e.color || 'var(--blue)' } as CSSProperties} />
          </Marker>
        ))}
      {/* …and the aimed one, filling: the same blue ring («Halten zum Verbinden») the endpoint
          magnet below wears, because it is the same gesture seen from the other side. */}
      {teamJoin && (
        <Marker key={`tj${teamJoin.since}`} longitude={teamJoin.coord[0]} latitude={teamJoin.coord[1]} anchor="center">
          <span className="magnet-anchor"><ConnectRing since={teamJoin.since} armed={teamJoin.armed} /></span>
        </Marker>
      )}
      {/* the symbol a dragged Trupp marker would dock to – the ring fills, a closed ring docks */}
      {dockAim && !teamJoin && (
        <Marker key={`dk${dockAim.since}`} longitude={dockAim.coord[0]} latitude={dockAim.coord[1]} anchor="center">
          <span className="magnet-anchor"><ConnectRing since={dockAim.since} armed={dockAim.armed} /></span>
        </Marker>
      )}

      {/* «Ring lädt, dann schnappt es» — the ONE picture of attachment on this surface (the plan
          draws the identical pair). The blue chip hangs BESIDE the target, never under the finger,
          and its ring is the remaining dwell; a full ring is the only thing that attaches
          (lib/lineAttachments · DwellState). The key carries `since`, so re-entering the same
          target restarts the CSS fill instead of silently continuing an old one.
          Cycle-forming targets are filtered out of the candidate list, so there is no blocked
          state to draw. The red twin below is the release ring.
          ⚠️ No ring for a LINE target (dwellFor = 0): it attaches the instant it is acquired,
          so there is no fill to picture — the endpoint simply lands on the prong. */}
      {endpointDrag?.candidate && dwellFor(endpointDrag.candidate) > 0 && mapInst.current && (() => {
        const ll = mapInst.current.unproject(endpointDrag.candidate.point)
        return (
          <Marker key={`${endpointDrag.candidate.key}:${endpointDrag.dwell.since}`} longitude={ll.lng} latitude={ll.lat} anchor="center">
            <span className="magnet-anchor"><ConnectRing since={endpointDrag.dwell.since} armed={endpointDrag.dwell.armed} /></span>
          </Marker>
        )
      })()}
      {/* release: same chip, red, at the socket the endpoint is leaving — its ring fills with the
          DISTANCE pulled out, and a full one is what actually unhooks it. The explicit
          «Verbindung lösen» chip on a selected endpoint stays; this is the in-drag twin. */}
      {endpointDrag?.attached && endpointDrag.detach > DETACH_SHOW_PROGRESS && (
        <Marker longitude={endpointDrag.origin[0]} latitude={endpointDrag.origin[1]} anchor="center">
          <span className="magnet-anchor"><NodeDeleteChip tone="release" progress={endpointDrag.detach} /></span>
        </Marker>
      )}
      {draftMagnetState?.candidate && dwellFor(draftMagnetState.candidate) > 0 && mapInst.current && (() => {
        const ll = mapInst.current.unproject(draftMagnetState.candidate.point)
        return (
          <Marker key={`${draftMagnetState.candidate.key}:${draftMagnetState.dwell.since}`} longitude={ll.lng} latitude={ll.lat} anchor="center">
            <span className="magnet-anchor"><ConnectRing since={draftMagnetState.dwell.since} armed={draftMagnetState.dwell.armed} /></span>
          </Marker>
        )
      })()}
      {/* «Angekuppelt» while placing (11.10.2026): the closed twin of «Anschluss frei» on the joint a
          new stroke's start is coupled onto, for the whole stroke, and on a line end an end being
          laid or dragged has just snapped to. A line target arms the moment it is acquired and so
          has no ConnectRing (dwellFor = 0) — this is the picture that says «joined» instead. */}
      {joinPreview.map((j) => (
        <Marker key={`jp${j.key}`} longitude={j.coord[0]} latitude={j.coord[1]} anchor="center" style={{ zIndex: MARKER_Z.tag }}>
          <span className="magnet-anchor"><span className="join-coupling" style={{ '--line': j.color } as CSSProperties} /></span>
        </Marker>
      ))}
      {hiddenAttachmentTargets.map((e) => <Marker key={`hidden-${e.id}`} longitude={e.coord[0]} latitude={e.coord[1]} anchor="center"><span className="hidden-attachment-marker" /></Marker>)}

      {/* ⚠️ On the object itself only GEOMETRY grips remain (01.09.): the node pads, the «+»
          midpoints, Verlängern, «Verbindung lösen» and the Absperrkreis's radius ring. Moving,
          turning and deleting the selection all moved off the ink and onto the one fixed bar at
          the bottom of the surface (SelectionBar, rendered below) — the floating hub they used to
          form grew exactly where the finger was already reaching. */}
      {/* «+» in each gap between two node pads of the SELECTED drawing — the same affordance the
          Messung has always had, and the Plan too. On the map inserting a node used to mean hitting
          the line's invisible 18px hit-band with no sign that this was possible at all (19.08.).
          On a thinned stroke the grip sits half-way ALONG the ink rather than across the chord, so
          it is offered on every line and not only on one whose every vertex still has a pad — see
          `editInserts`. Rendered BEFORE the vertices so a node handle wins wherever the two
          overlap. */}
      {editDraw && onDrawingVertexInsert && editInserts.map(({ index, coord }) => (
        <Marker key={`di${index}`} longitude={coord[0]} latitude={coord[1]} anchor="center" style={handleZ}>
          <NewNodeHandle title={appConfig.copy.measure.insertPoint}
            onInsert={(ev) => {
              onDrawingVertexInsert(editDraw.id, index, coord)
              // the geometry is snapshotted WITH the new node (same reason the body-move grip
              // snapshots: 'move' streams into the doc, so reading it back races the shape away)
              if (!ev || !onDrawingEdit) return
              const grown = [...editDraw.coords.slice(0, index), coord, ...editDraw.coords.slice(index)]
              handOffNodeDrag(ev, (ll, phase) => onDrawingEdit(editDraw.id,
                ll ? grown.map((q, j) => (j === index ? ll : q)) : grown, phase))
            }} />
        </Marker>
      ))}

      {/* the node pads. On a dense stroke this is a SUBSET of the vertices (vertexHandleIndices) —
          `i` stays the real index into `coords`, so a drag/delete still hits the point it points at. */}
      {editDraw && onDrawingEdit && editHandleIdx.map((i) => {
        const p = editDraw.coords[i]
        // a Wand's ends dock onto nothing – they are plain corners (the Plan's useWbVertexEdit · vertDown)
        const docks = editDraw.kind === 'line' && !editDraw.role
        const endpoint: LineEndpoint | null = docks && i === 0 ? 'start' : docks && i === editDraw.coords.length - 1 ? 'end' : null
        return (
        <Marker
          key={`dv${i}`}
          longitude={p[0]}
          latitude={p[1]}
          anchor="center"
          style={handleZ}
          draggable
          onDragStart={() => { beginSheetPeek(); endpoint && onDrawingAttachment ? beginEndpointDrag(editDraw.id, endpoint, p) : onDrawingEdit(editDraw.id, editDraw.coords, 'start') }}
          onDrag={(e) => { vertexPress.cancel(); endpoint && onDrawingAttachment ? moveEndpointDrag([e.lngLat.lng, e.lngLat.lat]) : onDrawingEdit(editDraw.id, editDraw.coords.map((q, j) => (j === i ? [e.lngLat.lng, e.lngLat.lat] : q)), 'move') }}
          onDragEnd={(e) => {
            endSheetPeek()
            if (endpoint && onDrawingAttachment) { moveEndpointDrag([e.lngLat.lng, e.lngLat.lat]); finishEndpointDrag() }
            else onDrawingEdit(editDraw.id, editDraw.coords.map((q, j) => (j === i ? [e.lngLat.lng, e.lngLat.lat] : q)), 'end')
          }}
        >
          <div
            className={`draw-handle ${editRingIdx.includes(i) ? 'draw-handle--ring' : ''} ${vertexPress.armed?.key === `draw:${i}` ? 'doomed' : ''}`}
            title={appConfig.copy.measure.deleteNode}
            {...vertexPress.press(`draw:${i}`, () => deleteVertexKeepSelection(editDraw.id, i), editDraw.coords.length > (editArea ? 3 : 2))}
            onContextMenu={(ev) => { ev.stopPropagation(); ev.preventDefault(); deleteVertexKeepSelection(editDraw.id, i) }}
          >{vertexPress.armed?.key === `draw:${i}` && <NodeDeleteChip progress={vertexPress.armed.progress} />}</div>
        </Marker>
        )
      })}
      {/* ── Verlängern ─────────────────────────────────────────────────────────────────────────
          The arrow tip sitting `EXTEND_STEP_PX` PAST each open end of a selected line, pointing the
          way the line runs. Until now the only way to lengthen a line was to draw a second one and
          magnet it on, which produces a second Leitung with its own number and its own Trupp link
          (19.08.).
          ⚠️ A TAP is the whole gesture (26.08. field test). The grip used to be drag-only, so
          tapping the arrow — which is what an arrow tip invites — did nothing at all and the line
          just sat there. Now pointerdown appends one node AT the arrow, one fixed step further out,
          and hands the same press over to that node's drag: let go without moving and the line grew
          by one step; keep moving and it follows the finger. Exactly what the «+» does one segment
          back, and exactly what the Plan's grip already did (Whiteboard · extendLine) — the two
          surfaces now grow a line the same way.
          ⚠️ Offset OUTWARD, never on the endpoint itself: the endpoint already carries the node
          handle and, when attached, the detach chip. A grip on top of those would be a third
          thing competing for the same pixel.
          Lines only — an area has no end to grow from, and a circle is centre + radius. */}
      {editDraw && editDraw.kind === 'line' && editNodes && onDrawingEdit && onDrawingVertexInsert && editDraw.coords.length >= 2
        && (['start', 'end'] as const).map((ep) => {
        const coords = editDraw.coords
        const i = ep === 'start' ? 0 : coords.length - 1
        const pt = coords[i], neighbor = ep === 'start' ? coords[1] : coords[coords.length - 2]
        const map = mapInst.current
        let at: LngLat = pt
        let deg = 0
        if (map) {
          const p = map.project(pt), q = map.project(neighbor)
          const dx = p.x - q.x, dy = p.y - q.y, len = Math.hypot(dx, dy) || 1
          const ll = map.unproject([p.x + (dx / len) * EXTEND_STEP_PX, p.y + (dy / len) * EXTEND_STEP_PX])
          at = [ll.lng, ll.lat]
          deg = (Math.atan2(dy, dx) * 180) / Math.PI
        }
        // where the new node lands in `coords`, and the geometry it lands in — SNAPSHOTTED here,
        // never read back from the live drawing while the drag streams ('move' writes into the doc
        // each frame, so reading it back appends one point per pointermove: a single drag across
        // the screen turned an 8-point hose into a 21-point one, 19.08.).
        const idx = ep === 'start' ? 0 : coords.length
        const grown = ep === 'start' ? [at, ...coords] : [...coords, at]
        // Growing IS an endpoint drag — the appended node becomes the line's new start/end — so
        // the gesture goes to the magnet path, not to a plain reshape. Without this «Verlängern»
        // was the one way of moving an endpoint that could never dock (field report 01.09.; the
        // Plan's grip had the identical hole, Whiteboard · extendLine).
        // An endpoint that is ALREADY attached keeps the plain reshape: unplugging it is the node
        // grip's and the × chip's job, and a grow grip that could also detach would promise two
        // things at once.
        const magnetic = !!onDrawingAttachment && !(ep === 'start' ? selectedDrawing?.startAttachment : selectedDrawing?.endAttachment)
        return (
          <Marker key={`grow-${ep}`} longitude={at[0]} latitude={at[1]} anchor="center" style={handleZ}>
            <NewNodeHandle
              className="draw-grow" icon="arrow"
              title={appConfig.copy.measure.extendLine}
              style={{ ['--grow-deg' as string]: `${deg}deg` } as React.CSSProperties}
              onInsert={(ev) => {
                onDrawingVertexInsert(editDraw.id, idx, at)
                if (!ev) return
                if (magnetic) {
                  // begin/move/finishEndpointDrag own the geometry from here: 'move' only streams
                  // the live coord into `endpointDrag` (the resolver draws from it), and the
                  // release writes coord + attachment in one commit.
                  handOffNodeDrag(ev, (ll, phase) => {
                    if (phase === 'start') beginEndpointDrag(editDraw.id, ep, at)
                    else if (ll) { moveEndpointDrag(ll); if (phase === 'end') finishEndpointDrag() }
                  })
                  return
                }
                handOffNodeDrag(ev, (ll, phase) => onDrawingEdit(editDraw.id,
                  ll ? grown.map((q, j) => (j === idx ? ll : q)) : grown, phase))
              }} />
          </Marker>
        )
      })}

      {/* explicit detach: a × chip beside a connected endpoint of the selected line. Dragging the node
          only moves/re-targets (never severs), so this is how a connection is broken on-canvas. */}
      {editDraw && editDraw.kind === 'line' && onDrawingAttachment && !endpointDrag && (['start', 'end'] as const).map((ep) => {
        const a = ep === 'start' ? selectedDrawing?.startAttachment : selectedDrawing?.endAttachment
        if (!a || editDraw.coords.length < 2) return null
        const pt = ep === 'start' ? editDraw.coords[0] : editDraw.coords[editDraw.coords.length - 1]
        const neighbor = ep === 'start' ? editDraw.coords[1] : editDraw.coords[editDraw.coords.length - 2]
        // On detach, retract the endpoint ~26px toward its own body so it visibly pops off the target.
        const detachAt = (): LngLat => {
          const map = mapInst.current; if (!map) return pt
          const p = map.project(pt), q = map.project(neighbor)
          const dx = q.x - p.x, dy = q.y - p.y, len = Math.hypot(dx, dy) || 1
          const ll = map.unproject([p.x + (dx / len) * 26, p.y + (dy / len) * 26])
          return [ll.lng, ll.lat]
        }
        return (
          <Marker key={`detach-${ep}`} longitude={pt[0]} latitude={pt[1]} anchor="center" offset={[18, -18]} style={handleZ}>
            <span className="line-detach-chip" role="button" title={appConfig.copy.drawingEditor.detachConnection} aria-label={appConfig.copy.drawingEditor.detachConnection}
              onPointerDown={(ev) => ev.stopPropagation()}
              onClick={(ev) => { ev.stopPropagation(); onDrawingAttachment(editDraw.id, ep, undefined, detachAt()) }}><Icon id="close" /></span>
          </Marker>
        )
      })}

      {/* The Absperrkreis's ONE geometry grip: a node dot on the ring at screen-right, dragged
          outward or in to set the radius — the gesture that placed it, offered again afterwards,
          and the same grip the Plan carries (WbControls · WbCircleHandle). Until 01.09. the Karte
          had only the editor's metre stepper for this, so the two surfaces answered «wie gross?»
          in two different ways for the same object. Metres stay editable there for a radius that
          has to be exact. */}
      {editDraw && editCircle && onDrawingRadius && (() => {
        const m = mapInst.current
        const c = editDraw.coords[0]
        // ring[0] is the circle's due-EAST point (lib/geo · circlePolygon starts at angle 0), so
        // the grip sits ON the ring and turns with the map rather than with the screen
        const edge = c && (circleRing(editDraw)[0] as LngLat | undefined)
        if (!m || !c || !edge) return null
        const radiusAt = (e: React.PointerEvent): number => {
          const r = m.getContainer().getBoundingClientRect()
          const at = m.unproject([e.clientX - r.left, e.clientY - r.top])
          return Math.max(appConfig.drawing.circleMinRadiusM, Math.round(haversineM(c, [at.lng, at.lat])))
        }
        return (
          <Marker longitude={edge[0]} latitude={edge[1]} anchor="center" style={handleZ}>
            <div className="draw-handle" title={appConfig.copy.drawingEditor.radius} aria-label={appConfig.copy.drawingEditor.radius}
              onPointerDown={(ev) => {
                ev.stopPropagation(); ev.preventDefault()
                ;(ev.currentTarget as HTMLElement).setPointerCapture(ev.pointerId)
                // ⚠️ MapLibre arms DragPan on the separate NATIVE mousedown/touchstart, which no
                // React stopPropagation can reach — without this the map pans under the grip
                // (the same disable/enable pair the line-label drag needs, see labelDown).
                setDragPanEnabled(false)
                onDrawingRadius(editDraw.id, editDraw.radiusM ?? 0, 'start')
              }}
              onPointerMove={(ev) => { if ((ev.currentTarget as HTMLElement).hasPointerCapture(ev.pointerId)) onDrawingRadius(editDraw.id, radiusAt(ev), 'move') }}
              onPointerUp={(ev) => { setDragPanEnabled(true); if ((ev.currentTarget as HTMLElement).hasPointerCapture(ev.pointerId)) onDrawingRadius(editDraw.id, radiusAt(ev), 'end') }}
              onPointerCancel={() => { setDragPanEnabled(true); onDrawingRadius(editDraw.id, editDraw.radiusM ?? 0, 'end') }}
            />
          </Marker>
        )
      })()}

      {/* ONE bar for every selection this surface has — see components/SelectionBar */}
      {barShown && (
        <SelectionBar onMove={barMove} onRotate={barCanRotate ? barRotate : undefined} onDone={barDone}
          onGrab={(grabbing) => setDragPanEnabled(!grabbing)}
          armed={arm.armed} onArm={arm.toggle} />
      )}
      {/* …and the turn is read where it happens: pivot, radius and degrees on the surface. The
          armed drag supplies a fingertip to draw the radius to; the bar's own dial does not. */}
      {(arm.turn ?? barTurn) && (arm.turn
        ? <SelectionTurn cx={arm.turn.cx} cy={arm.turn.cy} px={arm.turn.px} py={arm.turn.py} deg={arm.turn.deg} />
        : <SelectionTurn cx={barTurn!.cx} cy={barTurn!.cy} deg={barTurn!.deg} />)}


      {/* entity markers — guard against malformed entities (e.g. a server workspace
          missing a coord) so one bad row can't white-screen the whole map */}
      <MapMarkers
        // ⚠️ NOTHING of the Lage is drawn while «Karte verknüpfen» is armed — see the plan half
        // (09-whiteboard.css · .wb-georef-armed) for the reason, which is the same on both
        // surfaces: the landmark you are aiming at is exactly where the symbols sit. The
        // entities themselves are untouched; they are back the moment the mode ends.
        entities={georefOn ? [] : entities}
        byName={byName}
        isVisible={isVisible}
        selectedId={selectedId}
        groupSelectedIds={groupEnts.length ? selectedEntityIds : []}
        networkEntityIds={[...relationship.objectIds]}
        zoom={zoom}
        bearing={bearing}
        symMul={symMul}
        captionMode={captionMode}
        suppressedLabels={suppressedLabels}
        readOnly={readOnly}
        draggable={draggable}
        project={projectLngLat}
        unproject={unprojectPoint}
        setDragPan={setDragPanEnabled}
        onSelect={onSelect}
        onMarkerDragStart={onMarkerDragStart}
        onMarkerMove={teamJoinMarkerMove}
        onMarkerDragEnd={teamJoinMarkerDragEnd}
        onDelete={onDelete}
        onRotate={onRotate}
        onShapeTransform={onShapeTransform}
        onUnlockShape={readOnly ? undefined : onUnlockShape}
        editNoteId={editNoteId}
        onNoteText={onNoteText}
        onNoteCommit={onNoteCommit}
        onNoteEdit={onNoteEdit}
        onNotePanel={onNotePanel}
        trupps={trupps}
        onShowTrupp={onShowTrupp}
        onTeamTrupp={onTeamTrupp}
        onTeamNewTrupp={onTeamNewTrupp}
        onTeamMark={onTeamMark}
        onTeamRename={onTeamRename}
        onTeamClearTrail={onTeamClearTrail}
        onTeamRemoveWithTrail={onTeamRemoveWithTrail}
        ghostTrails={ghostTrails}
        onGhostTrail={onGhostTrail}
        teamLines={teamLines}
        onTeamUnlink={onTeamUnlink}
        onTeamUndock={onTeamUndock}
        hiddenTrails={hiddenTrails}
        onToggleTrail={toggleTrail}
      />

      {/* The weather radar (lazy). LAST in the tree on purpose: its layer names `beforeId` (the
          first drawings layer, WeatherLayer · WEATHER_RADAR_BEFORE), which has to exist when it
          is added – so it lies under every line and symbol and above the basemap however late
          its chunk and its frame arrive. */}
      {weatherRadar && mapReady && !georefOn && (
        <Suspense fallback={null}>
          <WeatherRadarSource radar={weatherRadar.radar} frameIndex={weatherRadar.frameIndex}
            opacity={weatherRadar.opacity} stale={weatherRadar.stale} />
        </Suspense>
      )}
      {children}
    </Map>
    {/* the tool's number, fixed at the top edge while a measure vertex is being dragged — the
        per-vertex label sits under the very fingertip that changes it (the .node-del chip is
        offset for the same reason), so during the drag the total/area is read where nothing
        moves: the georef corner-loupe answer. Display-only; gone the moment the finger lifts. */}
    {measureDragNode != null && measureLabels.length > 0 && (
      <div className="measure-readout" aria-hidden>{measureLabels[measureLabels.length - 1].text}</div>
    )}
    {/* the pairing mode's magnifier — base-map tiles, no second GL context (GeorefMapLayer).
        ⚠️ On a phone TOO, since it moved into the corner: what made the old centred one wrong
        there was that it sat under the finger, and an inset does not. Without it the map half
        of a pair is placed blind, which is the half where blind hurts most — a house corner on
        a basemap at phone zoom is a few pixels of grey. */}
    {!georef.check && georefTurn && georef.want === 'map' && (
      <GeorefMapLoupe map={mapInst.current} layers={layers} isVisible={isVisible} night={night}
        atRef={georefPoint} />
    )}
    {/* WebGL context lost and auto-healing has already been tried: without this the map is just
        a blank rectangle surrounded by working chrome, with no hint and no action — a full app
        restart was the only cure. Deliberately NOT a toast: it must stay until acted on. */}
    {gl.lost && (
      <div className="map-gl-lost" role="alert">
        <div className="map-gl-lost-title">{appConfig.copy.map.glLost}</div>
        <p className="map-gl-lost-hint">{appConfig.copy.map.glLostHint}</p>
        <button type="button" className="ip-btn primary" onClick={gl.recover}>
          {appConfig.copy.map.glLostAction}
        </button>
      </div>
    )}
    {/* the live wind/temperature readout moved into the TopBar (next to "Eintrag"); the
        floating corner badge is retired so it no longer collides with the right tool rail. */}
    {marquee && (
      <div
        className="marquee-box"
        style={{
          position: 'fixed',
          left: Math.min(marquee.x0, marquee.x1),
          top: Math.min(marquee.y0, marquee.y1),
          width: Math.abs(marquee.x1 - marquee.x0),
          height: Math.abs(marquee.y1 - marquee.y0),
        }}
      />
    )}
   </>
  )
})
