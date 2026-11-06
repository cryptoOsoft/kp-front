import type { ReactNode } from 'react'
import { Icon } from '../lib/icons'
import { cx } from '../lib/cx'
import s from './DoneChip.module.css'

// THE done state of a one-time action (owner 05.11.2026, docs/ui-conventions.md · One-time
// actions): where a button CREATES something – a shift, an Absperrkreis, a Wiedervorlage – it gives
// way to this chip once it did, so a second tap has nothing to press. ✓ and the result in words,
// in the green of a thing that holds; not a button (no press, no focus) – the way back is the
// action's «Rückgängig» toast. Whether it shows is the HOST's question, answered from the data
// wherever the data can say it (the circle exists), else by lib/useOneShot's latch.

export function DoneChip({ children, title, className }: {
  children: ReactNode
  /** the full words where the chip says them short («gesetzt» beside an ERG distance) */
  title?: string
  className?: string
}) {
  return (
    <span className={cx(s.done, className)} role="status" title={title} aria-label={title}>
      <Icon id="check" />
      <span>{children}</span>
    </span>
  )
}
