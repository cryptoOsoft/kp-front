# Performance journeys – does this change make the app slower?

**Status:** gate in CI (job «Performance»), since 2026-10-05
**Audience:** anyone whose PR turns the «Performance» check red, and whoever accepts a new baseline

Every PR walks what a crew does with the app on a busy Einsatz and compares the numbers against
a baseline taken on a GitHub runner. The gate fails on a regression in **requests**, **bytes**,
**writes**, **memory left behind**, or **interaction time**. The fat-incident tooling
([`fat-incident.md`](fat-incident.md)) asks a different question: «how big can an Einsatz get?».
This page asks «did this change make the same Einsatz worse?».

## What runs

`e2e/journeys.journey.ts` drives the built app in Chromium against the production container. Each
journey opens **its own** Einsatz: the `real` fat incident (`src/lib/fatIncident`). That is the
busiest Einsatz on record: 19 Karte objects, ~25 people, 316 Verlauf rows, Pendenzen, and three
Trupps inside. The journeys never measure an empty app.

| Journey | What the crew does | What it gates |
| --- | --- | --- |
| `cold-start` | Opens the app the first time, taps a name at the kiosk, types the PIN, lands on the Karte | Time to the workspace and to the lifted opening cover; API requests and bytes; static requests; **writes caused by just opening**; heap, DOM nodes and listeners after GC |
| `warm-reload` | Reloads the installed app 3× | Reload time; static requests that still hit the network (a precache miss); API requests |
| `surface-tour` | Karte → Gebäude → Tafel → Checkliste → Trupps → Anwesenheit → Material → Rapport, four laps | Switch time per surface; worst interaction; blocking time; **heap / DOM nodes / listeners each lap leaves behind** (a leak on unmount) |
| `edit` | Draws ten Linien on the Karte, drops ten Absperrkreise on the Tafel | Karte script time; Tafel tap → circle on screen; **saves** for twenty edits and the bytes of one save |
| `verlauf` | Writes ten Meldungen, opens the whole Verlauf (3×), sees another tablet's entry arrive | Submit time; open-Verlauf time and blocking (median); remote entry → visible; journal POSTs |
| `trupps` | Three rounds of «Kontakt» on every Trupp inside | Tap → «Bestätigt»; saves |
| `idle` | Leaves the Karte alone for a minute | API requests per minute; saves (should be 0); script/task ms, layouts and style recalcs per minute; heap growth |
| `env` | — | `calibration`: how fast the runner is today (not gated, see below) |

Every number is **lower-is-better**. `perf-results/<journey>.json` also records the API routes the
journey called. When a request count moves, the report shows which routes changed.

## Keeping the noise out

- **The outside world is stubbed** (`harness · isolateFromOutside`). Basemap tiles get one fixed PNG.
  The weather and the Overpass building outlines are backend routes that only proxy a third
  party, so they get a canned answer. External requests are still **counted**
  as distinct hosts (`*.external_hosts`): for an offline-first app a new external dependency is a
  regression. Tile counts are not gated, because how many land inside a window is timing.
- **Diagnostics are not app traffic** (08.11.2026). `/api/diag/*` – the launch timing line and the
  crash sink – leaves the API request counts and `cold-start.writes` (`harness · isAppApi`): a
  device sends it once per launch or per error, and whether it lands inside a window is timing.
  It still shows in the per-route table.
- **No CPU throttle** by default. Headless Chromium has no GPU, so MapLibre renders through software
  WebGL on the main thread. At 4× throttle a busy Karte fell to 2–10 frames a second and journeys
  hung (2026-10-05). The gate compares a build with its baseline, so relative changes show
  unthrottled too. `PERF_CPU=4` gives a local look at tablet speed.
- **The Karte is judged by script time, not wall clock.** A drawn Linie spent ~95 % of its time in
  software WebGL (CPU profile 2026-10-05), with 0.5–2 s swings between Linien.
- **Readiness is polled at 16 ms, never per animation frame.** After a few Linien the page's frames
  stalled, and a raf-polled check sat for minutes over a surface that had switched in 266 ms.
