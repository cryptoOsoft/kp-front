// @vitest-environment jsdom
// The board with Trupps that are not under Atemschutz, registering without an Auftrag, editing a
// Trupp that has come out, the Trupp form on the phone and the Reihenfolge menu.
// Shared setup: AtemschutzView.setup.tsx.
import { readFileSync } from 'node:fs'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { useIsPhone } from '../lib/useIsPhone'
import s from './Atemschutz.module.css'
import { Overlays } from '../lib/ui'
import { atemschutzDoctrine } from '../lib/deploymentConfig'
import { fillTemplate } from '../lib/format'
import type { Trupp, TruppFields, TruppReading } from '../types'
import { registerAtemschutzViewHooks, az, firstBtn, lastBtn, iso, aktivTrupp, mount, typeGuest, pressureRow, kanalRow, pickAuftrag } from './AtemschutzView.setup'

vi.mock('../lib/useIsPhone', async (original) => ({ ...await original<typeof import('../lib/useIsPhone')>(), useIsPhone: vi.fn(() => false) }))
registerAtemschutzViewHooks()

/* ── Trupps ohne Atemschutz — «Sektionen» (decided 03.09.) ────────────────────────────────────
 * One board, two sections, and — since the card redesign — ONE footprint: the same row, the same
 * card, the same tap to open. What keeps the PA safety signal undiluted is not a second, lighter
 * layout but the card's own restraint, so that is what these tests pin: no clock, no Druck, no
 * Kontakt, and never an alarm colour. */
