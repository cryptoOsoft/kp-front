// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, cleanup, fireEvent } from '@testing-library/react'
import { ContextPanel, type SymbolView } from './ContextPanel'
import type { SymbolControl } from '../types'
import { appConfig } from '../config/appConfig'
// The ADR/ERG datasets are fetched static assets now (lib/staticData) — inject them the
// way the boot prefetch would, so the autofill/readout under test sees the real tables.
import unData from '../../public/un-hazard.json'
import ergData from '../../public/erg.json'
import { __setUnHazardData, type UnHazardEntry } from '../lib/unHazard'
import { __setErgData, type ErgData } from '../lib/erg'
__setUnHazardData(unData as UnHazardEntry[])
__setErgData(ergData as unknown as ErgData)

afterEach(cleanup)

// Steppers are keyed by their German labels (appConfig.copy.contextPanel).
const L = { floor: 'Geschoss', floorFrom: 'Von Geschoss', floorTo: 'Bis Geschoss', count: 'Anzahl', rotation: 'Drehung' }

function setup(over: Partial<React.ComponentProps<typeof ContextPanel>> = {}) {
  const entity: SymbolView = { id: 's1', symbol: 'VKF Feuer', label: 'Brand', ...(over.entity ?? {}) }
  const props: React.ComponentProps<typeof ContextPanel> = {
    entity,
    onClose: vi.fn(),
    onTitle: vi.fn(),
    onFields: vi.fn(),
    onDelete: vi.fn(),
    // wire every glyph-stepper callback so visibility is driven purely by `controls` – the storey
    // control is Von/Bis (15.09.2026); a `floor` preset shows it just like `floorRange`
    onFloorFrom: vi.fn(),
    onFloorTo: vi.fn(),
    onCount: vi.fn(),
    onRotate: vi.fn(),
    ...over,
  }
  render(<ContextPanel {...props} />)
  return props
}

// a stepper is present iff its label text is rendered
const hasStepper = (label: string) => screen.queryByText(label) !== null

describe('ContextPanel — stepper gating by the `controls` prop', () => {
  it('shows only the steppers the symbol declares (rotation-only)', () => {
    setup({ controls: new Set<SymbolControl>(['rotation']) })
    expect(hasStepper(L.rotation)).toBe(true)
    expect(hasStepper(L.floor)).toBe(false)
    expect(hasStepper(L.count)).toBe(false)
  })

  it('shows the storeys + count when both are declared, hides rotation', () => {
    setup({ controls: new Set<SymbolControl>(['floor', 'count']) })
    expect(hasStepper(L.floorFrom)).toBe(true)
    expect(hasStepper(L.count)).toBe(true)
    expect(hasStepper(L.rotation)).toBe(false)
  })

  it('hides every glyph-stepper when controls is an empty set', () => {
    setup({ controls: new Set<SymbolControl>([]) })
    expect(hasStepper(L.floor)).toBe(false)
    expect(hasStepper(L.count)).toBe(false)
    expect(hasStepper(L.rotation)).toBe(false)
  })

  it('with no controls prop, shows every WIRED stepper (back-compat for non-symbols)', () => {
    setup({ controls: undefined })
    expect(hasStepper(L.floorFrom)).toBe(true)
    expect(hasStepper(L.count)).toBe(true)
    expect(hasStepper(L.rotation)).toBe(true)
  })

  it('shows the von/bis storeys for a symbol that declares ONLY floorRange (the Lift)', () => {
    // ⚠️ regression: floorRange was missing from the gate around the stepper row, so a Lift —
    // whose preset lists no other control — rendered no steppers at all and its storey span was
    // unreachable on both surfaces.
    setup({ controls: new Set<SymbolControl>(['floorRange']) })
    expect(hasStepper(L.floorFrom)).toBe(true)
    expect(hasStepper(L.floorTo)).toBe(true)
    expect(hasStepper(L.floor)).toBe(false) // the single «Geschoss» stepper is gone (15.09.): Von/Bis IS the storey control
  })

  it('a declared control whose callback is NOT wired stays hidden', () => {
    // controls allows floor, but onFloor is not provided ⇒ the surface can't do it ⇒ hidden
    setup({ controls: new Set<SymbolControl>(['floor', 'rotation']), onFloor: undefined })
    expect(hasStepper(L.floor)).toBe(false)
    expect(hasStepper(L.rotation)).toBe(true)
  })
})

