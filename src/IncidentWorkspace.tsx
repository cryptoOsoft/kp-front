// One open Einsatz – the shell App mounts per incident: it holds the workspace blob and its sync,
// the ONE undo timeline, the Verlauf writers and the rail's surfaces (Lage, Plan, Checklisten,
// Atemschutz, Anwesenheit, Mittel, Rapport), and hands each surface its slice. Split-out pieces
// live in src/workspace/. It stays mounted while another surface is in front (`covered`), so its
// sync, live poll and Atemschutz alarm keep running.
// Rules: every mutation joins the one timeline (docs/undo.md); synced state and the record:
// docs/sync-and-offline.md.

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type MouseEvent as ReactMouseEvent, type ReactNode } from 'react'
import type { MapRef } from 'react-map-gl/maplibre'
import './app.css'
import { IconSprite } from './lib/icons'
import { layerPreset } from './lib/layerPreset'
import { prefersReducedMotion } from './lib/reducedMotion'
import { useSymbols } from './lib/useSymbols'
import { useVehicleLayer } from './lib/useVehicleLayer'
import { usePersonPositions } from './lib/usePersonPositions'
import { useShareMyPosition } from './lib/useShareMyPosition'
import { useViewportPan } from './lib/useViewportPan'
import { useScrollFocusIntoView } from './lib/useScrollFocusIntoView'
import { SharePositionSheet } from './components/SharePosition'
import { autoActivateLayers, defaultLayers, deriveInitial, sanitizeWorkspace, type ReportMeta, type Saved } from './lib/workspace'
import { themeToken } from './lib/themeToken'
import { UNDERGROUND_LAYER_ID, undergroundOverlay, useUnderground } from './lib/underground'
import { type PlanFit } from './lib/tacticalObjects'
import { useReplay } from './lib/useReplay'
import { isTypingTarget } from './lib/hotkeys'
import { navStops } from './lib/navRail'
import { incident as demoIncident, planDocuments, gebaeudeDoc, preparedOverlays } from './data/demoIncident'
import { ergRingOverlays } from './lib/ergRings'
import { useHazardData } from './lib/useHazardData'
import type { BoardAnno, Drawing, Entity, Incident, LayerDef, LayerId, LngLat, MittelEntry, ReactivateResult, TimelineEvent, Trupp, BuildingDoc } from './types'
import { appConfig } from './config/appConfig'
import { clearAllDrafts } from './lib/draftKeep'
import { newRowId } from './lib/ids'
import { atemschutzDoctrine, getDeploymentConfig, deploymentDefaultCenter, isDemoMode } from './lib/deploymentConfig'
import { countSurface } from './lib/visitBeacon'
import { fillTemplate, formatTime } from './lib/format'
import { addSignature, shortChecksum, voidAll, type ReportSignature } from './lib/reportSignature'
import { circlePolygon } from './lib/geo'
import { isPresent } from './lib/attendanceIntervals'
import { registerMeldeleisteHost } from './lib/meldeleisteHost'
import { editorPrintTransport, fetchPrintStatus, type PrintRelayStatus } from './lib/printRelay'
import { conflictResolvedRow, openConflicts, type OpenConflict } from './lib/attendanceConflict'
import { isBottomSheet, rectCenter, visibleWorkRect, type NudgeBox } from './lib/panelNudge'
import { useMeasure } from './lib/useMeasure'
import { useCoordPicker, type CoordPicker } from './lib/useCoordPicker'
import { useObjectStore } from './lib/useObjectStore'
import { recordKey, type RecordedField, type RecordKey } from './lib/undoKeys'
import { useGpsFollow } from './lib/useGpsFollow'
import { freshBefore, gpsReleaseRow, gpsRevertWords, routingPatch, useGpsNotices, type GpsEnd } from './lib/gpsReturn'
import { useUndoTimeline } from './lib/useUndoTimeline'
import { undoCaption, type Dropper, type UndoDomain } from './lib/undoTimeline'
import { clearUndoCaption, flashUndoCaption } from './lib/undoFlash'
import { useUndoableSlice, type UndoableSlice } from './lib/useUndoableSlice'
import { useJournal } from './lib/useJournal'
import { useWakeLock } from './lib/useWakeLock'
import { toast, confirmDialog, undoToast } from './lib/ui'
import { usePlacementLane } from './lib/toastLane'
import { initialMode, loadPrefs, savePrefs } from './lib/prefs'
import { makePhotoPositionSource } from './lib/devicePosition'
import { useAttendanceActions } from './lib/useAttendanceActions'
import { changedAttendanceNames } from './lib/attendanceDiff'
import { useChecklistActions } from './lib/useChecklistActions'
import { useTeamMarkerActions } from './lib/useTeamMarkerActions'
import { useDevicePrefs } from './lib/useDevicePrefs'
import { useSheets } from './lib/useSheets'
import { useAtemschutzMute } from './lib/useAtemschutzMute'
import { useTacticalSelection } from './lib/useTacticalSelection'
import { useWorkspaceDoc } from './lib/useWorkspaceDoc'
import { addPlanBindings, fillBindingFloors, hasLegacyAlignmentContext } from './lib/incidentPlanBindings'
import { useIncidentPlanBindings } from './lib/useIncidentPlanBindings'
import { buildLabel } from './lib/buildInfo'
import { consumeJustUpdated } from './lib/swUpdate'
import { useIsPhone, useMediaQuery } from './lib/useIsPhone'
import { onReachable } from './lib/connectivity'
import { Splash } from './components/Splash'
import { NavRail } from './components/NavRail'
import { twinVisible, isTwinLayerId } from './lib/georefTwins'
import { slimTools, isMapReadOnlyTool, MAP_READONLY_TOOLS } from './lib/readOnlyTools'
import { SHAPE_TWO_POINT } from './lib/shapes'
import { AtemschutzAlarmMeldungen } from './components/AtemschutzAlarmMeldung'
import { AtemschutzNotfallMeldungen } from './components/AtemschutzNotfall'
import { floorLabel } from './lib/whiteboard'
import { liveTargets } from './lib/verlauf'
import { claimBootNotifyTarget } from './lib/notifyTarget'
import { TabLockBanner } from './components/TabLockBanner'
import { SurfaceBoundary } from './components/SurfaceBoundary'
import { RemindersHost } from './lib/useReminders'
import { useRenderStorm } from './lib/useRenderStorm'
import { AtemschutzAlarmHost } from './lib/useAtemschutzAlarm'
import { truppInNotfall, truppLogName, truppStillRegistered, type AtemschutzAlarmState, type CrewSlot } from './lib/atemschutz'
import { freshNotfallKeys } from './lib/notfall'
import { GeorefModeBars } from './components/GeorefMode'
import { georefDispatch, setGeorefOpenDroppedHandler, useGeorefMode, useGeorefSurfaceBridge } from './lib/georefMode'
import { ReplayBar } from './components/ReplayBar'
import { FabEntry } from './components/FabEntry'
import { useFloatRowPlacement } from './lib/floatRow'
import { prewarmPlans } from './lib/pdfRaster'
import { prefetchOutlines } from './components/OsmOutline'
import {
  WorkspaceSync, 
  type IncidentMeta,
  type Workspace,
  isIncidentRunning,
} from './lib/incidents'
import { useAuditEvents } from './lib/useAuditEvents'
import { EL_EVENT_PREFIXES, eventScopeFor } from './lib/eventScope'
import { combinedSyncStatus } from './lib/combinedSyncStatus'
import { endingFlags, endingWireFlags, type LineEnding } from './lib/drawingEdit'
import { useMapDrawing } from './lib/useMapDrawing'
import { detachDrawings, resolveMapDrawings, wireFreed, withDetach } from './lib/lineAttachments'
import { leitungOptions } from './lib/truppLines'
import { useIncidentSync } from './lib/useIncidentSync'
import { useTruppActions, LAGE_TARGET } from './lib/useTruppActions'
import { useObjectPlans, isSelectOnlySurface, railPlanTiles, BUILDING_PICK_ID } from './lib/useObjectPlans'
import { measuredPoints, type MeasuredPoint } from './lib/readingsList'
import { ReadingsChip } from './components/ReadingsChip'
import { PlanPicker } from './components/PlanPicker'
import { fetchShareLink } from './lib/viewLink'
import { useBuildingInfo } from './lib/useBuildingInfo'
import { useBuildingFirstOpen } from './lib/buildingFirstOpen'
import { useWeather } from './lib/useWeather'
import { einsatzRadarStore, useKarteWeather } from './workspace/useKarteWeather'
import { useBootCover } from './lib/bootCover'
import { ChecklistsView } from './components/ChecklistsView'
import { AtemschutzView, type TruppOrder } from './components/AtemschutzView'
import { AnwesenheitView } from './components/AnwesenheitView'
import { MittelView } from './components/MittelView'
import { usePersonnel } from './lib/usePersonnel'
import { assignedPersonIds, linkTrupps, rosterIdByName as rosterIdByNameOf, truppByPersonId, truppCrewSlots } from './lib/personnel'
import { rosterWithGuests } from './lib/guests'
import type { Item } from './lib/checklists'
import { warmTemplates } from './lib/checklists'
import { primeKeyboard } from './lib/keyboardPrime'
import { createPortal, flushSync } from 'react-dom'
import type { NoteSize } from './types'
import { TruppFinder } from './components/TruppFinder'
import { counterNames, freshTeamLabel, markerOptions, markerSite, teamNoTaken } from './lib/placedTrupps'
import { serverNow, serverNowIso } from './lib/serverClock'
import { clockRestartRowId, clocksAfterReopen } from './lib/reopenClocks'
import { IncidentClosedMeldung, LinkRefusedMeldung } from './components/IncidentClosedMeldung'
import { useGhostTrails } from './lib/useGhostTrails'
import { ghostRevival, ghostTrailLabel, removeGhostTrail, restoreGhostTrail, trailPointCount, trailSources } from './lib/truppTrails'
import { annotatedPlans, changedReportMetaLines, normalizeReportMeta } from './lib/report'
import { useAbschluss } from './lib/useAbschluss'
import { useRowMediaUpload } from './lib/useRowMediaUpload'
import { useGeorefFits } from './lib/useGeorefFits'
import { createEditSettle, entityEditChanges, entityLogName, type EditSettle } from './lib/entityEdit'
import type { PlanStepLink } from './lib/planStepLink'
import { mittelLineCount } from './lib/mittel'
import { autoNoteWPx } from './lib/notes'
import { photoUrlKey, setDevicePositionSource, withPhotoUrls } from './lib/photoGeo'
import { whenIdle } from './lib/idle'
import { useSessionRole, useWorkspaceFlags } from './workspace/access'
import { useOfflinePrefetch } from './workspace/useOfflinePrefetch'
import { loadReportPreflight, loadWhiteboard, requestReportStep } from './workspace/lazySurfaces'
import { useTafelPages } from './workspace/useTafelPages'
import type { OneShotRows, WorkspaceMode } from './workspace/types'
import { WorkspaceMeldungen } from './workspace/WorkspaceMeldungen'
import { WorkspaceSheets } from './workspace/WorkspaceSheets'
import { JournalLayer } from './workspace/JournalLayer'
import { MapToolDocks } from './workspace/MapToolDocks'
import { MapDetailPanels } from './workspace/MapDetailPanels'
import { RapportSurface } from './workspace/RapportSurface'
import { PlansSurface } from './workspace/PlansSurface'
import { MapControls } from './workspace/MapControls'
import { WorkspaceTopBar } from './workspace/WorkspaceTopBar'
import { MapStage } from './workspace/MapStage'
import { usePlanStacks } from './workspace/usePlanStacks'
import { useGebaeudeActions } from './workspace/useGebaeudeActions'
import { useJournalWriters } from './workspace/useJournalWriters'
import { useWorkspaceBlob } from './workspace/useWorkspaceBlob'
import { prefs } from './workspace/bootPrefs'
import { ATTENDANCE_RECORDS } from './workspace/recordShapes'
import { useMapActions } from './workspace/useMapActions'
import { useRecordSlices } from './workspace/useRecordSlices'
import { useRosterRoles } from './workspace/useRosterRoles'
import { useMediaOutbox } from './workspace/useMediaOutbox'
import { useLifecycleElsewhere } from './workspace/useLifecycleElsewhere'

/** How long an edit has to sit still before it earns a Verlauf row. Long enough that a sentence
 *  being typed is ONE edit, short enough that reading the Verlauf a moment later already shows
 *  it. Shared by the Rapportangaben logger and the Kroki symbol-edit logger — both write on
 *  every keystroke, and both would otherwise produce one row per character. */
const META_LOG_SETTLE_MS = 4000

/** Is the caret in a free-text Rapportangabe right now? Read off the `[data-sync]` markers the
 *  ReportPreflight puts on every synced field (its own focus bookkeeping runs on the same
 *  attribute). Free-TEXT only: a settle window held open by a focused Stepper button or a
 *  datetime input would never close — those keep the plain 4 s fallback (decided 29.08.). */
function isTypingMetaField(): boolean {
  const el = focusedElement()
  return !!el?.closest?.('[data-sync]') && isFreeText(el)
}

/** …and the same question for a symbol's own editor: the ContextPanel marks its free-text blocks
 *  with `data-entity-edit`. Its Notiz field commits on BLUR, and on a tablet one sentence gets
 *  blurred and picked up again three times — which is how «Notiz «1 Roller in en»», «…in ennen»
 *  and «…innen» reached the 03.09. Rapport as three rows. While the caret is back in one of those
 *  fields the Verlauf row waits (lib/entityEdit · createEditSettle). */
function isTypingSymbolField(): boolean {
  const el = focusedElement()
  return !!el?.closest?.('[data-entity-edit]') && isFreeText(el)
}

const focusedElement = (): HTMLElement | null =>
  typeof document === 'undefined' ? null : (document.activeElement as HTMLElement | null)

/** Free TEXT only: a window held open by a focused Stepper button or a datetime input would never
 *  close — those keep the plain settle (decided 29.08.). */
function isFreeText(el: HTMLElement): boolean {
  if (el.isContentEditable || el.tagName === 'TEXTAREA') return true
  return el.tagName === 'INPUT' && ['text', 'tel', 'search', 'email'].includes((el as HTMLInputElement).type)
}
// The manually-picked Einsatzobjekt moved from this device cookie into the synced workspace blob
// (per incident). Keep the value in-memory so deriveInitial can import it once this session, then
// clear the legacy cookie field so a later reset can't be resurrected from a stale cookie.
if (prefs.pickedObject) savePrefs({ ...loadPrefs(), pickedObject: undefined })

interface WorkspaceProps {
  incidentMeta: IncidentMeta
  incidents: IncidentMeta[]
  workspace: Workspace | null
  sync: WorkspaceSync
  forceReadOnly: boolean
  /** another tab of THIS browser is editing the incident → read-only here + take-over banner */
  tabLockLost: boolean
  onTakeOverTab: () => void
  onSwitchIncident: (i: IncidentMeta) => void
  onOpenHistory: () => void
  /** opens the Objektbesuche surface (App · enterObjectVisits); undefined = module off */
  onOpenObjectVisits?: (objectId?: string | null) => void
  /** opens «Karte & Objekte» over this Einsatz (App · enterKarte); undefined = a link session */
  onOpenKarte?: () => void
  /** another surface («Karte & Objekte», the Objektbesuche) is in front of this Einsatz: it stays
   *  MOUNTED — its state, sync and live poll, and above all its Atemschutz alarm — but renders
   *  only the headless hosts and the alarm rows (see the `covered` return below) */
  covered?: boolean
  /** bring this Einsatz back in front (App · uncoverEinsatz) — an alarm row's «Zum Trupp» */
  onUncover?: () => void
  onOpenDivera: () => void
  onOpenDatenquellen: () => void
  /** freshly one-tap-taken Divera incident: show the correct-in-place review banner */
  needsReview: boolean
  onReviewDone: () => void
  /** When the Einsatzdaten were reviewed ON THIS DEVICE («Passt» or a saved correction — App's
   *  markReviewed funnels both). Only the workspace can write the incident's blob, so this is
   *  what gets published to the other devices as `intakeReviewedAt`. */
  reviewedLocallyAt?: string
  onEditMeta: () => void
  /** The Abschluss was confirmed here (see `confirmAndComplete`): stamp report_done_at + close.
   *  Resolves TRUE only when the close actually happened — App reports the outcome so a failed
   *  handover (offline, server error) does not pretend to have archived anything.
   *  ⚠️ There is deliberately no second «archive the active one» prop. Both doors — the Rapport
   *  and the Einsatz-Menü row — go through the one confirm and end in this one callback. */
  onCompleteRapport: () => Promise<boolean>
  /** re-open the CLOSED active incident (confirm dialog included) — the banner action */
  onReactivateActive?: () => Promise<ReactivateResult>
  /** leave the archived read-only view — back to the previously active incident, else the
   *  «Alle Einsätze» list it was entered from (everyone, not just editors) */
  onBackFromArchive?: () => void
  /** The Einsatz was closed — or reopened — on ANOTHER device while it was open here (N3,
   *  25.09.2026), and when. App sets it as it flips the meta in place (App · onIncidentClosed /
   *  onIncidentReopened); the workspace says so in one Meldeleiste row. */
  lifecycleElsewhere?: { event: 'closed' | 'reopened'; at: number } | null
  /** This mount OPENS the Einsatz (App · coverId): it assembles behind the snail until the first
   *  screen is whole (lib/bootCover). Not on a background remount. */
  openCover?: boolean
  /** …and the cover has lifted — App forgets it, so a later remount comes up uncovered */
  onOpenCoverDone?: () => void
}


