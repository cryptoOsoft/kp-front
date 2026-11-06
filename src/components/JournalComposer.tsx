import { ShellLoader } from './ShellLoader'
import { Button } from './Button'
import { Chip } from './Chip'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useIsPhone } from '../lib/useIsPhone'
import { Icon } from '../lib/icons'
import { Menu, Overlay } from '../lib/overlays'
import { appConfig } from '../config/appConfig'
import { getDeploymentConfig } from '../lib/deploymentConfig'
import { fillTemplate, fmtFileSize, formatTime, hhmm, pad2, stripUnprintable, formatLocale } from '../lib/format'
import { toast } from '../lib/ui'
import { ApiError } from '../lib/api'
import { forgetLocalThumb, mintLocalThumb, thumbUrl } from '../lib/mediaUrl'
import { forgetPhotoGeo, photoGeoSettled, rememberPhotoGeo } from '../lib/photoGeo'
import {
  MAX_AUDIO_UPLOAD_MB,
  MAX_FILE_UPLOAD_MB,
  MEDIA_IMPORT_ACCEPT,
  classifyPick,
  formatAudioDuration,
  probeAudioDuration,
  resolveRecordingStart,
  validateAudioImport,
  validateFileImport,
} from '../lib/audioImport'
import type { JournalEntryType, TimelineEvent } from '../types'
import { linkParts, type JournalLink } from '../lib/journalLinks'
import { acceptJournalSuggestion, journalSuggestions, type JournalSuggestion, type TextSelection } from '../lib/journalSuggestions'
import { suggestPendenzen, type OpenReminder } from '../lib/reminders'
import { startChips } from '../lib/startChips'
import { clearDraft, keepDraft, readDraft, useKeptState } from '../lib/draftKeep'
import { TimeField } from './TimeField'
import { WheelPopover, type WheelValue } from './WheelPicker'
import { dayRange } from '../lib/zeitplanFormat'
import { keyboardMargin, useKeyboardInset } from '../lib/useKeyboardInset'
import { nextCompact } from '../lib/composerFit'
import { tut } from '../lib/tutorials/anchors'

// `C` (appConfig.copy.journal) is read at the top of each component below rather than captured
// here at module-load, so the locale resolved at boot (config/copy) applies.
/** How many days the «Uhrzeit …» day wheel offers, today included. A Wiedervorlage lands today or
 *  tomorrow in nearly every case; a week covers the «nach dem Wochenende» one without turning the
 *  column into a calendar. Never earlier than today — a past day can only hold a past instant. */
const REMIND_DAYS = 7
/** ⚠️ U+2192 / U+2190, never «->» and «<-». The same character has to survive into the Verlauf,
 *  the Rapport and the PDF, and an ASCII pair renders as two characters that a search will never
 *  find as one. Both directions, because a Funkprotokoll has both: «EL → Sanität» is an order
 *  going out, «EL ← Sanität» is a message coming in, and rewriting the second as the first means
 *  reversing the sentence you just heard. */
const ARROW = '→'

export interface JournalDraft {
  text: string
  audioUrl?: string
  secs?: number
  /** structured audio metadata; for an imported memo audioUrl is already the SERVER url
   *  (upload happened during save) and startedAt is the operator-confirmed recording start */
  audioMeta?: TimelineEvent['audioMeta']
  /** several: one damage is rarely one picture (see the composer's photos state) */
  photoUrls?: string[]
  /** Beilagen that are neither picture nor recording (PDF, Dokument …). ALREADY server urls —
   *  like the imported memo, a generic file is uploaded during save and never queued offline. */
  files?: { url: string; name: string }[]
  /** ISO time this entry becomes due — the clock beside the ring. ANY entry can carry one: an
   *  Erinnerung is not a second kind of row, it is an open item that additionally says when it
   *  should come back (see lib/reminders · the dueAt distinction). */
  dueAt?: string
  /** Info · Auftrag · Sofortmassnahme; absent = an ordinary entry */
  entryType?: JournalEntryType
  /** the ○ switch: this entry stays open until it is ticked off. `urgent` sorts it to the top.
   *  Absent = an ordinary entry that nothing tracks. */
  pendenz?: { urgent: boolean }
  /** this entry is a Meldung ON an existing Pendenz (the composer was opened from its row) */
  noteFor?: { id: string }
  /** «Wer», read off the sentence (first vocabulary name) — never typed into a field */
  assignee?: string
}

// Wiedervorlage due selection: a relative "+N min" chip, or an exact date + wall-clock time.
// ⚠️ The exact one carries its DAY. It used to be «HH:MM, and if that is already past, tomorrow»
// — a rule that is right nine times out of ten and silent the tenth, on the one surface where a
// Wiedervorlage set for the wrong day is a check nobody makes. An Einsatz also runs over midnight
// and over a second day often enough that «morgen» is a real answer, not an edge case.
type DueSel = { kind: 'in'; mins: number } | { kind: 'at'; day: string; hhmm: string } | null

/** Everything the sheet holds that is NOT the sentence, kept across an unmount beside it — see
 *  the `restKey` note in the composer for why each of these is safe to hand back as it stands,
 *  and why the imported memo is the one thing that is not in here. */
type KeptRest = {
  dueSel: DueSel
  openState: 0 | 1 | 2
  entryType: JournalEntryType | null
  clip: { url: string; secs: number; startedAt: string } | null
  photos: string[]
}
const EMPTY_REST: KeptRest = { dueSel: null, openState: 0, entryType: null, clip: null, photos: [] }

/** local YYYY-MM-DD — never `toISOString().slice(0,10)`, which is UTC and jumps a day every
 *  evening west of Greenwich (and every morning east of it). */
