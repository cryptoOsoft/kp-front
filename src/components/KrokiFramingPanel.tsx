import { ShellLoader } from './ShellLoader'
import { Fragment, useEffect, useMemo, useRef, useState } from 'react'
import Map, { Layer, Marker, Source, type MapRef } from 'react-map-gl/maplibre'
import type { Map as MapLibreMap } from 'maplibre-gl'
import 'maplibre-gl/dist/maplibre-gl.css'
import '../lib/maplibreWorker'
import { Icon } from '../lib/icons'
import { cx } from '../lib/cx'
import { motionDuration, prefersReducedMotion } from '../lib/reducedMotion'
import { appConfig } from '../config/appConfig'
import { fillTemplate } from '../lib/format'
import { krokiFitMaxZoom, operationalExtentPoints } from '../lib/report'
import { circlePolygon } from '../lib/geo'
import { TacticalSymbol } from '../lib/symbolRender'
import { SHAPE_DEFS, SHAPE_MAX_PX, ShapeGlyph, shapeAspect } from '../lib/shapes'
import { EndTag, TeilstueckFork, hasLineDecor } from '../lib/lineDecor'
import { truppForLine, truppTagText } from '../lib/truppLines'
import { lerpPoint } from '../lib/lineStyle'
import { OnOff, Segmented } from './Segmented'
import { IconButton } from './Button'
import { Slider } from './Slider'
import { krokiEntity, krokiSymbolMul } from '../lib/krokiPayload'
import { drawnPumpEntities } from '../lib/linePumps'
import { forkBearing, pxPerM, shapePx, symPx, worldPx } from '../lib/mapView'
import { ensureHatchImage, ensureHatchImages, hatchImageColor } from '../lib/draw'
import {
  KROKI_DISC_MIN_PX, KROKI_DISC_R, discOffsetPx, krokiLabels, krokiScaleBar, numberKrokiLabels,
  placeKrokiLabels, type KrokiLegend,
} from '../lib/krokiLegend'
import type { CaptionMode, Drawing, Entity, LayerDef, LngLat, Trupp } from '../types'
import { krokiStandLabel, type KrokiView } from '../lib/report'
import { cartoRasterTiles, withCartoLabelsBaked } from '../lib/carto'

// WYSIWYG framing of the printed Kroki: the auto-fit (or the last chosen crop) is just the
// STARTING point — the operator pans/zooms and exactly this crop becomes the printed Kroki.
// The preview draws THE SHEET: the numbered discs and the legend the server prints, plus the
// three opaque plates it pastes on last (Massstabsbalken, Nordpfeil, Quellenangabe). It used to
// draw the words themselves, on a picture that has carried numbers since 09.08. — so the one
// screen whose job is «this is what comes out» showed a picture that never comes out, and hid
// the most consequential effect of a pan: a label whose disc leaves the frame drops off the
// sheet entirely. Preview-grade only in the glyphs; the server render stays the source of truth.
//
// A PANEL on the Rapport surface, not the modal it was until 2026-08-07. As a modal it opened
// on the press of PDF / Ausdrucken, which meant the crop was chosen blind right up to the
// moment paper was made — and put a dialog over a page that had just stopped being one itself.
// On the page the crop is simply visible while the rest of the rapport is filled in, and the
// framing on screen IS what prints: there is nothing left to confirm.

// The auto-fit's zoom ceiling is lib/report · krokiFitMaxZoom (20, or 21 for a compact Lage).
// ⚠️ A MapLibre CAMERA zoom — one level tighter than the server's 256-px projection; its mirror is
// backend/app/report · _kroki_fit_max_z, not fit_view's own default.
/** Breathing room around the fitted Lage, in preview px. 48 was ~2 cm of white on every side of
 *  an A4 sheet — enough street to orient by is a good thing, that much of it is not. */
const FIT_PAD = 28
const CARTO_FALLBACK_STYLE = 'rastertiles/voyager'
// the same default `buildKrokiPayload` sends, so the plate on the preview is the plate on paper
const DEFAULT_ATTRIBUTION = '© CARTO, © OpenStreetMap-Mitwirkende'
// backend/app/kroki.py renders print overlays against this reference viewport. Scaling the
// complete decorated marker (not only its glyph) makes badges/spreads/shapes WYSIWYG here.
//
// ⚠️ ONE reference, for BOTH page shapes. There used to be a second, narrower one for Hoch, on
// the reasoning that the server sizes a symbol in absolute pixels on a canvas whose width
// changes with the orientation. It does not: `render_kroki` is called without `ref_width` for
// either shape (app/report), so it uses its own 1050 both times and every rule is scaled by
// `u = width / 1050`. What the sheet fixes is therefore size ÷ canvas width — the same fraction
// upright as across — and dividing by 656 here inflated every scaled thing in Hoch by 1.6×.
// That is what made the portrait crop's tags and captions look wrong while the paper was right.
// ⚠️ The canvases themselves moved on 18.08. (2080×1222 / 1300×1820); this number did not have
// to follow, and that is the point of it — it is the reference the RULES are written against,
// not the size of the picture.
const PRINT_REF_WIDTH = 1050

/**
 * Unit normal of the last segment in SCREEN direction, pointing away from the line's own body —
 * the side kroki.py · _end_tag puts the tag on.
 *
 * ⚠️ The tag is opaque and used to sit ON the line here (72 % along the last segment, like the
 * Lage map, which is a live surface where the same box can be dragged aside). On the sheet that
 * hid the last quarter of the very Leitung it names, so the print pushes it clear — and a crop
 * that shows the old placement is a crop of a picture that no longer comes out. Same rule on
 * both sides now.
 *
 * Any zoom does for this: the normal is normalised and only its DIRECTION is used, and the
 * projection is conformal, so the screen direction is the same at every scale.
 */
