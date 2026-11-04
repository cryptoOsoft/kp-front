/** What is left of the «Zwillinge»: nothing that projects, and the arithmetic that made it work.
 *
 *  A twin was a render-time PROJECTION of an object that lived on the other surface, and both
 *  directions of it are gone: an object is ONE record whose position is knowable on both
 *  surfaces, drawn by each with its own native chrome (lib/tacticalObjects, lib/planProjection).
 *  What survives here is the georeference itself — which plans have a usable fit, at which
 *  aspect it is taken, how far past the paper's edge still counts as «on the sheet», the
 *  Entity⇄BoardAnno vocabulary boundary the two projections both cross, and the Ebenen rows for
 *  the one thing that is still lent rather than owned: the sheet's raster backdrop.
 *
 *  ⚠️ The names kept the word. `twin:` is a persisted Ebenen-preference prefix (lib/prefs) and
 *  `TWIN_CLIP_MARGIN` is quoted by both projections; renaming either would rewrite device
 *  preferences for a word.
 */

/*
 * **Reference change or delete loses nothing.** Correcting a fit re-bakes every sheet-anchored
 * object's map body — that correction is the whole point of correcting a fit — as ONE undo step
 * with one Verlauf row («Referenz angepasst – n Objekte neu verortet»). A DELETED reference
 * leaves both bodies standing: the sheet keeps its annos, the Karte keeps the ground positions
 * the last fit baked, and neither is marked stale — last known truth, like a vehicle that
 * stopped reporting. Nothing moves, so the re-bake honestly reports 0, and the row is therefore
 * its own («Referenz entfernt – n Objekte behalten ihre letzte Position»): without it the
 * Verlauf would say nothing whatever about an act somebody performed on purpose. ⚠️ It is
 * derived from SHEET KEYS still on the rail (`georefTwins · referenceDelta`) — every
 * Einsatzobjekt has a «Modul 2», so counting plan ids would read every object switch as a
 * deletion. Re-linking later re-links both directions and re-bakes.
 * ⚠️ **A reference ARRIVING is a seed, never a correction** (23.09.2026, two phantom rows in
 * prod after a remount): the cause is decided PER SHEET KEY (`georefTwins · fitChange`). A key
 * this session has never baked a fit for — plans listed late, a `georefKey` resolving to the
 * binding's — bakes silently, no row, no step. Only a known key whose `fitSignature` changed is
 * a change (its own pairs say `reference` or `measurement`); a key re-linked after «Referenz
 * entfernt» is compared with the fit it was left on. `n` counts only GROUND relocations on those
 * sheets (`movedOnSheets`) — never objects whose bake differs for another reason (a turn, a
 * size, another sheet) — and `rebake` takes the undo step only when that count is > 0.
 * A sheet with no fit linked BY HAND gets its ONE row from the act, never the re-bake
 * (24.09.2026): the three commit points in `georefMode` (second pair placed, «Übernehmen»,
 * «Passung übertragen») call `noteHandLink`, and `georefTwins · handLinkRow` writes «Plan mit
 * Karte verknüpft – {plan}[ – n Objekte verortet]» unless the reader already knows that key (a
 * re-link after «Referenz entfernt» keeps the re-bake's «Referenz angepasst»); `tacticalLocked`
 * devices write nothing.
 *
 * The word «twin» survives where renaming it would cost something real: `twin:` is a persisted
 * Ebenen-preference prefix (`lib/prefs`) and would reset every device's rows, and
 * `TWIN_CLIP_MARGIN` is the one clip both derivations quote. Elsewhere it is only a name that
 * has outlived its concept — the file `lib/georefTwins.ts`, `components/TwinTeamPill`, the copy
 * keys `twinFromMap` / `twinUnnamed`, the `LayerPanel` `twins` prop — and any of those may be
 * renamed by whoever is next in that file anyway. Nothing in the app is a twin.
 */
import { approvedUntouched, fitSimilarity, hasAutoPairs, residualClaim, type Georef, type GeorefFit, type GeorefPair, type PlanPt } from './georef'
import type { PlanFit, TacticalObject } from './tacticalObjects'
import type { PlanScale } from './planScale'
import type { StationPlanScales } from './stationPlanScale'
import type { BoardAnno, Entity, LngLat, PlanDocument } from '../types'
import { appConfig } from '../config/appConfig'
import { fillTemplate } from './format'

/** How far past the sheet edge a projected map object may sit and still be drawn — 2 % of the
 *  sheet. Enough that a hydrant on the kerb outside the plan frame is not lost to a rounding
 *  error; far too little for anything that is genuinely somewhere else. */
export const TWIN_CLIP_MARGIN = 0.02

