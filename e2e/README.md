# e2e – Playwright against the built app

The browser tests drive the real, built app against a running stack. The unit suite pins
`src/lib` logic from the inside; these catch what only a browser shows: a surface that throws on
mount, a wedged session, a render loop on the Karte.

| Spec | What it guards | Runs |
| --- | --- | --- |
| `smoke.spec.ts` | every core surface renders and survives a reload; session renewal; offline journal | CI, chromium + WebKit |
| `field-scenario.spec.ts` | the Übung of 23.09.2026: a Leitung coupled to a parked vehicle that reports GPS, a tapped Trupp; then three devices on one login; three devices tapping «Neuer Trupp» at once get three numbers | CI, chromium, no retries |
| `object-visits.spec.ts` | Objektbesuche on a phone: catalogue prepared online, a visit taken offline (answers + photo) survives a reload, «Jetzt senden» reaches «Gespeichert» (revision + photo on the server), «Abschliessen» → read view | CI, chromium (needs `E2E_ADMIN_SECRET`: switches the module on, adds an object + a visit checklist) |
| `admin-row-menu.spec.ts` | the admin row menu is on top and its actions fire | CI (needs `E2E_ADMIN_SECRET`) |
| `demo.spec.ts` | the public demo's entry fits a phone | only against a demo deployment |
| `workspace-flows.spec.ts` | undo, timeline, keyboard, Abschluss, replay across the workspace seams | CI; locally opt-in, `E2E_WORKFLOWS=1` |
| `open-writes.spec.ts` | opening an Einsatz this build has already saved writes nothing: a reload and a second device send 0 writes (the first open's one-time upgrade is reported, not asserted) | CI; locally opt-in, `E2E_WORKFLOWS=1` |
| `journeys.journey.ts` | performance journeys: requests, bytes, writes, leaks and interaction times on a busy Einsatz, compared against `e2e/perf/baseline.json` ([docs/testing/perf-journeys.md](../docs/testing/perf-journeys.md)) | CI job «Performance», chromium; opt-in elsewhere (`PERF_JOURNEYS=1`, `just perf`) |
| `screens.visual.ts` | screenshot regression: nine frozen states (Lage, Plan, Trupps, Verlauf, Rapport, kiosk; tablet + phone, one night) compared pixel by pixel with `e2e/visual/baseline/` ([docs/testing/visual-regression.md](../docs/testing/visual-regression.md)) | CI job «Visual», chromium; opt-in elsewhere (`VISUAL=1`, `just visual`) |
| `live-follow.spec.ts` | the live follow after a save: the saving device downloads none of its own saves; two devices on one login get each other's Kontakt and an Atemschutznotfall within 5 s, also saving at the same moment and in the gap before the re-arm | CI; locally opt-in, `E2E_WORKFLOWS=1` |
| `touch.spec.ts` | coarse-pointer time controls at 1024×768 and 390×844, clearing, reachable actions and overflow | CI; locally opt-in, `E2E_WORKFLOWS=1` |
| `karte-north-snap.mjs` | the map's north-snap: a two-finger turn let go ≈2–3° off north rests on exactly north within 600 ms, one let go ≈6° or ≈11° off stays (real touch input through CDP, so MapLibre and the twist gate see a phone's gesture — [docs/karte-objekte.md](../docs/karte-objekte.md)) | by hand, Chromium: `node e2e/karte-north-snap.mjs <stack URL>` (not a Playwright spec) |
| `karte-basemap-sharpness.mjs` | the base map is drawn sharp on a 3× phone: device px per tile px ≤ 1.5 (red at 3.0 when 1× tiles are stretched – the blurry map of review round 4 — [docs/karte-objekte.md](../docs/karte-objekte.md)) | by hand, WebKit: `node e2e/karte-basemap-sharpness.mjs --base <stack URL>` (not a Playwright spec) |
| `karte-tag-fit.mjs` | a folded map name tag is as wide as its longest line plus its chrome, not its 280 px cap (the Stallenmatt row of the golden data — [docs/karte-objekte.md](../docs/karte-objekte.md)) | by hand, Chromium: `node e2e/karte-tag-fit.mjs <stack URL>` (not a Playwright spec) |
| `blink-force-dark.mjs` | day mode stays LIGHT under Blink's force-dark (Samsung Internet's «Dark mode» / Chrome's Auto Dark Theme), and night stays dark – the `color-scheme: only light/dark` opt-out ([docs/ui-conventions.md](../docs/ui-conventions.md)); red at 38 vs 242 mean luminance with a bare `light` | by hand, Chromium: `node e2e/blink-force-dark.mjs <stack URL>` (not a Playwright spec) |
| `planpicker-preview.mjs` | the «Anderes Objekt» chooser's preview map: with no base tiles the pane says so instead of showing pins over an empty box, with tiles it paints and says nothing (the reasoning sits in `src/components/PlanPicker.tsx`'s header) | by hand, Chromium: `node e2e/planpicker-preview.mjs <stack URL>` (not a Playwright spec) |
| `karte-plan-back-camera.mjs` | back on the Karte from a plan, the selected object stands in the middle of the free map (right of the panel, left of the tool rail): a house tap, a tag tap, a search pick with the rail collapsed and expanded, on 1440×900 and the tablet — ≤ 12 px (red at ≈180 px for a tapped object, 68 px for a search pick beside the expanded rail — [docs/karte-objekte.md](../docs/karte-objekte.md)) | by hand, Chromium: `node e2e/karte-plan-back-camera.mjs <stack URL>` (not a Playwright spec) |
| `karte-search-scroll.mjs` | the Karte's phone search: only the result list scrolls (a list with nothing to scroll moves nothing — the empty search), with and without the keyboard, the field stays on the screen (synthetic touches + a keyboard stand-in; Gefahrgut as the reference — [docs/karte-objekte.md](../docs/karte-objekte.md)) | by hand, WebKit: `node e2e/karte-search-scroll.mjs <stack URL>` (not a Playwright spec) |
| `einsatz-keyboard.mjs` | the Einsatz's phone sheets with the keys up in the emulated installed app (iOS's `innerHeight` collapse, kept, undone and in steps) and a Safari tab: «keyboard up» holds, the sheet stays on the keys, its field where it was (the composer, «Einsatzdaten bearbeiten», «Trupp anmelden» — [docs/ui-conventions.md](../docs/ui-conventions.md)); shares its stand-ins with the Karte check (`ios-standalone.mjs`) | by hand, WebKit: `node e2e/einsatz-keyboard.mjs <stack URL>` (not a Playwright spec) |
| `checkliste-pictures.mjs` | the Checkliste surface's device cards and device-page hero paint with the first frame of every open after the first, with the service worker (a held `blob:` copy, `lib/heldPictures` — [docs/karte-objekte.md](../docs/karte-objekte.md)) | by hand, WebKit: `node e2e/checkliste-pictures.mjs <built-app URL> --sw` (not a Playwright spec) |
| `gebaeude-storey-menu.mjs` | the Gebäude storey label stays clickable with a create tool armed (Linie, Wand, Fläche, Absperrkreis, Notiz), and «Kopieren nach …» copies with the mouse – red when the drawing layer covers the label, as it did until 27.10.2026 ([docs/plans-and-buildings.md](../docs/plans-and-buildings.md)) | by hand, Chromium: `node e2e/gebaeude-storey-menu.mjs <stack URL>` (not a Playwright spec; opens an Einsatz of its own) |
| `gebaeude-wand-grips.mjs` | a selected Wand's «Verlängern» arrow stands a full step (46 px) off its end node whichever way the Wand ends, and a node of the open Wand dragged near the building outline snaps onto it, ring shown – red at 14 px for a Wand ending upwards, as until 27.10.2026 ([docs/plans-and-buildings.md](../docs/plans-and-buildings.md)) | by hand, Chromium: `node e2e/gebaeude-wand-grips.mjs <stack URL>` (not a Playwright spec; opens an Einsatz of its own) |

