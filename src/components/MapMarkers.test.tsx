// @vitest-environment jsdom
/**
 * The Formen on the Karte: what a finger can actually land on, and what a selected one shows.
 *
 * jsdom lays nothing out, so the pad's own pixels are CSS (03-map.css · .shape-glyph::before).
 * What is pinned here is the wiring that decides WHICH box the pad hugs — a Form opts out of the
 * marker's square long-side pad, and the box left for the pad is the shape's own, per axis.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render } from '@testing-library/react'
import type { ReactNode } from 'react'
import { appConfig } from '../config/appConfig'
import type { Entity, LngLat } from '../types'

// the two numbers a Marker actually places a glyph with — the coordinate it hangs on and the
// screen-px offset off it — surfaced as data attributes, because the docked Trupp slot is
// expressed in exactly those (lib/docking · dockSlotOffset)
vi.mock('react-map-gl/maplibre', () => ({
  Marker: ({ children, longitude, latitude, offset }: { children: ReactNode; longitude?: number; latitude?: number; offset?: [number, number] }) => (
    <div data-testid="marker" data-at={`${longitude},${latitude}`} data-offset={offset ? offset.join(',') : ''}>{children}</div>
  ),
}))

import { MapMarkers } from './MapMarkers'
import { DOCK_SLOT_STEP_PX } from '../lib/docking'
import { TEAM_DOT_PX } from '../lib/mapView'

afterEach(cleanup)

const at: LngLat = [7.6, 47.5]
const shape = (id: string, extra: Partial<Entity>): Entity =>
  ({ id, kind: 'shape', layer: 'lage', coord: at, shape: 'square', sizeM: 45, ...extra }) as Entity
// a run of 300 m, stored the way both surfaces store one (lib/shapes · rotationBox)
const rotation = shape('rot', { shape: 'rotation', sizeM: 345, aspect: 0.13, rotation: 40 })
const rechteck = shape('sq', { shape: 'square', sizeM: 45 })

const show = (entities: Entity[], selectedId: string | null = null) => render(
  <MapMarkers entities={entities} byName={{}} isVisible={() => true} selectedId={selectedId}
    zoom={18} draggable project={() => ({ x: 0, y: 0 })} unproject={() => at} setDragPan={() => {}}
    onSelect={() => {}} onMarkerDragStart={() => {}} onMarkerMove={() => {}} onMarkerDragEnd={() => {}}
    onDelete={() => {}} onShapeTransform={() => {}} />,
)
describe('what a finger lands on when it reaches for a Form', () => {
  // ⚠️ THE «Klickfläche der Rotation» regression (01.09.). The marker's own pad is ONE square of
  // max(width, height): on a Rechteck that is its box, on a Rotation it is a square as wide as
  // the run is long — hundreds of px of hit area over empty ground above and below the loop.
  // A Form's pad follows its own box instead, which is why the marker's square is switched off.
  it('gives a Form no square long-side pad — its hit box is its own box', () => {
    const { container } = show([rotation])
    const marker = container.querySelector('.marker')!
    expect(marker.className).toContain('marker-shape')
  })

  it('…while a placed symbol keeps the square pad it was written for', () => {
    const { container } = show([{ id: 's1', kind: 'symbol', layer: 'lage', coord: at, symbol: 'Feuer' } as Entity])
    expect(container.querySelector('.marker')!.className).not.toContain('marker-shape')
  })

  /**
   * ⚠️ 02.09.: a selected Form wears NO halo and its body drags nothing. It is selected to be
   * worked with its own precise grips — the ends, the axes, the cage — and moved from the fixed
   * selection bar's ✥, dragged for the small adjustment or armed for the whole surface. A 104px
   * ring around a metres-true shape said nothing those grips do not, over the ground they sit on;
   * and a body drag meant a mis-aimed reach for an end grip nudged the whole loop instead.
   */
  it('gives a selected Form no halo, and no body drag either', () => {
    const onMarkerDragStart = vi.fn()
    const onMarkerMove = vi.fn()
    const { container } = render(
      <MapMarkers entities={[rechteck]} byName={{}} isVisible={() => true} selectedId="sq"
        zoom={18} draggable project={() => ({ x: 0, y: 0 })} unproject={() => at} setDragPan={() => {}}
        onSelect={() => {}} onMarkerDragStart={onMarkerDragStart} onMarkerMove={onMarkerMove}
        onMarkerDragEnd={() => {}} onDelete={() => {}} onShapeTransform={() => {}} />,
    )
    expect(container.querySelector('.sel-halo')).toBeNull()
    const glyph = container.querySelector('.shape-glyph')!
    fireEvent.pointerDown(glyph, { pointerId: 1, isPrimary: true, pointerType: 'mouse', clientX: 100, clientY: 100 })
    fireEvent.pointerMove(window, { pointerId: 1, clientX: 190, clientY: 160 })
    fireEvent.pointerUp(window, { pointerId: 1, clientX: 190, clientY: 160 })
    expect(onMarkerDragStart).not.toHaveBeenCalled()
    expect(onMarkerMove).not.toHaveBeenCalled()
  })

  it('…and a placed symbol keeps both, because its body IS its move path', () => {
    const symbol = { id: 's1', kind: 'symbol', layer: 'lage', coord: at, symbol: 'Feuer' } as Entity
    const onMarkerMove = vi.fn()
    const { container } = render(
      <MapMarkers entities={[symbol]} byName={{}} isVisible={() => true} selectedId="s1"
        zoom={18} draggable project={() => ({ x: 0, y: 0 })} unproject={() => at} setDragPan={() => {}}
        onSelect={() => {}} onMarkerDragStart={() => {}} onMarkerMove={onMarkerMove}
        onMarkerDragEnd={() => {}} onDelete={() => {}} onShapeTransform={() => {}} />,
    )
    expect(container.querySelector('.sel-halo')).toBeTruthy()
    const ts = container.querySelector('.marker')!
    fireEvent.pointerDown(ts, { pointerId: 1, isPrimary: true, pointerType: 'mouse', clientX: 100, clientY: 100 })
    fireEvent.pointerMove(window, { pointerId: 1, clientX: 190, clientY: 160 })
    fireEvent.pointerUp(window, { pointerId: 1, clientX: 190, clientY: 160 })
    expect(onMarkerMove).toHaveBeenCalled()
  })

  // the box the pad hugs: a Rechteck's is square, a Rotation's is long and flat — and it is the
  // SAME element on both, so one rule covers both kinds and both surfaces
  it('leaves each kind its own two-sided box for the pad to hug', () => {
    const { container } = show([rechteck])
    const sq = container.querySelector<HTMLElement>('.shape-glyph')!
    expect(parseFloat(sq.style.height)).toBeCloseTo(parseFloat(sq.style.width), 6)
    cleanup()
    const { container: c2 } = show([rotation])
    const rot = c2.querySelector<HTMLElement>('.shape-glyph')!
    expect(parseFloat(rot.style.height)).toBeCloseTo(parseFloat(rot.style.width) * 0.13, 3)
    // …and it turns with the run, so the pad drawn inside it does too
    expect(rot.style.transform).toContain('rotate(40deg)')
  })
})

