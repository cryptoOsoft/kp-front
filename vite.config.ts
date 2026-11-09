/// <reference types="vitest/config" />

/*
 * **The precache is the field app; `/admin` is online-only** (2026-09-23). Every device used to
 * install the AdminApp chunk (~250 KB JS + ~90 KB CSS) and its lazy map/alignment chunks with
 * every deploy. `vite.config · adminOutsidePrecache` takes out what is reachable from
 * `src/admin/AdminApp.tsx` but not from the field entry (computed from the chunk graph, so a
 * chunk both import stays), and `navigateFallbackDenylist` sends an `/admin` navigation to the
 * network – a precached old shell would import an AdminApp hash the server no longer has.
 * Offline, `/admin` does not open. Both fail the build loudly if the shape they rely on changes.
 */
import { execSync } from 'node:child_process'
import { readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { defineConfig, loadEnv, type Plugin, type Rollup } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA, type VitePWAOptions } from 'vite-plugin-pwa'
import { resolveCustomMedia } from './src/lib/breakpoints.ts'
import { gradientPngs, splashGradients, startupImages } from './scripts/startup-images.mjs'

type RuntimeCache = NonNullable<NonNullable<VitePWAOptions['workbox']>['runtimeCaching']>[number]
type RuntimePlugin = NonNullable<NonNullable<RuntimeCache['options']>['plugins']>[number]
// Serialized into sw.js by Workbox: callbacks must use only worker globals and arguments.
// The custom worker asks a live page for its context after an idle restart. Checking in async
// hooks lets authenticated clients retain every reference strategy's existing offline behavior.
declare const self: { kpReferenceCacheAllowed: (event: Event, request: Request) => Promise<boolean> }
const referenceSessionPlugin: RuntimePlugin = {
  cachedResponseWillBeUsed: async ({ event, request, cachedResponse }) => {
    return await self.kpReferenceCacheAllowed(event, request) ? cachedResponse : undefined
  },
  requestWillFetch: async ({ event, request }) => {
    return await self.kpReferenceCacheAllowed(event, request) ? request : new Request(request, { cache: 'no-store' })
  },
  cacheWillUpdate: async ({ event, request, response }) => {
    return await self.kpReferenceCacheAllowed(event, request) ? response : null
  },
}

// Build stamp surfaced in the app menu so a tablet in the field can be matched to a
// known deploy: package version + short git SHA + build date. Docker/Railway builds have
// no .git (dockerignored) — there the sha arrives via the GIT_SHA env (Dockerfile ARG,
// fed by Railway's RAILWAY_GIT_COMMIT_SHA); 'dev' only when neither source exists.
// NOTE: update-landed detection does NOT rely on the sha (swUpdate.ts uses sha+BUILD_TIME).
// ⚠️ The sha and the time ride in index.html (buildStampMeta), never in the bundle: a string that
// changes with every build, compiled into the entry chunk, changed the entry's hash, and with it
// every lazy chunk that imports from the entry — 35 of 91 files, 2.7 MB that every device
// downloaded again for a deploy that changed nothing (cold-start sweep 01.11.2026).
const pkg = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf-8'))
let gitSha = 'dev'
try { gitSha = execSync('git rev-parse --short HEAD').toString().trim() } catch { /* no git */ }
if (gitSha === 'dev' && process.env.GIT_SHA) gitSha = process.env.GIT_SHA.slice(0, 7)
const buildTime = new Date().toISOString()

/** `<meta name="kp-build" content="<sha>@<time>">`, read by lib/buildInfo (see the note above). */
function buildStampMeta(): Plugin {
  return {
    name: 'kp-build-stamp-meta',
    transformIndexHtml: () => [{ tag: 'meta', attrs: { name: 'kp-build', content: `${gitSha}@${buildTime}` }, injectTo: 'head' }],
  }
}

// The boot screen must paint before ANY asset arrives. Use the React loader's source
// directly instead of maintaining a second copy of its paths and animation in index.html.
function inlineSnailLoader(): Plugin {
  const marker = '<!-- kp:snail-loader -->'
  return {
    name: 'kp-inline-snail-loader',
    transformIndexHtml(html, context) {
      if (context.filename !== resolve('index.html')) return html
      if (!html.includes(marker)) throw new Error('Boot splash is missing the snail loader marker')
      const artwork = readFileSync(new URL('./public/firefighter-snail-loader.svg', import.meta.url), 'utf-8')
      return html.replace(marker, `<div class="snail-loader" aria-hidden="true">${artwork}</div>`)
    },
  }
}

