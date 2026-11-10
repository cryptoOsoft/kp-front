import { defineConfig, type PlaywrightTestConfig } from '@playwright/test'

// End-to-end smoke configuration.
//
// The smoke drives the REAL app in a browser to guard against the catastrophic
// "it doesn't even load / a core surface white-screens" class of regression — the
// one thing the unit suite (pure src/lib logic) can't catch. Beside it, the field scenario of the
// Übung on 23.09.2026, and under every test the client-error guard — see e2e/README.md.
//
// It runs against an ALREADY-RUNNING stack (this config starts no servers):
//   • CI: the `image` job's docker-compose container, served same-origin on :8000.
//   • Local: `pnpm dev` (:5188) proxying /api to a running backend (:8000).
// Point it at the stack with E2E_BASE_URL.
//
// Browsers: CI installs Chromium and WebKit. WebKit runs the core/recovery smoke because
// its navigation and Web Locks lifecycle can fail even when Chromium passes. In the preconfigured web
// environment the browser is already on disk — run with
//   PW_EXECUTABLE_PATH=/opt/pw-browsers/chromium
// to use it instead of downloading.
const baseURL = process.env.E2E_BASE_URL || 'http://localhost:8000'
const executablePath = process.env.PW_EXECUTABLE_PATH || undefined
// CI uses three independently booted stacks. Keep the long field/offline drills out of the
// general workspace group, and route any new ordinary spec to that group by default.
const suite = process.env.E2E_SUITE
if (suite && !['field', 'recovery', 'workspace'].includes(suite)) throw new Error(`Unknown E2E_SUITE: ${suite}`)
const fieldSpec = '**/field-scenario.spec.ts'
const visitSpec = '**/object-visits.spec.ts'

export default defineConfig({
  testDir: './e2e',
  fullyParallel: false,
  workers: 1,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  // CI never writes a screenshot baseline it did not have: a missing one fails the «Visual» job,
  // and baselines come from visual-baselines.yml (docs/testing/visual-regression.md)
  updateSnapshots: process.env.CI ? 'none' : 'missing',
  timeout: 60_000,
  expect: { timeout: 15_000 },
  // json: the browser jobs read it for the tests that only passed on a retry
  // (.github/scripts/flaky-summary.mjs) – a retry must not hide a flake
  reporter: process.env.CI ? [['list'], ['html', { open: 'never' }], ['json', { outputFile: 'test-results/report.json' }]] : 'list',
  use: {
    baseURL,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    // tablet-first app — a roomy landscape viewport mirrors the field device
    viewport: { width: 1280, height: 900 },
  },
  projects: ([
    {
      name: 'chromium',
      testMatch: suite === 'field' ? fieldSpec : suite === 'recovery' ? visitSpec : undefined,
      testIgnore: ['**/touch.spec.ts', ...(suite === 'workspace' ? [fieldSpec, visitSpec] : [])],
      use: { browserName: 'chromium', launchOptions: executablePath ? { executablePath } : {} },
    },
    ...[
      { name: 'touch-tablet', viewport: { width: 1024, height: 768 }, isMobile: false },
      { name: 'touch-phone', viewport: { width: 390, height: 844 }, isMobile: true },
    ].map(({ name, ...device }) => ({ name, testMatch: '**/touch.spec.ts', use: {
      browserName: 'chromium' as const, hasTouch: true, ...device,
      launchOptions: executablePath ? { executablePath } : {},
    } })),
    { name: 'webkit', testMatch: '**/smoke.spec.ts', use: { browserName: 'webkit' } },
    // `just fat-perf <preset>` — a measurement, skipped unless FAT_PRESET is set (e2e/fat-incident.perf.ts)
    // no trace: it would record every one of the thousands of API calls and become the bottleneck
    { name: 'perf', testMatch: '**/*.perf.ts', use: { browserName: 'chromium', trace: 'off', launchOptions: executablePath ? { executablePath } : {} } },
    // `just perf` and CI's «Performance» job — the performance journeys, compared against a baseline
    // (e2e/journeys.journey.ts, docs/testing/perf-journeys.md). Skipped unless PERF_JOURNEYS is set.
    // No trace and no screenshots: both cost main-thread time inside the very numbers it measures.
    { name: 'journeys', testMatch: '**/*.journey.ts', use: { browserName: 'chromium', trace: 'off', screenshot: 'off', launchOptions: executablePath ? { executablePath } : {} } },
    // `just visual` and CI's «Visual» job — screenshot regression tests on frozen states, compared
    // against e2e/visual/baseline/ (e2e/screens.visual.ts, docs/testing/visual-regression.md).
    // Skipped unless VISUAL is set. Each state builds its own context (visual/harness · frozenContext).
    // The baselines are Linux Chromium from CI only, so the path carries no platform suffix: a local
    // run elsewhere compares against them too, and is a look, not a verdict.
    {
      name: 'visual', testMatch: '**/*.visual.ts',
      snapshotPathTemplate: '{testDir}/visual/baseline/{arg}{ext}',
      expect: { toHaveScreenshot: {
        animations: 'disabled', caret: 'hide', scale: 'css',
        // ⚠️ the number docs/testing/visual-regression.md · «Threshold» explains — never raised to pass.
        // Pixels, not a ratio: a lost pass shows as a fixed number of pixels whatever the viewport
        // (12 → 8 px corners: 40–521 px per state, 09.10.2026), which a ratio of 0.1 % let through.
        maxDiffPixels: 20,
      } },
      use: { browserName: 'chromium', trace: 'retain-on-failure', screenshot: 'off', launchOptions: executablePath ? { executablePath } : {} },
    },
  ] satisfies NonNullable<PlaywrightTestConfig['projects']>).filter(({ name }) => !suite || name === 'chromium'
    || (suite === 'recovery' && ['webkit', 'touch-tablet', 'touch-phone'].includes(name))),
})
