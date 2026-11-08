import { useCallback, useEffect, useRef, useState, type RefObject, type ReactElement, type ReactNode } from 'react'
import { Menu as BaseMenu } from '@base-ui/react/menu'
import { usePopoverGuard } from './popoverGuard'
import { attachMenuSlide } from './menuSlide'

/**
 * Anchored action menu — wraps Base UI's Menu. Base UI's Positioner does the
 * collision-aware anchoring (auto flip-up near a viewport edge) that surfaces hand-roll today,
 * and adds real keyboard nav (↑/↓, typeahead, Home/End, Esc) + focus management for free.
 * On touch a finger slides through the rows the iOS way — highlight under the finger, lift to
 * press (`menuSlide`; a scrolling menu keeps its native scroll).
 *
 * The trigger keeps its own element/classes via `render`; Base UI wires aria-haspopup/expanded
 * and a `data-popup-open` attribute onto it (style the open trigger with `[data-popup-open]`).
 *
 * ⚠️ STACKING BELONGS ON THE POSITIONER, never on the popup. Base UI portals the popup to
 * <body> inside a Positioner it moves with a `transform` — and a transform makes that positioner
 * its own stacking context, so any `z-index` a caller puts on `popupClassName` is trapped inside
 * it and does nothing at all. That is not theory: on v0.6.0 every row action in the admin
 * (Bearbeiten, Rolle ändern, Deaktivieren, PIN zurücksetzen) opened INVISIBLE and unclickable
 * behind `.adm` (position:fixed, z-index:100), because `.adm-menu-portal { z-index: 1200 }` sat
 * on the popup. So the positioner carries a stable class — `.ui-menu-pos` — and the app's
 * stylesheet owns the one z-index (sibling to ContextMenu's `.ui-ctxmenu-pos`).
 */
/** A checkbox row INSIDE the menu — for settings you want to flip without leaving it. Base UI
 *  keeps the menu open on a checkbox click, which is the whole point: «what goes on the paper»
 *  is several decisions in a row, and a menu that closes after each one is a menu you reopen. */
export interface MenuCheckItem {
  kind: 'check'
  label: ReactNode
  checked: boolean
  onChange: (checked: boolean) => void
  disabled?: boolean
}

/** A one-of-N choice INSIDE the menu — a way of LOOKING at something, not a setting to flip.
 *  Unlike the checkbox rows it closes on pick: there is exactly one answer, so staying open would
 *  leave a menu over the thing whose arrangement was just changed. Real radio semantics rather
 *  than a column of checkboxes with one ticked, so it is announced as the single choice it is.
 *  It LOOKS like one too (r35, 06.11.2026): the label, then a trailing ✓ on the chosen row – the
 *  Einsatzuhr's and «Seite wählen»'s mark – never the checkbox square the multi-pick rows wear. */
export interface MenuRadioGroup<T extends string = string> {
  kind: 'radio'
  value: T
  onChange: (value: T) => void
  options: { value: T; label: ReactNode; disabled?: boolean }[]
}

/** A rule between groups of items. */
export interface MenuSeparator { kind: 'sep' }

/** A group label. A menu that mixes an action with a block of settings has to say which is
 *  which — a column of ticks under a print button, with nothing naming them, is a menu you have
 *  to experiment with. */
export interface MenuHeading { kind: 'head'; label: ReactNode }

export interface MenuActionItem {
  label: ReactNode
  onClick: () => void
  danger?: boolean
  disabled?: boolean
  /** Pin this row to the BOTTOM of a scrolling menu. For a list that is long AND has a row or two
   *  you nearly always want, the two ends of the scroll fight each other: showing the top hides
   *  the answer, showing the bottom hides the list. A pinned row ends that — it stays put whatever
   *  the list does, and the bottom is the end that works either way, because a menu near the
   *  screen's edge flips its side without telling the caller. Only meaningful on the LAST items. */
  sticky?: boolean
  /** shown as a small reason line under a disabled item (native title never shows when disabled) */
  reason?: ReactNode
}

/**
 * Every row this menu renders wears `ui-menu-item` on top of whatever skin the caller paints
 * (`itemClassName`). That class — and `ui-menu-danger` for the destructive row — is where the
 * app's ONE menu-row treatment lives: the hover wash, the `--press` wash and the row radius
 * (13-incident.css · «ONE menu row»).
 *
 * ⚠️ It is added HERE rather than asked of the four call-site skins, because that is exactly what
 * went wrong: `.rp-print-menu-item`, `.de-menu-item`, `SurfaceControls .menuItem` and
 * `.adm-menu-item` are one control wearing four coats, and they had drifted into three hover
 * colours, one press wash between them and a button's radius on a row. A skin still owns its
 * padding, its type and its icons — it no longer owns what a press looks like.
 */
function rowClass(skin: string | undefined, danger?: boolean, sticky?: boolean) {
  return ['ui-menu-item', danger && 'ui-menu-danger', sticky && 'ui-menu-sticky', skin]
    .filter(Boolean).join(' ')
}

