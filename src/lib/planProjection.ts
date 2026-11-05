// Rules for this area that span modules: docs/tactical-objects.md.

import type { BoardAnno, BoardPoint, Entity, LngLat } from '../types'
import type { GeorefFit, PlanPt } from './georef'
import { ROTATABLE } from './symbols'
import { SHAPE_DEFS } from './shapes'
import { entityToBoardSymbol, onSheet, planGroundWidthM, TWIN_CLIP_MARGIN } from './georefTwins'
import type { PlanFit, TacticalObject } from './tacticalObjects'
import { GEBAEUDE_PLAN_ID } from './whiteboard'

/**
 * The Karte, said in ONE sheet's own words — the second half of the unified object
 * (docs/tactical-objects.md · «One object, two surfaces»).
 *
 * An object's position is knowable on two surfaces, and it is STORED on the one it was last
 * hand-placed on. This module is the derivation for the other one: a geo-anchored object,
 * expressed as the annotation that sheet would have if the object had been drawn on it. The
 * sheet then renders and edits it with its own native chrome — no twin layer, no twin selection
 * list, no twin gesture — and an edit that MOVES it flips the anchor, at which point this
 * derivation stops and the stored anno takes over (lib/tacticalObjects · applyBoardToObjects).
 *
 * ⚠️ It is the exact mirror of `bakeGeoBody`, and the two have to stay inverse: a projected
 * anno that comes back from the sheet becomes the object's stored sheet body verbatim, so any
 * conversion this module makes that the bake does not undo would rotate, resize or displace the
 * object a little on every flip. Every asymmetry below is therefore deliberate and named.
 *
 * ## What is projected, and what is not
 *
 * ONLY geo-anchored objects. An object anchored on THIS sheet is drawn from its own anno, and
 * one anchored on ANOTHER sheet is not shown here at all — plan A's work never cluttered plan B
 * under the twins and must not start now. Live vehicles and responder positions are moments
 * rather than records; they project too, but as a read-only overlay the document never contains.
 *
 * ## The clip
 *
 * `toPlan` is defined for the whole world — a vehicle two kilometres away comes back as
 * `y = 37.4` and would smear along the sheet edge, or worse, sit just off it and look like it is
 * «at the building». So everything outside the sheet is DROPPED, with a small margin
 * (`TWIN_CLIP_MARGIN`) so a hydrant a hair past the paper edge still shows.
 */

/** A bearing said once: in [0, 360). Mod only — it never rounds and never guesses intent. */
export const bearing360 = (deg: number): number => ((deg % 360) + 360) % 360

/** Closer to north than any hand can turn — float noise from the ± `rotationDeg` pair, which the
 *  mod can leave just below 360 rather than at 0. */
const NORTH_EPS = 1e-9

/**
 * ⚠️ The sheet's own TURN, as a frame change carried in the data.
 *
 * A map glyph's bearing is north-referenced; on a sheet drawn at an angle to north the same
 * bearing has to be expressed relative to paper-up, and `fit.rotationDeg` is exactly that frame
 * change (georef · GeorefFit). Until the surfaces were unified this happened at RENDER time on
 * both sides, which meant the number in the record was north-referenced on one surface and
 * paper-referenced on the other depending on where you read it. Now it is applied here and undone
 * by the bake, so a stored rotation always means «relative to the paper it is stored on».
 *
 * Only for glyphs that HAVE a direction: a symbol with no rotation control (the Offizier, the
 * Sammelplatz) must not acquire one from the paper it happens to lie on.
 *
 * ⚠️ Both directions answer in [0, 360) (24.09.2026). A frame change is an addition, and an
 * addition that is ever applied twice COMPOUNDS without bound — the Feueralarm of 23.09. ended
 * with a Lüfter at 66 735° because the doc seam never undid this turn (lib/tacticalObjects ·
 * sheetBearings). The seam is fixed; the bound stays, so a bearing in the record is always one a
 * human can read.
 */
export const turnedToSheet = (deg: number | undefined, fit: GeorefFit, directional: boolean): number | undefined =>
  (directional ? bearing360((deg ?? 0) + fit.rotationDeg) : deg)

