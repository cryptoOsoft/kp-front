// Who may do what in an open Einsatz: the session's role (`useSessionRole`) and the write flags
// every surface of the workspace gates on (`workspaceFlags`). Split out of IncidentWorkspace
// (E1, 09.10.2026) with their rules — the comment on each flag IS the rule; read it before a new
// writer picks one. Device facts (phone, replay) stay with the workspace and come in as inputs.

import { useEffect, useState } from 'react'
import { LINK_REFUSED_EVENT } from '../lib/api'
import { isAtemschutzLinkKind, useAuth, type AuthUser } from '../lib/auth'
import { isIncidentRunning, type IncidentMeta } from '../lib/incidents'

/** The session's identity and role, and the one piece of state it carries: a refused link. */
export function useSessionRole(incidentMeta: IncidentMeta) {
  // Identity + permissions. Viewers get a read-only picture: they can pan / zoom /
  // inspect, but every editing affordance is hidden and commit() is neutered so
  // nothing can mutate the document (defense in depth).
  const { user, logout } = useAuth()
  /**
   * The Atemschutz-Link session (auth · AuthUser.link_kind): a link holder who may OPERATE the
   * Atemschutzüberwachung of this one Einsatz — Trupp anmelden, Eingerückt, Kontakt, Druck,
   * Rückzug, Draussen, bearbeiten, entfernen — and nothing else. It renders as «Tafel pur»
   * (the lite branch at the bottom of IncidentWorkspace), which is why the rest of the workspace
   * never has to reason about it beyond the three flags here and in `workspaceFlags`.
   */
  const asLink = isAtemschutzLinkKind(user?.link_kind)
  // ⚠️ `asLink` is NOT read-only. Its writes are real (the trupp slice of the workspace, journal
  // rows of kind 'team', `atemschutz.*` events — the backend allowlists exactly those), and
  // read-only would neuter `commit`, the journal store and the sync push alike, leaving a board
  // whose Kontakt button did nothing. What it is NOT is an editor: `isEditor`/`canEditIncident`
  // stay false, so every affordance outside the Tafel is withheld exactly as for a viewer.
  /** The `el` ROLE (Einsatzleiter function, 07.09.): the asLink pattern generalised — NOT
   *  read-only (its record writes are real: the `workspace/record` slice, journal rows,
   *  record-vocabulary events, Beilagen uploads — the backend allowlists exactly those), and
   *  NOT an editor (`isEditor`/`canEditIncident` stay false, `tacticalLocked` is permanently
   *  on, and the sync pushes only the record slice, so a local doc write could never reach
   *  the server). Distinct from `elView` (workspaceFlags), which is an EDITOR's hands-off mode. */
  const isEl = user?.role === 'el'
  /** A LINK page whose own Einsatz answered 403 (api · LINK_REFUSED_EVENT, D1): nothing it takes
   *  from here can ever be delivered, so it takes nothing — the Tafel freezes read-only and says
   *  why. Permanent for this page: a revoked link does not come back. */
  const [linkRefused, setLinkRefused] = useState(false)
  useEffect(() => {
    if (!asLink) return
    const onRefused = (e: Event) => { if ((e as CustomEvent<string>).detail === incidentMeta.id) setLinkRefused(true) }
    window.addEventListener(LINK_REFUSED_EVENT, onRefused)
    return () => window.removeEventListener(LINK_REFUSED_EVENT, onRefused)
  }, [asLink, incidentMeta.id])
  /** the session may write nothing at all (a viewer, a view link, a refused Atemschutz-Link) */
  const roleReadOnly = (user?.role !== 'editor' && !asLink && !isEl) || linkRefused
  const isEditor = user?.role === 'editor'
  // Einsatz-Link session (/l/<token>): a viewer narrowed to ONE incident. Read-only is not
  // enough here — a plain viewer may still generate the Rapport/Zeitplan PDFs and drive the
  // station printer, and all of that is refused for a link (backend/app/auth/incident_link.py).
  // Same rule as everywhere else: never show a control that will fail.
  const linkScoped = !!user?.link_scoped
  return { user, logout, asLink, isEl, linkRefused, roleReadOnly, isEditor, linkScoped }
}