- **Time budgets follow the machine, upwards only.** `env.calibration` times a fixed workload. The
  report scales every `ms` budget by today's calibration over the baseline's, clamped to ×1–1.5
  (`scripts/perf-gate.mjs · speedFactor`). A runner faster than the baseline's keeps the baseline's
  budget: the fast kind of GitHub runner calibrates ×0.76 of the baseline's kind, but the app's
  times there are only ×0.90 (`edit.karte_script_ms` ×0.96). The old floor of ×0.67 failed
  unchanged builds on it seven times between 13.10. and 18.10.2026, every time on the Karte.
- **A journey that counts requests waits for the app's own timers, not a fixed time.** The
  `verlauf` count moved 26–30 for the same build (2026-10-08): ten Meldungen typed back to back
  sometimes fell into the long poll's 250 ms re-arm gap and woke nothing, the audit outbox
  (flushed 4 s after the last act) landed on either side of a 2 s settle, and the 15 s positions
  poll could tick inside the window. The journey now starts right after a positions tick, waits
  for the long poll to re-arm after each Meldung (untimed), and waits for the audit POST. Each
  Meldung then costs one POST, one pull and one long-poll wake.
- **A regression is confirmed before it fails.** If the first run regresses, CI walks the journeys
  again, and every number takes its best of the two runs. Noise only ever makes a number worse,
  so a regression in both runs is real.
