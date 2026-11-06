// The Karte itself: the MapView with the tactical picture (or the reconstructed past during a
// replay), the live vehicles and crew, the reference layers and the linked plans' rasters — or
// the boot placeholder while the symbol pack loads. Split out of IncidentWorkspace (E1,
// 09.10.2026); every writer it calls is the workspace's. The workspace's hooks come in as their
// own result objects (the selection, the store, the drawing surface, the map actions, the Trupp
// and team-marker actions), so a new action is one edit in the hook and one here.

import type { KarteWeather } from './useKarteWeather'
import type { useMapActions } from './useMapActions'
import type { ReactNode, RefObject, Dispatch, SetStateAction } from 'react'
import type { MapRef } from 'react-map-gl/maplibre'
import type { JSX } from 'react/jsx-runtime'
import { MapView } from '../components/MapView'
import { Splash } from '../components/Splash'
import { appConfig } from '../config/appConfig'
import type { AtemschutzAlarmState } from '../lib/atemschutz'
import type { SymbolSurface } from '../lib/prefs'
import { SHAPE_TWO_POINT } from '../lib/shapes'
import { type TruppTrail, mapGhostTrails } from '../lib/truppTrails'
import { undoToast } from '../lib/ui'
import { recordKey } from '../lib/undoKeys'
import type { useCoordPicker } from '../lib/useCoordPicker'
import type { useMapDrawing } from '../lib/useMapDrawing'
import type { useMeasure } from '../lib/useMeasure'
import type { ObjectStore } from '../lib/useObjectStore'
import type { useSymbols } from '../lib/useSymbols'
import type { useTacticalSelection } from '../lib/useTacticalSelection'
import type { useTeamMarkerActions } from '../lib/useTeamMarkerActions'
import type { useTruppActions } from '../lib/useTruppActions'
import type { VehicleOverrides } from '../lib/useVehicleLayer'
import type { Entity, LayerDef, Incident, LngLat, Trupp, PreparedMapOverlay, LayerId, Drawing, CaptionMode } from '../types'

export interface MapStageProps {
  sym: ReturnType<typeof useSymbols>
  guarded: (surface: string, node: ReactNode, toMap?: boolean) => JSX.Element
  mapRef: RefObject<MapRef | null>
  mapEntities: Entity[]
  drawings: Drawing[]
  tacticalLocked: boolean
  mapLayers: LayerDef[]
  isVisible: (id: LayerId) => boolean
  mapOverlays: PreparedMapOverlay[]
  georefPlanRasters: { id: string; url: string; opacity: number; coordinates: [[number, number], [number, number], [number, number], [number, number]] }[]
  /** the «Niederschlag (Radar)» layer while it is on (workspace/useKarteWeather · mapRadar) */
  weatherRadar: KarteWeather['mapRadar']
  symbolScale: Record<SymbolSurface, number>
  symbolCaptions: CaptionMode
  setMapSuppressedCaptions: Dispatch<SetStateAction<ReadonlySet<string>>>
  incidentView: Incident
  initialFitPoints: LngLat[] | undefined
  locateReq: number
  setView: Dispatch<SetStateAction<{ bearing: number; center: LngLat; zoom: number }>>
  onBasemapUnavailable: () => void
  onMapSettled: () => void
  /** the tool, the place gesture and the selection (lib/useTacticalSelection) */
  selection: ReturnType<typeof useTacticalSelection>
  /** the tactical store (lib/useObjectStore) */
  store: ObjectStore
  /** the Karte's drawing surface — draft, style, Drawing CRUD (lib/useMapDrawing) */
  mapDrawing: ReturnType<typeof useMapDrawing>
  /** the Karte's gestures and commands (workspace/useMapActions) */
  mapActions: ReturnType<typeof useMapActions>
  truppActions: ReturnType<typeof useTruppActions>
  teamMarkers: ReturnType<typeof useTeamMarkerActions>
  patchEntity: (id: string, patch: Partial<Entity>) => void
  editNoteId: string | null
  setEditNoteId: Dispatch<SetStateAction<string | null>>
  noteTextLive: (id: string, v: string) => void
  noteTextCommit: (id: string, v: string) => void
  setNotePanelId: Dispatch<SetStateAction<string | null>>
  effTrupps: Trupp[]
  azAlarm: AtemschutzAlarmState
  /** «Im Atemschutz zeigen»: the board, landed on that Trupp's card */
  showTrupp: (truppId: string) => void
  newTruppFromMarker: (markerId: string) => void
  removeTeamWithTrail: (id: string) => Promise<void>
  trails: TruppTrail[]
  deleteGhostTrail: (id: string) => Promise<void>
  measure: ReturnType<typeof useMeasure>
  coord: ReturnType<typeof useCoordPicker>
  rotStart: LngLat | null
  flashDrawingId: string | null
  setDrawTap: Dispatch<SetStateAction<{ id: string; x: number; y: number } | null>>
  setVehicleOverrides: Dispatch<SetStateAction<VehicleOverrides>>
}

