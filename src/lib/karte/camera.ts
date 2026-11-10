// «Karte & Objekte» — two map rules of the viewer, pure so they can be tested without MapLibre
// (components/karte/useKarteCamera wires them; docs/karte-objekte.md · «The viewer»).
//
// 1. A TOOL THAT WAITS FOR A TAP TAKES EVERY TAP (owner, review round 4, 17.10.2026: «while
//    measuring we should also be able to measure on top of objects (not have the objects get
//    highlighted)»). While Messen, «Punkt setzen» or Gefahrgut's «tap to set the centre» is armed,
//    a tap on an object's outline, dot or name tag is a tap on the map at that spot: no object is
//    selected or highlighted, no sheet opens. The objects stay drawn.
//
// 2. CLOSING A SELECTION GIVES THE CAMERA BACK (owner, round 4: «after closing the zoom in for an
//    object or map point center or revert the position again so it doesn't constantly push the
//    map south»). Selecting frames the place in the strip above the phone's sheet (or beside the
//    tablet's panel) — with MapLibre's camera PADDING, which stays on the map after the move. So
//    the camera before the selection is kept (centre, zoom AND padding) and given back, briefly
//    animated, when the sheet closes:
//    · a second selection while one is open keeps the FIRST one's camera as the way back;
//    · the user moving the map themselves while it is open drops the way back (their view wins);
//    · a pick from the SEARCH is a deliberate jump somewhere else — flying back to where the search
//      began would undo the search, so closing it only drops the padding: the place stays, centred
//      on the whole map instead of in the strip above a sheet that is gone.
//
// 3. THE FREE MAP IS WHAT IS LEFT BESIDE THE TABLET'S CHROME (owner, review round 6, 20.10.2026:
//    «When having opened a plan … and then going back to the map, sometimes the object isn't
//    neatly in focus»). A place is framed in the middle of the map between the panel and the tool
//    rail, under the bar — measured from the rails' published widths, so the round-5 chevron's
//    wider rail moves the middle with it (`besidePanel`). And back from a plan the selected
//    object is framed there again (useKarteCamera · useFrameOnReturn), however the tap that selected it left the map.

import type { Tool } from '../../components/karte/useKarteTools'
import type { LngLat } from '../../types'

/** A map tool armed for a tap (components/karte/useKarteTools · Tool), and Gefahrgut's ring mode. */
export function toolTakesTaps(tool: Tool, ergMode: string): boolean {
  return tool === 'measure' || tool === 'pin' || (tool === 'erg' && ergMode !== 'off')
}

export interface Padding { top: number; bottom: number; left: number; right: number }
export interface Camera { center: LngLat; zoom: number; padding: Padding }

/** Where the camera goes when the open selection closes. */
export type CameraReturn = { to: 'camera'; cam: Camera } | { to: 'centre' }

export const NO_PADDING: Padding = { top: 0, bottom: 0, left: 0, right: 0 }

/** The tablet's camera padding: the free map right of the object panel and left of the tool rail,
 *  under the bar. `railW` / `toolsW` are the rails' published widths (`--rail-w`, `--vrail-w`).
 *  The numbers are Karte.module.css's `.panel.withRail` (16px in, beside the rail, 404px wide)
 *  and 07-toolrail.css's `.tool-rail` (16px in from the right). */
export function besidePanel(railW: number, toolsW: number): Padding {
  return { top: 80, bottom: 0, left: 16 + railW + 16 + 404, right: 16 + toolsW }
}

/** A place was selected (`how`: a tap on the map / a row of «In der Nähe», or a search pick) with
 *  the camera at `now`, BEFORE the selection moves it. An open selection keeps its way back. */
export function returnOnSelect(cur: CameraReturn | null, now: Camera, how: 'tap' | 'search' = 'tap'): CameraReturn {
  if (cur) return cur
  return how === 'search' ? { to: 'centre' } : { to: 'camera', cam: now }
}

const samePadding = (a: Padding, b: Padding) => (['top', 'bottom', 'left', 'right'] as const).every((k) => Math.abs((a[k] ?? 0) - (b[k] ?? 0)) < 0.5)

export function sameCamera(a: Camera, b: Camera): boolean {
  return Math.abs(a.center[0] - b.center[0]) < 1e-7 && Math.abs(a.center[1] - b.center[1]) < 1e-7
    && Math.abs(a.zoom - b.zoom) < 1e-3 && samePadding(a.padding, b.padding)
}

/** The camera to ease to when the selection closes with the map at `now` — null: stay. The user's
 *  own move has already dropped `r` to null (useKarteCamera · movestart with an originalEvent). */
export function cameraOnClose(r: CameraReturn | null, now: Camera): Camera | null {
  if (!r) return null
  const to = r.to === 'camera' ? r.cam : { center: now.center, zoom: now.zoom, padding: NO_PADDING }
  return sameCamera(to, now) ? null : to
}
