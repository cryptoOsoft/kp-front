// «Karte & Objekte» — an object's plans, in the Einsatz's grammar (docs/karte-objekte.md):
//
//   · the tablet's left rail: Karte · Checkliste, always (owner, 19.10.2026), and under a hairline
//     the selected object's module monograms · Gebäude, with its name standing under them (the
//     NavRail's classes and glyphs — components/PlanGlyph);
//   · a module opens in THE Einsatz's plan reader (owner, 17.10.2026 · R2: «the normal pdf viewer
//     we have just without the annotation»): the Plan surface's own `Whiteboard`, read-only — the
//     same page, pan/zoom and ± / Einpassen a locked device reads a plan with, and for a module
//     the catalogue marks `viewer` the same scrolling reader the Einsatz opens there — on the
//     plan's CURRENT revision. It is handed no Einsatz: no annotations, no writer, no binding, no
//     calibration, no Passung (`KartePlanBoard`, pinned by KarteApp.test) — the viewer binds
//     nothing (lib/karte/plans);
//   · «Gebäude» is THE Einsatz's Gebäude (owner, review round 4: «literally 1:1 the same as in the
//     normal incident just without editing»): the same Whiteboard on its floor stack, fed with the
//     object's floor pack instead of an incident's binding (lib/karte/gebaeude), read-only like a
//     module — storey labels, the stack, its zoom; no picking, no storey added or removed, no
//     drawing, no calibration. Only when no pack can be built from what is published (no page
//     aspect) does the plain storey list of round 2 stand in (`KarteFloors`);
//   · the chip row at the foot: back to the object on the Karte — the one way back (owner,
//     review round 3: «Auf der Karte» beside it was struck; the aligned plan stays in Ebenen);
//   · over the plan, a calm chip while the sharper picture of THIS view is still coming over the
//     network — and, when it cannot come (offline, not stored), that it needs the network instead
//     of staying soft without a word (owner, review round 3, lib/planSharpness).

import { Suspense, useEffect, useMemo, useState } from 'react'
import { appConfig } from '../../config/appConfig'
import { Icon } from '../../lib/icons'
import { cx } from '../../lib/cx'
import { RAIL_COMPACT, RAIL_WIDE, railMonoMax } from '../../lib/navRail'
import { useRail } from '../../lib/useRail'
import { getApprovedPlanAlignments, referenceUrl, type PlanFloor } from '../../lib/incidents'
import { floorPackOf, packBuildingDoc, PACK_TRIM_MS, trimmedPackFrame, type FloorPackView } from '../../lib/floorPackBinding'
import { objectFloorBinding } from '../../lib/karte/gebaeude'
import { planKey, planPdfUrl } from '../../lib/karte/availability'
import { loadTileManifest, tileSource, type TileManifest } from '../../lib/planTiles'
import type { StationObject } from '../../lib/api/stationReference'
import type { ViewerPlanDoc } from '../../lib/karte/plans'
import { floorLabel, withPdfPage } from '../../lib/whiteboard'
import { fillTemplate } from '../../lib/format'
import type { Lamp } from '../../lib/karte/availability'
import { planRegionCropUrl, regionInkBox } from '../../lib/pdfRaster'
import { PlanGlyph } from '../PlanGlyph'
import { LoadingStatus, ShellLoader } from '../ShellLoader'
import type { BoardHistory } from '../useBoardDoc'
import type { useSymbols } from '../../lib/useSymbols'
import type { BoardAnno, BuildingDoc } from '../../types'
import { delayedSharpness, PlanSharpnessContext, sharpChip, type PlanSharpness, type PlanSharpnessHooks } from '../../lib/planSharpness'
import { Whiteboard } from '../../workspace/lazySurfaces'
import { LampDot } from './KarteDevice'
import s from './Karte.module.css'

/** The tablet's left rail, always there (owner, 19.10.2026): the two surfaces — Karte and
 *  Checkliste, the Einsatz tab's word and glyph — and, with an object selected, its documents
 *  below a hairline. No object name under them (owner 20.10.2026: the plan's own bar already
 *  names it).
 *  It expands like the Einsatz's NavRail (owner, review round 5: «we can't expand the left toolbar
 *  so people might not know what it actually is»): the same chevron on top, grip and widths
 *  (lib/useRail – it publishes `--rail-w`, which the object panel, the plan reader,
 *  the floor list and the Checkliste surface sit beside). Open per mount, as there.
 *  Keep this navigation collapsible regardless of «Beschriftung»: applying the saved toolbar
 *  label preference replaced its chevron and grip with stacked captions (regression 20.10.2026). */
