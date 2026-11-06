import { useMemo } from 'react'
import type { Spread } from '../types'
import { SPREAD_DIRS, boundedKey, hasSpread, normalizeSpread, type SpreadDir } from './spread'
import { DEFAULT_INK } from './lineStyle'
import { sanitizeSvg } from './sanitizeSvg'
import { Icon } from './icons'
import { bareBlack } from './glyphTile'
import { readingAge, symbolReading } from './symbols'
import { useMinuteClock } from './minuteClock'
import type { SymbolProps } from '../types'

// Shared rendering of a placed FireGIS tactical symbol — used IDENTICALLY by the
// Lage map (MapView) and the Plan whiteboard (Whiteboard), so the glyph, the
// white legibility chip, the rotation transform, and the floor/count badges are
// defined once instead of forked per surface. Callers supply the pixel size
// (the map ties it to real-world metres; the plan to the board scale) and which
// badges apply; the decoration logic lives here.

// Outline symbols (no solid fill — e.g. KP Front, Sammelstelle, hydrants) get a
// white chip behind them so the thin strokes stay legible; solid icons (Feuer F,
// Rettungen R) already read on their own and render directly. Solid BLACK icons without a plate
// (Schieber, Windrichtung, Nordpfeil) get it too — black on the dark Karte is nothing.
export const needsWhite = (svg: string) => svg.includes('fill="none"') || bareBlack(svg)

// the symbol's own accent colour — its first non-black fill, else first non-black
// stroke (black is the glyph/outline). Used to tint the floor badge. Falls back to
// the app blue when a symbol has no colour of its own.
export const symColor = (svg: string): string => {
  const colours = [...svg.matchAll(/(?:fill|stroke)="(#[0-9a-fA-F]{6})"/g)].map((m) => m[1].toLowerCase())
  return colours.find((c) => c !== '#000000') ?? DEFAULT_INK
}

// signed storey label for the badge: +2, -1, 0 (EG)
export const floorBadge = (f: number) => (f > 0 ? `+${f}` : `${f}`)

// ── Grosslüfter: a composite of a vehicle body + an overlaid fan, each independently
// rotatable (the vehicle heading vs. the airflow direction). The two source glyphs are the
// authoritative FireGIS «VKF Fahrzeug» (carrier) and «VKF Luefter mobil» (fan); we stack the
// fan, scaled down, centred on the body. NOT an invented glyph — it's a documented combination.
export const GROSSLUEFTER = 'Grosslüfter'
export const GROSSLUEFTER_BODY = 'VKF Fahrzeug'
export const GROSSLUEFTER_FAN = 'VKF Luefter mobil'
// the mobile Lüfter + its extract/Absaugen variant (SAME fan, airflow arrow reversed to point INTO
// the fan). The variant is a render-only glyph (kept in `byName`, hidden from the palette — see
// useSymbols); a placed Lüfter carries `extract` and stays named 'VKF Luefter mobil', so presets,
// captions and the Grosslüfter fan reference all key off the one canonical name.
export const LUEFTER = 'VKF Luefter mobil'
export const LUEFTER_EXTRACT = 'VKF Luefter mobil saugend'
/** the library name to render for a placed symbol — the reversed-arrow glyph for an extract Lüfter,
 *  the symbol's own name otherwise. */
export const luefterVariant = (name: string | undefined, extract?: boolean): string | undefined =>
  extract && name === LUEFTER ? LUEFTER_EXTRACT : name
// The fan reads at half the body box, mounted a little forward of centre.
//
// ⚠️ Both numbers changed on 01.09., and the reason is the FKS recolour: the Lüfter used to be
// black-on-yellow, so it separated from the blue carrier by colour alone. Drawn in Führungs-blau
// (Behelf S. 37) it stopped doing that — at 0.6 and centred, the fan's arrowhead landed exactly
// on the vehicle's nose chevron and the two shapes read as one tangle at map size. Smaller and
// shifted back, both are legible again, and the standalone sign stays exactly the sheet's.
export const FAN_OVERLAY_SCALE = 0.5
/** How far a composite's part sits from the glyph centre, as a FRACTION OF THE GLYPH BOX —
 *  the one unit both renderers can honour (the static composite nests raw glyph units in a 2.6
 *  box, the live overlay is a CSS transform on a full-box div). Negative = towards the rear. */
