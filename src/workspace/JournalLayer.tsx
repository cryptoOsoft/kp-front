// The Verlauf layer, app-level so it opens over every surface: the drawer (with its delivery
// notice), the Durchhören player and the «Eintrag» composer. Split out of IncidentWorkspace (E1,
// 09.10.2026) verbatim; the rows themselves are written by the workspace (addJournal,
// addPlayerEntry, the reminders), which hands its writers in as props.

import type { Dispatch, ReactElement, ReactNode, SetStateAction } from 'react'
import { AudioPlayerSheet } from '../components/AudioPlayerSheet'
import { Journal } from '../components/Journal'
import { type JournalDraft, JournalComposer } from '../components/JournalComposer'
import { JournalDeliveryNotice } from '../components/JournalDeliveryNotice'
import { appConfig } from '../config/appConfig'
import { combinedSyncStatus } from '../lib/combinedSyncStatus'
import { type IncidentMeta, uploadMedia } from '../lib/incidents'
import type { JournalLink } from '../lib/journalLinks'
import type { PhotoPlacement } from '../lib/photoGeo'
import { toast } from '../lib/ui'
import { JOURNAL_SAVED_KIND } from './useJournalWriters'
import type { useAuditEvents } from '../lib/useAuditEvents'
import type { useJournal } from '../lib/useJournal'
import type { useMediaQueue } from '../lib/useMediaQueue'
import type { useReminders } from '../lib/useReminders'
import type { LiveTargets } from '../lib/verlauf'
import type { TimelineEvent, PlanDocument } from '../types'

export interface JournalLayerProps {
  journalOpen: boolean
  guarded: (surface: string, node: ReactNode, toMap?: boolean) => ReactElement
  journal: ReturnType<typeof useJournal>
  auditDelivery: ReturnType<typeof useAuditEvents>
  closedRefusedTotal: number
  /** saves a wider role left on this device that this session cannot push (useLifecycleElsewhere) */
  workspaceRoleParked: number
  exportEntries: () => void
  journalVocab: JournalLink[]
  timeline: TimelineEvent[]
  incidentMeta: IncidentMeta
  planDocs: PlanDocument[]
  /** what still exists in the Einsatz (lib/verlauf · liveTargets) – which rows are a jump */
  journalLive: LiveTargets
  focusEvent: (e: TimelineEvent) => void
  replayActive: boolean
  replayAtMs: number | null
  seekToEvent: (e: TimelineEvent) => void
  journalLandOn: { id: string; nonce: number } | null
  setJournalOpen: Dispatch<SetStateAction<boolean>>
  setJournalLandOn: Dispatch<SetStateAction<{ id: string; nonce: number } | null>>
  journalFromRapport: boolean
  setJournalFromRapport: Dispatch<SetStateAction<boolean>>
  openRapport: () => void
  readOnly: boolean
  enterReplay: () => void
  reminders: ReturnType<typeof useReminders>
  setNoteOn: Dispatch<SetStateAction<{ id: string; text: string } | null>>
  setComposerOpen: Dispatch<SetStateAction<boolean>>
  reRaisePendenz: (reminderId: string, mins: number) => void
  media: ReturnType<typeof useMediaQueue>
  setPlayer: Dispatch<SetStateAction<{ row: TimelineEvent; seekSec?: number } | null>>
  photoOnMap: (row: Pick<TimelineEvent, 'photoUrl' | 'photoUrls' | 'id' | 'photoGeo'>, i: number) => PhotoPlacement | null
  tacticalLocked: boolean
  placePhotos: (row: Pick<TimelineEvent, 'photoUrl' | 'photoUrls' | 'id' | 'photoGeo'>, only?: number) => void
  showPhotoOnMap: (entityId: string) => void
  player: { row: TimelineEvent; seekSec?: number } | null
  isEditor: boolean
  addPlayerEntry: (text: string, atIso: string, quiet?: boolean) => string
  composerOpen: boolean
  /** the session may write nothing (access · roleReadOnly): no composer mounts, whatever asked
   *  for one – the checklist's «Verlauf» link reached it past every other gate (RBAC audit V4) */
  roleReadOnly: boolean
  addJournal: (d: JournalDraft, geoSettled?: boolean) => void
  noteOn: { id: string; text: string } | null
  /** a link session (access · linkScoped): every link is refused the audio peaks, so its player
   *  draws the flat bar without asking */
  linkScoped: boolean
  /** the Verlauf's «von der Tafel»: open the «Aufträge / Pendenzen» page (workspace/useTafelPendenzen) */
  openTafelPendenzen?: () => void
}

