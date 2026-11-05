// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { MeasurePanel } from './MeasurePanel'
import { appConfig } from '../config/appConfig'
import { fillTemplate } from '../lib/format'
import type { LngLat } from '../types'

afterEach(cleanup)

const C = appConfig.copy.measure
// two points ~1 km apart in Oberwil — enough for the Strecke readout
const strecke: LngLat[] = [[7.55, 47.5], [7.56, 47.5]]
// three corners — the minimum a Fläche readout (and its adopt action) needs
const flaeche: LngLat[] = [...strecke, [7.56, 47.51]]

// «Als Linie übernehmen» — the measured path becomes a drawn line. Before it, the only way to KEEP
// a Strecke was to draw it a second time by hand, on top of the one just measured. The panel is
// shared by both surfaces (Lage map + Plan), so the action arrives on both at once.
describe('MeasurePanel · Als Linie übernehmen', () => {
  const base = { coords: strecke, profile: null, profileLoading: false, showProfile: false } as const

  it('hands the measured path over on tap', () => {
    const onAdopt = vi.fn()
    render(<MeasurePanel {...base} mode="line" onAdopt={onAdopt} />)
    fireEvent.click(screen.getByRole('button', { name: C.adoptLine }))
    expect(onAdopt).toHaveBeenCalledTimes(1)
  })

  it('is absent without the callback — a locked surface measures but never draws', () => {
    render(<MeasurePanel {...base} mode="line" />)
    expect(screen.queryByRole('button', { name: C.adoptLine })).toBeNull()
  })

  it('is absent while the measurement is only a hint (too few points / uncalibrated plan)', () => {
    const onAdopt = vi.fn()
    const { rerender } = render(<MeasurePanel {...base} coords={[strecke[0]]} mode="line" onAdopt={onAdopt} />)
    expect(screen.queryByRole('button', { name: C.adoptLine })).toBeNull()
    rerender(<MeasurePanel {...base} mode="line" blocked hint="Zuerst kalibrieren" onAdopt={onAdopt} />)
    expect(screen.queryByRole('button', { name: C.adoptLine })).toBeNull()
  })

  it('is line-only — a measured Fläche offers its own action instead', () => {
    render(<MeasurePanel {...base} coords={flaeche} mode="area" onAdopt={vi.fn()} />)
    expect(screen.queryByRole('button', { name: C.adoptLine })).toBeNull()
  })
})

describe('MeasurePanel · automatic Kartenverknüpfung', () => {
  const base = { profile: null, profileLoading: false, showProfile: false } as const

  it('opens an empty linked Plan with only the automatic reference source', () => {
    const note = appConfig.copy.whiteboard.scale.chipAutoHint
    render(<MeasurePanel {...base} mode="line" coords={[]} scaleNote={note} />)
    expect(screen.getByRole('status').textContent).toBe(note)
    expect(screen.queryByText(C.hintLine)).toBeNull()
  })

  it('restores the point instruction once the first point has been placed', () => {
    const note = appConfig.copy.whiteboard.scale.chipAutoHint
    render(<MeasurePanel {...base} mode="line" coords={[strecke[0]]} scaleNote={note} />)
    expect(screen.getByText(C.hintLine)).toBeTruthy()
    expect(screen.getByRole('status').textContent).toBe(note)
  })
})

