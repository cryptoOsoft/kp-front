import { Marker } from 'react-map-gl/maplibre'
import { useChartCursor } from '../lib/chartCursor'
import { pointAlongPath } from '../lib/geo'
import { MARKER_Z } from '../lib/labelPass'
import s from './ChartCursorMarker.module.css'

// The spot a chart is being read at, on the map (lib/chartCursor): the Wassertransport's chart and
// the plain Höhenprofil publish it while the pointer reads them. Rendered by MapView inside its
// <Map>, on the Lage and in the Karte app alike; nothing while nobody points at a chart.

const Z = { zIndex: MARKER_Z.selected }

/** Mounted inside MapView's <Map>; reads the published spot itself, so a scrub re-renders only this. */
export function ChartCursorMarker() {
  const spot = useChartCursor()
  if (!spot || spot.coords.length < 2) return null
  const [lng, lat] = pointAlongPath(spot.coords, spot.m)
  return (
    <Marker longitude={lng} latitude={lat} anchor="center" style={Z}>
      <span className={s.dot} aria-hidden />
    </Marker>
  )
}
