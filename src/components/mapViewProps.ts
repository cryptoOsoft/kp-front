import type { ReactNode } from 'react'
import type { CaptionMode, Drawing, Entity, LayerDef, LayerId, LineAttachment, LineEndpoint, LngLat, PreparedMapOverlay, Trupp } from '../types'
import type { TruppTrail } from '../lib/truppTrails'
import type { WeatherRadar } from '../lib/weatherLayer'

// MapView's props, split by who renders it. The map itself — camera, layers, Messen, the viewer
// chrome — is `MapViewBaseProps`, and both surfaces pass it: the Einsatz (workspace/MapStage)
// and «Karte & Objekte» (components/karte/KarteApp). The Einsatz's Lage — its document, its
// tools, its Trupps — is `MapTacticalProps`, all or nothing: the Karte passes none of it and
// MapView runs it as `VIEWER_TACTICAL`, a read-only map with no drawings.

/** The map itself — what every MapView needs. */
export interface MapViewBaseProps {
  entities: Entity[]
  layers: LayerDef[]
  byName: Record<string, string>
  /** per-device map symbol-size multiplier (lib/prefs · symbolScales, Einstellungen slider) — scales the symPx band */
  symMul?: number
  /** device default for on-canvas symbol captions (lib/prefs · symbolCaptions) */
  captionMode?: CaptionMode
  initialCenter: LngLat
  initialZoom?: number
  initialBearing?: number
  /** print/static render: fit these points once after load, no geolocation marker */
  fitPoints?: LngLat[]
  staticView?: boolean
  /** bump to take a single GPS fix and fly to it (the "Mein Standort" dot). On demand — no
   *  continuous watch — so the GPS chip isn't powered all shift. 0 = never located yet. */
  locateNonce?: number
  preparedOverlays: PreparedMapOverlay[]
  isVisible: (id: LayerId) => boolean
  onSelect: (e: Entity) => void
  onMapClick: (c: LngLat) => void
  /** tactical editing is locked (viewer role, Führungsansicht, replay). Everything
   *  stays readable — panning, selecting, the ephemeral Messen path — but no affordance that
   *  would mutate the document is rendered: no vertex/move handles on a selected drawing, no
   *  lock chip, no note edit/delete grips. The app-level callbacks are no-ops in this state,
   *  so a handle here would be a control that responds and changes nothing. */
  readOnly?: boolean
  /** a placement tool is active (symbol/shape/note/area/measure) — map clicks should
   *  place/add a point rather than select a drawing under the cursor (e.g. an area fill) */
  placing?: boolean
  /** the armed tool places something on a tap — one-finger zoom is off then (lib/tapDragZoom ·
   *  oneFingerZoom). Defaults to `placing`; the Karte narrows it, since there `placing` also
   *  covers its sheets (Ebenen), under which one finger must still zoom. */
  tapsPlace?: boolean
  onView: (v: { bearing: number; center: LngLat; zoom: number }) => void
  /** a base-layer tile failed while offline — there is no cached basemap for this view. Fires
   *  per failed tile; the caller decides how often to say so (IncidentWorkspace · NoBasemapMeldung). */
  onBasemapUnavailable?: () => void
  /** ONCE per MapView: the incident is framed and the first view has drawn everything it asked
   *  for (tiles and sources loaded or failed). The opening cover lifts on it (lib/bootCover). */
  onSettled?: () => void
  /** measurement readouts pinned to the live measure path */
  measureLabels?: { coord: LngLat; text: string; strong?: boolean }[]
  /** draggable measurement vertices + the path kind they form (line / area) */
  measurePoints?: LngLat[]
  measureKind?: 'line' | 'area' | null
  onMeasureDrag?: (index: number, coord: LngLat) => void
  /** click on a path segment → insert a vertex at `index` (between its endpoints) */
  onMeasureInsert?: (index: number, coord: LngLat) => void
  /** double-click a vertex → delete it */
  onMeasureDelete?: (index: number) => void
  /** Opt-in literal plan sheets from Ebenen, already rasterized and projected by their fit. */
  georefPlanRasters?: {
    id: string
    url: string
    opacity: number
    coordinates: [[number, number], [number, number], [number, number], [number, number]]
  }[]
  /** The «Niederschlag (Radar)» layer (components/WeatherLayer), while it is on: the frame on
   *  screen, its transparency (0–100) and whether it is stale (drawn desaturated). */
  weatherRadar?: { radar: WeatherRadar; frameIndex: number; opacity: number; stale: boolean } | null
  /** extra map content drawn last, inside the map (react-map-gl Markers): «Karte & Objekte» puts its
   *  object name tags here (components/karte). The Einsatz passes nothing. */
  children?: ReactNode
  /** stop at the visible base map's last sharp zoom («Karte & Objekte», owner on #383) instead
   *  of the map's own 21 (the Einsatz: precise placement) — lib/mapView · mapMaxZoom */
  zoomCapAtBase?: boolean
  /** the quiet Einsatzort ring at `initialCenter` — off where the centre is no incident's place
   *  («Karte & Objekte»: just where the station view opens) */
  showOrigin?: boolean
}

