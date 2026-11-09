# CI and local validation

CI keeps the production-container, browser, visual, performance, coverage and security gates.
Independent work runs alongside other checks; browser suites share an image, never a database
or fake fleet. Workflow definitions live in `.github/workflows/ci.yml`.

## Fast local feedback

Use `just dev` for the running application, `just test-changed` while editing, and `just ci`
before pushing a complete change. `test-changed` only reruns the backend's previously failed
tests; a green result does not mean the backend suite passed.

`just ci` runs only the stacks the branch can affect. `scripts/ci-scope.mjs` compares every
change against the merge base with `origin/main` (committed, staged, unstaged, untracked) and
prints which stack runs and the file that pulled it in:

- A stack runs for its own files (`backend/` and `docker-compose.dev.yml` for the backend;
  `src/`, `public/`, `site/`, `e2e/`, `tools/`, `scripts/` and the root frontend configs for the
  frontend), and for any file its code or tests read by path – the backend tests read
  `src/data/boardTemplates`, `src/lib/prefs.ts`, `CHANGELOG.md` and `package.json`, the frontend
  tests read backend JSON and Python. Comments and docstrings don't count, nor does a path in
  the middle of a string.
- The `justfile`, `shared/` and the shell/Python scripts in `scripts/` run both stacks.
- Docs, examples and CI workflows run neither stack unless a test reads them.

GitHub CI still runs every gate on every PR, so a wrong skip turns the PR red, never main.
`just ci-all` forces everything (it requires just 1.56 or later); its three dependencies run
in parallel, and `just ci-no-backend` runs the first two:

- `just ci-frontend`: lint, browser-spec types and inventory, production build (including app
  types), hidden sourcemaps, bundle/site checks, vulnerability and license audits.
- `just ci-unit`: the whole frontend suite with its unchanged global coverage floor. It uses
  four workers so it can coexist with TypeScript and pytest on a developer machine, eight
  under `ci-no-backend`, where no pytest runs beside it.
- `just ci-backend`: migration/model drift, PostgreSQL tests, Ruff, mypy and dependency audits.

Use `just --jobs 1 ci-all` on a memory-constrained machine or to diagnose a timing-sensitive
test.
TypeScript's incremental cache lives under `node_modules/.cache/typescript/`, with distinct app
and browser-spec files. It is disposable and confined to the checkout; delete that directory
to force a cold typecheck. Changed source/configuration still invalidates the relevant checks.

For targeted backend checks, `just test-backend -n 0 -x tests/test_example.py` uses a database
named for that invocation, with a separate database per xdist worker. Parallel worktrees must
not create/drop a shared `kpfront_test_gwN`. The parent test database is removed on exit; the
test fixtures own worker cleanup. Development data is never the test target.

Local PostgreSQL containers (development, performance and visual checks) publish their ports
on `127.0.0.1` only. Their public test credentials must not expose a database to the LAN.

## Mutation testing

`pnpm test:mutation` runs Stryker against eleven critical frontend modules and their dedicated
Vitest suites: workspace merging, JSON equality, the audit outbox and event scope, the undo
timeline, serialized work, the server clock, sync alerts, Atemschutz calculations, alarm
delivery and device alarm readiness. The source list in `stryker.config.json` and test list in
`vitest.mutation.config.ts` define the scope; this is not an application-wide or backend score.

The runner changes copied source inside `.x-stryker-tmp`, never the working files. Four workers
use Vitest's test-level coverage to select tests. Static mutants and every mutation operator
remain enabled. No dashboard upload is configured. HTML and JSON reports are local under
`reports/mutation/`; incremental results live at `reports/stryker-incremental.json`. Both
locations are ignored by git. The explicit plugin entry is required for pnpm's isolated layout;
Vitest transpiles the mutated TypeScript, and `just check` still checks the real source.

Keep test selection in Vitest. Stryker 10.1.1's `testFiles` option passes file filters through
the runtime-activation path even for static mutants, activating them after module constants
were initialized. This produced false survivors for an empty merge policy and deleted clock
cache prefixes. `pnpm test:mutation:smoke` exercises the real runner against the clock's
`SW_CACHED_API_PREFIXES` declaration: the array deletion and both prefix changes must all be
`Killed` by assertions. Timeouts do not pass this canary. Run it after a runner/Vitest upgrade
or changing test selection.

