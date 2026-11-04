// The Karte's gestures and commands: picking a tool, a tap on the map (place a symbol, shape,
// note, team; collect draft points), «Einpassen», the saved views, duplicate, the module keys and
// the keyboard layer, the panel nudges, the lasso group (move / turn / delete), moving and docking
// markers, «Lösen», jumps to a marker or a plan, deleting and «erledigt». Split out of
// IncidentWorkspace (E1, 09.10.2026) verbatim — the store, the selection and every writer are the
// workspace's and come in as inputs; effects keep their order.

import type { ViewsApi } from '../components/MapViewsMenu'
import { appConfig } from '../config/appConfig'
import type { AuthUser } from '../lib/auth'
import { isDemoMode } from '../lib/deploymentConfig'
import { carryDocked, dockRadiusFor, isDockable, isPlacard, nearestDockHost } from '../lib/docking'
import { removalRowText } from '../lib/drawingEdit'
import { duplicateDrawing, duplicateEntity } from '../lib/duplicate'
import { fillTemplate, formatSymbolName, formatTime } from '../lib/format'
import { bearingDeg, circlePolygon, haversineM, midCoord } from '../lib/geo'
import { georefDispatch, useGeorefMode } from '../lib/georefMode'
import { routeEscape, routeHotkey } from '../lib/hotkeyRoute'
import { resolveHotkey, isTypingTarget } from '../lib/hotkeys'
import { newId } from '../lib/ids'
import { applyRouting, detachDrawings, moveLineBody, objectAttachment, wireFreed, withDetach, type DetachPatch } from '../lib/lineAttachments'
import { moduleNumbers } from '../lib/navRail'
import { autoNoteWPx } from '../lib/notes'
import { doneAct, donePlace } from '../lib/objectDone'
import { nudgePointIntoRect, nudgeSelectionIntoRect, type NudgeBox } from '../lib/panelNudge'
import { placedTrupps, type PlacedTrupp } from '../lib/placedTrupps'
import { motionDuration, prefersReducedMotion } from '../lib/reducedMotion'
import { centroid, rotateAround, turnedBy } from '../lib/selectionTransform'
import { serverNow, serverNowIso } from '../lib/serverClock'
import { ROTATION_DEFAULT_RUN_M, ROTATION_W_M, SHAPE_DEFS, SHAPE_MIN_M, SHAPE_TWO_POINT, rotationBox } from '../lib/shapes'
import { seedSymbolProps, VEHICLE_SYMBOLS } from '../lib/symbols'
import type { TacticalObject } from '../lib/tacticalObjects'
import { lineTakesTrupp } from '../lib/truppLines'
import { toast, confirmDialog, undoToast } from '../lib/ui'
import { recordKey, type RecordKey } from '../lib/undoKeys'
import type { Dropper, UndoDomain } from '../lib/undoTimeline'
import { useCoordPicker } from '../lib/useCoordPicker'
import { useMeasure } from '../lib/useMeasure'
import { useNotePanelClosing } from '../lib/useNotePanelClosing'
import { useShareMyPosition } from '../lib/useShareMyPosition'
import { useSymbols } from '../lib/useSymbols'
import type { VehicleOverrides } from '../lib/useVehicleLayer'
import type { ShareLinkKind } from '../lib/viewLink'
import type { Doc } from '../lib/workspace'
import type { CameraView, Drawing, Entity, Incident, LineAttachment, LineEndpoint, LngLat, ShapeKind, TimelineEvent, Trupp, PlanDocument, NoteSize, MapTool } from '../types'
import type { OneShotRows, WorkspaceMode } from './types'
import { useEffect, useMemo, useRef, type Dispatch, type RefObject, type SetStateAction } from 'react'
import type { MapRef } from 'react-map-gl/maplibre'
import { isMapTool } from '../lib/readOnlyTools'


export interface UseMapActionsInputs {
  clearMapUi: (keep?: 'selection') => void
  setPaletteOpen: Dispatch<SetStateAction<boolean>>
  tool: MapTool
  setTool: Dispatch<SetStateAction<MapTool>>
  setPending: Dispatch<SetStateAction<string | null>>
  setPendingShape: Dispatch<SetStateAction<ShapeKind | null>>
  setSelectedId: Dispatch<SetStateAction<string | null>>
  setSelectedDrawingId: Dispatch<SetStateAction<string | null>>
  setSelectedDrawIds: Dispatch<SetStateAction<string[]>>
  setSelectedEntityIds: Dispatch<SetStateAction<string[]>>
  setNotePanelId: Dispatch<SetStateAction<string | null>>
  setEditNoteId: Dispatch<SetStateAction<string | null>>
  panel: 'layers' | null
  setPanel: Dispatch<SetStateAction<'layers' | null>>
  tacticalLocked: boolean
  pendingShape: ShapeKind | null
  rotStart: LngLat | null
  setRotStart: Dispatch<SetStateAction<LngLat | null>>
  commit: (updater: (d: Doc) => Doc, opts?: { gesture?: boolean }) => void
  placeLock: boolean
  log: (icon: string, text: string, kind?: TimelineEvent['kind'], audioUrl?: string, entityId?: string, opts?: { rowId?: string; subjectId?: string }) => void
  emit: (op_type: string, payload?: Record<string, unknown>, opts?: { observed?: string }) => void
  pending: string | null
  sym: ReturnType<typeof useSymbols>
  addRecent: (name: string) => void
  noteDefaults: { size: NoteSize; plain: boolean; color: string }
  setNotePlacedId: Dispatch<SetStateAction<string | null>>
  setTeamPick: Dispatch<SetStateAction<LngLat | null>>
  setDraft: (action: SetStateAction<LngLat[]>) => void
  /** leave the draft in the hand – asks about a committable one (useMapDrawing · settleDraft) */
  settleDraft: () => void
  lineMode: 'freehand' | 'nodes'
  measure: ReturnType<typeof useMeasure>
  mapRef: RefObject<MapRef | null>
  incidentView: Incident
  entities: Entity[]
  liveIds: Set<string>
  resolvedMapDrawings: Drawing[]
  cameraViews: CameraView[]
  view: { bearing: number; center: LngLat; zoom: number }
  setLocateReq: Dispatch<SetStateAction<number>>
  incidentOpen: boolean
  share: ReturnType<typeof useShareMyPosition>
  setShareParent: Dispatch<SetStateAction<'settings' | 'views' | 'status' | null>>
  setSharePick: Dispatch<SetStateAction<'ask' | 'pick' | 'rename' | null>>
  setCameraViews: Dispatch<SetStateAction<CameraView[]>>
  rememberOneShotRef: RefObject<(domain: UndoDomain, label: string, restore: () => void, reapply: () => void, touches: () => readonly RecordKey[] | null, rows?: OneShotRows | 'silent') => Dropper>
  C_HIST: import('../config/copy').Copy
  setViewsOpen: Dispatch<SetStateAction<boolean>>
  viewsOpen: boolean
  selectedId: string | null
  selectedDrawIds: string[]
  selectedEntityIds: string[]
  doc: Doc
  truppCounterNames: (exceptId?: string) => (string | undefined)[]
  selectedDrawingId: string | null
  planDocs: PlanDocument[]
  mode: WorkspaceMode
  setMode: Dispatch<SetStateAction<WorkspaceMode>>
  setActivePlanId: Dispatch<SetStateAction<string>>
  hotkeyRef: RefObject<(e: KeyboardEvent) => void>
  settingsOpen: boolean
  paletteOpen: boolean
  pickerOpen: boolean
  helpOpen: boolean
  installGuideOpen: boolean
  offlineReadyOpen: boolean
  shareLink: ShareLinkKind | null
  composerOpen: boolean
  georefActive: boolean
  georefMode: ReturnType<typeof useGeorefMode>
  replayActive: boolean
  readOnly: boolean
  linkScoped: boolean
  goToNav: (dir: -1 | 1) => void
  planFit: RefObject<(() => void) | null>
  stepHistory: (dir: 'undo' | 'redo', anchor?: HTMLElement | null) => void
  planKeys: RefObject<{ pickTool: (tool: string) => void; zoom: (f: number) => void; duplicate: () => void } | null>
  setJournalOpen: Dispatch<SetStateAction<boolean>>
  setComposerOpen: Dispatch<SetStateAction<boolean>>
  togglePanel: (name: 'layers') => void
  setSettingsOpen: Dispatch<SetStateAction<boolean>>
  setHelpOpen: Dispatch<SetStateAction<boolean>>
  coord: ReturnType<typeof useCoordPicker>
  notePanelId: string | null
  notePlacedId: string | null
  mapWorkRect: (container: DOMRect, panelEl: Element) => NudgeBox | null
  drawings: Drawing[]
  drawTap: { id: string; x: number; y: number } | null
  beginDrag: () => void
  setDocRaw: (update: SetStateAction<Doc>, opts?: { gesture?: boolean; movedIds?: readonly string[] }) => void
  endDrag: () => void
  flyToMapVisible: (center: LngLat, zoom: number) => void
  setVehicleOverrides: Dispatch<SetStateAction<VehicleOverrides>>
  trupps: Trupp[]
  linkTruppLine: (truppId: string, lineId: string) => boolean
  patchEntity: (id: string, patch: Partial<Entity>) => void
  objectsRef: RefObject<TacticalObject[]>
  objects: TacticalObject[]
  setPlanFocus: Dispatch<SetStateAction<{ x: number; y: number; floor: number; annoId?: string; twinEntityId?: string; flash?: boolean; nonce: number } | null>>
  focusEntity: (id: string) => void
  editNoteId: string | null
  user: AuthUser | null
  stepLabelRef: RefObject<string | null>
}

