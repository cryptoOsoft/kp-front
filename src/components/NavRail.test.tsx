// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest'
import { render, screen, cleanup, fireEvent, act } from '@testing-library/react'
import { NavRail } from './NavRail'
import type { PlanDocument } from '../types'
import { SURFACE_KEY } from '../lib/hotkeys'
import { loadPrefs, savePrefs } from '../lib/prefs'

afterEach(() => { cleanup(); document.cookie = 'kp-front-prefs=; max-age=0; path=/' })

const docs: PlanDocument[] = [
  { id: 'modul1', code: 'Modul 1', title: 'Übersicht', subtitle: '', imageUrl: '', orientation: 'portrait' },
  { id: 'modul5-rwa', code: 'RWA', title: 'RWA', subtitle: '', imageUrl: '', orientation: 'landscape' },
  { id: 'tafel', code: 'Tafel', title: 'Leeres Blatt', subtitle: '', imageUrl: '', orientation: 'landscape', icon: 'easel' },
]

function props(over: Partial<React.ComponentProps<typeof NavRail>> = {}) {
  return {
    mode: 'map' as const, onMode: vi.fn(), planDocs: docs, activePlanId: 'modul1',
    onSelectPlan: vi.fn(), ...over,
  }
}

function setup(over: Partial<React.ComponentProps<typeof NavRail>> = {}) {
  const p = props(over)
  render(<NavRail {...p} />)
  return p
}

/** setup() that can re-render with new props — for the async arrival of the plan tiles. */
function renderRail(over: Partial<React.ComponentProps<typeof NavRail>> = {}) {
  const view = render(<NavRail {...props(over)} />)
  return {
    rerender: (next: Partial<React.ComponentProps<typeof NavRail>>) =>
      view.rerender(<NavRail {...props(next)} />),
  }
}

describe('NavRail', () => {
  it('clicking Karte calls onMode("map")', () => {
    const p = setup()
    fireEvent.click(screen.getByRole('button', { name: 'Karte' }))
    expect(p.onMode).toHaveBeenCalledWith('map')
  })

  it('clicking a plan item calls onSelectPlan with its id', () => {
    const p = setup()
    fireEvent.click(screen.getByRole('button', { name: 'Modul 1' }))
    expect(p.onSelectPlan).toHaveBeenCalledWith('modul1')
  })

  it('clicking Checkliste calls onMode("checklists")', () => {
    const p = setup()
    fireEvent.click(screen.getByRole('button', { name: 'Checkliste' }))
    expect(p.onMode).toHaveBeenCalledWith('checklists')
  })

  it('reflects the active surface via aria-pressed', () => {
    setup({ mode: 'plans', activePlanId: 'modul1' })
    expect(screen.getByRole('button', { name: 'Karte' }).getAttribute('aria-pressed')).toBe('false')
    expect(screen.getByRole('button', { name: 'Modul 1' }).getAttribute('aria-pressed')).toBe('true')
    expect(screen.getByRole('button', { name: 'Tafel' }).getAttribute('aria-pressed')).toBe('false')
  })

  // (the object-switch footer item is gone from this rail for good: it went to the incident
  // dropdown in 2026-07-14 and from there onto the Plan surface — see Whiteboard · .wb-object)

  it('labels are hidden in compact and revealed by the expand toggle', () => {
    setup()
    // compact: the rail is not .expanded, so labels are display:none via CSS — assert the
    // toggle flips the rail into the expanded state (where the CSS reveals labels)
    const nav = screen.getByRole('navigation')
    expect(nav.className).not.toContain('expanded')
    fireEvent.click(screen.getByRole('button', { name: 'Ausklappen' }))
    expect(nav.className).toContain('expanded')
  })
})

