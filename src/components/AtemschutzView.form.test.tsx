// @vitest-environment jsdom
// The Trupp form's details (Gruppenführer by rank, Druck and Kanal sheets, the Gast door), the
// überfällig badge, «Entfernen», the Ausrüstung, the full-app phone board and a re-entry's
// cylinder question. Shared setup: AtemschutzView.setup.tsx.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { AtemschutzView } from './AtemschutzView'
import { useIsPhone } from '../lib/useIsPhone'
import s from './Atemschutz.module.css'
import { Overlays } from '../lib/ui'
import { atemschutzDoctrine } from '../lib/deploymentConfig'
import * as deploymentConfig from '../lib/deploymentConfig'
import { fillTemplate } from '../lib/format'
import type { Trupp, TruppFields } from '../types'
import { resetPopoverGuard } from '../lib/overlays/popoverGuard'
import { registerAtemschutzViewHooks, az, firstBtn, druckName, lastBtn, dz, iso, aktivTrupp, propsFor, mount, typeGuest, pressureRow, kanalRow } from './AtemschutzView.setup'

vi.mock('../lib/useIsPhone', async (original) => ({ ...await original<typeof import('../lib/useIsPhone')>(), useIsPhone: vi.fn(() => false) }))
registerAtemschutzViewHooks()

/* ⚠️ Field report, 04.09.: on a 66-person Mannschaft the Gast door — «Name eingeben (Gast /
 * Nachbarwehr)», the second field — sat BELOW the whole roster list, so the one case the list
 * cannot answer was the case whose answer sat furthest away. There is no second field any more:
 * the SEARCH is the name entry, and the door is the last row of the list, present only while
 * something is typed. The full behaviour is pinned in TruppTeam.test.tsx; this one checks that
 * the form the operator actually opens still gets a Gast into the Trupp. */
/* The crown follows the Dienstgrad while a NEW Trupp is formed (30.09.2026, lib/truppLeader) —
 * until somebody is crowned by hand, and never on a Trupp that already exists. */
describe('the Gruppenführer by rank', () => {
  const upd = '2026-09-30T06:00:00.000Z'
  const roster = [
    { id: 'pf', displayName: 'Fuchs Fritz', rank: 'fwm', active: true, updatedAt: upd },
    { id: 'pl', displayName: 'Lang Lea', rank: 'lt', active: true, updatedAt: upd },
    { id: 'pk', displayName: 'Kurz Kai', rank: 'kpl', active: true, updatedAt: upd },
  ]
  const pick = (name: string) => fireEvent.click(screen.getByRole('option', { name: new RegExp(name) }))

  it('a new Trupp is led by its most senior member, whatever order they were picked in', () => {
    const createTrupp = vi.fn()
    mount({ trupps: [], personnel: roster, createTrupp })
    fireEvent.click(firstBtn(az.newTrupp))
    pick('Fuchs Fritz'); pick('Lang Lea'); pick('Kurz Kai')
    fireEvent.click(lastBtn(az.start))
    expect(createTrupp).toHaveBeenCalledWith(expect.objectContaining({ name: 'Lang Lea', members: ['Fuchs Fritz', 'Kurz Kai'] }))
  })

  it('stops following the rank once a name is crowned by hand', () => {
    const createTrupp = vi.fn()
    mount({ trupps: [], personnel: roster, createTrupp })
    fireEvent.click(firstBtn(az.newTrupp))
    pick('Fuchs Fritz'); pick('Kurz Kai')
    fireEvent.click(screen.getByRole('button', { name: /Fuchs Fritz als Gruppenführer/ }))
    pick('Lang Lea')
    fireEvent.click(lastBtn(az.start))
    expect(createTrupp).toHaveBeenCalledWith(expect.objectContaining({ name: 'Fuchs Fritz', members: ['Kurz Kai', 'Lang Lea'] }))
  })

  it('never moves the leader of a Trupp that already exists', async () => {
    const editTrupp = vi.fn()
    mount({ trupps: [aktivTrupp()], personnel: roster, editTrupp })
    fireEvent.click(screen.getByRole('button', { name: az.cardMenu }))
    fireEvent.click(await screen.findByRole('menuitem', { name: az.edit }))
    pick('Lang Lea')
    fireEvent.click(screen.getByRole('button', { name: az.save }))
    expect(editTrupp).toHaveBeenCalledWith('tr1', expect.objectContaining({ name: 'Steiner', members: ['Huber', 'Lang Lea'] }))
  })
})

