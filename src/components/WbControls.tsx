// The Plan's drawing pieces, split out of Whiteboard: the ink and circle SVG layers, the vertex /
// radius / draft handles and the armed tool's docks. Each is the plan twin of a Lage piece in
// MapView – same grips, same docks (the shared `ToolDock`), same tap order – so a change to one
// side is asked of the other (Lage ↔ Plan parity). The layers and handles render in board px
// (`sW`/`sH` + the storey `mapY`), never in a stretched 0..1 viewBox, and take gestures as props.
// Rules for this area: docs/tactical-objects.md.

import { useId, useRef } from 'react'
import type { BoardAnno, BoardPoint, BoardTool } from '../types'
import type { GrundrissRole, SnapRing } from './usePlanDraft'
import { Icon } from '../lib/icons'
import { appConfig } from '../config/appConfig'
import { HatchDefs, LINE_DASH_SVG, hatchPatternId } from '../lib/draw'
import { ToolDock } from './ToolDock'
import { NODE_HOLD_ARM_MS, useNodeHold } from '../lib/nodeHold'
import { DRAG_DEADZONE_PX } from '../lib/useHoldToDrag'
import { vertexHandleIndices, arrowEndIndices, EXTEND_STEP_PX } from '../lib/lineStyle'
import { NodeDeleteChip } from './NodeDeleteChip'
import { lineJoints } from '../lib/lineAttachments'
import { floorSections, signedFloor } from '../lib/whiteboard'
import { fillTemplate } from '../lib/format'
import { canDropVertex } from '../lib/vertexOps'
import { circleRing, clipStroke, edgeMarkHead, markDeg, thinMarks, type EdgeMark, type Pt, type Section } from '../lib/storeyClip'

const COLORS = appConfig.drawing.colors
/** the stroke an ink is drawn in on the board: its own colour, except a Wand still in the
 *  Grundriss dark, which follows the theme (the outline's family, one step stronger) – the
 *  palette's dark vanished on the night sheet (owner, 27.10.2026) */
const inkOf = (a: BoardAnno): string =>
  a.role === 'wand' && a.color === COLORS[4] ? 'var(--ink-dim)' : (a.color || COLORS[0])
/** id namespace for the ink layer's Schraffur — kept distinct from the circle layer's defs so
 *  the two SVGs never define the same GLOBAL pattern id twice (lib/draw · hatchPatternId). */
const INK_HATCH_SPACE = 'sheet'

interface InkProps {
  annos: BoardAnno[]
  draft: BoardPoint[] | null
  draftFloor: number
  draftClosed?: boolean // area tool: preview the draft as a closed/filled polygon
  /** the draft is an OPEN drawing (Punkte): orange marching dashes instead of the ink's look,
   *  until it is saved (27.10.2026) — a freehand stroke being dragged keeps the ink's look */
  draftOpen?: boolean
  color: string
  width: number
  dashed: boolean
  /** per-team hidden trails (anno ids) — a team's trail renders unless its id is in here */
  hiddenTrails: ReadonlySet<string>
  /** the Trupp chips whose Trupp is out (anno ids) — their trail wears the done dim (`.raus`) */
  outTrails?: ReadonlySet<string>
  mapY: (floor: number | undefined, ly: number) => number
  selId?: string | null
  /** «schau hier»: one anno outlined for a few seconds without being SELECTED (no handles, no
   *  editor sheet) — the plan twin of MapView's flashDrawingId. */
  flashId?: string | null
  networkIds?: string[]
  /** select/drag a stroke / area by tapping it (pan mode only); omitted ⇒ not hittable */
  onPickDraw?: (id: string, e: React.PointerEvent) => void
  /** anno id → Atemschutz alarm tone for the Leitung it draws ('warn' | 'crit'). Those lines get
   *  a soft outline in that tone — the plan twin of the Lage's l-draw-atemschutz layer. */
  truppTones?: Record<string, 'warn' | 'crit'>
  /** the sheet's size in CSS px — the coordinate space this whole layer renders in */
  sW: number
  sH: number
  /** the Gebäude stack: each drawn storey's visible section in board px (lib/storeyClip ·
   *  storeySections). Ink is cut to the section of the storey it is on; absent off the stack. */
  sections?: ReadonlyMap<number, Section>
}

/** how close two edge marks may stand before the second is dropped (board px) */
const MARK_GAP = 16

/** the clipPath id of one storey's section — a storey index may be negative */
const sectionClipId = (space: string, floor: number) => `${space}-sec${floor < 0 ? `m${-floor}` : floor}`

/** One `<clipPath>` per storey section, for the layer that references them. */
function SectionClips({ space, sections }: { space: string; sections?: ReadonlyMap<number, Section> }) {
  if (!sections?.size) return null
  return (
    <defs>
      {[...sections].map(([floor, polys]) => (
        <clipPath key={floor} id={sectionClipId(space, floor)} clipPathUnits="userSpaceOnUse">
          {polys.map((poly, i) => <polygon key={i} points={poly.map((p) => `${p[0]},${p[1]}`).join(' ')} />)}
        </clipPath>
      ))}
    </defs>
  )
}

/** a layer's clip-id namespace — React's useId carries colons, which not every engine lets
 *  through a `url(#…)` reference */
const useClipSpace = (prefix: string) => `${prefix}${useId().replace(/[^a-zA-Z0-9_-]/g, '')}`

/**
 * Where a stroke leaves its storey's section: a disc on the crossing with an arrowhead pointing
 * the way the stroke goes on (lib/storeyClip). Round, because it is on-canvas furniture; in the
 * stroke's colour on the paper-white the stair mark wears, because it says the same kind of
 * thing — «this line continues elsewhere» — and the two read as one family. A tap on it is a tap
 * on the line: the visible part stays selectable, and so does its mark.
 */
