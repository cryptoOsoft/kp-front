import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { BUILD_TIME, GIT_SHA } from './buildInfo'
import { BOOT_APPLY_WINDOW_MS, MAX_AUTO_APPLY_ATTEMPTS, NEWER_BUILD_GRACE_MS, RELOAD_WATCHDOG_MS, RESUME_CHECK_MIN_GAP_MS } from './updatePolicy'

/* The service-worker update control (lib/swUpdate) is module state wired to browser globals and
 * to vite-plugin-pwa's `registerSW`. Every test boots a FRESH copy of the module against fakes —
 * the boot-time stamp is read at import, so the storage has to be seeded before `boot()` — and
 * drives it the way the plugin and the browser would: onRegisteredSW, onNeedRefresh, a
 * `controllerchange`, the clock. */

const BUILD_ID = `${GIT_SHA}@${BUILD_TIME}`
const JUST_UPDATED_KEY = 'kp-sw-just-updated'
const ATTEMPTS_KEY = 'kp-sw-auto-attempts'
const UPDATE_INTERVAL_MS = 5 * 60 * 1000

interface PwaOptions {
  immediate?: boolean
  onRegisteredSW?: (url: string, r: ServiceWorkerRegistration | undefined) => void
  onNeedRefresh?: () => void
  onNeedReload?: () => void
}
const pwa = vi.hoisted(() => ({
  options: null as PwaOptions | null,
  updateSW: null as unknown as ReturnType<typeof vi.fn>,
}))
const rememberSnailLaunch = vi.hoisted(() => vi.fn())
const forgetSnailLaunch = vi.hoisted(() => vi.fn())
vi.mock('./snailLaunch', () => ({ rememberSnailLaunch, forgetSnailLaunch }))
vi.mock('virtual:pwa-register', () => ({
  registerSW: (options: PwaOptions) => {
    pwa.options = options
    return pwa.updateSW
  },
}))

type SwUpdate = typeof import('./swUpdate')

let store: Map<string, string>
let win: EventTarget & { setTimeout: typeof setTimeout; location: { reload: ReturnType<typeof vi.fn> } }
let doc: EventTarget & { visibilityState: string }
let sw: EventTarget
let waiting: { postMessage: ReturnType<typeof vi.fn> }

beforeEach(() => {
  vi.useFakeTimers()
  vi.setSystemTime(new Date('2026-09-23T08:00:00Z'))
  vi.resetModules()
  pwa.options = null
  rememberSnailLaunch.mockReset()
  forgetSnailLaunch.mockReset()
  pwa.updateSW = vi.fn(() => Promise.resolve())
  store = new Map()
  vi.stubGlobal('localStorage', {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => { store.set(k, String(v)) },
    removeItem: (k: string) => { store.delete(k) },
  })
  win = Object.assign(new EventTarget(), {
    setTimeout: ((fn: () => void, ms?: number) => setTimeout(fn, ms)) as typeof setTimeout,
    location: { reload: vi.fn() },
  })
  vi.stubGlobal('window', win)
  // querySelector: lib/buildInfo reads the build stamp's <meta> at import (none here → 'dev')
  doc = Object.assign(new EventTarget(), { visibilityState: 'visible', querySelector: () => null })
  vi.stubGlobal('document', doc)
  sw = new EventTarget()
  vi.stubGlobal('navigator', { serviceWorker: sw })
  waiting = { postMessage: vi.fn() }
})

afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

/** Import a fresh module, run initServiceWorker, subscribe the way the banner does (mounted
 *  before the registration resolves), and hand the plugin a registration. */
async function boot(opts: { waitingAtBoot?: boolean } = {}) {
  const mod: SwUpdate = await import('./swUpdate')
  mod.initServiceWorker()
  const heard: boolean[] = []
  mod.onUpdateAvailable((a) => heard.push(a))
  const registration = {
    waiting: opts.waitingAtBoot ? waiting : null,
    update: vi.fn(() => Promise.resolve()),
  }
  pwa.options!.onRegisteredSW!('/sw.js', registration as unknown as ServiceWorkerRegistration)
  return { mod, registration, heard }
}

const attempts = () => (store.has(ATTEMPTS_KEY) ? JSON.parse(store.get(ATTEMPTS_KEY)!) as { n: number; at: number } : null)
const exhaustBudget = () => store.set(ATTEMPTS_KEY, JSON.stringify({ n: MAX_AUTO_APPLY_ATTEMPTS, at: Date.now() }))

