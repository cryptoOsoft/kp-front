import { Fragment, useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import type { SymbolsApi } from '../lib/useSymbols'
import type { ShapeKind } from '../types'
import { Icon } from '../lib/icons'
import { SearchField } from './SearchField'
import { appConfig } from '../config/appConfig'
import { fillTemplate, formatSymbolName } from '../lib/format'
import { symbolMatchesQuery } from '../lib/symbolSearch'
import { softHyphenate } from '../lib/symbolWrap'
import { FORMEN_ORDER, SHAPE_DEFS, ShapeGlyph } from '../lib/shapes'
import { sanitizeSvg } from '../lib/sanitizeSvg'
import { bareBlack } from '../lib/glyphTile'
import { useIsPhone } from '../lib/useIsPhone'
import { addTools } from '../lib/toolFold'
import { SheetGrab, useSwipeDismiss } from '../lib/overlays'
import { tut, toolAnchor } from '../lib/tutorials/anchors'

// the geometric «Formen» section (Pfeil · Rechteck) renders right after this pack category,
// before Wasser (the pack's order: tools/gen_symbols.py · ORDER).
const FORMEN_AFTER_CAT = 'Gefahren'

function ShapeCell({ kind, onPick }: { kind: ShapeKind; onPick: (k: ShapeKind) => void }) {
  return (
    <button className="sym-cell" title={appConfig.copy.shapes.names[kind]} onClick={() => onPick(kind)} draggable={false}>
      {/* ⚠️ layout on the inner span, not the button — see .sym-cell-in in 07-toolrail.css */}
      <span className="sym-cell-in">
        <span className="sym-shape"><ShapeGlyph kind={kind} color={SHAPE_DEFS[kind].defaultColor} aspect={SHAPE_DEFS[kind].defaultAspect} fit /></span>
        <small>{appConfig.copy.shapes.names[kind]}</small>
      </span>
    </button>
  )
}

interface Props {
  sym: SymbolsApi
  onPick: (name: string) => void
  onClose: () => void
  /** when provided, a "Formen" section lets the user place editable shapes */
  onPickShape?: (kind: ShapeKind) => void
  /** the surface's tool list. PHONE only, its draw tools · Notiz · Trupp become the sheet's FIRST
   *  section (lib/toolFold · addTools): they have no tile on the phone bar, because «+» is the one
   *  door to everything that is put on the surface. Wider layouts keep them on the rail and the
   *  sheet stays a symbol palette. */
  tools?: readonly PaletteTool[]
  onPickTool?: (id: string) => void
}

/** what the sheet needs of a rail tool — the rail's own entries fit as they are */
interface PaletteTool { id: string; icon: string; label: string; sep?: boolean; slot?: boolean }

/** a tool in the sheet: the same cell a symbol gets, wearing the glyph its rail tile wears */
function ToolCell({ tool, onPick }: { tool: PaletteTool; onPick: (id: string) => void }) {
  return (
    <button className="sym-cell sym-cell-tool" title={tool.label} onClick={() => onPick(tool.id)} draggable={false} {...toolAnchor('add', tool.id)}>
      <span className="sym-cell-in">
        <span className="sym-tool-glyph"><Icon id={tool.icon} /></span>
        <small>{tool.label}</small>
      </span>
    </button>
  )
}

function Cell({ name, svg, onPick }: { name: string; svg: string; onPick: (n: string) => void }) {
  return (
    <button className="sym-cell" title={name} onClick={() => onPick(name)} draggable={false}>
      {/* ⚠️ layout on the inner span, not the button — see .sym-cell-in in 07-toolrail.css */}
      <span className="sym-cell-in">
        {/* ⚠️ SEC-01 — sanitise AT THIS SINK. This glyph string can be an editor-supplied
            `symbolSvg` (free workspace data); the sink sanitiser is the authoritative XSS gate, so
            every `dangerouslySetInnerHTML` taking an SVG string wraps it, never trusts the prop. */}
        {/* black-on-clear glyphs get the map's white tile at night (.glyph-tile, 07-toolrail.css) */}
        <span className={bareBlack(svg) ? 'glyph-tile' : undefined} dangerouslySetInnerHTML={{ __html: sanitizeSvg(svg) }} />
        {/* soft hyphens at the COMPOUND seams (lib/symbolWrap) — the cell is ~94px, so a long
            name wraps, and it has to wrap where the word does: «Kontroll-posten», never
            «Kontrollpos-ten». Display only; `title` and search keep the plain label. */}
        <small>{softHyphenate(formatSymbolName(name) || name)}</small>
      </span>
    </button>
  )
}

// Centred symbol-search modal — no tabs; all signs shown, grouped, scrollable.
export function Palette({ sym, onPick, onClose, onPickShape, tools, onPickTool }: Props) {
  const [q, setQ] = useState('')
  const phone = useIsPhone()
  const sheetTools = phone && tools && onPickTool ? addTools(tools) : []
  const inputRef = useRef<HTMLInputElement>(null)
  const modalRef = useRef<HTMLDivElement>(null)

  // the search is NOT autofocused — opening the palette shouldn't grab the keyboard
  // (or pop the on-screen keyboard on touch). The user clicks the field to type, or
  // just taps a symbol. Identical on both surfaces (Lage + Plan share this palette).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  const swipe = useSwipeDismiss({ onClose, enabled: true })
  // keep Tab focus inside the dialog
  const trapFocus = (e: React.KeyboardEvent) => {
    if (e.key !== 'Tab') return
    const focusable = modalRef.current?.querySelectorAll<HTMLElement>(
      'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])',
    )
    if (!focusable || !focusable.length) return
    const first = focusable[0]
    const last = focusable[focusable.length - 1]
    if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus() }
    else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus() }
  }

  const query = q.trim().toLowerCase()
  // full synonym search — raw key, display label, copy.symbolAliases, and category heading
  // all match (umlaut-tolerant), see lib/symbolSearch.ts
  const matches = useMemo(
    () => (query ? sym.symbols.filter((s) => symbolMatchesQuery(s, query)) : []),
    [query, sym],
  )
  // …and a tool is found by its word too: somebody who types «Linie» must not be told there is
  // no such symbol
  const toolMatches = query ? sheetTools.filter((t) => t.label.toLowerCase().includes(query)) : []
  // portal to <body> so the backdrop escapes the .surface stacking context (z-index 20) and
  // covers the left NavRail (z-index 35) instead of rendering beneath it.
  // Scrim and sheet are SIBLINGS, the shape Base UI gives every other dialog (r35, 06.11.2026): the
  // sheet centres itself (07-toolrail · .sym-modal), and nothing the scroller clips under its edge
  // counts as «inside» the scrim any more.
  return createPortal((
    <>
      <div className="modal-backdrop" onClick={onClose} />
      <div
        ref={modalRef}
        className="sym-modal"
        role="dialog"
        aria-modal="true"
        aria-label={appConfig.copy.symbolSearchPlaceholder}
        onKeyDown={trapFocus}
        {...swipe}
      >
        {/* hand-rolled, so it borrows the two things every other phone sheet gets from the
            primitives: the grab bar and the push-down that closes it (20.09.2026) */}
        <SheetGrab />
        <div className="sym-top">
          {/* just «Suchen …». The total used to ride in the placeholder as «(184)», which
              answers a question nobody asks — how many symbols the pack has changes nothing
              about the one you are looking for. */}
          <SearchField ref={inputRef} className="sym-search" value={q} onChange={setQ}
            placeholder={appConfig.copy.symbolSearchPlaceholder} aria-label={appConfig.copy.symbolSearchPlaceholder} {...tut('add.search')} />
          <button className="sym-close" onClick={onClose} title={appConfig.copy.closeDialog} aria-label={appConfig.copy.closeDialog}><Icon id="close" /></button>
        </div>

        <div className="sym-scroll">
          {query ? (
            matches.length + toolMatches.length === 0
              ? <div className="sym-empty no-hits">{fillTemplate(appConfig.copy.noHits, { q: q.trim() })}</div>
              : <div className="sym-grid">
                  {toolMatches.map((t) => <ToolCell key={t.id} tool={t} onPick={onPickTool!} />)}
                  {matches.map((s) => <Cell key={s.name} name={s.name} svg={s.svg} onPick={onPick} />)}
                </div>
          ) : (
            <>
              {sheetTools.length > 0 && (
                <section>
                  <div className="sym-ghead">{appConfig.copy.addSheet.tools}</div>
                  <div className="sym-grid">
                    {sheetTools.map((t) => <ToolCell key={t.id} tool={t} onPick={onPickTool!} />)}
                  </div>
                </section>
              )}
              {sym.order.map((cat) => (
                <Fragment key={cat}>
                  <section>
                    <div className="sym-ghead">{appConfig.copy.symbolCategories[cat] ?? cat}</div>
                    <div className="sym-grid">
                      {/* Rauch is now a real «VKF Rauch» symbol in the pack (Schadenlage), so it
                          renders as a normal symbol cell below — no special shape injection. */}
                      {sym.symbols.filter((s) => s.cat === cat).map((s) => <Cell key={s.name} name={s.name} svg={s.svg} onPick={onPick} />)}
                    </div>
                  </section>
                  {/* the geometric Formen (Pfeil · Rechteck) sit between Gefahren and Wasser */}
                  {onPickShape && cat === FORMEN_AFTER_CAT && (
                    <section>
                      <div className="sym-ghead">{appConfig.copy.shapes.sectionTitle}</div>
                      <div className="sym-grid">
                        {FORMEN_ORDER.map((kind) => <ShapeCell key={kind} kind={kind} onPick={onPickShape} />)}
                      </div>
                    </section>
                  )}
                </Fragment>
              ))}
            </>
          )}
        </div>
      </div>
    </>
  ), document.body)
}
