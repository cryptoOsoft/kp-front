import { useCallback, useEffect, useLayoutEffect, useReducer, useRef, useState, type CSSProperties, type KeyboardEvent, type PointerEvent as ReactPointerEvent, type RefObject } from 'react'
import { clearDraft, keepDraft, readDraft } from '../lib/draftKeep'
import { useMediaQuery } from '../lib/useIsPhone'
import { appConfig } from '../config/appConfig'
import { getLocaleId } from '../config/copy'
import { Icon } from '../lib/icons'
import { cx } from '../lib/cx'
import { fillTemplate, hhmm, pad2 } from '../lib/format'
import { newId } from '../lib/ids'
import { serverNow } from '../lib/serverClock'
import {
  colMinScale, editableColumns, labelText, problemColumns, shownColumns, shownFixedRows, shownSections, tableAddsRows, writtenColumns,
  type Label, type QuadSection, type TableSection, type TemplateColumn, type TextSection,
} from '../lib/boardTemplate'
import {
  boxLines, dropLine, dropRow, moveLine, moveRow, nextTrend, normalizeTime, pageStamp, putField, putHead, putLine, putRow, tableRows, writtenRows,
  type BoardFormData, type EntrySource, type FormHead,
} from '../lib/boardForm'
import { NEW, navTarget, type NavAt, type NavKey, type NavSection } from '../lib/boardFormNav'
import { Button, IconButton } from './Button'
import { TickRow } from './TickRow'
import { WheelPopover } from './WheelPicker'
import { Menu } from '../lib/overlays'
import { BoardSignature } from './BoardSignature'
import { ShellLoader } from './ShellLoader'
import MiniKarte, { type MiniKarteProps } from './MiniKarte'
import s from './TafelFormPage.module.css'

/**
 * A Tafel PAGE (10.10.2026): one board-template page as a form, laid out like the paper it comes
 * from — the FKS «Erste Führung» poster in two columns, the Handbuch sheets as they are printed.
 * The model, persistence and undo are lib/boardForm; the keyboard is lib/boardFormNav.
 *
 * Every cell commits ONCE — on blur, Enter or Tab — so an edit is one ↶ step, never one per
 * keystroke (the note's rule). Esc puts the stored value back (a second Esc lets go). The trailing
 * empty row of every list carries a pre-minted id, so the row it becomes on its first commit is
 * the same element and focus stays where Tab sent it.
 *
 * ⚠️ A cell writes only what the operator CHANGED since it took the focus (review of #338): a
 * focused cell that was merely passed through never writes its old text back over what another
 * device wrote meanwhile, and while it is untouched it follows the remote change. Typing is never
 * lost: it is written when the cell unmounts, when the page is hidden or closed — and when the
 * Einsatz turned read-only under it (closed elsewhere) it is KEPT on this device (lib/draftKeep)
 * rather than written into a closed record, and offered again once the page is writable.
 *
 * ⚠️ Every box drawn is a box one can write in (owner, round 2): a table's ruled empty rows are
 * live rows, each with its own pre-minted id, and the rows written under a fixed list (the
 * Abspracherapport) type the pre-printed text columns too.
 *
 * DOM order is the template's order, row-major — the Tab order and the iOS ↑↓ bar follow it.
 * Pre-printed cells of a fixed row (Signatur, Bezeichnung, the Traktanden) are text, not inputs, so
 * neither stops on them.
 *
 * A written row (and a problem line) is deleted by the bin at its end, shown while one stands in
 * the row (05.11.2026, owner pick 7A) – one ↶ step, and the caller's toast says what went
 * (`onChange`'s `act`). A problem section draws a VIEW (lib/problemLink · problemView): an entry
 * from the checklist (`src: 'checklist'`) wears the checklist icon and keeps the checklist's words
 * (read-only, like a pre-printed cell); an `area` column is a Bereich menu.
 */

const T = () => appConfig.copy.tafel
/** a cell holds a line of the paper, not a report (re-review of #338): what is longer belongs in
 *  the Verlauf. The print copes with any length now — the cap is the calm hint that says so. */
export const CELL_MAX = 2000
const ARROW: Record<string, string> = { up: '➚', same: '=', down: '➘' }

/** what a cell is in the form (and what it writes) */
type Addr =
  | { kind: 'line'; sec: string; box: string; row: string }
  | { kind: 'tag'; sec: string; box: string; row: string }
  | { kind: 'cell'; sec: string; row: string; col: string }
  | { kind: 'field'; sec: string; col: string }
  | { kind: 'head'; col: keyof FormHead }

/** how many pre-printed rows a table shows (they lead `tableRows`) */
const shownFixedCount = (sec: TableSection) => shownFixedRows(sec).length

const HEAD_SEC = '__head'
const HEAD_KEYS: (keyof FormHead)[] = ['title', 'address', 'alarm', 'el']
const keyOf = (sec: string, box: string | undefined, row: string | undefined, col: string | undefined) => `${sec}|${box ?? ''}|${row ?? ''}|${col ?? ''}`
const navAtOf = (a: Addr): NavAt => a.kind === 'line' ? { sec: a.sec, box: a.box, row: a.row }
  : a.kind === 'tag' ? { sec: a.sec, box: a.box, row: a.row, col: 'tag' }
  : a.kind === 'cell' ? { sec: a.sec, row: a.row, col: a.col }
    : a.kind === 'field' ? { sec: a.sec, col: a.col } : { sec: HEAD_SEC, col: a.col }

/** a press on a field must not start a pan or a selection on anything under it */
const keep = (e: { stopPropagation: () => void }) => e.stopPropagation()

interface CellProps {
  k: string
  /** the NEW alias of a trailing row's cell — what a «next empty row» target resolves to */
  kn?: string
  value: string
  label: string
  readOnly: boolean
  time?: boolean
  placeholder?: string
  className?: string
  last?: boolean
  /** where a draft the read-only Einsatz could not take is kept on this device (lib/draftKeep) */
  draftKey?: string
  onCommit: (v: string) => void
  /** `changed`: the operator typed in this cell since it took the focus — only then is it written */
  onNav: (key: NavKey, draft: string, changed: boolean) => void
  /** another device wrote THIS cell while it was being typed in, and the typing is now written
   *  over it: last writer wins as before, but it is said (re-review of #338) — `theirs` is what
   *  stood, `mine` what replaces it */
  onClash?: (theirs: string, mine: string) => void
  /** Alt+↑ / Alt+↓ (⌥ on a Mac): move this cell's entry up / down — with what was typed */
  onMove?: (dir: -1 | 1, draft: string, changed: boolean) => void
}

