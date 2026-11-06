import { useEffect, useRef, useState } from 'react'

/** How long a latched one-time action stays «done» before its button comes back – long enough to
 *  swallow a double tap and a hurried second one, short enough that a deliberate second shift is
 *  still one tap away. */
export const ONE_SHOT_HOLD_MS = 4000

/**
 * The latch of a one-time action whose result the data cannot tell apart from a second one (two
 * shifts for one person are allowed, so «there is a shift» does not mean «you just made it»):
 * `run(fn)` does it once and holds `done` for `holdMs`; a tap meanwhile does nothing. While it
 * holds, the host shows DoneChip in the button's place. Where the data CAN say «done» (the
 * Absperrkreis exists), derive it instead – docs/ui-conventions.md · One-time actions.
 */
export function useOneShot(holdMs = ONE_SHOT_HOLD_MS): { done: boolean; run: (fn: () => void) => void } {
  const [done, setDone] = useState(false)
  // the ref, not the state: two taps in one frame both see the render before the first one's
  const latched = useRef(false)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  useEffect(() => () => { if (timer.current) clearTimeout(timer.current) }, [])
  const run = (fn: () => void) => {
    if (latched.current) return
    latched.current = true
    setDone(true)
    fn()
    timer.current = setTimeout(() => { latched.current = false; setDone(false) }, holdMs)
  }
  return { done, run }
}
