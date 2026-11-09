// The per-module table of a Stryker run, as Markdown for the job summary
// (.github/workflows/mutation.yml): `node .github/scripts/mutation-summary.mjs <mutation.json>`.
// The score is Stryker's own: killed + timeout over every mutant that could have been detected
// (ignored mutants and runtime/compile errors are outside it) – docs/testing/ci.md · «Mutation testing».
import { readFileSync } from 'node:fs'

const [report = 'reports/mutation/mutation.json', config = 'stryker.config.json'] = process.argv.slice(2)
const { files } = JSON.parse(readFileSync(report, 'utf8'))
const floor = JSON.parse(readFileSync(config, 'utf8')).thresholds.break

const tally = (mutants) => {
  const n = (...statuses) => mutants.filter((m) => statuses.includes(m.status)).length
  const row = { killed: n('Killed'), timeout: n('Timeout'), survived: n('Survived'), noCoverage: n('NoCoverage'), errors: n('RuntimeError', 'CompileError') }
  const valid = row.killed + row.timeout + row.survived + row.noCoverage
  return { ...row, score: valid ? (100 * (row.killed + row.timeout)) / valid : NaN }
}
const line = (name, t) => `| ${name} | ${Number.isNaN(t.score) ? '–' : `${t.score.toFixed(2)} %`} | ${t.killed} | ${t.timeout} | ${t.survived} | ${t.noCoverage} | ${t.errors} |`

const modules = Object.entries(files).map(([file, { mutants }]) => ({ file, ...tally(mutants) })).sort((a, b) => a.score - b.score)
const total = tally(Object.values(files).flatMap((f) => f.mutants))
console.log([
  '### Mutation testing (Stryker)',
  '',
  `Score **${total.score.toFixed(2)} %** against a floor of ${floor} % – lowest module first.`,
  '',
  '| Module | Score | Killed | Timeout | Survived | No coverage | Errors |',
  '| --- | ---: | ---: | ---: | ---: | ---: | ---: |',
  ...modules.map((m) => line(`\`${m.file}\``, m)),
  line('**all**', total),
].join('\n'))
