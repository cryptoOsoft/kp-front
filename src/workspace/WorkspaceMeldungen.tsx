// The Meldeleiste rows the workspace raises (and the banners beside them): due Wiedervorlagen,
// the degraded-map rows, one row per Trupp in Alarm, the GPS ends, the wind shift, the way back
// to the Rapport, update / install / tab-lock and the «Einsatzdaten prüfen» review. Split out of
// IncidentWorkspace (E1, 09.10.2026) verbatim — every condition below is still the workspace's
// state, handed in as props. The rows paint into the Meldeleiste host (lib/meldeleisteHost).

import type { Dispatch, SetStateAction } from 'react'
import { AtemschutzAlarmMeldungen } from '../components/AtemschutzAlarmMeldung'
import { AtemschutzNotfallMeldungen } from '../components/AtemschutzNotfall'
import { GpsFollowMeldung } from '../components/GpsFollowMeldung'
import { InstallBanner } from '../components/InstallBanner'
import { NoBasemapMeldung } from '../components/NoBasemapMeldung'
import { ReviewBanner } from '../components/panels'
import { ReminderBanner } from '../components/ReminderBanner'
import { StorageFullMeldung } from '../components/StorageFullMeldung'
import { SymbolsFailedMeldung } from '../components/SymbolsFailedMeldung'
import { TabLockBanner } from '../components/TabLockBanner'
import { UpdateBanner } from '../components/UpdateBanner'
import { WindShiftMeldung } from '../components/WindShiftMeldung'
import { appConfig } from '../config/appConfig'
import type { AtemschutzAlarmState } from '../lib/atemschutz'
import type { AuthUser } from '../lib/auth'
import { isDemoMode } from '../lib/deploymentConfig'
import type { useGpsNotices, GpsEnd } from '../lib/gpsReturn'
import { Icon } from '../lib/icons'
import type { IncidentMeta, SyncStatus } from '../lib/incidents'
import type { useJournal } from '../lib/useJournal'
import type { useReminders } from '../lib/useReminders'
import type { useSymbols } from '../lib/useSymbols'
import type { useTruppActions } from '../lib/useTruppActions'
import type { Trupp } from '../types'
import type { WorkspaceMode } from './types'

export interface WorkspaceMeldungenProps {
  reminders: ReturnType<typeof useReminders>
  setJournalOpen: Dispatch<SetStateAction<boolean>>
  setJournalLandOn: Dispatch<SetStateAction<{ id: string; nonce: number } | null>>
  sym: ReturnType<typeof useSymbols>
  symbolsRowHidden: boolean
  setSymbolsRowHidden: Dispatch<SetStateAction<boolean>>
  noBasemap: boolean
  setNoBasemap: Dispatch<SetStateAction<boolean>>
  setOfflineReadyOpen: Dispatch<SetStateAction<boolean>>
  trupps: Trupp[]
  azAlarm: AtemschutzAlarmState
  canEditTrupps: boolean
  azIntervalMin: number
  azGraceSec: number
  mode: WorkspaceMode
  setAzRowsShown: Dispatch<SetStateAction<string[]>>
  muteAtemschutz: () => void
  setMode: Dispatch<SetStateAction<WorkspaceMode>>
  setPanel: Dispatch<SetStateAction<'layers' | null>>
  setTruppFocus: Dispatch<SetStateAction<{ id: string; nonce: number } | null>>
  mapUI: boolean
  tacticalLocked: boolean
  gpsMeld: ReturnType<typeof useGpsNotices>
  releaseOnSite: (ends: readonly GpsEnd[]) => void
  revertAll: (ends: readonly GpsEnd[]) => void
  followAll: (ends: readonly GpsEnd[]) => void
  replayActive: boolean
  incidentMeta: IncidentMeta
  journal: ReturnType<typeof useJournal>
  rapportReturn: boolean
  setRapportReturn: Dispatch<SetStateAction<boolean>>
  openRapport: () => void
  setInstallGuideOpen: Dispatch<SetStateAction<boolean>>
  tabLockLost: boolean
  /** this tab follows a presentation (lib/presentation · isFollower): the tab-lock row steps aside */
  followingPresentation: boolean
  user: AuthUser | null
  onTakeOverTab: () => void
  needsReview: boolean
  readOnly: boolean
  intakeReviewedAt: string | undefined
  onEditMeta: () => void
  onReviewDone: () => void
  azAlarmActive: boolean
  truppPlace: ReturnType<typeof useTruppActions>['truppPlace']
  setTruppStatus: ReturnType<typeof useTruppActions>['setTruppStatus']
  /** the badge's one sync status (useMediaOutbox) — `storage` raises the «Speicher voll» row */
  syncStatus: SyncStatus
  /** «Einträge sichern» (useLifecycleElsewhere) and «Jetzt synchronisieren» (useMediaOutbox) */
  exportEntries: () => void
  syncNow: () => Promise<void>
}

