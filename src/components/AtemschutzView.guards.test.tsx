// @vitest-environment jsdom
// The guards: due clocks in the phone form, a Kontakt another device confirmed, the
// Sicherungstrupp slot, the Eingangsdruck checks, drafts that belong to one state of a Trupp,
// two devices editing one Trupp, and the empty / stood-down / outside-the-field boards.
// Shared setup: AtemschutzView.setup.tsx.
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { AtemschutzView } from './AtemschutzView'
import { useIsPhone } from '../lib/useIsPhone'
import s from './Atemschutz.module.css'
import { Overlays } from '../lib/ui'
import { fillTemplate } from '../lib/format'
import type { Trupp, TruppReading } from '../types'
import { noteOwnContact, resetOwnContacts } from '../lib/contactEcho'
import { registerAtemschutzViewHooks, az, firstBtn, druckName, lastBtn, dz, iso, aktivTrupp, propsFor, mount, typeGuest, pressureRow, kanalRow, pickPressure, pickAuftrag } from './AtemschutzView.setup'

vi.mock('../lib/useIsPhone', async (original) => ({ ...await original<typeof import('../lib/useIsPhone')>(), useIsPhone: vi.fn(() => false) }))
registerAtemschutzViewHooks()

/* ── The phone board, second round (24.09.2026, D1 ⑥ ⑦ ⑧a, item 2) ───────────────────────────── */
// D1 ⑥
describe('the phone Trupp form keeps the due clocks in view', () => {
  afterEach(() => { vi.mocked(useIsPhone).mockReturnValue(false) })
  const inField = (id: string, name: string, contactAgoMin: number): Trupp => ({
    ...aktivTrupp(), id, name, lastContactTime: iso(contactAgoMin * 60_000),
  })
  const openCreate = () => fireEvent.click(firstBtn(az.newTrupp))
  const pinnedNames = () => Array.from(document.querySelectorAll(`.${s.formPinned} .${s.pinNameTxt}`)).map((el) => el.textContent)

  it('pins the due and overdue Trupps above the sheet — the most urgent first, at most two', () => {
    vi.mocked(useIsPhone).mockReturnValue(true)
    mount({ trupps: [inField('f', 'Fresh Fritz', 1), inField('w', 'Warn Wanda', 5.5), inField('o', 'Over Otto', 7), inField('x', 'Very Late Xaver', 9)] })
    openCreate()
    expect(screen.getByRole('region', { name: az.pinnedLabel })).toBeTruthy()
    expect(pinnedNames()).toEqual(['Very Late Xaver', 'Over Otto'])
    // it IS a bottom sheet now: the frame wears the grab bar
    expect(document.querySelector(`.${s.modalSheet} .ui-sheet-grab`)).toBeTruthy()
  })

  it('«Kontakt» on a pinned row confirms without leaving the form, and the form keeps its entries', () => {
    vi.mocked(useIsPhone).mockReturnValue(true)
    const props = mount({ trupps: [inField('o', 'Over Otto', 7)] })
    openCreate()
    typeGuest('Neu Nina')
    const pinned = screen.getByRole('region', { name: az.pinnedLabel })
    fireEvent.click(within(pinned).getByRole('button', { name: `${az.actContact}: Over Otto` }))
    expect(props.recordContact).toHaveBeenCalledWith('o')
    // still the form, still Nina
    expect(screen.getByRole('dialog', { name: az.formCreateTitle })).toBeTruthy()
    expect(screen.getByText('Neu Nina')).toBeTruthy()
  })

  it('pins nothing when nobody is due — and nothing at all on the tablet', () => {
    vi.mocked(useIsPhone).mockReturnValue(true)
    mount({ trupps: [inField('f', 'Fresh Fritz', 1)] })
    openCreate()
    expect(screen.queryByRole('region', { name: az.pinnedLabel })).toBeNull()
    cleanup()
    vi.mocked(useIsPhone).mockReturnValue(false)
    mount({ trupps: [inField('o', 'Over Otto', 7)] })
    openCreate()
    expect(screen.queryByRole('region', { name: az.pinnedLabel })).toBeNull()
    expect(document.querySelector(`.${s.modalSheet}`)).toBeNull()
  })

  it('keeps the Kanal when the sheet is put away — only «Abbrechen» drops it', () => {
    vi.mocked(useIsPhone).mockReturnValue(true)
    mount({ trupps: [inField('f', 'Fresh Fritz', 1)] })
    openCreate()
    fireEvent.click(kanalRow())
    fireEvent.pointerDown(screen.getByLabelText(az.funkkanalUp))
    fireEvent.click(screen.getByRole('button', { name: az.formPickTake }))
    // the ✕ in the head — «not now», like pushing the sheet down
    fireEvent.click(document.querySelector(`.${s.modalHead} .ip-x`)!)
    expect(screen.queryByRole('dialog', { name: az.formCreateTitle })).toBeNull()
    openCreate()
    expect(kanalRow().getAttribute('aria-label')).toBe(`${az.funkkanalSection} ${dz.defaultFunkkanal + 1}`)
    // …and «Abbrechen» throws it away
    fireEvent.click(screen.getByText(az.cancel, { selector: 'button.ip-btn' }))
    openCreate()
    expect(kanalRow().getAttribute('aria-label')).toBe(`${az.funkkanalSection} ${dz.defaultFunkkanal}`)
  })
})

