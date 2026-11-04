// The Plan surface: the lazy Whiteboard over the active plan document, with everything it reads
// from and writes back to the Einsatz (the tactical store's `board`, the plan histories, the
// Trupps, the Georeferenz). Split out of IncidentWorkspace (E1, 09.10.2026); mounted only while
// `mode === 'plans'` — which is why the plan STACKS live in the workspace, not here. The
// workspace's hooks come in as their own result objects (the store, the object's plans, the
// georeferenced fits, the map actions, the roster, the Trupp actions).

import { type ReactNode, type Dispatch, type SetStateAction, Suspense } from 'react'
import type { JSX } from 'react/jsx-runtime'
import { LoadingStatus } from '../components/ShellLoader'
import type { TafelPagesProps } from '../components/Whiteboard'
import type { TruppFinderDoor } from '../components/WbControls'
import { appConfig } from '../config/appConfig'
import { gebaeudeDoc } from '../data/demoIncident'
import type { AtemschutzAlarmState } from '../lib/atemschutz'
import type { AuthUser } from '../lib/auth'
import type { IncidentMeta } from '../lib/incidents'
import { type RailLabels, type SymbolSurface, planSymbolScale } from '../lib/prefs'
import { type TruppTrail, planGhostTrails } from '../lib/truppTrails'
import type { useBuildingInfo } from '../lib/useBuildingInfo'
import type { useGeorefFits } from '../lib/useGeorefFits'
import type { useIsPhone } from '../lib/useIsPhone'
import { BUILDING_PICK_ID, type useObjectPlans } from '../lib/useObjectPlans'
import type { ObjectStore } from '../lib/useObjectStore'
import type { useSymbols } from '../lib/useSymbols'
import type { useTruppActions } from '../lib/useTruppActions'
import type { PlanScales } from '../lib/workspace'
import type { PlanDocument, BoardDoc, BuildingDoc, TimelineEvent, Entity, Trupp, CaptionMode } from '../types'
import { Whiteboard } from './lazySurfaces'
import type { useGebaeudeActions } from './useGebaeudeActions'
import type { WorkspaceMode } from './types'
import type { useMapActions } from './useMapActions'
import type { usePlanStacks } from './usePlanStacks'
import type { useRosterRoles } from './useRosterRoles'

export interface PlansSurfaceProps {
  mode: WorkspaceMode
  sym: ReturnType<typeof useSymbols>
  guarded: (surface: string, node: ReactNode, toMap?: boolean) => JSX.Element
  railLabels: RailLabels
  planDocs: PlanDocument[]
  tacticalLocked: boolean
  isPhone: ReturnType<typeof useIsPhone>
  journalOpen: boolean
  replayActive: boolean
  linkScoped: boolean
  activePlanId: string
  setActivePlanId: Dispatch<SetStateAction<string>>
  /** which object's plans these are, and how it was surfaced (lib/useObjectPlans) */
  objectPlans: ReturnType<typeof useObjectPlans>
  buildingInfo: ReturnType<typeof useBuildingInfo>
  incidentMeta: IncidentMeta
  setPickerOpen: Dispatch<SetStateAction<boolean>>
  symbolScale: Record<SymbolSurface, number>
  symbolCaptions: CaptionMode
  mapSuppressedCaptions: ReadonlySet<string>
  /** the «Messungen» chip (components/ReadingsChip) for the plan's bottom-left row; null = none */
  readingsChip: ReactNode
  /** the georeferenced sheets and what they project (lib/useGeorefFits) */
  georefFits: ReturnType<typeof useGeorefFits>
  /** the Karte's gestures — a live vehicle dragged on a sheet, «Auf der Karte zeigen» (workspace/useMapActions) */
  mapActions: ReturnType<typeof useMapActions>
  replayBoard: BoardDoc | null
  replayBuilding: BuildingDoc | null
  /** the tactical store (lib/useObjectStore) */
  store: ObjectStore
  trails: TruppTrail[]
  deleteGhostTrail: (id: string) => Promise<void>
  armTrailDrop: (sourceId: string, on: boolean) => void
  building: BuildingDoc | null
  /** the Gebäude's own acts — pick, storeys, Drehung (workspace/useGebaeudeActions) */
  gebaeude: ReturnType<typeof useGebaeudeActions>
  logPlan: (icon: string, text: string, extra?: { kind?: TimelineEvent['kind']; annoId?: string; x?: number; y?: number; floor?: number; subjectId?: string }) => void
  /** the roster's names, ranks and hints for the symbol fields (workspace/useRosterRoles) */
  roster: ReturnType<typeof useRosterRoles>
  addRecent: (name: string) => void
  user: AuthUser | null
  emit: (op_type: string, payload?: Record<string, unknown>, opts?: { observed?: string }) => void
  /** the Plan's per-document undo stacks and the handles the Whiteboard reports up (workspace/usePlanStacks) */
  planStacks: ReturnType<typeof usePlanStacks>
  planFocus: { x: number; y: number; floor: number; annoId?: string; twinEntityId?: string; flash?: boolean; nonce: number } | null
  effTrupps: Trupp[]
  truppCounterNames: (exceptId?: string) => (string | undefined)[]
  teamNameTaken: (id: string, label: string) => boolean
  azAlarm: AtemschutzAlarmState
  truppActions: ReturnType<typeof useTruppActions>
  newTruppFromMarker: (markerId: string) => void
  /** «Im Atemschutz zeigen»: the board, landed on that Trupp's card */
  showTrupp: (truppId: string) => void
  planScale: PlanScales
  setPlanScale: Dispatch<SetStateAction<PlanScales>>
  /** the Tafel's pages (workspace/useTafelPages) — absent for a link session */
  tafel: TafelPagesProps | undefined
  /** «Trupp finden» on the plan's Trupp dock, the Karte's finder (UX sweep M9) */
  truppFinder: TruppFinderDoor
}

