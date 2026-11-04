// «Karte & Objekte» — the station reference viewer outside an Einsatz (docs/karte-objekte.md).
// Its own lazy chunk (App · lazy), mounted for the `/karte` route.
//
// What it is: the station area on the Einsatz's map (MapView, its Ebenen, the vehicles, the
// weather), every station object as its building(s) outlined in ink (`--obj-plans`) with its name tag (owner,
// review round 3: «just highlight buildings / building groups» — no key-box kind), one panel for whatever is known about the selected place, the object's plans
// in the NavRail grammar (on a phone: as rows in its slide-up sheet, KartePanel), and the reference
// tools — Punkt setzen, Messen, Gefahrgut — that need no symbol placed first.
//
// ⚠️ What it never is: an Einsatz. It holds NO workspace, writes no drawing, binds no plan and
// moves nothing in any incident. Measurements, the Gefahrgut rings and a dropped pin live in this
// component's state and die with it; the only things kept are its own Ebenen and where it was
// looking (lib/karte/session). The single way it changes anything is the Objektbesuch button,
// which hands over to the existing capture (`/besuche/neu?…&from=karte`, contract C1).
//
// Beside the map it has a second surface, «Checkliste» (owner, 19.10.2026): the station's
// checklists and device Anleitungen to READ in peace time — the Einsatz tab's word and glyph,
// because the same content lives there. This file only hosts it (`ChecklistLibrary`, which owns
// everything inside, the selection included) in the full-surface frame, and feeds it the top
// bar's search. The phone's bar is fixed: Karte · Checkliste │ Messen · Gefahrgut · Ebenen — a
// tool tapped on the Checkliste goes back to the Karte with that tool armed. The tablet's left
// rail is always there with the two surfaces; a selected object's plans hang under them.
//
// It is HOME too (owner, 16.10.2026 · variant B): with no Einsatz open an account lands here, and
// the menu button at the top left («FWO ▾», the station's short name or mark — it was «Einsätze ▾»
// until review round 5) opens the app menu — the same rows as the Einsatz menu
// (panels/AppMenuRows, owner 17.10.2026). App renders them (`einsaetze.render`, its handlers);
// this file only opens and closes the sheet, and hands in its own «Auf diesem Gerät».
//
// Each concern is a hook of its own next to this file (`use*.ts` — the catalogue, the arrival,
// the layers, offline, the outlines, the tools, the way back, the menu, the search, the camera,
// the panel's place, the pointer, the overlays, the tags; the pure rules are lib/karte/*). What
// stays here is the wiring between them: what a selection, a tool or a tap does to the others,
// and the markup.