// «Als Fläche übernehmen» — the twin of the line adopt, on the measure tool's area mode: the
// measured ring becomes a drawn Fläche. Same panel, so again both surfaces at once.
describe('MeasurePanel · Als Fläche übernehmen', () => {
  const base = { coords: flaeche, profile: null, profileLoading: false, showProfile: false } as const

  it('hands the measured ring over on tap', () => {
    const onAdopt = vi.fn()
    render(<MeasurePanel {...base} mode="area" onAdopt={onAdopt} />)
    fireEvent.click(screen.getByRole('button', { name: C.adoptArea }))
    expect(onAdopt).toHaveBeenCalledTimes(1)
  })

  it('is absent without the callback — a locked surface measures but never draws', () => {
    render(<MeasurePanel {...base} mode="area" />)
    expect(screen.queryByRole('button', { name: C.adoptArea })).toBeNull()
  })

  it('is absent while the measurement is only a hint (under 3 points / uncalibrated plan)', () => {
    const onAdopt = vi.fn()
    const { rerender } = render(<MeasurePanel {...base} coords={strecke} mode="area" onAdopt={onAdopt} />)
    expect(screen.queryByRole('button', { name: C.adoptArea })).toBeNull()
    rerender(<MeasurePanel {...base} mode="area" blocked hint="Zuerst kalibrieren" onAdopt={onAdopt} />)
    expect(screen.queryByRole('button', { name: C.adoptArea })).toBeNull()
  })

  it('is area-only — a measured Strecke offers the line action instead', () => {
    render(<MeasurePanel {...base} coords={strecke} mode="line" onAdopt={vi.fn()} />)
    expect(screen.queryByRole('button', { name: C.adoptArea })).toBeNull()
    expect(screen.getByRole('button', { name: C.adoptLine })).toBeTruthy()
  })
})

// ONE ROW (10.10.2026, owner's iPhone): the readout, the adopt action and the ▾ share a line, and
// what else the panel carries — the Höhenprofil, «Neu kalibrieren», the scale's source — folds
// behind that ▾. Before there is a measurement nothing folds: the calibration IS the next step.
describe('MeasurePanel · one row, the rest folded', () => {
  const base = { coords: strecke, profile: null, profileLoading: false, showProfile: false } as const
  const note = appConfig.copy.whiteboard.scale.chipAutoHint

  it('folds the scale note and the recalibration behind the row, and opens them on tap', () => {
    const onCalibrate = vi.fn()
    const { rerender } = render(<MeasurePanel {...base} mode="line" scaleNote={note} onAdopt={vi.fn()} />)
    const toggle = screen.getByRole('button', { expanded: false })
    expect(screen.queryByRole('status')).toBeNull()
    fireEvent.click(toggle)
    expect(screen.getByRole('status').textContent).toBe(note)
    // the adopt action is its own control on the row, not part of the toggle
    expect(toggle.contains(screen.getByRole('button', { name: C.adoptLine }))).toBe(false)
    rerender(<MeasurePanel {...base} mode="line" onCalibrate={onCalibrate} recalibrateLabel="Neu kalibrieren" />)
    fireEvent.click(screen.getByRole('button', { name: 'Neu kalibrieren' }))
    expect(onCalibrate).toHaveBeenCalledTimes(1)
  })

  it('folds the Höhenprofil the same way', () => {
    render(<MeasurePanel {...base} mode="line" showProfile profileLoading />)
    expect(screen.queryByText(C.profileLoading)).toBeNull()
    fireEvent.click(screen.getByRole('button', { expanded: false }))
    expect(screen.getByText(C.profileLoading)).toBeTruthy()
  })

  it('is a plain readout with nothing to fold, and on a measured Fläche too', () => {
    const { rerender } = render(<MeasurePanel {...base} mode="line" onAdopt={vi.fn()} />)
    expect(screen.queryByRole('button', { expanded: false })).toBeNull()
    rerender(<MeasurePanel {...base} coords={flaeche} mode="area" scaleNote={note} onAdopt={vi.fn()} />)
    expect(screen.queryByRole('status')).toBeNull()
    fireEvent.click(screen.getByRole('button', { expanded: false }))
    expect(screen.getByRole('status').textContent).toBe(note)
  })

  it('keeps an uncalibrated Plan\'s «Kalibrieren» in view — nothing is measured yet', () => {
    render(<MeasurePanel {...base} mode="line" blocked hint="Zuerst kalibrieren" onCalibrate={vi.fn()} calibrateLabel="Kalibrieren" />)
    expect(screen.getByRole('button', { name: 'Kalibrieren' })).toBeTruthy()
    expect(screen.queryByRole('button', { expanded: false })).toBeNull()
  })
})

