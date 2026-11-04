import { useEffect, useMemo, useRef, useState, type Dispatch, type MutableRefObject, type SetStateAction } from 'react'
import { appConfig } from '../config/appConfig'
import type { BoardAnno, BuildingDoc, Entity, PlanDocument, TimelineEvent } from '../types'
import { gebaeudeDoc } from '../data/demoIncident'
import type { ObjectStore } from './useObjectStore'
import { bakeAll, type PlanFit } from './tacticalObjects'
import type { GeorefPair } from './georef'
import type { PlanScales } from './workspace'
import type { IncidentPlanBinding } from './incidentPlanBindings'
import { incidentBindingApproved } from './incidentPlanBindings'
import { liveOverlay, photoOverlay } from './planProjection'
import {
  fitChange, fitChangeRow, fitChangeUndoLabel, fitSignature, georefPlans, handLinkRow, movedOnSheets,
  planAspect, referenceDelta, sheetFits, twinPlanImageLayerId, twinPlanImageVisible, type SheetFit,
} from './georefTwins'
import { georefForPlan, getStationPlanScales, loadStationPlanScales, stationPlanScalesLoaded, takeRolledBackStationWrite } from './stationPlanScale'
import { setGeorefLinkedHandler, useGeorefStorage } from './georefMode'
import { planPreviewUrl, regionInkBox } from './pdfRaster'
import { stackGroundFit } from './stackFit'
import { floorPackOf, packBuildingDoc, PACK_TRIM_MS, trimmedPackFrame } from './floorPackBinding'
import { buildingPackBinding } from './buildingPackBinding'
import { tileAspectOf } from './whiteboard'
import { fillTemplate } from './format'

interface Args {
  planDocs: PlanDocument[]
  planScale: PlanScales
  building: BuildingDoc | null
  setBuilding: (next: BuildingDoc) => void
  planBindings: IncidentPlanBinding[]
  activeObjectId: string | null | undefined
  /** the store's sheets (a floor pack seeds only while the Gebäude is still empty) */
  board: Record<string, BoardAnno[]>
  objects: ObjectStore['objects']
  rebake: ObjectStore['rebake']
  /** ⚠️ The REF the store's writers read the fits through (useObjectStore · getFits) — written
   *  here on every fit change, read there at write time */
  planFitsRef: MutableRefObject<Map<string, PlanFit>>
  /** bumped whenever the fits the sheets RENDER through change */
  fitsVersion: number
  setFitsVersion: Dispatch<SetStateAction<number>>
  /** the ↶ caption of the re-bake's one step (the store reads it while the step is laid down) */
  stepLabelRef: MutableRefObject<string | null>
  /** ⚠️ The workspace's `log` through the SAME ref its timeline entries use (IncidentWorkspace ·
   *  histSide): `log` is declared further down the workspace than this hook is called, and it is
   *  assigned to the ref in the same render — so an effect reads the render's own `log`. */
  histSide: MutableRefObject<{ log: (icon: string, text: string, kind?: TimelineEvent['kind']) => void }>
  readOnly: boolean
  /** the session pushes the whole blob (access · canWriteBlob): the two Gebäude seeds below write
   *  `building`, which the el's record slice never carries */
  canWriteBlob: boolean
  tacticalLocked: boolean
  replayActive: boolean
  twinLayers: Record<string, boolean>
  twinLayerOpacity: Record<string, number>
  activePlanId: string
  liveVehicles: Entity[]
  livePeople: { people: Entity[] }
  isVisible: (layerId: string) => boolean
  /** the Karte's entities as the map draws them (photo URLs resolved, the replay's in a replay) —
   *  only their photo markers are read, for the sheet (planProjection · photoOverlay) */
  mapEntities: Entity[]
}

