// The workspace's Verlauf actions that the shells call: a row back to where it happened
// (`focusEvent`), a row's pictures onto the Karte (F16), the composer's `addJournal` (Pendenz /
// Meldung / Erinnerung lifecycle included), the Durchhören player's rows, the Wiedervorlagen
// (useReminders) and «wieder in …», the voice memo and the quick photo. Split out of
// IncidentWorkspace (E1, 09.10.2026) verbatim; `pushEvent` / `log` themselves stay in the
// workspace, because half of it writes through them.

import { type Dispatch, type SetStateAction, type RefObject, useEffect, useRef } from 'react'
import type { JournalDraft } from '../components/JournalComposer'
import { appConfig } from '../config/appConfig'
import { gebaeudeDoc } from '../data/demoIncident'
import { ensureNotifyPermission } from '../lib/alarm'
import { formatAudioDuration } from '../lib/audioImport'
import { fillTemplate, formatTime } from '../lib/format'
import { newRowId, newId } from '../lib/ids'
import type { IncidentMeta } from '../lib/incidents'
import { composeJournalText } from '../lib/journalEntry'
import { mintLocalThumb } from '../lib/mediaUrl'
import { type PhotoPlacement, photoGeoLate, photoPlacement, rowPhotoGeo, photoMarker, photoGeoSettled, rowGeoFor, rememberPhotoGeo } from '../lib/photoGeo'
import { bareText } from '../lib/reminders'
import { serverNowIso } from '../lib/serverClock'
import { toast, undoToast } from '../lib/ui'
import type { UndoTimeline } from '../lib/undoTimeline'
import type { useJournal } from '../lib/useJournal'
import { useReminders } from '../lib/useReminders'
import { useVoiceMemo } from '../lib/useVoiceMemo'
import type { Doc } from '../lib/workspace'
import type { BuildingDoc, LngLat, Incident, TimelineEvent } from '../types'
import type { WorkspaceMode, PhotoRow } from './types'

/** The `kind` (lib/ui · toast) of the Verlauf's «Eintrag erfasst» family: the next one REPLACES
 *  the last instead of stacking on it. Five Meldungen in a row stacked five pills, the column grew
 *  upwards from the foot of the screen and, on a tablet, reached the composer's «Erfassen» — the
 *  tap meant for the next entry hit the toast (perf journeys, 05.10.2026; 3am: a confirmation
 *  never covers the primary action). A toast carrying an action (a photo's «Auf Karte setzen»)
 *  keeps its own pill: replacing it would take the action away. */
export const JOURNAL_SAVED_KIND = 'journal-saved'

export interface UseJournalWritersInputs {
  building: BuildingDoc | null
  setJournalOpen: Dispatch<SetStateAction<boolean>>
  setMode: Dispatch<SetStateAction<WorkspaceMode>>
  setPanel: Dispatch<SetStateAction<'layers' | null>>
  setActivePlanId: Dispatch<SetStateAction<string>>
  setPlanFocus: Dispatch<SetStateAction<{ x: number; y: number; floor: number; annoId?: string; twinEntityId?: string; flash?: boolean; nonce: number } | null>>
  flyToMapVisible: (center: LngLat, zoom: number) => void
  focusEntity: (id: string) => void
  incidentMeta: IncidentMeta
  incidentView: Incident
  doc: Doc
  tacticalLocked: boolean
  replayActive: boolean
  stepLabelRef: RefObject<string | null>
  commit: (updater: (d: Doc) => Doc, opts?: { gesture?: boolean }) => void
  emit: (op_type: string, payload?: Record<string, unknown>, opts?: { observed?: string }) => void
  log: (icon: string, text: string, kind?: TimelineEvent['kind'], audioUrl?: string, entityId?: string, opts?: { rowId?: string; subjectId?: string }) => void
  setSelectedDrawingId: Dispatch<SetStateAction<string | null>>
  setSelectedId: Dispatch<SetStateAction<string | null>>
  mode: WorkspaceMode
  pushEvent: (ev: Omit<TimelineEvent, 'id' | 't' | 'at'> & { at?: string }, id?: string) => void
  composerOpenedAtRef: RefObject<string | null>
  activePlanId: string
  uploadPhotoForRow: (rowId: string, localUrl: string) => Promise<void>
  uploadMediaForRow: (rowId: string, localUrl: string, kind: 'photo' | 'audio') => Promise<void>
  setComposerOpen: Dispatch<SetStateAction<boolean>>
  setNoteOn: Dispatch<SetStateAction<{ id: string; text: string } | null>>
  player: { row: TimelineEvent; seekSec?: number } | null
  timeline: TimelineEvent[]
  running: boolean
  undoHist: UndoTimeline
  journal: ReturnType<typeof useJournal>
}

