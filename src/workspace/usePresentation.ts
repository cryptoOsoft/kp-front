// The Präsentationsmodus on this device (docs/presentation.md): follows the presentation running
// on the Einsatz, presents, follows, points – and keeps all of it out of the record.
//
// · The follow is a third live long poll beside the workspace and the Verlauf (lib/useLongPoll ·
//   api/presentation · pollPresentation). It also counts as this device's presence: the server
//   ends a presentation whose presenter stops polling (backend app/presentation).
// · Presenting sends the surface and section (`view`), throttled (`VIEW_MS`, leading + trailing);
//   following applies each view (`applyView`) and notices a hand-made pan or surface switch,
//   which detaches («Wieder folgen»).
// · «Zeigen» makes one-finger taps pointers (lib/useZeigen). A pointer is drawn here at once and
//   sent; everybody else's arrive with the poll and fade (lib/presentation · RING_MS).
// · Offline or unreachable: there is no presentation on this device (no pill, no rings) and
//   nothing is queued – a pointer from a minute ago means nothing.
//
// `IncidentWorkspace` calls this once and hands the result to the pill (PresentationLayer), the
// Plan (`board`, via PlansSurface → Whiteboard) and the «Einsatz teilen» sheet
// (PresentationContext → ShareIncident's «Präsentieren» card).

import { createContext, useCallback, useEffect, useMemo, useReducer, useRef, useState, type RefObject } from 'react'
import type { MapRef } from 'react-map-gl/maplibre'
import { appConfig } from '../config/appConfig'
import { ApiError } from '../lib/api'
import { endPresentation, pollPresentation, sendPresentationSignal, startPresentation, type PresentationSignal } from '../lib/api/presentation'
import { newId } from '../lib/ids'
import {
  addRing, isJoined, liveRings, nextFollow, NOT_PRESENTING, ringsOn, RING_MS, throttle,
  type PointerAt, type PresentationState, type PresentedView, type Ring,
} from '../lib/presentation'
import { prefersReducedMotion } from '../lib/reducedMotion'
import { pickedTafelPage, setTafelPage, TAFEL_ID, useTafelPage } from '../lib/tafelPages'
import { toast } from '../lib/ui'
import { useLongPoll } from '../lib/useLongPoll'
import { useOnline } from '../lib/useOnline'
import { useZeigen } from '../lib/useZeigen'
import type { WorkspaceMode } from './types'

/** This page load's id in every presentation – one login is routinely open on three tablets. */
const CLIENT = newId('pc')
/** The presenter's view goes at most this often (ms); the server's own floor is 100 ms. */
const VIEW_MS = 150
/** A follower eases to each view this long, so a stream of views reads as one movement. */
const EASE_MS = 300
/** A link holder's own name for the others' screens – a device flag, never synced. */
const NAME_KEY = 'kp-front-present-name'

export interface PlanFocusRequest { x: number; y: number; floor: number; scale?: number; nonce: number }
/** The plan section a Whiteboard reports (its `onView`): centre in plan space, storey, zoom. */
export interface PlanSection { x: number; y: number; floor: number; scale: number }

/** What the Whiteboard needs to take part (Whiteboard · `presentation`). */
export interface BoardPresentation {
  /** the rings standing on this plan (and Tafel page) */
  rings: Ring[]
  presenter: string | null
  /** «Zeigen» is on: one-finger taps are pointers */
  pointing: boolean
  onPoint: (p: { x: number; y: number; floor: number }) => void
  /** set while following: a pan by hand detaches */
  onUserMove?: () => void
  onView: (s: PlanSection) => void
}

/** What the pill shows of a poll's answer – a new answer with the same key is not a re-render. */
const roomKey = (s: PresentationState) =>
  `${s.active ? s.id : ''}|${s.presenter?.client ?? ''}|${s.presenter?.name ?? ''}|${s.participants.map((p) => `${p.client}:${p.name}`).join(',')}`

export function storedPresentName(): string {
  try { return localStorage.getItem(NAME_KEY) ?? '' } catch { return '' }
}
function storePresentName(name: string) {
  try { localStorage.setItem(NAME_KEY, name) } catch { /* private mode: asked again next time */ }
}

