// Build the server-rendered Kroki payload: DATA instead of captured pixels.
// Dynamic glyphs the server can't derive —
// vehicles (name+heading baked into the SVG), placards with field values, the Grosslüfter
// composite, generic shapes — are resolved to SVG strings HERE with the same pure helpers
// the live map uses, so client and server render the identical artwork.

import type { CaptionMode, Drawing, Entity, LayerDef, LngLat, ShapeKind, Trupp } from '../types'
import { appConfig } from '../config/appConfig'
import { isVehicleSym, shapePx } from './mapView'
import { placardSvgForSymbol } from './placard'
import { vehicleSymbolSvg } from './useVehiclePositions'
import { LUEFTER, LUEFTER_EXTRACT, compositeSpec, compositePartGlyph, composeCompositeSvg, isHubretter, composeHubretterSvg } from './symbolRender'
import { SHAPE_DEFS, SHAPE_MAX_PX, rotationInner, rotationViewBox, shapeAspect, squareInner, squareViewBox, type RotationCarrier } from './shapes'
import { operationalExtentPoints, type KrokiView } from './report'
import { endOnTarget, resolveMapDrawings } from './lineAttachments'
import { truppForLine, truppTagText } from './truppLines'
import { symbolLegendText } from './symbols'
import { doneBadge } from './objectDone'
import { withCartoLabelsBaked, withoutCartoBasemapKey, withoutCartoRetina } from './carto'
import { drawnPumpEntities } from './linePumps'

export interface KrokiEntityOut {
  coord: LngLat
  /** only on an entity a Leitung is attached to — what a drawing's `startAt` / `endAt` names.
   *  ⚠️ Mirrored in backend/app/report · KrokiEntityIn. */
  id?: string
  symbol?: string
  symbolSvg?: string
  kind: string
  rotation?: number
  floor?: number
  floorFrom?: number
  floorTo?: number
  count?: number
  spread?: Entity['spread']
  caption?: string
  /** «Gelöscht / erledigt» (lib/objectDone): the HH:MM it was declared over — the sheet prints the
   *  glyph grey with this time in its top-left corner. ⚠️ Mirrored in backend/app/report ·
   *  KrokiEntityIn; the legend's word («gelöscht 20:40») already rides in `caption`. */
  done?: string
  sizeM?: number
  /** generic shapes: which kind, so the server can apply the SAME size and aspect limits the
   *  client does (a Rotation spans the map and is far leaner than any box — lib/shapes ·
   *  SHAPE_MAX_PX / shapeAspect). ⚠️ Mirrored in backend/app/kroki.py. */
  shape?: ShapeKind
  /** generic shapes: height/width ratio of the glyph box (absent = 1). ⚠️ Mirrored in
   *  backend/app/report · KrokiEntityIn — a field pydantic doesn't know is dropped. */
  aspect?: number
  color?: string
  // note styling — noteW is what makes a note a wrapping text box, so the sheet breaks the
  // lines where the screen did. Absent on every other kind, and absent on legacy notes.
  noteW?: number
  noteSize?: Entity['noteSize']
  notePlain?: boolean
}

/** A drawing as the SERVER needs it: the stored fields plus `trupp`, the Atemschutz leader
 *  already resolved + abbreviated here (the compositor has no Trupp records of its own). */
export type KrokiDrawingOut = Partial<Drawing> & {
  trupp?: string
  /** the entity this end is ATTACHED to. `coords` are already resolved, but against the fixed
   *  ground footprint of lib/lineAttachments · resolveMapDrawings — this file has no projection.
   *  The server knows the sheet's view and re-couples the end to the glyph as printed
   *  (backend · kroki · _snap_attached_ends); without it a close crop left the hose visibly
   *  short of its vehicle (18.09.2026). */
  startAt?: string
  endAt?: string
  /** …and the same for an end attached to ANOTHER Leitung's end. A branch off a Teilstück belongs
   *  on one of the fork's prong tips, and the fork is a glyph sized in pixels — this file fans the
   *  branches out by metres (backend · kroki · _snap_line_joints). `id` rides only on a line that
   *  is such a target. ⚠️ Mirrored in backend/app/report · KrokiLineEndIn. */
  startAtLine?: KrokiLineEnd
  endAtLine?: KrokiLineEnd
}
export interface KrokiLineEnd { id: string; endpoint: 'start' | 'end'; port?: number }

