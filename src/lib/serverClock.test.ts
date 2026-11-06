import { readFileSync } from 'node:fs'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  isFreshSampleSource, noteServerTime, resetServerClock, serverClockOffsetMs, serverNow, serverNowIso,
  setClockSourceForTests,
} from './serverClock'

// The contact clock is `now − lastContactTime`, and both halves used to be device-local. A phone
// six seconds ahead of the PC therefore showed the same Trupp six seconds younger — constantly,
// on the one surface where a clock reading short is a safety failure. These lock the correction
// AND its guarantees: it never moves a running clock backwards on one answer's word, a cached
// answer cannot move it at all (Feueralarm 23.09.2026), and it is a no-op offline.

const iso = (ms: number) => new Date(ms).toISOString()
const HOUR = 3_600_000
const DAY = 24 * HOUR

/** A device and a server, driven by hand. `wall` is the device clock (can be set, keeps running
 *  in sleep), `mono` the monotonic clock (cannot be set, stops in sleep), `truth` the server's. */
class Sim {
  constructor(public truth: number, public wall: number, public mono = 0) {}
  advance(ms: number) { this.truth += ms; this.wall += ms; this.mono += ms }
  sleep(ms: number) { this.truth += ms; this.wall += ms }
  stepDevice(ms: number) { this.wall += ms }
  /** a fresh round trip: the server stamps `out` ms after the send, the answer lands `back` later */
  fresh(out: number, back: number) {
    const sent = this.wall
    this.advance(out)
    const stamp = this.truth
    this.advance(back)
    noteServerTime(iso(stamp), this.wall, sent)
  }
  /** a replayed cache entry: answered in `rtt` ms, carrying the header of `ageMs` ago */
  cached(ageMs: number, rtt = 5) {
    const sent = this.wall
    this.advance(rtt)
    noteServerTime(iso(this.truth - ageMs), this.wall, sent)
  }
  err() { return serverNow() - this.truth }
}

let sim: Sim
function start(truth: number, deviceAheadMs: number) {
  sim = new Sim(truth, truth + deviceAheadMs)
  setClockSourceForTests({ wall: () => sim.wall, mono: () => sim.mono })
}

beforeEach(() => start(Date.parse('2026-09-23T17:00:00Z'), 6_000))
afterEach(() => { resetServerClock(); setClockSourceForTests(); vi.restoreAllMocks(); vi.unstubAllGlobals() })

describe('serverClock', () => {
  it.each([true, false])('uses the actual default clock sources (monotonic API available: %s)', (monotonic) => {
    setClockSourceForTests()
    vi.spyOn(Date, 'now').mockReturnValue(1_006_000)
    if (monotonic) vi.spyOn(performance, 'now').mockReturnValue(0)
    else vi.stubGlobal('performance', undefined)
    noteServerTime(iso(1_000_000))
    expect(serverClockOffsetMs()).toBe(6000)
    expect(serverNow()).toBe(1_000_000)
    expect(serverNowIso()).toBe('1970-01-01T00:16:40.000Z')
  })
  it('is the plain device clock until a server answer has been seen', () => {
    expect(serverClockOffsetMs()).toBeNull()
    expect(serverNow()).toBe(sim.wall)
  })

  it('corrects a device that runs ahead — two devices land on the same instant', () => {
    sim.fresh(0, 0)
    expect(serverClockOffsetMs()).toBe(6_000)
    expect(serverNow()).toBe(sim.truth)
  })

  it('corrects a device that runs behind', () => {
    start(sim.truth, -5_000)
    sim.fresh(0, 0)
    expect(serverNow()).toBe(sim.truth)
  })

  it('keeps the least-latency sample, so a slow answer never shunts the clock backwards', () => {
    noteServerTime(iso(1_000_000), 1_006_000) // offset 6 s
    noteServerTime(iso(1_002_000), 1_008_500) // offset 6.5 s — 0.5 s of it was travel time
    expect(serverClockOffsetMs()).toBe(6_000)
    noteServerTime(iso(1_004_000), 1_009_500) // offset 5.5 s — a faster answer wins
    expect(serverClockOffsetMs()).toBe(5_500)
  })

  it('ignores a missing or unparseable header — no information beats wrong information', () => {
    noteServerTime(null)
    noteServerTime('')
    noteServerTime('not-a-date')
    expect(serverClockOffsetMs()).toBeNull()
  })

  it('a slow answer is consistent: its send time brackets the standing estimate', () => {
    sim.fresh(10, 10)
    const learned = serverClockOffsetMs()
    for (let i = 0; i < 5; i++) { sim.advance(3_000); sim.fresh(1_900, 1_900) } // 3.8 s round trips
    expect(serverClockOffsetMs()).toBe(learned)
  })
})

