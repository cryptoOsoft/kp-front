// English copy · the Karte: tools, nav, views, hints.
// One slice of the `en` overlay, assembled in ../en.ts; the German base is ../de/map.ts.

import type { Copy, Localizable } from '../index'

type Keys =
  | 'mapTools' | 'planTools' | 'nav' | 'mapViews' | 'toast' | 'dockHints' | 'map'

export const mapCopy: Localizable<Pick<Copy, Keys>> = {
  mapTools: [
    { id: 'select', icon: 'select', label: 'Select', kind: 'tool', alt: { id: 'lasso', icon: 'marquee', label: 'Multi' } },
    { id: 'symbol-slot', slot: true, icon: '', label: '' },
    { id: 'line', icon: 'pen', label: 'Line', kind: 'tool' },
    { id: 'area', icon: 'area', label: 'Area', kind: 'tool' },
    { id: 'circle', icon: 'circle', label: 'Cordon', kind: 'tool' },
    { id: 'note', icon: 'type', label: 'Note', kind: 'tool' },
    { id: 'team', icon: 'flag', label: 'Team', kind: 'tool' },
    { id: 'measure', icon: 'measure', label: 'Measure', kind: 'tool' },
  ],
  planTools: [
    { id: 'pan', icon: 'select', label: 'Select', alt: { id: 'lasso', icon: 'marquee', label: 'Multi' } },
    { id: 'symbol-slot', slot: true, icon: '', label: '' },
    { id: 'line', icon: 'pen', label: 'Line' },
    { id: 'area', icon: 'area', label: 'Area' },
    { id: 'circle', icon: 'circle', label: 'Cordon' },
    { id: 'text', icon: 'type', label: 'Note' },
    { id: 'resource', icon: 'flag', label: 'Team' },
    { id: 'measure', icon: 'measure', label: 'Measure' },
  ],
  nav: {
    zoomIn: 'Zoom in',
    zoomOut: 'Zoom out',
    fit: 'Fit',
    resetNorth: 'Align north',
    centerIncident: 'Center on incident',
    coords: 'Pick coordinates',
    coordsHint: 'Tap the map to capture',
    coordsLocked: 'Captured – ✕ to finish',
    coordsExit: 'Exit coordinates',
    autoMode: 'Automatic',
    deviceMode: 'Device',
    dayMode: 'Day',
    nightMode: 'Night',
  },
  toast: {
    audioSaved: 'Audio note saved ({secs}s)',
    micDenied: 'No microphone access – noted as placeholder',
    micFailed: 'Recording could not be started',
    merged: 'Changes merged',
  },
  dockHints: {
    lasso: 'Drag a frame around several objects with one finger. Two fingers still pan the map. Tapping «Multi» again switches back to Select.',
    line: 'Drag on the map or tap points to draw a line. Pick colour, width and style afterwards in the editor.',
    lineFreehand: 'Drag to draw a line. For single points: «Points». Pick colour, width and style afterwards in the editor.',
    lineNodes: 'Tap points, finish with ✓. Pick colour, width and style afterwards in the editor.',
    area: 'Drag to draw the outline freely – for a fire edge that has no corners. Or tap at least three corners, finish with ✓.',
    circle: 'Drag from the center outward to set the radius in metres. Adjust radius and fill afterwards in the editor.',
    note: 'Tap the map to drop a note.',
    team: 'Tap the map and pick the crew from the list. Drag to move it.',
    shape: 'Tap the map to place the shape. Turn on "Place several" to place several in a row.',
    rotationStart: 'Tap the first point — where the water is drawn from. Hold on a symbol until the ring closes to put the point exactly on it.',
    rotationEnd: 'Tap the second point — the fire. Tapping the same point again lays down a Rotation at its default length.',
    measure: 'Tap points on the map. Distance shows length and elevation profile, area shows surface and perimeter. Drag points to move, the + in the middle of a segment inserts an intermediate point, press and hold a point (right-click on a computer) to remove it.',
  },
  map: {
    incidentHere: 'Incident',
    youHere: 'My location',
    glLost: 'Map display interrupted',
    glLostHint: 'The device released the map’s graphics context. Your entries are saved.',
    glLostAction: 'Rebuild map',
    noTilesTitle: 'No base map saved for this area',
    noTilesSub: 'Offline – objects and lines are shown without a map',
    noTilesAction: 'Offline readiness',
    noTilesDismiss: 'Hide',
  },
  mapViews: {
    title: 'Views',
    north: 'Face north',
    fit: 'Fit',
    locate: 'My location',
    save: 'Save view',
    hint: 'A view stores the map exactly as it is — position, zoom and rotation. Tap a saved view to jump there (e.g. between a north overview and the map turned the way you are standing). Long-press the compass to fit straight away.',
    rename: 'Rename',
    delete: 'Delete',
    saved: 'View saved',
    deleteTitle: 'Delete view',
    deleteMsg: 'Delete «{name}»?',
  },
}
