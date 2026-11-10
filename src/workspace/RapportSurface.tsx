// The Rapport surface: the lazy ReportPreflight (Mindestangaben, Kroki framing, Beilagen,
// Abschluss). Split out of IncidentWorkspace (E1, 09.10.2026) verbatim; the Rapport's one write
// path (`saveReportMeta`) and the Abschluss (`confirmAndComplete`) stay in the workspace.

import { type ReactNode, type Dispatch, type SetStateAction, Suspense } from 'react'
import type { JSX } from 'react/jsx-runtime'
import { LoadingStatus } from '../components/ShellLoader'
import { appConfig } from '../config/appConfig'
import { isAtemschutzTrupp } from '../lib/atemschutz'
import type { OpenConflict } from '../lib/attendanceConflict'
import type { ChecklistState } from '../lib/checklists'
import type { IncidentMeta } from '../lib/incidents'
import { mittelLineCount } from '../lib/mittel'
import type { AssignableRole } from '../lib/roleAssignment'
import type { useMediaQueue } from '../lib/useMediaQueue'
import type { useSymbols } from '../lib/useSymbols'
import type { ReportMeta } from '../lib/workspace'
import type { ReportSignature } from '../lib/reportSignature'
import type { Person, TimelineEvent, Trupp, AttendanceState, MittelEntry, Entity, Drawing, PlanDocument, LayerDef, Incident, LngLat, BoardDoc, BuildingDoc, ReportAttachment, CaptionMode } from '../types'
import { ReportPreflight } from './lazySurfaces'
import type { WorkspaceMode } from './types'

export interface RapportSurfaceProps {
  mode: WorkspaceMode
  guarded: (surface: string, node: ReactNode, toMap?: boolean) => JSX.Element
  incidentMeta: IncidentMeta
  reportMeta: ReportMeta
  pickablePersonnel: Person[]
  presentIds: Set<string>
  timeline: TimelineEvent[]
  annotatedPlanCount: number
  allTrupps: Trupp[]
  attendance: AttendanceState
  mittel: MittelEntry[]
  entities: Entity[]
  drawings: Drawing[]
  media: ReturnType<typeof useMediaQueue>
  azIntervalMin: number
  azGraceSec: number
  checklists: ChecklistState
  planDocs: PlanDocument[]
  mapLayers: LayerDef[]
  sym: ReturnType<typeof useSymbols>
  incidentView: Incident
  view: { bearing: number; center: LngLat; zoom: number }
  symbolCaptions: CaptionMode
  board: BoardDoc
  effBuilding: BuildingDoc | null
  captureUsage: { writes: number; lastAt: string | null } | null
  attachments: ReportAttachment[]
  canEditRapport: boolean
  addAttachments: (files: File[]) => void
  captionAttachment: (id: string, caption: string) => void
  removeAttachment: (id: string) => void
  canShareLink: boolean
  running: boolean
  assignRole: (personId: string | undefined, role: AssignableRole, note?: string) => void
  assignTypedName: (name: string, role: AssignableRole, note?: string) => string | undefined
  saveReportMeta: (next: ReportMeta) => void
  canEditMeta: boolean
  onEditMeta: () => void
  setMode: Dispatch<SetStateAction<WorkspaceMode>>
  setRapportReturn: Dispatch<SetStateAction<boolean>>
  canWriteRecord: boolean
  resolveAttendanceConflict: (open: OpenConflict, choice: 0 | 1 | 'both') => void
  /** may close the Einsatz: the Rapport's green bands and its close (access · canCloseIncident) */
  canCloseIncident: boolean
  readOnly: boolean
  confirmAndComplete: () => Promise<boolean>
  setJournalOpen: Dispatch<SetStateAction<boolean>>
  setJournalFromRapport: Dispatch<SetStateAction<boolean>>
  reportSignatures: ReportSignature[]
  signRapport?: (sig: ReportSignature) => void
  voidSignatures?: () => void
}

