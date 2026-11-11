import { useRef } from 'react'
// Dialog, not AlertDialog. The two differ in exactly two things: the role, and whether a click
// outside closes — and AlertDialog does not merely default the latter off, it `Omit`s
// `disablePointerDismissal` from its props so it cannot be turned on. Dialog with the alert role
// spelled out is the same component with the behaviour we want, rather than one fought against.
import { Dialog } from '@base-ui/react/dialog'
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
  /** already answered – a check instead of the chevron, the row stays as the record of it */
  done?: boolean
}

/**
 * A line that only NAMES something, with its name in bold (owner pick «Trupps noch drin» mock 4,
 * 06.11.2026): «**Trupp 4** – Weber Fabian / Moser Simon / Weber Nina». Not a target and not an
 * open point – no bullet, no chevron; one per thing, so a list of crews is read down, not across.
 */
export interface ConfirmLine {
  head?: string
  text: string
}

export interface ConfirmSpec {
  title?: string
  message: string
  /** the open points, as a LIST. «Noch offen: Zeiten, Mittel, Einsatzleiter, Kurzbericht,
   *  Rückmeldung ELZ. Trotzdem abschliessen? …» is a paragraph nobody reads to the end — and
   *  it is the one part of the sentence somebody has to act on, item by item. */
  items?: (string | ConfirmItem | ConfirmLine)[]
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
export function ConfirmCard({ open, title, message, items, note, confirmLabel, cancelLabel, danger, altLabel, altDanger, safeAnswer, onResolve }: ConfirmSpec & {
  open: boolean
  onResolve: (confirmed: boolean | 'alt') => void
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
  // the filled answer always stands LAST: on the right, where the thumb expects the primary – and
  // with three answers and the safe one the alt («Zur Tafel», «Raus melden»), on a row of its own
  // under the other two, full width, on every device (owner pick «Trupps noch drin» mock 4,
  // 06.11.2026; `.confirm-card-safe` in 08-toasts). One order everywhere: the phone's
  // wrap-reverse had put «Abbrechen» alone at the bottom there and «Zur Tafel» at it on a laptop.
  const actions = safeAnswer === 'cancel' ? [confirmBtn, altBtn, cancelBtn]
    : safeAnswer === 'alt' ? [cancelBtn, confirmBtn, altBtn]
    : [cancelBtn, altBtn, confirmBtn]
  const safeRow = safeAnswer === 'alt' && !!altLabel
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
        <Dialog.Popup role="alertdialog" className={`confirm-card ui-dialog${altLabel ? ' confirm-card-three' : ''}${safeRow ? ' confirm-card-safe' : ''}`} initialFocus={safeAnswer === 'alt' && altLabel ? altRef : danger || safeAnswer === 'cancel' ? cancelRef : confirmRef} aria-label={title ?? message}>
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
                : !('onClick' in it)
                  ? <li key={it.head ?? it.text} className="confirm-line">{it.head && <b>{it.head}</b>}{it.head && ' – '}{it.text}</li>
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
