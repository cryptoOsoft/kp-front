import { useState } from 'react'
import { Icon } from '../lib/icons'
import type { RailLabels } from '../lib/prefs'
import { appConfig } from '../config/appConfig'
import { RAIL_COMPACT, RAIL_LABELLED, RAIL_WIDE } from '../lib/navRail'
import { useRail } from '../lib/useRail'
import { useIsPhone } from '../lib/useIsPhone'
import { addFace, barTools } from '../lib/toolFold'
import { railToolKey } from '../lib/hotkeys'
import { useKeyHints } from '../lib/useDevicePrefs'

export interface ToolDef {
  id: string
  icon: string
  label: string
  /** render a group divider instead of a button */
  sep?: boolean
  /** render the `primary` (Symbol) button at this position instead of pinning it to the top */
  slot?: boolean
  /** The tool's SECOND state, sharing this rail slot (Auswahl ↔ Mehrfach, 05.09.). Tapping the
   *  button while it is already active switches to `alt`; tapping again switches back. The button
   *  then wears the alt's glyph AND word, so the mode is readable on the rail rather than hidden
   *  behind it — the 3am rule: recognition, not recall. */
  alt?: { id: string; icon: string; label: string }
}

interface Props {
  /** the ink "primary" button (Symbol); placed wherever the tool list carries a `slot` entry */
  primary: ToolDef
  /** the modal tool buttons */
  tools: readonly ToolDef[]
  /** the active tool id (lights its button) */
  active: string
  /** the active tool holds an OPEN drawing (a Punkte draft not saved yet): its tile wears an amber
   *  dot (27.10.2026) */
  open?: boolean
  onPick: (id: string) => void
  /** optional refs to each tool button, so a tool's option dock can top-align to it */
  toolRefs?: React.MutableRefObject<Record<string, HTMLButtonElement | null>>
  /** surface-specific buttons appended after the tools (e.g. the plan's Trails toggle) */
  extras?: React.ReactNode
  /** device pref: the tool's WORD under its glyph (lib/prefs · railLabels). This rail is where it
   *  earns most — «Auswahl», «Linie», «Fläche», «Messen» are short, real words, and nine glyphs
   *  with no text is the densest thing on the screen for anybody who does not know them. */
  labels?: RailLabels
  /** the surface binds the tool hotkeys (lib/hotkeys), so each tile may wear its letter. Default
   *  true – the Karte and the Plan; the Karte's viewer rail (Pin · Messen · ERG) has no keyboard
   *  layer and passes false, so «Messen» does not advertise a D that does nothing there. */
  hotkeys?: boolean
  /** pinned footer cluster — surface-specific (map nav vs plan zoom), rendered inside .vrail-nav */
  footer: React.ReactNode
  /** root class so each surface keeps its own selector hook (.tool-rail / .wb-tools) */
  className?: string
}

// the right rail mirrors the left NavRail's travel — compact shows glyphs only, expanded adds
// labels; it just opens leftward (anchored right) so the grip lives on the LEFT edge and the
// drag delta is inverted. The widths themselves are the shared RAIL_* geometry (lib/navRail).
/** …but the drag may be pulled further than the rail ever snaps to: a tool label is longer than a
 *  surface name, so this rail lets the finger keep going past the committed wide width. */
const MAXW = 280

// Shared right-edge vertical tool rail used by BOTH the Lage map and the Plan
// whiteboard: an expandable, icon-first rail (matching the left NavRail) with a
// scrolling tool section plus a pinned footer that always stays in reach. The
// Symbol "primary" button sits inline at the list's `slot` marker (between the
// selection and drawing groups), not pinned at the top. Each surface supplies its
// own tool list, optional extras, and footer; the shape + look (.vrail) are
// identical, so the two action sidebars stay in lockstep from one code object.
/** The rail's open state OUTLIVES its mount. The Karte and every Modul each mount their own
 *  ToolRail, but the operator reads them as ONE sidebar — expanded on the Karte and suddenly
 *  collapsed on the Modul read as the setting not sticking. Module-scoped (session) on purpose:
 *  wanting the words permanently is what the `railLabels` device pref is for. */
