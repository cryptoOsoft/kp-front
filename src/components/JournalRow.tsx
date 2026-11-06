// One row of the Verlauf (Journal) and the classification disc it shares with the drawer's
// legend and filter menu. The row is the drawer's `.map` body made a component (sweep A.8): it
// gets the drawer's lookups and handlers as props and renders exactly what the inline body did.
// Not `React.memo`'d: its caller (workspace/JournalLayer) hands the drawer fresh callbacks every
// render, so a memo would compare unequal props on every pass.

import type { ReactNode } from 'react'
import type { PlanDocument, TimelineEvent } from '../types'
import { Icon } from '../lib/icons'
import { Button } from './Button'
import { caretToEnd, openPhoto } from '../lib/ui'
import { appConfig } from '../config/appConfig'
import { dueClock, fillTemplate, fmtDuration, formatTime } from '../lib/format'
import { safeHref, thumbUrl } from '../lib/mediaUrl'
import { isHandWritten, isNachtrag, rowGlyph, rowPhotos, rowTarget, rowText, rowTime, type ArtTone } from '../lib/verlauf'
import { journalDisc } from '../lib/report'
import type { OpenReminder } from '../lib/reminders'
import { DoneChip } from './DoneChip'
import type { JournalProps } from './Journal'

/** What the disc draws for a Pendenz, or null on every other row.
 *  ⚠️ Only the row that RAISED an item, and the row that closed it, wear the ring. A Meldung and
 *  a snooze are log lines ABOUT the item — they keep their own glyph and, in the Meldung's case,
 *  the anchor that names which item they answer. */
export type RingState = 'open' | 'urgent' | 'overdue' | 'done'

/** The 26px classification disc: the row's glyph in its Bereich tint, or the Pendenz ring.
 *  The ring is the composer's own ring (18-audio · .jc-ring) at row size — which is what
 *  JournalComposer's «the same ring that appears on the Verlauf row» has claimed all along.
 *
 *  ⚠️ With `onTick` the ring becomes the TICK-OFF control, identical to the one in the pinned
 *  Pendenzen block (.jr-pinned-row .jr-rem) — same ring, same call, same appended `done` row.
 *  It is offered on exactly the rows that are still open; a closed one is a fact, not a switch. */
export function Disc({ icon, surface, tone, ring, title, onTick, tickTitle }: {
  icon?: string
  surface?: 'map' | 'plan' | null
  /** a hand-written row's Art (lib/verlauf · rowGlyph): the Auftrag's blue, the Sofortmassnahme's amber */
  tone?: ArtTone
  ring?: RingState | null
  title?: string
  /** tick this row's Pendenz off in place — appends, never mutates (see onReminderDone) */
  onTick?: () => void
  tickTitle?: string
}) {
  if (ring) {
    const inner = (
      <span className={`jr-ring jr-ring-${ring}`}>
        {/* the ghost check a tickable ring shows under the finger — the pinned block's ring does
            exactly this. Not on `urgent`: that ring is a filled disc with the drawn bang in it,
            and a second glyph in the same 20px would be two marks fighting for one centre. */}
        {(ring === 'done' || (!!onTick && ring !== 'urgent')) && <Icon id="check" />}
        {ring === 'urgent' && <i className="jr-bang" />}
      </span>
    )
    if (onTick) {
      return (
        <button
          type="button" className="ic jr-ic-ring jr-ic-tick"
          title={tickTitle} aria-label={tickTitle}
          onClick={(ev) => { ev.stopPropagation(); onTick() }}
        >{inner}</button>
      )
    }
    return <span className="ic jr-ic-ring" title={title}>{inner}</span>
  }
  return (
    <span className={`ic${surface ? ` jr-ic-${surface}` : ''}${tone ? ` jr-ic-${tone}` : ''}`} title={title}>
      <Icon id={icon || 'doc'} />
    </span>
  )
}

/** A recording as a window on the incident timeline: a row whose time falls inside it is an
 *  annotation of that recording and links back into the player at its moment. */
export type AudioWindow = { row: TimelineEvent; start: number; end: number }

type Draft = { id: string; value: string } | null