function tagNormal(coords: LngLat[]): [number, number] {
  const n = coords.length
  const [ax, ay] = worldPx(coords[n - 2], 17)
  const [bx, by] = worldPx(coords[n - 1], 17)
  const len = Math.hypot(bx - ax, by - ay) || 1
  let [nx, ny] = [-(by - ay) / len, (bx - ax) / len]
  // the anchor is 72 % along the last segment; push away from the centre of the whole line, so a
  // hose that loops back is labelled on the outside of its bend rather than inside it
  const cx = coords.reduce((acc, c) => acc + worldPx(c, 17)[0], 0) / n
  const cy = coords.reduce((acc, c) => acc + worldPx(c, 17)[1], 0) / n
  const px = ax + (bx - ax) * 0.72, py = ay + (by - ay) * 0.72
  if (nx * (px - cx) + ny * (py - cy) < 0) [nx, ny] = [-nx, -ny]
  return [nx, ny]
}

export function KrokiFramingPanel({ scene, initial, atMs = null, atBusy = false, onAtChange, moments = [], startedAtMs = null, landscape = false, onLandscapeChange, trupps = [], captionMode = 'auto', onViewChange }: {
  scene: { entities: Entity[]; drawings: Drawing[]; layers: LayerDef[]; byName: Record<string, string>; center: LngLat }
  /** the crop this panel opens on — the last one chosen for this Einsatz, else auto-fit */
  initial: KrokiView | null
  /** the instant the printed Kroki shows; null = the live picture. The scene above is already
   *  the reconstructed one — this is only the control, so the choice sits on the screen that
   *  asks what the picture shows rather than behind a fold two levels away. */
  atMs?: number | null
  atBusy?: boolean
  onAtChange?: (ms: number | null) => void
  /** epoch-ms of every moment something actually happened (lib/replay · activityMoments) —
   *  drawn as hairlines on the Stand track so dragging is aimed rather than blind */
  moments?: number[]
  /** the Einsatz's start — the slider's left end; its right end is «jetzt» */
  startedAtMs?: number | null
  /** the page shape the Kroki prints on. The crop window IS the page here — WYSIWYG only holds
   *  if the preview has the sheet's proportions, so the choice lives on this screen. Owned by
   *  the surface: there is no «übernehmen» left for a local copy to be waiting for. */
  landscape?: boolean
  onLandscapeChange?: (landscape: boolean) => void
  /** monitored Trupps — the end tag names the one working a Leitung, like the print does */
  trupps?: Trupp[]
  /** the map's Beschriftungen setting, so the preview labels what the sheet will label */
  captionMode?: CaptionMode
  /** the crop as it stands, after every settled pan/zoom/resize. Reported continuously rather
   *  than on a confirm: what is on screen is what prints, so the surface must never be holding
   *  an older framing than the one the operator is looking at. */
  onViewChange?: (view: KrokiView) => void
}) {
  const P = appConfig.copy.preflight
  // read once per open: a ticking «now» would move the slider's right end under the finger
  const [nowMs] = useState(() => Date.now())
  /** where the thumb is WHILE dragging — the reconstruction waits for it to stop */
  const [dragMs, setDragMs] = useState<number | null>(null)
  const commitDrag = (ms: number) => {
    // the last notch IS the live picture: no reconstruction, and the caption stays «jetzt»
    onAtChange?.(ms >= nowMs - 30_000 ? null : ms)
    setDragMs(null)
  }
  const label = krokiStandLabel(dragMs ?? atMs)
  /** Where the ticks go, as percentages — one per recorded moment, exactly like the Verlauf's
   *  activity strip (Journal · stripTicks): where the ticks crowd is WHERE it was busy, and that
   *  density is the reading. The old 0.5 %-of-track rounding evened the crowding out, so the
   *  same Einsatz drew two different barcodes on the two strips. Only literal duplicates
   *  (several events on one timestamp) collapse — those are one place either way. */
  const markPcts = useMemo(() => {
    if (startedAtMs == null) return []
    const span = nowMs - startedAtMs
    if (span <= 0) return []
    const seen = new Set<number>()
    for (const t of moments) {
      if (t >= startedAtMs && t <= nowMs) seen.add(t)
    }
    return [...seen].sort((a, b) => a - b).map((t) => ((t - startedAtMs) / span) * 100)
  }, [moments, startedAtMs, nowMs])
  const mapRef = useRef<MapRef>(null)
  /**
   * Does the crop still follow the Lage?
   *
   * ⚠️ The stored `krokiView` used to be the last word: framed once at 22:20, restored verbatim
   * at 01:30, with everything placed since it outside the picture — and nothing said so
   * (08.08. Einsatz). It follows until somebody frames by hand, and a hand-made frame then wins
   * forever, because overruling an operator's own crop is worse than any automatic fit.
   */
  const [follow, setFollow] = useState(() => !initial)
  /** the crop as it currently stands — what decides whether anything is outside it */
  const [viewBounds, setViewBounds] = useState<[number, number, number, number] | null>(null)
  const [previewZoom, setPreviewZoom] = useState(initial?.zoom ?? 16)
  const [previewWidth, setPreviewWidth] = useState(720)
  const printScale = previewWidth / PRINT_REF_WIDTH
  /** the map exists and can be projected against — the live fit test hangs off this */
  const [mapReady, setMapReady] = useState(false)
  /** the numbers and the legend, as they stood when the last movement SETTLED */
  const [legend, setLegend] = useState<KrokiLegend>({ numbers: {}, lines: [], unnumbered: 0 })
  /** the discs that do not fit the frame RIGHT NOW — the one thing recomputed mid-pan */
  const [outKeys, setOutKeys] = useState<readonly string[]>([])
  /** a hand (or an animation) is moving the crop: the legend below is a moment behind */
  const [panning, setPanning] = useState(false)

  // same base-layer pick as buildKrokiPayload, so the preview shows the printed basemap
  const base = scene.layers.find((l) => l.base && l.visible && l.tiles?.length) ?? scene.layers.find((l) => l.base && l.tiles?.length)
  const style = useMemo(() => ({
    version: 8 as const,
    sources: { base: { type: 'raster' as const, tiles: base?.tiles?.length ? [withCartoLabelsBaked(base.tiles[0])] : cartoRasterTiles(CARTO_FALLBACK_STYLE, ['a']), tileSize: 256, maxzoom: base?.maxzoom } },
    layers: [{ id: 'base', type: 'raster' as const, source: 'base' }],
  }), [base])

  const layerVisible = (id: string) => scene.layers.find((l) => l.id === id)?.visible ?? true
  const drawingsVisible = layerVisible(appConfig.defaults.drawingLayerId)
  // …with the Motorspritzen a Leitung draws (lib/linePumps), which the payload prints the same way
  const shown = [...scene.entities, ...drawnPumpEntities(scene.drawings)].filter((e) => Array.isArray(e.coord) && layerVisible(e.layer))

  const bounds = useMemo(() => {
    const pts = operationalExtentPoints(scene.center, scene.entities, drawingsVisible ? scene.drawings : [], false)
    const lngs = pts.map((p) => p[0]), lats = pts.map((p) => p[1])
    return [[Math.min(...lngs), Math.min(...lats)], [Math.max(...lngs), Math.max(...lats)]] as [[number, number], [number, number]]
  }, [scene, drawingsVisible])
  const fitMaxZoom = krokiFitMaxZoom(bounds)

  const geojson = useMemo(() => ({
    type: 'FeatureCollection' as const,
    features: (drawingsVisible ? scene.drawings : []).filter((d) => Array.isArray(d.coords) && d.coords.length).map((d) => ({
      type: 'Feature' as const,
      properties: {
        color: d.color ?? appConfig.drawing.defaultColor, area: d.kind !== 'line',
        // the Füllung the sheet will actually print — a Schraffur is a different STATEMENT about
        // the ground, not a shade of the wash, so the crop has to show which one it is
        hatch: !!d.hatch,
        // the server draws `(width || 4) * u` — the same factor this preview calls printScale.
        // It used to be a frozen 0.62, which happened to be about right for one page shape and
        // was wrong for the other; a constant cannot follow a crop that changes size.
        dashed: !!d.dashed, width: (d.width ?? 4) * printScale,
      },
      geometry: d.kind === 'circle' && d.radiusM
        ? { type: 'Polygon' as const, coordinates: circlePolygon(d.coords[0], d.radiusM) }
        : d.kind === 'area'
          ? { type: 'Polygon' as const, coordinates: [[...d.coords, d.coords[0]]] }
          : { type: 'LineString' as const, coordinates: d.coords },
    })),
  }), [scene.drawings, drawingsVisible, printScale])

  /**
   * What the printed Kroki draws INLINE along a line besides the bare geometry: the Teilstück
   * fork and the end tag («Leitungsnummer · Inhalt · Stockwerk · Trupp»).
   *
   * The preview drew plain lines, so the one screen whose whole job is «this is what comes out»
   * showed less than what came out — you could not see the «-E» you were framing around. Built
   * from the same fields `buildKrokiPayload` sends and rendered with the same components the
   * Lage map uses, so preview, screen and paper cannot drift into three different pictures.
   *
   * The distance/label chip is NOT here: on the sheet it is a numbered disc and its words are in
   * the legend (lib/krokiLegend). The end tag stays because kroki.py keeps printing THAT inline.
   */
  const decor = useMemo(() => (drawingsVisible ? scene.drawings : [])
    .filter((d) => d.kind === 'line' && Array.isArray(d.coords) && d.coords.length >= 2)
    .map((d) => {
      const n = d.coords.length
      const end = d.coords[n - 1] as LngLat
      // ⚠️ NOT `d.endLabelAt`. A tag dragged by hand moves on the Lage map, but the print does
      // not know about it — `endLabelAt` is in no payload kroki.py ever sees, so the sheet always
      // puts the tag 72 % along the last segment. A crop that honoured the hand placement was
      // therefore showing a position that cannot come out. Same anchor as the paper here; making
      // the paper follow the hand instead is a payload + server change, not a preview one.
      const tagAt = lerpPoint(d.coords[n - 2], end, 0.72) as LngLat
      const trupp = truppForLine(d, trupps)
      return {
        d, end, tagAt, trupp, tagN: tagNormal(d.coords as LngLat[]),
        color: d.color || appConfig.drawing.defaultColor,
        width: d.width || 4,
        hasTag: hasLineDecor(d) || !!trupp,
      }
    }), [scene.drawings, drawingsVisible, trupps])

  /**
   * Everything the sheet turns into a numbered disc, in the server's own order (lib/krokiLegend).
   * Drawing labels and symbol captions only — the end tag above, the Trupp chip and the
   * Notizzettel print inline and keep their words.
   */
  const labels = useMemo(() => krokiLabels({
    drawings: drawingsVisible ? scene.drawings : [],
    entities: shown,
    byName: scene.byName,
    captionMode,
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `shown` is a filter over the same scene
  }), [scene, drawingsVisible, captionMode])
  /** identity that actually changed, for the effects below: `scene` is rebuilt every render */
  const labelsKey = labels.map((l) => `${l.key} | ${l.text}`).join('~')
  const labelsRef = useRef(labels)
  useEffect(() => { labelsRef.current = labels })

  /** Project every label against the crop as it stands. Cheap — a handful of points. */
  const placeAll = (m: MapLibreMap) => {
    const el = m.getContainer()
    return placeKrokiLabels(labelsRef.current, (c) => m.project(c), {
      width: el.clientWidth, height: el.clientHeight, zoom: m.getZoom(), printScale: el.clientWidth / PRINT_REF_WIDTH,
    })
  }
  /** Renumber and rewrite the legend. Runs when a movement SETTLES, not per frame: at preview
   *  size the figures are ~5px tall and nobody reads them mid-pan, while the projection they
   *  depend on is the same one the live fit test already does. */
  const settleLegend = (m: MapLibreMap) => {
    const placed = placeAll(m)
    setLegend(numberKrokiLabels(labelsRef.current, placed))
    setOutKeys(placed.filter((p) => !p.fits).map((p) => p.key))
  }

  /**
   * Membership LIVE, numbers on settle.
   *
   * A disc going hollow the instant its anchor leaves the crop is the fact worth seeing while
   * the hand is still moving — «this Hydrant's name will not be on the sheet at all» is the most
   * consequential thing a pan does, and it used to be invisible on the very screen where the pan
   * happens. The figures and the legend wait for `moveend`, on the `reportView` channel the panel
   * already had. The only per-frame work is this projection, and the state is written ONLY when
   * the answer actually changes — a few times per pan, not a few hundred.
   */
  /** The Schraffur tiles, on THIS map instance — images are per-map, and the preview draws its
   *  own (MapImages registers the Karte's). Re-added on `styledata` because a style reload drops
   *  every registered image, and minted on demand for a colour outside the palette. */
  useEffect(() => {
    const m = mapRef.current?.getMap()
    if (!m) return
    const ensure = () => { ensureHatchImages(m, appConfig.drawing.colors); m.triggerRepaint() }
    // a resolver, not a `styleimagemissing` listener — see lib/draw · ensureHatchImages
    const resolveMissing = (id: string) => {
      const c = hatchImageColor(id)
      if (c) ensureHatchImage(m, id, c)
    }
    ensure()
    m.on('styledata', ensure)
    m.setMissingStyleImageResolver(resolveMissing)
    return () => { m.off('styledata', ensure); m.setMissingStyleImageResolver(null) }
  }, [mapReady])

  useEffect(() => {
    const m = mapRef.current?.getMap()
    if (!m) return
    const tick = () => {
      const out = placeAll(m).filter((p) => !p.fits).map((p) => p.key)
      setOutKeys((prev) => (prev.length === out.length && prev.every((k, i) => k === out[i]) ? prev : out))
    }
    const start = () => setPanning(true)
    const end = () => setPanning(false)
    m.on('move', tick)
    m.on('movestart', start)
    m.on('moveend', end)
    return () => { m.off('move', tick); m.off('movestart', start); m.off('moveend', end) }
    // subscribes once the map exists; the labels themselves are read through a ref
  }, [mapReady])

  /** …and the Lage itself can change under a still crop (a new symbol, another Kroki-Stand) */
  useEffect(() => {
    const m = mapRef.current?.getMap()
    if (m) settleLegend(m)
    // eslint-disable-next-line react-hooks/exhaustive-deps -- labelsKey IS the labels, stably
  }, [mapReady, labelsKey, landscape])

  const fit = () => mapRef.current?.getMap().fitBounds(bounds, { padding: FIT_PAD, maxZoom: fitMaxZoom, ...(prefersReducedMotion() ? { duration: 0 } : {}) })
  /** …and go back to following, because «alles zeigen» is a request for exactly that */
  const fitAndFollow = () => { setFollow(true); fit() }

  /**
   * Re-fit while following: when the Lage grows past the frame, and when the page shape flips.
   *
   * ⚠️ Hoch/Quer used to keep centre and zoom, so turning the sheet upright lost the left and
   * right of the picture without gaining anything above or below — the choice of shape changed
   * the crop rather than the page. `boundsKey` rather than `bounds`: the array is rebuilt on
   * every render, and depending on the object would re-fit continuously.
   */
  const boundsKey = bounds.flat().join(',')
  useEffect(() => {
    if (!follow) return
    mapRef.current?.getMap().fitBounds(bounds, { padding: FIT_PAD, maxZoom: fitMaxZoom, duration: motionDuration(200) })
    // eslint-disable-next-line react-hooks/exhaustive-deps -- boundsKey IS the bounds, stably
  }, [follow, boundsKey, landscape])

  /**
   * What is placed OUTSIDE the crop, and roughly which way.
   *
   * Shown as an arrow at the edge rather than by widening the frame: something outside is
   * usually one Hydrant two streets away, and zooming out to reach it shrinks the part of the
   * picture the sheet is actually about. The arrow says «there is more, that way» and offers
   * the fit — it never takes it.
   */
  const offscreen = useMemo(() => {
    if (!viewBounds) return null
    const [w, s2, e, n] = viewBounds
    const pts = operationalExtentPoints(scene.center, scene.entities, drawingsVisible ? scene.drawings : [], false)
    const out = pts.filter(([lng, lat]) => lng < w || lng > e || lat < s2 || lat > n)
    if (!out.length || out.length === pts.length) return null // nothing out, or nothing framed at all
    const cx = (w + e) / 2, cy = (s2 + n) / 2
    const ox = out.reduce((t, p) => t + p[0], 0) / out.length
    const oy = out.reduce((t, p) => t + p[1], 0) / out.length
    // screen y grows downwards, so the vertical component is negated for the angle
    const rad = Math.atan2(-(oy - cy), (ox - cx) * Math.cos((cy * Math.PI) / 180))
    return {
      count: out.length,
      deg: (rad * 180) / Math.PI,
      // park it just inside the frame edge, in the direction the content lies
      left: 50 + 38 * Math.cos(rad),
      top: 50 - 38 * Math.sin(rad),
    }
  }, [viewBounds, scene, drawingsVisible])

  const syncView = (m: MapLibreMap) => {
    setPreviewZoom(m.getZoom())
    setPreviewWidth(m.getContainer().clientWidth)
  }
  /** Report the crop upwards. Fired when a movement SETTLES (and on load/resize, where the map
   *  moves without anybody dragging it) rather than on every frame: the surface re-renders on
   *  each of these, and a pan is a few hundred frames. */
  const reportView = (m: MapLibreMap) => {
    const c = m.getCenter()
    const b = m.getBounds()
    setViewBounds([b.getWest(), b.getSouth(), b.getEast(), b.getNorth()])
    // the sheet's numbering settles with the crop — same channel, same moment
    settleLegend(m)
    onViewChange?.({
      center: [c.lng, c.lat],
      zoom: m.getZoom(),
      bounds: [b.getWest(), b.getSouth(), b.getEast(), b.getNorth()],
    })
  }

  /** The disc, in the server's own units: tested at the TRUE radius, drawn at a legibility
   *  floor (see KROKI_DISC_MIN_PX — the two radii are the point, not an inconsistency). */
  const discPx = Math.max(KROKI_DISC_MIN_PX, 2 * KROKI_DISC_R * printScale)
  // The three plates the compositor pastes on LAST, in its own fractions of the render width
  // (`u = width / 1050`). Opaque, and exactly where the sheet puts them: until now the operator
  // could centre a Trupp symbol precisely where the Massstabsbalken was going to land on it.
  const u = printScale
  const centerLat = viewBounds ? (viewBounds[1] + viewBounds[3]) / 2 : scene.center[1]
  // ⚠️ `previewZoom + 1`. MapLibre's camera zoom is defined against a 512px world; the server
  // measures against 256px tiles and adds the same log2(512/256) in `center_view`. Without it
  // the bar would claim twice the ground it covers.
  const scaleBar = krokiScaleBar(pxPerM(centerLat, previewZoom + 1), previewWidth, u)
  const attribution = base?.attribution ?? DEFAULT_ATTRIBUTION

  return (
    <div className="kf-panel">
      {/* Hoch · Quer sits ABOVE the crop, never in or under it: it changes the shape of the
          frame below it, so a control anywhere downstream would move under the finger that
          just pressed it. Seeded from the crop's own aspect — the app's guess is the default,
          and one tap overrules it. The teaching line shares the row because there is no dialog
          title left to carry it, and a chip floating on a column-width crop would cover the
          very picture it explains. */}
      <div className="kf-panel-head">
        <span className="kf-panel-hint">{P.framingHint}</span>
        <Segmented
          ariaLabel={P.krokiOrientation}
          value={landscape ? 'land' : 'port'}
          onChange={(v) => onLandscapeChange?.(v === 'land')}
          options={[
            { value: 'port', label: P.krokiPortrait },
            { value: 'land', label: P.krokiLandscape },
          ]}
        />
      </div>
      {/* ── THE PAPER ──
          The crop and its legend are ONE white plate, because on the sheet they are one thing:
          the legend carries the words the picture no longer does, and drawing it as app chrome
          beside a light picture would have made the half people actually read the half that is
          not a preview. The plate stays light at night (the sheet always is — `buildKrokiPayload`
          sends `base.tiles[0]`, never the night tiles); the CSS dims it to 80 % in the dark and
          gives it full brightness back under the hand. Everything that only helps with FRAMING —
          the hint line, Hoch/Quer, ±, «Folgt der Karte» — stays outside it. */}
      <div className={cx('kf-paper', !landscape && 'portrait')}>
        <div className={cx('kf-map', !landscape && 'portrait')}>
          {/* Something is placed outside this crop. An ARROW, not a forced zoom-out: what is
              outside is usually one Hydrant two streets away, and widening the frame to reach it
              shrinks the part of the picture the sheet is about. It offers the fit; it never
              takes it. */}
          {offscreen && !follow && (
            <button
              type="button" className="kf-off"
              style={{ left: `${offscreen.left}%`, top: `${offscreen.top}%` }}
              title={fillTemplate(P.framingOutside, { n: offscreen.count })}
              aria-label={fillTemplate(P.framingOutside, { n: offscreen.count })}
              onClick={fitAndFollow}
            >
              <span className="kf-off-arrow" style={{ transform: `rotate(${-offscreen.deg}deg)` }} aria-hidden>
                <Icon id="chevron" />
              </span>
              <span>{offscreen.count}</span>
            </button>
          )}
          <Map
            ref={mapRef}
            initialViewState={initial
              ? { longitude: initial.center[0], latitude: initial.center[1], zoom: initial.zoom }
              : { bounds, fitBoundsOptions: { padding: FIT_PAD, maxZoom: fitMaxZoom } }}
            mapStyle={style}
            dragRotate={false}
            pitchWithRotate={false}
            touchPitch={false}
            attributionControl={false}
            onLoad={(e) => { e.target.touchZoomRotate.disableRotation(); syncView(e.target); reportView(e.target); setMapReady(true) }}
            onMove={(e) => { setPreviewZoom(e.viewState.zoom) }}
            // `originalEvent` is present only when a HAND moved the map — the programmatic
            // fitBounds below must not switch its own mode off
            onMoveEnd={(e) => { if (e.originalEvent) setFollow(false); reportView(e.target) }}
            onResize={(e) => { syncView(e.target); reportView(e.target) }}
          >
            <Source id="draws" type="geojson" data={geojson}>
              {/* washed and hatched Flächen are filtered apart for the reason the Karte states:
                  `fill-pattern` overrides `fill-color` wherever it resolves, and a `case` that
                  yields no image paints nothing (MapView · l-draw-fill / l-draw-hatch). The tile
                  is at SCREEN scale here, not scaled by printScale — the crop answers «which
                  Füllung», the sheet answers «how fine» (kroki.py · _hatch_polygon). */}
              <Layer id="draw-fill" type="fill" filter={['all', ['==', ['get', 'area'], true], ['!', ['get', 'hatch']]]} paint={{ 'fill-color': ['get', 'color'], 'fill-opacity': 0.14 }} />
              <Layer id="draw-hatch" type="fill" filter={['all', ['==', ['get', 'area'], true], ['get', 'hatch']]}
                paint={{ 'fill-pattern': ['concat', 'hatch-', ['downcase', ['get', 'color']]] } as never} />
              {/* solid and dashed are separate layers: line-dasharray is not data-driven in
                  MapLibre, and a Druckleitung drawn dashed printed solid in the preview */}
              <Layer id="draw-line" type="line" filter={['!=', ['get', 'dashed'], true]}
                paint={{ 'line-color': ['get', 'color'], 'line-width': ['get', 'width'] }} />
              <Layer id="draw-line-dash" type="line" filter={['==', ['get', 'dashed'], true]}
                paint={{ 'line-color': ['get', 'color'], 'line-width': ['get', 'width'], 'line-dasharray': [2.2, 1.6] }} />
            </Source>
            {decor.map((ld) => (
              <Fragment key={`kd${ld.d.id}`}>
                {ld.d.teilstueck && (
                  <Marker longitude={ld.end[0]} latitude={ld.end[1]} anchor="center">
                    {/* ⚠️ Scaled as a WHOLE, never by handing it a smaller width. `forkDims` floors
                        the spine at 14 screen px — a deliberate finger/legibility floor on the Lage
                        map — so a scaled-down width simply hits the floor and the fork keeps full
                        size while the line beside it shrinks: a giant comb on a hairline. Passing
                        the real width and scaling the rendered glyph keeps fork and line in the
                        proportion the sheet prints them in. */}
                    <div className="kf-print-scale" style={{ transform: `scale(${printScale})` }}>
                      <TeilstueckFork angleDeg={forkBearing(ld.d.coords, previewZoom, Math.max(10, ld.width * 2.5))} color={ld.color} width={ld.width} />
                    </div>
                  </Marker>
                )}
                {/* zIndex: above the line's own decorations — see MapView for why it has to sit on
                    the marker container, and the printed Kroki has to match the screen */}
                {ld.hasTag && (
                  <Marker longitude={ld.tagAt[0]} latitude={ld.tagAt[1]} anchor="center" style={{ zIndex: 3 }}>
                    {/* no alarm tint here, exactly as on paper: a printed Kroki is the record of
                        an incident, not a live board (see krokiPayload · drawings) */}
                    {/* ⚠️ `translate` in PERCENT, and it has to come after the scale: a percentage
                        resolves against the element's OWN box, so `50%` is exactly «half the tag in
                        this direction» — the support function kroki.py computes by hand from the
                        text width. No measuring, and it stays right when the tag grows a Trupp
                        name. The px term is half the stroke plus a hair of air; it rides inside
                        the scale, so it shrinks with everything else. */}
                    <div className="kf-print-scale" style={{ transform: `scale(${printScale}) translate(calc(${(ld.tagN[0] * 50).toFixed(2)}% + ${(ld.tagN[0] * (ld.width / 2 + 7)).toFixed(2)}px), calc(${(ld.tagN[1] * 50).toFixed(2)}% + ${(ld.tagN[1] * (ld.width / 2 + 7)).toFixed(2)}px))` }}>
                      <EndTag lineNo={ld.d.lineNo} content={ld.d.content} floorTag={ld.d.floorTag}
                        trupp={ld.trupp ? truppTagText(ld.trupp) : undefined} tone="idle" color={ld.color} oneLine />
                    </div>
                  </Marker>
                )}
                {/* the distance/label chip is NOT drawn here any more — on the sheet it is a
                    numbered disc and its words are in the legend below (see the disc markers) */}
              </Fragment>
            ))}
            {/* ⚠️ The glyph is built BEFORE the <Marker>, and nothing the sheet does not print
                gets one. react-map-gl decides «has children?» once, in a useMemo([]) at mount:
                a marker whose only child evaluates to null gets MapLibre's own default pin — the
                stock teal drop — and keeps it for good. Same trap as the Lage labels (MapView). */}
            {shown.map((e) => {
              const glyph = (() => {
                  const printable = krokiEntity(e, scene.byName, captionMode)
                  if (!printable) return null
                  if (e.kind === 'shape') {
                    // WYSIWYG with the sheet: the print stretches a free-aspect Rechteck/Rauch
                    // (kroki.py, same clamp as lib/shapes · shapeAspect) and draws the arrow's
                    // «→|» Stopp-Balken (krokiPayload · shapeSvgString) — so this preview does
                    // too, per-kind size cap included (a long Rotation legitimately exceeds the
                    // 900 px box every other shape stops at). Default colour from SHAPE_DEFS,
                    // the same fallback the payload sends.
                    const kind = e.shape ?? 'square'
                    const w = shapePx(e.sizeM, e.coord[1], previewZoom, SHAPE_MAX_PX[kind])
                    const h = w * shapeAspect(kind, e.aspect)
                    return (
                      <div className="kf-print-box" style={{ width: w * printScale, height: h * printScale }}>
                        <div className="kf-print-inner kf-glyph" style={{ width: w, height: h, transform: `translate(-50%, -50%) scale(${printScale}) rotate(${e.rotation ?? 0}deg)` }}>
                          {/* ⚠️ the shape's OWN aspect, carrier and stroke — the box around it is
                              already sized from them (w × h above), so a glyph built at the DEFAULT
                              aspect was stretched into it and the preview stopped being WYSIWYG
                              against the paper it is cropping (01.09.). */}
                          <ShapeGlyph kind={kind} color={e.color ?? SHAPE_DEFS[kind].defaultColor}
                            stop={kind === 'arrow' && !!e.stop} aspect={e.aspect} carrier={e.carrier} reverse={e.reverse} strokeW={e.strokeW} boxPx={w} fillOpacity={e.fillOpacity} hatch={e.hatch} sharpCorners={e.sharpCorners} />
                        </div>
                      </div>
                    )
                  }
                  // Glyph-less markers. The server has exactly TWO of these (kroki.py, the
                  // `if not svg` branch): the Trupp dot and the Notizzettel, whose text it prints
                  // INLINE and never numbers. Everything else glyph-less it skips entirely — the
                  // preview used to draw a chip for those too, inventing a label the sheet has no
                  // way to produce.
                  if (!printable.symbolSvg && !printable.symbol) {
                    return printable.caption && (e.kind === 'team' || e.kind === 'note') ? (
                      <div className="kf-print-scale" style={{ transform: `scale(${printScale})` }}>
                        <span className={`kf-plain ${e.kind}`}>{printable.caption}</span>
                      </div>
                    ) : null
                  }
                  const svg = printable.symbolSvg ?? scene.byName[printable.symbol ?? ''] ?? ''
                  const size = symPx(e.kind, e.coord[1], previewZoom, krokiSymbolMul(previewZoom))
                  return (
                    <div className="kf-print-box" style={{ width: size * printScale, height: size * printScale }}>
                      <div className="kf-print-inner" style={{ transform: `translate(-50%, -50%) scale(${printScale})` }}>
                        <TacticalSymbol
                          svg={svg}
                          sizePx={size}
                          rotation={printable.rotation ?? 0}
                          floor={printable.floor}
                          floorFrom={printable.floorFrom}
                          floorTo={printable.floorTo}
                          spread={printable.spread}
                          count={printable.count}
                          done={printable.done}
                          // no `caption` — on the sheet the words are a numbered disc plus a
                          // legend line (kroki.py, the collision pass). Drawing them here made
                          // the preview a picture that never comes out, and hid the fact that a
                          // caption whose disc leaves the frame is dropped from the sheet.
                        />
                      </div>
                    </div>
                  )
                })()
              if (!glyph) return null
              return (
                <Marker key={e.id} longitude={e.coord[0]} latitude={e.coord[1]} anchor="center">{glyph}</Marker>
              )
            })}
            {/* ── the words, as the sheet carries them ──
                A filled disc with its figure while it fits; a hollow amber ring the moment it does
                not, because then the server clips it and its line never reaches the legend. The
                ring sits at its real place and is cut in half by the frame edge — exactly what
                happens to the disc on paper. */}
            {labels.map((l) => {
              const out = outKeys.includes(l.key)
              const n = legend.numbers[l.key]
              return (
                <Marker key={`kn${l.key}`} longitude={l.at[0]} latitude={l.at[1]} anchor="center" style={{ zIndex: 4 }}>
                  <span
                    className={cx('kf-disc', out && 'kf-disc-out')}
                    style={{
                      width: discPx, height: discPx, fontSize: discPx * 0.625,
                      transform: `translateY(${discOffsetPx(l, previewZoom, printScale)}px)`,
                    }}
                    title={out ? P.framingDiscOut : l.text}
                  >{out ? '' : (n ?? '')}</span>
                </Marker>
              )
            })}
          </Map>
          {/* The three plates the compositor pastes on LAST, non-interactive and in the server's
              own fractions (kroki.py · _north_arrow / _scale_bar / the attribution rect). They are
              tiny here — the scale label is ~5px — and that is the honest size: they are opaque,
              and what they cost is the corner of the picture they cover. */}
          <span className="kf-furniture kf-north" aria-hidden
            style={{ right: 14 * u, top: 14 * u, width: 34 * u, height: 34 * u }}>
            {/* the same dial as kroki.py · north_dial_svg — the N INSIDE the ring, and a dart
                rather than a needle, because at print size a needle turns to mush */}
            <svg viewBox="-25 -25 50 50" aria-hidden>
              <circle r="24" fill="#ffffff" fillOpacity="0.9" stroke="#5b6573" strokeWidth="1.5" />
              <text y="-13" textAnchor="middle" fontSize="13" fontWeight="700" fill="#1c1c1c">N</text>
              <path d="M0 -8 L10 16 L0 7 L-10 16 Z" fill="#1c1c1c" />
            </svg>
          </span>
          {scaleBar && (
            <span className="kf-furniture kf-scale" aria-hidden
              style={{ left: 9 * u, bottom: 6 * u, width: scaleBar.platePx, height: 29 * u }}>
              <span className="kf-scale-nums" style={{ left: 5 * u, top: 5 * u, width: scaleBar.barPx, fontSize: 11 * u }}>
                <i>0</i><i>{scaleBar.metres} m</i>
              </span>
              <span className="kf-scale-bar" style={{ left: 5 * u, top: 19 * u, width: scaleBar.barPx, height: 5 * u }}>
                <i /><i /><i /><i />
              </span>
            </span>
          )}
          <span className="kf-furniture kf-attrib" aria-hidden
            style={{ right: 0, bottom: 0, height: 18 * u, paddingInline: 6 * u, fontSize: 11 * u }}>{attribution}</span>
        </div>
        {/* «Legende» — the words the picture no longer carries. Two columns, filled down the first
            and then the second, which is the order app/report lays them out in; below the
            two-column breakpoint one column, where the sheet's own halving would only shorten
            lines that are already short. */}
        {/* nothing labelled in the whole Lage → no legend at all, exactly as the sheet prints
            it. «nichts im Ausschnitt» is a different statement and stays: it means the pan has
            pushed every name off the paper. */}
        {labels.length > 0 && (
          <div className={cx('kf-legend', panning && 'pending')}>
            <span className="kf-legend-head">{P.framingLegend}</span>
            {legend.lines.length > 0 ? (
              <ol className="kf-legend-list">
                {legend.lines.map((t, i) => (
                  <li key={i}><b>{i + 1}</b><span>{t}</span></li>
                ))}
              </ol>
            ) : (
              <p className="kf-legend-wait">{P.framingLegendEmpty}</p>
            )}
            {legend.unnumbered > 0 && (
              <p className="kf-legend-miss">{fillTemplate(P.framingLegendMissing, { n: legend.unnumbered })}</p>
            )}
            {panning && <p className="kf-legend-wait">{P.framingLegendPending}</p>}
          </div>
        )}
      </div>
      {/* The controls belong to the PANEL, not to the picture. Floating on the map they
          covered the very crop they were there to adjust — the ± column sat on the Stand
          slider's right end, and both hid whatever was underneath them. In their own bar the
          map stays entirely map, and nothing moves when the frame changes shape. */}
      <div className="kf-controls">
        {/* «Stand» — one picture is one Lage at ONE time. «Jetzt» is the normal answer; a time
            reconstructs the Lage as it stood then (the map redraws under the crop), which is
            how a rapport can still show a Rettung that has long since left. */}
        {onAtChange && startedAtMs != null && (
          <div className="kf-at">
            <span className="kf-at-label">{P.krokiAtLabel}</span>
            {/* A SLIDER over the Einsatz, not a clock to type into: nobody knows what time the
                Rettung was still standing there — but everybody can drag until the picture
                shows it. The right end IS «jetzt», so the live picture stays one drag away and
                needs no separate switch. */}
            {/* The DRAG is local; the reconstruction runs when the thumb comes to rest. Firing
                it on every notch meant a fetch per pixel — the busy line blinked, the map
                redrew mid-drag and the whole sheet flickered. */}
            {/* The busy trail owns a fixed slot beside the time, so the slider stays still. */}
            {/* WHEN anything happened, as hairlines under the track. Without them «drag until
                the picture shows it» is a blind search across the whole Einsatz — and the
                moments worth stopping at are exactly the ones that left a Verlauf row or a
                recorded action. Ticks only: they mark, they are not targets, and the slider
                underneath keeps every pixel of its own hit area. */}
            <span className={cx('kf-at-track', atBusy && 'busy')}>
              {markPcts.length > 0 && (
                <span className="kf-at-marks" aria-hidden="true">
                  {markPcts.map((pct, i) => <i key={i} style={{ left: `${pct}%` }} />)}
                </span>
              )}
              {/* the app's own Slider (20.10.2026, UX sweep M3 – it was the native range):
                  `onCommit` is the finger lifting, `onCancel` a drag the browser took away */}
              <Slider
                min={startedAtMs} max={nowMs} step={30_000}
                value={dragMs ?? atMs ?? nowMs}
                ariaLabel={P.krokiAtLabel}
                valueText={label}
                onChange={setDragMs}
                onCommit={commitDrag}
                onCancel={() => setDragMs(null)}
              />
            </span>
            <span className="kf-at-wait" aria-hidden="true">{atBusy && <ShellLoader />}</span>
            <b className="kf-at-val">{label}</b>
          </div>
        )}
        {/* «Folgt der Karte» joins the ± pair: all three answer «show me more / less / all
            of it», and the old action row they were split across is gone with the confirm. */}
        {/* «Auf Einsatz zoomen» AND «folgt der Lage» are the same wish, so they are one control:
            pressing it fits now and keeps fitting, and the first hand-made pan turns it off. */}
        {/* ⚠️ ONE cluster element, not three loose ones: on a phone the ± pair no longer fitted
            beside the button (the bar reserves --fab-safe on its right) and wrapped onto a line
            of its own — two ragged half-rows where the eye expects one row. Nesting them makes
            the button give up the width instead; the ± targets never shrink. */}
        <div className="kf-ctl-cluster">
          {/* «Folgt der Karte» is a yes/no, so it is the `OnOff` pair (28.09.2026). It was ONE
              button whose words flipped – «Auf Einsatz zoomen» off, «Folgt der Karte» on – so the
              label said the state on one tap and the action on the next. «An» fits and keeps
              fitting; a hand-made pan still sets it back to «Aus» (onMoveEnd). */}
          <div className="kf-ctl-follow" title={P.framingFollowOn}>
            <span className="kf-ctl-follow-l">{P.framingFollows}</span>
            <OnOff ariaLabel={P.framingFollows} value={follow}
              onChange={(v) => { if (v) fitAndFollow(); else setFollow(false) }} />
          </div>
          {/* ± stays: with gloves on a tablet, pinching a crop into place is the fiddliest
              gesture the app asks for, and this is the one place where the exact framing IS
              the point. Beside the picture rather than on top of it. */}
          <div className="kf-zoom">
            <IconButton variant="secondary" className="kf-zoom-btn" label={appConfig.copy.nav.zoomIn}
              onClick={() => mapRef.current?.getMap().zoomIn({ duration: motionDuration(180) })}><Icon id="plus" /></IconButton>
            <IconButton variant="secondary" className="kf-zoom-btn" label={appConfig.copy.nav.zoomOut}
              onClick={() => mapRef.current?.getMap().zoomOut({ duration: motionDuration(180) })}><Icon id="minus" /></IconButton>
          </div>
        </div>
      </div>
    </div>
  )
}