export function KarteNavRail({ obj, docs, active, onMap, onLibrary, onDoc, notHeld }: {
  /** the selected object; null = only the two surfaces */
  obj: StationObject | null
  docs: ViewerPlanDoc[]
  /** what is open: the map, the Checkliste surface, or one of the documents */
  active: 'map' | 'library' | { doc: string }
  onMap: () => void
  onLibrary: () => void
  onDoc: (id: string) => void
  /** offline: the documents this device does not hold — dimmed, still tappable (the surface says why) */
  notHeld?: ReadonlySet<string> | null
}) {
  const nav = appConfig.copy.navRail
  const C = appConfig.copy.karte
  const library = appConfig.copy.modes.checklists
  const plans = obj && docs.length > 0
  const openDoc = typeof active === 'object' ? active.doc : null
  const [expanded, setExpanded] = useState(false)
  const { scrollRef, edge, dragging, nudge, apply, gripProps } = useRail({
    varName: '--rail-w',
    compactW: RAIL_COMPACT,
    wideW: RAIL_WIDE,
    side: 'left',
    expanded, setExpanded,
    itemCount: plans ? docs.length + 2 : 2,
    activeSelector: '.nav-item.on',
    revealKey: `${openDoc ?? active}·${plans ? docs.length : 0}`,
    dragClass: 'rail-dragging',
  })
  const shown = plans ? docs.map((d) => d.doc) : []
  return (
    <nav className={cx('navrail rail', expanded && 'expanded', dragging && 'dragging')}
      aria-label={obj?.name ?? C.title} data-mono-max={railMonoMax(shown)}>
      <button type="button" className="nav-exp rail-exp" onClick={() => apply(!expanded)} aria-expanded={expanded} aria-label={expanded ? nav.collapse : nav.expand}>
        <span className="nav-exp-ic rail-exp-ic"><Icon id="chevron" className="chev" /></span><span className="rail-exp-t">{expanded ? nav.collapse : nav.expand}</span>
      </button>
      <div className="rail-scroll-wrap">
        {edge.top && <button type="button" className="nav-more rail-more rail-more-up" aria-label={nav.scrollMore} onClick={() => nudge(-1)}><Icon id="chevron-down" /></button>}
        {edge.bottom && <button type="button" className="nav-more rail-more rail-more-down" aria-label={nav.scrollMore} onClick={() => nudge(1)}><Icon id="chevron-down" /></button>}
        <div ref={scrollRef} className={cx('nav-scroll rail-scroll', edge.top && 'more-top', edge.bottom && 'more-bottom')}>
          <button type="button" className={cx('nav-item', active === 'map' && 'on')} aria-pressed={active === 'map'} aria-label={nav.map} onClick={onMap}>
            <span className="nav-glyph"><Icon id="map" /></span>
            <span className="nav-label">{nav.map}</span>
          </button>
          <button type="button" className={cx('nav-item', active === 'library' && 'on')} aria-pressed={active === 'library'} aria-label={library} onClick={onLibrary} data-karte-library="">
            <span className="nav-glyph"><Icon id="checklist" /></span>
            <span className="nav-label">{library}</span>
          </button>
          {plans && <div className="nav-sep rail-sep" />}
          {plans && docs.map(({ doc, row }) => {
            const off = !!notHeld?.has(doc.id)
            const label = off ? fillTemplate(C.railNotStored, { t: doc.title }) : doc.title
            return (
            <button key={doc.id} type="button" className={cx('nav-item', openDoc === doc.id && 'on', off && s.navOff)} aria-pressed={openDoc === doc.id} aria-label={label} title={off ? label : undefined} onClick={() => onDoc(doc.id)}>
              <PlanGlyph doc={doc} />
              {/* the sheet's row word («Modul 1», «Gebäude»), as the panel lists it – the bare code
                  repeated the chip */}
              <span className="nav-label">{row}</span>
            </button>
            )
          })}
        </div>
      </div>
      <button type="button" className={cx('nav-grip rail-grip', dragging && 'drag')} aria-label={nav.resize} {...gripProps} />
    </nav>
  )
}