// Feueralarm 23.09.2026
describe('serverClock — a stale header cannot move it', () => {
  it.each([
    ['90 min', 90 * 60_000],
    ['three days', 3 * DAY],
    ['a week', 7 * DAY],
  ])('ignores a cached answer %s old', (_label, age) => {
    sim.fresh(40, 40)
    const before = serverNow()
    sim.cached(age)
    expect(Math.abs(sim.err())).toBeLessThan(100)
    expect(serverNow()).toBeGreaterThanOrEqual(before)
  })

  it('a burst of cached answers replayed together does not corroborate itself', () => {
    sim.fresh(40, 40)
    // the floor-fill loop asks for three bindings in a row, all stored in the same session
    for (let i = 0; i < 3; i++) sim.cached(3 * DAY + i * 50, 30)
    expect(Math.abs(sim.err())).toBeLessThan(200)
  })

  it('two stale answers of different ages disagree, so they never corroborate', () => {
    sim.fresh(40, 40)
    sim.cached(3 * DAY)
    sim.advance(5_000)
    sim.cached(90 * 60_000)
    sim.advance(5_000)
    sim.cached(2 * DAY)
    expect(Math.abs(sim.err())).toBeLessThan(200)
  })

  it('a consistent fresh answer withdraws a nomination', () => {
    sim.fresh(40, 40)
    sim.cached(3 * DAY)
    sim.advance(3_000)
    sim.fresh(40, 40) // the estimate was fine after all
    sim.advance(3 * DAY) // …so a second stale answer that happens to agree with the first…
    sim.cached(6 * DAY + 3_040)
    expect(Math.abs(sim.err())).toBeLessThan(200) // …starts over instead of confirming it
  })

  it('replays the prod sequence: every stamp written stays within seconds of the truth', () => {
    // 23.09.2026, Gymnasium: live-follow answers every few seconds, and twice a cached
    // alignments answer — three days old at 18:10, ninety minutes old at 18:43.
    start(Date.parse('2026-09-23T17:40:00Z'), 2_300)
    const written: { at: string; truth: number }[] = []
    const stamp = () => written.push({ at: serverNowIso(), truth: sim.truth })
    const until = (t: string, stale?: number) => {
      const end = Date.parse(t)
      while (sim.truth < end) {
        sim.advance(4_000)
        sim.fresh(60, 90)
        stamp()
      }
      if (stale != null) { sim.cached(stale); stamp() }
    }
    until('2026-09-23T18:10:52Z', sim.truth - Date.parse('2026-09-20T19:53:02Z'))
    stamp() // «Atemschutz-Alarm beendet: Trupp 5»
    until('2026-09-23T18:43:22Z', sim.truth - Date.parse('2026-09-23T17:16:28Z'))
    stamp() // «Referenz angepasst – 4 Objekte»
    until('2026-09-23T20:31:06Z', sim.truth - Date.parse('2026-09-23T17:26:54Z'))
    stamp() // «Referenz angepasst – 5 Objekte»
    until('2026-09-23T20:40:00Z')
    expect(written.length).toBeGreaterThan(2_000)
    for (const w of written) expect(Math.abs(Date.parse(w.at) - w.truth)).toBeLessThan(3_000)
  })
})

