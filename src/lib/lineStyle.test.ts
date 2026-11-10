import { describe, expect, it } from 'vitest'
import { FREEHAND_SIMPLIFY_PX, HANDLE_MIN_SPACING_PX, MARKER_SPACING_PX, MAX_VERTEX_HANDLES, MIN_STROKE_PX, evenIndices, isTapStroke, markerGlyph, markerParamsAlong, markerSpacing, arrowEndIndices, rdpIndices, resolveLinePreset, vertexHandleIndices } from './lineStyle'

// resolveLinePreset is the ONE preset bundle both drawing surfaces (Lage map + Plan whiteboard)
// apply — this pins the coercion so they can't drift. The default presets are the app's stock
// freihand / pfeil / rettungsachse (appConfig.drawing.linePresets).
describe('resolveLinePreset', () => {
  it('clears arrow/marker/distance for Freihand (empty flags → undefined, not false/"")', () => {
    // switching back to Freihand must REMOVE a previous preset's arrow/marker, not persist falsy noise
    expect(resolveLinePreset('freihand')).toEqual({
      arrow: undefined,
      marker: undefined,
      showDistance: undefined,
      dashed: undefined,
    })
  })

  it('sets the arrow for Pfeil and leaves marker/distance cleared', () => {
    const p = resolveLinePreset('pfeil')
    expect(p.arrow).toBe(true)
    expect(p.marker).toBeUndefined()
    expect(p.showDistance).toBeUndefined()
    expect(p.dashed).toBe(false)
  })

  it('carries the R marker + dash for Rettungsachse', () => {
    const p = resolveLinePreset('rettungsachse')
    expect(p.arrow).toBe(true)
    expect(p.marker).toBe('R')
    expect(p.dashed).toBe(true)
  })

  it('falls back to the current dash when the preset does not own dashed (Freihand)', () => {
    // Freihand carries no `dashed`, so the line/dock value is kept…
    expect(resolveLinePreset('freihand', true).dashed).toBe(true)
    expect(resolveLinePreset('freihand', false).dashed).toBe(false)
    // …but a preset that DOES own dashed wins over the current value
    expect(resolveLinePreset('rettungsachse', false).dashed).toBe(true)
    expect(resolveLinePreset('pfeil', true).dashed).toBe(false)
  })

  it('defaults unknown ids to the first preset (Freihand)', () => {
    expect(resolveLinePreset('nope')).toEqual(resolveLinePreset('freihand'))
  })
})

// The vertex-handle cap. Before 25.08. it was a hard switch — a line above MAX_VERTEX_HANDLES
// points showed NO grips at all, so a 66-point freehand «Zeichnung» could not be reshaped. These
// pin the graceful version: a subset that keeps both ends, never crowds two pads together, and
// grows as the surface is zoomed in (the input is pixel space, so zoom IS the spacing).
describe('vertexHandleIndices', () => {
  /** a straight horizontal path of `n` points, `step` px apart */
  const path = (n: number, step: number): [number, number][] =>
    Array.from({ length: n }, (_, i) => [i * step, 0])

  it('leaves an ordinary node line completely untouched', () => {
    expect(vertexHandleIndices(path(6, 40))).toEqual([0, 1, 2, 3, 4, 5])
    // exactly at the budget is still every point
    expect(vertexHandleIndices(path(MAX_VERTEX_HANDLES, 40))).toHaveLength(MAX_VERTEX_HANDLES)
  })

  it('still offers handles above the budget (the regression) — ends included', () => {
    const idx = vertexHandleIndices(path(66, 40))
    expect(idx.length).toBeGreaterThan(1)
    expect(idx.length).toBeLessThanOrEqual(MAX_VERTEX_HANDLES)
    expect(idx[0]).toBe(0)
    expect(idx[idx.length - 1]).toBe(65)
  })

  it('never shows two pads closer than the minimum spacing', () => {
    const px = path(66, 40)
    const idx = vertexHandleIndices(px)
    for (let k = 1; k < idx.length - 1; k++) {
      const [ax] = px[idx[k - 1]], [bx] = px[idx[k]]
      expect(Math.abs(bx - ax)).toBeGreaterThanOrEqual(HANDLE_MIN_SPACING_PX)
    }
  })

  it('densifies as the surface is zoomed in and thins as it is zoomed out', () => {
    // the SAME 66-point stroke, drawn at three zoom levels (px spacing 2 / 10 / 40)
    const far = vertexHandleIndices(path(66, 2)).length
    const mid = vertexHandleIndices(path(66, 10)).length
    const near = vertexHandleIndices(path(66, 40)).length
    expect(far).toBeLessThan(mid)
    expect(mid).toBeLessThan(near)
    expect(near).toBeLessThanOrEqual(MAX_VERTEX_HANDLES)
  })

  it('caps a long line at the budget even when every point is far apart', () => {
    expect(vertexHandleIndices(path(500, 500)).length).toBeLessThanOrEqual(MAX_VERTEX_HANDLES)
  })

  it('returns ascending, unique indices', () => {
    const idx = vertexHandleIndices(path(200, 3))
    expect([...new Set(idx)]).toEqual(idx)
    expect([...idx].sort((a, b) => a - b)).toEqual(idx)
  })
})

