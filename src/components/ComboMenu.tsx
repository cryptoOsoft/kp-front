import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode, type RefCallback } from 'react'
import { createPortal } from 'react-dom'
import { Icon } from '../lib/icons'
import { SearchField } from './SearchField'
import { cx } from '../lib/cx'
import { fillTemplate } from '../lib/format'
import { RankBadge } from './RankBadge'
import { matchesQuery, searchQuery } from '../lib/search'
import { usePopoverGuard } from '../lib/overlays/popoverGuard'
import { visibleViewportBottom } from '../lib/useKeyboardInset'
import { fullViewHeight } from '../lib/iosKeyboard'
import { MIN_MENU_H, placeComboMenu, type MenuPos } from '../lib/comboPlacement'
import c from './ComboMenu.module.css'

/**
 * The tap-to-open picker every roster/value field in the app is made of — the machinery, not
 * the policy. It was hand-rolled twice (the global Combo and the Atemschutz PersonField) and the
 * two copies cross-referenced each other in their comments, which is the shape of duplication
 * that drifts: the maxHeight cap was fixed twice, months apart, and the search row's press wash
 * only ever reached one of them.
 *
 * The admin `Select` (admin/ui.tsx) deliberately stays out: it is keyboard-driven with
 * active-descendant navigation and is not portalled, so adopting this machinery would cost it
 * that. It is not a forgotten third call site.
 *
 * What lives here: open/search state, the portalled menu and where it is put, dismissal,
 * the search row, the «nur Offiziere» row, the free-type escape and the empty row.
 * What does NOT: the trigger, and what an entry means. `Combo` (plain strings) and
 * `PersonField` (a person + their id) are thin policy layers on top — they own their own field
 * markup, because a 13px control on --fill-soft in a detail panel and a 15px control on
 * --surface in a modal are two skins, not one control pretending to be two.
 */

/** The bottom a DOWN menu may not pass, or null: the screen alone decides (lib/comboPlacement).
 *  Only a MODAL frame bounds it — a Sheet / Overlay popup (Base UI's open dialog), where the
 *  nearest clipping ancestor is the sheet's `.ip-body` and a menu run past it spills into the
 *  backdrop (05.09.2026). A non-modal dock — the `.ctx` detail panel over the map, a tool dock,
 *  a page — clips its content too, but under it is the working map, and `.ctx` sizes to its
 *  content: measured against ITS body, a short Fahrzeug panel opened «Bezeichnung» upward or as
 *  a 140px sliver with the screen free below (owner, 05.11.2026). */
function frameBottom(el: HTMLElement): number | null {
  const frame = el.closest('[role="dialog"][data-open], [role="alertdialog"][data-open]')
  if (!frame) return null
  let node = el.parentElement
  while (node && node !== frame.parentElement) {
    const oy = getComputedStyle(node).overflowY
    if (oy === 'auto' || oy === 'scroll' || oy === 'hidden' || oy === 'clip') return node.getBoundingClientRect().bottom
    node = node.parentElement
  }
  return null
}

/** The phone's full-width bars at the screen's foot: the nav bar and a page's docked tab strip
 *  (15-mobile · `--float-bars`). */
const BOTTOM_BARS = '.navrail, .rp-tabs'

/** The top of those bars, or null where none lies across the foot (lib/comboPlacement ·
 *  `barsTop`). The tablet's nav rail matches the selector too, but it stands upright beside the
 *  content, so only a box wider than tall that ends in the screen's lower quarter counts. */
function barsTop(): number | null {
  let top: number | null = null
  for (const el of document.querySelectorAll(BOTTOM_BARS)) {
    const r = el.getBoundingClientRect()
    if (r.width <= r.height || r.bottom < window.innerHeight * 0.75) continue
    top = Math.min(top ?? Infinity, r.top)
  }
  return top
}

export interface ComboMenuState {
  open: boolean
  search: string
  setSearch: (v: string) => void
  officersOnly: boolean
  setOfficersOnly: (v: boolean) => void
  pos: MenuPos | null
  /** open ⇄ closed, from a tap on the trigger */
  toggle: () => void
  /** close AND forget the search — a menu that reopens still holding last time's search would
   *  look like a roster with people missing from it, which is the one way this control can lie */
  close: () => void
}

/**
 * The three elements the machinery has to reach, as CALLBACK refs: a policy layer ATTACHES them
 * (`ref={pickRef}`) and never reads them, so the hook hands back no `.current` at all.
 *
 * ⚠️ They come back beside the state rather than inside it, and the call site destructures them
 * on the spot. An object that holds a ref is a ref as far as react-hooks/refs is concerned, and
 * every later `combo.open` off it then reads as a render-time ref access — two dozen warnings
 * for something nobody is doing.
 */
