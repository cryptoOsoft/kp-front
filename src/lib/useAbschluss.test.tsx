// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest'
import { renderHook } from '@testing-library/react'

vi.mock('./ui', () => ({ confirmDialog: vi.fn() }))
import { confirmDialog } from './ui'
import { useAbschluss } from './useAbschluss'
import type { ReportMeta } from './workspace'
import type { Trupp } from '../types'
import { appConfig } from '../config/appConfig'

// The Abschluss block (moved out of IncidentWorkspace 23.09.2026). The confirm → flush → handover
// order is pinned end to end in IncidentWorkspace.harness; these pin the derived values.
const args = (over: Partial<Parameters<typeof useAbschluss>[0]> = {}): Parameters<typeof useAbschluss>[0] => ({
  reportMeta: {} as ReportMeta, attendance: {}, mittel: [], openConflictCount: 0, trupps: [],
  incidentMeta: { is_archived: false, status: 'offen', closed_at: null }, replayActive: false,
  media: { pendingCount: 0, flush: vi.fn(async () => {}) } as never,
  onCompleteRapport: vi.fn(async () => true),
  setMode: vi.fn(), setPanel: vi.fn(), setOfflineReadyOpen: vi.fn(), requestReportStep: vi.fn(),
  ...over,
})

describe('useAbschluss', () => {
  it('a running Einsatz monitors and freezes nothing; replay and an archived one stop the alarm', () => {
    expect(renderHook(() => useAbschluss(args())).result.current).toMatchObject({ azMonitoring: true, azFrozenAt: undefined })
    expect(renderHook(() => useAbschluss(args({ replayActive: true }))).result.current.azMonitoring).toBe(false)
    const closed = renderHook(() => useAbschluss(args({
      incidentMeta: { is_archived: true, status: 'offen', closed_at: '2026-09-23T12:00:00Z' },
      reportMeta: { endedAt: '2026-09-23T03:30:00Z' } as ReportMeta,
    }))).result.current
    expect(closed.azMonitoring).toBe(false)
    // the Einsatzende, not the morning-after closed_at
    expect(closed.azFrozenAt).toBe(Date.parse('2026-09-23T03:30:00Z'))
  })

  // N3, 25.09.2026
  it('a close on ANOTHER device stops the alarm here, in place — no remount', () => {
    // App flips the live meta when the close is heard (useIncidentLifecycle · onIncidentClosed); the hook that
    // drives the AtemschutzAlarmHost must follow the SAME mount, not only the next open
    let meta: Parameters<typeof useAbschluss>[0]['incidentMeta'] = { is_archived: false, status: 'offen', closed_at: null }
    const h = renderHook(() => useAbschluss(args({ incidentMeta: meta })))
    expect(h.result.current.azMonitoring).toBe(true)
    meta = { is_archived: true, status: 'offen', closed_at: '2026-09-25T12:45:00Z' }
    h.rerender()
    expect(h.result.current.azMonitoring).toBe(false)
    expect(h.result.current.azFrozenAt).toBe(Date.parse('2026-09-25T12:45:00Z'))
    // …and «closed» is the backend's `is_open`: a status moved off the running ones ends it too
    expect(renderHook(() => useAbschluss(args({ incidentMeta: { is_archived: false, status: 'abgeschlossen', closed_at: null } }))).result.current.azMonitoring).toBe(false)
  })

  it('an empty Rapport misses its Mindestangaben; no Trupps means none still out', () => {
    const r = renderHook(() => useAbschluss(args())).result.current
    expect(r.abschlussMissing.length).toBeGreaterThan(0)
    expect(r.truppsStillOut).toBe(0)
  })

  // review of #235
  it('drains the Verlauf and audit outboxes BEFORE the handover', async () => {
    // after the archive they would be judged against a closed Einsatz
    vi.mocked(confirmDialog).mockResolvedValueOnce(true)
    const order: string[] = []
    const a = args({
      flushOutboxes: vi.fn(async () => { order.push('outboxes') }),
      onCompleteRapport: vi.fn(async () => { order.push('complete'); return true }),
    })
    const r = renderHook(() => useAbschluss(a)).result.current
    await expect(r.confirmAndComplete()).resolves.toBe(true)
    expect(order).toEqual(['outboxes', 'complete'])
  })

  // staging r6, F3
  it('marks the rows written between the confirm and the close as the Abschluss\'s own', async () => {
    vi.mocked(confirmDialog).mockResolvedValueOnce(true)
    const marks: boolean[] = []
    const seen: string[] = []
    const a = args({
      markClosing: (on) => { marks.push(on) },
      flushOutboxes: vi.fn(async () => { seen.push(`flush:${marks[marks.length - 1]}`) }),
      onCompleteRapport: vi.fn(async () => { seen.push(`close:${marks[marks.length - 1]}`); return true }),
    })
    const r = renderHook(() => useAbschluss(a)).result.current
    await expect(r.confirmAndComplete()).resolves.toBe(true)
    expect(seen).toEqual(['flush:true', 'close:true'])
    expect(marks).toEqual([true, false])
    // a failed close lifts the mark as well, and a cancelled confirm never sets it
    vi.mocked(confirmDialog).mockResolvedValueOnce(true)
    marks.length = 0
    const failing = renderHook(() => useAbschluss(args({
      markClosing: (on) => { marks.push(on) },
      onCompleteRapport: vi.fn(async () => { throw new Error('offline') }),
    }))).result.current
    await expect(failing.confirmAndComplete()).rejects.toThrow('offline')
    expect(marks).toEqual([true, false])
    vi.mocked(confirmDialog).mockResolvedValueOnce(false)
    marks.length = 0
    await renderHook(() => useAbschluss(args({ markClosing: (on) => { marks.push(on) } }))).result.current.confirmAndComplete()
    expect(marks).toEqual([])
  })

  // #227 × #235, staging integration
  it('the «beim Abschluss noch drin» rows are written under the close mark', async () => {
    // the crews question («trotzdem») and then the Abschluss confirm
    vi.mocked(confirmDialog).mockResolvedValueOnce(true).mockResolvedValueOnce(true)
    const marks: boolean[] = []
    const noted: boolean[] = []
    const inside = { id: 'in', no: 1, name: 'Tst', auftrag: 'loeschen', status: 'aktiv',
      entryTime: '2026-09-25T10:00:00Z', lastContactTime: '2026-09-25T10:04:00Z' } as unknown as Trupp
    const a = args({
      trupps: [inside],
      markClosing: (on) => { marks.push(on) },
      noteInsideAtClose: () => { noted.push(marks[marks.length - 1]) },
    })
    await renderHook(() => useAbschluss(a)).result.current.confirmAndComplete()
    // written, and written while the mark was on — so they print as part of the close, not a Nachtrag
    expect(noted).toEqual([true])
  })

  it('a cancelled confirm hands nothing over and drains nothing', async () => {
    vi.mocked(confirmDialog).mockResolvedValueOnce(false)
    const a = args()
    const r = renderHook(() => useAbschluss(a)).result.current
    await expect(r.confirmAndComplete()).resolves.toBe(false)
    expect(a.media.flush).not.toHaveBeenCalled()
    expect(a.onCompleteRapport).not.toHaveBeenCalled()
  })

  /* A Trupp still ANGEMELDET at the Abschluss (24.09.2026, D1 ⑦): the Sicherungstrupp stood
     «angemeldet» to the end of the Übung, and the confirm counted only the crews inside. */
  describe('a Trupp still angemeldet is asked about first', () => {
    const A = appConfig.copy.abschluss
    const sich: Trupp = {
      id: 't6', no: 6, name: 'Muster Leo', entryPressureBar: 280, entryTime: '', lastContactTime: '',
      status: 'angemeldet', auftrag: 'sichern',
    }

    it('«Als nicht eingesetzt schliessen» stands it down only AFTER the final «Abschliessen»', async () => {
      const ask = vi.mocked(confirmDialog)
      const order: string[] = []
      ask.mockReset()
        .mockImplementationOnce(async () => { order.push('ask registered'); return true })
        .mockImplementationOnce(async () => { order.push('ask abschluss'); return true })
      const standDownTrupps = vi.fn(() => { order.push('stand down') })
      const a = args({ trupps: [sich], standDownTrupps, onCompleteRapport: vi.fn(async () => { order.push('complete'); return true }) })
      const r = renderHook(() => useAbschluss(a)).result.current
      await expect(r.confirmAndComplete()).resolves.toBe(true)
      expect(ask.mock.calls[0][0]).toMatchObject({
        message: '1 Trupp noch angemeldet (#6 Muster Leo, Sicherungstrupp).',
        confirmLabel: A.registeredStandDown, altLabel: A.registeredToBoard,
        // «Zur Tafel» is the focused, filled answer — an Enter closes nothing
        safeAnswer: 'alt',
      })
      expect(standDownTrupps).toHaveBeenCalledWith(['t6'])
      expect(order).toEqual(['ask registered', 'ask abschluss', 'stand down', 'complete'])
      // every question of the chain carries a title (owner review 26.09.2026)
      expect(ask.mock.calls.map((c) => c[0].title)).toEqual([A.registeredTitle, A.confirmTitle])
    })

    it('«schliessen», then «Abbrechen» on the Abschluss, stands NOTHING down', async () => {
      const ask = vi.mocked(confirmDialog)
      ask.mockReset().mockResolvedValueOnce(true).mockResolvedValueOnce(false)
      const standDownTrupps = vi.fn()
      const a = args({ trupps: [sich], standDownTrupps })
      await expect(renderHook(() => useAbschluss(a)).result.current.confirmAndComplete()).resolves.toBe(false)
      expect(standDownTrupps).not.toHaveBeenCalled()
      expect(a.onCompleteRapport).not.toHaveBeenCalled()
    })

    it('«Zur Tafel» goes to the board and closes nothing', async () => {
      const ask = vi.mocked(confirmDialog)
      ask.mockReset().mockResolvedValueOnce('alt' as never)
      const standDownTrupps = vi.fn()
      const a = args({ trupps: [sich], standDownTrupps })
      const r = renderHook(() => useAbschluss(a)).result.current
      await expect(r.confirmAndComplete()).resolves.toBe(false)
      expect(a.setMode).toHaveBeenCalledWith('atemschutz')
      expect(standDownTrupps).not.toHaveBeenCalled()
      expect(a.onCompleteRapport).not.toHaveBeenCalled()
      expect(ask).toHaveBeenCalledTimes(1)
    })

    it('dismissing the question does nothing at all', async () => {
      const ask = vi.mocked(confirmDialog)
      ask.mockReset().mockResolvedValueOnce(false)
      const standDownTrupps = vi.fn()
      const a = args({ trupps: [sich], standDownTrupps })
      await expect(renderHook(() => useAbschluss(a)).result.current.confirmAndComplete()).resolves.toBe(false)
      expect(standDownTrupps).not.toHaveBeenCalled()
      expect(a.setMode).not.toHaveBeenCalled()
    })

    it('is not offered while a crew is still inside — the Abschluss asks about that one first', async () => {
      const ask = vi.mocked(confirmDialog)
      // «trotzdem» on the crews-inside question, then «Abbrechen» on the Abschluss itself
      ask.mockReset().mockResolvedValueOnce(true).mockResolvedValueOnce(false)
      const standDownTrupps = vi.fn()
      const a = args({
        trupps: [sich, { ...sich, id: 'in', no: 1, auftrag: 'loeschen', status: 'aktiv', entryTime: '2026-09-23T19:00:00Z' }],
        standDownTrupps,
      })
      await renderHook(() => useAbschluss(a)).result.current.confirmAndComplete()
      expect(ask).toHaveBeenCalledTimes(2)
      expect(ask.mock.calls[1][0].message).not.toContain('angemeldet')
      expect(standDownTrupps).not.toHaveBeenCalled()
    })

    it('asks nothing about a Trupp already out, a work squad at the vehicle, or a Reserve that was inside', async () => {
      const ask = vi.mocked(confirmDialog)
      ask.mockReset().mockResolvedValueOnce(false)
      const a = args({
        trupps: [
          { ...sich, id: 'out', status: 'raus' },
          { ...sich, id: 'plain', kind: 'einfach', entryPressureBar: 0 },
          { ...sich, id: 'reserve', readings: [{ t: '2026-09-23T19:00:00Z', bar: 300, kind: 'entry' }] },
        ],
        standDownTrupps: vi.fn(),
      })
      await renderHook(() => useAbschluss(a)).result.current.confirmAndComplete()
      expect(ask).toHaveBeenCalledTimes(1)
      expect(ask.mock.calls[0][0].message).not.toContain('angemeldet')
    })

    it('keeps ONE confirm across Trupp writes — the callback is not rebuilt per Kontakt', () => {
      const a = args({ trupps: [sich], standDownTrupps: vi.fn() })
      const { result, rerender } = renderHook((p: Parameters<typeof useAbschluss>[0]) => useAbschluss(p), { initialProps: a })
      const first = result.current.confirmAndComplete
      rerender({ ...a, trupps: [{ ...sich, lastContactTime: '2026-09-23T19:01:00Z' }] })
      expect(result.current.confirmAndComplete).toBe(first)
    })
  })

  /* Crews still INSIDE (staging walk-through 25.09.2026): their own first question, naming them,
     with «Zur Tafel» as the filled, focused answer — an Enter must never close over them. */
  describe('crews still inside are asked about first, by name', () => {
    const inside: Trupp = {
      id: 'in', no: 1, name: 'Muster Leo', members: ['Graf Eva'], entryPressureBar: 300,
      entryTime: '2026-09-25T10:00:00Z', lastContactTime: '2026-09-25T10:04:00Z', status: 'aktiv',
    }

    it('names them, focuses «Zur Tafel», and «Zur Tafel» closes nothing', async () => {
      const ask = vi.mocked(confirmDialog)
      ask.mockReset().mockResolvedValueOnce('alt' as never)
      const a = args({ trupps: [inside] })
      await expect(renderHook(() => useAbschluss(a)).result.current.confirmAndComplete()).resolves.toBe(false)
      expect(ask.mock.calls[0][0]).toMatchObject({
        message: '1 Trupp ist noch drin: Trupp 1 (Muster Leo / Graf Eva).',
        altLabel: appConfig.copy.abschluss.registeredToBoard,
        confirmLabel: appConfig.copy.abschluss.insideClose,
        safeAnswer: 'alt',
      })
      expect(a.setMode).toHaveBeenCalledWith('atemschutz')
      expect(a.onCompleteRapport).not.toHaveBeenCalled()
    })

    it('closing anyway goes on to the Abschluss itself — and writes no Austritt', async () => {
      const ask = vi.mocked(confirmDialog)
      ask.mockReset().mockResolvedValueOnce(true).mockResolvedValueOnce(true)
      const standDownTrupps = vi.fn()
      const a = args({ trupps: [inside], standDownTrupps })
      await expect(renderHook(() => useAbschluss(a)).result.current.confirmAndComplete()).resolves.toBe(true)
      expect(ask).toHaveBeenCalledTimes(2)
      expect(standDownTrupps).not.toHaveBeenCalled()
    })

    // staging r3 F4: closing over them wrote nothing, and the record ended with open sorties
    it('closing anyway writes «beim Abschluss noch drin» for each crew — before the handover, and only then', async () => {
      const ask = vi.mocked(confirmDialog)
      const order: string[] = []
      const noteInsideAtClose = vi.fn((ts: Trupp[]) => { order.push(`note ${ts.map((t) => t.id).join(',')}`) })
      ask.mockReset().mockResolvedValueOnce(true).mockResolvedValueOnce(true)
      const a = args({ trupps: [inside], noteInsideAtClose, onCompleteRapport: vi.fn(async () => { order.push('complete'); return true }) })
      await renderHook(() => useAbschluss(a)).result.current.confirmAndComplete()
      expect(order).toEqual(['note in', 'complete'])
      // «Trotzdem» on the crews question, then «Zurück» on the list: nothing written
      noteInsideAtClose.mockClear()
      ask.mockReset().mockResolvedValueOnce(true).mockResolvedValueOnce(false)
      await renderHook(() => useAbschluss(args({ trupps: [inside], noteInsideAtClose }))).result.current.confirmAndComplete()
      expect(noteInsideAtClose).not.toHaveBeenCalled()
    })

    it('dismissing it does nothing', async () => {
      const ask = vi.mocked(confirmDialog)
      ask.mockReset().mockResolvedValueOnce(false)
      const a = args({ trupps: [inside] })
      await expect(renderHook(() => useAbschluss(a)).result.current.confirmAndComplete()).resolves.toBe(false)
      expect(ask).toHaveBeenCalledTimes(1)
      expect(a.onCompleteRapport).not.toHaveBeenCalled()
    })
  })

  // N6 (staging r2): with open points the list's safe answer is the focused one
  it('with open points, «Zurück» is the focused answer and «Trotzdem abschliessen» the quiet one', async () => {
    const ask = vi.mocked(confirmDialog)
    ask.mockReset().mockResolvedValueOnce(false)
    const a = args()
    await renderHook(() => useAbschluss(a)).result.current.confirmAndComplete()
    expect(ask.mock.calls[0][0]).toMatchObject({
      confirmLabel: appConfig.copy.abschluss.confirmAnyway,
      cancelLabel: appConfig.copy.abschluss.confirmBack,
      safeAnswer: 'cancel',
    })
  })

  /* The sheet's rows answer themselves and the Einsatzende is pre-filled (3am sweep, 23.10.2026,
     owner's point 4): «Zeiten» stood open on almost every close because nothing ever set it. */
  describe('the «Noch offen» sheet settles points in place', () => {
    const A = appConfig.copy.abschluss
    type Ask = Parameters<typeof confirmDialog>[0]

    it('pre-fills an empty Einsatzende as a done row and writes it with the close, before the handover', async () => {
      const ask = vi.mocked(confirmDialog)
      ask.mockReset().mockResolvedValueOnce(true)
      const order: string[] = []
      const patchReportMeta = vi.fn((over: Partial<ReportMeta>) => { order.push(`patch:${Object.keys(over).join()}`) })
      const a = args({ patchReportMeta, onCompleteRapport: vi.fn(async () => { order.push('complete'); return true }) })
      await expect(renderHook(() => useAbschluss(a)).result.current.confirmAndComplete()).resolves.toBe(true)
      const spec = ask.mock.calls[0][0] as Ask
      // the Einsatzende row is the pre-filled one, already set, with «Ändern» – ONE row, in the
      // step's own place down the page (after Kontaktperson), as on the print's list (31.10.2026)
      const labels = spec.items?.map((i) => typeof i === 'string' ? i : i.label)
      expect(labels?.filter((l) => l === A.ende)).toHaveLength(1)
      expect(labels?.indexOf(A.ende)).toBe(labels!.indexOf(A.steps.kontaktperson) + 1)
      expect(spec.items?.[labels!.indexOf(A.ende)]).toMatchObject({ done: true, end: expect.stringMatching(/\d/), action: { label: A.endeChange, leaves: true } })
      expect(order).toEqual(['patch:endedAt', 'complete'])
      expect(patchReportMeta.mock.calls[0][0].endedAt).toMatch(/^\d{4}-/)
    })

    it('pre-fills nothing when the Ende is set, or when the Rapport may not be written', async () => {
      const ask = vi.mocked(confirmDialog)
      ask.mockReset().mockResolvedValue(true)
      const patchReportMeta = vi.fn()
      await renderHook(() => useAbschluss(args({ patchReportMeta, reportMeta: { endedAt: '2026-10-23T20:00:00Z' } as ReportMeta }))).result.current.confirmAndComplete()
      expect(patchReportMeta).not.toHaveBeenCalled()
      // the pre-filled row is the one with «jetzt HH:MM» at its end – the plain step row reads
      // «Einsatzende» too since 28.10.2026 (it is the field that is missing)
      const prefilled = (i: NonNullable<Ask['items']>[number]) => typeof i !== 'string' && i.label === A.ende && !!i.end
      expect((ask.mock.calls[0][0] as Ask).items?.some(prefilled)).toBe(false)
      await renderHook(() => useAbschluss(args())).result.current.confirmAndComplete()
      const spec = ask.mock.calls[1][0] as Ask
      expect(spec.items?.some(prefilled)).toBe(false)
      // …and the rows are plain links then: no buttons on a sheet that cannot write
      expect(spec.items?.every((i) => typeof i === 'string' || !i.action)).toBe(true)
    })

    it('a row\'s button writes at once; the re-read sheet keeps the row as done and re-words itself', async () => {
      const ask = vi.mocked(confirmDialog)
      ask.mockReset().mockResolvedValueOnce(false)
      const patchReportMeta = vi.fn()
      // everything but Material answered already
      const meta = { endedAt: '2026-10-23T20:00:00Z', einsatzleiter: 'Muster', kontaktpersonNone: true, summary: 'ok', rueckmeldungNone: true } as ReportMeta
      const a = args({ patchReportMeta, reportMeta: meta, attendance: { p1: {} } as never })
      await renderHook(() => useAbschluss(a)).result.current.confirmAndComplete()
      const spec = ask.mock.calls[0][0] as Ask
      expect(spec).toMatchObject({ confirmLabel: A.confirmAnyway, safeAnswer: 'cancel' })
      const row = spec.items?.find((i) => typeof i !== 'string' && i.label === A.steps.mittel)
      expect(row).toMatchObject({ action: { label: A.fix.mittel } })
      if (typeof row === 'string' || !row?.action) throw new Error('no row')
      row.action.onClick()
      expect(patchReportMeta).toHaveBeenCalledWith({ mittelConfirmedNone: true })
      // the sheet re-reads: nothing open any more — plain «Abschliessen», the row stays, done
      const next = spec.refresh!()
      expect(next).toMatchObject({ message: A.confirmMsg, confirmLabel: A.confirmBtn, safeAnswer: undefined })
      expect(next.items?.[0]).toMatchObject({ label: A.steps.mittel, done: true, end: A.fix.mittel })
    })

    it('«Ändern» on the pre-filled Ende writes it and goes to the Rapport\'s field', async () => {
      const ask = vi.mocked(confirmDialog)
      ask.mockReset().mockResolvedValueOnce(false)
      const patchReportMeta = vi.fn()
      const a = args({ patchReportMeta })
      await renderHook(() => useAbschluss(a)).result.current.confirmAndComplete()
      const ende = (ask.mock.calls[0][0] as Ask).items?.find((i) => typeof i !== 'string' && i.label === A.ende)
      if (typeof ende === 'string' || !ende?.action) throw new Error('no Ende row')
      ende.action.onClick()
      expect(patchReportMeta).toHaveBeenCalledWith({ endedAt: expect.stringMatching(/^\d{4}-/) })
      expect(a.requestReportStep).toHaveBeenCalledWith('zeiten')
      expect(a.setMode).toHaveBeenCalledWith('rapport')
    })
  })
})