function EdgeMarks({ marks, color, width, id, onPick }: {
  marks: EdgeMark[]; color: string; width?: number; id: string
  onPick?: (id: string, e: React.PointerEvent) => void
}) {
  const r = Math.max(9, Math.min(12, (width ?? 5) + 4))
  return (
    <>
      {marks.map((m, i) => (
        <g key={i} className="wb-edge-mark" transform={`translate(${m.at[0]} ${m.at[1]}) rotate(${markDeg(m)})`}
          style={onPick ? { pointerEvents: 'all', cursor: 'grab' } : { pointerEvents: 'none' }}
          onPointerDown={onPick ? (e) => onPick(id, e) : undefined}>
          <circle r={r} fill="var(--on-accent-ink)" stroke={color} strokeWidth={2} />
          {/* a FILLED head, not a stroked chevron: at 18px a turned «›» read as a tick */}
          <path d={edgeMarkHead(r)} fill={color} stroke={color} strokeWidth={1} strokeLinejoin="round" />
        </g>
      ))}
    </>
  )
}

/** a stroke's crossings of its storey's section, thinned, and whether anything was cut away —
 *  nothing either way off the stack */
function strokeCut(pts: Pt[], section: Section | undefined, closed = false): { marks: EdgeMark[]; cut: boolean } {
  if (!section) return { marks: [], cut: false }
  const c = clipStroke(pts, section, closed)
  return { marks: thinMarks(c.marks, MARK_GAP), cut: c.cut }
}

/**
 * The vector ink layer: committed freehand/line polylines, filled areas, the in-progress draft,
 * and team trails. When `onPickDraw` is given (pan mode), each shape also gets a fat transparent
 * hit surface so it can be tapped to select — the visible shape stays non-interactive.
 *
 * ⚠️ Rendered in BOARD PIXELS, exactly like WbCircleLayer below — deliberately NOT the old 1×1
 * stretched viewBox whose stroke widths and dashes existed only through
 * `vector-effect: non-scaling-stroke`. That effect is the single point of failure this layer
 * must not have: the moment an engine drops it (a live exercise on iOS 26, 08.09.2026), a
 * width-5 stroke becomes five SHEETS wide and one drawn Leitung paints the whole surface solid
 * blue. In px space the widths are plain numbers and no renderer feature is load-bearing.
 * (Line arrowheads + marker letters still render OUTSIDE this layer — they need their own
 * un-stretched transforms either way.)
 */