/** Aspect (width / height) of an A4 sheet in portrait — the same seed the Whiteboard starts a
 *  document at before its bitmap has been measured. */
const A4_PORTRAIT_AR = 1 / 1.414

/**
 * The `planAspect` a plan's georef fit has to be taken at (width / height).
 *
 * ⚠️ It MATTERS: the fit is solved in the isotropic space `(x·ar, y)`, so a wrong aspect tilts and
 * stretches the sheet against the ground — and since the fit is BAKED into every symbol standing
 * on that sheet, a wrong aspect is a wrong position in the record, not merely a tilted picture.
 *
 * Resolved in five steps:
 *
 *   this render's own measurement → the sheet's STORED measurement → per-incident calibration →
 *   station per-plan override → station default → A4 by orientation.
 *
 * The first is the surface that has the bitmap in front of it right now (the Whiteboard, via
 * usePlanMeasure · measureAR). The second is that same surface's answer, written down once and
 * shared with every other device (lib/stationPlanScale · noteMeasuredAspect) — the Karte has no
 * bitmap to measure, and this is how it stops having to guess. The three calibration layers are
 * the same order `resolvePlanScale` uses, because `PlanScale.ar` IS this number: it is recorded on
 * every calibration precisely so a factor can be called stale when the sheet changes shape.
 *
 * The last step is a fallback, not a measurement: an unmeasured, uncalibrated plan is assumed to
 * be the A4 its orientation says it is. For the Modul 2/3 sheets this app is built around that is
 * exactly right; for a plan of some other proportion it is approximate until somebody opens it.
 *
 * ⚠️ Unlike `resolvePlanScale` the calibration layers canNOT skip a STALE candidate, and the
 * reason is circular: `isStale` asks whether a calibration's `ar` still matches the CURRENT
 * aspect, and the current aspect is the very thing being looked for here. So when a Modul PDF is
 * replaced by a differently-shaped sheet, the old `ar` — the one value staleness exists to reject
 * — is exactly what survives, and the pairs cannot disagree with it either: they were fitted at
 * the same wrong aspect, so the residuals stay near zero (see georef · collinear for the same
 * blind spot). A MEASUREMENT is the only thing that breaks that circle, which is why the two
 * measured steps sit above the calibrations rather than among them.
 */
export function planAspect(
  plan: Pick<PlanDocument, 'id' | 'orientation' | 'georefKey' | 'georefAspect'>,
  scales: StationPlanScales,
  workspaceScale?: PlanScale,
  measured?: number,
): number {
  if (measured && measured > 0) return measured
  // A bound sheet carries the aspect MEASURED on its exact pinned PDF revision
  // (`PlanDocument.georefAspect`, from the server-approved alignment). It outranks every
  // calibration below: those describe whatever revision the station later worked on, while
  // the binding may pin an older sheet of a different shape.
  if (plan.georefAspect && plan.georefAspect > 0) return plan.georefAspect
  // ⚠️ `georefKey`, not `id`: the bitmap belongs to ONE Einsatzobjekt's sheet, while `id` is the
  // Modul slot every object shares — keyed on that, one building's replaced PDF would reshape
  // every other building's sheet in the same slot.
  const stored = scales.measuredArByPlan?.[plan.georefKey ?? plan.id]
  if (stored && stored > 0) return stored
  for (const cand of [workspaceScale, scales.byPlan[plan.id], scales.default ?? undefined]) {
    if (cand && cand.ar > 0) return cand.ar
  }
  return plan.orientation === 'portrait' ? A4_PORTRAIT_AR : 1 / A4_PORTRAIT_AR
}

/** A plan that is actually tied to the map, with its solved transform. */
export interface GeorefPlan {
  id: string
  /** the plan's rail code («Modul 2») — what the Ebenen row is named after */
  code: string
  title: string
  imageUrl?: string
  fit: GeorefFit
  /** ground width of the fitted sheet in metres (planGroundWidthM at the fit's own aspect) —
   *  what turns the sheet's normalized sizes into real distances on the Karte */
  widthM: number
  /** the fit still leans on the automatic scaffolding (georef · hasAutoPairs) — the Ebenen
   *  rows then say «ungemessen» instead of claiming a ⌀ off the contaminated fit */
  auto?: boolean
  /** …unless the station APPROVED it and nobody has started correcting it (georef ·
   *  approvedUntouched, the Ampel's own condition): a published fit is linked, and the row says
   *  so instead (18.09.2026) */
  approved?: boolean
}

/**
 * Every plan of this incident's object that carries a usable fit, in the order the plans were
 * given (which is the order the rail lists them, so the Ebenen rows read as the rail does).
 *
 * A plan with fewer than two pairs, or one whose pairs sit on top of each other, simply is not
 * in the list — `fitSimilarity` is the single arbiter of «usable», here as everywhere else.
 */
