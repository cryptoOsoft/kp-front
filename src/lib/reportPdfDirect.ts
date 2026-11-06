// The ONE Rapport-PDF path: the client sends pure DATA — form fields, the Kroki scene
// (entities with client-resolved SVGs, drawings, view), and plan references with board
// annotations — and the server composes everything, map render included.
// No browser capture, no Druckansicht detour.
//
// The rapport is a pre-filled FORM (decided 2026-07-17): the full roster and Material
// catalogue always travel in the payload so the server can print tick-off rows and amount
// stubs for everything not (yet) recorded digitally — printing never blocks on missing data.

import { appConfig } from '../config/appConfig'
import type { AttendanceState, BoardAnno, BoardDoc, BuildingDoc, CaptionMode, Drawing, Entity, LayerDef, LngLat, MittelEntry, PlanDocument, ReportAttachment, TimelineEvent, Trupp } from '../types'
import { floorLabel, floorSections, pdfPageOf, tileAspectOf } from './whiteboard'
import { circleRing, clipConvex, clipStroke, edgeMarkSvg, markDeg, rectPoly, thinMarks, type EdgeMark, type Pt } from './storeyClip'
import { activeViewDeg, buildView, fpBoxFrac } from './footprint'
import { packFrameRing } from './stackFit'
import type { IncidentMeta } from './incidents'
import { closeTimeOf } from './api/incidents'
import type { ReportDraft } from './report'
import {
  annotatedPlans, einsatzleiterSuccession, formatDateTime, hasVisiblePlanAnnotation, journalRows, metaExtrasForPdf, mittelFormForPdf, pendenzRows, personalForPdf, readingBarShown, readingKindLabel, spanAwareClock, truppAuftragLabel, truppCrewHistory, truppEquipmentLabels, truppRunTimes, truppStatusLabel,
} from './report'
import { isAtemschutzTrupp, isStandDownExit } from './atemschutz'
import { DEFAULT_HOURS_ROUNDING, fmtHours, hoursRows, hoursSummary } from './attendanceHours'
import { atemschutzDoctrine, getDeploymentConfig } from './deploymentConfig'
import { serverNow } from './serverClock'
import { fillTemplate, formatTime, localeDate } from './format'
import { buildKrokiPayload, circleSvgString, shapeSvgString } from './krokiPayload'
import { symbolLegendText } from './symbols'
import { doneBadge, doneOf, doneWord } from './objectDone'
import { auswertungForPdf, computeAuswertung } from './auswertung'
import { fahrzeugRows } from './alarmzeiten'
import type { ChecklistState, ChecklistTemplate } from './checklists'
import { formatSymbolName } from './format'
import { SHAPE_DEFS, shapeAspect } from './shapes'
import { placardSvgForSymbol } from './placard'
import { ensureErg } from './erg'
import { ensureUnHazard } from './unHazard'
import { vehicleSymbolSvg } from './useVehiclePositions'
import { downloadReportPdf, reportFilenameHint } from './reportPdf'
import { resolvePlanAnnos } from './lineAttachments'
import type { JournalLink } from './journalLinks'
import { TAFEL_ID, findForms, formForPdf, pageStamp, pageTitles } from './boardForm'
import { problemView, type ProblemSource } from './problemLink'
import type { LiveSection } from './boardTemplate'
import { isPendenzenPage, pendenzenForPdf } from './pendenzenPage'
import { isDrawnBoardKind } from './workspace'
import { signatureScope, type SignatureRole, type SignatureStrokes } from './reportSignature'
import { readyLinePumps } from './linePumps'

/** Board annotations of one plan, in the server's PlanAnnoIn shape (dynamic symbol
 *  glyphs resolved to SVG strings, like the whiteboard renders them).
 *
 *  `captionMode` is the device's Beschriftungen setting — the SAME one the board renders with
 *  (IncidentWorkspace · symbolCaptions), so the printed plan is labelled the way the screen it
 *  was drawn on was. */
export function planAnnosForPdf(annos: BoardAnno[], captionMode: CaptionMode = 'auto'): Record<string, unknown>[] {
  // only what a sheet DRAWS: a Tafel page prints as its own page, a passenger not at all
  return resolvePlanAnnos(annos.filter((a) => isDrawnBoardKind(a.kind))).map((a) => {
    const out: Record<string, unknown> = {
      kind: a.kind, x: a.x, y: a.y, pts: a.pts, color: a.color, width: a.width,
      // ⚠️ `hatch` rides with the fill it REPLACES — an `area` that came out washed on paper was
      // saying «this region» where the screen said «this region is AFFECTED» (02.09.). The other
      // kinds carry it inside their resolved SVG (circleSvgString / shapeSvgString below).
      dashed: a.dashed, fillOpacity: a.fillOpacity, hatch: a.hatch, label: a.label, text: a.text, rotation: a.rotation,
      // note styling: wN is what makes it a wrapping box, so the sheet breaks the lines exactly
      // where the screen did. Absent on every other kind, and absent on legacy notes.
      wN: a.wN, noteSize: a.noteSize, notePlain: a.notePlain,
    }
    if (a.kind === 'symbol') {
      // the badges the board draws on the glyph, so the sheet says the same thing it does.
      // ⚠️ `storey`, never `floor` — on a BoardAnno that name is the floor-stack's TILE INDEX
      // (see types · BoardAnno), and the stack's tiles are flattened into page space before the
      // annos ever reach the server. The storey badge is only ever set on the Modul boards; on
      // the stack the sheet already says which storey it is, so there is nothing to print.
      out.storey = a.storey
      out.floorFrom = a.floorFrom
      out.floorTo = a.floorTo
      out.count = a.count
      out.spread = a.spread
      // …and the symbol's LEGEND line. ⚠️ symbolLegendText, the SAME call the Kroki payload makes,
      // so a symbol reads the same on every sheet of the rapport. The server prints it as a
      // numbered disc + a legend line (backend · kroki · _number_words).
      out.caption = symbolLegendText(a, captionMode) ?? undefined
      // «Gelöscht / erledigt»: grey on paper too, with the time (⚠️ mirrored in PlanAnnoIn)
      out.done = doneBadge(a) ?? undefined
      const veh = a.symbol === appConfig.symbols.vehicleName
      const svg = veh ? vehicleSymbolSvg(a.label ?? '', a.rotation ?? 0) : placardSvgForSymbol(a.symbol, a.fields)
      if (svg) {
        out.symbolSvg = svg
        if (veh) out.rotation = undefined // heading is baked into the vehicle glyph
      } else {
        out.symbol = a.symbol
      }
    }
    if (a.kind === 'circle') {
      // An Absperrkreis prints as a client-resolved glyph in a SQUARE box, the way a plan shape
      // does (below): `sizeN` is the DIAMETER as a fraction of the plan width, so the server's
      // existing symbol path sizes it against the same page width the screen sized it against —
      // and the ring stays round on paper without the sheet's aspect having to travel with it.
      out.kind = 'symbol'
      out.symbolSvg = circleSvgString(a.color ?? appConfig.drawing.circleColor, a.fillOpacity ?? appConfig.drawing.circleFillOpacity, !!a.hatch, a.dashed !== false)
      out.sizeN = 2 * (a.radiusN ?? 0)
      out.rotation = undefined
    }
    if (a.kind === 'shape') {
      // a plan shape prints as a client-resolved glyph (like map shapes); sizeN scales it
      // to the plan width server-side instead of the fixed symbol size. The arrow's
      // Stopp-Balken is baked into the SVG; the box aspect rides along as its own field
      // (⚠️ mirrored in backend/app/report · PlanAnnoIn).
      const kind = a.shape ?? 'square'
      const aspect = shapeAspect(kind, a.aspect)
      out.kind = 'symbol'
      // the FULL prop set, exactly as the map path sends it (krokiPayload · krokiEntity):
      // aspect, carrier, stroke weight, fill/hatch, corners and circulation all print as drawn.
      // No boxPx — the page width is the server's to decide, so the stroke keeps the unit-based
      // default weight here.
      out.symbolSvg = shapeSvgString(kind, a.color ?? SHAPE_DEFS[kind].defaultColor, kind === 'arrow' && !!a.stop, aspect, a.carrier, a.strokeW, undefined, a.fillOpacity, a.hatch, a.sharpCorners, a.reverse)
      out.shape = kind // so the server applies the same per-kind limits the client does
      out.sizeN = a.sizeN ?? SHAPE_DEFS[kind].defaultSizeN
      if (aspect !== 1) out.aspect = aspect
      out.label = undefined // the shape's implicit name (Rauch/Pfeil/…) is not an on-plan label
    }
    return out
  })
}

