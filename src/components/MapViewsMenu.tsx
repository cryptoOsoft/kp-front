import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import type { CameraView, LngLat } from '../types'
import { Icon } from '../lib/icons'
import { appConfig } from '../config/appConfig'
import { cx } from '../lib/cx'
import { DockInfo } from './DockInfo'
import { useLongPress } from '../lib/useLongPress'
import { useIsPhone } from '../lib/useIsPhone'
import { usePopoverGuard } from '../lib/overlays/popoverGuard'
import { useLiveBearing } from '../lib/liveBearing'
import s from './MapViewsMenu.module.css'

/** Everything the saved-views control needs from App — the synced list plus the camera ops. */
export interface ViewsApi {
  list: CameraView[]
  current: { bearing: number; center: LngLat; zoom: number }
  onGo: (v: CameraView) => void
  onSave: () => void
  onRename: (id: string, name: string) => void
  onDelete: (id: string) => void
  onResetNorth: () => void
  /** fit the incident + all placed/drawn content into view (the old scope/locate button) */
  onFit: () => void
  /** take a single GPS fix and fly to it (the on-demand «Mein Standort» blue dot) */
  onLocate: () => void
  /** what holding the compass does, and the ⓘ that says so – absent: fit (`onFit`) with the
   *  views hint. The Karte home holds to the user's own position (owner, Karte Haus round 2). */
  hold?: { run: () => void; hint: string }
  /**
   * «Standort teilen» — reporting your own position to the command post for this Einsatz.
   *
   * It lives here, one row under «Mein Standort», because it is the same subject (where am I)
   * and because it has to be an ACT: switched on deliberately per Einsatz and off again by the
   * same tap.
   *
   * The row always renders. `note` carries the sub-line — why it cannot be used, or, while it
   * IS sharing, that tapping ends it. A control that vanishes is indistinguishable from one
   * that was never built, which is exactly how this feature read as missing for an hour of
   * hunting in production (2026-08-05); and a device broadcasting somebody's location must
   * say how to stop as plainly as it said how to start.
   */
  share?: {
    on: boolean
    label: string
    /** sub-line under the label. Rendered, never a `title=`: this is a touch surface, and a
     *  tooltip nobody can hover is the same as no explanation. */
    note?: string | null
    /** dimmed and inert, but still readable — see above */
    disabled?: boolean
    /** true when the action opened a child sheet and this menu should stay suspended beneath it */
    onToggle: () => boolean
  }
}

// Is the live camera (roughly) sitting on a saved view? Lets us highlight the one we're on so
// the operator recognises where they are. Loose tolerances — flyTo lands close, not exact, and
// a hand-nudge of a few metres shouldn't drop the highlight.
function isOnView(v: CameraView, c: { bearing: number; center: LngLat; zoom: number }): boolean {
  const dLng = Math.abs(v.center[0] - c.center[0])
  const dLat = Math.abs(v.center[1] - c.center[1])
  const dBear = Math.abs(((v.bearing - c.bearing + 540) % 360) - 180) // shortest angular gap
  return dLng < 1e-4 && dLat < 1e-4 && Math.abs(v.zoom - c.zoom) < 0.15 && dBear < 2
}