// D1 ⑧a
describe('a Kontakt another device just confirmed asks first', () => {
  afterEach(() => { vi.mocked(useIsPhone).mockReturnValue(false); resetOwnContacts() })
  const confirmedElsewhere = (secAgo: number): Trupp => ({
    ...aktivTrupp(), lastContactTime: iso(secAgo * 1000),
    readings: [...aktivTrupp().readings!, { t: iso(secAgo * 1000), bar: 240, kind: 'contact' }],
  })

  it('«OK» writes nothing; «Nochmals» writes the second contact', async () => {
    vi.mocked(useIsPhone).mockReturnValue(true)
    render(<Overlays />)
    const props = mount({ trupps: [confirmedElsewhere(20)] })
    fireEvent.click(screen.getByRole('button', { name: az.actContact }))
    const ask = await screen.findByRole('alertdialog')
    // a title stating the fact, one line for who and when (owner review 26.09.2026)
    expect(within(ask).getByText(az.contactEchoTitle)).toBeTruthy()
    expect(within(ask).getByText(/^.+ · vor 2\d s auf einem anderen Gerät$/)).toBeTruthy()
    fireEvent.click(within(ask).getByRole('button', { name: az.contactEchoOk }))
    await waitFor(() => expect(screen.queryByRole('alertdialog')).toBeNull())
    expect(props.recordContact).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: az.actContact }))
    fireEvent.click(within(await screen.findByRole('alertdialog')).getByRole('button', { name: az.contactEchoAgain }))
    await waitFor(() => expect(props.recordContact).toHaveBeenCalledWith('tr1'))
  })

  it('asks nothing about this device’s own contact, or about one a minute old', () => {
    vi.mocked(useIsPhone).mockReturnValue(true)
    render(<Overlays />)
    const own = confirmedElsewhere(10)
    noteOwnContact('tr1', own.readings![own.readings!.length - 1].t)
    const a = mount({ trupps: [own] })
    fireEvent.click(screen.getByRole('button', { name: az.actContact }))
    expect(a.recordContact).toHaveBeenCalledWith('tr1')
    cleanup()
    render(<Overlays />)
    const b = mount({ trupps: [confirmedElsewhere(75)] })
    fireEvent.click(screen.getByRole('button', { name: az.actContact }))
    expect(b.recordContact).toHaveBeenCalledWith('tr1')
  })

  // it guards the ACT, not a layout: the 23.09. case was an iPad and a phone (25.09.2026)
  it('asks on the tablet grid and on the handed-over Tafel too', async () => {
    for (const over of [{}, { lite: { subtitle: 'Brand' } }]) {
      render(<Overlays />)
      const props = mount({ trupps: [confirmedElsewhere(20)], ...over })
      fireEvent.click(screen.getByRole('button', { name: az.actContact }))
      const ask = await screen.findByRole('alertdialog')
      fireEvent.click(within(ask).getByRole('button', { name: az.contactEchoOk }))
      await waitFor(() => expect(screen.queryByRole('alertdialog')).toBeNull())
      expect(props.recordContact).not.toHaveBeenCalled()
      cleanup()
    }
  })

  it('makes «OK» — which writes nothing — the filled, focused answer', async () => {
    render(<Overlays />)
    mount({ trupps: [confirmedElsewhere(20)] })
    fireEvent.click(screen.getByRole('button', { name: az.actContact }))
    const ask = await screen.findByRole('alertdialog')
    const ok = within(ask).getByRole('button', { name: az.contactEchoOk })
    await waitFor(() => expect(document.activeElement).toBe(ok))
    expect(ok.className).toContain('primary')
    expect(within(ask).getByRole('button', { name: az.contactEchoAgain }).className).not.toContain('primary')
    // answer it: the pending confirm is module state (lib/ui) and would open in the next test
    fireEvent.click(ok)
    await waitFor(() => expect(screen.queryByRole('alertdialog')).toBeNull())
  })
})