export interface KrokiPayloadOut {
  entities: KrokiEntityOut[]
  drawings: KrokiDrawingOut[]
  fitPoints: LngLat[]
  center?: LngLat
  zoom?: number
  bounds?: [number, number, number, number]
  maxTileZoom?: number
  tiles: string
  attribution: string
}

/** Print-specific marker scale for close-up Kroki crops. Mirrors backend/app/kroki.py:
 * overview maps stay unchanged; from z18 onward symbols ease down to a 0.85 floor.
 *
 * ⚠️ PURELY a function of the print zoom — the device's Symbolgrösse (lib/prefs · SYMBOL_SCALE)
 * deliberately does NOT enter here. Three reasons, and this was decided, not overlooked:
 *  • The sheet is a shared, archived record. Two tablets printing the same Einsatz must produce
 *    the same paper; a per-device legibility setting made in bright sun must not change it.
 *  • The device pref answers «how well can I read this screen». Paper has neither that screen's
 *    pixel density nor its viewing distance, and the print path is tuned for the page already.
 *  • WYSIWYG: KrokiFramingPanel previews the crop with exactly this factor and no other. Feeding
 *    the pref in here would have to be mirrored in the preview AND in the backend payload as a
 *    third place to keep in step — and the mul mirrors have bitten us before.
 *
 * ⚠️ It MUST stay in step with `kroki_symbol_mul` in backend/app/kroki.py, or the framing modal
 * stops being WYSIWYG: what you crop is what prints. (0.85, not 0.70 — 18.08.) */
export const krokiSymbolMul = (zoom: number): number =>
  Math.max(0.85, 1 - Math.max(0, zoom - 17) * 0.1)

/** The same silhouettes as lib/shapes.tsx ShapeGlyph, as plain SVG strings for resvg.
 *  `stop` (arrow only) adds the «→|» Stopp-Balken across the tip — identical artwork to the
 *  live glyph, so the print says exactly what the screen said. */
export function shapeSvgString(kind: ShapeKind, color: string, stop = false, aspect?: number, carrier?: RotationCarrier, strokeW?: number, boxPx?: number, fillOpacity?: number, hatch?: boolean, sharpCorners?: boolean, reverse?: boolean): string {
  const open = '<svg viewBox="0 0 100 100" xmlns="http://www.w3.org/2000/svg" preserveAspectRatio="none">'
  // the loop's arrowheads have to be counter-scaled against the SAME aspect the print stretches
  // the box by, or the paper shows flattened wedges where the screen shows arrows
  if (kind === 'rotation') {
    const asp = shapeAspect('rotation', aspect)
    return `<svg viewBox="${rotationViewBox(asp)}" xmlns="http://www.w3.org/2000/svg" preserveAspectRatio="none" overflow="visible">${rotationInner(color, asp, carrier, strokeW, boxPx, reverse)}</svg>`
  }
  if (kind === 'arrow') {
    const bar = stop
      ? '<path d="M20 7 L80 7" stroke="#fff" stroke-width="9" stroke-linecap="round"/>'
        + `<path d="M20 7 L80 7" stroke="${color}" stroke-width="5" stroke-linecap="round"/>`
      : ''
    return `${open}<path d="M50 6 L80 50 L60 50 L60 94 L40 94 L40 50 L20 50 Z" fill="${color}" stroke="#fff" stroke-width="4" stroke-linejoin="round"/>${bar}</svg>`
  }
  if (kind === 'square') {
    // the aspect-matched box, exactly as the screen draws it (lib/shapes · squareInner) — the
    // stretch that used to fatten the verticals happened on paper too
    const asp = shapeAspect('square', aspect)
    return `<svg viewBox="${squareViewBox(asp)}" xmlns="http://www.w3.org/2000/svg" preserveAspectRatio="none">${squareInner(color, asp, strokeW, boxPx, fillOpacity, hatch, sharpCorners)}</svg>`
  }
  return `${open}<path d="M27 76 Q12 76 12 62 Q12 49 26 50 Q26 34 43 35 Q52 24 65 33 Q82 31 81 48 Q94 50 90 64 Q86 76 71 76 Z" fill="${color}" fill-opacity="0.5" stroke="${color}" stroke-width="4.5" stroke-linejoin="round" stroke-linecap="round"/></svg>`
}