// ── the edit chrome of a selected Form (01.09. vocabulary) ───────────────────────────────────
// On the object itself only GEOMETRY grips, and every one of them from the one blue family —
// the near-black ink fill these wore is gone. Moving, turning and deleting the whole thing are
// the fixed SelectionBar's (MapView), which is why the Rotation has nothing but its two ends.
describe('what a selected Form shows on the Karte', () => {
  const S = appConfig.copy.shapes
  const noInlineFill = (g: Element) => expect((g as HTMLElement).style.background).toBe('')

  it('gives a Rotation its two end grips and nothing else', () => {
    const { container } = show([rotation], 'rot')
    const ends = container.querySelectorAll('.handle.shape-end')
    expect(ends).toHaveLength(2)
    for (const g of ends) {
      expect(g.getAttribute('aria-label')).toBe(S.endHint)
      // its press-and-hold IS the gesture, so the global hold-tooltip must not claim the release
      expect(g.hasAttribute('data-holdaction')).toBe(true)
      noInlineFill(g)
    }
    // each end sets the run's length AND its bearing, so there is nothing for a knob or a size
    // grip to say — and no stem to tether one by
    expect(container.querySelector('.shape-stem')).toBeNull()
    expect(container.querySelector('.shape-rotate')).toBeNull()
    expect(container.querySelector('.shape-resize, .shape-width')).toBeNull()
  })

  it('…and a Rechteck one grip per axis, from the same family — and no knob (the bar turns it)', () => {
    const { container } = show([rechteck], 'sq')
    expect(container.querySelector('.shape-rotate')).toBeNull()
    expect(container.querySelector('.shape-stem')).toBeNull()
    expect(container.querySelector('.shape-resize.shape-axis-x')).toBeTruthy()
    expect(container.querySelector('.shape-width.shape-axis-y')).toBeTruthy()
    for (const g of container.querySelectorAll('.handle')) noInlineFill(g)
  })
})