export interface ComboMenuRefs {
  rootRef: RefCallback<HTMLDivElement>
  /** the trigger the menu is measured against — placed off ITS rect, not the root's */
  pickRef: RefCallback<HTMLButtonElement>
  /** the portalled <ul>; it counts as "inside" for the outside-tap close although it is not a
   *  DOM descendant of the field */
  menuRef: RefCallback<HTMLUListElement>
}

/**
 * All of the picker's state and every effect that keeps the portalled menu where it belongs.
 *
 * @param openTick imperative open: bump the number and the menu opens as if the trigger had
 *   been tapped. The Fahrzeug header title falls through to its «Bezeichnung» field this way
 *   (ContextPanel).
 */
export function useComboMenu(openTick?: number): [ComboMenuState, ComboMenuRefs] {
  const [open, setOpen] = useState(false)
  // Narrowing by typing — and, wherever `custom` is set, the free-text entry itself: the search
  // row IS the name field, and its query commits through the «‹X› verwenden» row. A 66-person
  // Mannschaft in a short menu is a handful of visible rows, so
  // finding somebody meant scrolling past sixty names with a gloved finger — the one complaint
  // about this picker after the 08.08. Einsatz. NOT auto-focused: this stays a tap-to-pick
  // control, and a keyboard that opens by itself covers the very list it is filtering.
  const [search, setSearch] = useState('')
  const [officersOnly, setOfficersOnly] = useState(false)
  const [pos, setPos] = useState<MenuPos | null>(null)
  const root = useRef<HTMLDivElement | null>(null)
  const pick = useRef<HTMLButtonElement | null>(null)
  const menu = useRef<HTMLUListElement | null>(null)
  // stable identities, or React would detach and re-attach every element on every render
  const rootRef = useCallback((el: HTMLDivElement | null) => { root.current = el }, [])
  const pickRef = useCallback((el: HTMLButtonElement | null) => { pick.current = el }, [])
  const menuRef = useCallback((el: HTMLUListElement | null) => { menu.current = el }, [])

  // opened from OUTSIDE (openTick): same entry as a tap on the trigger
  useEffect(() => { if (openTick) { setSearch(''); setOpen(true) } }, [openTick])

  // Place the portalled menu under (or above, near the screen's bottom) the trigger. The menu is
  // portalled to <body> precisely so the scrolling sheet / overflow-hidden panel the field sits
  // in cannot clip it — fatal on a phone, where the lower fields sit right at the scroll edge.
  useEffect(() => {
    if (!open) return
    const place = () => {
      const el = pick.current
      if (!el) return
      // The VISIBLE screen, not the layout viewport: the OS keyboard shrinks only the former,
      // and a menu measured against `window.innerHeight` kept opening downward INTO the keyboard
      // — the operator saw a search row and nothing else (Feldtest 08.09., «man sieht nix
      // mehr»). visibleViewportBottom() also reads the VirtualKeyboard API, because on Android
      // (`overlays-content`) NEITHER viewport shrinks and the visual viewport alone lies.
      setPos(placeComboMenu({
        trigger: el.getBoundingClientRect(),
        visTop: window.visualViewport?.offsetTop ?? 0,
        visBottom: visibleViewportBottom(),
        viewH: fullViewHeight(),
        frameBottom: frameBottom(el),
        barsTop: barsTop(),
        viewW: document.documentElement.clientWidth,
      }))
    }
    place()
    window.addEventListener('scroll', place, true)
    window.addEventListener('resize', place)
    // the keyboard rising/falling fires only visualViewport events on iOS — and on Android
    // (`overlays-content`) only VirtualKeyboard geometrychange — without these the menu is
    // placed once and never learns the screen just lost its bottom 40%
    const vv = window.visualViewport
    const vk = (navigator as Navigator & { virtualKeyboard?: EventTarget }).virtualKeyboard
    vv?.addEventListener('resize', place)
    vv?.addEventListener('scroll', place)
    vk?.addEventListener('geometrychange', place)
    return () => {
      window.removeEventListener('scroll', place, true)
      window.removeEventListener('resize', place)
      vv?.removeEventListener('resize', place)
      vv?.removeEventListener('scroll', place)
      vk?.removeEventListener('geometrychange', place)
    }
  }, [open])

  // close on an outside tap — counting BOTH the trigger and the portalled menu as "inside".
  // 'pointerdown', not 'mousedown': touch synthesizes mousedown late or not at all, so tapping
  // outside would not reliably close the menu.
  useEffect(() => {
    if (!open) return
    const onDown = (e: PointerEvent) => {
      const t = e.target as Node
      if (!root.current?.contains(t) && !menu.current?.contains(t)) { setOpen(false); setSearch('') }
    }
    document.addEventListener('pointerdown', onDown)
    return () => document.removeEventListener('pointerdown', onDown)
  }, [open])

  // ⚠️ ESCAPE IS OURS WHILE WE ARE OPEN. This menu is portalled to <body>, so a sheet's Escape
  // handler (Base UI's, on the document) saw the key too and closed the whole «Material erfassen»
  // modal when the operator only wanted the dropdown away. Capture phase + stopPropagation takes
  // the key before it can travel; `popoverGuard` below covers the outside-TAP half, where the
  // dismissing click reaches the dialog a task later and there is nothing left to test for.
  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return
      e.stopPropagation()
      e.preventDefault()
      setOpen(false)
      setSearch('')
    }
    document.addEventListener('keydown', onKey, true)
    return () => document.removeEventListener('keydown', onKey, true)
  }, [open])

  // the sheet this picker sits in stands down while the menu is open — one gesture, one close
  usePopoverGuard(open)

  const close = () => { setOpen(false); setSearch('') }
  return [{
    open, search, setSearch, officersOnly, setOfficersOnly, pos,
    toggle: () => { if (open) close(); else { setSearch(''); setOpen(true) } },
    close,
  }, { rootRef, pickRef, menuRef }]
}