/** A module PDF or the Gebäude stack, over the map. */
export function KarteSurface({ obj, doc, phone, sym, onMap, offline = false, held = null, gebaeude = null }: {
  obj: StationObject
  doc: ViewerPlanDoc
  phone: boolean
  /** the symbol pack the Einsatz's plan reader is handed (it draws none here — nothing is placed) */
  sym: ReturnType<typeof useSymbols>
  onMap: () => void
  /** no network right now */
  offline?: boolean
  /** this device holds the open document (null = not asked yet / cannot tell — no chip) */
  held?: boolean | null
  /** the Gebäude stack's availability, for «some storeys are missing» */
  gebaeude?: Lamp | null
}) {
  const C = appConfig.copy.karte
  // offline and not on the device: say so instead of a reader that would spin on a dead fetch
  const missing = offline && held === false
  const partFloors = offline && !doc.plan && gebaeude === 'part'
  return (
    <div className={cx(s.surface, !missing && s.reader)}>
      <div className={s.surfaceBody}>
        {missing
          ? <div className={s.surfaceNote}><div className={s.note}><Icon id="info" /><span>{doc.plan ? C.planOfflineMissing : C.floorsOfflineMissing}</span></div></div>
          : doc.plan
            ? <KartePlanBoard key={doc.doc.imageUrl} obj={obj} doc={doc} sym={sym} offline={offline} />
            : <KarteGebaeudeBoard key={obj.plans.map((p) => `${p.id}@${p.version}`).join('|')} obj={obj} doc={doc} sym={sym} offline={offline} partOffline={partFloors} />}
      </div>
      <div className={s.chipRow}>
        {/* the way back is a back: «‹ Zurück» / «‹ Objekt» (owner, 28.10.2026 – it wore the building
            outline). A floating chip and not a BackRow: a frameless row would vanish on the plan. */}
        <button type="button" className="wb-scale-chip" onClick={onMap}><Icon id="chevron-left" />{phone ? C.backToMap : obj.name}</button>
        {/* the mockup's lamp chip: always on the tablet, on the phone only when it matters (offline) */}
        {held != null && (!phone || offline) && (
          <span className="wb-scale-chip wb-scale-status" role="status"><LampDot lamp={held ? 'device' : 'online'} />{held ? C.planOnDevice : C.planOnlineOnly}</span>
        )}
      </div>
    </div>
  )
}

const NO_ANNOS: BoardAnno[] = []
const NOTHING = () => {}

/**
 * One module in the Einsatz's plan reader with no Einsatz behind it. ⚠️ What makes it read-only
 * is not a flag alone but what it is NOT handed: `readOnly` folds every drawing tool, editor and
 * floor control away (and the slim rail too — `slimTools` off: no Auswahl over an empty sheet),
 * `linkViewer` drops the Maßstab / Passung chips (the doors to a calibration and to «Karte
 * verknüpfen»), and every writer the reader has is a no-op: `onChange`, `log`, `emit`, the
 * history. No `onCalibrate`, no `onObjectSwitch`, no `incidentId` — so nothing can be stored
 * under an Einsatz, because there is none.
 */
