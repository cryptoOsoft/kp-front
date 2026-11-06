import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  addRing, addStroke, capPoints, edgeArrow, fitScale, fitZoom, initials, liveRings, liveStrokes, nextFollow, NOT_PRESENTING, personTone, placeTags,
  RING_MS, ringsOn, strokesOn, tagBox, throttle, type Follow, type PointerAt, type Ring, type Stroke,
} from './presentation'

const run = (events: Parameters<typeof nextFollow>[1][], from: Follow = NOT_PRESENTING) => events.reduce(nextFollow, from)
const server = (id: string | null, mine = false) => ({ type: 'server' as const, id, mine })

describe('the follow state machine', () => {
  it('asks a device to follow, never joins it by itself', () => {
    expect(run([server('p1')])).toEqual({ kind: 'invited', id: 'p1' })
    expect(run([server('p1'), server('p1')])).toEqual({ kind: 'invited', id: 'p1' })
  })

  it('follows, detaches on a hand-made move, and comes back with «Wieder folgen»', () => {
    const following = run([server('p1'), { type: 'follow' }])
    expect(following.kind).toBe('following')
    const away = nextFollow(following, { type: 'moved' })
    expect(away).toEqual({ kind: 'detached', id: 'p1' })
    // the poll goes on while detached – it stays detached
    expect(nextFollow(away, server('p1'))).toEqual(away)
    expect(nextFollow(away, { type: 'follow' }).kind).toBe('following')
  })

  it('a move while not following changes nothing', () => {
    expect(run([server('p1'), { type: 'moved' }]).kind).toBe('invited')
  })

  it('✕ leaves the room but keeps the invitation', () => {
    expect(run([server('p1'), { type: 'follow' }, { type: 'leave' }])).toEqual({ kind: 'invited', id: 'p1' })
  })

  it('the end of the presentation ends everything', () => {
    expect(run([server('p1'), { type: 'follow' }, server(null)])).toEqual(NOT_PRESENTING)
  })

  it('a new presentation (a takeover) starts over at the invitation', () => {
    expect(run([server('p1'), { type: 'follow' }, server('p2')])).toEqual({ kind: 'invited', id: 'p2' })
    // …and the presenter who was taken over is asked like everybody else
    expect(run([server('p1', true), server('p2')])).toEqual({ kind: 'invited', id: 'p2' })
  })

  it('the presenter is presenting, whatever it was before', () => {
    expect(run([server('p1'), { type: 'follow' }, server('p2', true)])).toEqual({ kind: 'presenting', id: 'p2' })
    expect(run([server('p2', true), { type: 'moved' }, { type: 'leave' }]).kind).toBe('presenting')
  })
})

const at: PointerAt = { surface: 'map', lng: 7.5, lat: 47.5, plan_id: null, page: null, x: null, y: null, floor: null, anchor: null }
const ring = (key: string, client: string, born: number, where: PointerAt = at): Ring => ({ key, client, name: client, link: false, at: where, born })

describe('pointer rings', () => {
  it('fade out after RING_MS', () => {
    const rings = [ring('a', 'c1', 0), ring('b', 'c2', 1000)]
    expect(liveRings(rings, RING_MS - 1).map((r) => r.key)).toEqual(['a', 'b'])
    expect(liveRings(rings, RING_MS + 1).map((r) => r.key)).toEqual(['b'])
  })

  it('keep at most three per person, dropping their oldest', () => {
    let rings: Ring[] = []
    for (let i = 0; i < 5; i++) rings = addRing(rings, ring(`k${i}`, 'c1', i), i)
    rings = addRing(rings, ring('other', 'c2', 5), 5)
    expect(rings.map((r) => r.key)).toEqual(['k2', 'k3', 'k4', 'other'])
  })

  it('stand only on the surface (and Tafel page) they were tapped on', () => {
    const onPlan = (plan: string, page: string | null): PointerAt => ({ ...at, surface: 'plan', lng: null, lat: null, plan_id: plan, page, x: 0.5, y: 0.5, floor: 0 })
    const rings = [ring('m', 'c', 0), ring('p', 'c', 0, onPlan('plan-1', null)), ring('t', 'c', 0, onPlan('tafel', 'skizze'))]
    expect(ringsOn(rings, { surface: 'map' }).map((r) => r.key)).toEqual(['m'])
    expect(ringsOn(rings, { surface: 'plan', planId: 'plan-1' }).map((r) => r.key)).toEqual(['p'])
    expect(ringsOn(rings, { surface: 'plan', planId: 'tafel', page: 'skizze' }).map((r) => r.key)).toEqual(['t'])
    expect(ringsOn(rings, { surface: 'plan', planId: 'tafel', page: 'fm-1' })).toEqual([])
  })
})