export function MapStage({
  sym, guarded, mapRef, mapEntities, drawings, tacticalLocked, mapLayers, isVisible, mapOverlays,
  georefPlanRasters, weatherRadar, symbolScale, symbolCaptions, setMapSuppressedCaptions, incidentView,
  initialFitPoints, locateReq, setView, onBasemapUnavailable, onMapSettled, selection, store, mapDrawing,
  mapActions, truppActions, teamMarkers, patchEntity, editNoteId, setEditNoteId, noteTextLive,
  noteTextCommit, setNotePanelId, effTrupps, azAlarm, showTrupp, newTruppFromMarker, removeTeamWithTrail,
  trails, deleteGhostTrail, measure, coord, rotStart, flashDrawingId, setDrawTap, setVehicleOverrides,
}: MapStageProps) {
  const {
    tool, pendingShape, selectedId, setSelectedId, selectedDrawingId, setSelectedDrawingId,
    selectedDrawIds, setSelectedDrawIds, selectedEntityIds, setSelectedEntityIds,
  } = selection
  const { doc, commit, setDocRaw, beginDrag, endDrag } = store
  const {
    draft, setDraft, areaMode, lineNodes, setDraftPointAttachment, draftStartAttachment, freehandKind, onFreehand, createCircle,
    drawColor, drawWidth, drawDashed, selectedDrawing, patchDrawingById, editDrawingCoords,
    editDrawingRadius, insertDrawingVertex, deleteDrawingVertex, setDrawingAttachment, moveLabel,
  } = mapDrawing
  const {
    finishSelection, onMapClick, onMarquee, transformGroup, startEntityMove, streamEntityMove,
    finishEntityMove, deleteEntity, undockTeam,
  } = mapActions
  const { adoptTruppMarker, releaseTruppMarker, linkTruppLine, unlinkTruppLine } = truppActions
  const { markTeamPosition, renameTeam, clearTeamTrail } = teamMarkers
  return (
    <>
      {/* the map mounts once the pack has loaded OR failed for good — with an empty glyph table a
          symbol renders as its empty chip, which beats a splash that never ends (02.09.) */}
      {(sym.ready || sym.error) ? guarded('map', (
        <MapView
          ref={mapRef}
          entities={mapEntities}
          readOnly={tacticalLocked}
          layers={mapLayers}
          byName={sym.byName}
          symMul={symbolScale.map}
          captionMode={symbolCaptions}
          onCaptionSuppressionChange={setMapSuppressedCaptions}
          initialCenter={incidentView.center}
          fitPoints={initialFitPoints}
          locateNonce={locateReq}
          editNoteId={editNoteId}
          onNoteText={noteTextLive}
          onNoteCommit={noteTextCommit}
          onNoteEdit={tacticalLocked ? undefined : (id) => { setSelectedId(id); setSelectedDrawingId(null); setEditNoteId(id) }}
          // the ⚙ stays on a locked surface — it opens the note READ-ONLY (a long note is
          // truncated on the map, and reading it is not editing it)
          onNotePanel={(id) => {
            if (tool === 'measure') return // the tap already landed as a measuring point (onSelect)
            setNotePanelId(id)
          }}
          trupps={effTrupps}
          truppSeverities={azAlarm.severities}
          // …and it LANDS on the card: the board can be a wall of Trupps, so «Im Atemschutz
          // zeigen» points at the one that was tapped (same gesture as the alarm row's «Zum
          // Trupp»). Without the focus the jump answered «which one is this?» with a list.
          onShowTrupp={showTrupp}
          // the marker's half of the Trupp join — the same action the Atemschutz card's picker
          // calls, so the takeover confirm and the «einrücken?» ask exist exactly once
          onTeamTrupp={tacticalLocked ? undefined : (entityId, truppId) => {
            if (truppId) void adoptTruppMarker(truppId, entityId)
            else releaseTruppMarker(entityId)
          }}
          onTeamNewTrupp={tacticalLocked ? undefined : newTruppFromMarker}
          onTeamMark={tacticalLocked ? undefined : markTeamPosition}
          onTeamRename={tacticalLocked ? undefined : renameTeam}
          onTeamClearTrail={tacticalLocked ? undefined : clearTeamTrail}
          onTeamRemoveWithTrail={tacticalLocked ? undefined : (id) => void removeTeamWithTrail(id)}
          // the searched areas removed Trupp markers left behind (lib/truppTrails); without the
          // writer the label is a read-out (MapMarkers)
          ghostTrails={mapGhostTrails(trails)}
          onGhostTrail={tacticalLocked ? undefined : (id) => void deleteGhostTrail(id)}
          // «Lösen» on a joined Trupp marker: it lets go of the Leitung on BOTH sides (anchor +
          // the Trupp's own number), which is a Trupp-record write and therefore outside the
          // Karte's document undo — so it quits with the confirm-with-undo toast one-shot ops
          // use here, and re-linking is the exact inverse call.
          onTeamUnlink={tacticalLocked ? undefined : (entityId, lineId) => {
            const marker = doc.entities.find((e) => e.id === entityId)
            const truppId = marker?.truppId
            if (!truppId) return
            // …and the hose lets go of the marker with it (useTruppActions · unlinkTruppLine)
            unlinkTruppLine(truppId)
            // …and the marker steps away from the end it just left (15.09., «places it away»), so
            // the two do not keep standing on one pixel looking joined. The hose end stays put.
            const map = mapRef.current
            if (map && marker?.coord) {
              const p = map.project(marker.coord)
              const c = map.unproject([p.x + 36, p.y + 36])
              patchEntity(entityId, { coord: [c.lng, c.lat] })
            }
            undoToast(appConfig.copy.atemschutz.lineUnlinkedToast, () => { linkTruppLine(truppId, lineId) },
              [recordKey('trupps', truppId), recordKey('objects', lineId), recordKey('objects', entityId)])
          }}
          // the pill's «Lösen» for the OTHER bond (15.09.): a docked marker lets go of its symbol
          // without the detail sheet – dragging cannot part them any more, it moves both. The
          // same path as the Trupp panel's «Lösen»: its row and its «Rückgängig» toast
          onTeamUndock={tacticalLocked ? undefined : undockTeam}
          preparedOverlays={mapOverlays}
          onSelectionDone={finishSelection}
          // the linked sheets themselves, as a raster backdrop under the ink — a picture of the
          // paper, not an object on it, which is why THIS one is not a projection of anything
          georefPlanRasters={georefPlanRasters}
          weatherRadar={weatherRadar}
          isVisible={isVisible}
          selectedId={selectedId}
          // Messen: a tap on a symbol is a measuring point FROM ITS CENTRE, never a selection —
          // opening the detail panel mid-measurement read as the tool cancelling itself
          // (Feldtest 09.09.). Drawings need no branch: `placing` already routes their taps to
          // the plain map click, which appends the tapped point.
          onSelect={(e) => {
            if (tool === 'measure') { measure.setPath((d) => [...d, e.coord as LngLat]); return }
            setSelectedId(e.id); setSelectedDrawingId(null); setSelectedDrawIds([]); setSelectedEntityIds([])
          }}
          onMapClick={onMapClick}
          drawings={drawings}
          drawingsVisible={isVisible(appConfig.defaults.drawingLayerId)}
          draft={draft}
          draftKind={tool === 'area' && areaMode === 'nodes' ? 'area' : lineNodes ? 'line' : null}
          placing={tool !== 'select'}
          onDraftDrag={(i, c) => setDraft((pts) => pts.map((p, j) => (j === i ? c : p)))}
          onDraftInsert={(i, c) => setDraft((pts) => { const next = [...pts]; next.splice(i, 0, c); return next })}
          onDraftDelete={(i) => setDraft((pts) => pts.filter((_, j) => j !== i))}
          onDraftPointAttachment={setDraftPointAttachment}
          draftStartAttachment={draftStartAttachment}
          measurePoints={tool === 'measure' ? measure.path : []}
          measureKind={tool === 'measure' ? measure.mode : null}
          onMeasureDrag={(i, c) => measure.setPath((pts) => pts.map((p, j) => (j === i ? c : p)))}
          onMeasureInsert={(i, c) => measure.setPath((pts) => { const next = [...pts]; next.splice(i, 0, c); return next })}
          onMeasureDelete={(i) => measure.setPath((pts) => pts.filter((_, j) => j !== i))}
          measureLabels={measure.labels}
          draggable={!tacticalLocked && tool === 'select'}
          onMarkerDragStart={startEntityMove}
          onMarkerMove={streamEntityMove}
          onMarkerDragEnd={finishEntityMove}
          // a locked session gets no rotate / resize handles at all (MapMarkers draws one only
          // where its writer is wired) — the Plan's parity (RBAC audit 22.10.2026)
          onRotate={tacticalLocked ? undefined : (id, deg) => { setVehicleOverrides((m) => ({ ...m, [id]: { ...m[id], rotation: deg } })) }}
          onShapeTransform={tacticalLocked ? undefined : (id, patch, phase) => {
            if (phase === 'start') { beginDrag(); return }
            if (phase === 'move') { setDocRaw((d) => ({ ...d, entities: d.entities.map((e) => (e.id === id ? { ...e, ...patch } : e)) })); return }
            endDrag()  // 'end' — fold the whole gesture into a single undo step
          }}
          onView={setView}
          onBasemapUnavailable={onBasemapUnavailable}
          onSettled={onMapSettled}
          picking={coord.mode === 'aim'}
          onCursor={coord.setAim}
          onPick={(c) => {
            coord.setPicked(c); coord.setAim(null)
            coord.setMode('set')
          }}
          pickedPoint={coord.mode === 'set' ? coord.picked : null}
          placeMagnet={tool === 'shape' && !!pendingShape && SHAPE_TWO_POINT[pendingShape] && !tacticalLocked}
          placeAnchor={tool === 'shape' && !!pendingShape ? rotStart : null}
          freehand={freehandKind}
          onFreehand={onFreehand}
          circleEnabled={tool === 'circle' && !tacticalLocked}
          onCircle={createCircle}
          drawColor={drawColor}
          drawWidth={drawWidth}
          drawDashed={drawDashed}
          selectedDrawingId={selectedDrawingId}
          flashDrawingId={flashDrawingId}
          onSelectDrawing={(id, at) => {
            // remember WHERE it was tapped, paired with the id — the panel nudge anchors on it for
            // a drawing too big for its bounds to mean anything. Any other way into the selection
            // (Verlauf jump, a just-finished stroke) leaves a stale id here and is simply ignored.
            setDrawTap(at ? { id, x: at.x, y: at.y } : null)
            setSelectedDrawingId(id); setSelectedDrawIds([]); setSelectedEntityIds([]); setSelectedId(null)
          }}
          onUnlockDrawing={tacticalLocked ? undefined : (id) => { patchDrawingById(id, { locked: undefined }); setSelectedDrawingId(id); setSelectedDrawIds([]); setSelectedEntityIds([]); setSelectedId(null) }}
          onUnlockShape={tacticalLocked ? undefined : (id) => { commit((d) => ({ ...d, entities: d.entities.map((e) => (e.id === id ? { ...e, locked: undefined } : e)) })); setSelectedId(id); setSelectedDrawingId(null); setSelectedDrawIds([]); setSelectedEntityIds([]) }}
          onDelete={deleteEntity}
          selectedDrawing={selectedDrawing}
          onDrawingEdit={editDrawingCoords}
          onDrawingRadius={editDrawingRadius}
          // a pump a Leitung draws, dragged along it: its pin as an edit of that line – one undo
          // step, no Verlauf row (a pin is planning, lib/drawingEdit)
          onLinePumpPin={tacticalLocked ? undefined : patchDrawingById}
          onDrawingVertexInsert={insertDrawingVertex}
          onDrawingVertexDelete={deleteDrawingVertex}
          onDrawingAttachment={setDrawingAttachment}
          onLabelMove={tacticalLocked ? undefined : moveLabel}
          marqueeEnabled={tool === 'lasso' && !tacticalLocked && coord.mode === 'off'}
          selectedDrawIds={selectedDrawIds}
          selectedEntityIds={selectedEntityIds}
          onMarquee={onMarquee}
          onGroupTransform={transformGroup}
        />
      // the Karte's own card offers no «Zur Karte»: that button would lead to the view it is on
      ), false) : (
        <Splash inApp sub={appConfig.copy.loadingSubtitle} />
      )}
    </>
  )
}
