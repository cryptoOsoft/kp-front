// The Karte's detail panels (the `.ctx` slot right of the tool rail, a bottom sheet on a phone):
// the shape editor, the symbol's ContextPanel, the note panel and the DrawEditor. Split out of
// IncidentWorkspace (E1, 09.10.2026) verbatim. Which one shows is decided by the workspace's
// selection and `detailSlotFree` (the slot holds exactly ONE thing — see its note there).

import type { Dispatch, SetStateAction, RefObject } from 'react'
import { ContextPanel } from '../components/ContextPanel'
import { DrawEditor } from '../components/DrawEditor'
import { ShapeEditor } from '../components/ShapeEditor'
import { appConfig } from '../config/appConfig'
import { connectedLineLabel } from '../lib/connectedLines'
import { fillTemplate, formatSymbolName, formatTime } from '../lib/format'
import { polygonAreaM2, bboxSizeM, pathLengthM, haversineM } from '../lib/geo'
import { type GpsEnd, hasTraced, freshBefore, gpsLineName, fmtAway, onSiteAnchor, onSiteKnown } from '../lib/gpsReturn'
import { wandBlock, wandBlockHint } from '../lib/grundriss'
import { lineLabel } from '../lib/lineDecor'
import { autoNoteWPx } from '../lib/notes'
import { canBeDone, offersDone, doneOf } from '../lib/objectDone'
import { withResolvedPhotos } from '../lib/photoGeo'
import type { AssignableRole } from '../lib/roleAssignment'
import { SHAPE_MIN_M, SHAPE_MAX_M, SHAPE_DEFS, rotationRun, ROTATION_MAX_M, rotationBox, ROTATION_W_M, shapeAspect } from '../lib/shapes'
import { readingPatch, symbolControls, symbolTitleOptions, symbolFieldOptions, symbolPresetFieldKeys } from '../lib/symbols'
import { truppForLine, truppIsOut } from '../lib/truppLines'
import type { useSymbols } from '../lib/useSymbols'
import type { VehicleOverrides } from '../lib/useVehicleLayer'
import { vehicleSymbolSvg } from '../lib/useVehiclePositions'
import type { TacticalObject } from '../lib/tacticalObjects'
import type { Doc } from '../lib/workspace'
import type { Entity, LngLat, TimelineEvent, Trupp, Drawing, NoteSize, Person, LineEndpoint, LineAttachment, LayerId, CaptionMode, MapTool } from '../types'
import type { WorkspaceMode } from './types'