/**
 * A Trupp joined to a Leitung on the Karte. «Ein Etikett» (15.09.2026) put the hose's NUMBER into
 * the marker; since 11.10.2026 (owner: «on the map the trupps are numbered – which we don't
 * need … just the name») the marker is the Gebäude chip's again — the name, the hose's ink on the
 * coupling, no number field — and the hose's own end tag says which Leitung.
 *
 * ⚠️ The order is cap/dot · Name · #N, with the coupling out of flow: everything the strip grows
 * hangs off the RIGHT of the dot, because the dot is the coordinate.
 */
describe('a Trupp marker that is joined, loose, or docked', () => {
  const team = (extra: Partial<Entity> = {}): Entity =>
    ({ id: 'e1', kind: 'team', layer: 'lage', coord: at, label: 'Frei Nina', truppId: 'T1', ...extra }) as Entity
  const hydrant = { id: 'h1', kind: 'symbol', layer: 'lage', coord: at, label: 'Hydrant' } as Entity
  const trupps = [{ id: 'T1', name: 'Frei Nina', no: 4, status: 'aktiv' }] as never
  const badge = (over = {}) => new Map([['e1', { lineId: 'd1', lineNo: 2, color: '#1f6feb', tone: 'idle' as const, coupled: true, ...over }]])

  const showTeam = (entities: Entity[], selectedId: string | null, teamLines?: Map<string, never>) => render(
    <MapMarkers entities={entities} byName={{}} isVisible={() => true} selectedId={selectedId}
      zoom={18} draggable project={() => ({ x: 0, y: 0 })} unproject={() => at} setDragPan={() => {}}
      onSelect={() => {}} onMarkerDragStart={() => {}} onMarkerMove={() => {}} onMarkerDragEnd={() => {}}
      onDelete={() => {}} onShapeTransform={() => {}} trupps={trupps}
      teamLines={teamLines as never} onTeamUnlink={() => {}} />,
  )

  // 11.10.2026: the Leitung number and the coupling stub left the resting marker
  it('a joined Trupp\'s resting marker is its name alone – no Leitung number', () => {
    for (const b of [badge(), badge({ coupled: false })]) {
      const { container, unmount } = showTeam([team()], null, b as never)
      expect(container.querySelector('.team-dot')?.textContent).not.toContain('2')
      expect(container.querySelector('.team-dot b')?.textContent).toBe('Frei Nina')
      unmount()
    }
  })

  it('wears no glyph on the strip – the bond shows on the host tile alone (15.09.)', () => {
    const { container } = showTeam([team({ dockedTo: 'h1' }), hydrant], null)
    expect(container.querySelector('.team-dot .team-link')).toBeNull()
    // …and never the words on the map (they stay on the Atemschutz card)
    expect(container.textContent).not.toContain('bei «Hydrant»')
  })

  it('the selected pill is the Gebäude chip\'s: joined ink, the name, no number field', () => {
    const { container } = showTeam([team({ dockedTo: 'h1' }), hydrant], 'e1', badge() as never)
    const pill = container.querySelector('.wb-resource-pill')!
    expect(pill.className).toContain('joined')
    expect(pill.querySelector('.wb-resource-name b')?.textContent).toBe('Frei Nina')
    // no «#N» on the map – the number lives on the card only (14.09.)
    expect(pill.querySelector('.trupp-no')).toBeNull()
    // the bond wears ONE glyph, on the host tile – none on the pill (15.09.)
    expect(pill.querySelector('.team-link')).toBeNull()
    // the cap is the coordinate: nothing may be laid out in front of it
    expect(pill.querySelector(':scope > *')?.className).toBe('wb-resource-cap')
  })

  it('offers one «Lösen» glyph on a joined pill – and nothing to break when loose', () => {
    const { container } = showTeam([team()], 'e1', badge() as never)
    const btn = container.querySelector('.wb-pa-unlink')
    expect(btn?.getAttribute('aria-label')).toBe(appConfig.copy.contextPanel.dockedRelease)
    expect(container.querySelector('.wb-pa-join-lbl')).toBeNull()
    expect(showTeam([team()], 'e1').container.querySelector('.wb-pa-unlink')).toBeNull()
  })
})

