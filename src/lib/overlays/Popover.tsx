import { useState, type ReactElement, type ReactNode } from 'react'
import { Popover as BasePopover, type PopoverPositionerProps, type PopoverRootChangeEventDetails } from '@base-ui/react/popover'
import { usePopoverGuard } from './popoverGuard'

/** Why a popover opened or closed, and the native event that did it — enough for a caller to
 *  ignore, say, an outside press that landed on a control which toggles the popover itself. */
export type PopoverChange = Pick<PopoverRootChangeEventDetails, 'reason' | 'event'>

/**
 * Anchored, non-modal popover — wraps Base UI's Popover. The Positioner anchors to the trigger
 * (collision-aware, auto-flips near a viewport edge), replacing hand-rolled
 * getBoundingClientRect math, and Base UI supplies outside-click + Esc dismissal and focus
 * management — so a hand-rolled full-screen scrim is no longer needed. The popup is portalled to
 * <body>, escaping any `backdrop-filter` containing block (the old reason the weather scrim was
 * trapped to the TopBar).
 *
 * Uncontrolled by default (the trigger toggles it); pass `open`/`onOpenChange` to control it.
 * ANCHOR mode (`anchor`, 04.11.2026 – the Wassertransport's pump bubble): a controlled popover
 * opens AT an element that is no trigger – a dot on a chart, a marker on the map – and the
 * trigger may be left out. The element's own tap handler opens and closes it; `onOpenChange`'s
 * second argument says why Base UI wants it closed, so that handler's own press can be ignored
 * (it would otherwise close the popover, and the tap reopen it).
 * NOTE: for surfaces that must NOT be dismissed/focus-managed and must let the map stay live
 * underneath (map tool-docks like MapViewsMenu), keep the hand-rolled dock — do not use this.
 */
export interface PopoverProps {
  /** the control that toggles it; optional when `anchor` places a controlled popover */
  trigger?: ReactElement
  /** open at this element instead of the trigger (Base UI · Positioner `anchor`) */
  anchor?: PopoverPositionerProps['anchor']
  children: ReactNode
  ariaLabel?: string
  popupClassName?: string
  side?: 'top' | 'bottom' | 'left' | 'right'
  align?: 'start' | 'center' | 'end'
  sideOffset?: number
  /** Shift along the aligned edge. For a trigger that sits INSIDE the visible control (a button
   *  in a padded glass cluster): the popup aligns to the trigger, and the eye aligns it to the
   *  cluster. With `align="end"` a NEGATIVE value moves the popup outward, past the trigger. */
  alignOffset?: number
  /** z-index for the (fixed) Positioner — set it to stack above surrounding fixed chrome. */
  zIndex?: number
  /** Keep-off distance from the viewport edge — the same default, and for the same reason, as
   *  overlays · Menu: Base UI's own 5px leaves a popover on a control near the edge sitting flush
   *  against it, and a panel of prose read flush to the glass reads as one that has been cut. On
   *  a phone the difference is not cosmetic — the Rapport's Kontrolle popover lost its first
   *  column of text off the left edge. A property of the surface being finite, not of a call site. */
  collisionPadding?: number
  /** what the popup must stay inside (default: the anchor's clipping ancestors). An anchor inside
   *  a scrolling panel passes the page (`document.documentElement`), so the popup may overflow
   *  the panel instead of being squeezed into it. */
  collisionBoundary?: PopoverPositionerProps['collisionBoundary']
  open?: boolean
  onOpenChange?: (open: boolean, change: PopoverChange) => void
}

export function Popover({ trigger, anchor, children, ariaLabel, popupClassName, side = 'bottom', align = 'end', sideOffset = 8, alignOffset, collisionPadding = 10, collisionBoundary, zIndex, open, onOpenChange }: PopoverProps) {
  // uncontrolled callers give us no `open` to read, so the Root reports it — a popover open over
  // a Sheet/Overlay keeps that sheet's backdrop/Esc dismissal off (popoverGuard)
  const [isOpen, setIsOpen] = useState(false)
  usePopoverGuard(open ?? isOpen)
  return (
    <BasePopover.Root open={open} onOpenChange={(next, { reason, event }) => { setIsOpen(next); onOpenChange?.(next, { reason, event }) }}>
      {trigger && <BasePopover.Trigger render={trigger} />}
      <BasePopover.Portal>
        <BasePopover.Positioner anchor={anchor} side={side} align={align} sideOffset={sideOffset} alignOffset={alignOffset} collisionPadding={collisionPadding} collisionBoundary={collisionBoundary} style={zIndex != null ? { zIndex } : undefined}>
          {/* `ui-pop`: shared exit hook — see 13-incident.css [data-ending-style] */}
          <BasePopover.Popup className={popupClassName ? `ui-pop ${popupClassName}` : 'ui-pop'} aria-label={ariaLabel}>
            {children}
          </BasePopover.Popup>
        </BasePopover.Positioner>
      </BasePopover.Portal>
    </BasePopover.Root>
  )
}

/** A control inside a <Popover> that closes it. Merges onto a native button. */
export function PopoverClose({ children, className, onClick }: { children: ReactNode; className?: string; onClick?: () => void }) {
  return <BasePopover.Close className={className} onClick={onClick}>{children}</BasePopover.Close>
}