export function PlansSurface({
  mode, sym, guarded, railLabels, planDocs, tacticalLocked, isPhone, journalOpen, replayActive,
  linkScoped, activePlanId, setActivePlanId, objectPlans, buildingInfo, incidentMeta,
  setPickerOpen, symbolScale, symbolCaptions, mapSuppressedCaptions, readingsChip, georefFits, mapActions,
  replayBoard, replayBuilding, store, trails, deleteGhostTrail, armTrailDrop, building, gebaeude, logPlan,
  roster, addRecent, user, emit, planStacks, planFocus, effTrupps, truppCounterNames, teamNameTaken,
  azAlarm, truppActions, newTruppFromMarker, showTrupp, planScale, setPlanScale, tafel, truppFinder,
}: PlansSurfaceProps) {
  const { activeObjectName, activeObjectAddress, activeObjectNearby } = objectPlans
  const { activeLinkedPlan, floorPack, planLive, planPhotos } = georefFits
  const { moveLiveOnSheet } = mapActions
  const { board, setBoard } = store
  const { rosterNames, rosterRank, linkRosterFields, personStatus, rosterFieldHints } = roster
  const {
    updateTrupp, askTruppEntry, adoptTruppMarker, releaseTruppMarker, linkTruppLine, unlinkLine,
    linkLineToAttachedTrupp, unlinkLineFromDetachedTrupp, syncLineNoToTrupp,
  } = truppActions
  return (
    <>
      {/* like the map: mounted once the pack has loaded OR failed for good (empty glyph table) */}
      {mode === 'plans' && (sym.ready || sym.error) && guarded('board', (
        /* the chunk is prefetched on idle (loadWhiteboard); on the rare cold switch the fallback is
           the paper frame with the shared loading state */
        <Suspense fallback={<div className="whiteboard"><div className="workspace-loading"><LoadingStatus size="surface">{appConfig.copy.loading}</LoadingStatus></div></div>}><Whiteboard
          railLabels={railLabels}
          plans={planDocs}
          // on desktop the Verlauf drawer docks beside the plan's tool rail (same as the
          // map), so the rail + its zoom/fit footer stay live. Only a phone still parks
          // the plan read-only while Verlauf is open (there it's a full-width bottom sheet).
          readOnly={tacticalLocked || (isPhone && journalOpen)}
          // …but a locked plan still offers the tool that changes nothing (Auswahl; the plan
          // lost Messen 29.08.). Not during replay (the scrubber owns the bottom band) and not
          // behind the phone's Verlauf sheet, which parks the plan entirely.
          slimTools={!replayActive && !(isPhone && journalOpen)}
          // Einsatz-Link session: the Plan sheet's Karte and Massstab (behind the Objekt chip) are the
          // ORIGIN's instruments — an outside viewer can set nothing, so no doors to settings.
          linkViewer={linkScoped}
          activeId={activePlanId}
          // which object's plans these are — named on the Plan surface itself (it decides what
          // the rail lists). A link session is bound to one object, so it gets no switch.
          objectName={activeObjectName}
          objectAddress={activeObjectAddress}
          buildingInfo={buildingInfo}
          readingsChip={readingsChip}
          // only the AUTO-surfaced object can be «merely nearby»; a manual pick is the operator's
          objectNearby={activeObjectNearby}
          incidentId={incidentMeta.id}
          incidentAddress={incidentMeta.address}
          // the Einsatzort on the Gebäude picker — only a REAL coordinate (0/0 is Divera's «none»)
          incidentPos={incidentMeta.lng != null && incidentMeta.lat != null && (incidentMeta.lng !== 0 || incidentMeta.lat !== 0) ? [incidentMeta.lng, incidentMeta.lat] : null}
          // a locked session gets no picker (viewer, el, Führungsansicht, link, replay – RBAC
          // audit V5): the pick is `pickedObjectId` in the shared blob, and a viewer's or the el's
          // switch held on this device only, until the next hydrate. The chip stays a read-out.
          onObjectSwitch={tacticalLocked ? undefined : () => setPickerOpen(true)}
          // A georeferenced Modul has the Karte's real scale, so its tactical symbols follow the
          // Karte setting too. Standalone sheets keep the independent Modul preference.
          symMul={planSymbolScale(symbolScale, !!activeLinkedPlan)}
          captionMode={symbolCaptions}
          mapSuppressedCaptions={mapSuppressedCaptions}
          // …and the half of the Karte that is NOT a record: the live feed, drawn on the paper
          // and editable only in the one way it is on the Karte — a dropped Fahrzeug is «hier
          // ist es wirklich». Everything else the Karte holds arrives in `annos` as an object.
          live={planLive}
          photos={planPhotos}
          onPlanLiveMove={tacticalLocked ? undefined : moveLiveOnSheet}
          /* ⚠️ REPLAY shows the recorded sheet and nothing else. `replayBoard` is the anno list as
             it was written down, so a plan-drawn object appears exactly as it was — but a Karte
             object standing beside it does NOT, because its place on this paper is derived and
             the derivation would use TODAY's fit on yesterday's record. Absent is the honest
             answer until replay carries the projection it was recorded with (phase 4). */
          annos={(replayActive ? replayBoard : board)?.[activePlanId] ?? []}
          /* ⚠️ Not during replay: a ghost trail is today's record of a removal, and the replayed
             sheet is what was on the screen at the recorded moment (lib/replay stays VIEW-based). */
          ghostTrails={replayActive ? [] : planGhostTrails(trails, activePlanId)}
          onGhostTrail={tacticalLocked ? undefined : (id) => void deleteGhostTrail(id)}
          // «Marker und Spur löschen» on a chip: arm the ghosting to write it already deleted
          onTrailDrop={tacticalLocked ? undefined : armTrailDrop}
          onChange={(next, opts) => { if (tacticalLocked) return; setBoard((b) => ({ ...b, [activePlanId]: next }), opts) }}
          building={replayActive ? replayBuilding : building}
          floorPack={floorPack}
          // ⚠️ Every writer below that changes the shared blob is wired WITH the lock (RBAC audit
          // 22.10.2026, hardening): the Whiteboard already withholds the doors on a locked plan, but
          // a writer that cannot be reached is the second wall, not the first one's replacement.
          // the Gebäude's own acts — pick, storeys, Drehung (workspace/useGebaeudeActions)
          onSelectBuilding={gebaeude.selectBuilding}
          // the two faces of the ONE «Gebäude» rail tile. Both plan ids stay real documents —
          // this only moves the active one, which is what makes the merged tile navigable at all
          // (railPlanTiles reads activePlanId to decide which face the tile wears).
          onBuildingFace={(face) => setActivePlanId(face === 'pick' ? BUILDING_PICK_ID : gebaeudeDoc.id)}
          onReorient={tacticalLocked ? undefined : gebaeude.reorient}
          onAddFloor={gebaeude.addFloor}
          onRemoveFloor={gebaeude.removeFloor}
          sym={sym}
          rosterNames={rosterNames}
          rosterRank={rosterRank}
          onRosterField={tacticalLocked ? undefined : (symbol, label, key, name) => linkRosterFields({ symbol, label } as Entity, { [key]: name })}
          // the same two roster read-outs the Lage's symbol panel has shown all along: who that
          // name already is ON the dropdown entry, and the contradiction a filled field carries
          // UNDER it. A plan symbol is not an Entity, so the hint call is fed its parts.
          personStatus={personStatus}
          fieldHints={(symbol, label, fields) => rosterFieldHints({ kind: 'symbol', symbol, label, fields } as Entity)}
          // Symbol→Mittel on the plan, with the Lage's exact gate and the shared count: a TLF
          // placed on Modul 1 books onto the Material sheet like one placed on the Karte
          onRecent={addRecent}
          log={logPlan}
          authorName={user?.display_name}
          emit={emit}
          historyRef={planStacks.planHist}
          hist={planStacks.planHistory}
          setHist={planStacks.setPlanHistory}
          onCheckpoint={planStacks.rememberPlanStep}
          onStepEnd={planStacks.endPlanStep}
          onStepLabel={planStacks.onPlanStepLabel}
          views={planStacks.planViews}
          fitRef={planStacks.planFit}
          keysRef={planStacks.planKeys}
          focus={planFocus}
          trupps={effTrupps}
          // the Karte's markers, the other plans' chips, the ghost trails and every Trupp ever
          // registered (its `trupps` prop leaves the removed ones out), for the one Trupp counter
          placedTeamNames={() => truppCounterNames()}
          teamNameTaken={teamNameTaken}
          truppSeverities={azAlarm.severities}
          // the plan's Trupp tool placed a chip FOR a Trupp — same ask as every other placement:
          // the picture now says the crew is there, so «einrücken?» belongs here (askTruppEntry)
          onLinkTrupp={tacticalLocked ? undefined : (annoId, truppId) => { updateTrupp(truppId, { annoId, planId: activePlanId }); void askTruppEntry(truppId) }}
          // …and the chip's half of the join, joined from the picture rather than from the card —
          // the identical wiring the map marker's menu gets, through the identical action, so the
          // takeover confirm and the «einrücken?» ask exist exactly once for both surfaces
          onTeamTrupp={tacticalLocked ? undefined : (annoId, truppId) => {
            if (truppId) void adoptTruppMarker(truppId, annoId)
            else releaseTruppMarker(annoId)
          }}
          onTeamNewTrupp={tacticalLocked ? undefined : newTruppFromMarker}
          onLinkLineTrupp={tacticalLocked ? undefined : (annoId, truppId) => (truppId ? linkTruppLine(truppId, annoId) : unlinkLine(annoId))}
          // a Leitung end snapped onto a Trupp's chip IS the Leitung pick (15.09.) — the same
          // call the Karte makes from its own magnet (lib/useMapDrawing · onLineAttached)
          onLineAttached={tacticalLocked ? undefined : (annoId, attachment) => { linkLineToAttachedTrupp(annoId, attachment) }}
          onLineDetached={tacticalLocked ? undefined : (annoId, previous) => { unlinkLineFromDetachedTrupp(annoId, previous) }}
          onLineRenumber={tacticalLocked ? undefined : syncLineNoToTrupp}
          // the plan chip's twin of the map marker's jump — it points at the card too
          onShowTrupp={showTrupp}
          tafel={tafel}
          truppFinder={truppFinder}
          planScale={planScale}
          onCalibrate={(planId, sc) => { if (tacticalLocked) return; setPlanScale((m) => { if (!sc) { const { [planId]: _drop, ...rest } = m; return rest } return { ...m, [planId]: sc } }) }}
        /></Suspense>
      ))}
    </>
  )
}