/* The form asks Druck and Kanal in the sheets that ask them on the card (30.09.2026): a row each,
 * opening the Druck grid / the Kanal pad — a tap is the answer, nothing is saved until the save. */
describe('the form\'s Druck and Kanal are the sheets\' tap controls', () => {
  const real = atemschutzDoctrine()
  beforeEach(() => { vi.spyOn(deploymentConfig, 'atemschutzDoctrine').mockImplementation(() => ({ ...real, funkkanalMin: 1, funkkanalMax: 16 })) })
  afterEach(() => { vi.restoreAllMocks() })

  it('opens the Druck grid and the Kanal pad from the rows; a tap fills the draft and closes', async () => {
    const createTrupp = vi.fn()
    mount({ trupps: [], createTrupp })
    fireEvent.click(firstBtn(az.newTrupp))
    typeGuest('Pad Paula')
    fireEvent.click(pressureRow())
    const grid = screen.getByRole('group', { name: az.pressureLabel })
    // the station default is the picked answer, filled
    expect(within(grid).getByRole('button', { name: String(dz.defaultPressureBar) }).getAttribute('aria-pressed')).toBe('true')
    // one tap fills the draft and closes the sheet; the row reads it
    fireEvent.click(within(grid).getByRole('button', { name: '280' }))
    expect(screen.queryByRole('group', { name: az.pressureLabel })).toBeNull()
    expect(pressureRow().getAttribute('aria-label')).toBe(`${az.pressureLabel} 280 bar`)
    fireEvent.click(kanalRow())
    const pad = screen.getByRole('group', { name: az.funkkanalUnit })
    expect(within(pad).getByRole('button', { name: String(dz.defaultFunkkanal) }).getAttribute('aria-pressed')).toBe('true')
    fireEvent.click(within(pad).getByRole('button', { name: '7' }))
    await waitFor(() => expect(screen.queryByRole('group', { name: az.funkkanalUnit })).toBeNull())
    expect(kanalRow().getAttribute('aria-label')).toBe(`${az.funkkanalSection} 7`)
    // nothing is written until the form's own save
    expect(createTrupp).not.toHaveBeenCalled()
    fireEvent.click(lastBtn(az.start))
    expect(createTrupp).toHaveBeenCalledWith(expect.objectContaining({ entryPressureBar: 280, funkkanal: 7 }))
  })

  it('Escape in a number sheet closes the sheet, never the form under it', async () => {
    // the popover register's 350 ms tail is module state: a menu the test before closed a moment
    // ago would veto this Escape (as it should, one gesture later) and the sheet stays — flaky by speed
    resetPopoverGuard()
    mount({ trupps: [] })
    fireEvent.click(firstBtn(az.newTrupp))
    fireEvent.click(kanalRow())
    const pad = screen.getByRole('group', { name: az.funkkanalUnit })
    fireEvent.keyDown(pad, { key: 'Escape' })
    await waitFor(() => expect(screen.queryByRole('group', { name: az.funkkanalUnit })).toBeNull())
    expect(screen.getByRole('dialog', { name: az.formCreateTitle })).toBeTruthy()
  })
})

describe('the Gast door in the person picker', () => {
  const roster = Array.from({ length: 40 }, (_, i) => ({
    id: `p${i}`, displayName: `Muster ${String(i).padStart(2, '0')}`, active: true,
    updatedAt: '2026-09-04T06:00:00.000Z',
  }))

  it('takes a Gast straight out of the search, with no second field to find', () => {
    mount({ trupps: [aktivTrupp()], personnel: roster })
    fireEvent.click(firstBtn(az.newTrupp))
    const list = screen.getByRole('listbox', { name: az.sectionTeam })

    // at rest the list is the Mannschaft and nothing else — no permanent Gast row
    expect(within(list).getAllByRole('option').length).toBe(roster.length)
    typeGuest('Frei Nadja')
    expect(screen.getByText('Frei Nadja')).toBeTruthy()
    // …and the query is cleared, so the list is the whole Mannschaft again for the next member
    expect((screen.getByLabelText(az.teamSearchPlaceholder) as HTMLInputElement).value).toBe('')
  })
})

/* ⚠️ «2 Alarme» rings TWO cards (05.09., field feedback). The badge counts every Trupp past its
 * line — pointing at exactly one of them answered a different question than the one printed on
 * it, and «welche denn?» was still a scroll. The SCROLL stays on the one the badge ranks first
 * (the TopBar chip's pick): two smooth scrolls fired at once land wherever the last one
 * happened to render. */