export interface MapDetailPanelsProps {
  detailSlotFree: boolean
  tacticalLocked: boolean
  tool: MapTool
  selected: Entity | null
  commit: (updater: (d: Doc) => Doc, opts?: { gesture?: boolean }) => void
  setSelectedId: Dispatch<SetStateAction<string | null>>
  flyToMapVisible: (center: LngLat, zoom: number) => void
  deleteEntity: (id: string) => Promise<boolean>
  timeline: TimelineEvent[]
  sym: ReturnType<typeof useSymbols>
  entityTypedAt: RefObject<Map<string, number>>
  titleLiveRef: RefObject<boolean>
  beginDrag: () => void
  setDocRaw: (update: SetStateAction<Doc>, opts?: { gesture?: boolean; movedIds?: readonly string[] }) => void
  endDrag: () => void
  emit: (op_type: string, payload?: Record<string, unknown>, opts?: { observed?: string }) => void
  patchEntity: (id: string, patch: Partial<Entity>) => void
  linkRosterFields: (prev: Entity, fields: Record<string, string>, opts?: { force?: boolean }) => void
  createCircle: (center: LngLat, radiusM: number) => void
  doc: Doc
  undockTeam: (entityId: string) => void
  effTrupps: Trupp[]
  symbolCaptions: CaptionMode
  rosterNames: string[]
  rosterRank: { [k: string]: string | undefined }
  personStatus: (name: string) => { label: string; tone?: 'warn' | 'muted' | 'info' } | undefined
  rosterFieldHints: (e: Entity | undefined) => Record<string, string | undefined> | undefined
  setEntityDone: (ent: Entity, on: boolean) => void
  vehicleOverrides: VehicleOverrides
  canEditIncident: boolean
  readOnly: boolean
  stopPersonSharing: (entityId: string) => Promise<void>
  setVehicleOverrides: Dispatch<SetStateAction<VehicleOverrides>>
  log: (icon: string, text: string, kind?: TimelineEvent['kind'], audioUrl?: string, entityId?: string, opts?: { rowId?: string; subjectId?: string }) => void
  assignTypedName: (name: string, role: AssignableRole, note?: string) => string | undefined
  drawings: Drawing[]
  entities: Entity[]
  focusDrawing: (id: string) => void
  noteEntity: Entity | null
  notePlacedId: string | null
  setNotePanelId: Dispatch<SetStateAction<string | null>>
  noteTextLive: (id: string, v: string) => void
  setNoteDefaults: Dispatch<SetStateAction<{ size: NoteSize; plain: boolean; color: string }>>
  selectedDrawing: Drawing | null
  patchDrawing: (patch: Partial<Drawing>) => void
  selectedDrawingId: string | null
  patchDrawingLabelLive: (id: string, label: string) => void
  commitDrawingLabel: (id: string, label: string) => void
  changeMapEnding: (ending: 'none' | 'arrow' | 'arrowStop' | 'teilstueck', drawing?: Drawing | null) => Promise<void>
  reverseDrawing: (id: string) => void
  /** «Art: Linie | Wand» (useMapDrawing · setDrawingWallRole) */
  setDrawingWallRole: (id: string, wand: boolean) => void
  /** the tactical objects – a line drawn on a Gebäude stack is asked through its sheet body
   *  whether it climbs storeys (lib/grundriss · wandBlock) */
  objects: readonly TacticalObject[]
  syncLineNoToTrupp: (lineId: string, lineNo: number | undefined) => void
  pickablePersonnel: Person[]
  linkTruppLine: (truppId: string, lineId: string) => boolean
  unlinkLine: (lineId: string) => void
  setSelectedDrawingId: Dispatch<SetStateAction<string | null>>
  setMode: Dispatch<SetStateAction<WorkspaceMode>>
  setPanel: Dispatch<SetStateAction<'layers' | null>>
  setGpsRouting: (drawing: Drawing, endpoint: 'start' | 'end', routing: 'direct' | 'trace') => void
  revertAll: (ends: readonly GpsEnd[]) => void
  gpsEndOf: (drawing: Drawing, endpoint: 'start' | 'end') => GpsEnd
  releaseHere: (drawing: Drawing, endpoint: 'start' | 'end') => void
  releaseOnSite: (ends: readonly GpsEnd[]) => void
  setDrawingAttachment: (id: string, endpoint: LineEndpoint, attachment: LineAttachment | undefined, fallback: LngLat) => void
  focusEntity: (id: string) => void
  isVisible: (id: LayerId) => boolean
  toggleLayer: (id: LayerId) => void
  deleteDrawing: (id: string) => Promise<void>
}