describe('swUpdate — a build discovered at boot', () => {
  it('carries the launch clock only as the automatic reload actually starts, once', async () => {
    await boot()
    pwa.options!.onNeedRefresh!()
    expect(rememberSnailLaunch).not.toHaveBeenCalled() // an apply can stall or surrender
    pwa.options!.onNeedReload!()
    sw.dispatchEvent(new Event('controllerchange'))
    vi.advanceTimersByTime(RELOAD_WATCHDOG_MS + 1_000)
    expect(rememberSnailLaunch).toHaveBeenCalledTimes(1)
    expect(win.location.reload).toHaveBeenCalledTimes(1)
  })

  it('also carries the launch through the automatic watchdog reload', async () => {
    await boot()
    pwa.options!.onNeedRefresh!()
    vi.advanceTimersByTime(RELOAD_WATCHDOG_MS + 600)
    expect(rememberSnailLaunch).toHaveBeenCalledTimes(1)
    expect(win.location.reload).toHaveBeenCalledTimes(1)
  })

  it('retires a swallowed automatic reload before a deliberate retry', async () => {
    const { mod } = await boot()
    pwa.options!.onNeedRefresh!()
    vi.advanceTimersByTime(RELOAD_WATCHDOG_MS + 600)
    expect(rememberSnailLaunch).toHaveBeenCalledTimes(1)
    vi.advanceTimersByTime(3_400) // the existing surrender backstop at 8 s
    expect(forgetSnailLaunch).toHaveBeenCalledTimes(1)
    await mod.applyUpdateNow()
    sw.dispatchEvent(new Event('controllerchange'))
    expect(rememberSnailLaunch).toHaveBeenCalledTimes(1) // manual retry never creates a resume
    expect(win.location.reload).toHaveBeenCalledTimes(2)
  })

  it('is applied silently: one attempt spent, the old build stamped, skipWaiting posted — no banner', async () => {
    const { heard } = await boot()
    pwa.options!.onNeedRefresh!()
    expect(pwa.updateSW).toHaveBeenCalledWith(false)
    expect(store.get(JUST_UPDATED_KEY)).toBe(BUILD_ID)
    expect(attempts()?.n).toBe(1)
    expect(heard).toEqual([])
  })

  it('is only announced once the operator has touched anything', async () => {
    const { heard } = await boot()
    win.dispatchEvent(new Event('pointerdown'))
    pwa.options!.onNeedRefresh!()
    expect(pwa.updateSW).not.toHaveBeenCalled()
    expect(heard).toEqual([true])
    expect(attempts()).toBeNull()
  })

  it('is only announced once the boot window has passed', async () => {
    const { heard } = await boot()
    vi.advanceTimersByTime(BOOT_APPLY_WINDOW_MS + 1)
    pwa.options!.onNeedRefresh!()
    expect(pwa.updateSW).not.toHaveBeenCalled()
    expect(heard).toEqual([true])
  })

  it('is only announced when the automatic budget is spent — a wedged worker cannot reload-loop', async () => {
    exhaustBudget()
    const { heard } = await boot({ waitingAtBoot: true })
    pwa.options!.onNeedRefresh!()
    expect(pwa.updateSW).not.toHaveBeenCalled()
    expect(heard).toEqual([true])
  })

  it('reads unreadable storage as an exhausted budget: no counting, no automatic apply', async () => {
    const { heard } = await boot()
    vi.stubGlobal('localStorage', {
      getItem: () => { throw new Error('private mode') },
      setItem: () => { throw new Error('private mode') },
      removeItem: () => { throw new Error('private mode') },
    })
    pwa.options!.onNeedRefresh!()
    expect(pwa.updateSW).not.toHaveBeenCalled()
    expect(heard).toEqual([true])
  })
})

describe('swUpdate — the attempt budget at registration', () => {
  it('is cleared when no worker is waiting: the update it belonged to has resolved', async () => {
    exhaustBudget()
    await boot({ waitingAtBoot: false })
    expect(attempts()).toBeNull()
  })

  it('is kept while a worker is still waiting', async () => {
    exhaustBudget()
    await boot({ waitingAtBoot: true })
    expect(attempts()?.n).toBe(MAX_AUTO_APPLY_ATTEMPTS)
  })
})