// ---- Gebäude floor-stack export (server-side-rendering.md Phase 2) ----------------------
// The stack has no PDF behind it, so the client expresses each page entirely with the
// server's existing anno primitives on a BLANK base: footprint outline = 'area', floor
// label = 'text' pill, tile separator = dashed 'draw', north dial = a 'north' anno the
// SERVER draws. Real board annos are lifted from tile-local into page space here
// (the server has no floor model). Max 2 storeys per page so tiles print near full width.

const STACK_FLOORS_PER_PAGE = 2
const STACK_INK = '#3b4656'
/** the printed edge mark's diameter, and the closest two may stand — in page widths */
const STACK_MARK_N = 0.022
const STACK_MARK_GAP_N = 0.02
/** the stroke a cut Fläche's FILL is given: the server strokes every polygon it fills, and the
 *  cut edge is no edge of the Fläche — the outline that IS travels separately, as runs */
const HAIRLINE = 0.01

/**
 * A stroke, Fläche or Absperrkreis on a printed Gebäude page, CUT to its storey's band — the same
 * rule the screen follows (lib/storeyClip, 24.09.2026). On paper the section IS the band: the
 * printed stack carries no Geschossplan, so the band is all the storey there is. It used to be
 * lifted whole, and a Karte hose that left the 1. OG ran through the EG's band on the same page.
 *
 * Works in ISOTROPIC page units (y in page widths) so the marks point the way the stroke goes, and
 * hands back page-normalized annos: a stroke may come back as several runs, a cut Fläche or
 * Absperrkreis as its fill plus the runs of its outline that remain, and every crossing as an
 * edge-mark glyph. A run on a storey this page does not carry is not printed here — it is on its
 * own storey's page, which is where a climbing Leitung's other half has always been.
 */
function cutToBands(a: BoardAnno, chunk: readonly number[], tileAR: number): { annos: BoardAnno[]; marks: Record<string, unknown>[] } {
  const N = STACK_FLOORS_PER_PAGE
  const band = (k: number) => [rectPoly(0, k * tileAR, 1, (k + 1) * tileAR)]
  const iso = (k: number, x: number, y: number): Pt => [x, (k + y) * tileAR]
  const back = ([x, y]: Pt): [number, number] => [x, y / (N * tileAR)]
  const color = a.color || (a.kind === 'circle' ? appConfig.drawing.circleColor : appConfig.drawing.colors[0])
  const marks: Record<string, unknown>[] = []
  const markAll = (ms: EdgeMark[]) => {
    for (const m of thinMarks(ms, STACK_MARK_GAP_N)) {
      const [x, y] = back(m.at)
      marks.push({ kind: 'symbol', x, y, sizeN: STACK_MARK_N, symbolSvg: edgeMarkSvg(color, markDeg(m)) })
    }
  }
  // attachments are already resolved into the points (resolvePlanAnnos); a cut end must not be
  // pulled back onto its target by the second pass planAnnosForPdf makes
  const plain = { startAttachment: undefined, endAttachment: undefined }
  if (a.kind === 'draw') {
    const out: BoardAnno[] = []
    for (const run of floorSections(a.pts ?? [], a.floor)) {
      const k = chunk.indexOf(run[0][2] ?? a.floor ?? 0)
      if (k < 0) continue
      const c = clipStroke(run.map((p) => iso(k, p[0], p[1])), band(k))
      markAll(c.marks)
      // wholly on its band: lifted exactly as before, without a detour through the page's aspect
      const runs = c.cut ? c.runs.map((r) => r.map(back)) : [run.map((p): [number, number] => [p[0], (k + p[1]) / N])]
      for (const r of runs) {
        if (r.length < 2) continue
        out.push({ ...a, ...plain, id: out.length ? `${a.id}~${out.length}` : a.id, pts: r, label: out.length ? undefined : a.label })
      }
    }
    return { annos: out, marks }
  }
  const k = chunk.indexOf(a.floor ?? 0)
  if (k < 0) return { annos: [], marks }
  // the ring the fill is cut from, and the outline the marks are read off
  const ring: Pt[] = a.kind === 'circle'
    ? circleRing(a.x ?? 0, (k + (a.y ?? 0)) * tileAR, a.radiusN ?? 0)
    : (a.pts ?? []).map((p) => iso(k, p[0], p[1]))
  const c = clipStroke(ring, band(k), true)
  if (!c.cut) {
    // wholly on its storey: printed exactly as before
    return { annos: [{ ...a, y: a.y != null ? (k + a.y) / N : a.y, pts: a.kind === 'area' ? a.pts?.map((p): [number, number] => [p[0], (k + p[1]) / N]) : a.pts }], marks }
  }
  // ⚠️ nothing of the outline on the band: the zone misses it, or holds ALL of it — and then it
  // says nothing about this storey, and its fill only tinted the whole band (the screen's rule,
  // lib/storeyClip · enclosesSection, 11.10.2026)
  if (!c.runs.length) return { annos: [], marks }
  const piece = clipConvex(ring, band(k)[0])
  if (!piece.length) return { annos: [], marks }
  markAll(c.marks)
  const circle = a.kind === 'circle'
  const fill: BoardAnno = {
    ...a, ...plain, kind: 'area', pts: piece.map(back), width: HAIRLINE, x: undefined, y: undefined, radiusN: undefined,
    color, fillOpacity: circle ? a.fillOpacity ?? appConfig.drawing.circleFillOpacity : a.fillOpacity,
  }
  // the circle prints dashed unless it says otherwise — circleSvgString's own default
  const dashed = circle ? a.dashed !== false : a.dashed
  const outline = c.runs.filter((r) => r.length >= 2).map((r, i): BoardAnno => ({
    id: `${a.id}~o${i}`, kind: 'draw', pts: r.map(back), color, dashed,
    width: circle ? a.width ?? appConfig.drawing.circleLineWidth : a.width,
  }))
  return { annos: [fill, ...outline], marks }
}

