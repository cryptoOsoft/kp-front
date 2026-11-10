// The Durchhören sheet – a recorded Verlauf row played back as a window on the incident timeline:
// its markers (derived, lib/audioPlayer), the server waveform and the STT transcript drafts.
// Everything the server adds is an aid, never a gate: no peaks → a flat bar; no STT engine, no
// editor or a link session → no Transkribieren (fail-closed). What it writes stays append-only –
// journal rows, or transcript sections on a voice memo (see `AudioPlayerSheet` below).
// What reaches the Verlauf: docs/verlauf-coverage.md.

import { useEffect, useMemo, useRef, useState } from 'react'
import { caretToEnd } from '../lib/ui'
import type { TimelineEvent } from '../types'
import { Icon } from '../lib/icons'
import { LoadingStatus, ShellLoader } from './ShellLoader'
import { Button } from './Button'
import { isPlayerRowId } from '../lib/ids'
import { Overlay } from '../lib/overlays'
import { appConfig } from '../config/appConfig'
import { fillTemplate, fmtDuration } from '../lib/format'
import { ApiError, apiGet, apiPatch, apiPost, timeoutSignal } from '../lib/api'
import { linkSessionHeaders } from '../lib/linkMode'
import { getDeploymentConfig } from '../lib/deploymentConfig'
import { acceptPhrase, suggestPhrases, type PhraseMatch } from '../lib/quickPhrases'
import { acceptName, suggestLinks } from '../lib/journalEntry'
import { linkParts, type JournalLink } from '../lib/journalLinks'
import {
  audioWindowOf,
  clockTicks,
  currentMarkerIndex,
  markersInWindow,
  wallClockAt,
} from '../lib/audioPlayer'

const SPEEDS = [0.5, 1, 1.5, 2]
const DEFAULT_SPEED_IDX = SPEEDS.indexOf(1) // the sheet always opens at 1×, wherever 1 sits in the list
const SKIP_SEC = 15

// Server-side peaks: 200 {peaks:[…]} ready,
// 200 {peaks:null} = extraction unavailable (flat bar), 202 = computing (poll). Any error
// degrades to the flat bar — the waveform is an aid, never a gate. `enabled` false (a link
// session, which the route refuses: it writes a file) goes straight to the flat bar.
type Peaks = { status: 'loading' | 'ready' | 'none'; values: number[] | null }

function usePeaks(audioUrl: string | undefined, enabled: boolean): Peaks {
  const [peaks, setPeaks] = useState<Peaks>({ status: 'loading', values: null })
  useEffect(() => {
    if (!enabled || !audioUrl || !audioUrl.startsWith('/api/media/')) { setPeaks({ status: 'none', values: null }); return }
    let alive = true, tries = 0
    const poll = async () => {
      try {
        // bounded like every other request: 60 tries is a bound on attempts, not on time
        const r = await fetch(`${audioUrl}/peaks`, {
          cache: 'no-store', signal: timeoutSignal(20_000), headers: linkSessionHeaders(),
        })
        if (!alive) return
        if (r.status === 202 && tries++ < 60) { setTimeout(poll, 2500); return }
        if (!r.ok) { setPeaks({ status: 'none', values: null }); return }
        const body = await r.json() as { peaks: number[] | null }
        if (!alive) return
        setPeaks(Array.isArray(body.peaks) && body.peaks.length
          ? { status: 'ready', values: body.peaks }
          : { status: 'none', values: null })
      } catch { if (alive) setPeaks({ status: 'none', values: null }) }
    }
    void poll()
    return () => { alive = false }
  }, [audioUrl, enabled])
  return peaks
}

// STT drafts (layer 3): segments the engine detected, reviewed in the player. Only
// confirming appends a journal row — drafts are working data on the server, not record.
interface SttSegment { start: number; end: number; text: string; status: 'open' | 'confirmed' | 'dismissed'; rowId?: string }
type Stt =
  | { phase: 'idle' }
  | { phase: 'running' }
  | { phase: 'failed'; error: string }
  | { phase: 'done'; segments: SttSegment[] }

