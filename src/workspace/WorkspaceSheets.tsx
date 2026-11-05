// The workspace's sheets that are not a surface: the Hilfe, the one «Teilen» sheet for every link,
// the install guide, the Offline-Bereitschaft, the Einstellungen and the Rückmeldung. Split out of
// IncidentWorkspace (E1, 09.10.2026) verbatim: which of them is open, and what each one's parent
// is (a child sheet suspends its parent rather than destroying it), is still the workspace's
// state — see useSheets and the `*Parent` states there.

import type { Dispatch, SetStateAction } from 'react'
import { HelpOverlay } from '../components/HelpOverlay'
import { offeredTutorials } from '../lib/tutorials/offer'
import type { AuthUser } from '../lib/auth'
import { InstallGuide } from '../components/InstallGuide'
import { ShareIncidentSheet, OfflineReadinessSheet, SettingsSheet, FeedbackSheet } from '../components/panels'
import { isDemoMode } from '../lib/deploymentConfig'
import { currentFix } from '../lib/devicePosition'
import type { IncidentMeta, SyncStatus } from '../lib/incidents'
import type { SymbolSurface, RailLabels } from '../lib/prefs'
import type { PlanDatasetRef } from '../lib/useObjectPlans'
import type { useShareMyPosition } from '../lib/useShareMyPosition'
import type { useSymbols } from '../lib/useSymbols'
import type { useWeather } from '../lib/useWeather'
import type { ShareLinkKind } from '../lib/viewLink'
import type { Person, CaptionMode } from '../types'

export interface WorkspaceSheetsProps {
  helpOpen: boolean
  setHelpOpen: Dispatch<SetStateAction<boolean>>
  shareLink: ShareLinkKind | null
  incidentMeta: IncidentMeta
  setShareLink: Dispatch<SetStateAction<ShareLinkKind | null>>
  setAtemschutzLinkOn: Dispatch<SetStateAction<boolean>>
  installGuideOpen: boolean
  setInstallGuideOpen: Dispatch<SetStateAction<boolean>>
  offlineReadyOpen: boolean
  setOfflineReadyOpen: Dispatch<SetStateAction<boolean>>
  offlineProbeUrls: { tiles: string[]; plan: string; references: string[] }
  sym: ReturnType<typeof useSymbols>
  backendPlans: Record<string, string>
  manualObject: { id: string; name: string; address?: string | null; plans: Record<string, string>; titles: Record<string, string>; datasets: Record<string, PlanDatasetRef> } | null
  liveWeather: ReturnType<typeof useWeather>
  personnel: Person[]
  syncStatus: SyncStatus
  lastSyncedAt: number | null
  syncNow: () => Promise<void>
  downloadOffline: (opts?: { quiet?: boolean }) => Promise<void>
  reloadPersonnel: () => Promise<void>
  cancelOffline: () => void
  offlineProgress: { done: number; total: number } | null
  settingsOpen: boolean
  feedbackOpen: boolean
  sharePick: 'ask' | 'pick' | 'rename' | null
  shareParent: 'settings' | 'views' | 'status' | null
  setSettingsOpen: Dispatch<SetStateAction<boolean>>
  symbolScale: Record<SymbolSurface, number>
  setSymbolScale: (surface: SymbolSurface, v: number) => void
  symbolCaptions: CaptionMode
  setSymbolCaptions: Dispatch<SetStateAction<CaptionMode>>
  railLabels: RailLabels
  setRailLabels: (v: RailLabels) => void
  offlineRadiusM: number
  setOfflineRadiusM: Dispatch<SetStateAction<number>>
  offlineAuto: boolean
  setOfflineAuto: Dispatch<SetStateAction<boolean>>
  keepScreenOn: boolean
  setKeepScreenOn: Dispatch<SetStateAction<boolean>>
  linkScoped: boolean
  /** the session's role – which tutorials the Hilfe's «Ausprobieren» may start */
  role: AuthUser['role'] | undefined
  setFeedbackParent: Dispatch<SetStateAction<'settings' | null>>
  setFeedbackOpen: Dispatch<SetStateAction<boolean>>
  share: ReturnType<typeof useShareMyPosition>
  setShareParent: Dispatch<SetStateAction<'settings' | 'views' | 'status' | null>>
  setSharePick: Dispatch<SetStateAction<'ask' | 'pick' | 'rename' | null>>
  feedbackParent: 'settings' | null
  /** this session writes the record — «Standort zu Fotos» is offered only then */
  canWriteRecord: boolean
  /** «Standort zu Fotos» (lib/devicePosition): undefined = never asked on this device */
  photoPosition: boolean | undefined
  setPhotoPosition: (v: boolean) => void
}

