import { useRef } from 'react'
// Dialog, not AlertDialog. The two differ in exactly two things: the role, and whether a click
// outside closes — and AlertDialog does not merely default the latter off, it `Omit`s
// `disablePointerDismissal` from its props so it cannot be turned on. Dialog with the alert role
// spelled out is the same component with the behaviour we want, rather than one fought against.
import { Dialog } from '@base-ui/react/dialog'
import { Button } from '../../components/Button'
import { Icon } from '../icons'

/**
 * What a confirm ASKS. One declaration for all three places the same question travels through:
 * the imperative `confirmDialog()` (which fills the two labels from the copy), the pending
 * request `ui.tsx` holds while it waits for an answer, and this component's props. They were
 * three hand-kept copies of the same fields, and adding `items` to the middle one only is how
 * an open-points list reaches the state and never the screen.
 */
/**
 * An open point that can be TAPPED. «Noch offen: Zeiten» named the gap and the operator closed the
 * dialog and hunted for the Zeiten — the same failure the «noch offen» chips fixed on the sheet.
 * Tapping resolves the ask `false` (going there is not going ahead) and then runs the action.
 */
export interface ConfirmItem {
  label: string
  /** a short read-out at the row's end – the pre-filled Einsatzende's «jetzt 23:41» */
  end?: string
  onClick: () => void
  /** The row's own answer, as a BUTTON at its end (3am sweep, 23.10.2026: «Nichts verwendet»,
   *  «Entfällt», «Ändern»). The owner: «the tappable buttons where you can clearly just tap on
   *  them … and don't have to infer that the whole line is clickable». It settles the point IN
   *  the sheet, so the ask stays open and re-reads its spec (ConfirmSpec · refresh); `leaves`
   *  marks the ones that go somewhere instead («Wählen», «Schreiben») – those resolve `false`
   *  first, like the row itself. */
  action?: { label: string; onClick: () => void; leaves?: boolean }
  /** already answered – a check instead of the chevron, the row stays as the record of it */
  done?: boolean
}

export interface ConfirmSpec {
  title?: string
  message: string
  /** the open points, as a LIST. «Noch offen: Zeiten, Mittel, Einsatzleiter, Kurzbericht,
   *  Rückmeldung ELZ. Trotzdem abschliessen? …» is a paragraph nobody reads to the end — and
   *  it is the one part of the sentence somebody has to act on, item by item. */
  items?: (string | ConfirmItem)[]
  /** the sentence AFTER the list — what happens if you go ahead anyway */
  note?: string
  confirmLabel: string
  cancelLabel: string
  danger?: boolean
  /** an optional SECOND way through — a third button between Abbrechen and the primary, for the
   *  ask that genuinely has two answers («nicht eingesetzt» abmelden vs. entfernen). Dismissal
   *  still resolves `false`: an alternative is chosen, never defaulted into. */
  altLabel?: string
  altDanger?: boolean
  /** Which answer is the SAFE one to press (25.09.2026) — `'cancel'` or `'alt'`. That button
   *  becomes the filled primary on the right and takes the initial focus; the confirm steps back
   *  to a quiet button. For an ask whose «yes» WRITES something a reflex tap or an Enter must not:
   *  the double-contact question («Nochmals» writes a second Kontakt, «OK» nothing), the low
   *  Eingangsdruck («180 bestätigen» / «Ändern»), the Abschluss's «Zur Tafel». It is NOT `danger`:
   *  nothing is destroyed, so no red. Every dismissal still resolves `false`. */
  safeAnswer?: 'cancel' | 'alt'
  /** Re-read the ask after a row's in-place action: what is still open, the words on the
   *  title, the message and the buttons («Angaben fehlen noch» is not true any more once the last
   *  one is answered in the sheet). Only the parts returned change. */
  refresh?: () => Partial<Pick<ConfirmSpec, 'title' | 'items' | 'message' | 'note' | 'confirmLabel' | 'cancelLabel' | 'safeAnswer'>>
}

/**
 * The confirm/alert card behind the imperative `confirmDialog()` (src/lib/ui.tsx). Built on Base
 * UI's AlertDialog so it gets focus trap + restore, scroll-lock and inert siblings — keeping the
 * existing `.confirm-*` look and the `role="alertdialog"` semantics.
 *
 * The backdrop CANCELS (2026-08-07). It used to do nothing at all — Base UI's alert dialog is
 * deliberately not pointer-dismissible, on the reasoning that a destructive confirmation should
 * not be dismissable by accident. But the only thing a backdrop click can do here is resolve
 * `false`: it can never confirm, so the worst case it buys is pressing the button again, while
 * the cost of the old behaviour was a dialog that ignores the gesture every other overlay in this
 * app answers to. A modal that does not respond to a tap beside it reads as a frozen app, and
 * that is the wrong thing to be wondering about with an Einsatz open.
 */