/** One cell: an auto-growing textarea that commits once (see the file header for the keys). */
function Cell({ k, kn, value, label, readOnly, time = false, placeholder, className, last = false, draftKey, onCommit, onNav, onClash, onMove }: CellProps) {
  const T0 = T()
  const [draft, setDraft] = useState(() => (draftKey ? readDraft<string | null>(draftKey, null) : null) ?? value)
  /** typed since the focus (or a kept draft came back): the one thing that makes a cell write */
  const dirty = useRef(draft !== value)
  /** the key handler already committed this draft — the blur that follows must not commit again */
  const handled = useRef(false)
  const [focused, setFocused] = useState(false)
  const ref = useRef<HTMLTextAreaElement>(null)
  const coarse = useMediaQuery('(pointer: coarse)')
  /** a time cell under a finger answers with THE time picker (F10, 20.10.2026, owner: «with
   *  keyboard / desktop type, otherwise wheel»): a tap opens the wheels + «Jetzt», and the soft
   *  keyboard stays down (`inputMode="none"`). A hardware keyboard still types into the cell,
   *  and a mouse never sees the wheels — Tab, Enter and «1124» stay the paper-fast path. */
  const wheel = time && coarse && !readOnly
  const [wheelAt, setWheelAt] = useState<DOMRect | null>(null)
  /** the stored value the typing started from — a different one at commit time means another
   *  device wrote this cell meanwhile */
  const base = useRef(value)
  // an untouched cell follows the stored value — a remote change shows up even while focused
  useEffect(() => { if (!dirty.current) { setDraft(value); base.current = value } }, [value])
  // the cell is as tall as its text — re-measured on every render AND whenever its width changes:
  // a line that became an entry gains its grip and trend button, so the same text wraps once
  // more, and a multi-line entry measured only on typing was cut off (owner, 10.10. evening:
  // «allow multi-line entry» — it was there, but its last line disappeared)
  const grow = useCallback(() => {
    const el = ref.current
    if (!el) return
    el.style.height = 'auto'
    el.style.height = `${el.scrollHeight}px`
  }, [])
  useLayoutEffect(grow)
  useEffect(() => {
    const el = ref.current
    if (!el || typeof ResizeObserver === 'undefined') return
    let w = el.clientWidth
    const ro = new ResizeObserver(() => { if (el.clientWidth !== w) { w = el.clientWidth; grow() } })
    ro.observe(el)
    return () => ro.disconnect()
  }, [grow])
  const live = useRef({ draft, value, readOnly, onCommit, onClash })
  useEffect(() => { live.current = { draft, value, readOnly, onCommit, onClash } })
  /** about to write `mine` over the stored value: was that value somebody else's, meanwhile? */
  const clashCheck = (mine: string) => {
    const l = live.current
    if (l.value !== base.current && mine !== l.value) l.onClash?.(l.value, mine)
    base.current = mine
  }
  /** write what was typed, if anything — or keep it on the device while the page is read-only */
  const flush = useCallback(() => {
    const l = live.current
    if (!dirty.current) return
    if (l.draft === l.value) { dirty.current = false; if (draftKey) clearDraft(draftKey); return }
    if (l.readOnly) { if (draftKey) keepDraft(draftKey, l.draft); return }
    dirty.current = false
    if (draftKey) clearDraft(draftKey)
    clashCheck(l.draft)
    l.onCommit(l.draft)
  }, [draftKey])
  // …when the page goes away, the app is hidden, or the cell itself goes
  useEffect(() => {
    const onHide = () => { if (document.visibilityState === 'hidden') flush() }
    document.addEventListener('visibilitychange', onHide)
    window.addEventListener('pagehide', flush)
    return () => {
      document.removeEventListener('visibilitychange', onHide)
      window.removeEventListener('pagehide', flush)
      flush()
    }
  }, [flush])
  // the Einsatz turned read-only under the typing (closed elsewhere): keep it; writable again: offer it
  useEffect(() => {
    if (!draftKey) return
    if (readOnly) { if (dirty.current) keepDraft(draftKey, live.current.draft); return }
    const kept = readDraft<string | null>(draftKey, null)
    if (kept != null && kept !== live.current.value) { dirty.current = true; setDraft(kept) }
  }, [readOnly, draftKey])
  const insertBreak = (el: HTMLTextAreaElement) => {
    const a = el.selectionStart, b = el.selectionEnd
    dirty.current = true
    setDraft((d) => `${d.slice(0, a)}\n${d.slice(b)}`)
    requestAnimationFrame(() => { el.selectionStart = el.selectionEnd = a + 1 })
  }
  const nav = (key: NavKey) => {
    const changed = dirty.current && draft !== value
    if (changed) clashCheck(draft)
    handled.current = true
    dirty.current = false
    if (draftKey) clearDraft(draftKey)
    onNav(key, draft, changed)
  }
  const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    // an IME still composing (Safari reports it as keyCode 229, isComposing false)
    if (e.nativeEvent.isComposing || e.keyCode === 229) return
    if (e.key === 'Enter' && e.altKey) {
      // Alt+Enter is a line break like Shift+Enter (Excel) — a textarea does not do it by itself
      e.preventDefault()
      insertBreak(e.currentTarget)
      return
    }
    if ((e.key === 'ArrowUp' || e.key === 'ArrowDown') && e.altKey && !e.metaKey && !e.ctrlKey && !e.shiftKey && onMove && !readOnly) {
      e.preventDefault()
      const changed = dirty.current && draft !== value
      if (changed) clashCheck(draft)
      dirty.current = false
      if (draftKey) clearDraft(draftKey)
      onMove(e.key === 'ArrowUp' ? -1 : 1, draft, changed)
      return
    }
    if (e.key === 'Enter' && !e.shiftKey && !e.metaKey && !e.ctrlKey) {
      e.preventDefault()
      nav('enter')
      return
    }
    if (e.key === 'Tab' && !e.metaKey && !e.ctrlKey && !e.altKey) {
      e.preventDefault()
      nav(e.shiftKey ? 'shift-tab' : 'tab')
      return
    }
    if (e.key === 'Escape') {
      e.preventDefault()
      e.stopPropagation()
      if (draft !== value) { setDraft(value); dirty.current = false; if (draftKey) clearDraft(draftKey) }
      else e.currentTarget.blur()
    }
  }
  /** what the wheels hand back is written at once — one ↶ step, like a cell left with Enter */
  const commitWheel = (v: string) => {
    setWheelAt(null)
    handled.current = false
    dirty.current = false
    if (draftKey) clearDraft(draftKey)
    setDraft(v)
    if (v === live.current.value) return
    clashCheck(v)
    onCommit(v)
  }
  const wheelInitial = () => {
    const d = new Date()
    const m = /^(\d{2}):(\d{2})$/.exec(normalizeTime(draft))
    if (m) d.setHours(Number(m[1]), Number(m[2]), 0, 0)
    return d
  }
  // a soft keyboard has no Shift/Alt+Enter: on touch the focused cell offers the line break itself.
  // ⚠️ Never in a time cell — its key was hidden, but its 48px reserve stayed, and the 67px
  // «Wann» column was left 11px wide: «--:--» stood one character per line (F10 rework).
  const breakKey = coarse && focused && !readOnly && !time
  return (
    <span className={s.cellWrap}>
      <textarea
        ref={ref}
        rows={1}
        className={cx(s.cell, time && s.time, breakKey && s.cellBreak, className)}
        value={draft}
        readOnly={readOnly}
        aria-label={label}
        placeholder={readOnly ? undefined : placeholder}
        data-k={k}
        data-kn={kn}
        // the phone's return key says what Enter does here: on to the next cell, or done
        enterKeyHint={last ? 'done' : 'next'}
        inputMode={wheel ? 'none' : time ? 'numeric' : undefined}
        aria-haspopup={wheel ? 'dialog' : undefined}
        spellCheck={!time}
        onPointerDown={keep}
        onClick={wheel ? (e) => setWheelAt(e.currentTarget.getBoundingClientRect()) : undefined}
        onFocus={() => { handled.current = false; setFocused(true); if (!dirty.current) base.current = value }}
        onChange={(e) => { handled.current = false; dirty.current = true; setDraft(e.target.value) }}
        onBlur={() => {
          setFocused(false)
          if (handled.current) { handled.current = false; return }
          flush()
        }}
        onKeyDown={onKeyDown}
        maxLength={CELL_MAX}
      />
      {wheelAt && (
        <WheelPopover anchor={wheelAt} initial={wheelInitial()} onClose={() => setWheelAt(null)}
          onCommit={(v) => commitWheel(`${pad2(v.h)}:${pad2(v.mi)}`)}
          onClear={draft ? () => commitWheel('') : undefined} />
      )}
      {focused && draft.length >= CELL_MAX && <span className={s.capHint} role="status">{fillTemplate(T0.cellCap, { n: CELL_MAX })}</span>}
      {breakKey && (
        // keeps the focus (and the keyboard) where it is: the press never reaches the textarea's blur
        <button type="button" className={s.breakKey} aria-label={T0.lineBreak} title={T0.lineBreak}
          onPointerDown={(e) => { e.preventDefault(); e.stopPropagation() }}
          onClick={() => { if (ref.current) insertBreak(ref.current) }}>
          <span aria-hidden="true">↵</span>
        </button>
      )}
    </span>
  )
}

