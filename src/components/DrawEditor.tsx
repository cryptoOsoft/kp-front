import { LoadingStatus } from './ShellLoader'
import { Fragment, useEffect, useRef, useState } from 'react'
import { prefersReducedMotion } from '../lib/reducedMotion'
import { Icon } from '../lib/icons'
import { Combo } from './Combo'
import { CtxShell, SheetGrip, useSheetDrag } from './SheetGrip'
import { appConfig } from '../config/appConfig'
import { fillTemplate } from '../lib/format'
import { HATCH_CHIP_VB, HatchDefs, LineStylePicker, hatchPatternId } from '../lib/draw'
import { DEFAULT_INK, markerGlyph } from '../lib/lineStyle'
import { fmtDistance, fmtArea, hoseSplit } from '../lib/geo'
import { CONTENT_LABELS } from '../lib/lineDecor'
import { floorBadge } from '../lib/symbolRender'
import { cx } from '../lib/cx'
import { useLineProfile } from '../lib/useLineProfile'
import { onSiteKnown } from '../lib/gpsReturn'
import { useCommitDraftOnUnmount } from '../lib/useCommitDraftOnUnmount'
import { ProfileChart, ProfileStats } from './ProfileChart'
import { Stepper } from './Stepper'
import { Button, IconButton } from './Button'
import { MenuPick } from './MenuPick'
import { Menu } from '../lib/overlays'
import { OnOff, Segmented } from './Segmented'
import { AddRelayButton, WaterRelay } from './WaterRelay'
import { HOSE_SIZES, HOSES, hoseDefaults, lineHose, relayAddPatch } from '../lib/hydraulics'
import { useLineMeasureAsk, usePublishRelay, useRelay, type RelayValue } from '../lib/useRelay'
import type { HoseSize, LineAttachment, LineContent, LineEndpoint, LngLat, LineRoutingMode, RelaySettings } from '../types'

// small glyph for the line-ending picker: plain · arrow · arrow with Entwicklungsgrenze · FKS
// Teilstück "E"-fork.
// ⚠️ Both arrows are the MAP's own arrowhead (lib/mapImages · the `draw-arrow` / `draw-arrow-stop` SDF
// sprite) scaled into this box: a FILLED, notched head and a SOLID bar just past the tip, in the
// sprite's proportions — the bar is ~1/7 of the head's length thick and spans ~9/10 of its width.
// Sketched as an outlined chevron with a hairline tick, the preview promised something far
// lighter than the Lage actually draws; a picker has to show the picture it will make.
function EndingGlyph({ kind }: { kind: 'none' | 'arrow' | 'arrowStop' | 'teilstueck' }) {
  // ⚠️ 24px wide, not 36 (01.09.). The shaft is not the subject — the END is, and four long lines
  // side by side made the Abschluss row twice as wide as anything else in the panel while saying
  // nothing extra. The stub is just enough to show WHICH end the decoration is on.
  const tip = kind === 'arrowStop' ? 19.4 : 23
  const base = tip - 13     // head length — unchanged, it is the thing being chosen
  const notch = tip - 10.1  // the concave tail
  const shaftEnd = kind === 'none' ? 22 : kind === 'teilstueck' ? 12 : base + 1
  return (
    <svg width="24" height="14" viewBox="0 0 24 14" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <line x1="2" y1="7" x2={shaftEnd} y2="7" />
      {(kind === 'arrow' || kind === 'arrowStop') && (
        <path d={`M${tip},7 L${base},0.5 L${notch},7 L${base},13.5 Z`} fill="currentColor" stroke="none" />
      )}
      {kind === 'arrowStop' && <rect x="21.2" y="1.2" width="1.8" height="11.6" fill="currentColor" stroke="none" />}
      {kind === 'teilstueck' && (
        <>
          <line x1="13" y1="2" x2="13" y2="12" />
          <line x1="13" y1="2" x2="21" y2="2" />
          <line x1="13" y1="7" x2="21" y2="7" />
          <line x1="13" y1="12" x2="21" y2="12" />
        </>
      )}
    </svg>
  )
}

const COLORS = appConfig.drawing.colors

/** The style fields a line/area/circle exposes — model-agnostic so a Lage `Drawing` and a Plan
 *  `BoardAnno` can both drive the SAME editor (callers map their object → these primitives). */
export interface DrawStyle {
  kind: 'line' | 'area' | 'circle' | 'draw'
  color?: string
  width?: number
  dashed?: boolean
  label?: string
  marker?: string
  arrow?: boolean
  arrowStop?: boolean
  showDistance?: boolean
  fillOpacity?: number
  hatch?: boolean
  radiusM?: number
  // FKS hose-line annotations
  teilstueck?: boolean
  content?: LineContent
  lineNo?: number
  floorTag?: number
  // Abschnitt fields (areas only — see types.ts · Drawing)
  abschnittLeiter?: string
  abschnittAuftrag?: string
  /** the Atemschutz link anchor (Drawing/BoardAnno · truppId) */
  truppId?: string
  /** a line drawn as a Wand (BoardAnno · role, Drawing · role): the head says «Wand» */
  role?: 'wand'
  /** the Leitung's hose and Wassertransport assumptions (Drawing/BoardAnno · hose, relay) */
  hose?: HoseSize
  relay?: RelaySettings
  startAttachment?: LineAttachment
  endAttachment?: LineAttachment
}

