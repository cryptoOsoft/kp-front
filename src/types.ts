// The shared domain types – what the Lage, the Plan, the Atemschutz board, the Verlauf and the
// record are made of (`Entity`, `Drawing`, `BoardAnno`, `Trupp`, `TimelineEvent`, `Person` …).
// Types only, no runtime code. Most of these shapes are synced and stored, so a change here is a
// data change: map coordinates are WGS84 `LngLat` = `[lng, lat]`, plan positions 0..1 in
// plan-image space; a new `BoardKind` bumps `WORKSPACE_SCHEMA_VERSION` (lib/workspace) and joins
// `BOARD_KIND_SINCE` (backend app/workspace_kinds.py), so an older build carries it as a passenger.
// Rules: docs/sync-and-offline.md.

import type { BoardFormData } from './lib/boardForm'
import type { Out } from './lib/api/wire'
export type LngLat = [number, number]

export type LayerId = string

export interface LayerDef {
  id: LayerId
  group: string
  label: string
  /** compact name for the Basiskarte tile row, where a full name has ~70px to live in
   *  («OpenStreetMap» → «OSM»). Falls back to `label`. */
  shortLabel?: string
  icon: string          // sprite id in the inline UI icon set
  locked?: boolean
  base?: boolean        // part of the radio base-layer group
  visible: boolean
  opacity?: number      // 0..100, only for overlay layers (plan)
  tiles?: string[]      // raster tile template(s) for base layers
  nightTiles?: string[] // optional dark-theme raster to swap to in night mode (e.g. Dark Matter)
  labels?: boolean      // the raster is unlabelled; draw CARTO's names on top as vector text (lib/basemapLabels)
  dark?: boolean        // base is already dark (skip the night dim)
  maxzoom?: number
  attribution?: string
  geojson?: string              // URL to a GeoJSON FeatureCollection (vector overlay)
  vectorKind?: 'line' | 'point' // how to render a geojson overlay (default 'line')
  color?: string                // stroke/fill colour for a geojson overlay
  nightColor?: string           // brighter stroke/fill for night mode (dark colours vanish on the dark base)
  symbol?: string               // FireGIS symbol name to use as the icon for a point overlay
  autoActivate?: string[]       // Einsatz categories (German labels) that auto-show this layer
}

/** `person` = a crew member's self-reported live position (Standort teilen). Always `live`,
 *  never placed by an operator and never persisted — see lib/usePersonPositions. */
export type EntityKind = 'symbol' | 'vehicle' | 'note' | 'photo' | 'shape' | 'team' | 'person'

/** editable generic shapes (not tactical symbols) — placed, then reshaped via
 *  colour / size / rotation. e.g. an arrow for direction, a cloud for smoke. */
export type ShapeKind = 'arrow' | 'cloud' | 'square' | 'rotation'

/**
 * The letter a line carries in its FKS end tag — what KIND of line this is.
 *
 * S/W/H/P are the Druckleitung devices (Schaumrohr · Wasser · Hydroschild · Pulverpistole,
 * Behelf Einsatzführung S. 37). N/T/G are the Vegetationsbrand-Haltelinien (nass · trocken ·
 * Gegenfeuer, Handbuch S. 52) — the same question asked of a different line, so the same field
 * answers it rather than a second one nobody would find. Names in copy · lineDecor.
 */
export type LineContent = 'S' | 'W' | 'WW' | 'H' | 'P' | 'N' | 'T' | 'G'

/** A Leitung's hose diameter (mm). «2x75» is the identical double line: two 75 mm hoses side by
 *  side, each carrying half the water (lib/hydraulics · HOSES). Absent = the station's relay
 *  default on a Leitung with a Wassertransport, else its Linie default (lib/hydraulics ·
 *  lineHose; shipped 75 / 40 mm). */
export type HoseSize = '40' | '55' | '75' | '2x75' | '110'
/** Where a Wassertransport starts: a Hydrant (its Ruhedruck), a Löschweier (no pressure — the
 *  first pump stands at the source) or a pump (its output). */
export type RelaySource = 'hydrant' | 'weier' | 'pumpe'
/** One pump of a relay, adjusted by hand: moved to `atM` metres from the source along the line,
 *  and/or set to put out `bar`. Either absent = automatic. */
export interface RelayPumpOverride { atM?: number; bar?: number }
/**
 * The Wassertransport assumptions of a Leitung (Drawing/BoardAnno · `relay`) or of a Messen
 * Strecke — everything the relay calculation (lib/hydraulics · planRelay) needs besides the
 * route and the hose. Every field absent = its default (lib/hydraulics · RELAY). `pumps` is by
 * pump index; JSON has no holes, so an untouched pump before a touched one is `null`.
 */
export interface RelaySettings {
  /** l/min wanted at the end */
  flow?: number
  source?: RelaySource
  /** Hydrant Ruhedruck or the source pump's output (bar); a Löschweier has none */
  startBar?: number
  pumps?: (RelayPumpOverride | null)[]
  /** the water runs from the route's LAST point to its first – a line drawn from the fire back to
   *  the hydrant. The geometry stays as drawn (its ends, arrows and attachments mean what they mean). */
  reverse?: boolean
  /** «Pumpen auf Karte»: the Leitung draws its calculated pumps as Motorspritzen on the Karte and
   *  the printed Kroki – derived from the calculation every time, never stored as symbols
   *  (lib/linePumps). A Leitung only; a Messen Strecke never sets it. */
  showPumps?: boolean
}

/** The built-in steppers in the symbol editor that change how the glyph reads on
 *  the surface: `rotation` (orientation), `count` (quantity badge), `floor` (storey
 *  badge — map only) and `floorRange` (a von/bis storey span, e.g. stairs/lift —
 *  rendered as a combined `-1/+3` badge on BOTH surfaces). Each symbol declares,
 *  via its preset, which are meaningful for it; the editor shows only those
 *  (see symbolControls). */
export type SymbolControl = 'rotation' | 'rotation2' | 'count' | 'floor' | 'floorRange' | 'spread' | 'airflow'

/** FKS Entwicklung (spread) on a damage symbol — Feuer/Wasser/Gefahrstoffe.
 *  Rendered as arrows in the symbol's own colour (red/blue/orange): horizontal
 *  arrows left/right, and/or vertical up/down arrows (which pair with the symbol's
 *  Geschoss number). Each direction carries its own Entwicklungsgrenze bar at the
 *  arrow tip (→|). Absent / all-empty = no spread.
 *
 *  All four directions are INDEPENDENT, and so is every bar: a fire running both
 *  ways along a Fassade, stopped at a Brandmauer on one side only, is one symbol
 *  and not two. ⚠️ `left`/`right` used to be one exclusive `h: 'E' | 'W'` field
 *  with a single `hBounded`, and `up`/`down` shared one `vBounded` — incidents
 *  written before this still carry that shape, so nothing reads these fields raw.
 *  Everything goes through `normalizeSpread` (lib/spread.ts), and the Kroki
 *  renderer has the same normalisation in Python (`_spread_dirs` in kroki.py). */
export interface Spread {
  left?: boolean
  right?: boolean
  up?: boolean
  down?: boolean
  /** per-direction Entwicklungsgrenze — the bar at that arrow's tip */
  leftBounded?: boolean
  rightBounded?: boolean
  upBounded?: boolean
  downBounded?: boolean
}

/** The pre-2026-08 shape, still present in stored incidents. Read-only: nothing writes it. */
export interface LegacySpread {
  h?: 'E' | 'W'
  hBounded?: boolean
  up?: boolean
  down?: boolean
  vBounded?: boolean
}

/** Attributes shared by a placed tactical symbol on EITHER surface (Lage map
 *  `Entity` or Plan whiteboard `BoardAnno`). Both interfaces extend this, so a
 *  symbol carries — and is edited with — the SAME attribute set everywhere; a
 *  new attribute added here lights up on both surfaces. NOTE: `floor` is NOT
 *  here on purpose — it means different things per surface (a signed badge value
 *  on the map vs. a floor-stack tile index on the plan), so each keeps its own. */
/** One gas reading of a Messpunkt – see SymbolProps.readings. */
export interface Reading {
  t: number
  v: Record<string, string>
}

export interface SymbolProps {
  /** name of the FireGIS symbol to render (key into the symbol library) */
  symbol?: string
  /** title (German operational name); shown in the symbol editor */
  label?: string
  /** type line under the title (e.g. the symbol category) — auto-set on placement */
  subtitle?: string
  /** structured key/value details shown + edited in the symbol editor. Seeded from
   *  a per-symbol template on placement; rows are freely added/edited/removed. */
  fields?: Record<string, string>
  /** free-text general notes (one multi-line field, separate from the key/value details) */
  notes?: string
  /** quantity this object represents — shown as a badge at the icon's bottom-right.
   *  Positive only; absent or 1 = no badge (the default). */
  count?: number
  /** rotation in degrees — applied to the glyph on both surfaces (and to shapes) */
  rotation?: number
  /** secondary rotation (deg) — only the composite Grosslüfter uses it: `rotation`
   *  aims the vehicle body, `rotation2` aims the overlaid fan / airflow direction. */
  rotation2?: number
  /** lower / upper storey of a vertical span (stairs, lift) — rendered together as
   *  a `-1/+3` badge on the glyph. Surface-agnostic (unlike the map-only `floor`),
   *  so it shows on the Plan where building elements actually live. */
  floorFrom?: number
  floorTo?: number
  /** FKS Entwicklung (spread) arrows — see Spread. Shown on Feuer/Wasser/Gefahrstoffe. */
  spread?: Spread
  /** airflow direction of a Lüfter: absent/false = Einblasen (arrow blows away from the fan,
   *  Überdruck), true = Absaugen (arrow reversed to point INTO the fan — the fan is positioned in
   *  the space but draws air out). Only meaningful for the mobile Lüfter (`controls: ['airflow']`);
   *  the renderer swaps in the reversed-arrow glyph. */
  extract?: boolean
  /** a measured symbol's history (the Messpunkt, 27.10.2026): one row per reading, oldest
   *  first, appended by the panel whenever a measured field changes (lib/symbols · recordReading).
   *  `t` is epoch ms, `v` the measured fields at that moment. Append-only on purpose – two tablets
   *  entering the same radio report must both survive a merge (lib/mergeWorkspace). */
  readings?: Reading[]
  /** symbol/shape accent colour */
  color?: string
  /** ERG Schutzabstand rings around a Gefahrentafel (lib/ergRings). Absent = 'small': the
   *  small-spill isolation + protective circles appear automatically once a UN number resolves
   *  to TIH distances; 'large' switches to the large-spill column, 'off' silences this placard.
   *  Map-only presentation — the Plan has no metric scale, so the field just rides along there. */
  ergRings?: 'off' | 'small' | 'large'
  /** Gefahrentafel angedockt (lib/docking): the id of the entity this placard belongs to.
   *  Set/cleared by the drop gesture on the Karte; the host drags its placard along and a
   *  deleted host releases the bond. Only placards carry it, only on the map. */
  dockedTo?: string
  /** on-canvas caption mode for this one symbol — overrides the global device default
   *  (`appConfig.symbols.captionDefault`). Absent = follow the global default. 'off' hides
   *  it, 'auto' shows the one discriminating value (e.g. a Kleinlöscher's Typ), 'all' shows
   *  every filled detail. Value-only — the glyph already conveys the key. See lib/symbols. */
  caption?: CaptionMode
  // --- free-text note styling (Lage `Entity` kind 'note' / Plan `BoardAnno` kind 'text') ---
  // A note grows from a one-line pill into a wrapping text box; these describe how it LOOKS,
  // while the box WIDTH lives per-surface (Entity.noteW in screen px, BoardAnno.wN as a
  // fraction of the plan width) because the two surfaces scale differently. Absent
  // everywhere = the original one-line pill, so stored incidents render unchanged.
  /** relative text size: 's' ×0.8, 'm' ×1 (absent = 'm'), 'l' ×1.45. */
  noteSize?: NoteSize
  /** the box width follows the typed text (see lib/notes · autoNoteWPx / autoNoteWN) instead of
   *  sitting at the surface default. Set on a freshly placed note and cleared the moment the
   *  width is dragged by hand — a width the operator chose is never recomputed. The width itself
   *  is always stored as a number, so the PDF/print renderers need to know nothing about this. */
  noteAutoW?: boolean
  /** drop the yellow Zettel background + border and render bare text (a heading on a blank
   *  sheet). The renderers add a `--note-halo` outline so bare text stays legible over an
   *  aerial / a dark plan — never a background-less plain colour. */
  notePlain?: boolean
  /** «Gelöscht / erledigt» (review item 21b, 24.09.2026): the thing this symbol marks is OVER —
   *  the fire is out, the Rettung done — but it happened, so the symbol STAYS on the picture,
   *  greyed, with the time (lib/objectDone). Deleting it («Entfernen») is for a mistake only.
   *  A PROP, not geometry: it lives in SymbolProps, so it is part of the vocabulary both bodies
   *  share and crosses with every write-through and every bake (lib/tacticalObjects) like `count`
   *  does. Setting and clearing it are ordinary undoable prop edits. Offered on `kind: 'symbol'`
   *  only — a Fläche/Absperrkreis would need its own greyed ink on four renderers. */
  done?: ObjectDone
}

