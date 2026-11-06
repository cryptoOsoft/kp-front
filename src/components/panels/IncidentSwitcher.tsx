import { useEffect, useRef, useState } from 'react'
import { Icon } from '../../lib/icons'
import { fillTemplate, fmtSpanShort, fmtWhen, streetPart, formatTime } from '../../lib/format'
import { appConfig } from '../../config/appConfig'
import { toast } from '../../lib/ui'
import { SyncGlyph } from '../SyncGlyph'
import { useOnline } from '../../lib/useOnline'
import { closeTimeOf, type IncidentMeta, type SyncStatus } from '../../lib/incidents'
import type { ReactivateResult } from '../../types'
import { useIsPhone } from '../../lib/useIsPhone'
import { CLOCK_ICON, useEinsatzuhr } from '../../lib/einsatzuhr'
import { EinsatzuhrChoices } from '../Einsatzuhr'
import { AppMenuRows } from './AppMenuRows'
import { tut } from '../../lib/tutorials/anchors'

// HH:MM for the positive "gespeichert" trust signal next to the sync badge.
function fmtClock(ms: number): string {
  try {
    return formatTime(new Date(ms))
  } catch {
    return ''
  }
}

// (the SyncGlyph — the shared activity and completion vocabulary — now lives
// in ../SyncGlyph, shared with the Offline-Bereitschaft load and the Anwesenheit reload)