/**
 * An Absperrkreis (Gefahrenradius) as a standalone SVG string — for the one path that can place
 * a glyph but not a circle: the printed plan page (reportPdfDirect · planAnnosForPdf) sends it as
 * a `symbol` whose `sizeN` is the cordon's DIAMETER as a fraction of the plan width. The box is
 * square, so the ring stays round on paper whatever the sheet's aspect is, and the server needs
 * no circle primitive of its own.
 *
 * ⚠️ The outline weight is in viewBox units, like every other plan glyph printed without a box
 * size (shapeSvgString · `boxPx` undefined): a printed cordon keeps its proportion rather than a
 * screen pixel weight.
 */
export function circleSvgString(color: string, fillOpacity?: number, hatch = false, dashed = true): string {
  const sw = 3
  const r = 50 - sw / 2
  const id = `cih-${color.replace(/[^a-z0-9]/gi, '')}`
  const defs = hatch
    ? `<defs><pattern id="${id}" patternUnits="userSpaceOnUse" width="12" height="12"`
      + ` patternTransform="rotate(45)"><line x1="0" y1="0" x2="0" y2="12" stroke="${color}"`
      + ' stroke-width="1.6"/></pattern></defs>'
    : ''
  const fill = hatch ? `fill="url(#${id})"` : `fill="${color}" fill-opacity="${fillOpacity ?? 0.12}"`
  return '<svg viewBox="0 0 100 100" xmlns="http://www.w3.org/2000/svg" preserveAspectRatio="none">'
    + defs
    + `<circle cx="50" cy="50" r="${r}" ${fill} stroke="${color}" stroke-width="${sw}"`
    + `${dashed ? ' stroke-dasharray="7 5"' : ''}/></svg>`
}

/**
 * The pixel width the SERVER will raster this shape's box at — the same number the on-screen
 * marker uses, before the page's own dpi scaling.
 *
 * ⚠️ That last part is what makes the outline match a drawn Zeichnung on paper: the server scales
 * a shape's raster and a line's `width` by the SAME page factor, so a stroke computed against the
 * unscaled box lands on the same weight as the Linie beside it. Mirrors `krokiSymbolMul`, which
 * already has to stay in step with `kroki_symbol_mul` in backend/app/kroki.py.
 */
function shapeBoxPx(e: Entity, kind: ShapeKind, printZoom?: number): number | undefined {
  if (printZoom == null) return undefined
  // ⚠️ per-kind cap, same as the on-screen marker (MapMarkers): the default 900 px ceiling
  // understated a long Rotation's box, and strokeUnits (= units/boxPx) then printed its outline
  // up to 13× too fat — the server rasters the run at up to SHAPE_MAX_PX (kroki.py mirrors it)
  return shapePx(e.sizeM ?? SHAPE_DEFS[kind].defaultSizeM, e.coord[1], printZoom, SHAPE_MAX_PX[kind]) * krokiSymbolMul(printZoom)
}

/** Resolve one map entity into the server's Kroki entity — or null when it has no
 *  printable representation (photo markers stay app-only).
 *
 *  `printZoom` is the zoom the sheet will be rendered at (the framing crop). It is what lets a
 *  shape's outline be built at the same pixel width a drawn Zeichnung has — see `shapeBoxPx`.
 *  Omitted (a legend row, a caller with no crop yet) ⇒ the shape keeps its icon weight. */