export const FAN_OVERLAY_OFFSET = -0.085
// strip a glyph's outer <svg> wrapper, keeping its inner paths (for nesting one glyph in another)
const innerSvg = (svg: string) => svg.replace(/^\s*<svg[^>]*>/, '').replace(/<\/svg>\s*$/, '')
// A static composite: base body + overlaid part, the part rotated `partDeg` about the shared centre
// (0,0) and scaled. Used for the palette thumbnail (partDeg 0) and the server print (where the two
// layers can't be separate DOM nodes). The live map/plan instead render them as two independently-
// rotatable divs (TacticalSymbol `overlay`), so each part rotates on its own.
export function composeCompositeSvg(baseSvg: string, partSvg: string, scale = FAN_OVERLAY_SCALE, partDeg = 0, offsetX = 0): string {
  if (!baseSvg || !partSvg) return baseSvg || partSvg
  // translate LAST in the list = applied outermost, so the part spins in place at its mounting
  // point instead of orbiting the glyph centre. `offsetX` is a box fraction; the box is 2.6 wide.
  const part = `<g transform="translate(${(offsetX * 2.6).toFixed(3)} 0) rotate(${partDeg}) scale(${scale})">${innerSvg(partSvg)}</g>`
  return `<svg viewBox="-1.3 -1.3 2.6 2.6" xmlns="http://www.w3.org/2000/svg" preserveAspectRatio="xMidYMid meet">${innerSvg(baseSvg)}${part}</svg>`
}

// ── Composite symbols: a carrier body + a second part that rotates independently ─────────────
// The Grosslüfter (vehicle + fan/airflow) and the aerial appliances (Drehleiter ladder / Hubretter
// articulated boom) all render as two stacked, separately-rotatable layers: the body by `rotation`,
// the overlaid part by `rotation2`. The part glyphs are render-only (hidden from the palette by
// useSymbols); the full authored VKF Drehleiter / VKF Hubretter glyphs stay as the palette thumbnails.
const DREHLEITER = 'VKF Drehleiter'
export const HUBRETTER = 'VKF Hubretter'
export const DREHLEITER_PART = 'VKF Drehleiter Leiter'
export const HUBRETTER_PART = 'VKF Hubretter Arm'

/** One composite's parts. `partExtract`/`airflow` are the Lüfter's reversed-airflow specifics; the
 *  ladders leave them unset (the boom/ladder has no airflow). `partLabel` is the contextPanel copy
 *  key naming the part's rotor + Drehung stepper (fan vs. ladder). */
export interface CompositeSpec {
  base: string
  part: string
  partExtract?: string
  scale: number
  /** the part's mounting offset along the body, as a fraction of the glyph box (see
   *  FAN_OVERLAY_OFFSET). Absent = centred, which is what the aerial ladder wants. */
  offsetX?: number
  airflow?: boolean
  partLabel: 'rotationFan' | 'rotationLadder'
}
export const COMPOSITES: Record<string, CompositeSpec> = {
  // base = the plain vehicle body (VKF Fahrzeug); each part slews on `rotation2`. The Hubretter is
  // NOT a rotation composite — its boom is a variable-reach, cage-draggable element (see below).
  [GROSSLUEFTER]: { base: GROSSLUEFTER_BODY, part: GROSSLUEFTER_FAN, partExtract: LUEFTER_EXTRACT, scale: FAN_OVERLAY_SCALE, offsetX: FAN_OVERLAY_OFFSET, airflow: true, partLabel: 'rotationFan' },
  [DREHLEITER]: { base: GROSSLUEFTER_BODY, part: DREHLEITER_PART, scale: 1, partLabel: 'rotationLadder' },
}
export const compositeSpec = (name?: string): CompositeSpec | undefined => (name ? COMPOSITES[name] : undefined)
/** the render-only overlay part glyphs — hidden from the palette (like the reversed-airflow Lüfter). */
export const COMPOSITE_PART_GLYPHS: string[] = [LUEFTER_EXTRACT, DREHLEITER_PART, HUBRETTER_PART]
/** the library glyph name for a composite's overlay part, honouring the Lüfter airflow variant. */
export const compositePartGlyph = (spec: CompositeSpec, extract?: boolean): string =>
  spec.airflow && extract && spec.partExtract ? spec.partExtract : spec.part