describe('the überfällig badge in the header', () => {
  const overdue = (id: string, name: string): Trupp => ({
    ...aktivTrupp(), id, name, lastContactTime: iso(60 * 60_000),
  })
  const flashedNames = () =>
    [...document.querySelectorAll(`.${s.cardFlash}`)].map((el) => el.querySelector(`.${s.trowNameTxt}`)?.textContent)

  it('rings every alarmed Trupp, not only the one it jumps to', () => {
    mount({ trupps: [
      overdue('tr1', 'Steiner'), overdue('tr2', 'Meier'),
      { ...aktivTrupp(), id: 'tr3', name: 'Gerber' },
    ] })
    const badge = document.querySelector<HTMLButtonElement>(`.${s.overdueBadge}`)!
    expect(badge.textContent).toContain(az.overdueBadge(2))
    // arriving during an alarm already points at ONE card (the ranked one) — that is unchanged
    expect(flashedNames()).toEqual(['Steiner'])
    fireEvent.click(badge)
    expect(flashedNames()).toEqual(['Steiner', 'Meier'])
  })
})

/* Field wish, 11.09.: the bin on a Trupp that never went in is usually the wrong door — the
 * Sicherungstrupp that stood ready should close as «nicht eingesetzt» (the record the Rapport
 * keeps), not as «gelöscht». «Entfernen» in the ⋯ menu therefore ASKS on exactly the cards the
 * stand-down button is offered on (angemeldet + Atemschutz); everything else removes as before. */
describe('«Entfernen» on a never-deployed Trupp offers «nicht eingesetzt» first', () => {
  const angemeldet = (): Trupp => ({ ...aktivTrupp(), status: 'angemeldet', entryTime: '' })
  const openRemove = () => {
    fireEvent.click(screen.getByRole('button', { name: az.cardMenu }))
    fireEvent.click(screen.getByRole('menuitem', { name: az.remove }))
  }

  it('stands the Trupp down instead when «Nicht eingesetzt» is chosen', async () => {
    render(<Overlays />)
    const setTruppStatus = vi.fn()
    const deleteTrupp = vi.fn()
    mount({ trupps: [angemeldet()], setTruppStatus, deleteTrupp })
    openRemove()
    const dialog = await screen.findByRole('alertdialog')
    fireEvent.click(within(dialog).getByRole('button', { name: az.actNotDeployed }))
    await waitFor(() => expect(setTruppStatus).toHaveBeenCalledWith('tr1', 'raus', undefined, { undoToast: true }))
    expect(deleteTrupp).not.toHaveBeenCalled()
  })

  it('still removes when «Entfernen» is chosen in the ask', async () => {
    render(<Overlays />)
    const setTruppStatus = vi.fn()
    const deleteTrupp = vi.fn()
    mount({ trupps: [angemeldet()], setTruppStatus, deleteTrupp })
    openRemove()
    const dialog = await screen.findByRole('alertdialog')
    fireEvent.click(within(dialog).getByRole('button', { name: az.remove }))
    await waitFor(() => expect(deleteTrupp).toHaveBeenCalledWith('tr1'))
    expect(setTruppStatus).not.toHaveBeenCalled()
  })

  /* A crew INSIDE is asked about first (staging walk-through r2, N4): one tap on «Entfernen»
     took a crew under PA off the board and out of every alarm. «Raus melden» is the focused,
     filled answer; removing anyway is the quiet one. */
  it('asks before removing a crew that is inside — «Raus melden» is the safe, focused answer', async () => {
    render(<Overlays />)
    const deleteTrupp = vi.fn()
    mount({ trupps: [aktivTrupp()], deleteTrupp })
    openRemove()
    const ask = await screen.findByRole('alertdialog')
    const out = within(ask).getByRole('button', { name: az.actExit })
    await waitFor(() => expect(document.activeElement).toBe(out))
    expect(out.className).toContain('primary')
    fireEvent.click(out)
    // «Raus melden» asks the Restdruck, exactly as the card's own button does
    await waitFor(() => expect(screen.getByRole('button', { name: az.exitNoBar })).toBeTruthy())
    expect(deleteTrupp).not.toHaveBeenCalled()
  })

  it('removes a crew that is inside only when «Entfernen» is chosen in that question', async () => {
    render(<Overlays />)
    const deleteTrupp = vi.fn()
    mount({ trupps: [aktivTrupp()], deleteTrupp })
    openRemove()
    fireEvent.click(within(await screen.findByRole('alertdialog')).getByRole('button', { name: az.remove }))
    await waitFor(() => expect(deleteTrupp).toHaveBeenCalledWith('tr1'))
  })
})

