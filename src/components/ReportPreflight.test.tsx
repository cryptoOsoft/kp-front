// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { ReportPreflight } from './ReportPreflight'
import { Overlays } from '../lib/ui'
import { appConfig } from '../config/appConfig'
import type { IncidentMeta } from '../lib/incidents'
import { downloadDirectReportPdf } from '../lib/reportPdfDirect'
import type { Trupp } from '../types'

// The «Angaben fehlen noch» ask in front of the Rapport-PDF (14.09.): it used to list the open
// points as plain text, so the operator closed it and hunted for the section. Each point is now a
// row that goes there — the same jump the «noch offen» chip makes — and going there is NOT going
// ahead. Pinned: the rows are there, tapping one closes the ask, scrolls the sheet to the step and
// focuses its field, and no PDF was made.

vi.mock('../lib/reportPdfDirect', async (orig) => ({
  ...(await orig<typeof import('../lib/reportPdfDirect')>()),
  downloadDirectReportPdf: vi.fn(async () => {}),
}))
// no station printer here: the relay answers «not configured», so the head carries the PDF only
vi.mock('../lib/printRelay', async (orig) => ({
  ...(await orig<typeof import('../lib/printRelay')>()),
  fetchPrintStatus: vi.fn(async () => null),
}))
vi.mock('../lib/incidents', async (orig) => ({
  ...(await orig<typeof import('../lib/incidents')>()),
  verifyChain: vi.fn(async () => ({ intact: true, broken_at_seq: null, count: 0, head: null })),
  getIncident: vi.fn(async () => ({ text: '' })),
}))
vi.mock('../lib/replay', async (orig) => ({
  ...(await orig<typeof import('../lib/replay')>()),
  loadReplay: vi.fn(async () => ({ events: [] })),
}))

const A = appConfig.copy.abschluss
const P = appConfig.copy.preflight

const incident: IncidentMeta = {
  id: 'inc-1', divera_id: null, title: 'Brand klein', type: null, priority: null, address: null,
  lat: null, lng: null, status: 'open', source: 'manual', source_ref: null, auto_opened: false,
  started_at: '2026-09-14T08:00:00.000Z', closed_at: null, is_archived: false, is_exercise: false,
  report_done_at: null, workspace_rev: 1, created_by: null,
  created_at: '2026-09-14T08:00:00.000Z', updated_at: '2026-09-14T08:00:00.000Z',
}

const scrollTo = vi.fn()
beforeEach(() => {
  // useIsPhone → matchMedia, which jsdom does not implement; pinned to «not a phone»
  window.matchMedia = ((q: string) => ({
    matches: false, media: q, onchange: null,
    addEventListener: () => {}, removeEventListener: () => {},
    addListener: () => {}, removeListener: () => {}, dispatchEvent: () => false,
  })) as unknown as typeof window.matchMedia
  scrollTo.mockReset()
  vi.mocked(downloadDirectReportPdf).mockClear()
  // jsdom has no scrollTo on elements, and the jump measures a frame after switching tabs —
  // run the frames now so the whole jump lands inside the click
  Element.prototype.scrollTo = scrollTo as unknown as Element['scrollTo']
  vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => { cb(0); return 0 })
})
afterEach(() => { cleanup(); vi.unstubAllGlobals() })

describe('ReportPreflight · the PDF with missing Mindestangaben', () => {
  it('lists the open points as rows; tapping one closes the ask and jumps to the step without a PDF', async () => {
    render(
      <>
        <Overlays />
        <ReportPreflight
          incident={incident} reportMeta={{}} events={[]}
          annotatedPlanCount={0} truppCount={0} attendanceCount={1} mittelCount={1}
          onSaveMeta={() => {}}
        />
      </>,
    )
    // ⚠️ Settle, then query ONCE: no findBy/waitFor polling. The mocked loaders (chain, Einsatz
    // text) resolve at once; flushed inside act() the button is simply there. A failing role query
    // renders the whole document into its error before a second, successful one would run. There is no
    // race here, only CPU: ~0.5 s idle, the first role query in a worker alone ~0.2 s (jsdom's
    // getComputedStyle warming up). It crossed the 5 s limit (5.1 s) on a machine running several
    // full suites at once (25.09.2026); the dropped work is a third of it.
    await act(async () => {})
    const pdf = screen.getByRole('button', { name: P.pdfFull })
    await act(async () => { fireEvent.click(pdf) })

    const dialog = screen.getByRole('alertdialog')
    expect(dialog.textContent).toContain(appConfig.copy.preflight.exportIncompleteTitle)
    // the open point is a BUTTON in the list, not a bullet
    const row = within(dialog).getByRole('button', { name: A.steps.kurzbericht })
    expect(row.closest('.confirm-list')).toBeTruthy()

    await act(async () => { fireEvent.click(row) })

    expect(screen.queryByRole('alertdialog')).toBeNull()
    // the sheet scrolled to the step and its field holds the focus
    expect(scrollTo).toHaveBeenCalled()
    const target = document.querySelector<HTMLElement>('[data-step="kurzbericht"]')
    expect(target?.classList.contains('rp-flash')).toBe(true)
    expect(target?.contains(document.activeElement)).toBe(true)
    // going there is not going ahead
    expect(downloadDirectReportPdf).not.toHaveBeenCalled()
  })

  // 31.10.2026: the rows are the Abschluss confirm's (lib/abschlussOpen · abschlussSheet)
  it('answers a row in place, re-words itself, and the answer is ON the PDF made from that tap', async () => {
    const onSaveMeta = vi.fn()
    // everything recorded but the Material; the prop never catches up – the draft must not need it to
    const meta = { endedAt: '2026-09-14T10:00:00.000Z', einsatzleiter: 'Muster', kontaktpersonNone: true, summary: 'ok', rueckmeldungNone: true }
    render(
      <>
        <Overlays />
        <ReportPreflight
          incident={incident} reportMeta={meta} events={[]}
          annotatedPlanCount={0} truppCount={0} attendanceCount={1} mittelCount={0}
          onSaveMeta={onSaveMeta}
        />
      </>,
    )
    await act(async () => {})
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: P.pdfFull })) })
    const dialog = screen.getByRole('alertdialog')
    await act(async () => { fireEvent.click(within(dialog).getByRole('button', { name: A.fix.mittel })) })

    expect(onSaveMeta).toHaveBeenLastCalledWith(expect.objectContaining({ mittelConfirmedNone: true }))
    // still open, the row done, and the title no longer says anything is missing
    expect(dialog.textContent).toContain(P.exportCompleteTitle)
    expect(dialog.textContent).not.toContain(P.exportIncompleteMsg)
    await act(async () => { fireEvent.click(within(dialog).getByRole('button', { name: P.pdfFull })) })
    expect(vi.mocked(downloadDirectReportPdf).mock.calls[0][0].draft.meta).toMatchObject({ mittelConfirmedNone: true })
  })
})

