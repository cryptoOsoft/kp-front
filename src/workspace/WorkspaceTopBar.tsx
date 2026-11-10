// The workspace's TopBar: Einsatz title and mode chip, sync/clock state, ↶ ↷, the Einsatz-Menü
// and the per-surface actions. Split out of IncidentWorkspace (E1, 09.10.2026) verbatim; the
// menu's doors (switch, archive, share, settings, …) stay the workspace's and come in as props.

import type { Dispatch, SetStateAction, MouseEvent as ReactMouseEvent, RefObject } from 'react'
import { IncidentSwitcher } from '../components/panels'
import { SharePositionPill } from '../components/SharePosition'
import { TopBar } from '../components/TopBar'
import { appConfig } from '../config/appConfig'
import type { AbschlussStep } from '../lib/abschluss'
import { type AtemschutzAlarmState, azChipRedundant } from '../lib/atemschutz'
import type { AuthUser } from '../lib/auth'
import { closeTimeOf, type IncidentMeta, type SyncStatus } from '../lib/incidents'
import { installOffered } from '../lib/installPolicy'
import { isStandalone, getInstallPlatform } from '../lib/installPrompt'
import { confirmLogout } from '../lib/logoutConfirm'
import { toast } from '../lib/ui'
import type { useAuditEvents } from '../lib/useAuditEvents'
import type { useIsPhone } from '../lib/useIsPhone'
import type { useJournal } from '../lib/useJournal'
import type { useMediaQueue } from '../lib/useMediaQueue'
import type { useReminders } from '../lib/useReminders'
import type { useShareMyPosition } from '../lib/useShareMyPosition'
import type { useVoiceMemo } from '../lib/useVoiceMemo'
import type { ShareLinkKind } from '../lib/viewLink'
import type { ReportMeta } from '../lib/workspace'
import type { Incident, WeatherData, LngLat, ReactivateResult } from '../types'
import type { WorkspaceMode } from './types'

export interface WorkspaceTopBarProps {
  incidentView: Incident
  incidentMeta: IncidentMeta
  reportMeta: ReportMeta
  running: boolean
  voice: ReturnType<typeof useVoiceMemo>
  journalOpen: boolean
  setJournalOpen: Dispatch<SetStateAction<boolean>>
  reminders: ReturnType<typeof useReminders>
  linkScoped: boolean
  readOnly: boolean
  setComposerOpen: Dispatch<SetStateAction<boolean>>
  tabLockLost: boolean
  isEditor: boolean
  onTakeOverTab: () => void
  startVoiceMemo: () => void
  startQuickPhoto: () => void
  onHistoryPress: (dir: 'undo' | 'redo') => (e: ReactMouseEvent<HTMLButtonElement>) => void
  histCanUndo: boolean
  histCanRedo: boolean
  undoLabel: string | null
  redoLabel: string | null
  canEditIncident: boolean
  canEditRecord: boolean
  displayWeather: WeatherData | null
  openWeatherDetails: () => void
  view: { bearing: number; center: LngLat; zoom: number }
  azAlarm: AtemschutzAlarmState
  mode: WorkspaceMode
  azRowsShown: string[]
  setMode: Dispatch<SetStateAction<WorkspaceMode>>
  setPanel: Dispatch<SetStateAction<'layers' | null>>
  setTruppFocus: Dispatch<SetStateAction<{ id: string; nonce: number } | null>>
  mapUI: boolean
  replayActive: boolean
  gpsStale: boolean
  gpsAgeMs: number | null
  share: ReturnType<typeof useShareMyPosition>
  onShareChangeName: (restore: () => void) => void
  onBackFromArchive: (() => void) | undefined
  onReactivateActive: (() => Promise<ReactivateResult>) | undefined
  isPhone: ReturnType<typeof useIsPhone>
  phoneTools: boolean
  planFit: RefObject<(() => void) | null>
  incidents: IncidentMeta[]
  syncStatus: SyncStatus
  journal: ReturnType<typeof useJournal>
  auditDelivery: ReturnType<typeof useAuditEvents>
  closedRefusedUnexported: boolean
  baseSyncStatus: SyncStatus
  lastSyncedAt: number | null
  user: AuthUser | null
  setSettingsOpen: Dispatch<SetStateAction<boolean>>
  onSwitchIncident: (i: IncidentMeta) => void
  onOpenHistory: () => void
  onOpenObjectVisits: ((objectId?: string | null) => void) | undefined
  onOpenKarte: (() => void) | undefined
  activeObjectId: string | undefined
  canEditMeta: boolean
  onEditMeta: () => void
  onOpenDivera: () => void
  onOpenDatenquellen: () => void
  confirmAndComplete: () => Promise<boolean>
  abschlussMissing: AbschlussStep[]
  canShareLink: boolean
  setShareLink: Dispatch<SetStateAction<ShareLinkKind | null>>
  setHelpOpen: Dispatch<SetStateAction<boolean>>
  setInstallGuideOpen: Dispatch<SetStateAction<boolean>>
  setOfflineReadyOpen: Dispatch<SetStateAction<boolean>>
  syncNow: () => Promise<void>
  media: ReturnType<typeof useMediaQueue>
  logout: () => Promise<void>
  settingsOpen: boolean
  helpOpen: boolean
  installGuideOpen: boolean
  offlineReadyOpen: boolean
  shareLink: ShareLinkKind | null
  /** may correct the Rapport of a CLOSED Einsatz (workspace/access) – the closed chip's sentence */
  canEditRapport: boolean
  /** bumped when the Einsatz-Menü has to go although no surface changed — «Abschliessen» asked
   *  from «Alle Einsätze» (IncidentWorkspace · abschlussRef) */
  menuCloseKey: number
}