/**
 * …and back to north, the inverse the bake applies.
 *
 * ⚠️ A ground bearing of exactly 0 comes back ABSENT, and that is the whole point of normalising
 * on the way BACK rather than on the way out: an object with no rotation genuinely IS turned by
 * `rotationDeg` in the paper's frame, so the projection must state that — but «points north» is
 * the same fact as «has no bearing», and the record should say the shorter one. Without this,
 * every ordinary unturned Fahrzeug acquired `rotation: 0` the first time it was flipped, and the
 * inverse was one field short of being an inverse.
 *
 * «Exactly 0» is read modulo the circle and to within `NORTH_EPS`: once both directions answer in
 * [0, 360), `(360 + R) − R` can land a hair below 360 instead of on 0, and that hair is north.
 */
export const turnedToGround = (deg: number | undefined, fit: GeorefFit, directional: boolean): number | undefined => {
  if (!directional) return deg
  const ground = bearing360((deg ?? 0) - fit.rotationDeg)
  return ground < NORTH_EPS || 360 - ground < NORTH_EPS ? undefined : ground
}

/** Does this body's glyph carry a direction the paper's turn applies to? */
export const directionalGlyph = (o: { kind?: string; symbol?: string }): boolean =>
  o.kind === 'shape' || (o.kind === 'symbol' && !!o.symbol && ROTATABLE.has(o.symbol))

/** …and a SECOND one? `rotation2` aims the Grosslüfter's fan and the Hubretter's boom, and it is
 *  a north-referenced bearing exactly like `rotation` — so it takes the same frame change, or a
 *  flip on a turned sheet would swing the boom while leaving the truck where it was. */
export const directionalGlyph2 = (o: { kind?: string; rotation2?: number }): boolean =>
  o.rotation2 != null

const pt = (fit: GeorefFit, c: LngLat): PlanPt => fit.toPlan({ lng: c[0], lat: c[1] })

/**
 * Project ONE object's map body onto a sheet, or `null` when it does not land on it.
 *
 * The anno carries the object's OWN id — it is the same object, and that is what lets an edit
 * coming back off the sheet be matched to it. (The twin era prefixed these ids precisely because
 * a projection was not allowed to be the object; it is now.)
 */
export function projectOnto(o: TacticalObject, plan: PlanFit, margin = TWIN_CLIP_MARGIN): BoardAnno | null {
  const anno = projectOntoSheet(o, plan, margin)
  if (!anno || !plan.stack) return anno
  // the Gebäude stack: a map object lands on the tile of its first storey – Von, else its badge,
  // else level 0 (the implicit default of everything placed on the Karte, never written back as
  // explicit 0) – and shows as a copy on every tile up to Bis. A span the stack has no tile for
  // shows nothing. The tile says the floor; no badge on the anno.
  const e = o.entity
  const from = e ? e.floorFrom ?? e.floorTo ?? e.floor ?? 0 : o.drawing?.floorTag ?? 0
  const to = e ? e.floorTo ?? from : from
  const lo = Math.min(from, to), hi = Math.max(from, to)
  const tiles = plan.stack.floors.filter((f) => f >= lo && f <= hi)
  if (!tiles.length) return null
  const home = tiles.includes(from) ? from : tiles[0]
  const out: BoardAnno = { ...anno, floor: home, ...(e && (e.floorFrom != null || e.floorTo != null) ? { floorFrom: lo, floorTo: hi } : {}) }
  delete out.storey
  return out
}