/** The skin. Two exist: global `.combo-*` (styles/06-contextpanel.css) and the Atemschutz
 *  module. Everything the two had in common is in ComboMenu.module.css instead and is not
 *  named here. */
export interface ComboMenuClasses {
  menu: string
  /** the fixed-position + z-index override the portal needs — see the style note on the <ul> */
  menuPortal: string
  opt: string
  /** modifier for the option that IS the current value (the roster picker marks none) */
  optOn?: string
  toggle: string
  toggleOn: string
  type: string
  empty: string
  group?: string
  groupHead?: string
}

/** One row of the menu. `value` is what `onPick` hands back, so a picker over plain strings and
 *  one over `{ name, personId }` are the same control with a different V. */
export interface ComboEntry<V> {
  key: string
  /** what the search matches on, and the row's visible text */
  label: string
  value: V
  selected?: boolean
  /** marks BEFORE the name — the presence dot, the Dienstgrad chip (<ComboRank>), «Gast» */
  lead?: ReactNode
  /** a soft note AFTER the name — «unter AS», «schon: Einsatzleiter», «nicht anwesend».
   *  A hint, never a block: the operator decides, they just should not have to pick first and
   *  find out afterwards, which is what the toast this replaced did. */
  note?: ReactNode
}

/** Section headers with their own options, rendered instead of the flat list. */
export interface ComboEntryGroup<V> { label: string; options: ComboEntry<V>[] }

/** The Dienstgrad chip on a picker row — the app's one RankBadge. */
export function ComboRank({ rank }: { rank: string }) {
  return <RankBadge rank={rank} />
}