describe('serverClock — a genuine correction still applies', () => {
  it('requires two full seconds of corroboration, including the exact boundary', () => {
    sim.fresh(0, 0)
    sim.stepDevice(6000)
    sim.fresh(0, 0)
    sim.advance(1999)
    sim.fresh(0, 0)
    expect(serverClockOffsetMs()).toBe(6000)
    sim.advance(1)
    sim.fresh(0, 0)
    expect(serverClockOffsetMs()).toBe(12_000)
  })

  it.each([1000, 1001])('distinguishes the one-second latency margin from a correction of %i ms', (shift) => {
    sim.fresh(0, 0)
    sim.stepDevice(shift)
    sim.fresh(0, 0)
    sim.advance(2000)
    sim.fresh(0, 0)
    expect(serverClockOffsetMs()).toBe(shift === 1000 ? 6000 : 7001)
  })

  it.each([2000, 2001])('holds a corroborated backward correction only up to two seconds (%i ms)', (shift) => {
    sim.fresh(0, 0)
    sim.stepDevice(shift)
    sim.fresh(0, 0)
    sim.advance(2000)
    const before = serverNow()
    sim.fresh(0, 0)
    expect(serverNow()).toBe(shift === 2000 ? before : sim.truth)
  })

  it('keeps a pending correction in the same coordinate system after a backward device step', () => {
    sim.fresh(0, 0)
    sim.stepDevice(6000)
    sim.fresh(0, 0)
    sim.advance(4000)
    sim.stepDevice(-2000)
    sim.fresh(0, 0)
    expect(serverClockOffsetMs()).toBe(10_000)
    expect(serverNow()).toBe(sim.truth)
  })
  it('forward at once: a later server is proof, no corroboration needed', () => {
    sim.fresh(0, 1_500) // a slow first answer: the clock reads 1.5 s behind
    expect(sim.err()).toBe(-1_500)
    sim.advance(3_000)
    sim.fresh(20, 20) // one fast answer is enough
    expect(Math.abs(sim.err())).toBeLessThanOrEqual(20)
  })

  it('backward only when two answers, seconds apart, agree on it (device clock set forward)', () => {
    sim.fresh(40, 40)
    sim.stepDevice(2 * 60_000) // the OS moved the device clock 2 min ahead
    sim.advance(3_000)
    sim.fresh(40, 40)
    expect(sim.err()).toBeGreaterThan(100_000) // one answer's word: not yet
    sim.advance(3_000)
    sim.fresh(40, 40)
    expect(Math.abs(sim.err())).toBeLessThan(100) // corroborated: re-synced
    expect(serverClockOffsetMs()).toBeGreaterThan(125_000)
  })

  it('a small backward correction pauses the clock instead of stepping it back', () => {
    sim.fresh(0, 0)
    sim.stepDevice(1_800) // the OS nudged the device clock 1.8 s ahead — serverNow jumped with it
    let last = serverNow()
    for (let i = 0; i < 20; i++) {
      sim.advance(500)
      if (i % 4 === 0) sim.fresh(0, 0)
      const now = serverNow()
      expect(now).toBeGreaterThanOrEqual(last)
      last = now
    }
    expect(serverClockOffsetMs()).toBe(6_000 + 1_800) // the correction was taken…
    expect(Math.abs(sim.err())).toBeLessThan(10) // …and the paused clock has caught up
  })

  it('never follows a device clock set BACK — the contact clock keeps counting', () => {
    sim.fresh(0, 0)
    const before = serverNow()
    sim.stepDevice(-2 * HOUR)
    sim.advance(1_000)
    expect(serverNow()).toBe(before + 1_000)
    sim.advance(3_000)
    sim.fresh(40, 40)
    expect(Math.abs(sim.err())).toBeLessThan(100)
  })

  it('a sleeping tablet wakes on the right time, offline', () => {
    sim.fresh(0, 0)
    sim.sleep(40 * 60_000) // the monotonic clock stood still for 40 min
    expect(sim.err()).toBe(0)
  })

  it('a stale answer right after a nap is still not believed', () => {
    sim.fresh(0, 0)
    sim.sleep(30 * 60_000)
    sim.cached(30 * 60_000 + 200) // stored just before the screen went off
    expect(Math.abs(sim.err())).toBeLessThan(100)
  })
})