/** The storeys of the stack that carry anything — an anno standing on them, or a line passing
 *  through. Top storey first. An EMPTY storey is an outline the reader learns nothing from: the
 *  18.09.2026 review printed two sheets for one Trupp chip, the second a bare EG. */
export function usedStackFloors(building: BuildingDoc, annos: BoardAnno[]): number[] {
  const used = new Set<number>()
  for (const a of resolvePlanAnnos(annos)) {
    if (a.pts?.length) for (const p of a.pts) used.add(p[2] ?? a.floor ?? 0)
    else used.add(a.floor ?? 0)
  }
  return building.floors.filter((f) => used.has(f)).sort((a, b) => b - a)
}

/** The floor-stack rendered as blank-base plan pages (chunked, top storey first) — only the
 *  storeys with content (`usedStackFloors`); none ⇒ no page at all. */
export function floorStackPages(
  plan: PlanDocument, building: BuildingDoc, annos: BoardAnno[], captionMode: CaptionMode = 'auto',
): { label: string; blankAspect: number; annos: Record<string, unknown>[] }[] {
  const floorsTTB = usedStackFloors(building, annos)
  if (!floorsTTB.length) return []
  // the ACTIVE view — an operator-dialled `viewDeg` (A8) prints exactly as the screen shows it
  const viewAngle = activeViewDeg(building)
  // the pack turns on its frame (lib/stackFit · packFrameRing), an outline on its own polygons –
  // one view either way, so the printed page is the shape the screen shows
  const fp = building.pack
    ? { ...buildView(packFrameRing(building.pack), viewAngle), rings: [] as [number, number][][] }
    : building.src?.length
      ? buildView(building.src, viewAngle)
      : { rings: building.rings ?? [building.ring], aspect: building.ringAspect || 1 }
  const TILE = tileAspectOf(building)
  const chunks: number[][] = []
  for (let i = 0; i < floorsTTB.length; i += STACK_FLOORS_PER_PAGE) chunks.push(floorsTTB.slice(i, i + STACK_FLOORS_PER_PAGE))
  return chunks.map((chunk, ci) => {
    // ⚠️ The band grid is the PAGE's, not the chunk's. Dividing by the number of storeys that
    // happen to land on a page made the last page of an odd building a different SHAPE from the
    // ones before it — two storeys gave a tall page, one gave a wide one, and the Gebäude came
    // out of the printer half portrait and half landscape. A constant grid keeps every page
    // upright and every floor tile the same size; a page that is short of a storey simply
    // leaves its lower band empty, which is what a stack with nothing above it looks like.
    const N = STACK_FLOORS_PER_PAGE
    const { rw, rh } = fpBoxFrac(fp.aspect, 1, N * TILE, N)
    const page: Record<string, unknown>[] = []
    chunk.forEach((f, idx) => {
      if (idx > 0) page.push({ kind: 'draw', pts: [[0.02, idx / N], [0.98, idx / N]], color: '#b9c2cc', width: 1.5, dashed: true })
      // centred footprint box (mirror of the app's fpBox): rw of the page width, rh of one tile band
      for (const ring of fp.rings) {
        page.push({
          kind: 'area', color: STACK_INK, width: 2.5, fillOpacity: 0,
          pts: ring.map(([rx, ry]) => [0.5 - rw / 2 + rx * rw, (idx + 0.5 - rh / 2 + ry * rh) / N]),
        })
      }
      page.push({ kind: 'text', x: 0.06, y: (idx + 0.06) / N, text: floorLabel(f) })
    })
    // ⚠️ The dial is the SERVER's (backend · kroki · north_dial_svg), not one this file draws.
    // It used to send its own SVG — a red triangle with the N under the centre — so the floor
    // page and the Kroki carried two different north marks onto the same stapled rapport. The
    // client sends the ANGLE; the glyph has one definition.
    // ⚠️ …and a PACK gets NO dial (16.09.2026). For a picked outline `viewAngle` IS the north
    // angle, because `src` is stored north-up; a Geschossplan's page carries whatever bearing the
    // architect's sheet had, which only its approved map fit knows and this function is not given.
    // It used to print the glyph at 0° for every pack — a printed claim that the page is north-up.
    if (ci === 0 && !building.pack) page.push({ kind: 'north', x: 0.94, y: 0.045 / N, deg: viewAngle, sizeN: 0.055 })
    // board annos of these storeys, lifted tile-local → page space (x spans the full width)
    const lift = (a: BoardAnno, idx: number): BoardAnno => ({
      ...a,
      y: a.y != null ? (idx + a.y) / N : a.y,
      pts: a.pts?.map(([px, py, floor]) => {
        const pointIdx = chunk.indexOf(floor ?? a.floor ?? 0)
        return [px, ((pointIdx < 0 ? idx : pointIdx) + py) / N] as [number, number]
      }),
    })
    const edgeMarks: Record<string, unknown>[] = []
    const lifted = resolvePlanAnnos(annos).flatMap((a) => {
      // strokes, Flächen and Absperrkreise are cut to their storey's band (see cutToBands)
      if ((a.kind === 'draw' && (a.pts?.length ?? 0) >= 2) || (a.kind === 'area' && (a.pts?.length ?? 0) >= 3) || (a.kind === 'circle' && (a.radiusN ?? 0) > 0)) {
        const cut = cutToBands(a, chunk, TILE)
        edgeMarks.push(...cut.marks)
        return cut.annos
      }
      const pointFloors = a.pts?.map((p) => p[2] ?? a.floor ?? 0) ?? []
      const idx = chunk.indexOf(pointFloors.find((f) => chunk.includes(f)) ?? a.floor ?? 0)
      return idx < 0 ? [] : [lift(a, idx)]
    })
    // the marks go on top: they stand ON the crossing, half over the band beside it
    page.push(...planAnnosForPdf(lifted, captionMode), ...edgeMarks)
    const labels = chunk.map(floorLabel)
    return { label: `${plan.title} · ${labels.length > 1 ? `${labels[0]} – ${labels[labels.length - 1]}` : labels[0]}`, blankAspect: N * TILE, annos: page }
  })
}

