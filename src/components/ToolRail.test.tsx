// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { ToolRail } from './ToolRail'
import { appConfig } from '../config/appConfig'
import { slimTools, MAP_READONLY_TOOLS } from '../lib/readOnlyTools'
import { loadPrefs, savePrefs } from '../lib/prefs'

afterEach(() => { cleanup(); document.cookie = 'kp-front-prefs=; max-age=0; path=/' })

/** jsdom has no `matchMedia`, and the rail asks it whether this is a phone (lib/useIsPhone) —
 *  the bar folds there. Every suite below is the vertical rail unless it says otherwise. */
let phone = false
beforeEach(() => {
  phone = false
  window.matchMedia = ((query: string) => ({
    matches: phone, media: query, onchange: null,
    addEventListener: () => {}, removeEventListener: () => {},
    addListener: () => {}, removeListener: () => {}, dispatchEvent: () => false,
  })) as typeof window.matchMedia
})

// The rail a locked surface gets is the SAME component with a smaller tool list — same place,
// same look, same footer. What must never appear is a tool that writes.
describe('the read-only tool rail', () => {
  const renderSlim = (onPick = vi.fn()) => {
    render(<ToolRail
      className="tool-rail"
      primary={appConfig.copy.primarySymbol}
      tools={slimTools(appConfig.copy.mapTools, MAP_READONLY_TOOLS)}
      active="select"
      onPick={onPick}
      footer={<button>{appConfig.copy.nav.zoomIn}</button>}
    />)
    return onPick
  }

  it('offers Auswahl and Messen', () => {
    renderSlim()
    expect(screen.getByRole('button', { name: 'Auswahl' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Messen' })).toBeTruthy()
  })

  it('offers nothing that would change the Lage', () => {
    renderSlim()
    for (const label of ['Symbol', 'Linie', 'Fläche', 'Absperrkreis', 'Notiz', 'Trupp', 'Mehrfach']) {
      expect(screen.queryByRole('button', { name: label })).toBeNull()
    }
  })

  it('keeps the pinned footer — a viewer still needs to zoom and reach Ebenen', () => {
    renderSlim()
    expect(screen.getByRole('button', { name: appConfig.copy.nav.zoomIn })).toBeTruthy()
  })

  it('picks by the same ids the editor rail uses', () => {
    const onPick = renderSlim()
    fireEvent.click(screen.getByRole('button', { name: 'Messen' }))
    expect(onPick).toHaveBeenCalledWith('measure')
  })
})

// ── Auswahl ↔ Mehrfach share ONE rail slot (05.09.) ──────────────────────────────────────────
// Two selection tools cost two rows of a rail that has none to spare, and Mehrfach is reached
// often enough to need a button but rarely enough not to own one. So the second tap on the armed
// Auswahl arms the marquee — and the button then WEARS it: glyph, word, tooltip and accessible
// name all swap, because a mode nobody can see on the button is a mode nobody can leave.
describe('the two-state Auswahl', () => {
  type Tools = React.ComponentProps<typeof ToolRail>['tools']
  const renderRail = (tools: Tools, active: string) => {
    const onPick = vi.fn()
    render(<ToolRail
      className="tool-rail"
      primary={appConfig.copy.primarySymbol}
      tools={tools}
      active={active}
      onPick={onPick}
      footer={<button>{appConfig.copy.nav.zoomIn}</button>}
    />)
    return onPick
  }

  // both surfaces, one interaction — the Karte's Auswahl is 'select', the Plan's is 'pan'
  for (const [surface, tools, selectId] of [
    ['Karte', appConfig.copy.mapTools, 'select'],
    ['Plan', appConfig.copy.planTools, 'pan'],
  ] as const) {
    describe(surface, () => {
      it('shows one selection button, not two', () => {
        renderRail(tools, selectId)
        expect(screen.getByRole('button', { name: 'Auswahl' })).toBeTruthy()
        expect(screen.queryByRole('button', { name: 'Mehrfach' })).toBeNull()
      })

      it('arms Mehrfach on the second tap, and says so on the button', () => {
        const onPick = renderRail(tools, selectId)
        fireEvent.click(screen.getByRole('button', { name: 'Auswahl' }))
        expect(onPick).toHaveBeenCalledWith('lasso')
        cleanup()
        renderRail(tools, 'lasso')
        const btn = screen.getByRole('button', { name: 'Mehrfach' })
        expect(btn.getAttribute('aria-pressed')).toBe('true')
        expect(btn.getAttribute('title')).toBe('Mehrfach')
        expect(btn.querySelector('.vrail-label')?.textContent).toBe('Mehrfach')
      })

      it('goes back to Auswahl on the tap after that', () => {
        const onPick = renderRail(tools, 'lasso')
        fireEvent.click(screen.getByRole('button', { name: 'Mehrfach' }))
        expect(onPick).toHaveBeenCalledWith(selectId)
      })

      // coming from another tool the button is still just «Auswahl» — the first tap arms it, and
      // only a tap on the ARMED button reaches the second state
      it('arms plain Auswahl from another tool', () => {
        const onPick = renderRail(tools, 'line')
        const btn = screen.getByRole('button', { name: 'Auswahl' })
        expect(btn.getAttribute('aria-pressed')).toBe('false')
        fireEvent.click(btn)
        expect(onPick).toHaveBeenCalledWith(selectId)
      })
    })
  }
})

// «Einstellungen · Beschriftung der Werkzeugleisten» says «Wort unter jedem Zeichen in den BEIDEN Leisten».
// It reached the Lage rail and not the Plan's, because Whiteboard rendered this same component
// without the prop — one setting, two rails, one of them not listening. The class is what the
// stylesheet keys the words off, so it is what gets pinned here.
describe('the Beschriftung device preference', () => {
  const renderRail = (labels?: 'off' | 'short') =>
    render(<ToolRail
      className="tool-rail"
      primary={appConfig.copy.primarySymbol}
      tools={appConfig.copy.mapTools}
      active="select"
      onPick={vi.fn()}
      labels={labels}
      footer={<button>{appConfig.copy.nav.zoomIn}</button>}
    />)

  it('carries the labelled class when the preference is on', () => {
    const { container } = renderRail('short')
    expect(container.querySelector('.vrail.labelled')).toBeTruthy()
  })

  it('does not when it is off, or absent', () => {
    const { container } = renderRail('off')
    expect(container.querySelector('.vrail.labelled')).toBeNull()
    cleanup()
    const bare = renderRail()
    expect(bare.container.querySelector('.vrail.labelled')).toBeNull()
  })

  it('renders the word for every tool either way — the stylesheet decides if it shows', () => {
    // the label element must EXIST unconditionally; .labelled only flips its display
    renderRail('short')
    expect(screen.getByRole('button', { name: 'Messen' }).querySelector('.vrail-label')?.textContent)
      .toBe('Messen')
  })
})

// The Karte and every Modul mount their own ToolRail, but the operator reads them as ONE
// sidebar — an expansion made on one surface survives the remount on the next.
it('keeps its expanded state across a remount (surface switch)', () => {
  const props = () => ({
    className: 'tool-rail',
    primary: appConfig.copy.primarySymbol,
    tools: slimTools(appConfig.copy.mapTools, MAP_READONLY_TOOLS),
    active: 'select',
    onPick: vi.fn(),
    footer: <button>{appConfig.copy.nav.zoomIn}</button>,
  })
  const first = render(<ToolRail {...props()} />)
  fireEvent.click(screen.getByRole('button', { name: 'Ausklappen' }))
  expect(document.querySelector('.vrail.expanded')).toBeTruthy()
  first.unmount()
  render(<ToolRail {...props()} />)
  expect(document.querySelector('.vrail.expanded')).toBeTruthy()
  // …and collapsing writes back, so the next mount starts closed again
  fireEvent.click(screen.getByRole('button', { name: 'Einklappen' }))
  expect(document.querySelector('.vrail.expanded')).toBeNull()
})

// ── the scroll-for-more edge, on the axis that actually scrolls ──────────────────────────────
// On a phone this rail is a horizontal BAR, and its fade used to be painted unconditionally
// because the mechanic only ever measured `scrollTop` (lib/useRail). That put a "more this way"
// edge over the last tool on a bar already sitting at its end.
describe('the rail marks the edge that still has tools behind it', () => {
  // jsdom lays nothing out, so the port's metrics are stubbed the way a phone bar's are:
  // a horizontal scroller narrower than its content, with the vertical axis flat.
  const port = (scrollLeft: number, clientWidth = 300) => {
    const el = document.querySelector('.vrail-scroll') as HTMLElement
    el.style.flexDirection = 'row'   // the bar shape — what lib/useRail reads the axis off
    for (const [k, v] of [['clientWidth', clientWidth], ['scrollWidth', 600], ['scrollLeft', scrollLeft]] as const) {
      Object.defineProperty(el, k, { configurable: true, value: v })
    }
    fireEvent.scroll(el)
    return el
  }
  const renderBar = () => render(<ToolRail
    className="tool-rail"
    primary={appConfig.copy.primarySymbol}
    tools={appConfig.copy.mapTools}
    active="select"
    onPick={vi.fn()}
    footer={<button>{appConfig.copy.nav.zoomIn}</button>}
  />)

  it('marks both ends mid-scroll', () => {
    renderBar()
    const el = port(120)
    expect(el.classList.contains('more-top')).toBe(true)
    expect(el.classList.contains('more-bottom')).toBe(true)
  })

  it('drops the end marker once the last tool is reached', () => {
    renderBar()
    const el = port(300)
    expect(el.classList.contains('more-top')).toBe(true)
    expect(el.classList.contains('more-bottom')).toBe(false)
  })

  it('marks nothing when every tool fits', () => {
    renderBar()
    const el = port(0, 600)
    expect(el.classList.contains('more-top')).toBe(false)
    expect(el.classList.contains('more-bottom')).toBe(false)
  })
})

// PHONE: the bar keeps Auswahl · «+ Hinzufügen» · Messen; everything that is PLACED lives in the
// «+» sheet (lib/toolFold, components/Palette).
describe('the phone bar', () => {
  const renderPhone = (active: string, onPick = vi.fn()) => {
    phone = true
    render(<ToolRail
      className="tool-rail"
      primary={appConfig.copy.primarySymbol}
      tools={appConfig.copy.mapTools}
      active={active}
      onPick={onPick}
      footer={null}
    />)
    return onPick
  }
  const ADD = () => appConfig.copy.addSheet.tile

  it('shows Auswahl · Hinzufügen · Messen and none of the tools that moved into the sheet', () => {
    renderPhone('select')
    for (const name of ['Auswahl', ADD(), 'Messen']) expect(screen.getByRole('button', { name })).toBeTruthy()
    for (const name of ['Linie', 'Fläche', 'Absperrkreis', 'Notiz', 'Trupp']) expect(screen.queryByRole('button', { name })).toBeNull()
  })

  it('opens the sheet on «+»', () => {
    const onPick = renderPhone('select')
    fireEvent.click(screen.getByRole('button', { name: ADD() }))
    expect(onPick).toHaveBeenCalledWith('symbol')
  })

  // «was macht mein nächster Tipp» is answered on the bar: the tile is lit and named after the tool
  it('wears the armed tool that came out of the sheet', () => {
    renderPhone('area')
    const tile = screen.getByRole('button', { name: 'Fläche' })
    expect(tile.getAttribute('aria-pressed')).toBe('true')
    expect(screen.queryByRole('button', { name: ADD() })).toBeNull()
  })

  // ⚠️ never onPick('area'): on both surfaces that would put the armed tool away instead
  it('still opens the sheet while it wears one', () => {
    const onPick = renderPhone('area')
    fireEvent.click(screen.getByRole('button', { name: 'Fläche' }))
    expect(onPick).toHaveBeenCalledWith('symbol')
    expect(onPick).not.toHaveBeenCalledWith('area')
  })

  it('leaves the vertical rail every tool and its old word', () => {
    render(<ToolRail className="tool-rail" primary={appConfig.copy.primarySymbol} tools={appConfig.copy.mapTools} active="select" onPick={vi.fn()} footer={null} />)
    for (const name of ['Linie', 'Trupp', appConfig.copy.primarySymbol.label]) expect(screen.getByRole('button', { name })).toBeTruthy()
  })
})

// «Tastenkürzel anzeigen» (lib/prefs · keyHints): each tool tile wears the letter the keyboard binds
describe('the shortcut letters', () => {
  const rail = (over: Partial<React.ComponentProps<typeof ToolRail>> = {}) => render(
    <ToolRail className="tool-rail" primary={appConfig.copy.primarySymbol} tools={appConfig.copy.mapTools}
      active="line" onPick={vi.fn()} footer={null} {...over} />)
  const letters = () => [...document.querySelectorAll('.vrail-tool .rail-key')].map((el) => el.textContent)

  it('are on every tool tile by default – Symbol included', () => {
    rail()
    // Auswahl · Symbol · Linie · Fläche · Absperrkreis · Notiz · Trupp · Messen
    expect(letters()).toEqual(['V', 'S', 'L', 'F', 'U', 'N', 'T', 'D'])
  })

  it('follow the Plan\'s own tool ids and the armed half of Auswahl', () => {
    rail({ tools: appConfig.copy.planTools, active: 'pan' })
    expect(letters()[0]).toBe('V')
    cleanup()
    rail({ active: 'lasso' })
    expect(letters()[0]).toBe('W') // the tile wears Mehrfach, and Mehrfach is W
  })

  it('are not rendered when the device pref is off', () => {
    savePrefs({ ...loadPrefs(), keyHints: false })
    rail()
    expect(letters()).toEqual([])
  })

  it('are not rendered on a rail whose surface binds no tool keys', () => {
    rail({ hotkeys: false })
    expect(letters()).toEqual([])
  })

  it('are not rendered on the phone\'s folded bar', () => {
    phone = true
    rail()
    expect(letters()).toEqual([])
  })
})