describe('ContextPanel — basic wiring', () => {
  it('names the SYMBOL in the header, and it cannot be edited', () => {
    // ⚠️ The header is a name, not a field: renaming a «Rauch» to «Küche» made the panel lie
    // about which symbol was selected. Anything worth saying about one symbol goes in Notizen.
    const p = setup({ controls: new Set<SymbolControl>(['rotation']) })
    expect(screen.getByText('Feuer')).toBeTruthy()          // the symbol's own name
    expect(screen.queryByDisplayValue('Brand')).toBeNull()  // …and no input to overwrite it
    fireEvent.click(screen.getByLabelText('Schliessen'))
    expect(p.onClose).toHaveBeenCalled()
  })

  it('gives a user-labelled symbol its own Bezeichnung field instead', () => {
    // the generic Fahrzeug is the one symbol whose label IS its identity — recognised by the
    // station having configured a title list for it
    setup({ entity: { id: 'v1', symbol: 'VKF Fahrzeug', label: 'TLF' }, titleOptions: ['TLF', 'MTF'] })
    expect(screen.getByText('Bezeichnung')).toBeTruthy()
  })

  // sweep K12 (29.09.2026): the head showed «TLF» as an underlined button AND the field said «TLF»
  it('heads a Fahrzeug with its TYPE like every symbol — the name only in the Bezeichnung field', () => {
    setup({ entity: { id: 'v1', symbol: 'VKF Fahrzeug', label: 'TLF' }, titleOptions: ['TLF', 'MTF'] })
    expect(document.querySelector('.ctx-title-ro')!.textContent).toBe('Fahrzeug')
    expect(document.querySelector('.ctx-title-btn')).toBeNull()
    expect(screen.getAllByText('TLF')).toHaveLength(1) // the Bezeichnung field, and only there
  })

  it('keeps the read-only (viewer) Fahrzeug header the type as well', () => {
    setup({ entity: { id: 'v1', symbol: 'VKF Fahrzeug', label: 'TLF' }, titleOptions: ['TLF', 'MTF'], readOnly: true })
    expect(document.querySelector('.ctx-title-ro')!.textContent).toBe('Fahrzeug')
  })

  it("a live vehicle's Fahrer sits in the same label+picker row as a placed vehicle's", () => {
    // it used to be its own full-width block — the one field a GPS vehicle offers looked like
    // a different kind of thing than the identical preset field next door
    setup({
      entity: { id: 'v1', symbol: 'VKF Fahrzeug', label: 'TLF' },
      readOnly: true,
      driver: { value: '', options: ['Müller Hans'], onChange: vi.fn() },
    })
    expect(screen.getByText('Fahrer').closest('.field')).toBeTruthy()
  })

  // RBAC audit 22.10.2026: a locked session READS the Fahrer – no picker, no empty box
  it("a locked panel states a live vehicle's Fahrer as a read-out", () => {
    setup({ entity: { id: 'v1', symbol: 'VKF Fahrzeug', label: 'TLF' }, readOnly: true, driver: { value: 'Graf Stefan' } })
    expect(screen.getByText('Graf Stefan').className).toContain('kv-val-ro')
    expect(screen.queryByRole('combobox')).toBeNull()
  })

  // …and the Beschriftung / the Schutzabstand: the answer in words, not three faded buttons
  it('a locked panel states the Beschriftung and the Schutzabstand, and offers no switch', () => {
    const C = appConfig.copy.contextPanel
    const onCaption = vi.fn()
    const onErgRings = vi.fn()
    setup({
      entity: { id: 'g1', symbol: 'FW Gefahr Tafel', fields: { 'UN-Nr.': '1005' }, ergRings: 'large' },
      protectedKeys: new Set(['UN-Nr.', 'Stoff']),
      readOnly: true, onCaption, captionDefault: 'auto', onErgRings,
    })
    expect(screen.queryAllByRole('group', { name: C.caption })).toEqual([])
    expect(screen.getAllByText(C.captionAuto)[0].className).toContain('kv-val-ro')
    expect(screen.queryByRole('group', { name: C.ergRingsLabel })).toBeNull()
    expect(screen.getByText(C.ergRingsLarge).className).toContain('kv-val-ro')
  })

  it('stepping rotation up commits via onRotate', () => {
    const p = setup({ controls: new Set<SymbolControl>(['rotation']), entity: { id: 's1', rotation: 0 } })
    fireEvent.pointerDown(screen.getByLabelText('mehr')) // hold-to-repeat: first step fires on pointer-down
    expect(p.onRotate).toHaveBeenCalledWith(15) // ROT_STEP
  })

  // 30.09.2026 (owner's screenshot: «−46.50917745051447°»): a hand-turned symbol shows whole
  // degrees, and ± lands on the 15° marks from there — the stored value is only DISPLAYED rounded
  it('shows a hand-turned rotation in whole degrees and steps onto the 15° grid', () => {
    const p = setup({ controls: new Set<SymbolControl>(['rotation']), entity: { id: 's1', rotation: 360 - 46.50917745051447 } })
    expect(screen.getByText('-47°')).toBeTruthy()
    expect(screen.queryByText(/46\.5/)).toBeNull()
    fireEvent.pointerDown(screen.getByLabelText('mehr'))
    expect(p.onRotate).toHaveBeenLastCalledWith(360 - 45)
    fireEvent.pointerUp(screen.getByLabelText('mehr'))
    fireEvent.pointerDown(screen.getByLabelText('weniger'))
    expect(p.onRotate).toHaveBeenLastCalledWith(360 - 60)
    expect(p.onRotate).toHaveBeenCalledTimes(2)
  })
})

// 30.09.2026 (owner: «fix this» – a door's label ran out of its frame into «Zentrieren»): the
// door to the original is cut at its end, never spilled, and the whole label is its name.
describe('ContextPanel – the door to the original', () => {
  it('cuts its label at the end, still one name', () => {
    const onOriginal = vi.fn()
    setup({ onOriginal, originalLabel: 'Zum Original' })
    const btn = screen.getAllByRole('button', { name: 'Zum Original' })[0]
    expect(btn.querySelector('.btn-t-cut')?.textContent).toBe('Zum Original')
    fireEvent.click(btn)
    expect(onOriginal).toHaveBeenCalled()
  })
})

describe('ContextPanel — Geschoss (Untergeschosse are as reachable as Obergeschosse)', () => {
  const floorOnly = new Set<SymbolControl>(['floor'])
  // Von and Bis on screen ⇒ the FIRST − / + / clear is Von's
  const tapLess = () => fireEvent.pointerDown(screen.getAllByLabelText('weniger')[0])

  it('the first tap on − sets EG (0), not nothing', () => {
    // ⚠️ − used to be dead on an unset Geschoss, so a Kellerbrand could only be reached by
    // stepping UP to 0 first and back down again.
    const p = setup({ controls: floorOnly, entity: { id: 's1' } })
    tapLess()
    expect(p.onFloorFrom).toHaveBeenCalledWith(0)
  })

  it('the first tap on + sets EG (0) too', () => {
    const p = setup({ controls: floorOnly, entity: { id: 's1' } })
    fireEvent.pointerDown(screen.getAllByLabelText('mehr')[0])
    expect(p.onFloorFrom).toHaveBeenCalledWith(0)
  })

  it('steps on down into the Untergeschosse', () => {
    const p = setup({ controls: floorOnly, entity: { id: 's1', floorFrom: 0 } })
    tapLess()
    expect(p.onFloorFrom).toHaveBeenCalledWith(-1)
  })

  it('takes a typed Untergeschoss', () => {
    const p = setup({ controls: floorOnly, entity: { id: 's1' } })
    fireEvent.click(screen.getAllByTitle('Tippen zum Eingeben')[0])
    const input = screen.getByRole('textbox') as HTMLInputElement
    fireEvent.change(input, { target: { value: '-2' } })
    fireEvent.blur(input)
    expect(p.onFloorFrom).toHaveBeenCalledWith(-2)
  })

  it('clears back to unset', () => {
    const p = setup({ controls: floorOnly, entity: { id: 's1', floorFrom: -2 } })
    fireEvent.click(screen.getAllByLabelText('zurücksetzen')[0])
    expect(p.onFloorFrom).toHaveBeenCalledWith(null)
  })

  it('has nothing to clear while unset', () => {
    setup({ controls: floorOnly, entity: { id: 's1' } })
    expect((screen.getAllByLabelText('zurücksetzen')[0] as HTMLButtonElement).disabled).toBe(true)
  })

  it('steps both ends of a von/bis span independently', () => {
    const p = setup({
      controls: new Set<SymbolControl>(['floorRange']),
      entity: { id: 's1', floorFrom: 0, floorTo: 2 },
    })
    const less = screen.getAllByLabelText('weniger')  // [Von, Bis]
    fireEvent.pointerDown(less[less.length - 2])
    expect(p.onFloorFrom).toHaveBeenCalledWith(-1)
    expect(p.onFloorTo).not.toHaveBeenCalled()
    fireEvent.pointerDown(less[less.length - 1])
    expect(p.onFloorTo).toHaveBeenCalledWith(1)
  })

  it('seeds each end of an empty von/bis span on the first − tap', () => {
    const p = setup({
      controls: new Set<SymbolControl>(['floorRange']),
      entity: { id: 's1' },
    })
    screen.getAllByLabelText('weniger').forEach((b) => fireEvent.pointerDown(b))
    expect(p.onFloorFrom).toHaveBeenCalledWith(0)
    expect(p.onFloorTo).toHaveBeenCalledWith(0)
  })
})

