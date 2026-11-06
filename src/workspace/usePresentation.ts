// The Präsentationsmodus on this device (docs/presentation.md): follows the presentation running
// on the Einsatz, presents, follows, points – and keeps all of it out of the record.
//
// · The follow is a third live long poll beside the workspace and the Verlauf (lib/useLongPoll ·
//   api/presentation · pollPresentation) – running ONLY while the workspace follow's marker says a
//   presentation runs (lib/presentationMarker), so an Einsatz nobody presents costs nothing. It
//   also counts as this device's presence: the server ends a presentation whose presenter stops
//   polling (backend app/presentation).
// · Presenting sends what is on screen (`view`), throttled (`VIEW_MS`, leading + trailing): the
//   surface (every rail surface), the section – on the Karte and the Plan its free area, which a
//   follower FITS into its own (owner pick 06.11.2026), elsewhere a scroll anchor
//   (lib/presentAnchor) – the open Checkliste, the open symbol detail and the Verlauf drawer.
//   Following applies each view (`applyView`) and notices a hand-made pan, scroll, pick or
//   surface switch, which detaches («Wieder folgen»).
// · «Zeigen» makes one-finger taps rings and press-and-drag lines (lib/useZeigen). Both are drawn
//   here at once and sent – a line as it grows, the whole of it every STROKE_MS; everybody
//   else's arrive with the poll and fade (lib/presentation · RING_MS).
// · Offline or unreachable: there is no presentation on this device (no pill, no rings) and
//   nothing is queued – a pointer from a minute ago means nothing.
//
// `IncidentWorkspace` calls this once and hands the result to the pill (PresentationPill), the
// map's marks (MapRings), the Plan (`board`, via PlansSurface → Whiteboard) and the «Einsatz
// teilen» sheet (PresentationContext → ShareIncident's «Präsentieren» card).

import { createContext, useCallback, useEffect, useMemo, useReducer, useRef, useState, type RefObject } from 'react'
import type { MapRef } from 'react-map-gl/maplibre'
import { appConfig } from '../config/appConfig'
import { ApiError } from '../lib/api'
import { endPresentation, pollPresentation, sendPresentationSignal, startPresentation, type PresentationSignal } from '../lib/api/presentation'
import { checklistPick, showChecklist, subscribeChecklistPick } from '../lib/checklistPick'
import { newId } from '../lib/ids'
import { findScroller, scrollToAnchor, topAnchor } from '../lib/presentAnchor'
import {
  addRing, addStroke, capPoints, fitZoom, isJoined, liveRings, liveStrokes, nextFade, nextFollow, NOT_PRESENTING, ringsOn,
  RING_MS, STROKE_MS, strokesOn, throttle,
  type Anchor, type PointerAt, type PresentationState, type PresentedView, type Ring, type Stroke, type StrokeData,
} from '../lib/presentation'
import { presentationMarker, setPresentationMarker, subscribePresentationMarker, usePresentationMarker } from '../lib/presentationMarker'
import { prefersReducedMotion } from '../lib/reducedMotion'
import { pickedTafelPage, setTafelPage, SKIZZE, TAFEL_ID, useTafelPage } from '../lib/tafelPages'
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
/** A follower's scroll is tried again this long while its surface is still rendering (ms). */
const SCROLL_SETTLE_MS = 1200
/** A link holder's own name for the others' screens – a device flag, never synced. */
const NAME_KEY = 'kp-front-present-name'

export interface PlanFocusRequest { x: number; y: number; floor: number; scale?: number; span?: { w: number; h: number }; nonce: number }
/** The plan section a Whiteboard reports (its `onView`): centre of its free area in plan space,
 *  storey, zoom, and the free area's extent in board units (`w`, `h`). */
export interface PlanSection { x: number; y: number; floor: number; scale: number; w: number | null; h: number | null }

/** A line being drawn, in the surface's own units (useZeigen reports client px; the surface
 *  turns them into lng/lat, plan space or page offsets). */
export interface DrawApi<P> { start: (at: P) => void; add: (pt: [number, number]) => void; end: () => void }

/** A line this device draws: the wire's stroke, its points as pairs (the served type widens them) */
type LineDraft = Omit<StrokeData, 'points'> & { points: [number, number][] }