/** a line's Tendenz: the button that cycles it, or — on a locked page (RBAC audit 22.10.2026) —
 *  the arrow as a full-tone read-out, and nothing where none was set (no «·» to tap) */
function TrendButton({ trend, readOnly, onNext }: { trend: string | undefined; readOnly: boolean; onNext: () => void }) {
  const t = T()
  const word = trend === 'up' ? t.trendUp : trend === 'same' ? t.trendSame : trend === 'down' ? t.trendDown : t.trendNone
  if (readOnly) {
    return trend
      ? <span className={cx(s.trend, s.trendRo)} data-trend={trend} role="img" aria-label={word} title={word}>
          <span aria-hidden="true">{ARROW[trend]}</span>
        </span>
      : <span className={s.trendGap} aria-hidden="true" />
  }
  return (
    <IconButton label={fillTemplate(t.trendTitle, { trend: word })} className={s.trend} data-trend={trend ?? 'none'}
      tabIndex={-1} onPointerDown={keep} onClick={onNext}>
      <span aria-hidden="true">{trend ? ARROW[trend] : '·'}</span>
    </IconButton>
  )
}

/** the row's «erledigt»: the shared tick box alone (TickRow, F7 20.10.2026), out of the Tab order
 *  like the trend button — Tab walks the cells. On a locked page a read-out: disabled, but in
 *  full tone (`doneRo`, the `.wb-object:disabled` recipe — RBAC audit 22.10.2026). */
function DoneButton({ on, readOnly, onToggle }: { on: boolean; readOnly: boolean; onToggle: () => void }) {
  const label = T().done
  return (
    <TickRow checked={on} onToggle={onToggle} disabled={readOnly} aria-label={label} title={label} tabIndex={-1}
      className={readOnly ? s.doneRo : undefined} onPointerDown={keep} />
  )
}

/** An entry's bin (owner pick 7A): at the end of the row one stands in. Its press keeps the focus
 *  where it is (the row stays «the focused row» until the click lands – iOS moves no focus to a
 *  button, a mouse would). Out of the Tab order, like the trend button. */
function BinButton({ onRemove }: { onRemove: () => void }) {
  return (
    <IconButton label={T().deleteRow} className={s.bin} tabIndex={-1}
      onPointerDown={(e) => { e.preventDefault(); e.stopPropagation() }} onClick={onRemove}>
      <Icon id="trash" />
    </IconButton>
  )
}

/** «aus der Checkliste» – the small mark in front of a checklist problem's words */
const ChecklistMark = () => (
  <span className={s.ckMark} role="img" aria-label={T().fromChecklist} title={T().fromChecklist}><Icon id="checklist" /></span>
)

/** A problem's Bereich (an `area` column): the station's choices in a menu, «Kein Bereich» to clear */
function AreaPick({ value, options, label, onPick }: { value: string; options: readonly { id: string; label: Label }[]; label: string; onPick: (v: string) => void }) {
  const t = T()
  const word = labelText(options.find((o) => o.id === value)?.label) || value
  return (
    <Menu
      align="start"
      popupClassName="de-menu-pop"
      itemClassName={() => 'de-menu-item'}
      trigger={
        <button type="button" className={cx(s.area, !value && s.areaEmpty)} aria-label={`${label}: ${word || t.areaNone}`} onPointerDown={keep}>
          <span className={s.areaWord}>{word || t.areaPick}</span><Icon id="chevron-down" />
        </button>
      }
      // action rows, not a radio group: a pick closes the menu (a Base UI radio row keeps it open,
      // and the open modal menu then swallows the next tap on the page)
      items={[
        ...options.map((o) => ({
          label: <span className={s.areaItem}>{labelText(o.label)}{o.id === value && <Icon id="check" />}</span>,
          onClick: () => onPick(o.id),
        })),
        ...(value ? [{ label: t.areaNone, onClick: () => onPick('') }] : []),
      ]}
    />
  )
}

/**
 * How many standard rulings each table's leftover height holds, by section id (owner, staging:
 * the Verbindungen beside a grown Abspracherapport had its last row stretched ~240px tall). The
 * leftover is a `[data-fill]` box that takes only the height the grid row gives the table beyond
 * its own rows (flex-basis 0, overflow hidden), so what it holds never feeds back into it; a
 * ruling is as tall as the table's last empty row (the one before the fill — always an empty
 * ruling). No ResizeObserver (jsdom, an old browser): no extra rulings, plain space.
 */
function useFillCounts(root: RefObject<HTMLElement | null>): Record<string, number> {
  const [counts, setCounts] = useState<Record<string, number>>({})
  useLayoutEffect(() => {
    const el = root.current
    if (!el || typeof ResizeObserver === 'undefined') return
    const boxes = [...el.querySelectorAll<HTMLElement>('[data-fill]')]
    const measure = () => {
      const next: Record<string, number> = {}
      for (const f of boxes) {
        const ruling = (f.previousElementSibling as HTMLElement | null)?.offsetHeight || 45
        next[f.dataset.fill ?? ''] = Math.max(0, Math.floor((f.clientHeight + 1) / Math.max(24, ruling)))
      }
      setCounts((c) => (Object.keys(next).length === Object.keys(c).length && Object.entries(next).every(([k, n]) => c[k] === n) ? c : next))
    }
    const ro = new ResizeObserver(measure)
    for (const f of boxes) ro.observe(f)
    measure()
    return () => ro.disconnect()
  })
  return counts
}

/** Focus the cell named `k` (a `data-k` or `data-kn`) once the render that creates it has landed —
 *  a key's target may be a row the very commit it triggered is making. */
function useFocusAfterRender(root: RefObject<HTMLElement | null>): (k: string) => void {
  const want = useRef<string | null>(null)
  const [, bump] = useReducer((n: number) => n + 1, 0)
  useLayoutEffect(() => {
    const k = want.current
    if (!k) return
    const el = root.current?.querySelector<HTMLTextAreaElement>(`[data-k="${CSS.escape(k)}"],[data-kn="${CSS.escape(k)}"]`)
    if (!el) return
    want.current = null
    el.focus()
    const end = el.value.length
    el.setSelectionRange(end, end)
  })
  return useCallback((k: string) => { want.current = k; bump() }, [])
}

/** A deletion by the bin: the entry's words, and whether it came from the checklist. */
export interface TafelAct { removed: string; from?: EntrySource }