describe('the board with Trupps that are not under Atemschutz', () => {
  // ⚠️ restored here rather than at the end of the one phone test below: a failure before that
  // line would otherwise leave every later test in this block running in phone mode.
  afterEach(() => { vi.mocked(useIsPhone).mockReturnValue(false) })
  const plainTrupp = (): Trupp => ({
    id: 'tr9', kind: 'einfach', name: 'Gerber', members: ['Stalder'],
    auftrag: 'sichern', ziel: 'Zufahrt Hauptstrasse', funkkanal: 1,
    entryPressureBar: 0, entryTime: iso(20 * 60_000), lastContactTime: '', status: 'aktiv',
  })

  it('leaves an all-Atemschutz board exactly as it was — no headings, no second half', () => {
    mount()
    expect(screen.queryByText(az.sectionAtemschutz)).toBeNull()
    expect(screen.queryByText(az.sectionPlain)).toBeNull()
    expect(document.querySelector(`.${s.trowPlain}`)).toBeNull()
  })

  it('splits into «Atemschutz» + «Weitere Trupps» and gives both halves the SAME card', () => {
    mount({ trupps: [aktivTrupp(), plainTrupp()], truppColors: { tr1: '#e8392b', tr9: '#e2920a' } })
    expect(screen.getByText(az.sectionAtemschutz)).toBeTruthy()
    expect(screen.getByText(az.sectionPlain)).toBeTruthy()
    const cards = [...document.querySelectorAll(`.${s.trowCard}`)]
    expect(cards).toHaveLength(2)
    const plain = cards.find((c) => c.textContent?.includes('Gerber'))!
    // same shell — and NONE of the monitoring vocabulary: no clock, no Druck, no Kontakt
    expect(plain.classList.contains(s.trowPlain)).toBe(true)
    expect(plain.querySelector(`.${s.kontaktBtn}`)).toBeNull()
    expect(plain.textContent).not.toContain('bar')
    expect(screen.getAllByRole('button', { name: az.actContact })).toHaveLength(1) // the PA card's
  })

  /* ⚠️ The seam Bastian asked for by name (03.09.): on a phone the two halves must have the EXACT
   * same footprint. A work squad drawn at a different height in the same scroll teaches the eye
   * that these are two kinds of object, when the whole point of the section head is that they are
   * one board — and it made the half with no clock and no Druck the half that took the most
   * screen. Same row, same tap, same way back. */
  it('gives a work squad the same row and the same opening tap on a phone', () => {
    vi.mocked(useIsPhone).mockReturnValue(true)
    mount({ trupps: [aktivTrupp(), plainTrupp()], truppColors: { tr1: '#e8392b', tr9: '#e2920a' } })
    const rows = [...document.querySelectorAll(`.${s.trow}`)]
    expect(rows).toHaveLength(2)
    expect(document.querySelector(`.${s.trowCard}`)).toBeNull() // nothing open yet
    fireEvent.click(rows.find((r) => r.textContent?.includes('Gerber'))!)
    // the opened phone card is the row grown downwards (26.09.2026) — in the row's own quiet tone
    const card = document.querySelector('[data-az-open]')!
    expect(card.textContent).toContain('Gerber')
    expect(card.classList.contains(s.trowPlain)).toBe(true)
    // …and back, through the same control the Atemschutz half uses
    fireEvent.click(screen.getByRole('button', { name: new RegExp(az.collapse) }))
    expect(document.querySelector('[data-az-open]')).toBeNull()
  })

  /* ⚠️ A work squad's log is real and stays — angemeldet / eingerückt / draussen is its
   * chronology — but every row of it carries a bar of 0: `createTrupp` opens the log with an
   * Eingangsdruck a Trupp without Atemschutz was never asked for. The card printed «Eingerückt
   * 0 bar» under a card that says nothing else about pressure, which reads as a measurement
   * rather than as the absence of one (field report, 04.09.). */
  it('shows a work squad its Verlauf without inventing a Druck for it', () => {
    const readings: TruppReading[] = [
      { t: iso(20 * 60_000), bar: 0, kind: 'registered' },
      { t: iso(18 * 60_000), bar: 0, kind: 'entry' },
    ]
    mount({ trupps: [{ ...plainTrupp(), readings }], truppColors: { tr9: '#e2920a' } })
    const card = () => document.querySelector(`.${s.trowCard}`)!
    expect(card().textContent).not.toContain('bar')
    // …and the rows are still there to read: open the log and the chronology is intact
    fireEvent.click(screen.getByRole('button', { name: new RegExp(az.verlauf) }))
    // ⚠️ …and the Eintritt SAYS what went in (04.09., Manuel): «Atemschutz beendet» followed by a
    // bare «Eingerückt» left the reader unable to tell whether the crew was wearing masks.
    expect(screen.getByText(fillTemplate(az.readingNoAs, { what: az.readingKind.entry }))).toBeTruthy()
    expect(screen.queryByText(az.readingKind.entry)).toBeNull()
    expect(card().textContent).not.toContain('bar')
  })

  it('says so when the Atemschutz half is empty rather than leaving a bare heading', () => {
    mount({ trupps: [plainTrupp()], truppColors: { tr9: '#e2920a' } })
    expect(screen.getByText(az.sectionAtemschutzEmpty)).toBeTruthy()
    // the one card on the board is the work squad's, and it is the plain one
    expect(document.querySelectorAll(`.${s.trowCard}`)).toHaveLength(1)
    expect(document.querySelectorAll(`.${s.trowPlain}`)).toHaveLength(1)
  })

  it('offers the one lifecycle step its state actually has — and no Rückzug it cannot take', () => {
    const setTruppStatus = vi.fn()
    mount({ trupps: [plainTrupp()], truppColors: { tr9: '#e2920a' }, setTruppStatus })
    expect(screen.queryByRole('button', { name: az.actEnter })).toBeNull() // it is already in
    // Rückzug lowers the turn-back pressure (alarmBarFor) and there is no cylinder to lower it on
    expect(screen.queryByRole('button', { name: az.actRueckzug })).toBeNull()
    // app-only wording (09.09.): a work squad's exit button reads «Auftrag erledigt»
    fireEvent.click(screen.getByRole('button', { name: az.actExitPlain }))
    expect(setTruppStatus).toHaveBeenCalledWith('tr9', 'raus')
  })

  // ⚠️ APP ONLY (09.09., field ask): a work squad reports a task done, not a radio check — the
  // handed-over link board keeps «Raus melden» / «Draussen» for every Trupp (see the lite
  // describe block below).
  it('speaks work-squad words in the app: «Auftrag erledigt» to exit, «Ohne Auftrag» once out', () => {
    mount({ trupps: [plainTrupp()], truppColors: { tr9: '#e2920a' } })
    expect(screen.getByRole('button', { name: az.actExitPlain })).toBeTruthy()
    expect(screen.queryByRole('button', { name: az.actExit })).toBeNull()

    cleanup()
    mount({ trupps: [{ ...plainTrupp(), status: 'raus', exitTime: iso(5 * 60_000) }], truppColors: { tr9: '#e2920a' } })
    expect(screen.getByText(az.statusPlainOut)).toBeTruthy()
    expect(screen.queryByText(az.status.raus)).toBeNull()
  })

  /* ⚠️ Same ⋯ as every other card, and every entry a WORD. These used to be glyphs on the row
   * itself — a pen, a footprint, a bin — on the argument that a Trupp with nothing to open must
   * keep its controls in reach. It has something to open (its Verlauf), and a footprint that
   * means «platzieren» is exactly the knowledge that is gone after six months without practice. */
  it('puts bearbeiten · platzieren · entfernen behind the same ⋯ as every other card', async () => {
    render(<Overlays />)
    const deleteTrupp = vi.fn()
    mount({ trupps: [plainTrupp()], truppColors: { tr9: '#e2920a' }, deleteTrupp })
    fireEvent.click(screen.getByRole('button', { name: az.cardMenu }))
    for (const label of [az.edit, az.place]) {
      expect(await screen.findByRole('menuitem', { name: label })).toBeTruthy()
    }
    fireEvent.click(await screen.findByRole('menuitem', { name: az.remove }))
    // the work squad is out there — removing it asks first (staging r2, N4)
    fireEvent.click(within(await screen.findByRole('alertdialog')).getByRole('button', { name: az.remove }))
    await waitFor(() => expect(deleteTrupp).toHaveBeenCalledWith('tr9'))
  })

  // The handed-over Tafel operates the Atemschutzüberwachung and nothing else — that is what the
  // QR promises and what the link's backend allowlist permits.
  it('hides plain Trupps entirely on the handed-over board, and offers no way to create one', () => {
    mount({ lite: { subtitle: 'Brand' }, trupps: [aktivTrupp(), plainTrupp()], truppColors: { tr1: '#e8392b', tr9: '#e2920a' } })
    expect(screen.queryByText('Gerber')).toBeNull()
    expect(document.querySelector(`.${s.trowPlain}`)).toBeNull()
    expect(screen.queryByText(az.sectionPlain)).toBeNull()
    fireEvent.click(firstBtn(az.newTrupp))
    expect(screen.queryByRole('radiogroup', { name: az.kindLabel })).toBeNull()
  })

  /* ⚠️ Changeable while EDITING since 04.09. A Verkehrstrupp that ends up going in under PA, and a
   * Trupp registered under Atemschutz by mistake, were both a delete and a re-registration until
   * then — which throws away the record of a crew that was already working. */
  it('offers «Art des Trupps» when editing, and asks for a cylinder the moment it is needed', async () => {
    mount({ trupps: [plainTrupp()], truppColors: { tr9: '#e2920a' } })
    fireEvent.click(screen.getByRole('button', { name: az.cardMenu }))
    fireEvent.click(await screen.findByRole('menuitem', { name: az.edit }))
    expect(screen.getByRole('radiogroup', { name: az.kindLabel })).toBeTruthy()
    // …and no Druck while it is still a work squad: there is no cylinder to ask about
    expect(screen.queryByText(az.pressureLabel)).toBeNull()
    expect(screen.queryByText(az.editPressureLabel)).toBeNull()

    fireEvent.click(screen.getByRole('radio', { name: az.kindAtemschutz }))
    // an upgrade records a FIRST Eingangsdruck — never «korrigieren», which would claim the Trupp
    // already had one
    expect(screen.getByText(az.pressureLabel)).toBeTruthy()
    expect(screen.queryByText(az.editPressureLabel)).toBeNull()
  })

  /* ⚠️ …and on «Wieder einrücken» too (04.09., Feldtest: «Bei Wieder einrücken (AS) habe ich
   * keine Auswahl ob mit oder ohne AS»), reversing «the two decisions must not ride on one press»
   * from the same day. Each re-deployment is its own Einsatz of that crew: the Trupp that fought
   * the fire under PA goes back in to clear up without it. */
  // UX sweep F6: «does NOT start the contact clock» was a `title` only — a hold now says it
  it('explains on a hold that «Bereitstellen» does not start the contact clock', () => {
    mount({ trupps: [{ ...aktivTrupp(), status: 'raus', exitTime: iso(60_000) }] })
    fireEvent.click(screen.getByRole('button', { name: az.actReenter }))
    const standby = screen.getByRole('button', { name: new RegExp(`^${az.reenterStandby}`) })
    expect(standby.hasAttribute('data-holdexplain')).toBe(true)
    expect(standby.getAttribute('aria-label')).toContain(az.reenterStandbyHint)
    expect(standby.hasAttribute('title')).toBe(false)
  })

  it('asks the Art again on a re-deploy, and sends a Trupp back in WITHOUT Atemschutz', () => {
    const reactivateTrupp = vi.fn()
    mount({
      reactivateTrupp,
      trupps: [{ ...aktivTrupp(), status: 'raus', exitTime: iso(60_000) }],
    })
    fireEvent.click(screen.getByRole('button', { name: az.actReenter }))
    expect(screen.getByRole('radiogroup', { name: az.kindLabel })).toBeTruthy()
    // a fresh cylinder is what the form opens on…
    expect(screen.getByText(az.newPressureLabel)).toBeTruthy()
    fireEvent.click(screen.getByRole('radio', { name: az.kindPlain }))
    // …and there is none to ask for once the crew goes back in without a mask
    expect(screen.queryByText(az.newPressureLabel)).toBeNull()
    // «Bereitstellen» goes with it: a Sicherungstrupp is by definition a crew standing by under PA
    expect(screen.queryByRole('button', { name: new RegExp(`^${az.reenterStandby}`) })).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: az.reenterSubmit }))
    expect(reactivateTrupp).toHaveBeenCalledTimes(1)
    const [, fields] = reactivateTrupp.mock.calls[0] as [string, TruppFields]
    expect(fields.kind).toBe('einfach')
    expect(fields.pressure).toBe(0)
  })

  // the other direction: the Verkehrstrupp that has finished puts masks on for the cellar — and
  // then the Eingangsdruck is asked for and gates the save, exactly as it does on a new Trupp
  it('asks for an Eingangsdruck when a plain Trupp goes back in under Atemschutz', () => {
    const reactivateTrupp = vi.fn()
    mount({
      reactivateTrupp,
      trupps: [{ ...plainTrupp(), status: 'raus', exitTime: iso(60_000) }],
      truppColors: { tr9: '#e2920a' },
    })
    fireEvent.click(screen.getByRole('button', { name: az.actReenter }))
    expect(screen.queryByText(az.newPressureLabel)).toBeNull()
    fireEvent.click(screen.getByRole('radio', { name: az.kindAtemschutz }))
    // the station's default cylinder, not the 0 bar the plain card carries — a stepper opening on
    // a value the submit then refuses is the dead button this form does not have
    expect(screen.getByText(az.newPressureLabel)).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: az.reenterSubmit }))
    const [, fields] = reactivateTrupp.mock.calls[0] as [string, TruppFields]
    expect(fields.kind).toBe('atemschutz')
    expect(fields.pressure).toBe(atemschutzDoctrine().defaultPressureBar)
  })

  it('creates a Trupp «ohne Atemschutz» with the kind stamped and no Eingangsdruck', () => {
    const createTrupp = vi.fn()
    mount({ createTrupp, personnel: [], trupps: [] })
    fireEvent.click(firstBtn(az.newTrupp))
    // the Druck row is there for Atemschutz…
    expect(pressureRow()).toBeTruthy()
    fireEvent.click(screen.getByRole('radio', { name: az.kindPlain }))
    // …and gone the moment it is not
    expect(screen.queryByText(az.pressureLabel)).toBeNull()
    typeGuest('Gerber Urs')
    pickAuftrag('Verkehr')
    fireEvent.click(lastBtn(az.start))
    expect(createTrupp).toHaveBeenCalledTimes(1)
    const made = createTrupp.mock.calls[0][0] as Trupp
    expect(made.kind).toBe('einfach')
    expect(made.entryPressureBar).toBe(0)
  })

  /* ── The Auftrag vocabulary follows the kind (03.09.) ──────────────────────────────────────
   * A Verkehrstrupp was being offered «Löschen» — the PA list, on a card that is read at a
   * glance. Each kind now has its own six words (config · atemschutz.auftrag / .auftragEinfach),
   * and the tiles swap with the «Art des Trupps» answer above them. */
  it('offers the Auftrag list belonging to the chosen Art des Trupps', () => {
    mount({ trupps: [] })
    fireEvent.click(firstBtn(az.newTrupp))
    const tiles = () => within(screen.getByRole('group', { name: az.auftragLabel }))
      .getAllByRole('button').map((b) => b.textContent)
    expect(tiles()).toEqual(['Retten', 'Löschen', 'Absuchen', 'Sichern', 'Erkunden', 'Anderes'])
    fireEvent.click(screen.getByRole('radio', { name: az.kindPlain }))
    expect(tiles()).toEqual(['Verkehr', 'Sanität', 'Wasserversorgung', 'Sichern', 'Bereitstellung', 'Anderes'])
    expect(tiles()).not.toContain('Löschen')
  })

  /* ⚠️ …but only the OFFER is narrowed. Every Trupp recorded before 03.09. carries a PA id, and
   * a kind can be mis-picked — the label resolver searches BOTH lists (lib/report ·
   * truppAuftragLabel), so the chip says the word rather than going blank or, worse, offering
   * «Auftrag offen» over an Auftrag that is set. An incident is a legal record. */
  it('renders an Auftrag stored from the OTHER kind’s list, both ways round', () => {
    mount({
      trupps: [{ ...aktivTrupp(), auftrag: 'verkehr' }, { ...plainTrupp(), auftrag: 'loeschen' }],
      truppColors: { tr1: '#e8392b', tr9: '#e2920a' },
    })
    expect(screen.getByText(/^Verkehr( · |$)/)).toBeTruthy()   // PA card wearing a non-PA id
    expect(screen.getByText(/^Löschen( · |$)/)).toBeTruthy()   // plain row wearing a PA id
    expect(screen.queryByRole('button', { name: az.auftragAdd })).toBeNull()
  })

  // «Anderes» is the escape hatch on BOTH lists — it is the same shared id — so it has to keep
  // demanding the word that says what the order actually was.
  it.each([['atemschutz', az.kindAtemschutz], ['einfach', az.kindPlain]])(
    'holds the save until «Anderes» has a Ziel (%s)', (_kind, kindLabel) => {
      const createTrupp = vi.fn()
      mount({ createTrupp, trupps: [] })
      fireEvent.click(firstBtn(az.newTrupp))
      fireEvent.click(screen.getByRole('radio', { name: kindLabel }))
      typeGuest('Gerber Urs')
      fireEvent.click(within(screen.getByRole('group', { name: az.auftragLabel })).getByText('Anderes'))
      fireEvent.click(lastBtn(az.start))
      expect(createTrupp).not.toHaveBeenCalled()
      fireEvent.change(screen.getByLabelText(az.zielLabel), { target: { value: 'Zufahrt sperren' } })
      fireEvent.click(lastBtn(az.start))
      expect(createTrupp).toHaveBeenCalledTimes(1)
    })

  // ⚠️ A default is never STAMPED: absent means «unter Atemschutz» (types · TruppKind), so a
  // fresh PA Trupp has to look exactly like every record written before 03.09.
  it('writes no kind at all for a Trupp under Atemschutz', () => {
    const createTrupp = vi.fn()
    mount({ createTrupp, trupps: [] })
    fireEvent.click(firstBtn(az.newTrupp))
    typeGuest('Meier Thomas')
    pickAuftrag()
    fireEvent.click(lastBtn(az.start))
    expect('kind' in (createTrupp.mock.calls[0][0] as object)).toBe(false)
  })
})