let lastExpanded = false

export function ToolRail({ primary, tools, active, open = false, onPick, toolRefs, extras, footer, className, labels, hotkeys = true }: Props) {
  const [expanded, setExpandedState] = useState(lastExpanded)
  const setExpanded = (v: boolean) => { lastExpanded = v; setExpandedState(v) }
  const nav = appConfig.copy.navRail
  // the tile's shortcut letter (lib/hotkeys · TOOL_KEY) – the same badge as the left rail, shown
  // by the device pref «Tastenkürzel anzeigen» (lib/prefs · keyHints) and, in CSS, only with a
  // mouse and keyboard. Not on the phone's folded bar: its «+» tile is a door to many tools.
  const [keyHints] = useKeyHints()
  // PHONE: the bar keeps Auswahl · «+» · Messen, and everything that PUTS SOMETHING ON THE
  // SURFACE moves into the «+» sheet (lib/toolFold, components/Palette) — five wide tiles with
  // the footer's two, nothing scrolls. The vertical rail has the room and is unchanged.
  const phone = useIsPhone()
  const bar = phone ? barTools(tools) : tools
  const keyHint = (toolId: string) => {
    const k = keyHints && hotkeys && !phone ? railToolKey(toolId) : undefined
    return k ? <span className="rail-key" aria-hidden>{k}</span> : null
  }
  /** the armed tool that came out of the sheet, which the «+» tile wears while it is armed */
  const face = phone ? addFace(tools, active) : null

  // The rail mechanic — scroll edges, nudge, reveal, width publish, grip — is lib/useRail,
  // shared with the left NavRail. Only the content and the policy below are this rail's own.
  // ⚠️ The width goes out as `--vrail-w` (the left rail's is `--rail-w`) and is RELEASED on
  // unmount: the Karte and every Modul mount their own ToolRail, and a width from the other
  // surface's rail must not leak across.
  const rail = useRail({
    varName: '--vrail-w',
    compactW: labels === 'short' ? RAIL_LABELLED : RAIL_COMPACT,
    wideW: RAIL_WIDE,
    maxW: MAXW,
    side: 'right',
    expanded, setExpanded,
    labels,
    itemCount: tools.length,
    activeSelector: '.vrail-tool.on',
    revealKey: active,
    releaseOnUnmount: true,
  })

  // a two-state tool (Auswahl ↔ Mehrfach) wears whichever half is armed, and a tap while
  // armed flips to the other one — so one slot carries both without a hidden mode: the
  // glyph, the word, the tooltip and the accessible name all say which state you are in.
  const toolButton = (t: ToolDef) => {
    const alt = t.alt && active === t.alt.id ? t.alt : null
    const on = active === t.id || alt !== null
    const shown = alt ?? t
    const target = alt ? t.id : (on && t.alt ? t.alt.id : t.id)
    return (
      <button
        key={t.id}
        ref={toolRefs ? (el) => { toolRefs.current[t.id] = el } : undefined}
        // `vrail-grp` is the corner mark «this tile holds more than one thing» — the two-state
        // Auswahl wears the one the nav bar's «Pläne» and «Einsatz» wear (phone only, 15-mobile.css)
        className={`vrail-tool ${on ? 'on' : ''}${t.alt ? ' vrail-grp' : ''}${on && open ? ' open' : ''}`}
        title={shown.label}
        aria-label={shown.label}
        aria-pressed={on}
        onClick={() => onPick(target)}
      >
        <span className="vrail-glyph"><Icon id={shown.icon} /></span><span className="vrail-label">{shown.label}</span>
        {keyHint(shown.id)}
      </button>
    )
  }

  return (
    <aside className={`vrail rail${expanded ? ' expanded' : ''}${rail.dragging ? ' dragging' : ''}${labels === 'short' ? ' labelled' : ''}${phone ? ' folded' : ''} ${className ?? ''}`}>
      {/* ⚠️ NO «Ausklappen» while the words are on. The chevron exists to reveal exactly what this
          setting already shows — with it on, expanding buys 128px of nothing but a second label
          position. It stays for everybody else, which is who it was for: somebody who does not
          know the glyphs yet and wants the names once, without a trip to the Einstellungen. */}
      {labels !== 'short' && (
        <button className="vrail-exp rail-exp" onClick={() => rail.apply(!expanded)} aria-label={expanded ? nav.collapse : nav.expand}>
          <span className="vrail-exp-ic rail-exp-ic"><Icon id="chevron" /></span><span className="rail-exp-t">{expanded ? nav.collapse : nav.expand}</span>
        </button>
      )}

      {/* tools — scroll if the list grows; the pinned footer below never scrolls away.
          The wrap carries an edge chevron whenever there are hidden tools above/below.
          ⚠️ Every rail element carries its own class AND the shared `rail-*` base (04b-rail.css):
          the base paints it, the `vrail-*` name is the hook the rest of the cascade keys off —
          the phone bar rules in 15-mobile.css use several of them. */}
      <div className="vrail-scroll-wrap rail-scroll-wrap">
      {rail.edge.top && <button type="button" className="vrail-more rail-more rail-more-up" aria-label={nav.scrollMore} onClick={() => rail.nudge(-1)}><Icon id="chevron-down" /></button>}
      {rail.edge.bottom && <button type="button" className="vrail-more rail-more rail-more-down" aria-label={nav.scrollMore} onClick={() => rail.nudge(1)}><Icon id="chevron-down" /></button>}
      <div ref={rail.scrollRef} className={`vrail-scroll rail-scroll${rail.edge.top ? ' more-top' : ''}${rail.edge.bottom ? ' more-bottom' : ''}`}>
        {bar.map((t) => {
          // Symbol renders inline among the tools (between selection and drawing) as a plain
          // tool — no special "primary" ink styling, lighting up like any other when active.
          // PHONE: it is «+ Hinzufügen», the one door to everything that is placed, and while a
          // tool out of its sheet is armed it is lit and wears THAT tool. ⚠️ A tap always opens
          // the sheet — never `onPick(face.id)`, which would re-arm or put the tool away
          // depending on a state nobody is looking at.
          if (t.slot) {
            const on = active === primary.id || face !== null
            const label = face?.label ?? (phone ? appConfig.copy.addSheet.tile : primary.label)
            return (
              <button
                key="__primary__"
                className={`vrail-tool ${on ? 'on' : ''}${face && open ? ' open' : ''}`}
                title={label}
                aria-label={label}
                aria-pressed={on}
                aria-haspopup={phone ? 'dialog' : undefined}
                onClick={() => onPick(primary.id)}
              >
                <span className="vrail-glyph"><Icon id={face?.icon ?? primary.icon} /></span><span className="vrail-label">{label}</span>
                {keyHint(primary.id)}
              </button>
            )
          }
          // a sentinel entry renders a group divider so the rail reads as clusters
          // (selection · symbol · create · annotate) instead of one undifferentiated stack
          if (t.sep) return <span key={t.id} className="vrail-sep" aria-hidden />
          return toolButton(t)
        })}
        {extras}
      </div>
      </div>

      {/* pinned footer — surface-specific nav cluster (map: compass·zoom·fit·coords / plan: zoom·fit·%) */}
      <div className="vrail-sep vrail-sep-foot" />
      <div className="vrail-nav">{footer}</div>

      {/* drag GRIP on the left edge — aria-label only (a native title pops the OS tooltip) */}
      <button className={`vrail-grip rail-grip${rail.dragging ? ' drag' : ''}`} aria-label={nav.resize} {...rail.gripProps} />
    </aside>
  )
}