export function MapDetailPanels({
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
}: MapDetailPanelsProps) {
  // a Rechteck's figures, for its panel — editable or read-only alike
  const shapeFigures = selected?.kind === 'shape' && selected.shape === 'square' ? (() => {
    // ⚠️ The box on the GROUND, from the two numbers the shape is stored with: `sizeM` is
    // its width and `sizeM × aspect` its height (types · Entity). No polygon to integrate
    // — a Rechteck is its own rectangle — so this is the same answer `polygonAreaM2` would
    // give for the outline, arrived at directly.
    const wM = selected.sizeM ?? SHAPE_DEFS.square.defaultSizeM
    const hM = wM * shapeAspect('square', selected.aspect)
    // ⚠️ Unrotated: `sizeM` is the box's own width and height. A rotated Rechteck occupies a
    // bigger axis-aligned box, but «wie gross ist diese Fläche» is asking about the shape,
    // not about the room it needs — which is the opposite call from a drawn Fläche, whose
    // outline has no width of its own to report.
    return { areaM2: wM * hM, perimeterM: 2 * (wM + hM), boxM: { widthM: wM, heightM: hM } }
  })() : {}
  /** a line's own anno on the sheet it was drawn on, when it was drawn on one */
  const sheetAnnoOf = (id: string) => objects.find((o) => o.id === id)?.sheet?.anno
  return (
    <>
      {/* `tool === 'select'`, matching the Plan (Whiteboard gates all four of its editors on
          `tool === 'pan'`): a detail editor belongs to Auswahl and nothing else. clearMapUi already
          drops the selection on every tool pick, so this is the backstop for any path that sets a
          tool without going through pick(). */}
      {detailSlotFree && !tacticalLocked && tool === 'select' && selected && selected.kind === 'shape' && (
        <ShapeEditor
          key={selected.id}
          entity={selected}
          onColor={(c) => commit((d) => ({ ...d, entities: d.entities.map((e) => (e.id === selected.id ? { ...e, color: c } : e)) }))}
          // ⚠️ The SAME ceiling the corner/axis drag clamps to (lib/shapes · SHAPE_MAX_M). It used
          // to be a local 800 while the drag stopped at 500, so the ± button grew a Rechteck to a
          // size the grip then refused to touch.
          onScale={(f) => commit((d) => ({ ...d, entities: d.entities.map((e) => (e.id === selected.id ? { ...e, sizeM: Math.max(SHAPE_MIN_M, Math.min(SHAPE_MAX_M[e.shape ?? 'square'], (e.sizeM ?? SHAPE_DEFS[e.shape ?? 'square'].defaultSizeM) * f)) } : e)) }))}
          // A Rotation has one size and it is the RUN between its two ends; the loop's width
          // follows from it. So the buttons scale the run and the box is rebuilt from it — the
          // same maths the two end grips use, just in fixed steps for a finger that would rather
          // press twice than drag (lib/shapes · rotationBox).
          onScaleLength={(f) => commit((d) => ({ ...d, entities: d.entities.map((e) => {
            if (e.id !== selected.id) return e
            const run = rotationRun(e.sizeM ?? SHAPE_DEFS.rotation.defaultSizeM, e.aspect)
            const next = Math.max(SHAPE_MIN_M, Math.min(ROTATION_MAX_M, run * f))
            const box = rotationBox(next, ROTATION_W_M)
            return { ...e, sizeM: Math.round(box.size), aspect: Math.round(box.aspect * 1000) / 1000 }
          }) }))}
          onStop={(v) => commit((d) => ({ ...d, entities: d.entities.map((e) => (e.id === selected.id ? { ...e, stop: v } : e)) }))}
          onCarrier={(v) => commit((d) => ({ ...d, entities: d.entities.map((e) => (e.id === selected.id ? { ...e, carrier: v } : e)) }))}
          onReverse={() => commit((d) => ({ ...d, entities: d.entities.map((e) => (e.id === selected.id ? { ...e, reverse: !e.reverse || undefined } : e)) }))}
          onStrokeW={(w) => commit((d) => ({ ...d, entities: d.entities.map((e) => (e.id === selected.id ? { ...e, strokeW: w } : e)) }))}
          onFill={(fillOpacity, hatch) => commit((d) => ({ ...d, entities: d.entities.map((e) => (e.id === selected.id ? { ...e, fillOpacity, hatch: hatch || undefined } : e)) }))}
          onCorners={(sharp) => commit((d) => ({ ...d, entities: d.entities.map((e) => (e.id === selected.id ? { ...e, sharpCorners: sharp || undefined } : e)) }))}
          // locking DESELECTS (same as a drawn Fläche, onToggleLock below): the ink goes
          // click-through and the LockChip becomes the only door back in
          onToggleLock={() => { commit((d) => ({ ...d, entities: d.entities.map((e) => (e.id === selected.id ? { ...e, locked: !e.locked || undefined } : e)) })); if (!selected.locked) setSelectedId(null) }}
          locked={selected.locked}
          {...shapeFigures}
          onCenter={() => flyToMapVisible(selected.coord, 18.4)}
          onDelete={() => deleteEntity(selected.id)}
          onClose={() => setSelectedId(null)}
        />
      )}
      {/* …and a locked session (viewer, el, Führungsansicht, replay) gets the same panel to READ:
          what the Form is, its figures, «Zentrieren» — the DrawEditor's locked mode (RBAC audit
          22.10.2026; it opened nothing at all before) */}
      {detailSlotFree && tacticalLocked && tool === 'select' && selected && selected.kind === 'shape' && (
        <ShapeEditor
          key={selected.id}
          readOnly
          entity={selected}
          {...shapeFigures}
          onCenter={() => flyToMapVisible(selected.coord, 18.4)}
          onClose={() => setSelectedId(null)}
        />
      )}

      {/* rendered even when tactical editing is locked (viewer / EL view — NOT phones, where
          the .ctx overlay is CSS-hidden): tapping a symbol always shows its details; the
          forced readOnly strips every edit affordance inside the panel. */}
      {detailSlotFree && tool === 'select' && selected && selected.kind !== 'shape' && selected.kind !== 'note' && selected.kind !== 'team' && (
        <ContextPanel
          key={selected.id}
          entity={selected.kind === 'photo' ? withResolvedPhotos([selected], timeline)[0] : selected}
          readOnly={selected.live || tacticalLocked}
          svg={selected.symbolSvg ?? (selected.symbol === appConfig.symbols.vehicleName ? vehicleSymbolSvg(selected.label ?? '', selected.rotation ?? 0) : selected.symbol ? sym.byName[selected.symbol] : undefined)}
          onClose={() => setSelectedId(null)}
          onCenter={() => flyToMapVisible(selected.coord, 18.4)}
          onTitleLive={(v) => {
            // stream into the doc so the note-pill / label updates live, but silently —
            // snapshot once for undo, no per-keystroke audit event
            entityTypedAt.current.set(selected.id, Date.now())
            if (!titleLiveRef.current) { titleLiveRef.current = true; beginDrag() }
            setDocRaw((d) => ({ ...d, entities: d.entities.map((e) => (e.id === selected.id ? { ...e, label: v } : e)) }))
          }}
          onTitle={(v) => {
            // blur: fold the whole live edit into one undo step + a single audit event
            if (titleLiveRef.current) { titleLiveRef.current = false; endDrag(); emit('entity.edit', { id: selected.id, patch: { label: v } }) }
            else patchEntity(selected.id, { label: v })
            // ⚠️ …and the Fahrer's Bemerkung is «Fahrer {Label}», so naming the vehicle AFTER
            // naming its driver has to reach that person. A generic Fahrzeug is placed unlabelled
            // and gets its Bezeichnung typed later, which makes «Fahrer» with nothing after it
            // the NORMAL first state rather than an edge case.
            linkRosterFields({ ...selected, label: v }, selected.fields ?? {}, { force: true })
          }}
          // Symbol→Mittel: only where the station mapped at least one material to a symbol.
          // No switch to find — a Wehr that has not configured it never gets an offer.
          onFields={(fields) => { patchEntity(selected.id, { fields, ...readingPatch(selected, fields) }); linkRosterFields(selected, fields) }}
          onNotes={!selected.live ? (v) => patchEntity(selected.id, { notes: v || undefined }) : undefined}
          onFloor={selected.kind === 'symbol' && !selected.live ? (f) => patchEntity(selected.id, { floor: f ?? undefined }) : undefined}
          onFloorFrom={selected.kind === 'symbol' && !selected.live ? (f) => patchEntity(selected.id, { floor: undefined, floorFrom: f ?? undefined, floorTo: selected.floorTo ?? selected.floor }) : undefined}
          onFloorTo={selected.kind === 'symbol' && !selected.live ? (f) => patchEntity(selected.id, { floor: undefined, floorFrom: selected.floorFrom ?? selected.floor, floorTo: f ?? undefined }) : undefined}
          onSpread={selected.kind === 'symbol' && !selected.live ? (s) => patchEntity(selected.id, { spread: s ?? undefined }) : undefined}
          onCount={selected.kind === 'symbol' && !selected.live ? (n) => patchEntity(selected.id, { count: n && n > 1 ? n : undefined }) : undefined}
          onRotate={selected.kind === 'symbol' && !selected.live ? (deg) => patchEntity(selected.id, { rotation: deg ?? undefined }) : undefined}
          // Karte only: the Schutzabstand rings are metric geometry, which the Plan cannot draw
          // (lib/ergRings). 'small' is the default and is stored as absent, so a fresh placard
          // syncs the same in both directions.
          onErgRings={selected.kind === 'symbol' && !selected.live ? (mode) => patchEntity(selected.id, { ergRings: mode === 'small' ? undefined : mode }) : undefined}
          ergCoord={selected.coord}
          // «Übernehmen» (Feldtest 07.09.): the ERG distance becomes a REAL Absperrkreis around
          // the symbol — createCircle selects it, so the operator lands on the editable cordon.
          // The derived preview rings go quiet for this placard: the real circle replaces them,
          // and two red rings at the same radius would read as a rendering bug.
          onAdoptRadius={selected.kind === 'symbol' && !selected.live && !tacticalLocked ? (radiusM) => {
            createCircle(selected.coord, radiusM)
            patchEntity(selected.id, { ergRings: 'off' })
          } : undefined}
          // Angedockte Gefahrentafel (lib/docking): name the host, offer the release — the drop
          // gesture that made the bond draws nothing, so this row is where it becomes visible.
          dockedToLabel={selected.dockedTo ? doc.entities.find((e) => e.id === selected.dockedTo)?.label || appConfig.copy.entities.fallbackObjectName : undefined}
          onUndock={selected.dockedTo && !tacticalLocked ? () => undockTeam(selected.id) : undefined}
          // …and the same bond from the HOST's side: the Trupps standing on THIS symbol, one row
          // each, worded «Trupp 4 · bei «Hydrant»» so a row names both sides before «Lösen»
          // separates them — the mirror of the marker's own join slot (components/TwinTeamPill).
          dockedTeams={doc.entities.flatMap((e) => {
            if (e.kind !== 'team' || e.dockedTo !== selected.id) return []
            const no = effTrupps.find((t) => t.id === e.truppId)?.no
            return [{
              id: e.id,
              label: fillTemplate(appConfig.copy.atemschutz.dockLabel, {
                who: no != null
                  ? fillTemplate(appConfig.copy.atemschutz.truppTerm, { name: String(no) })
                  : e.label || appConfig.copy.entities.fallbackObjectName,
                host: selected.label || appConfig.copy.entities.fallbackObjectName,
              }),
              onRelease: tacticalLocked ? undefined : () => undockTeam(e.id),
            }]
          })}
          onRotate2={selected.kind === 'symbol' && !selected.live ? (deg) => patchEntity(selected.id, { rotation2: deg ?? undefined }) : undefined}
          onCaption={selected.kind === 'symbol' && !selected.live ? (m) => patchEntity(selected.id, { caption: m }) : undefined}
          captionDefault={symbolCaptions ?? 'auto'}
          onAirflow={selected.kind === 'symbol' && !selected.live ? (extract) => patchEntity(selected.id, { extract: extract || undefined }) : undefined}
          controls={symbolControls(selected.symbol, sym.symbols.find((x) => x.name === selected.symbol)?.cat)}
          titleOptions={selected.kind === 'symbol' && !selected.live ? symbolTitleOptions(selected.symbol, sym.symbols.find((x) => x.name === selected.symbol)?.cat) : undefined}
          fieldOptions={selected.kind === 'symbol' && !selected.live ? symbolFieldOptions(selected.symbol, sym.symbols.find((x) => x.name === selected.symbol)?.cat, rosterNames) : undefined}
          rosterRank={rosterRank}
          personStatus={personStatus}
          fieldHints={rosterFieldHints(selected)}
          protectedKeys={selected.kind === 'symbol' ? new Set(symbolPresetFieldKeys(selected.symbol, sym.symbols.find((x) => x.name === selected.symbol)?.cat)) : undefined}
          onDelete={() => deleteEntity(selected.id)}
          // «Gelöscht / erledigt» only where being OVER means something — a Feuer, a Rauch, a
          // Gefahr — never a Fahrzeug (lib/objectDone · offersDone); an older `done` elsewhere may
          // still be reopened, so nothing recorded is stuck grey
          onDone={canBeDone(selected.kind) && !selected.live && !tacticalLocked
            && (offersDone(selected.symbol, sym.symbols.find((x) => x.name === selected.symbol)?.cat) || !!doneOf(selected))
            ? (on) => setEntityDone(selected, on) : undefined}
          hasOverride={vehicleOverrides[selected.id] != null}
          // Vehicles only. «GPS» undoes an operator's drag/rotate of a live symbol — a person
          // dot has neither (both are blocked in MapMarkers), so the button sat there
          // permanently disabled, a dead control inviting «what does this do?».
          // A crew member's own dot: the command post may clear it (editor only). Never offered
          // for a vehicle — that position comes from the fleet feed, not from a person.
          onStopSharing={selected.live && selected.kind === 'person' && canEditIncident && !readOnly
            ? () => { void stopPersonSharing(selected.id) }
            : undefined}
          // not for a locked session: the el's record slice and a viewer never carry the
          // override (the next hydrate would put it back), and the Führungsansicht is hands-off
          // (RBAC audit 22.10.2026)
          onResetGps={selected.live && selected.kind !== 'person' && !tacticalLocked
            ? () => setVehicleOverrides((m) => { const { [selected.id]: _drop, ...rest } = m; return rest })
            : undefined}
          // «Hier festhalten»: the Kroki is printed hours later, and a vehicle that has since
          // driven home takes its symbol with it — the picture then shows no TLF at an Einsatz
          // that had one. Pinning writes the CURRENT position as an override, which is the same
          // mechanism a drag already uses, so «GPS» beside it is the way back and there is no
          // second kind of pinned vehicle to reason about.
          onPinGps={selected.live && selected.kind !== 'person' && canEditIncident && !tacticalLocked
            && Array.isArray(selected.coord) && vehicleOverrides[selected.id]?.coord == null
            ? () => {
              const coord = selected.coord as LngLat
              setVehicleOverrides((m) => ({ ...m, [selected.id]: { ...m[selected.id], coord } }))
              log('truck', fillTemplate(appConfig.copy.contextPanel.logPinned, { name: selected.label ?? '' }), 'symbol', undefined, selected.id)
            }
            : undefined}
          // A live vehicle's Fahrer: the GPS feed reports where a vehicle IS, never who is in
          // it, and that is the one thing the FU needs to reach it. Kept in the override map
          // because the entity itself is rebuilt from the feed on every poll. A locked session
          // reads it (viewer, el, Führungsansicht — RBAC audit 22.10.2026) and cannot set it.
          driver={selected.live && selected.kind !== 'person'
            ? tacticalLocked ? { value: vehicleOverrides[selected.id]?.fahrer ?? '' } : {
              value: vehicleOverrides[selected.id]?.fahrer ?? '',
              options: rosterNames,
              onChange: (v: string) => {
                setVehicleOverrides((m) => ({
                  ...m,
                  [selected.id]: { ...m[selected.id], fahrer: v.trim() || undefined },
                }))
                // same rule as a placed vehicle's Fahrer field: naming a driver puts them on
                // the Anwesenheit list with «Fahrer <Fahrzeug>» as their Bemerkung — and a typed
                // Nachbarwehr driver onto it as a Gast (assignTypedName)
                assignTypedName(v, 'fahrer', fillTemplate(appConfig.copy.anwesenheit.roleFahrer, { vehicle: selected.label ?? '' }).trim())
              },
            }
            : undefined}
          // each row says what tells the lines apart — «Linie · 42 m → Hydrant H-142» (K11)
          connectedLines={drawings.filter((d) => [d.startAttachment, d.endAttachment].some((a) => a?.target.kind === 'object' && a.target.id === selected.id)).map((d) => ({
            id: d.id,
            label: connectedLineLabel(d, selected.id, (id) => {
              const e = entities.find((x) => x.id === id)
              return e ? e.label || (e.symbol ? formatSymbolName(e.symbol) : undefined) : undefined
            }),
          }))}
          onFocusLine={focusDrawing}
        />
      )}

      {/* note detail panel — the same ContextPanel, opened by the tap that selects the note (see
          notePanelId above) and by placing one. The note's TEXT is its title, so the panel's
          title field edits the note itself. */}
      {detailSlotFree && noteEntity && (
        <ContextPanel
          key={noteEntity.id}
          entity={noteEntity}
          // a note that was just put down opens ready to be written (see notePlacedId)
          autoFocusNote={notePlacedId === noteEntity.id && !tacticalLocked}
          // locked surfaces open the same panel with every edit affordance stripped — the note's
          // full text is exactly the kind of thing an Einsatzleiter needs to read off the map
          readOnly={tacticalLocked}
          onClose={() => setNotePanelId(null)}
          onTitleLive={(v) => noteTextLive(noteEntity.id, v)}
          onTitle={(v) => {
            if (titleLiveRef.current) { titleLiveRef.current = false; endDrag(); emit('entity.edit', { id: noteEntity.id, patch: { label: v } }) }
            else patchEntity(noteEntity.id, { label: v })
          }}
          onFields={(fields) => patchEntity(noteEntity.id, { fields })}
          // setting a width in the panel is a hand-made decision too — it ends the auto-fit
          // the S/M/L step keeps following the text, so it re-measures at the new font size
          // …each style edit is remembered as the NEXT note's default too («D pur», 09.09.:
          // the Notiz dock carries no style controls any more — this is the stickiness)
          onNoteSize={(s) => {
            patchEntity(noteEntity.id, noteEntity.noteAutoW
              ? { noteSize: s, noteW: autoNoteWPx(noteEntity.label ?? '', s) }
              : { noteSize: s })
            setNoteDefaults((d) => ({ ...d, size: s ?? 'm' }))
          }}
          onNotePlain={(p) => { patchEntity(noteEntity.id, { notePlain: p || undefined }); setNoteDefaults((d) => ({ ...d, plain: p })) }}
          onColor={(c) => { patchEntity(noteEntity.id, { color: c || undefined }); setNoteDefaults((d) => ({ ...d, color: c })) }}
          onDelete={() => { setNotePanelId(null); deleteEntity(noteEntity.id) }}
        />
      )}

      {detailSlotFree && tool === 'select' && selectedDrawing && (
        <DrawEditor
          drawing={selectedDrawing}
          pointCount={selectedDrawing.coords.length}
          // locked: the panel keeps the numbers (Länge, Höhenprofil, Fläche) and the
          // Verbindungen, and drops every control that would change the shape
          readOnly={tacticalLocked}
          areaM2={selectedDrawing.kind === 'circle' ? Math.PI * (selectedDrawing.radiusM ?? 0) ** 2
            : selectedDrawing.kind === 'area' && selectedDrawing.coords.length >= 3 ? polygonAreaM2(selectedDrawing.coords) : null}
          // a circle's box is its bounding square — the diameter each way
          boxM={selectedDrawing.kind === 'circle'
            ? { widthM: 2 * (selectedDrawing.radiusM ?? 0), heightM: 2 * (selectedDrawing.radiusM ?? 0) }
            : selectedDrawing.kind === 'area' && selectedDrawing.coords.length >= 3 ? bboxSizeM(selectedDrawing.coords) : null}
          perimeterM={selectedDrawing.kind === 'circle' ? 2 * Math.PI * (selectedDrawing.radiusM ?? 0)
            : selectedDrawing.kind === 'area' && selectedDrawing.coords.length >= 3
              ? pathLengthM([...selectedDrawing.coords, selectedDrawing.coords[0]]) : null}
          supportsDistance
          /* Messung on a line that is already drawn — geodesic length here, and the coords feed
             the collapsible swisstopo Höhenprofil (fetched only once it is opened) */
          lengthM={selectedDrawing.coords.length >= 2 ? pathLengthM(selectedDrawing.coords) : null}
          profileCoords={selectedDrawing.coords}
          // a style edit changes THIS drawing only – the next one starts from the plain default
          // again (useMapDrawing · DRAW_DEFAULTS; until 23.10.2026 these wrote the template back)
          onColor={(c) => patchDrawing({ color: c })}
          onDashed={(dashed) => patchDrawing({ dashed })}
          onLabel={(label) => { if (selectedDrawingId) patchDrawingLabelLive(selectedDrawingId, label) }}
          onLabelCommit={(label) => { if (selectedDrawingId) commitDrawingLabel(selectedDrawingId, label) }}
          onMarker={(marker) => patchDrawing({ marker })}
          onArrow={(arrow) => patchDrawing({ arrow })}
          onEnding={(ending) => void changeMapEnding(ending)}
          onReverse={tacticalLocked ? undefined : () => reverseDrawing(selectedDrawing.id)}
          // a Wand is layout, not a hose: no Typ, no Leitung Nr., no Trupp (types · Drawing.role)
          onContent={selectedDrawing.role ? undefined : (content) => patchDrawing({ content })}
          // the anchored Trupp carries a COPY of the number (the AS chip prints it), so a
          // renumbered hose renumbers the Trupp too (useTruppActions · syncLineNoToTrupp)
          onLineNo={selectedDrawing.role ? undefined : (lineNo) => { patchDrawing({ lineNo }); syncLineNoToTrupp(selectedDrawing.id, lineNo) }}
          onFloorTag={(floorTag) => patchDrawing({ floorTag })}
          // Abschnitt on the Fläche — Leiter + Auftrag (FKS Einsatzführung 3.5.2). Lage only:
          // a Plan sketch is not an Abschnitt, so the Whiteboard passes no handlers.
          onAbschnittLeiter={selectedDrawing.kind === 'area' ? (name) => patchDrawing({ abschnittLeiter: name }) : undefined}
          onAbschnittAuftrag={selectedDrawing.kind === 'area' ? (auftrag) => patchDrawing({ abschnittAuftrag: auftrag }) : undefined}
          people={pickablePersonnel.map((p) => p.displayName)}
          // Flächen that carry Leiter or Auftrag, THIS one counted as if already assigned —
          // so the FKS hint (max 3–4) shows while the 5th is being set up, not one edit late
          abschnittCount={drawings.filter((d) => d.kind === 'area' && (d.abschnittLeiter || d.abschnittAuftrag)).length
            + (selectedDrawing.abschnittLeiter || selectedDrawing.abschnittAuftrag ? 0 : 1)}
          // «Gehört zu Trupp …»: linking from the LINE's side. Routed through the same action the
          // Atemschutz board uses, so both directions write both collections identically.
          onTrupp={selectedDrawing.role ? undefined : (truppId) => (truppId ? linkTruppLine(truppId, selectedDrawing.id) : unlinkLine(selectedDrawing.id))}
          trupps={effTrupps.filter((t) => t.status !== 'raus').map((t) => ({ id: t.id, name: t.name }))}
          usedLineNos={drawings.filter((d) => d.kind === 'line' && d.id !== selectedDrawing.id && d.lineNo != null).map((d) => d.lineNo!)}
          truppOnLine={truppForLine(selectedDrawing, effTrupps)?.name}
          truppOnLineOut={truppIsOut(truppForLine(selectedDrawing, effTrupps))}
          onShowTrupp={() => { setSelectedDrawingId(null); setMode('atemschutz'); setPanel(null) }}
          // «Art: Linie | Wand» – the Plan's row, same patch, same blocks (sweep 28.10.2026,
          // Lage ↔ Plan parity). The Wand TOOL and its snapping stay the Gebäude stack's.
          onWand={selectedDrawing.kind === 'line' ? (wand) => {
            if (!wand || !wandBlock(selectedDrawing, effTrupps, sheetAnnoOf(selectedDrawing.id))) setDrawingWallRole(selectedDrawing.id, wand)
          } : undefined}
          wandBlocked={selectedDrawing.kind === 'line' ? wandBlockHint(wandBlock(selectedDrawing, effTrupps, sheetAnnoOf(selectedDrawing.id))) : undefined}
          onShowDistance={(showDistance) => patchDrawing({ showDistance })}
          onRadius={(radiusM) => patchDrawing({ radiusM })}
          onHatch={(hatch, fillOpacity) => patchDrawing({ hatch: hatch || undefined, fillOpacity })}
          attachmentLabels={Object.fromEntries((['start', 'end'] as const).flatMap((endpoint) => {
            const a = endpoint === 'start' ? selectedDrawing.startAttachment : selectedDrawing.endAttachment
            if (!a) return []
            const targetLine = drawings.find((x) => x.id === a.target.id)
            const label = a.target.kind === 'object' ? entities.find((e) => e.id === a.target.id)?.label ?? a.target.id : targetLine ? lineLabel(targetLine) : appConfig.copy.drawingEditor.line
            return [[endpoint, label]]
          }))}
          onRouting={tacticalLocked ? undefined : (endpoint, routing) => setGpsRouting(selectedDrawing, endpoint, routing)}
          // the GPS block at the head of the editor while an end follows or has followed (D3):
          // how long, how far, and the way back — read off the same snapshot the Meldung reads
          gpsInfo={Object.fromEntries((['start', 'end'] as const).flatMap((endpoint) => {
            const a = endpoint === 'start' ? selectedDrawing.startAttachment : selectedDrawing.endAttachment
            if (a?.target.kind !== 'object' || !a.gps || !hasTraced(a.gps)) return []
            const vehicle = entities.find((e) => e.id === a.target.id)
            const before = freshBefore(a.gps)
            return [[endpoint, {
              line: gpsLineName(selectedDrawing),
              vehicle: vehicle?.label ?? a.target.id,
              since: before ? formatTime(new Date(before.at)) : undefined,
              distance: vehicle ? fmtAway(haversineM(onSiteAnchor(a.gps), vehicle.coord)) : undefined,
              stopped: a.gps.state === 'paused',
              onSite: onSiteKnown(a.gps),
            }]]
          }))}
          onRevertGps={tacticalLocked ? undefined : (endpoint) => revertAll([gpsEndOf(selectedDrawing, endpoint)])}
          onDetachHere={tacticalLocked ? undefined : (endpoint) => releaseHere(selectedDrawing, endpoint)}
          onDetach={tacticalLocked ? undefined : (endpoint) => {
            const a = endpoint === 'start' ? selectedDrawing.startAttachment : selectedDrawing.endAttachment
            if (!a) return
            // ⚠️ a GPS end lets go ON SITE where that point is known — never at the vehicle's
            // current position, which is what this used to do and drew the depot into the hose
            // line (23.09.2026). Where it is not known the editor offers «Hier lösen» instead.
            if (a.gps) {
              if (onSiteKnown(a.gps)) releaseOnSite([gpsEndOf(selectedDrawing, endpoint)])
              else releaseHere(selectedDrawing, endpoint)
              return
            }
            const fallback: LngLat = a.target.kind === 'object'
              ? entities.find((e) => e.id === a.target.id)?.coord ?? (endpoint === 'start' ? selectedDrawing.coords[0] : selectedDrawing.coords[selectedDrawing.coords.length - 1])
              : (() => { const target = drawings.find((d) => d.id === a.target.id); return target ? (a.target.endpoint === 'start' ? target.coords[0] : target.coords[target.coords.length - 1]) : (endpoint === 'start' ? selectedDrawing.coords[0] : selectedDrawing.coords[selectedDrawing.coords.length - 1]) })()
            setDrawingAttachment(selectedDrawing.id, endpoint, undefined, fallback)
          }}
          onFocusAttachment={(endpoint) => {
            const a = endpoint === 'start' ? selectedDrawing.startAttachment : selectedDrawing.endAttachment
            if (!a) return
            if (a.target.kind === 'object') focusEntity(a.target.id); else focusDrawing(a.target.id)
          }}
          attachmentHidden={Object.fromEntries((['start', 'end'] as const).map((endpoint) => {
            const a = endpoint === 'start' ? selectedDrawing.startAttachment : selectedDrawing.endAttachment
            const target = a?.target.kind === 'object' ? entities.find((e) => e.id === a.target.id) : null
            return [endpoint, !!target && !isVisible(target.layer)]
          }))}
          onRevealAttachment={(endpoint) => {
            const a = endpoint === 'start' ? selectedDrawing.startAttachment : selectedDrawing.endAttachment
            const target = a?.target.kind === 'object' ? entities.find((e) => e.id === a.target.id) : null
            if (target && !isVisible(target.layer)) toggleLayer(target.layer)
          }}
          locked={!!selectedDrawing.locked}
          onToggleLock={tacticalLocked ? undefined : () => { patchDrawing({ locked: selectedDrawing.locked ? undefined : true }); if (!selectedDrawing.locked) setSelectedDrawingId(null) }}
          onDelete={() => selectedDrawingId && deleteDrawing(selectedDrawingId)}
          onClose={() => setSelectedDrawingId(null)}
        />
      )}
    </>
  )
}