Use `pnpm test:mutation --force` for an independent cold run. An ordinary rerun recomputes
coverage and reuses only unchanged outcomes; record the reuse count with published results.
Force a cold run when changing test selection or runner settings. To focus an investigation,
pass `--mutate src/lib/undoTimeline.ts`; it replaces the source list, so a focused score is not
comparable with the eleven-module score. Keep the source and test selections identical for a
before/after comparison. Review `Survived` and `NoCoverage` mutants as missing-test candidates;
`Timeout` and `RuntimeError` need separate inspection and do not prove an assertion detected the
fault. Equivalent changes can survive correct tests: record the reason instead of asserting
private implementation details or suppressing mutation operators to improve the score.

This is a quality check separate from the existing coverage floor and the seven required PR
checks. It runs by hand, and every Monday in «Mutation testing (weekly)»
(`.github/workflows/mutation.yml`, also Actions → Run workflow): a cold run whose per-module
table lands in the job summary and whose HTML report is an artifact; it gates no merge. Its
initial score floor is 78%; raise it deliberately as gaps close, never lower it to make a run
pass. Run `just ci` before pushing as usual.

### Audit on 2026-10-28

Stryker 10.1.1, Vitest 4.1.12 and Node 22.23.1; baseline application/tests at `c09054e8`,
with the runner configuration above. Both sides use the same eleven source/test selections,
with no ignored operators or static mutants. The baseline ran cold; the final result follows
a cold after-run and two incremental refinements (2,900 and 3,003 unchanged results reused).
The focused suites grew from 325 to 417 tests. The undo fix removes two mutation sites.

| Outcome | Before | After |
| --- | ---: | ---: |
| Generated mutants | 3,135 | 3,133 |
| Killed by tests | 2,069 | 2,459 |
| Timeout | 28 | 29 |
| Survived | 680 | 511 |
| No coverage in the selected suites | 357 | 134 |
| Runtime error | 1 | 0 |
| Stryker score | 66.91% | 79.41% |

Stryker's score includes timeouts and excludes runtime errors; the counts above keep those
distinct from test kills. This is a 12.50 percentage-point improvement, with 390 additional
test-killed mutations. These measurements do not claim a backend or application-wide score.

| Module | Before | After |
| --- | ---: | ---: |
| Alarm delivery | 24.72% | 83.90% |
| Device alarm readiness | 83.25% | 97.54% |
| Atemschutz calculations | 73.80% | 80.82% |
| Audit outbox | 63.12% | 74.70% |
| Event scope and observation IDs | 90.24% | 100.00% |
| JSON equality | 87.76% | 96.94% |
| Workspace merge | 58.62% | 63.59% |
| Serialized work | 100.00% | 100.00% |
| Server clock | 76.69% | 87.31% |
| Sync alerts | 93.15% | 98.63% |
| Undo timeline | 78.31% | 87.78% |

New cases cover alarm cadence, connected audio nodes and non-overlapping pips, mute/wake-lock
lifecycle, permission and notification fallback, readiness expiry and storage corruption,
UTF-8 beacon limits, delayed audit acknowledgements/refusals after ownership changes, automatic
retries, stable leading-zero event hashes, array-like JSON objects, duplicate crew IDs,
pressure/timestamp pairing, exact clock boundaries, duplicate offline timers and grouped undo.
The grouped-undo case failed on the baseline: after a group lost all but one part, its toast
dropper could not remove the recorded step, leaving the action available to undo twice.

The remaining 511 survivors and 134 uncovered sites are retained in the report and denominator.
Priorities for another pass are the merge's board-form removal/restoration and signature paths,
and audit hydration/promotion/durability races. Existing broader suites such as
`boardPassengers.test.ts` and `reportSignature.test.ts` cover some paths outside this selected
measurement; inspect those before adding redundant tests. Audio fallback and chime-envelope
cases also remain. Not every survivor is a missing assertion: sequence counters changed from
increment to decrement still invalidate equality tokens, an extra comparison of two absent
array slots remains equal, and several optional-array fallbacks cannot run after hydration.
Type-only tripwires can survive too: Vitest transpiles mutants without a TypeScript checker.
No such cases were suppressed to improve the score.

## Tests, ratchets and holds

Moved here from AGENTS.md on 2026-10-18, wording unchanged.

**Tests** are Vitest, colocated as `*.test.ts(x)`: pure `src/lib` logic in the default node
environment, and component and hook tests in jsdom (a `@vitest-environment jsdom` line at the
top of the file – about half of the files); the backend uses pytest. Pre-commit covers backend Ruff and staged
frontend ESLint, not the full gate. `just ci` also runs the coverage floor, the bundle budget,
audits, licenses and `just schema-check` (a throwaway Postgres migrated to head, then `alembic
check` against the models); image, secrets, e2e, visual and perf stay CI's.

