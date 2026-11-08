import { Icon } from '../lib/icons'
import { appConfig } from '../config/appConfig'
import { cx } from '../lib/cx'
import { MapViewsButton, type ViewsApi } from './MapViewsMenu'
import { layerPresetLabel, type LayerPreset } from '../lib/layerPreset'
import s from './MapUtility.module.css'

interface Props {
  onZoomIn: () => void
  onZoomOut: () => void
  bearing: number
  views: ViewsApi
  readOnly: boolean
  viewsOpen: boolean
  onViewsOpenChange: (open: boolean) => void
  coordsOn: boolean
  onToggleCoords: () => void
  /** Ebenen — the read-only view has no right ToolRail, so the map's layer panel (which
      also carries the Basiskarte choice) opens from this cluster instead */
  layersOn?: boolean
  onToggleLayers?: () => void
  /** which quick-tap the layer set matches — named in the button's tooltip / accessible name
   *  (lib/layerPreset, 05.10.2026) */
  layersPreset?: LayerPreset
}

// Top-right map controls — [compass] | zoom · coordinates. The compass is the always-present,
// multi-purpose views button (rotates to the live bearing; opens Nach Norden, Einpassen + saved
// framings — "Einpassen" replaces the old standalone scope button). A thin divider separates the
// zoom pair from the coordinate action. Desktop-only (read-only / replay) — on a phone these fold
// into the top bar.
export function MapUtility({
  onZoomIn, onZoomOut, bearing, views, readOnly, viewsOpen, onViewsOpenChange, coordsOn, onToggleCoords,
  layersOn, onToggleLayers, layersPreset = 'standard',
}: Props) {
  const c = appConfig.copy.nav
  // (Day/night toggle moved to the incident dropdown menu — see IncidentSwitcher. The
  // coordinate toggle is a row in the compass menu, matching the view bar's compass.)
  return (
    <div className={s.toputil}>
      <MapViewsButton api={views} bearing={bearing} readOnly={readOnly} variant="util" btnClassName={s['tu-btn']} activeClassName={s.on} glyphClassName={s.compass} open={viewsOpen} onOpenChange={onViewsOpenChange} coordsOn={coordsOn} onToggleCoords={onToggleCoords} />
      <button className={s['tu-btn']} title={c.zoomOut} aria-label={c.zoomOut} onClick={onZoomOut}><Icon id="minus" /></button>
      <button className={s['tu-btn']} title={c.zoomIn} aria-label={c.zoomIn} onClick={onZoomIn}><Icon id="plus" /></button>
      {onToggleLayers && (
        <>
          <span className={s['tu-divider']} aria-hidden />
          <button className={cx(s['tu-btn'], layersOn && s.on)} title={`${appConfig.copy.panels.layers} · ${layerPresetLabel(layersPreset)}`} aria-label={`${appConfig.copy.panels.layers} – ${layerPresetLabel(layersPreset)}`} aria-pressed={layersOn} onClick={onToggleLayers}><Icon id="layers" /></button>
        </>
      )}
    </div>
  )
}
