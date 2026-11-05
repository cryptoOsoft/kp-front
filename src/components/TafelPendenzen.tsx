import { useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties } from 'react'
import { appConfig } from '../config/appConfig'
import { Icon } from '../lib/icons'
import { cx } from '../lib/cx'
import { fillTemplate, hhmm } from '../lib/format'
import { newId } from '../lib/ids'
import { colMinScale, labelText, type LiveSection } from '../lib/boardTemplate'
import type { NavKey } from '../lib/boardFormNav'
import { pendenzLedger, type PendenzItem } from '../lib/reminders'
import { isOverdue, liveColumns, type PendenzColumn, type PendenzDraft, type PendenzenPort } from '../lib/pendenzenPage'
import { IconButton } from './Button'
import { TickRow } from './TickRow'
// a TYPE import only: the page hands its Cell in (`Cell` prop), so the two modules form no ring
import type { Cell as TafelCell } from './TafelFormPage'
import s from './TafelFormPage.module.css'
import p from './TafelPendenzen.module.css'

/**
 * The Tafel's «Aufträge / Pendenzen» page (05.11.2026, owner pick 6A): the BGV form's columns —
 * Was · Wer · Prio. · Status · Zeit — as a ruled table, every Pendenz and Erinnerung of the
 * Verlauf in the order it was raised, done rows struck through and kept. A DERIVED view: the rows
 * are the Verlauf's (lib/reminders · pendenzLedger), and every act here appends a Verlauf row
 * through `port` (lib/pendenzenPage says which). Mounted by TafelFormPage for a `live` section.
 *
 * - **Status** is two ticks, as on the paper: «Erteilt» is the item's creation time, ticked by
 *   itself (owner, 05.11.: no new state) and a read-out; «Erledigt» is the Verlauf's own tick —
 *   confirm-with-undo, ↶ and «Rückgängig» like the ring there — and un-ticking takes it back.
 * - **Zeit** carries an Erinnerung's time with a bell, red «überfällig» once it is past and open.
 * - **The empty row** at the foot becomes a Pendenz when the row is LEFT (Enter, Tab off its last
 *   cell, a tap elsewhere): one `created` row with Was, Wer and Prio. together, never a created
 *   row followed by corrections. It then says once «Als Pendenz im Verlauf eingetragen».
 * - **A change** of Was / Wer / Prio. on an item is a correction row in the Verlauf; an emptied
 *   Was keeps its words (an Auftrag without words is none).
 * - **◷** at the end of Was opens the Verlauf on the item's row.
 * - No grip: the order IS the order of issue (owner pick), nothing of it lives on the page.
 * - A session that cannot write the Verlauf (viewer, link, closed Einsatz) reads it: cells read-only,
 *   ticks as read-outs, no empty row.
 */

const NEW = '+new'
const C = () => appConfig.copy.tafelPendenzen
/** the Was / Wer text cells — Tab walks them, Enter goes down in the same column */
const TYPED: readonly PendenzColumn[] = ['was', 'wer']
const keyOf = (row: string, col: PendenzColumn) => `pz|${row}|${col}`

/** A clock for «überfällig»: re-reads the time every 30 s while the page is shown. */
function useNow(ms = 30_000): number {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), ms)
    return () => clearInterval(id)
  }, [ms])
  return now
}

interface Props {
  /** the Tafel's own cell (TafelFormPage · Cell): same keys, same commit-once rule */
  Cell: typeof TafelCell
  sec: LiveSection
  port?: PendenzenPort
  isPhone: boolean
  /** what the page is called — the Verlauf row names it */
  pageTitle: string
}