describe('swUpdate — the previous page life ended in an update reload', () => {
  it('a DIFFERENT build booted: the update landed — the toast fires once, the budget resets', async () => {
    store.set(JUST_UPDATED_KEY, 'old-sha@2026-09-22T00:00:00Z')
    store.set(ATTEMPTS_KEY, JSON.stringify({ n: 1, at: Date.now() }))
    const mod: SwUpdate = await import('./swUpdate')
    expect(store.has(JUST_UPDATED_KEY)).toBe(false) // one-shot: consumed at import
    expect(attempts()).toBeNull()
    expect(mod.consumeJustUpdated()).toBe(true)
    expect(mod.consumeJustUpdated()).toBe(false)
  })

  it('the SAME build booted with the worker still waiting: the apply stalled — retried automatically', async () => {
    store.set(JUST_UPDATED_KEY, BUILD_ID)
    const { mod, heard } = await boot({ waitingAtBoot: true })
    expect(mod.consumeJustUpdated()).toBe(false) // never congratulate an update that did not happen
    expect(pwa.updateSW).toHaveBeenCalledWith(false)
    expect(attempts()?.n).toBe(1)
    expect(heard).toEqual([])
    sw.dispatchEvent(new Event('controllerchange'))
    expect(rememberSnailLaunch).toHaveBeenCalledTimes(1)
  })

  it('a stalled apply with the budget spent boots normally on the old build and announces', async () => {
    store.set(JUST_UPDATED_KEY, BUILD_ID)
    exhaustBudget()
    const { heard } = await boot({ waitingAtBoot: true })
    expect(pwa.updateSW).not.toHaveBeenCalled()
    expect(heard).toEqual([true])
  })

  it('no stamp at all: nothing to report', async () => {
    const mod: SwUpdate = await import('./swUpdate')
    expect(mod.consumeJustUpdated()).toBe(false)
  })
})

describe('swUpdate — onUpdateAvailable', () => {
  it('tells a late subscriber at once, every subscriber hears, and unsubscribe stops it', async () => {
    const { mod, heard } = await boot()
    win.dispatchEvent(new Event('keydown'))
    pwa.options!.onNeedRefresh!()
    const late: boolean[] = []
    const off = mod.onUpdateAvailable((a) => late.push(a))
    expect(late).toEqual([true]) // the menu mounting after the announcement still sees it
    off()
    sw.dispatchEvent(new Event('controllerchange'))
    expect(heard).toEqual([true, false])
    expect(late).toEqual([true])
  })

  it('retracts the banner when the announced build takes over from elsewhere, and earns a fresh budget', async () => {
    const { heard } = await boot()
    win.dispatchEvent(new Event('pointerdown'))
    pwa.options!.onNeedRefresh!()
    store.set(ATTEMPTS_KEY, JSON.stringify({ n: 2, at: Date.now() }))
    sw.dispatchEvent(new Event('controllerchange'))
    expect(heard).toEqual([true, false])
    expect(attempts()).toBeNull()
  })

  it('a controller change with nothing announced changes nothing', async () => {
    const { heard } = await boot()
    sw.dispatchEvent(new Event('controllerchange'))
    expect(heard).toEqual([])
  })
})