/** Where a photo was taken — the privacy-reduced EXIF of one Verlauf picture (lib/photoGeo). */
export interface PhotoGeo {
  lat: number
  lng: number
  /** metres above sea level */
  alt?: number
  /** bearing of the lens, degrees clockwise from north [0, 360) */
  heading?: number
  /** EXIF DateTimeOriginal, ISO-like local time (offset when the file states one) — or, for a
   *  device position, the moment of the fix */
  takenAt?: string
  /** WHERE the position came from: the photo's own EXIF, or the device's position at the moment
   *  the picture arrived (lib/devicePosition — the in-app camera of an iPhone delivers none).
   *  Absent on rows written before 09.10.2026, which are all EXIF. */
  source?: 'exif' | 'device'
  /** the device fix's accuracy radius in metres (device positions only) */
  acc?: number
}

/** When a symbol was marked «gelöscht / erledigt», and by whom. `at` is an ISO instant on the
 *  deployment's clock (lib/serverClock · serverNowIso), the same clock every Verlauf row uses. */
export interface ObjectDone {
  at: string
  /** author display name snapshot, when known (like `MittelEvent.by`) */
  by?: string
}

/** Relative note text size. Absent = 'm'; see `NOTE_SIZE_SCALE` in lib/notes. */
export type NoteSize = 's' | 'm' | 'l'

/** How much of a symbol's metadata is printed under its glyph on the map / plan:
 *  'off' none, 'auto' the single discriminating value, 'all' every filled detail. */
export type CaptionMode = 'off' | 'auto' | 'all'

export interface Entity extends SymbolProps {
  id: string
  kind: EntityKind
  layer: LayerId
  coord: LngLat
  /** inline SVG markup to render instead of a library symbol — used for live
   *  vehicles, whose name + orientation are baked into the glyph */
  symbolSvg?: string
  /** storey where the represented event is happening — shown as a signed badge
   *  (e.g. +2, -1) at the icon's top-right in the symbol's own colour. 0 = EG,
   *  +1 = OG1, -1 = UG1. Absent = no floor badge. (Map-only meaning; see SymbolProps.) */
  floor?: number
  badge?: string        // short text shown in the context panel avatar
  photoUrl?: string     // for kind 'photo'
  // --- kind 'photo' placed from a Verlauf photo («Auf Karte setzen», lib/photoGeo) ---
  /** WHICH picture this marker shows: the Verlauf row and the photo's index on it. The row is
   *  the photo's record; `photoUrl` above is only the URL it had when it was placed (a session
   *  `blob:` while the upload is pending), and the map reads the row's current one through this
   *  (lib/photoGeo · resolvePhotoUrl). Its presence is what makes a photo marker part of the
   *  record — the legacy session-only ones without it are still dropped at the wire. */
  photoOf?: { row: string; i: number }
  /** the bearing the lens pointed at (EXIF GPSImgDirection), degrees clockwise from north —
   *  drawn as a view cone. Absent = the photo said nothing about its direction. */
  heading?: number
  /** when the photo was taken (EXIF DateTimeOriginal, ISO-like local time) */
  takenAt?: string
  /** kind 'note': box width in SCREEN px — map notes are pinned to a constant screen size
   *  (they don't scale with zoom, see symPx), so a ground-metre width would be wrong here.
   *  The Plan analogue is `BoardAnno.wN`. ABSENT = the legacy auto-width pill (capped by CSS
   *  at 180px, no wrapping); its presence is what makes a note a text box. */
  noteW?: number
  /** externally sourced (e.g. live GPS) — read-only: not draggable, editable or persisted */
  live?: boolean
  /** live vehicles only: the glyph shows a heading arrow (the vehicle has moved at some point).
   *  False for one that has never moved, whose body is drawn neutral. Carried on the entity so a
   *  renderer can REBUILD the glyph (e.g. to compensate the map bearing) without inventing a
   *  direction the vehicle never reported — see lib/useVehiclePositions · vehicleSymbolSvg. */
  directed?: boolean
  // --- kind 'shape' ---
  shape?: ShapeKind
  sizeM?: number        // shape WIDTH on the ground, in metres (height = sizeM × aspect)
  /** height/width ratio of the shape's box — absent = 1 (the original square proportions), so
   *  stored incidents render unchanged. Only free-aspect kinds stretch (see lib/shapes ·
   *  SHAPE_FREE_ASPECT); the Pfeil stays proportional. The Plan mirror is `BoardAnno.aspect`. */
  aspect?: number
  /** arrow shape only: the «→|» Stopp-Balken across the tip — the same Entwicklungsgrenze
   *  statement a line's `arrowStop` makes. The Plan mirror is `BoardAnno.stop`. */
  stop?: boolean
  /** Rotation only: which vehicle runs the shuttle (lib/shapes · RotationCarrier) */
  carrier?: 'heli' | 'tlf'
  /** Rotation only: the shuttle circulates the OTHER way round — both direction heads mirrored
   *  (lib/shapes · rotationInner). Absent = the default sense. The Plan mirror is
   *  `BoardAnno.reverse`. */
  reverse?: boolean
  /** the outline's weight, in the drawn Fläche's own three steps (`appConfig.drawing.widths`) —
   *  a Form is a pre-shaped area and is edited with the area's vocabulary. Absent = the middle
   *  step, which is what every shape stored before 01.09. is drawn at. A FACTOR, not pixels: the
   *  artwork travels to the print path as a string that never learns the box's pixel size
   *  (lib/shapes · SHAPE_STROKE_DEFAULT). The Plan mirror is `BoardAnno.strokeW`. */
  strokeW?: number
  /** shape fill — the SAME two answers a drawn Fläche gives, because a Rechteck is a Fläche that
   *  came pre-shaped: a wash at this opacity (0 = outline only), or `hatch` for the Schraffur.
   *  Absent = the default wash. The Plan mirror is `BoardAnno.fillOpacity` / `.hatch`, which the
   *  board's own areas already use. */
  fillOpacity?: number
  hatch?: boolean
  /** Rechteck: square corners instead of the rounded default. A Fläche drawn by hand has the
   *  corners its points make, so the pre-shaped one has to be able to say the same thing. */
  sharpCorners?: boolean
  /** locked: exactly the lock a drawn Fläche has — the same field, name AND behaviour as
   *  `Drawing.locked` / `BoardAnno.locked`: the ink is click-through (no select, no drag, no
   *  lasso), and the centre LockChip (short hold) is the only door back in
   *  (MapMarkers · shape-lock-anchor). */
  locked?: boolean
  /** aerial-appliance boom reach in metres (Hubretter) — the ground distance from the truck
   *  (`coord`) to the rescue cage; the cage is the draggable tip and `rotation2` its bearing.
   *  Metre-scaled like `sizeM` so the cage stays over its ground spot as the map zooms. The Plan
   *  mirror is `BoardAnno.reachN`. Absent = the seeded default. */
  reachM?: number
  // --- kind 'team' (Atemschutz-Trupp tracked on the Lage map — the geo mirror of the
  // plan board's 'resource' chip; a Trupp is placed on exactly ONE surface at a time) ---
  /** linked Atemschutz Trupp (this marker represents that team) */
  truppId?: string
  /** recorded position breadcrumbs (markPosition) — part of the incident record */
  trail?: GeoTrailPoint[]
  /** HH:MM of the last move / position mark (mirrors BoardAnno.t) */
  t?: string
}

/** One breadcrumb of a team marker's movement trail on the Lage map (WGS84). */
export interface GeoTrailPoint { coord: LngLat; t: string }

/** One vehicle position (GET /api/traccar/positions, backend app/traccar · VehiclePosition):
 *  `speed` km/h, `course` heading in degrees, `last_update` ISO. `status` is Traccar's own word
 *  ('online' | 'offline' | 'unknown' from a real tracker; the fake fleet takes any). */
export type VehiclePosition = Out<'VehiclePosition'>

/** Current weather near a coordinate (GET /api/weather, backend WeatherData): `wind_dir_deg` is
 *  the meteorological FROM bearing (0=N, 90=E); `weather_code` the WMO present-weather code
 *  (0=clear, 2=partly, 3=overcast, 45=fog, 6x=rain, 7x=snow, 95=storm…). */
export type WeatherData = Out<'WeatherData'>

export type DrawKind = 'line' | 'area' | 'circle'
export type LineEndpoint = 'start' | 'end'
export type LineRoutingMode = 'direct' | 'trace'
export type GpsFollowState = 'guarded' | 'continuous' | 'paused'

/** Persisted relationship intent for one magnetic line endpoint. The coordinate stored in
 *  `coords`/`pts` remains its fail-safe fallback and is materialised before detaching. */
