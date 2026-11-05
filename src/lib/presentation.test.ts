import { afterEach, describe, expect, it, vi } from 'vitest'
import { addRing, initials, liveRings, nextFollow, NOT_PRESENTING, personTone, RING_MS, ringsOn, throttle, type Follow, type PointerAt, type Ring } from './presentation'

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

const at: PointerAt = { surface: 'map', lng: 7.5, lat: 47.5, plan_id: null, page: null, x: null, y: null, floor: null }
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
