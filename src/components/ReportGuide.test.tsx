// @vitest-environment jsdom
//
// The strip under the Rapport's head (ReportPreflight · RpStrip, owner picks 14 «top strip» and
// 15B, 28.10.2026): after a jump from «n offen» it names the next open point down the page, and as
// soon as everything is recorded the Abschluss band names the next step – the PDF, then the close.
import { render, screen, cleanup, fireEvent, waitFor, within } from '@testing-library/react'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'

vi.mock('./KrokiFramingPanel', () => ({ KrokiFramingPanel: () => null }))
vi.mock('../lib/reportPdfDirect', async (orig) => ({
  ...(await orig<typeof import('../lib/reportPdfDirect')>()),
  downloadDirectReportPdf: vi.fn(async () => {}),
}))
vi.mock('../lib/ui', async (orig) => ({ ...(await orig<typeof import('../lib/ui')>()), toast: vi.fn() }))

import { ReportPreflight } from './ReportPreflight'
import { downloadDirectReportPdf } from '../lib/reportPdfDirect'
import { toast } from '../lib/ui'
import { appConfig } from '../config/appConfig'
import { fillTemplate } from '../lib/format'
import type { ReportMeta } from '../lib/workspace'

beforeAll(() => {
  window.matchMedia = ((q: string) => ({
    matches: false, media: q, onchange: null,
    addEventListener: () => {}, removeEventListener: () => {},
    addListener: () => {}, removeListener: () => {}, dispatchEvent: () => false,
  })) as unknown as typeof window.matchMedia
})
afterEach(cleanup)

const P = appConfig.copy.preflight
const A = appConfig.copy.abschluss
const START = new Date(2026, 9, 28, 2, 31)
const INCIDENT = {
  id: 'i1', title: 'Zimmerbrand', address: 'Schlossgasse 9', started_at: START.toISOString(), closed_at: null,
} as unknown as React.ComponentProps<typeof ReportPreflight>['incident']

const mount = (reportMeta: ReportMeta, counts = { attendanceCount: 0, mittelCount: 0 }) => render(
  <ReportPreflight incident={INCIDENT} reportMeta={reportMeta} events={[]}
    annotatedPlanCount={0} truppCount={0} mapContentCount={0} {...counts}
    onSaveMeta={vi.fn()} onComplete={vi.fn(async () => true)} />,
)
const strip = () => document.querySelector('.rp-strip') as HTMLElement | null

describe('the guide strip (#14)', () => {
  it('appears after a jump from «n offen», walks the page in order, and ✕ puts it away', async () => {
    mount({ alarmiertAt: START.toISOString() })
    expect(strip()).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: /\d+ offen/ }))
    const list = await screen.findByText(P.controlOpenHead)
    // page order: Kurzbericht first, «Zeiten» now called by its field, «Einsatzende»
    // the doors only – each row also carries its answer button since 10.11.2026 (EL phone sweep C6)
    const rows = [...(list.closest('.rp-control-open') as HTMLElement).querySelectorAll('.rp-control-step')].map((b) => b.textContent)
    expect(rows.slice(0, 5)).toEqual([A.steps.kurzbericht, A.steps.einsatzleiter, A.steps.kontaktperson, A.steps.zeiten, A.steps.rueckmeldung])
    expect(A.steps.zeiten).toBe(A.ende)
    fireEvent.click(within(list.closest('.rp-control-open') as HTMLElement).getByRole('button', { name: A.steps.kurzbericht }))
    expect(strip()!.textContent).toContain(P.guideNext)
    expect(strip()!.textContent).toContain(A.steps.einsatzleiter)
    expect(strip()!.textContent).toContain(fillTemplate(P.guideLeft, { n: rows.length }))
    fireEvent.click(within(strip()!).getByRole('button', { name: new RegExp(A.steps.einsatzleiter) }))
    expect(strip()!.textContent).toContain(A.steps.kontaktperson)
    fireEvent.click(within(strip()!).getByRole('button', { name: P.guideHide }))
    expect(strip()).toBeNull()
  })
})

describe('the Abschluss band, one step earlier (#15)', () => {
  const done: ReportMeta = {
    alarmiertAt: START.toISOString(), endedAt: new Date(2026, 9, 28, 3, 48).toISOString(), einsatzleiter: 'Widmer Céline',
    kontaktpersonNone: true, summary: 'Zimmerbrand gelöscht', rueckmeldungNone: true, mittelConfirmedNone: true,
  }
  it('names the PDF as the next step once everything is recorded – no «Später» on it', () => {
    mount(done, { attendanceCount: 1, mittelCount: 0 })
    expect(strip()!.textContent).toContain(P.bandReady)
    expect(within(strip()!).getByRole('button', { name: (n) => n.includes(P.bandPdf) })).toBeTruthy()
    expect(within(strip()!).queryByRole('button', { name: P.bandLater })).toBeNull()
  })
  it('turns into «Einsatz abschliessen» once the PDF exists', () => {
    mount({ ...done, reportMadeAt: new Date().toISOString() }, { attendanceCount: 1, mittelCount: 0 })
    expect(strip()!.textContent).toContain(P.bandDone)
    expect(within(strip()!).getByRole('button', { name: new RegExp(A.complete) })).toBeTruthy()
    expect(within(strip()!).getByRole('button', { name: P.bandLater })).toBeTruthy()
  })
  // #31 (30.10.2026): the band is the only announcement – no «Rapport erstellt» toast beside it –
  // so a fresh PDF brings back a band put away with «Später»
  it('comes back with a fresh PDF after «Später», and no toast says it twice', async () => {
    mount({ ...done, reportMadeAt: new Date().toISOString() }, { attendanceCount: 1, mittelCount: 0 })
    fireEvent.click(within(strip()!).getByRole('button', { name: P.bandLater }))
    expect(strip()).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: P.pdfFull }))
    await waitFor(() => expect(strip()?.textContent).toContain(P.bandDone))
    expect(downloadDirectReportPdf).toHaveBeenCalledOnce()
    expect(toast).not.toHaveBeenCalled()
  })
})
