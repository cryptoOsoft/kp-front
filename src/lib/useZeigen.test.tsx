// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { renderHook } from '@testing-library/react'
import { useZeigen } from './useZeigen'

/** jsdom has no PointerEvent / TouchEvent constructors: a MouseEvent carrying their fields */
function pointer(type: string, id: number, x: number, y = 0) {
  const e = new MouseEvent(type, { bubbles: true, cancelable: true, clientX: x, clientY: y })
  Object.defineProperty(e, 'pointerId', { value: id })
  return e
}
function touch(type: string, fingers: number) {
  const e = new Event(type, { bubbles: true, cancelable: true })
  Object.defineProperty(e, 'touches', { value: Array.from({ length: fingers }, () => ({})) })
  return e
}

function surface() {
  const el = document.createElement('div')
  const canvas = document.createElement('canvas')
  el.appendChild(canvas)
  document.body.appendChild(el)
  const heard: string[] = []
  for (const t of ['pointerdown', 'pointerup', 'touchstart', 'touchend', 'click']) canvas.addEventListener(t, () => heard.push(t))
  return { el, canvas, heard }
}

describe('«Zeigen» on a surface', () => {
  afterEach(() => { document.body.innerHTML = '' })

  it('turns a one-finger tap into a pointer, and the surface never hears it', () => {
    const { el, canvas, heard } = surface()
    const onTap = vi.fn()
    renderHook(() => useZeigen(el, true, onTap))
    canvas.dispatchEvent(pointer('pointerdown', 1, 100, 50))
    canvas.dispatchEvent(touch('touchstart', 1))
    canvas.dispatchEvent(pointer('pointerup', 1, 103, 52))
    canvas.dispatchEvent(touch('touchend', 0))
    canvas.dispatchEvent(pointer('click', 1, 103, 52))
    expect(onTap).toHaveBeenCalledWith(103, 52)
    expect(heard).toEqual([])
  })

  it('a drag is no tap', () => {
    const { el, canvas } = surface()
    const onTap = vi.fn()
    renderHook(() => useZeigen(el, true, onTap))
    canvas.dispatchEvent(pointer('pointerdown', 1, 100))
    canvas.dispatchEvent(pointer('pointermove', 1, 140))
    canvas.dispatchEvent(pointer('pointerup', 1, 140))
    expect(onTap).not.toHaveBeenCalled()
  })

  it('lets a second finger through to the surface, to the end of the gesture', () => {
    const { el, canvas, heard } = surface()
    const onTap = vi.fn()
    renderHook(() => useZeigen(el, true, onTap))
    canvas.dispatchEvent(pointer('pointerdown', 1, 100))
    canvas.dispatchEvent(touch('touchstart', 1))
    canvas.dispatchEvent(pointer('pointerdown', 2, 200))
    canvas.dispatchEvent(touch('touchstart', 2))
    canvas.dispatchEvent(touch('touchend', 1)) // one finger lifts: still the surface's gesture
    canvas.dispatchEvent(touch('touchend', 0))
    canvas.dispatchEvent(pointer('pointerup', 1, 100))
    expect(heard).toEqual(['pointerdown', 'touchstart', 'touchend', 'touchend'])
    expect(onTap).not.toHaveBeenCalled()
  })

  it('off, it is not there at all', () => {
    const { el, canvas, heard } = surface()
    const onTap = vi.fn()
    renderHook(() => useZeigen(el, false, onTap))
    canvas.dispatchEvent(pointer('pointerdown', 1, 100))
    canvas.dispatchEvent(pointer('pointerup', 1, 100))
    expect(heard).toEqual(['pointerdown', 'pointerup'])
    expect(onTap).not.toHaveBeenCalled()
  })
})