/* ── Ausrüstung (14.09., mock «chips + Kennzeile») ───────────────────────────────────────────
 * Multi-select chips under the Auftrag for a Trupp under Atemschutz; the ticked ids travel with
 * the other fields (create: on the Trupp; edit: in `TruppFields.equipment`, ONE Verlauf row per
 * save), and the card prints them as Kürzel at the end of its Kennzeile. */
describe('the Ausrüstung of an Atemschutz-Trupp', () => {
  const chip = (label: string) => screen.getByRole('checkbox', { name: label })

  it('registers a new Trupp with the two ticked items, in the station’s list order', () => {
    const createTrupp = vi.fn()
    mount({ createTrupp })
    fireEvent.click(firstBtn(az.newTrupp))
    typeGuest('Meier Anna')
    fireEvent.click(chip(az.equipmentLabels.wbk))
    fireEvent.click(chip(az.equipmentLabels.retthaube))
    expect(chip(az.equipmentLabels.wbk).getAttribute('aria-checked')).toBe('true')
    fireEvent.click(lastBtn(az.start))
    expect(createTrupp).toHaveBeenCalledTimes(1)
    expect((createTrupp.mock.calls[0][0] as Trupp).equipment).toEqual(['retthaube', 'wbk'])
  })

  it('saves the remaining ids when one chip is ticked off in Bearbeiten', async () => {
    const editTrupp = vi.fn()
    mount({ editTrupp, trupps: [{ ...aktivTrupp(), equipment: ['retthaube', 'wbk'] }] })
    fireEvent.click(screen.getByRole('button', { name: az.cardMenu }))
    fireEvent.click(await screen.findByRole('menuitem', { name: az.edit }))
    expect(chip(az.equipmentLabels.retthaube).getAttribute('aria-checked')).toBe('true')
    fireEvent.click(chip(az.equipmentLabels.wbk))
    fireEvent.click(screen.getByRole('button', { name: az.save }))
    expect(editTrupp).toHaveBeenCalledTimes(1)
    expect((editTrupp.mock.calls[0][1] as TruppFields).equipment).toEqual(['retthaube'])
  })

  // the facts' last chips before the ⋯ (the Kennzeile's tags until 29.09.2026 — TruppCard · facts)
  it('prints the Kürzel as the last fact chips — and nothing when nothing was ticked', () => {
    const tagsOf = () => [...document.querySelectorAll(`.${s.facts} .${s.fact}`)].map((el) => el.textContent)
      .filter((t) => (Object.values(az.equipmentShort) as string[]).includes(t ?? ''))
    mount({ trupps: [{ ...aktivTrupp(), equipment: ['retthaube', 'wbk'] }] })
    expect(tagsOf()).toEqual([az.equipmentShort.retthaube, az.equipmentShort.wbk])
    cleanup()
    mount()
    expect(tagsOf()).toEqual([])
  })

  it('asks a work squad nothing — the field only exists under Atemschutz', async () => {
    mount({
      trupps: [{ id: 'tr9', kind: 'einfach', name: 'Gerber', entryPressureBar: 0, entryTime: iso(20 * 60_000), lastContactTime: '', status: 'aktiv' }],
      truppColors: { tr9: '#e2920a' },
    })
    fireEvent.click(screen.getByRole('button', { name: az.cardMenu }))
    fireEvent.click(await screen.findByRole('menuitem', { name: az.edit }))
    expect(screen.queryByRole('group', { name: az.equipmentLabel })).toBeNull()
    // …and appears the moment the Art is turned to Atemschutz
    fireEvent.click(screen.getByRole('radio', { name: az.kindAtemschutz }))
    expect(screen.getByRole('group', { name: az.equipmentLabel })).toBeTruthy()
  })
})

/* ── The phone board of the full app (24.09.2026, Übung Allschwilerstrasse 100) ───────────────
 * One Überwacher ran five Trupps from a phone; the hand-set order hid the overdue ones and ten of
 * seventeen contacts came after the alarm. The phone board is now arranged by what to do next,
 * every button says its word, and one pressure picker answers Druck and Raus. */
