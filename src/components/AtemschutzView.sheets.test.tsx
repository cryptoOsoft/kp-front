// @vitest-environment jsdom
// The mini sheets (Druck, Kontakt, Status …) and the handed-over board (the Atemschutz-Link,
// «lite»), on the tablet and in the phone's focus mode. Shared setup: AtemschutzView.setup.tsx.
import { useState } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { AtemschutzView } from './AtemschutzView'
import { useIsPhone } from '../lib/useIsPhone'
import s from './Atemschutz.module.css'
import { appConfig } from '../config/appConfig'
import { Overlays } from '../lib/ui'
import { atemschutzDoctrine } from '../lib/deploymentConfig'
import * as deploymentConfig from '../lib/deploymentConfig'
import { fillTemplate } from '../lib/format'
import type { Trupp } from '../types'
import { registerAtemschutzViewHooks, az, firstBtn, lastBtn, dz, iso, aktivTrupp, noop, propsFor, mount, typeGuest, pressureRow, kanalRow, pickAuftrag } from './AtemschutzView.setup'

vi.mock('../lib/useIsPhone', async (original) => ({ ...await original<typeof import('../lib/useIsPhone')>(), useIsPhone: vi.fn(() => false) }))
registerAtemschutzViewHooks()

/* ── The mini sheets (26.09.2026, phone card slim-down — components/TruppSheets) ────────────────
 * One fact of the card, one short sheet, and every save goes through `editTrupp` with the Trupp as
 * it stands and only that sheet's fields changed (lib/truppQuickEdit, tested there). Here: the
 * doors, the one-tap Kanal, the Auftrag save, and the Leitung question the form's save asks. */