function useStt(audioUrl: string | undefined, enabled: boolean) {
  const [stt, setStt] = useState<Stt>({ phase: 'idle' })
  const pollRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  const refresh = async (url: string) => {
    try {
      const r = await apiGet<{ status: string; error: string | null; segments: SttSegment[] | null }>(`${url}/transcription`)
      if (r.status === 'done') setStt({ phase: 'done', segments: r.segments ?? [] })
      else if (r.status === 'failed') setStt({ phase: 'failed', error: r.error ?? '' })
      else if (r.status === 'queued' || r.status === 'running') {
        setStt({ phase: 'running' })
        pollRef.current = setTimeout(() => void refresh(url), 3000)
      } else setStt({ phase: 'idle' })
    } catch {
      // a status poll dropping (connection blip) must not hide a running job — keep the
      // running state and retry; only an initial probe failure falls back to idle
      setStt((prev) => {
        if (prev.phase === 'running') {
          pollRef.current = setTimeout(() => void refresh(url), 5000)
          return prev
        }
        return { phase: 'idle' }
      })
    }
  }
  useEffect(() => {
    if (!enabled || !audioUrl?.startsWith('/api/media/')) return
    void refresh(audioUrl)
    return () => clearTimeout(pollRef.current)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [audioUrl, enabled])
  const start = async () => {
    if (!audioUrl) return
    setStt({ phase: 'running' })
    try {
      // an already-finished job answers the POST directly with its segments (dismissed
      // ones re-opened server-side) — no poll, and POSTs are immune to stale HTTP caches
      const r = await apiPost<{ status: string; segments?: SttSegment[] | null }>(`${audioUrl}/transcribe`, {})
      if (r?.status === 'done') setStt({ phase: 'done', segments: r.segments ?? [] })
      else pollRef.current = setTimeout(() => void refresh(audioUrl), 3000)
    } catch (e) {
      // surface the server's detail (503 unconfigured, 404, …); generic text otherwise
      setStt({ phase: 'failed', error: e instanceof ApiError ? e.message : '' })
    }
  }
  return { stt, setStt, start }
}

// The Durchhören sheet: the recording as a window on the incident timeline. Markers are
// derived — every Verlauf row whose time falls into the window — and «Eintrag an dieser
// Stelle» appends an ordinary journal row at the paused wall-clock instant.
// ⚠️ Except on a VOICE MEMO (audioMeta.source 'recorded'): its words belong to the memo, not
// to the incident timeline as free-standing rows — there the composer writes TRANSCRIPT
// SECTIONS (offset + text) onto the memo's own row, listed as subtitle lines in the Verlauf.
// A 8-second memo annotated with «ordinary» rows produced an unrelated-looking «Manuell» row
// while the memo kept nagging for its transcript (19.08.).
export function AudioPlayerSheet({ row, events, readOnly, canTranscribe = true, serverPeaks = true, onAddEntry, onAddSection, onEditSection, onPatchEntry, onRetractEntry, initialSeekSec, onClose, vocab = [] }: {
  row: TimelineEvent
  events: TimelineEvent[]
  readOnly: boolean
  /** may this session ask for a transcript and decide its segments? The routes are editor-only
   *  (api/media · CurrentEditor), so an `el` gets the player without the STT surface */
  canTranscribe?: boolean
  /** may this session ask the server for the waveform (`…/peaks`)? Every link is refused it */
  serverPeaks?: boolean
  /** everything this Einsatz has words for — same list the composer gets (lib/journalLinks ·
   *  journalVocabulary), so «Eintrag an dieser Stelle» completes and marks names identically */
  vocab?: JournalLink[]
  /** append a journal row at the given absolute time; returns the created row id */
  onAddEntry?: (text: string, atIso: string, quiet?: boolean) => string
  /** append one transcript section (offset into the recording, in s) onto THIS row */
  onAddSection?: (atSec: number, text: string) => void
  /** replace one section's words ('' removes it). The recording stays the original, so this
   *  is a plain fix — no «korrigiert» mark, no new Verlauf line. */
  onEditSection?: (sectionId: string, text: string) => void
  /** append a text correction patch for a row this player created (append-only edit) */
  onPatchEntry?: (rowId: string, text: string) => void
  /** retract a row this player created (append-only "delete" with undo) */
  onRetractEntry?: (rowId: string) => void
  /** open the player already seeked to this offset (jump-back from a Verlauf annotation) */
  initialSeekSec?: number
  onClose: () => void
}) {
  const C = appConfig.copy.journal // read per-render so the resolved locale applies
  const baseWin = useMemo(() => audioWindowOf(row), [row])
  // `row` is the click-time snapshot; sections appended while the sheet is open arrive on the
  // live timeline (`events`), so the display reads them from there
  const live = events.find((r) => r.id === row.id) ?? row
  const isMemo = row.audioMeta?.source === 'recorded' && !!onAddSection
  const sections = isMemo ? live.transcriptSections ?? [] : []
  const audioRef = useRef<HTMLAudioElement | null>(null)
  const [playing, setPlaying] = useState(false)
  const [cur, setCur] = useState(0)
  const [mediaDur, setMediaDur] = useState(0) // from the element; authoritative once known
  const [speedIdx, setSpeedIdx] = useState(DEFAULT_SPEED_IDX)
  const [errored, setErrored] = useState(false)
  const peaks = usePeaks(row.audioUrl, serverPeaks)

  // STT: fail-closed — the whole surface exists only with a configured engine + editor
  const sttAvailable = !!getDeploymentConfig().integrations?.sttConfigured && !readOnly && canTranscribe && !!onAddEntry
  const { stt, setStt, start: startStt } = useStt(row.audioUrl, sttAvailable)
  // local text corrections to drafts before confirming (keyed by segment index)
  const [drafts, setDrafts] = useState<Record<number, string>>({})
  // suggestions are working aids: übernommen or verworfen → gone from the list (the
  // confirmed entry lives on as a marker below, editable there and in the Verlauf)
  const openDrafts = stt.phase === 'done'
    ? stt.segments.map((s, i) => ({ ...s, index: i })).filter((s) => s.status === 'open')
    : []

  const patchSegment = async (index: number, status: 'confirmed' | 'dismissed', rowId?: string, text?: string) => {
    setStt((prev) => prev.phase === 'done'
      ? {
          phase: 'done',
          segments: prev.segments.map((s, i) =>
            (i === index ? { ...s, status, rowId: rowId ?? s.rowId, text: text ?? s.text } : s)),
        }
      : prev)
    try { await apiPatch(`${row.audioUrl}/transcription/segments/${index}`, { status, rowId, text }) }
    catch { /* the server copy lags a reload — the confirmed journal row is the record */ }
  }
  const confirmDraft = (index: number, seg: SttSegment) => {
    if (!win || (!onAddEntry && !isMemo)) return
    const body = (drafts[index] ?? seg.text).trim()
    if (!body) return
    // on a memo a confirmed segment IS a transcript section — same home as typed ones
    if (isMemo) { onAddSection!(seg.start, body); void patchSegment(index, 'confirmed', undefined, body); return }
    const rowId = onAddEntry!(body, new Date(win.startMs + seg.start * 1000).toISOString(), true)
    void patchSegment(index, 'confirmed', rowId, body)
  }
  const confirmAll = () => { for (const s of openDrafts) confirmDraft(s.index, s) }

  // in-place text correction for marker rows (mirrors the Verlauf pencil; append-only patch)
  const [editMarker, setEditMarker] = useState<{ id: string; value: string } | null>(null)
  // …and for transcript sections: TAPPING the words opens them for fixing — a transcript is
  // typed fast and read later, so the way back in must be the words themselves
  const [editSec, setEditSec] = useState<{ id: string; value: string } | null>(null)
  const saveSecEdit = () => {
    if (!editSec || !onEditSection) return
    onEditSection(editSec.id, editSec.value.trim())
    setEditSec(null)
  }
  const saveMarkerEdit = () => {
    if (!editMarker) return
    const v = editMarker.value.trim()
    if (v && onPatchEntry) onPatchEntry(editMarker.id, v)
    setEditMarker(null)
  }

  // one <audio> for the sheet's lifetime; ~4 Hz timeupdate drives readout + canvas redraws
  useEffect(() => {
    setErrored(false) // the flag belongs to THIS row's load — a new row starts clean
    if (!row.audioUrl) { setErrored(true); return }
    const a = new Audio(row.audioUrl)
    a.preload = 'metadata'
    if (initialSeekSec != null) setCur(initialSeekSec) // optimistic readout before metadata
    a.onloadedmetadata = () => {
      if (Number.isFinite(a.duration) && a.duration > 0) setMediaDur(a.duration)
      if (initialSeekSec != null) { a.currentTime = Math.min(initialSeekSec, a.duration || initialSeekSec); setCur(a.currentTime) }
    }
    a.ondurationchange = () => { if (Number.isFinite(a.duration) && a.duration > 0) setMediaDur(a.duration) }
    a.ontimeupdate = () => setCur(a.currentTime)
    a.onplay = () => setPlaying(true)
    a.onpause = () => setPlaying(false)
    a.onended = () => setPlaying(false)
    a.onerror = () => setErrored(true)
    audioRef.current = a
    return () => {
      // ⚠️ Detach the handlers BEFORE tearing down: `a.src = ''` makes the media element fire
      // `error`, and with `onerror` still attached, StrictMode's dev double-mount latched
      // `errored` on the healthy second run — the sheet then claimed «Wiedergabe benötigt
      // eine Verbindung» with the server right there.
      a.onloadedmetadata = null; a.ondurationchange = null; a.ontimeupdate = null
      a.onplay = null; a.onpause = null; a.onended = null; a.onerror = null
      a.pause(); a.src = ''; audioRef.current = null
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [row.id])

  const durationSec = mediaDur > 0 ? mediaDur : baseWin?.durationSec ?? 0
  const win = useMemo(
    () => (baseWin ? { startMs: baseWin.startMs, durationSec } : null),
    [baseWin, durationSec],
  )
  const markers = useMemo(
    () => (win ? markersInWindow(events, win, row.id) : []),
    [events, win, row.id],
  )
  const ticks = useMemo(() => (win ? clockTicks(win) : []), [win])
  const curIdx = currentMarkerIndex(markers, cur)

  const toggle = () => {
    const a = audioRef.current; if (!a || errored) return
    if (playing) { a.pause(); return }
    a.playbackRate = SPEEDS[speedIdx]
    void a.play().catch(() => setErrored(true))
  }
  const seek = (sec: number) => {
    const a = audioRef.current; if (!a || errored || durationSec <= 0) return
    const t = Math.min(Math.max(0, sec), durationSec - 0.1)
    a.currentTime = t; setCur(t)
  }
  const cycleSpeed = () => {
    const next = (speedIdx + 1) % SPEEDS.length
    setSpeedIdx(next)
    const a = audioRef.current; if (a) a.playbackRate = SPEEDS[next]
  }
  // jump to an utterance and play it (per-draft listen check)
  const playFrom = (sec: number) => {
    seek(sec)
    const a = audioRef.current
    if (a && !errored) { a.playbackRate = SPEEDS[speedIdx]; void a.play().catch(() => setErrored(true)) }
  }

  // desktop keyboard transport: Space play/pause, ←/→ ±15 s, ↑/↓ speed, Esc close.
  // Typing in the entry/draft inputs is never hijacked (Esc there just leaves the field).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = document.activeElement as HTMLElement | null
      if (el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable)) {
        if (e.key === 'Escape') el.blur()
        return
      }
      if (e.key === ' ') { e.preventDefault(); toggle() }
      else if (e.key === 'ArrowLeft') { e.preventDefault(); seek(cur - SKIP_SEC) }
      else if (e.key === 'ArrowRight') { e.preventDefault(); seek(cur + SKIP_SEC) }
      else if (e.key === 'ArrowUp' || e.key === 'ArrowDown') { e.preventDefault(); cycleSpeed() }
      else if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  })

  // ---- canvas: peaks (or flat track) + played tint + clock gridlines + markers + playhead
  const canvasRef = useRef<HTMLCanvasElement>(null)
  useEffect(() => {
    const c = canvasRef.current; if (!c) return
    const dpr = window.devicePixelRatio || 1
    const w = c.clientWidth, h = c.clientHeight
    if (w === 0) return
    c.width = w * dpr; c.height = h * dpr
    const x = c.getContext('2d'); if (!x) return
    x.scale(dpr, dpr)
    const css = getComputedStyle(document.documentElement)
    const tok = (n: string) => css.getPropertyValue(n).trim()
    // «played» and the playhead are the CURRENT position, so they wear the blue text tier the
    // current row wears (18-audio · .ap-row.current) — never the station's --accent, which is
    // alarm red by default and read as «wrong» (sweep 09.11.2026, UI.5)
    const INK = tok('--ink'), CURRENT = tok('--blue-strong')
    const toneColor = { entry: tok('--blue'), reminder: tok('--amber'), system: tok('--ink-faint') }
    const frac = durationSec > 0 ? cur / durationSec : 0
    const playedX = w * frac
    if (peaks.status === 'ready' && peaks.values) {
      const vals = peaks.values, n = vals.length
      const step = w / n
      for (let i = 0; i < n; i++) {
        const bx = i * step
        const bh = Math.max(2, vals[i] * (h - 30))
        x.fillStyle = bx <= playedX ? CURRENT : INK
        x.globalAlpha = bx <= playedX ? 0.85 : 0.28
        x.fillRect(bx, (h - 14 - bh) / 2 + 4, Math.max(1, step - 1), bh)
      }
      x.globalAlpha = 1
    } else {
      // flat track — same geometry, no amplitude
      const y = (h - 14) / 2
      x.fillStyle = INK; x.globalAlpha = 0.15
      x.fillRect(0, y, w, 6)
      x.fillStyle = CURRENT; x.globalAlpha = 0.8
      x.fillRect(0, y, playedX, 6)
      x.globalAlpha = 1
    }
    for (const t of ticks) {
      x.strokeStyle = INK; x.globalAlpha = 0.12
      x.beginPath(); x.moveTo(w * t.p, 4); x.lineTo(w * t.p, h - 12); x.stroke()
      x.globalAlpha = 1
    }
    for (const m of markers) {
      if (durationSec <= 0) break
      x.fillStyle = toneColor[m.tone]
      x.beginPath(); x.arc(w * (m.offsetSec / durationSec), h - 7, 3.4, 0, 7); x.fill()
    }
    // STT drafts as dashed ghost ticks — they become solid marker dots on confirm
    if (stt.phase === 'done' && durationSec > 0) {
      x.fillStyle = tok('--amber')
      for (const s of stt.segments) {
        if (s.status !== 'open') continue
        const px = w * Math.min(1, s.start / durationSec)
        for (let gy = h - 12; gy < h - 3; gy += 3) x.fillRect(px - 1, gy, 2, 2)
      }
    }
    x.strokeStyle = CURRENT; x.lineWidth = 2
    x.beginPath(); x.moveTo(playedX, 2); x.lineTo(playedX, h - 12); x.stroke()
    x.fillStyle = CURRENT; x.beginPath(); x.arc(playedX, 5, 4, 0, 7); x.fill()
  }, [cur, durationSec, peaks, markers, ticks, errored, stt])

  // tap/drag to seek
  const dragging = useRef(false)
  const seekFromPointer = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const rect = e.currentTarget.getBoundingClientRect()
    seek(((e.clientX - rect.left) / rect.width) * durationSec)
  }
  const onPointerDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (errored || durationSec <= 0) return
    dragging.current = true
    e.currentTarget.setPointerCapture(e.pointerId)
    seekFromPointer(e)
  }
  const onPointerMove = (e: React.PointerEvent<HTMLCanvasElement>) => { if (dragging.current) seekFromPointer(e) }
  const onPointerUp = () => { dragging.current = false }

  // ---- «Eintrag an dieser Stelle» — the SAME writing aids as the composer: Textbausteine,
  // name completion from this Einsatz's vocabulary, and the backdrop that marks what is already
  // in the text. An entry typed here lands in the same Verlauf as one typed in the composer, so
  // it has to spell names the same way; two fields writing into one journal with different
  // spelling help is how «Baumann» / «Bauman» ends up in the same record.
  const [text, setText] = useState('')
  const quickPhrases = getDeploymentConfig().journal?.quickPhrases?.length
    ? getDeploymentConfig().journal!.quickPhrases!
    : appConfig.journal.quickPhrases
  const suggestions = useMemo(() => suggestPhrases(text, quickPhrases), [text, quickPhrases])
  const nameHits = useMemo(() => suggestLinks(text, vocab), [text, vocab])
  const parts = useMemo(() => linkParts(text, vocab), [text, vocab])
  const inputRef = useRef<HTMLInputElement>(null)
  const marksRef = useRef<HTMLDivElement>(null)
  const refocus = () => requestAnimationFrame(() => {
    const el = inputRef.current
    if (!el) return
    el.focus()
    el.setSelectionRange(el.value.length, el.value.length)
  })
  const accept = (m: PhraseMatch) => { setText((t) => acceptPhrase(t, m.phrase, m.frag)); refocus() }
  const takeName = (name: string) => { setText((t) => acceptName(t, name)); refocus() }
  const sendEntry = () => {
    const body = text.trim()
    if (!body || !win) return
    audioRef.current?.pause()
    // a memo's words go onto the memo itself; only a long/imported recording gets
    // free-standing timeline rows
    if (isMemo) onAddSection!(cur, body)
    else if (onAddEntry) onAddEntry(body, new Date(win.startMs + cur * 1000).toISOString())
    else return
    setText('')
  }

  if (!win) return null
  const rangeLabel = durationSec > 0
    ? `${wallClockAt(win, 0)} – ${wallClockAt(win, durationSec)} · ${fmtDuration(durationSec)}`
    : wallClockAt(win, 0)

  return (
    // dismissEscape=false: this sheet owns Escape (Esc-in-a-field blurs it; Esc elsewhere closes;
    // plus Space/←/→/↑/↓ transport) via the keydown effect above — Base UI must not also close on Esc.
    <Overlay open onClose={onClose} className="ip-sheet ap-sheet ui-dialog" ariaLabel={row.text} dismissEscape={false} grab>
        <div className="ip-head ap-head">
          <span className="ap-title">
            <h2>{row.text}</h2>
            <span className="ap-range">{rangeLabel}</span>
          </span>
          {sttAvailable && !errored && (stt.phase === 'idle' || (stt.phase === 'done' && openDrafts.length === 0)) && (
            // after all suggestions are handled (or none were found), a fresh run stays possible
            <Button icon={<Icon id="sparkle" />} onClick={() => void startStt()}>{C.sttTranscribe}</Button>
          )}
          <button className="ip-x" onClick={onClose} aria-label={appConfig.copy.closeDialog}><Icon id="close" /></button>
        </div>
        <div className="ip-body ap-body">
          <div className="ap-wave-wrap">
            {peaks.status === 'loading' && <span className="ap-wave-loading" aria-hidden><ShellLoader /></span>}
            <canvas
              ref={canvasRef}
              className="ap-wave"
              role="slider"
              aria-label={C.playerSeek}
              aria-valuemin={0}
              aria-valuemax={Math.round(durationSec)}
              aria-valuenow={Math.round(cur)}
              onPointerDown={onPointerDown}
              onPointerMove={onPointerMove}
              onPointerUp={onPointerUp}
              onPointerCancel={onPointerUp}
            />
            <div className="ap-clock" aria-hidden>
              <span>{wallClockAt(win, 0)}</span>
              {ticks.map((t) => <span key={t.p} style={{ position: 'absolute', left: `${t.p * 100}%` }}>{t.label}</span>)}
              {durationSec > 0 && <span style={{ marginLeft: 'auto' }}>{wallClockAt(win, durationSec)}</span>}
            </div>
          </div>

          {errored ? (
            <p className="ap-offline"><Icon id="warn" />{C.playerOffline}</p>
          ) : (
            <div className="ap-transport">
              <button className="ap-btn" onClick={() => seek(cur - SKIP_SEC)} title={C.playerSkipBack} aria-label={C.playerSkipBack}>
                <span className="ap-skip"><Icon id="skip-back-15" /><small>{SKIP_SEC}</small></span>
              </button>
              <button className="ap-btn ap-btn-main" onClick={toggle} title={playing ? C.recordStop : appConfig.copy.play} aria-label={playing ? C.recordStop : appConfig.copy.play}>
                <Icon id={playing ? 'pause' : 'play'} />
              </button>
              <button className="ap-btn" onClick={() => seek(cur + SKIP_SEC)} title={C.playerSkipFwd} aria-label={C.playerSkipFwd}>
                <span className="ap-skip"><Icon id="skip-fwd-15" /><small>{SKIP_SEC}</small></span>
              </button>
              <Button onClick={cycleSpeed} title={C.playerSpeed} aria-label={C.playerSpeed}>
                {SPEEDS[speedIdx].toLocaleString(undefined, { minimumFractionDigits: 0 })}×
              </Button>
              <div className="ap-time">
                <strong>{wallClockAt(win, cur)}</strong>
                <span>{fmtDuration(cur)}{durationSec > 0 ? ` / ${fmtDuration(durationSec)}` : ''}</span>
              </div>
            </div>
          )}

          {!readOnly && (isMemo || onAddEntry) && !errored && (
            <div className="ap-add">
              {/* on a memo this writes the TRANSCRIPT (a section at the playhead), so it
                  says so and shows the offset; on a long recording it stays the timeline
                  entry with its wall-clock instant */}
              <span className="ap-add-label"><Icon id="type" />{isMemo ? C.transcriptAdd : C.playerEntryHere}<em>{isMemo ? fmtDuration(cur) : wallClockAt(win, cur)}</em></span>
              <div className="ap-add-row">
                {/* the marks backdrop, exactly as in the composer: the same text painted behind
                    a see-through field so only the <mark> spans show. Both layers must share
                    font, padding and border or the colours drift off their words. */}
                <div className="ap-add-field">
                  <div className="ap-add-marks" ref={marksRef} aria-hidden>
                    {parts.map((p, i) => (p.kind
                      ? <mark key={i} className={`jc-mark-${p.kind}`}>{p.text}</mark>
                      : <span key={i}>{p.text}</span>))}
                  </div>
                  <input
                    ref={inputRef}
                    value={text}
                    placeholder={isMemo ? C.transcriptPlaceholder : C.playerEntryPlaceholder}
                    onChange={(e) => setText(e.target.value)}
                    onScroll={(e) => { if (marksRef.current) marksRef.current.scrollLeft = e.currentTarget.scrollLeft }}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') sendEntry()
                      // Tab takes the top suggestion — a NAME first when one is offered, because
                      // that is the word you are mid-way through (same rule as the composer)
                      else if (e.key === 'Tab' && (nameHits.length > 0 || suggestions.length > 0)) {
                        e.preventDefault()
                        if (nameHits.length > 0) takeName(nameHits[0].name)
                        else accept(suggestions[0])
                      }
                    }}
                  />
                </div>
                <Button variant="primary" disabled={!text.trim()} icon={<Icon id="check" />} onClick={sendEntry}>{C.send}</Button>
              </div>
              {(nameHits.length > 0 || suggestions.length > 0) && (
                <div className="jc-phrases" role="group" aria-label={C.quickPhrasesAria}>
                  {nameHits.map((n) => (
                    <button
                      key={`n:${n.kind}:${n.id ?? n.name}`}
                      className={`jc-phrase jc-phrase-link jc-link-${n.kind}`}
                      onPointerDown={(e) => e.preventDefault()}
                      onClick={() => takeName(n.name)}
                    >{n.name}</button>
                  ))}
                  {suggestions.map((m) => (
                    <button key={m.phrase} className="jc-phrase" onPointerDown={(e) => e.preventDefault()} onClick={() => accept(m)}>{m.phrase}</button>
                  ))}
                </div>
              )}
            </div>
          )}

          {stt.phase === 'running' && (
            <p className="ap-stt-note"><LoadingStatus>{C.sttRunning}</LoadingStatus></p>
          )}
          {stt.phase === 'failed' && (
            <p className="ap-stt-note ap-stt-failed">
              <Icon id="warn" />{fillTemplate(C.sttFailed, { error: stt.error || C.sttErrorGeneric })}
              <Button onClick={() => void startStt()}>{C.sttRetry}</Button>
            </p>
          )}
          {stt.phase === 'done' && stt.segments.length === 0 && (
            <p className="ap-stt-note"><Icon id="info" />{C.sttEmpty}</p>
          )}
          {openDrafts.length > 0 && (
            <div className="ap-stt">
              <div className="ap-stt-bar">
                <Icon id="sparkle" />
                <span>{fillTemplate(C.sttBanner, { n: openDrafts.length })}</span>
                <Button variant="primary" onClick={confirmAll}>{C.sttTakeAll}</Button>
              </div>
              {openDrafts.map((s) => (
                <div key={s.index} className="ap-draft">
                  <span className="ap-draft-t">{wallClockAt(win, s.start)}</span>
                  <button
                    className="ap-draft-play"
                    title={appConfig.copy.play}
                    aria-label={appConfig.copy.play}
                    onClick={() => playFrom(s.start)}
                  ><Icon id="play" /></button>
                  <input
                    className="ap-draft-tx"
                    value={drafts[s.index] ?? s.text}
                    onChange={(e) => setDrafts((d) => ({ ...d, [s.index]: e.target.value }))}
                  />
                  <button className="ip-x ap-d-no" title={C.sttDismiss} aria-label={C.sttDismiss} onClick={() => void patchSegment(s.index, 'dismissed')}><Icon id="close" /></button>
                  <button className="ap-d-ok" title={C.sttTake} aria-label={C.sttTake} onClick={() => confirmDraft(s.index, s)}><Icon id="check" /></button>
                </div>
              ))}
            </div>
          )}

          {/* a memo's transcript, section by section. TAPPING the words opens them for fixing
              (the recording is the original — a fixed transcription needs no «korrigiert»
              mark and writes no Verlauf line); the small play circle seeks to where they
              fell, like an STT draft's. */}
          {sections.length > 0 && (
            <div className="ap-list">
              <p className="ap-list-head">{appConfig.copy.report.transcript} · {sections.length}</p>
              {sections.map((s) => (
                editSec?.id === s.id ? (
                  <div key={s.id} className="ap-row ap-row-editing">
                    <span className="ap-row-t">{fmtDuration(s.at)}</span>
                    <input
                      className="ap-row-input"
                      value={editSec.value}
                      autoFocus
                      onFocus={caretToEnd}
                      onChange={(e) => setEditSec({ id: s.id, value: e.target.value })}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') saveSecEdit()
                        else if (e.key === 'Escape') { e.stopPropagation(); setEditSec(null) }
                      }}
                    />
                    <button className="ip-x ap-d-no" title={appConfig.copy.cancel} aria-label={appConfig.copy.cancel} onClick={() => setEditSec(null)}><Icon id="close" /></button>
                    <button className="ap-d-ok" title={C.transcriptSave} aria-label={C.transcriptSave} onClick={saveSecEdit}><Icon id="check" /></button>
                  </div>
                ) : (
                  <div
                    key={s.id}
                    className="ap-row"
                    role="button"
                    tabIndex={0}
                    onClick={onEditSection && !readOnly ? () => setEditSec({ id: s.id, value: s.text }) : () => seek(s.at)}
                    onKeyDown={(e) => { if (e.key === 'Enter') (onEditSection && !readOnly ? setEditSec({ id: s.id, value: s.text }) : seek(s.at)) }}
                  >
                    <span className="ap-row-t">{fmtDuration(s.at)}</span>
                    <button
                      className="ap-draft-play"
                      title={appConfig.copy.play}
                      aria-label={appConfig.copy.play}
                      onClick={(e) => { e.stopPropagation(); playFrom(s.at) }}
                    ><Icon id="play" /></button>
                    <span className="ap-row-tx">{s.text}</span>
                    {onEditSection && !readOnly && <Icon id="pen" className="ap-row-go" />}
                  </div>
                )
              ))}
            </div>
          )}
          {/* on a memo the transcript IS the content — an empty «Einträge» list under it would
              only restate that nothing else happened during 8 seconds */}
          {!(isMemo && markers.length === 0) && <div className="ap-list">
            <p className="ap-list-head">{C.playerEntries}{markers.length > 0 ? ` · ${markers.length}` : ''}</p>
            {markers.length === 0 && <p className="ap-empty">{C.playerNoEntries}</p>}
            {markers.map((m, i) => (
              editMarker?.id === m.row.id ? (
                <div key={m.row.id} className="ap-row ap-row-editing">
                  <span className="ap-row-t">{wallClockAt(win, m.offsetSec)}</span>
                  <input
                    className="ap-row-input"
                    value={editMarker.value}
                    autoFocus
                    onFocus={caretToEnd}
                    onChange={(e) => setEditMarker({ id: m.row.id, value: e.target.value })}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') saveMarkerEdit()
                      else if (e.key === 'Escape') { e.stopPropagation(); setEditMarker(null) }
                    }}
                  />
                  <button className="ip-x ap-d-no" title={appConfig.copy.cancel} aria-label={appConfig.copy.cancel} onClick={() => setEditMarker(null)}><Icon id="close" /></button>
                  <button className="ap-d-ok" title={C.transcriptSave} aria-label={C.transcriptSave} onClick={saveMarkerEdit}><Icon id="check" /></button>
                </div>
              ) : (
                <div
                  key={m.row.id}
                  className={`ap-row ${i === curIdx ? 'current' : ''}`}
                  role="button"
                  tabIndex={0}
                  onClick={() => seek(m.offsetSec)}
                  onKeyDown={(e) => { if (e.key === 'Enter') seek(m.offsetSec) }}
                >
                  <span className="ap-row-t">{wallClockAt(win, m.offsetSec)}</span>
                  <span className={`ap-dot ap-dot-${m.tone}`} />
                  <span className="ap-row-tx">{m.row.text}</span>
                  {onPatchEntry && (
                    <button
                      className="ap-row-edit"
                      title={C.editEntry}
                      aria-label={C.editEntry}
                      onClick={(e) => { e.stopPropagation(); setEditMarker({ id: m.row.id, value: m.row.text }) }}
                    ><Icon id="pen" /></button>
                  )}
                  {onRetractEntry && isPlayerRowId(m.row.id) && (
                    // only rows this player created — incident log lines are never deletable
                    // THE delete look — a bin in the --del-* outline (29.09.2026): it was a ✕, and a
                    // ✕ only ever closes or clears. The row itself seeks the audio, so the trailing
                    // chevron that promised «opens something» is gone too.
                    <button
                      className="ap-row-edit ap-row-del"
                      title={C.removeEntry}
                      aria-label={C.removeEntry}
                      onClick={(e) => { e.stopPropagation(); onRetractEntry(m.row.id) }}
                    ><Icon id="trash" /></button>
                  )}
                </div>
              )
            ))}
          </div>}
        </div>
    </Overlay>
  )
}
