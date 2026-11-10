import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { baselineOf, bestOf, judge, speedFactor } from './perf-gate.mjs'

// The numbers are CI's own: e2e/perf/baseline.json's `edit.karte_script_ms` and calibration, and
// the first attempts of the Performance job that failed on builds that never touched the Karte.
const BASE = { value: 1143.4, calibration: 38.4 }
const karte = (now, calibration) =>
  judge({ key: 'edit.karte_script_ms', unit: 'ms', base: BASE.value, now, speed: speedFactor(calibration, BASE.calibration) })

/** [PR, CI run (attempt 1), calibration of the two walks, best edit.karte_script_ms of the two] */
const FAST_RUNNER_FAILURES = [
  ['#384 d9a359d3', 39108819113, [28.6, 28.5], 1275.4],
  ['#384 21bd00ec', 39070254670, [29.2, 28.6], 1328.6],
  ['#379 29473edf', 39052643020, [28.0, 28.8], 1422.7],
]
const mid = ([a, b]) => (a + b) / 2

describe('perf gate on a fast runner (calibration ~29 ms vs the baseline\'s 38.4)', () => {
  it.each(FAST_RUNNER_FAILURES)('%s (run %i): an unchanged Karte journey passes', (_pr, _run, cals, now) => {
    expect(karte(now, mid(cals)).status).not.toBe('regressed')
  })

  it('does not shrink a time budget below the baseline', () => {
    expect(speedFactor(28.55, BASE.calibration)).toBe(1)
    expect(karte(1275.4, 28.55).limit).toBeCloseTo(1715.1, 1)
  })

  it('still fails a real regression there', () => {
    // 1.5× the baseline plus a hair: what a mid runner (the baseline's kind) would fail as well
    expect(karte(1716, 28.55).status).toBe('regressed')
    expect(karte(2 * 1352, 28.55).status).toBe('regressed') // twice the fast runners' median
  })
})

describe('perf gate on a slow runner', () => {
  it('still scales a time budget up: #384 attempt 2 (×1.24) passes at 2,076 ms', () => {
    expect(speedFactor(47.6, BASE.calibration)).toBeCloseTo(1.24, 2)
    expect(karte(2076.3, 47.6).status).not.toBe('regressed')
  })

  it('caps the scaling at ×1.5 and still fails a real regression', () => {
    expect(speedFactor(80, BASE.calibration)).toBe(1.5)
    expect(karte(2 * 1665, 46.3).status).toBe('regressed') // twice the slow runners' median
  })
})

describe('perf gate, the rest unchanged', () => {
  it('does not scale counts or sizes', () => {
    expect(judge({ key: 'edit.api_requests', unit: 'count', base: 88, now: 104, speed: 1.5 }).status).toBe('regressed')
    expect(judge({ key: 'edit.kb_per_save', unit: 'kb', base: 1000, now: 1060, speed: 1.5 }).status).toBe('regressed')
  })

  it('without a calibration on either side, a budget is not scaled', () => {
    expect(speedFactor(undefined, 38.4)).toBe(1)
    expect(speedFactor(46, undefined)).toBe(1)
  })
})

// Walks as CI recorded them on main, 09.–10.11.2026 (runs 42717650281 … 42805629593): slow-kind
// runners at ~46 ms, and one walk that landed on the fast kind.
const walk = (calibration, submitMs, saves) => ({
  'env.calibration': { value: calibration, unit: 'ms' },
  'verlauf.submit_ms': { value: submitMs, unit: 'ms' },
  'edit.saves': { value: saves, unit: 'count' },
})
const SLOW = [walk(46.7, 130.9, 12), walk(46.2, 150.9, 12), walk(46.4, 176.8, 12), walk(46.1, 179.6, 12), walk(46.8, 142.9, 11)]
const FAST = walk(27.1, 87.9, 10)