export interface LineAttachment {
  target: { kind: 'object'; id: string; live?: boolean } | { kind: 'line'; id: string; endpoint: LineEndpoint }
  routing: LineRoutingMode
  /** Assigned 0..2 when the target is the three-port end of an FKS Teilstück (-E). */
  port?: number
  gps?: {
    state: GpsFollowState
    /** Target position at the last operator confirmation (WGS84 on Lage). */
    confirmedAt: LngLat
    /** Last safely resolved endpoint; used while GPS following is paused/missing. */
    lastSafe: LngLat
    /** The line as it stood ON SITE when «Weiter folgen» (or «Spur») was tapped — lib/gpsReturn.
     *  Taken once and never overwritten while the end follows, so «Zurück auf Stand am
     *  Einsatzort» can put the line back exactly. Optional and additive: an older client spreads
     *  `gps` wherever it writes it, so the field rides along untouched and is simply never read.
     *  ⚠️ Valid only while its `confirmedAt` is this coupling's (gpsReturn · freshBefore): an
     *  older build re-confirming the end keeps a snapshot that no longer describes anything. */
    before?: GpsFollowSnapshot
  }
}
/** `LineAttachment.gps.before` — the on-site line at the moment following began. */
export interface GpsFollowSnapshot {
  /** the line's vertices, its GPS end on the point the screen showed on site */
  coords: LngLat[]
  routing: LineRoutingMode
  state: GpsFollowState
  confirmedAt: LngLat
  /** the coupling's `lastSafe` at the tap: the LAST ON-SITE SAMPLE (a paused end stopped taking
   *  samples when the vehicle crossed the 20 m guard), not where the vehicle was at the tap. The
   *  point every «vom Einsatzort» distance is measured from. */
  lastSafe: LngLat
  /** ISO time of the tap (server clock) */
  at: string
}
export interface Drawing {
  id: string
  kind: DrawKind
  coords: LngLat[]
  color?: string
  width?: number
  /** circle radius in metres (circle kind only — coords holds a single [center]).
   *  Backs the Gefahrenradius / Absperrkreis; rendered via circlePolygon(). */
  radiusM?: number
  /** fill opacity 0..1 for closed shapes (circle / area). Absent = the default fill. */
  fillOpacity?: number
  /** Fläche schraffiert statt gefüllt — the FKS reading of an AFFECTED area (lib/draw · Schraffur) */
  hatch?: boolean
  /** render the line dashed instead of solid (lines only). Absent = solid. */
  dashed?: boolean
  // --- annotated-polyline fields (lines only). A tool "preset" just seeds these on
  //     creation; every one stays editable in the DrawEditor afterwards. ---
  /** draw an arrowhead at the LAST coord, pointing along the final segment. */
  arrow?: boolean
  /** the Entwicklungsgrenze bar across the arrowhead — «bis hier, und dort gestoppt», the same
   *  statement the fire's bounded spread arrow makes (lines with `arrow` only). */
  arrowStop?: boolean
  /** a single letter (e.g. "R") repeated inline along the line (—R— look). */
  marker?: string
  /** show an auto geodesic-length label at the polyline midpoint. */
  showDistance?: boolean
  /** free-text label shown at the polyline midpoint. */
  label?: string
  // --- Abschnitt fields (areas only). FKS Einsatzführung 3.5.2: an Abschnitt has a Leiter
  //     and an Auftrag — and the drawn Fläche IS the Abschnitt, no separate object (06.09.).
  /** who leads the Abschnitt — a display NAME (roster-picked or typed), not a person id: the
   *  map label, the Rapport and the paper Kroki all want the words, and nothing resolves a
   *  person through this field. Renders after `label` («Abschnitt 1 · Oblt Steiner»). */
  abschnittLeiter?: string
  /** what the Abschnitt is to achieve — one line, rendered under the label/Leiter line */
  abschnittAuftrag?: string
  /** screen-space px offset of the distance/text label from the polyline midpoint, so it
   *  can be nudged off overlapping drawings. Absent / 0 = pinned at the midpoint.
   *  DEPRECATED on the Lage map (drifted on zoom) — superseded by the georeferenced
   *  `labelAt`; still used by the Plan whiteboard, where it is a board-relative offset. */
  labelDx?: number
  labelDy?: number
  /** georeferenced anchor (WGS84 [lng,lat]) the distance/text label was dragged to, so it
   *  stays pinned to the ground at every zoom + map bearing. Absent = the polyline midpoint. */
  labelAt?: LngLat
  // --- FKS hose-line annotations (lines only) ---
  /** Teilstück coupling at the line end: a forward "E"-fork instead of an arrowhead. */
  teilstueck?: boolean
  /** FKS device/content letter at the line end: S=Schaumrohr, WW=Wasserwerfer, H=Hydroschild,
   *  P=Pulverpistole. Wasser = plain line (unset); a stored 'W' is an older build's Wasser chip and
   *  reads as Wasser – which is why the Wasserwerfer is «WW», not the FKS letter W (28.10.2026). */
  content?: LineContent
  /** Druckleitung number shown in a small box on the line (e.g. 1. Druckleitung). ALSO the
   *  identity of the Leitung for the Atemschutz link: the same number on the Lage and on a Plan
   *  is one hose drawn twice, and both carry the Trupp tag (see lib/truppLines). Unique per
   *  surface. */
  lineNo?: number
  /** Atemschutz link ANCHOR — the Trupp this line was explicitly picked for (mirrors
   *  `Trupp.lineId`, the way a team chip's `truppId` mirrors `Trupp.annoId`). Display resolves by
   *  anchor OR number, so neither an undo of the stamped number nor a merge that drops the anchor
   *  can blank the tag. Never read by the contact clock: the drawing decorates the Atemschutz
   *  record, it never feeds it. */
  truppId?: string
  /** storey the line works on, shown as a signed badge (+2 / 0 / -1) by the number box. */
  floorTag?: number
  /** screen-space px offset of the FKS end-tag from its default spot (just before the line end),
   *  so it can be dragged clear of other symbols. Absent / 0 = the default position.
   *  DEPRECATED on the Lage map — superseded by the georeferenced `endLabelAt`. */
  endDx?: number
  endDy?: number
  /** georeferenced anchor (WGS84 [lng,lat]) the FKS end-tag was dragged to. Absent = the
   *  default spot just before the line end. Keeps the tag pinned at every zoom + bearing. */
  endLabelAt?: LngLat
  /** A Linie switched to a Wand in the line editor's «Art» row (lines only; sweep 28.10.2026,
   *  Lage ↔ Plan parity): the Plan's `BoardAnno.role`, same name, same meaning – LAYOUT, not a
   *  hose. It draws in the Wand look (lib/grundriss · wallRolePatch), carries no Typ, Leitung Nr.
   *  or Trupp, and no Leitung couples onto its ends. Crosses with the line between the Karte and
   *  a sheet (tacticalObjects · SHARED_PATH_PROPS, planProjection · projectOnto). Absent = Linie. */
  role?: 'wand'
  /** the hose diameter of a Leitung (lines only; the line editor's «Schlauch» row). Absent =
   *  the station's relay or Linie default (lib/hydraulics · lineHose). Crosses to a sheet like the other
   *  FKS fields (SHARED_PATH_PROPS). */
  hose?: HoseSize
  /** the Wassertransport assumptions of this Leitung — flow, source, pumps moved by hand
   *  (lines only; DrawEditor · Messung). Absent = the defaults. Planning data, not a record:
   *  no Verlauf row (lib/drawingEdit). */
  relay?: RelaySettings
  /** locked: the shape ignores click-select / drag so it can't be moved by accident or
   *  swallow clicks meant for objects over it (e.g. a big Absperrkreis under other work).
   *  A lock chip at its centre unlocks it. Absent = editable. */
  locked?: boolean
  /** Magnetic relationship intent at the first/last vertex (lines only). */
  startAttachment?: LineAttachment
  endAttachment?: LineAttachment
}

/** Which surface an event originated on. Drives the Verlauf row's chip + the
 *  jump-back target (map fly-to vs. plan recenter). */
export type Surface = 'map' | 'plan'

/** A single line in the unified, append-only journal (Verlauf). Events are never
 *  edited or removed — undo/redo on either surface append their own rows — so the
 *  log is a faithful incident record that could later back a standalone screen. */