describe('ContextPanel — preset fields always surface', () => {
  // an Offizier placed before «Funktion» existed stores only { Name } — the panel must still
  // show the missing preset field (seeded empty), in canonical order (Funktion before Name).
  it('seeds a missing preset field row from protectedKeys', () => {
    setup({
      entity: { id: 'o1', symbol: 'FW Offizier', fields: { Name: 'Hans' } },
      protectedKeys: new Set(['Funktion', 'Name']),
    })
    const keys = screen.getAllByText((_t, el) => el?.className === 'kv-key-ro').map((el) => el.textContent)
    expect(keys).toEqual(['Funktion', 'Name'])
    expect((screen.getByDisplayValue('Hans') as HTMLInputElement).value).toBe('Hans')
  })

  it('does not duplicate a preset field that is already stored', () => {
    setup({
      entity: { id: 'o2', symbol: 'FW Offizier', fields: { Funktion: 'Front', Name: 'Hans' } },
      protectedKeys: new Set(['Funktion', 'Name']),
    })
    const keys = screen.getAllByText((_t, el) => el?.className === 'kv-key-ro').map((el) => el.textContent)
    expect(keys).toEqual(['Funktion', 'Name'])
  })

  // a trailing preset field (Einsatzleiter «Stv.», added after Name) must stay AFTER Name even
  // when it's blank/missing — not hoisted above it just because it isn't stored yet.
  // (The stored keys are still Name/Stv.; this glyph LABELS them by the job — see «the
  // Einsatzleiter pair» below — so the order is read off those labels.)
  it('keeps a missing trailing preset field in canonical order (EL before Stv.)', () => {
    setup({
      entity: { id: 'el1', symbol: 'VKF Einsatzleiter', fields: { Name: 'Müller' } },
      protectedKeys: new Set(['Name', 'Stv.']),
    })
    const keys = screen.getAllByText((_t, el) => el?.className === 'kv-key-ro').map((el) => el.textContent)
    expect(keys).toEqual(['EL', 'Stv. EL'])
  })

  // The KP Front carries the same EL/Stv. pair as the Einsatzleiter glyph (14.09.): same row
  // labels, same ⇄ handover, and the swap re-files both fields in ONE commit.
  it('the KP Front is labelled EL / Stv. EL and hands over with ⇄', () => {
    const { onFields } = setup({
      entity: { id: 'kp1', symbol: 'VKF KP Front', fields: { Name: 'Müller', 'Stv.': 'Weber' } },
      protectedKeys: new Set(['Name', 'Stv.']),
    })
    const keys = screen.getAllByText((_t, el) => el?.className === 'kv-key-ro').map((el) => el.textContent)
    expect(keys).toEqual(['EL', 'Stv. EL'])
    fireEvent.click(screen.getByRole('button', { name: appConfig.copy.contextPanel.swapEl }))
    expect(onFields).toHaveBeenCalledWith({ Name: 'Weber', 'Stv.': 'Müller' })
  })

  it('keeps blank preset rows in the read-only version of the same sidebar', () => {
    setup({
      entity: { id: 'o3', symbol: 'FW Offizier', fields: { Name: 'Hans' } },
      protectedKeys: new Set(['Funktion', 'Name']),
      readOnly: true,
    })
    expect(screen.getByText('Funktion')).toBeTruthy()
    expect(screen.getAllByText('–').length).toBeGreaterThan(0)
  })
})

// The Gefahrentafel's UN-Nr. row drives the ADR chain (Stoff autofill, hazard readout, the
// orange-plate glyph). Operators transcribe the physical plate top-to-bottom — Gefahrnummer,
// then UN — so the classic mis-entry is the swap; fillFromUN repairs it when it is unambiguous.
// «Anzahl Tiere» on the Rettung is a count like the person count beside it (sweep 27.10.2026 #14):
// a ± stepper, stored as the string it always was — and free text from before keeps its field.
describe('ContextPanel — a count field is a stepper', () => {
  const rescue = (fields: Record<string, string>) => ({
    entity: { id: 'r1', symbol: 'VKF Rettungen', fields },
    protectedKeys: new Set(['Status', 'Anzahl Tiere']),
  })
  const st = appConfig.copy.stepper
  const tiere = () => screen.getByRole('group', { name: 'Anzahl Tiere' })

  it('steps an empty count to 1, then up, and clears it', () => {
    const onFields = vi.fn()
    setup({ ...rescue({ Status: 'vermisst' }), onFields })
    fireEvent.click(tiere().querySelector(`[aria-label="${st.more}"]`)!)
    expect(onFields).toHaveBeenLastCalledWith({ Status: 'vermisst', 'Anzahl Tiere': '1' })
    cleanup()
    const again = vi.fn()
    setup({ ...rescue({ Status: 'vermisst', 'Anzahl Tiere': '3' }), onFields: again })
    fireEvent.click(tiere().querySelector(`[aria-label="${st.more}"]`)!)
    expect(again).toHaveBeenLastCalledWith({ Status: 'vermisst', 'Anzahl Tiere': '4' })
    fireEvent.click(tiere().querySelector(`[aria-label="${st.reset}"]`)!)
    expect(again).toHaveBeenLastCalledWith({ Status: 'vermisst', 'Anzahl Tiere': '' })
  })

  it('keeps an old free-text value in a text field', () => {
    setup(rescue({ Status: 'gerettet', 'Anzahl Tiere': '2 Katzen' }))
    expect(screen.queryByRole('group', { name: 'Anzahl Tiere' })).toBeNull()
    expect(screen.getByDisplayValue('2 Katzen')).toBeTruthy()
  })
})