describe('the phone board (full app)', () => {
  afterEach(() => { vi.mocked(useIsPhone).mockReturnValue(false) })
  const inField = (id: string, name: string, contactAgoMin: number): Trupp => ({
    ...aktivTrupp(), id, name, lastContactTime: iso(contactAgoMin * 60_000),
  })
  const rowNames = () => Array.from(document.querySelectorAll(`.${s.rowList} .${s.trowNameTxt}`)).map((el) => el.textContent)

  it('puts the Trupp due next on top of «Drin», whatever the hand-set order', () => {
    vi.mocked(useIsPhone).mockReturnValue(true)
    mount({ trupps: [inField('a', 'Fresh Anna', 1), inField('b', 'Due Beat', 4.5)] })
    expect(rowNames().slice(0, 2)).toEqual(['Due Beat', 'Fresh Anna'])
    const titles = Array.from(document.querySelectorAll(`.${s.sectTitle}`)).map((el) => el.textContent)
    expect(titles[0]).toBe(az.phoneSectionIn)
  })

  it('orders the sections Drin · Sicherungstrupp · Bereit · Draussen', () => {
    vi.mocked(useIsPhone).mockReturnValue(true)
    mount({ trupps: [
      { ...aktivTrupp(), id: 'o', name: 'Out Otto', status: 'raus', exitTime: iso(60_000) },
      { ...aktivTrupp(), id: 'r', name: 'Ready Rita', status: 'angemeldet', entryTime: '', lastContactTime: '', readings: [] },
      { ...aktivTrupp(), id: 'sich', name: 'Safe Sam', auftrag: 'sichern', status: 'angemeldet', entryTime: '', lastContactTime: '', readings: [] },
      inField('i', 'In Ida', 1),
    ] })
    const text = document.body.textContent ?? ''
    const at = (needle: string) => text.indexOf(needle)
    expect(at('In Ida')).toBeLessThan(at('Safe Sam'))
    expect(at('Safe Sam')).toBeLessThan(at('Ready Rita'))
    expect(at('Ready Rita')).toBeLessThan(at('Out Otto'))
    // the order menu is not offered: the phone arrangement is fixed
    expect(screen.queryByRole('button', { name: az.orderLabel })).toBeNull()
  })

  it('«Druck» on the row opens the picker and one tap records the reading', () => {
    vi.mocked(useIsPhone).mockReturnValue(true)
    const props = mount({ trupps: [inField('a', 'Anna', 1)] })
    fireEvent.click(screen.getByRole('button', { name: druckName }))
    fireEvent.click(screen.getByRole('button', { name: '200' }))
    expect(props.recordPressure).toHaveBeenCalledWith('a', 200)
  })

  it('«Raus melden» asks the Restdruck — a number goes out with it, «Ohne Druck raus» without', () => {
    vi.mocked(useIsPhone).mockReturnValue(true)
    const setTruppStatus = vi.fn()
    mount({ trupps: [inField('a', 'Anna', 1)], setTruppStatus })
    fireEvent.click(document.querySelector(`.${s.trow}`)!)
    fireEvent.click(screen.getByRole('button', { name: az.actExit }))
    fireEvent.click(screen.getByRole('button', { name: '180' }))
    expect(setTruppStatus).toHaveBeenCalledWith('a', 'raus', 180)
  })

  it('offers «Ohne Druck raus» on the same sheet', () => {
    const setTruppStatus = vi.fn()
    mount({ trupps: [inField('a', 'Anna', 1)], setTruppStatus })
    fireEvent.click(screen.getByRole('button', { name: az.actExit }))
    fireEvent.click(screen.getByRole('button', { name: az.exitNoBar }))
    expect(setTruppStatus).toHaveBeenCalledWith('a', 'raus')
  })

  /* The empty slot is a section HEAD since the slim-down (26.09.2026): «SICHERUNGSTRUPP ——— Bestimmen»,
   * the title in the warn tone while a crew is inside and nobody stands ready. The two sentences the
   * dashed box carried («Kein Sicherungstrupp · Ein Trupp ist drin») went with it. */
  it('asks for a Sicherungstrupp while a crew is inside and none stands ready', () => {
    vi.mocked(useIsPhone).mockReturnValue(true)
    mount({ trupps: [inField('a', 'Anna', 1)] })
    const head = screen.getByText(az.safetyTitle).closest(`.${s.sect}`)!
    expect(head.classList.contains(s.sectDue)).toBe(true)
    fireEvent.click(within(head as HTMLElement).getByRole('button', { name: az.safetyPick }))
    const sichern = within(screen.getByRole('group', { name: az.auftragLabel })).getByRole('button', { name: 'Sichern' })
    expect(sichern.getAttribute('aria-pressed')).toBe('true')
  })

  it('gives a row without the two actions the one-line grid, so every clock sits in one column', () => {
    vi.mocked(useIsPhone).mockReturnValue(true)
    mount({ trupps: [
      inField('i', 'In Ida', 1),
      { ...aktivTrupp(), id: 'r', name: 'Ready Rita', status: 'angemeldet', entryTime: '', lastContactTime: '', readings: [] },
      { ...aktivTrupp(), id: 'o', name: 'Out Otto', status: 'raus', exitTime: iso(60_000) },
    ] })
    const rowOf = (name: string) => screen.getByText(name).closest(`.${s.trow}`)!
    expect(rowOf('In Ida').classList.contains(s.trowTwo)).toBe(true)
    for (const name of ['Ready Rita', 'Out Otto']) {
      expect(rowOf(name).classList.contains(s.trowOne)).toBe(true)
      expect(rowOf(name).classList.contains(s.trowTwo)).toBe(false)
    }
  })

  it('holds the arrangement for 2 s after a Kontakt, then lets the due Trupp rise again', () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    try {
      vi.mocked(useIsPhone).mockReturnValue(true)
      const trupps = [inField('a', 'Fresh Anna', 1), inField('b', 'Due Beat', 4.5)]
      const props = propsFor({ trupps })
      const view = render(<AtemschutzView {...props} />)
      expect(rowNames().slice(0, 2)).toEqual(['Due Beat', 'Fresh Anna'])
      // Kontakt on «Due Beat» freezes the order; the parent then hands back its fresh clock
      fireEvent.click(within(screen.getByText('Due Beat').closest(`.${s.trow}`) as HTMLElement).getByRole('button', { name: az.actContact }))
      expect(props.recordContact).toHaveBeenCalledWith('b')
      const fresh = [trupps[0], { ...trupps[1], lastContactTime: iso(0) }]
      view.rerender(<AtemschutzView {...props} trupps={fresh} />)
      expect(rowNames().slice(0, 2)).toEqual(['Due Beat', 'Fresh Anna'])
      act(() => { vi.advanceTimersByTime(2100) })
      expect(rowNames().slice(0, 2)).toEqual(['Fresh Anna', 'Due Beat'])
    } finally {
      vi.useRealTimers()
    }
  })

  it('sends the standing Sicherungstrupp in with one tap', () => {
    vi.mocked(useIsPhone).mockReturnValue(true)
    const setTruppStatus = vi.fn()
    mount({ trupps: [
      inField('a', 'Anna', 1),
      { ...aktivTrupp(), id: 'sich', name: 'Safe Sam', auftrag: 'sichern', status: 'angemeldet', entryTime: '', lastContactTime: '', readings: [] },
    ], setTruppStatus })
    // the head stays, its door goes: a Trupp stands under it
    expect(screen.getByText(az.safetyTitle)).toBeTruthy()
    expect(screen.queryByRole('button', { name: az.safetyPick })).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: az.actEnter }))
    expect(setTruppStatus).toHaveBeenCalledWith('sich', 'aktiv')
  })
})

