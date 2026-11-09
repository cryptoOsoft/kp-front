// FIRST import: its evaluation is the «bundle starts» moment of the launch's timing line
import { markBoot, reportBoot } from './lib/bootTiming'
import { StrictMode, Suspense, lazy } from 'react'
import { createRoot } from 'react-dom/client'
import { initServiceWorker } from './lib/swUpdate'
import { initInstallPrompt } from './lib/installPrompt'
import { installGlobalErrorReporting } from './lib/reportError'
// maplibre's stylesheet BEFORE app.css, as it was when App was a static import: app.css overrides
// `.maplibregl-*` at equal specificity, and a lazy chunk's CSS would otherwise land after it.
import 'maplibre-gl/dist/maplibre-gl.css'
import './fonts.css'
import './app.css'
import { onAccountKnown } from './lib/accountKnown'
import { AuthProvider, useAuth } from './lib/auth'
import { ErrorBoundary } from './components/ErrorBoundary'
import { LoginScreen } from './components/LoginScreen'
import { DemoRibbon } from './components/DemoRibbon'
import { Splash } from './components/Splash'
import { lockChromeZoom } from './lib/lockZoom'
import { loadPrefs, applyTheme, resolveTheme } from './lib/prefs'
import { bootDeploymentConfig, applyDeploymentBranding, deploymentName } from './lib/deploymentConfig'
import { loadStationPlanScales, refreshStationPlanScales } from './lib/stationPlanScale'
import { migrateLocalStorageToIdb } from './lib/storageMigration'
import { requestPersistentStorage } from './lib/idb'
import { applyLocale } from './config/copy'
import { ensureErg } from './lib/erg'
import { ensureUnHazard } from './lib/unHazard'
import { whenIdle } from './lib/idle'
import { purgeStaleTiles } from './lib/tilePurge'
import { liftBootCover } from './lib/snailLaunch'
import { apiBeacon } from './lib/api'
import { GIT_SHA } from './lib/buildInfo'

// zoom applies only to the map/plan, not the UI chrome (app feel, not a web page)
lockChromeZoom()

// Report uncaught errors (outside the render tree) to the server log so a field crash on a
// solo operator's tablet isn't invisible. The ErrorBoundary reports render throws separately.
installGlobalErrorReporting()

// Night ergonomics: resolve the colour scheme before first paint so the app never
// flashes the wrong chrome. Default 'auto' tracks daylight (brigade region at boot,
// the incident coordinate once known via useAutoTheme); 'day'/'night' are overrides.
applyTheme(resolveTheme(loadPrefs().theme, null, new Date()))

// Ask for PERSISTENT storage: without it this origin's bucket is "best-effort" and the browser
// may evict the whole offline cache — cached incident workspaces, queued media, unsynced edits —
// under disk pressure, with no error to catch. Deliberately NOT awaited: nothing on the boot path
// may block first paint (that was the af9b842 white-screen class of bug).
void requestPersistentStorage()

// PWA: register the service worker (precaches the app shell + runtime-caches map tiles
// and reference data so the tool launches and renders offline on station/vehicle tablets).
// registerType 'prompt' → a new build installs and WAITS (no silent mid-incident reload); the
// UpdateBanner announces that it will activate on the next full app start. swUpdate also polls
// every five minutes so always-on tablets that never reload still discover a fresh deploy.
initServiceWorker()

// "Als App installieren": capture Chromium's beforeinstallprompt BEFORE React mounts (it can
// fire early and is lost if nothing listens) — the InstallGuide then offers one-tap install.
initInstallPrompt()

// The field app itself (App → IncidentWorkspace → MapView → maplibre, ~2 MB of script) is a
// lazy chunk too, so the capture poster (/e/) and /admin no longer download and parse it — the
// entry used to import it statically, which also made index.html modulepreload maplibre on
// EVERY route (perf sweep 23.09.2026). ⚠️ No extra round trip for the field app: the import is
// kicked off HERE, at module evaluation, for every route that will mount it (the main route and
// the link door, whose LinkApp imports App statically), so the chunk downloads in parallel with
// the boot awaits below (IDB migration, /api/config, locale) instead of after them. `lazy()`
// then resolves from the same, already-settled module promise.
const loadApp = () => import('./App')
// eslint-disable-next-line react-refresh/only-export-components -- the entry is never hot-swapped
const App = lazy(loadApp)
const bootPath = window.location.pathname
/** the routes that mount the field app: everything but the capture poster and /admin */
const fieldRoute = !bootPath.startsWith('/e/') && !bootPath.startsWith('/admin')
if (fieldRoute) void loadApp()