/* ── A Trupp may be registered WITHOUT an Auftrag (14.09., Feldentscheid) ──────────────────────
 * Reverses the 04.09. gate for the create path: a crew is often put on the board to stand ready
 * and gets its order a minute later, from somebody else. The gap is not lost — the card carries
 * it as «Auftrag offen», the same pill on a Trupp created without one as on one edited to none.
 * The one thing that still holds a save, in every mode, is «Anderes» without its word. */
describe('a Trupp may be registered without an Auftrag', () => {
  // the phone case below flips the shared useIsPhone mock — put it back, or every later test in
  // this file gets the compact board
  afterEach(() => { vi.mocked(useIsPhone).mockReturnValue(false) })

  it('registers a Trupp with no Auftrag, and its card then shows «Auftrag offen»', () => {
    const createTrupp = vi.fn()
    mount({ createTrupp, trupps: [] })
    fireEvent.click(firstBtn(az.newTrupp))
    typeGuest('Meier Thomas')
    fireEvent.click(lastBtn(az.start))
    expect(createTrupp).toHaveBeenCalledTimes(1)
    const created = createTrupp.mock.calls[0][0] as Trupp
    expect(created.auftrag).toBeUndefined()
    expect(created.ziel ?? '').toBe('')
    // …and the board, given exactly what the create path handed over, shows the gap as the pill
    cleanup()
    const onEdit = vi.fn()
    mount({ trupps: [created], editTrupp: onEdit })
    expect(screen.getByRole('button', { name: az.auftragAdd })).toBeTruthy()
  })

  it('still records the Auftrag when one is picked', () => {
    const createTrupp = vi.fn()
    mount({ createTrupp, trupps: [] })
    fireEvent.click(firstBtn(az.newTrupp))
    typeGuest('Meier Thomas')
    pickAuftrag()
    fireEvent.click(lastBtn(az.start))
    expect((createTrupp.mock.calls[0][0] as Trupp).auftrag).toBe('retten')
  })

  // ⚠️ The amber «Auftrag fehlt» line waits while the PERSON SEARCH has the caret (10.10.2026,
  // owner's iPhone): the crew goes in one name after another, and the line stood there from the
  // first name on. It appears once the search is left — and still before «Anmelden» is pressed.
  it('holds the «Auftrag fehlt» line back while the person search is focused', () => {
    mount({ trupps: [] })
    fireEvent.click(firstBtn(az.newTrupp))
    const search = screen.getByLabelText(az.teamSearchPlaceholder)
    fireEvent.focus(search)
    typeGuest('Meier Thomas')
    typeGuest('Huber Anna')
    // still adding people: the slot is held, but nothing is shown or announced
    expect(screen.queryByRole('status')).toBeNull()
    expect(screen.queryByText(az.auftragMissingHint)).not.toBeNull()
    // focus moves on (to the Ziel here; the footer or anywhere else alike)
    fireEvent.blur(search)
    fireEvent.focus(screen.getByLabelText(az.zielLabel))
    expect(screen.getByRole('status').textContent).toBe(az.auftragMissingHint)
    // back in the search for one more name: it waits again
    fireEvent.focus(search)
    expect(screen.queryByRole('status')).toBeNull()
  })

  // a pick hands the caret back to the search (TruppTeam · add), so a tablet that taps names off
  // the list waits too — and the line is there by the time the finger reaches the footer
  it('shows the line once the focus reaches the footer, before «Anmelden» is pressed', () => {
    const createTrupp = vi.fn()
    mount({ createTrupp, trupps: [] })
    fireEvent.click(firstBtn(az.newTrupp))
    typeGuest('Meier Thomas')
    expect(document.activeElement).toBe(screen.getByLabelText(az.teamSearchPlaceholder))
    expect(screen.queryByRole('status')).toBeNull()
    act(() => lastBtn(az.start).focus())
    expect(screen.getByRole('status').textContent).toBe(az.auftragMissingHint)
    fireEvent.click(lastBtn(az.start))
    expect(createTrupp).toHaveBeenCalledTimes(1)
  })

  // the free text alone is a complete order too — a Ziel without a tile («2OG links»)
  it('takes the Ziel text on its own', () => {
    const createTrupp = vi.fn()
    mount({ createTrupp, trupps: [] })
    fireEvent.click(firstBtn(az.newTrupp))
    typeGuest('Meier Thomas')
    fireEvent.change(screen.getByLabelText(az.zielLabel), { target: { value: '2OG links' } })
    expect(screen.queryByRole('status')).toBeNull()
    fireEvent.click(lastBtn(az.start))
    expect(createTrupp).toHaveBeenCalledTimes(1)
    expect((createTrupp.mock.calls[0][0] as Trupp).ziel).toBe('2OG links')
  })

  // «Anderes» is a label that says nothing on its own — the one Auftrag state that still blocks
  it('points a save blocked by a wordless «Anderes» at the Auftrag tiles and hands them the focus', async () => {
    vi.mocked(useIsPhone).mockReturnValue(true)
    const createTrupp = vi.fn()
    mount({ createTrupp, trupps: [] })
    fireEvent.click(firstBtn(az.newTrupp))
    typeGuest('Meier Thomas')
    pickAuftrag(az.auftragLabels.anderes)
    fireEvent.click(lastBtn(az.start))
    expect(createTrupp).not.toHaveBeenCalled()
    expect(screen.getByText(az.saveBlockedAuftrag)).toBeTruthy()
    // flat form (08.09.): the tiles are already on screen, the block rings them and moves focus
    await waitFor(() => {
      const tiles = within(screen.getByRole('group', { name: az.auftragLabel })).getAllByRole('button')
      expect(document.activeElement).toBe(tiles[0])
    })
  })

  // ⚠️ EDITING is never blocked: the clock is running, the operator came here to correct
  // something else, and a form that refuses to close would lose that correction.
  it('lets a Trupp that is already in the field be saved with the Auftrag still open', async () => {
    const editTrupp = vi.fn()
    mount({ editTrupp, trupps: [aktivTrupp()] })
    fireEvent.click(screen.getByRole('button', { name: az.cardMenu }))
    fireEvent.click(await screen.findByRole('menuitem', { name: az.edit }))
    fireEvent.click(screen.getByRole('button', { name: az.save }))
    expect(editTrupp).toHaveBeenCalledTimes(1)
    expect((editTrupp.mock.calls[0][1] as { auftrag?: string }).auftrag).toBeUndefined()
  })
})

