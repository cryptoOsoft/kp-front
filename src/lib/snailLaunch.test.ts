// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { readFileSync } from 'node:fs'

// Exercise the actual inline bootstrap: it runs before any bundle, including this module.
const resumeScript = readFileSync('index.html', 'utf8')
  .match(/<script id="snail-resume">([\s\S]*?)<\/script>/)![1]
const resumeBoot = () => new Function(resumeScript)()

beforeEach(() => {
  vi.resetModules()
  vi.useFakeTimers()
  sessionStorage.clear()
  vi.stubGlobal('matchMedia', vi.fn(() => ({ matches: false })))
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => setTimeout(() => callback(performance.now()), 16))
})

afterEach(() => {
  document.body.replaceChildren()
  vi.clearAllTimers()
  vi.useRealTimers()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

function boot(time = 0) {
  document.body.innerHTML = '<div class="boot-splash"><svg class="firefighter-snail" style="--snail-arrival-duration: 630ms"></svg></div>'
  const svg = document.querySelector('svg')!
  let finish!: () => void
  let cancel!: () => void
  // A running animation: its start time is fixed (the first frame has rendered).
  const animation: { animationName: string; currentTime: number; startTime: number | null; finished: Promise<void> } = {
    animationName: 'fs-arrival', currentTime: time, startTime: performance.now() - time,
    finished: new Promise<void>((resolve, reject) => { finish = resolve; cancel = () => reject(new Error('Cancelled')) }),
  }
  Object.defineProperty(svg, 'getAnimations', { configurable: true, value: vi.fn(() => [animation]) })
  return { svg, animation, finish, cancel }
}

function reactSvg() {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg')
  svg.style.setProperty('--snail-arrival-duration', '630ms')
  document.body.append(svg)
  const animations = [{ currentTime: 0 }, { currentTime: 0 }, { currentTime: 0 }]
  Object.defineProperty(svg, 'getAnimations', { value: vi.fn(() => animations) })
  return { svg, animations }
}

describe('snail launch', () => {
  it('continues the static and React clocks across an update reload, then consumes the stamp', async () => {
    boot(2_000)
    const { rememberSnailLaunch, waitForSnailArrival } = await import('./snailLaunch')
    await waitForSnailArrival()
    await vi.advanceTimersByTimeAsync(400)
    rememberSnailLaunch()
    expect(JSON.parse(sessionStorage.getItem('kp-snail-resume')!)).toEqual({ at: Date.now(), elapsed: 2_400 })

    // The new document takes 200 ms to arrive. Its cover must already be in the idle before
    // its first frame; its shell/head delays retain their original 630 ms phase offset.
    await vi.advanceTimersByTimeAsync(200)
    const { svg } = boot()
    svg.style.animationName = 'fs-arrival'
    svg.style.animationDelay = '0s'
    const head = document.createElementNS('http://www.w3.org/2000/svg', 'g')
    head.style.animationName = 'fs-brake, fs-head'
    head.style.animationDelay = '0s, 0.63s'
    svg.append(head)
    resumeBoot()
    expect(sessionStorage.getItem('kp-snail-resume')).toBeNull()
    expect(Number(svg.getAttribute('data-snail-offset'))).toBe(2_600)
    expect(svg.style.animationDelay).toBe('-2600ms')
    expect(head.style.animationDelay.split(',').map(Number.parseFloat)).toEqual([-2_600, -1_970])

    // A fresh module, like a new page: it must use the resumed clock, not startTime=now.
    vi.resetModules()
    const resumed = await import('./snailLaunch')
    await resumed.waitForSnailArrival()
    const next = reactSvg()
    resumed.continueSnailAnimation(next.svg)
    expect(next.animations.map(a => a.currentTime)).toEqual([2_600, 2_600, 2_600])
    const ordinary = boot().svg
    resumeBoot()
    expect(ordinary.hasAttribute('data-snail-offset')).toBe(false)
  })

  it.each([
    'broken json', 'null', JSON.stringify({ at: 0, elapsed: 700 }),
    () => JSON.stringify({ at: Date.now() - 30_001, elapsed: 700 }),
    () => JSON.stringify({ at: Date.now() + 1, elapsed: 700 }),
    () => JSON.stringify({ at: Date.now(), elapsed: -1 }),
  ])('ignores and consumes an invalid or stale update stamp: %s', saved => {
    const { svg } = boot()
    sessionStorage.setItem('kp-snail-resume', typeof saved === 'function' ? saved() : saved)
    expect(resumeBoot).not.toThrow()
    expect(sessionStorage.getItem('kp-snail-resume')).toBeNull()
    expect(svg.hasAttribute('data-snail-offset')).toBe(false)
  })

  it('does not stamp an unseen launch, and unavailable storage never prevents an update', async () => {
    const { rememberSnailLaunch, forgetSnailLaunch } = await import('./snailLaunch')
    rememberSnailLaunch()
    expect(sessionStorage.getItem('kp-snail-resume')).toBeNull()
    boot(900)
    rememberSnailLaunch()
    expect(sessionStorage.getItem('kp-snail-resume')).not.toBeNull()
    forgetSnailLaunch()
    expect(sessionStorage.getItem('kp-snail-resume')).toBeNull()
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('Storage blocked') })
    expect(rememberSnailLaunch).not.toThrow()
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new Error('Storage blocked') })
    document.documentElement.setAttribute('data-snail-resuming', '')
    expect(resumeBoot).not.toThrow()
    expect(document.documentElement.hasAttribute('data-snail-resuming')).toBe(false)
    vi.spyOn(Storage.prototype, 'removeItem').mockImplementation(() => { throw new Error('Storage blocked') })
    expect(forgetSnailLaunch).not.toThrow()
  })

  it('keeps the entrance on screen when startup is ready before it finishes', async () => {
    const { finish } = boot()
    const { waitForSnailArrival } = await import('./snailLaunch')
    let ready = false
    const waiting = waitForSnailArrival().then(() => { ready = true })
    await vi.advanceTimersByTimeAsync(500)
    expect(ready).toBe(false)
    await vi.advanceTimersByTimeAsync(130)
    finish()
    await waiting
    expect(ready).toBe(true)
    expect(vi.getTimerCount()).toBe(0)
  })

  it('adds no arrival hold after a slow boot has already shown it', async () => {
    boot(2_000)
    const { waitForSnailArrival } = await import('./snailLaunch')
    const waiting = waitForSnailArrival()
    await vi.advanceTimersByTimeAsync(16)
    await waiting
    expect(vi.getTimerCount()).toBe(0)
  })

  it('continues the same clock through React handover and later loading stages', async () => {
    boot(2_000)
    const { waitForSnailArrival, continueSnailAnimation } = await import('./snailLaunch')
    await waitForSnailArrival() // a running clock: no frame to wait for
    // React replaces the old boot DOM; its clock must survive that replacement.
    document.body.replaceChildren()
    const first = reactSvg()
    continueSnailAnimation(first.svg)
    expect(first.animations.map(a => a.currentTime)).toEqual([2_000, 2_000, 2_000])
    await vi.advanceTimersByTimeAsync(400)
    const next = reactSvg()
    continueSnailAnimation(next.svg)
    expect(next.animations.map(a => a.currentTime)).toEqual([2_400, 2_400, 2_400])
  })

  it('gives a React loader mounted BENEATH the cover the cover\'s clock, not its own fresh one', async () => {
    boot(300)
    const { continueSnailAnimation } = await import('./snailLaunch')
    const beneath = reactSvg()
    continueSnailAnimation(beneath.svg)
    expect(beneath.animations.map(a => a.currentTime)).toEqual([300, 300, 300])
  })

  it('lets no loader mounted before the cover\'s first frame fix the clock: the entrance still runs in full', async () => {
    const { animation, finish } = boot()
    animation.startTime = null // the cover has not rendered its first frame yet
    const { waitForSnailArrival, continueSnailAnimation } = await import('./snailLaunch')
    const beneath = reactSvg()
    continueSnailAnimation(beneath.svg) // React mounts beneath the still-pending cover
    expect(beneath.animations.map(a => a.currentTime)).toEqual([0, 0, 0])
    await vi.advanceTimersByTimeAsync(80)
    animation.startTime = performance.now() // …its first frame comes 80 ms later
    let arrived = false
    const waiting = waitForSnailArrival().then(() => { arrived = true })
    await vi.advanceTimersByTimeAsync(600)
    expect(arrived).toBe(false)
    await vi.advanceTimersByTimeAsync(30)
    finish()
    await waiting
    expect(arrived).toBe(true)
  })

  describe('liftBootCover', () => {
    function app() {
      const root = document.createElement('div')
      document.body.prepend(root)
      return root
    }

    it('lifts after the full entrance, once React shows the app rather than a splash of its own', async () => {
      const { finish } = boot()
      const root = app()
      const { liftBootCover } = await import('./snailLaunch')
      const lifting = liftBootCover(root)
      root.innerHTML = '<div class="login splash"></div>' // React's auth stage, beneath the cover
      await vi.advanceTimersByTimeAsync(630)
      finish()
      await vi.advanceTimersByTimeAsync(100)
      expect(document.querySelector('.boot-splash')?.classList.contains('leaving')).toBe(false)
      root.innerHTML = '<main class="app"></main>'
      await lifting
      expect(document.querySelector('.boot-splash')?.classList.contains('leaving')).toBe(true)
      await vi.advanceTimersByTimeAsync(240)
      expect(document.querySelector('.boot-splash')).toBeNull()
    })

    it('reveals a React loading stage still up two seconds after the entrance', async () => {
      boot(630) // the entrance ends right now
      const root = app()
      root.innerHTML = '<div class="login splash"></div>'
      const { liftBootCover, COVER_HOLD_MAX_MS } = await import('./snailLaunch')
      const lifting = liftBootCover(root)
      await vi.advanceTimersByTimeAsync(COVER_HOLD_MAX_MS - 100)
      expect(document.querySelector('.boot-splash.leaving')).toBeNull()
      await vi.advanceTimersByTimeAsync(100)
      await lifting
      expect(document.querySelector('.boot-splash.leaving')).not.toBeNull()
    })

    it('counts those two seconds from the entrance\'s end, not from a slow boot\'s React mount', async () => {
      boot(3_000) // the entrance ended 2.37 s ago: the config took that long
      const root = app()
      root.innerHTML = '<div class="login splash">Einsatz wird geöffnet …</div>'
      const { liftBootCover } = await import('./snailLaunch')
      await liftBootCover(root)
      expect(document.querySelector('.boot-splash.leaving')).not.toBeNull()
    })

    it('keeps what it covers inert until it lifts', async () => {
      const { finish } = boot()
      const root = app()
      const { liftBootCover } = await import('./snailLaunch')
      const lifting = liftBootCover(root)
      expect(root.inert).toBe(true)
      root.innerHTML = '<main></main>'
      await vi.advanceTimersByTimeAsync(630)
      finish()
      await lifting
      expect(root.inert).toBe(false)
    })

    it('never lifts onto an empty root: a wedged boot keeps the cover and its hint', async () => {
      boot(2_000)
      const root = app()
      const { liftBootCover } = await import('./snailLaunch')
      let lifted = false
      void liftBootCover(root).then(() => { lifted = true })
      await vi.advanceTimersByTimeAsync(10_000)
      expect(lifted).toBe(false)
      root.innerHTML = '<main></main>'
      await vi.advanceTimersByTimeAsync(0)
      expect(lifted).toBe(true)
    })
  })

  it('uses the running idle clock after the one-shot has stopped at its end', async () => {
    const { svg, animation } = boot(630)
    Object.defineProperty(svg, 'getAnimations', { value: vi.fn(() => [animation, { animationName: 'fs-shell', currentTime: 2_800 }]) })
    const { waitForSnailArrival, continueSnailAnimation } = await import('./snailLaunch')
    await waitForSnailArrival() // a running clock: no frame to wait for
    const next = reactSvg()
    continueSnailAnimation(next.svg)
    expect(next.animations.map(a => a.currentTime)).toEqual([2_800, 2_800, 2_800])
  })

  it('takes the clock from the start time, not from a frame that is still overdue', async () => {
    // `currentTime` stands still between frames; here the last frame is long overdue.
    const { svg, animation } = boot(400)
    const shell = { animationName: 'fs-shell', currentTime: 400, startTime: performance.now() - 2_000 }
    Object.defineProperty(svg, 'getAnimations', { value: vi.fn(() => [animation, shell]) })
    const { waitForSnailArrival, continueSnailAnimation } = await import('./snailLaunch')
    const waiting = waitForSnailArrival()
    await vi.advanceTimersByTimeAsync(16)
    await waiting
    expect(vi.getTimerCount()).toBe(0) // no hold: the entrance has long ended
    const next = reactSvg()
    continueSnailAnimation(next.svg)
    for (const { currentTime } of next.animations) {
      expect(currentTime).toBeGreaterThanOrEqual(2_000)
      expect(currentTime).toBeLessThan(2_100)
    }
  })

  it('starts in-workspace loaders at the idle instead of replaying the entrance', async () => {
    const { continueSnailAnimation } = await import('./snailLaunch')
    const { svg, animations } = reactSvg()
    continueSnailAnimation(svg, true)
    expect(animations.map(a => a.currentTime)).toEqual([630, 630, 630])
  })

  it('skips the hold for reduced motion', async () => {
    boot()
    vi.stubGlobal('matchMedia', vi.fn(() => ({ matches: true })))
    const { waitForSnailArrival } = await import('./snailLaunch')
    await waitForSnailArrival()
    expect(vi.getTimerCount()).toBe(0)
  })

  it('can mount without boot markup', async () => {
    const { waitForSnailArrival } = await import('./snailLaunch')
    await waitForSnailArrival()
    expect(vi.getTimerCount()).toBe(0)
  })

  it('does not wedge startup when an animation is cancelled', async () => {
    const { cancel } = boot()
    const { waitForSnailArrival } = await import('./snailLaunch')
    const waiting = waitForSnailArrival()
    await vi.advanceTimersByTimeAsync(16)
    cancel()
    await waiting
    expect(vi.getTimerCount()).toBe(0)
  })

  it('times the hold from the first frame when the cover has not rendered yet', async () => {
    // WebKit (CI 09.10.2026): no animation exists until the first frame, which came ~150-300 ms
    // after the request; timing the hold from the request handed over mid-skid.
    const { svg, animation, finish } = boot()
    let rendered = false
    Object.defineProperty(svg, 'getAnimations', { value: vi.fn(() => rendered ? [animation] : []) })
    vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => setTimeout(() => {
      rendered = true
      animation.startTime = performance.now()
      animation.currentTime = 0
      callback(performance.now())
    }, 300))
    const { waitForSnailArrival } = await import('./snailLaunch')
    let ready = false
    const waiting = waitForSnailArrival().then(() => { ready = true })
    await vi.advanceTimersByTimeAsync(300 + 629)
    expect(ready).toBe(false)
    await vi.advanceTimersByTimeAsync(1)
    finish()
    await waiting
    expect(ready).toBe(true)
    expect(vi.getTimerCount()).toBe(0)
  })

  it('waits for a pending start time instead of guessing it', async () => {
    const { animation } = boot()
    animation.startTime = null
    let frames = 0
    vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => setTimeout(() => {
      if (++frames === 2) animation.startTime = performance.now()
      callback(performance.now())
    }, 16))
    const { waitForSnailArrival } = await import('./snailLaunch')
    let ready = false
    const waiting = waitForSnailArrival().then(() => { ready = true })
    // the start time arrives with the second frame (32 ms); the hold runs 630 ms from there
    await vi.advanceTimersByTimeAsync(32 + 679)
    expect(ready).toBe(false)
    await vi.advanceTimersByTimeAsync(1)
    await waiting
    expect(ready).toBe(true)
  })

  it('does not wait for an arrival that a rendered frame did not bring', async () => {
    const { svg } = boot()
    Object.defineProperty(svg, 'getAnimations', { value: vi.fn(() => []) })
    const { waitForSnailArrival } = await import('./snailLaunch')
    let ready = false
    const waiting = waitForSnailArrival().then(() => { ready = true })
    await vi.advanceTimersByTimeAsync(16 + 680)
    await waiting
    expect(ready).toBe(true)
  })

  it('bounds the hold even if neither a frame nor an animation completion arrives', async () => {
    const { animation } = boot()
    animation.startTime = null
    vi.stubGlobal('requestAnimationFrame', vi.fn(() => 0))
    const { waitForSnailArrival, FIRST_FRAME_MAX_MS } = await import('./snailLaunch')
    let ready = false
    const waiting = waitForSnailArrival().then(() => { ready = true })
    await vi.advanceTimersByTimeAsync(FIRST_FRAME_MAX_MS + 679)
    expect(ready).toBe(false)
    await vi.advanceTimersByTimeAsync(1)
    await waiting
    expect(ready).toBe(true)
  })

  it('keeps the short frame wait in a hidden document, which gets no frames', async () => {
    const { animation } = boot()
    animation.startTime = null
    vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('hidden')
    vi.stubGlobal('requestAnimationFrame', vi.fn(() => 0))
    const { waitForSnailArrival } = await import('./snailLaunch')
    let ready = false
    const waiting = waitForSnailArrival().then(() => { ready = true })
    await vi.advanceTimersByTimeAsync(50 + 679)
    expect(ready).toBe(false)
    await vi.advanceTimersByTimeAsync(1)
    await waiting
    expect(ready).toBe(true)
  })
})
