#!/usr/bin/env node
// Compare the performance journeys' numbers against the baseline — and fail on a regression.
//
//   node scripts/perf-report.mjs perf-results                      # one run
//   node scripts/perf-report.mjs perf-results/run1 perf-results/run2  # best of two runs
//   node scripts/perf-report.mjs --update <run-dir> [run-dir …]     # accept: rewrite the baseline
//
// Each run directory holds the <journey>.json files e2e/journeys.journey.ts wrote: one walk.
// Comparing, every metric takes its BEST value of the walks: all of them are lower-is-better, and
// noise only ever makes a number worse. That is how CI confirms a regression before it fails
// (ci.yml · perf). Accepting (`--update`), a time takes the MEDIAN of the walks and the rest their
// best, over walks of one kind of runner (perf-gate.mjs · baselineOf): a build is judged by one
// walk, so its baseline is the typical walk, not the luckiest.
//
// Every time budget is scaled by how fast the machine was today (`env.calibration`, a fixed
// workload) against the machine the baseline was taken on, clamped to ×1–1.5: a slow GitHub
// runner is not a slow build, and a fast one is not a faster app (perf-gate.mjs · speedFactor).
// Counts and sizes are not scaled. The judgement of one number, the tolerances and why they are
// what they are live in scripts/perf-gate.mjs.
//
// Exit 0 = nothing regressed, 1 = a regression, 2 = usage. A metric with no number (its journey
// failed, or was filtered out) is listed but does not fail: Playwright's own exit code covers that.
// docs/testing/perf-journeys.md has the whole picture.
import { appendFileSync, existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { baselineOf, bestOf, CALIBRATION, judge, speedFactor } from './perf-gate.mjs'

const args = process.argv.slice(2)
const flag = (name) => { const i = args.indexOf(name); if (i < 0) return undefined; const v = args[i + 1]; args.splice(i, 2); return v }
const update = args.includes('--update') && args.splice(args.indexOf('--update'), 1)
const baselinePath = flag('--baseline') ?? 'e2e/perf/baseline.json'
const summaryPath = flag('--summary') ?? process.env.GITHUB_STEP_SUMMARY
const runs = args
if (!runs.length) { console.error('usage: perf-report.mjs [--update] [--baseline file] [--summary file] <run-dir> [run-dir …]'); process.exit(2) }

function readRun(dir) {
  if (!existsSync(dir)) throw new Error(`${dir}: no such directory — did the journeys run?`)
  const metrics = {}
  const details = {}
  for (const f of readdirSync(dir).filter((x) => x.endsWith('.json'))) {
    const j = JSON.parse(readFileSync(join(dir, f), 'utf8'))
    Object.assign(metrics, j.metrics)
    const { metrics: _m, journey, ...rest } = j
    details[journey] = rest
  }
  return { metrics, details }
}

const loaded = runs.map(readRun)
const walks = loaded.map((r) => r.metrics)
const baseline = existsSync(baselinePath) ? JSON.parse(readFileSync(baselinePath, 'utf8')) : { metrics: {}, tolerance: {} }
/** the API routes per journey; of several walks, the last one's win */
const routesOf = (some) => Object.assign({}, ...some.map((r) => r.details))

if (update) {
  // the typical walk of one kind of runner: perf-gate.mjs · baselineOf has the rules and the why
  const { metrics, calibration, kept, dropped } = baselineOf(walks)
  for (const i of dropped) console.log(`left out: ${runs[i]} (calibration ${walks[i][CALIBRATION].value} ms, another kind of runner than the median's)`)
  const details = routesOf(kept.map((i) => loaded[i]))
  const out = {
    $comment: 'Written by `node scripts/perf-report.mjs --update` from CI runs (`just perf-accept <run-id> …`): times are the median of `walks` walks, the rest their best. Hand-edit only `tolerance`. docs/testing/perf-journeys.md',
    recorded: new Date().toISOString().slice(0, 10),
    source: process.env.PERF_SOURCE ?? runs.join(' '),
    walks: kept.length,
    calibration,
    tolerance: baseline.tolerance ?? {},
    metrics: Object.fromEntries(Object.entries(metrics).sort(([a], [b]) => a.localeCompare(b))),
    details: Object.fromEntries(Object.entries(details).map(([j, d]) => [j, d.routes ? { routes: d.routes } : {}]).filter(([, d]) => Object.keys(d).length)),
  }
  writeFileSync(baselinePath, JSON.stringify(out, null, 2) + '\n')
  console.log(`baseline written: ${baselinePath} (${Object.keys(out.metrics).length} metrics from ${kept.length} walk${kept.length > 1 ? 's' : ''}, calibration ${calibration ?? '—'} ms)`)
  process.exit(0)
}

// ── compare ──────────────────────────────────────────────────────────────────────────────────

const { metrics: current, calibration } = bestOf(walks)
const details = routesOf(loaded)
const speed = speedFactor(calibration, baseline.calibration)
const rows = []
let failed = 0
let warned = 0
for (const key of [...new Set([...Object.keys(baseline.metrics ?? {}), ...Object.keys(current)])].sort()) {
  const base = baseline.metrics?.[key]
  const now = current[key]
  const unit = now?.unit ?? base?.unit
  // a journey that failed to walk already failed the run (and `just perf -g …` walks only some)
  if (!now) { rows.push({ key, unit, base: base.value, now: undefined, limit: undefined, status: 'missing' }); warned++; continue }
  if (!base) { rows.push({ key, unit, base: undefined, now: now.value, limit: undefined, status: 'new' }); continue }
  const { expected, limit, status } = judge({ key, unit, base: base.value, now: now.value, speed, overrides: baseline.tolerance })
  if (status === 'regressed') failed++
  else if (status === 'warn') warned++
  rows.push({ key, unit, base: expected, now: now.value, limit, status })
}

const ICON = { ok: '✅', warn: '⚠️', regressed: '❌', improved: '🟢', new: '🆕', missing: '❔' }
const fmt = (v, unit) => (v === undefined ? '—' : unit === 'count' ? String(Math.round(v)) : `${(Math.round(v * 10) / 10).toLocaleString('en-US')}`)
const delta = (r) => (r.base === undefined || r.now === undefined || r.base === 0 ? '' : `${r.now >= r.base ? '+' : ''}${Math.round(((r.now - r.base) / r.base) * 100)} %`)

const lines = []
const verdict = failed ? `❌ **${failed} regression${failed > 1 ? 's' : ''}**` : warned ? `⚠️ no regression, ${warned} number${warned > 1 ? 's' : ''} drifting` : '✅ no regression'
lines.push(`## Performance journeys — ${verdict}`, '')
lines.push(`Best of ${runs.length} run${runs.length > 1 ? 's' : ''} against \`${baselinePath}\` (recorded ${baseline.recorded ?? '—'}). ` +
  `Machine speed today ×${speed.toFixed(2)} of the baseline's (calibration ${calibration ?? '—'} ms vs ${baseline.calibration ?? '—'} ms); time budgets scale with it.`, '')
const notable = rows.filter((r) => r.status !== 'ok')
if (notable.length) {
  lines.push('| | metric | baseline | now | limit | Δ |', '| --- | --- | ---: | ---: | ---: | ---: |')
  for (const r of notable) lines.push(`| ${ICON[r.status]} | \`${r.key}\` | ${fmt(r.base, r.unit)} | ${fmt(r.now, r.unit)} | ${fmt(r.limit, r.unit)} | ${delta(r)} |`)
  lines.push('')
}
// what changed in the API traffic, for every journey whose request count moved
for (const journey of new Set(notable.filter((r) => /requests|writes|saves|posts/.test(r.key)).map((r) => r.key.split('.')[0]))) {
  const was = baseline.details?.[journey]?.routes ?? {}
  const is = details[journey]?.routes ?? {}
  const diff = [...new Set([...Object.keys(was), ...Object.keys(is)])].filter((k) => (was[k] ?? 0) !== (is[k] ?? 0))
  if (!diff.length) continue
  lines.push(`<details><summary>${journey}: API routes that changed</summary>`, '', '| route | baseline | now |', '| --- | ---: | ---: |')
  for (const k of diff.sort()) lines.push(`| \`${k}\` | ${was[k] ?? 0} | ${is[k] ?? 0} |`)
  lines.push('', '</details>', '')
}
lines.push('<details><summary>All numbers</summary>', '', '| | metric | unit | baseline | now | limit |', '| --- | --- | --- | ---: | ---: | ---: |')
for (const r of rows) lines.push(`| ${ICON[r.status]} | \`${r.key}\` | ${r.unit} | ${fmt(r.base, r.unit)} | ${fmt(r.now, r.unit)} | ${fmt(r.limit, r.unit)} |`)
lines.push('', '</details>', '')
if (failed) {
  lines.push('A regression that is intended (a new request a feature needs, a bigger bundle that is worth it): ' +
    'accept it with `just perf-accept <run-id>` and commit the new baseline. **Why** goes into the commit message.', '')
}
if (rows.some((r) => r.status === 'improved')) lines.push('🟢 = better than the baseline by more than its tolerance. Accept it (`just perf-accept <run-id>`) so the gain is defended from now on.', '')

const md = lines.join('\n')
console.log(md)
if (summaryPath) appendFileSync(summaryPath, md + '\n')
process.exit(failed ? 1 : 0)