export interface FlagInputs {
  user: AuthUser | null
  asLink: boolean
  isEl: boolean
  isEditor: boolean
  roleReadOnly: boolean
  forceReadOnly: boolean
  tabLockLost: boolean
  replayActive: boolean
  incidentMeta: IncidentMeta
  /** ⚠️ The Einsatz was saved by a NEWER build (lib/workspace · gateReport). This build would save
   *  it back without every key and entry it could not read — the full PUT stores what it gets
   *  (only newer board kinds are put back), the Trupp slice replaces the Trupps — so it writes
   *  nothing until the newer build is in (swUpdate · requireNewerBuild; sweep 30.10.2026 #19). */
  olderBuild: boolean
}

/** Every write flag of the workspace, derived per render from the role and the moment. Pure. */
export function workspaceFlags({ user, asLink, isEl, isEditor, roleReadOnly, forceReadOnly, tabLockLost, replayActive, incidentMeta, olderBuild }: FlagInputs) {
  const baseReadOnly = roleReadOnly || forceReadOnly || tabLockLost || olderBuild
  /** The Einsatz is still RUNNING (`isIncidentRunning`, the twin of the backend's `is_open`).
   *  ⚠️ Read LIVE off `incidentMeta`, not only at the open (N3, staging 25.09.2026): when another
   *  device closes the Einsatz, App flips this meta in place (App · onIncidentClosed) and the
   *  workspace turns into the closed view WITHOUT a remount — the operator stays on the surface
   *  they were on, every editing affordance goes, the Atemschutz clocks freeze and the alarm, the
   *  GPS pass, the presence log, the weather stamp and the Wiedervorlagen stop writing. An
   *  Einsatz opened closed (forceReadOnly) lands in the same place. */
  const running = isIncidentRunning(incidentMeta)
  const readOnly = baseReadOnly || replayActive || !running
  /** Who may DELIVER what this device already queued — the outboxes' own read-only, which is about
   *  owning the per-incident slot (a viewer, a demoted tab, a replay), NOT about the Einsatz being
   *  over. A device that hears of the close with a Kontakt still in its outbox must send it, so
   *  the server can refuse it and the store park it as «refused» (kept, exported, said out loud);
   *  a read-only store would sit on it unclassified for ever. Nothing new is queued meanwhile:
   *  every writer gates on the flags derived from `readOnly` above — except the Rapport, which a
   *  closed Einsatz still takes (`canEditRapport`), so an Einsatz opened closed out of «Alle
   *  Einsätze» (forceReadOnly) delivers too. */
  const outboxReadOnly = roleReadOnly || tabLockLost || replayActive
  // Führungsansicht: an EDITOR's hands-off mode — tactical editing locked like a phone, but
  // journal capture and read-only symbol details stay live. It belongs to the LOGIN, set by the
  // admin (Benutzer · el_view_default), and nothing else (05.10.2026, owner: «drop
  // Führungsansicht in settings. We can use users»). The per-device toggle in the Einstellungen
  // is gone; a stored `prefs.elView` from an older build is ignored (lib/prefs).
  const elView = isEditor && (user?.el_view_default ?? false)
  // «not edit anything» is broader than the tactical surfaces: EL view also locks the
  // Atemschutz / Mittel / checklist / dispatch actions that hang off this flag.
  //
  // ⚠️ `readOnly`, not `replayActive`: this used to miss `forceReadOnly`, so an ARCHIVED Einsatz
  // opened from «Alle Einsätze» — the view whose banner says «Nur ansehen – zum Bearbeiten
  // reaktivieren» — still let an editor tick a checklist, mark someone present and log Mittel.
  // The edits were saved and (correctly) badged as Nachträge, but nobody had asked for them:
  // the unlock is «Reaktivieren», deliberately, once, with its own confirm.
  const canEditIncident = isEditor && !readOnly && !elView
  /** …and the ONE slice an Atemschutz-Link may write. Everything Atemschutz-side gates on this
   *  rather than on `canEditIncident`, so the handed-over Tafel is operable while the rest of
   *  the workspace stays as read-only for it as it is for any viewer. */
  const canEditTrupps = canEditIncident || (asLink && !readOnly)
  /** «may keep the incident RECORD» — the Einsatzleiter function (07.09.): Anwesenheit (incl.
   *  Zeitplan), Mittel, Checklisten and the Rapport (incl. Beilagen). True for the `el` role
   *  AND for an editor in the Führungsansicht — the EL's view means the same thing whichever
   *  account holds the device; a plain editor has it anyway via `canEditIncident`. The
   *  backend enforces the same boundary (`workspace/record` · RECORD_WORKSPACE_KEYS), so this
   *  flag is presentation, not the protection. */
  const canEditRecord = (isEditor || isEl) && !readOnly
  /** «may correct the RAPPORT» — the record surfaces, AND the Rapport of a CLOSED Einsatz
   *  (staging r3, F10). The Abschluss promises «Spätere Korrekturen bleiben möglich und
   *  erscheinen als Nachträge», and the server takes exactly that after the close (the record
   *  keys, the `report.` events, the Verlauf rows that are not live — api/incidents ·
   *  incident_closed). The Rapport therefore stays editable once the Einsatz is closed, its
   *  changes printing as Nachträge; the Tafel, the Karte, the Anwesenheit/Mittel/Checklisten
   *  surfaces stay read-only there (their unlock is «Wieder öffnen», as decided on 28.08.). */
  const canEditRapport = canEditRecord || ((isEditor || isEl) && !running && !outboxReadOnly && !olderBuild)
  /** «may correct the EINSATZDATEN» — the dispatch facts at the head of the record: Stichwort,
   *  Kategorie, Priorität, Ort, Alarmierungszeit, Alarmmeldung, Übung. The `el` role keeps the
   *  record, so it owns the head of it too (10.09.) — the asLink pattern again: not an editor,
   *  but the one surface outside its slice it may write. The backend draws the identical line
   *  (PATCH /incidents/{id} · EL_META_FIELDS). */
  const canEditMeta = canEditIncident || (isEl && !readOnly)
  /** «may CLOSE this Einsatz» — the editors, and the `el` role (owner, 10.11.2026, EL phone sweep
   *  A2: who writes the Rapport ends the Einsatz). Not the Führungsansicht, as before. Reopening
   *  is App's `canLifecycle`, the same two; the backend draws the line in EL_LIFECYCLE_FIELDS. */
  const canCloseIncident = canEditIncident || (isEl && !readOnly)
  /**
   * «may write the incident RECORD at large» — the flag every writer that used to gate on bare
   * `readOnly` now uses.
   *
   * ⚠️ It is not `canEditIncident`. That one also excludes the Führungsansicht, where journal
   * capture and media upload deliberately stay live (see `elView`); gating these on it would
   * silently switch off half of what an EL device is for. What has to be excluded is the
   * Atemschutz-Link: it is genuinely not read-only — it operates the Tafel — but it owns
   * exactly ONE slice, and everything outside that slice is refused by the backend. Left on
   * bare `readOnly`, those writers would drain a media queue that cannot upload and dirty a
   * blob whose push carries only Trupps. (The weather log it also gated is the SERVER's since
   * 24.09.2026 — app/observations.)
   */
  const canWriteRecord = !readOnly && !asLink
  /** «this session's sync pushes the WHOLE blob» – an editor's, Führungsansicht included. The
   *  `el` pushes the record slice and the Atemschutz-Link the Trupps, so a key outside theirs
   *  written on their device stays there and drifts from the FU's (RBAC audit S4c, 22.10.2026).
   *  The MACHINE writers of such keys gate on this: the plan-binding seed (useObjectPlans ·
   *  onBind) and the floor-pack Gebäude (useGeorefFits). Hand-made tactical edits gate on
   *  `tacticalLocked`, which is stricter. */
  const canWriteBlob = isEditor && !readOnly
  // Phones edit like tablets — the tool bar is simply always there on the drawing surfaces
  // (stacked above the surface bar). Viewers and the EL-Ansicht stay hands-off; a brigade
  // that wants a view-only phone uses exactly those.
  const tacticalLocked = readOnly || elView || isEl
  return { running, readOnly, outboxReadOnly, elView, canEditIncident, canEditTrupps, canEditRecord, canEditRapport, canEditMeta, canCloseIncident, canWriteRecord, canWriteBlob, tacticalLocked }
}

/** …as the workspace reads them. A hook only so the React Compiler treats the flags as frozen:
 *  read off a plain call it assumes the object may be mutated later and skips memoising every
 *  callback that depends on `running`. */
export function useWorkspaceFlags(inputs: FlagInputs) {
  return workspaceFlags(inputs)
}