export function WbInkLayer({ annos, draft, draftFloor, draftClosed, draftOpen, color, width, dashed, hiddenTrails, outTrails, mapY, selId, flashId, networkIds = [], onPickDraw, truppTones = {}, sW, sH, sections }: InkProps) {
  const W = Math.max(1, sW), H = Math.max(1, sH)
  const toPx = (pts: BoardPoint[], floor: number | undefined): Pt[] => pts.map((p) => [p[0] * W, mapY(p[2] ?? floor, p[1]) * H])
  const str = (pts: Pt[]) => pts.map((p) => `${p[0]},${p[1]}`).join(' ')
  const pointStr = (pts: BoardPoint[], floor: number | undefined) => str(toPx(pts, floor))
  const hatchId = (c: string) => hatchPatternId(c, INK_HATCH_SPACE)
  const space = useClipSpace('ink')
  /** the section clip of one storey — nothing off the stack, or for a storey the board does not draw */
  const clipOf = (floor: number | undefined) => (sections?.has(floor ?? 0) ? `url(#${sectionClipId(space, floor ?? 0)})` : undefined)
  const sectionOf = (floor: number | undefined) => sections?.get(floor ?? 0)
  return (
    <svg className="wb-ink-svg" viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none">
      <HatchDefs colors={COLORS} space={INK_HATCH_SPACE} />
      <SectionClips space={space} sections={sections} />
      {/* filled areas (under the lines) */}
      {annos.filter((a) => a.kind === 'area' && a.pts && a.pts.length >= 3).map((a) => {
        const px = toPx(a.pts!, a.floor)
        const pts = str(px)
        const { marks, cut } = strokeCut(px, sectionOf(a.floor), true)
        return (
        <g key={a.id}>
          {/* selected and cut: the whole outline as a faint ghost, so the vertex grips that stand
              outside the section are still attached to something */}
          {selId === a.id && cut && <polygon points={pts} fill="none" stroke={a.color || COLORS[0]} strokeWidth={2} strokeOpacity={0.4} strokeDasharray="3 5" style={{ pointerEvents: 'none' }} />}
          <g clipPath={clipOf(a.floor)}>
            {selId === a.id && <polygon points={pts} fill="none" stroke="var(--blue)" strokeWidth={(a.width || 3) + 6} strokeOpacity={0.35} strokeLinejoin="round" />}
            <polygon points={pts} fill={a.hatch ? `url(#${hatchId(a.color || COLORS[0])})` : inkOf(a)}
              fillOpacity={a.hatch ? 1 : (a.fillOpacity ?? 0.14)}
              stroke={inkOf(a)} strokeWidth={a.width || 3} strokeDasharray={a.dashed ? LINE_DASH_SVG : undefined}
              strokeLinejoin="round" />
            {onPickDraw && <polygon points={pts} fill="transparent" stroke="transparent" strokeWidth={18}
              style={{ pointerEvents: 'all', cursor: 'grab' }} onPointerDown={(e) => onPickDraw(a.id, e)} />}
          </g>
          <EdgeMarks marks={marks} color={inkOf(a)} width={a.width || 3} id={a.id} onPick={onPickDraw} />
        </g>
        )
      })}
      {annos.filter((a) => a.kind === 'draw' && a.pts).flatMap((a) => floorSections(a.pts!, a.floor).map((run, ri) => {
        // a Leitung that climbs storeys is drawn per storey; the climb itself is a stair mark
        // on either tile (Whiteboard · stair marks), not a stroke through the ceiling
        const runFloor = run[0][2] ?? a.floor
        const px = toPx(run, a.floor)
        const pts = str(px)
        // a run of ONE vertex – the Leitung has just arrived on this storey (↑/↓) – is a dot, or
        // there would be nothing to see or select on the tile until the next vertex is placed
        if (run.length === 1) {
          const [cx, cy] = px[0]
          return (
            <g key={`${a.id}:${ri}`} clipPath={clipOf(runFloor)}>
              {selId === a.id && <circle cx={cx} cy={cy} r={(a.width || 5) / 2 + 5} fill="var(--blue)" fillOpacity={0.35} />}
              <circle cx={cx} cy={cy} r={(a.width || 5) / 2 + 1.5} fill={a.color || COLORS[0]} />
              {onPickDraw && <circle cx={cx} cy={cy} r={14} fill="transparent" style={{ pointerEvents: 'all', cursor: 'grab' }} onPointerDown={(e) => onPickDraw(a.id, e)} />}
            </g>
          )
        }
        // ⚠️ Cut to the storey's section (24.09.2026): past it the stroke is not drawn at all —
        // it used to run on through the blank band and into the neighbouring storey's plan — and
        // an edge mark stands where it leaves. The clip cuts the hit line too, so only the part
        // that can be seen can be tapped.
        const { marks, cut } = strokeCut(px, sectionOf(runFloor))
        return (
        <g key={`${a.id}:${ri}`}>
          {selId === a.id && cut && (
            <polyline points={pts} fill="none" stroke={a.color || COLORS[0]} strokeWidth={2} strokeOpacity={0.4} strokeDasharray="3 5"
              strokeLinecap="round" strokeLinejoin="round" style={{ pointerEvents: 'none' }} />
          )}
          <g clipPath={clipOf(runFloor)}>
          {truppTones[a.id] && (
            <polyline points={pts} fill="none" stroke={truppTones[a.id] === 'crit' ? 'var(--red)' : 'var(--amber)'}
              strokeWidth={(a.width || 5) + 8} strokeOpacity={0.45}
              strokeLinecap="round" strokeLinejoin="round" />
          )}
          {networkIds.includes(a.id) && <polyline points={pts} fill="none" stroke="var(--accent)" strokeWidth={(a.width || 5) + 9} strokeOpacity={selId === a.id ? 0.34 : 0.16} strokeLinecap="round" strokeLinejoin="round" />}
          {flashId === a.id && (
            <polyline points={pts} fill="none" stroke="var(--blue)" strokeWidth={(a.width || 5) + 14}
              strokeOpacity={0.3} strokeLinecap="round" strokeLinejoin="round" />
          )}
          {selId === a.id && (
            <polyline points={pts} fill="none" stroke="var(--blue)" strokeWidth={(a.width || 5) + 6}
              strokeOpacity={0.35} strokeLinecap="round" strokeLinejoin="round" />
          )}
          <polyline
            points={pts}
            fill="none" stroke={inkOf(a)} strokeWidth={a.width || 5}
            strokeDasharray={a.dashed ? LINE_DASH_SVG : undefined}
            strokeLinecap={a.dashed ? 'butt' : 'round'} strokeLinejoin="round"
          />
          {onPickDraw && (
            <polyline points={pts} fill="none" stroke="transparent" strokeWidth={18}
              strokeLinecap="round" strokeLinejoin="round"
              style={{ pointerEvents: 'stroke', cursor: 'grab' }}
              onPointerDown={(e) => onPickDraw(a.id, e)} />
          )}
          </g>
          <EdgeMarks marks={marks} color={inkOf(a)} width={a.width || 5} id={a.id} onPick={onPickDraw} />
        </g>
        )
      }))}
      {/* «Angekuppelt» (11.10.2026): a dot in the hose's ink on every line → line joint — the
          Karte's l-draw-join (MapView · joinFC). `annos` are the RESOLVED annos, so the dot sits
          where the two ends meet; cut to the joint's storey like the stroke it ends. */}
      {lineJoints(annos.filter((a) => a.kind === 'draw' && (a.pts?.length ?? 0) >= 2)
        .map((a) => ({ id: a.id, points: a.pts!, startAttachment: a.startAttachment, endAttachment: a.endAttachment })))
        .map((j) => {
          const a = annos.find((x) => x.id === j.lineId)!
          const [cx, cy] = toPx([j.point], a.floor)[0]
          return <circle key={`join-${j.lineId}-${j.endpoint}`} cx={cx} cy={cy} r={(a.width || 5) / 2 + 2.5} clipPath={clipOf(j.point[2] ?? a.floor)}
            fill={a.color || COLORS[0]} stroke="var(--surface)" strokeWidth={2} style={{ pointerEvents: 'none' }} />
        })}
      {draft && draft.length >= 2 && (draftOpen
        // the open look: one storey run at a time (a Leitung may climb), class-styled so the
        // dashes march (09-whiteboard.css · .wb-draft-open)
        ? (draftClosed && draft.length >= 3
          ? <polygon className="wb-draft-open" points={pointStr(draft, draftFloor)} strokeLinejoin="round" />
          : floorSections(draft, draftFloor).filter((run) => run.length > 1).map((run, i) => (
            <polyline key={`draft-${i}`} className="wb-draft-open" points={pointStr(run, draftFloor)} fill="none" strokeLinecap="round" strokeLinejoin="round" />
          )))
        : draftClosed && draft.length >= 3
          ? <polygon points={pointStr(draft, draftFloor)} fill={color} fillOpacity={0.12} stroke={color} strokeWidth={width} strokeDasharray={dashed ? LINE_DASH_SVG : undefined} strokeLinejoin="round" />
          : <polyline points={pointStr(draft, draftFloor)} fill="none" stroke={color} strokeWidth={width} strokeDasharray={dashed ? LINE_DASH_SVG : undefined} strokeLinecap={dashed ? 'butt' : 'round'} strokeLinejoin="round" />
      )}
      {/* team trails — path through the explicitly RECORDED positions only (not the live pill).
          On the stack a trail is cut per storey like a Leitung, without edge marks: it records
          where somebody walked, it is not a line that goes on somewhere. */}
      {annos.filter((a) => a.kind === 'resource' && (a.trail?.length ?? 0) > 1 && !hiddenTrails.has(a.id)).flatMap((a) => {
        const trail = (a.trail ?? []).map((p): BoardPoint => [p.x, p.y, p.floor ?? a.floor ?? 0])
        const runs = sections ? floorSections(trail, a.floor).filter((run) => run.length > 1) : [trail]
        return runs.map((run, ri) => (
          <polyline
            key={`trail-${a.id}:${ri}`}
            className={outTrails?.has(a.id) ? 'wb-trail-line raus' : undefined}
            points={pointStr(run, a.floor)}
            clipPath={sections ? clipOf(run[0][2]) : undefined}
            fill="none" stroke={a.color || COLORS[0]} strokeWidth={2} strokeDasharray="5 5"
            strokeLinecap="round" strokeLinejoin="round" opacity={0.85}
          />
        ))
      })}
    </svg>
  )
}