// The chip lives in a 46px column and must fit inside it WITH its border — a three-letter
// acronym at the single-digit size pushed its own border off the rail. CSS can't count
// characters, so the letter count is stamped on the glyph and picks the size from there.
describe('monogram chip sizing', () => {
  it('stamps the letter count so the stylesheet can shrink a long monogram', () => {
    setup()
    const rwa = screen.getByRole('button', { name: 'RWA' })
    expect(rwa.querySelector('.nav-glyph.mono')?.getAttribute('data-mono-len')).toBe('3')
  })

  it('leaves a single-digit module at its full size', () => {
    setup()
    const modul1 = screen.getByRole('button', { name: 'Modul 1' })
    expect(modul1.querySelector('.nav-glyph.mono')?.getAttribute('data-mono-len')).toBe('1')
  })

  // The expanded rail's glyph column is one width for every row — the widest chip it holds — so
  // «RWA» neither paints through a 26px column nor pushes its own label out of line. The rail
  // states that width's input on itself; a rail of digits and icons states nothing.
  it('stamps the longest monogram on the rail so the expanded column can be sized to it', () => {
    setup()
    expect(document.querySelector('.navrail')?.getAttribute('data-mono-max')).toBe('3')
  })
})

// A reload restores the surface from prefs, but the plan tiles are fetched afterwards — so on the
// first pass the active item is often not in the DOM yet, and once it arrives it lands in the
// middle of the list. The reveal effect therefore has to run again when planDocs change, or the
// bar stays parked at its start with the active item off screen.
describe('revealing the active surface', () => {
  const scrollIntoView = vi.fn()

  beforeEach(() => {
    scrollIntoView.mockClear()
    // jsdom has no scrollIntoView at all
    Element.prototype.scrollIntoView = scrollIntoView
  })

  it('reveals the active item on mount, without animating it', () => {
    setup({ mode: 'mittel' })
    expect(scrollIntoView).toHaveBeenCalledWith(expect.objectContaining({ behavior: 'auto' }))
  })

  it('looks again when the plan tiles arrive after boot', () => {
    const { rerender } = renderRail({ mode: 'plans', activePlanId: 'modul1', planDocs: [] })
    scrollIntoView.mockClear()
    rerender({ mode: 'plans', activePlanId: 'modul1', planDocs: docs })
    expect(scrollIntoView).toHaveBeenCalled()
  })
})