function projectOntoSheet(o: TacticalObject, plan: PlanFit, margin: number): BoardAnno | null {
  // anchored on a sheet: drawn there natively, and nowhere else – EXCEPT the Gebäude stack's ink,
  // which the other linked sheets show through its baked map body with the storey as badge (the
  // motivating case, 14.09.2026: a Brand marked on +2 in the Gebäude reads «+2» on Modul 1). The
  // stack itself never shows another sheet's ink this way, and its own it draws natively.
  if (o.sheet && (o.sheet.planId !== GEBAEUDE_PLAN_ID || plan.stack)) return null
  const { fit } = plan
  const widthM = planGroundWidthM(fit, plan.aspect)
  const asN = (m: number | undefined, fallback?: number) => {
    const v = m ?? fallback
    return v == null ? undefined : v / widthM
  }
  const e = o.entity
  if (e) {
    if (e.live) return null // a moment, not a record — see `liveOverlay`
    const p = pt(fit, e.coord)
    if (!onSheet(p, margin)) return null
    const turn = (deg: number | undefined) => turnedToSheet(deg, fit, directionalGlyph(e))
    if (e.kind === 'symbol') {
      const anno = entityToBoardSymbol(e, p, widthM)
      return anno ? { ...anno, rotation: turn(anno.rotation), rotation2: turnedToSheet(anno.rotation2, fit, directionalGlyph2(anno)) } : null
    }
    if (e.kind === 'note') {
      return {
        // ⚠️ `e.label` verbatim, NOT `?? ''` — the bake reads `text ?? label`, so an empty
        // string would come back as a note that HAS a label, and absent must stay absent.
        id: o.id, kind: 'text', x: p.x, y: p.y, text: e.label, color: e.color,
        notePlain: e.notePlain, noteSize: e.noteSize, noteAutoW: e.noteAutoW,
        rotation: e.rotation, storey: e.floor,
      }
    }
    if (e.kind === 'shape') {
      return {
        id: o.id, kind: 'shape', shape: e.shape, x: p.x, y: p.y,
        // ⚠️ the SAME default the surfaces draw an unsized Form at (lib/shapes · SHAPE_DEFS).
        // A flat 40 m here meant an unsized Pfeil visibly resized the moment it was flipped.
        sizeN: asN(e.sizeM, SHAPE_DEFS[e.shape ?? 'square'].defaultSizeM),
        aspect: e.aspect, rotation: turn(e.rotation),
        rotation2: turnedToSheet(e.rotation2, fit, directionalGlyph2(e)),
        color: e.color, stop: e.stop, carrier: e.carrier, reverse: e.reverse, strokeW: e.strokeW,
        fillOpacity: e.fillOpacity, hatch: e.hatch, sharpCorners: e.sharpCorners, locked: e.locked,
        storey: e.floor,
      }
    }
    if (e.kind === 'team') {
      return {
        id: o.id, kind: 'resource', x: p.x, y: p.y, text: e.label, color: e.color,
        truppId: e.truppId, t: e.t,
        trail: e.trail?.map(({ coord, t }) => { const q = pt(fit, coord); return { x: q.x, y: q.y, t } }),
      }
    }
    return null // photo: media, not a place on the paper
  }
  const d = o.drawing
  if (!d) return null
  if (d.kind === 'circle') {
    // ⚠️ A circle stays a CIRCLE. The twin era turned it into an area ring, on the grounds that
    // the Plan had no circle primitive — it has had one for a while (`radiusN`), and a ring would
    // not round-trip: the flip would store a polygon where the object is a centre and a radius.
    const p = pt(fit, d.coords[0])
    if (!onSheet(p, margin)) return null
    return {
      id: o.id, kind: 'circle', x: p.x, y: p.y, radiusN: asN(d.radiusM),
      color: d.color, fillOpacity: d.fillOpacity, hatch: d.hatch, locked: d.locked,
      showDistance: d.showDistance,
    }
  }
  const pts = d.coords.map((c): BoardPoint => { const q = pt(fit, c); return [q.x, q.y] })
  if (pts.length < (d.kind === 'line' ? 2 : 3)) return null
  // A shape whose bounding box meets the paper survives even when every vertex lies just outside
  // — the board clips the SVG at its own edge, and a Fläche around the building is exactly that.
  const xs = pts.map((q) => q[0]), ys = pts.map((q) => q[1])
  if (Math.max(...xs) < -margin || Math.min(...xs) > 1 + margin || Math.max(...ys) < -margin || Math.min(...ys) > 1 + margin) return null
  // The label is anchored to the GROUND on the Karte (`labelAt`) and to the ink on the sheet (a
  // nudge off the midpoint), so it crosses as the offset from that midpoint. The FKS end tag's
  // ground point (`endLabelAt`) does NOT cross: on the sheet the tag is pinned to its line
  // (PlanLineDecor, sweep 28.10.2026 #8b) – carried over, it put the tag wherever that ground
  // happened to be on the sheet, off the line.
  const mid = pts[Math.floor((pts.length - 1) / 2)]
  const labelAt = d.labelAt ? pt(fit, d.labelAt) : null
  return {
    id: o.id, kind: d.kind === 'line' ? 'draw' : 'area', pts,
    color: d.color, width: d.width, dashed: d.dashed, arrow: d.arrow, arrowStop: d.arrowStop,
    marker: d.marker, showDistance: d.showDistance, label: d.label, fillOpacity: d.fillOpacity,
    // ⚠️ Schraffur crosses too. It is FKS MEANING, not decoration — a «betroffene Fläche»
    // mirrored as an ordinary washed one says something else about the ground (01.09.).
    hatch: d.hatch,
    labelDx: labelAt && mid ? labelAt.x - mid[0] : undefined,
    labelDy: labelAt && mid ? labelAt.y - mid[1] : undefined,
    teilstueck: d.teilstueck, content: d.content, lineNo: d.lineNo, floorTag: d.floorTag,
    truppId: d.truppId,
    // a Wand drawn on the Karte is a Wand on the sheet too (lib/grundriss · wallRolePatch)
    role: d.role,
    // …and a Leitung keeps its hose and Wassertransport assumptions (lib/hydraulics)
    hose: d.hose, relay: d.relay,
    // ⚠️ The lock crosses too. Without it a Fläche locked on the Karte was still draggable
    // through its mirror on the Plan, which defeats the whole point of locking it (01.09.).
    locked: d.locked,
  }
}