interface CircleProps {
  annos: BoardAnno[]
  /** the Absperrkreis being dragged out right now (centre + radius, plan-normalized) */
  draft: { x: number; y: number; floor: number; r: number } | null
  /** board size in px — the same px space the ink layer above renders in */
  sW: number
  sH: number
  mapY: (floor: number | undefined, ly: number) => number
  color: string
  selId?: string | null
  flashId?: string | null
  /** select/drag a circle by tapping it (pan mode only); omitted ⇒ not hittable */
  onPickCircle?: (id: string, e: React.PointerEvent) => void
  /** the Gebäude stack's storey sections (see InkProps · sections) */
  sections?: ReadonlyMap<number, Section>
}

/**
 * Absperrkreise (Gefahrenradius) — the plan twin of the Karte's `circle` drawings.
 *
 * ⚠️ Its own SVG, in BOARD PIXELS. Historically the separation existed because the ink layer was
 * a 1×1 stretch (where a circle can only be an ellipse re-derived from the aspect); the ink layer
 * is px-space too now, but a circle stays here: its stored `radiusN` is a fraction of the plan
 * WIDTH (types · BoardAnno.radiusN), and one layer owning that conversion keeps it exact.
 *
 * Painted UNDER the ink layer on purpose: a Leitung drawn across a big cordon must win the tap,
 * the same ordering rule the Karte states (components/mapClick · routeMapClick).
 */
export function WbCircleLayer({ annos, draft, sW, sH, mapY, color, selId, flashId, onPickCircle, sections }: CircleProps) {
  const W = Math.max(1, sW), H = Math.max(1, sH)
  const space = useClipSpace('circ')
  return (
    <svg className="wb-ink-svg" viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none">
      <HatchDefs colors={COLORS} />
      <SectionClips space={space} sections={sections} />
      {annos.filter((a) => a.kind === 'circle' && (a.radiusN ?? 0) > 0).map((a) => {
        const cx = (a.x ?? 0) * sW, cy = mapY(a.floor, a.y ?? 0) * sH
        const r = Math.max(1, (a.radiusN ?? 0) * sW)
        const ink = a.color || appConfig.drawing.circleColor
        const w = a.width ?? appConfig.drawing.circleLineWidth
        // on the stack a cordon is cut to its storey's section like any ink — a 100 m Absperrkreis
        // projected off the Karte washed every storey of the building (24.09.2026) — and its ring
        // wears an edge mark wherever it leaves the section
        const section = sections?.get(a.floor ?? 0)
        const { marks, cut } = strokeCut(section ? circleRing(cx, cy, r) : [], section, true)
        return (
          <g key={a.id}>
            {selId === a.id && cut && <circle cx={cx} cy={cy} r={r} fill="none" stroke={ink} strokeWidth={2} strokeOpacity={0.4} strokeDasharray="3 5" style={{ pointerEvents: 'none' }} />}
            <g clipPath={section ? `url(#${sectionClipId(space, a.floor ?? 0)})` : undefined}>
              {flashId === a.id && <circle cx={cx} cy={cy} r={r} fill="none" stroke="var(--blue)" strokeWidth={w + 14} strokeOpacity={0.3} />}
              {selId === a.id && <circle cx={cx} cy={cy} r={r} fill="none" stroke="var(--blue)" strokeWidth={w + 6} strokeOpacity={0.35} />}
              <circle cx={cx} cy={cy} r={r}
                fill={a.hatch ? `url(#${hatchPatternId(ink)})` : ink}
                fillOpacity={a.hatch ? 1 : (a.fillOpacity ?? appConfig.drawing.circleFillOpacity)}
                stroke={ink} strokeWidth={w} strokeDasharray={a.dashed ? LINE_DASH_SVG : undefined} />
              {/* a LOCKED circle is click-through — its LockChip is the only door (Whiteboard) */}
              {onPickCircle && !a.locked && (
                <circle cx={cx} cy={cy} r={r} fill="transparent" stroke="transparent" strokeWidth={18}
                  style={{ pointerEvents: 'all', cursor: 'grab' }} onPointerDown={(e) => onPickCircle(a.id, e)} />
              )}
            </g>
            <EdgeMarks marks={marks} color={ink} width={w} id={a.id} onPick={a.locked ? undefined : onPickCircle} />
          </g>
        )
      })}
      {draft && (
        <circle cx={draft.x * sW} cy={mapY(draft.floor, draft.y) * sH} r={Math.max(1, draft.r * sW)}
          fill={color} fillOpacity={appConfig.drawing.circleFillOpacity}
          stroke={color} strokeWidth={appConfig.drawing.circleLineWidth} strokeDasharray={LINE_DASH_SVG} />
      )}
    </svg>
  )
}

/**
 * The ONE grip an Absperrkreis has: on the ring at screen-right, dragging its radius — the
 * gesture that placed it, available again afterwards. It wears the sheet's own node-grip look
 * (`.wb-vertex`), because that is what it is: a point you drag.
 *
 * It lives here beside the vertex handles rather than inline on the board so the drag handlers
 * stay plain props (the render pass then touches no gesture ref of the Whiteboard's).
 */