export function WorkspaceSheets({
  helpOpen, setHelpOpen, shareLink, incidentMeta, setShareLink, setAtemschutzLinkOn, installGuideOpen,
  setInstallGuideOpen, offlineReadyOpen, setOfflineReadyOpen, offlineProbeUrls, sym, backendPlans,
  manualObject, liveWeather, personnel, syncStatus, lastSyncedAt, syncNow, downloadOffline,
  reloadPersonnel, cancelOffline, offlineProgress, settingsOpen, feedbackOpen, sharePick, shareParent,
  setSettingsOpen, symbolScale, setSymbolScale, symbolCaptions, setSymbolCaptions, railLabels,
  setRailLabels, offlineRadiusM, setOfflineRadiusM, offlineAuto, setOfflineAuto, keepScreenOn,
  setKeepScreenOn, linkScoped, role, setFeedbackParent, setFeedbackOpen, share, setShareParent, setSharePick,
  feedbackParent, canWriteRecord, photoPosition, setPhotoPosition,
}: WorkspaceSheetsProps) {
  return (
    <>
      {helpOpen && <HelpOverlay tutorials={offeredTutorials({ role, linkScoped })} onClose={() => setHelpOpen(false)} />}
      {/* ONE sheet for every «Teilen» door — its own tabs are the chooser (03.09.). `archived`
          drops the Atemschutz tab, which dies with the Einsatz. */}
      {shareLink && (
        <ShareIncidentSheet
          incidentId={incidentMeta.id}
          initialKind={shareLink}
          archived={incidentMeta.is_archived}
          // the QR beside the Atemschutz bell hands over in ONE tap: pressing it IS the
          // decision, so the sheet mints the link rather than asking a second time
          autoCreate={shareLink === 'atemschutz'}
          onClose={() => setShareLink(null)}
          // the Atemschutz header's own button paints its «ein Link läuft» tint from this,
          // so minting or revoking one is reflected the moment the sheet closes
          onState={(k, l) => { if (k === 'atemschutz') setAtemschutzLinkOn(l.enabled) }}
        />
      )}
      {installGuideOpen && <InstallGuide onClose={() => setInstallGuideOpen(false)} />}
      {offlineReadyOpen && (
        <OfflineReadinessSheet
          onClose={() => setOfflineReadyOpen(false)}
          probeUrls={offlineProbeUrls}
          symbolsReady={sym.ready}
          planCount={Object.keys(backendPlans).length}
          objectLabel={manualObject?.name ?? null}
          weatherOk={liveWeather.data != null}
          weatherError={liveWeather.error != null}
          personnelCount={personnel.length}
          syncStatus={syncStatus}
          lastSyncedAt={lastSyncedAt}
          onSyncNow={syncNow}
          onLoadAll={() => { void downloadOffline(); void reloadPersonnel() }}
          onCancel={cancelOffline}
          loading={offlineProgress != null}
          progress={offlineProgress}
        />
      )}
      {settingsOpen && !feedbackOpen && !(sharePick && shareParent === 'settings') && (
        <SettingsSheet
          onClose={() => setSettingsOpen(false)}
          symbolScale={symbolScale}
          onSymbolScale={setSymbolScale}
          symbolCaptions={symbolCaptions}
          onSymbolCaptions={setSymbolCaptions}
          railLabels={railLabels}
          onRailLabels={setRailLabels}
          offlineRadiusM={offlineRadiusM}
          onOfflineRadius={setOfflineRadiusM}
          offlineAuto={offlineAuto}
          onOfflineAuto={setOfflineAuto}
          keepScreenOn={keepScreenOn}
          onKeepScreenOn={setKeepScreenOn}
          // «Standort zu Fotos» — switching it on here asks the browser right away, on this tap
          photoPosition={canWriteRecord ? photoPosition === true : undefined}
          onPhotoPosition={canWriteRecord ? (on) => { setPhotoPosition(on); if (on) void currentFix() } : undefined}
          themeCoord={incidentMeta.lng != null && incidentMeta.lat != null ? [incidentMeta.lng, incidentMeta.lat] : null}
          // Rückmeldung posts a diagnostic report — refused for a link session, so don't offer it
          onFeedback={linkScoped ? undefined : () => { setFeedbackParent('settings'); setFeedbackOpen(true) }}
          // Einstellungen holds the PERMISSION only — «dieses Gerät darf meinen Standort
          // verwenden» — never the act. Switching it on opens the sheet (the device has to know
          // whose position it would be reporting); switching it off revokes and stops.
          shareAs={share.ready ? (share.pref?.displayName ?? null) : null}
          onSharePosition={!isDemoMode()
            ? (on) => {
              if (on) {
                setShareParent('settings')
                setSharePick('ask')
              }
              else share.revoke()
            }
            : undefined}
          onChangeShareName={() => {
            setShareParent('settings')
            setSharePick('rename')
          }}
        />
      )}
      {/* Rückmeldung, opened deliberately from Einstellungen. Nothing ever PUSHES this at the
          operator mid-incident — the trouble prompt lives on the launcher (see lib/trouble). */}
      {feedbackOpen && <FeedbackSheet onClose={(reason) => {
        setFeedbackOpen(false)
        if (reason === 'complete' && feedbackParent === 'settings') setSettingsOpen(false)
        setFeedbackParent(null)
      }} />}
    </>
  )
}