export interface DirectReportArgs {
  /** the linkable vocabulary (lib/journalLinks) — the printed journal marks the same terms the
   *  app marks, in bold. Absent = the entry prints verbatim, as it always did. */
  vocab?: JournalLink[]
  incident: IncidentMeta
  draft: ReportDraft
  trupps: Trupp[]
  /** the Funkkontakt-Intervall this Einsatz actually ran on, and the grace on top of it —
   *  what «überfällig» meant here, printed with the Atemschutz protocol */
  contactIntervalMin?: number
  contactGraceSec?: number
  attendance: AttendanceState
  events: TimelineEvent[]
  plans: PlanDocument[]
  /** Mittel event log — the Material worksheet's filled amounts derive from it */
  mittel?: MittelEntry[]
  /** full roster for the Personal-/Soldblatt's tick-off rows (id + display name) */
  roster?: { id: string; name: string }[]
  /** Rapport-Beilagen (document/damage photos) — printed as full-width plates at the end */
  attachments?: ReportAttachment[]
  /** Kroki scene (omit → PDF without map, e.g. the capture view) */
  scene?: {
    entities: Entity[]
    drawings: Drawing[]
    layers: LayerDef[]
    byName: Record<string, string>
    center: LngLat
    view: { center: LngLat; zoom: number }
    /** the map's Beschriftungen setting — the printed Kroki carries the same labels the
     *  screen it was framed on did (an Einsatzleiter symbol prints its name) */
    captionMode?: CaptionMode
  }
  /** what every sheet DRAWS: its own annos plus the Karte's objects projected onto it
   *  (lib/useObjectStore · board). One list — the page shows what the screen shows. */
  board?: BoardDoc
  /** the picked Gebäude (floor stack) — exports as blank-base plan pages when present */
  building?: BuildingDoc | null
  /** alternate endpoint/auth (capture view: poster token instead of the kiosk cookie) */
  transport?: import('./reportPdf').ReportTransport
  /** the Checkliste tick state + its templates — the Auswertung's phase bands (lib/auswertung).
   *  Absent = no phase lane; nothing else depends on it. */
  checklists?: ChecklistState
  checklistTemplates?: ChecklistTemplate[]
  /** wall clock for what is still open on a running Einsatz (tests pin it) */
  now?: number
  /** the VALID digital signatures, ready to print on their lines (lib/reportSignature). The caller
   *  decides validity — a signature that no longer holds is simply not passed, and its line prints
   *  empty, as if nobody had signed. */
  signatures?: PrintedSignature[]
  /** build only what a signature covers (signedPartOf): skips the Journal and Pendenzen, which
   *  are Beilagen and the costly part of a fat Einsatz */
  scopeOnly?: boolean
}

/** a signature as the paper prints it */
export interface PrintedSignature {
  role: SignatureRole
  name: string
  /** «Oberwil, 15.10.2026» — the Ort, Datum of its line */
  placeDate: string
  /** «15.10.2026 04:12» */
  at: string
  /** «3fa9 c210 7be1» */
  checksum: string
  strokes: SignatureStrokes
}

/**
 * The symbols marked «Gelöscht / erledigt», worded for the Auswertung's milestone lane — «Feuer
 * gelöscht». From the Karte AND the sheets: a Feuer marked out on the Gebäude is the same
 * milestone. A Karte object projected onto a sheet carries the same id and stamp, so one fact
 * prints once.
 */
export function doneMilestones(entities: readonly Entity[] = [], board: BoardDoc = {}): { at: string; label: string }[] {
  const seen = new Set<string>()
  const out: { at: string; label: string }[] = []
  const add = (id: string, symbol: string | undefined, props: Parameters<typeof doneOf>[0]) => {
    const d = doneOf(props)
    if (!d || !symbol) return
    const label = `${formatSymbolName(symbol)} ${doneWord(symbol, 'inline')}`
    const key = `${id}\u0000${d.at}`
    const keyLabel = `${label}\u0000${d.at}`
    if (seen.has(key) || seen.has(keyLabel)) return
    seen.add(key); seen.add(keyLabel)
    out.push({ at: d.at, label })
  }
  for (const e of entities) add(e.id, e.symbol, e)
  for (const annos of Object.values(board)) for (const a of annos) if (a.kind === 'symbol') add(a.id, a.symbol, a)
  return out
}

/**
 * The «Einsatzleiter» value the sheet prints: the field's own name when the Einsatzleitung never
 * rotated — and the whole SUCCESSION when it did: «A (bis 14:20), B (ab 14:20)». The rapport
 * field only holds the latest name, but a handover mid-Einsatz is exactly the kind of fact a
 * signed record is later read for; the spans come out of the incident's own Verlauf (lib/report
 * · einsatzleiterSuccession), and the clocks follow the sheet's one midnight rule
 * (spanAwareClock). The FIELD stays the authority: empty prints the blank write-in rule as
 * always, and a just-typed name the 4 s log window has not settled yet joins as the newest span.
 */