export function Menu({ trigger, items, popupClassName, itemClassName, reasonClassName, side = 'bottom', align = 'end', sideOffset = 4, alignOffset = 0, collisionPadding = 10, scrollToEnd = false, modal = true, keepFocusRef }: {
  trigger: ReactElement
  items: (MenuActionItem | MenuCheckItem | MenuSeparator | MenuHeading | MenuRadioGroup)[]
  popupClassName?: string
  /** class for each item; receives whether the item is `danger`. */
  itemClassName?: (danger: boolean) => string
  reasonClassName?: string
  side?: 'top' | 'bottom' | 'left' | 'right'
  align?: 'start' | 'center' | 'end'
  sideOffset?: number
  /** Shift along the alignment axis. For a menu whose rows repeat an icon the TRIGGER
   *  also shows, this is what lets the two line up: the popup's own padding otherwise
   *  pushes its first column right of the control it came from, which reads as an
   *  alignment mistake even to someone who could not say what is off. */
  alignOffset?: number
  /** Open a scrollable menu at its END rather than its start. For a list whose most-used
   *  rows sit last — because it opens upwards and the nearest row to the trigger is the
   *  one being reached for — showing the top means the answer is below the fold, which is
   *  worse than not having ordered it at all. */
  scrollToEnd?: boolean
  /** Keep-off distance from the viewport edge. Without it a wide menu on a control near the right
   *  edge is positioned flush to that edge and can render half off screen — which is exactly what
   *  the Rapport's print menu did on a tablet. Applies to every Menu in the app on purpose: this
   *  is a property of the surface being finite, not of any one call site. */
  collisionPadding?: number
  /** ⚠️ OPT-IN non-modal — leave it at the default unless you know what lies UNDER the menu.
   *  Modal (the default) makes Base UI render an invisible full-screen backdrop the instant the
   *  menu opens, and that backdrop — not the popup — is what an «outside» tap hits: it dismisses
   *  the menu AND swallows the tap. The swallowing is a FEATURE nearly everywhere: these menus
   *  float over the live map (the Trupp menus on MapMarkers / DrawEditor / Whiteboard), where a
   *  pass-through tap reaches onMapClick and can deselect a Trupp, drop a vertex into a selected
   *  line or place a symbol with a tool armed — and over lists, where it presses whichever row
   *  button the finger landed on.
   *  Pass `false` only where switching between two adjacent triggers in ONE tap is worth more
   *  than that protection and nothing underneath acts on a stray tap — today: the two Anwesenheit
   *  filter-bar menus. The dismiss itself (Base UI's useDismiss) and Esc work either way. */
  modal?: boolean
  /** Pointer picks can keep a mobile composer's caret and keyboard in place. */
  keepFocusRef?: RefObject<HTMLElement | null>
}) {
  // A menu opened from inside a Sheet/Overlay must be the ONLY thing the dismissing tap or the
  // first Esc closes — the sheet stands down while this is open (see popoverGuard).
  const [open, setOpen] = useState(false)
  usePopoverGuard(open)
  const keepFocus = useRef(false)
  useEffect(() => {
    if (!open || !keepFocusRef) return
    // A pointer-opened menu may next be reached with Tab/arrow keys from the retained field
    // or trigger. Release before Base UI moves focus into the portalled popup.
    const release = (e: KeyboardEvent) => {
      if (e.key === 'Tab' || e.target !== keepFocusRef.current) keepFocus.current = false
    }
    document.addEventListener('keydown', release, true)
    return () => document.removeEventListener('keydown', release, true)
  }, [open, keepFocusRef])

  // The popup's one ref: open at the END (scrollToEnd) and the finger's slide-to-highlight
  // (menuSlide — not on a menu that keeps a field's focus, whose focus redirect would fight it).
  // ⚠️ rAF as well as the immediate set: the popup attaches before its own rows have wrapped to
  // their final heights, so a scrollTop written at that moment lands short.
  const slide = !keepFocusRef
  const popupRef = useCallback((el: HTMLDivElement | null) => {
    if (!el) return
    if (scrollToEnd) {
      const toEnd = () => { el.scrollTop = el.scrollHeight }
      toEnd()
      requestAnimationFrame(toEnd)
    }
    return slide ? attachMenuSlide(el) : undefined
  }, [scrollToEnd, slide])

  const renderItem = (it: MenuActionItem | MenuCheckItem | MenuRadioGroup, key: number) => {
    if ('kind' in it && it.kind === 'radio') {
      return (
        <BaseMenu.RadioGroup key={key} value={it.value} onValueChange={(v) => it.onChange(String(v))}>
          {it.options.map((o) => (
            <BaseMenu.RadioItem
              key={o.value}
              value={o.value}
              disabled={o.disabled}
              className={rowClass(itemClassName?.(false))}
            >
              {o.label}
              <BaseMenu.RadioItemIndicator className="ui-menu-radio" keepMounted>
                <svg viewBox="0 0 24 24" aria-hidden><path d="M5 13l4 4L19 7" /></svg>
              </BaseMenu.RadioItemIndicator>
            </BaseMenu.RadioItem>
          ))}
        </BaseMenu.RadioGroup>
      )
    }
    // `'kind' in it` alone: at this point the union is check|action and only the checkbox row
    // carries a `kind`, so the compound guard the old inline switch needed would leave TS unable
    // to narrow the fall-through to MenuActionItem.
    if ('kind' in it) {
      return (
        <BaseMenu.CheckboxItem
          key={key}
          className={rowClass(itemClassName?.(false))}
          checked={it.checked}
          disabled={it.disabled}
          onCheckedChange={it.onChange}
          closeOnClick={false}
        >
          <BaseMenu.CheckboxItemIndicator className="ui-menu-check" keepMounted>
            <svg viewBox="0 0 24 24" aria-hidden><path d="M5 13l4 4L19 7" /></svg>
          </BaseMenu.CheckboxItemIndicator>
          {it.label}
        </BaseMenu.CheckboxItem>
      )
    }
    return (
      <BaseMenu.Item
        key={key}
        className={rowClass(itemClassName?.(!!it.danger), it.danger, it.sticky)}
        disabled={it.disabled}
        onClick={it.onClick}
      >
        {it.label}
        {it.disabled && it.reason != null && <span className={reasonClassName}>{it.reason}</span>}
      </BaseMenu.Item>
    )
  }

  // A heading OPENS A GROUP, it is not a row that happens to look like one. Base UI's GroupLabel
  // reads the id it has to announce out of the group's context and THROWS when there is none
  // («MenuGroupContext is missing») — a bare label crashed the whole app the moment the print
  // menu was opened. Grouping it properly is also the only version worth anything: the label is
  // what a screen reader announces for every row under it, so «Abschnitte» has to OWN the ticks
  // rather than merely precede them.
  // A rule does NOT close a group — it divides one. «Abschnitte» names nine sections that come in
  // three runs, and a group that ended at the first rule would leave six of them unnamed again,
  // which is the thing the heading was added to fix. Only the next heading closes a group; rows
  // before the first heading stay ungrouped, which is what an unlabelled block is.
  type Row = { it: MenuActionItem | MenuCheckItem | MenuRadioGroup; key: number } | { sep: true; key: number }
  const blocks: { label?: ReactNode; rows: Row[] }[] = []
  items.forEach((it, i) => {
    if ('kind' in it && it.kind === 'head') { blocks.push({ label: it.label, rows: [] }); return }
    if (!blocks.length) blocks.push({ rows: [] })
    blocks[blocks.length - 1].rows.push('kind' in it && it.kind === 'sep' ? { sep: true, key: i } : { it, key: i })
  })
  const renderRow = (r: Row) =>
    'sep' in r ? <BaseMenu.Separator key={r.key} className="ui-menu-sep" /> : renderItem(r.it, r.key)

  return (
    // MODAL by default — the backdrop that swallows the dismissing tap is what keeps that tap off
    // the map / the list underneath. Only the callers that ask for it go non-modal (see `modal`).
    <BaseMenu.Root modal={modal} onOpenChange={(next) => { if (next) keepFocus.current = !!keepFocusRef?.current && document.activeElement === keepFocusRef.current; setOpen(next) }}>
      <BaseMenu.Trigger render={trigger} />
      <BaseMenu.Portal>
        <BaseMenu.Positioner className="ui-menu-pos" side={side} align={align} sideOffset={sideOffset} alignOffset={alignOffset} collisionPadding={collisionPadding}>
          <BaseMenu.Popup
            finalFocus={() => keepFocus.current ? keepFocusRef?.current : true}
            onFocusCapture={() => { if (keepFocus.current) keepFocusRef?.current?.focus({ preventScroll: true }) }}
            onMouseDownCapture={(e) => { if (keepFocus.current) e.preventDefault() }}
            onKeyDownCapture={() => { keepFocus.current = false }}
            // `ui-pop` is the exit hook: 13-incident.css fades every [data-ending-style] popup out
            className={popupClassName ? `ui-pop ${popupClassName}` : 'ui-pop'}
            ref={popupRef}
          >
            {blocks.map((b, i) => (
              // no label = nothing to associate, so no wrapper either — an extra div around the
              // rows would only add a box for the popup's own layout to reason about
              b.label == null
                ? b.rows.map(renderRow)
                : (
                  <BaseMenu.Group key={`g${i}`}>
                    <BaseMenu.GroupLabel className="ui-menu-head">{b.label}</BaseMenu.GroupLabel>
                    {b.rows.map(renderRow)}
                  </BaseMenu.Group>
                )
            ))}
          </BaseMenu.Popup>
        </BaseMenu.Positioner>
      </BaseMenu.Portal>
    </BaseMenu.Root>
  )
}