type JournalRowProps = Pick<JournalProps,
  'live' | 'closedAt' | 'replayAtMs' | 'onSelect' | 'onSeekTo' | 'onTranscript' | 'onEditText' | 'onOpenPlayer'
  | 'onReminderDone' | 'onReminderAgain' | 'mediaStatusOf'> & {
  e: TimelineEvent
  plans: PlanDocument[]
  /** the drawer's clock, captured when it opened — flags overdue reminders */
  now: number
  /** still-open reminders by id (lib/reminders) */
  openMap: ReadonlyMap<string, OpenReminder>
  /** how many times this row's state was re-stated in a run (lib/verlauf · repeatRuns); 1 = once */
  repeated: number
  /** reminder id → the item's own words, and → the row that raised it (a Meldung's anchor) */
  pendenzTitles: ReadonlyMap<string, string>
  pendenzRowIds: ReadonlyMap<string, string>
  /** closed item id → minutes ahead of its still-open re-raise (lib/reminders · openReRaises) */
  reRaised: ReadonlyMap<string, number>
  audioWindows: readonly AudioWindow[]
  /** this row's recording is the one sounding */
  playing: boolean
  /** the inline transcript / text editors — open on this row when their id is this row's */
  editTx: Draft
  editRow: Draft
  /** marks the linkable vocabulary in a piece of prose (lib/journalLinks) */
  marked: (text: string, subjectId?: string) => ReactNode
  /** scroll to a row and flash it; `smooth` where a person asked to go there */
  jumpToRow: (id: string, smooth?: boolean) => boolean
  onTogglePlay: (id: string, url: string) => void
  onOpenDetail: (id: string) => void
  setEditTx: (d: Draft) => void
  setEditRow: (d: Draft) => void
  saveTranscript: () => void
  saveRowText: () => void
}

/** One Verlauf row: time, disc, the sentence, its trail of footnotes/media/controls, and the
 *  transcript lines and inline editors under it. Rendered by Journal once per shown row. */