export function usePresentation({ incidentId, enabled, canPresent, isLink, mode, setMode, activePlanId, setActivePlanId, mapRef, setPlanFocus }: {
  incidentId: string
  /** the feature runs at all: a running Einsatz, no Wiedergabe, not the Atemschutz-Link page */
  enabled: boolean
  /** this session may start one (a logged-in editor) */
  canPresent: boolean
  /** a link session: its name is its own to give (asked once per device) */
  isLink: boolean
  mode: WorkspaceMode
  setMode: (m: WorkspaceMode) => void
  activePlanId: string
  setActivePlanId: (id: string) => void
  mapRef: RefObject<MapRef | null>
  setPlanFocus: (f: PlanFocusRequest) => void
}) {
  const online = useOnline()
  const [snap, setSnap] = useState<PresentationState | null>(null)
  const [reachable, setReachable] = useState(true)
  const [follow, dispatch] = useReducer(nextFollow, NOT_PRESENTING)
  const [rings, setRings] = useState<Ring[]>([])
  const [zeigen, setZeigen] = useState(false)
  const [tafelPage] = useTafelPage(incidentId)

  // what the poll and the async callbacks read without re-arming anything
  const known = useRef('')
  const seq = useRef(0)
  const followRef = useRef(follow)
  const modeRef = useRef(mode)
  const planRef = useRef(activePlanId)
  const planSection = useRef<PlanSection | null>(null)
  const joinedId = useRef<string | null>(null)
  const expected = useRef<{ mode: string; planId: string | null; page: string | null } | null>(null)
  /** the presenter's newest view, for «Folgen» / «Wieder folgen» */
  const latestView = useRef<PresentedView | null>(null)
  useEffect(() => { followRef.current = follow }, [follow])
  useEffect(() => { modeRef.current = mode; planRef.current = activePlanId }, [mode, activePlanId])

  const signal = useCallback((s: Omit<PresentationSignal, 'client' | 'presentation'>) => {
    const id = known.current
    if (!id) return Promise.resolve()
    return sendPresentationSignal(incidentId, { ...s, presentation: id, client: CLIENT }).catch((e: unknown) => {
      // A join the room refused is SAID, never swallowed (review 06.11.2026): the pill would
      // read «Folgst» on a device that is in nobody's room. A full room (the links' share of it)
      // sends the device back to «Folgen» with a line saying why; everything else – ended or
      // taken over (409), the link down, a join throttled – the next poll settles.
      if (s.kind === 'join' && e instanceof ApiError && e.code === 'presentation_full') {
        toast(appConfig.copy.presentation.full, { tone: 'warn' })
        dispatch({ type: 'leave' })
      }
    })
  }, [incidentId])

  // --- following: apply a view, notice a hand-made move ------------------------------------
  const focusNonce = useRef(0)
  const applyView = useCallback((v: PresentedView) => {
    expected.current = { mode: v.mode, planId: v.plan_id, page: v.page }
    if (v.mode === 'map') {
      if (modeRef.current !== 'map') setMode('map')
      const m = mapRef.current?.getMap()
      if (v.map && m) m.easeTo({ center: [v.map.lng, v.map.lat], zoom: v.map.zoom, bearing: v.map.bearing, duration: prefersReducedMotion() ? 0 : EASE_MS })
      return
    }
    if (modeRef.current !== 'plans') setMode('plans')
    if (v.plan_id && v.plan_id !== planRef.current) setActivePlanId(v.plan_id)
    if (v.plan_id === TAFEL_ID && v.page) setTafelPage(incidentId, v.page)
    if (v.plan) setPlanFocus({ ...v.plan, nonce: ++focusNonce.current })
  }, [incidentId, mapRef, setActivePlanId, setMode, setPlanFocus])

  // a surface switched by hand while following → detached
  useEffect(() => {
    const want = expected.current
    if (follow.kind !== 'following' || !want) return
    const off = mode !== want.mode
      || (want.mode === 'plans' && want.planId != null && activePlanId !== want.planId)
      || (want.mode === 'plans' && want.planId === TAFEL_ID && want.page != null && tafelPage !== want.page)
    if (off) dispatch({ type: 'moved' })
  }, [follow.kind, mode, activePlanId, tafelPage])

  // a pan / zoom / turn of the Karte by hand (MapLibre gives a programmatic move no originalEvent)
  useEffect(() => {
    const m = mapRef.current?.getMap()
    if (follow.kind !== 'following' || !m) return
    const moved = (e: { originalEvent?: unknown }) => { if (e.originalEvent && modeRef.current === 'map') dispatch({ type: 'moved' }) }
    m.on('movestart', moved)
    return () => { m.off('movestart', moved) }
  }, [follow.kind, mapRef])

  // --- the poll ----------------------------------------------------------------------------
  const live = enabled && online
  const restart = useLongPoll({
    round: async ({ hidden, signal: abort }) => {
      if (!live) return false
      let s: PresentationState
      try {
        s = await pollPresentation(incidentId, { client: CLIENT, known: known.current, since: seq.current, wait: !hidden }, abort)
      } catch {
        if (!abort.aborted) setReachable(false)
        return false
      }
      if (abort.aborted) return true
      setReachable(true)
      const id = s.active ? s.id : null
      const fresh = id && id === known.current ? s.messages.filter((m) => m.seq > seq.current) : s.messages
      known.current = id ?? ''
      seq.current = id ? s.seq : 0
      latestView.current = s.view
      // ⚠️ only when what the pill shows changed: a view or pointer stream is applied imperatively
      // (the map's easeTo, the rings), and a state write per message re-rendered the whole
      // workspace several times a second on every follower
      setSnap((prev) => (prev && roomKey(prev) === roomKey(s) ? prev : s))
      dispatch({ type: 'server', id, mine: !!id && s.presenter?.client === CLIENT })
      const f = followRef.current
      const now = Date.now()
      for (const m of fresh) {
        if (m.kind === 'pointer' && m.client !== CLIENT) {
          const ring: Ring = { key: `${m.client}:${m.seq}`, client: m.client, name: m.name, link: m.link, at: m.at, born: now }
          setRings((r) => addRing(r, ring, now))
        }
      }
      if (f.kind === 'following' && f.id === id && s.view && fresh.some((m) => m.kind === 'view')) applyView(s.view)
      // dropped from the room (a hidden tab outlived its presence): join again
      if (id && isJoined(f) && f.kind !== 'presenting' && joinedId.current === id && !s.participants.some((p) => p.client === CLIENT)) {
        void signal({ kind: 'join', name: isLink ? storedPresentName() : undefined })
      }
      return true
    },
  }, [incidentId, live, applyView, signal, isLink])

  // join when following starts, leave when it stops – one signal per transition
  useEffect(() => {
    const joined = (follow.kind === 'following' || follow.kind === 'detached') ? follow.id : null
    if (joined && joinedId.current !== joined) {
      joinedId.current = joined
      void signal({ kind: 'join', name: isLink ? storedPresentName() : undefined })
    } else if (!joined && joinedId.current) {
      if (known.current === joinedId.current && follow.kind === 'invited') void signal({ kind: 'leave' })
      joinedId.current = null
    }
  }, [follow, isLink, signal])

  // the rings fade on their own
  useEffect(() => {
    if (!rings.length) return
    const t = setTimeout(() => setRings((r) => { const l = liveRings(r, Date.now()); return l.length === r.length ? r : l }), Math.max(50, RING_MS - (Date.now() - Math.min(...rings.map((x) => x.born)))))
    return () => clearTimeout(t)
  }, [rings])

  // --- presenting: send the surface and section --------------------------------------------
  const sender = useRef<ReturnType<typeof throttle<PresentedView>> | null>(null)
  useEffect(() => {
    const t = throttle<PresentedView>(VIEW_MS, (view) => void signal({ kind: 'view', view }))
    sender.current = t
    return () => t.cancel()
  }, [signal])
  const presenting = follow.kind === 'presenting'
  const pushView = useCallback(() => {
    if (followRef.current.kind !== 'presenting') return
    const md = modeRef.current
    if (md === 'map') {
      const m = mapRef.current?.getMap()
      if (!m) return
      const c = m.getCenter()
      sender.current?.push({ mode: 'map', plan_id: null, page: null, plan: null, map: { lng: c.lng, lat: c.lat, zoom: m.getZoom(), bearing: m.getBearing() } })
    } else if (md === 'plans') {
      const planId = planRef.current
      sender.current?.push({ mode: 'plans', plan_id: planId, page: planId === TAFEL_ID ? pickedTafelPage(incidentId) : null, map: null, plan: planSection.current })
    }
    // any other surface (Atemschutz, Checklisten …) is not presented: the room stays where it was
  }, [incidentId, mapRef])
  useEffect(() => { if (presenting) pushView() }, [presenting, mode, activePlanId, tafelPage, pushView])
  useEffect(() => {
    const m = mapRef.current?.getMap()
    if (!presenting || !m) return
    const moved = () => { if (modeRef.current === 'map') pushView() }
    m.on('move', moved)
    return () => { m.off('move', moved) }
  }, [presenting, mapRef, pushView])

  // --- actions -----------------------------------------------------------------------------
  const C = appConfig.copy.presentation
  const start = useCallback(async () => {
    try {
      const s = await startPresentation(incidentId, CLIENT)
      setZeigen(false)
      known.current = s.id ?? ''
      seq.current = s.seq
      latestView.current = s.view
      setSnap(s)
      dispatch({ type: 'server', id: s.id, mine: true })
      restart(0)
    } catch {
      toast(C.startFailed, { tone: 'warn' })
    }
  }, [incidentId, restart, C])
  const end = useCallback(async () => {
    sender.current?.cancel()
    try {
      await endPresentation(incidentId)
      known.current = ''
      seq.current = 0
      latestView.current = null
      setSnap(null)
      dispatch({ type: 'server', id: null, mine: false })
      restart(0)
    } catch {
      toast(C.endFailed, { tone: 'warn' })
    }
  }, [incidentId, restart, C])
  const followNow = useCallback((name?: string) => {
    if (name !== undefined) storePresentName(name.trim())
    if (followRef.current.kind === 'invited') setZeigen(false)
    dispatch({ type: 'follow' })
    if (latestView.current) applyView(latestView.current)
  }, [applyView])
  const leave = useCallback(() => dispatch({ type: 'leave' }), [])
  const toggleZeigen = useCallback(() => setZeigen((z) => !z), [])

  /** a tap with «Zeigen» on: drawn here at once, then sent */
  const point = useCallback((at: PointerAt) => {
    const now = Date.now()
    const me = snap?.presenter?.client === CLIENT ? snap.presenter.name : (isLink ? storedPresentName() : '') || C.me
    setRings((r) => addRing(r, { key: `${CLIENT}:${newId('r')}`, client: CLIENT, name: me, link: isLink, at, born: now }, now))
    void signal({ kind: 'pointer', at })
  }, [snap, isLink, signal, C])

  // «Zeigen» on the Karte: taps on the map canvas become pointers
  const joined = isJoined(follow)
  /** «Zeigen» only means something inside the room */
  const pointing = zeigen && joined
  const [mapEl, setMapEl] = useState<HTMLElement | null>(null)
  useEffect(() => { setMapEl(joined ? mapRef.current?.getMap().getCanvasContainer() ?? null : null) }, [joined, mapRef])
  useZeigen(mapEl, pointing && mode === 'map', (x, y) => {
    const m = mapRef.current?.getMap()
    if (!m) return
    const r = m.getCanvas().getBoundingClientRect()
    const ll = m.unproject([x - r.left, y - r.top])
    point({ surface: 'map', lng: ll.lng, lat: ll.lat, plan_id: null, page: null, x: null, y: null, floor: null })
  })

  const available = live && reachable && follow.kind !== 'none'
  const shown = available ? rings : []
  const mapRings = useMemo(() => (available && joined ? ringsOn(rings, { surface: 'map' }) : []), [available, joined, rings])
  const presenter = snap?.active ? snap.presenter?.client ?? null : null

  const board: BoardPresentation | undefined = available && joined ? {
    rings: ringsOn(shown, { surface: 'plan', planId: activePlanId, page: activePlanId === TAFEL_ID ? tafelPage : null }),
    presenter,
    pointing,
    onPoint: ({ x, y, floor }) => point({
      surface: 'plan', plan_id: activePlanId, page: activePlanId === TAFEL_ID ? tafelPage : null, x, y, floor, lng: null, lat: null,
    }),
    onUserMove: follow.kind === 'following' ? () => dispatch({ type: 'moved' }) : undefined,
    onView: (s) => { planSection.current = s; if (presenting && modeRef.current === 'plans') pushView() },
  } : undefined

  return {
    /** the pill is shown */
    available,
    /** may this device start one at all (an editor, online, the Einsatz running) */
    canStart: canPresent && live,
    follow,
    state: snap?.active ? snap : null,
    zeigen: pointing,
    mapRings,
    board,
    isLink,
    start, end, followNow, leave, toggleZeigen,
  }
}

export type Presentation = ReturnType<typeof usePresentation>

/** For the «Einsatz teilen» sheet's «Präsentieren» card (ShareIncident). Null outside an Einsatz. */
export const PresentationContext = createContext<Presentation | null>(null)
