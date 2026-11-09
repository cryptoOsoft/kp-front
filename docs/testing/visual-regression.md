# Screenshot regression tests – did this change the look by accident?

**Status:** CI job «Visual», since 2026-10-09 – a required check since 2026-10-10 (owner decision)
**Audience:** anyone whose PR turns the «Visual» check red, and whoever accepts a new baseline

Every PR shoots sixteen frozen states of the app and compares them pixel by pixel with the baselines
committed in `e2e/visual/baseline/`. Unit tests and the e2e specs assert what someone thought to
name; a screenshot catches the rest: a merged visual pass that a later merge silently undid (#231
was lost from staging that way, 26.09.2026), a token that changed under a surface, a bar that
moved, a corner that went back to 8 px.

## What runs

`e2e/screens.visual.ts` against the production container, in Chromium. Each Einsatz state opens
**its own** copy of the `real` fat incident (`src/lib/fatIncident`, the busiest Einsatz on record:
Karte objects, a Gebäude with annotations, three Trupps inside, 316 Verlauf rows, Pendenzen),
five hours in.

| State | Viewport | What it shows |
| --- | --- | --- |
| `lage-tablet` | 1180×820 | the Karte with every object kind, the top bar, both rails |
| `lage-tablet-night` | 1180×820 | the same in the night theme |
| `lage-phone` | 390×844 | the Karte on a phone: head, bottom bars |
| `plan-tablet` | 1180×820 | the Plan surface: the Gebäude floor stack with its annotations |
| `trupps-tablet` | 1180×820 | the Trupps board: three inside (contact clocks), three out |
| `trupps-phone` | 390×844 | the Trupps board on a phone |
| `verlauf-phone` | 390×844 | the Verlauf drawer: Pendenzen, rows, the replay strip |
| `rapport-tablet` | 1180×820 | the Einsatzrapport preflight |
| `trupps-phone-night` | 390×844 | the Trupps board on a phone at night |
| `rapport-phone-night` | 390×844 | the Einsatzrapport preflight on a phone at night |
| `trupp-anmelden-phone` | 390×844 | an open bottom sheet: «Trupp anmelden» over the Trupps board |
| `trupp-anmelden-phone-night` | 390×844 | the same sheet at night |
| `symbol-editor-tablet` | 1180×820 | a selected symbol on the Karte with its editor open |
| `karte-home-tablet` | 1180×820 | «Karte & Objekte», the home outside an Einsatz: bar, rails, three station objects |
| `karte-home-phone` | 390×844 | the same home on a phone |
| `kiosk-tablet` | 1180×820 | the kiosk login (signed out) |

## Keeping it deterministic

A screenshot test is worth only as much as its second run, so everything that is not the build is
pinned (`e2e/visual/harness.ts`):

- **The clock.** `Date` is fixed at SHOT (20.09.2026, 19:05) with `page.clock.setFixedTime`; the
  seeded Einsatz started five hours before it. Every Einsatzuhr, contact clock, «vor 3 min» and
  «Gespeichert um» reads the same instant. Timers still run in real time, so polls, timeouts and
  MapLibre's frames behave as they always do. The backend's `X-Server-Time` header is hidden from
  the page, so `lib/serverClock` keeps offset 0 – with it, the real date would pull every clock
  weeks ahead.
  `clock.install` + `pauseAt` was tried first and dropped: jumping a running page minutes ahead
  fires every due timer at once, and one baseline of four came out with «Offline» in its head.
- **The data.** The fat incident is generated from a seeded RNG, so it is the same Einsatz every
  time, and each state gets a fresh one on a fresh stack. The theme is set explicitly (the default
  «auto» follows daylight), and so is the surface (the prefs cookie). The two Karte home states
  seed no Einsatz; their station catalogue is three canned objects and their camera is fixed
  (`harness · openKarte`) – the server fills a real object's footprint and the region's houses
  from registers on the internet, minutes after it was created, so a real catalogue would draw a
  different map from run to run.
- **The outside world.** Basemap tiles are one flat PNG – a dark one for a night basemap, as
  Dark Matter's ground is: with the light tile the night paint lifted the map to white under dark
  chrome, a picture no crew sees (until 09.11.2026); the weather, the building outlines and the Gebäude card
  (`/api/incidents/{id}/building`, whose registers the SERVER asks) are
  canned (`perf/harness · isolateFromOutside`, shared with the performance journeys). Nothing on
  screen comes from the internet.
- **The device.** Fixed viewport, device pixel ratio 1, `de-CH` / `Europe/Zurich`, reduced motion,
  no service worker. `toHaveScreenshot` disables CSS animations and hides the caret.
- **Fonts first.** Both faces are requested as soon as the stylesheet is in, and the shot waits
  for them. The Karte's label pass measures its labels on a canvas and caches the widths, and a
  canvas does not wait for a web font. One early local run drew the Karte's labels 1–2 px off
  against its baseline; a label measured before Spline Sans Mono arrived is the likeliest cause
  (see «Found on the way»), and nothing like it has shown since the fonts are requested first.