CI builds one production image and shares its archive within that workflow run. The required
*Image* check waits for three isolated browser suites: `field` (GPS/multi-device), `recovery`
(object visits, WebKit and touch), and `workspace` (remaining Chromium specs). Each has its own
database, app, fake fleet and one browser worker; they share no mutable state. New ordinary specs
go to `workspace` by default. `node scripts/check-e2e-suites.mjs` verifies that every ordinary
case appears exactly once, and an unknown `E2E_SUITE` fails configuration. See
[`docs/testing/ci.md`](../docs/testing/ci.md).

The journeys run in their own job, «Performance», and the screenshots in «Visual», each against
a container of their own loaded from the same image. Only the rows marked CI actually run in «Image»: the demo spec skips
on a station image. CI sets `E2E_WORKFLOWS=1` for its disposable stack; local workflow and touch tests skip without that flag. `playwright.config.ts`
starts no servers.

## The client-error guard

Every test fails when the app reports a client error or a render storm, even when everything
it asserts still holds (`guard.ts`, re-exported by `helpers.ts`). It watches two things in every
browser context of the test:

- each `POST /api/diag/client-error`, the report `lib/reportError` sends for a render throw, an
  uncaught error, a map error, a SurfaceBoundary recrash or a `lib/useRenderStorm` storm;