import { Suspense, useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import type { MapRef } from 'react-map-gl/maplibre'
import { Marker } from 'react-map-gl/maplibre'
import { appConfig } from '../../config/appConfig'
import { getLocaleId } from '../../config/copy'
import { Icon, IconSprite } from '../../lib/icons'
import { MapPin } from '../MapPin'
import { cx } from '../../lib/cx'
import { fillTemplate } from '../../lib/format'
import { useAuth } from '../../lib/auth'
import { useIsPhone } from '../../lib/useIsPhone'
import { useOnline } from '../../lib/useOnline'
import { useViewportPan } from '../../lib/useViewportPan'
import { noPanTouchEnd, useTypingLock } from '../../lib/iosKeyboard'
import { primeKeyboard } from '../../lib/keyboardPrime'
import { defuseAutofill, typingFieldProps } from '../../lib/typingField'
import { useSymbols } from '../../lib/useSymbols'
import { useVehicleLayer } from '../../lib/useVehicleLayer'
import { useWeather } from '../../lib/useWeather'
import { useKarteWeather } from '../../workspace/useKarteWeather'
import { objectVisitsConfig } from '../../lib/deploymentConfig'
import { fmtDistance, fmtLV95, fmtWGS, haversineM } from '../../lib/geo'
import { dismissToast, toast } from '../../lib/ui'
import { usePlacementLane } from '../../lib/toastLane'
import { geocodeSearch, type GeoHit, type IncidentMeta } from '../../lib/incidents'
import type { StationObject } from '../../lib/api/stationReference'
import { ovHref } from '../../objectVisits/route'
import { coordOf } from '../../lib/karte/search'
import { compass8, normAddress, objectAtAddress, objectVisitHref, placeVisitHref, REPORT_CHECKLIST, ringAt, splitAddress, type NamedPoint } from '../../lib/karte/places'
import { LABEL_MIN_ZOOM } from '../../lib/karte/labels'
import { GEBAEUDE_DOC, viewerPlanDocs } from '../../lib/karte/plans'
import { moduleCatalogue } from '../../lib/planOrder'
import { karteRadarStore } from '../../lib/karte/session'
import { inkOn } from '../../lib/karte/categories'
import { toolTakesTaps } from '../../lib/karte/camera'
import { objectAt, selPoint, type Hover, type Sel } from '../../lib/karte/selection'
import type { Entity, LngLat } from '../../types'
import { MapView } from '../MapView'
import { LayerPanel } from '../LayerPanel'
import { MapHint, MeasurePanel } from '../MeasurePanel'
import { ToolDock } from '../ToolDock'
import { ToolRail } from '../ToolRail'
import { MapViewsButton } from '../MapViewsMenu'
import { WeatherBadge } from '../TopBar'
import { WeatherRadarControls } from '../weatherLazy'
import { SearchField } from '../SearchField'
import { ChecklistLibrary } from '../ChecklistLibrary'
import { KartePanel, type PanelLevel, type PanelSel } from './KartePanel'
import { KarteSearch } from './KarteSearch'
import { KarteGefahrgut } from './KarteGefahrgut'
import { KarteKeySheet } from './KarteKeySheet'
import { KarteNavRail, KarteSurface } from './KartePlans'
import { KarteDevice } from './KarteDevice'
import { AlarmNudgeCard } from './AlarmReadiness'
import { useBasemapOffline, usePlansHeld } from './useKarteOffline'
import { karteStart, useKarteCatalogue } from './useKarteCatalogue'
import { useArrival } from './useKarteArrival'
import { useGeorefPlan, useKarteEbenen, useObjectCategories, useViewerLayers } from './useKarteLayers'
import { useObjectOutlines } from './useKarteOutlines'
import { useKarteTools, type Tool } from './useKarteTools'
import { useKarteAddress, useKeepKarteView, useReturnToasts } from './useKarteSession'
import { useKarteMenu } from './useKarteMenu'
import { useKarteSearch } from './useKarteSearch'
import { useCompassViews, useFrameOnReturn, useKarteCamera } from './useKarteCamera'
import { useFrameHydrant, useHitStreet, useHydrantShown, useHydrants, useNearby, useObjectVisits, usePinAddress, useRegister } from './useKartePlace'
import { useMapHover, useMapPress } from './useKartePointer'
import { useKarteOverlays } from './useKarteOverlays'
import { tagText, useTagPlacement } from './useKarteTags'
import { NoBasemapMeldung } from '../NoBasemapMeldung'
import { UpdateBanner } from '../UpdateBanner'
import s from './Karte.module.css'

const NO_HYDRANTS: NamedPoint[] = []
/** `surface` while the Checkliste is shown (a document id never looks like this) */
const LIBRARY = 'karte:checkliste'

export interface KarteAppProps {
  /** the menu button: the app menu as a sheet (App owns the rows and their handlers) and the count
   *  behind the button's red dot — running Einsätze + alarms waiting to be taken. `onDevice` opens this
   *  viewer's «Auf diesem Gerät», the menu's offline row on home. */
  einsaetze: { badge: number; render: (close: () => void, onDevice: () => void) => ReactNode }
  /** entered from an Einsatz (its menu's «Karte & Objekte» row): say where it picked up again */
  announceReturn?: boolean
  /** hand over to the Objektbesuche surface at this address */
  onOpenVisits: (href: string) => void
  /** the open Einsätze, the newest first (the red chip names the first real one — see `runningChip`) */
  running: IncidentMeta[]
  onOpenIncident: (i: IncidentMeta) => void
}

export default function KarteApp({ einsaetze, announceReturn = false, onOpenVisits, running, onOpenIncident }: KarteAppProps) {
  const C = appConfig.copy.karte
  const { user } = useAuth()
  const phone = useIsPhone()
  const online = useOnline()
  const sym = useSymbols()
  const mapRef = useRef<MapRef | null>(null)
  // the surface's frame (the tag placement's chrome, the hover label's box)
  const rootRef = useRef<HTMLDivElement>(null)
  const ov = objectVisitsConfig()
  const canCapture = ov.enabled && !!user && ov.captureRoles.includes(user.role)
  const lang = getLocaleId().slice(0, 2).toLowerCase()
  // the keyboard on a phone (owner-r2-keyboard): the visible band as CSS (`--vv-pan`, `--vv-foot`,
  // `html[data-kb]`), the Einsatz's one hook — the bars stay on the screen, and a card with a field
  // stands on the keys (Karte.module.css · «the keyboard»)
  useViewportPan()
  // …and on a phone the page itself never moves while a field has the caret (review round 3: the
  // real iPhone moved it anyway — lib/iosKeyboard): any iOS pan is undone, a drag that nothing
  // under the finger can scroll is cancelled
  useTypingLock(phone)

  // ── where to start: the last view of this session, else the station ───────────────────────
  const [start] = useState(karteStart)
  const [view, setView] = useState<{ center: LngLat; zoom: number; bearing: number }>({ center: start.center, zoom: start.zoom, bearing: start.view?.bearing ?? 0 })

  // ── the catalogue, and what is selected and shown ─────────────────────────────────────────
  const [sel, setSel] = useState<Sel | null>(null)
  // what is shown over the map: an open document id, LIBRARY (the Checkliste), null = the Karte
  const [surface, setSurface] = useState<string | null>(() => (start.library ? LIBRARY : null))
  const onLibrary = surface === LIBRARY
  // the object the start asks for, back with the document it had open
  const restore = useCallback((o: StationObject) => {
    setSel({ kind: 'object', id: o.id })
    const surf = start.view?.objectId === o.id ? start.view.surface : 'karte'
    if (surf === 'gebaeude') setSurface(GEBAEUDE_DOC)
    else if (typeof surf === 'object') {
      const d = viewerPlanDocs(o, C.floorsRow, moduleCatalogue()).find((x) => x.plan?.id === surf.plan)
      if (d) setSurface(d.doc.id)
    }
  }, [start, C.floorsRow])
  const { cat, objects, byId, flyPending } = useKarteCatalogue(start, mapRef, phone, restore)
  const { mapUp, setMapUp, arriveRef } = useArrival(objects, view, rootRef)
  const categories = useObjectCategories(objects, lang)
  const { cats, catOff } = categories
  const selObj = sel?.kind === 'object' ? byId.get(sel.id) ?? null : null
  // titled and typed by the station's module catalogue, as the Einsatz's plan chooser is
  const docs = useMemo(() => (selObj ? viewerPlanDocs(selObj, C.floorsRow, moduleCatalogue()) : []), [selObj, C.floorsRow])
  const openDoc = surface ? docs.find((d) => d.doc.id === surface) ?? null : null
  const { avail, docHeld, openHeld } = usePlansHeld(selObj, openDoc, online)
  const catLoaded = !!cat
  useKarteAddress(selObj?.id ?? null, catLoaded)

  // ── the map's layers, weather, vehicles, base map offline, outlines ───────────────────────
  const viewer = useViewerLayers()
  const { layers, updateLayers, objectsOn, underOn } = viewer
  const weather = useKarteWeather(true, karteRadarStore)
  const liveWeather = useWeather(view.center)
  const { liveVehicles } = useVehicleLayer({})
  const { deviceOpen, setDeviceOpen, coverage, uncached, noBasemap, setNoBasemap, onBasemapUnavailable } = useBasemapOffline({ online, mapRef, view, layers })
  const { loadOutlines, ringsNear, outlines } = useObjectOutlines(mapRef, objects)

  // ── tools, the way back, the menu, the search ─────────────────────────────────────────────
  const { tool, setToolState, toggleTool, measure, erg, setErg, viewsOpen, setViewsOpen, ergKeys, keysFor } = useKarteTools(start.view?.tool ?? null)
  // the phone sheet pushed away / ✕ while its place stays selected (outline, tag, pin): a tap on
  // the place again brings it back (owner R2). Every new selection opens it.
  const [sheetShut, setSheetShut] = useState(false)
  useKeepKarteView({ ready: catLoaded, view, selObj, openDoc, onLibrary, tool })
  useReturnToasts(announceReturn, start.view?.label)
  const { sheetOpen, setSheetOpen, closeSheet, barRef, short: menuShort, mark, onMarkError, menuName } = useKarteMenu()
  const openDevice = () => { setSheetOpen(false); setDeviceOpen(true) }
  const search = useKarteSearch(objects, view.center, online, phone)
  const { query, setQuery, searchOpen, setSearchOpen, libQuery, setLibQuery, sheetFieldRef } = search
  /** a tool tapped: on a phone it goes back to the map (the Checkliste, a plan, the search close) */
  const setTool = (t: Tool) => {
    toggleTool(t, () => selPoint(sel, byId) ?? view.center)
    if (phone && t && t !== 'pin') { setSurface(null); setSearchOpen(false) }
  }
  const openPhoneTool = (t: 'measure' | 'erg' | 'layers') => {
    keysFor(t)
    setTool(t)
  }
  /** to the Checkliste: the map's tools and lists close (the Karte tab's rule), the selection stays */
  const openLibrary = () => {
    setSurface(LIBRARY); setToolState(null); setSearchOpen(false); setViewsOpen(false)
  }
  // the phone: the bar has a search button («Einsätze ▾»'s twin since round 4), the field lives in a slide-up
  const openPhoneSearch = () => {
    // inside the tap: iOS raises the keyboard only for a focus made in it (lib/keyboardPrime)
    primeKeyboard()
    setSearchOpen(true)
    setSheetOpen(false)
    // one sheet at a time at the foot: Ebenen / Gefahrgut give way (the measure stays armed)
    setToolState((t) => (t === 'layers' || t === 'erg' ? null : t))
  }

  // ── selecting ─────────────────────────────────────────────────────────────────────────────
  const { noteSelect, giveCameraBack, watchUserMoves, flyTo, reveal } = useKarteCamera(mapRef, phone, view.zoom)
  const selectObject = (id: string, fly = true, how: 'tap' | 'search' = 'tap', hit?: { at: LngLat; ring: LngLat[] }) => {
    const o = byId.get(id)
    if (!o) return
    noteSelect(how)
    setSel(hit ? { kind: 'object', id, hit } : { kind: 'object', id })
    setSurface(null); setSearchOpen(false); setSheetShut(false)
    if (tool !== 'measure' && tool !== 'erg') setToolState(null)
    const at = coordOf(o)
    // a tapped object is revealed beside / above the panel like a tapped building – the house that
    // was tapped, not the object's point (its label, maybe a block away: owner, Karte Haus round 2)
    if (at) { if (fly) flyTo(at); else reveal(hit?.at ?? at) } else if (o.address && online) {
      // no coordinates in the catalogue: the address says roughly where — marked «ungefähr»
      geocodeSearch(o.address, 1).then(([hit]) => {
        if (!hit) return
        const approx: LngLat = [hit.lng, hit.lat]
        setSel((cur) => (cur?.kind === 'object' && cur.id === id ? { ...cur, approxAt: approx } : cur))
        flyTo(approx, 17)
      }).catch(() => {})
    }
  }
  const selectBuilding = (at: LngLat, ring: LngLat[] | null, address: string | null = null, of?: string) => {
    noteSelect()
    setSel(of ? { kind: 'building', at, ring, address, of } : { kind: 'building', at, ring, address })
    setSurface(null); setSearchOpen(false); setSheetShut(false)
    if (tool !== 'measure' && tool !== 'erg') setToolState(null)
    reveal(at)
  }
  const dropPin = (at: LngLat) => {
    noteSelect()
    setSel({ kind: 'pin', at })
    setSurface(null); setSearchOpen(false); setSheetShut(false); setToolState(null)
    reveal(at)
  }
  const deselect = () => { setSel(null); setSurface(null); setSheetShut(false) }
  /** the switch «Objekt | <Haus>»: one tap to the other level, both ways, the camera left alone */
  const toLevel = (to: 'object' | 'house') => {
    if (to === 'house' && sel?.kind === 'object' && sel.hit) setSel({ kind: 'building', at: sel.hit.at, ring: sel.hit.ring, address: null, of: sel.id })
    else if (to === 'object' && sel?.kind === 'building' && sel.of && sel.ring) setSel({ kind: 'object', id: sel.of, hit: { at: sel.at, ring: sel.ring } })
  }
  // ✕ / pushed down: on the tablet the panel IS the selection; on a phone the sheet only covers
  // the map, so it goes and the place stays selected for a second look – except a dropped point,
  // which exists only for its panel: closing that takes the pin off the map too (owner, 28.10.2026)
  const closePanel = () => { giveCameraBack(); if (phone && sel?.kind !== 'pin') setSheetShut(true); else deselect() }

  const pickAddress = (hit: GeoHit) => {
    setSearchOpen(false); setQuery(splitAddress(hit.label)[0])
    const at: LngLat = [hit.lng, hit.lat]
    const o = objectAtAddress(objects, hit.label)
    if (o) { selectObject(o.id, true, 'search'); return }
    noteSelect('search')
    flyTo(at, 18)
    selectBuilding(at, ringAt(ringsNear(at), at), normAddress(hit.label))
  }

  // ── what the panel shows: register, nearby, visits, the pin's address ─────────────────────
  const point = selPoint(sel, byId)
  const { register, retryRegister } = useRegister({ sel, selObj, point, lang, objects, byId, setSel })
  // the switch names the tapped house by its register address
  const hitAt = sel?.kind === 'object' ? sel.hit?.at ?? null : null
  const hitStreet = useHitStreet(hitAt, lang)
  const { pinHit, pinNearHit } = usePinAddress(sel, online)
  const visitsState = useObjectVisits(selObj?.id ?? null, ov.enabled)
  const { hydrantLayer, hydrants } = useHydrants(layers, !!sel)
  // a house never lists its own object
  const exceptId = selObj?.id ?? (sel?.kind === 'building' ? sel.of ?? null : null)
  // measured from the house that was tapped when there is one (owner, Karte Haus round 1: a row of 21
  // houses is not stood at its catalogue point), else from the selection's point
  const nearAt = hitAt ?? point
  const nearby = useNearby(objects, hydrants, nearAt, exceptId)
  const { shownHyd, onHydrant, hydPoint } = useHydrantShown(sel, hydrants, () => {
    const layerId = hydrantLayer && !hydrantLayer.visible ? hydrantLayer.id : null
    if (layerId) updateLayers((ls) => ls.map((l) => (l.id === layerId ? { ...l, visible: true } : l)))
  })
  const georef = useGeorefPlan(selObj, mapRef, phone, view.zoom)

  // ── taps ──────────────────────────────────────────────────────────────────────────────────
  const tagZoom = view.zoom >= LABEL_MIN_ZOOM
  // Messen / Punkt setzen / Gefahrgut's centre take every tap, on an object too (owner, review
  // round 4 — lib/karte/camera · toolTakesTaps): its dot and tag let the finger through to the map
  const takesTaps = toolTakesTaps(tool, erg.mode)
  const entities = liveVehicles
  /** the building a click would open at `c`: one of a (shown) object's, else a plain one */
  const buildingAt = (c: LngLat): Hover | null => {
    const obj = objectsOn ? objectAt(outlines, c, catOff) : null
    if (obj) return { kind: 'object', id: obj.id, ring: obj.ring }
    const ring = ringAt(ringsNear(c), c)
    return ring ? { kind: 'plain', ring } : null
  }
  const { shownHover, tipRef, watchHover } = useMapHover({ mapRef, rootRef, takesTaps, hydrants: hydrantLayer?.visible ? hydrants : NO_HYDRANTS, buildingAt })
  // ⚠️ A long press on the map drops a pin again (owner, review round 7, 20.10.2026) — but ONLY
  // on free map, and only while no tool is armed (useKartePointer · useMapPress).
  const { pressed, watchPress, swallowClick } = useMapPress({ mapRef, takesTaps, buildingAt, dropPin })
  const onMapClick = (c: LngLat) => {
    if (swallowClick()) return
    if (tool === 'measure') { measure.setPath((pts) => [...pts, c]); return }
    if (tool === 'pin') { dropPin(c); return }
    if (tool === 'erg' && erg.mode !== 'off') { setErg((e) => ({ ...e, center: c, at: new Date() })); return }
    // the phone's search sheet stays until a pick or its ✕ (owner, review round 3): a tap on the
    // map only lets the keyboard go; the tablet's list hung from the bar closes as before
    if (searchOpen && phone) {
      const a = document.activeElement
      if (a instanceof HTMLElement && sheetFieldRef.current === a) { a.blur(); return }
    } else if (searchOpen) { setSearchOpen(false); return }
    // any of an object's buildings opens the object (`objectAt`), and remembers the building when
    // the object has several — the switch's house (variant A). On house level the level sticks
    // while the taps stay on the same object; another object opens at object level.
    const hit = objectsOn ? objectAt(outlines, c, catOff) : null
    if (hit) {
      const house = hit.ring && (outlines.get(hit.id)?.rings.length ?? 0) > 1 ? { at: c, ring: hit.ring } : undefined
      if (house && sel?.kind === 'building' && sel.of === hit.id) selectBuilding(c, house.ring, null, hit.id)
      else selectObject(hit.id, false, 'tap', house)
      return
    }
    const ring = ringAt(ringsNear(c), c)
    if (ring) { selectBuilding(c, ring); return }
    if (sel) { giveCameraBack(); deselect() }
  }
  const onEntity = (e: Entity) => {
    if (tool === 'measure') measure.setPath((pts) => [...pts, e.coord])
  }

  // ── the hover label, and what the map draws ───────────────────────────────────────────────
  const litHydrant = shownHover?.kind === 'hydrant' ? shownHover.id : shownHyd?.id ?? null
  /** the selected place as the hydrant label says it («… von Storchenweg 4») */
  const placeName = hitStreet ?? selObj?.name
    ?? (sel?.kind === 'building' ? splitAddress(register.info?.address ?? sel.address)[0] || C.building : sel?.kind === 'pin' ? C.pin : null)
  let tip: ReactNode = null
  if (shownHover?.kind === 'object') {
    const o = byId.get(shownHover.id)
    if (o) tip = <><span className={s.eyebrow}>{C.kind[o.kind]}</span><b>{o.name}</b></>
  } else if (shownHover?.kind === 'hydrant') {
    const h = hydrants.find((x) => x.id === shownHover.id)
    tip = h && nearAt && placeName
      ? <><span className={s.eyebrow}>{C.nearHydrant}</span><b>{fillTemplate(C.hydrantFrom, { m: fmtDistance(haversineM(nearAt, h.coord)), dir: C.compass[compass8(nearAt, h.coord)], place: placeName })}</b></>
      : <b>{C.nearHydrant}</b>
  }
  /** what the mouse is over OR what the finger is holding (owner, review round 7, point 7): ONE
   *  outline, so «this is what you are about to open» looks the same whichever hand lit it. Only
   *  the label beside the cursor stays the mouse's — a finger covers the spot it would stand on. */
  const outlined = shownHover ?? pressed
  const mapOverlays = useKarteOverlays({ outlines, cats, catOff, sel, selObj, ringsNear, tool, erg, uncached, under: viewer.under, underOn, outlined, hydPoint, nearAt })
  useFrameHydrant(mapRef, rootRef, { hydId: shownHyd?.id ?? null, hydPoint, from: nearAt, phone })

  // ── actions from the panel ────────────────────────────────────────────────────────────────
  /** «Objektbesuch» (the chooser) or «Melden» (`checklist` = the station's Fehlermeldung, asked
   *  for up front — objectVisits/NewVisit falls back to the chooser where there is none) */
  const startVisit = (checklist?: string) => {
    if (!sel) return
    if (sel.kind === 'object') { onOpenVisits(objectVisitHref(sel.id, checklist)); return }
    if (sel.kind === 'building') {
      const address = register.info?.address ?? sel.address
      const street = splitAddress(address)[0]
      onOpenVisits(placeVisitHref({ at: sel.at, label: street || C.building, address, checklist }))
      return
    }
    onOpenVisits(placeVisitHref({
      at: sel.at,
      label: pinNearHit ? fillTemplate(C.pinLabelNear, { a: pinNearHit.label }) : C.pin,
      address: pinNearHit && pinHit?.hit ? normAddress(pinHit.hit.label) : null,
      checklist,
    }))
  }
  const copyCoords = () => {
    if (sel?.kind !== 'pin') return
    const text = `LV95 ${fmtLV95(sel.at[0], sel.at[1])} · WGS84 ${fmtWGS(sel.at[0], sel.at[1])}`
    void navigator.clipboard?.writeText(text).then(() => toast(C.copied, { icon: 'check' })).catch(() => {})
  }

  const ebenen = useKarteEbenen({ viewer, categories, georef, selObj, weather })
  const viewsApi = useCompassViews(mapRef, objects, view, C.compassHoldHint)

  // ── chrome ────────────────────────────────────────────────────────────────────────────────
  // the running chip (owner's pick 6A, sweep F.2): it names the first REAL Einsatz — an Übung only
  // when nothing but Übungen runs — and ONE «+N» counts every other open one, Einsätze and Übungen
  // together. The name opens that Einsatz (the whole chip is its target, chevron included); «+N»
  // opens the menu, which lists them all. Red for an Einsatz, amber when the one it names is an
  // Übung. In the bar on both devices; a phone's Checkliste, whose bar holds the library's search
  // field, keeps it as a strip under the bar.
  const live = running.find((i) => !i.is_exercise) ?? running[0] ?? null
  const more = live ? running.length - 1 : 0
  const runningChip = live && (
    <div className={cx(s.running, live.is_exercise && s.runningExercise, phone && !onLibrary && s.inBar)} data-karte-running-chip="">
      <button type="button" className={s.runningOpen} onClick={() => onOpenIncident(live)} aria-label={fillTemplate(C.runningOpen, { t: live.title })}>
        <span className={s.pulse} aria-hidden />
        <span className={s.runningText}><b>{live.title}</b>{live.address && <small>{live.address.split(',')[0]}</small>}</span>
      </button>
      {more > 0 && (
        <button type="button" className={s.runningMore} onClick={() => { setSheetOpen(true); setSearchOpen(false) }}
          aria-label={fillTemplate(C.runningMore, { n: more })} aria-haspopup="dialog" aria-expanded={sheetOpen} data-karte-running-more="">
          <span>+{more}</span>
        </button>
      )}
      <Icon id="chevron" className={s.runningChev} />
    </div>
  )
  const panelSel: PanelSel | null = !sel ? null
    : sel.kind === 'object' ? (selObj ? { kind: 'object', obj: selObj } : null)
      : sel.kind === 'building' ? { kind: 'building', at: sel.at, address: sel.address, partOf: sel.of ? byId.get(sel.of)?.name ?? null : null }
        : {
          kind: 'pin', at: sel.at, near: pinNearHit, onBuilding: !!ringAt(ringsNear(sel.at), sel.at),
          nearState: !online && !pinHit ? 'offline' : !pinHit ? 'loading' : pinNearHit ? 'ok' : 'none',
        }
  // the switch «Objekt | <Haus>»: after a tap that hit one of an object's buildings, on both levels
  const levelObj = sel?.kind === 'object' && sel.hit ? selObj : sel?.kind === 'building' && sel.of ? byId.get(sel.of) ?? null : null
  const level: PanelLevel | null = levelObj && sel ? {
    on: sel.kind === 'object' ? 'object' : 'house',
    house: sel.kind === 'object' ? hitStreet : splitAddress(register.info?.address ?? null)[0] || null,
    onPick: toLevel,
  } : null
  const onMapSurface = !openDoc && !onLibrary
  // Punkt setzen / Messen / Gefahrgut's centre take the map's taps: the toasts give way to the top
  // lane meanwhile (lib/toastLane · usePlacementLane; owner, Karte Haus round 3: «the toasts
  // sometimes block … the point placement thing»)
  usePlacementLane(onMapSurface && (tool === 'pin' || tool === 'measure' || tool === 'erg'))
  // Punkt setzen's instruction stands at the foot of the map, where Messen's does (MeasurePanel ·
  // MapHint; owner 20.10.2026: at the top of the screen it was «a bit unnatural») — and since
  // review round 7 in the very card the Messen dock's ⓘ opens, not a quieter look-alike beside it.
  // The missing-catalogue notice is a MESSAGE: a sticky toast in the lane with the others.
  const pinHint = onMapSurface && tool === 'pin'
  const catNote = cat?.failed && !cat.data && !onLibrary ? (online ? C.loadFailed : C.noCatalogue) : null
  useEffect(() => {
    if (!catNote) return
    const id = toast(catNote, { sticky: true, icon: 'warn' })
    return () => dismissToast(id)
  }, [catNote])
  /** the panel is on screen: on the map, not under Messen, and on a phone not under a tool's own
   *  card nor pushed away */
  const panelShown = onMapSurface && !!panelSel && tool !== 'measure' && !(phone && (tool === 'erg' || tool === 'layers' || sheetShut || searchOpen))
  useFrameOnReturn(mapRef, { openDoc, sel, at: point, panelShown, phone })
  // the tablet's left rail is always there (owner, 19.10.2026): Karte · Checkliste, then the plans
  const railShown = !phone
  const tabletTools = [
    { id: 'pin', icon: 'pin', label: C.tools.pin },
    { id: 'measure', icon: 'measure', label: C.tools.measure },
    { id: 'erg', icon: 'warn', label: C.tools.erg },
  ]
  const approxAt = sel?.kind === 'object' && selObj && !coordOf(selObj) ? sel.approxAt ?? null : null

  // ── which objects carry their name tag (lib/karte/labels) ─────────────────────────────────
  const selId = selObj?.id ?? null
  const covered = `${!!panelSel}|${sheetShut}|${tool}|${searchOpen}|${sheetOpen}|${!!openDoc}|${onLibrary}|${railShown}`
  const { measureRef, fits, tagged } = useTagPlacement({ mapRef, rootRef, view, objects, selId, objectsOn, covered, phone, catOff })

  return (
    <>
      <div data-karte="" ref={rootRef} className={cx('app mode-map', s.root, phone && s.phone, phone && 'phone-tools', onLibrary && s.onLibrary)}>
        <IconSprite />
        {/* the name tag's off-screen twin: what a tag measures before it is placed */}
        <span ref={measureRef} className={cx(s.tagMk, s.measure)} aria-hidden />
        {tip && <div ref={tipRef} className={s.hoverTip} role="tooltip" data-karte-hover="">{tip}</div>}
        <MapView
          ref={mapRef}
          entities={entities}
          layers={layers}
          byName={sym.byName}
          captionMode="off"
          initialCenter={start.center}
          initialZoom={start.zoom}
          initialBearing={start.view?.bearing ?? 0}
          showOrigin={false}
          // never past the visible base's last sharp level (owner on #383) — the Karte only
          zoomCapAtBase
          preparedOverlays={mapOverlays}
          isVisible={viewer.isVisible}
          onSelect={onEntity}
          onMapClick={onMapClick}
          readOnly
          placing={tool !== null}
          // one finger still zooms with a sheet like Ebenen up; Punkt setzen and Gefahrgut's centre
          // place on a tap, so there only the pinch does (lib/tapDragZoom · oneFingerZoom)
          tapsPlace={takesTaps}
          onView={(v) => { setView(v); loadOutlines() }}
          onSettled={() => { setMapUp(true); flyPending(); loadOutlines(); watchUserMoves(); watchHover(); watchPress() }}
          measurePoints={tool === 'measure' ? measure.path : []}
          measureKind={tool === 'measure' ? measure.mode : null}
          measureLabels={measure.labels}
          onMeasureDrag={(i, c) => measure.setPath((pts) => pts.map((p, j) => (j === i ? c : p)))}
          onMeasureInsert={(i, c) => measure.setPath((pts) => { const next = [...pts]; next.splice(i, 0, c); return next })}
          onMeasureDelete={(i) => measure.setPath((pts) => pts.filter((_, j) => j !== i))}
          georefPlanRasters={georef.georefRasters}
          weatherRadar={weather.mapRadar}
          onBasemapUnavailable={onBasemapUnavailable}
        >
          {/* every object: a dot, or its name tag where the tag fits (lib/karte/labels) — the
              outline carries the object, the tag only names it */}
          {objectsOn && objects.map((o) => {
            const at = coordOf(o)
            if (!at) return null
            // a tap tool armed: the marker lets taps through (`.through`); one that reaches it anyway
            // (a keyboard) is the tool's, at the object's point — never a selection
            const pick = (e: React.MouseEvent) => { e.stopPropagation(); if (takesTaps) onMapClick(at); else selectObject(o.id, false) }
            const isSel = selObj?.id === o.id
            if (catOff(o.id) && !isSel) return null
            // the category's colour (lib/karte/categories); none = the default `--obj-plans`, untouched,
            // and so is an `ink` category (color null) — it only keeps its Ebenen row
            const cat = cats.get(o.id)
            const hue = cat?.color
            const catStyle = hue ? ({ '--cat': hue, '--cat-ink': inkOn(hue) } as React.CSSProperties) : undefined
            // without categories, «has plans» is `--obj-plans`; an object without any is drawn quieter
            const bare = !o.plans.length
            if (!isSel && !(tagZoom && tagged?.has(o.id))) {
              return (
                <Marker key={`dot:${o.id}`} longitude={at[0]} latitude={at[1]} anchor="center" style={{ zIndex: 1, pointerEvents: takesTaps ? 'none' : undefined }}>
                  <button type="button" ref={arriveRef(o.id)} className={cx(s.dotMk, hue && s.cat, !cat && bare && s.bare, takesTaps && s.through, !mapUp && s.waiting)} style={catStyle} aria-label={o.name} title={o.name} onClick={pick} />
                </Marker>
              )
            }
            // the tag takes the dot's place, on the point; the name only, no plan count (owner R3)
            const dx = (!isSel && tagged?.get(o.id)) || 0
            // a folded name: the box of its widest line, not of the 280px cap (the placement pass's `fits`)
            const fit = fits.get(o.name)
            return (
              <Marker key={`tag:${o.id}`} longitude={at[0]} latitude={at[1]} anchor="center" offset={[dx, 0]} style={{ zIndex: isSel ? 3 : 2, pointerEvents: takesTaps ? 'none' : undefined }}>
                <button type="button" ref={arriveRef(o.id)} className={cx(s.tagMk, isSel && s.sel, hue && s.cat, !cat && bare && s.bare, takesTaps && s.through, !mapUp && s.waiting)} style={fit ? { ...catStyle, width: fit } : catStyle} onClick={pick}>
                  {tagText(o.name)}
                </button>
              </Marker>
            )
          })}
          {approxAt && selObj && (
            <Marker longitude={approxAt[0]} latitude={approxAt[1]} anchor="center">
              <span className={cx(s.tagMk, s.approx, s.sel)}>{C.approxTag} · {selObj.name}</span>
            </Marker>
          )}
          {/* the hydrant shown from In der Nähe: a ring on it, its metres at the dashed line's middle */}
          {hydPoint && nearAt && (
            <>
              <Marker longitude={hydPoint.coord[0]} latitude={hydPoint.coord[1]} anchor="center" style={{ zIndex: 4, pointerEvents: 'none' }}>
                <span className={s.hydRing} data-karte-hydrant-ring="" />
              </Marker>
              <Marker longitude={(nearAt[0] + hydPoint.coord[0]) / 2} latitude={(nearAt[1] + hydPoint.coord[1]) / 2} anchor="center" style={{ zIndex: 4, pointerEvents: 'none' }}>
                <span className={s.hydDist}>{fmtDistance(haversineM(nearAt, hydPoint.coord))}</span>
              </Marker>
            </>
          )}
          {sel?.kind === 'pin' && (
            // the pin is the place: a tap on it brings its sheet back to the front (closing the sheet
            // takes the pin away – closePanel)
            <Marker longitude={sel.at[0]} latitude={sel.at[1]} anchor="bottom" onClick={(e) => { e.originalEvent.stopPropagation(); setSheetShut(false) }}>
              <MapPin className={s.pinMk} />
            </Marker>
          )}
        </MapView>

        {openDoc && selObj && (
          <KarteSurface
            obj={selObj} doc={openDoc} phone={phone} sym={sym}
            offline={!online} held={openHeld} gebaeude={avail?.gebaeude ?? null}
            onMap={() => setSurface(null)}
          />
        )}

        {/* the Checkliste: the Einsatz surfaces' frame (Surface.module.css · .shell — under the bar,
            beside the rail, above the phone's bar, below the Meldeleiste and the keyboard); the
            library fills it. The map stays mounted behind, for the way back. */}
        {onLibrary && (
          <div className={cx(s.library, phone && live && s.belowStrip)} data-karte-library-surface="">
            <ChecklistLibrary query={libQuery} />
          </div>
        )}

        {/* the bar: NO title (owner, 16.10.2026) — the menu · search · weather · the running Einsatz */}
        <div className="topbar" ref={barRef}>
          {/* the menu button (owner, review round 5: «not "Einsätze" as the main top button» → the
              station's short name and/or mark, ▾; neither configured → the menu symbol). The red dot
              is the old count: an Einsatz running or an alarm waiting; the number is in its name. */}
          <button type="button" className={cx('ip-switch-btn', s.einsaetze)} onClick={() => { setSheetOpen((o) => !o); setSearchOpen(false) }}
            title={C.menu} aria-label={einsaetze.badge > 0 ? `${menuName}, ${fillTemplate(C.einsaetzeBadge, { n: einsaetze.badge })}` : menuName}
            aria-haspopup="dialog" aria-expanded={sheetOpen} data-karte-menu="">
            {/* the face – mark and/or name – carries the red dot on its corner: the quiet pill has no
                frame of its own to pin it to (28.10.2026) */}
            <span className={s.menuFace}>
              {mark ? <img className={s.menuMark} src={mark} alt="" onError={onMarkError} />
                : !menuShort && <Icon id="menu" />}
              {menuShort && <span className={s.menuName}>{menuShort}</span>}
              {einsaetze.badge > 0 && <span className={s.einsaetzeBadge} data-karte-menu-dot="" aria-hidden />}
            </span>
            {/* `chev` = the app's shared flip on [aria-expanded=true] (02-base.css), as every other dropdown */}
            <Icon id="chevron-down" className={cx('chev', s.chev)} />
          </button>
          {/* the Checkliste: the bar's field searches the library (on a phone too, inline — the map's
              round search button is the map's) */}
          {onLibrary ? (
            <SearchField
              {...typingFieldProps('search', 'karte-checkliste')}
              key="library"
              className={cx(s.search, phone && s.libSearch)}
              value={libQuery}
              onChange={setLibQuery}
              onTouchEnd={phone ? noPanTouchEnd : undefined}
              onKeyDown={(e) => { if (e.key === 'Enter') e.currentTarget.blur() }}
              placeholder={defuseAutofill(appConfig.copy.checklists.searchPlaceholder)}
              aria-label={defuseAutofill(appConfig.copy.checklists.searchAria)}
            />
          ) : !phone && (
            <SearchField
              {...typingFieldProps('search', 'karte')}
              key="map"
              className={s.search}
              value={query}
              onChange={(v) => { setQuery(v); setSearchOpen(true) }}
              onFocus={() => setSearchOpen(true)}
              onKeyDown={(e) => { if (e.key === 'Escape') setSearchOpen(false) }}
              placeholder={defuseAutofill(C.searchPlaceholder)}
              aria-label={defuseAutofill(C.searchPlaceholder)}
            />
          )}
          {/* offline: the chip stands where the weather was and opens «Auf diesem Gerät» */}
          {!online ? (
            <button type="button" className={cx('ip-offline-chip', s.offChip)} onClick={() => setDeviceOpen(true)} title={C.offlineChipTitle} aria-label={C.offlineChipTitle}>
              <span className={s.offDot} aria-hidden />{!phone && C.offlineChip}
            </button>
          ) : !phone && liveWeather.data?.wind_dir_deg != null && <WeatherBadge weather={liveWeather.data} bearing={view.bearing} />}
          {(!phone || !onLibrary) && runningChip}
          {phone && !onLibrary && (
            <button type="button" className={cx('ip-switch-btn', s.searchBtn)} onClick={() => (searchOpen ? setSearchOpen(false) : openPhoneSearch())}
              aria-label={C.searchOpen} title={C.searchOpen} aria-expanded={searchOpen} data-karte-search-open="">
              <Icon id="search" />
            </button>
          )}
          {/* the app menu, hung off the bar as the Einsatz menu hangs off its own (13-incident ·
              .ip-menu) — the same rows (panels/AppMenuRows), without the Einsatz card */}
          {sheetOpen && (
            <div className="ip-menu ip-einsaetze" role="dialog" aria-label={C.menu}>
              {einsaetze.render(closeSheet, openDevice)}
            </div>
          )}
        </div>
        {/* a phone's Checkliste: the bar holds the library's field, so the chip is a strip under it,
            where the «Einsätze» sheet hangs — and the sheet lists the same Einsatz */}
        {phone && onLibrary && live && !sheetOpen && <div className={s.runningStrip} data-karte-running="">{runningChip}</div>}
        {/* «Alarm auf diesem Gerät» (3am sweep §1): the nudge under the bar — never while an Einsatz
            runs on this device, never under the menu or the search, nothing at all when green */}
        {!live && !sheetOpen && !searchOpen && !onLibrary && <AlarmNudgeCard inIncident={running.length > 0} phone={phone} />}

        {searchOpen && !phone && !onLibrary && (
          <KarteSearch query={query} hits={search.hits} nearest={search.nearest} addresses={search.addresses} addrState={search.addrState}
            onPickObject={(id) => { setQuery(byId.get(id)?.name ?? ''); selectObject(id, true, 'search') }} onPickAddress={pickAddress} />
        )}
        {searchOpen && phone && !onLibrary && (
          <KarteKeySheet
            fill
            label={C.searchOpen}
            onClose={() => setSearchOpen(false)}
            field={(
              <SearchField
                {...typingFieldProps('search', 'karte')}
                ref={sheetFieldRef} className={s.keyField} noClear value={query}
                // the keyboard back with a tap on the field: focused without Safari's scroll to it,
                // as Gefahrgut's field (review round 5: that pan moved the whole sheet)
                onChange={setQuery} onTouchEnd={noPanTouchEnd}
                onKeyDown={(e) => { if (e.key === 'Escape') setSearchOpen(false); else if (e.key === 'Enter') e.currentTarget.blur() }}
                placeholder={defuseAutofill(C.searchPlaceholder)}
                aria-label={defuseAutofill(C.searchPlaceholder)}
              />
            )}
          >
            <KarteSearch inSheet query={query} hits={search.hits} nearest={search.nearest} addresses={search.addresses} addrState={search.addrState}
              onPickObject={(id) => { setQuery(byId.get(id)?.name ?? ''); selectObject(id, true, 'search') }} onPickAddress={pickAddress} />
          </KarteKeySheet>
        )}

        {railShown && (
          <KarteNavRail obj={selObj} docs={docs} active={onLibrary ? 'library' : openDoc ? { doc: openDoc.doc.id } : 'map'}
            onMap={() => setSurface(null)} onLibrary={openLibrary} onDoc={(id) => { setSurface(id); setToolState(null) }}
            notHeld={!online ? new Set(docs.filter((d) => docHeld(d) === false).map((d) => d.doc.id)) : null} />
        )}

        {panelShown && panelSel && (
          <KartePanel
            sel={panelSel}
            register={register}
            nearby={nearby}
            litHydrant={litHydrant}
            onHydrant={onHydrant}
            level={level}
            visits={visitsState}
            canCapture={canCapture}
            docs={docs}
            offline={!online}
            avail={avail}
            sheet={phone}
            withRail={railShown}
            onClose={closePanel}
            onStartVisit={() => startVisit()}
            onReport={() => startVisit(REPORT_CHECKLIST)}
            onOpenDoc={(id) => { setSurface(id); setToolState(null) }}
            onSelectObject={(id) => selectObject(id)}
            onRetryRegister={retryRegister}
            // `from=karte`: the visit's «Zurück» lands here again, not on the Objektbesuche list
            onOpenVisit={(id) => onOpenVisits(`${ovHref({ kind: 'visit', id })}?from=karte`)}
            onPinBuilding={() => { if (sel?.kind === 'pin') selectBuilding(sel.at, ringAt(ringsNear(sel.at), sel.at)) }}
            onCopyCoords={copyCoords}
          />
        )}

        {/* the tablet's tools: the Einsatz's right rail, with the viewer's three reference tools */}
        {!phone && onMapSurface && (
          <ToolRail
            className="tool-rail"
            primary={{ id: '__none', icon: 'plus', label: '' }}
            tools={tabletTools}
            hotkeys={false} // the viewer has no keyboard layer: no letters on Pin · Messen · ERG
            active={tool === 'layers' ? '' : tool ?? ''}
            onPick={(id) => setTool(id as Tool)}
            footer={(
              <>
                <button className={cx('vrail-nbtn vrail-layers', tool === 'layers' && 'on')} title={C.tools.layers} aria-label={C.tools.layers} aria-pressed={tool === 'layers'} onClick={() => setTool('layers')}>
                  <span className="vrail-glyph"><Icon id="layers" /></span><span className="vrail-label">{C.tools.layers}</span>
                </button>
                <MapViewsButton api={viewsApi} bearing={view.bearing} readOnly variant="rail" btnClassName="vrail-nbtn vrail-views" activeClassName="on" glyphClassName="vrail-compass"
                  label={appConfig.copy.mapViews.title} open={viewsOpen} onOpenChange={(o) => { setViewsOpen(o); if (o && tool === 'layers') setToolState(null) }} />
              </>
            )}
          />
        )}

        {/* the phone: Karte · Checkliste │ Messen · Gefahrgut · Ebenen at the foot (owner, 19.10.2026 ·
            variant A — the bar never changes: a tool tapped on the Checkliste goes back to the Karte
            with it armed, setTool), pin + compass above it on the map. No «Pläne» tab (owner,
            17.10.2026): an object's plans are rows in its sheet, and an open plan goes back with its
            «Zur Karte» chip or the Karte tab */}
        {phone && (
          <>
            <nav className="navrail rail folded labelled" aria-label={C.title}>
              <div className="rail-scroll-wrap"><div className="nav-scroll rail-scroll">
                <button type="button" className={cx('nav-item', onMapSurface && !tool && 'on')} onClick={() => { setSurface(null); setToolState(null) }}>
                  <span className="nav-glyph"><Icon id="map" /></span><span className="nav-label">{C.tools.map}</span>
                </button>
                <button type="button" className={cx('nav-item', onLibrary && 'on')} aria-pressed={onLibrary} onClick={openLibrary} data-karte-library="">
                  <span className="nav-glyph"><Icon id="checklist" /></span><span className="nav-label">{appConfig.copy.modes.checklists}</span>
                </button>
                {/* the surfaces │ the map's tools */}
                <div className={cx('nav-sep', s.barSep)} aria-hidden />
                {(['measure', 'erg', 'layers'] as const).map((t) => (
                  <button key={t} type="button" className={cx('nav-item', tool === t && 'on')} aria-pressed={tool === t} onClick={() => openPhoneTool(t)}>
                    <span className="nav-glyph"><Icon id={t === 'erg' ? 'warn' : t} /></span><span className="nav-label">{C.tools[t]}</span>
                  </button>
                ))}
              </div></div>
            </nav>
            {onMapSurface && !tool && !panelShown && !searchOpen && (
              <div className={s.phoneUtil}>
                <button type="button" className={cx(s.utilBtn)} aria-label={C.tools.pin} onClick={() => setTool('pin')}><Icon id="pin" /></button>
                <MapViewsButton api={viewsApi} bearing={view.bearing} readOnly variant="util" btnClassName={s.utilBtn} glyphClassName={s.utilGlyph}
                  open={viewsOpen} onOpenChange={setViewsOpen} />
              </div>
            )}
          </>
        )}

        {tool === 'measure' && (
          <>
            {/* no armed-tool pill here, on any size (sweep 30.10.2026 #3): the results panel
                stands in its spot at the bottom centre and the pill covered its numbers */}
            <ToolDock groups={[
              [{ type: 'close', onClick: () => setTool('measure') }],
              [
                { type: 'toggle', icon: 'measure', label: appConfig.copy.measure.modeLine, on: measure.mode === 'line', onClick: () => measure.setMode('line') },
                { type: 'toggle', icon: 'area', label: appConfig.copy.measure.modeArea, on: measure.mode === 'area', onClick: () => measure.setMode('area') },
              ],
              [{ type: 'action', icon: 'trash', label: appConfig.copy.measure.clear, disabled: !measure.path.length, onClick: () => measure.setPath(() => []) }],
              [{ type: 'info', text: appConfig.copy.dockHints.measure }],
            ]} />
            {/* temporary by construction: no «Als Linie/Fläche übernehmen» (no onAdopt) — and no
                line saying so either (owner-6): nothing on this surface is ever saved */}
            <MeasurePanel mode={measure.mode} coords={measure.path} profile={measure.profile} profileLoading={measure.loading} className={s.measurePanel} />
          </>
        )}
        {pinHint && <MapHint>{C.pinHint}</MapHint>}

        {tool === 'erg' && (
          <KarteGefahrgut
            un={erg.un} onUn={(un) => setErg((e) => ({ ...e, un, center: e.center ?? selPoint(sel, byId) ?? view.center, at: new Date() }))}
            mode={erg.mode} onMode={(mode) => setErg((e) => ({ ...e, mode, at: new Date() }))}
            center={erg.center} onClose={() => setTool('erg')} phone={phone} focusOnOpen={phone && ergKeys}
          />
        )}

        {tool === 'layers' && (
          <LayerPanel
            layers={layers}
            onToggle={ebenen.toggleLayer}
            onOpacity={ebenen.setOpacity}
            twins={ebenen.twins}
            // «Station» first (owner, review round 4: «it's the most relevant one in this case»)
            leadTwinGroups={[C.layerGroupStation]}
            weather={weather.row}
            onShowAll={() => ebenen.quickTap('all')}
            onHideAll={() => ebenen.quickTap('none')}
            onReset={() => ebenen.quickTap('standard')}
            preset={ebenen.layersPreset}
            note={C.layersOwn}
            onClose={() => setTool('layers')}
          />
        )}

        {weather.on && weather.layer && weather.radarOn && onMapSurface && !panelShown && (
          <div className="wb-botleft wx-row">
            <Suspense fallback={null}>
              <WeatherRadarControls radar={weather.radar} frameIndex={weather.playback.frameIndex}
                playing={weather.playback.playing} onPick={weather.playback.pick}
                onTogglePlaying={weather.playback.togglePlaying} stale={weather.radarStale} now={weather.now} />
            </Suspense>
          </div>
        )}

        {noBasemap && !online && (
          <NoBasemapMeldung sub={C.basemapSub} actionLabel={C.basemapAction}
            onOpenOffline={() => { setNoBasemap(false); setDeviceOpen(true) }} onDismiss={() => setNoBasemap(false)} />
        )}
        {/* «Neue Version bereit» — the Einsatz's own row (UpdateBanner), in the same strip: the Karte
            is home with no Einsatz open, and a covered Einsatz behind it paints no rows of its own
            but the alarms (review round 7) */}
        <UpdateBanner />
        {deviceOpen && (
          <KarteDevice offline={!online} objects={objects} map={coverage === 'far' ? 'far' : coverage ? { held: coverage.held, total: coverage.total } : null} onClose={() => setDeviceOpen(false)} />
        )}
      </div>
    </>
  )
}