function dayKey(d: Date): string {
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`
}

function resolveDueAt(sel: DueSel): string | null {
  if (!sel) return null
  if (sel.kind === 'in') return new Date(Date.now() + sel.mins * 60_000).toISOString()
  const [y, mo, da] = sel.day.split('-').map(Number)
  const [h, m] = sel.hhmm.split(':').map(Number)
  if ([y, mo, da, h, m].some(Number.isNaN)) return null
  return new Date(y, mo - 1, da, h, m, 0, 0).toISOString()
}

// default exact due when «Uhrzeit …» is first chosen: ~5 min out — which rolls the DAY too, so
// the picker opens on tomorrow when it is a few minutes before midnight.
function defaultExact(): { day: string; hhmm: string } {
  const d = new Date(Date.now() + 5 * 60_000)
  return { day: dayKey(d), hhmm: hhmm(d) }
}

/** the days the «Uhrzeit …» wheel offers: today and the REMIND_DAYS − 1 after it, plus the day
 *  already chosen (a kept draft can hold one outside that span — the wheel must open on it rather
 *  than show one day while OK commits another). WheelPopover de-duplicates and sorts. */
function remindDays(chosen: string): Date[] {
  const now = new Date()
  const [y, m, d] = chosen.split('-').map(Number)
  return [...dayRange(now, new Date(now.getFullYear(), now.getMonth(), now.getDate() + REMIND_DAYS - 1)), new Date(y, m - 1, d)]
}

/** «Heute · Di 18.08.» — the day the picker is set to, named the way a person would say it. */
function dayLabel(day: string): string {
  const [y, m, d] = day.split('-').map(Number)
  const date = new Date(y, m - 1, d)
  const today = new Date()
  const C = appConfig.copy.journal
  const diff = Math.round((date.getTime() - new Date(today.getFullYear(), today.getMonth(), today.getDate()).getTime()) / 86_400_000)
  const rel = diff === 0 ? C.dayToday : diff === 1 ? C.dayTomorrow : null
  const stamp = date.toLocaleDateString(formatLocale(), { weekday: 'short', day: '2-digit', month: '2-digit' })
  return rel ? `${rel} · ${stamp}` : stamp
}

// Quick-add for the unified journal: a free-text note and/or a voice memo. Reachable from both
// surfaces (mounted at app level), it records its own clip so the audio is attached to the entry
// rather than auto-logged.
// ⚠️ It no longer knows WHICH surface it was opened over, and does not need to: the «anheften»
// toggle is gone (14.08.). Its whole payoff was that the row could later fly the map to a
// coordinate, which is the weak version of what the Wiedergabe does — scrub to the moment and
// the entire picture is the one from back then. The row still records its surface; that is
// addJournal's business, not this sheet's.
export function JournalComposer({ onSubmit, onClose, incidentStartAt, uploadAudio, uploadFile, vocab = [], timeline = [], noteOn, onClearNote, openPendenzen = [], onLinkPendenz }: {
  onSubmit: (d: JournalDraft) => void
  onClose: () => void
  /** opened from a Pendenz row: everything written here becomes a Meldung ON that item rather
   *  than a free-standing entry. Deliberately the ORDINARY composer — a Meldung then gets
   *  Textbausteine, marked names, Sprachnotiz and Foto without a line of extra code. */
  noteOn?: { id: string; text: string }
  /** unlink — the entry goes back to being an ordinary one */
  onClearNote?: () => void
  /** every still-open Pendenz, so an entry being written can be attached to one without leaving
   *  this sheet. Absent/empty ⇒ nothing is offered and the row behaves exactly as before. */
  /** `createdAt` breaks a tie between two items the sentence names equally well (lib/reminders ·
   *  suggestPendenzen) — without it the composer threw mid-sentence (05.10.2026) */
  openPendenzen?: Pick<OpenReminder, 'id' | 'text' | 'urgent' | 'createdAt'>[]
  /** attach the entry being written to one of them (the workspace owns `noteOn`) */
  onLinkPendenz?: (p: { id: string; text: string }) => void
  /** this incident's own rows, for the chips offered while the field is still empty (see
   *  lib/startChips). Absent ⇒ the station's list is offered as it stands. */
  timeline?: TimelineEvent[]
  /** everything this Einsatz has words for — Mannschaft, Mittel, Partnerorganisationen,
   *  Fahrzeuge, Alarmgruppen (see lib/journalLinks · journalVocabulary). Typing three letters
   *  of any of them completes it; whatever ends up in the text is marked. */
  vocab?: JournalLink[]
  /** alarm/start time of the incident — prefill for the imported memo's «Aufnahme begann» */
  incidentStartAt?: string
  /** uploads an imported memo during save (large files never enter the offline queue) */
  uploadAudio?: (blob: Blob, filename: string) => Promise<{ url: string }>
  /** uploads a generic Beilage (PDF, Dokument …) during save — same rule as the memo above */
  uploadFile?: (blob: Blob, filename: string) => Promise<{ url: string }>
}) {
  const C = appConfig.copy.journal // read per-render so the resolved locale applies
  // station Textbausteine over the national defaults (deployment config wins when set)
  const quickPhrases = getDeploymentConfig().journal?.quickPhrases?.length
    ? getDeploymentConfig().journal!.quickPhrases!
    : appConfig.journal.quickPhrases
  // ⚠️ The draft outlives the sheet. This overlay closes on a backdrop press, and a sheet this
  // size on a tablet is mostly backdrop — one stray touch beside it threw away a half-written
  // entry with nothing said. The draft is per-session and per-incident (draftKeep clears on
  // incident change) and is cleared when the row is FILED, and at no other moment.
  // ⚠️ The ✕ used to clear it as well, so «✕» meant «discard this»: the one ✕ in this app that
  // destroyed what had just been typed, with no confirm, no undo, and wearing the same glyph as
  // every other ✕ on every other surface. Against «nothing that can't be undone», and not
  // tellable apart from a plain close at 3am — so it closes now, like all of them. Nothing is
  // lost by that: every attachment already carries its own ✕ (discardClip / discardImport /
  // discardPhoto), and the sentence is right there with the caret at its end when the sheet
  // reopens, so «I don't want this after all» is select-all and delete.
  // A Meldung keeps its OWN draft per item, or two items would hand each other's half-typed
  // text back.
  // ⚠️ Captured ONCE, from how the sheet opened. It cannot follow `noteOn`, because attaching a
  // Pendenz from inside the composer changes that — and the key changing mid-composition would
  // swap the kept draft under the operator and blank the sentence they were half-way through.
  const [draftKey] = useState(() => (noteOn ? `journal-note:${noteOn.id}` : 'journal-entry'))
  const [text, setText] = useKeptState(draftKey, '')
  // ⚠️ …and the REST of the sheet, under its own key. Only `text` was kept until 23.08., so
  // setting «Dringende Pendenz», picking «in 15 min» and attaching two photos and then brushing
  // the backdrop handed the sentence back and dropped all of it — silently, and the sheet came
  // back looking like an ordinary entry. Everything in here is either plain data or a `blob:`
  // URL this app already lets outlive the composer (they are the very URLs `submit` hands to the
  // journal row), so nothing has to be re-derived.
  // ⚠️ The IMPORTED memo is deliberately NOT in here. Its preview URL is revoked on unmount and
  // its File is up to 100 MB, which a module-level store would pin for the whole session. So it
  // is dropped — and said out loud on the way out (see the unmount effect below), because a
  // silent drop is precisely the failure this guard exists to end.
  const restKey = `${draftKey}:rest`
  const [rest0] = useState(() => readDraft<KeptRest>(restKey, EMPTY_REST))
  const phone = useIsPhone()
  const textRef = useRef<HTMLTextAreaElement>(null)
  const marksRef = useRef<HTMLDivElement>(null)
  const [selection, setSelection] = useState<TextSelection>(() => ({ start: text.length, end: text.length }))
  const parts = useMemo(() => linkParts(text, vocab), [text, vocab])
  // Starters remain available until typing begins; observed continuations take priority after a tap.
  const [typed, setTyped] = useState(() => text.trim().length > 0)
  const starters = useMemo(() => {
    if (typed) return []
    // The default opener is the EL role, independent of vocabulary loading or ordering.
    const el = appConfig.copy.anwesenheit.roleEinsatzleiterShort
    return startChips(timeline, quickPhrases, `${el} ${ARROW}`)
  }, [typed, timeline, quickPhrases])
  const suggestions = useMemo(() => journalSuggestions(text, selection, {
    vocab, phrases: quickPhrases, timeline, starters,
  }), [text, selection, vocab, quickPhrases, timeline, starters])
  const readSelection = (el: HTMLTextAreaElement) => {
    setSelection((prev) => prev.start === el.selectionStart && prev.end === el.selectionEnd
      ? prev : { start: el.selectionStart, end: el.selectionEnd })
  }
  const accept = (suggestion: JournalSuggestion) => {
    const edit = acceptJournalSuggestion(text, suggestion)
    setText(edit.text)
    setSelection({ start: edit.caret, end: edit.caret })
    requestAnimationFrame(() => {
      const el = textRef.current
      if (!el || el.value !== edit.text) return
      el.focus()
      el.setSelectionRange(edit.caret, edit.caret)
    })
  }
  // ── the clock: any entry may say when it has to come back ─────────────────────────────────
  // ⚠️ There is no «Eintrag · Erinnerung» switch any more. Asking for the KIND of row first cost
  // the Erinnerung everything the ordinary sheet has — Art, Foto, Sprachnotiz, the ring — and made
  // «Auftrag erteilt» and «um 22:10 nachfassen» two rows about one thing. The clock is now a
  // property of the entry, exactly as the open ring already is.
  // ⚠️ Resolved PER RENDER, not when the chip is picked: «+10 min» means ten minutes from the moment
  // it is saved, and the sheet can stand open for a while (unchanged behaviour).
  const [dueSel, setDueSel] = useState<DueSel>(rest0.dueSel)
  const dueAt = resolveDueAt(dueSel) ?? undefined
  // the exact due picker (day + time), opened from the clock menu's «Uhrzeit …» row — what it
  // opens on; null = closed. Anchored to the clock button, which `dueWrapRef` holds.
  const [exact, setExact] = useState<{ day: string; hhmm: string; anchor: DOMRect } | null>(null)
  const dueWrapRef = useRef<HTMLSpanElement>(null)
  // ── the ○ switch: aus → offen → dringend → aus ────────────────────────────────────────────
  // ⚠️ THREE states on ONE control, not a second chip appearing beside it. A chip that shows up
  // on tap pushes the row onto a second line — the sheet grows under the thumb on the one surface
  // already fighting the keyboard for every row it has. The switch reserves the width of its
  // longest state instead, so tapping changes colour and word and moves nothing.
  // ⚠️ And it is a NEW control, which is why a second tap may mean something here: on the Art
  // chips the second tap has always meant «off» (`cur === t ? null : t`), and redefining a
  // learned gesture is exactly what shipped as a bug once already.
  // ⚠️ NOT shown while writing a Meldung. It was, as a two-state «normal / dringend» that edited
  // the PENDENZ — so a control sitting on one Meldung silently re-ranked the whole item, and the
  // switch beside it said «offen» about something that was open before this sheet existed. A
  // Meldung reports on an item; it does not re-decide it.
  const [openState, setOpenState] = useState<0 | 1 | 2>(rest0.openState)
  // ⚠️ A due time and an open ring are ONE fact, so the two controls keep each other honest: a
  // Fälligkeit on a line nobody can tick off would fire a banner with no way to answer it, and a
  // line taken off the Pendenzen would keep an alarm nothing owns. Setting a time therefore opens
  // the ring, and closing the ring drops the time.
  const setDue = (sel: DueSel) => { setDueSel(sel); if (sel && openState === 0) setOpenState(1) }
  const setOpen = (s: 0 | 1 | 2) => { setOpenState(s); if (s === 0) setDueSel(null) }
  // …and the open Pendenzen this sentence already names. Offered only while writing an ordinary
  // entry: once it IS a Meldung the question is answered.
  const pendenzHits = useMemo(
    () => (noteOn ? [] : suggestPendenzen(text, openPendenzen)),
    [text, openPendenzen, noteOn],
  )
  const canLink = openPendenzen.length > 0 && !!onLinkPendenz
  // ── the ○ opens a menu; it no longer cycles ───────────────────────────────────────────────
  // ⚠️ Three states reached by tapping the same ring in turn were a guessing game, and the way to
  // «hang this on something already open» was a long press — a gesture that cannot announce
  // itself. One menu says the whole model out loud instead: this line is a new open item, or it
  // is urgent, or it reports on one of these. Nothing to discover, nothing to cycle past.
  // ⚠️ It costs the common case a second tap («offen halten» was one). Worth it: «Neue Pendenz»
  // is the first row every time, so it is two taps in the same two places rather than one tap
  // whose result depends on how many times you pressed before.
  /** one row of that menu: the ring in the state it stands for, the words, and a tick when it is
   *  the state the switch is in right now. */
  const menuRow = (state: 0 | 1 | 2, label: string, active: boolean) => (
    <>
      <span className="jc-menu-ring" data-state={state}>{state === 2 && <span className="jc-bang" />}</span>
      <span className="jc-menu-label">{label}</span>
      {active && <Icon id="check" />}
    </>
  )
  /** …and one row of the clock's menu, laid out the same way so the two popups read as siblings:
   *  a leading slot (empty for the plain minute rows), the words, a tick when it is the choice. */
  const dueRow = (lead: React.ReactNode, label: string, active: boolean) => (
    <>
      <span className="jc-menu-ring jc-menu-lead">{lead}</span>
      <span className="jc-menu-label">{label}</span>
      {active && <Icon id="check" />}
    </>
  )
  // What kind of statement it is: ONE of three, «Info» picked from the start (29.09.2026, owner
  // pick A). Nothing picked and «Info» picked said the same thing two ways, and three unlit chips
  // read as a question still waiting for its answer. The sentence is still all the sheet needs —
  // the default IS the ordinary case. `null` in a kept draft (from before) reads as «Info».
  const [entryType, setEntryType] = useState<JournalEntryType>(rest0.entryType ?? 'info')
  /** …and what gets WRITTEN is unchanged: «Info» files as an ordinary row with no `entryType`
   *  at all, exactly what an untouched composer wrote before the preselect (lib/journalEntry
   *  prints no marker for it either way). */
  const writtenType = entryType === 'info' ? undefined : entryType
  const [recording, setRecording] = useState(false)
  const [elapsed, setElapsed] = useState(0)
  const [clip, setClip] = useState<{ url: string; secs: number; startedAt: string } | null>(rest0.clip)
  // SEVERAL photos per entry: one damage is rarely one picture, and the picker used to REPLACE
  // what was already attached — the second pick silently threw the first away.
  const [photos, setPhotos] = useState<string[]>(rest0.photos)
  // the strip below shows each picture's session THUMBNAIL (lib/mediaUrl), never the camera
  // file — ten full-size previews was a tab-killing amount of decode on a phone. A thumbnail
  // lands a moment after its pick; this nonce re-renders the strip when it does.
  const [, setThumbNonce] = useState(0)
  const addPhotos = (picked: File[]) => {
    const urls = picked.map((f) => URL.createObjectURL(f))
    setPhotos((ps) => [...ps, ...urls])
    picked.forEach((f, i) => void mintLocalThumb(urls[i], f).then(() => { if (alive.current) setThumbNonce((n) => n + 1) }))
    // where each was taken, read off the ORIGINAL file now — the upload re-encodes it through a
    // canvas, which keeps no metadata (lib/photoGeo). The row picks it up when it is saved.
    picked.forEach((f, i) => void rememberPhotoGeo(urls[i], f))
  }
  // …and one write per change. Cheap enough (draftKeep), and it is the only thing that has to
  // stay in step with the five states above.
  useEffect(() => { keepDraft<KeptRest>(restKey, { dueSel, openState, entryType, clip, photos }) },
    [restKey, dueSel, openState, entryType, clip, photos])
  // Generic Beilagen picked with the upload button — anything that is neither picture nor
  // recording (PDF vom Eigentümer, Stoffdatenblatt, Liste). ⚠️ Deliberately NOT in `KeptRest`,
  // for the same reason the imported memo is not: these hold a File, which no draft store can
  // hand back across an unmount. Uploaded during save, never queued offline.
  const [files, setFiles] = useState<{ file: File; name: string; contentType: string }[]>([])
  // imported external voice memo (Voice Memos → Files → picker); mutually exclusive with `clip`
  const [imported, setImported] = useState<{
    file: File; url: string; name: string; durationSec: number | null; contentType: string
  } | null>(null)
  const [startHHMM, setStartHHMM] = useState(() => {
    const d = incidentStartAt ? new Date(incidentStartAt) : new Date()
    return hhmm(Number.isNaN(d.getTime()) ? new Date() : d)
  })
  // hard gate (2026-07-15 decision): save stays disabled until the operator edits the
  // stepper or explicitly confirms — the row lands at this time in the Verlauf
  const [startConfirmed, setStartConfirmed] = useState(false)
  const [uploading, setUploading] = useState(false)
  // a picture picked a moment ago is still having its position read (lib/photoGeo): «Erfassen»
  // waits for it, BUSY – it used to stay pressable for those up to 1.5 s and file the row twice
  const [locating, setLocating] = useState(false)
  const [clipPlaying, setClipPlaying] = useState(false)
  const clipAudio = useRef<HTMLAudioElement | null>(null)
  // recorded clip and imported memo are exclusive, so one preview player serves both
  const previewUrl = clip?.url ?? imported?.url ?? null
  const toggleClip = () => {
    if (!previewUrl) return
    if (clipPlaying && clipAudio.current) { clipAudio.current.pause(); setClipPlaying(false); return }
    const a = new Audio(previewUrl)
    clipAudio.current = a
    a.onended = () => setClipPlaying(false)
    a.onpause = () => setClipPlaying(false)
    void a.play().then(() => setClipPlaying(true)).catch(() => setClipPlaying(false))
  }
  const recRef = useRef<{ rec: MediaRecorder; startedAt: number } | null>(null)
  const fileRef = useRef<HTMLInputElement>(null)
  const focusedOnAttach = useRef(false)
  // ⚠️ STABLE (useCallback): an inline ref is detached and re-attached on every render, which
  // nulls `textRef.current` for a moment mid-commit – and the Tab arrow reads it right there.
  const attachText = useCallback((el: HTMLTextAreaElement | null) => {
    textRef.current = el
    if (el && !focusedOnAttach.current) { focusedOnAttach.current = true; el.focus({ preventScroll: true }) }
  }, [])
  /** the ONE upload picker: pictures, recordings and documents in a single dialog (the camera
   *  button beside it stays, because «take a picture now» is a different gesture) */
  const attachRef = useRef<HTMLInputElement>(null)
  // closing the composer mid-upload means "cancel": the upload may finish server-side (the
  // orphaned blob is harmless) but no journal row is created after unmount. The unmount also
  // revokes the imported preview URL — saves/closes must not pin up to 100 MB per import.
  const alive = useRef(true)
  // ⚠️ The url AND the name, on one ref: the cleanup below needs both, and this is the only
  // assignment the component makes during render — one is a documented exception, two is a habit.
  const importedRef = useRef<{ url: string; name: string } | null>(null)
  importedRef.current = imported ? { url: imported.url, name: imported.name } : null
  // the staged Beilagen, for the same cleanup — they hold a File, so they cannot be kept either
  const filesRef = useRef<{ name: string }[]>([])
  useEffect(() => { filesRef.current = files.map((f) => ({ name: f.name })) }, [files])
  // …and whether the row was actually filed. The memo is the one piece of the draft that cannot
  // be kept (see restKey), so closing with one staged loses it — and a loss nobody is told about
  // is exactly the failure the draft guard exists to end. Not after a save, and not after a
  // failed upload either: there the sheet stays open with the memo still on it.
  const filedRef = useRef(false)
  useEffect(() => () => {
    alive.current = false
    const pending = importedRef.current
    if (pending) URL.revokeObjectURL(pending.url)
    if (pending && !filedRef.current) {
      // read here rather than off the render closure, so the resolved locale applies (config/copy)
      const dropped = appConfig.copy.journal.audioImportDropped
      toast(fillTemplate(dropped, { name: pending.name }), { icon: 'warn', tone: 'warn' })
    }
    if (!filedRef.current) {
      for (const f of filesRef.current) {
        toast(fillTemplate(appConfig.copy.journal.attachDropped, { name: f.name }), { icon: 'warn', tone: 'warn' })
      }
    }
  }, [])

  // In-app voice-to-text dictation was removed — use the native OS keyboard dictation
  // (e.g. iPadOS mic key) to fill the text field instead.

  // live recording timer
  useEffect(() => {
    if (!recording) return
    const id = setInterval(() => { const s = recRef.current; if (s) setElapsed(Math.round((Date.now() - s.startedAt) / 1000)) }, 250)
    return () => clearInterval(id)
  }, [recording])

  // stop any in-flight recording + release the stream when the composer unmounts
  useEffect(() => () => { try { recRef.current?.rec.stop() } catch { /* already stopped */ } }, [])

  // ⚠️ Caret at the END of a restored draft — driven by the FOCUS EVENT, not by a frame counted
  // from mount. A focused textarea puts the caret at position 0, so re-opening a half-written
  // entry landed the cursor in front of it and the next word went to the start of the sentence.
  // The first attempt set the selection in a rAF after mount and did nothing: the Overlay does
  // its own focus (`initialFocus`) on its own schedule, and whichever of the two ran last won.
  // Hanging it on the focus itself cannot lose that race. Once only, so clicking into the middle
  // of the text later still puts the caret where it was clicked.
  const caretPlaced = useRef(false)
  const caretToEnd = (el: HTMLTextAreaElement) => {
    if (caretPlaced.current) return
    caretPlaced.current = true
    if (el.value) el.setSelectionRange(el.value.length, el.value.length)
    readSelection(el)
  }

  const toggleRecord = async () => {
    if (recording) { recRef.current?.rec.stop(); return }
    discardImport() // one audio per entry — a fresh recording replaces an imported memo
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
      const rec = new MediaRecorder(stream); const chunks: Blob[] = []
      const startedAt = Date.now()
      rec.ondataavailable = (e) => e.data.size && chunks.push(e.data)
      rec.onstop = () => {
        stream.getTracks().forEach((t) => t.stop())
        const url = URL.createObjectURL(new Blob(chunks, { type: rec.mimeType || 'audio/webm' }))
        setClip({ url, secs: Math.max(1, Math.round((Date.now() - startedAt) / 1000)), startedAt: new Date(startedAt).toISOString() })
        setRecording(false); setElapsed(0)
      }
      recRef.current = { rec, startedAt }; setRecording(true); rec.start()
    } catch { toast(appConfig.copy.toast.micDenied, { icon: 'mic', tone: 'warn' }) }
  }

  const discardClip = () => { clipAudio.current?.pause(); setClipPlaying(false); if (clip) URL.revokeObjectURL(clip.url); setClip(null) }
  const discardImport = () => {
    clipAudio.current?.pause(); setClipPlaying(false)
    setImported((cur) => { if (cur) URL.revokeObjectURL(cur.url); return null })
    setStartConfirmed(false)
  }

  const pickSeq = useRef(0)
  const importAudioFile = async (f: File) => {
    const v = validateAudioImport(f)
    if (!v.ok) {
      toast(v.reason === 'size' ? fillTemplate(C.audioTooLarge, { max: MAX_AUDIO_UPLOAD_MB }) : C.audioUnsupported, { icon: 'warn', tone: 'warn' })
      return
    }
    discardClip(); discardImport() // one audio per entry — the new pick replaces both
    const seq = ++pickSeq.current
    const url = URL.createObjectURL(f)
    const durationSec = await probeAudioDuration(url)
    // a slow probe must not resurrect a pick the operator already replaced
    if (seq !== pickSeq.current || !alive.current) { URL.revokeObjectURL(url); return }
    setImported({ file: f, url, name: f.name, durationSec, contentType: v.contentType })
  }
  /** a picked document — validated against the same allowlist the server holds, so an
   *  unsupported type is refused HERE and not by a 415 after the sentence was written */
  const attachFile = (f: File) => {
    // no upload channel (a surface that renders the composer without one) — refuse the pick
    // here rather than staging a Beilage that would be dropped silently on save
    if (!uploadFile) { toast(C.attachUploadFailed, { icon: 'warn', tone: 'warn' }); return }
    const v = validateFileImport(f)
    if (!v.ok) {
      toast(v.reason === 'size' ? fillTemplate(C.attachTooLarge, { max: MAX_FILE_UPLOAD_MB }) : C.attachUnsupported, { icon: 'warn', tone: 'warn' })
      return
    }
    setFiles((list) => [...list, { file: f, name: f.name || 'Beilage', contentType: v.contentType }])
  }

  /** ONE upload button, three destinations: a picture joins the photo list, a recording becomes
   *  THE voice memo of the entry (one per row), everything else lands as a named Beilage. What
   *  was picked decides — the operator picks a file, not a category. */
  const takePick = (picked: File[]) => {
    const images = picked.filter((f) => classifyPick(f) === 'photo')
    const audios = picked.filter((f) => classifyPick(f) === 'audio')
    if (images.length) addPhotos(images)
    if (audios.length) void importAudioFile(audios[0])
    // ⚠️ One recording per Eintrag — but a pick that brought several must SAY which ones it did
    // not take. Silently keeping the first is the loss the composer refuses everywhere else.
    if (audios.length > 1) {
      toast(fillTemplate(C.attachAudioExtra, { names: audios.slice(1).map((f) => f.name).join(', ') }), { icon: 'warn', tone: 'warn' })
    }
    for (const f of picked) if (classifyPick(f) === 'file') attachFile(f)
  }
  const onAttachPicked = (e: React.ChangeEvent<HTMLInputElement>) => {
    const picked = [...(e.target.files ?? [])]
    e.target.value = '' // the same file twice in a row must still fire
    takePick(picked)
  }
  // by POSITION, not by name: two «Bericht.pdf» from two folders are two Beilagen, and removing
  // one of them may not take the other with it
  const discardFile = (i: number) => setFiles((list) => list.filter((_, n) => n !== i))

  // Pasting a copied Voice Memo (or photo, or PDF) is the easier mobile path than the Files
  // detour — handled on the composer root so a paste into the textarea bubbles here too.
  const onPaste = (e: ClipboardEvent) => {
    const picked = Array.from(e.clipboardData?.files ?? [])
    if (!picked.length) return // plain text paste stays with the textarea
    e.preventDefault()
    takePick(picked)
  }

  // recording start resolved to the most recent past occurrence (no date picker by design)
  const importStartAt = imported ? resolveRecordingStart(startHHMM) : null

  /** Send every staged Beilage and hand back what the row will carry. Upload-during-save, the
   *  same rule as the imported memo: a generic file has no in-app preview that could stand in
   *  for it, so the row is only created once its URLs exist. Throws — the caller keeps the
   *  sheet (and the draft) standing so the save can be retried. */
  const uploadPickedFiles = async (): Promise<{ url: string; name: string }[]> => {
    if (!files.length || !uploadFile) return []
    const out: { url: string; name: string }[] = []
    for (const f of files) {
      // re-wrap when the picker's MIME needed normalising (empty / octet-stream out of iOS
      // Files) so the backend allowlist sees a supported content type
      const blob = f.file.type === f.contentType ? f.file : new File([f.file], f.name, { type: f.contentType })
      const { url } = await uploadFile(blob, f.name)
      out.push({ url, name: f.name })
    }
    return out
  }
  const sayFileUploadFailed = (e: unknown) => {
    toast(
      e instanceof ApiError && e.status === 413 ? fillTemplate(C.attachTooLarge, { max: MAX_FILE_UPLOAD_MB })
        : e instanceof ApiError && e.status === 415 ? C.attachUnsupported
          : C.attachUploadFailed,
      { icon: 'warn', tone: 'warn' },
    )
  }

  // Upload during save (2026-07-15 decision): the row is only created once the server URL
  // exists — an imported memo never enters the offline IndexedDB queue, so offline is an
  // explicit refusal and a failed upload keeps the composer open for a retry.
  const submitImported = async () => {
    if (!imported || !uploadAudio) return
    // resolve at SAVE time — the render-time value can carry a stale day-rollover decision
    // (e.g. 23:50 entered at 23:49 rolled to yesterday, but the operator saves at 23:52)
    const startAt = resolveRecordingStart(startHHMM)
    if (!startAt) return
    if (!navigator.onLine) { toast(C.audioOffline, { icon: 'warn', tone: 'warn' }); return }
    setUploading(true)
    // Beilagen first — they are the cheap half, so a refusal comes back fast. Whichever half
    // fails, the sheet stays open with everything on it and a retry re-sends: an orphaned blob
    // is harmless (nothing points at it), a lost Beilage is not.
    let attached: { url: string; name: string }[]
    try { attached = await uploadPickedFiles() } catch (e) {
      if (!alive.current) return
      sayFileUploadFailed(e); setUploading(false); return
    }
    try {
      // re-wrap when the picker's MIME needed normalising (empty/x-wav) so the backend
      // allowlist sees a supported content type
      const blob = imported.file.type === imported.contentType
        ? imported.file
        : new File([imported.file], imported.name, { type: imported.contentType })
      const { url } = await uploadAudio(blob, imported.name)
      if (!alive.current) return // closed mid-upload — cancelled, no row
      // ⚠️ HERE, not in `submit`. The draft used to be dropped before the upload was even
      // attempted, so a failed one left the sheet standing over an already-emptied store and the
      // next stray backdrop touch took the sentence with it.
      filedRef.current = true
      clearDraft(draftKey); clearDraft(restKey) // filed — the next open starts empty
      onSubmit({
        text: text.trim(), photoUrls: photos.length ? photos : undefined,
        entryType: writtenType,
        // …and the same three facts the typed entry carries. An imported memo used to drop them
        // silently: the ring could be set on the sheet and the row landed as an ordinary line.
        dueAt,
        assignee: parts.find((p) => p.kind)?.text,
        ...(noteOn ? { noteFor: { id: noteOn.id } } : openState > 0 ? { pendenz: { urgent: openState === 2 } } : {}),
        audioUrl: url, secs: imported.durationSec ?? undefined,
        files: attached.length ? attached : undefined,
        audioMeta: {
          source: 'imported', startedAt: startAt.toISOString(),
          durationSec: imported.durationSec ?? undefined, originalName: imported.name,
        },
      })
    } catch (e) {
      if (!alive.current) return
      const msg = e instanceof ApiError && e.status === 413 ? fillTemplate(C.audioTooLarge, { max: MAX_AUDIO_UPLOAD_MB })
        : e instanceof ApiError && e.status === 415 ? C.audioUnsupported
        : C.audioUploadFailed
      toast(msg, { icon: 'warn', tone: 'warn' })
      setUploading(false)
    }
  }

  // the CAMERA button — «take one now», which is a different gesture from picking an existing
  // file (⚠️ `picked`, not `files`: that name belongs to the staged Beilagen state above)
  const onPhotoPicked = (e: React.ChangeEvent<HTMLInputElement>) => {
    const picked = [...(e.target.files ?? [])]
    e.target.value = '' // the same file twice in a row must still fire
    if (picked.length) addPhotos(picked)
  }
  const discardPhoto = (url: string) => {
    forgetLocalThumb(url)
    forgetPhotoGeo(url)
    URL.revokeObjectURL(url)
    setPhotos((ps) => ps.filter((p) => p !== url))
  }

  const canSend = imported != null
    // hard gate: an imported memo saves only with a confirmed, valid start time
    ? startConfirmed && importStartAt != null && !uploading
    : text.trim().length > 0 || clip != null || photos.length > 0 || files.length > 0
  const submit = () => {
    if (!canSend || uploading || locating) return
    if (imported) { void submitImported(); return } // …which clears the draft once the upload lands
    if (files.length) { void submitWithFiles(); return } // …ditto, once the Beilagen land
    submitRow([])
  }
  /** the ordinary save — staged Beilagen have already been uploaded when this runs, so the row
   *  is created with server URLs and nothing here can fail. */
  const submitRow = (attached: { url: string; name: string }[], geoSettled = false) => {
    // a one-time action's busy state (docs/ui-conventions.md · One-time actions): the press is
    // taken at once and the button cannot be pressed again until the row is filed (the wait ends
    // at PHOTO_GEO_WAIT_MS at the latest – a row without its position beats no row)
    const geoWait = geoSettled ? null : photoGeoSettled(photos)
    if (geoWait) {
      setLocating(true)
      void geoWait.then(() => { if (!alive.current) return; setLocating(false); submitRow(attached, true) })
      return
    }
    clearDraft(draftKey); clearDraft(restKey) // filed — the next open starts empty
    onSubmit({
      text: text.trim(), audioUrl: clip?.url, secs: clip?.secs, photoUrls: photos.length ? photos : undefined,
      files: attached.length ? attached : undefined,
      entryType: writtenType,
      dueAt,
      // «Wer»: the first name the sentence marks. No field asks for it — whoever writes «Trupp 2
      // entraucht Treppenhaus» has already said who it is for, and a Trupp is titled by its
      // Gruppenführer, who is in the vocabulary anyway (lib/journalLinks).
      assignee: parts.find((p) => p.kind)?.text,
      ...(noteOn
        ? { noteFor: { id: noteOn.id } }
        : openState > 0 ? { pendenz: { urgent: openState === 2 } } : {}),
      audioMeta: clip ? { source: 'recorded', startedAt: clip.startedAt, durationSec: clip.secs } : undefined,
    })
  }
  /** save WITH Beilagen: they go up first, and only a complete upload files the row — offline is
   *  an explicit refusal here (not a queued promise), exactly as it is for an imported memo. */
  const submitWithFiles = async () => {
    if (!navigator.onLine) { toast(C.attachOffline, { icon: 'warn', tone: 'warn' }); return }
    setUploading(true)
    let attached: { url: string; name: string }[]
    try { attached = await uploadPickedFiles() } catch (e) {
      if (!alive.current) return
      sayFileUploadFailed(e); setUploading(false); return
    }
    if (!alive.current) return // closed mid-upload — cancelled, no row
    filedRef.current = true
    submitRow(attached)
  }

  const kbInset = useKeyboardInset()
  // the «Uhrzeit …» picker hangs off the clock button, and on a phone opening it drops the
  // keyboard (see the menu row) — which moves the sheet, and the button with it. Re-anchor once
  // the sheet has settled, or the wheels float where the button USED to be.
  const pickerOpen = exact != null
  useEffect(() => {
    if (!pickerOpen) return
    const r = dueWrapRef.current?.getBoundingClientRect()
    if (r) setExact((e) => (e ? { ...e, anchor: r } : e))
  }, [kbInset, pickerOpen])
  // …and which rung of the degradation ladder the sheet stands on (see lib/composerFit): with
  // the keyboard up this card is regularly taller than what is left of the screen, and it used to
  // answer that by scrolling — which, with the field focused, scrolled the CARET into view and
  // pushed the head, the field and the whole predictive band off the top edge.
  // ⚠️ Measured against BOTH the card's own cap and the screen: a cap that is itself too big —
  // which is what the `pointer: fine` card had (see 10-journal.css) — hides the overflow from the
  // first limit but not from the second. The element measured is the popup itself — `cardRef` is
  // filled by the `setCard` callback ref handed to `<Overlay popupRef>` below, so it is the box
  // that carries the cap and does the scrolling, with no boxless wrapper to climb out of.
  const cardRef = useRef<HTMLDivElement | null>(null)
  const [compact, setCompact] = useState(false)
  const frameRef = useRef(0)
  const remeasure = useCallback(() => {
    // coalesced into one frame: a burst of resize events — or a render per keystroke — costs
    // ONE layout read, taken right before the paint that needs it anyway
    if (frameRef.current) return
    frameRef.current = requestAnimationFrame(() => {
      frameRef.current = 0
      const card = cardRef.current
      if (!card) return
      // ⚠️ `visualViewport.height`, not `innerHeight`: it is the screen MINUS the keyboard, which
      // is the only number that says how much room the sheet actually has. `innerHeight` does not
      // move for a keyboard on iOS at all (see useKeyboardInset).
      const screen = window.visualViewport?.height ?? window.innerHeight
      // …and the card's USED cap, not the height it happens to have right now: «would the full
      // layout fit» has to answer the same from either rung, or the sheet flips between them.
      const cap = parseFloat(getComputedStyle(card).maxHeight)
      setCompact((cur) => nextCompact(cur, {
        needed: card.scrollHeight, cap: Number.isNaN(cap) ? Infinity : cap, screen,
      }))
    })
  }, [])
  // after every render — a photo, a memo, a longer sentence all change what has to fit
  useEffect(remeasure)
  // …and whenever the ROOM changes rather than the content: the keyboard opening is a
  // visualViewport resize, a rotation is a window one
  useEffect(() => {
    const vv = window.visualViewport
    vv?.addEventListener('resize', remeasure)
    window.addEventListener('resize', remeasure)
    return () => {
      // ⚠️ …and CLEAR it, not just cancel it. The id doubles as «a measure is already pending»,
      // so a cancelled one left behind latched the guard shut: every later call returned early
      // and the ladder never measured again. React's StrictMode mounts, cleans up and mounts
      // again — which is exactly this sequence, on every dev boot, in the app rather than in a
      // test. The rungs were dead in the real app while every unit test passed.
      if (frameRef.current) cancelAnimationFrame(frameRef.current)
      frameRef.current = 0
      vv?.removeEventListener('resize', remeasure)
      window.removeEventListener('resize', remeasure)
    }
  }, [remeasure])
  // ── paste (a copied Voice Memo or photo) ──────────────────────────────────────────────────
  // ⚠️ A NATIVE listener on the card, where React's `onPaste` used to sit on a `display: contents`
  // wrapper around the whole sheet. That wrapper is gone: an element with no box between a flex
  // container and its items makes every `.journal-composer > *` rule address the wrapper instead
  // of the rows — which is what quietly disabled «nothing shrinks» (see 10-journal.css) and let
  // the predictive band be squeezed to 0 again.
  const pasteRef = useRef(onPaste)
  // …kept current after each commit rather than during render (the one ref this file writes in
  // render is a documented exception, not a habit), so the listener below never re-subscribes.
  useEffect(() => { pasteRef.current = onPaste })
  const onPasteEvent = useCallback((e: ClipboardEvent) => pasteRef.current(e), [])
  // ⚠️ A CALLBACK ref, not an effect reading `.current`. Base UI mounts this popup through a
  // portal, so the element is NOT there on the first commit: an effect with `[]` runs once, finds
  // null and attaches nothing — which is precisely how the paste handler was lost for a while
  // (the sheet took a pasted photo everywhere except where it was pasted). This fires the moment
  // the element exists, and again when it goes; measuring is kicked off from the same place, so
  // the ladder does not have to wait for a second render to see the card either.
  const setCard = useCallback((el: HTMLDivElement | null) => {
    cardRef.current?.removeEventListener('paste', onPasteEvent)
    cardRef.current = el
    if (!el) return
    el.addEventListener('paste', onPasteEvent)
    remeasure()
  }, [onPasteEvent, remeasure])
  return (
    // <Overlay> (Base UI) owns focus-trap + scroll-lock + backdrop-close; its pointerdown-based
    // outside-press already ignores the opening tap, so the old Android `armed` delay is gone.
    // Escape CLOSES it, like every other sheet (staging review 06.11.2026, S6). It used to be vetoed
    // (`dismissEscape={false}`) so Esc could not discard unsaved text — but the draft outlives the
    // sheet (draftKeep, above), so a close loses nothing, and an open dropdown or time wheel still
    // takes the first Escape alone (popoverGuard). The keyboard inset lifts the phone bottom sheet.
    // `--jc-kb` carries the measured keyboard height into CSS as well as the phone sheet's
    // marginBottom: on a TABLET the card is top-anchored, so a bottom margin does nothing —
    // the height has to be capped against the keyboard instead (see 10-journal.css).
    // `is-kb` is the same fact as a class: on a PHONE it collapses the four media buttons to
    // icons so the whole sheet still fits in what the keyboard leaves (see 15-mobile.css).
    // `is-compact` is the rung below that and asks a different question — not «is a keyboard up»
    // but «does the card still fit», measured (see lib/composerFit · 10-journal.css).
    <Overlay open onClose={onClose} className={`journal-composer ${kbInset > 0 ? 'is-kb' : ''}${compact ? ' is-compact' : ''}`} backdropClassName="modal-backdrop"
      ariaLabel={C.composerTitle} initialFocus={textRef} grab
      // the lift is the keyboard LESS iOS's pan (keyboardMargin · --vv-foot, 30.09.2026), the cap
      // (--jc-kb) the whole keyboard — so the sheet stands on the keys and never outgrows the band
      style={{ marginBottom: kbInset > 0 ? keyboardMargin(kbInset) : 0, '--jc-kb': `${kbInset}px` } as React.CSSProperties}
      popupRef={setCard}>
        {/* What this sheet is, and the ✕ beside it.
            ⚠️ There is no «Eintrag · Erinnerung» switch here any more (17.08.). It asked which KIND
            of row this would be BEFORE the sentence was written — and the answer stripped the
            Erinnerung of Art, Foto, Sprachnotiz and the ring, so «Auftrag erteilt» and «um 22:10
            nachfassen» had to be written as two rows about one thing. Whether something has to come
            back is a property of the entry, like the open ring, and it is asked by the clock down
            in the meta row. The title takes the space the tabs had. */}
        <div className="jc-mode">
          {noteOn
            ? (
              // ⚠️ The link lives IN the title row, not on one of its own. As a separate amber
              // band it pushed everything below it down, so the Meldung sheet stood a row taller
              // than the ordinary one — the same card, two heights, depending on how it was
              // opened. «Meldung» leads, the item follows: what this is, then what it is about.
              // ⚠️ A LABEL, not a control. It was a button opening the same menu the ○ switch
              // opens — and then «what is this line?» had two places to be asked, at opposite ends
              // of the sheet, depending on how the sheet had been opened. The ring is that one
              // place in both modes now (it stays visible while writing a Meldung and carries the
              // note-mode rows); this line says what the answer currently is.
              <span className="jc-mode-title jc-mode-note">
                <span className="jc-ring" aria-hidden />
                <b>{C.noteOnTitle}</b>
                <em>{C.noteOnLabel}</em>
                <span className="jc-mode-note-name">{noteOn.text}</span>
              </span>
            )
            // the word alone: the «T» beside it said «text» about the one surface that could not be
            // anything else, next to a sheet full of controls that all mean something
            : <span className="jc-mode-title"><b>{C.composerTitle}</b></span>}
          {/* ⚠️ It CLOSES — see the draftKey note above. It used to discard the draft as well,
              which made it the one ✕ in the app that destroyed work. */}
          <button className="journal-x" title={appConfig.copy.closeDialog} aria-label={appConfig.copy.closeDialog}
            onClick={onClose}><Icon id="close" /></button>
        </div>

        {/* The backdrop that marks known names. A <textarea> cannot style part of its own
            content, so the same text is painted behind it in a transparent div and only the
            <mark> spans show — the field itself is see-through. Both share one font, one
            padding and one line-height, and the backdrop follows the field's scroll, or the
            marks would drift off their words the moment the text got long. */}
        <div className="jc-text-wrap">
          <div className="jc-text-marks" ref={marksRef} aria-hidden>
            {parts.map((p, i) => (p.kind
              ? <mark key={i} className={`jc-mark-${p.kind}`}>{p.text}</mark>
              : <span key={i}>{p.text}</span>))}
            {/* the trailing newline needs a character after it or the div collapses a line
                short of the textarea and every mark below it sits one line too high */}
            {'\n'}
          </div>
        <textarea
          // ⚠️ focused the moment it ATTACHES, not an effect later. iOS raises the keyboard only
          // for a focus() made inside the tap's own call stack; the opener commits this sheet with
          // flushSync from its click handler, so this ref runs inside that stack. The dialog's
          // `initialFocus` still names the same field – it lands a frame later, on a field that
          // already has the caret, and is what every other way of opening the sheet relies on.
          ref={attachText}
          className="jc-text"
          {...tut('verlauf.composer')}
          value={text}
          onChange={(e) => {
            const v = stripUnprintable(e.target.value)
            setText(v)
            setSelection({
              start: stripUnprintable(e.target.value.slice(0, e.target.selectionStart)).length,
              end: stripUnprintable(e.target.value.slice(0, e.target.selectionEnd)).length,
            })
            // …and an emptied field is a fresh start: the chips come back
            setTyped(v.trim().length > 0)
          }}
          placeholder={C.textPlaceholder}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) submit()
            // Tab completes active typing or inserts the existing → shortcut; other offers keep focus navigation.
            else if (e.key === 'Tab' && !e.shiftKey && !e.nativeEvent.isComposing && suggestions[0]
              && suggestions[0].source !== 'starter' && suggestions[0].source !== 'next') {
              e.preventDefault()
              accept(suggestions[0])
            }
          }}
          onSelect={(e) => readSelection(e.currentTarget)}
          onFocus={(e) => caretToEnd(e.currentTarget)}
          onScroll={(e) => { if (marksRef.current) marksRef.current.scrollTop = e.currentTarget.scrollTop }}
        />
        </div>

        {/* A single ranked band; its empty row keeps the phone sheet steady while typing. */}
        {(suggestions.length === 0 && pendenzHits.length === 0)
          ? <div className="jc-phrases is-empty" aria-hidden /> : (
          // Keep the keyboard focused on mousedown (the chips' own onMouseDown); the row itself
          // scrolls NATIVELY — see .jc-phrases in 18-audio.css for why the hand-rolled pan went.
          <div className="jc-phrases" data-swipe-ignore onMouseDown={(e) => { if (phone) e.preventDefault() }} role="group" aria-label={C.quickPhrasesAria}>
            {suggestions.map((c) => (
              <button
                key={c.label}
                className={`jc-phrase${c.opener ? ' jc-phrase-starter' : ''}${c.source === 'arrow' ? ' jc-phrase-arrow' : ''}${c.kind ? ` jc-phrase-link jc-link-${c.kind}` : ''}`}
                title={c.source === 'arrow' ? (c.label === ARROW ? C.arrowTitle : C.arrowBackTitle) : undefined}
                aria-label={c.source === 'arrow' ? (c.label === ARROW ? C.arrowTitle : C.arrowBackTitle) : undefined}
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => accept(c)}
              >{c.label}{c.hint && <em className="jc-phrase-hint">{c.hint}</em>}</button>
            ))}
            {/* ── an open Pendenz this sentence already names ──
                ⚠️ LAST in the row, and never the Tab target. Every other chip here INSERTS TEXT;
                these change what the entry is. Tab takes the top suggestion, so a Pendenz sitting
                first would mean a reflex keystroke re-filed the entry instead of completing a
                name — and both look like «the thing I was about to type» from the corner of an eye.
                Amber and ringed, the colours of the link chip they produce, so the row shows at a
                glance which of its chips write words and which one changes the sheet. */}
            {pendenzHits.map((r) => (
              <button
                key={`p:${r.id}`}
                className="jc-phrase jc-phrase-pendenz"
                title={C.linkPendenzTitle}
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => onLinkPendenz?.({ id: r.id, text: r.text })}
              ><span className="jc-ring" />{C.noteOnLabel}{r.text}</button>
            ))}
          </div>
        )}

        {/* ── Who said it, what kind of statement it is, and whether it has to come back ──
            All of it lives BELOW the text and above the media, in one quiet strip: the sentence is
            still what this surface is for, and none of these may look like a field that has to be
            filled in before it will accept one. */}
        {/* ⚠️ ONE wrapper around the Art strip and the media strip, and that is what it is for:
            rung 2 of the ladder lays the two out side by side on a single line (see
            10-journal.css · .jc-controls). Stacked, it is the sheet's own 8px column and changes
            nothing. */}
        <div className="jc-controls">
          <div className="jc-meta">
            {/* Art — quiet by design: three small chips, one of three, «Info» preselected
                (29.09.2026). «Info» is the ordinary case and prints no marker at all
                (lib/journalEntry); a tap on the lit chip leaves it lit — «Info» is the way back.
                ⚠️ No «ART» eyebrow above them. Info · Auftrag · Sofortmassnahme say what they
                are; a heading that only repeated it cost a row on the one surface fighting the
                keyboard for every row it has. The group keeps the word as its accessible name,
                so a screen reader still hears it. */}
            <div className="jc-meta-row" role="group" aria-label={C.typeLabel}>
              {(['info', 'auftrag', 'sofort'] as const).map((t) => (
                <button
                  key={t}
                  type="button"
                  onMouseDown={(e) => { if (phone && document.activeElement === textRef.current) e.preventDefault() }}
                  className={`jc-chip jc-type-${t}${entryType === t ? ' on' : ''}`}
                  aria-pressed={entryType === t}
                  // ⚠️ The WORD is the accessible name on both rungs of the ladder — the compact
                  // row shows the initial alone, and «I» is not something anybody can be asked to
                  // tap. The plain label, never the hyphenated one: a soft hyphen has no business
                  // in what a screen reader reads out or a tooltip shows.
                  title={C.entryTypes[t]}
                  aria-label={C.entryTypes[t]}
                  onClick={() => setEntryType(t)}
                >
                  {/* ⚠️ …the label with its break points written in (copy · entryTypesWrap), never
                      the plain one. This chip is the narrowest control on the sheet; the word that
                      has to wrap in it is a doctrine word, and where it breaks is not the browser's
                      guess to make. What gets WRITTEN is still `entryTypes` (lib/journalEntry). */}
                  <span className="jc-chip-word">{C.entryTypesWrap[t] ?? C.entryTypes[t]}</span>
                  {/* …and the single letter that stands for the word once there is no room for it
                      (see 10-journal.css · .is-compact). Taken off the LOCALE's own label, so it is
                      «I · A · S» in German and whatever the other three read in theirs. */}
                  <span className="jc-chip-letter" aria-hidden>{C.entryTypes[t].charAt(0)}</span>
                </button>
              ))}
              {/* ── … and whether anything has to come back to it ──
                  Separated from the three by a rule, because it answers a DIFFERENT question.
                  The chips say what kind of statement this is; the ring says whether it stays
                  open. Folding it in as a fourth chip would pretend the four are alternatives —
                  and then «Auftrag» and «Pendenz» would both be true of the same sentence.
                  ⚠️ The ring, not a word: it is the same ring that appears on the Verlauf row and
                  in the Pendenzen list, where tapping it fills it in. Three sightings of one shape
                  carry further than a label that only exists here.
                  ⚠️ It stays while writing a MELDUNG, and carries that mode's menu — re-target the
                  item, or let the link go. It was hidden there for a while and the same choices
                  lived on the header link instead, which meant the control moved to the other end
                  of the sheet depending on how the sheet had been opened. One place for «what is
                  this line?», whatever the answer currently is.
                  ⚠️ What it does NOT do while a Meldung is linked is set urgency ON THAT ITEM. That
                  was tried, as a two-state switch, and it re-ranked the whole Pendenz the Meldung
                  merely reports on. «Dringende Pendenz» in that menu means something else: let the
                  link go and make THIS line a dringende one. */}
              {/* ── … and WHEN it has to come back ──
                  A second round control beside the ring, and deliberately a second one: the ring
                  says «bleibt offen», the clock says «meldet sich». It carries a MENU rather than a
                  strip of chips, for the same reason the ring does — a row that unfolds inside the
                  sheet pushes the field it belongs to under the keyboard, and the answers here are
                  one-of-N. The preset minutes and «Uhrzeit …» live in that one popup.
                  ⚠️ The two controls are not independent (see setDue/setOpen): a Fälligkeit implies
                  an open item, because a banner nobody can tick off has no answer. */}
              <span className="jc-openwrap" ref={dueWrapRef}>
              <Menu
                keepFocusRef={phone ? textRef : undefined}
                modal={!phone}
                side="top"
                align="end"
                popupClassName="rp-print-menu jc-pendenz-menu"
                itemClassName={() => 'rp-print-menu-item'}
                // ASCENDING, always — «Uhrzeit …», then the minutes short-to-long, and never the
                // other way round: these rows are read as a scale, and a scale that flips with the
                // menu's open direction has to be re-read every time. The order does NOT depend on
                // which way the popup opens (unlike the ring's menu, a different physical control).
                items={[
                  { kind: 'head' as const, label: C.dueHead },
                  { label: dueRow(<Icon id="clock" />, C.reminderExact, dueSel?.kind === 'at'),
                    onClick: () => {
                      const anchor = dueWrapRef.current?.getBoundingClientRect()
                      if (anchor) setExact({ ...(dueSel?.kind === 'at' ? { day: dueSel.day, hhmm: dueSel.hhmm } : defaultExact()), anchor })
                      // the wheels need no keyboard, and on a phone it would cover them
                      if (phone) textRef.current?.blur()
                    } },
                  ...C.reminderChips.map((n) => ({
                    label: dueRow(null, C.reminderChipLabel.replace('{n}', String(n)), dueSel?.kind === 'in' && dueSel.mins === n),
                    onClick: () => setDue({ kind: 'in', mins: n }),
                  })),
                  // …and the way back out, pinned under the thumb — only once there is one
                  ...(dueSel ? [{ label: dueRow(null, C.dueNone, false), onClick: () => setDueSel(null), sticky: true }] : []),
                ]}
                trigger={(
                  <button
                    type="button"
                    onMouseDown={(e) => { if (phone && document.activeElement === textRef.current) e.preventDefault() }}
                    className="jc-due-btn"
                    data-on={dueAt ? '1' : undefined}
                    title={dueAt ? fillTemplate(C.dueSetTitle, { t: formatTime(new Date(dueAt)) }) : C.dueHead}
                    aria-label={dueAt ? fillTemplate(C.dueSetTitle, { t: formatTime(new Date(dueAt)) }) : C.dueHead}
                  >
                    <Icon id="clock" />
                    {/* the time itself on the button, not just a lit icon: «meldet sich» without
                        «wann» is the half of the answer nobody can act on */}
                    {dueAt && <span className="jc-due-badge">{formatTime(new Date(dueAt))}</span>}
                  </button>
                )}
              />
              </span>
              <span className="jc-openwrap">
              <Menu
                keepFocusRef={phone ? textRef : undefined}
                modal={!phone}
                side="top"
                align="end"
                popupClassName="rp-print-menu jc-pendenz-menu"
                itemClassName={() => 'rp-print-menu-item'}
                // ⚠️ BOTTOM-UP, because this menu opens UPWARDS (side="top"): the ring sits low in
                // the sheet — on a phone right above the thumb — so a list read top-first put its
                // most-used row furthest from the finger that just pressed. The nearest row to the
                // control is the one it is usually reached for: «Neue Pendenz» is LAST here, which
                // on screen means bottom, which means under the thumb.
                // The «Meldung zu» group keeps its heading ABOVE its own rows: a label under the
                // things it names is not a heading, whichever way the list is read.
                items={noteOn
                  ? [
                    // Writing a Meldung — and the menu asks the SAME question it asks anywhere
                    // else, with the same rows in the same places. «this is its own thing after
                    // all» is a normal thing to realise halfway through a sentence, and it was
                    // two steps: let the link go, then say what the line is instead.
                    { kind: 'head' as const, label: C.linkPendenzTitle },
                    ...openPendenzen.map((r) => ({
                      label: menuRow(r.urgent ? 2 : 1, r.text, r.id === noteOn.id),
                      onClick: () => onLinkPendenz?.(r),
                    })),
                    ...(onClearNote
                      ? [
                        { label: menuRow(0, C.noteOnClear, false), onClick: onClearNote, sticky: true },
                        // ⚠️ Both of these UNLINK first. `submit` reads `noteFor` before `pendenz`,
                        // so a draft still carrying the link would quietly ignore the choice just
                        // made and file the line as a Meldung anyway.
                        { label: menuRow(2, C.pendenzNewUrgent, false), onClick: () => { onClearNote(); setOpen(2) }, sticky: true },
                        { label: menuRow(1, C.pendenzNew, false), onClick: () => { onClearNote(); setOpen(1) }, sticky: true },
                      ]
                      : []),
                  ]
                  : [
                  // ⚠️ Every row carries THE RING, in the state it produces — empty, amber, or red
                  // with the bang. The menu is opened from that ring and sets that ring, so a list
                  // of bare sentences made the two look like unrelated things; the same shape in
                  // three fills says what the words would have to spell out.
                  ...(canLink
                    ? [
                      { kind: 'head' as const, label: C.linkPendenzTitle },
                      // the open items in the order the Pendenzen block itself uses: dringend
                      // first, then the oldest. An item shows ITS OWN urgency, the block's red.
                      ...openPendenzen.map((r) => ({ label: menuRow(r.urgent ? 2 : 1, r.text, false), onClick: () => onLinkPendenz?.(r) })),
                      // …no separator: the pinned block below carries its own edge, and one in the
                      // flow would scroll away from the boundary it is supposed to mark
                    ]
                    : []),
                  // ⚠️ PINNED to the bottom, not merely last. Last alone meant one of the two ends
                  // of a scrolling list had to lose: opening at the top hid «Neue Pendenz» below
                  // the fold, opening at the bottom hid the most pressing items above it. Pinned,
                  // the list keeps its own order — dringend first, then oldest, read from the top —
                  // while the rows you nearly always want stay under the thumb.
                  ...(openState > 0 ? [{ label: menuRow(0, C.pendenzNotOpen, false), onClick: () => setOpen(0), sticky: true }] : []),
                  { label: menuRow(2, C.pendenzNewUrgent, openState === 2), onClick: () => setOpen(2), sticky: true },
                  { label: menuRow(1, C.pendenzNew, openState === 1), onClick: () => setOpen(1), sticky: true },
                  ]}
                // ⚠️ The ring IS the trigger. It was an invisible anchor beside it for a while,
                // with the open state held here — and then a second press on the ring counted as
                // an OUTSIDE press, so Base UI closed the menu and the click handler opened it
                // again on the same tap. Base UI's own trigger toggles, and it is the only thing
                // that can: it knows about the press before the outside-press handler runs.
                trigger={(
                  <button
                    type="button"
                    onMouseDown={(e) => { if (phone && document.activeElement === textRef.current) e.preventDefault() }}
                    className="jc-open"
                    data-state={noteOn ? 1 : openState}
                    title={noteOn ? C.linkPendenzTitle : C.openStates[openState]}
                    aria-label={noteOn ? C.linkPendenzTitle : C.openStates[openState]}
                  >
                    {/* ⚠️ Not the `warn` triangle. A triangle's optical centre sits below its
                        bounding box, so inside a ring it reads as hanging — and a triangle inside
                        a circle is two outlines fighting at 21px. Solid disc + a drawn bang. */}
                    <span className="jc-ring">{openState === 2 && <span className="jc-bang" />}</span>
                  </button>
                )}
              />
              </span>
            </div>
          </div>

          {/* media: record a voice memo or attach a photo — on EVERY entry now, including one that
              carries a due time. An Erinnerung used to be text-only, which is why «Foto vom
              Zähler, in 10 min nachschauen» had to be two rows. */}
          <div className="jc-audio">
            {/* recording shows the stop square + the running time, NOT «Aufnahme stoppen · 22s»:
                this button is one of three in a fixed 1fr grid and that label never fitted, so it
                ran out past the red rounded corner. It is also what the TopBar and the FAB already
                turn into while recording — a red pulsing button with a square and a clock reads as
                «tap to stop» without spending a third of the row saying so. */}
            {/* ⚠️ Every label in this row sits in its own <span class="jc-lbl">. On a phone with
                the keyboard up the row shrinks to four icons (see 15-mobile.css · .is-kb), and a
                bare text node cannot be hidden by CSS. The `title` carries the word for anyone
                hovering, and the labels come straight back the moment the keyboard closes. */}
            <button className={`jc-rec ${recording ? 'on' : ''}`} onClick={toggleRecord} title={recording ? C.recordStop : C.record} aria-label={recording ? C.recordStop : C.record}>
              {recording
                ? <><span className="tb-stop" /><span className="jc-rec-time">{elapsed}s</span></>
                : <><Icon id="mic" /><span className="jc-lbl">{C.record}</span></>}
            </button>
            {/* ONE upload button for everything that already exists as a file — a picture from
                the gallery, an externally recorded memo, the PDF the Eigentümer just sent. It
                used to accept audio only, so the commonest Beilage of all had no way in at all.
                What was picked decides where it lands (lib/audioImport · classifyPick).
                The media buttons share one row at a third of the width each — not even a desktop
                third fits «Datei hochladen», so the short form labels the button and the full one
                stays as its tooltip. The upload arrow carries the rest. */}
            <button className="jc-rec" onClick={() => attachRef.current?.click()} title={C.attachUpload} aria-label={C.attachUpload}>
              <Icon id="upload" /><span className="jc-lbl">{C.attachUploadShort}</span>
            </button>
            <button className="jc-rec" onClick={() => fileRef.current?.click()} title={C.photo} aria-label={C.photo}><Icon id="cam" /><span className="jc-lbl">{C.photo}</span></button>
            {clip && (
              <span className="jc-clip">
                <button className={`tl-play ${clipPlaying ? 'playing' : ''}`} title={clipPlaying ? C.recordStop : appConfig.copy.play} aria-label={clipPlaying ? C.recordStop : appConfig.copy.play} onClick={toggleClip}><Icon id={clipPlaying ? 'pause' : 'play'} /></button>
                <span className="jc-clip-name">
                  <strong>{C.audioClipLabel}</strong>
                  <em>{clip.secs}s</em>
                </span>
                <button className="jc-clip-x" title={C.discardAudio} aria-label={C.discardAudio} onClick={discardClip}><Icon id="close" /></button>
              </span>
            )}
          </div>
        </div>

        {/* ⚠️ `.file-picker`, never `hidden`: Safari opens a file chooser only for an input it
            actually renders, so `.click()` on a display:none input is a silent no-op on iOS
            (see 02-base.css). Off-screen and transparent, both pickers work on a phone.
            Fixed-positioned, so they are out of the sheet's flow wherever they sit. */}
        <input ref={fileRef} type="file" accept="image/*" capture="environment" multiple
          className="file-picker" tabIndex={-1} onChange={onPhotoPicked} />
        <input ref={attachRef} type="file" accept={MEDIA_IMPORT_ACCEPT} multiple
          className="file-picker" tabIndex={-1} onChange={onAttachPicked} />
        {imported && (
          <div className="jc-import">
            <div className="jc-import-row">
              <button className={`tl-play ${clipPlaying ? 'playing' : ''}`} title={clipPlaying ? C.recordStop : appConfig.copy.play} aria-label={clipPlaying ? C.recordStop : appConfig.copy.play} onClick={toggleClip}><Icon id={clipPlaying ? 'pause' : 'play'} /></button>
              <span className="jc-import-name">
                <strong>{C.audioImportLabel}</strong>
                <em>{imported.name}{imported.durationSec != null ? ` · ${formatAudioDuration(imported.durationSec)}` : ''}</em>
              </span>
              <button className="jc-clip-x" title={C.audioDiscardImport} aria-label={C.audioDiscardImport} onClick={discardImport}><Icon id="close" /></button>
            </div>
            <div className="jc-import-start">
              <span className="jc-due-label">{C.audioStartLabel}</span>
              {/* THE time field (TimeField · WheelPopover), not a stepper of its own: the same wheels
                  and typed field as every other clock in the app. Committing it counts as the
                  confirmation the gate waits for, as moving the ± did. */}
              <TimeField required value={startHHMM} ariaLabel={C.audioStartLabel}
                onCommit={(v) => { if (v) { setStartHHMM(v); setStartConfirmed(true) } }} />
              <Chip selected={startConfirmed} icon={<Icon id="check" />} onClick={() => setStartConfirmed(true)}>
                {C.audioStartConfirm}
              </Chip>
            </div>
            <p className="jc-import-hint">{C.audioStartHint}</p>
          </div>
        )}
        {photos.length > 0 && (
          <div className="jc-photos">
            {photos.map((url) => (
              <div className="jc-photo" key={url}>
                {/* the session thumbnail, not the camera file (see addPhotos) */}
                <img src={thumbUrl(url)} alt="" decoding="async" />
                <button className="jc-clip-x" title={C.discardPhoto} aria-label={C.discardPhoto} onClick={() => discardPhoto(url)}><Icon id="close" /></button>
              </div>
            ))}
          </div>
        )}
        {/* staged Beilagen: a document has no thumbnail worth showing, so the chip says the two
            things that identify it — the name it was picked under and how big it is. Each one
            keeps its own ✕ (entfernen: nothing has been saved yet). */}
        {files.length > 0 && (
          <div className="jc-files">
            {files.map((f, i) => (
              <span className="jc-file" key={`${f.name}:${i}`}>
                <Icon id="attach" />
                {/* «Beilage / Name · Grösse» — the shape .jc-clip and .jc-import already use */}
                <span className="jc-file-name">
                  <strong>{C.attachLabel}</strong>
                  <em>{f.name} · {fmtFileSize(f.file.size)}</em>
                </span>
                <button className="jc-clip-x" title={C.attachDiscard} aria-label={C.attachDiscard} onClick={() => discardFile(i)}><Icon id="close" /></button>
              </span>
            ))}
          </div>
        )}

        {/* the send, alone. The pin moved up into the media row (see .jc-audio) — it describes
            the entry, not the act of saving it, and «Erfassen» is the one thing on this sheet
            that must never share a row with anything else. */}
        <div className="jc-foot">
          <Button variant="primary" block disabled={!canSend || uploading || locating} onClick={submit}
            icon={uploading || locating ? <ShellLoader /> : <Icon id="check" />}>
            {uploading ? C.audioUploading : locating ? C.photoLocating : C.send}
          </Button>
        </div>
      {/* «Uhrzeit …» — the one answer that is not a row in a menu. It opens THE time picker
          (WheelPopover: wheels for a finger, a typed field for a keyboard, a day column) straight
          from the clock button. It was a dialog with a ± stepper of its own (owner, 08.10.2026:
          «use our normal picker, to avoid having another one») — one picker, no dialog-in-dialog.
          The popover joins the dismissal guard, so its Esc / outside tap closes only it, never
          the composer underneath. */}
      {exact != null && (
        <WheelPopover
          anchor={exact.anchor}
          initial={(() => {
            const [y, m, d] = exact.day.split('-').map(Number)
            const [h, mi] = exact.hhmm.split(':').map(Number)
            return new Date(y, m - 1, d, h, mi, 0, 0)
          })()}
          // ⚠️ THE DAY, always — not «and if that time is already past, then tomorrow». An Einsatz
          // runs over midnight often enough that the rule was silently right most of the time and
          // silently wrong the rest, on a surface where nobody re-reads what they set. A bounded
          // column (today + the next days, see REMIND_DAYS), not a calendar.
          days={remindDays(exact.day)}
          title={C.dueExactTitle}
          // «Jetzt» is never a Wiedervorlage: it fires the moment it is saved
          noNow
          // what the two together mean, resolved exactly as `resolveDueAt` will resolve them —
          // including the one the wheels make possible: a time that has already gone by.
          // ⚠️ That one BLOCKS «OK» rather than quietly rolling forward: a reminder that fires the
          // second it is saved is not what «22:57» meant, and the fix is one flick of the day.
          note={(v: WheelValue) => {
            const sel = { day: `${v.y}-${pad2(v.mo)}-${pad2(v.d)}`, hhmm: `${pad2(v.h)}:${pad2(v.mi)}` }
            const at = resolveDueAt({ kind: 'at', ...sel })
            return at && Date.parse(at) <= Date.now()
              ? { text: C.duePast, blocks: true }
              : { text: `${dayLabel(sel.day)} · ${sel.hhmm}` }
          }}
          onClose={() => setExact(null)}
          onCommit={(v: WheelValue) => {
            setExact(null)
            setDue({ kind: 'at', day: `${v.y}-${pad2(v.mo)}-${pad2(v.d)}`, hhmm: `${pad2(v.h)}:${pad2(v.mi)}` })
          }}
        />
      )}
    </Overlay>
  )
}