describe('the mini sheets', () => {
  // a station's Handfunk range (the shipped ceiling is a free 9999, which is the stepper's case)
  const real = atemschutzDoctrine()
  beforeEach(() => { vi.spyOn(deploymentConfig, 'atemschutzDoctrine').mockImplementation(() => ({ ...real, funkkanalMin: 1, funkkanalMax: 16 })) })
  afterEach(() => { vi.restoreAllMocks(); vi.mocked(useIsPhone).mockReturnValue(false) })
  const withFacts = (): Trupp => ({ ...aktivTrupp(), no: 2, auftrag: 'loeschen', ziel: 'Test', funkkanal: 11, lineNo: 1 })

  it('«Kanal 11» opens the pad on 11; one tap writes the channel and closes', async () => {
    const editTrupp = vi.fn()
    mount({ trupps: [withFacts()], editTrupp })
    fireEvent.click(screen.getByRole('button', { name: `${az.funkkanalUnit} 11` }))
    const sheet = screen.getByRole('dialog', { name: new RegExp(`^${az.funkkanalUnit}`) })
    // whose sheet: the name and the number under the title
    expect(sheet.textContent).toContain(`Steiner · ${fillTemplate(az.quickTrupp, { no: 2 })}`)
    expect(within(sheet).getByRole('button', { name: '11' }).getAttribute('aria-pressed')).toBe('true')
    fireEvent.click(within(sheet).getByRole('button', { name: '7' }))
    await waitFor(() => expect(screen.queryByRole('dialog', { name: new RegExp(`^${az.funkkanalUnit}`) })).toBeNull())
    expect(editTrupp).toHaveBeenCalledTimes(1)
    expect(editTrupp).toHaveBeenCalledWith('tr1', expect.objectContaining({ funkkanal: 7, auftrag: 'loeschen', ziel: 'Test', lineNo: 1, pressure: 300, name: 'Steiner', members: ['Huber'] }))
  })

  it('the same channel again writes nothing and just closes', async () => {
    const editTrupp = vi.fn()
    mount({ trupps: [withFacts()], editTrupp })
    fireEvent.click(screen.getByRole('button', { name: `${az.funkkanalUnit} 11` }))
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: '11' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    expect(editTrupp).not.toHaveBeenCalled()
  })

  it('the Auftrag chip opens the sheet on the stored values; Speichern writes Auftrag, Ziel and Leitung together', async () => {
    const editTrupp = vi.fn()
    mount({ trupps: [withFacts()], editTrupp, leitungOptions: () => [{ no: 1, onPlan: false }, { no: 2, onPlan: true }] })
    fireEvent.click(screen.getByRole('button', { name: 'Löschen · Test' }))
    const sheet = screen.getByRole('dialog', { name: new RegExp(`^${az.editFieldLabels.auftrag}`) })
    expect(within(sheet).getByRole('button', { name: 'Löschen' }).getAttribute('aria-pressed')).toBe('true')
    expect((within(sheet).getByLabelText(az.editFieldLabels.ziel) as HTMLInputElement).value).toBe('Test')
    expect(within(sheet).getByRole('button', { name: fillTemplate(az.lineChip, { n: 1 }) }).getAttribute('aria-pressed')).toBe('true')
    fireEvent.click(within(sheet).getByRole('button', { name: 'Retten' }))
    fireEvent.change(within(sheet).getByLabelText(az.editFieldLabels.ziel), { target: { value: '2. OG' } })
    fireEvent.click(within(sheet).getByRole('button', { name: `${fillTemplate(az.lineChip, { n: 2 })} · P` }))
    fireEvent.click(within(sheet).getByRole('button', { name: az.save }))
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    expect(editTrupp).toHaveBeenCalledWith('tr1', expect.objectContaining({ auftrag: 'retten', ziel: '2. OG', lineNo: 2, funkkanal: 11, pressure: 300 }))
  })

  it('«keine» lets the Leitung go — absent, never an empty number', async () => {
    const editTrupp = vi.fn()
    mount({ trupps: [withFacts()], editTrupp })
    fireEvent.click(screen.getByRole('button', { name: 'Löschen · Test' }))
    const sheet = screen.getByRole('dialog')
    fireEvent.click(within(sheet).getByRole('button', { name: az.lineNone }))
    fireEvent.click(within(sheet).getByRole('button', { name: az.save }))
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    expect(editTrupp.mock.calls[0][1].lineNo).toBeUndefined()
  })

  /* the one question the form's save asks in front of a Leitung is asked here too — ONE helper
   * (AtemschutzView · confirmLineTake), so the sheet is not a way around it */
  it('a Leitung another Trupp is on asks first; «Übernehmen» unlinks the other and writes, cancel keeps the sheet open', async () => {
    render(<Overlays />)
    const editTrupp = vi.fn(), unlinkTruppLine = vi.fn()
    mount({
      trupps: [withFacts(), { ...aktivTrupp(), id: 'tr2', name: 'Other Olga', lineNo: 3 }],
      editTrupp, unlinkTruppLine, leitungOptions: () => [{ no: 3, onPlan: false, takenBy: 'Other Olga' }],
    })
    fireEvent.click(screen.getAllByRole('button', { name: /^Löschen/ })[0])
    const sheet = screen.getByRole('dialog', { name: new RegExp(`^${az.editFieldLabels.auftrag}`) })
    fireEvent.click(within(sheet).getByRole('button', { name: new RegExp(`^${fillTemplate(az.lineChip, { n: 3 })}`) }))
    fireEvent.click(within(sheet).getByRole('button', { name: az.save }))
    let ask = await screen.findByRole('alertdialog')
    fireEvent.click(within(ask).getByRole('button', { name: appConfig.copy.cancel }))
    await waitFor(() => expect(screen.queryByRole('alertdialog')).toBeNull())
    expect(editTrupp).not.toHaveBeenCalled()
    expect(screen.getByRole('dialog', { name: new RegExp(`^${az.editFieldLabels.auftrag}`) })).toBeTruthy()
    fireEvent.click(within(sheet).getByRole('button', { name: az.save }))
    ask = await screen.findByRole('alertdialog')
    fireEvent.click(within(ask).getByRole('button', { name: az.lineTakeConfirm }))
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    expect(unlinkTruppLine).toHaveBeenCalledWith('tr2')
    expect(editTrupp).toHaveBeenCalledWith('tr1', expect.objectContaining({ lineNo: 3 }))
  })

  /* ③ — the opened PHONE card's facts are chips (TruppCard · facts): each a door, the ⋯ last, the
   * missing Auftrag a dashed «+ Auftrag», and nothing for a missing Leitung. */
  it('lays the phone card\'s facts out as chips — crew · Auftrag · Ziel · Kanal · Kürzel · ⋯ — each a door', () => {
    vi.mocked(useIsPhone).mockReturnValue(true)
    const editTrupp = vi.fn()
    mount({ trupps: [{ ...withFacts(), equipment: ['wbk'] }], editTrupp })
    fireEvent.click(document.querySelector(`.${s.trow}`)!)
    const card = document.querySelector('[data-az-open]') as HTMLElement
    const chips = [...card.querySelectorAll(`.${s.facts} > *`)]
    expect(chips.map((c) => c.textContent)).toEqual(['Huber', 'Löschen · Test', fillTemplate(az.lineChip, { n: 1 }), `${az.funkkanalUnit} 11`, 'WBK'])
    // every chip is a button; the ⋯ is NOT a chip — it ends the foot line (29.09.2026, owner pick B)
    expect(chips.every((c) => c.tagName === 'BUTTON')).toBe(true)
    expect(card.querySelector(`.${s.vfootRow}`)!.lastElementChild!.getAttribute('aria-label')).toBe(az.cardMenu)
    // no colour, no labels: the Kennzeile's sentence classes are not in the strip
    expect(card.querySelector(`.${s.kenn}`)).toBeNull()
    // the Kanal chip opens the pad, the Auftrag chip the Auftrag sheet
    fireEvent.click(within(card).getByRole('button', { name: `${az.funkkanalUnit} 11` }))
    expect(screen.getByRole('dialog', { name: new RegExp(`^${az.funkkanalUnit}`) })).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: az.cancel }))
    fireEvent.click(within(card).getByRole('button', { name: 'Löschen · Test' }))
    expect(screen.getByRole('dialog', { name: new RegExp(`^${az.editFieldLabels.auftrag}`) })).toBeTruthy()
  })

  it('shows the missing Auftrag as the one dashed chip, and no chip for a missing Leitung', () => {
    vi.mocked(useIsPhone).mockReturnValue(true)
    mount({ trupps: [{ ...withFacts(), auftrag: undefined, ziel: undefined, lineNo: undefined }] })
    fireEvent.click(document.querySelector(`.${s.trow}`)!)
    const card = document.querySelector('[data-az-open]') as HTMLElement
    const add = within(card).getByRole('button', { name: az.auftragAdd })
    expect(add.className).toContain(s.factDash)
    expect(within(card).queryByText(new RegExp(`^${az.lineField}`))).toBeNull()
    fireEvent.click(add)
    expect(screen.getByRole('dialog', { name: new RegExp(`^${az.editFieldLabels.auftrag}`) })).toBeTruthy()
  })

  it('the drawn Leitung\'s chip still jumps to the hose; an undrawn one opens the Auftrag sheet', () => {
    vi.mocked(useIsPhone).mockReturnValue(true)
    const showTruppLine = vi.fn()
    mount({ trupps: [withFacts()], showTruppLine, truppsWithLine: new Set(['tr1']) })
    fireEvent.click(document.querySelector(`.${s.trow}`)!)
    fireEvent.click(within(document.querySelector('[data-az-open]') as HTMLElement).getByRole('button', { name: fillTemplate(az.lineChip, { n: 1 }) }))
    expect(showTruppLine).toHaveBeenCalledWith('tr1')
    expect(screen.queryByRole('dialog')).toBeNull()
    cleanup()
    mount({ trupps: [withFacts()] })
    fireEvent.click(document.querySelector(`.${s.trow}`)!)
    fireEvent.click(within(document.querySelector('[data-az-open]') as HTMLElement).getByRole('button', { name: fillTemplate(az.lineChip, { n: 1 }) }))
    expect(screen.getByRole('dialog', { name: new RegExp(`^${az.editFieldLabels.auftrag}`) })).toBeTruthy()
  })

  /* ④ — the Trupp sheet: the form's crew picker and the Ausrüstung toggles in one short sheet,
   * saved through editTrupp with the crew and the Ausrüstung replaced and nothing else touched. */
  it('the crew chip opens the Trupp sheet; ✕ on a member and Speichern write the smaller crew', async () => {
    vi.mocked(useIsPhone).mockReturnValue(true)
    const editTrupp = vi.fn()
    mount({ trupps: [{ ...withFacts(), equipment: ['wbk'] }], editTrupp })
    fireEvent.click(document.querySelector(`.${s.trow}`)!)
    fireEvent.click(within(document.querySelector('[data-az-open]') as HTMLElement).getByRole('button', { name: 'Huber' }))
    // the question is the title, whose the line under it (T5, 29.09.2026) — like its three siblings
    const sheet = screen.getByRole('dialog', { name: new RegExp(`^${az.editFieldLabels.crew} · Steiner`) })
    expect(within(sheet).getByRole('heading').textContent).toBe(`${az.editFieldLabels.crew}Steiner · ${fillTemplate(az.quickTrupp, { no: 2 })}`)
    expect(within(sheet).getByText(az.equipmentLabel)).toBeTruthy()
    fireEvent.click(within(sheet).getByRole('button', { name: fillTemplate(az.teamRemove, { name: 'Huber' }) }))
    fireEvent.click(within(sheet).getByRole('button', { name: az.save }))
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    expect(editTrupp).toHaveBeenCalledWith('tr1', expect.objectContaining({ name: 'Steiner', members: undefined, equipment: ['wbk'], auftrag: 'loeschen', funkkanal: 11, pressure: 300 }))
  })

  it('ticking the Ausrüstung writes the ids in the station\'s order, and none when none', async () => {
    vi.mocked(useIsPhone).mockReturnValue(true)
    const editTrupp = vi.fn()
    mount({ trupps: [{ ...withFacts(), equipment: ['wbk'] }], editTrupp })
    fireEvent.click(document.querySelector(`.${s.trow}`)!)
    fireEvent.click(within(document.querySelector('[data-az-open]') as HTMLElement).getByRole('button', { name: 'WBK' }))
    const sheet = screen.getByRole('dialog')
    const box = (label: string) => within(sheet).getByRole('checkbox', { name: label })
    expect(box('WBK').getAttribute('aria-checked')).toBe('true')
    fireEvent.click(box('Retthaube'))
    fireEvent.click(within(sheet).getByRole('button', { name: az.save }))
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    expect(editTrupp.mock.calls[0][1].equipment).toEqual(['retthaube', 'wbk'])
    expect(editTrupp.mock.calls[0][1].members).toEqual(['Huber'])
  })

  it('a Gast typed into the sheet is filed at the save, and the id comes back into the Trupp', async () => {
    vi.mocked(useIsPhone).mockReturnValue(true)
    // no roster in this fixture, so every bare name is a Gast — Steiner and Huber file too, as
    // they would from the form (fileGuestSlots is the same helper)
    const editTrupp = vi.fn(), onAddGuest = vi.fn((name: string) => `g:${name}`)
    mount({ trupps: [withFacts()], editTrupp, onAddGuest })
    fireEvent.click(document.querySelector(`.${s.trow}`)!)
    fireEvent.click(within(document.querySelector('[data-az-open]') as HTMLElement).getByRole('button', { name: 'Huber' }))
    const sheet = screen.getByRole('dialog')
    fireEvent.change(within(sheet).getByLabelText(az.teamSearchPlaceholder), { target: { value: 'Neu Nora' } })
    fireEvent.click(within(sheet).getByRole('option', { name: fillTemplate(az.teamGuestAdd, { name: 'Neu Nora' }) }))
    expect(onAddGuest).not.toHaveBeenCalled()
    fireEvent.click(within(sheet).getByRole('button', { name: az.save }))
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    expect(onAddGuest).toHaveBeenCalledWith('Neu Nora')
    expect(editTrupp).toHaveBeenCalledWith('tr1', expect.objectContaining({
      name: 'Steiner', members: ['Huber', 'Neu Nora'], leaderPersonId: 'g:Steiner', memberPersonIds: ['g:Huber', 'g:Neu Nora'] }))
  })

  /* ⑤ — the ⋯ on the phone: the jumps, then «Bearbeiten» as the last resort
   * above the rule; «Entfernen» stays last and red. The tablet keeps «Bearbeiten» first. */
  // …and on the tablet too since 29.09.2026: it wears the same chips, so it has the same doors
  it('puts «Bearbeiten» last before the rule — on the phone and on the tablet', async () => {
    vi.mocked(useIsPhone).mockReturnValue(true)
    mount({ trupps: [{ ...withFacts(), entityId: 'e1' }], truppsWithLine: new Set(['tr1']) })
    fireEvent.click(document.querySelector(`.${s.trow}`)!)
    fireEvent.click(within(document.querySelector('[data-az-open]') as HTMLElement).getByRole('button', { name: az.cardMenu }))
    const items = (await screen.findAllByRole('menuitem')).map((m) => m.textContent)
    expect(items).toEqual([az.showOnMap, az.lineShow, az.edit, az.remove])
    cleanup()
    vi.mocked(useIsPhone).mockReturnValue(false)
    mount({ trupps: [{ ...withFacts(), entityId: 'e1' }], truppsWithLine: new Set(['tr1']) })
    fireEvent.click(screen.getByRole('button', { name: az.cardMenu }))
    expect((await screen.findAllByRole('menuitem')).map((m) => m.textContent)).toEqual([az.showOnMap, az.lineShow, az.edit, az.remove])
  })

  it('a viewer has no doors: the facts are plain text', () => {
    mount({ trupps: [withFacts()], canEdit: false })
    expect(screen.queryByRole('button', { name: `${az.funkkanalUnit} 11` })).toBeNull()
    expect(screen.getByText(`${az.funkkanalUnit} 11`)).toBeTruthy()
  })
})

