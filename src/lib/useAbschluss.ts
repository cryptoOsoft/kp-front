import { useCallback, useEffect, useMemo, useRef } from 'react'
import { appConfig } from '../config/appConfig'
import type { AttendanceState, MittelEntry, Trupp } from '../types'
import { closeTimeOf, isIncidentRunning, type IncidentMeta } from './api/incidents'
import type { ReportMeta } from './workspace'
import type { MediaQueueApi } from './useMediaQueue'
import { abschlussFacts, missingSteps, type AbschlussStep } from './abschluss'
import { abschlussEndeItem, abschlussOpenPoints, abschlussSheet, insideAbschlussMessage, registeredAbschlussMessage } from './abschlussOpen'
import { serverNowIso } from './serverClock'
import { truppInNotfall, truppLogName, truppStillDeployed, truppStillRegistered } from './atemschutz'
import { fillTemplate } from './format'
import { mittelLineCount } from './mittel'
import { confirmDialog } from './ui'

interface Args {
  reportMeta: ReportMeta
  attendance: AttendanceState
  mittel: MittelEntry[]
  /** unsettled Anwesenheits-Abweichungen (attendanceConflict · openConflicts over the Verlauf) —
   *  the Rapport counts them as open (lib/abschluss · abschlussFacts), so every door to it does */
  openConflictCount: number
  /** the board's Trupps (removed ones already filtered out) */
  trupps: Trupp[]
  incidentMeta: Pick<IncidentMeta, 'is_archived' | 'status' | 'closed_at' | 'last_closed_at'>
  replayActive: boolean
  media: MediaQueueApi
  /** App's handover: stamp report_done_at + close. TRUE only when the close really happened. */
  onCompleteRapport: () => Promise<boolean>
  /** the confirm's rows are links — to the Rapport step, the Trupps, the offline media sheet */
  setMode: (mode: 'rapport' | 'atemschutz') => void
  setPanel: (panel: null) => void
  setOfflineReadyOpen: (open: boolean) => void
  /** open the Rapport ON one Mindestangabe (IncidentWorkspace · requestReportStep, a stable
   *  module-level loader of the lazy ReportPreflight chunk) */
  requestReportStep: (step: AbschlussStep) => void
  /** Close these Trupps as «nicht eingesetzt» — the card's own stand-down (useTruppActions ·
   *  setTruppStatus(id, 'raus') on a Trupp that never went in), one undo step each. The caller
   *  re-checks every id against the Trupps as they stand THEN (a Sicherungstrupp sent in while the
   *  confirm stood open must never get an Austritt). Absent (a caller that may not write the
   *  Tafel) ⇒ the registered question is not asked. */
  standDownTrupps?: (ids: string[]) => void
  /** Write «Trupp N (…) beim Abschluss noch drin» for each of these (staging r3 F4) — a crew the
   *  Abschluss closes over is SAID in the Verlauf, without inventing an Austritt. Absent (a caller
   *  that may not write the record) ⇒ nothing is written. */
  noteInsideAtClose?: (trupps: Trupp[]) => void
  /** …and «Trupp N (…): Notfall beim Abschluss nicht beendet» for each Trupp still in an
   *  Atemschutznotfall when the Abschluss closes over it (F1, 08.10.2026). Same contract. */
  noteNotfallAtClose?: (trupps: Trupp[]) => void
  /** drain the Verlauf and audit outboxes — run after the media, before the handover, so what
   *  this device recorded before the close is not judged against the closed Einsatz */
  flushOutboxes?: () => Promise<void>
  /** on at the operator's confirm, off once the close has answered: rows written in between are
   *  the Abschluss's own (`TimelineEvent.atClose`, staging r6 F3) */
  markClosing?: (on: boolean) => void
  /** Write Rapport fields from the sheet (IncidentWorkspace · saveReportMeta over the live blob):
   *  the rows' buttons («Nichts verwendet», «Entfällt») and the pre-filled Einsatzende. Absent
   *  (a caller that may not edit the Rapport) ⇒ rows are links only and nothing is pre-filled. */
  patchReportMeta?: (over: Partial<ReportMeta>) => void
}

/**
 * The ONE «Einsatz abschliessen» (IncidentWorkspace, lifted out 23.09.2026): what is still open
 * (the Mindestangaben, the Trupps nobody reported out, the media still on this device), the
 * moment the Atemschutz clocks freeze at, whether the Atemschutz alarm still runs — and the one
 * confirm both doors (the Rapport and the Einsatz-Menü row) go through before the handover.
 *
 * Moved verbatim, memo and callback deps included (the one addition is the stable
 * `requestReportStep`, which used to be read off module scope), and called where the block
 * used to stand, so the hook order and every identity downstream are unchanged.
 */
