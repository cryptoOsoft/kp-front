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

  it('hands the first finger over at the second, so a pointer-counting surface can pinch', () => {
    const { el, canvas } = surface()
    const downs: { id: number; x: number }[] = []
    const moves: number[] = []
    canvas.addEventListener('pointerdown', (e) => downs.push({ id: (e as PointerEvent).pointerId, x: (e as PointerEvent).clientX }))
    canvas.addEventListener('pointermove', (e) => moves.push((e as PointerEvent).pointerId))
    const onTap = vi.fn()
    renderHook(() => useZeigen(el, true, onTap, { handOver: true }))
    canvas.dispatchEvent(pointer('pointerdown', 1, 100))
    canvas.dispatchEvent(pointer('pointermove', 1, 104)) // within the slop: still a tap so far
    expect(downs).toEqual([])
    canvas.dispatchEvent(pointer('pointerdown', 2, 200))
    // the first finger arrives where it is now, then the second
    expect(downs).toEqual([{ id: 1, x: 104 }, { id: 2, x: 200 }])
    canvas.dispatchEvent(pointer('pointermove', 1, 90))
    canvas.dispatchEvent(pointer('pointermove', 2, 220))
    expect(moves).toEqual([1, 2])
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
