/*
 * *The north dial is the ONE door to «Gebäude drehen»* (29.09.2026), on every device
 * (`PlanCompass`); it also shows the angle. Since 20.10.2026 (UX sweep M7) it lives where the
 * Karte's compass does: in the tool rail's view bar on a tablet or laptop (bottom corner, since
 * 06.11.2026), in the bottom tool bar on a phone.
 */

import { useState, type ReactNode } from 'react'
import { appConfig } from '../config/appConfig'
import { Icon } from '../lib/icons'
import { Popover } from '../lib/overlays'
import s from './PlanCompass.module.css'

/**
 * The Gebäude's north dial. Rendered by the Whiteboard while a footprint stack is on screen.
 *
 * `variant="rail"` is the tile in the plan rail's view controls, beside «Einpassen» – the Karte's
 * compass slot (MapToolDocks · MapViewsButton): the same glyph, turning with the view, the same
 * `.vrail-views` tile, so the phone's bottom bar keeps it like the Karte's (15-mobile · the
 * pinned `.vrail-views`/`.vrail-fit` tiles). It floated top-right until 20.10.2026 – the corner
 * the Karte's compass had left because its menu opened half a screen from the thumb.
 * `variant="float"` is the old viewport-corner chip, kept ONLY for a plan that has no rail at all
 * (a replay, a viewer-only document): there the dial is a read-out and nothing else.
 *
 * `deg` is the ACTIVE view angle including the popover's live preview, so the needle turns with
 * the slider before the rotation is committed. Pass `controls` (the orientation popover's
 * contents) to make it the one door to rotating the building; without them – a viewer, a
 * replay, a footprint that was never turned – it is a plain read-out.
 */
export function PlanCompass({ deg, controls, northUnknown = false, variant }: {
  deg: number
  controls?: ReactNode
  northUnknown?: boolean
  variant: 'rail' | 'float'
}) {
  // controlled, so the open rail tile wears the rail's «on» pill like the Karte's compass does
  const [open, setOpen] = useState(false)
  const W = appConfig.copy.whiteboard
  // ⚠️ A Geschossplan that is not linked to the map has NO known north (16.09.2026): it can still
  // be turned – that is what the popover is for – but a needle would be pointing at a direction
  // nobody measured. The dial then wears the turn arrow instead, and says why in its title.
  const title = northUnknown ? W.northUnknownTitle : W.northTitle
  const turn = { transform: `rotate(${deg}deg)` }
  const glyph = variant === 'rail'
    // the Karte's compass glyph (MapViewsMenu · CompassGlyph), turned to where north is on the paper
    ? <span className={s.glyph} style={turn}><Icon id={northUnknown ? 'rotate' : 'compass'} /></span>
    : <FloatDial deg={deg} northUnknown={northUnknown} />
  const face = variant === 'rail'
    ? <><span className="vrail-glyph">{glyph}</span><span className="vrail-label">{controls ? W.orientRail : W.northRail}</span></>
    : glyph
  const look = variant === 'rail' ? 'vrail-nbtn vrail-views' : s.chip

  if (!controls) {
    return <span className={`${look} ${s.still}`} role="img" title={title} aria-label={title}>{face}</span>
  }
  // ⚠️ A press on the dial is the dial's: the float chip sits INSIDE the board's canvas
  // (Whiteboard · .wb-canvas), whose pointerdown starts a one-finger pan and takes pointer capture
  // – captured, the click landed on the canvas and the popover never opened (field report
  // 24.09.2026). The popover's contents stop it themselves (Whiteboard · orientControls): a
  // portal still bubbles through the React tree.
  return (
    <Popover
      ariaLabel={W.orientMenuTitle}
      popupClassName="wb-orient-popup"
      // out of its bar towards the plan: upward from the view bar in the bottom corner (tablet,
      // laptop) and from the phone's bottom bar – never back over the control that opened it
      side={variant === 'float' ? 'bottom' : 'top'} align="end" zIndex={60}
      open={open} onOpenChange={setOpen}
      trigger={
        <button type="button" className={`${look} ${s.btn}${open && variant === 'rail' ? ' on' : ''}`}
          title={W.orientMenuTitle}
          aria-label={W.orientMenuTitle}
          onPointerDown={(e) => e.stopPropagation()}
        >{face}</button>
      }
    >{controls}</Popover>
  )
}

/** The float chip's dial – geometry as printed (backend · kroki · north_dial_svg): N inside the
 *  ring, needle a dart in ink. No ring circle: the chip's own round glass edge IS the ring. */
function FloatDial({ deg, northUnknown }: { deg: number; northUnknown: boolean }) {
  return northUnknown ? (
    <svg viewBox="-25 -25 50 50" aria-hidden>
      <g className={s.unknown} style={{ transform: `rotate(${deg}deg)`, transformOrigin: '0px 0px' }}>
        <path d="M-11 -3 A11 11 0 1 1 -6 8" fill="none" strokeWidth="3.4" strokeLinecap="round" />
        <path d="M-11 -9 L-11 -2 L-4.5 -2 Z" />
      </g>
    </svg>
  ) : (
    <svg viewBox="-25 -25 50 50" aria-hidden>
      <g style={{ transform: `rotate(${deg}deg)`, transformOrigin: '0px 0px' }}>
        <text y="-13" className={s.n}>{appConfig.copy.whiteboard.northLabel}</text>
        <path d="M0 -8 L10 16 L0 7 L-10 16 Z" className={s.needle} />
      </g>
    </svg>
  )
}