- **Ratchets only go down.** The eslint warnings per rule and what `eslint-disable` directives
  silence per rule (`scripts/eslint-baseline.json`, `rules` and `silenced`; `pnpm lint` fails when
  a count goes up, or down without `pnpm lint:update` – a non-null `!` outside the tests counts as
  a warning), the style-debt
  baseline (`src/styles/styleDebt.baseline.json`,
  [`ui-conventions.md`](../ui-conventions.md#tokens-the-cascade-and-the-scales); a count that went
  down is only a console note there, and in `controlDebt.test.ts`), the dead-code findings
  (`pnpm knip`: unused files, exports, types and dependencies per kind against
  `scripts/knip-baseline.json`, config `knip.json`; an export used only in its own file does not
  count, a count that went down is a note, `node scripts/knip-ratchet.mjs --update` lowers it)
  and the vitest
  coverage floor are lowered (the floor raised) when you fix something and never moved the other
  way to pass. The gzipped entry, App, maplibre, pdf-worker and CSS chunks have a +5 % budget
  against `scripts/bundle-baseline.json` (`scripts/check-bundle-size.mjs`, CI); a deliberate
  growth is an `--update` in its own commit, with the reason.
- **`jsdom` is held on 30.0.x** (`~30.0.1`, Dependabot ignores everything from 30.1.0): since
  30.1 its blob URLs cannot read the Node `Blob` Vitest supplies, so maplibre-gl fails at import
  and MapView, mapTwist and the IncidentWorkspace harness stop loading. MapLibre 6 did not fix
  it: jsdom 31.0.0 on maplibre-gl 6.14 still fails that way, plus five `JournalComposer` cases
  (#557, 08.11.2026). Lift it with a jsdom release that passes the whole suite, in a PR that also
  removes the Dependabot rule – never by mocking MapLibre away in those tests.
- **CLI subprocess tests run outside `backend/`**: pydantic reads `.env` from the cwd, so a
  station's `backend/.env` would leak into them (`tests/test_admin_cli_output.py` · `_run`).
- **e2e** runs on the production image in CI ([`e2e/README.md`](../../e2e/README.md)). ⚠️
  **Every e2e test fails when the app reports a client error or a render storm** (`e2e/guard.ts`,
  24.09.2026). A spec imports `test` from `e2e/helpers`, never from `@playwright/test` (eslint
  enforces it). A report a test provokes on purpose is listed with `expectedClientErrors`;
  nothing turns the guard off.
- **The look is gated too.** CI's «Visual» job shoots sixteen frozen states and compares them with
  `e2e/visual/baseline/` (`maxDiffPixels: 20`). A changed pixel you did not mean is a regression;
  a look you changed on purpose gets new baselines from CI (`just visual-accept <run-id>`) in its
  own commit, saying why – never to turn the check green, never shot on a laptop
  ([`visual-regression.md`](visual-regression.md)).
- **Performance is gated too.** CI's «Performance» job walks real user journeys on the busiest
  Einsatz on record and fails on regressions against `e2e/perf/baseline.json`; a red check
  blocks the merge like a failing test, and a baseline is never accepted (nor a tolerance
  loosened) to turn it green. The rules for an agent are in
  [`perf-journeys.md`](perf-journeys.md#the-gate-is-part-of-done); read it before adding or
  changing a journey.
- **Large / long incidents and performance** are measured, not guessed:
  [`fat-incident.md`](fat-incident.md), [`perf-journeys.md`](perf-journeys.md).
- **Field crash reports** are one `kpfront.clienterror` log line; hidden sourcemaps turn their
  stacks back into source ([`SOURCEMAPS.md`](../SOURCEMAPS.md)).
- For interactive changes a unit test can't cover, use `/code-review` on the diff and `/verify`
  to drive the real app.

## What runs in GitHub

**Verification before prod (the CI gate).** Prod deploys from `main`, so a red `main` reaches
the field: develop on a branch, push, let `ci.yml` go **fully green**, *then* merge – never merge
a red branch. **The gate is server-enforced:** branch protection on `main` requires the seven
checks below to pass before a merge – *Performance (user journeys vs baseline)* since
13.10.2026. `enforce_admins` is **off** on purpose, so a 3am hotfix can still bypass it – that is
the only intended bypass, not a routine one.

The required checks retain their names, so branch protection needs no migration:

| Required check | Execution |
| --- | --- |
| Frontend (tsc + build) | Requires both static/build checks and the complete coverage run; they start in parallel. |
| Backend (ruff + alembic + pytest) | Locked Python install, real PostgreSQL, migrations/schema check, four-worker pytest and audits. |
| Image (hadolint + build + smoke) | Requires the image build and all three isolated browser suites. Builds the real production image once, then drives every e2e spec against it except the journeys and screenshots – among them the white-screen smoke (`e2e/smoke.spec.ts`) and the field scenario of the Übung on 23.09.2026 (`e2e/field-scenario.spec.ts`: a parked vehicle sending GPS, a coupled Leitung, a tapped Trupp, and then three devices on one login). |
| Visual (screenshots vs baseline) | Loads that run's image into its own stack; unchanged screenshot thresholds. |
| Performance (user journeys vs baseline) | Loads that run's image into its own stack; unchanged journeys, calibration, confirmation and budgets. |
| Secrets (gitleaks) | Scans the tracked tree. |
| Shared files match KP Rück | Compares the shared manifest against the paired/default sibling branch. |

The two aggregate checks run even after a dependency fails and accept only `success` from
every child. A failed, skipped or cancelled child cannot make the required check green.

The image producer exports a Docker archive, compresses it once with fast Zstandard, and stores
it as a one-day artifact (without recompressing it in the artifact action). Consumers
download only from their own workflow run and verify the image's revision label against
`GITHUB_SHA` before booting. PR code receives no registry-write token. The producer is the only
CI job exporting the `ci-amd64` layer cache. It also reads the old default scope during the
transition; release builds can read both scopes. The standalone «Visual baselines» workflow
still builds its own image through the same composite action.

The frontend Docker stage copies only its actual inputs: source, public assets, package/lock
files, TypeScript/Vite config, `index.html`, and the coverage floor read by Vite's config. Add a
copy when introducing another build-time input. Backend/docs/workflow changes should reuse the
SPA layer in CI; frontend changes must invalidate it. CI stamps the full revision in its image
label and runtime via `RUNTIME_GIT_SHA`, leaving the frontend's existing test-build stamp alone.
Source/release builds still stamp their full revision in both stages, so changing that revision
also rebuilds their SPA. Python dependencies are installed as the runtime
user so copying a new SPA does not recursively re-own the entire virtualenv.

## Browser suite selection

Set `E2E_SUITE=field`, `recovery`, or `workspace` only against a disposable stack configured for
that suite. With no value, local project selection is unchanged. Do not set it for journeys or
screenshots: those retain their separate projects and measurement environments. Run
`node scripts/check-e2e-suites.mjs` after changing project/spec selection. It discovers the real
Playwright inventory, including new files/projects, without launching a browser or app, and
rejects empty suites, duplicate cases or missing cases.

Every browser job (the three suites, Performance, Visual, «Visual baselines») installs its
browsers through `.github/actions/playwright-browsers`: `~/.cache/ms-playwright` comes from the
Actions cache, keyed on the Playwright version and the browser list, and a hit installs only the
apt dependencies. The CDN download was what stalled jobs into their 10-minute timeout (seven of
sixteen runs re-run by hand in October 2026); a Playwright bump starts one cold run per key.

Before installing system packages, the action removes the Azure mirror from the runner's
`/etc/apt/apt-mirrors.txt`, leaving the official Ubuntu archive and security mirrors. A slow
Azure node can keep sending data without tripping apt's stall timeout
([runner-images #14823](https://github.com/actions/runner-images/issues/14823)); recovery spent
477 seconds downloading 119 MB on 2026-10-27, leaving too little time for its tests. The job
timeout, browser inventory and test checks remain unchanged.

Every suite retains the client-error/render-storm guard, the field scenario's no-retry policy,
and the browser's own observation windows. The other specs get one retry in CI; a test that
needed it is named in the job summary and as a warning on the run («Flaky tests», from
Playwright's JSON report) – fix it then, a flake and a regression look the same once it is red. Parallelize by isolated stacks, not additional
workers mutating one shared incident or fleet.

## Measure the delivery path

Measure PR push to mergeable, merge to server readiness, and client update activation separately.
Sum job execution times across all attempts when estimating paid compute; do not count a
workflow's queue, human waiting, or later manual rerun delay as runner execution. Public standard
GitHub runners are free, while a paid provider may normalize minutes by machine size.

Compare warm and cold image paths, artifact export/download/load, browser installation, tests
and cache export separately. A shared producer saves repeated builds but introduces transfer
and a dependency edge; retain it based on complete-workflow measurements. Job timeouts bound
hangs and leave room for cold builds, rather than dropping checks to enforce a target duration.

This workflow does not change Railway's deployment trigger, main branch protection, service
worker update activation, or the release publication policy. A verified production deployment
gate and promotion by tested image digest remain separate deployment changes.
