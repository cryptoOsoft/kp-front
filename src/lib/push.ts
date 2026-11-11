import { apiGet, apiPost, ApiError } from './api'
import { linkPageOwnsSession } from './linkMode'
import { patchReadinessStore, readReadinessStore } from './alarmReadiness'

/**
 * Web-Push subscription (killed-app alarms). The in-app alarm layer covers a foregrounded
 * PWA; the server push covers a swiped-away / OS-reclaimed one. Best-effort by design:
 * subscribe whenever (a) the deployment has VAPID keys, (b) the browser supports push,
 * and (c) notification permission is already granted — permission itself is only ever
 * requested from a user gesture (ensureNotifyPermission), never here. (d) and never after
 * «Keine Alarme auf diesem Gerät» (lib/alarmReadiness · optedOut) until it is switched back on.
 *
 * Every successful registration is dated in the device's readiness record (`subscribedAt`): the
 * server drops a registration nobody renewed in 180 days, and the «Alarm-Abo» row turns red at
 * 150 so somebody sees it coming (3am sweep §1.3, 23.10.2026).
 */

function b64ToUint8(base64: string): Uint8Array {
  const pad = '='.repeat((4 - (base64.length % 4)) % 4)
  const raw = atob((base64 + pad).replace(/-/g, '+').replace(/_/g, '/'))
  return Uint8Array.from(raw, (c) => c.charCodeAt(0))
}

let attempted = false

type SubscriptionJson = { endpoint: string; keys: { p256dh: string; auth: string } }

/** This browser's subscription as the server wants it, or null when there is none (or it is unusable). */
async function currentSubscription(): Promise<SubscriptionJson | null> {
  try {
    if (!('serviceWorker' in navigator) || !('PushManager' in window)) return null
    const reg = await navigator.serviceWorker.ready
    const json = (await reg.pushManager.getSubscription())?.toJSON()
    if (!json?.endpoint || !json.keys?.p256dh || !json.keys?.auth) return null
    return { endpoint: json.endpoint, keys: { p256dh: json.keys.p256dh, auth: json.keys.auth } }
  } catch { return null }
}

/** Does this deployment push at all (a VAPID pair is configured)? Cached per page life. */
let available: Promise<boolean> | null = null
export function pushAvailable(): Promise<boolean> {
  available ??= apiGet<{ key: string | null; enabled: boolean }>('/api/push/vapid-key')
    .then((r) => !!r.key)
    .catch(() => { available = null; return false })
  return available
}

/** Idempotent per session; call after login and again after a permission grant. */
export async function ensurePushSubscription(force = false): Promise<boolean> {
  // ⚠️ Not from a page whose own link session answers (the Atemschutz-Link, the terminal): the
  // push routes are on no link allowlist, and each Trupp-Formular's permission ask
  // (alarm · ensureNotifyPermission) re-ran this as a 403 (RBAC audit §3, 22.10.2026). The
  // Atemschutz alarm still rings there – tone and the page's own notification.
  if (linkPageOwnsSession()) return false
  if (attempted && !force) return false
  attempted = true
  if (readReadinessStore().optedOut) return false
  try {
    if (typeof Notification === 'undefined' || Notification.permission !== 'granted') return false
    if (!('serviceWorker' in navigator) || !('PushManager' in window)) return false
    const { key } = await apiGet<{ key: string | null; enabled: boolean }>('/api/push/vapid-key')
    if (!key) return false // deployment has no VAPID keys — push disabled
    const reg = await navigator.serviceWorker.ready
    const sub =
      (await reg.pushManager.getSubscription()) ??
      (await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: b64ToUint8(key).buffer as ArrayBuffer,
      }))
    const json = sub.toJSON()
    if (!json.endpoint || !json.keys?.p256dh || !json.keys?.auth) return false
    await apiPost('/api/push/subscriptions', { endpoint: json.endpoint, keys: { p256dh: json.keys.p256dh, auth: json.keys.auth } })
    patchReadinessStore({ subscribedAt: Date.now() })
    return true
  } catch {
    return false // never let push plumbing break the app
  }
}

/** Renew this browser's registration WITHOUT a session: the subscription's own endpoint + keys
 *  are the credential (api/push · renew). For a device whose login lapsed — the server would
 *  otherwise drop the registration at 180 d and the next alarm would find nobody. */
export async function renewPushSubscription(): Promise<boolean> {
  const sub = await currentSubscription()
  if (!sub) return false
  try {
    const r = await fetch('/api/push/subscriptions/renew', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(sub) })
    if (!r.ok) return false
    patchReadinessStore({ subscribedAt: Date.now() })
    return true
  } catch { return false }
}

/** «Keine Alarme auf diesem Gerät»: drop the browser's subscription and the server's row, and
 *  remember the choice so no boot re-subscribes. Reversible: `enablePush`. */
export async function disablePush(): Promise<void> {
  patchReadinessStore({ optedOut: true, laterUntil: null })
  const sub = await currentSubscription()
  if (!sub) return
  // a DELETE with a body — api.ts's apiDelete carries none; same-origin cookies ride along
  try { await fetch('/api/push/subscriptions', { method: 'DELETE', headers: { 'content-type': 'application/json' }, body: JSON.stringify(sub) }) } catch { /* the row expires on its own */ }
  try {
    const reg = await navigator.serviceWorker.ready
    await (await reg.pushManager.getSubscription())?.unsubscribe()
  } catch { /* best-effort */ }
}

/** «Alarme aus · einschalten»: forget the opt-out and register again (permission permitting). */
export async function enablePush(): Promise<boolean> {
  patchReadinessStore({ optedOut: false })
  return ensurePushSubscription(true)
}

export type TestPushOutcome = 'sent' | 'wait' | 'unavailable' | 'unregistered' | 'failed'

/** «Testalarm senden»: one push to THIS browser's registration (api/push · test). Registers
 *  first when the browser holds no subscription yet, so the button works right after «Erlauben». */
export async function sendTestPush(): Promise<TestPushOutcome> {
  let sub = await currentSubscription()
  if (!sub) {
    await ensurePushSubscription(true)
    sub = await currentSubscription()
    if (!sub) return 'unregistered'
  }
  try {
    const r = await apiPost<{ ok: boolean; outcome: string }>('/api/push/test', { endpoint: sub.endpoint })
    if (!r.ok) return 'failed'
    patchReadinessStore({ lastTest: Date.now(), lastCheck: Date.now() })
    return 'sent'
  } catch (e) {
    if (e instanceof ApiError) {
      if (e.status === 429) return 'wait'
      if (e.status === 409) return 'unavailable'
      if (e.status === 404) {
        // the server no longer knows this registration (expired, pruned): register and retry once
        if (await ensurePushSubscription(true)) return sendTestPush()
        return 'unregistered'
      }
    }
    return 'failed'
  }
}

/** The home-screen badge the service worker sets on a «Neuer Einsatz» push (sw-notify.js) —
 *  cleared whenever the app is in front (App · visibilitychange), because then the app shows the
 *  alarm itself. Unsupported browsers: no-op. */
export function clearAppBadge(): void {
  try { void navigator.clearAppBadge?.() } catch { /* not supported */ }
}