// owner, 31.10.2026: the pencil went – the card is the pointer's target, its heading the keyboard's
describe('ReportPreflight · the Einsatzdaten card', () => {
  it('opens from the keyboard on its heading, even where the Rapport itself may not be written', async () => {
    const onEditDispatch = vi.fn()
    render(
      <ReportPreflight
        incident={incident} reportMeta={{}} events={[]} canEdit={false}
        annotatedPlanCount={0} truppCount={0} attendanceCount={1} mittelCount={1}
        onSaveMeta={() => {}} onEditDispatch={onEditDispatch}
      />,
    )
    await act(async () => {})
    const head = screen.getByRole('button', { name: P.fromDispatch })
    fireEvent.keyDown(head, { key: 'Enter' })
    fireEvent.keyDown(head, { key: ' ' })
    fireEvent.keyDown(head, { key: 'Tab' })
    expect(onEditDispatch).toHaveBeenCalledTimes(2)
    // a pointer tap anywhere on the card is ONE ask
    fireEvent.click(head)
    expect(onEditDispatch).toHaveBeenCalledTimes(3)
  })
})

describe('ReportPreflight · Auswertung default and operator choice', () => {
  const crew = (readings: Trupp['readings']): Trupp => ({
    id: 't1', no: 1, name: 'Meier Anna', entryPressureBar: 300,
    entryTime: '', lastContactTime: '', status: 'raus', readings,
  })
  const entry: Trupp['readings'] = [{ t: '2026-09-14T08:30:00.000Z', bar: 300, kind: 'entry' }]
  function sheet(id: string, trupps: Trupp[]) {
    return <ReportPreflight incident={{ ...incident, id }} reportMeta={{}} events={[]}
      annotatedPlanCount={0} truppCount={trupps.length} trupps={trupps}
      attendanceCount={0} mittelCount={0} onSaveMeta={() => {}} />
  }
  async function openMenu() {
    await act(async () => {})
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: appConfig.copy.preflight.printMenu })) })
    return screen.getByRole('menuitemcheckbox', { name: appConfig.copy.preflight.toggleAuswertung })
  }

  // ⚠️ UNTICKED whatever the record holds (owner, 10.10.2026) — it was seeded «ticked when a crew
  // went in under PA» on 09.10.; an internal debrief sheet is asked for, not handed out
  it.each([
    ['no-crew', []],
    ['standby', [crew([{ t: '2026-09-14T08:20:00.000Z', bar: 300, kind: 'registered' }])]],
    ['pa-entry', [crew(entry)]],
    ['basic-entry', [{ ...crew(entry), kind: 'einfach' as const }]],
  ] as const)('opens the print checkbox unticked for %s', async (id, trupps) => {
    render(sheet(`f7-default-${id}`, [...trupps]))
    expect((await openMenu()).getAttribute('aria-checked')).toBe('false')
  })

  it.each([1, 2])('keeps the operator\'s choice after %i tap(s) across a reopening with changed crew data', async (taps) => {
    const id = `f7-override-${taps}`
    const mounted = render(sheet(id, []))
    const toggle = await openMenu()
    for (let i = 0; i < taps; i++) await act(async () => { fireEvent.click(toggle) })
    const chosen = String(taps % 2 === 1)
    expect(toggle.getAttribute('aria-checked')).toBe(chosen)
    mounted.unmount()
    render(sheet(id, [crew(entry)]))
    expect((await openMenu()).getAttribute('aria-checked')).toBe(chosen)
  })
})

// staging r3, F10
describe('ReportPreflight · a CLOSED Einsatz', () => {
  // The Abschluss promises «Spätere Korrekturen bleiben möglich und erscheinen als Nachträge», and
  // the server takes Rapport writes after the close: the fields stay editable, and one line at
  // the top says the changes are Nachträge — no fields that look open and do nothing.
  it('stays editable and says so in one line at the top', async () => {
    const closed = { ...incident, is_archived: true, closed_at: '2026-09-14T10:00:00.000Z' }
    render(
      <ReportPreflight
        incident={closed} reportMeta={{}} events={[]} canEdit closedHint
        annotatedPlanCount={0} truppCount={0} attendanceCount={1} mittelCount={1}
        onSaveMeta={() => {}}
      />,
    )
    expect(await screen.findByText(appConfig.copy.archived.rapportClosedHint)).toBeTruthy()
    const fieldsets = [...document.querySelectorAll<HTMLFieldSetElement>('.report-fieldset')]
    expect(fieldsets.length).toBeGreaterThan(0)
    expect(fieldsets.every((f) => !f.disabled)).toBe(true)
  })
})