export function georefPlans(
  plans: PlanDocument[],
  georefOf: (planId: string) => Georef | null,
  aspectOf: (plan: PlanDocument) => number,
  /** was this sheet's fit published by the station's approval? Handed in rather than read here,
   *  so this stays a pure derivation over the values it is given (and testable as one). */
  approvedOf: (georefKey: string) => boolean = () => false,
): GeorefPlan[] {
  const out: GeorefPlan[] = []
  for (const p of plans) {
    // a floor stack is a COLUMN of copies of one footprint — one similarity transform cannot
    // mean anything across it, and the pairing mode refuses to arm on it for the same reason
    if (p.floorStack || p.viewer) continue
    const key = p.georefKey ?? p.id
    const pairs = georefOf(key)?.pairs
    if (!pairs?.length) continue
    const aspect = aspectOf(p)
    const fit = fitSimilarity(pairs, aspect)
    if (fit) out.push({ id: p.id, code: p.code, title: p.title, imageUrl: p.imageUrl, fit, widthM: planGroundWidthM(fit, aspect), auto: hasAutoPairs(pairs), approved: approvedUntouched(pairs, approvedOf(key)) })
  }
  return out
}

/**
 * ⚠️ What a fit DOES, as a string — the four numbers that fully determine a similarity transform
 * (scale, turn, where the sheet's origin lands) plus the sheet's ground width, which carries the
 * aspect. Two fits with the same signature put every symbol on the same ground point, so this is
 * the honest test for «the georeference was corrected» — as opposed to «the memo that solves it
 * ran again», which happens on any re-render that touches planDocs or the station scales and
 * must NOT be read as a correction (it would re-bake, mark the store dirty and push).
 */
export function fitSignature(p: GeorefPlan): string {
  const o = p.fit.toMap({ x: 0, y: 0 })
  return `${p.id}:${p.fit.scaleMPerU}:${p.fit.rotationDeg}:${o.lng},${o.lat}:${p.widthM}`
}

/** The key a plan's reference is stored under: its `georefKey` where it has one, else its own id
 *  (stationPlanScale · georefForPlan). ⚠️ A `planId` is the reusable Modul slot every
 *  Einsatzobjekt shares; the reference belongs to one concrete building's sheet. */
export const sheetKeyOf = (p: Pick<PlanDocument, 'id' | 'georefKey'>): string => p.georefKey ?? p.id

/**
 * ⚠️ WHY a fit changed — because the Verlauf may not guess, and the causes are not the same act.
 *
 * Either somebody CORRECTED the reference (moved a cross, accepted an automatic alignment,
 * transferred a Passung), or the app MEASURED the sheet and re-solved the very same landmark pairs
 * in a truer shape (stationPlanScale · noteMeasuredAspect). Both move every symbol standing on
 * that sheet and both are one journalled step — but «Referenz angepasst» over the second one
 * credits the operator with a correction nobody made, and the ↶ then offers to take back an act
 * that never happened. So the cause is READ, from the one thing only a hand changes: the pairs.
 *
 * ⚠️ Both devices get it right, which is why the first two are not a flag the writer sets. A
 * second tablet merely refreshes the station document and re-solves; it wrote nothing and could
 * not have said what happened — but it sees the same unchanged pairs and reaches the same answer.
 *
 * ⚠️ The THIRD one cannot be read that way, and that is exactly why it is passed in. A refused
 * write is rolled back (stationPlanScale · saveStationPlanScales), which restores the document
 * the operator's correction replaced — so the pairs change a second time, and read on their own
 * that is indistinguishable from a second hand correcting the reference back. It journalled the
 * correction twice and laid a ↶ over an act the server had already undone. Only the writer knows,
 * so the writer says so (`takeRolledBackStationWrite`).
 *
 * Exhaustive: `seed` (the first bake of a session, or of a SHEET — a reference arriving rather
 * than changing, see `fitChange`; nobody's act), `measurement`, `reference`,
 * `rollback`. Adding a fifth means deciding its Verlauf row AND whether it earns an undo step;
 * only the two that somebody actually performed do (IncidentWorkspace · the fit effect).
 */
export type FitChangeCause = 'seed' | 'reference' | 'measurement' | 'rollback'

/** …and the reading. `before === null` is the very first bake of a session, which is nobody's act
 *  at all: a blob simply gains its map bodies, nothing moved from anywhere — and it outranks a
 *  rollback, because there is no earlier state for a refusal to have taken anything back to. */