// iOS launch images: the splash background instead of black while iOS starts the installed app
// (scripts/startup-images.mjs has the why). Build only, emitted as plain files outside the
// precache (no png in globPatterns) – iOS fetches the one matching its screen itself.
function iosStartupImages(): Plugin {
  const screens = startupImages()
  return {
    name: 'kp-ios-startup-images',
    apply: 'build',
    // one run of tags without whitespace between them: Vite's tag injection puts a text node
    // before each, and the cold-start journey's DOM-node gate counts those too
    transformIndexHtml(html, context) {
      if (context.filename !== resolve('index.html')) return html
      const links = screens.flatMap(({ files }) => Object.values(files))
        .map(({ file, media }) => `<link rel="apple-touch-startup-image" media="${media}" href="/${file}">`).join('')
      return html.replace('</head>', `${links}</head>`)
    },
    generateBundle() {
      const gradients = splashGradients(readFileSync(resolve('index.html'), 'utf-8'))
      for (const { w, h, files } of screens) {
        const pngs = gradientPngs(w, h, gradients)
        for (const [scheme, { file }] of Object.entries(files)) this.emitFile({ type: 'asset', fileName: file, source: pngs[scheme] })
      }
    },
  }
}

// ⚠️ The web manifest is NOT a static file at runtime: the backend serves it
// (backend/app/webmanifest.py), overlaying the station's own name, accent colour and app
// icons onto the one built here, so the installed PWA on a crew tablet carries the station's
// identity and not ours.
//
// That only works if the service worker never answers for it. vite-plugin-pwa force-adds
// `manifest.webmanifest` to the precache list via workbox's `additionalManifestEntries` —
// `globPatterns` above neither matches it nor can exclude it, and `manifestTransforms` runs
// BEFORE that entry is appended (workbox-build/src/lib/transform-manifest.ts: "Run
// additionalManifestEntriesTransform last"), so neither knob reaches it. A precached manifest
// is frozen at service-worker INSTALL time, which is exactly the state this feature has to
// survive: a station that rebrands after the tablets were set up would keep the old identity
// until the next deploy.
//
// So the entry is removed from the generated sw.js after vite-plugin-pwa writes it. Nothing
// is lost offline — the OS keeps its own copy of an installed app's manifest, and the manifest
// is only ever read when the app is (re-)added to a home screen.
//
// Deliberately LOUD: if a vite-plugin-pwa/workbox upgrade changes the generated shape, the
// build fails here rather than silently restoring the stale-manifest behaviour.
function dropManifestFromPrecache(): Plugin {
  const ENTRY = /,?\{url:"manifest\.webmanifest",revision:"[^"]*"\},?/
  let outDir = 'dist'
  return {
    name: 'kp-drop-manifest-from-precache',
    apply: 'build',
    // `enforce: 'post'` puts us in the same ordering bucket as VitePWA's build plugin, so
    // the array order below decides — without it rollup sorts us into the earlier bucket and
    // we run before sw.js has been written.
    enforce: 'post',
    configResolved(config) { outDir = resolve(config.root, config.build.outDir) },
    // `sequential` is required, not cosmetic: rollup runs closeBundle hooks in PARALLEL by
    // default, and VitePWA declares its own as sequential — without this we race it and find
    // no sw.js at all. Plugin order in the array then puts us after it.
    closeBundle: {
      sequential: true,
      handler() {
        const swPath = resolve(outDir, 'sw.js')
        const sw = readFileSync(swPath, 'utf-8')
        if (!ENTRY.test(sw)) {
          throw new Error(
            'kp-drop-manifest-from-precache: no manifest.webmanifest entry found in the generated '
            + 'sw.js. Either vite-plugin-pwa stopped precaching it (then delete this plugin) or the '
            + 'generated shape changed (then fix the pattern) — do NOT ship a precached manifest.',
          )
        }
        // keep exactly one separator when the entry sat between two others
        writeFileSync(swPath, sw.replace(ENTRY, (m) => (m.startsWith(',') && m.endsWith(',') ? ',' : '')))
      },
    },
  }
}