- **Tolerances per unit** (`scripts/perf-gate.mjs · TOLERANCE`): a number fails above
  `baseline + max(abs, rel × baseline)`.

  | unit | abs | rel | Why |
  | --- | --- | --- | --- |
  | `count` | 2 | 15 % | Requests and saves are nearly deterministic; a poll can land on either side of a window |
  | `kb` | 5 | 5 % | Bytes per save are exact; API payloads move a little (static bytes are the bundle budget's, `scripts/check-bundle-size.mjs`) |
  | `mb` | 1.5 | 25 % | Heap after a forced GC still varies |
  | `ms` | 60 | 50 % | A shared runner, after calibration |

  Numbers that are noisy by nature get a wider band by name (`perf-gate.mjs · NOISY`):
  blocking time, long-task counts, the worst interaction, save counts, and API bytes. Two runs of
  the same build differed there by up to 2.5×. A save count follows the debounce's timing, so the
  edit journey gates the bytes **per save** as well, and those are stable.

  A number between 40 % and 100 % of its tolerance passes with ⚠️. A single metric can be given
  its own tolerance in the baseline's `tolerance` block (hand-edited, with a reason in the commit).

## The gate is part of «done»

**Performance is gated** (05.10.2026): CI's «Performance» job walks real user journeys on the busiest
Einsatz on record (`e2e/journeys.journey.ts`) on every PR and every push to main, and fails when
requests, bytes, writes, memory left behind or interaction times regress against
`e2e/perf/baseline.json` (`scripts/perf-report.mjs`). For an agent this is part of «done»:
- **Read the «Performance journeys» comment on your PR** (or the job summary), not only the colour. A ⚠️ (drifting) or 🟢 (better) line
  is worth a sentence in the PR description. You caused it, so you know why.
- **A red Performance check blocks the merge** like a failing test. Fix the cause first: a new poll,
  a save on open, a chunk pulled into the entry bundle, a listener a surface never removes. The
  summary names the routes that changed.
- **Never accept a baseline to turn a check green.** `just perf-accept <run-id>` is for a cost the
  change deliberately buys (a request a feature needs). Take it from a CI run (never a local one),
  in its own commit, with the reason in the message, and say so in the PR. Accepting a 🟢 gain is
  always welcome.
- **Never loosen a tolerance or skip a journey to pass.** Gate on a count or a size where the
  regression shows in one. Times are scaled by the runner's calibration and confirmed by a second
  run.
- **Touch the save path, polling, the Karte, a surface's mount, or the bundle?** Run `just perf` locally
  first (a look, not a verdict).

## When the check is red

The PR has the table as a comment (one per PR, edited on every push, posted by
`.github/workflows/perf-comment.yml` once CI finishes), and so does the job summary: each metric
that moved, its baseline, today's number, the limit, and, for request counts, the routes that
changed. The raw numbers are the `perf-results` artifact.

1. **Unintended:** fix it. Typical causes are a new poll, a save on open, a chunk pulled into the
   entry bundle, or a listener a surface never removes.
2. **Intended** (a request the feature needs, a dependency worth its bytes): accept it.

   ```bash
   just perf-accept <run-id>    # the CI run's id, from the PR's «Performance» check
   git commit -s e2e/perf/baseline.json   # say WHY in the message
   ```

   `perf-accept` downloads that run's numbers and rewrites `e2e/perf/baseline.json`, keeping the
   `tolerance` block. Take the baseline from a CI run, never from a local one. Counts and bytes
   would match, but times and heap come from a different machine.
3. 🟢 **Better than the baseline** by more than its tolerance: accept that too, so the gain is
   defended from then on.

## Running it locally

```bash
just perf                 # throwaway Postgres + built app, all journeys, then the report
just perf -g idle         # one journey (Playwright's grep)
PERF_CPU=4 just perf      # tablet-ish speed (expect the Karte journeys to crawl)
```

On WSL without sudo, point `LD_LIBRARY_PATH` at Chromium's missing libraries. A local run is a
look, not a verdict. A loaded box skews every time. Counts and sizes compare as they are.

## Adding a journey

- A `test(...)` in `e2e/journeys.journey.ts`. It starts with `open(page, baseURL, '<name>')`
  (seeds, signs in, instruments) and ends with `j.r.save()`.
- Time **raw input** (`page.mouse` at a centre computed before the clock starts) to a state polled
  in the page (`timeTo`). Never time a locator action: its actionability waits would be in the
  number.
- Prefer a count or a size to a time wherever the regression shows in one.
- Ship it with a baseline from its first CI run (`just perf-accept`). Until then its numbers are
  listed as 🆕 and gate nothing.

## Found on its first walks (2026-10-05)

- **The Verlauf composer crashed** when a Meldung named two open Pendenzen equally well. The
  workspace never passed `createdAt` for the tie-break. Fixed in #262.
- Opening an Einsatz writes: one workspace PUT and one journal POST per device per open
  (`cold-start.writes`). It is baselined as it stands. Whether it should be 0 is a question for
  the save path (`docs/testing/fat-incident.md` expected 0 saves on open). **Answered
  18.10.2026: they are a one-time upgrade of the seed, not a save per open.** The seeded Einsatz
  is `schemaVersion` 2 (the app writes 3 and derives `planBindings`), and its Trupps' crews were
  never filed on the Anwesenheit (`lib/crewFiling`: attendance rows, `crewFiled`, one «Unter AS»
  Verlauf row per Trupp, all under derived ids). Each carries content, so the writes stay. The
  same Einsatz opened again, on the same device or a second one, writes nothing: e2e `open-writes.spec.ts`
  holds that at 0 (a count gate with an absolute tolerance of 2 could not).
  `cold-start.writes` keeps measuring the first open of an older Einsatz.
- The first launch downloads ~2.7 MB of precache in the background (measured until 23.10.2026; the
  bundle budget watches the big chunks, `cold-start.static_requests` the count).
- Every Funkkontakt is a full workspace save: nine contacts sent nine PUTs and ~345 KB
  (`trupps.saves`). Twenty Karte and Tafel edits sent 10–12 saves of ~35 KB each (`edit.saves`,
  `edit.kb_per_save`). Both are baselined. A change that batches them shows up as 🟢.
- The «Eintrag erfasst» toast lands on the composer's «Erfassen» at 1280×900. Writing the next
  Meldung quickly, the tap dismisses the toast instead of filing the entry. The journey waits for
  the toast (`harness · centre`). The overlap itself is a UX question, not a gate. Re-measured 18.10.2026:
  one pill no longer reaches «Erfassen» at any phone or tablet size (the tablet composer is a
  dialog at the top, the phone's lane stands on the sheet), but every Meldung STACKED another
  pill, and a column of them grew up into the composer. Since then a new «Eintrag erfasst»
  replaces the last one (`useJournalWriters · JOURNAL_SAVED_KIND`, e2e `workspace-flows` F8).