export interface TimelineEvent {
  id: string
  t: string             // HH:MM
  /** absolute timestamp for reports/exports. Older saved rows may only have `t`. */
  at?: string
  /** When the SERVER wrote the row, where that differs from `at` — an observer's row is dated
   *  by the fact it records (a wind reading, a GPS time) and may arrive long after it
   *  (backend · app/observations). Read for «is this still news», never for ordering. */
  writtenAt?: string
  icon: string
  text: string
  kind?: 'audio' | 'symbol' | 'vehicle' | 'layer' | 'note' | 'photo' | 'snapshot' | 'journal' | 'team' | 'history' | 'reminder'
  /** Pendenz / Wiedervorlage lifecycle. The journal is append-only (see kp-front-journal), so an
   *  open item is never a row with a mutated status: the `created` row carries op (+ `dueAt` if it
   *  is a timed Erinnerung), and `done`/`snoozed`/`note` are their OWN later rows referencing the
   *  same `id`. The open set is DERIVED from these events (see lib/reminders.ts), never edited in
   *  place.
   *
   *  Two ways in, one lifecycle:
   *   - the ○ switch on an ordinary entry → `created` WITHOUT `dueAt` (a Pendenz: open until done,
   *     never alarms — there are no check-ins on a Schadenplatz, so a due time would be a fiction)
   *   - the Erinnerung mode → `created` WITH `dueAt` (alarms, snoozes, the banner)
   *  ⚠️ The `created` event rides on the ENTRY'S OWN row — «Auftrag · Trupp 2 entraucht …» is both
   *  the record and the Pendenz. Tracking hangs off this event, never off `entryType: 'auftrag'`:
   *  keying it to the tag would turn every Auftrag row already written into an eternally open
   *  Pendenz, in live and archived incidents alike.
   *  ⚠️ `note` is forward-compatible by construction: the reducer treats everything that is not
   *  `done` as still open, so an older client meeting one fails in the safe direction.
   *  `reopened` (23.09.2026) is the «Rückgängig» of an «Erledigt» — the correction appended beside
   *  the done row, never a deletion of it — and rides the same tolerance: to an older client (and
   *  to the backend's push sweep) it is simply «not done». */
  reminder?: {
    /** ⚠️ `dueAt` on a `note` is a MOVED Wiedervorlage, not a second reminder: a Meldung that
     *  reports «Werkhof meldet 20 Minuten» is exactly the moment the item's own clock shifts. It
     *  rides on the note rather than on a `snoozed` row of its own, because the sentence has to
     *  stay in the item's thread (lib/reminders · the note branch reads the dueAt and leaves the
     *  open/closed state alone). */
    op: 'created' | 'done' | 'snoozed' | 'note' | 'reopened'; id: string; dueAt?: string
    /** Pendenz only: sorts to the top of the list and prints a marker.
     *  ⚠️ Written by `created` alone. The composer offered it on a Meldung for a while, as a
     *  «normal / dringend» switch — but a Meldung reports on an item, and a control sitting on one
     *  of them silently re-ranked the whole Pendenz. The reducer still takes it from whatever
     *  event carries it (order-independent, and an older or later client may), so re-ranking could
     *  be offered again as its own action; nothing writes it after the fact today. */
    urgent?: boolean
    /** «Wer», for the Rapport column — the first vocabulary name in the entry's text
     *  (lib/journalLinks · linkParts). NOT a field anybody fills in: whoever writes «Trupp 2
     *  entraucht Treppenhaus» has said who it is for, and a Trupp is titled by its Gruppenführer,
     *  who is in the vocabulary already. Absent when the sentence names nobody. */
    assignee?: string
    /** ⚠️ The BARE Wiedervorlage, as typed — «Pizza bestellen», not the row's own `text`
     *  («Erinnerung gesetzt für 12:06: Pizza bestellen»). The two are not the same string: the
     *  row is the record and has to say what was decided and for when, while every place that
     *  RE-shows the reminder (the pinned block, the fällig banner, the erledigt/snooze rows)
     *  already prints the Fälligkeit beside it and only wants the thing to do. Reading the row
     *  text there stuttered the time and the word «Erinnerung» twice per line.
     *  Optional: rows written before this existed fall back to the stripped `text`. */
    text?: string
    /** `created` by «wieder in …» on a done row: the item it re-raises (lib/reminders ·
     *  openReRaises). While it is open, that done row shows ✓ «↻ in 30 min gesetzt» instead of
     *  its chips (05.11.2026: a double tap raised two). Absent on every other `created`. */
    again?: string
    /** `created` only: the item was typed as a row on the Tafel's «Aufträge / Pendenzen» page
     *  (05.11.2026) — the Verlauf's Pendenzen block marks it «von der Tafel». Absent = the composer. */
    origin?: 'tafel'
    /** `note` only: a CORRECTION of the item's own words from the Tafel page (05.11.2026) — Was
     *  and/or Wer as they stand now, latest wins per field ('' clears the Wer; `{}` when only the
     *  Prio. changed — its presence is what marks the row a correction). Rides on `note`
     *  (with `urgent` for the page's «Prio.») because that op is the safe one for an older
     *  client: it reads the row as one more Meldung and never as a change of open/closed — a new
     *  op would have been taken for «not done» and reopened a closed item there. The reducer
     *  (lib/reminders · foldPendenzen) applies it and keeps it out of the item's thread. */
    edit?: { text?: string; assignee?: string }
  }
  /**
   * A record divergence and its answer — the same append-only lifecycle the `reminder` above
   * follows, for the same reason: an open item is never a row with a mutated status.
   *
   * ⚠️ Why the row carries STRUCTURE and not just its sentence. Until 04.09. a divergence was a
   * «bitte prüfen» line and nothing more, so the only thing anybody could do with it was read
   * it — and the 03.09. Rapport was closed at 11:41 with three of them standing. To let somebody
   * actually settle one, the row has to still know what the two values WERE; the merge that saw
   * them is long over by the time the Rapport is filled in.
   *
   * `raised` carries `sides`; `resolved` is a LATER row naming the same `sig` and what was
   * decided. The open set is derived from the pair (lib/attendanceConflict · openConflicts),
   * never edited in place.
   */
  conflict?: {
    op: 'raised' | 'resolved'
    /** stable, device-independent identity of the divergence (attendanceConflict ·
     *  conflictSignature) — the two rows find each other by this and nothing else */
    sig: string
    /** the record that diverged: a Person id for an Anwesenheit, a Trupp id for the Atemschutz */
    key?: string
    /** `raised`: the two values, in the signature's own sorted order — so both devices write the
     *  same pair in the same order and index 0/1 means the same thing on either of them */
    sides?: { source?: AttendanceSource; entry: AttendanceEntry }[]
    /** `resolved`: which side was taken (index into `sides`), or that both were let stand */
    choice?: 0 | 1 | 'both'
  }
  /** enrichment patch: this row carries later-arriving fields (transcript, uploaded media
   *  URL) for the row with id `patchOf`. The journal store folds patches onto their target
   *  at display time and hides the patch row itself — rows are never edited in place
   *  (append-only record; same pattern as the reminder lifecycle above). */
  patchOf?: string
  /** Stamped by the SERVER on a row it accepted while the Einsatz was closed (api/journal,
   *  staging r3): a Kontakt from 14:44 that arrived at 14:47, after a 14:45 close, keeps its
   *  place in time — and still prints as a Nachtrag, because it reached the record late. */
  receivedAfterClose?: boolean
  /** Written BY the Abschluss itself, between the operator's confirm and the close — the crews it
   *  went over, the ones it stood down (staging r6, F3). Part of the close, never a Nachtrag, even
   *  when the device's clock put it a moment past the server's `closed_at` (lib/verlauf ·
   *  isNachtrag bounds how far past). */
  atClose?: boolean
  /** A server boundary row: the Einsatz was closed or reopened here (backend · append_system_row).
   *  What the clients key the reopen's clock restart on — never the German sentence. */
  lifecycle?: 'closed' | 'reopened'
  /** patch payload only: corrected text for the target row. Patch rows carry a filler
   *  `text: ''`, so a text correction needs its own field — the store folds it onto the
   *  target's `text` at display time (append-only correction, same as transcript). */
  textEdit?: string
  /** patch payload only: ONE transcript section for the target audio row — offset in seconds
   *  into the recording plus the words heard there. Written by the player's transcript
   *  composer (voice memos) and by confirmed STT segments; the store folds them into
   *  `transcriptSections`. Append-only, like every other enrichment. */
  transcriptSection?: { at: number; text: string }
  /** patch payload only: replace one section's words (`id` = the section's creating patch row).
   *  Empty text removes the section. NOT a «Korrektur» that marks the row — the recording is
   *  the original and stays; its transcription may simply be fixed. */
  transcriptSectionEdit?: { id: string; text: string }
  /** DERIVED by journalStore's fold: every transcriptSection patch (id = its patch row, so an
   *  edit can address it), sorted by offset. The Verlauf lists them as subtitle lines under
   *  the row; the row's own text stays «Audionotiz (8s)» so the recording remains
   *  recognisable as one. */
  transcriptSections?: { id: string; at: number; text: string }[]
  /** DERIVED, never written to a row: when a `textEdit` patch folded onto this row (the patch's
   *  own `at`). The Verlauf marks the line «korrigiert HH:MM» from it — a corrected line that
   *  looked untouched would be the one thing an append-only record must not do: quietly show
   *  something other than what was said at the time. The original text and the correction both
   *  stay in the record and in the hash chain; this is only how the fold is shown.
   *  ⚠️ Set by journalStore's fold, so it exists on displayed rows and on nothing that is sent. */
  correctedAt?: string
  /** DERIVED, like `correctedAt`: the row's FIRST wording, kept through any number of
   *  corrections. The printed rapport shows it beside the latest text («korrigiert HH:MM ·
   *  ursprünglich: …») — intermediate revisions stay in the record but are not printed. */
  textOriginal?: string
  /** retraction (append-only "delete"): a later patch sets this and the row folds out of
   *  display/report — both the original and the retraction stay in the record. Only
   *  player-created Nachdokumentation rows offer this; incident log lines never do. */
  retracted?: boolean
  audioUrl?: string
  /** structured audio metadata — the stable time origin later waveform markers and
   *  transcript offsets hang off */
  audioMeta?: {
    source: 'recorded' | 'imported'
    startedAt: string      // ISO — confirmed recording start
    durationSec?: number
    originalName?: string
  }
  transcript?: string
  photoUrl?: string      // attached photo (journal entry) — session-only blob, stripped on save
  /** SEVERAL photos on one row — one damage is rarely one picture, and attaching a second used
   *  to REPLACE the first. `photoUrl` above is the single-photo shape every row written before
   *  2026-08-06 carries; readers take both (see lib/verlauf · rowPhotos). */
  photoUrls?: string[]
  /** WHERE each picture was taken, read from its EXIF before the re-encode strips it
   *  (lib/exif, lib/photoGeo): aligned by index with the row's photos AS CAPTURED, `null` for a
   *  picture without a position. Absent when none had one. Only position, heading and time —
   *  never the camera, the owner or anything else the file carried. Read through
   *  `rowPhotoGeo`, which trusts the alignment only while the photo count matches. */
  photoGeo?: (PhotoGeo | null)[]
  /** Beilagen that are neither picture nor recording (PDF, Dokument, Tabelle): the row shows a
   *  named chip that downloads the file. The URL is ALWAYS a server url — a generic file is
   *  uploaded during save and never enters the offline queue (same rule as an imported memo,
   *  see lib/audioImport), so there is no blob: URL to swap here. */
  files?: { url: string; name: string }[]
  /** which screen the event happened on — shown as a chip, drives the jump target */
  surface?: Surface
  // --- map jump target ---
  entityId?: string      // related map entity — select + fly to it on Lage
  coord?: LngLat         // free map point (journal pin) — fly to it on Lage
  /**
   * WHICH object this row is about, when the row is deliberately not a jump target — a
   * deletion (the object is gone) or an edit to a drawing (which has no jump of its own).
   *
   * Display-only, and read by exactly one thing: the repeat fold (lib/verlauf · repeatRuns),
   * which groups a run by text AND object. Rows that carried no object at all grouped by text
   * alone, so two DIFFERENT symbols removed seconds apart printed as «Feuerwehr gelöscht 2×» —
   * one thing that happened twice, where two things had each happened once (03.09.: Feuerwehr,
   * Polizei and Lüfter, all of them pairs). It is deliberately NOT `entityId`: that field is
   * what makes a row clickable (lib/verlauf · rowTarget), and a deletion must not offer a jump to
   * something that no longer exists.
   */
  subjectId?: string
  // --- plan jump target ---
  planId?: string        // plan document the event belongs to
  px?: number            // plan-space x (0..1) to recenter on
  py?: number            // plan-space y (0..1)
  floor?: number         // floor-stack storey (0 = EG), if applicable
  annoId?: string        // related board annotation (e.g. a team) to select
  /** user-dropped pin (vs. an automatic entity/team link) — shown with a pin glyph */
  pinned?: boolean
  /**
   * What kind of statement this was — Führungsrhythmus (BGV Behelf Schadenplatz): an ordinary
   * observation, an order given, or an immediate measure. Absent = ordinary, the vast majority.
   *
   * ⚠️ ALSO written into `text` at compose time, and `text` stays the record: the Verlauf, the
   * Rapport and the audit chain all read that one string, and a row whose meaning lived in a
   * side field would say something different in the app than on the paper. This exists so the
   * journal can later be FILTERED by it, not so a second copy of the sentence can drift.
   *
   * There is deliberately no «who said it» field: the sentence answers that, and the names in
   * it are linked (lib/journalLinks). A second field asking the same thing was dropped 09.08.
   */
  entryType?: JournalEntryType
  /** Written by the SERVER on rows that arrived through an Atemschutz-Link session (the QR a
   *  non-FU scans to operate only the Überwachung of this Einsatz — see lib/viewLink), or
   *  through the standing fixe Atemschutz-URL (`atemschutz-fix`, the laminated QR). The
   *  Verlauf prints both as the same small footnote beside the row, so «wer hat das
   *  eingetragen» has an answer on a board that deliberately asks nobody for a name. `capture`
   *  marks the Erfassungs-Poster's rows (22.10.2026; no footnote — it is what lets the server
   *  keep the poster's corrections to its own rows). Absent on everything else, and never set
   *  by this client: the app cannot vouch for its own provenance. */
  via?: 'atemschutz-link' | 'atemschutz-fix' | 'capture'
}

/** `'info'` · `'auftrag'` (Befehlsgebung) · `'sofort'` (Sofortmassnahme). See TimelineEvent. */
export type JournalEntryType = 'info' | 'auftrag' | 'sofort'

export interface Incident {
  type: string
  title: string
  address: string
  center: LngLat
  startedAt: string
  durationSec: number
  offline: boolean
  cachedTiles: number
  recording: boolean
  recDurationSec: number
}

export interface PlanDocument {
  id: string
  /** Stable key for station-level data that belongs to THIS object's sheet. `id` is only the
   *  module slot (`modul1`, `modul2`, …) and is reused by every Einsatzobjekt, so using it for
   *  a georeference makes the last opened building overwrite every other one. Absent on generic
   *  surfaces and legacy/bundled documents, where callers fall back to `id`. */
  georefKey?: string
  code: string           // short label, e.g. "Module 1"
  title: string          // descriptive title, e.g. "Übersicht"
  subtitle: string       // one-line description
  imageUrl: string       // image asset under public/ — empty string = blank sheet
  orientation: 'portrait' | 'landscape'
  icon?: string          // sidebar icon (defaults to 'doc')
  /** when set, the board background is live OSM building outlines for this area
   *  (a square bbox of ±radiusM around center) instead of a PDF/blank sheet */
  osm?: { center: LngLat; radiusM: number }
  /** the generated "Gebäude" document: a vertical stack of floor sheets traced
   *  from a selected OSM footprint (see BuildingDoc) — a stand-in for Modul 6 */
  floorStack?: boolean
  /** viewer-only: render the PDF as a plain viewer (pan/zoom) with NO drawing tools or
   *  annotation surface — e.g. PV / documentation sheets that are read, not marked up */
  viewer?: boolean
  /** the sheet's aspect (width / height) as MEASURED on the exact pinned PDF revision this
   *  document shows — carried by an incident's plan binding (server-approved alignment). It
   *  outranks any station calibration aspect: the binding may pin an older revision than the
   *  one the station later calibrated (lib/georefTwins · planAspect). */
  georefAspect?: number
}