export function einsatzleiterForPdf(
  current: string | undefined,
  events: TimelineEvent[],
  bounds: { alarmedAt?: string | null; endedAt?: string | null },
  fallbackDate?: string,
): string | undefined {
  const name = current?.trim()
  if (!name) return current
  const spans = einsatzleiterSuccession(events, fallbackDate)
  if (spans.length && spans[spans.length - 1].name !== name) spans.push({ name, fromTs: null })
  if (spans.length < 2) return current
  const clock = spanAwareClock(bounds)
  const R = appConfig.copy.report
  return spans.map((s, i) => {
    // every span but the last ends where its successor begins — the «bis» of one IS the «ab»
    // of the next, so a reader sees one continuous Einsatzleitung, never a gap
    const t = clock(i < spans.length - 1 ? spans[i + 1].fromTs : s.fromTs)
    if (!t) return s.name // a row without a usable timestamp still names the person
    return fillTemplate(i < spans.length - 1 ? R.einsatzleitungBis : R.einsatzleitungAb, { name: s.name, t })
  }).join(', ')
}

/**
 * The Tafel in the Rapport (10.10.2026): every board-template page resolved for the server
 * (lib/boardForm · formForPdf — it draws the paper, backend/app/report_board.py), and the Skizze
 * as a blank-base plan page when it carries ink — which closes the old gap of the Tafel's
 * drawing never reaching paper. The Lagekarte box gets the scene as a Kroki the server renders at
 * print time: auto-framed on the Lage (never the operator's Kroki crop, which has another shape),
 * and without captions or labels — the box has no room for the legend their numbers would need.
 *
 * ⚠️ The «Aufträge / Pendenzen» page (lib/pendenzenPage) is the SAME list as the Rapport's own
 * «Aufträge / Pendenzen» section — same source, same columns, and that one carries the Meldungen
 * too. Printed right after it, the sheet would be the list a second time. So it is left out while
 * that section is printed (`pendenzen.inRapport`) and stands in for it when the section is off.
 */
export function tafelPayload(
  board: BoardDoc | null | undefined,
  plans: readonly PlanDocument[],
  scene: DirectReportArgs['scene'],
  trupps: Trupp[],
  caption: string,
  problems?: ProblemSource,
  pendenzen: { timeline: readonly TimelineEvent[]; inRapport: boolean } = { timeline: [], inRapport: false },
): { boardPages: Record<string, unknown>[]; boardMap?: unknown; skizze?: Record<string, unknown> } {
  const annos = board?.[TAFEL_ID] ?? []
  const T = appConfig.copy.tafel
  const titles = pageTitles(annos)
  // each page as the Tafel draws it: a problem section with every problem of the Einsatz, the
  // checklist's ticks included (lib/problemLink · problemView); the «Aufträge / Pendenzen» page
  // only while the Rapport's own section does not print the same list (see above)
  const forms = findForms(annos)
  const live = (s: LiveSection, base: Record<string, unknown>) => pendenzenForPdf(s, base, pendenzen.timeline, Date.now())
  const pages = forms
    .filter((a) => !(pendenzen.inRapport && isPendenzenPage(a.form)))
    .map((a) => formForPdf(problemView(a, forms, problems), { up: T.trendUp, same: T.trendSame, down: T.trendDown }, undefined, T.head, titles.get(a.id), pageStamp(a.form, T), live))
  const wantsMap = findForms(annos).some((a) => a.form.page.sections.some((x) => x.type === 'map' && !x.hidden))
  const map = wantsMap && scene
    ? buildKrokiPayload({
        entities: scene.entities, drawings: scene.drawings.map((d) => ({ ...d, label: undefined })), layers: scene.layers,
        byName: scene.byName, center: scene.center, currentView: null, captionMode: 'off', trupps,
      })
    : null
  const ink = annos.filter((a) => isDrawnBoardKind(a.kind))
  const tafel = plans.find((p) => p.id === TAFEL_ID)
  const skizze = tafel && hasVisiblePlanAnnotation({ [TAFEL_ID]: ink }, TAFEL_ID)
    ? {
        label: `${tafel.code} · ${T.skizze}`, caption,
        // the blank sheet's own A4 shape (useMeasuredSheet · seed): h/w of a landscape sheet
        blankAspect: tafel.orientation === 'portrait' ? 1.414 : 1 / 1.414,
        annos: planAnnosForPdf(ink, scene?.captionMode ?? 'auto'),
      }
    : undefined
  return { boardPages: pages, ...(map ? { boardMap: map } : {}), ...(skizze ? { skizze } : {}) }
}

/** The local date every journal row falls on («23.10.2026»), or undefined when they span midnight
 *  or a row has no time of its own — then each row keeps its full «Datum Zeit» label. */
function oneDay(isos: readonly (string | null)[]): string | undefined {
  const days = new Set(isos.map((iso) => (iso ? localeDate(iso, { day: '2-digit', month: '2-digit', year: 'numeric' }) : null)))
  const [day] = days
  return (days.size === 1 && day) || undefined
}

/** The ONE payload builder — shared by the PDF download and the station-printer enqueue
 *  (src/lib/printRelay.ts), so both always produce the identical document. */
