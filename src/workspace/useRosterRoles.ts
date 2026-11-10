// The roster's side of the record: the Verlauf's vocabulary, the names, ranks and statuses the
// pickers show, the Rapport tile's target, and every door that puts somebody on the Anwesenheit
// because they were given a job — Einsatzleiter, Fahrer, a Trupp (its Gäste filed once, the crew
// a Link registered observed and filed), a name typed into a symbol's roster field. Split out of
// IncidentWorkspace (E1, 09.10.2026) verbatim; the attendance slice and its undo stay the
// workspace's (`attSet`) and come in as inputs.

import { appConfig } from '../config/appConfig'
import { apiDelete } from '../lib/api'
import { intervalsOf, isPresent, openPresence } from '../lib/attendanceIntervals'
import { stampCrewFiled, unfiledTruppCrew } from '../lib/crewFiling'
import { rosterFieldsToRefile } from '../lib/entityEdit'
import { fillTemplate } from '../lib/format'
import type { IncidentMeta } from '../lib/incidents'
import { journalVocabulary } from '../lib/journalLinks'
import { canonicalName, personIdForName } from '../lib/personnel'
import { initialRapportPage, isRapportPage, writeRapportPage } from '../lib/rapportPages'
import { mergeRoleNote, personStatusHint, roleConflictHint, rosterFieldRole, truppRoleNote, unrecordedCrewNames, type AssignableRole } from '../lib/roleAssignment'
import { toast } from '../lib/ui'
import type { Entity, TimelineEvent, Trupp, TruppFields, Person, AttendanceState, AttendanceEntry } from '../types'
import type { WorkspaceMode } from './types'
import { useEffect, useMemo, useRef, type Dispatch, type SetStateAction } from 'react'

export interface UseRosterRolesInputs {
  linkedTrupps: Trupp[]
  truppOfPerson: Map<string, string>
  pickablePersonnel: Person[]
  attendance: AttendanceState
  allTrupps: Trupp[]
  phoneFold: boolean
  /** the bar's tile opens the Rapport itself: the `el` role, a closed Einsatz (lib/rapportPages) */
  rapportFirst: boolean
  mode: WorkspaceMode
  incidentMeta: IncidentMeta
  rosterIdByName: Map<string, string>
  rosterById: Map<string, Person>
  trupps: Trupp[]
  setSelectedId: Dispatch<SetStateAction<string | null>>
  log: (icon: string, text: string, kind?: TimelineEvent['kind'], audioUrl?: string, entityId?: string, opts?: { rowId?: string; subjectId?: string }) => void
  canWriteRecord: boolean
  attSet: (update: SetStateAction<Record<string, AttendanceEntry>>, opts?: { coalesce?: ((prev: Record<string, AttendanceEntry>, next: Record<string, AttendanceEntry>) => boolean) | undefined } | undefined) => boolean
  openTruppSave: () => void
  addGuest: (name: string, note?: string, opts?: { quiet?: boolean }) => string | undefined
  replayActive: boolean
  setAttendance: Dispatch<SetStateAction<AttendanceState>>
  setTrupps: Dispatch<SetStateAction<Trupp[]>>
  createTrupp: (t0: Trupp) => void
  editTrupp: (id: string, f: TruppFields) => void
  reactivateTrupp: (id: string, f: TruppFields, standby?: boolean) => void
}

