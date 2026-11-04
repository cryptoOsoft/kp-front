// @vitest-environment jsdom
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi, type Mock } from 'vitest'
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { useState } from 'react'
import type { BoardAnno, BuildingDoc, PlanDocument, Trupp } from '../types'
import { appConfig } from '../config/appConfig'
import { fillTemplate } from '../lib/format'
import type { SymbolsApi } from '../lib/useSymbols'
import { NODE_HOLD_ARM_MS, NODE_HOLD_FIRE_MS, NODE_HOLD_MOVE_PX } from '../lib/nodeHold'

// The OSM sheet fetches live footprints from the backend; the surface's CONTRACT is what is
// under test, so the outline component is stubbed down to the one thing it does — report how it
// was armed, and hand a picked footprint back.
const osm = vi.hoisted(() => ({ calls: [] as { interactive?: boolean }[] }))
const lastArmed = () => osm.calls[osm.calls.length - 1]?.interactive
vi.mock('./OsmOutline', () => ({
  OsmOutline: (p: { interactive?: boolean; onPick?: (src: [number, number][][], deg: number) => void }) => {
    osm.calls.push({ interactive: p.interactive })
    return <button onClick={() => p.onPick?.([[[0, 0], [1, 0], [1, 1]]], 0)}>Umriss</button>
  },
  prefetchOutlines: () => {},
}))

// the auto-commit release talks through the global toast pill — recorded here so the tests can
// read its text and press its «Rückgängig» without mounting the app-level toast host
// …and the asks go through the same recorder: `answer` is what the operator presses, which for
// every test that does not care is «Abbrechen» — nothing destroyed, exactly as an unanswered
// dialog would leave it.
const ui = vi.hoisted(() => ({
  toasts: [] as { text: string; action?: { label: string; onClick: () => void } }[],
  confirms: [] as { title?: string; message?: string }[],
  answer: false as boolean | 'alt',
  /** `hold` keeps the next question open until the test calls `release(answer)` */
  hold: false,
  release: null as ((v: boolean | 'alt') => void) | null,
}))
vi.mock('../lib/ui', async (importOriginal) => {
  const mod = await importOriginal<typeof import('../lib/ui')>()
  return {
    ...mod,
    toast: (text: string, opts?: { action?: { label: string; onClick: () => void } }) => { ui.toasts.push({ text, action: opts?.action }); return 1 },
    confirmDialog: (opts: { title?: string; message?: string }) => {
      ui.confirms.push(opts)
      if (ui.hold) return new Promise<boolean | 'alt'>((r) => { ui.release = r })
      return Promise.resolve(ui.answer)
    },
  }
})

import { Whiteboard } from './Whiteboard'
import { replayEmits } from '../lib/replay.test-utils'
import { endingOf } from '../lib/drawingEdit'

class RO { observe() {} unobserve() {} disconnect() {} }

beforeAll(() => {
  ;(globalThis as unknown as { ResizeObserver: unknown }).ResizeObserver ??= RO
  // jsdom implements no pointer capture; every drag handler on this surface claims it
  const el = Element.prototype as unknown as Record<string, unknown>
  el.setPointerCapture ??= () => {}
  el.releasePointerCapture ??= () => {}
  el.hasPointerCapture ??= () => false
  // jsdom has no matchMedia; pinned to «not a phone» (the rail is a side rail, not a bottom bar).
  window.matchMedia = ((q: string) => ({
    matches: false, media: q, onchange: null,
    addEventListener: () => {}, removeEventListener: () => {}, dispatchEvent: () => false,
  })) as unknown as typeof window.matchMedia
})
afterEach(() => { cleanup(); osm.calls.length = 0; ui.confirms.length = 0; ui.answer = false; ui.hold = false; ui.release = null })

const umrisse: PlanDocument = {
  id: 'osm', code: 'Umrisse', title: 'Gebäudeumrisse', subtitle: '', imageUrl: '',
  orientation: 'landscape', osm: { center: [7.6, 47.5], radiusM: 250 },
}
const tafel: PlanDocument = {
  id: 'tafel', code: 'Tafel', title: 'Leeres Blatt', subtitle: '', imageUrl: '', orientation: 'landscape',
}
const sym: SymbolsApi = { ready: false, error: false, reload: () => {}, order: [], symbols: [], byName: {} }
/** Mehrfach shares the Auswahl rail slot (05.09.): a second tap on the already-armed Auswahl arms
 *  the marquee, and the button then wears its glyph and word — which is what makes the mode
 *  visible instead of hidden. Every test that needs a boxed group goes through this door. */
const armMehrfach = () => {
  fireEvent.click(screen.getByRole('button', { name: 'Auswahl' }))
  expect(screen.getByRole('button', { name: 'Mehrfach' })).toBeTruthy()
}
// an annotation somebody drew on the Umrisse sheet BEFORE it became selection-only
const oldNote: BoardAnno = { id: 'a1', kind: 'text', x: 0.4, y: 0.4, floor: 0, text: 'Alte Notiz' }

const gebaeudeDoc: PlanDocument = {
  id: 'gebaeude', code: 'Gebäude', title: 'Gebäude', subtitle: '', imageUrl: '',
  orientation: 'portrait', icon: 'floors', floorStack: true,
}
const aBuilding: BuildingDoc = {
  ring: [[0, 0], [1, 0], [1, 1], [0, 1]], ringAspect: 1, floors: [0],
}

const renderBoard = (activeId: string, annos: BoardAnno[] = [], readOnly = false, building: BuildingDoc | null = null, objectAddress?: string) => {
  const onSelectBuilding = vi.fn()
  const onBuildingFace = vi.fn()
  // what the board would SAVE — the only way to read an edit that the DOM does not show
  const onChange = vi.fn()
  render(<Whiteboard
    plans={[umrisse, gebaeudeDoc, tafel]}
    activeId={activeId}
    annos={annos}
    onChange={onChange}
    building={building}
    onSelectBuilding={onSelectBuilding}
    onBuildingFace={onBuildingFace}
    onAddFloor={() => {}}
    onRemoveFloor={() => {}}
    readOnly={readOnly}
    slimTools
    sym={sym}
    onRecent={() => {}}
    log={() => {}}
    hist={{}}
    setHist={() => {}}
    focus={null}
    objectAddress={objectAddress}
  />)
  return { onSelectBuilding, onBuildingFace, onChange }
}

// «Umrisse» exists to pick the building that becomes the Gebäude view. A tool that could only
// annotate a live OSM backdrop is a tool that lies, so the whole drawing apparatus is gone here —
// deliberately NOT the Lage↔Plan parity the other plan surfaces keep.
describe('the Umrisse surface', () => {
  // Mehrfach is not in this list any more: it shares the Auswahl slot (05.09.) and only wears its
  // own word once armed, so it is checked through «Auswahl» below.
  const CREATE_TOOLS = ['Linie', 'Fläche', 'Notiz', 'Trupp']

  it('offers no tool at all — not even the read-only Auswahl · Messen rail', () => {
    renderBoard('osm')
    for (const label of [...CREATE_TOOLS, 'Auswahl', 'Mehrfach', 'Messen']) {
      expect(screen.queryByRole('button', { name: label })).toBeNull()
    }
  })

  it('keeps every tool on the Tafel — the rail is missing because of the SURFACE, not the build', () => {
    renderBoard('tafel')
    for (const label of [...CREATE_TOOLS, 'Auswahl']) {
      expect(screen.getByRole('button', { name: label })).toBeTruthy()
    }
    // …and Auswahl still carries Mehrfach as its second state
    armMehrfach()
  })

  it('still picks a building — the one interaction the sheet is for', () => {
    const { onSelectBuilding } = renderBoard('osm')
    expect(lastArmed()).toBe(true)
    fireEvent.click(screen.getByRole('button', { name: 'Umriss' }))
    expect(onSelectBuilding).toHaveBeenCalled()
  })

  it('does not pick for a locked/viewer session — that pick would rewrite the Gebäude', () => {
    renderBoard('osm', [], true)
    expect(lastArmed()).toBe(false)
  })

  it('still renders what was drawn here before the rule — the board is a synced document', () => {
    renderBoard('osm', [oldNote])
    expect(screen.getByText('Alte Notiz')).toBeTruthy()
  })
})

// ── The ONE «Gebäude» tile ──────────────────────────────────────────────────────────────────
// The rail lists the outline picker and the floor stack as one entry that morphs, so the way
// from one face to the other is a chip in the bottom-left row — and it exists exactly where
// there is somewhere to go. A door onto nothing would be worse than no door.
describe('the door between the two faces of the Gebäude tile', () => {
  const OTHER = 'Anderes Gebäude wählen'
  const BACK = 'Zurück zum Gebäude'

  it('offers no way back while no building has been picked yet', () => {
    renderBoard('osm')
    expect(screen.queryByRole('button', { name: OTHER })).toBeNull()
    expect(screen.queryByRole('button', { name: BACK })).toBeNull()
  })

  // Since sweep 28.10.2026 (#8) the stack's chip is the Plan sheet's door (it carries the scale's
  // lamp); «anderes Gebäude wählen» is that sheet's top row
  const stackChip = () => screen.getByRole('button', { name: /Gebäude und Massstab/ })

  it('sends the floor stack to the picker, through the sheet\'s top row', () => {
    const { onBuildingFace } = renderBoard('gebaeude', [], false, aBuilding)
    fireEvent.click(stackChip())
    fireEvent.click(screen.getByRole('button', { name: /anderes Gebäude wählen/ }))
    expect(onBuildingFace).toHaveBeenCalledWith('pick')
  })

  // ⚠️ The stack drops the Objekt read-out (it would repeat this very pill), so on the Gebäude
  // this is the ONLY thing on screen answering «which building am I standing in» (owner, 18.09.2026).
  it('wears the building\'s own name on the stack', () => {
    renderBoard('gebaeude', [], false, aBuilding, 'Mühlemattstrasse 8')
    expect(stackChip().textContent).toContain('Mühlemattstrasse 8')
    expect(stackChip().textContent).not.toContain(OTHER)
  })

  // nothing to name ⇒ the plan's own word, rather than «Kein Objekt» about a building that is
  // plainly there – and never the verb: the chip opens a sheet, it does not walk to the picker
  it('falls back to «Gebäude» when no object is bound', () => {
    renderBoard('gebaeude', [], false, aBuilding)
    expect(stackChip().textContent).toBe('Gebäude')
  })

  it('sends the picker back to the stack it already has', () => {
    const { onBuildingFace } = renderBoard('osm', [], false, aBuilding)
    fireEvent.click(screen.getByRole('button', { name: BACK }))
    expect(onBuildingFace).toHaveBeenCalledWith('stack')
  })

  // ⚠️ Reversed 25.09.2026 (3am test): the picker is NOT interactive for a locked session, so
  // «Anderes Gebäude wählen» led an `el` to outlines it could not tap and no «Übernehmen».
  // Locked, the sheet still reads the building and its scale – with no way to the picker.
  it('is no door for a locked session: the name stays as a read-out, the verb goes', () => {
    renderBoard('gebaeude', [], true, aBuilding, 'Mühlemattstrasse 8')
    fireEvent.click(stackChip())
    expect(screen.getByText('Mühlemattstrasse 8', { selector: '.list-row-title' })).toBeTruthy()
    expect(screen.queryByRole('button', { name: /anderes Gebäude wählen/i })).toBeNull()
  })

  it('…and with no name to read, a locked stack still reads «Gebäude» and its scale – no door', () => {
    renderBoard('gebaeude', [], true, aBuilding)
    expect(stackChip().textContent).toBe('Gebäude')
    expect(screen.queryByRole('button', { name: OTHER })).toBeNull()
  })

  it('the picker face keeps its way OUT for a locked session', () => {
    renderBoard('osm', [], true, aBuilding)
    expect(screen.getByRole('button', { name: BACK })).toBeTruthy()
  })
})

// ── Lage↔Plan parity: the halves that were map-only ─────────────────────────────────────────
// The rule is one rule: a Leitung, a Trupp and a Symbol behave the same whether you are looking
// at the Karte or at Modul 1. What follows guards the two places where the plan used to differ
// in KIND — not in styling — because a difference in kind is what makes an operator hesitate.

const TRUPPS: Trupp[] = [
  { id: 't1', name: 'Trupp 1', status: 'aktiv', members: [], pressure: 300, readings: [], startedAt: '' } as unknown as Trupp,
  { id: 't2', name: 'Trupp 2', status: 'raus', members: [], pressure: 300, readings: [], startedAt: '' } as unknown as Trupp,
]

const renderPlan = (annos: BoardAnno[], extra: Partial<React.ComponentProps<typeof Whiteboard>> = {}) => {
  const onChange = vi.fn()
  const board = (list: BoardAnno[]) => <Whiteboard
    plans={[tafel]} activeId="tafel" annos={list} onChange={onChange}
    building={null} onSelectBuilding={() => {}} onAddFloor={() => {}} onRemoveFloor={() => {}}
    sym={sym} onRecent={() => {}} log={() => {}} hist={{}} setHist={() => {}} focus={null}
    {...extra}
  />
  const utils = render(board(annos))
  /** the board as another device's merge leaves it: same props, new annos */
  const remoteWrite = (list: BoardAnno[]) => utils.rerender(board(list))
  return { ...utils, onChange, remoteWrite }
}

const chip: BoardAnno = { id: 'c1', kind: 'resource', x: 0.5, y: 0.5, floor: 0, text: 'Trupp 1', t: '03:12' }
const line: BoardAnno = { id: 'l1', kind: 'draw', pts: [[0.2, 0.2, 0], [0.8, 0.8, 0]], floor: 0 }
// the fat transparent hit surface WbInkLayer lays over each stroke — the only way to tap ink
const hitShape = (c: HTMLElement) => c.querySelector('.wb-ink-svg polyline[style], .wb-ink-svg polygon[style]')!

/* ── the chip's ONE trash (18.09.2026) ──────────────────────────────────────────────────────
 * A marker carrying a Spur asks which of the two goes; the rows that destroy the record confirm
 * first, and «Marker und Spur löschen» arms the incident's ghosting so nothing is left standing
 * (components/TwinTeamPill · lib/truppTrails).
 */
describe('the plan chip’s trash', () => {
  const W = appConfig.copy.whiteboard
  const walked: BoardAnno = {
    ...chip,
    trail: [{ x: 0.1, y: 0.1, floor: 0, t: '03:10' }, { x: 0.2, y: 0.2, floor: 0, t: '03:11' }],
  }
  const openTrash = () => {
    fireEvent.pointerDown(screen.getByText('Trupp 1'))
    fireEvent.click(screen.getByRole('button', { name: appConfig.copy.remove }))
  }

  it('takes the chip off the sheet without asking — its Spur stays behind as a ghost', () => {
    const onTrailDrop = vi.fn()
    const { onChange } = renderPlan([walked], { onTrailDrop })
    openTrash()
    fireEvent.click(screen.getByRole('menuitem', { name: W.removeMarker }))
    expect(onChange).toHaveBeenCalledWith([])
    expect(ui.confirms).toEqual([])           // the marker is not the record
    expect(onTrailDrop).not.toHaveBeenCalled() // …so the ghosting is left to do its work
  })

  it('«Marker und Spur löschen» asks first, then arms the ghosting and removes the chip', async () => {
    ui.answer = true
    const onTrailDrop = vi.fn()
    const { onChange } = renderPlan([walked], { onTrailDrop })
    openTrash()
    fireEvent.click(screen.getByRole('menuitem', { name: W.removeMarkerTrail }))
    await act(async () => {})
    expect(ui.confirms[0]?.message).toBe(
      fillTemplate(W.clearTrailConfirm, { name: 'Trupp 1', n: 2 }))
    expect(onTrailDrop).toHaveBeenCalledWith('c1', true)
    expect(onChange).toHaveBeenCalledWith([])
  })

  it('destroys nothing when that ask is declined — and takes its arming back', async () => {
    const onTrailDrop = vi.fn()
    const { onChange } = renderPlan([walked], { onTrailDrop })
    openTrash()
    fireEvent.click(screen.getByRole('menuitem', { name: W.removeMarkerTrail }))
    await act(async () => {})
    expect(ui.confirms).toHaveLength(1)
    expect(onChange).not.toHaveBeenCalled()
    expect(onTrailDrop).not.toHaveBeenCalled()
  })

  it('«Spur löschen» empties the trail and leaves the chip standing', async () => {
    ui.answer = true
    const { onChange } = renderPlan([walked])
    openTrash()
    fireEvent.click(screen.getByRole('menuitem', { name: W.clearTrail }))
    await act(async () => {})
    expect(onChange).toHaveBeenCalledWith([{ ...walked, trail: [] }])
  })
})