export function WbCircleHandle({ anno, sW, sH, mapY, onRadiusDown, onMove, onUp }: {
  anno: BoardAnno
  sW: number
  sH: number
  mapY: (floor: number | undefined, ly: number) => number
  onRadiusDown: (e: React.PointerEvent) => void
  onMove: (e: React.PointerEvent) => void
  onUp: () => void
}) {
  if (anno.kind !== 'circle') return null
  const cx = (anno.x ?? 0) * sW, cy = mapY(anno.floor, anno.y ?? 0) * sH
  const r = Math.max(1, (anno.radiusN ?? 0) * sW)
  return (
    <button className="wb-vertex" title={appConfig.copy.whiteboard.dragRadius} aria-label={appConfig.copy.whiteboard.dragRadius} data-holdaction
      style={{ left: 0, top: 0, transform: `translate(${cx + r}px, ${cy}px) translate(-50%, -50%)` }}
      onPointerDown={onRadiusDown} onPointerMove={onMove} onPointerUp={onUp} onPointerCancel={onUp}
      onClick={(e) => e.stopPropagation()} />
  )
}

/**
 * Vertex handles for the IN-PROGRESS Punkte draft (node-mode Linie / Fläche) — the same grips and
 * «+» midpoint inserts a FINISHED shape gets (WbVertexHandles below), so the shape being laid down
 * is already editable in place instead of only append-only until ✓ (decided 29.08.). Slimmer than
 * the finished-shape variant on purpose: a draft has no attachments, no Verlängern arrows (the
 * next tap IS how it grows) and no thinning (node drafts are a handful of deliberate taps).
 * Positions are board px; classes are the shared `.wb-vertex` / `.wb-vins`, which already sit
 * above the `.wb-ink` capture overlay (z 6/7 vs 5), so the grips stay tappable mid-tool.
 */
export function WbDraftHandles({ pts, closed, draftFloor, sW, sH, mapY, onVertexDown, onVertexTap, onInsert, onDeleteVertex }: {
  pts: BoardPoint[]
  /** area draft: the ring closes visually at ≥3 pts, so the closing edge gets a «+» too */
  closed: boolean
  draftFloor: number
  sW: number
  sH: number
  mapY: (floor: number | undefined, ly: number) => number
  onVertexDown: (idx: number, e: React.PointerEvent) => void
  /** a still, short tap on grip `idx` (a Grundriss piece finishes on its last, closes on its first) */
  onVertexTap?: (idx: number) => void
  onInsert: (idx: number, e: React.PointerEvent) => void
  onDeleteVertex: (idx: number) => void
}) {
  // still hold = delete, movement cancels into the reshape drag — the same gesture (and chip) as
  // on a finished shape, so the draft never teaches a second vocabulary.
  const vertexPress = useNodeHold()
  // where a grip press went down — its release is a TAP only if it stayed put and was short
  // (a longer still press is the hold-to-delete above)
  const pressAt = useRef<{ x: number; y: number; t: number } | null>(null)
  if (!pts.length) return null
  const sp: [number, number][] = pts.map(([x, y, floor]) => [x * sW, mapY(floor ?? draftFloor, y) * sH])
  const segs: number[] = []
  for (let i = 0; i < sp.length - 1; i++) segs.push(i)
  if (closed && sp.length >= 3) segs.push(sp.length - 1)
  return (
    <>
      {segs.map((i) => {
        const a = sp[i], b = sp[(i + 1) % sp.length]
        return (
          <button key={`dins-${i}`} className="wb-vins" title={appConfig.copy.whiteboard.insertVertex} aria-label={appConfig.copy.whiteboard.insertVertex}
            style={{ left: 0, top: 0, transform: `translate(${(a[0] + b[0]) / 2}px, ${(a[1] + b[1]) / 2}px) translate(-50%, -50%)` }}
            onPointerDown={(e) => onInsert(i, e)}><Icon id="plus" /></button>
        )
      })}
      {sp.map(([x, y], i) => (
        <button key={`dv-${i}`} className={`wb-vertex ${vertexPress.armed?.key === `d${i}` ? 'doomed' : ''}`}
          title={appConfig.copy.whiteboard.dragVertex} aria-label={appConfig.copy.whiteboard.dragVertex} data-holdaction
          style={{ left: 0, top: 0, transform: `translate(${x}px, ${y}px) translate(-50%, -50%)` }}
          onPointerDown={(e) => {
            // deleting is allowed all the way down — a one-point draft deletes into no draft,
            // which is exactly what the ✕/Esc discard leaves too
            vertexPress.press(`d${i}`, () => onDeleteVertex(i), true).onPointerDown(e)
            onVertexDown(i, e)
            pressAt.current = { x: e.clientX, y: e.clientY, t: e.timeStamp }
          }}
          onPointerUp={(e) => {
            const at = pressAt.current; pressAt.current = null
            if (at && onVertexTap && Math.hypot(e.clientX - at.x, e.clientY - at.y) <= DRAG_DEADZONE_PX && e.timeStamp - at.t < NODE_HOLD_ARM_MS) onVertexTap(i)
          }}
          // …and the same right-click shorthand a finished shape's grips carry (A26)
          onContextMenu={(e) => { e.stopPropagation(); e.preventDefault(); onDeleteVertex(i) }}
        >{vertexPress.armed?.key === `d${i}` && <NodeDeleteChip progress={vertexPress.armed.progress} />}</button>
      ))}
    </>
  )
}

/** Where the next Punkte point lands (usePlanDraft · ring), in board px: a magenta ring when it
 *  snaps, a small grey dot when it is free, and — for a mouse — the rubber band from the open
 *  drawing's last point. No text, no guide line (owner, 27.10.2026). */
