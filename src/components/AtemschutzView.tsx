// The Atemschutz board – the Trupps page of an Einsatz: the phone board (Drin · Sicherungstrupp ·
// Bereit · Draussen), the tablet grid, the handed-over link Tafel (`lite`) and the Trupp form
// (`TruppForm.tsx`). ONE card on every board (`TruppCard.tsx`: `RowLine` + `TruppPair`, the phone
// row grown downwards) – a board differs only in what it has room for, never in a card of its own.
// Every warning tier comes from `truppAlarm` (lib/atemschutz), the same number the tone uses; the
// alarm itself runs app-wide in `useAtemschutzAlarm`, so it fires while this page is not on screen.
// Rules for this area: docs/atemschutz-board.md.

import { useEffect, useLayoutEffect, useMemo, useRef, useState, type MouseEvent, type ReactElement } from 'react'
import { Icon } from '../lib/icons'
import { appConfig } from '../config/appConfig'
import { fillTemplate, formatTime } from '../lib/format'
import { confirmDialog, toast } from '../lib/ui'
import { cx } from '../lib/cx'
import { newId } from '../lib/ids'
import { Button } from './Button'
import { Menu, Overlay, Popover } from '../lib/overlays'
import { NotfallBanner, NotfallPageHead, NotfallStrip, type SafetyActProps } from './AtemschutzNotfall'
import { DoubleAssignmentBanner } from './DoubleAssignmentBanner'
import { alarmBarFor, deriveTruppLive, safetyCandidates, safetyInside, safetyReady, truppInNotfall, earlyEntryCorrection, truppEditPatch, truppFieldGroupsChanged, truppLogName, type TruppFieldGroup, fmtClock, isAtemschutzTrupp, truppAlarm, truppFieldsOf, truppHeadName, truppInField, truppStillDeployed, truppTransferState, type TruppAlarm, type TruppLive } from '../lib/atemschutz'
import { foreignContactAgo } from '../lib/contactEcho'
import { serverNow, serverNowIso } from '../lib/serverClock'
import { isPresent } from '../lib/attendanceIntervals'
import { ortOf } from '../lib/attendanceOrt'
import { truppAuftragLabel, truppEquipmentLabels } from '../lib/report'
import { useIsPhone } from '../lib/useIsPhone'
import { usePageHeadFit } from '../lib/pageHeadFit'
import type { AttendanceState, Person, Trupp, TruppAuftrag, TruppFields } from '../types'
import { assignedPersonIds, doubleAssignments, rosterIdByName, truppCrewSlots } from '../lib/personnel'
import { truppLineNo, type LeitungOption } from '../lib/truppLines'
import { markerHolderNote, type MarkerOption } from '../lib/placedTrupps'
import { ensureNotifyPermission, notificationsSupported, unlockAlarm } from '../lib/alarm'
import { atemschutzDoctrine, isDemoMode } from '../lib/deploymentConfig'
import type { SyncStatus } from '../lib/incidents'
import { CLOCK_SKEW_WARN_MIN } from '../lib/syncAlert'
import { truppOrderKey } from '../lib/useTruppActions'
import s from './Atemschutz.module.css'
import { AuftragSheet, KanalSheet, PressureSheet, TruppSheet } from './TruppSheets'
import { ClockVal, RowEnter, TruppCard, TruppRow } from './TruppCard'
import { tabState, tierMark } from './truppCardText'
import { notfallStrips } from '../lib/notfall'
import { TruppForm, type FormMode, type TruppSubmitExtra } from './TruppForm'

/**
 * The last incoming `focus` nonce this view has already rung the bell for — MODULE scope, not
 * component state, on purpose (read while deriving `externalFocus`, written once it was shown).
 *
 * IncidentWorkspace renders this view behind `mode === 'atemschutz'`, a plain conditional: leaving
 * the page fully UNMOUNTS it, and its `truppFocus` state (the source of the `focus` prop) is never
 * cleared once shown — by design, «a repeat tap on the same alarm must replay the mark». But an
 * un-cleared pointer stays exactly as true across a REMOUNT as it does across a re-render, so the
 * very next ordinary visit to this page replayed the same ring on a Trupp that had long since come
 * back — a stale notification, an old locked-row tap, minutes or exercises later. Invisible until
 * 30.08. (see .cardFlash below): the ring itself silently never fired before that, so nobody saw
 * the replay happen. Module scope survives the remount the way `seededFocus`'s per-mount ref
 * deliberately does not — this is the one thing here that must NOT reset with the page.
 */
let lastShownFocusNonce: number | null = null
/** …and the last `createRequest` nonce already opened — same remount replay, same cure. */
let lastOpenedCreateNonce: number | null = null

/** «niemand ist gebunden» — one frozen instance, because it feeds a `useMemo` dependency in the
 *  form and a fresh Set on every render would re-run that memo for nothing (see `assignedIds`). */
const NO_ASSIGNED: Set<string> = new Set()

/** How the board is arranged — mirrors Prefs.atemschutzOrder. */
export type TruppOrder = 'dringlichkeit' | 'manuell' | 'auftrag' | 'name'

// The Atemschutzüberwachung surface: the digital Atemschutz-Überwachungstafel. Swiss FKS model
// — one big glanceable card per Trupp whose dominant element is TIME SINCE LAST FUNKKONTAKT, a
// large "Kontakt" reset, and a contact-clock alarm (amber nudge → red überfällig). Pressure is
// set inline and logged. Purely presentational + local UI state — data + mutations via props.
/** the tier every Trupp has on a CLOSED Einsatz — silent (R3) */
const FROZEN_ALARM: TruppAlarm = { sev: 0, reason: null, line: null }

/** The Trupps head's ladder (lib/pageHeadFit, 28.09.2026): what gives first when the one row runs
 *  out — the quiet line's time, then the tiles' words, lowest priority first (a way of LOOKING at
 *  the board before the handover, the handover before the way back to a deleted card, the alarm's
 *  word before the bell's honest state — the ⚠ and its count stay), then «Trupp anmelden» → «Trupp»,
 *  and last «✓ Gespeichert» keeps its ✓ (the sentence stays its `title`; a LOUD state never folds). */
const HEAD_FOLD = { saved: 1, order: 2, share: 3, restore: 4, overdue: 5, bell: 6, newTrupp: 7, savedMark: 8 } as const

/** The room the sticky Notfall stack takes at the top of the board's port (+ the air under it). */
const nfInset = (el: HTMLElement | null) => (el ? el.offsetHeight + 12 : 0)