describe('the plan chip’s «Atemschutz-Trupp» menu (the map marker’s twin)', () => {
  const A = appConfig.copy.atemschutz

  it('joins a chip to a Trupp from the picture, not only from the AT card', () => {
    const onTeamTrupp = vi.fn()
    renderPlan([chip], { trupps: TRUPPS, onTeamTrupp })
    fireEvent.pointerDown(screen.getByText('Trupp 1'))
    fireEvent.click(screen.getByRole('button', { name: A.markerLabel }))
    fireEvent.click(screen.getByRole('menuitem', { name: 'Trupp 1' }))
    expect(onTeamTrupp).toHaveBeenCalledWith('c1', 't1')
  })

  // «Kein Trupp» exists only on a marker that hangs on a hose (15.09.): a chip on nothing switches
  // or creates its crew here, and leaves the picture through the trash can
  it('offers no «Kein Trupp» on a chip that hangs on no hose', () => {
    renderPlan([{ ...chip, truppId: 't1' }], { trupps: TRUPPS, onTeamTrupp: vi.fn() })
    fireEvent.pointerDown(screen.getByText('Trupp 1'))
    fireEvent.click(screen.getByRole('button', { name: A.markerLabel }))
    expect(screen.queryByRole('menuitem', { name: A.markerNone })).toBeNull()
  })

  // …the record of who WAS, not somebody to send: an out Trupp shows only where it is the one
  // standing here. Same filter as the map marker's menu.
  it('does not offer a Trupp that is already out', () => {
    renderPlan([chip], { trupps: TRUPPS, onTeamTrupp: vi.fn() })
    fireEvent.pointerDown(screen.getByText('Trupp 1'))
    fireEvent.click(screen.getByRole('button', { name: A.markerLabel }))
    expect(screen.queryByRole('menuitem', { name: 'Trupp 2' })).toBeNull()
  })

  it('has no menu at all where the join is not on offer (locked / no Atemschutz board)', () => {
    renderPlan([chip], { trupps: TRUPPS })
    fireEvent.pointerDown(screen.getByText('Trupp 1'))
    expect(screen.queryByRole('button', { name: A.markerLabel })).toBeNull()
  })

  // a bound chip's name is the TRUPP's, written on the Atemschutz board — renaming it here would
  // fork the two apart, which is exactly why the map marker drops its pen too
  it('drops the rename pen once the chip belongs to a Trupp', () => {
    renderPlan([{ ...chip, truppId: 't1' }], { trupps: TRUPPS, onTeamTrupp: vi.fn() })
    fireEvent.pointerDown(screen.getByText('Trupp 1'))
    expect(screen.queryByRole('button', { name: appConfig.copy.edit })).toBeNull()
  })
})

describe('a locked line on the plan (BoardAnno.locked — the twin of Drawing.locked)', () => {
  const D = appConfig.copy.drawingEditor

  it('opens its editor when it is NOT locked', () => {
    const { container } = renderPlan([line])
    fireEvent.pointerDown(hitShape(container))
    // …twice: the editor pins its action row at the sheet bottom AND inside the scrolling body
    // for phones, and CSS shows exactly one of them (DrawEditor · actions)
    expect(screen.getAllByRole('button', { name: new RegExp(D.lock) }).length).toBeGreaterThan(0)
  })

  // (the «beside Ebenen» case is gone with the Plan's Ebenen button, 15.09.2026 — the detail
  //  slot is the plan's alone now; see Whiteboard · editorSlotFree)
  it('has no Ebenen row in its rail footer – the panel it opened listed nothing', () => {
    renderPlan([line])
    expect(screen.queryAllByRole('button', { name: appConfig.copy.panels.layers })).toHaveLength(0)
  })

  it('is tap-through once locked — no selection, no editor, no drag', () => {
    const { container, onChange } = renderPlan([{ ...line, locked: true }])
    fireEvent.pointerDown(hitShape(container))
    fireEvent.pointerMove(hitShape(container), { clientX: 400, clientY: 400 })
    expect(screen.queryAllByRole('button', { name: new RegExp(D.lock) })).toHaveLength(0)
    expect(onChange).not.toHaveBeenCalled()
  })

  it('carries the unlock chip — its only tap target — and nothing else does', () => {
    const { container } = renderPlan([{ ...line, locked: true }])
    expect(container.querySelector('.wb-lock-anchor')).toBeTruthy()
    cleanup()
    const plain = renderPlan([line])
    expect(plain.container.querySelector('.wb-lock-anchor')).toBeNull()
  })

  // the clock is nodeHold's, not a number of this chip's own — «Entsperren» shares the one hold
  // every node handle uses, so the test asserts against that constant rather than pinning a
  // duplicate of it here (the drift the shared hook exists to prevent).
  it('unlocks on a short HOLD, never on a stray tap', () => {
    vi.useFakeTimers()
    const { onChange } = renderPlan([{ ...line, locked: true }])
    const held = screen.getByRole('button', { name: D.unlockHold })
    fireEvent.pointerDown(held)
    fireEvent.pointerUp(held) // a tap: the hold is cancelled, nothing changes
    vi.advanceTimersByTime(NODE_HOLD_FIRE_MS * 2)
    expect(onChange).not.toHaveBeenCalled()
    fireEvent.pointerDown(held)
    // still short of the fire time: the ring is filling, but nothing has happened yet
    vi.advanceTimersByTime(NODE_HOLD_FIRE_MS - 50)
    expect(onChange).not.toHaveBeenCalled()
    vi.advanceTimersByTime(100)
    expect(onChange).toHaveBeenCalled()
    expect(onChange.mock.calls[0][0][0].locked).toBeUndefined()
    vi.useRealTimers()
  })

  // movement is what separates «ich will das aufmachen» from «ich wollte etwas anderes treffen».
  // The ring is asserted BEFORE the move on purpose: without it this test would also pass if the
  // hold had never armed at all, which is exactly the bug it is supposed to catch.
  it('abandons the unlock when the finger slides off the chip', () => {
    vi.useFakeTimers()
    const { container, onChange } = renderPlan([{ ...line, locked: true }])
    const held = screen.getByRole('button', { name: D.unlockHold })
    fireEvent.pointerDown(held, { clientX: 0, clientY: 0 })
    act(() => { vi.advanceTimersByTime(NODE_HOLD_ARM_MS + 50) })
    expect(container.querySelector('.node-del.tone-unlock')).toBeTruthy()
    act(() => { fireEvent.pointerMove(window, { clientX: 0, clientY: NODE_HOLD_MOVE_PX + 6 }) })
    expect(container.querySelector('.node-del.tone-unlock')).toBeNull()
    act(() => { vi.advanceTimersByTime(NODE_HOLD_FIRE_MS * 2) })
    expect(onChange).not.toHaveBeenCalled()
    vi.useRealTimers()
  })
})

// sweep 28.10.2026, round 4 (owner: «I don't see the option to change the line type to wall and
// back in the map view, only in the building view»): «Art: Linie | Wand» on a FLAT sheet too
describe('«Art: Linie | Wand» on a flat plan', () => {
  const D = appConfig.copy.drawingEditor
  const art = () => within(screen.getAllByRole('group', { name: D.kind })[0])

  it('switches a drawn line to a Wand and back – one save each, the Wand look on it', () => {
    const { container, onChange, remoteWrite } = renderPlan([line])
    fireEvent.pointerDown(hitShape(container))
    fireEvent.click(art().getByRole('button', { name: D.kindWand }))
    expect(onChange).toHaveBeenCalledTimes(1)
    const wand = onChange.mock.calls[0][0][0] as BoardAnno
    expect(wand).toMatchObject({ role: 'wand', color: appConfig.drawing.colors[4], width: 2, pts: line.pts })
    remoteWrite([wand])
    fireEvent.click(art().getByRole('button', { name: D.kindLine }))
    expect(onChange.mock.calls[1][0][0]).toMatchObject({ role: undefined, color: appConfig.drawing.defaultColor, width: 5 })
  })

  it('offers «Wand» disabled, with the reason, while a Trupp is on the line', () => {
    const trupp = { id: 't1', name: 'Trupp 1', status: 'aktiv', entryPressureBar: 300, entryTime: '', lastContactTime: '', lineId: 'l1' } satisfies Trupp
    const { container } = renderPlan([line], { trupps: [trupp] })
    fireEvent.pointerDown(hitShape(container))
    expect((art().getByRole('button', { name: D.kindWand }) as HTMLButtonElement).disabled).toBe(true)
    expect(screen.getAllByText(D.kindWandBlocked).length).toBeGreaterThan(0)
  })
})