describe('serverClock — which answers may teach it', () => {
  it('checks the pathname of absolute URLs and ignores cached-prefix text in a query string', () => {
    expect(isFreshSampleSource('https://station.invalid/api/reference/plans')).toBe(false)
    expect(isFreshSampleSource('https://station.invalid/api/media/photo')).toBe(false)
    expect(isFreshSampleSource('https://station.invalid/api/incidents?back=/api/reference/plans')).toBe(true)
  })
  it('only answers that cannot have come out of a cache', () => {
    expect(isFreshSampleSource('/api/auth/me')).toBe(true)
    expect(isFreshSampleSource('/api/incidents/i1/workspace?since=4')).toBe(true)
    expect(isFreshSampleSource('/api/incidents/i1/journal', 'reload')).toBe(true)
    expect(isFreshSampleSource('/api/x', 'default')).toBe(false) // the HTTP cache may answer
    expect(isFreshSampleSource('/api/x', 'force-cache')).toBe(false)
    expect(isFreshSampleSource('/api/reference/plan%3Agym/alignments?v=4')).toBe(false)
    expect(isFreshSampleSource('/api/reference/checklists:fu:p1')).toBe(false)
    expect(isFreshSampleSource('/api/media/m1')).toBe(false)
  })

  // ⚠️ Tripwire: every service-worker route under /api/ that can answer from a cache must be one
  // the clock already refuses. A new caching route outside /api/reference/ fails here until
  // serverClock · SW_CACHED_API_PREFIXES learns it.
  const routes = (() => {
    const src = readFileSync(new URL('../../vite.config.ts', import.meta.url), 'utf8')
    return [...src.matchAll(/urlPattern:\s*\/(.+)\/([a-z]*),\s*\n\s*handler:\s*'(\w+)'/g)]
      .map(([, body, flags, handler]) => ({ re: new RegExp(body, flags), source: body, handler }))
  })()
  const firstRoute = (url: string) => routes.find((r) => r.re.test(url))

  it('reads the workbox routes out of vite.config', () => {
    expect(routes.length).toBeGreaterThanOrEqual(6)
    expect(routes.some((r) => r.handler === 'CacheFirst' && r.source.includes('plan(%3A|:)'))).toBe(true)
  })

  it('every caching /api route is a prefix the clock refuses', () => {
    for (const r of routes) {
      // our own /api/ path – not a cross-origin host that merely starts with «api» (swisstopo's
      // api3.geo.admin.ch height profiles, which carry no X-Server-Time)
      if (!r.source.includes('\\/api\\/') || r.handler === 'NetworkOnly') continue
      expect(r.source.startsWith('\\/api\\/reference\\/')).toBe(true)
    }
    expect(isFreshSampleSource('/api/reference/anything')).toBe(false)
  })

  it('the alignments are never answered from the service worker cache', () => {
    for (const url of ['/api/reference/plan%3Agym-m6/alignments?v=4', '/api/reference/plan:gym-m6/alignments?v=12']) {
      expect(firstRoute(url)?.handler).toBe('NetworkOnly')
    }
    // …while the pinned PDF itself stays cache-first («downloaded ONCE per revision»)
    expect(firstRoute('/api/reference/plan%3Agym-m6?v=4')?.handler).toBe('CacheFirst')
  })

  it('the answers the clock learns from are not routed to any cache', () => {
    for (const url of ['/api/auth/me', '/api/config', '/api/incidents/i1/workspace', '/api/incidents/i1/journal', '/api/incidents/i1/events']) {
      expect(firstRoute(url)).toBeUndefined()
      expect(isFreshSampleSource(url)).toBe(true)
    }
  })
})

/** mulberry32 — a seeded generator, so the soak is the same run every time. */
function rng(seed: number) {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}
const logUniform = (r: () => number, lo: number, hi: number) => Math.exp(Math.log(lo) + r() * (Math.log(hi) - Math.log(lo)))

describe('serverClock — soak', () => {
  it.each([1, 2, 3])('10 000 jittery answers, 5 % stale, device clock steps and naps (seed %i)', (seed) => {
    const r = rng(seed)
    start(Date.parse('2026-09-23T17:00:00Z'), (r() - 0.5) * 20 * 60_000)
    const WARMUP = 50
    let prev = -Infinity
    /** a forward device step (> 1 s) not yet undone, and when it happened */
    let pending: { at: number } | null = null
    let decreases = 0
    let corrections = 0
    let worst = 0
    const check = (i: number, afterFresh: boolean) => {
      const now = serverNow()
      // the first answer is the initial sync from the bare device clock — not a correction
      if (serverClockOffsetMs() === null || (afterFresh && prev === -Infinity)) { prev = afterFresh ? now : prev; return }
      const err = now - sim.truth
      let cleared = false
      if (pending && afterFresh && Math.abs(err) <= 2_000) {
        expect(sim.truth - pending.at).toBeLessThan(60_000) // undone within a minute of answers
        pending = null
        cleared = true
        corrections++
      }
      if (i >= WARMUP && !pending) {
        expect(Math.abs(err)).toBeLessThanOrEqual(2_000)
        worst = Math.max(worst, Math.abs(err))
      }
      // never backward — the one exception is the step that undoes a device clock the OS set
      // forward (the device moved the clock first; the correction only takes that back)
      if (now < prev) {
        expect(cleared).toBe(true)
        decreases++
      }
      prev = now
    }
    for (let i = 0; i < 10_000; i++) {
      sim.advance(200 + r() * 4_800)
      const ev = r()
      if (ev < 0.003) {
        const size = logUniform(r, 100, 2 * HOUR)
        const forward = r() < 0.5
        sim.stepDevice(forward ? size : -size)
        if (forward && size > 1_000) pending ??= { at: sim.truth }
      } else if (ev < 0.005) {
        sim.sleep(logUniform(r, 60_000, HOUR))
      }
      check(i, false)
      if (r() < 0.05) {
        sim.cached(logUniform(r, 5_000, 4 * DAY), 1 + r() * 30)
        check(i, false)
      } else {
        const rtt = 20 + r() * 1_980
        const out = r() * rtt
        sim.fresh(out, rtt - out)
        check(i, true)
      }
    }
    expect(pending).toBeNull()
    expect(decreases).toBeLessThanOrEqual(corrections)
    expect(worst).toBeLessThanOrEqual(2_000)
  })
})