export function KartePlanBoard({ obj, doc, sym, offline = false, building = null, floorPack = null, note = null }: {
  obj: StationObject; doc: ViewerPlanDoc; sym: ReturnType<typeof useSymbols>; offline?: boolean
  /** the Gebäude: the stack the object's floor pack seeds (KarteGebaeudeBoard) — null for a module */
  building?: BuildingDoc | null
  floorPack?: FloorPackView | null
  /** a quiet line over the board instead of the sharpness chip (the Gebäude offline: storeys missing) */
  note?: string | null
}) {
  // the reader keeps its own (always empty) undo stacks in its caller's state
  const [hist, setHist] = useState<BoardHistory>({})
  // how sharp the reader's current view is (lib/planSharpness): the first «not yet» waits a moment,
  // so a quick load never flashes the chip
  const [sharp, setSharp] = useState<PlanSharpness>('sharp')
  const delayed = useMemo(() => delayedSharpness(setSharp), [])
  useEffect(() => () => delayed.cancel(), [delayed])
  const hooks = useMemo<PlanSharpnessHooks>(() => ({ report: delayed.report, prefetchNext: true }), [delayed])
  return (
    <PlanSharpnessContext.Provider value={hooks}>
    {note ? <div className={cx(s.sharpChip, s.sharpOff)} role="status"><span className={s.sharpText}><Icon id="warn" />{note}</span></div> : <PlanSharpChip state={sharpChip(sharp, offline)} />}
    <Suspense fallback={<div className="whiteboard"><div className="workspace-loading"><LoadingStatus size="surface">{appConfig.copy.loading}</LoadingStatus></div></div>}>
      <Whiteboard
        plans={[doc.doc]}
        activeId={doc.doc.id}
        annos={NO_ANNOS}
        onChange={NOTHING}
        readOnly
        slimTools={false}
        linkViewer
        building={building}
        floorPack={floorPack}
        onSelectBuilding={NOTHING}
        onAddFloor={NOTHING}
        onRemoveFloor={NOTHING}
        sym={sym}
        onRecent={NOTHING}
        log={NOTHING}
        emit={NOTHING}
        hist={hist}
        setHist={setHist}
        focus={null}
        // the chip over the sheet names the object these plans are of, as in an Einsatz
        objectName={obj.name}
        objectAddress={obj.address}
      />
    </Suspense>
    </PlanSharpnessContext.Provider>
  )
}

type GebaeudeState = { building: BuildingDoc; view: FloorPackView } | 'list' | null

/**
 * The object's Gebäude in the Einsatz's own Whiteboard (owner, review round 4). The floor pack is
 * bound in memory exactly as an Einsatz binds it (lib/karte/gebaeude · objectFloorBinding — never
 * stored), turned into the pack view (lib/floorPackBinding · floorPackOf) and the stack
 * (`packBuildingDoc`) with the frame measured off the pages like the Einsatz's seed
 * (`trimmedPackFrame`, bounded by `PACK_TRIM_MS`). Handed to `KartePlanBoard`, whose read-only
 * Whiteboard has no door to an edit: no building pick (`onBuildingFace` absent), no storey added or
 * removed (`readOnly` + a pack stack), no compass turn (`onReorient` absent), no tools.
 */
function KarteGebaeudeBoard({ obj, doc, sym, offline, partOffline }: {
  obj: StationObject; doc: ViewerPlanDoc; sym: ReturnType<typeof useSymbols>; offline: boolean; partOffline: boolean
}) {
  const C = appConfig.copy.karte
  const [state, setState] = useState<GebaeudeState>(null)
  // keyed by the plans' identity from the caller, so a different object mounts afresh
  useEffect(() => {
    let alive = true
    void (async () => {
      const rs = await Promise.allSettled(obj.plans.map(async (p) => [planKey(p), await getApprovedPlanAlignments(p.id, p.version)] as const))
      const metas = new Map(rs.flatMap((r) => (r.status === 'fulfilled' ? [r.value] : [])))
      // a pack the station has not aligned yet: the page's own size stands in for the fit's aspect
      const pages = new Map<string, TileManifest | null>()
      await Promise.all(obj.plans.filter((p) => metas.get(planKey(p))?.floors?.length).map(async (p) => {
        const source = tileSource(planPdfUrl(p))
        pages.set(planKey(p), source ? await loadTileManifest(source).catch(() => null) : null)
      }))
      const binding = objectFloorBinding(obj, metas, (k, page) => {
        const pg = pages.get(k)?.pages.find((x) => x.page === page)
        return pg && pg.heightPt > 0 ? pg.widthPt / pg.heightPt : null
      })
      const view = binding ? floorPackOf([binding], obj.id) : null
      if (!binding || !view) { if (alive) setState('list'); return }
      const frame = await Promise.race([
        trimmedPackFrame(view, regionInkBox).catch(() => view.frame),
        new Promise<[number, number, number, number]>((done) => setTimeout(() => done(view.frame), PACK_TRIM_MS)),
      ])
      const building = packBuildingDoc(view, frame, binding.id)
      if (alive) setState(building ? { building, view } : 'list')
    })()
    return () => { alive = false }
  }, [obj])
  if (state === 'list') return <KarteFloors obj={obj} partOffline={partOffline} />
  if (!state) return <div className="whiteboard"><div className="workspace-loading"><LoadingStatus size="surface">{appConfig.copy.loading}</LoadingStatus></div></div>
  return <KartePlanBoard obj={obj} doc={doc} sym={sym} offline={offline} building={state.building} floorPack={state.view} note={partOffline ? C.floorsPartOffline : null} />
}

