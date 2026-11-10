import { Suspense, lazy, useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import './app.css'
import { IconSprite } from './lib/icons'
import { demoSeedRebase } from './lib/workspace'
import { appConfig } from './config/appConfig'
import { isDemoMode, objectVisitsConfig, getDeploymentConfig } from './lib/deploymentConfig'
import { isOvPath, leaveAppEntries, navigateTo, OV_BASE, ovHref, showsObjectVisits, useOvRoute } from './objectVisits/route'
import { isKartePath, KARTE_BASE, useKarteRoute } from './lib/karte/route'
import { appScreen, bootPlan } from './lib/karte/home'
import { startOutboxRunner } from './objectVisits/outbox'
import { fillTemplate } from './lib/format'
import { Overlays, toast, confirmDialog } from './lib/ui'
import { confirmLogout } from './lib/logoutConfirm'
import { persistedPendingRows } from './lib/journalStore'
import { loadPrefs, savePrefs } from './lib/prefs'
import { useDevicePrefs } from './lib/useDevicePrefs'
import { useAutoTheme } from './lib/useAutoTheme'
import { useCloseReopen, useIncidentLifecycle } from './lib/useIncidentLifecycle'
import { Splash } from './components/Splash'
import { HomeMenu, LauncherBody, type HomeActions } from './components/HomeMenus'
import { Brand } from './components/Brand'
import { DemoWelcome } from './components/DemoWelcome'
import { hasSeenDemoWelcome, markDemoWelcomeSeen } from './lib/demoWelcome'
import { InstallGuide } from './components/InstallGuide'
import { getInstallPlatform, isStandalone } from './lib/installPrompt'
import { installOffered } from './lib/installPolicy'
import { claimBootNotifyTarget } from './lib/notifyTarget'
import { useIncidentTabLock } from './lib/tabLock'
import { clearIncidentMedia, listMediaQueue } from './lib/mediaQueue'
import { MediaPendingMeldung, type ClosedMediaPending } from './components/MediaPendingMeldung'
import { clearAppBadge, ensurePushSubscription } from './lib/push'
import { ErrorBoundary } from './components/ErrorBoundary'
import { isAtemschutzLinkKind, useAuth } from './lib/auth'
import { IncidentWorkspace } from './IncidentWorkspace'
import {
  WorkspaceSync, listIncidentsResilient, listIncidentsShared, getIncident, archiveIncident,
  migrateLegacyWorkspace, takeDiveraAlarm, attachDiveraAlarm, discardWorkspaceCache,
  isIncidentRunning, type DiveraAlarm, type IncidentFull, type IncidentMeta, type Workspace,
} from './lib/incidents'
import { unlockAlarm } from './lib/alarm'
import { CRASH_HEALTHY_MS, clearCrash } from './lib/crashLoop'
import { ApiError } from './lib/api'
import { useDiveraWatch } from './lib/useDiveraWatch'
import { dismissAlarm, loadDismissedAlarms, shownAlarms } from './lib/diveraDismiss'
import { useIncidentWatch } from './lib/useIncidentWatch'
import { loadReviewedIncidents, needsIntakeReview, sameIncidentList, saveReviewedIncident, shouldReopenClosed, undoTakeReturn } from './lib/incidentAlerts'
import { EinsatzWizard, DatenquellenPanel, FeedbackSheet, HistoryPanel, IncomingAlarmBanner, NewIncidentBanner, SettingsSheet } from './components/panels'
import { Meldeleiste } from './components/Meldeleiste'
import { linkShowsMeldung } from './lib/meldungen'
import { SessionExpiredMeldung } from './components/SessionExpiredMeldung'
import { pickTrouble, readTrouble, recordTrouble, type TroubleEvent } from './lib/trouble'
import { onStorageDegraded } from './lib/idb'
import { loadRoster } from './lib/usePersonnel'
import { HelpOverlay } from './components/HelpOverlay'
import { installHoldTooltip } from './lib/holdTooltip'

// Objektbesuche (/besuche…, docs/object-visits.md): its own lazy chunk — precached with the field
// app, so the surface opens offline — mounted in place of home while its route is on.
const ObjectVisitsApp = lazy(() => import('./components/objectVisits/ObjectVisitsApp'))
// «Karte & Objekte» (/karte…, docs/karte-objekte.md): the station reference viewer outside an
// Einsatz — its own lazy chunk too — and, with no Einsatz open, home itself (lib/karte/home).
const KarteApp = lazy(() => import('./components/karte/KarteApp'))

// ---------------------------------------------------------------------------------
// Incident root: owns the incident list, the active selection, and the per-incident
// WorkspaceSync. The workspace below is keyed by incident id so switching remounts it,
// hydrating cleanly from that incident's own blob.
// ---------------------------------------------------------------------------------
/** Einstellungen opened from the landing card (no incident): device prefs only. Owns the
 *  pref state itself (mounted only while open, reads/writes the prefs cookie directly);
 *  the synced per-incident section is hidden by omitting settings/onSettings. */
function LandingSettings({ onClose, onFeedback }: { onClose: () => void; onFeedback?: () => void }) {
  const { symbolScale, setSymbolScale, symbolCaptions, setSymbolCaptions, offlineRadiusM, setOfflineRadiusM, offlineAuto, setOfflineAuto, keepScreenOn, setKeepScreenOn, railLabels, setRailLabels } = useDevicePrefs()
  useEffect(() => {
    // the legacy `symbolSize` key rides along in the spread untouched — see prefs · symbolScales
    savePrefs({ ...loadPrefs(), symbolScaleMap: symbolScale.map, symbolScaleBoard: symbolScale.board, symbolCaptions, offlineRadiusM, offlineAuto, keepScreenOn, railLabels })
  }, [symbolScale, symbolCaptions, offlineRadiusM, offlineAuto, keepScreenOn, railLabels])
  return (
    <SettingsSheet
      onClose={onClose}
      symbolScale={symbolScale}
      railLabels={railLabels}
      onRailLabels={setRailLabels}
      onSymbolScale={setSymbolScale}
      symbolCaptions={symbolCaptions}
      onSymbolCaptions={setSymbolCaptions}
      offlineRadiusM={offlineRadiusM}
      onOfflineRadius={setOfflineRadiusM}
      offlineAuto={offlineAuto}
      onOfflineAuto={setOfflineAuto}
      keepScreenOn={keepScreenOn}
      onKeepScreenOn={setKeepScreenOn}
      themeCoord={null}
      onFeedback={onFeedback}
    />
  )
}


export default function App() {
  const { user, logout, sessionExpired } = useAuth()
  const isEditor = user?.role === 'editor'
  /** may close and reopen Einsätze – an editor, but not in the Führungsansicht, the editor's
   *  locked view (workspace/access · elView; RBAC audit 22.10.2026: it got «Wieder öffnen») */
  const canLifecycle = isEditor && !user?.el_view_default
  // Einsatz-Link session (/l/<token>): a viewer narrowed to ONE incident. The backend answers
  // 403 for everything outside a read allowlist — reports, printing, push, the incident LIST —
  // so the rule here is the same as for `isEditor`: a link holder must never see a control
  // that will fail. `linkIncidentId` is the incident the token names; the app opens it
  // directly, because listing incidents is exactly what a link may not do.
  const linkScoped = !!user?.link_scoped
  const linkIncidentId = (linkScoped && user?.link_incident_id) || null
  // …and WHICH link. The Atemschutz one is the only session that is link-scoped and may still
  // write (auth · AuthUser.link_kind); IncidentWorkspace renders it as «Tafel pur». Mirrored in
  // a ref because `selectIncident` below is a stable ([] deps) callback.
  const asLink = linkScoped && isAtemschutzLinkKind(user?.link_kind)
  const asLinkRef = useRef(asLink)
  useEffect(() => { asLinkRef.current = asLink }, [asLink])
  // …and the `el` ROLE (Einsatzleiter function, 07.09.): a signed-in account whose pushes carry
  // only the record slice — same ref treatment, same reason (selectIncident is stable).
  const isEl = user?.role === 'el'
  const isElRef = useRef(isEl)
  useEffect(() => { isElRef.current = isEl }, [isEl])

  // register this browser for server push once per session (no-op unless notification
  // permission is already granted AND the deployment has VAPID keys) — killed-app alarms.
  // Never on a link session: /api/push/subscriptions writes rows tied to a user and 403s.
  useEffect(() => { if (!linkScoped) void ensurePushSubscription() }, [linkScoped])
  // Keep the last-known Mannschaft on the device from the LAUNCHER on, not only once an Einsatz
  // has been opened online: an Einsatz first opened offline, and the Leeres Erfassungsblatt, read
  // that cache (usePersonnel · loadRoster). A link session may not list the roster (403).
  const rosterUserId = user && !linkScoped ? user.id : null
  useEffect(() => { if (rosterUserId) void loadRoster().catch(() => {}) }, [rosterUserId])

  // Objektbesuche: what a save point could not send (offline, a lapsed session) goes up on its
  // own — at every start and every reconnect, whether or not anybody opens that visit again.
  // Never for a link session (the routes 403 for it); a device with no visits costs one IDB read.
  // Only THIS account's pending sends: on a shared tablet a colleague's draft waits for them.
  const runnerUser = user?.id ?? null
  useEffect(() => (linkScoped || !runnerUser ? undefined : startOutboxRunner(undefined, { user: runnerUser })), [linkScoped, runnerUser])

  // hold an icon-only button to read its word — the tablet's title-tooltip (lib/holdTooltip)
  useEffect(() => installHoldTooltip(), [])

  const [incidents, setIncidents] = useState<IncidentMeta[] | null>(null)
  const [activeId, setActiveId] = useState<string | null>(null)
  // the incident a HUMAN is opening right now (launch card / switcher / banner / Verlauf) — the
  // card spins and locks meanwhile, the way `taking` does for a Divera take, so a slow open on
  // a bad link (up to 20 s) is not mistaken for a dead tap
  const [opening, setOpening] = useState<string | null>(null)
  // the boot auto-open is running and nothing is on screen yet: hold the Splash instead of
  // flashing the launcher, whose card would only start a second, silent open of the same Einsatz
  const [bootOpening, setBootOpening] = useState(false)
  // the boot has decided what to open (or that it opens nothing). Until then the launcher must not
  // render: the always-on list watch can fill `incidents` BEFORE the boot's own list call returns,
  // and the launcher then flashed between the splash and the Einsatz (01.10.2026)
  const [bootDecided, setBootDecided] = useState(false)
  const bootOpenSeq = useRef(0) // StrictMode / re-run guard: only the LATEST boot open may clear it
  const [activeMeta, setActiveMeta] = useState<IncidentMeta | null>(null)
  const [workspace, setWorkspace] = useState<Workspace | null>(null)
  const [remount, setRemount] = useState(0)
  // the Einsatz whose OPENING is still behind the workspace's snail cover (lib/bootCover). Set
  // by a genuine open only — never by a background remount, nor by re-selecting the Einsatz
  // already on screen (the read-only stay after «Abschliessen») — and cleared as the cover lifts.
  const [coverId, setCoverId] = useState<string | null>(null)
  const clearCover = useCallback(() => setCoverId(null), [])
  // Demo instances greet a first-time visitor once per device with the can/can't intro.
  const [showWelcome, setShowWelcome] = useState(() => isDemoMode() && !hasSeenDemoWelcome())
  const [forceReadOnly, setForceReadOnly] = useState(false)
  // single-editor-per-browser: only one tab may edit an incident (they'd race the shared
  // IDB sync cache); a second tab is read-only with a one-tap take-over.
  const tabLock = useIncidentTabLock(activeId)
  const [overlay, setOverlay] = useState<null | 'create' | 'history' | 'daten'>(null)
  // closed Einsätze whose captures are still queued on this device (completeRapport) — a Meldung
  // each while true; re-read whenever the list refreshes, gone once the queue is empty
  const [closedMedia, setClosedMedia] = useState<ClosedMediaPending[]>([])
  useEffect(() => {
    if (closedMedia.length === 0) return
    let live = true
    void Promise.all(closedMedia.map(async (p) => ({ ...p, n: (await listMediaQueue(p.id).catch(() => [])).length })))
      .then((next) => {
        if (!live) return
        const kept = next.filter((p) => p.n > 0)
        setClosedMedia((cur) => (kept.length === cur.length && kept.every((p, i) => p.n === cur[i].n) ? cur : kept))
      })
    return () => { live = false }
  }, [incidents])  // eslint-disable-line react-hooks/exhaustive-deps
  // the Objektbesuche route (/besuche…) — a surface of its own, see the render below
  const ovRoute = useOvRoute()
  // …ENTERED on purpose (the «Einsätze» sheet's button, the Einsatz menu's row, a deep link at
  // start): only then may it cover an open Einsatz — a back gesture onto an old /besuche entry
  // must not (objectVisits/route)
  const [ovEntered, setOvEntered] = useState(() => isOvPath(window.location.pathname))
  // …from inside an Einsatz with the object whose plans are on the board: the Übersicht offers it
  // first (owner, 05.10.2026). From home there is none.
  const [ovSuggest, setOvSuggest] = useState<string | null>(null)
  // where leaving the surface returns to: «Karte & Objekte» as it was (its address, `/karte?objekt=…`
  // or home's `/`) for a visit opened there (contract C1 · `from=karte`), else the start
  const [ovReturn, setOvReturn] = useState<string | null>(null)
  const enterObjectVisits = useCallback((objectId: string | null = null) => {
    setOvReturn(null); setOvSuggest(objectId); setOvEntered(true); navigateTo(OV_BASE)
  }, [])
  // leaving walks BACK over the surface's own entries (route · leaveAppEntries): nothing stays
  // behind the Karte / the viewer for an iOS edge swipe to find (05.10.2026)
  const leaveObjectVisits = useCallback((to?: string) => {
    setOvReturn(null); setOvEntered(false)
    leaveAppEntries(ovReturn ?? to ?? '/')
  }, [ovReturn])
  // left by the browser's own back: the entry is spent (React's «adjust state while rendering»)
  if (!ovRoute && ovEntered) { setOvEntered(false); setOvReturn(null) }
  // ⚠️ A visit opened FROM the viewer has no Übersicht behind it: stepping up out of it — its
  // «Zurück», which goes to its work list or the Übersicht (VisitPage · leave) — returns to the
  // viewer, read views and reports included (the viewer builder's follow-up, 16.10.2026). A layout
  // effect, so the Übersicht is never painted on the way.
  // The state is adjusted while rendering; only the history walk is the effect's.
  const [ovUpTo, setOvUpTo] = useState<string | null>(null)
  if (ovEntered && ovReturn != null && (ovRoute?.kind === 'overview' || ovRoute?.kind === 'list')) {
    setOvUpTo(ovReturn); setOvReturn(null); setOvEntered(false)
  }
  if (ovUpTo != null && !ovRoute) setOvUpTo(null)
  useLayoutEffect(() => { if (ovUpTo != null) leaveAppEntries(ovUpTo) }, [ovUpTo])
  // «Karte & Objekte» (docs/karte-objekte.md · «Home»). With no Einsatz open it IS the start for an
  // account (lib/karte/home · appScreen), at `/`. Over an OPEN Einsatz it shows only when entered
  // on purpose — a deep link at start, or the Einsatz menu's «Karte & Objekte» row — at `/karte`,
  // the Einsatz kept open behind it (the Objektbesuche's rule). It stays entered while a visit
  // started FROM it is open (/besuche…, contract C1 · `from=karte`), so the way back lands on it.
  const karteRoute = useKarteRoute()
  const [karteEntered, setKarteEntered] = useState(() => isKartePath(window.location.pathname))
  /** entered from an Einsatz: the viewer says where it picked up again (KarteApp · announceReturn) */
  const [karteFromEinsatz, setKarteFromEinsatz] = useState(false)
  // ⚠️ A REPLACE, not a push: the viewer is an operational screen now, and those have no history
  // entry behind them for an iOS edge swipe to find (objectVisits/route). The way back into the
  // Einsatz is its red chip / the «Einsätze» sheet. The Einsatz's own entries (its Checkliste's
  // levels, lib/historyTrail) are walked back FIRST: a replace on top of them would leave them
  // behind the viewer, and walking them back after it would land on «/» and drop the viewer.
  // Leaving an ABGESCHLOSSENES Einsatz forgets it on this device: nothing runs behind the viewer,
  // so no later reload or launch may bring it back (owner, 20.10.2026).
  const enterKarte = useCallback(() => {
    if (activeMeta?.is_archived) savePrefs({ ...loadPrefs(), incidentId: undefined })
    leaveAppEntries('/', () => { setKarteEntered(true); setKarteFromEinsatz(true); navigateTo(KARTE_BASE, { replace: true }) })
  }, [activeMeta?.is_archived])
  // left by the browser's own back (neither the viewer nor a visit from it): the entry is spent
  if (!karteRoute && !ovRoute && karteEntered) { setKarteEntered(false); setKarteFromEinsatz(false) }
  const karteOverEinsatz = !!karteRoute && !karteEntered && !!activeId && !linkScoped
  useEffect(() => { if (karteOverEinsatz) navigateTo('/', { replace: true }) }, [karteOverEinsatz])
  // a back gesture onto /besuche over a running Einsatz: the Einsatz stays, and so does its address
  // — unless the visit was opened from «Karte & Objekte» over it: leaving walks back to the viewer's
  // own address (leaveAppEntries is a traversal, so /besuche stands for a moment), and replacing
  // that with `/` dropped the viewer and landed in the Einsatz
  const ovOverEinsatz = !!ovRoute && !ovEntered && !!activeId && !linkScoped && !karteEntered
  useEffect(() => { if (ovOverEinsatz) navigateTo('/', { replace: true }) }, [ovOverEinsatz])
  /** a visit from the viewer: the Objektbesuche surface takes over at that address, and leaving it
   *  returns to the viewer's own address */
  const openVisitsFromKarte = useCallback((href: string) => {
    setOvReturn(isKartePath(window.location.pathname) ? `${window.location.pathname}${window.location.search}` : '/')
    setKarteFromEinsatz(false); setOvEntered(true); navigateTo(href)
  }, [])
  /** Bring the open Einsatz back in front of whatever covers it — the viewer or the Objektbesuche
   *  (an Atemschutz row's «Zum Trupp», the red chip, its row in the «Einsätze» sheet). It never
   *  stopped running behind them, so nothing reopens: the surface just steps aside. */
  const uncoverEinsatz = useCallback(() => {
    setOvReturn(null); setOvEntered(false); setKarteEntered(false); setKarteFromEinsatz(false)
    const p = window.location.pathname
    if (isOvPath(p) || isKartePath(p)) leaveAppEntries('/')
  }, [])
  // landing-card utilities (no incident open): device settings / help / install guide
  const [landingSheet, setLandingSheet] = useState<null | 'settings' | 'help' | 'install'>(null)
  // Rückmeldung: something went wrong recently and the cooldown has passed → ask on the
  // LAUNCHER, never inside an incident. Read once at mount; the log only grows during an
  // incident, and by then this branch isn't rendered anyway.
  const [trouble, setTrouble] = useState<TroubleEvent | null>(() => pickTrouble(readTrouble(), Date.now()))
  const [feedbackFor, setFeedbackFor] = useState<TroubleEvent | 'plain' | null>(null)
  // Note a full device storage for the same prompt. Subscribed here rather than inside
  // lib/idb's setDegraded on purpose: that runs ON the failing write, and answering a failed
  // localStorage write with ANOTHER localStorage write is both futile and a side effect on the
  // one path that must stay minimal. App is mounted for the whole session, so nothing is missed.
  useEffect(() => onStorageDegraded((d) => { if (d) recordTrouble('storageFull') }), [])
  // existing incident opened in the wizard for in-place correction (PATCH, not create)
  const [editMeta, setEditMeta] = useState<IncidentMeta | null>(null)
  // always-on Divera watch: surfaces fresh alarms wherever the EL is (editor only).
  // Off in the demo: taking an alarm opens a NEW Einsatz, which the demo blocks server-side
  // («In der Demo können keine neuen Einsätze übernommen werden»), so both take surfaces —
  // the mid-incident banner and the landing take-card — would only offer a dead end. The
  // demo's story is the one running Einsatz; a leftover pool row must not compete with it.
  const { alarms: poolAlarms, refresh: refreshPool } = useDiveraWatch(isEditor && !isDemoMode())
  // per-device dismiss of pool alarms (kp.divera.dismissed) — «×» hides a dispatch on THIS
  // tablet only; it never archives it for the crew. Shared store with the incoming-alarm banner.
  const [dismissedAlarms, setDismissedAlarms] = useState<Set<number>>(loadDismissedAlarms)
  // always-on incident-list watch: with alarm auto-open an Einsatz can appear with no human
  // in the loop — keep the list fresh and announce mid-session arrivals (banner, never a
  // forced switch). Enabled for viewers too; announcing is read-only.
  const onWatchList = useCallback((list: IncidentMeta[]) => {
    setIncidents((prev) => (sameIncidentList(prev, list) ? prev : list))
  }, [])
  // (off for a link session: the list endpoint isn't on its allowlist — it would leak every
  // other Einsatz — so the watch would just 403 every 30 s)
  const { fresh: freshIncident, dismiss: dismissFreshIncident } = useIncidentWatch(!!user && !linkScoped, activeId, onWatchList)

  // A tapped «Neuer Einsatz» push routes here (target 'divera'): re-poll the pool
  // immediately so the alarm is on screen (landing card / mid-incident banner) — not just
  // a focused window that waits for the next 30 s tick. Two delivery paths (sw-notify.js):
  // postMessage while the app is running, and the ?kpn= boot param when the tap
  // cold-started a killed app. Editor only — viewers can't take alarms; per-incident
  // targets (atemschutz/journal) are claimed by IncidentWorkspace once mounted.
  useEffect(() => {
    if (!isEditor) return
    // the home-screen badge the push set (sw-notify.js) is cleared now that the alarm is on screen
    const openPool = () => { clearAppBadge(); void refreshPool() }
    if (claimBootNotifyTarget(['divera'])) openPool()
    const sw = typeof navigator !== 'undefined' ? navigator.serviceWorker : undefined
    if (!sw) return
    const onMsg = (e: MessageEvent) => {
      if (e.data?.type === 'kp-notification-click' && e.data.target === 'divera') openPool()
    }
    sw.addEventListener('message', onMsg)
    return () => sw.removeEventListener('message', onMsg)
  }, [isEditor, refreshPool])
  // A tapped «Neuer Objektbesuch» push (target 'besuch:<id>') while the app runs: open that visit.
  // A killed app is opened by the service worker straight onto /besuche/<id> (sw-notify.js).
  useEffect(() => {
    const sw = typeof navigator !== 'undefined' ? navigator.serviceWorker : undefined
    if (!sw || linkScoped) return
    const onMsg = (e: MessageEvent) => {
      const target = e.data?.type === 'kp-notification-click' ? e.data.target : null
      if (typeof target !== 'string' || !target.startsWith('besuch:')) return
      setOvReturn(null)
      setOvEntered(true)
      navigateTo(ovHref({ kind: 'visit', id: target.slice('besuch:'.length) }))
    }
    sw.addEventListener('message', onMsg)
    return () => sw.removeEventListener('message', onMsg)
  }, [linkScoped])
  const [taking, setTaking] = useState<number | null>(null) // divera_id mid-take
  // incident just opened one-tap → show the correct-in-place review banner until confirmed
  const [reviewPendingId, setReviewPendingId] = useState<string | null>(null)
  // …and the same banner for an Einsatz that opened ITSELF: nobody reviewed the dispatch's
  // guesses on the way in any more, so the FIRST editor to look at it gets the offer — once for
  // the whole crew, not once per tablet. Answering it here remembers it on the device
  // (kp.incident.reviewed, instant + offline) and hands the moment to IncidentWorkspace, which
  // publishes it into the incident's workspace blob for everyone else (lib/incidentAlerts).
  const [reviewedIncidents, setReviewedIncidents] = useState<Set<string>>(loadReviewedIncidents)
  const [reviewedStamp, setReviewedStamp] = useState<{ id: string; at: string } | null>(null)
  const markReviewed = useCallback((id: string) => {
    saveReviewedIncident(id)
    setReviewedIncidents(loadReviewedIncidents())
    setReviewedStamp({ id, at: new Date().toISOString() })
    setReviewPendingId(null)
  }, [])
  const syncRef = useRef<WorkspaceSync | null>(null)
  const selectReq = useRef(0) // guards against interleaved incident switches (fast double-taps)
  // where «Zurück» from an archived read-only view lands: the editable incident that was
  // active before the (first) read-only open — chained archived views keep the original.
  // Refs mirror the states because selectIncident is a stable ([] deps) callback.
  const archiveReturnRef = useRef<string | null>(null)
  const activeIdRef = useRef<string | null>(null)
  const forceReadOnlyRef = useRef(false)
  useEffect(() => { activeIdRef.current = activeId }, [activeId])
  useEffect(() => { forceReadOnlyRef.current = forceReadOnly }, [forceReadOnly])
  // closed or reopened on another device, and this device's own close/reopen markers
  // (lib/useIncidentLifecycle — the actions are `useCloseReopen`, below selectIncident)
  const { lifecycleElsewhere, markOpened, closingLocallyRef, reopeningLocallyRef } = useIncidentLifecycle({
    activeMeta, incidents, setActiveMeta, setIncidents, setForceReadOnly, archiveReturnRef,
  })

  // Night ergonomics: when the theme pref is 'auto', track daylight at the incident
  // coordinate so the UI dims itself after dusk (manual day/night overrides win).
  useAutoTheme(activeMeta?.lng != null && activeMeta?.lat != null ? [activeMeta.lng, activeMeta.lat] : null)

  const refreshList = useCallback(async () => {
    const { list } = await listIncidentsResilient().catch(() => ({ list: [] as IncidentMeta[] }))
    setIncidents(list)
    return list
  }, [])

  const selectIncident = useCallback(async (id: string, opts: { readOnly?: boolean; meta?: IncidentMeta; boot?: boolean } = {}) => {
    // ⚠️ THE AUDIO UNLOCK LIVES HERE, before the first `await`, because this is the first touch of
    // every Einsatz: the launch card, the switcher, «Einsatz eröffnen». A browser only releases
    // audio inside a real gesture, and the only caller that ever did this was the Atemschutz
    // Trupp-Formular — so anyone who synced the Trupps from a second device, or only ever tapped
    // «Kontakt», had a bell showing «an» over an AudioContext that was still `suspended`. Called
    // on a boot auto-open too, where it is a harmless no-op that leaves the context suspended and
    // the bell honestly saying «Ton nicht freigegeben» (see useAtemschutzMute).
    unlockAlarm()
    const my = ++selectReq.current // any newer call supersedes this one
    const opening = activeIdRef.current !== id
    if (opts.readOnly) {
      if (!forceReadOnlyRef.current) archiveReturnRef.current = activeIdRef.current
    } else {
      archiveReturnRef.current = null
    }
    if (syncRef.current) { await syncRef.current.flush().catch(() => {}); syncRef.current.dispose(); syncRef.current = null }
    const sync = new WorkspaceSync(id, {
      debounceMs: appConfig.sync.saveDebounceMs,
      // An Atemschutz-Link session may write the Überwachungstafel and nothing else — the full
      // workspace PUT 403s for it — so its pushes and its teardown beacon go down the trupp
      // slice route. Everything else about the engine (cache, debounce, 409 merge, retry) is
      // unchanged: the merge still reasons about the whole blob, because the server's copy has
      // one. Read as of THIS call: selectIncident is a stable ([] deps) callback, and the
      // link_kind cannot change without a fresh session anyway.
      ...(asLinkRef.current ? { slice: 'trupps' as const } : isElRef.current ? { slice: 'record' as const } : {}),
      // Concurrent edits are auto-merged three-way (see mergeWorkspace), so no blocking
      // dialog — just a quiet notice. The merged result is applied in place via onApplyMerged
      // (registered by the live view); onServerWorkspace is the remount fallback.
      // one pill, however many merges: three devices saving at once stacked it (UX.9, 09.11.2026)
      onMerged: () => toast(appConfig.copy.toast.merged, { kind: 'ws-merged' }),
      onServerWorkspace: (ws) => { setWorkspace(ws); setRemount((n) => n + 1) },
    })
    const meta = opts.meta ?? (await getIncident(id))
    if (selectReq.current !== my) { sync.dispose(); return } // superseded mid-flight
    const { workspace: ws, rev } = await sync.init()
    if (selectReq.current !== my) { sync.dispose(); return } // superseded mid-flight
    syncRef.current = sync
    markOpened()
    setActiveMeta(meta as IncidentMeta)
    // Make sure the open switcher list contains the one we just opened. Normally it already
    // does, but a just-reactivated incident was archived (hence absent) — without this the
    // switcher shows "keine offenen Einsätze" right after reactivating. Read-only opens
    // (viewing an archived incident from Verlauf) must NOT join the open list.
    if (!opts.readOnly) {
      const m = meta as IncidentMeta
      setIncidents((list) => {
        const arr = list ?? []
        return arr.some((i) => i.id === id) ? arr.map((i) => (i.id === id ? m : i)) : [m, ...arr]
      })
    }
    // Demo: rebase the SCBA clocks to the visitor's ARRIVAL so a late visitor doesn't land on an
    // overdue alarm (the seed's clocks are as-of the last server reset). The anchor is remembered
    // per tab + seed, so a refresh keeps the clocks running instead of shunting them backwards —
    // and the UNTOUCHED seed is the only thing it may ever touch, because the demo Einsatz is
    // shared across devices the moment anyone works it (see workspace · demoSeedRebase).
    const seed = ws && isDemoMode() ? demoSeedRebase(ws, id, rev) : ws
    setWorkspace(seed)
    setForceReadOnly(!!opts.readOnly)
    setActiveId(id)
    setCoverId(opening ? id : null)
    setRemount((n) => n + 1)
    // ⚠️ A HUMAN open leaves «Karte & Objekte», in the same batch as the switch — whichever door
    // it came through (the red chip, the «Einsätze» sheet, a banner, the wizard, «Alle Einsätze»):
    // otherwise the viewer, entered over the previous Einsatz, would stay on top of the new one.
    // A failed open never gets here, so the viewer stays where it was and the toast says why.
    if (!opts.boot) {
      setKarteEntered(false); setKarteFromEinsatz(false)
      if (isKartePath(window.location.pathname)) leaveAppEntries('/')
    }
    // ⚠️ `incidentChosenAt` is stamped only when a HUMAN opened this — never on the boot
    // auto-open, which would otherwise record the app's own choice as the operator's and let a
    // stale alarm keep re-confirming itself on every reload (lib/incidentAlerts · pickBootIncident).
    const prev = loadPrefs()
    // …and a hand-opened Einsatz ends the «landed after an Abschluss» state (completeRapport)
    savePrefs(opts.boot
      ? { ...prev, incidentId: id }
      : { ...prev, incidentId: id, incidentChosenAt: Date.now(), landedAt: undefined })
  }, [markOpened])

  // `selectIncident` for a HUMAN tap: the same open, but a failure is SAID. Every interactive
  // caller used to swallow the rejection — offline with no cached workspace, a 404 for an Einsatz
  // archived since the list was written, the 20 s bound on a half-open link — so the card simply
  // did nothing, which at 3am reads as «the app is frozen» and invites more taps. The server's
  // own {detail} wins where it exists (and its hint rides along); silence (status 0) means the
  // workspace is not on this device, which is the one thing worth saying then.
  const openIncident = useCallback(async (id: string, opts?: Parameters<typeof selectIncident>[1]): Promise<void> => {
    setOpening(id)
    try {
      await selectIncident(id, opts)
    } catch (e) {
      const C = appConfig.copy.incidentSwitcher
      const text = !(e instanceof ApiError) ? C.openFailed
        : e.status === 0 ? C.openFailedNoCache
        : e.hint ? `${e.detail} – ${e.hint}` : e.detail
      toast(text, { icon: 'warn', tone: 'warn' })
    } finally {
      setOpening((cur) => (cur === id ? null : cur)) // a newer open may already own the state
    }
  }, [selectIncident])

  // boot: list → migrate legacy localStorage if empty → open remembered/first incident.
  // Offline (network error), fall back to the cached list so the last incident reopens
  // from the WorkspaceSync cache — with an honest one-shot toast that the list is cached.
  // The auto-open itself stays silent when it fails: it lands on home, whose «Einsätze» sheet
  // says what is wrong the moment it is tapped (openIncident).
  useEffect(() => {
    const bootOpen = async (inc: IncidentMeta, opts: { readOnly?: boolean } = {}) => {
      const my = ++bootOpenSeq.current
      setBootOpening(true)
      try {
        await selectIncident(inc.id, { meta: inc, boot: true, readOnly: opts.readOnly })
      } catch { /* home + openIncident's toast on the next tap */ } finally {
        if (bootOpenSeq.current === my) setBootOpening(false)
      }
    }
    void (async () => { try {
      // Link session: there is exactly one incident and no list to pick from — fetch it by id
      // and open it. (GET /api/incidents is not on the link allowlist, so listing here would
      // 403 and land a responder on an empty launcher instead of the Einsatz they were sent.)
      if (linkIncidentId) {
        const inc = await getIncident(linkIncidentId).catch(() => null)
        setIncidents(inc ? [inc as IncidentMeta] : [])
        if (inc) await bootOpen(inc as IncidentMeta)
        return
      }
      let { list, offline } = await listIncidentsShared().catch((e: unknown) => {
        // A REFUSAL, not silence (isUnverifiable already turned silence into the cached list):
        // the launcher would otherwise render «keine offenen Einsätze» over a list that simply
        // failed, with nothing on screen to say so.
        const C = appConfig.copy.incidentSwitcher
        toast(e instanceof ApiError ? `${C.bootListFailed} – ${e.detail}` : C.bootListFailed, { icon: 'warn', tone: 'warn' })
        return { list: [] as IncidentMeta[], offline: false }
      })
      // re-list only when the migration created an Einsatz: an empty list is the normal peacetime
      // boot, and asking again cost every such launch a second round trip (01.11.2026)
      if (list.length === 0 && !offline) {
        const migrated = await migrateLegacyWorkspace([appConfig.storage.key, ...appConfig.storage.legacyKeys]).catch(() => null)
        if (migrated) list = (await listIncidentsResilient().catch(() => ({ list: [] as IncidentMeta[] }))).list
      }
      if (offline) toast(appConfig.copy.incidentSwitcher.bootOffline, { icon: 'warn' })
      setIncidents(list)
      // The decision table lives in lib/karte/home · bootPlan (tested there), in this order:
      // · a launch INTO Objektbesuche (a deep link, a reload on /besuche) — or into «Karte &
      //   Objekte» (/karte) — opens no Einsatz behind it: leaving the surface lands on home, not
      //   on yesterday's Einsatz;
      // · the remembered incident normally wins, but a NEWER alarm-created incident takes
      //   precedence: a killed app reopens onto the live alarm, not yesterday's Einsatz
      //   (incidentAlerts · pickBootIncident, with the landed-after-an-Abschluss and crash rules);
      // · nothing picked: home — Karte & Objekte for an account (owner, 16.10.2026 · variant B).
      const bootPrefs = loadPrefs()
      const plan = bootPlan(window.location.pathname, list, bootPrefs, { now: Date.now() })
      if (plan.kind === 'open') { await bootOpen(plan.incident); return }
      // ⚠️ Nothing picked does NOT mean «nothing to go back to». The list boot works from holds
      // only the OPEN Einsätze, so an abgeschlossener one — viewed read-only out of «Alle
      // Einsätze», or closed by a colleague while it was on screen — is invisible to
      // `pickBootIncident` and a reload dropped the operator onto the start, which with
      // the launch card's Brand and Anmelde-Untertitel read as «ich bin abgemeldet worden». It is
      // fetched by id (it is not in the list to look up) and reopened READ-ONLY, exactly as «Alle
      // Einsätze» opens it — «Wieder öffnen» stays the one way back to editing. Only on a reload:
      // a fresh launch lands at home. Bounds: incidentAlerts · shouldReopenClosed.
      if (plan.kind !== 'closed') return
      const saved = await getIncident(plan.id).catch(() => null)
      const nav = performance.getEntriesByType('navigation')[0] as PerformanceNavigationTiming | undefined
      if (saved && shouldReopenClosed(saved, { now: Date.now(), reload: nav?.type === 'reload', chosenAt: bootPrefs.incidentChosenAt })) {
        await bootOpen(saved, { readOnly: saved.is_archived })
      }
    } finally { setBootDecided(true) } })()
  }, [selectIncident, linkIncidentId])

  // Forget the crash streak once an incident has proven healthy: on a CLEAN leave (a switch, a
  // close — the boundary's own escapes clear it themselves) or after CRASH_HEALTHY_MS. It used to
  // clear 15 s after mount, which only ever covered a crash on boot: one that happens when a
  // surface is opened later (a malformed Trupp on the Atemschutz board, a bad annotation on one
  // plan) restarted at n = 1 after every reload, so the destructive recovery never appeared even
  // though the loop was real. A crash never runs this cleanup — the boundary swaps the workspace
  // out without changing `activeId`, and «Neu laden» reloads the page.
  useEffect(() => {
    if (!activeId) return
    const since = Date.now()
    const t = setTimeout(clearCrash, CRASH_HEALTHY_MS)
    return () => {
      clearTimeout(t)
      // a leave within the first second is StrictMode's dev-only remount, not a decision — it
      // must not wipe the streak the reload just carried over
      if (Date.now() - since > 1_000) clearCrash()
    }
  }, [activeId])

  const openCreated = useCallback(async (inc: IncidentFull) => {
    setOverlay(null)
    await refreshList()
    await selectIncident(inc.id, { meta: inc })
  }, [refreshList, selectIncident])

  // One-tap Divera take: create the incident from the alarm AS-IS (everything Divera
  // carries + backend type/priority/geocode), drop straight onto the live map, and arm the
  // in-map review banner. No wizard — corrections happen on the map, never blocking it.
  // Undo a one-tap take: archive the just-created incident and return to the prior view — the
  // Einsatz that was open when the alarm was taken (`back`, its id), else home. Always targets
  // the passed id (the take made it active) — no activeId dep, so the toast's captured closure
  // can't go stale. Taken from «Karte & Objekte» (`back: 'karte'`): the undo returns THERE, as the
  // mockup's j8 does — not into another open Einsatz the operator was not looking at.
  // ⚠️ Never into `list[0]` (sweep 09.11.2026, UX.7): with an Übung and a real Einsatz open that
  // was the other one. An Einsatz that is gone meanwhile, or does not open, is home too.
  const undoTake = useCallback(async (id: string, back: 'karte' | { incidentId: string | null }) => {
    if (syncRef.current) { syncRef.current.dispose(); syncRef.current = null }
    // this device's own archive — not «auf einem anderen Gerät abgeschlossen» (lib/incidentClosed)
    closingLocallyRef.current = id
    // ⚠️ SAY SO when the undo does not go through. A swallowed failure here left the incident on
    // the server, refreshed the list, and dropped the operator back onto it with no explanation —
    // an Einsatz that reappears by itself is how a tool stops being believed.
    try {
      await archiveIncident(id)
    } catch (e) {
      closingLocallyRef.current = null
      toast(e instanceof ApiError ? e.detail : appConfig.copy.abschluss.failed, { icon: 'warn', tone: 'warn' })
      return
    }
    // ⚠️ the hard clear, deliberately — «Rückgängig» on a one-tap take means this incident should
    // never have existed, so keeping its blobs would leave an orphan queue nothing ever drains.
    // Every other archive path keeps what is still pending (clearUploadedMedia).
    await clearIncidentMedia(id).catch(() => {})
    if (closingLocallyRef.current === id) closingLocallyRef.current = null
    setReviewPendingId(null)
    const list = await refreshList() // returns non-archived only → the taken incident is gone
    setActiveId(null); setActiveMeta(null)
    // home: where the take started, or all that is left; the undone Einsatz is not remembered either
    savePrefs({ ...loadPrefs(), incidentId: undefined })
    setWorkspace(null); setForceReadOnly(false)
    const previous = back === 'karte' ? null : undoTakeReturn(list, back.incidentId)
    if (previous) await openIncident(previous.id, { meta: previous }) // says so when it fails
    void refreshPool()
  }, [closingLocallyRef, refreshList, openIncident, refreshPool])

  const takeAndOpen = useCallback(async (a: DiveraAlarm, from?: 'karte') => {
    if (taking != null) return
    const back = from ?? { incidentId: activeId } // read before the take makes its own Einsatz active
    setTaking(a.divera_id)
    try {
      const inc = await takeDiveraAlarm(a.divera_id)
      await openCreated(inc)
      setReviewPendingId(inc.id)
      // confirm-with-undo: a one-tap take is otherwise only reversible via a multi-tap
      // menu-archive. Undo archives the just-created incident and returns to the prior view.
      // Twelve seconds, not the six-second floor: the map is filling in underneath, and «did I
      // mean that?» takes longer at 3am than a toast that is already fading.
      toast(appConfig.copy.intake.taken, {
        icon: 'check', tone: 'success', duration: 12_000,
        action: { label: appConfig.copy.undo, onClick: () => void undoTake(inc.id, back) },
      })
    } catch (e) {
      toast(e instanceof ApiError ? e.detail : appConfig.copy.intake.errorTake, { icon: 'warn', tone: 'warn' })
    } finally {
      setTaking(null)
      void refreshPool()
    }
  }, [taking, activeId, openCreated, refreshPool, undoTake])

  // Split dispatch: the banner alarm may be the SAME Einsatz already open (reworded group
  // dispatch, Nachalarm) — attach it to the ACTIVE incident instead of opening a duplicate.
  // The banner only renders mid-incident, so the target is always the Einsatz being worked;
  // to attach to a different open incident, switch there first. Confirm-with-context (not a
  // picker sheet): the Meldung lands in the Verlauf, milestones follow, title/pin unchanged.
  const attachToActive = useCallback(async (a: DiveraAlarm) => {
    if (!activeMeta) return
    const ix = appConfig.copy.intake
    const ok = await confirmDialog({
      title: fillTemplate(ix.attachConfirmTitle, { alarm: a.title }),
      message: ix.attachHint,
      confirmLabel: ix.attachConfirm,
      cancelLabel: appConfig.copy.cancel,
    })
    if (!ok) return
    try {
      await attachDiveraAlarm(a.divera_id, activeMeta.id)
      toast(ix.attachDone, { icon: 'check', tone: 'success' })
    } catch (e) {
      toast(e instanceof ApiError ? e.detail : ix.attachError, { icon: 'warn', tone: 'warn' })
    } finally {
      void refreshPool()
    }
  }, [activeMeta, refreshPool])

  /** Show an already-saved incident's new facts without remounting anything — the active meta
   *  and its row in the list, no location/center change. Used by the Einsatzdaten correction.
   *  (It was also shared with an inline patch from the review banner until 23.08., when that
   *  banner became a Meldeleiste row and its Kategorie dropdown moved into the edit panel.) */
  const reflectMeta = useCallback((updated: IncidentMeta) => {
    setActiveMeta(updated)
    setIncidents((list) => (list ?? []).map((i) => (i.id === updated.id ? updated : i)))
  }, [])

  // ── close / reopen: lib/useIncidentLifecycle ──
  /** the open Einsatz's counting confirm, set by IncidentWorkspace (prop `abschlussRef`) */
  const abschlussHereRef = useRef<(() => Promise<boolean>) | null>(null)
  const { completeRapport, archiveById, reactivateById } = useCloseReopen({
    closingLocallyRef, reopeningLocallyRef, activeId, activeMeta, incidents, syncRef, archiveReturnRef, refreshList,
    selectIncident, markOpened, setIncidents, setClosedMedia, setActiveId, setActiveMeta, setWorkspace, setForceReadOnly,
    abschlussHereRef,
    // the list steps aside and the Einsatz comes to the front: its confirm can answer «Zur Tafel»
    showEinsatz: useCallback(() => { setOverlay(null); uncoverEinsatz() }, [uncoverEinsatz]),
  })

  // «Zurück» from an archived read-only view: return to the incident that was active before,
  // else land on home with «Alle Einsätze» open (the sheet the view was entered from).
  const backFromArchive = useCallback(async () => {
    const backId = archiveReturnRef.current
    archiveReturnRef.current = null
    if (backId && (await selectIncident(backId).then(() => true).catch(() => false))) return
    // a read-only view holds no unsaved edits — dispose without flushing; and forget it, or the
    // next reload reopens the Einsatz just left
    if (syncRef.current) { syncRef.current.dispose(); syncRef.current = null }
    savePrefs({ ...loadPrefs(), incidentId: undefined })
    setActiveId(null); setActiveMeta(null); setForceReadOnly(false)
    setOverlay('history')
  }, [selectIncident])

  // Which screen (lib/karte/home · appScreen — tested there): the Objektbesuche surface, «Karte &
  // Objekte», the boot's splash, an Einsatz, or — for a link session only — the launch card.
  const ovShown = showsObjectVisits({ routeOn: !!ovRoute, entered: ovEntered, incidentOpen: !!activeId, linkSession: linkScoped })
  // (a visit opened from the viewer over an Einsatz, on its way back: /besuche stands until the
  //  traversal lands — the viewer, never a frame of the Einsatz's workspace)
  const screen = appScreen({
    linkSession: linkScoped, visitsShown: ovShown, karteRoute: !!karteRoute || (karteEntered && !!ovRoute), karteEntered, activeId: !!activeId,
    workspaceReady: activeMeta != null, listLoaded: incidents !== null, bootDecided, bootOpening,
  })
  /** a surface stands in front of the open Einsatz, which stays mounted behind it (covered) */
  const einsatzBehind = screen === 'karte' || screen === 'visits'

  // Objektbesuche: the whole screen, home or not — and it does not wait for the Einsatz list.
  // The Meldeleiste and the toast/confirm host stay, the surface's own dialogs need them.
  // Incident list still loading after auth: keep the boot Splash up rather than a blank
  // colour flash, so the launch stays continuous from /me probe → list → workspace.
  if (screen === 'splash') return <Splash />
  // …and through the boot auto-open, named: home would only flash for the seconds the workspace
  // takes to arrive. The splash's own 9 s «Neu starten» stays a harmless escape.
  if (screen === 'opening') return <Splash sub={appConfig.copy.incidentLink.opening} />

  // --- ErrorBoundary escapes (see lib/crashLoop) -------------------------------------------
  // «Neu laden» alone can't recover a workspace whose own data throws: boot auto-reopens the
  // last incident, so the reload lands straight back on the crash. These two give the operator
  // a way off it without a dedicated admin surface.
  //
  // Lossless: forget the remembered incident and drop to home, where a DIFFERENT Einsatz (or a
  // fresh one) can be opened. Nothing is archived and nothing is deleted — the crashing incident
  // is still there, and still on the server.
  const escapeToLanding = () => {
    savePrefs({ ...loadPrefs(), incidentId: undefined })
    clearCrash()
    if (syncRef.current) { syncRef.current.dispose(); syncRef.current = null }
    setActiveId(null); setActiveMeta(null); setWorkspace(null); setForceReadOnly(false)
  }

  // Last resort, only offered after reopening has already failed once: the crash is coming from
  // the cached copy on THIS device, so drop it and reload — the next open re-pulls from the
  // server. Destructive for unsynced edits, which is why the boundary warns before offering it.
  const discardLocalAndReload = (id: string) => {
    void discardWorkspaceCache(id)
      .catch(() => {})
      .finally(() => { clearCrash(); location.reload() })
  }

  const allIncidents = incidents ?? []
  // «Abmelden» at home asks first, like the Einsatz-Menü's (lib/logoutConfirm). With no Einsatz
  // open there is no live store to ask, so the unsent Verlauf rows are read off the persisted
  // outboxes of every Einsatz this device knows.
  const askLogout = async () => {
    const unsyncedEntries = await persistedPendingRows(allIncidents.map((i) => i.id))
    if (await confirmLogout({ online: navigator.onLine, unsyncedEntries })) await logout()
  }

  // The launcher card's content: the open Einsätze to resume + the Divera alarms to take, shown
  // directly (no "Kein offener Einsatz" dead-end), with manual create always on. Since variant B
  // (16.10.2026) an account never sees the card — home is «Karte & Objekte», whose «Einsätze ▾»
  // opens the app menu (components/HomeMenus · HomeMenu); only a LINK session whose Einsatz could not be fetched
  // still lands on it (lib/karte/home · appScreen), which is why its account-only rows stay.
  const openIncidents = allIncidents.filter((i) => !i.is_archived)
  // ⚠️ The alarms that will ACTUALLY render, dismissals included. `hasLanding` (LauncherBody) counted the raw
  // pool while the list below filtered out anything dismissed on this device — so once every
  // pool alarm had been ×-ed away, the card took the launcher branch, rendered an EMPTY list
  // (with its own margin) and skipped the sentence explaining what to do. A hole where the
  // explanation should be, on the one screen whose whole job is «what now».
  const landingAlarms = isEditor ? poolAlarms.filter((a) => !dismissedAlarms.has(a.divera_id)) : []
  const hideAlarm = (a: DiveraAlarm) => setDismissedAlarms(dismissAlarm(a.divera_id))
  // an alarm taken from the viewer undoes back to it (undoTake)
  const takeBack = screen === 'karte' ? 'karte' as const : undefined

  // the open Einsatz itself, while a surface covers it: step aside instead of reopening it
  const openOrUncover = (i: IncidentMeta) => {
    if (i.id === activeId && activeMeta && einsatzBehind) uncoverEinsatz()
    else void openIncident(i.id, { meta: i })
  }

  // the two home menus (components/HomeMenus): the launcher card and «Einsätze ▾» on the viewer
  const home: HomeActions = {
    trouble, onTrouble: (t) => { setFeedbackFor(t); setTrouble(null) }, onTroubleDismiss: () => setTrouble(null),
    linkScoped, isEditor,
    user: { display_name: user?.display_name ?? '', color: user?.color ?? null, role: user?.role ?? 'viewer' },
    incidents: allIncidents, activeId, opening, alarms: landingAlarms, taking,
    onTake: (a) => void takeAndOpen(a, takeBack),
    onDismissAlarm: hideAlarm,
    onOpenIncident: openOrUncover,
    onHistory: () => setOverlay('history'),
    onCreate: () => setOverlay('create'),
    onObjectVisits: objectVisitsConfig().enabled ? () => enterObjectVisits() : undefined,
    onSettings: () => setLandingSheet('settings'),
    onHelp: () => setLandingSheet('help'),
    onInstall: !isStandalone() && installOffered(getInstallPlatform()) ? () => setLandingSheet('install') : undefined,
    onLogout: () => void askLogout(),
  }

  // the viewer's red chip: the Einsatz it was entered from first, else the newest running one
  const runningNow = openIncidents.filter((i) => isIncidentRunning(i))
    .sort((a, b) => (a.id === activeId ? -1 : b.id === activeId ? 1 : (b.started_at ?? '').localeCompare(a.started_at ?? '')))

  return (
    <>
      {showWelcome && <DemoWelcome onClose={() => { markDemoWelcomeSeen(); setShowWelcome(false) }} />}
      {/* ── Die Meldeleiste ────────────────────────────────────────────────────────────────
          ONE ranked strip for every message that has no place of its own and stays until
          somebody acts. The publishers paint nothing: each hands the strip a record, and the
          strip shows the highest-ranked one plus a +n pill for the rest (class before time —
          src/lib/meldungen.ts). It is not in the DOM at all while nothing is pending.
          ⚠️ Mounted at APP root, not in IncidentWorkspace: `NewIncidentBanner` publishes when a
          colleague takes an Einsatz or one auto-opens, and that can happen with NO incident open
          — inside the workspace the strip would not be mounted and the message would vanish.
          ⚠️ …but while an Einsatz IS open it paints inside that workspace's `.app` (a portal,
          lib/meldeleisteHost): `.app` is its own stacking context, and from out here the strip
          lay over the top bar's menus (staging r5, N3).
          ⚠️ It replaced five top banners on one axis and four bottom cards on one coordinate.
          Do not add a sixth floating card: either the message has a PLACE — then it belongs in
          that surface, the way ShiftConflictNotice does — or it belongs in this strip. */}
      {/* …on the Atemschutz-Link only the rows that block work (meldungen · linkShowsMeldung) */}
      <Meldeleiste only={asLink ? linkShowsMeldung : undefined} />
      {/* the session cookie died mid-Einsatz (lib/auth · sessionExpired): every request 401s,
          the badge cannot say why. Published HERE so it shows with or without an open Einsatz;
          it ends only by signing in again, which is what its one button does. */}
      {sessionExpired && (
        // a link session has no account whose sign-in could send anything
        <SessionExpiredMeldung onRelogin={() => void askLogout()} name={user && !user.link_scoped ? user.display_name : undefined} />
      )}
      {/* ⚠️ The open Einsatz stays MOUNTED while «Karte & Objekte» or the Objektbesuche are in
          front of it (`covered`): its sync, its live poll and its Atemschutz alarm keep running,
          and the alarm's rows stand in the strip over that surface (IncidentWorkspace · covered;
          lead decision 16.10.2026). One element in one place, so covering and uncovering never
          remount it. */}
      {(screen === 'einsatz' || (einsatzBehind && !linkScoped)) && activeId && activeMeta && syncRef.current ? (
        <ErrorBoundary
          /* Keyed on activeId ONLY (not `remount`): a background remount — the live-follow
             poll, a resolved 409 calling onServerWorkspace — must NOT reset a latched crash,
             or the boundary re-renders the same throwing workspace in a flicker loop. It
             resets on a deliberate incident change, which is exactly what the escapes do. */
          key={`eb:${activeId}`}
          scopeId={activeId}
          onCloseIncident={escapeToLanding}
          onDiscardLocal={() => discardLocalAndReload(activeId)}
          hasUnsyncedChanges={() => (syncRef.current?.syncStatus ?? 'synced') !== 'synced'}
        >
        <IncidentWorkspace
          key={`${activeId}:${remount}`}
          incidentMeta={activeMeta}
          incidents={allIncidents}
          workspace={workspace}
          sync={syncRef.current}
          forceReadOnly={forceReadOnly}
          tabLockLost={!tabLock.held}
          onTakeOverTab={tabLock.takeOver}
          // An abgeschlossener Einsatz opens read-only — the same rule «Alle Einsätze» follows
          // (HistoryPanel · onOpen), and it matters here because the menu's «Frühere» rows switch
          // straight to archived Einsätze: without it they would open editable AND join the list
          // of running ones. «Wieder öffnen» stays the one way back to editing.
          onSwitchIncident={(i) => void openIncident(i.id, { meta: i, readOnly: i.is_archived })}
          onOpenHistory={() => setOverlay('history')}
          onOpenObjectVisits={objectVisitsConfig().enabled && !linkScoped ? enterObjectVisits : undefined}
          // «Karte & Objekte» from the Einsatz menu's «App» group: the viewer over this Einsatz,
          // which stays open behind it — never for a link session (docs/karte-objekte.md)
          onOpenKarte={linkScoped ? undefined : enterKarte}
          covered={screen !== 'einsatz'}
          onUncover={uncoverEinsatz}
          // «Einsatz eröffnen» goes straight to the manual wizard — the pool sheet is gone
          // (testing feedback 2026-07-18): incoming alarms are taken via home or
          // the mid-incident banner, never via a separate pool screen.
          onOpenDivera={() => setOverlay('create')}
          onOpenDatenquellen={() => setOverlay('daten')}
          // ⚠️ There is no separate «archive the active one» prop any more. The Einsatz-Menü row
          // used to hang off `archiveById`, which archived plainly — no report_done_at, nothing
          // checked — while the Rapport path stamped and counted. Both doors run the SAME confirm
          // in IncidentWorkspace now and end here (mockup 06 · Fall 4).
          onCompleteRapport={() => completeRapport(activeMeta.id)}
          abschlussRef={abschlussHereRef}
          onReactivateActive={canLifecycle && activeMeta.is_archived ? () => reactivateById(activeMeta.id) : undefined}
          onBackFromArchive={activeMeta.is_archived ? () => void backFromArchive() : undefined}
          lifecycleElsewhere={lifecycleElsewhere?.id === activeMeta.id ? lifecycleElsewhere : null}
          openCover={coverId === activeId}
          onOpenCoverDone={clearCover}
          needsReview={
            reviewPendingId === activeMeta.id ||
            // `intakeReviewedAt` = somebody already checked this Einsatz on another device. This
            // is the blob as it stood when the Einsatz was opened; the live poll lands inside the
            // workspace, which gates the banner on the same field.
            needsIntakeReview(activeMeta, {
              isEditor, reviewed: reviewedIncidents, reviewedAt: typeof workspace?.intakeReviewedAt === 'string' ? workspace.intakeReviewedAt : undefined, now: Date.now(),
            })
          }
          onReviewDone={() => markReviewed(activeMeta.id)}
          reviewedLocallyAt={reviewedStamp?.id === activeMeta.id ? reviewedStamp.at : undefined}
          onEditMeta={() => setEditMeta(activeMeta)}
        />
        </ErrorBoundary>
      ) : screen === 'einsatz' ? (
        // the meta is in, the sync engine is not (yet, or no longer — an undone take on its way
        // out): a moment of the splash, never a flash of home
        <Splash />
      ) : null}
      {screen === 'visits' ? (
        // the Objektbesuche: the whole screen, home or not — and it does not wait for the
        // Einsatz list. The strip, the banners and the toast/confirm host are the root's.
        <Suspense fallback={<Splash />}><ObjectVisitsApp onExit={leaveObjectVisits} suggestedObjectId={activeId ? ovSuggest : null} /></Suspense>
      ) : screen === 'karte' ? (
        // «Karte & Objekte» — home with no Einsatz open, or entered over one. It does not wait for
        // the Einsatz list (the catalogue is its own read); alarms reach it through the strip and
        // the banners below: shown, never switched to by themselves (owner, 16.10.2026).
        <Suspense fallback={<Splash />}>
          <KarteApp
            einsaetze={{ badge: runningNow.length + landingAlarms.length, render: (close, onDevice) => <HomeMenu {...home} close={close} onDevice={onDevice} /> }}
            announceReturn={karteFromEinsatz}
            onOpenVisits={openVisitsFromKarte}
            running={runningNow}
            onOpenIncident={openOrUncover}
            onSettings={home.onSettings}
            onHelp={home.onHelp}
            // App's sheets and dialogs over the viewer own the keyboard (KarteApp · useKarteKeys)
            keysOff={landingSheet !== null || feedbackFor !== null || overlay !== null || showWelcome}
          />
        </Suspense>
      ) : screen === 'launcher' ? (
        <div className="ip-emptyapp">
          <IconSprite />
          <div className="ip-emptyapp-card">
            <Brand className="ip-emptyapp-brand" sub={appConfig.copy.login.subtitle} />
            <LauncherBody {...home} />
          </div>
        </div>
      ) : null}
      {/* home's device utilities (no incident open): settings / help / install, and Rückmeldung */}
      {screen !== 'einsatz' && landingSheet === 'settings' && !feedbackFor && (
        <LandingSettings
          onClose={() => setLandingSheet(null)}
          // Rückmeldung posts a diagnostic report — refused for a link session
          onFeedback={linkScoped ? undefined : () => setFeedbackFor('plain')}
        />
      )}
      {screen !== 'einsatz' && landingSheet === 'help' && <HelpOverlay onClose={() => setLandingSheet(null)} />}
      {screen !== 'einsatz' && landingSheet === 'install' && <InstallGuide onClose={() => setLandingSheet(null)} />}
      {screen !== 'einsatz' && feedbackFor && (
        <FeedbackSheet
          trouble={feedbackFor === 'plain' ? undefined : feedbackFor}
          onClose={(reason) => {
            const fromSettings = feedbackFor === 'plain' && landingSheet === 'settings'
            setFeedbackFor(null)
            if (reason === 'complete' && fromSettings) setLandingSheet(null)
          }}
        />
      )}

      {/* incoming-alarm banner: a fresh dispatch finds the EL MID-INCIDENT, one tap from
          opening on the live map (home announces alarms in its «Einsätze» sheet too — and here,
          in the strip, because the sheet is shut while somebody reads a plan). Anhängen attaches
          to the ACTIVE incident (split dispatch) — and leads the row when that incident was made
          by hand, because that is the only way its Zeiten ever fill (a manual Einsatz has no
          alarm routing times to it). Over «Karte & Objekte» there is no Einsatz being worked on
          screen, so no Anhängen there: taking opens the new one, with the 12 s «Rückgängig». */}
      {/* …and over the Objektbesuche the same: an alarm reaches a member on a visit too — this is
          a fire brigade's app. Taking it leaves the surface (the visit is saved on the device and
          sent at its save point) and opens the Einsatz exactly as home would. */}
      {isEditor && (screen === 'karte' || screen === 'visits') && (
        <IncomingAlarmBanner
          alarms={poolAlarms}
          dismissed={dismissedAlarms}
          onDismiss={hideAlarm}
          taking={taking}
          attachFirst={false}
          onTake={(a) => {
            if (screen === 'visits') { leaveObjectVisits('/'); void takeAndOpen(a) } else void takeAndOpen(a, 'karte')
          }}
        />
      )}
      {isEditor && screen === 'einsatz' && activeMeta != null && (
        <IncomingAlarmBanner
          alarms={poolAlarms}
          dismissed={dismissedAlarms}
          onDismiss={hideAlarm}
          taking={taking}
          // ⚠️ «Anhängen» only onto an Einsatz that is RUNNING (review of #235): attached to a closed
          // one, the dispatch's Zeiten and Meldung would land in a closed record
          attachFirst={activeMeta.source === 'manual' && isIncidentRunning(activeMeta)}
          onTake={(a) => void takeAndOpen(a)}
          onAttach={isIncidentRunning(activeMeta) ? (a) => void attachToActive(a) : undefined}
        />
      )}

      {/* auto-opened / colleague-taken incident announced, never forced. Suppressed while an
          alarm row SHOWS (diveraDismiss · shownAlarms) — the take banner owns that spot and the take
          flow. Never on the raw pool: a stale or ×-ed alarm shows no row and hid this one too. */}
      {closedMedia.map((p) => (
        <MediaPendingMeldung key={p.id} pending={p} onDismiss={() => setClosedMedia((cur) => cur.filter((q) => q.id !== p.id))} />
      ))}
      {freshIncident && shownAlarms(poolAlarms, dismissedAlarms).length === 0 && (
        <NewIncidentBanner
          inc={freshIncident}
          active={!!activeId}
          onSwitch={() => {
            const f = freshIncident
            dismissFreshIncident()
            if (screen === 'visits') leaveObjectVisits('/')
            void openIncident(f.id, { meta: f })
          }}
          onDismiss={dismissFreshIncident}
        />
      )}

      {(overlay === 'create' || editMeta) && (
        <EinsatzWizard
          edit={editMeta}
          nearCoord={activeMeta?.lng != null && activeMeta?.lat != null ? [activeMeta.lng, activeMeta.lat] : null}
          onClose={() => { setOverlay(null); setEditMeta(null) }}
          // ⚠️ A CORRECTION does not remount. `openCreated` re-keys IncidentWorkspace, which is
          // right when an Einsatz is opened and wrong when one is corrected: it threw the
          // operator out of whatever surface they were on (the Rapport, usually — that is where
          // the «Bearbeiten» link lives) and reset the print section toggles and the Kroki
          // reconstruction with it. `reflectMeta` is what reflects a patch in place instead.
          onCreated={(inc) => {
            const wasEdit = !!editMeta
            setEditMeta(null)
            markReviewed(inc.id)
            if (wasEdit) { setOverlay(null); reflectMeta(inc as IncidentMeta) } else void openCreated(inc)
          }}
        />
      )}
      {overlay === 'history' && (
        <HistoryPanel onClose={() => setOverlay(null)} onOpen={(id, ro) => { setOverlay(null); void openIncident(id, { readOnly: ro }) }}
          onArchive={canLifecycle ? archiveById : undefined}
          // a viewer reads only the last few days (docs/roles-and-access.md · the viewer's window)
          windowDays={user?.role === 'viewer' ? getDeploymentConfig().access?.viewerHistoryDays ?? undefined : undefined} />
      )}
      {overlay === 'daten' && (
        <DatenquellenPanel
          isEditor={isEditor}
          incidentCoord={activeMeta?.lng != null && activeMeta?.lat != null ? [activeMeta.lng, activeMeta.lat] : null}
          onClose={() => setOverlay(null)}
        />
      )}

      {/* toast/confirm host — LAST at the ROOT, not inside the workspace's .app div:
          position:fixed makes .app a stacking context, so a confirm opened from a
          root-level sheet (e.g. Reaktivieren in «Alle Einsätze») painted UNDER the
          sheet regardless of its own z-index, and home had no host at all before
          (confirms silently never appeared). Root + last ⇒ always on top.
          No toasts on the Atemschutz-Link (sweep 30.10.2026 #23): they covered the board, and
          what they said has a place there — undo on the header's ↶ ↷, the sync state on its
          mark, the blockers in the Meldeleiste. */}
      <Overlays toasts={!asLink} />
    </>
  )
}