function ViewsPopover({ api, readOnly, coordsOn, onToggleCoords, onClose }: {
  api: ViewsApi
  readOnly: boolean
  coordsOn?: boolean
  onToggleCoords?: () => void
  onClose: () => void
}) {
  const cp = appConfig.copy.mapViews
  const hint = api.hold?.hint ?? cp.hint
  const [editingId, setEditingId] = useState<string | null>(null)
  const isPhone = useIsPhone()
  const commitRename = (id: string, name: string) => { api.onRename(id, name.trim()); setEditingId(null) }
  // the ⓘ at the end of the last row opens its sentence under that row (DockInfo's inline rule:
  // the menu has the room, a floating tip would land on the map) — and keeps it in view
  const [help, setHelp] = useState(false)
  const helpRef = useRef<HTMLParagraphElement>(null)
  useLayoutEffect(() => { if (help) helpRef.current?.scrollIntoView?.({ block: 'nearest' }) }, [help])
  const helpBtn = (
    <button type="button" className={cx(s.mini, help && s.miniOn)} aria-label={hint} title={hint}
      aria-expanded={help} onClick={() => setHelp((v) => !v)}><Icon id="info" /></button>
  )

  // No backdrop scrim — exactly like the measure/draw ToolDock: the dock just sits over the map,
  // the map stays fully draggable + clickable underneath, and it closes by tapping the compass
  // again, a row, or activating another tool. (A scrim would swallow map drags/clicks.)
  // ⚠️ No ✕ row (29.09.2026, sweep K14): a menu closes on its own tile or on a row, like the
  // Einsatz menu, which has neither ✕ nor a lone ⓘ tile — the two cost ~120px on a phone.
  return createPortal(
    <>
      {/* same spot as the measure/draw ToolDock, and the same glass: centred just left of
          the right tool rail (see .wb-dock / .wb-dock-map); the ⓘ ends the last row. */}
      <div className={cx(s.pop, s.dock, "mv-dock")} role="dialog" aria-label={cp.title}>
        <button className={cx(s.row, s.north)} onClick={() => { api.onResetNorth(); onClose() }}>
          <span className={s.ico}><Icon id="compass" /></span>
          <span className={s.name}>{cp.north}</span>
        </button>
        <button className={cx(s.row, s.north)} onClick={() => { api.onFit(); onClose() }}>
          <span className={s.ico}><Icon id="cross" /></span>
          <span className={s.name}>{cp.fit}</span>
        </button>
        <button className={cx(s.row, s.north)} onClick={() => { api.onLocate(); onClose() }}>
          <span className={s.ico}><Icon id="locate" /></span>
          <span className={s.name}>{cp.locate}</span>
        </button>
        {/* Standort teilen, directly under «Mein Standort» — same subject, and the one control
            that turns reporting on and off. Closes the menu like every other ACTION row here
            (the coords row below stays open because it is a display toggle you read in place):
            once you have switched sharing on you want the map back, the confirmation is the
            indicator in the top bar, and when the tap opens the name sheet instead this dock
            must be out of the way rather than sitting behind it. */}
        {api.share && (
          <button
            type="button"
            className={cx(s.row, s.north, api.share.on && s.on, api.share.disabled && s.rowOff, api.share.note && s.hasNote)}
            aria-pressed={api.share.on}
            disabled={!!api.share.disabled}
            onClick={() => { if (!api.share!.onToggle()) onClose() }}
          >
            {/* NOT the «locate» crosshair: this row sits directly under «Mein Standort», and
                giving two adjacent rows the same glyph is how an eye slides straight past the
                one it is looking for. «people» also says what the row actually does — it puts
                you on the Personen layer, which is the icon that layer carries. */}
            <span className={s.ico}><Icon id="people" /></span>
            <span className={s.name}>
              {api.share.label}
              {api.share.note && <small className={s.why}>{api.share.note}</small>}
            </span>
          </button>
        )}
        {/* coordinate readout toggle — lives here instead of as its own rail-footer button
            (rarely used; freed the slot for Ebenen). On a tablet/desktop it stays open so the
            state flip is visible in place.
            ⚠️ On a PHONE it closes (05.09.). This dock is nearly the whole screen there, and the
            readout it switches on lands under it — the coordinate the operator asked for, behind
            the menu they asked for it from. Closing in BOTH directions on purpose: nothing of
            the flip is readable behind the dock either way, so «tap the row, see the map» is the
            one rule to remember. */}
        {onToggleCoords && (
          <button className={cx(s.row, s.north, coordsOn && s.on)} aria-pressed={coordsOn}
            onClick={() => { onToggleCoords(); if (isPhone) onClose() }}>
            <span className={s.ico}><Icon id="coords" /></span>
            <span className={s.name}>{appConfig.copy.nav.coords}</span>
          </button>
        )}
        {/* No empty state: an operator who has saved no view is told nothing by a paragraph
            saying so — the «Ansicht speichern» row below IS the instruction, and the ⓘ carries
            the explanation. (18.09.2026) */}
        {api.list.length > 0 && <div className={s.sep} />}
        {api.list.map((v) => editingId === v.id ? (
          <div key={v.id} className={cx(s.row, s.editing)}>
            <span className={s.ico} style={{ transform: `rotate(${-v.bearing}deg)` }}><Icon id="compass" /></span>
            <input
              className={s.input} autoFocus defaultValue={v.name} aria-label={cp.rename}
              onKeyDown={(e) => { if (e.key === 'Enter') commitRename(v.id, e.currentTarget.value); else if (e.key === 'Escape') setEditingId(null) }}
              onBlur={(e) => commitRename(v.id, e.currentTarget.value)}
            />
          </div>
        ) : (
          <div key={v.id} className={cx(s.row, isOnView(v, api.current) && s.on)}>
            <button className={s.go} onClick={() => { api.onGo(v); onClose() }}>
              <span className={s.ico} style={{ transform: `rotate(${-v.bearing}deg)` }}><Icon id="compass" /></span>
              <span className={s.name}>{v.name}</span>
            </button>
            {!readOnly && (
              <>
                <button className={s.mini} aria-label={cp.rename} title={cp.rename} onClick={() => setEditingId(v.id)}><Icon id="pen" /></button>
                <button className={s.mini} aria-label={cp.delete} title={cp.delete} onClick={() => api.onDelete(v.id)}><Icon id="trash" /></button>
              </>
            )}
          </div>
        ))}
        {!readOnly && (
          <>
            <div className={s.sep} />
            {/* the last row carries the ⓘ at its end (K14) — a row of its own for one icon was
                44px of menu for nothing */}
            <div className={s.row}>
              <button className={s.save} onClick={() => api.onSave()}>
                <span className={s.ico}><Icon id="plus" /></span>
                <span className={s.name}>{cp.save}</span>
              </button>
              {helpBtn}
            </div>
            {help && <p ref={helpRef} className={s.help}>{hint}</p>}
          </>
        )}
        {/* a locked device has no «Ansicht speichern» row to end with, and the views hint teaches
            saving, which it cannot do (RBAC audit 22.10.2026) — so no ⓘ, unless the surface states
            its own hold (Karte home: `hold.hint`), which is not about saving */}
        {readOnly && api.hold && <div className={s.foot}><DockInfo text={api.hold.hint} inline /></div>}
      </div>
    </>,
    document.body,
  )
}

