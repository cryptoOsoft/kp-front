// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, renderHook, screen } from '@testing-library/react'
import { ReportPreflight } from './ReportPreflight'
import { NavRail } from './NavRail'
import { useAbschluss } from '../lib/useAbschluss'
import { openConflicts } from '../lib/attendanceConflict'
import { controlChipLabel } from '../lib/abschlussOpen'
import type { IncidentMeta } from '../lib/incidents'
import type { ReportMeta } from '../lib/workspace'
import type { AttendanceEntry, PlanDocument, TimelineEvent } from '../types'

// ONE number for «what is still open in the Rapport» (owner, staging 26.09.2026: «why is there 3
// in the bottom when 6 are open?»). The phone's «Rapport» badge (the tile read «Einsatz» then) showed the HEAD COUNT, and the
// workspace's own count (useAbschluss) left the unsettled Anwesenheits-Abweichungen out while the
// Rapport's chip counted them. Pinned end to end: the chip, the Abschluss's list, the badge and
// the chooser's row say the same number from the same inputs (lib/abschluss · abschlussFacts).

vi.mock('../lib/printRelay', async (orig) => ({
  ...(await orig<typeof import('../lib/printRelay')>()),
  fetchPrintStatus: vi.fn(async () => ({ available: false, online: false })),
  prewarmPrint: vi.fn(async () => {}),
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

const incident: IncidentMeta = {
  id: 'inc-1', divera_id: null, title: 'Brand klein', type: null, priority: null, address: null,
  lat: null, lng: null, status: 'open', source: 'manual', source_ref: null, auto_opened: false,
  started_at: '2026-09-26T08:00:00.000Z', closed_at: null, is_archived: false, is_exercise: false,
  report_done_at: null, workspace_rev: 1, created_by: null,
  created_at: '2026-09-26T08:00:00.000Z', updated_at: '2026-09-26T08:00:00.000Z',
}

const entry = (status: AttendanceEntry['status']): AttendanceEntry =>
  ({ status, displayNameSnapshot: 'Probst Tristan', checkedInAt: '2026-09-26T08:12:00Z' }) as AttendanceEntry
/** one unsettled Abweichung — open on the Rapport, and (before 26.09.2026) «done» everywhere else */
const conflict: TimelineEvent = {
  id: 'ac1', t: '10:15', at: '2026-09-26T08:15:02Z', icon: 'warn',
  text: 'Anwesenheit Probst Tristan: unterschiedliche Zeiten erfasst – bitte prüfen.',
  conflict: { op: 'raised', sig: 's1', key: 'p1', sides: [{ source: 'kp', entry: entry('present') }, { source: 'capture', entry: entry('left') }] },
} as TimelineEvent

const docs: PlanDocument[] = [{ id: 'modul1', code: 'Modul 1', title: 'Übersicht', subtitle: '', imageUrl: '', orientation: 'portrait' }]

// a Rapport with some of its Mindestangaben in, and one person on the Anwesenheit
const reportMeta = { einsatzleiter: 'Muster Hans', summary: 'Kleinbrand gelöscht.' } as ReportMeta
const attendance = { p1: entry('present') }

beforeEach(() => {
  window.matchMedia = ((q: string) => ({
    matches: false, media: q, onchange: null,
    addEventListener: () => {}, removeEventListener: () => {},
    addListener: () => {}, removeListener: () => {}, dispatchEvent: () => false,
  })) as unknown as typeof window.matchMedia
  Element.prototype.scrollTo = vi.fn() as unknown as Element['scrollTo']
})
afterEach(cleanup)

describe('the Rapport\'s «noch offen» is ONE number', () => {
  it('the chip, the Abschluss, the phone badge and the chooser row agree', async () => {
    // 1 · the workspace's count — what the Abschluss confirm, the archive row and the badge read
    const r = renderHook(() => useAbschluss({
      reportMeta, attendance, mittel: [], openConflictCount: openConflicts([conflict]).length, trupps: [],
      incidentMeta: { is_archived: false, status: 'offen', closed_at: null }, replayActive: false,
      media: { pendingCount: 0, flush: vi.fn(async () => {}) } as never,
      onCompleteRapport: vi.fn(async () => true),
      setMode: vi.fn(), setPanel: vi.fn(), setOfflineReadyOpen: vi.fn(), requestReportStep: vi.fn(),
    })).result.current
    const n = r.abschlussMissing.length
    expect(r.abschlussMissing).toContain('abweichungen')
    expect(n).toBeGreaterThan(0)

    // 2 · the phone's «Rapport» tile: the badge is that number, not the head count beside it
    render(<NavRail mode="rapport" onMode={vi.fn()} planDocs={docs} activePlanId="modul1" onSelectPlan={vi.fn()}
      fold openCount={n} presentCount={3} mittelCount={0} />)
    const tile = screen.getByRole('button', { name: /^Rapport/ })
    expect(tile.querySelector('.nav-count')?.textContent).toBe(String(n))
    expect(tile.getAttribute('aria-label')).toBe(`Rapport · ${controlChipLabel(n, 0)}`)

    // 3 · …and the chooser's Rapport row says it in the chip's own words; the head count is one
    // row further down, where it belongs
    fireEvent.click(tile)
    expect(screen.getByRole('option', { name: /^Rapport/ }).textContent).toContain(controlChipLabel(n, 0))
    expect(screen.getByRole('option', { name: /^Anwesenheit/ }).textContent).toContain('3 anwesend')
    cleanup()

    // 4 · the Rapport's own chip, from the same inputs
    render(
      <ReportPreflight
        incident={incident} reportMeta={reportMeta} events={[conflict]}
        annotatedPlanCount={0} truppCount={0} attendanceCount={Object.keys(attendance).length} mittelCount={0}
        onSaveMeta={() => {}}
      />,
    )
    await act(async () => {})
    expect(document.querySelector('.rp-state-label')?.textContent).toBe(controlChipLabel(n, 0))
  })

  it('a Rapport with nothing open puts no badge on the tile', () => {
    render(<NavRail mode="map" onMode={vi.fn()} planDocs={docs} activePlanId="modul1" onSelectPlan={vi.fn()} fold openCount={0} presentCount={12} />)
    expect(screen.getByRole('button', { name: /^Rapport/ }).querySelector('.nav-count')).toBeNull()
  })
})