// D1 ⑦
describe('the Sicherungstrupp slot, complete', () => {
  afterEach(() => { vi.mocked(useIsPhone).mockReturnValue(false) })
  const ready = (id: string, name: string, over: Partial<Trupp> = {}): Trupp => ({
    ...aktivTrupp(), id, name, members: ['Beispiel Ina'], status: 'angemeldet', entryTime: '', lastContactTime: '', readings: [], ...over,
  })
  // the section head (slim-down 26.09.2026) — the dashed slot it replaced had the same two states
  const slot = () => screen.getByText(az.safetyTitle).closest(`.${s.sect}`)!

  it('stands quiet in its place while nobody is inside, and turns amber with the first crew in', () => {
    vi.mocked(useIsPhone).mockReturnValue(true)
    mount({ trupps: [ready('r', 'Ready Rita')] })
    expect(slot().classList.contains(s.sectDue)).toBe(false)
    expect(within(slot() as HTMLElement).getByRole('button', { name: az.safetyPick })).toBeTruthy()
    cleanup()
    mount({ trupps: [ready('r', 'Ready Rita'), { ...aktivTrupp(), id: 'i', name: 'In Ida' }] })
    expect(slot().classList.contains(s.sectDue)).toBe(true)
  })

  it('«Bestimmen» takes a Trupp standing ready — its Auftrag becomes «Sichern», nothing else', async () => {
    vi.mocked(useIsPhone).mockReturnValue(true)
    const editTrupp = vi.fn()
    mount({ editTrupp, trupps: [ready('r', 'Ready Rita', { auftrag: 'loeschen', funkkanal: 11 }), { ...aktivTrupp(), id: 'i', name: 'In Ida' }] })
    fireEvent.click(screen.getByRole('button', { name: az.safetyPick }))
    fireEvent.click(await screen.findByRole('menuitem', { name: 'Ready Rita / Beispiel Ina' }))
    expect(editTrupp).toHaveBeenCalledWith('r', expect.objectContaining({ name: 'Ready Rita', members: ['Beispiel Ina'], auftrag: 'sichern', funkkanal: 11, pressure: 300 }))
  })

  it('…or registers a new one on «Sichern»', async () => {
    vi.mocked(useIsPhone).mockReturnValue(true)
    mount({ trupps: [ready('r', 'Ready Rita'), { ...aktivTrupp(), id: 'i', name: 'In Ida' }] })
    fireEvent.click(screen.getByRole('button', { name: az.safetyPick }))
    fireEvent.click(await screen.findByRole('menuitem', { name: az.safetyPickNew }))
    const sichern = within(screen.getByRole('group', { name: az.auftragLabel })).getByRole('button', { name: 'Sichern' })
    expect(sichern.getAttribute('aria-pressed')).toBe('true')
  })
})

/* Owner, 30.10.2026 («Becomes Sicherung»): the Notfall banner's «Sicherungstrupp bestimmen» names
 * any other crew — bereit, then drin, then draussen — not only the ones standing ready. */
describe('the Notfall banner names a Sicherungstrupp from the whole board', () => {
  afterEach(() => { vi.mocked(useIsPhone).mockReturnValue(false) })
  const crew = (id: string, name: string, over: Partial<Trupp> = {}): Trupp => ({ ...aktivTrupp(), id, name, members: [], auftrag: 'loeschen', ...over })
  const board = () => [
    crew('nf', 'Fabich Mischa', { notfallAt: iso(30_000) }),
    crew('out', 'Out Olga', { status: 'raus', exitTime: iso(60_000) }),
    crew('in', 'In Ida'),
    crew('rdy', 'Ready Rita', { status: 'angemeldet', entryTime: '', lastContactTime: '', readings: [] }),
  ]
  const openDefine = async () => {
    fireEvent.click(screen.getByRole('button', { name: new RegExp(az.notfall.sitrDefine) }))
    return await screen.findByRole('menu')
  }

  it('groups the crews under Bereit, Drin and Draussen, the casualty left out', async () => {
    vi.mocked(useIsPhone).mockReturnValue(true)
    mount({ trupps: board() })
    const menu = await openDefine()
    const groups = within(menu).getAllByRole('group').map((g) => [g.getAttribute('aria-labelledby') && document.getElementById(g.getAttribute('aria-labelledby')!)?.textContent,
      within(g).queryAllByRole('menuitem').map((i) => i.textContent)])
    expect(groups.slice(0, 3)).toEqual([[az.phoneSectionReady, ['Ready Rita']], [az.phoneSectionIn, ['In Ida']], [az.phoneSectionOut, expect.arrayContaining(['Out Olga'])]])
    expect(within(menu).queryByRole('menuitem', { name: 'Fabich Mischa' })).toBeNull()
  })

  it('a crew inside becomes the Sicherungstrupp in one act, for this Notfall', async () => {
    vi.mocked(useIsPhone).mockReturnValue(true)
    const designateSafety = vi.fn(() => true)
    mount({ trupps: board(), designateSafety })
    fireEvent.click(within(await openDefine()).getByRole('menuitem', { name: 'In Ida' }))
    expect(designateSafety).toHaveBeenCalledWith('in', 'nf')
  })

  it('a crew that is out opens its re-entry form on «Sichern» — a fresh bottle first', async () => {
    vi.mocked(useIsPhone).mockReturnValue(true)
    const designateSafety = vi.fn(() => true)
    mount({ trupps: board(), designateSafety })
    fireEvent.click(within(await openDefine()).getByRole('menuitem', { name: 'Out Olga' }))
    expect(designateSafety).not.toHaveBeenCalled()
    const sichern = within(await screen.findByRole('group', { name: az.auftragLabel })).getByRole('button', { name: 'Sichern' })
    expect(sichern.getAttribute('aria-pressed')).toBe('true')
    expect(screen.getByText(az.formRedeployTitle)).toBeTruthy()
  })
})