// ⚠️ The Verwaltung (/admin) is NOT precached (2026-09-23). Every device installed the whole
// AdminApp chunk (~250 KB JS + ~90 KB CSS, plus its lazy map/alignment chunks) with every
// deploy, although /admin is opened by one person on one laptop, online — it cannot do anything
// without the API anyway. The set is computed from the CHUNK GRAPH, not from file names: what is
// reachable from AdminApp but not from the field entry without passing through it. A chunk the
// field app also imports (appConfig, api, the shared vendor chunks) stays precached — so the
// field app offline is exactly what it was.
//
// Its twin is `navigateFallbackDenylist: /^\/admin/` below. Without it an /admin navigation is
// still answered by the PRECACHED index.html of whatever build the device's worker holds — and
// under registerType 'prompt' that is legitimately an old one — which then imports an AdminApp
// hash the server no longer has: a 404 on every device that had not restarted since the deploy
// (the pdf.worker story, AGENTS.md). Going to the network for the shell means /admin always boots
// the deploy it talks to. Offline, /admin is the browser's own offline page; accepted.
//
// Deliberately LOUD like the plugin above: no AdminApp chunk, or no AdminApp entry in the
// precache list to take out, fails the build rather than silently precaching the admin again.
function adminOutsidePrecache(): { plugin: Plugin; isAdminOnly: (url: string) => boolean } {
  const adminOnly = new Set<string>()
  const plugin: Plugin = {
    name: 'kp-admin-outside-precache',
    apply: 'build',
    generateBundle(_options, bundle) {
      adminOnly.clear()
      const chunks = Object.values(bundle).filter((o): o is Rollup.OutputChunk => o.type === 'chunk')
      const byFile = new Map(chunks.map((c) => [c.fileName, c]))
      const admin = chunks.find((c) => c.facadeModuleId?.replaceAll('\\', '/').endsWith('/src/admin/AdminApp.tsx'))
      if (!admin) throw new Error('kp-admin-outside-precache: no chunk for src/admin/AdminApp.tsx — did it move? Fix the path here.')
      /** every file (chunk, its CSS, its assets) reachable from `from`, never walking into `stop` */
      const reach = (from: Rollup.OutputChunk[], stop?: Rollup.OutputChunk) => {
        const seen = new Set<string>()
        const todo = [...from]
        while (todo.length) {
          const c = todo.pop()!
          if (c === stop || seen.has(c.fileName)) continue
          seen.add(c.fileName)
          for (const f of c.viteMetadata?.importedCss ?? []) seen.add(f)
          for (const f of c.viteMetadata?.importedAssets ?? []) seen.add(f)
          for (const f of [...c.imports, ...c.dynamicImports]) {
            const next = byFile.get(f)
            if (next) todo.push(next)
          }
        }
        return seen
      }
      const field = reach(chunks.filter((c) => c.isEntry), admin)
      for (const f of reach([admin])) if (!field.has(f)) adminOnly.add(f)
    },
  }
  return { plugin, isAdminOnly: (url) => adminOnly.has(url) }
}

// `@media (--phone)` → the query `lib/breakpoints` holds for the JS side too (07.10.2026). A
// ten-line PostCSS plugin instead of postcss-custom-media: that one resolves a name only inside
// the file that declares it, and every CSS module is its own file, so it needs a second package
// to inject the definitions everywhere. This reads them from the module useIsPhone re-exports,
// which is the point — the CSS cannot drift from PHONE_QUERY. Runs in dev and build alike;
// an unknown name or a name inside a compound query stops the build (resolveCustomMedia).
// ⚠️ A file another module `composes: … from` is read by postcss-modules' own loader, which
// runs NO user plugin: a name in Surface.module.css reached the browser as `@media (--phone)`
// and never matched. Such a file keeps the literal query (breakpoints.test pins it), and
// `customMediaResolved` fails the build if a name survives into any emitted stylesheet.
function customMedia() {
  return {
    postcssPlugin: 'kp-custom-media',
    AtRule: {
      media(rule: { params: string }) {
        const params = resolveCustomMedia(rule.params)
        if (params !== rule.params) rule.params = params
      },
    },
  }
}