export function useMapActions({
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
  endDrag, flyToMapVisible, setVehicleOverrides, trupps, linkTruppLine, patchEntity, objectsRef,
  objects, setPlanFocus, focusEntity, editNoteId, user, stepLabelRef,
}: UseMapActionsInputs) {
  // Every path through here ends the "I am reading this object" state — reaching for a tool means
  // you are done with the detail panel, exactly as it has always worked for a note (see the
  // notePanelId effect). Symbol goes through it too: it opens the palette without setting `tool`,
  // so dismissing the palette without picking used to reveal the stale panel again.
  const pick = (id: string) => {
    if (id === 'symbol') { clearMapUi(); setPaletteOpen(true); return }
    // Auswahl (select) is the default navigate state: one finger pans the map, a tap
    // selects, a drag on an object moves it. There is no separate pan mode any more —
    // panning is always available.
    // ⚠️ Auswahl and Mehrfach SHARE one rail slot (05.09.), and the rail resolves that toggle
    // itself: a second tap on the armed Auswahl arrives here as `'lasso'` (and a tap on the armed
    // Mehrfach as `'select'`), so it falls through to the setTool below — clearing the selection
    // on the way, exactly as picking the separate Mehrfach button always did.
    // tapping the already-active tool again exits it → back to Auswahl (closes its option dock)
    if (id === tool) { clearMapUi(); return }
    clearMapUi(); if (isMapTool(id)) setTool(id)
  }

  const pickShape = (kind: ShapeKind) => { setTool('shape'); setPending(null); setPendingShape(kind); setPaletteOpen(false) }

  // A real, stationary tap on the map — MapView drops the click that merely trails a pan or a
  // pinch before it ever gets here (see its panGesture note), so moving the map neither places
  // anything nor reaches the deselect at the end of this chain. On a phone that deselect IS the
  // detail sheet's dismiss, and it used to fire on every pan.
  /** «Fertig» on the selection bar — the editing state ends. Exactly what a tap on the empty map
   *  already does: nothing selected, and every sheet that was open FOR that selection closed. */
  const finishSelection = () => {
    setSelectedId(null); setSelectedDrawingId(null)
    setSelectedDrawIds([]); setSelectedEntityIds([])
    setNotePanelId(null); setEditNoteId(null)
  }
  const onMapClick = (c: LngLat) => {
    // a map tap dismisses an open Ebenen panel first (parity with the phone backdrop) —
    // the panel is map chrome, so tapping the map behind it should just close it
    if (panel !== null) { setPanel(null); return }
    // read-only surfaces: Messen is the one tool whose taps mean anything (its path is ephemeral —
    // see lib/useMeasure). Everything else falls through to "deselect", so a stale armed tool can
    // never keep collecting draft points behind a hidden dock.
    if (tacticalLocked && tool !== 'measure') {
      setSelectedId(null); setSelectedDrawingId(null); setSelectedDrawIds([]); setSelectedEntityIds([])
      return
    }
    if (tool === 'shape' && pendingShape) {
      const id = newId('sh'); const def = SHAPE_DEFS[pendingShape]
      const name = appConfig.copy.shapes.names[pendingShape]
      // ── A Rotation is laid between two PLACES (lib/shapes · SHAPE_TWO_POINT) ──────────────
      // The first tap is the Wasserbezug, the second the Brandstelle, and the loop's centre,
      // length, bearing and width all fall out of the pair. A second tap on the SAME spot means
      // «einfach hinlegen»: the default run, aimed east — nobody is ever left holding half a
      // gesture with no way to finish it.
      let geom: Pick<Entity, 'coord' | 'rotation' | 'sizeM' | 'aspect'> = { coord: c, sizeM: def.defaultSizeM, rotation: 0 }
      if (SHAPE_TWO_POINT[pendingShape]) {
        if (!rotStart) { setRotStart(c); return }
        const spanM = haversineM(rotStart, c)
        const apart = spanM >= SHAPE_MIN_M
        const box = rotationBox(apart ? spanM : ROTATION_DEFAULT_RUN_M, ROTATION_W_M)
        geom = {
          coord: apart ? midCoord(rotStart, c) : rotStart,
          rotation: apart ? Math.round(bearingDeg(rotStart, c)) : 0,
          sizeM: Math.round(box.size),
          aspect: Math.round(box.aspect * 1000) / 1000,
        }
        setRotStart(null)
      }
      commit((d) => ({ ...d, entities: [...d.entities, { id, kind: 'shape', layer: appConfig.defaults.drawingLayerId, shape: pendingShape, color: def.defaultColor, label: name, ...geom }] }))
      // unlocked: place once, then drop back to select with the new shape active so
      // its edit handles are immediately usable. locked: stay in place-mode (no
      // selection so the editor doesn't interrupt) to drop several in a row.
      // Both branches drop a lasso group too — it used to survive every placement and keep
      // painting halos over unrelated objects.
      setSelectedDrawIds([]); setSelectedEntityIds([])
      if (placeLock) { setSelectedId(null); setSelectedDrawingId(null) }
      else { setPendingShape(null); setTool('select'); setSelectedId(id); setSelectedDrawingId(null) }
      log('area', fillTemplate(appConfig.copy.log.shapePlaced, { name }), 'symbol', undefined, id)
      emit('entity.add', { id, kind: 'shape', entity: { id, kind: 'shape', layer: appConfig.defaults.drawingLayerId, shape: pendingShape, color: def.defaultColor, label: name, ...geom } })
    } else if (tool === 'symbol' && pending) {
      const id = newId('p'); const s = pending
      // shared seeding (label / subtitle / fields / vehicle rotation) — identical to
      // the Plan placement path so a symbol carries the same structure on both surfaces
      // A driven vehicle is stored on the Fahrzeuge layer, so it toggles with the live GPS
      // glyphs rather than sitting among the tactical symbols. (Old incidents are handled by
      // effectiveLayer at read time — this just means new data needs no shim.)
      const layer = VEHICLE_SYMBOLS.has(s) ? appConfig.gps.layerId : appConfig.defaults.operationalLayerId
      const entity: Entity = { id, kind: 'symbol', layer, coord: c, ...seedSymbolProps(s, sym.symbols) }
      commit((d) => ({ ...d, entities: [...d.entities, entity] }))
      addRecent(s)
      setSelectedDrawIds([]); setSelectedEntityIds([])
      if (placeLock) { setSelectedId(null); setSelectedDrawingId(null) }
      else { setPending(null); setTool('select'); setSelectedId(id); setSelectedDrawingId(null) }
      log('hex', fillTemplate(appConfig.copy.log.symbolPlaced, { name: entity.label || formatSymbolName(s) }), 'symbol', undefined, id)
      emit('entity.add', { id, symbol: s, entity })
    } else if (tool === 'note') {
      const id = newId('n')
      commit((d) => ({ ...d, entities: [...d.entities, { id, kind: 'note', layer: appConfig.defaults.drawingLayerId, coord: c, label: '', subtitle: appConfig.copy.entities.noteSubtitle, noteW: autoNoteWPx('', noteDefaults.size === 'm' ? undefined : noteDefaults.size), noteAutoW: true, noteSize: noteDefaults.size === 'm' ? undefined : noteDefaults.size, notePlain: noteDefaults.plain || undefined, color: noteDefaults.color || undefined }] }))
      // Straight into typing — in the detail sheet, with the caret already in its text field
      // (05.09.). It used to open the on-canvas inline editor instead, which is a text cursor
      // sitting on the map with no visible field, no room for a second line and, on a phone, the
      // keyboard over the very spot just tapped. Double-tap still opens that inline editor for
      // the desktop hand that wants it.
      setSelectedId(id); setSelectedDrawingId(null); setNotePanelId(id); setNotePlacedId(id); setTool('select'); log('type', appConfig.copy.log.notePlaced, 'note', undefined, id)
      emit('entity.add', { id, kind: 'note', entity: { id, kind: 'note', layer: appConfig.defaults.drawingLayerId, coord: c, label: '', subtitle: appConfig.copy.entities.noteSubtitle, noteW: autoNoteWPx('', noteDefaults.size === 'm' ? undefined : noteDefaults.size), noteAutoW: true, noteSize: noteDefaults.size === 'm' ? undefined : noteDefaults.size, notePlain: noteDefaults.plain || undefined, color: noteDefaults.color || undefined } })
    } else if (tool === 'team') {
      setTeamPick(c) // which Trupp? — picker over the tapped spot (mirrors the plan's Team tool)
    } else if (tool === 'area') {
      setDraft((d) => [...d, c])
    } else if (tool === 'line' && lineMode === 'nodes') {
      setDraft((d) => [...d, c]) // node mode: tap to place each line vertex; ✓ finishes
    } else if (tool === 'measure') {
      measure.setPath((d) => [...d, c])
    } else { setSelectedId(null); setSelectedDrawingId(null); setSelectedDrawIds([]); setSelectedEntityIds([]) }
  }

  // "Center" doesn't just recentre the alarm point — it frames the whole tactical picture:
  // fit the incident location PLUS every placed symbol/shape/note and drawn line/area/circle,
  // with padding, so zooming to the Einsatz shows everything that's been worked on. Falls back
  // to a plain recentre when nothing has been drawn yet (a single point has no extent to fit).
  const centerIncident = () => {
    const map = mapRef.current; if (!map) return
    const pts: LngLat[] = [incidentView.center]
    // exclude live GPS vehicles — they may be parked at the Magazin, far from the scene, and
    // would blow the bounds wide open. Only the placed tactical picture frames the view.
    for (const e of entities) if (!liveIds.has(e.id) && Array.isArray(e.coord)) pts.push(e.coord as LngLat)
    for (const d of resolvedMapDrawings) {
      if (!Array.isArray(d.coords)) continue
      if (d.kind === 'circle' && d.coords[0] && d.radiusM) {
        const [lng, lat] = d.coords[0]
        const dLat = d.radiusM / 110540
        const dLng = d.radiusM / ((111320 * Math.cos((lat * Math.PI) / 180)) || 1)
        pts.push([lng - dLng, lat - dLat], [lng + dLng, lat + dLat])
      } else {
        for (const c of d.coords) if (Array.isArray(c)) pts.push(c as LngLat)
      }
    }
    const lngs = pts.map((p) => p[0]), lats = pts.map((p) => p[1])
    const minLng = Math.min(...lngs), maxLng = Math.max(...lngs), minLat = Math.min(...lats), maxLat = Math.max(...lats)
    if (maxLng - minLng < 1e-6 && maxLat - minLat < 1e-6) {
      map.flyTo({ center: incidentView.center, zoom: 17.6, ...(prefersReducedMotion() ? { duration: 0 } : {}) })
    } else {
      map.fitBounds([[minLng, minLat], [maxLng, maxLat]], { padding: 96, maxZoom: 17.6, duration: motionDuration(600) })
    }
  }

  // Saved map views (camera bookmarks) — snapshot the live camera, fly back to one on tap. The
  // list is synced per incident so the crew shares framings (a north-up overview + the map turned
  // to how they're standing). Restore animates with rotation so the bearing comes back too.
  // plain object (not memoised) so onFit always calls the LATEST centerIncident — that closure
  // captures the live entities/drawings, which a stale memo would freeze.
  const viewsApi: ViewsApi = {
    list: cameraViews,
    current: view,
    onGo: (v) => mapRef.current?.flyTo({ center: v.center, zoom: v.zoom, bearing: v.bearing, duration: motionDuration(600) }),
    // an animated turn back to north, like a map app's compass — at the saved views' pace, and
    // instant under reduced motion (MapLibre's own default is a fixed 1 s that ignores it)
    onResetNorth: () => mapRef.current?.resetNorth({ duration: motionDuration(600) }),
    onFit: centerIncident,
    onLocate: () => setLocateReq((n) => n + 1),
    // Standort teilen — the act, one row under «Mein Standort». ALWAYS rendered: when there is
    // nothing to report into (a finished Einsatz, the demo) it says so in place rather than
    // vanishing, because an absent control and an unbuilt feature look identical. One tap once
    // the device has permission and a name; otherwise the sheet asks for both first.
    share: (() => {
      const C = appConfig.copy.sharePosition
      // The demo no longer blocks this: sharing there is simulated — the control works, a dot
      // walks, and no location is taken or sent (lib/demoCrewWalk). The sub-line says so, so
      // nobody believes the demo is broadcasting their phone.
      const blocked = !incidentOpen ? C.menuClosed : null
      const on = share.state !== 'off'
      return {
        on,
        label: on ? C.menuOn : C.menuOff,
        // While sharing, the sub-line names the way out. Turning it ON is one tap, so turning
        // it OFF has to be one tap in the same place, and has to SAY so — a device that is
        // broadcasting where somebody is must never make stopping the thing you go hunting for.
        note: blocked ?? (isDemoMode() ? C.menuDemo : on ? C.menuOnHint : null),
        disabled: !!blocked,
        onToggle: () => {
          if (on) { share.stop(); return false }
          // One tap only once somebody confirmed «das bin ich» FOR THIS Einsatz. A device that
          // merely remembers a name from the last one has to be asked again — a Tablet that
          // gets handed around otherwise reports the whole Einsatz under the wrong name. The
          // permission is not re-asked, only the identity, so that is the picker alone.
          else if (share.confirmed) { share.start(); return false }
          else {
            setShareParent('views')
            setSharePick(share.ready ? 'pick' : 'ask')
            return true
          }
          return false
        },
      }
    })(),
    onSave: () => {
      // The time it was saved, not «Ansicht 3». A counter says nothing about which view it
      // is; the clock at least anchors it to what was happening then, and the list is in
      // save order anyway. Renaming stays one tap away for a view worth a real name.
      const v: CameraView = { id: newId('v'), name: formatTime(new Date()), center: view.center, zoom: view.zoom, bearing: view.bearing }
      setCameraViews((vs) => [...vs, v])
      // …and it comes back off the list with ↶, like everything else on the Karte. An Ansicht is
      // cheap to make and was impossible to unmake except by deleting it through a confirm.
      rememberOneShotRef.current('ansicht', C_HIST.undoDomains.ansicht,
        () => setCameraViews((vs) => vs.filter((x) => x.id !== v.id)),
        () => setCameraViews((vs) => (vs.some((x) => x.id === v.id) ? vs : [...vs, v])),
        () => [recordKey('cameraViews', v.id)], 'silent')
      toast(appConfig.copy.mapViews.saved, { icon: 'compass', tone: 'success' })
    },
    onRename: (id, name) => {
      const prev = cameraViews.find((v) => v.id === id)
      if (!prev || !name || name === prev.name) return
      setCameraViews((vs) => vs.map((v) => (v.id === id ? { ...v, name } : v)))
      rememberOneShotRef.current('ansicht', C_HIST.undoDomains.ansicht,
        () => setCameraViews((vs) => vs.map((v) => (v.id === id ? { ...v, name: prev.name } : v))),
        () => setCameraViews((vs) => vs.map((v) => (v.id === id ? { ...v, name } : v))),
        () => [recordKey('cameraViews', id)], 'silent')
    },
    onDelete: async (id) => {
      const index = cameraViews.findIndex((x) => x.id === id)
      const v = cameraViews[index]; if (!v) return
      const ok = await confirmDialog({ title: appConfig.copy.mapViews.deleteTitle, message: fillTemplate(appConfig.copy.mapViews.deleteMsg, { name: v.name }), confirmLabel: appConfig.copy.delete, cancelLabel: appConfig.copy.cancel, danger: true })
      if (!ok) return
      setCameraViews((vs) => vs.filter((x) => x.id !== id))
      // the confirm asked; the timeline entry is what makes the answer reversible — the view
      // comes back at the position it stood in, because the list is in save order
      rememberOneShotRef.current('ansicht', C_HIST.undoDomains.ansicht,
        () => setCameraViews((vs) => (vs.some((x) => x.id === id) ? vs : [...vs.slice(0, index), v, ...vs.slice(index)])),
        () => setCameraViews((vs) => vs.filter((x) => x.id !== id)),
        () => [recordKey('cameraViews', id)], 'silent')
    },
  }
  // Open/close the views popover. Opening it first drops any active tool and the Ebenen
  // panel (only one of {views popover, Ebenen, tool dock} occupies the dock slot).
  // Activating a tool closes both back (the effect below), so no two are ever open together.
  const toggleViews = (open: boolean) => {
    if (open) clearMapUi('selection')
    setViewsOpen(open)
  }

  // --- keyboard shortcuts ---------------------------------------------------------------------
  // Duplicate the current selection (Cmd/Ctrl+D) — a small nudge so the copy is visibly offset and
  // separately selectable (lib/duplicate). Single symbol/shape/note OR single drawing; live GPS
  // markers can't be copied. Multi-select duplicate isn't wired (rare; would need per-item id remap).
  const duplicateSelection = () => {
    // tacticalLocked, not readOnly: the drawing branch below used to duplicate for real in the
    // Führungsansicht, where readOnly is false.
    if (tacticalLocked) return
    if (selectedId) {
      const src = doc.entities.find((e) => e.id === selectedId)
      if (!src || src.live || !Array.isArray(src.coord)) return
      const id = newId('p')
      // the copy rules — no «erledigt», a loose Trupp's next number — are lib/duplicate's
      const copy = duplicateEntity(src, id, truppCounterNames)
      commit((d) => ({ ...d, entities: [...d.entities, copy] }))
      setSelectedId(id); setSelectedDrawingId(null); setSelectedDrawIds([]); setSelectedEntityIds([])
      log('layers', appConfig.copy.log.duplicated, 'symbol', undefined, id); emit('entity.add', { id, entity: copy })
    } else if (selectedDrawingId) {
      const src = doc.drawings.find((dr) => dr.id === selectedDrawingId)
      if (!src) return
      const id = newId('sh')
      const copy = duplicateDrawing(src, id)
      commit((d) => ({ ...d, drawings: [...d.drawings, copy] }))
      setSelectedDrawingId(id); setSelectedId(null); setSelectedDrawIds([]); setSelectedEntityIds([])
      log('layers', appConfig.copy.log.duplicated, 'symbol', undefined, id); emit('draw.add', { id, kind: src.kind, drawing: copy })
    }
  }

  // Jump straight to the Nth surface (number keys). Pressing the Pläne key again while already in
  // Pläne cycles to the next plan document, so the whole nav is reachable from the keyboard.
  // a number key opens the plan module carrying that number (2 or 3 → the "2/3" sheet). No such
  // module → do nothing. Sub-slots / Umgebung / Gebäude have no number and are reached by stepping.
  // Returns whether it landed, so callers that need a fallback (the checklist deep link) can
  // tell "opened Modul n" from "this object has no such module".
  const goToModule = (n: number): boolean => {
    const doc = planDocs.find((p) => moduleNumbers(p).includes(n))
    if (!doc) return false
    if (mode !== 'plans') clearMapUi()
    setMode('plans'); setActivePlanId(doc.id)
    return true
  }

  /** Escape: one layer of transient Karte state per press — lib/hotkeyRoute · routeEscape is the
   *  order. (Modal sheets handle their own Esc via the overlay wrapper; this is only the non-modal
   *  map chrome.) */
  const escape = (e: KeyboardEvent) => {
    // typing in a field? Escape leaves the FIELD and nothing more — one key press must never
    // both finish the text and drop the selection. Read the event TARGET, not activeElement:
    // the field's own handler has already blurred by the time this bubbles up.
    const el = e.target as HTMLElement | null
    if (el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable)) return
    // …and a MODAL on top of the map owns Escape outright — it closes, and the map does NOT also
    // peel a layer behind it (Esc in the «Welcher Trupp?» picker used to close the picker AND
    // disarm the Team tool). Focus is trapped inside the dialog, so the event target is enough.
    // ⚠️ `alertdialog` as well as `dialog`: ConfirmCard (lib/overlays/ConfirmCard) renders the
    // alert role, and a delete confirm on the Lage must not peel a map layer behind it either.
    if (el?.closest('[role="dialog"], [role="alertdialog"]')) return
    switch (routeEscape({
      placing: !!(pending || pendingShape),
      coordOn: coord.mode !== 'off',
      chromeOpen: !!(panel || viewsOpen),
      toolArmed: tool !== 'select',
      notePanelOpen: !!notePanelId,
      selected: !!(selectedId || selectedDrawingId || selectedDrawIds.length || selectedEntityIds.length),
    })) {
      case 'cancelPlacement': setPending(null); setPendingShape(null); setRotStart(null); setTool('select'); break
      case 'coordOff': coord.setMode('off'); break
      case 'closeChrome': setPanel(null); setViewsOpen(false); break
      // Escape leaves the tool like any other way out: a committable draft asks «Speichern ·
      // Verwerfen · Weiterzeichnen» (useMapDrawing · settleDraft, 27.10.2026 – until then Escape
      // was the one silent discard)
      case 'disarmTool': setTool('select'); settleDraft(); break
      case 'closeNotePanel': setNotePanelId(null); break
      case 'clearSelection': setSelectedId(null); setSelectedDrawingId(null); setSelectedDrawIds([]); setSelectedEntityIds([]); break
    }
  }

  // Reassigned every render (effect, no deps) so the mount-once listener (IncidentWorkspace)
  // always sees live handlers/state without re-subscribing — the latest-ref pattern.
  useEffect(() => { hotkeyRef.current = (e: KeyboardEvent) => {
    // Escape is no shortcut (resolveHotkey maps nothing to it) and keeps its own guards above
    if (e.key === 'Escape') { escape(e); return }
    if (isTypingTarget(document.activeElement)) return
    // WHERE the key goes is lib/hotkeyRoute's table (pure, tested there); this only carries it out
    const { action: a, prevent } = routeHotkey(resolveHotkey(e), {
      // a modal sheet owns the screen — its own focus trap / Esc handle keys; stay inert behind it.
      modalOpen: !!(settingsOpen || paletteOpen || pickerOpen || helpOpen || installGuideOpen || offlineReadyOpen || shareLink || composerOpen),
      mode, georefPlanId: georefActive ? georefMode.planId : null,
      moduleTargetId: (n) => planDocs.find((p) => moduleNumbers(p).includes(n))?.id,
      tacticalLocked, replayActive, readOnly, linkScoped,
    })
    if (prevent) e.preventDefault()
    switch (a.type) {
      case 'georef': georefDispatch({ type: a.go }); break
      case 'module': goToModule(a.n); break
      case 'surface': if (a.clear) clearMapUi(); setMode(a.surface); break
      case 'nav': goToNav(a.dir); break
      case 'fitPlan': planFit.current?.(); break
      case 'centerMap': centerIncident(); break
      // No caption — a keyboard user is not asking a button what it did.
      case 'undo': stepHistory('undo'); break
      case 'redo': stepHistory('redo'); break
      case 'duplicateMap': duplicateSelection(); break
      case 'duplicatePlan': planKeys.current?.duplicate(); break
      case 'toolMap': pick(a.tool); break
      case 'toolPlan': planKeys.current?.pickTool(a.tool); break
      case 'journal': setJournalOpen((v) => !v); break
      case 'composer': setComposerOpen(true); break
      case 'layers': togglePanel('layers'); break
      case 'settings': setSettingsOpen(true); break
      case 'help': setHelpOpen(true); break
      case 'zoomPlan': planKeys.current?.zoom(a.factor); break
      case 'zoomMap': if (a.dir === 'in') mapRef.current?.zoomIn(); else mapRef.current?.zoomOut(); break
      case 'locate': setLocateReq((n) => n + 1); break
      case 'coord': coord.cycle(); break
    }
  } })

  const selected = entities.find((e) => e.id === selectedId) ?? null
  // the note whose ⚙ was tapped — a deleted note simply drops out here and the panel unmounts
  const noteEntity = entities.find((e) => e.id === notePanelId && e.kind === 'note') ?? null
  // …and it closes on the Plan's three rules too: deselected, a tool armed, the placed mark spent
  useNotePanelClosing({ selectedId, tool, rest: 'select', notePanelId, setNotePanelId, notePlacedId, setNotePlacedId })

  // keep the tapped symbol visible: the ContextPanel overlay covers the right band of the
  // map — when the selection (incl. its halo/handles) lands under it, ease the camera just
  // enough to bring it clear (lib/panelNudge). Keyed on the id only, NOT the coord: dragging
  // or rotating the selected symbol must never re-trigger a camera move. The rAF lets the
  // panel mount first so we measure its real rect (desktop/tablet widths differ).
  useEffect(() => {
    if (!selectedId || mode !== 'map') return
    const raf = requestAnimationFrame(() => {
      const m = mapRef.current?.getMap()
      const panelEl = document.querySelector('.ctx')
      if (!m || !panelEl || !selected) return
      const cont = m.getContainer().getBoundingClientRect()
      const work = mapWorkRect(cont, panelEl)
      if (!work) return // panel present but CSS-hidden — nothing occludes
      const pt = m.project(selected.coord)
      const nudge = nudgePointIntoRect(pt, work)
      if (nudge) m.panBy(nudge, { duration: motionDuration(350) })
    })
    return () => cancelAnimationFrame(raf)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedId, mode, notePanelId])
  // same courtesy for a tapped or just-finished drawing: the DrawEditor is the same .ctx
  // overlay, but a line/area/circle occupies an extent — so its whole projected bbox
  // (circle = centre ± radius) is brought clear, capped by panelNudgeBox so an extent
  // wider than the open area never slides fully off-screen. Keyed on the id only, like
  // the symbol nudge: reshaping/moving the selected drawing must not re-trigger a pan.
  useEffect(() => {
    if (!selectedDrawingId || mode !== 'map') return
    const raf = requestAnimationFrame(() => {
      const m = mapRef.current?.getMap()
      const panelEl = document.querySelector('.ctx')
      const d = drawings.find((x) => x.id === selectedDrawingId)
      if (!m || !panelEl || !d?.coords.length) return
      const cont = m.getContainer().getBoundingClientRect()
      const work = mapWorkRect(cont, panelEl)
      if (!work) return // panel present but CSS-hidden — nothing occludes
      const coords = d.kind === 'circle' && d.radiusM
        ? (circlePolygon(d.coords[0], d.radiusM, 16)[0] as LngLat[])
        : d.coords
      const pts = coords.map((c) => m.project(c))
      const box = {
        minX: Math.min(...pts.map((p) => p.x)), maxX: Math.max(...pts.map((p) => p.x)),
        minY: Math.min(...pts.map((p) => p.y)), maxY: Math.max(...pts.map((p) => p.y)),
      }
      // `e.point` is already container-relative, the same space `box` lives in
      const tap = drawTap?.id === selectedDrawingId ? { x: drawTap.x, y: drawTap.y } : null
      const nudge = nudgeSelectionIntoRect(box, tap, work)
      if (nudge) m.panBy(nudge, { duration: motionDuration(350) })
    })
    return () => cancelAnimationFrame(raf)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedDrawingId, mode])

  // a marquee selects a SET of drawings: one falls back to the single-edit path, several
  // become a group (move/delete together). Empty box clears any selection. The lasso is a
  // one-shot tool: drop back to plain navigate (select) after the box so a stray next
  // finger pans the map instead of drawing another box.
  const onMarquee = (drawIds: string[], entIds: string[]) => {
    // live (GPS) entities aren't editable, and anything LOCKED is click-through — its chip is
    // the only door (LockChip), so a lasso may neither move, delete nor select it
    const ents = entIds.filter((id) => { const e = entities.find((x) => x.id === id); return !liveIds.has(id) && !e?.locked })
    const draws = drawIds.filter((id) => !drawings.find((d) => d.id === id)?.locked)
    setSelectedId(null)
    if (draws.length + ents.length <= 1) {
      // a single object → drop into the normal single-edit selection
      setSelectedDrawIds([]); setSelectedEntityIds([])
      setSelectedDrawingId(draws[0] ?? null)
      setSelectedId(ents[0] ?? null)
    } else {
      setSelectedDrawingId(null)
      setSelectedDrawIds(draws); setSelectedEntityIds(ents)
    }
    setTool('select')
  }
  // Move and/or turn the marquee group from the selection bar: a (lng,lat) delta and a turn in
  // degrees, both applied to the snapshot taken at gesture start (drawings' coords + entities'
  // coord) — so the whole drag is one undo step and no frame compounds on the last.
  // A turn moves each member AROUND the group's centre and turns each member's own bearing by
  // the same amount, which is what makes a boxed picture read as one rigid thing.
  const groupOrig = useRef<{ draws: Record<string, LngLat[]>; ents: Record<string, Entity>; centre: LngLat | null }>({ draws: {}, ents: {}, centre: null })
  const transformGroup = (ids: string[], entIds: string[], t: { dLng: number; dLat: number; deg: number }, phase: 'start' | 'move' | 'end') => {
    if (tacticalLocked) return
    if (phase === 'start') {
      beginDrag()
      const draws = Object.fromEntries(ids.map((id) => [id, drawings.find((d) => d.id === id)?.coords ?? []]))
      const ents = Object.fromEntries(entIds.flatMap((id) => { const e = entities.find((x) => x.id === id); return e ? [[id, e] as [string, Entity]] : [] }))
      groupOrig.current = {
        draws,
        ents,
        centre: centroid([
          ...Object.values(draws).flat().map((c) => c as [number, number]),
          ...Object.values(ents).map((e) => e.coord as [number, number]),
        ]),
      }
      return
    }
    const { draws, ents, centre } = groupOrig.current
    // rigid in a local east/north frame, so the turn looks like a turn at any latitude
    const xScale = centre ? Math.cos((centre[1] * Math.PI) / 180) || 1e-6 : 1
    const turn = (c: LngLat): LngLat => (t.deg && centre
      ? rotateAround(c as [number, number], centre as [number, number], t.deg, { xScale, yUp: true }) as LngLat
      : c)
    /** What the write actually produced, for the release to record. ⚠️ The group bar was the one
     *  map gesture that emitted NOTHING at all: a marquee of eleven symbols dragged across the
     *  Lage left no trace in the audit stream, so the replay held them at their last snapshotted
     *  place — and once a member of the group could be sheet-anchored, its flip was reported
     *  (`onAnchorChange`) with no ground position to go with it. */
    const written: { doc: Doc | null } = { doc: null }
    setDocRaw((d) => (written.doc = {
      ...d,
      drawings: d.drawings.map((dr) => (ids.includes(dr.id) && draws[dr.id]
        ? { ...dr, coords: moveLineBody({ id: dr.id, points: draws[dr.id].map(turn), startAttachment: dr.startAttachment, endAttachment: dr.endAttachment }, [t.dLng, t.dLat]) }
        : dr)),
      entities: d.entities.map((e) => {
        const o = entIds.includes(e.id) ? ents[e.id] : undefined
        if (!o) return e
        const [lng, lat] = turn(o.coord)
        return {
          ...e,
          coord: [lng + t.dLng, lat + t.dLat] as LngLat,
          // a symbol's own bearing is geographic too, so it turns with the picture
          ...(t.deg && o.rotation !== undefined ? { rotation: turnedBy(o.rotation, t.deg) } : null),
          ...(t.deg && o.rotation2 !== undefined ? { rotation2: turnedBy(o.rotation2, t.deg) } : null),
        }
      }),
    // the boxed group IS what the hand moved — every member of it, and nothing else
    }), { movedIds: [...ids, ...entIds] })
    if (phase === 'end') {
      endDrag()
      // one event per member, on release only — the same grammar a single marker's drag has.
      // A release that moved NOTHING (tap on the handle, no drag) emits nothing: every plan-side
      // sibling guards this way, and n no-op rows are audit noise proportional to the selection.
      if (t.dLng || t.dLat || t.deg) {
        for (const e of written.doc?.entities ?? []) if (entIds.includes(e.id)) emit('entity.move', { id: e.id, coord: e.coord })
        for (const dr of written.doc?.drawings ?? []) if (ids.includes(dr.id)) emit('draw.edit', { id: dr.id, patch: { coords: dr.coords } })
      }
      groupOrig.current = { draws: {}, ents: {}, centre: null }
    }
  }
  // ⚠️ A trail no longer LOCKS its marker (18.09.2026, Karte/Plan parity). The record is
  // protected by outliving the marker instead: the removed marker's recorded positions move into
  // a ghost trail the incident owns (lib/truppTrails · reconcileGhostTrails, the effect below).
  const deleteGroup = async (ids: string[], entIds: string[]) => {
    if (tacticalLocked) return
    const ents = entIds.filter((id) => !liveIds.has(id))
    const affected = drawings.flatMap((dr) => ids.includes(dr.id) ? [] : (['start', 'end'] as const).flatMap((endpoint) => {
      const a = endpoint === 'start' ? dr.startAttachment : dr.endAttachment
      return a && ((a.target.kind === 'object' && ents.includes(a.target.id)) || (a.target.kind === 'line' && ids.includes(a.target.id))) ? [{ dr, endpoint, a }] : []
    }))
    if (affected.length) {
      const ok = await confirmDialog({ title: appConfig.copy.whiteboard.groupDeleteTitle, message: fillTemplate(appConfig.copy.drawingEditor.removeConnectedMessage, { n: affected.length }), confirmLabel: appConfig.copy.remove, cancelLabel: appConfig.copy.cancel, danger: true })
      if (!ok) return
    }
    // one patch per line, both ends in it — applied here and sent as ONE draw.edit (detachDrawings)
    const released = detachDrawings(drawings.filter((dr) => !ids.includes(dr.id)), (_, __, a) => {
      const object = a.target.kind === 'object' && ents.includes(a.target.id) ? entities.find((e) => e.id === a.target.id) : null
      const targetLine = a.target.kind === 'line' && ids.includes(a.target.id) ? drawings.find((x) => x.id === a.target.id) : null
      return object?.coord ?? (targetLine && a.target.kind === 'line' ? targetLine.coords[a.target.endpoint === 'start' ? 0 : targetLine.coords.length - 1] : null)
    })
    commit((d) => ({
      ...d,
      drawings: d.drawings.filter((dr) => !ids.includes(dr.id)).map((dr) => withDetach(dr, released)),
      entities: d.entities.filter((e) => !ents.includes(e.id)),
    }))
    ids.forEach((id) => emit('draw.delete', { id }))
    ents.forEach((id) => emit('entity.delete', { id }))
    released.forEach((patch, id) => emit('draw.edit', { id, patch: wireFreed(patch) }))
    setSelectedDrawIds([]); setSelectedEntityIds([])
    // ONE row, counted or named (lib/drawingEdit · removalRowText) — «… entfernt»
    log('close', removalRowText(drawings.filter((d) => ids.includes(d.id)), entities.filter((e) => ents.includes(e.id))),
      // …named by WHAT was removed, so two «Feuerwehr entfernt» seconds apart stay two rows
      undefined, undefined, undefined, { subjectId: ids[0] ?? ents[0] })
  }

  const focusDrawing = (id: string) => {
    const d = drawings.find((x) => x.id === id); if (!d?.coords[0]) return
    // A long line is never zoom-fitted. Its first real vertex is enough to make a useful part
    // visible, centred in the free workspace; the current drawing zoom convention stays intact.
    setSelectedDrawingId(id); setSelectedId(null); flyToMapVisible(d.coords[0], 17.8)
  }
  /** One movement path for a real Lage marker and for that marker's projection on a Modul.
   *  The gesture still writes the ONE source entity, so undo, routed Leitungen, audit and Verlauf
   *  cannot diverge depending on which picture the operator happened to drag. */
  const startEntityMove = (id: string) => { if (!tacticalLocked && !liveIds.has(id)) beginDrag() }
  const streamEntityMove = (id: string, c: LngLat) => {
    if (tacticalLocked) return
    if (liveIds.has(id)) { setVehicleOverrides((m) => ({ ...m, [id]: { ...m[id], coord: c } })); return }
    setDocRaw((d) => ({
      ...d,
      // an angedockte Gefahrentafel rides along mid-drag too (lib/docking), keeping the
      // offset the operator chose — not just snapping into place on release
      entities: carryDocked(d.entities, id, d.entities.find((e) => e.id === id)?.coord ?? c, c)
        .map((e) => (e.id === id ? { ...e, coord: c } : e)),
      drawings: d.drawings.map((dr) => {
        if (dr.kind !== 'line') return dr
        let next = dr
        for (const endpoint of ['start', 'end'] as const) {
          const a = next[endpoint === 'start' ? 'startAttachment' : 'endAttachment']
          if (a?.target.kind === 'object' && a.target.id === id && a.routing === 'trace') next = { ...next, coords: applyRouting(next.coords, endpoint, c, 'trace', 0.000008) }
        }
        return next
      }),
    // ⚠️ ONE id: the write carries the docked placard and re-routes the attached hoses, and
    // none of those were placed by the hand that dragged this (lib/tacticalObjects · movedIds).
    }), { movedIds: [id] })
  }
  const finishEntityMove = (id: string, c: LngLat, join?: { lineId: string; endpoint: LineEndpoint } | null, dock?: { hostId: string } | null) => {
    if (tacticalLocked) return
    if (liveIds.has(id)) setVehicleOverrides((m) => ({ ...m, [id]: { ...m[id], coord: c } }))
    else {
      // Andocken (lib/docking, Feldtest Manuel 07.09.): a Gefahrentafel dropped beside a
      // dockable object becomes its placard; dropped in the open, an existing bond lets go.
      // Decided here, once, on release — never re-resolved — and the whole answer folds into
      // the same undo step as the move itself. Since 15.09. a Trupp marker docks the same way:
      // «bei «Hydrant»» on its card, and it rides along when the symbol is moved.
      const ent = doc.entities.find((x) => x.id === id)
      const map = mapRef.current
      let dockPatch: { dockedTo: string | undefined } | null = null
      let dockHost: Entity | undefined
      if (isDockable(ent) && map) {
        const others = doc.entities.filter((e) => e.id !== id)
        const near = () => nearestDockHost(c, others, (p) => map.project(p), dockRadiusFor(ent)) ?? undefined
        // a Trupp marker docks only through a CLOSED ring (useTruppMarkerAim · trackDockAim); with the ring
        // still open the drop keeps an existing bond while it is in reach and lets go beyond it
        dockHost = dock === undefined ? near()
          : dock ? others.find((e) => e.id === dock.hostId)
          : (ent?.dockedTo && near()?.id === ent.dockedTo ? near() : undefined)
        if ((dockHost?.id ?? undefined) !== ent?.dockedTo) dockPatch = { dockedTo: dockHost?.id }
      }
      // Ein Trupp auf dem Leitungsende (15.09.): dropping a Trupp's marker on the FREE end of a
      // hose joins the two, the same link snapping the hose onto the marker makes — the picture
      // is the pick, from whichever side the operator happens to work.
      // ⚠️ The aim is NOT re-computed here. The Karte drew the blue ring while the marker
      // travelled and it is the one that knows whether the ring actually CLOSED — «not armed =
      // nothing attaches, not even on release» (useTruppMarkerAim · trackTeamJoin). Guessing a second time
      // at the drop point is how this coupled hoses nobody had aimed at. It is still folded into
      // the move's own undo step, as one gesture.
      // ⚠️ …and ONE Trupp per Leitung (lib/truppLines · lineTakesTrupp, 15.09.): a hose that
      // already has a crew takes no second one, not even the same one at its other end. The ring
      // is not offered for such an end in the first place (MapView · freeHoseEnds), so this is
      // the floor under a stale aim — the map never silently replaces a crew, which is the
      // Atemschutz board's job and asks first.
      const hoseJoin = ent?.kind === 'team' && ent.truppId
        && (!join || lineTakesTrupp(doc.drawings.find((dr) => dr.id === join.lineId) ?? { id: join.lineId }, trupps))
        ? (join ?? null) : null
      const hoseKey = hoseJoin?.endpoint === 'start' ? 'startAttachment' : 'endAttachment'
      // the marker's own coupling, written exactly as the endpoint magnet writes one (routed
      // «Direkt» by default — lib/lineAttachments · DEFAULT_OBJECT_ROUTING)
      const hoseAttachment: LineAttachment = objectAttachment(id)
      // a moved team marker re-stamps its «last moved» time; it does NOT breadcrumb
      setDocRaw((d) => ({
        ...d,
        entities: carryDocked(d.entities, id, d.entities.find((e) => e.id === id)?.coord ?? c, c)
          .map((e) => (e.id === id ? { ...e, coord: c, ...(dockPatch ?? {}), ...(e.kind === 'team' ? { t: formatTime(new Date(serverNow())) } : {}) } : e)),
        drawings: hoseJoin
          ? d.drawings.map((dr) => (dr.id === hoseJoin.lineId ? { ...dr, [hoseKey]: hoseAttachment } : dr))
          : d.drawings,
      }), { movedIds: [id] })
      endDrag()
      if (hoseJoin && ent?.truppId) {
        emit('draw.attach', { id: hoseJoin.lineId, endpoint: hoseJoin.endpoint, attachment: hoseAttachment })
        // …and the link itself, unless this hose is already anchored to this very Trupp — nudging
        // the marker beside its own Leitung is not a new fact, and every link writes a Verlauf row
        if (doc.drawings.find((dr) => dr.id === hoseJoin.lineId)?.truppId !== ent.truppId) linkTruppLine(ent.truppId, hoseJoin.lineId)
      }
      if (dockPatch) {
        const name = ent?.label || appConfig.copy.entities.fallbackObjectName
        const hostName = (dockHost ?? doc.entities.find((e) => e.id === ent?.dockedTo))?.label
          || appConfig.copy.entities.fallbackObjectName
        const L = appConfig.copy.log
        log('select', fillTemplate(isPlacard(ent) ? (dockHost ? L.placardDocked : L.placardUndocked) : (dockHost ? L.teamDocked : L.teamUndocked),
          { name, host: hostName }), isPlacard(ent) ? 'symbol' : 'team', undefined, id)
        emit('entity.edit', { id, patch: dockPatch })
      }
      // …and the placards this host carried along re-emit like the trace-routed lines below
      for (const e of doc.entities) {
        if (e.dockedTo === id && e.coord && ent?.coord) {
          emit('entity.move', { id: e.id, coord: [e.coord[0] + c[0] - ent.coord[0], e.coord[1] + c[1] - ent.coord[1]] })
        }
      }
    }
    log('select', fillTemplate(appConfig.copy.log.objectMoved, { name: entities.find((x) => x.id === id)?.label ?? appConfig.copy.entities.fallbackObjectName }), 'symbol', undefined, id)
    emit(liveIds.has(id) ? 'entity.edit' : 'entity.move', { id, coord: c })
    drawings.filter((d) => [d.startAttachment, d.endAttachment].some((a) => a?.target.kind === 'object' && a.target.id === id && a.routing === 'trace'))
      .forEach((d) => emit('draw.edit', { id: d.id, patch: { coords: d.coords } }))
  }
  /**
   * «Lösen» on an angedockter Trupp, from the HOST symbol's panel (15.09.2026).
   *
   * The exact inverse of the drop that made the bond, and it reports itself the same way that
   * drop does — the `teamUndocked` Verlauf row — plus the confirm-with-undo toast the marker's
   * own «Lösen» wears: the bond is a document write, but a bond broken by a tap on a list of
   * rows deserves the same one-shot way back as one broken by a drag.
   * The marker keeps its coordinate and simply stands on it again (lib/docking · dockSlotOffset:
   * only the RENDERED position was ever snapped to the host's corner).
   */
  // «Lösen» — a Trupp marker off its host, or a Gefahrentafel off its Fahrzeug. Both write the
  // row a drag-release already writes (3am test r3, 25.09.2026: the placard editor's «Lösen» wrote
  // none — the record said «angedockt» and never that the bond ended).
  const undockTeam = (entityId: string) => {
    const ent = doc.entities.find((e) => e.id === entityId)
    const hostId = ent?.dockedTo
    if (!ent || !hostId) return
    const L = appConfig.copy.log
    const placard = isPlacard(ent)
    const line = fillTemplate(placard ? L.placardUndocked : L.teamUndocked, {
      name: ent.label || appConfig.copy.entities.fallbackObjectName,
      host: doc.entities.find((e) => e.id === hostId)?.label || appConfig.copy.entities.fallbackObjectName,
    })
    patchEntity(entityId, { dockedTo: undefined })
    log('select', line, placard ? 'symbol' : 'team', undefined, entityId)
    // …and the toast's way back says so too: the bond is restored, and the record has to hear it.
    // It re-docks only onto a host that still stands, and only a marker that is still loose — by
    // the time it is tapped the host may have been deleted, or the marker docked elsewhere
    // (CodeRabbit on #232); `objectsRef` is the store as it is NOW, not at the release. The guard
    // names the HOST too: it docks at wherever the host stands, and a host another device has
    // moved since is not where this bond was broken
    undoToast(line, () => {
      const now = objectsRef.current
      const hostStands = now.some((o) => o.entity?.id === hostId)
      const stillLoose = now.find((o) => o.entity?.id === entityId)?.entity?.dockedTo == null
      if (!hostStands || !stillLoose) return
      patchEntity(entityId, { dockedTo: hostId })
      log('select', fillTemplate(placard ? L.placardDocked : L.teamDocked, {
        name: ent.label || appConfig.copy.entities.fallbackObjectName,
        host: doc.entities.find((e) => e.id === hostId)?.label || appConfig.copy.entities.fallbackObjectName,
      }), placard ? 'symbol' : 'team', undefined, entityId)
    }, [recordKey('objects', entityId), recordKey('objects', hostId)])
  }
  /**
   * A live Fahrzeug was dragged on a Modul — «hier ist es wirklich».
   *
   * Deliberately the SAME three calls the Karte's own marker drag makes, in the same order: the
   * gesture writes the one override, so undo, trace-routed Leitungen, the audit event and the
   * Verlauf row cannot diverge depending on which picture the operator happened to have in front
   * of them. `startEntityMove`'s doc has described this as its second call site since the
   * Georeferenz landed; until 27.08. nothing actually called it that way, so a twin simply
   * ignored every drag and the sheet gave no reason why.
   *
   * A LIVE vehicle behaves exactly as it does on the Karte: `finishEntityMove` writes a position
   * override, which is «Festhalten» — the vehicle stops following the feed until «GPS» hands it
   * back. Dragging one here is the same statement as dragging it there.
   */
  /** A live Fahrzeug dropped on a sheet — the same writers the Karte's own marker drag uses, so
   *  it lands as the same held-in-place override and nothing about it depends on which surface
   *  the finger was on. */
  const moveLiveOnSheet = (entityId: string, coord: LngLat, phase: 'start' | 'move' | 'end') => {
    if (tacticalLocked) return
    if (phase === 'start') startEntityMove(entityId)
    else if (phase === 'move') streamEntityMove(entityId, coord)
    else finishEntityMove(entityId, coord)
  }
  /** Every Trupp standing somewhere on this Einsatz — Lage markers AND plan chips, Atemschutz
   *  or not (lib/placedTrupps). Feeds the rail's count and the finder's list. */
  const placed = useMemo(() => placedTrupps(objects, planDocs, trupps), [objects, planDocs, trupps])
  /**
   * Go to the picked Trupp. ⚠️ The SAME two jumps «auf Plan zeigen» makes from the Atemschutz
   * card (useTruppActions · focusTruppOnPlan) — a second way to arrive at a marker would be a
   * second set of rules about what «zeigen» leaves behind: the map jump selects the marker, the
   * plan jump opens its storey and points at the chip.
   */
  const goToTrupp = (t: PlacedTrupp) => {
    setPanel(null)
    if (t.target.kind === 'map') { setMode('map'); focusEntity(t.target.entityId); return }
    setMode('plans'); setActivePlanId(t.target.planId)
    setPlanFocus({ x: t.target.x, y: t.target.y, floor: t.target.floor, annoId: t.target.annoId, nonce: Date.now() })
  }
  const deleteEntity = async (id: string) => {
    if (tacticalLocked) return false
    const ent = entities.find((e) => e.id === id)
    const connected = drawings.filter((d) => [d.startAttachment, d.endAttachment].some((a) => a?.target.kind === 'object' && a.target.id === id))
    // Written notes and any indirectly detached lines ask once before the structural change.
    if ((ent?.kind === 'note' && (ent.label ?? '').trim()) || connected.length) {
      const ok = await confirmDialog({
        title: connected.length ? fillTemplate(appConfig.copy.drawingEditor.removeConnectedTitle, { name: ent?.label ?? appConfig.copy.entities.fallbackObjectName }) : appConfig.copy.notes.deleteTitle,
        message: connected.length ? fillTemplate(appConfig.copy.drawingEditor.removeConnectedMessage, { n: connected.length }) : appConfig.copy.notes.deleteMsg,
        confirmLabel: appConfig.copy.remove, cancelLabel: appConfig.copy.cancel, danger: true,
      })
      if (!ok) return false
    }
    // every Leitung end on the symbol lets go where it stood, so the line does not jump — one patch
    // per line, applied here and sent as ONE draw.edit below (lib/lineAttachments · detachDrawings)
    const released = ent ? detachDrawings(connected, (_, __, a) => (a.target.kind === 'object' && a.target.id === ent.id ? ent.coord : null)) : new Map<string, DetachPatch>()
    commit((d) => ({
      ...d,
      // …and a deleted host releases its angedockte Gefahrentafel (the placard stays — it is
      // still a record of the substance — it just stops following a ghost)
      entities: d.entities.filter((e) => e.id !== id).map((e) => (e.dockedTo === id ? { ...e, dockedTo: undefined } : e)),
      drawings: d.drawings.map((dr) => withDetach(dr, released)),
    }))
    if (selectedId === id) setSelectedId(null)
    if (editNoteId === id) setEditNoteId(null)
    // ⚠️ An EMPTY Notiz writes no row. Its label is `''`, not undefined, so `??` never reached the
    // fallback name and the Verlauf printed a bare «gelöscht» — a row that names nothing, about a
    // note that said nothing. The same predicate already decides that this deletion asks nothing
    // (see the confirm above): a note with no text is a placement being taken back, not a record.
    // Rows already written stay: the journal is append-only, this only stops writing a new one.
    if (!(ent?.kind === 'note' && !(ent.label ?? '').trim())) {
      log('close', fillTemplate(appConfig.copy.log.objectDeleted, { name: ent?.label ?? appConfig.copy.entities.fallbackObjectName }),
        undefined, undefined, undefined, { subjectId: id })
    }
    emit('entity.delete', { id })
    released.forEach((patch, lineId) => emit('draw.edit', { id: lineId, patch: wireFreed(patch) }))
    return true
  }
  /**
   * «Gelöscht / erledigt» on the Karte (review item 21b, lib/objectDone). A PROP edit — one undo
   * step through `commit`, the `entity.edit` audit event, and the write-through onto the anno when
   * the symbol stands on a sheet (lib/tacticalObjects) — plus its OWN Verlauf row, written here
   * and nowhere else: the ↶ writes only its own «… rückgängig gemacht» (the timeline's row).
   * ⚠️ The audit patch says `done: null` for «Wieder aktiv»: JSON drops an `undefined`, and the
   * replay would then fold an empty patch and keep the symbol grey (lib/replay · entity.edit).
   */
  const setEntityDone = (ent: Entity, on: boolean) => {
    if (tacticalLocked) return
    const act = doneAct(ent, on, {
      atIso: serverNowIso(), by: user?.display_name,
      place: donePlace(ent.floorFrom ?? ent.floor, ent.floorTo),
      // the sheet that draws it natively, if any — its view gets the event too (lib/objectDone)
      sheetPlanId: objectsRef.current.find((o) => o.id === ent.id)?.sheet?.planId,
      cat: sym.symbols.find((x) => x.name === ent.symbol)?.cat,
    })
    if (!act) return
    stepLabelRef.current = act.text // the ↶ names the act, not «Änderung auf der Karte»
    commit((d) => ({ ...d, entities: d.entities.map((e) => (e.id === ent.id ? { ...e, done: act.done } : e)) }))
    for (const [op, payload] of act.events) emit(op, payload)
    log(on ? 'check' : 'undo', act.text, 'symbol', undefined, ent.id)
  }
  return { deleteGroup, deleteEntity, placed, goToModule, finishSelection, onMapClick, startEntityMove, streamEntityMove, finishEntityMove, onMarquee, transformGroup, goToTrupp, viewsApi, toggleViews, selected, undockTeam, setEntityDone, focusDrawing, noteEntity, pick, pickShape, moveLiveOnSheet }
}