describe('swUpdate — applyUpdateNow (the operator’s own tap)', () => {
  async function announced() {
    const booted = await boot({ waitingAtBoot: true })
    win.dispatchEvent(new Event('pointerdown'))
    pwa.options!.onNeedRefresh!()
    return booted
  }

  it('is a no-op when nothing is waiting', async () => {
    const { mod } = await boot()
    await mod.applyUpdateNow()
    expect(pwa.updateSW).not.toHaveBeenCalled()
    expect(store.has(JUST_UPDATED_KEY)).toBe(false)
  })

  it('applies even with the automatic budget spent — a tap is a decision', async () => {
    exhaustBudget()
    const { mod } = await announced()
    await mod.applyUpdateNow()
    expect(pwa.updateSW).toHaveBeenCalledWith(false)
    expect(store.get(JUST_UPDATED_KEY)).toBe(BUILD_ID)
    expect(attempts()?.n).toBe(MAX_AUTO_APPLY_ATTEMPTS) // the tap does not spend the automatic budget
  })

  it('reloads exactly once when the new worker takes control', async () => {
    const { mod } = await announced()
    await mod.applyUpdateNow()
    sw.dispatchEvent(new Event('controllerchange'))
    sw.dispatchEvent(new Event('controllerchange'))
    vi.advanceTimersByTime(RELOAD_WATCHDOG_MS + 1_000) // the watchdog must not reload a second time
    expect(win.location.reload).toHaveBeenCalledTimes(1)
    expect(waiting.postMessage).not.toHaveBeenCalled()
    expect(rememberSnailLaunch).not.toHaveBeenCalled() // a deliberate update gets a fresh entrance
  })

  it('the plugin’s own reload on «controlling» joins the same guard — still exactly one reload', async () => {
    // vite-plugin-pwa 1.x reloads on workbox's 'controlling' unless onNeedReload is given, and
    // ignores updateSW's reloadPage argument: that reload used to race ours on the same event
    const { mod } = await announced()
    await mod.applyUpdateNow()
    pwa.options!.onNeedReload!() // the plugin's 'controlling' handler (registered first, fires first)
    sw.dispatchEvent(new Event('controllerchange')) // …and ours, on the same event
    vi.advanceTimersByTime(RELOAD_WATCHDOG_MS + 1_000)
    expect(win.location.reload).toHaveBeenCalledTimes(1)
  })

  it('an activation from elsewhere still reloads through the plugin, as before', async () => {
    await announced()
    pwa.options!.onNeedReload!()
    expect(win.location.reload).toHaveBeenCalledTimes(1)
  })

  it('a second tap while an apply is in flight does nothing', async () => {
    const { mod } = await announced()
    await mod.applyUpdateNow()
    await mod.applyUpdateNow()
    expect(pwa.updateSW).toHaveBeenCalledTimes(1)
  })

  it('the watchdog re-posts SKIP_WAITING straight to the worker, then reloads', async () => {
    const { mod } = await announced()
    await mod.applyUpdateNow()
    vi.advanceTimersByTime(RELOAD_WATCHDOG_MS)
    expect(waiting.postMessage).toHaveBeenCalledWith({ type: 'SKIP_WAITING' })
    expect(win.location.reload).not.toHaveBeenCalled()
    vi.advanceTimersByTime(600)
    expect(win.location.reload).toHaveBeenCalledTimes(1)
  })

  it('surrenders when the page outlives the forced reload: un-stamps, re-announces, and may be tapped again', async () => {
    const { mod, heard } = await announced()
    await mod.applyUpdateNow()
    vi.advanceTimersByTime(RELOAD_WATCHDOG_MS + 4_000)
    expect(store.has(JUST_UPDATED_KEY)).toBe(false)
    expect(heard).toEqual([true, true])
    await mod.applyUpdateNow()
    expect(pwa.updateSW).toHaveBeenCalledTimes(2)
  })
})

describe('swUpdate — deploy discovery', () => {
  it('polls every 5 minutes, and not while an apply is in flight', async () => {
    const { mod, registration } = await boot({ waitingAtBoot: true })
    vi.advanceTimersByTime(UPDATE_INTERVAL_MS)
    expect(registration.update).toHaveBeenCalledTimes(1)
    win.dispatchEvent(new Event('pointerdown'))
    pwa.options!.onNeedRefresh!()
    vi.advanceTimersByTime(UPDATE_INTERVAL_MS - 1_000)
    expect(registration.update).toHaveBeenCalledTimes(1)
    await mod.applyUpdateNow() // in flight for RELOAD_WATCHDOG_MS + 4 s, across the next tick
    vi.advanceTimersByTime(1_000)
    expect(registration.update).toHaveBeenCalledTimes(1)
  })

  it('checks on wake — but not twice within the minimum gap', async () => {
    const { registration } = await boot()
    doc.dispatchEvent(new Event('visibilitychange'))
    expect(registration.update).not.toHaveBeenCalled() // registration itself was the last check
    vi.setSystemTime(Date.now() + RESUME_CHECK_MIN_GAP_MS + 1) // the clock moves, no timer fires
    doc.dispatchEvent(new Event('visibilitychange'))
    expect(registration.update).toHaveBeenCalledTimes(1)
    doc.dispatchEvent(new Event('visibilitychange'))
    expect(registration.update).toHaveBeenCalledTimes(1)
  })

  it('a hidden page does not check', async () => {
    const { registration } = await boot()
    vi.setSystemTime(Date.now() + RESUME_CHECK_MIN_GAP_MS + 1)
    doc.visibilityState = 'hidden'
    doc.dispatchEvent(new Event('visibilitychange'))
    expect(registration.update).not.toHaveBeenCalled()
    doc.visibilityState = 'visible'
    doc.dispatchEvent(new Event('visibilitychange'))
    expect(registration.update).toHaveBeenCalledTimes(1)
  })
})