describe('ContextPanel — Gefahrentafel UN-Nr. autofill', () => {
  const tafel = (fields: Record<string, string>) => ({
    entity: { id: 'g1', symbol: 'FW Gefahr Tafel', fields } as SymbolView,
    protectedKeys: new Set(['UN-Nr.', 'Stoff']),
  })

  it('fills an empty Stoff from a typed UN number', () => {
    const onFields = vi.fn()
    setup({ ...tafel({ 'UN-Nr.': '1', Stoff: '' }), onFields })
    const un = screen.getByDisplayValue('1') as HTMLInputElement
    fireEvent.change(un, { target: { value: '1233' } })
    fireEvent.blur(un)
    expect(onFields).toHaveBeenCalledWith({ 'UN-Nr.': '1233', Stoff: 'METHYLAMYLACETAT' })
  })

  it('repairs the plate-order swap: Kemler in UN-Nr., UN in Stoff', () => {
    const onFields = vi.fn()
    setup({ ...tafel({ 'UN-Nr.': '3', Stoff: '1233' }), onFields })
    const un = screen.getByDisplayValue('3') as HTMLInputElement
    fireEvent.change(un, { target: { value: '30' } }) // 30 = the ADR Kemler of UN 1233
    fireEvent.blur(un)
    expect(onFields).toHaveBeenCalledWith({ 'UN-Nr.': '1233', Stoff: 'METHYLAMYLACETAT' })
  })

  it('leaves a non-matching pair alone — no swap on a guess', () => {
    const onFields = vi.fn()
    setup({ ...tafel({ 'UN-Nr.': '4', Stoff: '1233' }), onFields })
    const un = screen.getByDisplayValue('4') as HTMLInputElement
    fireEvent.change(un, { target: { value: '44' } }) // 44 is not 1233's Kemler
    fireEvent.blur(un)
    expect(onFields).toHaveBeenCalledWith({ 'UN-Nr.': '44', Stoff: '1233' })
  })

  // the other half of the 08.09. pair (see the Stoff → UN-Nr. block below): a CHANGED UN-Nr.
  // replaces the substance name instead of leaving the previous Stoff standing beside it
  it('a changed UN-Nr. replaces the stale Stoff', () => {
    const onFields = vi.fn()
    setup({ ...tafel({ 'UN-Nr.': '0027', Stoff: 'SCHWARZPULVER, gekörnt oder in Mehlform' }), onFields })
    const un = screen.getByDisplayValue('0027') as HTMLInputElement
    fireEvent.change(un, { target: { value: '1203' } })
    fireEvent.blur(un)
    expect(onFields).toHaveBeenCalledWith({ 'UN-Nr.': '1203', Stoff: 'BENZIN oder OTTOKRAFTSTOFF' })
  })

  // a symbol saved before the key gained its dot stores 'UN-Nr' — the panel absorbs it into
  // the canonical preset row (no duplicate) and the next commit writes it back renamed
  it('absorbs the legacy dotless UN-Nr key into the preset row', () => {
    const onFields = vi.fn()
    setup({ ...tafel({ 'UN-Nr': '1233' }), onFields })
    const keys = screen.getAllByText((_t, el) => el?.className === 'kv-key-ro').map((el) => el.textContent)
    expect(keys).toEqual(['UN-Nr.', 'Stoff'])
    const un = screen.getByDisplayValue('1233') as HTMLInputElement
    fireEvent.blur(un)
    expect(onFields).toHaveBeenCalledWith({ 'UN-Nr.': '1233', Stoff: 'METHYLAMYLACETAT' })
  })
})

/* The ADR readout explains its codes (Feldtest 07.09.: «keine Ahnung, was 6.1 heisst»), and
 * every ERG distance carries an «Absperrkreis übernehmen» button that turns it into a real one. */