export function JournalRow({
  e, plans, live, closedAt, now, replayAtMs, openMap, repeated, pendenzTitles, pendenzRowIds, reRaised, audioWindows, playing,
  editTx, editRow, marked, jumpToRow, onTogglePlay, onOpenDetail, setEditTx, setEditRow, saveTranscript, saveRowText,
  onSelect, onSeekTo, onTranscript, onEditText, onOpenPlayer, onReminderDone, onReminderAgain, mediaStatusOf,
}: JournalRowProps) {
  const C = appConfig.copy.journal
  const target = rowTarget(e, live)
  // ── during a Wiedergabe every row is a way into the picture ──
  // A row's tap sets the MOMENT, so the map, the Trupps and the Plan all read as they
  // did when the line was written. That is the question the old «anheften» toggle was
  // really being asked, and this answers it for EVERY row rather than for the few
  // somebody remembered to pin — including the ones written before the toggle existed.
  const rowMs = e.at ? Date.parse(e.at) : NaN
  const seekable = onSeekTo != null && Number.isFinite(rowMs)
  // sections written in the player count as transcription too — the amber asks
  // for words that are missing, not for a particular field to be filled
  const hasTx = !!e.transcript || !!e.transcriptSections?.length
  // Rows with paperwork actions (Durchhören / Transkript on a memo, the pen on a
  // hand-written line) open the detail sheet on their tap — variant 2, 29.08. The
  // jump the tap used to be moves into the sheet with them. NOT during a Wiedergabe:
  // there the tap keeps setting the moment, which outranks after-action paperwork.
  const hasDetail = (!!e.audioUrl && ((!!e.audioMeta && !!onOpenPlayer) || !!onTranscript))
    || (!!onEditText && isHandWritten(e) && !e.audioUrl)
  const opensDetail = !seekable && hasDetail
  const clickable = seekable || opensDetail || target != null
  const onRow = seekable ? () => onSeekTo(e)
    : opensDetail ? () => onOpenDetail(e.id)
    : target != null ? () => onSelect(e) : undefined
  // …and rows the playhead has not reached yet are the future: shown (the Verlauf stays
  // whole and searchable) but visibly not-yet, so nothing on screen claims to be part of
  // the moment being looked at.
  const future = replayAtMs != null && Number.isFinite(rowMs) && rowMs > replayAtMs
  // a `created` reminder row: still-open (look up derived state) ⇒ show due + done
  // toggle; gone from the open set ⇒ already erledigt (checked + struck through).
  // ⚠️ Keyed off the LIFECYCLE EVENT, not off `kind === 'reminder'`. A Pendenz rides on
  // an ordinary entry row (kind 'journal' / 'audio' / 'photo'), because the entry IS the
  // open item — «Auftrag · Trupp 2 entraucht Treppenhaus» is the record and the Pendenz
  // in one line. Only the timed Erinnerung still writes a row of its own.
  const isReminder = e.reminder?.op === 'created'
  const openRem = isReminder && e.reminder ? openMap.get(e.reminder.id) : undefined
  const remDone = isReminder && !openRem
  const remOverdue = !!openRem?.dueAt && Date.parse(openRem.dueAt) <= now
  // A `done` row CLOSED its item only while the item is still closed: «Erledigt» →
  // «Rückgängig» appends a `reopened`, and the old done row then describes nothing
  // current — no closed ring, and no «wieder in», which would raise a duplicate of an
  // item that is open right now.
  const closedRow = e.reminder?.op === 'done' && !openMap.has(e.reminder.id)
  // ── the disc ──
  // ONE classification column, and the row's only one. A Pendenz shows the ring (the
  // composer's own, which is what it has always promised); every other row shows its
  // glyph, tinted where the Bereich is one of the two drawing surfaces. The WORD used
  // to sit in a chip before the sentence — beside a sentence that already carried it
  // («Auftrag · …») and, on a Pendenz, beside a second chip saying «Pendenz» again.
  // The word now lives in the disc's title and in the legend in the head.
  const ring: RingState | null = isReminder
    ? (remDone ? 'done' : openRem?.urgent ? 'urgent' : remOverdue ? 'overdue' : 'open')
    // …and the row that CLOSED the item wears the closed ring. `snoozed` and `note` do
    // not: they are log lines about the item, not the item.
    : closedRow ? 'done' : null
  const disc = journalDisc(e, plans)
  const glyph = rowGlyph(e)
  // the footnotes on the row — appended facts about it, so they read AFTER the sentence
  const nachtrag = isNachtrag(e, closedAt)
  const hasFootnotes = nachtrag || !!e.correctedAt || repeated > 1 || e.via === 'atemschutz-link' || e.via === 'atemschutz-fix'
  const txMissing = !!e.audioUrl && !!onTranscript && !hasTx
  const mediaState = (rowPhotos(e).length > 0 || !!e.audioUrl) ? mediaStatusOf?.(e.id) : undefined
  const offersAgain = closedRow && !!onReminderAgain
  const hasMeta = hasFootnotes || txMissing || !!mediaState || offersAgain
  return (
    <div
      className={`hist-ev ${clickable ? 'clickable' : ''} ${future ? 'jr-future' : ''}`}
      data-ev={e.id}
      role={clickable ? 'button' : undefined}
      tabIndex={clickable ? 0 : undefined}
      onClick={onRow}
      onKeyDown={onRow ? (ev) => { if (ev.key === 'Enter' || ev.key === ' ') { ev.preventDefault(); onRow() } } : undefined}
    >
      <span className="t">{rowTime(e)}</span>
      {/* ⚠️ The ring is the tick-off, HERE as well as in the pinned block. It was taken
          off the row on the grounds that two controls did the same thing and this one
          scrolls away — but a Pendenz is met in the log at least as often as in the
          block (a Meldung on it, a search, the row it was raised on), and «scroll back
          up and find it again» is not a way to close an Auftrag at 3am. The ring is the
          one vocabulary both places share, so it means the same thing in both: one tap
          appends a `done` row (onReminderDone → useReminders · markDone). It is not a
          second path to the state — it is the same call. */}
      <Disc
        icon={glyph.icon} surface={disc.surface} tone={glyph.tone} ring={ring} title={disc.label}
        onTick={openRem && onReminderDone ? () => onReminderDone(openRem) : undefined}
        tickTitle={C.markDoneTitle}
      />
      {/* ⚠️ THE SENTENCE, and nothing before it. Every row's text starts on one x —
          the same axis the sub-lines below it use — so reading 200 rows in the dark is
          riding one edge instead of scanning a ragged column. Six decorations used to
          stand in front of it, all of them `flex: none` against the one shrinkable
          child, which is how «Audionotiz (6s)» once came out as fourteen lines of one
          character on a phone. In a grid there is nothing left to shrink.
          The names in it are marked with the same vocabulary the composer marked them
          with while they were being typed — and the job after a name on its first
          mention («Widmer Céline (EL)»), because a Verlauf full of surnames tells a
          reader who was talking only if they already know the Wehr. */}
      {/* ⚠️ `rowText`, not `e.text`: a picture row with no caption of its own reads
          «Foto» (reversed 31.08. — a run of them was a column of bare timestamps). The
          RECORD is untouched either way (lib/verlauf · rowText). */}
      {/* ⚠️ The sentence's cell holds the sentence and, UNDER it, the facts about the row
          (27.10.2026 sweep #12): «Nachtrag», «korrigiert», «n×», the missing-transcript and
          upload chips stood in the trailing group beside the sentence and took half a phone
          row from it – «Audionoti|z (24s)» broke mid-word between NACHTRAG, ⚠ Transkript and
          the play circle. The «wieder in» pills joined them. The trail keeps the row's own
          controls (play, jump, thumbnails, files); the sentence gets the width. */}
      <span className="jr-main">
        <span className={`jr-text ${remDone ? 'jr-rem-struck' : ''}`}>{marked(rowText(e), e.subjectId)}</span>
        {hasMeta && (
          <span className="jr-meta">
            {/* Footnotes ABOUT the row — «Nachtrag», «korrigiert HH:MM», «6×». They say
                that the append-only record holds more than the row shows, which is worth
                keeping and worth reading last: a footnote belongs after the thing it
                annotates, not in front of it. */}
            {hasFootnotes && (
              <span className="jr-foot">
                {nachtrag && <b className="jr-foot-nachtrag">{C.nachtrag}</b>}
                {e.correctedAt && (
                  <span title={C.correctHint}>{fillTemplate(C.corrected, { t: formatTime(new Date(e.correctedAt)) })}</span>
                )}
                {repeated > 1 && (
                  <span className="jr-foot-rep" title={C.repeatedTitle}>{fillTemplate(C.repeated, { n: String(repeated) })}</span>
                )}
                {/* The row came in over the Atemschutz-Link — the board handed to somebody's
                    own phone — or over the standing fixe URL (`atemschutz-fix`, the
                    laminated QR at the Tafel). It is deliberately NOT a name (those
                    sessions are asked for none), so the footnote says WHERE it was
                    written, which is the honest answer and the one the Rapport can be
                    read against; the reader-facing sense is the same for both, only the
                    record keeps them apart. Server-written (types · TimelineEvent.via);
                    this client never sets it. */}
                {(e.via === 'atemschutz-link' || e.via === 'atemschutz-fix') && (
                  <span title={C.viaAtemschutzLinkTitle}>{C.viaAtemschutzLink}</span>
                )}
              </span>
            )}
            {/* ── Durchhören + Transkript sind aus der Zeile gezogen (29.08., Variante 2) ──
                They stood as ~30px icons beside the play circle: three equal-weight targets
                where only playback is time-critical mid-incident. Both live in the row's
                detail sheet now (tap the row) and the play circle is the row's ONE inline
                control, grown to the tap floor (.hist-ev .tl-play, 10-journal.css). The
                missing-transcript state keeps its amber ON the row — as a chip on the row
                meta, since the button that carried it is no longer here. The transcript
                TEXT still gets its own lines below (see .jr-subs): content, not a control. */}
            {txMissing && (
              <span className="jr-media-state jr-tx-miss" title={C.transcriptAdd}>
                <Icon id="warn" />
                <span>{appConfig.copy.report.transcript}</span>
              </span>
            )}
            {mediaState && (
              <span className={`jr-media-state ${mediaState === 'failed' ? 'failed' : 'pending'}`}
                title={mediaState === 'failed' ? C.mediaFailed : C.mediaPending}>
                <Icon id={mediaState === 'failed' ? 'warn' : 'rotate'} />
                <span>{mediaState === 'failed' ? C.mediaFailed : C.mediaPending}</span>
              </span>
            )}
            {/* «wieder in …» on the row that CLOSED an item: the moment a Lagerapport is
                ticked off is when the next one gets its time (Führungsrhythmus). Each tap
                appends a FRESH `created` row with a new id — the closed item stays closed,
                the record stays append-only. Deliberately on every done row, not only the
                newest: re-raising an hours-old Pendenz from where it was closed is the use.
                Under the sentence, not beside it (27.10.2026, lead on #12): beside it the two
                pills squeezed «Pendenz erledigt: …» into seven lines on a phone. */}
            {/* …and a one-time action (docs/ui-conventions.md · One-time actions, 05.11.2026):
                while the item it raised is open, the chips give way to ✓ «↻ in 30 min gesetzt»
                (lib/reminders · openReRaises) – a double tap raised two. Its own done row offers
                the next one. */}
            {closedRow && onReminderAgain && (e.reminder && reRaised.has(e.reminder.id) ? (
              <span className="jr-again">
                <DoneChip>{fillTemplate(C.againSet, { mins: String(reRaised.get(e.reminder.id)) })}</DoneChip>
              </span>
            ) : (
              <span className="jr-again">
                {[30, 60].map((m) => (
                  <button
                    key={m} type="button" className="jr-again-btn"
                    title={fillTemplate(C.againTitle, { mins: String(m) })}
                    aria-label={fillTemplate(C.againTitle, { mins: String(m) })}
                    onClick={(ev) => { ev.stopPropagation(); onReminderAgain(e.reminder!.id, m) }}
                  >↻ {fillTemplate(C.againChip, { mins: String(m) })}</button>
                ))}
              </span>
            ))}
          </span>
        )}
      </span>
      <span className="jr-trail">
        {/* ⚠️ A MELDUNG names the ITEM it answers. The word «PENDENZ» on all of them said
            only what one could already see; what was missing is WHICH one, and three
            «PENDENZ» rows in a row were three unrelated sentences. The Verlauf is
            chronological, so each link has to carry its own anchor — and the anchor is
            the item's own opening words, not a label.
            …and it is a WAY BACK, not a caption. The reference has to be truncated to
            fit, so the words alone often cannot identify the item — tapping it scrolls
            to the row that raised it and flashes it, which answers «which one» in full
            and in its own context. */}
        {e.reminder?.op === 'note' && pendenzTitles.get(e.reminder.id) && (
          <button
            type="button" className="jr-note-on"
            title={C.openReminderGo} aria-label={C.openReminderGo}
            onClick={(ev) => { ev.stopPropagation(); jumpToRow(pendenzRowIds.get(e.reminder!.id)!, true) }}
            disabled={!pendenzRowIds.has(e.reminder.id)}
          ><i>{pendenzTitles.get(e.reminder.id)}</i></button>
        )}
        {/* ⚠️ No CONTROL out here — the tick lives on the ring in the icon slot (see the
            Disc above), where it is the same shape and the same gesture as in the pinned
            block. What stays at this end is the FACT: a timed Erinnerung's Fälligkeit.
            The old pill-shaped «erledigt» button that stood here was the thing worth
            removing — a second, differently-shaped control for the same state. */}
        {isReminder && openRem?.dueAt && (
          <span className={`jr-remstate ${remOverdue ? 'overdue' : ''}`}>
            {remOverdue ? C.overdueLabel : C.dueAtLabel.replace('{t}', dueClock(openRem.dueAt))}
          </span>
        )}
        {/* opens IN the app (lib/ui · openPhoto): `target="_blank"` handed the picture to
            Safari on an installed iPad, which means leaving a running Einsatz to look at
            a photo of it. The viewer keeps the one thing the new tab was good for — a
            download. */}
        {rowPhotos(e).map((url, i) => (
          <button
            key={url} type="button" className="jr-thumb" title={C.photoOpen} aria-label={C.photoOpen}
            onClick={(ev) => { ev.stopPropagation(); openPhoto(url, { caption: e.text, filename: `foto-${e.id}-${i + 1}.jpg` }) }}
          >
            {/* the SMALL copy — a 40 px chip pointed at the full picture is what
                killed the tab on a phone (lib/mediaUrl · thumbUrl). The viewer the tap
                opens still gets `url` itself. */}
            <img src={thumbUrl(url)} alt="" loading="lazy" decoding="async" />
          </button>
        ))}
        {/* Beilagen that are not pictures (PDF, Dokument): a named chip that DOWNLOADS
            on tap. No in-app viewer — the server hands generic files out as an
            attachment on purpose (backend/app/api/media.py · get_media), so the OS
            opens it in whatever can read it. ⚠️ The server's Content-Disposition BEATS
            the `download` attribute, so the operator's own filename travels as `?name=`
            and the route sanitises it there; `download` stays as the same-origin hint. */}
        {(e.files ?? []).map((f) => {
          // …and the URL itself through safeHref before it becomes an href: the row is
          // synced data another device wrote, so a poisoned record must not put
          // javascript:/data: behind a chip (lib/mediaUrl). Rejected → the chip stays,
          // link-less: the NAME is information, the dead link is not.
          const href = safeHref(f.url)
          return (
            <a
              key={f.url} className="jr-file" download={href ? f.name : undefined}
              href={href ? `${href}${href.includes('?') ? '&' : '?'}name=${encodeURIComponent(f.name)}` : undefined}
              title={C.attachOpen} aria-label={`${C.attachOpen}: ${f.name}`}
              onClick={(ev) => ev.stopPropagation()}
            >
              <Icon id="attach" /><span>{f.name}</span>
            </a>
          )
        })}
        {/* ── Der Stift ist von der Zeile gezogen (29.08., Variante 2) ──
            Correcting a hand-written line stays exactly what it was — an appended
            `textEdit` patch, both wordings in the record and in the hash chain, the
            line says «korrigiert HH:MM» — but the pen now lives in the row's detail
            sheet (tap the row), not as an inline icon. It is paperwork, not a 3am
            action. Still NEVER on system rows («Trupp 2 eingerückt» is the app
            reporting an action), and NOT on audio rows (their words live in the
            transcript). See the sheet at the bottom of the drawer. */}
        {!e.audioUrl && e.at && onOpenPlayer && (() => {
          // annotation of a recording → jump into the player at this moment
          const t = Date.parse(e.at)
          const w = audioWindows.find((x) => t >= x.start && t <= x.end)
          if (!w) return null
          return (
            <button
              className="jr-jump"
              title={C.playerOpen}
              aria-label={C.playerOpen}
              onClick={(ev) => { ev.stopPropagation(); onOpenPlayer(w.row, (t - w.start) / 1000) }}
            ><Icon id="wave" /></button>
          )
        })()}
        {e.audioUrl && (
          <button
            className={`tl-play ${playing ? 'playing' : ''}`}
            title={playing ? appConfig.copy.journal.recordStop : appConfig.copy.play}
            aria-label={playing ? appConfig.copy.journal.recordStop : appConfig.copy.play}
            onClick={(ev) => { ev.stopPropagation(); onTogglePlay(e.id, e.audioUrl!) }}
          ><Icon id={playing ? 'pause' : 'play'} /></button>
        )}
        {/* a detail-opening row is a chevron even when pinned — the tap opens the
            sheet, and the jump to the pinned place lives inside it */}
        {clickable && <span className="hist-go" aria-hidden><Icon id={e.pinned && !opensDetail ? 'coords' : 'chevron'} /></span>}
      </span>
      {/* the words, as SUBTITLE lines under the row — the plain transcript first (the
          memo's words as one text, no offset), then the player's timed sections with
          their offset into the recording. The row's own text stays «Audionotiz (8s)»:
          that is what the entry IS; these lines are what it says. */}
      {e.audioUrl && editTx?.id !== e.id && (e.transcript || e.transcriptSections?.length) && (
        <div className="jr-subs">
          {e.transcript && <p><span>{marked(e.transcript)}</span></p>}
          {(e.transcriptSections ?? []).map((s, i) => (
            <p key={i}><i>{fmtDuration(s.at)}</i><span>{marked(s.text)}</span></p>
          ))}
        </div>
      )}
      {/* the transcript editor, on its own line under the row */}
      {e.audioUrl && editTx?.id === e.id && (
        <div className="jr-transcript" onClick={(ev) => ev.stopPropagation()}>
          <textarea
            value={editTx.value}
            rows={3}
            autoFocus
            onFocus={caretToEnd}
            placeholder={C.transcriptPlaceholder}
            onChange={(ev) => setEditTx({ id: e.id, value: ev.target.value })}
            onKeyDown={(ev) => { if (ev.key === 'Escape') setEditTx(null) }}
          />
          <div className="jr-transcript-actions">
            {/* re-editing an existing transcript is a correction like any other —
                appended, never overwritten — and says so; a first transcript has no
                original wording to reassure about */}
            {e.transcript && <span className="jr-korr-hint">{C.correctHint}</span>}
            <Button onClick={() => setEditTx(null)}>{appConfig.copy.cancel}</Button>
            <Button variant="primary" icon={<Icon id="check" />} onClick={saveTranscript}>{C.transcriptSave}</Button>
          </div>
        </div>
      )}
      {editRow?.id === e.id && (
        <div className="jr-transcript" onClick={(ev) => ev.stopPropagation()}>
          <textarea
            value={editRow.value}
            rows={2}
            autoFocus
            onFocus={caretToEnd}
            onChange={(ev) => setEditRow({ id: e.id, value: ev.target.value })}
            onKeyDown={(ev) => { if (ev.key === 'Escape') setEditRow(null) }}
          />
          <div className="jr-transcript-actions">
            <span className="jr-korr-hint">{C.correctHint}</span>
            <Button onClick={() => setEditRow(null)}>{appConfig.copy.cancel}</Button>
            <Button variant="primary" icon={<Icon id="check" />} onClick={saveRowText}>{C.transcriptSave}</Button>
          </div>
        </div>
      )}
    </div>
  )
}