// item 2
describe('the Eingangsdruck is guarded', () => {
  const outWithRest = (): Trupp => ({
    ...aktivTrupp(), status: 'raus', exitTime: iso(60_000),
    readings: [...aktivTrupp().readings!, { t: iso(60_000), bar: 60, kind: 'exit', measured: true }],
  })
  const openEdit = async () => {
    fireEvent.click(screen.getByRole('button', { name: az.cardMenu }))
    fireEvent.click(await screen.findByRole('menuitem', { name: az.edit }))
  }
  /** the form's Eingangsdruck row → the Druck sheet → one bar (30.09.2026) */
  const typePressure = (bar: number, label: string) => pickPressure(bar, label)

  it('locks it once the Trupp is out, points at the Restdruck, and saves the stored value', async () => {
    const editTrupp = vi.fn()
    mount({ trupps: [outWithRest()], editTrupp })
    await openEdit()
    // «300 bar 🔒» and ONE hint line (owner review 26.09.2026)
    expect(screen.getByText((_, el) => el?.tagName === 'B' && el.textContent === '300 bar')).toBeTruthy()
    expect(screen.getByText(fillTemplate(az.pressureLockedWhyExit, { bar: 60 }))).toBeTruthy()
    expect(screen.queryByRole('button', { name: new RegExp(`^${az.editPressureLabel}`) })).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: az.save }))
    expect(editTrupp).toHaveBeenCalledWith('tr1', expect.objectContaining({ pressure: 300 }))
  })

  it('stays open while the Trupp is inside', async () => {
    mount()
    await openEdit()
    expect(screen.queryByText(new RegExp(az.pressureLocked))).toBeNull()
    // the row, and behind it the grid with the stored 300 as the picked answer
    fireEvent.click(pressureRow(az.editPressureLabel))
    const grid = screen.getByRole('group', { name: az.editPressureLabel })
    expect(within(grid).getByRole('button', { name: '300' }).getAttribute('aria-pressed')).toBe('true')
  })

  it('asks ONCE below the station minimum, with the value on the button', async () => {
    render(<Overlays />)
    const createTrupp = vi.fn()
    mount({ trupps: [], createTrupp })
    fireEvent.click(firstBtn(az.newTrupp))
    typeGuest('Tief Theo')
    typePressure(180, az.pressureLabel)
    fireEvent.click(lastBtn(az.start))
    let ask = await screen.findByRole('alertdialog')
    // a title stating the fact, one line with the two numbers (owner review 26.09.2026)
    expect(within(ask).getByText(az.entryLowTitle)).toBeTruthy()
    expect(within(ask).getByText(fillTemplate(az.entryLowMsg, { bar: 180, min: dz.entryPressureMin }))).toBeTruthy()
    // «Ändern» goes back to the number — the Druck sheet, on 180 — and registers nothing
    fireEvent.click(within(ask).getByRole('button', { name: az.entryLowChange }))
    await waitFor(() => expect(screen.queryByRole('alertdialog')).toBeNull())
    expect(createTrupp).not.toHaveBeenCalled()
    const grid = await screen.findByRole('group', { name: az.pressureLabel })
    expect(within(grid).getByRole('button', { name: '180' }).getAttribute('aria-pressed')).toBe('true')
    fireEvent.click(within(grid).getByRole('button', { name: '180' }))
    fireEvent.click(lastBtn(az.start))
    ask = await screen.findByRole('alertdialog')
    fireEvent.click(within(ask).getByRole('button', { name: fillTemplate(az.entryLowConfirm, { bar: 180 }) }))
    await waitFor(() => expect(createTrupp).toHaveBeenCalledWith(expect.objectContaining({ entryPressureBar: 180 })))
  })

  it('asks a correction made while inside, and never an edit that leaves the number alone', async () => {
    render(<Overlays />)
    const editTrupp = vi.fn()
    mount({ editTrupp })
    await openEdit()
    fireEvent.click(screen.getByRole('button', { name: az.save }))
    expect(editTrupp).toHaveBeenCalledTimes(1)
    expect(screen.queryByRole('alertdialog')).toBeNull()
    await openEdit()
    typePressure(200, az.editPressureLabel)
    fireEvent.click(screen.getByRole('button', { name: az.save }))
    const ask = await screen.findByRole('alertdialog')
    fireEvent.click(within(ask).getByRole('button', { name: fillTemplate(az.entryLowConfirm, { bar: 200 }) }))
    await waitFor(() => expect(editTrupp).toHaveBeenLastCalledWith('tr1', expect.objectContaining({ pressure: 200 })))
  })
})