// Admin surface: an unlinked /admin route loaded as its OWN lazy chunk so field
// users (the overwhelming majority of loads) never download any admin code. The
// Suspense fallback reuses the same boot Splash as the auth Gate below.
const AdminApp = lazy(() => import('./admin/AdminApp'))

// Station capture (/e/<token>, the Erfassungs-Poster QR): its own lazy chunk, token-authed
// against /api/capture — no login, no auth provider, none of the field-app bundle.
const CaptureApp = lazy(() => import('./capture/CaptureApp'))

// Einsatz-Link (/l/<token>, the URL an external alerting system puts into the alert): its own
// lazy chunk like the capture view, token-exchanged against /api/incident-link/session — no
// login. Unlike capture it hands off to the normal field app afterwards, so it brings its own
// AuthProvider (mounted only once the session cookie exists — see LinkApp).
const LinkApp = lazy(() => import('./link/LinkApp'))

// Auth gate: hold the boot Splash while the /me probe settles, then show the
// kiosk login until someone is authenticated, then the app. The brand pulse +
// wordmark instead of a blank colour flash, so the launch feels continuous with
// the login screen that follows.
function Gate() {
  const { user, loading } = useAuth()
  return (
    <>
      <DemoRibbon />
      {loading ? <Splash /> : !user ? <LoginScreen /> : <Suspense fallback={<Splash />}><App /></Suspense>}
    </>
  )
}

// Nothing before createRoot may be unbounded. Anything still pending here is a LITERALLY blank
// screen — `#root` is empty, so there is no splash, no error boundary and nothing to tap, and
// killing the app just re-runs the same stall. Both awaits below therefore run inside
// `withBudget` — the config load INCLUDED, although it budgets its own network race: the cache
// read it falls back to after that race is an IndexedDB await, and one that never settles
// (idb.ts · OPEN_TIMEOUT_MS) would otherwise have held the blank page from outside the race.
// Past the budget each falls back to defaults; first paint is guaranteed either way.
const BOOT_BUDGET_MS = 4_000

/** Resolve `p`, or `fallback` if it hasn't settled within `ms`. The loser keeps running. */
function withBudget<T>(p: Promise<T>, ms: number, fallback: T): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined
  return Promise.race([
    p.catch(() => fallback),
    new Promise<T>((res) => { timer = setTimeout(() => res(fallback), ms) }),
  ]).finally(() => clearTimeout(timer))
}