export function fitChangeCause(now: string, before: string | null, rolledBack = false): FitChangeCause {
  if (before === null) return 'seed'
  if (rolledBack) return 'rollback'
  return now === before ? 'measurement' : 'reference'
}

/**
 * ⚠️ …and what the fit effect WRITES for a cause: the ↶ caption, or null when NOBODY PERFORMED
 * the act and therefore no undo step is owed.
 *
 * Two of the four causes are somebody's doing. A `seed` is a blob gaining its map bodies for the
 * first time — nothing moved from anywhere. A `rollback` is the server refusing a write, after
 * which the objects stand exactly where they stood before it: there is nothing to take back, and
 * a ↶ over it would re-apply a reference the server has already refused to store.
 */
export function fitChangeUndoLabel(cause: FitChangeCause): string | null {
  const C = appConfig.copy.undoDomains
  if (cause === 'measurement') return C.blattform
  if (cause === 'reference') return C.reference
  return null
}

/**
 * …and the Verlauf row, or null when there is nothing worth saying.
 *
 * ⚠️ `moved` gates only the two that COUNT objects: «Referenz angepasst – 0 Objekte neu verortet»
 * is a row about nothing. The rollback's row counts nothing — it reports the SAVE — so it stands
 * whatever the re-bake moved, and it has to: the operator's «Referenz angepasst» row is already
 * above it and is now false.
 */
export function fitChangeRow(cause: FitChangeCause, moved: number): string | null {
  const C = appConfig.copy.log
  if (cause === 'rollback') return C.referenceRolledBack
  if (!moved) return null
  if (cause === 'measurement') return fillTemplate(C.referenceRemeasured, { n: moved })
  if (cause === 'reference') return fillTemplate(C.referenceRebaked, { n: moved })
  return null
}

/**
 * What happened to the REFERENCES between two bakes — specifically, which sheets lost theirs.
 *
 * A fit that vanishes moves nothing (`bakeGeoBody` hands a record straight back when its plan has
 * no fit), so the re-bake honestly reports 0 objects moved and the Verlauf would say nothing at
 * all about «Referenz zurücksetzen» — an act somebody performed on purpose, after which every
 * symbol on that sheet stands on a ground position nothing will correct again.
 *
 * ⚠️ Measured on SHEET KEYS, and only for sheets still on the rail. Every Einsatzobjekt has a
 * «Modul 2», so counting plan ids would read every object switch as a reference somebody deleted;
 * and a plan the rail simply stops offering has not lost anything — it is not there to lose it.
 */
export interface ReferenceDelta {
  /** the PLAN IDS whose sheet lost its reference — what the Verlauf row counts objects on */
  dropped: Set<string>
  /** the sheet keys that carry a reference NOW: the caller's `before` for the next comparison */
  referenced: Set<string>
}

export function referenceDelta(
  plans: Pick<PlanDocument, 'id' | 'georefKey'>[],
  linkedIds: Iterable<string>,
  /** the sheet keys that carried one at the last bake — null on the very first, which drops nothing */
  before: ReadonlySet<string> | null,
): ReferenceDelta {
  const byId = new Map(plans.map((p) => [p.id, p]))
  const referenced = new Set<string>()
  for (const id of linkedIds) { const p = byId.get(id); if (p) referenced.add(sheetKeyOf(p)) }
  const dropped = new Set<string>()
  if (before) for (const p of plans) { const k = sheetKeyOf(p); if (before.has(k) && !referenced.has(k)) dropped.add(p.id) }
  return { dropped, referenced }
}

/** One SHEET's reference as the fit effect baked it: what the fit does, what the operator set,
 *  and which plan ids show that sheet (an object names its sheet by plan id). */
export interface SheetFit {
  /** `fitSignature` of every plan showing this sheet */
  fit: string
  /** the landmark pairs as stored — the one thing only a hand changes (see `fitChangeCause`) */
  pairs: string
  planIds: string[]
}

/** Every linked plan's fit, keyed by SHEET (`sheetKeyOf`) — the unit a reference belongs to. */
export function sheetFits(
  plans: Pick<PlanDocument, 'id' | 'georefKey'>[],
  linked: GeorefPlan[],
  georefOf: (georefKey: string) => Georef | null,
): Map<string, SheetFit> {
  const byId = new Map(plans.map((p) => [p.id, p]))
  const out = new Map<string, SheetFit>()
  for (const p of linked) {
    const doc = byId.get(p.id)
    const key = doc ? sheetKeyOf(doc) : p.id
    const was = out.get(key)
    if (was) { was.fit += `|${fitSignature(p)}`; was.planIds.push(p.id); continue }
    out.set(key, { fit: fitSignature(p), pairs: JSON.stringify(georefOf(key)?.pairs ?? []), planIds: [p.id] })
  }
  return out
}