function customMediaResolved(): Plugin {
  return {
    name: 'kp-custom-media-resolved',
    apply: 'build',
    enforce: 'post',   // after vite:css-post has emitted the stylesheets
    generateBundle(_, bundle) {
      for (const f of Object.values(bundle)) {
        if (f.type !== 'asset' || !f.fileName.endsWith('.css')) continue
        const css = typeof f.source === 'string' ? f.source : new TextDecoder().decode(f.source)
        const hit = /@media[^{]*\(--[a-z0-9-]+\)/.exec(css)
        if (!hit) continue
        const msg = `${f.fileName}: unresolved custom media «${hit[0]}» — see vite.config · customMedia`
        // printed as well as thrown: vite-plugin-pwa's closeBundle then fails on the half-written
        // dist and its error is the one the build reports
        console.error(`✗ ${msg}`)
        throw new Error(msg)
      }
    },
  }
}

// https://vite.dev/config/
export default defineConfig(({ mode }) => {
  const adminPrecache = adminOutsidePrecache()
  const env = loadEnv(mode, process.cwd(), '')
  // kp-rueck backend (Traccar GPS feed). Proxying /api in dev means the browser
  // talks to the Vite origin and Vite forwards server-side, so the live vehicle
  // feed works without kp-rueck having to whitelist this app's origin for CORS.
  // VITE_API_PROXY overrides ONLY the dev proxy target, independent of the client fetch base
  // (which comes from VITE_KP_RUECK_URL). This lets the browser keep talking to the Vite origin
  // (same-origin, no CORS) while /api is forwarded to a local kp-front backend on another port.
  const apiTarget = env.VITE_API_PROXY || env.VITE_KP_RUECK_URL || 'http://localhost:8000'
  return {
    define: {
      __APP_VERSION__: JSON.stringify(pkg.version),
    },
    // ⚠️ The pdf.js WORKER must stay out of the dep optimizer. lib/pdfWorkerEntry imports it
    // bare, and in dev the optimizer answered that import with 504 «Outdated Optimize Dep» —
    // the worker died, pdf.js fell back to the fake worker, whose main-thread import of the
    // same URL died the same way («Setting up fake worker failed», 08.09.). It is one
    // self-contained minified ESM with nothing to pre-bundle, so serving it as source is free.
    optimizeDeps: { exclude: ['pdfjs-dist/build/pdf.worker.min.mjs'] },
    // jsPDF's three optional peers never run here (src/lib/unbundled.ts has the why): aliased
    // to a stub, so their chunks leave the build and the precache.
    resolve: {
      alias: Object.fromEntries(['html2canvas', 'canvg', 'dompurify'].map((lib) => [lib, resolve('src/lib/unbundled.ts')])),
    },
    css: { postcss: { plugins: [customMedia()] } },
    plugins: [
      inlineSnailLoader(),
      iosStartupImages(),
      buildStampMeta(),
      customMediaResolved(),
      react(),
      VitePWA({
        // 'prompt' (not 'autoUpdate'): a fresh deploy installs and WAITS instead of silently
        // taking over and reloading the page — so the app is never swapped out from under an
        // operator mid-incident (the 3am rule). Boot-time discoveries apply silently; a
        // mid-session deploy is only announced by the banner and becomes active on the next
        // app start (in-place skipWaiting reloads proved unreliable on iOS standalone).
        registerType: 'prompt',
        injectRegister: 'auto',
        // App shell is precached for offline launch on station/vehicle tablets.
        includeAssets: ['icons/apple-touch-icon.png'],
        manifest: {
          name: 'kp-front Einsatzkarte',
          short_name: 'kp-front',
          description: 'Operative Einsatzkarte der Feuerwehr — Einsätze, Pläne, Fahrzeuge.',
          lang: 'de-CH',
          display: 'standalone',
          orientation: 'any',
          // An Einsatz-Link (/l/<token>) is in scope, so an installed app should open it
          // instead of a browser tab — the responder already has the map tiles cached.
          // Chromium honours both fields; iOS home-screen web apps do NOT capture links
          // and will open Safari regardless. Half the crew lands in a browser either way,
          // which is fine: the link surface works there too.
          handle_links: 'preferred',
          // A second dispatch group for the same Einsatz must focus the running app, not
          // stack another window on top of the Lage someone is already working in.
          launch_handler: { client_mode: 'focus-existing' },
          start_url: '/',
          scope: '/',
          theme_color: '#1b2330',
          background_color: '#1b2330',
          icons: [
            { src: 'icons/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
            { src: 'icons/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
            { src: 'icons/icon-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
          ],
          // long-press the home-screen icon → jump straight to the two most likely
          // cold-start intents. The URLs ride the existing ?kpn= boot-target machinery
          // (lib/notifyTarget): 'divera' opens the intake pool (editor-gated in App),
          // 'journal' opens the Verlauf once the incident is mounted. German like the
          // rest of the manifest — it's baked at build time, before the deployment
          // locale is known.
          shortcuts: [
            { name: 'Neuer Einsatz', url: '/?kpn=divera', icons: [{ src: 'icons/icon-192.png', sizes: '192x192', type: 'image/png' }] },
            { name: 'Verlauf', url: '/?kpn=journal', icons: [{ src: 'icons/icon-192.png', sizes: '192x192', type: 'image/png' }] },
          ],
        },
        workbox: {
          // Once the waiting worker is activated (via our SKIP_WAITING on apply), claim the
          // already-open page so `controllerchange` fires and the reload actually swaps in the new
          // build. Without this (workbox default is false under registerType 'prompt') the new
          // worker activates but never controls the live tab, so applying an update just spins the
          // "wird geladen" overlay until the watchdog reloads — often back into the stale build.
          clientsClaim: true,
          // ⚠️ `mjs` IS LOAD-BEARING. pdf.js' 1.2 MB worker is imported with `?url`, so Vite
          // emits it as an ASSET keeping its own extension (pdf.worker.min-<hash>.mjs) rather
          // than as a `.js` chunk. Without `mjs` here the precache contained only the 68-byte
          // stub module that HOLDS that URL, never the worker itself — so the one file the
          // whole PDF stack cannot work without was fetched from the server on every open.
          // Combined with `registerType: 'prompt'` (a tablet legitimately stays on an old build
          // until the app is fully closed, which an installed iOS app never is) that meant:
          // deploy → the old hash is gone from the server → 404 → EVERY PDF fails, on exactly
          // the devices that had not restarted, while the rest of the app ran fine out of their
          // precache. Field report 2026-08-25 («PDF konnte nicht geladen werden», all PDFs, a
          // few devices, no pattern). Adding an extension here is never cosmetic — check what
          // is emitted with it (`ls dist/assets`) before removing one.
          globPatterns: ['**/*.{js,mjs,css,html,svg,woff2,json}'],
          // ⚠️ The build writes hidden sourcemaps (build.sourcemap below). None of them may be
          // precached: they are for the person reading a crash, never for the tablet, and together
          // they are several times the size of the code they describe. `**/*.map` is not matched
          // by the patterns above today — this says so explicitly, and scripts/check-sourcemaps.mjs
          // (CI) fails the build if a `.map` ever reaches the manifest anyway.
          globIgnores: ['**/*.map'],
          // …and the generated service worker gets none: vite-plugin-pwa inherits `build.sourcemap`
          // for it but not the `hidden` part, so sw.js and workbox-*.js came out POINTING at maps
          // of Workbox's own code, which nobody will ever need to symbolicate.
          sourcemap: false,
          // The worker's half of the launch timing line, notification routing, and the auth-aware
          // incident-media cache, and the map + plan tiles in IndexedDB. Imported before Workbox
          // registers routes; sw-media-cache owns /api/media/* itself, sw-tile-store the tiles
          // and plan-tile manifests (out of Cache Storage: its size is a launch cost on iOS).
          importScripts: ['sw-boot-timing.js', 'sw-notify.js', 'sw-media-cache.js', 'sw-tile-store.js'],
          // maplibre + pdf.worker chunks are large; precache them so the shell works offline.
          maximumFileSizeToCacheInBytes: 6 * 1024 * 1024,
          navigateFallback: '/index.html',
          // never let the SPA fallback shadow the API or health probe — nor /admin, whose chunks
          // are not precached: its shell has to come from the deploy that serves them
          // (adminOutsidePrecache above).
          navigateFallbackDenylist: [/^\/api\//, /^\/health/, /^\/admin/],
          // /admin's own chunks leave the precache list (adminOutsidePrecache above).
          manifestTransforms: [
            (entries) => {
              const manifest = entries.filter((e) => !adminPrecache.isAdminOnly(e.url))
              if (manifest.length === entries.length) {
                throw new Error('kp-admin-outside-precache: no AdminApp file in the precache list — '
                  + 'the manifest shape changed; do NOT ship a worker that installs /admin on every device.')
              }
              return { manifest, warnings: [] }
            },
          ],
          cleanupOutdatedCaches: true,
          runtimeCaching: [
            {
              // The map's glyph ranges (public/fonts · lib/mapView MAP_GLYPHS): fetched by the map
              // the first time a name is drawn, and by the offline download. Not precached – 1 MB
              // most devices fetch only two files of. They never change under one URL.
              urlPattern: /\/fonts\/[\w-]+\/\d+-\d+\.pbf$/,
              handler: 'CacheFirst',
              options: { cacheName: 'map-glyphs', cacheableResponse: { statuses: [200] } },
            },
            {
              // The swisstopo height profile of a path (lib/profile · fetchElevationProfile, its
              // path in the URL): what a Leitung's Wassertransport plans its pumps on (lib/
              // linePumps). Without it a reload OFFLINE planned them on flat ground, and the
              // Motorspritzen a Leitung draws stood elsewhere than an hour before (05.11.2026).
              // Network first – the terrain does not change, but a moved Leitung is a new URL
              // anyway – with a short timeout, so a weak signal answers from the copy. Bounded:
              // a dragged Leitung leaves one path per pause.
              urlPattern: /^https:\/\/api3\.geo\.admin\.ch\/rest\/services\/profile\.json\?/,
              handler: 'NetworkFirst',
              options: {
                cacheName: 'height-profiles',
                networkTimeoutSeconds: 4,
                cacheableResponse: { statuses: [200] },
                expiration: { maxEntries: 300, maxAgeSeconds: 60 * 60 * 24 * 30 },
              },
            },
            {
              // The station catalogue and point facts already have their offline copy in
              // IndexedDB (lib/api/stationReference). A stale-first Workbox answer hid changes
              // and could answer a link with the account's full register before its 403 arrived.
              // Before the generic reference rule; the worker also gates all reference caches
              // by client session (public/sw-media-cache.js), including old cached entries.
              urlPattern: /\/api\/reference\/(?:objects|building)(?:\?|$)/,
              handler: 'NetworkOnly',
            },
            {
              // A plan revision's APPROVED ALIGNMENTS (`/api/reference/plan:x/alignments?v=3`)
              // are never the service worker's to keep (24.09.2026, Feueralarm root cause B). The
              // pinned-PDF rule below matched them — `[^?]*` runs through `/alignments` — and
              // served them cache-first forever: a withdrawn approval never reached the device,
              // and the stored answer's `X-Server-Time` (days old) pulled the shared clock back
              // mid-Einsatz. The approval is live state; the offline copy lives in IndexedDB
              // (lib/api/reference · getApprovedPlanAlignments), which falls back only when the
              // fetch fails. ⚠️ Listed before every other /api/reference route.
              urlPattern: /\/api\/reference\/[^/?]+\/alignments(?:\?|$)/,
              handler: 'NetworkOnly',
            },
            {
              // The region's outline sets — its underground buildings («Unterirdische Bauten»,
              // backend app/underground) and its houses (app/houses, a Karte building tap):
              // megabytes, kept on the device in IndexedDB (lib/api/stationReference ·
              // loadOutlineSet), which also asks with the set it holds. A second copy in the
              // 50-entry `reference-data` cache below would only evict the symbols and serve an
              // old set stale-first. ⚠️ Before the generic reference rule.
              urlPattern: /\/api\/reference\/(?:underground|houses)(?:\?|$)/,
              handler: 'NetworkOnly',
            },
            {
              // A PINNED plan revision (`/api/reference/plan:x?v=3`) is IMMUTABLE by construction
              // — replaced bytes are a new `plan_revisions` row and therefore a new `v` — so it
              // is cache-first: opened once, it opens offline and costs no request again. Its own
              // cache because these are PDFs of tens of megabytes, which would evict the 50 small
              // symbol/geojson entries of the rule below within one Einsatz.
              // ⚠️ Listed FIRST: Workbox takes the first matching route.
              // ⚠️ And purged with the others on an explicit denial (public/sw-media-cache.js).
              urlPattern: /\/api\/reference\/plan(%3A|:)[^?]*\?(?:[^#]*&)?v=\d+/i,
              handler: 'CacheFirst',
              options: {
                cacheName: 'reference-plans',
                plugins: [referenceSessionPlugin],
                cacheableResponse: { statuses: [200] },
                expiration: { maxEntries: 60, maxAgeSeconds: 60 * 60 * 24 * 90 },
              },
            },
            {
              // A checklist IMAGE (`/api/reference/checklists:<id>:p<N>`): an Anleitung's step
              // picture or a playbook diagram (05.10.2026). Its own cache, filled in the
              // background when the templates load (lib/checklists · warmManualImages), so an
              // Anleitung opened for the first time offline still has its pictures — and so a
              // few dozen images cannot evict the 50 symbol/geojson entries of the rule below.
              // Cache-first: the URL carries the asset's version (`?v=`, lib/checklists ·
              // checklistAssetUrl, review round 2 19.10.2026), a replaced picture has a new
              // address – so no request on every open (stale-while-revalidate asked the server
              // each time, and the device cards popped in). ⚠️ Before the generic reference rule;
              // purged on an explicit denial with the others (public/sw-media-cache.js).
              urlPattern: /\/api\/reference\/checklists(%3A|:)[^/?:%]+(%3A|:)p\d+(\?v=\d+)?$/i,
              handler: 'CacheFirst',
              options: {
                cacheName: 'checklist-assets',
                plugins: [referenceSessionPlugin],
                cacheableResponse: { statuses: [200] },
                expiration: { maxEntries: 400, maxAgeSeconds: 60 * 60 * 24 * 180, purgeOnQuotaError: true },
              },
            },
            {
              // Reference datasets (symbols + geojson) — keep fresh when online, usable offline.
              urlPattern: /\/api\/reference\/.*/,
              handler: 'StaleWhileRevalidate',
              options: {
                cacheName: 'reference-data',
                plugins: [referenceSessionPlugin],
                cacheableResponse: { statuses: [0, 200] },
                expiration: { maxEntries: 50, maxAgeSeconds: 60 * 60 * 24 * 30 },
              },
            },
            {
              // Bundled symbols fallback plus the fetched hazard datasets (lib/staticData:
              // un-hazard.json = ADR Table A, erg.json = ERG distances). All three are
              // precached (the json glob above), which answers first — this rule is the
              // belt for an evicted/partial precache. (Plan PDFs and reference geodata are
              // no longer bundled — both are served from /api/reference, cached by the
              // rule above.)
              urlPattern: /\/(tactical-symbols|un-hazard|erg)\.json$/,
              handler: 'CacheFirst',
              options: {
                cacheName: 'static-data',
                expiration: { maxEntries: 60, maxAgeSeconds: 60 * 60 * 24 * 30 },
              },
            },
          ],
        },
        devOptions: { enabled: false },
      }),
      adminPrecache.plugin,
      // MUST stay after VitePWA — it rewrites the sw.js that plugin has just written.
      dropManifestFromPrecache(),
    ],
    server: {
      // Loopback-only by default (SEC-11): a bare `pnpm dev` no longer exposes the dev server —
      // and its known-vulnerable-class advisories — to the whole LAN. Set VITE_LAN=1 to restore
      // the tablet-over-LAN workflow (`VITE_LAN=1 pnpm dev`) when testing on a real device.
      // Strictly `=== '1'`: a bare truthiness test would bind to the LAN for `VITE_LAN=0` and
      // `VITE_LAN=false` too (non-empty strings are truthy), the opposite of what the operator meant.
      host: env.VITE_LAN === '1' ? true : undefined,
      port: 5188,
      strictPort: true,
      proxy: { '/api': { target: apiTarget, changeOrigin: true } },
    },
    test: {
      // Fast, dependency-light unit tests for pure lib code. jsdom only where a test needs
      // the DOM (the hook test); most run in the default node environment.
      environment: 'node',
      include: ['src/**/*.test.ts', 'src/**/*.test.tsx', 'scripts/**/*.test.mjs'],
      // Coverage (08.10.2026): CI runs the suite ONCE, with coverage (`pnpm test:coverage`), and
      // fails below the floor in scripts/coverage-floor.json. The floor only goes up —
      // `pnpm coverage:raise` after a run lifts it to what was measured (minus half a point of
      // slack, so an unrelated refactor does not trip it) and never lowers it. Components count
      // too: a surface without a test should show as a gap, not be outside the measurement.
      coverage: {
        provider: 'v8',
        include: ['src/**/*.{ts,tsx}'],
        exclude: ['src/**/*.test.{ts,tsx}', 'src/**/*.setup.tsx', 'src/**/*.bench.ts', 'src/**/*.d.ts'],
        reporter: ['text-summary', 'json-summary'],
        thresholds: JSON.parse(readFileSync(new URL('./scripts/coverage-floor.json', import.meta.url), 'utf-8')).floor,
      },
    },
    build: {
      // ⚠️ HIDDEN sourcemaps (24.09.2026): written next to every chunk, referenced by none. Without
      // them a field stack is `at Xe (index-abc.js:1:234567)` and says nothing — the 23.09. crash
      // had to be found by reading the code. `hidden` rather than `true` so no bundle carries a
      // `sourceMappingURL` (a browser would fetch the maps for every devtools user, and a tablet
      // has no use for them); the repo is public, so the maps themselves are no secret. They ship
      // in the image and are served beside the chunks — how to symbolicate: docs/SOURCEMAPS.md.
      // scripts/check-sourcemaps.mjs (CI) holds all three facts: maps exist, no bundle points at
      // them, the service worker precaches none.
      sourcemap: 'hidden',
      // The browser floor (13.10.2026): Safari/iPadOS 15.4, Chrome/Edge 98, Firefox 94. It is set
      // by what the app already calls unpolyfilled — `structuredClone` in the journal, audit and
      // workspace-sync stores — not by a wish; MapLibre 6 (`Object.hasOwn` / `Array.at`, Safari
      // 15.4 / Chrome 93, plus WebGL2) fits under it. `color-mix()` is newer still but only
      // degrades styling. iPadOS 15.4+ covers every iPad that ever ran iPadOS 15 (Air 2 / mini 4
      // end on 15.8). Lowering this does not make an older device work: these APIs are not
      // transpiled, only syntax is.
      target: ['es2020', 'safari15.4', 'chrome98', 'edge98', 'firefox94'],
      rolldownOptions: {
        output: {
          // Split maplibre (~1 MB since v6, ~800 KB in v4) into its own chunk so it no longer
          // bloats the initial app chunk. pdfjs deliberately has NO group here: PdfViewport's dynamic import
          // already splits it into a lazy chunk on its own, and a manual group made it
          // EAGER — rolldown placed the shared module-preload helper inside the pdfjs
          // chunk, so the entry statically imported the whole 470 KB of pdf.js to reach it
          // and index.html modulepreloaded it on every boot (profiling 11.09.2026). After
          // editing this block check `dist/index.html`: it must not preload a pdfjs chunk.
          // ⚠️ The group takes maplibre's SCRIPT only (23.09.2026). Its stylesheet is imported by
          // main.tsx, ahead of app.css, so the cascade stays what it always was (app.css overrides
          // `.maplibregl-*` at equal specificity) now that the field app is a lazy chunk — and a
          // group that also matched the .css pulled the entry into depending on the maplibre
          // chunk, which put its 790 KB modulepreload back into index.html on every route.
          // ⚠️ `.mjs` since MapLibre 6 (ESM-only: maplibre-gl.mjs + maplibre-gl-shared.mjs). A
          // `.js`-only test silently matches nothing — on 23.09.2026 rolldown's own split happened
          // to produce the same chunk anyway, but that is luck, not this rule. The worker is not
          // in this group: lib/maplibreWorker has Vite emit it as its own self-contained asset.
          codeSplitting: {
            groups: [
              { name: 'maplibre', test: /\/node_modules\/maplibre-gl\/.*\.m?js$/ },
            ],
          },
        },
      },
    },
  }
})