/** What the Whiteboard needs to take part (Whiteboard · `presentation`). */
export interface BoardPresentation {
  /** the rings and lines standing on this plan (on the Tafel: its Skizze) */
  rings: Ring[]
  strokes: Stroke[]
  /** …and on the open Tafel form page */
  pageRings: Ring[]
  pageStrokes: Stroke[]
  presenter: string | null
  /** «Zeigen» is on: one-finger taps are pointers, drags are lines */
  pointing: boolean
  onPoint: (p: { x: number; y: number; floor: number }) => void
  /** a line on the plan: starts on `floor` at `x, y`; then [x, y] in that storey's plan space */
  draw: DrawApi<{ x: number; y: number; floor: number }>
  onPagePoint: (a: Anchor) => void
  /** a line on a form page: starts at the anchor; then offsets from it in anchor widths */
  pageDraw: DrawApi<Anchor>
  /** set while following: a pan by hand detaches */
  onUserMove?: () => void
  onView: (s: PlanSection) => void
  /** the plan object whose detail is open here (the presenter's goes out) */
  onSelect: (id: string | null) => void
  /** the presenter's open detail, for a follower's board to open (`nonce` per request) */
  select: { id: string | null; nonce: number } | null
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

/** The part of a surface no detail panel covers, in the surface's own px (left/top 0): the
 *  presenter's own panel is not part of what it shows, and a follower's is not where it fits. */
export function freeArea(surface: DOMRect): { x: number; y: number; w: number; h: number } {
  let right = surface.width, bottom = surface.height
  const ctx = document.querySelector('.ctx')?.getBoundingClientRect()
  if (ctx && ctx.width && ctx.right > surface.left && ctx.left < surface.right) {
    if (ctx.width >= surface.width * 0.9) bottom = Math.max(1, Math.min(bottom, ctx.top - surface.top))
    else right = Math.max(1, Math.min(right, ctx.left - surface.left))
  }
  return { x: right / 2, y: bottom / 2, w: right, h: bottom }
}

/** A Tafel form page on screen (TafelFormPage's root, which is its scroller). */
const formPageEl = () => document.querySelector<HTMLElement>('[data-testid="tafel-page"]')
const journalEl = () => document.querySelector('.journal-drawer')
/** The scroller of what is on screen – found once per surface (it walks the app), kept while
 *  it stands: a scroll is pushed every VIEW_MS, and a follower settles it every frame. */
const scrollers = new Map<string, HTMLElement>()
function surfaceScroller(where: 'surface' | 'journal', mode: string): HTMLElement | null {
  if (where === 'surface' && mode === 'plans') return formPageEl()
  const key = `${where}:${mode}`
  const kept = scrollers.get(key)
  if (kept?.isConnected && kept.scrollHeight > kept.clientHeight) return kept
  const found = findScroller(where === 'journal' ? journalEl() : document.querySelector('.app'))
  if (found) scrollers.set(key, found)
  else scrollers.delete(key)
  return found
}
const round = (v: number, d: number) => Math.round(v * 10 ** d) / 10 ** d

export function usePresentation({
  incidentId, enabled, canPresent, isLink, mode, setMode, activePlanId, setActivePlanId, hasPlan, mapRef, setPlanFocus,
  selectedId = null, setSelectedId, journalOpen = false, setJournalOpen,
}: {
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
  /** does this device have that plan (a link sees fewer Objektpläne)? A plan it lacks is not
   *  followed – the follower stays where it is */
  hasPlan?: (id: string) => boolean
  mapRef: RefObject<MapRef | null>
  setPlanFocus: (f: PlanFocusRequest) => void
  /** the Karte symbol whose detail is open */
  selectedId?: string | null
  setSelectedId?: (id: string | null) => void
  journalOpen?: boolean
  setJournalOpen?: (open: boolean) => void
}) {
  const online = useOnline()
  const [snap, setSnap] = useState<PresentationState | null>(null)
  const [reachable, setReachable] = useState(true)
  const [follow, dispatch] = useReducer(nextFollow, NOT_PRESENTING)
  const [rings, setRings] = useState<Ring[]>([])
  const [strokes, setStrokes] = useState<Stroke[]>([])
  const [zeigen, setZeigen] = useState(false)
  const zeigenRef = useRef(zeigen)
  useEffect(() => { zeigenRef.current = zeigen }, [zeigen])
  const [tafelPage] = useTafelPage(incidentId)
  /** the plan object whose detail is open on this device's board (Whiteboard · onSelect) */
  const [boardSel, setBoardSel] = useState<string | null>(null)
  /** the presenter's open plan detail, for this follower's board */
  const [boardSelect, setBoardSelect] = useState<{ id: string | null; nonce: number } | null>(null)

  // what the poll and the async callbacks read without re-arming anything
  const known = useRef('')
  const seq = useRef(0)
  const followRef = useRef(follow)
  const modeRef = useRef(mode)
  const planRef = useRef(activePlanId)
  const selRef = useRef({ map: selectedId, board: boardSel, journal: journalOpen })
  const hasPlanRef = useRef(hasPlan)
  const planSection = useRef<PlanSection | null>(null)
  const joinedId = useRef<string | null>(null)
  /** what the follower was last put on – a difference is a hand-made move */
  const expected = useRef<{ mode: string; planId: string | null; page: string | null; checklist: string | null; detail: string | null; journal: boolean } | null>(null)
  /** the presenter's newest view, for «Folgen» / «Wieder folgen» */
  const latestView = useRef<PresentedView | null>(null)
  useEffect(() => { followRef.current = follow }, [follow])
  useEffect(() => { modeRef.current = mode; planRef.current = activePlanId }, [mode, activePlanId])
  useEffect(() => { selRef.current = { map: selectedId, board: boardSel, journal: journalOpen } }, [selectedId, boardSel, journalOpen])
  useEffect(() => { hasPlanRef.current = hasPlan }, [hasPlan])

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
  /** a selection handed to the board that it has not reported back yet – no hand-made pick */
  const boardPending = useRef(false)
  /** a scroll still to be put in place once its surface has rendered (`settleScroll`) */
  const pendingScroll = useRef<{ surface: Anchor | null; journal: Anchor | null; until: number } | null>(null)
  const scrollRaf = useRef(0)
  const settleScroll = useCallback(() => {
    cancelAnimationFrame(scrollRaf.current)
    const step = () => {
      const want = pendingScroll.current
      if (!want) return
      let done = true
      if (want.surface) {
        const el = surfaceScroller('surface', modeRef.current)
        done = (!!el && scrollToAnchor(el, want.surface)) && done
      }
      if (want.journal) {
        const el = surfaceScroller('journal', 'journal')
        done = (!!el && scrollToAnchor(el, want.journal)) && done
      }
      // ⚠️ settled, but kept trying for the whole window: a surface that restores its own
      // remembered scroll on mount (lib/rememberedScroll) would otherwise win the last word
      if (performance.now() < want.until) scrollRaf.current = requestAnimationFrame(step)
      else if (done) pendingScroll.current = null
    }
    scrollRaf.current = requestAnimationFrame(step)
  }, [])
  useEffect(() => () => cancelAnimationFrame(scrollRaf.current), [])

  const applyView = useCallback((v: PresentedView) => {
    const doc = v.mode !== 'map' && !(v.mode === 'plans' && (v.plan_id !== TAFEL_ID || !v.page || v.page === SKIZZE))
    // a plan this device does not have (a link sees fewer Objektpläne) is not followed: it stays
    const planKnown = v.mode !== 'plans' || !v.plan_id || (hasPlanRef.current?.(v.plan_id) ?? true)
    if (!planKnown) return
    const cl = v.mode === 'checklists' && v.checklist ? `${v.checklist.kind}:${v.checklist.id}` : null
    expected.current = { mode: v.mode, planId: v.plan_id, page: v.page, checklist: cl, detail: v.detail, journal: v.journal }
    if (modeRef.current !== v.mode) setMode(v.mode)
    if (v.mode === 'map') {
      const m = mapRef.current?.getMap()
      if (v.map && m) {
        const cont = m.getContainer().getBoundingClientRect()
        const free = freeArea(cont)
        const z = v.map.w && v.map.h ? fitZoom(v.map.zoom, { w: v.map.w, h: v.map.h }, free) : v.map.zoom
        m.easeTo({
          center: [v.map.lng, v.map.lat], zoom: Math.max(m.getMinZoom(), Math.min(m.getMaxZoom(), z)), bearing: v.map.bearing,
          offset: [free.x - cont.width / 2, free.y - cont.height / 2], duration: prefersReducedMotion() ? 0 : EASE_MS,
        })
      }
      if (setSelectedId && selRef.current.map !== v.detail) setSelectedId(v.detail)
    } else if (v.mode === 'plans') {
      if (v.plan_id && v.plan_id !== planRef.current) setActivePlanId(v.plan_id)
      if (v.plan_id === TAFEL_ID && v.page) setTafelPage(incidentId, v.page)
      if (v.plan) {
        const { w, h, ...at } = v.plan
        setPlanFocus({ ...at, span: w && h ? { w, h } : undefined, nonce: ++focusNonce.current })
      }
      if (selRef.current.board !== v.detail) {
        boardPending.current = true
        setBoardSelect({ id: v.detail, nonce: ++focusNonce.current })
      }
    } else if (v.mode === 'checklists' && v.checklist) {
      showChecklist(incidentId, v.checklist)
    }
    if (setJournalOpen && selRef.current.journal !== v.journal) setJournalOpen(v.journal)
    const surface = doc ? v.scroll : null
    const journal = v.journal ? v.journal_scroll : null
    if (surface || journal) {
      pendingScroll.current = { surface, journal, until: performance.now() + SCROLL_SETTLE_MS }
      settleScroll()
    }
  }, [incidentId, mapRef, setActivePlanId, setMode, setPlanFocus, setSelectedId, setJournalOpen, settleScroll])

  // a surface switched, a symbol opened, a Checkliste picked or the Verlauf opened by hand while
  // following → detached
  const [pick, setPick] = useState(() => checklistPick(incidentId))
  useEffect(() => subscribeChecklistPick(() => setPick(checklistPick(incidentId))), [incidentId])
  const pickKey = pick ? `${pick.kind}:${pick.id}` : null
  useEffect(() => {
    const want = expected.current
    if (follow.kind !== 'following' || !want) return
    if (boardSel === want.detail) boardPending.current = false
    const off = mode !== want.mode
      || (want.mode === 'plans' && want.planId != null && activePlanId !== want.planId)
      || (want.mode === 'plans' && want.planId === TAFEL_ID && want.page != null && tafelPage !== want.page)
      || (want.mode === 'checklists' && want.checklist != null && pickKey !== want.checklist)
      || (want.mode === 'map' && !!setSelectedId && selectedId !== want.detail)
      || (want.mode === 'plans' && boardSel !== want.detail && !boardPending.current)
      || (!!setJournalOpen && journalOpen !== want.journal)
    if (off) dispatch({ type: 'moved' })
  }, [follow.kind, mode, activePlanId, tafelPage, pickKey, selectedId, boardSel, journalOpen, setSelectedId, setJournalOpen])

  // a pan / zoom / turn of the Karte by hand (MapLibre gives a programmatic move no originalEvent)
  useEffect(() => {
    const m = mapRef.current?.getMap()
    if (follow.kind !== 'following' || !m) return
    const moved = (e: { originalEvent?: unknown }) => { if (e.originalEvent && modeRef.current === 'map') dispatch({ type: 'moved' }) }
    m.on('movestart', moved)
    return () => { m.off('movestart', moved) }
  }, [follow.kind, mapRef])

  // a scroll by hand on a scrolled surface or in the Verlauf (a programmatic scroll is no input)
  useEffect(() => {
    if (follow.kind !== 'following') return
    const scrolled = (target: EventTarget | null) => {
      if (!(target instanceof Element) || target.closest('.present-row')) return
      const inJournal = !!target.closest('.journal-drawer')
      const onDoc = modeRef.current !== 'map' && (modeRef.current !== 'plans' || !!formPageEl()?.contains(target))
      if (inJournal || onDoc) { pendingScroll.current = null; dispatch({ type: 'moved' }) }
    }
    const SCROLL_KEYS = new Set(['PageUp', 'PageDown', 'Home', 'End', 'ArrowUp', 'ArrowDown', ' '])
    const onWheel = (e: Event) => scrolled(e.target)
    // one finger with «Zeigen» on draws (lib/useZeigen) – that is no scroll
    const onTouch = (e: TouchEvent) => { if (!(zeigenRef.current && e.touches.length === 1)) scrolled(e.target) }
    const onKey = (e: KeyboardEvent) => {
      const t = e.target
      if (!SCROLL_KEYS.has(e.key) || (t instanceof HTMLElement && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName)))) return
      scrolled(t instanceof Element && t !== document.body ? t : formPageEl() ?? document.querySelector('.app'))
    }
    const opts = { capture: true, passive: true } as const
    window.addEventListener('wheel', onWheel, opts)
    window.addEventListener('touchmove', onTouch, opts)
    window.addEventListener('keydown', onKey, opts)
    return () => {
      window.removeEventListener('wheel', onWheel, opts)
      window.removeEventListener('touchmove', onTouch, opts)
      window.removeEventListener('keydown', onKey, opts)
    }
  }, [follow.kind])

  // --- the poll ----------------------------------------------------------------------------
  // ⚠️ Only while the workspace follow says a presentation runs (lib/presentationMarker): an
  // Einsatz nobody presents costs no request of its own (perf journey `idle`, 06.11.2026). A
  // round outside that window returns «unanswered» without asking, and the loop restarts at once
  // when the marker names one (`marker` in the deps, `restart(0)` below).
  const marker = usePresentationMarker(incidentId)
  const live = enabled && online && marker !== null
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
        } else if (m.kind === 'stroke' && m.client !== CLIENT) {
          const line: Stroke = { key: `${m.client}:${m.stroke.id}`, client: m.client, name: m.name, link: m.link, line: m.stroke, born: now }
          setStrokes((st) => addStroke(st, line, now))
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

  // the marker went: the presentation is over on this device too, whatever its own follow had
  // last heard (a callback, not an effect body – it is the external store speaking)
  useEffect(() => subscribePresentationMarker(() => {
    if (presentationMarker(incidentId) !== null || !known.current) return
    known.current = ''
    seq.current = 0
    latestView.current = null
    setSnap(null)
    dispatch({ type: 'server', id: null, mine: false })
  }), [incidentId])
  // …and it came: ask at once rather than after the loop's first spacing
  useEffect(() => { if (live) restart(0) }, [live, restart])

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

  // the rings and lines fade on their own
  useEffect(() => {
    const now = Date.now()
    const ringFade = rings.length ? Math.max(50, Math.min(...rings.map((x) => x.born)) + RING_MS - now) : null
    const lineFade = nextFade(strokes, now)
    const wait = ringFade == null ? lineFade : lineFade == null ? ringFade : Math.min(ringFade, lineFade)
    if (wait == null) return
    const t = setTimeout(() => {
      const at = Date.now()
      setRings((r) => { const l = liveRings(r, at); return l.length === r.length ? r : l })
      setStrokes((st) => { const l = liveStrokes(st, at); return l.length === st.length ? st : l })
    }, wait)
    return () => clearTimeout(t)
  }, [rings, strokes])

  // --- presenting: send what is on screen --------------------------------------------------
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
    const sel = selRef.current
    const journalScroller = sel.journal ? surfaceScroller('journal', 'journal') : null
    const view: PresentedView = {
      mode: md, plan_id: null, page: null, map: null, plan: null, scroll: null, checklist: null, detail: null,
      journal: sel.journal, journal_scroll: journalScroller ? topAnchor(journalScroller) : null,
    }
    if (md === 'map') {
      const m = mapRef.current?.getMap()
      if (!m) return
      const free = freeArea(m.getContainer().getBoundingClientRect())
      const c = m.unproject([free.x, free.y])
      const sized = free.w >= 1 && free.h >= 1
      view.map = { lng: c.lng, lat: c.lat, zoom: m.getZoom(), bearing: m.getBearing(), w: sized ? Math.round(free.w) : null, h: sized ? Math.round(free.h) : null }
      view.detail = sel.map
    } else if (md === 'plans') {
      const planId = planRef.current
      view.plan_id = planId
      view.page = planId === TAFEL_ID ? pickedTafelPage(incidentId) : null
      view.plan = planSection.current
      view.detail = sel.board
      const page = formPageEl()
      if (page) view.scroll = topAnchor(page)
    } else {
      const scroller = surfaceScroller('surface', md)
      if (scroller) view.scroll = topAnchor(scroller)
      if (md === 'checklists') view.checklist = checklistPick(incidentId)
    }
    sender.current?.push(view)
  }, [incidentId, mapRef])
  useEffect(() => { if (presenting) pushView() }, [presenting, mode, activePlanId, tafelPage, pickKey, selectedId, boardSel, journalOpen, pushView])
  useEffect(() => {
    const m = mapRef.current?.getMap()
    if (!presenting || !m) return
    const moved = () => { if (modeRef.current === 'map') pushView() }
    m.on('move', moved)
    return () => { m.off('move', moved) }
  }, [presenting, mapRef, pushView])
  // any scroll – a module, a Checkliste, a form page, the Verlauf – is a new section
  useEffect(() => {
    if (!presenting) return
    const scrolled = () => { if (modeRef.current !== 'map' || selRef.current.journal) pushView() }
    const opts = { capture: true, passive: true } as const
    document.addEventListener('scroll', scrolled, opts)
    return () => document.removeEventListener('scroll', scrolled, opts)
  }, [presenting, pushView])

  // --- actions -----------------------------------------------------------------------------
  const C = appConfig.copy.presentation
  const start = useCallback(async () => {
    try {
      const s = await startPresentation(incidentId, CLIENT)
      setZeigen(false)
      known.current = s.id ?? ''
      seq.current = s.seq
      setPresentationMarker(incidentId, s.id ?? null)
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
      setPresentationMarker(incidentId, null)
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

  /** the name beside this device's own marks */
  const myName = useCallback(() => (snap?.presenter?.client === CLIENT ? snap.presenter.name : (isLink ? storedPresentName() : '') || C.me), [snap, isLink, C])

  /** a tap with «Zeigen» on: drawn here at once, then sent */
  const point = useCallback((at: PointerAt) => {
    const now = Date.now()
    setRings((r) => addRing(r, { key: `${CLIENT}:${newId('r')}`, client: CLIENT, name: myName(), link: isLink, at, born: now }, now))
    void signal({ kind: 'pointer', at })
  }, [myName, isLink, signal])

  // a line with «Zeigen» on: drawn here as it grows, sent whole every STROKE_MS (and at the end)
  const line = useRef<LineDraft | null>(null)
  const strokeSender = useRef<ReturnType<typeof throttle<LineDraft>> | null>(null)
  useEffect(() => {
    const t = throttle<LineDraft>(STROKE_MS, (stroke) => void signal({ kind: 'stroke', stroke }))
    strokeSender.current = t
    return () => t.cancel()
  }, [signal])
  const showLine = useCallback((l: LineDraft) => {
    const now = Date.now()
    const sent = { ...l, points: capPoints(l.points) }
    setStrokes((st) => addStroke(st, { key: `${CLIENT}:${l.id}`, client: CLIENT, name: myName(), link: isLink, line: sent, born: now }, now))
    strokeSender.current?.push(sent)
  }, [myName, isLink])
  const beginLine = useCallback((base: Omit<StrokeData, 'id' | 'points' | 'done'>, first: [number, number]) => {
    line.current = { ...base, id: newId('st'), points: [first], done: false }
    showLine(line.current)
  }, [showLine])
  const addToLine = useCallback((pt: [number, number]) => {
    const l = line.current
    if (!l) return
    const last = l.points[l.points.length - 1]
    if (last && last[0] === pt[0] && last[1] === pt[1]) return
    l.points.push(pt)
    showLine(l)
  }, [showLine])
  const endLine = useCallback(() => {
    const l = line.current
    if (!l) return
    line.current = null
    showLine({ ...l, done: true })
  }, [showLine])

  // «Zeigen» on the Karte: taps on the map canvas become rings, drags lines
  const joined = isJoined(follow)
  /** «Zeigen» only means something inside the room */
  const pointing = zeigen && joined
  const [mapEl, setMapEl] = useState<HTMLElement | null>(null)
  useEffect(() => { setMapEl(joined ? mapRef.current?.getMap().getCanvasContainer() ?? null : null) }, [joined, mapRef])
  const lngLat = (x: number, y: number): [number, number] | null => {
    const m = mapRef.current?.getMap()
    if (!m) return null
    const r = m.getCanvas().getBoundingClientRect()
    const ll = m.unproject([x - r.left, y - r.top])
    return [round(ll.lng, 6), round(ll.lat, 6)]
  }
  const mapBase = { surface: 'map' as const, plan_id: null, page: null, floor: null, anchor: null }
  useZeigen(mapEl, pointing && mode === 'map', (x, y) => {
    const ll = lngLat(x, y)
    if (ll) point({ ...mapBase, lng: ll[0], lat: ll[1], x: null, y: null })
  }, {
    onDraw: {
      start: (x, y) => { const ll = lngLat(x, y); if (ll) beginLine(mapBase, ll) },
      move: (x, y) => { const ll = lngLat(x, y); if (ll) addToLine(ll) },
      end: endLine,
    },
  })

  const available = live && reachable && follow.kind !== 'none'
  const shown = available ? rings : []
  const shownLines = available ? strokes : []
  const mapRings = useMemo(() => (available && joined ? ringsOn(rings, { surface: 'map' }) : []), [available, joined, rings])
  const mapStrokes = useMemo(() => (available && joined ? strokesOn(strokes, { surface: 'map' }) : []), [available, joined, strokes])
  const presenter = snap?.active ? snap.presenter?.client ?? null : null
  const pageHere = activePlanId === TAFEL_ID ? tafelPage : null
  const onPage = { surface: 'page' as const, planId: activePlanId, page: pageHere ?? SKIZZE }
  const onPlan = { surface: 'plan' as const, planId: activePlanId, page: pageHere }

  const board: BoardPresentation | undefined = available && joined ? {
    rings: ringsOn(shown, onPlan),
    strokes: strokesOn(shownLines, onPlan),
    pageRings: ringsOn(shown, onPage),
    pageStrokes: strokesOn(shownLines, onPage),
    presenter,
    pointing,
    onPoint: ({ x, y, floor }) => point({
      surface: 'plan', plan_id: activePlanId, page: pageHere, x, y, floor, lng: null, lat: null, anchor: null,
    }),
    draw: {
      start: ({ x, y, floor }) => beginLine({ surface: 'plan', plan_id: activePlanId, page: pageHere, floor, anchor: null }, [round(x, 4), round(y, 4)]),
      add: ([x, y]) => addToLine([round(x, 4), round(y, 4)]),
      end: endLine,
    },
    onPagePoint: (anchor) => point({
      surface: 'page', plan_id: activePlanId, page: pageHere ?? SKIZZE, anchor, x: null, y: null, floor: null, lng: null, lat: null,
    }),
    pageDraw: {
      start: (anchor) => beginLine({ surface: 'page', plan_id: activePlanId, page: pageHere ?? SKIZZE, floor: null, anchor }, [0, 0]),
      add: ([dx, dy]) => addToLine([round(dx, 4), round(dy, 4)]),
      end: endLine,
    },
    onUserMove: follow.kind === 'following' ? () => dispatch({ type: 'moved' }) : undefined,
    onView: (s) => { planSection.current = s; if (presenting && modeRef.current === 'plans') pushView() },
    onSelect: setBoardSel,
    select: follow.kind === 'following' ? boardSelect : null,
  } : undefined

  return {
    /** the pill is shown */
    available,
    /** may this device start one at all (an editor, online, the Einsatz running) */
    canStart: canPresent && enabled && online,
    follow,
    state: snap?.active ? snap : null,
    zeigen: pointing,
    mapRings,
    mapStrokes,
    /** rings and lines live anywhere – the edge arrows look for them while there are any */
    marks: available && joined ? shown.length + shownLines.length : 0,
    board,
    isLink,
    start, end, followNow, leave, toggleZeigen,
  }
}

export type Presentation = ReturnType<typeof usePresentation>

/** For the «Einsatz teilen» sheet's «Präsentieren» card (ShareIncident). Null outside an Einsatz. */
export const PresentationContext = createContext<Presentation | null>(null)