export interface FitChange {
  cause: FitChangeCause
  /** the PLAN IDS whose sheet's fit really changed — the only sheets a row may count objects on */
  changed: Set<string>
  /** every sheet this session has baked a fit for, at its latest: the next call's `known` */
  known: Map<string, SheetFit>
}

/**
 * ⚠️ WHAT changed between two bakes, decided PER SHEET (23.09.2026).
 *
 * The first answer read one signature over the whole rail, so ANY difference was a correction —
 * and the rail is not a constant: after a remount the plans, the object's details and its
 * bindings arrive asynchronously, and every arrival (a plan listed, a `georefKey` resolving from
 * the station's key to the binding's) changed that signature. Prod journalled «Referenz angepasst
 * – 4 Objekte neu verortet» twice that evening with nobody near a reference, and counted objects
 * whose bake merely differed for an unrelated reason (a Lüfter's drifted rotation on the Gebäude
 * stack, which is not even a referenced sheet). So:
 *
 *   · a sheet this session has NEVER baked a fit for is a SEED — a reference arriving, not one
 *     changing. Nobody's act, no row, no step, however many of them arrive in whatever order.
 *   · a sheet baked before whose `fitSignature` differs is a change, and ITS pairs say whose:
 *     moved pairs are a hand (`reference`), the same pairs re-solved are the app (`measurement`).
 *   · a sheet whose reference VANISHED is `referenceDelta`'s business, unchanged.
 *
 * ⚠️ `known` remembers every sheet at its LAST fit, not only those in the previous bake: a sheet
 * that leaves the rail (an object switch, a list refetching) and comes back unchanged is nothing,
 * and a reference re-linked after «Referenz entfernt» is compared with the fit its objects were
 * left standing on — it moves them, so it is a change somebody made, not a seed.
 */
export function fitChange(
  now: ReadonlyMap<string, SheetFit>,
  /** null on the session's very first bake */
  known: ReadonlyMap<string, SheetFit> | null,
  rolledBack = false,
): FitChange {
  const next = new Map(known ?? [])
  for (const [key, s] of now) next.set(key, s)
  const changed = new Set<string>()
  if (!known) return { cause: 'seed', changed, known: next }
  let byHand = false
  for (const [key, s] of now) {
    const was = known.get(key)
    if (!was || was.fit === s.fit) continue
    for (const id of s.planIds) changed.add(id)
    if (fitChangeCause(s.pairs, was.pairs) === 'reference') byHand = true
  }
  // the writer's own word outranks everything but the first bake (see fitChangeCause)
  if (rolledBack) return { cause: 'rollback', changed, known: next }
  return { cause: !changed.size ? 'seed' : byHand ? 'reference' : 'measurement', changed, known: next }
}

/** Where an object stands on the ground, as its map body says — nothing else about it. */
const groundOf = (o: { entity?: { coord: LngLat }; drawing?: { coords: LngLat[] } }): LngLat[] | null =>
  o.entity ? [o.entity.coord] : o.drawing ? o.drawing.coords : null

/**
 * ⚠️ How many objects a re-bake RELOCATED on the sheets whose fit changed — the `n` of «Referenz
 * angepasst – n Objekte neu verortet». `before`/`after` are the store either side of the bake,
 * index for index (bakeAll maps). Counted: an object on one of `sheets` whose ground position
 * differs. Not counted: objects on other sheets, a body appearing where there was none (nothing
 * was relocated from anywhere), and any other difference in the bake — a turn, a size, a label.
 * `gained` counts that appearing body too — the hand-link row's «verortet» (`handLinkRow`), where
 * gaining a place on the Karte is exactly what happened.
 */
export function movedOnSheets(
  before: readonly { sheet?: { planId: string }; entity?: { coord: LngLat }; drawing?: { coords: LngLat[] } }[],
  after: readonly { entity?: { coord: LngLat }; drawing?: { coords: LngLat[] } }[],
  sheets: ReadonlySet<string>,
  gained = false,
): number {
  if (!sheets.size) return 0
  let n = 0
  for (let i = 0; i < before.length; i++) {
    const a = before[i], b = after[i]
    if (a === b || !a.sheet || !sheets.has(a.sheet.planId)) continue
    const from = groundOf(a), to = b && groundOf(b)
    if (!to) continue
    if (!from) { if (gained) n++; continue }
    if (from.length !== to.length || from.some((c, j) => c[0] !== to[j][0] || c[1] !== to[j][1])) n++
  }
  return n
}

