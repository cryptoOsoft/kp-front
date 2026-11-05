// The decoration of one Linie on the Plan, in board px: its arrowhead (and «Stopp»), the FKS
// Teilstück fork, the end tag (Leitung-Nr · content · Stockwerk · the Trupp on it), the repeated
// marker letters or chain glyphs, and the free-text label with its Länge. The ink SVG cannot draw
// them (it would distort text and heads), so they ride above it. Lifted out of the Whiteboard
// (sweep A.1, 25.10.2026); the Lage map's twin is MapView's line decor — same spacing math
// (lib/lineStyle · markerParamsAlong), docs/tactical-objects.md.

import type React from 'react'
import { LineMarker } from './LineMarker'
import type { BoardAnno, BoardTool, Trupp } from '../types'
import { appConfig } from '../config/appConfig'
import { markerParamsAlong, markerSpacing, markerGlyph, lerpPoint, lookbackPoint } from '../lib/lineStyle'
import { TeilstueckFork, EndTag } from '../lib/lineDecor'
import { boardPts, endTagText, placeEndTag, planArrowBackPx, planArrowHead, tagSize } from '../lib/endTagSpots'
import { truppForLine, truppLineTone } from '../lib/truppLines'
import { fmtDistance, hoseLengthHint } from '../lib/geo'

const COLORS = appConfig.drawing.colors
interface Props {
  /** the Linie with its RESOLVED points (attached ends where they sit on their targets) */
  a: BoardAnno
  sW: number
  sH: number
  mapY: (floor: number | undefined, ly: number) => number
  /** is a board-px point on its storey's visible section? (Whiteboard · onSection) */
  onSection: (floor: number | undefined, p: [number, number]) => boolean
  trupps: Trupp[]
  truppSeverities?: Record<string, 1 | 2>
  /** the sheet's calibrated length of a path, null on an uncalibrated sheet (usePlanMeasure) */
  planMetres: (pts: [number, number][]) => number | null
  /** the end tag's centre from planEndTagSpots; absent, it takes the first spot (placeEndTag) */
  tagAt?: [number, number]
  /** the label drags only with the rest tool armed (the end tag is pinned to the line) */
  tool: BoardTool
  labelDown: (e: React.PointerEvent, id: string, dx0: number, dy0: number) => void
  labelMove: (e: React.PointerEvent) => void
  labelUp: (e: React.PointerEvent) => void
}

