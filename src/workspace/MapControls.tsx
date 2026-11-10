// The Karte's floating controls on top of the map — the map-utility cluster, the views and
// Ebenen buttons, the replay/locked variants — plus the phone backdrop and the Ebenen dock.
// Split out of IncidentWorkspace (E1, 09.10.2026) verbatim; `mapUI` and `panel` gate them as before.

import { Suspense, type RefObject, type Dispatch, type SetStateAction } from 'react'
import type { MapRef } from 'react-map-gl/maplibre'
import { BuildingFloat } from '../components/BuildingFloat'
import { LayerPanel } from '../components/LayerPanel'
import { MapUtility } from '../components/MapUtility'
import type { ViewsApi } from '../components/MapViewsMenu'
import { WeatherBadge } from '../components/TopBar'
import { WeatherRadarControls } from '../components/weatherLazy'
import { appConfig } from '../config/appConfig'
import { hasBuildingContent } from '../lib/buildingCard'
import { fmtLV95, fmtWGS } from '../lib/geo'
import type { useGeorefMode } from '../lib/georefMode'
import { type GeorefPlan, planRasterRows } from '../lib/georefTwins'
import { Icon } from '../lib/icons'
import type { useBuildingInfo } from '../lib/useBuildingInfo'
import type { useCoordPicker } from '../lib/useCoordPicker'
import type { useIsPhone } from '../lib/useIsPhone'
import type { LngLat, WeatherData, LayerDef, LayerId } from '../types'
import type { MeasuredPoint } from '../lib/readingsList'
import { ReadingsChip } from '../components/ReadingsChip'
import { undergroundLayerDef } from '../lib/underground'
import type { LayerPreset } from '../lib/layerPreset'
import type { KarteWeather } from './useKarteWeather'

export interface MapControlsProps {
  mapUI: boolean
  mapUtility: boolean
  mapRef: RefObject<MapRef | null>
  view: { bearing: number; center: LngLat; zoom: number }
  viewsApi: ViewsApi
  readOnly: boolean
  isEl: boolean
  viewsOpen: boolean
  toggleViews: (open: boolean) => void
  coord: ReturnType<typeof useCoordPicker>
  panel: 'layers' | null
  layersPreset: LayerPreset
  togglePanel: (name: 'layers') => void
  isPhone: ReturnType<typeof useIsPhone>
  slimRail: boolean
  displayWeather: WeatherData | null
  openWeatherDetails: () => void
  replayActive: boolean
  georefMode: ReturnType<typeof useGeorefMode>
  buildingInfo: ReturnType<typeof useBuildingInfo>
  /** the Gebäude card's first open on this device (lib/buildingFirstOpen) */
  buildingFirst: { autoOpen: boolean; markRead: () => void }
  setPanel: Dispatch<SetStateAction<'layers' | null>>
  composerOpen: boolean
  journalOpen: boolean
  offlineReadyOpen: boolean
  layers: LayerDef[]
  toggleLayer: (id: LayerId) => void
  setOpacity: (id: LayerId, v: number) => void
  linkedPlans: GeorefPlan[]
  twinLayers: Record<string, boolean>
  twinLayerOpacity: Record<string, number>
  setAllLayers: (visible: boolean) => void
  resetLayers: () => void
  /** the weather layer (workspace/useKarteWeather): its radar pill joins the chip row */
  weather: KarteWeather
  /** the «Messungen» chip (components/ReadingsChip): every Messpunkt worst first, and the way to
   *  one. Null in a replay; no chip while none is placed. */
  readings: { points: MeasuredPoint[]; go: (p: MeasuredPoint) => void } | null
}