// Resolve the deployment config (PUBLIC /api/config) BEFORE first render so per-deployment
// branding/defaults are in place from the very first paint and the synchronous accessor
// (getDeploymentConfig) is already populated when read sites run. From the device's cached copy
// when it has one (the network answer refreshes it behind the app); budgeted on a first boot.
void (async () => {
  // Base tiles a provider has since re-rendered under the same URL go before the map asks for
  // them (lib/tilePurge — the «seam» of 17.10.2026). Once per device, online only, not awaited.
  void purgeStaleTiles()
  try {
    // Move operational state (workspace caches, incident list, roster, config, outlines) from
    // localStorage into IndexedDB once, BEFORE anything reads its cache — loadDeploymentConfig's
    // offline fallback and WorkspaceSync.init both now read from IDB. Best-effort; budgeted too,
    // because a blocked IndexedDB upgrade (another tab holding the old version) never settles.
    await withBudget(migrateLocalStorageToIdb(), BOOT_BUDGET_MS, undefined)
    // Outer budget one second past the inner one: the inner race bounds a first boot's network
    // wait, the outer bound is only there for a cache read that never answers (see above).
    const cfg = await withBudget(bootDeploymentConfig(BOOT_BUDGET_MS, applyDeploymentBranding), BOOT_BUDGET_MS + 1_000, {})
    applyDeploymentBranding(cfg)
    markBoot('cfg')
    // The static cover now stays up until the app is on screen, so it carries the station name
    // React's <Splash> used to bring: into the line index.html reserves for it.
    const wordmark = document.querySelector('.boot-splash .loading-name')
    if (wordmark) wordmark.textContent = deploymentName()
    // station plan calibration (offline-cached) — so plans measure out of the box (#3). Its
    // route needs a session, so it is loaded once the account is known, not at this anonymous
    // point of the boot.
    onAccountKnown(() => { void loadStationPlanScales() })
    // …and re-read it whenever this device comes back to the foreground. The document holds
    // STATION data — the Massstab and the Georeferenz of a sheet — which somebody sets on the
    // KP tablet while the phone in the same Einsatz sits in a pocket. The boot load runs once,
    // so without this the other device only learned about it by being restarted.
    // Event-driven on purpose: no interval, no clock, nothing that ticks while the app is idle.
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible') void refreshStationPlanScales()
    })
    window.addEventListener('focus', () => { void refreshStationPlanScales() })
    // Resolve the UI language now that the deployment config is in: deployment locale →
    // de-CH. Awaited before first render, so appConfig.copy.* (a getter delegating to
    // config/copy · getCopy) is already in the right language from the first paint. A
    // non-German locale loads its overlay as its own chunk (precached, so offline too) —
    // budgeted like everything on the boot path: past the budget the app renders German
    // and the overlay applies when it lands (a reload picks it up fully).
    await withBudget(applyLocale(cfg.identity?.locale), BOOT_BUDGET_MS, undefined)
    // Prefetch the hazard reference datasets (ADR table + ERG — static assets since they
    // left the entry bundle, see lib/staticData). Deliberately NOT awaited: nothing on the
    // boot path may block first paint, and the surfaces re-render when they land
    // (lib/useHazardData). ⚠️ On IDLE, and only where the field app mounts (perf sweep
    // 23.09.2026): fetching and parsing ~660 KB of JSON right before createRoot competed with
    // the first render, and the capture poster and /admin never read a UN number at all. The
    // idle callback fires in the first quiet moment after first paint (2 s at the latest), and
    // both files are precached, so offline they land exactly as before.
    if (fieldRoute) whenIdle(() => { void ensureUnHazard(); void ensureErg() })
    // Tiles cached by releases before 08.11.2026 move from Cache Storage into the worker's tile
    // store (public/sw-tile-store.js), asked on every launch until it is done – well after the boot.
    setTimeout(() => navigator.serviceWorker?.controller?.postMessage({ type: 'kp-tile-migrate' }), 10_000)
  } catch (e) {
    // Boot init must never white-screen the kiosk: fall through to defaults and render.
    console.error('Boot init failed (continuing with defaults):', e)
  }
  // Route without a router lib: /admin renders the lazy admin chunk, everything
  // else is the unchanged field app. Both stay inside <AuthProvider>.
  const isAdmin = window.location.pathname.startsWith('/admin')
  const isCapture = window.location.pathname.startsWith('/e/')
  // The field app is a fixed-height, non-scrolling shell (the map fills the viewport), so
  // `body` carries `overflow: hidden` and `height: 100%`. The capture poster is the opposite:
  // an ordinary page that grows as sections open — and once it grew past the viewport, the part
  // below could not scroll and the unpainted area under the shell showed through WHITE. Mark the
  // document so the stylesheet can let this one page scroll and keep its background.
  if (isCapture) document.documentElement.classList.add('page-scroll')
  // /terminal is the enrolled Stations-Terminal — a standing link session without a token in
  // the address (its credential is a device cookie), routed through the same link chunk.
  const isLink = window.location.pathname.startsWith('/l/') || window.location.pathname === '/terminal'
  // The launch's timing line (lib/bootTiming) – the field app only: a link page's session may not
  // post outside its allow-list, and the poster and /admin are not what anyone launches at 3am.
  if (fieldRoute && !isLink) reportBoot((body) => apiBeacon('/api/diag/boot', body), GIT_SHA)
  markBoot('root')
  // React mounts BENEATH the static cover (index.html), which finishes its 630 ms arrival and
  // lifts once the app is on screen (lib/snailLaunch · liftBootCover): the app builds during the
  // entrance instead of after it, and a normal launch never shows React's own loading stages.
  const rootEl = document.getElementById('root')!
  void liftBootCover(rootEl)
  createRoot(rootEl).render(
    <StrictMode>
      {/* Root boundary: login, landing list, overlays, and the admin app used to sit
          OUTSIDE any boundary, so a throw there still white-screened. The inner
          per-incident boundary (App) stays — it recovers without tearing down auth. */}
      <ErrorBoundary>
        {isCapture ? (
          <Suspense fallback={<Splash />}><CaptureApp /></Suspense>
        ) : isLink ? (
          <Suspense fallback={<Splash />}><LinkApp /></Suspense>
        ) : (
          <AuthProvider>
            {isAdmin
              ? <Suspense fallback={<Splash />}><AdminApp /></Suspense>
              : <Gate />}
          </AuthProvider>
        )}
      </ErrorBoundary>
    </StrictMode>,
  )
})()