export function TafelPendenzen({ Cell, sec, port, isPhone, pageTitle }: Props) {
  const w = C()
  const cols = liveColumns(sec)
  const timeline = port?.timeline
  const items = useMemo(() => pendenzLedger(timeline ?? []), [timeline])
  const now = useNow()
  const canWrite = !!port?.canWrite
  const rootRef = useRef<HTMLDivElement>(null)

  // ── the empty row: a draft until the row is left (see the header) ─────────────────────────
  const blank: PendenzDraft = { text: '', assignee: '', urgent: false }
  const [draft, setDraft] = useState<PendenzDraft>(blank)
  const draftRef = useRef(draft)
  const put = (patch: Partial<PendenzDraft>) => { draftRef.current = { ...draftRef.current, ...patch }; setDraft(draftRef.current) }
  /** re-keyed after each submit, so the empty row's cells start empty again */
  const [newKey, setNewKey] = useState(() => newId('fr'))
  /** the row just typed here — its «eingetragen» line shows once, until the next */
  const [saved, setSaved] = useState<{ rowId: string; at: string } | null>(null)
  const submit = (): boolean => {
    const d = draftRef.current
    if (!port || !canWrite || !d.text.trim()) return false
    const made = port.create(d, pageTitle)
    draftRef.current = blank
    setDraft(blank)
    setNewKey(newId('fr'))
    if (made) setSaved(made)
    return true
  }
  // a draft is written when the page goes away, like every cell on the Tafel
  const submitRef = useRef(submit)
  useEffect(() => { submitRef.current = submit })
  useEffect(() => () => { submitRef.current() }, [])

  // ── an emptied Was is put back: the cell is re-keyed so it shows the item's words again ────
  const [resets, setResets] = useState(0)
  const commit = (item: PendenzItem, col: PendenzColumn, v: string) => {
    if (!port || !canWrite) return
    if (col === 'was' && !v.trim()) { setResets((n) => n + 1); return }
    port.edit(item, col === 'was' ? { text: v } : { assignee: v })
  }

  // ── the keyboard: Tab across Was → Wer → the next row, Enter down the column ───────────────
  const rows = [...items.map((i) => i.id), ...(canWrite ? [NEW] : [])]
  const want = useRef<string | null>(null)
  const [, bump] = useState(0)
  useLayoutEffect(() => {
    const k = want.current
    if (!k) return
    const el = rootRef.current?.querySelector<HTMLTextAreaElement>(`[data-k="${CSS.escape(k)}"]`)
    if (!el) return
    want.current = null
    el.focus()
    el.setSelectionRange(el.value.length, el.value.length)
  })
  const focusSoon = (k: string) => { want.current = k; bump((n) => n + 1) }
  const onNav = (row: string, col: PendenzColumn, key: NavKey) => {
    const r = rows.indexOf(row)
    const c = TYPED.indexOf(col)
    if (row === NEW && (key === 'enter' || (key === 'tab' && c === TYPED.length - 1))) {
      // leaving the empty row forwards: it becomes a Pendenz, and the next empty row takes the caret
      submit()
      focusSoon(keyOf(NEW, 'was'))
      return
    }
    if (key === 'enter') { const next = rows[r + 1]; if (next) focusSoon(keyOf(next, col)); return }
    const step = key === 'tab' ? 1 : -1
    const flat = rows.flatMap((id) => TYPED.map((x) => keyOf(id, x)))
    const target = flat[flat.indexOf(keyOf(row, col)) + step]
    if (target) focusSoon(target)
  }

  // ── layout: the template's weights, a phone's minimums (lib/boardTemplate · colMinScale) ───
  // Prio. and Zeit hold a size of their own (a digit, a clock); Status is two labelled ticks and
  // scales like text
  const minScale = colMinScale(cols.map((c) => ({ ...c, type: c.id === 'prio' || c.id === 'zeit' ? 'time' as const : undefined })))
  const grid: CSSProperties = {
    gridTemplateColumns: cols.map((c, i) => `minmax(${isPhone ? `calc(var(--tafel-col-min) * ${minScale[i]})` : '0'}, ${c.w ?? 1}fr)`).join(' '),
    ...(isPhone ? { minWidth: `calc(var(--tafel-col-min) * ${minScale.reduce((a, b) => a + b, 0)})` } : {}),
  }

  const cellFor = (item: PendenzItem | null, col: PendenzColumn, label: string) => {
    const row = item?.id ?? NEW
    const done = item?.doneAt != null
    switch (col) {
      case 'was':
      case 'wer': {
        const value = item ? (col === 'was' ? item.text : item.assignee ?? '') : (col === 'was' ? draft.text : draft.assignee ?? '')
        return (
          <span key={col} className={cx(s.td, col === 'was' && p.was)}>
            <Cell key={item ? `${item.id}:${resets}` : newKey} k={keyOf(row, col)} value={value} label={label}
              readOnly={!canWrite} className={cx(done && p.struck, item?.urgent && col === 'was' && p.urgent)}
              placeholder={!item && col === 'was' ? w.newRow : undefined}
              onCommit={(v) => (item ? commit(item, col, v) : put(col === 'was' ? { text: v } : { assignee: v }))}
              onNav={(key, d, changed) => {
                if (changed) { if (item) commit(item, col, d); else put(col === 'was' ? { text: d } : { assignee: d }) }
                onNav(row, col, key)
              }} />
            {item && col === 'was' && port && (
              <IconButton label={w.toVerlauf} className={p.jump} tabIndex={-1} onClick={() => port.showInVerlauf(item.rowId)}>
                <Icon id="clock" />
              </IconButton>
            )}
          </span>
        )
      }
      case 'prio': {
        const on = item ? !!item.urgent : !!draft.urgent
        const toggle = () => (item ? port?.edit(item, { urgent: !on }) : put({ urgent: !on }))
        return (
          <span key={col} className={cx(s.td, p.center)}>
            {canWrite
              // the Tendenz button's recipe (TafelFormPage · TrendButton): the name says what stands
              // and what a tap does. The press keeps the focus where it is: on the empty row, taking
              // it away would submit the row before its Prio. (iOS never focuses a button)
              ? <IconButton label={on ? w.prioOn : w.prioOff} className={cx(p.prio, on && p.prioOn)} tabIndex={-1}
                  onPointerDown={(e) => e.preventDefault()} onClick={toggle}>{on ? '1' : <span className={p.prioDot} aria-hidden="true">·</span>}</IconButton>
              : on ? <span className={cx(p.prio, p.prioOn)} role="img" aria-label={w.prio}>1</span> : null}
          </span>
        )
      }
      case 'status':
        return (
          <span key={col} className={cx(s.td, p.status)}>
            {/* «Erteilt»: the creation time, ticked by itself — a read-out, never a door */}
            <TickRow checked={!!item} disabled onToggle={() => {}} className={p.tickRo}>
              <span className={p.tickWord}>{w.erteilt}</span><span className={p.tickTime}>{item ? hhmm(item.createdAt) || '–' : '–'}</span>
            </TickRow>
            <TickRow checked={done} disabled={!item || !canWrite} className={cx((!item || !canWrite) && p.tickRo)}
              onToggle={() => { if (item) port?.setDone(item, !done) }}>
              <span className={p.tickWord}>{w.erledigt}</span><span className={p.tickTime}>{done ? hhmm(item?.doneAt) || '–' : '–'}</span>
            </TickRow>
          </span>
        )
      case 'zeit': {
        if (!item?.dueAt) return <span key={col} className={s.td} />
        const late = isOverdue(item, now)
        return (
          <span key={col} className={cx(s.td, p.zeit, late && p.late)}>
            <span className={p.due}><Icon id="bell" />{hhmm(item.dueAt)}</span>
            <span className={p.dueWord}>{late ? w.overdue : w.erinnerung}</span>
          </span>
        )
      }
    }
  }

  const heads = cols.map((c) => labelText(c.label))
  const row = (item: PendenzItem | null) => (
    <div key={item?.id ?? newKey} className={cx(s.tr, !item && s.trNew)} role="row" style={grid}
      data-pendenz={item?.id}
      // the empty row becomes a Pendenz when the focus leaves it (a tap elsewhere, a page switch)
      onBlur={item ? undefined : (e) => { if (!e.currentTarget.contains(e.relatedTarget as Node | null)) submit() }}>
      {cols.map((c, i) => cellFor(item, c.id, heads[i]))}
    </div>
  )
  return (
    <div ref={rootRef} className={s.table} role="table" aria-label={labelText(sec.title) || pageTitle} style={sec.height && !isPhone ? { minHeight: sec.height * 40 } : undefined}>
      <div className={cx(s.tr, s.thead)} role="row" style={grid}>
        {heads.map((h, i) => <span key={cols[i].id} className={s.th} role="columnheader">{h}</span>)}
      </div>
      {items.map(row)}
      {saved && (
        <p className={p.saved} role="status">
          <Icon id="clock" />
          {fillTemplate(w.saved, { t: hhmm(saved.at), by: port?.author ? ` · ${port.author}` : '' })}
        </p>
      )}
      {canWrite && row(null)}
      {items.length === 0 && <p className={p.empty}>{canWrite ? w.empty : w.emptyRo}</p>}
    </div>
  )
}