/** One Linie's decoration; see the file header. */
export function PlanLineDecor({ a, sW, sH, mapY, onSection, trupps, truppSeverities, planMetres, tagAt, tool, labelDown, labelMove, labelUp }: Props) {
  const p = a.pts!
  const bpx = boardPts(a, sW, sH, mapY)
  const end = bpx[bpx.length - 1]
  const midIdx = Math.floor((bpx.length - 1) / 2)
  const mid = bpx[midIdx]
  const color = a.color || COLORS[0]
  // On the stack the stroke is cut to its storey's section (lib/storeyClip): whatever
  // stands on a part that is not drawn — the tip, the tag, a marker, the label — is not
  // drawn either; the edge mark says the line goes on. `seg` names the vertex a spot
  // follows, whose storey it is on.
  const onLine = (seg: number, at: [number, number]) => onSection(p[seg][2] ?? a.floor, at)
  const endShown = onLine(bpx.length - 1, end)
  // arrowhead sized to the line weight (tip at 0,0 = the end point), like a real spitze – its
  // half-width, length back from the tip and lead past the end (lib/endTagSpots · planArrowHead:
  // the end tag stands short of it)
  const { halfW: ahw, len: ahl, lead: fwd } = planArrowHead(a.width ?? 5)
  // bearing from a point sampled back along the stroke (stable; the last freehand
  // segment is tiny + jittery), so the head points the way the line actually travels
  const ref = lookbackPoint(bpx, Math.max(ahl, 16))
  const dxr = end[0] - ref[0], dyr = end[1] - ref[1]
  const dlen = Math.hypot(dxr, dyr) || 1
  const ang = Math.atan2(dyr, dxr) * 180 / Math.PI
  // push the tip `fwd` PAST the line's visual end: clear the round cap (~half the
  // stroke width beyond the last vertex), then a few px more so the spitze leads the line
  const last: [number, number] = [end[0] + (dxr / dlen) * fwd, end[1] + (dyr / dlen) * fwd]
  // `deg` rides along so an FKS chain glyph stands on the line; a letter ignores it.
  // Board px are screen px here (the board is only translated/scaled), so the bearing
  // is directly usable — the same value the Lage map computes from projected px.
  const markerPts: { at: [number, number]; deg: number }[] = a.marker
    ? (() => {
      const along = markerParamsAlong(bpx, markerSpacing(a.marker))
      const ps = along.map(({ seg, t, deg }) => ({ seg, at: lerpPoint(bpx[seg], bpx[seg + 1], t), deg }))
      return (ps.length ? ps : [{ seg: midIdx, at: mid, deg: 0 }])
        .filter((m) => onLine(m.seg, m.at)).map(({ at, deg }) => ({ at, deg }))
    })()
    : []
  // distance read-out (calibrated plans only); falls back to a "calibrate first" nudge
  // the Atemschutz-Trupp on this Leitung (anchor or number) and how it is doing
  const lineTrupp = truppForLine(a, trupps)
  const lineTone = lineTrupp ? truppLineTone(lineTrupp, truppSeverities?.[lineTrupp.id] ?? 0) : 'idle'
  const distM = a.showDistance ? planMetres(a.pts!.map(([x, y]) => [x, y])) : null
  const labelLines: string[] = []
  if (distM != null) labelLines.push(`${fmtDistance(distM)} · ${hoseLengthHint(distM)}`)
  else if (a.showDistance) labelLines.push(appConfig.copy.whiteboard.scale.needsCalibration)
  if (a.label) labelLines.push(a.label)
  return (
    <>
      {a.arrow && endShown && (
        // SVG centred on the end point (viewBox origin (0,0) = svg centre = the path tip).
        // Centring uses the same translate-pair the markers use (reliable); the head is
        // rotated by an SVG `transform` on the path about (0,0), so the TIP stays pinned to
        // the end point at every angle — doing the rotation in CSS on the <svg> instead
        // would pivot about the box and skew the tip off the line. Tinted to the line colour.
        <svg className="wb-arrowhead" width="80" height="80" viewBox="-40 -40 80 80" aria-hidden
          style={{ left: 0, top: 0, color, transform: `translate(${last[0]}px, ${last[1]}px) translate(-50%, -50%)` }}>
          <path transform={`rotate(${ang})`} d={`M0,0 L${-ahl},${-ahw} L${-ahl},${ahw} Z`} fill="currentColor" />
          {/* the «Stopp»: the Entwicklungsgrenze bar just past the tip, like the fire's */}
          {a.arrowStop && <path transform={`rotate(${ang})`} d={`M4,${-ahw * 1.3} L4,${ahw * 1.3}`} stroke="currentColor" strokeWidth={Math.max(3, (a.width ?? 5) * 0.9)} strokeLinecap="round" fill="none" />}
        </svg>
      )}
      {/* FKS Teilstück fork at the tip (rotated to the line's screen angle) */}
      {a.teilstueck && endShown && (
        <span className="wb-line-deco" style={{ transform: `translate(${end[0]}px, ${end[1]}px) translate(-50%, -50%)` }}>
          <TeilstueckFork angleDeg={ang} color={color} width={a.width ?? 5} />
        </span>
      )}
      {/* one combined FKS tag (Leitung-Nr · content · Stockwerk · the Trupp) — PINNED to its line
          (owner pick, sweep 28.10.2026 #8b): beside its end, short of the arrowhead (hill climb r16),
          a fixed gap off the stroke at every zoom, on the first spot that covers no symbol, chip or
          other tag (planEndTagSpots). Never nudged by hand: the old drag offset was in sheet units,
          so it grew with the zoom, and a Karte line brought the ground point of its tag
          (endLabelAt) – both left the tag floating off its line. */}
      {(a.content || a.lineNo != null || a.floorTag != null || lineTrupp) && (() => {
        const text = endTagText(a)
        const { w, h } = tagSize(text)
        const at = tagAt ?? placeEndTag(bpx, w, h, [], planArrowBackPx(a))
        if (!onLine(bpx.length - 1, at)) return null
        return (
          <span className="wb-line-deco" style={{ transform: `translate(${at[0]}px, ${at[1]}px) translate(-50%, -50%)` }}>
            <EndTag
              lineNo={a.lineNo} content={a.content} floorTag={a.floorTag}
              tone={lineTone}
              color={color}
            />
          </span>
        )
      })()}
      {/* a LETTER keeps the plan's chip (plate + ring, legible over a printed plan);
          a chain GLYPH is bare, like the sheet draws it — hence the two classes. */}
      {markerPts.map((mp, i) => (
        <span key={`mk-${i}`} className={markerGlyph(a.marker) ? 'wb-line-glyph' : 'wb-line-marker'}
          style={{ left: 0, top: 0, color, transform: `translate(${mp.at[0]}px, ${mp.at[1]}px) translate(-50%, -50%)` }}>
          <LineMarker marker={a.marker!} color={color} deg={mp.deg} className="wb-line-mk" />
        </span>
      ))}
      {labelLines.length > 0 && onLine(midIdx, mid) && (
        <span className="wb-line-label" style={{ left: 0, top: 0, transform: `translate(${mid[0] + (a.labelDx ?? 0) * sW}px, ${mid[1] + (a.labelDy ?? 0) * sH}px) translate(-50%, -100%)`, cursor: tool === 'pan' ? 'move' : undefined }}
          onPointerDown={tool === 'pan' ? (e) => labelDown(e, a.id, a.labelDx ?? 0, a.labelDy ?? 0) : undefined}
          onPointerMove={tool === 'pan' ? labelMove : undefined}
          onPointerUp={tool === 'pan' ? labelUp : undefined}
          onPointerCancel={tool === 'pan' ? labelUp : undefined}>{labelLines.map((t, j) => <div key={j}>{t}</div>)}</span>
      )}
    </>
  )
}