/** The Einsatz's Lage on the map: placed objects and Trupps, drawings and drafts, selection and
 *  the edit tools. Only workspace/MapStage passes it. */
export interface MapTacticalProps {
  /** The Lage label pass is the source of truth for which map captions are actually visible.
   *  Share its suppressed entity ids with plan twins so a hidden «Feuer» does not reappear only
   *  because it is projected onto a Modul. */
  onCaptionSuppressionChange?: (ids: ReadonlySet<string>) => void
  selectedId: string | null
  /** map note inline editing (raw text on the marker, like the Plan whiteboard) */
  editNoteId?: string | null
  onNoteText?: (id: string, text: string) => void
  onNoteCommit?: (id: string, text: string) => void
  onNoteEdit?: (id: string) => void
  /** open a note's detail panel (the ⚙ handle) — see MapMarkers */
  onNotePanel?: (id: string) => void
  /** team markers (Trupp tracking on the map) — see MapMarkers */
  trupps?: Trupp[]
  /** per-Trupp contact-clock tier (see atemschutz · AtemschutzAlarmState.severities) — tints the
   *  end tag + halo of the Leitung that Trupp works on. Passed IN because the 1 Hz clock lives in
   *  the alarm host: the map must not re-render every second (measured battery drain). */
  truppSeverities?: Record<string, 1 | 2>
  onShowTrupp?: (truppId: string) => void
  /** join a team marker to an Atemschutz-Trupp (undefined = let go) — see MapMarkers */
  onTeamTrupp?: (entityId: string, truppId: string | undefined) => void
  onTeamNewTrupp?: (entityId: string) => void
  onTeamMark?: (id: string) => void
  /** rename an untracked team marker (absent = locked, or a Trupp-bound marker) */
  onTeamRename?: (id: string, name: string) => void
  /** see MapMarkers — the marker on the Karte is the only place a colour is still chosen */
  /** recolour a team marker (null = automatic) — see MapMarkers */
  onTeamClearTrail?: (id: string) => void
  /** «Marker und Spur löschen» on the marker's trash menu — see MapMarkers */
  onTeamRemoveWithTrail?: (id: string) => void
  /** the incident's ghost «Spuren» (lib/truppTrails) — the searched area a removed Trupp marker
   *  left behind. Drawn grey and read-only; `onGhostTrail` is the «Spur löschen» door. */
  ghostTrails?: TruppTrail[]
  onGhostTrail?: (id: string) => void
  /** «Lösen» on a joined Trupp marker — see MapMarkers (absent = locked / read-only) */
  onTeamUnlink?: (entityId: string, lineId: string) => void
  onTeamUndock?: (entityId: string) => void
  drawings: Drawing[]
  drawingsVisible: boolean
  draft: LngLat[]
  draftKind: 'line' | 'area' | null
  /** live editing of the in-progress draft (area/line tool), identical to the measure
   *  path: drag a vertex, click a segment to insert, right-click a vertex to delete */
  onDraftDrag?: (index: number, coord: LngLat) => void
  onDraftInsert?: (index: number, coord: LngLat) => void
  onDraftDelete?: (index: number) => void
  onDraftPointAttachment?: (attachment?: LineAttachment) => void
  /** what the node draft's first tap banked (useMapDrawing) — later taps are judged by its Trupp claim */
  draftStartAttachment?: LineAttachment
  draggable: boolean
  onMarkerDragStart: (id: string) => void
  onMarkerMove: (id: string, c: LngLat) => void
  /** `join` is the Trupp-marker half of the hose magnet (15.09.): the free Leitung end this drop
   *  is joining, and it is passed ONLY when its blue ring actually closed. Null on every other
   *  drop, so «not armed = nothing attaches» holds for this gesture too — the surface that drew
   *  the ring is the one that says whether it filled, and the writer never re-guesses. */
  /** `dock`: a Trupp marker's answer to «dock to a symbol?» – the host whose ring closed, null
   *  when no ring closed, undefined when the surface has no opinion (a placard docks instantly) */
  onMarkerDragEnd: (id: string, c: LngLat, join?: { lineId: string; endpoint: LineEndpoint } | null, dock?: { hostId: string } | null) => void
  /** rotate a (live vehicle) marker by dragging its on-icon handle */
  onRotate?: (id: string, deg: number) => void
  /** drag-to-transform a placed shape: rotate (top handle) / resize (corner handle).
   *  phase lets the app snapshot once for undo and persist on release. */
  onShapeTransform?: (id: string, patch: { rotation?: number; rotation2?: number; sizeM?: number; reachM?: number }, phase: 'start' | 'move' | 'end') => void
  /** coordinate picker: while aiming the map shows a crosshair, the cursor lng/lat
   *  streams to onCursor, and the next map click locks the point via onPick. */
  picking?: boolean
  onCursor?: (c: LngLat | null) => void
  onPick?: (c: LngLat) => void
  pickedPoint?: LngLat | null
  /** a two-point shape (Rotation) is armed: each of its two taps may claim a symbol, and it does
   *  so by dwelling — press, hold until the ring closes, let go (lib/shapes · SHAPE_TWO_POINT) */
  placeMagnet?: boolean
  /** the first of those two points, once it is down — drawn as an anchor so the operator can see
   *  where the run starts while looking for its other end */
  placeAnchor?: LngLat | null
  /** WHICH shape the canvas drag lays down right now, or null while it pans (useMapDrawing ·
   *  freehandKind). The kind decides whether the endpoint magnet is raised at all — see the
   *  onFreehandPointer binding below. */
  freehand: 'line' | 'area' | null
  onFreehand: (coords: LngLat[], attachments?: { startAttachment?: LineAttachment; endAttachment?: LineAttachment }) => void
  drawColor: string
  drawWidth: number
  drawDashed: boolean
  selectedDrawingId: string | null
  /** «schau hier»: one drawing outlined for a few seconds WITHOUT being selected — no vertex
   *  handles, no editor sheet. What «Leitung zeigen» on an Atemschutz card does: it answers where
   *  the hose is, and nothing on screen becomes draggable by answering it. Cleared by the caller. */
  flashDrawingId?: string | null
  /** `at` = where on the map container the tap landed, so the panel nudge can anchor on the spot
   *  that was aimed at instead of on a screen-spanning line's far edge (lib/panelNudge). */
  onSelectDrawing: (id: string, at?: { x: number; y: number }) => void
  /** unlock a locked drawing (tap its centre lock chip) → unlocks + selects it */
  onUnlockDrawing?: (id: string) => void
  /** …and the same door on a locked SHAPE entity (its chip lives in MapMarkers) */
  onUnlockShape?: (id: string) => void
  onDelete: (id: string) => void
  /** the currently selected drawing — gets on-canvas move/reshape/delete handles */
  selectedDrawing?: Drawing | null
  /** stream new coords for the selected drawing (body move / vertex drag); the phase
   *  folds the whole gesture into one undo step (mirrors onShapeTransform) */
  onDrawingEdit?: (id: string, coords: LngLat[], phase: 'start' | 'move' | 'end') => void
  onDrawingVertexInsert?: (id: string, index: number, coord: LngLat) => void
  onDrawingVertexDelete?: (id: string, index: number) => void
  /** an Absperrkreis's radius in metres, dragged on its ring grip — phased like onDrawingEdit */
  onDrawingRadius?: (id: string, radiusM: number, phase: 'start' | 'move' | 'end') => void
  /** a pump a Leitung draws («Pumpen auf Karte», lib/linePumps) dragged along it and released:
   *  the line's new hose/relay pair (the pin), as one edit of THAT line — it need not be selected.
   *  Absent (read-only) the drawn pumps only select their Leitung. */
  onLinePumpPin?: (id: string, patch: Pick<Drawing, 'hose' | 'relay'>) => void
  /** Commit one armed endpoint attach/retarget/detach gesture. */
  onDrawingAttachment?: (id: string, endpoint: LineEndpoint, attachment: LineAttachment | undefined, fallback: LngLat) => void
  /** drag a line's distance/text label to a GEOREFERENCED anchor (WGS84 [lng,lat]), so it
   *  stays pinned to the ground at every zoom + bearing (the old screen-px offset drifted).
   *  `at` is null on 'start' (just the undo snapshot). Folds the drag into one undo step. */
  onLabelMove?: (id: string, at: LngLat | null, phase: 'start' | 'move' | 'end', which?: 'label' | 'end') => void
  /** marquee multi-select (Select tool): one finger boxes, two fingers pan, Shift+drag on desktop */
  marqueeEnabled?: boolean
  selectedDrawIds?: string[]
  /** the boxed drawings + entities from a lasso gesture */
  onMarquee?: (drawIds: string[], entityIds: string[]) => void
  /** Absperrkreis (circle) tool active — drag centre→edge to set the radius */
  circleEnabled?: boolean
  /** commit a finished circle (centre + radius in metres) */
  onCircle?: (center: LngLat, radiusM: number) => void
  /** entity ids currently in the multi-selection — highlighted like the boxed drawings */
  selectedEntityIds?: string[]
  /** Move AND/OR turn a marquee group in one writer: the bar streams a lng/lat delta, a turn in
   *  degrees about the group's centre, or (in principle) both, folded into one undo step. */
  onGroupTransform?: (ids: string[], entIds: string[], t: { dLng: number; dLat: number; deg: number }, phase: 'start' | 'move' | 'end') => void
  /** «Fertig» on the selection bar: end the editing state — clear every selection and close the
   *  sheets that were open for it. Exactly what a tap on the empty map already does. */
  onSelectionDone?: () => void
}

/** The tactical props the Lage cannot do without — the ones a viewer gets from `VIEWER_TACTICAL`. */
type RequiredTactical = { [K in keyof MapTacticalProps as undefined extends MapTacticalProps[K] ? never : K]: MapTacticalProps[K] }

const NOOP = () => {}
/** The Lage of a map that has none («Karte & Objekte»): nothing drawn, nothing selected,
 *  nothing draggable. Module constants, so the memoized sources keep one identity. */
export const VIEWER_TACTICAL: RequiredTactical = {
  selectedId: null,
  drawings: [],
  drawingsVisible: false,
  draft: [],
  draftKind: null,
  draggable: false,
  onMarkerDragStart: NOOP,
  onMarkerMove: NOOP,
  onMarkerDragEnd: NOOP,
  freehand: null,
  onFreehand: NOOP,
  drawColor: '#000000',
  drawWidth: 3,
  drawDashed: false,
  selectedDrawingId: null,
  onSelectDrawing: NOOP,
  onDelete: NOOP,
}

/** Every tactical prop, or none of them. */
export type MapViewProps = MapViewBaseProps & (MapTacticalProps | { [K in keyof MapTacticalProps]?: never })