export function MapControls({
  mapUI, mapUtility, mapRef, view, viewsApi, readOnly, isEl, viewsOpen, toggleViews, coord, panel,
  layersPreset, togglePanel, isPhone, slimRail, displayWeather, openWeatherDetails, replayActive,
  georefMode, buildingInfo, buildingFirst, setPanel, composerOpen, journalOpen, offlineReadyOpen, layers,
  toggleLayer, setOpacity, linkedPlans, twinLayers, twinLayerOpacity, setAllLayers, resetLayers,
  weather, readings,
}: MapControlsProps) {
  // The Karte's ONE bottom-left chip row (below): the Gebäude chip and the radar pill, in that
  // order. Each piece is decided HERE, so the row exists only when one of them has something to
  // say — its presence alone lifts the message lane (08-toasts, 15-mobile · --float-row).
  const rowAllowed = !replayActive && !georefMode.planId
  const showBuilding = rowAllowed && hasBuildingContent(buildingInfo)
  const showReadings = rowAllowed && !!readings?.points.length
  // …and it opens by itself the first time (lib/buildingFirstOpen) — not over a panel, the Verlauf
  // or the composer the operator went to: it waits until they come back to the bare Karte
  const buildingAutoOpen = buildingFirst.autoOpen && panel === null && !viewsOpen && !composerOpen && !journalOpen && !offlineReadyOpen
  const wxRadarInRow = rowAllowed && weather.on && !!weather.layer && weather.radarOn
  return (
    <>
      {mapUI && (
        <>
          {/* zoom + locate — normally folded into the right ToolRail footer; floats
              top-right only on desktop where the rail is gone (replay, whose scrubber the rail's
              Messen readout would collide with). On a phone the tool bar's footer carries
              Ebenen + the compass, so this cluster isn't rendered there. */}
          {mapUtility && (
            <MapUtility
              onZoomIn={() => mapRef.current?.zoomIn()}
              onZoomOut={() => mapRef.current?.zoomOut()}
              bearing={view.bearing}
              views={viewsApi}
              // `|| isEl`: saved camera views live in the shared blob (cameraViews), which the
              // el record slice never pushes — offering «Speichern» would fake a shared save
              readOnly={readOnly || isEl}
              viewsOpen={viewsOpen}
              onViewsOpenChange={toggleViews}
              coordsOn={coord.mode !== 'off'}
              onToggleCoords={coord.cycle}
              layersOn={panel === 'layers'}
              layersPreset={layersPreset}
              onToggleLayers={() => togglePanel('layers')}
            />
          )}

          {/* phone: the wind read-out floats top-right under the bar — the top bar clipped it at
              the screen edge (that bar already carries switcher · Einsatzuhr · undo/redo ·
              Verlauf). NOT on a read-only surface: there the top bar has room for the weather
              (measured: 96px free with no undo/redo/Eintrag). The compass is NOT up here: it sits
              in the tool bar, beside Ebenen, where the map's other controls are (05.08.2026). It
              floated here again for one day (18.09.) and came back down — above the bar its menu
              opened half a screen away from the thumb that asked for it. */}
          {isPhone && !slimRail && displayWeather?.wind_dir_deg != null && (
            <div className="phone-wx">
              <WeatherBadge weather={displayWeather} onOpenMeteo={openWeatherDetails} bearing={view.bearing} popAlignOffset={-5} popInset={5} />
            </div>
          )}

          {/* coordinate readout — bottom-centre; aiming follows the cursor, set is locked.
              hidden during replay so it never stacks under the bottom-centre scrubber. The ✕ on
              its right (THE `.ip-x`, 44px pad) is the same exit in both states — the mode used to
              be leavable only from the compass menu, two taps away, while it swallowed every map
              tap (02.09.). Its instruction is the readout's own last line, at the map's foot where
              Messen's stands (MeasurePanel · MapHint). Never under Messen any more: Koordinaten
              is a tool, so the two are never on together (IncidentWorkspace · coord). */}
          {/* The Karte's bottom-left chip row — the same place and recipe as the plan's
              (Whiteboard · .wb-botleft), so Lage and Plan say it in one spot: the Gebäude chip and
              the radar pill. ONE row for both — two rows in one slot covered each other
              (09.10.2026). Rendered only with something to say: the row's presence alone lifts
              the message lane. Not during replay (a past Lage, and its scrubber owns the foot) or
              «Karte verknüpfen». On a phone it stays one line: the
              Gebäude chip keeps its words, the radar pill gives way (WeatherLayer.module.css). */}
          {(showBuilding || showReadings || wxRadarInRow) && (
            <div className="wb-botleft wx-row">
              {showBuilding && <BuildingFloat info={buildingInfo} autoOpen={buildingAutoOpen} onRead={buildingFirst.markRead} />}
              {/* «Messungen» + the worst reading: the list of every Messpunkt (ReadingsChip) */}
              {showReadings && <ReadingsChip points={readings.points} compact={isPhone} onGo={readings.go} />}
              {wxRadarInRow && (
                <Suspense fallback={null}>
                  <WeatherRadarControls radar={weather.radar} frameIndex={weather.playback.frameIndex}
                    playing={weather.playback.playing} onPick={weather.playback.pick}
                    onTogglePlaying={weather.playback.togglePlaying} stale={weather.radarStale} now={weather.now} />
                </Suspense>
              )}
            </div>
          )}

          {coord.readout && !replayActive && (
            <div className={`coord-read${coord.mode === 'aim' ? ' aiming' : ''}`} role="status">
              <div className="cr-rows">
                <div className="cr-row"><span className="cr-tag">LV95</span><span className="cr-val">{fmtLV95(coord.readout[0], coord.readout[1])}</span></div>
                <div className="cr-row"><span className="cr-tag">WGS84</span><span className="cr-val">{fmtWGS(coord.readout[0], coord.readout[1])}</span></div>
              </div>
              <button type="button" className="ip-x cr-x" title={appConfig.copy.nav.coordsExit} aria-label={appConfig.copy.nav.coordsExit} onClick={() => coord.setMode('off')}>
                <Icon id="close" />
              </button>
              <div className="cr-hint">{coord.mode === 'aim' ? appConfig.copy.nav.coordsHint : appConfig.copy.nav.coordsLocked}</div>
            </div>
          )}

        </>
      )}

      {/* click-away: a transparent full-screen backdrop closes the open map panel */}
      {/* phone only: a tap-catcher behind the panel sheet to close it. On desktop the panel
          floats as a side card, so NO backdrop — the map stays pannable with Ebenen open. */}
      {/* ⚠️ The KARTE's backdrop, and only it (15.09.2026). The Plan half used to be here for a
          LayerPanel the Plan no longer has — and with the panel gone the catcher was the whole
          bug it was once written to avoid: a full-screen z28 sheet over the z20 whiteboard,
          eating the first tap on a board that looked perfectly normal. */}
      {mapUI && panel !== null && isPhone && <div className="mapctl-backdrop" onClick={() => setPanel(null)} />}

      {/* the Ebenen dock (.layers-card z201) sits ABOVE the +Eintrag composer / Verlauf
          scrim that covers every other map popup, so it needs an explicit guard to hide
          with them — otherwise it pokes through the modal (parity with the tool popups) */}
      {mapUI && panel === 'layers' && !composerOpen && !journalOpen && !offlineReadyOpen && (
        <LayerPanel
          layers={layers}
          onToggle={toggleLayer}
          onOpacity={setOpacity}
          twins={planRasterRows(linkedPlans, twinLayers, twinLayerOpacity)}
          // …directly under «Lage», wherever the deployment's config calls that group: the sheet
          // a symbol was drawn on belongs beside that symbol, not past Wasser and Gefahren.
          twinsAfterGroup={layers.find((l) => l.id === appConfig.defaults.operationalLayerId)?.group}
          // «Unterirdische Bauten» right under the plans (owner, review round 6)
          groupsAfterTwins={[undergroundLayerDef().group]}
          onShowAll={() => setAllLayers(true)}
          onHideAll={() => setAllLayers(false)}
          onReset={resetLayers}
          preset={layersPreset}
          weather={weather.row}
          onClose={() => setPanel(null)}
        />
      )}
    </>
  )
}