describe('a baseline from several walks (baselineOf)', () => {
  it('takes the median of a time and the best of a count', () => {
    const { metrics } = baselineOf(SLOW)
    expect(metrics['verlauf.submit_ms']).toEqual({ value: 150.9, unit: 'ms' })
    expect(metrics['edit.saves']).toEqual({ value: 11, unit: 'count' })
  })

  it('stores the median calibration of the walks it used', () => {
    expect(baselineOf(SLOW).calibration).toBe(46.4)
    expect(baselineOf(SLOW.slice(0, 4)).calibration).toBe(46.3) // an even number: between the middle two
  })

  it('leaves a walk from another kind of runner out whole, wherever it stands in the list', () => {
    const mixed = baselineOf([SLOW[0], FAST, ...SLOW.slice(1)])
    expect(mixed.dropped).toEqual([1])
    expect(mixed.kept).toEqual([0, 2, 3, 4, 5])
    expect({ metrics: mixed.metrics, calibration: mixed.calibration }).toEqual({ metrics: baselineOf(SLOW).metrics, calibration: 46.4 })
  })

  it('one walk is its own baseline', () => {
    expect(baselineOf([SLOW[0]])).toEqual({ metrics: { 'verlauf.submit_ms': { value: 130.9, unit: 'ms' }, 'edit.saves': { value: 12, unit: 'count' } }, calibration: 46.7, kept: [0], dropped: [] })
  })

  it('an ordinary walk no longer drifts against it, and a real regression still fails', () => {
    const { metrics, calibration } = baselineOf(SLOW)
    const submit = (now) => judge({ key: 'verlauf.submit_ms', unit: 'ms', base: metrics['verlauf.submit_ms'].value, now, speed: speedFactor(46.2, calibration) }).status
    expect(SLOW.map((w) => submit(w['verlauf.submit_ms'].value))).toEqual(['ok', 'ok', 'ok', 'ok', 'ok'])
    expect(submit(2 * 150.9)).toBe('regressed')
  })
})

describe('judging a build by several walks (bestOf)', () => {
  it('still takes the best of every number, times included', () => {
    const { metrics, calibration } = bestOf(SLOW)
    expect(metrics['verlauf.submit_ms'].value).toBe(130.9)
    expect(metrics['edit.saves'].value).toBe(11)
    expect(calibration).toBe(46.4)
  })
})

// The same three runs through the real CLI, as CI calls it: two run directories, best of two.
describe('perf-report.mjs on the logged runs', () => {
  let dir
  afterEach(() => dir && rmSync(dir, { recursive: true, force: true }))

  const report = (walks) => {
    dir = mkdtempSync(join(tmpdir(), 'perf-gate-'))
    const baseline = join(dir, 'baseline.json')
    writeFileSync(baseline, JSON.stringify({ calibration: BASE.calibration, tolerance: {}, metrics: { 'edit.karte_script_ms': { value: BASE.value, unit: 'ms' } } }))
    const runs = walks.map(([calibration, karteMs], i) => {
      const run = join(dir, `run${i + 1}`)
      mkdirSync(run)
      writeFileSync(join(run, 'env.json'), JSON.stringify({ journey: 'env', metrics: { 'env.calibration': { value: calibration, unit: 'ms' } } }))
      writeFileSync(join(run, 'edit.json'), JSON.stringify({ journey: 'edit', metrics: { 'edit.karte_script_ms': { value: karteMs, unit: 'ms' } } }))
      return run
    })
    try {
      execFileSync(process.execPath, ['scripts/perf-report.mjs', '--baseline', baseline, '--summary', join(dir, 'report.md'), ...runs], { stdio: 'pipe' })
      return 0
    } catch (e) {
      return e.status
    }
  }

  it('#384 d9a359d3 (run 39108819113, walks 1,275.4 / 1,288.4 ms at 28.6 / 28.5 ms): no regression', () => {
    expect(report([[28.6, 1275.4], [28.5, 1288.4]])).toBe(0)
  })
  it('#384 21bd00ec (run 39070254670, walks 1,455.2 / 1,328.6 ms at 29.2 / 28.6 ms): no regression', () => {
    expect(report([[29.2, 1455.2], [28.6, 1328.6]])).toBe(0)
  })
  it('#379 29473edf (run 39052643020, walks 1,422.7 / 1,443.6 ms at 28.0 / 28.8 ms): no regression', () => {
    expect(report([[28.0, 1422.7], [28.8, 1443.6]])).toBe(0)
  })
  it('a Karte twice as slow on the same runners fails', () => {
    expect(report([[28.6, 2 * 1275.4], [28.5, 2 * 1288.4]])).toBe(1)
  })
})