describe('ContextPanel — ADR meanings and ERG «Absperrkreis übernehmen»', () => {
  const tafel = (fields: Record<string, string>) => ({
    entity: { id: 'g1', symbol: 'FW Gefahr Tafel', fields } as SymbolView,
    protectedKeys: new Set(['UN-Nr.', 'Stoff']),
  })

  // review round 7: the words first, the code in brackets behind them — «3 – Entzündbare …» read
  // as a code with a footnote, which is the wrong way round at 3am
  it('prints each code as its meaning with the code in brackets', () => {
    // UN 1230 (METHANOL): class 3, labels 3 + 6.1, packing group II
    setup(tafel({ 'UN-Nr.': '1230', Stoff: '' }))
    expect(screen.getAllByText(/Entzündbare flüssige Stoffe \(3\)/).length).toBeGreaterThan(0)
    expect(screen.getByText(/Giftige Stoffe \(6\.1\)/)).toBeTruthy()
    expect(screen.getByText(/mittlere Gefahr \(II\)/)).toBeTruthy()
  })

  // review round 7, owner: «move the bullet points of the Stoff to the very bottom» — the figures
  // (tiles) first, the Kemler reading last, above the source line
  it('puts the Stoff\'s bullet points after the figure tiles', () => {
    // UN 1203 (Benzin): Gefahrnummer 33 → two Kemler bullets, five figures
    setup(tafel({ 'UN-Nr.': '1203', Stoff: '' }))
    const section = document.querySelector('.un-haz')!
    const kids = [...section.children]
    const tiles = kids.findIndex((el) => el.classList.contains('un-haz-tiles'))
    const bullets = kids.findIndex((el) => el.classList.contains('un-haz-list'))
    const source = kids.findIndex((el) => el.classList.contains('un-erg-src'))
    expect(tiles).toBeGreaterThan(-1)
    expect(bullets).toBeGreaterThan(tiles)
    expect(source).toBeGreaterThan(bullets)
    // the Gefahrnummer keeps its bare number, the coded figures carry their words first
    expect(screen.getByText('33')).toBeTruthy()
  })

  it('«Absperrkreis übernehmen» hands the parsed distance to onAdoptRadius', () => {
    const onAdoptRadius = vi.fn()
    // UN 1005 (Ammoniak): si 30 m / pd 0.1 km / pn 0.2 km
    setup({ ...tafel({ 'UN-Nr.': '1005', Stoff: '' }), onAdoptRadius })
    const buttons = screen.getAllByRole('button', { name: appConfig.copy.contextPanel.ergAdopt })
    expect(buttons.length).toBe(3)
    // icon-only (23.09.2026): the row keeps its width, the name is the hold-tooltip
    expect(buttons[0].textContent).toBe('')
    fireEvent.click(buttons[0])
    expect(onAdoptRadius).toHaveBeenCalledWith(30)
    fireEvent.click(buttons[2])
    expect(onAdoptRadius).toHaveBeenCalledWith(200)
  })

  it('without onAdoptRadius the rows stay plain (Plan side)', () => {
    setup(tafel({ 'UN-Nr.': '1005', Stoff: '' }))
    expect(screen.queryByRole('button', { name: appConfig.copy.contextPanel.ergAdopt })).toBeNull()
  })

  // the transcribed yellow pages drop the class-1 explosives (no id numbers in the source), so
  // the guide is synthesized from the printed rule: class 1 → 112, division 1.4 → 114
  // (Feldtest 08.09.: UN 0027 — Schwarzpulver — showed no ERG guide at all)
  it('synthesizes the ERG guide for class-1 explosives', () => {
    setup(tafel({ 'UN-Nr.': '0027', Stoff: '' })) // 1.1D
    expect(screen.getByText(appConfig.copy.contextPanel.ergGuide)).toBeTruthy()
    expect(screen.getByText('112')).toBeTruthy()
  })

  it('…and 114 for division 1.4', () => {
    setup(tafel({ 'UN-Nr.': '0012', Stoff: '' })) // PATRONEN FÜR HANDFEUERWAFFEN, 1.4S
    expect(screen.getByText('114')).toBeTruthy()
  })
})

/* The reverse door (Feldtest Manuel, 07.09.): on the Gas/Chemie hazard symbols the operator
 * knows the SUBSTANCE, not the number. The Stoff row is a search combobox — the station-common
 * list first, the full ADR table behind the search — and a committed Stoff resolves its UN-Nr.,
 * which is what lights the ADR readout and the Schutzabstand rings. */
describe('ContextPanel — Stoff → UN-Nr. (Gas/Chemie substance search)', () => {
  const chemie = (fields: Record<string, string>) => ({
    entity: { id: 'c1', symbol: 'FW Gefahr C', fields } as SymbolView,
    protectedKeys: new Set(['Stoff', 'UN-Nr.']),
  })
  const openStoff = () => fireEvent.click(screen.getByRole('button', { name: /^Stoff …/ }))

  it('a common substance is one pick away and fills its UN number', () => {
    const onFields = vi.fn()
    setup({ ...chemie({ Stoff: '', 'UN-Nr.': '' }), onFields })
    openStoff()
    fireEvent.click(screen.getByRole('button', { name: 'Salzsäure' }))
    expect(onFields).toHaveBeenCalledWith({ Stoff: 'Salzsäure', 'UN-Nr.': '1789' })
  })

  it('an official ADR name found through the search resolves by name', () => {
    const onFields = vi.fn()
    setup({ ...chemie({ Stoff: '', 'UN-Nr.': '' }), onFields })
    openStoff()
    fireEvent.change(screen.getByPlaceholderText(appConfig.copy.contextPanel.stoffSearch), { target: { value: 'Methylamylacetat' } })
    fireEvent.click(screen.getByRole('button', { name: 'METHYLAMYLACETAT' }))
    expect(onFields).toHaveBeenCalledWith({ Stoff: 'METHYLAMYLACETAT', 'UN-Nr.': '1233' })
  })

  it('an unknown substance stays as typed, the UN row honestly empty', () => {
    const onFields = vi.fn()
    setup({ ...chemie({ Stoff: '', 'UN-Nr.': '' }), onFields })
    openStoff()
    fireEvent.change(screen.getByPlaceholderText(appConfig.copy.contextPanel.stoffSearch), { target: { value: 'Wundermittel' } })
    fireEvent.click(screen.getByRole('button', { name: appConfig.copy.combo.useTyped.replace('{name}', 'Wundermittel') }))
    expect(onFields).toHaveBeenCalledWith({ Stoff: 'Wundermittel', 'UN-Nr.': '' })
  })

  /* Fill-only-if-empty left the plate lying twice over (Feldtest 08.09.): a new UN-Nr. kept the
   * previous Stoff standing, a newly picked Stoff kept the previous UN-Nr. — and the readout and
   * the rings follow the UN, so the mismatch was live on the Karte. Whichever of the pair the
   * commit touched pulls the other one along. */
  it('a newly picked Stoff replaces the standing UN-Nr.', () => {
    const onFields = vi.fn()
    setup({ ...chemie({ Stoff: 'Salzsäure', 'UN-Nr.': '1789' }), onFields })
    fireEvent.click(screen.getByRole('button', { name: /Salzsäure/ }))
    fireEvent.change(screen.getByPlaceholderText(appConfig.copy.contextPanel.stoffSearch), { target: { value: 'Methylamylacetat' } })
    fireEvent.click(screen.getByRole('button', { name: 'METHYLAMYLACETAT' }))
    expect(onFields).toHaveBeenCalledWith({ Stoff: 'METHYLAMYLACETAT', 'UN-Nr.': '1233' })
  })

  it('an unresolvable substance clears the standing UN-Nr. rather than leaving the old one', () => {
    const onFields = vi.fn()
    setup({ ...chemie({ Stoff: 'Salzsäure', 'UN-Nr.': '1789' }), onFields })
    fireEvent.click(screen.getByRole('button', { name: /Salzsäure/ }))
    fireEvent.change(screen.getByPlaceholderText(appConfig.copy.contextPanel.stoffSearch), { target: { value: 'Wundermittel' } })
    fireEvent.click(screen.getByRole('button', { name: appConfig.copy.combo.useTyped.replace('{name}', 'Wundermittel') }))
    expect(onFields).toHaveBeenCalledWith({ Stoff: 'Wundermittel', 'UN-Nr.': '' })
  })
})

