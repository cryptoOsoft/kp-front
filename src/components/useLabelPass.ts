import { useEffect, useState, type RefObject } from 'react'
import type { Map as MlMap } from 'maplibre-gl'
import type { CaptionMode, Drawing, Entity, LayerId, LngLat } from '../types'
import { dockSlots } from '../lib/docking'
import { cachedLabelSize, LABEL_RANK, placeLabels, type LabelBox, type LabelCandidate, type LabelStyle } from '../lib/labelPass'
import { CRUMB_LABEL_DX, CRUMB_LABEL_STYLE, effectiveLayer, END_TAG_LABEL_STYLE, READOUT_LABEL_STYLE, shapePx, symPx, SYM_CAPTION_GAP, SYM_CAPTION_STYLE, SYM_PILL_STYLE, teamDockAnchor, teamStripPx, TEAM_DOT_GAP, TEAM_DOT_PX, TEAM_LABEL_STYLE } from '../lib/mapView'
import { noteWPx } from '../lib/notes'
import { SHAPE_MAX_PX, shapeAspect } from '../lib/shapes'
import { floorBadge } from '../lib/symbolRender'
import { isNamedPerson, readingPillText, symbolCaptionText, symbolReading } from '../lib/symbols'
import { softHyphenateText } from '../lib/symbolWrap'
import type { LineTone, TeamLineBadge } from '../lib/truppLines'

// ── label-pass geometry: the numbers the stylesheet and MapView's Markers use, said once ──────
// The pass measures a label before it exists in the DOM, so the chrome around its text has to
// be mirrored here. When a label's CSS (or its Marker offset in MapView) changes, these change
// with it — each is named for the rule it comes from.
const NO_LABELS: ReadonlySet<string> = new Set()
/** `.sym-caption { margin-top }` (03-map.css), held to the CSS in lib/mapView */
const CAPTION_GAP = SYM_CAPTION_GAP
/** the end tag's Marker `offset={[0, -14]}` (MapView) */
const END_TAG_LIFT = 14
/** the line-readout / radius Markers' `anchor="bottom"` offsets (MapView) */
const READOUT_LIFT = 10
const RADIUS_LIFT = 4
const LABEL_STYLE = {
  /** `.sym-caption` (lib/mapView · SYM_CAPTION_STYLE) */
  caption: SYM_CAPTION_STYLE,
  /** `.team-dot b` — never wraps */
  team: TEAM_LABEL_STYLE,
  /** `.measure-label.draw-label` (lib/mapView · READOUT_LABEL_STYLE) */
  readout: READOUT_LABEL_STYLE,
  /** `.line-end-tag` (lib/mapView · END_TAG_LABEL_STYLE) */
  endTag: END_TAG_LABEL_STYLE,
} satisfies Record<string, LabelStyle>

/** the end tag's text as the label pass measures it – the Leitung's own facts only. The Trupp on
 *  it is never printed here (15.09.): its marker stands at this very end, and that IS the name. */
function endTagText(d: Drawing): string {
  const parts: string[] = []
  if (d.lineNo != null) parts.push(String(d.lineNo))
  if (d.content) parts.push(d.content)
  if (d.floorTag != null) parts.push(floorBadge(d.floorTag))
  return parts.join(' · ')
}

/** Everything on the Lage that prints a label, as MapView has already resolved it. */
export interface LabelPassScene {
  initialCenter: LngLat
  entities: Entity[]
  isVisible: (id: LayerId) => boolean
  zoom: number
  symMul: number
  captionMode: CaptionMode
  selectedId: string | null
  selectedEntityIds: string[]
  /** the Leitung each Trupp marker works (lib/truppLines · teamLineBadges) */
  teamLines: ReadonlyMap<string, TeamLineBadge>
  drawingsVisible: boolean
  /** the FKS-decorated lines, with their end tag's default anchor and alarm tone */
  lineDecor: readonly { d: Drawing; anchor: LngLat; tone: LineTone }[]
  drawLabels: readonly { id: string; coord: LngLat; lines: string[] }[]
  circleLabels: readonly { id: string; coord: LngLat; text: string }[]
  selectedDrawingId: string | null
  /** as stored — a hand-placed readout (`labelAt`) is pinned */
  storedDrawings: Drawing[]
  /** Trupps whose trail the operator switched off (lib/useHiddenTrails) – their crumbs are not drawn */
  hiddenTrails: ReadonlySet<string>
}