export function AtemschutzView({
  trupps: allTrupps, truppColors, canEdit, personnel, attendance, muted, onToggleMuted, audioBlocked = false, onUnlockAudio, onAddGuest, order = 'manuell', onOrder, onMove, createTrupp, placeTrupp, placeTargets, markerOptions, adoptMarker, focusTruppOnPlan, recordContact, recordPressure, setTruppStatus, editTrupp, transferOutOfTrupp, keepInOneTrupp, designateSafety, reactivateTrupp, deleteTrupp, restoreTrupp, removedTrupps: allRemovedTrupps = [], leitungOptions, showTruppLine, truppsWithLine, lineNoOf, unlinkTruppLine, dockedAt,
  intervalMin = atemschutzDoctrine().contactIntervalMin, graceSec = atemschutzDoctrine().contactGraceSec,
  defaultFunkkanal = atemschutzDoctrine().defaultFunkkanal,
  focus, createRequest, onShareLink, shareLinkActive = false, lite, frozenAt, triggerNotfall, endNotfall, placeOf,
  onUndo, onRedo, canUndo = false, canRedo = false, undoLabel, redoLabel,
  syncStatus, lastSyncedAt, clockSkewMs,
}: {
  trupps: Trupp[]
  /** trupp id → the colour it wears on the Lage / plan (useTruppActions · truppColors). Every
   *  Trupp has an entry: placed colour, then decided colour, then its automatic palette slot. */
  truppColors: Record<string, string>
  canEdit: boolean
  /** per-incident Funkkontakt-Intervall (min) + Nachfrist (sec); default = appConfig doctrine */
  intervalMin?: number
  graceSec?: number
  /** synced default Funkkanal new Trupps are seeded with (FKS-Standard: 11) */
  defaultFunkkanal?: number
  /** Mannschaft roster + who is present — the create/edit form offers present people first */
  personnel: Person[]
  attendance: AttendanceState
  /** alarm audibility (per device, scoped to this Einsatz — see useAtemschutzMute). It covers
   *  BOTH channels: the tone and the OS notification. The actual alarm runs app-wide in
   *  useAtemschutzAlarm, so it fires even when this surface is not on screen. */
  muted: boolean
  onToggleMuted: () => void
  /** the browser has not released audio, so the tone cannot play whatever the bell claims. The
   *  bell shows this state instead of «an» and its tap retries the unlock. */
  audioBlocked?: boolean
  onUnlockAudio?: () => void
  /** how the board is arranged (device pref) — überfällig floats regardless, see sortTrupps */
  order?: TruppOrder
  onOrder?: (o: TruppOrder) => void
  /** move a card one slot in the hand-set order; only offered while that order is the one shown */
  onMove?: (id: string, dir: -1 | 1) => void
  createTrupp: (t: Trupp) => void
  /** place a Trupp's marker — targetId is the Lage map or a plan (see App's placeTargets) */
  placeTrupp: (id: string, targetId?: string) => void
  /** where a Trupp can be placed (Lage map / Gebäude / Modul 6) — >1 shows a picker first */
  placeTargets: { id: string; label: string }[]
  /** the Trupp symbols ALREADY standing on the Lage / a plan (lib/placedTrupps · markerOptions),
   *  offered under the placement targets: a «Trupp 2» dropped before anybody was registered is
   *  joined to its Trupp from here, the way a Trupp picks a drawn Leitung. */
  markerOptions: (exceptTruppId?: string) => MarkerOption[]
  /** join one of those symbols to this Trupp (useTruppActions · adoptTruppMarker — it owns the
   *  takeover confirm, so this side just hands over the two ids) */
  adoptMarker: (truppId: string, markerId: string) => void
  focusTruppOnPlan: (id: string) => void
  recordContact: (id: string) => void
  recordPressure: (id: string, bar: number) => void
  /** `exitBar` = the Restdruck asked at «Raus melden» (PressureSheet); absent = without one */
  setTruppStatus: (id: string, status: Trupp['status'], exitBar?: number, opts?: { undoToast?: boolean }) => void
  editTrupp: (id: string, f: TruppFields) => void
  /** Take one person out of the Trupp that still holds them — the «bereits in einem anderen
   *  Trupp» warning's own fix (useTruppActions · transferOutOfTrupp). `toName` is the
   *  Gruppenführer of the Trupp being formed here, so the row it writes can say where they went.
   *  Absent ⇒ the warning keeps the plain sentence it has always had. */
  transferOutOfTrupp?: (fromId: string, personId: string, toName?: string) => boolean
  /** «Bleibt in Trupp …» on the double-assignment band (DoubleAssignmentBanner, audit F05):
   *  takes the person out of every other active Trupp (useTruppActions · keepInOneTrupp).
   *  Absent ⇒ the band names the conflict without offering the choice. */
  keepInOneTrupp?: (keepTruppId: string, personId: string) => boolean
  /** the Notfall banner's «Sicherungstrupp bestimmen» on a Trupp already on the board: its Auftrag
   *  becomes «Sichern» with its own Verlauf row (useTruppActions · designateSafety). Absent: the
   *  ordinary edit does it. */
  designateSafety?: (id: string, forId: string) => boolean
  /** The Atemschutznotfall (F1, 08.10.2026): raise it on a crew inside / end it — both HELD on
   *  the card (AtemschutzNotfall · NotfallHold). Absent ⇒ the board offers neither. */
  triggerNotfall?: (id: string) => void
  endNotfall?: (id: string) => void
  /** where a Trupp was last seen, in words (useTruppActions · truppPlace) — the Notfall's «Ort» */
  placeOf?: (t: Trupp) => string | undefined
  /** `standby` re-registers the Trupp as Reserve (angemeldet) instead of sending it straight in */
  reactivateTrupp: (id: string, f: TruppFields, standby?: boolean) => void
  deleteTrupp: (id: string) => void
  /** undo for deleteTrupp — re-adds the captured Trupp (minus its removed placement) */
  restoreTrupp: (t: Trupp) => void
  /** Trupps taken off the board (types · Trupp.removedAt), newest first — the door behind the
   *  delete's six-second toast. */
  removedTrupps?: Trupp[]
  /** the drawn Leitungen offered in the form, excluding the edited Trupp's own from «taken» */
  leitungOptions: (exceptTruppId?: string) => LeitungOption[]
  /** jump to the Leitung a Trupp works on (Lage or Plan) */
  showTruppLine: (id: string) => void
  /** ids of Trupps whose Leitung is actually drawn somewhere */
  truppsWithLine: ReadonlySet<string>
  /** the Leitung number each Trupp's DRAWN hose carries right now (useTruppActions ·
   *  truppLineNos) — the picture is the source of truth for the number, the Trupp's stored
   *  copy only the fallback for a hose that has since been deleted. */
  lineNoOf?: ReadonlyMap<string, number>
  /** release a Trupp's Leitung — used when another Trupp takes it over (confirmed Ablösung) */
  unlinkTruppLine: (id: string) => void
  /** the symbol a Trupp's map marker is docked to (lib/docking), by Trupp id – «bei «Hydrant»»
   *  on the card's Kennzeile. Absent ⇒ no marker, or a marker standing on its own. */
  dockedAt?: ReadonlyMap<string, string>
  /** put a hand-typed Gast on the Anwesenheit — a Gast under PA was at the Einsatz, and a name
   *  that only ever existed on a Trupp card reaches neither the Personalblatt nor the export */
  onAddGuest?: (name: string) => string | undefined
  /** «point at THAT Trupp» — set by a locked Anwesenheit row. The nonce makes a repeat tap point
   *  again; the card scrolls itself into view and flashes, then the mark clears on its own. */
  focus?: { id: string; nonce: number } | null
  /** «Neuer Trupp» from a loose marker/chip on the Karte or a Plan (TwinTeamPill · TruppJoinMenu):
   *  open the create form; on save the new Trupp adopts `adoptMarkerId` (through `adoptMarker`).
   *  Cancel leaves the marker as it is. Nonce grammar as `focus`. */
  createRequest?: { nonce: number; adoptMarkerId: string } | null
  /** «Überwachung abgeben» — open the Weitergeben sheet on its «Nur Atemschutz» half, so the
   *  Tafel of this Einsatz can be handed to somebody's phone (components/panels · ShareIncident).
   *  Editors only, and never on the handed-over board itself: a link may not mint links. */
  onShareLink?: () => void
  /** …and whether one is currently live. The button's whole «on» state, deliberately: a device
   *  counter was dropped as YAGNI (01.09.), so this says that a link EXISTS and nothing more. */
  shareLinkActive?: boolean
  /**
   * «Tafel pur» — this board IS the whole app for this session (an Atemschutz-Link on somebody's
   * own phone): no NavRail, no TopBar, no context panel, no menus. Same cards, same words, same
   * bell; what goes is everything that points at a surface the session cannot reach — placing a
   * Trupp on the Karte, picking or showing a Leitung, moving a card in the board order, and the
   * order menu itself. `subtitle` replaces the generic one, because the one thing this screen
   * must say and otherwise could not is WHICH Einsatz it is watching.
   *
   * ⚠️ It carries no «Abmelden» and no other way «off» the board (02.09.). The link is the
   * literal page: it owns no login on this phone to end, and the button that stood beside the
   * bell ended the phone's OWN one. Leaving is closing the page; coming back is the link.
   */
  lite?: {
    subtitle: string
    /** The two halves `subtitle` is joined out of. The one-row head (09.09.) cuts the joined
     *  line and hands the whole thing to the detail popover behind it, which prints them apart
     *  — «Stichwort · Adresse» wrapped mid-address reads as one long broken string. Optional:
     *  without them the popover falls back to the joined line, which is still true. */
    title?: string
    address?: string
  }
  /** The app's ONE undo/redo pair, for the handed-over «Tafel pur» that has no TopBar to carry it.
   *  It drives the same global timeline everything else does (lib/undoTimeline) — see the markup
   *  in `headActs` for why it renders only under `lite`. Handed the event so the confirmation
   *  caption can be anchored at the button (lib/undoFlash). */
  onUndo?: (e: MouseEvent<HTMLButtonElement>) => void
  onRedo?: (e: MouseEvent<HTMLButtonElement>) => void
  canUndo?: boolean
  canRedo?: boolean
  /** what ↶ ↷ would take back / put back, in the operator's words — the hold-tooltip reads it off
   *  `aria-label`, so naming it here is the whole promise. */
  undoLabel?: string | null
  redoLabel?: string | null
  /** Epoch ms to read every clock against instead of the running one — the Einsatzende of an
   *  abgeschlossener Einsatz (IncidentWorkspace). Absent while the Einsatz is open, which is the
   *  only state in which a Trupp's time is still passing. */
  frozenAt?: number
  /** The incident's sync lifecycle (useIncidentSync), rendered in the board's OWN header
   *  (safety review 01.09.): the surface a life depends on must say itself whether what it
   *  shows is saved and current — offline or a failing sync has to be visible without the
   *  top-bar pill, which the handed-over Tafel does not even have. Absent = no status line. */
  syncStatus?: SyncStatus
  /** epoch ms of the last save the server accepted — the «Stand» a loud chip dates */
  lastSyncedAt?: number | null
  /** device-vs-server clock offset (ms, positive = device runs ahead; minute-quantized, null
   *  until the first sample — useIncidentSync). Beyond ±CLOCK_SKEW_WARN_MIN it earns its own
   *  warning chip. The clocks on this board are counted in the DEPLOYMENT's time since 02.09.
   *  (lib/serverClock), so the chip is no longer about them — it is about a device that is
   *  minutes out, whose operator will read every other timestamp in the app (Verlauf, Fotos,
   *  Anwesenheit) as if it were right. */
  clockSkewMs?: number | null
}) {
  const az = appConfig.copy.atemschutz // read per-render so the resolved locale applies
  /* ── «Tafel pur» sees the Atemschutz and NOTHING else (decided 03.09.) ─────────────────────
   * The handed-over board exists to operate the Atemschutzüberwachung — that is what the QR
   * promises, what the link's backend allowlist permits and the whole reason a stranger's phone
   * is looking at this Einsatz at all (see `lite` below). A Verkehrstrupp on it would be a row
   * that carries no clock, cannot be reached from any other surface of that session, and quietly
   * widens what «Überwachung abgeben» hands over. So a link session's board is filtered here,
   * at the source: no section, no rows, and no way to create one (the form's Art chooser is
   * `!lite` too). The Trupps still exist — they are simply not this session's business. */
  const trupps = useMemo(() => (lite ? allTrupps.filter(isAtemschutzTrupp) : allTrupps), [allTrupps, lite])
  const removedTrupps = useMemo(
    () => (lite ? allRemovedTrupps.filter(isAtemschutzTrupp) : allRemovedTrupps),
    [allRemovedTrupps, lite],
  )
  // the shared create / edit / re-deploy form — null when closed
  // `adoptMarkerId`: the loose marker a create form was opened FROM — joined to the Trupp on save
  const [form, setForm] = useState<{ mode: FormMode; trupp?: Trupp; focus?: 'auftrag'; adoptMarkerId?: string; presetAuftrag?: TruppAuftrag } | null>(null)
  /* The mini sheets (26.09.2026, phone card slim-down — components/TruppSheets): one fact of the
   * card, one short sheet, every save through `editTrupp`. Opened from the card's chips on every
   * width (the tablet's Kennzeile entries are the same doors), so the sheet is what a tap on a fact
   * does — the big form stays for Art and Eingangsdruck, behind «Bearbeiten». */
  const [quick, setQuick] = useState<{ id: string; kind: 'kanal' | 'auftrag' | 'trupp' } | null>(null)
  /* The one pressure picker (PressureSheet, 24.09.2026): a Druckmeldung from the phone row or card,
   * and the Restdruck at «Raus melden» on every width. Null when closed. */
  const [pressureAsk, setPressureAsk] = useState<{ id: string; kind: 'pressure' | 'exit' } | null>(null)
  /**
   * personId → the OTHER Trupp that still holds them, for the form's double-assignment warning
   * and the «In diesen Trupp verschieben» behind it.
   *
   * Same rule as `assignedPersonIds`, which is what decides that the warning appears at all: a
   * `raus` Trupp holds nobody, and the Trupp being edited is never its own conflict — so the
   * card this answers with is always the one the sentence is complaining about.
   */
  /** a Trupp's crew as the roster reads it — what «In diesen Trupp verschieben» may remove
   *  (atemschutz · truppCrewWithout: a compacted id is no answer to «whose name is this») */
  const crewSlotsOf = useMemo(() => {
    const byName = rosterIdByName(personnel)
    const roster = new Map(personnel.map((p) => [p.id, p]))
    return (t: Trupp) => truppCrewSlots(t, byName, roster)
  }, [personnel])
  const truppOfPerson = useMemo(() => {
    const by = new Map<string, Trupp>()
    for (const t of trupps) {
      if (t.status === 'raus' || t.id === form?.trupp?.id) continue
      if (t.leaderPersonId) by.set(t.leaderPersonId, t)
      for (const id of t.memberPersonIds ?? []) by.set(id, t)
    }
    return by
  }, [trupps, form?.trupp?.id])
  /**
   * «zeig mir den» from THIS surface — the header's überfällig badge. The `focus` prop covers
   * the jump in from somewhere else (a locked Anwesenheit row); this is the same mark set from
   * inside, so the badge behaves like the app-wide TopBar chip it mirrors instead of being the
   * one warning on the screen that does nothing when you press it.
   *
   * The later nonce wins, so whichever pointed last is the one the board obeys.
   */
  const [selfFocus, setSelfFocus] = useState<{ id: string; nonce: number; markAll?: boolean } | null>(null)
  // the incoming pointer, minus a nonce this view has already rung the bell for once (module-scope
  // guard against a REMOUNT replaying a stale one — see `lastShownFocusNonce` above). A genuinely
  // NEW nonce — an actual repeat tap, or a fresh jump arriving while this page stays mounted —
  // passes through untouched; TruppRow/TruppCard's own `focusNonce`-keyed effect handles that case
  // exactly as before.
  // `shownNonce` — per MOUNT — is the other half of that: the instant the effect below records the
  // nonce, the bare `!== lastShownFocusNonce` test would turn the pointer stale under its own ring.
  // The per-second tick re-renders inside the 1.9s flash window, so the mark would be yanked back
  // mid-gesture. A nonce THIS mount has already accepted therefore stays accepted until it leaves.
  const shownNonce = useRef<number | null>(null)
  const externalFocus = focus && (focus.nonce === shownNonce.current || focus.nonce !== lastShownFocusNonce)
    ? focus
    : null
  const activeFocus = (selfFocus?.nonce ?? -1) > (externalFocus?.nonce ?? -1) ? selfFocus : externalFocus
  // Mark it seen once this view has actually SHOWN it — a later visit then filters it out above,
  // however long the pointer stays parked upstream. Keyed on the nonce rather than mount-only:
  // IncidentWorkspace sets `truppFocus` while this view is already mounted too (jumping to the tab
  // you are already on leaves the view standing), and a mount-only mark recorded none of those —
  // they were shown and never written down, so the next ordinary visit replayed them, which is
  // exactly the stale ring this guard exists to stop.
  // Reads `externalFocus`, not the raw prop: a pointer that arrived already stale showed nothing,
  // so there is nothing to record — and recording it would let it back in on the next render.
  useEffect(() => {
    if (!externalFocus) return
    shownNonce.current = externalFocus.nonce
    lastShownFocusNonce = externalFocus.nonce
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focus?.nonce])
  // a Trupp awaiting a Gebäude/Modul-6 placement choice (only when >1 target exists)
  const [placePick, setPlacePick] = useState<string | null>(null)
  const handlePlace = (id: string) => {
    // «Wohin platzieren?» has two kinds of answer: a surface to put a NEW symbol on, and a symbol
    // that is already standing (a «Trupp 2» somebody dropped before this Trupp existed). Both are
    // counted here, so a station with one plan and one loose marker still gets to choose.
    const markers = markerOptions(id)
    // nothing to place on and nothing standing — the EL must first create a Gebäude (from the
    // Umrisse) or there is no Modul 6 for this object. Tell them rather than doing nothing.
    if (placeTargets.length === 0 && markers.length === 0) { toast(az.placeNoTarget, { icon: 'warn', tone: 'warn' }); return }
    if (placeTargets.length + markers.length > 1) setPlacePick(id)
    else if (placeTargets.length) placeTrupp(id, placeTargets[0].id)
    else adoptMarker(id, markers[0].key)
  }

  // per-second tick so the contact clock re-renders (pattern from TopBar's clock). This drives
  // the VISUAL board only; the audible alarm + OS notification run app-wide (useAtemschutzAlarm).
  //
  // ⚠️ `serverNow()`, not `Date.now()` (02.09.): the contact clock is read off the deployment's
  // clock so a phone and a PC watching the same Trupp show the SAME number. They did not — a
  // six-second device-clock difference was six seconds of difference on the board, and the
  // operator has no way to tell which of the two is lying. Offline it IS Date.now().
  /* ⚠️ …and it STOPS at the Einsatzende once the Einsatz is abgeschlossen (`frozenAt`, 04.09.).
   * A closed Einsatz is a record, not a situation: a Trupp that was never reported out kept
   * accumulating Einsatzzeit through the night, so opening the Akte the next morning showed a
   * crew «seit 14:12 im Einsatz» — a number about nothing. Frozen, every clock on the board reads
   * what it read when the Einsatz ended, which is what the paper says too. The tick is not merely
   * ignored but never started: there is nothing left to count. */
  const [tick, setTick] = useState(() => serverNow())
  useEffect(() => {
    if (frozenAt != null) return
    const t = setInterval(() => setTick(serverNow()), 1000)
    return () => clearInterval(t)
  }, [frozenAt])
  const now = frozenAt ?? tick

  // the station's Alarmdruck lines — read as scalars, because atemschutzDoctrine() builds a
  // fresh object on every call and a memo keyed on it would recompute on every render
  const { alarmBar, alarmBarRueckzug } = atemschutzDoctrine()

  // derive every Trupp's live numbers once per tick
  const live = useMemo(
    () => new Map(trupps.map((t) => [t.id, deriveTruppLive(t, now, intervalMin, graceSec)] as const)),
    [trupps, now, intervalMin, graceSec],
  )

  /* …and its TIER, once, from the same fold the tone and the TopBar chip use (lib · truppAlarm).
   * ⚠️ The card, the row, the header badge and the sort all read THIS — not the contact clock.
   * They used to read the clock alone, so a Trupp at the Alarmdruck with a fresh Funkkontakt had
   * the whole app alarming beside a green, unbadged, unsorted card. One number, one board. */
  /* ⚠️ A CLOSED Einsatz alarms nothing (R3, staging 25.09.2026): its clocks stand at the close,
   * and a crew that was overdue then read as a red «1 Alarm» and a red clock on every phone —
   * at 3am, an alarm still running. Frozen, every tier is silent: no badge, no red card, and the
   * band says what the clock shows (the state at the close), in the neutral tone. */
  const alarms = useMemo(
    () => new Map(trupps.map((t) => [t.id, frozenAt != null ? FROZEN_ALARM : truppAlarm(t, live.get(t.id)!, intervalMin, graceSec, { alarmBar, alarmBarRueckzug })] as const)),
    [trupps, live, intervalMin, graceSec, alarmBar, alarmBarRueckzug, frozenAt],
  )
  const sevOf = (id: string): 0 | 1 | 2 => alarms.get(id)?.sev ?? 0

  /* How far past its own line a Trupp is, as one comparable number — the ranking
   * `peakAtemschutzAlarm` uses for the TopBar chip, mirrored here so the header badge jumps to
   * the card the chip points at. Pressure ranks by bar below the line (×60, so it sorts against
   * the seconds of a contact clock); contact ranks by seconds. */
  const urgency = (t: Trupp) => {
    const a = alarms.get(t.id)
    const l = live.get(t.id)
    if (!a || !l) return -1
    // a Notfall stands above every clock (F1) — and the longest-running one first
    if (a.reason === 'notfall') return 1e12 + (t.notfallAt ? now - Date.parse(t.notfallAt) : 0)
    return a.reason === 'pressure' ? ((a.line ?? 0) - l.currentBar) * 60 : l.sinceContactSec ?? 0
  }

  // Trupps in alarm float to the top of the board so one can't hide off-screen, and the header
  // carries a count badge (the alarm may be muted — the visual must not be).
  const alarmTrupps = trupps.filter((t) => sevOf(t.id) >= 2)
  const overdueCount = alarmTrupps.length
  // the one the badge jumps to: the same ranking peakAtemschutzAlarm gives the TopBar chip —
  // a pressure alarm by how far below its line, a contact alarm by how long out of contact —
  // so the badge, the chip and the board's own sort all point at the same card
  const mostOverdue = [...alarmTrupps].sort((a, b) => urgency(b) - urgency(a))[0]
  /* Arriving on the board DURING an alarm lands on the due card, marked. The TopBar chip, the
   * NavRail dot and the OS notification all bring the operator here without saying WHICH card
   * they meant — so the board points itself, with the exact mark the header badge sets: flash +
   * scroll (activeFocus → TruppCard/TruppRow). Once per mount only — a later crossing must not
   * yank the board out from under a working hand (the badge is the hand for that) — and never
   * over an external jump: a `focus` prop present at mount (a locked Anwesenheit row) already
   * names its card and wins.
   *
   * ⚠️ NOT on the demo (isDemoMode): its incident is frozen in a worked state, so a field Trupp
   * drifts überfällig purely because real time passes since the last reset — useAtemschutzAlarm
   * already keeps that visual (the card stays red, honestly), but silences the tone and the OS
   * notification because it is not a real emergency. A mount-time flash+scroll to that card is
   * the same false alarm wearing a different costume — a visitor opening the board sees a ring
   * around a Trupp nobody is actually worried about. Real stations (demoMode off) are unaffected. */
  const seededFocus = useRef(false)
  useEffect(() => {
    if (seededFocus.current) return
    seededFocus.current = true
    // `externalFocus`, not the raw `focus` prop: a STALE pointer (already shown on an earlier
    // visit, filtered out above) must not block this board from pointing at a genuine CURRENT
    // alarm just because something unrelated once pointed here.
    if (!externalFocus && mostOverdue && !isDemoMode()) setSelfFocus({ id: mostOverdue.id, nonce: Date.now() })
    // mount-only by design (see above) — `externalFocus`/`mostOverdue` are read as of arrival
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
  /**
   * How the board is arranged:
   *   · «wie gesetzt»  — the DEFAULT: the hand-set order (Trupp.order, synced), so a card keeps
   *                      its slot and «Trupp 2 is the second one» stays true for the whole Einsatz.
   *                      NOTHING moves a row here — not even ÜBERFÄLLIG: whoever chose this mode
   *                      chose stable slots, and an overdue card is already unmissable (red card,
   *                      banner, header badge + jump). A row that teleports out of «its» slot is
   *                      the failure mode this mode exists to prevent.
   *   · «Dringlichkeit» — longest since Funkkontakt first (what the board did before)
   *   · «Auftrag» / «Name» — for a board big enough to look things up in
   * In the DERIVED sorts a Trupp in ALARM still floats to the top before the mode's own key:
   * those orders are recomputed anyway, so the float costs no stability and keeps an alarming
   * card from hiding off-screen. Alarm = the shared tier (`alarms`), so a Trupp at the
   * Alarmdruck floats exactly like one out of contact.
   * The MODE is per-device (a way of looking); the hand-set order is synced (it is data).
   */
  // ⚠️ ONE key space with the writers. `order` is optional, so a Trupp that never got one sorts
  // by its position in this list — and createTrupp/moveTrupp compute against exactly that key
  // (lib/useTruppActions · truppOrderKey), or a new card ties with an existing one and lands
  // mid-board. Also the stable tiebreak for the derived sorts, so two Trupps that compare equal
  // by name/Auftrag keep the slots the hand gave them.
  const orderKey = (t: Trupp) => truppOrderKey(t, trupps.findIndex((x) => x.id === t.id))
  /**
   * How long this crew has been out there, as the tiebreak both derived sorts need — 0 for
   * anybody who is not (04.09., Manuel: «den länger andauernden Einsatz zuerst»).
   *
   * ⚠️ `truppStillDeployed`, not the raw `elapsedSec`. That number is FROZEN at the Austritt and
   * keeps its total, so a crew that worked for an hour and came out would outrank every Trupp
   * actually inside — an urgency sort putting the finished ones on top. Only a running
   * deployment has a length that means anything here.
   */
  const runningSec = (t: Trupp) => (truppStillDeployed(t) ? live.get(t.id)?.elapsedSec ?? 0 : 0)
  /**
   * Where a Trupp stands in the work, as a rank: 0 out there · 1 waiting to go · 2 finished.
   *
   * The «Auftrag» sort is read to answer «who is doing what», and it used to answer it with a
   * plain alphabet — so a Trupp that had come out an hour ago, and one still standing at the
   * vehicle, sat left of the crews actually working (04.09., Manuel). The alphabet still orders
   * within each rank; what changed is that the crews the question is about come first.
   *
   * ⚠️ ONLY in this derived sort. «Wie gesetzt» keeps every card in its slot for the whole
   * Einsatz, finished or not — that is the promise that mode exists for (see the note below).
   */
  const workRank = (t: Trupp) => (truppStillDeployed(t) ? 0 : t.status === 'raus' ? 2 : 1)
  const baseSort = (list: Trupp[]) => [...list].sort((a, b) => {
    // the überfällig float – in the derived sorts only: «wie gesetzt» never moves a card, alarm or
    // not (owner, 23.10.2026); the phone board floats by its own urgency sort (`phoneIn` below)
    if (order !== 'manuell') {
      const alarm = Number(sevOf(b.id) >= 2) - Number(sevOf(a.id) >= 2)
      if (alarm) return alarm
    }
    if (order === 'name') return a.name.localeCompare(b.name, 'de') || orderKey(a) - orderKey(b)
    if (order === 'auftrag') {
      // ⚠️ By the LABEL on the card, not by a list index — which is what keeps this coherent now
      // that there are two Auftrag lists (config · atemschutz.auftrag + .auftragEinfach). Two
      // indices would collide («Retten» and «Verkehr» are both #1); the word the operator reads
      // orders both vocabularies in one alphabet, and the board is split into its PA and
      // non-PA sections anyway, so the two lists never actually interleave. A Trupp with no
      // Auftrag sorts last (￿), an id from the other list sorts by its own word.
      // …behind WHERE the Trupp stands in the work: out there, waiting, finished (`workRank`).
      // A Trupp with no Auftrag at all still sorts last within its own rank (￿).
      const rank = workRank(a) - workRank(b)
      if (rank) return rank
      return (truppAuftragLabel(a.auftrag) ?? '￿').localeCompare(truppAuftragLabel(b.auftrag) ?? '￿', 'de') || orderKey(a) - orderKey(b)
    }
    if (order === 'dringlichkeit') {
      // the tier first, then how far past its own line — the ranking the badge and the TopBar
      // chip use, so «Dringlichkeit» means the same thing everywhere it is spoken
      const tier = sevOf(b.id) - sevOf(a.id)
      if (tier) return tier
      const by = urgency(b) - urgency(a)
      if (by) return by
      // …and among cards that are equally urgent, the deployment that has been RUNNING LONGEST
      // (04.09., Manuel). Under PA the clock above already orders them — this is the answer for
      // everything it cannot see: a Trupp ohne Atemschutz has no Funkkontakt-Intervall, so every
      // one of them tied here and fell back to the board's hand-set order.
      const longest = runningSec(b) - runningSec(a)
      if (longest) return longest
    }
    return orderKey(a) - orderKey(b)
  })

  /* Hold the ARRANGEMENT still for a moment after any change made on this board.
   *
   * The überfällig float above is right and stays (in the derived sorts) — but it means a Kontakt re-sorts the board
   * under the finger. Measured at 1194×834: pressing Kontakt on the card in slot 1 reset its
   * clock, dropped it out of the überfällig group, and slid everything below up, so ~250ms later
   * `elementFromPoint` at the pressed pixel returned a DIFFERENT Trupp's card. With four
   * überfällige and an Überwacher working down the board, every Kontakt reshuffles the rest.
   *
   * Only the ORDER is frozen — clocks, colours, pressures and the überfällig banner keep updating,
   * so nothing is hidden, the cards just don't move out from under the hand. Anything new appears
   * after the frozen ones (stable sort on equal keys) rather than jumping into the middle. */
  const isPhone = useIsPhone()
  // Compact rows vs cards — a NARROW-SCREEN layout, nothing else (decided 16.08.); the long
  // note beside `openRow` below says why, and why a Trupp-count trigger was dropped.
  const compact = isPhone

  const FREEZE_MS = 2000
  const [frozenIds, setFrozenIds] = useState<string[] | null>(null)
  // the thaw: every freeze is a NEW array, so a second tap inside the window restarts the 2 s
  // (the timer used to live in a ref written from `freezeOrder`, which the phone board's extra
  // call sites turned into react-hooks/refs findings — an effect owns it without one)
  useEffect(() => {
    if (!frozenIds) return
    const h = window.setTimeout(() => setFrozenIds(null), FREEZE_MS)
    return () => window.clearTimeout(h)
  }, [frozenIds])

  const sortTrupps = (list: Trupp[]) => {
    const sorted = baseSort(list)
    if (!frozenIds) return sorted
    const rank = new Map(frozenIds.map((id, i) => [id, i]))
    return sorted.sort((a, b) => (rank.get(a.id) ?? Number.MAX_SAFE_INTEGER) - (rank.get(b.id) ?? Number.MAX_SAFE_INTEGER))
  }
  /* ── A Trupp that came back KEEPS ITS SLOT — on the board and in the list (17.08.) ──
   * There used to be a «Raus»-Abschnitt underneath everything else, and the cards/rows jumped into
   * it the moment a Trupp came out. That cost the one thing this surface is for: a slot that means
   * something. «Trupp 2 steht oben rechts» stopped being true exactly when the Trupp came back,
   * and everything below it moved up — on the surface whose whole promise is that a card does not
   * move out from under the hand (see the freeze note above).
   * ⚠️ It went for the CARD GRID first and for the narrow list a day later, on the same reasoning:
   * the split saves rows, and a row that has moved is worse than a row too many.
   * What the state IS stays readable on the card itself (banner, colour, «Draussen»), the header's
   * sort answers «zeig mir die brauchbaren zuerst», and a Trupp nobody needs on the board any more
   * can be deleted — the Rapport keeps it either way (types · Trupp.removedAt). */
  const board = sortTrupps(trupps)
  /* ── Two sections, one board (mock «Sektionen», decided 03.09.) ────────────────────────────
   * Atemschutz on top with today's cards, entirely untouched, then a ruled «Weitere Trupps» with
   * the plain work squads as single rows. The split is the whole point of this variant: the PA
   * safety signal must not be diluted by rows that carry no clock, and the eye has to know at a
   * glance which half it is in. Sorting happens ONCE, over the whole board (`sortTrupps` above),
   * and the split preserves that order inside each section — so «Dringlichkeit» and the hand-set
   * order mean the same thing they always did, just within their own half. */
  const paBoard = board.filter(isAtemschutzTrupp)
  const plainBoard = board.filter((t) => !isAtemschutzTrupp(t))
  /* Sections appear the moment the board holds a Trupp without Atemschutz, and not before: an
   * Einsatz where everybody went in under PA — every Einsatz recorded until today — gets exactly
   * the board it had, with no headings, no counts and no empty second half to read past. */
  const sectioned = plainBoard.length > 0

  /* ── The PHONE board of the full app (24.09.2026, Übung Allschwilerstrasse 100) ─────────────────
   * ⚠️ Reverses, for the phone only, two earlier decisions: «a Trupp keeps its slot» (17.08.) and
   * «wie gesetzt» as the order that never moves a row (see `baseSort`). On 23.09. one Überwacher
   * ran five Trupps from a phone, the hand-set order hid the overdue ones between the others, and
   * about ten of seventeen contacts came AFTER the alarm. So the phone board is arranged by what
   * the operator has to do next, and the order menu is not offered there:
   *   · Drin — every Atemschutz-Trupp inside, the one due next on top (tier, then how far past its
   *     line, then the longest-running — the same ranking «Dringlichkeit» uses)
   *   · the Sicherungstrupp — standing ready (Auftrag «Sichern»), or a placeholder asking for one
   *     while anybody is inside
   *   · Bereit — registered, not yet in · Draussen — came out
   * The tablet grid, and the handed-over Tafel (one Trupp per screen), keep their arrangement
   * (their CARD is this board's opened row since 29.09.2026 — see TruppCard). The 2 s
   * freeze still holds the order under the finger (`freezeOrder` captures THIS arrangement). */
  const phoneMode = compact && !lite
  const inFieldNow = (t: Trupp) => t.status === 'aktiv' || t.status === 'rueckzug'
  const byHand = (list: Trupp[]) => [...list].sort((a, b) => orderKey(a) - orderKey(b))
  const holdFrozen = (list: Trupp[]) => {
    if (!frozenIds) return list
    const rank = new Map(frozenIds.map((id, i) => [id, i]))
    return [...list].sort((a, b) => (rank.get(a.id) ?? Number.MAX_SAFE_INTEGER) - (rank.get(b.id) ?? Number.MAX_SAFE_INTEGER))
  }
  const phoneIn = holdFrozen([...paBoard.filter(inFieldNow)].sort((a, b) =>
    (sevOf(b.id) - sevOf(a.id)) || (urgency(b) - urgency(a)) || (runningSec(b) - runningSec(a)) || (orderKey(a) - orderKey(b))))
  const phoneSafety = byHand(paBoard.filter((t) => t.status === 'angemeldet' && t.auftrag === 'sichern'))
  const phoneReady = byHand(paBoard.filter((t) => t.status === 'angemeldet' && t.auftrag !== 'sichern'))
  const phoneOut = byHand(paBoard.filter((t) => t.status === 'raus'))
  /* The Atemschutznotfall (F1, 08.10.2026): who is in one, and who can go in for them — the one
   * model of a READY Sicherungstrupp the board has (lib/atemschutz · safetyReady), in hand order.
   * A closed Einsatz shows none: its Tafel alarms nothing (R3). */
  const notfallTrupps = frozenAt != null ? [] : byHand(paBoard.filter(truppInNotfall))
  const notfallReady = byHand(safetyReady(paBoard))
  const notfallSafetyInside = safetyInside(paBoard)
  // …and whom «Sicherungstrupp bestimmen» can name while none is ready: any other crew, a busy
  // one included (owner, 30.10.2026 — lib/atemschutz · safetyCandidates)
  const candidates = safetyCandidates(byHand(paBoard))
  const notfallCandidates = [candidates.ready, candidates.inside, candidates.out]

  // Called from the card's action handlers — i.e. after render, so it simply closes over the
  // arrangement the operator is currently looking at. (A ref would have to be written during
  // render, which is exactly what react-hooks/refs warns about.)
  const freezeOrder = () => {
    setFrozenIds((phoneMode ? [...phoneIn, ...phoneSafety, ...phoneReady, ...phoneOut, ...plainBoard] : board).map((t) => t.id))
  }

  /* ── A Kontakt another device confirmed a moment ago ASKS first (24.09.2026, D1 ⑧a) ──────────
   * On 23.09. the iPad and the phone both answered T1 and the record got two contacts 21 s apart.
   * The synced log says when the last confirmation was and whether this device wrote it
   * (lib/contactEcho); a foreign one under 60 s old turns the tap into «Kontakt wurde vor 21 s
   * schon bestätigt (anderes Gerät). Nochmals / OK». «OK» — and every way of dismissing the
   * question — writes nothing. A second tap on the SAME device is unchanged (no question, the
   * 2 s order freeze).
   * ⚠️ On EVERY board — tablet grid, phone board and the handed-over Tafel (25.09.2026): it guards
   * the ACT, not a layout, and the 23.09. case was an iPad and a phone. «OK» is the default
   * (filled, focused — `ConfirmSpec · safeAnswer`): a reflex tap or an Enter writes nothing. */
  const contactTap = async (id: string): Promise<boolean> => {
    const t = trupps.find((x) => x.id === id)
    const ago = t ? foreignContactAgo(t, serverNow()) : null
    if (t && ago != null) {
      /* Recognition over reading (owner review 26.09.2026): a TITLE that states the fact, one
         short line for which crew and when, the verbs on the buttons. */
      const again = await confirmDialog({
        title: az.contactEchoTitle,
        message: fillTemplate(az.contactEchoMsg, { name: typeof t.no === 'number' ? fillTemplate(az.contactEchoWho, { n: t.no }) : t.name, s: ago }),
        confirmLabel: az.contactEchoAgain,
        cancelLabel: az.contactEchoOk,
        safeAnswer: 'cancel',
      })
      if (!again) return false
    }
    freezeOrder()
    recordContact(id)
    return true
  }

  // roster of everyone already entered on any Trupp (GF + AdF) — offered as quick-select chips
  // in the form so names don't have to be retyped each time.
  const roster = useMemo(() => {
    const seen = new Set<string>()
    for (const t of trupps) {
      for (const n of [t.name, ...(t.members ?? [])]) {
        const v = n?.trim()
        if (v) seen.add(v)
      }
    }
    return [...seen].sort((a, b) => a.localeCompare(b, 'de'))
  }, [trupps])

  // present crew (attendance) — offered first in the picker; ids already on another active
  // Trupp get a duplicate-warning badge but stay selectable (real incidents need corrections)
  const presentIds = useMemo(
    () => new Set(Object.entries(attendance).filter(([, a]) => a.status === 'present').map(([id]) => id)),
    [attendance],
  )
  // …and which of them are still at the Magazin. Somebody at the Magazin usually cannot go under
  // PA at all, so the picker says so and sinks them below the crew on scene (see TruppTeam).
  const stationIds = useMemo(
    () => new Set(Object.entries(attendance)
      .filter(([, a]) => isPresent(a) && ortOf(a) === 'station')
      .map(([id]) => id)),
    [attendance],
  )

  // Who is already spoken for: the Bemerkung on their Anwesenheits-Zeile is where a job ends up
  // («Einsatzleiter», «Fahrer TLF» — lib/roleAssignment). Putting the Einsatzleiter under PA is
  // allowed and sometimes right; the picker only says it out loud before it happens.
  const rolesById = useMemo(
    () => new Map(
      Object.entries(attendance)
        .map(([id, a]) => [id, (a.note ?? '').trim()] as const)
        .filter(([, note]) => note.length > 0),
    ),
    [attendance],
  )

  // unlock the alarm tone + ask for OS-notification permission on this gesture, so a later
  // überfällig alert can both sound and reach the tray when the app is backgrounded.
  // ⚠️ NOT on the public demo (06.09.): a visitor poking at Musterdorf gets no browser
  // permission dialog thrown at their first taps — it reads as data grabbing on a demo site.
  // The audio unlock stays (idempotent, no permission involved) — moot on the demo itself,
  // where useAtemschutzAlarm suppresses the audible alarm anyway.
  // ⚠️ A session that cannot write the Trupps never gets the form (RBAC audit V2, 22.10.2026): on
  // the phone it pins the due Trupps with a live «Kontakt», which reset the clock and stopped the
  // alarm on that one tablet while nothing reached the server.
  const openForm = (mode: FormMode, trupp?: Trupp, focus?: 'auftrag', adoptMarkerId?: string, presetAuftrag?: TruppAuftrag) => {
    if (!canEdit) return
    unlockAlarm(); if (!isDemoMode()) void ensureNotifyPermission(); setForm({ mode, trupp, focus, adoptMarkerId, presetAuftrag })
  }
  // «Neuer Trupp» from a loose marker/chip — opened once per request nonce (see lastOpenedCreateNonce)
  useEffect(() => {
    if (!createRequest || !canEdit || createRequest.nonce === lastOpenedCreateNonce) return
    lastOpenedCreateNonce = createRequest.nonce
    openForm('create', undefined, undefined, createRequest.adoptMarkerId)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [createRequest?.nonce])


  /**
   * The FIRST tap ANYWHERE on this board also counts as the audio unlock (field feedback,
   * 02.09.: «Ich erhalte keinen Ton … auf dem PC oder Mobile» over a bell visibly showing «nicht
   * freigegeben»). Browsers only release Web Audio inside a real gesture, and until now the only
   * gesture THIS surface answered was opening the Trupp-Formular — `App.selectIncident` covers
   * the normal «open an Einsatz» tap for the full app, but an Atemschutz-Link session's own
   * first «gesture» is the token exchange during boot, which runs outside any click and leaves
   * the AudioContext quietly `suspended`. Anyone who only watched the board, or only ever
   * pressed Kontakt/Druck, could sit through an entire überfällig alarm in total silence.
   * Idempotent (`primeAudio`/`ensureNotifyPermission` both are) and fires once per mount.
   */
  const primedGesture = useRef(false)
  const primeOnFirstTap = () => {
    if (primedGesture.current) return
    primedGesture.current = true
    // demo: audio only — see openForm for why the permission ask stays off the demo's first taps
    unlockAlarm(); if (!isDemoMode()) void ensureNotifyPermission()
  }

  /**
   * One Leitung, one Trupp. Typing a number that someone else is already on used to save silently
   * and leave two Trupps claiming one hose — the tag then picked one of them and the Überwacher had
   * no way of knowing. Name both and let the operator decide: a takeover IS the normal case
   * (Ablösung), it just has to be said out loud. Cancel returns to the form with everything still
   * typed. ⚠️ ONE helper for every save that can set a Leitung — the form's (`submitForm`) and the
   * Auftrag sheet's (`saveQuick`, 26.09.2026) — so no door around the question exists.
   * `true` when the write may go ahead (the previous Trupp has let go by then) — a plain `true`
   * with no clash, so a save that asks nothing still writes in the same tick it was tapped (the
   * board's tests, and the create form's kept draft, count on that); a Promise only while asking.
   */
  const confirmLineTake = (f: TruppFields, ownId?: string): true | Promise<boolean> => {
    const clash = f.lineNo == null ? undefined
      : trupps.find((t) => t.id !== ownId && t.status !== 'raus' && truppLineNo(t) === f.lineNo)
    if (!clash) return true
    return confirmDialog({
      title: fillTemplate(az.lineTakeTitle, { n: String(f.lineNo) }),
      message: fillTemplate(az.lineTakeMsg, { n: String(f.lineNo), from: clash.name, to: f.name }),
      confirmLabel: az.lineTakeConfirm,
      cancelLabel: appConfig.copy.cancel,
    }).then((ok) => {
      if (!ok) return false
      unlinkTruppLine(clash.id) // the previous Trupp lets go — its Leitung is now this one's
      return true
    })
  }
  /** A mini sheet's save (components/TruppSheets): the same question in front of a Leitung, then
   *  the ONE write path. `true` = written, the sheet closes; `false` = the operator said no and the
   *  sheet stays open with everything still picked. */
  const saveQuick = async (id: string, f: TruppFields): Promise<boolean> => {
    const take = confirmLineTake(f, id)
    if (take !== true && !(await take)) return false
    editTrupp(id, f)
    return true
  }

  /** Resolves `true` once the Trupp is written — the form drops its kept draft only then, so every
   *  «Zurück» / «Abbrechen» on a question in front of the save returns to a form still filled in. */
  const submitForm = async (f0: TruppFields, standby = false, extra?: TruppSubmitExtra): Promise<boolean> => {
    if (!form) return false
    let f = f0
    /* ⚠️ An EDIT is a patch (staging walk-through 25.09.2026: phone B's older open form saved its
     * stale Auftrag over phone A's change). Only the groups this form touched are written, onto
     * the Trupp as it stands NOW; and a touched group that another device changed since the form
     * opened is said in one line first, with «Zurück zum Formular» as the safe, focused answer. */
    if (form.mode === 'edit' && form.trupp && extra) {
      const current = trupps.find((t) => t.id === form.trupp!.id) ?? form.trupp
      const changedElsewhere = truppFieldGroupsChanged(truppFieldsOf(form.trupp), truppFieldsOf(current))
      const conflicts = extra.touched.filter((g) => changedElsewhere.includes(g))
      if (conflicts.length) {
        const ok = await confirmDialog({
          message: conflicts.length === 1
            ? fillTemplate(az.editConflictOne, { field: az.editFieldLabels[conflicts[0]], now: fieldNow(current, conflicts[0]) })
            : fillTemplate(az.editConflictMany, { fields: conflicts.map((g) => az.editFieldLabels[g]).join(', ') }),
          confirmLabel: az.editConflictOverwrite,
          cancelLabel: az.editConflictBack,
          safeAnswer: 'cancel',
        })
        if (!ok) return false
      }
      f = truppEditPatch(current, f0, extra.touched)
    }
    const take = confirmLineTake(f, form.trupp?.id)
    if (take !== true && !(await take)) return false
    // every question is answered — NOW the Gäste typed into the form reach the Anwesenheit
    // (TruppForm · fileGuests), and only if the crew is part of what this save writes
    const fileCrew = () => {
      if (!extra || (form.mode === 'edit' && !extra.touched.includes('crew'))) return
      f = { ...f, ...extra.fileGuests() }
    }
    if (form.mode === 'create') {
      fileCrew()
      const id = newId('tr')
      createTrupp({
        id,
        // ⚠️ WRITTEN ONLY for the new kind. Absent means «unter Atemschutz» (types · TruppKind),
        // and stamping the default onto every new Trupp would make the blob claim a decision
        // nobody made — and make every pre-03.09. record look different from a fresh one.
        ...(f.kind === 'einfach' ? { kind: f.kind } : {}),
        name: f.name, members: f.members, auftrag: f.auftrag, ziel: f.ziel, lineNo: f.lineNo, funkkanal: f.funkkanal,
        leaderPersonId: f.leaderPersonId, memberPersonIds: f.memberPersonIds, equipment: f.equipment,
        entryPressureBar: f.pressure, entryTime: '', lastContactTime: '', lowestBar: f.pressure,
        status: 'angemeldet',
        // an Eingangsdruck set on purpose opens the log as a MEASURED Anmeldung, so the first
        // Druckmeldung never «corrects» it (lib/atemschutz · entryPressureConfirmed); the default
        // one leaves the log to createTrupp, as ever
        readings: f.pressureMeasured && f.kind !== 'einfach'
          ? [{ t: serverNowIso(), bar: f.pressure, kind: 'registered', measured: true }] : [],
      })
      // The phone focus board («ein Trupp, ein Bildschirm») otherwise left the PREVIOUS Trupp
      // selected — a new Trupp existed, but the operator was still looking at somebody else's
      // card. `picked` is declared further down; this is a closure reference, resolved by the
      // time submitForm actually runs (it is only ever called from an event handler, never
      // during this render). Harmless on the tablet grid too — nothing reads `picked` there.
      setPicked(id)
      // opened from a loose marker/chip: the record joins the picture in the same go
      if (form.adoptMarkerId) adoptMarker(id, form.adoptMarkerId)
    } else if (form.mode === 'edit' && form.trupp) {
      /* Turning the Überwachung OFF on a crew that is inside is the one change in this form that
       * takes a safety watch away, so it is said out loud first. Only while the Trupp is actually
       * in the field: correcting an Art on a Trupp that has come out, or one still at the door,
       * costs nobody anything and needs no dialog. Cancel returns to the form with the tile still
       * on «ohne Atemschutz», so the operator can put it back rather than start over. */
      if (f.kind === 'einfach' && truppInField(form.trupp)) {
        const ok = await confirmDialog({
          title: fillTemplate(az.kindOffTitle, { name: form.trupp.name }),
          message: az.kindOffMsg,
          confirmLabel: az.kindOffConfirm,
          cancelLabel: appConfig.copy.cancel,
          danger: true,
        })
        if (!ok) return false
      }
      fileCrew()
      editTrupp(form.trupp.id, f)
    } else if (form.mode === 'redeploy' && form.trupp) {
      fileCrew()
      reactivateTrupp(form.trupp.id, f, standby)
    }
    setForm(null)
    return true
  }

  /* Compact rows vs cards — a NARROW-SCREEN layout, nothing else (decided 16.08.).
   *
   * A card is ~641px tall against a 575px scroll port on a phone, so a single Trupp's clock and
   * its Rückzug/Raus row can never be on screen at once — that is what the rows exist for. A row
   * opens its own card on tap, so nothing is unreachable, it is one tap deeper.
   *
   * A Trupp-count trigger was tried and dropped: it flipped a 1920px screen to rows at 4 Trupps
   * where five cards fitted comfortably. The board CAN still under-report on a wide screen (6
   * Trupps, 3 columns, no scroll cue) — that is a real and separate finding, and the fix for it
   * belongs on the card grid (a total in the header, a fade at the edge), not in this switch. */
  const [openRow, setOpenRow] = useState<string | null>(null)

  /* «Ein Trupp, ein Bildschirm» — the handed-over board on a PHONE (decided 02.09.): a strip with
   * one tab per Trupp and its live clock on top, and ONE Trupp filling the rest of the screen —
   * the clock as large as the screen allows, a Kontakt the thumb cannot miss, every other clock
   * still in view in the strip. A tablet keeps the card grid. An überfällig Trupp pulls itself
   * forward the moment it becomes one; a tap on a tab is a deliberate choice that stands until
   * the next alarm or an external jump (`focus`). */
  const focusMode = !!lite && compact
  // the pair's word IS its promise — the hold-tooltip reads it off `aria-label` (lib/holdTooltip)
  const undoWord = undoLabel ? fillTemplate(appConfig.copy.undoNamed, { action: undoLabel }) : appConfig.copy.undo
  const redoWord = redoLabel ? fillTemplate(appConfig.copy.redoNamed, { action: redoLabel }) : appConfig.copy.redo
  const [picked, setPicked] = useState<string | null>(null)
  /* The handed-over phone board OPENS on the crew that needs the Überwacher first — the most
   * urgent one inside (the «Drin» order: tier, how far past its line, longest running) — never
   * simply the first Trupp of the board (staging walk-through r2, N18: it opened on a Trupp that
   * was out, its biggest control «Wieder in den Einsatz», while another crew was inside). With
   * nobody inside it is the board's first Trupp, as before. */
  const firstFocus = focusMode
    ? [...board.filter((t) => isAtemschutzTrupp(t) && inFieldNow(t))].sort((a, b) =>
      (sevOf(b.id) - sevOf(a.id)) || (urgency(b) - urgency(a)) || (runningSec(b) - runningSec(a)))[0] ?? board[0]
    : undefined
  const focusId = focusMode
    ? (picked && board.some((t) => t.id === picked) ? picked : firstFocus?.id ?? null)
    : null
  const lastOverdue = useRef<string | null>(null)
  const mostOverdueId = mostOverdue?.id ?? null
  useEffect(() => {
    if (mostOverdueId && mostOverdueId !== lastOverdue.current) setPicked(mostOverdueId)
    lastOverdue.current = mostOverdueId
  }, [mostOverdueId])
  useEffect(() => { if (activeFocus?.id) setPicked(activeFocus.id) }, [activeFocus?.id, activeFocus?.nonce])

  /* Park an opened card at the top of the scroll port — and buy exactly enough room to do it.
   *
   * ⚠️ The first version padded the list with a flat 62dvh whenever a card was open. That let the
   * operator scroll clean past the card into an empty screen: the board looked as if every Trupp
   * had vanished. The room needed is knowable — port height minus card height — so it is measured
   * instead of guessed, and a card taller than the port gets none at all.
   *
   * This lives here rather than in TruppCard because the spacer has to exist BEFORE the scroll:
   * child effects run before the parent's, so a card parking itself would run out of list to
   * scroll against. */
  const bodyRef = useRef<HTMLDivElement>(null)
  const listRef = useRef<HTMLDivElement>(null)
  /* The Notfall banners' sticky stack (AtemschutzNotfall · NotfallBanner) covers the top of the
   * port, so «the top of the port» is BELOW it while one runs: its height (+ the air under it) is
   * `--nf-h` on the port — the port's scroll padding for every scroll-into-view — and the parking
   * scroll below reads it too. Before (owner screenshot 10.10.2026) the opened card parked under
   * the banner with its name chips cut off. Measured, because the banner's height is its words. */
  const nfStackRef = useRef<HTMLDivElement>(null)
  const hasNotfall = notfallTrupps.length > 0
  useLayoutEffect(() => {
    const port = bodyRef.current, el = nfStackRef.current
    if (!port) return
    if (!el) { port.style.removeProperty('--nf-h'); return }
    const set = () => port.style.setProperty('--nf-h', `${nfInset(el)}px`)
    set()
    const ro = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(set)
    ro?.observe(el)
    return () => ro?.disconnect()
  }, [hasNotfall])
  const openRowStatus = trupps.find((t) => t.id === openRow)?.status
  // pointing at the card that is already open («Zum Trupp» twice, an alarm on it) parks it again
  const openFocusNonce = activeFocus && activeFocus.id === openRow ? activeFocus.nonce : undefined
  useEffect(() => {
    const list = listRef.current, port = bodyRef.current
    if (!list || !port) return
    for (const el of list.querySelectorAll('[data-az-fab-foot]')) el.removeAttribute('data-az-fab-foot')
    if (!compact || !openRow) { list.style.removeProperty('--az-open-pad'); return }
    const card = list.querySelector<HTMLElement>('[data-az-open]')
    if (!card) return
    // Parked at the top of the port, a card about a port tall ends in the FAB's corner, and the
    // circle sat on its Verlauf row's chevron (field checks 24.09.2026). That ROW – and only it –
    // then keeps the FAB's column free (Atemschutz.module.css · data-az-fab-foot), for exactly as
    // long as it really stands under the circle: measured where it IS, never assumed. So it is
    // re-measured on everything that moves one against the other – the card changing height (the
    // Verlauf opening, a crew row, a warning; that also resizes the spacer), the port changing
    // height or scrolling (the parking scroll itself is smooth, so its end arrives as scroll
    // events), and the window or visual viewport resizing (the FAB is `position: fixed`). Scroll
    // and resize are folded into one measurement per frame. (Back since sweep 28.10.2026 #5: the
    // board's card runs to the phone edge again, so rows pass under the FAB.)
    const measure = () => {
      list.style.setProperty('--az-open-pad', `${Math.max(0, port.clientHeight - nfInset(nfStackRef.current) - card.offsetHeight - 16)}px`)
      const row = card.querySelector<HTMLElement>('[data-az-foot]')
      const fab = document.querySelector('.fab-entry')?.getBoundingClientRect()
      if (!row) return
      const r = row.getBoundingClientRect()
      row.toggleAttribute('data-az-fab-foot', !!fab && r.top < fab.bottom && r.bottom > fab.top)
    }
    let frame = 0
    const schedule = () => { if (!frame) frame = requestAnimationFrame(() => { frame = 0; measure() }) }
    measure()
    // …parked under the Notfall banners while one runs, never beneath them (`--nf-h` above)
    const top = port.scrollTop + card.getBoundingClientRect().top - port.getBoundingClientRect().top - nfInset(nfStackRef.current)
    if (typeof port.scrollTo === 'function') port.scrollTo({ top, behavior: 'smooth' })
    else port.scrollTop = top
    port.addEventListener('scroll', schedule, { passive: true })
    window.addEventListener('resize', schedule)
    window.visualViewport?.addEventListener('resize', schedule)
    const ro = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(schedule)
    ro?.observe(card)
    ro?.observe(port)
    return () => {
      if (frame) cancelAnimationFrame(frame)
      port.removeEventListener('scroll', schedule)
      window.removeEventListener('resize', schedule)
      window.visualViewport?.removeEventListener('resize', schedule)
      ro?.disconnect()
    }
  }, [compact, openRow, openRowStatus, openFocusNonce])

  /* WHICH cards the current pointer marks — and which one the board scrolls to.
   *
   * ⚠️ The header badge counts EVERY Trupp in alarm, so pressing it rings every one of them
   * (05.09.): «2 Alarme» that ringed a single card said the opposite of the number on it, and
   * the answer to «welche denn?» was still a scroll. The scroll stays on the one card the badge
   * ranks first (`activeFocus.id`, = the TopBar chip's pick) — two smooth scrolls fired at once
   * fight each other and land wherever the last one happened to render. */
  const markAll = !!(selfFocus && activeFocus === selfFocus && selfFocus.markAll)
  // Which (Trupp, nonce) pairs have already COMPLETED their ring. Expand/collapse swaps
  // TruppRow ⇄ TruppCard under the same key, i.e. a REMOUNT — without this memory the fresh
  // mount replayed the ring + scroll on every collapse, long after the gesture that pointed
  // there (Feldtest 08.09., «Trupp Schmid blinkt nach collapse»). A ref, not state: recording a
  // finished flash must not itself re-render the board. ⚠️ It is therefore read only in the
  // card's flash EFFECT (`flashSeen` / `onFlashed`), never here while rendering — `cards()` runs
  // during render, and a ref read there is what react-hooks/refs counts once per call site.
  const flashSeen = useRef(new Map<string, number>())
  const focusNonceOf = (id: string) =>
    activeFocus && (activeFocus.id === id || (markAll && sevOf(id) >= 2)) ? activeFocus.nonce : undefined

  // the cards the double-assignment band names (DoubleAssignmentBanner) wear its amber ring
  const conflicted = useMemo(() => new Set(doubleAssignments(trupps).flatMap((c) => c.truppIds)), [trupps])
  const cards = (list: Trupp[]) => list.map((t) => {
    const nonce = focusNonceOf(t.id)
    const seen = nonce == null ? undefined : () => flashSeen.current.get(t.id) === nonce
    const flashed = nonce == null ? undefined : () => flashSeen.current.set(t.id, nonce)
    return (
    compact && !focusMode && openRow !== t.id ? (
      <TruppRow
        key={t.id} t={t} live={live.get(t.id)!} alarm={alarms.get(t.id)!} now={now} color={truppColors[t.id]} canEdit={canEdit} conflict={conflicted.has(t.id)}
        focusNonce={nonce} focusScroll={activeFocus?.id === t.id} flashSeen={seen} onFlashed={flashed}
        onContact={(id) => { void contactTap(id) }}
        onPressure={(id) => setPressureAsk({ id, kind: 'pressure' })}
        // the same ordinary Eintritt the card's «Im Einsatz» tile and the SafetyRow make
        onEnter={(id) => { freezeOrder(); setTruppStatus(id, 'aktiv') }}
        onOpen={() => setOpenRow(t.id)}
        lite={!!lite}
      />
    ) : (
    // Every mutation that can move a card between slots freezes the arrangement first (FREEZE_MS).
    //
    // ⚠️ `onMove` is withheld in row mode. Seven controls do not fit the banner at 375px —
    // `.cardActs` wraps, and the wrapped «Zur Übersicht» landed directly under «Entfernen» at the
    // same x, recreating the exact open-then-delete collision that moving it was meant to prevent.
    // The ‹ › pair is the right one to drop: in row mode the card is a detail view, not a board
    // slot (and those arrows are separately known to move the wrong card).
    <TruppCard
      key={t.id} t={t} live={live.get(t.id)!} alarm={alarms.get(t.id)!} now={now} color={truppColors[t.id]} canEdit={canEdit} conflict={conflicted.has(t.id)}
      intervalMin={intervalMin} frozen={frozenAt != null}
      // the phone's opened row is PARKED by the board (the effect around `--az-open-pad`), below
      // the Notfall banners — a centring scroll of its own fought that and won (10.10.2026)
      focusNonce={nonce} focusScroll={activeFocus?.id === t.id && !(compact && !focusMode)} flashSeen={seen} onFlashed={flashed}
      onContact={(id) => { void contactTap(id) }}
      onStatus={(id, s) => { freezeOrder(); setTruppStatus(id, s) }}
      onStandDown={(id) => { freezeOrder(); setTruppStatus(id, 'raus', undefined, { undoToast: true }) }}
      // the Restdruck question at «Raus melden» — every width (24.09.2026, see PressureSheet)
      onAskExit={(id) => setPressureAsk({ id, kind: 'exit' })}
      // …and the card's Druck is the same picker, on EVERY board since 29.09.2026 (the tablet's
      // ± stepper went with the tablet card — see TruppCard)
      onAskPressure={(id) => setPressureAsk({ id, kind: 'pressure' })}
      // the phone board's section heads say Drin / Bereit / Draussen; everywhere else the card does
      headed={phoneMode}
      onEdit={(focus) => openForm('edit', t, focus)} onReenter={() => openForm('redeploy', t)}
      onQuick={canEdit ? (kind) => setQuick({ id: t.id, kind }) : undefined}
      onDelete={deleteTrupp} onPlace={handlePlace} onShowPlan={focusTruppOnPlan}
      // ⚠️ never on a work squad. The arrows move one GLOBAL order while the board renders two
      // filtered sections, so a step can swap a Trupp past the section boundary and look like it
      // did nothing — and these Trupps never had them (they lived on `PlainTruppRow`, which had
      // no such control at all). See the note on `.cardActs`' old ‹ › pair above.
      onMove={order === 'manuell' && !compact && isAtemschutzTrupp(t) ? onMove : undefined}
      onShowLine={showTruppLine} hasLine={truppsWithLine.has(t.id)} drawnLineNo={lineNoOf?.get(t.id)} dockedAt={dockedAt?.get(t.id)}
      // «Tafel pur»: everything that points at the Karte or a drawn Leitung is unreachable from
      // this session, and a control that will fail is worse than no control (see `lite` above).
      lite={!!lite}
      onCollapse={compact && !focusMode ? () => setOpenRow(null) : undefined}
      // the handed-over phone board: the card IS the page, and the Notfall Trupp's page opens on
      // the Notfall itself (Atemschutz-Link redesign R1, 30.10.2026 — AtemschutzNotfall)
      page={focusMode}
      pageHead={focusMode && frozenAt == null && truppInNotfall(t) ? (
        <NotfallPageHead t={t} now={now} sinceContactSec={live.get(t.id)?.sinceContactSec ?? null} {...safetyFor(t)}
          otherSafety={noCandidates ? undefined : (trigger) => candidateMenu(t.id, trigger)} />
      ) : undefined}
      // the Atemschutznotfall's two held doors (F1) — a closed Einsatz raises and ends nothing
      onNotfall={canEdit && triggerNotfall && frozenAt == null ? () => { freezeOrder(); triggerNotfall(t.id) } : undefined}
      onNotfallEnd={canEdit && endNotfall && frozenAt == null ? () => { freezeOrder(); endNotfall(t.id) } : undefined}
    />
    )
  )})

  /* ── The due clocks stay in view while a Trupp is being registered (24.09.2026, D1 ⑥) ──────────
   * On 23.09. T4 and T5 were registered on a full-screen form while T3, T1 and T2 went überfällig
   * one after the other behind it. On the phone board the form is a bottom sheet now, and ABOVE
   * it stand the Trupps that are due or overdue — at most two, the most urgent first (the «Drin»
   * order), each with its live clock and a live «Kontakt» that confirms without leaving the form.
   * Nothing due ⇒ nothing pinned. After a tap the pinned set holds for the same 2 s the board's
   * order does: the tapped row drops out of «due» the instant its clock resets, and the row below
   * would otherwise slide up under the finger that is about to tap again. */
  // …and the row just confirmed shows «✓ Bestätigt», disabled, for that hold (review 25.09.2026):
  // it stays under the finger, and a second tap on it was a second Kontakt from the same device
  const [pinHeld, setPinHeld] = useState<{ ids: string[]; done: string[] } | null>(null)
  useEffect(() => {
    if (!pinHeld) return
    const h = window.setTimeout(() => setPinHeld(null), FREEZE_MS)
    return () => window.clearTimeout(h)
  }, [pinHeld])
  const pinnedDue: Trupp[] = !phoneMode || !form ? []
    : pinHeld ? pinHeld.ids.map((id) => trupps.find((t) => t.id === id)).filter((t): t is Trupp => !!t && inFieldNow(t))
    : phoneIn.filter((t) => isAtemschutzTrupp(t) && sevOf(t.id) >= 1).slice(0, 2)
  const pinnedRows = pinnedDue.length > 0 ? (
    <div className={s.formPinned} role="region" aria-label={az.pinnedLabel} data-swipe-ignore="">
      {pinnedDue.map((t) => (
        <PinnedRow key={t.id} t={t} live={live.get(t.id)!} alarm={alarms.get(t.id)!} color={truppColors[t.id]}
          confirmed={!!pinHeld?.done.includes(t.id)}
          onContact={(id) => {
            // marked at once (a double tap lands in the same frame), taken back if the double-contact
            // question was answered «OK» and nothing was written
            setPinHeld({ ids: pinnedDue.map((x) => x.id), done: [...(pinHeld?.done ?? []), id] })
            void contactTap(id).then((ok) => {
              if (!ok) setPinHeld((h) => (h ? { ...h, done: h.done.filter((x) => x !== id) } : h))
            })
          }} />
      ))}
    </div>
  ) : null

  /* «Bestimmen» at the SICHERUNGSTRUPP head (24.09.2026, D1 ⑦; a section head like DRIN /
   * DRAUSSEN since 26.09.2026, phone card slim-down — the dashed «Kein Sicherungstrupp · Ein Trupp
   * ist drin» box said in two sentences what an empty section under its own head says by itself):
   * take one of the Trupps standing ready (its Auftrag becomes «Sichern» — an ordinary edit: its
   * own Verlauf row, its own ↶), or register a new one with «Sichern» preset. With nobody ready it
   * is the form directly. */
  const safetyPickNew = () => openForm('create', undefined, undefined, undefined, 'sichern')
  const safetyPickButton = (
    <button type="button" className={s.sectAct} onClick={phoneReady.length ? undefined : safetyPickNew}>
      {az.safetyPick}
    </button>
  )

  // What the bell says of itself. The order matters: «nicht freigegeben» only applies while the
  // alarm claims to be on — a muted bell promises no tone anyway, so two warnings about the same
  // silence would be one too many (useAtemschutzMute already folds that into `audioBlocked`).
  // ⚠️ «sonst meldet nur die Benachrichtigung» (alarmBlocked) is a PROMISE this browser must be
  // able to keep — a plain Safari tab on iOS never gets a `Notification` global at all (field
  // feedback, 02.09.: «Ich erhalte keinen Ton oder Vibration … »), so telling that operator a
  // fallback exists is worse than saying nothing: it reads as «something will still alert me»
  // when NOTHING will until the tone itself is unlocked. `notificationsSupported()` is a static
  // capability check (permission aside), so this never flickers with permission state.
  // ⚠️ Appended, not swapped in, on the DEMO only: the demo mutes tone + OS notification
  // everywhere (useAtemschutzAlarm's `demo` gate — its incident is frozen in a worked state, so
  // a real alarm here would be a false one wearing the app's own voice), and a tester who
  // presses «Kontakt» and hears nothing has no way to tell «broken» from «deliberately quiet»
  // without being told (field question, 02.09.: «Wie sollte dieser Alarm erfolgen?»). The
  // button's own honest state (an / stumm / nicht freigegeben) still reads first.
  const bellLabel = (muted ? az.alarmMuted
    : audioBlocked ? (notificationsSupported() ? az.alarmBlocked : az.alarmBlockedNoFallback)
    : az.alarmArmed) + (isDemoMode() ? ` ${az.alarmDemoNote}` : '')

  // What the QR beside the bell says of itself — the same rule as the bell: the state that is
  // TRUE now, not what the press would do.
  const shareLabel = shareLinkActive ? az.shareLinkOn : az.shareLink

  // ⚠️ ONE bell, THREE honest states — and every one of them says what is TRUE now, not what the
  // press would do (see `bellLabel` above). Rendered as ONE element so the header (every board)
  // and the lite/phone bottom rail (mock 03 · focusMode) share the exact same button rather than
  // two copies that could drift.
  const bellButton = (
    <button
      className={cx(s.muteBtn, muted && s.muteOn, audioBlocked && s.muteBlocked)}
      data-fold={HEAD_FOLD.bell}
      onClick={audioBlocked ? onUnlockAudio : onToggleMuted}
      aria-pressed={muted}
      aria-label={bellLabel} title={bellLabel}
    >
      <Icon id={muted ? 'bell-off' : 'bell'} />
      {/* the WORD wherever the head has room (22.09.2026; measured since 28.09.2026 — the head's
          ladder, `HEAD_FOLD`): three unlabelled squares beside «Trupp anmelden» were a guess for
          anybody who had not held them. Where the row runs out the bell gives it up last of the
          tiles — it is its honest state — and the hold-tooltip is the way of asking. The focus
          board keeps the square: its row belongs to the Einsatz name. */}
      {!focusMode && <span className="fold-long">{muted ? az.alarmMutedWord : audioBlocked ? az.alarmBlockedWord : az.alarmWord}</span>}
    </button>
  )

  /* ── The board's own sync/clock line, under the subtitle ──────────────────────────────────
   * Same vocabulary as the incident switcher (its copy, its chip classes — learned once):
   * quiet while the record is safe (tick / amber dot + «Gespeichert um HH:MM» in the
   * subtitle's voice, so it never competes with a Trupp card), a LOUD chip for
   * offline/error/storage — the case this line exists for — dated with the last synced
   * Stand, and an independent chip when this device's clock is minutes off (every contact
   * clock here is device-local time). */
  const cpSync = appConfig.copy.incidentSwitcher
  const savedAtText = lastSyncedAt != null
    ? fillTemplate(cpSync.savedAt, { t: formatTime(new Date(lastSyncedAt)) })
    : cpSync.saved
  const syncShort: Record<'offline' | 'error' | 'storage', string> = {
    offline: cpSync.offlineShort, error: cpSync.errorShort, storage: cpSync.storageShort,
  }
  const syncLong: Record<'offline' | 'error' | 'storage', string> = {
    offline: cpSync.badgeOffline, error: cpSync.badgeError, storage: cpSync.badgeStorage,
  }
  const skewMin = clockSkewMs != null ? Math.round(clockSkewMs / 60_000) : null
  const skewLoud = skewMin != null && Math.abs(skewMin) > CLOCK_SKEW_WARN_MIN
  /* ⚠️ A <span>, not a <div> (09.09.): on the phone focus board this whole line rides INSIDE the
   * title's popover trigger, and a <button> may only contain phrasing content. `.az-syncline` is
   * `display: flex`, which a span wears exactly as a div does — the tablet header is unchanged. */
  const syncLine = (syncStatus || skewLoud) && (
    <span className="az-syncline" data-fit-check>
      {syncStatus === 'synced' || syncStatus === 'pending' ? (
        <span className={cx('az-sync-quiet', syncStatus === 'pending' && 'az-sync-pending')}
          data-fold={focusMode ? undefined : `${HEAD_FOLD.saved} ${HEAD_FOLD.savedMark}`}
          title={syncStatus === 'pending' ? cpSync.badgePending : savedAtText}>
          {syncStatus === 'synced' ? <Icon id="check" /> : <span className="ip-status-dot" />}
          {/* ⚠️ On the phone focus board the QUIET state is the mark ALONE — no «18:05» beside
              it (09.09., maintainer review of the one-row head). It shrank to the bare time on
              03.09. because there was no room for the sentence; on a one-row head there is no
              room for the time either, and a naked clock in a header is the one thing on this
              screen that could be read as an operational time rather than a save stamp.
              ⚠️ The Stand is NOT gone: it stands in full — «Gespeichert um 18:05» — behind the
              Einsatz title beside it (`headDetail`), and in `title` here. The 01.09. safety rule
              is that this surface says ITSELF whether what it shows is saved; the mark still
              says it, at a glance, and so do the LOUD states below, which keep printing their
              Stand inline because they are the states that rule exists for. */}
          {/* …and on the full board the word loses its time FIRST when the head runs out of room
              (owner, staging 26.09.2026: «Gespeichert um 14:49» was cut to «Gespeichert um …» —
              the time lost anyway, the sentence broken). Measured since 28.09.2026: the first rung
              of the head's ladder (`HEAD_FOLD.saved`); the time stands in `title` either way. */}
          {/* …and since 30.10.2026 (link redesign R1) the focus board's head has its second line
              back, so the mark carries its bare time again — «✓ 12:12» after the address, where
              it reads as the save stamp of that line, not as an operational time. */}
          {focusMode ? (lastSyncedAt != null && <span>{formatTime(new Date(lastSyncedAt))}</span>) : (
            <span>
              <span className="fold-long">{savedAtText}</span>
              <span className="fold-short">{cpSync.saved}</span>
            </span>
          )}
        </span>
      ) : syncStatus ? (
        <span className={cx('ip-offline-chip', syncStatus !== 'offline' && 'ip-error-chip')}
          title={syncLong[syncStatus]} aria-label={syncLong[syncStatus]}>
          {syncStatus === 'offline' ? <span className="ip-status-dot" /> : <Icon id="warn" />}
          <span>{lastSyncedAt != null
            ? fillTemplate(az.syncStand, { status: syncShort[syncStatus], t: formatTime(new Date(lastSyncedAt)) })
            : syncShort[syncStatus]}</span>
        </span>
      ) : null}
      {skewLoud && (
        <span className="ip-offline-chip"
          title={fillTemplate(cpSync.clockSkewToast, { n: Math.abs(skewMin) })}
          aria-label={fillTemplate(cpSync.clockSkewToast, { n: Math.abs(skewMin) })}>
          <Icon id="warn" />
          <span>{fillTemplate(az.clockSkewChip, { d: skewMin > 0 ? `+${skewMin}` : String(skewMin) })}</span>
        </span>
      )}
    </span>
  )

  /* ── What the cut-off title opens (09.09., mock 01) ────────────────────────────────────────
   * The one-row head buys its row by cutting the Einsatz name, so the cut part needs a door —
   * and the title itself is the only place anybody would knock. What stands behind it is
   * exactly what the two-row head used to print and nothing more: the Stichwort and the
   * Adresse whole (wrapping, never ellipsized — this panel has the room the row does not), and
   * the sync state in its LONG voice, «Gespeichert um 18:05» rather than the bare time the row
   * shrank it to. Anything else here would be a second Einsatz-Karte on a board whose whole
   * point is that it shows Trupps.
   * ⚠️ `title`/`address` come from the same two fields `subtitle` is joined out of
   * (IncidentWorkspace) — printed apart here, because a wrapped «Stichwort · Adresse» breaks
   * at whatever character the width happens to land on. The join stays the fallback, so an
   * older caller that only passes `subtitle` still says something true. */
  const headDetail = (
    <div className="az-hd">
      <p className="az-hd-title">{lite?.title ?? lite?.subtitle ?? az.boardTitle}</p>
      {lite?.address && <p className="az-hd-addr">{lite.address}</p>}
      {/* «Passiert, dass ich drücke. Benötigte dann den Code nochmals.» (field feedback, 02.09.,
          Safari's own ✕): the ADDRESS is the way back — the same link again, from the message, the
          history or the QR — and the board says so. A once-per-device toast until 30.10.2026; the
          link board shows no toasts since sweep #23, so it is one line here, where the holder looks
          for «what is this board» (Atemschutz-Link redesign R1). It says the LINK, never the
          device: a link signs nothing in on this phone (reworded 02.09.). */}
      {lite && <p className="az-hd-hint">{az.linkReentryHint}</p>}
      {(syncStatus || skewLoud) && (
        <div className="az-hd-sync">
          {syncStatus === 'synced' || syncStatus === 'pending' ? (
            <span className={cx('az-sync-quiet', syncStatus === 'pending' && 'az-sync-pending')}>
              {syncStatus === 'synced' ? <Icon id="check" /> : <span className="ip-status-dot" />}
              <span>{syncStatus === 'pending' ? cpSync.badgePending : savedAtText}</span>
            </span>
          ) : syncStatus ? (
            <span className={cx('ip-offline-chip', syncStatus !== 'offline' && 'ip-error-chip')}>
              {syncStatus === 'offline' ? <span className="ip-status-dot" /> : <Icon id="warn" />}
              <span>{syncLong[syncStatus]}</span>
            </span>
          ) : null}
          {skewLoud && (
            <span className="ip-offline-chip">
              <Icon id="warn" />
              <span>{fillTemplate(cpSync.clockSkewToast, { n: Math.abs(skewMin) })}</span>
            </span>
          )}
        </div>
      )}
    </div>
  )

  // ONE ROW (lib/pageHeadFit): the head folds words — the quiet line's time, the tiles' words,
  // «Trupp anmelden» → «Trupp» — until it fits, re-measured whenever what it carries changes
  const headRef = useRef<HTMLElement>(null)
  usePageHeadFit(headRef, [
    focusMode, overdueCount > 0 && overdueCount, removedTrupps.length > 0, trupps.length > 1, muted, audioBlocked,
    shareLinkActive, syncStatus, lastSyncedAt, skewLoud, canEdit,
  ].join('|'))

  /* The Notfall's Sicherungstrupp doors, as the banner (every board) and the link page's head
   * (focusMode) both offer them — ONE set (AtemschutzNotfall · safetyAct). «Sicherungstrupp
   * bestimmen» (owner, 30.10.2026, «Becomes Sicherung»), and on the link page «Anderer ⌄» beside a
   * ready one, are the same candidate menu: every other Atemschutz-Trupp, grouped under the phone
   * board's own heads — Bereit, Drin, Draussen — then «Neuen Trupp anmelden (Sichern)». A crew
   * bereit or inside turns «Sichern» in one act (designateSafety: its own Verlauf row, one ↶); a
   * crew that is out needs a fresh bottle first, so its pick opens its re-entry form on «Sichern». */
  const candidateMenu = (forId: string, trigger: ReactElement) => (
    <Menu trigger={trigger} popupClassName="rp-print-menu" itemClassName={() => 'rp-print-menu-item'}
      items={[
        ...notfallCandidates.flatMap((group, gi) => group.length === 0 ? [] : [
          { kind: 'head' as const, label: [az.phoneSectionReady, az.phoneSectionIn, az.phoneSectionOut][gi] },
          ...group.map((x) => ({
            label: [x.name, ...(x.members ?? [])].map((n) => n.trim()).filter(Boolean).join(' / '),
            onClick: x.status === 'raus' ? () => openForm('redeploy', { ...x, auftrag: 'sichern' })
              : designateSafety ? () => { freezeOrder(); designateSafety(x.id, forId) }
              : () => editTrupp(x.id, truppFieldsOf(x, { auftrag: 'sichern' })),
          })),
        ]),
        { kind: 'sep' as const },
        { label: az.safetyPickNew, onClick: safetyPickNew },
      ]} />
  )
  const noCandidates = notfallCandidates.every((g) => g.length === 0)
  const safetyFor = (t: Trupp): SafetyActProps => ({
    ready: notfallReady, inside: notfallSafetyInside, canEdit,
    onDeploySafety: (id) => { freezeOrder(); setTruppStatus(id, 'aktiv') },
    pickSafety: (trigger) => (
      <Menu trigger={trigger} popupClassName="rp-print-menu" itemClassName={() => 'rp-print-menu-item'}
        items={[
          { kind: 'head' as const, label: az.notfall.sitrPickTitle },
          ...notfallReady.map((x) => ({
            label: [x.name, ...(x.members ?? [])].map((n) => n.trim()).filter(Boolean).join(' / '),
            onClick: () => { freezeOrder(); setTruppStatus(x.id, 'aktiv') },
          })),
        ]} />
    ),
    onDefineSafety: safetyPickNew,
    defineSafety: noCandidates ? undefined : (trigger) => candidateMenu(t.id, trigger),
  })
  // the link board: which red strips stand under its header (lib/notfall · notfallStrips), and
  // whether the open page is the Notfall itself (its red rail and tint, `.bodyFocusNf`)
  const nfStrips = focusMode ? notfallStrips(notfallTrupps, focusId) : []
  const focusInNotfall = focusMode && notfallTrupps.some((t) => t.id === focusId)

  return (
    // `az-tafel`: the global hook the Meldeleiste folds itself to one row for, and moves the
    // Tafel below itself on (08-toasts · staging r3)
    <div className={cx(s.surface, lite && s.surfaceLite, frozenAt != null && s.surfaceFrozen, 'az-tafel')} onPointerDownCapture={primeOnFirstTap}>
      <header ref={headRef} className={cx(s.head, focusMode && s.headCompact)}>
        <div className={cx(s.headTitles, focusMode && s.headTitlesCompact)}>
          {focusMode ? (
            /* mock 03: the kicker is GONE here — «Atemschutzüberwachung» cost a whole row's
               height to repeat what the whole screen is already for, and the strip below already
               reads «Trupp». Only the Einsatz's own name earns this line, alongside the shrunk
               sync state (see `syncLine` above); the bell stays right of it, in `.headActs`. */
            <div className={s.headRow}>
              {/* focusMode is `lite && compact`, so this is always the Einsatz — the fallback
                  exists only so the line can never render empty.
                  ⚠️ …and the line is now a DOOR (09.09., mock 01). One row means the name is cut
                  where the buttons begin — «Brand PV Anlage · Amselstr…» — so the part that was
                  cut has to be reachable, and the truncated title is the one place anybody would
                  look for it. It opens the same three facts the two-row head used to print in
                  full: Stichwort, Adresse, und ob der Stand gespeichert ist.
                  ⚠️ 30.10.2026 (link redesign R1): the name is no longer cut — the trigger carries
                  the Einsatz on two lines — and the door stays, for the long voice and the hint. */}
              {/* the title block — free of the head's fit check, its door opens the rest */}
              <h2 className={s.headTitleH} data-fit-free>
                <Popover
                  side="bottom" align="start" popupClassName="az-head-detail"
                  ariaLabel={az.headDetailTitle}
                  /* ⚠️ `--z-popover` (01-tokens.css · 60) as a number, because the Positioner
                     takes an inline z-index. The popup is portalled to <body> and would
                     otherwise sit at `auto` UNDER this very surface, which is `--z-surface` 20. */
                  zIndex={60}
                  trigger={
                    /* ⚠️ ONE target, and the sync mark is INSIDE it (09.09., maintainer review).
                       The ✓ lost its time in this pass, and a bare mark sitting beside a door is
                       the kind of ornament a thumb aims at and nothing happens — while the thing
                       it stands for (the full «Gespeichert um 18:05») is exactly what the door
                       opens. So the mark travels with the title, the whole line is the button,
                       and `--tap` keeps it a real target rather than a line of text.
                       ⚠️ The a11y NAME stays the door's — «Einsatzangaben anzeigen». The mark is
                       `aria-hidden` inside it: read out, «Häkchen» in the middle of a button
                       label names neither the button nor the state, and the state is spoken in
                       full by the panel the button opens. */
                    /* ⚠️ TWO lines since 30.10.2026 (Atemschutz-Link redesign, owner pick R1 on AB):
                       the Einsatz in full — its title, then «Adresse · ✓ 12:12» — instead of one
                       cut line «Zimm…». The popover behind it stays the door to the long voice. */
                    <button type="button" className={s.headTitleBtn}
                      title={az.headDetailOpen} aria-label={az.headDetailOpen}>
                      <span className={s.headTitle2}>
                        <b>{lite?.title ?? lite?.subtitle ?? az.boardTitle}</b>
                        {(lite?.address || syncLine) && (
                          <small>
                            {lite?.address && <span className={s.headTitleAddr}>{lite.address}</span>}
                            {/* the «· ✓ 12:12» stays glued to the end of the address however it wraps */}
                            {syncLine && <span className={s.headTitleSync} aria-hidden="true">{lite?.address && '·'}{syncLine}</span>}
                          </small>
                        )}
                      </span>
                      <Icon id="chevron-down" className="chev" />
                    </button>
                  }
                >
                  {headDetail}
                </Popover>
              </h2>
            </div>
          ) : (
            <>
              {/* ⚠️ «Trupps» in the full app, «Atemschutzüberwachung» on the handed-over Tafel
                  (03.09.). The board carries both sections now, and the old title over a row
                  reading «Verkehr» would have named something that is not there. The link
                  session sees only the Atemschutz, so for it the old title stays TRUE — and it
                  is the one screen whose holder has nothing else telling them what they are
                  looking at. */}
              {lite ? (
                /* the handed-over Tafel: the kicker and the sync state share the quiet top line, the
                   Einsatz its own below — two lines, like every other head (28.09.2026; it stood three) */
                <>
                  <span className={s.liteKicker}><h2>{az.title}</h2>{syncLine}</span>
                  {/* ⚠️ The second line exists only on the handed-over Tafel, and it is the EINSATZ.
                      Nothing else on that screen names it, and «welcher Einsatz ist das» is the first
                      question somebody scanning a code from a stranger's tablet has.
                      In the full app there is no second line: it used to carry a sentence about what
                      the board is for («Lückenlose Überwachung jedes Atemschutztrupps»), which is a
                      claim the operator standing at the board has already made — dropped 04.09. */}
                  <p title={lite.subtitle}>{lite.subtitle}</p>
                </>
              ) : (
                <>
                  <h2>{az.boardTitle}</h2>
                  {syncLine}
                </>
              )}
            </>
          )}
        </div>
        {/* ⚠️ ONE group, not four siblings. `.head` used to wrap, and as direct children the badge,
            the sort menu, the mute toggle and «Trupp anlegen» wrapped INDIVIDUALLY — on a phone the
            filter stayed up beside the title while the other two dropped to a second row. Grouped,
            they stand as one block at the right end of the one row, and on the ladder's last step
            (lib/pageHeadFit) they move to the second row together. */}
        <div className={s.headActs}>
        {/* not in focus mode: the red tab and the red card already say it, and the badge cost the
            header a whole extra row on a phone */}
        {mostOverdue && !focusMode && (
          /* ⚠️ A BUTTON. It used to be a <div>: the loudest thing on the screen, saying that a
              Trupp is out of contact, and pressing it did nothing — so on a board with eight
              cards the answer to «welcher denn?» was still a scroll. It now points at the same
              card the app-wide TopBar chip points at (the most overdue one, which is also the
              one sortTrupps floats to the top), and a repeat press points again. */
          <button
            /* muted (27.09.2026): the same tile in plain grey — the count still counts, the
               head just does not shout a tone it has promised not to play */
            type="button" className={cx(s.overdueBadge, muted && s.overdueQuiet)} data-fold={HEAD_FOLD.overdue}
            aria-live="assertive"
            title={fillTemplate(az.overdueBadgeGo, { name: mostOverdue.name })}
            aria-label={fillTemplate(az.overdueBadgeGo, { name: mostOverdue.name })}
            onClick={() => setSelfFocus({ id: mostOverdue.id, nonce: Date.now(), markAll: true })}
          >
            <Icon id="warn" /><span className="fold-long">{az.overdueBadge(overdueCount)}</span>
            {/* a crowded head keeps the ⚠ and the number (the head's ladder, `HEAD_FOLD`) */}
            <span className="fold-short" aria-hidden="true">{overdueCount}</span>
          </button>
        )}
        {/* ⚠️ The way back that does not expire. Deleting a Trupp raises a «Rückgängig» toast for six
            seconds; miss it — gloves, 3am, a second Trupp overdue — and the card was unreachable,
            even though the record itself keeps it (types · Trupp.removedAt). Shown only while there
            IS something to bring back, so an ordinary board never carries it.
            ⚠️ BEFORE the sort filter (05.09.): the two icons sat the other way round, and the one
            that undoes something belongs nearer the badge than the one that only changes how the
            board is looked at.
            ⚠️ #archive, not #undo (08.09.2026). This header carries a REAL ↶ ↷ pair now, and two
            undo arrows in one row meaning two different things is the kind of guess nobody should
            be making at 3am. Archive is also the truer word: these cards were taken off the board
            and are still in the record, which is exactly what the menu offers back. */}
        {canEdit && removedTrupps.length > 0 && (
          <Menu
            trigger={
              <button type="button" className={s.orderBtn} data-fold={HEAD_FOLD.restore} aria-label={az.restoreMenu} title={az.restoreMenu}>
                <Icon id="archive" /><span className="fold-long">{az.restoreMenu}</span>
              </button>
            }
            popupClassName="rp-print-menu"
            itemClassName={() => 'rp-print-menu-item'}
            items={[
              { kind: 'head' as const, label: az.restoreMenu },
              ...removedTrupps.map((t) => ({
                label: fillTemplate(az.restoreItem, { name: t.name }),
                onClick: () => restoreTrupp(t),
              })),
            ]}
          />
        )}
        {/* ⚠️ The handed-over Tafel has no TopBar at all (IncidentWorkspace · «Tafel pur»), so the
            app's one ↶ ↷ pair has to live here — driving the SAME global timeline (lib/undoTimeline),
            not a second history of its own. Only trupp actions can reach this session's stack, so
            what it takes back is always something on this board.
            ⚠️ `lite` only: in the full app the TopBar carries the pair, and a second door beside it
            would be two controls for one history — the mistake AnwesenheitView documents. And the
            pair is WHOLE: a ↶ without its ↷ makes the step back the one thing that cannot itself
            be taken back. */}
        {lite && canEdit && onUndo && onRedo && (
          <>
            <button type="button" className={s.orderBtn} onClick={onUndo} disabled={!canUndo}
              aria-label={undoWord} title={undoWord}>
              <Icon id="undo" />
            </button>
            <button type="button" className={s.orderBtn} onClick={onRedo} disabled={!canRedo}
              aria-label={redoWord} title={redoWord}>
              <Icon id="redo" />
            </button>
          </>
        )}
        {/* ⚠️ A MENU, not a segmented control. Four options laid out in full needed ~380px in a
            header that also carries a title, a subtitle, an überfällig badge, the alarm toggle and
            «Neuer Trupp» — so it grew over the subtitle and covered the sentence explaining what
            the board is. A way of LOOKING at the board is not worth a permanent strip of the one
            screen that exists to show overdue Trupps; behind its own icon it costs 44px and the
            current choice still shows as a tick when it is opened. */}
        {/* not on the phone board: its arrangement is fixed (see `phoneMode`) */}
        {trupps.length > 1 && onOrder && !lite && !phoneMode && (
          <Menu
            trigger={
              <button type="button" className={s.orderBtn} data-fold={HEAD_FOLD.order} aria-label={az.orderLabel} title={az.orderLabel}>
                <Icon id="filter" /><span className="fold-long">{az.orderLabel}</span>
              </button>
            }
            popupClassName="rp-print-menu"
            itemClassName={() => 'rp-print-menu-item'}
            items={[
              { kind: 'head' as const, label: az.orderLabel },
              {
                kind: 'radio' as const,
                value: order,
                onChange: (v: string) => onOrder(v as TruppOrder),
                options: [
                  { value: 'manuell', label: az.orderManual },
                  { value: 'dringlichkeit', label: az.orderUrgency },
                  { value: 'auftrag', label: az.orderAuftrag },
                  { value: 'name', label: az.orderName },
                ],
              },
            ]}
          />
        )}
        {/* «Überwachung abgeben»: the QR, beside the bell, because the realistic handover in an
            Einsatz is «Handy scannen lassen» and the FU is standing on THIS page when they
            decide to. Green while a link is live — the same 44px square as the two controls
            beside it, so the header's right end stays a row of equal targets. */}
        {onShareLink && (
          <button
            type="button"
            className={cx(s.orderBtn, shareLinkActive && s.shareOn)} data-fold={HEAD_FOLD.share}
            onClick={onShareLink}
            aria-label={shareLabel} title={shareLabel}
          >
            <Icon id="qr" /><span className="fold-long">{az.shareLink}</span>
          </button>
        )}
        {/* ⚠️ Stays HERE even on the lite/phone focus board (maintainer correction, 03.09.): an
            earlier pass moved it down beside the strip, but the review put it back — top row,
            right side, beside the shrunk «Gespeichert» check. Only the chip strip and the
            compact «+» actually belong in the bottom rail. */}
        {bellButton}
        {/* in focus mode «+ Trupp» lives in the rail beside the strip — not a second one up here */}
        {canEdit && !focusMode && (
          <button className={s.newBtn} data-fold={HEAD_FOLD.newTrupp} onClick={() => openForm('create')} aria-label={az.newTrupp} title={az.newTrupp}>
            {/* the full word where it fits, the short one where the head's ladder has run out of
                everything else — never a bare «+» (every button on the ASÜ board has a word) */}
            <Icon id="plus-bold" /><span className="fold-long">{az.newTrupp}</span><span className="fold-short">{az.newTruppShort}</span>
          </button>
        )}
        </div>
      </header>

      <div className={cx(s.body, focusMode && s.bodyFocus, focusInNotfall && s.bodyFocusNf)} ref={bodyRef}>
        {/* The Atemschutznotfall stands at the TOP of the board, on every board, however it is
            sorted (F1, 08.10.2026) — the strip's row steps aside here, this is its place. Not on
            a closed Einsatz: its Tafel alarms nothing (R3). */}
        {/* …except on the handed-over phone board (focusMode): there the Notfall Trupp's own page
            IS the Notfall (NotfallPageHead, in `cards`), and every other tab stands under a red
            strip that leads to it (Atemschutz-Link redesign R1, 30.10.2026) */}
        {!focusMode && notfallTrupps.length > 0 && <div className={s.nfStack} ref={nfStackRef}>{notfallTrupps.map((t) => (
          <NotfallBanner key={t.id} t={t} now={now} place={placeOf?.(t)} dense={notfallTrupps.length > 1} wide={!compact}
            {...safetyFor(t)}
            onGo={(id) => {
              if (compact && !focusMode) setOpenRow(id)
              setPicked(id)
              setSelfFocus({ id, nonce: Date.now() })
            }} />
        ))}</div>}
        {focusMode && nfStrips.map((st) => (
          <NotfallStrip key={st.kind === 'one' ? st.t.id : 'many'} strip={st} now={now} onGo={setPicked} />
        ))}
        {/* one person in two active Trupps after a sync (audit F05) — under the Notfall, above the
            sections, on every board; the choice only where this session may write */}
        <DoubleAssignmentBanner trupps={trupps} personnel={personnel}
          onKeep={canEdit && frozenAt == null && keepInOneTrupp ? (keepId, personId) => { freezeOrder(); keepInOneTrupp(keepId, personId) } : undefined} />
        {trupps.length === 0 ? (
          <div className={s.empty}>
            <Icon id="warn" />
            <p>{az.empty}</p>
            {/* the hint teaches the writer's next step – a session that cannot add a Trupp keeps the plain line */}
            {canEdit && <span>{az.emptyHint}</span>}
            {/* The door the empty board is asking for (staging walk-through 25.09.2026): the big
                round «+» at the bottom right is the app's Verlauf-Eintrag, and on an empty board it
                is the one a first-timer taps. On the handed-over phone board «+ Trupp» is the
                bottom rail's own cell, so it is not repeated here. */}
            {canEdit && !focusMode && (
              <Button variant="primary" size="lg" className={s.emptyAct} icon={<Icon id="plus-bold" />} onClick={() => openForm('create')}>
                {/* the whole «Trupp anmelden» (newTrupp): `start` is the form's one-verb footer since 27.09.2026 */}
                {az.newTrupp}
              </Button>
            )}
          </div>
        ) : focusMode ? (
          /* the page fills the port at least, its reading on top and its tiles at the foot, right
             over the bottom rail (TruppCard · `page`, `.pageActs`; 31.10.2026: «read at the top,
             tap at the bottom») — the strip that used to sit above it moved to the rail below
             (mock 03: «status where the eyes land, actions where the thumb lives»). Taller than
             the port, the page scrolls and the tiles follow its content. */
          <div className={s.focusCard}>{cards(board.filter((t) => t.id === focusId))}</div>
        ) : phoneMode ? (
          // `.phoneBoard`: the one rule for the air above every section after the first (30.09.2026)
          <div ref={listRef} className={cx(s.phoneBoard, openRow && s.rowListOpen)}>
            {phoneIn.length > 0 && (
              <>
                <div className={s.sect}><span className={s.sectTitle}>{az.phoneSectionIn}</span><span className={s.sectCount}>{phoneIn.length}</span></div>
                <div className={s.rowList}>{cards(phoneIn)}</div>
              </>
            )}
            {/* the Sicherungstrupp keeps ONE place: under the crews inside, above everybody else —
                ALWAYS, filled or empty (D1 ⑦, 24.09.2026). Since 26.09.2026 (phone card slim-down)
                it is a section head like DRIN / DRAUSSEN — «SICHERUNGSTRUPP ——— Bestimmen» — with
                the standing Trupp as an ordinary row under it, or nothing: the empty section IS the
                statement, and the head's title turns amber the moment a crew is inside and nobody
                stands ready (`sectDue`, a hint in the warn tone — the alarm rules do not know it).
                The dashed box with «Kein Sicherungstrupp · Ein Trupp ist drin» went with the
                slim-down: two sentences for what the empty section says by itself.
                ⚠️ Not once every Trupp is OUT (review 25.09.2026): with nobody in and nobody
                waiting there is nothing to secure, and «Bestimmen» would register a crew for an
                Einsatz that is winding down. */}
            {(phoneIn.length > 0 || phoneReady.length > 0 || phoneSafety.length > 0) && (
              <div className={cx(s.rowList, s.safetyZone)}>
                <div className={cx(s.sect, s.sectSafety, phoneSafety.length === 0 && phoneIn.length > 0 && s.sectDue)}>
                  <span className={s.sectTitle}>{az.safetyTitle}</span>
                  {phoneSafety.length > 0 && <span className={s.sectCount}>{phoneSafety.length}</span>}
                  {canEdit && phoneSafety.length === 0 && (phoneReady.length === 0 ? safetyPickButton : (
                    <Menu
                      trigger={safetyPickButton}
                      // the app's shared menu skin (13-incident.css — despite its name, every
                      // Atemschutz menu and the audio picker wear it)
                      popupClassName="rp-print-menu"
                      itemClassName={() => 'rp-print-menu-item'}
                      items={[
                        { kind: 'head' as const, label: az.safetyPickTitle },
                        ...phoneReady.map((t) => ({
                          label: [t.name, ...(t.members ?? [])].map((n) => n.trim()).filter(Boolean).join(' / '),
                          onClick: () => editTrupp(t.id, truppFieldsOf(t, { auftrag: 'sichern' })),
                        })),
                        { kind: 'sep' as const },
                        { label: az.safetyPickNew, onClick: safetyPickNew },
                      ]}
                    />
                  ))}
                </div>
                {phoneSafety.map((t) => (openRow === t.id ? cards([t]) : (
                  // «Einsetzen» is an ordinary Eintritt; its Verlauf row says «Sicherungstrupp
                  // eingesetzt» because the Trupp is on «Sichern» (useTruppActions · setTruppStatus)
                  <SafetyRow key={t.id} t={t} canEdit={canEdit}
                    onDeploy={(id) => { freezeOrder(); setTruppStatus(id, 'aktiv') }}
                    onOpen={() => setOpenRow(t.id)} />
                )))}
              </div>
            )}
            {phoneReady.length > 0 && (
              <>
                <div className={s.sect}><span className={s.sectTitle}>{az.phoneSectionReady}</span><span className={s.sectCount}>{phoneReady.length}</span></div>
                <div className={s.rowList}>{cards(phoneReady)}</div>
              </>
            )}
            {phoneOut.length > 0 && (
              <>
                <div className={s.sect}><span className={s.sectTitle}>{az.phoneSectionOut}</span><span className={s.sectCount}>{phoneOut.length}</span></div>
                <div className={s.rowList}>{cards(phoneOut)}</div>
              </>
            )}
            {plainBoard.length > 0 && (
              <>
                <div className={cx(s.sect, s.sectSecond)}>
                  <span className={s.sectTitle}><Icon id="people" />{az.sectionPlain}</span>
                  <span className={s.sectCount}>{plainBoard.length}</span>
                </div>
                <div className={s.rowList}>{cards(plainBoard)}</div>
              </>
            )}
          </div>
        ) : !sectioned ? (
          <div ref={listRef} className={cx(compact ? s.rowList : s.grid, compact && openRow && s.rowListOpen)}>
            {cards(paBoard)}
          </div>
        ) : (
          /* ⚠️ ONE scroll wrapper around both sections, and it is what carries `listRef`. The
             open-card spacer measures the card marked `data-az-open` inside this element — with
             the ref on the first section's list, opening a Trupp in the SECOND one found no card
             and bought no room, so the card parked itself against a list that could not scroll. */
          <div ref={listRef} className={cx(compact && openRow && s.rowListOpen)}>
            <div className={s.sect}>
              <span className={s.sectTitle}><Icon id="gauge" />{az.sectionAtemschutz}</span>
              <span className={s.sectCount}>{paBoard.length}</span>
            </div>
            {paBoard.length === 0 ? (
              // in-context empty state: the head alone over nothing reads as a bug, and «nobody
              // is under PA right now» is a fact the Überwacher wants stated, not implied
              <p className={s.sectEmpty}>{az.sectionAtemschutzEmpty}</p>
            ) : (
              <div className={compact ? s.rowList : s.grid}>{cards(paBoard)}</div>
            )}
            <div className={cx(s.sect, s.sectSecond)}>
              <span className={s.sectTitle}><Icon id="people" />{az.sectionPlain}</span>
              <span className={s.sectCount}>{plainBoard.length}</span>
            </div>
            {/* ⚠️ The SAME rows and the same cards as above (03.09.). They used to be their own
                half-height `PlainTruppRow` with its controls on the row, on the argument that a
                Trupp without a contact clock has nothing further to open. It does: its Verlauf.
                And on a phone two different footprints in one scroll taught the eye that these
                are two kinds of object, when the point of the section head is that they are one
                board. What keeps them apart is the card's own restraint — no tint, no clock, no
                Kontakt — not a second layout. */}
            <div className={compact ? s.rowList : s.grid}>{cards(plainBoard)}</div>
          </div>
        )}
      </div>

      {/* ── Bottom rail (mock 03, maintainer correction 03.09. — twice: the bell was tried down
          here and put back in the header) ────────────────────────────────────────────────────
          The chip strip and «+ Trupp» move down here, into the thumb zone, mirroring the app's
          own phone bottom bars (`--rail-h`, src/styles/15-mobile.css): status/selection where
          the eyes land (the content above), actions where the thumb already rests. Rendered
          regardless of `trupps.length` so «+ Trupp» is always reachable even on an empty board —
          the strip's own grid then simply draws no tabs. Generous bottom padding
          (`env(safe-area-inset-bottom)`) keeps a thumb reaching for Kontakt or a tab away from
          Safari's own bottom chrome. */}
      {focusMode && (
        <div className={s.bottomRail}>
          <div className={s.strip} role="tablist" aria-label={az.title}>
            {board.map((t) => {
              const lv = live.get(t.id)!
              const alarm = alarms.get(t.id)!
              const sev = alarm.sev
              // the tier is the chip's tint and clock colour; its word («Überfällig» / «Alarmdruck» /
              // «Fällig», tierMark) is for the screen reader only – no glyph since 30.10.2026
              const tier = tierMark(alarm, sev)
              // the line under the name (truppCardText · tabState): «Bereit», «Rückzug 0:49», or the clock
              const st = tabState(t, lv)
              return (
                <button
                  key={t.id} type="button" role="tab" aria-selected={t.id === focusId}
                  className={cx(s.tab, t.id === focusId && s.tabOn, sev === 1 && s.tabWarn, sev >= 2 && s.tabCrit,
                    // idle grey = a crew that is out — its break clock ticks in this quiet tone; a crew
                    // at the door says «Bereit» in green instead (R1, 30.10.2026)
                    lv.status === 'raus' && s.tabIdle)}
                  onClick={() => setPicked(t.id)}
                >
                  {/* ⚠️ NO Truppfarbe dot here (round 2 review): the lite board drops every
                      colour accent — the Lage/plan identity a colour normally carries means
                      nothing on a screen that never shows the Lage or the plan. The full name
                      is what identifies the Trupp here, so it wraps rather than clips (a name
                      like «Binggeli Michael» was cut mid-word against this chip's width).
                      No «#N» badge either (Bastian, 14.09.): on a chip this narrow the number
                      fought the wrapped name for space and added nothing the card below does
                      not say – the badge stays on the card head, the phone row and the map. */}
                  <span className={cx(s.tabName, s.tabNameWrap)}>{t.name}</span>
                  <span className={cx(s.tabClock, st.tone === 'ready' && s.tabReady, st.tone === 'rueckzug' && s.tabRueckzug)}>
                    {tier && <span className="sr-only">{tier}</span>}
                    {st.word && <span className={s.tabWord}>{st.word}</span>}
                    {st.clock && <ClockVal val={st.clock} />}
                  </span>
                </button>
              )
            })}
            {/* «+ Trupp» — the LAST CELL OF THE SAME GRID (05.09.). It used to be a 44px icon
                button in a fixed column of its own beside the strip, which made it the one thing
                on the rail that was neither as wide nor as tall as a chip, and it ate width the
                names needed («Stich Markus» clipped against it). In the grid it is one more cell:
                same width, same row height, and it flows on after the last Trupp instead of
                hanging off the top-right corner. It is a plain action inside the tablist for the
                same reason a browser's own tab strip carries one — the thing that adds a tab
                belongs where the tabs are. The bell stays in the header (03.09.). */}
            {canEdit && (
              // ⚠️ «+ Trupp», with its word (29.09.2026, T9): the Add rule says «+ word» wherever there
              // is room, and this is a full cell — a bare «+» on the one screen a stranger gets
              <button type="button" className={cx(s.tab, s.tabAdd)} onClick={() => openForm('create')}
                aria-label={az.newTrupp} title={az.newTrupp}>
                <span className={s.tabName}><Icon id="plus-bold" />{az.newTruppShort}</span>
              </button>
            )}
          </div>
        </div>
      )}

      {form && (
        <TruppForm
          mode={form.mode} initial={form.trupp} presetAuftrag={form.presetAuftrag} focusSection={form.focus} roster={roster} defaultFunkkanal={defaultFunkkanal}
          personnel={personnel} presentIds={presentIds} stationIds={stationIds} rolesById={rolesById}
          /* ⚠️ NOBODY is bound while a Trupp that has come OUT is being corrected (09.09.).
             «Einer, ein Trupp» is a rule about who is deployed NOW: a finished record shares its
             people with the live board by definition — the AdF whose Trupp came out at 15:40
             stands in the next one at 15:50. Measured against the live board, correcting the
             Auftrag on the old card hit `assignedConflict`, Speichern went dead, and the
             correction was lost. `redeploy` is not this case and keeps the check: that Trupp is
             going back IN. (`assignedPersonIds` already ignores every OTHER raus Trupp, so a
             finished crew never blocks a live form either.) */
          assignedIds={form.mode === 'edit' && form.trupp?.status === 'raus' ? NO_ASSIGNED
            : assignedPersonIds(trupps.filter((t) => t.id !== form.trupp?.id))}
          /* …and the way OUT of that conflict, in one tap (11.09.). Both halves read the same
             `truppOfPerson` index, so the state the warning shows and the Trupp the move writes
             to can never be two different cards. */
          transferState={(personId) => { const from = truppOfPerson.get(personId); return truppTransferState(from, personId, from && crewSlotsOf(from)) }}
          onTransfer={transferOutOfTrupp && ((personId, toName) => {
            const from = truppOfPerson.get(personId)
            if (from) transferOutOfTrupp(from.id, personId, toName)
          })}
          leitungOptions={leitungOptions(form.trupp?.id)}
          lite={!!lite}
          // ⚠️ EVERY phone, not only the handed-over one (03.09.). `compact` is `useIsPhone`, so a
          // tablet — where the whole form stands in one glance — keeps the single screen; the
          // stack exists for the 375px case, where the single screen puts the fields that start
          // the safety clock below a fold nobody knows is there. Outside the link the sections
          // additionally carry the «Art des Trupps» tiles and the Ltg-Nr. (both gated `!lite`),
          // and EVERY Art of Trupp gets the same three sections — a Trupp ohne Atemschutz simply
          // has no Druck row inside «Luft & Funk» — see TruppForm.
          stack={compact}
          // the phone board's bottom sheet with the due clocks above it (D1 ⑥) — never on the
          // handed-over Tafel's phone board, which keeps its full-screen form
          sheet={phoneMode}
          pinned={pinnedRows}
          onAddGuest={onAddGuest}
          onCancel={() => setForm(null)} onSubmit={submitForm}
        />
      )}

      {pressureAsk && (() => {
        const t = trupps.find((x) => x.id === pressureAsk.id)
        // the Trupp went out (or away) on another device while the sheet stood open — nothing to ask
        if (!t || !inFieldNow(t)) return null
        const lv = live.get(t.id)!
        const close = () => setPressureAsk(null)
        return pressureAsk.kind === 'exit' ? (
          <PressureSheet t={t} title={az.exitSheetTitle} hint={az.exitSheetHint}
            last={lv.currentBar} alarmBar={alarmBarFor(t, atemschutzDoctrine())} onClose={close}
            onPick={(bar) => { freezeOrder(); setTruppStatus(t.id, 'raus', bar); close() }}
            footer={{ label: az.exitNoBar, onClick: () => { freezeOrder(); setTruppStatus(t.id, 'raus'); close() } }} />
        ) : (
          /* ⚠️ The first reading within minutes of the Eintritt REPLACES the Eingangsdruck
             (useTruppActions · recordPressure) — and the sheet says so in words instead of a
             promise it does not keep (staging walk-through 25.09.2026). It still counts as a
             Kontakt. An Eingangsdruck set on purpose is never replaced, and then the ordinary
             line stands (lib/atemschutz · earlyEntryCorrection). */
          <PressureSheet t={t} title={az.pressureSheetTitle}
            hint={earlyEntryCorrection(t, serverNow()) ? fillTemplate(az.pressureSheetFirst, { bar: t.entryPressureBar }) : az.pressureSheetHint}
            last={lv.currentBar} alarmBar={alarmBarFor(t, atemschutzDoctrine())} onClose={close}
            onPick={(bar) => { freezeOrder(); recordPressure(t.id, bar); close() }} />
        )
      })()}

      {quick && (() => {
        const t = trupps.find((x) => x.id === quick.id)
        // the Trupp left the board on another device while the sheet stood open — nothing to edit
        if (!t) return null
        const close = () => setQuick(null)
        const save = (f: TruppFields) => saveQuick(t.id, f)
        return quick.kind === 'kanal'
          ? <KanalSheet t={t} onSave={save} onClose={close} />
          : quick.kind === 'auftrag'
          ? <AuftragSheet t={t} leitungOptions={leitungOptions(t.id)} lite={!!lite}
              onSave={save} onClose={close} />
          /* the crew and the Ausrüstung — the same roster, presence and «one person, one Trupp»
             answers the form gets (see TruppForm's props below); a Trupp that has come OUT binds
             nobody, for the reason given there */
          : <TruppSheet t={t} personnel={personnel} legacyRoster={roster} presentIds={presentIds} stationIds={stationIds} rolesById={rolesById}
              assignedIds={t.status === 'raus' ? NO_ASSIGNED : assignedPersonIds(trupps.filter((x) => x.id !== t.id))}
              transferState={(personId) => { const from = truppOfPerson.get(personId); return truppTransferState(from, personId, from && crewSlotsOf(from)) }}
              onTransfer={transferOutOfTrupp && ((personId, toName) => {
                const from = truppOfPerson.get(personId)
                if (from) transferOutOfTrupp(from.id, personId, toName)
              })}
              onAddGuest={onAddGuest} onSave={save} onClose={close} />
      })()}

      {placePick && (() => {
        // the symbols already standing, minus this Trupp's own (see lib/placedTrupps · markerOptions)
        const markers = markerOptions(placePick)
        return (
        <Overlay open onClose={() => setPlacePick(null)} className={cx(s.modal, s.placeModal)} ariaLabel={az.placeWhere}>
          <div className={s.modalHead}><h3>{az.placeWhere}</h3>
            <button className="ip-x" aria-label={az.cancel} onClick={() => setPlacePick(null)}><Icon id="close" /></button>
          </div>
          <div className={s.placeOpts}>
            {placeTargets.map((tgt) => (
              <button key={tgt.id} className={s.placeOpt} onClick={() => { placeTrupp(placePick, tgt.id); setPlacePick(null) }}>
                <Icon id={tgt.id === 'lage' ? 'map' : 'doc'} /><span>{tgt.label}</span>
              </button>
            ))}
            {/* …or take over a Trupp that is ALREADY standing somewhere — the twin of the Trupp
                form's «Gezeichnet:» Leitung quick-picks: the thing is already in the picture, so
                the app offers it instead of making somebody place a second symbol for one crew.
                A symbol somebody else holds stays pickable and says so; the confirm is in the
                action (useTruppActions · adoptTruppMarker). */}
            {markers.length > 0 && (
              <>
                <div className={s.placeSep}>{az.markerPick}</div>
                {markers.map((m) => (
                  <button key={m.key} className={cx(s.placeOpt, s.placeOptMarker)}
                    onClick={() => { adoptMarker(placePick, m.key); setPlacePick(null) }}>
                    <span>
                      <span className={s.placeOptCap} style={{ background: m.color || appConfig.drawing.teamColors[0] }} aria-hidden />
                      {m.name}
                    </span>
                    <span className={s.placeOptWhere}>
                      {/* the holder only where it says something the title does not — a Trupp's
                          own marker already carries its name (lib/placedTrupps · markerHolderNote) */}
                      {(() => {
                        const holder = markerHolderNote(m)
                        return `${m.where}${holder ? ` · ${fillTemplate(az.markerOptTaken, { name: holder })}` : ''}`
                      })()}
                    </span>
                  </button>
                ))}
              </>
            )}
          </div>
        </Overlay>
        )
      })()}
    </div>
  )
}

/** The Sicherungstrupp standing ready, on the phone board (24.09.2026): its own row in its own
 *  place, with the one action it exists for. The whole row opens its card, like every other row.
 *  Since 26.09.2026 (phone card slim-down) it stands under a SICHERUNGSTRUPP head, so the row
 *  leads with the NAME like every other row and the Eingangsdruck under it — the head says what
 *  it is, the row said it a second time. */
function SafetyRow({ t, canEdit, onDeploy, onOpen }: {
  t: Trupp; canEdit: boolean; onDeploy: (id: string) => void; onOpen: () => void
}) {
  const az = appConfig.copy.atemschutz
  return (
    <button type="button" className={cx(s.trow, s.trowSafety)} onClick={onOpen} aria-label={`${az.safetyTitle}: ${t.name}`}>
      <span className={s.trowId}>
        <span className={s.trowName}><span className={s.trowNameTxt}>{truppHeadName(t)}</span></span>
        {t.entryPressureBar ? <span className={s.trowSafetyWho}>{t.entryPressureBar} bar</span> : null}
      </span>
      <span className={s.trowAct}>
        {canEdit && <RowEnter onEnter={() => onDeploy(t.id)} />}
      </span>
    </button>
  )
}

/** One field group of a Trupp as it reads NOW — the value the edit-conflict line names. */
function fieldNow(t: Trupp, g: TruppFieldGroup): string {
  const az = appConfig.copy.atemschutz
  switch (g) {
    case 'crew': return truppLogName({ name: t.name, members: t.members })
    case 'auftrag': return truppAuftragLabel(t.auftrag) ?? '–'
    case 'ziel': return t.ziel?.trim() || '–'
    case 'lineNo': return t.lineNo != null ? String(t.lineNo) : '–'
    case 'funkkanal': return t.funkkanal != null ? String(t.funkkanal) : '–'
    case 'pressure': return `${t.entryPressureBar} bar`
    case 'kind': return isAtemschutzTrupp(t) ? az.kindAtemschutz : az.kindPlain
    case 'equipment': return truppEquipmentLabels(t.equipment).join(', ') || '–'
  }
}

/** A due or overdue Trupp pinned ABOVE the phone's Trupp form (24.09.2026, D1 ⑥): name and state,
 *  the live clock, and a worded «Kontakt» that confirms without leaving the form. ONE line, not
 *  the board row's two: the form needs the height, and these rows carry exactly one action. Not a
 *  button as a whole — opening a card from here would close the form over a half-typed Trupp. */
function PinnedRow({ t, live, alarm, color, confirmed, onContact }: {
  t: Trupp; live: TruppLive; alarm: TruppAlarm; color?: string
  /** confirmed a moment ago on this form — the button says so and takes no second tap */
  confirmed: boolean
  onContact: (id: string) => void
}) {
  const az = appConfig.copy.atemschutz
  const sev = alarm.sev
  // ⚠️ Confirmed a moment ago, the row says only THAT (staging walk-through 25.09.2026): «✓
  // Bestätigt» beside an amber «0:01 Kontakt fällig» — the tier the hold kept from before the
  // tap — read as two answers at once. A pressure alarm is not answered by a Kontakt and stays.
  const done = confirmed && alarm.reason !== 'pressure'
  const word = done ? az.clockOk : alarm.reason === 'notfall' ? az.notfall.title : alarm.reason === 'pressure' ? az.clockAlarmPressure : sev >= 2 ? az.clockOverdue : az.clockWarn
  // ⚠️ «Überfällig» / «Kontakt fällig» are not SHOWN (owner, 29.09.2026: «red is already pretty
  // obvious» — the same call as the card's state line): the row's red or amber and its Kontakt say
  // it; the word stays for a screen reader. «Alarmdruck» and «Bestätigt» stay: colour can't say those.
  const tierOnly = !done && alarm.reason !== 'pressure' && alarm.reason !== 'notfall'
  return (
    <div className={cx(s.pinRow, done ? s.pinRowDone : sev >= 2 ? s.trowCrit : s.trowWarn)}>
      <span className={s.pinName}>
        {color && <span className={s.trowDot} style={{ background: color }} aria-hidden />}
        <span className={s.pinNameTxt}>{t.name}</span>
      </span>
      <span className={s.pinTime}>
        <span className={s.pinClock}>{fmtClock(live.sinceContactSec)}</span>
        <span className={tierOnly ? 'sr-only' : s.pinState}>{word}</span>
      </span>
      {confirmed ? (
        <button type="button" className={cx(s.kontaktBtn, s.pinKontakt, s.pinDone)} disabled
          aria-label={`${az.contactDone}: ${t.name}`}>
          <Icon id="check" /><span>{az.contactDone}</span>
        </button>
      ) : (
        <button type="button" className={cx(s.kontaktBtn, s.pinKontakt, sev === 1 && s.kontaktWarn, sev >= 2 && s.kontaktCrit)}
          onClick={() => onContact(t.id)} aria-label={`${az.actContact}: ${t.name}`}>
          <Icon id="radio" /><span>{az.actContact}</span>
        </button>
      )}
    </div>
  )
}