/** The compass needle. It turns WITH the finger while the Karte is being rotated (03.10.2026,
 *  owner: «live-update the compass while rotating similar to the wind direction») — the same
 *  per-frame store the wind arrow reads (lib/liveBearing), so only this span re-renders per
 *  frame, never the button, its menu or IncidentWorkspace. `bearing` is the settled one, used
 *  while no Karte is mounted. NO transition on it (MapUtility.module.css · .compass,
 *  07-toolrail · .vrail-compass): per frame it would only trail the finger, and at the ±180°
 *  seam MapLibre's bearing flips sign, which a transition spins the long way round. */
function CompassGlyph({ bearing, className }: { bearing: number; className: string }) {
  const live = useLiveBearing(bearing)
  return <span className={className} style={{ transform: `rotate(${-live}deg)` }}><Icon id="compass" /></span>
}

/**
 * The multi-purpose compass: always visible (it rotates to the live bearing as an indicator),
 * and tapping it opens the saved-views popover — `Nach Norden`, the team's saved framings, and
 * `Aktuelle Ansicht speichern`. The trigger styling is supplied by the caller so it sits
 * natively in either the tool rail's view bar (`rail`) or the top-right map HUD (`util`).
 */
export function MapViewsButton({ api, bearing, readOnly, variant, btnClassName, activeClassName, glyphClassName, label, open, onOpenChange, coordsOn, onToggleCoords }: {
  api: ViewsApi
  bearing: number
  readOnly: boolean
  variant: 'rail' | 'util'
  btnClassName: string
  /** applied when open, so the compass lights up like any other active tool button */
  activeClassName?: string
  glyphClassName: string
  /** shown next to the glyph in the rail variant (the HUD variant is icon-only) */
  label?: string
  /** controlled by App so the popover is mutually exclusive with the drawing/measure tool docks */
  open: boolean
  onOpenChange: (open: boolean) => void
  /** coordinate-readout toggle row in the popover (replaces the old rail-footer button) */
  coordsOn?: boolean
  onToggleCoords?: () => void
}) {
  const cp = appConfig.copy.mapViews
  const glyph = <CompassGlyph bearing={bearing} className={glyphClassName} />

  // Hold the compass to fit the incident into view (or what `api.hold` says), without going through the menu. A quiet
  // shortcut for the one row that gets used over and over — deliberately undiscoverable by
  // accident (500 ms, cancels on any movement, so a pan or a scroll of the rail never trips
  // it) and never the ONLY way there: «Einpassen» stays a plain row one tap in.
  const phone = useIsPhone()
  const triggerRef = useRef<HTMLButtonElement>(null)
  usePopoverGuard(open && phone)
  useEffect(() => {
    if (!open || !phone) return
    const outside = (e: PointerEvent) => {
      const target = e.target instanceof Element ? e.target : null
      if (target && !target.closest('.mv-dock') && !triggerRef.current?.contains(target)) onOpenChange(false)
    }
    document.addEventListener('pointerdown', outside, true)
    return () => document.removeEventListener('pointerdown', outside, true)
  }, [open, phone, onOpenChange])
  // Escape closes the popover, and only it (S8, 20.10.2026). The Einsatz map's own Escape
  // (IncidentWorkspace) reached it only after a pending placement and the crosshair, and the
  // Karte's never did. Capture phase + stop, so one press is one layer; a field (the rename
  // input) keeps its own Escape, which ends the rename first.
  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return
      const t = e.target instanceof HTMLElement ? e.target : null
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return
      e.stopPropagation()
      onOpenChange(false)
      triggerRef.current?.focus()
    }
    document.addEventListener('keydown', onKey, true)
    return () => document.removeEventListener('keydown', onKey, true)
  }, [open, onOpenChange])
  const hold = useLongPress()
  // A fired hold must not also open the menu: the browser still delivers the click on release.
  // Cleared at the START of every press, not only when that click arrives — a hold whose click
  // never lands (pointercancel, a finger that slid off) would otherwise leave the flag set and
  // silently swallow the NEXT tap, turning the compass dead for one press.
  const fired = useRef(false)
  const holdProps = hold.press(() => { fired.current = true; if (api.hold) api.hold.run(); else api.onFit() })

  return (
    <>
      <button
        ref={triggerRef}
        className={cx(btnClassName, open && activeClassName)}
        title={cp.title}
        aria-label={cp.title}
        aria-pressed={open}
        aria-expanded={open}
        aria-haspopup="dialog"
        // `data-holdaction` (from the hold's props): the HUD compass is icon-only, so the
        // hold-tooltip would pop «Ansichten» at 350 ms and the fit would follow at 500
        {...holdProps}
        onPointerDown={(e) => { fired.current = false; holdProps.onPointerDown(e) }}
        onClick={() => {
          if (fired.current) { fired.current = false; return }
          onOpenChange(!open)
        }}
      >
        {variant === 'rail'
          ? <><span className="vrail-glyph">{glyph}</span><span className="vrail-label">{label ?? cp.title}</span></>
          : glyph}
      </button>
      {open && <ViewsPopover api={api} readOnly={readOnly} coordsOn={coordsOn} onToggleCoords={onToggleCoords} onClose={() => onOpenChange(false)} />}
    </>
  )
}