export interface TafelFormPageProps {
  /** the page's anno id — the namespace of the drafts this device keeps for it */
  pageKey: string
  /** what the page is called — «Konzept 2» for a second Konzept (lib/boardForm · pageTitles) */
  title?: string
  data: BoardFormData
  readOnly: boolean
  isPhone: boolean
  /** `act`: what an edit that is a DELETION took away (the bin) – the caller's toast names it */
  onChange: (next: BoardFormData, act?: TafelAct) => void
  onRemove: () => void
  /** a cell this device wrote over another device's value for it, typed meanwhile — last writer
   *  wins, and the Verlauf says so (re-review of #338): where, what stands, what it replaced */
  onConflict?: (where: string, kept: string, lost: string) => void
  /** «Drucken» (owner): this page, or `all` of the Tafel's pages, as a PDF (lib/tafelPrint) */
  onPrint?: (all: boolean) => void
  /** how many pages the Tafel has — past one, «Drucken» offers «Alle Seiten» too */
  pageCount?: number
  /** a print is being made: the button says so and waits */
  printing?: boolean
  /** what the live mini Karte of a `map` section draws — it exists only while this page is shown */
  scene?: MiniKarteProps
  /** a tap on the mini Karte opens the Karte */
  onOpenKarte?: () => void
  /** px the floating chrome covers: top bar + page strip, the rails */
  inset: { top: number; left: number; right: number; bottom: number | string }
}

/** does the page show an entry from the checklist (lib/problemLink · problemView)? */
const hasChecklistEntry = (d: BoardFormData) => Object.values(d.values).some((v) =>
  (v.rows ?? []).some((r) => r.src === 'checklist') || Object.values(v.lines ?? {}).some((ls) => ls.some((l) => l.src === 'checklist')))