describe('evenIndices', () => {
  it('is identity below the count and keeps both ends above it', () => {
    expect(evenIndices(5, 10)).toEqual([0, 1, 2, 3, 4])
    const idx = evenIndices(100, 5)
    expect(idx).toEqual([0, 25, 50, 74, 99])
  })

  it('handles the degenerate sizes', () => {
    expect(evenIndices(0)).toEqual([])
    expect(evenIndices(1)).toEqual([0])
  })
})

/**
 * Freihand-Vereinfachung — was beim Loslassen eines Strichs passiert (useMapCanvasGestures ·
 * Whiteboard.inkUp). Ein von Hand gezogener Schlauch kommt als ~66 Punkte an: ein Sample pro
 * Pointer-Event, mit Zittern auf jedem und dichten Klumpen dort, wo der Finger kurz zögert –
 * also fast immer am Anfang und am Ende. Als Geometrie ist das brauchbar, als BEDIENBARE Linie
 * nicht: die Knoten liegen übereinander, und keiner davon lässt sich einzeln greifen.
 */
const jitteryStroke = (): [number, number][] => {
  // ein deterministischer «Handstrich»: langes Bein, Knick, zweites Bein, ±1.5 px Zittern und
  // ease-in/ease-out-Tempo, damit an beiden Enden echte Klumpen entstehen
  let seed = 7
  const rnd = () => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed / 2147483648 - 0.5 }
  return Array.from({ length: 66 }, (_, i) => {
    const u = i / 65, s = u * u * (3 - 2 * u)
    const x = s < 0.5 ? s * 2 * 220 : 220 + (s - 0.5) * 2 * 30
    const y = s < 0.5 ? 40 + s * 2 * 20 : 60 + (s - 0.5) * 2 * 180
    return [x + rnd() * 3, y + rnd() * 3] as [number, number]
  })
}
/** Grösster Abstand eines Rohpunkts von der vereinfachten Linie — die eigentliche Zusage von RDP. */
const maxDeviation = (raw: [number, number][], kept: [number, number][]) => Math.max(...raw.map(([px, py]) => {
  let best = Infinity
  for (let i = 1; i < kept.length; i++) {
    const [ax, ay] = kept[i - 1], [bx, by] = kept[i]
    const dx = bx - ax, dy = by - ay, l2 = dx * dx + dy * dy || 1e-12
    const t = Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / l2))
    best = Math.min(best, Math.hypot(px - (ax + t * dx), py - (ay + t * dy)))
  }
  return best
}))
const polyLength = (p: [number, number][]) => p.reduce((a, _, i) => (i ? a + Math.hypot(p[i][0] - p[i - 1][0], p[i][1] - p[i - 1][1]) : 0), 0)