/* ── The record stays correctable after the Trupp is out (09.09., Feldentscheid) ───────────────
 * «Bearbeiten» used to disappear the moment a Trupp reported out — and that is exactly when the
 * mistakes are found: the wrong crew, an AdF who joined and was never entered, a typo in the
 * Auftrag. All of it prints on the Rapport, and the Rapport is read long after the Austritt. The
 * entry that acts on a LIVE deployment («Platzieren») keeps its gate. */
describe('editing a Trupp that has come out', () => {
  const outTrupp = (over: Partial<Trupp> = {}): Trupp => ({
    ...aktivTrupp(), status: 'raus', exitTime: iso(5 * 60_000), leaderPersonId: 'p1', ...over,
  })

  it('offers «Bearbeiten» on a raus card — and still withholds the two live-deployment entries', async () => {
    mount({ trupps: [outTrupp()] })
    fireEvent.click(screen.getByRole('button', { name: az.cardMenu }))
    expect(await screen.findByRole('menuitem', { name: az.edit })).toBeTruthy()
    expect(screen.queryByRole('menuitem', { name: az.place })).toBeNull()
  })

  /* ⚠️ «Einer, ein Trupp» is about who is deployed NOW. The Gruppenführer whose Trupp came out at
   * 15:40 stands in the next one at 15:50 — measured against the live board, correcting the old
   * card hit the assignment conflict and Speichern went dead, with the correction lost. */
  it('saves the correction even while its crew is already in a LIVE Trupp', async () => {
    const editTrupp = vi.fn()
    mount({
      editTrupp,
      trupps: [outTrupp(), { ...aktivTrupp(), id: 'tr2', name: 'Amstad', members: [], leaderPersonId: 'p1' }],
      truppColors: { tr1: '#e8392b', tr2: '#e2920a' },
    })
    fireEvent.click(screen.getAllByRole('button', { name: az.cardMenu })[0])
    fireEvent.click(await screen.findByRole('menuitem', { name: az.edit }))
    fireEvent.change(screen.getByLabelText(az.zielLabel), { target: { value: 'Dach via Schiebeleiter' } })
    fireEvent.click(screen.getByRole('button', { name: az.save }))
    expect(editTrupp).toHaveBeenCalledTimes(1)
    expect(editTrupp.mock.calls[0][0]).toBe('tr1')
    expect((editTrupp.mock.calls[0][1] as TruppFields).ziel).toBe('Dach via Schiebeleiter')
  })
})

