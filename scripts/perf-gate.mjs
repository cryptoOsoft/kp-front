// The performance gate's judgement of ONE number against its baseline — the pure part of
// scripts/perf-report.mjs, kept apart so scripts/perf-gate.test.mjs can feed it the numbers of a
// real CI run. docs/testing/perf-journeys.md has the whole picture.

/**
 * How much worse than the baseline a number may get before it fails, per unit: max(abs, rel × base).
 * A count or a size barely moves between runs; a time on a shared runner moves a lot. `warn` is the
 * share of the tolerance from which a number is flagged but passes. The baseline may override any
 * of these per metric (`tolerance: { "idle.saves": { "abs": 0 } }`).
 */
export const TOLERANCE = {
  count: { abs: 2, rel: 0.15 },
  kb: { abs: 5, rel: 0.05 },
  mb: { abs: 1.5, rel: 0.25 },
  ms: { abs: 60, rel: 0.5 },
}
/**
 * Wider bands for the numbers that are noisy BY NATURE, matched on the metric's name. Measured on
 * two runs of the same build (05.10.2026): a save count follows the debounce's timing (10 vs 12
 * saves for the same twenty edits), the workspace bytes a follower polls follow the saves, and a
 * maximum, a long-task count or the time blocked past 50 ms jumps on one task more or less
 * (long tasks 17 vs 10, Verlauf blocking 58 vs 145 ms). Each still catches the regression it
 * exists for — a loop that saves on every frame, a surface that blocks for a second.
 */
export const NOISY = [
  [/blocking_ms$/, { abs: 150, rel: 1 }],
  [/long_tasks$/, { abs: 10, rel: 0.5 }],
  [/interaction_max_ms$/, { abs: 100, rel: 0.75 }],
  [/\.saves$/, { abs: 3, rel: 0.25 }],
  [/api_kb$/, { abs: 20, rel: 0.25 }],
]
export const WARN_SHARE = 0.4

/**
 * How much slower than the baseline's machine today's runner is: today's calibration over the
 * baseline's, clamped to ×1–1.5. Every `ms` budget is multiplied by it.
 *
 * ⚠️ Never below ×1 (18.10.2026). GitHub hands out three kinds of runner, calibrating at ~29, ~38
 * and ~46 ms (the baseline's was 38.4). Up the scale holds: the slow kind calibrates ×1.21 of the
 * middle one and the app's times there are ×1.19 (median over the ms metrics, 74 walks since
 * 13.10.). Down it does not: the fast kind calibrates ×0.76, but the app's times there are ×0.90
 * of the middle kind's, and `edit.karte_script_ms` ×0.96 (1,352 vs 1,416 ms). The old floor of
 * ×0.67 shrank that budget to 1,268–1,291 ms on ×0.74–0.75 runners, and builds that had not
 * touched the Karte failed it three times (#379, #384: best of two 1,275–1,423 ms). A fast runner
 * is judged by the baseline as it was recorded.
 */
export function speedFactor(calibration, baselineCalibration) {
  if (!calibration || !baselineCalibration) return 1
  return Math.min(1.5, Math.max(1, calibration / baselineCalibration))
}

/** the tolerance for one metric: its unit's, widened if it is noisy by name, the baseline's override last */
export function toleranceFor(key, unit, overrides = {}) {
  return { ...TOLERANCE[unit], ...(NOISY.find(([re]) => re.test(key))?.[1] ?? {}), ...(overrides[key] ?? {}) }
}

/**
 * One number against its baseline: the expected value (a time scaled by `speed`), the limit above
 * which it fails, and the status — `regressed`, `warn` (past WARN_SHARE of the tolerance),
 * `improved` (better by more than the tolerance) or `ok`.
 */
export function judge({ key, unit, base, now, speed = 1, overrides = {} }) {
  const tol = toleranceFor(key, unit, overrides)
  const expected = unit === 'ms' ? base * speed : base
  const slack = Math.max(tol.abs, tol.rel * expected)
  const limit = expected + slack
  let status = 'ok'
  if (now > limit) status = 'regressed'
  else if (now > expected + slack * WARN_SHARE) status = 'warn'
  else if (now < expected - slack) status = 'improved'
  return { expected, limit, status }
}