export function WbSnapRing({ ring, sW, sH }: { ring: SnapRing; sW: number; sH: number }) {
  return (
    <svg className="wb-snap-svg" viewBox={`0 0 ${Math.max(1, sW)} ${Math.max(1, sH)}`} preserveAspectRatio="none" aria-hidden>
      {ring.from && <line className="wb-snap-band" x1={ring.from[0]} y1={ring.from[1]} x2={ring.x} y2={ring.y} />}
      {ring.snapped
        ? <><circle className="wb-snap-ring" cx={ring.x} cy={ring.y} r={9} /><circle className="wb-snap-core" cx={ring.x} cy={ring.y} r={2.5} /></>
        : <circle className="wb-snap-free" cx={ring.x} cy={ring.y} r={3.5} />}
    </svg>
  )
}

/**
 * On-canvas vertex editing for a selected line/area — ONE code path for both kinds (they're both
 * `pts`): a draggable grip per vertex (press-and-hold to delete) and a "+" at each segment midpoint
 * to insert a node. The closing edge is only offered for an area (`kind === 'area'`). Positions are
 * board px (caller passes sW/sH + the floor-stack y map).
 *
 * A dense freehand stroke shows a THINNED set of grips (lib/lineStyle · vertexHandleIndices) that
 * densifies as the plan is zoomed in — the same bargain the Lage map makes, since sW/sH already
 * carry the board zoom. The "+" handles only appear while EVERY node is shown: a midpoint between
 * two thinned grips is nowhere near the drawn path.
 */
export function WbVertexHandles({ anno, sW, sH, mapY, onVertexDown, onInsert, onDeleteVertex, onExtend, onClimb, floors }: {
  anno: BoardAnno
  sW: number
  sH: number
  mapY: (floor: number | undefined, ly: number) => number
  onVertexDown: (idx: number, e: React.PointerEvent) => void
  onInsert: (idx: number, e: React.PointerEvent) => void
  onDeleteVertex: (idx: number) => void
  /** grow the line past an open end — appends a point there and hands the drag over to it */
  onExtend?: (end: 'start' | 'end', e: React.PointerEvent) => void
  /** Gebäude stack only: continue the Leitung at the SAME spot one storey up (+1) or down (−1) –
   *  the staircase gesture (Bastian, 14.09.2026). `floors` says which storeys exist. */
  onClimb?: (end: 'start' | 'end', dir: 1 | -1) => void
  floors?: number[]
}) {
  // still hold = delete, movement cancels into the reshape drag — the SAME gesture and the same
  // chip the map uses (lib/nodeHold · NodeDeleteChip); the two surfaces share the feel, not the
  // renderer.
  //
  // ⚠️ Every grip below carries `data-holdaction` (01.09.). These are <button>s, where the Lage's
  // are plain <div>s, and the app-wide hold-tooltip (lib/holdTooltip) only looks at buttons — so
  // on the plan it popped «Punkt ziehen» at 350 ms INSIDE the 825 ms hold-to-delete and swallowed
  // the release, which is the one gesture that must survive. The attribute opts them out at the
  // source and keeps the button's keyboard/aria access, which the map's div never had.
  const vertexPress = useNodeHold()
  const pts = anno.pts ?? []
  if (pts.length < 2) return null
  const closed = anno.kind === 'area'
  const sp: [number, number][] = pts.map(([x, y, floor]) => [x * sW, mapY(floor ?? anno.floor, y) * sH])
  const gripIdx = vertexHandleIndices(sp)
  // the node under an arrowhead is drawn hollow so the spitze reads through it — the same rule,
  // from the same helper, as on the Karte (lib/lineStyle · arrowEndIndices)
  const ringIdx = arrowEndIndices(anno, pts.length)
  const allShown = gripIdx.length === sp.length
  const segs: number[] = [] // segment i runs from vertex i → i+1 (wraps to 0 for a closed area)
  if (allShown) {
    for (let i = 0; i < sp.length - 1; i++) segs.push(i)
    if (closed && sp.length >= 3) segs.push(sp.length - 1)
  }
  /** ONE answer to «may this node go», read by both ways of asking: the hold (which simply never
   *  arms below the floor — a shape's minimum is a thing not to offer, not a thing to explain
   *  mid-gesture) and the right-click below. `deleteVertex` upstream enforces it again, together
   *  with the read-only gate that already keeps these handles off a locked sheet. */
  const canDeleteNode = canDropVertex(anno.kind, pts.length)
  return (
    <>
      {segs.map((i) => {
        const a = sp[i], b = sp[(i + 1) % sp.length]
        return (
          <button key={`ins-${i}`} className="wb-vins" title={appConfig.copy.whiteboard.insertVertex} aria-label={appConfig.copy.whiteboard.insertVertex}
            style={{ left: 0, top: 0, transform: `translate(${(a[0] + b[0]) / 2}px, ${(a[1] + b[1]) / 2}px) translate(-50%, -50%)` }}
            onPointerDown={(e) => onInsert(i, e)}><Icon id="plus" /></button>
        )
      })}
      {/* ── Verlängern ──────────────────────────────────────────────────────────────────────
          The arrow tip past each open end, exactly as on the Lage: pressing it appends one point
          right there — one fixed step further out — and the same press keeps dragging that point,
          so a tap alone already grew the line. A Fläche has no end to grow from. */}
      {!closed && onExtend && (['start', 'end'] as const).map((ep) => {
        const i = ep === 'start' ? 0 : sp.length - 1
        const nb = ep === 'start' ? sp[1] : sp[sp.length - 2]
        const p0 = sp[i]
        const dx = p0[0] - nb[0], dy = p0[1] - nb[1], len = Math.hypot(dx, dy) || 1
        const gx = p0[0] + (dx / len) * EXTEND_STEP_PX, gy = p0[1] + (dy / len) * EXTEND_STEP_PX
        const deg = (Math.atan2(dy, dx) * 180) / Math.PI
        return (
          <button key={`grow-${ep}`} className="draw-grow wb-grow" title={appConfig.copy.measure.extendLine} aria-label={appConfig.copy.measure.extendLine}
            style={{ left: 0, top: 0, transform: `translate(${gx}px, ${gy}px) translate(-50%, -50%)`, ['--grow-deg' as string]: `${deg}deg` }}
            onPointerDown={(e) => onExtend(ep, e)}><Icon id="arrow" /></button>
        )
      })}
      {/* ── Ein Geschoss höher / tiefer ──────────────────────────────────────────────────────
          On the stack an open end offers ↑ and ↓ beside the arrow: the line goes on at the same
          place on the storey above / below – how a Leitung takes the stairs. Only for storeys
          the stack has. */}
      {!closed && onClimb && floors && (['start', 'end'] as const).flatMap((ep) => {
        const i = ep === 'start' ? 0 : sp.length - 1
        const here = pts[i][2] ?? anno.floor ?? 0
        const p0 = sp[i]
        const nb = pts[ep === 'start' ? 1 : pts.length - 2]
        return ([1, -1] as const).filter((dir) => floors.includes(here + dir)).map((dir) => {
          // the neighbour is this very spot one storey over → this tap goes BACK (Whiteboard · climbLine)
          const back = !!nb && nb[0] === pts[i][0] && nb[1] === pts[i][1] && (nb[2] ?? anno.floor ?? 0) === here + dir && pts.length > 2
          const label = back ? fillTemplate(appConfig.copy.whiteboard.climbBack, { floor: signedFloor(here + dir) }) : dir > 0 ? appConfig.copy.whiteboard.climbUp : appConfig.copy.whiteboard.climbDown
          return (
          <button key={`climb-${ep}-${dir}`} type="button" className={`draw-grow wb-grow wb-climb${back ? ' back' : ''}`} data-holdaction
            title={label} aria-label={label}
            // ↑ straight above the end vertex, ↓ straight below it – the direction IS the meaning
            style={{ left: 0, top: 0, transform: `translate(${p0[0]}px, ${p0[1] + (dir > 0 ? -44 : 44)}px) translate(-50%, -50%)` }}
            onPointerDown={(e) => e.stopPropagation()} onClick={(e) => { e.stopPropagation(); onClimb(ep, dir) }}>
            <Icon id={dir > 0 ? 'chevron-up' : 'chevron-down'} />
          </button>
          )
        })
      })}
      {/* ⚠️ No double-tap delete any more (19.08.). It was the one gesture the map never had, iOS
          does not deliver `dblclick` reliably anyway, and on a dense line a stray second tap
          removed a node with no way to see it coming. The hold is the whole story now. */}
      {gripIdx.map((i) => {
        const [x, y] = sp[i]
        return (
        <button key={`v-${i}`} className={`wb-vertex ${ringIdx.includes(i) ? 'wb-vertex--ring' : ''} ${vertexPress.armed?.key === `v${i}` ? 'doomed' : ''}`}
          title={appConfig.copy.whiteboard.dragVertex} aria-label={appConfig.copy.whiteboard.dragVertex} data-holdaction
          style={{ left: 0, top: 0, transform: `translate(${x}px, ${y}px) translate(-50%, -50%)` }}
          onPointerDown={(e) => {
            vertexPress.press(`v${i}`, () => onDeleteVertex(i), canDeleteNode).onPointerDown(e)
            onVertexDown(i, e)
          }}
          // A26 · the desktop shorthand for the same hold, as on the Karte (MapView · the node
          // pads). The mouse has a second button and a right-click on a node means one thing;
          // making it wait out 825 ms is a touch gesture charged to a hand that isn't touching.
          // Same `canDeleteNode`, so the shape's floor is never offered and then refused.
          onContextMenu={(e) => { e.stopPropagation(); e.preventDefault(); if (canDeleteNode) onDeleteVertex(i) }}
        >{vertexPress.armed?.key === `v${i}` && <NodeDeleteChip progress={vertexPress.armed.progress} />}</button>
        )
      })}
    </>
  )
}