/** A selected building (or group of connected buildings) promoted into the
 *  floor-stack ("pseudo Modul 6"). `floors` are the storey indices present
 *  (0 = EG, +1 = OG1, −1 = UG1).
 *
 *  `rings` (when present) holds one or more footprints, each re-normalized 0..1 to
 *  the COMBINED bounding box of all selected footprints, so their relative
 *  positions and sizes are preserved when several houses are transferred together.
 *  `ring` mirrors `rings[0]` and `ringAspect` = combined height/width — both kept
 *  for backward compatibility with single-building workspaces saved before
 *  multi-select existed. Renderers prefer `rings`, falling back to `[ring]`. */
/** Where a building's isotropic `src` box sits on the ground: the WGS84 position of its (0,0)
 *  corner — north-west, since `src` y runs down/south — and the ground length of one `src` unit.
 *
 *  This is what makes a saved footprint PLACEABLE. Without it a `BuildingDoc` is a rectangle with
 *  no address: the picker cannot show you which outlines you already have, and
 *  `lib/buildingTransfer` has nothing to anchor the old tile frame to when the building changes. */
export interface SrcGeoref {
  /** WGS84 [lng, lat] of the src box's (0,0) corner */
  origin: LngLat
  /** ground metres spanned by one src unit */
  spanM: number
}

export interface BuildingDoc {
  ring: [number, number][]
  ringAspect: number
  floors: number[]
  /** operator/station names by floor index (`'0': 'EG / ZWG'`); absent = the standard name
   *  (lib/whiteboard · floorLabel). Seeded from the object's floor pack when the stack is created
   *  (14.09.2026); the signed index stays in every heading regardless. */
  floorNames?: Record<string, string>
  /** the stack IS the object's floor pack (decided 14.09.2026, Bastian: «where we have the modules
   *  we don't need the borders»): every storey tile shows its PDF page, whole, no footprint outline,
   *  and the tiles' ground position comes from the pack's ONE map fit (lib/stackFit) rather than a
   *  picked footprint. `ring`/`rings` are empty, `ringAspect` is the page's h/w so the tile box is
   *  page-shaped. Seeded automatically when the incident's binding carries floors; a footprint
   *  stack (the older way) is what you get without a pack. */
  pack?: {
    /** Exact incident-frozen plan binding; changing the selected object never retargets this stack. */
    bindingId?: string
    /** the fitted page's width / height */
    aspect: number
    /** the reference drawing's rectangle on its page, normalized [x0, y0, x1, y1] – the FRAME every
     *  tile shows and every other floor's drawing is shifted into through its anchor; absent =
     *  the whole page (one floor per page) */
    frame?: [number, number, number, number]
  }
  rings?: [number, number][][]
  /** the footprint(s) in ISOTROPIC 0..1 board space (true proportions) — the source the
   *  Gebäudeview rotates. Present on buildings picked since auto-orientation shipped;
   *  absent on older docs (which then render north-up only). See lib/footprint. */
  src?: [number, number][][]
  /** auto-computed rotation (deg) that puts the longest axis horizontal; 0 = north-up
   *  / square. Constant for the building — the toggle flips the active view, not this. */
  orientDeg?: number
  /** active view: true = "Norden oben" (unrotated), false/absent = oriented (default).
   *  `rings`/`ring`/`ringAspect` always mirror the ACTIVE view for back-compat renderers. */
  northUp?: boolean
  /** active view angle in degrees when the operator has DIALLED a custom rotation (A8, 29.08.).
   *  Absent = the binary behaviour above (`northUp ? 0 : orientDeg`) — resolve through
   *  lib/footprint · activeViewDeg, never by hand. Writers keep `northUp` in sync
   *  (viewDeg === 0 ⇔ northUp) and the ring mirrors on the active view, so documents read by
   *  pre-dial clients still render a coherent (if binary-angled) picture. */
  viewDeg?: number
  /** the storey band's height as a fraction of the board width — the CARD around one Geschoss.
   *
   *  Derived from the drawing's own aspect when the stack is created, and again whenever the
   *  building is turned (lib/footprint · bandAspect), so a flat hall gets a flat card instead of
   *  spending two thirds of every storey on air.
   *
   *  ⚠️ ABSENT means the historical 0.72 (lib/whiteboard · TILE_AR) and must stay that way for
   *  every stack created before 16.09.2026: annotation coordinates are relative to the box CENTRED
   *  in the band, so a band that changed under existing ink would move the ink with it. Resolve
   *  through `tileAspectOf`, never by hand. */
  tileAR?: number
  /** where this footprint sits on the ground, recorded at pick time from the picker's own square
   *  metre-bbox (lib/buildingTransfer · georefFromPick).
   *
   *  ⚠️ OPTIONAL ON PURPOSE and permanently so: every building picked before this field existed
   *  carries none, and the workspace blob is synced and never rewritten wholesale. Nothing may
   *  throw or misrender without it — it only ENABLES the two things that need a ground position
   *  (pre-selecting the current outlines in the picker, and carrying floor-stack annotations
   *  across a building change). Without it both fall back to the old behaviour, which says so. */
  geo?: SrcGeoref
}

export type PreparedMapOverlay =
  | {
      id: string
      kind: 'circle'
      layer: LayerId
      center: LngLat
      radiusM: number
      color: string
      fillOpacity?: number
      lineOpacity?: number
      lineWidth?: number
      lineDasharray?: number[]
    }
  | {
      id: string
      kind: 'line'
      layer: LayerId
      coords: LngLat[]
      color: string
      width?: number
      dasharray?: number[]
    }
  /** filled outlines — «Karte & Objekte» draws the station's buildings with it (one overlay, many
   *  rings, so dozens of objects stay ONE source) */
  | {
      id: string
      kind: 'polygons'
      layer: LayerId
      rings: LngLat[][]
      color: string
      fillOpacity?: number
      lineWidth?: number
      lineOpacity?: number
      /** mount transparent and let MapLibre's paint transition carry the pair to its opacity
       *  (MapLayers · FilledOverlay) — «Karte & Objekte»'s outlines, which answer a viewport
       *  fetch well after the map stands */
      fadeIn?: boolean
      lineDasharray?: number[]
      /** paint the inside with the Schraffur tile of `color` (lib/draw · hatchImageId) instead of a
       *  flat fill — the viewer hatches map area this device holds no base map for */
      hatch?: boolean
      /** drawn only from this map zoom on (the region's underground buildings: street zoom) */
      minzoom?: number
    }

/** Whiteboard annotation. All positions are normalized 0..1 in plan-image space,
 *  so they stick to the plan across zoom/pan. */
/** The Lage map's tool ids (copy · mapTools, hotkeys · ToolCmd) – the map's counterpart of
 *  BoardTool. `select` is the Lage's Auswahl, `lasso` its Mehrfach; `shape` is armed from the
 *  palette, not the rail. */
export type MapTool = 'select' | 'lasso' | 'symbol' | 'shape' | 'line' | 'area' | 'circle' | 'note' | 'team' | 'measure'
export type BoardTool = 'pan' | 'lasso' | 'draw' | 'line' | 'area' | 'circle' | 'text' | 'symbol' | 'shape' | 'resource' | 'scale' | 'measure'
/** `form` (10.10.2026): a Tafel PAGE — a board-template page with what was written on it (lib/boardForm).
 *  Sheet-wide, no position, no map body; everything positional ignores it by having no x/y/pts. */