export function WorkspaceMeldungen({
  reminders, setJournalOpen, setJournalLandOn, sym, symbolsRowHidden, setSymbolsRowHidden, noBasemap,
  setNoBasemap, setOfflineReadyOpen, trupps, azAlarm, canEditTrupps, azIntervalMin, azGraceSec, mode,
  setAzRowsShown, muteAtemschutz, setMode, setPanel, setTruppFocus, mapUI, tacticalLocked, gpsMeld,
  releaseOnSite, revertAll, followAll, replayActive, incidentMeta, journal, rapportReturn,
  setRapportReturn, openRapport, setInstallGuideOpen, tabLockLost, followingPresentation, user, onTakeOverTab, needsReview,
  readOnly, intakeReviewedAt, onEditMeta, onReviewDone, azAlarmActive, truppPlace, setTruppStatus,
  syncStatus, exportEntries, syncNow,
}: WorkspaceMeldungenProps) {
  return (
    <>
      {/* local storage is full: nothing typed now survives a close (components/StorageFullMeldung) */}
      {syncStatus === 'storage' && <StorageFullMeldung onExport={exportEntries} onSyncNow={syncNow} />}

      <ReminderBanner
        due={reminders.due}
        // «Erledigt» / «+10 min» write Verlauf rows: only where the Verlauf ring offers its tick
        // (JournalLayer · onReminderDone). A viewer or a link keeps the row and its way in.
        onDone={readOnly ? undefined : reminders.markDone}
        onSnooze={readOnly ? undefined : (r) => reminders.snooze(r, 10)}
        // …and the way in, on the row's TITLE (Meldeleiste · MeldungTitle) rather than a third
        // button: open the Verlauf ON the row that raised this item, not at the top
        onOpen={(r) => { setJournalOpen(true); setJournalLandOn({ id: r.rowId, nonce: Date.now() }) }}
      />

      {/* One row per Trupp in Alarm — the tone's own message. Fed from the SAME fold that drives
          the tone (azAlarm.severities), so the strip cannot be silent while the app is not; and
          empty during replay, where the fold is silent too. «Zum Trupp» points at the card the
          Funkkontakt / die Druckmeldung is entered on — the same gesture the Anwesenheit's locked
          rows already use (onJumpToTrupp below). */}
      {/* the two degraded-map rows (see the state above): symbols that did not load, a basemap
          that is not cached for this view — each says what still works */}
      {sym.error && !symbolsRowHidden && (
        <SymbolsFailedMeldung onReload={() => { setSymbolsRowHidden(false); sym.reload() }} onDismiss={() => setSymbolsRowHidden(true)} />
      )}
      {noBasemap && (
        <NoBasemapMeldung onOpenOffline={() => { setNoBasemap(false); setOfflineReadyOpen(true) }} onDismiss={() => setNoBasemap(false)} />
      )}
      <AtemschutzAlarmMeldungen
        trupps={trupps}
        severities={azAlarm.severities}
        // a device that cannot end the alarm gets «Zur Kenntnis genommen» (see the component)
        canEdit={canEditTrupps}
        intervalMin={azIntervalMin}
        graceSec={azGraceSec}
        // withheld while the board itself is on screen — it shows the alarm in full and the
        // strip only covered its controls (see AtemschutzAlarmMeldung's header)
        onBoard={mode === 'atemschutz'}
        onShown={setAzRowsShown}
        // Reaching the named card is acknowledgement enough to stop the room's tone and tray
        // re-notifications. The row itself stays until a real contact/pressure event clears it.
        onAcknowledge={muteAtemschutz}
        onGoToTrupp={(id) => {
          setMode('atemschutz'); setPanel(null)
          setTruppFocus({ id, nonce: Date.now() })
        }}
      />
      {/* The Atemschutznotfall's row — the TOP of the strip (MELDUNG_RANK.notfall), on every
          surface but the Tafel, whose own banner stands there instead (F1, 08.10.2026). Not while
          the Einsatz is closed or replayed: those alarm nothing (azAlarmActive). */}
      {azAlarmActive && (
        <AtemschutzNotfallMeldungen
          trupps={trupps}
          placeOf={truppPlace}
          canEdit={canEditTrupps}
          onBoard={mode === 'atemschutz'}
          onAcknowledge={muteAtemschutz}
          onGoToTrupp={(id) => {
            setMode('atemschutz'); setPanel(null)
            setTruppFocus({ id, nonce: Date.now() })
          }}
          onDeploySafety={(id) => setTruppStatus(id, 'aktiv')}
        />
      )}

      {/* one row per GPS end with something to say — they queue behind each other instead of
          stacking (lib/gpsReturn · gpsNotices: drove off, following stopped, back on site) */}
      {mapUI && !tacticalLocked && gpsMeld.notices.map((n) => (
        <GpsFollowMeldung
          key={n.key}
          notice={n}
          label={n.vehicle?.label ?? n.ends[0].drawing.label ?? appConfig.copy.drawingEditor.drawing}
          onKeep={() => releaseOnSite(n.ends)}
          onRevert={() => revertAll(n.ends)}
          // on a «back» row, «Weiter folgen» changes nothing on the Karte: it answers the
          // question for this return, on this device (gpsReturn · useGpsNotices)
          onFollow={() => (n.kind === 'back' ? gpsMeld.answerBack(n) : followAll(n.ends))}
          onDismiss={() => gpsMeld.dismissStopped(n)}
        />
      ))}

      {/* the wind turned — the server observed it and wrote the Verlauf row; shown here once
          per device while it is news (components/WindShiftMeldung, 24.09.2026) */}
      {!replayActive && (
        <WindShiftMeldung
          incidentId={incidentMeta.id}
          rows={journal.rows}
          onOpenJournal={() => setJournalOpen(true)}
        />
      )}

      {/* one-tap way back after a Rapport checklist row navigated here — without it, the
          round trip went through the incident menu every time (feedback 2026-07-08) */}
      {rapportReturn && (mode === 'anwesenheit' || mode === 'mittel') && (
        <button
          type="button"
          className="rp-return"
          onClick={() => { setRapportReturn(false); openRapport() }}
        >
          <Icon id="chevron-left" /> {appConfig.copy.abschluss.backToRapport}
        </button>
      )}

      {/* non-blocking "new build ready" prompt — waits for the operator instead of auto-reloading */}
      <UpdateBanner />

      {/* No standing «Offline» row (removed 05.10.2026, owner: «no need for this large offline
          banner at the top of the screen»): the head's «● Offline» chip stays on screen the
          whole time, and the one-shot toast (useIncidentSync) announces the spell once. */}

      {/* "Als App installieren" nudge — browser-tab only, one ✕ dismisses it for good
          on this device (the menu keeps the permanent entry).
          Hidden on the demo: a visitor isn't installing the demo as their command app. */}
      {!isDemoMode() && <InstallBanner onOpenGuide={() => setInstallGuideOpen(true)} />}

      {/* No demo «Zurücksetzen» button: it sat bottom-centre over the map's bottom controls
          (obstructing them on a phone), and a plain page reload already restores the pristine
          scene — the sandbox keeps a visitor's edits in React state only (see useIncidentSync),
          so reloading re-fetches the curated seed. The welcome modal spells this out. */}

      {/* another tab of this browser is editing this incident → this one is read-only; one tap
          moves editing here. For every session that WRITES – editor and el (the el keeps the
          record, and froze silently without it; RBAC audit §4, 22.10.2026) – not for a viewer,
          which is read-only anyway. The Atemschutz-Link mounts its own (IncidentWorkspace · asLink).
          Not while this tab follows a presentation (owner, 09.11.2026): the second tab is open to
          follow, the pill says so – the row comes back the moment the following ends. */}
      {tabLockLost && !followingPresentation && (user?.role === 'editor' || user?.role === 'el') && <TabLockBanner onTakeOver={onTakeOverTab} />}

      {/* ⚠️ «Einsatz abgeschlossen» is NOT published here (23.08.). Read-only is a property of the
          incident, not a message about it, so it rides beside the Einsatzname as a mode chip in
          the top bar — where the incident lives — and carries its two exits there. */}

      {/* correct-in-place: an alarm opens its Einsatz by itself, so the EL lands here
          operational immediately and with the dispatch's guesses unchecked. «Passt» confirms
          them, «Bearbeiten» opens the panel that holds Stichwort/Priorität/Ort/Einsatzart — no
          wizard between the crew and the Lage, which is the whole point (2026-08-02). */}
      {/* ⚠️ …and it is asked ONCE of the crew, not once of every device: `intakeReviewedAt` is the
          shared stamp on the workspace blob (lib/workspace). App decides `needsReview` from the
          blob as it stood when the Einsatz was opened — the live-follow poll only lands HERE, so
          this is the gate that retires the banner mid-Einsatz the moment someone else confirms on
          their tablet. */}
      {needsReview && !readOnly && !intakeReviewedAt && (
        <ReviewBanner meta={incidentMeta} onEdit={onEditMeta} onDone={onReviewDone} />
      )}
    </>
  )
}