/**
 * ── ONE label pass for the whole map ──
 * Every family (symbol captions, Trupp names, Leitung end tags, line readouts, radius readouts)
 * used to place its label wherever its own geometry pointed, blind to the others, decluttered
 * only by a global zoom switch and truncated by an ellipsis. Now they all go through
 * lib/labelPass: one rank order, one AABB test, nothing moves, and what does not fit is not
 * drawn — its owner paints a 6px ink dot instead. See labelPass.ts for the why.
 *
 * Returns the keys NOT to draw: `cap:<entity>`, `team:<entity>`, `tag:<line>`, `dl:<drawing>`,
 * `cl:<circle>`, `crumb:<entity>:<index>` (a trail breadcrumb's time – its dot stays). Pure over `px` (screen px of a ground point at the current camera).
 */
export function mapLabelDecisions(px: (c: LngLat) => { x: number; y: number }, scene: LabelPassScene): ReadonlySet<string> {
  const { initialCenter, entities, isVisible, zoom, symMul, captionMode, selectedId, selectedEntityIds, teamLines,
    drawingsVisible, lineDecor, drawLabels, circleLabels, selectedDrawingId, storedDrawings, hiddenTrails } = scene
  // ties inside a rank go to whatever is nearer the incident — never to placement order
  const hub = px(initialCenter)
  const near = (p: { x: number; y: number }) => Math.hypot(p.x - hub.x, p.y - hub.y)
  const occupied: LabelBox[] = []
  const cands: LabelCandidate[] = []
  // a docked Trupp marker stands on its HOST's bottom-left corner, not on its own coordinate
  // (lib/docking · dockSlotOffset) — the pass books the box the eye actually sees, or it would
  // clear labels for ground nothing is drawn on and let real ones collide on the corner
  const dockedSlots = dockSlots(entities)

  // Seed: every visible glyph. A label may cover empty ground, never another symbol.
  for (const e of entities) {
    if (!Array.isArray(e.coord) || !isVisible(effectiveLayer(e))) continue
    const dock = teamDockAnchor(e, entities, dockedSlots, zoom, symMul,
      e.kind === 'team' ? teamStripPx(e.label ?? '') : undefined)
    const own = px(dock?.host.coord ?? e.coord)
    const p = dock ? { x: own.x + dock.dx, y: own.y + dock.dy } : own
    const g = e.kind === 'shape' ? shapePx(e.sizeM, e.coord[1], zoom, SHAPE_MAX_PX[e.shape ?? 'square'])
      : e.kind === 'photo' ? 56
      : e.kind === 'note' ? noteWPx(e.noteW)
      : e.kind === 'team' ? TEAM_DOT_PX
      : symPx(e.kind, e.coord[1], zoom, symMul)
    // a stretched Rechteck/Rauch is g wide but g × aspect tall — seed the real box, or a
    // label happily lands on the lower half of a tall shape it believes is square
    const gh = e.kind === 'shape' ? g * shapeAspect(e.shape ?? 'square', e.aspect) : g
    const isSel = e.id === selectedId || selectedEntityIds.includes(e.id)
    if (e.kind === 'team') {
      // a resting Trupp marker is `[dot][gap][name]` anchored by its LEFT edge (MapMarkers):
      // the DOT sits on the coordinate and the name hangs off to the right of it, so dropping
      // the name below moves nothing on screen
      const label = e.label ?? ''
      const s = cachedLabelSize(label, LABEL_STYLE.team)
      occupied.push({ x: p.x - TEAM_DOT_PX / 2, y: p.y - TEAM_DOT_PX / 2, w: TEAM_DOT_PX, h: TEAM_DOT_PX })
      // a marker on a due/überfällig Trupp's Leitung keeps the alarm rank its tag has
      const badge = teamLines.get(e.id)
      // the selected Trupp shows its full pill instead of the bare name — not a candidate,
      // but its footprint still has to push everything else away
      if (label && !isSel) {
        // ⚠️ A joined marker shares the rank of its Leitung's tag: a Leitung whose Trupp is due
        // or overdue outranks everything but the selection, and that is the one label on the
        // map somebody's air depends on.
        const rank = badge && (badge.tone === 'crit' || badge.tone === 'warn')
          ? LABEL_RANK.criticalTag : LABEL_RANK.team
        // ⚠️ pinned (15.09., Bastian: «I always want to see the Trupp marker»): the name is
        // never suppressed – it books its box so everything else yields, and a docked marker
        // beside a busy symbol no longer shrinks to a bare dot.
        cands.push({ key: `team:${e.id}`, rank, pinned: true, dist: near(p),
          box: { x: p.x + TEAM_DOT_PX / 2 + TEAM_DOT_GAP, y: p.y - s.h / 2, w: s.w, h: s.h } })
      }
      continue
    }
    occupied.push({ x: p.x - g / 2, y: p.y - gh / 2, w: g, h: gh })
    // only the glyph branch prints a caption (MapMarkers) — a note's own text is its body,
    // not a caption, and asking symbolCaptionText for one would invent a phantom box
    if (e.kind === 'shape' || e.kind === 'note' || e.kind === 'photo') continue
    // a measured symbol's mark IS its reading pill (TacticalSymbol · measured), wider than the
    // glyph box: booked like the glyph, never a candidate — the pass moves other labels off it,
    // never it off the map. Measured at load time; the few px an «18′» adds later don't matter.
    const reading = symbolReading(e)
    if (reading) {
      const r = cachedLabelSize(readingPillText(reading), SYM_PILL_STYLE)
      occupied.push({ x: p.x - r.w / 2, y: p.y - r.h / 2, w: r.w, h: r.h })
    }
    const cap = symbolCaptionText(e, captionMode)
    if (!cap) continue
    const s = cachedLabelSize(softHyphenateText(cap), LABEL_STYLE.caption)
    // A person's typed name ranks with the Trupp names, not with the metadata captions — who is
    // standing there is the same class of fact as which Trupp is there (lib/symbols · isNamedPerson).
    const rank = isSel ? LABEL_RANK.selected : isNamedPerson(e) ? LABEL_RANK.team : LABEL_RANK.caption
    cands.push({ key: `cap:${e.id}`, rank, dist: near(p),
      box: { x: p.x - s.w / 2, y: p.y + g / 2 + CAPTION_GAP, w: s.w, h: s.h } })
  }

  if (drawingsVisible) {
    // Leitung end tags. A tag whose Atemschutz-Trupp is due or overdue outranks everything
    // except the selection — that is the one label on the map somebody's air depends on.
    for (const ld of lineDecor) {
      const text = endTagText(ld.d)
      if (!text) continue
      const p = px(ld.d.endLabelAt ?? ld.anchor)
      const s = cachedLabelSize(text, LABEL_STYLE.endTag)
      cands.push({
        key: `tag:${ld.d.id}`,
        rank: ld.d.id === selectedDrawingId ? LABEL_RANK.selected
          : ld.tone === 'crit' || ld.tone === 'warn' ? LABEL_RANK.criticalTag : LABEL_RANK.tag,
        pinned: !!ld.d.endLabelAt,
        dist: near(p),
        box: { x: p.x - s.w / 2, y: p.y - END_TAG_LIFT - s.h / 2, w: s.w, h: s.h },
      })
    }
    for (const l of drawLabels) {
      const p = px(l.coord)
      const s = cachedLabelSize(l.lines.join('\n'), LABEL_STYLE.readout)
      cands.push({ key: `dl:${l.id}`, rank: l.id === selectedDrawingId ? LABEL_RANK.selected : LABEL_RANK.readout,
        pinned: storedDrawings.some((d) => d.id === l.id && !!d.labelAt), dist: near(p),
        box: { x: p.x - s.w / 2, y: p.y - READOUT_LIFT - s.h, w: s.w, h: s.h } })
    }
    for (const c of circleLabels) {
      const p = px(c.coord)
      const s = cachedLabelSize(c.text, LABEL_STYLE.readout)
      cands.push({ key: `cl:${c.id}`, rank: c.id === selectedDrawingId ? LABEL_RANK.selected : LABEL_RANK.radius, dist: near(p),
        box: { x: p.x - s.w / 2, y: p.y - RADIUS_LIFT - s.h, w: s.w, h: s.h } })
    }
  }
  // A Trupp's trail breadcrumbs (MapMarkers): the dot always stands, its time only where it fits.
  // `dist` is the crumb's age in steps, so inside the rank the newest crumb of every trail goes first.
  for (const e of entities) {
    const trail = e.kind === 'team' ? e.trail ?? [] : []
    if (!trail.length || !Array.isArray(e.coord) || !isVisible(effectiveLayer(e)) || hiddenTrails.has(e.id)) continue
    trail.forEach((c, i) => {
      const p = px(c.coord)
      const s = cachedLabelSize(c.t, CRUMB_LABEL_STYLE)
      cands.push({ key: `crumb:${e.id}:${i}`, rank: LABEL_RANK.crumb, dist: trail.length - 1 - i,
        box: { x: p.x + CRUMB_LABEL_DX, y: p.y - s.h / 2, w: s.w, h: s.h } })
    })
  }
  // ── the Georeferenz twins ────────────────────────────────────────────────────────────
  // A projection is presentation-equivalent to the object beside it, and that includes being
  // arbitrated by this pass: twin labels used to be neither suppressed NOR visible to it, so
  // they printed over native names and native names dodged nothing (01.09.).
  // The live Messen readouts deliberately stay OUT of the pass: they belong to a tool the
  // operator is holding right now, they change on every vertex drag, and a measurement that
  // blinks out because a caption got there first would be unusable.
  return placeLabels(cands, occupied)
}

