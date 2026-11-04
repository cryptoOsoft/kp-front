// The Rapport – the Einsatzrapport as a full surface, not a dialog: the Einsatzdaten and Zeiten,
// the Kontrolle of what is still open, the print options with the Kroki framing panel, the PDF,
// the Unterschriften and the «Abschliessen» band. It reads the Einsatz's own record (Verlauf,
// Anwesenheit, Mittel, Trupps) rather than asking for it twice; what it prints comes from
// lib/report. The close runs only through `onComplete` (the one shared Abschluss confirm).
// Rules for this area: docs/rapport.md.

import { useEffect, useEffectEvent, useMemo, useRef, useState, type ReactNode } from 'react'
import { Icon } from '../lib/icons'
import { Button, IconButton } from './Button'
import { TickRow } from './TickRow'
import { ShellLoader } from './ShellLoader'
import { cx } from '../lib/cx'
import { parseAlarmText } from '../lib/alarmText'
import { confirmDialog, openPhoto, toast, type ToastAction } from '../lib/ui'
import { buildDirectReportPayload, downloadDirectReportPdf, readyDirectReportPayload, signedPartOf, usedStackFloors } from '../lib/reportPdfDirect'
import { sha256Hex, type ReportSignature } from '../lib/reportSignature'
import { newId } from '../lib/ids'
import { serverNowIso } from '../lib/serverClock'
import type { SignSubmit } from './SignatureSheet'
import { warmTemplates, type ChecklistState, type ChecklistTemplate } from '../lib/checklists'
import { downloadUrl } from '../lib/download'
import { thumbUrl } from '../lib/mediaUrl'
import { geretteteFromLage, geretteteOffer } from '../lib/gerettete'
import { rowPhotos } from '../lib/verlauf'
// the geometry every full surface stands in — the Rapport is the fifth of them
import surface from './Surface.module.css'
import { usePageHeadFit } from '../lib/pageHeadFit'
import { KrokiFramingPanel } from './KrokiFramingPanel'
import { ShareIncident } from './panels/ShareIncident'
import { cancelPrint, editorPrintTransport, enqueuePrint, fetchJobStatus, fetchPrintStatus, prewarmPrint, type PrintJobStatus, type PrintRelayStatus } from '../lib/printRelay'
import { trackPrintJob } from '../lib/printJobToast'
import { appConfig } from '../config/appConfig'
import { fillTemplate, fmtSpanShort, hhmm, dtLocalValue, dtLocalToIso, stripUnprintable, telHref, unitLabel } from '../lib/format'
import { closeTimeOf, getIncident, type IncidentMeta } from '../lib/incidents'
import type { FahrzeugZeit, GruppeZeit, PartnerContact, ReportMeta } from '../lib/workspace'
import { deriveAusgerueckt, fahrzeugRows, gruppenRows, setFahrzeugZeit, setGruppeZeit, zeitFromClock, zeitIssues } from '../lib/alarmzeiten'
import { fahrtenText } from '../lib/vehiclePresence'
import { VehicleGpsTable } from './VehicleGpsTable'
import type { ZeitKind } from '../lib/alarmzeiten'
import type { AssignableRole } from '../lib/roleAssignment'
import { deploymentName, getDeploymentConfig, reportLinks } from '../lib/deploymentConfig'
import { addPartnerOrg, partnerOrgOffer, partnerOrgsFromLage } from '../lib/partnerOrgs'
import { linkTokenValues, resolveLinkUrl, type ReportLink } from '../lib/reportLinks'
import type { ReportDraft, ReportOptions } from '../lib/report'
import {
  defaultReportOptions, formatDateTime, hasVisiblePlanAnnotation, missingTranscriptCount, pendenzRows, proofLabel,
} from '../lib/report'
import { TAFEL_ID, findForms } from '../lib/boardForm'
import { abschlussFacts, missingSteps, nextOpenStep, stepDone, type AbschlussFacts, type AbschlussStep } from '../lib/abschluss'
import { abschlussSheet, controlChipLabel } from '../lib/abschlussOpen'
import { hoursRows, unresolvedHoursRows } from '../lib/attendanceHours'
import { openConflicts, sideLabel, sideValue, type OpenConflict } from '../lib/attendanceConflict'
import { incidentDays } from '../lib/zeitplanFormat'
import type { AttendanceState, BoardDoc, BuildingDoc, CaptionMode, Drawing, Entity, LayerDef, LngLat, MittelEntry, Person, PlanDocument, ReportAttachment, TimelineEvent, Trupp } from '../types'
import { visibleMittel } from '../lib/mittel'
import { ClearableInput } from './ClearableInput'
import { PersonField } from './PersonField'
import { PhoneTabBar } from './PhoneTabBar'
import { useIsPhone } from '../lib/useIsPhone'
import { journalVocabulary } from '../lib/journalLinks'
import { CaptureUsageChip, type CaptureUsage } from './CaptureUsageChip'
import { DateTimeField, TimeField } from './TimeField'
import { Stepper } from './Stepper'
import { Menu, Popover } from '../lib/overlays'
import { CheckRow } from './ReportCheckRow'
import { dirtyFormMeta, formToMeta, geretteteMeta, numOrU, partnerFilled, partnersMeta, remoteForm, rueckMeta, type ReportForm } from './reportForm'
import { normCount, normDtLocal, normList, normPartners, normText, useBlurTick, useSyncedField } from './useSyncedField'
import { ReportSignatures } from './ReportSignatures'
import { printedSignatures, useSignatureLock } from './useReportSignatures'
import { useAuditProof } from './useAuditProof'
import { initialKrokiAt, useKrokiMoment } from './useKrokiMoment'
import { PHONE_TABS, STEP_TAB, rapportKept, useReportPlace, type PhoneTab } from './useReportPlace'

const NO_IDS = new Set<string>()
const NO_SIGNATURES: ReportSignature[] = []
/** The Rapport head's ladder (lib/pageHeadFit): «Ausdrucken» gives its word first, then
 *  «Abschliessen», then the Kontrolle chip keeps its ⚠ and its count («⚠ 4», the words stay its
 *  title), then the primary «Einsatzrapport (PDF)» shortens to «PDF ▾» (mockup 2), and last the
 *  title says what the nav calls this page, «Rapport». */
const RP_FOLD = { print: 1, complete: 2, chip: 3, pdf: 4, title: 5 } as const

// «Zeig mir diese offene Angabe» from outside the sheet — lives with the tabs (useReportPlace)
export { requestReportStep } from './useReportPlace'

/** HH:MM display value for the compact time inputs of the Zeiten grid. */
function clockOf(iso?: string): string {
  if (!iso) return ''
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  return hhmm(d)
}

/** A recorded value on a Rapport this session cannot change – a viewer, a view link, a closed
 *  Einsatz it may not correct, a signed Rapport (RBAC audit 22.10.2026, `!canEdit`). The words
 *  themselves in the dispatch block's read-out type, never a disabled field: a door the session
 *  cannot go through is not drawn, and an empty prompt box («Was ist passiert …») asked a driver
 *  to write. Nothing recorded reads «Nicht erfasst», like the dispatch block above it. */
function ReadOut({ value }: { value?: string | null }) {
  const v = value?.trim()
  return <div className={cx('rp-readout', !v && 'report-meta-empty')}>{v || appConfig.copy.preflight.notRecorded}</div>
}


// «Später» on the Abschluss-Band, per incident. Same kind of box as the kept place (useReportPlace ·
// rapportKept) and for the same reason — the surface unmounts on every hop to Anwesenheit/Mittel/Verlauf, and a dismissal that
// did not survive that would put the band back on screen two taps later. Deliberately NOT in the
// workspace blob and NOT on disk: it is one operator postponing one decision on one device, and a
// «Später» that outlived a reload would turn the only surface that says «dieser Einsatz ist noch
// offen» permanently silent — which is the failure this whole band exists to fix.
const bandDismissed: { current: Set<string> } = { current: new Set() }

/**
 * One strip under the Rapport's head (28.10.2026): the guide to the next open point (#14) and the
 * Abschluss band (#15) wear it alike, at one size – a tap target with a small lead line over the
 * thing it goes to, an optional ✕ in front, and room under it for one more line (`children`).
 */
function RpStrip({ lead, count, title, icon, done = false, busy = false, onGo, onHide, hideLabel, children }: {
  lead: string
  /** the amber «noch n offen» after the lead (the guide) */
  count?: string
  title: string
  icon?: ReactNode
  /** green: everything is recorded, this is the next step (the band) */
  done?: boolean
  busy?: boolean
  onGo: () => void
  onHide?: () => void
  hideLabel?: string
  children?: ReactNode
}) {
  return (
    <div className={cx('rp-strip', done && 'rp-strip-done')}>
      {onHide && hideLabel && (
        <IconButton label={hideLabel} className="rp-strip-x" onClick={onHide}><Icon id="close" /></IconButton>
      )}
      <button type="button" className="rp-strip-go" onClick={onGo} disabled={busy} aria-busy={busy || undefined}>
        {icon && <span className="rp-strip-ico">{icon}</span>}
        <span className="rp-strip-txt">
          <span className="rp-strip-lead">{lead}{count && <> · <b className="rp-strip-n">{count}</b></>}</span>
          <span className="rp-strip-t">{title}</span>
        </span>
        <Icon id="chevron" className="rp-strip-chev" />
      </button>
      {children}
    </div>
  )
}