- **A drawn Karte.** The map canvas must give two identical pictures 400 ms apart before the shot;
  `toHaveScreenshot` itself then waits for two identical pictures of the page.

No masks: nothing on these screens is variable once the above holds. A mask hides a region from
the comparison, so a state that needs one is better fixed in the harness.

## Threshold

`maxDiffPixels: 20` per state, with Playwright's default per-pixel colour tolerance (0.2), which
absorbs anti-aliasing noise without counting it.

- **Pixels, not a ratio.** A lost visual pass shows as a fixed number of pixels, whatever the
  viewport. Measured on 09.10.2026 by setting the corner token from 12 to 8 px: 40–521 changed
  pixels per state. `maxDiffPixelRatio: 0.001` (967 px on a tablet) let all of it through.
- **The noise.** Three CI runs of the same commit and 15+ local runs all passed. Where whole
  pages were hashed (35 local shots of the Karte), runs of one build were identical or 7 pixels
  apart (the glass of the top bar over the map). 20 leaves room for that and nothing a person
  would call a change.
- **Never raised to pass.** A state that is noisier than 20 px has a determinism bug: fix it in
  the harness.

## When the check is red

The job summary has one row per state (same / changed by N px / no baseline / broke before the
shot). The **visual-results** artifact holds, per changed state, the expected, actual and diff
pictures (`diff/` marks every changed pixel) and Playwright's HTML report, which has a slider.

1. **Unintended:** fix it. Typical causes are a token or class renamed under a surface, a merge
   that took the older side of a stylesheet, a component that lost its wrapper.
2. **Intended** (the PR changes the look on purpose): accept the new pictures.

   ```bash
   just visual-accept <run-id>    # the red «Visual» run, or a «Visual baselines» run
   git add e2e/visual/baseline && git commit -s   # its own commit, saying WHY the look changed
   ```

   Look at every picture before committing it. A state that changed for a reason the PR does not
   explain is a regression hiding in an accepted baseline.

## Accepting a baseline

- **Never accept a baseline to turn a check green.** Only a change the PR makes on purpose, in its
  own commit, with the reason in the message; say so in the PR description.
- **Baselines come from CI, never from a laptop.** Fonts and rasterisation differ between
  machines; a baseline shot locally fails the next CI run. Two sources:
  - a red «Visual» run: its artifact holds the new picture of every state that changed;
  - **«Visual baselines»** (`.github/workflows/visual-baselines.yml`): re-shoots every state on a
    runner. Start it with Actions → Run workflow on your branch (`gh workflow run
    visual-baselines.yml --ref <branch>`), or with the label `visual-update` on the PR (remove and
    re-add it to run it again). Use it for a new state, a new viewport, or a Playwright/Chromium
    upgrade that re-renders everything.
- **CI never commits.** Both only upload pictures. A commit pushed with the workflow's token would
  not run the PR's CI, and it would carry nobody's sign-off (DCO).
- **Never mask, loosen the threshold or drop a state to pass.**

## Running it locally

```bash
just visual                  # throwaway Postgres + built app, every state, then the table
just visual -g trupps        # some states (Playwright's grep)
VISUAL_SKIP_BUILD=1 just visual
```

The pictures land in `visual-results/`. A local run is a look, not a verdict: it compares against
the CI baselines, and another machine renders differently. Measured 09.10.2026 on WSL: the six
states without a map matched CI pixel for pixel, the three Karte states differed by 6 000–12 000
px (MapLibre draws through software WebGL, whose anti-aliasing follows the CPU). A missing baseline is
written locally so a new state can be looked at, but commit the one CI shoots. On WSL without sudo,
point `LD_LIBRARY_PATH` at Chromium's missing libraries.

## Adding a state

- One entry in `STATES` (`e2e/screens.visual.ts`): a name, a device, the surface the app opens on,
  the theme, and what to wait for or tap once it is open. Prefer a state a crew actually sees over
  a dialog nobody opens.
- Keep the list short. Every state costs a few seconds and one more picture to review on a
  deliberate change. Nine covered every surface and both form factors; seven more (09.11.2026)
  cover what those could not show: night on a phone, an open sheet in both themes, an editor,
  and the Karte home.
- Its baseline comes from «Visual baselines» on the PR (label `visual-update`).

## CI cost

The job waits for the shared production-image build, then loads that run's artifact on its own
runner and database alongside the browser suites and «Performance». Its total path includes
the producer and image transfer; measure the complete workflow when changing that graph
([CI execution](ci.md)).

Historical measurement on #310 (2026-10-09), before sharing the image: the independent job
took about 4 minutes (3:56–4:27 over three runs, ~1 min of it the nine states), while «Image»
took about 9; adding Visual did not change that workflow's wall time.

## Found on the way (09.10.2026)

- **The Karte's labels can be measured with the wrong font.** `lib/labelPass · textWidth` measures
  on a canvas and caches the width per string; a canvas never waits for a web font, so a label
  measured before Spline Sans Mono loaded keeps a fallback width for the life of the page (its box,
  its wrapping, the declutter). The harness requests the fonts early; the app does not re-measure
  on `document.fonts` `loadingdone`. Not fixed here.