/* ── The three-section stack on ANY phone (04.09.) ────────────────────────────────────────────
 * Replaces the two-step wizard of 02.–04.09. Three sections, all on screen, one open, the closed
 * ones reading their own answers out. What differs outside the link: the «Art des Trupps» tiles
 * lead «Luft & Funk», and the Ltg-Nr. sits in «Auftrag & Leitung» — which is ONE section, because
 * the Farbe it used to share a block with is not asked any more, on any layout. */
describe('the Trupp form on the main board’s phone layout', () => {
  afterEach(() => { vi.mocked(useIsPhone).mockReturnValue(false) })

  it('puts the Ltg-Nr. in «Auftrag & Leitung» and asks for no colour at all', () => {
    vi.mocked(useIsPhone).mockReturnValue(true)
    mount({ trupps: [aktivTrupp()] })
    fireEvent.click(firstBtn(az.newTrupp))
    // flat form: the Auftrag block stands open from the first moment
    expect(screen.getByText(az.auftragLabel)).toBeTruthy()
    expect(screen.getByText(az.zielLabel)).toBeTruthy()
    expect(screen.getByText(az.lineNoLabel)).toBeTruthy()
    // ⚠️ The colour is not a question anywhere any more (15.09.): per-Trupp and automatic,
    // never asked – not here, not on the marker.
    expect(screen.queryByText('Farbe')).toBeNull()
  })

  /* ⚠️ The Mannschaft is a CHIP ROW on the phone (05.09.). Three reserved slot rows plus a
   * standing roster filled the form before anybody had been picked, and the crew that was
   * actually chosen was the smallest thing on it. Here the empty Trupp renders no chip at all
   * (09.09.) and the roster appears only under a typed query — the Gast door included, so the
   * one way in is unchanged. The behaviour itself is pinned in TruppTeam.test.tsx; this checks
   * the form the operator opens really gets the phone skin. */
  it('makes the Mannschaft a chip row — no standing roster, and the Gast door still opens', () => {
    vi.mocked(useIsPhone).mockReturnValue(true)
    mount({ trupps: [aktivTrupp()], personnel: [
      { id: 'p1', displayName: 'Muster Anna', active: true, updatedAt: '2026-09-05T06:00:00.000Z' },
    ] })
    fireEvent.click(firstBtn(az.newTrupp))
    expect(screen.queryByRole('listbox', { name: az.sectionTeam })).toBeNull()
    expect(document.querySelector(`.${s.teamChips}`)?.children.length).toBe(0)
    typeGuest('Frei Nadja')
    expect(screen.getByText('Frei Nadja')).toBeTruthy()
    // …and with the query cleared the roster is gone again rather than left standing
    expect(screen.queryByRole('listbox', { name: az.sectionTeam })).toBeNull()
  })

  /* The flat column's order (08.09.): Art above the form, then Mannschaft → Auftrag/Ziel/
   * Leitung → the folded Standard line last — the same order the tablet's right column runs. */
  it('runs Art → Mannschaft → Auftrag → Standard-Zeile, all on one flat screen', () => {
    vi.mocked(useIsPhone).mockReturnValue(true)
    mount({ trupps: [aktivTrupp()] })
    fireEvent.click(firstBtn(az.newTrupp))
    // the Art rides its own row above the fields it governs
    expect(screen.getByRole('radiogroup', { name: az.kindLabel })).toBeTruthy()
    // …and everything else stands in one column, in reading order
    const txt = document.querySelector(`.${s.stack}`)?.textContent ?? ''
    const order = [az.sectionTeam, az.auftragLabel, az.lineNoLabel, az.pressureLabel, az.funkkanalSection].map((t) => txt.indexOf(t))
    expect(order.every((n) => n >= 0)).toBe(true)
    expect([...order]).toEqual([...order].slice().sort((a, b) => a - b))
    // the Druck row opens the Druck sheet — the grid is never inline
    expect(screen.queryByRole('group', { name: az.pressureLabel })).toBeNull()
    fireEvent.click(pressureRow())
    expect(screen.getByRole('group', { name: az.pressureLabel })).toBeTruthy()
  })

  /* ⚠️ «Wieder einrücken» opens the MANNSCHAFT, not «Luft & Funk» (05.09. evening, field
   * feedback). A re-deployment is a new Einsatz for that crew, and the crew is the first thing
   * that changes about it — somebody is swapped, somebody stays behind — while the fresh cylinder
   * and the channel are defaults to be checked, not typed. EDITING still opens «Luft & Funk»:
   * correcting the Eingangsdruck is what an edit is usually for. */
  it('a re-deploy asks the NEW Eingangsdruck and an edit offers «korrigieren» — both in the open', async () => {
    vi.mocked(useIsPhone).mockReturnValue(true)
    // the handed-over board, because that is the phone surface that shows a whole CARD (the main
    // board's phone layout is the row list) — the form behind the button is the same one
    mount({ lite: { subtitle: 'Brand' }, trupps: [{ ...aktivTrupp(), status: 'raus', exitTime: iso(60_000) }] })
    fireEvent.click(screen.getByRole('button', { name: az.actReenter }))
    // (in the form: the Tafel's «+ Trupp» cell says the same word since 29.09.2026)
    expect(within(screen.getByRole('dialog')).getByText(az.sectionTeam)).toBeTruthy()
    // the folded Standard line is a CREATE affair — a fresh cylinder's reading is a question
    expect(screen.getByText(az.newPressureLabel)).toBeTruthy()

    cleanup()
    mount({ lite: { subtitle: 'Brand' }, trupps: [aktivTrupp()] })
    fireEvent.click(screen.getByRole('button', { name: az.cardMenu }))
    fireEvent.click(await screen.findByRole('menuitem', { name: az.edit }))
    expect(screen.getByText(az.editPressureLabel)).toBeTruthy()
  })

  it('a tablet keeps the single screen — the stack is for 375px, not for touch', () => {
    mount({ trupps: [aktivTrupp()] }) // useIsPhone false
    fireEvent.click(firstBtn(az.newTrupp))
    expect(document.querySelector(`.${s.stack}`)).toBeNull() // no phone column on a tablet
    // …the Art leads the RIGHT column as its own section (08.09.) — named for a screen reader
    // only since 27.09.2026 (the two tiles name themselves) — with the folded Standard row at
    // the column's end, after the Leitung
    expect(screen.getByRole('radiogroup', { name: az.kindLabel })).toBeTruthy()
    expect(screen.queryByText(az.kindLabel)).toBeNull()
    const body = document.querySelector(`.${s.modalBody}`)
    expect(body?.firstElementChild?.className).toContain(s.formCol)
    const right = body?.children[1]
    expect(right?.firstElementChild?.querySelector('[role="radiogroup"]')?.getAttribute('aria-label')).toBe(az.kindLabel)
    expect(right?.lastElementChild?.textContent).toContain(az.funkkanalSection)
    // …and the Kanal row opens the Kanal sheet, over the form
    fireEvent.click(kanalRow())
    expect(screen.getByRole('dialog', { name: az.funkkanalUnit })).toBeTruthy()
    // (the form stands under it — hidden from the accessibility tree while the sheet is on top)
    expect(document.querySelector(`[role="dialog"][aria-label="${az.formCreateTitle}"]`)).toBeTruthy()
  })

  /* ── The Reihenfolge menu (04.09., Feldtest Manuel) ───────────────────────────────────────────
 * Two comparators, two findings: «den länger andauernden Einsatz zuerst» (the AS half already did
 * that through its contact clock — this is the answer for everything that has no clock), and
 * crews that are draussen or standing by sitting left of the ones actually working. */
describe('the Reihenfolge menu', () => {
  const plain = (id: string, name: string, over: Partial<Trupp> = {}): Trupp => ({
    id, kind: 'einfach', name, entryPressureBar: 0, entryTime: iso(10 * 60_000),
    lastContactTime: '', status: 'aktiv', ...over,
  })
  const names = () => [...document.querySelectorAll(`.${s.trowNameTxt}`)].map((e) => e.textContent)

  it('Dringlichkeit: among equals, the deployment that has run longest comes first', () => {
    mount({ order: 'dringlichkeit', trupps: [
      plain('t1', 'Kurz', { entryTime: iso(5 * 60_000) }),
      plain('t2', 'Lang', { entryTime: iso(45 * 60_000) }),
    ] })
    expect(names()).toEqual(['Lang', 'Kurz'])
  })

  // ⚠️ a FINISHED deployment keeps its total for the card to print, and it must not buy the card
  // a place at the top of an urgency sort
  it('…and a Trupp that has come out does not outrank one still out there', () => {
    mount({ order: 'dringlichkeit', trupps: [
      plain('t1', 'Fertig', { entryTime: iso(120 * 60_000), status: 'raus', exitTime: iso(60 * 60_000) }),
      plain('t2', 'Drin', { entryTime: iso(5 * 60_000) }),
    ] })
    expect(names()).toEqual(['Drin', 'Fertig'])
  })

  it('Auftrag: the crews out there first, then who is waiting, then who has finished', () => {
    mount({ order: 'auftrag', trupps: [
      // «Bereitstellung» leads the alphabet — under the old comparator it led the board
      plain('t1', 'Fertig', { auftrag: 'bereitstellung', status: 'raus', exitTime: iso(5 * 60_000) }),
      plain('t2', 'Wartet', { auftrag: 'sanitaet', status: 'angemeldet', entryTime: '' }),
      plain('t3', 'Drin', { auftrag: 'verkehr' }),
    ] })
    expect(names()).toEqual(['Drin', 'Wartet', 'Fertig'])
  })

  // the wide grid wears the phone's state heads where the order already reads that way, and
  // «Wie gesetzt» keeps one slot-keeping grid (hill climb r1, 04.11.2026)
  it('stands the wide grid under Drin · Draussen for Dringlichkeit, never for «Wie gesetzt»', () => {
    vi.mocked(useIsPhone).mockReturnValue(false)
    const out: Trupp = { ...aktivTrupp(), id: 'tr0', name: 'Fertig', status: 'raus', exitTime: iso(60_000) }
    const heads = () => [...document.querySelectorAll(`.${s.sectTitle}`)].map((e) => e.textContent)
    mount({ order: 'dringlichkeit', trupps: [out, aktivTrupp()] })
    expect(heads()).toEqual([az.phoneSectionIn, az.phoneSectionOut])
    expect(names()).toEqual(['Steiner', 'Fertig'])
    cleanup()
    mount({ order: 'manuell', trupps: [out, aktivTrupp()] })
    expect(heads()).toEqual([])
    expect(names()).toEqual(['Fertig', 'Steiner'])
  })

  it('…and within one of those groups the Auftrag still orders the alphabet, with none last', () => {
    mount({ order: 'auftrag', trupps: [
      plain('t1', 'Ohne'),
      plain('t2', 'Verkehr', { auftrag: 'verkehr' }),
      plain('t3', 'Sanität', { auftrag: 'sanitaet' }),
    ] })
    expect(names()).toEqual(['Sanität', 'Verkehr', 'Ohne'])
  })
})

/* ⚠️ Reversed on 03.09., and it still holds: the Art must never restructure the FORM, only which
   * fields «Luft & Funk» contains. The tap drops the Druck row from the section below it —
   * ordinary form behaviour — and never moves which section is open or what the others hold. */
  it('keeps the same flat form for a Trupp without Atemschutz, minus the Druck', () => {
    vi.mocked(useIsPhone).mockReturnValue(true)
    mount({ trupps: [aktivTrupp()] })
    fireEvent.click(firstBtn(az.newTrupp))
    fireEvent.click(screen.getByRole('radio', { name: az.kindPlain }))
    // the form is unchanged by the tap: chooser, Auftrag and Mannschaft all still standing
    expect(screen.getByRole('radiogroup', { name: az.kindLabel })).toBeTruthy()
    expect(screen.getByText(az.auftragLabel)).toBeTruthy()
    expect(within(screen.getByRole('dialog')).getByText(az.sectionTeam)).toBeTruthy()
    // …and the Kanal row stands, minus the one a Verkehrstrupp has no cylinder for
    expect(kanalRow()).toBeTruthy()
    expect(screen.queryByText(az.pressureLabel)).toBeNull()
  })

  /* The «point at what blocks the save» path keys off the stack alone, so a plain Trupp gets the
   * same «Speichern» that opens the section holding the missing Gruppenführer instead of sitting
   * there doing nothing (02.09.). */
  it('opens the Mannschaft when a plain Trupp is saved without a Gruppenführer', () => {
    vi.mocked(useIsPhone).mockReturnValue(true)
    const createTrupp = vi.fn()
    mount({ trupps: [aktivTrupp()], createTrupp })
    fireEvent.click(firstBtn(az.newTrupp))
    fireEvent.click(screen.getByRole('radio', { name: az.kindPlain }))
    fireEvent.click(lastBtn(az.start))
    expect(createTrupp).not.toHaveBeenCalled()
    // flat form: the block RINGS the Mannschaft instead of opening a section
    expect(document.querySelector(`.${s.formFlash}`)?.textContent).toContain(az.sectionTeam)
  })

  /* ⚠️ The reason a save was refused belongs to the FORM, not to the app's toast lane (05.09.,
   * field feedback). That lane is pinned to the bottom of the VIEWPORT — on this sheet a pill
   * hanging in the form's own empty space above the footer, and a pill with `pointer-events:
   * auto` sitting over whatever field happens to be under it. On a phone that field is the
   * Auftrag «Art» chips, which is the whole of the «needs two taps to change the Art» defect. */
  it('says why the save was refused in the sheet itself, on the footer’s own edge', () => {
    vi.mocked(useIsPhone).mockReturnValue(true)
    const createTrupp = vi.fn()
    mount({ trupps: [aktivTrupp()], createTrupp })
    fireEvent.click(firstBtn(az.newTrupp))
    fireEvent.click(lastBtn(az.start))
    expect(createTrupp).not.toHaveBeenCalled()
    const bar = document.querySelector(`.${s.formBlocked}`)
    expect(bar?.textContent).toContain(az.saveBlockedTeam)
    // …and it is the last row before the actions it is about — not floating anywhere else
    expect(bar?.nextElementSibling?.className).toContain(s.modalFoot)
  })

  // the owner's iPhone, 26.09.2026: the footer ran into the display's rounded corners — it is the
  // shared sheet footer now, whose one rule pays the safe area (overlays/SheetFoot, 15-mobile.css)
  it('draws its footer as the shared sheet footer, so it pays the phone’s safe area', () => {
    vi.mocked(useIsPhone).mockReturnValue(true)
    mount({ trupps: [aktivTrupp()] })
    fireEvent.click(firstBtn(az.newTrupp))
    const foot = document.querySelector(`.${s.modalFoot}`)!
    expect(foot.classList.contains('ui-sheet-foot')).toBe(true)
    expect(foot.closest('[role="dialog"]')).toBeTruthy()
    // …and the form's own module no longer insets it on a phone — the rule that tried never
    // applied (a later base rule of the same weight won), and a working copy would drift
    const css = readFileSync(`${process.cwd()}/src/components/Atemschutz.module.css`, 'utf8')
    expect(css).not.toMatch(/\.modalFoot \{[^}]*(padding-inline|padding-bottom|safe-area)/)
  })

  /* ⚠️ «X ist bereits in einem anderen Trupp» is fixed in the MANNSCHAFT and nowhere else
   * (05.09.): the sentence names a person, and taking them out of this Trupp is section 1's job.
   * It used to be an inert <p> that only rang itself, leaving whichever section happened to be
   * open standing.
   * ⚠️ …and since 11.09. the warning carries the fix itself. Here the OTHER Trupp is aktiv, so
   * the action is withheld and the sentence says why — the jump is then the only door left. */
  it('sends the double-assignment warning to the Mannschaft — from the sentence and from the save', () => {
    vi.mocked(useIsPhone).mockReturnValue(true)
    const editTrupp = vi.fn()
    const shared = { ...aktivTrupp(), leaderPersonId: 'p1' }
    mount({ editTrupp, trupps: [
      shared,
      { ...aktivTrupp(), id: 'tr2', name: 'Meier', leaderPersonId: 'p1' },
    ] })
    fireEvent.click(screen.getAllByRole('button', { name: /Steiner/ })[0]) // the row → its card
    fireEvent.click(screen.getAllByRole('button', { name: az.cardMenu })[0])
    fireEvent.click(screen.getByRole('menuitem', { name: az.edit }))
    const warn = document.querySelector<HTMLElement>(`.${s.formWarn}`)!
    expect(warn.textContent).toContain(fillTemplate(az.assignedConflictDeployed, { name: 'Steiner' }))
    expect(screen.queryByRole('button', { name: az.assignedTransfer })).toBeNull()
    // flat form: the sentence RINGS the Mannschaft it is about
    fireEvent.click(warn.querySelector(`.${s.formWarnText}`)!)
    expect(document.querySelector(`.${s.formFlash}`)?.textContent).toContain(az.sectionTeam)
    // …and so does a blocked save, instead of only ringing the sentence
    fireEvent.click(screen.getByRole('button', { name: az.save }))
    expect(editTrupp).not.toHaveBeenCalled()
    expect(document.querySelector(`.${s.formFlash}`)?.textContent).toContain(az.sectionTeam)
  })

  /* ── The warning's own way out (11.09., user report) ────────────────────────────────────────
   * It named the obstacle and left the operator to throw this form away, find the other card,
   * edit it and start over. One tap now takes the person out of the Trupp that still holds them
   * — but ONLY out of one that is not out there: a crew whose Kontaktuhr is running is watched by
   * the Atemschutzüberwachung as exactly those people (lib/atemschutz · truppTransferState). */
  it('moves the person out of a Trupp that has not gone in yet — one tap, from the warning', () => {
    vi.mocked(useIsPhone).mockReturnValue(true)
    const transferOutOfTrupp = vi.fn(() => true)
    mount({ transferOutOfTrupp, trupps: [
      { ...aktivTrupp(), leaderPersonId: 'p1' },
      // the other card: registered at the Tafel, never eingerückt — nothing is being watched yet
      { ...aktivTrupp(), id: 'tr2', name: 'Meier', members: ['Frei'], status: 'angemeldet',
        entryTime: '', lastContactTime: '', readings: [], leaderPersonId: 'p9', memberPersonIds: ['p1'] },
    ] })
    fireEvent.click(screen.getAllByRole('button', { name: /Steiner/ })[0])
    fireEvent.click(screen.getAllByRole('button', { name: az.cardMenu })[0])
    fireEvent.click(screen.getByRole('menuitem', { name: az.edit }))
    const warn = document.querySelector<HTMLElement>(`.${s.formWarn}`)!
    expect(warn.textContent).toContain(fillTemplate(az.assignedConflict, { name: 'Steiner' }))
    fireEvent.click(screen.getByRole('button', { name: az.assignedTransfer }))
    // …out of THAT Trupp, naming the one being formed here so its Verlauf row can say where to
    expect(transferOutOfTrupp).toHaveBeenCalledWith('tr2', 'p1', 'Steiner')
  })

  /* ONE placeholder for every Auftrag (03.09.): «z. B. 2OG links» proposed a storey to a
   * Verkehrstrupp, so the generic sentence is now the only one. */
  it('uses the same Auftrag/Ziel placeholder whichever Auftrag is picked', () => {
    mount({ trupps: [aktivTrupp()] }) // tablet: one screen, everything is on it
    fireEvent.click(firstBtn(az.newTrupp))
    const ziel = () => screen.getByPlaceholderText(az.zielPlaceholder)
    expect(ziel()).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: az.auftragLabels.anderes }))
    expect(ziel()).toBeTruthy()
  })
})