describe('rdpIndices — Freihand-Vereinfachung', () => {
  it('keeps the ends and everything of a line that is already sparse', () => {
    expect(rdpIndices([], 3)).toEqual([])
    expect(rdpIndices([[0, 0]], 3)).toEqual([0])
    expect(rdpIndices([[0, 0], [10, 0]], 3)).toEqual([0, 1])
    // a point sitting ON the straight run is redundant; both ends never are
    expect(rdpIndices([[0, 0], [5, 0], [10, 0]], 3)).toEqual([0, 2])
  })

  it('turns a 66-point hand-drawn stroke into a handful of grabbable nodes', () => {
    const raw = jitteryStroke()
    const kept = rdpIndices(raw, FREEHAND_SIMPLIFY_PX).map((i) => raw[i])
    expect(raw.length).toBe(66)
    expect(kept.length).toBeLessThanOrEqual(8)      // was 66 pads piled on each other
    expect(kept.length).toBeGreaterThanOrEqual(3)   // the bend survives — it IS the shape
    expect(kept[0]).toEqual(raw[0])
    expect(kept[kept.length - 1]).toEqual(raw[raw.length - 1])
  })

  it('stays within the tolerance it promises, so the drawn shape still reads true', () => {
    const raw = jitteryStroke()
    const kept = rdpIndices(raw, FREEHAND_SIMPLIFY_PX).map((i) => raw[i])
    expect(maxDeviation(raw, kept)).toBeLessThanOrEqual(FREEHAND_SIMPLIFY_PX)
    // the measured length moves a little — cutting the tremor out shortens the path. A couple of
    // percent on a 400 px stroke is the tremor, not the hose.
    expect(polyLength(kept) / polyLength(raw)).toBeGreaterThan(0.94)
    expect(polyLength(kept) / polyLength(raw)).toBeLessThanOrEqual(1)
  })

  it('trades points for tolerance monotonically — a bigger epsilon never keeps more', () => {
    const raw = jitteryStroke()
    const counts = [1, 2, 3.5, 6].map((eps) => rdpIndices(raw, eps).length)
    expect(counts).toEqual([...counts].sort((a, b) => b - a))
    expect(counts[0]).toBeGreaterThan(counts[counts.length - 1])
  })
})

// Lift-off is the only way out of a stroke that began armed on a target, so what counts as
// «went nowhere» has to be exact — nothing else stands between a mis-grab and a coupled stub.
describe('isTapStroke', () => {
  it('a single point, or none, is a tap', () => {
    expect(isTapStroke([])).toBe(true)
    expect(isTapStroke([[10, 10]])).toBe(true)
  })

  it('a fingertip wobble is a tap, however many samples it left', () => {
    const wobble: [number, number][] = [[10, 10], [12, 11], [9, 12], [11, 9], [10, 10]]
    expect(isTapStroke(wobble)).toBe(true)
  })

  it('a stroke that reached the threshold is a line', () => {
    expect(isTapStroke([[0, 0], [0, MIN_STROKE_PX]])).toBe(false)
    expect(isTapStroke([[0, 0], [0, MIN_STROKE_PX - 1]])).toBe(true)
  })

  it('measures the FURTHEST the path ever got, not where it ended', () => {
    // out past the threshold and back onto its own start: the finger did go somewhere
    expect(isTapStroke([[0, 0], [40, 0], [0, 0]])).toBe(false)
  })
})