/**
 * Andocken, von BEIDEN Seiten (Bastian, 15.09.2026): «add the same attachment ui to symbols too
 * and always show the trupp at the same clean place».
 *
 * A Trupp marker docked onto a symbol is drawn at ONE place — the host tile's bottom-left corner,
 * mirroring the storey badge top-right — whatever corner of the tile the hand let go over; and the
 * host wears the same `link` glyph the marker does, so the bond reads from either end. The stored
 * coordinate is untouched: only the RENDERED position snaps (lib/docking · dockSlotOffset).
 */
describe('a symbol carrying docked Trupps, and the Trupps on its corner', () => {
  const host = { id: 'h1', kind: 'symbol', layer: 'lage', coord: [7.61, 47.51], symbol: 'Feuer', label: 'Hydrant' } as Entity
  const docked = (id: string, label: string): Entity =>
    ({ id, kind: 'team', layer: 'lage', coord: [7.9, 47.9], label, truppId: id, dockedTo: 'h1' }) as Entity

  const show2 = (entities: Entity[]) => render(
    <MapMarkers entities={entities} byName={{}} isVisible={() => true} selectedId={null}
      zoom={18} draggable project={() => ({ x: 0, y: 0 })} unproject={() => at} setDragPan={() => {}}
      onSelect={() => {}} onMarkerDragStart={() => {}} onMarkerMove={() => {}} onMarkerDragEnd={() => {}}
      onDelete={() => {}} onShapeTransform={() => {}} trupps={[]} />,
  )
  const markerOf = (c: HTMLElement, sel: string) => c.querySelector(sel)!.closest('[data-testid="marker"]')!

  it('wears the link glyph on the host tile, titled with the crews it carries', () => {
    const { container } = show2([host, docked('e1', 'Frei Nina')])
    const badge = container.querySelector('.sym-dock')!
    expect(badge).toBeTruthy()
    expect(badge.getAttribute('title')).toBe('Frei Nina')
    // the SAME glyph the marker wears — one mark for one bond, read from either end
    expect(badge.querySelector('use')?.getAttribute('href')).toBe('#link')
  })

  it('names every crew on the badge when several are docked, and nothing when none are', () => {
    const { container } = show2([host, docked('e1', 'Frei Nina'), docked('e2', 'Meier Hans')])
    expect(container.querySelector('.sym-dock')?.getAttribute('title')).toBe('Frei Nina · Meier Hans')
    cleanup()
    expect(show2([host]).container.querySelector('.sym-dock')).toBeNull()
  })

  it('draws the docked marker on the HOST\'s point, not on its own', () => {
    const { container } = show2([host, docked('e1', 'Frei Nina')])
    const team = markerOf(container, '.team-dot')
    expect(team.getAttribute('data-at')).toBe('7.61,47.51')
    // …and its stored coordinate is untouched: it stands back on it the moment the bond is let go
    expect(docked('e1', 'Frei Nina').coord).toEqual([7.9, 47.9])
  })

  it('stacks several of them DOWNWARDS, each centred under the tile, a fixed pitch apart', () => {
    const { container } = show2([host, docked('e1', 'Frei Nina'), docked('e2', 'Meier Hans')])
    const off = [...container.querySelectorAll('.team-dot')]
      .map((d) => d.closest('[data-testid="marker"]')!.getAttribute('data-offset')!.split(',').map(Number))
    expect(off).toHaveLength(2)
    expect(off[1][1] - off[0][1]).toBe(DOCK_SLOT_STEP_PX)
    expect(off[0][0]).toBeLessThan(0)                 // the dot left of the tile's centre (the strip is centred)
    expect(off[0][1]).toBeGreaterThan(0)              // …and under its BOTTOM
  })

  it('an undocked marker keeps its own point and takes no slot', () => {
    const loose = { ...docked('e1', 'Frei Nina'), dockedTo: undefined } as Entity
    const { container } = show2([host, loose])
    const team = markerOf(container, '.team-dot')
    expect(team.getAttribute('data-at')).toBe('7.9,47.9')
    expect(team.getAttribute('data-offset')).toBe(`${-TEAM_DOT_PX / 2},0`)
  })
})
