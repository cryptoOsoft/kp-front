// The Trupp form – create / edit / re-deploy, one screen or the phone's three-section stack (see
// `TruppForm`). Rendered by AtemschutzView, which owns the save (`submitForm`) and the questions
// in front of it. Rules for this area: docs/atemschutz-board.md.

import { useEffect, useMemo, useRef, useState, type FocusEvent as ReactFocusEvent, type ReactNode } from 'react'
import { Icon } from '../lib/icons'
import { appConfig } from '../config/appConfig'
import { fillTemplate, stripUnprintable } from '../lib/format'
import { confirmDialog } from '../lib/ui'
import { cx } from '../lib/cx'
import { Segmented } from './Segmented'
import { Chip } from './Chip'
import { Overlay, SheetFoot, SheetGrab } from '../lib/overlays'
import { entryPressureAsks, truppFieldGroupsChanged, type TruppFieldGroup, isAtemschutzTrupp, type TruppTransferState } from '../lib/atemschutz'
import { serverNow } from '../lib/serverClock'
import type { Person, Trupp, TruppAuftrag, TruppFields, TruppKind } from '../types'
import { personIdForName, rosterFromList, rosterIdByName, truppSlots } from '../lib/personnel'
import { type LeitungOption } from '../lib/truppLines'
import { ClearableInput } from './ClearableInput'
import type { Slot } from './PersonField'
import { TruppTeam } from './TruppTeam'
import { UnitVal } from './TruppCard'
import { atemschutzDoctrine, atemschutzEquipment } from '../lib/deploymentConfig'
import { keepDraft, useKeptState } from '../lib/draftKeep'
import s from './Atemschutz.module.css'
import { KanalPickSheet, LeitungField, PressureSheet, TeamConflictRow } from './TruppSheets'
import { fileGuestSlots, teamConflict, truppSheetSub } from '../lib/truppQuickEdit'
import { crewAfterChange, type CrewChange } from '../lib/truppLeader'
import { rankOrder } from '../lib/rank'
import { pointAtField } from '../lib/pointAtField'

const cfg = appConfig.atemschutz // static, non-doctrine parts only (the two auftrag lists)
// `az` (appConfig.copy.atemschutz) and the doctrine numbers (`atemschutzDoctrine()`) are read
// at the top of each component/helper below rather than captured here at module-load, so the
// locale AND the deployment config resolved at boot apply.

export type FormMode = 'create' | 'edit' | 'redeploy'

/** re-entry within this many minutes of the Austritt asks «gleiche oder neue Flasche?» */
const BOTTLE_ASK_MIN = 10

/** What the Trupp form hands the board besides its fields: the groups the operator touched (an
 *  edit writes only those) and the door that files its Gäste, called once every question in
 *  front of the save is answered (AtemschutzView · submitForm). */
export type TruppSubmitExtra = {
  touched: TruppFieldGroup[]
  fileGuests: () => Pick<TruppFields, 'leaderPersonId' | 'memberPersonIds'>
}

// (`PressureStepper` and `FunkkanalStepper`, the form's ± steppers, went on 30.09.2026: the form's
// rows open the Druck sheet's grid and the Kanal sheet's pad — TruppSheets · PressureSheet /
// KanalPickSheet, where the Kanal stepper lives on for a range too wide for a pad.)
/**
 * ONE shared form for create / edit / re-deploy, in one of two shapes.
 *
 * ⚠️ The rule used to be «single screen, never a wizard» (3am tenet). It is now narrower than
 * that, because the screen it was written for is not the only one any more — but the WIZARD is
 * gone again (04.09.), and what replaced it is closer to the original rule than the two steps
 * ever were:
 *   · On anything with room — tablet, desktop — it is ONE screen. Nothing is behind a section,
 *     nothing has to be walked to, and the whole Trupp is visible while it is being formed.
 *   · On a PHONE it is a STACK of three sections (`stack`): Mannschaft · Luft & Funk · Auftrag &
 *     Leitung. All three are on screen at all times; exactly one is open and the other two read
 *     their own answers out beside their titles («Unter Atemschutz · 300 bar · Kanal 5»), so the
 *     closed stack IS the form rather than a table of contents for it. Sections can be opened in
 *     any order and closed again — three answered lines is a legitimate, and useful, state.
 *   · ⚠️ It was a two-STEP wizard from 02.09. to 04.09., and the reason it went is not that the
 *     fold it fixed came back — it did not. It is that the wizard grew its OWN fold: step 2
 *     carried seven fields (Art · Druck · Kanal · Auftrag · Ziel · Leitung · Farbe) and ran off
 *     the bottom of a 375px screen, while the common Trupp — GF + 2, full cylinder, default
 *     channel — still had to walk a «Weiter» that asked nothing it had not already answered. The
 *     stack has no step to walk and no fold to fall off: what does not fit scrolls, and the one
 *     control that starts the Trupp is pinned in the footer the whole time.
 *   · ⚠️ EVERY kind of Trupp gets the same three sections (03.09., and unchanged by the rework).
 *     The Art may add or drop the Druck row inside «Luft & Funk» — ordinary form behaviour — but
 *     it must never change the SHAPE of the form. Collapsing to one screen under the thumb that
 *     had just tapped «Ohne Atemschutz» was the jarring part, not the length of a step.
 *   · ⚠️ «Art des Trupps» rides with the fields it GOVERNS (03.09.): on one screen it spans the
 *     form above both columns, on the stack it leads «Luft & Funk». Section 1 is the Mannschaft
 *     alone, because who is in the Trupp is the one thing the Art does not decide.
 *
 * Leads with the AUFTRAG (what the Trupp is sent to do — the order you check them against on every
 * Kontakt), then the Trupp; the Druck section belongs to Atemschutz alone, and «Art des Trupps»
 * is asked once, at creation, because it cannot be changed afterwards (types · Trupp.kind).
 *
 * ⚠️ There is NO colour picker any more (04.09.), on any layout. The colour is still per-Trupp
 * and still automatic — the field simply stopped being asked; see `color` in `submit`.
 */

/** What a kept edit / re-entry draft belongs to (TruppForm · draftKey): the sortie and every field
 *  the form writes, as one short string. Pure; the draft store is per session and per incident. */
function truppDraftStamp(t: Trupp): string {
  const last = t.readings?.[t.readings.length - 1]
  const s = JSON.stringify([t.status, t.entryTime, t.exitTime ?? '', last?.t ?? '', last?.kind ?? '',
    t.name, t.members ?? [], t.auftrag ?? '', t.ziel ?? '', t.lineNo ?? null, t.lineNumber ?? '', t.funkkanal ?? null,
    t.entryPressureBar, t.kind ?? '', t.equipment ?? []])
  // FNV-1a — only has to tell two states apart, never to be read
  let h = 0x811c9dc5
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193) }
  return (h >>> 0).toString(36)
}