/**
 * ⚠️ The Verlauf row for a sheet a HAND linked to the Karte — «Plan mit Karte verknüpft – Modul 2
 * – 5 Objekte verortet» — or null when this act is not the one that owes it (24.09.2026).
 *
 * Handed the pairs by the act itself (georefMode · setGeorefLinkedHandler: the second pair
 * placed, «Übernehmen», «Passung übertragen»), never by the re-bake: to the fit reader a first
 * link is a sheet key ARRIVING, the same as a plan that finished loading, and it writes nothing
 * for either (`fitChange`). So there is exactly one row, and it is this one.
 *
 * Null when:
 *   · the fit reader has baked this sheet before in this session (`known`) — a reference
 *     re-linked after «Referenz entfernt» is compared with the fit it was left on, and the
 *     re-bake's «Referenz angepasst» is its row. Writing here too would be the double row.
 *   · no sheet on the rail answers to the key — nothing of this Einsatz stands on it.
 *
 * `n` counts what the re-bake is about to do on that sheet, the way `movedOnSheets` counts, plus
 * a body GAINED: the sheet's objects baked through the new fit, against where they stand now.
 * When the fit cannot be solved here (no usable aspect) the count is omitted, never guessed —
 * and so is a count of 0, which is a row about nothing.
 */
export function handLinkRow(
  georefKey: string,
  pairs: GeorefPair[],
  ctx: {
    plans: PlanDocument[]
    known: ReadonlyMap<string, SheetFit> | null
    aspectOf: (plan: PlanDocument) => number
    objects: readonly TacticalObject[]
    /** the store's own bake (tacticalObjects · bakeAll), injected — that module imports this one */
    bake: (objects: TacticalObject[], fits: ReadonlyMap<string, PlanFit>) => readonly TacticalObject[]
  },
): string | null {
  if (ctx.known?.has(georefKey)) return null
  // the same sheets `georefPlans` would give a fit — a floor stack and a viewer-only plan never have one
  const sheets = ctx.plans.filter((p) => sheetKeyOf(p) === georefKey && !p.floorStack && !p.viewer)
  if (!sheets.length) return null
  const fits = new Map<string, PlanFit>()
  for (const p of sheets) {
    const aspect = ctx.aspectOf(p)
    const fit = fitSimilarity(pairs, aspect)
    if (fit) fits.set(p.id, { fit, aspect })
  }
  const placed = fits.size === sheets.length
    ? movedOnSheets(ctx.objects, ctx.bake(ctx.objects as TacticalObject[], fits), new Set(fits.keys()), true)
    : 0
  const C = appConfig.copy.log
  const plan = sheets[0].code
  return placed ? fillTemplate(C.referenceLinkedPlaced, { plan, n: placed }) : fillTemplate(C.referenceLinked, { plan })
}

/* ⚠️ No twin-specific size bands. Until 30.08. twins wore their own «quieter» px bands — in the
   field that read as «different object», not as «projection». Doctrine: twins are
   presentation-equivalent — the board sizes a twin with its own native rule (Whiteboard · symBase). */

/** Is a projected point on the sheet (plus the tolerated margin)? */
export function onSheet(p: PlanPt, margin = TWIN_CLIP_MARGIN): boolean {
  return (
    Number.isFinite(p.x) && Number.isFinite(p.y) &&
    p.x >= -margin && p.x <= 1 + margin && p.y >= -margin && p.y <= 1 + margin
  )
}

/** The name a mirrored object answers to — its own label/text where it has one, else its kind's
 *  tool name (a nameless line is «Linie», never «Symbol»). Takes both a plan annotation and a map
 *  entity, because a panel may be handed either shape. */
export function contentTwinName(o: { kind?: string; label?: string; text?: string; shape?: string }): string {
  const C = appConfig.copy
  const named = o.label?.trim() || o.text?.trim()
  if (named) return named
  switch (o.kind) {
    case 'text': case 'note': return C.whiteboard.text
    case 'resource': case 'team': return C.whiteboard.team
    case 'shape': return C.shapes.names[o.shape ?? ''] ?? C.shapes.kindLabel
    case 'area': return C.whiteboard.area
    case 'circle': return C.drawingEditor.circle
    case 'draw': return C.whiteboard.line
    default: return C.whiteboard.georef.twinUnnamed
  }
}

// --- the Entity ⇄ BoardAnno vocabulary boundary ------------------------------------------------
//
// ⚠️ These two functions are a TYPE BOUNDARY, and a spread cannot police one on its own: excess-
// property checking does not apply to spread members, so a field added to `Entity` or `BoardAnno`
// would ride across silently and mean nothing (or the wrong thing) on the far side — a plan-space
// `sizeN` landing on the map, a floor-stack tile index read as a storey badge. So the fields that
// must NOT cross are listed by name, and the two `_…Accounted` assertions below check what is
// LEFT against the target's own keys: add a field to either interface and this file stops
// compiling until somebody has said which side of the boundary it belongs on.

