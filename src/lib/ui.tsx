import { Fragment, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { Icon } from './icons'
import { ShellLoader } from '../components/ShellLoader'
import { appConfig } from '../config/appConfig'
import { ConfirmCard, type ConfirmSpec } from './overlays/ConfirmCard'
import { Overlay } from './overlays'
import { safeHref } from './mediaUrl'
import { isDismissPull } from './overlays/swipeDismiss'
import { ZOOM_FIT, clampZoom, containSize, onPicture, pinchTo, toggleZoomAt, zoomAbout, type Pt, type Size, type Zoom } from './photoZoom'
import { watchRecords, type RecordKey } from './undoKeys'
import { useToastLane } from './toastLane'

// Lightweight app-wide toast + confirm host. Replaces native alert()/confirm()
// so transient feedback and destructive confirmations stay inside the glass
// design language. Imperative API (toast / confirmDialog) backed by a tiny
// module store; mount <Overlays/> once at the app root.

type Tone = 'default' | 'warn' | 'success'
/** How a tone is shown. `edge` keeps the neutral ink pill every other status shares and puts the
 * colour on the leading edge and the icons; `fill` paints the whole pill. A failure (`warn`) is an
 * EDGE by default since 23.09.2026: a saturated red pill for «Synchronisierung fehlgeschlagen» —
 * changes that are safe on the device — read as an alarm, and the app has real alarms (the
 * Atemschutz clock, the Meldeleiste) that must keep that register to themselves. The live print
 * job wore the edge first, for the same reason. `success` stays a fill: it is short and calm.
 * (The Meldeleiste's rows wore the same edge until 29.09.2026; there the glyph alone carries the tone now.) */
type ToneStyle = 'fill' | 'edge'
const defaultToneStyle = (tone: Tone): ToneStyle => (tone === 'warn' ? 'edge' : 'fill')
/** Is this toast a FAILURE, as opposed to a live status that wears the warn edge? A step chain is
 *  a job still under way (the print pill while queued/printing — lib/printJobToast); its own
 *  failure drops the chain. Only a failure gets the red trace in the pill (08-toasts.css ·
 *  `.toast-fail`): a job queued for 90 s is not a failure and must not look like one. */
const isFailure = (t: { tone: Tone; steps?: ToastStep[] }) => t.tone === 'warn' && !t.steps?.length
export interface ToastAction { label: string; onClick: () => void }
/** One stage of a multi-step toast (the live print job). `icon` omitted = an unreached step,
 * drawn as a dim pip; `printer` is the animated «paper coming out» glyph. */
export interface ToastStep {
  label: string
  state: 'done' | 'now' | 'future' | 'fail'
  icon?: 'check' | 'warn' | 'printer'
}
/** How long a toast that goes away by itself has, for the line that runs out along its foot
 *  (08-toasts.css · .toast-life). `key` restarts that line when updateToast resets the clock. */
interface ToastLife { ms: number; key: number }
interface Toast { id: number; text: string; icon?: string; tone: Tone; toneStyle: ToneStyle; action?: ToastAction; steps?: ToastStep[]; onDismiss?: () => void; leaving?: boolean; life?: ToastLife; kind?: string }
/** A confirm that is on screen and waiting for its answer — the shared `ConfirmSpec` plus what
 *  only the pending state needs: which request it is, and the promise to settle. */
interface ConfirmReq extends ConfirmSpec {
  id: number
  resolve: (v: boolean | 'alt') => void
}

/** The picture currently being looked at full-size (see openPhoto). */
interface PhotoReq { url: string; filename: string; caption?: string; download?: boolean }

let toasts: Toast[] = []
let confirmReq: ConfirmReq | null = null
/** The id of the newest confirm — the card's React key, kept while it closes (so it animates out
 *  as itself). See Overlays: every question is its own mount. */
let lastConfirmId = 0
let photoReq: PhotoReq | null = null
const listeners = new Set<() => void>()
let seq = 1
const emit = () => listeners.forEach((l) => l())

// Pending auto-dismiss timers, keyed by toast id, so updateToast can reset a toast's clock
// and dismissToast can cancel it (a live status toast is sticky until it reaches done/failed).
const timers = new Map<number, ReturnType<typeof setTimeout>>()
/** Keep brief feedback brief, but leave long operational/API messages on screen long enough to
 * read. Explicit caller durations still win; action toasts retain the six-second undo floor. */
function defaultToastDuration(text: string, hasAction: boolean) {
  const floor = hasAction ? 6000 : 2800
  return Math.min(10_000, Math.max(floor, 1800 + Array.from(text).length * 45))
}
function scheduleDismiss(id: number, ms: number) {
  const prev = timers.get(id)
  if (prev) clearTimeout(prev)
  timers.set(id, setTimeout(() => { dismissToast(id) }, ms))
}

export function dismissToast(id: number) {
  const t = toasts.find((x) => x.id === id)
  if (!t || t.leaving) return
  const prev = timers.get(id)
  if (prev) { clearTimeout(prev); timers.delete(id) }
  // every exit path runs through here (✕, swipe, timer, programmatic), so a toast that stands
  // for a MODE (the Leitung-pick hint) can end the mode with itself. Must be idempotent —
  // the mode's own teardown also dismisses the toast.
  t.onDismiss?.()
  // leave the way it came in: `.toast.out` plays (.14s, shorter than the entrance), then the
  // node goes. The removal timer stays out of `timers` — nothing may cancel the second half.
  toasts = toasts.map((x) => (x.id === id ? { ...x, leaving: true } : x))
  emit()
  setTimeout(() => { toasts = toasts.filter((x) => x.id !== id); emit() }, 160)
}

/** Toasts are OFF on this screen — the Atemschutz-Link (sweep 30.10.2026 #23, owner: «drop the
 *  notifications entirely since they just hide things»): every caller stays as it is, `toast()`
 *  hands back an id and shows, times and keeps nothing (updateToast/dismissToast then find
 *  nothing). Switched by the host (`<Overlays toasts={false} />`); turning it on clears what stands. */
let toastsMuted = false
function muteToasts(on: boolean) {
  toastsMuted = on
  if (!on) return
  for (const t of toasts) dismissToast(t.id)
}

export function toast(text: string, opts?: { icon?: string; tone?: Tone; toneStyle?: ToneStyle; duration?: number; action?: ToastAction; sticky?: boolean; steps?: ToastStep[]; onDismiss?: () => void; kind?: string }): number {
  if (toastsMuted) return seq++
  // `kind`: a toast of the same kind still on screen is REPLACED, not stacked under the new one
  // (3am test r4, 26.09.2026: three «+ OG» taps stacked three identical «Geschoss hinzugefügt ·
  // Rückgängig» pills over the stack's own «+ UG»). The replaced toast's act stays on ↶.
  if (opts?.kind) for (const t of toasts) if (t.kind === opts.kind && !t.leaving) dismissToast(t.id)
  const id = seq++
  // sticky toasts stay until updateToast/dismissToast decides (live status, a mode's instruction).
  // Otherwise an action (e.g. confirm-with-undo) needs time to be seen and tapped.
  const ms = opts?.sticky ? undefined : opts?.duration ?? defaultToastDuration(text, !!opts?.action)
  toasts = [...toasts, { id, text, icon: opts?.icon, tone: opts?.tone ?? 'default', toneStyle: opts?.toneStyle ?? defaultToneStyle(opts?.tone ?? 'default'), action: opts?.action, steps: opts?.steps, onDismiss: opts?.onDismiss, life: ms ? { ms, key: seq++ } : undefined, kind: opts?.kind }]
  emit()
  if (ms) scheduleDismiss(id, ms)
  return id
}

/**
 * The house confirm-with-undo toast: what just happened, and one tap to take it back.
 *
 * This is the pattern the app uses INSTEAD of asking «wirklich?» before a reversible edit — the
 * operator is at an Einsatz and a modal in the way of a tick costs more than the mistake does.
 * That trade only holds while every one of them looks and behaves the same, and they were seven
 * hand-written copies of the same three lines (Zeitplan, Schichtbänder, Anwesenheit), so the
 * undo icon and the «Rückgängig» label are decided here, once — for the toasts whose only
 * subject IS the undo. The domain toasts keep writing the action out, because each carries its
 * own icon (radio, drop, trash, pen, move, check) and that glyph is what names the edit; they
 * are not an unfinished sweep.
 */
export function undoToast(text: string, onUndo: () => void, guard?: readonly RecordKey[] | (() => boolean), opts?: { kind?: string }): number {
  // ⚠️ `guard` — the toast outlives remote merges like any undo step does (25.09.2026). Given the
  // records `onUndo` writes, a merge that changes one of them (lib/undoKeys · noteRemoteChanges)
  // makes the button decline with «Nicht mehr rückgängig machbar» instead of writing a pre-merge
  // value over another device's change; given a predicate (a timeline entry's `standing`), the
  // entry's own fate decides. Without one the toast acts unguarded, as it always did.
  // `opts.kind` (#232): a second toast of the same kind replaces the first instead of stacking.
  const watch = Array.isArray(guard) ? watchRecords(guard) : null
  const ok = typeof guard === 'function' ? guard : watch ? watch.ok : () => true
  return toast(text, {
    icon: 'undo',
    action: {
      label: appConfig.copy.undo,
      onClick: () => {
        watch?.release()
        if (!ok()) { toast(appConfig.copy.undoLost, { icon: 'warn' }); return }
        onUndo()
      },
    },
    onDismiss: () => watch?.release(),
    kind: opts?.kind,
  })
}

/** Patch a live toast in place (text/icon/tone/action). Pass `duration` to auto-dismiss it
 * (e.g. once the job reaches done/failed); omit to keep it sticky. Unknown id = no-op. */
export function updateToast(id: number, text: string, opts?: { icon?: string; tone?: Tone; toneStyle?: ToneStyle; duration?: number; action?: ToastAction | null; steps?: ToastStep[] | null }) {
  const cur = toasts.find((t) => t.id === id)
  if (!cur || cur.leaving) return
  toasts = toasts.map((t) => t.id === id
    ? { ...t, text, icon: opts?.icon, tone: opts?.tone ?? 'default', toneStyle: opts?.toneStyle ?? defaultToneStyle(opts?.tone ?? 'default'), action: opts?.action ?? undefined, steps: opts?.steps ?? undefined,
        // a new clock is a new line; no clock keeps whatever the toast already had
        life: opts?.duration ? { ms: opts.duration, key: seq++ } : t.life }
    : t)
  emit()
  if (opts?.duration) scheduleDismiss(id, opts.duration)
}

/** The two labels are the only optional part of the ask: unset, they come from the copy. */
// `'alt'` only ever comes back when the ask carried an `altLabel`, and the overloads say so:
// a plain two-button confirm keeps its `Promise<boolean>`, so no existing caller has to
// consider an answer its dialog cannot give.
type ConfirmOpts = Omit<ConfirmSpec, 'confirmLabel' | 'cancelLabel'> & { confirmLabel?: string; cancelLabel?: string }
export function confirmDialog(opts: ConfirmOpts & { altLabel: string }): Promise<boolean | 'alt'>
export function confirmDialog(opts: ConfirmOpts & { altLabel?: undefined }): Promise<boolean>
export function confirmDialog(opts: ConfirmOpts): Promise<boolean | 'alt'> {
  return new Promise((resolve) => {
    // a fresh request supersedes any pending one (resolve the old as cancelled)
    confirmReq?.resolve(false)
    lastConfirmId = seq
    confirmReq = {
      id: seq++,
      title: opts.title,
      message: opts.message,
      items: opts.items,
      note: opts.note,
      confirmLabel: opts.confirmLabel ?? appConfig.copy.confirm.ok,
      cancelLabel: opts.cancelLabel ?? appConfig.copy.confirm.cancel,
      danger: opts.danger,
      altLabel: opts.altLabel,
      altDanger: opts.altDanger,
      safeAnswer: opts.safeAnswer,
      resolve,
    }
    emit()
  })
}

/**
 * Show one picture full-size, in the app.
 *
 * A photo used to open with `target="_blank"`. In a browser tab that is merely untidy; in the
 * INSTALLED app it leaves the app — iOS hands the picture to Safari and the operator has to find
 * their way back to a running Einsatz. So it opens here, over the surface, with the one thing the
 * new tab was actually good for: a download.
 *
 * Imperative like toast()/confirmDialog(), so a thumbnail anywhere can call it without every
 * surface in between having to carry a viewer prop.
 */
/** Caret to the end on focus. A seeded editor (transcript, correction, a rename) opens to
 *  CONTINUE the text; the browser's default caret at position 0 invites typing in front of it.
 *  Attach as `onFocus` — autoFocus fires it exactly once. */
export function caretToEnd(ev: { currentTarget: HTMLTextAreaElement | HTMLInputElement }) {
  const el = ev.currentTarget
  const n = el.value.length
  try { el.setSelectionRange(n, n) } catch { /* input types without selection (number) — keep the default */ }
}

export function openPhoto(
  url: string,
  /** `download: false` for pictures that are REFERENCE rather than incident media — a
   *  Kommandoakten diagram belongs to the BGV and is one tap from the source anyway, so
   *  offering «herunterladen» there only invites a stray copy that ages out of date. Incident
   *  media (Verlauf, Beilagen, Objektfoto) keeps it: getting a photo out is the point. */
  opts?: { filename?: string; caption?: string; download?: boolean },
) {
  photoReq = { url, filename: opts?.filename || 'foto.jpg', caption: opts?.caption, download: opts?.download !== false }
  emit()
}

function useForceUpdate() {
  const [, setN] = useState(0)
  useEffect(() => {
    const l = () => setN((n) => n + 1)
    listeners.add(l)
    return () => { listeners.delete(l) }
  }, [])
}

/** The step chain of a live job: done steps keep their tick and step back, the running one
 * carries the label, the unreached ones stay visible as pips so «what still has to happen» is
 * readable at a glance. Below 520px the labels of everything but the running step drop away
 * (app.css) — the chain then still fits one line on a phone.
 * `text` is the plain sentence: it stays as the screen-reader announcement, because reading a
 * chain of three stage names out loud says nothing about which one is current. */
function ToastSteps({ steps, text }: { steps: ToastStep[]; text: string }) {
  return (
    <>
      <span className="sr-only">{text}</span>
      <span className="toast-steps" aria-hidden>
        {steps.map((s, i) => (
          <Fragment key={s.label}>
            {i > 0 && <span className="toast-chev"><Icon id="chevron" /></span>}
            <span className={`toast-step ${s.state}`}>
              {s.state === 'now' && s.icon !== 'check' && s.icon !== 'warn'
                ? <ShellLoader /> : s.icon ? <Icon id={s.icon} /> : <span className="toast-pip" />}
              <span className="toast-step-label">{s.label}</span>
            </span>
          </Fragment>
        ))}
      </span>
    </>
  )
}

/** The success toast's tick, drawn in once (~250ms stroke draw, 08-toasts.css) instead of
 * popping on statically — the toast pill's small cousin of the sync glyph's closing tick
 * (components/SyncGlyph). Written out rather than `<Icon id="check"/>` because a CSS animation
 * on a path inside a `<use>` shadow tree is not reliably applied.
 * Same geometry and box as the sprite's #check, so nothing shifts. */
function ToastCheck() {
  return (
    <svg className="i toast-check" viewBox="0 0 24 24" aria-hidden>
      <path d="M5 12.5 10 17 19 7" />
    </svg>
  )
}

// …in CSS pixels of finger travel. Below this a drag springs back: the button/pill is a target
// first and a slider second, so a shaky press must not throw away the undo — or the message —
// it was aimed at. Shared by ToastAction's own cluster-flick and ToastRow's whole-pill swipe
// below, so both read as the same gesture at the same distance.
const FLICK = 56

/**
 * The action cluster of a confirm-with-undo toast — «Rückgängig», and the way to get rid of it.
 *
 * The bounded toast stack accepts vertical panning wherever a pill is visible, so an unusually
 * busy burst remains reachable instead of clipping. Mobile lane rules keep that region clear of
 * the FAB, tool bars and variable-height task panels; these controls remove the actionable pill
 * directly when the operator needs the map area back.
 *
 * Two ways out, because they suit different moments: the ✕ for «not now, move», and a flick in
 * either direction for the hand that is already on its way to whatever sits underneath. This
 * cluster keeps its OWN drag rather than riding the whole-pill one ToastRow now offers — its
 * buttons are real tap targets (Rückgängig fires the undo, ✕ is a plain close), and a whole-pill
 * swipe starting under them would fire both gestures from one drag.
 */
function ToastAction({ toast: t }: { toast: Toast }) {
  const [dx, setDx] = useState(0)
  const drag = useRef<{ id: number; x0: number } | null>(null)
  const end = (e: React.PointerEvent) => {
    if (!drag.current) return
    const moved = e.clientX - drag.current.x0
    drag.current = null
    if (Math.abs(moved) >= FLICK) dismissToast(t.id)
    else setDx(0)
  }
  return (
    // bubble-phase stopPropagation: each button's OWN onPointerDown still fires first (target
    // before ancestor), it just never reaches ToastRow's whole-pill drag above it — so the drag
    // that now spans the whole pill never arms alongside a button's own tap/flick from one touch.
    <span className="toast-actions" onPointerDown={(e) => e.stopPropagation()}
      style={dx ? { transform: `translateX(${dx}px)`, opacity: Math.max(.25, 1 - Math.abs(dx) / (FLICK * 2)) } : undefined}>
      <button
        className="btn toast-action"
        // ⚠️ optional call: pointer capture keeps the flick tracking once the finger leaves the
        // button, but it is not available everywhere (jsdom has no implementation, and neither did
        // older WebViews) — and an undo button that THROWS on touch is worse than one that only
        // follows the finger while it stays on the target.
        onPointerDown={(e) => { drag.current = { id: e.pointerId, x0: e.clientX }; e.currentTarget.setPointerCapture?.(e.pointerId) }}
        onPointerMove={(e) => { if (drag.current?.id === e.pointerId) setDx(e.clientX - drag.current.x0) }}
        onPointerUp={end}
        onPointerCancel={end}
        onClick={() => {
          // a flick ends on the same element as a tap, so the click that follows it must not also
          // fire the action — the toast is already gone, and undoing was not what was asked for
          if (Math.abs(dx) >= FLICK) return
          dismissToast(t.id)
          t.action!.onClick()
        }}
      >
        {t.action!.label}
      </button>
      <button
        className="toast-x"
        title={appConfig.copy.closeDialog}
        aria-label={appConfig.copy.closeDialog}
        onClick={() => dismissToast(t.id)}
      ><Icon id="close" /></button>
    </span>
  )
}

/**
 * One row of the toast stack. The whole PILL now follows a horizontal drag, not just the
 * «Rückgängig»/✕ cluster (ToastAction, above) — below `FLICK` it springs back, past it the pill
 * keeps travelling the way the finger went (inline transform, no transition — the drag itself
 * must never lag the touch) and the toast dismisses once released. The CSS `transition` that then
 * carries it the rest of the way off-screen is the ONLY animated part, so it — like every other
 * CSS transition in the app — is already zeroed by the app-wide `prefers-reduced-motion` rule
 * (03-map.css `* { transition-duration: .001ms !important }`); a reduced-motion viewer sees the
 * same jump to «gone» without the travel, with no separate code path needed here.
 *
 * A tap on the pill itself does NOTHING (05.10.2026, owner: «toasts should close on tapping the
 * close button not the entire toast»). It used to dismiss a plain toast, which threw away a
 * message the finger only brushed on its way to the map or a bar under it. Only the ✕ closes,
 * the action button runs its action (and closes), and the swipe stays. The drag never calls
 * `preventDefault`, and the cluster's own buttons stop the drag from arming under them
 * (`onPointerDown` `stopPropagation`) — those keep their own tap and flick untouched.
 */
function ToastRow({ t }: { t: Toast }) {
  const [dx, setDx] = useState(0)
  const [flung, setFlung] = useState(false)
  const drag = useRef<{ id: number; x0: number } | null>(null)

  const onDown = (e: React.PointerEvent) => {
    drag.current = { id: e.pointerId, x0: e.clientX }
    e.currentTarget.setPointerCapture?.(e.pointerId)
  }
  const onMove = (e: React.PointerEvent) => {
    if (drag.current?.id !== e.pointerId) return
    setDx(e.clientX - drag.current.x0)
  }
  const onUp = (e: React.PointerEvent) => {
    if (drag.current?.id !== e.pointerId) return
    const moved = e.clientX - drag.current.x0
    drag.current = null
    if (Math.abs(moved) < FLICK) { setDx(0); return }
    // clear of the lane, not just past the threshold — the transition (JSX below) carries it the
    // rest of the way while the pill fades, then dismissToast's own .16s (matching) takes the node
    // out from under it.
    setFlung(true)
    setDx(moved < 0 ? -480 : 480)
    dismissToast(t.id)
  }

  return (
    <div
      className={`toast toast-${t.tone}${t.toneStyle === 'edge' ? ' toast-edge' : ''}${isFailure(t) ? ' toast-fail' : ''}${t.leaving ? ' out' : ''}`}
      style={dx ? {
        transform: `translateX(${dx}px)`,
        opacity: flung ? 0 : Math.max(.25, 1 - Math.abs(dx) / (FLICK * 2)),
        transition: flung ? 'transform .16s var(--ease), opacity .16s var(--ease)' : undefined,
      } : undefined}
      onPointerDown={onDown}
      onPointerMove={onMove}
      onPointerUp={onUp}
      onPointerCancel={onUp}
    >
      {t.steps ? <ToastSteps steps={t.steps} text={t.text} /> : (
        <>
          {/* success + check gets the drawn-in tick; other icons (mic, map, …) stay the
              sprite — their strokes can't be draw-animated through <use> anyway */}
          {t.icon && (t.tone === 'success' && t.icon === 'check' ? <ToastCheck /> : <Icon id={t.icon} />)}
          <span className="toast-message">{t.text}</span>
        </>
      )}
      {t.action && <ToastAction toast={t} />}
      {/* ⚠️ Everything that goes away BY ITSELF says so (25.09.2026): a ✕ and a line that runs out
          with its time. An instruction or a live status (sticky) has neither — it stays until its
          mode or its job ends. The action cluster brings its own ✕. The pill-wide drag must not
          arm under the ✕ (same reason as ToastAction's own stopPropagation). */}
      {t.life && !t.action && (
        <button type="button" className="toast-x" title={appConfig.copy.closeDialog} aria-label={appConfig.copy.closeDialog}
          onPointerDown={(e) => e.stopPropagation()}
          onClick={(e) => { e.stopPropagation(); dismissToast(t.id) }}
        ><Icon id="close" /></button>
      )}
      {t.life && <span key={t.life.key} className="toast-life" style={{ animationDuration: `${t.life.ms}ms` }} aria-hidden />}
    </div>
  )
}

/** The toast/confirm/photo host — mount once at the app root. `toasts={false}`: this screen shows
 *  no toasts at all (the Atemschutz-Link, see `toastsMuted`); confirms and photos still open. */
export function Overlays({ toasts: showToasts = true }: { toasts?: boolean } = {}) {
  useForceUpdate()
  // a layout effect: it runs before any passive effect of the same commit can raise a toast
  useLayoutEffect(() => {
    muteToasts(!showToasts)
    return () => muteToasts(false)
  }, [showToasts])
  // the phone's lane stands ON an open bottom sheet instead of flipping to the top (lib/toastLane)
  const toasterRef = useRef<HTMLDivElement>(null)
  useToastLane(toasterRef, toasts.length > 0)
  const req = confirmReq
  const photo = photoReq
  const closePhoto = () => { photoReq = null; emit() }

  const close = (v: boolean | 'alt') => {
    const r = confirmReq
    confirmReq = null
    emit()
    r?.resolve(v)
  }

  return (
    <>
      {/* ⚠️ Rendered NEWEST-FIRST into a `column-reverse` stack (see .toaster in 08-toasts.css).
          Reversed flex lays the first DOM child at the baseline, so newest-first is what puts the
          latest message nearest the controls — and it is also what makes the browser anchor the
          scroll port at that end for free. Plain `column` with the natural order looks identical
          until the stack overflows its lane, and then starts the scroll at the OLDEST toast, so a
          burst hides the pill carrying «Rückgängig» below the fold with nothing saying so. */}
      <div className="toaster" ref={toasterRef} aria-live="polite" aria-atomic="false">
        {[...toasts].reverse().map((t) => <ToastRow key={t.id} t={t} />)}
      </div>

      {/* ⚠️ KEYED per question (staging r3 F5). A chain of questions — the Abschluss asks «noch
          drin», then «vermisst», then the paperwork — is answered and re-asked in ONE render
          batch, so the card never closed in between: React kept the node, Base UI's initial
          focus did not run again, and the focus of the «Trotzdem abschliessen» just tapped stood
          on the same button of the next question. Enter then closed the Einsatz through «5
          Personen noch vermisst». A fresh mount per question lands on ITS safe answer, for every
          caller at once. */}
      <ConfirmCard
        key={req?.id ?? lastConfirmId}
        open={!!req}
        title={req?.title}
        message={req?.message ?? ''}
        items={req?.items}
        note={req?.note}
        confirmLabel={req?.confirmLabel ?? ''}
        cancelLabel={req?.cancelLabel ?? ''}
        danger={req?.danger}
        altLabel={req?.altLabel}
        altDanger={req?.altDanger}
        safeAnswer={req?.safeAnswer}
        onResolve={close}
      />

      {/* full-size picture — see openPhoto */}
      {photo && (
        // ⚠️ Its own scrim, above every sheet: this opens FROM the Verlauf drawer, from the
        // Rapport's Beilagen, from the capture page — on the shared z-80 backdrop it landed
        // underneath whichever surface launched it and read as «the picture doesn't open».
        <Overlay
          open onClose={closePhoto} className="photo-view ui-dialog" backdropClassName="photo-scrim"
          ariaLabel={photo.caption || appConfig.copy.photoViewer.title}
        >
          <div className="photo-view-head">
            <span className="photo-view-cap">{photo.caption || appConfig.copy.photoViewer.title}</span>
            {/* same-origin /api/media URL, so `download` really downloads instead of navigating.
                The URL is row data from another device, so it goes through safeHref before it
                becomes an href (lib/mediaUrl) — a poisoned record must not put javascript:/data:
                behind «Herunterladen». `blob:` stays: an OFFLINE photo is a locally minted object
                URL (its download is real), and a foreign «blob:» string synced in is a dead
                reference, not a script sink. Rejected → no download link, same as download:false. */}
            {photo.download && (() => {
              const href = photo.url.startsWith('blob:') ? photo.url : safeHref(photo.url)
              return href && (
                <a className="ip-btn" href={href} download={photo.filename}>
                  <Icon id="download" />{appConfig.copy.photoViewer.download}
                </a>
              )
            })()}
            <button className="ctx-x" onClick={closePhoto} aria-label={appConfig.copy.closeDialog} title={appConfig.copy.closeDialog}>
              <Icon id="close" />
            </button>
          </div>
          <PhotoZoom url={photo.url} alt={photo.caption ?? ''} onClose={closePhoto} key={photo.url} />
        </Overlay>
      )}
    </>
  )
}

/**
 * Pinch/wheel zoom on the full-size picture. A document photo is often read for a detail —
 * a Kennzeichen, a Gefahrgutnummer, the small print on a Gasflasche — and «so gross wie der
 * Bildschirm» is not always big enough. The maths is lib/photoZoom; this is the wiring:
 *
 * - two fingers pinch AND pan (the spot under the fingers stays under them); the wheel zooms
 *   about the cursor;
 * - one finger (or the mouse) pans while zoomed in;
 * - touch: a DOUBLE tap zooms in about the spot / back to the fit (iOS Photos). A single tap on
 *   the dark letterbox around the picture closes, as does a push DOWN at the fit (the same
 *   «let go» rule as the bottom sheets, overlays/swipeDismiss) — on a full-screen phone viewer
 *   there is no backdrop left to tap;
 * - mouse: a SINGLE click zooms in/out. The surface shows a zoom cursor, so a click is what anyone
 *   tries first; it sat behind a double-click before and did nothing.
 *
 * ⚠️ Gestures live HERE, on the frame (`touch-action: none`): the app blocks page zoom
 * (`maximum-scale=1`, `touch-action: pan-x pan-y` on body), so a pinch the browser handled would
 * do nothing at all. ⚠️ Wheel is a native non-passive listener: React's onWheel is passive, its
 * preventDefault is ignored.
 */
function PhotoZoom({ url, alt, onClose }: { url: string; alt: string; onClose: () => void }) {
  const [z, setZ] = useState<Zoom>(ZOOM_FIT)
  /** the live zoom for handlers that outlive a render (the native wheel listener, a gesture) */
  const zRef = useRef<Zoom>(ZOOM_FIT)
  /** swipe-down travel at the fit; the picture follows the finger and fades */
  const [pull, setPull] = useState(0)
  const boxRef = useRef<HTMLDivElement>(null)
  const natural = useRef<Size | null>(null)
  // live pointers: two down = pinch. Keyed by pointerId so a lifted finger can't strand the gesture.
  const pts = useRef(new Map<number, Pt>())
  const pinch = useRef<{ z: Zoom; mid: Pt; dist: number } | null>(null)
  const drag = useRef<{ x0: number; y0: number; t0: number; z: Zoom; mode: 'pan' | 'pull' | 'none' | null } | null>(null)
  /** did this gesture travel? a pan's release must not read as a tap/click */
  const moved = useRef(false)
  const lastTap = useRef<{ t: number; x: number; y: number } | null>(null)
  const lastPointer = useRef('mouse')

  const geom = () => {
    const el = boxRef.current
    if (!el) return null
    const r = el.getBoundingClientRect()
    const frame = { w: r.width, h: r.height }
    return { r, frame, pic: containSize(frame, natural.current) }
  }
  /** a viewport point → px from the frame's centre (photoZoom's coordinates) */
  const local = (cx: number, cy: number): Pt => {
    const g = geom()
    return g ? { x: cx - (g.r.left + g.r.width / 2), y: cy - (g.r.top + g.r.height / 2) } : { x: 0, y: 0 }
  }
  const apply = (next: Zoom) => {
    const g = geom()
    const c = g ? clampZoom(next, g.frame, g.pic) : next
    zRef.current = c
    setZ(c)
  }

  useEffect(() => {
    const el = boxRef.current
    if (!el) return
    const onWheel = (e: WheelEvent) => {
      e.preventDefault()
      const p = zRef.current
      apply(zoomAbout(p, p.k * (e.deltaY < 0 ? 1.15 : 1 / 1.15), local(e.clientX, e.clientY)))
    }
    // a turned phone re-fits the frame: keep the picture over it
    const onResize = () => apply(zRef.current)
    el.addEventListener('wheel', onWheel, { passive: false })
    window.addEventListener('resize', onResize)
    return () => { el.removeEventListener('wheel', onWheel); window.removeEventListener('resize', onResize) }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- reads refs only
  }, [])

  const mid = (a: Pt, b: Pt) => local((a.x + b.x) / 2, (a.y + b.y) / 2)
  const onDown = (e: React.PointerEvent) => {
    lastPointer.current = e.pointerType
    pts.current.set(e.pointerId, { x: e.clientX, y: e.clientY })
    ;(e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId)
    if (pts.current.size === 2) {
      const [a, b] = [...pts.current.values()]
      pinch.current = { z: zRef.current, mid: mid(a, b), dist: Math.hypot(a.x - b.x, a.y - b.y) }
      drag.current = null
      moved.current = true
      setPull(0)
    } else if (pts.current.size === 1) {
      moved.current = false
      drag.current = { x0: e.clientX, y0: e.clientY, t0: e.timeStamp, z: zRef.current, mode: null }
    }
  }
  const onMove = (e: React.PointerEvent) => {
    if (!pts.current.has(e.pointerId)) return
    pts.current.set(e.pointerId, { x: e.clientX, y: e.clientY })
    const pi = pinch.current
    if (pi && pts.current.size >= 2) {
      const [a, b] = [...pts.current.values()]
      apply(pinchTo(pi.z, pi.mid, pi.dist, mid(a, b), Math.hypot(a.x - b.x, a.y - b.y)))
      return
    }
    const d = drag.current
    if (!d) return
    const dx = e.clientX - d.x0
    const dy = e.clientY - d.y0
    if (!moved.current && Math.hypot(dx, dy) > 6) moved.current = true
    if (!moved.current) return
    if (d.mode === null) {
      d.mode = d.z.k > 1 ? 'pan' : e.pointerType !== 'mouse' && dy > 0 && dy > Math.abs(dx) ? 'pull' : 'none'
    }
    if (d.mode === 'pan') apply({ k: d.z.k, x: d.z.x + dx, y: d.z.y + dy })
    else if (d.mode === 'pull') setPull(Math.max(0, dy))
  }
  const onTap = (e: React.PointerEvent) => {
    const at = local(e.clientX, e.clientY)
    const lt = lastTap.current
    if (lt && e.timeStamp - lt.t < 320 && Math.hypot(at.x - lt.x, at.y - lt.y) < 30) {
      lastTap.current = null
      apply(toggleZoomAt(zRef.current, at))
      return
    }
    lastTap.current = { t: e.timeStamp, x: at.x, y: at.y }
    const g = geom()
    if (g && zRef.current.k === 1 && !onPicture(zRef.current, g.pic, at)) onClose()
  }
  const onUp = (e: React.PointerEvent) => {
    if (!pts.current.delete(e.pointerId)) return
    if (pts.current.size < 2 && pinch.current) {
      pinch.current = null
      // the finger still down carries on as a pan from where the pinch left the picture
      const [rest] = [...pts.current.values()]
      drag.current = rest ? { x0: rest.x, y0: rest.y, t0: e.timeStamp, z: zRef.current, mode: 'pan' } : null
      return
    }
    if (pts.current.size > 0) return
    const d = drag.current
    drag.current = null
    if (d?.mode === 'pull') {
      if (isDismissPull(e.clientY - d.y0, e.timeStamp - d.t0)) onClose()
      else setPull(0)
      return
    }
    if (!moved.current && e.pointerType !== 'mouse') onTap(e)
  }
  const onCancel = (e: React.PointerEvent) => {
    pts.current.delete(e.pointerId)
    if (pts.current.size < 2) pinch.current = null
    if (pts.current.size === 0) { drag.current = null; setPull(0) }
  }
  const onClick = (e: React.MouseEvent) => {
    // touch taps are answered in onUp (double tap); the click that follows them is not a zoom
    if (lastPointer.current !== 'mouse' || moved.current) return
    apply(toggleZoomAt(zRef.current, local(e.clientX, e.clientY)))
  }

  return (
    <div
      ref={boxRef} className="photo-view-zoom" data-swipe-ignore
      onPointerDown={onDown} onPointerMove={onMove} onPointerUp={onUp} onPointerCancel={onCancel}
      onClick={onClick}
      data-zoomed={z.k > 1 || undefined}
    >
      <img
        className="photo-view-img" src={url} alt={alt} draggable={false}
        onLoad={(e) => {
          const im = e.currentTarget
          natural.current = { w: im.naturalWidth, h: im.naturalHeight }
          apply(zRef.current)
        }}
        style={{
          transform: `translate(${z.x}px, ${z.y + pull}px) scale(${z.k})`,
          opacity: pull ? Math.max(0.4, 1 - pull / 320) : undefined,
        }}
      />
    </div>
  )
}
