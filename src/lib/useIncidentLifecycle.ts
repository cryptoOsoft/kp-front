// The open Einsatz's lifecycle on this device, out of App (sweep A.7). Two hooks, because App's
// `selectIncident` sits between them: opening an Einsatz resets what the first one knows
// (`markOpened`), and the close/reopen of the second one opens Einsätze again.
//   · useIncidentLifecycle — closed or reopened ELSEWHERE (lib/incidentClosed's signals and the
//     open-list watch), told apart from this device's own close/reopen by its two markers.
//   · useCloseReopen — THE close (completeRapport) and THE reopen (reopenNow) this device runs,
//     plus the two list doors onto them (archiveById, reactivateById).
// docs/undo.md has the close toast's «Wieder öffnen».

import { useCallback, useEffect, useRef, useState, type Dispatch, type MutableRefObject, type SetStateAction } from 'react'
import type { ReactivateResult } from '../types'
import { appConfig } from '../config/appConfig'
import { isDemoMode } from './deploymentConfig'
import { toast, confirmDialog } from './ui'
import { loadPrefs, savePrefs } from './prefs'
import { clearUploadedMedia } from './mediaQueue'
import type { ClosedMediaPending } from '../components/MediaPendingMeldung'
import { closedMetaFor, closedNoticeAt, onIncidentClosed, onIncidentReopened, reopenedMetaFor, reportIncidentClosed, reportIncidentReopened, type IncidentClosedSignal, type IncidentReopenedSignal } from './incidentClosed'
import { serverNow, serverNowIso } from './serverClock'
import { ApiError, isUnverifiable } from './api'
import { archiveIncident, getIncident, isIncidentRunning, patchIncident, reactivateIncident, type IncidentMeta, type Workspace, type WorkspaceSync } from './incidents'
import { getWorkspace } from './api/workspace'
import { sanitizeWorkspace } from './workspace'
import { truppStillDeployed } from './atemschutz'
import { insideAbschlussSpec } from './abschlussOpen'

/** the Einsatz closed — or reopened — on ANOTHER device while it was open here, and when */
export type LifecycleElsewhere = { id: string; event: 'closed' | 'reopened'; at: number }

type SetIncidents = Dispatch<SetStateAction<IncidentMeta[] | null>>

/**
 * What this device knows about the open Einsatz's lifecycle. Called by App before
 * `selectIncident`, which calls `markOpened` on every open.
 */