// ── The 29.08. Plan decisions ───────────────────────────────────────────────────────────────
// Messen left the rail (deliberate Lage↔Plan divergence), the floating delete orbs left the
// canvas (the detail panel is the one delete), a note opens on TAP like a symbol, the Punkte
// draft carries real vertex handles, and tap-away releases a draft instead of eating it.
// Plan round 3, 29.08.
describe('the Plan rail and its drafts', () => {
  const T = appConfig.copy.toolDock
  const W = appConfig.copy.whiteboard
  // toNorm and the handle layout need a real board rect, which jsdom never lays out.
  // ⚠️ The toast log is cleared BEFORE each test, not after: afterEach hooks run LIFO, so the
  // file-level cleanup() unmounts the previous board AFTER an afterEach here — and an unmount
  // with a live draft commits and toasts (leaving the document: nobody is left to ask), which
  // would leak into the next test.
  beforeEach(() => {
    ui.toasts.length = 0
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue({
      left: 0, top: 0, right: 400, bottom: 400, width: 400, height: 400, x: 0, y: 0, toJSON: () => ({}),
    } as DOMRect)
  })
  afterEach(() => { vi.restoreAllMocks() })

  const ink = (c: HTMLElement) => c.querySelector('.wb-ink')!
  const tapAt = (el: Element, x: number, y: number) => {
    fireEvent.pointerDown(el, { clientX: x, clientY: y, pointerId: 1 })
    fireEvent.pointerUp(el, { clientX: x, clientY: y, pointerId: 1 })
  }
  // three area taps, far enough apart that none reads as the double-tap finish
  const drawAreaDraft = (c: HTMLElement) => {
    fireEvent.click(screen.getByRole('button', { name: 'Fläche' }))
    tapAt(ink(c), 100, 100); tapAt(ink(c), 300, 100); tapAt(ink(c), 200, 300)
  }

  // Messen left the Plan rail on 29.08. and came BACK on 02.09. (field feedback: the quick
  // «wie weit?» glance kept reaching for it) — see usePlanMeasure's header.
  it('offers the Messen tool on the Plan again (02.09.)', () => {
    renderPlan([])
    expect(screen.getByRole('button', { name: 'Linie' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Messen' })).toBeTruthy()
  })

  // 08.10.: the Messen nodes are <button>s labelled «Gedrückt halten zum Löschen», and without
  // `data-holdaction` the app-wide hold-tooltip popped that label mid-ring and ate the release
  it('keeps the hold-tooltip off the Messen nodes — holding one IS the delete', () => {
    const { container } = renderPlan([], { planScale: { tafel: { mPerU: 100, refM: 10, ar: 1.414 } } })
    fireEvent.click(screen.getByRole('button', { name: 'Messen' }))
    tapAt(ink(container), 100, 100); tapAt(ink(container), 300, 100)
    const nodes = container.querySelectorAll('.measure-handle')
    expect(nodes).toHaveLength(2)
    for (const n of nodes) expect(n.hasAttribute('data-holdaction')).toBe(true)
  })

  it('keeps the slim read-only rail: Auswahl + Messen', () => {
    renderPlan([], { readOnly: true, slimTools: true })
    expect(screen.getByRole('button', { name: 'Auswahl' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Messen' })).toBeTruthy()
  })

  it('gives the in-progress Punkte draft real vertex grips and «+» inserts', () => {
    const { container } = renderPlan([])
    drawAreaDraft(container)
    expect(screen.getAllByRole('button', { name: W.dragVertex })).toHaveLength(3)
    // 2 open segments + the closing edge of the ring
    const inserts = screen.getAllByRole('button', { name: W.insertVertex })
    expect(inserts).toHaveLength(3)
    // pressing a «+» splices a node right there (and hands the same press its drag)
    fireEvent.pointerDown(inserts[0], { clientX: 200, clientY: 100, pointerId: 2 })
    expect(screen.getAllByRole('button', { name: W.dragVertex })).toHaveLength(4)
  })

  // sweep E.2: «Leeres Blatt – mit Linie … beschriften» sat under the first line being laid
  it('takes the empty-sheet hint away as soon as a draft is on the sheet', () => {
    const { container } = renderPlan([])
    expect(screen.getByText(W.blankHint)).toBeTruthy()
    drawAreaDraft(container)
    expect(screen.queryByText(W.blankHint)).toBeNull()
  })

  // 27.10.2026 (owner): leaving an open drawing asks «Speichern · Verwerfen · Weiterzeichnen»,
  // replacing the A6 auto-commit with its «Rückgängig» toast
  const answered = async (v: boolean | 'alt', leave: () => void) => {
    ui.answer = v
    leave()
    await act(async () => { await Promise.resolve() })
  }

  it('asks when an open drawing is left — «Speichern» commits it, one anno, no selection', async () => {
    const { container, onChange } = renderPlan([])
    drawAreaDraft(container)
    await answered(true, () => fireEvent.click(screen.getByRole('button', { name: 'Auswahl' })))
    expect(ui.confirms[0].title).toBe(fillTemplate(T.openTitle, { name: appConfig.copy.drawingEditor.area }))
    const committed = onChange.mock.calls[0][0]
    expect(committed).toHaveLength(1)
    expect(committed[0].kind).toBe('area')
    expect(committed[0].pts).toHaveLength(3)
    expect(screen.queryByRole('button', { name: W.dragVertex })).toBeNull()
  })

  it('«Speichern» answered after a remote write keeps that write – it saves onto the board as it is now', async () => {
    ui.hold = true
    const { container, onChange, remoteWrite } = renderPlan([])
    drawAreaDraft(container)
    fireEvent.click(screen.getByRole('button', { name: 'Auswahl' }))
    remoteWrite([line]) // another device's Linie lands while the question is open
    await act(async () => { ui.release!(true); await Promise.resolve() })
    const committed = onChange.mock.calls[onChange.mock.calls.length - 1][0] as BoardAnno[]
    expect(committed.map((a) => a.kind).sort()).toEqual(['area', 'draw'])
  })

  it('«Weiterzeichnen» hands the drawing back under its re-armed tool; «Verwerfen» drops it', async () => {
    const { container, onChange } = renderPlan([])
    drawAreaDraft(container)
    await answered(false, () => fireEvent.click(screen.getByRole('button', { name: 'Auswahl' })))
    expect(onChange).not.toHaveBeenCalled()
    expect(screen.getAllByRole('button', { name: W.dragVertex })).toHaveLength(3)
    await answered('alt', () => fireEvent.click(screen.getByRole('button', { name: 'Auswahl' })))
    expect(onChange).not.toHaveBeenCalled()
    expect(screen.queryByRole('button', { name: W.dragVertex })).toBeNull()
  })

  it('drops a fragment silently — nothing to ask about, nothing committed', () => {
    const { container, onChange } = renderPlan([])
    fireEvent.click(screen.getByRole('button', { name: 'Fläche' }))
    tapAt(ink(container), 100, 100); tapAt(ink(container), 300, 100) // a 2-point Fläche is nothing yet
    fireEvent.click(screen.getByRole('button', { name: 'Auswahl' }))
    expect(onChange).not.toHaveBeenCalled()
    expect(ui.confirms).toHaveLength(0)
    expect(ui.toasts).toHaveLength(0)
  })

  // CodeRabbit on #514 (28.10.2026): the sheet switch's release ran after the NEW sheet's writer
  // was installed (a layout effect), so the open drawing landed on the sheet switched TO
  it('a sheet switch commits the open drawing onto the sheet it was drawn on', () => {
    const other: PlanDocument = { ...tafel, id: 'tafel2', title: 'Zweites Blatt' }
    const onOld = vi.fn(), onNew = vi.fn()
    const board = (activeId: string, onChange: typeof onOld) => <Whiteboard
      plans={[tafel, other]} activeId={activeId} annos={[]} onChange={onChange}
      building={null} onSelectBuilding={() => {}} onAddFloor={() => {}} onRemoveFloor={() => {}}
      sym={sym} onRecent={() => {}} log={() => {}} hist={{}} setHist={() => {}} focus={null} />
    const { container, rerender } = render(board('tafel', onOld))
    drawAreaDraft(container)
    rerender(board('tafel2', onNew))
    expect(onNew).not.toHaveBeenCalled()
    expect(onOld.mock.calls[onOld.mock.calls.length - 1]?.[0].map((a: BoardAnno) => a.kind)).toEqual(['area'])
  })

  it('Escape is a leave like any other — it asks too', async () => {
    const { container, onChange } = renderPlan([])
    drawAreaDraft(container)
    await answered('alt', () => fireEvent.keyDown(window, { key: 'Escape' }))
    expect(ui.confirms).toHaveLength(1)
    expect(onChange).not.toHaveBeenCalled()
    expect(screen.queryByRole('button', { name: W.dragVertex })).toBeNull()
  })

  it('shows no floating ✕ on a selected symbol — Löschen lives in its panel', () => {
    const { container } = renderPlan([{ id: 's1', kind: 'symbol', x: 0.5, y: 0.5, floor: 0, symbol: 'brand', label: 'Brand' }])
    fireEvent.pointerDown(container.querySelector('.wb-symbol')!)
    expect(container.querySelector('.wb-del')).toBeNull()
    // the ContextPanel opened by the same tap carries the delete — «Entfernen» on a symbol since
    // it also offers «Gelöscht / erledigt» (review item 21b)
    expect(screen.getAllByRole('button', { name: appConfig.copy.remove }).length).toBeGreaterThan(0)
  })

  it('opens a note’s panel on a plain TAP — the symbol grammar, no grips row', () => {
    const { container } = renderPlan([{ id: 'n1', kind: 'text', x: 0.5, y: 0.5, floor: 0, text: 'Hallo' }])
    expect(screen.queryByRole('button', { name: appConfig.copy.remove })).toBeNull()
    fireEvent.pointerDown(screen.getByText('Hallo'))
    expect(container.querySelector('.note-grips')).toBeNull()
    expect(screen.getAllByRole('button', { name: appConfig.copy.remove }).length).toBeGreaterThan(0)
  })
})

// ── The Grundriss preset on the Gebäude stack (27.10.2026) ──────────────────────────────────
// The Wand of the Linie is a plain ink with a `role`: drawn in Punkte, snapped (lib/planSnap,
// tested there), and the tool stays armed after each piece.
describe('the Grundriss preset', () => {
  const G = appConfig.copy.whiteboard.grundriss
  beforeEach(() => {
    ui.toasts.length = 0
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue({
      left: 0, top: 0, right: 400, bottom: 400, width: 400, height: 400, x: 0, y: 0, toJSON: () => ({}),
    } as DOMRect)
    // a measured viewport, or the board has no size and nothing has a pixel to snap in
    vi.spyOn(Element.prototype, 'clientWidth', 'get').mockReturnValue(1000)
    vi.spyOn(Element.prototype, 'clientHeight', 'get').mockReturnValue(800)
  })
  afterEach(() => { vi.restoreAllMocks() })

  const ink = () => document.querySelector('.wb-ink')!
  const tapAt = (x: number, y: number) => {
    fireEvent.pointerDown(ink(), { clientX: x, clientY: y, pointerId: 1 })
    fireEvent.pointerUp(ink(), { clientX: x, clientY: y, pointerId: 1 })
  }
  const armWand = () => {
    fireEvent.click(screen.getByRole('button', { name: 'Linie' }))
    fireEvent.click(screen.getByRole('button', { name: G.wand }))
  }
  /** the anno each commit added (the board's `annos` prop stays as rendered, so each call is one) */
  const added = (onChange: Mock) => onChange.mock.calls.map((c) => { const list = c[0] as BoardAnno[]; return list[list.length - 1] })

  it('locks a Wand near a right angle, finishes it on its last point, and stays armed', () => {
    const { onChange } = renderBoard('gebaeude', [], false, aBuilding)
    armWand()
    tapAt(150, 150); tapAt(250, 162) // ≈7° off level: the second point runs straight on, y stays the first's
    tapAt(251, 151) // the last point again: finished
    const [wall] = added(onChange)
    expect(wall).toMatchObject({ kind: 'draw', role: 'wand', color: appConfig.drawing.colors[4], width: 2 })
    expect(wall.pts).toHaveLength(2)
    expect(wall.pts![1][1]).toBeCloseTo(wall.pts![0][1], 6)
    // still armed: no selection, the preset still on, and the next tap starts the next piece
    expect(screen.getByRole('button', { name: G.wand }).getAttribute('aria-pressed')).toBe('true')
    tapAt(150, 250)
    expect(screen.getAllByRole('button', { name: appConfig.copy.whiteboard.dragVertex })).toHaveLength(1)
  })

  // round 3 (owner on staging: «dragging → snapping doesn't work yet»): a Wand stays open while it
  // is drawn, so its own nodes are what gets dragged – they snap like a tap, ring and all
  it('a node of the OPEN Wand dragged near another Wand lands on it, level, ring shown while it moves', () => {
    const cross: BoardAnno = { id: 'w9', kind: 'draw', role: 'wand', floor: 0, pts: [[0.6, 0.2, 0], [0.6, 0.8, 0]] }
    const { onChange } = renderBoard('gebaeude', [cross], false, aBuilding)
    armWand()
    tapAt(100, 200); tapAt(180, 200)
    const grip = document.querySelectorAll('.wb-vertex')[1]
    fireEvent.pointerDown(grip, { clientX: 180, clientY: 200, pointerId: 2 })
    fireEvent.pointerMove(grip, { clientX: 210, clientY: 203, pointerId: 2 })
    fireEvent.pointerMove(grip, { clientX: 236, clientY: 204, pointerId: 2 })
    expect(document.querySelector('.wb-snap-ring')).not.toBeNull()
    fireEvent.pointerUp(grip, { clientX: 236, clientY: 204, pointerId: 2 })
    tapAt(240, 200) // its last point again: finished
    const [wall] = added(onChange)
    expect(wall.pts).toHaveLength(2)
    expect(wall.pts![1][0]).toBeCloseTo(0.6, 6)
    expect(wall.pts![1][1]).toBeCloseTo(wall.pts![0][1], 6)
  })

  it('ends the piece where the next point goes straight back along it — one ↶ per piece', () => {
    const { onChange } = renderBoard('gebaeude', [], false, aBuilding)
    armWand()
    tapAt(150, 150); tapAt(250, 150)
    tapAt(200, 150) // back along the piece just drawn: that piece is saved, the next starts here
    expect(added(onChange)).toHaveLength(1)
    tapAt(200, 250); tapAt(200, 250)
    const [first, second] = added(onChange)
    expect(first.pts!.map((p) => p[0])).toEqual([150 / 400, 250 / 400])
    expect(second.pts!.map((p) => p[0])).toEqual([200 / 400, 200 / 400])
  })

  it('asks before a Wand moves to another storey, then starts there', async () => {
    const { onChange } = renderBoard('gebaeude', [], false, { ...aBuilding, floors: [0, 1] })
    armWand()
    tapAt(150, 50); tapAt(250, 50) // the top tile is the 1. OG
    ui.answer = true // «Speichern»
    tapAt(150, 300) // the EG
    await act(async () => { await Promise.resolve() })
    expect(ui.confirms[0].title).toBe(fillTemplate(appConfig.copy.toolDock.openTitle, { name: G.wand }))
    const [wall] = added(onChange)
    expect(wall).toMatchObject({ role: 'wand', floor: 1 })
    // the new piece has its first point on the EG
    expect(screen.getAllByRole('button', { name: appConfig.copy.whiteboard.dragVertex })).toHaveLength(1)
  })
})

// ── A23 · read-only never gets grips ────────────────────────────────────────────────────────
// The Karte states the rule and the reason (MapView · editDraw): «read-only never gets handles —
// grabbable-looking vertices would move under the finger and snap back, the worst kind of 3am
// lie». On the Plan they did more than lie: the surface's readOnly is broader than the write
// guard upstream, so on a phone with the Verlauf open the grips actually wrote.
describe('a locked plan surface hands out no reshape grips', () => {
  const W = appConfig.copy.whiteboard
  // `focus` is the door a read-only surface still has into a selection («Leitung zeigen», the
  // ContextPanel's Verbindungen list) — and it only opens once the board has been measured, so
  // jsdom needs a size for both the viewport (clientWidth) and the sheet (rect).
  beforeEach(() => {
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue({
      left: 0, top: 0, right: 400, bottom: 400, width: 400, height: 400, x: 0, y: 0, toJSON: () => ({}),
    } as DOMRect)
    vi.spyOn(Element.prototype, 'clientWidth', 'get').mockReturnValue(400)
    vi.spyOn(Element.prototype, 'clientHeight', 'get').mockReturnValue(400)
  })
  afterEach(() => { vi.restoreAllMocks() })
  const focused = (annoId: string) => ({ x: 0.5, y: 0.5, floor: 0, annoId, nonce: 1 })

  it('gives the selected Leitung its node grips while the surface is editable', () => {
    const { container } = renderPlan([line], { focus: focused('l1') })
    expect(container.querySelectorAll('.wb-vertex').length).toBeGreaterThan(0)
  })

  it('renders none of them read-only — no node, no «+», no Verlängern', () => {
    const { container } = renderPlan([line], { focus: focused('l1'), readOnly: true })
    expect(container.querySelectorAll('.wb-vertex')).toHaveLength(0)
    expect(container.querySelector('.wb-vins')).toBeNull()
    expect(container.querySelector('.wb-grow')).toBeNull()
  })

  it('writes nothing when a grip is dragged anyway (a stale handle, a synthetic event)', () => {
    const { container, onChange } = renderPlan([line], { focus: focused('l1') })
    const grip = container.querySelector('.wb-vertex')!
    cleanup()
    const locked = renderPlan([line], { focus: focused('l1'), readOnly: true })
    fireEvent.pointerDown(grip, { clientX: 100, clientY: 100, pointerId: 1 })
    fireEvent.pointerMove(grip, { clientX: 300, clientY: 300, pointerId: 1 })
    expect(onChange).not.toHaveBeenCalled()
    expect(locked.onChange).not.toHaveBeenCalled()
  })

  it('still opens the read-only editor — the EL may ask how long the Leitung is', () => {
    renderPlan([line], { focus: focused('l1'), readOnly: true })
    expect(screen.getByText(appConfig.copy.drawingEditor.drawing)).toBeTruthy()
    expect(screen.queryByRole('button', { name: W.dragVertex })).toBeNull()
  })
})

// ── A4 · Absperrkreis / Gefahrenradius on the Plan ──────────────────────────────────────────
// The one object type that existed on the Karte and nowhere else. A cordon is a POINT with an
// extent — centre plus a radius stored as a fraction of the plan width (types · BoardAnno.radiusN)
// — so it is placed, moved and sized by the Karte's own gestures, and only its metres wait for
// the sheet's Maßstab.
describe('the Absperrkreis on a plan', () => {
  const W = appConfig.copy.whiteboard
  const C = appConfig.drawing
  beforeEach(() => {
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue({
      left: 0, top: 0, right: 400, bottom: 400, width: 400, height: 400, x: 0, y: 0, toJSON: () => ({}),
    } as DOMRect)
    vi.spyOn(Element.prototype, 'clientWidth', 'get').mockReturnValue(400)
    vi.spyOn(Element.prototype, 'clientHeight', 'get').mockReturnValue(400)
  })
  afterEach(() => { vi.restoreAllMocks() })

  const cordon: BoardAnno = { id: 'k1', kind: 'circle', x: 0.5, y: 0.5, floor: 0, radiusN: 0.2, color: C.circleColor }
  const ink = (c: HTMLElement) => c.querySelector('.wb-ink')!
  const ring = (c: HTMLElement) => c.querySelector('.wb-ink-svg circle[style]')!
  const placed = (onChange: ReturnType<typeof vi.fn>) => onChange.mock.calls[onChange.mock.calls.length - 1][0] as BoardAnno[]

  it('is dragged out from its centre, exactly like the Karte’s', () => {
    const { container, onChange } = renderPlan([])
    fireEvent.click(screen.getByRole('button', { name: 'Absperrkreis' }))
    const el = ink(container)
    fireEvent.pointerDown(el, { clientX: 200, clientY: 200, pointerId: 1 })
    fireEvent.pointerMove(el, { clientX: 300, clientY: 200, pointerId: 1 })
    fireEvent.pointerUp(el, { clientX: 300, clientY: 200, pointerId: 1 })
    const [a] = placed(onChange)
    expect(a).toMatchObject({ kind: 'circle', x: 0.5, y: 0.5, floor: 0 })
    expect(a.radiusN).toBeCloseTo(0.25, 6) // 100 of 400 px
  })

  it('drops a real cordon on a tap alone — the tool never does «nothing»', () => {
    const { container, onChange } = renderPlan([])
    fireEvent.click(screen.getByRole('button', { name: 'Absperrkreis' }))
    const el = ink(container)
    fireEvent.pointerDown(el, { clientX: 200, clientY: 200, pointerId: 1 })
    fireEvent.pointerUp(el, { clientX: 200, clientY: 200, pointerId: 1 })
    expect(placed(onChange)[0].radiusN).toBe(C.circleInitialRadiusN)
  })

  it('paints its ring and, once tapped, hands over the radius grip', () => {
    const { container } = renderPlan([cordon])
    expect(container.querySelectorAll('.wb-ink-svg circle').length).toBeGreaterThan(0)
    expect(screen.queryByRole('button', { name: W.dragRadius })).toBeNull()
    fireEvent.pointerDown(ring(container), { clientX: 200, clientY: 200, pointerId: 1 })
    expect(screen.getByRole('button', { name: W.dragRadius })).toBeTruthy()
  })

  // a cordon is grabbed anywhere on its face, so the centre follows the DELTA — moving it to the
  // grab point would shift the ring out from under the hand
  it('moves by the pointer’s travel, not to the pointer', () => {
    const { container, onChange } = renderPlan([cordon])
    fireEvent.pointerDown(ring(container), { clientX: 280, clientY: 200, pointerId: 1 })
    fireEvent.pointerMove(ring(container), { clientX: 320, clientY: 200, pointerId: 1 })
    const [a] = placed(onChange)
    expect(a.x).toBeCloseTo(0.6, 6) // 0.5 + 40/400
    expect(a.y).toBeCloseTo(0.5, 6)
  })

  // ⚠️ 11.10.2026: the demo's 100 m Absperrkreis washed the whole Gebäude storey maroon — the
  // whole sheet inside it, its ring nowhere on the paper, so it said nothing there but the tint
  it('draws nothing of a cordon that holds the whole sheet — no wash, no grab surface, no lock chip', () => {
    const { container } = renderPlan([{ ...cordon, radiusN: 2, locked: true }])
    expect(container.querySelectorAll('.wb-ink-svg circle')).toHaveLength(0)
    expect(container.querySelector('.wb-lock-anchor')).toBeNull()
  })

  it('still draws a cordon whose ring crosses the sheet', () => {
    const { container } = renderPlan([{ ...cordon, radiusN: 0.6, locked: true }])
    expect(container.querySelectorAll('.wb-ink-svg circle').length).toBeGreaterThan(0)
    expect(container.querySelector('.wb-lock-anchor')).not.toBeNull()
  })

  it('states no metres on an uncalibrated sheet — that would be a number nobody measured', () => {
    const { container } = renderPlan([cordon])
    expect(container.querySelector('.wb-line-label')).toBeNull()
  })

  it('states its radius once the sheet is calibrated against its Maßstab', () => {
    // ar matches the landscape A4 the blank Tafel is measured at (1 / (1 / 1.414))
    const { container } = renderPlan([cordon], { planScale: { tafel: { mPerU: 100, refM: 10, ar: 1.414 } } })
    expect(container.querySelector('.wb-line-label')?.textContent).toMatch(/m$/)
  })

  it('never wears vertex grips — it is centre + radius, not a polyline', () => {
    const { container } = renderPlan([cordon])
    fireEvent.pointerDown(ring(container), { clientX: 200, clientY: 200, pointerId: 1 })
    expect(container.querySelectorAll('.wb-vertex')).toHaveLength(1) // the radius grip, nothing else
    expect(container.querySelector('.wb-vins')).toBeNull()
  })
})

// ── A8 · the placement magnet holds the board still ─────────────────────────────────────────
// The Karte pauses dragPan while a claim ring fills, with the reason written out (MapView ·
// placePanPaused): a finger holding still for the dwell wobbles past the pan slop, the pan that
// starts kills the claim AND eats the tap, and the ring can never be ridden to the end on a real
// device. The Plan kept its 8 px tap threshold live through the very same moment.
describe('the Rotation’s placement magnet pauses the board pan', () => {
  const S = appConfig.copy.shapes
  const symApi: SymbolsApi = {
    ready: true, error: false, reload: () => {}, order: ['Gefahren'],
    symbols: [{ cat: 'Gefahren', name: 'VKF Feuer', svg: '<svg viewBox="0 0 10 10"></svg>' }],
    byName: { 'VKF Feuer': '<svg viewBox="0 0 10 10"></svg>' },
  }
  const target: BoardAnno = { id: 's1', kind: 'symbol', x: 0.5, y: 0.5, floor: 0, symbol: 'VKF Feuer' }
  beforeEach(() => {
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue({
      left: 0, top: 0, right: 400, bottom: 400, width: 400, height: 400, x: 0, y: 0, toJSON: () => ({}),
    } as DOMRect)
    vi.spyOn(Element.prototype, 'clientWidth', 'get').mockReturnValue(400)
    vi.spyOn(Element.prototype, 'clientHeight', 'get').mockReturnValue(400)
  })
  afterEach(() => { vi.restoreAllMocks() })

  const armRotation = () => {
    fireEvent.click(screen.getByRole('button', { name: appConfig.copy.whiteboard.symbol }))
    fireEvent.click(screen.getByRole('button', { name: S.names.rotation }))
  }
  const shapes = (onChange: ReturnType<typeof vi.fn>) => {
    const last = onChange.mock.calls[onChange.mock.calls.length - 1]
    return ((last?.[0] ?? []) as BoardAnno[]).filter((a) => a.kind === 'shape')
  }

  it('rides a 9 px glove wobble on the target and still lays the point down', () => {
    const { container, onChange } = renderPlan([target], { sym: symApi })
    armRotation()
    const el = container.querySelector('.wb-ink')!
    // dead on the symbol (0.5/0.5 of a 400 px sheet), then the wobble the ring is meant to absorb
    fireEvent.pointerDown(el, { clientX: 200, clientY: 200, pointerId: 1 })
    fireEvent.pointerMove(el, { clientX: 209, clientY: 200, pointerId: 1 })
    fireEvent.pointerUp(el, { clientX: 209, clientY: 200, pointerId: 1 })
    // the second point finishes the run — it only exists if the first tap survived the wobble
    fireEvent.pointerDown(el, { clientX: 340, clientY: 340, pointerId: 1 })
    fireEvent.pointerUp(el, { clientX: 340, clientY: 340, pointerId: 1 })
    expect(shapes(onChange)).toHaveLength(1)
  })

  it('still lets a deliberate drag off the ring pan and lay nothing down', () => {
    const { container, onChange } = renderPlan([target], { sym: symApi })
    armRotation()
    const el = container.querySelector('.wb-ink')!
    fireEvent.pointerDown(el, { clientX: 200, clientY: 200, pointerId: 1 })
    fireEvent.pointerMove(el, { clientX: 380, clientY: 200, pointerId: 1 }) // well out of the ring
    fireEvent.pointerUp(el, { clientX: 380, clientY: 200, pointerId: 1 })
    fireEvent.pointerDown(el, { clientX: 340, clientY: 340, pointerId: 1 })
    fireEvent.pointerUp(el, { clientX: 340, clientY: 340, pointerId: 1 })
    expect(shapes(onChange)).toHaveLength(0) // that second tap is only the FIRST point now
  })

  // review sweep 23.09.2026: the Escape effect did not list `rotStart`, so its handler still saw
  // the null from before the first tap — Escape skipped the half-laid Rotation, and the next tap
  // finished a run the operator had just thrown away.
  it('Escape throws a half-laid Rotation away: the next tap is a FIRST point again', () => {
    const { container, onChange } = renderPlan([], { sym: symApi })
    armRotation()
    const el = container.querySelector('.wb-ink')!
    fireEvent.pointerDown(el, { clientX: 60, clientY: 60, pointerId: 1 })
    fireEvent.pointerUp(el, { clientX: 60, clientY: 60, pointerId: 1 })
    fireEvent.keyDown(window, { key: 'Escape' })
    fireEvent.pointerDown(el, { clientX: 340, clientY: 340, pointerId: 1 })
    fireEvent.pointerUp(el, { clientX: 340, clientY: 340, pointerId: 1 })
    expect(shapes(onChange)).toHaveLength(0)
  })
})

// ── the Rotation on the Kroki ────────────────────────────────────────────────────────────────
// Its box and its chrome, the halves of «Klickfläche wie beim Rechteck» and «gleiche Griffe wie
// bei der Fläche». The pad's own pixels are CSS (03-map.css · .shape-glyph::before, shared with
// the Karte); what the surface owes it is the two-sided box to hug.
describe('a Rotation on the plan sheet', () => {
  const S = appConfig.copy.shapes
  // a run stored the way both surfaces store one (lib/shapes · rotationBox)
  const loop: BoardAnno = { id: 'r1', kind: 'shape', shape: 'rotation', x: 0.5, y: 0.5, sizeN: 0.42, aspect: 0.13, rotation: 25, floor: 0 }
  const rect: BoardAnno = { id: 'q1', kind: 'shape', shape: 'square', x: 0.3, y: 0.3, sizeN: 0.1, floor: 0 }

  beforeEach(() => {
    vi.spyOn(Element.prototype, 'clientWidth', 'get').mockReturnValue(400)
    vi.spyOn(Element.prototype, 'clientHeight', 'get').mockReturnValue(400)
  })
  afterEach(() => { vi.restoreAllMocks() })

  it('draws the same pad host the Rechteck has — its own box, on its own bearing', () => {
    const { container } = renderPlan([rect])
    const sq = container.querySelector<HTMLElement>('.shape-glyph')!
    expect(parseFloat(sq.style.height)).toBeCloseTo(parseFloat(sq.style.width), 6)
    cleanup()
    const { container: c2 } = renderPlan([loop])
    const rot = c2.querySelector<HTMLElement>('.shape-glyph')!
    expect(parseFloat(rot.style.height)).toBeCloseTo(parseFloat(rot.style.width) * 0.13, 3)
    expect(rot.style.transform).toContain('rotate(25deg)')
  })

  // 01.09. vocabulary: on the object itself only GEOMETRY grips, and every one of them blue.
  // A Rotation is its two ends — each sets the run's length AND its bearing — so it carries no
  // rotate knob, no stem and no size grip; moving and turning the whole loop is the fixed bar's.
  it('wears its two end grips and nothing else — no knob, no stem, no size grip', () => {
    const { container } = renderPlan([loop])
    fireEvent.pointerDown(container.querySelector('.wb-shape')!)
    const ends = container.querySelectorAll('.handle.shape-end')
    expect(ends).toHaveLength(2)
    for (const g of ends) {
      expect(g.getAttribute('aria-label')).toBe(S.endHint)
      expect(g.hasAttribute('data-holdaction')).toBe(true)
    }
    expect(container.querySelector('.shape-stem')).toBeNull()
    expect(container.querySelector('.shape-rotate')).toBeNull()
    expect(container.querySelector('.shape-resize, .shape-width')).toBeNull()
    // …and no grip paints itself: the blue is the shared .shape-end rule, never an inline fill
    for (const g of ends) expect((g as HTMLElement).style.background).toBe('')
  })

})

// ── the fixed selection bar (components/SelectionBar) ────────────────────────────────────────
// It replaced the group pill AND the map's floating hub on 01.09.: one bar, in one place, for a
// single Linie, an Absperrkreis, a Form and a Mehrfach group alike.
describe('the plan’s selection bar', () => {
  const D = appConfig.copy.drawingEditor
  const R = appConfig.copy.shapes.rotate
  const bar = () => screen.queryByRole('toolbar', { name: D.selectionBar })
  const circle: BoardAnno = { id: 'k1', kind: 'circle', x: 0.5, y: 0.5, radiusN: 0.2, floor: 0 }
  const box: BoardAnno = { id: 'f1', kind: 'shape', shape: 'square', x: 0.3, y: 0.3, sizeN: 0.1, floor: 0, rotation: 10 }

  beforeEach(() => {
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue({
      left: 0, top: 0, right: 400, bottom: 400, width: 400, height: 400, x: 0, y: 0, toJSON: () => ({}),
    } as DOMRect)
    vi.spyOn(Element.prototype, 'clientWidth', 'get').mockReturnValue(400)
    vi.spyOn(Element.prototype, 'clientHeight', 'get').mockReturnValue(400)
  })
  afterEach(() => { vi.restoreAllMocks() })

  it('is absent until something is selected, then carries ✥ · ⟳ · Löschen', () => {
    const { container } = renderPlan([line])
    expect(bar()).toBeNull()
    fireEvent.pointerDown(hitShape(container))
    expect(bar()).toBeTruthy()
    expect(within(bar()!).getByRole('button', { name: D.move })).toBeTruthy()
    expect(within(bar()!).getByRole('button', { name: R })).toBeTruthy()
  })

  it('moves the whole selection by the ✥ drag, in one undo step', () => {
    const { container, onChange } = renderPlan([line])
    fireEvent.pointerDown(hitShape(container))
    const grip = within(bar()!).getByRole('button', { name: D.move })
    fireEvent.pointerDown(grip, { clientX: 100, clientY: 100, pointerId: 1 })
    fireEvent.pointerMove(grip, { clientX: 180, clientY: 100, pointerId: 1 }) // +80px of a 400px board
    fireEvent.pointerUp(grip, { clientX: 180, clientY: 100, pointerId: 1 })
    const moved = onChange.mock.calls[onChange.mock.calls.length - 1][0].find((a: BoardAnno) => a.id === 'l1')
    expect(moved.pts[0][0]).toBeCloseTo(0.4) // 0.2 + 80/400
    expect(moved.pts[1][0]).toBeCloseTo(1.0)
    expect(moved.pts[0][1]).toBeCloseTo(0.2) // untouched across
  })

  // ⚠️ post-mortem D2 (23.09.2026 19:00:55): the bar's release sent x/y/floor for a stroke — which
  // has none — so the event named no position and the replay folded nothing
  it('reports a stroke’s release with its POINTS — the frame it ended on — for ✥ and ⟳ alike', () => {
    const emit = vi.fn()
    const { container, onChange } = renderPlan([line], { emit })
    fireEvent.pointerDown(hitShape(container))
    const grip = within(bar()!).getByRole('button', { name: D.move })
    fireEvent.pointerDown(grip, { clientX: 100, clientY: 100, pointerId: 1 })
    fireEvent.pointerMove(grip, { clientX: 140, clientY: 100, pointerId: 1 })
    fireEvent.pointerUp(grip, { clientX: 180, clientY: 120, pointerId: 1 }) // the release moves on
    const written = onChange.mock.calls[onChange.mock.calls.length - 1][0].find((a: BoardAnno) => a.id === 'l1')
    const moves = emit.mock.calls.filter(([op]) => op === 'board.move')
    expect(moves).toHaveLength(1)
    expect(moves[0][1]).toEqual({ id: 'l1', pts: written.pts, planId: 'tafel' })
    expect(written.pts[0][0]).toBeCloseTo(0.4) // …the RELEASE frame, not the sample before it
    const dial = within(bar()!).getByRole('button', { name: R })
    fireEvent.pointerDown(dial, { clientX: 200, clientY: 200, pointerId: 1 })
    fireEvent.pointerMove(dial, { clientX: 260, clientY: 200, pointerId: 1 })
    fireEvent.pointerUp(dial, { clientX: 260, clientY: 200, pointerId: 1 })
    const turned = onChange.mock.calls[onChange.mock.calls.length - 1][0].find((a: BoardAnno) => a.id === 'l1')
    const all = emit.mock.calls.filter(([op]) => op === 'board.move')
    const last = all[all.length - 1]
    expect(last[1]).toEqual({ id: 'l1', pts: turned.pts, planId: 'tafel' })
  })

  it('writes a vertex back with the storey it was stored with — `[x, y]` stays `[x, y]`', () => {
    const bare: BoardAnno = { id: 'l1', kind: 'draw', pts: [[0.2, 0.2], [0.8, 0.8]] }
    const { container, onChange } = renderPlan([bare])
    fireEvent.pointerDown(hitShape(container))
    const grip = within(bar()!).getByRole('button', { name: D.move })
    fireEvent.pointerDown(grip, { clientX: 100, clientY: 100, pointerId: 1 })
    fireEvent.pointerMove(grip, { clientX: 140, clientY: 100, pointerId: 1 })
    fireEvent.pointerUp(grip, { clientX: 140, clientY: 100, pointerId: 1 })
    const moved = onChange.mock.calls[onChange.mock.calls.length - 1][0].find((a: BoardAnno) => a.id === 'l1')
    expect(moved.pts.map((p: number[]) => p.length)).toEqual([2, 2])
  })

  it('turns a Form about the selection centre and its own bearing with it', () => {
    const { container, onChange } = renderPlan([box])
    fireEvent.pointerDown(container.querySelector('.wb-shape')!)
    // the Form keeps its own knob on the glyph; the bar's is the one in the toolbar
    const dialBtn = within(bar()!).getByRole('button', { name: R })
    fireEvent.pointerDown(dialBtn, { clientX: 200, clientY: 200, pointerId: 1 })
    fireEvent.pointerMove(dialBtn, { clientX: 380, clientY: 200, pointerId: 1 }) // 180px = +90°
    fireEvent.pointerUp(dialBtn, { clientX: 380, clientY: 200, pointerId: 1 })
    const turned = onChange.mock.calls[onChange.mock.calls.length - 1][0].find((a: BoardAnno) => a.id === 'f1')
    expect(turned.rotation).toBe(100) // 10° + 90°
    // a single object turns about ITSELF, so it stays where it was
    expect(turned.x).toBeCloseTo(0.3)
    expect(turned.y).toBeCloseTo(0.3)
  })

  /**
   * ⚠️ 02.09., in lockstep with the Karte: a selected Form wears no halo and its body drags
   * nothing. Its grips are the precise ones; moving the whole thing is the bar's ✥, dragged for
   * the small adjustment or armed for the whole sheet. A body drag meant a reach for an end grip
   * that landed a few pixels short pulled the loop away instead.
   */
  it('gives a selected Form no halo, and no body drag either', () => {
    const { container, onChange } = renderPlan([box])
    const glyph = container.querySelector('.wb-shape')!
    fireEvent.pointerDown(glyph, { pointerId: 1, clientX: 100, clientY: 100 })
    expect(container.querySelector('.sel-halo')).toBeNull()
    fireEvent.pointerMove(glyph, { pointerId: 1, clientX: 200, clientY: 180 })
    fireEvent.pointerUp(glyph, { pointerId: 1, clientX: 200, clientY: 180 })
    const out = onChange.mock.calls[onChange.mock.calls.length - 1]?.[0] as BoardAnno[] | undefined
    expect(out?.find((a) => a.id === 'f1')?.x ?? 0.3).toBeCloseTo(0.3)
  })

  it('…while a placed symbol keeps its halo and its body drag', () => {
    const sym: BoardAnno = { id: 'y1', kind: 'symbol', symbol: 'Feuer', x: 0.3, y: 0.3, floor: 0 }
    const { container, onChange } = renderPlan([sym])
    const chip = container.querySelector('.wb-anno')!
    fireEvent.pointerDown(chip, { pointerId: 1, clientX: 100, clientY: 100 })
    expect(container.querySelector('.sel-halo')).toBeTruthy()
    fireEvent.pointerMove(chip, { pointerId: 1, clientX: 200, clientY: 100 })
    fireEvent.pointerUp(chip, { pointerId: 1, clientX: 200, clientY: 100 })
    const out = onChange.mock.calls[onChange.mock.calls.length - 1]?.[0] as BoardAnno[] | undefined
    expect(out?.find((a) => a.id === 'y1')?.x ?? 0.3).toBeGreaterThan(0.3)
  })

  it('offers no ⟳ for an Absperrkreis — a centre and a radius have no angle', () => {
    const { container } = renderPlan([circle])
    fireEvent.pointerDown(container.querySelector('.wb-ink-svg circle[style]')!)
    expect(bar()).toBeTruthy()
    expect(within(bar()!).queryByRole('button', { name: R })).toBeNull()
  })

  // ── ✥ / ⟳ as tap-toggles (02.09.) ───────────────────────────────────────────────────────
  // The bar is pinned bottom-centre, so pulling ✥ DOWN runs the finger off the screen. A tap
  // arms the same writers for the whole sheet instead (lib/useArmedTransform).
  it('arms ✥ on a tap, then moves the selection from a drag on the paper itself', () => {
    const { container, onChange } = renderPlan([line])
    fireEvent.pointerDown(hitShape(container))
    const grip = within(bar()!).getByRole('button', { name: D.move })
    fireEvent.pointerDown(grip, { clientX: 100, clientY: 100, pointerId: 1 })
    fireEvent.pointerUp(grip, { clientX: 100, clientY: 100, pointerId: 1 })
    expect(within(bar()!).getByRole('button', { name: D.moveArmed }).getAttribute('aria-pressed')).toBe('true')
    // …now a drag anywhere, including straight DOWN, which the grip had no room for
    const canvas = container.querySelector('.wb-canvas')!
    fireEvent.pointerDown(canvas, { clientX: 40, clientY: 40, pointerId: 2, isPrimary: true })
    fireEvent.pointerMove(window, { clientX: 40, clientY: 160, pointerId: 2 })
    fireEvent.pointerUp(window, { clientX: 40, clientY: 160, pointerId: 2 })
    const moved = onChange.mock.calls[onChange.mock.calls.length - 1][0].find((a: BoardAnno) => a.id === 'l1')
    expect(moved.pts[0][1]).toBeCloseTo(0.5)   // 0.2 + 120/400
    expect(moved.pts[0][0]).toBeCloseTo(0.2)   // untouched across
  })

  it('turns the selection about its centre while ⟳ is armed, following the pointer', () => {
    const { container, onChange } = renderPlan([box])
    fireEvent.pointerDown(container.querySelector('.wb-shape')!)
    const dialBtn = within(bar()!).getByRole('button', { name: R })
    fireEvent.pointerDown(dialBtn, { clientX: 100, clientY: 100, pointerId: 1 })
    fireEvent.pointerUp(dialBtn, { clientX: 100, clientY: 100, pointerId: 1 })
    // the Form sits at (0.3, 0.3) of a 400px board → its centre is client (120, 120)
    const canvas = container.querySelector('.wb-canvas')!
    fireEvent.pointerDown(canvas, { clientX: 220, clientY: 120, pointerId: 2, isPrimary: true }) // due east
    fireEvent.pointerMove(window, { clientX: 120, clientY: 220, pointerId: 2 })                  // due south
    fireEvent.pointerUp(window, { clientX: 120, clientY: 220, pointerId: 2 })
    const turned = onChange.mock.calls[onChange.mock.calls.length - 1][0].find((a: BoardAnno) => a.id === 'f1')
    expect(turned.rotation).toBe(100)          // 10° + a quarter turn clockwise
  })

  it('keeps the selection under a tap that never travels while armed', () => {
    const { container } = renderPlan([line])
    fireEvent.pointerDown(hitShape(container))
    const grip = within(bar()!).getByRole('button', { name: D.move })
    fireEvent.pointerDown(grip, { clientX: 100, clientY: 100, pointerId: 1 })
    fireEvent.pointerUp(grip, { clientX: 100, clientY: 100, pointerId: 1 })
    const canvas = container.querySelector('.wb-canvas')!
    fireEvent.pointerDown(canvas, { clientX: 40, clientY: 40, pointerId: 2, isPrimary: true })
    fireEvent.pointerUp(window, { clientX: 40, clientY: 40, pointerId: 2 })
    fireEvent.click(canvas)
    // an empty-paper press normally clears the selection; while armed it is simply nothing
    expect(bar()).toBeTruthy()
    expect(within(bar()!).getByRole('button', { name: D.moveArmed })).toBeTruthy()
  })

  // ⚠️ «Löschen» left the bar on 02.09.: its third slot is «Fertig», which ENDS the editing state
  // — nothing selected, no mode armed, the sheets that were open for it closed. Deleting stays on
  // the Delete key and in the object's own editor sheet (see the A21 block below).
  it('ends the editing state on «Fertig», and offers no trash at all', () => {
    const { container, onChange } = renderPlan([line])
    fireEvent.pointerDown(hitShape(container))
    expect(within(bar()!).queryByRole('button', { name: appConfig.copy.remove })).toBeNull()
    fireEvent.click(within(bar()!).getByRole('button', { name: appConfig.copy.done }))
    expect(bar()).toBeNull()
    // …and it deletes nothing on the way out
    expect(onChange.mock.calls.length === 0
      || onChange.mock.calls[onChange.mock.calls.length - 1][0].some((a: BoardAnno) => a.id === 'l1')).toBe(true)
  })

  it('drops an armed mode with the editing state', () => {
    const { container, onChange } = renderPlan([line])
    fireEvent.pointerDown(hitShape(container))
    const grip = within(bar()!).getByRole('button', { name: D.move })
    fireEvent.pointerDown(grip, { clientX: 100, clientY: 100, pointerId: 1 })
    fireEvent.pointerUp(grip, { clientX: 100, clientY: 100, pointerId: 1 })
    expect(within(bar()!).getByRole('button', { name: D.moveArmed })).toBeTruthy()
    fireEvent.click(within(bar()!).getByRole('button', { name: appConfig.copy.done }))
    expect(bar()).toBeNull()
    // …and a drag on the sheet is a plain board gesture again, not a move of what was selected
    const canvas = container.querySelector('.wb-canvas')!
    fireEvent.pointerDown(canvas, { clientX: 40, clientY: 40, pointerId: 2, isPrimary: true })
    fireEvent.pointerMove(window, { clientX: 40, clientY: 160, pointerId: 2 })
    fireEvent.pointerUp(window, { clientX: 40, clientY: 160, pointerId: 2 })
    const out = onChange.mock.calls[onChange.mock.calls.length - 1]?.[0] as BoardAnno[] | undefined
    expect(out?.find((a) => a.id === 'l1')?.pts?.[0][1] ?? 0.2).toBeCloseTo(0.2)
  })

  it('is the SAME bar for a Mehrfach group — one drag moves every boxed object', () => {
    const { container, onChange } = renderPlan([line, box])
    armMehrfach()
    const stage = container.querySelector('.wb-stage > div')!
    fireEvent.pointerDown(stage, { clientX: 0, clientY: 0, pointerId: 1 })
    fireEvent.pointerMove(stage, { clientX: 400, clientY: 400, pointerId: 1 })
    fireEvent.pointerUp(stage, { clientX: 400, clientY: 400, pointerId: 1 })
    expect(bar()).toBeTruthy()
    const grip = within(bar()!).getByRole('button', { name: D.move })
    fireEvent.pointerDown(grip, { clientX: 100, clientY: 100, pointerId: 2 })
    fireEvent.pointerMove(grip, { clientX: 100, clientY: 140, pointerId: 2 }) // +40px down of 400
    fireEvent.pointerUp(grip, { clientX: 100, clientY: 140, pointerId: 2 })
    const out = onChange.mock.calls[onChange.mock.calls.length - 1][0] as BoardAnno[]
    expect(out.find((a) => a.id === 'l1')!.pts![0][1]).toBeCloseTo(0.3) // 0.2 + 40/400
    expect(out.find((a) => a.id === 'f1')!.y).toBeCloseTo(0.4)          // 0.3 + 40/400
  })

  it('hands out no bar at all on a read-only surface', () => {
    renderPlan([line], { readOnly: true, focus: { x: 0.5, y: 0.5, floor: 0, annoId: 'l1', nonce: 1 } })
    expect(bar()).toBeNull()
  })

  // ── A21 · Delete / Backspace ───────────────────────────────────────────────────────────────
  // The Karte has bound the key since the beginning; the Kroki had only Escape. Same semantics,
  // reaching for exactly what the bar's trash reaches for.
  const press = (key: 'Delete' | 'Backspace', target: Element | Window = window) => fireEvent.keyDown(target, { key })
  const survives = (onChange: ReturnType<typeof vi.fn>, id: string) =>
    onChange.mock.calls.length === 0 || onChange.mock.calls[onChange.mock.calls.length - 1][0].some((a: BoardAnno) => a.id === id)

  it('deletes the selection by Delete, and by Backspace', () => {
    for (const key of ['Delete', 'Backspace'] as const) {
      const { container, onChange } = renderPlan([line])
      fireEvent.pointerDown(hitShape(container))
      press(key)
      expect(survives(onChange, 'l1')).toBe(false)
      cleanup()
    }
  })

  it('deletes a whole Mehrfach group by the key, exactly as a single object goes', () => {
    const { container, onChange } = renderPlan([line, box])
    armMehrfach()
    const stage = container.querySelector('.wb-stage > div')!
    fireEvent.pointerDown(stage, { clientX: 0, clientY: 0, pointerId: 1 })
    fireEvent.pointerMove(stage, { clientX: 400, clientY: 400, pointerId: 1 })
    fireEvent.pointerUp(stage, { clientX: 400, clientY: 400, pointerId: 1 })
    press('Delete')
    expect(survives(onChange, 'l1')).toBe(false)
    expect(survives(onChange, 'f1')).toBe(false)
  })

  // ⚠️ The one that matters on a sheet full of Notiz textareas and Trupp names: Backspace in a
  // field is a character, never a delete.
  it('stays out of the way while a field owns the press', () => {
    const { container, onChange } = renderPlan([line])
    fireEvent.pointerDown(hitShape(container))
    const field = document.createElement('input')
    container.appendChild(field)
    press('Backspace', field)
    expect(survives(onChange, 'l1')).toBe(true)
  })

  it('deletes nothing on a read-only surface', () => {
    const { onChange } = renderPlan([line], { readOnly: true, focus: { x: 0.5, y: 0.5, floor: 0, annoId: 'l1', nonce: 1 } })
    press('Delete')
    expect(survives(onChange, 'l1')).toBe(true)
  })

  // ── A22 · Cmd/Ctrl+D ───────────────────────────────────────────────────────────────────────
  // The key resolved on the Plan and then did nothing (lib/hotkeys decodes it surface-agnostically;
  // IncidentWorkspace only dispatched it on the Karte). Same semantics as the map's here.
  type Keys = NonNullable<React.ComponentProps<typeof Whiteboard>['keysRef']>
  const withKeys = (annos: BoardAnno[], extra: Partial<React.ComponentProps<typeof Whiteboard>> = {}) => {
    const keysRef: Keys = { current: null }
    const log = vi.fn()
    return { ...renderPlan(annos, { keysRef, log, ...extra }), keysRef, log }
  }
  const out = (onChange: ReturnType<typeof vi.fn>) => onChange.mock.calls[onChange.mock.calls.length - 1][0] as BoardAnno[]

  it('duplicates the one selected object a visible nudge away, and selects the copy', () => {
    const { container, onChange, keysRef, log } = withKeys([line])
    fireEvent.pointerDown(hitShape(container))
    act(() => { keysRef.current!.duplicate() })
    const annos = out(onChange)
    expect(annos).toHaveLength(2)
    const copy = annos.find((a) => a.id !== 'l1')!
    expect(copy.kind).toBe('draw')
    expect(copy.pts![0][0]).toBeCloseTo(0.22) // 0.2 + DUP_OFFSET_N
    expect(copy.pts![0][1]).toBeCloseTo(0.22)
    // one «Objekt dupliziert» row, pointing at the COPY — which is also what the selection
    // moved to (setSelId). ⚠️ `annos` is a controlled prop here, so the copy never comes back
    // into this render; the journal row is what says which object the surface handed on to.
    expect(log).toHaveBeenCalledWith('layers', appConfig.copy.log.duplicated, expect.objectContaining({ annoId: copy.id }))
  })

  // «Gelöscht / erledigt» (lib/objectDone) belongs to the thing that is over, never to its copy
  it('never copies «Gelöscht / erledigt» — a duplicated Feuer is a new, burning one', () => {
    const f: BoardAnno = { id: 'f1', kind: 'symbol', x: 0.5, y: 0.5, floor: 0, symbol: 'VKF Feuer', label: 'Feuer', done: { at: '2026-09-23T18:40:00.000Z' } }
    const { container, onChange, keysRef } = withKeys([f])
    fireEvent.pointerDown(container.querySelector('.wb-symbol')!)
    act(() => { keysRef.current!.duplicate() })
    const copy = out(onChange).find((a) => a.id !== 'f1')!
    expect(copy.symbol).toBe('VKF Feuer')
    expect('done' in copy).toBe(false)
  })

  // ⚠️ A recorded track belongs to the Trupp that walked it (`teamLocked` refuses to delete one),
  // so a copy that inherited it would fabricate a movement history AND arrive undeletable.
  it('never copies a Trupp’s recorded trail', () => {
    const trupp: BoardAnno = { id: 'r1', kind: 'resource', x: 0.5, y: 0.5, floor: 0, text: 'A1', trail: [{ x: 0.1, y: 0.1, floor: 0, t: '2026-09-02T08:00:00Z' }] }
    const { container, onChange, keysRef } = withKeys([trupp])
    fireEvent.pointerDown(container.querySelector('.wb-anno')!)
    act(() => { keysRef.current!.duplicate() })
    const copy = out(onChange).find((a) => a.id !== 'r1')!
    expect(copy.trail).toBeUndefined()
  })

  it('stays out of a Mehrfach group and off a read-only sheet — as on the Karte', () => {
    const { container, onChange, keysRef } = withKeys([line, box])
    armMehrfach()
    const stage = container.querySelector('.wb-stage > div')!
    fireEvent.pointerDown(stage, { clientX: 0, clientY: 0, pointerId: 1 })
    fireEvent.pointerMove(stage, { clientX: 400, clientY: 400, pointerId: 1 })
    fireEvent.pointerUp(stage, { clientX: 400, clientY: 400, pointerId: 1 })
    act(() => { keysRef.current!.duplicate() })
    expect(onChange).not.toHaveBeenCalled()

    cleanup()
    const ro = withKeys([line], { readOnly: true, focus: { x: 0.5, y: 0.5, floor: 0, annoId: 'l1', nonce: 1 } })
    act(() => { ro.keysRef.current!.duplicate() })
    expect(ro.onChange).not.toHaveBeenCalled()
  })
})

// The surfaced Einsatzplan can belong to the NEAREST object, not to the Einsatzadresse (14.09.):
// the chip turns amber and a banner says both addresses once per Einsatz and object.
describe('the nearby-object warning', () => {
  const modul: PlanDocument = { id: 'modul2', code: 'M2', title: 'Modul 2', subtitle: '', imageUrl: '', orientation: 'landscape' }
  const renderNearby = (onObjectSwitch?: () => void) => render(<Whiteboard
    plans={[modul, tafel]} activeId="modul2" annos={[]} onChange={() => {}}
    building={null} onSelectBuilding={() => {}} onBuildingFace={() => {}} onAddFloor={() => {}} onRemoveFloor={() => {}}
    slimTools sym={sym} onRecent={() => {}} log={() => {}} hist={{}} setHist={() => {}} focus={null}
    objectAddress="Hohestrasse 134" objectNearby={{ distanceM: 80, objectId: 'obj1' }}
    incidentId="inc1" incidentAddress="Hohestrasse 136" onObjectSwitch={onObjectSwitch}
  />)

  // jsdom exposes localStorage as a getter-only accessor here – the ErrorBoundary test's stub
  beforeEach(() => {
    const store = new Map<string, string>()
    Object.defineProperty(globalThis, 'localStorage', {
      configurable: true,
      value: {
        getItem: (k: string) => (store.has(k) ? store.get(k)! : null),
        setItem: (k: string, v: string) => void store.set(k, String(v)),
        removeItem: (k: string) => void store.delete(k),
        clear: () => store.clear(),
        key: (i: number) => [...store.keys()][i] ?? null,
        get length() { return store.size },
      } as Storage,
    })
  })

  it('shows the amber chip with the distance and the banner with both addresses', () => {
    const onObjectSwitch = vi.fn()
    renderNearby(onObjectSwitch)
    const chip = screen.getByRole('button', { name: /Nächstes Objekt in 80 m – nicht die Einsatzadresse/ })
    expect(chip.className).toContain('wb-object-nearby')
    expect(chip.textContent).toContain('Hohestrasse 134 · 80 m entfernt')
    const banner = screen.getByRole('status')
    expect(banner.textContent).toContain('Einsatz: Hohestrasse 136 · Plan: Hohestrasse 134 (80 m)')
    fireEvent.click(within(banner).getByRole('button', { name: 'Anderes Objekt wählen' }))
    expect(onObjectSwitch).toHaveBeenCalled()
  })

  it('✕ dismisses the banner for this Einsatz and object – the chip stays', () => {
    const { unmount } = renderNearby()
    fireEvent.click(within(screen.getByRole('status')).getByRole('button', { name: 'Schliessen' }))
    expect(screen.queryByRole('status')).toBeNull()
    expect(screen.getByRole('button', { name: /Nächstes Objekt in 80 m/ })).toBeTruthy()
    unmount()
    renderNearby()
    expect(screen.queryByRole('status')).toBeNull()
  })
})

// A Geschossplan lies on its page the way the architect's sheet happened to lie. Since 16.09.2026
// it turns like a picked outline does – same dial, same popover, same re-glue of the ink.
describe('drehen · Gebäude aus Geschossplänen', () => {
  const packBuilding: BuildingDoc = { ...aBuilding, ring: [], rings: [], ringAspect: 0.4, floors: [0, 1], pack: { aspect: 1.4 } }

  // the north dial is the one door to the popover (the rail's tile went 29.09.2026, sweep K6)
  const turn = () => screen.getByRole('button', { name: 'Gebäude drehen' })

  it('offers the turn control on a pack, where a plain outline has nothing to straighten', () => {
    renderBoard('gebaeude', [], false, packBuilding)
    expect(turn()).toBeTruthy()
  })

  // ⚠️ honesty: the page's bearing is only known from an approved map fit. Without one the dial
  // must not point anywhere — it wears the turn arrow and says why.
  it('claims no north while the pack is not linked to the map', () => {
    renderBoard('gebaeude', [], false, packBuilding)
    fireEvent.click(turn())
    expect(screen.getByRole('button', { name: 'Wie gezeichnet' })).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Norden oben' })).toBeNull()
  })

  it('a footprint stack keeps «Norden oben» and never offers «Wie gezeichnet»', () => {
    renderBoard('gebaeude', [], false, { ...aBuilding, src: [[[0, 0], [1, 0], [1, 0.3], [0, 0.3]]], orientDeg: 30, viewDeg: 30 })
    fireEvent.click(turn())
    expect(screen.getByRole('button', { name: 'Norden oben' })).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Wie gezeichnet' })).toBeNull()
  })
})

// Field report 24.09.2026 (iPad): «clicking the north indicator in Gebäude doesn't always toggle
// the rotation – in fact pretty rarely». The dial sat INSIDE the board's canvas then (it is in the
// rail's footer since 20.10.2026, and these presses still have to hold), and the canvas
// answers every pointerdown with a one-finger pan that takes pointer capture — so the release,
// and with it the click, landed on the canvas and never on the dial (nor, through the portal's
// React bubbling, on the popover's «Norden oben»). jsdom neither captures nor retargets, so
// `press` does what a browser does: whoever took capture receives the up, and the click goes to
// the nearest common ancestor of the down and up targets (UI Events) — for a mouse that is Blink's
// behaviour in the probe, and the iPad showed the same for taps. A touch that travels is no tap.
describe('the Gebäude north dial answers one tap, every time', () => {
  const footprint: BuildingDoc = { ...aBuilding, src: [[[0, 0], [1, 0], [1, 0.3], [0, 0.3]]], orientDeg: 30, viewDeg: 30 }
  const TURN = appConfig.copy.whiteboard.orientMenuTitle

  beforeEach(() => {
    // a measured viewport, or the board has no size and a turn has nothing to re-glue into
    vi.spyOn(Element.prototype, 'clientWidth', 'get').mockReturnValue(1000)
    vi.spyOn(Element.prototype, 'clientHeight', 'get').mockReturnValue(800)
  })
  afterEach(() => { vi.restoreAllMocks() })

  const renderStack = () => {
    const onReorient = vi.fn()
    const { container } = render(<Whiteboard
      plans={[umrisse, gebaeudeDoc, tafel]} activeId="gebaeude" annos={[]} onChange={() => {}}
      building={footprint} onSelectBuilding={() => {}} onBuildingFace={() => {}} onReorient={onReorient}
      onAddFloor={() => {}} onRemoveFloor={() => {}} slimTools sym={sym} onRecent={() => {}} log={() => {}}
      hist={{}} setHist={() => {}} focus={null}
    />)
    const canvas = container.querySelector('.wb-canvas')!
    // the dial, in the rail's footer (UX sweep M7, 20.10.2026 – it was on the canvas, top-right)
    const dial = () => within(container.querySelector('.wb-tools') as HTMLElement).getByRole('button', { name: TURN })
    return { onReorient, canvas, dial }
  }
  const isOpen = (dial: HTMLElement) => dial.getAttribute('aria-expanded') === 'true'

  // sweep K6 (29.09.2026): a second compass tile opened the same popover a second way. Since
  // 20.10.2026 (M7) the one door sits where the Karte's compass does – in the rail's footer – and
  // the viewport's corner is empty.
  it('is the ONLY door, in the rail footer like the Karte’s compass', () => {
    const { dial, canvas } = renderStack()
    expect(dial().closest('.vrail-nav')).toBeTruthy()
    expect(screen.getAllByRole('button', { name: TURN })).toHaveLength(1)
    expect(within(canvas as HTMLElement).queryByRole('img', { name: appConfig.copy.whiteboard.northTitle })).toBeNull()
  })

  // …and a plan with no rail at all (a replay) has nowhere else to show north
  it('without a rail (a replay) it stays a read-out in the viewport corner', () => {
    const { container } = render(<Whiteboard
      plans={[umrisse, gebaeudeDoc, tafel]} activeId="gebaeude" annos={[]} onChange={() => {}}
      building={footprint} onSelectBuilding={() => {}} onBuildingFace={() => {}} onReorient={() => {}}
      onAddFloor={() => {}} onRemoveFloor={() => {}} readOnly sym={sym} onRecent={() => {}} log={() => {}}
      hist={{}} setHist={() => {}} focus={null}
    />)
    expect(container.querySelector('.wb-tools')).toBeNull()
    expect(screen.getByRole('img', { name: appConfig.copy.whiteboard.northTitle })).toBeTruthy()
    expect(screen.queryByRole('button', { name: TURN })).toBeNull()
  })

  const commonAncestor = (a: Element, b: Element) => {
    let n: Element | null = a
    while (n && !n.contains(b)) n = n.parentElement
    return n ?? document.body
  }
  /** One press as a browser delivers it. `upOn` is where a mouse is released; `travel` px of
   *  movement between down and up (a touch past the tap slop fires no click at all). */
  const press = (down: Element, pointerType: 'touch' | 'mouse', { upOn = down, travel = 0 }: { upOn?: Element; travel?: number } = {}) => {
    const cap: { el: Element | null } = { el: null }
    const spy = vi.spyOn(Element.prototype, 'setPointerCapture').mockImplementation(function (this: Element) { cap.el = this })
    try {
      const at = { pointerId: 7, pointerType, isPrimary: true, button: 0, clientY: 100 }
      fireEvent.pointerDown(down, { ...at, clientX: 100 })
      if (travel) fireEvent.pointerMove(cap.el ?? down, { ...at, clientX: 100 + travel })
      // a touch is implicitly captured by what it went down on; a mouse lands where it is released
      const up = cap.el ?? (pointerType === 'touch' ? down : upOn)
      fireEvent.pointerUp(up, { ...at, clientX: 100 + travel })
      if (pointerType === 'touch' && travel > 10) return
      fireEvent.click(commonAncestor(down, up), { button: 0, detail: 1 })
    } finally { spy.mockRestore() }
  }
  // the needle inside the button is what a finger actually lands on
  const glyph = (dial: HTMLElement) => dial.querySelector('path') ?? dial

  it('opens on a touch tap and closes on the next', () => {
    const { dial } = renderStack()
    press(glyph(dial()), 'touch')
    expect(isOpen(dial())).toBe(true)
    expect(screen.getByRole('button', { name: 'Norden oben' })).toBeTruthy()
    press(glyph(dial()), 'touch')
    expect(isOpen(dial())).toBe(false)
  })

  it('opens on a mouse click and closes on the next', () => {
    const { dial } = renderStack()
    press(glyph(dial()), 'mouse')
    expect(isOpen(dial())).toBe(true)
    press(glyph(dial()), 'mouse')
    expect(isOpen(dial())).toBe(false)
  })

  it('20 rapid taps, touch and mouse alternating, toggle 20 times and end closed', () => {
    const { dial } = renderStack()
    for (let i = 0; i < 20; i++) {
      press(glyph(dial()), i % 2 ? 'mouse' : 'touch')
      expect(isOpen(dial())).toBe(i % 2 === 0)
    }
    expect(isOpen(dial())).toBe(false)
  })

  // the actual turn lives one tap further in — the popover is portalled, but its presses bubble
  // through the React tree to the same canvas
  it.each(['touch', 'mouse'] as const)('«Norden oben» turns the building on a %s press', (how) => {
    const { dial, onReorient } = renderStack()
    press(glyph(dial()), how)
    press(screen.getByRole('button', { name: 'Norden oben' }), how)
    expect(onReorient).toHaveBeenCalledOnce()
    expect(onReorient.mock.calls[0][0]).toMatchObject({ viewDeg: 0, northUp: true })
  })

  it('a drag that starts on the dial is no tap: it neither opens nor closes the popover', () => {
    const { dial, canvas } = renderStack()
    press(glyph(dial()), 'touch', { travel: 40 })
    expect(isOpen(dial())).toBe(false)
    press(glyph(dial()), 'mouse', { upOn: canvas, travel: 40 })
    expect(isOpen(dial())).toBe(false)
    // …and an open popover is not closed by one either
    press(glyph(dial()), 'touch')
    press(glyph(dial()), 'touch', { travel: 40 })
    expect(isOpen(dial())).toBe(true)
  })
})

// ⚠️ A Leitung drawn on the stack stamps its storey into EVERY VERTEX (pts[i][2]), and the
// renderer reads the point before the anno — so the detail sheet's «Geschoss» stepper, which
// patched `anno.floor` alone, moved nothing at all (Bastian, 17.09.2026).
describe('das Geschoss einer Leitung ändern', () => {
  const hose = (floor: number): BoardAnno => ({
    id: 'l1', kind: 'draw', color: '#1f6feb', width: 5, floor,
    pts: [[0.3, 0.4, floor], [0.6, 0.5, floor]],
  })
  const stepUp = () => {
    const step = screen.getByRole('group', { name: appConfig.copy.drawingEditor.floorTag })
    // ⚠️ the stepper repeats on HOLD, so its ± are pointer buttons, not click handlers
    const more = within(step).getByRole('button', { name: appConfig.copy.stepper.more })
    fireEvent.pointerDown(more, { pointerId: 1 })
    fireEvent.pointerUp(more, { pointerId: 1 })
  }
  // ⚠️ a line whose vertices sit on different storeys is drawn as one run PER storey, and a run
  // of a single vertex is a dot — so the tappable ink is a circle there, not a polyline
  const select = () => {
    const hit = document.querySelector('.wb-ink-svg polyline[style], .wb-ink-svg circle[style]')!
    fireEvent.pointerDown(hit, { pointerId: 1, clientX: 10, clientY: 10 })
  }

  it('moves every vertex, so the hose actually changes storey', () => {
    const { onChange } = renderBoard('gebaeude', [hose(0)], false, { ...aBuilding, floors: [0, 1, 2], pack: { aspect: 1 } })
    select()
    stepUp()

    const saved = onChange.mock.lastCall?.[0]?.find((a: BoardAnno) => a.id === 'l1')
    expect(saved?.pts?.map((p: number[]) => p[2])).toEqual([1, 1])
    expect(saved?.floor).toBe(1)
  })

  // …and a Leitung that climbs keeps its climb: both ends move by the same step
  it('shifts a storey-crossing line instead of flattening it', () => {
    const climbing: BoardAnno = { ...hose(0), pts: [[0.3, 0.4, 0], [0.6, 0.5, 1]] }
    const { onChange } = renderBoard('gebaeude', [climbing], false, { ...aBuilding, floors: [0, 1, 2], pack: { aspect: 1 } })
    select()
    stepUp()

    const saved = onChange.mock.lastCall?.[0]?.find((a: BoardAnno) => a.id === 'l1')
    expect(saved?.pts?.map((p: number[]) => p[2])).toEqual([1, 2])
  })
})

// Folding a storey away is a way of LOOKING at the stack (16.09.2026): it never touches the
// document, so it is offered on prepared packs and on read-only surfaces too — and the strip it
// leaves behind is the whole way back.
describe('ein Geschoss ausblenden', () => {
  const tiles = () => document.querySelectorAll('.wb-floor')
  // the storey's acts live in its LABEL's menu since 29.09.2026 (sweep K5) — no eye on the canvas
  const labelOf = (tile: Element) => within(tile as HTMLElement).queryByRole('button', { name: /ausblenden/ })
  const eyeOf = (tile: Element) => {
    fireEvent.click(labelOf(tile)!)
    return screen.getByRole('menuitem', { name: appConfig.copy.whiteboard.floorHideShort })
  }

  it('folds the tapped storey into a strip and brings it back from there', () => {
    renderBoard('gebaeude', [], false, { ...aBuilding, floors: [-1, 0, 1], pack: { aspect: 1 } })
    expect(tiles()).toHaveLength(3)

    fireEvent.click(eyeOf(tiles()[0])) // top tile = the highest storey
    expect(tiles()).toHaveLength(2)
    const strip = document.querySelector('.wb-floor-folded')!
    expect(strip.textContent).toContain('ausgeblendet')

    fireEvent.click(strip)
    expect(tiles()).toHaveLength(3)
    expect(document.querySelector('.wb-floor-folded')).toBeNull()
  })

  // ⚠️ the guard: a stack with no tile has nothing left to tap, and the way back would be gone
  it('refuses to fold the last visible storey away', () => {
    renderBoard('gebaeude', [], false, aBuilding) // one storey
    expect(tiles()).toHaveLength(1)
    expect(labelOf(tiles()[0])).toBeNull()
  })

  it('the label shows the word only, and brings the signed chip back only for a custom name', () => {
    renderBoard('gebaeude', [], false, { ...aBuilding, floors: [0, 1, 2], floorNames: { '2': 'Hauptebene' } })
    const [top, mid] = [...tiles()] as HTMLElement[]
    expect(top.querySelector('.wb-floor-label')!.textContent).toBe('+2Hauptebene')
    expect(mid.querySelector('.wb-floor-label')!.textContent).toBe('1. OG')
    // no bin and no eye on the canvas — the delete is the menu's danger row
    expect(document.querySelector('.wb-floor-x, .wb-floor-eye')).toBeNull()
    fireEvent.click(labelOf(mid)!)
    const del = screen.getByRole('menuitem', { name: appConfig.copy.whiteboard.removeFloor })
    expect(del.className).toContain('ui-menu-danger')
  })

  it('is offered on a read-only surface as well — it changes nothing about the Einsatz', () => {
    renderBoard('gebaeude', [], true, { ...aBuilding, floors: [0, 1], pack: { aspect: 1 } })
    expect(eyeOf(tiles()[0])).toBeTruthy()
  })

  // ⚠️ on a narrow tile (a zoomed-out stack on a phone) the container query in 09-whiteboard.css
  // drops BOTH eye affordances — the headers' «Geschoss ausblenden» and the strip's «einblenden»
  // word — so the way back is the strip itself. It is therefore one button over the whole row,
  // named after the storey it restores; nothing inside it may be the only target.
  it('the whole strip is the button back, and it names the storey it brings back', () => {
    renderBoard('gebaeude', [], false, { ...aBuilding, floors: [-1, 0, 1], pack: { aspect: 1 } })
    fireEvent.click(eyeOf(tiles()[0])) // fold the highest storey away

    const strip = screen.getByRole('button', { name: `1. OG ${appConfig.copy.whiteboard.floorShow}` })
    expect(strip.classList.contains('wb-floor-folded')).toBe(true)
    expect(within(strip).queryAllByRole('button')).toHaveLength(0)

    fireEvent.click(strip)
    expect(tiles()).toHaveLength(3)
  })
})

describe('prepared Gebäude floors and shared symbol instances', () => {
  it('prepared floors expose no add or delete controls', () => {
    renderBoard('gebaeude', [], false, { ...aBuilding, floors: [-1, 0, 1], pack: { aspect: 1 } })
    expect(document.querySelector('.wb-floor-x')).toBeNull()
    expect(document.querySelector('.wb-floor-add')).toBeNull()
  })
  it('every instance is fully selectable and none is rendered outside its range', () => {
    renderBoard('gebaeude', [{ id: 'fire', kind: 'symbol', symbol: 'VKF Feuer', x: .5, y: .5, floor: 0, floorFrom: 1, floorTo: 2 }], false, { ...aBuilding, floors: [0, 1, 2] })
    const instances = document.querySelectorAll('.wb-anno.wb-symbol')
    expect(instances).toHaveLength(2)
    for (const instance of instances) {
      expect(instance.getAttribute('aria-hidden')).not.toBe('true')
      fireEvent.pointerDown(instance, { pointerId: 1, clientX: 100, clientY: 100 })
      expect(instance.classList.contains('sel')).toBe(true)
    }
    expect(document.querySelector('.wb-span-copy')).toBeNull()
  })
})

// ── One gesture, one step: the vertex, grow, climb and rotor gestures (23.09.2026) ─────────
// Pinned before those handlers leave this file for their own hooks (useWbVertexEdit ·
// useWbRotor): the contract is what a gesture WRITES — how many undo steps (a pushPast is one
// `onCheckpoint`), how many audit events, and the exact numbers the maths lands on for a fixed
// pointer path. A CONTROLLED harness, so the board reads back what it wrote exactly as it does
// under IncidentWorkspace — and the one ↶ is proven by pressing it.
describe('gesture contracts of the plan surface', () => {
  const W = appConfig.copy.whiteboard
  beforeEach(() => {
    ui.toasts.length = 0
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue({
      left: 0, top: 0, right: 400, bottom: 400, width: 400, height: 400, x: 0, y: 0, toJSON: () => ({}),
    } as DOMRect)
    vi.spyOn(Element.prototype, 'clientWidth', 'get').mockReturnValue(400)
    vi.spyOn(Element.prototype, 'clientHeight', 'get').mockReturnValue(400)
  })
  afterEach(() => { vi.restoreAllMocks(); vi.useRealTimers() })

  type Fn = (...args: unknown[]) => void
  type Spies = { onChange: Mock<Fn>; onCheckpoint: Mock<Fn>; emit: Mock<Fn> }
  const history = { current: null as { undo: (expect?: string) => boolean; redo: (expect?: string) => boolean } | null }
  const latest = { annos: [] as BoardAnno[] }
  function Controlled({ initial, spies, extra }: { initial: BoardAnno[]; spies: Spies; extra: Partial<React.ComponentProps<typeof Whiteboard>> }) {
    const [annos, setAnnos] = useState(initial)
    const [hist, setHist] = useState({})
    latest.annos = annos
    return <Whiteboard
      plans={[tafel, gebaeudeDoc]} activeId="tafel" annos={annos}
      onChange={(n) => { spies.onChange(n); setAnnos(n) }}
      building={null} onSelectBuilding={() => {}} onAddFloor={() => {}} onRemoveFloor={() => {}}
      sym={sym} onRecent={() => {}} log={() => {}} hist={hist} setHist={setHist} focus={null}
      onCheckpoint={spies.onCheckpoint} emit={spies.emit} historyRef={history}
      {...extra}
    />
  }
  const mount = (initial: BoardAnno[], extra: Partial<React.ComponentProps<typeof Whiteboard>> = {}) => {
    const spies: Spies = { onChange: vi.fn<Fn>(), onCheckpoint: vi.fn<Fn>(), emit: vi.fn<Fn>() }
    const utils = render(<Controlled initial={initial} spies={spies} extra={extra} />)
    return { ...utils, ...spies }
  }
  const focused = (annoId: string) => ({ x: 0.5, y: 0.5, floor: 0, annoId, nonce: 1 })
  const edits = (emit: Mock<Fn>) => emit.mock.calls.filter((c) => c[0] === 'board.edit')
  const find = (id: string) => latest.annos.find((a) => a.id === id)!
  const drag = (el: Element, path: [number, number][]) => {
    const [first, ...rest] = path
    fireEvent.pointerDown(el, { clientX: first[0], clientY: first[1], pointerId: 1 })
    for (const [x, y] of rest) fireEvent.pointerMove(el, { clientX: x, clientY: y, pointerId: 1 })
    const last = path[path.length - 1]
    fireEvent.pointerUp(el, { clientX: last[0], clientY: last[1], pointerId: 1 })
  }

  const three: BoardAnno = { id: 'l1', kind: 'draw', pts: [[0.2, 0.2, 0], [0.5, 0.5, 0], [0.8, 0.8, 0]], floor: 0 }

  it('a vertex drag is ONE undo step and ONE board.edit, carrying the final points', () => {
    const { container, onCheckpoint, emit } = mount([three], { focus: focused('l1') })
    const grip = container.querySelectorAll('.wb-vertex')[1]
    drag(grip, [[200, 200], [220, 200], [240, 180], [260, 160]])
    expect(onCheckpoint).toHaveBeenCalledTimes(1)
    expect(edits(emit)).toHaveLength(1)
    expect(find('l1').pts![1][0]).toBeCloseTo(0.65, 6)
    expect(find('l1').pts![1][1]).toBeCloseTo(0.4, 6)
    expect(edits(emit)[0][1]).toEqual({ id: 'l1', planId: 'tafel', patch: { pts: find('l1').pts } })
    act(() => history.current!.undo())
    expect(find('l1').pts).toEqual(three.pts)
  })

  it('an endpoint drag that docks on nothing is one step too — the magnetic path', () => {
    const { container, onCheckpoint, emit } = mount([three], { focus: focused('l1') })
    const grip = container.querySelectorAll('.wb-vertex')[0]
    drag(grip, [[80, 80], [60, 80], [40, 80]])
    expect(onCheckpoint).toHaveBeenCalledTimes(1)
    expect(edits(emit)).toHaveLength(1)
    expect(find('l1').pts![0].slice(0, 2)).toEqual([0.1, 0.2])
    expect(find('l1').startAttachment).toBeUndefined()
  })

  it('«+» inserts at idx + 1 and the same press drags it — one step, one board.edit', () => {
    const { container, onCheckpoint, emit } = mount([three], { focus: focused('l1') })
    const plus = container.querySelectorAll('.wb-vins')[0]
    drag(plus, [[140, 140], [140, 100], [120, 100]])
    expect(onCheckpoint).toHaveBeenCalledTimes(1)
    expect(edits(emit)).toHaveLength(1)
    const pts = find('l1').pts!
    expect(pts).toHaveLength(4)
    expect(pts[1][0]).toBeCloseTo(0.3, 6)
    expect(pts[1][1]).toBeCloseTo(0.25, 6)
    expect(pts[1][2]).toBe(0)
    act(() => history.current!.undo())
    expect(find('l1').pts).toEqual(three.pts)
  })

  it('a vertex delete refuses at the minimum — a Linie keeps 2 points', () => {
    const { container, onChange } = mount([line], { focus: focused('l1') })
    fireEvent.contextMenu(container.querySelectorAll('.wb-vertex')[0])
    expect(onChange).not.toHaveBeenCalled()
  })

  it('a vertex delete refuses at the minimum — a Fläche keeps 3 points', () => {
    const area: BoardAnno = { id: 'a1', kind: 'area', pts: [[0.2, 0.2, 0], [0.8, 0.2, 0], [0.5, 0.8, 0]], floor: 0 }
    const { container, onChange } = mount([area], { focus: focused('a1') })
    fireEvent.contextMenu(container.querySelectorAll('.wb-vertex')[0])
    expect(onChange).not.toHaveBeenCalled()
  })

  it('a held vertex above the minimum goes — one commit, one step', () => {
    vi.useFakeTimers()
    const { container, onCheckpoint } = mount([three], { focus: focused('l1') })
    const grip = container.querySelectorAll('.wb-vertex')[1]
    fireEvent.pointerDown(grip, { clientX: 200, clientY: 200, pointerId: 1 })
    act(() => { vi.advanceTimersByTime(NODE_HOLD_FIRE_MS + 50) })
    fireEvent.pointerUp(grip, { clientX: 200, clientY: 200, pointerId: 1 })
    expect(find('l1').pts).toEqual([[0.2, 0.2, 0], [0.8, 0.8, 0]])
    expect(onCheckpoint).toHaveBeenCalledTimes(1)
  })

  // ── the Gebäude Grundriss (27.10.2026, lib/grundriss): a Durchgang rides on its Wand, a stroke
  // dropped on another storey tile goes there, «Kopieren nach …» – each ONE step
  describe('Grundriss on the storey stack', () => {
    const twoStoreys = { activeId: 'gebaeude', plans: [tafel, gebaeudeDoc], building: { ...aBuilding, floors: [0, 1] } }
    // the board is 400 × 400: storey 1 is the top tile (y 0–200), the EG the bottom one (200–400)
    const wand: BoardAnno = { id: 'w1', kind: 'draw', role: 'wand', floor: 0, pts: [[0.2, 0.5], [0.8, 0.5]] }
    const tuer: BoardAnno = { id: 'd1', kind: 'symbol', symbol: 'GB Ture Durchgang', x: 0.4, y: 0.5, floor: 0, rotation: 0, onWall: 'w1' }

    it('a Wand dragged onto the storey above goes there with its Durchgang – one step', () => {
      const { container, onCheckpoint } = mount([wand, tuer], twoStoreys)
      const hit = container.querySelector('polyline[stroke="transparent"]')!
      // +0.15 across: both ends land well clear of the building outline, so nothing snaps
      // (round 3) and the drop is exact
      drag(hit, [[200, 300], [200, 250], [260, 100]])
      expect(onCheckpoint).toHaveBeenCalledTimes(1)
      expect(find('w1').floor).toBe(1)
      expect(find('w1').pts![0][0]).toBeCloseTo(0.35, 6)
      expect(find('w1').pts![0][1]).toBeCloseTo(0.5, 6)
      expect(find('d1')).toMatchObject({ floor: 1, onWall: 'w1' })
      expect(find('d1').x).toBeCloseTo(0.55, 6)
      act(() => history.current!.undo())
      expect(find('w1')).toEqual(wand)
      expect(find('d1')).toEqual(tuer)
    })

    it('reshaping a Wand re-seats its Durchgang and logs the seat for the replay', () => {
      const { container, onCheckpoint, emit } = mount([wand, tuer], { ...twoStoreys, focus: focused('w1') })
      drag(container.querySelectorAll('.wb-vertex')[0], [[80, 300], [80, 320], [80, 340]])
      expect(onCheckpoint).toHaveBeenCalledTimes(1)
      expect(find('d1').rotation).not.toBe(0)
      expect(edits(emit).map((c) => (c[1] as { id: string }).id)).toEqual(['w1', 'd1'])
      expect(edits(emit)[1][1]).toMatchObject({ patch: { x: find('d1').x, y: find('d1').y, rotation: find('d1').rotation } })
    })

    // round 3: a Wand MOVED whole lands on what it is moved next to – rigidly, ring shown
    it('a Wand moved whole next to another Wand lands on it, shape kept, ring shown while it moves', () => {
      const short: BoardAnno = { id: 'w1', kind: 'draw', role: 'wand', floor: 0, pts: [[0.2, 0.5, 0], [0.4, 0.5, 0]] }
      const cross: BoardAnno = { id: 'w3', kind: 'draw', role: 'wand', floor: 0, pts: [[0.6, 0.2, 0], [0.6, 0.8, 0]] }
      const { container } = mount([short, cross], twoStoreys)
      const hit = container.querySelector('polyline[stroke="transparent"]')!
      fireEvent.pointerDown(hit, { clientX: 120, clientY: 300, pointerId: 1 })
      fireEvent.pointerMove(hit, { clientX: 160, clientY: 302, pointerId: 1 })
      fireEvent.pointerMove(hit, { clientX: 194, clientY: 303, pointerId: 1 }) // right end 6 px short of w3
      expect(container.querySelector('.wb-snap-ring')).not.toBeNull()
      fireEvent.pointerUp(hit, { clientX: 194, clientY: 303, pointerId: 1 })
      const [a, b] = find('w1').pts!
      expect(b[0]).toBeCloseTo(0.6, 6)
      expect(b[0] - a[0]).toBeCloseTo(0.2, 6)
      expect(b[1]).toBeCloseTo(a[1], 6)
      expect(container.querySelector('.wb-snap-ring, .wb-snap-free')).toBeNull()
    })

    it('a Wand corner dragged near another Wand lands on it, level with its neighbour, ring shown while it moves', () => {
      const short: BoardAnno = { id: 'w1', kind: 'draw', role: 'wand', floor: 0, pts: [[0.2, 0.5, 0], [0.4, 0.5, 0]] }
      const cross: BoardAnno = { id: 'w3', kind: 'draw', role: 'wand', floor: 0, pts: [[0.6, 0.2, 0], [0.6, 0.8, 0]] }
      const { container } = mount([short, cross], { ...twoStoreys, focus: focused('w1') })
      const grip = container.querySelectorAll('.wb-vertex')[1]
      fireEvent.pointerDown(grip, { clientX: 160, clientY: 300, pointerId: 1 })
      fireEvent.pointerMove(grip, { clientX: 200, clientY: 302, pointerId: 1 })
      fireEvent.pointerMove(grip, { clientX: 236, clientY: 303, pointerId: 1 })
      expect(container.querySelector('.wb-snap-ring')).not.toBeNull()
      fireEvent.pointerUp(grip, { clientX: 236, clientY: 303, pointerId: 1 })
      const [x, y, f] = find('w1').pts![1]
      expect(x).toBeCloseTo(0.6, 6); expect(y).toBeCloseTo(0.5, 6); expect(f).toBe(0)
      expect(container.querySelector('.wb-snap-ring, .wb-snap-free')).toBeNull()
    })

    it('a Wand in the Grundriss dark is drawn in the theme ink, a recoloured one in its own colour', () => {
      const red: BoardAnno = { ...wand, id: 'w2', color: '#e8392b', pts: [[0.2, 0.3], [0.8, 0.3]] }
      const { container } = mount([{ ...wand, color: appConfig.drawing.colors[4], width: 3 }, red], twoStoreys)
      const strokes = [...container.querySelectorAll('polyline')].map((p) => p.getAttribute('stroke'))
      expect(strokes).toContain('var(--ink-dim)')
      expect(strokes).toContain('#e8392b')
      expect(strokes).not.toContain(appConfig.drawing.colors[4])
    })

    it('a selected Wand has no stair-climb grips – a plain Linie on the stack still does', () => {
      const leitung: BoardAnno = { id: 'l9', kind: 'draw', floor: 0, pts: [[0.1, 0.2], [0.9, 0.2]] }
      const { container } = mount([wand, leitung], { ...twoStoreys, focus: focused('l9') })
      expect(container.querySelectorAll('.wb-climb').length).toBeGreaterThan(0)
      cleanup()
      const again = mount([wand, leitung], { ...twoStoreys, focus: focused('w1') })
      expect(again.container.querySelectorAll('.wb-climb')).toHaveLength(0)
    })

    it('a selected Wand offers no hose fields (Leitung Nr., Typ) – a plain Linie still does', () => {
      const lineNo = appConfig.copy.drawingEditor.lineNo
      const leitung: BoardAnno = { id: 'l9', kind: 'draw', floor: 0, pts: [[0.1, 0.2], [0.9, 0.2]] }
      mount([wand, leitung], { ...twoStoreys, focus: focused('l9') })
      expect(screen.queryAllByText(lineNo).length).toBeGreaterThan(0)
      cleanup()
      mount([wand, leitung], { ...twoStoreys, focus: focused('w1') })
      expect(screen.queryAllByText(lineNo)).toHaveLength(0)
    })

    // round 2 (27.10.2026): «Mehrere platzieren» is the Durchgang's default here, so it stays armed
    // after every tap – Escape and the pill's ✕ must put it down (the Plan's Escape never did)
    it.each(['Escape', '✕'])('%s stops placing Durchgänge', (how) => {
      const gb = { ...sym, ready: true, order: ['Gebäude'], byName: { 'GB Ture Durchgang': '<svg/>' }, symbols: [{ name: 'GB Ture Durchgang', cat: 'Gebäude', svg: '<svg/>' }] }
      const { container } = mount([], { ...twoStoreys, sym: gb })
      fireEvent.click(screen.getByRole('button', { name: 'Symbol' }))
      fireEvent.click(screen.getAllByRole('button', { name: /Durchgang/ })[0])
      expect(screen.getByRole('button', { name: appConfig.copy.keepPlacing }).getAttribute('aria-pressed')).toBe('true')
      if (how === 'Escape') fireEvent.keyDown(window, { key: 'Escape' })
      else fireEvent.click(within(container.querySelector('.armed-pill-row')!).getByRole('button', { name: appConfig.copy.cancel }))
      expect(container.querySelector('.armed-pill-row')).toBeNull()
      expect(container.querySelector('.wb-ink')).toBeNull()
    })

    it('deleting a Wand leaves its Durchgang standing free', () => {
      mount([wand, tuer], { ...twoStoreys, focus: focused('w1') })
      fireEvent.keyDown(window, { key: 'Delete' })
      expect(latest.annos.map((a) => a.id)).toEqual(['d1'])
      expect(find('d1').onWall).toBeUndefined()
    })

    it('«Kopieren nach …» copies the storey\'s Grundriss in one step and says where it went', async () => {
      const leitung: BoardAnno = { id: 'l9', kind: 'draw', floor: 0, pts: [[0.1, 0.1], [0.9, 0.9]] }
      const gb = { ...sym, symbols: [{ name: 'GB Ture Durchgang', cat: 'Gebäude', svg: '' }] }
      const { container, onCheckpoint } = mount([wand, tuer, leitung], { ...twoStoreys, sym: gb })
      const eg = container.querySelectorAll('.wb-floor')[1]
      fireEvent.click(eg.querySelector('.wb-floor-label')!)
      fireEvent.click(await screen.findByRole('menuitem', { name: appConfig.copy.whiteboard.storeyCopy.menu }))
      fireEvent.click(await screen.findByRole('checkbox', { name: /1\. OG/ }))
      fireEvent.click(screen.getByRole('button', { name: 'Auf 1. OG kopieren' }))
      expect(onCheckpoint).toHaveBeenCalledTimes(1)
      const copies = latest.annos.filter((a) => a.floor === 1)
      expect(copies.map((a) => a.role ?? a.symbol).sort()).toEqual(['GB Ture Durchgang', 'wand'])
      expect(copies.find((a) => a.symbol)!.onWall).toBe(copies.find((a) => a.role)!.id)
      expect(ui.toasts[ui.toasts.length - 1]?.text).toContain('1. OG')
    })

    // round 3: «Art: Linie | Wand» in the line editor
    const art = () => within(screen.getByRole('group', { name: appConfig.copy.drawingEditor.kind }))

    it('«Art: Linie» turns a Wand into a Linie and frees its Durchgang – one step, one board.edit', () => {
      const { onCheckpoint, emit } = mount([{ ...wand, color: appConfig.drawing.colors[4], width: 2 }, tuer], { ...twoStoreys, focus: focused('w1') })
      fireEvent.click(art().getByRole('button', { name: appConfig.copy.drawingEditor.kindLine }))
      expect(onCheckpoint).toHaveBeenCalledTimes(1)
      expect(edits(emit)).toHaveLength(1)
      // the default ink's width back (lead call 28.10.2026) – the Wand's 2 px is no Linie width
      expect(find('w1')).toMatchObject({ role: undefined, color: appConfig.drawing.defaultColor, width: 5, pts: wand.pts })
      expect(find('d1')).toMatchObject({ x: tuer.x, y: tuer.y, onWall: undefined })
      expect(screen.queryAllByText(appConfig.copy.drawingEditor.lineNo).length).toBeGreaterThan(0)
      act(() => history.current!.undo())
      expect(find('w1').role).toBe('wand')
      expect(find('d1').onWall).toBe('w1')
    })

    it('«Wand» is off for a Linie a Trupp is on', () => {
      const leitung: BoardAnno = { id: 'l9', kind: 'draw', floor: 0, pts: [[0.1, 0.2], [0.9, 0.2]], truppId: 't1' }
      const { onChange } = mount([leitung], { ...twoStoreys, focus: focused('l9'), trupps: TRUPPS })
      const toWand = art().getByRole('button', { name: appConfig.copy.drawingEditor.kindWand }) as HTMLButtonElement
      expect(toWand.disabled).toBe(true)
      expect(screen.getByText(appConfig.copy.drawingEditor.kindWandBlocked)).toBeTruthy()
      fireEvent.click(toWand)
      expect(onChange).not.toHaveBeenCalled()
    })
  })

  describe('Verlängern docks only on a closed ring', () => {
    const short: BoardAnno = { id: 'l1', kind: 'draw', pts: [[0.2, 0.2, 0], [0.5, 0.2, 0]], floor: 0 }
    const truck: BoardAnno = { id: 's1', kind: 'symbol', symbol: 'VKF Fahrzeug', x: 0.8, y: 0.2, floor: 0 }
    const growEnd = (c: HTMLElement) => c.querySelectorAll('.wb-grow')[1]

    it('released before the ring closes: the line grows, nothing attaches', () => {
      vi.useFakeTimers()
      const { container, onCheckpoint, emit } = mount([short, truck], { focus: focused('l1') })
      const g = growEnd(container)
      fireEvent.pointerDown(g, { clientX: 230, clientY: 80, pointerId: 1 })
      fireEvent.pointerMove(g, { clientX: 318, clientY: 80, pointerId: 1 })
      act(() => { vi.advanceTimersByTime(100) })
      fireEvent.pointerUp(g, { clientX: 318, clientY: 80, pointerId: 1 })
      const l = find('l1')
      expect(l.pts).toHaveLength(3)
      expect(l.endAttachment).toBeUndefined()
      expect(l.pts![2][0]).toBeCloseTo(318 / 400, 6)
      expect(onCheckpoint).toHaveBeenCalledTimes(1)
      expect(edits(emit)).toHaveLength(1)
    })

    it('held until the ring closes: the new end docks onto the Fahrzeug, still ONE step', () => {
      vi.useFakeTimers()
      const { container, onCheckpoint, emit } = mount([short, truck], { focus: focused('l1') })
      const g = growEnd(container)
      fireEvent.pointerDown(g, { clientX: 230, clientY: 80, pointerId: 1 })
      fireEvent.pointerMove(g, { clientX: 318, clientY: 80, pointerId: 1 })
      act(() => { vi.advanceTimersByTime(1000) })
      fireEvent.pointerUp(g, { clientX: 318, clientY: 80, pointerId: 1 })
      const l = find('l1')
      expect(l.pts).toHaveLength(3)
      expect(l.endAttachment?.target).toEqual({ kind: 'object', id: 's1' })
      expect(onCheckpoint).toHaveBeenCalledTimes(1)
      expect(edits(emit)).toHaveLength(1)
      act(() => history.current!.undo())
      expect(find('l1').pts).toEqual(short.pts)
      expect(find('l1').endAttachment).toBeUndefined()
    })
  })

  describe('the staircase (climbLine)', () => {
    const building: BuildingDoc = { ...aBuilding, floors: [0, 1], pack: { aspect: 1 } }
    const onStack = (annos: BoardAnno[]) => mount(annos, { activeId: 'gebaeude', building, focus: focused('l1') })

    it('a climb adds ONE vertex at the same spot one storey up, as one step', () => {
      const { onCheckpoint } = onStack([{ id: 'l1', kind: 'draw', pts: [[0.3, 0.4, 0], [0.6, 0.5, 0]], floor: 0 }])
      fireEvent.click(screen.getAllByRole('button', { name: W.climbUp })[1])
      expect(find('l1').pts).toEqual([[0.3, 0.4, 0], [0.6, 0.5, 0], [0.6, 0.5, 1]])
      expect(onCheckpoint).toHaveBeenCalledTimes(1)
    })

    it('the way back drops the end instead of laying a second flight', () => {
      const climbed: BoardAnno = { id: 'l1', kind: 'draw', pts: [[0.3, 0.4, 0], [0.6, 0.5, 0], [0.6, 0.5, 1]], floor: 0 }
      onStack([climbed])
      // the ↓ at the climbed end reads «Zurück auf …» — the tap that retreats
      const back = document.querySelector('.wb-climb.back')!
      expect(back.getAttribute('aria-label')).toContain(W.climbBack.split('{')[0].trim())
      fireEvent.click(back)
      expect(find('l1').pts).toEqual([[0.3, 0.4, 0], [0.6, 0.5, 0]])
    })
  })

  describe('rotor · cage · Rotation end — golden numbers for a fixed pointer path', () => {
    // every glyph rect is the mocked 400×400 board, so each gesture pivots on (200, 200)
    it('a directional symbol turns to the pointer bearing + 90°, one step, one board.edit', () => {
      const sperre: BoardAnno = { id: 's1', kind: 'symbol', symbol: 'FW Absperrung', x: 0.5, y: 0.5, floor: 0 }
      const { container, onCheckpoint, emit } = mount([sperre])
      fireEvent.pointerDown(container.querySelector('.wb-symbol')!)
      const knob = container.querySelector('.shape-rotate')!
      drag(knob, [[200, 100], [300, 200], [200, 300]])
      expect(find('s1').rotation).toBe(180)
      expect(onCheckpoint).toHaveBeenCalledTimes(1)
      expect(edits(emit).map((c) => c[1])).toEqual([{ id: 's1', patch: { rotation: 180 }, planId: 'tafel' }])
    })

    it('a Hubretter cage sets the boom bearing and reach from one handle', () => {
      const hub: BoardAnno = { id: 'h1', kind: 'symbol', symbol: 'VKF Hubretter', x: 0.5, y: 0.5, floor: 0 }
      const { container, onCheckpoint, emit } = mount([hub])
      fireEvent.pointerDown(container.querySelector('.wb-symbol')!)
      const cage = container.querySelector('.shape-cage')!
      drag(cage, [[250, 200], [260, 280]])
      const h = find('h1')
      expect(h.rotation2).toBe(53)
      // 100 px of travel over the fitted sheet's 220 px width
      expect(h.reachN).toBeCloseTo(100 / 220, 9)
      expect(onCheckpoint).toHaveBeenCalledTimes(1)
      expect(edits(emit).map((c) => (c[1] as { patch: unknown }).patch)).toEqual([{ rotation2: 53, reachN: h.reachN }])
    })

    it('a Rotation end pins the other end and sets position, run, bearing and width at once', () => {
      const loop: BoardAnno = { id: 'r1', kind: 'shape', shape: 'rotation', x: 0.5, y: 0.5, sizeN: 0.42, aspect: 0.13, rotation: 25, floor: 0 }
      const { container, onCheckpoint, emit } = mount([loop])
      fireEvent.pointerDown(container.querySelector('.wb-shape')!)
      const [, endB] = container.querySelectorAll('.handle.shape-end')
      drag(endB, [[300, 250], [340, 300]])
      const r = find('r1')
      // exact on purpose: a pure move of this maths must land on the same bits
      expect({ x: r.x, y: r.y, rotation: r.rotation, sizeN: r.sizeN, aspect: r.aspect }).toEqual({
        x: 0.6086229370502754, y: 0.5899466702759255, rotation: 34, sizeN: 0.9212922304076605, aspect: 0.054,
      })
      expect(onCheckpoint).toHaveBeenCalledTimes(1)
      expect(edits(emit)).toHaveLength(1)
    })
  })
})

/* ── «Gelöscht / erledigt» statt löschen (review item 21b, 24.09.2026) ────────────────────────
 * The Übung's EG Feuer was DELETED when it was out, and the plan wrote no row for it. The symbol
 * now stays (greyed, with the time) and «Entfernen» — the mistake door — writes the Karte's row.
 */
describe('«Gelöscht / erledigt» on the plan', () => {
  const O = appConfig.copy.objectDone
  const lastSaved = (fn: Mock): BoardAnno[] => fn.mock.calls[fn.mock.calls.length - 1][0] as BoardAnno[]
  const feuer: BoardAnno = { id: 'f1', kind: 'symbol', x: 0.5, y: 0.5, floor: 0, symbol: 'VKF Feuer', label: 'Feuer', storey: 0 }
  const open = (annos: BoardAnno[], extra: Partial<React.ComponentProps<typeof Whiteboard>> = {}) => {
    const log = vi.fn()
    const emit = vi.fn()
    const utils = renderPlan(annos, { log, emit, authorName: 'Muster Anna', ...extra })
    fireEvent.pointerDown(utils.container.querySelector('.wb-symbol')!)
    return { ...utils, log, emit }
  }

  it('offers the row at the top of the symbol’s panel and keeps the symbol — greyed, with the time', () => {
    const { onChange, log, emit } = open([feuer])
    fireEvent.click(screen.getAllByRole('button', { name: new RegExp(O.action) })[0])
    const saved = lastSaved(onChange)
    expect(saved).toHaveLength(1) // still there
    expect(saved[0].done?.at).toBeTruthy()
    expect(saved[0].done?.by).toBe('Muster Anna')
    // ONE row, naming what and where (the row's own timestamp says when) — «Feuer EG gelöscht»
    expect(log).toHaveBeenCalledTimes(1)
    expect(log.mock.calls[0][1]).toBe('Feuer EG gelöscht')
    expect(log.mock.calls[0][2]).toMatchObject({ annoId: 'f1' })
    expect(emit).toHaveBeenCalledWith('board.edit', expect.objectContaining({ id: 'f1', patch: { done: saved[0].done } }))
    // …and the Karte's view of the same object, so the replay's map view greys it too
    expect(emit).toHaveBeenCalledWith('entity.edit', { id: 'f1', patch: { done: saved[0].done } })
  })

  it('states a set one and the pressed «Erledigt» takes it back – a row, and `done: null` for the replay', () => {
    const done = { at: '2026-09-23T18:40:00.000Z' }
    const { onChange, log, emit, container } = open([{ ...feuer, done }])
    // greyed on the board, the time in its corner
    expect(container.querySelector('.ts.ts-done .sym-done')?.textContent).toMatch(/^\d\d:\d\d$/)
    expect(screen.getAllByText(new RegExp(`^${O.word.fire.inline} \\d\\d:\\d\\d$`)).length).toBeGreaterThan(0)
    fireEvent.click(screen.getAllByRole('button', { name: O.action, pressed: true })[0])
    expect(lastSaved(onChange)[0].done).toBeUndefined()
    expect(log.mock.calls[0][1]).toBe('Feuer EG wieder aktiv')
    expect(emit).toHaveBeenCalledWith('board.edit', expect.objectContaining({ id: 'f1', patch: { done: null } }))
    expect(emit).toHaveBeenCalledWith('entity.edit', { id: 'f1', patch: { done: null } })
  })

  it('«Entfernen» writes the same removal row the Karte writes — once, about the object', async () => {
    const { onChange, log } = open([feuer])
    await act(async () => { fireEvent.click(screen.getAllByRole('button', { name: appConfig.copy.remove })[0]) })
    expect(lastSaved(onChange)).toEqual([])
    expect(log).toHaveBeenCalledTimes(1)
    expect(log.mock.calls[0][1]).toBe(fillTemplate(appConfig.copy.log.objectDeleted, { name: 'Feuer' }))
    // the subject, never a jump target: the object is gone
    expect(log.mock.calls[0][2]).toEqual({ subjectId: 'f1' })
  })

  it('the Delete key writes the same removal row as the panel’s «Entfernen»', async () => {
    const { onChange, log } = open([feuer])
    await act(async () => { fireEvent.keyDown(window, { key: 'Delete' }) })
    expect(lastSaved(onChange)).toEqual([])
    expect(log).toHaveBeenCalledTimes(1)
    expect(log.mock.calls[0][1]).toBe('Feuer entfernt')
    expect(log.mock.calls[0][2]).toEqual({ subjectId: 'f1' })
  })

  // owner's sign-off on #226: «we don't need "erledigt" for cars»
  it('offers no row on a Fahrzeug — its editor has only «Entfernen»', () => {
    const car: BoardAnno = { id: 'v1', kind: 'symbol', x: 0.5, y: 0.5, floor: 0, symbol: 'VKF Fahrzeug', label: 'TLF' }
    open([car])
    expect(screen.queryByRole('button', { name: new RegExp(O.action) })).toBeNull()
    expect(screen.getAllByRole('button', { name: appConfig.copy.remove }).length).toBeGreaterThan(0)
  })

  it('…but a Fahrzeug that already carries `done` (an older record) can still be reopened', () => {
    const car: BoardAnno = { id: 'v1', kind: 'symbol', x: 0.5, y: 0.5, floor: 0, symbol: 'VKF Fahrzeug', label: 'TLF', done: { at: '2026-09-23T18:40:00.000Z' } }
    const { onChange } = open([car])
    fireEvent.click(screen.getAllByRole('button', { name: O.action, pressed: true })[0])
    expect(lastSaved(onChange)[0].done).toBeUndefined()
  })

  it('offers nothing on a read-only board — but still states that it is done', () => {
    open([{ ...feuer, done: { at: '2026-09-23T18:40:00.000Z' } }], { readOnly: true })
    expect(screen.queryByRole('button', { name: new RegExp(O.action) })).toBeNull()
    expect(screen.getAllByText(new RegExp(`^${O.word.fire.inline} \\d\\d:\\d\\d$`)).length).toBeGreaterThan(0)
  })
})

// UX sweep M9 (20.10.2026): the Karte's Trupp dock had «Trupp finden», the Plan's only ✕ and ⓘ —
// a Zugführer working on a plan could not find a Trupp from there.
describe('the plan’s Trupp dock finds a Trupp, like the Karte’s', () => {
  const arm = () => fireEvent.click(screen.getByRole('button', { name: appConfig.copy.whiteboard.team }))

  it('opens the shared finder from the dock', () => {
    const open = vi.fn()
    renderPlan([], { truppFinder: { open, disabled: false } })
    arm()
    fireEvent.click(screen.getByRole('button', { name: appConfig.copy.truppFinder.title }))
    expect(open).toHaveBeenCalledTimes(1)
  })

  it('stays on the dock, disabled, while no Trupp is placed anywhere', () => {
    renderPlan([], { truppFinder: { open: vi.fn(), disabled: true } })
    arm()
    expect((screen.getByRole('button', { name: appConfig.copy.truppFinder.title }) as HTMLButtonElement).disabled).toBe(true)
  })
})

// UX sweep M4 (owner 20./21.10.2026: a double tap is «a map function … definitely not for
// finishing something», and an armed tool owns its taps): a Punkte draft finishes on ✓ only.
describe('a double tap on a Punkte draft finishes nothing', () => {
  beforeEach(() => {
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue({
      left: 0, top: 0, right: 400, bottom: 400, width: 400, height: 400, x: 0, y: 0, toJSON: () => ({}),
    } as DOMRect)
  })
  afterEach(() => { vi.restoreAllMocks() })
  const W = appConfig.copy.whiteboard
  const tapAt = (el: Element, x: number, y: number) => {
    fireEvent.pointerDown(el, { clientX: x, clientY: y, pointerId: 1, pointerType: 'touch' })
    fireEvent.pointerUp(el, { clientX: x, clientY: y, pointerId: 1, pointerType: 'touch' })
  }
  const corners = (c: HTMLElement) => {
    fireEvent.click(screen.getByRole('button', { name: 'Fläche' }))
    const ink = c.querySelector('.wb-ink')!
    tapAt(ink, 100, 100); tapAt(ink, 300, 100); tapAt(ink, 200, 300)
    return ink
  }

  it('closes no Fläche – its second tap lands on the grip the first just laid and adds no corner', () => {
    const { container, onChange } = renderPlan([])
    const ink = corners(container)
    tapAt(ink, 100, 300)
    const grips = screen.getAllByRole('button', { name: W.dragVertex })
    tapAt(grips[grips.length - 1], 101, 300)
    expect(onChange).not.toHaveBeenCalled()
    expect(screen.getAllByRole('button', { name: W.dragVertex })).toHaveLength(4)
  })

  it('✓ is the way to finish', () => {
    const { container, onChange } = renderPlan([])
    corners(container)
    fireEvent.click(screen.getByRole('button', { name: appConfig.copy.done }))
    expect(onChange.mock.calls[0][0][0].kind).toBe('area')
  })
})

// Taking the «E» off a Teilstück lets go of every line end hanging on it, where the E stood. A line
// with BOTH ends on that E used to go out as two `board.edit`s, each from the line's ORIGINAL
// points — so replay folded the second over the first and put the first end back (Lage twin #492).
describe('the Abschluss «Keiner» on a Teilstück (changePlanEnding)', () => {
  it('sends ONE board.edit per hanging line, with both ends where the E stood', async () => {
    const onE = { target: { kind: 'line' as const, id: 't1', endpoint: 'end' as const }, routing: 'direct' as const }
    const teil: BoardAnno = { id: 't1', kind: 'draw', pts: [[0.2, 0.2, 0], [0.8, 0.8, 0]], floor: 0, teilstueck: true }
    const loop: BoardAnno = { id: 'h1', kind: 'draw', pts: [[0.1, 0.9, 0], [0.5, 0.5, 0], [0.9, 0.1, 0]], floor: 0, startAttachment: onE, endAttachment: onE }
    const emit = vi.fn()
    ui.answer = true
    const { container } = renderPlan([teil, loop], { emit })
    fireEvent.pointerDown(hitShape(container))
    await act(async () => { fireEvent.click(screen.getAllByRole('button', { name: appConfig.copy.drawingEditor.endingNoneWhat })[0]) })
    const edits = emit.mock.calls.filter(([op, p]) => op === 'board.edit' && p?.id === 'h1')
    expect(edits).toHaveLength(1)
    const pts = edits[0][1].patch.pts as number[][]
    expect(pts[0]).toEqual([0.8, 0.8, 0])
    expect(pts[pts.length - 1]).toEqual([0.8, 0.8, 0])
  })
})

// The Plan's twins of the replay rules: a cleared line end travels as `null` (lineAttachments ·
// wireFreed), so the replayed sheet hangs the line on nothing the live sheet doesn't.
describe('Plan line ends in replay', () => {
  const onChip = { target: { kind: 'object' as const, id: 'c1' }, routing: 'direct' as const }

  it('«Umkehren»: an end that is free after the swap is free in replay', async () => {
    const coupled: BoardAnno = { ...line, endAttachment: onChip }
    const emit = vi.fn()
    const { container } = renderPlan([coupled], { emit })
    fireEvent.pointerDown(hitShape(container))
    fireEvent.click(screen.getAllByRole('button', { name: new RegExp(appConfig.copy.drawingEditor.reverse) })[0])
    const { board } = await replayEmits({ board: { tafel: [coupled] } }, emit.mock.calls)
    expect(board.tafel[0].startAttachment?.target).toEqual(onChip.target)
    expect(board.tafel[0]).not.toHaveProperty('endAttachment')
  })

  it('deleting what a line hangs on leaves the line free in replay', async () => {
    const target: BoardAnno = { id: 't1', kind: 'draw', pts: [[0.6, 0.1, 0], [0.9, 0.1, 0]], floor: 0 }
    const hanging: BoardAnno = { ...line, endAttachment: { target: { kind: 'line', id: 't1', endpoint: 'start' }, routing: 'direct' } }
    const emit = vi.fn()
    ui.answer = true
    const { container } = renderPlan([target, hanging], { emit })
    fireEvent.pointerDown(hitShape(container))
    await act(async () => { fireEvent.click(screen.getAllByRole('button', { name: new RegExp(appConfig.copy.remove) })[0]) })
    expect(emit.mock.calls.some(([op]) => op === 'board.delete')).toBe(true)
    const { board } = await replayEmits({ board: { tafel: [target, hanging] } }, emit.mock.calls)
    expect(board.tafel.find((a) => a.id === 'l1')).not.toHaveProperty('endAttachment')
  })
})

// The Plan's Abschluss as the audit stream carries it (lib/drawingEdit · endingWireFlags, the
// Lage's twin): a flag switched OFF went out as `undefined`, which JSON drops, so replay kept it.
describe('the Plan\'s Abschluss in replay', () => {
  it('«Keiner» on an arrow line replays as no Abschluss', async () => {
    const arrowLine: BoardAnno = { ...line, arrow: true, arrowStop: true }
    const emit = vi.fn()
    const { container } = renderPlan([arrowLine], { emit })
    fireEvent.pointerDown(hitShape(container))
    await act(async () => { fireEvent.click(screen.getAllByRole('button', { name: appConfig.copy.drawingEditor.endingNoneWhat })[0]) })
    const { board } = await replayEmits({ board: { tafel: [arrowLine] } }, emit.mock.calls)
    expect(endingOf(board.tafel[0])).toBe('none')
  })
})