// A NOTE is the surface that still types into `label` — its text IS its content. Every other
// symbol's header became read-only on 11.08., so this is where the live-edit path lives now.
describe('ContextPanel — live text editing on a note', () => {
  it('with onTitleLive, streams every keystroke live and finalises once on blur', () => {
    const onTitleLive = vi.fn(); const onTitle = vi.fn()
    setup({ entity: { id: 'n1', label: '' }, onTitleLive, onTitle, onNotePlain: vi.fn() })
    const input = screen.getByDisplayValue('') as HTMLInputElement
    fireEvent.change(input, { target: { value: 'A' } })
    fireEvent.change(input, { target: { value: 'An' } })
    expect(onTitleLive).toHaveBeenCalledTimes(2)
    expect(onTitleLive).toHaveBeenLastCalledWith('An')
    expect(onTitle).not.toHaveBeenCalled() // not committed mid-typing
    fireEvent.blur(input)
    expect(onTitle).toHaveBeenCalledTimes(1)
    expect(onTitle).toHaveBeenCalledWith('An')
  })

  it('without onTitleLive, falls back to commit-only-on-blur', () => {
    const onTitle = vi.fn()
    setup({ entity: { id: 'n2', label: '' }, onTitle, onNotePlain: vi.fn() })
    const input = screen.getByDisplayValue('') as HTMLInputElement
    fireEvent.change(input, { target: { value: 'Hi' } })
    expect(onTitle).not.toHaveBeenCalled()
    fireEvent.blur(input)
    expect(onTitle).toHaveBeenCalledTimes(1)
    expect(onTitle).toHaveBeenCalledWith('Hi')
  })
})

// Details are stored as a key→value map, so two rows sharing a Bezeichnung collapse into one
// (last wins). The panel doesn't block or rename — it just says so on the later row.
describe('ContextPanel — duplicate custom field names', () => {
  const hint = (key: string) =>
    screen.queryByText(`«${key}» gibt es schon – nur der letzte Wert bleibt erhalten.`)

  it('stays quiet while every Bezeichnung is unique', () => {
    setup({ entity: { id: 's1', symbol: 'VKF Feuer', fields: { Test: 'a', 'Test 2': 'b' } } })
    expect(hint('Test')).toBeNull()
    expect(hint('Test 2')).toBeNull()
  })

  it('flags the SECOND row once a key is typed twice, and clears once it is made unique', () => {
    setup({ entity: { id: 's1', symbol: 'VKF Feuer', fields: { Test: 'a', Andere: 'b' } } })
    const key2 = screen.getByDisplayValue('Andere') as HTMLInputElement
    fireEvent.change(key2, { target: { value: 'Test' } })
    expect(hint('Test')).not.toBeNull()
    // exactly one warning — the first occurrence keeps its plain row
    expect(screen.getAllByRole('alert')).toHaveLength(1)
    fireEvent.change(key2, { target: { value: 'Test 3' } })
    expect(hint('Test')).toBeNull()
  })

  it('warns but still commits — nothing is blocked or silently renamed', () => {
    const onFields = vi.fn()
    setup({ entity: { id: 's1', symbol: 'VKF Feuer', fields: { Test: 'a', Andere: 'b' } }, onFields })
    const key2 = screen.getByDisplayValue('Andere') as HTMLInputElement
    fireEvent.change(key2, { target: { value: 'Test' } })
    fireEvent.blur(key2)
    expect(onFields).toHaveBeenCalledWith({ Test: 'b' })
  })
})

// The Einsatzleiter glyph carries the two halves of ONE job. «Name» beside «Stv.» named the value
// on one row and the job on the other, and a handover meant clearing both dropdowns and finding
// both names again — at the one moment nobody has thirty seconds.
describe('ContextPanel — the Einsatzleiter pair', () => {
  const el = (fields: Record<string, string>) => ({
    entity: { id: 's1', symbol: 'VKF Einsatzleiter', fields },
    protectedKeys: new Set(['Name', 'Stv.']),
    fieldOptions: { Name: ['Widmer Céline', 'Müller Hans'], 'Stv.': ['Widmer Céline', 'Müller Hans'] },
  })
  const SWAP = appConfig.copy.contextPanel.swapEl

  it('labels the rows by the JOB, not by «Name»', () => {
    setup(el({ Name: 'Widmer Céline', 'Stv.': 'Müller Hans' }))
    expect(screen.getByText('EL')).toBeTruthy()
    expect(screen.getByText('Stv. EL')).toBeTruthy()
    expect(screen.queryByText('Name')).toBeNull()
  })

  it('hands the Einsatz over in one tap — both fields, one commit', () => {
    const onFields = vi.fn()
    setup({ ...el({ Name: 'Widmer Céline', 'Stv.': 'Müller Hans' }), onFields })
    fireEvent.click(screen.getByRole('button', { name: SWAP }))
    expect(onFields).toHaveBeenCalledTimes(1)
    expect(onFields).toHaveBeenCalledWith({ Name: 'Müller Hans', 'Stv.': 'Widmer Céline' })
  })

  it('works with only one of the two filled — that is a handover to nobody yet', () => {
    const onFields = vi.fn()
    setup({ ...el({ Name: 'Widmer Céline', 'Stv.': '' }), onFields })
    fireEvent.click(screen.getByRole('button', { name: SWAP }))
    expect(onFields).toHaveBeenCalledWith({ Name: '', 'Stv.': 'Widmer Céline' })
  })

  it('offers nothing to swap while both are empty', () => {
    setup(el({ Name: '', 'Stv.': '' }))
    expect(screen.queryByRole('button', { name: SWAP })).toBeNull()
  })

  it('leaves every other symbol alone', () => {
    setup({
      entity: { id: 's1', symbol: 'VKF Fahrzeug', fields: { Fahrer: 'Müller Hans' } },
      protectedKeys: new Set(['Fahrer']),
      fieldOptions: { Fahrer: ['Müller Hans'] },
    })
    expect(screen.getByText('Fahrer')).toBeTruthy()
    expect(screen.queryByRole('button', { name: SWAP })).toBeNull()
  })
})