type Assert<T extends true> = T

/** Drop the listed keys. Typed, so the result is exactly `Omit<T, K[number]>` and the assertions
 *  below have something real to measure. */
function omit<T extends object, K extends readonly (keyof T)[]>(o: T, keys: K): Omit<T, K[number]> {
  // `Partial<T>` only so `delete` is legal on the required keys; the return type is the real one.
  const out: Partial<T> = { ...o }
  for (const k of keys) delete out[k]
  return out as Omit<T, K[number]>
}

/** Entity fields that mean nothing — or something else — on a plan sheet: the map's own position
 *  and layer, the live-feed extras, the metre-scaled geometry whose plan twins are `sizeN`/`reachN`,
 *  and the trail/Trupp link that belongs to the ONE surface the object is placed on. `kind` is
 *  re-stated by the transfer and `floor` (the signed storey badge) becomes the plan's `storey`. */
const ENTITY_MAP_ONLY = [
  'coord', 'layer', 'kind', 'symbolSvg', 'badge', 'photoUrl', 'live', 'directed', 'noteW',
  'sizeM', 'reachM', 'truppId', 'trail', 't', 'floor',
  // a photo marker's picture reference and EXIF facts — a photo is never a sheet anno
  'photoOf', 'heading', 'takenAt',
] as const satisfies readonly (keyof Entity)[]
type _EntityKeysAccounted = Assert<Exclude<keyof Entity, (typeof ENTITY_MAP_ONLY)[number]> extends keyof BoardAnno ? true : false>

/** BoardAnno fields that do not belong on the map: every non-symbol geometry (draw/area/text/FKS
 *  line annotations), the plan-normalized sizes, and the two floor fields — `floor` is a
 *  floor-stack TILE INDEX that must never be read as `Entity.floor`'s signed badge, while `storey`
 *  is the badge and becomes exactly that. */
const BOARD_PLAN_ONLY = [
  'kind', 'pts', 'x', 'y', 'text', 'wN', 'sizeN', 'reachN', 'radiusN', 'width', 'dashed', 'arrow', 'arrowStop', 'marker',
  'showDistance', 'labelDx', 'labelDy', 'teilstueck', 'content', 'lineNo', 'floorTag',
  'endDx', 'endDy', 'fillOpacity', 'hatch', 't', 'trail', 'truppId', 'floor', 'locked',
  'startAttachment', 'endAttachment', 'storey', 'form',
  // the Gebäude Grundriss (27.10.2026): a Wand's role and a Durchgang's wall link are
  // layout of the floor stack and mean nothing on the map
  'role', 'onWall',
  // a Leitung's hose and Wassertransport assumptions — line vocabulary, no symbol has them
  'hose', 'relay',
] as const satisfies readonly (keyof BoardAnno)[]
type _BoardKeysAccounted = Assert<Exclude<keyof BoardAnno, (typeof BOARD_PLAN_ONLY)[number]> extends keyof Entity ? true : false>

/** Ground width of the fitted sheet in metres — the one factor that converts the map's
 *  metre-scaled geometry (`reachM`) into plan-width fractions (`reachN`) and back. PlanScale /
 *  georef units are aspect-corrected: one normalized sheet width is ar·mPerU metres. */
export const planGroundWidthM = (fit: GeorefFit, aspect: number) => Math.max(0.001, fit.scaleMPerU * aspect)

/** Move the one source object from Lage ownership to a Modul document. Projection is not copied:
 *  the same id and SymbolProps cross the boundary, then the georeference derives its map twin.
 *  `widthM` (planGroundWidthM) converts the Hubretter reach into the sheet's own unit — without
 *  it the metre value is dropped rather than smuggled across as a wrong number. */
export function entityToBoardSymbol(entity: Entity, pt: PlanPt, widthM?: number): BoardAnno | null {
  if (entity.kind !== 'symbol' || entity.live) return null
  const reachN = entity.reachM != null && widthM ? entity.reachM / widthM : undefined
  return { ...omit(entity, ENTITY_MAP_ONLY), id: entity.id, kind: 'symbol', x: pt.x, y: pt.y, storey: entity.floor, ...(reachN != null ? { reachN } : null) }
}

/** The shared half of a map body: everything that is NOT map-only vocabulary, which by the
 *  `_EntityKeysAccounted` assertion above is exactly a subset of `BoardAnno`'s own fields.
 *  This is what an edit made on the Karte writes through onto a sheet-anchored object's anno
 *  (lib/tacticalObjects · applyDocToObjects). The position and the unit-bearing sizes are
 *  excluded by the same list — neither means anything on a sheet without the plan's fit. */