interface Props {
  drawing: DrawStyle
  /** how many vertices the shape has, for the header subtitle (circle uses its radius instead) */
  pointCount: number
  /** read-only surface (viewer role, Führungsansicht, replay): keep everything that
   *  ANSWERS a question — Messung, Höhenprofil, Verbindungen, «springe zu» — and drop every
   *  control that would change the shape. The EL must be able to ask how long the Leitung is
   *  without being able to move it. */
  readOnly?: boolean
  /** area + perimeter of an area/circle, so the Messung section states what the shape covers
   *  (a line uses `lengthM` instead). Absent → the rows are omitted. */
  areaM2?: number | null
  /** the ground box the outline occupies (lib/geo · bboxSizeM) — «wie breit ist das» about a
   *  Brandzone, asked against the map it is drawn on */
  boxM?: { widthM: number; heightM: number } | null
  perimeterM?: number | null
  /** offer the geodesic distance toggle — Lage only (a Plan has no metric scale) */
  supportsDistance?: boolean
  /** measured length of the selected line, so the Messung section can state it without the
   *  operator re-drawing it with the Messen tool. Lage passes the geodesic length, Plan the
   *  calibrated one; null/absent (uncalibrated plan, area, circle) hides the section. */
  lengthM?: number | null
  /** WGS84 path of the line, enabling the swisstopo Höhenprofil inside the Messung section.
   *  Omitted on the Plan — a building plan has no height data. */
  profileCoords?: LngLat[] | null
  onColor: (c: string) => void
  onDashed: (dashed: boolean) => void
  /** live, per keystroke — silent (see useMapDrawing · patchDrawingLabelLive) */
  onLabel: (label: string) => void
  /** blur/Enter: the one Verlauf row and the one undo step for the whole edit */
  onLabelCommit?: (label: string) => void
  onMarker: (marker: string) => void
  onArrow: (arrow: boolean) => void
  /** line end: 'none' | 'arrow' | 'teilstueck' (mutually exclusive). Absent ⇒ only the legacy arrow toggle. */
  onEnding?: (ending: 'none' | 'arrow' | 'arrowStop' | 'teilstueck') => void
  /** reverse the point order, so the Abschluss sits at the other end. Absent ⇒ the row is hidden. */
  onReverse?: () => void
  /** FKS device letter at the end (S/W/H/P) or undefined for plain Wasser */
  onContent?: (content: LineContent | undefined) => void
  /** the «Schlauch» row: the Leitung's Ø (Lage and Plan alike). Omitted ⇒ the row is hidden. */
  onHose?: (hose: HoseSize) => void
  /** the Wassertransport section inside «Messung» — Lage only: it needs real ground and the
   *  Höhenprofil (`profileCoords`). `onChange` absent ⇒ shown read-only. `lineId`: the Leitung's
   *  id, so its resting pumps on the map step aside while this section shows the live ones
   *  (components/RelayPumpMarkers). Omitted ⇒ no section. */
  waterRelay?: { onChange?: (patch: RelayValue) => void; lineId?: string }
  /** Druckleitung number + storey badge on the line (undefined clears) */
  onLineNo?: (lineNo: number | undefined) => void
  onFloorTag?: (floor: number | undefined) => void
  /** Abschnitt-Leiter on a Fläche (undefined clears). Offered only where the caller passes it —
   *  the Lage; a Plan sketch is not an Abschnitt (FKS Einsatzführung 3.5.2). */
  onAbschnittLeiter?: (name: string | undefined) => void
  /** …and the Abschnitt's Auftrag, committed on blur/Enter (one undo step, one record row) */
  onAbschnittAuftrag?: (auftrag: string | undefined) => void
  /** roster names for the Leiter picker (present people first is the caller's ordering) */
  people?: string[]
  /** how many Flächen already carry Leiter or Auftrag, THIS one included — drives the quiet
   *  FKS hint above 4 (Richtwert 3–4 Abschnitte; a hint, never a block) */
  abschnittCount?: number
  /** link this hose to an Atemschutz-Trupp (undefined unlinks). Omitted ⇒ the row is hidden. */
  onTrupp?: (truppId: string | undefined) => void
  /** Trupps offerable in that picker (the ones still in — a Trupp that is out gets no new line) */
  trupps?: { id: string; name: string }[]
  /** the Trupp actually ON this Leitung (anchor OR number), for the «zeigen» jump. Separate from
   *  `drawing.truppId`: a Trupp matched by number alone is just as real a link. */
  truppOnLine?: string
  /** that Trupp is already out. It STAYS named here — it is the record of who worked this
   *  Leitung until someone takes it over — and reads as «draussen» rather than as the crew
   *  currently on the hose. (It is deliberately absent from the picker list: a Trupp that is out
   *  gets no new Leitung, so it can only be left as it is or replaced.) */
  truppOnLineOut?: boolean
  /** jump to the Atemschutz board for that Trupp */
  onShowTrupp?: () => void
  /** «Art: Linie | Wand» – turn the line into a Wand and back (every Plan sheet and the Karte,
   *  lib/grundriss · wallRolePatch). Omitted ⇒ the row is hidden. */
  onWand?: (wand: boolean) => void
  /** why this line cannot be a Wand (a Trupp is on it, it climbs storeys): «Wand» is offered but
   *  disabled, with this as its hint */
  wandBlocked?: string
  /** Leitung numbers already taken on THIS surface, so a duplicate can be flagged as it happens */
  usedLineNos?: number[]
  onShowDistance: (showDistance: boolean) => void
  onRadius: (radiusM: number) => void
  /** pick the fill KIND: hatched, or a flat wash at `fillOpacity`. One row, one answer. */
  onHatch?: (hatch: boolean, fillOpacity: number) => void
  /** lock the shape against accidental moves (it goes click-through; unlock via the centre
   *  lock chip). Absent → the lock control is hidden (e.g. surfaces without locking). */
  onToggleLock?: () => void
  locked?: boolean
  onDelete: () => void
  onClose: () => void
  attachmentLabels?: Partial<Record<LineEndpoint, string>>
  onRouting?: (endpoint: LineEndpoint, mode: LineRoutingMode) => void
  onDetach?: (endpoint: LineEndpoint) => void
  onFocusAttachment?: (endpoint: LineEndpoint) => void
  attachmentHidden?: Partial<Record<LineEndpoint, boolean>>
  onRevealAttachment?: (endpoint: LineEndpoint) => void
  /** An end that follows a vehicle's GPS, or has followed one (lib/gpsReturn): the words for the
   *  GPS block at the head of the panel. `since` exists only when the line kept its on-site state
   *  (`gps.before`), and that is also what offers «Zurück auf Stand am Einsatzort». */
  gpsInfo?: Partial<Record<LineEndpoint, { line: string; vehicle: string; since?: string; distance?: string; stopped?: boolean; onSite?: boolean }>>
  /** «Zurück auf Stand am Einsatzort (hh:mm)» */
  onRevertGps?: (endpoint: LineEndpoint) => void
  /** «Hier lösen (Spur behalten)»: let go where the end stands now, the drive kept as the hose */
  onDetachHere?: (endpoint: LineEndpoint) => void
}

const FILL_OPACITIES = appConfig.drawing.fillOpacities

/** The Messung's «Schläuche» value: «34 + 3 Reserve × 20 m», or «1 × 20 m» when the reserve
 *  rounds into the run's own last hose (lib/geo · hoseSplit). */
function hosesText(lengthM: number, lines: number): string {
  const { need, reserve } = hoseSplit(lengthM, lines)
  const m = appConfig.drawing.hoseLengthM
  return reserve ? fillTemplate(appConfig.copy.drawingEditor.hoseSplit, { n: need, r: reserve, m }) : `${need} × ${m} m`
}