describe('name tags of rings close together', () => {
  const overlap = (a: ReturnType<typeof tagBox>, b: ReturnType<typeof tagBox>) => a.x0 < b.x1 && b.x0 < a.x1 && a.y0 < b.y1 && b.y0 < a.y1

  it('far apart, every tag stands on the right', () => {
    const tags = placeTags([{ key: 'a', x: 100, y: 100, label: 'Bastian' }, { key: 'b', x: 600, y: 400, label: 'Sandra Meier · Link' }])
    expect(tags).toEqual({ a: { side: 'right', dy: 0 }, b: { side: 'right', dy: 0 } })
  })

  it('the newer of two neighbours moves, and no tag covers another or a ring (the 05.11. shots)', () => {
    // «Führungsunterstützung» at the presenter's tap, «Sandra Meier · Link» a finger to the left and below
    const rings = [
      { key: 'fu', x: 640, y: 300, label: 'Führungsunterstützung' },
      { key: 'sm', x: 595, y: 318, label: 'Sandra Meier · Link' },
      { key: 'x', x: 610, y: 290, label: 'Gast · Link' },
    ]
    const tags = placeTags(rings)
    expect(tags.fu).toEqual({ side: 'right', dy: 0 }) // the oldest keeps its place
    const boxes = rings.map((r) => tagBox(r, tags[r.key]))
    for (let i = 0; i < boxes.length; i++) {
      for (let j = i + 1; j < boxes.length; j++) expect(overlap(boxes[i], boxes[j])).toBe(false)
      for (let j = 0; j < rings.length; j++) {
        if (j === i) continue
        const c = { x0: rings[j].x - 22, y0: rings[j].y - 22, x1: rings[j].x + 22, y1: rings[j].y + 22 }
        expect(overlap(boxes[i], c)).toBe(false)
      }
    }
  })
})

describe('the view throttle', () => {
  afterEach(() => vi.useRealTimers())

  it('sends the first view at once, then at most one per interval – and always the last', () => {
    vi.useFakeTimers()
    const sent: number[] = []
    const t = throttle<number>(150, (v) => sent.push(v), () => Date.now())
    t.push(1)
    t.push(2)
    t.push(3)
    expect(sent).toEqual([1])
    vi.advanceTimersByTime(150)
    expect(sent).toEqual([1, 3])
    vi.advanceTimersByTime(1000)
    expect(sent).toEqual([1, 3])
  })

  it('drops a pending send on cancel (the presentation ended)', () => {
    vi.useFakeTimers()
    const sent: number[] = []
    const t = throttle<number>(150, (v) => sent.push(v), () => Date.now())
    t.push(1)
    t.push(2)
    t.cancel()
    vi.advanceTimersByTime(500)
    expect(sent).toEqual([1])
  })
})

describe('names and colours', () => {
  it('initials', () => {
    expect(initials('Bastian')).toBe('BA')
    expect(initials('Sandra Meier')).toBe('SM')
    expect(initials('  ')).toBe('?')
  })

  it('the presenter wears the first colour, everybody else a stable other one', () => {
    expect(personTone('pc1', 'pc1')).toBe(1)
    const t = personTone('pc2', 'pc1')
    expect(t).toBeGreaterThanOrEqual(2)
    expect(t).toBeLessThanOrEqual(6)
    expect(personTone('pc2', 'pc1')).toBe(t)
  })
})