// ── Hubretter: a variable-reach articulated boom the operator shapes by dragging the cage tip ────
// Unlike the composite rotors, the boom isn't a fixed glyph: it extends from the truck (the symbol
// `coord`) out to a rescue cage at a stored reach (`Entity.reachM` metres on the map / `BoardAnno.reachN`
// board-fraction on the plan) and bearing (`rotation2`). The truck body auto-faces the boom; there's
// no rotor — the single cage handle sets both bearing and reach.
export const isHubretter = (name?: string): boolean => name === HUBRETTER
/** The auto-articulated knuckle for a boom drawn from `base` to `tip`: a point ~`along` of the way
 *  from base to tip, pushed perpendicular by `offset`×length, so the boom reads as a bent Gelenkmast
 *  rather than a straight stick. Pure (same inputs → same point). Perp = base→tip rotated +90°. */
export function boomKnuckle(base: readonly [number, number], tip: readonly [number, number], along = 0.55, offset = 0.18): [number, number] {
  const dx = tip[0] - base[0], dy = tip[1] - base[1]
  return [base[0] + dx * along - dy * offset, base[1] + dy * along + dx * offset]
}

/** The visual boom for a Hubretter: an articulated base→knuckle→cage polyline with a rescue cage at
 *  the tip, drawn from the truck centre (0,0) out `lengthPx` at screen bearing `deg`. Rendered ON TOP
 *  of the body glyph (the boom mounts on the turntable / roof) — the caller places it AFTER the body
 *  in the DOM. SHARED by Lage + Plan so the boom reads identically; each surface positions the
 *  draggable cage handle itself. A white underlay keeps the ink legible over the body + busy tiles. */
export function HubretterBoom({ lengthPx, deg, color = '#00a0ff' }: { lengthPx: number; deg: number; color?: string }) {
  const L = Math.max(0, lengthPx)
  const rad = (deg * Math.PI) / 180
  const tip: [number, number] = [Math.cos(rad) * L, Math.sin(rad) * L]
  const k = boomKnuckle([0, 0], tip)
  const sw = Math.max(3, Math.min(6, L * 0.05))
  const cage = Math.max(9, Math.min(18, L * 0.16))
  const box = L + cage + sw + 2
  const pts = `0,0 ${k[0].toFixed(1)},${k[1].toFixed(1)} ${tip[0].toFixed(1)},${tip[1].toFixed(1)}`
  // placed AFTER the body glyph in the DOM, so it paints on top — the boom mounts on the turntable
  // (the truck's roof) and reaches out over the vehicle, not from underneath it.
  return (
    // zIndex 2 keeps the boom above the body even when selected — `.marker.sel .ts` gets z-index:1,
    // which would otherwise lift the truck back over the boom. Still below the handles (z 8–9).
    <svg className="ts-boom" viewBox={`${-box} ${-box} ${2 * box} ${2 * box}`}
      style={{ position: 'absolute', left: '50%', top: '50%', width: 2 * box, height: 2 * box, transform: 'translate(-50%,-50%)', overflow: 'visible', pointerEvents: 'none', zIndex: 2 }}>
      <polyline points={pts} fill="none" stroke="#fff" strokeWidth={sw + 2.5} strokeLinejoin="round" strokeLinecap="round" opacity={0.9} />
      <polyline points={pts} fill="none" stroke={color} strokeWidth={sw} strokeLinejoin="round" strokeLinecap="round" />
      <rect x={tip[0] - cage / 2} y={tip[1] - cage / 2} width={cage} height={cage} rx={cage * 0.18}
        fill="var(--on-accent-ink, #fff)" stroke={color} strokeWidth={Math.max(2, sw * 0.8)} />
    </svg>
  )
}

/** A static Hubretter (plain body + articulated boom baked at its bearing) for the server print, where
 *  the two live layers can't exist and the boom isn't metre-scaled. Reach is approximated to the glyph
 *  box — capped so the truck stays readable — good enough for the rapport; the metric print is deferred.
 *  Returns one SVG string; the caller prints it with rotation unset (the bearing is baked in). */