export function useIncidentLifecycle({ activeMeta, incidents, setActiveMeta, setIncidents, setForceReadOnly, archiveReturnRef }: {
  activeMeta: IncidentMeta | null
  incidents: IncidentMeta[] | null
  setActiveMeta: (meta: IncidentMeta) => void
  setIncidents: SetIncidents
  setForceReadOnly: (on: boolean) => void
  /** where «Zurück» from a read-only view lands (App) — a close elsewhere sends it to the list instead */
  archiveReturnRef: MutableRefObject<string | null>
}) {
  /** the open Einsatz's meta, for the close signal (below) — it arrives from outside React */
  const activeMetaRef = useRef<IncidentMeta | null>(null)
  /** the Einsatz THIS device is closing right now (completeRapport): its own poll hears the close
   *  before the handover finishes, and that is not «closed on another device» */
  const closingLocallyRef = useRef<string | null>(null)
  /** since when THIS device has had the open Einsatz on screen running — a `closed_at` older than
   *  that is an earlier close, kept across «Wieder öffnen» (incidentClosed · closedNoticeAt) */
  const runningSinceRef = useRef(0)
  /** …and the one THIS device is reopening («Wieder öffnen» here remounts it editable itself) */
  const reopeningLocallyRef = useRef<string | null>(null)
  /** the Einsatz closed — or reopened — on ANOTHER device while it was open here, and when */
  const [lifecycleElsewhere, setLifecycleElsewhere] = useState<LifecycleElsewhere | null>(null)
  useEffect(() => { activeMetaRef.current = activeMeta }, [activeMeta])
  /** an Einsatz was just opened here: it runs from now, and nothing has happened to it elsewhere */
  const markOpened = useCallback(() => {
    runningSinceRef.current = serverNow()
    setLifecycleElsewhere(null)
  }, [])

  // --- closed on ANOTHER device (N3, staging 25.09.2026) ---------------------------------------
  // The live poll, a refused write or the list watch says the open Einsatz is over (lib/
  // incidentClosed). The answer is the same Einsatz, read-only, IN PLACE: the meta flips and
  // IncidentWorkspace turns every writer off and says so (its IncidentClosedMeldung) — no
  // remount, so the operator keeps the surface they were on, and NEVER a jump into another
  // Einsatz. «Zurück» from here goes to «Alle Einsätze», not into whatever was open before.
  // The server's own meta is asked for first; a signal the SERVER sent (poll header, refusal)
  // stands on its own if that read fails, the list's mere absence does not.
  useEffect(() => {
    const handle = async (sig: IncidentClosedSignal) => {
      if (!closedMetaFor(activeMetaRef.current, { ...sig, source: 'poll' }, null, closingLocallyRef.current)) return
      const fresh = (await getIncident(sig.incidentId).catch(() => null)) as IncidentMeta | null
      // re-read after the await: a switch, a local close or an earlier signal may have settled it
      const meta = closedMetaFor(activeMetaRef.current, sig, fresh, closingLocallyRef.current)
      if (!meta) return
      archiveReturnRef.current = null
      setLifecycleElsewhere({ id: meta.id, event: 'closed', at: closedNoticeAt(meta.last_closed_at ?? meta.closed_at, runningSinceRef.current, serverNow()) })
      setActiveMeta(meta)
      setIncidents((list) => (list ?? []).map((i) => (i.id === meta.id ? meta : i)))
    }
    return onIncidentClosed((sig) => { void handle(sig) })
  }, [archiveReturnRef, setActiveMeta, setIncidents])

  // …and the way back: «Wieder öffnen» on ANOTHER device (same channels, lib/incidentClosed ·
  // reopenedMetaFor). EVERY device showing this Einsatz closed follows it — the one a close signal
  // switched, the one that closed it itself, one opened closed out of «Alle Einsätze» (N1): the
  // meta flips back in place, forceReadOnly goes, and the workspace is live again; what was parked
  // while it was closed is sent (IncidentWorkspace · requeue), and its row says so.
  useEffect(() => {
    const handle = async (sig: IncidentReopenedSignal) => {
      if (!reopenedMetaFor(activeMetaRef.current, { ...sig, source: 'poll' }, null, reopeningLocallyRef.current)) return
      const fresh = (await getIncident(sig.incidentId).catch(() => null)) as IncidentMeta | null
      // re-read after the await: a switch, a local reopen or an earlier signal may have settled it
      const meta = reopenedMetaFor(activeMetaRef.current, sig, fresh, reopeningLocallyRef.current)
      if (!meta) return
      // …and a view opened read-only (out of «Alle Einsätze», or re-shown closed after this
      // device's own close) is live now too: a reopen is the current state, not a choice to undo
      setForceReadOnly(false)
      runningSinceRef.current = serverNow()
      setLifecycleElsewhere({ id: meta.id, event: 'reopened', at: serverNow() })
      setActiveMeta(meta)
      setIncidents((list) => {
        const arr = list ?? []
        return arr.some((i) => i.id === meta.id) ? arr.map((i) => (i.id === meta.id ? meta : i)) : [meta, ...arr]
      })
    }
    return onIncidentReopened((sig) => { void handle(sig) })
  }, [setForceReadOnly, setActiveMeta, setIncidents])

  // The open Einsatz is missing from the open list (the 30 s watch): it may have been closed
  // elsewhere. Only a SUSPICION — the list is bounded, and an offline answer is a cache — so the
  // handler above asks the server before it acts (lib/incidentClosed · closedMetaFor).
  useEffect(() => {
    if (!activeMeta || !isIncidentRunning(activeMeta) || !incidents?.length) return
    if (!incidents.some((i) => i.id === activeMeta.id)) reportIncidentClosed({ incidentId: activeMeta.id, source: 'list' })
  }, [incidents, activeMeta])
  // …and the mirror: the CLOSED Einsatz on screen is back among the open ones — reopened elsewhere,
  // or a stale list; the handler asks the server (lib/incidentClosed · reopenedMetaFor)
  useEffect(() => {
    if (!activeMeta || isIncidentRunning(activeMeta) || !incidents) return
    const entry = incidents.find((i) => i.id === activeMeta.id)
    if (entry && isIncidentRunning(entry)) reportIncidentReopened({ incidentId: activeMeta.id, source: 'list' })
  }, [incidents, activeMeta])

  return { lifecycleElsewhere, markOpened, closingLocallyRef, reopeningLocallyRef }
}

/**
 * The close and the reopen this device runs. Called by App after `selectIncident`, with the
 * markers `useIncidentLifecycle` returned.
 */