export function useRosterRoles({
  linkedTrupps, truppOfPerson, pickablePersonnel, attendance, allTrupps, phoneFold, rapportFirst, mode, incidentMeta,
  rosterIdByName, rosterById, trupps, setSelectedId, log, canWriteRecord, attSet, openTruppSave,
  addGuest, replayActive, setAttendance, setTrupps, createTrupp, editTrupp, reactivateTrupp,
}: UseRosterRolesInputs) {
  // assigning someone to a Trupp implies they're on scene — mark every roster-linked member
  // present (even at "angemeldet"). Only the newly-present are logged, so re-edits don't spam.
  /** The linkable vocabulary of this Einsatz — Mannschaft, Mittel, Partnerorganisationen,
   *  Fahrzeuge, Alarmgruppen (lib/journalLinks). ONE memo, shared by the composer and the
   *  Verlauf, so the two can never mark different things. */
  // ⚠️ The PICKABLE roster, guests included — so a Gast's name is marked in the Verlauf like
  // anybody else's. A name the composer offers but the Verlauf then refuses to mark reads as
  // the app not recognising somebody it just autocompleted.
  // …and which Trupp somebody is in right now, so the composer's chip can say «Meier Anna · Trupp 2»
  // while you type. Names only, never inserted: it answers «which of them do I mean» at that moment
  // (see journalLinks · JournalLink.hint).
  const truppNameOfPerson = useMemo(() => {
    // the NUMBER where there is one («Meier Anna · Trupp 2»), the leader's name on a record that
    // predates numbers — journalVocabulary puts the word in front either way
    const byId = new Map(linkedTrupps.map((t) => [t.id, typeof t.no === 'number' ? String(t.no) : t.name]))
    return new Map([...truppOfPerson].map(([personId, truppId]) => [personId, byId.get(truppId) ?? '']))
  }, [truppOfPerson, linkedTrupps])
  // ⚠️ …and the TRUPPS themselves, as «Trupp Meier Anna» (journalLinks · journalVocabulary). Off
  // `allTrupps`, the unfiltered slice: a Trupp that has come out or been taken off the board is
  // still named in the rows written while it was working, and those must keep their marking.
  const journalVocab = useMemo(
    () => journalVocabulary(pickablePersonnel, attendance, truppNameOfPerson, allTrupps),
    [pickablePersonnel, attendance, truppNameOfPerson, allTrupps],
  )
  // active-member names feeding the symbol detail comboboxes (Einsatzleiter / Offizier / Fahrer)
  // ⚠️ Built from the PICKABLE roster, guests included. These names fill the dropdowns on a
  // symbol («Fahrer», «Name» on the Einsatzleiter glyph), and a Nachbarwehr driver recorded
  // on the Anwesenheit could not be selected on the vehicle they were actually driving.
  const rosterNames = useMemo(() => pickablePersonnel.filter((p) => p.active).map((p) => p.displayName), [pickablePersonnel])
  // name → rank key, for the officer-first sort + "nur Offiziere" filter on leadership symbols.
  // Guests included: they carry no Dienstgrad, and an entry MISSING from this map is what tells
  // the picker to sort them by name alone — which is the right answer for a Nachbarwehr.
  const rosterRank = useMemo(
    () => Object.fromEntries(pickablePersonnel.filter((p) => p.active).map((p) => [p.displayName, p.rank])),
    [pickablePersonnel],
  )
  // present crew (attendance) — offered first in the Einsatzleiter picker (mirrors Atemschutz)
  const presentIds = useMemo(() => new Set(Object.entries(attendance).filter(([, a]) => isPresent(a)).map(([id]) => id)), [attendance])

  /**
   * PHONE: which of the Rapport's THREE pages the «Rapport» tile opens, remembered per Einsatz
   * and per device (lib/rapportPages). The three are ordinary separate surfaces — they were tried
   * as tabs of the Rapport on 18.09.2026 and thrown out the same day, because a whole surface
   * mounted under the Rapport's own tab strip stacked three navigations on one screen. What the
   * fold actually buys is a bar of five tiles whose fifth one is a DOOR to the group, plus the
   * switcher at the foot of all three pages.
   */
  useEffect(() => {
    if (phoneFold && isRapportPage(mode)) writeRapportPage(incidentMeta.id, mode)
  }, [phoneFold, mode, incidentMeta.id])
  /** where the bar's «Rapport» tile goes: the Rapport where it comes first (`rapportFirst`), else
   *  back to the page this device left the group on, else the first-open rule (nobody present
   *  yet → Anwesenheit, else the Rapport itself). */
  const rapportTarget = useMemo(
    // ⚠️ INSIDE the group the target is the page already showing: the memory is written by the
    // effect above, i.e. AFTER this render, so reading it here named the page just left and the
    // lit tile bounced between the last two pages. The memory only answers a tap from outside.
    () => (isRapportPage(mode) ? mode : initialRapportPage({ incidentId: incidentMeta.id, presentCount: presentIds.size, rapportFirst })),
    [incidentMeta.id, presentIds.size, mode, rapportFirst],
  )

  /** What is already known about a roster NAME — «unter AS», «Magazin», «gegangen». Shown on
   *  the dropdown entry itself (see roleAssignment · personStatusHint). */
  const personStatus = (name: string) => {
    const id = personIdForName(rosterIdByName, name)
    const hint = personStatusHint(id, attendance, linkedTrupps)
    // …and whether they are one of ours at all. A Gast is offered in these dropdowns like anybody
    // else (lib/guests), so the list has to SAY so — the same word the Anwesenheit badges them
    // with. Leads whatever else is known: «Gast» changes who you think you are picking.
    if (!(id && rosterById.get(id)?.guest)) return hint
    const gast = appConfig.copy.anwesenheit.guestBadge
    return { label: hint ? `${gast} · ${hint.label}` : gast, tone: hint?.tone ?? 'info' as const }
  }
  /** …and the contradiction a FILLED roster field already carries, per field key. ⚠️ This used
   *  to be a toast fired once at assignment time: it appeared after the pick and then went away,
   *  so the field it was about never said anything. */
  const rosterFieldHints = (e: Entity | undefined): Record<string, string | undefined> | undefined => {
    if (!e || e.kind !== 'symbol') return undefined
    const out: Record<string, string | undefined> = {}
    for (const [key, val] of Object.entries(e.fields ?? {})) {
      const name = (val ?? '').trim()
      if (!name || !ROSTER_FIELDS.includes(key)) continue
      const role = rosterFieldRole(e.symbol, key, e.label)
      const id = personIdForName(rosterIdByName, name)
      out[key] = roleConflictHint(id, role.role, name, attendance, trupps)
    }
    return out
  }

  /**
   * Being given a job on this Einsatz puts you on the Anwesenheit list. Whoever is named as
   * Einsatzleiter, put in a Trupp or entered as the Fahrer of a vehicle IS on scene; a rapport
   * that names somebody the attendance sheet has never heard of contradicts itself, and the
   * contradiction goes to the Gemeinde on paper.
   *
   * `roleNote` additionally fills that person's Bemerkung («Fahrer TLF», «Einsatzleiter») — the
   * field whose placeholder has always advertised exactly this and which nothing ever wrote. Only
   * onto an EMPTY remark: what somebody typed there by hand outranks anything derived.
   */
  /**
   * Clear a crew member's self-reported position from the command post. The dot's entity id is
   * `pos-<personId>` (lib/usePersonPositions), which is the only handle the panel has.
   *
   * No `device` on the request: that parameter scopes the delete to ONE phone, which is right
   * for «nicht mehr teilen» pressed on that phone and useless here — the whole point is that the
   * phone is not reachable (driven home, flat battery). The backend requires an editor for the
   * device-less form.
   */
  const stopPersonSharing = async (entityId: string) => {
    const personId = entityId.replace(/^pos-/, '')
    try {
      await apiDelete(`/api/incidents/${incidentMeta.id}/positions/${personId}`)
      setSelectedId(null)
      log('people', appConfig.copy.contextPanel.stopSharing, 'team')
    } catch {
      toast(appConfig.copy.contextPanel.stopSharingFailed, { icon: 'warn', tone: 'warn' })
    }
  }

  /** `groupTemplate` folds the per-person rows into ONE line naming the whole crew — see the
   *  Trupp caller below for why. It is the TEMPLATE and not a flag because the two kinds of Trupp
   *  read differently: «Unter AS: …» is a sentence, «Unter Trupp: …» is not.
   *  `noteFor` overrides the Funktion for ONE of them — the Gruppenführer's «AS-GF» beside his
   *  crew's «AS» (lib/roleAssignment · truppRoleNote). Only the note differs: the crew line still
   *  names the whole Trupp under its own Funktion, because that is the fact being recorded. */
  const ensurePresentForRole = (
    ids: (string | undefined)[], roleNote?: string, groupTemplate?: string,
    noteFor?: (id: string) => string | undefined,
    /** Gäste the Trupp form filed a moment ago in the SAME act (fileTruppGuest): already present
     *  — this render's `attendance` cannot know it yet — and named by the name they were filed
     *  under, never by their id (staging N1: «Unter AS: g1790338070425-0etoa, …»). */
    justFiled?: ReadonlyMap<string, string>,
  ) => {
    // Not on an Atemschutz-Link session: its Anwesenheit write is a no-op (the slice never
    // carries attendance), and a Verlauf row claiming «anwesend · AS» over a record that never
    // changed would be a lie on paper. The tablet marks the crew present when it takes the Trupp.
    if (!canWriteRecord) return
    const wanted = [...new Set(ids.filter(Boolean) as string[])]
    const fresh = wanted.filter((id) => !justFiled?.has(id) && !isPresent(attendance[id]))
    const nameOf = (id: string) => justFiled?.get(id) ?? rosterById.get(id)?.displayName ?? attendance[id]?.displayNameSnapshot ?? id
    // ⚠️ APPEND, don't fill-if-empty: one person routinely holds two jobs, and the Fahrer who
    // then goes under Atemschutz is «Fahrer Pio, AS». See lib/roleAssignment · mergeRoleNote for
    // when a part replaces an earlier one instead of joining it.
    const noteOf = (id: string) => noteFor?.(id) ?? roleNote
    const needNote = roleNote
      ? wanted.filter((id) => mergeRoleNote(attendance[id]?.note, noteOf(id)!) !== (attendance[id]?.note ?? '').trim())
      : []
    if (!fresh.length && !needNote.length) return
    // through the history, like every other write to this slice — being made Fahrer or EL puts
    // somebody on the Anwesenheit, and «that was the wrong name» is the same mistake as a tap
    attSet((cur) => {
      const next = { ...cur }
      for (const id of fresh) {
        const name = rosterById.get(id)?.displayName ?? cur[id]?.displayNameSnapshot ?? id
        // being given the job opens a presence block: the alarm time for a first one, the real
        // clock for someone who had already left and is being sent out again
        const at = intervalsOf(cur[id]).length ? new Date().toISOString() : incidentMeta.started_at
        next[id] = openPresence(cur[id], at, name)
      }
      // …stamped, so «wer ist jetzt EL» has an answer that does not depend on a sort order
      // (types · AttendanceEntry.noteAt)
      const at = new Date().toISOString()
      for (const id of needNote) if (next[id]) next[id] = { ...next[id], note: mergeRoleNote(next[id].note, noteOf(id)!), noteAt: at }
      return next
    })
    // ONE row per person, not one for the presence and a second for the remark: naming a Fahrer
    // is a single act, and «Meier Anna anwesend» followed by «Meier Anna – Bemerkung: Fahrer TLF»
    // reads like two things happened to her.
    const A = appConfig.copy.anwesenheit
    const noted = new Set(needNote)
    // ── ONE row for a whole crew (01.09.) ──
    // A Trupp of three wrote three near-identical lines — «X – Bemerkung: AS» ×3 — under the
    // Trupp's own rows, which is three quarters of a screen at 3am saying one thing. Worse, the
    // word was wrong: nobody remarked anything, the app filled a Funktion. The names are what a
    // reader is after, so they go on one line and the field they came from is not mentioned.
    if (groupTemplate && roleNote) {
      const named = wanted
        .filter((id) => fresh.includes(id) || noted.has(id))
        .map(nameOf)
      if (named.length) log('people', fillTemplate(groupTemplate, { role: roleNote, list: named.join(', ') }), 'team')
      return
    }
    for (const id of fresh) {
      const name = rosterById.get(id)?.displayName ?? id
      log('people', noted.has(id) && roleNote
        ? fillTemplate(A.logPresentAs, { name, role: noteOf(id)! })
        : `${name} anwesend`, 'team')
    }
    // somebody already on the list who has just been given the job: the role is the news
    for (const id of needNote) {
      if (fresh.includes(id)) continue
      log('people', fillTemplate(A.logNote, { name: rosterById.get(id)?.displayName ?? id, note: noteOf(id) ?? '–' }), 'team')
    }
  }
  /** ⚠️ Being in a Trupp is a JOB, and the Anwesenheit should say so. It marked the crew present
   *  and wrote nothing, so the list — and the Personalblatt printed from it — could not tell an
   *  AdF who stood at the Magazin from one who was under Atemschutz. The link already existed in
   *  one direction (the Trupp picker says «unter AS» about somebody on the list); this is the
   *  same fact read the other way round. Like every auto-Bemerkung it only fills an EMPTY one,
   *  so anything typed by hand survives.
   *
   *  ⚠️ …and the crew typed BY HAND, which this used to miss entirely (field report 02.09.). The
   *  Trupp form's «Name eingeben (Gast/Nachbarwehr)» records a display name and no roster id, so
   *  the id list above never saw that person: a Gast who had been under Atemschutz for the whole
   *  Einsatz was absent from the Anwesenheit, from the headcount and from the Personalblatt
   *  printed off it. Same route a typed name on a symbol has always taken (assignTypedName):
   *  known to the roster → the person they are, unknown → a Gast row on THIS Einsatz. */
  /* ⚠️ …and the Funktion says WHICH KIND of Trupp (04.09., Feldtest). Every crew member used to
   *  be filed as «AS», the Verkehrstrupp included — and the Verlauf prints that Bemerkung behind
   *  the name on its first mention (lib/journalLinks), so a row about a Trupp without Atemschutz
   *  read «Müller Hans (AS)»: a statement about where somebody was, on the surface the
   *  Personalblatt is printed from. The list itself has drawn the distinction since 03.09.
   *  («unter AS» / «im Trupp»); this is the same fact written onto the row.
   *  ⚠️ …and the GRUPPENFÜHRER gets the «-GF» variant of it, wherever his name came from: the
   *  picker (`leaderPersonId`) or the keyboard (the first name `unrecordedCrewNames` returns is
   *  `f.name`, which IS the leader — see types · Trupp.name). */
  const ensurePresentFromTrupp = (f: Pick<TruppFields, 'name' | 'members' | 'leaderPersonId' | 'memberPersonIds' | 'kind'>) => {
    /* ⚠️ Not on a session that cannot write the record (staging N2, 25.09.2026): on the
       Atemschutz-Link every write below was a no-op while `addGuest` still logged «… als weitere
       Person erfasst» — a line claiming a record that never changed. An editor device files that
       crew when it SEES the Trupp (the observer effect below, lib/crewFiling). */
    if (!canWriteRecord) { filedGuestsRef.current = new Map(); return }
    const { role, leaderRole, groupTemplate } = truppRoleNote(f)
    // the Gäste the form's save filed a moment ago (fileTruppGuest) — this render's attendance
    // does not hold them yet, and read from it they were filed a SECOND time (staging N1)
    const filed = filedGuestsRef.current
    filedGuestsRef.current = new Map()
    const ids = [f.leaderPersonId, ...(f.memberPersonIds ?? [])]
    ensurePresentForRole(ids, role, groupTemplate, (id) => (id === f.leaderPersonId ? leaderRole : undefined), filed)
    // 'presence': being in a Trupp contradicts nothing — the conflict check is about somebody
    // holding a SECOND job (lib/roleAssignment · roleConflictHint)
    const lead = f.name.trim()
    const filedIdOf = (n: string) => [...filed].find(([, nm]) => nm === n)?.[0]
    for (const name of unrecordedCrewNames(f, (n) => filedIdOf(n) ?? personIdForName(rosterIdByName, n))) {
      assignTypedName(name, 'presence', name === lead ? leaderRole : role)
    }
  }
  /** The Trupp form's Gast door (TruppForm · fileGuests), called at the SAVE.
   *  A name the Mannschaft knows is that person; any other is a Gast row, filed QUIETLY — the
   *  crew's one «Unter AS: …» row that `ensurePresentFromTrupp` writes right after names them
   *  all — and remembered for that call (staging N1: one person, one row, one line). */
  const filedGuestsRef = useRef<Map<string, string>>(new Map())
  const fileTruppGuest = (name: string): string | undefined => {
    openTruppSave()
    const known = personIdForName(rosterIdByName, name)
    if (known) return known
    const id = addGuest(name, undefined, { quiet: true })
    if (id) filedGuestsRef.current.set(id, name)
    return id
  }
  /* ── A crew registered where the record cannot be written reaches it anyway (staging N2) ──
     An Atemschutz-Link may write the Trupps and nothing else, so its crew — Gäste above all —
     never reached the Anwesenheit. Every device that MAY write the record OBSERVES the Trupps and
     files what is missing under ids every device derives the same way (lib/crewFiling), so two
     tablets converge on one row per person and one Verlauf line per Trupp. A machine write: raw
     `setAttendance`, never the undo timeline, and idempotent — once filed, nothing is left to
     file (lib/useGpsFollow · a machine writer writes nothing when nothing changed).
     ⚠️ ONE-SHOT per (Trupp, person): the Trupp's `crewFiled` marker is stamped in the same pass,
     for the people filed now AND those already on the list, so somebody taken OFF the Anwesenheit
     later stays off on every device (types · Trupp.crewFiled). */
  useEffect(() => {
    if (!canWriteRecord || replayActive || incidentMeta.is_archived) return
    const todo = unfiledTruppCrew(allTrupps, attendance, (n) => personIdForName(rosterIdByName, n))
    if (!todo.length) return
    const files = todo.filter((f) => f.entries.length)
    if (files.length) {
      setAttendance((cur) => {
        let next = cur
        for (const f of files) for (const e of f.entries) {
          if (next[e.id]) continue
          next = next === cur ? { ...cur } : next
          next[e.id] = { ...openPresence(undefined, incidentMeta.started_at, e.name), note: e.note }
        }
        return next
      })
    }
    setTrupps((ts) => stampCrewFiled(ts, todo))
    for (const f of files) {
      log('people', fillTemplate(f.groupTemplate, { role: f.role, list: f.entries.map((e) => e.name).join(', ') }), 'team',
        undefined, undefined, { rowId: f.rowId })
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [allTrupps, attendance, canWriteRecord, replayActive, incidentMeta.is_archived])

  /** Assign a role: presence + Bemerkung, and the hint if it contradicts the record (lib ·
   *  roleAssignment). The hint never blocks — it is shown after the assignment went through. */
  const assignRole = (personId: string | undefined, role: AssignableRole, note?: string) => {
    if (!personId) return
    const name = rosterById.get(personId)?.displayName ?? attendance[personId]?.displayNameSnapshot ?? personId
    const hint = roleConflictHint(personId, role, name, attendance, trupps)
    ensurePresentForRole([personId], note)
    if (hint) toast(hint, { icon: 'warn', tone: 'warn' })
  }

  /**
   * The id a HAND-TYPED name is filed under, given the job it was typed into — the one thing
   * every person field needs and only two of them used to have.
   *
   * Typing a name is the normal way a Nachbarwehr, a Gast or an AdF whose roster row never
   * synced gets onto this Einsatz. Only the Anwesenheit's «Weitere Person» and the Trupp form
   * recorded one; everywhere else the name stopped on the object it was typed on — a Fahrer on a
   * vehicle, a Stv. on the Einsatzleiter glyph, the Einsatzleiter on the Rapport — so an Einsatz
   * could be led by somebody the Anwesenheit, the Personalblatt and the Soldblatt printed from it
   * had never heard of.
   *
   * ⚠️ Resolve BEFORE recording. The pickable roster already holds this Einsatz's guests, so
   * naming the same Nachbarwehr driver on a second vehicle finds the row they already have
   * rather than opening a second one under the same name.
   *
   * ⚠️ And a NEW Gast gets the job from `addGuest` itself, not from a role assignment afterwards:
   * their row does not exist yet in this render's `attendance`/`rosterById`, so the assignment
   * would mark a stranger present and write their raw id into the Verlauf.
   */
  const assignTypedName = (name: string, role: AssignableRole, note?: string): string | undefined => {
    const known = personIdForName(rosterIdByName, name)
    if (!known) return addGuest(name, note)
    assignRole(known, role, note)
    return known
  }

  /**
   * A name typed into a symbol's roster field («Fahrer» on the TLF, «Name»/«Stv.» on the
   * Einsatzleiter glyph) is a job handed to somebody who is standing there. It used to live
   * ONLY on the entity: the Rapport, the Anwesenheit and the Soldblatt never learned about it,
   * and the operator entered the same person twice. Only fields that CHANGED are considered —
   * re-rendering the panel must not re-open a presence block somebody closed on purpose.
   */
  const ROSTER_FIELDS: readonly string[] = appConfig.symbols.rosterFields
  const linkRosterFields = (prev: Entity, fields: Record<string, string>, opts?: { force?: boolean }) => {
    // ⚠️ Which fields actually moved is a decision with edge cases (a seeded blank is not a
    // change; a changed FUNKTION has to re-file the name beside it), so it lives in
    // lib/entityEdit · rosterFieldsToRefile with its own tests rather than inline here.
    for (const { key: k, value: v } of rosterFieldsToRefile(prev.fields, fields, ROSTER_FIELDS, opts)) {
      // which job this field hands out, and what it writes into the Bemerkung — lib ·
      // roleAssignment, so «Fahrer TLF» / «Einsatzleiter» / «Stv. Einsatzleiter» is one
      // decision with tests rather than a chain of conditions inside the workspace
      const { role, note } = rosterFieldRole(prev.symbol, k, prev.label, fields)
      // ⚠️ …and a name the Mannschaftsliste has never heard of is a Gast, recorded as one
      // rather than dropped: it was typed onto a symbol because that person is standing there.
      assignTypedName(v, role, note)
    }
  }

  /** Edit a Karte-owned symbol through the projection shown on a linked Modul. This is the map
   *  editor's normal mutation path, including its single-step live title edit and roster side
   *  effects; only the pointer happened to start on the plan. */

  /**
   * The roster's spelling of every name on a Trupp, applied ON THE WAY IN.
   *
   * ⚠️ The Trupp's name is what the rest of the app draws from — the card, the hose tag, the
   * Kroki chip (through `abbreviateName`, which reads the station's name order to decide which
   * token is the surname) and the bold in the Verlauf. Typed «Hans Müller» where the roster says
   * «Müller Hans», all four disagreed at once: one Kroki carrying «Müller H.» beside «Peter S.»,
   * and a Verlauf marking one Trupp's leader and not the other's. The name resolves to the same
   * person either way (lib/personnel · personIdForName) — so it may as well be written down the
   * way the person is spelled everywhere else. A real Gast matches nobody and is left alone.
   */
  const canonTrupp = <T extends TruppFields | Trupp>(t: T): T => ({
    ...t,
    name: canonicalName(t.name, rosterIdByName, rosterById),
    members: t.members?.map((m) => canonicalName(m, rosterIdByName, rosterById)),
  })
  // ⚠️ The CANONICALISED crew reaches the Anwesenheit too, not the raw form values: a Gast row is
  // opened under the name that is written down everywhere else, so «Hans Müller» typed into the
  // Trupp form cannot open a second row beside the roster's «Müller Hans».
  // ⚠️ Each is ONE step on the timeline with the crew filing it causes (openTruppSave).
  const createTruppA = (t: Trupp) => { openTruppSave(); const c = canonTrupp(t); createTrupp(c); ensurePresentFromTrupp(c) }
  const editTruppA = (id: string, f: TruppFields) => { openTruppSave(); const c = canonTrupp(f); editTrupp(id, c); ensurePresentFromTrupp(c) }
  // `standby` MUST be forwarded: this wrapper used to swallow it, so «Bereitstellen» ran the
  // «Wieder einrücken» path — a crew standing at the vehicle with a running contact clock, which
  // is exactly the case the standby fork exists to prevent (see useTruppActions · reactivateTrupp).
  const reactivateTruppA = (id: string, f: TruppFields, standby?: boolean) => { openTruppSave(); const c = canonTrupp(f); reactivateTrupp(id, c, standby); ensurePresentFromTrupp(c) }
  return { fileTruppGuest, createTruppA, editTruppA, reactivateTruppA, presentIds, rapportTarget, linkRosterFields, rosterNames, rosterRank, personStatus, rosterFieldHints, stopPersonSharing, assignTypedName, assignRole, journalVocab }
}