export function entitySharedProps(entity: Entity): Omit<Entity, (typeof ENTITY_MAP_ONLY)[number]> {
  return omit(entity, ENTITY_MAP_ONLY)
}

/** The reverse ownership transfer. Map-only location/layer fields are supplied by the caller;
 *  no duplicate survives on the plan. */
export function boardSymbolToEntity(anno: BoardAnno, coord: LngLat, layer: Entity['layer'], widthM?: number): Entity | null {
  if (anno.kind !== 'symbol') return null
  const reachM = anno.reachN != null && widthM ? anno.reachN * widthM : undefined
  return { ...omit(anno, BOARD_PLAN_ONLY), id: anno.id, kind: 'symbol', layer, coord, floor: anno.storey, ...(reachM != null ? { reachM } : null) }
}

// --- the Ebenen rows -------------------------------------------------------------------------

/** Ebenen row ids for the twin layers. Prefixed so `toggleLayer` can tell a twin row from a real
 *  `LayerDef` at a glance — the two persist in different places (see IncidentWorkspace). */
export const TWIN_PLAN_IMAGE_PREFIX = 'twin:plan-image:'

/** The Ebenen row id for one georeferenced plan's sheet, rastered under the Karte's ink. */
export const twinPlanImageLayerId = (planId: string) => `${TWIN_PLAN_IMAGE_PREFIX}${planId}`

/** Is this an Ebenen row id belonging to a twin layer (rather than a real map `LayerDef`)? */
export const isTwinLayerId = (id: string) => id.startsWith('twin:')

/** A twin's Ebenen row. Shaped like `LayerDef` on purpose — the panel renders both with the
 *  same row markup, so a twin layer is switched exactly like any other layer. */
export interface TwinLayerRow {
  id: string
  group: string
  label: string
  /** the second, quieter line: the fit this row mirrors through */
  sub?: string
  icon: string
  visible: boolean
  /** Raster backdrops expose the same transparency control as every other map overlay. */
  opacity?: number
  /** a colour the row stands for (a Karte object category): the glyph wears it */
  swatch?: string
}

/** Twin layers default ON: a georeference exists because somebody deliberately made one, and
 *  the whole point of making it was to see both pictures at once. */
export function twinVisible(prefs: Record<string, boolean> | undefined, id: string): boolean {
  return prefs?.[id] ?? true
}


/** The literal sheet is opt-in: symbols are useful by default, a full plan backdrop is not. */
export function twinPlanImageVisible(prefs: Record<string, boolean> | undefined, planId: string): boolean {
  return prefs?.[twinPlanImageLayerId(planId)] ?? false
}

/** How well this plan sits, in the same words the Passung chip uses — «aus 2 Punkten» when the
 *  fit is exact and therefore UNMEASURED, a residual once a third pair has measured it. */
export function twinFitNote(fit: GeorefFit, auto = false, approved = false): string {
  const C = appConfig.copy.whiteboard.georef
  // an automatic scaffolding in the fit voids every claim: no ⌀ (the synthetic pairs
  // contaminate the number) and no «aus 2 Punkten» (nobody set them) — the row says what it
  // is, exactly as the chip/lamp/Passung do…
  // …and once the station APPROVED that fit it is no longer a proposal (18.09.2026): the row
  // reads «Verknüpft», the word a hand-measured fit's row wears, and still claims no ⌀.
  if (auto) return approved ? C.chipLinked : C.chipAuto
  const m = residualClaim(fit)
  return m == null ? C.chipTwoPoints : fillTemplate(C.chipResidual, { m: m.toFixed(2) })
}

/** The Karte side: the literal sheet, as an optional raster backdrop under the ink. The symbols
 *  that stand on it need no row of their own any more — they are ordinary map objects and answer
 *  to the Ebene they were placed on. */
export function planRasterRows(
  plans: GeorefPlan[],
  prefs: Record<string, boolean> | undefined,
  opacity: Record<string, number> | undefined = undefined,
): TwinLayerRow[] {
  const C = appConfig.copy.whiteboard.georef
  return plans.flatMap((p) => (p.imageUrl ? [{
    id: twinPlanImageLayerId(p.id),
    group: C.layerGroupPlans,
    label: fillTemplate(C.layerPlanImage, { plan: p.code }),
    sub: twinFitNote(p.fit, p.auto, p.approved),
    icon: 'map',
    visible: twinPlanImageVisible(prefs, p.id),
    opacity: opacity?.[twinPlanImageLayerId(p.id)] ?? 55,
  }] : []))
}