export function composeHubretterSvg(bodySvg: string, reachM = 18, boomDeg = 0, bodyDeg = 0): string {
  if (!bodySvg) return bodySvg
  const L = Math.max(0.9, Math.min(1.8, reachM / 20)) // glyph-box units; capped so the body stays legible
  const rad = (boomDeg * Math.PI) / 180
  const tip: [number, number] = [Math.cos(rad) * L, Math.sin(rad) * L]
  const k = boomKnuckle([0, 0], tip)
  const cage = 0.26
  const pts = `0,0 ${k[0].toFixed(2)},${k[1].toFixed(2)} ${tip[0].toFixed(2)},${tip[1].toFixed(2)}`
  const boom = `<polyline points="${pts}" fill="none" stroke="#00a0ff" stroke-width="0.16" stroke-linejoin="round" stroke-linecap="round"/>`
    + `<rect x="${(tip[0] - cage / 2).toFixed(2)}" y="${(tip[1] - cage / 2).toFixed(2)}" width="${cage}" height="${cage}" rx="0.05" fill="#fff" stroke="#00a0ff" stroke-width="0.11"/>`
  const body = `<g transform="rotate(${bodyDeg})">${innerSvg(bodySvg)}</g>` // truck heading, independent of the boom
  const box = L + 0.6
  // body first, boom second → the boom paints ON TOP (mounted on the turntable / roof)
  return `<svg viewBox="${-box} ${-box} ${2 * box} ${2 * box}" xmlns="http://www.w3.org/2000/svg" preserveAspectRatio="xMidYMid meet">${body}${boom}</svg>`
}

// FKS Entwicklung overlay: hollow block arrows (in the symbol's colour) drawn OUTSIDE
// the glyph so they read against a same-coloured icon. Horizontal development is
// left/right (E/W) on the sides; vertical is up/down on the top/bottom. `bounded`
// adds the Entwicklungsgrenze bar (→|) just past the tip. One up-pointing arrow shape
// is rotated to each edge. Lives in a 2× overlay box centred on the glyph (25..75).
// up-pointing block arrow, emanating from the glyph's top edge (~30) to the tip (~8);
// the Entwicklungsgrenze is a hollow rectangle (a bar) just past the tip.
const BLOCK_ARROW = 'M42 30 L42 20 L34 20 L50 8 L66 20 L58 20 L58 30 Z'
function BlockArrow({ deg, bounded, color }: { deg: number; bounded?: boolean; color: string }) {
  return (
    <g transform={`rotate(${deg} 50 50)`} fill="#fff" stroke={color} strokeWidth={3.5} strokeLinejoin="round">
      <path d={BLOCK_ARROW} />
      {bounded && <rect x="33" y="1" width="34" height="6" rx="1.5" strokeWidth={3} />}
    </g>
  )
}
/** Degrees to rotate the up-pointing arrow onto each edge. */
const SPREAD_DEG: Record<SpreadDir, number> = { up: 0, right: 90, down: 180, left: 270 }

function SpreadArrows({ spread, color }: { spread: Spread; color: string }) {
  // ⚠️ normalized, never read raw: an incident written before 2026-08 carries the old
  // `h`/`hBounded`/`vBounded` shape and would otherwise lose its arrows (lib/spread.ts).
  const s = normalizeSpread(spread)
  if (!hasSpread(s)) return null
  return (
    <svg className="sym-spread" viewBox="0 0 100 100" aria-hidden="true">
      {SPREAD_DIRS.filter((d) => s[d]).map((d) => (
        <BlockArrow key={d} deg={SPREAD_DEG[d]} bounded={s[boundedKey(d)]} color={color} />
      ))}
    </svg>
  )
}

// combined span label for stairs/lift, e.g. "-1/+3" – only for a real span (both sides set and
// different); see `storey` in TacticalSymbol for the one-storey cases
const floorRangeBadge = (from: number, to: number) => `${floorBadge(from)}/${floorBadge(to)}`