export function ComboMenu<V>({ state, menuRef, classes, copy, entries, groups, showSearch, limit, toggle, custom, onPick }: {
  state: ComboMenuState
  /** from `useComboMenu`'s refs — the <ul> the outside-tap close has to count as inside */
  menuRef: RefCallback<HTMLUListElement>
  classes: ComboMenuClasses
  /** every string this menu shows — passed in, because the two skins draw their words from
   *  different copy namespaces (appConfig.copy.combo vs copy.atemschutz) */
  copy: { search: string; empty: string; noMatches: string }
  entries: ComboEntry<V>[]
  groups?: ComboEntryGroup<V>[]
  /** below ~8 rows the whole list is on screen anyway and a search box is one more control
   *  between the finger and the name it came for. The two skins count different things (one the
   *  raw options, one the already-filtered ones), so the caller decides. */
  showSearch: boolean
  /** cap the rendered rows (the roster stops at 60); the empty row still counts every match */
  limit?: number
  /** the «nur Offiziere» row. Present only where it can select something: without Dienstgrade a
   *  filter whose single outcome is «keine Einträge» is worse than no filter. */
  toggle?: { label: string }
  /** The free-type escape — the Gast door (Feldtest Manuel, 07.09.): the search row IS the type
   *  field, and a query-carrying «‹X› verwenden» row commits it directly. Exactly the motion
   *  «‹Name› als Gast hinzufügen» makes on the Trupp picker.
   *  ⚠️ There is no second shape of this any more (11.09.). It used to be optional — a static
   *  «Name eingeben …» row that swapped the whole control for a bare input, which meant two taps,
   *  a retype, a mode the operator could get stuck in, and a commit-on-blur race. The typed value
   *  is the caller's to take, which is why `commit` is theirs. */
  custom?: { template: string; commit: (typed: string) => void }
  onPick: (value: V) => void
}) {
  // one shared idea of what a query finds (lib/search): umlauts either way, one typo forgiven
  const needle = useMemo(() => searchQuery(state.search), [state.search])
  const match = (e: ComboEntry<V>) => !needle || matchesQuery(needle, e.label)
  const listed = entries.filter(match)
  const anyHit = groups ? groups.some((g) => g.options.some(match)) : listed.length > 0

  // Gast mode: the typed query, and the search row it needs even on a three-option list —
  // hidden behind the >8 threshold there would be nowhere to type the custom value at all.
  const typed = custom ? state.search.trim() : ''
  const searchShown = showSearch || !!custom
  const commitTyped = () => {
    if (!custom || !typed) return
    custom.commit(typed)
    state.close()
  }

  const row = (e: ComboEntry<V>) => (
    <li key={e.key}>
      <button type="button" className={cx(classes.opt, e.selected && classes.optOn)}
        onClick={() => { onPick(e.value); state.close() }}>
        {e.lead}
        <span className={c.name}>{e.label}</span>
        {e.note}
      </button>
    </li>
  )

  if (!state.open || !state.pos) return null
  const { pos } = state
  return createPortal(
    <ul ref={menuRef} className={cx(classes.menu, classes.menuPortal)} role="listbox"
      // ⚠️ up-mode must NEUTRALISE the base class's `top: calc(100% + 4px)` — under
      // position:fixed that is viewport-bottom + 4, which (together with the inline `bottom`)
      // stretched the menu into a 0-height sliver OFF-screen whenever the trigger sat low.
      // That is the phone bottom sheet's "the dropdown does nothing".
      // `footInset`: the room ran to the screen's foot, so the home indicator's band comes off
      // it — still never below the floor a down menu is allowed (lib/comboPlacement)
      style={{ left: pos.left, width: pos.width,
        maxHeight: pos.footInset ? `max(${MIN_MENU_H}px, calc(${pos.maxH}px - env(safe-area-inset-bottom)))` : pos.maxH,
        ...(pos.up ? { top: 'auto', bottom: fullViewHeight() - pos.top + 4 } : { top: pos.top + 4 }) }}>
      {searchShown && (
        <li className={c.searchRow}>
          <SearchField
            className={c.search} value={state.search} inputMode="search"
            placeholder={copy.search} aria-label={copy.search}
            onChange={state.setSearch}
            // a stray Enter in a picker must not submit the form the picker sits in — but in
            // Gast mode an Enter on a query nothing matches IS the commit (mirrors TruppTeam)
            onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); if (!anyHit) commitTyped() } }}
          />
        </li>
      )}
      {toggle && (
        <li>
          <button type="button" className={cx(classes.opt, classes.toggle, state.officersOnly && classes.toggleOn)}
            aria-pressed={state.officersOnly} onMouseDown={(e) => e.preventDefault()}
            onClick={() => state.setOfficersOnly(!state.officersOnly)}>
            {state.officersOnly && <Icon id="check" />}<span>{toggle.label}</span>
          </button>
        </li>
      )}
      {groups
        // a group with no match under the query draws nothing — its head alone read as a list of
        // empty sections above the «no hits» line (29.09.2026)
        ? groups.filter((g) => g.options.some(match)).map((g) => (
          <li key={g.label} className={classes.group}>
            <div className={classes.groupHead}>{g.label}</div>
            <ul>{g.options.filter(match).map(row)}</ul>
          </li>
        ))
        : (limit ? listed.slice(0, limit) : listed).map(row)}
      {/* a search that came back empty is the app's one «no hits» line (`.no-hits`, 29.09.2026);
          `copy.noMatches` is a «{q}» template */}
      {!anyHit && (needle
        ? <li className="no-hits">{fillTemplate(copy.noMatches, { q: state.search.trim() })}</li>
        : <li className={classes.empty}>{copy.empty}</li>)}
      {/* The free-type door, LAST under the matches like the Gast row on the Trupp picker: it
          exists only while something is typed and carries the query in its own label, so the row
          states what pressing it will do instead of opening a second field to say it again. */}
      {custom && typed && (
        <li>
          <button type="button" className={cx(classes.opt, classes.type)} onClick={commitTyped}>
            <Icon id="type" /><span>{fillTemplate(custom.template, { name: typed })}</span>
          </button>
        </li>
      )}
    </ul>,
    document.body,
  )
}