/**
 * The live feed on this sheet: vehicles and shared responder positions, as annos the sheet draws
 * but never owns. They are moments rather than records — nothing places them, nothing may edit
 * them, and they are not part of the document the operator is drawing on (the exact mirror of
 * the Karte, where the live layer is concatenated in at render time and never reaches the store).
 *
 * ⚠️ A responder's glyph is a ringed disc, and letting its centre sit in the generic 2 % margin
 * while the board clips at the paper edge leaves a white crescent plus a caption — the stray
 * «Trupp marker thing» from the field. Someone outside this plan is simply outside.
 */
export interface LiveMark {
  id: string
  /** where it stands on the paper */
  pt: PlanPt
  entity: Entity
  /** the sheet's own turn, so a directional glyph can be drawn in the paper's frame */
  rotationDeg: number
}

export function liveOverlay(entities: Entity[], plan: PlanFit, margin = TWIN_CLIP_MARGIN): LiveMark[] {
  const out: LiveMark[] = []
  for (const e of entities) {
    const p = pt(plan.fit, e.coord)
    if (!onSheet(p, e.kind === 'person' ? 0 : margin)) continue
    out.push({ id: e.id, pt: p, entity: e, rotationDeg: plan.fit.rotationDeg })
  }
  return out
}

/**
 * A Verlauf photo placed on the Karte (lib/photoGeo), shown on this georeferenced sheet.
 *
 * ⚠️ The one RECORD a sheet draws without owning it (F16, 08.10.2026). `projectOntoSheet` keeps
 * answering `null` for a photo — it is media, not a place on the paper, and a sheet anno for it
 * would need a bake back through the fit for an object nobody places on paper. But «where was
 * this taken» is exactly what a georeferenced plan can answer, so the sheet SHOWS the marker
 * (and its view cone) read-only, and a tap opens the picture. Moving or removing it is the
 * Karte's — the mark says so. A plan without a georeference shows nothing, and so does the
 * Gebäude stack: a GPS fix carries no storey, and the stack's tiles are storeys.
 */
export interface PhotoMark {
  id: string
  pt: PlanPt
  url?: string
  /** the lens's bearing in the PAPER's frame (ground bearing + the sheet's own turn) */
  heading?: number
  takenAt?: string
}

export function photoOverlay(entities: readonly Entity[], plan: PlanFit, margin = TWIN_CLIP_MARGIN): PhotoMark[] {
  if (plan.stack) return []
  const out: PhotoMark[] = []
  for (const e of entities) {
    if (e.kind !== 'photo' || !e.photoOf || !Array.isArray(e.coord)) continue
    const p = pt(plan.fit, e.coord)
    if (!onSheet(p, margin)) continue
    out.push({
      id: e.id, pt: p, url: e.photoUrl, takenAt: e.takenAt,
      ...(e.heading != null ? { heading: (((e.heading + plan.fit.rotationDeg) % 360) + 360) % 360 } : {}),
    })
  }
  return out
}