export function useCloseReopen({
  closingLocallyRef, reopeningLocallyRef, activeId, activeMeta, incidents, syncRef, archiveReturnRef, refreshList,
  selectIncident, markOpened, setIncidents, setClosedMedia, setActiveId, setActiveMeta, setWorkspace, setForceReadOnly,
  abschlussHereRef, showEinsatz,
}: {
  /** The counting confirm of the Einsatz open on THIS device (IncidentWorkspace sets it while
   *  that Einsatz can be closed here, null otherwise) — «Alle Einsätze» closes it through this. */
  abschlussHereRef: MutableRefObject<(() => Promise<boolean>) | null>
  /** bring that Einsatz to the front before its confirm asks («Zur Tafel» has to land on it) */
  showEinsatz: () => void
  closingLocallyRef: MutableRefObject<string | null>
  reopeningLocallyRef: MutableRefObject<string | null>
  activeId: string | null
  activeMeta: IncidentMeta | null
  incidents: IncidentMeta[] | null
  syncRef: MutableRefObject<WorkspaceSync | null>
  archiveReturnRef: MutableRefObject<string | null>
  refreshList: () => Promise<IncidentMeta[]>
  selectIncident: (id: string, opts?: { readOnly?: boolean; meta?: IncidentMeta }) => Promise<void>
  /** `useIncidentLifecycle`'s: the Einsatz on screen runs from now (the in-place reopen) */
  markOpened: () => void
  setIncidents: SetIncidents
  setClosedMedia: Dispatch<SetStateAction<ClosedMediaPending[]>>
  setActiveId: (id: string | null) => void
  setActiveMeta: (meta: IncidentMeta | null) => void
  setWorkspace: (ws: Workspace | null) => void
  setForceReadOnly: (on: boolean) => void
}) {
  /** THE reopen, after its question was answered — by the confirm of `reactivateById` below, or
   *  by the close toast's «Wieder öffnen» (completeRapport), which IS the question.
   *  ⚠️ The Einsatz ON SCREEN (read-only) goes live IN PLACE (sweep #6, 27.10.2026, owner: «the
   *  card loaded very slowly»). It used to be PATCH → list → `selectIncident` (flush, the full
   *  Einsatz again, the workspace a third time) → remount, all serial: measured 3.2 s at 300 ms
   *  latency and a 4× slower CPU, of which the PATCH was 0.5 s. The workspace on screen is the
   *  live-followed one, so nothing needs fetching: the PATCH answers with the meta, and the flip
   *  is the one a reopen ELSEWHERE already makes (`useIncidentLifecycle` · onIncidentReopened).
   *  Another Einsatz (the close toast's, after the screen moved on) still opens — with the
   *  PATCH's meta, the list refreshed beside it rather than before it. */
  // ⚠️ a ref, not the render's `activeId`: the close toast holds the reopenNow of the render that
  // closed — where this id WAS on screen — and is pressed seconds after the screen moved on
  const activeIdRef = useRef(activeId)
  useEffect(() => { activeIdRef.current = activeId }, [activeId])
  const reopenNow = useCallback(async (id: string): Promise<ReactivateResult> => {
    // this device's own reopen: its poll hears «open» before the remount below, and that is not
    // «auf einem anderen Gerät wieder geöffnet»
    reopeningLocallyRef.current = id
    try {
      // ⚠️ Reported, not swallowed: a failed reopen used to be followed by the incident being
      // opened read-only anyway, which reads as «the app decided I may not edit this» rather than
      // as «the server refused». Same rule as abschliessen — the outcome, not the intent.
      let fresh: IncidentMeta
      try {
        fresh = await reactivateIncident(id)
      } catch (e) {
        // Offline (or the server down) is not a refusal: say what it needs. There is no queue for
        // a reopen on purpose — the server writes the reopen boundary the Atemschutz clocks restart
        // from, and until it arrives the alarm holds (lib/reopenClocks · reopenPending), so an
        // Einsatz reopened offline would run its Tafel without an Überfällig alarm.
        toast(isUnverifiable(e) ? appConfig.copy.archived.reactivateNeedsServer
          : e instanceof ApiError ? e.detail : appConfig.copy.errors.updateFailed, { icon: 'warn', tone: 'warn' })
        return 'failed'
      }
      // the list catches up on its own; it must not stand in front of the Einsatz
      void refreshList().catch(() => {})
      if (id === activeIdRef.current) {
        archiveReturnRef.current = null
        markOpened()
        setForceReadOnly(false)
        setActiveMeta(fresh)
        setIncidents((list) => {
          const arr = list ?? []
          return arr.some((i) => i.id === id) ? arr.map((i) => (i.id === id ? fresh : i)) : [fresh, ...arr]
        })
        // remembered again, as a hand-opened Einsatz is (App · selectIncident) — the close forgot it
        savePrefs({ ...loadPrefs(), incidentId: id, incidentChosenAt: Date.now(), landedAt: undefined })
        return 'ok'
      }
      try {
        await selectIncident(id, { readOnly: false, meta: fresh })
        return 'ok'
      } catch {
        return 'failed'
      }
    } finally {
      if (reopeningLocallyRef.current === id) reopeningLocallyRef.current = null
    }
  }, [reopeningLocallyRef, refreshList, archiveReturnRef, markOpened, setForceReadOnly, setActiveMeta, setIncidents, selectIncident])

  // THE close, and the only one. Both doors on the ACTIVE Einsatz (the Rapport's button/band and
  // the Einsatz-Menü row) run their counting confirm in IncidentWorkspace and land here; «Alle
  // Einsätze» runs the plain confirm below and lands here too. Flush the last workspace edits,
  // stamp report_done_at, close, and move on — one action, no second dialog. Late corrections
  // stay possible (wieder öffnen / Nachträge) and flip the derived chip to «geändert nach
  // Abschluss».
  // Resolves TRUE only when the Einsatz was actually closed — the workspace's confirm passes
  // the outcome on (a failed handover must not look like an Abschluss to anyone upstream).
  const completeRapport = useCallback(async (id: string): Promise<boolean> => {
    if (isDemoMode()) { toast(appConfig.copy.demo.actionBlocked, { icon: 'info' }); return false }
    closingLocallyRef.current = id
    try {
      if (id === activeId && syncRef.current) await syncRef.current.flush().catch(() => {})
      // the deployment's clock, like every other stamp on the record (lib/serverClock)
      await patchIncident(id, { report_done_at: serverNowIso() })
      // ⚠️ NOT `.catch(() => {})`. A swallowed failure here sat one line above a green «Rapport
      // abgeschlossen» toast — and then the Einsatz reopened by itself on the next list refresh,
      // because it had never been closed at all. The catch below reports it and the Einsatz stays
      // where it is, which is the truth.
      await archiveIncident(id)
      // …and say so when something could not go up: the operator is about to leave this incident,
      // and «kommt beim nächsten Öffnen» is only reassuring if it was said out loud.
      // ⚠️ …and what is still queued stands as a Meldung while true, not in this toast (S3,
      // 20.10.2026): five seconds while the screen moves to the launcher is not «said out loud»
      const stillQueued = await clearUploadedMedia(id)
      /* «Wieder öffnen» on the toast, 10 s (3am sweep, 23.10.2026, owner's point 4): the way back
         used to be Alle Einsätze → open read-only → «Wieder öffnen» → confirm. The toast is the
         confirm-with-undo of the close (docs/undo.md) — the same reopen «Alle Einsätze» runs,
         minus its question, and it refuses like the other undo toasts when the server has moved
         on (reopenNow: a failed PATCH is said, nothing is reopened). */
      toast(appConfig.copy.abschluss.done, {
        icon: 'check', tone: 'success', duration: 10_000,
        action: { label: appConfig.copy.abschluss.reopen, onClick: () => { void reopenNow(id) } },
      })
      if (stillQueued) {
        const title = (incidents ?? []).find((i) => i.id === id)?.title ?? activeMeta?.title ?? ''
        setClosedMedia((cur) => [...cur.filter((p) => p.id !== id), { id, title, n: stillQueued }])
      }
      if (id === activeId) {
        if (syncRef.current) { syncRef.current.dispose(); syncRef.current = null }
        await refreshList()
        /* ⚠️ Land on the LAUNCHER, never inside another Einsatz. Until 25.09.2026 this opened the
           first OTHER open Einsatz in the list — silently, so the phone that had just closed an
           Übung stood inside somebody else's live Einsatz with its GPS banner, and the next tap
           drew in it. The walk-through's fix stayed on the closed one read-only instead, and
           remembered it, so the next launch fell through to the first open Einsatz anyway
           (05.10.2026: «I'm now always in open emergencies»). Now the closed Einsatz is
           forgotten on this device and `landedAt` keeps a cold start at home too (lib/
           incidentAlerts · pickBootIncident). It stays one tap away: «Alle Einsätze», where
           «Wieder öffnen» lives. */
        savePrefs({ ...loadPrefs(), incidentId: undefined, landedAt: Date.now() })
        archiveReturnRef.current = null
        setActiveId(null); setActiveMeta(null); setWorkspace(null); setForceReadOnly(false)
      } else {
        await refreshList()
      }
      return true
    } catch (e) {
      toast(e instanceof ApiError ? e.detail : appConfig.copy.abschluss.failed, { icon: 'warn', tone: 'warn' })
      return false
    } finally {
      if (closingLocallyRef.current === id) closingLocallyRef.current = null
    }
  }, [closingLocallyRef, activeId, syncRef, refreshList, incidents, activeMeta, reopenNow, setClosedMedia, archiveReturnRef, setActiveId, setActiveMeta, setWorkspace, setForceReadOnly])

  // Close ANY incident from the «Alle Einsätze» list (per-incident, not just the active one).
  // ⚠️ It ends the same way the Rapport does — through `completeRapport` — so an Einsatz put away
  // from a list is not a second, weaker kind of ending. Until 22.08. this path archived plainly:
  // no `report_done_at`, none of the seven ABSCHLUSS_STEPS checked, so the Einsatz stood in the
  // Historie as «offen» for ever while the Rapport path stamped and counted. Two doors with the
  // same label into two different rooms.
  //
  // ⚠️ Crews still inside are asked about HERE too (sweep 09.11.2026, UX.10). The plain confirm
  // closed an Einsatz with three Trupps under PA without a word, and every other device had
  // gone read-only by the time the 10 s «Wieder öffnen» was read.
  //   · The Einsatz open on this device goes through ITS counting confirm (`abschlussHereRef`,
  //     IncidentWorkspace · confirmAndComplete): Notfall, Trupps, Mindestangaben, «Zur Tafel».
  //   · Any other one: its Trupps are read once from the server. Crews inside → the same question
  //     that names them, «Trotzdem abschliessen» the quiet answer. No answer from the server (or
  //     nobody inside) → the plain confirm, as before; nothing is ever written for them.
  const archiveById = useCallback(async (id: string) => {
    if (!id) return
    // Demo: don't let a visitor close the one shared running incident (it would archive for
    // everyone until the nightly reset). Editing it stays open; only closing/creating is blocked.
    if (isDemoMode()) { toast(appConfig.copy.demo.actionBlocked, { icon: 'info' }); return }
    const here = id === activeId ? abschlussHereRef.current : null
    if (here) { showEinsatz(); await here(); return }
    const inside = await getWorkspace(id)
      .then((r) => (sanitizeWorkspace(r.workspace).ws?.trupps ?? []).filter(truppStillDeployed))
      .catch(() => [])
    const ok = await confirmDialog(inside.length > 0 ? {
      title: appConfig.copy.abschluss.insideTitle,
      ...insideAbschlussSpec(inside),
      confirmLabel: appConfig.copy.abschluss.insideClose,
      cancelLabel: appConfig.copy.cancel,
      danger: true,
    } : {
      title: appConfig.copy.history.archiveConfirmTitle,
      message: appConfig.copy.history.archiveConfirmMsg,
      confirmLabel: appConfig.copy.history.archiveConfirmBtn,
      cancelLabel: appConfig.copy.cancel,
      danger: true,
    })
    if (!ok) return
    await completeRapport(id)
  }, [completeRapport, activeId, abschlussHereRef, showEinsatz])

  // «Wieder öffnen» — the mirror of abschliessen (the ArchivedBanner action), and as deliberate:
  // the confirm also teaches the consequences (Nachträge, «geändert nach Abschluss»). On confirm
  // the same incident reopens EDITABLE (readOnly false ⇒ it rejoins the open list).
  /**
   * ⚠️ Three states, not a boolean. «Abbrechen» in the confirm and «der Server hat nein
   * gesagt» are different answers, and the one caller (TopBar · ArchivedChip) reopens the
   * Archiviert menu on a failure so the operator can try again. Collapsed into `false`,
   * cancelling the confirm re-opened the very menu you were backing out of.
   */
  const reactivateById = useCallback(async (id: string): Promise<ReactivateResult> => {
    const h = appConfig.copy.history
    const ok = await confirmDialog({
      title: h.reactivateConfirmTitle,
      message: h.reactivateConfirmMsg,
      confirmLabel: h.reactivateConfirmBtn,
      cancelLabel: appConfig.copy.cancel,
    })
    if (!ok) return 'cancelled'
    return reopenNow(id)
  }, [reopenNow])

  return { reopenNow, completeRapport, archiveById, reactivateById }
}