// ── the PHONE bar folds every plan document into ONE «Pläne» tile (18.09.2026) ──
describe('folded plan tile', () => {
  const tile = () => screen.getByRole('button', { name: /^Pläne/ })

  it('replaces the per-document tiles and names the loaded document', () => {
    setup({ fold: true, activePlanId: 'modul5-rwa' })
    expect(screen.queryByRole('button', { name: 'Modul 1' })).toBeNull()
    expect(tile().getAttribute('aria-label')).toBe('Pläne · RWA')
  })

  // ⚠️ ONE glyph and ONE word, like every tile beside it (18.09.2026). The glyph IS the loaded
  // document — the same chip/icon its own tile wears on the vertical rail — and the word is the
  // generic «Pläne». It used to stack chip + «Pläne» + the code, three lines in a 46px tile.
  it('wears the loaded document as its glyph, and «Pläne» as its only word', () => {
    setup({ fold: true, activePlanId: 'modul5-rwa' })
    expect(tile().querySelector('.nav-mono-chip')?.textContent).toBe('RWA')
    expect(tile().querySelector('.nav-label')?.textContent).toBe('Pläne')
    expect(tile().querySelector('.nav-sub')).toBeNull()
  })

  it('takes the icon of an icon-document just as the rail does', () => {
    setup({ fold: true, activePlanId: 'tafel' })
    // the Tafel is an icon doc, so there is no monogram chip at all — only its easel glyph
    expect(tile().querySelector('.nav-mono-chip')).toBeNull()
    expect(tile().querySelector('.nav-glyph svg')).toBeTruthy()
  })

  it('is absent with no plan document at all', () => {
    setup({ fold: true, planDocs: [] })
    expect(screen.queryByRole('button', { name: /^Pläne/ })).toBeNull()
  })

  it('a first tap from another surface opens the last-used plan — no chooser', () => {
    const p = setup({ fold: true, mode: 'map', activePlanId: 'tafel' })
    fireEvent.click(tile())
    expect(p.onSelectPlan).toHaveBeenCalledWith('tafel')
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('a second tap — the tile is already the surface — opens the chooser', () => {
    const p = setup({ fold: true, mode: 'plans', activePlanId: 'tafel' })
    fireEvent.click(tile())
    expect(p.onSelectPlan).not.toHaveBeenCalled()
    expect(screen.getByRole('option', { name: /Modul 1/ })).toBeTruthy()
  })

  it('picking a row switches the document and closes the chooser', () => {
    const p = setup({ fold: true, mode: 'plans', activePlanId: 'tafel' })
    fireEvent.click(tile())
    fireEvent.click(screen.getByRole('option', { name: /Modul 1/ }))
    expect(p.onSelectPlan).toHaveBeenCalledWith('modul1')
    expect(screen.queryByRole('option', { name: /Modul 1/ })).toBeNull()
  })

  // …and the hold is the second door into the list, from wherever you are standing (the app's
  // own useLongPress: 500 ms, cancelled by any movement)
  it('a hold on the tile opens the chooser without switching surface', () => {
    vi.useFakeTimers()
    try {
      const p = setup({ fold: true, mode: 'map', activePlanId: 'tafel' })
      const btn = tile() // …held on to: the open sheet marks the rail behind it inert
      fireEvent.pointerDown(btn, { clientX: 10, clientY: 10 })
      act(() => { vi.advanceTimersByTime(600) })
      expect(screen.getByRole('option', { name: /Modul 1/ })).toBeTruthy()
      // the click the browser still delivers on release must not ALSO be taken as the tap
      fireEvent.click(btn)
      expect(p.onSelectPlan).not.toHaveBeenCalled()
    } finally { vi.useRealTimers() }
  })

  // ── five tiles on the phone: Karte · Pläne · Checkliste · Trupps · Rapport (18.09.2026) ──
  // Anwesenheit and Material gave up their tiles to the «Rapport» tile, which is the door to
  // all three; the vertical rail keeps a tile for each.
  it('leaves Anwesenheit and Material off the bar, and keeps them on the rail', () => {
    setup({ fold: true })
    expect(screen.queryByRole('button', { name: /^Anwesenheit/ })).toBeNull()
    expect(screen.queryByRole('button', { name: /^Material/ })).toBeNull()
    cleanup()
    setup()
    expect(screen.getByRole('button', { name: /^Anwesenheit/ })).toBeTruthy()
    expect(screen.getByRole('button', { name: /^Material/ })).toBeTruthy()
  })

  it('a single document never offers a chooser', () => {
    const p = setup({ fold: true, mode: 'plans', planDocs: [docs[0]], activePlanId: 'modul1' })
    fireEvent.click(tile())
    expect(screen.queryByRole('option')).toBeNull()
    expect(p.onSelectPlan).not.toHaveBeenCalled()
  })
})

// The badge on the folded «Einsatz» tile is what the Rapport still has OPEN (26.09.2026) — it was
// the head count, which read as «open» beside a Rapport chip saying another number. The whole
// chain (chip = Abschluss = badge = chooser row) is pinned in rapportOneCount.test.tsx.
describe('the open count on the Rapport tile', () => {
  const rapport = () => screen.getByRole('button', { name: /^(Rapport|Einsatz)/ })

  it('states the number in amber, and says it out loud in the chip\'s words', () => {
    setup({ fold: true, openCount: 6, presentCount: 3 })
    const badge = rapport().querySelector('.nav-count')
    expect(badge?.textContent).toBe('6')
    expect(badge?.classList.contains('nav-open')).toBe(true)
    expect(rapport().getAttribute('aria-label')).toBe('Einsatz · 6 offen')
  })

  // nothing open is nothing to say — and the head count never stands in for it
  it('paints nothing while nothing is open', () => {
    setup({ fold: true, openCount: 0, presentCount: 12 })
    expect(rapport().querySelector('.nav-count')).toBeNull()
    expect(rapport().getAttribute('aria-label')).toBe('Einsatz')
  })

  // on a tablet the Rapport has its own tile and its own chip, right there
  it('is a phone badge only', () => {
    setup({ openCount: 6 })
    expect(rapport().querySelector('.nav-count')).toBeNull()
  })

  it('caps a three-figure count so the badge stays a badge', () => {
    setup({ fold: true, openCount: 140 })
    expect(rapport().querySelector('.nav-count')?.textContent).toBe('99+')
  })
})

// ── the «Rapport» tile is the DOOR to a group of three pages on a folded bar ──
// Rapport · Anwesenheit · Material are three ordinary separate surfaces; on a phone they share
// one tile, which stays lit on all three and opens whichever of them was last used.
describe('the Rapport tile as the group door', () => {
  const rapport = () => screen.getByRole('button', { name: /^(Rapport|Einsatz)/ })

  it('stays lit on every page of the group', () => {
    for (const mode of ['rapport', 'anwesenheit', 'mittel'] as const) {
      cleanup()
      setup({ fold: true, mode })
      expect(rapport().getAttribute('aria-pressed')).toBe('true')
    }
  })

  // …and NOT on a tablet, where each of the three has a tile of its own and lighting the
  // Rapport's for the Anwesenheit would point at the wrong one of the two
  it('is lit for the Rapport alone on the vertical rail', () => {
    setup({ mode: 'anwesenheit' })
    expect(rapport().getAttribute('aria-pressed')).toBe('false')
    expect(screen.getByRole('button', { name: /^Anwesenheit/ }).getAttribute('aria-pressed')).toBe('true')
  })

  it('opens the page this device was last on', () => {
    const p = setup({ fold: true, rapportTarget: 'mittel' })
    fireEvent.click(rapport())
    expect(p.onMode).toHaveBeenCalledWith('mittel')
  })

  it('opens the Rapport itself when nothing says otherwise', () => {
    const p = setup({ fold: true })
    fireEvent.click(rapport())
    expect(p.onMode).toHaveBeenCalledWith('rapport')
  })

  // the target is a PHONE rule: on the rail the tile is one surface among seven and means it
  it('ignores the target on the vertical rail', () => {
    const p = setup({ rapportTarget: 'mittel' })
    fireEvent.click(rapport())
    expect(p.onMode).toHaveBeenCalledWith('rapport')
  })
})

// ⚠️ The «Rapport» tile behaves EXACTLY like the «Pläne» tile above it — one tile standing for a
// group, so one mechanic for both: tap from outside → the last page; tap again, or hold, → the
// list of three (19.09.2026). The rows carry the live count that says which page has something
// in it.
describe('the page chooser behind the Rapport tile', () => {
  const rapport = () => screen.getByRole('button', { name: /^(Rapport|Einsatz)/ })
  const rows = () => screen.queryAllByRole('option').map((r) => r.textContent)

  it('a tap from outside the group opens the last page — no list', () => {
    const p = setup({ fold: true, mode: 'map', rapportTarget: 'anwesenheit' })
    fireEvent.click(rapport())
    expect(p.onMode).toHaveBeenCalledWith('anwesenheit')
    expect(rows()).toEqual([])
  })

  it('a second tap — already inside the group — opens the three', () => {
    const p = setup({ fold: true, mode: 'mittel' })
    fireEvent.click(rapport())
    expect(p.onMode).not.toHaveBeenCalled()
    expect(rows().length).toBe(3)
  })

  it('…and so does a hold, from wherever you are standing', () => {
    vi.useFakeTimers()
    try {
      const p = setup({ fold: true, mode: 'map' })
      const btn = rapport()
      fireEvent.pointerDown(btn, { clientX: 10, clientY: 10 })
      act(() => { vi.advanceTimersByTime(600) })
      expect(rows().length).toBe(3)
      // the click the browser still delivers on release must not ALSO be taken as the tap
      fireEvent.click(btn)
      expect(p.onMode).not.toHaveBeenCalled()
    } finally { vi.useRealTimers() }
  })

  it('a row switches page and closes the list', () => {
    const p = setup({ fold: true, mode: 'rapport' })
    fireEvent.click(rapport())
    fireEvent.click(screen.getByRole('option', { name: /Material/ }))
    expect(p.onMode).toHaveBeenCalledWith('mittel')
    expect(rows()).toEqual([])
  })

  it('marks the page that is standing', () => {
    setup({ fold: true, mode: 'anwesenheit' })
    fireEvent.click(rapport())
    const on = screen.getAllByRole('option').filter((r) => r.getAttribute('aria-selected') === 'true')
    expect(on.map((r) => r.textContent?.startsWith('Anwesenheit'))).toEqual([true])
  })

  // the read-out is the whole reason the list is worth opening rather than guessing
  it('carries each page\'s live count', () => {
    setup({ fold: true, mode: 'rapport', openCount: 3, presentCount: 12, mittelCount: 5 })
    fireEvent.click(rapport())
    expect(screen.getByRole('option', { name: /^Rapport/ }).textContent).toContain('3 offen')
    expect(screen.getByRole('option', { name: /^Anwesenheit/ }).textContent).toContain('12 anwesend')
    expect(screen.getByRole('option', { name: /^Material/ }).textContent).toContain('5 Positionen')
  })

  // …and a zero is not a read-out, it is a row saying «nothing here» in a place nobody reads
  it('says nothing about a page that is still empty', () => {
    setup({ fold: true, mode: 'rapport' })
    fireEvent.click(rapport())
    expect(document.querySelectorAll('.group-choose-count').length).toBe(0)
  })

  // on the vertical rail each of the three has a tile, so a list of three answers no question
  it('is not offered on the vertical rail', () => {
    const p = setup({ mode: 'rapport' })
    fireEvent.click(rapport())
    expect(p.onMode).toHaveBeenCalledWith('rapport')
    expect(rows()).toEqual([])
  })
})

// ⚠️ Five tiles, one per group — a separator between «Pläne» and «Checkliste» divides a thing
// from a thing, and costs the five 10px of the 328px a 360px phone has.
describe('the folded bar carries no separators', () => {
  it('drops them when folded and keeps them on the rail', () => {
    const { container } = render(<NavRail {...props({ fold: true })} />)
    expect(container.querySelectorAll('.nav-sep').length).toBe(0)
    cleanup()
    const plain = render(<NavRail {...props()} />)
    expect(plain.container.querySelectorAll('.nav-sep').length).toBe(2)
  })

  it('marks the bar as folded so the stylesheet can share its width', () => {
    setup({ fold: true })
    expect(screen.getByRole('navigation').className).toContain('folded')
  })
})

// «Tastenkürzel anzeigen» (lib/prefs · keyHints): the surface letters are on the tiles by default
// and gone once the device switches them off (CSS then shows them on a mouse + keyboard only)
describe('the shortcut letters', () => {
  const letters = () => [...document.querySelectorAll('.rail-key')].map((el) => el.textContent)

  it('are on every surface tile by default, from the same table the keyboard reads', () => {
    setup()
    expect(letters()).toEqual(['K', 'C', 'A', 'P', 'M', 'R'])
    expect([...letters()].sort()).toEqual(Object.values(SURFACE_KEY).sort())
  })

  it('are not rendered when the device pref is off', () => {
    savePrefs({ ...loadPrefs(), keyHints: false })
    setup()
    expect(letters()).toEqual([])
  })
})
