import { useMemo } from 'react'
import { appConfig } from '../config/appConfig'
import { cx } from '../lib/cx'
import { fillTemplate } from '../lib/format'
import { fmtDistance } from '../lib/geo'
import { RELAY, type RelayPump } from '../lib/hydraulics'
import { Icon } from '../lib/icons'
import { Popover } from '../lib/overlays'
import { fmtBar, PUMP_SELECTOR } from '../lib/useRelay'
import { IconButton } from './Button'
import { Stepper } from './Stepper'
import s from './PumpBubble.module.css'

// The tapped pump's bubble (round 4, device test 04.11.2026): where it stands, what comes in, and
// what it gives – the one number one might change, stepped on a writable relay and read on a
// locked one. ONE component for both places a pump is tapped: the Wassertransport chart
// (WaterRelay · RelayChart) and the map (RelayPumpMarkers). A portalled Popover at the pump –
// below it by preference, flipped and shifted to stay fully in view – so it may overflow the
// Messen panel but never makes it taller or scroll. Closes with its ×, Escape and an outside
// press; a press on a pump (lib/useRelay · PUMP_ATTR, chart or map) is that pump's own tap, which
// toggles or moves the bubble – closing here too would close it and the tap reopen it.

/** `anchor`: the pump's dot or marker; `anchorAt`: where it stands – a new value re-places the
 *  bubble (the pump was dragged; Base UI does not see an element move). `keepOpenOn`: a press on
 *  such a target is someone else's to handle (the map's own tap: MapView · dismissRelayBubble). */
export function PumpBubble({ anchor, anchorAt, pump, i, sourceLabel, terrain, readOnly, onBar, onClose, keepOpenOn }: {
  anchor: Element
  anchorAt: string
  pump: RelayPump
  i: number
  sourceLabel: string
  terrain: boolean
  readOnly: boolean
  onBar: (bar: number) => void
  onClose: () => void
  keepOpenOn?: (target: Element) => boolean
}) {
  const R = appConfig.copy.relay
  const name = fillTemplate(R.pumpN, { n: i + 1 })
  // a fresh virtual anchor per position, so Base UI re-places the bubble when the pump moves;
  // `contextElement` keeps Floating UI's scroll tracking (the Messen panel scrolls)
  const at = useMemo(() => ({ at: anchorAt, contextElement: anchor, getBoundingClientRect: () => anchor.getBoundingClientRect() }), [anchor, anchorAt])
  const where = fillTemplate(R.pumpAt, { dist: fmtDistance(pump.dist), source: sourceLabel })
  return (
    <Popover open anchor={at} side="bottom" align="center" sideOffset={6} zIndex={60} collisionBoundary={document.documentElement} popupClassName={s.bubble} ariaLabel={name}
      onOpenChange={(next, { reason, event }) => {
        if (next) return
        const t = event.target
        if (reason === 'outside-press' && t instanceof Element && (t.closest(PUMP_SELECTOR) || keepOpenOn?.(t))) return
        onClose()
      }}>
      <div className={s.head}>
        <span className={cx(s.badge, pump.low && s.badgeLow)}>{fillTemplate(R.pumpShort, { n: i + 1 })}</span>
        <span className={s.where}>
          <b>{where}</b>
          {(terrain || pump.pinned) && (
            <span>{[terrain && fillTemplate(appConfig.copy.measure.altitude, { m: Math.round(pump.alt) }), pump.pinned && R.pinned].filter(Boolean).join(' · ')}</span>
          )}
        </span>
        <IconButton label={appConfig.copy.closeDialog} onClick={onClose}><Icon id="close" /></IconButton>
      </div>
      <div className={s.row}><span>{R.inlet}</span>
        <b className={cx(pump.low && s.bad)}>{pump.inBar > 0 ? fmtBar(pump.inBar) : R.noPressure}</b>
      </div>
      <div className={s.row}><span>{R.outlet}</span>
        {readOnly ? <b>{fmtBar(pump.outBar)}</b> : (
          <Stepper value={pump.outBar} min={RELAY.pumpBarMin} max={RELAY.pumpBarMax} step={RELAY.barStep} snap decimals={1}
            format={fmtBar} onChange={onBar} ariaLabel={R.outlet} />
        )}
      </div>
    </Popover>
  )
}