/* ── Review of PR #227 (25.09.2026) ───────────────────────────────────────────────────────────── */
describe('drafts belong to one state of the Trupp', () => {
  afterEach(() => { vi.mocked(useIsPhone).mockReturnValue(false) })
  const sortie = (exitMinAgo: number, bar: number, runs = 1): Trupp => {
    const readings: TruppReading[] = []
    for (let i = runs; i >= 1; i--) {
      readings.push({ t: iso((exitMinAgo + i * 20) * 60_000), bar: 300, kind: 'entry' })
      readings.push({ t: iso((exitMinAgo + (i - 1) * 20) * 60_000), bar: i === 1 ? bar : 150, kind: 'exit', measured: true })
    }
    return { ...aktivTrupp(), status: 'raus', exitTime: iso(exitMinAgo * 60_000), readings }
  }
  const closeForm = () => fireEvent.click(document.querySelector(`.${s.modalHead} .ip-x`)!)

  it('a «Gleiche Flasche» from an abandoned re-entry is not handed to the next sortie', () => {
    const reactivateTrupp = vi.fn()
    const props = propsFor({ trupps: [sortie(2, 180)], reactivateTrupp })
    const view = render(<AtemschutzView {...props} />)
    fireEvent.click(screen.getByRole('button', { name: az.actReenter }))
    fireEvent.click(screen.getByRole('button', { name: new RegExp(az.bottleSame) }))
    closeForm()
    // …the Trupp goes in again on another device and comes out a second time, with 90 bar
    view.rerender(<AtemschutzView {...props} trupps={[sortie(1, 90, 2)]} />)
    fireEvent.click(screen.getByRole('button', { name: az.actReenter }))
    // nothing chosen: the question stands, and «Im Einsatz» waits for it
    fireEvent.click(screen.getByRole('button', { name: az.reenterSubmit }))
    expect(reactivateTrupp).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: new RegExp(az.bottleSame) }))
    fireEvent.click(screen.getByRole('button', { name: az.reenterSubmit }))
    expect(reactivateTrupp).toHaveBeenCalledWith('tr1', expect.objectContaining({ pressure: 90 }), false)
  })

  it('an edit draft does not write back a Leitung that was changed elsewhere meanwhile', async () => {
    const editTrupp = vi.fn()
    const props = propsFor({ trupps: [{ ...aktivTrupp(), lineNo: 1 }], editTrupp })
    const view = render(<AtemschutzView {...props} />)
    const openEdit = async () => {
      fireEvent.click(screen.getByRole('button', { name: az.cardMenu }))
      fireEvent.click(await screen.findByRole('menuitem', { name: az.edit }))
    }
    await openEdit()
    fireEvent.change(screen.getByLabelText(az.zielLabel), { target: { value: 'Keller' } })
    closeForm()
    // the Leitung is linked to hose 4 on the Karte while the draft sits there
    view.rerender(<AtemschutzView {...props} trupps={[{ ...aktivTrupp(), lineNo: 4 }]} />)
    await openEdit()
    expect((screen.getByLabelText(az.zielLabel) as HTMLInputElement).value).toBe('')
    fireEvent.click(screen.getByRole('button', { name: az.save }))
    expect(editTrupp).toHaveBeenCalledWith('tr1', expect.objectContaining({ lineNo: 4 }))
  })

  it('«Bestimmen» opens on «Sichern» even over a kept create draft with another Auftrag', () => {
    vi.mocked(useIsPhone).mockReturnValue(true)
    mount({ trupps: [{ ...aktivTrupp(), id: 'i', name: 'In Ida' }] })
    fireEvent.click(firstBtn(az.newTrupp))
    pickAuftrag('Retten')
    closeForm()
    fireEvent.click(screen.getByRole('button', { name: az.safetyPick }))
    const sichern = within(screen.getByRole('group', { name: az.auftragLabel })).getByRole('button', { name: 'Sichern' })
    expect(sichern.getAttribute('aria-pressed')).toBe('true')
  })
})

// review of PR #227
describe('the phone board\'s pinned row and Sicherungstrupp slot', () => {
  afterEach(() => { vi.mocked(useIsPhone).mockReturnValue(false) })

  it('a pinned row just confirmed says «Bestätigt» and takes no second tap', () => {
    vi.mocked(useIsPhone).mockReturnValue(true)
    const props = mount({ trupps: [{ ...aktivTrupp(), id: 'o', name: 'Over Otto', lastContactTime: iso(7 * 60_000) }] })
    fireEvent.click(firstBtn(az.newTrupp))
    const pinned = screen.getByRole('region', { name: az.pinnedLabel })
    fireEvent.click(within(pinned).getByRole('button', { name: `${az.actContact}: Over Otto` }))
    const done = within(pinned).getByRole('button', { name: `${az.contactDone}: Over Otto` }) as HTMLButtonElement
    expect(done.disabled).toBe(true)
    fireEvent.click(done)
    expect(props.recordContact).toHaveBeenCalledTimes(1)
  })

  it('offers no Sicherungstrupp slot once every Trupp is out', () => {
    vi.mocked(useIsPhone).mockReturnValue(true)
    mount({ trupps: [{ ...aktivTrupp(), status: 'raus', exitTime: iso(60_000) }] })
    expect(screen.queryByText(az.safetyTitle)).toBeNull()
    expect(screen.queryByRole('button', { name: az.safetyPick })).toBeNull()
  })
})