export function TafelFormPage({ pageKey, title, data, readOnly, isPhone, onChange, onRemove, onConflict, onPrint, pageCount = 1, printing = false, scene, onOpenKarte, inset }: TafelFormPageProps) {
  const t = T()
  const page = data.page
  const sections = shownSections(page)
  const rootRef = useRef<HTMLDivElement>(null)

  // ── the trailing rows' ids: one per list, re-minted once the list has taken it ────────────
  // (React's «adjust state while rendering»: a list whose trailing id was taken by the commit
  // that just landed gets a fresh one, and the render repeats before anything is painted)
  const [pending, setPending] = useState<Record<string, string>>({})
  // how many more standard rulings each table's leftover height holds (a taller neighbour in its
  // grid row) — measured, never a stretched row (owner: «just keep things fixed»)
  const fill = useFillCounts(rootRef)
  const minted: Record<string, string> = {}
  const trailing = (list: string, taken: readonly string[]): string => {
    const cur = pending[list]
    if (cur && !taken.includes(cur)) return cur
    minted[list] = newId('fr')
    return minted[list]
  }

  // ── the layout the keyboard moves through (lib/boardFormNav) ──────────────────────────────
  /** per section: a box's written lines and its empty line; a table's written rows, its empty row
   *  (`newId`, where writing lands — directly under the last entry) and how many more empty
   *  rulings are drawn under it (`ghosts`: the box's own height, then a taller neighbour's) */
  const ids: Record<string, { lines?: Record<string, { lines: string[]; newId: string }>; newId?: string; ghosts?: number }> = {}
  const layout: NavSection[] = []
  if (page.header) layout.push({ kind: 'text', id: HEAD_SEC, fields: HEAD_KEYS })
  for (const sec of sections) {
    if (sec.type === 'quad') {
      const boxes = sec.cells.map((c) => {
        const lines = boxLines(data, sec.id, c.id).map((l) => l.id)
        return { id: c.id, lines, newId: trailing(`${sec.id}/${c.id}`, lines) }
      })
      ids[sec.id] = { lines: Object.fromEntries(boxes.map((b) => [b.id, b])) }
      layout.push({ kind: 'quad', id: sec.id, boxes: readOnly ? [] : boxes, tag: !!sec.tag })
    } else if (sec.type === 'table') {
      const fixedRowIds = tableRows(data, sec).slice(0, shownFixedCount(sec)).map((r) => r.id)
      const written = writtenRows(data, sec).map((r) => r.id)
      const adds = tableAddsRows(sec) && !readOnly
      const newRow = trailing(sec.id, written)
      // the ruled empty rows the paper has below the entries (owner, round 2: every drawn box is a
      // tap target) — as many as the box holds (a pre-printed row stands two rulings tall), then
      // a taller neighbour's leftover (useFillCounts). Writing always lands in the first of them,
      // directly under the last entry (owner, 10.10. evening: «reorder, no fixed slots»): a tap
      // on any of the others puts the caret there.
      const room = adds && !isPhone ? Math.max(0, (sec.height ?? 0) - fixedRowIds.length * 2) : 0
      ids[sec.id] = { newId: adds ? newRow : undefined, ghosts: Math.max(0, room - written.length - 1) }
      // the keys walk the typed cells: a trend button and a Bereich menu are tapped, not typed
      const typed = (cs: TemplateColumn[]) => cs.filter((c) => c.type !== 'trend' && c.type !== 'area').map((c) => c.id)
      const fixed = (sec.fixedRows ?? []).map((r) => r.id)
      layout.push({
        kind: 'table', id: sec.id, cols: readOnly ? [] : typed(editableColumns(sec)),
        rows: [...fixedRowIds, ...written], adds, newId: adds ? newRow : undefined,
        fixed, writtenCols: readOnly ? [] : typed(writtenColumns(sec)),
      })
    } else if (sec.type === 'text') {
      layout.push({ kind: 'text', id: sec.id, fields: readOnly ? [] : sec.fields.map((f) => f.id) })
    }
  }
  if (Object.keys(minted).length) setPending((p) => ({ ...p, ...minted }))
  const lastKey = (() => {
    const l = [...layout].reverse().find((x) => (x.kind === 'quad' ? x.boxes.length : x.kind === 'table' ? x.cols.length : x.fields.length))
    if (!l) return ''
    if (l.kind === 'text') return keyOf(l.id, undefined, undefined, l.fields[l.fields.length - 1])
    if (l.kind === 'table') {
      const cs = l.adds ? l.writtenCols ?? l.cols : l.cols
      const lastRow = l.adds ? l.newId : l.rows[l.rows.length - 1]
      return keyOf(l.id, undefined, lastRow, cs[cs.length - 1])
    }
    const b = l.boxes[l.boxes.length - 1]
    return keyOf(l.id, b.id, b.newId, undefined)
  })()

  // ── writing ────────────────────────────────────────────────────────────────────────────────
  // the latest data, read where a closure outlives its render (a drag ends many renders later)
  const dataRef = useRef(data)
  useLayoutEffect(() => { dataRef.current = data })
  const put = (next: BoardFormData) => { if (next !== data) onChange(next) }
  const timeCol = (sec: TableSection) => editableColumns(sec).find((c) => c.type === 'time')
  /** the next state for a cell commit; `stamp` = Enter finished the row, so an empty «Wann» of a
   *  row with words gets the current time (one ↶ step with the commit, so ↶ takes it back) */
  const next = (a: Addr, raw: string, stamp: boolean): BoardFormData => {
    // every commit carries its time (server clock): what settles a cell two devices changed at once
    const at = serverNow()
    switch (a.kind) {
      case 'line': return putLine(data, a.sec, a.box, a.row, { text: raw }, at)
      case 'tag': return putLine(data, a.sec, a.box, a.row, { tag: raw }, at)
      case 'field': {
        const sec = sections.find((x) => x.id === a.sec) as TextSection | undefined
        const f = sec?.fields.find((x) => x.id === a.col)
        return putField(data, a.sec, a.col, f?.type === 'time' ? normalizeTime(raw) : raw, at)
      }
      case 'head': return putHead(data, a.col, a.col === 'alarm' ? normalizeTime(raw) : raw, at)
      case 'cell': {
        const sec = sections.find((x) => x.id === a.sec) as TableSection | undefined
        if (!sec) return data
        const col = sec.columns.find((c) => c.id === a.col)
        const cells: Record<string, string> = { [a.col]: col?.type === 'time' ? normalizeTime(raw) : raw }
        const tc = timeCol(sec)
        if (stamp && tc && tc.id !== a.col) {
          const row = tableRows(data, sec).find((r) => r.id === a.row)
          const merged = { ...row?.cells, ...cells }
          const words = writtenColumns(sec).some((c) => (c.type ?? 'text') === 'text' && (merged[c.id] ?? '').trim())
          if (words && !(merged[tc.id] ?? '').trim()) cells[tc.id] = hhmm(new Date(at))
        }
        return putRow(data, a.sec, a.row, { cells }, at)
      }
    }
  }
  /** does the line / row the cursor is in hold nothing once `draft` is committed? */
  const emptyAfter = (a: Addr, draft: string): boolean => {
    if (a.kind === 'line' || a.kind === 'tag') {
      const l = data.values[a.sec]?.lines?.[a.box]?.find((x) => x.id === a.row)
      const text = a.kind === 'line' ? draft : l?.text ?? ''
      const tag = a.kind === 'tag' ? draft : l?.tag ?? ''
      return !text.trim() && !tag.trim()
    }
    if (a.kind === 'cell') {
      const sec = sections.find((x) => x.id === a.sec) as TableSection | undefined
      if (!sec) return true
      const row = tableRows(data, sec).find((r) => r.id === a.row)
      const merged = { ...row?.cells, [a.col]: draft }
      const cs = (sec.fixedRows ?? []).some((r) => r.id === a.row) ? editableColumns(sec) : writtenColumns(sec)
      return !cs.some((c) => c.type !== 'trend' && (merged[c.id] ?? '').trim())
    }
    return false
  }

  // ── deleting an entry: the bin at the end of the row one stands in ─────────────────────────
  /** entries just deleted: the flush their focused cell does on the way out (blur) must not write
   *  them back. Cleared after the render that took them away. */
  const dropped = useRef(new Set<string>())
  useEffect(() => { dropped.current.clear() })
  const isDropped = (a: Addr) => (a.kind === 'line' || a.kind === 'tag' || a.kind === 'cell') && dropped.current.has(a.row)
  const removeEntry = (a: Addr, words: string, from?: EntrySource) => {
    if (readOnly || (a.kind !== 'cell' && a.kind !== 'line')) return
    dropped.current.add(a.row)
    ;(document.activeElement as HTMLElement | null)?.blur()
    const at = serverNow()
    const nextData = a.kind === 'cell' ? dropRow(data, a.sec, a.row, at) : dropLine(data, a.sec, a.box, a.row, at)
    if (nextData !== data) onChange(nextData, { removed: words, ...(from ? { from } : {}) })
  }

  // ── focus: where a key sent the cursor, resolved after the commit's render ───────────────────
  const focusAfterRender = useFocusAfterRender(rootRef)
  const onNav = (a: Addr, key: NavKey, draft: string, changed: boolean) => {
    if (isDropped(a)) return
    const at = navAtOf(a)
    const target = navTarget(layout, at, key, emptyAfter(a, draft))
    // only what was typed is written: a cell passed through never overwrites another device's change
    if (changed) put(next(a, draft, key === 'enter'))
    if (target === null) return
    if (target === 'blur') { (document.activeElement as HTMLElement | null)?.blur(); return }
    focusAfterRender(keyOf(target.sec, target.box, target.row, target.col))
  }
  const commit = (a: Addr) => (v: string) => { if (!isDropped(a)) put(next(a, v, false)) }
  /** where a cell is, in the deployment's words — the Verlauf row of a clash names it */
  const whereOf = (a: Addr): string => {
    if (a.kind === 'head') return t.head[a.col]
    const sec = sections.find((x) => x.id === a.sec)
    const title = labelText(sec?.title)
    if (!sec) return title
    if ((a.kind === 'line' || a.kind === 'tag') && sec.type === 'quad') return `${title} · ${labelText(sec.cells.find((c) => c.id === a.box)?.label)}`
    if (a.kind === 'cell' && sec.type === 'table') return `${title} · ${labelText(sec.columns.find((c) => c.id === a.col)?.label)}`
    if (a.kind === 'field' && sec.type === 'text') return labelText(sec.fields.find((f) => f.id === a.col)?.label) || title
    return title
  }
  const clash = (a: Addr) => (theirs: string, mine: string) => onConflict?.(whereOf(a), mine, theirs)
  const draftKey = (k: string) => `tafel:${pageKey}:${k}`

  // ── reordering: an entry moved by hand (owner, 10.10. evening) ─────────────────────────────
  // Alt+↑ / Alt+↓ (⌥ on a Mac) in any of its cells, or the grip at its left edge dragged (pointer
  // and touch, the page scrolling under the finger near its edges). One move is one ↶ step and
  // writes one order key (lib/orderKey) — what was typed in the cell rides along in that step.
  const listOf = (a: Addr, base: BoardFormData = data): string[] => {
    if (a.kind === 'line' || a.kind === 'tag') return boxLines(base, a.sec, a.box).map((l) => l.id)
    if (a.kind === 'cell') { const sec = sections.find((x) => x.id === a.sec); return sec?.type === 'table' ? writtenRows(base, sec).map((r) => r.id) : [] }
    return []
  }
  const moveTo = (a: Addr, to: number, base: BoardFormData = data): BoardFormData =>
    a.kind === 'line' || a.kind === 'tag' ? moveLine(base, a.sec, a.box, a.row, to, serverNow())
      : a.kind === 'cell' ? moveRow(base, a.sec, a.row, to, serverNow()) : base
  const onMove = (a: Addr, k: string) => (dir: -1 | 1, draft: string, changed: boolean) => {
    const base = changed ? next(a, draft, false) : data
    const order = listOf(a)
    const from = a.kind === 'line' || a.kind === 'tag' || a.kind === 'cell' ? order.indexOf(a.row) : -1
    const to = from + dir
    put(from >= 0 && to >= 0 && to < order.length ? moveTo(a, to, base) : base)
    focusAfterRender(k)
  }
  /** a drag in progress: which list, which entry, where it would land, how far it has travelled */
  const [drag, setDrag] = useState<{ list: string; id: string; from: number; to: number; dy: number; h: number } | null>(null)
  const beginDrag = (list: string, a: Addr, order: readonly string[]) => (e: ReactPointerEvent<HTMLButtonElement>) => {
    const root = rootRef.current
    if (readOnly || !root || (a.kind !== 'line' && a.kind !== 'cell')) return
    e.preventDefault()
    e.stopPropagation()
    const els = order.map((id) => root.querySelector<HTMLElement>(`[data-ord-list="${CSS.escape(list)}"][data-ord-id="${CSS.escape(id)}"]`))
    if (els.some((x) => !x)) return
    const start = root.scrollTop
    const mids = els.map((el) => { const r = el!.getBoundingClientRect(); return { mid: r.top + start + r.height / 2, h: r.height } })
    const from = order.indexOf(a.row)
    const h = mids[from].h
    const y0 = e.clientY
    let y = y0, to = from, raf = 0
    const compute = () => {
      const dy = y - y0 + (root.scrollTop - start)
      const centre = mids[from].mid + dy
      to = mids.filter((m, i) => i !== from && m.mid < centre).length
      setDrag({ list, id: a.row, from, to, dy, h })
    }
    const onPointerMove = (ev: PointerEvent) => { y = ev.clientY; compute() }
    // near the page's top or bottom edge the page scrolls under the finger
    const tick = () => {
      const r = root.getBoundingClientRect(), edge = 64
      const v = y < r.top + edge ? -(r.top + edge - y) / 3 : y > r.bottom - edge ? (y - (r.bottom - edge)) / 3 : 0
      if (v) { root.scrollTop += v; compute() }
      raf = requestAnimationFrame(tick)
    }
    const end = (commit: boolean) => () => {
      window.removeEventListener('pointermove', onPointerMove)
      window.removeEventListener('pointerup', up)
      window.removeEventListener('pointercancel', cancel)
      window.removeEventListener('keydown', esc)
      cancelAnimationFrame(raf)
      setDrag(null)
      if (!commit || to === from) return
      // ⚠️ Commit against the data as it stands NOW: another device's change (or a commit) may have
      // landed during the drag. The drop is «after that neighbour», re-found in the current order.
      const latest = dataRef.current
      const now = listOf(a, latest).filter((id) => id !== a.row)
      if (!listOf(a, latest).includes(a.row)) return // the entry is gone meanwhile
      const after = to > 0 ? order.filter((id) => id !== a.row)[to - 1] : null
      const at = after === null ? 0 : now.indexOf(after) + 1
      const moved = moveTo(a, after !== null && at === 0 ? Math.min(to, now.length) : at, latest)
      if (moved !== latest) onChange(moved)
    }
    const up = end(true), cancel = end(false)
    const esc = (ev: globalThis.KeyboardEvent) => { if (ev.key === 'Escape') cancel() }
    window.addEventListener('pointermove', onPointerMove)
    window.addEventListener('pointerup', up)
    window.addEventListener('pointercancel', cancel)
    window.addEventListener('keydown', esc)
    raf = requestAnimationFrame(tick)
    compute()
  }
  /** how a row of `list` stands while something in it is dragged: the dragged one follows the
   *  finger, the ones it passes make room */
  const dragStyle = (list: string, id: string, i: number): CSSProperties | undefined => {
    if (!drag || drag.list !== list) return undefined
    if (id === drag.id) return { transform: `translateY(${drag.dy}px)`, zIndex: 3, position: 'relative' }
    const shift = drag.from < drag.to ? (i > drag.from && i <= drag.to ? -drag.h : 0) : (i >= drag.to && i < drag.from ? drag.h : 0)
    return shift ? { transform: `translateY(${shift}px)`, transition: 'transform .12s' } : { transition: 'transform .12s' }
  }
  const grip = (list: string, a: Addr, order: readonly string[]) => readOnly || order.length < 2 ? null : (
    <button type="button" className={s.grip} aria-label={t.reorder} title={t.reorder} tabIndex={-1}
      onPointerDown={beginDrag(list, a, order)} onClick={(e) => e.preventDefault()}>
      <svg viewBox="0 0 10 16" aria-hidden="true">{[3, 8, 13].flatMap((y) => [<circle key={`a${y}`} cx="2.5" cy={y} r="1.4" />, <circle key={`b${y}`} cx="7.5" cy={y} r="1.4" />])}</svg>
    </button>
  )

  // ── sections ───────────────────────────────────────────────────────────────────────────────
  const ROW_PX = isPhone ? 44 : 40
  const minH = (h: number | undefined) => (h && !isPhone ? { minHeight: h * ROW_PX } : undefined)
  const heading = (title?: string, sub?: string) => (
    <>
      {title ? <h3 className={s.sh}>{title}</h3> : null}
      {sub ? <div className={s.sub}>{sub}</div> : null}
    </>
  )

  const quad = (sec: QuadSection) => {
    const st = minH(sec.height)
    return (
      <div className={cx(s.quad, sec.cells.length > 2 && !isPhone && s.quad2)} style={st}>
        {sec.cells.map((c) => {
          const lines = boxLines(data, sec.id, c.id)
          const order = lines.map((l) => l.id)
          const list = `${sec.id}/${c.id}`
          const box = ids[sec.id].lines![c.id]
          const label = labelText(c.label)
          const lineRow = (id: string, text: string, trend: string | undefined, tag: string | undefined, isNew: boolean, i: number, src?: EntrySource) => {
            const a: Addr = { kind: 'line', sec: sec.id, box: c.id, row: id }
            const k = keyOf(sec.id, c.id, id, undefined)
            const fromCk = src === 'checklist'
            return (
              <div key={id} className={cx(s.line, isNew && s.lineNew, drag?.id === id && s.dragging)}
                data-ord-list={isNew ? undefined : list} data-ord-id={isNew ? undefined : id} style={isNew ? undefined : dragStyle(list, id, i)}>
                {!isNew && grip(list, a, order)}
                {sec.trend && (isNew ? <span className={s.trendGap} aria-hidden="true" />
                  : <TrendButton trend={trend} readOnly={readOnly} onNext={() => put(putLine(data, sec.id, c.id, id, { trend: nextTrend(trend) }, serverNow()))} />)}
                {fromCk && <ChecklistMark />}
                <Cell k={k} kn={isNew ? keyOf(sec.id, c.id, NEW, undefined) : undefined}
                  value={text} label={label} readOnly={readOnly || fromCk} className={s.grow}
                  last={k === lastKey} onMove={isNew ? undefined : onMove(a, k)}
                  onCommit={commit(a)} onNav={(key, d, ch) => onNav(a, key, d, ch)} draftKey={draftKey(k)} onClash={clash(a)} />
                {sec.tag && !isNew && (
                  <Cell k={`${keyOf(sec.id, c.id, id, 'tag')}`} value={tag ?? ''} label={`${label} · ${t.tag}`} placeholder={t.tag}
                    readOnly={readOnly} className={s.tag} onMove={onMove({ kind: 'tag', sec: sec.id, box: c.id, row: id }, keyOf(sec.id, c.id, id, 'tag'))}
                    onCommit={commit({ kind: 'tag', sec: sec.id, box: c.id, row: id })} onNav={(key, d, ch) => onNav({ kind: 'tag', sec: sec.id, box: c.id, row: id }, key, d, ch)}
                    draftKey={draftKey(keyOf(sec.id, c.id, id, 'tag'))} onClash={clash({ kind: 'tag', sec: sec.id, box: c.id, row: id })} />
                )}
                {!isNew && !readOnly && <BinButton onRemove={() => removeEntry(a, text, src)} />}
              </div>
            )
          }
          return (
            <div key={c.id} className={s.box} data-box={c.id}
              // a tap on the empty part of a box writes into it: its empty line, under the last one
              onPointerDown={keep}
              onClick={(e) => { if (e.target === e.currentTarget) (e.currentTarget.querySelector<HTMLTextAreaElement>('[data-kn]'))?.focus() }}>
              <div className={s.boxLabel}>{label}</div>
              {lines.map((l, i) => lineRow(l.id, l.text, l.trend, l.tag, false, i, l.src))}
              {!readOnly && lineRow(box.newId, '', undefined, undefined, true, lines.length)}
            </div>
          )
        })}
      </div>
    )
  }

  const table = (sec: TableSection) => {
    const cols = shownColumns(sec)
    const fixedRows = new Map((sec.fixedRows ?? []).map((r) => [r.id, r]))
    const fixedList = tableRows(data, sec).slice(0, shownFixedCount(sec))
    const written = writtenRows(data, sec)
    const order = written.map((r) => r.id)
    const list = sec.id
    const { newId, ghosts = 0 } = ids[sec.id]
    // a written row's bin stands in a column of its own at the row's end (owner pick 7A)
    const bins = !readOnly && tableAddsRows(sec)
    const pc = problemColumns(sec)
    // on a phone a column is never narrower than its head's longest piece needs (owner, 10.10.:
    // «Entwi/cklun/gs-» in a 70px column) — a wide sheet then scrolls sideways in its box. And the
    // template's weights scale those minimums (owner, 28.10.2026: «make each column a little bit
    // wider … to not have that many word breaks»; `colMinScale`), so the sheet keeps its paper's
    // proportions and scrolls. With one minimum for all, `fr` did nothing on a phone – the grid
    // was exactly cols × 104px wide, «Funktion/Standort/Name» as narrow as «Kanal».
    const minScale = colMinScale(cols)
    const grid: CSSProperties = {
      gridTemplateColumns: [
        ...cols.map((c, i) => `minmax(${isPhone ? `calc(var(--tafel-col-min) * ${minScale[i]})` : '0'}, ${c.w ?? 1}fr)`),
        ...(sec.done ? ['auto'] : []),
        ...(bins ? ['var(--tap)'] : []),
      ].join(' '),
      ...(isPhone ? { minWidth: `calc(var(--tafel-col-min) * ${minScale.reduce((a, b) => a + b, 0)}${bins ? ' + var(--tap)' : ''})` } : {}),
    }
    /** an empty ruling under the empty row: drawn like a row, and a tap on it writes in the empty
     *  row — the same column — so writing lands directly under the last entry */
    const ghostRow = (key: string) => (
      <div key={key} className={cx(s.tr, s.trNew, s.ghost)} role="presentation" aria-hidden="true" style={grid}
        onPointerDown={keep}
        onClick={(e) => {
          const col = (e.target as HTMLElement).closest<HTMLElement>('[data-col]')?.dataset.col
          const root = rootRef.current
          const at = (cid: string | undefined) => root?.querySelector<HTMLTextAreaElement>(`[data-kn="${CSS.escape(keyOf(sec.id, undefined, NEW, cid))}"]`)
          ;(at(col) ?? root?.querySelector<HTMLTextAreaElement>(`[data-kn^="${CSS.escape(`${sec.id}||${NEW}|`)}"]`))?.focus()
        }}>
        {cols.map((c) => <span key={c.id} className={s.td} data-col={c.id} />)}
        {sec.done && <span className={s.td} />}
        {bins && <span className={s.td} />}
      </div>
    )
    const cellFor = (r: { id: string; cells: Record<string, string>; src?: EntrySource }, c: TemplateColumn, isNew: boolean, i = -1) => {
      const label = labelText(c.label)
      const fixedRow = fixedRows.has(r.id)
      const fromCk = r.src === 'checklist'
      if (c.fixed && fixedRow) {
        const v = fixedRows.get(r.id)?.cells[c.id]
        if (c.type === 'symbol') return <span key={c.id} className={cx(s.td, s.sig)}><BoardSignature name={typeof v === 'string' ? v : labelText(v)} className={s.sigSvg} /></span>
        if (c.type === 'index') return <span key={c.id} className={cx(s.td, s.index)}><span className={s.disc}>{labelText(v)}</span></span>
        return <span key={c.id} className={cx(s.td, s.fixed)}>{labelText(v)}</span>
      }
      // a written row under a fixed list has no Signatur / number of its own — the rest it types
      if (c.fixed && (c.type === 'symbol' || c.type === 'index')) return <span key={c.id} className={s.td} />
      if (c.type === 'trend') {
        return (
          <span key={c.id} className={cx(s.td, s.trendCell)}>
            {!isNew && <TrendButton trend={r.cells[c.id]} readOnly={readOnly}
              onNext={() => put(putRow(data, sec.id, r.id, { cells: { [c.id]: nextTrend(r.cells[c.id]) ?? '' } }, serverNow()))} />}
          </span>
        )
      }
      const a: Addr = { kind: 'cell', sec: sec.id, row: r.id, col: c.id }
      const k = keyOf(sec.id, undefined, r.id, c.id)
      const writtenRow = i >= 0
      // the grip stands at the row's left edge, in its first typed cell (or the Bereich menu)
      const first = c.id === cols.find((x) => !(x.fixed && (x.type === 'symbol' || x.type === 'index')) && x.type !== 'trend')?.id
      const gripped = writtenRow && first && order.length > 1 && !readOnly
      if (c.type === 'area') {
        const v = r.cells[c.id] ?? ''
        // a checklist problem's Bereich is its phase's: read, not picked
        if (readOnly || fromCk) {
          return <span key={c.id} className={cx(s.td, s.fixed, gripped && s.tdGrip)}>{writtenRow && first && grip(list, a, order)}{labelText(c.options?.find((o) => o.id === v)?.label) || v}</span>
        }
        return (
          <span key={c.id} className={cx(s.td, s.areaCell, gripped && s.tdGrip)}>
            {writtenRow && first && grip(list, a, order)}
            <AreaPick value={v} options={c.options ?? []} label={label} onPick={(x) => put(putRow(data, sec.id, r.id, { cells: { [c.id]: x } }, serverNow()))} />
          </span>
        )
      }
      // a checklist problem's words are the checklist's (lib/problemLink): read, never typed over
      const ckWords = fromCk && c.id === pc?.text
      return (
        <span key={c.id} className={cx(s.td, gripped && s.tdGrip, ckWords && s.tdCk)}>
          {writtenRow && first && grip(list, a, order)}
          {ckWords && <ChecklistMark />}
          <Cell k={k} kn={isNew ? keyOf(sec.id, undefined, NEW, c.id) : undefined} onMove={writtenRow ? onMove(a, k) : undefined}
            value={r.cells[c.id] ?? ''} label={label} readOnly={readOnly || ckWords} time={c.type === 'time'}
            placeholder={c.type === 'time' ? '--:--' : undefined} last={k === lastKey}
            onCommit={commit(a)} onNav={(key, d, ch) => onNav(a, key, d, ch)} draftKey={draftKey(k)} onClash={clash(a)} />
        </span>
      )
    }
    return (
      <div className={s.table} role="table" aria-label={labelText(sec.title) || labelText(page.title)} style={minH(sec.height)}>
        <div className={cx(s.tr, s.thead)} role="row" style={grid}>
          {/* a head may break after a slash («Funktion/ Standort/ Name»), never inside a word */}
          {cols.map((c) => <span key={c.id} className={s.th} role="columnheader">{labelText(c.label).replace(/\//g, '/\u200b')}</span>)}
          {sec.done && <span className={s.th} role="columnheader"><span className={s.srOnly}>{t.done}</span></span>}
          {bins && <span className={s.th} role="columnheader"><span className={s.srOnly}>{t.deleteRow}</span></span>}
        </div>
        {fixedList.map((r) => (
          <div key={r.id} className={cx(s.tr, s.trFixed, r.done && s.trDone)} role="row" style={grid}>
            {cols.map((c) => cellFor(r, c, false))}
            {sec.done && <span className={cx(s.td, s.doneCell)}>
              <DoneButton on={!!r.done} readOnly={readOnly} onToggle={() => put(putRow(data, sec.id, r.id, { done: !r.done }, serverNow()))} />
            </span>}
            {bins && <span className={s.td} />}
          </div>
        ))}
        {/* the entries, from the top, in their order (owner, 10.10. evening: «reorder, no fixed
            slots») — then the empty row writing lands in, then the empty rulings under it */}
        {written.map((r, i) => (
          <div key={r.id} className={cx(s.tr, r.done && s.trDone, drag?.id === r.id && s.dragging)} role="row"
            data-ord-list={list} data-ord-id={r.id} style={{ ...grid, ...dragStyle(list, r.id, i) }}>
            {cols.map((c) => cellFor(r, c, false, i))}
            {sec.done && <span className={cx(s.td, s.doneCell)}>
              <DoneButton on={!!r.done} readOnly={readOnly} onToggle={() => put(putRow(data, sec.id, r.id, { done: !r.done }, serverNow()))} />
            </span>}
            {bins && <span className={cx(s.td, s.binCell)}>
              <BinButton onRemove={() => removeEntry({ kind: 'cell', sec: sec.id, row: r.id, col: '' }, (pc ? r.cells[pc.text] : undefined) ?? Object.values(r.cells).find((x) => x.trim()) ?? '', r.src)} />
            </span>}
          </div>
        ))}
        {newId && (
          <div key={newId} className={cx(s.tr, s.trNew)} role="row" style={grid}>
            {cols.map((c) => cellFor({ id: newId, cells: {} }, c, true))}
            {sec.done && <span className={s.td} />}
            {bins && <span className={s.td} />}
          </div>
        )}
        {Array.from({ length: newId ? ghosts : 0 }, (_, j) => ghostRow(`g${j}`))}
        {/* the leftover height a taller neighbour leaves: more rulings of the standard height —
            or plain space when not a whole ruling is left (never a stretched row). Takes no
            height of its own (flex-basis 0), so what it holds never grows the box. */}
        {newId && (
          <div className={s.fill} data-fill={sec.id}>
            {Array.from({ length: fill[sec.id] ?? 0 }, (_, j) => ghostRow(`f${j}`))}
          </div>
        )}
      </div>
    )
  }

  const text = (sec: TextSection) => {
    const layoutKind = sec.layout ?? (sec.fields.length > 1 ? 'row' : 'stack')
    const v = data.values[sec.id]?.fields ?? {}
    const st = minH(sec.height)
    const field = (f: TextSection['fields'][number], i: number) => {
      const a: Addr = { kind: 'field', sec: sec.id, col: f.id }
      const label = labelText(f.label) || labelText(sec.title)
      const k = keyOf(sec.id, undefined, undefined, f.id)
      return (
        <label key={f.id} className={cx(s.field, f.tone && s[`tone_${f.tone}`], layoutKind === 'split' && i === 0 && s.fieldMain)}>
          {(i === 0 && sec.title) || f.label ? <span className={s.fieldLabel}>{i === 0 && sec.title && !f.label ? labelText(sec.title) : labelText(f.label)}</span> : null}
          <Cell k={k} value={v[f.id] ?? ''} label={label} readOnly={readOnly} time={f.type === 'time'} className={s.fieldCell}
            last={k === lastKey} onCommit={commit(a)} onNav={(key, d, ch) => onNav(a, key, d, ch)} draftKey={draftKey(k)} onClash={clash(a)} />
        </label>
      )
    }
    if (layoutKind === 'split') {
      return (
        <div className={cx(s.textBox, s.split)} style={st}>
          {field(sec.fields[0], 0)}
          <div className={s.splitRow}>{sec.fields.slice(1).map((f, i) => field(f, i + 1))}</div>
        </div>
      )
    }
    return <div className={cx(s.textBox, layoutKind === 'row' && !isPhone && s.textRow)} style={st}>{sec.fields.map(field)}</div>
  }

  const map = (sec: { height?: number }) => (
    <div className={s.map} style={minH(sec.height)}>
      {/* inert: the markers inside are buttons on the Karte — here they are a picture, and neither
          Tab nor the iOS ↑↓ bar may stop on them */}
      <div className={cx(s.mapInner, 'tfp-map')} inert>{scene && <MiniKarte {...scene} />}</div>
      <button type="button" className={s.mapOpen} aria-label={t.mapLabel} title={t.mapPrint}
        onPointerDown={keep} onClick={() => onOpenKarte?.()}>
        <span className={s.mapChip}><Icon id="map" />{t.mapOpen}</span>
      </button>
    </div>
  )

  const cols = isPhone ? 1 : page.columns ?? 1
  const printGlyph = printing ? <ShellLoader /> : <Icon id="printer" />
  return (
    <div ref={rootRef} className={cx(s.page, isPhone && s.phone)} data-testid="tafel-page" data-page={page.id}
      // the deployment's language: what the cells hyphenate by (`hyphens: auto`, TafelFormPage.module.css)
      lang={getLocaleId()}
      style={{ paddingTop: inset.top, paddingLeft: inset.left, paddingRight: inset.right, paddingBottom: inset.bottom }}>
      <div className={cx(s.paper, page.paper === 'landscape' && s.landscape, cols === 1 && s.single)}>
        <header className={s.head}>
          {/* no «Vorlage … Version …» line (owner, 10.10. evening): which file the page came from
              stays in the data and on the paper's footer, not on the screen */}
          <h2 className={s.title} title={t.keysHint}>{title ?? labelText(page.title)}</h2>
          {/* the page on paper — the same sheet the Rapport prints; also on a closed Einsatz. While
              the PDF is made the printer turns into the loader (owner, 28.10.2026: the phone hides
              the «PDF wird erstellt» word, so the button looked dead for seconds) */}
          {onPrint && (pageCount > 1
            ? (
              <Menu
                align="end"
                popupClassName="de-menu-pop"
                itemClassName={() => 'de-menu-item'}
                trigger={<Button variant="quiet" className={s.print} icon={printGlyph} disabled={printing} aria-busy={printing || undefined} aria-label={printing ? t.printBusy : t.print}><span className={s.printWord}>{printing ? t.printBusy : t.print}</span></Button>}
                items={[
                  { label: t.printThis, onClick: () => onPrint(false) },
                  { label: fillTemplate(t.printAll, { n: pageCount }), onClick: () => onPrint(true) },
                ]}
              />
            )
            : <Button variant="quiet" className={s.print} icon={printGlyph} disabled={printing} aria-busy={printing || undefined} aria-label={printing ? t.printBusy : t.print} onPointerDown={keep} onClick={() => onPrint(false)}><span className={s.printWord}>{printing ? t.printBusy : t.print}</span></Button>)}
          {!readOnly && (
            <IconButton label={t.removePage} className={s.remove} onPointerDown={keep} onClick={onRemove}><Icon id="trash" /></IconButton>
          )}
        </header>
        {page.header && (
          <div className={s.headRow}>
            {HEAD_KEYS.map((k) => {
              const a: Addr = { kind: 'head', col: k }
              return (
                <label key={k} className={cx(s.field, s.headField)}>
                  <span className={s.fieldLabel}>{t.head[k]}</span>
                  <Cell k={keyOf(HEAD_SEC, undefined, undefined, k)} value={data.head?.[k] ?? ''} label={t.head[k]} readOnly={readOnly} time={k === 'alarm'}
                    className={s.fieldCell} onCommit={commit(a)} onNav={(key, d, ch) => onNav(a, key, d, ch)} draftKey={draftKey(keyOf(HEAD_SEC, undefined, undefined, k))} onClash={clash(a)} />
                </label>
              )
            })}
          </div>
        )}
        <div className={s.grid} style={{ gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))` }}>
          {sections.map((sec) => (
            <section key={sec.id} className={cx(s.sec, sec.type === 'text' && s.secText)} data-sec={sec.id}
              style={{ gridColumn: cols > 1 && sec.span === 2 ? '1 / -1' : undefined }}>
              {sec.type !== 'text' && heading(labelText(sec.title), labelText(sec.subtitle))}
              {sec.type === 'quad' ? quad(sec) : sec.type === 'table' ? table(sec) : sec.type === 'text' ? text(sec) : map(sec)}
            </section>
          ))}
        </div>
        {/* what the checklist mark means – where a problem section shows one */}
        {hasChecklistEntry(data) && <p className={s.legend}><Icon id="checklist" />{t.checklistLegend}</p>}
        {/* when the page was started and last written on — the paper prints the same line */}
        <p className={s.stamp}>{pageStamp(data, t)}</p>
      </div>
    </div>
  )
}
