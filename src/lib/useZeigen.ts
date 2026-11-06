// «Zeigen» on a surface (Präsentationsmodus, docs/presentation.md): while on, ONE finger (or the
// mouse) only points – a tap is reported, and nothing under it is selected, placed, drawn or
// panned – while two fingers still pan and pinch the surface as always.
//
// How: window-level CAPTURE listeners, the first thing to see any event. They stop the first
// pointer's events (pointer*, mouse*, touch* with one finger, click) for a target inside
// `el`; React's root listener and MapLibre's own never hear them. A second finger is let
// through, so two fingers pan and pinch on both surfaces alike:
//   · the Karte: from its touchstart on, the event lists both touches, which MapLibre's
//     two-finger handlers start from;
//   · the Plan (`handOver`): its gestures count POINTERS, and the first one was never seen – so
//     at the second finger the first is handed over, a replayed `pointerdown` where it stands
//     now, and its later events pass. Without it the board panned under the second finger alone
//     and a pinch did nothing.
//
// `useUserMoved` is the follower's other half: a pan, pinch or wheel on `el` by hand is what
// detaches a follower («Wieder folgen»); a programmatic move (the follow itself) is no event.

import { useEffect, useRef } from 'react'

/** A tap moves less than this (px) between down and up… */
const TAP_SLOP = 10
/** …and lasts at most this long (ms). */
const TAP_MS = 700

export function useZeigen(
  el: HTMLElement | null | undefined,
  enabled: boolean,
  onTap: (clientX: number, clientY: number) => void,
  { handOver = false }: { handOver?: boolean } = {},
) {
  const tapRef = useRef(onTap)
  useEffect(() => { tapRef.current = onTap }, [onTap])
  useEffect(() => {
    if (!el || !enabled) return
    const inside = (e: Event) => e.target instanceof Node && el.contains(e.target)
    /** the one pointer this mode owns, while it is down */
    let owned: {
      id: number; x: number; y: number; t: number; moved: boolean
      /** handed over to the surface (`handOver`): its events pass from now on */
      handed: boolean; target: EventTarget | null; type: string; lx: number; ly: number
    } | null = null
    /** our own replayed event is passing through */
    let replaying = false
    /** a two-finger gesture is running: everything passes until the last finger is up */
    let multi = false
    const block = (e: Event) => { e.stopPropagation(); if (e.cancelable && e.type !== 'touchstart') e.preventDefault() }

    const handOverFirst = (o: NonNullable<typeof owned>) => {
      o.handed = true
      if (!o.target) return
      const init = { bubbles: true, cancelable: true, composed: true, clientX: o.lx, clientY: o.ly, button: 0, buttons: 1 }
      const down = typeof PointerEvent === 'function'
        ? new PointerEvent('pointerdown', { ...init, pointerId: o.id, pointerType: o.type, isPrimary: true })
        : Object.assign(new MouseEvent('pointerdown', init), { pointerId: o.id, pointerType: o.type })
      replaying = true
      try { o.target.dispatchEvent(down) } finally { replaying = false }
    }
    const onPointerDown = (e: PointerEvent) => {
      if (replaying || !inside(e)) return
      if (owned && owned.id !== e.pointerId) { // a second finger: let it through
        owned.moved = true
        if (handOver && !owned.handed) handOverFirst(owned)
        return
      }
      owned = { id: e.pointerId, x: e.clientX, y: e.clientY, t: performance.now(), moved: false, handed: false, target: e.target, type: e.pointerType, lx: e.clientX, ly: e.clientY }
      block(e)
    }
    const onPointerMove = (e: PointerEvent) => {
      if (!owned || owned.id !== e.pointerId || owned.handed) return
      owned.lx = e.clientX
      owned.ly = e.clientY
      if (Math.hypot(e.clientX - owned.x, e.clientY - owned.y) > TAP_SLOP) owned.moved = true
      block(e)
    }
    const onPointerUp = (e: PointerEvent) => {
      if (!owned || owned.id !== e.pointerId) return
      if (owned.handed) { owned = null; return }
      const tap = !owned.moved && e.type === 'pointerup' && performance.now() - owned.t <= TAP_MS
      owned = null
      block(e)
      if (tap) tapRef.current(e.clientX, e.clientY)
    }
    const onTouch = (e: TouchEvent) => {
      if (!inside(e)) return
      // one finger is this mode's; two are the surface's (pan/pinch) – to the end of the gesture,
      // so the surface also hears the fingers lift
      if (e.touches.length >= 2) multi = true
      const pass = multi
      if (e.touches.length === 0) multi = false
      if (!pass) block(e)
    }
    const onMouse = (e: MouseEvent) => { if (inside(e)) block(e) }

    const opts = { capture: true, passive: false } as const
    const mouse = ['mousedown', 'mousemove', 'mouseup', 'click', 'dblclick', 'contextmenu'] as const
    const touch = ['touchstart', 'touchmove', 'touchend', 'touchcancel'] as const
    window.addEventListener('pointerdown', onPointerDown, opts)
    window.addEventListener('pointermove', onPointerMove, opts)
    window.addEventListener('pointerup', onPointerUp, opts)
    window.addEventListener('pointercancel', onPointerUp, opts)
    for (const t of mouse) window.addEventListener(t, onMouse, opts)
    for (const t of touch) window.addEventListener(t, onTouch, opts)
    return () => {
      window.removeEventListener('pointerdown', onPointerDown, opts)
      window.removeEventListener('pointermove', onPointerMove, opts)
      window.removeEventListener('pointerup', onPointerUp, opts)
      window.removeEventListener('pointercancel', onPointerUp, opts)
      for (const t of mouse) window.removeEventListener(t, onMouse, opts)
      for (const t of touch) window.removeEventListener(t, onTouch, opts)
    }
  }, [el, enabled, handOver])
}

/** Calls `onMoved` when the user pans (a drag past the tap slop), pinches or wheels on `el`. */
export function useUserMoved(el: HTMLElement | null | undefined, enabled: boolean, onMoved: () => void) {
  const movedRef = useRef(onMoved)
  useEffect(() => { movedRef.current = onMoved }, [onMoved])
  useEffect(() => {
    if (!el || !enabled) return
    const down = new Map<number, { x: number; y: number }>()
    const fire = () => movedRef.current()
    const onDown = (e: PointerEvent) => {
      down.set(e.pointerId, { x: e.clientX, y: e.clientY })
      if (down.size >= 2) fire()
    }
    const onMove = (e: PointerEvent) => {
      const at = down.get(e.pointerId)
      if (at && Math.hypot(e.clientX - at.x, e.clientY - at.y) > TAP_SLOP) { down.delete(e.pointerId); fire() }
    }
    const onUp = (e: PointerEvent) => { down.delete(e.pointerId) }
    const opts = { capture: true, passive: true } as const
    el.addEventListener('pointerdown', onDown, opts)
    el.addEventListener('pointermove', onMove, opts)
    el.addEventListener('pointerup', onUp, opts)
    el.addEventListener('pointercancel', onUp, opts)
    el.addEventListener('wheel', fire, opts)
    return () => {
      el.removeEventListener('pointerdown', onDown, opts)
      el.removeEventListener('pointermove', onMove, opts)
      el.removeEventListener('pointerup', onUp, opts)
      el.removeEventListener('pointercancel', onUp, opts)
      el.removeEventListener('wheel', fire, opts)
    }
  }, [el, enabled])
}