export function TacticalSymbol({ svg, sizePx, rotation = 0, overlay, count, floor, floorFrom, floorTo, spread, caption, origin, measured, docked, done, className }: {
  svg: string
  /** rendered edge length in px (square) */
  sizePx: number
  /** rotation in degrees applied to the inner chip (the white chip rotates with it) */
  rotation?: number
  /** a second glyph stacked on top with its OWN rotation + scale (the Grosslüfter fan over the
   *  vehicle body). Centred on the base; rotates independently of the base `rotation`. */
  overlay?: { svg: string; rotation?: number; scale?: number; offsetX?: number }
  /** quantity badge at the bottom-right; shown only when > 1 */
  count?: number
  /** signed storey badge at the top-right. Shown on both surfaces — the Lage passes
   *  `Entity.floor`, a plan board `BoardAnno.storey` (NOT `BoardAnno.floor`, which is the
   *  Gebäude floor-stack's tile index). The stack never SETS one: there the sheet the symbol
   *  sits on already says which storey it is. */
  floor?: number
  /** lower / upper storey of a vertical span (stairs, lift) — rendered together in
   *  the top-right slot as "-1/+3". Independent of `floor` (a symbol uses one or the
   *  other); shows on both surfaces. */
  floorFrom?: number
  floorTo?: number
  /** FKS Entwicklung spread arrows (Feuer/Wasser/Gefahrstoffe) — see Spread */
  /** The four dirs are surface-up-relative and render that way EVERYWHERE — a twin shows them
   *  exactly as the source draws them (doctrine 30.08.: presentation-equivalent, never
   *  re-aimed through a georef fit). */
  spread?: Spread
  /** metadata caption printed under the glyph (one or more newline-separated lines). The
   *  caller decides the text + visibility (lib/symbols · symbolCaptionText, zoom gate); this
   *  just renders it as a sibling of the glyph so it never rotates with `rotation`. */
  caption?: string | null
  /** a vehicle's «Herkunft» (lib/symbols · symbolOriginText): one small grey line at the foot of
   *  the caption box – or the whole box, for a Fahrzeug whose name is in its glyph. Absent for the
   *  own Feuerwehr. The label pass measures caption + this line together (symbolCaptionBoxText). */
  origin?: string | null
  /** a MEASURED symbol's props (lib/symbols · isMeasuredSymbol, the Messpunkt): the mark is then
   *  one pill – a small Messgerät and the worst gas («CO 180») – instead of the glyph (owner pick
   *  S3, 27.10.2026). See ReadingPill. Never suppressed by the label pass, which books it as the
   *  glyph's own footprint (useLabelPass). */
  measured?: SymbolProps
  /** Angedockte Trupps (lib/docking, 15.09.2026): this symbol carries at least one Trupp marker,
   *  drawn as the same `link` glyph the marker itself wears — the bond is then readable from both
   *  ends. The string is the crews' names and is only ever the badge's TITLE: the map shows the
   *  glyph, the words stay on the Atemschutz card and in the symbol's own panel.
   *  ⚠️ KARTE ONLY, like the bond itself — the Plan and the printed Kroki pass nothing and render
   *  exactly as they did. */
  docked?: string
  /** «Gelöscht / erledigt» (lib/objectDone · doneBadge): the HH:MM it was declared over. The
   *  glyph and its Entwicklung arrows go GREY (`.ts-done`, the `--done-*` tokens) and the time
   *  stands in the top-left corner, in the storey badge's chrome. The caption, the badges and the
   *  hit area stay as they were: it is still the same symbol, and still selectable. ONE rule on
   *  the Karte, the Plan and the Gebäude, because all three render through here. */
  done?: string | null
  /** extra class on the outer wrapper (e.g. 'photo' on the map, 'ts-plan' on the plan) */
  className?: string
}) {
  // A span is a real one only with both sides set and different. A «Von» alone (the Messpunkt sets
  // its storey that way), a «Bis» alone or Von = Bis is ONE storey and draws exactly like `floor` –
  // the Erdgeschoss included, which shows no badge (sweep 28.10.2026 #8a: a «0» circle on the pill)
  const span = floorFrom != null && floorTo != null && floorFrom !== floorTo
  const storey = floorFrom != null || floorTo != null ? (span ? undefined : floorFrom ?? floorTo) : floor
  // ⚠️ The one XSS sink for a placed glyph: `svg` may be an entity's editor-supplied `symbolSvg`
  // (a free string synced through the workspace PUT), and it is written straight into the DOM
  // below. Sanitising HERE covers every caller that renders through TacticalSymbol — MapMarkers,
  // the georef twins (twinGlyph · glyphFor), the Whiteboard and the palette — in one place. The
  // string is stable per entity, so memoise it rather than re-parse on every paint (the bundled
  // pack and vehicle/person glyphs are trusted but sanitise identically). See lib/sanitizeSvg.
  const safeSvg = useMemo(() => sanitizeSvg(svg), [svg])
  const safeOverlay = useMemo(() => (overlay ? sanitizeSvg(overlay.svg) : ''), [overlay?.svg])
  return (
    <div className={`ts ${className ?? ''}${done ? ' ts-done' : ''}`} style={{ width: sizePx, height: sizePx }}>
      {spread && <SpreadArrows spread={spread} color={symColor(svg)} />}
      {!measured && (
        <div
          className={`ts-rot ${needsWhite(svg) ? 'white' : ''}`}
          style={rotation ? { transform: `rotate(${rotation}deg)` } : undefined}
          dangerouslySetInnerHTML={{ __html: safeSvg }}
        />
      )}
      {overlay && (
        <div
          className="ts-rot ts-overlay"
          // translate FIRST in the CSS list = applied last, so the part spins in place at its
          // mounting point rather than orbiting the centre — same order as composeCompositeSvg.
          style={{ transform: `translateX(${((overlay.offsetX ?? 0) * 100).toFixed(2)}%) rotate(${overlay.rotation ?? 0}deg) scale(${overlay.scale ?? FAN_OVERLAY_SCALE})` }}
          dangerouslySetInnerHTML={{ __html: safeOverlay }}
        />
      )}
      {/* ⚠️ NOT tinted with `symColor`. The storey was printed in the symbol's own colour on a
          white chip, which is unreadable for exactly the symbols that carry one most often: a
          yellow BMA's «+1» was yellow on white. The chip's position on the glyph is what ties
          the badge to its symbol; the colour only ever repeated what the icon underneath
          already says, at the cost of the one thing the badge is for. */}
      {/* …and not for the Erdgeschoss (15.09.): a «0» chip is a number that says nothing – ground
          level is where a symbol stands unless the badge says otherwise */}
      {!measured && storey != null && storey !== 0 && (
        <span className="sym-floor">{floorBadge(storey)}</span>
      )}
      {span && (
        <span className="sym-floor">{floorRangeBadge(floorFrom, floorTo)}</span>
      )}
      {count != null && count > 1 && (
        <span className="sym-count">{count}</span>
      )}
      {/* the one free corner: storey top-right, count bottom-right, the docked Trupp markers
          themselves bottom-left (lib/docking · dockSlotOffset) */}
      {docked && (
        <span className="sym-dock" title={docked} aria-label={docked}><Icon id="link" /></span>
      )}
      {/* …and the fourth corner, top-left, is the «erledigt» time (lib/objectDone) */}
      {done && <span className="sym-done">{done}</span>}
      {measured && <ReadingPill props={measured} floor={storey} />}
      {(caption || origin) && (
        <span className="sym-caption">
          {caption?.split('\n').map((line, i) => <span key={i}>{line}</span>)}
          {origin && <span className="sym-caption-origin">{origin}</span>}
        </span>
      )}
    </div>
  )
}