/**
 * MapView's label pass: runs `mapLabelDecisions` on every render against the live map, and
 * reports which symbol captions it hid (`onCaptionSuppressionChange` — the plan twins hide the
 * same ones). `bumpLabelFrame` is the re-run trigger for a pure PAN, which changes no other
 * state here but moves every label on screen: MapView bumps it on moveend — pan, zoom and rotate
 * all end there. Deliberately NOT per frame: labels appearing and disappearing under a moving
 * finger read as flicker, so the decision is taken once the map comes to rest.
 */
export function useLabelPass(mapInst: RefObject<MlMap | null>, scene: LabelPassScene, onCaptionSuppressionChange?: (ids: ReadonlySet<string>) => void) {
  const [, bump] = useState(0)
  const m = mapInst.current
  const suppressedLabels = m ? mapLabelDecisions((c) => m.project(c as [number, number]), scene) : NO_LABELS
  const suppressedCaptionKey = [...suppressedLabels]
    .filter((key) => key.startsWith('cap:'))
    .map((key) => key.slice(4))
    .sort()
    .join('\u0000')
  useEffect(() => {
    onCaptionSuppressionChange?.(new Set(suppressedCaptionKey ? suppressedCaptionKey.split('\u0000') : []))
  }, [onCaptionSuppressionChange, suppressedCaptionKey])
  return { suppressedLabels, bumpLabelFrame: () => bump((n) => n + 1) }
}