export function JournalLayer({
  journalOpen, guarded, journal, auditDelivery, closedRefusedTotal, workspaceRoleParked, exportEntries, journalVocab,
  timeline, incidentMeta, planDocs, journalLive, focusEvent, replayActive, replayAtMs, seekToEvent, journalLandOn,
  setJournalOpen, setJournalLandOn, journalFromRapport, setJournalFromRapport, openRapport, readOnly,
  enterReplay, reminders, setNoteOn, setComposerOpen, reRaisePendenz, media, setPlayer, photoOnMap,
  tacticalLocked, placePhotos, showPhotoOnMap, player, isEditor, addPlayerEntry, composerOpen, roleReadOnly,
  addJournal, noteOn, linkScoped, openTafelPendenzen,
}: JournalLayerProps) {
  return (
    <>
      {/* unified Verlauf + quick-add — rendered app-level so both open over either surface,
          and AFTER the Rapport sheet so its checklist row can stack the Verlauf on top */}
      {journalOpen && guarded('journal', (
        <Journal
          deliveryNotice={<JournalDeliveryNotice
            status={combinedSyncStatus(journal.syncStatus, auditDelivery.status)}
            count={journal.pendingCount + journal.rejectedCount + auditDelivery.pendingCount + auditDelivery.rejectedCount}
            refused={auditDelivery.refusedCount + workspaceRoleParked}
            closedRefused={closedRefusedTotal}
            onRetry={async () => { await Promise.all([journal.retry(), auditDelivery.retry()]) }}
            onExport={exportEntries}
          />}
          vocab={journalVocab}
          events={timeline}
          closedAt={incidentMeta.closed_at}
          plans={planDocs}
          live={journalLive}
          onSelect={focusEvent}
          replayAtMs={replayActive ? replayAtMs : null}
          onSeekTo={replayActive ? seekToEvent : undefined}
          landOn={journalLandOn}
          // ⚠️ The landing is CONSUMED on close. The drawer remounts every time it opens, so the
          // «already landed» guard inside it resets — and a stale `landOn` left lying around
          // meant the next ordinary open (TopBar, checklist, Rapport) silently jumped to
          // whatever row the Wiedergabe caption had pointed at, possibly hours ago.
          onClose={() => { setJournalOpen(false); setJournalLandOn(null); if (journalFromRapport) { setJournalFromRapport(false); openRapport() } }}
          onTranscript={!readOnly ? (id, transcript) => journal.appendPatch(id, { transcript: transcript.trim() }) : undefined}
          onReplay={!replayActive ? () => { setJournalOpen(false); enterReplay() } : undefined}
          openReminders={reminders.open}
          onOpenTafel={openTafelPendenzen}
          onReminderDone={!readOnly ? reminders.markDone : undefined}
          // tap a Pendenz → write a Meldung on it. The Verlauf steps aside so the composer is
          // not stacked on a drawer the operator can no longer see behind it.
          // ⚠️ The Verlauf STAYS OPEN behind it. Closing it meant that finishing a Meldung — or
          // thinking better of it — dropped you back onto the map, away from the list you were
          // working through; and at a Lagerapport you write several in a row. The composer is a
          // modal above the drawer (z 81 over 61), so nothing is lost behind it.
          onReminderNote={!readOnly ? (r) => {
            setNoteOn({ id: r.id, text: r.text })
            setComposerOpen(true)
          } : undefined}
          onReminderAgain={!readOnly && !replayActive ? reRaisePendenz : undefined}
          mediaStatusOf={media.statusOf}
          onOpenPlayer={(e, seekSec) => setPlayer({ row: e, seekSec })}
          onEditText={!readOnly ? (id, text) => journal.appendPatch(id, { textEdit: text }) : undefined}
          photoPlacement={photoOnMap}
          onPhotoPlace={!tacticalLocked && !replayActive ? (e) => placePhotos(e) : undefined}
          onPhotoShow={!replayActive ? showPhotoOnMap : undefined}
        />
      ))}
      {player && (
        <AudioPlayerSheet
          row={player.row}
          events={timeline}
          readOnly={readOnly}
          // transcribing and deciding its segments is editor-only on the server (api/media)
          canTranscribe={isEditor}
          serverPeaks={!linkScoped}
          initialSeekSec={player.seekSec}
          // the same vocabulary the composer gets — «Eintrag an dieser Stelle» writes into the
          // same Verlauf, so it completes and marks names identically
          vocab={journalVocab}
          onAddEntry={!readOnly ? addPlayerEntry : undefined}
          // a voice memo's words land on the memo itself, as a transcript section at the
          // playhead — appended like every enrichment, never edited in place
          onAddSection={!readOnly ? (atSec, text) => {
            journal.appendPatch(player.row.id, { transcriptSection: { at: atSec, text } })
            toast(appConfig.copy.journal.saved, { icon: 'type', tone: 'success', kind: JOURNAL_SAVED_KIND })
          } : undefined}
          // fixing a section replaces its words in place ('' removes it) — the recording is
          // the original, so no «korrigiert» mark and no new Verlauf line
          onEditSection={!readOnly ? (sectionId, text) => journal.appendPatch(player.row.id, { transcriptSectionEdit: { id: sectionId, text } }) : undefined}
          onPatchEntry={!readOnly ? (rowId, text) => journal.appendPatch(rowId, { textEdit: text }) : undefined}
          onRetractEntry={!readOnly ? (rowId) => {
            journal.appendPatch(rowId, { retracted: true })
            toast(appConfig.copy.journal.entryRemoved, {
              icon: 'trash', tone: 'default',
              action: { label: appConfig.copy.undo, onClick: () => journal.appendPatch(rowId, { retracted: false }) },
            })
          } : undefined}
          onClose={() => setPlayer(null)}
        />
      )}
      {composerOpen && !roleReadOnly && (
        <JournalComposer
          // everything this Einsatz has words for — Mannschaft, Mittel, Partnerorganisationen,
          // Fahrzeuge, Alarmgruppen. Typing three letters of any of them completes it.
          vocab={journalVocab}
          // …and this Einsatz's own rows, so the chips offered on an empty field are the phrases
          // that are actually being used tonight (lib/startChips)
          timeline={timeline}
          onSubmit={addJournal}
          onClose={() => { setComposerOpen(false); setNoteOn(null) }}
          noteOn={noteOn ?? undefined}
          onClearNote={() => setNoteOn(null)}
          // …and the same list the Verlauf pins, so an entry being written can be attached to an
          // open item without going through the Verlauf at all — the sheet offers the ones the
          // sentence already names, and holds a picker for the rest.
          openPendenzen={reminders.open.map((r) => ({ id: r.id, text: r.text, urgent: !!r.urgent, createdAt: r.createdAt }))}
          onLinkPendenz={(pdz) => setNoteOn(pdz)}
          incidentStartAt={incidentMeta.started_at}
          uploadAudio={(blob, filename) => uploadMedia(incidentMeta.id, blob, 'audio', filename)}
          // generic Beilagen (PDF & Co.) ride the same endpoint under kind 'file' — the server
          // hands those back as a download, never inline (backend/app/api/media.py)
          uploadFile={(blob, filename) => uploadMedia(incidentMeta.id, blob, 'file', filename)}
        />
      )}
    </>
  )
}