// D-06: a Georeferenz twin's plaque is read-only because its KIND has no editor on this surface,
// not because the object is protected — and its original's own panel offers Löschen.
describe('ContextPanel — Löschen on an otherwise read-only panel', () => {
  // rendered twice on purpose (pinned footer + the phone's inline copy); CSS shows exactly one
  const del = () => screen.queryAllByRole('button', { name: appConfig.copy.remove })

  it('is hidden on a read-only panel, as it always was', () => {
    setup({ readOnly: true })
    expect(del()).toHaveLength(0)
  })

  it('…and back when the caller says so, without unlocking anything else', () => {
    const props = setup({ readOnly: true, allowDelete: true })
    fireEvent.click(del()[0])
    expect(props.onDelete).toHaveBeenCalled()
    // the fields stay read-only: `allowDelete` is about ONE button, not about the panel
    expect(screen.queryByRole('textbox')).toBeNull()
  })
})

// A just-placed Notiz opens with the caret in its text field — and on a phone the sheet has to be
// FULL for that field to be above the iOS keyboard (05.09.). `.sheet-full` rides on the panel's
// own `.ctx` root (SheetGrip · CtxShell), which is the element the sheet height hangs off and the
// one the grip's tap toggles. `onNoteSize` is what makes this panel a note editor.
describe('ContextPanel — a placed Notiz opens the sheet full', () => {
  const note = (autoFocusNote: boolean) => {
    render(
      <ContextPanel entity={{ id: 'n1', label: '' }} onClose={vi.fn()} onTitle={vi.fn()}
        onFields={vi.fn()} onDelete={vi.fn()}
        onTitleLive={vi.fn()} onNoteSize={vi.fn()} autoFocusNote={autoFocusNote} />,
    )
    return document.querySelector('.ctx')!
  }

  it('expands the sheet and puts the caret in the note text', () => {
    const ctx = note(true)
    expect(ctx.classList.contains('sheet-full')).toBe(true)
    expect(document.activeElement).toBe(screen.getByPlaceholderText(appConfig.copy.whiteboard.textPlaceholder))
  })

  it('leaves a sheet reopened on an existing Notiz at whatever height it had', () => {
    const ctx = note(false)
    expect(ctx.classList.contains('sheet-full')).toBe(false)
  })
})

describe('ContextPanel — Notizen survive every way the sheet can close', () => {
  const notesBox = () =>
    screen.getByPlaceholderText(appConfig.copy.contextPanel.notesPlaceholder) as HTMLTextAreaElement

  // Regression (Feldtest 07.09.): the field committed only on BLUR, and a swipe-dismiss /
  // slot swap unmounts the focused textarea without one — the typed Notiz died with the sheet.
  it('commits a draft on unmount, when no blur ever fired', () => {
    const onNotes = vi.fn()
    const { unmount } = render(
      <ContextPanel entity={{ id: 's1', symbol: 'VKF Feuer', label: 'Brand' }} onClose={vi.fn()}
        onTitle={vi.fn()} onFields={vi.fn()} onDelete={vi.fn()} onNotes={onNotes} />,
    )
    fireEvent.change(notesBox(), { target: { value: 'EG stark verraucht' } })
    unmount()
    expect(onNotes).toHaveBeenCalledExactlyOnceWith('EG stark verraucht')
  })

  it('does not commit twice when blur already wrote the value (the ordinary close)', () => {
    const onNotes = vi.fn()
    const { unmount } = render(
      <ContextPanel entity={{ id: 's1', symbol: 'VKF Feuer', label: 'Brand' }} onClose={vi.fn()}
        onTitle={vi.fn()} onFields={vi.fn()} onDelete={vi.fn()} onNotes={onNotes} />,
    )
    fireEvent.change(notesBox(), { target: { value: 'EG stark verraucht' } })
    fireEvent.blur(notesBox())
    unmount()
    expect(onNotes).toHaveBeenCalledExactlyOnceWith('EG stark verraucht')
  })

  it('writes nothing on unmount when nothing was typed', () => {
    const onNotes = vi.fn()
    const { unmount } = render(
      <ContextPanel entity={{ id: 's1', symbol: 'VKF Feuer', label: 'Brand', notes: 'alt' }} onClose={vi.fn()}
        onTitle={vi.fn()} onFields={vi.fn()} onDelete={vi.fn()} onNotes={onNotes} />,
    )
    unmount()
    expect(onNotes).not.toHaveBeenCalled()
  })
})

// The same hole on the detail fields (27.10.): a Messpunkt reading typed, then a tap on the Karte
// deselected the point – the panel unmounted with the caret still in the field and the value was gone.
describe('ContextPanel — a typed field survives the panel closing', () => {
  const coBox = () => screen.getByText('CO').parentElement?.querySelector('input') as HTMLInputElement
  const mount = (onFields = vi.fn()) => ({
    onFields,
    ...render(
      <ContextPanel entity={{ id: 'm1', symbol: 'FW Messpunkt', label: '' }} onClose={vi.fn()}
        onTitle={vi.fn()} onFields={onFields} onDelete={vi.fn()}
        protectedKeys={new Set(['Raum', 'CO', 'Ex', 'O₂', 'H₂S'])} />,
    ),
  })

  it('commits a typed reading on unmount, when no blur ever fired', () => {
    const { onFields, unmount } = mount()
    fireEvent.change(coBox(), { target: { value: '34' } })
    unmount()
    expect(onFields).toHaveBeenCalledOnce()
    expect(onFields.mock.calls[0][0]).toMatchObject({ CO: '34' })
  })

  it('does not commit twice after an ordinary blur', () => {
    const { onFields, unmount } = mount()
    fireEvent.change(coBox(), { target: { value: '34' } })
    fireEvent.blur(coBox())
    unmount()
    expect(onFields).toHaveBeenCalledOnce()
  })

  it('writes nothing on unmount when nothing was typed', () => {
    const { onFields, unmount } = mount()
    unmount()
    expect(onFields).not.toHaveBeenCalled()
  })
})