/** «Trupp finden» on a Trupp dock: opens the workspace's ONE TruppFinder (IncidentWorkspace).
 *  `disabled` while no Trupp is placed anywhere — on the tool's own dock an absent button would
 *  read as a tool that lost one (MapToolDocks · the Karte's twin). */
export interface TruppFinderDoor { open: () => void; disabled: boolean }

interface DocksProps {
  tool: BoardTool
  lineMode: 'freehand' | 'nodes'
  /** the in-progress node draft is committable (line ≥2 pts / area ≥3 pts) — gates the ✓ button */
  draftActive: boolean
  setTool: (t: BoardTool) => void
  areaMode: 'nodes' | 'freehand'
  /** the Gebäude stack offers the Grundriss preset (the Wand on the Linie) … */
  stack: boolean
  /** … the one in force … */
  grundriss: GrundrissRole | null
  /** … and the input pick: Freihand, Punkte or a preset (usePlanDraft · pickInput, which asks
   *  about an open drawing of another kind first) */
  pickInput: (next: 'freehand' | 'nodes' | GrundrissRole) => void
  onFinish: () => void
  /** Messen tool: line/area mode + clear/close, mirroring the Lage map's measure dock */
  measMode: 'line' | 'area'
  setMeasMode: (m: 'line' | 'area') => void
  measCount: number
  onMeasClear: () => void
  onMeasClose: () => void
  /** absent where the board has no finder to open (Karte & Objekte's plan reader) */
  truppFinder?: TruppFinderDoor
}

/**
 * Right-edge tool option docks (the armed tool's ✕, its input mode, ✓ and ⓘ), each top-aligned
 * to its rail button. Built from the SHARED `ToolDock`
 * renderer — same control vocabulary (and look) as the Lage map; the Linie tool carries the same
 * Freihand↔Punkte input toggle, and the line style (Freihand/Messpfeil/Rettungsachse) is chosen in
 * the post-draw editor, not here.
 */