// Wassertransport (components/WaterRelay): ADDED on the Karte's Strecke from a button under the
// Höhenprofil, closed by its own ×. A plain distance measurement stays two numbers; the pump count
// joins the folded readout only once the section was added in this measurement.
describe('MeasurePanel · Wassertransport', () => {
  const R = appConfig.copy.relay
  const relay = (open: boolean) => ({ value: {}, onChange: vi.fn(), open, setOpen: vi.fn() })
  const base = { coords: strecke, profile: null, profileLoading: false, showProfile: false, mode: 'line' } as const
  const fold = () => screen.getByRole('button', { name: new RegExp(C.distance) })

  it('a plain measurement keeps its two numbers; the section is added from the fold', () => {
    const r = relay(false)
    render(<MeasurePanel {...base} relay={r} />)
    expect(screen.queryByText(R.pumps)).toBeNull()
    fireEvent.click(fold())
    fireEvent.click(screen.getByRole('button', { name: R.add }))
    expect(r.setOpen).toHaveBeenCalledWith(true)
  })

  it('the Höhenprofil stays until the section is added — then its chart takes over', () => {
    const profile = { points: [{ dist: 0, alt: 300 }, { dist: 760, alt: 310 }], min: 300, max: 310, gain: 10, loss: 0, start: 300, end: 310 }
    const { rerender } = render(<MeasurePanel {...base} showProfile profile={profile} relay={relay(false)} />)
    fireEvent.click(fold())
    expect(screen.getByText(C.profile)).toBeTruthy()
    rerender(<MeasurePanel {...base} showProfile profile={profile} relay={relay(true)} />)
    expect(screen.queryByText(C.profile)).toBeNull()
    expect(screen.queryByRole('button', { name: R.add })).toBeNull()
    // the profile's own Aufstieg row moves under the combined chart
    expect(screen.getByText('+10 m')).toBeTruthy()
  })

  it('pointing at the chart reads it out — distance and pressure at that spot', () => {
    render(<MeasurePanel {...base} relay={relay(true)} />)
    fireEvent.click(fold())
    expect(screen.queryByRole('status')).toBeNull()
    // a mouse hovering; jsdom lays nothing out, so it lands on the chart's left edge, the source
    const chart = screen.getByRole('img', { name: new RegExp(R.title) })
    fireEvent.pointerMove(chart, { pointerType: 'mouse' })
    expect(screen.getByRole('status').textContent).toMatch(/^0 m.*6\.0 bar$/)
    fireEvent.pointerLeave(chart, { pointerType: 'mouse' })
    expect(screen.queryByRole('status')).toBeNull()
  })

  it('the inputs are edited in place – the Quelle picker writes straight through, no sheet', () => {
    const r = relay(true)
    render(<MeasurePanel {...base} relay={r} />)
    fireEvent.click(fold())
    expect(screen.getByRole('group', { name: R.pressure })).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: R.sources.hydrant }))
    fireEvent.click(screen.getByRole('button', { name: R.sources.weier }))
    expect(r.onChange).toHaveBeenCalledWith({ relay: { source: 'weier' } })
  })

  it('answers with the pressure at the end – no Pumpen tile, no «Keine Pumpe nötig»', () => {
    // ~760 m flat from a 6 bar Hydrant: one pump, its count only in the folded readout
    render(<MeasurePanel {...base} relay={relay(true)} />)
    fireEvent.click(fold())
    expect(screen.getByText(R.endBar)).toBeTruthy()
    expect(screen.queryByText(R.pumps)).toBeNull()
  })

  it('«Pumpen als Symbole setzen» hands over every pump at once', () => {
    const onPlacePumps = vi.fn()
    // ~2.3 km flat: two automatic pumps
    render(<MeasurePanel {...base} coords={[[7.55, 47.5], [7.58, 47.5]]} relay={relay(true)} onPlacePumps={onPlacePumps} />)
    fireEvent.click(fold())
    fireEvent.click(screen.getByRole('button', { name: R.placePumps }))
    expect(onPlacePumps).toHaveBeenCalledTimes(1)
    const [coords] = onPlacePumps.mock.calls[0] as [LngLat[]]
    expect(coords).toHaveLength(screen.getAllByRole('button', { name: /^Pumpe \d$/ }).length)
    expect(coords.length).toBeGreaterThan(1)
  })

  it('«Als Leitung auf die Karte» is the panel\'s adopt', () => {
    const onAdopt = vi.fn()
    render(<MeasurePanel {...base} relay={relay(true)} onAdopt={onAdopt} />)
    fireEvent.click(fold())
    fireEvent.click(screen.getByRole('button', { name: R.adoptLine }))
    expect(onAdopt).toHaveBeenCalledTimes(1)
  })

  it('neither action without its callback – a locked surface only asks', () => {
    render(<MeasurePanel {...base} relay={relay(true)} />)
    fireEvent.click(fold())
    expect(screen.queryByRole('button', { name: R.adoptLine })).toBeNull()
    expect(screen.queryByRole('button', { name: R.placePumps })).toBeNull()
  })

  // the pump's one adjustable number, in a bubble at the pump – portalled, never in the panel's flow
  it('tapping a pump opens its bubble with the output to set; Escape closes it', () => {
    const { container } = render(<MeasurePanel {...base} relay={relay(true)} />)
    fireEvent.click(fold())
    const pump = screen.getByRole('button', { name: fillTemplate(R.pumpN, { n: 1 }) })
    fireEvent.keyDown(pump, { key: 'Enter' }) // a tap, as the keyboard does it (jsdom has no pointer capture)
    const bubble = screen.getByRole('dialog', { name: fillTemplate(R.pumpN, { n: 1 }) })
    expect(within(bubble).getByRole('group', { name: R.outlet })).toBeTruthy()
    expect(container.contains(bubble)).toBe(false)
    fireEvent.keyDown(bubble, { key: 'Escape' })
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  // the press on the open pump is the pump's own tap – it closes the bubble, it does not close it
  // as an outside press and then reopen it
  it('a second tap on the same pump closes its bubble', () => {
    render(<MeasurePanel {...base} relay={relay(true)} />)
    fireEvent.click(fold())
    const pump = screen.getByRole('button', { name: fillTemplate(R.pumpN, { n: 1 }) })
    fireEvent.keyDown(pump, { key: 'Enter' })
    Object.assign(pump, { setPointerCapture: () => {} }) // jsdom's SVG has none
    fireEvent.pointerDown(pump, { button: 0, pointerType: 'mouse' })
    fireEvent.mouseDown(pump)
    fireEvent.click(pump)
    expect(screen.getByRole('dialog')).toBeTruthy() // the outside press on the pump was ignored…
    fireEvent.keyDown(pump, { key: 'Enter' })
    expect(screen.queryByRole('dialog')).toBeNull() // …and its own tap closed it
  })

  it('the heading is the section alone; ⓘ opens the sources over the panel, not in it', () => {
    const { container } = render(<MeasurePanel {...base} relay={relay(true)} />)
    fireEvent.click(fold())
    expect(screen.queryByText(/Planungshilfe/)).toBeNull()
    expect(screen.getByText(R.title)).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: R.sourcesLabel }))
    const note = screen.getByRole('dialog', { name: R.sourcesLabel })
    expect(note.textContent).toContain('AGV')
    expect(container.contains(note)).toBe(false)
  })

  it('the section closes with its own ×', () => {
    const r = relay(true)
    render(<MeasurePanel {...base} relay={r} />)
    fireEvent.click(fold())
    fireEvent.click(screen.getByRole('button', { name: appConfig.copy.closeDialog }))
    expect(r.setOpen).toHaveBeenCalledWith(false)
  })

  it('once opened, the folded readout says how many pumps the Strecke takes', () => {
    render(<MeasurePanel {...base} relay={relay(true)} />)
    // ~760 m flat at 75 mm / 800 l/min from a 6 bar Hydrant: one pump
    expect(screen.getByText(R.pumps).nextElementSibling?.textContent).toBe('1')
  })

  it('is not offered without a relay — a Plan sheet has no ground', () => {
    render(<MeasurePanel {...base} />)
    expect(screen.queryByRole('button', { name: R.add })).toBeNull()
  })
})