/**
 * Angedockte Trupps am HOST (15.09.2026) — the bond read from the symbol's side. It mirrors the
 * «Leitung 2 · Trupp 4 — Lösen» slot on the marker's own bar: a row names BOTH sides before its
 * «Lösen» separates them, and several docked crews get a row each.
 */
describe('ContextPanel — the Trupps docked onto this symbol', () => {
  const az = appConfig.copy.atemschutz
  const row = (who: string) => az.dockLabel.replace('{who}', who).replace('{host}', 'Hydrant')

  it('states each bond in words and offers «Lösen» per row', () => {
    const release = vi.fn()
    setup({
      entity: { id: 'h1', symbol: 'VKF Feuer', label: 'Hydrant' },
      dockedTeams: [
        { id: 'e1', label: row('Trupp 4'), onRelease: release },
        { id: 'e2', label: row('Trupp 2'), onRelease: vi.fn() },
      ],
    })
    expect(screen.getByText(az.dockedTeams)).toBeTruthy()
    expect(screen.getByText(row('Trupp 4'))).toBeTruthy()
    expect(screen.getByText(row('Trupp 2'))).toBeTruthy()
    expect(screen.getAllByText(appConfig.copy.contextPanel.dockedRelease)).toHaveLength(2)
    fireEvent.click(screen.getByText(row('Trupp 4')))
    expect(release).toHaveBeenCalledTimes(1)
  })

  it('a locked surface states the bond without a door out of it', () => {
    setup({
      entity: { id: 'h1', symbol: 'VKF Feuer', label: 'Hydrant' },
      dockedTeams: [{ id: 'e1', label: row('Trupp 4') }],
    })
    expect(screen.getByText(row('Trupp 4'))).toBeTruthy()
    expect(screen.queryByText(appConfig.copy.contextPanel.dockedRelease)).toBeNull()
  })

  it('draws no section at all when nothing is docked', () => {
    setup({ entity: { id: 'h1', symbol: 'VKF Feuer', label: 'Hydrant' } })
    expect(screen.queryByText(az.dockedTeams)).toBeNull()
  })
})

// «Gelöscht / erledigt» (review item 21b, 24.09.2026): the row the Übung's EG Feuer needed instead
// of «Löschen». ONE panel for both surfaces, so these hold on the Karte and the Plan alike.
describe('ContextPanel — «Gelöscht / erledigt»', () => {
  const O = appConfig.copy.objectDone
  const AT = '2026-09-23T18:40:00.000Z'

  // slim sweep 27.09.2026 (D8): the press is the foot's middle tile, «Erledigt», wherever it is offered
  // (a damage or hazard symbol, #226) — it was a full-width row in the body. The 3am
  // walk-through of 25.09.2026 (a reflex tap on the first row greyed a fresh KP Front) holds: the
  // foot is never the first thing under the finger.
  it('offers «Erledigt» as a tile in the foot — between «Zentrieren» and the bin — and the delete is the «Entfernen» square', () => {
    const p = setup({ onDone: vi.fn(), onCenter: vi.fn() })
    const tile = screen.getAllByRole('button', { name: O.action })[0]
    expect(tile.closest('.ctx-actions')).toBeTruthy()
    expect(tile.getAttribute('aria-pressed')).toBe('false')
    expect(tile.title).toBe(O.actionHint)
    expect(tile.closest('.ctx-body')?.firstElementChild?.contains(tile)).toBe(false)
    const foot = tile.closest('.ctx-actions')!
    expect([...foot.querySelectorAll('button')].map((b) => b.textContent || b.getAttribute('aria-label')))
      .toEqual([appConfig.copy.contextPanel.center, O.action, appConfig.copy.remove])
    fireEvent.click(tile)
    expect(p.onDone).toHaveBeenCalledWith(true)
    const bin = screen.getAllByRole('button', { name: appConfig.copy.remove })[0]
    expect(bin.classList.contains('btn-sq')).toBe(true)
    expect(bin.title).toContain(O.removeHint)
    expect(screen.queryByRole('button', { name: appConfig.copy.delete })).toBeNull()
  })

  // ONE toggle (31.10.2026): set, the SAME tile stays in the same spot, pressed, and a tap
  // reopens – the time it was set moved into the header, beside the type.
  it('set, the same foot tile (same name) stands pressed, its title says it reopens, and a tap takes it back; the header says when', () => {
    const p = setup({ onDone: vi.fn(), onCenter: vi.fn(), entity: { id: 's1', symbol: 'VKF Feuer', label: 'Brand', subtitle: 'Schadenlage', done: { at: AT } } })
    const tile = screen.getAllByRole('button', { name: O.action, pressed: true })[0]
    expect(tile.getAttribute('aria-pressed')).toBe('true')
    expect(tile.title).toBe(O.reopenHint)
    const foot = tile.closest('.ctx-actions')!
    expect([...foot.querySelectorAll('button')].map((b) => b.textContent || b.getAttribute('aria-label')))
      .toEqual([appConfig.copy.contextPanel.center, O.action, appConfig.copy.remove])
    expect(document.querySelector('.ctx-head p')?.textContent).toMatch(new RegExp(`^Schadenlage · ${O.word.fire.inline} \\d\\d:\\d\\d$`))
    fireEvent.click(tile)
    expect(p.onDone).toHaveBeenCalledWith(false)
  })

  it('a read-only panel states it and offers nothing; a surface that does not wire it has no row, and its delete is «Entfernen» too', () => {
    setup({ readOnly: true, onDone: vi.fn(), entity: { id: 's1', symbol: 'VKF Rettungen', done: { at: AT } } })
    expect(screen.getByText(new RegExp(`^${O.word.other.inline} \\d\\d:\\d\\d$`))).toBeTruthy()
    expect(screen.queryByRole('button', { name: new RegExp(O.action) })).toBeNull()
    cleanup()
    setup()
    expect(screen.queryByRole('button', { name: new RegExp(O.action) })).toBeNull()
    expect(screen.getAllByRole('button', { name: appConfig.copy.remove }).length).toBeGreaterThan(0)
  })
})