// «Tafel pur» — the board handed to somebody's own phone through an Atemschutz-Link. The rule
// worth pinning is the one that keeps it honest: nothing on it may point at a surface that
// session cannot reach, and the one fact it otherwise could not say — WHICH Einsatz — is said.
describe('the handed-over board (lite)', () => {
  const lite = { subtitle: 'Brand · Hauptstrasse 12, Oberwil' }

  // ⚠️ The second header line exists ONLY here. In the full app it used to carry a sentence about
  // what the board is for («Lückenlose Überwachung jedes Atemschutztrupps») — a claim the operator
  // standing at the board has already made — and it was dropped on 04.09.
  it('names the Einsatz on the line the full app does not have at all', () => {
    mount({ lite })
    expect(screen.getByText(lite.subtitle)).toBeTruthy()

    cleanup()
    mount()
    expect(document.querySelector('header p')).toBeNull()
  })

  it('drops Platzieren, Leitung and the order menu — and keeps Kontakt and Bearbeiten', async () => {
    mount({ lite, onOrder: noop, trupps: [aktivTrupp(), { ...aktivTrupp(), id: 'tr2', name: 'Meier' }] })
    expect(screen.queryByRole('button', { name: az.orderLabel })).toBeNull()
    // …and no «Abmelden» (02.09.): the link owns no login on this phone, and the button that
    // stood beside the bell ended the phone's own one (lib/linkMode).
    expect(screen.queryByRole('button', { name: appConfig.copy.incidentSwitcher.logout })).toBeNull()
    expect(screen.getAllByRole('button', { name: az.actContact }).length).toBe(2)
    // the secondary controls are one ⋯ per card now — the rule about what it may offer is the same
    expect(screen.getAllByRole('button', { name: az.cardMenu }).length).toBe(2)
    for (const trigger of screen.getAllByRole('button', { name: az.cardMenu })) {
      fireEvent.click(trigger)
      expect(await screen.findByRole('menuitem', { name: az.edit })).toBeTruthy()
      expect(screen.queryByRole('menuitem', { name: az.place })).toBeNull()
      fireEvent.keyDown(document.activeElement ?? document.body, { key: 'Escape' })
    }
  })

  it('offers «Überwachung abgeben» only where a door was handed in', () => {
    mount()
    expect(screen.queryByRole('button', { name: az.shareLink })).toBeNull()
    cleanup()
    const share = vi.fn()
    mount({ onShareLink: share })
    fireEvent.click(screen.getByRole('button', { name: az.shareLink }))
    expect(share).toHaveBeenCalled()
  })

  // the button's whole «on» state: a link exists. Nothing else — a device counter was dropped.
  it('says a link is live rather than claiming what the press would do', () => {
    mount({ onShareLink: noop, shareLinkActive: true })
    expect(screen.getByRole('button', { name: az.shareLinkOn })).toBeTruthy()
  })
})