export function krokiEntity(e: Entity, byName: Record<string, string>, captionMode: CaptionMode = 'auto', printZoom?: number): KrokiEntityOut | null {
  if (e.kind === 'photo') return null
  const base: KrokiEntityOut = {
    coord: e.coord, kind: e.kind, rotation: e.rotation,
    floor: e.floor, floorFrom: e.floorFrom, floorTo: e.floorTo,
    count: e.count, spread: e.spread,
    // The symbol's LEGEND line — «Art · Bezeichnung · Status». The server lifts it off the picture
    // into a numbered legend, where the screen's value-only caption («in Rettung») named no
    // object at all (18.09.2026) — see lib/symbols · symbolLegendText.
    caption: symbolLegendText(e, captionMode) ?? undefined,
    done: doneBadge(e) ?? undefined,
  }
  if (e.kind === 'team') return { ...base, caption: e.label || undefined, color: e.color || undefined }
  if (e.kind === 'note') {
    return e.label?.trim()
      ? { ...base, caption: e.label, color: e.color || undefined, noteW: e.noteW, noteSize: e.noteSize, notePlain: e.notePlain }
      : null
  }
  if (e.kind === 'shape') {
    const kind = e.shape ?? 'square'
    const color = e.color ?? SHAPE_DEFS[kind].defaultColor
    const aspect = shapeAspect(kind, e.aspect)
    return {
      ...base,
      // ⚠️ the size RATIO travels, not pixels — that is the whole reason the outline can stay out
      // of the resize on paper as well as on screen (lib/shapes · shapeSizeRel)
      symbolSvg: shapeSvgString(kind, color, kind === 'arrow' && !!e.stop, aspect, e.carrier, e.strokeW, shapeBoxPx(e, kind, printZoom), e.fillOpacity, e.hatch, e.sharpCorners, e.reverse),
      shape: kind,
      sizeM: e.sizeM ?? SHAPE_DEFS[kind].defaultSizeM,
      aspect: aspect !== 1 ? aspect : undefined,
    }
  }
  // live vehicles carry their resolved glyph already (name + heading baked in — upright text)
  if (e.symbolSvg) return { ...base, symbolSvg: e.symbolSvg, rotation: undefined }
  if (isVehicleSym(e)) return { ...base, symbolSvg: vehicleSymbolSvg(e.label ?? '', e.rotation ?? 0), rotation: undefined }
  const comp = compositeSpec(e.symbol)
  if (comp) {
    // Composite (Grosslüfter / Drehleiter): bake the part onto the body as ONE svg (the server can't
    // stack two rotatable layers). The body prints at base.rotation, so the part is pre-rotated by its
    // offset (rotation2 − rotation) — after the server rotates the whole by base.rotation the part
    // lands at rotation2. Lüfter extract (Absaugen) prints the reversed fan.
    const part = byName[compositePartGlyph(comp, e.extract)] ?? byName[comp.part] ?? ''
    const svg = composeCompositeSvg(byName[comp.base] ?? '', part, comp.scale, (e.rotation2 ?? 0) - (e.rotation ?? 0), comp.offsetX)
    return svg ? { ...base, symbolSvg: svg } : null
  }
  if (isHubretter(e.symbol)) {
    // Hubretter: bake the plain body (at its own heading `rotation`) + the articulated boom (at its
    // independent bearing `rotation2`) into one svg, rotation unset (both baked). Reach approximated
    // to the glyph box — see composeHubretterSvg.
    const svg = composeHubretterSvg(byName[appConfig.symbols.vehicleName] ?? '', e.reachM, e.rotation2, e.rotation)
    return svg ? { ...base, symbolSvg: svg, rotation: undefined } : null
  }
  const placard = placardSvgForSymbol(e.symbol, e.fields)
  if (placard) return { ...base, symbolSvg: placard }
  // an extract Lüfter renders the reversed-arrow variant — resolve it to SVG here (like the
  // Grosslüfter) so the server prints the same glyph without needing to know the `extract` flag.
  if (e.extract && e.symbol === LUEFTER && byName[LUEFTER_EXTRACT]) return { ...base, symbolSvg: byName[LUEFTER_EXTRACT] }
  return e.symbol ? { ...base, symbol: e.symbol } : null
}

/** The whole Kroki payload for the server compositor: visible entities + drawings, the
 *  fit extent (or the live view for «aktuelle Ansicht»), and the active base layer's
 *  tiles. Returns null when no base layer with raster tiles exists (nothing to render). */