// review of PR #227
describe('the low Eingangsdruck on a re-entry', () => {
  const justOut = (): Trupp => ({
    ...aktivTrupp(), status: 'raus', exitTime: iso(2 * 60_000),
    readings: [...aktivTrupp().readings!, { t: iso(2 * 60_000), bar: 120, kind: 'exit', measured: true }],
  })
  const typePressure = (bar: number) => pickPressure(bar, az.newPressureLabel)

  it('«Neue Flasche» with a low value asks once, with «Ändern» focused', async () => {
    render(<Overlays />)
    const reactivateTrupp = vi.fn()
    mount({ trupps: [justOut()], reactivateTrupp })
    fireEvent.click(screen.getByRole('button', { name: az.actReenter }))
    fireEvent.click(screen.getByRole('button', { name: new RegExp(az.bottleNew) }))
    typePressure(200)
    fireEvent.click(screen.getByRole('button', { name: az.reenterSubmit }))
    const ask = await screen.findByRole('alertdialog')
    const change = within(ask).getByRole('button', { name: az.entryLowChange })
    await waitFor(() => expect(document.activeElement).toBe(change))
    expect(change.className).toContain('primary')
    fireEvent.click(within(ask).getByRole('button', { name: fillTemplate(az.entryLowConfirm, { bar: 200 }) }))
    await waitFor(() => expect(reactivateTrupp).toHaveBeenCalledWith('tr1', expect.objectContaining({ pressure: 200 }), false))
  })

  it('«Gleiche Flasche» is never asked about — its bar is the Restdruck', () => {
    render(<Overlays />)
    const reactivateTrupp = vi.fn()
    mount({ trupps: [justOut()], reactivateTrupp })
    fireEvent.click(screen.getByRole('button', { name: az.actReenter }))
    fireEvent.click(screen.getByRole('button', { name: new RegExp(az.bottleSame) }))
    fireEvent.click(screen.getByRole('button', { name: az.reenterSubmit }))
    expect(screen.queryByRole('alertdialog')).toBeNull()
    expect(reactivateTrupp).toHaveBeenCalledWith('tr1', expect.objectContaining({ pressure: 120 }), false)
  })
})

/* ── Staging walk-through, 25.09.2026 ─────────────────────────────────────────────────────────── */
describe('an edit writes only what it touched (two devices, one Trupp)', () => {
  const openEdit = async () => {
    fireEvent.click(screen.getByRole('button', { name: az.cardMenu }))
    fireEvent.click(await screen.findByRole('menuitem', { name: az.edit }))
  }

  it('keeps a change another device saved to a field this form did not touch', async () => {
    const editTrupp = vi.fn()
    const props = propsFor({ trupps: [{ ...aktivTrupp(), auftrag: 'loeschen', ziel: 'UG Nord' }], editTrupp })
    const view = render(<AtemschutzView {...props} />)
    await openEdit()
    fireEvent.click(screen.getByRole('checkbox', { name: new RegExp(az.equipmentLabels.wbk) }))
    // phone A saves a new Ziel meanwhile
    view.rerender(<AtemschutzView {...props} trupps={[{ ...aktivTrupp(), auftrag: 'loeschen', ziel: 'UG West' }]} />)
    fireEvent.click(screen.getByRole('button', { name: az.save }))
    expect(editTrupp).toHaveBeenCalledTimes(1)
    expect(editTrupp.mock.calls[0][1]).toMatchObject({ ziel: 'UG West', equipment: ['wbk'] })
  })

  it('says it in one line when a touched field changed elsewhere — «Zurück» is the safe answer', async () => {
    render(<Overlays />)
    const editTrupp = vi.fn()
    const props = propsFor({ trupps: [{ ...aktivTrupp(), ziel: 'UG Nord' }], editTrupp })
    const view = render(<AtemschutzView {...props} />)
    await openEdit()
    fireEvent.change(screen.getByLabelText(az.zielLabel), { target: { value: 'UG Süd' } })
    view.rerender(<AtemschutzView {...props} trupps={[{ ...aktivTrupp(), ziel: 'UG West' }]} />)
    fireEvent.click(screen.getByRole('button', { name: az.save }))
    let ask = await screen.findByRole('alertdialog')
    expect(within(ask).getByText(fillTemplate(az.editConflictOne, { field: az.editFieldLabels.ziel, now: 'UG West' }))).toBeTruthy()
    const back = within(ask).getByRole('button', { name: az.editConflictBack })
    await waitFor(() => expect(document.activeElement).toBe(back))
    fireEvent.click(back)
    await waitFor(() => expect(screen.queryByRole('alertdialog')).toBeNull())
    expect(editTrupp).not.toHaveBeenCalled()
    // «Zurück» returns to the form as it was — the typed Ziel is still there
    expect((screen.getByLabelText(az.zielLabel) as HTMLInputElement).value).toBe('UG Süd')
    fireEvent.click(screen.getByRole('button', { name: az.save }))
    ask = await screen.findByRole('alertdialog')
    fireEvent.click(within(ask).getByRole('button', { name: az.editConflictOverwrite }))
    await waitFor(() => expect(editTrupp).toHaveBeenCalledWith('tr1', expect.objectContaining({ ziel: 'UG Süd' })))
  })
})

// staging walk-through, 25.09.2026
describe('a Gast typed into the form belongs to the form', () => {
  it('«Abbrechen» files nobody on the Anwesenheit', () => {
    const onAddGuest = vi.fn(() => 'g1')
    mount({ trupps: [], onAddGuest })
    fireEvent.click(firstBtn(az.newTrupp))
    typeGuest('Neu Nina')
    fireEvent.click(screen.getByText(az.cancel, { selector: 'button.ip-btn' }))
    expect(onAddGuest).not.toHaveBeenCalled()
  })

  it('«Trupp anmelden» files the Gast and writes the id into the Trupp', () => {
    const onAddGuest = vi.fn(() => 'g1')
    const createTrupp = vi.fn()
    mount({ trupps: [], onAddGuest, createTrupp })
    fireEvent.click(firstBtn(az.newTrupp))
    typeGuest('Neu Nina')
    fireEvent.click(lastBtn(az.start))
    expect(onAddGuest).toHaveBeenCalledWith('Neu Nina')
    expect(createTrupp).toHaveBeenCalledWith(expect.objectContaining({ name: 'Neu Nina', leaderPersonId: 'g1' }))
  })
})