export function buildDirectReportPayload(args: DirectReportArgs): Record<string, unknown> {
  const { incident, draft, trupps, attendance, events, plans, mittel = [], roster = [], attachments = [], scene, board, building } = args
  const meta = draft.meta
  // the moment a CLOSED Einsatz was closed — ends the sorties nobody reported out (see trupps).
  // ⚠️ The LATEST close (closeTimeOf): after a reopen and a second close the crew was still in
  // until the second one, like every other open span on the sheet. `closed_at` stays the FIRST
  // close below, where it marks what reached the record afterwards as Nachtrag (journalRows).
  const closedAt = incident.is_archived ? closeTimeOf(incident) ?? undefined : undefined

  // journal photos: send the server-relative media URL — the composer loads the bytes
  // from its own media store (session-only blob: URLs can't be resolved there and are
  // simply not yet uploaded — the preflight already warns about pending media).
  // Generic Beilagen have no plate on paper: `journalRows` names them INSIDE the row text
  // (lib/report · withFileNames), so they need no field of their own here.
  // ⚠️ `truppIds` off the UNFILTERED slice: a row about a Trupp that has since been taken off the
  // board is still a crew enumeration (see journalRows · truppIds).
  const journalPrint = args.scopeOnly ? [] : journalRows(events, plans, meta.startedAt ?? incident.started_at, incident.closed_at,
    { includeBookkeeping: draft.options.detailedAudit, vocab: args.vocab, truppIds: new Set(trupps.map((t) => t.id)) })
  // a one-day Einsatz prints «07:03», not «23.10.2026 07:03» on every row: the date goes once
  // into the section heading (app/report · ReportPayload.journalDay)
  const journalDay = oneDay(journalPrint.map((r) => r.iso))
  const journal = journalPrint
    .map((r) => ({
      timeLabel: journalDay && r.iso ? formatTime(new Date(r.iso)) : r.timeLabel, area: r.area, text: r.text, markup: r.markup, transcript: r.transcript || undefined,
      transcriptLines: r.transcriptLines,
      repeats: r.repeats,
      // a corrected line prints its first wording beside the latest — the paper says the same
      // thing the «korrigiert»-chip says on screen
      correctedAt: r.correctedAt, textOriginal: r.textOriginal,
      // …and a row that reached the record after the Einsatzende says so on paper (D4)
      nachtrag: r.nachtrag || undefined,
      // only pictures the SERVER can fetch — a blob: URL is one that never finished uploading
      photoUrls: r.photoUrls?.filter((u) => u.startsWith('/')),
    }))

  // Aufträge / Pendenzen — derived from the same rows, printed as a section right after them
  const pendenzen = args.scopeOnly ? [] : pendenzRows(events, meta.startedAt ?? incident.started_at)

  const kroki = draft.options.kroki && scene
    ? buildKrokiPayload({
        entities: scene.entities, drawings: scene.drawings, layers: scene.layers, byName: scene.byName,
        center: scene.center,
        currentView: draft.options.krokiView ?? null,
        captionMode: scene.captionMode,
        // so a hose on the printed Kroki names the Trupp that worked it
        trupps,
      })
    : null

  // annotated Objektpläne as references + board annos; the Gebäude floor-stack has no PDF
  // behind it and exports as client-composed blank-base pages instead (floorStackPages)
  // «Alle Pläne» needs no board to choose by — only «mit Anmerkungen» does
  const selectedPlans = draft.options.allPlans || (board && draft.options.annotatedPlans)
    ? annotatedPlans(plans, board ?? {}, draft.options.allPlans)
    : []
  // Which Einsatz, which moment — under the heading of EVERY figure page, not only the Kroki's: a
  // Gebäude sheet pulled out of the stapled rapport has to say what it belongs to. ⚠️ `generatedAt`,
  // not `krokiAt`: only the Kroki can be reconstructed for a past moment, a sheet's annos are now.
  const figureCaption = fillTemplate(appConfig.copy.report.krokiState, { title: incident.title, at: formatDateTime(draft.generatedAt) })
  // (the Tafel is not one of the «Pläne»: its pages and its Skizze are their own section, below)
  const printPlans = selectedPlans.filter((p) => p.imageUrl && !p.floorStack)
  const planPages: Record<string, unknown>[] = printPlans.map((p) => ({
    label: `${p.code} · ${p.title}`,
    caption: figureCaption,
    // a floor sheet names its page in the URL fragment; the server renders THAT page
    url: p.imageUrl.replace(/#.*$/, ''),
    page: pdfPageOf(p.imageUrl) ?? 0,
    // ⚠️ ONE list. The board view a sheet draws already carries the Karte's objects projected
    // onto it (lib/useObjectStore · board), so concatenating a second «mirrored» list here
    // printed every annotation on a linked plan twice — the sheet's own ink included.
    annos: planAnnosForPdf(board?.[p.id] ?? [], scene?.captionMode ?? 'auto'),
  }))
  // the Gebäude is its own section: it prints with the «Pläne» off, and only while a storey
  // carries something (floorStackPages returns no page for an untouched stack)
  if (building && draft.options.gebaeude !== false) {
    for (const p of plans.filter((x) => x.floorStack)) {
      planPages.push(...floorStackPages(p, building, board?.[p.id] ?? [], scene?.captionMode ?? 'auto').map((page) => ({ ...page, caption: figureCaption })))
    }
  }

  // the Tafel — its own switch, ON unless the operator took it off (an older draft has none)
  const tafel = draft.options.tafel !== false
    ? tafelPayload(board, plans, scene, trupps, figureCaption, args.checklists && args.checklistTemplates ? { checklists: args.checklists, templates: args.checklistTemplates } : undefined,
      { timeline: events, inRapport: !!draft.options.pendenzen })
    : { boardPages: [] as Record<string, unknown>[] }
  if (tafel.skizze) planPages.unshift(tafel.skizze)

  const cfg = getDeploymentConfig()
  const catalogue = cfg.mittel?.catalogue ?? appConfig.mittel.catalogue
  // The caption dates the PICTURE, not the printing: a Kroki reconstructed for 21:14 says 21:14.
  const krokiCaption = fillTemplate(appConfig.copy.report.krokiState, {
    title: incident.title,
    at: formatDateTime(draft.options.krokiAt ?? draft.generatedAt),
  })
  const payload = {
    incident: {
      title: incident.title, id: incident.id, type: incident.type ?? undefined, address: incident.address ?? undefined,
      // an Übung has to be legible AS one on the paper — it is excluded from the statistics,
      // so a drill rapport that reads like a deployment contradicts the numbers behind it
      isExercise: incident.is_exercise,
    },
    meta: {
      alarmText: meta.alarmText, summary: meta.summary, lehren: meta.lehren, remarks: meta.remarks,
      kontaktperson: meta.kontaktperson, kontaktpersonTelefon: meta.kontaktpersonTelefon,
      // …the succession when the Einsatzleitung rotated («A (bis 14:20), B (ab 14:20)»),
      // the plain name when it never did — see einsatzleiterForPdf above
      einsatzleiter: einsatzleiterForPdf(
        meta.einsatzleiter, events,
        { alarmedAt: meta.alarmiertAt ?? incident.started_at, endedAt: meta.endedAt ?? closeTimeOf(incident) },
        meta.startedAt ?? incident.started_at,
      ),
      // «Entfällt» travels as the answer it is: the sheet prints the word on the line, where a
      // field nobody filled in gets an empty write-in rule (backend/app/report). Without
      // it the deliberate «gibt es nicht» and the forgotten field looked identical on paper.
      kontaktpersonNone: meta.kontaktpersonNone, rueckmeldungNone: meta.rueckmeldungNone,
      kommandant: cfg.identity?.kommandant ?? undefined,
      // the same bounds the Personalblatt uses, so every clock on the sheet follows one
      // midnight rule instead of two
      ...metaExtrasForPdf(meta, { alarmedAt: meta.alarmiertAt ?? incident.started_at, endedAt: meta.endedAt ?? closeTimeOf(incident) }),
      alarmiertAt: formatDateTime(meta.alarmiertAt ?? incident.started_at),
      ausgeruecktAt: meta.ausgeruecktAt ? formatDateTime(meta.ausgeruecktAt) : undefined,
      endedAt: meta.endedAt ? formatDateTime(meta.endedAt) : undefined,
      partnerContacts: meta.partnerContacts,
    },
    options: { tafel: draft.options.tafel !== false, kroki: !!kroki, atemschutz: draft.options.atemschutz, attendance: draft.options.attendance, mittel: draft.options.mittel, journal: draft.options.journal, pendenzen: draft.options.pendenzen, krokiLandscape: draft.options.krokiLandscape, auswertung: draft.options.auswertung },
    // Beilagen: only the ones actually ON the server. A blob: URL is a photo that has not
    // finished uploading, and the server cannot fetch it — printing would silently drop it, so
    // it is left out here and the preflight says so beside the row.
    attachments: draft.options.attachments
      ? attachments.filter((a) => a.url.startsWith('/')).map((a) => ({ url: a.url, caption: a.caption || undefined }))
      : [],
    ...mittelFormForPdf(mittel, catalogue),
    ...personalForPdf(roster, attendance, { alarmedAt: meta.alarmiertAt ?? incident.started_at, endedAt: meta.endedAt ?? closeTimeOf(incident) }),
    // Anwesende + Einsatzstunden as ONE line under the roster. Computed here, where the ISO
    // timestamps live: the printed rows carry «19:12 – 21:40», and re-deriving minutes from
    // formatted clock text on the server would be a second, disagreeing answer.
    personalSummary: (() => {
      const bounds = { alarmedAt: meta.alarmiertAt ?? incident.started_at ?? null, endedAt: meta.endedAt ?? closeTimeOf(incident) }
      const cfgRule = cfg.report?.hoursRounding
      const rule = {
        stepMin: cfgRule?.stepMin ?? DEFAULT_HOURS_ROUNDING.stepMin,
        graceMin: cfgRule?.graceMin ?? DEFAULT_HOURS_ROUNDING.graceMin,
      }
      const s = hoursSummary(hoursRows(attendance, bounds), rule)
      // `unresolved` travels too: those people are in NEITHER sum, and a total that quietly
      // leaves people out is worse than one that says it did
      // No Einsatzende → no block can be totalled, so there are no hours to state. The sheet
      // then prints the headcount alone rather than «0:00» twice with a paragraph explaining
      // that both zeros mean «unknown» — which is what a running Einsatz produced.
      const totalled = !!bounds.endedAt && s.minutes > 0
      return {
        present: s.present,
        hours: totalled ? fmtHours(s.minutes) : '',
        hoursRounded: totalled ? fmtHours(s.rounded) : '',
        unresolved: totalled ? s.unresolved : 0,
      }
    })(),
    partnerPresets: cfg.report?.partnerOrgs ?? [],
    generatedAt: formatDateTime(draft.generatedAt),
    kroki: kroki ?? undefined,
    krokiCaption: kroki ? krokiCaption : undefined,
    planPages,
    // the Tafel's pages, each on a sheet of its own in its own layout (backend · report_board)
    boardPages: tafel.boardPages,
    boardMap: tafel.boardMap,
    // ⚠️ WHAT «überfällig» MEANT on this Einsatz. The sheet reconstructs an Atemschutz-Einsatz
    // from its contact log, and every judgement about that log — was a gap acceptable, when did
    // the board go red — depends on an interval the paper never named. It is a per-incident
    // setting on top of a per-station one (IncidentSettings · contactIntervalMin), so a reader
    // six months later has no way to look it up: it has to travel with the document.
    atemschutzIntervalMin: args.contactIntervalMin,
    atemschutzGraceSec: args.contactGraceSec,
    // ⚠️ Trupps UNDER PA only (03.09.). This feeds the Atemschutz page — a safety document about
    // cylinders, contact intervals and Alarmdruck. A plain work squad (types · TruppKind
    // `einfach`) has none of those, so a row for it would print an Eingangsdruck of 0 bar and an
    // empty Druckverlauf under a heading that asserts it was monitored. It is not silently lost:
    // its Verlauf lines (angemeldet / eingerückt / draussen) are on the printed Journal like
    // every other action. (A place of its own in the Rapport is a separate, open question.)
    trupps: (draft.options.atemschutz ? trupps.filter(isAtemschutzTrupp) : []).map((t) => ({
      name: t.name, statusLabel: truppStatusLabel(t), members: t.members ?? [], auftrag: truppAuftragLabel(t.auftrag), ziel: t.ziel,
      // ⚠️ The heading and the crew PER CYCLE (12.09., docs/trupp-naming.md §5): «Trupp 1 – Meier
      // Anna» names the number and the Gruppenführer at registration, and each Eintritt names
      // the crew that went in, with the changes that happened during it as dated lines — all read
      // off the `crew` rows of the log, so a leader change or a transfer mid-Einsatz is on the
      // sheet and not only in the Verlauf's prose. The other Trupps are passed so a transfer can
      // be followed to where the person went. `members` above stays for an older backend.
      no: t.no,
      // …and the numbers it carried before a merge renumbered it (lib/truppNumbers): its early
      // Verlauf rows say that number, so the heading reads «Trupp 3 (zuerst Trupp 1) – …»
      ...(t.formerNos?.length ? { formerNos: t.formerNos } : {}),
      ...(() => {
        const { leader, cycles } = truppCrewHistory(t, trupps)
        return {
          leader,
          cycles: cycles.map((c) => ({
            entry: formatDateTime(c.entry),
            // ⚠️ A sortie still open when the Einsatz was CLOSED ends at the close, and says so
            // (staging r3 F4): «19:37 – 19:52 (beim Abschluss noch drin)», not an open «19:37»
            // that reads as a crew still inside today. No Austritt is invented — the words say
            // nobody reported one. While the Einsatz is open (or open again) it stays open.
            exit: c.exit ? formatDateTime(c.exit)
              : closedAt ? fillTemplate(appConfig.copy.atemschutz.cycleEndAtClose, { t: formatDateTime(closedAt) }) : undefined,
            crew: c.crew.join(' / '),
            changes: c.changes.map((ch) => ({ t: formatDateTime(ch.t), text: ch.text })),
          })),
        }
      })(),
      // the numeric Leitung, else the free text an older record still carries verbatim
      lineNumber: t.lineNo != null ? String(t.lineNo) : t.lineNumber?.trim() || undefined,
      // what the crew took in, as the short labels the card shows — printed only where set
      equipment: truppEquipmentLabels(t.equipment).join(', ') || undefined,
      // ⚠️ ALL cycles, read off the log — a Trupp that went in twice has two Eintritte and two
      // Austritte, and the header used to print the LAST pair over the FIRST cycle's rows (see
      // lib/report · truppRunTimes for why the card's own entryTime/exitTime are not the source).
      ...(() => {
        const { entries, exits, registered } = truppRunTimes(t.readings, { entryTime: t.entryTime, exitTime: t.exitTime })
        return {
          entryTimes: entries.map(formatDateTime),
          exitTimes: exits.map(formatDateTime),
          // only the sheet's «Nicht eingesetzt» line reads this — the Anmeldung of a Trupp that
          // never went in, so that row can print a span instead of its Draussen stamp alone
          registeredTimes: registered.map(formatDateTime),
        }
      })(),
      // ⚠️ A Trupp whose log is empty still has a pressure somebody read off the cylinder and
      // typed in. Trupps registered from 2026-08-09 open their log with it (useTruppActions ·
      // createTrupp); one recorded BEFORE that has only `entryPressureBar`, and printing «Kein
      // Druckverlauf erfasst» over a number the Überwacher wrote down is the sheet contradicting
      // the record. Undated, because that is all the older shape knows — a made-up clock on a
      // legal document is worse than a missing one.
      // …and `crew` rows are not readings: they print as the change lines above, never in the
      // Druckverlauf
      readings: ((() => { const measured = (t.readings ?? []).filter((r) => r.kind !== 'crew'); return measured.length ? measured : [{ t: '', bar: t.entryPressureBar, kind: 'registered' as const }] })()
        // ⚠️ no bar on a Kontakt/Rückzug row — that number was carried over, not read off a gauge
        // — and none on a row of 0, which is a Trupp that had no cylinder when it was written
        // (lib/report · readingBarShown)
        .map((rr, i, all) => ({
          t: rr.t ? formatDateTime(rr.t) : '',
          kindLabel: readingKindLabel(rr.kind, isStandDownExit(all, i)),
          bar: rr.bar != null && readingBarShown(rr) ? String(rr.bar) : undefined,
        }))),
    })),
    signatures: args.signatures ?? [],
    journal: draft.options.journal ? journal : [],
    journalDay: draft.options.journal ? journalDay : undefined,
    pendenzen: draft.options.pendenzen ? pendenzen : [],
    // the internal Beilage (lib/auswertung): computed HERE, where the ISO stamps are
    auswertung: draft.options.auswertung
      ? (() => {
          const interval = args.contactIntervalMin ?? atemschutzDoctrine().contactIntervalMin
          const grace = args.contactGraceSec ?? atemschutzDoctrine().contactGraceSec
          const a = computeAuswertung({
            alarmedAt: meta.alarmiertAt ?? incident.started_at,
            // ⚠️ `closedAt`, not `closeTimeOf`: a REOPENED Einsatz still carries its old close
            // time, and is running again — its open spans run to now, not to that close
            endedAt: meta.endedAt ?? closedAt ?? null,
            now: args.now ?? serverNow(),
            vehicles: fahrzeugRows(cfg.fleet?.vehicles ?? [], meta.fahrzeuge).map((r) => ({ label: r.config.label, zeit: r.value })),
            trupps,
            contactIntervalMin: interval,
            contactGraceSec: grace,
            events,
            doneMarks: doneMilestones(scene?.entities, board),
            checklists: args.checklists,
            templates: args.checklistTemplates,
          })
          return auswertungForPdf(a, { contactIntervalMin: interval, contactGraceSec: grace }, meta.lehren)
        })()
      : undefined,
  }
  return forPaper(payload) as Record<string, unknown>
}

/** The signed part of this Rapport as canonical JSON (lib/reportSignature · signatureScope), built
 *  from the same payload the PDF is — with every Beilage switched off, which is also what keeps it
 *  cheap enough to recompute while the Rapport is being edited. */
export function signedPartOf(args: DirectReportArgs): string {
  const o = args.draft.options
  const options = {
    ...o, kroki: false, annotatedPlans: false, allPlans: false, gebaeude: false, tafel: false,
    atemschutz: false, journal: false, pendenzen: false, attachments: false, auswertung: false,
  }
  return signatureScope(buildDirectReportPayload({ ...args, scene: undefined, board: undefined, building: null, signatures: undefined, scopeOnly: true, draft: { ...args.draft, options } }))
}

/**
 * «→» and «←» become «->» and «<-» — for the PAPER only.
 *
 * The journal writes real arrows on purpose («EL → Sanität» is the shape of a Funkprotokoll line)
 * and they are what the app shows, searches and stores. The rapport, though, is composed in
 * Helvetica server-side, which has no glyph for either: ReportLab would draw a black box on the
 * one copy that gets signed — the exact failure `stripUnprintable` exists to prevent for emoji.
 *
 * ⚠️ Mapped HERE, at the single point where the payload is assembled, rather than by editing what
 * the operator typed: what the app holds stays the record, and only the rendering compromises.
 * ⚠️ Applied to the whole payload rather than to the journal rows alone — an arrow is just as
 * likely in a Kurzbericht, a Bemerkung or a Mittel remark.
 */
export function forPaper(v: unknown): unknown {
  if (typeof v === 'string') return v.replace(/→/g, '->').replace(/←/g, '<-')
  if (Array.isArray(v)) return v.map(forPaper)
  if (v && typeof v === 'object') {
    return Object.fromEntries(Object.entries(v as Record<string, unknown>).map(([k, x]) => [k, forPaper(x)]))
  }
  return v
}

/** The payload, ready to compose — what the PDF download and the station printer both send.
 *  The payload bakes placard glyphs (Kemler via lookupUN), so the fetched hazard datasets are
 *  awaited first: a print seconds after boot must not be missing them. */
export async function readyDirectReportPayload(args: DirectReportArgs): Promise<Record<string, unknown>> {
  // …and so are the height profiles of the Leitungen that draw their pumps (lib/linePumps): on
  // flat ground the printed Motorspritzen would stand elsewhere than on the screen
  await Promise.all([ensureUnHazard(), ensureErg(), readyLinePumps(args.scene?.drawings ?? [])])
  return buildDirectReportPayload(args)
}

export async function downloadDirectReportPdf(args: DirectReportArgs): Promise<void> {
  const payload = await readyDirectReportPayload(args)
  await downloadReportPdf(args.incident.id, payload, reportFilenameHint(args.incident.title), args.transport)
}