// sweep 30.10.2026 #19: an old cached build opened an Einsatz a newer build had saved, after the
// boot window (or a tap) — and stayed old, because the link view has no banner to announce it.
describe('swUpdate — requireNewerBuild (the Einsatz data came from a newer build)', () => {
  /** booted, the boot window over and the screen touched: the plain path would only announce */
  async function lateInSession(opts: { waitingAtBoot?: boolean } = {}) {
    const booted = await boot(opts)
    vi.setSystemTime(Date.now() + BOOT_APPLY_WINDOW_MS + 1)
    win.dispatchEvent(new Event('pointerdown'))
    const missing: boolean[] = []
    booted.mod.onNewerBuildMissing((m) => missing.push(m))
    return { ...booted, missing }
  }

  it('a build that arrives later is applied by itself — no boot window, no tap holds it back', async () => {
    const { mod, registration, heard, missing } = await lateInSession()
    registration.update.mockImplementation(() => Object.assign(registration, { installing: {} }) && Promise.resolve())
    mod.requireNewerBuild()
    await Promise.resolve()
    expect(registration.update).toHaveBeenCalledTimes(1)
    pwa.options!.onNeedRefresh!()
    expect(pwa.updateSW).toHaveBeenCalledWith(false)
    expect(attempts()?.n).toBe(1)
    expect(heard).toEqual([])
    expect(missing).toEqual([])
  })

  it('a build already waiting is applied at once', async () => {
    const { mod } = await lateInSession({ waitingAtBoot: true })
    pwa.options!.onNeedRefresh!() // announced mid-session, as before
    expect(pwa.updateSW).not.toHaveBeenCalled()
    mod.requireNewerBuild()
    expect(pwa.updateSW).toHaveBeenCalledWith(false)
  })

  it('asks once the registration is there when the data was read first', async () => {
    const mod: SwUpdate = await import('./swUpdate')
    mod.initServiceWorker()
    mod.requireNewerBuild()
    const registration = { waiting: null, update: vi.fn(() => Promise.resolve()) }
    pwa.options!.onRegisteredSW!('/sw.js', registration as unknown as ServiceWorkerRegistration)
    expect(registration.update).toHaveBeenCalledTimes(1)
  })

  it('nothing newer on the server, or offline: the row stands, and «Aktualisieren» starts afresh', async () => {
    for (const answer of [() => Promise.resolve(), () => Promise.reject(new Error('offline'))]) {
      vi.resetModules()
      const { mod, registration, missing } = await lateInSession()
      registration.update.mockImplementation(answer)
      mod.requireNewerBuild()
      await vi.advanceTimersByTimeAsync(0)
      expect(missing).toEqual([true])
      mod.updateForNewerData()
      expect(win.location.reload).toHaveBeenCalledTimes(1)
      win.location.reload.mockClear()
    }
  })

  it('a look that takes too long raises the row — and the build still applies when it lands', async () => {
    const { mod, registration, missing } = await lateInSession()
    registration.update.mockImplementation(() => Object.assign(registration, { installing: {} }) && new Promise<void>(() => {}))
    mod.requireNewerBuild()
    vi.advanceTimersByTime(NEWER_BUILD_GRACE_MS)
    expect(missing).toEqual([true])
    pwa.options!.onNeedRefresh!()
    expect(pwa.updateSW).toHaveBeenCalledWith(false)
  })

  it('with the automatic budget spent it does not apply: the row and the banner stand, the tap applies', async () => {
    exhaustBudget()
    const { mod, heard, missing } = await lateInSession({ waitingAtBoot: true })
    pwa.options!.onNeedRefresh!()
    mod.requireNewerBuild()
    expect(pwa.updateSW).not.toHaveBeenCalled()
    expect(missing).toEqual([true])
    expect(heard[heard.length - 1]).toBe(true)
    mod.updateForNewerData()
    expect(pwa.updateSW).toHaveBeenCalledWith(false)
  })
})