// staging walk-through, 25.09.2026
describe('the first Druckmeldung says what it does', () => {
  afterEach(() => { vi.mocked(useIsPhone).mockReturnValue(false) })
  const justIn = (over: Partial<Trupp> = {}): Trupp => ({
    ...aktivTrupp(), entryTime: iso(60_000), lastContactTime: iso(60_000), lastPressureBar: undefined, lastPressureTime: undefined,
    lowestBar: 300, readings: [{ t: iso(60_000), bar: 300, kind: 'entry' }], ...over,
  })

  it('names the replaced Eingangsdruck on the sheet within the first minutes', () => {
    vi.mocked(useIsPhone).mockReturnValue(true)
    mount({ trupps: [justIn()] })
    fireEvent.click(screen.getByRole('button', { name: druckName }))
    expect(screen.getByText(new RegExp(fillTemplate(az.pressureSheetFirst, { bar: 300 })))).toBeTruthy()
  })

  it('keeps the ordinary line for an Eingangsdruck set on purpose', () => {
    vi.mocked(useIsPhone).mockReturnValue(true)
    mount({ trupps: [justIn({ readings: [{ t: iso(60_000), bar: 300, kind: 'entry', measured: true }] })] })
    fireEvent.click(screen.getByRole('button', { name: druckName }))
    expect(screen.queryByText(new RegExp(fillTemplate(az.pressureSheetFirst, { bar: 300 })))).toBeNull()
    expect(screen.getByText(new RegExp(az.pressureSheetHint))).toBeTruthy()
  })

  it('a dialled Eingangsdruck is registered as measured', () => {
    const createTrupp = vi.fn()
    mount({ trupps: [], createTrupp })
    fireEvent.click(firstBtn(az.newTrupp))
    typeGuest('Neu Nina')
    pickPressure(280)
    fireEvent.click(lastBtn(az.start))
    expect(createTrupp.mock.calls[0][0].readings).toEqual([expect.objectContaining({ kind: 'registered', measured: true })])
  })
})

// staging walk-through, 25.09.2026
describe('the empty board, the SiTr chip, the held pinned row', () => {
  afterEach(() => { vi.mocked(useIsPhone).mockReturnValue(false) })

  it('an empty board offers «Trupp anmelden» itself', () => {
    mount({ trupps: [] })
    // the whole «Trupp anmelden» (newTrupp) — `start` is the form's one-verb footer since 27.09.2026
    const door = screen.getAllByRole('button', { name: new RegExp(az.newTrupp) }).find((b) => b.className.includes(s.emptyAct))!
    fireEvent.click(door)
    expect(screen.getByRole('dialog', { name: az.formCreateTitle })).toBeTruthy()
  })

  it('the phone head button carries a word, not a bare «+»', () => {
    vi.mocked(useIsPhone).mockReturnValue(true)
    mount({ trupps: [] })
    expect(firstBtn(az.newTrupp).textContent).toContain(az.newTruppShort)
  })

  // owner, 26.09.2026
  it('the collapsed phone row is the name alone — no «#N», no «SiTr»', () => {
    vi.mocked(useIsPhone).mockReturnValue(true)
    mount({ trupps: [{ ...aktivTrupp(), no: 4, auftrag: 'sichern' }] })
    const row = screen.getByText('Steiner').closest(`.${s.trow}`) as HTMLElement
    expect(within(row).queryByText('#4')).toBeNull()
    expect(within(row).queryByText('SiTr')).toBeNull()
  })

  it('while held, a confirmed pinned row says «Kontakt ok» — no due wording left beside it', () => {
    vi.mocked(useIsPhone).mockReturnValue(true)
    mount({ trupps: [{ ...aktivTrupp(), id: 'w', name: 'Warn Wanda', lastContactTime: iso(5.5 * 60_000) }] })
    fireEvent.click(firstBtn(az.newTrupp))
    const pinned = screen.getByRole('region', { name: az.pinnedLabel })
    fireEvent.click(within(pinned).getByRole('button', { name: `${az.actContact}: Warn Wanda` }))
    expect(within(pinned).getByText(az.clockOk)).toBeTruthy()
    expect(within(pinned).queryByText(az.clockWarn)).toBeNull()
  })
})