export function buildKrokiPayload(args: {
  entities: Entity[]
  drawings: Drawing[]
  layers: LayerDef[]
  byName: Record<string, string>
  center: LngLat
  currentView?: KrokiView | null
  includeLiveVehiclesInExtent?: boolean
  /** monitored Trupps — a hose they work on prints its leader in the end tag */
  trupps?: Trupp[]
  /** how much of a symbol's typed detail rides under it — the map's own Beschriftungen
   *  setting, so the printed Kroki is labelled the way the screen it was framed on was */
  captionMode?: CaptionMode
}): KrokiPayloadOut | null {
  const { entities, drawings: storedDrawings, layers, byName, center, trupps = [], captionMode = 'auto' } = args
  const drawings = resolveMapDrawings(storedDrawings, entities)
  const visible = (id: string) => layers.find((l) => l.id === id)?.visible ?? true
  const base = layers.find((l) => l.base && l.visible && l.tiles?.length) ?? layers.find((l) => l.base && l.tiles?.length)
  if (!base?.tiles?.length) return null
  // ⚠️ Only an end that really SITS on its object names it: the server couples a named end to the
  // glyph as printed, and a live-GPS end the guard holds on site (paused — the TLF drove off) would
  // be pulled to wherever the vehicle is now (lineAttachments · endOnTarget).
  const entityById = new Map(entities.map((e) => [e.id, e]))
  const objectTarget = (a: Drawing['startAttachment']): string | undefined => {
    if (a?.target.kind !== 'object') return undefined
    const e = entityById.get(a.target.id)
    return e && !endOnTarget(a, e.coord) ? undefined : a.target.id
  }
  const lineTarget = (a: Drawing['startAttachment']): KrokiLineEnd | undefined =>
    (a?.target.kind === 'line' ? { id: a.target.id, endpoint: a.target.endpoint, port: a.port } : undefined)
  const targetLineIds = new Set(storedDrawings.flatMap((d) => [lineTarget(d.startAttachment)?.id, lineTarget(d.endAttachment)?.id]))
  const attachedIds = new Set(storedDrawings.flatMap((d) => [objectTarget(d.startAttachment), objectTarget(d.endAttachment)]))
  // …plus the Motorspritzen a Leitung draws («Pumpen auf Karte», lib/linePumps): derived here as on
  // the screen – along the STORED path, on the profile the screen fetched (a print awaits
  // readyLinePumps) – as ordinary symbols on the drawings' layer, so they hide with the drawings
  const ents = [...entities, ...drawnPumpEntities(storedDrawings)]
    .filter((e) => visible(e.layer))
    .map((e) => {
      const out = krokiEntity(e, byName, captionMode, args.currentView?.zoom)
      return out && attachedIds.has(e.id) ? { ...out, id: e.id } : out
    })
    .filter((e): e is KrokiEntityOut => e !== null)
  const truppLabel = (d: Drawing): string | undefined => {
    const t = truppForLine(d, trupps)
    return t ? truppTagText(t) : undefined
  }
  const drawingsVisible = visible(appConfig.defaults.drawingLayerId)
  const draws = (drawingsVisible ? drawings : []).map((d) => ({
    kind: d.kind, coords: d.coords, color: d.color, width: d.width, dashed: d.dashed,
    arrow: d.arrow, arrowStop: d.arrowStop, marker: d.marker, label: d.label, showDistance: d.showDistance,
    // ⚠️ `hatch` travels with the fill it REPLACES. A hatched Fläche is the FKS reading of an
    // affected area, not decoration — dropped from the payload, the paper printed a plain wash
    // and said something else about the ground than the screen it was framed on (02.09.).
    fillOpacity: d.fillOpacity, hatch: d.hatch, radiusM: d.radiusM,
    teilstueck: d.teilstueck, lineNo: d.lineNo, content: d.content, floorTag: d.floorTag,
    startAt: objectTarget(d.startAttachment), endAt: objectTarget(d.endAttachment),
    id: targetLineIds.has(d.id) ? d.id : undefined,
    startAtLine: lineTarget(d.startAttachment), endAtLine: lineTarget(d.endAttachment),
    // the Atemschutz-Trupp on this Leitung, already resolved + abbreviated: the server draws the
    // Kroki from this payload alone and has no Trupp records to match against. Alarm TONES are
    // deliberately not sent — paper has no live clock, and a red hose on a printed rapport would
    // freeze a moment of the incident as if it were its outcome.
    trupp: d.kind === 'line' ? truppLabel(d) : undefined,
  }))
  return {
    entities: ents,
    drawings: draws,
    fitPoints: operationalExtentPoints(center, entities, drawingsVisible ? drawings : [], !!args.includeLiveVehiclesInExtent),
    center: args.currentView?.center,
    zoom: args.currentView?.zoom,
    bounds: args.currentView?.bounds,
    maxTileZoom: base.maxzoom,
    // unkeyed: the backend applies its own CARTO credential (lib/carto · withoutCartoBasemapKey);
    // 1×: its compositor lays tiles on a 256 px grid (lib/carto · withoutCartoRetina);
    // labelled: paper gets no vector names, so the raster brings its own (withCartoLabelsBaked)
    tiles: withCartoLabelsBaked(withoutCartoBasemapKey(withoutCartoRetina(base.tiles[0]))),
    attribution: base.attribution ?? '© CARTO, © OpenStreetMap-Mitwirkende',
  }
}