export function useAbschluss({
  reportMeta, attendance, mittel, openConflictCount, trupps, incidentMeta, replayActive, media, onCompleteRapport,
  setMode, setPanel, setOfflineReadyOpen, requestReportStep, standDownTrupps, noteInsideAtClose, noteNotfallAtClose, flushOutboxes, markClosing,
  patchReportMeta,
}: Args) {
  const abschlussMissing = useMemo(
    () => missingSteps(abschlussFacts(reportMeta, Object.keys(attendance).length, mittelLineCount(mittel), openConflictCount)),
    [reportMeta, attendance, mittel, openConflictCount],
  )
  /** How many Trupps are still recorded as being out there (lib/atemschutz · truppStillDeployed).
   *  NOT an ABSCHLUSS_STEP: those are the Rapport's Mindestangaben, and this is a state of the
   *  Einsatz rather than an empty field — it rides beside them in the confirm, the way pending
   *  media does. */
  const truppsStillOut = useMemo(() => trupps.filter(truppStillDeployed).length, [trupps])
  // the Trupps as they stand NOW, for the one question asked at the moment of the Abschluss — a ref,
  // so the confirm is not re-created on every Kontakt somebody writes while the Rapport is open
  const truppsRef = useRef(trupps)
  useEffect(() => { truppsRef.current = trupps }, [trupps])
  /** The moment every Trupp clock is read against once the Einsatz is abgeschlossen — after that
   *  no more time passes on this Einsatz, and a board that kept counting was describing a
   *  situation that had ended (see AtemschutzView · `frozenAt`).
   *
   *  ⚠️ The EINSATZENDE, not `closed_at`: the record is often closed the morning after, and
   *  freezing on that would have counted the night as Einsatzzeit — the very number this fixes.
   *  `closed_at` is the fallback for an Einsatz archived without one ever being entered. */
  // ⚠️ «closed» is `isIncidentRunning`, the backend's `is_open` — and it flips LIVE when another
  // device closes the Einsatz (N3, 25.09.2026): the clocks freeze and the alarm stops on every
  // device, not only on the one that pressed «Abschliessen».
  const running = isIncidentRunning(incidentMeta)
  const closeAt = closeTimeOf(incidentMeta)
  const azFrozenAt = useMemo(() => {
    if (running) return undefined
    // the CURRENT close, not the first (D2)
    const at = Date.parse(reportMeta.endedAt ?? closeAt ?? '')
    return Number.isFinite(at) ? at : undefined
  }, [running, closeAt, reportMeta.endedAt])
  /* ⚠️ …and the ALARM stops with the clocks. It is not a display: it plays a tone and posts an OS
     notification, and it ran off the live clock regardless of the Einsatz's state — so opening a
     closed Akte with a Trupp that was never reported out started an überfällig alarm about a
     crew that went home hours ago. `active: false` stops the tone and reports a silent state, so
     the TopBar chip and the NavRail dot go quiet with it. Replay was already excluded for the
     same reason: a read-only past does not alarm. */
  const azMonitoring = !replayActive && running
  /** Resolves TRUE when the Einsatz was actually handed over for closing — the Rapport uses that
   *  to decide whether to forget its scroll position, and a cancelled confirm must not. */
  const confirmAndComplete = useCallback(async (): Promise<boolean> => {
    const A = appConfig.copy.abschluss
    const P = appConfig.copy.preflight
    /* ⚠️ Crews still INSIDE are their own, FIRST question (staging walk-through 25.09.2026). They
       were the 7th grey row of the paperwork list under a filled, focused «Trotzdem abschliessen»,
       and an Enter closed the Einsatz over three crews under PA who never got an Austritt. Now the
       sentence names them, «Zur Tafel» is the filled, focused answer, and closing anyway is the
       quiet one — and still writes nothing: an Austritt nobody reported is never invented. */
    /* ⚠️ A running ATEMSCHUTZNOTFALL is asked about before anything else (F1, 08.10.2026): closing
       the Einsatz freezes the Tafel and silences every alarm, the Notfall's included. «Zur Tafel»
       is the filled, focused answer; closing anyway is the quiet one, and the record then says
       the Notfall was never ended (noteNotfallAtClose) — it is not ended for anybody. */
    const notfall = truppsRef.current.filter(truppInNotfall)
    if (notfall.length > 0) {
      const nf = appConfig.copy.atemschutz.notfall
      const answer = await confirmDialog({
        title: nf.abschlussTitle,
        message: fillTemplate(nf.abschlussMsg, { list: notfall.map((t) => fillTemplate(nf.who, { name: truppLogName(t) })).join(', ') }),
        confirmLabel: nf.abschlussClose,
        altLabel: A.registeredToBoard,
        cancelLabel: appConfig.copy.cancel,
        safeAnswer: 'alt',
      })
      if (answer === 'alt') { setMode('atemschutz'); setPanel(null); return false }
      if (answer !== true) return false
    }
    const inside = truppsRef.current.filter(truppStillDeployed)
    if (inside.length > 0) {
      const answer = await confirmDialog({
        title: A.insideTitle,
        message: insideAbschlussMessage(inside),
        confirmLabel: A.insideClose,
        altLabel: A.registeredToBoard,
        cancelLabel: appConfig.copy.cancel,
        safeAnswer: 'alt',
      })
      if (answer === 'alt') { setMode('atemschutz'); setPanel(null); return false }
      if (answer !== true) return false
    }
    /* ⚠️ A Trupp still ANGEMELDET is asked about FIRST, on its own (24.09.2026, D1 ⑦). On 23.09.
       the Sicherungstrupp T6 stood «angemeldet» to the end, and the confirm below counted only
       the crews inside, so the record closed with a crew neither sent in nor stood down. Three
       answers: «Zur Tafel» (the focused, safe one) goes there and closes nothing; «Als «nicht
       eingesetzt» schliessen» is the SAME close-out the card offers (Trupp … nicht eingesetzt,
       undoable per Trupp); dismissing does nothing at all.
       ⚠️ The answer is only RECORDED here (review 25.09.2026). The stand-down runs after the
       final «Abschliessen» below — «schliessen» and then «Abbrechen» on the next question must
       leave every Trupp exactly as it was.
       ⚠️ Not while a crew is still recorded inside: that is the question that matters, and the
       confirm below asks it («Noch im Einsatz …»). Closing the waiting crews first would put
       «nicht eingesetzt» rows beside a Trupp nobody has reported out. */
    const registered = standDownTrupps && truppsStillOut === 0 ? truppsRef.current.filter(truppStillRegistered) : []
    let standDown: string[] = []
    if (registered.length > 0) {
      const answer = await confirmDialog({
        // every question of the chain carries a title (owner review 26.09.2026)
        title: A.registeredTitle,
        message: registeredAbschlussMessage(registered),
        confirmLabel: A.registeredStandDown,
        altLabel: A.registeredToBoard,
        cancelLabel: appConfig.copy.cancel,
        safeAnswer: 'alt',
      })
      if (answer === 'alt') { setMode('atemschutz'); setPanel(null); return false }
      if (answer !== true) return false
      standDown = registered.map((t) => t.id)
    }
    // ⚠️ Pending media belongs in this list. The Abschluss closes the incident, and a Foto or a
    // Sprachnotiz that never got a connection is still sitting on THIS device — the operator is
    // about to walk away, so that is part of what they are confirming.
    /* ⚠️ A Trupp that was never reported out belongs on this list (04.09.). It is not a missing
       Angabe — that is what `abschlussMissing` collects — but a fact about the Einsatz being
       closed over it: nobody said the crew came back, and from here on the board freezes at the
       Einsatzende, so this is the last moment anybody is asked. The Abschluss still goes through
       («Trotzdem abschliessen»), and it writes nothing by itself: closing an Einsatz must never
       put an Austritt on the record that nobody reported.
       ⚠️ Pending media belongs here too. The Abschluss closes the incident, and a Foto or a
       Sprachnotiz that never got a connection is still sitting on THIS device — the operator is
       about to walk away, so that is part of what they are confirming. */
    const go = {
      step: (st: AbschlussStep) => { setMode('rapport'); setPanel(null); requestReportStep(st) },
      trupps: () => { setMode('atemschutz'); setPanel(null) },
      media: () => setOfflineReadyOpen(true),
    }
    /* ⚠️ The Einsatzende is PRE-FILLED with «jetzt» (owner's pick): «Zeiten» stood open on
       almost every close because nothing ever set it, and the answer is nearly always «now».
       Shown as already set, with «Ändern», in the step's own place on the list; written with the
       close (below), on the server clock. Only for a caller that may write the Rapport.
       ⚠️ Closing-only: the print's «Angaben fehlen noch» does not pre-fill (printing sets no
       Einsatzende), its row offers the step's own «Jetzt setzen» (ReportPreflight · startOutput). */
    const pendingEnde = patchReportMeta && !reportMeta.endedAt ? serverNowIso() : null
    /* The rows, their order and their own answers («Nichts verwendet», «Entfällt» … 3am sweep,
       23.10.2026, owner's point 4) are the ONE list both confirms read (lib/abschlussOpen ·
       abschlussSheet): an answer is written to the Rapport at once, its row stays as a done one,
       and the ask re-reads itself (ConfirmSpec · refresh) so the lead sentence and the button
       follow. ⚠️ Every row is a LINK: naming a gap on the last screen before the Akte closes and
       leaving the operator to hunt for it is the failure the «noch offen» chips fixed on the sheet
       itself. Tapping one resolves the ask false — going there is not going ahead. */
    const sheet = abschlussSheet(abschlussOpenPoints(abschlussMissing, truppsStillOut, media.pendingCount), go, {
      write: patchReportMeta,
      now: serverNowIso,
      prefilled: pendingEnde ? { zeiten: abschlussEndeItem(pendingEnde, () => { patchReportMeta!({ endedAt: pendingEnde }); go.step('zeiten') }) } : undefined,
    })
    const spec = () => {
      // a Trupp still out counts as open for the WORDING, the way a missing Angabe does: the
      // message and the button both have to say that something is being closed over
      const { items, anyOpen } = sheet()
      return {
        message: anyOpen ? P.exportIncompleteLead : A.confirmMsg,
        items,
        note: anyOpen ? A.confirmMsg : undefined,
        // the button names what is actually about to happen — closing an Einsatz with open points
        // is allowed, and the label is where that is said out loud
        confirmLabel: anyOpen ? A.confirmAnyway : A.confirmBtn,
        /* ⚠️ …and with open points the SAFE answer is the focused, filled one (staging r2, N6,
           25.09.2026): after the crews question, an Enter on this list closed the Einsatz with
           people still missing. «Zurück» is the default, «Trotzdem abschliessen» the quiet
           choice. With nothing open, «Abschliessen» stays the primary — that is what the operator
           came here to do. (The Suche's own first question sits above this one, in its PR.) */
        cancelLabel: anyOpen ? A.confirmBack : appConfig.copy.confirm.cancel,
        safeAnswer: anyOpen ? ('cancel' as const) : undefined,
      }
    }
    const ok = await confirmDialog({ title: A.confirmTitle, ...spec(), refresh: spec })
    if (!ok) return false
    // the pre-filled Einsatzende becomes the record's with the close — one task for React to
    // commit it, so the handover's flush carries it (useIncidentLifecycle · completeRapport flushes the sync)
    if (pendingEnde) {
      patchReportMeta!({ endedAt: pendingEnde })
      await new Promise((r) => setTimeout(r, 0))
    }
    // From the confirm to the close's answer, every row this device writes is the Abschluss's
    // own (staging r6, F3): marked so, it prints as part of the close, not as a Nachtrag. (The
    // two drains below cannot throw; the close's own answer lifts the mark either way.)
    markClosing?.(true)
    if (standDown.length && standDownTrupps) {
      standDownTrupps(standDown)
      // one task for React to commit the Trupps, so the save queue holds the stand-down before
      // the handover flushes it (useIncidentLifecycle · completeRapport flushes the sync, then archives)
      await new Promise((r) => setTimeout(r, 0))
    }
    /* ⚠️ Closing over a crew still inside wrote NOTHING (staging r3 F4): the record ended with two
       open sorties and no word that the Abschluss had gone over them. One row per crew, read off
       the Trupps as they stand NOW — the Rapport ends each open sortie at the close with the same
       words (reportPdfDirect · cycleEndAtClose). Still no Austritt: nobody reported one. */
    const insideNow = truppsRef.current.filter(truppStillDeployed)
    if (insideNow.length && noteInsideAtClose) {
      noteInsideAtClose(insideNow)
      await new Promise((r) => setTimeout(r, 0)) // committed before the handover flushes
    }
    const notfallNow = truppsRef.current.filter(truppInNotfall)
    if (notfallNow.length && noteNotfallAtClose) {
      noteNotfallAtClose(notfallNow)
      await new Promise((r) => setTimeout(r, 0))
    }
    // ⚠️ Drain the media queue FIRST, from here. The Abschluss closes the incident and App then
    // drops what has already gone up (clearUploadedMedia) — and an upload also has to patch its
    // Verlauf row's blob: URL to the server one (useMediaQueue · onUploaded), which needs this
    // workspace and its journal store, both gone after the handover.
    await media.flush().catch(() => {})
    await flushOutboxes?.().catch(() => {})
    // …and the answer is the REAL outcome, not the firing of the request: App reports whether
    // the close went through, so the Rapport's kept scroll position survives a failed Abschluss
    // (offline, server error) instead of being forgotten for an Einsatz that is still open.
    return onCompleteRapport().finally(() => markClosing?.(false))
  // requestReportStep is a module-level loader of the caller's — stable, so naming it changes nothing
  }, [abschlussMissing, reportMeta.endedAt, truppsStillOut, media, onCompleteRapport, setMode, setPanel, setOfflineReadyOpen, requestReportStep, standDownTrupps, noteInsideAtClose, noteNotfallAtClose, flushOutboxes, markClosing, patchReportMeta])

  return { abschlussMissing, truppsStillOut, azFrozenAt, azMonitoring, confirmAndComplete }
}
