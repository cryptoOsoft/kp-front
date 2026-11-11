// Imported into the workbox-generated service worker (vite.config workbox.importScripts).
// Handles taps on system notifications: focus the existing app window (or open one) and tell
// the page which tab to show via postMessage. Without this, tapping a PWA notification did
// nothing — it didn't even bring the app to the front.
// Server Web Push (killed-app alarms: Atemschutz überfällig, Wiedervorlage fällig). The
// backend sends {title, body, tag, target}; the tag matches the in-app notification's tag
// so a foregrounded app's own notification and the push coalesce into one tray entry.
self.addEventListener('push', (event) => {
  let data = {}
  try { data = event.data ? event.data.json() : {} } catch { /* non-JSON push — show generic */ }
  const title = data.title || 'KP Front'
  const tag = data.tag || 'kp-front'
  // A killed-app «Neuer Einsatz» looked like any tray item (3am sweep §1.6, 23.10.2026): the
  // options mirror the in-app notify() (src/lib/alarm.ts) — icon, badge, the same vibration —
  // and the dispatch stays on the lock screen until somebody acts (requireInteraction). The
  // home-screen badge marks a fresh alarm until the app is next in front (src/main.tsx clears
  // it on every visibilitychange; the tap below clears it too) – and is not set at all while a
  // window is already on screen, which shows the alarm itself.
  const alarm = tag.indexOf('divera') === 0
  event.waitUntil((async () => {
    await self.registration.showNotification(title, {
      body: data.body || '',
      tag,
      renotify: true,
      icon: '/icons/icon-192.png',
      badge: '/icons/icon-192.png',
      vibrate: alarm ? [300, 100, 300, 100, 300] : [200, 100, 200],
      requireInteraction: alarm,
      data: { target: data.target || null },
    })
    if (alarm && self.navigator && self.navigator.setAppBadge) {
      const all = await self.clients.matchAll({ type: 'window', includeUncontrolled: true })
      const onScreen = all.some((c) => c.visibilityState === 'visible')
      if (!onScreen) {
        try { await self.navigator.setAppBadge(1) } catch { /* not supported */ }
      }
    }
  })())
})

self.addEventListener('notificationclick', (event) => {
  event.notification.close()
  const target = (event.notification.data && event.notification.data.target) || null
  event.waitUntil((async () => {
    if (self.navigator && self.navigator.clearAppBadge) {
      try { await self.navigator.clearAppBadge() } catch { /* not supported */ }
    }
    const all = await self.clients.matchAll({ type: 'window', includeUncontrolled: true })
    let client = all.find((c) => 'focus' in c) || null
    if (client) {
      try { await client.focus() } catch { /* focus can reject if not allowed */ }
      if (target) client.postMessage({ type: 'kp-notification-click', target })
    } else {
      // Cold start (app was killed — the case server push exists for): a postMessage would
      // arrive before the page mounts its listener and be lost, so carry the target in the
      // URL instead; the app consumes ?kpn= once at boot (src/lib/notifyTarget.ts).
      // «Neuer Objektbesuch» (target 'besuch:<id>') has an address of its own: the visit's
      // page, which the app opens as a deep link (objectVisits/route).
      const visit = target && target.indexOf('besuch:') === 0 ? target.slice(7) : null
      await self.clients.openWindow(visit ? '/besuche/' + encodeURIComponent(visit)
        : target ? '/?kpn=' + encodeURIComponent(target) : '/')
    }
  })())
})