export function useJournalWriters({
  building, setJournalOpen, setMode, setPanel, setActivePlanId, setPlanFocus, flyToMapVisible,
  focusEntity, incidentMeta, incidentView, doc, tacticalLocked, replayActive, stepLabelRef, commit, emit,
  log, setSelectedDrawingId, setSelectedId, mode, pushEvent, composerOpenedAtRef, activePlanId,
  uploadPhotoForRow, uploadMediaForRow, setComposerOpen, setNoteOn, player, timeline, running,
  undoHist, journal,
}: UseJournalWritersInputs) {
  // navigate from a Verlauf row back to wherever the event happened, then close
  // the drawer. Plan rows switch surface + document and (when located) recenter.
  const focusEvent = (e: TimelineEvent) => {
    if (e.surface === 'plan' && e.planId) {
      if (e.planId === gebaeudeDoc.id && !building) { setJournalOpen(false); return } // floor-stack gone
      setMode('plans'); setPanel(null); setActivePlanId(e.planId)
      if (e.px != null && e.py != null) setPlanFocus({ x: e.px, y: e.py, floor: e.floor ?? 0, annoId: e.annoId, nonce: Date.now() })
    } else if (e.coord) {
      setMode('map'); flyToMapVisible(e.coord, 18)
    } else if (e.entityId) {
      setMode('map')
      // a row about a DRAWING (a duplicated line or area carries the copy's id, useMapActions) lands
      // on it the way useMapActions · focusDrawing does: selected, its first vertex in view
      const d = doc.drawings.find((x) => x.id === e.entityId)
      if (d?.coords[0]) { setSelectedDrawingId(d.id); setSelectedId(null); flyToMapVisible(d.coords[0], 17.8) }
      else focusEntity(e.entityId)
    }
    setJournalOpen(false)
  }

  // --- a Verlauf photo on the Karte (F16, lib/photoGeo) ---------------------------------------
  // The reference point is the Einsatz's own coordinate; without one, the station's default view
  // (incidentView.center falls back to it), at the coarser radius.
  const ownIncidentCoord = incidentMeta.lng != null && incidentMeta.lat != null && (incidentMeta.lng !== 0 || incidentMeta.lat !== 0)
  const photoOnMap = (row: PhotoRow, i: number): PhotoPlacement | null =>
    photoPlacement(row, i, incidentView.center, ownIncidentCoord, doc.entities)
  /** the pictures of `row` that «Auf Karte setzen» would place — none where the Karte is locked */
  const placeablePhotos = (row: PhotoRow): number[] => tacticalLocked || replayActive ? []
    : (row.photoUrls ?? []).flatMap((_, i) => (photoOnMap(row, i)?.kind === 'place' ? [i] : []))
  /**
   * Put the pictures of `row` that know their place on the Karte: ONE store step (so ONE ↶
   * takes them all back, like any placement), one Verlauf row naming it, and the Karte opened
   * on the first with it selected — its panel IS the picture.
   */
  const placePhotos = (row: PhotoRow, only?: number) => {
    const indices = placeablePhotos(row).filter((i) => only == null || i === only)
    const made = indices.flatMap((i) => {
      const geo = rowPhotoGeo(row, i)
      return geo ? [photoMarker(row, i, geo, appConfig.defaults.drawingLayerId)] : []
    })
    if (!made.length) return
    const P = appConfig.copy.photoGeo
    stepLabelRef.current = P.placedStep
    // the id is derived from the picture (lib/photoGeo · photoMarkerId): one another device put
    // down a moment ago is the same marker, and stays as it is
    commit((d) => ({ ...d, entities: [...d.entities, ...made.filter((m) => !d.entities.some((e) => e.id === m.id))] }))
    for (const e of made) emit('entity.add', { id: e.id, kind: 'photo', entity: e })
    // 'cam' + 'symbol': a Lage row («Kroki»). NOT 'photo' — that glyph and kind are the
    // composer's own photo entry («Info», editable by hand) and the Beilage (lib/report).
    log('cam', made.length === 1 ? P.logPlaced : fillTemplate(P.logPlacedN, { n: made.length }), 'symbol', undefined, made[0].id)
    setJournalOpen(false); setMode('map'); setPanel(null)
    setSelectedDrawingId(null); setSelectedId(made[0].id)
    flyToMapVisible(made[0].coord, 18.4)
  }
  const showPhotoOnMap = (entityId: string) => {
    const e = doc.entities.find((x) => x.id === entityId); if (!e) return
    setJournalOpen(false); setMode('map'); setPanel(null)
    setSelectedDrawingId(null); setSelectedId(entityId); flyToMapVisible(e.coord, 18.4)
  }

  // quick-add a journal entry (text and/or voice memo), optionally pinned to the
  // current view so the row becomes a clickable, located marker.
  const addJournal = (d: JournalDraft, geoSettled = false) => {
    // a save pressed the instant a picture was picked waits (a few ms, at most
    // PHOTO_GEO_WAIT_MS) for its position to be read — it used to go out without it
    const geoWait = geoSettled ? null : photoGeoSettled(d.photoUrls ?? [])
    if (geoWait) { void geoWait.then(() => addJournal(d, true)); return }
    const onPlan = mode === 'plans'
    // ⚠️ No coordinate. «An aktueller Kartenmitte anheften» is gone (14.08.): it wrote the
    // centre of whatever happened to be on screen — neither where the author stood nor where
    // the event was — and its only payoff was that the row could fly the map back to that spot.
    // The Wiedergabe answers the question it was really asked («wie sah es da aus?») properly,
    // by scrubbing the whole picture to the moment. Rows written BEFORE this still carry their
    // coord and stay clickable; nothing reads `pinned` to decide anything else.
    const photoUrls = d.photoUrls ?? []
    // only positions near the Einsatz reach the record (lib/photoGeo · rowGeoFor)
    const photoGeo = rowGeoFor(photoUrls, incidentView.center, ownIncidentCoord)
    const icon = d.audioUrl ? 'mic' : photoUrls.length ? 'photo' : 'type'
    const kind = d.audioUrl ? 'audio' : photoUrls.length ? 'photo' : 'journal'
    const imported = d.audioMeta?.source === 'imported'
    const body = d.text
      || (imported
        ? fillTemplate(appConfig.copy.journal.audioImportedNote, { duration: d.audioMeta?.durationSec != null ? formatAudioDuration(d.audioMeta.durationSec) : '–' })
        // ⚠️ A picture needs no caption saying «Foto» — the row shows the picture. A Sprachnotiz
        // is the opposite case and keeps its label: audio has nothing to look at, so without the
        // words the row would be a blank line with a play button. (Rows already written with the
        // placeholder are cleaned at render — lib/verlauf · rowText.)
        : d.audioUrl ? `${appConfig.copy.log.audioNote}${d.secs ? ` (${d.secs}s)` : ''}` : photoUrls.length ? '' : appConfig.copy.log.journalNote)
    const rowId = newRowId('j')
    // ── Pendenz / Meldung ────────────────────────────────────────────────────────────────────
    // ⚠️ The lifecycle event rides on THIS row — the entry IS the Pendenz. «Auftrag · Trupp 2
    // entraucht Treppenhaus» is both the record and the open item; there is no shadow row.
    // ⚠️ And tracking hangs off this event, NEVER off `entryType === 'auftrag'`. Keying it to the
    // tag would turn every Auftrag row already written — live incidents and the archive alike —
    // into an eternally open Pendenz nobody can tick off. Old rows stay plain text, no migration.
    // ⚠️ A due time makes this an open item even when the ring was never touched: an Erinnerung
    // that cannot be ticked off would keep firing its banner with no way to answer it. The composer
    // enforces the same rule at its end (setDue/setOpen); this is the second half of it, for every
    // other caller of addJournal.
    // ⚠️ `!d.noteFor`: a MELDUNG with a due time is not a new item — it moves the clock of the one
    // it reports on (see the `reminder` below). Without this guard the row said `op:'note'` while
    // the hash-chained audit got a `reminder.create` for an id that exists in no row at all, and
    // the `reminder.note` event never fired: the one feature this change adds, corrupting the
    // record it is supposed to keep.
    const pendenzId = !d.noteFor && (d.pendenz || d.dueAt) ? newId('pnd') : undefined
    const reminder: TimelineEvent['reminder'] = d.noteFor
      // ⚠️ A Meldung with a due time RE-DATES the item it reports on — «Werkhof meldet 20 Minuten»
      // is exactly the moment to move the Wiedervorlage. It stays op `note`, NOT `snoozed`: the
      // note has to keep standing in the item's thread, and a snooze row is not part of it (see
      // lib/reminders · the note branch, which reads the dueAt without touching open/closed).
      ? { op: 'note', id: d.noteFor.id, dueAt: d.dueAt }
      : pendenzId
        ? {
          op: 'created', id: pendenzId,
          // the BARE text, without the «Auftrag · » tag composeJournalText adds — the list and
          // the Rapport print their own context and would otherwise stutter it (see types)
          text: body, urgent: d.pendenz?.urgent || undefined, assignee: d.assignee,
          dueAt: d.dueAt,
        }
        : undefined
    pushEvent({
      // «Wer» and «Art» are composed INTO the text (lib/journalEntry): `text` is the record —
      // Verlauf, Rapport and the hash chain all read this one string, and a row whose meaning
      // lived in a side field would read differently in the app than it does on paper. The
      // structured fields travel along for filtering, not for display.
      icon, text: composeJournalText(body, d), kind, entryType: d.entryType, reminder,
      audioUrl: d.audioUrl, photoUrls: photoUrls.length ? photoUrls : undefined, audioMeta: d.audioMeta,
      // where each picture was taken (EXIF, read at the pick — lib/photoGeo); absent when none knows
      photoGeo: photoGeo,
      // …already SERVER urls (a generic Beilage is uploaded during save, never queued), so
      // nothing here has to be swapped later the way a photo's blob: URL is
      files: d.files,
      // an imported memo lands at its confirmed recording start; everything else at composer-open
      at: (imported ? d.audioMeta?.startedAt : undefined) ?? composerOpenedAtRef.current ?? undefined,
      surface: onPlan ? 'plan' : 'map', planId: onPlan ? activePlanId : undefined,
    }, rowId)
    // A picture without an EXIF position may still be getting the DEVICE's (lib/devicePosition
    // — the iPhone's in-app camera never gives one). The row is not held for it: when the fix
    // lands, the position follows as an appended patch, and the toast offers the Karte then.
    const geoLate = photoGeoLate(photoUrls)
    if (geoLate) {
      void geoLate.then(() => {
        const next = rowGeoFor(photoUrls, incidentView.center, ownIncidentCoord)
        if (!next || JSON.stringify(next) === JSON.stringify(photoGeo ?? null)) return
        journal.appendPatch(rowId, { photoGeo: next })
        const row = { id: rowId, photoUrls, photoGeo: next }
        if (placeablePhotos(row).length) {
          toast(appConfig.copy.photoGeo.locatedLate, {
            icon: 'pin', tone: 'success',
            action: { label: appConfig.copy.photoGeo.place, onClick: () => placePhotos(row) },
          })
        }
      })
    }
    // one upload per picture; each swaps ITS OWN blob: URL for the server URL when it lands
    for (const url of photoUrls) void uploadPhotoForRow(rowId, url)
    // an imported memo's audioUrl is already the server URL (uploaded during save) — only a
    // session blob: URL (in-app recording) still needs the upload/queue path
    if (d.audioUrl?.startsWith('blob:')) void uploadMediaForRow(rowId, d.audioUrl, 'audio')
    emit('journal.add', { id: rowId, kind })
    // the Pendenz lifecycle goes into the hash-chained audit too, like create/done/snooze already do
    if (pendenzId) emit('reminder.create', { id: pendenzId, ...(d.dueAt ? { dueAt: d.dueAt } : {}) })
    else if (d.noteFor) emit('reminder.note', { id: d.noteFor.id, ...(d.dueAt ? { dueAt: d.dueAt } : {}) })
    // …and only a row that will actually ring asks for the OS permission — on this submit gesture,
    // which is the only moment a browser grants it.
    if (d.dueAt) void ensureNotifyPermission()
    // Leave the Verlauf as it was. Forcing it open is right for exactly one entry point — the
    // Verlauf's own «Eintrag» button — and there it is already open behind the composer, so it
    // is a no-op. From the phone's FAB or a checklist deep link it yanked the operator off the
    // map they were working on, for a save the toast has already confirmed.
    setComposerOpen(false)
    setNoteOn(null)
    const C = appConfig.copy.journal
    // ⚠️ The due time wins the confirmation. «Pendenz gesetzt» on a row that will ring in ten
    // minutes tells the smaller half of what was just decided — and the clock is the half that
    // acts on its own, so it is the one worth reading back.
    toast(
      d.dueAt ? C.reminderSaved
        : d.noteFor ? C.noteSaved
          : d.pendenz ? (d.pendenz.urgent ? C.pendenzUrgentSaved : C.pendenzSaved)
            : C.saved,
      // 'bell' for the timed one, the glyph the Erinnerung wears everywhere else it is met (the
      // banner, and the snooze row in the Verlauf). It was 'clock' until 23.08.; on the Verlauf
      // that glyph now means an Anwesenheits-Zeitenzeile and nothing else (lib/report · journalArea).
      {
        icon: d.dueAt ? 'bell' : d.pendenz || d.noteFor ? 'circle' : icon, tone: 'success',
        // a picture that knows where it was taken offers its place right here, at the moment it
        // was taken — the toast is the one thing on screen (lib/photoGeo). Nothing without one.
        ...(placeablePhotos({ id: rowId, photoUrls, photoGeo }).length
          ? { action: { label: appConfig.copy.photoGeo.place, onClick: () => placePhotos({ id: rowId, photoUrls, photoGeo }) } }
          : { kind: JOURNAL_SAVED_KIND }),
      },
    )
  }

  const playerRow = player?.row ?? null
  // returns the created row id (the STT confirm flow stamps it onto the draft segment);
  // `quiet` skips the toast for bulk confirms — the row appearing as a marker IS the feedback
  const addPlayerEntry = (text: string, atIso: string, quiet = false): string => {
    const rowId = newRowId('p')
    pushEvent({
      icon: 'type', text, kind: 'journal', at: atIso,
      surface: playerRow?.surface ?? 'map', planId: playerRow?.planId,
    }, rowId)
    emit('journal.add', { id: rowId, kind: 'journal' })
    if (!quiet) toast(appConfig.copy.journal.saved, { icon: 'type', tone: 'success', kind: JOURNAL_SAVED_KIND })
    return rowId
  }

  // Wiedervorlagen: derive the open set from the timeline, alert when due (shared tone +
  // OS notification), and append done/snooze rows. Paused during replay so scrubbing past a
  // due time doesn't re-alarm. The `created` rows are written by addJournal above.
  const reminders = useReminders(
    timeline,
    (ev) => {
      pushEvent({ icon: ev.icon, text: ev.text, kind: 'reminder', surface: mode === 'plans' ? 'plan' : 'map', planId: mode === 'plans' ? activePlanId : undefined, reminder: ev.reminder })
      // mirror the create emit (see addJournal) so the hash-chained audit / replay carry the FULL
      // reminder lifecycle — done + snooze + reopen — not just creation.
      const op = ev.reminder.op
      emit(op === 'done' ? 'reminder.done' : op === 'reopened' ? 'reminder.reopen' : 'reminder.snooze', { id: ev.reminder.id, ...(ev.reminder.dueAt ? { dueAt: ev.reminder.dueAt } : {}) })
    },
    {
      dueTitle: appConfig.copy.journal.dueTitle, doneLog: appConfig.copy.journal.doneLog,
      pendenzDoneLog: appConfig.copy.journal.pendenzDoneLog, snoozeLog: appConfig.copy.journal.snoozeLog,
      reopenLog: appConfig.copy.journal.reopenLog, pendenzReopenLog: appConfig.copy.journal.pendenzReopenLog,
    },
    // …and a closed Einsatz rings no Wiedervorlage either (N3): nobody is there to act on it
    !replayActive && running,
    incidentMeta.closed_at,
    // «Erledigt» is confirm-with-undo and joins the one timeline (useReminders · completeReminder)
    undoHist,
  )

  // «wieder in …» on a done row (Journal · onReminderAgain): re-raise a closed item as a FRESH
  // timed Wiedervorlage — new id, same bare text, due in `mins`. The Führungsrhythmus move
  // (Handbuch 2.4): the moment the Lagerapport-Pendenz is ticked off is when the next one gets
  // its time. Appends a normal `created` row; the closed item stays closed, nothing mutates.
  // ⚠️ A one-time action (docs/ui-conventions.md · One-time actions, 05.11.2026: a double tap
  // raised two): the row names the item it re-raises (`again`), so while the new one is open its
  // done row shows ✓ instead of the chips (lib/reminders · openReRaises); a deliberate repeat is
  // the NEW item's own done row. The toast's «Rückgängig» closes it again with a counter-row
  // («Wiedervorlage zurückgenommen») – append-only, like every Pendenz step.
  const openRef = useRef(reminders.open)
  useEffect(() => { openRef.current = reminders.open })
  const reRaisePendenz = (reminderId: string, mins: number) => {
    const src = timeline.find((e) => e.reminder?.op === 'created' && e.reminder.id === reminderId)
    if (!src) return
    const text = bareText(src)
    // server clock, like the row's own `at` (pushEvent): the Wiedervorlage is read by every
    // device, so a fast tablet must not make it ring early for the whole deployment
    const dueAt = new Date(Date.parse(serverNowIso()) + mins * 60_000).toISOString()
    const id = newId('pnd')
    pushEvent({
      icon: 'bell', kind: 'reminder',
      // the record row carries the time in words (same template the legacy composer wrote, and
      // exactly what lib/reminders · bareText knows how to strip back off)
      text: fillTemplate(appConfig.copy.journal.reminderCreated, { t: formatTime(new Date(dueAt)), text }),
      surface: mode === 'plans' ? 'plan' : 'map', planId: mode === 'plans' ? activePlanId : undefined,
      reminder: { op: 'created', id, dueAt, text, again: reminderId },
    })
    emit('reminder.create', { id, dueAt })
    // a row that will ring asks for the OS permission on this gesture, like the composer does
    void ensureNotifyPermission()
    undoToast(fillTemplate(appConfig.copy.journal.againToast, { mins: String(mins) }), () => {
      if (!openRef.current.some((r) => r.id === id)) return // closed meanwhile: nothing to take back
      pushEvent({
        icon: 'undo', kind: 'reminder', text: fillTemplate(appConfig.copy.journal.againWithdrawn, { text }),
        surface: mode === 'plans' ? 'plan' : 'map', planId: mode === 'plans' ? activePlanId : undefined,
        reminder: { op: 'done', id },
      })
      emit('reminder.done', { id })
    })
  }

  // Voice memo driven by the TopBar's Eintrag button (hold to start, tap to stop) —
  // lifecycle in useVoiceMemo; here we persist the finished clip into the journal. The
  // surface (map/plan) is snapshotted at hold-start so a mid-recording tab switch can't
  // re-file the clip (preserves the previous start-time behaviour).
  const voiceStartCtx = useRef<{ onPlan: boolean; planId: string }>({ onPlan: false, planId: activePlanId })
  const voice = useVoiceMemo(({ url, secs }) => {
    const { onPlan, planId } = voiceStartCtx.current
    const rowId = newRowId('v')
    pushEvent({
      icon: 'mic', text: `${appConfig.copy.log.audioNote} (${secs}s)`, kind: 'audio', audioUrl: url,
      audioMeta: { source: 'recorded', startedAt: new Date(Date.now() - secs * 1000).toISOString(), durationSec: secs },
      surface: onPlan ? 'plan' : 'map', planId: onPlan ? planId : undefined,
    }, rowId)
    void uploadMediaForRow(rowId, url, 'audio')
    emit('journal.add', { id: rowId, kind: 'audio' })
    toast(fillTemplate(appConfig.copy.toast.audioSaved, { secs }), { icon: 'mic', tone: 'success' })
  })
  const startVoiceMemo = () => { voiceStartCtx.current = { onPlan: mode === 'plans', planId: activePlanId }; void voice.start() }

  // «Eintrag» hold released over «Foto» (see lib/useHoldEntry): straight to the camera, no
  // composer in between — the picture IS the entry. The row is stamped at the moment of the
  // GESTURE, not of the shot: framing and confirming a photo takes half a minute, and the
  // Verlauf should say when you reached for the camera. The composer's own timestamp works the
  // same way (composerOpenedAt).
  const photoInputRef = useRef<HTMLInputElement>(null)
  const startQuickPhoto = () => { composerOpenedAtRef.current = new Date().toISOString(); photoInputRef.current?.click() }
  const onQuickPhotoPicked = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = [...(e.target.files ?? [])]
    e.target.value = '' // the same file twice in a row must still fire
    if (!files.length) return
    const urls = files.map((f) => URL.createObjectURL(f))
    // Thumbnails FIRST, then the row: its chips read the session thumbnail the moment they render
    // (lib/mediaUrl · thumbUrl), and a chip pointed at the camera file is the decode that killed
    // the tab. The row is stamped at the gesture (composerOpenedAt), so the moment it appears
    // does not move its time.
    // …and where each was taken, off the ORIGINAL file before the upload re-encodes it
    // (lib/photoGeo) — the row is written with it, so it waits for both.
    void Promise.all(files.flatMap((f, i) => [mintLocalThumb(urls[i], f), rememberPhotoGeo(urls[i], f)]))
      .then(() => addJournal({ text: '', photoUrls: urls }))
  }
  return { reminders, voice, startVoiceMemo, startQuickPhoto, focusEvent, reRaisePendenz, photoOnMap, placePhotos, showPhotoOnMap, addPlayerEntry, addJournal, photoInputRef, onQuickPhotoPicked }
}