export function IncidentWorkspace({
  incidentMeta, incidents, workspace, sync, forceReadOnly, tabLockLost, onTakeOverTab, onCompleteRapport,
  onSwitchIncident, onOpenHistory, onOpenObjectVisits, onOpenKarte, onOpenDivera, onOpenDatenquellen, onReactivateActive, onBackFromArchive,
  covered = false, onUncover, needsReview, onReviewDone, reviewedLocallyAt, onEditMeta, lifecycleElsewhere, openCover, onOpenCoverDone,
}: WorkspaceProps) {
  const { user, logout, asLink, isEl, linkRefused, roleReadOnly, isEditor, linkScoped } = useSessionRole(incidentMeta)
  // Phones are a live viewer + field-capture device: lock all TACTICAL editing (tools,
  // map drawing/placing, plan annotation) even for a editor — but keep journal capture
  // + sync alive (those hang off `readOnly`, which stays false for a editor). Tablets
  // and desktop keep full editing.
  const isPhone = useIsPhone()
  /** The phone bar's FOLDED shape (18.09.2026): the plan documents collapse into one «Pläne»
   *  tile, and Anwesenheit + Material give up their tiles to become tabs of the Rapport — five
   *  tiles, which is what 360px holds without a sideways scroll. One flag for both folds and for
   *  the surfaces they move, so the bar can never offer a destination that is not there (or
   *  hide one that is). The vertical rail on a tablet/desktop is untouched. */
  const phoneFold = isPhone
  /** The ONE width at which the top bar drops its ↶ ↷ (15-mobile.css · max-width 359px), so the
   *  surface being tapped can offer its own pair instead of leaving the operator with no way back.
   *  ⚠️ NOT «an Atemschutz-Alarmchip is in the bar» any more (15.09.2026). That cost the pair
   *  exactly while a Trupp was überfällig — i.e. exactly when a mis-tap is most likely and the
   *  newest timeline step is a Funkkontakt — and a deleted Leitung became unreachable behind a
   *  loop: ↶ takes the Kontakt back, the Trupp is überfällig again, the pair is gone again. The
   *  Einsatzuhr yields to the chip now; the history pair never does. */
  const topBarUndoHidden = useMediaQuery('(max-width: 359px)')
  // Time-travel replay is a read-only past view: while active it locks ALL editing
  // (folded into both readOnly and tacticalLocked) and swaps the live doc for the
  // reconstructed state. Owned by useReplay; `active` feeds the lock derivations below.
  // the top bar and the nav rail stay put while iOS pans the page under a keyboard
  useViewportPan()
  // …and the field you are actually typing in stays above it (one listener for the whole app)
  useScrollFocusIntoView()
  const { active: replayActive, setActive: setReplayActive, ws: replayWs, onState: onReplayState, onVehicles: onReplayVehicles, exit: exitReplay, entities: replayEntities, board: replayBoard, building: replayBuilding } = useReplay()
  // Seed all state slices once from this incident's workspace (the component is keyed
  // by incident id upstream, so this runs exactly once per incident). The blob passes the
  // sanitize/version gate first — a stale or malformed cached blob must never crash the open.
  const bootGate = useMemo(() => sanitizeWorkspace(workspace), [])  // eslint-disable-line react-hooks/exhaustive-deps
  // …and a blob from a NEWER build makes this one read-only until that build is in (re-read on
  // every poll by useWorkspaceBlob · applyWorkspace; workspace/access · olderBuild)
  const [olderBuild, setOlderBuild] = useState(bootGate.newerSchema)
  const { running, readOnly, outboxReadOnly, canEditIncident, canEditTrupps, canEditRecord, canEditRapport, canEditMeta, canWriteRecord, canWriteBlob, tacticalLocked } =
    useWorkspaceFlags({ user, asLink, isEl, isEditor, roleReadOnly, forceReadOnly, tabLockLost, replayActive, incidentMeta, olderBuild })
  // «Standort zu Fotos» (lib/devicePosition): a session that writes the record lends the device's
  // position to a picture without one — after asking ONCE per device, with the reason.
  const [photoPosition, setPhotoPositionState] = useState<boolean | undefined>(() => loadPrefs().photoPosition)
  const setPhotoPosition = useCallback((v: boolean) => {
    setPhotoPositionState(v)
    savePrefs({ ...loadPrefs(), photoPosition: v })
  }, [])
  useEffect(() => {
    if (!canWriteRecord) return
    const G = appConfig.copy.photoGeo
    setDevicePositionSource(makePhotoPositionSource({
      loadPref: () => loadPrefs().photoPosition,
      savePref: setPhotoPosition,
      ask: () => confirmDialog({ title: G.askTitle, message: G.askMessage, note: G.askNote, confirmLabel: G.askYes, cancelLabel: G.askNo }),
    }))
    return () => setDevicePositionSource(null)
  }, [canWriteRecord, setPhotoPosition])

  // the boot gate (above, before the flags) seeds every slice
  const init = useMemo(() => deriveInitial(bootGate.ws, incidentMeta.id, prefs, incidentMeta.type), [])  // eslint-disable-line react-hooks/exhaustive-deps
  /** the linked plans' fits for the bake, keyed by planId — written where `linkedPlans` is
   *  derived (much further down), read by the object store's writers through this getter, so a
   *  bake always uses the fit that exists NOW rather than the one that existed when the mutator
   *  was created */
  const planFitsRef = useRef<Map<string, PlanFit>>(new Map())
  const getFits = useCallback(() => planFitsRef.current, [])
  /** ⚠️ Bumped when a fit REALLY changes (see the rebake effect far below). Every sheet's view is
   *  derived through those fits, and a ref is invisible to a memo — this is the one value that
   *  tells the store a corrected georeference moved every projection on that sheet. */
  const [fitsVersion, setFitsVersion] = useState(0)
  /** the caption the NEXT store checkpoint carries, when its writer knows a better word than
   *  the domain's — see `onCheckpoint` below */
  const stepLabel = useRef<string | null>(null)
  /** …and the same one-shot caption for the next PLAN step (workspace/usePlanStacks · rememberPlanStep), set by a plan writer
   *  that knows the words for its act (Whiteboard · onStepLabel) */
  const planStepLabel = useRef<string | null>(null)
  /** ONE gesture on a plan is ONE undo step, whichever stack takes it (lib/planStepLink) */
  const planStepLink = useRef<PlanStepLink | null>(null)
  // On open, fit the map to the incident's existing map content (symbols + drawings) instead of
  // zooming onto the bare Einsatzort point — so a pre-filled Lage is framed ("eingepasst"). One
  // snapshot per incident (mirrors `init`), so it never snaps the view back while you draw.
  const initialFitPoints = useMemo<LngLat[] | undefined>(() => {
    const pts: LngLat[] = []
    for (const e of init.doc.entities) if (e.coord) pts.push(e.coord)
    for (const d of init.doc.drawings) {
      // A circle (Absperrkreis / Gefahrenradius) stores only its centre in `coords`, so include
      // its rendered outline so the whole area is framed, not just the point.
      if (d.kind === 'circle' && d.radiusM && d.coords[0]) {
        for (const [lng, lat] of circlePolygon(d.coords[0], d.radiusM, 8)[0]) pts.push([lng, lat])
      } else {
        for (const c of d.coords) pts.push(c)
      }
    }
    return pts.length >= 2 ? pts : undefined  // <2 → MapView keeps the incident-centred default
  }, [])  // eslint-disable-line react-hooks/exhaustive-deps
  const incidentView: Incident = useMemo(() => ({
    type: incidentMeta.type ?? '',
    title: incidentMeta.title,
    address: incidentMeta.address ?? '',
    // center precedence: this incident's own coordinate → the deployment's configured
    // default view (/api/config map.defaultView; WGS84 `center`, else LV95 `centerLv95`
    // converted to WGS84 — the backend rejects both being set) → the neutral bundled
    // fallback center (Switzerland centroid; only hit by a config-less/public build).
    // 0/0 = "no location" (Divera convention; older rows stored it verbatim) — fall back
    // like a missing coordinate instead of centring map + weather on Null Island.
    center: (incidentMeta.lng != null && incidentMeta.lat != null && (incidentMeta.lng !== 0 || incidentMeta.lat !== 0)
      ? [incidentMeta.lng, incidentMeta.lat]
      : deploymentDefaultCenter() ?? demoIncident.center) as LngLat,
    startedAt: incidentMeta.started_at, durationSec: 0, offline: false, cachedTiles: 0, recording: false, recDurationSec: 0,
  }), [incidentMeta])

  // Cross-visibility QR → KP: the QR-usage counters live on the incident meta, and the
  // FRESHEST copy comes from the 30 s incident-list watch (`incidents`) — `incidentMeta`
  // itself is only replaced on open/patch. Chip on the QR-writable surfaces only
  // (Anwesenheit / Mittel / Rapport), deliberately not in the incident switcher.
  const qrMeta = incidents.find((i) => i.id === incidentMeta.id) ?? incidentMeta
  const captureUsage = (qrMeta.capture_writes ?? 0) > 0
    ? { writes: qrMeta.capture_writes ?? 0, lastAt: qrMeta.capture_last_at ?? null }
    : null

  const sym = useSymbols()
  // ── the two «Karte läuft, aber…» rows (02.09.) ─────────────────────────────────────────
  // Symbol pack failed for good (sym.error): Karte and Kroki mount anyway with an empty glyph
  // table, and the Meldeleiste row offers the reload. Dismissed here only; a reload that fails
  // again brings it back (reload() clears `error` first, so the row re-publishes on the next
  // failure).
  const [symbolsRowHidden, setSymbolsRowHidden] = useState(false)
  // No cached basemap for this view while offline (MapView · onBasemapUnavailable). Said ONCE
  // per Einsatz mount — every tile of the view fails, and a dismissed row must not come straight
  // back — and withdrawn the moment the link returns.
  const [noBasemap, setNoBasemap] = useState(false)
  const noBasemapSaid = useRef(false)
  const onBasemapUnavailable = useCallback(() => {
    if (noBasemapSaid.current) return
    noBasemapSaid.current = true
    setNoBasemap(true)
  }, [setNoBasemap]) // a state setter: stable, listed for the React Compiler
  useEffect(() => {
    const clear = () => setNoBasemap(false)
    window.addEventListener('online', clear)
    // …or the server answered again without the browser announcing it (lib/connectivity)
    const offReachable = onReachable(clear)
    return () => { window.removeEventListener('online', clear); offReachable() }
  }, [])
  const mapRef = useRef<MapRef>(null)
  // the locked surface's tool set — see lib/readOnlyTools for why only these two qualify
  const slimMapTools = useMemo(() => slimTools(appConfig.copy.mapTools, MAP_READONLY_TOOLS), [])

  /**
   * ── ONE undo timeline for the whole Einsatz (08.09.2026) ──────────────────────────────────
   * The header's ↶ used to mean «take back what you last did HERE», which asked the operator to
   * already know which surface his last tap landed on — the recall the 3am tenet exists to
   * refuse. It now means «take back the last thing that happened», wherever that was, and it
   * says what that is before and after the press (`peekUndo().label`, `flashUndoCaption`).
   *
   * ⚠️ The domain stacks below are NOT replaced. The Karte doc, each Plan document and the
   * Anwesenheit slice keep their own history and remain the thing that performs the step; the
   * timeline records the CHRONOLOGY and delegates. Only the surfaces that never had a stack —
   * the Atemschutz-Tafel, Mittel, Checklisten, the Gebäude one-shots — carry their inverse in
   * the entry itself. See `lib/undoTimeline`.
   */
  const { timeline: undoHist, canUndo: histCanUndo, canRedo: histCanRedo, undoLabel, redoLabel } = useUndoTimeline()
  const C_HIST = appConfig.copy
  /** `log`/`emit` are built far below (they need half this component); a timeline entry pushed up
   *  here has to reach the versions that exist when the ↶ is actually pressed. */
  const histSide = useRef<{ log: typeof log; emit: typeof emit }>({ log: () => {}, emit: () => {} })
  /**
   * The Verlauf row + audit event one step owes the record — append-only, so this ADDS a row
   * saying the correction happened and never touches the row it corrects.
   *
   * ⚠️ `op` is domain-scoped on purpose, and a bare `undo` is only ever sent from the tactical
   * surfaces an editor alone can reach. An `el` session may append the RECORD vocabulary only
   * (`EL_EVENT_PREFIXES` in backend · api/events.py) and a link session only `atemschutz.*` —
   * one refused op_type 403s the WHOLE batch and wedges the outbox, so an Anwesenheits-↶ sends
   * `attendance.undo`, a Mittel-↶ `mittel.undo`, a Checklisten-↶ `checklist.undo`.
   */
  const logHistStep = (dir: 'undo' | 'redo', label: string, op: string, icon = 'undo', kind: TimelineEvent['kind'] = 'history') => {
    const L = appConfig.copy.log
    histSide.current.log(icon, fillTemplate(dir === 'undo' ? L.undoNamed : L.redoNamed, { action: label }), kind)
    histSide.current.emit(`${op}${dir}`)
  }
  /** A delegating entry's step: the domain's own history does the work, and the record gets its
   *  row ONLY if that history actually moved. `false` travels back to the timeline as «this one
   *  is gone» — the entry is discarded and the operator is told, quietly. */
  const histStep = (moved: boolean, dir: 'undo' | 'redo', label: string, op: string, icon?: string, kind?: TimelineEvent['kind']): boolean => {
    if (!moved) return false
    logHistStep(dir, label, op, icon, kind)
    return true
  }

  // --- THE tactical store (undoable) — one collection of objects, the Karte's `doc` and the
  // plans' `board` as views of it (lib/useObjectStore, schema 2). Every writer below still speaks
  // the document it always spoke; the store folds it back. ---
  // ⚠️ The Karte's checkpoint carries a DOMAIN label, not the name of the edit: `commit` is
  // reached from every drawing, symbol and property path in the app, and threading a word through
  // all of them would be a different change. The Tafel, Mittel and the Checklisten name their
  // action exactly, because there the timeline entry is written by hand anyway.
  const store = useObjectStore(
    init.objects,
    readOnly,
    {
      getFits,
      fitsVersion,
      defaultLayer: appConfig.defaults.operationalLayerId,
      /** ⚠️ The caption names what the step DID where the writer knows it — the ↶ bubble
       *  saying «Änderung auf der Karte» for a corrected georeference described the wrong act
       *  entirely. One-shot: a writer sets it just before its checkpoint, everything else keeps
       *  the domain word, which for a store step is honest (the object IS the Karte's). */
      onCheckpoint: (step) => {
        const label = stepLabel.current ?? C_HIST.undoDomains.karte
        stepLabel.current = null
        undoHist.push({
          domain: 'karte',
          label,
          // ⚠️ the STORE step this entry stands for, and the objects it writes — what lets a remote
          // merge keep it when it changed other objects only (lib/undoTimeline · rebase)
          step,
          touches: () => storeStepKeys(step),
          undo: () => histStep(undoDocRef.current(step), 'undo', label, ''),
          redo: () => histStep(redoDocRef.current(step), 'redo', label, ''),
        })
      },
      /**
       * An object changed SURFACE, and the audit stream is told both halves of it.
       *
       * ⚠️ The surface that was dragged on emits its own document's event and can emit no other:
       * the Karte says `entity.move`, the sheet says `board.move`. A flip changes both views at
       * once, and the replay folds VIEWS (lib/replay, deliberately) — so a map flip that said only
       * «the entity moved» left the anno standing on the recorded sheet and the scrub showed one
       * object twice, while a plan flip said «this anno moved» about an anno the recorded board
       * never held and the scrub showed it in neither.
       *
       * So the store reports the flip (lib/tacticalObjects · anchorChanges) and the missing half
       * is emitted here — once per gesture, because the flip happens once. `board.add` carries the
       * anno the sheet has THIS instant; the release's own `board.move` refines it, exactly as it
       * does for an anno that was always the sheet's.
       */
      onAnchorChange: (changes) => {
        for (const c of changes) {
          if (c.left) histSide.current.emit('board.delete', { id: c.id, planId: c.left })
          if (!c.joined) continue
          histSide.current.emit('board.add', { id: c.id, planId: c.joined.planId, anno: c.joined.anno })
          // …and the ground position the sheet's new anno was baked to. The Karte draws a
          // sheet-anchored object itself (tacticalObjects · viewsOf), so without this the map view
          // of the replay kept the pre-flip coordinate.
          if (c.entity) histSide.current.emit('entity.move', { id: c.id, coord: c.entity.coord })
          else if (c.drawing) histSide.current.emit('draw.edit', { id: c.id, patch: { coords: c.drawing.coords } })
        }
      },
      onForeignStep: () => planStepLink.current?.foreignTaken(),
      onForeignSheetEdit: (events) => {
        for (const event of events) histSide.current.emit(event.op, event.payload)
      },
    },
  )
  const {
    objects, doc, board, setDocRaw, setBoard, beginSheetStep, endSheetStep, commit, beginDrag, endDrag, gestureOpen, rebake,
    undo: undoDoc, redo: redoDoc, rebaseObjects, replaceObjects, liveObjects, stepKeys: storeStepKeys,
  } = store
  // ⚠️ Through refs: the entry outlives the render that pushed it, and `undoDoc` closes over that
  // render's `past`/`future`. Calling the captured one would step a stack that has moved on.
  const undoDocRef = useRef(undoDoc); undoDocRef.current = undoDoc
  const redoDocRef = useRef(redoDoc); redoDocRef.current = redoDoc
  // …and the store itself, for a closure that has to ask «which of these does the Gebäude OWN»
  // when it RUNS (the ↶ of «Geschoss hinzufügen»), not when it was made
  const objectsRef = useRef(objects); objectsRef.current = objects
  // Live vehicles from kp-rueck's GPS feed — kept out of the editable document so
  // they auto-update and never get persisted. The operator can drag a vehicle to
  // reposition it and drag its handle to orient it; those overrides live here
  // (persisted) and win over the GPS value until reset via the "GPS" button.
  // ⚠️ Not polled where it is refused or never shown (RBAC audit §3, 22.10.2026): a Rapport VIEW
  // link may not reach Traccar or the weather (backend · VIEW_LINK_ALLOWED), and the Atemschutz-
  // Link's Tafel shows neither – each would be a 403 or a wasted poll on every load. The same
  // flag gates the weather badge, the radar and the Gebäude card below.
  const liveFeeds = user?.link_kind !== 'view' && !asLink
  const { liveVehicles, liveIds, overrides: vehicleOverrides, setOverrides: setVehicleOverrides, gpsStale, gpsAgeMs } = useVehicleLayer(init.vehicleOverrides, liveFeeds)
  // Standort teilen. Two halves that deliberately do not meet: this device REPORTS where its
  // holder is (`share`, available to every session including a link-scoped phone), and the
  // command post READS the crew picture (`livePeople`, refused to a link session server-side,
  // so it isn't even polled for one). Both die with the incident.
  // Exactly what the backend calls "still running" (models.Incident.is_open) — a phone must
  // not keep reporting into an Einsatz that is over, and finding out via a 404 would leave a
  // green pill on the screen in the meantime. Shared helper, not a hand-written copy: this
  // check used to spell out `status === 'offen'` and so hid the whole feature on an Einsatz
  // somebody had marked «In Arbeit».
  const incidentOpen = isIncidentRunning(incidentMeta)
  const share = useShareMyPosition(incidentMeta.id, incidentOpen)
  // DEMO ONLY: the crew picture is SIMULATED in this browser rather than polled — a public demo
  // must not carry real people's coordinates, so the backend refuses every position route there
  // and nothing is ever posted (lib/demoCrewWalk). The walkers are the incident's own Trupp
  // leaders, plus whoever taps «Standort teilen» on this device, so the dots carry the same
  // synthetic names as the rest of the scene.
  const demoCrew = useMemo(() => {
    if (!isDemoMode()) return undefined
    // ONE dot, not a fleet: the demo is showing the concept — «ein AdF meldet, wo er ist» — and
    // three of them just look like a feature demanding attention. Sharing on this device replaces
    // it, so there is still exactly one.
    if (share.state === 'on' && share.pref?.personId) {
      return {
        center: incidentView.center,
        crew: [{ id: share.pref.personId, displayName: share.pref.displayName ?? '' }],
      }
    }
    // Somebody who is present but NOT in a Trupp — the Trupps are inside the building, and a dot
    // walking around outside under a name the Atemschutz board says is on the 2nd floor is the
    // kind of contradiction a demo must not show. Matched by NAME as well as by roster id: the
    // demo's Trupps are seeded with names only (backend/app/demo_reset), so an id-only check
    // would have happily picked the Angriffstrupp's Truppführer.
    // …and a Trupp taken off the Tafel deploys nobody: its members are free again (Trupp.removedAt)
    const onBoard = init.trupps.filter((t) => !t.removedAt)
    const deployedIds = new Set(onBoard.flatMap((t) => [t.leaderPersonId, ...(t.memberPersonIds ?? [])].filter(Boolean) as string[]))
    const deployedNames = new Set(onBoard.flatMap((t) => [t.name, ...(t.members ?? [])]).map((n) => n?.trim()).filter(Boolean))
    // …and not the Einsatzleiter either: they are already ON the map as their own symbol, so a
    // second, walking dot with the same name reads as two people.
    const el = init.reportMeta.einsatzleiter?.trim()
    const free = Object.entries(init.attendance).find(([id, a]) => isPresent(a)
      && !deployedIds.has(id)
      && !deployedNames.has(a.displayNameSnapshot?.trim())
      && (!el || a.displayNameSnapshot?.trim() !== el))
    if (!free) return undefined
    const [id, entry] = free
    // Anchor on something an author PLACED (the Einsatzleiter, a vehicle): those sit on the road
    // or the Areal by construction, whereas a blind offset from the incident can land the dot in
    // the Weiher. The incident centre is the fallback.
    const anchor = init.doc.entities.find((e) => e.kind === 'symbol'
      && (e.symbol === appConfig.symbols.vehicleName || e.symbol?.includes('Fahrzeug') || e.symbol?.includes('Einsatzleiter')))
    return {
      center: anchor?.coord ?? incidentView.center,
      crew: [{ id, displayName: entry.displayNameSnapshot ?? '' }],
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- init.* is the mount-time seed
  }, [share.state, share.pref?.personId, share.pref?.displayName, incidentView.center])
  const livePeople = usePersonPositions(incidentMeta.id, !linkScoped && !replayActive, demoCrew)
  // null = closed · 'ask' = permission + name · 'pick' = the roster alone (changing the name).
  // NOTHING opens this on its own: sharing somebody's location is never proposed by the app,
  // only reached by tapping «Standort teilen» in the compass menu. That is also why there is no
  // «nicht jetzt» state to remember — nobody is being asked in the first place.
  const [sharePick, setSharePick] = useState<null | 'ask' | 'pick' | 'rename'>(null)

  // Session-only tactical editing state (active tool, place gesture, selection) — see
  // useTacticalSelection. Declared before enterReplay (which clears it) so its setters are in
  // scope for that callback; threaded into useMapDrawing below just as before.
  const selection = useTacticalSelection()
  const { selectedId, setSelectedId, tool, setTool, teamPick, setTeamPick, pending, setPending, pendingShape, setPendingShape, placeLock, setPlaceLock, selectedDrawingId, setSelectedDrawingId, selectedDrawIds, setSelectedDrawIds, selectedEntityIds, setSelectedEntityIds } = selection
  /** Where the currently selected drawing was TAPPED (map-container px), paired with its id so a
   *  selection that arrived some other way can't borrow a stale point. Only the panel nudge reads
   *  it (lib/panelNudge · panelNudgeSelection). */
  const [drawTap, setDrawTap] = useState<{ id: string; x: number; y: number } | null>(null)
  /** the FIRST of a Rotation's two points, while the second is still being looked for. Held here
   *  rather than in the tactical selection because it lives and dies with one placement gesture
   *  (lib/shapes · SHAPE_TWO_POINT); the guard effect below clears it on EVERY exit from that
   *  gesture — per-exit bookkeeping missed paths, and a stale point silently became one end of
   *  the next Rotation laid minutes later. */
  const [rotStart, setRotStart] = useState<LngLat | null>(null)
  useEffect(() => {
    if (tool !== 'shape' || !pendingShape || !SHAPE_TWO_POINT[pendingShape]) setRotStart(null)
  }, [tool, pendingShape])

  // Per-incident SYNCED workspace slices (checklists, trupps, attendance, mittel, camera
  // views, plan scale, report meta, Gebäude, active plan, picked object, synced settings, the
  // shared «Einsatzdaten geprüft» stamp) — see
  // useWorkspaceDoc. State only; buildPayload/applyWorkspace + the trupps auto-free effects stay
  // below and read these. layers/recent stay in the component (own derivation/effects); `board`
  // is a view of the tactical store above.
  const {
    incidentSettings, setIncidentSettings, checklists, setChecklists,
    trupps: allTrupps, setTrupps, attendance, setAttendance, mittel, setMittel, shifts, setShifts, bands, setBands, cameraViews, setCameraViews, trails, setTrails, attachments, setAttachments, reportSignatures, setReportSignatures,
    planScale, setPlanScale, reportMeta, setReportMeta, building, setBuilding,
    planBindings, setPlanBindings,
    activePlanId, setActivePlanId, pickedObjectId, setPickedObjectId,
    intakeReviewedAt, setIntakeReviewedAt,
  } = useWorkspaceDoc(init)
  // The bindings register as the georef home for `incident:` keys (pairing mode, Passung,
  // reset all route through it) and their corrections join the shared undo timeline.
  useIncidentPlanBindings(incidentMeta.id, planBindings, setPlanBindings, readOnly, undoHist)
  /** The synced slices AS THIS RENDER HOLDS THEM — what a merge is diffed against to learn which
   *  records it changed (applyWorkspace · workspaceChanges). The objects are read live instead. */
  const liveWs = useRef<Partial<Record<keyof Saved, unknown>>>({})
  // (typed against undoKeys · RecordedField: a recorded slice missing here fails tsc — the objects
  // are the one exception, read live from the store)
  const liveSlices: Record<Exclude<RecordedField, 'objects'>, unknown> = {
    trupps: allTrupps, mittel, shifts, bands, cameraViews, trails, attachments, reportSignatures, vehicleOverrides, checklists,
    attendance, planScale, settings: incidentSettings, reportMeta, planBindings, building, pickedObjectId, intakeReviewedAt,
  }
  liveWs.current = liveSlices
  // ⚠️ The board list, filtered ONCE at the source. A deleted Trupp is stamped rather than
  // removed (types · Trupp.removedAt) so the Rapport can still print it — and everything else in
  // this component, from the alarm host to the map markers to the roster lock, must never see it
  // again. Filtering here is what makes that true by construction instead of by fifteen call
  // sites remembering. `allTrupps` goes to exactly three places, and all three are the RECORD
  // rather than the board: what is SAVED, what is PRINTED, and the journal's vocabulary — a row
  // that named a Trupp keeps naming it after the crew has come out (see `journalVocab`).
  const trupps = useMemo(() => allTrupps.filter((t) => !t.removedAt), [allTrupps])
  // …and the other half: what was taken off the board, newest first. The Atemschutz header offers
  // them back, so the delete's six-second toast is the fast way and not the only one.
  const removedTrupps = useMemo(
    () => allTrupps.filter((t) => t.removedAt).sort((a, b) => (b.removedAt ?? '').localeCompare(a.removedAt ?? '')),
    [allTrupps],
  )
  /** ⚠️ `allTrupps`, NOT the filtered board list — this is what the timeline's Trupp entries ask
   *  «is the card you describe still there?». Löschen is a stamp, so a deleted Trupp is filtered
   *  out of `trupps` while very much still in the record; asking the filtered list would make
   *  «Löschen rückgängig» decline itself as pointing at something gone. */
  const truppsRef = useRef(allTrupps); truppsRef.current = allTrupps
  /** Every name the ONE Trupp counter reads (docs/trupp-naming.md §1, lib/placedTrupps ·
   *  counterNames): each chip once, each ghost trail, and every Trupp ever registered — removed
   *  ones included, which the board's `trupps` are not. `exceptId` leaves out the chip being
   *  renamed or revived. Every door that mints or changes a «Trupp N» reads this and nothing else. */
  const truppCounterNames = (exceptId?: string) => counterNames(objects, trails, allTrupps, exceptId)
  /** A hand rename of chip `id` to `label` would say a number somebody holds — refuse it at the
   *  source; a duplicate one device could see coming is never left for a merge to settle. */
  const teamNameTaken = (id: string, label: string) => teamNoTaken(label, truppCounterNames(id))

  // --- time-travel replay (read-only past view) — state/reconstruction owned by useReplay ---
  // enterReplay lives further down, next to clearMapUi, whose reset list it shares.

  // map entities/drawings: the live doc + GPS, or the reconstructed past blob during replay.
  // Live crew positions join the vehicles: derived from the backend, never persisted, never
  // in the replay (they are the present by definition and no history of them is kept).
  const entities = useMemo(
    () => (replayActive ? replayEntities : [...doc.entities, ...liveVehicles, ...livePeople.people]),
    [replayActive, replayEntities, doc.entities, liveVehicles, livePeople.people],
  )
  const drawings = replayActive ? (replayWs?.drawings ?? []) : doc.drawings

  // re-render when the fetched ADR/ERG datasets land (lib/useHazardData) — the rings and
  // baked placards below read them synchronously.
  const hazVersion = useHazardData()
  const resolvedMapDrawings = useMemo(() => resolveMapDrawings(drawings, entities), [drawings, entities])
  /**
   * The ONE thing the header pair does: step the global timeline, then SAY what it stepped.
   *
   * The caption is not a toast (`lib/undoFlash`): it is the button answering the press that was
   * just made, in the same bubble the hold shows when it is asked what it would do. It matters
   * because ↶ now reaches across surfaces — the operator is looking at the Karte and the thing
   * that came back happened on the Tafel, where he cannot see it happen.
   *
   * The one FAILURE is soft and button-less: the step pointed at something a merge has taken
   * away. Nothing is half-done (the entry declined before writing), so there is nothing to
   * retry and nothing to confirm — just a word, and the next ↶ moves on to the step below.
   */
  const stepHistory = (dir: 'undo' | 'redo', anchor?: HTMLElement | null): void => {
    const r = dir === 'undo' ? undoHist.undo() : undoHist.redo()
    if (r.status === 'empty') return
    if (r.status === 'lost') { toast(appConfig.copy.undoLost, { icon: 'warn' }); return }
    if (anchor) flashUndoCaption(anchor, fillTemplate(dir === 'undo' ? C_HIST.undoNamed : C_HIST.redoNamed, { action: undoCaption(r.entry) }))
  }
  /** …from a button, which anchors the caption at itself. Every ↶ ↷ in the app goes through this. */
  const onHistoryPress = (dir: 'undo' | 'redo') => (e: ReactMouseEvent<HTMLButtonElement>) => stepHistory(dir, e.currentTarget)
  useEffect(() => clearUndoCaption, [])
  // ⚠️ The live values the timeline's plan entries read (workspace/usePlanStacks · planStepAt).
  // A step is pressed long after the render that recorded it, so nothing there may close over
  // this render's `board`, `activePlanId` or plan titles (filled in below, with the plan catalog).
  const boardRef = useRef(board); boardRef.current = board
  const activePlanIdRef = useRef(activePlanId); activePlanIdRef.current = activePlanId
  const planLabelRef = useRef<(id: string) => string>(() => '')
  // the Plan's per-document undo stacks on the one timeline, and the handles the Whiteboard reports
  // up for the top bar and the keys (workspace/usePlanStacks)
  const planStacks = usePlanStacks({
    undoHist, histStep, beginSheetStep, endSheetStep, setBoard, boardRef, activePlanIdRef, planLabelRef,
    planStepLabelRef: planStepLabel, stepLabelRef: stepLabel, planStepLinkRef: planStepLink,
  })
  const { planHistory, setPlanHistory, planFit, planKeys } = planStacks
  // always-fresh keydown dispatcher — assigned every render (below, once all handlers exist) so
  // the single window listener never re-subscribes yet never closes over stale state.
  const hotkeyRef = useRef<(e: KeyboardEvent) => void>(() => {})
  /**
   * The Verlauf row for EDITING a symbol on the Kroki, written once the editing stops.
   *
   * Same shape and the same reason as the Rapportangaben logger further down: the inspector
   * writes on every keystroke, so a row per `patchEntity` would be a row per character typed
   * into a name field. The base is the entity as it stood when the editing STARTED, and the
   * line names what actually moved between those two points — per entity, so editing two
   * symbols in the same four seconds stays two rows about two symbols.
   *
   * ⚠️ …and the window RE-ARMS while the sentence is still being written (04.09.) — see
   * `createEditSettle` and `isTypingSymbolField`. A plain settle read every pause as «done» and
   * put a half-typed Notiz on the Rapport three times.
   */
  // ⚠️ Built ONCE per mount, so the open windows survive a re-render. Its callbacks close over
  // `log` from the render that first opened one — which is safe, and only because `log` writes
  // through the ref-held journal store (useJournal · append is stable per mount).
  const entityLogSettle = useRef<EditSettle<Entity> | null>(null)
  /** Streamed keystrokes, per entity — the on-canvas note editor has no panel to read focus off
   *  (`noteTextLive` is its only signal), so it says so here instead. */
  const entityTypedAt = useRef(new Map<string, number>())
  const noteEntityEdit = (before: Entity, after: Entity) => {
    entityLogSettle.current ??= createEditSettle<Entity>({
      ms: META_LOG_SETTLE_MS,
      stillEditing: (id) => isTypingSymbolField()
        || Date.now() - (entityTypedAt.current.get(id) ?? 0) < META_LOG_SETTLE_MS,
      onSettled: (id, base, latest) => {
        entityTypedAt.current.delete(id)
        const changes = entityEditChanges(base, latest)
        if (!changes.length) return
        log('pen', fillTemplate(appConfig.copy.log.entityEdited, {
          name: entityLogName(latest), changes: changes.join(', '),
        }), 'symbol', undefined, id)
      },
    })
    entityLogSettle.current.push(before.id, before, after)
  }

  // one place that edits a single map entity: a discrete undo step + the audit
  // emit, so every field edit (label/fields/notes/floor/count/rotation) is recorded
  // identically — previously notes/floor/count silently skipped the audit stream.
  // `commit` alone only stops a VIEWER: in the Führungsansicht readOnly is false, so every
  // entity write needs the tactical lock too (the panels hide their controls, this is the floor).
  const patchEntity = (id: string, patch: Partial<Entity>) => {
    if (tacticalLocked) return
    commit((d) => {
      const before = d.entities.find((e) => e.id === id)
      if (before) noteEntityEdit(before, { ...before, ...patch })
      return { ...d, entities: d.entities.map((e) => (e.id === id ? { ...e, ...patch } : e)) }
    })
    emit('entity.edit', { id, patch })
  }

  const [layers, setLayers] = useState<LayerDef[]>(init.layers)
  // Category-driven layer pre-activation on a LATER re-categorization (a BMA that turns out
  // to be a real fire brings the hydrants up). Additive only — never hides anything; the
  // creation-time activation for a fresh workspace happens in deriveInitial.
  const prevIncidentType = useRef(incidentMeta.type)
  useEffect(() => {
    if (incidentMeta.type === prevIncidentType.current) return
    prevIncidentType.current = incidentMeta.type
    setLayers((ls) => autoActivateLayers(ls, incidentMeta.type))
  }, [incidentMeta.type])
  // Verlauf rows live in the append-only journal store (server rows + offline outbox), NOT
  // in the synced blob — the one unbounded domain no longer re-syncs wholesale on every edit.
  // `legacy` seeds display + migration from an older incident's in-blob timeline.
  // the Atemschutz-Link of a CLOSED Einsatz is refused on every request until a reopen: it
  // follows once a minute (staging r3) — enough to notice the reopen, not a 403 every few seconds
  const slowFollow = asLink && (!running || linkRefused)
  // the outbox is per IDENTITY (RBAC S5): a link opened on the FU's own phone keeps its own
  const journal = useJournal({ incidentId: incidentMeta.id, readOnly: outboxReadOnly, legacy: init.timeline, slowFollow,
    owner: user ? { key: `${user.id}:${user.link_kind ?? 'login'}`, adoptsLegacy: !user.link_kind } : null })
  // pulled out by name: `journal` itself is a fresh object every render, so a callback that
  // depends on it either churns or (the bug this replaced) silently keeps a stale `rows`
  const { swapPhoto, overlaySession: overlayRow, appendPatch: patchRow } = journal
  const timeline = journal.rows
  /** the map's entities with every placed photo showing its row's CURRENT picture (the upload
   *  swapped the blob: for the server URL, a reload re-minted the blob) — render only, never
   *  written back (lib/photoGeo · withPhotoUrls). Keyed by a STRING of the resolved URLs, so a
   *  new Verlauf row does not rebuild the map's entity list while a photo marker stands. */
  const photoKey = useMemo(() => photoUrlKey(entities, timeline), [entities, timeline])
  const mapEntities = useMemo(() => withPhotoUrls(entities, photoKey), [entities, photoKey])
  const [recent, setRecent] = useState<string[]>(init.recent)
  // most-recently-used symbols (shared by both surfaces' palettes) — newest first, deduped, capped
  const addRecent = (name: string) => setRecent((r) => [name, ...r.filter((x) => x !== name)].slice(0, 12))
  // overlay / popover / sheet open-state (views popover, symbol palette, Einstellungen,
  // Objekt-Picker, Hilfe, Installations-Guide, Offline-Bereitschaft — the Rapport is not here,
  // it is a rail surface, so «open it» is setMode('rapport'),
  // layers panel) — grouped in useSheets; switching to a tool closes the views popover + panel.
  const { viewsOpen, setViewsOpen, paletteOpen, setPaletteOpen, settingsOpen, setSettingsOpen, pickerOpen, setPickerOpen, helpOpen, setHelpOpen, installGuideOpen, setInstallGuideOpen, offlineReadyOpen, setOfflineReadyOpen, shareLink, setShareLink } = useSheets()
  /** Who may hand a link out at all — an editor on a live view, and never a link session itself
   *  (a link may not mint further links). Says nothing about WHICH link: after the Abschluss only
   *  the read-only link is still a thing, and that is `shareDoors`' business (lib/viewLink). */
  const canShareLink = canEditIncident && !readOnly && !linkScoped
  /** …and the ONE link that DIES with the Abschluss — the Truppüberwacher-Link (its session
   *  404s). A door straight to it, bypassing the sheet's own tabs, has to close when the Einsatz
   *  does, or it offers an address that never worked. Same guard the «Einsatz abschliessen» row
   *  uses further down. */
  const canShareLive = canShareLink && !incidentMeta.is_archived
  /** Is there an Atemschutz-Link on this Einsatz right now? ONE request per incident, and
   *  deliberately never polled: the QR in the Atemschutz header only claims that a link EXISTS,
   *  and the only thing that changes that is minting or revoking one — which happens in the
   *  sheet, on this device, and reports straight back through its `onState`. */
  const [atemschutzLinkOn, setAtemschutzLinkOn] = useState(false)
  useEffect(() => {
    if (!canShareLink) return // nobody who could see the button — asking would only 403
    let alive = true
    void fetchShareLink(incidentMeta.id, 'atemschutz')
      .then((l) => { if (alive) setAtemschutzLinkOn(l.enabled) })
      .catch(() => { /* an unknown state paints «kein Link» — the sheet is the honest answer */ })
    return () => { alive = false }
  }, [incidentMeta.id, canShareLink])
  // Child sheets suspend their parent rather than destroying it. Their origin decides whether
  // cancel restores Einstellungen/Ansichten/status and whether a completed action closes the
  // entire chain.
  const [feedbackOpen, setFeedbackOpen] = useState(false)
  const [feedbackParent, setFeedbackParent] = useState<'settings' | null>(null)
  const [shareParent, setShareParent] = useState<'settings' | 'views' | 'status' | null>(null)
  const shareStatusRestore = useRef<(() => void) | null>(null)
  // the layers side panel shares the tool docks' on-screen slot, so switching to any drawing
  // tool closes it + the views popover. Kept here (not in useSheets) next to the tactical
  // gesture state it's cleared alongside (enterReplay), so those stay plain useState setters.
  const [panel, setPanel] = useState<'layers' | null>(null)
  // «Trupp finden» (TruppFinder) — an overlay over whatever is on screen, not a surface
  const [findTruppOpen, setFindTruppOpen] = useState(false)
  useEffect(() => { if (tool !== 'select') { setViewsOpen(false); setPanel(null) } }, [tool])
  // measurement tool (distance/height-profile line, or area) — extracted to useMeasure.
  // All ephemeral (never saved); gated on the measure tool being active.
  const measure = useMeasure(tool === 'measure')
  // The surface is remembered across reloads — but only within the SAME Einsatz: a new
  // emergency opens on the Karte, never on whatever tab the last one ended on (lib/prefs ·
  // initialMode, Feldtest Manuel 07.09.). An Atemschutz-Link session has exactly ONE surface,
  // so the remembered one is ignored there: the lite shell renders whatever `mode` says and
  // has no rail to steer back with. Fresh loadPrefs(), not the module-level boot snapshot —
  // an in-session incident switch must see the mode the LAST workspace saved.
  const [mode, setMode] = useState<WorkspaceMode>(() => initialMode(loadPrefs(), incidentMeta.id, asLink))
  /** The Rapport is a surface now, so «open it» is «go there». Kept as a named helper because
   *  half a dozen entry points say it (Abschluss-Assistent, the print action, the return chip). */
  const openRapport = () => setMode('rapport')
  // «Karte verknüpfen» on a PHONE hops between the plan and the map — there is no room for the
  // two-pane split, so the app follows the mode instead of asking anyone to find the other
  // surface. This one line is the whole bridge; the mode itself lives in lib/georefMode.
  useGeorefSurfaceBridge(setMode)
  // «Fertig»/«Schliessen»/Esc drop reference halves that never found their counterpart, and
  // the toast saying so must fire on WHICHEVER surface the exit happened — on a phone the
  // mode's map half runs with the Whiteboard unmounted, so the handler lives at app level.
  useEffect(() => {
    setGeorefOpenDroppedHandler((k) => toast(
      k === 1
        ? appConfig.copy.whiteboard.georef.openDroppedOne
        : fillTemplate(appConfig.copy.whiteboard.georef.openDroppedMany, { k: String(k) }),
      { icon: 'warn' },
    ))
    return () => setGeorefOpenDroppedHandler(null)
  }, [])
  const georefMode = useGeorefMode()
  const georefActive = !!georefMode.planId
  // «Karte verknüpfen» must not survive navigation to a surface it cannot run on: a notification
  // tap (or the nav rail) can land on Atemschutz/Verlauf mid-pairing, and the armed mode then
  // left a stuck loupe + reticle over a page with no map. `end`, deliberately NOT `dismiss`:
  // «Fertig» semantics — completed pairs are kept and the debounced save is flushed, only the
  // open half-points are dropped (lib/georefMode).
  useEffect(() => {
    if (georefActive && mode !== 'map' && mode !== 'plans') georefDispatch({ type: 'end' })
  }, [georefActive, mode])
  // …nor an Einsatz switch. The mode is a MODULE store; the Whiteboard's own effect dismisses it
  // on a plan switch, but on a phone the Whiteboard is not mounted while the map half runs, so
  // the next workspace inherited a `planId` and armed its mode bars for a plan it does not have.
  useEffect(() => () => georefDispatch({ type: 'dismiss' }), [])
  // diagnostics only — a non-throwing render storm of THIS component gets one beacon + a
  // Rückmeldung prompt; nothing else in the tree can see one (lib/useRenderStorm). The beacon names
  // the open tab and which of these values kept changing (identity checks, nothing deeper).
  useRenderStorm('IncidentWorkspace', {
    context: `tab=${mode}`,
    watch: { objects, layers, fitsVersion, planHistory, journalRows: journal.rows, recent, georefMode },
  })
  const phoneGeoref = isPhone && !!georefMode.planId
  // Demo-only: which surface someone opened, for the public demo's visit statistics. A no-op
  // on every real station (isDemoMode) and in a link session — see lib/visitBeacon.ts.
  useEffect(() => { countSurface(mode, { linkScoped }) }, [mode, linkScoped])
  // `phoneTools` (the second, stacked tool bar → its extra bottom clearances) is computed below,
  // once `planDocs` is known: a viewer-only plan renders NO tool bar, so it must reserve one bar,
  // not two.
  // (Horizontal swipe-to-page between sections is GONE — 2026-08-14. On the tablet it is the
  // primary surface for, an invisible gesture that jumps the whole workspace to another section
  // is a thing you trigger by accident, never on purpose. The NavRail and the `nav` hotkey are
  // the two ways to change section.)
  // tactical-symbol size (Karte / standalone Module; linked Module follow Karte), captions, offline cache radius,
  // keep-screen-on — device prefs shared with the landing Einstellungen (see useDevicePrefs;
  // lazy loadPrefs seed). Their persistence rides the mode/activePlanId effect below.
  const { symbolScale, setSymbolScale, symbolCaptions, setSymbolCaptions, offlineRadiusM, setOfflineRadiusM, offlineAuto, setOfflineAuto, keepScreenOn, setKeepScreenOn, railLabels, setRailLabels } = useDevicePrefs()
  // "Mein Standort": bumping this takes a single GPS fix + flies to it. On-demand (no continuous
  // watch) so the GPS chip isn't powered all shift — see MapView.locateNonce.
  const [locateReq, setLocateReq] = useState(0)
  // Atemschutz doctrine resolves in two tiers here: per-incident synced settings →
  // atemschutzDoctrine() (deployment /api/config override → static appConfig fallback).
  // These already merged values flow to AtemschutzView via props.
  const doctrine = atemschutzDoctrine()
  const azIntervalMin = incidentSettings.contactIntervalMin ?? doctrine.contactIntervalMin
  const azGraceSec = incidentSettings.contactGraceSec ?? doctrine.contactGraceSec
  const azFunkkanal = incidentSettings.defaultFunkkanal ?? doctrine.defaultFunkkanal
  // One-shot confirmation after an update reload (swUpdate stamps sessionStorage before it) —
  // closes the loop the reload cut off: the operator sees the new build actually landed.
  useEffect(() => {
    if (consumeJustUpdated()) toast(fillTemplate(appConfig.copy.update.updated, { v: buildLabel() }), { icon: 'check', tone: 'success' })
  }, [])
  /**
   * Keep every Trupp's placement join pointing at where its marker actually STANDS — and free it
   * when the marker is gone, so «Platzieren» comes back instead of pointing at nothing (the
   * button is gated on the join being empty).
   *
   * ⚠️ ONE effect over the store, because which surface a marker stands on is its ANCHOR
   * (lib/placedTrupps · markerSite) and no longer «which collection holds its id»: the Karte
   * draws plan-anchored objects too. As two membership tests this went wrong in both directions
   * — a chip dragged off its sheet onto the Karte lost its Trupp entirely (the anno left `board`,
   * so the plan half freed itself), and one dragged the other way kept an `entityId` naming a
   * surface it had left. The join follows the anchor instead.
   */
  useEffect(() => {
    setTrupps((ts) => {
      let changed = false
      const next = ts.map((t) => {
        const markerId = t.entityId ?? t.annoId
        if (!markerId) return t
        const site = markerSite(markerId, objects)
        if (!site) { changed = true; return { ...t, entityId: undefined, annoId: undefined, planId: undefined } }
        if (site.kind === 'map') {
          if (t.entityId === markerId && !t.annoId && !t.planId) return t
          changed = true
          return { ...t, entityId: markerId, annoId: undefined, planId: undefined }
        }
        if (t.annoId === markerId && t.planId === site.planId && !t.entityId) return t
        changed = true
        return { ...t, annoId: markerId, planId: site.planId, entityId: undefined }
      })
      return changed ? next : ts
    })
  }, [objects, setTrupps])
  // What the bell actually controls: per-device, but scoped to THIS Einsatz — a tablet muted at a
  // drill in February is armed again for the next one (see useAtemschutzMute). `audioBlocked` is
  // the third honest state: the browser has not released audio, so only the OS notification can
  // fire and the bell says so instead of claiming to be on.
  const { muted: atemschutzMuted, mute: muteAtemschutz, arm: armAtemschutz, toggle: toggleAtemschutzMuted, audioBlocked: atemschutzAudioBlocked, unlockAudio: unlockAtemschutzAudio } = useAtemschutzMute(incidentMeta.id)
  // how the Atemschutz board is arranged — a way of LOOKING at it, so per device. The hand-set
  // order it can show (Trupp.order) is synced, so «wie gesetzt» is the same board everywhere.
  const [atemschutzOrder, setAtemschutzOrderState] = useState<TruppOrder>(() => loadPrefs().atemschutzOrder ?? 'manuell')
  const setAtemschutzOrder = (o: TruppOrder) => { setAtemschutzOrderState(o); savePrefs({ ...loadPrefs(), atemschutzOrder: o }) }
  // Which linked sheets this device lays under the Karte as a raster. A DEVICE pref like every
  // other «what am I looking at» switch, persisted the way `atemschutzOrder` above is: seeded
  // lazily from the cookie, written on the toggle. The `twin:` prefix is what the persisted keys
  // have always said (lib/prefs) — renaming it would rewrite device preferences for a word.
  const [twinLayers, setTwinLayers] = useState<Record<string, boolean>>(() => loadPrefs().twinLayers ?? {})
  const [twinLayerOpacity, setTwinLayerOpacity] = useState<Record<string, number>>(() => loadPrefs().twinLayerOpacity ?? {})
  const [mapSuppressedCaptions, setMapSuppressedCaptions] = useState<ReadonlySet<string>>(new Set())
  /**
   * ⚠️ The cookie write happens OUTSIDE the updater, exactly as `setAtemschutzOrder` above does
   * it. React runs updater functions during the render phase — and twice under StrictMode — so a
   * `savePrefs` inside one is a side effect on an unpredictable schedule, which is the one thing
   * an updater may not contain. These three setters used to do it inside; the comment above even
   * claimed they were "persisted the same way `atemschutzOrder` is", which is precisely what they
   * were not doing.
   */
  const persistTwinLayers = (next: Record<string, boolean>) => {
    setTwinLayers(next)
    savePrefs({ ...loadPrefs(), twinLayers: next })
  }
  const toggleTwinLayer = (id: string) => persistTwinLayers({ ...twinLayers, [id]: !twinVisible(twinLayers, id) })
  // a Rapport checklist row navigated to Anwesenheit/Mittel → offer the one-tap way back
  const [rapportReturn, setRapportReturn] = useState(false)
  // the Verlauf drawer sits BELOW the Rapport sheet (z 61 vs 80), so opening it from the
  // checklist closes the sheet and reopens it when the Verlauf closes — a real round trip
  const [journalFromRapport, setJournalFromRapport] = useState(false)
  // leaving those surfaces for anything else ends the round trip (no stale chip later)
  useEffect(() => { if (mode !== 'anwesenheit' && mode !== 'mittel') setRapportReturn(false) }, [mode])
  // per-object backend module plans (auto-surfaced near object, or a manual PlanPicker override),
  // plus the resolved plan-doc list with module PDFs swapped in — see useObjectPlans.
  // The binding options freeze each surfaced sheet on first contact: which dataset revision,
  // which fit. Sheets that already carry ink under a legacy station fit keep that fit; a whole
  // workspace from before bindings existed (content, no bindings) preserves ALL its fits.
  const legacyPlanIds = useMemo(() => new Set(Object.keys(board).filter((id) => board[id]?.length)), [board])
  const preserveLegacy = useMemo(
    () => !bootGate.ws?.planBindings?.length && hasLegacyAlignmentContext(bootGate.ws),
    [],  // eslint-disable-line react-hooks/exhaustive-deps
  )
  const objectPlans = useObjectPlans(incidentMeta.id, incidentView.center, setActivePlanId, pickedObjectId, setPickedObjectId, {
    bindings: planBindings,
    // a machine seed of a key outside the record slice – see `canWriteBlob`
    onBind: (proposed) => { if (canWriteBlob) setPlanBindings((prev) => fillBindingFloors(addPlanBindings(prev, proposed), proposed)) },
    legacyPlanIds,
    preserveLegacy,
  })
  const { plansSettled, backendPlans, resolvedPlanDocs, manualObject, pickObject, resetObject, activeObjectId } = objectPlans

  // The Gebäude-Steckbrief (KP Front F5) — a chip in the Karte's and the plan's bottom-left chip
  // row (BuildingFloat): fetched with the Einsatz so it is cached for offline before anybody taps it. Only the operator's MANUAL pick is passed — without
  // one the server ranks the objects exactly as the plan rail does. Refetched when the address or
  // point changes. A Rapport view link may not ask, and the Atemschutz-Link's Tafel never shows it.
  const buildingInfo = useBuildingInfo(incidentMeta, manualObject?.id ?? null, liveFeeds)

  // PWA: the Offline-Vorbereitung — the incident box, the warm download and its probe URLs
  // (workspace/useOfflinePrefetch).
  const { withGeoBbox, online, offlineProgress, cancelOffline, downloadOffline, offlineProbeUrls } = useOfflinePrefetch({
    incidentId: incidentMeta.id, center: incidentView.center, offlineRadiusM, offlineAuto, mapRef, layers, backendPlans,
  })
  // the Gebäude (floor-stack) document only exists once a building is picked; it sits
  // directly after «Umrisse» (the OSM outline you pick the building from) in the CATALOG —
  // the rail shows the two as one morphing tile (railPlanDocs below).
  // during replay the floor-stack tab follows the RECONSTRUCTED building, so the past
  // plan list matches the past state (Gebäude appears iff a building existed back then)
  const effBuilding = replayActive ? replayBuilding : building
  // during replay the Atemschutz/Anwesenheit surfaces show the RECONSTRUCTED past state (the
  // views are read-only then) so scrubbing moves Trupp status + attendance back in time too
  // The replay-aware Trupp list. Every surface that DRAWS a Trupp (the Atemschutz board, and the
  // hose tags on Lage + Plan) reads this one, so a replayed picture names who was on the line
  // THEN — the live list would paint today's links onto a two-hour-old scene.
  const effTrupps = replayActive ? (replayWs?.trupps ?? []) : trupps
  const effAttendance = replayActive ? (replayWs?.attendance ?? {}) : attendance
  const effShifts = replayActive ? (replayWs?.shifts ?? []) : shifts
  const effBands = replayActive ? (replayWs?.bands ?? []) : bands
  // during replay the Mittel log is reconstructed from the scrubbed-instant workspace blob
  const effMittel = replayActive ? ((replayWs?.mittel as MittelEntry[] | undefined) ?? []) : mittel
  // The plan CATALOG — every document this incident can address by id. Everything that looks a
  // plan up (the board, the Verlauf's row labels, the Rapport's page list, placedTrupps, the
  // Whiteboard itself) reads this one, so `osm` keeps resolving even once a Gebäude exists.
  const planDocs = useMemo(() => {
    if (!effBuilding) return resolvedPlanDocs
    const out = [...resolvedPlanDocs]
    const osmIdx = out.findIndex((p) => p.id === BUILDING_PICK_ID)
    out.splice(osmIdx >= 0 ? osmIdx + 1 : out.length, 0, gebaeudeDoc)
    return out
  }, [effBuilding, resolvedPlanDocs])
  // the «Messungen» chip (components/ReadingsChip): every Messpunkt of the Einsatz, worst first,
  // tagged with where it stands – read off the store, so one point is one row (lib/readingsList)
  const readingPoints = useMemo(() => measuredPoints(objects, {
    plan: (id) => planDocs.find((p) => p.id === id)?.code ?? id,
    storey: floorLabel,
    karte: appConfig.copy.building.readingsOnMap,
  }), [objects, planDocs])
  // …and the LEISTE's version of it, where «Umrisse» and «Gebäude» are one tile that morphs
  // (23.08.). Two tiles for one building was the mechanism showing through: you picked on the
  // first and worked on the second, and the first stayed in the rail forever afterwards doing
  // nothing. See lib/useObjectPlans · railPlanTiles for why the two ids survive the merge.
  const railPlanDocs = useMemo(() => railPlanTiles(planDocs, activePlanId), [planDocs, activePlanId])
  // the plan titles the timeline's plan entries name (see `planLabelRef` above)
  planLabelRef.current = (id) => planDocs.find((p) => p.id === id)?.title ?? id

  // both bars are stacked on the two drawing surfaces (tool bar above the surface bar) — this drives
  // the extra bottom clearances for FAB / docks / stage / whiteboard on phones. A viewer-only plan
  // (e.g. Modul 6 Gebäudepläne) renders no tool bar, so it gets ONE bar of clearance, not two —
  // otherwise the empty tool-bar lane blocks the PDF from scrolling to the bottom nav.
  // ⚠️ A half-typed Mittel (or guest) belongs to the Einsatz it was started on. Switching
  // incidents drops every kept draft, so the next one can never be handed the previous one's
  // entry — see lib/draftKeep.
  useEffect(() => { clearAllDrafts() }, [incidentMeta.id])
  // The Checkliste templates load the moment an Einsatz opens, not when the tab is first tapped
  // (lib/checklists · warmTemplates): the surface opens on a list that is already there, and the
  // offline cache is filled while there is still a network to fill it from.
  useEffect(() => { void warmTemplates().list }, [incidentMeta.id])
  // A plan surface that shows no tool bar at all: an admin-configured module viewer, or the
  // select-only Umrisse (23.08.) — different reasons, same consequence for the phone's lanes.
  const activePlanNoTools = mode === 'plans' && (() => {
    const d = planDocs.find((p) => p.id === activePlanId)
    return d?.viewer === true || isSelectOnlySurface(d)
  })()
  // a LOCKED surface now carries a bar too (the slim rail: Auswahl · Messen on the map,
  // Auswahl only on the plan since Messen left it 29.08.), so it reserves the
  // same two lanes as an editor's — only replay, which renders no rail at all, gets one.
  const phoneTools = isPhone && !replayActive && (mode === 'map' || (mode === 'plans' && !activePlanNoTools))
  // the floating top-right map-utility cluster (zoom · compass · Ebenen), which stands in for the
  // tool rail during replay. It is the ONLY thing the TopBar has to keep clear of on a wide
  // screen — `.map-util` lets the CSS reserve that width exactly when the cluster is there.
  const mapUtility = mode === 'map' && replayActive && !isPhone
  // the slim (read-only) tool rail is showing — on a phone that frees the top bar and the rail
  // footer, so the compass and the weather move back into them (see `.slim-tools` in app.css).
  const slimRail = tacticalLocked && !replayActive
  // published on <html>, not on the app div: the saved-views popover is portalled to <body>, so
  // a class inside the app cannot reach it (same reason the rail publishes --vrail-w up here).
  useEffect(() => {
    document.documentElement.classList.toggle('slim-tools', slimRail)
    return () => document.documentElement.classList.remove('slim-tools')
  }, [slimRail])

  // the flat nav order (matches NavRail) — map, EACH rail tile, then the sections. The `nav`
  // hotkey steps one destination at a time, so it walks through the modules individually instead
  // of collapsing to whatever plan was last open (the Gebäude).
  // ⚠️ The RAIL list, not the catalog: ⌘[ / ⌘] steps what the rail shows, so the merged Gebäude
  // tile is one stop, not two. Stepping onto an «Umrisse» stop that has no tile to land on is
  // exactly the chevron-lands-nowhere bug the merge exists to remove — and the SAME rule is why
  // the Rapport is a stop (it has always been a tile, and a surface the stepping could reach but
  // never leave is that bug in its worst form) and why Anwesenheit and Material stop being stops
  // once the phone bar folds them into it (18.09.2026): there is no tile to land on, and the
  // mode redirect below would bounce the step onward to the Rapport anyway.
  const navList = useMemo(() => navStops(railPlanDocs.map((d) => d.id), phoneFold), [railPlanDocs, phoneFold])
  const goToNav = (dir: -1 | 1) => {
    const cur = navList.findIndex((n) => n.mode === mode && (n.mode !== 'plans' || n.planId === activePlanId))
    const next = cur >= 0 ? navList[cur + dir] : undefined
    if (!next) return
    // stepping to the next section leaves the map exactly as the nav rail does — see clearMapUi.
    // (Defined further down; this only ever runs from a key, never at render time, same as
    // enterReplay.)
    if (next.mode !== mode) clearMapUi()
    if (next.mode === 'plans') { setMode('plans'); setActivePlanId(next.planId) }
    else setMode(next.mode)
  }
  // if the active plan vanished, fall back to the first available plan so the sidebar stays
  // in sync — BUT don't bump away from a remembered plan that's merely still loading: module
  // PDFs are filtered out of planDocs until their backend URL arrives, so a restored 'modul6'
  // would otherwise get reset to osm before the module loads. Only reset truly-unknown ids.
  useEffect(() => {
    if (!planDocs.length) return
    if (planDocs.some((p) => p.id === activePlanId)) return // valid + present
    const stillLoading = planDocuments.some((p) => p.id === activePlanId) || activePlanId === gebaeudeDoc.id
    if (stillLoading) return // known plan, just not loaded yet — keep it
    setActivePlanId(planDocs[0].id)
  }, [planDocs, activePlanId])
  // unified journal (Verlauf): a single append-only stream shared by both
  // surfaces, plus its quick-add composer — both reachable from the TopBar.
  const [journalOpen, setJournalOpen] = useState(false)
  /** «Show me that card»: alarm and attendance routes carry a nonce so tapping the same Trupp
   *  twice points again. Pointing is a gesture, not durable state; AtemschutzView clears its
   *  highlight on its own timer. */
  const [truppFocus, setTruppFocus] = useState<{ id: string; nonce: number } | null>(null)
  /** «Neuer Trupp» from a loose marker/chip (14.09.): open the Anmeldung, and on save the new
   *  Trupp adopts that marker. Same nonce grammar as `truppFocus` — a repeat tap opens again. */
  const [truppCreate, setTruppCreate] = useState<{ nonce: number; adoptMarkerId: string } | null>(null)

  // a tapped system notification (handled in public/sw-notify.js) posts here to open the
  // relevant tab — an Atemschutz alarm jumps to the Atemschutz view, a due Wiedervorlage
  // opens the Verlauf where reminders live. If the tap COLD-STARTED a killed app the target
  // arrives as the ?kpn= boot param instead (a postMessage would land before this listener
  // exists); claim is one-shot so an incident switch can't re-route the same tap.
  useEffect(() => {
    const route = (target: unknown) => {
      if (typeof target !== 'string') return
      // 'atemschutz:<truppId>' lands ON the overdue Trupp's card; the bare 'atemschutz' (older
      // service workers, older server pushes) keeps opening the board without a focus.
      if (target === 'atemschutz' || target.startsWith('atemschutz:')) {
        setMode('atemschutz')
        const truppId = target.startsWith('atemschutz:') ? target.slice('atemschutz:'.length) : ''
        if (truppId) setTruppFocus({ id: truppId, nonce: Date.now() })
      } else if (target === 'journal') setJournalOpen(true)
    }
    route(claimBootNotifyTarget(['atemschutz', 'journal']))
    const sw = typeof navigator !== 'undefined' ? navigator.serviceWorker : undefined
    if (!sw) return
    const onMsg = (e: MessageEvent) => {
      if (e.data?.type === 'kp-notification-click') route(e.data.target)
    }
    sw.addEventListener('message', onMsg)
    return () => sw.removeEventListener('message', onMsg)
  }, [])
  const [composerOpen, setComposerOpen] = useState(false)
  // the phone's floating chip rows (the Karte's and the plan's) stand on the lowest FREE line —
  // beside a short tool dock, not a row above it (lib/floatRow, sweep 27.10.2026 #9)
  useFloatRowPlacement(isPhone)
  /** the Pendenz the composer is writing a Meldung on — set by tapping its row in the Verlauf.
   *  Cleared whenever the composer closes, so the next ordinary «Eintrag» is never still linked. */
  const [noteOn, setNoteOn] = useState<{ id: string; text: string } | null>(null)
  // the moment the Eintrag composer opened — used as the entry timestamp (the info was usually
  // relevant / the order given then, not when Erfassen is finally pressed)
  const composerOpenedAt = useRef<string | null>(null)
  useEffect(() => { if (composerOpen) composerOpenedAt.current = new Date().toISOString() }, [composerOpen])
  // a Verlauf row can ask the plan to revisit a point; nonce makes each request distinct
  const [planFocus, setPlanFocus] = useState<{ x: number; y: number; floor: number; annoId?: string; twinEntityId?: string; flash?: boolean; nonce: number } | null>(null)
  // «zeigen» on the Lage: the drawing gets an outline for a couple of seconds and is NOT selected
  // (see MapView · flashDrawingId). Cleared on a timer — pointing is a gesture, not a state.
  const [flashDrawingId, setFlashDrawingId] = useState<string | null>(null)
  useEffect(() => {
    if (!flashDrawingId) return
    const t = setTimeout(() => setFlashDrawingId(null), appConfig.drawing.flashMs)
    return () => clearTimeout(t)
  }, [flashDrawingId])
  // last reported plan-view centre, so a journal pin on the plan anchors to "here"
  // the note being edited inline with raw text directly on the map — exactly like the Plan
  // whiteboard's text notes (placement auto-edits; double-click re-enters; single tap just selects)
  const [editNoteId, setEditNoteId] = useState<string | null>(null)
  // true once a live title edit has snapshotted for undo, so we beginDrag once per edit
  // session and fold the whole keystroke stream into a single undo step on blur
  const titleLiveRef = useRef(false)
  // stream a note's raw text live (silent — snapshot once for undo), then fold the whole
  // edit into one undo step + a single audit event on blur. Mirrors the title editor.
  const noteTextLive = (id: string, v: string) => {
    if (tacticalLocked) return // setDocRaw bypasses commit's readOnly gate — a viewer must not type here
    // …and the Verlauf's settle window learns that this note is still being written: the canvas
    // editor is not inside a panel, so focus alone cannot tell (see noteEntityEdit)
    entityTypedAt.current.set(id, Date.now())
    if (!titleLiveRef.current) { titleLiveRef.current = true; beginDrag() }
    // a note that has never been resized by hand follows what is typed (lib/notes) — it grows
    // out of the minimum and stops at the maximum, where it wraps as it always did
    setDocRaw((d) => ({ ...d, entities: d.entities.map((e) => (e.id === id
      ? { ...e, label: v, ...(e.noteAutoW ? { noteW: autoNoteWPx(v, e.noteSize) } : null) }
      : e)) }))
  }
  const noteTextCommit = (id: string, v: string) => {
    if (tacticalLocked) { setEditNoteId(null); return }
    if (titleLiveRef.current) { titleLiveRef.current = false; endDrag(); emit('entity.edit', { id, patch: { label: v } }) }
    else patchEntity(id, { label: v })
    setEditNoteId(null)
  }
  // which note has its detail panel open. NOT derived from selectedId: unlike a symbol, selecting
  // a note stays quiet — it is placed mid-sentence and a panel sliding in on every tap would be
  // in the way. Only the ⚙ handle sets this.
  const [notePanelId, setNotePanelId] = useState<string | null>(null)
  // …and which of them was just PLACED, so its panel opens with the caret in the text field. A
  // one-shot: reopening the same note later is an ordinary read and must not grab the keyboard.
  const [notePlacedId, setNotePlacedId] = useState<string | null>(null)
  // style the NEXT note carries, chosen in the armed-tool dock before anything is placed
  const [noteDefaults, setNoteDefaults] = useState<{ size: NoteSize; plain: boolean; color: string }>(
    { size: 'm', plain: false, color: '' },
  )
  const [view, setView] = useState<{ bearing: number; center: LngLat; zoom: number }>({ bearing: 0, center: incidentView.center, zoom: getDeploymentConfig().map?.defaultView?.zoom ?? 17.6 })
  // coordinate picker (one-shot crosshair + LV95/WGS84 readout) — extracted to useCoordPicker.
  // ⚠️ Koordinaten is a TOOL like any other on the rail (owner 20.10.2026, UX sweep M1: it stayed
  // on under every tool and silently took the taps meant for it). Entering it puts the armed
  // tool down (disarmMapTool — a draft is settled, never dropped); arming any tool ends it
  // (clearMapUi). Every way in — the Ansichten row, the X key — is this one `cycle`.
  const coordPicker = useCoordPicker(false, view.center)
  const coord: CoordPicker = {
    ...coordPicker,
    cycle: () => { if (coordPicker.mode === 'off') disarmMapTool(); coordPicker.cycle() },
  }

  // --- audit capture (substrate A): batch client tactical events, flush debounced (see useAuditEvents) ---
  // ⚠️ SCOPED to what this role may append (lib/eventScope, 24.09.2026): the `el` phone runs
  // the Atemschutz alarm engine like every device, and its `atemschutz.*` events 403'd into an
  // outbox that stayed red for the whole Einsatz.
  const auditScope = useMemo(() => eventScopeFor(user), [user?.role, user?.link_kind]) // eslint-disable-line react-hooks/exhaustive-deps
  const auditDelivery = useAuditEvents(incidentMeta.id, outboxReadOnly, user ? `${user.id}:${user.link_kind ?? 'login'}` : null, auditScope)
  const { emit: emitAudit, flushEvents, flushEventsBeacon } = auditDelivery
  // ⚠️ The outbox still DELIVERS on a closed Einsatz (`outboxReadOnly`), so it must not be FED
  // there: an Ebene toggled on the closed view would otherwise be queued, refused and counted as
  // «nicht übernommen» — a refusal of something nobody meant to record. Nothing new is emitted
  // once the Einsatz is over; what was queued before still goes out and is classified.
  // …except the RECORD vocabulary, which a closed Einsatz still takes: a Rapport correction after
  // the close emits its `report.` event like any other (canEditRapport).
  const emit = useCallback<typeof emitAudit>((...args) => {
    if (running || EL_EVENT_PREFIXES.some((p) => args[0].startsWith(p))) emitAudit(...args)
  }, [emitAudit, running])

  // Weather for the incident location — polled for the badge only. The RECORD of it (the
  // `weather.observe` events the replay folds, lib/replay · stateAt) is written by the SERVER
  // since 24.09.2026, once per reading per active Einsatz (backend · app/observations): every
  // device used to emit its own copy of each reading, and none while every screen slept.
  // During replay the badge reads the folded reading.
  const liveWeather = useWeather(incidentView.center, liveFeeds)
  const displayWeather = replayActive ? (replayWs?.weather ?? null) : liveWeather.data
  // …and the Karte's weather LAYER: the MeteoSwiss radar (live only)
  const weather = useKarteWeather(mode === 'map' && !replayActive && liveFeeds, einsatzRadarStore(incidentMeta.id))

  // The opening cover (lib/bootCover): the boot Splash's snail stays over the whole workspace
  // until its first screen is whole — the symbol pack, the Karte framed with its first view drawn
  // (when the Karte is the surface it opens on), the rail's plan tiles and the weather in the
  // top bar. Each of those used to arrive in view, one jump at a time (01.10.2026).
  const [mapSettled, setMapSettled] = useState(false)
  const onMapSettled = useCallback(() => setMapSettled(true), [])
  const coverPhase = useBootCover(!!openCover, (sym.ready || !!sym.error)
    && (mode !== 'map' || mapSettled)
    && plansSettled
    && (!liveFeeds || !!liveWeather.data || !!liveWeather.error), onOpenCoverDone)
  // The Gebäude card opens by itself the first time THIS device shows the Karte of this Einsatz
  // whose building has anything to show (lib/buildingFirstOpen): after the cover
  // has lifted (never under the snail), on the Karte only — an Einsatz that opens on another
  // surface shows it when the Karte is first shown — and never in a replay, a closed Einsatz or a
  // session that cannot see the Karte (the Atemschutz-Link's Tafel). Data that arrives later
  // (offline, then online) opens it when it arrives.
  const buildingFirst = useBuildingFirstOpen(incidentMeta.id, buildingInfo,
    coverPhase === 'off' && mode === 'map' && running && !replayActive && !asLink && !tabLockLost)
  const openWeatherDetails = useCallback(() => {
    const [lng, lat] = incidentView.center
    const url = appConfig.copy.weather.detailsUrl.replace('{lat}', String(lat)).replace('{lng}', String(lng))
    window.open(url, '_blank', 'noopener,noreferrer')
  }, [incidentView.center])

  // The open fold windows — a burst still collecting into one undo step. Declared up here because
  // a remote merge closes all three (applyWorkspace, below).
  /** the Rapport's step that stands (saveReportMeta / reportSet), so the next keystroke can decide
   *  whether it belongs to it */
  const lastReportStep = useRef<{ key: string; at: number } | null>(null)
  /** the Bildlegende step that stands — a caption is typed, so it is ONE step and not one per
   *  letter (same window and the same reason as the Rapportangaben). */
  const lastCaptionStep = useRef<{ key: string; at: number; from: string | undefined; drop: () => void } | null>(null)
  /** …and the Gebäude-Drehung, which is a slider: one drag is one step (workspace/useGebaeudeActions · reorient). */
  const lastReorient = useRef<{ at: number; from: BuildingDoc; drop: () => void } | null>(null)

  // The blob both ways — the load gate's toast, applyWorkspace (merge in) and buildPayload (save
  // out), and this device's own Ebenen (workspace/useWorkspaceBlob)
  const { buildPayload, applyWorkspace, ghostReseedRef, sliceRebase } = useWorkspaceBlob({
    bootGate, olderBuild, setOlderBuild, incidentMeta, setLayers, journal, setRecent, setBuilding, setVehicleOverrides, setChecklists,
    setTrupps, setAttendance, setMittel, setShifts, setBands, setCameraViews, setTrails, setPlanScale,
    setReportMeta, setAttachments, setReportSignatures, setIncidentSettings, setPlanBindings, setPickedObjectId,
    setIntakeReviewedAt, undoHist, liveWs, liveObjects, boardRef, getFits, rebaseObjects, replaceObjects,
    setPlanHistory, lastReportStepRef: lastReportStep, lastCaptionStepRef: lastCaptionStep,
    lastReorientRef: lastReorient, setSelectedId, setSelectedDrawingId, setSelectedDrawIds, objects, recent,
    activePlanId, pickedObjectId, building, vehicleOverrides, checklists, allTrupps, attendance, mittel,
    shifts, bands, cameraViews, trails, planScale, reportMeta, attachments, reportSignatures, incidentSettings, planBindings,
    intakeReviewedAt, layers,
  })

  // SCBA contact-clock alarm runs app-wide (not just on the Atemschutz surface) so an überfällig
  // Trupp alerts no matter which page is open. Paused during replay (read-only past view).
  // Hosted in a null-rendering child (see AtemschutzAlarmHost): its 1 Hz tick must NOT re-render
  // App — that repainted the whole tree every second a Trupp was in the field (battery drain).
  // Declared up here (not with the Atemschutz block) because the sync loop below reads it.
  const [azAlarm, setAzAlarm] = useState<AtemschutzAlarmState>({ peak: 0, urgent: null, severities: {} })
  // which Trupps the Meldeleiste names right now (AtemschutzAlarmMeldungen · onShown) — the TopBar
  // chip steps aside while a row or the board's own badge already says its alarm (T1, 29.09.2026)
  const [azRowsShown, setAzRowsShown] = useState<string[]>([])

  // persistence, teardown beacons, live-follow poll (with the tablet sync-race guard),
  // in-place auto-merge apply, and the reactive sync-status badge all live in useIncidentSync.
  const { syncStatus: workspaceSyncStatus, lastSyncedAt, syncNow: syncWorkspaceNow, clockSkewMs } = useIncidentSync({
    // `outboxReadOnly`, not `readOnly`: a closed Einsatz still saves the Rapport corrections made
    // on it (canEditRapport); nothing else writes a slice on a closed view — every writer gates
    // on the flags derived from `readOnly`. …and never the blob of a newer build (olderBuild):
    // the Verlauf and audit outboxes still deliver, the workspace is not pushed or flushed.
    sync, readOnly: outboxReadOnly || olderBuild, incidentId: incidentMeta.id,
    buildPayload, applyWorkspace, flushEvents, flushEventsBeacon,
    // attendance-divergence note (both sides changed the same person → one Verlauf row)
    // Not for an Atemschutz-Link session: the server refuses every non-«team» row from it (403,
    // deliberately not a 422), and a refused row at the head of the outbox would block the
    // Kontakt rows queued behind it. Attendance conflicts are not that session's business.
    appendJournal: canWriteRecord ? journal.append : undefined,
    // …but the renumbering row (two devices minted one «Trupp N», lib/truppNumbers) IS a «team»
    // row, and a Link's own Trupp is as likely to lose its number as anybody's
    appendTeamRow: readOnly ? undefined : journal.append,
    // a ringing device polls fast even when hidden — the Funkkontakt that ends its alarm is
    // usually entered on another device and arrives via this very poll
    alarmUrgent: azAlarm.peak >= 2,
    // what this view shows — so a close/reopen elsewhere is answered at once (lib/incidentClosed)
    incidentOpen: running,
    slowFollow,
    // a Karte drag, a plan step, or typing (the Rapport saves per keystroke): while one is open
    // and a push is owed, the save skips its whole-blob compare
    gestureOpen: () => gestureOpen() || isTypingTarget(document.activeElement),
  })
  // The record outboxes alone — what the media drain waits for (below). The badge's status adds
  // the media queue to it once that exists (`syncStatus`, after useMediaQueue).
  const recordsSyncStatus = combinedSyncStatus(workspaceSyncStatus, journal.syncStatus, auditDelivery.status)

  // --- closed (or reopened) on ANOTHER device while open here (N3, staging 25.09.2026) ---------
  // what this device still holds, sent again after a reopen (workspace/useLifecycleElsewhere)
  const {
    lifecycleHiddenAt, lifecycleBoundary, lifecycleRefused, exportEntries, setLifecycleHiddenAt,
    closedRefusedTotal, exportedClosedRefused, workspaceRoleParked,
  } = useLifecycleElsewhere({
    sync, journal, auditDelivery, running, flushEvents, outboxReadOnly, incidentMeta, lifecycleElsewhere,
  })
  // the row matches the state on screen: a «closed» row never stands over a live Einsatz, nor a
  // «reopened» one over a closed view; a new change shows again after an earlier ✕.
  // ⚠️ Not over the Rapport (V3): the strip lay over its head and the «Einsatzrapport (PDF)»
  // button at 820 and 1180, and the Rapport of a closed Einsatz says it itself (its own line).
  const closedMeldung = lifecycleElsewhere != null
    && mode !== 'rapport'
    && (lifecycleElsewhere.event === 'closed') === !running
    && lifecycleHiddenAt !== lifecycleElsewhere.at && (
    <IncidentClosedMeldung
      // the Link holder cannot reopen anything: its row says what the board still does
      forLink={asLink}
      // …and says only what this session can still do (RBAC audit 22.10.2026)
      canReopen={!!onReactivateActive}
      canCorrect={canEditRapport}
      event={lifecycleElsewhere.event}
      // ⚠️ the time of the REOPEN, not of hearing it (N6, 26.09.2026): the Link hears on its
      // minute poll, and «wieder geöffnet (02:46)» for a reopen at 02:45 is a wrong time on screen.
      // The server's reopen row says when; until it has arrived, the moment it was heard.
      at={lifecycleElsewhere.event === 'reopened' && lifecycleBoundary?.kind === 'reopened'
        ? Date.parse(lifecycleBoundary.at) : lifecycleElsewhere.at}
      refused={lifecycleRefused}
      onExport={exportEntries}
      onDismiss={() => setLifecycleHiddenAt(lifecycleElsewhere.at)}
    />
  )

  // Publish this device's «Einsatzdaten geprüft» to the crew. The question belongs to the Einsatz,
  // not to the tablet it was answered on (lib/incidentAlerts), and this component is the only
  // writer of the incident's blob — so whichever way it was answered here (App's markReviewed
  // takes both «Passt» and a saved correction) the stamp goes out with the next save and every
  // other device drops the banner on its next poll. Auto-opened Einsätze only: a hand-typed one
  // was never up for review, and stamping it would dirty the blob for nothing.
  useEffect(() => {
    // `isEl` too: the stamp lives outside the record slice, so an el write would only ever
    // reach this device — the banner would drop here and stand everywhere else, a silent lie
    if (!canWriteRecord || isEl || !reviewedLocallyAt || intakeReviewedAt || !incidentMeta.auto_opened) return
    setIntakeReviewedAt(reviewedLocallyAt)
  }, [canWriteRecord, isEl, reviewedLocallyAt, intakeReviewedAt, incidentMeta.auto_opened, setIntakeReviewedAt])

  // Keep the screen awake while an incident workspace is open (this component only mounts for an
  // open incident) — so the map never dims/sleeps mid-operation on a station/vehicle tablet.
  // Default on, but a per-device toggle (Einstellungen) lets a personal/background device opt out
  // and save battery. No-ops on browsers without the Wake Lock API.
  useWakeLock(keepScreenOn)

  // (The Einstellungen sheet no longer writes the Atemschutz safety values — 28.08., they are
  // /admin doctrine now. `incidentSettings` overrides already stored in workspaces keep applying;
  // the settle-and-log machinery that guarded their edits left with the editor.)

  /**
   * Rapportangaben with a Verlaufszeile. The printed rapport's own content — Einsatzleiter,
   * Endezeit, Gerettete, Partnerorganisationen, die Alarm-/Fahrzeugzeiten — changed through a
   * bare setter: no journal row, no audit event, nothing. On a document that gets signed and
   * filed, a field that can be corrected without trace is the wrong kind of quiet.
   *
   * One row per save naming WHICH fields moved, not one per field: the sheet writes several at
   * once (a Combo commit patches its neighbours), and a line per field would bury the Verlauf.
   */
  const metaLogBase = useRef<ReportMeta | null>(null)
  const metaLogTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  /** the freshest saved meta, for the settle callback — it may re-arm past the save that made it */
  const metaLogNext = useRef<ReportMeta | null>(null)
  /** the current Mittel line count for normalizeReportMeta — a ref because saveReportMeta is
   *  deliberately identity-stable per mount and must not close over stale state */
  const mittelCountRef = useRef(0)
  useEffect(() => { mittelCountRef.current = mittelLineCount(mittel) }, [mittel])

  /**
   * The Rapport's ONE write path, held in a ref.
   *
   * ⚠️ It is the undoable slice's `set` (see `reportSet` further down, where `canWriteRecord`
   * and the timeline are both in scope), while `saveReportMeta` itself is deliberately
   * identity-stable per mount — the same shape `sliceRebase` uses for the slices' merge. Before
   * that assignment lands it is the plain setter, so a write on the very first render still
   * reaches the workspace; it simply lays no step down.
   */
  const reportSetRef = useRef<UndoableSlice<ReportMeta>['set']>((u) => { setReportMeta(u); return false })
  const saveReportMeta = useCallback((next: ReportMeta) => {
    reportSetRef.current((prev) => {
      // «Entfällt» and a value are two answers to the same question — resolve the contradiction
      // on EVERY meta write, here where all of them funnel through (lib/report ·
      // normalizeReportMeta; the QR poster's path does the same in CaptureApp).
      const clean = normalizeReportMeta(next, prev, { mittelCount: mittelCountRef.current }) as ReportMeta
      // The sheet persists on every KEYSTROKE (the textareas save as you type), so logging each
      // save wrote one Verlauf row per character typed into a Bemerkung. The row is written from
      // the state the editing STARTED in, once the typing stops — one line per edit, naming what
      // actually moved between those two points.
      if (!metaLogBase.current) metaLogBase.current = prev
      metaLogNext.current = clean
      const settle = () => {
        // ⚠️ Mid-typing is not «settled»: the sheet saves per keystroke but a slow, thought-out
        // sentence pauses past 4 s, and the row then quoted the half-typed value («Einsatzleiter
        // «Me»»). While the caret sits in a free-text Rapportangabe the window re-arms and only
        // closes once the field is left — last value wins. Steppers, Combos and time inputs are
        // not held open (isTypingMetaField) and keep the plain 4 s settle.
        if (isTypingMetaField()) {
          metaLogTimer.current = setTimeout(settle, META_LOG_SETTLE_MS)
          return
        }
        const base = metaLogBase.current
        const latest = metaLogNext.current
        metaLogBase.current = null
        metaLogNext.current = null
        metaLogTimer.current = null
        if (!base || !latest) return
        // scalar fields keep the ONE joined «Rapportangaben: …» row; each structured statement
        // («Partnerorganisation Sanität ergänzt …») is its own row, in diff order — three
        // decisions are three rows, not three sentences crammed into one (lib/report).
        const { fields, statements } = changedReportMetaLines(base, latest)
        if (fields.length) log('clipboard', fillTemplate(appConfig.copy.preflight.logMetaChanged, { fields: fields.join(', ') }))
        for (const s of statements) log('clipboard', s)
      }
      if (metaLogTimer.current) clearTimeout(metaLogTimer.current)
      metaLogTimer.current = setTimeout(settle, META_LOG_SETTLE_MS)
      return clean
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps -- log is stable per mount
  }, [])
  /** A field write from OUTSIDE the Rapport sheet — the Abschluss confirm's row buttons and its
   *  pre-filled Einsatzende (useAbschluss · patchReportMeta). Over the blob as it stands NOW
   *  (a ref: the confirm stands open for a while and a sync may move the blob under it), through
   *  the one funnel every Rapport write takes (saveReportMeta: normalize, log, undo step).
   *  The ref follows the blob after each commit — the sheet's taps are separate events, so each
   *  one reads the write before it. */
  const reportMetaRef = useRef(reportMeta)
  useEffect(() => { reportMetaRef.current = reportMeta }, [reportMeta])
  const patchReportMeta = useCallback((over: Partial<ReportMeta>) => saveReportMeta({ ...reportMetaRef.current, ...over }), [saveReportMeta])

  // the media queue, the one sync status the badge shows, «Jetzt synchronisieren» and the pre-close
  // drain (workspace/useMediaOutbox)
  const attachmentMediaRef = useRef<(id: string, url: string) => void>(() => {})
  const applyAttachmentMedia = useCallback((id: string, url: string) => attachmentMediaRef.current(id, url), [])
  const {
    media, flushRecordOutboxes, swapRowMedia, syncStatus, closedRefusedUnexported, baseSyncStatus,
    syncNow,
  } = useMediaOutbox({
    swapPhoto, swapAttachmentMedia: applyAttachmentMedia, overlayRow, patchRow, incidentMeta, canWriteRecord, closedRefusedTotal,
    exportedClosedRefused, recordsSyncStatus, syncWorkspaceNow, journal, auditDelivery, sync, flushEvents,
  })

  // --- ONE «Einsatz abschliessen» ------------------------------------------------------------
  //
  // Two doors lead here — the Rapport's button/band and the row in the Einsatz-Menü — and until
  // 22.08. only ONE of them checked anything. The menu row archived plainly: no `report_done_at`,
  // none of the seven ABSCHLUSS_STEPS, so an Einsatz put away that way stood in the Historie as
  // «offen» for ever, while the identically-labelled path through the Rapport stamped and
  // counted. Two doors into one room are fine; two doors with the same sign into different rooms
  // are not. The confirm and the open-point count live HERE, above both of them.
  /** «Als «nicht eingesetzt» schliessen» in the Abschluss (useAbschluss · standDownTrupps,
   *  24.09.2026): the card's own stand-down, per Trupp. The Trupp actions are created much further
   *  down, so the hook gets a stable door and the ref is pointed at them once they exist. */
  const standDownRef = useRef<(ids: string[]) => void>(() => {})
  const standDownTrupps = useCallback((ids: string[]) => standDownRef.current(ids), [])
  // …and the row for a crew the Abschluss closes over (staging r3 F4), pointed the same way
  const noteInsideRef = useRef<(ts: Trupp[]) => void>(() => {})
  const noteInsideAtClose = useCallback((ts: Trupp[]) => noteInsideRef.current(ts), [])
  // …and for a Notfall the Abschluss closes over (F1), pointed the same way
  const noteNotfallRef = useRef<(ts: Trupp[]) => void>(() => {})
  const noteNotfallAtClose = useCallback((ts: Trupp[]) => noteNotfallRef.current(ts), [])
  // What the Abschluss writes on its way to the close is part of the close (staging r6, F3):
  // `pushEvent` marks every row made between the confirm and the close's answer `atClose`, so it
  // never prints as a Nachtrag for being stamped a moment past the server's `closed_at`.
  const closingRowsRef = useRef(false)
  const markClosing = useCallback((on: boolean) => { closingRowsRef.current = on }, [])
  // the Rapport counts an unsettled Abweichung as open — so does every door to it (lib/abschluss ·
  // abschlussFacts): the phone's «Einsatz» badge, the chooser, the Abschluss, the archive count
  const openConflictCount = useMemo(() => openConflicts(timeline).length, [timeline])
  const { abschlussMissing, azFrozenAt, azMonitoring, confirmAndComplete } = useAbschluss({
    reportMeta, attendance, mittel, openConflictCount, trupps, incidentMeta, replayActive, media, onCompleteRapport,
    setMode, setPanel, setOfflineReadyOpen, requestReportStep,
    // only where the Tafel may be written — a viewer's or a replay's Abschluss has nothing to close
    standDownTrupps: canEditTrupps ? standDownTrupps : undefined,
    noteInsideAtClose: canWriteRecord ? noteInsideAtClose : undefined,
    noteNotfallAtClose: canWriteRecord ? noteNotfallAtClose : undefined,
    // the Verlauf rows and audit events still queued go up BEFORE the close (review of #235) —
    // after it they would be judged against a closed Einsatz. After the stand-down and the
    // «beim Abschluss noch drin» rows (#227), so those go up with them.
    flushOutboxes: flushRecordOutboxes,
    markClosing,
    // the rows' buttons and the pre-filled Einsatzende write the Rapport — only where it may be edited
    patchReportMeta: canEditRapport ? patchReportMeta : undefined,
  })
  // --- the Atemschutz clocks across «Wieder öffnen» (staging r3, F4; lib/reopenClocks) ----------
  // The newest close/reopen boundary in the Verlauf, the server's own rows. Right after a reopen
  // the meta can say «running» a moment before the Verlauf has the reopen row: the alarm HOLDS
  // for that moment, and once the row is there it counts every crew still inside from the
  // reopen — never across the closed interval, which rang «Überfällig» the instant it ran again.
  const reopenPending = running && lifecycleBoundary?.kind === 'closed'
  const alarmTrupps = useMemo(() => clocksAfterReopen(trupps, running ? lifecycleBoundary : null), [trupps, running, lifecycleBoundary])
  const azAlarmActive = azMonitoring && !reopenPending
  /* A Notfall re-arms a muted bell (F1, 08.10.2026). The mute is per Einsatz and «Zum Trupp» sets
   * it, so a tablet that acknowledged an überfällig crew at 02:10 would hear nothing of a Notfall
   * at 02:40. Every Notfall THIS session has not met yet (a new trigger, or one found running on
   * open) arms it once; muting again is the bell or «Zum Trupp», as for any alarm. */
  const notfallKeys = trupps.filter(truppInNotfall).map((t) => `${t.id}:${t.notfallAt}`).sort().join('|')
  const notfallMet = useRef<Set<string>>(new Set())
  // (an ENDED one is forgotten, so ↶ bringing it back with its original trigger arms it again —
  // lib/notfall · freshNotfallKeys)
  useEffect(() => {
    if (!azAlarmActive) return
    if (freshNotfallKeys(notfallMet.current, notfallKeys ? notfallKeys.split('|') : []).length) armAtemschutz()
  }, [notfallKeys, azAlarmActive, armAtemschutz])

  /** the one-shot pusher, ref-held: the Beilagen handlers are `useCallback`s per mount and the
   *  timeline helper is created much further down — the same shape `reportSetRef` uses. */
  const rememberOneShotRef = useRef<(domain: UndoDomain, label: string, restore: () => void, reapply: () => void, touches: () => readonly RecordKey[] | null, rows?: OneShotRows | 'silent') => Dropper>(() => Object.assign(() => {}, { standing: () => false }))
  // the row media uploads and the Rapport-Beilagen — lib/useRowMediaUpload. ⚠️ The two refs go in
  // as the REF OBJECTS: rememberOneShotRef is assigned much further down, and lastCaptionStep is
  // reset by the remote hydrate above.
  const { uploadPhotoForRow, uploadMediaForRow, addAttachments, captionAttachment, removeAttachment, swapAttachmentMedia } = useRowMediaUpload({
    incidentMeta, canWriteRecord, media, swapPhoto, swapRowMedia, attachments, setAttachments, emit,
    rememberOneShotRef, lastCaptionStepRef: lastCaptionStep,
  })
  // Install before the media queue's passive restore effect can finish its IndexedDB read.
  useLayoutEffect(() => { attachmentMediaRef.current = swapAttachmentMedia }, [swapAttachmentMedia])

  // When the workspace sync recovers (server reachable again), drain any queued media too —
  // a stronger signal than the browser's `online` event, which fires on link-up not reach.
  // ⚠️ On the RECORD status, not `syncStatus`: that one includes the media queue itself, and
  // would never read «synced» while anything is queued — the drain would wait for itself.
  const flushMedia = media.flush
  useEffect(() => { if (recordsSyncStatus === 'synced') void flushMedia() }, [recordsSyncStatus, flushMedia])

  // Selecting something opens its details (ContextPanel) — so the moment a NEW selection lands, drop
  // every other transient bit of map chrome that would sit over it or the tool rail: the Ebenen dock,
  // the views popover, and any armed tool / placement dock (back to Auswahl). Edge-triggered on a
  // changing key so merely *opening* one of those while something is already selected doesn't
  // insta-close it. (Separate effect below handles modal sheets opening.)
  const selKey = `${selectedId ?? ''}|${selectedDrawingId ?? ''}|${selectedDrawIds.join(',')}|${selectedEntityIds.join(',')}`
  const prevSelKey = useRef(selKey)
  useEffect(() => {
    const changedToSelection = prevSelKey.current !== selKey && (!!selectedId || !!selectedDrawingId || selectedDrawIds.length > 0 || selectedEntityIds.length > 0)
    prevSelKey.current = selKey
    // settleDraft, not setDraft([]): a selection landing mid-draft used to throw the tapped-out
    // points away silently — a committable draft now asks «Speichern · Verwerfen ·
    // Weiterzeichnen» (and «Speichern» does not steal this new selection; useMapDrawing · settleDraft).
    if (changedToSelection) { setPanel(null); setViewsOpen(false); setTool('select'); setPending(null); setPendingShape(null); settleDraft() }
  }, [selKey]) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (settingsOpen || paletteOpen || pickerOpen || helpOpen || installGuideOpen || offlineReadyOpen || shareLink || composerOpen || journalOpen || teamPick) setPanel(null)
  }, [settingsOpen, paletteOpen, pickerOpen, helpOpen, installGuideOpen, offlineReadyOpen, shareLink, composerOpen, journalOpen, teamPick])

  // Delete / Backspace removes the current selection (drawing first, then entity) — but
  // never while typing in a field. `doc` is a dep so the delete closes over fresh state.
  // ⚠️ Map surface only: the Plan carries the same key on its own selection (Whiteboard, A21),
  // and this listener lives on the window whether the Karte is on screen or not.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Delete' && e.key !== 'Backspace') return
      if (mode !== 'map') return
      const el = document.activeElement as HTMLElement | null
      if (el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable)) return
      // ⚠️ The bar's «Löschen» left with the bar, so this key is where a boxed GROUP is deleted
      // from — plan-drawn members included: they are ordinary map objects now, and a group had
      // no other affordance at all.
      if (selectedDrawIds.length || selectedEntityIds.length) {
        e.preventDefault(); deleteGroup(selectedDrawIds, selectedEntityIds)
      } else if (selectedDrawingId) { e.preventDefault(); deleteDrawing(selectedDrawingId) }
      else if (selectedId && !tacticalLocked) { e.preventDefault(); deleteEntity(selectedId) }
    }
    // ⚠️ never while covered: a Backspace in the viewer must not delete a symbol nobody sees
    if (covered) return
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [covered, mode, selectedId, selectedDrawingId, selectedDrawIds, selectedEntityIds, doc, tacticalLocked])  // eslint-disable-line react-hooks/exhaustive-deps

  // Keyboard shortcuts (see lib/hotkeys + the "Tastaturkürzel" help section) and Escape's
  // bail-out (lib/hotkeyRoute · routeEscape). One mount-once listener delegates to hotkeyRef,
  // which useMapActions reassigns every render with the live handlers — so keys always act on
  // current state without a churn of add/removeEventListener.
  useEffect(() => {
    if (covered) return // the surface in front owns the keyboard (see `covered`)
    const onKey = (e: KeyboardEvent) => hotkeyRef.current(e)
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [covered])

  // warm the OSM building-outline cache so the Umgebung sheet (and the building picker)
  // opens instantly instead of waiting on the Overpass fetch. Must use the RESOLVED docs:
  // useObjectPlans re-centres the osm surface on the incident, so prefetching the bundled
  // catalog's default center warmed a bbox nobody looks at. Re-runs when the center moves
  // (e.g. the alarm address lands); prefetchOutlines dedupes by bbox, so repeats are free.
  // Not for a LINK session: /api/overpass is off every link allowlist (an open proxy), so the
  // warm-up would only be a 403 in the console – and the Atemschutz-Link never shows a plan.
  useEffect(() => {
    if (linkScoped) return
    for (const p of resolvedPlanDocs) if (p.osm) prefetchOutlines(p.osm.center, p.osm.radiusM)
  }, [resolvedPlanDocs, linkScoped])

  // remember the active surface + plan document in a cookie (preserve incidentId)
  // (…but never FROM a link session: its surface is forced, so remembering it would make the
  // next ordinary open of this browser land on the Atemschutz board for no reason anyone gave.)
  useEffect(() => { savePrefs({ ...loadPrefs(), ...(asLink ? {} : { mode, modeIncidentId: incidentMeta.id }), activePlanId, symbolScaleMap: symbolScale.map, symbolScaleBoard: symbolScale.board, symbolCaptions, offlineRadiusM, offlineAuto, keepScreenOn, railLabels }) }, [asLink, mode, incidentMeta.id, activePlanId, symbolScale, symbolCaptions, offlineRadiusM, offlineAuto, keepScreenOn, railLabels])

  // …and the CODE of the two lazy surfaces (Plan, Rapport — see loadWhiteboard at the top), on
  // idle after the first paint, so a mode switch finds its chunk already parsed. Not for an
  // Atemschutz-Link phone: it is shown the Tafel and nothing else.
  useEffect(() => {
    if (asLink) return
    return whenIdle(() => { void loadWhiteboard(); void loadReportPreflight() })
  }, [asLink])

  // warm the plan bitmaps at app load (on idle) so the first open of the Plan tab appears
  // instantly — the exact-fit bake reuses these unless the stage is larger. ⚠️ Only the active
  // plan and its two rail neighbours are baked at window size; the rest get a small preview
  // (~5 MB instead of up to ~83 MB each on an iPad — every plan at full size was enough to have
  // the tab reclaimed before the Plan tab was ever opened). Re-runs on a plan switch, so the
  // new neighbours are warmed as the operator moves along the rail (PdfViewport · prewarmPlans).
  useEffect(() => {
    if (asLink) return // never shows a plan — a phone must not bake every page into memory for nothing
    const docs = resolvedPlanDocs.filter((p) => p.imageUrl)
    const urls = docs.map((p) => (p.imageUrl.startsWith('/') || /^https?:/.test(p.imageUrl) ? p.imageUrl : `${import.meta.env.BASE_URL}${p.imageUrl}`))
    const active = Math.max(0, docs.findIndex((p) => p.id === activePlanId))
    const run = () => prewarmPlans(urls, window.innerWidth, window.innerHeight, urls.slice(Math.max(0, active - 1), active + 2))
    const idle = (window as unknown as { requestIdleCallback?: (cb: () => void) => number }).requestIdleCallback
    const id = idle ? idle(run) : window.setTimeout(run, 600)
    return () => { const ric = (window as unknown as { cancelIdleCallback?: (h: number) => void }).cancelIdleCallback; if (idle && ric) ric(id); else clearTimeout(id) }
  }, [resolvedPlanDocs, activePlanId, asLink])

  // Layers the MAP renders: during replay, apply the reconstructed layerState so
  // `layer.toggle` history (which layer was on/off at that moment) is faithful too.
  const mapLayers = useMemo(() => {
    // Online → full region-wide geojson; offline → the incident-box crop the offline cache warmed
    // (same URL, so a stored slice serves the live layer offline). See `online` / `withGeoBbox`.
    const scoped = layers.map((l) => (l.geojson ? { ...l, geojson: online ? l.geojson : withGeoBbox(l.geojson) } : l))
    if (!replayActive || !replayWs?.layerState) return scoped
    return scoped.map((l) => {
      const s = replayWs.layerState!.find((x) => x.id === l.id)
      return s ? { ...l, visible: s.visible, opacity: s.opacity } : l
    })
  }, [replayActive, replayWs, layers, withGeoBbox, online])

  const isVisible = useMemo(() => {
    const m = new Map(mapLayers.map((l) => [l.id, l.visible]))
    return (id: LayerId) => m.get(id) ?? true
  }, [mapLayers])

  // «Unterirdische Bauten» (lib/underground, review round 5): the station's underground buildings
  // as the Karte & Objekte draws them, asked the first time the row is on — never from an incident
  // link, which may not read the station (api/station_reference). ONE overlay object per set and
  // theme, first in the list: under the ERG rings, the drawings and every Lage symbol.
  const undergroundOn = !linkScoped && isVisible(UNDERGROUND_LAYER_ID)
  const underground = useUnderground(undergroundOn)
  const undergroundInk = themeToken('--ink-dim', '#4d586a')
  const undergroundRings = underground?.rings
  const undergroundMapOverlay = useMemo(() => (undergroundRings?.length ? undergroundOverlay(undergroundRings, undergroundInk, UNDERGROUND_LAYER_ID) : null),
    [undergroundRings, undergroundInk])
  // ERG Schutzabstand rings, derived per render from the placards on the board (lib/ergRings,
  // Feldtest Manuel 07.09.). Joined with the prepared overlays so MapLayers needs no new prop.
  // The day/night split is the sun at each placard (lib/daylight), read at compute time; a board
  // left open across sunrise/sunset picks the flip up with the next re-render, which any
  // interaction provides — a Planungshilfe does not warrant its own clock.
  const mapOverlays = useMemo(
    () => [...(undergroundMapOverlay ? [undergroundMapOverlay] : []), ...preparedOverlays, ...ergRingOverlays(entities, new Date())],
    // hazVersion: the ERG table arrives by fetch shortly after boot (lib/useHazardData) —
    // rings drawn from an already-typed UN appear with it.
    [entities, hazVersion, undergroundMapOverlay],
  )

  // the Tafel's pages (10.10.2026): the template set, the pre-fill, the live mini Karte — not for a
  // link session (bound to one object)
  const tafel = useTafelPages({
    enabled: !linkScoped,
    title: incidentMeta.title, address: incidentMeta.address,
    alarmIso: reportMeta.alarmiertAt ?? incidentMeta.started_at, einsatzleiter: reportMeta.einsatzleiter,
    fahrzeuge: reportMeta.fahrzeuge, docEntities: doc.entities,
    mapEntities, drawings, layers: mapLayers, isVisible, byName: sym.byName, center: incidentView.center,
    symMul: symbolScale.map, captionMode: symbolCaptions, trupps: effTrupps,
    openKarte: () => setMode('map'),
  })

  // --- Georeferenz: which plans are tied to the ground, and how — lib/useGeorefFits -------------
  // ⚠️ Called HERE, where the block stood: its effects must keep their place after the store's and
  // the hydrate's. `log` is declared below and reaches it through `histSide` (assigned under it).
  const georefFits = useGeorefFits({
    planDocs, planScale, building, setBuilding, planBindings, activeObjectId, board, objects, rebake,
    planFitsRef, fitsVersion, setFitsVersion, stepLabelRef: stepLabel, histSide, readOnly, canWriteBlob, tacticalLocked, replayActive,
    twinLayers, twinLayerOpacity, activePlanId, liveVehicles, livePeople, isVisible, mapEntities,
  })
  const { linkedPlans, georefPlanRasters } = georefFits

  // The journal is append-only: every action pushes a row, and nothing ever edits
  // or removes one — undo/redo log their own lines. So the stream stays a faithful
  // record of what happened across both surfaces (and could back a standalone screen).
  const pushEvent = (ev: Omit<TimelineEvent, 'id' | 't' | 'at'> & { at?: string }, id?: string) => {
    // ⚠️ A session that may write nothing writes no row (RBAC audit 22.10.2026, §2): the
    // read-only store still took it, showed it on this device only, never sent it, and turned the
    // badge into «Speicher voll» – on the Fahrer tablet, during a real Atemschutz alarm.
    // `roleReadOnly`, NOT `readOnly`: a tab that lost its lock appends on purpose (an upload that
    // lands late), and a closed Einsatz still delivers so the server can refuse out loud.
    if (roleReadOnly) return
    // a caller may stamp `at` explicitly (e.g. a journal entry timed to when the composer was
    // opened, not when Erfassen was pressed); the HH:MM display derives from the same instant.
    const { at: atOverride, ...rest } = ev
    // ⚠️ The DEPLOYMENT's clock, not the device's (lib/serverClock). Every Atemschutz stamp is
    // written that way (useTruppActions · serverNowIso), and a Verlauf row is the same fact said
    // in words: stamped device-local it drifted away from the row it describes, so the printed
    // Journal said «Trupp X draussen 15:22» while the Atemschutz-Detailprotokoll of the same
    // action said 15:27 — two devices, two clocks, one Einsatz (field report 02.09.). Offline
    // `serverNowIso()` IS `Date.now()`, so nothing changes for a station that never reached the
    // server.
    const at = atOverride ?? serverNowIso()
    // ⚠️ Two rows in the same millisecond must never share an id — the server's idempotency skip
    // silently swallows the second (legal record). A per-mount counter kept ONE device's rows
    // apart but not two devices' (post-mortem 23.09.2026): newRowId adds the random tail (lib/ids).
    journal.append({ id: id ?? newRowId(), t: formatTime(new Date(at)), at, ...rest, ...(closingRowsRef.current ? { atClose: true } : {}) })
  }
  // map events keep the positional signature, so every existing call site is unchanged
  // `opts` carries the two things a row may need that are not part of its sentence: `rowId`
  // mints it under a caller-chosen id (idempotency across devices — see useTruppActions ·
  // logTruppAlarm), `subjectId` names the object it is ABOUT without making it a jump target
  // (see types · TimelineEvent.subjectId).
  const log = (icon: string, text: string, kind?: TimelineEvent['kind'], audioUrl?: string, entityId?: string,
    opts?: { rowId?: string; subjectId?: string }) =>
    pushEvent({ icon, text, kind, audioUrl, entityId, subjectId: opts?.subjectId, surface: 'map' }, opts?.rowId)
  // plan events carry document + (optional) team / coordinate context for jump-back
  const logPlan = (icon: string, text: string, extra?: { kind?: TimelineEvent['kind']; annoId?: string; x?: number; y?: number; floor?: number; subjectId?: string }) =>
    pushEvent({ icon, text, kind: extra?.kind ?? 'symbol', surface: 'plan', planId: activePlanId, annoId: extra?.annoId, px: extra?.x, py: extra?.y, floor: extra?.floor, subjectId: extra?.subjectId })
  // Rapport signatures (15.10.2026, lib/reportSignature). Appended / voided through the functional
  // setter and NOT through undo: a step that takes a signature away again would be the one edit
  // the lock exists to prevent. Each says so twice — a Verlauf row for people (a Nachtrag on a
  // closed Einsatz, which is when signing happens) and a hash-chained audit event for the proof.
  const signRapport = (sig: ReportSignature) => {
    const S = appConfig.copy.signature
    setReportSignatures((list) => addSignature(list, sig))
    emit('report.signature.add', { id: sig.id, role: sig.role, name: sig.name, scope: sig.scope })
    pushEvent({ icon: 'check', text: fillTemplate(S.logSigned, { role: sig.role === 'el' ? S.roleEl : S.roleKdt, name: sig.name, sum: shortChecksum(sig.scope) }) })
  }
  const voidSignatures = () => {
    const ids = reportSignatures.filter((g) => !g.voidedAt).map((g) => g.id)
    if (!ids.length) return
    setReportSignatures((list) => voidAll(list, serverNowIso(), 'aendern'))
    emit('report.signature.void', { ids, reason: 'aendern' })
    pushEvent({ icon: 'pen', text: appConfig.copy.signature.logVoided })
  }
  // …and now that both exist, hand them to the timeline's entries (see `histSide` far above:
  // an entry is pushed long before this line runs and pressed long after it).
  histSide.current = { log, emit }

  // Lage-map drawing surface (draft, line mode/preset, draw-style controls, Drawing CRUD +
  // on-canvas editing) lives in useMapDrawing — the undoable doc and selection state are
  // threaded in so the handlers behave identically to their former inline selves.
  const mapDrawing = useMapDrawing({
    drawings, resolvedDrawings: resolvedMapDrawings, selectedDrawingId, tacticalLocked, tool, setTool,
    commit, setDocRaw, beginDrag, endDrag, emit, log,
    setSelectedDrawingId, setSelectedId, setSelectedDrawIds, setSelectedEntityIds,
    // a Leitung end snapped onto a Trupp's marker IS the Leitung pick (15.09.) — the same call
    // the Plan makes from its own magnet (Whiteboard · onLineAttached)
    onLineAttached: (lineId, attachment) => { linkLineToAttachedTrupp(lineId, attachment) },
    onLineDetached: (lineId, previous) => { unlinkLineFromDetachedTrupp(lineId, previous) },
  })
  const {
    setDraft, lineMode, setLineMode, areaMode, setAreaMode, draftActive, draftOpen, selectedDrawing,
    commitDraft, settleDraft, noteDrawingEdit, createLine, createArea, createCircle, patchDrawing, patchDrawingById,
    patchDrawingLabelLive, commitDrawingLabel,
    deleteDrawing, reverseDrawing, setDrawingWallRole, setDrawingAttachment, revertGpsFollow, releaseGpsOnSite, patchDrawingsById,
  } = mapDrawing
  const changeMapEnding = async (ending: LineEnding, drawing = selectedDrawing) => {
    if (!drawing) return
    const incoming = drawing.teilstueck && ending !== 'teilstueck'
      ? drawings.flatMap((d) => (['start', 'end'] as const).filter((endpoint) => {
        const a = endpoint === 'start' ? d.startAttachment : d.endAttachment
        return a?.target.kind === 'line' && a.target.id === drawing.id && a.target.endpoint === 'end'
      }).map((endpoint) => ({ id: d.id, endpoint }))) : []
    if (incoming.length) {
      const ok = await confirmDialog({ title: appConfig.copy.drawingEditor.endingTeilstueck, message: fillTemplate(appConfig.copy.drawingEditor.removeEMessage, { n: incoming.length }), confirmLabel: appConfig.copy.remove, cancelLabel: appConfig.copy.cancel, danger: true })
      if (!ok) return
    }
    const resolvedTarget = resolvedMapDrawings.find((d) => d.id === drawing.id)
    const fallback = resolvedTarget?.coords[resolvedTarget.coords.length - 1] ?? drawing.coords[drawing.coords.length - 1]
    // the Abschluss is a semantic edit like any DrawEditor field — one settled Verlauf row
    // («Zeichnung: Abschluss: Teilstück»), same funnel as patchDrawing (useMapDrawing ·
    // noteDrawingEdit / lib/drawingEdit), which this hand-rolled commit bypasses.
    noteDrawingEdit(drawing, endingFlags(ending))
    // the ends that hung on the «E» let go where it stood — one patch per line, both ends in it,
    // applied here and sent as ONE draw.edit (lib/lineAttachments · detachDrawings)
    const released = detachDrawings(drawings.filter((d) => d.id !== drawing.id), (d, endpoint) => (incoming.some((x) => x.id === d.id && x.endpoint === endpoint) ? fallback : null))
    commit((doc) => ({ ...doc, drawings: doc.drawings.map((d) => (d.id === drawing.id
      ? { ...d, ...endingFlags(ending) }
      : withDetach(d, released))) }))
    emit('draw.edit', { id: drawing.id, patch: endingWireFlags(ending) })
    released.forEach((patch, id) => emit('draw.edit', { id, patch: wireFreed(patch) }))
  }
  // Attached Leitung ends follow their live vehicles (lib/useGpsFollow).
  // ⚠️ 24.09.2026 — this pass was the render storm of the Übung on 23.09.2026 (React #185 on
  // every device with the vehicle feed, and the Karte torn down under a tapped Trupp): it wrote a
  // fresh drawing on every run whether or not anything had moved, and it ran after every render
  // because `setDocRaw` was a new function each time. Both halves are fixed at their root — the
  // pass is idempotent, the store's writers are stable — and both have to stay that way. Gated on
  // `canEditIncident` like the other machine writer on the feed below: a device that cannot
  // write the tactical document only reads the coupling, and a replay is the past.
  useGpsFollow({ liveVehicles, enabled: canEditIncident, setDocRaw })

  // «Wann ist das TLF weggefahren?» is answered by the SERVER now (24.09.2026, D2): its 30 s GPS
  // sweep writes «vor Ort» / «hat den Einsatzort verlassen» on the GPS fix time (backend ·
  // app/vehicle_presence). This device used to run the same rings and stamp the moment IT
  // noticed — all five vehicles «vor Ort» at 19:43 in the Übung, when a tablet woke up; GPS said
  // 19:23–19:28. The server observes; devices never write observations.

  // …and the write that makes the reopen's restart part of the record: every crew still inside
  // gets its contact clock set to the reopen, and ONE Verlauf row per crew under a derived id
  // (three tablets, one row). Only where the Tafel may be written; idempotent, so it settles
  // once the Trupps carry the new time (lib/reopenClocks · clocksAfterReopen).
  useEffect(() => {
    if (!running || replayActive || !canEditTrupps || lifecycleBoundary?.kind !== 'reopened') return
    const next = clocksAfterReopen(allTrupps, lifecycleBoundary)
    if (next === allTrupps) return
    const moved = next.filter((t, i) => t !== allTrupps[i])
    setTrupps((ts) => clocksAfterReopen(ts, lifecycleBoundary))
    const logged = new Set(journal.rows.map((r) => r.id))
    for (const t of moved) {
      const rowId = clockRestartRowId(lifecycleBoundary.id, t.id)
      if (logged.has(rowId)) continue
      log('radio', fillTemplate(appConfig.copy.atemschutz.logClockRestart, { name: truppLogName(t) }), 'team', undefined, undefined, { rowId, subjectId: t.id })
      emit('atemschutz.clock.restart', { id: t.id }, { observed: rowId })
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [running, replayActive, canEditTrupps, lifecycleBoundary, allTrupps])

  // The GPS ends the Meldeleiste speaks about (lib/gpsReturn · gpsNotices) — ONE row per vehicle
  // and question: drove off, following stopped, back on site while its Leitungen still follow.
  const gpsMeld = useGpsNotices(drawings, entities)
  /** The end as the SCREEN shows it now — on a paused coupling that is the on-site point. */
  const resolvedEndOf = (drawing: Drawing, endpoint: 'start' | 'end'): LngLat => {
    const resolved = resolvedMapDrawings.find((d) => d.id === drawing.id)
    return resolved?.coords[endpoint === 'start' ? 0 : resolved.coords.length - 1] ?? drawing.coords[endpoint === 'start' ? 0 : drawing.coords.length - 1]
  }
  const vehicleOf = (drawing: Drawing, endpoint: 'start' | 'end'): string | undefined => {
    const a = endpoint === 'start' ? drawing.startAttachment : drawing.endAttachment
    return a?.target.kind === 'object' ? entities.find((e) => e.id === a.target.id)?.label : undefined
  }
  /** «Weiter folgen» / «Spur» on a GPS end photographs the on-site line first (gps.before), once. */
  const routingOf = (drawing: Drawing, endpoint: 'start' | 'end', routing: 'direct' | 'trace') => {
    const attachment = endpoint === 'start' ? drawing.startAttachment : drawing.endAttachment
    if (!attachment) return null
    const target = attachment.target.kind === 'object' ? entities.find((e) => e.id === attachment.target.id) : null
    return routingPatch(drawing, endpoint, routing, { resolvedEnd: resolvedEndOf(drawing, endpoint), targetCoord: target?.coord, at: serverNowIso() })
  }
  const setGpsRouting = (drawing: Drawing, endpoint: 'start' | 'end', routing: 'direct' | 'trace') => {
    const patch = routingOf(drawing, endpoint, routing)
    if (patch) patchDrawingById(drawing.id, patch)
  }
  /** …on every end of one vehicle at once (the Meldung's «Weiter folgen») — one undo step. */
  const followAll = (ends: readonly GpsEnd[]) => patchDrawingsById(ends.flatMap((e) => {
    const patch = routingOf(e.drawing, e.endpoint, 'trace')
    return patch ? [{ id: e.drawing.id, patch }] : []
  }))
  /** «Am Einsatzort lassen» / «Am Einsatzort lösen»: never at the vehicle's current position — a
   *  followed trace is cut back to its snapshot (gpsReturn · onSiteCoords), in one step, with a
   *  Verlauf row when that removed a drive. */
  const releaseOnSite = (ends: readonly GpsEnd[]) => {
    if (!ends.length) return
    const vehicle = vehicleOf(ends[0].drawing, ends[0].endpoint)
    releaseGpsOnSite(ends.map((e) => ({ id: e.drawing.id, endpoint: e.endpoint, fallback: resolvedEndOf(e.drawing, e.endpoint) })), (lines) => gpsReleaseRow(lines, vehicle))
  }
  /** «Hier lösen (Spur behalten)»: the end lets go where it stands now; the drive stays as the hose. */
  const releaseHere = (drawing: Drawing, endpoint: 'start' | 'end') => {
    setDrawingAttachment(drawing.id, endpoint, undefined, resolvedEndOf(drawing, endpoint))
  }
  /** «Zurück auf Stand am Einsatzort (hh:mm)»: one ↶ (named), one Verlauf row, snapshots cleared. */
  const revertAll = (ends: readonly GpsEnd[]) => {
    const kept = ends.filter((e) => e.before)
    if (!kept.length) return
    const words = gpsRevertWords(kept, vehicleOf(kept[0].drawing, kept[0].endpoint))
    stepLabel.current = words.step
    if (!revertGpsFollow(kept.map((e) => ({ id: e.drawing.id, endpoint: e.endpoint })), words.row)) stepLabel.current = null
  }
  const gpsEndOf = (drawing: Drawing, endpoint: 'start' | 'end'): GpsEnd => {
    const a = endpoint === 'start' ? drawing.startAttachment : drawing.endAttachment
    return { drawing, endpoint, before: freshBefore(a?.gps) }
  }

  const toggleLayer = (id: LayerId) => {
    // A linked plan's RASTER row (its sheet, drawn under the Karte's ink — lib/georefTwins ·
    // planRasterRows) is not a `LayerDef` and does not live in `layerState`: its ids are per plan
    // and per object, so they have no home in the fixed layer list `deriveInitial` reconciles
    // against. It is a device pref instead — same scope, different drawer. Routed by id so the
    // Ebenen panel stays ONE list with one gesture. ⚠️ The `twin:` prefix these ids carry is
    // PERSISTED on the device; it keeps its word because renaming it would reset everyone's rows.
    if (isTwinLayerId(id)) { toggleTwinLayer(id); return }
    // …and the weather radar row, remembered per Einsatz (workspace/useKarteWeather)
    if (weather.handlesLayer(id)) { weather.toggleRadar(); return }
    const target = layers.find((l) => l.id === id)
    // ⚠️ Not from an `el` session: its audit stream carries the record vocabulary only (the
    // backend refuses the whole batch otherwise), and which Ebenen an EL is looking at is
    // their own view, not the FU's tactical picture the replay reconstructs. A viewer's emit
    // is already dropped by the read-only event store; `el` is the one writable non-editor.
    if (!isEl) emit('layer.toggle', { id, base: !!target?.base, visible: target?.base ? true : !(target?.visible ?? true) })
    setLayers((ls) => {
      const target = ls.find((l) => l.id === id)
      if (!target) return ls
      if (target.base) return ls.map((l) => (l.base ? { ...l, visible: l.id === id } : l))
      return ls.map((l) => (l.id === id ? { ...l, visible: !l.visible } : l))
    })
  }
  /** Ebenen quick-taps (field ask 07.09.): flip every overlay at once, or return to the layer
   *  set this Einsatz category opens with. Bases stay out of the bulk flip (a map with no base
   *  is a flat colour, and the base row is a radio, not an eye); the plan raster rows keep their
   *  own drawer.
   *  Each real change emits the ordinary `layer.toggle`, so the replay reconstructs bulk taps
   *  with the vocabulary it already speaks. */
  const setAllLayers = (visible: boolean) => {
    // same `!isEl` rule as toggleLayer above — an EL's Ebenen are their own view
    if (!isEl) for (const l of layers) if (!l.base && l.visible !== visible) emit('layer.toggle', { id: l.id, base: false, visible })
    setLayers((ls) => ls.map((l) => (l.base || l.visible === visible ? l : { ...l, visible })))
    // «Alle aus» takes the radar with it; «Alle ein» leaves it alone (workspace/useKarteWeather)
    if (!visible) weather.setRadar(false)
  }
  const resetLayers = () => {
    const next = defaultLayers(incidentMeta.type)
    if (!isEl) for (const l of next) {
      const cur = layers.find((x) => x.id === l.id)
      if (!cur || cur.visible === l.visible) continue
      // a base is a radio: only the one that BECOMES visible is announced, or the replay's
      // radio semantics would re-select whichever base event happened to come last
      if (l.base && !l.visible) continue
      emit('layer.toggle', { id: l.id, base: !!l.base, visible: l.visible })
    }
    setLayers(next)
    // no Einsatz category opens with the radar on: «Standard» switches it off (10.10.2026)
    weather.setRadar(false)
  }
  // which quick-tap the Ebenen on screen match — lit in the panel, named in the Ebenen button's
  // tooltip / accessible name (lib/layerPreset, 05.10.2026)
  const layersPreset = useMemo(() => layerPreset(layers, defaultLayers(incidentMeta.type), weather.on && weather.radarOn),
    [layers, incidentMeta.type, weather.on, weather.radarOn])
  const setOpacity = (id: LayerId, v: number) => {
    if (weather.handlesLayer(id)) { weather.setRadarOpacity(v); return }
    if (isTwinLayerId(id)) {
      // written outside the updater — see the note on persistTwinLayers
      const next = { ...twinLayerOpacity, [id]: v }
      setTwinLayerOpacity(next)
      savePrefs({ ...loadPrefs(), twinLayerOpacity: next })
      return
    }
    setLayers((ls) => ls.map((l) => (l.id === id ? { ...l, opacity: v } : l)))
  }

  /** Put the armed Karte tool down: back to Auswahl, its arming UI (palette, «Welcher Trupp?»)
   *  closed. clearMapUi, the lock below and entering Koordinaten all go through here. */
  const disarmMapTool = () => {
    // settleDraft, not setDraft([]): leaving the map (or opening a dock) mid-draft used to be a
    // silent discard — a committable draft asks «Speichern · Verwerfen · Weiterzeichnen»
    // (useMapDrawing · settleDraft).
    setTool('select'); setPending(null); setPendingShape(null); settleDraft(); setTeamPick(null)
    // the palette IS the arming UI for the symbol tool, so it goes with the tool it arms —
    // otherwise leaving the map with it open silently re-opened it on the way back
    setPaletteOpen(false)
  }

  /**
   * The ONE place that drops the Lage map's transient UI. Six call sites — pick, togglePanel,
   * toggleViews, NavRail's onMode, goToModule, enterReplay — each used to hand-write its own
   * subset of this list, and the subsets had drifted apart. That drift was the bug: reaching for
   * Linie / Fläche / Notiz / Team while a symbol was selected left its ContextPanel open, and the
   * panel is drawn straight over the tool's own dock (the ✓/✕ and the colour/width controls), so
   * the tool you had just picked was unusable until you guessed to press Esc. On a phone the panel
   * is a 46dvh bottom sheet and buries the tool bar outright. The Plan surface never had this —
   * Whiteboard gates all four of its editors on `tool === 'pan'`; this is the Lage catching up.
   *
   * `keep: 'selection'` is for the two chrome toggles (Ebenen, Kartenansichten): throwing away
   * what you had tapped just to look at a layer would be its own surprise, so the halo stays and
   * the panel returns when the dock closes.
   *
   * ⚠️ This used to claim the toggles are "drawn ABOVE the detail panel … so nothing becomes
   * unreachable". They are drawn above it — and at the SAME coordinates: `.layers-card` (z201,
   * 320px) lands on `.ctx` (z35, 360px), and on a phone both are bottom sheets on the same edge
   * with only a z28 backdrop between them, so the buried panel stayed tappable. Keeping the
   * selection was right; concluding that the panel could therefore stay rendered was not. The
   * panel now stands down via `detailSlotFree` while a dock is up — see its note above.
   */
  const clearMapUi = (keep?: 'selection') => {
    disarmMapTool()
    setPanel(null); setViewsOpen(false)
    // the two chrome toggles keep Koordinaten too: its switch IS a row of the Ansichten menu
    if (keep === 'selection') return
    coordPicker.setMode('off')
    setSelectedId(null); setSelectedDrawingId(null); setSelectedDrawIds([]); setSelectedEntityIds([])
    setNotePanelId(null); setEditNoteId(null)
  }

  // Locking the surface mid-draw (Führungsansicht toggled on, tab lock lost, replay entered)
  // must not leave a create tool armed behind a dock that is no longer rendered — disarm down to
  // the tool set the locked rail actually offers. Messen and Auswahl survive untouched.
  useEffect(() => {
    if (!tacticalLocked || isMapReadOnlyTool(tool)) return
    // settleDraft under the lock cannot commit (the create funnel refuses a locked surface) —
    // but it still SAYS the draft was discarded instead of dropping it silently.
    disarmMapTool(); setEditNoteId(null)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tacticalLocked, tool])

  // Enter replay WITHOUT forcing a surface: one timeline drives both the Lagekarte and the Plan,
  // so the user can toggle Lage/Plan during playback to inspect each surface at the scrubbed
  // instant. Editing stays locked (replayActive feeds readOnly/tacticalLocked); clearMapUi makes
  // sure nothing is mid-edit on entry — including the lasso halos and the «Welcher Trupp?» picker,
  // which its old hand-written list missed and which then sat over a read-only past.
  const enterReplay = () => { clearMapUi(); setReplayActive(true) }
  // ── Verlauf ⇄ Wiedergabe ──
  // The bar owns the playhead (it ticks four times a second at 4×; lifting that here would
  // re-render the workspace on every frame). It reports the playhead only when it CROSSES a
  // Verlauf row, and hands its seek down through a ref — the same imperative-handle pattern the
  // Plan's fit and history already use. Together those two make a row a way into the moment.
  const replaySeek = useRef<((ms: number) => void) | null>(null)
  const [journalLandOn, setJournalLandOn] = useState<{ id: string; nonce: number } | null>(null)
  const [replayAtMs, setReplayAtMs] = useState<number | null>(null)
  const onReplayPlayhead = useCallback((ms: number) => setReplayAtMs(ms), [])
  const seekToEvent = (e: TimelineEvent) => {
    const t = e.at ? Date.parse(e.at) : NaN
    if (Number.isFinite(t)) replaySeek.current?.(t)
  }

  // Ebenen shares the dock slot with the views popover and the tool docks — opening it
  // drops the active tool and closes the views menu (mirror of toggleViews below).
  const togglePanel = (name: 'layers') => {
    if (panel === name) { setPanel(null); return }
    clearMapUi('selection')
    setPanel(name)
  }

  // leaving replay drops the playhead with it, or a later Verlauf would still dim its own future
  useEffect(() => { if (!replayActive) setReplayAtMs(null) }, [replayActive])

  const mapWorkRect = (container: DOMRect, panelEl: Element): NudgeBox | null => {
    const panel = panelEl.getBoundingClientRect()
    if (!panel.width) return null
    const surface = { minX: 0, maxX: container.width, minY: 0, maxY: container.height }
    const obstruction = {
      minX: panel.left - container.left, maxX: panel.right - container.left,
      minY: panel.top - container.top, maxY: panel.bottom - container.top,
    }
    return visibleWorkRect(surface, obstruction, isBottomSheet(panel.width, container.width))
  }
  /** Centre a deliberate jump in the part of the map that remains visible around an editor.
   *  Selection state mounts the editor in the same frame; one rAF lets us measure its real
   *  desktop/tablet/phone geometry before the camera moves. Zoom is chosen by the caller. */
  const flyToMapVisible = (center: LngLat, zoom: number) => {
    requestAnimationFrame(() => {
      const m = mapRef.current?.getMap()
      if (!m) return
      const cont = m.getContainer().getBoundingClientRect()
      const panelEl = document.querySelector('.ctx')
      const surface = { minX: 0, maxX: cont.width, minY: 0, maxY: cont.height }
      const work = panelEl ? mapWorkRect(cont, panelEl) : visibleWorkRect(surface, null, false)
      const target = rectCenter(work ?? visibleWorkRect(surface, null, false))
      m.flyTo({ center, zoom, offset: [target.x - cont.width / 2, target.y - cont.height / 2], ...(prefersReducedMotion() ? { duration: 0 } : {}) })
    })
  }
  // select + fly to an object — used by clickable Verlauf rows
  const focusEntity = (id: string) => {
    const e = entities.find((x) => x.id === id); if (!e) return
    setSelectedId(id); setSelectedDrawingId(null); flyToMapVisible(e.coord, 18.4)
  }
  // which Verlauf rows are still a way somewhere: the same objects focusEntity / focusEvent land on
  const journalLive = useMemo(() => liveTargets([...entities, ...doc.drawings], planDocs, board), [entities, doc.drawings, planDocs, board])
  // a «Messungen» row: to the point, on the surface it was placed on (the Verlauf's focusEvent recipe)
  const goToReading = (p: MeasuredPoint) => {
    if (p.at.surface === 'map') { setMode('map'); focusEntity(p.id); return }
    if (mode !== 'plans') clearMapUi()
    setMode('plans'); setPanel(null); setActivePlanId(p.at.planId)
    setPlanFocus({ x: p.at.x, y: p.at.y, floor: p.at.floor, annoId: p.id, nonce: Date.now() })
  }
  // Durchhören player: replay a long recording and
  // append ordinary journal rows at the paused position — Nachdokumentation. The row's `at`
  // is the wall-clock instant inside the recording, so it lands (and marks) correctly.
  const [player, setPlayer] = useState<{ row: TimelineEvent; seekSec?: number } | null>(null)

  // the Verlauf's actions: a row back to where it happened, pictures onto the Karte, the composer,
  // the player, the Wiedervorlagen, voice memo and quick photo (workspace/useJournalWriters)
  const {
    reminders, voice, startVoiceMemo, startQuickPhoto, focusEvent, reRaisePendenz, photoOnMap, placePhotos,
    showPhotoOnMap, addPlayerEntry, addJournal, photoInputRef, onQuickPhotoPicked,
  } = useJournalWriters({
    building, setJournalOpen, setMode, setPanel, setActivePlanId, setPlanFocus, flyToMapVisible,
    focusEntity, incidentMeta, incidentView, doc, tacticalLocked, replayActive, stepLabelRef: stepLabel, commit, emit,
    log, setSelectedDrawingId, setSelectedId, mode, pushEvent, composerOpenedAtRef: composerOpenedAt, activePlanId,
    uploadPhotoForRow, uploadMediaForRow, setComposerOpen, setNoteOn, player, timeline, running, undoHist, journal,
  })

  // --- Atemschutzüberwachung (SCBA monitoring): Trupp mutations live in useTruppActions ---
  /** WHERE a placed Trupp's symbol stands, in words — «Gebäude · 2. OG», «M6», «Karte · bei
   *  Hydrant» — the Notfall's «letzter Ort» beside its Auftrag/Ziel (F1, useTruppActions ·
   *  truppPlace). Read when asked, off the picture as it stands; nothing placed ⇒ nothing said. */
  const truppPositionWords = (t: Trupp): string | undefined => {
    const nf = appConfig.copy.atemschutz.notfall
    if (t.annoId && t.planId) {
      const plan = planDocs.find((p) => p.id === t.planId)
      const anno = (board[t.planId] ?? []).find((a) => a.id === t.annoId)
      const floor = t.planId === gebaeudeDoc.id && anno ? floorLabel(anno.floor ?? 0) : ''
      return [plan?.code ?? '', floor].filter(Boolean).join(' · ') || undefined
    }
    if (t.entityId) {
      const marker = doc.entities.find((e) => e.id === t.entityId)
      const host = marker?.dockedTo ? doc.entities.find((h) => h.id === marker.dockedTo) : undefined
      return host ? fillTemplate(nf.placeMapAt, { host: host.label || appConfig.copy.entities.fallbackObjectName }) : nf.placeMap
    }
    return undefined
  }
  const crewSlotsRef = useRef<((t: Trupp) => CrewSlot[]) | undefined>(undefined)
  const truppActions = useTruppActions({
    trupps, drawings, entities, objects, setTrupps, board, building, log, logPlan, emit, setMode, setActivePlanId, setPanel, setPlanFocus,
    // The Atemschutz-Tafel joins the one global timeline (08.09.2026): every Kontakt, Druck,
    // Statuswechsel, Bearbeitung, Wieder-Einrücken, Anmeldung and Löschen records itself there,
    // so ↶ in the header reaches the board — including from the handed-over Link-Tafel, which
    // has no TopBar and gets its own pair (AtemschutzView · headActs).
    undoTimeline: undoHist,
    // ⚠️ …and reads the CURRENT trupps when a step is finally pressed, not the render that
    // recorded it. A merge between the tap and the ↶ is exactly the case that has to decline.
    liveTrupps: () => truppsRef.current,
    counterNames: () => truppCounterNames(),
    placeOf: truppPositionWords,
    // the crew as the roster reads it, for the one-person crew edits (atemschutz · truppCrewWithout);
    // read at the tap, from the ref the roster indexes further down keep current
    slotsOf: (t) => crewSlotsRef.current?.(t),
    // An Atemschutz-Link session syncs the trupps slice and nothing else: a chip removed or
    // recoloured here would change only on this phone and be undone by the next poll, while
    // the tablet keeps the old one. So the placement half of every Trupp action is a no-op
    // there; the tablet's own board/entities stay the single source for the picture.
    setBoard: asLink ? () => {} : setBoard,
    setDocRaw: asLink ? () => {} : setDocRaw,
    // a new map marker lands at the current map centre (the operator drags it to position);
    // fall back to the Einsatzort when the map hasn't been opened yet this session
    mapCenter: () => {
      const c = mapRef.current?.getMap()?.getCenter()
      return c ? [c.lng, c.lat] as LngLat : incidentView.center
    },
    // jump-to for a team marker: coord is passed on placement (state not yet committed);
    // later focuses look the entity up like a Verlauf row does. fly=false selects without
    // moving the camera (tap-placed markers are already in view).
    // the hose a Trupp works on — «Leitung zeigen» on the Atemschutz card
    // «Leitung zeigen» SHOWS the hose, it does not open it: fly there and outline it for a
    // moment, with nothing selected — no vertex handles under the finger, no editor sheet over
    // the map. Tapping the line is still how you edit it.
    focusMapDrawing: (drawingId) => {
      setSelectedDrawIds([]); setSelectedEntityIds([]); setSelectedDrawingId(null); setSelectedId(null)
      const d = drawings.find((x) => x.id === drawingId)
      if (d?.coords[0]) flyToMapVisible(d.coords[0], 17.8)
      setFlashDrawingId(drawingId)
    },
    focusMapEntity: (entityId, coord, fly = true) => {
      setMode('map')
      if (!fly) { setSelectedId(entityId); setSelectedDrawingId(null); return }
      if (coord) { setSelectedId(entityId); setSelectedDrawingId(null); flyToMapVisible(coord, 18.4) }
      else focusEntity(entityId)
    },
  })
  const { createTrupp, moveTrupp, placeTruppOnPlan, placeTruppOnMap, adoptTruppMarker, focusTruppOnPlan, recordContact, recordPressure, setTruppStatus, triggerNotfall, endNotfall, truppPlace, editTrupp, designateSafety, transferOutOfTrupp, keepInOneTrupp, reactivateTrupp, logTruppAlarm, logTruppAlarmCleared, deleteTrupp, restoreTrupp, linkTruppLine, linkLineToAttachedTrupp, unlinkLineFromDetachedTrupp, unlinkTruppLine, unlinkLine, syncLineNoToTrupp, showTruppLine, truppsWithLine, truppLineNos, truppColors } = truppActions
  // The alarm host runs on EVERY device – tone and OS notification are the point – but only a
  // session that writes the Trupps records the crossing in the Verlauf (RBAC audit V1, 22.10.2026).
  // The FU or the Atemschutz-Link writes that row, once per turnus, for everybody.
  const alarmLog = canEditTrupps ? { logAlarm: logTruppAlarm, logAlarmCleared: logTruppAlarmCleared } : {}
  /** a due Wiedervorlage rings (tone + OS notification) only for the sessions that can tick it
   *  off – editor and el (owner, 22.10.2026); viewers and every link see the due row silently */
  const remindersAlert = isEditor || isEl

  // the Karte's gestures and commands — tool picks, map taps, views, keys, the lasso group, marker
  // moves and docking, jumps, delete and «erledigt» (workspace/useMapActions)
  const mapActions = useMapActions({
    clearMapUi, setPaletteOpen, tool, setTool, setPending, setPendingShape, setSelectedId,
    setSelectedDrawingId, setSelectedDrawIds, setSelectedEntityIds, setNotePanelId, setEditNoteId, panel,
    setPanel, tacticalLocked, pendingShape, rotStart, setRotStart, commit, placeLock, log, emit, pending,
    sym, addRecent, noteDefaults, setNotePlacedId, setTeamPick, setDraft, settleDraft, lineMode, measure, mapRef,
    incidentView, entities, liveIds, resolvedMapDrawings, cameraViews, view, setLocateReq, incidentOpen,
    share, setShareParent, setSharePick, setCameraViews, rememberOneShotRef, C_HIST, setViewsOpen,
    viewsOpen, selectedId, selectedDrawIds, selectedEntityIds, doc, truppCounterNames, selectedDrawingId,
    planDocs, mode, setMode, setActivePlanId,
    hotkeyRef, settingsOpen, paletteOpen, pickerOpen, helpOpen, installGuideOpen, offlineReadyOpen,
    shareLink, composerOpen, georefActive, georefMode, replayActive, readOnly, linkScoped, goToNav,
    planFit, stepHistory, planKeys, setJournalOpen, setComposerOpen, togglePanel, setSettingsOpen,
    setHelpOpen, coord, notePanelId, notePlacedId, mapWorkRect, drawings, drawTap, beginDrag, setDocRaw,
    endDrag, flyToMapVisible, setVehicleOverrides, trupps, linkTruppLine, patchEntity, objectsRef, objects,
    setPlanFocus, focusEntity, editNoteId, user, stepLabelRef: stepLabel,
  })
  const {
    deleteGroup, deleteEntity, placed, goToModule, goToTrupp, viewsApi, toggleViews, selected,
    undockTeam, setEntityDone, focusDrawing, noteEntity, pick, pickShape,
  } = mapActions
  // a generic (untracked) team marker — the map twin of the plan's placeTeamChip
  const teamMarkers = useTeamMarkerActions({
    entities, commit, log, emit, setSelectedId, setSelectedDrawingId,
    // every chip, every ghost trail and every registered Trupp count into the numbering: ONE
    // counter per Einsatz (docs/trupp-naming.md §1)
    placedTeamNames: () => truppCounterNames(),
    trupps: () => truppsRef.current,
    teamNameTaken,
  })
  const { placeGenericTeam } = teamMarkers
  /** The card's / the form's half of a marker join. A Trupp that was JUST registered is not in
   *  the hook's `trupps` until the next render, so its adopt waits one render (pendingAdopt);
   *  an existing Trupp joins straight away. */
  const [pendingAdopt, setPendingAdopt] = useState<{ truppId: string; markerId: string } | null>(null)
  const adoptMarkerA = (truppId: string, markerId: string) => {
    if (trupps.some((t) => t.id === truppId)) void adoptTruppMarker(truppId, markerId)
    else setPendingAdopt({ truppId, markerId })
  }
  useEffect(() => {
    if (!pendingAdopt || !trupps.some((t) => t.id === pendingAdopt.truppId)) return
    setPendingAdopt(null)
    void adoptTruppMarker(pendingAdopt.truppId, pendingAdopt.markerId)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pendingAdopt, trupps])
  /** «Im Atemschutz zeigen» from a map marker or a plan chip (both surfaces): to the board, landed
   *  on that Trupp's card — the board can be a wall of Trupps, so the jump answers «which one?». */
  const showTrupp = (truppId: string) => { setMode('atemschutz'); setPanel(null); setTruppFocus({ id: truppId, nonce: Date.now() }) }
  /** «Neuer Trupp» on a loose marker's join sheet (both surfaces): to the board, form open,
   *  and the marker waits for the save. */
  const newTruppFromMarker = (markerId: string) => {
    setMode('atemschutz'); setPanel(null)
    setTruppCreate({ nonce: Date.now(), adoptMarkerId: markerId })
  }
  // where a Trupp can actually go: always the Lage map (outdoor teams), plus the Gebäude
  // floor-stack ONLY once it's been created from the Umrisse (building != null), plus Modul 6
  // ONLY if this object has that plan. ≥1 target always — the picker adapts (1 → place
  // directly, 2+ → choose).
  const placeTargets = useMemo(() => [
    { id: LAGE_TARGET, label: appConfig.copy.atemschutz.placeLage },
    // …plus every plan sheet this object actually HAS, in rail order — not just Modul 6 (05.09.).
    // A Trupp works on the Modul the Einsatz is being run off, and hard-coding one slot meant a
    // station whose floor plans live on Modul 2/3 could only put a crew on the Karte. Two are
    // left out on purpose: a `viewer` sheet carries no annotation surface, and the Umrisse picker
    // (isSelectOnlySurface) is where a Gebäude is CHOSEN — the Gebäude itself is in `planDocs` the
    // moment it exists, and that is the one to stand on.
    ...planDocs.filter((p) => !p.viewer && !isSelectOnlySurface(p)).map((p) => ({ id: p.id, label: p.code })),
  ], [planDocs])
  // one placement dispatcher for the AtemschutzView picker: Lage target → map, else plan
  const placeTrupp = (id: string, targetId?: string) =>
    targetId === LAGE_TARGET ? placeTruppOnMap(id) : placeTruppOnPlan(id, targetId)
  // The Leitungen that exist on either surface, for the Trupp form's quick-picks. A function
  // rather than a memo: the «taken by» read has to ignore the Trupp currently being edited.
  const truppLeitungOptions = (exceptTruppId?: string) => leitungOptions(
    drawings.filter((d) => d.kind === 'line'),
    Object.values(board).flat().filter((a) => a.kind === 'draw'),
    effTrupps, exceptTruppId,
  )
  // The Trupp symbols that already stand somewhere, for the placement picker. A function, like
  // the Leitung quick-picks: «gehört zu» has to ignore the Trupp being placed itself.
  const truppMarkerOptions = (exceptTruppId?: string) => markerOptions(placed, effTrupps, exceptTruppId)
  // --- Anwesenheit (attendance over the Divera Mannschaft) ---
  // Roster is session-loaded; attendance rides the per-incident workspace blob. Marking
  // is append-only in spirit: a no-op tap never logs, "Gegangen" keeps the earlier presence,
  // and a person in an active Trupp can't be marked gone until the Trupp is out (checkout rule).
  const { people: personnel, loading: personnelLoading, error: personnelError, reload: reloadPersonnel } = usePersonnel()
  /** The roster as a PICKER sees it: the Mannschaft plus everybody recorded on this Einsatz who
   *  is not on it (lib/guests). A Gast used to be nameable exactly once — on the Anwesenheit that
   *  created them — and was then invisible to the Trupp form, the Fahrer field and the
   *  Einsatzleiter picker, so the Nachbarwehr driver who was standing right there could not be
   *  written down anywhere it mattered. */
  const pickablePersonnel = useMemo(() => rosterWithGuests(personnel, attendance), [personnel, attendance])
  /** ⚠️ …and every index below is built from THAT list, guests included. Offering a Gast in the
   *  dropdown while resolving names against the bare Mannschaftsliste is the worst of both: the
   *  picker let you choose the Nachbarwehr's Fahrer and then nothing recorded it, because the
   *  name resolved to no id — no Anwesenheits-Bemerkung, no lock, and their name never marked in
   *  the Verlauf. What a picker offers and what the app can resolve have to be one list. */
  const rosterById = useMemo(() => new Map(pickablePersonnel.map((p) => [p.id, p])), [pickablePersonnel])
  /** roster display name → person id. The symbol fields and the Erfassungsblatt pick from a list
   *  of NAMES (Combo, not PersonField), so this is what turns «Widmer Céline» back into somebody
   *  the Anwesenheit can be written for. A name that matches nobody — not even a Gast already on
   *  this Einsatz — resolves to undefined: that is mutual aid nobody has written down yet.
   *  ⚠️ Built by lib/personnel rather than inline, so it is the SAME index (and the same word-
   *  order tolerance) the Atemschutz board and `truppSlots` match against — an app that resolves
   *  «Hans Müller» on one screen and not on the next is worse than one that never resolves it. */
  const rosterIdByName = useMemo(() => rosterIdByNameOf(pickablePersonnel), [pickablePersonnel])
  useEffect(() => { crewSlotsRef.current = (t) => truppCrewSlots(t, rosterIdByName, rosterById) }, [rosterIdByName, rosterById])
  // ⚠️ Read the Trupps through the roster first (lib/personnel · linkTrupps). Everything below
  // answers «who is already committed» from IDS, so a Trupp carrying only names was invisible to
  // all of it — the Fahrer picker said nothing about somebody under Atemschutz, their Anwesenheit
  // row did not lock, and «einer, ein Trupp» quietly stopped holding. The record is untouched.
  const linkedTrupps = useMemo(() => linkTrupps(trupps, rosterIdByName, rosterById), [trupps, rosterIdByName, rosterById])
  const blockedAttendanceIds = useMemo(() => assignedPersonIds(linkedTrupps), [linkedTrupps])
  const truppOfPerson = useMemo(() => truppByPersonId(linkedTrupps), [linkedTrupps])
  // ── the Anwesenheit is undoable, like the map ──────────────────────────────────────────────
  // ⚠️ Its own stack, driven by the SAME ↶ ↷ in the TopBar (see showHistory below). The list is
  // the fastest-tapped surface in the app — 60 names, gloves, a neighbouring row half a centimetre
  // away — and until now only three of its actions offered a way back (the confirm-with-undo
  // toasts in useAttendanceActions). Those stay: the toast catches the mistake you notice at once,
  // the stack the one you notice three names later. A toast undo is itself a write through `set`,
  // so ↶ after it re-applies the tap — «undo the last thing I did», consistently.
  // ⚠️ `canWriteRecord`, not `readOnly`: the Anwesenheit is not the Atemschutz-Link's slice.
  const attHist = useUndoableSlice(attendance, setAttendance, !canWriteRecord, undefined, ATTENDANCE_RECORDS)
  /** Record an Anwesenheits-Schritt on the global timeline. The slice keeps its own stack and
   *  performs the step (delegation); this only says WHEN it happened relative to everything else.
   *  ⚠️ Through a ref, and declared up here: `attSet` is handed to `useAttendanceActions` during
   *  THIS render, while `stepAttendance` needs the roster that is built further down.
   *  ⚠️ The label is the surface, not the names. At push time the write has not landed, so who
   *  moved is not knowable yet — and the Verlauf row `stepAttendance` writes still names them,
   *  which is where a reader six months later actually looks. */
  const stepAttendanceRef = useRef<(dir: 'undo' | 'redo', step?: string) => boolean>(() => false)
  const rememberAttendanceStep = () => {
    // the slice step the write just laid, and the people it writes (lib/undoKeys)
    const step = attHist.topStep() ?? undefined
    return undoHist.push({
      domain: 'anwesenheit',
      label: C_HIST.undoDomains.anwesenheit,
      step,
      // (any render's `attHist` will do: its stacks are refs, shared by every render)
      touches: () => (step ? attHist.stepKeys(step) : null),
      undo: () => stepAttendanceRef.current('undo', step),
      redo: () => stepAttendanceRef.current('redo', step),
    })
  }
  /**
   * A Trupp SAVE is one act (staging r3 F1): the Gäste its form files, the crew it marks present
   * and the AS-Funktion it writes are part of «Trupp 2 … angemeldet» — ONE ↶ takes the Trupp and
   * the people it filed back together, nothing half-done. Opened by the first write of a save
   * (fileTruppGuest, or the create/edit/re-entry wrapper), it gathers every step pushed until the
   * save's synchronous run ends (a microtask later) into one timeline entry, and folds the
   * Anwesenheit writes of that run into ONE slice step.
   * It used to leave «Rückgängig: Anwesenheit» on top, which stripped the crew's Funktion, kept
   * them present, kept the Trupp — and wrote «Anwesenheit zurückgenommen» over it.
   */
  const truppSaveRef = useRef<{ laidAttendance: boolean } | null>(null)
  const openTruppSave = () => {
    if (truppSaveRef.current) return
    const save = { laidAttendance: false }
    truppSaveRef.current = save
    const end = undoHist.group('trupps')
    queueMicrotask(() => { if (truppSaveRef.current === save) truppSaveRef.current = null; end() })
  }
  /** The one write path for the Anwesenheit: checkpoint on the slice, and record the step. Inside
   *  a Trupp save the save's first write is its step and the rest fold into it.
   *  ⚠️ An entry only for a write that LAID a step (a viewer's write lays none — an entry for it
   *  would step the one below, somebody else's). */
  const attSet: typeof attHist.set = (update) => {
    const save = truppSaveRef.current
    if (save?.laidAttendance) return attHist.set(update, { coalesce: () => true })
    const laid = attHist.set(update)
    if (laid) rememberAttendanceStep()
    if (save && laid) save.laidAttendance = true
    return laid
  }
  /**
   * A Gebäude one-shot on the timeline. These own no stack at all — a storey added, a storey
   * removed, a building replaced — so the entry carries BOTH states itself, the way the
   * confirm-with-undo toast used to carry one of them.
   *
   * ⚠️ The toasts stay (they are the fast door for the mistake you notice at once) and each one
   * drops its entry when it is used, so an act is never undoable twice. The label is the toast's
   * own sentence, so the header says «Rückgängig: Geschoss gelöscht» and not «… Gebäude».
   */
  /** `rows` replaces the generic «… rückgängig gemacht / wiederhergestellt» with the act's own
   *  counter-rows where it has better words («Geschoss 3. OG wiederhergestellt»). ⚠️ `'silent'`
   *  for an act that wrote NO row (staging walk-through 26.09.2026, D6): a counter-row about an
   *  act the record never mentioned is the paper describing something it never said happened —
   *  an Ansicht, a Drehung, a Gebäude swap, a Beilage (verlauf-coverage · «taken back»).
   *  ⚠️ `touches` names EVERY record `restore`/`reapply` write (lib/undoKeys) — that is what a
   *  remote merge checks the step against; a record left out is one a ↶ could carry a pre-merge
   *  value back into. A function, read when a merge lands, for a set only knowable then.
   *  ⚠️ The audit op is domain-scoped like `logHistStep`'s: a Rapport one-shot (a Beilage added,
   *  captioned, removed) is the `el`'s too, whose event scope drops a bare `undo` — so its step
   *  goes out as `report.undo` / `report.redo` (RBAC audit §4, 22.10.2026). The tactical ones
   *  (Gebäude, Spur) are an editor's alone and keep the bare op. */
  const rememberOneShot = (domain: UndoDomain, label: string, restore: () => void, reapply: () => void, touches: () => readonly RecordKey[] | null, rows?: OneShotRows | 'silent') => {
    const op = domain === 'rapport' ? 'report.' : ''
    return undoHist.push({
      domain,
      label,
      touches,
      undo: () => { restore(); oneShotRow('undo', label, rows, op); return true },
      redo: () => { reapply(); oneShotRow('redo', label, rows, op); return true },
    })
  }
  rememberOneShotRef.current = rememberOneShot
  // the Abschluss's «nicht eingesetzt» door (standDownTrupps above) — read only when the question
  // is answered, long after this commit, so an effect is the place to point it
  // ⚠️ Re-checked against the Trupps as they stand NOW: a Sicherungstrupp sent in while the
  // Abschluss stood open is inside, and «raus» on it would be a real Austritt nobody reported.
  useEffect(() => {
    standDownRef.current = (ids) => {
      for (const id of ids) {
        const t = truppsRef.current.find((x) => x.id === id)
        if (t && truppStillRegistered(t)) setTruppStatus(id, 'raus')
      }
    }
  })
  useEffect(() => {
    noteNotfallRef.current = (ts) => {
      for (const t of ts) {
        log('warn', fillTemplate(appConfig.copy.atemschutz.notfall.logAtClose, { name: truppLogName(t) }), 'team',
          undefined, undefined, { subjectId: t.id })
      }
    }
  })
  useEffect(() => {
    noteInsideRef.current = (ts) => {
      for (const t of ts) {
        log('logout', fillTemplate(appConfig.copy.atemschutz.logInsideAtClose, { name: truppLogName(t) }), 'team',
          undefined, undefined, { subjectId: t.id })
      }
    }
  })
  const rememberGebaeudeStep = (label: string, restore: () => void, reapply: () => void, touches: () => readonly RecordKey[] | null, rows?: OneShotRows | 'silent') =>
    rememberOneShot('gebaeude', label, restore, reapply, touches, rows)
  /** The row a one-shot's step owes the record, in either direction — its own words, or the generic ones. */
  const oneShotRow = (dir: 'undo' | 'redo', label: string, rows?: OneShotRows | 'silent', op = '') => {
    if (rows === 'silent') { histSide.current.emit(`${op}${dir}`); return }
    if (!rows) { logHistStep(dir, label, op); return }
    rows[dir]()
    histSide.current.emit(`${op}${dir}`)
  }
  /**
   * ⚠️ A one-shot's confirm-with-undo toast. Its «Rückgängig» is the SAME act as the header's ↶ —
   * so it writes the SAME counter-row (staging walk-through, 25.09.2026: a storey restored from
   * the toast left «Geschoss 3. OG entfernt» standing alone on the printed Einsatzjournal, about a
   * storey that still existed) — and drops the timeline entry, so the act is never taken back twice.
   * Guarded by the entry (`drop.standing`): once a merge dropped it, or a ↶ already took it, the
   * toast declines instead of writing over another device's change. `opts.kind` (#232): a toast of
   * the same kind still on screen gives way to this one.
   */
  const oneShotUndoToast = (text: string, label: string, restore: () => void, drop: Dropper, rows?: OneShotRows | 'silent', opts?: { kind?: string }) =>
    undoToast(text, () => { restore(); drop(); oneShotRow('undo', label, rows) }, drop.standing, opts)
  // the Gebäude's own acts on the Plan — pick, storeys, Drehung (workspace/useGebaeudeActions)
  const gebaeude = useGebaeudeActions({
    tacticalLocked, building, setBuilding, board, setBoard, objects, objectsRef, boardRef, floorPack: georefFits.floorPack,
    planBindings, activeObjectId, setActivePlanId, rememberGebaeudeStep, oneShotUndoToast, logPlan, lastReorient,
  })

  /* ── «Spur»: der abgesuchte Bereich überlebt seinen Marker (18.09.2026) ─────────────────────
   *
   * Removing a Trupp marker used to remove the searched area with it, which is why both surfaces
   * REFUSED to remove a marker carrying a trail. The trail is now owned by the incident
   * (lib/truppTrails): a marker that disappears leaves a read-only grey ghost behind, and one
   * that comes back takes its own trail home again.
   *
   * ⚠️ Driven as a RECONCILIATION rather than as a write on each removal path, and that is what
   * makes the undo ONE step. Four doors take a marker off a picture — the chip's trash, the map
   * marker's trash, either group delete, and `deleteTrupp` · `dropPlacements` — each with its own
   * history; a ghost written by each of them would be a second timeline entry, and «Rückgängig»
   * would hand the marker back with its ghost still standing beside it. Here nothing is pushed:
   * the removal's own step is the whole act, in both directions.
   *
   * ⚠️ `prevSources` is NULLED by a remote hydrate (applyWorkspace replaces the whole store), or
   * the merge would read every marker as removed at once and ghost the lot.
   */
  const truppNoOf = (id: string | undefined) => (id ? allTrupps.find((t) => t.id === id)?.no : undefined)
  const planIsStack = (id: string) => !!planDocs.find((p) => p.id === id)?.floorStack
  const trailSourcesNow = useMemo(
    () => trailSources(objects, planIsStack, truppNoOf),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [objects, planDocs, allTrupps],
  )
  /* The pass itself, plus «Marker und Spur löschen»'s arming, are ONE mechanism and live in one
   * hook (lib/useGhostTrails): the surface arms `armTrailDrop(id, true)` in the same breath as
   * the removal, and the very next pass writes that marker's ghost already `removedAt`-stamped
   * instead of standing the searched area back up. `reseedGhostTrails` is the hydrate's door. */
  const { armTrailDrop, reseed: reseedGhostTrails } = useGhostTrails({ sources: trailSourcesNow, setTrails })
  ghostReseedRef.current = reseedGhostTrails
  /**
   * «Marker und Spur löschen» on the Karte's Trupp marker — the third row of its trash menu
   * (components/TwinTeamPill), the twin of the plan chip's (usePlanRemoval · removeWithTrail).
   * The reconciliation is armed FIRST, so the ghost this removal would otherwise stand up is
   * written already `removedAt`-stamped (lib/truppTrails) and the searched area goes with the
   * marker. One undo step: only the marker's own removal was ever committed, and taking it back
   * brings the marker home with its trail — the stamped row is dropped by the next pass, because
   * its marker is live again.
   */
  const removeTeamWithTrail = async (id: string) => {
    if (tacticalLocked) return
    const e = entities.find((x) => x.id === id)
    if (!e || e.kind !== 'team' || !e.trail?.length) return
    // a trail is never destroyed without the ask, wherever the door is (Plan parity)
    const ok = await confirmDialog({
      title: appConfig.copy.whiteboard.removeMarkerTrail,
      message: fillTemplate(appConfig.copy.whiteboard.clearTrailConfirm, { name: e.label ?? '', n: e.trail.length }),
      confirmLabel: appConfig.copy.remove, cancelLabel: appConfig.copy.cancel, danger: true,
    })
    if (!ok) return
    armTrailDrop(id, true)
    // the connection question inside deleteEntity may still be answered with «Abbrechen» — then
    // the marker stays and the arming has to go, or its next removal would eat the trail
    if (!await deleteEntity(id)) { armTrailDrop(id, false); return }
    // the Verlauf says BOTH things happened; no `entity.edit` beside it, because the entity the
    // edit would describe is the one just deleted (the `entity.delete` row carries the act)
    log('cross', fillTemplate(appConfig.copy.whiteboard.trailCleared, { name: e.label ?? '' }))
  }
  /**
   * A tap on a ghost trail. «Spur löschen» with the same confirm the live trail has, undoable as
   * one step – and, where the Trupp behind it still exists, the way BACK first (20.09.2026): the
   * marker returns where the trail ends, under the id it was recorded on, and the reconciliation
   * takes the ghost home with it (lib/truppTrails · ghostRevival). One ask, three answers; the
   * delete stays the red one and keeps its own wording.
   */
  const deleteGhostTrail = async (id: string) => {
    if (tacticalLocked) return
    const g = trails.find((t) => t.id === id)
    if (!g || g.removedAt) return
    const name = ghostTrailLabel(g, appConfig.copy.whiteboard.team, allTrupps)
    const message = fillTemplate(appConfig.copy.whiteboard.clearTrailConfirm, { name, n: trailPointCount(g) })
    // ⚠️ offered for EVERY ghost that has somewhere to return to, not only one with a live Trupp
    // behind it (first cut, 20.09.2026 – and the field's first try was a loose «Trupp 1» chip,
    // which got the delete-only ask again). A marker joined to a Trupp that still exists goes
    // back through the Trupp's own placement; anything else – a loose chip, or one whose Trupp
    // has since been removed – returns as the loose marker it then is, under the same id.
    const back = ghostRevival(g)
    const liveTruppId = g.truppId && trupps.some((t) => t.id === g.truppId && !t.removedAt) ? g.truppId : undefined
    if (back) {
      const answer = await confirmDialog({
        title: fillTemplate(appConfig.copy.whiteboard.ghostTrailTitle, { name }),
        message: appConfig.copy.whiteboard.ghostTrailAsk,
        confirmLabel: appConfig.copy.whiteboard.ghostTrailRestore, cancelLabel: appConfig.copy.cancel,
        altLabel: appConfig.copy.whiteboard.clearTrail, altDanger: true,
      })
      if (answer === true) {
        const revive = { id: back.markerId, trail: back.trail }
        // ⚠️ A loose chip comes back under its own label only while nobody else holds that number:
        // «Trupp 2» went, and a new chip may have been handed 2 since (docs/trupp-naming.md §7).
        // Then it comes back as the next number, and its row says which.
        const looseName = liveTruppId ? name : (freshTeamLabel(g.name || name, truppCounterNames(back.markerId)) ?? name)
        // (the Trupp's own placement writes its «platziert» row; the loose marker gets this one)
        if (!liveTruppId) log('flag', fillTemplate(appConfig.copy.whiteboard.ghostTrailRestored, { name: looseName }))
        if (liveTruppId) {
          if (back.surface === 'plan') placeTruppOnPlan(liveTruppId, back.planId, back.at, { id: back.markerId, trail: back.trail })
          else placeTruppOnMap(liveTruppId, back.coord, { id: back.markerId, trail: back.trail })
        } else if (back.surface === 'plan') {
          const chip: BoardAnno = { id: revive.id, kind: 'resource', ...back.at, text: looseName, t: formatTime(new Date(serverNow())), color: g.color, trail: back.trail }
          setBoard((b) => ({ ...b, [back.planId]: [...(b[back.planId] ?? []).filter((a) => a.id !== chip.id), chip] }))
        } else {
          const marker: Entity = { id: revive.id, kind: 'team', layer: appConfig.defaults.operationalLayerId, coord: back.coord, label: looseName, t: formatTime(new Date(serverNow())), color: g.color, trail: back.trail }
          setDocRaw((d) => ({ ...d, entities: [...d.entities.filter((e) => e.id !== marker.id), marker] }))
        }
        return
      }
      if (answer !== 'alt') return
    } else {
      const ok = await confirmDialog({
        title: appConfig.copy.whiteboard.clearTrail, message,
        confirmLabel: appConfig.copy.remove, cancelLabel: appConfig.copy.cancel, danger: true,
      })
      if (!ok) return
    }
    const at = serverNowIso()
    setTrails((ts) => removeGhostTrail(ts, id, at))
    log('cross', fillTemplate(appConfig.copy.whiteboard.trailCleared, { name }))
    // the domain is where the trail was WALKED — a ghost on a sheet is the Plan's act, so the
    // header's «Rückgängig: …» names the surface the operator is standing on
    rememberOneShot(g.planId ? 'plan' : 'karte', appConfig.copy.whiteboard.clearTrail,
      () => setTrails((ts) => restoreGhostTrail(ts, id)),
      () => setTrails((ts) => removeGhostTrail(ts, id, at)),
      () => [recordKey('trails', id)])
  }
  // …and what each person's Bemerkung said, for as long as this incident is open here. The record
  // loses it when a row is cycled to «frei» (the entry goes, as it must); this is what puts it back
  // when the same person is ticked present again — see useAttendanceActions · noteMemory. Per
  // incident by construction: this component remounts with the incident.
  const attNotes = useRef<Record<string, string>>({})
  const { markPresent, markLeft, clearAttendance, setAttendanceTimes, removeAttendanceBlock, setAttendanceNote, setAttendanceOrt, addGuest } = useAttendanceActions({
    attendance, setAttendance: attSet, blockedAttendanceIds, noteMemory: attNotes,
    startedAt: incidentMeta.started_at, reportDoneAt: incidentMeta.report_done_at, log,
  })
  /** Step the Anwesenheit back or forward and SAY SO in the Verlauf. The record is append-only, so
   *  the tap's own row stands; this adds the correction beside it, naming whoever moved — which is
   *  the only thing a reader six months later needs from it. */
  /**
   * Settle one Anwesenheits-Abweichung from the Rapport: put the chosen value into the record
   * and append the row that says so. ONE action, because the halves must not drift apart — a
   * record change with no line, or a line about a change that never landed, are both a worse
   * record than the «bitte prüfen» warning they replace.
   *
   * ⚠️ The warning row STAYS. The Verlauf is append-only: this adds the answer beside the
   * question, it does not go back and tidy the question away. A record that could be edited to
   * say a check happened would be no proof that one did, which is the whole 1.6 finding.
   * ⚠️ «Beide stimmen so» writes NOTHING to the record — the merge already stands, and the point
   * of that answer is that it was correct. Only the row is appended.
   */
  const resolveAttendanceConflict = (open: OpenConflict, choice: 0 | 1 | 'both') => {
    if (choice !== 'both') {
      const picked = open.sides[choice]?.entry
      // …through the history-aware setter, so ↶ takes it back like every other Anwesenheit tap
      if (picked && open.key) attSet((cur) => ({ ...cur, [open.key]: picked }))
    }
    journal.append(conflictResolvedRow(open, choice, user?.display_name))
    emit('attendance.conflict.resolved', { key: open.key, sig: open.sig })
  }
  const stepAttendance = (dir: 'undo' | 'redo', step?: string): boolean => {
    const moved = dir === 'undo' ? attHist.undo(step) : attHist.redo(step)
    if (!moved) return false
    const names = changedAttendanceNames(moved.from, moved.to, rosterById)
    const A = appConfig.copy.anwesenheit
    // ⚠️ icon 'people', not 'undo'. The Bereich column and the Verlauf chip are derived from the
    // icon (lib/report · journalArea) and 'undo' is the Atemschutz-Rückzug's icon — so every
    // «Anwesenheit zurückgenommen» printed under «Atemschutz», on a sheet whose whole job is
    // saying where a row came from. The undo-ness is in the sentence; the icon says the surface.
    log('people', fillTemplate(dir === 'undo' ? A.undone : A.redone, { names: names.join(', ') || '–' }), 'team')
    // ⚠️ `attendance.undo`, NOT a bare `undo` (fixed 08.09.2026). An `el` session may write the
    // Anwesenheit but may append only the RECORD event vocabulary (backend · EL_EVENT_PREFIXES),
    // and ONE refused op_type 403s the whole batch — so the first ↶ an Einsatzleiter pressed
    // wedged their entire audit outbox. `attendance.` is already on that allowlist.
    emit(`attendance.${dir}`)
    return true
  }
  stepAttendanceRef.current = stepAttendance

  // the record surfaces' undo stacks and writers — Mittel, Checklisten, Rapport, Zeitplan — and their
  // re-lay after a merge (workspace/useRecordSlices)
  const {
    checklistSet, checklistDescribeRef, bandActions, addShift, addShiftSpan, replaceShift, setShiftTime,
    removeShift, onDownloadZeitplan, onPrintZeitplan, saveMittel, placedSymbols,
  } = useRecordSlices({
    mittel, setMittel, canWriteRecord, checklists, setChecklists, undoHist, histSide, histStep, C_HIST,
    reportMeta, setReportMeta, lastReportStep, reportSetRef, user, log, doc, board, shifts, bands,
    setShifts, setBands, sliceRebase, attHist, incidentMeta, attendance,
  })
  // The station printer's status for the Zeitplan sheets, fail-closed (null → no printer button at
  // all); the PDF download needs no relay. Asked when the Anwesenheit opens – the one surface that
  // offers the sheets – not at boot, where it was one more request on every cold start.
  const [zeitplanRelay, setZeitplanRelay] = useState<PrintRelayStatus | null>(null)
  const onAnwesenheit = mode === 'anwesenheit'
  useEffect(() => {
    if (linkScoped || !onAnwesenheit) return // the relay is refused for a link session — don't even ask
    let alive = true
    void fetchPrintStatus(editorPrintTransport()).then((st) => { if (alive) setZeitplanRelay(st) })
    return () => { alive = false }
  }, [linkScoped, onAnwesenheit])

  // the roster's side of the record — vocabulary, pickers' names and hints, and every door that puts
  // somebody on the Anwesenheit because they were given a job (workspace/useRosterRoles)
  const roster = useRosterRoles({
    linkedTrupps, truppOfPerson, pickablePersonnel, attendance, allTrupps, phoneFold, mode, incidentMeta,
    rosterIdByName, rosterById, trupps, setSelectedId, log, canWriteRecord, attSet, openTruppSave,
    addGuest, replayActive, setAttendance, setTrupps, createTrupp, editTrupp, reactivateTrupp,
  })
  const {
    fileTruppGuest, createTruppA, editTruppA, reactivateTruppA, presentIds, rapportTarget,
    linkRosterFields, rosterNames, rosterRank, personStatus, rosterFieldHints, stopPersonSharing,
    assignTypedName, assignRole, journalVocab,
  } = roster

  // --- checklists ---
  // Ticking is field documentation, not tactical editing, so it's gated by ROLE
  // (editor, incl. on a phone) rather than tacticalLocked — but still blocked for
  // true viewers and during replay. Presence in `ticks` = checked.
  // canEditRecord, not canEditIncident (07.09.): ticking is record-keeping — the el role
  // and an editor's Führungsansicht keep it; the backend enforces the same boundary.
  const canTick = canEditRecord
  const { toggleTick, setBranch, describeStep: describeChecklistStep } = useChecklistActions({ canTick, checklists, setChecklists: checklistSet, authorName: user?.display_name, log, emit })
  // in an effect, not during render: it is read only when a step is TAKEN, long after this commit
  useEffect(() => { checklistDescribeRef.current = describeChecklistStep })
  // Deep links: an item's `action` jumps to the matching surface (best-effort, reusing
  // existing setters). journal → open the composer (a read-only session: the Verlauf, the same
  // gate as the TopBar's «Eintrag» – RBAC audit V4); plan → Plan tab; draw → Lage + pen.
  const checklistAction = (_item: Item, a: NonNullable<Item['action']>) => {
    if (a === 'journal') { if (readOnly) setJournalOpen(true); else setComposerOpen(true) }
    else if (a === 'plan') {
      // «Objektplan bereitlegen» must land ON the Übersicht, not merely on the Pläne tab:
      // activePlanId is remembered per device, so a bare setMode dropped a first-time user
      // on whatever was open last (the OSM whiteboard on a fresh device) and left them to
      // find the module themselves. Modul 1 is the FKS Übersicht — the sheet the item means.
      // No Modul 1 on this object (or no object at all) → the tab, as before.
      setPanel(null)
      if (!goToModule(1)) setMode('plans')
    }
    // arming the pen ends Koordinaten, as every tool does (see `coord`)
    else if (a === 'draw') { setMode('map'); coordPicker.setMode('off'); setTool('line') }
  }

  const mapUI = mode === 'map'
  // an armed map tool, the aiming crosshair or the Passung takes the taps: the toasts give way to
  // the top lane (lib/toastLane)
  usePlacementLane((mapUI && (tool !== 'select' || coord.mode === 'aim')) || georefActive)

  /* ── one fault line per view (SurfaceBoundary, 02.09.) ─────────────────────────────────────
   * A throw in ANY panel — a Mittel row without a label, a Verlauf text, a building without
   * floors when the Kroki opened — used to unmount the whole workspace, the Atemschutz alarm host
   * with it. Every surface below renders inside its own boundary: the card sits in the view, the
   * rail, top bar and Meldeleiste keep working, and «Zur Karte» is the way out. The alarm host
   * stays OUTSIDE every one of them (both layouts), and the per-incident ErrorBoundary in App
   * remains the last line. `toMap` false = no such button (the map itself, the handed-over board). */
  const crashToMap = () => { if (mode !== 'map') clearMapUi(); setJournalOpen(false); setPanel(null); setMode('map') }
  const guarded = (surface: string, node: ReactNode, toMap = true) => (
    <SurfaceBoundary surface={surface} onToMap={toMap ? crashToMap : undefined}>{node}</SurfaceBoundary>
  )
  /**
   * Is the right-hand dock slot free for a detail panel (.ctx — ContextPanel / DrawEditor /
   * ShapeEditor)?
   *
   * The Lage's twin of Whiteboard · `editorSlotFree`, and the same rule: that slot holds exactly
   * ONE thing. `05-navrail.css` already writes it down for the chrome toggles — «Only one of
   * {Ebenen, views popover, tool dock} is ever open» — but the detail panel was never counted
   * into that set even though `.ctx` sits in the same band (z35, right of the tool rail) that
   * `.layers-card` opens over (z201), and on a phone on the very same bottom edge. Opening
   * Ebenen therefore buried an open panel that stayed tappable through the z28 backdrop.
   *
   * ⚠️ Hides the panel, never the SELECTION. `clearMapUi('selection')` deliberately keeps
   * `selectedId` for exactly these two toggles, so the halo stays put and the panel comes back
   * the moment Ebenen closes. That is the half of its reasoning which was always right; the half
   * that claimed «nothing becomes unreachable» was not, and this is what makes it true.
   */
  const detailSlotFree = mapUI && !journalOpen && panel === null && !viewsOpen

  const annotatedPlanCount = useMemo(() => annotatedPlans(planDocs, board, false).length, [planDocs, board])

  // `maptool-<tool>` on the root drives the map cursor (see .maptool-* in app.css) the way the
  // plan canvas's own `tool-<tool>` does. Gated on mapUI so an armed tool can never leak a
  // crosshair onto Checkliste, Atemschutz or the plan.
  /* The Atemschutzüberwachung, as ONE element used by both branches below — the full workspace
   * and the handed-over «Tafel pur» (asLink). Extracted so the prop list exists once: a board
   * that drifts between the two would be the same failure the twin doctrine names, on a surface
   * where a missing control is a Trupp nobody clocked. */
  const atemschutzBoard = (
    <AtemschutzView
      trupps={effTrupps}
      // ⚠️ A link holder has no picture to read a hose number off and no surface to draw one on,
      // so the quick-picks are empty there and the Ltg-Nr row goes with them (`lite`).
      leitungOptions={asLink ? () => [] : truppLeitungOptions}
      truppColors={truppColors()}
      showTruppLine={showTruppLine} truppsWithLine={truppsWithLine()} lineNoOf={truppLineNos()}
      unlinkTruppLine={unlinkTruppLine}
      // where each placed Trupp's marker stands, if it is docked to a symbol (lib/docking)
      dockedAt={new Map(doc.entities.flatMap((e) => {
        if (e.kind !== 'team' || !e.truppId || !e.dockedTo) return []
        const host = doc.entities.find((h) => h.id === e.dockedTo)
        return host ? [[e.truppId, host.label || appConfig.copy.entities.fallbackObjectName] as const] : []
      }))}
      // the ONE slice an Atemschutz-Link may write — see canEditTrupps
      canEdit={canEditTrupps}
      personnel={pickablePersonnel}
      attendance={effAttendance}
      // a Gast under PA was at the Einsatz — record them on the Anwesenheit too. Through
      // assignTypedName, so typing the name of somebody who IS on the list (or already on
      // this Einsatz) links that row instead of opening a second one beside it. No job
      // written here: the Trupp is not formed yet, and submitting it writes «AS» itself.
      // ⚠️ NOT for a link session: the Anwesenheit is not its slice, and the write would 403.
      onAddGuest={canEditIncident ? fileTruppGuest : undefined}
      createTrupp={createTruppA}
      placeTrupp={placeTrupp}
      placeTargets={placeTargets}
      // the Trupp symbols already standing on Lage/plan, offered under the placement targets
      markerOptions={truppMarkerOptions}
      adoptMarker={adoptMarkerA}
      focusTruppOnPlan={focusTruppOnPlan}
      recordContact={recordContact}
      recordPressure={recordPressure}
      setTruppStatus={setTruppStatus}
      // the Atemschutznotfall (F1, 08.10.2026) — the same slice an Atemschutz-Link writes
      triggerNotfall={triggerNotfall}
      endNotfall={endNotfall}
      placeOf={truppPlace}
      editTrupp={editTruppA}
      // «In diesen Trupp verschieben» — the one tap behind the form's double-assignment warning.
      // It only ever touches the crew fields of the OTHER Trupp, so it is the same slice an
      // Atemschutz-Link session already writes (useTruppActions · transferOutOfTrupp).
      transferOutOfTrupp={transferOutOfTrupp}
      // «Bleibt in Trupp …» on the double-assignment band — the same crew-fields-only slice (audit F05)
      keepInOneTrupp={keepInOneTrupp}
      designateSafety={designateSafety}
      reactivateTrupp={reactivateTruppA}
      deleteTrupp={deleteTrupp}
      restoreTrupp={restoreTrupp}
      removedTrupps={removedTrupps}
      muted={atemschutzMuted}
      onToggleMuted={toggleAtemschutzMuted}
      audioBlocked={atemschutzAudioBlocked}
      onUnlockAudio={unlockAtemschutzAudio}
      order={atemschutzOrder}
      onOrder={setAtemschutzOrder}
      onMove={canEditIncident && !readOnly ? moveTrupp : undefined}
      intervalMin={azIntervalMin}
      graceSec={azGraceSec}
      defaultFunkkanal={azFunkkanal}
      focus={truppFocus}
      createRequest={truppCreate}
      // «Überwachung abgeben» — the QR beside the bell, on the page the FU is standing on when
      // they decide to hand the Tafel over. Same sheet as the Einsatz-Karte's «Teilen», opened
      // on its «Nur Atemschutz» half.
      onShareLink={canShareLive ? () => setShareLink('atemschutz') : undefined}
      shareLinkActive={atemschutzLinkOn}
      // the board's own sync/clock line (safety review 01.09.): the Tafel says itself whether
      // its Stand is saved and its clock is right — on the handed-over board there is no
      // top-bar pill to say it, and on the tablet nobody watching Trupps watches the top bar
      syncStatus={syncStatus} lastSyncedAt={lastSyncedAt} clockSkewMs={clockSkewMs}
      // «Tafel pur»: the whole app for this session, so the subtitle has to name the Einsatz —
      // nothing else on that screen does.
      // …and the two halves apart as well: the phone's one-row head cuts the joined line and
      // prints these two whole in the popover behind the title (AtemschutzView · headDetail).
      lite={asLink ? {
        subtitle: [incidentMeta.title, incidentMeta.address].filter(Boolean).join(' · '),
        title: incidentMeta.title || undefined,
        address: incidentMeta.address || undefined,
      } : undefined}
      // …and with no TopBar on that screen, the app's ONE ↶ ↷ pair rides in the board's own
      // header. Same timeline as everywhere else — only trupp actions can reach this session's
      // stack, and its writes go down the trupps slice, which a link session already syncs.
      onUndo={onHistoryPress('undo')}
      onRedo={onHistoryPress('redo')}
      canUndo={histCanUndo}
      canRedo={histCanRedo}
      undoLabel={undoLabel}
      redoLabel={redoLabel}
      // a closed Einsatz is a record, not a situation: every clock stands at the Einsatzende
      frozenAt={azFrozenAt}
    />
  )

  /* ── Covered: another surface is in front of this Einsatz ───────────────────────────────
   *
   * «Karte & Objekte» or the Objektbesuche opened over an open Einsatz (App · screen). The
   * component stays MOUNTED, so every hook above keeps running — the sync and its live poll (a
   * Funkkontakt entered on another device still ends an alarm here), the Verlauf, the Trupp
   * actions, the mute — and only the screen goes: no map, no plan, no bars, no key handlers.
   *
   * ⚠️ What must NOT go is the Atemschutz alarm (lead decision, 16.10.2026: silence on a
   * breathing-apparatus timer is the one failure we can't have at 3am). So the SAME alarm host
   * runs (tone, vibration via the OS notification, the Verlauf rows), and the SAME rows stand in
   * the Meldeleiste over the surface in front: overdue / Alarmdruck / Rückzug per Trupp, and the
   * Notfall. Their «Zum Trupp» brings this Einsatz back, on the Atemschutz board at that card.
   * The reminder clock keeps running too. AFTER every hook, like the link shell below. */
  if (covered) {
    const goToTrupp = (id: string) => {
      onUncover?.()
      setMode('atemschutz'); setPanel(null)
      setTruppFocus({ id, nonce: Date.now() })
    }
    return (
      <>
        <AtemschutzAlarmHost trupps={alarmTrupps} muted={atemschutzMuted} active={azAlarmActive}
          {...alarmLog} intervalMin={azIntervalMin} graceSec={azGraceSec} onState={setAzAlarm} />
        <RemindersHost {...reminders.host} alert={remindersAlert} />
        <AtemschutzAlarmMeldungen
          trupps={trupps}
          severities={azAlarm.severities}
          canEdit={canEditTrupps}
          intervalMin={azIntervalMin}
          graceSec={azGraceSec}
          onAcknowledge={muteAtemschutz}
          onGoToTrupp={goToTrupp}
        />
        {azAlarmActive && (
          <AtemschutzNotfallMeldungen
            trupps={trupps}
            placeOf={truppPlace}
            canEdit={canEditTrupps}
            onAcknowledge={muteAtemschutz}
            onGoToTrupp={goToTrupp}
            onDeploySafety={(id) => setTruppStatus(id, 'aktiv')}
          />
        )}
      </>
    )
  }

  /* ── «Tafel pur»: the Atemschutz-Link session's WHOLE app ────────────────────────────────
   *
   * Somebody scanned the QR the FU held out and is now watching this Einsatz's Atemschutz on
   * their own phone. What they get is the board and the two things that make it safe — the
   * alarm host (tone + OS notification, which is the half that works while the screen is off)
   * and the alarm strip, on the same terms as everywhere else. Nothing else: no TopBar, no
   * NavRail, no context panel, no Meldeleiste, no sheets but the Trupp-Formular the board opens
   * itself. Every control that is not here is one this session's backend would refuse.
   *
   * ⚠️ AFTER every hook, and it uses the SAME `atemschutzBoard` element as the full layout —
   * one prop list, so the handed-over board cannot quietly drift from the one in the app.
   * Toasts + confirms are already mounted app-wide (App · Overlays), the icon sprite is not. */
  if (asLink) {
    return (
      <div className="app as-link-shell" ref={registerMeldeleisteHost}>
        <IconSprite />
        {/* ⚠️ Same tab-lock message as the full layout, WITHOUT its editor gate: an Atemschutz-
            Link session is role 'viewer' but genuinely writes, so losing the lock to another tab
            of this browser must say so — silently hiding every button left a handed-over Tafel
            that looked read-only for no reason. The Meldeleiste is mounted at App root, so the
            row paints here too. */}
        {tabLockLost && <TabLockBanner onTakeOver={onTakeOverTab} />}
        <AtemschutzAlarmHost trupps={alarmTrupps} muted={atemschutzMuted} active={azAlarmActive}
          {...alarmLog} intervalMin={azIntervalMin} graceSec={azGraceSec} onState={setAzAlarm} />
        {/* the due row only – a link's phone never rings for a Wiedervorlage (RemindersHost) */}
        <RemindersHost {...reminders.host} alert={false} />
        {closedMeldung}
        {linkRefused && running && <LinkRefusedMeldung />}
        {guarded('atemschutz', atemschutzBoard, false)}
        {/* `onBoard` is unconditionally true here — the board IS the screen, and the strip's own
            rule (see AtemschutzAlarmMeldung's header) is that it steps aside for it. Mounted
            regardless so the two layouts obey ONE contract rather than two. */}
        <AtemschutzAlarmMeldungen
          trupps={trupps}
          severities={azAlarm.severities}
          intervalMin={azIntervalMin}
          graceSec={azGraceSec}
          onBoard
          onAcknowledge={muteAtemschutz}
          onGoToTrupp={(id) => setTruppFocus({ id, nonce: Date.now() })}
        />
        {/* …and the Notfall's row obeys the same contract: withheld on the board, whose banner
            stands in its place (AtemschutzNotfall) */}
        <AtemschutzNotfallMeldungen trupps={trupps} onBoard onGoToTrupp={(id) => setTruppFocus({ id, nonce: Date.now() })} />
      </div>
    )
  }

  /* ── Anwesenheit and Material: full surfaces here, TABS of the Rapport on a phone ──
     ONE instance of each, built once and handed to whichever mounts it (18.09.2026). The phone
     bar holds five tiles, so those two gave up theirs; they are the same components with the
     same props either way — a fork would have been two rosters to keep in step, and the one on
     the phone is the one that gets corrected during the Appell. */
  const anwesenheitSurface = (
      <AnwesenheitView
        people={personnel}
        attendance={effAttendance}
        canEdit={canEditRecord}
        loading={personnelLoading}
        error={personnelError}
        blockedIds={blockedAttendanceIds}
        onAddGuest={canEditRecord ? addGuest : undefined}
        onMarkPresent={markPresent}
        onMarkLeft={markLeft}
        onClear={clearAttendance}
        truppOfPerson={truppOfPerson}
        onJumpToTrupp={(truppId) => {
          setMode('atemschutz'); setPanel(null)
          if (truppId) setTruppFocus({ id: truppId, nonce: Date.now() })
        }}
        onReload={() => { void reloadPersonnel() }}
        // the phone's way back — but ONLY while the top bar's own ↶ ↷ are off the bar, which
        // since 15.09.2026 is one width and nothing else: below 360px (see topBarUndoHidden).
        // Any other time the bar pair is the one door, so nothing is duplicated (06.09.).
        onUndo={canEditRecord ? onHistoryPress('undo') : undefined}
        onRedo={canEditRecord ? onHistoryPress('redo') : undefined}
        canUndo={histCanUndo}
        canRedo={histCanRedo}
        topBarUndoHidden={topBarUndoHidden}
        onSetTimes={canEditRecord ? setAttendanceTimes : undefined}
        onRemoveBlock={canEditRecord ? removeAttendanceBlock : undefined}
        onSetNote={canEditRecord ? setAttendanceNote : undefined}
        onSetOrt={canEditRecord ? setAttendanceOrt : undefined}
        captureUsage={captureUsage}
        shifts={effShifts}
        bands={effBands}
        onCreateBand={canEditRecord ? (label, from, to) => { bandActions.addBand(label, from, to) } : undefined}
        onSaveBand={canEditRecord ? (id, label, from, to) => {
          bandActions.renameBand(id, label)
          void bandActions.askAndSetBandTimes(id, from, to)
        } : undefined}
        onRemoveBand={canEditRecord ? bandActions.removeBand : undefined}
        onCycleCell={canEditRecord ? bandActions.cycleCell : undefined}
        onSetCellState={canEditRecord ? bandActions.setCellState : undefined}
        onPutCellState={canEditRecord ? bandActions.putCellState : undefined}
        startedAt={incidentMeta.started_at}
        onAddShift={canEditRecord ? addShift : undefined}
        onAddShiftSpan={canEditRecord ? addShiftSpan : undefined}
        onReplaceShift={canEditRecord ? replaceShift : undefined}
        onSetShiftTime={canEditRecord ? setShiftTime : undefined}
        onRemoveShift={canEditRecord ? removeShift : undefined}
        // Zeitplan-PDF and Zeitplan-Druck are both refused for a link session (the sheet
        // carries the crew's names) — without either prop the block hides itself
        onPrintZeitplan={!linkScoped && zeitplanRelay?.available ? onPrintZeitplan : undefined}
        onDownloadZeitplan={linkScoped ? undefined : onDownloadZeitplan}
        zeitplanPrintOnline={!!zeitplanRelay?.online}
        // Live crew positions, read next to the name — this is where somebody looks when
        // they want to know where a person is, and where they would pick up the phone.
        incidentId={incidentMeta.id}
        // «Anrückend»: who answered the Divera alarm. On a station with Divera, while the Einsatz
        // runs, for the EL and the editors (the read is editor-only), never for a link session or
        // a replay. NOT gated on `divera_id`: an alarm ATTACHED to a manual Einsatz (api/divera ·
        // attach) has answers too, and the server's `available: false` renders nothing. Nor on
        // being online: offline the block keeps the last answers it had.
        diveraResponsesFor={getDeploymentConfig().integrations?.diveraConfigured && (isEditor || isEl)
          && running && !replayActive && !linkScoped ? incidentMeta.id : undefined}
        livePositions={livePeople.byPerson}
        incidentCenter={incidentView.center}
        onShowOnMap={(personId) => { setMode('map'); setPanel(null); focusEntity(`pos-${personId}`) }}
      />
  )
  const mittelSurface = (
      <MittelView
        entries={effMittel}
        canEdit={canEditRecord}
        onSave={saveMittel}
        captureUsage={captureUsage}
        placedSymbols={placedSymbols}
        trupps={effTrupps}
      />
  )

  /** «Namen ändern» from the TopBar's sharing pill: the picker opens over the status, which
   *  `restore` brings back if it is cancelled (see the SharePositionSheet's onClose). */
  const onShareChangeName = (restore: () => void) => {
    shareStatusRestore.current = restore
    setShareParent('status')
    setSharePick('pick')
  }

  return (
    // the Meldeleiste paints INSIDE this stacking context (lib/meldeleisteHost), under the top bar
    <div ref={registerMeldeleisteHost} className={`app mode-${mode}${phoneTools ? ' phone-tools' : ''}${georefActive ? ' georef-mode' : ''}${phoneGeoref ? ' phone-georef' : ''}${mapUtility ? ' map-util' : ''}${mapUI ? ` maptool-${tool}` : ''} ${(tool === 'symbol' && pending) || (tool === 'shape' && pendingShape) ? 'placing' : ''}`}>
      <IconSprite />
      {coverPhase !== 'off' && createPortal(
        <Splash sub={appConfig.copy.incidentLink.opening} leaving={coverPhase === 'leaving'} />,
        document.body,
      )}
      <AtemschutzAlarmHost trupps={alarmTrupps} muted={atemschutzMuted} active={azAlarmActive}
        {...alarmLog} intervalMin={azIntervalMin} graceSec={azGraceSec} onState={setAzAlarm} />
      {/* the reminder clock, hosted for the same reason as the alarm above (10 s ≠ 1 Hz, same shape);
          it rings only for the Verlauf's writers, editor and el (RemindersHost · alert) */}
      <RemindersHost {...reminders.host} alert={remindersAlert} />
      {closedMeldung}

      <MapStage {...{
        sym, guarded, mapRef, mapEntities, drawings, tacticalLocked, mapLayers, isVisible, mapOverlays,
        georefPlanRasters, weatherRadar: mapUI && !replayActive ? weather.mapRadar : null, symbolScale,
        symbolCaptions, setMapSuppressedCaptions, incidentView, initialFitPoints, locateReq, setView,
        onBasemapUnavailable, onMapSettled, selection, store, mapDrawing, mapActions, truppActions,
        teamMarkers, patchEntity, editNoteId, setEditNoteId, noteTextLive, noteTextCommit,
        setNotePanelId, effTrupps, azAlarm, showTrupp, newTruppFromMarker, removeTeamWithTrail, trails,
        deleteGhostTrail, measure, coord, rotStart, flashDrawingId, setDrawTap, setVehicleOverrides,
      }} />

      <WorkspaceTopBar {...{
        incidentView, incidentMeta, reportMeta, running, voice, journalOpen, setJournalOpen, reminders,
        linkScoped, readOnly, setComposerOpen, tabLockLost, isEditor, onTakeOverTab, startVoiceMemo,
        startQuickPhoto, onHistoryPress, histCanUndo, histCanRedo, undoLabel, redoLabel, canEditIncident,
        canEditRecord, displayWeather, openWeatherDetails, view, azAlarm, mode, azRowsShown, setMode,
        setPanel, setTruppFocus, mapUI, replayActive, gpsStale, gpsAgeMs, share, onShareChangeName,
        onBackFromArchive, onReactivateActive, isPhone, phoneTools, planFit, incidents, syncStatus, journal,
        auditDelivery, closedRefusedUnexported, baseSyncStatus, lastSyncedAt, user, setSettingsOpen,
        onSwitchIncident, onOpenHistory, onOpenObjectVisits, onOpenKarte, activeObjectId, canEditMeta, onEditMeta,
        onOpenDivera, onOpenDatenquellen, confirmAndComplete, abschlussMissing, canShareLink, setShareLink,
        setHelpOpen, setInstallGuideOpen, setOfflineReadyOpen, syncNow, media, logout, settingsOpen,
        helpOpen, installGuideOpen, offlineReadyOpen, shareLink,
        canEditRapport,
      }} />

      <WorkspaceMeldungen {...{
        reminders, setJournalOpen, setJournalLandOn, sym, symbolsRowHidden, setSymbolsRowHidden, noBasemap,
        setNoBasemap, setOfflineReadyOpen, trupps, azAlarm, canEditTrupps, azIntervalMin, azGraceSec, mode,
        setAzRowsShown, muteAtemschutz, setMode, setPanel, setTruppFocus, mapUI, tacticalLocked, gpsMeld,
        releaseOnSite, revertAll, followAll, replayActive, incidentMeta, journal, rapportReturn,
        setRapportReturn, openRapport, setInstallGuideOpen, tabLockLost, user, onTakeOverTab, needsReview,
        readOnly, intakeReviewedAt, onEditMeta, onReviewDone, azAlarmActive, truppPlace, setTruppStatus,
        syncStatus, exportEntries, syncNow,
      }} />

      {/* single left navigation rail — all surfaces; switches Karte / object Pläne / Checkliste */}
      <NavRail
        // device pref: the surface's word under its glyph (Einstellungen · Leisten)
        labels={railLabels}
        mode={mode}
        // leaving the map ends whatever was in progress on it. Without this the whole tactical
        // state was merely hidden and restored verbatim — you came back to an armed tool, a
        // half-drawn line and a re-opening symbol palette from minutes ago.
        onMode={(m) => { if (m !== mode) clearMapUi(); setMode(m) }}
        // the RAIL list: «Umrisse» + «Gebäude» are one morphing tile here, two documents everywhere
        // else (see railPlanDocs)
        planDocs={railPlanDocs}
        // PHONE only: the bar folds (18.09.2026) — every plan document into ONE «Pläne» tile,
        // and Anwesenheit + Material out of the bar entirely and into the Rapport as tabs. Five
        // tiles is what a 360px bar holds without a sideways scroll. The vertical rail keeps one
        // tile per document and both surfaces.
        fold={phoneFold}
        // …and the first tap on «Pläne» in an Einsatz opens «Plan wählen» by itself, once
        incidentId={incidentMeta.id}
        // …and with the Anwesenheit tile gone, its one number rides on the Rapport tile instead
        presentCount={presentIds.size}
        // the tile is the door to the GROUP: it opens the page this device was last on, and a
        // second tap / a hold opens the list of three — which carries each page's live count
        rapportTarget={rapportTarget}
        // the editor's to-do, so only where the Rapport can be edited (RBAC audit 22.10.2026)
        openCount={canEditRapport ? abschlussMissing.length : 0}
        mittelCount={mittelLineCount(mittel)}
        activePlanId={activePlanId}
        onSelectPlan={(id) => { if (mode !== 'plans') clearMapUi(); setMode('plans'); setActivePlanId(id) }}
        azSeverity={azAlarm.peak}
      />

      {findTruppOpen && (
        <TruppFinder trupps={placed} onPick={goToTrupp} onClose={() => setFindTruppOpen(false)} />
      )}

      <MapControls {...{
        mapUI, mapUtility, mapRef, view, viewsApi, readOnly, isEl, viewsOpen, toggleViews, coord, panel,
        layersPreset, togglePanel, isPhone, slimRail, displayWeather, openWeatherDetails, replayActive,
        georefMode, buildingInfo, buildingFirst, setPanel, composerOpen, journalOpen, offlineReadyOpen,
        // an incident link may not read the station: no «Unterirdische Bauten» row it could never fill
        layers: linkScoped ? layers.filter((l) => l.id !== UNDERGROUND_LAYER_ID) : layers,
        toggleLayer, setOpacity, linkedPlans, twinLayers, twinLayerOpacity, setAllLayers, resetLayers,
        weather,
        readings: replayActive ? null : { points: readingPoints, go: goToReading },
      }} />

      <MapDetailPanels {...{
        detailSlotFree, tacticalLocked, tool, selected, commit, setSelectedId, flyToMapVisible, deleteEntity,
        timeline, sym, entityTypedAt, titleLiveRef, beginDrag,
        setDocRaw, endDrag, emit, patchEntity, linkRosterFields, createCircle, doc, undockTeam, effTrupps,
        symbolCaptions, rosterNames, rosterRank, personStatus, rosterFieldHints, setEntityDone,
        vehicleOverrides, canEditIncident, readOnly, stopPersonSharing, setVehicleOverrides, log,
        assignTypedName, drawings, entities, focusDrawing, noteEntity, notePlacedId, setNotePanelId,
        noteTextLive, setNoteDefaults, selectedDrawing, patchDrawing,
        selectedDrawingId, patchDrawingLabelLive, commitDrawingLabel,
        changeMapEnding, reverseDrawing, setDrawingWallRole, objects, syncLineNoToTrupp, pickablePersonnel, linkTruppLine,
        unlinkLine, setSelectedDrawingId, setMode, setPanel, setGpsRouting, revertAll, gpsEndOf, releaseHere,
        releaseOnSite, setDrawingAttachment, focusEntity, isVisible, toggleLayer, deleteDrawing,
      }} />

      <MapToolDocks {...{
        mapUI, tool, pending, setPending, setTool, placeLock, setPlaceLock, lineMode, settleDraft,
        setLineMode, draftActive, draftOpen, commitDraft, areaMode, setAreaMode, setTeamPick, placed, setFindTruppOpen,
        measure, pendingShape, setPendingShape, setRotStart, rotStart, tacticalLocked, createLine,
        createArea, replayActive, railLabels, slimMapTools, pick, panel, layersPreset, togglePanel, viewsApi,
        view, readOnly, isEl, viewsOpen, sharePick, shareParent, toggleViews, coord, mapRef, paletteOpen,
        sym, setPaletteOpen, pickShape, teamPick, trupps, placeTruppOnMap, placeGenericTeam,
      }} />

      <PlansSurface {...{
        mode, sym, guarded, railLabels, planDocs, tacticalLocked, isPhone, journalOpen, replayActive,
        linkScoped, activePlanId, setActivePlanId, objectPlans, buildingInfo, incidentMeta,
        setPickerOpen, symbolScale, symbolCaptions, mapSuppressedCaptions, georefFits, mapActions,
        replayBoard, replayBuilding, store, trails, deleteGhostTrail, armTrailDrop, building, gebaeude, logPlan,
        roster, addRecent, user, emit, planStacks, planFocus, effTrupps, truppCounterNames, teamNameTaken,
        azAlarm, truppActions, newTruppFromMarker, showTrupp, planScale, setPlanScale, tafel,
        truppFinder: { open: () => setFindTruppOpen(true), disabled: placed.length === 0 },
        readingsChip: replayActive ? null : <ReadingsChip points={readingPoints} compact={isPhone} onGo={goToReading} />,
      }} />

      {pickerOpen && (
        <PlanPicker
          center={incidentView.center}
          activeObjectId={manualObject?.id ?? null}
          onSelect={pickObject}
          onReset={manualObject ? resetObject : undefined}
          onClose={() => setPickerOpen(false)}
        />
      )}

      {mode === 'checklists' && guarded('checklists', (
        <ChecklistsView
          checklists={checklists}
          canTick={canTick}
          incidentTitle={incidentMeta.title}
          onTick={toggleTick}
          onBranch={setBranch}
          onAction={checklistAction}
          // «Zeichnen» arms the Karte's line tool, which a locked device disarms on arrival
          offersAction={(a) => a !== 'draw' || !tacticalLocked}
          scrollKey={incidentMeta.id}
        />
      ))}

      {mode === 'atemschutz' && guarded('atemschutz', atemschutzBoard)}

      {mode === 'anwesenheit' && guarded('anwesenheit', anwesenheitSurface)}

      {mode === 'mittel' && guarded('mittel', mittelSurface)}

      {/* time-travel replay scrubber — read-only past view, owns the playhead + fold */}
      {replayActive && (
        <ReplayBar
          incidentId={incidentMeta.id}
          startedAt={incidentMeta.started_at}
          onState={onReplayState}
          onVehicles={onReplayVehicles}
          onExit={exitReplay}
          journal={timeline}
          onPlayhead={onReplayPlayhead}
          seekRef={replaySeek}
          // «im Verlauf» on the caption: open the drawer and land on that row.
          // ⚠️ Offered only while the Verlauf is CLOSED. The drawer is modal — a full-screen
          // scrim at z-index 60 over a bar at 50 — so with it open the button cannot be reached
          // at all: the click lands on the scrim (which closes the drawer) or, where the drawer
          // itself overlaps the bar, on one of its rows, which during a Wiedergabe seeks. Both
          // read as «the button does nothing». With the Verlauf open it is redundant anyway:
          // every row is right there, the one at the playhead is marked, and tapping any of them
          // moves the moment.
          onShowEntry={journalOpen ? undefined : (rowId) => { setJournalOpen(true); setJournalLandOn({ id: rowId, nonce: Date.now() }) }}
        />
      )}

      <RapportSurface {...{
        mode, guarded, incidentMeta, reportMeta, pickablePersonnel, presentIds, timeline, annotatedPlanCount,
        allTrupps, attendance, mittel, entities, drawings, media, azIntervalMin, azGraceSec, checklists,
        planDocs, mapLayers, sym, incidentView, view, symbolCaptions, board, effBuilding, captureUsage,
        attachments, canEditRapport, addAttachments, captionAttachment, removeAttachment, canShareLink,
        running, assignRole, assignTypedName, saveReportMeta, canEditMeta, onEditMeta, setMode,
        setRapportReturn, canWriteRecord, resolveAttendanceConflict, canEditIncident, readOnly,
        confirmAndComplete, setJournalOpen, setJournalFromRapport, reportSignatures,
        signRapport: canEditRapport ? signRapport : undefined,
        voidSignatures: canEditRapport ? voidSignatures : undefined,
      }} />
      <JournalLayer {...{
        journalOpen, guarded, journal, auditDelivery, closedRefusedTotal, workspaceRoleParked, exportEntries, journalVocab,
        timeline, incidentMeta, planDocs, journalLive, focusEvent, replayActive, replayAtMs, seekToEvent, journalLandOn,
        setJournalOpen, setJournalLandOn, journalFromRapport, setJournalFromRapport, openRapport, readOnly,
        enterReplay, reminders, setNoteOn, setComposerOpen, reRaisePendenz, media, setPlayer, photoOnMap,
        tacticalLocked, placePhotos, showPhotoOnMap, player, isEditor, addPlayerEntry, composerOpen,
        addJournal, noteOn, roleReadOnly, linkScoped,
      }} />
      {sharePick && (
        <SharePositionSheet
          roster={personnel}
          pickOnly={sharePick !== 'ask'}
          lastPersonId={share.pref?.personId ?? null}
          // «Neuer Einsatz» rather than «Namen ändern»: the question is back because this
          // Einsatz has not been confirmed yet, and the sheet says so instead of looking like
          // the app forgot. Not for a rename — that is somebody choosing to change it.
          reconfirm={sharePick !== 'rename' && !share.confirmed}
          onPick={(id, displayName) => {
            // a rename from the Einstellungen changes the name only; it switches nothing on
            if (sharePick === 'rename') share.rename({ id, displayName })
            else share.start({ id, displayName })
            setSharePick(null)
            if (shareParent === 'views') setViewsOpen(false)
            shareStatusRestore.current = null
            setShareParent(null)
          }}
          onClose={() => {
            setSharePick(null)
            if (shareParent === 'status') shareStatusRestore.current?.()
            shareStatusRestore.current = null
            setShareParent(null)
          }}
        />
      )}
      <WorkspaceSheets {...{
        helpOpen, setHelpOpen, shareLink, incidentMeta, setShareLink, setAtemschutzLinkOn, installGuideOpen,
        setInstallGuideOpen, offlineReadyOpen, setOfflineReadyOpen, offlineProbeUrls, sym, backendPlans,
        manualObject, liveWeather, personnel, syncStatus, lastSyncedAt, syncNow, downloadOffline,
        reloadPersonnel, cancelOffline, offlineProgress, settingsOpen, feedbackOpen, sharePick, shareParent,
        setSettingsOpen, symbolScale, setSymbolScale, symbolCaptions, setSymbolCaptions, railLabels,
        setRailLabels, offlineRadiusM, setOfflineRadiusM, offlineAuto, setOfflineAuto, keepScreenOn,
        setKeepScreenOn, linkScoped, setFeedbackParent, setFeedbackOpen, share, setShareParent, setSharePick,
        feedbackParent, canWriteRecord, photoPosition, setPhotoPosition,
      }} />

      {/* phone field-capture: a editor can't draw tactical symbols on a phone, but can
          always add a journal entry / photo / voice memo from the field — tap to compose,
          hold to record a voice memo (same gesture as the desktop TopBar Eintrag) */}
      {/* …on the Trupps board too (owner, sweep 27.10.2026 #10: «Show the FAB on Trupps»). It was
          kept off there because it sat on the third crew's «Kontakt» (N9, 25.09.2026): a bottom
          inset cannot fix a button over a SCROLLING list. Since sweep 28.10.2026 #5 the card runs
          to the phone edge and its LIST ends above the FAB (Atemschutz.module · `.body`'s
          --fab-safe foot, plus the open card's data-az-fab-foot guard).
          ⚠️ A RUNNING RECORDING is never hidden (sweep #10, lead call): the FAB is the only place
          that says a voice memo is being taken and the only way to stop it, so an open panel or
          the composer does not unmount it, and the CSS that yields it to a tool's dock, the armed
          pill or a detail sheet lets `.rec` stay (15-mobile · «while a tool-option dock …»). */}
      {isPhone && !readOnly && !linkScoped && (voice.recording || (!composerOpen && !panel)) && (
        <FabEntry
          recording={voice.recording}
          recStartedAt={voice.recStartedAt}
          // the composer opens on its text field WITH the keyboard: on a phone the entry is typed
          // far more often than it is tapped together. ⚠️ flushSync, so the sheet commits INSIDE
          // this click and its textarea focuses itself in the same call stack (JournalComposer ·
          // focusedOnAttach) – React otherwise commits a microtask later, and iOS gives a focus
          // made outside the tap a caret and no keys. primeKeyboard is the belt to that brace.
          onTap={() => { primeKeyboard(); flushSync(() => setComposerOpen(true)) }}
          onHoldStart={startVoiceMemo}
          onHoldStop={voice.stop}
          onHoldPhoto={startQuickPhoto}
        />
      )}

      {/* the camera behind the hold gesture's «Foto» target — one input for both the TopBar
          button and the phone FAB, so there is exactly one quick-photo path.
          ⚠️ `.file-picker`, not `hidden`: iOS never opens a picker for a display:none input
          (see 02-base.css) — that is the whole reason this target did nothing on a phone. */}
      {!readOnly && !linkScoped && (
        <input ref={photoInputRef} type="file" accept="image/*" capture="environment" multiple
          className="file-picker" tabIndex={-1} onChange={onQuickPhotoPicked} />
      )}

      {/* «Karte verknüpfen» runs ACROSS surfaces (Plan ⇄ Karte), so its instruction and action
          bars belong to the shell rather than to either one — on a phone the Plan is unmounted
          for the map half of every pair. Renders nothing while the mode is off. */}
      <GeorefModeBars planLabel={planDocs.find((p) => p.id === georefMode.planId)?.code} />
    </div>
  )
}