- console errors and uncaught errors that name the loop itself (React #185, «Maximum update
  depth exceeded», «render storm»).

A failing test attaches `client-errors.json` (the report bodies). CI then prints the
`kpfront.clienterror` lines from the container log before the full log.

So a spec **must import `test` from `./helpers`**, never from `@playwright/test` (eslint
enforces this). A test that provokes a report on purpose lists it, and only it:

```ts
test.use({ expectedClientErrors: [OFFLINE_FETCH_FAILURE] }) // regexes matched against «kind: message»
```

The offline smoke is the one user today. Since 24.09.2026 `lib/reportError` drops a bare fetch
failure while `navigator.onLine` is false (`isOfflineNetworkNoise`), because being offline is not
a client error. But Chromium's offline emulation reports `navigator.onLine === true` in a document
reloaded while offline, so that drill's basemap tiles still report – as MapLibre 6 words it,
«error: AJAXError: Failed to fetch (0): <tile url>», next to the bare «error: Failed to fetch» of
our own fetches. `OFFLINE_FETCH_FAILURE` (`./guard`) matches both forms and nothing else.
The loop's own console line is never excused, and nothing turns the guard off.

One report is excused without being listed: a broken basemap tile (09.10.2026). A reload while
the Karte is still loading its tiles makes WebKit fail the in-flight tile fetches and the tile
blobs it was decoding, and MapView reports them as «error: Load failed» (MapLibre 6: «error:
AJAXError: Load failed (0): <url>», excused only for a basemap tile's url) and «error: An error
occured reading the Blob argument to createImageBitmap». That turned the WebKit smoke red at
random. The guard lets those two pass only when the same device was loading basemap tiles within
3 s of the report (a request to a host of the service worker's `map-tiles` list in flight, ending
or failing then), and none of its other requests failed then except by a cancel. It takes tile
traffic, not a failed tile, as the sign: in the trace of one such failure only 3 of 15 broken tile
fetches showed up as `requestfailed`. Such a report is decided when the test ends and goes
into `client-errors-expected.json` with an `excused` note. Any other «Load failed» still fails
the test.

**Open the app with `openApp(page, path)`** (`helpers.ts`; `login` does) when the next step
types: the app is inert beneath the boot cover, and a `fill` or a key press – unlike a click –
does not wait for it to lift. Only the boot-cover timing cases use a bare `goto`.

A test that needs more devices asks for `openDevice('device 2')`. That gives another browser
context with the same base URL and viewport, guarded the same way.

## The field scenario

The post-mortem of 23.09.2026 (root cause A): the live-GPS pass put every device into a render
loop, and tapping a Trupp then threw React #185 and took the Karte down. That only happened
with a Leitung coupled to a vehicle that was standing still and sending GPS, a shape no test
had ever produced. The spec builds exactly that:

1. It opens its own Übung with a coordinate, over the API (`POST /api/incidents`). Each device
   gets it the way a device remembers its last Einsatz (the prefs cookie), so other open
   incidents on the stack do not matter. The spec archives it again at the end.
2. It parks a TLF about 45 m from the Einsatzort through the backend's fake fleet
   (`POST /api/traccar/fake`). The Fahrzeuge layer polls `/api/traccar/positions`, the same
   route it polls in the field.
3. Device 1 draws a Linie that starts on the TLF with the line tool (`l`). A press on a live
   vehicle couples the start at once. The server must hold `startAttachment.gps.state ===
   'guarded'`.
4. Every device places a «Neuer Trupp» with the Trupp tool (`t`), concurrently.
5. For 22 s the fleet re-reports the same fix every 5 s, as a parked Traccar device does. Each
   device must get at least one feed answer after that window opens.
6. Every device taps its Trupp. The Trupp's action bar must open, and there must be no
   SurfaceBoundary card. After 3 s (the storm detector's window) there must be no client
   error: the tap is the exact moment the Übung crashed.
7. Every Trupp must be on the server and on every device (the edit lost in a re-merge, #204).
   The coupling must still be `guarded`.

It runs twice: on one device, and on three devices with one login, as in the Übung. It is
**chromium only**. The loop lives in our React code, not in anything an engine does
differently, and the three-device run is the expensive half of the suite. WebKit keeps running
the smoke under the same guard. Runtime is about 35 s plus 50 s, and 20 s for the test below.

Before every press the spec waits for a FRAMED Karte, not only a still one. The TLF has to
stand east of the Einsatzort pin on the same row, at about its 46 m. Before the first press the
pin must also be at the canvas centre, which is the opening view. Two reads 300 ms apart must
agree. On a loaded box a press measured too early went 18 px beside the TLF, and the Linie
started uncoupled. After the Linie is drawn the Karte may pan (measured: 18 px), so only the
pin ↔ TLF relation is required from then on. The scenario runs with **no retries**: a retry
that passes would file an intermittent crash as «flaky».

**Three devices, one number each.** The third test has three devices tap «Neuer Trupp» within
milliseconds of each other. Each takes the next number from its own view of the Einsatz, so all
three mint «Trupp 1»; the merge then settles the number (`lib/truppNumbers ·
resolveTruppNumbers`, docs/trupp-naming.md §7), and the test asserts that the server ends up with
three distinct names. Until 25.09.2026 this test asserted the duplicate instead. A crash
still fails it on its own: the guard and the client-error check before the assertion.

**Proof that it catches the bug** (24.09.2026): with the #200 fix reverted locally (the
idempotent pass, the stable `setDocRaw`, TwinTeamPill's guard), both tests fail. The failures
carry the field's own reports: React #185 with `surface=map`, and «render storm:
IncidentWorkspace · tab=map · changed: objects×200».

## Running locally

The loading-snail checks in `smoke.spec.ts` cover ordinary launches and the inline update-resume
handover in Chromium and WebKit. `snail-update.spec.ts` also exercises real Workbox installation,
activation and the automatic reload in Chromium, where service-worker automation is supported.
It proxies the running production stack's static assets through a disposable local origin,
answers API requests anonymously and changes that origin's worker bytes between openings. An
ordinary reload gets one entrance; an update reload resumes past it; the next deliberate reload
gets a fresh entrance again. The proxy pins outgoing URLs to the configured stack origin and
rejects redirects; a network-path-reference regression checks that requests cannot replace the
upstream host. No station data or upstream worker is changed.

```bash
# a throwaway database on the dev compose db (just db), migrated, and the built SPA served by
# the backend. TRACCAR_FAKE + ALARM_WEBHOOK_SECRET only for the field scenario.
just db
docker compose -f docker-compose.dev.yml exec db psql -U kpfront -c 'CREATE DATABASE kpfront_e2e'
pnpm build
cd backend && DATABASE_URL=postgresql+asyncpg://kpfront:kpfront@localhost:5434/kpfront_e2e \
  SECRET_KEY=<32+ chars> ENVIRONMENT=production COOKIE_SECURE=false SEED_PIN=194731 \
  ADMIN_SECRET=<16+ chars> TRACCAR_FAKE=1 ALARM_WEBHOOK_SECRET=<any> \
  MEDIA_STORAGE_DIR=/tmp/kp-e2e-storage SPA_DIR=$PWD/../dist \
  sh -c 'uv run alembic upgrade head && uv run uvicorn app.main:app --port 8016'

E2E_BASE_URL=http://localhost:8016 E2E_PIN=194731 E2E_ADMIN_SECRET=<same> \
  E2E_FLEET_SECRET=<the ALARM_WEBHOOK_SECRET> pnpm test:e2e --project chromium
```

`E2E_PIN` is the seeded PIN (`helpers.ts` exports it as `PIN`; the default `000000` is the seed
file's own, which a production-mode backend refuses — hence `SEED_PIN`). Afterwards drop the
database again. Without `E2E_FLEET_SECRET`, the field scenario skips locally. In CI it fails instead: CI must
never quietly drop it. It writes to its own Übung and to the server's fake fleet, so never run
it against a station in use or a production deployment.

## The six workspace workflows

- CI enables the six workspace workflows and phone/tablet touch checks on its disposable stack.
  Locally these mutations require `E2E_WORKFLOWS=1`; never target a station in use.