export type BoardKind = 'draw' | 'area' | 'circle' | 'text' | 'symbol' | 'shape' | 'resource' | 'form'
/** Plan point. The optional storey is backward compatible: legacy points inherit BoardAnno.floor. */
export type BoardPoint = [x: number, y: number] | [x: number, y: number, floor: number]
export interface BoardAnno extends SymbolProps {
  // `symbol`, `label`, `subtitle`, `fields`, `notes`, `count`, `rotation`, `color`
  // are inherited from SymbolProps — a Plan symbol now carries the same attribute
  // set as a Map Entity. (`color` doubles as the draw/resource accent + trail colour.)
  id: string
  kind: BoardKind
  pts?: BoardPoint[]         // draw/area vertices; magnetic lines may span floors per point
  x?: number                 // text / symbol / shape / resource: anchor
  y?: number
  text?: string              // text label / resource name
  /** kind 'text': box width as a fraction of the plan width (0..1) — the plan-space analogue
   *  of `Entity.noteW`. Same unit as `sizeN`, so the box keeps its proportions across zoom and
   *  prints 1:1. ABSENT = the legacy auto-width one-liner (no wrapping, no width grip); its
   *  presence is what makes a note a text box. See `NOTE_W` in lib/notes for the clamps. */
  wN?: number
  // --- kind 'shape' (Pfeil / Rauch / Rechteck — the plan mirror of Entity kind 'shape') ---
  shape?: ShapeKind
  /** shape WIDTH as a fraction of the plan width (0..1) — the plan-space analogue of Entity.sizeM.
   *  The box height is sizeN × aspect (of the same plan width, so a square stays square). */
  sizeN?: number
  /** height/width ratio of the shape's box — the plan-space twin of `Entity.aspect`.
   *  Absent = 1; only free-aspect kinds stretch (lib/shapes · SHAPE_FREE_ASPECT). */
  aspect?: number
  /** arrow shape only: the «→|» Stopp-Balken across the tip (twin of `Entity.stop`). */
  stop?: boolean
  /** Rotation only: which vehicle runs the shuttle (lib/shapes · RotationCarrier) */
  carrier?: 'heli' | 'tlf'
  /** Rotation only: reversed circulation — the shape twin of `Entity.reverse` */
  reverse?: boolean
  /** shape outline weight — the plan-space twin of `Entity.strokeW` (lib/shapes) */
  strokeW?: number
  /** aerial-appliance boom reach as a fraction of the plan width (0..1) — the plan-space analogue of
   *  Entity.reachM (the Hubretter cage distance from the truck; bearing = `rotation2`). */
  reachN?: number
  /** kind 'circle' (Absperrkreis / Gefahrenradius): radius as a fraction of the plan WIDTH —
   *  the plan-space twin of `Drawing.radiusM`, in the same unit as `sizeN`. The centre is x/y,
   *  so a circle is a POINT object with an extent, not a polyline (it has no `pts`). Real metres
   *  come from the sheet's Maßstab (lib/planScale · circleRadiusM); uncalibrated it is simply a
   *  share of the sheet, which is all an uncalibrated Kroki can honestly say. */
  radiusN?: number
  width?: number             // draw stroke width
  dashed?: boolean           // draw: render dashed instead of solid (mirrors Drawing.dashed). Absent = solid.
  arrow?: boolean            // draw: an arrowhead at the last vertex (Messpfeil / Rettungsachse line presets)
  arrowStop?: boolean        // draw: the Entwicklungsgrenze bar across the arrowhead (Drawing.arrowStop)
  marker?: string            // draw: a letter repeated along the line (e.g. 'R' for Rettungsachse)
  // ⚠️ NO LONGER inert on a plan (the comment here said it was): once the sheet is calibrated
  // against its printed Maßstab, a line prints its Länge and an area its Fläche, exactly as the
  // Lage does — uncalibrated, the read-out is the «zuerst kalibrieren» nudge instead.
  showDistance?: boolean     // draw/area: print the measured length / area beside the ink
  labelDx?: number           // draw: per-line screen-space nudge of the label off the ink (parity w/ map)
  labelDy?: number
  // FKS hose-line annotations (draw/line only) — mirror Drawing's fields for cross-surface parity
  teilstueck?: boolean       // forward "E"-fork coupling at the line end (instead of an arrowhead)
  content?: LineContent
  lineNo?: number            // Druckleitung number in a small box on the line (= Leitung identity, see Drawing)
  floorTag?: number          // storey the line works on, signed badge (+2 / 0 / -1)
  hose?: HoseSize            // draw: hose diameter (mirrors Drawing.hose)
  /** draw: the Wassertransport assumptions (mirrors Drawing.relay). A sheet only CARRIES them —
   *  the calculation needs real ground and a height profile, so it is offered on the Karte. */
  relay?: RelaySettings
  endDx?: number             // draw: the FKS end tag's old nudge – no longer drawn, the tag is pinned to its line (28.10.2026)
  endDy?: number
  fillOpacity?: number       // area: polygon fill opacity (0..1); absent = a sensible default
  hatch?: boolean            // area: schraffiert statt gefüllt (lib/draw · Schraffur)
  /** shape twin of `Entity.sharpCorners` — a Rechteck with square corners */
  sharpCorners?: boolean
  t?: string                 // resource: HH:MM of last move
  trail?: TrailPoint[]       // resource: breadcrumb history, oldest → newest
  // resource: the linked Atemschutz Trupp this chip REPRESENTS (position tracking).
  // draw/line: the Atemschutz link ANCHOR — the Trupp this hose was picked for (mirrors
  // Trupp.lineId). Two meanings, one field, told apart by `kind`; both say "belongs to that Trupp".
  truppId?: string
  /** floor-stack only: which storey TILE this anno belongs to (0 = EG). x/y (and
   *  pts/trail) are then normalized 0..1 WITHIN that tile, so floors stay
   *  independent when storeys are added/removed. Absent = floor 0. NOTE: this is a
   *  tile INDEX, distinct from Entity.floor's signed badge value (see SymbolProps). */
  floor?: number
  /** The signed STOREY BADGE on a plan symbol (+2 / 0 / -1) — the plan-space twin of
   *  `Entity.floor`, which is why it cannot simply BE `floor`: that name is already taken
   *  here by the floor-stack tile index above. Wired on the plain Modul boards only; on the
   *  Gebäude floor-stack the tile the symbol sits on already says which storey it is on, so
   *  a second answer there would be one that can disagree with itself. */
  storey?: number
  /** locked: the anno ignores tap-select / drag so it can't be moved by accident or swallow
   *  taps meant for things over it (a big Sektor-Fläche under the work on Modul 1). A lock chip
   *  on it unlocks it with a short hold. Absent = editable. The plan-space twin of
   *  `Drawing.locked` — same field name, same meaning, so a Leitung behaves the same on both
   *  surfaces. ⚠️ NOT `tacticalLocked`, which locks the whole surface for a viewer.
   *  Draw/area/shape only, exactly like the map (a symbol is never locked on either surface). */
  locked?: boolean
  /** Gebäude floor plan («Grundriss») role of a line drawn with the Wand preset of the Linie.
   *  Still an ordinary Linie – the role only says the anno is LAYOUT, not Einsatz state: the Wand
   *  tool stays armed, snaps, carries its Durchgänge (`onWall`) and is what «Kopieren nach …»
   *  copies to another storey. Absent = Einsatz ink. (Weg and Raum were dropped on 27.10.2026:
   *  a route is a plain Linie, a room is drawn with Wände.) */
  role?: 'wand'
  /** symbol only: the id of the Wand line this Durchgang sits on. The symbol was snapped and
   *  turned onto that line and moves with it; absent = it stands free. */
  onWall?: string
  /** Magnetic relationship intent at the first/last vertex (draw/line only). */
  startAttachment?: LineAttachment
  endAttachment?: LineAttachment
  /** kind 'form' only: the Tafel page (lib/boardForm). The whole page is ONE object, so a commit
   *  is one undo step and rides the board's own sync like any other anno. */
  form?: BoardFormData
}
/** One past position of a team on a plan, in normalized 0..1 plan space. */
/** a recorded breadcrumb. `floor` = the storey the team was on at time `t` (floor-stack
 *  only), so the position history spans floors — a team that walked up was a floor below
 *  a minute ago. Absent = the anno's current floor (legacy points). */
export interface TrailPoint { x: number; y: number; t: string; floor?: number }
/** Per-document annotation store, keyed by PlanDocument id. */
export type BoardDoc = Record<string, BoardAnno[]>

export interface SymbolMeta { cat: string; name: string; svg: string }
export interface SymbolLibrary { order: string[]; symbols: SymbolMeta[] }

/** Atemschutzüberwachung: one breathing-apparatus team (Trupp) under live monitoring.
 *  Swiss FKS/CSSP model — the digital Atemschutz-Überwachungstafel tracks TIME SINCE LAST
 *  FUNKKONTAKT as the primary safety signal; each contact resets the timer, and no contact
 *  within the interval escalates to `ueberfaellig`. Cylinder pressure is logged at each
 *  contact (last + lowest) as a record, with Rückzug/Mindest shown as static reminders — it
 *  is NOT extrapolated into a countdown. Status: angemeldet → aktiv → rueckzug → ueberfaellig
 *  (contact overdue), or `raus` once the team is out. */
/**
 * What KIND of Trupp this is — the one discriminator on the Tafel.
 *
 * ⚠️ ABSENT means `atemschutz`, and that is load-bearing rather than a convenience default: every
 * Trupp recorded before 2026-09-03 went in under PA, an Einsatz is a legal record, and a stored
 * object may never change meaning because the app learned a new word. So the field is only ever
 * WRITTEN for the new kind, and every reader resolves it through `isAtemschutzTrupp`
 * (lib/atemschutz) rather than testing the raw field.
 *
 * A literal union, not a boolean: it names both states in the blob a human (and the backend's
 * push sweep, which reads the raw JSON) will read, it narrows in TypeScript, and it has room for
 * a third kind. A `withoutPa?: boolean` would have said the interesting case as a negation.
 *
 * `einfach` = a plain work squad: Verkehr, Sanität, Wasser. Same crew, Auftrag, Leitung, Funkkanal,
 * colour and placement as any other Trupp — but no cylinder, no contact clock, no Alarmdruck, and
 * never on the Atemschutz page of the Rapport. See AtemschutzView for the board's two sections.
 */
export type TruppKind = 'atemschutz' | 'einfach'

/**
 * What a Trupp was sent to do — the TYPE, offered as a short list of tiles; the order itself
 * goes in `ziel`. There are two lists, one per `TruppKind` (config · atemschutz.auftrag /
 * atemschutzEinfach), because a Verkehrstrupp being offered «Löschen» is the wrong vocabulary
 * on a card that is read at a glance.
 *
 * ⚠️ `sichern` and `anderes` are DELIBERATELY shared between the two lists: they mean the same
 * thing for both kinds, so the stored value keeps meaning what it meant and a Trupp whose kind
 * was mis-picked keeps a valid Auftrag. Everything else belongs to exactly one list — but the
 * union is flat and NOT narrowed per kind: an incident is a legal record, and a Trupp created
 * before 03.09. (or under the other kind) still carries whatever id it was given. Every reader
 * resolves the label through `truppAuftragLabel`, which searches BOTH lists.
 */
export type AtemschutzAuftrag = 'retten' | 'loeschen' | 'absuchen' | 'sichern' | 'erkunden' | 'anderes'
export type EinfachAuftrag = 'verkehr' | 'sanitaet' | 'wasser' | 'sichern' | 'bereitstellung' | 'anderes'
export type TruppAuftrag = AtemschutzAuftrag | EinfachAuftrag

/** the editable descriptive fields of a Trupp, shared by the create / edit / re-deploy form */
/** `color: null` from the form means «zurück auf automatisch» — distinct from `undefined`, which
 *  is «this form doesn't carry a colour». See Trupp.color.
 *  `kind` rides along on every path (04.09.): it is answered when the Trupp is created, corrected
 *  while it is being edited, and asked again for each re-deployment — a crew that fought the fire
 *  under PA goes back in to clear up without it. `editTrupp` and `reactivateTrupp` each own what
 *  that change writes, because it starts or stops a safety watch (see Trupp.kind). */
export type TruppFields = { name: string; members?: string[]; auftrag?: Trupp['auftrag']; ziel?: string; lineNo?: number; funkkanal?: number; pressure: number; leaderPersonId?: string; memberPersonIds?: string[]; color?: string | null; kind?: TruppKind; equipment?: string[]
  /** the Eingangsdruck was set ON PURPOSE in the form (dialled, typed, a bottle answer, a low value
   *  confirmed) — its log row is marked `measured`, so the first Druckmeldung never «corrects» it
   *  (lib/atemschutz · entryPressureConfirmed). Absent = the untouched default. */
  pressureMeasured?: boolean }

/**
 * One Beilage to the Einsatzrapport — a photo that belongs to the REPORT rather than to the
 * running picture: an ID document, a damage close-up, a handed-over form.
 *
 * Deliberately its own collection, not a Verlauf row with a flag. A Verlauf row is a timed
 * observation in an append-only record of what happened; «Ausweis Herr Meier» is neither, and
 * putting it there would both bury it among the tactical lines and force a document photo into
 * the legal chronology. It also prints differently: journal photos ride small beside their text,
 * a Beilage prints large enough to READ, which is the entire point of photographing a document.
 *
 * Stored like every other incident medium (the media store, the same upload path as a journal
 * photo): it syncs to the devices on this Einsatz and goes with the incident.
 */
export interface ReportAttachment {
  id: string
  /** server-relative media URL (/api/media/<id>). A blob: URL means the upload is still running
   *  — the Rapport preflight already warns about media that has not landed yet. */
  url: string
  /** what this shows, printed under the image («Ausweis Lenker», «Schaden Nordfassade») */
  caption?: string
  /** when it was added (ISO) — printed with the caption, so a set of photos has an order */
  at: string
}

/** One entry in a Trupp's contact/pressure log. `registered` = angemeldet (the cylinder read at
 *  the Tafel, before anyone goes anywhere), `entry` = eingerückt (or re-deployed), `contact`
 *  = a radio check (pressure unchanged, carries the current reading), `pressure` = a new reading. */