export function RapportSurface({
  mode, guarded, incidentMeta, reportMeta, pickablePersonnel, presentIds, timeline, annotatedPlanCount,
  allTrupps, attendance, mittel, entities, drawings, media, azIntervalMin, azGraceSec, checklists,
  planDocs, mapLayers, sym, incidentView, view, symbolCaptions, board, effBuilding, captureUsage,
  attachments, canEditRapport, addAttachments, captionAttachment, removeAttachment, canShareLink,
  running, assignRole, assignTypedName, saveReportMeta, canEditMeta, onEditMeta, setMode,
  setRapportReturn, canWriteRecord, resolveAttendanceConflict, canCloseIncident, readOnly,
  confirmAndComplete, setJournalOpen, setJournalFromRapport, reportSignatures, signRapport, voidSignatures,
}: RapportSurfaceProps) {
  return (
    <>
      {mode === 'rapport' && guarded('rapport', (
        /* onEditDispatch leaves the preflight open so the Einsatzdaten wizard stacks on top
           (later in DOM, same z-index) — canceling it reveals the rapport again instead of a
           dead end. (Saving still remounts the workspace and returns to the map.) */
        <Suspense fallback={<div className="rp-backdrop"><div className="workspace-loading"><LoadingStatus size="surface">{appConfig.copy.loading}</LoadingStatus></div></div>}><ReportPreflight
          incident={incidentMeta}
          reportMeta={reportMeta}
          personnel={pickablePersonnel}
          presentIds={presentIds}
          events={timeline}
          annotatedPlanCount={annotatedPlanCount}
          // ⚠️ `allTrupps`, here and on the `trupps` prop below — the two places that print. A Trupp
          // taken off the Tafel was still under PA, and its readings, entry pressure and times are
          // exactly what the Atemschutz page exists to record (types · Trupp.removedAt).
          // ⚠️ …and PA only: this number decides whether the Atemschutz page is offered at all and
          // is printed in its own toggle («Atemschutz (3)»). A plain work squad never appears on
          // that page (lib/reportPdfDirect), so counting it would offer an empty page on an
          // Einsatz where nobody went under PA.
          truppCount={allTrupps.filter(isAtemschutzTrupp).length}
          attendanceCount={Object.keys(attendance).length}
          mittelCount={mittelLineCount(mittel)}
          mittel={mittel}
          // ⚠️ What counts as «es wurde eine Lage gezeichnet» — and a LIVE vehicle does not.
          // Those entities arrive from GPS on their own, so on a station running Traccar the
          // Kroki was pre-selected on every Einsatz, including ones where nobody drew anything:
          // a page of the printed rapport showing three lorries on an empty map. Only what an
          // operator placed or drew is a reason to print a picture.
          mapContentCount={entities.filter((e) => !e.live).length + drawings.length}
          pendingMediaCount={media.pendingCount}
          attendance={attendance}
          trupps={allTrupps}
          contactIntervalMin={azIntervalMin}
          contactGraceSec={azGraceSec}
          checklists={checklists}
          plans={planDocs}
          scene={{ entities, drawings, layers: mapLayers, byName: sym.byName, center: incidentView.center, view: { center: view.center, zoom: view.zoom }, captionMode: symbolCaptions ?? 'auto' }}
          board={board}
          building={effBuilding}
          captureUsage={captureUsage}
          attachments={attachments}
          onAddAttachments={canEditRapport ? addAttachments : undefined}
          onCaptionAttachment={canEditRapport ? captionAttachment : undefined}
          onRemoveAttachment={canEditRapport ? removeAttachment : undefined}
          canEdit={canEditRapport}
          canShare={canShareLink}
          // a closed Einsatz's Rapport says so at the top: the changes are Nachträge (F10)
          closedHint={!running && canEditRapport}
          // the Unterschriften card (lib/reportSignature): signed only on a closed Einsatz
          closed={!running}
          reportSignatures={reportSignatures}
          onSign={signRapport}
          onVoidSignatures={voidSignatures}
          onRolePicked={assignRole}
          // the Einsatzleiter / Rückmeldung pickers: a typed name is a Gast, so the EL named on
          // the front page of the rapport is on the Anwesenheit behind it even for a Nachbarwehr
          onAddGuest={canEditRapport ? assignTypedName : undefined}
          onSaveMeta={saveReportMeta}
          // dispatch data + Abschluss stay incident-level: PATCH /incidents is editor-only,
          // and archiving an Einsatz is not record-keeping (the el role reads both).
          onEditDispatch={canEditMeta ? onEditMeta : undefined}
          onOpenAnwesenheit={() => { setMode('anwesenheit'); setRapportReturn(true) }}
          onOpenMittel={() => { setMode('mittel'); setRapportReturn(true) }}
          onResolveConflict={canWriteRecord ? resolveAttendanceConflict : undefined}
          // Do NOT close the sheet here. On the real path the completion switches the active
          // Einsatz and this whole workspace unmounts, so closing it is redundant; on the demo
          // (and on any refusal) `completeRapport` returns early with a toast — and the sheet
          // had already been shut, so the operator lost their place for an action that never
          // happened. The «Abschliessen» confirm closes itself; that is the only thing that should.
          // ⚠️ The confirm (and the media flush that follows it) lives in `confirmAndComplete`
          // above, shared with the Einsatz-Menü row — one action, one dialog, one wording.
          onComplete={canCloseIncident && !readOnly ? confirmAndComplete : undefined}
          // «Im Verlauf ergänzen» is a write – only for a session that writes the record
          onFixTranscripts={canWriteRecord ? () => { setJournalOpen(true); setJournalFromRapport(true) } : undefined}
        /></Suspense>
      ))}
    </>
  )
}