// ── several walks into one set of numbers ─────────────────────────────────────────────────────
// A «walk» is the metrics of one pass over the journeys (one perf-results/run* directory):
// `{ 'cold-start.total_ms': { value, unit }, …, 'env.calibration': { value, unit } }`.

export const CALIBRATION = 'env.calibration'

export function median(xs) {
  const s = [...xs].sort((a, b) => a - b)
  return s.length % 2 ? s[(s.length - 1) / 2] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2
}

const round = (v, digits) => Math.round(v * 10 ** digits) / 10 ** digits

/** every metric's values across the walks, the calibration left out */
function valuesByMetric(walks) {
  const by = {}
  for (const walk of walks) {
    for (const [key, m] of Object.entries(walk)) {
      if (key === CALIBRATION) continue
      ;(by[key] ??= { unit: m.unit, values: [] }).values.push(m.value)
    }
  }
  return by
}

/** the walks' calibration: the median, because it describes the machine and not the build */
function calibrationOf(walks) {
  const values = walks.map((w) => w[CALIBRATION]?.value).filter((v) => typeof v === 'number')
  return values.length ? round(median(values), 2) : undefined
}

/**
 * What a build is JUDGED by: every metric's BEST value across its walks. All of them are
 * lower-is-better and the build is the same in each, so the smallest is the nearest to its true
 * cost. That is how CI confirms a regression with a second walk before it fails (ci.yml · perf).
 */
export function bestOf(walks) {
  const metrics = Object.fromEntries(Object.entries(valuesByMetric(walks)).map(([key, { unit, values }]) => [key, { value: Math.min(...values), unit }]))
  return { metrics, calibration: calibrationOf(walks) }
}

/**
 * How far a walk's calibration may sit from the walks' median and still count as the same kind of
 * runner. GitHub's three kinds calibrate at ~29, ~38 and ~46 ms (speedFactor above), 17–24 %
 * apart; two walks on one kind differ by 1–2 %.
 */
export const RUNNER_CLASS_BAND = 0.1

/**
 * What a baseline is WRITTEN from (`perf-report.mjs --update`, `just perf-accept <run-id> …`):
 * the typical walk of the given ones, not the luckiest.
 *
 * - **Times (`ms`): the median.** A build is judged by ONE walk (two when the first regresses), so
 *   a baseline that is the best of N reads every ordinary walk as drifting: the single-run baseline
 *   of 09.11.2026 was beaten by 0–3 of 25 comparable walks per time metric, and they stood at
 *   ⚠️ +20–25 % without any change (`cold-start.pin_to_ready_ms` 3,039 against a median of 3,695).
 * - **Everything else (counts, kB, MB): the best, as before.** They are close to deterministic
 *   and their tolerance is absolute, so the smallest walk is the build's cost and the others
 *   carry a poll or a save that fell into the window. The minimum is also the one rule that can
 *   never loosen the gate, whichever walks are handed in.
 * - **Walks of one kind of runner only.** A time budget is scaled by today's calibration over the
 *   baseline's, upwards only (speedFactor), so the stored calibration has to describe the machine
 *   the stored times come from. Walks further than RUNNER_CLASS_BAND from the median calibration
 *   are left out whole – times AND counts, a fast runner also debounces into fewer saves – and
 *   the calibration stored is the median of the walks that stay. A fast walk in the mix would
 *   pull the medians down with nothing in the calibration to answer for it.
 *
 * `kept` and `dropped` are indexes into `walks`.
 */
export function baselineOf(walks) {
  const centre = calibrationOf(walks)
  const sameClass = (walk) => {
    const c = walk[CALIBRATION]?.value
    return typeof c !== 'number' || centre === undefined || Math.abs(c - centre) <= RUNNER_CLASS_BAND * centre
  }
  const indexes = walks.map((_, i) => i)
  const kept = indexes.filter((i) => sameClass(walks[i]))
  const used = kept.map((i) => walks[i])
  const metrics = Object.fromEntries(
    Object.entries(valuesByMetric(used)).map(([key, { unit, values }]) => [key, { value: unit === 'ms' ? round(median(values), 1) : Math.min(...values), unit }]),
  )
  return { metrics, calibration: calibrationOf(used), kept, dropped: indexes.filter((i) => !kept.includes(i)) }
}