describe('lines', () => {
  const line = (key: string, client: string, born: number, done: boolean, on: Partial<Stroke['line']> = {}): Stroke => ({
    key, client, name: client, link: false, born,
    line: { id: key, surface: 'map', plan_id: null, page: null, floor: null, anchor: null, points: [[0, 0]], done, ...on },
  })

  it('a newer update of a line replaces it; a done line fades like a ring, one being drawn stays', () => {
    const drawn = addStroke(addStroke([], line('a', 'c1', 0, false), 0), line('a', 'c1', 100, true), 100)
    expect(drawn).toHaveLength(1)
    expect(drawn[0].line.done).toBe(true)
    expect(liveStrokes(drawn, 100 + RING_MS - 1)).toHaveLength(1)
    expect(liveStrokes(drawn, 100 + RING_MS + 1)).toHaveLength(0)
    expect(liveStrokes([line('b', 'c1', 0, false)], RING_MS * 2)).toHaveLength(1)
  })

  it('a form page\'s lines stay on that page, the Skizze\'s on the Skizze', () => {
    const page = line('p', 'c1', 0, true, { surface: 'page', plan_id: 'tafel', page: 'ef' })
    const skizze = line('s', 'c1', 0, true, { surface: 'plan', plan_id: 'tafel', page: 'skizze' })
    expect(strokesOn([page, skizze], { surface: 'page', planId: 'tafel', page: 'ef' }).map((x) => x.key)).toEqual(['p'])
    expect(strokesOn([page, skizze], { surface: 'page', planId: 'tafel', page: 'pz' })).toEqual([])
    expect(strokesOn([page, skizze], { surface: 'plan', planId: 'tafel', page: 'skizze' }).map((x) => x.key)).toEqual(['s'])
  })

  it('a long scribble is simplified to the cap and keeps its ends and its corner', () => {
    const pts = [...Array.from({ length: 300 }, (_, i) => [i, Math.sin(i) * 0.01]), ...Array.from({ length: 300 }, (_, i) => [300, i])]
    const out = capPoints(pts, 120)
    expect(out.length).toBeLessThanOrEqual(120)
    expect(out[0]).toEqual([0, 0])
    expect(out[out.length - 1]).toEqual([300, 299])
    expect(out.some(([x, y]) => x >= 298 && y <= 2)).toBe(true) // the corner
    expect(capPoints([[1, 2], [3, 4]])).toEqual([[1, 2], [3, 4]])
  })
})

describe('fitting the presenter\'s section', () => {
  it('a portrait phone following a laptop zooms out until the whole width fits', () => {
    // 1200 px wide at zoom 17 into 390 px: a bit more than 1.6 zoom steps out
    expect(fitZoom(17, { w: 1200, h: 800 }, { w: 390, h: 700 })).toBeCloseTo(17 + Math.log2(390 / 1200))
    expect(fitZoom(17, { w: 1200, h: 800 }, { w: 2400, h: 1600 })).toBeCloseTo(18)
    expect(fitZoom(17, { w: 0, h: 800 }, { w: 390, h: 700 })).toBe(17)
  })

  it('on a plan the follower shows the presenter\'s extent whole', () => {
    // the presenter sees half the board's width; the follower's board is 1000 px wide fitted
    const s = fitScale({ w: 0.5, h: 0.4 }, { w: 300, h: 600 }, { w: 1000, h: 800 })!
    expect(0.5 * 1000 * s).toBeLessThanOrEqual(300 + 1e-9)
    expect(0.4 * 800 * s).toBeLessThanOrEqual(600 + 1e-9)
    expect(fitScale({ w: 0, h: 1 }, { w: 1, h: 1 }, { w: 1, h: 1 })).toBeNull()
  })

  it('a mark outside the free area gets an arrow on the edge, pointing at it', () => {
    const view = { left: 0, top: 0, right: 400, bottom: 800 }
    expect(edgeArrow({ x: 200, y: 400 }, view)).toBeNull()
    const right = edgeArrow({ x: 1000, y: 400 }, view, 20)!
    expect(right).toEqual({ x: 380, y: 400, angle: 0 })
    const below = edgeArrow({ x: 200, y: 2000 }, view, 20)!
    expect(below.y).toBe(780)
    expect(below.angle).toBe(90)
  })
})

describe('a tag at the surface\'s edge', () => {
  it('goes to the left when the right would leave the surface', () => {
    const tags = placeTags([{ key: 'a', x: 370, y: 100, label: 'Führungsunterstützung' }], 390)
    expect(tags.a.side).toBe('left')
    expect(placeTags([{ key: 'b', x: 50, y: 100, label: 'Sandra' }], 390).b.side).toBe('right')
  })
})