export function WbToolDocks({ tool, lineMode, areaMode, stack, grundriss, pickInput, draftActive, setTool, onFinish, measMode, setMeasMode, measCount, onMeasClear, onMeasClose, truppFinder }: DocksProps) {
  // Read copy per render: the deployment locale is resolved after modules are imported.
  // ✕ is a way out of the tool like any other: the tool change asks about an open drawing
  // (usePlanDraft · releaseDraft), so it only has to put the tool down
  const closeDraft = () => setTool('pan')
  const G = appConfig.copy.whiteboard.grundriss
  const H = appConfig.copy.whiteboard.dockHints
  /** a Grundriss preset's toggle (stack only) */
  const presetTog = (role: GrundrissRole, icon: string) =>
    ({ type: 'toggle' as const, icon, label: G[role], on: grundriss === role, onClick: () => pickInput(role) })
  return (
    <>
      {/* Linie — Freihand (drag) ↔ Punkte (tap, ✓ to finish); identical to map. «D pur»
          (09.09.): no colour/width/style here — the finished line lands selected in the
          DrawEditor, which is where the styling lives (and writes the next-ink defaults).
          On the Gebäude stack also the Wand, which stays armed (27.10.2026). */}
      {tool === 'line' && (
        <ToolDock groups={[
          [{ type: 'close', onClick: closeDraft }],
          [
            { type: 'toggle', icon: 'pen', label: appConfig.copy.drawingEditor.modeFreehand, on: lineMode === 'freehand' && !grundriss, onClick: () => pickInput('freehand') },
            { type: 'toggle', icon: 'polygon', label: appConfig.copy.drawingEditor.modeNodes, on: lineMode === 'nodes' && !grundriss, onClick: () => pickInput('nodes') },
            ...(stack ? [presetTog('wand', 'wall')] : []),
            ...(lineMode === 'nodes' ? [{ type: 'go' as const, disabled: !draftActive, onClick: onFinish }] : []),
          ],
          // the Karte's own words, per input mode (copy · dockHints): one rule, one text
          [{ type: 'info', text: grundriss ? H[grundriss] : lineMode === 'nodes' ? appConfig.copy.dockHints.lineNodes : appConfig.copy.dockHints.lineFreehand }],
        ]} />
      )}

      {/* Fläche — Freihand ODER Knoten + info. Same two-mode group as the Linie dock above it,
          because it is the same question: tap the corners, or draw it. Styling: in the editor
          afterwards, like the Linie. */}
      {tool === 'area' && (
        <ToolDock groups={[
          [{ type: 'close', onClick: closeDraft }],
          [
            { type: 'toggle', icon: 'pen', label: appConfig.copy.drawingEditor.modeFreehand, on: areaMode === 'freehand', onClick: () => pickInput('freehand') },
            { type: 'toggle', icon: 'polygon', label: appConfig.copy.drawingEditor.modeNodes, on: areaMode === 'nodes', onClick: () => pickInput('nodes') },
            ...(areaMode === 'nodes' ? [{ type: 'go' as const, disabled: !draftActive, onClick: onFinish }] : []),
          ],
          [{ type: 'info', text: appConfig.copy.dockHints.area }],
        ]} />
      )}

      {/* Messen — close + Strecke/Fläche toggle + clear + info (identical to the Lage map dock).
          Removed 29.08., restored 02.09.: see usePlanMeasure's header. */}
      {tool === 'measure' && (
        <ToolDock groups={[
          [{ type: 'close', onClick: onMeasClose }],
          [
            { type: 'toggle', icon: 'measure', label: appConfig.copy.measure.modeLine, on: measMode === 'line', onClick: () => setMeasMode('line') },
            { type: 'toggle', icon: 'area', label: appConfig.copy.measure.modeArea, on: measMode === 'area', onClick: () => setMeasMode('area') },
          ],
          [{ type: 'action', icon: 'trash', label: appConfig.copy.measure.clear, disabled: !measCount, onClick: onMeasClear }],
          [{ type: 'info', text: appConfig.copy.whiteboard.dockHints.measure }],
        ]} />
      )}

      {/* Absperrkreis — drag centre → edge. Cancel + hint and nothing else, exactly like the
          Karte's circle dock (IncidentWorkspace): a cordon is placed in the hazard colour and
          then adjusted — radius, colour and fill — in its own editor. */}
      {tool === 'circle' && (
        <ToolDock groups={[
          [{ type: 'close', onClick: () => setTool('pan') }],
          [{ type: 'info', text: appConfig.copy.whiteboard.dockHints.circle }],
        ]} />
      )}

      {/* Notiz armed — «D pur» (09.09.) here too: a fresh note opens its detail panel with the
          caret already in the text, and Zettel/Klartext, S/M/L and the colour live THERE —
          where they also write the next note's defaults. */}
      {tool === 'text' && (
        <ToolDock groups={[
          [{ type: 'close', onClick: () => setTool('pan') }],
          [{ type: 'info', text: appConfig.copy.whiteboard.dockHints.text }],
        ]} />
      )}

      {/* team armed-tool — ✕ · «Trupp finden» · ⓘ, the Karte's Trupp dock (MapToolDocks): placing
          one and finding one are the two things reaching for this tool can mean (UX sweep M9) */}
      {tool === 'resource' && (
        <ToolDock groups={[
          [{ type: 'close', onClick: () => setTool('pan') }],
          ...(truppFinder ? [[{
            type: 'action' as const, icon: 'trupp-find', label: appConfig.copy.truppFinder.title,
            disabled: truppFinder.disabled, onClick: truppFinder.open,
          }]] : []),
          [{ type: 'info', text: appConfig.copy.whiteboard.dockHints.resource }],
        ]} />
      )}

      {/* Mehrfach (lasso/marquee) armed-tool — cancel + info, mirroring the map's lasso dock */}
      {tool === 'lasso' && (
        <ToolDock groups={[
          [{ type: 'close', onClick: () => setTool('pan') }],
          [{ type: 'info', text: appConfig.copy.dockHints.lasso }],
        ]} />
      )}

      {/* No dock for a selected team (18.09.2026). The Spuren-Auge lived here AND on the marker's
          own bar (components/TwinTeamPill) — the same state, two places, and the dock copy was the
          far one: it opened a third fixed bar in the same bottom strip the pill row already uses.
          The bar beside the marker is the one answer; recolour and trail clearing had already
          moved off this dock. */}
    </>
  )
}