/**
 * A measured symbol's mark: the worst gas on calm ink, amber at A1, red at A2, the colour on the
 * outline plus its age once the reading is old (lib/symbols · symbolReading), the dashed pill with
 * the icon alone before the first reading. Its own component so only these few marks subscribe to
 * the minute clock that ages them. `inline` = the same pill in a list row (ReadingParts); `bare` =
 * the icon alone in the same colours, the «Messungen» chip's round button (ReadingsChip, 9A).
 */
export function ReadingPill({ props, floor, inline = false, bare = false }: { props: SymbolProps; floor?: number; inline?: boolean; bare?: boolean }) {
  const r = symbolReading(props, useMinuteClock())
  if (!r) return null
  return (
    <span className={`sym-pill${inline ? ' inline' : ''}${bare ? ' bare' : ''}${r.text ? '' : ' empty'}${r.level === 'ok' ? '' : ` ${r.level}`}${r.stale ? ' stale' : ''}`}>
      <Icon id="messgeraet" />
      {!bare && r.text}
      {!bare && r.stale && <span className="sym-pill-age">{readingAge(r)}</span>}
      {/* the storey rides on the pill, which is wider than the glyph box the corner badges use */}
      {floor != null && floor !== 0 && <span className="sym-floor">{floorBadge(floor)}</span>}
    </span>
  )
}
