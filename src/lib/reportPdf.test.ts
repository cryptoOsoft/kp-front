import { describe, expect, it } from 'vitest'
import { reportFilenameHint } from './reportPdf'

describe('reportFilenameHint', () => {
  it('names the rapport by start (local HHMM), Stichwort and address', () => {
    expect(reportFilenameHint({ title: 'Zimmerbrand', address: 'Schlossgasse 9, 9999 Musterdorf', startedAt: '2026-11-09T11:26:00' }))
      .toBe('20261109_1126_Zimmerbrand_Schlossgasse_9_9999_Musterdorf')
  })

  it('keeps umlauts, drops what a filesystem chokes on, and skips what is missing', () => {
    expect(reportFilenameHint({ title: 'Brand: Küche / 2. OG', address: null, startedAt: 'kaputt' })).toBe('Brand_Küche_2_OG')
  })
})
