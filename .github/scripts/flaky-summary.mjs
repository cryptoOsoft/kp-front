// The tests that failed and then passed on a retry, from Playwright's JSON report
// (playwright.config.ts · reporter): `node .github/scripts/flaky-summary.mjs <report.json>`.
// A green run with `retries: 1` hides them in the log; this names each one in the job summary
// and as a warning on the run, so a flake is seen the day it starts (docs/testing/ci.md).
import { appendFileSync, existsSync, readFileSync } from 'node:fs'

const [report = 'test-results/report.json'] = process.argv.slice(2)
if (!existsSync(report)) { console.log(`no Playwright report at ${report} – nothing ran`); process.exit(0) }

const flaky = []
const visit = (suite, path) => {
  for (const spec of suite.specs ?? []) {
    for (const test of spec.tests) {
      if (test.status !== 'flaky') continue
      const failed = test.results.find((r) => r.status !== 'passed' && r.status !== 'skipped')
      const why = (failed?.error?.message ?? '').replace(/\u001b\[[0-9;]*m/g, '').split('\n').find((l) => l.trim()) ?? ''
      flaky.push({ title: [...path, spec.title].join(' › '), where: `${spec.file}:${spec.line}`, project: test.projectName, why: why.trim() })
    }
  }
  for (const child of suite.suites ?? []) visit(child, child.file === child.title ? path : [...path, child.title])
}
for (const suite of JSON.parse(readFileSync(report, 'utf8')).suites ?? []) visit(suite, [])

if (!flaky.length) { console.log('no test needed a retry'); process.exit(0) }
const cell = (s) => s.replaceAll('|', '\\|')
const summary = [
  `### ${flaky.length} flaky test${flaky.length > 1 ? 's' : ''} – failed, then passed on the retry`,
  '',
  '| Test | Project | First failure |',
  '| --- | --- | --- |',
  ...flaky.map((f) => `| ${cell(f.title)} (\`e2e/${f.where}\`) | ${f.project} | ${cell(f.why)} |`),
  '',
].join('\n')
if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, `${summary}\n`)
else console.log(summary)
for (const f of flaky) console.log(`::warning title=Flaky test::${f.title} [${f.project}] (e2e/${f.where}) – ${f.why}`)
