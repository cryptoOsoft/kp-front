// The Plan – one plan sheet, a Gebäude floor stack or the Tafel (Skizze + template pages) as the
// background, and the Lage's tools on top of it: ink, symbols, Trupps, shapes, notes, measuring
// and georeferencing. Every annotation is stored normalized 0..1 in plan-image space, so it
// sticks across zoom, pan and re-tiling.
// Lage ↔ Plan parity is a review criterion: a tool or gesture changed here is changed in MapView
// too (docs/tactical-objects.md). Gebäude and alignments: docs/plans-and-buildings.md; the Tafel
// pages: docs/board-templates.md.
// This file wires the board; its parts live beside it: the document and view (useBoardDoc,
// useBoardView, useBoardGestures), drawing (usePlanDraft, usePlanCreate, usePlanMeasure), select
// and drag (useWbChipDrag, useWbBodyDrag, useWbVertexEdit, useWbRotor, useWbSelectionBar),
// removal (usePlanRemoval), «Karte verknüpfen» (usePlanGeoref), the Tafel's pages
// (usePlanTafelPages), and the render pieces PlanAnno / PlanLineDecor / WbControls.

import { Fragment, type ReactNode, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { BuildingFloat } from './BuildingFloat'
import type { BuildingInfo } from '../lib/api/building'
import { ConnectRing, NodeDeleteChip } from './NodeDeleteChip'
import type { BoardAnno, BoardPoint, BoardTool, BuildingDoc, CaptionMode, LineAttachment, LineEndpoint, LngLat, NoteSize, PlanDocument, ShapeKind, SrcGeoref, Trupp } from '../types'
import type { SymbolsApi } from '../lib/useSymbols'
import type { RailLabels } from '../lib/prefs'
import { Icon } from '../lib/icons'
import { newId } from '../lib/ids'
import { Palette } from './Palette'
import { FloorPage } from './FloorPage'
import { usePlanPaperMm } from './usePlanPaper'
import { paperMaxScale } from '../lib/planTiles'
import { prefetchPlanTiles } from '../lib/planTilePrefetch'
import { PdfViewport } from './PdfViewport'
import { prewarmPlans } from '../lib/pdfRaster'
import { PdfScroller } from './PdfScroller'
import { OsmOutline } from './OsmOutline'
import { appConfig } from '../config/appConfig'
import { useWbVertexEdit, type PlanEndpointDrag } from './useWbVertexEdit'
import { CHIP_SEL_SCALE, useWbChipSizes } from './useWbChipSizes'
import { useWbChipDrag } from './useWbChipDrag'
import { useWbBodyDrag } from './useWbBodyDrag'
import { useWbSelectionBar } from './useWbSelectionBar'
import { usePlanRemoval } from './usePlanRemoval'
import { CIRCLE_MAX_N, useWbRotor } from './useWbRotor'
import { SelectionBar } from './SelectionBar'
import { PlanAnno, type PlanAnnoBoard } from './PlanAnno'
import { TacticalSymbol } from '../lib/symbolRender'
import { PlanLineDecor } from './PlanLineDecor'
import { planEndTagSpots } from '../lib/endTagSpots'
import { SelectionTurn } from './SelectionTurn'
import { beginSheetPeek, endSheetPeek } from '../lib/sheetPeek'
import { hasLineDecor, lineLabel } from '../lib/lineDecor'
import { markerTakesLineEnd, truppForLine, truppIdForAttachment, truppIsOut, truppLineTone, type LinkableLine } from '../lib/truppLines'
import { DUP_PREFIX, duplicateAnno } from '../lib/duplicate'
import { useHiddenTrails } from '../lib/useHiddenTrails'
import { useNotePanelClosing } from '../lib/useNotePanelClosing'
import { usePlacement } from '../lib/useTacticalSelection'
import { endingWireFlags, type LineEnding } from '../lib/drawingEdit'
import { fillTemplate, formatSymbolName, formatTime } from '../lib/format'
import { confirmDialog, toast } from '../lib/ui'
import { usePlacementLane } from '../lib/toastLane'
import { Menu, Overlay } from '../lib/overlays'
import { isBottomSheet, nudgeSelectionIntoRect, rectCenter, visibleWorkRect, type NudgeBox } from '../lib/panelNudge'
import { doneAct, doneOf, donePlace, offersDone } from '../lib/objectDone'
import { serverNow, serverNowIso } from '../lib/serverClock'
import { useHazardData } from '../lib/useHazardData'
import { isMeasuredSymbol, readingPatch, symbolControls, symbolTitleOptions, symbolFieldOptions, symbolPresetFieldKeys } from '../lib/symbols'
import { ContextPanel } from './ContextPanel'
import { DrawEditor } from './DrawEditor'
import { ShapeEditor } from './ShapeEditor'
import { LockChip } from './LockChip'
import { Chip } from './Chip'
import { ShapeGlyph, SHAPE_DEFS, SHAPE_MAX_N, SHAPE_MIN_N, SHAPE_TWO_POINT, rotationBoundsN, rotationBox, rotationRun } from '../lib/shapes'
import { TEAM_DOT_PX, TEAM_PILL_CAP_PX } from '../lib/mapView'
import { noteScale, autoNoteWN, noteWN } from '../lib/notes'
import { isAtemschutzTrupp } from '../lib/atemschutz'
import { dismissNearbyBanner, nearbyBannerDismissed, nearbyBannerKey } from '../lib/nearbyBanner'
import { ghostTrailLabel, type TruppTrail } from '../lib/truppTrails'
import { carryDoors, copyGrundriss, grundrissOf, wallRolePatch, wallRoleWire, wandBlock, wandBlockHint, DOOR_SYMBOL, GEBAEUDE_CATEGORY, GRUNDRISS_STYLE } from '../lib/grundriss'
import { StoreyCopySheet } from './StoreyCopySheet'
import { planUrl, tileAspectOf, TOP_INSET, STACK_VPAD, STACK_CHIP_ROW, STACK_READINGS_LANE, chipRowInset, containFit, sideInsets, clamp01, floorLabel, floorGeometry, signedFloor, floorCrossings, storeyTowards } from '../lib/whiteboard'
import { loadHiddenFloors, saveHiddenFloors, shownFloors } from '../lib/floorPrefs'
import { arrowEdgePadPx, attachInsetPx, boundaryPoint, candidateAttachment, DEFAULT_OBJECT_ROUTING, DETACH_SHOW_PROGRESS, detachAnnos, dwellFor, flipLine, forkPortPoint, wireFreed, isMagnetAnno, lineEndTargets, relationshipNetwork, resolveLinePoints, withDetach, type AnnoDetachPatch, type AttachableLine, type MagneticTarget } from '../lib/lineAttachments'
import { packFrameRing, packPagePlacement, pagePlacement, regionCorners, stackGroundFit } from '../lib/stackFit'
import { circleRing, enclosesSection, inSection, rectPoly, storeySections, visibleCentre } from '../lib/storeyClip'
import type { FloorPackView } from '../lib/floorPackBinding'
import { stackInstances } from '../lib/stackFloors'
import { StackReadings } from './ReadingParts'
import { circleRadiusM, circleRadiusN, pathMetres, polyAreaM2, planFactsTone, scaleLampTone, type PlanScale } from '../lib/planScale'
import { splitAddress } from '../lib/karte/places'
import { cx } from '../lib/cx'
import { PlanFactsSheet, type PlanFact } from './PlanFactsSheet'
import { slimTools, PLAN_READONLY_TOOLS } from '../lib/readOnlyTools'
import { isSelectOnlySurface } from '../lib/useObjectPlans'
import { useIsPhone } from '../lib/useIsPhone'
import type { PlanScales } from '../lib/workspace'
import { fmtDistance, fmtArea } from '../lib/geo'
import { activeViewDeg, bandAspect, BOX_H, BOX_W, buildView, pointRemapper, principalAngleDeg, stackScaleMPerU, type Ring } from '../lib/footprint'
import { reorientAnnos } from '../lib/reorientAnnos'
import { usePlanMeasure } from './usePlanMeasure'
import { usePlanGeoref } from './usePlanGeoref'
import { usePlanTafelPages } from './usePlanTafelPages'
import { INK_DEFAULTS, usePlanDraft } from './usePlanDraft'
import { usePlanCreate, type InkTap } from './usePlanCreate'
import { useMeasuredSheet } from './useMeasuredSheet'
import { PlanScalePrompt, PlanScalePersist } from './PlanScalePrompts'
import { GeorefBoardLayer, GeorefDock, GeorefInstrument, GeorefSplitSeam, type PlanViewApi } from './GeorefMode'
import { GeorefQuality } from './GeorefQuality'
import { GeorefTransfer } from './GeorefTransfer'
import { fitSimilarity, hasAutoPairs, realPairCount } from '../lib/georef'
import { georefForPlan, getStationPlanScales, noteMeasuredAspect, refreshStationPlanScales } from '../lib/stationPlanScale'
import { planAspect } from '../lib/georefTwins'
import { georefChipTone, resetGeorefPlan, useGeorefMode, useGeorefStorage } from '../lib/georefMode'
import { PlanLiveLayer, PlanPhotoMarks } from './PlanLiveLayer'
import type { LiveMark, PhotoMark } from '../lib/planProjection'
import { MAX_SCALE, MAX_SCALE_STACK, MIN_SCALE, boardViewSignature, useBoardView, type BoardViews } from './useBoardView'
import { useBoardDoc, type BoardHistory } from './useBoardDoc'
import { useBoardGestures } from './useBoardGestures'
import { WbToolDocks, WbCircleHandle, WbCircleLayer, WbInkLayer, WbVertexHandles, WbDraftHandles, WbSnapRing, type TruppFinderDoor } from './WbControls'
import { MeasurePanel } from './MeasurePanel'
import { ToolDock } from './ToolDock'
import { ArmedSymbolGlyph, ArmedToolPill } from './ArmedToolPill'
import { armedToolIcon, armedToolName } from '../lib/armedTool'
import { PlanCompass } from './PlanCompass'
import { OrientSlider } from './OrientSlider'
import { ToolRail } from './ToolRail'
import { TafelPageStrip } from './TafelPageStrip'
import { TafelFormPage } from './TafelFormPage'
import { findForms, pageTitles, type FormSeed } from '../lib/boardForm'
import { isDrawnBoardKind } from '../lib/workspace'
import { labelText, type BoardTemplate } from '../lib/boardTemplate'
import { SKIZZE, TAFEL_ID, useTafelPage } from '../lib/tafelPages'
import { isDemoMode } from '../lib/deploymentConfig'
import { BUNDLED_TEMPLATES, warmBoardTemplates } from '../lib/boardTemplates'
import type { MiniKarteProps } from './MiniKarte'

const COLORS = appConfig.drawing.colors
/** height of the strip a folded-away storey leaves behind (board px, matches 09-whiteboard.css) */
const FOLDED_H = 28


interface Props {
  plans: PlanDocument[]
  activeId: string
  annos: BoardAnno[]
  /** effective per-device symbol-size multiplier selected by the app shell: Modul for a
   *  standalone sheet, Karte once the sheet is georeferenced (lib/prefs · planSymbolScale) */
  symMul?: number
  /** device default for on-canvas symbol captions (lib/prefs · symbolCaptions). The Plan has no
   *  zoom, so captions show whenever the mode is on; the Lage map runs them through its label
   *  pass instead (neither surface zoom-gates them any more). */
  captionMode?: CaptionMode
  /** Entity ids whose captions the source Lage map currently suppresses in its shared label
   *  pass. Their Modul twins must stay captionless too. */
  mapSuppressedCaptions?: ReadonlySet<string>
  /** the one writer of this sheet's list. `gesture: false` = the board's own ↶/↷ restoring a
   *  snapshot, which places nothing (lib/useObjectStore · setBoard) */
  onChange: (next: BoardAnno[], opts?: { gesture?: boolean }) => void
  building: BuildingDoc | null
  /** the active object's floor pack – the PDF page each storey tile draws underneath, and the
   *  pack's shared map fit that places it (lib/floorPackBinding) */
  floorPack?: FloorPackView | null
  /** the picked footprints, their auto-orientation angle, and WHERE that footprint box sits on
   *  the ground — the third is what lets the workspace carry the floor stack across the change
   *  instead of clearing it (lib/buildingTransfer · amendBuilding). */
  onSelectBuilding: (src: [number, number][][], orientDeg: number, geo: SrcGeoref) => void
  /** Step between the two faces of the ONE «Gebäude» rail tile: the live OSM outline picker
   *  (`'pick'`) and the floor stack (`'stack'`). Changing the building is a chip down in the
   *  bottom-left row, beside «Kein Objekt» and «Ref. N m» — not a second rail tile and not a
   *  hidden gesture, because it is a once-an-Einsatz act on a surface whose width IS the plan.
   *  Omitted ⇒ the chip is hidden (nothing to step to). */
  onBuildingFace?: (face: 'pick' | 'stack') => void
  onAddFloor: (dir: 1 | -1) => void
  onRemoveFloor: (floor: number) => void
  /** flip the Gebäudeview between oriented + "Norden oben": persists the re-oriented
   *  building (annotations are re-glued via this component's own commit/undo path). */
  onReorient?: (next: BuildingDoc) => void
  /** viewers can pan/inspect but not mutate plan structure (floors, building) */
  readOnly?: boolean
  /** while read-only, still render the slim tool rail (Auswahl · Messen) — the tools that
   *  change nothing. Off for replay (its scrubber owns the bottom band) and for the phone's
   *  Verlauf sheet, where the plan is parked behind a full-width overlay. */
  slimTools?: boolean
  /** Einsatz-Link session (App · linkScoped): the bottom-left setting chips (Maßstab /
   *  Verknüpft) disappear entirely — every setting comes from the origin, and an outside
   *  viewer gets no door to a settings surface, not even a disabled one. */
  linkViewer?: boolean
  /** device pref «Beschriftung der Werkzeugleisten» (lib/prefs · railLabels) — the word under each glyph.
   *  The setting says «in den beiden Leisten», so the plan's rail has to be handed it too. */
  railLabels?: RailLabels
  sym: SymbolsApi
  /** active Mannschaft names feeding the symbol detail comboboxes (Einsatzleiter / Fahrer …) */
  rosterNames?: string[]
  /** name → rank key, for the officer-first sort + "nur Offiziere" filter on leadership symbols */
  rosterRank?: Record<string, string | undefined>
  /** a roster field on a plan symbol («Fahrer», «Name») names somebody who is standing there —
   *  same rule as on the Lage, so the Anwesenheit learns about it from either surface */
  onRosterField?: (symbol: string | undefined, label: string | undefined, key: string, name: string) => void
  /** What is already known about a roster NAME — «unter Atemschutz», «Magazin», «gegangen» —
   *  shown ON the dropdown entry (lib/roleAssignment · personStatusHint). Handed to the plan for
   *  the same reason it is handed to the map: the picker is the moment you learn that the person
   *  you are about to name as Fahrer is under PA, and it read the same on both surfaces or on
   *  neither. Omitted ⇒ plain names. */
  personStatus?: (name: string) => { label: string; tone?: 'warn' | 'muted' | 'info' } | undefined
  /** …and the contradiction a FILLED roster field already carries, per field key (lib/roleAssignment
   *  · roleConflictHint) — printed under the field itself. Same call the Lage makes, just from a
   *  BoardAnno's parts, since a plan symbol is not an Entity. */
  fieldHints?: (symbol: string | undefined, label: string | undefined, fields: Record<string, string> | undefined) => Record<string, string | undefined> | undefined
  onRecent: (name: string) => void
  /** append to the unified journal with plan context (team link, plan coords). */
  log: (icon: string, text: string, extra?: PlanLogExtra) => void
  /** who is signed in — stamped on a «Gelöscht / erledigt» (lib/objectDone · markDone) */
  authorName?: string
  /** name the NEXT undo step in the operator's words («Feuer EG gelöscht») instead of «Plan …» */
  onStepLabel?: (label: string) => void
  /** symbol placed → App may offer logging it as Mittel (same hook as the Lage map) */
  /** record a plan mutation in the hash-chained audit trail (board.* ops). No-op
   *  default keeps the component usable standalone / in tests. */
  emit?: (op: string, payload?: Record<string, unknown>) => void
  /** expose this plan's per-document undo/redo so the GLOBAL TopBar control can drive
   *  it while the Plan is the active surface (App routes undo/redo by surface). */
  historyRef?: React.MutableRefObject<{ undo: (expect?: string) => boolean; redo: (expect?: string) => boolean } | null>
  /** ⚠️ The plan undo/redo STACKS, held by the caller: this component unmounts on every surface
   *  switch, so history kept in its own state was thrown away the moment you glanced at the
   *  Verlauf. Keyed by plan id, so it stays per-plan-document. See useBoardDoc · BoardHistory. */
  hist: BoardHistory
  setHist: React.Dispatch<React.SetStateAction<BoardHistory>>
  /** Tell the caller that this plan gained an undo step, so it lands on the ONE global timeline
   *  (lib/undoTimeline) in the same chronology as the Karte and the Atemschutz-Tafel. Every
   *  `setHist(pushBoardPast(…))` in this file owes it a call — the stacks and the timeline are
   *  two halves of one step and must never come apart. */
  onCheckpoint?: (planId: string, step: string) => void
  /** ⚠️ The per-plan zoom/pan memory, also held by the caller and for the same reason as `hist`:
   *  a glance at the Lage unmounts this component, and a board that reset to «eingepasst» every
   *  time you looked away is a board you have to re-find your way around on every return. A REF,
   *  not state — the Lage map keeps its live view out of state too, so panning re-renders the
   *  board and nothing above it. Omitted ⇒ every plan opens fitted (see useBoardView · memory). */
  views?: React.MutableRefObject<BoardViews>
  /** expose fit-to-view so the phone top bar can offer Fit instead of a floating cluster. */
  fitRef?: React.MutableRefObject<(() => void) | null>
  /** expose tool-pick + zoom so the global keyboard-shortcut layer (App) can drive the Plan
   *  surface, keeping Lage↔Plan shortcut parity. Semantic tool ids map to Plan tools inside. */
  keysRef?: React.MutableRefObject<{ pickTool: (tool: string) => void; zoom: (f: number) => void; duplicate: () => void } | null>
  /** a Verlauf row asked to revisit a plan point — center + select on arrival. */
  /** `flash` shows the anno (a few-second outline) instead of selecting it — see the focus effect */
  focus: { x: number; y: number; floor: number; annoId?: string; twinEntityId?: string; flash?: boolean; nonce: number } | null
  /** report the current plan-view centre (tile-local). Optional and currently unused: it existed
   *  for the composer's «an der Planmitte anheften», which went away on 14.08. — the Wiedergabe
   *  answers «wie sah es da aus» by scrubbing the whole picture instead of storing a point. */
  onView?: (c: { x: number; y: number; floor: number }) => void
  /** currently monitored Atemschutz Trupps — offered when placing a team chip on the plan. */
  trupps?: Trupp[]
  /** every chip and marker name standing on ANY surface of this Einsatz — the Karte and every
   *  plan — so a new generic «Trupp N» draws from the one counter the Atemschutz board numbers
   *  from too (lib/placedTrupps · nextTruppNo). Absent: this board's own chips count alone. */
  placedTeamNames?: () => (string | undefined)[]
  /** Would renaming chip `id` to `label` say a «Trupp N» somebody holds? Then the rename pen
   *  refuses it (docs/trupp-naming.md §7 — a duplicate one device could see coming is never left
   *  for a merge to settle). Absent: this board's own chips are checked alone. */
  teamNameTaken?: (id: string, label: string) => boolean
  /** link a placed chip to a tracked Trupp (chip ↔ Trupp; sets the Trupp's annoId/planId). */
  onLinkTrupp?: (annoId: string, truppId: string) => void
  /** jump to the Atemschutz board for a linked Trupp ("show the trupp"). */
  onShowTrupp?: (truppId: string) => void
  /** «Trupp finden» on the Trupp dock — the workspace's shared TruppFinder (WbControls) */
  truppFinder?: TruppFinderDoor
  /** the incident's ghost «Spuren» recorded on THIS sheet (lib/truppTrails · planGhostTrails) —
   *  the searched area a removed Trupp chip left behind. Drawn read-only and grey, on the storey
   *  each point was walked on; `onGhostTrail` is the «Spur löschen» door (absent ⇒ no door). */
  ghostTrails?: TruppTrail[]
  onGhostTrail?: (id: string) => void
  /** «Marker und Spur löschen» (18.09.2026): ARM the incident's ghost reconciliation to write
   *  this chip's ghost already deleted, so the removal that follows leaves no searched area
   *  standing (lib/truppTrails · reconcileGhostTrails `dropped`). Disarmed again when the
   *  removal is called off, or the chip's NEXT removal would silently take its trail with it. */
  onTrailDrop?: (annoId: string, on: boolean) => void
  /** join this CHIP to an Atemschutz-Trupp — `undefined` lets go of the one it has. The plan twin
   *  of the map marker's «Atemschutz-Trupp» menu (MapMarkers · onTeamTrupp) and routed through the
   *  same action, so the takeover confirm and the «einrücken?» ask exist exactly once
   *  (useTruppActions · adoptTruppMarker / releaseTruppMarker). A chip dropped before anybody was
   *  registered finds its Trupp afterwards, instead of having to be deleted and re-placed — which
   *  on a plan chip would throw away its recorded trail. Absent ⇒ no picker (read-only / locked). */
  onTeamTrupp?: (annoId: string, truppId: string | undefined) => void
  /** «Neuer Trupp» on that same menu: open the Anmeldung for a Trupp that adopts this chip on
   *  save (IncidentWorkspace · newTruppFromMarker). Absent ⇒ no row. */
  onTeamNewTrupp?: (annoId: string) => void
  /** «Gehört zu Trupp …» in the line editor — undefined truppId unlinks. Omitted ⇒ row hidden.
   *  Also the call a Trupp chip dropped on a hose's free end makes (see chipUp). */
  onLinkLineTrupp?: (annoId: string, truppId: string | undefined) => void
  /** A Leitung end just docked onto something — handed up so the workspace can join the hose to
   *  an Atemschutz-Trupp when the thing it docked onto is that Trupp's chip (useTruppActions ·
   *  linkLineToAttachedTrupp). The Karte reports the identical fact from its own magnet
   *  (lib/useMapDrawing · onLineAttached). */
  onLineAttached?: (annoId: string, attachment: LineAttachment) => void
  /** …and the reverse (15.09.): an end let go of its coupling («Lösen», or dragged off) – with
   *  the coupling it had, so the Trupp link that coupling made is dropped too. */
  onLineDetached?: (annoId: string, previous: LineAttachment) => void
  /** a hose line got a NEW number: the Trupp anchored to it carries a copy of the number (the
   *  AS chip prints it), so the renumber must reach the Trupp too (useTruppActions ·
   *  syncLineNoToTrupp). Fires AFTER the drawing itself was patched. */
  onLineRenumber?: (annoId: string, lineNo: number | undefined) => void
  /** per-Trupp contact-clock tier (atemschutz · AtemschutzAlarmState.severities) — tints the tag
   *  and halo of the Leitung that Trupp works on. Passed in so the 1 Hz clock never reaches this
   *  component (see AtemschutzAlarmHost). */
  truppSeverities?: Record<string, 1 | 2>
  /** the loaded Einsatzobjekt (manual pick or auto-surfaced nearest) — named on the surface,
   *  because it is what decides which plans these are. Null = none resolved yet. */
  objectName?: string | null
  /** the object's street address — what the chip over the plans reads (see objectChip) */
  objectAddress?: string | null
  /** set when the AUTO-surfaced object is only the nearest one with plans, not the incident's
   *  own address – the chip turns amber and reads the distance (lib/useObjectPlans) */
  objectNearby?: { distanceM: number; objectId: string } | null
  /** the Gebäude-Steckbrief (lib/api/building) — its chip joins this row beside the Objekt chip,
   *  the same chip the Karte's row carries (BuildingFloat, Lage ↔ Plan) */
  buildingInfo?: BuildingInfo | null
  /** the «Messungen» chip (components/ReadingsChip), built by the workspace: it lists the Karte's
   *  points too, and a row may leave this sheet. Joins the bottom-left row after the Gebäude chips. */
  readingsChip?: ReactNode
  /** the Einsatz the banner's dismissal is remembered for, and the address it contrasts with */
  incidentId?: string
  incidentAddress?: string | null
  /** the Einsatz's own coordinate (null without one) — the pin on the Gebäude picker */
  incidentPos?: LngLat | null
  /** open the PlanPicker. Omitted (an Einsatz-Link, which is bound to one object's plans)
   *  hides the whole control — a read-out nobody may act on is chrome. */
  onObjectSwitch?: () => void
  /** per-plan distance calibration (planId → factor). A plan has no inherent scale; the user
   *  calibrates against a printed scale bar so line lengths read in metres. See lib/planScale. */
  planScale?: PlanScales
  /** persist a plan's calibration (null clears it). Rides the workspace blob via App. */
  onCalibrate?: (planId: string, scale: PlanScale | null) => void
  /** The Karte's live feed on this sheet — vehicles and shared responder positions, already
   *  projected and clipped by the caller (lib/planProjection · liveOverlay). Everything else
   *  the Karte holds is an OBJECT and arrives in `annos` like the sheet's own work. */
  live?: LiveMark[]
  /** The Karte's photo markers on this sheet, read-only (lib/planProjection · photoOverlay) */
  photos?: PhotoMark[]
  /** Drag a live VEHICLE on this sheet: the same held-in-place override the Karte writes. */
  onPlanLiveMove?: (entityId: string, coord: LngLat, phase: 'start' | 'move' | 'end') => void
  /** ⚠️ This gesture is OVER — called from every `phase === 'end'` path below. A gesture that
   *  reaches an object this sheet does not own is one step on the store's stack, and only the
   *  surface can say when it ended: the release writes its final frame from the same pointerup
   *  a listener would hear (lib/useObjectStore · endSheetStep). */
  onStepEnd?: () => void
  /** The Tafel's pages (10.10.2026, docs/board-templates.md): the station's template set, what a
   *  new page may be pre-filled with, and the live mini Karte for a «Lagekarte» box. Absent ⇒
   *  the Tafel is the free sheet only (an Einsatz-Link session). */
  tafel?: TafelPagesProps
}

export interface TafelPagesProps {
  /** read at the tap that adds a page */
  seed: () => FormSeed
  /** what the «Lagekarte» box's mini Karte draws (components/MiniKarte) */
  scene?: MiniKarteProps
  onOpenKarte?: () => void
  /** the Einsatz's title as it is now — the printed pages' caption and file name */
  title?: () => string
}

/**
 * Extra context a Whiteboard action attaches to its journal line — and the ONLY thing that makes
 * the row's chevron able to jump back.
 *
 * ⚠️ Every placement passes `annoId` + `x`/`y` + `floor`. Without them the row carried nothing but
 * the plan document, so «Symbol "Löschleitung" auf Plan gesetzt» opened the Gebäude at whatever
 * floor happened to be showing and selected nothing — the Lage's equivalents have always carried
 * their `entityId` and flown to it, and the Plan's simply did not. Rows written before 23.08. have
 * none of this and degrade to exactly that older behaviour (see IncidentWorkspace · focusEvent).
 */
export interface PlanLogExtra {
  kind?: 'symbol' | 'team' | 'history'; annoId?: string; x?: number; y?: number; floor?: number
  /** which object a row is ABOUT without making it a jump target — a removal (types ·
   *  TimelineEvent.subjectId), exactly what the Karte's removal row carries */
  subjectId?: string
}

// Whiteboard / Tafel — pick a plan document as the background, then
// annotate it with draw / text / symbols and place resource chips whose
// timestamp updates each time they are moved. All annotation coordinates are
// normalized 0..1 in plan-image space so they stick across zoom/pan.

export function Whiteboard({ plans, activeId, annos: annosAll, symMul = 1, captionMode = 'off', mapSuppressedCaptions, onChange: onChangeAll, building, floorPack, onSelectBuilding, onBuildingFace, onReorient, onAddFloor, onRemoveFloor, readOnly: readOnlyProp = false, sym, rosterNames = [], rosterRank, onRosterField, personStatus, fieldHints, onRecent, log, authorName, onStepLabel, emit = () => {}, historyRef, hist, setHist, onCheckpoint, views, fitRef, keysRef, focus, onView, trupps = [], placedTeamNames, teamNameTaken, onLinkTrupp, onShowTrupp, truppFinder, ghostTrails = [], onGhostTrail, onTrailDrop, onTeamTrupp, onTeamNewTrupp, onLinkLineTrupp, onLineAttached, onLineDetached, onLineRenumber, truppSeverities, objectName, objectAddress, objectNearby, buildingInfo, readingsChip, incidentId, incidentAddress, incidentPos, onObjectSwitch, planScale = {}, onCalibrate, live = [], photos = [], onPlanLiveMove, onStepEnd, slimTools: slimToolsProp = false, linkViewer = false, railLabels, tafel }: Props) {
  // ⚠️ RIDERS: what lives on a sheet but is not drawn ON it — the Tafel's pages (kind `form`,
  // lib/boardForm) and any board object this build does not understand (lib/workspace ·
  // isPassengerAnno). Nothing positional may see them: every drawing path below reads `annos` —
  // the sheet WITHOUT its riders — and every write is handed back with the riders put back on
  // (`withForms`), so an ink commit can never drop one. The history (useBoardDoc) snapshots the
  // WHOLE list, so ↶ restores both. On a sheet with no riders this is the identity.
  const formAnnos = useMemo(() => annosAll.filter((a) => !isDrawnBoardKind(a.kind)), [annosAll])
  const annos = useMemo(() => (formAnnos.length ? annosAll.filter((a) => isDrawnBoardKind(a.kind)) : annosAll), [annosAll, formAnnos])
  const withForms = (next: BoardAnno[]) => (formAnnos.length ? [...next.filter((a) => isDrawnBoardKind(a.kind)), ...formAnnos] : next)
  // repaint the baked placard glyphs (Kemler auto-derived via lookupUN) when the fetched
  // ADR dataset lands — see lib/useHazardData.
  useHazardData()
  const active = plans.find((p) => p.id === activeId) ?? plans[0]
  // The live OSM outline sheet is a SELECTION surface: it exists to pick the building that becomes
  // the Gebäude view, and nothing else — it is the picking FACE of the one «Gebäude» rail tile
  // (lib/useObjectPlans · railPlanTiles). So it carries no drawing apparatus at all —
  // no tool rail, no armable tool, no dock, no draw-on-tap; the footprint tap is the one thing
  // that happens here. See lib/useObjectPlans · isSelectOnlySurface for why it is keyed on the
  // catalog's `osm` property rather than on the tile's name.
  // ⚠️ A DELIBERATE exception to Lage↔Plan tool parity, not drift: a surface that cannot be drawn
  // on must not offer tools that quietly do nothing. Don't "fix" the rail back in.
  // Anything already drawn here before this rule still RENDERS (read-only, no handles) — the
  // board is a synced document and nothing may silently disappear from it.
  const selectOnly = isSelectOnlySurface(active)
  /** THE SHEET, as opposed to the Modul slot `activeId` names — every Einsatzobjekt has a «Modul
   *  2», and everything that belongs to one concrete building's paper (its reference, its measured
   *  shape) is keyed on this. Read this high up because the aspect hook below already needs it. */
  const activeGeorefKey = active?.georefKey ?? activeId
  // A viewer-only plan (e.g. PV/documentation PDF) is read-only regardless of role: plain
  // pan/zoom, no drawing tools or annotation surface. Folds into the existing readOnly gates.
  const readOnly = readOnlyProp || active?.viewer === true || selectOnly
  // ── the Tafel's pages (10.10.2026): «Skizze» (this very sheet) plus the template pages added
  // to the Einsatz. Which one THIS device looks at is device-local (lib/tafelPages); a page that
  // went away (↶, another device) falls back to the Skizze by construction.
  const onTafel = active.id === TAFEL_ID && !!tafel
  const pages = useMemo(() => (onTafel ? findForms(formAnnos) : []), [onTafel, formAnnos])
  /** «Konzept», «Konzept 2» … — what each page is called (lib/boardForm · pageTitles) */
  const titles = useMemo(() => pageTitles(formAnnos), [formAnnos])
  // the public demo opens its seeded Einsatz on the first (filled) page, not the empty Skizze;
  // every real Einsatz starts on the Skizze (lib/tafelPages · fallback)
  const [pageSel, setPageSel] = useTafelPage(incidentId, isDemoMode() ? pages[0]?.id : undefined)
  const page = onTafel && pages.some((p) => p.id === pageSel) ? pageSel : SKIZZE
  const formOpen = page !== SKIZZE
  // the station's template set — read once the Tafel is first shown (never on the boot path);
  // the bundled FKS set answers until it lands
  const [templates, setTemplates] = useState<readonly BoardTemplate[]>(BUNDLED_TEMPLATES)
  useEffect(() => {
    if (!onTafel) return
    let live = true
    void warmBoardTemplates().then((t) => { if (live) setTemplates(t) })
    return () => { live = false }
  }, [onTafel])
  /** the top lane the fit keeps clear: the floating bar, and on the Tafel its page strip too */
  // (the Tafel's page strip stands in the bottom row the chip reserve already keeps clear —
  // `botRes`, lib/whiteboard · chipRowInset — so the top reserve is the top bar's alone)
  const topRes = TOP_INSET
  // The slim read-only rail (Auswahl · Messen) — never on a viewer-only or selection-only
  // document, which has no tool rail for ANYONE, so a locked editor and a viewer keep seeing the
  // same surface.
  const slimRail = readOnly && slimToolsProp && active?.viewer !== true && !selectOnly
  // Messen left the Plan rail on 29.08. («a distance worth keeping is a drawn Linie») and came
  // BACK on 02.09.: the field kept reaching for the quick throwaway «wie weit?» glance, and a
  // drawn Linie is a journal-logged act, not a glance. See usePlanMeasure's header.
  const planTools = useMemo(() => appConfig.copy.planTools, [])
  const slimPlanTools = useMemo(() => slimTools(planTools, PLAN_READONLY_TOOLS), [planTools])
  const isPhone = useIsPhone()

  // ⚠️ `tool` is DERIVED, not raw state. The armed tool survives a plan switch (this component
  // does not remount between documents), so a Linie armed on the Tafel would arrive still armed
  // on the selection-only Umrisse sheet — with no rail left to disarm it. Forcing the rest tool
  // there closes every create path at once (they all gate on `tool`) instead of gating each.
  // …and what it will place next: the pending symbol / shape and the place-lock, the Karte's
  // own placement state (lib/useTacticalSelection · usePlacement). Placing one at a time by
  // default (drop to pan + select it after each), or holding the lock to keep placing several,
  // is identical to the Lage map placement model.
  const { tool: armedTool, setTool, pending, setPending, pendingShape, setPendingShape, placeLock, setPlaceLock } = usePlacement<BoardTool>('pan')
  /** measure node currently in the hand — its cumulative label (25px over the fingertip) steps
   *  aside and the fixed .measure-readout carries the number instead (mirrors MapView) */
  const [measDragNode, setMeasDragNode] = useState<number | null>(null)
  // released ANYWHERE ends the readout — the node drag itself is window-tracked (usePlanMeasure),
  // so the button that started it never reliably sees the up
  useEffect(() => {
    if (measDragNode == null) return
    const clear = () => setMeasDragNode(null)
    window.addEventListener('pointerup', clear, true)
    window.addEventListener('pointercancel', clear, true)
    return () => {
      window.removeEventListener('pointerup', clear, true)
      window.removeEventListener('pointercancel', clear, true)
    }
  }, [measDragNode])
  const tool: BoardTool = selectOnly ? 'pan' : armedTool
  // a plan tool takes the taps: the toasts give way to the top lane meanwhile (lib/toastLane)
  usePlacementLane(tool !== 'pan' && !readOnlyProp)
  const [paletteOpen, setPaletteOpen] = useState(false)
  const [selId, setSelId] = useState<string | null>(null)
  // marquee (Mehrfach/lasso) group selection — parity with the Lage map. A separate
  // set from the single selId (which still drives the symbol editor / team actions).
  const [selIds, setSelIds] = useState<string[]>([])
  // …and the mirrored Karte objects the same box caught (D-09), by their twin key
  // (lib/georefTwins · `drawing:<id>` / `content:<id>`). The bar's writers fold each one back
  // through the fit and write the ONE source object on the Karte.
  const [editId, setEditId] = useState<string | null>(null)
  // which note has its detail panel open. Since 29.08. TAPPING a note opens it (chipDown) —
  // the same grammar as a symbol, unified across Karte and Plan. Still separate from selId:
  // a freshly PLACED note goes straight into typing (editId) and must not mount the panel
  // over the keyboard, so placement selects without opening this.
  const [notePanelId, setNotePanelId] = useState<string | null>(null)
  // …and which of them was just PLACED, so its panel opens with the caret in the text field
  // (the Karte's twin — IncidentWorkspace · notePlacedId). A one-shot: a later reopen is a read.
  const [notePlacedId, setNotePlacedId] = useState<string | null>(null)
  // style the NEXT note carries, chosen in the armed-tool dock before anything is placed
  const [noteDefaults, setNoteDefaults] = useState<{ size: NoteSize; plain: boolean; color: string }>(
    { size: 'm', plain: false, color: '' },
  )
  // which Georeferenz twin has its source-backed editor open — the Karte's object, mirrored onto
  // this sheet. Its open panel gives the projection the source object's normal selection halo.
  // a pending team placement awaiting a Trupp pick (x/y/floor of the tapped point)
  const [truppPick, setTruppPick] = useState<{ x: number; y: number; floor: number } | null>(null)
  /** Where the selected anno was TAPPED (client px), paired with its id so a selection that
   *  arrived some other way can't borrow a stale point. Read only by the panel nudge. */
  const [annoTap, setAnnoTap] = useState<{ id: string; x: number; y: number } | null>(null)
  /** the FIRST of a Rotation's two points, while the second is still being looked for (lib/shapes
   *  · SHAPE_TWO_POINT). Lives and dies with one placement gesture. */
  const [rotStart, setRotStart] = useState<BoardPoint | null>(null)
  // h/w of the document box, plus «is that a measurement of THIS sheet or the A4 seed» — one hook,
  // keyed on the sheet rather than on the Modul slot, because the two questions go wrong together
  // (components/useMeasuredSheet). Seeded and reseeded there; nothing else may set it.
  const { aspect, takeAspect, measured: aspectMeasured } = useMeasuredSheet(activeGeorefKey, active?.orientation)
  const [vp, setVp] = useState({ w: 0, h: 0 })
  // per-team trail visibility, the same as the Karte's (lib/useHiddenTrails)
  const { hiddenTrails, toggleTrail } = useHiddenTrails()
  // Plan-Maßstab (calibration) + Messen (ephemeral distance/area) own their state end to end in
  // usePlanMeasure — see the hook call below, which needs toNorm/floorAt and so cannot sit here.

  const canvasRef = useRef<HTMLDivElement | null>(null)
  // The canvas element as STATE, so effects that attach observers/listeners re-run when it
  // (re)mounts. The viewer-only early return renders WITHOUT the canvas — if the Whiteboard
  // first mounts on a viewer plan, a mount-once ([]) effect sees canvasRef.current === null
  // and never recovers: vp stays 0×0, every later board doc renders collapsed (empty
  // Gebäude, PDFs stuck on «wird geladen»). Stable callback — an inline ref would detach/
  // re-attach every render and loop through setState.
  const [canvasEl, setCanvasEl] = useState<HTMLDivElement | null>(null)
  const setCanvas = useCallback((el: HTMLDivElement | null) => { canvasRef.current = el; setCanvasEl(el) }, [])
  const boardRef = useRef<HTMLDivElement>(null)
  const stageRef = useRef<HTMLDivElement>(null)
  // rail tool buttons, so a tool's option dock can be top-aligned to its button
  const toolBtn = useRef<Record<string, HTMLButtonElement | null>>({})
  // `origin` + `attached` + `detach` are the RELEASE half of the ring language (see the Lage map's
  // EndpointDrag — same shape, board coords instead of lng/lat).
  const [planEndpointDragState, setPlanEndpointDragState] = useState<PlanEndpointDrag | null>(null)
  const planEndpointDrag = useRef<PlanEndpointDrag | null>(null)
  const planDwellTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const setPlanEndpointDrag = (next: PlanEndpointDrag | null) => { planEndpointDrag.current = next; setPlanEndpointDragState(next) }
  // which text note is mid-edit (so we checkpoint undo once per edit session, then stream
  // each keystroke live into the anno — like the Lage note title)
  const textEditId = useRef<string | null>(null)
  // zoom/pan view state (layout-based zoom + focal wheel-zoom) lives in a hook, which also
  // remembers it per plan across a surface switch — `signature` says when a remembered view has
  // gone stale (the plan's image / floor stack / calibration changed under it).
  const viewMemory = views
    ? { views, planId: activeId, signature: boardViewSignature(active, building, planScale[activeId]) }
    : undefined
  // floor-stack: a vertical stack of footprint sheets (top = highest storey). Read before the
  // view hook because the stack zooms one step deeper than a sheet does (see MAX_SCALE_STACK).
  const stack = !!(active.floorStack && building && building.floors.length)
  // the Gebäude also keeps its «+ UG» off the bottom-left chip row (lib/whiteboard ·
  // STACK_CHIP_ROW), and an ordinary sheet keeps its foot off it (chipRowInset, sweep B8);
  // `vShift` is where the centre of the lane between bar and row lies — the board transform,
  // the zoom focus (useBoardView) and «centre on» all read it
  const botRes = stack ? STACK_CHIP_ROW : chipRowInset(isPhone)
  const vShift = (topRes - botRes) / 2
  // ⚠️ A sheet drawn from tiles zooms by its PAPER size (lib/planTiles · paperMaxScale): the fit it
  // is measured against is computed further down, so the ceiling lives in state and the view hook
  // reads it through a ref.
  const [paperScale, setPaperScale] = useState<number | null>(null)
  // …and a Gebäude whose storeys are tiled reports how dense its drawings lie on the board
  // (FloorPage · onDensity, board px per paper mm AT FIT), which gives the stack the same rule.
  const [stackDensity, setStackDensity] = useState<number | null>(null)
  const maxScale = stack
    ? (stackDensity ? paperMaxScale(stackDensity, 1, MAX_SCALE_STACK) : MAX_SCALE_STACK)
    : Math.max(MAX_SCALE, paperScale ?? 0)
  const { scale, pos, scaleRef, posRef, applyView, zoomTo, zoom } = useBoardView(canvasRef, canvasEl, viewMemory, maxScale, vShift)

  const osm = active.osm
  /** every storey the building HAS, top-to-bottom – what the eye toggles list, what the document
   *  keeps ink for, and what the Rapport prints, whatever this device has folded away */
  const allFloorsTTB = useMemo(() => (stack ? [...building!.floors].sort((a, b) => b - a) : []), [stack, building])
  // …and which of them THIS DEVICE is looking at (lib/floorPrefs, 16.09.2026). Device-local on
  // purpose: folding a Geschoss away is a way of reading the stack, so it never reaches the synced
  // workspace – the Karte, the other tablets and the Rapport keep the whole building.
  const [hiddenFloors, setHiddenFloors] = useState<number[]>(() => (incidentId ? loadHiddenFloors(incidentId) : []))
  useEffect(() => { setHiddenFloors(incidentId ? loadHiddenFloors(incidentId) : []) }, [incidentId])
  const floorsTTB = useMemo(() => shownFloors(allFloorsTTB, hiddenFloors), [allFloorsTTB, hiddenFloors])
  const N = floorsTTB.length || 1
  // the Gebäude's Messungen beside the storeys (ReadingParts · StackReadings): every Messpunkt on a
  // shown storey, once per storey it spans. Not on a phone – there is no lane beside the stack.
  const stackReadings = useMemo(
    () => (stack && !isPhone ? annos.filter((a) => a.kind === 'symbol' && isMeasuredSymbol(a)).flatMap((a) => stackInstances(a, floorsTTB)) : []),
    [stack, isPhone, annos, floorsTTB],
  )
  const putHidden = (next: number[]) => {
    setHiddenFloors(next)
    if (incidentId) saveHiddenFloors(incidentId, next)
  }
  /** Fold a storey away, or bring it back. ⚠️ The LAST visible one cannot be folded: a stack with
   *  no tile has nothing left to tap, and the way back would be gone with it. */
  const toggleFloor = (f: number) => {
    if (hiddenFloors.includes(f)) { putHidden(hiddenFloors.filter((x) => x !== f)); return }
    if (floorsTTB.length <= 1) return
    putHidden([...hiddenFloors, f])
  }
  /** Bring a storey back because something is SENDING us there – a stair mark tapped on the tile
   *  below, a Leitung climbing into it. Being sent to a storey that is not on the board would
   *  otherwise pan the view into empty space (or, for the climb, do nothing at all). */
  const revealFloor = (f: number) => { if (hiddenFloors.includes(f)) putHidden(hiddenFloors.filter((x) => x !== f)) }
  /** The folded-away storeys as strips: where each one belongs between the drawn tiles (`seam` =
   *  how many drawn tiles are above it) and how many folded storeys share that seam. */
  const folded = useMemo(() => {
    let seam = 0, order = 0
    const rows = allFloorsTTB.flatMap((f) => {
      if (floorsTTB.includes(f)) { seam += 1; order = 0; return [] }
      return [{ floor: f, seam, order: order++ }]
    })
    // how many share each seam – the group ABOVE the top tile grows upwards, so it needs to know
    // its own size to keep the storeys in order (the highest one furthest from the board)
    const sizes = new Map<number, number>()
    for (const r of rows) sizes.set(r.seam, (sizes.get(r.seam) ?? 0) + 1)
    return rows.map((r) => ({ ...r, count: sizes.get(r.seam)! }))
  }, [allFloorsTTB, floorsTTB])
  /** how many PDF regions the stack bakes, which is what shares the device's pixel budget – a
   *  storey drawn as two wings is two rasters, not one (lib/pdfRenderBudget · pageCanvasBudget) */
  const drawings = Math.max(N, floorPack ? floorsTTB.reduce((n, f) => n + (floorPack.tiles[f]?.length ?? 0), 0) : 0)
  const blank = !active.imageUrl && !osm && !stack

  // Active footprint view: buildings picked since auto-orientation carry `src`, so the
  // rendered rings/aspect are derived for the current orientation (oriented by default,
  // or north-up when toggled). Older docs fall back to their stored rings (north-up only).
  /** What the Gebäudeview TURNS: a picked footprint, or – since 16.09.2026 – the plan pack's own
   *  frame as a rectangle in isotropic page space (lib/stackFit · packFrameRing). One ring either
   *  way, so the rotation, the annotation re-glue and the north dial are the same machinery for a
   *  Geschossplan as for an outline. */
  const orientSrc = useMemo(
    () => (building?.pack ? packFrameRing(building.pack) : building?.src?.length ? (building.src as Ring[]) : null),
    [building],
  )
  // a pack's «Längsachse» is its frame's long side; an outline's is its principal axis, computed
  // once when it was picked
  const orientDeg = useMemo(
    () => (building?.pack ? principalAngleDeg(packFrameRing(building.pack)) : building?.orientDeg ?? 0),
    [building],
  )
  const viewAngle = building ? activeViewDeg(building) : 0
  // A8 (29.08.): a DRAG on the north dial rotates the building continuously. While the finger
  // is down this holds the live preview angle – the backdrop AND every annotation turn with it
  // (`previewAnnos`, 28.10.2026); the commit (one reorientTo, through the same remap + undo path
  // as the tap) happens on release, so annotations are WRITTEN exactly once. The release is the
  // Slider's `onCommit`; a gesture cancelled instead drops the preview again (OrientSlider).
  const [dialDragDeg, setDialDragDeg] = useState<number | null>(null)
  const shownAngle = dialDragDeg ?? viewAngle
  /** the turned view of `orientSrc` – present whenever there is something to turn */
  const packView = useMemo(() => (orientSrc ? buildView(orientSrc, shownAngle) : null), [orientSrc, shownAngle])
  const fpView = useMemo(
    () => (packView ?? (building ? { rings: building.rings ?? [building.ring], aspect: building.ringAspect } : null)),
    [packView, building],
  )
  // the align-longest-axis compass only makes sense on the Gebäude floor-stack (whose storeys are
  // drawn from the building footprint). On a module/PDF plan the page is already aligned, so even
  // though a building may be selected at the incident level, the compass must NOT appear there.
  // ⚠️ A PACK may always be turned: its pages are drawn the way the architect's sheet happened to
  // lie, which is exactly what the operator needs to be able to correct. A footprint is only worth
  // offering when its auto-orientation found something to straighten.
  const canOrient = stack && (!!building?.pack || (!!building?.src?.length && Math.abs(orientDeg) > 0.001))
  /** where north is on the paper this stack shows: for an outline, the view angle itself (0 = north
   *  up, by construction); for a pack, the page's own bearing from its map fit, turned by the view.
   *  Null when a pack has no approved fit – then nothing here knows where north is, and the dial
   *  says so instead of pointing somewhere. */
  const northDeg = building?.pack
    ? floorPack?.fit ? floorPack.fit.rotationDeg + shownAngle : null
    : shownAngle

  // the placement press in flight on the ink overlay (components/usePlanCreate · InkTap) — the
  // create tools write it, the rotor's claim ring reads it
  const inkTap = useRef<InkTap | null>(null)
  // floor-stack ↔ board-normalized y maps for the current document (see lib/whiteboard)
  const { mapY, localY, floorAt, boardPts, moveRigid } = floorGeometry(stack, floorsTTB, N)

  // Leaving Linie/Fläche mid-shape never silently drops a committable draft: it asks «Speichern ·
  // Verwerfen · Weiterzeichnen» (27.10.2026; the A6 auto-commit of 29.08. before it). The
  // tool-change release lives in usePlanDraft, next to the commit machinery it needs.
  // The half-laid Maßstab tap is ephemeral and usePlanMeasure clears it itself.
  // `releaseRef` serves the release this board's own lifecycle makes — arming the Georeferenz,
  // leaving the DOCUMENT: an effect cleanup's closure is stale (from the render its effect last
  // ran in), while this ref — re-pointed by an every-commit effect below usePlanDraft — still
  // holds the OLD document's closure when the cleanups of the next commit run.
  const releaseRef = useRef<(from: BoardTool, opts?: { ask?: boolean }) => void>(() => {})
  // the tool the live draft was laid under (the release must classify by the tool being LEFT)
  const prevTool = useRef<BoardTool>('pan')

  // measure viewport so the board can be sized to "contain" the plan exactly — keyed to the
  // canvas ELEMENT, not mount, so it attaches when the canvas appears after a viewer-only doc
  useEffect(() => {
    const el = canvasEl; if (!el) return
    const ro = new ResizeObserver(() => setVp({ w: el.clientWidth, h: el.clientHeight }))
    ro.observe(el); setVp({ w: el.clientWidth, h: el.clientHeight })
    return () => ro.disconnect()
  }, [canvasEl])

  // warm every plan's bitmap in the background once the viewport is measured, so
  // switching documents is an instant blit rather than a fresh rasterization
  useEffect(() => {
    if (!vp.w || !vp.h) return
    prewarmPlans(plans.filter((p) => p.imageUrl).map((p) => planUrl(p.imageUrl)), vp.w, vp.h)
  }, [plans, vp.w, vp.h])
  // …and the sheets that have a tile pyramid are fetched WHOLE for offline use (lib/planTilePrefetch)
  useEffect(() => {
    const t = setTimeout(() => prefetchPlanTiles(plans.filter((p) => p.imageUrl).map((p) => planUrl(p.imageUrl))), 4000)
    return () => clearTimeout(t)
  }, [plans])

  // in stack mode the board's aspect is driven by the floor count and the BUILDING's own storey
  // band – a flat hall gets flat cards, so the stack is as tall as its drawings need (16.09.2026)
  const tileAR = tileAspectOf(building)
  const effAspect = stack ? N * tileAR : aspect
  /** The sheet's annotations as the held orientation slider shows them: the commit's own re-glue
   *  (lib/reorientAnnos) at the preview angle, onto the board ON SCREEN – the band only follows a
   *  pack's turned frame at the commit, so during the drag the backdrop is drawn into this one.
   *  RENDER ONLY: every write still reads `annos`, and the board takes no presses while it stands
   *  (`previewing` below), so nothing can hit-test or commit a previewed position. Null when no
   *  preview is live. */
  const previewAnnos = useMemo(
    () => (dialDragDeg != null && stack && orientSrc
      ? reorientAnnos(annos, { src: orientSrc, fromDeg: viewAngle, toDeg: dialDragDeg, layout: { boardW: 1, boardH: N * tileAR, floors: N } })
      : null),
    [dialDragDeg, stack, orientSrc, annos, viewAngle, N, tileAR],
  )
  const previewing = previewAnnos != null
  /** what the board DRAWS: the live preview while the slider is held, else the sheet */
  const shownAnnos = previewAnnos ?? annos
  // "contain" the plan in the area below the top bar: full width, but the usable
  // height excludes TOP_INSET so the fitted plan never sits behind the bar. In the
  // floor-stack we also reserve STACK_VPAD top & bottom so the +OG / −UG pills (which
  // straddle the stack edges) stay fully visible at the default fit.
  // …and the rails: the WINDOW decides whether they are floating side rails or bottom bars, not
  // the canvas width — during the «Karte verknüpfen» split the canvas is half a screen wide with
  // both rails still in place (lib/whiteboard · sideInsets).
  const side = useMemo(() => {
    const base = sideInsets(vp.w, isPhone)
    // …and with Messpunkte, the stack moves over for their list (StackReadings)
    return stackReadings.length ? { ...base, l: base.l + STACK_READINGS_LANE } : base
  }, [vp.w, isPhone, stackReadings.length])
  const fit = useMemo(() => {
    const pad = stack ? STACK_VPAD : 0
    return containFit(vp, effAspect, { top: topRes + pad, bottom: botRes + pad, l: side.l, r: side.r })
  }, [vp, effAspect, stack, side, botRes, topRes])
  // a storey says its density at the CURRENT zoom; the ceiling wants it at fit. Rounded, so the
  // sub-pixel wobble of a re-layout cannot move the ceiling under a finger.
  const takeStackDensity = (now: number) => {
    // `scale` of THIS render – the one the storey measured itself in – never the ref, which a
    // pinch has already moved on
    const atFit = Math.round((now / (scale || 1)) * 100) / 100
    if (atFit > 0) setStackDensity((was) => (was === atFit ? was : atFit))
  }
  const paperMm = usePlanPaperMm(!stack && active.imageUrl ? planUrl(active.imageUrl) : null)
  useEffect(() => {
    setPaperScale(paperMm && fit.w ? paperMaxScale(fit.w, paperMm, MAX_SCALE) : null)
  }, [paperMm, fit.w])
  // Zoom by LAYOUT, not by a CSS scale transform: the board's real pixel size is
  // fit × scale. This re-rasterizes the PDF + SVG symbols + text crisply at the
  // actual zoom instead of bitmap-scaling a 100% texture (which pixelates them).
  const sW = fit.w * scale, sH = fit.h * scale

  // client point → normalized 0..1 in plan space (board rect reflects the transform)
  const toNorm = (clientX: number, clientY: number): [number, number] | null => {
    const r = boardRef.current?.getBoundingClientRect(); if (!r || !r.width) return null
    return [(clientX - r.left) / r.width, (clientY - r.top) / r.height]
  }

  // --- Plan-Maßstab + Messen (calibration and ephemeral measurement) ---
  // One hook, because both halves share the measurement space: a calibration is only meaningful
  // in the space its reference was drawn in, and a measured path has to be converted into that
  // same space before it can become metres. Nothing here is ever written to the board document.
  // The alignment and the ruler solve the same physical factor. Resolve the live/stored fit
  // before the measuring hook so a linked sheet measures immediately and says «Ref. auto»;
  // there is no second persisted calibration that could drift away from the reference points.
  const georef = useGeorefMode()
  useGeorefStorage()
  const georefArmed = georef.planId === activeId
  // Opening a sheet is the moment its station data has to be current: the Massstab and the
  // Georeferenz are set by whoever happens to be holding a device, and every OTHER device only
  // read the document once, at boot. Re-reads on plan switch (and on focus, from main.tsx);
  // an unchanged answer notifies nobody, so this costs a render only when something really moved.
  useEffect(() => { void refreshStationPlanScales() }, [activeGeorefKey])
  const canGeoref = !osm && !blank && !stack && active?.viewer !== true
  const measureARForGeoref = stack ? 1 / tileAR : 1 / aspect
  // Armed ⇒ the live pairs; otherwise what is stored. Deliberately NOT memoised: both sides are
  // a reference to an array somebody else owns (the mode store, or the station document), so the
  // identity is already stable between renders and a memo would only add a dependency the linter
  // cannot see. `useGeorefStorage()` above is what makes the stored read re-run.
  // measureAR is the plan's width/height — exactly the `planAspect` the fit is taken at. Solved
  // per render rather than memoised: it is a closed-form fit over at most a handful of points,
  // and a memo here would depend on an array identity the linter cannot reason about.
  const georefPairs = georefArmed ? georef.pairs : georefForPlan(activeGeorefKey)?.pairs ?? []
  const georefFit = canGeoref ? fitSimilarity(georefPairs, measureARForGeoref) : null
  // A7 (29.08.): the Gebäude floor-stack is excluded from the georef fit (one similarity can't
  // mean anything across a column of storey copies), but its scale needs no fit at all — the
  // footprint's ground size is known since georeferencing shipped (`geo.spanM`), so the Massstab
  // is derived from geometry alone and a fresh Gebäude measures immediately. Committed view
  // angle on purpose (not the drag preview): the derived factor must match the document the
  // measured lines are glued to. Legacy buildings without `geo` keep the manual calibration
  // path (SrcGeoref's contract: nothing may misbehave without it).
  // …and a PACK stack knows it from the pack's map fit (lib/stackFit): tile → frame → page → ground
  // is one similarity, whose metres per tile unit are the Massstab – «Ref. auto», like a linked sheet.
  const packMPerU = stack && building?.pack && floorPack?.fit ? stackGroundFit(building, floorPack.fit)?.scaleMPerU ?? null : null
  const stackMPerU = packMPerU ?? (stack && building?.src?.length && building.geo
    ? stackScaleMPerU(building.src, building.geo.spanM, viewAngle, N, measureARForGeoref)
    : null)
  const autoScale: PlanScale | undefined = georefFit
    ? { mPerU: georefFit.scaleMPerU, refM: 0, ar: measureARForGeoref }
    : stackMPerU
      ? { mPerU: stackMPerU, refM: 0, ar: measureARForGeoref }
      : undefined
  /**
   * ⚠️ …and this surface tells the station document what SHAPE the sheet is.
   *
   * It is the only one that can. The app shell solves every plan's fit through an aspect recovered
   * from the plan's stored calibration (georefTwins · planAspect), and that number goes stale the
   * moment a Modul PDF is replaced by a differently-shaped sheet — undetectably, because
   * staleness is measured against the very aspect being looked for and the pairs were fitted at
   * the same wrong one. Here the bitmap is on screen and measured. Once per sheet per session,
   * only for a sheet that HAS a reference (the fit is what the number is for), only when it
   * really disagrees, and never from a read-only session: `noteMeasuredAspect` holds all four
   * conditions, so this is just the offer.
   */
  useEffect(() => {
    if (readOnlyProp || !canGeoref || !active || !aspectMeasured) return
    if (!georefForPlan(activeGeorefKey)?.pairs.length) return
    noteMeasuredAspect(activeGeorefKey, measureARForGeoref, planAspect(active, getStationPlanScales(), planScale[activeId]))
  }, [readOnlyProp, canGeoref, active, aspectMeasured, activeId, activeGeorefKey, measureARForGeoref, planScale])
  const planMeasure = usePlanMeasure({ activeId, stack, aspect, tileAR, planScale, localY, floorAt, tool, setTool, toNorm, log, onCalibrate, autoScale })
  const {
    calNodes, calPrompt, refMInput, setRefMInput, savePrompt, setSavePrompt,
    measMode, setMeasMode,
    measureAR, activeScale, scaleAuto, scaleStale, calibrated, planMetres,
    measPath, setMeasPath, measFresh, measMpts, measLenM, measAreaM2, measPerimM, measReset, resetEphemeral,
    measNodeDown, measMove, measUp, measDragging, measInsert, measDelete, measPress,
    closeCalPrompt, commitCalibration,
  } = planMeasure
  /**
   * The sheet's own ground width in metres — one normalized sheet width is `mPerU · measureAR`,
   * because the measurement space is `(nx · measureAR, ny)` (lib/planScale's header) and a stored
   * `x`/`sizeN` is a fraction of the WIDTH. Identical to `georefTwins · planGroundWidthM` for a
   * georeferenced sheet (`activeScale.mPerU` is then the fit's `scaleMPerU`), but it also answers
   * for a Gebäude stack and for a hand-calibrated plan, which is exactly what «the plan knows its
   * scale» has to mean. Null on a sheet that does not know.
   */
  const planWidthM = activeScale ? activeScale.mPerU * measureAR : null
  /** …so a Rotation on a scaled sheet states the same 300 m / 20–45 m / 20 km the Karte does
   *  (lib/shapes · rotationBoundsN). Read by the placement tap, the two end grips and the ±
   *  «Länge» stepper, so all three agree with each other and with the map. */
  const rotN = rotationBoundsN(planWidthM)

  // --- Karte verknüpfen (Georeferenz) — components/usePlanGeoref ------------------------------
  const {
    georefApproved, georefState, georefChipShown, beginGeoref,
    qualityFor, setQualityFor, georefQuality, georefTransferOpen, setGeorefTransferOpen, georefTransferTargets, transferGeoref,
  } = usePlanGeoref({
    plans, active, activeId, activeGeorefKey, georef, georefArmed, georefPairs, georefFit, canGeoref, readOnly, linkViewer,
    measureAR, boardRef,
  })
  /** The Massstab pill's own lamp (18.09.2026) — the phone pill is icon + lamp and nothing else,
   *  so this dot is all that is left of «Ref. 25 m» / «nicht kalibriert» / «Massstab neu prüfen».
   *  The mapping is a pure helper (planScale · scaleLampTone) so the tones cannot drift from the
   *  branches the chip below actually renders. A scale DERIVED from the Kartenverknüpfung is only
   *  as trustworthy as that fit, so it borrows the georef chip's own warn state. */
  const scaleTone = scaleLampTone({
    auto: scaleAuto, autoFromFit: !!georefFit, fitWarn: georefState.warn, stale: scaleStale, calibrated,
  })
  // ⚠️ ONE mode at a time — the same clean slate a document switch makes (see the reset above).
  // Arming hides the tool rail, and until 26.08. that was ALL it did: the tool stayed armed
  // underneath, so a Messen path kept its handles, a create tool kept its `.wb-ink` layer and a
  // selected object kept its vertex grips — every one of them drawn ABOVE the pairing layer
  // (z 7/8 vs the capture's z 6). A tap meant for a reference point then dragged a node or
  // extended a line, and a hold armed a node delete. The rail being gone is exactly why this has
  // to be a real reset and not a visual one: there is no way back to «Auswahl» while the mode runs.
  useEffect(() => {
    if (!georefArmed) return
    // …and arming the mode leaves the draft: a committable one is SAVED (with a toast) rather than
    // asked about — «Weiterzeichnen» could not re-arm a tool under the running Georeferenz
    releaseRef.current(tool, { ask: false })
    setSelId(null); setSelIds([]); setEditId(null); setPending(null); setPendingShape(null)
    setPaletteOpen(false); setTruppPick(null)
    resetEphemeral() // the calibration nodes usePlanMeasure owns
    setTool('pan')
  }, [georefArmed]) // eslint-disable-line react-hooks/exhaustive-deps
  const georefView: PlanViewApi = { toNorm, applyView, zoomTo, scaleRef, posRef, canvasEl, boardRef }

  // --- Zwillinge: what the Karte lends this sheet ---------------------------------------------
  // Projected HERE, against this sheet's own `georefFit`, so a twin can never disagree with the
  // reference crosses drawn beside it — the app shell resolves a plan's aspect from its stored
  // calibration, while this surface has actually measured the bitmap (usePlanMeasure · measureAR).
  //
  /** A live VEHICLE dropped on the paper: folded back through this sheet's own fit and handed to
   *  the Karte's writer, which turns it into the same held-in-place override the Karte writes.
   *  `georefFit.toMap` is the exact inverse of the projection that drew the mark, so it lands
   *  where it was dropped. Gated on `readOnly`: a viewer may look and nothing more. */
  const moveLiveMark = useCallback((id: string, pt: { x: number; y: number }, phase: 'start' | 'move' | 'end') => {
    if (readOnly || !georefFit || !onPlanLiveMove) return
    const c = georefFit.toMap(pt)
    onPlanLiveMove(id, [c.lng, c.lat], phase)
  }, [readOnly, georefFit, onPlanLiveMove])


  // Annotation document + per-plan undo/redo (the set/commit mutation funnel, audit-emitting CRUD,
  // and the global-TopBar history wiring) live in useBoardDoc; the gesture handlers and render
  // below call the returned mutators exactly as before. The keyed history MAP itself is passed
  // through from the caller — it has to outlive this component's unmount (see Props · hist).
  // which drawing's label is being typed right now (one undo step per edit, not per keystroke)
  const labelLive = useRef<string | null>(null)
  // …and the same for a symbol's / note's TITLE in the detail panel: the panel streams every
  // keystroke (ContextPanel · onTitleLive) so the glyph's label updates under the finger, exactly
  // as it does on the Lage. Checkpoint once when typing starts, emit once on blur — otherwise
  // «Sicherung» is nine undo steps and nine audit rows.
  const titleLive = useRef<string | null>(null)
  /** ↶ / ↷ on the Tafel lands where the step was: the page it changed, else the Skizze */
  const onRestore = (from: BoardAnno[], to: BoardAnno[]) => {
    if (!onTafel) return
    const was = new Map(from.filter((a) => a.kind === 'form').map((a) => [a.id, JSON.stringify(a)]))
    const changed = to.find((a) => a.kind === 'form' && was.get(a.id) !== JSON.stringify(a))
    if (changed) { setPageSel(changed.id); return }
    const gone = [...was.keys()].some((id) => !to.some((a) => a.id === id))
    if (gone || formOpen) setPageSel(SKIZZE)
  }
  // every board write leaves through here: a Durchgang rides along with the Wand that write moved,
  // and lets go of one it deleted (lib/grundriss · carryDoors) – ↶ / ↷ restores are left as they are
  const writeBoard: typeof onChangeAll = (next, ...opts) =>
    onChangeAll(opts[0]?.gesture === false ? next : carryDoors(annosAll, next, tileAR), ...opts)
  const boardDoc = useBoardDoc({
    annos: annosAll, onChange: writeBoard, emit, activeId, selId, setSelId, editId, setEditId, historyRef, hist, setHist, onCheckpoint, onStepEnd, onRestore,
  })
  const { pushPast, add, patch, patchCommit, removeAnno } = boardDoc
  const set = (next: BoardAnno[]) => boardDoc.set(withForms(next))
  const commit = (next: BoardAnno[]) => boardDoc.commit(withForms(next))

  // ── a Tafel page: added, written on, printed, removed — components/usePlanTafelPages ─────────
  const { addPage, editPage, printPages, printing, removePage } = usePlanTafelPages({
    onTafel, pages, titles, page, setPageSel, readOnly, tafel, incidentId, add, patchCommit, log, onStepLabel,
  })
  // expose fit-to-view (the phone top bar's Fit button calls it; desktop uses the rail footer)
  useEffect(() => { if (fitRef) fitRef.current = () => applyView(1, { x: 0, y: 0 }); return () => { if (fitRef) fitRef.current = null } })
  /**
   * Cmd/Ctrl+D — duplicate the ONE selected annotation, a small nudge away so the copy is visibly
   * offset and separately selectable (A22). The Karte's own semantics (useMapActions ·
   * duplicateSelection) and the same copy rules (lib/duplicate · duplicateAnno): one object at a
   * time, one undo step, one «Objekt dupliziert» row, and the selection moves to the copy.
   *
   * Deliberately NOT wired for a Mehrfach group or for a mirrored object — neither is on the
   * Karte either. A group would need a per-item id remap (and, on the Kroki, would have to decide
   * what a copied attachment points at); a twin's source lives in the other document, and this
   * surface's `add` writes only its own.
   */
  const duplicateSelection = () => {
    if (readOnly || selIds.length > 1) return
    const src = annos.find((a) => a.id === selId)
    if (!src) return
    const id = newId(DUP_PREFIX[src.kind])
    const copy = duplicateAnno(src, id, () => [...annos.filter((a) => a.kind === 'resource').map((a) => a.text), ...(placedTeamNames?.() ?? [])])
    add(copy)
    setSelId(id); setSelIds([])
    log('layers', appConfig.copy.log.duplicated, { annoId: id, x: copy.x ?? copy.pts?.[0]?.[0], y: copy.y ?? copy.pts?.[0]?.[1], floor: copy.floor })
  }

  useEffect(() => {
    if (isPhone && active.id === 'tafel' && tool === 'measure') setTool('pan')
  }, [isPhone, active.id, tool, setTool])

  // expose tool-pick + zoom + duplicate to the keyboard-shortcut layer. Semantic ids (from App) →
  // Plan tools; the rest tool is 'pan' (the plan pans on empty canvas), 'note'→'text',
  // 'team'→'resource'. No dep array (mirrors fitRef) so the handle always closes over live state.
  useEffect(() => {
    if (!keysRef) return
    const MAP: Record<string, BoardTool> = { select: 'pan', lasso: 'lasso', line: 'line', area: 'area', circle: 'circle', note: 'text', team: 'resource', measure: 'measure' }
    keysRef.current = {
      pickTool: (cmd) => {
        if (formOpen) return // a Tafel PAGE is a form: no tool to arm on it
        if (selectOnly || (isPhone && active.id === 'tafel' && cmd === 'measure')) return // the Umrisse sheet arms nothing — by keyboard either (see selectOnly)
        if (cmd === 'symbol') { setTool('symbol'); setPaletteOpen(true); return }
        const id = MAP[cmd]; if (!id) return
        setTool(tool === id ? 'pan' : id); setPending(null)
      },
      zoom: (f) => zoom(f),
      duplicate: () => duplicateSelection(),
    }
    return () => { if (keysRef) keysRef.current = null }
  })

  // every tap-to-place tool needs the .wb-ink capture overlay mounted — INCLUDING 'shape'
  // (the palette's Rauch/Rechteck/Pfeil forms). Omitting 'shape' left its overlay off the
  // Plan, so arming a shape froze the surface: the tap placed nothing and, with no overlay,
  // the board couldn't pan either. placeNode already handles 'shape'.
  const creating = tool === 'line' || tool === 'area' || tool === 'circle' || tool === 'text' || tool === 'symbol' || tool === 'shape' || tool === 'resource' || tool === 'scale' || tool === 'measure'
  /** a two-point shape (Rotation) is armed: each of its two taps may claim a symbol, and it does
   *  so by dwelling — press, hold until the ring closes, let go (lib/shapes · SHAPE_TWO_POINT) */
  const rotPlacing = tool === 'shape' && !!pendingShape && SHAPE_TWO_POINT[pendingShape] && !readOnly
  // Derived guard, not per-exit bookkeeping (the Lage map has the same one): the moment the
  // two-point gesture stops being armed, its first point is meaningless — left behind, it drew
  // an orphaned anchor dot in pan mode and silently became one end of the NEXT Rotation.
  useEffect(() => {
    if (!rotPlacing) { setRotStart(null); clearRotMagnet() }
  }, [rotPlacing]) // eslint-disable-line react-hooks/exhaustive-deps
  // symbols/notes are sized smaller on the Gebäude floor-stack (small storey tiles) than on the
  // full-page module plans, so they don't dwarf the building outline — closer to the Lage map feel
  // Symbol/note size: on a PDF plan, scale it to the board WIDTH (= one page's width, since stitched
  // multi-page plans stack pages vertically at the same width). A fixed px size looked right on a
  // single page but went gigantic on a tall multi-page stitch (where the board is narrow); this keeps
  // a symbol ~the same fraction of a page whether the plan is 1 page or 6. The Gebäude floor-stack
  // keeps its own tuned sizes. (~0.085·fit.w ≈ 42 on a typical single A4 portrait.)
  const symBase = (stack ? 28 : Math.max(16, Math.min(52, fit.w * 0.085))) * symMul
  const txtBase = stack ? 10 : Math.max(7, Math.min(16, fit.w * 0.026))

  // Resolve every magnetic Plan line once in stacked-board screen space. The optional floor on
  // each point lets one polyline cross storeys while legacy two-tuples inherit anno.floor.
  // The dragged endpoint follows the FINGER, fed into resolution with its own attachment ignored, so
  // attached branch lines follow the node live (move + carry) rather than snapping only on release.
  const attachmentLines: AttachableLine<BoardPoint>[] = shownAnnos
    .filter((a) => a.kind === 'draw' && (a.pts?.length ?? 0) >= 2)
    .map((a) => {
      const drag = planEndpointDragState?.id === a.id ? planEndpointDragState : null
      if (!drag) return { id: a.id, points: a.pts!, teilstueck: a.teilstueck, width: a.width, startAttachment: a.startAttachment, endAttachment: a.endAttachment }
      const idx = drag.endpoint === 'start' ? 0 : a.pts!.length - 1
      return {
        id: a.id, points: a.pts!.map((p, i) => (i === idx ? drag.point : p)), teilstueck: a.teilstueck, width: a.width,
        startAttachment: drag.endpoint === 'start' ? undefined : a.startAttachment,
        endAttachment: drag.endpoint === 'end' ? undefined : a.endAttachment,
      }
    })
  // Which drawn Leitungen carry a Trupp whose contact clock has run out — the halo map for the ink
  // layer. Keyed by anno id; only warn/crit appear, so a quiet plan builds an empty object.
  const truppTones = useMemo(() => {
    const out: Record<string, 'warn' | 'crit'> = {}
    for (const a of annos) {
      if (a.kind !== 'draw') continue
      const tr = truppForLine(a, trupps)
      if (!tr) continue
      const tone = truppLineTone(tr, truppSeverities?.[tr.id] ?? 0)
      if (tone === 'warn' || tone === 'crit') out[a.id] = tone
    }
    return out
  }, [annos, trupps, truppSeverities])

  const resolvedPts = new Map<string, BoardPoint[]>()
  const { chipSizes, chipRef } = useWbChipSizes()
  /** The box a plan object offers an attaching line, in board px. A team chip is a left-anchored
   *  STRIP — its stored point is the DOT, so its body hangs to the RIGHT of that point rather than
   *  around it (see the wb-anno transform); `dx` puts the box back over the chip. Its size is the
   *  chip as RENDERED (useWbChipSizes, 11.10.2026): the resting strip is as wide as its name, the
   *  selected pill is two rows under a 1.12 scale about its own centre, and the old fixed ~76×44
   *  guess put a docked arrow's tip on the selected pill's name. 76×44 stays the fallback for a
   *  chip not measured yet (first frame, jsdom). */
  const attachBox = (a: Pick<BoardAnno, 'kind' | 'id'>) => {
    if (a.kind !== 'resource') return { width: symBase, height: symBase, dx: 0 }
    const m = chipSizes[a.id]
    if (!m) return { width: 76, height: 44, dx: 76 / 2 - TEAM_DOT_PX / 2 }
    const sel = selId === a.id
    const k = sel ? CHIP_SEL_SCALE : 1
    // the anchor offset of the wb-anno transform: the dot's centre at rest, the cap when selected
    return { width: m.w * k, height: m.h * k, dx: m.w / 2 - (sel ? TEAM_PILL_CAP_PX : TEAM_DOT_PX / 2) }
  }
  /** Lines whose END wears an arrowhead — an attached arrow end stops at the glyph's edge
   *  (lib/lineAttachments · arrowEdgePadPx) instead of tucking under it. */
  const arrowLines = new Set(annos.flatMap((a) => (a.kind === 'draw' && a.arrow ? [a.id] : [])))
  /**
   * Every MIRRORED Karte object this sheet offers a docking Leitung — the same kinds a native
   * plan symbol/chip offers (lib/lineAttachments · MAGNET_ANNO_KINDS). A hose that reaches the
   * mirrored TLF has reached the TLF; nothing on the surface said why it could not (D-08).
   * ⚠️ The stored attachment names an object in the KARTE's document. See the Lage's twin of this
   * list (MapView · twinMagnets) for what that costs: the live surfaces resolve it, print and
   * a far-side delete fall back to the stored point, which resolveLinePoints already does safely.
   */
  const objectPoint = (id: string, toward: BoardPoint, attachment: LineAttachment, source: AttachableLine<BoardPoint>): BoardPoint | null => {
    const target = shownAnnos.find((a) => a.id === id && isMagnetAnno(a)) ?? null
    if (!target || target.x == null || target.y == null || !sW || !sH) return null
    const floor = target.floor ?? 0
    const box = attachBox(target)
    const center: [number, number] = [target.x * sW + box.dx, mapY(floor, target.y) * sH]
    const tp: [number, number] = [toward[0] * sW, mapY(toward[2] ?? floor, toward[1]) * sH]
    // negative padding = the endpoint lands just INSIDE the glyph, so the stroke disappears
    // under the symbol instead of stopping short of it (see attachInsetPx) — except an ARROW end:
    // its head is painted above the objects, so it stops at the edge instead (arrowEdgePadPx)
    const arrowEnd = attachment === source.endAttachment && arrowLines.has(source.id)
    const pad = arrowEnd ? arrowEdgePadPx(source.width ?? 5) : -attachInsetPx(source.width)
    const p = boundaryPoint({ shape: 'rect', center, width: box.width, height: box.height, rotation: target.rotation }, tp, pad)
    return [p[0] / sW, localY(p[1] / sH, floor), floor]
  }
  const linePoint = (target: AttachableLine<BoardPoint>, endpoint: LineEndpoint, attachment: LineAttachment, resolved: BoardPoint): BoardPoint => {
    if (!(endpoint === 'end' && target.teilstueck) || attachment.port == null || target.points.length < 2) return resolved
    const q = target.points[target.points.length - 2], floor = resolved[2] ?? q[2] ?? 0
    const ppx: [number, number] = [resolved[0] * sW, mapY(resolved[2], resolved[1]) * sH], qpx: [number, number] = [q[0] * sW, mapY(q[2], q[1]) * sH]
    const port = forkPortPoint(ppx, qpx, target.width ?? 4, attachment.port)
    return [port[0] / sW, localY(port[1] / sH, floor), floor]
  }
  for (const l of attachmentLines) resolvedPts.set(l.id, resolveLinePoints(l, { lines: attachmentLines, objectPoint, linePoint }))
  const relationship = relationshipNetwork(attachmentLines, selId && attachmentLines.some((l) => l.id === selId) ? [selId] : [], selId && annos.some((a) => a.id === selId && (a.kind === 'symbol' || a.kind === 'resource')) ? [selId] : [])
  // resolvedPts already carries the dragged endpoint at the finger position (attachmentLines injects
  // it above), so the anno list needs no second override.
  const renderAnnos = shownAnnos.map((a) => (resolvedPts.has(a.id) ? { ...a, pts: resolvedPts.get(a.id)! } : a))
  // the Leitungen's end tags, each on the first spot of its line that covers no symbol, Trupp chip
  // or earlier tag (lib/endTagSpots · planEndTagSpots, sweep 28.10.2026 #8b)
  const tagSpots = planEndTagSpots(renderAnnos, renderAnnos.flatMap((a) => {
    if (a.kind !== 'symbol' && a.kind !== 'resource') return []
    const { width, height, dx } = attachBox(a)
    const cx = (a.x ?? 0.5) * sW + dx, cy = mapY(a.floor, a.y ?? 0.5) * sH
    return [{ x: cx - width / 2, y: cy - height / 2, w: width, h: height }]
  }), sW, sH, mapY)

  /** Every placed Trupp chip on this sheet, as the one-Trupp rule reads them (a Plan's `resource`
   *  is the Karte's team marker — lib/truppLines · TruppMarker). */
  const planTruppMarkers = () => annos.flatMap((a) => (a.kind === 'resource' ? [{ id: a.id, truppId: a.truppId }] : []))
  const planCandidatesAt = (sourceId: string, pointer: [number, number], draftStart?: LineAttachment): MagneticTarget[] => {
    // ── EINE Leitung, EIN Trupp, schon am Magneten (lib/truppLines · markerTakesLineEnd) ──
    // The Plan's twin of the Lage rule (MapView · candidatesAt): a hose that already has a crew
    // does not see another Trupp's chip as a target at all — only its own, so a coupling pulled
    // off can be put back. A draft is judged by the claim its first end already made.
    const srcLine: LinkableLine | undefined = annos.find((a) => a.id === sourceId && a.kind === 'draw')
      ?? (sourceId === '__draft__' ? { id: sourceId, truppId: truppIdForAttachment(draftStart, planTruppMarkers()) } : undefined)
    const objects: MagneticTarget[] = annos
      .filter((a) => isMagnetAnno(a) && a.x != null && a.y != null
        && (a.kind !== 'resource' || markerTakesLineEnd(srcLine, trupps, { id: a.id, truppId: a.truppId })))
      .map((a) => {
        const box = attachBox(a)
        const center: [number, number] = [a.x! * sW + box.dx, mapY(a.floor, a.y!) * sH]
        const edge = boundaryPoint({ shape: 'rect', center, width: box.width, height: box.height, rotation: a.rotation }, pointer)
        return { key: `object:${a.id}`, target: { kind: 'object', id: a.id }, point: edge, defaultRouting: DEFAULT_OBJECT_ROUTING }
      })
    const lines = lineEndTargets(renderAnnos
      // a Wand is layout: no Leitung couples onto its end
      .filter((a) => a.kind === 'draw' && !a.role && a.id !== sourceId && (a.pts?.length ?? 0) >= 2)
      .map((a) => {
        const pts = a.pts!, px = (p: BoardPoint): [number, number] => [p[0] * sW, mapY(p[2] ?? a.floor, p[1]) * sH]
        return { id: a.id, teilstueck: a.teilstueck, width: a.width, start: [px(pts[0]), px(pts[1])], end: [px(pts[pts.length - 1]), px(pts[pts.length - 2])] }
      }), attachmentLines, sourceId)
    return [...objects, ...lines]
  }
  const planAttachmentFor = (c: MagneticTarget): LineAttachment => candidateAttachment(c, attachmentLines)

  // --- the draft in the hand, its magnet, the commit funnel, the leave release and the Grundriss
  // presets — components/usePlanDraft ---
  const planDraft = usePlanDraft({
    tool, setTool, annos, add, log, setSelId, onLineAttached,
    sW, sH, mapY, localY, stack, outlinePx: (f) => stackOutlinePx(f),
    planCandidatesAt, planAttachmentFor, planEndpointDragState, prevToolRef: prevTool,
    onContinue: () => setPaletteOpen(false),
  })
  const {
    lineMode, areaMode, draft, setDraft, circleDraft, setCircleDraft,
    draftFloorRef, noding, draftActive, planDraftMagnetState, planJoinPreview,
    addLine, addArea, finishShape, releaseDraft, grundriss, pickInput, tapDraftVertex, snapWallVertex, snapDraftVertex, snapMoveOf, ring, showRing, openName,
  } = planDraft
  // Arriving on the selection-only sheet also DISARMS what was carried over: its dock went with
  // the rail, so a still-pending symbol would be an invisible armed state that fires on the next
  // document opened.
  useEffect(() => {
    if (!selectOnly) return
    setTool('pan'); setPending(null); setPendingShape(null); setPaletteOpen(false); setDraft(null); setCircleDraft(null)
  }, [selectOnly, setTool, setPending, setPendingShape, setDraft, setCircleDraft])
  /** Put a symbol / shape being placed down – the armed pill's ✕ and Escape (round 2, 27.10.2026) */
  const stopPlacing = () => { setPending(null); setPendingShape(null); setTool('pan') }
  // Esc cancels an in-progress node shape, else clears the selection
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return
      // typing in a field? Escape leaves the FIELD and nothing more, so one key press never
      // both finishes the text and drops the selection (which would take the handles with it).
      // Read the event TARGET, not activeElement: the field's own handler has already blurred
      // by the time this bubbles up, so activeElement is <body> and the guard would miss.
      const el = e.target instanceof HTMLElement ? e.target : null
      if (el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable)) return
      // …and a MODAL on top of the board owns Escape outright: it closes, the board does not
      // also drop the draft/selection behind it. Focus is trapped inside the dialog, so the
      // target is enough to tell (covers the Trupp picker, the Maßstab entry, every overlay).
      if (el?.closest('[role="dialog"], [role="alertdialog"]')) return
      // Escape leaves the tool like ✕ does: putting the tool down releases the draft, and a
      // committable one asks «Speichern · Verwerfen · Weiterzeichnen» (27.10.2026 – until then
      // Escape was the one silent discard; «Verwerfen» is now the explicit way to throw it away).
      // A symbol or shape being placed is put down first – the Karte's order (lib/hotkeyRoute ·
      // routeEscape); with «Mehrere platzieren» on, the Plan had no way out (round 2, 27.10.2026)
      if (rotStart) { setRotStart(null); clearRotMagnet() }
      else if (pending || pendingShape) stopPlacing()
      else if (draft) setTool('pan')
      else if (circleDraft) setCircleDraft(null)
      // …then the Passung dock. It is deliberately not an Overlay (it must not trap the board
      // behind a scrim while a fit is being judged), so it has no Escape of its own and would
      // otherwise be the ONE panel on this surface that the key cannot dismiss.
      else if (qualityFor) setQualityFor(null)
      else if (notePanelId) setNotePanelId(null)
      else if (selId) setSelId(null)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
    // `rotStart` belongs here: without it the handler kept the null from before the first tap,
    // and Escape skipped a half-laid Rotation (review sweep 23.09.2026). `clearRotMagnet` is
    // left out on purpose: it is declared further down (useWbRotor), and every render's copy
    // touches the same refs and setter, so an older one does the same – `stopPlacing` likewise
    // (setters only); `pending` / `pendingShape` are what it is gated on, so they are in.
  }, [rotStart, draft, circleDraft, qualityFor, selId, notePanelId, pending, pendingShape])

  // reset transient state when switching document. Sits BELOW usePlanMeasure and usePlanDraft
  // because it clears the state they own — above them, resetEphemeral and setDraft are not yet
  // declared.
  // ⚠️ The ASPECT is no longer seeded here, and deliberately: this effect is keyed on the Modul
  // SLOT, which does not change when the operator switches Einsatzobjekt — so the seed never ran
  // for the new building and the previous one's shape carried over into its fit. It is reseeded
  // per SHEET now (components/useMeasuredSheet), which covers a plan switch as well.
  // ⚠️ The VIEW is no longer reset here: useBoardView restores the plan's remembered zoom/pan
  // (falling back to fit on a first visit), and a reset here would run after it and undo it.
  useEffect(() => {
    setSelId(null); setSelIds([]); setEditId(null); setDraft(null); setPending(null)
    resetEphemeral() // the calibrate state usePlanMeasure owns
    if (tool === 'symbol') setTool('pan')
    // Leaving the DOCUMENT (plan switch, or unmounting the whole surface) is a tap-away too
    // (A6, 29.08.). Through releaseRef, because this cleanup's own closure is from the render
    // the document was OPENED in, when the draft did not exist yet — the ref, re-pointed every
    // commit and read before any new effect runs, still holds the old document's closure, so
    // the auto-commit lands on the sheet the shape was actually drawn on.
    return () => releaseRef.current(prevTool.current, { ask: false })
  }, [activeId]) // eslint-disable-line react-hooks/exhaustive-deps
  // re-point the leave-document release every commit (see releaseRef above for why a ref), and
  // release on a TOOL change — below usePlanDraft, whose commit machinery the release is.
  useEffect(() => { releaseRef.current = releaseDraft })
  useEffect(() => {
    const from = prevTool.current
    prevTool.current = tool
    if (from !== tool) releaseDraft(from)
    // …and a half-dragged cordon goes with the tool: its overlay unmounts with it, so nothing
    // would ever end the gesture and the preview ring would hang on the sheet
    if (from !== tool) setCircleDraft(null)
  }, [tool]) // eslint-disable-line react-hooks/exhaustive-deps

  // --- drag-to-rotate / resize / the Rotation's ends and its claim ring — components/useWbRotor ---
  // (above the create tools, which claim through it)
  const rotor = useWbRotor({
    tool, readOnly, annos, boardRef, inkTap, toNorm, localY, mapY, sW, rotN, pushPast, patch, emit, activeId, onStepEnd,
  })
  const { rotMagnet, clearRotMagnet, rotDown, rotMove, rotUp } = rotor

  // --- create-tool interactions (on the ink overlay) — components/usePlanCreate ---
  const { inkDown, inkMove, inkUp, placeTeamChip, doorGhost, clearDoorGhost } = usePlanCreate({
    tool, setTool, pending, setPending, pendingShape, setPendingShape, placeLock, setPaletteOpen, readOnly, stack,
    toNorm, floorAt, localY, mapY, sW, sH, tileAR, scale, posRef, scaleRef, applyView, zoomTo, canvasRef, boardRef, inkTapRef: inkTap,
    planDraft, rotor, measure: planMeasure, rotPlacing, rotStart, setRotStart, rotN, noteDefaults, txtBase, setNotePanelId, setNotePlacedId,
    sym, onRecent, annos, trupps, placedTeamNames, onLinkTrupp, setTruppPick, add, log, setSelId,
    tapZoomPress: (e, allow) => tapZoomPress(e, allow),
    tapZoomOwns: (id) => tapZoomOwns(id),
  })

  // --- the ink's body drags: a stroke, an Absperrkreis, a Linie's label — components/useWbBodyDrag ---
  // the storey tile a move would drop its selection onto – lit while the drag is over it
  const [dropFloor, setDropFloor] = useState<number | null>(null)
  const { drawDrag, drawDown, drawMove, drawUp, circleDrag, circleDown, circleMove, circleUp, labelDown, labelMove, labelUp } = useWbBodyDrag({
    tool, readOnly, annos, setAnnoTap, setSelId, setSelIds, boardRef, boardPts, moveRigid, localY, mapY, stack, floorAt, floorsTTB, setDropFloor, pushPast, patch, emit, activeId, snapMove: snapMoveOf,
  })

  // --- vertex editing of a selected line/area and of the in-progress node draft (drag a node,
  // insert on a segment, delete a node, grow an end, take the stairs) — components/useWbVertexEdit.
  // ⚠️ Called HERE, where the handlers used to be defined: everything it reads is declared above,
  // except centerOnPoint (further down), which is handed over as a lazy wrapper.
  const {
    vertDrag, draftVert, vertDown, vertMove, vertUp, climbLine, extendLine, insertVertex, deleteVertex,
    draftVertDown, draftVertMove, draftVertUp, draftInsert, draftDeleteVertex,
  } = useWbVertexEdit({
    annos, selId, tool, readOnly, stack, toNorm, localY, floorAt, mapY, sW, sH,
    resolvedPts, attachmentLines, planCandidatesAt, pushPast, patch, patchCommit, emit, activeId,
    onLineAttached, onLineDetached, planEndpointDrag, setPlanEndpointDrag, planDwellTimerRef: planDwellTimer,
    allFloorsTTB, revealFloor, centerOnPoint: (x, y, floor, atScale) => centerOnPoint(x, y, floor, atScale), scaleRef,
    draftFloor: draftFloorRef, setDraft, tileAR, snapWallVertex, snapDraftVertex,
  })

  // --- chip dragging (resource / symbol / text in pan mode) — components/useWbChipDrag ---
  const { chipDrag, chipDown, chipMove, chipUp } = useWbChipDrag({
    tool, readOnly, annos, editId, setSelId, setSelIds, setNotePanelId, toNorm, stack, floorAt, localY, mapY, sW, sH, tileAR,
    attachmentLines, pushPast, set, patch, emit, activeId, onLinkLineTrupp,
  })

  // object-manipulation hand-off for the stage dispatcher in useBoardGestures: when no
  // pan/pinch/marquee gesture owns the pointer, route move/up to the active chip/draw/vertex
  // drag (each no-ops if its ref is null — same fall-through the inline dispatcher had).
  const manipMove = (e: React.PointerEvent) => {
    if (chipDrag.current) chipMove(e)
    else if (circleDrag.current) circleMove(e)
    else if (drawDrag.current) drawMove(e)
    else if (vertDrag.current) vertMove(e)
    else if (draftVert.current) draftVertMove(e)
    else if (measDragging()) measMove(e)
    // once an object is really travelling (past the shared deadzone), the phone detail sheet
    // peeks down to its grip line so the board isn't reduced to a strip — lib/sheetPeek
    if (chipDrag.current?.moved || circleDrag.current?.moved || drawDrag.current?.moved || vertDrag.current?.moved) beginSheetPeek()
  }
  const manipUp = () => { endSheetPeek(); chipUp(); circleUp(); drawUp(); vertUp(); draftVertUp(); measUp(); onStepEnd?.() }

  // pan / pinch-zoom / marquee multi-select + the shared stage pointer dispatcher live in
  // useBoardGestures; object manipulation is reached through manipMove/manipUp above.
  const { marquee, stageDown, stageMove, stageUp, trackDown, trackUp, tapZoomPress, tapZoomOwns } = useBoardGestures({
    tool, annos, setSelId, setSelIds, setTool, applyView, zoomTo, scaleRef, posRef, canvasRef, boardRef, mapY, manipMove, manipUp,
  })


  // the ONLY way a position is recorded: stamp the current spot + time into the trail
  const markPosition = () => {
    const a = annos.find((x) => x.id === selId)
    if (!a || a.kind !== 'resource') return
    const now = formatTime(new Date(serverNow()))
    patchCommit(a.id, { t: now, trail: [...(a.trail ?? []), { x: a.x ?? 0, y: a.y ?? 0, floor: a.floor ?? 0, t: now }] })
    // «Position markieren» names a PLACE, so on a stack it names the storey too — a row that
    // says only «Trupp 3: Position markiert» cannot be read back as a position at all
    const where = stack ? ` · ${floorLabel(a.floor ?? 0)}` : ''
    log('flag', fillTemplate(appConfig.copy.whiteboard.positionMarked, { name: a.text ?? '' }) + where, { kind: 'team', annoId: a.id, x: a.x, y: a.y, floor: a.floor ?? 0 })
    // no toast (20.09.2026): the dot lands under the finger and the Verlauf has the row
  }
  const clearTrail = async () => {
    const a = annos.find((x) => x.id === selId)
    if (!a || a.kind !== 'resource' || !a.trail?.length) return
    // confirm first — one mis-tap must not silently wipe the recorded Truppverfolgung (Lage parity)
    const ok = await confirmDialog({
      title: appConfig.copy.whiteboard.clearTrail,
      message: fillTemplate(appConfig.copy.whiteboard.clearTrailConfirm, { name: a.text ?? '', n: a.trail.length }),
      confirmLabel: appConfig.copy.remove, cancelLabel: appConfig.copy.cancel, danger: true,
    })
    if (!ok) return
    patchCommit(a.id, { trail: [] })
    log('cross', fillTemplate(appConfig.copy.whiteboard.trailCleared, { name: a.text ?? '' }))
  }
  // ⚠️ No recolouring of a team chip any more (04.09.): a colour is changed on the Karte's
  // marker or not at all, so there is nothing here to write and nothing to carry to the card.

  /**
   * «Gelöscht / erledigt» on the plan (lib/objectDone) — the same prop edit the Karte makes
   * (IncidentWorkspace · setEntityDone): one checkpoint on this plan's history, the `board.edit`
   * audit event (`done: null` for «Wieder aktiv», which JSON would otherwise drop), the write-
   * through onto the map body through the store fold, and ONE Verlauf row, with the storey the
   * symbol stands on — on the Gebäude that is its tile (or its Von/Bis span).
   */
  const setAnnoDone = (a: BoardAnno, on: boolean) => {
    if (readOnly) return
    const from = stack ? a.floorFrom ?? a.floor ?? 0 : a.floorFrom ?? a.storey
    const act = doneAct(a, on, {
      atIso: serverNowIso(), by: authorName,
      place: donePlace(from, stack ? a.floorTo ?? from : a.floorTo),
      // this sheet's view — a projected Karte symbol has no anno in the recorded board, and the
      // event folds to nothing there, while its `entity.edit` greys the map view (lib/objectDone)
      sheetPlanId: activeId,
      cat: sym.symbols.find((x) => x.name === a.symbol)?.cat,
    })
    if (!act) return
    onStepLabel?.(act.text) // the ↶ says «Feuer EG gelöscht», the Karte's way, not «Plan …»
    commit(annos.map((x) => (x.id === a.id ? { ...x, done: act.done } : x)))
    for (const [op, payload] of act.events) emit(op, payload)
    log(on ? 'check' : 'undo', act.text, { annoId: a.id, x: a.x, y: a.y, floor: a.floor })
  }

  const planWorkRect = (canvas: DOMRect, panelEl?: Element | null): NudgeBox => {
    // The default fitted view already reserves these permanent lanes; use the same geometry for
    // focus so “centre” never means underneath a rail or the floating top bar.
    const surface = {
      minX: canvas.left + side.l, maxX: canvas.right - side.r,
      minY: canvas.top + TOP_INSET, maxY: canvas.bottom - botRes,
    }
    if (!panelEl) return visibleWorkRect(surface, null, false)
    const panel = panelEl.getBoundingClientRect()
    if (!panel.width) return visibleWorkRect(surface, null, false)
    const obstruction = { minX: panel.left, maxX: panel.right, minY: panel.top, maxY: panel.bottom }
    return visibleWorkRect(surface, obstruction, isBottomSheet(panel.width, canvas.width))
  }

  // pan (no zoom change) so a normalized plan point lands at the centre of the unobscured work area
  /**
   * Move a whole Leitung to another Geschoss — the «Geschoss» stepper in its detail sheet.
   *
   * ⚠️ It used to patch `anno.floor` alone, and on the stack that changes NOTHING: every vertex
   * of a line drawn here carries its own storey (`pts[i][2]`, stamped at draw time) and the
   * renderer reads the point before the anno. The stepper stepped, the sheet said the new storey,
   * and the hose stayed where it was (Bastian, 17.09.2026).
   *
   * Every vertex moves by the SAME step, so a Leitung that climbs keeps its climb. A step that
   * would take any vertex off the building is refused; a storey the building does not have is
   * resolved to the next one it does (a pack with EG and +2 steps straight from one to the
   * other), and a folded-away target is unfolded, because a hose that moved somewhere invisible
   * has simply gone missing.
   */
  const moveLineToStorey = (id: string, to: number | undefined) => {
    if (to == null || readOnly) return
    const a = annos.find((x) => x.id === id)
    if (!a?.pts?.length) return
    const from = a.pts[0][2] ?? a.floor ?? 0
    const target = storeyTowards(allFloorsTTB, from, to)
    if (target == null) return
    const delta = target - from
    const moved = a.pts.map(([x, y, f]): BoardPoint => [x, y, (f ?? a.floor ?? 0) + delta])
    if (moved.some((p) => !allFloorsTTB.includes(p[2] as number))) return
    revealFloor(target)
    patchCommit(id, { floor: from + delta, pts: moved })
  }

  const centerOnPoint = (x: number, y: number, floor: number, atScale?: number) => {
    const s = atScale ?? scaleRef.current, w = fit.w * s, h = fit.h * s
    const canvas = canvasRef.current?.getBoundingClientRect()
    if (!w || !h || !canvas) return
    const my = mapY(floor, y)
    const target = rectCenter(planWorkRect(canvas, document.querySelector('.ctx')))
    const baseX = canvas.left + canvas.width / 2 + (side.l - side.r) / 2
    const baseY = canvas.top + canvas.height / 2 + vShift
    applyView(s, {
      x: target.x - baseX - (x - 0.5) * w,
      y: target.y - baseY - (my - 0.5) * h,
    })
  }

  // keep the tapped object visible: the shared .ctx editor overlay covers the right band of
  // the stage — same minimal nudge as the Lage map (parity), see lib/panelNudge. Keyed on the
  // selection id only so moving the chip/symbol never re-triggers a pan; the rAF lets the
  // panel mount so its real rect is measured. boardRef's rect already reflects the layout
  // zoom, so an anno's viewport point is a plain lerp over it.
  useEffect(() => {
    if (!selId) return
    const raf = requestAnimationFrame(() => {
      const a = annos.find((x) => x.id === selId)
      const rect = boardRef.current?.getBoundingClientRect()
      const canvas = canvasRef.current?.getBoundingClientRect()
      const panelEl = document.querySelector('.ctx')
      if (!a || !rect?.width || !canvas || !panelEl) return
      const work = planWorkRect(canvas, panelEl)
      // anchored annos (symbol/text/resource) give one point; a draw/area gives its whole
      // vertex set — the box nudge clears the full extent (map parity), capped so an
      // extent wider than the open area never slides fully off the stage.
      const norm: BoardPoint[] = a.pts?.length ? a.pts : a.x != null && a.y != null ? [[a.x, a.y]] : []
      if (!norm.length) return
      const pts = norm.map(([px, py, pf]) => ({ x: rect.left + px * rect.width, y: rect.top + mapY(pf ?? a.floor, py) * rect.height }))
      const box = {
        minX: Math.min(...pts.map((p) => p.x)), maxX: Math.max(...pts.map((p) => p.x)),
        minY: Math.min(...pts.map((p) => p.y)), maxY: Math.max(...pts.map((p) => p.y)),
      }
      // a note text box is anchored at its CENTRE but occupies a real width — nudging on the
      // anchor alone would leave the long half of a wide note sitting under the panel
      if (a.kind === 'text') {
        const half = (noteWN(a.wN) * rect.width) / 2
        box.minX -= half; box.maxX += half
      }
      const tap = annoTap?.id === selId ? { x: annoTap.x, y: annoTap.y } : null
      const nudge = nudgeSelectionIntoRect(box, tap, work)
      if (nudge) applyView(scaleRef.current, { x: posRef.current.x - nudge[0], y: posRef.current.y - nudge[1] })
    })
    return () => cancelAnimationFrame(raf)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selId, notePanelId])


  // report the current view centre (tile-local x/y + floor) upward so the journal
  // composer can pin an entry to "here" on the plan. Cheap — just a ref write.
  useEffect(() => {
    if (!fit.w || !fit.h) return
    const s = scaleRef.current, w = fit.w * s, h = fit.h * s
    const nx = clamp01((w / 2 - pos.x) / w), ny = clamp01((h / 2 - pos.y) / h)
    const floor = stack ? floorAt(ny) : 0
    onView?.({ x: nx, y: stack ? localY(ny, floor) : ny, floor })
  }, [pos, scale, fit.w, fit.h, activeId, stack, N]) // eslint-disable-line react-hooks/exhaustive-deps

  // a Verlauf row asked to revisit a plan point. Apply once per request (tracked
  // by nonce); if it arrives mid mode-switch before the stage is measured, the
  // fit deps re-run this once fit lands. Declared after the activeId reset effect
  // so it wins when both fire in the same render.
  const appliedFocus = useRef(0)
  // `focus.flash` asks to SHOW an anno rather than open it: outlined for a few seconds, nothing
  // selected. «Leitung zeigen» on an Atemschutz card uses it — the operator wants to know where
  // the hose is, not to edit it, and a selected line puts draggable nodes under their finger.
  const [flashId, setFlashId] = useState<string | null>(null)
  useEffect(() => {
    if (!focus || focus.nonce === appliedFocus.current || !fit.w || !fit.h) return
    setTool('pan')
    if (focus.annoId && focus.flash) setFlashId(focus.annoId)
    else if (focus.annoId) setSelId(focus.annoId)
    // ⚠️ No twin branch any more: a Karte object shown on this sheet IS an anno with the same
    // id, so «zeigen» finds it through `focus.annoId` like anything else the sheet draws.
    // Selection mounts its panel as state settles. Measure on the next frame so an explicit
    // “show” centres in the space that remains visible, not under the newly opened panel.
    requestAnimationFrame(() => centerOnPoint(focus.x, focus.y, focus.floor))
    appliedFocus.current = focus.nonce
  }, [focus, fit.w, fit.h]) // eslint-disable-line react-hooks/exhaustive-deps
  // the outline fades out on its own — it is a pointing gesture, not a state
  useEffect(() => {
    if (!flashId) return
    const t = setTimeout(() => setFlashId(null), appConfig.drawing.flashMs)
    return () => clearTimeout(t)
  }, [flashId])

  // the Durchgang on the Gebäude stack places «mehrere» by default: 20 doors are 20 taps (owner, 27.10.2026)
  const pickSymbol = (name: string) => {
    setPending(name); setPendingShape(null); setTool('symbol'); setPaletteOpen(false); onRecent(name)
    if (stack && name === DOOR_SYMBOL) setPlaceLock(true)
  }
  const pickShape = (kind: ShapeKind) => { setPendingShape(kind); setPending(null); setTool('shape'); setPaletteOpen(false) }
  /**
   * ⚠️ The Plan has no Ebenen of its own any more (15.09.2026). It used to share the slot with
   * the selected object's details — the layer list said which projection that object belonged to
   * — but the unified object model took the plan's twin rows away (`planRasterRows` is the
   * Karte's alone), and the panel has been an empty room ever since: the rail's button opened
   * nothing at all, and on a phone it hid the detail panel to do it. Either a section lists
   * something or it is not in the sidebar — so the button is gone, and the detail slot is the
   * plan's whole business. `tool === 'pan'` remains the long-standing selection-only gate.
   */
  const editorSlotFree = tool === 'pan'
  // a selected plan symbol gets the SAME editor as the map (label / fields / notes /
  // count / rotation) — floor is omitted because on the plan it's the tile, not a badge
  const selSymbol = annos.find((a) => a.id === selId && a.kind === 'symbol')
  // A note reaches the SAME ContextPanel, and since 29.08. a TAP opens it (chipDown) — the
  // symbol grammar, on both surfaces. `notePanelId` stays separate from `selId` for the one
  // exception: a freshly PLACED note goes straight into typing without the panel in the way.
  const selNote = annos.find((a) => a.id === notePanelId && a.kind === 'text')
  // …and closes on the Karte's three rules: deselected, a tool armed, the placed mark spent
  useNotePanelClosing({ selectedId: selId, tool, rest: 'pan', notePanelId, setNotePanelId, notePlacedId, setNotePlacedId })
  // a selected stroke / Linie / Fläche — drives the shared DrawEditor (style + presets) panel
  // ⚠️ 'circle' rides along: an Absperrkreis is styled, locked, measured and deleted through the
  // same DrawEditor as a Linie/Fläche (the Karte does exactly this — MapView · editDraw). It is
  // the one member with no `pts`, so every geometry path below asks for them before using them.
  const selDraw = annos.find((a) => a.id === selId && (a.kind === 'draw' || a.kind === 'area' || a.kind === 'circle'))
  /** The selected Absperrkreis's radius in REAL metres — only once the sheet is calibrated
   *  against its printed Maßstab (lib/planScale · circleRadiusM). Undefined on an uncalibrated
   *  Kroki, which is what keeps the editor's metre stepper and its subtitle away (DrawEditor). */
  const selCircleM = selDraw?.kind === 'circle' && calibrated && activeScale
    ? circleRadiusM(selDraw.radiusN ?? 0, activeScale.mPerU, measureAR)
    : undefined
  /** The selected line/Fläche AS AN EDIT TARGET — null whenever the surface may not be written.
   *  Read-only never gets handles, the same rule the Karte states at MapView · editDraw: grips
   *  that look grabbable but move under the finger and snap back are the worst kind of 3am lie.
   *  ⚠️ `readOnly` here is BROADER than the onChange guard upstream (tacticalLocked alone), so on
   *  a phone with the Verlauf open these handles did not merely lie — they wrote. */
  const editDraw = readOnly ? undefined : selDraw
  // Explicit detach for a plan line endpoint (the × chip on the canvas + the Verbindung lösen button
  // in the editor both call this) — materialize the endpoint at its resolved point, drop the link.
  const detachPlanEndpoint = (endpoint: LineEndpoint) => {
    if (readOnly || !selDraw?.pts?.length) return
    const a = endpoint === 'start' ? selDraw.startAttachment : selDraw.endAttachment
    if (!a) return
    // resolved endpoint (where it visually sits, on the target)
    const resolved = renderAnnos.find((x) => x.id === selDraw.id)?.pts ?? selDraw.pts
    const idx = endpoint === 'start' ? 0 : selDraw.pts.length - 1
    const here = resolved[idx] ?? selDraw.pts[idx]
    const nb = resolved[endpoint === 'start' ? 1 : resolved.length - 2] ?? here
    // retract ~0.02 board units toward its own body so it visibly pops off the target
    const dx = nb[0] - here[0], dy = nb[1] - here[1], len = Math.hypot(dx, dy) || 1
    const off: BoardPoint = [here[0] + (dx / len) * 0.02, here[1] + (dy / len) * 0.02, here[2] ?? selDraw.floor ?? 0]
    const pts = selDraw.pts.map((p, i): BoardPoint => (i === idx ? off : p))
    patchCommit(selDraw.id, { pts, ...(endpoint === 'start' ? { startAttachment: undefined } : { endAttachment: undefined }) })
    onLineDetached?.(selDraw.id, a)
  }
  // a selected generic shape — colour via the same ShapeEditor sheet as the Lage map
  const selShape = annos.find((a) => a.id === selId && a.kind === 'shape')

  // --- the selection bar's transform target — components/useWbSelectionBar -----------------
  const { barIds, barActive, barMove, barRotate, barDone, barCanRotate, barTurn, arm } = useWbSelectionBar({
    tool, readOnly, georefArmed, annos, selIds, editDraw, selShape, setSelId, setSelIds, setNotePanelId, setEditId, setAnnoTap,
    sW, sH, mapY, localY, boardPts, moveRigid, stack, floorAt, floorsTTB, setDropFloor, snapMove: snapMoveOf, pushPast, set, emit, activeId, boardRef, canvasRef, onStepEnd,
  })
  // --- removing objects: with their coupled Leitungen, with a Trupp's trail, a group, the Delete
  // key — components/usePlanRemoval
  const { removeWithConnections, removeWithTrail } = usePlanRemoval({
    readOnly, annos, renderAnnos, selId, setSelId, selIds, setSelIds, barIds, removeAnno, commit, emit, log, activeId, onTrailDrop,
  })

  /**
   * «Richtung umkehren» on the plan — the twin of the Lage's useMapDrawing · reverseDrawing, built
   * on the SAME rule (lib/lineAttachments · flipLine): the point order turns around so the
   * Abschluss and the end tag move to the other end, the drawn line stays exactly where it is, and
   * every attachment — this line's own two AND every other line hooked to one of its ends — keeps
   * the coordinate it was sitting on. One `commit` = one undo step for all of it.
   * (The end tag's own nudge, `endDx`/`endDy`, is a RELATIVE offset from wherever the tag belongs,
   * so unlike the Lage's absolute `endLabelAt` it survives the flip unchanged.)
   */
  const reverseAnno = () => {
    if (!selDraw?.pts || selDraw.pts.length < 2 || selDraw.kind !== 'draw') return
    const lines = annos.filter((a) => a.kind === 'draw' && (a.pts?.length ?? 0) >= 2)
      .map((a) => ({ id: a.id, points: a.pts!, startAttachment: a.startAttachment, endAttachment: a.endAttachment }))
    const flip = flipLine({ id: selDraw.id, points: selDraw.pts, startAttachment: selDraw.startAttachment, endAttachment: selDraw.endAttachment }, lines)
    commit(annos.map((a) => {
      if (a.id === selDraw.id) return { ...a, pts: flip.points, startAttachment: flip.startAttachment, endAttachment: flip.endAttachment }
      const mine = flip.incoming.filter((i) => i.lineId === a.id)
      return mine.reduce((acc, i) => ({ ...acc, [i.endpoint === 'start' ? 'startAttachment' : 'endAttachment']: i.attachment }), a)
    }))
    emit('board.edit', { id: selDraw.id, patch: wireFreed({ pts: flip.points, startAttachment: flip.startAttachment, endAttachment: flip.endAttachment }), planId: activeId })
    flip.incoming.forEach((i) => emit('board.edit', { id: i.lineId, patch: { [i.endpoint === 'start' ? 'startAttachment' : 'endAttachment']: i.attachment }, planId: activeId }))
  }

  const changePlanEnding = async (ending: LineEnding) => {
    if (!selDraw) return
    const incoming = selDraw.teilstueck && ending !== 'teilstueck' ? annos.flatMap((a) => (['start', 'end'] as const).filter((endpoint) => {
      const rel = endpoint === 'start' ? a.startAttachment : a.endAttachment
      return rel?.target.kind === 'line' && rel.target.id === selDraw.id && rel.target.endpoint === 'end'
    }).map((endpoint) => ({ id: a.id, endpoint }))) : []
    if (incoming.length) {
      const ok = await confirmDialog({ title: appConfig.copy.drawingEditor.endingTeilstueck, message: fillTemplate(appConfig.copy.drawingEditor.removeEMessage, { n: incoming.length }), confirmLabel: appConfig.copy.remove, cancelLabel: appConfig.copy.cancel, danger: true })
      if (!ok) return
    }
    const resolved = renderAnnos.find((a) => a.id === selDraw.id)?.pts
    const fallback = resolved?.[resolved.length - 1] ?? selDraw.pts?.[selDraw.pts.length - 1]
    // the ends that hung on the «E» let go where it stood — one patch per line, both ends in it,
    // applied here and sent as ONE board.edit (lib/lineAttachments · detachAnnos)
    const released = fallback
      ? detachAnnos(annos.filter((a) => a.id !== selDraw.id), (a, endpoint) => (incoming.some((x) => x.id === a.id && x.endpoint === endpoint) ? fallback : null))
      : new Map<string, AnnoDetachPatch>()
    commit(annos.map((a) => (a.id === selDraw.id
      ? { ...a, arrow: ending === 'arrow' || ending === 'arrowStop' || undefined, arrowStop: ending === 'arrowStop' || undefined, teilstueck: ending === 'teilstueck' || undefined }
      : withDetach(a, released))))
    emit('board.edit', { id: selDraw.id, patch: endingWireFlags(ending), planId: activeId })
    released.forEach((patch, id) => emit('board.edit', { id, patch: wireFreed(patch), planId: activeId }))
  }


  /** «Art: Linie | Wand» in the line editor (round 3; on every sheet since 28.10.2026, round 4 –
   *  the Karte has the same row): the drawn line becomes a Wand or a Linie again – one patch, one
   *  ↶, one board.edit (lib/grundriss · wallRolePatch); its Durchgänge let go in the board funnel.
   *  A Trupp on the line, or a line that climbs storeys, keeps it a Linie (lib/grundriss ·
   *  wandBlock; the editor disables «Wand»). No Verlauf row – a sheet's line edits are silent. */
  const setWallRole = (a: BoardAnno, wand: boolean) => {
    if (readOnly || wand === (a.role === 'wand') || (wand && wandBlock(a, trupps, a))) return
    // a Teilstück with lines on its «E» stays one – letting go of them is the Abschluss row's ask
    const hung = !!a.teilstueck && annos.some((x) => [x.startAttachment, x.endAttachment].some((r) => r?.target.kind === 'line' && r.target.id === a.id && r.target.endpoint === 'end'))
    const p = wallRolePatch(a, wand, GRUNDRISS_STYLE.wand, INK_DEFAULTS, hung)
    patchCommit(a.id, p, { patch: wallRoleWire(p) })
  }

  // removing a storey: the confirm is the OWNER's (workspace/useGebaeudeActions · removeFloor →
  // lib/storeyRemoval), because only the store knows which annos on this tile are the stack's own
  // and which are the Karte's, merely shown here — and only the own ones can be lost
  /** a storey's word on its label («4. OG», «EG», or the name the Gebäude gave it) */
  const storeyName = (f: number) => building?.floorNames?.[String(f)] ?? floorLabel(f)
  /** a custom name («Hauptebene») hides the storey's order, so its label brings the signed chip */
  const customStorey = (f: number) => {
    const own = building?.floorNames?.[String(f)]?.trim()
    return !!own && own !== floorLabel(f)
  }
  const removeFloor = (f: number) => {
    if (readOnly || building?.pack || floorPack?.tiles[f]) return
    onRemoveFloor(f)
  }
  // «Kopieren nach …» (27.10.2026): the storey whose label menu asked, and the act itself – the
  // storey's Grundriss as independent copies on every picked storey, ONE commit = one ↶
  const [copyFrom, setCopyFrom] = useState<number | null>(null)
  const isGebaeudeSymbol = (name: string) => sym.symbols.some((x) => x.name === name && x.cat === GEBAEUDE_CATEGORY)
  const copyStorey = (from: number, targets: number[]) => {
    if (readOnly) return
    // top to bottom, the way the stack and the chips read
    const order = allFloorsTTB.filter((f) => targets.includes(f))
    const { added, counts } = copyGrundriss(annos, from, order, isGebaeudeSymbol, newId)
    const C = appConfig.copy.whiteboard.storeyCopy
    // everything the source holds is already on the picked storeys (a Treppe spanning them):
    // the sheet still closes, but never without a word
    if (!added.length) { toast(C.nothingNew); return }
    commit([...annos, ...added])
    added.forEach((a) => emit('board.add', { id: a.id, anno: a, planId: activeId }))
    toast(fillTemplate(C.done, { list: counts.map((c) => fillTemplate(C.doneItem, { n: c.n, floor: storeyName(c.floor) })).join(' · ') }))
  }

  // footprint draw box per floor tile: fill most of the tile, preserving the
  // building's true aspect (the SVG inside stretches the 0..1 ring to this box).
  // Mirror of lib/footprint · fpBoxFrac (kept here in px for layout).
  const fpBox = (() => {
    if (!stack || !fpView) return null
    const tileH = sH / N
    const availW = sW * BOX_W, availH = tileH * BOX_H
    let w = availW, hgt = availW * fpView.aspect
    if (hgt > availH) { hgt = availH; w = availH / fpView.aspect }
    return { w, h: hgt }
  })()

  /** The building outline of storey `f` as rings in board px — laid as the <FloorPage> tiles lay
   *  their footprint box (centred in the tile, lib/storeyClip · storeySections). What the
   *  Grundriss snap catches (usePlanDraft); none for a pack, whose frame is no outline. */
  const stackOutlinePx = (f: number): [number, number][][] => {
    const idx = floorsTTB.indexOf(f)
    if (!stack || !fpBox || !building || building.pack || idx < 0) return []
    const tileH = sH / N, bx = (sW - fpBox.w) / 2, by = idx * tileH + (tileH - fpBox.h) / 2
    return (fpView?.rings ?? building.rings ?? [building.ring]).map((ring) => ring.map(([u, v]): [number, number] => [bx + u * fpBox.w, by + v * fpBox.h]))
  }

  /** Each drawn storey's VISIBLE SECTION in board px (lib/storeyClip, 24.09.2026): the drawings the
   *  tile shows — laid exactly as the <FloorPage>s below lay them — cut to the footprint box, or
   *  the whole tile where there is no Geschossplan. Ink, Flächen and Absperrkreise are cut to it
   *  and wear an edge mark where they leave; a Karte hose no longer runs through the blank band
   *  into the next storey's plan. Null off the stack. */
  const sections = stack && building && sW && sH ? storeySections({
    floorsTTB, sW, sH, box: fpBox,
    drawings: (f) => {
      const parts = floorPack?.tiles[f]
      if (!parts?.length || !fpBox) return []
      if (building.pack) return packView ? parts.map((tile) => regionCorners(packPagePlacement(packView, building.pack!.aspect, tile), tile.clip)) : []
      const corners = floorPack?.fit && building.src?.length ? pagePlacement(building, shownAngle, floorPack.fit) : null
      return corners ? [corners] : []
    },
  }) : null
  /** is a board-px point on its storey's visible section? (true off the stack) — what decides
   *  whether a line's arrowhead, tag, label or stair mark still has somewhere to stand */
  const onSection = (floor: number | undefined, p: [number, number]) => {
    const s = sections?.get(floor ?? 0)
    return !s || inSection(p, s)
  }
  /** The zones — Absperrkreise and Flächen — whose interior holds ALL of their paper: the storey's
   *  section on the stack, the whole sheet off it (lib/storeyClip · enclosesSection). Not drawn,
   *  nor labelled, nor lock-chipped: everything visible is inside them, so they say nothing here,
   *  and their wash only tinted the storey (the demo's 100 m Absperrkreis on the EG, 11.10.2026).
   *  The record is untouched — the Karte and the Objekte list still show them. */
  const paperZones = new Set(sW && sH ? renderAnnos.flatMap((a) => {
    if (!((a.kind === 'circle' && (a.radiusN ?? 0) > 0) || (a.kind === 'area' && (a.pts?.length ?? 0) >= 3))) return []
    const ring: [number, number][] = a.kind === 'circle'
      ? circleRing((a.x ?? 0) * sW, mapY(a.floor, a.y ?? 0) * sH, (a.radiusN ?? 0) * sW)
      : a.pts!.map(([x, y, f]) => [x * sW, mapY(f ?? a.floor, y) * sH])
    return enclosesSection(ring, sections?.get(a.floor ?? 0) ?? [rectPoly(0, 0, sW, sH)]) ? [a.id] : []
  }) : [])
  const drawnAnnos = paperZones.size ? renderAnnos.filter((a) => !paperZones.has(a.id)) : renderAnnos

  // Rotate the Gebäudeview to `toDeg`. Re-derives the footprint view and re-glues every
  // floor-stack annotation (x/y, freehand pts, team trails) so they stay on the same
  // real-world spot — see lib/footprint · remapPoint — and the VIEW with them (the pan at the
  // end). The single commit path: the north dial's popover, its slider and the two named-angle
  // chips inside it.
  const reorientTo = (toDeg: number) => {
    if (!building || !orientSrc || !onReorient || readOnly || !sW || !sH) return
    const fromDeg = viewAngle
    if (Math.abs(toDeg - fromDeg) < 0.01) return
    const view = buildView(orientSrc, toDeg)
    const layout = { boardW: sW, boardH: sH, floors: N }
    // …and the board the turn lands on: a pack's card follows its frame, so turning a flat frame
    // upright makes every storey band taller. The ink is stored against the box inside that band,
    // so the re-glue has to know both boards (lib/footprint · remapPoint).
    const nextTileAR = building.pack ? bandAspect(view.aspect) : tileAR
    const toLayout = { boardW: sW, boardH: sW * N * nextTileAR, floors: N }
    const mv = pointRemapper(orientSrc, fromDeg, toDeg, layout, toLayout)
    // where the view is looking, in tile coordinates, re-glued the same way (see the pan below)
    const anchor = (() => {
      const s = scaleRef.current, w = fit.w * s, h = fit.h * s
      if (!w || !h) return null
      if (s <= 1 && Math.abs(posRef.current.x) < 1 && Math.abs(posRef.current.y) < 1) return null
      const nx = clamp01((w / 2 - posRef.current.x) / w), ny = clamp01((h / 2 - posRef.current.y) / h)
      const floor = floorAt(ny)
      const [x, y] = mv([nx, localY(ny, floor)])
      return { x, y, floor }
    })()
    // ⚠️ the BEARINGS turn with the paper too (lib/stackFit · reorientBearings, 15.09.2026):
    // a stored rotation is relative to the sheet, and the sheet is what just moved. Without it
    // a Fahrzeug DRAWN on a tile stayed pointing where it was while the identical one placed
    // on the Karte — projected through the stack's fit — swung with the building. The same
    // re-glue drew the live preview while the slider was held (`previewAnnos`).
    const remapped = reorientAnnos(annos, { src: orientSrc, fromDeg, toDeg, layout, toLayout })
    commit(remapped) // re-glued annotations go through undo/redo + sync
    // `northUp` stays in sync (0° IS north-up) so pre-dial clients keep their binary read — on a
    // PACK it would be a lie (0° is the page as drawn, which is north-up only by luck), and the
    // rings would be the frame rectangle, which a pack deliberately has none of. Only the aspect
    // crosses over: it is what makes the tile box follow the turned frame.
    onReorient(building.pack
      ? { ...building, viewDeg: toDeg, ringAspect: view.aspect, tileAR: nextTileAR }
      : { ...building, viewDeg: toDeg, northUp: toDeg === 0, rings: view.rings, ring: view.rings[0], ringAspect: view.aspect })
    emit('building.reorient', { northUp: toDeg === 0, deg: toDeg, planId: activeId })
    // …and the VIEW is re-glued too. The board keeps its size through a rotation (a stack's
    // aspect is the floor count, not the footprint's — see effAspect), so the storey cards stay
    // centred in their tiles; what moves is the content INSIDE them, around the footprint's own
    // bbox centre. Zoomed in on one corner of the building, that swings the corner off the
    // screen. Take the point the operator is looking at, re-glue it exactly like an annotation,
    // and pan it back under their eyes. At the fitted view there is nothing to hold — the whole
    // stack is on screen and centred by definition — so that one is left alone.
    if (anchor) centerOnPoint(anchor.x, anchor.y, anchor.floor)
  }
  // ── rotation popover (30.08., replaces the A8 dial drag) ── a hidden drag on a 44px dial was
  // «hard to control»; the north dial now opens a small popover with a
  // degree SLIDER instead. Within ~5° of the two meaningful angles — north-up and the long
  // axis — the slider snaps, live in the preview (shownAngle) so the catch is visible before
  // release; the two named angles are also one-tap chips.
  const DIAL_SNAP_DEG = 5
  const normDeg = (d: number) => { let x = d % 360; if (x > 180) x -= 360; if (x <= -180) x += 360; return x }
  /** The angle that puts real north up. For an outline that is 0 by construction (`src` is stored
   *  north-up); for a PACK it is the negative of the page's own bearing, which only its approved
   *  map fit knows — without one there is no such angle, and no chip offering it. */
  const northUpDeg = building?.pack ? (floorPack?.fit ? normDeg(-floorPack.fit.rotationDeg) : null) : 0
  const snapDial = (d: number) => {
    const n = normDeg(d)
    for (const target of [0, orientDeg, northUpDeg]) {
      if (target != null && Math.abs(normDeg(n - target)) <= DIAL_SNAP_DEG) return target
    }
    return n
  }
  const commitOrient = (deg: number) => { setDialDragDeg(null); reorientTo(snapDial(deg)) }
  // ⚠️ The popover is portalled to <body>, but React bubbles its events through the COMPONENT
  // tree — for the north dial's door that is the board's canvas, whose pointerdown pans and takes
  // pointer capture. Captured, a chip's click landed on the canvas («Norden oben» did nothing with
  // a mouse, rarely something on the iPad) and the slider's drag panned the board. Nothing inside
  // the popover is the board's (24.09.2026).
  const orientControls = (
    <div className="wb-orient-pop" onPointerDown={(e) => e.stopPropagation()}>
      <div className="wb-orient-row">
        <span className="wb-orient-lbl" aria-hidden>{appConfig.copy.whiteboard.orientSliderLabel}</span>
        {/* ⚠️ a cancelled gesture (iOS: the touch became a scroll) or the popover closing drops
            the preview instead of leaving the backdrop turned uncommitted (24.09.2026) */}
        <OrientSlider
          value={Math.round(normDeg(dialDragDeg ?? viewAngle))}
          label={appConfig.copy.whiteboard.orientSliderLabel}
          onPreview={(deg) => setDialDragDeg(snapDial(deg))}
          onCommit={commitOrient}
          onAbandon={() => setDialDragDeg(null)}
        />
        <b className="wb-orient-val">{Math.round(normDeg(dialDragDeg ?? viewAngle))}°</b>
      </div>
      <div className="wb-orient-chips">
        {/* «Wie gezeichnet» is the pack's own 0°: the sheet as the architect drew it, which is a
            meaningful place to come back to and is NOT north-up (that is the chip beside it) */}
        {building?.pack && (
          <Chip className="wb-orient-chip" selected={normDeg(shownAngle) === 0}
            onClick={() => commitOrient(0)}>{appConfig.copy.whiteboard.orientAsDrawn}</Chip>
        )}
        {northUpDeg != null && (
          <Chip className="wb-orient-chip" selected={normDeg(shownAngle) === northUpDeg}
            onClick={() => commitOrient(northUpDeg)}>{appConfig.copy.whiteboard.orientNorthUp}</Chip>
        )}
        {Math.abs(orientDeg) > 0.001 && (
          <Chip className="wb-orient-chip" selected={normDeg(shownAngle) === normDeg(orientDeg)}
            onClick={() => commitOrient(orientDeg)}>{appConfig.copy.whiteboard.orientLongAxis}</Chip>
        )}
      </div>
    </div>
  )

  // WHICH object's plans these are, on the surface the plans are used — the one thing about a
  // plan set that cannot be read off any of its pages. It sits at the top-left of the stage,
  // beside the module tabs in the rail, so the tab strip and the name of what it lists are one
  // glance apart; it opens the same PlanPicker the [[O]] shortcut does. It is a floating chip
  // rather than a header row because the stage is deliberately full-bleed (the plan pans up
  // behind the top bar), and a solid bar would take that away from every plan to state
  // something that changes once an Einsatz.
  // It sits in the stage's BOTTOM-LEFT pill row beside the Maßstab and wears that pill, so the
  // two read-outs about «what am I looking at» share one corner — it used to be a hero-elevated
  // card in the TOP-left, stating from the corner of the plan that is actually looked at a thing
  // that changes once an Einsatz.
  // ⚠️ The READ-OUT and the SWITCH are two different things, and gating both on `onObjectSwitch`
  // meant the one session that is bound to a single object — a link-scoped viewer — was the only
  // one never told which object it is looking at. It reads either way; it is only tappable when
  // there is somewhere to tap to.
  // the ADDRESS, not the name: «Mühlemattstrasse 8» is shorter than «Schloss Bottmingen» and is
  // what the Einsatz is called by. The name is still what the picker and its toast say, because
  // that is where an object is searched for. Name is the fallback when there is no address.
  const objectChipName = objectAddress ?? objectName ?? appConfig.copy.whiteboard.objectNone
  // The chip is dropped whole on exactly two surfaces. The Gebäude tile (both faces — outline
  // picker and floor stack) already answers «welches Gebäude» with the chip right beside it,
  // which walks to the picker that changes it; the object read-out only repeated that in a
  // second pill nobody could act on. The blank Tafel has no plan for it to be about at all.
  // Everywhere else it stays: on a plan page nothing else names the object the sheet belongs to.
  // Field feedback 25.08.
  const objectChipHidden = osm || !!active.floorStack || active.id === 'tafel'
  // A nearby-only object (the nearest one with plans, not the Einsatzadresse) is a warning the
  // chip carries itself: amber, the warn glyph, and the distance after the address. Short on
  // the pill, the full sentence in the label – the chip only hints, the reader gets the meaning.
  const nearbyDist = objectNearby ? fmtDistance(objectNearby.distanceM) : null
  // «Schlossgasse 9, 4104 Oberwil» → the street and number on a phone (sweep 28.10.2026 #8): the
  // row is one line beside the FAB and the Messungen chip, and the town is in the sheet's row.
  const [objectStreet, objectTown] = splitAddress(objectChipName)
  const objectChipShort = isPhone && objectStreet ? objectStreet : objectChipName
  const objectChipText = nearbyDist
    ? fillTemplate(appConfig.copy.whiteboard.objectNearby, { name: objectChipShort, distance: nearbyDist })
    : objectChipShort
  const objectNearbyLabel = nearbyDist ? fillTemplate(appConfig.copy.whiteboard.objectNearbyLabel, { distance: nearbyDist }) : null

  // ── The Plan sheet behind the chip (sweep 28.10.2026 #8, owner pick «B's bar + A's sheet») ──
  // The row used to carry Objekt · «Ref. …» · «⌖ Karte»: two lamps for one subject, and on a phone
  // the object's name squeezed down to its glyph. Now the Objekt chip (on the Gebäude stack: the
  // building chip) is the row's ONE chip and carries ONE lamp – the worse of link and scale
  // (planScale · planFactsTone) – and a tap opens PlanFactsSheet: the Objekt row (its switch),
  // «Karte» with the Passung inline, «Massstab» with its state. Every tap the old chips offered is
  // in there: start the pairing, the Passung's actions, (re)calibrate.
  // The sheet's open state IS the Passung's (`qualityFor`), so «Deckung prüfen» / «Punkte
  // hinzufügen» come back to it (usePlanGeoref · returnToQuality) and Escape closes it.
  // ⚠️ What is offered follows the old chips' gates exactly. The Massstab: not on the OSM face, the
  // blank Tafel, a viewer document or for an Einsatz-Link viewer, and on a LOCKED surface (el,
  // Führungsansicht, replay – `readOnlyProp`, not `slimRail`: RBAC audit 22.10.2026) as a read-out.
  // The Karte: wherever a sheet can carry a reference (usePlanGeoref · georefChipShown – a locked
  // session only once it is linked). A locked session READS the sheet – the same words and tones,
  // none of the actions – because an unchecked automatic fit must never look like a checked one,
  // whoever looks (roles-and-access).
  const scaleShown = (!readOnly || (readOnlyProp && !selectOnly)) && active?.viewer !== true && !osm && !blank && !linkViewer
  const factsShown = scaleShown || georefChipShown
  const factsTone = planFactsTone(georefChipShown ? georefChipTone(georefState) : null, scaleShown ? scaleTone : null)
  const factsOpen = factsShown && georefQuality && !georefArmed
  const toggleFacts = () => setQualityFor(georefQuality ? null : activeId)
  const factsLamp = factsShown ? <span className="wb-lamp" data-tone={factsTone} aria-hidden="true" /> : null
  const objectChip = objectChipHidden ? null : (
    <button
      type="button"
      className={cx('wb-scale-chip wb-object', nearbyDist && 'wb-object-nearby', factsOpen && 'arm')}
      // «Objekt» named the field, which is the one thing the value already says — a plan set
      // belongs to an Einsatzobjekt and nothing else in this corner is a place name. No chevron:
      // the lamp says there is more behind it. The words a screen reader needs (the lamp is no
      // word) live in the label.
      aria-label={[
        factsShown ? fillTemplate(appConfig.copy.whiteboard.facts.chipLabel, { name: objectChipName })
          : fillTemplate(onObjectSwitch ? appConfig.copy.whiteboard.objectSwitch : appConfig.copy.whiteboard.objectIs, { name: objectChipName }),
        objectNearbyLabel,
      ].filter(Boolean).join(' – ')}
      aria-expanded={factsShown ? factsOpen : undefined}
      title={objectNearbyLabel ?? (!factsShown && onObjectSwitch ? appConfig.copy.whiteboard.objectSwitchShort : undefined)}
      // with nothing behind it but the object, the chip is the picker's door as before
      disabled={!factsShown && !onObjectSwitch}
      onClick={factsShown ? toggleFacts : onObjectSwitch}
    >
      <Icon id={nearbyDist ? 'warn' : 'footprint'} />
      <span>{objectChipText}</span>
      {factsLamp}
    </button>
  )
  // The Gebäude-Steckbrief's chip, beside the Objekt chip and only where that one stands with an
  // Objekt bound: these plans are of THAT building, and the Karte's row carries the same chip.
  // The floor stack and the Tafel drop it with the Objekt chip (`objectChipHidden`).
  // ⚠️ Not on a PHONE's plan (09.10.2026, measured at 390px): that row is one line beside the FAB
  // (09-whiteboard · .wb-botleft), and a hazard is glyph + WORD, so «⚠ Gas · PV» took the room the
  // Objekt chip's name needs — the name went down to its glyph, and «which object are these
  // plans of» stopped being answered. On a phone the Karte's row carries the chip, one tap away.
  // `compact`: it is the Objekt chip's second half (R1, 27.10.2026) – the hazard words alone
  // («⚠ Gas»), the glyph alone without one; the address beside it already says which building.
  const buildingFloat = !isPhone && !objectChipHidden && (objectName || objectAddress)
    ? <BuildingFloat info={buildingInfo ?? null} compact />
    : null


  // The banner half of the same warning (owner, 14.09.): the chip is permanent but small, and at
  // 3am a small amber pill is not a sentence. So the first time a plan of a merely-nearby object
  // is opened in this Einsatz, a banner over the sheet says both addresses side by side and
  // offers the picker. ✕ is remembered per Einsatz and object (lib/nearbyBanner) – after that
  // only the chip keeps saying it. Hidden where the chip is hidden: nothing there is that
  // object's plan.
  const bannerKey = objectNearby && incidentId ? nearbyBannerKey(incidentId, objectNearby.objectId) : null
  const [bannerGone, setBannerGone] = useState<string | null>(null)
  const nearbyBanner = bannerKey && nearbyDist && !objectChipHidden && bannerGone !== bannerKey && !nearbyBannerDismissed(bannerKey) ? (
    <div className="wb-nearby-banner" role="status">
      <Icon id="warn" />
      <span className="wb-nearby-text">
        <b>{appConfig.copy.whiteboard.nearbyBannerTitle}</b>{' '}
        {fillTemplate(appConfig.copy.whiteboard.nearbyBannerBody, { incident: incidentAddress || appConfig.copy.whiteboard.nearbyBannerNoAddress, object: objectChipName, distance: nearbyDist })}
      </span>
      {onObjectSwitch && (
        <button type="button" className="wb-nearby-switch" onClick={onObjectSwitch}>{appConfig.copy.whiteboard.objectSwitchShort}</button>
      )}
      <button
        type="button" className="wb-nearby-x" aria-label={appConfig.copy.closeDialog} title={appConfig.copy.closeDialog}
        onClick={() => { dismissNearbyBanner(bannerKey); setBannerGone(bannerKey) }}
      ><Icon id="close" /></button>
    </div>
  ) : null

  // ── The way between the two faces of the ONE «Gebäude» tile ────────────────────────────────
  // The rail lists one entry for the outline picker and the floor stack (lib/useObjectPlans ·
  // railPlanTiles), so «ich will ein anderes Gebäude» needs a door — and it belongs HERE, in the
  // row that already answers «was schaue ich an» (Objekt · Maßstab), not as a second rail tile
  // that would put the mechanism back in the navigation it was just taken out of.
  // Only ever shown on the two surfaces it is about, and only once there is somewhere to go:
  // on the stack it opens the picker, on the picker (with a stack behind it) it goes back.
  // Pure navigation — but only where the picker can be used (see `buildingChipLocked`). Replacing
  // the building is still the picker's own act, with its confirm-and-undo (IncidentWorkspace ·
  // onSelectBuilding); this chip only walks there.
  // ⚠️ On the STACK the pill reads the building's own NAME, not the verb (owner, 18.09.2026).
  // «Anderes Gebäude wählen» is an instruction, and the object read-out beside it is dropped on
  // exactly this surface (objectChipHidden) — so the one pill that could answer «which building
  // am I standing in» spent its whole width telling the operator what tapping it would do. The
  // name (the object's ADDRESS, name as fallback — the same string objectChip uses, because a
  // BuildingDoc carries no name of its own) plus a chevron says both: what this is, and that
  // the pill goes somewhere. The VERB stays in title/aria-label, so a screen reader and a
  // long-press still get the instruction that left the face.
  // On the picker face there is no stack to name yet — «Zurück zum Gebäude» is the whole point
  // of the pill there, and it keeps the never-truncating treatment (.wb-building).
  const buildingChipLabel = stack ? appConfig.copy.whiteboard.replaceBuilding : appConfig.copy.whiteboard.backToBuilding
  // …and with no object bound at all there is no name to show: the verb comes back, and with it
  // the never-truncating treatment, rather than a pill reading «Kein Objekt» about a building
  // that is plainly there.
  const buildingChipName = stack ? objectAddress?.trim() || objectName?.trim() || null : null
  // ⚠️ …but not for a session that cannot pick (25.09.2026, 3am test on staging): the picker face
  // is non-interactive under the lock (OsmOutline · interactive), so «Anderes Gebäude wählen» led
  // an `el` to outlines it could not tap and no «Übernehmen» — a door into a dead end. Locked, the
  // stack's pill is only the building's NAME as a read-out (the `.wb-object` recipe: disabled, not
  // greyed); with no name there is nothing to read and no pill. The picker face's «Zurück zum
  // Gebäude» stays for everyone: it is the way OUT.
  const buildingChipLocked = stack && readOnlyProp
  // ⚠️ On the stack the chip is ALSO the Plan sheet's door (sweep 28.10.2026 #8): the Objekt chip is
  // dropped there, so the building's name carries the lamp, and «anderes Gebäude wählen» is the
  // sheet's top row. Named by the plan's own word («Gebäude») when no object is bound – a verb on
  // a chip that opens a sheet would promise the wrong thing.
  const stackFacts = stack && factsShown
  // …and like the Objekt chip, street and number only on a phone (the town is in the sheet's row)
  const [buildingStreet, buildingTown] = splitAddress(buildingChipName)
  const buildingFactsName = buildingStreet || active.code
  const buildingChip = stackFacts ? (
    <button
      type="button"
      className={cx('wb-scale-chip wb-building wb-building-named', factsOpen && 'arm')}
      aria-label={fillTemplate(appConfig.copy.whiteboard.facts.chipLabelBuilding, { name: buildingChipName ?? active.code })}
      aria-expanded={factsOpen}
      onClick={toggleFacts}
    >
      <Icon id="footprint" />
      <span>{isPhone ? buildingFactsName : buildingChipName ?? active.code}</span>
      {factsLamp}
    </button>
  ) : onBuildingFace && (stack || (osm && building)) && !(buildingChipLocked && !buildingChipName) ? (
    <button
      type="button"
      className={`wb-scale-chip wb-building${buildingChipName ? ' wb-building-named' : ''}`}
      aria-label={buildingChipLocked ? buildingChipName! : buildingChipLabel}
      title={buildingChipLocked ? undefined : buildingChipLabel}
      disabled={buildingChipLocked}
      onClick={() => onBuildingFace(stack ? 'pick' : 'stack')}
    >
      <Icon id={stack ? 'footprint' : 'floors'} />
      <span>{buildingChipName ?? buildingChipLabel}</span>
      {buildingChipName && !buildingChipLocked && <Icon id="chevron" className="wb-chip-chev" />}
    </button>
  ) : null

  // …and the sheet itself: the place on top, then the two facts (PlanFactsSheet).
  const closeFacts = () => setQualityFor(null)
  const C = appConfig.copy.whiteboard
  const factsPlace = stack
    ? {
        icon: 'footprint', name: buildingFactsName,
        sub: [buildingTown, onBuildingFace && !buildingChipLocked ? C.facts.switchBuilding : null].filter(Boolean).join(' · ') || undefined,
        onClick: onBuildingFace && !buildingChipLocked ? () => { closeFacts(); onBuildingFace('pick') } : undefined,
      }
    : {
        icon: nearbyDist ? 'warn' : 'footprint', warn: !!nearbyDist, name: objectStreet || objectChipName,
        sub: [objectNearbyLabel ?? objectTown, onObjectSwitch ? C.facts.switchObject : null].filter(Boolean).join(' · ') || undefined,
        onClick: onObjectSwitch ? () => { closeFacts(); onObjectSwitch() } : undefined,
      }
  const factsLink: PlanFact | undefined = !georefChipShown ? undefined
    : georefState.kind === 'linked' && georefFit ? {
        tone: georefChipTone(georefState), status: C.georef.chipLinked,
        body: (
          <GeorefQuality
            embedded
            readOnly={readOnly}
            fit={georefFit}
            auto={hasAutoPairs(georefPairs)}
            approved={georefApproved}
            realPoints={realPairCount(georefPairs)}
            onClose={closeFacts}
            onAddPoint={() => beginGeoref({ returnToQuality: true })}
            // «Deckung prüfen» needs BOTH pictures on screen, which is exactly what the armed
            // split is — so the check arms the mode and comes up with the outline already drawn.
            onCheck={() => beginGeoref({ check: true, returnToQuality: true })}
            onTransfer={georefTransferTargets.length ? () => setGeorefTransferOpen(true) : undefined}
            onReset={() => { closeFacts(); resetGeorefPlan(activeGeorefKey); toast(C.georef.resetDone) }}
          />
        ),
      }
    : {
        // ⚠️ the verb, not an empty Passung: a plan with no reference has nothing to read yet
        tone: 'grey', status: C.facts.unlinked, note: C.facts.unlinkedNote,
        actions: readOnly ? undefined : [{ label: C.facts.link, icon: 'link', primary: true, onClick: () => { closeFacts(); beginGeoref() } }],
      }
  // ⚠️ An AUTOMATIC scale is a reading, never a door into a second, competing manual calibration:
  // it is derived from the Kartenverknüpfung (or the Gebäude's Grundriss) and is corrected there.
  const factsScale: PlanFact | undefined = !scaleShown ? undefined : {
    tone: scaleTone,
    status: scaleAuto ? C.scale.chipAuto
      : scaleStale ? C.facts.scaleStale
      : calibrated ? fillTemplate(C.scale.chipCalibrated, { m: String(activeScale!.refM) })
      : C.scale.chipUncalibrated,
    // only a GEOREF-derived scale comes «aus der Kartenverknüpfung» – the Gebäude's from its Grundriss
    note: scaleAuto ? (georefFit || packMPerU ? C.facts.scaleFromFit : C.facts.scaleFromFootprint)
      : scaleStale ? C.facts.scaleStaleNote
      : calibrated ? C.facts.scaleByHand
      : georefChipShown ? C.facts.scaleNoneLinkable : C.facts.scaleNone,
    actions: readOnly || scaleAuto ? undefined : [{
      label: calibrated || scaleStale ? C.scale.recalibrate : C.scale.calibrate, icon: 'measure',
      // the primary only where no link is offered to carry the scale instead
      primary: !georefChipShown && !calibrated,
      onClick: () => { closeFacts(); setTool('scale') },
    }],
  }
  const factsTitle = fillTemplate(C.facts.title, { name: active.code || active.title })
  // while calibrating, the row is the instrument (one mode, one indicator – as for the pairing):
  // what to tap, lit, and a tap stops it
  const calibrateChip = tool === 'scale' && !readOnly ? (
    <button type="button" className="wb-scale-chip arm" aria-label={C.scale.calibrateHint} title={C.scale.recalibrate} onClick={() => setTool('pan')}>
      <Icon id="measure" />
      <span>{C.scale.calibrateHint}</span>
    </button>
  ) : null

  // Viewer-only plan (e.g. PV / documentation PDF): bypass the annotation board entirely and
  // show a plain, natively-scrolling multi-page PDF viewer — no tools, no stitched pan/zoom board.
  // the Tafel's page strip, on the Skizze and on every page alike
  const strip = onTafel ? (
    <TafelPageStrip pages={pages} titles={titles} current={page} templates={templates} readOnly={readOnly} onPick={setPageSel} onAdd={addPage} />
  ) : null
  // A Tafel PAGE is a form, not a drawing surface: it takes the stage, and none of the board's
  // apparatus (rails, docks, chips) is drawn over it. The hooks above still ran, so the Tafel's
  // history and its ↶ stay wired exactly as on the Skizze.
  const formPage = formOpen ? pages.find((p) => p.id === page) : undefined
  if (formPage) {
    return (
      <div className="whiteboard wb-tafel-page">
        {/* the strip in the row a plan's «which place» chips stand in (owner, before the release) */}
        <div className="wb-botleft">{strip}</div>
        <TafelFormPage key={formPage.id} pageKey={formPage.id} title={titles.get(formPage.id)} data={formPage.form} readOnly={readOnly} isPhone={isPhone}
          onChange={(next) => editPage(formPage.id, next)} onRemove={() => void removePage(formPage.id)}
          // typed over another device's value for the same cell: the later stands, the Verlauf says so
          onConflict={(where, kept, lost) => log('warn', fillTemplate(appConfig.copy.journal.tafelConflict, { page: titles.get(formPage.id) ?? labelText(formPage.form.page.title), where, kept, lost }), { subjectId: formPage.id })}
          onPrint={incidentId ? (all) => void printPages(all ? pages : [formPage]) : undefined} pageCount={pages.length} printing={printing}
          scene={tafel?.scene} onOpenKarte={tafel?.onOpenKarte}
          // the bottom: the strip's row and its air, so the last ruling scrolls above it — on a
          // phone above THE floating row (15-mobile · --float-bottom), on a tablet above the row
          inset={{ top: topRes, left: isPhone ? 0 : side.l, right: isPhone ? 0 : side.l, bottom: isPhone ? 'calc(var(--float-bottom, 72px) + var(--float-h) + 16px)' : 'calc(16px + var(--float-h) + 24px)' }} />
      </div>
    )
  }

  if (active?.viewer && active.imageUrl) {
    // .whiteboard is already `position:absolute; inset:0` (a containing block for the
    // absolutely-positioned scroller) — don't override it, or the container collapses to 0 height.
    return (
      <div className="whiteboard">
        {/* a viewer-only document is still one of THIS object's plans — the chip belongs on it
            too, or the read-out would blink out on exactly the plans nobody can annotate. No
            Maßstab beside it here: there is nothing to calibrate on a document. */}
        {nearbyBanner}
        {/* the row is the reader's to render: on a tablet its section bar stands in it (PdfScroller) */}
        <PdfScroller key={active.id} url={planUrl(active.imageUrl)} fileName={[objectName, active.title || active.code].filter(Boolean).join(' – ')}
          row={<><span className="wb-join">{objectChip}{buildingFloat}</span>{readingsChip}</>} />
      </div>
    )
  }

  // what every <PlanAnno> reads from this render — one object, handed to each
  const annoBoard: PlanAnnoBoard = {
    sW, sH, scale, mapY, stack, symBase, txtBase, tool, readOnly, captionMode, sym, annos, trupps, activeId, textEditId,
    chipRef, chipDown, setEditId, setSelId, setNotePanelId, pushPast, patch, patchCommit, emit, log,
    teamNameTaken, onTeamTrupp, onTeamNewTrupp, onShowTrupp, markPosition, clearTrail, removeWithConnections, removeWithTrail,
    toggleTrail, rotDown, rotMove, rotUp,
  }

  return (
    // ⚠️ `wb-georef-split` is what the app's ONE live map keys off (09-whiteboard.css): the board
    // gives up the right half and the map that was hidden behind it becomes visible again. No
    // second map instance — this one already carries every layer, every symbol and the operator's
    // own framing. Not on a phone: there the surfaces take turns instead (lib/georefMode).
    <div className={`whiteboard${georefArmed ? ' wb-georef-armed' : ''}${georefArmed && georef.check ? ' wb-georef-check' : ''}${georefArmed && !georef.check && !isPhone ? ' wb-georef-split' : ''}`}>
      {/* the plan DOCUMENTS are picked in the global left NavRail (it is pure navigation); the
          object they all belong to is named on the chip in the bottom-left corner */}
      {/* plan canvas + annotation layer */}
      <div className="wb-stage" ref={stageRef}>
        <div
          ref={setCanvas}
          className={`wb-canvas tool-${tool} ${pending || pendingShape ? 'placing' : ''}`}
          // capture-phase bookkeeping FIRST — it sees the fingers a chip's own handler
          // swallows, which is what makes the two-finger gesture work on a busy board.
          // ⚠️ The twin-panel dismissal must NOT fire for a press on a twin mark itself: capture
          // runs before TwinMark can stop anything, so an unguarded setTwinView(null) here
          // deselected the twin at the exact pointerdown that was meant to DRAG it — the halo
          // vanished, `onMove` was withdrawn mid-gesture, and «twins cannot be moved» was the
          // whole visible story. A press starting on the mark keeps the selection; any other
          // press still dismisses (that is what makes tapping empty paper close the panel).
          // ⚠️ …and it stands down entirely while ✥ / ⟳ are armed: React delegates at the app
          // root, so this capture handler runs BEFORE useArmedTransform's listener on this very
          // element and would dismiss the twin panel of the object the drag is about to move.
          onPointerDownCapture={(e) => {
            if (arm.armed && !(e.target as HTMLElement | null)?.closest?.('[data-arm-exempt]')) return
            if (!(e.target as HTMLElement | null)?.closest?.('[data-twin]')) { setNotePanelId(null) }
            trackDown(e)
          }}
          onPointerUpCapture={trackUp}
          onPointerCancelCapture={trackUp}
          onPointerDown={(e) => { if (!(e.target as HTMLElement | null)?.closest?.('[data-twin]')) { setNotePanelId(null) } stageDown(e) }}
          onPointerMove={stageMove}
          onPointerUp={stageUp}
          onPointerCancel={stageUp}
        >
          <div
            ref={boardRef}
            className={`wb-board ${blank ? 'wb-board-blank' : ''}`}
            // the reserved lanes are not symmetric (the rails differ), so the centre shifts by half
            // their difference — exactly what `vShift` does for the top bar (and the Gebäude's
            // chip row below). While the orientation preview stands, nothing on it takes a press:
            // what it draws is not where the sheet's objects are yet (`previewAnnos`).
            style={{ width: sW || undefined, height: sH || undefined, transform: `translate(-50%, -50%) translate(${pos.x + (side.l - side.r) / 2}px, ${pos.y + vShift}px)`, pointerEvents: previewing ? 'none' : undefined }}
          >
            {stack && building ? (
              <>
              {/* what is folded away, as a strip where the storey belongs – «+2 · 2. OG
                  ausgeblendet · einblenden». Chrome, not a tile: the board's geometry is the DRAWN
                  storeys, so nothing under it moves when one is folded (mock A, 16.09.2026). */}
              {folded.map(({ floor: f, seam, order, count }) => {
                const top = seam === 0 ? -(count - order) * FOLDED_H       // above the stack, in order
                  : seam >= N ? sH + order * FOLDED_H                      // below it
                  : (seam / N) * sH - FOLDED_H / 2 + order * FOLDED_H      // straddling the seam
                const name = storeyName(f)
                // ⚠️ the WHOLE strip is the button, and it says so by name: on a narrow tile the
                // «einblenden» word and the eye on the headers above are both dropped (09-whiteboard.css),
                // so this label is all that is left to announce what tapping the row does.
                return (
                  <button key={`folded:${f}`} type="button" className="wb-floor-folded" style={{ top, width: sW, height: FOLDED_H }}
                    title={`${name} ${appConfig.copy.whiteboard.floorShow}`} aria-label={`${name} ${appConfig.copy.whiteboard.floorShow}`}
                    onPointerDown={(e) => e.stopPropagation()} onClick={() => toggleFloor(f)}>
                    {/* the same words as the drawn storey's label (K5): the chip only for a custom name */}
                    {customStorey(f) && <span className={`wb-floor-idx${f === 0 ? ' zero' : ''}`}>{signedFloor(f)}</span>}
                    <span className="wb-floor-name">{name}</span>
                    <span className="wb-floor-folded-state">{appConfig.copy.whiteboard.floorHidden}</span>
                    <span className="wb-floor-folded-cta"><Icon id="eyeoff" />{appConfig.copy.whiteboard.floorShow}</span>
                  </button>
                )
              })}
              {floorsTTB.map((f, idx) => (
                <div key={f} className={`wb-floor${idx === 0 && !readOnly && !building.pack ? ' wb-floor-under-add' : ''}${dropFloor === f ? ' wb-floor-drop' : ''}`} style={{ top: (idx / N) * sH, height: sH / N, width: sW }}>
                  {(() => {
                    // Sweep K5 (29.09.2026): the storey's acts live in its LABEL. A tap on «4. OG»
                    // opens «Ausblenden · Geschoss entfernen»; the eye and the red bin that stood on
                    // every tile at rest (four at once on a tablet, half a phone tile each) are gone
                    // from the canvas — delete is the rarest act here and was the loudest shape.
                    // «Ausblenden» is a way of LOOKING (device-local, never asks, the folded strip
                    // is the way back), so it is offered on read-only surfaces too; «Geschoss
                    // entfernen» is still the owner's confirm-with-undo (IncidentWorkspace ·
                    // onRemoveFloor), only its door moved.
                    const name = storeyName(f)
                    const W = appConfig.copy.whiteboard
                    const canHide = floorsTTB.length > 1
                    const canRemove = f !== 0 && !readOnly && !building.pack && !floorPack?.tiles[f]
                    const canCopy = !readOnly && allFloorsTTB.length > 1
                    const words = <>
                      {/* the word only («4. OG», «EG»): the signed chip said the same thing again.
                          It comes back only when a custom name («Hauptebene») hides the order. */}
                      {customStorey(f) && <span className={`wb-floor-idx${f === 0 ? ' zero' : ''}`}>{signedFloor(f)}</span>}
                      <span className="wb-floor-name">{name}</span>
                    </>
                    if (!canHide && !canRemove && !canCopy) return <div className="wb-floor-label">{words}</div>
                    // ⚠️ the popup is portalled out of the board, but React still bubbles its pointer
                    // events up through this tile to the pan/zoom surface, which captured the pointer
                    // and swallowed a mouse click on every item («Ausblenden», «Kopieren nach …»)
                    return (
                      <span className="wb-floor-menu-host" onPointerDown={(e) => e.stopPropagation()}>
                      <Menu
                        popupClassName="de-menu-pop"
                        itemClassName={() => 'de-menu-item'}
                        align="start"
                        trigger={
                          <button type="button" className="wb-floor-label wb-floor-menu"
                            title={canRemove ? fillTemplate(W.floorMenu, { name }) : `${name}: ${W.floorHide}`}
                            aria-label={canRemove ? fillTemplate(W.floorMenu, { name }) : `${name}: ${W.floorHide}`}
                            onPointerDown={(e) => e.stopPropagation()}>
                            {words}<Icon id="chevron-down" />
                          </button>
                        }
                        items={[
                          ...(canHide ? [{ label: <><Icon id="eyeoff" /><span>{W.floorHideShort}</span></>, onClick: () => toggleFloor(f) }] : []),
                          ...(canCopy ? [{ label: <><Icon id="copy" /><span>{W.storeyCopy.menu}</span></>, onClick: () => setCopyFrom(f) }] : []),
                          ...(canRemove ? [{ label: <><Icon id="trash" /><span>{W.removeFloor}</span></>, onClick: () => removeFloor(f), danger: true }] : []),
                        ]}
                      />
                      </span>
                    )
                  })()}
                  {/* (the north dial used to be drawn on this tile, top-right. It now floats in
                      the viewport's corner — see <PlanCompass> below the board: inside the tile
                      it panned and zoomed away with the paper, taking the rotation control with
                      it. One compass, one corner, on every device.) */}
                  <div className="wb-floor-fp" style={{ width: fpBox?.w, height: fpBox?.h }}>
                    {/* px viewBox, no vector-effect — see WbInkLayer's header for why the 1×1
                        stretch + non-scaling-stroke pattern is banned on the board */}
                    <svg viewBox={`0 0 ${fpBox?.w || 1} ${fpBox?.h || 1}`} preserveAspectRatio="none" className="wb-floor-svg">
                      {/* the storey's Geschossplan page UNDER the outline, placed through the pack's
                          map fit and the footprint's geo anchor (lib/stackFit · pagePlacement) */}
                      {floorPack && floorPack.tiles[f]?.length && fpBox && (building.pack || (floorPack.fit && building.src?.length)) && (() => {
                        const parts = floorPack.tiles[f]
                        if (building.pack) {
                          // the tile box IS the reference frame: each of the storey's drawings is laid into it
                          // shifted by its OWN anchor difference, and only that drawing is rendered
                          // (lib/floorPackBinding) – two wings of one storey land side by side
                          return parts.map((tile) => (
                            <FloorPage key={`${f}:${tile.part}:${tile.url}`} url={tile.url} corners={packPagePlacement(packView!, building.pack!.aspect, tile)}
                              region={tile.clip} w={fpBox.w} h={fpBox.h} floors={drawings} onDensity={takeStackDensity} />
                          ))
                        }
                        // a footprint stack places the whole page through the fits – one page, one raster
                        const corners = pagePlacement(building, shownAngle, floorPack.fit!)
                        return corners && <FloorPage key={parts[0].url} url={parts[0].url} corners={corners} w={fpBox.w} h={fpBox.h} floors={N} onDensity={takeStackDensity} />
                      })()}
                      {building.pack && !floorPack?.tiles[f]?.length && fpBox && (
                        <text x={fpBox.w / 2} y={fpBox.h / 2} textAnchor="middle" className="wb-floor-noplan">{appConfig.copy.whiteboard.noFloorPlan}</text>
                      )}
                      {/* the footprint outline – a pack has none: its frame is a rectangle around
                          the drawing, and drawing it would put a box on every storey */}
                      {!building.pack && (fpView?.rings ?? building.rings ?? [building.ring]).map((ring, ri) => (
                        <polygon key={ri} points={ring.map((p) => `${p[0] * (fpBox?.w || 1)},${p[1] * (fpBox?.h || 1)}`).join(' ')} />
                      ))}
                    </svg>
                  </div>
                </div>
              ))}
              </>
            ) : osm ? (
              /* the ONE interaction this surface has. Gated on the ROLE's read-only (viewer / EL /
                 locked / replay) — NOT on `readOnly`, which is true here for everybody by design
                 (see selectOnly above); picking a building is the whole point of the sheet. */
              // the building already in the stack is handed down so the picker can find it among the
              // live footprints and start it SELECTED — «Anderes Gebäude wählen» is almost always
              // «ergänzen». A building saved without a georeference has nothing to match on and
              // still starts empty, which `replacing` then says out loud.
              <OsmOutline key={active.id} center={osm.center} radiusM={osm.radiusM} onAspect={takeAspect}
                sW={sW} sH={sH}
                interactive={!readOnlyProp} replacing={!!building}
                preselectSrc={building?.geo ? building.src : undefined} preselectGeo={building?.geo}
                pin={incidentPos} onPick={onSelectBuilding} />
            ) : blank ? (
              // the hint teaches the tools — a board that cannot be written on has none to teach, and
              // it steps aside the moment the first line or circle is being laid (sweep E.2)
              annos.length === 0 && !draft && !circleDraft && !readOnly && <div className="wb-blank-hint">{appConfig.copy.whiteboard.blankHint}</div>
            ) : (
              <PdfViewport
                key={active.id}
                url={planUrl(active.imageUrl)}
                fitW={fit.w}
                fitH={fit.h}
                scale={scale}
                pos={pos}
                vw={vp.w}
                vh={vp.h}
                onAspect={takeAspect}
              />
            )}

            {/* Absperrkreise — their own px-space layer, painted under the ink (WbCircleLayer) */}
            <WbCircleLayer annos={drawnAnnos} draft={circleDraft} sW={sW} sH={sH} mapY={mapY}
              color={appConfig.drawing.circleColor} selId={selId} flashId={flashId}
              onPickCircle={tool === 'pan' ? circleDown : undefined} sections={sections ?? undefined} />

            {/* committed drawings */}
            <WbInkLayer annos={drawnAnnos} draft={draft} draftFloor={draftFloorRef.current} draftClosed={tool === 'area'} draftOpen={noding} color={INK_DEFAULTS.color} width={INK_DEFAULTS.width} dashed={INK_DEFAULTS.dashed} hiddenTrails={hiddenTrails} mapY={mapY}
              selId={selId} flashId={flashId} networkIds={[...relationship.lineIds]} onPickDraw={tool === 'pan' ? drawDown : undefined}
              truppTones={truppTones} sW={sW} sH={sH} sections={sections ?? undefined} />
            {/* «Ring lädt, dann schnappt es» — the identical pair the Lage map draws: a blue chip
                BESIDE the target whose ring is the remaining dwell (only a full one attaches), and
                its red twin at the socket an attached endpoint is being pulled out of (only a full
                one releases). The key carries `since`, so re-entering the same target restarts the
                CSS fill. Cycle-forming targets never make the candidate list, so no blocked state.
                The explicit «Verbindung lösen» chip on a selected endpoint stays as it was.
                ⚠️ No ring for a LINE target (dwellFor = 0): it attaches the instant it is
                acquired, so there is no fill to picture — Karte parity. */}
            {planEndpointDragState?.candidate && dwellFor(planEndpointDragState.candidate) > 0 && (
              <span key={`${planEndpointDragState.candidate.key}:${planEndpointDragState.dwell.since}`} className="magnet-anchor wb-magnet"
                style={{ left: planEndpointDragState.candidate.point[0], top: planEndpointDragState.candidate.point[1] }}>
                <ConnectRing since={planEndpointDragState.dwell.since} armed={planEndpointDragState.dwell.armed} />
              </span>
            )}
            {planEndpointDragState?.attached && planEndpointDragState.detach > DETACH_SHOW_PROGRESS && (
              <span className="magnet-anchor wb-magnet"
                style={{ left: planEndpointDragState.origin[0] * sW, top: mapY(planEndpointDragState.origin[2] ?? 0, planEndpointDragState.origin[1]) * sH }}>
                <NodeDeleteChip tone="release" progress={planEndpointDragState.detach} />
              </span>
            )}
            {planDraftMagnetState?.candidate && dwellFor(planDraftMagnetState.candidate) > 0 && (
              <span key={`${planDraftMagnetState.candidate.key}:${planDraftMagnetState.dwell.since}`} className="magnet-anchor wb-magnet"
                style={{ left: planDraftMagnetState.candidate.point[0], top: planDraftMagnetState.candidate.point[1] }}>
                <ConnectRing since={planDraftMagnetState.dwell.since} armed={planDraftMagnetState.dwell.armed} />
              </span>
            )}
            {/* «Angekuppelt» while placing — the Karte's twin (MapView · joinPreview, 11-measure.css) */}
            {planJoinPreview().map((j) => (
              <span key={`jp${j.key}`} className="magnet-anchor wb-magnet" style={{ left: j.point[0], top: j.point[1] }}>
                <span className="join-coupling" style={{ '--line': j.color } as React.CSSProperties} />
              </span>
            ))}
            {/* …and the same ring for a Rotation, at both the end being dragged and each of the
                two taps that lay it down (claimRotTarget) */}
            {/* the first of a Rotation's two points, while the second is still being looked for */}
            {rotStart && (
              <span className="magnet-anchor wb-magnet" style={{ left: rotStart[0] * sW, top: mapY(rotStart[2] ?? 0, rotStart[1]) * sH }}>
                <span className="place-anchor" />
              </span>
            )}
            {rotMagnet && (
              <span key={`rotmag:${rotMagnet.since}`} className="magnet-anchor wb-magnet"
                style={{ left: rotMagnet.x * sW, top: mapY(rotMagnet.floor, rotMagnet.y) * sH }}>
                <ConnectRing since={rotMagnet.since} armed={rotMagnet.armed} />
              </span>
            )}

            {/* line arrowheads · repeated marker letters · free-text label + distance — rendered in
                board px (the ink SVG is stretched 1×1 and would distort them). Same feature set +
                spacing math as the Lage map (markerParamsAlong / —R— rhythm); the metric distance
                read-out now works too, once the plan is calibrated (lib/planScale). One per Linie. */}
            {/* stair marks (mock C, 14.09.2026): where a Leitung leaves a storey, a circled number
                says where it goes; where it arrives, where it came from – at the same spot on both
                tiles, the staircase. Tapping one moves the view to the other end of the climb. */}
            {stack && renderAnnos.filter((a) => a.kind === 'draw' && (a.pts?.length ?? 0) >= 2).flatMap((a) => {
              const p = a.pts!
              const color = a.color || COLORS[0]
              return floorCrossings(p, a.floor).flatMap((i) => [[p[i], p[i + 1]], [p[i + 1], p[i]]].map(([at, other], side) => {
                const atFloor = at[2] ?? a.floor ?? 0, otherFloor = other[2] ?? a.floor ?? 0
                // a climb made outside the storey's visible section has nowhere to stand
                if (!onSection(atFloor, [at[0] * sW, mapY(atFloor, at[1]) * sH])) return null
                const label = fillTemplate(side === 0 ? appConfig.copy.whiteboard.stairTo : appConfig.copy.whiteboard.stairFrom, { floor: signedFloor(otherFloor) })
                return (
                  <button key={`${a.id}:stair:${i}:${side}`} type="button" className="wb-line-stair" aria-label={label} title={label}
                    // off the vertex, like a badge: the vertex itself stays tappable (select, drag, ↑/↓)
                    style={{ color, transform: `translate(${at[0] * sW + 18}px, ${mapY(atFloor, at[1]) * sH - 18}px) translate(-50%, -50%)` }}
                    onPointerDown={(e) => e.stopPropagation()}
                    onClick={(e) => {
                      e.stopPropagation()
                      // …and if the other end is folded away, unfold it: the rAF lets the new tile
                      // layout land before the view is aimed at it
                      revealFloor(otherFloor)
                      requestAnimationFrame(() => centerOnPoint(other[0], other[1], otherFloor))
                    }}>
                    {signedFloor(otherFloor)}
                  </button>
                )
              }))
            })}
            {renderAnnos.filter((a) => a.kind === 'draw' && (a.arrow || a.marker || a.label || a.showDistance || hasLineDecor(a)) && (a.pts?.length ?? 0) >= 2).map((a) => (
              <PlanLineDecor key={`am-${a.id}`} a={a} sW={sW} sH={sH} mapY={mapY} onSection={onSection} trupps={trupps} truppSeverities={truppSeverities}
                planMetres={planMetres} tagAt={tagSpots.get(a.id)} tool={tool} labelDown={labelDown} labelMove={labelMove} labelUp={labelUp} />
            ))}

            {/* area (Sektor/Abschnitt) labels — a labelled area renders its free text at the polygon
                centroid in board px (the 1×1 ink SVG would distort text). Draggable like a line label.
                «Auf Karte zeigen» prints the Fläche above it, exactly as the line label above prints
                its Länge — the switch existed for a plan area but nothing rendered what it turned on. */}
            {drawnAnnos.filter((a) => a.kind === 'area' && (a.label || a.showDistance) && (a.pts?.length ?? 0) >= 3).map((a) => {
              const bpx = a.pts!.map(([x, y, floor]) => [x * sW, mapY(floor ?? a.floor, y) * sH] as [number, number])
              // on the stack: the centre of what is LEFT of the Fläche on its storey's section
              // (lib/storeyClip) — none when nothing of it shows
              const section = sections?.get(a.floor ?? 0)
              const centre = section ? visibleCentre(bpx, section) : null
              if (section && !centre) return null
              const cx = centre ? centre[0] : bpx.reduce((s, q) => s + q[0], 0) / bpx.length
              const cy = centre ? centre[1] : bpx.reduce((s, q) => s + q[1], 0) / bpx.length
              const areaLines: string[] = []
              if (a.showDistance) {
                const m2 = calibrated && activeScale ? polyAreaM2(a.pts!.map(([x, y]) => [x, y]), activeScale.mPerU, measureAR) : null
                areaLines.push(m2 != null ? fmtArea(m2) : appConfig.copy.whiteboard.scale.needsCalibration)
              }
              if (a.label) areaLines.push(a.label)
              return (
                <span key={`al-${a.id}`} className="wb-line-label wb-area-label"
                  style={{ left: 0, top: 0, transform: `translate(${cx + (a.labelDx ?? 0) * sW}px, ${cy + (a.labelDy ?? 0) * sH}px) translate(-50%, -50%)`, cursor: tool === 'pan' ? 'move' : undefined }}
                  onPointerDown={tool === 'pan' ? (e) => labelDown(e, a.id, a.labelDx ?? 0, a.labelDy ?? 0) : undefined}
                  onPointerMove={tool === 'pan' ? labelMove : undefined}
                  onPointerUp={tool === 'pan' ? labelUp : undefined}
                  onPointerCancel={tool === 'pan' ? labelUp : undefined}>{areaLines.map((t, j) => <div key={j}>{t}</div>)}</span>
              )
            })}

            {/* Maßstab: node preview (board px) — the tapped reference endpoint(s) + segment */}
            {tool === 'scale' && (calNodes.length > 0 || calPrompt) && (() => {
              const pair = calPrompt ? [calPrompt.a, calPrompt.b] : calNodes
              return (
                <svg className="wb-cal-line" width={sW} height={sH} style={{ left: 0, top: 0 }} aria-hidden>
                  {pair.length >= 2 && <line x1={pair[0][0] * sW} y1={pair[0][1] * sH} x2={pair[1][0] * sW} y2={pair[1][1] * sH} />}
                  {pair.map((p, i) => <circle key={i} cx={p[0] * sW} cy={p[1] * sH} r={6} />)}
                </svg>
              )
            })()}

            {/* Messen: the measurement polyline / area (board px) + draggable nodes + cumulative
                labels — the Plan twin of the Lage map's measure tool, scaled by the calibration. */}
            {tool === 'measure' && measPath.length > 0 && (
              <>
                <svg className="wb-meas-svg" width={sW} height={sH} style={{ left: 0, top: 0 }} aria-hidden>
                  {measMode === 'area' && measPath.length >= 3
                    ? <polygon points={measPath.map((p) => `${p[0] * sW},${p[1] * sH}`).join(' ')} className="wb-meas-fill" />
                    : measPath.length >= 2 && <polyline points={measPath.map((p) => `${p[0] * sW},${p[1] * sH}`).join(' ')} className="wb-meas-stroke" fill="none" />}
                </svg>
                {/* insert "+" at each segment midpoint */}
                {measPath.length >= 2 && measPath.map((p, i) => {
                  if (measMode === 'line' && i === measPath.length - 1) return null
                  const b = measPath[(i + 1) % measPath.length]
                  return (
                    <button key={`mi-${i}`} className="wb-vins" title={appConfig.copy.measure.insertPoint} aria-label={appConfig.copy.measure.insertPoint}
                      style={{ left: 0, top: 0, transform: `translate(${((p[0] + b[0]) / 2) * sW}px, ${((p[1] + b[1]) / 2) * sH}px) translate(-50%, -50%)` }}
                      onPointerDown={(e) => measInsert(i, e)}><Icon id="plus" /></button>
                  )
                })}
                {/* draggable nodes (hold to delete) + cumulative-distance labels */}
                {measPath.map((p, i) => {
                  const cum = calibrated && i > 0 ? pathMetres(measMpts.slice(0, i + 1), activeScale!.mPerU, measureAR) : null
                  const hold = measPress.press(`m${i}`, () => measDelete(i))
                  return (
                    <Fragment key={`mn-${i}`}>
                      {/* positioning wrapper so the handle's :active scale never clobbers the
                          board-px placement (mirrors how the map nests the handle in a Marker) */}
                      <div className="wb-meas-node" style={{ left: 0, top: 0, transform: `translate(${p[0] * sW}px, ${p[1] * sH}px) translate(-50%, -50%)`, pointerEvents: measFresh === i ? 'none' : undefined }}>
                        {/* `{...hold}` carries `data-holdaction` (lib/nodeHold): without it the hold-tooltip
                            popped «Gedrückt halten zum Löschen» mid-ring and ate the release (08.10.) */}
                        <button className={`measure-handle ${measPress.armed?.key === `m${i}` ? 'doomed' : ''}`}
                          title={appConfig.copy.measure.deleteNode} aria-label={appConfig.copy.measure.deleteNode}
                          {...hold}
                          onPointerDown={(e) => { hold.onPointerDown(e); measNodeDown(i, e); setMeasDragNode(i) }}
                        >{measPress.armed?.key === `m${i}` && <NodeDeleteChip progress={measPress.armed.progress} />}</button>
                      </div>
                      {measMode === 'line' && cum != null && measDragNode !== i && (
                        <span className="wb-line-label wb-meas-label" style={{ left: 0, top: 0, transform: `translate(${p[0] * sW}px, ${p[1] * sH}px) translate(-50%, -150%)` }}>{fmtDistance(cum)}</span>
                      )}
                    </Fragment>
                  )
                })}
                {/* area: total at the centroid */}
                {measMode === 'area' && calibrated && measPath.length >= 3 && (() => {
                  const cx = measPath.reduce((s, q) => s + q[0], 0) / measPath.length
                  const cy = measPath.reduce((s, q) => s + q[1], 0) / measPath.length
                  return <span className="wb-line-label wb-meas-label" style={{ left: 0, top: 0, transform: `translate(${cx * sW}px, ${cy * sH}px) translate(-50%, -50%)` }}>{fmtArea(measAreaM2)}</span>
                })()}
              </>
            )}

            {/* an Absperrkreis states its radius at the ring's top edge, exactly as the Karte does
                (MapView · circleLabels) — in the sheet's calibrated metres. Uncalibrated there is
                no honest number to print, so the ring simply carries none. */}
            {calibrated && activeScale && drawnAnnos.filter((a) => a.kind === 'circle' && (a.radiusN ?? 0) > 0).map((a) => {
              const cx = (a.x ?? 0) * sW, cy = mapY(a.floor, a.y ?? 0) * sH
              const r = (a.radiusN ?? 0) * sW
              return (
                <span key={`cr-${a.id}`} className="wb-line-label"
                  style={{ left: 0, top: 0, transform: `translate(${cx}px, ${cy - r}px) translate(-50%, -100%)` }}>
                  {fmtDistance(circleRadiusM(a.radiusN ?? 0, activeScale.mPerU, measureAR))}
                </span>
              )
            })}

            {/* vertex editing for a selected line/area — node drag / insert / delete (one shared
                code path for Linie + Fläche). A many-point freehand stroke used to be skipped here
                entirely and so could not be reshaped at all; WbVertexHandles now thins its own
                grips instead (mirrors the map's cap). */}
            {editDraw && editDraw.kind !== 'circle' && tool === 'pan' && (
              <WbVertexHandles anno={renderAnnos.find((a) => a.id === editDraw.id) ?? editDraw} sW={sW} sH={sH} mapY={mapY}
                onVertexDown={vertDown} onInsert={insertVertex} onDeleteVertex={deleteVertex} onExtend={extendLine}
                // a Wand lives on one storey: it never climbs a stair like a Leitung does
                onClimb={stack && !editDraw.role ? climbLine : undefined} floors={stack ? floorsTTB : undefined} />
            )}
            {/* Absperrkreis: ONE grip on the ring (screen-right) sets the radius — the gesture
                that placed it, available again afterwards. It is the only way to resize on an
                uncalibrated sheet, where the editor's metre stepper has nothing to say. */}
            {editDraw?.kind === 'circle' && tool === 'pan' && (
              <WbCircleHandle anno={editDraw} sW={sW} sH={sH} mapY={mapY}
                onRadiusDown={(e) => rotDown(e, editDraw.id, 'radius')} onMove={rotMove} onUp={rotUp} />
            )}
            {/* unlock chip on every locked line/area/shape — the click-through ink's only tap
                target, a SHORT HOLD to unlock + select (the Lage's twin, MapView · LockChip /
                MapMarkers · shape-lock-anchor). Its only job is unlocking, so it stays away where
                editing is locked anyway. Position mirrors the map: an area is chipped at its
                centroid, a line at its middle vertex, a shape at its centre. */}
            {!readOnly && tool === 'pan' && drawnAnnos.filter((a) => a.locked && (a.kind === 'shape' || a.kind === 'circle' || ((a.kind === 'draw' || a.kind === 'area') && a.pts?.length))).map((a) => {
              const pts = a.pts ?? []
              const p = a.kind === 'shape' || a.kind === 'circle'
                ? [a.x ?? 0, mapY(a.floor, a.y ?? 0)] as const
                : a.kind === 'area'
                ? [pts.reduce((t, q) => t + q[0], 0) / pts.length, pts.reduce((t, q) => t + mapY(q[2] ?? a.floor, q[1]), 0) / pts.length] as const
                : [pts[Math.floor((pts.length - 1) / 2)][0], mapY(pts[Math.floor((pts.length - 1) / 2)][2] ?? a.floor, pts[Math.floor((pts.length - 1) / 2)][1])] as const
              return (
                <span key={`lk${a.id}`} className="wb-lock-anchor" style={{ left: p[0] * sW, top: p[1] * sH }}>
                  <LockChip onUnlock={() => { patchCommit(a.id, { locked: undefined }); setSelId(a.id) }} />
                </span>
              )
            })}
            {/* explicit detach: a × chip beside a connected endpoint of the selected line — dragging
                the node only moves/re-targets (never severs), so this is how a link is broken. */}
            {editDraw?.kind === 'draw' && tool === 'pan' && !planEndpointDragState && (['start', 'end'] as const).map((ep) => {
              const rel = ep === 'start' ? editDraw.startAttachment : editDraw.endAttachment
              const pts = renderAnnos.find((a) => a.id === editDraw.id)?.pts ?? editDraw.pts
              if (!rel || !pts || pts.length < 2) return null
              const p = ep === 'start' ? pts[0] : pts[pts.length - 1]
              return (
                <span key={`detach-${ep}`} className="line-detach-chip wb-magnet" role="button"
                  title={appConfig.copy.drawingEditor.detachConnection} aria-label={appConfig.copy.drawingEditor.detachConnection}
                  style={{ left: p[0] * sW + 16, top: mapY(p[2] ?? editDraw.floor, p[1]) * sH - 16 }}
                  onPointerDown={(e) => e.stopPropagation()}
                  onClick={(e) => { e.stopPropagation(); detachPlanEndpoint(ep) }}><Icon id="close" /></span>
              )
            })}

            {/* Every covered floor exposes the same object through the full native renderer. */}
            {shownAnnos.filter((a) => a.kind !== 'draw').flatMap((a) => stack ? stackInstances(a, floorsTTB) : [a]).map((a) => (
              <PlanAnno key={`${a.id}:${a.floor ?? 0}`} a={a} board={annoBoard}
                selected={selId === a.id} grouped={selIds.includes(a.id)} networked={relationship.objectIds.has(a.id)}
                editing={editId === a.id} trailShown={!hiddenTrails.has(a.id)} />
            ))}

            {/* trail breadcrumbs — a constant-size dot + timestamp at each RECORDED
                position, so the trail reads as a time-stamped log at a glance */}
            {shownAnnos.filter((a) => a.kind === 'resource' && !hiddenTrails.has(a.id)).flatMap((a) =>
              (a.trail ?? []).map((p, i) => (
                <div
                  key={`dot-${a.id}-${i}`}
                  className={`wb-trail-dot ${selId === a.id ? 'sel' : ''}`}
                  style={{ transform: `translate(${p.x * sW}px, ${mapY(p.floor ?? a.floor, p.y) * sH}px) translate(-50%, -50%)` }}
                >
                  <span className="wb-trail-mark" style={{ background: a.color || COLORS[0] }} />
                  <i>{p.t}</i>
                </div>
              )),
            )}

            {/* Geister-Spuren: the searched area a removed Trupp chip left behind
                (lib/truppTrails). Same breadcrumb dots, in the neutral ink and with no
                timestamp-selection state, because it is a record rather than a Trupp — it is not
                selectable AS one. The label chip is the hit target: one tap offers «Spur
                löschen» with the existing confirm (IncidentWorkspace · deleteGhostTrail). Each
                point is drawn on the storey it was WALKED on (TrailPoint.floor), not on the
                chip's last tile — a Trupp that went up was a floor below a minute ago. */}
            {ghostTrails.map((g) => {
              const pts = g.points ?? []
              const head = pts[pts.length - 1]
              const label = ghostTrailLabel(g, appConfig.copy.whiteboard.team, trupps)
              return (
                <Fragment key={g.id}>
                  {pts.map((p, i) => (
                    <div key={`ghost-${g.id}-${i}`} className="wb-trail-dot wb-ghost-trail-dot"
                      style={{ transform: `translate(${p.x * sW}px, ${mapY(p.floor ?? 0, p.y) * sH}px) translate(-50%, -50%)` }}>
                      <span className="wb-trail-mark" />
                      <i>{p.t}</i>
                    </div>
                  ))}
                  {head && (onGhostTrail ? (
                    <button type="button" className="wb-ghost-label"
                      style={{ left: `${head.x * sW}px`, top: `${mapY(head.floor ?? 0, head.y) * sH}px` }}
                      title={fillTemplate(appConfig.copy.whiteboard.ghostTrailHint, { name: label })}
                      onPointerDown={(e) => e.stopPropagation()}
                      onClick={(e) => { e.stopPropagation(); onGhostTrail(g.id) }}>
                      <Icon id="footprint" />{label}
                    </button>
                  ) : (
                    // a locked board has no «Spur löschen»: the label is a read-out (MapMarkers' twin)
                    <span className="wb-ghost-label"
                      style={{ left: `${head.x * sW}px`, top: `${mapY(head.floor ?? 0, head.y) * sH}px` }}
                      title={fillTemplate(appConfig.copy.whiteboard.ghostTrailHint, { name: label })}>
                      <Icon id="footprint" />{label}
                    </span>
                  ))}
                </Fragment>
              )
            })}

            {/* create-tool capture layer */}
            {creating && (
              <div className="wb-ink" onPointerDown={inkDown} onPointerMove={inkMove} onPointerUp={inkUp} onPointerCancel={inkUp}
                onPointerLeave={(e) => { clearDoorGhost(); if (e.pointerType === 'mouse') showRing(null, 0, true) }} />
            )}
            {/* the Durchgang the next click places – on its Wand, turned along it (mouse only) */}
            {doorGhost && tool === 'symbol' && pending === DOOR_SYMBOL && (
              <div className="wb-door-ghost" aria-hidden
                style={{ transform: `translate(${doorGhost.x * sW}px, ${mapY(doorGhost.floor, doorGhost.y) * sH}px) translate(-50%, -50%)` }}>
                <TacticalSymbol svg={sym.byName[DOOR_SYMBOL] ?? ''} sizePx={symBase} rotation={doorGhost.rotation} />
              </div>
            )}
            {/* the in-progress node draft is reshapeable IN PLACE (A3, 29.08.): the same vertex
                grips and «+» midpoint inserts a finished shape gets, sitting above the .wb-ink
                capture layer (their z-indices already beat it) so they stay tappable while the
                tool is armed — a tap beside them still lays the next point as before. */}
            {noding && !!draft?.length && (
              <WbDraftHandles pts={draft} closed={tool === 'area'} draftFloor={draftFloorRef.current}
                sW={sW} sH={sH} mapY={mapY}
                onVertexDown={draftVertDown} onVertexTap={tapDraftVertex} onInsert={draftInsert} onDeleteVertex={draftDeleteVertex} />
            )}
            {/* the open drawing says so (27.10.2026): «Wand offen» at its last point, pulsing, and the
                snap ring where the next point lands (usePlanDraft · ring / openName) */}
            {noding && !!draft?.length && openName && (() => {
              const last = draft[draft.length - 1]
              const x = last[0] * sW, y = mapY(last[2], last[1]) * sH // a Punkte point always carries its storey
              return <span className="wb-open-pill" style={{ transform: `translate(${x + 14}px, ${y - 34}px)` }}>{fillTemplate(appConfig.copy.toolDock.openPill, { name: openName })}</span>
            })()}
            {/* …and under a Wand corner being dragged (useWbVertexEdit · snapWallVertex) */}
            {(noding || tool === 'pan') && ring && <WbSnapRing ring={ring} sW={sW} sH={sH} />}
            {/* «Karte verknüpfen»: the numbered crosses live IN the board so they pan and zoom
                with the sheet. Shown while the mode is armed, and while the Passung is open —
                otherwise a reference set in June could not be found again in November. */}
            {canGeoref && (georefArmed || georefQuality) && (
              <GeorefBoardLayer pairs={georefPairs} mode={georef} armed={georefArmed} sW={sW} sH={sH} view={georefView} />
            )}
            {!georefArmed && photos.length > 0 && (
              <PlanPhotoMarks marks={photos} sW={sW} sH={sH} inert={tool !== 'pan'} />
            )}
            {!georefArmed && live.length > 0 && (
              <PlanLiveLayer
                marks={live}
                byName={sym.byName}
                sW={sW}
                sH={sH}
                // the sheet's own symbol size (symBase): the live feed renders exactly like a
                // symbol somebody placed here — presentation-equivalent, doctrine 30.08.
                sizePx={symBase}
                captionMode={captionMode}
                suppressedCaptions={mapSuppressedCaptions}
                // undefined (not a no-op) on a locked surface, so the mark shows no grab cursor
                // and no drag affordance it would refuse to honour
                onMove={readOnly || tool !== 'pan' ? undefined : moveLiveMark}
              />
            )}
            {/* add a storey above (OG) / below (UG) — attached to the stack itself, just above
                the top floor and below the bottom floor, like a real building section */}
            {stackReadings.length > 0 && (
              <StackReadings points={stackReadings} floorsTTB={floorsTTB} storeyName={storeyName} boardH={sH}
                onPick={(id) => { setSelId(id); setSelIds([]) }} />
            )}
            {stack && !readOnly && !building?.pack && (
              <>
                <button className="wb-floor-add wb-floor-add-up" onPointerDown={(e) => e.stopPropagation()} onClick={() => onAddFloor(1)} title={appConfig.copy.whiteboard.addFloorUp}><Icon id="plus" />OG</button>
                <button className="wb-floor-add wb-floor-add-down" onPointerDown={(e) => e.stopPropagation()} onClick={() => onAddFloor(-1)} title={appConfig.copy.whiteboard.addFloorDown}><Icon id="plus" />UG</button>
              </>
            )}
          </div>

          {/* floating zoom — only when the tool rail is hidden (viewer-only documents, replay);
              with the rail present, zoom/fit lives in its pinned footer (mirrors the map's
              ToolRail). The phone keeps it either way: there the rail is a bottom bar whose
              footer cluster is CSS-hidden, so this is the plan's only zoom control. */}
          {/* the tool's number while a measure node is in the hand — fixed top-centre, where
              nothing moves while it changes; the label under the finger is suppressed above.
              Same class and reasoning as the Lage's readout (11-measure.css). */}
          {measDragNode != null && calibrated && measPath.length >= 2 && (
            <div className="measure-readout" aria-hidden>
              {measMode === 'line' ? fmtDistance(measLenM) : fmtArea(measAreaM2)}
            </div>
          )}
          {readOnly && (!slimRail || isPhone) && (
            <div className="wb-zoom wb-zoom-float" onPointerDown={(e) => e.stopPropagation()}>
              <button onClick={() => zoom(1 / 1.3)} disabled={scale <= MIN_SCALE} title={appConfig.copy.nav.zoomOut} aria-label={appConfig.copy.nav.zoomOut}><Icon id="minus" /></button>
              <button onClick={() => zoom(1.3)} disabled={scale >= maxScale} title={appConfig.copy.nav.zoomIn} aria-label={appConfig.copy.nav.zoomIn}><Icon id="plus" /></button>
              <button className="wb-fit" onClick={() => applyView(1, { x: 0, y: 0 })} disabled={scale === 1 && pos.x === 0 && pos.y === 0} title={appConfig.copy.nav.fit}>{appConfig.copy.whiteboard.fit}</button>
            </div>
          )}

          {/* the Gebäude's north dial lives in the rail's footer (below). A plan with NO rail – a
              replay, a viewer-only document – keeps it as a read-out in the viewport's top-right
              corner, NOT on the paper. Rendered AFTER the floating zoom so the chip can step
              below it (PlanCompass.module.css). */}
          {stack && fpView && readOnly && !slimRail && (
            <PlanCompass variant="float" deg={northDeg ?? shownAngle} northUnknown={northDeg == null} />
          )}

          {/* ONE bar for every selection this sheet has — the same component, in the same corner
              of the viewport, as on the Karte (components/SelectionBar). It lives OUTSIDE the
              board's pan/zoom transform on purpose: the control that moves the paper's contents
              must not move with the paper. ⟳ is absent on an Absperrkreis, which is a centre and
              a radius and has no angle to turn. */}
          {barActive && (
            <SelectionBar
              onMove={barMove}
              onRotate={barCanRotate ? barRotate : undefined}
              onDone={barDone}
              armed={arm.armed} onArm={arm.toggle}
            />
          )}
          {/* …and the turn is read where it happens, not in the bar's far corner */}
          {(arm.turn ?? barTurn) && (arm.turn
            ? <SelectionTurn cx={arm.turn.cx} cy={arm.turn.cy} px={arm.turn.px} py={arm.turn.py} deg={arm.turn.deg} />
            : <SelectionTurn cx={barTurn!.cx} cy={barTurn!.cy} deg={barTurn!.deg} />)}

        </div>

        {/* on a locked surface the rail can only arm Messen, so the only dock this can render
            there is the Messen one (its ✕ / Strecke↔Fläche / Zurücksetzen — all ephemeral) */}
        {(!readOnly || tool === 'measure') && <WbToolDocks
          tool={tool}
          lineMode={lineMode}
          areaMode={areaMode}
          stack={stack}
          grundriss={grundriss}
          pickInput={pickInput}
          draftActive={draftActive}
          setTool={setTool}
          onFinish={finishShape}
          measMode={measMode}
          setMeasMode={setMeasMode}
          measCount={measPath.length}
          onMeasClear={() => setMeasPath(() => [])}
          onMeasClose={() => { measReset(); setTool('pan') }}
          truppFinder={truppFinder}
        />}
      </div>

      {/* in-progress marquee box (client coords → fixed positioning) */}
      {marquee && (
        <div
          className="wb-marquee"
          style={{
            left: Math.min(marquee.x0, marquee.x1),
            top: Math.min(marquee.y0, marquee.y1),
            width: Math.abs(marquee.x1 - marquee.x0),
            height: Math.abs(marquee.y1 - marquee.y0),
          }}
        />
      )}

      {/* tool rail — the SAME shared <ToolRail> the Lage map renders, and the same rule: a
          locked surface keeps the rail with the slim tool set instead of losing it. Undo/redo
          and Leeren are gone: history is global (TopBar), bulk-remove is Mehrfach + delete.
          The one surface with NO rail at all is the selection-only Umrisse sheet (and a
          viewer-only PDF): there is nothing there a tool could do. */}
      {(!readOnly || slimRail) && (
        <ToolRail
          className="wb-tools"
          // ⚠️ the SAME device pref the Lage rail honours. It was missing here, so «Beschriftung
          // · Wörter» lit up the words on the map's rail and silently did nothing on the plan's —
          // one setting, two rails, and only one of them listening.
          labels={railLabels}
          primary={{ id: 'symbol', icon: appConfig.copy.primarySymbol.icon, label: appConfig.copy.whiteboard.symbol }}
          tools={(readOnly ? slimPlanTools : planTools).filter((t) => !(isPhone && active.id === 'tafel' && t.id === 'measure'))}
          active={tool}
          open={noding && !!draft?.length}
          toolRefs={toolBtn}
          // ⚠️ Auswahl and Mehrfach share ONE rail slot (05.09., the same on the Karte): the rail
          // resolves that toggle, so a second tap on the armed Auswahl arrives here as 'lasso'
          // and a tap on the armed Mehrfach as 'pan' — both plain tool switches from here.
          onPick={(id) => {
            if (id === 'symbol') { setTool('symbol'); setPaletteOpen(true); return }
            setTool(tool === id ? 'pan' : (id as BoardTool)); setPending(null)
          }}
          footer={
            <>
              {/* ⚠️ NO Ebenen row here (15.09.2026). The map rail's footer opens a panel with
                  the deployment's layers in it; this one opened an empty room — the Plan's twin
                  rows went with the unified object model, and the sheet is lent nothing that can
                  be switched. A word that answers a press with nothing is worse than no word. */}
              {/* «Einpassen» — where the map rail carries its compass / views button: the one
                  control that puts the whole surface back in front of you. */}
              <button className="vrail-nbtn vrail-fit" title={appConfig.copy.nav.fit} aria-label={appConfig.copy.nav.fit} disabled={scale === 1 && pos.x === 0 && pos.y === 0} onClick={() => applyView(1, { x: 0, y: 0 })}><span className="vrail-glyph"><Icon id="cross" /></span><span className="vrail-label">{appConfig.copy.nav.fit}</span></button>
              {/* the Gebäude's north dial (PlanCompass) – where the Karte's rail carries its compass,
                  and on a phone in the bottom bar beside «Einpassen» (20.10.2026, UX sweep M7; it
                  floated top-right until then). It turns with the view, and where the building can
                  be turned it is THE door to «Gebäude drehen» on every device – one door, so the
                  rail's old separate compass tile (gone 29.09.2026, sweep K6) does not come back. */}
              {stack && fpView && (
                <PlanCompass variant="rail" deg={northDeg ?? shownAngle} northUnknown={northDeg == null}
                  controls={canOrient && !readOnly ? orientControls : undefined} />
              )}
              {/* zoom ±: desktop only (.vrail-zoom is hidden under 1024px) — the plan pinches
                  on every touch form factor, and «Einpassen» above covers the one state that
                  matters. */}
              <button className="vrail-nbtn vrail-zoom" title={appConfig.copy.nav.zoomOut} aria-label={appConfig.copy.nav.zoomOut} disabled={scale <= MIN_SCALE} onClick={() => zoom(1 / 1.3)}><span className="vrail-glyph"><Icon id="minus" /></span><span className="vrail-label">{appConfig.copy.nav.zoomOut}</span></button>
              <button className="vrail-nbtn vrail-zoom" title={appConfig.copy.nav.zoomIn} aria-label={appConfig.copy.nav.zoomIn} disabled={scale >= maxScale} onClick={() => zoom(1.3)}><span className="vrail-glyph"><Icon id="plus" /></span><span className="vrail-label">{appConfig.copy.nav.zoomIn}</span></button>

            </>
          }
        />
      )}

      {/* the armed tool's readout — the SAME pill the Lage map shows (MapToolDocks): glyph + name,
          bottom centre, nothing else. The symbol tool has no dock here either; «Mehrere
          platzieren» and a ✕ (27.10.2026) stand beside the pill. Rest tool is 'pan' here (the plan pans on empty
          canvas) vs the map's 'select'. Never while Messen is armed, on any size – its results
          panel stands in that spot (sweep 30.10.2026 #3). */}
      {tool !== 'pan' && tool !== 'measure' && (() => {
        if (tool === 'symbol') {
          if (!pending) return null
          return <ArmedToolPill glyph={<ArmedSymbolGlyph svg={sym.byName[pending] ?? ''} />} name={formatSymbolName(pending) || pending}
            lock={{ on: placeLock, onToggle: () => setPlaceLock((v) => !v) }} onClose={stopPlacing} />
        }
        if (tool === 'shape') {
          if (!pendingShape) return null
          return <ArmedToolPill glyph={<ShapeGlyph kind={pendingShape} color="currentColor" aspect={SHAPE_DEFS[pendingShape].defaultAspect} fit />}
            name={appConfig.copy.shapes.names[pendingShape] ?? appConfig.copy.shapes.kindLabel} />
        }
        // the Grundriss preset names itself in the mode's place: «Linie · Wand»
        const name = grundriss
          ? `${armedToolName(tool, appConfig.copy.planTools)} · ${appConfig.copy.whiteboard.grundriss[grundriss]}`
          : armedToolName(tool, appConfig.copy.planTools, { lineMode, areaMode })
        const icon = armedToolIcon(tool, appConfig.copy.planTools)
        if (!name || !icon) return null
        return <ArmedToolPill glyph={<Icon id={icon} />} name={name} />
      })()}

      {pendingShape && tool === 'shape' && (
        <ToolDock groups={[
          [{ type: 'close', onClick: () => { setPendingShape(null); setRotStart(null); setTool('pan') } }],
          // currentColor, not #fff: the dock is light by day since 20.10.2026 (3am sweep, nit)
          [{ type: 'glyph', node: <ShapeGlyph kind={pendingShape} color="currentColor" aspect={SHAPE_DEFS[pendingShape].defaultAspect} fit /> }],
          // «mehrere nacheinander» has no meaning for a shape laid between two named places
          ...(SHAPE_TWO_POINT[pendingShape] ? [] : [[{ type: 'toggle' as const, icon: 'place-repeat', label: appConfig.copy.keepPlacing, on: placeLock, onClick: () => setPlaceLock((v) => !v) }]]),
          [{ type: 'info', text: !SHAPE_TWO_POINT[pendingShape] ? appConfig.copy.dockHints.shape
            : rotStart ? appConfig.copy.dockHints.rotationEnd : appConfig.copy.dockHints.rotationStart }],
        ]} />
      )}



      {/* selected-symbol editor — the SAME ContextPanel the Lage map uses, so a plan
          symbol now exposes label / fields / notes / count / rotation identically */}
      {/* rendered in read-only too (viewer / EL view): tapping a plan symbol shows its
          details; the readOnly prop strips every edit affordance inside the panel. */}
      {editorSlotFree && selSymbol && (
        <ContextPanel
          key={selSymbol.id}
          // ⚠️ `floor` is remapped, not spread through: on a BoardAnno that name is the
          // floor-stack TILE INDEX, while the panel's `floor` is the signed Stockwerk badge
          // (see types · BoardAnno.storey). Handing the tile index to the stepper would have
          // shown «+3» for the third sheet and moved the symbol to another storey on a tap.
          // On the Gebäude stack the tile seeds BOTH ends of Von/Bis (anno.floor, absent = 0) – the
          // storey vocabulary is the same as on the Karte (15.09.2026); a span set here shows the
          // symbol as copies on every tile it covers.
          entity={{ ...selSymbol, floor: stack ? undefined : selSymbol.storey, ...(stack ? { floorFrom: selSymbol.floorFrom ?? selSymbol.floor ?? 0, floorTo: selSymbol.floorTo ?? selSymbol.floorFrom ?? selSymbol.floor ?? 0 } : {}) }}
          readOnly={readOnly}
          svg={selSymbol.symbol ? sym.byName[selSymbol.symbol] ?? '' : ''}
          onClose={() => setSelId(null)}
          // ⚠️ Live while typing, one step on blur — the same split the Lage's symbol panel has
          // (IncidentWorkspace · titleLiveRef) and the same one the plan's LINE label already had.
          // Committing only on blur meant the glyph on the board still read «Fahrzeug» while the
          // panel already said «TLF 1»: on the Lage the caption follows the keystrokes, on the plan
          // it did not, and the surface you were looking at decided which.
          onTitleLive={(v) => {
            if (titleLive.current !== selSymbol.id) { titleLive.current = selSymbol.id; pushPast() }
            patch(selSymbol.id, { label: v })
          }}
          onTitle={(v) => {
            const live = titleLive.current === selSymbol.id
            titleLive.current = null
            if (live) emit('board.edit', { id: selSymbol.id, patch: { label: v }, planId: activeId })
            else patchCommit(selSymbol.id, { label: v })
          }}
          onFields={(fields) => {
            const before = selSymbol.fields ?? {}
            // a Messpunkt's history grows in the same step (lib/symbols · recordReading)
            patchCommit(selSymbol.id, { fields, ...readingPatch(selSymbol, fields) })
            for (const [k, v] of Object.entries(fields)) {
              if (v.trim() && before[k] !== v) onRosterField?.(selSymbol.symbol, selSymbol.label, k, v)
            }
          }}
          onNotes={(v) => patchCommit(selSymbol.id, { notes: v || undefined })}
          // Stockwerk — the Lage has always offered it, the Modul boards never did, so a Brand
          // drawn on «Modul 2» could not say which storey it was on. Absent on the Gebäude
          // floor-stack ALONE: there the sheet the symbol sits on IS the storey.
          // the span («Von/Bis») is the same optional extra on both surfaces – the panel keeps it
          // behind «Über mehrere Geschosse» unless it is set (ContextPanel · showFloorRange)
          onFloorFrom={(f) => patchCommit(selSymbol.id, stack
            ? { floorFrom: f ?? undefined, floorTo: selSymbol.floorTo ?? selSymbol.floor ?? 0 }
            : { storey: undefined, floorFrom: f ?? undefined, floorTo: selSymbol.floorTo ?? selSymbol.storey })}
          onFloorTo={(f) => patchCommit(selSymbol.id, stack
            ? { floorFrom: selSymbol.floorFrom ?? selSymbol.floor ?? 0, floorTo: f ?? undefined }
            : { storey: undefined, floorFrom: selSymbol.floorFrom ?? selSymbol.storey, floorTo: f ?? undefined })}
          onSpread={(s) => patchCommit(selSymbol.id, { spread: s ?? undefined })}
          onCount={(n) => patchCommit(selSymbol.id, { count: n && n > 1 ? n : undefined })}
          onRotate={(deg) => patchCommit(selSymbol.id, { rotation: deg ?? undefined })}
          onRotate2={(deg) => patchCommit(selSymbol.id, { rotation2: deg ?? undefined })}
          onCaption={(m) => patchCommit(selSymbol.id, { caption: m })}
          captionDefault={captionMode}
          onAirflow={(extract) => patchCommit(selSymbol.id, { extract: extract || undefined })}
          // every symbol on a storey tile has storeys – whatever its preset says about the badge
          controls={stack ? new Set([...symbolControls(selSymbol.symbol, sym.symbols.find((x) => x.name === selSymbol.symbol)?.cat), 'floorRange']) : symbolControls(selSymbol.symbol, sym.symbols.find((x) => x.name === selSymbol.symbol)?.cat)}
          titleOptions={symbolTitleOptions(selSymbol.symbol, sym.symbols.find((x) => x.name === selSymbol.symbol)?.cat)}
          fieldOptions={symbolFieldOptions(selSymbol.symbol, sym.symbols.find((x) => x.name === selSymbol.symbol)?.cat, rosterNames)}
          rosterRank={rosterRank}
          // who that name already is, on the entry itself + under the filled field — the Lage has
          // shown both since the roster pickers existed, the plan showed neither, so naming a
          // Fahrer who is under Atemschutz was silent on exactly the surface a Zugführer works on
          personStatus={personStatus}
          fieldHints={fieldHints?.(selSymbol.symbol, selSymbol.label, selSymbol.fields)}
          // Symbol→Mittel, identical to the map: a placed TLF books onto the Material sheet from
          // here too. Only where the station mapped material to symbols (the prop is absent
          // otherwise), and never read-only.
          protectedKeys={new Set(symbolPresetFieldKeys(selSymbol.symbol, sym.symbols.find((x) => x.name === selSymbol.symbol)?.cat))}
          connectedLines={annos.filter((a) => [a.startAttachment, a.endAttachment].some((rel) => rel?.target.kind === 'object' && rel.target.id === selSymbol.id)).map((a) => ({ id: a.id, label: lineLabel(a) }))}
          onFocusLine={(id) => setSelId(id)}
          onDelete={() => void removeWithConnections(selSymbol)}
          // only where being over means something (lib/objectDone · offersDone) — the Karte's rule
          onDone={!readOnly && (offersDone(selSymbol.symbol, sym.symbols.find((x) => x.name === selSymbol.symbol)?.cat) || !!doneOf(selSymbol))
            ? (on) => setAnnoDone(selSymbol, on) : undefined}
        />
      )}

      {/* note detail panel — the same ContextPanel, opened by the tap that selects the note (see
          notePanelId) and by placing one. The note's TEXT is its title, so the panel's title
          field edits the note itself. */}
      {editorSlotFree && selNote && (
        <ContextPanel
          key={selNote.id}
          entity={{ ...selNote, label: selNote.text, subtitle: appConfig.copy.notes.section }}
          readOnly={readOnly}
          // a note that was just put down opens ready to be written (see notePlacedId)
          autoFocusNote={notePlacedId === selNote.id && !readOnly}
          onClose={() => setNotePanelId(null)}
          // one checkpoint when typing starts, one audit row on blur — the live `patch` writes
          // without a checkpoint, so committing again on blur used to snapshot the ALREADY typed
          // text and «Rückgängig» after renaming a note did nothing at all.
          onTitleLive={(v) => {
            if (titleLive.current !== selNote.id) { titleLive.current = selNote.id; pushPast() }
            patch(selNote.id, { text: v })
          }}
          onTitle={(v) => {
            const live = titleLive.current === selNote.id
            titleLive.current = null
            if (live) emit('board.edit', { id: selNote.id, patch: { text: v }, planId: activeId })
            else patchCommit(selNote.id, { text: v })
          }}
          onFields={(fields) => patchCommit(selNote.id, { fields })}
          onNotes={(v) => patchCommit(selNote.id, { notes: v || undefined })}
          // a width set by hand ends the auto-fit; the size-slider step keeps it and re-measures
          // …each style edit is remembered as the NEXT note's default too («D pur», 09.09.:
          // the Notiz dock carries no style controls any more — this is the stickiness)
          onNoteSize={(s) => {
            patchCommit(selNote.id, selNote.noteAutoW
              ? { noteSize: s, wN: autoNoteWN(selNote.text ?? '', txtBase * scale * noteScale(s), sW) }
              : { noteSize: s })
            setNoteDefaults((d) => ({ ...d, size: s ?? 'm' }))
          }}
          onNotePlain={(p) => { patchCommit(selNote.id, { notePlain: p || undefined }); setNoteDefaults((d) => ({ ...d, plain: p })) }}
          onColor={(c) => { patchCommit(selNote.id, { color: c || undefined }); setNoteDefaults((d) => ({ ...d, color: c })) }}
          onDelete={() => { setNotePanelId(null); void removeWithConnections(selNote) }}
        />
      )}

      {/* selected stroke / Linie / Fläche editor — the SAME shared DrawEditor the Lage map uses, so a
          plan line/area exposes the line presets (Freihand/Messpfeil/Rettungsachse) + colour / width /
          style / label / marker / arrow identically. Distance is omitted (a plan has no metric scale). */}
      {/* …and it opens in read-only too, like the ContextPanel two blocks up and like the Lage's
          own locked DrawEditor: an Einsatzleiter tapping a Leitung on the plan gets its Länge,
          its Leitung-Nr. and the Trupp on it. The panel strips every control that would change
          the shape itself (DrawEditor · readOnly). */}
      {editorSlotFree && selDraw && (
        <DrawEditor
          key={selDraw.id}
          readOnly={readOnly}
          drawing={{ kind: selDraw.kind as 'draw' | 'area' | 'circle', radiusM: selCircleM, color: selDraw.color, width: selDraw.width, dashed: selDraw.dashed, label: selDraw.label, marker: selDraw.marker, arrow: selDraw.arrow, arrowStop: selDraw.arrowStop, showDistance: selDraw.showDistance, fillOpacity: selDraw.fillOpacity, hatch: selDraw.hatch, teilstueck: selDraw.teilstueck, content: selDraw.content, lineNo: selDraw.lineNo, role: selDraw.role, floorTag: stack ? selDraw.floorTag ?? selDraw.floor ?? 0 : selDraw.floorTag, startAttachment: selDraw.startAttachment, endAttachment: selDraw.endAttachment }}
          pointCount={selDraw.pts?.length ?? 0}
          /* the distance toggle appears once the plan is calibrated against its printed scale bar */
          supportsDistance={calibrated}
          /* same Messung section as the Lage, in the plan's calibrated metres — but no
             Höhenprofil: a building plan carries no height data */
          lengthM={selDraw.pts && selDraw.pts.length >= 2 ? planMetres(selDraw.pts.map(([x, y]) => [x, y])) : null}
          /* …and a Fläche measures itself the same way the Lage's does — Fläche + Umfang, in the
             plan's calibrated metres. Without these the Messung section simply never appeared for
             an area on a plan, so a Sektor drawn on Modul 2 could state neither. */
          areaM2={selCircleM != null ? Math.PI * selCircleM ** 2
            : selDraw.kind === 'area' && calibrated && activeScale && (selDraw.pts?.length ?? 0) >= 3
            ? polyAreaM2(selDraw.pts!.map(([x, y]) => [x, y]), activeScale.mPerU, measureAR) : null}
          perimeterM={selCircleM != null ? 2 * Math.PI * selCircleM
            : selDraw.kind === 'area' && (selDraw.pts?.length ?? 0) >= 3
            ? planMetres([...selDraw.pts!, selDraw.pts![0]].map(([x, y]) => [x, y])) : null}
          // …the ground box, measured through `planMetres` like every other plan distance, so the
          // sheet's scale AND its aspect ratio are honoured exactly once (lib/geo · bboxSizeM is
          // the map's twin of this)
          // a circle's box is its bounding square — the diameter each way, exactly as the Karte
          // states it (IncidentWorkspace · the map DrawEditor)
          boxM={selCircleM != null ? { widthM: 2 * selCircleM, heightM: 2 * selCircleM }
            : selDraw.kind === 'area' && calibrated && activeScale && (selDraw.pts?.length ?? 0) >= 3
            ? (() => {
                const xs = selDraw.pts!.map(([x]) => x), ys = selDraw.pts!.map(([, y]) => y)
                const [x0, x1] = [Math.min(...xs), Math.max(...xs)]
                const [y0, y1] = [Math.min(...ys), Math.max(...ys)]
                const widthM = planMetres([[x0, y0], [x1, y0]])
                const heightM = planMetres([[x0, y0], [x0, y1]])
                // planMetres answers null on an uncalibrated sheet; `calibrated` is already
                // checked above, so this only narrows the type
                return widthM == null || heightM == null ? null : { widthM, heightM }
              })()
            : null}
          // a style edit changes THIS ink only – the next one starts from INK_DEFAULTS again
          onColor={(c) => patchCommit(selDraw.id, { color: c })}
          onDashed={(d) => patchCommit(selDraw.id, { dashed: d })}
          // ⚠️ Live while typing, one step on blur — the same split the Lage got (useMapDrawing ·
          // patchDrawingLabelLive). Through `patchCommit` every keystroke was its own undo step and
          // its own audit event: eleven of each for the word «Sicherung».
          onLabel={(label) => {
            if (labelLive.current !== selDraw.id) { labelLive.current = selDraw.id; pushPast() }
            patch(selDraw.id, { label: label || undefined })
          }}
          onLabelCommit={(label) => {
            const live = labelLive.current === selDraw.id
            labelLive.current = null
            if (live) emit('board.edit', { id: selDraw.id, patch: { label: label || undefined }, planId: activeId })
            else patchCommit(selDraw.id, { label: label || undefined })
          }}
          onMarker={(m) => patchCommit(selDraw.id, { marker: m || undefined })}
          onArrow={(a) => patchCommit(selDraw.id, { arrow: a || undefined })}
          onEnding={(ending) => void changePlanEnding(ending)}
          onReverse={selDraw.kind === 'draw' ? reverseAnno : undefined}
          // a Wand is Grundriss, not a hose: no Typ, no Leitung Nr., no Trupp (types · role)
          onContent={selDraw.role ? undefined : (content) => patchCommit(selDraw.id, { content })}
          onLineNo={selDraw.role ? undefined : (lineNo) => { patchCommit(selDraw.id, { lineNo }); onLineRenumber?.(selDraw.id, lineNo) }}
          // on the stack the line's storey is its tile: stepping it MOVES the line rather than
          // writing a badge (lib/whiteboard · movedToStorey)
          onFloorTag={stack ? (floorTag) => moveLineToStorey(selDraw.id, floorTag) : (floorTag) => patchCommit(selDraw.id, { floorTag })}
          onTrupp={onLinkLineTrupp && !selDraw.role ? (truppId) => onLinkLineTrupp(selDraw.id, truppId) : undefined}
          trupps={trupps.filter((t) => t.status !== 'raus').map((t) => ({ id: t.id, name: t.name }))}
          usedLineNos={annos.filter((a) => a.kind === 'draw' && a.id !== selDraw.id && a.lineNo != null).map((a) => a.lineNo!)}
          truppOnLine={truppForLine(selDraw, trupps)?.name}
          truppOnLineOut={truppIsOut(truppForLine(selDraw, trupps))}
          onShowTrupp={onShowTrupp && truppForLine(selDraw, trupps) ? () => onShowTrupp(truppForLine(selDraw, trupps)!.id) : undefined}
          // Linie ↔ Wand on every sheet, flat plans too (owner 28.10.2026: Lage ↔ Plan parity) –
          // the Wand TOOL stays the Gebäude stack's
          onWand={selDraw.kind === 'draw' ? (wand) => setWallRole(selDraw, wand) : undefined}
          wandBlocked={wandBlockHint(wandBlock(selDraw, trupps, selDraw))}
          onShowDistance={(showDistance) => patchCommit(selDraw.id, { showDistance: showDistance || undefined })}
          // metres in, plan-width fraction out — the stepper only exists on a calibrated sheet
          onRadius={(radiusM) => {
            if (!activeScale) return
            const n = circleRadiusN(radiusM, activeScale.mPerU, measureAR)
            if (n != null) patchCommit(selDraw.id, { radiusN: Math.max(appConfig.drawing.circleMinRadiusN, Math.min(CIRCLE_MAX_N, n)) })
          }}
          onHatch={(hatch, fillOpacity) => patchCommit(selDraw.id, { hatch: hatch || undefined, fillOpacity })}
          attachmentLabels={Object.fromEntries((['start', 'end'] as const).flatMap((endpoint) => {
            const a = endpoint === 'start' ? selDraw.startAttachment : selDraw.endAttachment
            if (!a) return []
            const target = annos.find((x) => x.id === a.target.id)
            const label = target?.kind === 'draw' ? lineLabel(target) : target?.label ?? target?.text ?? appConfig.copy.drawingEditor.line
            return [[endpoint, label]]
          }))}
          onRouting={(endpoint, routing) => {
            const key = endpoint === 'start' ? 'startAttachment' : 'endAttachment'
            const a = selDraw[key]; if (a) patchCommit(selDraw.id, { [key]: { ...a, routing } })
          }}
          onDetach={detachPlanEndpoint}
          onFocusAttachment={(endpoint) => {
            const a = endpoint === 'start' ? selDraw.startAttachment : selDraw.endAttachment
            if (a) setSelId(a.target.id)
          }}
          // Verriegeln — the same control the Lage's line editor has, on the same field name
          // (types · BoardAnno.locked mirrors Drawing.locked). Locking DESELECTS, because a locked
          // shape can no longer be tapped: leaving its panel open would offer edits to something
          // that has just stopped accepting them. ⚠️ Not `readOnly` — that is the whole SURFACE
          // being locked for a viewer, and a viewer may not change this flag at all.
          locked={!!selDraw.locked}
          onToggleLock={readOnly ? undefined : () => {
            patchCommit(selDraw.id, { locked: selDraw.locked ? undefined : true })
            if (!selDraw.locked) setSelId(null)
          }}
          onDelete={() => void removeWithConnections(selDraw)}
          onClose={() => setSelId(null)}
        />
      )}

      {/* selected-shape editor — the SAME colour sheet as the Lage map (size + rotation
          live on the canvas handles). A read-only surface opens it read-only, like the Lage
          (MapDetailPanels): what the Form is, no control (RBAC audit 22.10.2026). */}
      {editorSlotFree && !readOnly && selShape && (
        <ShapeEditor
          key={selShape.id}
          entity={selShape}
          onColor={(c) => patchCommit(selShape.id, { color: c })}
          // ±25 % steps scale BOTH axes: sizeN is the width and the height is width × aspect
          onScale={(f) => patchCommit(selShape.id, { sizeN: Math.max(SHAPE_MIN_N, Math.min(SHAPE_MAX_N[selShape.shape ?? 'square'], (selShape.sizeN ?? SHAPE_DEFS[selShape.shape ?? 'square'].defaultSizeN) * f)) })}
          // A Rotation has one size and it is the RUN between its two ends; the loop's width
          // follows from it. Same rebuild as the Lage map, in plan-width fractions — the buttons
          // are the two ends' gesture in fixed steps (lib/shapes · rotationBox).
          onScaleLength={(f) => {
            const run = rotationRun(selShape.sizeN ?? SHAPE_DEFS.rotation.defaultSizeN, selShape.aspect)
            const box = rotationBox(Math.max(SHAPE_MIN_N, Math.min(rotN.maxN, run * f)), rotN.w)
            patchCommit(selShape.id, { sizeN: box.size, aspect: Math.round(box.aspect * 1000) / 1000 })
          }}
          onStop={(v) => patchCommit(selShape.id, { stop: v })}
          onCarrier={(v) => patchCommit(selShape.id, { carrier: v })}
          onReverse={() => patchCommit(selShape.id, { reverse: !selShape.reverse || undefined })}
          onStrokeW={(w) => patchCommit(selShape.id, { strokeW: w })}
          onFill={(fillOpacity, hatch) => patchCommit(selShape.id, { fillOpacity, hatch: hatch || undefined })}
          onCorners={(sharp) => patchCommit(selShape.id, { sharpCorners: sharp || undefined })}
          // locking DESELECTS (same as a locked Fläche): the ink goes click-through and the
          // LockChip becomes the only door back in
          onToggleLock={() => { patchCommit(selShape.id, { locked: !selShape.locked || undefined }); if (!selShape.locked) setSelId(null) }}
          locked={selShape.locked}
          onDelete={() => void removeWithConnections(selShape)}
          onClose={() => setSelId(null)}
        />
      )}
      {editorSlotFree && readOnly && selShape && (
        <ShapeEditor key={selShape.id} readOnly entity={selShape} onClose={() => setSelId(null)} />
      )}

      {copyFrom != null && stack && (
        <StoreyCopySheet from={copyFrom}
          storeys={allFloorsTTB.map((f) => ({ floor: f, name: storeyName(f), items: grundrissOf(annos, f, isGebaeudeSymbol) }))}
          onCopy={(targets) => copyStorey(copyFrom, targets)} onClose={() => setCopyFrom(null)} />
      )}

      {paletteOpen && sym.ready && (
        <Palette sym={sym} onPick={pickSymbol} onPickShape={pickShape}
          // PHONE: the draw tools, the Notiz and the Trupp are the sheet's first section there —
          // the same five the Karte's sheet carries (lib/toolFold), by the plan's own ids
          tools={planTools} onPickTool={(id) => { setPaletteOpen(false); setTool(id as BoardTool); setPending(null) }}
          onClose={() => { setPaletteOpen(false); if (!pending && !pendingShape) setTool('pan') }} />
      )}

      {truppPick && (
        /* ⚠️ Modal → lib/overlays (focus trap + restore, scroll-lock, Esc, backdrop dismissal).
           The hand-rolled scrim it replaces had none of those, and the board's own Escape handler
           fired underneath it. The hand-rolled carve-out (docs/ui-conventions.md · Overlays) is for the NON-modal tool docks. */
        <Overlay open onClose={() => setTruppPick(null)} className="wb-trupp-pick ui-dialog" ariaLabel={appConfig.copy.whiteboard.selectTrupp}>
          <div className="wb-trupp-pick-head">{appConfig.copy.whiteboard.selectTrupp}</div>
          {/* twin of the Lage picker (IncidentWorkspace): a Trupp already on THIS plan is
              greyed out, because picking it would move its chip rather than add one. One on
              the map or another plan stays selectable — that is a real move.
              ⚠️ …and one that is OUT is offered too (05.09.), for the reason the Lage's twin
              spells out: the crew at the vehicle is exactly the one whose place gets asked
              about. It says «Draussen» rather than being withheld. */}
          {trupps.map((t) => {
            const here = !!t.annoId && t.planId === activeId
            return (
              <button
                key={t.id} className={`wb-trupp-opt${here ? ' placed' : ''}`} disabled={here}
                onClick={() => { placeTeamChip(truppPick.x, truppPick.y, truppPick.floor, t); setTruppPick(null) }}
              >
                <span className="wb-trupp-cap" /><b>{t.name}</b>
                {/* «AS» — this crew is under Presslufatmer. Both lists mix Atemschutz-Trupps and
                    work squads, and the difference matters before the chip lands. Quiet blue: a
                    fact about the Trupp, never the board's amber/red (a clock running out). */}
                {isAtemschutzTrupp(t) && <span className="wb-trupp-as" title={appConfig.copy.atemschutz.kindAtemschutz}>{appConfig.copy.atemschutz.asMark}</span>}
                {here
                  ? <i>{appConfig.copy.whiteboard.truppPlacedHere}</i>
                  : t.status === 'raus' ? <i>{appConfig.copy.atemschutz.status.raus}</i>
                  : (t.lineNo != null || t.lineNumber) ? <i>Ltg {t.lineNo ?? t.lineNumber}</i> : null}
              </button>
            )
          })}
          <button className="wb-trupp-opt wb-trupp-generic" onClick={() => { placeTeamChip(truppPick.x, truppPick.y, truppPick.floor); setTruppPick(null) }}>
            <Icon id="plus" />{appConfig.copy.whiteboard.newTeam}
          </button>
        </Overlay>
      )}

      {/* Messen — the SAME panel the Lage map uses (bottom-centred); metrics come from the plan
          calibration (no elevation profile), and it nudges to calibrate until a scale is set. */}
      {tool === 'measure' && (
        <MeasurePanel
          mode={measMode}
          coords={measPath}
          profile={null}
          profileLoading={false}
          showProfile={false}
          metrics={{ lengthM: measLenM, areaM2: measAreaM2, perimeterM: measPerimM }}
          blocked={!calibrated}
          hint={readOnly ? appConfig.copy.whiteboard.scale.needsCalibrationViewer : appConfig.copy.whiteboard.scale.needsCalibration}
          // «Als Linie/Fläche übernehmen»: the measured nodes become a real Linie resp. Fläche on
          // this plan. Board coords are whole-board normalized, so each point is folded back into
          // its storey tile (the space every stored `pts` lives in) before addLine/addArea sees it.
          // Unreachable while the plan is uncalibrated — the panel then shows the hint, not the
          // readout, so neither adopt button is rendered.
          onAdopt={!readOnly && measPath.length >= (measMode === 'line' ? 2 : 3)
            ? () => {
                // a Linie keeps the storey under each node; a Fläche lives on ONE storey — its
                // first point's — exactly like the node tool, which pins every vertex of a ring
                // to the floor it was started on.
                const floorOf = (y: number) => (stack ? floorAt(y) : draftFloorRef.current)
                const ringFloor = floorOf(measPath[0][1])
                const pts: BoardPoint[] = measPath.map(([x, y]) => {
                  const f = measMode === 'line' ? floorOf(y) : ringFloor
                  return [x, localY(y, f), f]
                })
                measReset()
                if (measMode === 'line') addLine(pts)
                else addArea(pts)
              }
            : undefined}
          // ⚠️ NOT offered on an automatically referenced sheet. `scaleAuto` means the metres come
          // from the Kartenverknüpfung, and the same rule the Plan sheet's Massstab follows holds here:
          // an automatic scale is a READING, never a shortcut into a second, competing manual
          // calibration. «Neu kalibrieren» under a plan that is already tied to the map read as
          // «this is not calibrated» — the opposite of the truth. The reading takes its place.
          onCalibrate={readOnly || scaleAuto ? undefined : () => setTool('scale')}
          calibrateLabel={appConfig.copy.whiteboard.scale.calibrate}
          recalibrateLabel={appConfig.copy.whiteboard.scale.recalibrate}
          /* …and it names the RIGHT source. Same discriminator as the Plan sheet's Massstab (factsScale): only a
             georef fit comes «aus der Kartenverknüpfung» — the Gebäude's scale comes from its
             Grundriss, and the panel used to tell the operator about a link the stack has not got. */
          scaleNote={scaleAuto
            ? georefFit || packMPerU ? appConfig.copy.whiteboard.scale.chipAutoHint : appConfig.copy.whiteboard.scale.chipAutoStackHint
            : undefined}
        />
      )}

      {/* Maßstab — metre-entry popover after the two reference taps: a clean −/+ stepper */}
      {calPrompt && (
        <PlanScalePrompt refMInput={refMInput} setRefMInput={setRefMInput}
          onCommit={commitCalibration} onClose={closeCalPrompt} />
      )}

      {/* The facts about a plan that no page of it states — WHICH object, at what scale, and how it
          sits on the map — in one row in the stage's quiet corner, and since sweep 28.10.2026 (#8)
          behind ONE chip: the Objekt (on the Gebäude: the building) with one lamp, the sheet
          behind it (PlanFactsSheet, see `factsShown`). Objekt and Maßstab were a bespoke glass
          chip in the top-left and a pill down here until 26.09.; then three pills, two of them
          lamps for one subject. */}
      {!georefArmed && nearbyBanner}
      <div className="wb-botleft">
      {/* ⚠️ While «Karte verknüpfen» is armed, this row carries the INSTRUMENT and nothing else.
          One mode, one indicator: the facts that were in this row are not what anyone is reading
          mid-pairing. They come straight back when the mode ends. On a phone the instrument is the
          bar instead (GeorefMode · GeorefModeBars), so this row simply stays empty of it. */}
      {georefArmed && !isPhone ? <GeorefInstrument mode={georef} /> : <>
      {/* the Tafel's pages: «which sheet», in the row where a plan says «which place» (owner).
          R1 (owner, 27.10.2026): the Objekt shares ONE glass with its Gebäude-Info, each half its
          own tap. Calibrating, the chip gives its place to the instrument (`calibrateChip`). */}
      {strip}
      {calibrateChip ?? <>
      <span className="wb-join">{objectChip}{buildingFloat}</span>
      {buildingChip}
      </>}
      {readingsChip}
      </>}
      </div>

      {/* #3: persist a fresh calibration station-wide so plans measure out of the box next time */}
      {savePrompt && !readOnly && (
        <PlanScalePersist scale={savePrompt} activeId={activeId} onDone={() => setSavePrompt(null)} />
      )}

      {/* The Plan sheet (PlanFactsSheet) — in the Passung's dock, one row above the chip that
          opened it on a tablet, the slide-up sheet on a phone.
          ⚠️ Deliberately NOT the shared <Popover>. That one is modal-ish by construction: it
          portals, manages focus and dismisses on the first press anywhere outside — over a LIVE
          board that means the next tap on a symbol is eaten by the dismissal instead of
          selecting it. src/lib/overlays/Popover.tsx says exactly this in its own header: for
          surfaces that must stay live underneath, keep the hand-rolled dock. */}
      {factsOpen && (
        <GeorefDock label={factsTitle} onClose={closeFacts}>
          <PlanFactsSheet title={factsTitle} onClose={closeFacts} place={factsPlace} link={factsLink} scale={factsScale} />
        </GeorefDock>
      )}

      {georefTransferOpen && active && georefTransferTargets.length > 0 && (
        <GeorefTransfer
          source={active}
          targets={georefTransferTargets}
          onTransfer={transferGeoref}
          onClose={() => setGeorefTransferOpen(false)}
          onDone={() => { setGeorefTransferOpen(false); setQualityFor(null) }}
        />
      )}

      {/* the dashed seam, and nothing but it: the boundary the split created. It carries no
          label — the mode's instruction and the way out are the chip row's instrument on a
          tablet and a shell-level bar on a phone (this component is unmounted for the map half
          of every pair there). See GeorefMode · GeorefSplitSeam. */}
      {georefArmed && !isPhone && <GeorefSplitSeam />}
    </div>
  )
}