describe('re-entry right after an Austritt asks which cylinder', () => {
  const justOut = (minAgo: number): Trupp => ({
    ...aktivTrupp(), status: 'raus', exitTime: iso(minAgo * 60_000),
    readings: [...aktivTrupp().readings!, { t: iso(minAgo * 60_000), bar: 180, kind: 'exit', measured: true }],
  })

  it('holds «Im Einsatz» until «Gleiche» or «Neue Flasche» is chosen, and takes the chosen bar', () => {
    const reactivateTrupp = vi.fn()
    render(<Overlays />)
    mount({ trupps: [justOut(2)], reactivateTrupp })
    fireEvent.click(screen.getByRole('button', { name: az.actReenter }))
    expect(screen.getByText(fillTemplate(az.bottleAsk, { min: '2', bar: '180' }))).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: az.reenterSubmit }))
    expect(reactivateTrupp).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: new RegExp(az.bottleSame) }))
    fireEvent.click(screen.getByRole('button', { name: az.reenterSubmit }))
    expect(reactivateTrupp).toHaveBeenCalledWith('tr1', expect.objectContaining({ pressure: 180 }), false)
  })

  it('does not ask after a real break', () => {
    mount({ trupps: [justOut(25)] })
    fireEvent.click(screen.getByRole('button', { name: az.actReenter }))
    expect(screen.queryByRole('button', { name: new RegExp(az.bottleSame) })).toBeNull()
  })
})