/* ── Staging walk-through r2, 25.09.2026 ──────────────────────────────────────────────────────── */
describe('numbers, the Link\'s first Trupp, and «nicht eingesetzt»', () => {
  afterEach(() => { vi.mocked(useIsPhone).mockReturnValue(false) })

  // N18
  it('the handed-over phone board opens on the most urgent crew inside, not on a Trupp that is out', () => {
    vi.mocked(useIsPhone).mockReturnValue(true)
    mount({ lite: { subtitle: 'Brand' }, trupps: [
      { ...aktivTrupp(), id: 'o', name: 'Out Otto', status: 'raus', exitTime: iso(60_000), order: 0 },
      { ...aktivTrupp(), id: 'i', name: 'In Ida', lastContactTime: iso(4.5 * 60_000), order: 1 },
    ] })
    const card = document.querySelector(`.${s.focusCard}`) as HTMLElement
    expect(within(card).getByText('In Ida')).toBeTruthy()
    expect(within(card).queryByRole('button', { name: az.actReenter })).toBeNull()
  })

  // N8
  it('a stood-down Trupp reads «Nicht eingesetzt», never «Austritt», and goes «In den Einsatz»', () => {
    const stoodDown: Trupp = {
      ...aktivTrupp(), status: 'raus', entryTime: '', exitTime: iso(60_000),
      readings: [{ t: iso(5 * 60_000), bar: 300, kind: 'registered' }, { t: iso(60_000), bar: 300, kind: 'exit' }],
    }
    mount({ trupps: [stoodDown] })
    // the card's state line says it (the «zuletzt: …» preview that used to is gone, 29.09.2026)…
    expect(document.querySelector(`.${s.stateLine}`)?.textContent).toBe(az.statusNotDeployed)
    // …and the Verlauf's last row, opened, reads the same — never «Austritt»
    fireEvent.click(screen.getByRole('button', { name: new RegExp(az.verlauf) }))
    const rows = [...document.querySelectorAll(`.${s.logKind}`)].map((e) => e.textContent)
    expect(rows[0]).toBe(az.statusNotDeployed)
    expect(rows).not.toContain(az.readingKind.exit)
    expect(screen.getByRole('button', { name: az.actEnterFirst })).toBeTruthy()
  })
})

/* ── The opened phone card outside the field (27.09.2026, owner screenshot r2-1) ───────────────
 * A Trupp that was «raus» opened to an EMPTY framed box above its chips: the tile rule painted
 * every action tile `--surface`, and «Wieder in den Einsatz» kept the tablet's white word for a
 * green fill it no longer had. The DOM cannot see a colour, but it can see the shape the fix
 * pins: the action row of a card outside the field is the one re-enter tile (or «Im Einsatz» /
 * «Raus melden»), and NO state leaves a tile container with nothing in it. */
describe('the opened phone card of a Trupp outside the field', () => {
  afterEach(() => { vi.mocked(useIsPhone).mockReturnValue(false) })
  const out = (over: Partial<Trupp> = {}): Trupp => ({ ...aktivTrupp(), status: 'raus', exitTime: iso(5 * 60_000), ...over })
  const openFirstRow = (over: Partial<Parameters<typeof AtemschutzView>[0]>) => {
    vi.mocked(useIsPhone).mockReturnValue(true)
    mount(over)
    fireEvent.click(document.querySelector(`.${s.trow}`)!)
    return document.querySelector('[data-az-open]') as HTMLElement
  }
  /** every tile container on the card — the pair's grid and each lifecycle row — with what it holds */
  const tileBoxes = (card: HTMLElement) =>
    [...card.querySelectorAll(`.${s.trowActs}, .${s.actions}`)].map((box) => ({
      tiles: [...box.children].map((b) => (b.textContent ?? '').trim()).filter(Boolean),
    }))
  const actionWords = (card: HTMLElement) =>
    [...card.querySelectorAll(`.${s.actZone} button`)].map((b) => (b.textContent ?? '').trim())

  it('a Trupp that came out: the one re-enter tile, no pair, no empty container', () => {
    const card = openFirstRow({ trupps: [out()] })
    expect(card.querySelector(`.${s.trowActs}`)).toBeNull()
    expect(actionWords(card)).toEqual([az.actReenter])
    const btn = within(card).getByRole('button', { name: az.actReenter })
    expect(btn.classList.contains(s.actReenter)).toBe(true)
    expect(tileBoxes(card)).toEqual([{ tiles: [az.actReenter] }])
  })

  // (a Trupp still waiting also shows the quiet «Nicht eingesetzt» on its OWN row under it — #227
  // owner review 26.09.2026: visible, but never beside «Im Einsatz»)
  it.each<[string, Partial<Trupp>, string[]]>([
    ['never deployed', { entryTime: '', lastContactTime: '', readings: [{ t: iso(5 * 60_000), bar: 300, kind: 'registered' }] }, [az.actEnterFirst]],
    ['still waiting', { status: 'angemeldet', entryTime: '', lastContactTime: '', exitTime: undefined, readings: [] }, [az.actEnter, az.actNotDeployed]],
    ['without Atemschutz, in the field', { status: 'aktiv', kind: 'einfach', exitTime: undefined }, [az.actExitPlain]],
    ['without Atemschutz, out', { kind: 'einfach' }, [az.actReenter]],
  ])('%s: one worded action row and nothing empty', (_label, over, words) => {
    const card = openFirstRow({ trupps: [out(over)] })
    expect(actionWords(card)).toEqual(words)
    for (const box of tileBoxes(card)) expect(box.tiles.length).toBeGreaterThan(0)
  })

  it('a viewer sees no action row at all — the zone is empty, so it takes no room', () => {
    const card = openFirstRow({ trupps: [out()], canEdit: false })
    expect(card.querySelector(`.${s.trowActs}`)).toBeNull()
    expect(card.querySelector(`.${s.actions}`)).toBeNull()
    // `:empty` is the CSS that drops the zone's padding — it needs NO child nodes, whitespace included
    expect(card.querySelector(`.${s.actZone}`)?.childNodes.length ?? 0).toBe(0)
  })
})
