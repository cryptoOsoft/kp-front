// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, renderHook } from '@testing-library/react'
import { useScrollFocusIntoView } from './useScrollFocusIntoView'

// The promise this hook makes is a NARROW one: it scrolls a focused field only when that field is
// actually outside the visual viewport, and it looks a second time once the keyboard has settled.
// Both halves are what these tests are about — an eager version of this hook re-enters the
// pan/re-aim loop documented in useKeyboardInset, so «did NOT scroll» is the important assertion.

/** The visual viewport, the way iOS reports it: the keyboard shrinks THIS, never `innerHeight`. */
class FakeViewport extends EventTarget {
  constructor(public height: number, public offsetTop = 0) { super() }
  /** open/close the keyboard and let the listeners hear about it */
  resizeTo(height: number) { this.height = height; this.dispatchEvent(new Event('resize')) }
}

const SCREEN = 800

function stubViewport(height = SCREEN): FakeViewport {
  const vv = new FakeViewport(height)
  Object.defineProperty(window, 'visualViewport', { configurable: true, value: vv })
  window.innerHeight = SCREEN
  return vv
}

/** A focused text field whose box sits at `bottom`, with its scroll spied on. */
function field(bottom: number) {
  const el = document.createElement('input')
  document.body.append(el)
  el.getBoundingClientRect = () => ({ top: bottom - 40, bottom, left: 0, right: 300, width: 300, height: 40, x: 0, y: bottom - 40, toJSON: () => ({}) }) as DOMRect
  el.scrollIntoView = vi.fn()
  return { el, scrolled: el.scrollIntoView as ReturnType<typeof vi.fn> }
}

/** Two frames: one for useKeyboardInset's coalescing, one for the hook's own. */
async function frames() {
  for (let i = 0; i < 2; i++) {
    await act(async () => { await new Promise<void>(done => requestAnimationFrame(() => done())) })
  }
}

/** Focus it the way a tap does — jsdom raises focusin from `focus()`. */
async function focus(el: HTMLElement) {
  await act(async () => { el.focus() })
  await frames()
}

afterEach(() => {
  Object.defineProperty(window, 'visualViewport', { configurable: true, value: undefined })
  document.body.replaceChildren()
  vi.restoreAllMocks()
})

describe('useScrollFocusIntoView', () => {
  it('leaves a field that is already on screen exactly where it is', async () => {
    stubViewport(460) // keyboard up: 340px of it
    renderHook(() => useScrollFocusIntoView())
    await frames()
    const { el, scrolled } = field(300) // …and the field is above the keys
    await focus(el)
    expect(scrolled).not.toHaveBeenCalled()
  })

  it('scrolls a field the keyboard is sitting on top of, and only as far as it must', async () => {
    stubViewport(460)
    renderHook(() => useScrollFocusIntoView())
    await frames()
    const { el, scrolled } = field(620) // below the visible band
    await focus(el)
    expect(scrolled).toHaveBeenCalledWith({ block: 'nearest' })
  })

  // occlusion sweep O4: under `overlays-content` Android shrinks no viewport – only the
  // VirtualKeyboard API knows where the keys are
  it('scrolls a field under an Android keyboard the visual viewport knows nothing about', async () => {
    stubViewport() // full height: nothing shrinks
    const vk = Object.assign(new EventTarget(), { boundingRect: { height: 340 }, overlaysContent: true })
    Object.defineProperty(navigator, 'virtualKeyboard', { configurable: true, value: vk })
    try {
      renderHook(() => useScrollFocusIntoView())
      await frames()
      const { el, scrolled } = field(620) // 800 − 340 = 460 is the keys' top
      await focus(el)
      expect(scrolled).toHaveBeenCalledWith({ block: 'nearest' })
    } finally {
      Object.defineProperty(navigator, 'virtualKeyboard', { configurable: true, value: undefined })
    }
  })

  it('looks again once the keyboard has actually opened', async () => {
    // the race this hook exists for: at focus time the viewport is still full height, so nothing
    // looks covered — the field only ends up under the keys a moment later
    const vv = stubViewport()
    renderHook(() => useScrollFocusIntoView())
    await frames()
    const { el, scrolled } = field(620)
    await focus(el)
    expect(scrolled).not.toHaveBeenCalled()

    await act(async () => { vv.resizeTo(460) })
    await frames()
    expect(scrolled).toHaveBeenCalledWith({ block: 'nearest' })
  })

  it('accounts for a viewport iOS has panned rather than only shrunk', async () => {
    const vv = stubViewport(460)
    vv.offsetTop = 200 // visible band is 200 … 660
    renderHook(() => useScrollFocusIntoView())
    await frames()
    const { el: above, scrolled: scrolledAbove } = field(150) // scrolled off the TOP
    await focus(above)
    expect(scrolledAbove).toHaveBeenCalledWith({ block: 'nearest' })

    const { el: inside, scrolled: scrolledInside } = field(600)
    await focus(inside)
    expect(scrolledInside).not.toHaveBeenCalled()
  })

  it('ignores anything that is not a text field — a button never raises a keyboard', async () => {
    stubViewport(460)
    renderHook(() => useScrollFocusIntoView())
    await frames()
    const btn = document.createElement('button')
    document.body.append(btn)
    btn.getBoundingClientRect = () => ({ top: 580, bottom: 620, left: 0, right: 300, width: 300, height: 40, x: 0, y: 580, toJSON: () => ({}) }) as DOMRect
    btn.scrollIntoView = vi.fn()
    await focus(btn)
    expect(btn.scrollIntoView).not.toHaveBeenCalled()
  })
})