// --- TopBar switcher ----------------------------------------------------------------
export function IncidentSwitcher({
  active, incidents, isEditor, syncStatus, lastSyncedAt, user, startedAt, endedAt, onSettings, onSwitch, onHistory, onObjectVisits, onKarte, onDivera, onEditMeta, onArchive, onShare, archiveOpenCount = 0, onUeben, onHelp, onInstall, onOfflineReadiness, onSyncNow, onLogout, navKey, sheetOpen = false, syncDetail,
  onBackFromArchive, onReactivate, canCorrectRapport = false,
}: {
  active: IncidentMeta | null
  incidents: IncidentMeta[]
  isEditor: boolean
  syncStatus: SyncStatus
  syncDetail?: string
  lastSyncedAt: number | null
  user: { display_name: string; color: string | null; role: string }
  /** the Einsatzuhr's start and (for a closed Einsatz) end — the SAME two the top bar's clock gets.
   *  On a phone the clock is the pill's second line (see `twoLine` below). */
  startedAt?: string | null
  endedAt?: string | null
  /** open the Einstellungen sheet (device prefs + synced incident settings) */
  /** Omitted hides the Einstellungen row — an Einsatz-Link has no device or incident
      settings to change, and every write behind them is refused anyway. */
  onSettings?: () => void
  onSwitch: (i: IncidentMeta) => void
  /** «Alle Einsätze» — absent for an Einsatz-Link session, which may only ever see its own */
  onHistory?: () => void
  /** Objektbesuche — set only where the station switched the module on and this is no link session */
  onObjectVisits?: () => void
  /** «Einsatz verlassen» — to «Karte & Objekte», this Einsatz running on behind it (App ·
   *  enterKarte). Absent for an Einsatz-Link session. */
  onKarte?: () => void
  onDivera: () => void
  onDatenquellen: () => void
  /** Einsatzrapport (PDF / Drucken) — absent for an Einsatz-Link session, which may not
   *  generate documents or reach the station printer */
  /** correct the dispatch facts (address, category, Stichwort) — omitted for a viewer */
  onEditMeta?: () => void
  /** «Einsatz abschliessen» for the ACTIVE incident — the SAME confirm the Rapport runs
   *  (IncidentWorkspace · confirmAndComplete); absent for viewers / read-only views / an
   *  already-closed incident */
  onArchive?: () => void
  /** «Teilen» — opens the share sheet (`ShareIncidentSheet`) for the ACTIVE incident, on the
   *  read-only tab; the sheet's tabs are what picks between the two links (03.09.). Since 06.09.
   *  this row is THE door on every width — the bar's own Teilen button is gone. Omitted for
   *  viewers, read-only views and a link session, which may not mint one. */
  onShare?: () => void
  /** how many Mindestangaben are still open, shown as a badge on that row. The check used to
   *  happen only after the press, and only on the other door — see confirmAndComplete. */
  archiveOpenCount?: number
  /** «Üben» – App's tutorials sheet over this Einsatz; absent for a link session. The menu closes
   *  first: the sheet is App's, so this menu's `sheetOpen` suspension never hears of it. */
  onUeben?: () => void
  onHelp: () => void
  /** open the "Als App installieren" guide — App passes it only in a plain browser tab */
  onInstall?: () => void
  onOfflineReadiness: () => void
  /** push edits queued while offline (also auto-fires on reconnect) */
  /** awaited so the button can spin for the round trip and report the outcome */
  onSyncNow: () => void | Promise<void>
  /** End the login on this device. ⚠️ Absent for an Einsatz-Link session (02.09.): a link owns
   *  no login here to end — leaving it is closing the page — and the row used to sign the
   *  device's own account out with it. */
  onLogout?: () => void
  /** changes whenever the app navigates to another surface — closes a menu that was left
   *  open under a sheet (e.g. Rapport → Anwesenheit must not land back in the menu) */
  navKey?: string
  /** A child sheet launched from this menu is visible. The menu stays logically open but is
   *  suspended — unrendered, so its higher z-index cannot overlap the child — on every form
   *  factor. Cancelling the sheet therefore reveals the exact parent state; the rows that
   *  NAVIGATE close the menu deliberately instead (see `navKey`). */
  sheetOpen?: boolean
  /** the ACTIVE Einsatz is closed and open read-only: leave the view — back to the Einsatz that
   *  was open before / «Alle Einsätze». Omitted in a link session. */
  onBackFromArchive?: () => void
  /** editors only: re-open the closed Einsatz (its own confirm lives upstream) */
  onReactivate?: () => Promise<ReactivateResult>
  /** this session may still correct the closed Einsatz's Rapport (`canEditRapport`: the el, a
   *  Führungsansicht) – the closed pill's sentence then says that much and no more */
  canCorrectRapport?: boolean
}) {
  const cp = appConfig.copy.incidentSwitcher
  // «Jetzt synchronisieren» reports what it did on the button itself: Shell trail runs for the
  // round trip, then gives way to a tick. Success needs no words — a toast for «alles
  // synchronisiert» was a sentence to read for the most boring outcome there is. Offline and
  // failure still get one, because those change what the operator should do next.
  const [syncPhase, setSyncPhase] = useState<'idle' | 'busy' | 'done'>('idle')
  // offline the button is not drawn at all (see `syncButton`)
  const online = useOnline()
  const doneTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  useEffect(() => () => { if (doneTimer.current) clearTimeout(doneTimer.current) }, [])
  const runSyncNow = async () => {
    if (syncPhase === 'busy') return
    if (doneTimer.current) clearTimeout(doneTimer.current)
    setSyncPhase('busy')
    // a round trip on a fast connection can finish in ~50 ms; without a floor the ring would
    // flick past too quickly to read as anything, and the tick would look like a glitch
    const floor = new Promise((r) => setTimeout(r, 420))
    try {
      await Promise.all([onSyncNow(), floor])
      if (!navigator.onLine) { setSyncPhase('idle'); toast(cp.syncOfflineToast, { icon: 'warn', tone: 'warn' }); return }
      setSyncPhase('done')
      // 2.5s, not the ~1.5s that feels right when you already know it is coming: the tick is
      // the only confirmation there is now, and someone who taps and then looks up must still
      // find it there. It costs nothing to leave it — the button stays usable throughout.
      doneTimer.current = setTimeout(() => setSyncPhase('idle'), 2500)
    } catch {
      setSyncPhase('idle')
      toast(cp.syncFailedToast, { icon: 'warn', tone: 'warn' })
    }
  }
  const badgeTitle: Record<Exclude<SyncStatus, 'synced'>, string> = {
    pending: cp.badgePending, offline: cp.badgeOffline, error: cp.badgeError, storage: cp.badgeStorage,
  }
  const [open, setOpen] = useState(false)
  // ⚠️ PHONE: «where over the clock» (07.10.2026, UI sweep · owner pick B3 D). The pill carried a
  // doc glyph and nothing else — the Stichwort was hidden as a useless «C…» — while the bar spent
  // a second control on the Einsatzuhr beside it. Now the pill IS both: the ADDRESS's street part
  // (owner: «the address is more important than the type»; the Stichwort where there is none),
  // 13.5/700 with an ellipsis, over the Einsatzuhr (mono 12.5, its mode's glyph); the bar's own
  // clock button goes (TopBar). The clock's modes are an INLINE choice under the Einsatz card's
  // Beginn pill below (never a popover over this menu) — the same per-device choice as the
  // tablet's bar menu (lib/einsatzuhr). Tablet unchanged.
  const isPhone = useIsPhone()
  const uhr = useEinsatzuhr(startedAt, endedAt, undefined, !isPhone)
  const twoLine = isPhone && !!active
  const street = streetPart(active?.address)
  const pillName = street || active?.title || ''
  // the inline clock choice starts folded every time the menu is opened (the switch button below)
  const [clockOpen, setClockOpen] = useState(false)
  // the card's Einsatzbeginn/-dauer pill (phones hide the TopBar clocks, so the times live here)
  // — tick while open so the Dauer stays current
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    if (!open) return
    setNow(Date.now())
    const t = setInterval(() => setNow(Date.now()), 30_000)
    return () => clearInterval(t)
  }, [open])
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    // clicks inside an overlay sheet/dialog don't count as "outside": a sheet opened FROM this
    // menu suspends it via `sheetOpen` rather than closing it, so cancelling that sheet has to
    // reveal the menu exactly as it was — a press inside it must not have closed it meanwhile.
    // 'pointerdown', not 'mousedown': on touch the compat mousedown fires late or not at all,
    // so tapping outside would not reliably dismiss (same pattern as Combo/PersonField).
    const onDoc = (e: PointerEvent) => {
      const t = e.target as Element
      if (ref.current && !ref.current.contains(t) && !t.closest?.('.ip-sheet, .ui-backdrop, .help-scrim, .confirm-backdrop, .confirm-card, .toaster')) setOpen(false)
    }
    document.addEventListener('pointerdown', onDoc)
    return () => document.removeEventListener('pointerdown', onDoc)
  }, [])
  // A sheet action that NAVIGATES (Rapport → Anwesenheit/Mittel/Verlauf) must not
  // leave the menu sitting on the new surface — any surface change closes it
  useEffect(() => { setOpen(false) }, [navKey])
  // Escape closes the menu (S8, 20.10.2026, owner: «all dropdowns, popovers … closable by
  // Escape») — and ONLY the menu. It stays non-modal (docs/ui-conventions · Overlays), so the key
  // is taken in the CAPTURE phase and stopped here: the workspace's own Escape (IncidentWorkspace
  // · «the universal bail-out») listens on window and would otherwise also peel the map's next
  // layer — disarm a tool, drop a selection — with the same press. While a sheet opened from
  // this menu is up the menu is suspended and the key is the sheet's. Focus goes back to the pill.
  const triggerRef = useRef<HTMLButtonElement>(null)
  useEffect(() => {
    if (!open || sheetOpen) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return
      // a confirm asked FROM this menu («Wieder öffnen») takes its own Escape
      if (document.querySelector('.confirm-card')) return
      e.preventDefault()
      e.stopPropagation()
      setOpen(false)
      triggerRef.current?.focus()
    }
    document.addEventListener('keydown', onKey, true)
    return () => document.removeEventListener('keydown', onKey, true)
  }, [open, sheetOpen])

  // Sync state surfaced two ways: a FIXED-WIDTH coloured mark in the header (so the constant
  // saving↔saved flip never shifts the title/chevron — no inline time/label), and the full
  // text + save time in the dropdown the user taps open (hover tooltips don't fire on a tablet).
  const savedText = syncStatus === 'synced'
    ? (lastSyncedAt != null ? fillTemplate(cp.savedAt, { t: fmtClock(lastSyncedAt) }) : cp.saved)
    : syncDetail ?? badgeTitle[syncStatus]
  // The CARD's pill says «Gespeichert» without the time (27.09.2026, slim sweep · decision D1):
  // one wording for one fact, the same the Trupps head shows; the time stays in the title (it
  // was «Gespeichert um 23:16»). The other states keep their words — they are warnings.
  const savedPill = syncStatus === 'synced' ? cp.saved : savedText
  // «Speicher voll» wears its own glyph (lib/icons · #storage, S1): on a phone the chip is its
  // glyph alone, and the ⚠ it shared with «Sync-Fehler» made the worse state read as the milder
  const statusMark = syncStatus === 'synced'
    ? <Icon id="check" />
    : syncStatus === 'storage'
      ? <Icon id="storage" />
      : syncStatus === 'error'
        ? <Icon id="warn" />
        : <span className="ip-status-dot" />
  const exerciseBadge = <span className="ip-badge ip-badge-exercise">{appConfig.copy.exerciseBadge}</span>
  // ── a CLOSED Einsatz (27.10.2026, sweep #5 · owner pick B) ──
  // The lock rides in the pill's ✓ slot — the amber «Einsatz abgeschlossen» chip beside the pill
  // left the bar — and the card's «Gespeichert» becomes «🔒 Abgeschlossen 01:18 ⌄», at the CURRENT
  // close (`closeTimeOf`, not the declared Einsatzende). A tap folds out what the state means and
  // its exits, «Wieder öffnen» / «Zurück»; nothing of it shows until then (owner). A sync WARNING
  // keeps its own pill beside it: work not on the server outranks the state.
  // ⚠️ The sentence is the session's OWN (RBAC audit 22.10.2026): «… für alles andere wieder
  // öffnen» only beside a «Wieder öffnen»; the el / a Führungsansicht, which correct the Rapport
  // but reopen nothing, hear the first half; everyone else «Nur ansehen».
  const C = appConfig.copy.archived
  const closed = !!active?.is_archived
  const closedAt = active ? closeTimeOf(active) : null
  const closedWord = closedAt ? fillTemplate(C.closedAt, { t: fmtWhen(closedAt, { todayShort: true }) }) : C.title
  const [closedOpen, setClosedOpen] = useState(false)
  // «Wieder öffnen» runs while the card stays up and says so (#6) — the confirm is upstream
  const [reopening, setReopening] = useState(false)
  // ⚠️ a successful reopen flips this very card live (the fold goes with `closed`), and the
  // promise settles a tick later — no state write after an unmount
  const alive = useRef(true)
  useEffect(() => { alive.current = true; return () => { alive.current = false } }, [])
  const reopen = () => {
    if (!onReactivate || reopening) return
    setReopening(true)
    void onReactivate()
      .then((r) => { if (r === 'ok' && alive.current) { setClosedOpen(false); setOpen(false) } })
      // a failure is said by the caller's own toast; a cancelled confirm leaves the fold as it was.
      // Caught: an offline list refresh upstream may reject after the reopen went through.
      .catch(() => {})
      .finally(() => { if (alive.current) setReopening(false) })
  }
  const closedMark = closed && syncStatus === 'synced'
  /**
   * «Jetzt synchronisieren» — offered whenever the device has a link, not only on error: it forces a push AND an
   * immediate pull, the "make everything fresh right now" action when things feel stale. It has
   * to LOOK like it ran, because on an already-synced Einsatz — the normal case — the status
   * says the same thing before and after the tap; so Shell trail runs for the round trip and then
   * gives way to a tick on the button itself.
   *
   * It sits in the CARD's title row, at the Einsatzname's right edge: the action belongs to that
   * one Einsatz, so it belongs to the line that names it — not to the app's own header bar
   * (which on a phone has no room to spare anyway, see 15-mobile.css), and not down among
   * «Bearbeiten»/«Abschliessen», which are things you do to the Einsatz rather than to the
   * connection. Same place on every screen width.
   * ⚠️ NOT while offline (owner, 05.10.2026: «pointless when offline»): the tap could only end in
   * «Immer noch offline», and the queue pushes by itself the moment the link is back. The
   * «● Offline» chip says why it is gone.
   */
  const syncButton = online && (
    <button className={`ip-card-sync sync-${syncPhase}`} disabled={syncPhase === 'busy'}
      aria-busy={syncPhase === 'busy'} onClick={() => { void runSyncNow() }}
      aria-label={cp.syncNow} title={cp.syncNow}>
      {syncPhase === 'idle'
        ? <Icon id="rotate" />
        : <SyncGlyph done={syncPhase === 'done'} label={syncPhase === 'done' ? cp.syncDone : cp.syncNow} />}
    </button>
  )
  return (
    <div className="ip-switch" ref={ref}>
      <button ref={triggerRef} {...tut('menu.einsatz')} className={`ip-switch-btn${twoLine ? ' ip-switch-two' : ''}`} onClick={() => { setClockOpen(false); setClosedOpen(false); setOpen((v) => !v) }}
        aria-label={twoLine
          ? [street, active.title, active.is_exercise ? appConfig.copy.exerciseBadge : '', closed ? C.title : '', uhr.text ? `${uhr.label[uhr.mode]} ${uhr.text}` : ''].filter(Boolean).join(', ')
          : active ? [active.title, closed ? C.title : ''].filter(Boolean).join(', ') : cp.noIncident}
        aria-expanded={open && !sheetOpen}>
        {twoLine ? (
          <span className="ip-switch-lines">
            <span className="ip-switch-title">{pillName}</span>
            {uhr.text && (
              <span className="ip-switch-clock"><Icon id={CLOCK_ICON[uhr.mode]} /><b>{uhr.text}</b></span>
            )}
          </span>
        ) : (
          <>
            {/* a narrow TABLET bar's last step (fit-9): the title gives way to a doc glyph; the full
                title heads the dropdown instead */}
            <span className="ip-switch-glyph" aria-hidden><Icon id="doc" /></span>
            <span className="ip-switch-title">{active ? active.title : cp.noIncident}</span>
          </>
        )}
        {/* persistent ÜBUNG marker in the chrome — a training must never read as a real
            Einsatz mid-use (it also survives the phone's CSS-hidden title).
            PHONE (08.10.2026, owner): ONE letter, «Ü», in a square amber tag. The word ellipsised
            into «ÜBU…» and took the street with it («Sägestrass…») — the street is what the pill
            is for, and the amber square says «Übung» as well as the word does. The word stays
            the title and is part of the button's accessible name above. */}
        {active?.is_exercise && (twoLine
          ? <span className="ip-badge ip-badge-exercise ip-badge-initial" title={appConfig.copy.exerciseBadge}>{appConfig.copy.exerciseInitial}</span>
          : <span className="ip-badge ip-badge-exercise">{appConfig.copy.exerciseBadge}</span>)}
        {/* Offline and sync-error get a LOUD text chip (not just the tiny mark) — offline
            blocks switching incidents to the server, and a failing sync means edits are
            stranded on this device; the operator needs to recognise both at a glance
            WITHOUT opening the dropdown. (Since 07.09. an offline spell past 60 s also
            raises a standing Meldung — components/OfflineMeldung; this chip stays the
            immediate, always-on indicator.) */}
        {/* Storage-full is the loudest of the three: offline and sync-error both still mean the
            work is safely cached on this device, this one means it is not saved ANYWHERE. */}
        {active && syncStatus === 'storage' ? (
          <span className="ip-offline-chip ip-error-chip" title={savedText} aria-label={savedText}>
            <Icon id="storage" /><span className="ip-chip-word">{cp.storageShort}</span>
          </span>
        ) : active && syncStatus === 'offline' ? (
          <span className="ip-offline-chip" title={savedText} aria-label={savedText}>
            <span className="ip-status-dot" />{cp.offlineShort}
          </span>
        ) : active && syncStatus === 'error' ? (
          <span className="ip-offline-chip ip-error-chip" title={savedText} aria-label={savedText}>
            <Icon id="warn" /><span className="ip-chip-word">{cp.errorShort}</span>
          </span>
        ) : active && (
          <span className={`ip-status ip-status-${closedMark ? 'closed' : syncStatus}`}
            title={closedMark ? `${closedWord} · ${savedText}` : savedText} aria-label={closedMark ? closedWord : savedText}>
            {closedMark ? <Icon id="lock" /> : statusMark}
          </span>
        )}
        {/* ▾ while the dropdown is shut, ▴ while it stands open (02-base.css · .chev) */}
        <Icon id="chevron-down" className="chev" />
      </button>
      {open && !sheetOpen && (
        <div className="ip-menu">
          {/* The menu is about what is RUNNING, in two weights (field feedback: every row carried
              the same one): ① THIS Einsatz as a CARD — Titel, Adresse, zwei
              Status-Pills — carrying its OWN actions inside it; ② the other running Einsätze as
              rows led by their laufende Zeit. The card needs no label — it names itself.
              Nothing that is OVER is listed here (a «Frühere» section was tried and dropped on
              2026-08-26): you either switch to something that is still running, or you go looking
              for one particular old Einsatz — and that is a search, which «Alle Einsätze» is.
              The round-4 rule was "no destructive actions in this menu" (a stray per-row ✕ closed
              old incidents in one tap); «abschliessen» is the sanctioned exception (field request
              2026-07-12), and only ever for the Einsatz whose card it sits in: it runs the SAME
              confirm as the Rapport — open points named, `report_done_at` stamped — and closing
              stays reversible via «Wieder öffnen». Closing OTHER incidents lives only in «Alle
              Einsätze».
              No «Einsatzrapport» action either: it is a surface in the rail now, and a second
              door to it from here made the menu the place you go to find things that are already
              one tap away. And no «Objekt» row — which Einsatzobjekt is loaded decides which
              PLANS are loaded, so it belongs on the Plan surface above them (Whiteboard). */}
          {active && (
            <div className="ip-card">
              <div className="ip-card-title">
                {/* the name gives way first — it clamps to two lines and then ellipsises, so
                    neither the ÜBUNG marker nor the Sync button is ever what gets cut off */}
                <span className="ip-card-name" title={active.title}>{active.title}</span>
                {active.is_exercise && exerciseBadge}
                {syncButton}
              </div>
              {active.address && <span className="ip-card-sub">{active.address}</span>}
              <div className="ip-card-pills">
                {/* «Gespeichert» is about THIS device's work – a viewer never saves, so its card
                    says nothing while all is well (RBAC audit 22.10.2026); the warnings stay */}
                {closed && (
                  <button type="button" className="ip-card-pill ip-card-pill-btn ip-card-closed" title={C.title}
                    aria-expanded={closedOpen} onClick={() => setClosedOpen((v) => !v)}>
                    <Icon id="lock" /><span>{closedWord}</span><Icon id="chevron-down" className="chev" />
                  </button>
                )}
                {(closed ? syncStatus !== 'synced' : user.role !== 'viewer' || syncStatus !== 'synced') && (
                  <span className={`ip-card-pill ip-status-${syncStatus}`} title={savedText}>{statusMark}<span>{savedPill}</span></span>
                )}
                {/* «🕓 21:22 · 1 h 54» — the clock glyph is the label; «Einsatzbeginn» is the title */}
                {active.started_at && (() => {
                  // a closed Einsatz stops its clock at the end, as the bar's Einsatzuhr does
                  const until = endedAt ? Date.parse(endedAt) : now
                  const title = fillTemplate(cp.startedFull, { t: fmtClock(Date.parse(active.started_at)), d: fmtSpanShort(until - Date.parse(active.started_at)) })
                  const body = <><Icon id="clock" /><span>{fillTemplate(cp.startedRow, { t: fmtClock(Date.parse(active.started_at)), d: fmtSpanShort(until - Date.parse(active.started_at)) })}</span></>
                  // PHONE: the pill is the door to the Einsatzuhr's modes, which have no button of
                  // their own in the phone bar any more (see `twoLine`): it folds the inline choice
                  // out under the pills (below), ▾/▴ like every other fold
                  return twoLine && startedAt ? (
                    <button type="button" className="ip-card-pill ip-card-pill-btn" title={title} aria-label={title}
                      aria-expanded={clockOpen} onClick={() => setClockOpen((v) => !v)}>
                      {body}<Icon id="chevron-down" className="chev" />
                    </button>
                  ) : (
                    <span className="ip-card-pill" title={title}>{body}</span>
                  )
                })()}
              </div>
              {twoLine && clockOpen && (
                <EinsatzuhrChoices uhr={uhr} ariaLabel={appConfig.copy.einsatzuhr.modeElapsed} onPicked={() => setClockOpen(false)} />
              )}
              {/* the closed pill's fold: the sentence, then the exits on one line — «Wieder öffnen»
                  first and wider, amber like «Abschliessen», the tile family of the card's own acts */}
              {closed && closedOpen && (
                <div className="ip-card-closed-fold">
                  <p className="ip-card-closed-say">
                    {onReactivate ? C.hint : canCorrectRapport ? C.hintRapport : C.hintViewOnly}
                    {/* offline: «Wieder öffnen» stays (useOnline is a hint, never a gate) but says it needs the server */}
                    {onReactivate && !online && <small>{C.reactivateOffline}</small>}
                  </p>
                  {(onReactivate || onBackFromArchive) && (
                    <div className="ip-card-acts">
                      {onReactivate && (
                        <button type="button" className="ip-card-act head-tile sm amber ip-card-reopen"
                          disabled={reopening} aria-busy={reopening} onClick={reopen}>
                          {reopening && <span aria-hidden><SyncGlyph done={false} label={C.reopening} /></span>}
                          <span>{reopening ? C.reopening : C.reactivate}</span>
                        </button>
                      )}
                      {onBackFromArchive && (
                        <button type="button" className="ip-card-act head-tile sm" disabled={reopening}
                          onClick={() => { setOpen(false); onBackFromArchive() }}>
                          <span>{C.back}</span>
                        </button>
                      )}
                    </div>
                  )}
                </div>
              )}
              {/* The Einsatz's own actions, inside its own card. Short labels: the card names the
                  Einsatz one line above, so «Einsatz abschliessen» would say it twice — the full
                  wording rides along as the button's title/aria-label.
                  ⚠️ ONE LINE, always (decision 01.09.): three verbs that wrap to a second row
                  stop reading as one set of choices. The label is its own <span> (the badge is
                  the tile's other child) — see .ip-card-acts, which carries the measured widths.
                  Order is Bearbeiten · Teilen · Abschliessen. Abschliessen goes LAST because it
                  is the one that ends the Einsatz; a terminal action sitting between two
                  everyday ones is a mis-tap waiting for a gloved thumb.
                  Three tiles of the head's family since 27.09.2026 (slim sweep · mockup 10) —
                  Abschliessen amber, its count on the tile's corner. Content-sized and NEVER
                  truncated since the same evening (owner screenshot r2-6: «Abschliess…» — the
                  equal thirds ellipsised the verb on a 390px phone; .ip-card-acts).
                  A wrong ADDRESS is noticed while looking at the map, long before anybody opens
                  the Rapport — whose «Bearbeiten» link was once the only way into the mask. */}
              {(onEditMeta || onArchive || onShare) && (
                <div className="ip-card-acts">
                  {onEditMeta && (
                    <button className="ip-card-act head-tile sm" title={cp.editMeta} aria-label={cp.editMeta}
                      onClick={onEditMeta}>
                      <Icon id="pen" /><span>{cp.editMetaShort}</span>
                    </button>
                  )}
                  {onShare && (
                    <button className="ip-card-act head-tile sm" title={cp.share} aria-label={cp.share}
                      onClick={onShare}>
                      <Icon id="external" /><span>{cp.shareShort}</span>
                    </button>
                  )}
                  {onArchive && (
                    <button className="ip-card-act head-tile sm amber" title={cp.archive} aria-label={cp.archive}
                      onClick={onArchive}>
                      <Icon id="archive" /><span>{cp.archiveShort}</span>
                      {/* The counter BEFORE the press, not only in the dialog after it. Bare
                          number: «3 offen» cost 50px of a row that has to stay on one line, and
                          the word is the half a glance does not need — the full «{n} offen»
                          rides along as the badge's own title/aria-label. */}
                      {archiveOpenCount > 0 && (
                        <span className="ip-badge ip-badge-todo"
                          title={fillTemplate(cp.archiveOpen, { n: archiveOpenCount })}
                          aria-label={fillTemplate(cp.archiveOpen, { n: archiveOpenCount })}>
                          {archiveOpenCount}
                        </span>
                      )}
                    </button>
                  )}
                </div>
              )}
            </div>
          )}
          {/* Everything under the card is the app menu's rows — the SAME component home's
              «Einsätze ▾» sheet renders (AppMenuRows; owner, 17.10.2026), so the two never drift.
              The rows that NAVIGATE close the menu here; the ones that open a sheet leave it
              logically open and suspended (`sheetOpen`), so cancelling that sheet reveals it. */}
          <AppMenuRows
            activeId={active?.id ?? null}
            incidents={incidents}
            isEditor={isEditor}
            user={user}
            onSwitch={(i) => { onSwitch(i); setOpen(false) }}
            onLeave={onKarte && (() => { setOpen(false); onKarte() })}
            onHistory={onHistory}
            onCreate={onDivera}
            onObjectVisits={onObjectVisits && (() => { setOpen(false); onObjectVisits() })}
            onSettings={onSettings}
            offline={active ? { label: appConfig.copy.offline.title, onOpen: onOfflineReadiness } : undefined}
            onUeben={onUeben && (() => { setOpen(false); onUeben() })}
            onHelp={onHelp}
            onInstall={onInstall}
            onLogout={onLogout && (() => { onLogout(); setOpen(false) })}
          />
        </div>
      )}
    </div>
  )
}