/** «Schärfere Ansicht wird geladen …» over the plan — the Shell trail every in-app wait wears —
 *  or, when the sharper tiles cannot be had, why. Says nothing while the view is sharp. */
function PlanSharpChip({ state }: { state: ReturnType<typeof sharpChip> }) {
  const C = appConfig.copy.karte
  if (!state) return null
  return (
    // offline wears the bar's own offline dot and amber (the «Offline» chip), a failure the warn glyph
    <div className={cx(s.sharpChip, state === 'offline' && s.sharpOff)} data-sharp={state}>
      {state === 'loading'
        ? <LoadingStatus>{C.planSharpening}</LoadingStatus>
        : <span className={s.sharpText} role="status">{state === 'offline' ? <span className={s.offDot} aria-hidden /> : <Icon id="warn" />}{state === 'offline' ? C.planSharpOffline : C.planSharpFailed}</span>}
    </div>
  )
}

interface FloorDrawing { key: string; index: number; name: string | null; url: string; clip: [number, number, number, number] }

/** Every storey the station prepared for this object, top floor first. The floor list of each plan
 *  revision comes from its published alignment metadata (offline-cached, lib/api/reference). */
function KarteFloors({ obj, partOffline }: { obj: StationObject; partOffline: boolean }) {
  const C = appConfig.copy.karte
  const [drawings, setDrawings] = useState<FloorDrawing[] | null>(null)
  const [failed, setFailed] = useState(false)
  // keyed by the plans' identity from the caller, so a different object mounts a fresh list
  useEffect(() => {
    let alive = true
    void Promise.allSettled(obj.plans.map(async (p) => ({ p, meta: await getApprovedPlanAlignments(p.id, p.version) }))).then((rs) => {
      if (!alive) return
      const out: FloorDrawing[] = []
      for (const r of rs) {
        if (r.status !== 'fulfilled') continue
        const { p, meta } = r.value
        for (const f of (meta.floors ?? []) as PlanFloor[]) {
          out.push({
            key: `${p.id}:${f.index}:${f.part ?? 0}`,
            index: f.index,
            name: f.name,
            url: withPdfPage(referenceUrl(p.id, p.version), f.page),
            clip: f.clip ?? [0, 0, 1, 1],
          })
        }
      }
      out.sort((a, b) => b.index - a.index || a.key.localeCompare(b.key))
      if (!out.length && rs.some((r) => r.status === 'rejected')) setFailed(true)
      setDrawings(out)
    })
    return () => { alive = false }
  }, [obj.plans])
  if (failed) return <div className={s.floors}><div className={s.note}><Icon id="warn" /><span>{C.floorsFailed}</span></div></div>
  if (!drawings) return <div className={s.floors}><div className={s.floorWait}><ShellLoader /></div></div>
  return (
    <div className={s.floors}>
      {partOffline && <div className={cx(s.note, s.amber)}><Icon id="warn" /><span>{C.floorsPartOffline}</span></div>}
      {drawings.map((d) => (
        <section key={d.key} className={s.floor}>
          <div className={s.floorHead}>{floorLabel(d.index)}{d.name && <small>{d.name}</small>}</div>
          <FloorImage url={d.url} clip={d.clip} />
        </section>
      ))}
    </div>
  )
}

function FloorImage({ url, clip }: { url: string; clip: [number, number, number, number] }) {
  const C = appConfig.copy.karte
  const [src, setSrc] = useState<string | null>(null)
  const [failed, setFailed] = useState(false)
  // mounted per drawing (keyed by the caller), so the bake is asked once per storey
  useEffect(() => {
    let alive = true
    planRegionCropUrl(url, clip).then((c) => { if (alive) setSrc(c.url) }).catch(() => { if (alive) setFailed(true) })
    return () => { alive = false }
  }, [url, clip])
  if (failed) return <div className={s.floorWait}>{C.floorFailed}</div>
  if (!src) return <div className={s.floorWait}><ShellLoader /></div>
  return <img className={s.floorImg} src={src} alt="" />
}