export function DrawEditor({ drawing, pointCount, readOnly = false, areaM2, boxM, perimeterM, supportsDistance = false, lengthM, profileCoords, onColor, onDashed, onLabel, onLabelCommit, onMarker, onArrow, onEnding, onReverse, onContent, onHose, waterRelay, onLineNo, onFloorTag, onAbschnittLeiter, onAbschnittAuftrag, people = [], abschnittCount = 0, onTrupp, trupps = [], truppOnLine, truppOnLineOut = false, onShowTrupp, onWand, wandBlocked, usedLineNos = [], onShowDistance, onRadius, onHatch, onToggleLock, locked, onDelete, onClose, attachmentLabels, onRouting, onDetach, onFocusAttachment, attachmentHidden, onRevealAttachment, gpsInfo, onRevertGps, onDetachHere }: Props) {
  // The Auftrag input is uncontrolled (see its comment), so the unmount commit reads the DOM
  // node — kept, never nulled, because React detaches element refs before passive cleanups run.
  // Same idempotence guard as ContextPanel's Notizen: blur first, unmount second, one write.
  const auftragEl = useRef<HTMLInputElement | null>(null)
  const auftragCommitted = useRef<string | null>(null)
  const commitAuftrag = (v: string) => {
    if (v === auftragCommitted.current || v === (drawing.abschnittAuftrag ?? '')) return
    auftragCommitted.current = v
    onAbschnittAuftrag?.(v || undefined)
  }
  useCommitDraftOnUnmount(() => { if (auftragEl.current) commitAuftrag(auftragEl.current.value.trim()) })
  const color = drawing.color ?? DEFAULT_INK
  const dashed = !!drawing.dashed
  const isCircle = drawing.kind === 'circle'
  const isArea = drawing.kind === 'area'
  // a freehand stroke (kind 'draw') and a node line (kind 'line') style identically
  const isLine = drawing.kind === 'line' || drawing.kind === 'draw'
  const fillOpacity = drawing.fillOpacity ?? (isCircle ? appConfig.drawing.circleFillOpacity : 0.14)
  const headIcon = isCircle ? 'circle' : isArea ? 'area' : 'pen'
  const headTitle = isCircle ? appConfig.copy.drawingEditor.circle : isArea ? appConfig.copy.drawingEditor.area
    : drawing.role === 'wand' ? appConfig.copy.drawingEditor.kindWand : appConfig.copy.drawingEditor.drawing
  // ⚠️ A circle states its RADIUS instead of a point count — and only when the surface can put a
  // number on it. On an uncalibrated Kroki `radiusM` is absent (the sheet has no metric scale
  // yet), and «0 m» would be a lie about a ring that is plainly there: the subtitle and the
  // stepper below simply stay away, and the ring's own grip sizes it until the Maßstab is set.
  const hasRadius = isCircle && drawing.radiusM != null
  const headSub = isCircle ? (hasRadius ? fmtDistance(drawing.radiusM!) : '') : `${pointCount} ${appConfig.copy.drawingEditor.points}`
  const radiusM = drawing.radiusM ?? 0
  const radStep = appConfig.drawing.circleRadiusStepM
  const radMin = appConfig.drawing.circleMinRadiusM
  // Messung on an ALREADY DRAWN line: the whole group is collapsed (15.09.) – a line is mostly
  // selected to be styled or linked, and the numbers were a screen of rows in the way of that.
  // Opening it shows everything at once, Höhenprofil included: the length is free (it comes from
  // the geometry), the profile costs a swisstopo request – so it only fetches once the group is
  // opened, which also keeps a plain tap on a line offline-silent. No second toggle inside.
  // …save when the line was opened from one of its pumps on the map: then the tap was about the
  // Wassertransport, and the group opens with it (lib/useRelay · askLineMeasure) – folding it by
  // hand answers the ask.
  const measureAsk = useLineMeasureAsk(waterRelay?.lineId)
  const [measureOwn, setMeasureOwn] = useState(false)
  const measureOpen = measureOwn || measureAsk.asked
  const hasProfileCoords = isLine && !!profileCoords && profileCoords.length >= 2
  const { profile, loading: profileLoading } = useLineProfile(profileCoords ?? [], hasProfileCoords && measureOpen)
  // Wassertransport of this Leitung (components/WaterRelay): computed from the same profile and
  // ADDED from the button under the Höhenprofil, the way Messen does it — already open on a line
  // that has one set up. Its pumps stand on the map while it is open, and – with its «Pumpen auf
  // Karte» on – as Motorspritzen whenever the line is drawn (lib/linePumps). Every edit is an
  // ordinary prop edit of the line — one undo step — and a dragged pump writes once, on release
  // (lib/useRelay).
  const relayOffered = isLine && hasProfileCoords && !!waterRelay
  const [relayAdded, setRelayAdded] = useState(() => !!drawing.relay)
  const relayShown = relayOffered && relayAdded
  const relayCtrl = useRelay({
    coords: profileCoords ?? [], profile, profileLoading,
    // shown, the section IS a Wassertransport: an absent Ø reads as the relay default, as it does
    // once the relay is stored (lib/hydraulics · lineHose) – a viewer who opens one sees the same
    value: { hose: drawing.hose, relay: drawing.relay }, defaultHose: hoseDefaults().relay,
    onChange: !readOnly ? waterRelay?.onChange : undefined,
  })
  usePublishRelay(relayCtrl, relayShown && measureOpen, waterRelay?.lineId)
  // Opening «Messung» brings it to the top of the sheet's scroller: it is the LAST group, so on a
  // phone sheet the fold opened entirely below the edge and the tap seemed to do nothing
  // (20.09.2026). Again when the Höhenprofil arrives – it is most of the section's height.
  const measureRef = useRef<HTMLDivElement>(null)
  const profileReady = !!profile
  useEffect(() => {
    if (measureOpen) measureRef.current?.scrollIntoView?.({ block: 'start', behavior: prefersReducedMotion() ? 'auto' : 'smooth' })
  }, [measureOpen, profileReady])
  // rendered twice: pinned at the sheet bottom on desktop/tablet, and again inside the
  // scrolling body for phones (.ctx-footer-inline) — CSS shows exactly one copy
  const actions = readOnly ? null : (
    <div className="ctx-actions">
      {onToggleLock && (
        <button className="btn" onClick={onToggleLock} title={appConfig.copy.drawingEditor.lockHint} aria-pressed={!!locked}>
          <Icon id="lock" />{appConfig.copy.drawingEditor.lock}
        </button>
      )}
      <button className="btn warn" onClick={onDelete}><Icon id="trash" />{appConfig.copy.remove}</button>
    </div>
  )
  // the header shares the grip's drag (tap stays a tap there — see useSheetDrag)
  const sheetDrag = useSheetDrag({ onClose, tapToggles: false })
  /** a picked Ø – through the relay where there is one: a new Ø sends its pumps moved by hand back
   *  to automatic, in the same edit (lib/useRelay · set) */
  const setHose = (h: HoseSize) => {
    if (h === lineHose(drawing) || !onHose) return
    if (relayCtrl.readOnly) onHose(h); else relayCtrl.set({ hose: h })
  }
  /** one «Typ» menu entry: the letter as a small badge, the word, the tick on the current one */
  const contentItem = (c: LineContent) => ({
    label: <MenuPick badge={c} label={CONTENT_LABELS[c]} on={(drawing.content ?? 'W') === c} />,
    onClick: () => onContent?.(c === 'W' ? undefined : c),
  })
  return (
    <CtxShell className="draw-editor" onClose={onClose}>
      <SheetGrip onClose={onClose} />
      {/* the whole header drags the sheet too, not just the 44×5px grip above it */}
      <div className="ctx-head" {...sheetDrag}>
        <div className="ph" style={{ borderColor: color, color }}><Icon id={headIcon} /></div>
        <div className="ctx-titlewrap"><h3>{headTitle}</h3>{headSub && <p>{headSub}</p>}</div>
        <button className="ctx-x" onClick={onClose} title={appConfig.copy.closeDialog} aria-label={appConfig.copy.closeDialog}><Icon id="close" /></button>
      </div>
      <div className="ctx-body">
        {/* ⚠️ The GPS block LEADS while an end follows a vehicle (D3, 24.09.2026). Following is the
            one state of a Leitung that keeps changing it with nobody touching it, and its way back
            sat at the foot of the panel under «Verbindungen» — below the fold on a phone. It says
            how long and how far, and offers the three moves: back to the on-site state (the green
            primary, only where that state was kept), stop following, let go on site. The same end
            then shows no route/detach controls in «Verbindungen»: one place per question. */}
        {isLine && gpsInfo && (['start', 'end'] as const).map((endpoint) => {
          const info = gpsInfo[endpoint]
          const a = endpoint === 'start' ? drawing.startAttachment : drawing.endAttachment
          if (!info || !a?.gps) return null
          const C = appConfig.copy.drawingEditor
          const following = !info.stopped
          const words = { line: info.line, vehicle: info.vehicle }
          const head = !following ? fillTemplate(C.gpsStoppedHead, words)
            : info.since ? fillTemplate(C.gpsFollowingHead, { ...words, time: info.since }) : fillTemplate(C.gpsFollowingHeadBare, words)
          return (
            <div key={endpoint} className="de-group de-gps">
              <div className="de-gps-head">
                <Icon id="truck" />
                <div><b>{head}</b>{info.distance && <span>{fillTemplate(C.gpsDistanceNow, { distance: info.distance })}</span>}</div>
              </div>
              {!readOnly && info.since && onRevertGps && (
                <button type="button" className="de-gps-back" onClick={() => onRevertGps(endpoint)}>{fillTemplate(C.gpsRevertAt, { time: info.since })}</button>
              )}
              {!readOnly && (onRouting || onDetach || onDetachHere) && (
                <div className="de-gps-row">
                  {onRouting && (following
                    ? <Button onClick={() => onRouting(endpoint, 'direct')}>{C.gpsPause}</Button>
                    : <Button onClick={() => onRouting(endpoint, 'trace')}>{C.gpsContinue}</Button>)}
                  {/* «Am Einsatzort» only where that point is known — a trace without a kept
                      on-site line would let go at the vehicle, and the word would lie */}
                  {onDetach && info.onSite && <Button onClick={() => onDetach(endpoint)}>{C.gpsDetachOnSite}</Button>}
                  {/* a traced hose may be KEPT (24.09.2026): let go where it stands, drive and all */}
                  {(onDetachHere ?? onDetach) && <Button onClick={() => (onDetachHere ?? onDetach)!(endpoint)}>{C.gpsDetachHere}</Button>}
                </div>
              )}
            </div>
          )
        })}
        {/* shape group — the circle's radius. ⚠️ Füllung is NOT here any more (01.09.): it sat in
            its own group directly above Farbe, so a hairline was drawn between the two rows that
            answer the same question — what colour is this thing and how solid. They belong to one
            block, and the rule now falls where the subject actually changes. */}
        {!readOnly && hasRadius && (
          <div className="de-group">
            <div className="de-row"><span>{appConfig.copy.drawingEditor.radius}</span>
              <Stepper value={radiusM} min={radMin} max={100000} step={radStep} format={fmtDistance}
                onChange={onRadius} ariaLabel={appConfig.copy.drawingEditor.radius} />
            </div>
          </div>
        )}

        {/* ⚠️ A line LEADS with its Abschluss (owner, sweep 27.10.2026 #7): Abschluss (+ Richtung
            umkehren) → Linie → Farbe → Text/Marker → the rest. What a line's end says (Pfeil,
            Entwicklungsgrenze, Teilstück) is what a line is selected for most; it sat under
            Farbe, Stärke, Linie, Text and Marker, below the fold on a phone sheet. */}
        {!readOnly && isLine && (
          <div className="de-group">
            {onEnding ? (
              <div className="de-row"><span>{appConfig.copy.drawingEditor.ending}</span>
                <Segmented
                  ariaLabel={appConfig.copy.drawingEditor.ending}
                  value={drawing.teilstueck ? 'teilstueck' : drawing.arrow ? (drawing.arrowStop ? 'arrowStop' : 'arrow') : 'none'}
                  onChange={onEnding}
                  // ⚠️ `explain` (lib/holdTooltip · data-holdexplain): four pictures whose
                  // NAMES were all a hold ever gave, and the names are the least of it — «Pfeil mit
                  // Stopp» is the Entwicklungsgrenze, and deleting a Teilstück releases every line
                  // docked to its ports. Hold (touch) or hover (mouse) now answers with the
                  // consequence instead. No `title`: the native tooltip would say it again.
                  explain
                  options={[
                    { value: 'none', label: <EndingGlyph kind="none" />, title: appConfig.copy.drawingEditor.endingNoneWhat },
                    { value: 'arrow', label: <EndingGlyph kind="arrow" />, title: appConfig.copy.drawingEditor.endingArrowWhat },
                    { value: 'arrowStop', label: <EndingGlyph kind="arrowStop" />, title: appConfig.copy.drawingEditor.endingArrowStopWhat },
                    { value: 'teilstueck', label: <EndingGlyph kind="teilstueck" />, title: appConfig.copy.drawingEditor.endingTeilstueckWhat },
                  ]}
                />
              </div>
            ) : (
              <div className="de-row"><span>{appConfig.copy.drawingEditor.arrow}</span>
                <OnOff ariaLabel={appConfig.copy.drawingEditor.arrow} value={!!drawing.arrow} onChange={onArrow} />
              </div>
            )}
            {/* Which end the Abschluss sits at is the second half of the same question — so it sits
                in the same row block, directly under it. It does not MOVE the line: the drawn hose
                stays where it is, only its direction of travel turns around (lib/lineAttachments ·
                flipLine), and everything hooked to either end stays hooked where it physically is. */}
            {/* ⚠️ An ACTION, not a state — so it is not one of this panel's Segmented pairs and
                no longer wears their chrome (01.09.). It used to sit as a label plus a lone icon
                chip in the `.de-toggle` box, which reads as «umkehren: on/off» while nothing here
                is ever on: the row is one press that does one thing. */}
            {onReverse && (
              <button type="button" className="de-action" onClick={onReverse}>
                <Icon id="swap" />{appConfig.copy.drawingEditor.reverse}
              </button>
            )}
          </div>
        )}

        {/* style group — a line: Linie · Farbe; an area/circle: Füllung · Farbe.
            ⚠️ NO «Stärke» on any of them (owner, sweep 27.10.2026 #7: «drop it» on the line, then
            areas and circles too). A shape already drawn keeps the width it stored and a new one
            starts from DRAW_DEFAULTS; only the control is gone. */}
        {!readOnly && <div className="de-group">
          {isLine && (
            <div className="de-row"><span>{appConfig.copy.drawingEditor.lineStyle}</span>
              <span className="dh-widths">
                {/* the chains belong to the STROKE, so they sit here with solid and dashed — the
                    letter field below stays the letter field (lib/draw · LineStylePicker) */}
                <LineStylePicker dashed={dashed} onChange={onDashed} marker={drawing.marker} onMarker={onMarker} />
              </span>
            </div>
          )}
          {(isCircle || isArea) && (
            <div className="de-row"><span>{appConfig.copy.drawingEditor.fill}</span>
              <span className="dh-swatches">
                {FILL_OPACITIES.map((o) => (
                  <button key={o} className={`dh-color de-fill ${!drawing.hatch && Math.abs(fillOpacity - o) < 0.001 ? 'on' : ''}`}
                    title={`${Math.round(o * 100)} %`} aria-label={`${Math.round(o * 100)} %`}
                    style={{ background: o === 0 ? 'transparent' : color, opacity: o === 0 ? 1 : Math.max(0.25, o + 0.2) }}
                    onClick={() => onHatch?.(false, o)}>{o === 0 ? '∅' : ''}</button>
                ))}
                {/* Schraffur is a FILL, so it belongs in this row and not in a control of its own —
                    «wie ist die Fläche gefüllt» has one answer at a time. The swatch shows the
                    real pattern, in the shape's own colour (lib/draw · HatchDefs). */}
                {onHatch && (
                  <button className={`dh-color de-fill ${drawing.hatch ? 'on' : ''}`}
                    title={appConfig.copy.drawingEditor.fillHatch} aria-label={appConfig.copy.drawingEditor.fillHatch}
                    onClick={() => onHatch(true, fillOpacity)}>
                    {/* ⚠️ a CIRCLE, and three tile widths of viewBox. A square rect at the real
                        period drew one diagonal across a 30px chip and let it out past the round
                        border — the swatch read as a «no» slash, not as a Schraffur (02.09.). */}
                    <svg viewBox={`0 0 ${HATCH_CHIP_VB} ${HATCH_CHIP_VB}`} width="100%" height="100%" aria-hidden>
                      <HatchDefs colors={[color]} />
                      <circle cx={HATCH_CHIP_VB / 2} cy={HATCH_CHIP_VB / 2} r={HATCH_CHIP_VB / 2} fill={`url(#${hatchPatternId(color)})`} />
                    </svg>
                  </button>
                )}
              </span>
            </div>
          )}
          {/* No preset row (09.09., «das ganze Stil-Ding»): a line's decoration is assembled
              from the raw controls — Abschluss (Pfeil/Teilstück, the group above), Stil
              (solid/dash/Ketten), the letter field — and lib/lineStyle · lineStyleName still NAMES the
              known combinations for the Verlauf («Rettungsachse gezeichnet»). */}
          <div className="de-row"><span>{appConfig.copy.drawingEditor.color}</span>
            <span className="dh-swatches">
              {/* named like the Form editor's identical rows (ShapeEditor · the Farbe/Strichstärke
                  swatches): a chip whose whole content is a colour or a bar has no text to read
                  out, so without this the row announces «Farbe» and then four blank buttons. */}
              {COLORS.map((c) => <button key={c} className={`dh-color ${color === c ? 'on' : ''}`} style={{ background: c }} aria-label={c} onClick={() => onColor(c)} />)}
            </span>
          </div>
        </div>}

        {/* read-only: the shape's own text is the one style field worth stating — it names the
            thing («Sektor A»), and on a small marker the map label can be hard to read. The
            Abschnitt fields ride along: who leads it is exactly what a Führungsansicht asks.
            …and a Leitung's FKS facts, each only where it is set (RBAC audit 22.10.2026): what
            it carries, on which storey, its number and the Trupp on it — the jump to that
            Trupp's card stays, it changes nothing. */}
        {readOnly && ((drawing.label ?? '').trim() || drawing.abschnittLeiter || drawing.abschnittAuftrag) && (
          <div className="de-group">
            {(drawing.label ?? '').trim() && (
              <div className="de-row"><span>{appConfig.copy.drawingEditor.label}</span>
                <b className="de-measure-v">{drawing.label}</b>
              </div>
            )}
            {drawing.abschnittLeiter && (
              <div className="de-row"><span>{appConfig.copy.drawingEditor.abschnittLeiter}</span>
                <b className="de-measure-v">{drawing.abschnittLeiter}</b>
              </div>
            )}
            {drawing.abschnittAuftrag && (
              <div className="de-row"><span>{appConfig.copy.drawingEditor.abschnittAuftrag}</span>
                <b className="de-measure-v">{drawing.abschnittAuftrag}</b>
              </div>
            )}
          </div>
        )}

        {readOnly && isLine && (drawing.content || drawing.hose || drawing.floorTag != null || drawing.lineNo != null || truppOnLine) && (
          <div className="de-group">
            {drawing.content && (
              <div className="de-row"><span>{appConfig.copy.drawingEditor.content}</span>
                <b className="de-measure-v">{CONTENT_LABELS[drawing.content]}</b>
              </div>
            )}
            {drawing.hose && (
              <div className="de-row"><span>{appConfig.copy.drawingEditor.hose}</span>
                <b className="de-measure-v">{appConfig.copy.relay.hoseLabels[drawing.hose]}</b>
              </div>
            )}
            {drawing.floorTag != null && (
              <div className="de-row"><span>{appConfig.copy.drawingEditor.floorTag}</span>
                <b className="de-measure-v">{floorBadge(drawing.floorTag)}</b>
              </div>
            )}
            {drawing.lineNo != null && (
              <div className="de-row"><span>{appConfig.copy.drawingEditor.lineNo}</span>
                <b className="de-measure-v">{drawing.lineNo}</b>
              </div>
            )}
            {truppOnLine && (
              <div className="de-row"><span>{appConfig.copy.drawingEditor.trupp}</span>
                <span className="de-trupp">
                  <b className={cx('de-measure-v', truppOnLineOut && 'de-trupp-out')}>{truppOnLine}</b>
                  {truppOnLineOut && <em className="de-trupp-outnote">{appConfig.copy.drawingEditor.truppOut}</em>}
                  {onShowTrupp && (
                    <IconButton onClick={onShowTrupp}
                      label={fillTemplate(appConfig.copy.drawingEditor.truppShow, { name: truppOnLine })}>
                      <span className="ctx-conn-go" aria-hidden>›</span>
                    </IconButton>
                  )}
                </span>
              </div>
            )}
          </div>
        )}

        {/* text group — Text · Marker */}
        {!readOnly && (isLine || isArea) && (
          <div className="de-group">
            <div className="de-row"><span>{appConfig.copy.drawingEditor.label}</span>
              <input className="de-input" value={drawing.label ?? ''}
                placeholder={isArea ? appConfig.copy.drawingEditor.areaLabelPlaceholder : appConfig.copy.drawingEditor.labelPlaceholder}
                onChange={(e) => onLabel(e.target.value)}
                // ⚠️ the Verlauf row is written HERE, not on every keystroke: naming a Fläche
                // «Sicherung» used to leave eleven rows, one per letter (see useMapDrawing).
                onBlur={(e) => onLabelCommit?.(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur() }} />
            </div>
            {isLine && (
              <div className="de-row"><span>{appConfig.copy.drawingEditor.marker}</span>
                {/* a chain style lives in the same field, so it would otherwise show up here as a
                    stray «▲» in a box the operator is meant to type a letter into */}
                <input className="de-input" value={markerGlyph(drawing.marker) ? '' : (drawing.marker ?? '')} placeholder={appConfig.copy.drawingEditor.markerPlaceholder} maxLength={3} onChange={(e) => onMarker(e.target.value)} />
              </div>
            )}
          </div>
        )}

        {/* Abschnitt group — the Fläche IS the Abschnitt (FKS Einsatzführung 3.5.2): who leads
            it, what it is to achieve. Only where the caller passes the handlers — the Lage; a
            Plan sketch is not an Abschnitt. Both fields feed the map label and the paper Kroki. */}
        {!readOnly && isArea && (onAbschnittLeiter || onAbschnittAuftrag) && (
          <div className="de-group">
            {onAbschnittLeiter && (
              <div className="de-row"><span>{appConfig.copy.drawingEditor.abschnittLeiter}</span>
                {/* the roster picker every leader field uses (Combo) — free typing stays open
                    for the neighbour Wehr's officer, who is on nobody's list */}
                <Combo
                  value={drawing.abschnittLeiter ?? ''}
                  options={people}
                  placeholder={appConfig.copy.drawingEditor.abschnittLeiterPlaceholder}
                  allowCustom
                  // a typed name is committed ONCE, from the «‹X› verwenden» row (Combo · Gast
                  // door), so the record (undo step + Verlauf row) is one row, never a keystroke
                  onChange={(v) => onAbschnittLeiter(v || undefined)}
                />
              </div>
            )}
            {onAbschnittAuftrag && (
              <div className="de-row"><span>{appConfig.copy.drawingEditor.abschnittAuftrag}</span>
                {/* uncontrolled + keyed: committed ONCE on blur/Enter (one undo step, one record
                    row — the same reason the label splits live/commit), and a synced value
                    arriving from another device re-keys the field rather than fighting a draft */}
                <input className="de-input" key={drawing.abschnittAuftrag ?? ''} defaultValue={drawing.abschnittAuftrag ?? ''}
                  ref={(el) => { if (el) auftragEl.current = el }}
                  placeholder={appConfig.copy.drawingEditor.abschnittAuftragPlaceholder}
                  onBlur={(e) => commitAuftrag(e.target.value.trim())}
                  onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur() }} />
              </div>
            )}
            {/* the FKS Richtwert, as a hint and never a gate — counted over Flächen that carry
                Leiter or Auftrag, so plain drawn Sektoren don't trip it */}
            {abschnittCount > 4 && (
              <div className="de-warn"><Icon id="warn" />{appConfig.copy.drawingEditor.abschnittMaxHint}</div>
            )}
          </div>
        )}

        {/* FKS line group — Inhalt · Stockwerk · Leitung-Nr · Trupp (the Abschluss leads the sheet) */}
        {!readOnly && isLine && (
          <div className="de-group">
            {/* «Typ: [W] Wasser ⌄» (owner, 28.10.2026, pick 19A): ONE row, as tall as Geschoss /
                Leitung / Trupp, opening the same Menu + MenuPick as «Gehört zu Trupp». It was a row of
                seven chips with bare letters (S H P N T G) that only a hold explained. Now every
                entry carries its letter AND its word, so the FKS letters are learned on the way.
                W = Wasser, the default: a Druckleitung with no letter IS a water line, so picking
                it stores nothing (and a line stored with content 'W' reads as Wasser too). A rule
                splits the Leitungen (W WW S H P) from the Vegetationsbrand-Haltelinien (N T G):
                the same question about a different line. */}
            {onContent && (
              <div className="de-row"><span>{appConfig.copy.drawingEditor.content}</span>
                <Menu
                  trigger={
                    <button className="de-menu-trigger" aria-label={`${appConfig.copy.drawingEditor.content}: ${CONTENT_LABELS[drawing.content ?? 'W']}`}>
                      <span className="de-menu-badge" aria-hidden>{drawing.content ?? 'W'}</span>
                      <span>{CONTENT_LABELS[drawing.content ?? 'W']}</span>
                      <Icon id="chevron-down" className="chev" />
                    </button>
                  }
                  popupClassName="de-menu-pop"
                  itemClassName={() => 'de-menu-item'}
                  items={[
                    ...(['W', 'WW', 'S', 'H', 'P'] as const).map((c) => contentItem(c)),
                    { kind: 'sep' as const },
                    ...(['N', 'T', 'G'] as const).map((c) => contentItem(c)),
                  ]}
                />
              </div>
            )}
            {/* «Schlauch»: the Leitung's Ø, right under what it carries. It is what the Messung's
                Wassertransport computes with (lib/hydraulics · HOSES); absent reads as the
                station's relay default on a Leitung with a Wassertransport, else its Linie default
                (hydraulics · lineHose). The «Typ» row's menu, every Ø with its unit, the current
                one ticked (owner 05.11.2026: as five chips «110» wrapped onto a row of its own on
                the iPhone – and in the tablet's 360px sheet just the same). */}
            {onHose && (
              <div className="de-row"><span>{appConfig.copy.drawingEditor.hose}</span>
                <Menu
                  trigger={
                    <button className="de-menu-trigger" aria-label={`${appConfig.copy.drawingEditor.hose}: ${appConfig.copy.relay.hoseLabels[lineHose(drawing)]}`}>
                      <span>{appConfig.copy.relay.hoseLabels[lineHose(drawing)]}</span>
                      <Icon id="chevron-down" className="chev" />
                    </button>
                  }
                  popupClassName="de-menu-pop"
                  itemClassName={() => 'de-menu-item'}
                  items={HOSE_SIZES.map((h) => ({
                    label: <MenuPick label={appConfig.copy.relay.hoseLabels[h]} on={lineHose(drawing) === h} />,
                    onClick: () => setHose(h),
                  }))}
                />
              </div>
            )}
            {/* `seedOnDec`: a Leitung goes into a Keller as often as up a Treppe, so the first tap
                on − seeds EG (0) exactly like +, and the next − is −1. Same stepper as the
                Geschoss rows in the symbol panel (ContextPanel). */}
            {onFloorTag && (
              <div className="de-row"><span>{appConfig.copy.drawingEditor.floorTag}</span>
                <Stepper value={drawing.floorTag ?? null} min={-9} max={40} seed={0} seedOnDec format={floorBadge} placeholder="–"
                  onChange={(v) => onFloorTag(v)} onClear={() => onFloorTag(undefined)} canClear={drawing.floorTag != null}
                  ariaLabel={appConfig.copy.drawingEditor.floorTag} />
              </div>
            )}
            {onLineNo && (
              <div className="de-row"><span>{appConfig.copy.drawingEditor.lineNo}</span>
                <Stepper value={drawing.lineNo ?? null} min={1} max={99} placeholder="–"
                  onChange={(v) => onLineNo(v)} onClear={() => onLineNo(undefined)} canClear={drawing.lineNo != null}
                  ariaLabel={appConfig.copy.drawingEditor.lineNo} />
              </div>
            )}
            {/* A second «Leitung 1» on the same surface makes the number ambiguous — and the number
                is what an Atemschutz-Trupp is matched on. Warn rather than refuse: a real incident
                sometimes needs the wrong thing typed for a moment. */}
            {onLineNo && drawing.lineNo != null && usedLineNos.includes(drawing.lineNo) && (
              <p className="de-warn"><Icon id="warn" /><span>{fillTemplate(appConfig.copy.drawingEditor.lineNoDuplicate, { n: String(drawing.lineNo) })}</span></p>
            )}
            {/* «Gehört zu Trupp …» — the other direction of the Atemschutz link, for when the hose
                is drawn AFTER the Trupp was registered. Picking one stamps the Leitung number too
                (see useTruppActions · linkTruppLine), so the two sides always agree. Picker AND
                jump in one row: as two rows it printed the same name twice under a hairline.
                Order of the three: Stockwerk (where), Leitung (which), Trupp (who). */}
            {onTrupp && trupps.length > 0 && (
              <div className="de-row"><span>{appConfig.copy.drawingEditor.trupp}</span>
                <span className="de-trupp">
                  {/* the app's own menu, not a native <select>: a system dropdown lands with macOS
                      chrome in the middle of a panel that is otherwise all ours, and on a tablet it
                      opens the OS picker sheet. Base UI gives us the keyboard nav + flip-up for free. */}
                  <Menu
                    trigger={
                      <button className="de-menu-trigger" aria-label={appConfig.copy.drawingEditor.trupp}>
                        {/* an out Trupp keeps its name here (it is who worked this Leitung) but is
                            struck through + labelled, the same read as its dimmed marker on the map */}
                        <span className={truppOnLineOut ? 'de-trupp-out' : undefined}>{truppOnLine ?? appConfig.copy.drawingEditor.truppNone}</span>
                        {truppOnLine && truppOnLineOut && <em className="de-trupp-outnote">{appConfig.copy.drawingEditor.truppOut}</em>}
                        <Icon id="chevron-down" className="chev" />
                      </button>
                    }
                    popupClassName="de-menu-pop"
                    itemClassName={() => 'de-menu-item'}
                    items={[
                      { label: <MenuPick label={appConfig.copy.drawingEditor.truppNone} on={!truppOnLine} />, onClick: () => onTrupp(undefined) },
                      ...trupps.map((t) => ({
                        label: <MenuPick label={t.name} on={t.name === truppOnLine} />,
                        onClick: () => onTrupp(t.id),
                      })),
                    ]}
                  />
                  {onShowTrupp && truppOnLine && (
                    <IconButton onClick={onShowTrupp}
                      label={fillTemplate(appConfig.copy.drawingEditor.truppShow, { name: truppOnLine })}>
                      <span className="ctx-conn-go" aria-hidden>›</span>
                    </IconButton>
                  )}
                </span>
              </div>
            )}
            {/* «Art» – a Linie or a Wand (round 3, owner: «detail sidebar but not the first row …
                towards the bottom»). The hose rows above follow the answer: a Wand has none. A
                Trupp on the line keeps it a Linie – unlinking one is not undoable on the board. */}
            {onWand && (
              <>
                <div className="de-row"><span>{appConfig.copy.drawingEditor.kind}</span>
                  <Segmented ariaLabel={appConfig.copy.drawingEditor.kind} value={drawing.role === 'wand'}
                    onChange={(wand) => { if (wand !== (drawing.role === 'wand')) onWand(wand) }}
                    options={[
                      { value: false, label: appConfig.copy.drawingEditor.kindLine },
                      { value: true, label: appConfig.copy.drawingEditor.kindWand, disabled: !!wandBlocked && drawing.role !== 'wand', title: wandBlocked },
                    ]} />
                </div>
                {wandBlocked && drawing.role !== 'wand' && <p className="de-hint">{wandBlocked}</p>}
              </>
            )}
          </div>
        )}
        {/* Messung — the numbers of a line that is already on the map. Before this, length was
            only reachable by re-drawing the line with the Messen tool, and the Höhenprofil not at
            all; the old An/Aus toggle lives on here as «Auf Karte», which is what it always did. */}
        {(isLine ? lengthM != null || supportsDistance : areaM2 != null) && (
          <div className="de-group" ref={measureRef}>
            <button type="button" className={`de-prof-toggle de-group-toggle${measureOpen ? ' on' : ''}`} aria-expanded={measureOpen} onClick={() => { setMeasureOwn(!measureOpen); measureAsk.settle() }}>
              <span className="de-conn-title">{appConfig.copy.drawingEditor.measurement}</span><Icon id="chevron-down" className="chev" />
            </button>
            {measureOpen && isLine && lengthM != null && (
              <>
                <div className="de-row"><span>{appConfig.copy.drawingEditor.distance}</span>
                  <b className="de-measure-v">{fmtDistance(lengthM)}</b>
                </div>
                {/* the hose length rides in the VALUE («45 × 20 m»): as «Schläuche à 20 m» the
                    label was the one in the sheet that broke onto two lines on a phone, «20» above
                    «m» (owner 05.11.2026: the Messung's labels looked different from the rows above).
                    The reserve is named apart («34 + 3 Reserve × 20 m», Manuel 09.11.2026) */}
                <div className="de-row"><span>{appConfig.copy.measure.hoses}</span>
                  <b className="de-measure-v">{hosesText(lengthM, HOSES[lineHose(drawing)].lines)}</b>
                </div>
              </>
            )}
            {/* an Absperrkreis / Fläche measures itself: what it covers, and how far around it —
                the same two numbers the Messen tool would give for the same outline */}
            {measureOpen && !isLine && areaM2 != null && (
              <>
                <div className="de-row"><span>{appConfig.copy.measure.area}</span>
                  <b className="de-measure-v">{fmtArea(areaM2)}</b>
                </div>
                {boxM && (
                  <>
                    <div className="de-row"><span>{appConfig.copy.measure.boxWidth}</span>
                      <b className="de-measure-v">{fmtDistance(boxM.widthM)}</b>
                    </div>
                    <div className="de-row"><span>{appConfig.copy.measure.boxHeight}</span>
                      <b className="de-measure-v">{fmtDistance(boxM.heightM)}</b>
                    </div>
                  </>
                )}
                {perimeterM != null && (
                  <div className="de-row"><span>{appConfig.copy.measure.perimeter}</span>
                    <b className="de-measure-v">{fmtDistance(perimeterM)}</b>
                  </div>
                )}
              </>
            )}
            {/* «Auf Karte zeigen» was line-only, so a Fläche could work out its own size but had
                no way to put it on the map — the number lived in this panel and vanished the
                moment the panel closed. An Absperrkreis or Sektor whose area is the whole point
                gets the same switch a hose line has. */}
            {measureOpen && (isLine ? supportsDistance : areaM2 != null) && !readOnly && (
              <div className="de-row"><span>{appConfig.copy.drawingEditor.showOnMap}</span>
                <OnOff ariaLabel={appConfig.copy.drawingEditor.showOnMap} value={!!drawing.showDistance} onChange={onShowDistance} />
              </div>
            )}
            {/* a Leitung's Wassertransport chart carries the terrain itself – it stands in for the
                Höhenprofil, in ONE column: inputs, chart and tapped pump, result and «Pumpen auf
                Karte» (mockups/wt-nov04-m4b.html, round 3 mock F-A, 04.11.2026; the switch 05.11.) */}
            {measureOpen && relayShown && (
              <WaterRelay ctrl={relayCtrl} onClose={() => setRelayAdded(false)} mapPumps />
            )}
            {measureOpen && hasProfileCoords && !relayShown && (
              <>
                <div className="de-conn-title">{appConfig.copy.measure.profile}</div>
                {profileLoading ? (
                  <div className="de-prof-msg"><LoadingStatus>{appConfig.copy.measure.profileLoading}</LoadingStatus></div>
                ) : profile ? (
                  <><ProfileChart p={profile} path={profileCoords} /><ProfileStats p={profile} /></>
                ) : (
                  <div className="de-prof-msg">{appConfig.copy.measure.profileNone}</div>
                )}
                {/* adding writes the relay and – where no Ø was picked – the relay default in one
                    edit, so the Schlauch row reads 75 from here on (hydraulics · relayAddPatch) */}
                {/* the group's own gap above it (sp-4), not the 8px a stats row leaves: it is the
                    next question, not one more number (owner 05.11.2026, «too tight») */}
                {relayOffered && <AddRelayButton className="de-relay-add" onClick={() => {
                  setRelayAdded(true)
                  const patch = relayAddPatch(drawing)
                  if (patch && !relayCtrl.readOnly) waterRelay?.onChange?.(patch)
                }} />}
              </>
            )}
          </div>
        )}
        {isLine && (drawing.startAttachment || drawing.endAttachment) && (
          <div className="de-group de-connections">
            <div className="de-conn-title">{appConfig.copy.drawingEditor.connections}</div>
            {(['start', 'end'] as const).map((endpoint) => {
              const a = endpoint === 'start' ? drawing.startAttachment : drawing.endAttachment
              if (!a) return null
              const gps = a.gps?.state, hidden = !!attachmentHidden?.[endpoint]
              // the GPS block above already carries this end's moves
              const inGpsBlock = !!gpsInfo?.[endpoint]
              const name = attachmentLabels?.[endpoint] ?? a.target.id
              const note = inGpsBlock ? (hidden ? appConfig.copy.drawingEditor.hiddenTarget : null)
                : gps === 'continuous' ? appConfig.copy.drawingEditor.gpsFollowing
                : gps === 'paused' ? appConfig.copy.drawingEditor.gpsMovingAway
                : hidden ? appConfig.copy.drawingEditor.hiddenTarget : null
              return <Fragment key={endpoint}>
                {/* endpoint → target: same de-row as the FKS rows above; the value taps to fly there */}
                <div className="de-row"><span>{endpoint === 'start' ? appConfig.copy.drawingEditor.connectedStart : appConfig.copy.drawingEditor.connectedEnd}</span>
                  <button type="button" className="de-conn-name" onClick={onFocusAttachment ? () => onFocusAttachment(endpoint) : undefined} disabled={!onFocusAttachment}>
                    <span>{name}</span>{onFocusAttachment && <span className="de-conn-go" aria-hidden>›</span>}
                  </button>
                </div>
                {note && <div className={`de-conn-note${gps === 'paused' ? ' warn' : ''}`}>
                  <span>{note}</span>
                  {hidden && onRevealAttachment && <Button onClick={() => onRevealAttachment(endpoint)}>{appConfig.copy.drawingEditor.revealTarget}</Button>}
                </div>}
                {/* the connection READS in read-only (who the line hangs on, and «springe zu»);
                    what it may not do is re-route or cut it — so the two mutating controls are
                    gated here, not only by each surface remembering to pass undefined. */}
                {!readOnly && onRouting && !inGpsBlock && (
                  <div className="de-row"><span>{appConfig.copy.drawingEditor.route}</span>
                    <span className="de-presets">
                      {gps === 'paused'
                        ? <button className="de-preset" onClick={() => onRouting(endpoint, 'trace')}>{appConfig.copy.drawingEditor.gpsContinue}</button>
                        : gps === 'continuous'
                        ? <button className="de-preset on" onClick={() => onRouting(endpoint, 'direct')}>{appConfig.copy.drawingEditor.gpsPause}</button>
                        : <>
                            <button className={`de-preset ${a.routing === 'direct' ? 'on' : ''}`} onClick={() => onRouting(endpoint, 'direct')}>{appConfig.copy.drawingEditor.routeDirect}</button>
                            <button className={`de-preset ${a.routing === 'trace' ? 'on' : ''}`} onClick={() => onRouting(endpoint, 'trace')}>{appConfig.copy.drawingEditor.routeTrace}</button>
                          </>}
                    </span>
                  </div>
                )}
                {!readOnly && onDetach && !inGpsBlock && <button type="button" className="de-conn-detach" onClick={() => onDetach(endpoint)}>{a.gps ? (onSiteKnown(a.gps) ? appConfig.copy.drawingEditor.gpsDetachOnSite : appConfig.copy.drawingEditor.gpsDetachHere) : appConfig.copy.drawingEditor.detachConnection}</button>}
              </Fragment>
            })}
          </div>
        )}
        {actions && <div className="ctx-footer-inline">{actions}</div>}
      </div>
      {actions}
    </CtxShell>
  )
}