export interface TruppReading {
  t: string
  bar: number
  /**
   * What this row of the per-Trupp log IS.
   *
   * ⚠️ `alarm` and `rueckzug` are the two moments the printed Atemschutz-Journal is actually read
   * for — when the Trupp hit its Alarmdruck, and when it was ordered back — and neither used to
   * be distinguishable on it. The Alarmdruck reading printed as an ordinary «Druck» among a
   * column of them, and a Rückzug was written down as a plain «Kontakt», which it also is (it
   * resets the safety clock) but is not ONLY. Both are recorded as their own kind, so the sheet
   * can say so without the reader reconstructing it from the numbers.
   *
   * ⚠️ `exit` and `resume` complete the CHRONOLOGY (19.08.). The Austritt lived only in the
   * sheet's header, so the log simply stopped mid-Einsatz, and a Wiedereinstieg after a Rückzug
   * was written down as a plain `contact` — true (the Trupp was reached) but not the whole
   * truth, and the one row saying the crew went back IN was indistinguishable from a radio
   * check. The safety clock is unchanged: a `resume` resets it exactly like a Kontakt.
   *
   * ⚠️ `paOn` / `paOff` are the two ends of the MONITORED stretch (04.09.). A Trupp's Art can be
   * changed after the fact — a work squad that ends up going in under PA, or one registered under
   * Atemschutz by mistake (useTruppActions · editTrupp) — and the moment the Überwachung starts or
   * stops is the one thing about that change a safety document has to be able to say. `paOn`
   * carries the Eingangsdruck of the cylinder that was just opened; `paOff` carries the last value
   * known, like a `contact` does. Neither opens or closes a DEPLOYMENT: the Eintritt/Austritt pair
   * stays `entry`/`exit` (lib/report · truppRunTimes), because the crew's Einsatzzeit is unbroken
   * by putting a mask on.
   *
   * ⚠️ `notfall` / `notfallEnde` are the two ends of an Atemschutznotfall (F1, 08.10.2026 —
   * see Trupp.notfallAt). They carry the last KNOWN bar like a `contact` does, never a reading:
   * nobody read a gauge for them. In the Trupp's own log so the Atemschutz page of the Rapport
   * shows the emergency where the crew's record is read, not only in the Einsatzjournal.
   *
   * Rows written before these kinds existed keep theirs — the log is append-only.
   */
  kind: 'registered' | 'entry' | 'contact' | 'pressure' | 'alarm' | 'rueckzug' | 'exit' | 'resume' | 'paOn' | 'paOff' | 'crew' | 'notfall' | 'notfallEnde'
  /**
   * WHO the Trupp was at this moment — written by a `crew` row only (12.09., docs/trupp-naming.md).
   *
   * The card's `name`/`members` are the CURRENT crew, and until this row existed that was the
   * only crew the record knew: a leader change or a transfer mid-Einsatz survived as free text in
   * the Verlauf and nowhere the Rapport could read. Registration writes the first one, and every
   * crew edit, leader change, transfer (both Trupps) and re-entry writes another — so the
   * Atemschutz page can say who went in on EACH cycle (lib/report · truppCrewHistory). `bar`
   * rides along as the last value known, like a `contact` row, and is never printed as measured.
   */
  crew?: { name: string; members: string[] }
  /**
   * The bar on THIS row was read off a gauge, although its kind normally only carries the last
   * known value forward (lib/report · readingBarIsMeasured). Written by one row only: an `exit`
   * whose Restdruck was asked at «Raus melden» (24.09.2026). Übung 23.09. showed why: with no
   * place for the pressure at the exit, the Überwacher typed it into «Eingangsdruck korrigieren»
   * three times and the Rapport printed entries of 60, 170 and 180 bar. Absent everywhere else.
   */
  measured?: true
}

export interface Trupp {
  id: string
  /**
   * Atemschutz or a plain work squad — see `TruppKind`. ABSENT = `atemschutz`, so no existing
   * record changes meaning and nothing has to be migrated.
   *
   * ⚠️ CHANGEABLE, and every change is written down (04.09. — it used to be fixed at creation, so
   * a wrong pick meant deleting the Trupp and registering it anew, throwing away the record of a
   * crew that had already been working). What made it look fixed is real and is what the writers
   * have to protect: a PA Trupp carries an Eingangsdruck, a contact clock, a Druckverlauf and
   * possibly a recorded Alarmdruck-Überschreitung, and none of that may quietly disappear from
   * the Atemschutz page of the Rapport — nor may the other direction assert a cylinder and a
   * Funkkontakt-Intervall nobody watched. So the flip is owned by two places, and only those:
   *   · `editTrupp` (useTruppActions · kindPatch) corrects the Art of the RUNNING deployment.
   *     Everything measured stays; a `paOn`/`paOff` row marks where the watched stretch begins
   *     or ends, and hochstufen stamps the contact clock NOW rather than at the Eintritt.
   *   · `reactivateTrupp` answers it afresh for the NEXT deployment («Wieder einrücken»), where
   *     the run boundary is the new entry row itself and no paOn/paOff is needed.
   */
  kind?: TruppKind
  /** Taken off the Tafel (ISO), rather than removed from the record.
   *
   * ⚠️ A Trupp that was ever registered is part of what happened, and the Atemschutz page of the
   * Rapport is a safety document: a crew that went in under PA and was then deleted from the board
   * used to leave no trace on paper at all. So the delete stamps this and everything LIVE filters
   * it out (IncidentWorkspace derives the board list once, at the source, so nothing downstream —
   * alarms, markers, roster locks — can keep seeing it); the Rapport reads the unfiltered slice.
   * Cleared again by the delete's own «Rückgängig». */
  removedAt?: string
  /**
   * Whom of this crew the Anwesenheit has already been told about — the crew filing's one-shot
   * marker (lib/crewFiling). One key per person: the roster id, or the derived Gast id
   * `g-<truppId>-<hash>`. Sorted, grow-only, and MERGED AS A UNION (mergeWorkspace · mergeTrupp).
   *
   * ⚠️ Without it the filing was a reconciliation that wrote a deliberate deletion straight back:
   * somebody takes a crew member off the Anwesenheit, and the next device that observes the Trupp
   * files them again (the ghost-trail trap, docs/atemschutz-board.md · «The record is kept whole»). A key here means «filed once, or already
   * there when the Trupp was seen» — whatever happens to that entry afterwards is a person's
   * decision, and no device undoes it. A machine field: undo restores keep it (useTruppActions ·
   * remember / restoreTrupp), and a merge that differs only here is not a Trupp conflict.
   */
  crewFiled?: string[]
  /**
   * The Trupp's own number — «Trupp 3» — handed out at registration from ONE counter per Einsatz
   * that unlinked plan chips and map markers («Trupp N», lib/placedTrupps · nextTeamName) draw
   * from too, so two things on the same incident are never both called Trupp 1. Never reused.
   * Changed ONLY by the merge, when two devices minted the same number at once (lib/truppNumbers,
   * 25.09.2026 — one keeps it, the other takes the next, and the Verlauf says so); nothing else
   * ever writes it after registration. Absent only on a record written before 12.09.; the load normaliser numbers
   * those by registration time (lib/workspace · numberTrupps) and the next write persists it.
   * Documentation, not identity: people call a Trupp by its Gruppenführer, so the leader stays
   * the face of the card and the marker, and this is the small badge beside it.
   */
  no?: number
  /**
   * The numbers this Trupp carried BEFORE a merge gave its number to another device's Trupp,
   * oldest first (lib/truppNumbers · resolveTruppNumbers, 25.09.2026). Written by the resolver
   * alone, deterministically, so every device computes the same list. The Rapport's heading reads
   * «Trupp 3 (zuerst Trupp 1)» from it, because the rows written before the change still say
   * «Trupp 1»; the Verlauf marks those rows' «Trupp 1» as THIS Trupp (journalLinks · subjectId).
   * Absent on every Trupp that was never renumbered.
   */
  formerNos?: number[]
  /** group leader's name = the Trupp title (also the linked plan chip's label) */
  name: string
  /** other team members (for the board card; the chip shows only the leader) */
  members?: string[]
  /** the Trupp's order type, from the list matching its `kind`; the actual order + location
   *  goes in `ziel`. See TruppAuftrag — the two lists overlap on purpose. */
  auftrag?: TruppAuftrag
  /** the actual order + location in plain words ("2. OG Wohnung links, Person vermisst").
   *  Required when `auftrag === 'anderes'` (carries the custom order). */
  ziel?: string
  /** the Leitung this Trupp works on — the SAME 1–99 number the DrawEditor stamps on a hose
   *  (`Drawing.lineNo` / `BoardAnno.lineNo`), which is what joins the two: one number, one
   *  Leitung, on whichever surface it is drawn. */
  lineNo?: number
  /** the drawing explicitly picked for this Trupp (mirrors `Drawing.truppId`). The ANCHOR; the
   *  number above is the identity. Either one alone renders the tag — see lib/truppLines. */
  lineId?: string
  /** @deprecated legacy free-text designation ("1", "Ltg 2", "Res"), replaced 2026-08-05 by the
   *  numeric `lineNo` so it matches what is drawn. Still READ (rendered on the card as typed, and
   *  parsed for the auto-match when it holds a plain number) but never written again — an incident
   *  is a legal record, so old Trupps keep the text their Überwacher typed. */
  lineNumber?: string
  /** Funkkanal the Trupp is on; seeded from the synced default (FKS-Standard: 11) */
  funkkanal?: number
  /** Ausrüstung the Trupp carries in — ids from the station's list (config · atemschutz.equipment,
   *  overridable as `doctrine.equipment`; labels resolve through lib/report · truppEquipmentLabels).
   *  Absent = nothing recorded. Written by useTruppActions · setTruppEquipment; synced like every
   *  other Trupp field (mergeWorkspace is field-wise per object). */
  equipment?: string[]
  /** Where this card sits when the board is ordered by hand (Reihenfolge · «Wie gesetzt»).
   *  SYNCED, not a device pref: two operators looking at the same board have to see the same
   *  board. Absent on older Trupps — they fall back to their position in the list, which is the
   *  creation order they were shown in before this existed. */
  order?: number
  /**
   * The Trupp's colour, wherever it is drawn: map marker, plan chip, its dot on the board.
   *
   * ABSENT = automatic, which is the normal case: the station's colour for this Auftrag if one is
   * configured (deploymentConfig · atemschutzAuftragColors), else the next palette colour nobody
   * else is wearing (lib/teamColors). A value here is a DELIBERATE pick — from the Trupp form or
   * from the placed symbol — and is used exactly as chosen, including when another Trupp already
   * wears it: «alle Löschtrupps rot» is a thing an EL is allowed to want. Colour still means
   * IDENTITY by default (ten Trupps, ten colours); this is the override, not a new scheme.
   */
  color?: string
  /** pressure (bar) at entry — the baseline shown until the first contact reading */
  entryPressureBar: number
  /** ISO timestamp the team entered the field (Einsatzzeit clock starts). Empty while `angemeldet`. */
  entryTime: string
  /** ISO timestamp of the last contact (Funkkontakt). Reset by the Kontakt button and by any
   *  pressure update; seeded to entryTime on Eingerückt. Empty while `angemeldet`. The contact
   *  clock (now − this) is the safety signal: overdue past the interval ⇒ überfällig alarm. */
  lastContactTime: string
  /** The contact clock was RESTARTED here by «Wieder öffnen», not by a Kontakt (lib/reopenClocks,
   *  D5): equal to `lastContactTime` while that restart is the last thing that moved the clock.
   *  What lets the alarm's «beendet» row name the reopen instead of claiming a Funkkontakt. */
  contactRestartedAt?: string
  /** …and when the Einsatz had been CLOSED before that reopen: `[pausedFrom, contactRestartedAt]`
   *  is time spent closed, which the pressure estimate does not count as breathing (staging r4:
   *  every crew inside read «Alarmdruck … laut Schätzung erreicht» right after the reopen). */
  pausedFrom?: string
  /** …and the contact time the restart REPLACED: an alarm opened on that contact was still running
   *  at the reopen (the restart ends it); one opened on an older contact had already been ended
   *  by this one (N4, staging 26.09.2026). */
  contactBeforeRestart?: string
  /**
   * Atemschutznotfall (F1, 08.10.2026): the moment somebody HELD «Notfall» on this Trupp — the
   * Notfall clock runs from here on every device. Absent = no emergency. Set by
   * useTruppActions · triggerNotfall, cleared by endNotfall (both hold-to-confirm, both on the ↶
   * timeline, both a Verlauf row and a `notfall`/`notfallEnde` reading).
   *
   * ⚠️ Independent of `status` on purpose: a Notfall is ended by a person saying so, never by a
   * side effect — a crew carried out and reported «raus» on an older build still shows its
   * Notfall until somebody holds «Notfall beendet». While set, the Trupp is tier 2 with reason
   * `notfall` (lib/atemschutz · truppAlarm), which outranks both other alarms everywhere.
   * Merged as the EARLIER stamp when two devices triggered it at once (mergeWorkspace).
   */
  notfallAt?: string
  /** last recorded cylinder pressure (bar) + when (ISO) — logged for the record, never predicted */
  lastPressureBar?: number
  lastPressureTime?: string
  /** lowest cylinder pressure seen so far (bar) */
  lowestBar?: number
  /** append-only contact/pressure log — the per-Trupp Verlauf shown (collapsed) on the card */
  readings?: TruppReading[]
  /** ISO timestamp the team came out (set on Raus) */
  exitTime?: string
  /** lifecycle phase. `angemeldet` = registered but not yet entered (no contact clock); manual
   *  transitions angemeldet → aktiv (eingerückt) → rueckzug → raus. `ueberfaellig` is the one
   *  auto-overlay, derived while in the field when contact runs past the interval.
   *  ⚠️ The backend's twin is `schemas · TruppStatus` (the push sweep reads it); lib/truppStatus.test
   *  holds the two equal. */
  status: 'angemeldet' | 'aktiv' | 'rueckzug' | 'ueberfaellig' | 'raus'
  /** linked plan resource chip — placed manually on the building plan (Gebäude floor-stack or
   *  Modul 6), NOT auto-created. Unset until the user presses "Platzieren". A Trupp is tracked
   *  at exactly ONE place: either a plan chip (annoId+planId) or a Lage-map marker (entityId) —
   *  placing on one surface removes it from the other. */
  annoId?: string
  /** which plan document the chip lives on (e.g. 'gebaeude' or 'modul6') */
  planId?: string
  /** linked Lage-map team marker (Entity kind 'team') — the map alternative to annoId/planId */
  entityId?: string
  /** optional structured roster refs (Mannschaft). `name`/`members` stay the display
   *  snapshots for back-compat + offline rendering; these link to Person ids when the
   *  name was picked from the roster (enables present-first ordering, never display). */
  leaderPersonId?: string
  memberPersonIds?: string[]
}