export function ConfirmCard({ open, title, message, items, note, confirmLabel, cancelLabel, danger, altLabel, altDanger, safeAnswer, onResolve, onRefresh }: Omit<ConfirmSpec, 'refresh'> & {
  open: boolean
  onResolve: (confirmed: boolean | 'alt') => void
  /** a row's in-place action ran – the host re-reads the spec (ConfirmSpec · refresh) */
  onRefresh?: () => void
}) {
  const confirmRef = useRef<HTMLButtonElement>(null)
  const cancelRef = useRef<HTMLButtonElement>(null)
  const altRef = useRef<HTMLButtonElement>(null)
  const cancelBtn = (
    <button key="cancel" ref={cancelRef} className={safeAnswer === 'cancel' ? 'ip-btn primary' : 'ip-btn'} onClick={() => onResolve(false)}>{cancelLabel}</button>
  )
  const altBtn = altLabel ? (
    <button key="alt" ref={altRef} className={`ip-btn${altDanger ? ' ip-btn-danger' : ''}${safeAnswer === 'alt' ? ' primary' : ''}`} onClick={() => onResolve('alt')}>{altLabel}</button>
  ) : null
  /* the OUTLINE danger, not a solid red fill: the same treatment every other destructive action in
     the app wears (Anwesenheit, Verlauf, BandGrid), and this confirm is also what «Einsatz
     abschliessen» goes through — which is not destructive at all. With a `safeAnswer` it is the
     quiet one. */
  const confirmBtn = (
    <button key="confirm" ref={confirmRef} className={safeAnswer ? 'ip-btn' : `ip-btn ${danger ? 'ip-btn-danger' : 'primary'}`} onClick={() => onResolve(true)}>{confirmLabel}</button>
  )
  // the filled answer always stands on the right, where the thumb expects the primary
  const actions = safeAnswer === 'cancel' ? [confirmBtn, altBtn, cancelBtn]
    : safeAnswer === 'alt' ? [cancelBtn, confirmBtn, altBtn]
    : [cancelBtn, altBtn, confirmBtn]
  return (
    // every route out of here — backdrop, Esc, ✕-less cancel — resolves FALSE. There is no path
    // by which not answering counts as yes.
    <Dialog.Root open={open} onOpenChange={(next) => { if (!next) onResolve(false) }}>
      <Dialog.Portal>
        <Dialog.Backdrop className="modal-backdrop confirm-backdrop" />
        {/* ⚠️ Where the focus LANDS is an answer given in advance. On an ordinary ask («Einsatz
            abschliessen?») it is the confirm — the operator came here to do it. On a DANGER ask it
            is «Abbrechen» (23.09.2026): an Enter or Space from a tablet's keyboard cover — pressed to
            «get the dialog away» — would otherwise confirm the one thing that cannot be taken
            back. Going ahead is still one tap away. */}
        <Dialog.Popup role="alertdialog" className={`confirm-card ui-dialog${altLabel ? ' confirm-card-three' : ''}`} initialFocus={safeAnswer === 'alt' && altLabel ? altRef : danger || safeAnswer === 'cancel' ? cancelRef : confirmRef} aria-label={title ?? message}>
          {title && <Dialog.Title className="confirm-title" render={<h3 />}>{title}</Dialog.Title>}
          {/* An empty message renders NOTHING, not an empty paragraph with its own margin: some
              confirms are a title and two buttons («Stationsdrucker offline» — the title already
              is the whole statement, and the paragraph under it was an explanation nobody needed
              to read twice). */}
          {message && <p className="confirm-msg">{message}</p>}
          {/* the open points as a LIST, not as a comma-separated run-on — this is the part
              somebody has to act on, item by item, and a paragraph is read to the end by
              nobody at 3am */}
          {!!items?.length && (
            <ul className="confirm-list">
              {items.map((it) => typeof it === 'string'
                ? <li key={it}>{it}</li>
                : (
                  <li key={it.label} className="confirm-list-go">
                    {/* a full-width row, not a link in a bullet: ≥44px so a thumb lands on it at
                        3am, and the whole line is the target rather than the word alone */}
                    <button type="button" className="confirm-list-btn" onClick={() => { onResolve(false); it.onClick() }}>
                      <span>{it.label}</span>
                      {it.end && <span className="confirm-list-end">{it.end}</span>}
                      {it.done
                        ? <Icon id="check" className="confirm-list-done" />
                        : <span className="confirm-list-chev" aria-hidden="true">›</span>}
                    </button>
                    {/* the row's own answer beside it: settles the point here and the ask re-reads
                        itself, or (`leaves`) goes to the field like the row does */}
                    {it.action && (
                      <Button className="confirm-list-action" onClick={() => {
                        if (it.action!.leaves) { onResolve(false); it.action!.onClick(); return }
                        it.action!.onClick()
                        onRefresh?.()
                      }}>{it.action.label}</Button>
                    )}
                  </li>
                ))}
            </ul>
          )}
          {note && <p className="confirm-note">{note}</p>}
          <div className="confirm-actions">{actions}</div>
        </Dialog.Popup>
      </Dialog.Portal>
    </Dialog.Root>
  )
}