export function TruppForm({
  mode, initial, presetAuftrag, focusSection, roster, defaultFunkkanal, personnel, presentIds, stationIds, assignedIds, transferState, onTransfer, rolesById, leitungOptions, lite = false, stack = false, sheet = false, pinned, onAddGuest, onCancel, onSubmit,
}: {
  mode: FormMode
  initial?: Trupp
  /** a NEW Trupp's Auftrag, chosen by the door it came through — «Sicherungstrupp bestimmen»
   *  opens the form on «Sichern» (24.09.2026). Ignored for edit/redeploy, which have their own. */
  presetAuftrag?: TruppAuftrag
  /** A card gap opened this form — point directly at the field that resolves it. */
  focusSection?: 'auftrag'
  roster: string[]
  defaultFunkkanal: number
  personnel: Person[]
  presentIds: Set<string>
  stationIds: Set<string>
  assignedIds: Set<string>
  /** …and whether the double assignment can be UNDONE from here: `ready` earns the warning its
   *  «In diesen Trupp verschieben», `deployed` says instead that the other crew is out there,
   *  `blocked` leaves the plain sentence (lib/atemschutz · truppTransferState). */
  transferState?: (personId: string) => TruppTransferState
  /** move that person out of the Trupp they are still in — `toName` is the Gruppenführer this
   *  form is forming, so the other Trupp's Verlauf row can say where they went */
  onTransfer?: (personId: string, toName: string) => void
  /** who already holds a job on this Einsatz (Anwesenheits-Bemerkung), so the picker can say
   *  «schon: Einsatzleiter» beside a name — a hint, never a block */
  rolesById: Map<string, string>
  onCancel: () => void
  /** the Leitungen drawn on either surface (lib/truppLines · leitungOptions) — offered as
   *  quick-picks so the number is chosen from what exists, not typed blind */
  leitungOptions: LeitungOption[]
  /** the handed-over «Tafel pur» (see AtemschutzView · lite): drops the ENTIRE Ltg-Nr. row
   *  (reverted, round 2 review — briefly shown 02.09.) and the «Art des Trupps» chooser. A link
   *  holder has no picture to read a hose number off and no surface to draw one on, so the field
   *  could only ever be a number typed blind — and one Leitung, one Trupp is enforced against
   *  what is actually drawn regardless (see submitForm's takeover confirm). The FU sets it on
   *  the KP tablet. (It used to drop the Farbe picker too; there is no picker any more.) */
  lite?: boolean
  /** three sections instead of one scroll — set for ANY phone, and for any Art of Trupp. See the
   *  two-shapes note above the component: nothing about the Art may change the SHAPE of the
   *  form, only what «Luft & Funk» contains. */
  stack?: boolean
  /** The phone board's frame (24.09.2026, D1 ⑥): a BOTTOM SHEET instead of the full-screen form,
   *  so the due clocks stay in view above it. With it come the grab bar and push-down-to-close —
   *  it is a real bottom sheet now (docs/ui-conventions.md · Overlays), and closing it that way is «not now»:
   *  every entry is kept (draftKeep) until «Abbrechen» or the save. */
  sheet?: boolean
  /** the due / overdue Trupps pinned ABOVE the sheet (AtemschutzView · pinnedRows), or nothing */
  pinned?: ReactNode
  /** record a hand-typed Gast on the Anwesenheit as well — being put in a Trupp IS being here */
  onAddGuest?: (name: string) => string | undefined
  /** `standby` (re-deploy only) parks the Trupp as Reserve instead of sending it straight in */
  /** resolves `true` once the Trupp is written — the draft is dropped only then */
  onSubmit: (f: TruppFields, standby?: boolean, extra?: TruppSubmitExtra) => Promise<boolean> | void
}) {
  const az = appConfig.copy.atemschutz // read per-render so the resolved locale applies
  // ⚠️ The typed Trupp survives a mis-tap. Only «Abbrechen» throws it away — an ✕ or a tap on
  // the backdrop is «not now», and losing three names and a Ziel to a fat finger at 3am is the
  // expensive half of that pair (see lib/draftKeep, the same rule the Gast name follows).
  /* ⚠️ …but a draft belongs to ONE state of the Trupp (review 25.09.2026). Keyed on the id alone,
   * a re-entry abandoned after one sortie handed its «Gleiche Flasche · 120 bar» to the NEXT
   * sortie's re-entry, and an edit draft wrote back a Leitung somebody had linked on the Karte in
   * between. So an edit / re-entry draft is keyed on the Trupp as the form opened it — its
   * sortie (status, Eintritt, Austritt, last log row) and every field the form writes
   * (`truppDraftStamp`): anything that changed since makes it a fresh form. A new Trupp has no
   * such state, and its draft stays keyed on «new». */
  const draftKey = `atemschutz:trupp:${mode}:${initial ? `${initial.id}:${truppDraftStamp(initial)}` : 'new'}`
  /* «Sicherungstrupp bestimmen» opens the create form on «Sichern» (`presetAuftrag`) — and that
   * door is the answer, so it wins over a kept create draft's Auftrag. Written into the draft
   * store BEFORE the Auftrag's own state reads it (a lazy initializer runs once, at mount). */
  useState(() => { if (mode === 'create' && presetAuftrag) keepDraft(`${draftKey}:auftrag`, presetAuftrag); return 0 })
  // The two roster indexes the slot resolution needs: name → id, and id → Person (to check that
  // a stored positional id really belongs to the name beside it — see lib/personnel · truppSlots).
  const rosterByName = useMemo(() => rosterIdByName(personnel), [personnel])
  const rosterById = useMemo(() => rosterFromList(personnel), [personnel])

  const [auftrag, setAuftrag, clearAuftrag] = useKeptState<Trupp['auftrag'] | null>(`${draftKey}:auftrag`, initial?.auftrag ?? presetAuftrag ?? null)
  const [ziel, setZiel, clearZiel] = useKeptState(`${draftKey}:ziel`, initial?.ziel ?? '')
  // Ausrüstung (types · Trupp.equipment): the ids ticked, kept as a draft like the Auftrag. Only
  // a Trupp under Atemschutz is asked (see `equipmentField`); the list is the station's.
  const [equipment, setEquipment, clearEquipment] = useKeptState<string[]>(`${draftKey}:equipment`, initial?.equipment ?? [])
  const toggleEquipment = (id: string) =>
    setEquipment(equipment.includes(id) ? equipment.filter((x) => x !== id) : [...equipment, id])
  // Leitung: numeric since 2026-08-05. A Trupp carrying only the old free text starts empty and
  // keeps that text visible underneath — the record stays as its Überwacher typed it, and a
  // legacy «1» still auto-matches the drawn Leitung 1 (lib/truppLines · truppLineNo).
  // ⚠️ KEPT like the crew and the Auftrag (24.09.2026): the phone form is a bottom sheet now, and
  // pushing it down is «not now» — the same as the ✕ and the backdrop, which never threw these
  // away either… except that they did, for Ltg-Nr., Kanal, Art and Druck, the four fields that
  // were plain state. Only «Abbrechen» and the save drop a draft (`dropDraft`).
  const [lineNo, setLineNo, clearLineNo] = useKeptState<number | null>(`${draftKey}:lineNo`, initial?.lineNo ?? null)
  const legacyLine = initial?.lineNo == null ? initial?.lineNumber?.trim() : undefined
  const [funkkanal, setFunkkanal, clearFunkkanal] = useKeptState<number>(`${draftKey}:funkkanal`, initial?.funkkanal ?? defaultFunkkanal)
  // ⚠️ Read, never written (04.09.): the picker is gone from every layout. `null` means
  // «automatic» — the station colour for this Auftrag, else the next free palette colour (see
  // Trupp.color) — and that is what every new Trupp gets. A Trupp created while the picker
  // existed keeps its colour because the form hands the stored value straight back; editing one
  // must not repaint a Trupp that is already drawn on the Lage and on the plan.
  const color = initial?.color ?? null
  // ONE list, leader first (see TruppTeam): `team[0]` IS the Gruppenführer, which is also the
  // order the card, the Rapport and the map tag print. The record on disk keeps its old shape
  // (`name` + `members`), so nothing that ever read a Trupp has to change.
  const [team, setTeam, clearTeam] = useKeptState<Slot[]>(
    `${draftKey}:team`,
    initial ? truppSlots(initial, rosterByName, rosterById) : [],
  )
  // ⚠️ …and the KEPT DRAFT gets the same treatment. `useKeptState` restores whatever was in the
  // browser, which on a device that has been open across a roster sync (or across a demo reset)
  // is a team of bare names — so the form re-badged three roster members «Gast» while the Trupp
  // on disk had their ids all along. Re-linking on open is idempotent and never invents an id.
  useEffect(() => {
    const linked = team.map((sl) => (sl.personId ? sl : { ...sl, personId: personIdForName(rosterByName, sl.name) }))
    if (linked.some((sl, i) => sl.personId !== team[i].personId)) setTeam(linked)
    // once per mount: the roster is stable while a modal is open, and re-running on `team`
    // would fight the operator's own edits
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
  /* The crown follows the Dienstgrad while a NEW Trupp is being formed (30.09.2026, owner: «auto-set
   * the highest person rank wise as group leader unless … a group leader was set manually»):
   * until a name is tapped, the most senior member leads (lib/truppLeader · crewAfterChange).
   * Kept with the draft, so a pushed-away form that had its leader crowned by hand comes back with
   * that answer. Never on an edit or a re-entry — a crew joined later keeps its leader. */
  const [leaderAuto, setLeaderAuto, clearLeaderAuto] = useKeptState<boolean>(`${draftKey}:leaderAuto`, mode === 'create')
  const rankById = useMemo(() => new Map(personnel.map((p) => [p.id, rankOrder(p.rank)])), [personnel])
  const changeTeam = (next: Slot[], why: CrewChange) => {
    const r = crewAfterChange(next, why, leaderAuto, (sl) => (sl.personId ? rankById.get(sl.personId) ?? Infinity : Infinity))
    setTeam(r.team)
    if (r.auto !== leaderAuto) setLeaderAuto(r.auto)
  }
  /* «Art des Trupps» — asked on creation, and changeable while EDITING one (04.09.). What the
   * board could not do until then is the ordinary case: a Verkehrstrupp that ends up going in
   * under PA, and a Trupp registered under Atemschutz by mistake. Both were a delete and a
   * re-registration, which throws away the record of a crew that was already working.
   * ⚠️ …and on RE-DEPLOY too, reversing «the two decisions must not ride on one button» the same
   * day (Feldtest: «Bei Wieder einrücken (AS) habe ich keine Auswahl ob mit oder ohne AS»). The
   * reasoning was that «Wieder einrücken» sends the SAME Trupp in again — but what comes back
   * from the vehicle is very often a different job: the crew that fought the fire under PA goes
   * back in to clear up without it, and the Verkehrstrupp that has finished puts masks on for the
   * cellar. Each re-deployment is its own Einsatz of that crew, and the Art belongs to the
   * deployment, not to the card. Answering from the record was not the safe default either: it
   * silently re-armed a contact clock over a crew that was no longer under Atemschutz.
   * ⚠️ The change is not free — it starts or stops a safety watch. `editTrupp` / `reactivateTrupp`
   * own what that writes, and the confirm in front of a downgrade lives in `submitForm` below,
   * where saying no still leaves the operator in the form. (A re-deploy needs none: the Trupp is
   * out, so there is no running watch to take away.) */
  const [kind, setKind, clearKind] = useKeptState<TruppKind>(`${draftKey}:kind`, initial?.kind ?? 'atemschutz')
  /** The Funkkanal follows the Art while it is still the seeded default: stations may run their
   *  ohne-AS Trupps on a separate channel (doctrine.defaultFunkkanalEinfach). The form always
   *  opens under PA, so the ohne-AS seed can only apply on the «Ohne Atemschutz» tap — and a
   *  channel the operator already dialled, or a stored one being edited, is never overwritten. */
  const pickKind = (next: TruppKind) => {
    if (next !== kind && initial?.funkkanal == null) {
      const seedFor = (k: TruppKind) => (k === 'atemschutz' ? defaultFunkkanal : atemschutzDoctrine().defaultFunkkanalEinfach)
      if (funkkanal === seedFor(kind)) setFunkkanal(seedFor(next))
    }
    setKind(next)
  }
  const isPa = kind === 'atemschutz'
  /** This edit is turning the Überwachung ON — the Trupp had no cylinder until a moment ago, so
   *  the Druck field asks for a first Eingangsdruck rather than offering a correction. */
  const upgrading = mode === 'edit' && isPa && !!initial && !isAtemschutzTrupp(initial)
  /** Which of the two number sheets is open over the form (30.09.2026, owner: «Eingangsdruck and
   *  Funkkanal must open in a pop-up»): the Druck sheet's grid and the Kanal sheet's pad, opened from
   *  the rows «Eingangsdruck 300 bar ›» / «Funkkanal 11 ›» (see `luftFields`). A pick fills the
   *  draft and closes; nothing is written until the form's own save. They replace the «Standard:
   *  300 bar · Kanal 11 — Ändern» fold of 08.09. — it hid two steppers nobody touched; a row that
   *  opens a sheet costs the form what the fold did. */
  const [picker, setPicker] = useState<'pressure' | 'kanal' | null>(null)
  // …and the Auftrag tiles follow it: each kind has its own six-word vocabulary (config ·
  // atemschutz.auftrag / .auftragEinfach). Only the OFFER is narrowed — an already-stored value
  // from the other list keeps rendering everywhere (lib/report · truppAuftragLabel).
  const auftragTypes: { id: TruppAuftrag; label: string }[] = isPa ? cfg.auftrag : cfg.auftragEinfach
  // a fresh cylinder for create / re-deploy; edit never touches pressure. A Trupp without
  // Atemschutz has no cylinder at all — 0, and the field is not shown (see `showPressure`).
  // ⚠️ `||`, not `??`: a Trupp without Atemschutz carries 0 and has no number to correct, so
  // upgrading one from this form would open the stepper at 0 — a value the submit then refuses,
  // with the operator left to find out why. It gets the station's default, like a new Trupp.
  const [pressure, setPressure, clearPressure] = useKeptState<number>(`${draftKey}:pressure`,
    mode === 'edit' ? (initial?.entryPressureBar || atemschutzDoctrine().defaultPressureBar) : atemschutzDoctrine().defaultPressureBar)
  /* «Gleiche Flasche oder neue?» (24.09.2026, Übung 23.09.: a Trupp out at 19:55 after twelve
   * minutes went back in at 19:56 «with 300 bar» — the default nobody had touched). Asked only on
   * a re-entry within BOTTLE_ASK_MIN of the Austritt, where the answer is genuinely open; after
   * that a fresh cylinder is the normal case and the form looks as it always did. Nothing is
   * pre-selected, and «Im Einsatz» waits for an answer (or a touched stepper). */
  const lastExit = mode === 'redeploy' ? [...(initial?.readings ?? [])].reverse().find((r) => r.kind === 'exit') : undefined
  const outMin = lastExit ? Math.floor((serverNow() - Date.parse(lastExit.t)) / 60_000) : null
  const bottleAsk = isPa && lastExit != null && outMin != null && outMin < BOTTLE_ASK_MIN && lastExit.bar > 0
  // ⚠️ NOT kept (review 25.09.2026): the answer is about THIS break, and a kept «Gleiche Flasche»
  // skipped both questions on a later sortie with the old Restdruck
  const [bottle, setBottle] = useState<'same' | 'new' | null>(null)
  // No autofocus on a TABLET: the on-screen keyboard would immediately cover the form's other
  // fields, and the Mannschaft is a list that can simply be ticked. The EL taps the field they
  // want first. ⚠️ A PHONE creating a Trupp is the exception (20.09.2026): there the roster
  // appears only under a typed query, so the search IS the first step and nothing else on the
  // form can be answered before it – the dialog opens with the caret in it, and the phone frame
  // already folds the other sections away while it has the keyboard (Atemschutz.module.css).
  const teamSearchRef = useRef<HTMLInputElement | null>(null)
  const focusTeamFirst = !!stack && mode === 'create'
  // Esc closes the form (keyboard parity with the scrim/close-button) — but not while one of its
  // number sheets is open: that Escape is the sheet's (it closes itself first, and this closure
  // still sees it open, because the close has not rendered yet)
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape' && !picker) onCancel() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onCancel, picker])
  const auftragRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (focusSection !== 'auftrag') return
    const el = auftragRef.current
    el?.scrollIntoView({ behavior: 'smooth', block: 'center' })
    el?.querySelector<HTMLButtonElement>('button')?.focus({ preventScroll: true })
  }, [focusSection])
  // The other sections a blocked «Speichern» might have to point at (see `attemptSubmit` below) —
  // `zielRef` and `conflictRef` are new; `auftragRef` above already existed for the card's own
  // «Auftrag offen» pill and is reused here so the two paths ring the same field the same way.
  const teamRef = useRef<HTMLDivElement>(null)
  const zielRef = useRef<HTMLLabelElement>(null)
  const pressureRef = useRef<HTMLDivElement>(null)
  const conflictRef = useRef<HTMLDivElement>(null)

  // ⚠️ Shown in EVERY mode, including 'edit'. Hiding it there meant a mistyped Eingangsdruck could
  // never be corrected — and it is the number the Verbrauch and the tiefster Druck on the Rapport
  // are measured against. In edit mode it corrects what was recorded; it never counts as a contact.
  // ⚠️ …but only for a Trupp under PA: there is no cylinder to read on a Verkehrstrupp, and a
  // «Speichern» blocked on `pressure > 0` for a number that does not exist would be a dead button.
  const showPressure = isPa
  const isEdit = mode === 'edit'
  /* ⚠️ …except once the Trupp is OUT (24.09.2026, item 2). On 23.09. the Restdruck had nowhere to
   * go, so it was typed into «Eingangsdruck korrigieren» after the Austritt three times, and the
   * Rapport shows crews going in with 60, 170 and 180 bar. The exit has its own Restdruck now
   * (PressureSheet), and a finished run's entry reading is locked: it says so, and points at the
   * Restdruck where there is one. A correction to a finished sortie is an appended Verlauf row,
   * never an overwrite. While the Trupp is inside or still registered the field stays open. */
  const pressureLocked = isEdit && !!initial && initial.status === 'raus' && isAtemschutzTrupp(initial) && isPa
  const lockedExit = pressureLocked
    ? [...(initial?.readings ?? [])].reverse().find((r) => r.kind === 'exit' && r.measured)
    : undefined
  const isAnderes = auftrag === 'anderes'
  // «Anderes» needs its word: it is a label that says nothing on its own.
  const auftragOk = !isAnderes || ziel.trim().length > 0
  /**
   * …and that is the ONLY thing the Auftrag holds back (14.09., Feldentscheid — reversing the
   * 04.09. «Anmelden needs an Auftrag», which had itself reversed the 30.08. «the Auftrag no
   * longer blocks»).
   *
   * A Trupp is often registered to STAND READY: the crew is at the door with masks on and the
   * order comes a minute later, from somebody else. Blocking the Anmeldung on it meant the card
   * — and its contact clock — did not exist until the Überwacher had invented a job, and «Retten»
   * typed to get past the form is a worse record than an open field. The gap stays visible: the
   * card shows «Auftrag offen» (the same pill on a Trupp created without one as on one edited to
   * none) and opens the form on the Auftrag; the Trupp may go «drin» meanwhile. In no mode does an
   * empty Auftrag hold the form — creating, editing, or sending back in.
   */
  // …said, not enforced (15.09., Bastian: «with the warning»): while the Auftrag is empty on a NEW
  // Trupp an amber line above the footer names the gap; the save goes through regardless.
  const auftragGiven = (auftrag != null && !isAnderes) || ziel.trim().length > 0
  // ⚠️ …and only once somebody is IN the Trupp (18.09.2026): on a blank form the line stood
  // there before the first tap, naming a gap in a form nobody had started filling. The crew is
  // the first thing entered, so «at least one name» is «the operator has begun» — and from then
  // on the amber line says what is still missing.
  const auftragMissing = mode === 'create' && !auftragGiven
    && team.some((sl) => sl.name.trim().length > 0)
  // ⚠️ …and not while the caret is still in the PERSON SEARCH (10.10.2026, owner's iPhone): the
  // crew goes in one name after another, and the line stood there from the first name on, naming
  // a gap in a part of the form the operator had not reached. It waits until the search is left —
  // for the Auftrag, the Ziel, the footer, or a tap anywhere else — on every form factor.
  // The slot is HELD while it waits (visibility, not unmounting, `.formHintWaiting`): the blur
  // that reveals it is very often the press on «Anmelden» itself, and a line appearing under that
  // finger would move the button between the press and the release (on iOS the synthetic click
  // is hit-tested after the blur has re-rendered).
  const [teamSearchFocused, setTeamSearchFocused] = useState(false)
  const onTeamFocusChange = (focused: boolean) => (e: ReactFocusEvent) => {
    if (e.target === teamSearchRef.current) setTeamSearchFocused(focused)
  }
  // A linked person already deployed in another active Trupp blocks submit (one person, one
  // Trupp). The picker no longer OFFERS one — but an existing Trupp being edited can still carry
  // somebody who was assigned elsewhere in the meantime, and that has to be sayable.
  /* ⚠️ The person, not just their name (11.09.): the warning now carries an ACTION — take them
     out of the other Trupp — and that needs the id it is about and whether that Trupp is one a
     person may be quietly moved out of at all (lib/atemschutz · truppTransferState). */
  // ONE answer for the form and the Trupp sheet (lib/truppQuickEdit · teamConflict, 26.09.2026)
  const assignedConflict = useMemo(() => teamConflict(team, assignedIds, transferState, az.assignedFallbackName),
    [team, assignedIds, transferState, az.assignedFallbackName])
  const leaderOk = (team[0]?.name.trim().length ?? 0) > 0
  const bottleOk = !bottleAsk || bottle != null
  const canSubmit = auftragOk && leaderOk && (!showPressure || pressureLocked || pressure > 0) && bottleOk && !assignedConflict
  /* No sections on the phone any more (08.09., field ask): with the Mannschaft reduced to the
   search + populate-on-pick list and Druck/Kanal folded into the Standard line, the flat form
   fits — the three collapsible sections and their summary lines went with the space problem
   they were built for. */

  /* The fields exactly as this form would save them UNTOUCHED — its own defaults off `initial`,
   * computed once at mount. What differs from them at the save is what the operator touched
   * (`truppFieldGroupsChanged`), and an edit writes only that (AtemschutzView · submitForm). */
  const [pristine] = useState<TruppFields>(() => {
    const dz = atemschutzDoctrine()
    const slots = initial ? truppSlots(initial, rosterByName, rosterById) : []
    const k = initial?.kind ?? 'atemschutz'
    return {
      name: slots[0]?.name.trim() ?? '',
      members: slots.slice(1).map((m) => m.name.trim()).filter(Boolean),
      auftrag: initial?.auftrag ?? (mode === 'create' ? presetAuftrag : undefined),
      ziel: initial?.ziel, lineNo: initial?.lineNo, funkkanal: initial?.funkkanal ?? defaultFunkkanal,
      pressure: k !== 'atemschutz' ? 0 : mode === 'edit' ? (initial?.entryPressureBar || dz.defaultPressureBar) : dz.defaultPressureBar,
      equipment: initial?.equipment, kind: k,
    }
  })

  const dropDraft = () => {
    clearAuftrag(); clearZiel(); clearEquipment(); clearTeam(); clearLeaderAuto()
    clearLineNo(); clearFunkkanal(); clearKind(); clearPressure(); clearPressureSet()
  }
  const submit = (standby = false) => {
    if (!canSubmit) return
    /* The Gäste typed into this form reach the Anwesenheit NOW, at the save — never earlier
     * (staging walk-through 25.09.2026: «Abbrechen» left a person on the Rapport who never
     * existed). Filed through the same door as before (`onAddGuest` · assignTypedName, which links
     * a name that is already on the list instead of opening a second row), and the id it comes
     * back with is written into the Trupp, so the card and the Personalblatt are one person. */
    const cleanMembers = team.slice(1).filter((m) => m.name.trim())
    const memberPersonIds = cleanMembers.map((m) => m.personId).filter(Boolean) as string[]
    const fields: TruppFields = {
      name: team[0].name.trim(),
      members: cleanMembers.length ? cleanMembers.map((m) => m.name.trim()) : undefined,
      auftrag: auftrag ?? undefined,
      ziel: ziel.trim() || undefined,
      lineNo: lineNo ?? undefined,
      funkkanal: Number.isFinite(funkkanal) ? funkkanal : undefined,
      // 0 for a Trupp without Atemschutz — there is no cylinder, and the field was never shown.
      // ⚠️ On an UPGRADE this is the Eingangsdruck of a cylinder opened just now, and editTrupp
      // logs it as such (`paOn`) rather than correcting the Eintritt the Trupp already has.
      // …and a LOCKED Eingangsdruck goes back exactly as stored — never the stepper's fallback
      // for a Trupp that carries 0, which would have written 300 over a reading nobody took
      pressure: isPa ? (pressureLocked ? initial!.entryPressureBar : pressure) : 0,
      // in the station's list order, so two operators ticking the same items record the same
      // array — and nothing at all for a work squad, whose form never showed the chips
      equipment: isPa && equipment.length ? atemschutzEquipment().map((e) => e.id).filter((id) => equipment.includes(id)) : undefined,
      leaderPersonId: team[0].personId,
      memberPersonIds: memberPersonIds.length ? memberPersonIds : undefined,
      // ⚠️ PASSED THROUGH, never chosen (04.09.). The colour picker is gone from every layout;
      // `null` means «automatic» (the station colour for this Auftrag, else the next free one —
      // see Trupp.color), which is what a new Trupp now always gets. An OLDER Trupp that was
      // created while the picker existed keeps the colour it was given: editing must not repaint
      // a Trupp that is already drawn on the Lage and on the plan.
      color,
      kind,
      ...(isPa && (pressureSet || lowConfirmed === pressure) ? { pressureMeasured: true } : {}),
    }
    /* The Gäste typed into this form reach the Anwesenheit at the SAVE — never earlier (staging
     * walk-through 25.09.2026: «Abbrechen» left a person on the Rapport who never existed) — and
     * the view calls this only once every question in front of the save is answered. Filed
     * through the same door as before (`onAddGuest` · assignTypedName, which links a name already
     * on the list instead of opening a second row); the ids come back into the Trupp, so the card
     * and the Personalblatt are one person. */
    // (shared with the Trupp sheet since 26.09.2026 — lib/truppQuickEdit · fileGuestSlots)
    const fileGuests = (): Pick<TruppFields, 'leaderPersonId' | 'memberPersonIds'> => fileGuestSlots(team, onAddGuest)
    /* ⚠️ The draft is dropped only once the board SAYS the Trupp was written (staging walk-through
     * 25.09.2026): a question in front of the save — a Leitung another Trupp is on, a field
     * changed on another device, «Überwachung beenden?» — answered «Zurück» used to return to a
     * form that had already thrown everything typed away. */
    void Promise.resolve(onSubmit(fields, standby, { touched: truppFieldGroupsChanged(pristine, fields), fileGuests }))
      .then((saved) => { if (saved !== false) dropDraft() })
  }

  /**
   * Why the save did not happen, said WHERE the save is — a line right above the footer actions
   * (05.09., field feedback).
   *
   * ⚠️ NOT a toast any more. The app's toast lane is pinned to the bottom of the VIEWPORT, which
   * on this sheet is a pill hanging in the form's own empty space above the footer — and, worse,
   * a pill with `pointer-events: auto` sitting over whatever field happens to be under it. On a
   * phone that is the Auftrag «Art» chips: the first tap on «Löschen» hit the pill instead of the
   * chip, which is the «needs two taps to change the Art» defect. The reason belongs to the form,
   * so it is rendered by the form, anchored to the button it is about.
   *
   * DERIVED, not stored: the sentence is read off the same fields in the same precedence
   * `canSubmit` and `attemptSubmit` check, so it can never go stale — fixing the Mannschaft while
   * the Auftrag is still open re-reads as «Auftrag fehlt.» rather than keeping the answer to a
   * question that has been answered. All the state is whether a blocked tap has happened at all.
   * (The double assignment is the one reason with no line here: it already prints its own
   * sentence on the form, and saying it twice is not saying it louder.)
   */
  const [blockedShown, setBlockedShown] = useState(false)
  const blocked = !blockedShown || canSubmit || assignedConflict ? null
    : !leaderOk ? az.saveBlockedTeam
    : !auftragOk ? az.saveBlockedAuftrag
    : showPressure && !pressureLocked && pressure <= 0 ? az.saveBlockedPressure
    : !bottleOk ? az.saveBlockedBottle
    : null

  /** Point at the field that blocks the save — scroll it into view and ring it (lib/pointAtField,
   *  with this form's own `.formFlash`, the ring `focusSection` gives an opened section). (The
   *  phone form is flat since 08.09., so there is no collapsed section left to open first.) */
  const flashSection = (el: HTMLElement | null) => pointAtField(el, { className: s.formFlash })
  const pointAt = (el: () => HTMLElement | null) => flashSection(el())
  /**
   * «Speichern» while the Trupp isn't valid yet used to just sit there disabled — with Art
   * «Anderes» and an empty Auftrag/Ziel, nothing on screen said why (field feedback, 02.09.:
   * «weil ich 'Anderes' gewählt habe … Evtl. auch hier ein Blink, Blink → Hinweis»). The button
   * is no longer natively `disabled` (which swallows the tap outright and cannot explain
   * itself, and the OS-notification affordance for that ANYWAY-focusable state is `aria-disabled`
   * instead) — a blocked tap now points at and flashes the one field actually holding it back,
   * in the same precedence `canSubmit` itself checks. On the stack a reason that lives in a
   * collapsed section opens that section first (`pointAt`).
   */
  /* ── The ONE plausibility question (24.09.2026, item 2) ───────────────────────────────────────
   * An Eingangsdruck below the station's minimum (`doctrine.entryPressureMin`, /admin › Doktrin)
   * — at the Anmeldung, on a re-entry with a NEW cylinder, or corrected while the Trupp is inside
   * or registered — asks once, with the value on the button: «180 bar ist für einen Eintritt tief
   * (Station: ab 270). Stimmt das, …» «Ändern» / «180 bestätigen». No upper bound, and no second
   * rule: the review decided on exactly one. «Gleiche Flasche» is not asked about (its bar is the
   * Restdruck, low by definition), nor is an edit that leaves the number alone, nor a value this
   * form already had confirmed. */
  const [lowConfirmed, setLowConfirmed] = useState<number | null>(null)
  /* The Eingangsdruck was SET on purpose in this form — dialled, typed, a bottle answer. Kept
   * with the draft (a pushed-away form comes back with it); it marks the log row `measured`
   * (types · TruppFields.pressureMeasured). */
  const [pressureSet, setPressureSet, clearPressureSet] = useKeptState<boolean>(`${draftKey}:pressureSet`, false)
  const entryIsAsked = showPressure && !pressureLocked
    && (mode === 'create' || (mode === 'redeploy' && bottle !== 'same')
      || (mode === 'edit' && (upgrading || pressure !== initial?.entryPressureBar)))
  const lowEntryAsks = entryIsAsked && pressure !== lowConfirmed && entryPressureAsks(pressure, atemschutzDoctrine())
  const askLowEntry = async (): Promise<boolean> => {
    const dz = atemschutzDoctrine()
    // a title stating the fact, one line with the two numbers, the value on the button (owner
    // review 26.09.2026: the paragraph about the coming alarm was read by nobody)
    const ok = await confirmDialog({
      title: az.entryLowTitle,
      message: fillTemplate(az.entryLowMsg, { bar: pressure, min: dz.entryPressureMin }),
      confirmLabel: fillTemplate(az.entryLowConfirm, { bar: pressure }),
      cancelLabel: az.entryLowChange,
      // «Ändern» is the answer an Enter or a reflex tap gives — the value stays in the form
      safeAnswer: 'cancel',
    })
    if (ok) { setLowConfirmed(pressure); return true }
    // «Ändern»: straight back to the number — the Druck sheet, opened on the value it asked about
    setPicker('pressure')
    return false
  }

  const attemptSubmit = (standby = false) => {
    if (canSubmit) {
      setBlockedShown(false)
      // synchronous unless the question is due — a save with nothing to ask stays one tap, now
      if (lowEntryAsks) { void askLowEntry().then((ok) => { if (ok) submit(standby) }); return }
      submit(standby)
      return
    }
    if (!leaderOk) {
      setBlockedShown(true)
      pointAt(() => teamRef.current)
      return
    }
    // the conflict already prints its own sentence right on the form (see below) — a second copy
    // of it above the footer would say the same thing twice, so this only points at it AND at
    // the Mannschaft, where taking the named person out of this Trupp actually happens.
    if (assignedConflict) {
      setBlockedShown(false)
      pointAt(() => teamRef.current)
      flashSection(conflictRef.current)
      return
    }
    // ⚠️ NO dead disabled button: «Anderes» without its word points at the Auftrag, rings both
    // halves of the answer and puts the focus on the first Auftrag tile — the same place the
    // card's «Auftrag offen» pill sends the operator. The tiles, not the Ziel field: focusing a
    // text input here throws the on-screen keyboard over the rest of the form (see the note at
    // «No autofocus» above).
    if (!auftragOk) {
      setBlockedShown(true)
      pointAt(() => auftragRef.current)
      flashSection(zielRef.current)
      auftragRef.current?.querySelector<HTMLButtonElement>('button')?.focus({ preventScroll: true })
      return
    }
    if ((showPressure && pressure <= 0) || !bottleOk) {
      setBlockedShown(true)
      pointAt(() => pressureRef.current)
    }
  }

  const title = mode === 'edit' ? az.formEditTitle : mode === 'redeploy' ? az.formRedeployTitle : az.formCreateTitle
  const submitLabel = mode === 'edit' ? az.save : mode === 'redeploy' ? az.reenterSubmit : az.start

  /* ── The three groups of fields ───────────────────────────────────────────────────────────
   * Written once and placed twice: on one screen they fill the two columns, on the stack they
   * are the bodies of the three sections. That is what keeps the two layouts the same form —
   * same fields, same order, same words, only a different way of reaching them. */
  /* ⚠️ In EVERY mode of this form (04.09.): creating one, editing one, and sending one back in —
   * see the note at `kind` above for why the re-deploy fork was reversed the same day. The one
   * place it is not asked is the handed-over Tafel, whose whole board is Atemschutz (`lite`).
   * Everything downstream already follows the answer rather than the record: the Druck field and
   * the submit gate (`showPressure`), the Auftrag vocabulary, and «Bereitstellen», which is a
   * Sicherungstrupp and therefore under PA by definition. */
  /* A compact pair at the HEAD's right since 08.09. (field ask): the two big tiles with their
     explainer subtitles said what every AdF already knows, and cost the form its first row.
     The words alone carry it — since 27.09.2026 without the «Art des Trupps» label over them
     (slim sweep 6): «Unter Atemschutz / Ohne Atemschutz» name themselves, and the label stood
     directly over «Art», two «Art»s in a row. It stays the radiogroup's NAME for a screen reader.
     The buttons keep the TILE chrome the form has always worn
     (bordered `--surface` cards, ink outline + faint ink wash on the chosen one), just at a
     header's size. Deliberately NOT the Segmented track: the Art is which of two THINGS is
     being registered, not a property toggle — the same argument the original tiles made.
     `pickKind` still re-seeds the Funkkanal while it is the untouched default. */
  const kindChooser = !lite ? (
    <div className={s.kindHeadSeg} role="radiogroup" aria-label={az.kindLabel}>
      {/* THE choice chip (a radio here, so `aria-checked` speaks and `aria-pressed` stays off) */}
      <Chip role="radio" selected={isPa} aria-pressed={undefined} aria-checked={isPa}
        className={s.kindHeadOpt} onClick={() => pickKind('atemschutz')}>{az.kindAtemschutz}</Chip>
      <Chip role="radio" selected={!isPa} aria-pressed={undefined} aria-checked={!isPa}
        className={s.kindHeadOpt} onClick={() => pickKind('einfach')}>{az.kindPlain}</Chip>
    </div>
  ) : null

  const teamFields = (
    <div ref={teamRef} className={s.field} onFocus={onTeamFocusChange(true)} onBlur={onTeamFocusChange(false)}>
      <span>{az.sectionTeam}</span>
      {/* One list, leader first. A Trupp is valid with exactly one name (the Gruppenführer),
          so a two-person Trupp, a four-person Trupp and a mis-tap are all one tap apart —
          which the three fixed slots could not do.
          ⚠️ `phone` is the same `stack` that decides the three-section form (05.09.): on 375px
          the Mannschaft is a wrapping chip row and the roster appears only under a typed query.
          Same record, same handlers — see TruppTeam · `phone`. */}
      <TruppTeam
        value={team} onChange={changeTeam} phone={stack} wanted={mode === 'create'} searchInputRef={teamSearchRef}
        personnel={personnel} legacyRoster={roster} presentIds={presentIds} stationIds={stationIds}
        assignedIds={assignedIds} rolesById={rolesById}
      />
    </div>
  )

  // ⚠️ An UPGRADE asks for a FIRST Eingangsdruck, never «korrigieren» — the latter would claim the
  // Trupp already had one (04.09.). The row's word and the Druck sheet's title (the question).
  const pressureFieldLabel = mode === 'redeploy' ? az.newPressureLabel
    : isEdit && !upgrading ? az.editPressureLabel : az.pressureLabel
  // the number sheets' second head line — whose (lib/truppQuickEdit · truppSheetSub), or the leader picked so far
  const pickSub = initial ? truppSheetSub(initial) : team[0]?.name.trim() || undefined
  const pickPressure = (v: number) => {
    setPressure(v); setPressureSet(true)
    if (bottleAsk && !bottle) setBottle('new')
    setPicker(null)
  }
  /* Eingangsdruck and Funkkanal: ONE row each, in every mode — «Eingangsdruck 300 bar ›»,
   * «Funkkanal 11 ›» (30.09.2026) — and the row opens the sheet that asks it everywhere else: the
   * Druck sheet's 20-bar grid, the Kanal sheet's pad (`picker`, the sheets are rendered by the form
   * body). The rows always read the ACTUAL values, so nothing true is hidden behind a fold. */
  const luftFields = (
    <>
      {pressureLocked && (
        // «300 bar 🔒» and ONE line why (owner review 26.09.2026) — the number, the lock, the Restdruck
        <div ref={pressureRef} className={s.field}>
          <span>{az.pressureLockedLabelPlain}</span>
          <div className={s.pressureLocked}>
            <b><UnitVal val={`${initial!.entryPressureBar} bar`} /></b>
            <Icon id="lock" className={s.pressureLockedIcon} />
          </div>
          <p className={s.fieldNote}>{lockedExit
            ? fillTemplate(az.pressureLockedWhyExit, { bar: lockedExit.bar })
            : az.pressureLocked}</p>
        </div>
      )}
      {showPressure && !pressureLocked && (
        <div ref={pressureRef} className={s.field}>
          {bottleAsk && (
            <div className={s.bottleAsk}>
              <p>{fillTemplate(outMin! < 1 ? az.bottleAskNow : az.bottleAsk, { min: String(outMin), bar: String(lastExit!.bar) })}</p>
              <div className={s.bottleBtns}>
                <button type="button" className={cx(s.bottleBtn, bottle === 'same' && s.bottleOn)}
                  onClick={() => { setBottle('same'); setPressure(lastExit!.bar); setPressureSet(true) }}>
                  {az.bottleSame}<b><UnitVal val={`${lastExit!.bar} bar`} /></b>
                </button>
                <button type="button" className={cx(s.bottleBtn, bottle === 'new' && s.bottleOn)}
                  onClick={() => { setBottle('new'); setPressure(atemschutzDoctrine().defaultPressureBar); setPressureSet(true) }}>
                  {az.bottleNew}<b><UnitVal val={`${atemschutzDoctrine().defaultPressureBar} bar`} /></b>
                </button>
              </div>
            </div>
          )}
          <div className={s.pickRow}>
            <button type="button" className="row-go" aria-haspopup="dialog" onClick={() => setPicker('pressure')}
              aria-label={`${pressureFieldLabel} ${fillTemplate(az.stackPressure, { n: pressure })}`}>
              <span className="row-go-text">{pressureFieldLabel}</span>
              <span className={s.pickRowValue}><UnitVal val={fillTemplate(az.stackPressure, { n: pressure })} /></span>
              <span className="row-go-word"><Icon id="chevron" /></span>
            </button>
          </div>
          {/* said out loud, because the same grid on the CARD does the opposite: there it is a
              Druckmeldung and resets the contact clock. Here it corrects the record. */}
          {isEdit && !upgrading && <p className={s.fieldNote}>{az.editPressureHint}</p>}
        </div>
      )}
      {/* Kanal rides with the Druck: the pair you set on every single Trupp.
          ⚠️ No section headings in here. Uppercase labels over rules cut the form into boxes and
          each rule cost a row; every field already says what it is. */}
      <div className={s.pickRow}>
        <button type="button" className="row-go" aria-haspopup="dialog" onClick={() => setPicker('kanal')}
          aria-label={`${az.funkkanalSection} ${funkkanal}`}>
          <span className="row-go-text">{az.funkkanalSection}</span>
          <span className={s.pickRowValue}>{funkkanal}</span>
          <span className="row-go-word"><Icon id="chevron" /></span>
        </button>
      </div>
    </>
  )

  /* The two number sheets over the form. ⚠️ Rendered INSIDE the form's popup, so they are nested
   * dialogs (a tap in them is not an outside press that closes the form); and the host stops the
   * pointerdown on its way up the React tree — a portal's events still bubble through it, and the
   * form's own swipe-to-close would have dragged the form down under the sheet's drag. */
  const pickers = picker && (
    <span className={s.pickHost} onPointerDown={(e) => e.stopPropagation()}>
      {picker === 'pressure' ? (
        <PressureSheet sub={pickSub} title={pressureFieldLabel} hint={az.kanalSheetHint} last={pressure} chosen
          alarmBar={atemschutzDoctrine().alarmBar} onPick={pickPressure} onClose={() => setPicker(null)} />
      ) : (
        <KanalPickSheet value={funkkanal} sub={pickSub} takeLabel={az.formPickTake}
          onPick={(n) => { setFunkkanal(n); return true }} onClose={() => setPicker(null)} />
      )}
    </span>
  )

  const auftragFields = (
    <>
      {/* «Auftrag offen» flashes BOTH halves of the answer — «Art» AND «Auftrag / Ziel»
          (field decision 30.08.): the gap on the card is the pair, not one field. */}
      <div ref={auftragRef} className={cx(s.field, focusSection === 'auftrag' && s.formFlash)}>
        <span>{az.auftragLabel}</span>
        {/* The list that matches the Trupp's KIND — a Verkehrstrupp was being offered «Löschen»
            (field report 03.09.). Both lists are six tiles, so the form keeps its shape; and
            `sichern`/`anderes` are literally the same id on both sides, so switching the tiles
            above cannot invalidate a value that is already picked. */}
        <Segmented
          ariaLabel={az.auftragLabel}
          value={auftrag ?? undefined}
          onChange={(v) => setAuftrag(v)}
          options={auftragTypes.map((a) => ({ value: a.id, label: az.auftragLabels[a.id] ?? a.label }))}
        />
      </div>
      <label ref={zielRef} className={cx(s.field, focusSection === 'auftrag' && s.formFlash)}>
        <span>{az.zielLabel}</span>
        {/* ✕: a Trupp that comes back and goes in again gets a NEW order, and the old one is not
            a starting point for typing it — «2. OG Wohnung Nord, 2 Personen vermisst» had to be
            select-all-deleted by hand on a phone, mid-Einsatz. */}
        {/* ⚠️ ONE placeholder, for every Auftrag and both Arten (03.09.). It used to switch —
            «z. B. 2OG links» normally, the generic sentence only under «Anderes» — and a storey
            reference is Atemschutz vocabulary: under Auftrag «Verkehr» the example proposed a
            place that does not exist there. */}
        <ClearableInput
          value={ziel} placeholder={az.zielPlaceholder}
          // caps chosen so the card's one-line Ziel and the Leitung chip can't be blown out:
          // «2. OG Wohnung Nord, 2 Personen vermisst» is 39 chars, a Leitung is «1»–«12»
          maxLength={60}
          clearLabel={az.zielClear}
          onChange={(v) => setZiel(stripUnprintable(v))}
        />
      </label>
      {/* Ausrüstung — multi-select chips: selected = filled, unselected = framed, the SAME chip the
          Trupp sheet draws (TruppSheets · TruppSheet, `<Chip>`). The tick box they wore until
          27.09.2026 (mock 14.09.) was a second state mark inside a chip that already has one; the
          checkbox ROLE stays, because «several go» is what a screen reader has to hear. Only under
          Atemschutz: a work squad takes no Retthaube in. The list comes from the station
          (deploymentConfig · atemschutzEquipment). */}
      {isPa && (
        <div className={s.field}>
          <span>{az.equipmentLabel}</span>
          <div className={s.miniChips} role="group" aria-label={az.equipmentLabel}>
            {atemschutzEquipment().map((e) => {
              const on = equipment.includes(e.id)
              return (
                <Chip key={e.id} role="checkbox" selected={on} aria-pressed={undefined} aria-checked={on}
                  onClick={() => toggleEquipment(e.id)}>
                  {az.equipmentLabels[e.id] ?? e.label}
                </Chip>
              )
            })}
          </div>
        </div>
      )}
      {/* The SAME 1–99 number the DrawEditor stamps on a hose — one type on both sides is what
          lets a Trupp and a drawn Leitung find each other without anyone re-typing anything
          (lib/truppLines). A Trupp recorded before this was free text keeps its text below; it
          is never rewritten.
          ⚠️ NOT on the lite form (reverted, round 2 review — briefly shown 02.09.): a link
          holder has no picture to read a hose number off and no surface to draw one on, so the
          field could only ever be a number typed blind — and one Leitung, one Trupp is enforced
          against what is actually drawn regardless (see submitForm's takeover confirm). The FU
          sets it on the KP tablet.
          ⚠️ Since 04.09. the Leitung belongs to THIS group rather than to a section of its own:
          it is part of what the Trupp is doing, and the Farbe it used to share a block with is
          gone (see `color` in submit). */}
      {!lite && (
        /* ONE field with the Auftrag sheet (TruppSheets · LeitungField, 29.09.2026): «keine», the
           Leitungen actually DRAWN («Ltg 1 · Müller H.»), and «Nr. …» for a number nobody has drawn
           yet — typing a number blind is how the two sides end up disagreeing */
        <LeitungField label={az.lineNoLabel} value={lineNo} options={leitungOptions} onChange={setLineNo}>
          {legacyLine && <p className={s.fieldNote}>{fillTemplate(az.lineLegacyNote, { value: legacyLine })}</p>}
        </LeitungField>
      )}
    </>
  )

  // The form itself — head, fields, the blocked line, the footer. On the phone board it sits in a
  // bottom sheet under the pinned clocks (`sheet`), everywhere else it IS the dialog frame.
  const formBody = (
    <>
      <div className={s.modalHead}>
        <h3>{title}</h3>
        {/* with the keys up (a name half-typed) the first tap here only puts them away — the
            Overlay catches its frame's first `.ip-x` (overlays/fieldFirst, sweep 30.10.2026) */}
        <button className="ip-x" aria-label={appConfig.copy.closeDialog} onClick={onCancel}><Icon id="close" /></button>
      </div>
      <div className={s.modalBody}>
        {stack ? (
          /* ── PHONE: ONE flat column (08.09., field ask) — the three collapsible sections
             went with the space problem they were built for: the Mannschaft is the search +
             a populate-on-pick list, Druck/Kanal sit folded in the Standard line, so the
             whole form stands in one scroll. ORDER: who goes in first, then the Art as its
             own labelled section (it governs the Auftrag vocabulary right below it), then
             Auftrag / Ziel / Leitung, the folded Standard row last. */
          <div className={s.stack}>
            {teamFields}
            {kindChooser && <div className={cx(s.field, s.kindField)}>{kindChooser}</div>}
            {auftragFields}
            {luftFields}
          </div>
        ) : (<>
          {/* ── ONE SCREEN (tablet, desktop): nothing has to be walked to, and the whole Trupp
              is visible while it is being formed. RIGHT-COLUMN ORDER (08.09.): the Art leads
              as its own section (it governs the Auftrag vocabulary below it), then Auftrag /
              Ziel / Leitung — and the folded Standard row goes LAST: defaults that are checked,
              not typed, sit after everything that is actually asked. */}
          <div className={s.formCol}>{teamFields}</div>
          <div className={s.formCol}>
            {kindChooser && <div className={cx(s.field, s.kindField)}>{kindChooser}</div>}
            {auftragFields}
            {luftFields}
          </div>
        </>)}

        {/* ⚠️ TAPPABLE since 05.09. The sentence names a person who is in another Trupp, and the
            only place that can be fixed is the Mannschaft — so pressing the sentence opens it,
            the same jump a blocked «Trupp anmelden» now makes. It used to be an inert <p>: the
            loudest thing on the form, naming the one thing in the way, and doing nothing.
            ⚠️ …and since 11.09. it carries the FIX rather than only the way to it: «In diesen
            Trupp verschieben» takes the person out of the other Trupp, which is the whole errand
            the jump was sending the operator on. The sentence keeps its own tap — with the action
            withheld (the other crew is out there) it is the only door left. Two buttons inside
            one warn field, never a button inside a button. */}
        {assignedConflict && (
          <div ref={conflictRef} className={s.formColWide}>
            {/* one row for the form and the Trupp sheet (TruppSheets · TeamConflictRow, 26.09.2026) */}
            <TeamConflictRow conflict={assignedConflict} toName={team[0]?.name.trim() ?? ''}
              onPoint={() => pointAt(() => teamRef.current)} onTransfer={onTransfer} />
          </div>
        )}
      </div>

      {/* Why the save did not happen, where the save is — see `blocked` above for why this is not
          a toast. `role="alert"` so it is spoken the moment it appears, exactly as the toast was. */}
      {blocked && (
        <p className={cx('form-warn', s.formBlocked)} role="alert">
          <Icon id="warn" /><span>{blocked}</span>
        </p>
      )}
      {/* The Auftrag is missing but nothing is blocked (15.09.) — the same line, amber: the Trupp
          registers as «Auftrag offen». `role="status"`, not alert: it is there from the first
          render of a fresh form and must not be shouted over the field the operator is filling. */}
      {!blocked && auftragMissing && (
        <p className={cx('form-warn form-warn-amber', s.formBlocked, teamSearchFocused && s.formHintWaiting)} role="status"
          aria-hidden={teamSearchFocused || undefined}>
          <Icon id="warn" /><span>{az.auftragMissingHint}</span>
        </p>
      )}

      {/* the sheet's own footer row, so it pays the phone's safe area like every other (SheetFoot) */}
      <SheetFoot className={s.modalFoot}>
        {/* the house button family — three private classes here were the last of this modal's
            own design system (see Atemschutz.module.css · .modal) */}
        {/* the ONLY control that throws the draft away — ✕ and the backdrop keep it */}
        <button className={cx('ip-btn', s.footCancel)} onClick={() => { dropDraft(); onCancel() }}>{az.cancel}</button>
        {/* Re-deploy forks here: a re-equipped Trupp is just as often held back as
            Sicherungstrupp as it is sent straight in. Both buttons take the same filled-in form,
            so the choice costs nothing — and «Bereitstellen» is the one that must NOT start a
            contact clock. It is also what actually happens first: a Trupp comes out, gets a
            fresh bottle and waits. So on re-deploy «Bereitstellen» carries the primary weight
            and «Einrücken» steps back — the ORDER stays as it was, only the emphasis swaps, so
            nobody has to re-learn where the button is. */}
        {/* ⚠️ Under PA only. «Bereitstellen» exists because a re-equipped Trupp is as often held
            back as Sicherungstrupp as it is sent in — and a Sicherungstrupp is by definition a
            crew standing by under Atemschutz. A work squad has one way back in. */}
        {mode === 'redeploy' && isPa && (
          // ⚠️ «does NOT start the contact clock» is safety, and it was a `title` only — never
          // seen on a tablet (UX sweep F6, 20.10.2026). A hold (touch) or hover (mouse) now
          // answers with it (lib/holdTooltip · `data-holdexplain`); the name keeps its word first.
          <button className="ip-btn primary" aria-disabled={!canSubmit} data-holdexplain
            onClick={() => attemptSubmit(true)} aria-label={`${az.reenterStandby}: ${az.reenterStandbyHint}`}>
            {az.reenterStandby}
          </button>
        )}
        {/* ⚠️ `aria-disabled`, not `disabled` (field feedback, 02.09.): a native `disabled`
            button swallows the tap before it ever reaches a handler, which is exactly what left
            «Speichern» unresponsive with nothing to explain why. This one stays clickable and
            `attemptSubmit` decides — flash the missing field when blocked, submit when not.
            ⚠️ …and since 04.09. it is the ONLY forward control on a phone as well: there is no
            «Weiter» in front of it any more. */}
        <button className={mode === 'redeploy' && isPa ? 'ip-btn' : 'ip-btn primary'}
          aria-disabled={!canSubmit} onClick={() => attemptSubmit()}>{submitLabel}</button>
      </SheetFoot>
      {pickers}
    </>
  )

  // portal to <body> so the modal escapes the .surface stacking context (z-index 20) and covers
  // the TopBar ("+ Eintrag", z-index 40) instead of rendering beneath it
  /* ⚠️ On the phone board (`sheet`, 24.09.2026, D1 ⑥) the popup is a transparent column: the
   * pinned due Trupps on top, then the sheet with its grab bar. The pinned rows live INSIDE the
   * popup on purpose — outside it they would sit under the scrim, their taps would be «outside
   * presses» that close the form, and the focus trap would keep the keyboard off them. Swipe to
   * close is the primitive's own (overlays/swipeDismiss): the popup is flush with the bottom edge
   * and leaves headroom, so it measures as a bottom sheet; the pinned block opts out of starting
   * the gesture (`data-swipe-ignore`). */
  return (
    <Overlay open onClose={onCancel} className={cx(s.modal, stack && s.modalStack, sheet && s.modalSheet)} ariaLabel={title}
      initialFocus={focusTeamFirst ? teamSearchRef : undefined} swipeToClose={sheet}>
      {sheet ? (
        <>
          {pinned}
          <div className={s.sheetFrame}>
            <SheetGrab />
            {formBody}
          </div>
        </>
      ) : formBody}
    </Overlay>
  )
}