// ── FKS chain markers ───────────────────────────────────────────────────────────────────────
// A Haltelinie and a Wasserabwurfzone are the same mechanism as «—R—»: something repeated along
// the polyline. What is new is that the repeated thing is a SHAPE, and that a shape may have to
// stand on the line — so the walk has to hand back the segment's bearing too.
describe('marker glyphs', () => {
  it('recognises a chain glyph and leaves a letter alone', () => {
    expect(markerGlyph('▲')?.fill).toBe(true)
    expect(markerGlyph('◯')?.fill).toBe(false)
    expect(markerGlyph('R')).toBeUndefined()
    expect(markerGlyph(undefined)).toBeUndefined()
  })

  // Which side the teeth face is an operational fact (they face the fire) and cannot be derived
  // from the geometry — the same line drawn the other way round is the same Haltelinie.
  it('carries both Haltelinien sides as mirror images of one tooth', () => {
    const up = markerGlyph('▲')!, down = markerGlyph('▼')!
    expect(down.path).toBe(up.path.replace('-1.05', '1.05'))
    expect([down.size, down.spacing, down.rotate]).toEqual([up.size, up.spacing, up.rotate])
  })

  // ⚠️ The teeth have to TOUCH, or the chain reads as separate triangles with the line showing
  // between them — which is what it did until 01.09. Base = 2 × 0.62 of the 2.3-unit box, scaled
  // to `size`; resizing the tooth without moving the spacing with it re-opens the gaps.
  it('spaces the teeth by their own base width, so the saw edge is continuous', () => {
    for (const key of ['▲', '▼'] as const) {
      const g = markerGlyph(key)!
      const base = (2 * 0.62 / 2.3) * g.size
      expect(g.spacing).toBeLessThanOrEqual(base)
      expect(g.spacing).toBeGreaterThan(base * 0.85) // …but not so tight they pile up
    }
  })

  it('repeats a chain at its own rhythm, not the letter rhythm', () => {
    expect(markerSpacing('▲')).toBeLessThan(markerSpacing('R'))
    expect(markerSpacing('R')).toBe(MARKER_SPACING_PX)
    expect(markerSpacing(undefined)).toBe(MARKER_SPACING_PX)
  })

  // «WT» at the one-letter rhythm read as a dotted band (09.11.2026)
  it('gives a longer letter marker room in proportion to its length', () => {
    expect(markerSpacing('WT')).toBe(2 * MARKER_SPACING_PX)
  })

  // they touch rather than sit apart — a row of separate dots is not a covered band
  it('spaces the Abwurfzone rings no further apart than they are wide', () => {
    const g = markerGlyph('◯')!
    expect(g.spacing).toBeLessThanOrEqual(g.size)
  })

  it('reports each segment’s bearing, so the teeth turn only where the line does', () => {
    const east = markerParamsAlong([[0, 0], [200, 0]], 50)
    expect(east.every((m) => m.deg === 0)).toBe(true)
    // screen y grows DOWNWARD, so a segment heading down-screen is +90°
    const south = markerParamsAlong([[0, 0], [0, 200]], 50)
    expect(south.every((m) => m.deg === 90)).toBe(true)
  })

  it('turns at the corner of an L, not before it', () => {
    const params = markerParamsAlong([[0, 0], [100, 0], [100, 100]], 40)
    const bearings = [...new Set(params.map((m) => m.deg))]
    expect(bearings).toEqual([0, 90])
  })
})

describe('arrowEndIndices', () => {
  it('hollows the END vertex of an arrowed line', () => {
    expect(arrowEndIndices({ kind: 'line', arrow: true }, 4)).toEqual([3])
    expect(arrowEndIndices({ kind: 'line', arrow: true }, 2)).toEqual([1])
  })
  it('leaves an ordinary line alone', () => {
    expect(arrowEndIndices({ kind: 'line' }, 4)).toEqual([])
    expect(arrowEndIndices({ kind: 'line', arrow: false }, 4)).toEqual([])
  })
  it('never rings a closed Fläche or a line with no bearing', () => {
    // an area draws no head at all (both renderers filter it out), and neither does a 1-point line
    expect(arrowEndIndices({ kind: 'area', arrow: true }, 5)).toEqual([])
    expect(arrowEndIndices({ kind: 'line', arrow: true }, 1)).toEqual([])
    expect(arrowEndIndices({ kind: 'line', arrow: true }, 0)).toEqual([])
  })
})