export function ReportPreflight({
  incident, reportMeta, personnel = [], presentIds = NO_IDS, onRolePicked, onAddGuest, events, annotatedPlanCount, truppCount, attendanceCount, mittelCount, mittel = [], mapContentCount = 1, pendingMediaCount = 0, attendance = {}, trupps = [], contactIntervalMin, contactGraceSec, checklists, plans = [], scene, board, building, captureUsage, canEdit: canEditIn = true, canShare = canEditIn, attachments = [], onAddAttachments, onCaptionAttachment, onRemoveAttachment, onSaveMeta, onEditDispatch, onOpenAnwesenheit, onOpenMittel, onResolveConflict, onComplete, onFixTranscripts, closedHint = false,
  closed = false, reportSignatures = NO_SIGNATURES, onSign, onVoidSignatures,
}: {
  incident: IncidentMeta
  reportMeta: ReportMeta
  /** Mannschaft roster + who is present — the Einsatzleiter picker offers present crew first */
  personnel?: Person[]
  presentIds?: Set<string>
  /** Naming somebody here puts them on the Anwesenheit list and, for the Einsatzleiter, writes
   *  the function into their Bemerkung. A rapport that names an Einsatzleiter the attendance
   *  sheet has never heard of contradicts itself on paper. Undefined = nothing to link, which
   *  by now only happens for a name typed on a session that may not write. */
  onRolePicked?: (personId: string | undefined, role: AssignableRole, note?: string) => void
  /** …and the id a hand-typed name is filed under: the roster's, or a fresh Gast's. Carries the
   *  job, because a Gast's row is CREATED by this call — there is nothing yet for a following
   *  `onRolePicked` to write a Bemerkung onto. Absent = the session may not write. */
  onAddGuest?: (name: string, role: AssignableRole, note?: string) => string | undefined
  events: TimelineEvent[]
  annotatedPlanCount: number
  truppCount: number
  attendanceCount: number
  /** count of distinct visible Mittel lines — drives the section toggle + its label */
  mittelCount: number
  /** append-only Mittel entries — the quick-check list derives current lines from them */
  mittel?: MittelEntry[]
  /** entities+drawings on the Lage map — 0 seeds the Kroki page OFF (rapport-only incident) */
  mapContentCount?: number
  /** captures (photo/audio) still in the offline upload queue — warns they aren't on the
   *  server yet, so a report printed now won't include them from another device */
  pendingMediaCount?: number
  /** full attendance record — drives the collapsible Stunden (von–bis) editor */
  attendance?: AttendanceState
  trupps?: Trupp[]
  /** the Funkkontakt-Intervall this Einsatz ran on + the grace on top — what «überfällig»
   *  meant here. It is a per-incident setting, so nobody can look it up on the paper later. */
  contactIntervalMin?: number
  contactGraceSec?: number
  /** the Checkliste tick state — the Auswertung's phase bands (lib/auswertung); the templates
   *  that name the phases are read here, from the same warm cache the Checkliste tab uses */
  checklists?: ChecklistState
  plans?: PlanDocument[]
  /** the Lage scene for the server-rendered Kroki (entities/drawings/layers/view) */
  scene?: {
    entities: Entity[]
    drawings: Drawing[]
    layers: LayerDef[]
    byName: Record<string, string>
    center: LngLat
    view: { center: LngLat; zoom: number }
    /** the map's Beschriftungen setting — the printed Kroki carries the same labels the
     *  screen it was framed on did (an Einsatzleiter symbol prints its name) */
    captionMode?: CaptionMode
  }
  /** what every sheet DRAWS — its own annos plus the Karte's objects projected onto it
   *  (lib/useObjectStore · board). Server-rendered as the annotated Objektplan pages. */
  board?: BoardDoc
  /** the picked Gebäude (floor stack) — exports as blank-base plan pages when present */
  building?: BuildingDoc | null
  /** QR self-reporting in use — «QR: N Einträge · zuletzt HH:MM» chip (informational) */
  captureUsage?: CaptureUsage | null
  /** Beilagen: photos that belong to the REPORT (an ID document, a damage close-up), printed
   *  large enough to read at the end. Separate from Verlauf photos on purpose — see
   *  types · ReportAttachment. Omit the handlers on a read-only surface and the block reads. */
  attachments?: ReportAttachment[]
  onAddAttachments?: (files: File[]) => void
  onCaptionAttachment?: (id: string, caption: string) => void
  onRemoveAttachment?: (id: string) => void
  /** persist the inline Rapportangaben edits (after-arrival fields) into the workspace */
  onSaveMeta: (next: ReportMeta) => void
  /** may this session write the Rapportangaben? False for a viewer and for an ARCHIVED Einsatz
   *  (which is «nur ansehen – zum Bearbeiten reaktivieren»): the fields render, filled in and
   *  readable, but nothing in them can be changed. */
  canEdit?: boolean
  /** may this session hand the Einsatz out (the «Weitergeben» section)? NOT `canEdit`: the `el`
   *  role keeps the record but minting and reading links is editor-only on the server — the
   *  section fetched both links on mount and logged two 403s for every el (3am test, 25.09.2026).
   *  Defaults to `canEdit` for callers that never distinguished the two. */
  canShare?: boolean
  /** Stunden editor: correct one person's von–bis; omit to render the table read-only */
  /** open the Einsatzdaten panel to correct the dispatch facts; omit to hide the link
   *  (e.g. viewers / read-only) */
  onEditDispatch?: () => void
  /** checklist navigation into the REAL views (the practice rationale): these close the
   *  sheet and reveal the surface — same tools on every incident size */
  onOpenAnwesenheit?: () => void
  onOpenMittel?: () => void
  /** Settle one Anwesenheits-Abweichung: write the chosen value into the record (or leave the
   *  merge alone for «beide stimmen so») AND append the row that says so. ONE call, because the
   *  two halves must not drift apart — a record change with no line, or a line about a change
   *  that never landed, are both worse than the warning it replaces. */
  onResolveConflict?: (open: OpenConflict, choice: 0 | 1 | 'both') => void
  /** «Einsatz abschliessen» — runs the confirm (the shared one, see IncidentWorkspace ·
   *  confirmAndComplete), stamps report_done_at and closes. Resolves TRUE only when the Einsatz
   *  was actually handed over, so a cancelled confirm changes nothing here either. Omit for
   *  viewers / read-only. */
  onComplete?: () => Promise<boolean>
  /** jump to the Verlauf to fill the still-missing audio transcripts */
  onFixTranscripts?: () => void
  /** The Einsatz is CLOSED and this Rapport is still editable (staging r3, F10): one line at the
   *  top says that the changes print as Nachträge — the Abschluss promised exactly that, and the
   *  fields looking «open» on a closed Einsatz must not read as a mistake. */
  closedHint?: boolean
  /** the Einsatz is closed — the only time a Rapport is signed (a reopen ends every signature:
   *  one only counts when it was made after the latest close) */
  closed?: boolean
  /** the Rapport's digital signatures (lib/reportSignature), history included */
  reportSignatures?: ReportSignature[]
  /** append a signature; omit where this session may not sign */
  onSign?: (sig: ReportSignature) => void
  /** «Ändern» on a signed Rapport: every live signature is voided (kept in the history) */
  onVoidSignatures?: () => void
}) {
  // ── Unterschriften (15.10.2026) ──────────────────────────────────────────────────────────
  // The lock has to be known up here, before anything uses `canEdit` (useSignatureLock); the
  // signed part's hash it checks against is computed below, once `meta` exists (setScopeHash).
  const closedAt = closeTimeOf(incident)
  const { liveSigs, sigValid, signedLock, setScopeHash } = useSignatureLock(reportSignatures, closedAt, closed)
  const canEdit = canEditIn && !signedLock

  // Defaults follow the data: a rapport-only incident (nothing drawn) prints without the
  // map/plan pages, no configuration needed; every toggle stays available as an override.
  // Personal + Material stay ON even with zero records: the rapport is a pre-filled
  // FORM (2026-07-17) — empty sections print as tick-off roster rows / amount stubs.
  // ⚠️ Derived HERE rather than passed in like the other counts: it comes out of the journal the
  // sheet already has, and the number is also the diagnostic — «Aufträge / Pendenzen (0)» says the
  // Einsatz raised none, which is a different answer from a section that failed to reach paper.
  // ⚠️ And the OPTION is not seeded from it (`defaultReportOptions.pendenzen` is simply true).
  // Seeding «on if there are any» reads the count ONCE, at mount, from whatever the sheet happened
  // to know then — every item raised afterwards found the section already switched off, silently
  // and for the rest of the Einsatz. The payload carries an empty list when there are none, so
  // «always on» costs nothing: the section prints if and only if there is something to print.
  const pendenzCount = useMemo(() => pendenzRows(events).length, [events])
  // the Gebäude section's count is its diagnostic, like the Pendenzen's: «(0)» says no storey
  // carries anything, which is why no Gebäude page will print
  // the Tafel's pages, plus its Skizze when it carries ink (reportPdfDirect · tafelPayload)
  const tafelPageCount = useMemo(() => {
    const annos = board?.[TAFEL_ID] ?? []
    return findForms(annos).length + (hasVisiblePlanAnnotation({ [TAFEL_ID]: annos }, TAFEL_ID) ? 1 : 0)
  }, [board])
  const stackFloorCount = useMemo(() => {
    const stack = plans.find((p) => p.floorStack)
    return stack && building ? usedStackFloors(building, board?.[stack.id] ?? []).length : 0
  }, [plans, building, board])
  // The Auswertung names its phase bands after the checklist phases: the templates are already
  // warm (IncidentWorkspace loads them when the Einsatz opens), so this resolves at once. Until
  // it does — or offline with nothing cached — the PDF simply carries no phase lane.
  const [checklistTemplates, setChecklistTemplates] = useState<ChecklistTemplate[]>([])
  useEffect(() => {
    if (!checklists) return
    let alive = true
    warmTemplates().list.then((l) => { if (alive) setChecklistTemplates(l) }, () => {})
    return () => { alive = false }
  }, [checklists])
  // what this Einsatz's Rapport looked like when it was last left (useReportPlace · rapportKept),
  // read once: every seed below that it carries is a mount-time seed
  const [kept] = useState(() => rapportKept.read(incident.id))
  const [options, setOptions] = useState<ReportOptions>(() => ({
    ...defaultReportOptions,
    kroki: mapContentCount > 0,
    atemschutz: truppCount > 0,
    // the Auswertung is NOT seeded: it stays the default's unticked (owner, 10.10.2026 — it seeded
    // «ticked when a crew went in under PA» on 09.10.); an operator's own tick is kept below
    // The framing chosen for the LAST print of this Einsatz — the Kroki panel opens on it and
    // reports every settled pan back into this same field, so what the surface would print is
    // always what the crop on screen shows. Auto on first use: the operational extent decides
    // the shape, so a Lage that runs north–south opens upright without anyone asking for it.
    krokiView: reportMeta.krokiPrint?.view ?? null,
    // ⚠️ HOCH by default. The rapport is a portrait document and every other page of it is
    // portrait, so a landscape Kroki turns the one sheet people actually look at sideways in the
    // middle of the stack. It used to be derived from the scene's bounding box, which meant the
    // orientation changed between two prints of the SAME Einsatz as symbols were added. A
    // remembered choice still wins — this is only what an unframed rapport starts from.
    krokiLandscape: reportMeta.krokiPrint?.landscape ?? false,
    // …and LAST, so the operator's own picks beat every seed above them: what was chosen before
    // the hop to Anwesenheit/Mittel is what this Einsatz still prints (see rapportKept).
    ...(kept?.optionOverrides ?? {}),
  }))
  // The deviations from those seeds — the patch, not the result. Kept across the unmount so a
  // remount re-reads the live data (a Lage drawn in the meantime turns `kroki` back on) and then
  // re-applies what the operator actually decided.
  const optionOverrides = useRef<Partial<ReportOptions>>(kept?.optionOverrides ?? {})

  // Every focus move inside the sheet, counted (useSyncedField · useBlurTick).
  const blurTick = useBlurTick()

  // What the BLOB says, field by field, in the shape each field holds it in on screen
  // (reportForm · remoteForm); `useSyncedField` decides per field whether the screen follows it.
  const remote = remoteForm(reportMeta, scene?.entities, incident)
  const remotePartners = reportMeta.partnerContacts ?? []

  // Partnerorganisationen. The field existed in the model and PRINTED for months, but nothing
  // ever wrote it — so every rapport fell back to the config's tick-off row and «Polizei war da»
  // was all the paper ever said. The remark is the point of the block: which patrol, whose
  // number, what they took over.
  const [partners, setPartners, partnersDirty] = useSyncedField('partners', remotePartners, normPartners, blurTick)
  const savePartners = (next: PartnerContact[]) => {
    // Bail BEFORE the local state: `persist` already refuses to write while read-only, so
    // accepting the edit on screen would show a viewer (or a closed Einsatz) a partner that
    // was never saved and vanishes on close — the silent-drop failure the read-only fieldset
    // exists to prevent. This block sits outside that fieldset, so it guards itself.
    if (!canEdit) return
    setPartners(next)
    // an all-empty row is nothing to record — dropped on the way to the blob, kept on screen
    persist(partnersMeta(next))
  }
  const patchPartner = (i: number, over: Partial<PartnerContact>) =>
    savePartners(partners.map((p, j) => (j === i ? { ...p, ...over } : p)))
  // WHEN the printed Kroki shows (useKrokiMoment). It survives the round trip to
  // Anwesenheit/Mittel with the print options (rapportKept): a Stand picked by hand is a choice
  // about the sheet, exactly like the sections are.
  /** Is there anything to frame? A rapport-only Einsatz (nothing drawn, nothing placed) seeds
   *  the Kroki section OFF and must not show an empty map pretending to be a picture — and
   *  switching the section off by hand means the same thing: nothing is going on the paper. */
  const krokiPanel = options.kroki && mapContentCount > 0 && !!scene
  const kroki = useKrokiMoment({
    incidentId: incident.id,
    startedAt: reportMeta.startedAt ?? incident.started_at,
    initialAt: initialKrokiAt(kept, reportMeta.krokiPrint?.at),
    shown: krokiPanel,
    events,
  })

  /** the Lage the printed Kroki is built from: the reconstructed one when a moment is chosen */
  const effScene = kroki.pastScene && scene ? { ...scene, entities: kroki.pastScene.entities, drawings: kroki.pastScene.drawings } : scene

  const presetOrgs = getDeploymentConfig().report?.partnerOrgs ?? []
  /** One row per organisation: the station's list (ticked or not), then any recorded org that is
   *  not on it. Matching is case-insensitive on the name, so a list entry and a typed one are
   *  the same organisation and can never appear twice. */
  const partnerRows = useMemo(() => {
    const key = (o?: string) => (o ?? '').trim().toLowerCase()
    const rows: { org: string; i: number; custom: boolean }[] =
      presetOrgs.map((org) => ({ org, i: partners.findIndex((p) => key(p.org) === key(org)), custom: false }))
    partners.forEach((p, i) => {
      if (!presetOrgs.some((o) => key(o) === key(p.org))) rows.push({ org: p.org ?? '', i, custom: true })
    })
    return rows
  }, [presetOrgs, partners])
  /* SEARCH-TO-CREATE (11.09.) — the typed name IS the new row. «+ Organisation hinzufügen» used
   * to append a BLANK row with an empty input: two steps, and the empty row stood there as a
   * half-finished record until somebody typed into it (and `partnerFilled` silently dropped it
   * if nobody did). Now one control asks the one question it has — «welche?» — and answers it
   * either from the station's list or from what was typed. The rule (trim, one row per
   * organisation, a listed name ticks its own row) is shared with the poster: lib/partnerOrgs. */
  const addPartner = (typed: string) => {
    const next = addPartnerOrg(partners, stripUnprintable(typed))
    if (next) savePartners(next)
  }
  /* ⚠️ A PLAIN field since 18.09.2026, not a picker. The Combo suggested exactly the station's
     own organisations — the same names standing as tappable rows two centimetres above it — so
     typing opened a menu offering what was already on screen, over the field being typed into.
     What is left is the one thing the rows cannot do: name an organisation nobody listed. */
  const [partnerDraft, setPartnerDraft] = useState('')
  const commitPartner = () => {
    if (!partnerDraft.trim()) return
    addPartner(partnerDraft)
    setPartnerDraft('')
  }
  const { proof, checking } = useAuditProof(incident.id)
  // the alarm text auto-fills from the incident's dispatch text when none was typed in the
  // Einsatzdaten panel — display + print fallback only, never persisted into the report blob.
  const [alarmFallback, setAlarmFallback] = useState('')

  // Rapportangaben = the after-arrival fields, edited inline here. Every change is persisted
  // live (see persist) so nothing is lost if the sheet is closed — and every field follows the
  // blob while this operator is not editing it (see useSyncedField), because the same sheet is
  // open on the Einsatzleiter's iPad.
  const [summary, setSummary, summaryDirty] = useSyncedField('summary', remote.summary, normText, blurTick)
  const [kontaktperson, setKontaktperson, kontaktpersonDirty] = useSyncedField('kontaktperson', remote.kontaktperson, normText, blurTick)
  const [kontaktTel, setKontaktTel, kontaktTelDirty] = useSyncedField('kontaktTel', remote.kontaktTel, normText, blurTick)
  // Seeded from the Kroki when the Rapport has none of its own: the EL was already named on the
  // map (Einsatzleiter glyph / KP Front), so typing it a second time is pure duplication. A
  // pre-fill only — the picker stays editable and the typed value wins from then on.
  const [einsatzleiter, setEinsatzleiter, einsatzleiterDirty] = useSyncedField('einsatzleiter', remote.einsatzleiter, normText, blurTick)
  const [endedAt, setEndedAt, endedAtDirty] = useSyncedField('endedAt', remote.endedAt, normDtLocal, blurTick)
  const [ausgerueckt, setAusgerueckt, ausgeruecktDirty] = useSyncedField('ausgerueckt', remote.ausgerueckt, normDtLocal, blurTick)
  const [remarks, setRemarks, remarksDirty] = useSyncedField('remarks', remote.remarks, normText, blurTick)
  const [lehren, setLehren, lehrenDirty] = useSyncedField('lehren', remote.lehren, normText, blurTick)
  // Alarmierungs-/Ausrückzeiten grid (G1/G2) + the paper-form Details fields (G4).
  // Grid rows come from deployment config (empty config = grid hidden); values are
  // prefilled by the milestone webhook, edits here stamp `manual` (human beats machine).
  const [gruppen, setGruppen, gruppenDirty] = useSyncedField<GruppeZeit[]>('gruppen', remote.gruppen, normList, blurTick)
  const [fahrzeuge, setFahrzeuge, fahrzeugeDirty] = useSyncedField<FahrzeugZeit[]>('fahrzeuge', remote.fahrzeuge, normList, blurTick)
  const [geretteteP, setGeretteteP, gerettetePDirty] = useSyncedField('geretteteP', remote.geretteteP, normCount, blurTick)
  const [geretteteT, setGeretteteT, geretteteTDirty] = useSyncedField('geretteteT', remote.geretteteT, normCount, blurTick)
  // ── «Auf der Lage» — the Gerettete already standing on the map, offered into the fields ──
  // Same shape as the Material surface's «Gesetzt, aber nicht erfasst» strip: it states what it
  // read and where, one tap fills both fields, and nothing is ever written on its own. The
  // Rettungs-Symbol carries «Anzahl Personen» in its count and «Anzahl Tiere» in its own field,
  // so the number the Rapport asks for has been on the Kroki the whole time (lib/gerettete).
  /** every symbol standing on the Lage AND on the plans — the one input both map-read offers
   *  share. ⚠️ The two are VIEWS of the same records since the unified-objects rework, so ids
   *  collide by design and a symbol near a georeferenced plan arrives more than once: each
   *  reader says how it handles that (lib/gerettete dedups by id, lib/partnerOrgs collects a set). */
  const placedOnLage = useMemo(
    () => [...(scene?.entities ?? []), ...Object.values(board ?? {}).flat()],
    [scene?.entities, board],
  )
  const geretteteLage = useMemo(() => geretteteFromLage(placedOnLage), [placedOnLage])
  const geretteteHint = canEdit
    ? geretteteOffer(geretteteLage, { personen: numOrU(geretteteP), tiere: numOrU(geretteteT) })
    : null
  // ── «Auf der Karte» — the Partnerorganisationen the Kroki already shows ──
  // A «Bereich Polizei» standing on the map IS the answer to «war die da?», and the checklist
  // further down asks it a second time, an hour later, from memory. Same strip, same promise as
  // the Gerettete one above: it states what it read, and the rows tick on a tap — never on their
  // own (lib/partnerOrgs · partnerOrgsFromLage, symbol→Organisation in appConfig.symbols).
  // (not memoised: one pass over the already-memoised symbols, and `presetOrgs` is a fresh array
  // on every render anyway — a useMemo here would recompute each time AND lie about it)
  const partnerHint = canEdit ? partnerOrgOffer(partnerOrgsFromLage(placedOnLage, presetOrgs), partners) : null
  const [rueckName, setRueckName, rueckNameDirty] = useSyncedField('rueckName', remote.rueckName, normText, blurTick)
  // ⚠️ The full ISO, not an HH:MM. The Rückmeldung an die ELZ is regularly given after
  // midnight, or the morning after on a long Einsatz, and a bare clock had to guess which
  // day it meant (applyTimeToIso rolled it forward past the start). The Einsatzende beside
  // it has always asked for a date; this is the same question and now asks it the same way.
  const [rueckAt, setRueckAt, rueckAtDirty] = useSyncedField('rueckAt', remote.rueckAt, normText, blurTick)

  useEffect(() => {
    if (reportMeta.alarmText) return
    let alive = true
    getIncident(incident.id)
      .then((full) => { if (alive && full.text) setAlarmFallback(full.text) })
      .catch(() => {})
    return () => { alive = false }
  }, [incident.id, reportMeta.alarmText])

  // Header «Ausgerückt» is DERIVED (first physical departure) once any per-vehicle time
  // exists; the manual field stays authoritative only while there is no vehicle data.
  const derivedAus = deriveAusgerueckt(fahrzeuge)

  const rueckIso = rueckAt || undefined
  const form: ReportForm = {
    summary, kontaktperson, kontaktTel, einsatzleiter, endedAt, ausgerueckt, remarks, lehren,
    gruppen, fahrzeuge, geretteteP, geretteteT, rueckName, rueckAt,
  }
  /** The form AS IT STANDS ON SCREEN (reportForm · formToMeta), for everything that reads the
   *  rapport rather than writes it. It is not what gets SAVED: that is `dirtyMeta`. */
  const editedMeta = () => formToMeta(form)
  /**
   * What THIS device is entitled to write (reportForm · dirtyFormMeta): the fields its operator
   * actually changed and whose change has not landed in the blob yet. A field they are currently
   * TYPING in but have not changed (the caret holds off its adoption) is deliberately absent:
   * what leaves this device is the blob's value, not the stale text still on screen.
   */
  const dirtyMeta = (): Partial<ReportMeta> => ({
    ...dirtyFormMeta(form, remote, {
      summary: summaryDirty, kontaktperson: kontaktpersonDirty, kontaktTel: kontaktTelDirty,
      einsatzleiter: einsatzleiterDirty, endedAt: endedAtDirty, ausgerueckt: ausgeruecktDirty,
      remarks: remarksDirty, lehren: lehrenDirty, gruppen: gruppenDirty, fahrzeuge: fahrzeugeDirty,
      geretteteP: gerettetePDirty, geretteteT: geretteteTDirty, rueckName: rueckNameDirty, rueckAt: rueckAtDirty,
    }),
    ...(partnersDirty ? partnersMeta(partners) : {}),
  })

  // The freshest blob this surface has seen, for the writes that do NOT happen inside the event
  // that triggered them (see persist, stampReportMade). Updated in an effect rather than during
  // render — a ref written while rendering is the pattern the immutability lint objects to.
  const metaRef = useRef(reportMeta)
  useEffect(() => { metaRef.current = reportMeta })

  // Write the after-arrival fields back to the blob, preserving everything else (the dispatch
  // facts alarmText/alarmiertAt stay sourced from the incident — never persisted here). `over`
  // carries the just-changed field so we don't read stale state mid-event.
  // ⚠️ The base is `metaRef`, the freshest blob this surface has seen, not the `reportMeta` of
  // the render this closure was built in: `startOutput` persists the Kroki framing AFTER an
  // awaited confirm dialog, by which time a sync may have moved the blob on underneath it.
  const persist = (over: Partial<ReportMeta>) => canEdit && onSaveMeta({
    ...metaRef.current,
    ...dirtyMeta(),
    ...over,
  })

  // Commit the Kroki-seeded Einsatzleiter to the blob once, so the Abschluss-Checkliste and a
  // rapport printed from another device see the same name this field shows — a value that only
  // lives in local state would leave the checklist nagging about an Einsatzleiter that is on
  // screen. Fills a BLANK field only, never overwrites, and only while the sheet is mounted.
  const seededEinsatzleiter = useRef(false)
  useEffect(() => {
    if (seededEinsatzleiter.current || reportMeta.einsatzleiter?.trim() || !einsatzleiter.trim()) return
    seededEinsatzleiter.current = true
    persist({ einsatzleiter: einsatzleiter.trim() })
    // `persist` is re-created every render (it closes over the live field state); depending on it
    // would re-run this on every keystroke — the ref guard is what makes it once-only.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reportMeta.einsatzleiter, einsatzleiter])

  // …and put that Einsatzleiter on the ANWESENHEIT, once.
  //
  // ⚠️ The EL is the one person a rapport names on its front page — and until 10.08. that name
  // was only ever a string on `reportMeta` (or on the Kroki symbol it was seeded from). Nothing
  // guaranteed a matching Anwesenheits-Zeile, so an Einsatz could be led by somebody who
  // appeared on NO list: not on the Anwesenheit, not in the Trupp picker's «schon: Einsatzleiter»
  // hint, and not on the printed Personalblatt — which is also the Soldblatt. The interactive
  // pick already writes it (onRolePicked · lib/roleAssignment); this covers every other route a
  // name arrives by (seeded data, a sync from another device, the symbol).
  //
  // Only when the name RESOLVES to a roster row. A name that arrives this way was NOT typed
  // here — it comes from seeded data, another device's sync or the Kroki symbol — and minting a
  // Gast for one would put people on the Soldblatt that nobody recorded on this screen. Typing a
  // name into the picker itself is the deliberate act, and that path files a Gast (onAddGuest).
  /** person id → the job they already hold, off their Anwesenheits-Bemerkung — shown on every
   *  option of the two person pickers below (lib/roleAssignment writes these notes). Same shape
   *  the Atemschutz board's pickers use; a roster that reads differently depending on which
   *  screen it is opened from is a roster nobody trusts. */
  const rolesById = useMemo(
    () => new Map(
      Object.entries(attendance)
        .map(([id, a]) => [id, (a.note ?? '').trim()] as const)
        .filter(([, note]) => note.length > 0),
    ),
    [attendance],
  )
  const linkedEinsatzleiter = useRef(false)
  useEffect(() => {
    if (linkedEinsatzleiter.current || !onRolePicked) return
    const name = (reportMeta.einsatzleiter ?? einsatzleiter).trim()
    if (!name) return
    const p = personnel.find((x) => x.displayName.trim().toLowerCase() === name.toLowerCase())
    if (!p || attendance[p.id]) return
    linkedEinsatzleiter.current = true
    onRolePicked(p.id, 'el', appConfig.copy.anwesenheit.roleEinsatzleiter)
    // eslint-disable-next-line react-hooks/exhaustive-deps -- once per mount, guarded by the ref
  }, [reportMeta.einsatzleiter, einsatzleiter, personnel, attendance])

  const meta: ReportMeta = {
    ...reportMeta,
    ...editedMeta(),
    alarmText: reportMeta.alarmText ?? (alarmFallback || undefined),
    // Alarmierung = the incident's start (= when we were alarmed); editable in Einsatzdaten
    alarmiertAt: reportMeta.alarmiertAt ?? incident.started_at,
  }
  const alarm = parseAlarmText(meta.alarmText)
  const alarmiert = meta.alarmiertAt
  // Plausibility of the three clocks, as a HINT under the field that is wrong. Never a block:
  // printing must not depend on what somebody typed, and an Einsatz over midnight is normal.
  //
  // ⚠️ `Date.now()`, NOT the `nowRef` captured when this surface mounted. The Rapport is a
  // surface, not a dialog — it is opened early in an Einsatz and left open for hours — so a
  // mount-time «now» goes stale while it sits there, and «liegt in der Zukunft» then fired on
  // exactly the stamp that cannot possibly be in the future: the one «Jetzt» had just written.
  // Any Einsatz longer than the 5-minute slack showed it, which is most of them. (It failed the
  // other way too: a genuinely future time typed later was measured against the same stale
  // mark and stayed unflagged.)
  //
  // This is a read during render, not a ticking clock — nothing schedules a re-render, so the
  // battery footgun the frozen `nowRef` exists for is not reintroduced. The hint is re-evaluated
  // whenever anything on the form moves, which is precisely when it can change.
  // one render clock for the Zeiten checks and the day columns below (lib/zeitplanFormat · incidentDays)
  const renderNow = Date.now()
  const issues = zeitIssues(
    {
      alarmiertAt: alarmiert,
      ausgeruecktAt: derivedAus ?? dtLocalToIso(ausgerueckt),
      endedAt: dtLocalToIso(endedAt),
      rueckmeldungAt: rueckIso,
    },
    renderNow,
  )
  const issueFor = (kind: ZeitKind) => {
    const i = issues.find((x) => x.kind === kind)
    if (!i) return null
    const t = i.ref ? formatDateTime(i.ref) : ''
    if (i.code === 'future') return P.zeitFuture
    return fillTemplate(i.code === 'beforeAusgerueckt' ? P.zeitBeforeAusgerueckt : P.zeitBeforeAlarm, { t })
  }
  // a plain call, not a component: one declared in the render body is re-created every pass
  /** a recorded instant as the read-out says it («21.10.2026 23:14»), nothing when none */
  const whenOf = (iso?: string) => (iso ? formatDateTime(iso) : undefined)
  const zeitWarn = (kind: ZeitKind) => {
    // a hint to CORRECT a time – nothing for a session that cannot (it reads the times as they are)
    const text = canEdit && issueFor(kind)
    return text ? <span className="form-warn form-warn-amber form-warn-compact rz-warn"><Icon id="warn" />{text}</span> : null
  }
  const missTx = missingTranscriptCount(events)
  // No krokiView argument any more: the panel reports each settled crop into `options` while the
  // rapport is being filled in, so by the time a button is pressed the state IS the framing on
  // screen. It used to be threaded through the modal's onConfirm because that value and the
  // setState landed in the same tick.
  /** `over`: what this render's `meta` does not hold yet – the answers just given in the
   *  «Angaben fehlen noch» sheet (startOutput), written but not rendered */
  const buildDraft = (over: Partial<ReportMeta> = {}): ReportDraft => {
    const generatedAt = new Date().toISOString()
    return {
      meta: { ...meta, ...over }, generatedAt,
      proof: { ...proof, checkedAt: proof.checkedAt || generatedAt },
      // krokiAt travels with the draft so the printed caption dates the PICTURE, not the print
      // — and only when the reconstruction for it is what prints (useKrokiMoment · printedAt)
      options: { ...options, krokiAt: kroki.printedAt },
    }
  }
  // The ONE argument list both the PDF and the signature scope are built from — so «what is
  // signed» is «what prints», field for field.
  const pdfArgs = (draft: ReportDraft) => ({
    incident, draft, trupps, contactIntervalMin, contactGraceSec, attendance, events, plans, mittel, attachments, scene: effScene, board, building, checklists, checklistTemplates,
    // the printed journal marks the same terms the app marks (lib/journalLinks) — the Trupps
    // included, or the paper would mark every name in a row except the crew it is about
    vocab: journalVocabulary(personnel, attendance, undefined, trupps),
    roster: personnel.filter((p) => p.active).map((p) => ({ id: p.id, name: p.displayName })),
  })
  // the signed part's hash, recomputed a moment after the record settles — only on a closed
  // Einsatz, the one time there is anything to sign or to check
  const scopeKey = closed ? JSON.stringify([meta, attendance, mittel, events.length, personnel.length, incident.title, incident.address, incident.type]) : ''
  useEffect(() => {
    if (!closed) return
    let alive = true
    const t = setTimeout(() => {
      void sha256Hex(signedPartOf(pdfArgs(buildDraft()))).then((h) => { if (alive) setScopeHash(h) }, () => {})
    }, 250)
    return () => { alive = false; clearTimeout(t) }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- keyed on the record, not on every render's closures
  }, [closed, scopeKey])
  /** this session signs Rapporte at all (not a viewer, a link, an archived view) – on a running
   *  Einsatz it cannot sign YET, which `canSign` adds */
  const maySign = canEditIn && !!onSign
  const canSign = closed && maySign
  const kdtDefault = getDeploymentConfig().identity?.kommandant ?? ''
  // «Ort» of «Ort, Datum»: the station's town — without the postcode the setting may carry
  const signPlace = (getDeploymentConfig().map?.geocoder?.defaultLocality ?? '').replace(/^\d{4,5}\s+/, '').trim()
  const doSign = async ({ role, slot, strokes }: SignSubmit): Promise<boolean> => {
    if (!onSign) return false
    try {
      // the Einsatzleiter's line IS the Rapport's Einsatzleiter: a name picked in the sheet is
      // written back (with the role on the Anwesenheit), and the scope is hashed WITH it — never
      // while another signature already locks the Rapport, which that change would break
      let m = meta
      if (role === 'el' && canEdit && slot.name !== (meta.einsatzleiter ?? '')) {
        setEinsatzleiter(slot.name)
        persist({ einsatzleiter: slot.name })
        onRolePicked?.(slot.personId, 'el', appConfig.copy.anwesenheit.roleEinsatzleiter)
        m = { ...meta, einsatzleiter: slot.name }
      }
      const scope = await sha256Hex(signedPartOf(pdfArgs({ ...buildDraft(), meta: m })))
      onSign({
        id: newId('sig'), role, name: slot.name, ...(slot.personId ? { personId: slot.personId } : {}),
        ...(signPlace ? { place: signPlace } : {}), at: serverNowIso(), scope, strokes,
      })
      setScopeHash(scope)
      return true
    } catch {
      toast(appConfig.copy.signature.failed, { icon: 'warn', tone: 'warn' })
      return false
    }
  }
  const [pdfBusy, setPdfBusy] = useState(false)
  /** A rapport has just been produced (PDF in hand, or a print job on its way to the station
   *  printer). The blob remembers WHEN, so the Rapport can tell whoever opens it next that the
   *  paper already exists — on this device or on any other.
   *  ⚠️ NOT through `persist`: this write lands SECONDS after the press that started it (a
   *  server-rendered PDF takes a moment), and `persist` merges the form state of the render it
   *  was created in — a Kurzbericht typed while the PDF was rendering would be overwritten with
   *  the text it had when the button was hit. `metaRef` is the freshest blob instead, and every
   *  field on this surface already persists itself on change, so there is nothing else to carry
   *  — except `also`, the framing written by the same click (see startOutput). */
  const stampReportMade = (also: Partial<ReportMeta>) =>
    canEdit && onSaveMeta({ ...metaRef.current, ...also, reportMadeAt: new Date().toISOString() })
  /** A job has been handed to the station relay and is not printed yet. Recorded on the blob,
   *  not just in the toast: «in der Warteschlange» is a STATE and a toast is an event, and the
   *  poll behind the toast gives up after 90 s. Whoever opens the Rapport next — after a reload,
   *  on another device — has to see that a print is still outstanding. */
  const holdPrintJob = (id: string, also: Partial<ReportMeta>) =>
    canEdit && onSaveMeta({ ...metaRef.current, ...also, printJob: { id, at: new Date().toISOString() } })
  /** Jobs already settled on THIS surface — the double-settle guard. The toast's `onSettled`
   *  and this surface's own 15 s poll can both answer for the same job within one render, and
   *  `metaRef` only catches up on the NEXT render — so without this, the second settler saw the
   *  job still on the blob and wrote again, re-stamping `reportMadeAt` seconds later. A plain
   *  synchronous Set: the first settle claims the id before any side effect, the second no-ops. */
  const settledJobsRef = useRef(new Set<string>())
  /** The job left the queue. `done` is the ONLY status that earns the «Rapport erstellt» stamp —
   *  a failed or a cancelled job simply stops being outstanding, and `gone` (the relay no longer
   *  knows the job — swept after 7 days) clears WITHOUT stamping: the outcome is unknown, and a
   *  stamp would claim paper that may never have existed.
   *  ⚠️ ONE write for both halves: `metaRef` only catches up on the next render, so stamping and
   *  then clearing would merge the clear onto the blob as it was BEFORE the stamp.
   *  ⚠️ Settles the NAMED job only: a settle that arrives late (the toast poll of a previous
   *  job) must not clear a newer job that has since been queued. */
  const settlePrintJob = (jobId: string, status: PrintJobStatus | 'gone') => {
    if (!canEdit || metaRef.current.printJob?.id !== jobId || settledJobsRef.current.has(jobId)) return
    settledJobsRef.current.add(jobId)
    onSaveMeta({
      ...metaRef.current,
      ...(status === 'done' ? { reportMadeAt: new Date().toISOString() } : {}),
      printJob: undefined,
    })
  }
  /** The one step left after the paper exists, offered beside the fact rather than demanded:
   *  the Einsatz is still open, and nobody archives one unless they know they have to.
   *  ⚠️ `undefined` while ANY Mindestangabe is missing — printing a half-filled sheet to finish
   *  by hand, or a Zwischenausdruck taken mid-Einsatz, must never suggest closing the Einsatz.
   *  Same condition the Band under the head uses, so the two can't disagree. */
  const completeOffer = (): ToastAction | undefined =>
    onComplete && !missing.length ? { label: A.complete, onClick: () => void complete() } : undefined
  // ONE button (decided 2026-07-18): the server composes the complete rapport — map
  // render included (app/kroki.py) — from pure data. No Druckansicht detour anymore.
  // `also`: the Kroki framing and the sheet's answers of the same click (startOutput) – on the
  // paper, and on the stamp that follows it
  const downloadPdf = async (also: Partial<ReportMeta> = {}) => {
    const draft = buildDraft(also)
    setPdfBusy(true)
    try {
      await downloadDirectReportPdf({ ...pdfArgs(draft), signatures: printedSignatures(liveSigs, sigValid, closed) })
      // The PDF is the proof; the next step («Einsatz abschliessen») is said by the Abschluss band
      // under the head, which `reportMadeAt` turns on. No toast beside it (owner #31, 30.10.2026):
      // the same words twice, one of them over the head. A fresh PDF brings a band put away with
      // «Später» back – this is the moment it exists for.
      stampReportMade(also)
      showBand()
    } catch {
      toast(appConfig.copy.report.pdfFailed, { icon: 'warn', tone: 'warn' })
    } finally {
      setPdfBusy(false)
    }
  }
  // Station print relay: hidden unless the deployment runs one (fail-closed backend);
  // the dot mirrors the agent heartbeat, undo cancels while the job is still queued.
  const [printStatus, setPrintStatus] = useState<PrintRelayStatus | null>(null)
  const [printBusy, setPrintBusy] = useState(false)
  useEffect(() => {
    let alive = true
    void fetchPrintStatus(editorPrintTransport()).then((s) => { if (alive) setPrintStatus(s) })
    return () => { alive = false }
  }, [])
  // Opening this surface is a strong «about to print» signal: once we know the relay is
  // available and the report carries a Kroki, warm the server's map-tile cache so the real
  // enqueue render is near-instant. Fire once, best-effort — reframes reuse overlapping tiles.
  const warmedRef = useRef(false)
  // an effect event: it reads this render's record, but only the three facts below re-fire it
  const warmTiles = useEffectEvent(() => {
    if (warmedRef.current || !printStatus?.available || !options.kroki || mapContentCount === 0 || !scene) return
    warmedRef.current = true
    // Best-effort and never surfaced: a payload that will not build costs the warm-up, never
    // the surface. Only the Kroki matters to the warm-up, so the plain build is enough here.
    try {
      void prewarmPrint(editorPrintTransport(), incident.id, buildDirectReportPayload(pdfArgs(buildDraft())))
    } catch { /* the real print builds again and reports its own failure */ }
  })
  useEffect(() => { warmTiles() }, [printStatus?.available, options.kroki, mapContentCount])
  const R = appConfig.copy.printRelay
  const sendToPrinter = async (also: Partial<ReportMeta> = {}) => {
    // ALWAYS confirm — «Ausdrucken» must never produce accidental paper; when the relay is
    // offline the modal doubles as the store-and-forward warning. That one is now the TITLE and
    // nothing else: «Stationsdrucker offline» is the whole statement, and the paragraph under it
    // explaining that the job would be printed later was the sentence that made queuing sound
    // like printing.
    const ok = printStatus?.online
      ? await confirmDialog({ title: R.confirmTitle, message: R.confirmMsg, confirmLabel: R.confirmBtn })
      : await confirmDialog({ title: R.offlineConfirmTitle, message: '', confirmLabel: R.offlineConfirmBtn })
    if (!ok) return
    setPrintBusy(true)
    try {
      const t = editorPrintTransport()
      // the SAME arguments the PDF download sends, signatures included — paper and PDF are one document
      const payload = await readyDirectReportPayload({ ...pdfArgs(buildDraft(also)), signatures: printedSignatures(liveSigs, sigValid, closed) })
      const jobId = await enqueuePrint(t, incident.id, payload)
      // ⚠️ NOT `stampReportMade`. EINGEREIHT IST NICHT GEDRUCKT: the stamp is the sole condition
      // for the band «Rapport erstellt. Der Einsatz ist noch offen – abschliessen?», and until
      // 22.08. it was set the instant the job left this device — including straight after the
      // dialog that had just said the printer was offline. So the app offered to close an Einsatz
      // whose rapport existed on no sheet of paper anywhere. What is recorded here is the OPEN
      // JOB; the stamp waits for the relay to say `done` (settlePrintJob).
      holdPrintJob(jobId, also)
      // …and the Abschluss offer rides the END of the job's own status chain, not a second toast
      // beside it: the Einsatz is worth closing once the paper is out of the printer.
      trackPrintJob(t, jobId, completeOffer(), {
        relayOffline: !printStatus?.online,
        onSettled: (status) => settlePrintJob(jobId, status),
      })
    } catch {
      toast(R.failed, { icon: 'warn', tone: 'warn' })
    } finally {
      setPrintBusy(false)
    }
  }

  // --- The print job that has NOT come out yet ------------------------------------------------
  //
  // `pollJobUntilDone` gives up after 90 s and its toast is gone from the screen long before
  // that, and nothing ever read the job again — so a Rapport could sit for an hour claiming to
  // have been printed while the relay had never come back. An unresolved job is a STATE: it
  // lives on the blob, it shows under the head, and it is re-read for as long as this surface is
  // open, across a reload and a change of device.
  const pendingJob = reportMeta.printJob
  const [jobBusy, setJobBusy] = useState(false)
  // «Seit X min» must move. Computed from a bare Date.now() at render it froze at whatever
  // minute the band appeared in (and read the clock during render, which the purity lint
  // rightly flags) — a minute tick while a job is outstanding keeps the line honest. The
  // interval only exists while the band does; an Einsatz without an open job pays nothing.
  // No synchronous re-read when a job appears (the lint objects to setState in an effect
  // body, and it is not needed): a just-queued job's negative span is clamped to «Seit 0 min»
  // where the band renders it, which is the right sentence until the first tick.
  const [jobNowMs, setJobNowMs] = useState(() => Date.now())
  useEffect(() => {
    if (!pendingJob) return
    const iv = setInterval(() => setJobNowMs(Date.now()), 60_000)
    return () => clearInterval(iv)
  }, [pendingJob])
  // keyed on the JOB, not on the writer: `settlePrintJob` is re-created every render, so the
  // answer is handled in an effect event that always sees the current one
  const onJobRead = useEffectEvent((jobId: string, s: Awaited<ReturnType<typeof fetchJobStatus>>) => {
    // 'gone' = the relay no longer knows the job (swept after 7 days — the relay-was-down-a-
    // week case). Waiting longer can never resolve it, so stop showing it as open and say so
    // honestly: the outcome is unknown, no «Rapport erstellt» stamp.
    if (s === 'gone') { settlePrintJob(jobId, 'gone'); toast(R.jobGone, { icon: 'warn', tone: 'warn' }); return }
    // null = the relay is unreachable right now, which says nothing about the job — keep it.
    if (!s || s.status === 'queued' || s.status === 'printing') return
    settlePrintJob(jobId, s.status)
  })
  const pendingJobId = pendingJob?.id
  useEffect(() => {
    if (!pendingJobId || !canEdit) return
    let alive = true
    const t = editorPrintTransport()
    const read = async () => {
      const s = await fetchJobStatus(t, pendingJobId)
      if (alive) onJobRead(pendingJobId, s)
    }
    void read()
    const iv = setInterval(() => void read(), 15_000)
    return () => { alive = false; clearInterval(iv) }
  }, [pendingJobId, canEdit])
  /** «Prüfen»: ask the relay once, now, and say what came back — including «nothing», which is
   *  its own answer and used to be indistinguishable from «still queued». */
  const checkPrintJob = async () => {
    const job = metaRef.current.printJob
    if (!job) return
    setJobBusy(true)
    const s = await fetchJobStatus(editorPrintTransport(), job.id)
    setJobBusy(false)
    // «nicht mehr auffindbar» and «nicht erreichbar» are different answers: the first is about
    // the JOB (it stopped existing — clear it, outcome unknown), the second about the network.
    if (s === 'gone') { settlePrintJob(job.id, 'gone'); toast(R.jobGone, { icon: 'warn', tone: 'warn' }); return }
    if (!s) { toast(R.jobUnreachable, { icon: 'warn', tone: 'warn' }); return }
    if (s.status === 'done') { settlePrintJob(job.id, 'done'); toast(R.printed, { icon: 'check', tone: 'success' }); return }
    if (s.status === 'failed') { settlePrintJob(job.id, 'failed'); toast(R.printFailed, { icon: 'warn', tone: 'warn' }); return }
    if (s.status === 'cancelled') { settlePrintJob(job.id, 'cancelled'); toast(R.cancelled); return }
    toast(s.status === 'printing' ? R.printing : R.queued, { icon: 'printer', tone: 'warn' })
  }
  /** Give up on a job that is still in the queue. Refused once the agent has claimed it — the
   *  paper may already be moving, and the button says so rather than pretending. */
  const dropPrintJob = async () => {
    const job = metaRef.current.printJob
    if (!job) return
    setJobBusy(true)
    const res = await cancelPrint(editorPrintTransport(), job.id)
    setJobBusy(false)
    if (res === 'cancelled') { settlePrintJob(job.id, 'cancelled'); toast(R.cancelled); return }
    // The three refusals mean three different things (see printRelay · CancelOutcome):
    // «zu spät» only when the relay actually SAID the job is past cancelling — a network
    // failure used to wear the same words, claiming knowledge nobody had.
    if (res === 'gone') { settlePrintJob(job.id, 'gone'); toast(R.jobGone, { icon: 'warn', tone: 'warn' }); return }
    if (res === 'unreachable') { toast(R.jobUnreachable, { icon: 'warn', tone: 'warn' }); return }
    toast(R.undoTooLate, { icon: 'warn', tone: 'warn' })
  }

  /** The ONE way an option changes — it also records the deviation, which is what outlives the
   *  hop to Anwesenheit/Mittel (see rapportKept). Set an option any other way and it is back to
   *  its seed the moment the operator steps off this surface. */
  const patchOpt = (patch: Partial<ReportOptions>) => {
    optionOverrides.current = { ...optionOverrides.current, ...patch }
    setOptions((o) => ({ ...o, ...patch }))
  }
  // is there anything on the SERVER to archive? Journal photos/recordings and Rapport-Beilagen
  // are all Media rows; blob: URLs are uploads still in flight and not fetchable as a ZIP yet
  const hasStoredMedia = useMemo(() => (
    attachments.some((a) => a.url.startsWith('/'))
    || events.some((e) => (e.audioUrl ?? '').startsWith('/') || rowPhotos(e).some((u) => u.startsWith('/')))
  ), [attachments, events])
  const startOutput = async (action: 'pdf' | 'print' = 'pdf') => {
    // ⚠️ A rapport that is still missing Mindestangaben may ALWAYS be produced — printing is
    // never blocked by what somebody has not typed yet, and a half-filled sheet taken to the
    // Magazin to be finished by hand is a real way of working. But a PDF that leaves the
    // building is the version that gets filed, so the gap is said out loud once, by name,
    // before it goes. Same words the Abschluss confirm uses; the only difference is that this
    // one is a warning and that one is a decision.
    /** what the sheet's own buttons answered — written at once, AND onto this print: the draft is
     *  built from this render's `meta`, which the write reaches only a render later */
    let answered: Partial<ReportMeta> = {}
    if (missing.length) {
      /* The rows are the Abschluss confirm's (31.10.2026, lib/abschlussOpen · abschlussSheet):
         the same order, the same buttons («Jetzt setzen», «Nichts verwendet», «Entfällt»,
         «Wählen», «Schreiben»), the same re-read after an answer. Each row still goes to its
         field – the same jump the «noch offen» chip makes – and tapping one resolves the ask
         false: nothing prints while the operator is off filling it in.
         ⚠️ Mindestangaben ONLY. The Abschluss's other two rows are about CLOSING: a Trupp still
         out is asked because the close freezes the Tafel over it (a print mid-Einsatz is a
         Zwischenausdruck, the crew is the Tafel's business), the pending uploads because the
         operator is about to walk away (here the Kontrolle chip says them). Nor is the Einsatzende
         pre-filled with «jetzt» – the close writes that one; printing sets no end, so here it is
         an open row like the others, with the step's own «Jetzt setzen». */
      const sheet = abschlussSheet(missing.map((step) => ({ kind: 'step' as const, step })), { step: guideTo }, {
        write: canEdit ? (over) => { answered = { ...answered, ...over }; persist(over) } : undefined,
        now: serverNowIso,
      })
      const spec = () => {
        const { items, anyOpen } = sheet()
        // answered to the last one in the sheet: no longer «fehlen noch», and no «trotzdem» note
        return {
          title: anyOpen ? P.exportIncompleteTitle : P.exportCompleteTitle,
          message: anyOpen ? P.exportIncompleteLead : '',
          items,
          note: anyOpen ? P.exportIncompleteMsg : undefined,
        }
      }
      const ok = await confirmDialog({
        ...spec(),
        refresh: spec,
        confirmLabel: action === 'print' ? R.send : P.pdfFull,
        cancelLabel: appConfig.copy.cancel,
      })
      if (!ok) return
    }
    // No framing step in front of the action any more — the crop has been on screen the whole
    // time. What is left of the old onConfirm is the REMEMBERING: the framing rides the workspace
    // blob so the second print comes out of the same window as the first, from any device. Written
    // here rather than on every pan, because «the last print's framing» is what it claims to be —
    // and a persist per map frame would be a workspace write per frame. Cleared for a read-only
    // surface by `persist` itself.
    const framing: Partial<ReportMeta> = krokiPanel && options.krokiView
      ? {
        krokiPrint: {
          view: options.krokiView,
          at: kroki.printedAt ?? undefined,
          landscape: options.krokiLandscape,
        },
      }
      : {}
    if (framing.krokiPrint) persist(framing)
    // …and it rides along to the stamp that follows a successful export: that write lands after
    // this one, merges onto its own snapshot of the blob, and would otherwise drop the framing
    // that was just saved. The sheet's answers ride with it, onto the paper as well.
    if (action === 'pdf') void downloadPdf({ ...answered, ...framing })
    else void sendToPrinter({ ...answered, ...framing })
  }
  const P = appConfig.copy.preflight
  const A = appConfig.copy.abschluss
  // the Verlauf's own namespace — the divergence rows are written there, so the card that
  // settles them speaks in the same words the row does
  const C = appConfig.copy.journal

  // «Formulare & Links» — the station's OWN paperwork (config `report.links`, see
  // lib/reportLinks). No config, no section: a Wehr that has no such forms never sees an empty
  // card explaining a feature it does not use.
  const stationLinks = reportLinks()
  const linksDone = meta.linksDone ?? {}
  const linksDoneCount = stationLinks.filter((l) => linksDone[l.id]).length
  /** ⚠️ Through `metaRef`, not `persist` — the tick is offered again when the operator returns
   *  from the form, which is a moment later than the render the offer was built in. `persist`
   *  would merge THAT render's form state and undo whatever was typed since (same reason as
   *  stampReportMade). Every field on this surface persists itself already. */
  const setLinkDone = (id: string, done: boolean) => {
    if (!canEdit) return
    const next = { ...(metaRef.current.linksDone ?? {}) }
    if (done) next[id] = new Date().toISOString()
    else delete next[id]
    onSaveMeta({ ...metaRef.current, linksDone: Object.keys(next).length ? next : undefined })
  }
  /** The link whose form was opened and not yet ticked off — the offer waits here until the
   *  operator comes back (see the effect below). */
  const returnOffer = useRef<ReportLink | null>(null)
  const openLink = (link: ReportLink) => {
    // Resolved at the moment of the press, not at render: the Kurzbericht and the Einsatzende
    // are typed while the Rapport is open, and the form should carry what stands there NOW.
    const url = resolveLinkUrl(link.url, linkTokenValues({
      stichwort: incident.title,
      ort: incident.address,
      alarmiertAt: meta.alarmiertAt,
      endedAt: meta.endedAt,
      einsatzleiter: meta.einsatzleiter,
      kontaktperson: meta.kontaktperson,
      kurzbericht: meta.summary,
      wehr: deploymentName(),
    }))
    // ⚠️ A blocked popup returns null, and saying «geöffnet» then offering to tick it off would
    // let the checklist record a form that never came up. Say what actually happened instead.
    if (!window.open(url, '_blank', 'noopener,noreferrer')) {
      toast(fillTemplate(P.linksOpenFailed, { title: link.title }), { icon: 'warn', tone: 'warn' })
      return
    }
    // The app cannot see whether the form was submitted, so it asks — but only once the
    // operator is BACK. A toast raised now would sit on a tab that just lost focus and expire
    // (6 s) long before anyone finished filling anything in.
    // Skipped where the row is already ticked, and where this session may not write anyway.
    if (!canEdit || linksDone[link.id]) return
    returnOffer.current = link
  }
  // …and here is the coming back. Scoped to the mounted Rapport on purpose: leave the surface
  // and the offer dies with it, which also keeps `metaRef` (read by `setLinkDone`) fresh for as
  // long as the offer can be taken.
  useEffect(() => {
    const onVisible = () => {
      const link = returnOffer.current
      if (document.visibilityState !== 'visible' || !link) return
      returnOffer.current = null
      toast(fillTemplate(P.linksOpened, { title: link.title }), {
        icon: 'external',
        action: { label: P.linksOpenedAction, onClick: () => setLinkDone(link.id, true) },
      })
    }
    document.addEventListener('visibilitychange', onVisible)
    return () => document.removeEventListener('visibilitychange', onVisible)
    // `setLinkDone` reads the live blob off `metaRef`, so a listener bound once is not stale.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Derived closing checklist (lib/abschluss): the sheet is the ONE closing surface — the
  // status is recomputed from the data on every render, never stored as visited-state.
  // What the fold has to say without being opened: the sections that will actually print.
  // Personal and Material are always in it and that is deliberate — the Rapport is a pre-filled
  // FORM (field feedback 2026-07-17), so an incident with no records still wants the tick-off
  // roster and the amount stubs on paper. Everything else follows its content.

  /* Anwesenheits-Abweichungen the record still owes an answer for — derived from the Verlauf
     itself (append-only: settling one APPENDS a row, it never rewrites the one that warned).
     Rows raised before 04.09. carry no structured payload and are deliberately not returned;
     an item nobody can close would leave the step open for ever on every past Einsatz. */
  const conflicts = useMemo(() => openConflicts(events), [events])
  // ONE builder with the workspace's doors (the badge, the chooser, the Abschluss) — lib/abschluss
  const facts: AbschlussFacts = abschlussFacts(meta, attendanceCount, mittelCount, conflicts.length)
  const rows = hoursRows(attendance, { alarmedAt: alarmiert ?? null, endedAt: meta.endedAt ?? null })
  // People whose presence blocks cannot be turned into a duration — almost always a still-open
  // block borrowing an Einsatzende that lies BEFORE it. They fall out of BOTH Einsatzstunden
  // totals. It used to print on the paper as «N Person(en) ohne verwertbare Zeiten», a count of
  // an abstraction that named neither who nor why and that nobody could act on from a sheet.
  // It belongs here instead: beside the button that makes the paper, while it can still be fixed.
  // ⚠️ Filtered, not raw: while the Einsatz is RUNNING everybody still on scene totals to
  // nothing, and naming all of them under «Zeiten laufen rückwärts oder fehlen» is a warning
  // about the ordinary state of every open Einsatz (lib/attendanceHours · unresolvedHoursRows).
  const unresolvedNames = unresolvedHoursRows(rows, { endedAt: meta.endedAt ?? null }).map((r) => r.name)

  // «bereit» is a claim, so it is made only when nothing is outstanding — a fold that says all
  // is well while hiding a broken hash chain would be worse than no summary at all.
  const controlOk = !checking && proof.intact !== false && missTx === 0 && pendingMediaCount === 0
    && unresolvedNames.length === 0
  /** how many things are actually wrong — the chip counts them rather than saying «Kontrolle» */
  const warnCount = (missTx > 0 ? 1 : 0) + (pendingMediaCount > 0 ? 1 : 0) + (proof.intact === false ? 1 : 0)
    + (unresolvedNames.length > 0 ? 1 : 0)
  const [controlOpen, setControlOpen] = useState(false)
  const isPhone = useIsPhone()
  useEffect(() => {
    if (!controlOpen || !isPhone) return
    let frame = 0
    const measure = () => {
      const popup = document.querySelector<HTMLElement>('.rp-control')
      const entry = document.querySelector('.fab-entry')
      if (!popup || !entry) return
      popup.style.setProperty('--rp-control-room', `${Math.max(44, entry.getBoundingClientRect().top - popup.getBoundingClientRect().top - 8)}px`)
    }
    frame = requestAnimationFrame(measure)
    window.addEventListener('resize', measure)
    window.visualViewport?.addEventListener('resize', measure)
    return () => {
      cancelAnimationFrame(frame)
      window.removeEventListener('resize', measure)
      window.visualViewport?.removeEventListener('resize', measure)
    }
  }, [controlOpen, isPhone])


  const bodyRef = useRef<HTMLDivElement>(null)
  const { phoneTab, pickTab, jumpToStep, forgetPlace } = useReportPlace(incident.id, bodyRef, kept, () => ({
    optionOverrides: optionOverrides.current, krokiAt: kroki.at,
  }))

  // The head's one line, in the voice the other surfaces use («12 anwesend · 3 gegangen · 28
  // Mannschaft»): what is recorded, then the verdict. «Alle Angaben erfasst» is a claim, so it is
  // made only when the same Mindestangaben the Abschluss-Confirm checks are all in — and when
  // they are not, the line NAMES the missing ones instead of saying that something, somewhere, is
  // still open. It deliberately says nothing about the Prüfnachweis or the pending uploads: those
  // are warnings, they live beside the buttons they must be read before, and a header that also
  // mentioned them would be the second place to look for the same thing.
  const missing = missingSteps(facts)
  /* What is still open rides inside the ONE Kontrolle chip, at every width (23.09.2026, option B
   * of the UX review). It was a strip of 18px chips under the title on a wide head — the smallest
   * targets in the product, 5–7px apart — and this same popover only below 860px. Raising the
   * chips to var(--tap) was tried and reverted (four 44px pills take over the head, and once the
   * strip wraps the pads of two rows overlap); one control can be 44px, four in a strip cannot.
   * So the narrow form became the only form: «⚠ 4 noch offen» opens the list of doors. */
  const openInControl = missing.length > 0

  // «Einsatz abschliessen» is bookkeeping, not the artefact: it stamps report_done_at and
  // archives. The PDF is its own (primary) action — decoupled by decision 2026-07-08 after
  // auto-download-on-complete felt wrong in the field.
  // ⚠️ The CONFIRM does not live here any more. Both doors into the Abschluss — this one and the
  // row in the Einsatz-Menü — run the one in IncidentWorkspace (`confirmAndComplete`), which
  // names the same open points and stamps the same `report_done_at`. The menu row used to archive
  // plainly, so an Einsatz put away there stood in the Historie as «offen» for ever.
  // What stays here is what only this surface knows: a completed rapport should re-open at the
  // top and from its seeds, so the whole kept box — scroll position, tab, print sections, Kroki
  // Stand — is forgotten. But only if the Abschluss actually happened.
  const complete = async () => {
    if (await onComplete?.()) forgetPlace()
  }

  // The Abschluss-Band under the head (see the JSX): shown once a rapport has been produced and
  // nothing is left open — the two facts that together mean «only the bookkeeping is missing».
  // Both come off `meta`/`missing`, i.e. the LIVE form state: an Einsatzende typed a second ago
  // makes the band appear without a round trip, exactly as it clears the head's «noch offen».
  // Seeded once per mount, which is once per Einsatz — the workspace is keyed by incident id.
  const [bandHidden, setBandHidden] = useState(() => bandDismissed.current.has(incident.id))
  const hideBand = () => {
    bandDismissed.current.add(incident.id)
    setBandHidden(true)
  }
  const showBand = () => {
    bandDismissed.current.delete(incident.id)
    setBandHidden(false)
  }
  const showCloseBand = !!onComplete && !!meta.reportMadeAt && missing.length === 0 && !bandHidden
  // …and ONE step earlier (owner pick 15B, 28.10.2026): everything recorded, no PDF yet – the band
  // names the next step, «Einsatzrapport (PDF) erstellen». No «Später» on it (15x): it goes away by
  // itself once the PDF exists, and turns into the Abschluss band above.
  const showReadyBand = !!onComplete && canEditIn && !closedHint && !meta.reportMadeAt && missing.length === 0

  // The guide strip (owner pick 14 «top strip», 28.10.2026). A jump from the «n offen» list (or
  // from the «Angaben fehlen noch» confirm) remembers WHERE it went; the strip under the head then
  // names the next open point down the page (lib/abschluss · nextOpenStep) and a tap on it is the
  // same jump. At the last open point there is nothing after it, and the strip is gone; with
  // nothing open the Abschluss band above takes over – the strip never becomes the PDF button.
  // ✕ forgets the place until the next jump from the list. Not for a session that cannot edit
  // (the list it walks is not drawn for one either).
  const [guideAt, setGuideAt] = useState<AbschlussStep | null>(null)
  const guideTo = (step: AbschlussStep) => { setGuideAt(step); jumpToStep(step) }
  const guideNext = canEditIn && guideAt ? nextOpenStep(missing, guideAt) : null

  // ONE ROW (lib/pageHeadFit): the head folds its tiles' words — «Ausdrucken», «Abschliessen»,
  // then «Einsatzrapport (PDF)» → «PDF» — until it fits; the Kontrolle chip's count is never cut
  // (`data-fit-check`). It was a breakpoint (words above 1080px, icons below) and, on a phone, a
  // second row under the title.
  const headRef = useRef<HTMLElement>(null)
  usePageHeadFit(headRef, [
    missing.length, warnCount, checking, controlOk, !!onComplete, printStatus?.available, printStatus?.online,
    printBusy, pdfBusy,
  ].join('|'))

  // What the signing sheet shows beside the pad (ReportSignatures): which Einsatz, from when to
  // when, how many people and positions — and «Ort, Datum» as the line will print it.
  const signAlarm = meta.alarmiertAt ?? incident.started_at ?? undefined
  const signEnd = meta.endedAt ?? closedAt ?? undefined
  const signSheet = {
    summary: {
      einsatz: [incident.title, signAlarm ? formatDateTime(signAlarm).split(' ')[0] : ''].filter(Boolean).join(' · '),
      zeiten: signAlarm && signEnd ? fillTemplate(appConfig.copy.signature.zeiten, { from: hhmm(new Date(signAlarm)), to: hhmm(new Date(signEnd)) }) : undefined,
      personen: attendanceCount,
      positionen: mittelCount,
    },
    placeDate: [signPlace, formatDateTime(serverNowIso()).split(' ')[0]].filter(Boolean).join(', '),
    onViewPdf: () => void downloadPdf(),
    onSign: doSign,
    personnel, presentIds, rolesById,
    onAddGuest: onAddGuest && ((name: string) => onAddGuest(name, 'el', appConfig.copy.anwesenheit.roleEinsatzleiter)),
  }

  return (
    /* A SURFACE, not a dialog. The Rapport is filled in across a whole Einsatz — a sentence
       here, a time there, jump to Anwesenheit because somebody arrived — and it wants the width
       its Zeiten grid and its two-up roster ask for. It is also the last screen here with no
       dialog left over it at all: the Kroki framing used to open on top of this, which put the
       operator two windows deep on the one screen that has to stay legible at 3am, and it is a
       panel in the page now. The head carries NO close button: a page is left by choosing
       another surface in the rail, and a ✕ on one of six surfaces asks «closed into what?». */
    <>
      {/* Opaque backdrop, exactly as Mittel and Atemschutz do it: the Lage showing through the
          gap around an inset card makes a form look like something floating over the map, and
          this surface is where somebody sits and writes. */}
      <div className="rp-backdrop" aria-hidden />
      <div className={cx('report-preflight report-preflight-surface', surface.shell)}>
        {/* The same head every other surface wears (Anwesenheit, Mittel): a title, and under it
            one line of what is actually recorded. It carried a bare title and an ✕ — dialog
            chrome, which is what a page inherits when it used to be a sheet. No ✕ either: a
            page is left by choosing another surface in the rail, exactly like Anwesenheit and
            Mittel, and a close button on one of six surfaces asks «closed into what?». */}
        <header ref={headRef} className="rp-head">
          <div className="rp-head-titles">
            {/* the nav's own word for this page once the row runs out of everything else */}
            <h2 data-fold={RP_FOLD.title} title={P.title} aria-label={P.title}>
              <span className="fold-long">{P.title}</span><span className="fold-short" aria-hidden="true">{appConfig.copy.modes.rapport}</span>
            </h2>
            {/* The verdict line under the title says only the GOOD news now: «alle Angaben
                erfasst». What is still open is counted and listed by the Kontrolle chip in the
                actions row (see `openInControl`), at every width — the chips that stood here are
                gone (23.09.2026). The «n Personen · m Positionen» read-out that led this line went
                on 19.09.2026. ⚠️ Not rendered EMPTY: an empty <p> still takes its margin. */}
            {missing.length === 0 && (
              <p className="rp-head-sum" data-fit-check>
                <span className="rp-head-done"><Icon id="check" />{P.headAllRecorded}</span>
              </p>
            )}
          </div>
          {/* The controls sit HERE, with the other surfaces' controls, and the readiness state
              rides with them — that pairing is not decoration. A warning about the record (a
              broken hash chain, an audio entry with no transcript, a photo still queued) has to
              be read before the paper exists, so it has to be in the same glance as the button
              that makes the paper. Putting the buttons up here and leaving the warnings at the
              bottom of a scrolling form would be exactly the failure the never-behind-a-fold rule
              prevents; they move together or not at all. */}
          <div className="rp-head-actions">
            {/* ⚠️ ONE amber chip (20.09.2026 on a narrow head, 23.09.2026 on every width). «n offen»
                used to be a Menu of its own beside the Kontrolle chip – two warning triangles side
                by side, each truncated to «⚠ 1…», and nothing to say which was which. What is still
                open is the first block of the Kontrolle popover, and the chip names both counts in
                their own words («4 noch offen · 1 Hinweis», lib/abschlussOpen · controlChipLabel). */}
            {/* The chip appears ONLY when something is wrong. A green «Alles bereit» spent a
                control on the most contested row of the surface to announce that nothing had
                happened — and the line under the title already says whether the Angaben are
                complete, so it was also the second place to look for the same answer. Worse, a
                badge that is present and green on every ordinary Einsatz teaches the eye to skip
                exactly the spot the warning will appear in.
                Nothing actionable is lost: every state that needs a person is a warning, and a
                warning still lands here, amber, counted, in the same glance as the button that
                makes the paper. The Prüfnachweis read-out goes with it while it is intact —
                the signed paper is the record (app/report · decision E), and «intact» is not
                news. A BROKEN chain is, and that raises the chip.
                Not rendered while checking either: a spinner that resolves to nothing a moment
                later is a flicker on the row, and the check is the app's business, not the
                operator's. */}
            {/* The Kontrolle detail is a POPOVER on the chip that opens it, not a band across the
                page: it is a handful of lines about the record, and a full-width slab pushed the form
                down every time anything was amiss. Anchored to the chip, so «what is wrong» and «the
                thing that told me» are the same object. A warning still reaches the operator without
                it — the chip itself is amber and counts them.
                Through overlays · Popover, like the print menu beside it — NOT hand-rolled absolute
                positioning. The hand-rolled version anchored to the chip's own edge, and on a phone
                the wrapped action row pushes that chip far enough right that a 358px panel opening
                leftwards from it started at roughly x=−130: the names in the Einsatzstunden warning
                were cut off the left of the screen, hard-clipped by the surface's `overflow: hidden`.
                Portalled + collision-aware, the panel is clamped to the viewport instead of to the
                chip, so no breakpoint has to guess which way it should open.
                ⚠️ Not for a session that cannot edit the Rapport (`canEditIn`, RBAC audit
                22.10.2026): «4 noch offen» is the editor's to-do list, and on the Fahrer tablet it
                was an amber alarm about work the driver can do nothing about. */}
            {canEditIn && ((!checking && !controlOk) || openInControl) && (
              <Popover
                open={controlOpen}
                onOpenChange={setControlOpen}
                popupClassName="rp-control"
                ariaLabel={P.controlHead}
                trigger={(
                  <button type="button" className={cx('rp-state', 'head-tile', 'amber')} data-fold={RP_FOLD.chip}
                    title={`${P.controlHead}: ${controlChipLabel(missing.length, checking ? 0 : warnCount)}`}>
                    <Icon id="warn" />
                    <span className="rp-state-label fold-long" data-fit-check>{controlChipLabel(missing.length, checking ? 0 : warnCount)}</span>
                    {/* folded: the ⚠ and ONE count — what is open plus the Hinweise, as the nav badge */}
                    <span className="rp-state-label fold-short" aria-hidden="true">{missing.length + (checking ? 0 : warnCount)}</span>
                  </button>
                )}
              >
                {openInControl && (
                  <div className="rp-control-open">
                    <div className="rp-control-open-head">{P.controlOpenHead}</div>
                    {missing.map((st) => (
                      // each row JUMPS to the thing it names (jumpToStep), a full 44px row
                      <button key={st} type="button" className="rp-control-step"
                        onClick={() => { setControlOpen(false); guideTo(st) }}>
                        <span>{A.steps[st]}</span><Icon id="chevron" />
                      </button>
                    ))}
                  </div>
                )}
                {missTx > 0 && (
                  <p className="form-warn form-warn-amber">
                    <Icon id="warn" /> <span className="form-warn-text">{fillTemplate(P.missingTranscripts, { n: missTx })}</span>
                    {onFixTranscripts && <button type="button" className="form-warn-act" onClick={onFixTranscripts}>{P.fixTranscripts}</button>}
                  </p>
                )}
                {pendingMediaCount > 0 && (
                  <p className="form-warn form-warn-amber">
                    <Icon id="warn" /> <span className="form-warn-text">{fillTemplate(P.pendingMedia, { n: pendingMediaCount })}</span>
                  </p>
                )}
                {/* names them and says WHY — a count of «ohne verwertbare Zeiten» was the version
                    that got printed and that nobody could do anything with. The fix is one tap
                    away, on the Anwesenheit these names come from. */}
                {unresolvedNames.length > 0 && (
                  <p className="form-warn form-warn-amber">
                    {/* joined on «·», not on a comma: the names read «Müller Hans», so every
                        name already contains a space, and a comma between them is a weaker
                        break than the one inside each pair — the run scanned as one long
                        smear of words. A middot outranks the space and the list falls apart
                        into people again. */}
                    <Icon id="warn" /> <span className="form-warn-text">{fillTemplate(P.unresolvedHours, { names: unresolvedNames.join(' · ') })}</span>
                    {onOpenAnwesenheit && <button type="button" className="form-warn-act" onClick={onOpenAnwesenheit}>{A.steps.anwesenheit}</button>}
                  </p>
                )}
                <div className="report-fold-body">
                  <p><Icon id={proof.intact ? 'check' : 'warn'} /> {proofLabel(proof)}</p>
                  <p><Icon id="doc" /> {options.allPlans ? P.plansPrintAll : options.annotatedPlans ? fillTemplate(P.plansPrintAnnotated, { n: annotatedPlanCount }) : P.plansPrintNone}</p>
                  <p><Icon id="snapshot" /> {fillTemplate(P.stateNote, { at: formatDateTime(new Date().toISOString()) })}</p>
                </div>
              </Popover>
            )}
            {/* ⚠️ Every label in this row is wrapped in `.fold-long`, not left as a bare text node:
                where the one row runs out the head's ladder folds it (lib/pageHeadFit · `RP_FOLD`)
                and a bare text node cannot be hidden. The label survives as `aria-label` + `title`,
                so what is dropped is the pixels, never the naming. */}
            {onComplete && (
              <button className="ip-btn head-tile" data-fold={RP_FOLD.complete} onClick={() => void complete()} aria-label={A.complete} title={A.complete}>
                <Icon id="archive" /><span className="rp-btn-label fold-long">{A.complete}</span>
              </button>
            )}
            {printStatus?.available && (
              <button className={`ip-btn head-tile print-send${printStatus.online ? '' : ' offline'}`} disabled={printBusy}
                data-fold={RP_FOLD.print}
                onClick={() => void startOutput('print')} aria-label={printBusy ? R.sending : printStatus.online ? R.send : `${R.send} · ${R.offline}`}
                title={printStatus.online ? R.online : R.offline}>
                <span className="print-send-main">
                  {printBusy ? <ShellLoader /> : <Icon id="printer" />}
                  <span className={`dot print-relay-dot${printStatus.online ? ' online' : ''}`} aria-hidden />
                  <span className="rp-btn-label fold-long">{printBusy ? R.sending : R.send}</span>
                </span>
                {/* the offline reason is the dot's colour, the button's name and the confirm a
                    press raises — never a second line in the one-row head (13-incident.css) */}
              </button>
            )}
            {/* Press it and it prints, with whatever is set. The ▾ is the second door: the same
                print again (so the menu is never a dead end for the one who opened it looking
                for «drucken»), and the way into the section picker. Split rather than two
                buttons: the arrow belongs TO the PDF button — it modifies it — and a separate
                ⋮ beside it would have read as the surface's menu. The pair never wraps apart
                (it is one flex item), so at ≤720px it drops onto its own line intact.
                ⚠️ One FRAMED tile, not a filled one (27.09.2026, slim sweep · mockup 2): on the
                phone it reads «PDF ▾» — the word, not a doc glyph whose meaning you had to know
                (`.rp-btn-short`); the tablet keeps its full label. Same two doors as before. */}
            <span className="rp-split">
              <button className="ip-btn head-tile rp-split-main" data-fold={RP_FOLD.pdf} disabled={pdfBusy} onClick={() => void startOutput('pdf')}
                aria-busy={pdfBusy || undefined} aria-label={pdfBusy ? P.pdfBusy : P.pdfFull} title={pdfBusy ? P.pdfBusy : P.pdfFull}>
                {pdfBusy ? <span className="fold-long"><ShellLoader /></span> : <Icon id="doc" className="rp-pdf-glyph fold-long" />}
                <span className="rp-btn-label fold-long">{P.pdfFull}</span>
                <span className="rp-btn-short rp-pdf-short fold-short">
                  <span style={{ visibility: pdfBusy ? 'hidden' : undefined }}>{P.pdfShort}</span>
                  {pdfBusy && <span className="rp-pdf-wait"><ShellLoader /></span>}
                </span>
              </button>
              <Menu
                trigger={
                  <button type="button" className="ip-btn head-tile rp-split-more" aria-label={P.printMenu} title={P.printMenu}>
                    <Icon id="chevron-down" className="chev" />
                  </button>
                }
                popupClassName="rp-print-menu"
                itemClassName={() => 'rp-print-menu-item'}
                // «Abschnitte» used to be a fold ON the page — a section of the rapport that is
                // not part of the rapport: it is neither recorded nor printed, it is how the
                // printing is done, and it was scrolled past on every Einsatz whose defaults were
                // already right, which is nearly all of them (the seed follows the data).
                // The sections are IN this menu now, not behind it: «was kommt aufs Papier» is
                // several decisions in a row, and a dialog to open, tick and close for each one is
                // the long way round something done while looking at the button that prints. Base
                // UI keeps the menu open on a checkbox, so the row just flipped is still there.
                items={[
                  // No «Einsatzrapport (PDF)» row in here. It was meant as a second door for
                  // whoever opened the ▾ looking for «drucken», but the door it repeats is the
                  // button the ▾ is physically attached to — one press to the left, already
                  // pressed to get here. A menu whose first line is the control that opened it
                  // teaches that the two do different things, and they do not.
                  // The ticks need a name. Nine of them under «Einsatzrapport (PDF)» with nothing
                  // saying what they are is a menu that has to be experimented with.
                  { kind: 'head' as const, label: P.sectionsHead },
                  { kind: 'check' as const, label: P.toggleKroki, checked: options.kroki && mapContentCount > 0, disabled: mapContentCount === 0, onChange: (v: boolean) => patchOpt({ kroki: v }) },
                  // Pläne is three-way (mit Anmerkungen / alle / keine) and does not fit a
                  // checkbox, so the menu offers the two that are actually chosen between: the
                  // annotated ones, or all of them. Off is «neither ticked».
                  { kind: 'check' as const, label: fillTemplate(P.plansAnnotated, { n: annotatedPlanCount }), checked: options.annotatedPlans && !options.allPlans, onChange: (v: boolean) => patchOpt({ annotatedPlans: v, allPlans: false }) },
                  { kind: 'check' as const, label: P.plansAll, checked: options.allPlans, onChange: (v: boolean) => patchOpt({ allPlans: v, annotatedPlans: v ? false : options.annotatedPlans }) },
                  // ⚠️ NOT one of the «Pläne»: an Objektplan is reference, the Gebäude is the Einsatz's
                  // own work (Trupp positions per storey). Only storeys that carry something print.
                  { kind: 'check' as const, label: fillTemplate(P.toggleGebaeude, { n: stackFloorCount }), checked: options.gebaeude && stackFloorCount > 0, disabled: stackFloorCount === 0, onChange: (v: boolean) => patchOpt({ gebaeude: v }) },
                  // the Tafel's pages (Erste Führung …) and its Skizze — the Einsatz's own work, ON
                  { kind: 'check' as const, label: fillTemplate(P.toggleTafel, { n: tafelPageCount }), checked: options.tafel !== false && tafelPageCount > 0, disabled: tafelPageCount === 0, onChange: (v: boolean) => patchOpt({ tafel: v }) },
                  { kind: 'sep' as const },
                  { kind: 'check' as const, label: fillTemplate(P.toggleAtemschutz, { n: truppCount }), checked: options.atemschutz, onChange: (v: boolean) => patchOpt({ atemschutz: v }) },
                  { kind: 'check' as const, label: fillTemplate(P.toggleAttendance, { n: attendanceCount }), checked: options.attendance, onChange: (v: boolean) => patchOpt({ attendance: v }) },
                  { kind: 'check' as const, label: fillTemplate(P.toggleMittel, { n: mittelCount }), checked: options.mittel, onChange: (v: boolean) => patchOpt({ mittel: v }) },
                  { kind: 'check' as const, label: P.toggleJournal, checked: options.journal, onChange: (v: boolean) => patchOpt({ journal: v }) },
                  // ⚠️ Its own row, with its own count. Folded into «Einsatzjournal» it was invisible:
                  // switching the long log off silently dropped the outstanding items too, and nothing
                  // on the sheet said so. The count is also the diagnostic — «(0)» means the Einsatz
                  // raised none, not that the section is broken.
                  { kind: 'check' as const, label: fillTemplate(P.togglePendenzen, { n: pendenzCount }), checked: options.pendenzen && pendenzCount > 0, disabled: pendenzCount === 0, onChange: (v: boolean) => patchOpt({ pendenzen: v }) },
                  { kind: 'check' as const, label: fillTemplate(P.toggleAttachments, { n: attachments.length }), checked: options.attachments && attachments.length > 0, disabled: attachments.length === 0, onChange: (v: boolean) => patchOpt({ attachments: v }) },
                  { kind: 'sep' as const },
                  { kind: 'check' as const, label: P.toggleDetailedAudit, checked: options.detailedAudit, onChange: (v: boolean) => patchOpt({ detailedAudit: v }) },
                  // the internal Beilage (lib/auswertung): key figures, swimlanes, Lehren on the
                  // LAST sheet, after everything that gets signed — so it comes off the stack
                  // before the rapport leaves the station
                  { kind: 'check' as const, label: P.toggleAuswertung, checked: options.auswertung, onChange: (v: boolean) => patchOpt({ auswertung: v }) },
                  { kind: 'sep' as const },
                  // the Beilagen in ORIGINAL quality — one ZIP with manifest + SHA-256 per file,
                  // for the digital Ablage. An ACTION among the section ticks, so it sits last;
                  // an anchor download, not a navigation (lib/download · downloadUrl) — the
                  // session cookie still does the auth. Absent (404) when the Einsatz has no
                  // stored media — the disabled state mirrors that.
                  {
                    label: P.archiveZip,
                    disabled: !hasStoredMedia,
                    onClick: () => { downloadUrl(`/api/incidents/${incident.id}/media.zip`) },
                  },
                ]}
              />
            </span>
          </div>
        </header>
        {/* The Einsatz is done in every way except the bookkeeping: the paper exists, nothing is
            missing, and it is still sitting on the open list. Archiving is a deliberate act that
            nobody performs unless they know it exists, so this is the app saying it once, at the
            one moment it is true — a line under the head, never a dialog. It blocks nothing:
            «Später» takes it off the screen and the two buttons above are untouched. */}
        {closedHint && (
          <div className="rp-band rp-band-open" role="note">
            <Icon id="lock" className="rp-band-wait" />
            <span className="rp-band-txt">{appConfig.copy.archived.rapportClosedHint}</span>
          </div>
        )}
        {/* #14 · #15: one strip under the head, one size (owner: the band «a bit smaller, same as
            the guide»). Outside the scrolling body, so it stays on screen with the keyboard up. */}
        {guideNext && (
          <RpStrip lead={missing.length === 1 ? P.guideLast : P.guideNext} count={fillTemplate(P.guideLeft, { n: missing.length })}
            title={A.steps[guideNext]} onGo={() => guideTo(guideNext)} onHide={() => setGuideAt(null)} hideLabel={P.guideHide} />
        )}
        {showReadyBand && (
          <RpStrip done lead={P.bandReady} title={P.bandPdf} busy={pdfBusy}
            icon={pdfBusy ? <ShellLoader /> : <Icon id="doc" />} onGo={() => void startOutput()} />
        )}
        {showCloseBand && (
          <RpStrip done lead={P.bandDone} title={A.complete} icon={<Icon id="archive" />}
            onGo={() => void complete()} onHide={hideBand} hideLabel={P.bandLater}>
            {/* 15y: the ZIP is the step after the Abschluss, for the digital Ablage – a line, not a
                second button (the same download the ▾ menu carries) */}
            {hasStoredMedia && (
              <p className="rp-strip-more">
                <Icon id="download" />{P.bandZipLead}
                <button type="button" className="rp-strip-link" onClick={() => downloadUrl(`/api/incidents/${incident.id}/media.zip`)}>{P.archiveZip}</button>
              </p>
            )}
          </RpStrip>
        )}
        {/* …and its counterpart: a print that has been handed over and has not come back. It is
            NOT dismissible — «Später» on the green band hides an offer, this one is an open
            question about whether the rapport exists at all — and it stays until the relay says
            done, failed or cancelled. Amber, because nothing is finished and nothing is wrong. */}
        {pendingJob && (
          <div className="rp-band rp-band-open">
            <Icon id="printer" className="rp-band-wait" />
            <span className="rp-band-txt">
              <b>{R.jobOpen}</b>{' '}
              {fillTemplate(R.jobOpenSince, { t: fmtSpanShort(Math.max(0, jobNowMs - Date.parse(pendingJob.at))) })}
              {printStatus && !printStatus.online && ` · ${R.offline}`}
            </span>
            {/* The band stays VISIBLE for a viewer — an outstanding print is true information —
                but the actions sit behind the same canEdit gate as every other control on this
                surface (the disabled fieldsets above). A viewer's «Abbrechen» used to really
                cancel the job at the relay while their own settlePrintJob no-oped: toast said
                abgebrochen, the band stayed, and the editor's print was gone. */}
            <fieldset className="report-fieldset" disabled={!canEdit}>
              <button type="button" className="ip-btn" disabled={jobBusy} onClick={() => void checkPrintJob()}>{R.jobCheck}</button>
              <button type="button" className="ip-btn ip-btn-danger" disabled={jobBusy} onClick={() => void dropPrintJob()}>{R.jobCancel}</button>
            </fieldset>
          </div>
        )}
        {/* PHONE ONLY — `display: none` from 601px up, so tablet and desktop are byte-identical
            to what they were. Outside the scrolling body on purpose: it is a flex item of the
            surface, like the head, so it cannot scroll away from under the thumb. The dot marks
            a tab holding a Mindestangabe that is still open — the same amber the head's chips
            use, so «noch offen» means one thing on this page. */}
        <PhoneTabBar<PhoneTab>
          ariaLabel={P.tabsLabel}
          value={phoneTab}
          onChange={pickTab}
          options={PHONE_TABS.map((t) => {
            // the same to-do as the head's chip, so the same gate (a viewer gets no dot)
            const open = canEditIn && missing.some((s) => STEP_TAB[s] === t)
            return {
              value: t,
              title: open ? `${P.tabs[t]} – ${P.headStillOpen}` : P.tabs[t],
              label: <>{P.tabs[t]}{open && <span className="rp-tab-dot" aria-hidden />}</>,
            }
          })}
        />
        <div className="ip-body report-preflight-body" data-phone-tab={phoneTab} ref={bodyRef}>
          {/* TWO columns on a wide screen (one below 1080px, see app.css), because the rapport is
              worked in two different ways and they interleave: the FORM is typed straight through
              — dispatch readout, Zusammenfassung, the Zeiten, Bemerkungen — while the ROUND-UP
              beside it (wer und was war da: Anwesenheit · Mittel · Partner · Beilagen, then what
              will print) is checked off after the fact and jumps to other surfaces. Stacked they
              made one column two screens tall on a page half of which was margin; side by side
              the Zeiten grid gets the width it was always asking for and the checklist stays
              visible while the form is being typed. The DOM order is untouched — it is the order
              of the printed rapport and of the paper Erfassungsblatt (app/report,
              admin/capturePdf.ts, both tested) — the columns only decide WHERE, never in which
              order things are read. */}
          <div className="rp-col rp-col-form">
          {/* ONE disabled fieldset rather than a `readOnly` on twenty controls: a viewer, and an
              archived Einsatz («nur ansehen – zum Bearbeiten reaktivieren»), can read every
              recorded value here and change none of it. `persist` refuses too, so a stray
              handler can't slip past the markup.
              ⚠️ The fieldset is the safety net, not the look (RBAC audit 22.10.2026): where
              `canEdit` is false each field draws a `ReadOut` instead of its control – no «Jetzt»,
              no «Entfällt», no steppers, no picker, no ✕ – because a disabled form is a row of
              doors the session cannot go through. */}
          <fieldset className="report-fieldset" disabled={!canEdit}>
          <section
            className={`report-pre-section report-pre-meta${onEditDispatch ? ' report-meta-dispatch-click' : ''}`}
            data-tab="bericht" onClick={onEditDispatch}>
            {/* No <h3> here: the dispatch block carries its own «Aus den Einsatzdaten» heading,
                and the whole card is the edit affordance, so a section title above it was the
                same words twice. The other three sections have one because they have nothing
                else to say what they are. */}
            {/* ⚠️ The card is CLICKABLE, not a <button>. Wrapping the whole thing in a button
                (or giving the section role="button") made the dispatch facts part of its label: a
                screen reader then gets one stop announcing «Aus den Einsatzdaten – Bearbeiten»,
                and the Alarmmeldung, the Einsatzplan and the Alarmierung — the things this block
                exists to state — collapse into it. So the <dl> stays readable content and the
                click on the card is pure pointer convenience.
                The click sits on the SECTION, the card itself (owner #32, 30.10.2026): it lights
                and presses its own edge like Anwesenheit/Material beside it, instead of a second
                grey box drawn inside the card.
                The keyboard/AT target is the HEADING, «Aus den Einsatzdaten» (owner, 31.10.2026:
                the 26px pencil beside it went – the card is the press target, the pencil was a
                second one for the same thing). A role="button" span, not a <button>: the fieldset
                around it is disabled when the Rapport may not be written (signed, viewer), while
                the Einsatzdaten may still be (`onEditDispatch` is the session's own right), and a
                disabled fieldset disables every <button> in it. Its click bubbles to the section –
                one handler, one ask per tap; Enter/Space are its own. */}
            <div className="report-meta-dispatch">
              {onEditDispatch ? (
                <span role="button" tabIndex={0} className="report-meta-dispatch-head report-meta-dispatch-go" title={P.edit}
                  onKeyDown={(e) => {
                    if (e.key !== 'Enter' && e.key !== ' ') return
                    e.preventDefault()
                    onEditDispatch()
                  }}>
                  {P.fromDispatch}
                </span>
              ) : <span className="report-meta-dispatch-head">{P.fromDispatch}</span>}
              <dl className="report-meta-readout">
                {/* Stichwort, Art and Ort first (owner, 18.09.2026): the block is what the Rapport
                    was opened FOR, and with the three pages behind one tile the reader must see
                    which Einsatz this is without going back to the Karte. */}
                <div><dt>{P.stichwort}</dt><dd>{incident.title || <span className="report-meta-empty">{P.notRecorded}</span>}</dd></div>
                {incident.type && <div><dt>{P.einsatzart}</dt><dd>{incident.type}</dd></div>}
                <div><dt>{P.ort}</dt><dd>{incident.address || <span className="report-meta-empty">{P.notRecorded}</span>}</dd></div>
                {/* The gateway hands us one field holding four different things (see
                    lib/alarmText). Shown verbatim it is mostly machinery — a marching order,
                    an object's notes, and a 300-character link this app minted itself — under
                    a heading that promises a MESSAGE. Split, each part lands where it belongs
                    and «Alarmmeldung» says «nicht erfasst» when nobody wrote one, which is the
                    honest answer and the common one. */}
                <div>
                  <dt>{P.alarmMessage}</dt>
                  <dd>{alarm.message || <span className="report-meta-empty">{P.notRecorded}</span>}</dd>
                </div>
                {alarm.vehicleOrder && (
                  <div><dt>{P.vehicleOrder}</dt><dd>{alarm.vehicleOrder}</dd></div>
                )}
                {alarm.plan && (
                  <div>
                    <dt>{P.einsatzplan}</dt>
                    <dd>
                      {alarm.plan.header}
                      {/* Sofortmassnahmen are the safety-relevant half — they stay. The
                          Bemerkungen belong to the Einsatzobjekt and are one tap away there. */}
                      {alarm.plan.measures.length > 0 && (
                        <ul className="report-meta-list">
                          {alarm.plan.measures.map((m, i) => <li key={i}>{m}</li>)}
                        </ul>
                      )}
                    </dd>
                  </div>
                )}
                <div><dt>{P.alarmierung}</dt><dd>{alarmiert ? formatDateTime(alarmiert) : <span className="report-meta-empty">{P.notRecorded}</span>}</dd></div>
              </dl>
            </div>
          </section>

          {/* «Rapportangaben» was ONE heading over everything after the dispatch facts — a blob a
              screen and a half long in which nothing could be found by looking. It is four
              sections now, each named after the question it answers, in exactly the order they
              were already in (that order is the printed rapport's). */}
          <section className="report-pre-section report-pre-meta" data-tab="bericht">
            <h3>{P.sectionBericht}</h3>
            {/* after-arrival — editable inline (replaces the old Bearbeiten modal).
                ⚠️ `data-sync` marks which Rapportangabe the caret is in, so a value arriving
                from another device is never yanked out from under somebody typing here — it is
                adopted the moment the field is left (see useSyncedField). One marker per field. */}
            <label className="ip-field" data-step="kurzbericht" data-sync="summary">
              <span>{P.summaryLabel}</span>
              {canEdit ? (
                <textarea className="ip-textarea" value={summary} rows={5} placeholder={P.summaryPlaceholder}
                  onChange={(e) => { const v = stripUnprintable(e.target.value); setSummary(v); persist({ summary: v.trim() || undefined }) }} />
              ) : <ReadOut value={summary} />}
            </label>
            <div className="report-meta-grid">
              {/* ⚠️ Each field carries its OWN anchor. The grid used to carry one for
                  «einsatzleiter», so the chip highlighted the Einsatzleiter AND the Kontaktperson
                  — two different people answering two different questions. The grid is a single
                  column, so a wrapper here is a plain block box and changes no layout. */}
              <div data-step="einsatzleiter" data-sync="einsatzleiter">
              {!canEdit ? (
                <div className="ip-field"><span>{P.einsatzleiterLabel}</span><ReadOut value={einsatzleiter} /></div>
              ) : <PersonField
                label={P.einsatzleiterLabel} placeholder={P.einsatzleiterPlaceholder}
                value={{ name: einsatzleiter }} onChange={(slot) => {
                  setEinsatzleiter(slot.name)
                  persist({ einsatzleiter: slot.name.trim() || undefined })
                  // the slot's personId was thrown away here — which is why the EL named on the
                  // Rapport never reached the Anwesenheit list
                  onRolePicked?.(slot.personId, 'el', appConfig.copy.anwesenheit.roleEinsatzleiter)
                }}
                personnel={personnel} legacyRoster={[]} presentIds={presentIds}
                assignedIds={NO_IDS} usedIds={NO_IDS} usedNames={NO_IDS}
                // ⚠️ The job each candidate already holds. This picker of all of them was the
                // silent one: it is where somebody is MADE Einsatzleiter, and it said nothing
                // about the fact that the name under the cursor is already the Fahrer of the TLF.
                rolesById={rolesById}
                onAddGuest={onAddGuest && ((name) => onAddGuest(name, 'el', appConfig.copy.anwesenheit.roleEinsatzleiter))}
                rankFirst officerFilter
              />}
              </div>
              {/* ⚠️ A <div>, not a <label>: the row carries a BUTTON now, and a button inside a
                  label steals its own tap for the input's focus. Same shape the Rückmeldung-Zeit
                  row next to it already uses; the input keeps its name through `aria-label`. */}
              <div className="ip-field" data-step="kontaktperson" data-sync="kontaktperson">
                <span>{P.kontaktpersonLabel}</span>
                {/* «Entfällt» — the third answer. A Fehlalarm in an empty Altersheim has nobody
                    to name, and «leer» and «gibt es nicht» are two different statements: without
                    this the step stayed open for ever and the «Angaben fehlen noch» dialog stood
                    in front of every print until it was being tapped away unread. It is a
                    trailing affordance on the input line, not a checkbox somewhere else — the
                    two answers are the same distance away. */}
                {meta.kontaktpersonNone ? (
                  <div className="rz-none">
                    {/* dashed, never a tick: erledigt, but ANSWERED «nicht vorhanden» rather than
                        filled in — one glance tells the two apart */}
                    <span className="rz-none-val">{P.entfaellt}</span>
                    {canEdit && <button type="button" className="ip-btn" onClick={() => persist({ kontaktpersonNone: undefined })}>{P.entfaelltUndo}</button>}
                  </div>
                ) : !canEdit ? (
                  // the name and the number as one read-out, and the call stays (owner, 22.10.2026:
                  // a viewer keeps the Kontaktperson's working `tel:`)
                  <div className="rz-none">
                    <ReadOut value={[kontaktperson.trim(), kontaktTel.trim()].filter(Boolean).join(' · ')} />
                    {telHref(kontaktTel) && (
                      <a className="ip-btn rz-call" href={telHref(kontaktTel)}
                        aria-label={P.kontaktpersonCall} title={P.kontaktpersonCall}>
                        <Icon id="phone" />
                      </a>
                    )}
                  </div>
                ) : (
                  <div className="rz-none rz-kontakt">
                    {/* ✕: the Rapport is filled in after the fact and corrected as the picture
                        settles — a name written down from a first guess is normal here. */}
                    <ClearableInput value={kontaktperson} placeholder={P.kontaktpersonPlaceholder}
                      aria-label={P.kontaktpersonLabel}
                      clearLabel={P.kontaktpersonClear}
                      onChange={(raw) => { const v = stripUnprintable(raw); setKontaktperson(v); persist({ kontaktperson: v.trim() || undefined }) }} />
                    {/* The number beside the name, because it is ONE fact — and the reason it is
                        recorded at all: the callback in the Nachbearbeitung. Its own data-sync
                        marker, or a value arriving from the iPad would overwrite mid-typing. */}
                    <div className="rz-kontakt-tel" data-sync="kontaktTel">
                      <ClearableInput value={kontaktTel} placeholder={P.kontaktpersonTelefonPlaceholder}
                        aria-label={P.kontaktpersonTelefon}
                        clearLabel={P.kontaktpersonTelefonClear}
                        inputMode="tel" autoComplete="off"
                        onChange={(raw) => { const v = stripUnprintable(raw); setKontaktTel(v); persist({ kontaktpersonTelefon: v.trim() || undefined }) }} />
                      {telHref(kontaktTel) && (
                        <a className="ip-btn rz-call" href={telHref(kontaktTel)}
                          aria-label={P.kontaktpersonCall} title={P.kontaktpersonCall}>
                          <Icon id="phone" />
                        </a>
                      )}
                    </div>
                    {/* only while BOTH halves are empty (30.08.): «Entfällt» beside a typed
                        name contradicted it — the tap would silently wipe real content. Once
                        something is typed, the ✕ is the way back to the empty state. */}
                    {!kontaktperson.trim() && !kontaktTel.trim() && (
                      <button type="button" className="ip-btn"
                        onClick={() => { persist({ kontaktperson: undefined, kontaktpersonTelefon: undefined, kontaktpersonNone: true }) }}>
                        {P.entfaellt}
                      </button>
                    )}
                  </div>
                )}
              </div>
            </div>
            {/* one Kontaktperson carries all contact/ownership details (2026-07-18 —
                the kantonale Eigentümer/Ursache/Verursacher trio was retired: cause is
                not the Feuerwehr's to judge, one contact suffices) */}
            <div className="report-meta-grid">
              <div className="ip-field">
                <span>{P.geretteteLabel}</span>
                {/* two labelled ±steppers (shared Stepper) — tap −/+ or the value to type; matches the
                    details-modal count control. over-object carries the fresh values (state set in the
                    same tick is stale). Empty = null: the value reads «–», not «0» (29.09.2026 — «0»
                    above «Keine» said «nobody» for an unanswered field, the very ambiguity «Keine»
                    removes). The ✕ stays visible, disabled while empty, so entering or clearing a
                    count never moves the buttons.
                    `readOnly` while «Keine» is active (below): both fields are already empty when
                    that answer is given, and an enabled stepper let a tap edge one of them off zero
                    while still showing «niemand gerettet» — the same contradiction «Entfällt» guards
                    against on Kontaktperson. Stepping either one back OFF the answer is the ✕ next
                    to it, same as everywhere else. */}
                {/* read-only: the two numbers as read-outs in the same rows, «–» for none — and
                    once «Keine» was answered, that answer alone (below) */}
                {!canEdit ? (!meta.geretteteNone && (
                  numOrU(geretteteP) === undefined && numOrU(geretteteT) === undefined ? <ReadOut /> : (
                    <div className="rz-counts">
                      <div className="rz-count"><span>{P.gerettetePersonen}</span><b>{numOrU(geretteteP) ?? '–'}</b></div>
                      <div className="rz-count"><span>{P.geretteteTiere}</span><b>{numOrU(geretteteT) ?? '–'}</b></div>
                    </div>
                  ))) : (
                <div className="rz-counts">
                  <div className="rz-count" data-sync="geretteteP">
                    <span>{P.gerettetePersonen}</span>
                    <Stepper value={numOrU(geretteteP) ?? null} min={0} max={999} seed={1} ariaLabel={P.gerettetePersonen}
                      readOnly={meta.geretteteNone}
                      onChange={(v) => { setGeretteteP(String(v)); persist(geretteteMeta(String(v), geretteteT)) }}
                      onClear={() => { setGeretteteP(''); persist(geretteteMeta('', geretteteT)) }} canClear={geretteteP !== ''} />
                  </div>
                  <div className="rz-count" data-sync="geretteteT">
                    <span>{P.geretteteTiere}</span>
                    <Stepper value={numOrU(geretteteT) ?? null} min={0} max={999} seed={1} ariaLabel={P.geretteteTiere}
                      readOnly={meta.geretteteNone}
                      onChange={(v) => { setGeretteteT(String(v)); persist(geretteteMeta(geretteteP, String(v))) }}
                      onClear={() => { setGeretteteT(''); persist(geretteteMeta(geretteteP, '')) }} canClear={geretteteT !== ''} />
                  </div>
                </div>
                )}
                {/* ⚠️ «Keine» — the answer an empty pair of steppers could not give (04.09.,
                    Rapport-Review). Empty meant «niemand gerettet» AND «nicht abgeklärt» AND
                    «nicht erfasst» at once on the 03.09. Rapport; with this it means only the
                    last of them.
                    Offered only while BOTH steppers are empty — the rule «Entfällt» follows one
                    field up (30.08.): a «Keine» beside a 3 would contradict itself, and once a
                    number is typed the stepper's ✕ is the way back to empty. Answered, it wears
                    the same dashed `.rz-none-val` the Kontaktperson does: filled in, but by an
                    answer rather than a value — a tick would claim something was counted. */}
                {meta.geretteteNone ? (
                  <div className="rz-none rz-none-trail">
                    <span className="rz-none-val">{P.geretteteNoneHint}</span>
                    {canEdit && (
                      <button type="button" className="ip-btn"
                        onClick={() => persist({ geretteteNone: undefined })}>{P.entfaelltUndo}</button>
                    )}
                  </div>
                ) : canEdit && numOrU(geretteteP) === undefined && numOrU(geretteteT) === undefined ? (
                  <div className="rz-none rz-none-trail">
                    <button type="button" className="ip-btn"
                      onClick={() => persist({ gerettete: undefined, geretteteNone: true })}>
                      {P.geretteteNone}
                    </button>
                  </div>
                ) : null}
                {/* No ✕ here, unlike the Material strip: this one disappears by itself the moment
                    the fields agree with the Lage, so «weg damit» and «stimmt» are the same tap. */}
                {geretteteHint && (
                  <div className="rz-lage-strip" role="status">
                    <span className="rz-lage-text">
                      {fillTemplate(P.geretteteLageStrip, {
                        list: [
                          geretteteHint.personen ? fillTemplate(P.geretteteLagePersonen, { n: geretteteHint.personen }) : '',
                          geretteteHint.tiere ? fillTemplate(P.geretteteLageTiere, { n: geretteteHint.tiere }) : '',
                        ].filter(Boolean).join(' · '),
                      })}
                    </span>
                    <Button variant="primary" className="rz-lage-take"
                      onClick={() => {
                        const p = String(geretteteHint.personen)
                        const t = String(geretteteHint.tiere)
                        setGeretteteP(p); setGeretteteT(t); persist(geretteteMeta(p, t))
                      }}>
                      {P.geretteteLageTake}
                    </Button>
                  </div>
                )}
              </div>
            </div>
          </section>

          <section className="report-pre-section report-pre-meta" data-tab="bericht">
            <h3>{P.sectionZeiten}</h3>
            {/* Ausgerückt: derived from the vehicle grid when it exists; the manual field
                only appears on deployments WITHOUT configured vehicles (nothing else to
                derive from). With vehicles configured but no times yet, the grid below is
                the entry point — a duplicate manual field would just contradict it. */}
            {derivedAus ? (
              <label className="ip-field">
                <span>{A.ausgerueckt}</span>
                <div className="report-meta-end rz-derived">
                  <b>{clockOf(derivedAus)}</b>
                  <span className="rz-sub">{P.ausgeruecktDerived}</span>
                </div>
              </label>
            ) : (getDeploymentConfig().fleet?.vehicles ?? []).length === 0 ? (
              !canEdit ? (
                <div className="ip-field"><span>{A.ausgerueckt}</span><ReadOut value={whenOf(dtLocalToIso(ausgerueckt))} /></div>
              ) : <label className="ip-field" data-sync="ausgerueckt">
                <span>{A.ausgerueckt}</span>
                <div className="report-meta-end dtrow">
                  <DateTimeField ariaLabel={A.ausgerueckt} value={dtLocalToIso(ausgerueckt)}
                    days={incidentDays(meta.startedAt ?? incident.started_at, renderNow)}
                    onCommit={(iso) => { setAusgerueckt(dtLocalValue(iso ?? undefined)); persist({ ausgeruecktAt: iso ?? undefined }) }} />
                </div>
                {zeitWarn('ausgerueckt')}
              </label>
            ) : null}
            {/* Alarmierungs-/Ausrückzeiten grid — rows from deployment config (empty config
                hides it); webhook-prefilled values, edits stamp `manual` (human wins). */}
            {(() => {
              const gRows = gruppenRows(getDeploymentConfig().alarms?.groups ?? [], gruppen)
              const vRows = fahrzeugRows(getDeploymentConfig().fleet?.vehicles ?? [], fahrzeuge)
              // The grid shows a bare clock, so the calendar day is resolved against the alarm —
              // an Ausrückzeit of 00:15 after an Alarmierung um 23:50 is the NEXT day, and used
              // to land 23h35 before the alarm. Same rule and same day wheel as the Rückmeldung
              // ELZ field below; `day` arrives only on an incident that spans more than one.
              // ⚠️ A LIVE clock, for the same reason the plausibility check above uses one: this
              // list runs from the Alarmierung to «now», and a «now» frozen when the surface
              // mounted stops growing while the surface sits open. An Einsatz that started at
              // 23:50 and is still being written at 00:30 — the ordinary night Einsatz — then
              // offered only the day before, so a clock typed after midnight could not be put on
              // the day it actually happened.
              const zeitDays = incidentDays(meta.startedAt ?? incident.started_at, renderNow)
              const onGruppe = (id: string, hhmm: string, day?: Date) => {
                const iso = zeitFromClock(incident.started_at, hhmm, day)
                const next = setGruppeZeit(gruppen, id, iso)
                setGruppen(next)
                persist({ gruppen: next.length ? next : undefined })
              }
              const onFahrzeug = (id: string, hhmm: string, day?: Date) => {
                const iso = zeitFromClock(incident.started_at, hhmm, day)
                const next = setFahrzeugZeit(fahrzeuge, id, 'ausgerueckt', iso)
                setFahrzeuge(next)
                persist({ fahrzeuge: next.length ? next : undefined, ausgeruecktAt: deriveAusgerueckt(next) ?? dtLocalToIso(ausgerueckt) })
              }
              return (
                <>
                  {gRows.length > 0 && (
                    <div className="ip-field" data-sync="gruppen">
                      <span>{P.gruppenLabel}</span>
                      <div className="rz-grid">
                        {gRows.map(({ config: c, value: v }) => (
                          <label key={c.id} className="rz-row">
                            <span className="rz-name">{c.label}{c.color ? ` (${c.color})` : ''}</span>
                            {/* ⚠️ `valueDay` is not optional here: the day wheel hands a day back
                                on EVERY commit once the incident spans more than one, and without
                                it the picker opens on TODAY — so correcting a Monday Ausrückzeit
                                on Wednesday filed it as Wednesday, on the sheet that becomes the
                                printed Rapport (see TimeField · valueDay). */}
                            {canEdit ? (
                              <TimeField ariaLabel={c.label} value={clockOf(v?.alarmedAt)} days={zeitDays}
                                valueDay={v?.alarmedAt ? new Date(v.alarmedAt) : undefined}
                                onCommit={(hhmm, day) => onGruppe(c.id, hhmm ?? '', day)} />
                            ) : <b className="rz-clock">{clockOf(v?.alarmedAt) || '–'}</b>}
                          </label>
                        ))}
                      </div>
                    </div>
                  )}
                  {vRows.length > 0 && (
                    <div className="ip-field" data-sync="fahrzeuge">
                      <span>{P.fahrzeugeLabel}</span>
                      <div className="rz-grid">
                        {vRows.map(({ config: c, value: v }) => (
                          <label key={c.id} className="rz-row">
                            <span className="rz-name">
                              {c.label}
                              {(v?.vorOrt || v?.zurueck || fahrtenText(v)) && (
                                <span className="rz-sub">
                                  {[
                                    v?.vorOrt ? `${P.vorOrtShort} ${clockOf(v.vorOrt)}` : '',
                                    v?.zurueck ? `${P.zurueckShort} ${clockOf(v.zurueck)}` : '',
                                    fahrtenText(v),
                                  ].filter(Boolean).map((t, i) => (i ? ` · ${t}` : ` ${t}`)).join('')}
                                </span>
                              )}
                            </span>
                            {/* …and the same day for the Ausrückzeit — see the Gruppen row above */}
                            {canEdit ? (
                              <TimeField ariaLabel={c.label} value={clockOf(v?.ausgerueckt)} days={zeitDays}
                                valueDay={v?.ausgerueckt ? new Date(v.ausgerueckt) : undefined}
                                onCommit={(hhmm, day) => onFahrzeug(c.id, hhmm ?? '', day)} />
                            ) : <b className="rz-clock">{clockOf(v?.ausgerueckt) || '–'}</b>}
                          </label>
                        ))}
                      </div>
                    </div>
                  )}
                  {/* What the SERVER observed from GPS (D2, 24.09.2026) — display only, and read
                      off the REMOTE blob: the server is its only writer, so a local copy being
                      edited above has nothing to add to it. */}
                  <VehicleGpsTable fahrzeuge={remote.fahrzeuge} />
                </>
              )
            })()}
            {/* (Einsatzende moved down to the Rückmeldung ELZ block — 2026-08-14. The two are
                set in the same breath: you note the end time as you phone the Einsatzleitzentrale.
                Everything left here is the Alarmierung, which is filled in from the other end of
                the Einsatz.) */}
          </section>

          <section className="report-pre-section report-pre-meta" data-tab="bericht">
            <h3>{P.sectionNachbearbeitung}</h3>
            <label className="ip-field" data-sync="remarks">
              <span>{P.remarksLabel}</span>
              {canEdit ? (
                <textarea className="ip-textarea" value={remarks} rows={3} placeholder={P.remarksPlaceholder}
                  onChange={(e) => { const v = stripUnprintable(e.target.value); setRemarks(v); persist({ remarks: v.trim() || undefined }) }} />
              ) : <ReadOut value={remarks} />}
            </label>
            <label className="ip-field" data-sync="lehren">
              <span>{P.lehrenLabel}</span>
              {canEdit ? (
                <textarea className="ip-textarea" value={lehren} rows={3} placeholder={P.lehrenPlaceholder}
                  onChange={(e) => { const v = stripUnprintable(e.target.value); setLehren(v); persist({ lehren: v.trim() || undefined }) }} />
              ) : <ReadOut value={lehren} />}
            </label>
            <div className="report-meta-grid">
              {/* Einsatzende leads the block. ⚠️ It carries `data-step="zeiten"` because it IS
                  the Zeiten step (lib/abschluss · stepDone) — the «Zeiten» chip has to land on
                  the field that makes it go away, not on the Alarmierung grid it used to sit in. */}
              <label className="ip-field" data-step="zeiten" data-sync="endedAt">
                <span>{P.incidentEndLabel}</span>
                {canEdit ? (
                  <div className="report-meta-end dtrow">
                    <DateTimeField ariaLabel={P.incidentEndLabel} value={dtLocalToIso(endedAt)}
                      days={incidentDays(meta.startedAt ?? incident.started_at, renderNow)}
                      onCommit={(iso) => { setEndedAt(dtLocalValue(iso ?? undefined)); persist({ endedAt: iso ?? undefined }) }} />
                    <button type="button" className="ip-btn" onClick={() => { const v = dtLocalValue(serverNowIso()); setEndedAt(v); persist({ endedAt: dtLocalToIso(v) }) }}>{P.now}</button>
                  </div>
                ) : <ReadOut value={whenOf(dtLocalToIso(endedAt))} />}
                {zeitWarn('ende')}
              </label>
              {/* ⚠️ `data-step` on the two Rückmeldung fields TOGETHER, never on the grid around
                  them: the grid also holds the Einsatzende, so the chip flashed that too and
                  pointed at a field it has nothing to say about. This is the same mistake
                  `kontaktperson` was split out of `einsatzleiter` for on 11.08. — a step has to
                  name the fields that make it go away and no others. Both halves are inside,
                  because `stepDone` wants the name AND the time (lib/abschluss). */}
              {/* ⚠️ `data-sync` on the BLOCK stands for the name field, which has no wrapper of
                  its own (PersonField takes no class); the Zeit row below carries its own marker
                  and wins for the caret, because `closest` stops at the nearest one. */}
              <div className="rz-rueck" data-step="rueckmeldung" data-sync="rueckName">
                {/* …and the same «Entfällt» the Kontaktperson has, for the Einsatz the ELZ was
                    never told about because there was nothing to tell (an Ölspur, a Fehlalarm).
                    It replaces BOTH halves, because the step wants the name AND the time and
                    neither of them exists. */}
                {meta.rueckmeldungNone ? (
                  <>
                  <div className="ip-field">
                    <span>{P.rueckmeldungLabel}</span>
                    <div className="rz-none">
                      <span className="rz-none-val">{P.entfaellt}</span>
                      {canEdit && <button type="button" className="ip-btn" onClick={() => persist({ rueckmeldungNone: undefined })}>{P.entfaelltUndo}</button>}
                    </div>
                  </div>
                  {/* ⚠️ The Zeit row STAYS. «Entfällt» used to collapse three rows into one, and
                      everything below the Rückmeldung jumped up half a card the moment it was
                      pressed — on the screen where the operator is working DOWN a form. The row
                      keeps its place and its label (damped), and its value is the same dash that
                      goes on the paper. The word is not repeated: it was answered once, one line
                      up, and saying it twice reads as two separate answers. */}
                  <div className="ip-field rz-dim">
                    <span>{P.rueckmeldungZeit}</span>
                    {/* punctuation, not language — the accessible name carries the answer */}
                    <span className="rz-none-val rz-none-dash" aria-label={P.entfaellt}>–</span>
                  </div>
                  </>
                ) : !canEdit ? (
                  <>
                  <div className="ip-field"><span>{P.rueckmeldungLabel}</span><ReadOut value={rueckName} /></div>
                  <div className="ip-field"><span>{P.rueckmeldungZeit}</span><ReadOut value={whenOf(rueckAt)} /></div>
                  </>
                ) : (
                  <>
                  {/* who reported back to the ELZ — a roster pick like Einsatzleiter, free text allowed */}
                  <PersonField
                    label={P.rueckmeldungLabel} placeholder={P.rueckmeldungName}
                    value={{ name: rueckName }} onChange={(slot) => {
                      setRueckName(slot.name)
                      persist(rueckMeta(slot.name, rueckAt))
                      // ⚠️ `presence`, NOT `el`. Whoever reported back to the ELZ was on scene to
                      // have something to report — that is all this field says. Filed as `el` it
                      // inherited the Einsatzleiter conflict check and warned «X ist Einsatzleiter
                      // und zugleich im Trupp 2» about somebody who had just made a phone call.
                      onRolePicked?.(slot.personId, 'presence')
                    }}
                    personnel={personnel} legacyRoster={[]} presentIds={presentIds}
                    assignedIds={NO_IDS} usedIds={NO_IDS} usedNames={NO_IDS}
                    rolesById={rolesById}
                    // `presence` here too (see onRolePicked above): whoever phoned the ELZ was on
                    // scene, which is all this field says — it does not make them Einsatzleiter.
                    onAddGuest={onAddGuest && ((name) => onAddGuest(name, 'presence'))}
                    rankFirst
                    // «Entfällt» at the END of the name line — the same place the Kontaktperson
                    // carries it, so the two fields that can be answered this way answer it in
                    // one gesture instead of two shapes. It replaces BOTH halves (the step wants
                    // the name AND the time, lib/abschluss), and it is only offered while the
                    // pair is still EMPTY: once something is written down, «entfällt» would
                    // contradict the line right above it.
                    trailing={!rueckName.trim() && !rueckAt ? (
                      <button type="button" className="ip-btn"
                        onClick={() => persist({ rueckmeldungElz: undefined, rueckmeldungNone: true })}>
                        {P.entfaellt}
                      </button>
                    ) : undefined}
                  />
                  <div className="ip-field" data-sync="rueckAt">
                    <span>{P.rueckmeldungZeit}</span>
                    {/* Datum + Zeit, the same control the Einsatzende uses — with «Jetzt» beside it,
                        because the ordinary case is that the call has just been made. */}
                    <div className="report-meta-end dtrow">
                      <DateTimeField ariaLabel={P.rueckmeldungZeit} value={rueckAt}
                        days={incidentDays(meta.startedAt ?? incident.started_at, renderNow)}
                        onCommit={(iso) => { setRueckAt(iso ?? ''); persist(rueckMeta(rueckName, iso ?? '')) }} />
                      <button type="button" className="ip-btn"
                        onClick={() => { const iso = serverNowIso(); setRueckAt(iso); persist(rueckMeta(rueckName, iso)) }}>{P.now}</button>
                    </div>
                    {/* the same plausibility hint the Einsatzende carries — this field has a DATE
                        wheel and is usually filled in from memory, so it is the likeliest of the
                        four to land on the wrong day */}
                    {zeitWarn('rueckmeldung')}
                  </div>
                  </>
                )}
              </div>
            </div>
            {/* Partnerorganisationen: WHO was there, from whom, reachable how — and the remark,
                which is the whole reason to write a partner down at all («Wm. Keller, übernimmt
                Verkehr ab Kreisel»). The organisation is offered from the station's list and
                stays free text, because the one that turns up is never the one on the list. */}
          </section>


          </fieldset>
          </div>

          <div className="rp-col rp-col-side">
          {/* Four SECTIONS, not four cards inside a fifth. They used to sit in an unnamed
              `.report-pre-section` wrapper — a box round a box, headed by nothing, while the
              column opposite carried named cards at the top level. Each of these already says
              what it is and how much of it there is, so the wrapper was pure nesting: a border
              weight, a padding, and a rhythm that did not match the form beside it.
              They still belong together and still read in this order (it is the printed one):
              all four answer «wer und was war da», and all four are filled in after the fact. */}
          <div className="rp-checks">
            {/* Rides with «Personal & Mittel» on a phone — it reports on what the poster wrote, which is
                Anwesenheit and Mittel. Hidden by CSS rather than by a wrapper element: the chip
                renders nothing until the first QR write, and an empty wrapper would still cost
                this flex column one gap on every Einsatz that never used the poster. */}
            <CaptureUsageChip usage={captureUsage} />
            <CheckRow
              anchor="anwesenheit" tab="werwas"
              done={stepDone('anwesenheit', facts)}
              label={A.steps.anwesenheit}
              sub={fillTemplate(A.personen, { n: attendanceCount })}
              onGo={onOpenAnwesenheit}
            >
              {/* quick double-check, not an editor: everyone recorded, early leavers
                  flagged inline — corrections go through the row's arrow (Anwesenheit) */}
              {attendanceCount > 0 && (
                <div className="rp-check-extra">
                  <div className="rp-people">
                    {rows.map((r) => (
                      <span key={r.personId} className="rp-person">
                        {r.name}
                        {/* the job they had — «Einsatzleiter», «Fahrer TLF» — read straight off
                            their Bemerkung, the same string the printed Personal-/Anwesenheits-
                            blatt puts under the name. At the end of an Einsatz this list IS the
                            check «wer war da, und als was», so the function belongs on it. */}
                        {(attendance[r.personId]?.note ?? '').trim()
                          && <i>{` · ${(attendance[r.personId]!.note ?? '').trim()}`}</i>}
                        {/* only somebody who actually LEFT gets a time. hoursRows fills an open
                            block with the Einsatzende, which put «· bis 09:00» behind every name
                            on the list — the exception it exists to flag then read as the rule. */}
                        {r.leftEarly && <em>{fillTemplate(A.leftEarly, { t: dtLocalValue(r.to!).slice(11) })}</em>}
                      </span>
                    ))}
                  </div>
                </div>
              )}
            </CheckRow>
            <CheckRow anchor="mittel" tab="werwas" done={stepDone('mittel', facts)} label={A.steps.mittel} sub={A.mittelCount(mittelCount)} onGo={onOpenMittel}>
              {mittelCount > 0 && (
                <div className="rp-check-extra">
                  <div className="rp-people">
                    {/* one line, three weights, same shape as the Anwesenheit list beside it:
                        the amount is the value (bold), the unit and the material are the thing,
                        and where it came from is the dim qualifier — «3 Sack Bindemittel · TLF».
                        It used to set amount AND unit bold and print the Quelle in full ink, so
                        four items read as one wall of equally loud text. */}
                    {visibleMittel(mittel).map((l) => (
                      <span key={l.key} className="rp-person">
                        <b>{l.menge}</b> {unitLabel(l.unit)} {l.label}
                        {l.sourceLabel && <i>{` · ${l.sourceLabel}`}</i>}
                      </span>
                    ))}
                  </div>
                </div>
              )}
              {/* ⚠️ `canEdit`, not `onComplete` (RBAC audit 22.10.2026): «Keine Mittel» is a record
                  answer the el gives like any other, not part of the editor's Abschluss — gated on
                  the Abschluss, the el's Mittel step could never be answered. A session that cannot
                  edit reads the answer, dashed like «Entfällt», or nothing when none was given. */}
              {mittelCount === 0 && !canEdit && meta.mittelConfirmedNone && (
                <div className="rp-check-extra rz-none"><span className="rz-none-val">{A.mittelNone}</span></div>
              )}
              {mittelCount === 0 && canEdit && (
                <div className="rp-check-extra">
                  {/* the «none of these» CHOICE, same as the QR-Bogen's (28.09.2026): one text,
                      picked = the choice fill. It was a primary button whose label grew a «✓». */}
                  <button
                    type="button"
                    className={`ip-btn${meta.mittelConfirmedNone ? ' on' : ''}`}
                    aria-pressed={!!meta.mittelConfirmedNone}
                    onClick={() => persist({ mittelConfirmedNone: !meta.mittelConfirmedNone })}
                  >
                    {A.mittelNone}
                  </button>
                </div>
              )}
            </CheckRow>
            {/* ⚠️ ABWEICHUNGEN (04.09., Rapport-Review). Until now a divergence between the
                QR-Bogen and a tablet was a «bitte prüfen» line in the Verlauf and nothing else —
                so the 03.09. Rapport was closed at 11:41 with three of them standing, and the
                record could not say whether anybody had looked. It is a step like the seven
                beside it, and like them it blocks nothing.
                The row does not merely ACKNOWLEDGE: it shows both values and asks which one
                holds, so the Rapport ends up with the right answer rather than only with proof
                that somebody read the warning. The card renders only while there is something to
                settle — on the ordinary Einsatz, which never produces a divergence at all, this
                whole block is absent rather than a permanently green row nobody needs. */}
            {conflicts.length > 0 && (
              <CheckRow
                anchor="abweichungen" tab="werwas"
                done={false}
                label={A.steps.abweichungen}
                sub={fillTemplate(C.attendanceConflictOpenCount, { n: conflicts.length })}
              >
                <div className="rp-check-extra rp-conf">
                  {conflicts.map((c) => (
                    <div key={c.sig} className="rp-conf-item">
                      <div className="rp-conf-head">
                        <b>{c.name}</b>
                        <span>{c.what}</span>
                      </div>
                      <div className="rp-conf-sides">
                        {c.sides.map((side, i) => (
                          <div key={i} className="rp-conf-side">
                            <h6>{sideLabel(side)}</h6>
                            {/* the value under the named source: whichever way the label came
                                out, the reader has to see WHAT they are choosing */}
                            <div className="rp-conf-val">{sideValue(side.entry)}</div>
                          </div>
                        ))}
                      </div>
                      {canEdit && onResolveConflict && (
                        <div className="rp-conf-acts">
                          {c.sides.map((side, i) => (
                            <button key={i} type="button" className="ip-btn"
                              onClick={() => onResolveConflict(c, i === 0 ? 0 : 1)}>
                              {fillTemplate(C.attendanceConflictTake, { side: sideLabel(side) })}
                            </button>
                          ))}
                          {/* the third answer, and not a lesser one: the merge may well have
                              landed right, and «geprüft, beide stimmen» is a real finding */}
                          <button type="button" className="ip-btn"
                            onClick={() => onResolveConflict(c, 'both')}>
                            {C.attendanceConflictKeep}
                          </button>
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              </CheckRow>
            )}
            {/* Partnerorganisationen sit with Anwesenheit and Mittel: all three answer «who and
                what was here», and all three are the parts of the rapport that get filled in
                after the fact. The station's own list is the choice (free text stays possible —
                the one that turns up is not always on it), and one free line beside it carries
                whatever is worth saying: «Wm. Keller, übernimmt Verkehr ab Kreisel». */}
            <CheckRow
              tab="werwas"
              /* ⚠️ the FILLED rows, not `partners.length` — the block always carries two blank
                 free rows, and counting those ticked the step off before anything was recorded */
              done={partners.some(partnerFilled)}
              label={P.partnersLabel}
              sub={partners.some(partnerFilled)
                ? partners.map((p) => p.org).filter(Boolean).join(' · ')
                : P.partnersNone}
            >
              {/* read-only: who was there, as the Anwesenheit and Mittel rows above list theirs –
                  no checkboxes to look at, no «+ Organisation» (RBAC audit 22.10.2026) */}
              {!canEdit ? partners.some(partnerFilled) && (
                <div className="rp-check-extra">
                  <div className="rp-people">
                    {partners.filter(partnerFilled).map((p, i) => {
                      const more = [p.name, p.phone, p.note].map((v) => v?.trim()).filter(Boolean).join(' · ')
                      return (
                        <span key={i} className="rp-person">
                          {p.org}{more && <i>{`${p.org ? ' · ' : ''}${more}`}</i>}
                        </span>
                      )
                    })}
                  </div>
                </div>
              ) : (
              <div className="rp-check-extra">
                {/* own gate: the sheet's main fieldset ends above the checklist, so a viewer or
                    a closed Einsatz would otherwise get fully live controls here.
                    ⚠️ `data-sync` sits on the WHOLE block, «+ Organisation» included: the button
                    adds a blank row that lives on screen and never reaches the blob, so a partner
                    list arriving from another device while the operator is still standing in that
                    row would adopt the row away under them (see useSyncedField). */}
                <fieldset className="report-fieldset rp-check-gate" disabled={!canEdit} data-sync="partners">
                  {/* A CHECKLIST, not a picker: every organisation the station works with is
                      already on the list, so the question is «war die da?» — one tap per row,
                      nothing to search, and an unticked row still proves it was considered.
                      Ticking reveals the one free line («Wm. Keller, Verkehr ab Kreisel»). */}
                  <div className="report-partners">
                    {partnerRows.map((r) => {
                      const on = r.i >= 0
                      return (
                        <div className={cx('report-partner', on && 'on', r.custom && 'free')} key={r.custom ? `c${r.i}` : r.org}>
                          {/* ⚠️ NO tick on a free row. A tick answers «war die da?» about an
                              organisation the list already names — a row somebody added by hand
                              is there BECAUSE it was there, so the box had nothing to ask and
                              unticking it silently deleted the row, a bin disguised as a
                              checkbox right next to the actual bin. It was also unlabelled, so
                              at the narrow breakpoint (where the tick claims the full row width)
                              a free row opened with an empty checkmark on a line of its own and
                              the two fields squeezed underneath — «man kann keine Organisation
                              richtig hinzufügen». Now: the field IS the row. */}
                          {!r.custom && (
                            <TickRow
                              className="report-partner-tick" checked={on} aria-label={r.org || P.partnerOrgShort}
                              onToggle={() => (on
                                ? savePartners(partners.filter((_, j) => j !== r.i))
                                : savePartners([...partners, { org: r.org }]))}
                            >
                              <span className="report-partner-org">{r.org}</span>
                            </TickRow>
                          )}
                          {/* a free-typed organisation names itself; a listed one is already named */}
                          {on && r.custom && (
                            <ClearableInput
                              className="ip-input" wrapClassName="report-partner-name" value={partners[r.i].org ?? ''}
                              placeholder={P.partnerOrgShort} aria-label={P.partnerOrgShort}
                              clearLabel={P.partnerOrgShort}
                              onChange={(v) => patchPartner(r.i, { org: stripUnprintable(v) })} maxLength={80}
                            />
                          )}
                          {on && (
                            <ClearableInput
                              /* a FREE row shares its line with the Organisation field and the
                                 bin, so the example in the long placeholder gets cut mid-word
                                 («Bemerkung (z. B. ü»). A listed row has the width for it. */
                              className="ip-input" value={partners[r.i].note ?? ''}
                              placeholder={r.custom ? P.partnerNoteShort : P.partnerNote}
                              aria-label={`${r.org || P.partnerOrgShort} – ${P.partnerNoteShort}`}
                              clearLabel={P.partnerNoteShort}
                              onChange={(v) => patchPartner(r.i, { note: stripUnprintable(v) })} maxLength={240}
                            />
                          )}
                          {on && r.custom && (
                            <button
                              type="button" className="report-att-x" aria-label={appConfig.copy.delete}
                              title={appConfig.copy.delete}
                              onClick={() => savePartners(partners.filter((_, j) => j !== r.i))}
                            ><Icon id="trash" /></button>
                          )}
                        </div>
                      )
                    })}
                  </div>
                  {/* What the Kroki already says about this question. No ✕, like the Gerettete
                      strip: an organisation that is ticked is not offered again, so the strip
                      disappears on the tap that applies it — «weg damit» and «stimmt» are the
                      same tap. Ticking here is exactly what tapping the rows above does. */}
                  {partnerHint && (
                    <div className="rz-lage-strip" role="status">
                      <span className="rz-lage-text">
                        {fillTemplate(P.partnerLageStrip, { list: partnerHint.join(' · ') })}
                      </span>
                      <Button
                        variant="primary" className="rz-lage-take"
                        onClick={() => savePartners([...partners, ...partnerHint.map((org) => ({ org }))])}
                      >
                        {P.partnerLageTake}
                      </Button>
                    </div>
                  )}
                  {/* the list covers the usual partners; the one that turns up anyway still has
                      to be recordable — a name typed here becomes the row (see addPartner and
                      commitPartner). The row appears already named; its Bemerkung and its bin
                      are the same as on any other free row. */}
                  <div className="report-partner-add">
                    <ClearableInput
                      className="ip-input" value={partnerDraft}
                      placeholder={P.partnerPlaceholder} aria-label={P.partnerAdd}
                      clearLabel={P.partnerOrgShort} maxLength={80}
                      onChange={(v) => setPartnerDraft(stripUnprintable(v))}
                      onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); commitPartner() } }}
                    />
                    <IconButton variant="secondary" onClick={commitPartner}
                      disabled={!partnerDraft.trim()} label={P.partnerAdd}>
                      <Icon id="plus" />
                    </IconButton>
                  </div>
                </fieldset>
              </div>
              )}
            </CheckRow>
            {/* Unterschriften (15.10.2026): after the Partnerorganisationen, where the Visum sits on
                the paper (ReportSignatures — the card and the sheet a line is signed in). */}
            <ReportSignatures
              closed={closed} maySign={maySign} canSign={canSign} signedLock={signedLock}
              liveSigs={liveSigs} sigValid={sigValid}
              elName={meta.einsatzleiter || einsatzleiter} kdtName={kdtDefault}
              onVoidSignatures={canEditIn ? onVoidSignatures : undefined}
              sheet={signSheet}
            />
            {/* Beilagen sit right under Partnerorganisationen: same family, same question —
                what else belongs to this rapport. Tapping a thumbnail opens the picture full-size
                (lib/ui · openPhoto), because a 52px square is not something you can check. */}
            <CheckRow
              tab="beilagen"
              done={attachments.length > 0}
              label={P.attachmentsHead}
              sub={attachments.length ? fillTemplate(P.attachmentsCount, { n: attachments.length }) : P.attachmentsNone}
            >
              {/* No explainer paragraph. «Fotos» with «Foto hinzufügen» under it is not a card
                  anybody needs a sentence for, and four lines of prose at the top of a row
                  pushed the pictures themselves below the fold. Same for the links row. */}
              <div className="rp-check-extra">
                {attachments.length > 0 && (
                  <ul className="report-att-list">
                    {attachments.map((a) => (
                      <li key={a.id} className="report-att">
                        <button
                          type="button" className="report-att-thumb" title={P.attachmentsOpen}
                          aria-label={P.attachmentsOpen}
                          onClick={() => openPhoto(a.url, { caption: a.caption, filename: `beilage-${a.id}.jpg` })}
                        >
                          {/* the small copy — a Rapport with twenty Beilagen used to decode
                              twenty full pictures (lib/mediaUrl · thumbUrl) */}
                          <img src={thumbUrl(a.url)} alt="" loading="lazy" decoding="async" />
                        </button>
                        <div className="report-att-body">
                          {/* the caption as a read-out where it cannot be changed – an empty
                              «Beschriftung» box under every photo asked a viewer to write */}
                          {!onCaptionAttachment ? a.caption?.trim() && <span className="rp-readout">{a.caption.trim()}</span> : <input
                            className="ip-input" value={a.caption ?? ''} placeholder={P.attachmentsCaption}
                            aria-label={P.attachmentsCaption}
                            // typed value goes in untouched (trimming on change eats the space
                            // you just pressed); the tidy-up happens once, on leaving the field
                            onChange={(e) => onCaptionAttachment(a.id, stripUnprintable(e.target.value))}
                            onBlur={(e) => {
                              const v = e.target.value.trim()
                              if (v !== e.target.value) onCaptionAttachment(a.id, v)
                            }}
                          />}
                          {a.url.startsWith('blob:') && <span className="report-att-pending">{P.attachmentsPending}</span>}
                        </div>
                        {onRemoveAttachment && (
                          <button type="button" className="report-att-x" aria-label={appConfig.copy.delete}
                            title={appConfig.copy.delete} onClick={() => onRemoveAttachment(a.id)}><Icon id="trash" /></button>
                        )}
                      </li>
                    ))}
                  </ul>
                )}
                {onAddAttachments && (
                  <label className="ip-btn report-row-add report-att-add">
                    <Icon id="photo" /><span>{P.attachmentsAdd}</span>
                    <input type="file" accept="image/*" multiple
                      onChange={(e) => {
                        const files = [...(e.target.files ?? [])]
                        if (files.length) onAddAttachments(files)
                        e.target.value = ''
                      }} />
                  </label>
                )}
              </div>
            </CheckRow>
            {/* …and under the Beilagen, the station's own paperwork: the Getränkeabrechnung, a
                Schadenmeldung, whatever this Wehr still has to fill in elsewhere. It belongs in
                THIS column because the column's question is «was ist noch offen» — and a form
                that has not been sent is exactly that. It never reaches the paper (the printed
                rapport is the record, not the to-do list), and where a station has configured
                none the whole card is absent rather than empty.
                ⚠️ …and absent for a session that cannot edit the Rapport (`canEditIn`, RBAC audit
                22.10.2026): the station's pre-filled forms are the editor's paperwork, and a
                viewer opening a Schadenmeldung with this Einsatz's data in it is not a read. */}
            {canEditIn && stationLinks.length > 0 && (
              <CheckRow
                tab="beilagen"
                done={linksDoneCount === stationLinks.length}
                label={P.linksHead}
                sub={fillTemplate(P.linksCount, { done: linksDoneCount, n: stationLinks.length })}
              >
                <div className="rp-check-extra">
                  <div className="rp-links">
                    {stationLinks.map((link) => {
                      const at = linksDone[link.id]
                      return (
                        <div key={link.id} className={cx('rp-link', at && 'on')}>
                          {/* tick + title are ONE target, as on the Partnerorganisationen rows —
                              a 40px checkbox beside a label is a miss waiting to happen */}
                          <TickRow
                            className="rp-link-tick" disabled={!canEdit} checked={!!at}
                            aria-label={fillTemplate(at ? P.linksMarkOpen : P.linksMarkDone, { title: link.title })}
                            onToggle={() => setLinkDone(link.id, !at)}
                          >
                            <span className="rp-link-txt">
                              <span className="rp-link-title">{link.title}</span>
                              {/* the note says WHEN this has to be filled in; once it is done the
                                  row answers the more useful question instead — when it was */}
                              {at
                                ? <span className="rp-link-note">{fillTemplate(P.linksDoneAt, { at: formatDateTime(at) })}</span>
                                : link.note?.trim() && <span className="rp-link-note">{link.note.trim()}</span>}
                            </span>
                          </TickRow>
                          <Button className="rp-link-open" icon={<Icon id="external" />} onClick={() => openLink(link)}>
                            {P.linksOpen}
                          </Button>
                        </div>
                      )
                    })}
                  </div>
                </div>
              </CheckRow>
            )}
          </div>

          {/* The Kroki, on the page. It was a modal that opened on the press of PDF / Ausdrucken,
              so the crop was chosen blind for the whole time the rapport was being written and
              then decided in a hurry, on top of a surface that had itself just stopped being a
              dialog. It sits at the END of the checklist column, below the rows worked most
              (Anwesenheit, Mittel), which it would otherwise push down by the height of a map.
              Whether a Kroki prints at all is a section, and sections live on the print action
              now — switching it off takes this panel away with it (see krokiPanel).
              No confirm step: whatever the crop shows when PDF or Ausdrucken is pressed is what
              prints, and `startOutput` remembers it as this Einsatz's framing. */}
          {/* No fold. The panel is the only thing on this page that shows what the picture will
              be, and a section that is open every time it is looked at is a section with a
              chevron in front of it for nothing. */}
          {/* ⚠️ On a phone it is MOUNTED only while its own tab is on screen — hiding it with CSS
              is not enough for this one. A MapLibre canvas created inside a `display: none` box
              is created at 0×0: the mount-time `fitBounds` runs against nothing, and when the tab
              is finally opened the map resizes without re-fitting (it is still «following», so
              nothing changed its deps) and reports that over-zoomed crop back as the Einsatz'
              framing. This panel decides what the printed Kroki shows, so a crop nobody chose is
              not a cosmetic bug. Above 600px `isPhone` is false and this is the same always-on
              panel it was. */}
          {krokiPanel && effScene && (!isPhone || phoneTab === 'beilagen') && (
            <section className="report-pre-section rp-kroki" data-tab="beilagen">
              <h3>{P.krokiHead}</h3>
              <KrokiFramingPanel
                  scene={effScene}
                  initial={options.krokiView}
                  // WHEN the picture shows. One picture is one Lage at one time; naming the
                  // moment is the honest answer to «die Rettung ist weg», and the map redraws
                  // under the crop as it is reconstructed.
                  atMs={kroki.at}
                  atBusy={kroki.busy}
                  onAtChange={kroki.setAt}
                  moments={kroki.moments}
                  startedAtMs={Date.parse(meta.startedAt ?? incident.started_at) || null}
                  landscape={options.krokiLandscape}
                  onLandscapeChange={(v) => patchOpt({ krokiLandscape: v })}
                  // the preview has to show what the sheet will show: the Trupp in a hose's end
                  // tag and the same Beschriftungen setting the export resolves captions under
                  trupps={trupps}
                  captionMode={scene?.captionMode ?? 'auto'}
                  onViewChange={(v) => patchOpt({ krokiView: v })}
                />
            </section>
          )}

          {/* ── Weitergeben ─────────────────────────────────────────────────────────────
              A section of its own (01.09.), and since 04.09. the LAST one on the page. Never on
              paper: the printed Rapport is the record, and «wer darf das hier lesen» is not part
              of it. Absent for a viewer — handing the Einsatzakte out of the station is an
              editor's decision — and absent for the `el` role too (`canShare`), which keeps the
              record but may not mint or even read a link.
              ⚠️ It used to sit between «Formulare & Links» and the Kroki, in the middle of the
              column, where a QR the size of a hand cut the checklist in two and read as a step in
              it. It is not one: handing the Einsatzakte out is what one does AFTER the rapport is
              written, so it closes the page instead of interrupting it. Nothing about the section
              itself changed — same `data-tab`, same surface, same «Teilen» sheet inline. */}
          {canShare && (
            <section className="report-pre-section rp-share" data-tab="beilagen">
              <h3>{P.shareHead}</h3>
              {/* `archived` because the Rapport is most often opened AFTER the Abschluss, and
                  the Atemschutz link is dead by then — a tab leading to a 404 belongs to nobody. */}
              <ShareIncident incidentId={incident.id} archived={incident.is_archived} />
            </section>
          )}

          </div>
        </div>

        {/* Pinned to the bottom of the surface instead of scrolling away at the end of the form.
            As a sheet the buttons WERE the end of a thing you filled in top to bottom; a page is
            not read that way — the rapport is opened mid-Einsatz to correct one time and print,
            and «PDF» sitting two screens below was the reason for every scroll to the bottom.
            Kontrolle comes with it (it is the row directly above the actions in the print order
            anyway): a warning must be read BEFORE paper is made, and pinning the button without
            pinning the warning would have made it possible to print past one without ever having
            seen it — the same failure the «never behind a fold» rule exists to prevent. */}
      </div>
    </>
  )
}