// The same board on a PHONE: one tab per Trupp in a strip, one Trupp filling the screen, and a
// tap on a tab is what decides which — not a scroll.
describe('the handed-over board on a phone (focus mode)', () => {
  afterEach(() => { vi.mocked(useIsPhone).mockReturnValue(false) })
  it('shows a tab per Trupp and exactly one card, and a tab picks its Trupp', () => {
    vi.mocked(useIsPhone).mockReturnValue(true)
    mount({ lite: { subtitle: 'Brand · Hauptstrasse 12' }, trupps: [aktivTrupp(), { ...aktivTrupp(), id: 'tr2', name: 'Meier' }] })
    expect(screen.getAllByRole('tab')).toHaveLength(2)
    expect(document.querySelectorAll(`.${s.trowCard}`)).toHaveLength(1)
    fireEvent.click(screen.getByRole('tab', { name: /Meier/ }))
    expect(document.querySelector(`.${s.trowCard}`)?.textContent).toContain('Meier')
    // the strip's own «+ Trupp» is the door; no second one in the header
    expect(screen.getAllByRole('button', { name: az.newTrupp })).toHaveLength(1)
  })

  // UX sweep F6 (20.10.2026): a tab's tier was its tint and border alone — now a word for the
  // screen reader (the ⚠ went 30.10.2026, owner: «red and notfall is already enough»)
  it('says a tab\'s tier in a word for the screen reader, with no glyph', () => {
    vi.mocked(useIsPhone).mockReturnValue(true)
    mount({ lite: { subtitle: 'Brand · Hauptstrasse 12' }, trupps: [
      { ...aktivTrupp(), id: 'k', name: 'Calm Karl' },
      { ...aktivTrupp(), id: 'd', name: 'Due Dora', lastContactTime: iso(5.4 * 60_000) },
      { ...aktivTrupp(), id: 'o', name: 'Over Otto', lastContactTime: iso(8 * 60_000) },
    ] })
    const tab = (name: string) => screen.getByRole('tab', { name: new RegExp(name) })
    expect(tab('Calm Karl').querySelector('.sr-only')).toBeNull()
    expect(tab('Due Dora').querySelector('.sr-only')?.textContent).toBe(az.rowDue)
    expect(tab('Over Otto').querySelector('.sr-only')?.textContent).toBe(az.clockOverdue)
    for (const name of ['Calm Karl', 'Due Dora', 'Over Otto']) expect(tab(name).querySelector('use[href="#warn"]')).toBeNull()
  })

  /* ── The two-line head (Atemschutz-Link redesign, owner pick R1 on AB, 30.10.2026) ──────────
   * The Einsatz in full — its title, then «Adresse · ✓ 18:05» — where the one-row head of 09.09.
   * cut it at «Zimm…». The whole block is still the door: the mark rides INSIDE the trigger (a
   * sync indicator beside a door is an ornament a thumb aims at for nothing), its accessible name
   * stays the door's, and behind it stand the long voice and the link's way back. */
  it('names the Einsatz in full on two lines, the save stamp with it, and opens the rest', async () => {
    vi.mocked(useIsPhone).mockReturnValue(true)
    mount({
      lite: { subtitle: 'Brand PV Anlage · Amselstrasse 28', title: 'Brand PV Anlage', address: 'Amselstrasse 28, 4104 Oberwil' },
      trupps: [aktivTrupp()], syncStatus: 'synced', lastSyncedAt: Date.parse('2026-09-09T18:05:00'),
    })
    const opener = screen.getByRole('button', { name: az.headDetailOpen })
    expect(opener.querySelector('b')!.textContent).toBe('Brand PV Anlage')
    expect(opener.querySelector('small')!.textContent).toMatch(/^Amselstrasse 28, 4104 Oberwil.*18:05$/)
    expect(opener.querySelector('.az-syncline')).toBeTruthy()
    expect(opener.getAttribute('aria-label')).toBe(az.headDetailOpen)

    fireEvent.click(opener)
    await waitFor(() => {
      const panel = document.querySelector('.az-head-detail')!.textContent
      expect(panel).toMatch(/Gespeichert um.*18:05/)
      // the link hint is a line here now — the link board shows no toasts (sweep #23)
      expect(panel).toContain(az.linkReentryHint)
    })
  })

  /* ── The Notfall on the link board (R1, 30.10.2026: «red and notfall is already enough») ────
   * Its own tab: the page IS the Notfall — head «Notfall seit …», both clocks named, the
   * Sicherungstrupp act with «Anderer ⌄» — and no banner over it. Any other tab: a red strip
   * whose tap goes back to the Notfall's page. */
  it('makes the Notfall Trupp\'s page the Notfall, and leads back to it from every other tab', () => {
    vi.mocked(useIsPhone).mockReturnValue(true)
    const nf = az.notfall
    mount({ lite: { subtitle: 'Brand' }, trupps: [
      { ...aktivTrupp(), id: 'n', name: 'Nora Notfall', notfallAt: iso(30_000) },
      { ...aktivTrupp(), id: 'i', name: 'Ida Innen' },
      { ...aktivTrupp(), id: 'w', name: 'Willi Wache', auftrag: 'sichern', status: 'angemeldet', entryTime: '', lastContactTime: '', readings: [] },
    ] })
    // it opens on the Notfall Trupp (the most urgent crew inside)
    expect(document.querySelector(`.${s.nfPageName}`)!.textContent).toBe('Nora Notfall')
    expect(screen.getByText(nf.pageSince)).toBeTruthy()
    expect(screen.getByText(nf.pageContact)).toBeTruthy()
    expect(screen.getByRole('button', { name: new RegExp(nf.sitrDeploy) }).textContent).toContain('Willi Wache')
    expect(screen.getByRole('button', { name: nf.sitrOtherLabel })).toBeTruthy()
    expect(document.querySelector(`.${s.nfBanner}`)).toBeNull()

    fireEvent.click(screen.getByRole('tab', { name: /Ida Innen/ }))
    expect(document.querySelector(`.${s.nfPage}`)).toBeNull()
    const strip = document.querySelector(`.${s.nfStrip}`) as HTMLElement
    expect(strip.textContent).toContain(fillTemplate(nf.stripOne, { name: 'Nora Notfall' }))
    fireEvent.click(strip)
    expect(document.querySelector(`.${s.nfPageName}`)!.textContent).toBe('Nora Notfall')
    expect(document.querySelector(`.${s.nfStrip}`)).toBeNull()
  })

  // A new Trupp used to leave the PREVIOUS one selected on this board — the operator registered
  // the crew that needed it and was still looking at somebody else's card (09.09., field ask).
  it('selects a newly created Trupp — the operator lands on the crew they just made', async () => {
    vi.mocked(useIsPhone).mockReturnValue(true)
    function Board() {
      const [trupps, setTrupps] = useState<Trupp[]>([aktivTrupp()])
      return (
        <AtemschutzView {...propsFor({
          lite: { subtitle: 'Brand' }, trupps,
          createTrupp: (t: Trupp) => setTrupps((prev) => [...prev, t]),
        })} />
      )
    }
    render(<Board />)
    fireEvent.click(firstBtn(az.newTrupp))
    typeGuest('Meier Anna')
    pickAuftrag()
    fireEvent.click(lastBtn(az.start))
    await waitFor(() => {
      expect(screen.getByRole('tab', { name: /Meier Anna/ }).getAttribute('aria-selected')).toBe('true')
    })
    expect(document.querySelector(`.${s.trowCard}`)?.textContent).toContain('Meier Anna')
  })

  it('opens the Trupp form as ONE flat column — everything visible, Druck+Kanal as one row each', () => {
    vi.mocked(useIsPhone).mockReturnValue(true)
    const createTrupp = vi.fn()
    mount({ lite: { subtitle: 'Brand' }, trupps: [aktivTrupp()], createTrupp })
    fireEvent.click(firstBtn(az.newTrupp))
    // no sections since 08.09.: the Mannschaft, the Auftrag and the Druck / Kanal rows all
    // stand in one scroll — the rows read the station defaults
    expect(screen.getByLabelText(az.teamSearchPlaceholder)).toBeTruthy()
    expect(screen.getByText(az.auftragLabel)).toBeTruthy()
    expect(pressureRow().getAttribute('aria-label')).toBe(`${az.pressureLabel} ${fillTemplate(az.stackPressure, { n: dz.defaultPressureBar })}`)
    expect(kanalRow().getAttribute('aria-label')).toBe(`${az.funkkanalSection} ${dz.defaultFunkkanal}`)
    // …only the final submit is gated on a valid Trupp — `aria-disabled`, not the native
    // attribute, so a blocked tap still reaches attemptSubmit and can explain itself
    const submitBtn = lastBtn(az.start)
    expect(submitBtn.getAttribute('aria-disabled')).toBe('true')
    // the roster is still empty, so the blocked tap POINTS at the Mannschaft (ring + scroll)
    fireEvent.click(submitBtn)
    expect(createTrupp).not.toHaveBeenCalled()
    expect(document.querySelector(`.${s.formFlash}`)?.textContent).toContain(az.sectionTeam)
  })

  // ⚠️ NO second card for this board (03.09.). It had one — `cardBig`, with its own condensed
  // header and its own flattened clock — and a phone-only arrangement of a safety card is a
  // second thing to keep in step with the first. The card the phone gets here is the card the
  // tablet grid and the row list get; what makes it fit is that the card itself got denser.
  // ⚠️ SIX zones since 09.09., not seven: the Sockel folded into the Verlauf block under it
  // (`.metaLine` + the expander), so there is no standing look-up strip on the card any more —
  // at any width, on any board. That is the point of asserting the list rather than one class.
  it('uses the same card as every other board — the same zones, the tiles at the page\'s foot', () => {
    vi.mocked(useIsPhone).mockReturnValue(true)
    mount({ lite: { subtitle: 'Brand · Hauptstrasse 12' }, trupps: [aktivTrupp()], triggerNotfall: noop })
    const card = document.querySelector(`.${s.trowCard}`)!
    // ⚠️ the whole zone list, in order, and NOTHING besides — one card means one zone list, and
    // that is what a phone-only arrangement would break first.
    // Asserting «.cardHead exists» proves nothing: it exists on every card at every width.
    // the FIRST class of each child: the block also carries its tier, which is not the point here
    // ⚠️ since 29.09.2026 the card of EVERY board is the phone's opened row; on this page (31.10.2026,
    // «read at the top, tap at the bottom») the same zones read line · (state words) · note · facts ·
    // foot, and the tiles stand last — in the DOM, so the tab order is the visual one
    const first = (c: Element) => c.className.trim().split(/\s+/)[0]
    expect([...card.children].map(first).filter((c) => c !== s.stateLine)).toEqual([
      s.trowHead, s.noteZone, s.facts, s.vfoot, s.pageActs,
    ])
    // …Notfall leads the group, Rückzug | Raus under it, Druck | Kontakt lowest
    const group = card.lastElementChild as HTMLElement
    expect([...group.children].map(first)).toEqual([s.actZone, s.trowActs])
    expect(within(group).getAllByRole('button').map((b) => b.getAttribute('aria-label') ?? b.textContent)).toEqual([
      expect.stringContaining(az.notfall.act), az.actRueckzug, az.actExit, `${az.actPressure} 240 bar`, az.actContact,
    ])
    // Kontakt is still an in-card control, not a pinned screen-edge bar
    expect(card.querySelector(`.${s.kontaktBtn}`)).toBeTruthy()
    // the header's own row now carries just the Einsatz title (see the bottom-rail test below
    // for the dropped kicker and the relocated bell/«+ Trupp»)
    expect(document.querySelector(`.${s.headRow}`)).toBeTruthy()
  })

  // Maintainer correction (mock 03, 03.09.): the header sheds its kicker entirely, and the chip
  // strip + «+ Trupp» move into a bottom rail in the thumb zone — «status where the eyes land,
  // actions where the thumb lives». The card above stays top-aligned. A second review put the
  // bell BACK in the header (an earlier pass had tried it in the rail too) — only chips + the
  // compact «+» belong down there.
  it('drops the header kicker and moves the strip + «+ Trupp» into a bottom rail — the bell stays put', () => {
    vi.mocked(useIsPhone).mockReturnValue(true)
    mount({ lite: { subtitle: 'Brand · Hauptstrasse 12' }, trupps: [aktivTrupp(), { ...aktivTrupp(), id: 'tr2', name: 'Meier' }] })
    // the fixed «Atemschutzüberwachung» kicker is gone — only the Einsatz's own name remains
    expect(screen.queryByText(az.title)).toBeNull()
    expect(screen.getByText('Brand · Hauptstrasse 12')).toBeTruthy()
    const rail = document.querySelector(`.${s.bottomRail}`)
    expect(rail).toBeTruthy()
    // the strip (its tabs, unchanged) now lives INSIDE the rail, not above the card
    expect(rail?.querySelector(`.${s.strip}`)).toBeTruthy()
    expect(rail?.querySelectorAll(`.${s.tab}`).length).toBe(3) // 2 Trupps + «+ Trupp»
    // the bell stays in the header's own action group — NOT in the rail
    expect(document.querySelector(`.${s.headActs} .${s.muteBtn}`)).toBeTruthy()
    expect(rail?.querySelector(`.${s.muteBtn}`)).toBeNull()
    // ⚠️ «+ Trupp» is the LAST CELL OF THE STRIP'S OWN GRID (05.09.), not a 44px square in a
    // column beside it: same width and same row height as a Trupp chip, so it can neither
    // out-size them nor take the width their names need.
    const addBtn = firstBtn(az.newTrupp)
    expect(document.querySelector(`.${s.strip}`)?.lastElementChild).toBe(addBtn)
    expect(addBtn.classList.contains(s.tab)).toBe(true)
  })
})