/**
 * The Georeferenz of an Einsatz, lifted out of IncidentWorkspace (23.09.2026): which plans are
 * tied to the ground and by which fit (`linkedPlans`), the Gebäude stack on the ground (its floor
 * pack, the pack-seeded stack, its fit), the fits map the unified-object store bakes through —
 * with the RE-BAKE when a fit really changes (one undo step, one «Referenz angepasst» row; a
 * vanished reference its own row) — and what the fits lend the surfaces: the sheet rasters on the
 * Karte, the live feed on the open sheet.
 *
 * ⚠️ Moved verbatim, and called where the block stood: the hook order (the storage subscription,
 * the memos, the refs, the pack-seed and both re-bake effects, the previews) is the original one,
 * which matters — these effects run after the store's and the hydrate's, and the re-bake must see
 * the fits map the store's writers read. The one change is `log` → `histSide.current.log`, for the
 * declaration order (see Args · histSide), and the step-label ref's local name (`…Ref`, as the
 * hooks linter reads refs by name). No memo or dependency list changed.
 */
export function useGeorefFits({
  planDocs, planScale, building, setBuilding, planBindings, activeObjectId, board, objects, rebake,
  planFitsRef, fitsVersion, setFitsVersion, stepLabelRef, histSide, readOnly, canWriteBlob, tacticalLocked, replayActive,
  twinLayers, twinLayerOpacity, activePlanId, liveVehicles, livePeople, isVisible, mapEntities,
}: Args) {
  // --- Georeferenz: which plans are tied to the ground, and how ---------------------------------
  // The fits themselves. Everything derived FROM them — a sheet's view of the Karte's objects,
  // a sheet-drawn object's map body — lives in the store (lib/useObjectStore).
  //
  // ⚠️ `useGeorefStorage()` is what makes the memo below re-run. `georefForPlan` reads a module
  // singleton synchronously, so a plan that was just linked has nothing else to tell React with.
  useGeorefStorage()
  // …and THIS is the dep that carries it: `saveStationPlanScales` replaces the singleton with a
  // new object on every write, so its identity changes exactly when a reference does (and once
  // more when the boot fetch lands). Read during render — it is a synchronous accessor.
  const stationScales = getStationPlanScales()
  // Every plan of this object that carries a usable fit, solved once per plan/pairs change. The
  // aspect each fit is taken at is recovered from the plan's calibration — see georefTwins ·
  // planAspect for why that is the right source and what happens when there is none.
  const linkedPlans = useMemo(
    // …plus whether the station APPROVED each fit, which is what lets an approved automatic
    // alignment's Ebenen row read «Verknüpft» instead of «ungemessen» (18.09.2026)
    () => georefPlans(planDocs, georefForPlan, (p) => planAspect(p, stationScales, planScale[p.id]), incidentBindingApproved),
    [planDocs, planScale, stationScales],
  )
  // …the same fits, keyed for the unified-object bake (the store's writers read this through
  // `getFits` — see the note there). aspect = widthM / scaleMPerU inverts planGroundWidthM.
  // ⚠️ And whenever a fit REALLY changes, every baked map body is re-derived: a corrected
  // georeference MOVES every symbol standing on that sheet, and correcting itself is the entire
  // point of correcting a fit.
  //
  // ⚠️ «Really» is what `fitSignature` measures, and it has to: `linkedPlans` is rebuilt by any
  // render that touches planDocs or the station scales — including the one every hydrate causes —
  // and re-baking on identity would mark the store dirty after a merge that changed nothing. Two
  // devices with the same Einsatz open then push each other in a loop, wiping both undo stacks on
  // every round (applyWorkspace drops them by design). The bake itself is no-op-safe too (see
  // tacticalObjects · sameValue), so this is a belt beside that brace, not instead of it.
  const bakedFits = useRef<string | null>(null)
  /** …and the signature the RENDER was last derived at. ⚠️ Two refs, deliberately: a viewer
   *  derives the picture but writes nothing into the record, so «what is on screen» and «what has
   *  been baked» move independently. Sharing one ref put Stage 2 behind the read-only guard —
   *  a Führungsansicht computed every sheet against an empty fits map and never re-ran. */
  const shownFits = useRef<string | null>(null)
  /** one retry for the station document before the first bake — see the note below */
  const seedWaited = useRef(false)
  /**
   * The SHEETS that carried a fit at the last bake — so a reference that VANISHED can be told from
   * one that merely changed. It has to be told: a vanished fit moves nothing at all (bakeGeoBody
   * hands a record straight back when its plan has no fit), so `rebake` honestly reports 0 and the
   * Verlauf would say nothing whatever about «Referenz zurücksetzen» — an act somebody performed
   * on purpose, after which every symbol on that sheet is standing on a ground position nothing
   * will correct again.
   *
   * ⚠️ By `georefKey`, not by plan id, and only for sheets STILL among this object's plans. Every
   * Einsatzobjekt has a «Modul 2», so a drop measured on plan ids would read every object switch —
   * and every plan the rail stops offering — as a reference somebody deleted.
   */
  const referencedSheets = useRef<ReadonlySet<string> | null>(null)
  /** …and every SHEET this session has baked a fit for, at its last fit, with the landmark pairs
   *  the OPERATOR had set — the whole difference between a reference arriving (a seed), «Referenz
   *  angepasst» and «Blattform gemessen». See georefTwins · fitChange for why it is per sheet. */
  const knownSheets = useRef<ReadonlyMap<string, SheetFit> | null>(null)
  // The Gebäude stack on the ground (lib/stackFit): one more fit in the map, keyed by the stack's
  // plan id, so its tile ink bakes onto the Karte and the Karte's objects land on their storey
  // tile. It comes from the BUILDING, not from a station reference – so it stays out of the
  // reference bookkeeping below (signature, Verlauf rows) and re-bakes silently on its own effect.
  const packBinding = useMemo(() => building?.pack
    ? buildingPackBinding(building, planBindings)
    : planBindings.find((binding) => binding.objectId === activeObjectId && binding.floors?.length) ?? null,
  [building, planBindings, activeObjectId])
  const floorPack = useMemo(() => floorPackOf(packBinding ? [packBinding] : [], packBinding?.objectId), [packBinding])
  useEffect(() => {
    if (building?.pack && !building.pack.bindingId && packBinding && canWriteBlob) {
      setBuilding({ ...building, pack: { ...building.pack, bindingId: packBinding.id } })
    }
  }, [building, packBinding, canWriteBlob, setBuilding])
  const stackFit = useMemo(() => (building ? stackGroundFit(building, floorPack?.fit) : null), [building, floorPack])
  // A floor pack IS the Gebäude (decided 14.09.2026): the moment the object's binding carries
  // floors and there is no stack yet, the stack comes up from the pack's pages – no footprint to
  // pick, no outline. A machine seed like the binding itself, so no toast and no undo step; an
  // operator's footprint stack (an older incident, or picked on purpose) is left alone.
  useEffect(() => {
    // …and a stack that came up BEFORE the frame was measured and the card fitted (16.09.2026)
    // takes both, but ONLY while nothing is drawn on it: the frame and the band are what tile
    // coordinates mean, so re-measuring under existing ink would move the ink. A stack somebody
    // has already marked keeps the geometry it was marked on – for the whole Einsatz.
    const upgrade = !!building?.pack && building.tileAR == null && !(board.gebaeude ?? []).length
    if ((building && !upgrade) || !floorPack?.floors.length || !floorPack.aspect || !canWriteBlob) return
    let alive = true
    // ⚠️ The frame is measured BEFORE the stack exists, not corrected afterwards: tile coordinates
    // are relative to it, so a frame that moved under ink somebody had already drawn would take
    // that ink with it. The measurement reads the pages (lib/floorPackBinding · trimmedPackFrame)
    // and is bounded – offline, or a sheet that will not render, seeds the untrimmed frame after
    // the timeout rather than leaving the Gebäude tile empty.
    const seed = (frame: [number, number, number, number]) => {
      if (!alive) return
      // the card is as tall as the trimmed frame needs – no storey spends two thirds of its band
      // on air any more (lib/footprint · bandAspect, 16.09.2026); one builder, shared with the
      // Karte's Gebäude (lib/floorPackBinding · packBuildingDoc)
      const fresh = packBuildingDoc(floorPack, frame, building?.pack?.bindingId ?? packBinding?.id)
      if (!fresh) return
      setBuilding(building ? { ...building, ringAspect: fresh.ringAspect, tileAR: fresh.tileAR, pack: fresh.pack } : fresh)
    }
    const fallback = setTimeout(() => seed(floorPack.frame), PACK_TRIM_MS)
    void trimmedPackFrame(floorPack, regionInkBox)
      .then((frame) => { clearTimeout(fallback); seed(frame) })
      .catch(() => { clearTimeout(fallback); seed(floorPack.frame) })
    return () => { alive = false; clearTimeout(fallback) }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [building, floorPack, packBinding, canWriteBlob, board.gebaeude?.length])
  const fitsMap = useMemo(() => {
    const m = new Map<string, PlanFit>(linkedPlans.map((p) => [p.id, { fit: p.fit, aspect: p.widthM / p.fit.scaleMPerU }]))
    if (stackFit && building) m.set(gebaeudeDoc.id, { fit: stackFit, aspect: 1 / tileAspectOf(building), stack: { floors: building.floors } }) // aspect = width / height, like every sheet's
    return m
  }, [linkedPlans, stackFit, building])
  const stackSig = stackFit && building ? `${fitSignature({ id: gebaeudeDoc.id, fit: stackFit, widthM: 0 } as Parameters<typeof fitSignature>[0])}|${building.floors.join(',')}` : ''
  useEffect(() => {
    planFitsRef.current = fitsMap
    setFitsVersion((v) => v + 1)
    if (!stackSig || readOnly || tacticalLocked) return
    rebake({ checkpoint: false })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stackSig, readOnly, tacticalLocked])
  useEffect(() => {
    // ⚠️ ABOVE the guard, both of them. The fits and the version that carries them into the
    // memos are what every surface RENDERS through (lib/useObjectStore · board); only writing
    // derived geometry back into the record is an editor's privilege.
    planFitsRef.current = fitsMap
    // ⚠️ Taken FIRST, above every early return, because the taking is what disarms it. A refused
    // write that changed no fit — a Massstab on some other plan — notifies this effect just the
    // same, and a flag left standing there would have made the operator's NEXT real correction
    // read as a rollback (lib/stationPlanScale · takeRolledBackStationWrite).
    const rolledBack = takeRolledBackStationWrite()
    const sig = linkedPlans.map(fitSignature).join('|')
    if (sig !== shownFits.current) { shownFits.current = sig; setFitsVersion((v) => v + 1) }
    if (sig === bakedFits.current) return
    // A viewer derives nothing INTO the record. The baked signature stays unrecorded with it, so
    // a session that later becomes editable (replay left) still gets its bake.
    if (readOnly || tacticalLocked) return
    // ⚠️ The SEED bake is not a correction. A blob written before the store existed simply gains
    // its map bodies; nothing moved from anywhere, so there is no step to take back and nothing
    // to tell the Verlauf — and the same holds for every sheet whose reference ARRIVES later. A
    // later change of a KNOWN sheet's fit is the operator correcting the reference, and that
    // MOVES every symbol on that sheet — one undo step and one row for the
    // lot, because it was one gesture.
    const seeding = bakedFits.current === null
    // ⚠️ The seed bake WRITES ground positions into the record, derived from a station document
    // that is a module singleton — empty until the boot load resolves, and empty again when that
    // load found nothing anywhere. Baking out of the second would store a picture built on a
    // reference nobody has read. So the first bake waits for a real answer; the load notifies,
    // which re-runs this effect. Offline (or after a failed retry) the cache is the honest
    // answer and the bake proceeds — once, so a dead network cannot spin here.
    if (seeding && !stationPlanScalesLoaded() && !seedWaited.current) {
      seedWaited.current = true
      void loadStationPlanScales()
      return
    }
    // ⚠️ …and WHY it changed, which the row and the ↶ caption must not guess: a hand corrected the
    // reference, or the app measured the sheet and re-solved the SAME pairs in a truer shape. Both
    // move every symbol on that sheet; only one of them is something somebody did.
    // ⚠️ Decided PER SHEET (23.09.2026): after a remount the plans, their keys and the bindings
    // arrive one by one, and read as one signature over the rail every arrival was «Referenz
    // angepasst». A sheet this session never baked is a seed; only a known sheet whose fit
    // changed is a change, and only ITS objects are counted (georefTwins · fitChange).
    const change = fitChange(sheetFits(planDocs, linkedPlans, georefForPlan), seeding ? null : knownSheets.current, rolledBack)
    const { cause } = change
    bakedFits.current = sig
    knownSheets.current = change.known
    const C_LOG = appConfig.copy.log
    // ⚠️ Which of the four causes somebody PERFORMED — the one question that decides both the ↶
    // and the row, answered in one place beside the cause itself (georefTwins · fitChangeUndoLabel).
    const undoLabel = fitChangeUndoLabel(cause)
    stepLabelRef.current = undoLabel
    /**
     * ⚠️ THE RE-BAKE EMITS NO EVENTS, and that is the decided answer rather than an omission
     * (phase 4). It moves n map bodies at once, so the two obvious alternatives are:
     *
     *   · n `entity.move` rows — which would put n placements into the record that nobody made.
     *     The stream is what the replay folds AND what the chain attests: «the operator moved 40
     *     objects» is not what happened, «the reference was corrected» is, and the Verlauf already
     *     says exactly that, once, above.
     *   · one row of a new op type — which no fold could apply anyway. Re-deriving the positions
     *     here would need a FIT, and the only fit a replay ever has is today's; applying it to
     *     yesterday's record is the one thing the bake exists to make unnecessary (the map bodies
     *     are baked at WRITE time precisely so the record is self-contained).
     *
     * So the SNAPSHOT carries it, which is what snapshots are for: this write marks the workspace
     * dirty, the save that follows within the autosave window stores the blob, and the backend
     * snapshots every save (backend · incident_service · apply_workspace_put). Between the re-bake
     * and that save — seconds — a scrub shows the pre-correction positions. Written down here
     * because it is the one place the fold's coverage stops, and lib/replay's header points at it.
     */
    const moved = rebake({ checkpoint: !!undoLabel, count: (before, after) => movedOnSheets(before, after, change.changed) })
    stepLabelRef.current = null
    const row = fitChangeRow(cause, moved)
    if (row) histSide.current.log('map', row, 'layer')

    // …and the other half of a fit change: a reference that is GONE (see `referencedSheets`).
    const { dropped, referenced } = referenceDelta(planDocs, linkedPlans.map((p) => p.id), referencedSheets.current)
    referencedSheets.current = referenced
    if (!seeding && dropped.size) {
      // Nothing moved, so the row counts what STAYS: the objects drawn on that sheet keep the
      // ground position the last fit gave them — last known truth, deliberately not marked stale
      // (decided 09.09.2026).
      const kept = objects.reduce((n, o) => n + (o.sheet && dropped.has(o.sheet.planId) ? 1 : 0), 0)
      histSide.current.log('map', kept ? fillTemplate(C_LOG.referenceDroppedKept, { n: kept }) : C_LOG.referenceDropped, 'layer')
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [linkedPlans, readOnly, tacticalLocked])
  // ⚠️ …and the one fit change the effect above CANNOT journal: a sheet with no fit linked BY
  // HAND. To it that is a key arriving, like a plan that finished loading, and it stays silent
  // for both (georefTwins · fitChange) — so the ACT reports it (lib/georefMode · the three commit
  // points of `noteHandLink`) and the row is written here, once. Same guard as the re-bake: a
  // device that may not write the tactical record (viewer, `el`, replay) writes no row about it.
  // No undo of its own: the link's ↶ is whatever the act already had, and the row is append-only.
  const handLinked = useRef<(georefKey: string, pairs: GeorefPair[]) => void>(() => {})
  useEffect(() => {
    handLinked.current = (georefKey, pairs) => {
      if (readOnly || tacticalLocked) return
      const row = handLinkRow(georefKey, pairs, {
        plans: planDocs,
        known: knownSheets.current,
        aspectOf: (p) => planAspect(p, getStationPlanScales(), planScale[p.id]),
        objects,
        bake: (all, fits) => bakeAll(all, fits, appConfig.defaults.operationalLayerId),
      })
      if (row) histSide.current.log('map', row, 'layer')
    }
  })
  useEffect(() => {
    setGeorefLinkedHandler((georefKey, pairs) => handLinked.current(georefKey, pairs))
    return () => setGeorefLinkedHandler(null)
  }, [])
  const [georefPlanPreviews, setGeorefPlanPreviews] = useState<Record<string, string>>({})
  useEffect(() => {
    if (replayActive) return
    let cancelled = false
    for (const p of linkedPlans) {
      if (!p.imageUrl || !twinPlanImageVisible(twinLayers, p.id) || georefPlanPreviews[p.id]) continue
      const url = p.imageUrl.startsWith('/') || /^https?:/.test(p.imageUrl)
        ? p.imageUrl
        : `${import.meta.env.BASE_URL}${p.imageUrl}`
      void planPreviewUrl(url, window.innerWidth, window.innerHeight).then((preview) => {
        if (!cancelled) setGeorefPlanPreviews((cur) => cur[p.id] ? cur : { ...cur, [p.id]: preview })
      }).catch(() => {})
    }
    return () => { cancelled = true }
  }, [replayActive, linkedPlans, twinLayers, georefPlanPreviews])
  const georefPlanRasters = useMemo(() => replayActive ? [] : linkedPlans.flatMap((p) => {
    const url = georefPlanPreviews[p.id]
    if (!url || !twinPlanImageVisible(twinLayers, p.id)) return []
    const points = ([{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 1, y: 1 }, { x: 0, y: 1 }] as const)
      .map((pt) => { const c = p.fit.toMap(pt); return [c.lng, c.lat] as [number, number] })
    return [{
      id: p.id,
      url,
      opacity: (twinLayerOpacity[twinPlanImageLayerId(p.id)] ?? 55) / 100,
      coordinates: points as [[number, number], [number, number], [number, number], [number, number]],
    }]
  }), [replayActive, linkedPlans, georefPlanPreviews, twinLayers, twinLayerOpacity])
  // …and the other direction: what the Karte lends the OPEN sheet — the LIVE feed, and nothing
  // else (everything that is a record arrives as the sheet's own anno through the store's board
  // view). Only the raw lists travel: the Whiteboard projects and clips them against its own fit,
  // which is solved at the aspect it has actually measured (lib/planProjection · liveOverlay,
  // drawn by components/PlanLiveLayer).
  const activeLinkedPlan = linkedPlans.find((p) => p.id === activePlanId) ?? null
  /**
   * The live feed this sheet draws — vehicles and shared responder positions, projected and
   * clipped against the plan's own fit (lib/planProjection · liveOverlay).
   *
   * ⚠️ This is ALL that is lent to a sheet now (with the photo markers below, F16). Everything
   * else the Karte holds is an object,
   * and an object arrives in the sheet's own `annos` through the store's board view — drawn,
   * selected, edited and deleted with the sheet's native chrome. A GPS fix is the one thing that
   * cannot: nothing placed it, so there is nothing for the sheet to own.
   *
   * ⚠️ Hidden during replay, and only that: the vehicle feed is the present tense, and a past
   * picture must not carry it. The objects around it come from the recorded blob instead.
   */
  /*
   * …and the Karte's PHOTO markers on this sheet (F16, planProjection · photoOverlay): records,
   * unlike the feed, but shown read-only — a tap opens the picture, moving or removing it is the
   * Karte's. Shown in a replay too (the entities are the replay's then); the feed is not.
   * ONE memo for both, so the fit is read in one place.
   */
  const { planLive, planPhotos } = useMemo(() => {
    const plan = activeLinkedPlan ? planFitsRef.current.get(activeLinkedPlan.id) : undefined
    if (!plan) return { planLive: [], planPhotos: [] }
    const feed = [
      ...(isVisible(appConfig.gps.layerId) ? liveVehicles : []),
      ...livePeople.people,
    ]
    return {
      planLive: replayActive ? [] : liveOverlay(feed, plan),
      planPhotos: photoOverlay(mapEntities.filter((e) => e.kind === 'photo' && isVisible(e.layer)), plan),
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [replayActive, activeLinkedPlan, liveVehicles, livePeople.people, isVisible, fitsVersion, mapEntities])

  return { linkedPlans, floorPack, georefPlanRasters, activeLinkedPlan, planLive, planPhotos }
}
