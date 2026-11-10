// Imported FIRST into the workbox-generated service worker (vite.config workbox.importScripts).
// The worker's half of the launch timing line (src/lib/bootTiming): when this worker started
// evaluating and when the page's navigation reached it, as epoch milliseconds, so the page can
// place both on its own timeline. Added 08.11.2026: on the owner's iPhone ~0.9 s passed between
// the worker starting and the first byte of index.html, and only the worker can split that.
// A worker already running from an earlier page reports an `evalAt` before the navigation.
const kpBootTiming = { evalAt: performance.timeOrigin + performance.now() }

self.addEventListener('fetch', (event) => {
  // the latest navigation: a warm worker may have answered earlier pages
  if (event.request.mode === 'navigate') kpBootTiming.navAt = performance.timeOrigin + performance.now()
})

self.addEventListener('message', (event) => {
  if (event.data?.type === 'kp-boot-timing') event.ports[0]?.postMessage(kpBootTiming)
})