export function WorkspaceTopBar({
  incidentView, incidentMeta, reportMeta, running, voice, journalOpen, setJournalOpen, reminders,
  linkScoped, readOnly, setComposerOpen, tabLockLost, isEditor, onTakeOverTab, startVoiceMemo,
  startQuickPhoto, onHistoryPress, histCanUndo, histCanRedo, undoLabel, redoLabel, canEditIncident,
  canEditRecord, displayWeather, openWeatherDetails, view, azAlarm, mode, azRowsShown, setMode,
  setPanel, setTruppFocus, mapUI, replayActive, gpsStale, gpsAgeMs, share, onShareChangeName,
  onBackFromArchive, onReactivateActive, isPhone, phoneTools, planFit, incidents, syncStatus, journal,
  auditDelivery, closedRefusedUnexported, baseSyncStatus, lastSyncedAt, user, setSettingsOpen,
  onSwitchIncident, onOpenHistory, onOpenObjectVisits, onOpenKarte, activeObjectId, canEditMeta, onEditMeta,
  onOpenDivera, onOpenDatenquellen, confirmAndComplete, abschlussMissing, canShareLink, setShareLink,
  setHelpOpen, setInstallGuideOpen, setOfflineReadyOpen, syncNow, media, logout, settingsOpen,
  helpOpen, installGuideOpen, offlineReadyOpen, shareLink,
  canEditRapport, menuCloseKey,
}: WorkspaceTopBarProps) {
  return (
    <>
      <TopBar
        incident={incidentView}
        startedAt={incidentMeta.started_at}
        // the declared Einsatzende wins over the server's closure stamp: it is what the EL said
        // the Einsatz ended, and it is what the Rapport prints
        // ⚠️ `closed_at` only while CLOSED (staging r3, F3): it is the FIRST Einsatzende and is
        // kept across «Wieder öffnen», so a reopened Einsatz's clock stood frozen at the close on
        // every device. The Rapport's own Einsatzende still stops it — that is a stated fact.
        // …and the CURRENT close, not the first, once it is closed again (D2)
        endedAt={reportMeta.endedAt ?? (running ? undefined : closeTimeOf(incidentMeta))}
        recording={voice.recording}
        recStartedAt={voice.recStartedAt}
        journalOpen={journalOpen}
        onToggleJournal={() => setJournalOpen((v) => !v)}
        reminderCount={reminders.openCount}
        // NOT a composer on a read-only surface: it used to open, take the text, and have the
        // journal store drop the row — «ich kann keine Einträge erfassen», with no reason given.
        // A tab that merely LOST THE LOCK keeps the button though: making it vanish answers the
        // question just as badly, so it says what is in the way and offers the one tap out of it
        // (the same «Hier bearbeiten» the banner carries, for when the banner is scrolled away).
        // Editor AND el: both write the Verlauf, so both get the banner (WorkspaceMeldungen).
        onAddEntry={linkScoped ? undefined
          : !readOnly ? () => setComposerOpen(true)
          : tabLockLost && (isEditor || user?.role === 'el') ? () => toast(appConfig.copy.tabLock.hint, {
              icon: 'info',
              action: { label: appConfig.copy.tabLock.takeOver, onClick: onTakeOverTab },
            })
          : undefined}
        onHoldStart={linkScoped ? undefined : startVoiceMemo}
        onHoldEnd={linkScoped ? undefined : voice.stop}
        onHoldPhoto={linkScoped ? undefined : startQuickPhoto}
        // ⚠️ ONE pair, ONE history (08.09.2026). It used to route by surface — «take back what you
        // last did HERE» — which asked the operator to already know which surface his last tap
        // landed on, and left the Tafel's actions reachable only through a toast that expired.
        // It now steps the one global timeline and NAMES what it will take back, so an undo that
        // lands on another surface is never invisible (lib/undoTimeline · IncidentWorkspace ·
        // stepHistory).
        onUndo={onHistoryPress('undo')}
        onRedo={onHistoryPress('redo')}
        canUndo={histCanUndo}
        canRedo={histCanRedo}
        undoLabel={undoLabel}
        redoLabel={redoLabel}
        // ⚠️ No longer gated by SURFACE (08.09.2026). It used to be «map, plans or anwesenheit,
        // and not tacticalLocked», because on Checklisten or Mittel the pair would have stepped
        // the map's document invisibly — the very thing that made it a per-surface control. With
        // one timeline that reason is gone and the gate inverts: those surfaces are exactly the
        // ones whose actions had no way back at all, and hiding the pair there would hide the
        // only door to them. What is left is the honest question — may this session write
        // anything? An Einsatzleiter may (the record surfaces), so `tacticalLocked` is the wrong
        // test for it; a viewer may not, and gets nothing.
        showHistory={canEditIncident || canEditRecord}
        // On EVERY surface, not only the Karte: which way the smoke goes matters exactly as much
        // on the Atemschutz board and a Modul as on the map, and the chip vanishing on a surface
        // switch read as «the weather indicator is broken» in the field. Phones keep their
        // map-only float (.phone-wx) — that bar is genuinely too narrow everywhere else.
        weather={displayWeather}
        onOpenWeather={openWeatherDetails}
        bearing={view.bearing}
        azAlarm={azAlarm}
        // ONE red door per alarm on screen (29.09.2026, sweep 3 T1): on the Trupps board the head's
        // «⚠ n» badge is it, elsewhere the Meldeleiste row naming the same Trupp; the chip comes
        // back once «Zum Trupp» took that row down, and the amber lead always keeps it
        azChipHidden={azChipRedundant(azAlarm, mode === 'atemschutz', azRowsShown)}
        // …and the chip lands ON the urgent Trupp's card, like every other way in (Meldeleiste,
        // Anwesenheit, the notification tap) — the chip names a Trupp, so the tap must find it.
        onOpenAtemschutz={(truppId) => {
          setMode('atemschutz'); setPanel(null)
          if (truppId) setTruppFocus({ id: truppId, nonce: Date.now() })
        }}
        // Only on the map surface: the chip is a caveat about what the MAP is showing, and on
        // Plan/Atemschutz there are no vehicle symbols for it to qualify. During replay the
        // positions are historical by definition, so a staleness warning would be nonsense.
        gpsStale={mapUI && !replayActive && gpsStale}
        gpsAgeMs={gpsAgeMs}
        // On EVERY surface, unlike the GPS caveat above: this says what the device in your hand
        // is doing, which does not stop being true because you switched to the Plan.
        shareSlot={<SharePositionPill share={share} onChangeName={onShareChangeName} />}
        // On the phone map surface the compass in the bottom bar already carries Einpassen
        // (== centerIncident) + Mein Standort, so a top-bar center button here would just
        // duplicate it AND crowd the narrow bar off its right edge (clipping the Atemschutz
        // alarm chip). A Plan's bottom bar carries «Einpassen» as its own tile too (20.09.2026:
        // the top-bar twin went) – so this is left ONLY for the sheets that have no bar at all:
        // a viewer-only Modul, the Gebäude pick surface, a replay. There the floating zoom is
        // dropped on a phone (15-mobile.css · .wb-zoom-float) and this is the one way back.
        mapNav={isPhone && mode === 'plans' && !phoneTools
          ? { action: { icon: 'cross', label: appConfig.copy.nav.fit, onClick: () => planFit.current?.() } }
          : null}
        titleSlot={
          <IncidentSwitcher
            active={incidentMeta}
            incidents={incidents}
            isEditor={isEditor}
            syncStatus={syncStatus}
            syncDetail={(journal.syncStatus === 'error' || auditDelivery.status === 'error') && syncStatus !== 'storage' ? appConfig.copy.journal.delivery.short
              : closedRefusedUnexported && baseSyncStatus === 'synced' ? appConfig.copy.journal.delivery.closedShort : undefined}
            lastSyncedAt={lastSyncedAt}
            startedAt={incidentMeta.started_at}
            endedAt={reportMeta.endedAt ?? (running ? undefined : closeTimeOf(incidentMeta))}
            user={{ display_name: user?.display_name ?? '', color: user?.color ?? null, role: user?.role ?? 'viewer' }}
            onSettings={linkScoped ? undefined : () => setSettingsOpen(true)}
            onSwitch={onSwitchIncident}
            onHistory={linkScoped ? undefined : onOpenHistory}
            onObjectVisits={linkScoped || !onOpenObjectVisits ? undefined : () => onOpenObjectVisits(activeObjectId ?? null)}
            onKarte={linkScoped ? undefined : onOpenKarte}
            onEditMeta={canEditMeta ? onEditMeta : undefined}
            onDivera={onOpenDivera}
            onDatenquellen={onOpenDatenquellen}
            // Einsatzrapport (PDF + Drucken) and «Alle Einsätze» are both refused for a link
            // session — one generates a document with everyone's names, the other lists the
            // Einsätze this link has nothing to do with.
            // ⚠️ The SAME confirm the Rapport runs, with the same count in front of it — this row
            // used to archive plainly (see confirmAndComplete). The badge puts the check where it
            // can be read before the row is pressed, not only after.
            onArchive={canEditIncident && !readOnly && !incidentMeta.is_archived ? () => { void confirmAndComplete() } : undefined}
            // ONE number, the nav tile's and the Rapport head's (29.09.2026): a +1 for Trupps still
            // out made this badge say 5 where the nav said 4 one tap away. The confirm names
            // the Trupps that are still out («Trupps noch drin»), so nothing is lost.
            archiveOpenCount={abschlussMissing.length}
            // «Teilen» — THE door to the share sheet (06.09.): the bar's own Teilen button is
            // gone on every width, so this Einsatz-Karte row is the one place an Einsatz is
            // handed to somebody. Same gate as every minting door (`canShareLink`): editors,
            // never a viewer, a read-only surface or a link session.
            onShare={canShareLink ? () => setShareLink('view') : undefined}
            onHelp={() => setHelpOpen(true)}
            onInstall={isStandalone() || !installOffered(getInstallPlatform()) ? undefined : () => setInstallGuideOpen(true)}
            onOfflineReadiness={() => setOfflineReadyOpen(true)}
            onSyncNow={syncNow}
            // ⚠️ No «Abmelden» for a link session (02.09.): a link is the literal page and owns
            // no login on this device, so there is none to end here — and the row used to end
            // the DEVICE's own one. Leaving the link means leaving the page.
            // …and it always asks first (lib/logoutConfirm), saying what is still unsent here
            onLogout={linkScoped ? undefined : () => {
              void confirmLogout({
                online: navigator.onLine,
                unsyncedEntries: journal.pendingCount + journal.rejectedCount + media.pendingCount,
                unsyncedOther: syncStatus !== 'synced',
              }).then((ok) => { if (ok) void logout() })
            }}
            // «Einsatz abgeschlossen» (sweep #5, 27.10.2026): the lock in the pill's ✓ slot, the
            // card's «Abgeschlossen 01:18» pill folding out its two exits
            onBackFromArchive={onBackFromArchive}
            onReactivate={onReactivateActive}
            canCorrectRapport={canEditRapport}
            navKey={`${mode}|${journalOpen ? 'journal' : ''}|${menuCloseKey}`}
            sheetOpen={settingsOpen || helpOpen || installGuideOpen || offlineReadyOpen || !!shareLink}
          />
        }
      />
    </>
  )
}