/** A canonical local brigade crew member. Provider identities attach optional sync provenance;
 *  manual and CSV-created personnel require none. Distinct from login users. */
export interface Person {
  id: string
  externalIdentities?: { provider: string; externalId: string; syncedAt: string }[]
  displayName: string
  firstName?: string
  lastName?: string
  /** Dienstgrad key referencing the per-station roster.ranks config (see src/lib/rank.ts);
   *  undefined = no rank. Imported from Divera/CSV; drives officer-first picker sort + filters. */
  rank?: string
  active: boolean
  /** Recorded on THIS Einsatz without being on the Mannschaftsliste — a guest, mutual aid, an
   *  AdF whose roster entry never synced. Derived at render time from an attendance entry with
   *  no roster row (see AnwesenheitView · guests); never stored on a Personnel record, because
   *  «was here tonight» is a statement about the Einsatz and not about the Wehr. */
  guest?: boolean
  updatedAt: string
}

/** One executed block of presence. `to` absent = still here. */
export interface PresenceInterval {
  from: string
  to?: string
}

/** Per-incident attendance: who is physically present. Keyed by Person id. `left` keeps
 *  the earlier presence (not deleted); the snapshot survives roster name edits / report. */
export interface AttendanceEntry {
  status: 'present' | 'left'
  /** DERIVED first arrival — the shape the rapport / statistics export / QR sheet read. */
  checkedInAt?: string
  /** DERIVED last departure; absent while the person came back. */
  leftAt?: string
  displayNameSnapshot: string
  /** free remark on this person for THIS incident («Fahrer TLF», «verletzt, abgelöst 21:40»).
   *  Printed with the row on the Personalblatt. Deliberately per incident, not on the roster:
   *  it describes what somebody did here, not who they are. */
  note?: string
  /** when that remark was last written (ISO).
   *  ⚠️ It exists for ONE question: who is the Einsatzleiter NOW. Nothing stops two people from
   *  carrying «Einsatzleiter» after a handover — the app warns and does not block — and without a
   *  time the answer fell out of a sort order, so the Verlauf, the journal's «EL» and the Rapport
   *  could each name a different one. Absent on entries written before this existed; those sort
   *  last, which is the safe end. */
  noteAt?: string
  /** Every executed block, oldest first — the truth (see lib/attendanceIntervals). Absent on an
   *  entry written before blocks existed, which projects its checkedInAt/leftAt pair instead. */
  intervals?: PresenceInterval[]
  /**
   * Where this person is RIGHT NOW: at the Einsatzort, or still at the Magazin.
   *
   * The question it answers is «wen könnte ich noch nachziehen», which is a question about this
   * minute and nothing else — so it is ONE state per person, not a second kind of presence block.
   * It is deliberately not history: a record of every walk between the Magazin and the scene
   * would be a lot of rows nobody ever reads, and the Verlauf already carries the changes.
   *
   * Absent on every entry written before 2026-08-09, and on anybody not present — those read as
   * `'scene'` (see lib/attendanceOrt · ortOf), because before this existed «anwesend» meant «here».
   */
  ort?: AttendanceOrt
  /**
   * WHERE this entry was last written — am Kommandoposten (the app) or am QR-Erfassungsbogen.
   *
   * ⚠️ It exists for ONE question and only that one: when two devices wrote the same person at
   * the same moment, the divergence row has to be able to NAME the two sides («vom
   * Kommandoposten» / «vom Erfassungsbogen») instead of offering a choice between «diese» and
   * «jene». Nothing else reads it and nothing derives from it — a presence, a time and the
   * Rapport are the same fact whoever typed them.
   *
   * Absent on every entry written before 04.09. and on anything an older client writes, so the
   * divergence names the two VALUES instead, which is always available.
   */
  source?: AttendanceSource
}

/** `'kp'` = am Kommandoposten (die App) · `'capture'` = am QR-Erfassungsbogen. */
export type AttendanceSource = 'kp' | 'capture'

/** `'scene'` = am Einsatzort · `'station'` = im Magazin. See AttendanceEntry.ort. */
export type AttendanceOrt = 'scene' | 'station'
export type AttendanceState = Record<string, AttendanceEntry>

/** One planned availability block of the Schichtenplanung (see lib/shifts). A PLAN — it never
 *  writes attendance; executing it is the ordinary Anwesenheit tick, which stamps the real time. */
export interface Shift {
  /** `newId('sh')` — `sh<ms>-<seq><rand>`, a prefixed timestamp that survives two
   *  tablets planning in the same millisecond (see lib/ids) */
  id: string
  personId: string
  /** ISO start of the planned availability */
  from: string
  /** ISO end */
  to: string
  /** agreed with the person (drawn solid) rather than still a proposal (drawn hollow). Tapping
   *  the bar flips it — the one thing about a shift that changes constantly while planning. */
  confirmed?: boolean
  /** the ShiftBand this shift was entered into (see the Schichten grid). ABSENT = freihändig: the
   *  shift was drawn on the Zeitplan axis and belongs to no column at all.
   *
   *  Membership is STORED, never derived from matching times. Nobody lands in a band because their
   *  clock happens to fit, and nobody drops out because somebody nudged the band by five minutes —
   *  which also means a shift whose times were since dragged away still shows in its column,
   *  hatched, carrying its real time. */
  bandId?: string
  note?: string
}

/** A named time window of the Schichtenplanung — one column of the Schichten grid («Früh 07–12»).
 *
 *  A band is INERT: creating one writes this single row and nothing else. It assigns nobody, reads
 *  no existing times and proposes nothing; every one of its cells starts empty, including for
 *  people who already hold exactly these hours freihändig. That is a sync argument as much as a UX
 *  one — if creating a band wrote shifts, two devices creating the same band would each produce a
 *  full set for 66 people, and mergeById would have to resolve duplicates of something that should
 *  never have existed. An inert row cannot collide. */
export interface ShiftBand {
  /** `newId('bd')` — `bd<ms>-<seq><rand>`, see lib/ids */
  id: string
  /** what the crew calls this watch — «Früh», «Nacht» */
  label: string
  /** ISO start of the window */
  from: string
  /** ISO end */
  to: string
}

/** One append-only Mittel (material-use) event: the running TOTAL used for a material+unit, from
 *  an optional source, at the moment it was saved. The current picture is derived as the latest
 *  event per `material + unit + source` key (see lib/mittel). `menge === 0` hides the line but
 *  keeps the history; events are never edited or removed (append-only doctrine). Custom,
 *  incident-local materials/sources carry no config id and key off their snapshot label. */
export type MittelStatus = 'zurueck' | 'vorOrt' | 'defekt'
export interface MittelEntry {
  id: string
  /** config catalogue id; undefined ⇒ custom / incident-local material */
  materialId?: string
  /** material label snapshot (survives a later catalogue rename) */
  label: string
  /** Stk / l / Sack / m / Flasche … */
  unit: string
  /** config source id; undefined ⇒ no source chosen */
  sourceId?: string
  /** source label snapshot */
  sourceLabel?: string
  /** current total used, integer ≥ 0 (0 = hidden but kept) */
  menge: number
  /** Retablierung state of the line (equipment only): back in, left on site, or defective.
   *  Undefined = im Einsatz / not yet accounted. Rides the same append-only events. */
  status?: MittelStatus
  /** free remark on this material line («2 Rollen an Werkhof übergeben», «Flasche defekt»).
   *  Carried on the event like `menge`, so the current picture takes the latest one and the
   *  history keeps what was written when. Printed with the line on the Rapport. */
  note?: string
  /** Nominal total stock of an incident-local line — what «noch N» counts down from. A
   *  catalogue material takes this from the deployment config; a hand-added one has nowhere
   *  else to get it, so it is carried on the event (latest wins, like `note`). */
  stock?: number
  /** Explicit removal of a line. `menge: 0` used to double as the tombstone, but a hand-added
   *  line now SURVIVES being stepped to zero (0 = nothing used, same as a catalogue row), so
   *  the removal needs to say so itself. Set once; the events stay, as always. */
  deleted?: boolean
  /** ISO timestamp the event was saved */
  at: string
  /** author display name snapshot, when known */
  by?: string
}
// A saved map view (camera bookmark): the full Lage camera — position, zoom and rotation —
// so the crew can flip between framings (e.g. a north-up overview and the map rotated to how
// they're physically standing in front of the Einsatzort) with a single tap. Synced per
// incident so the whole command team shares the same reference framings.
export interface CameraView {
  id: string
  name: string
  center: LngLat
  zoom: number
  bearing: number
}

/** Outcome of «Wieder öffnen» on an archived Einsatz. `cancelled` is the operator backing out
 *  of the confirm — nothing failed, so nothing should be offered again. */
export type ReactivateResult = 'ok' | 'cancelled' | 'failed'
