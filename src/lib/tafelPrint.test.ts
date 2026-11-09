// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { formAnno, newFormPage, putRow } from './boardForm'
import { BUNDLED_TEMPLATES } from './boardTemplates'
import { resetConnectivityForTests } from './connectivity'
import { TafelPrintOffline, printTafelPages, tafelPrintPayload } from './tafelPrint'

const FKS = BUNDLED_TEMPLATES[0]
const page = (id: string) => formAnno(putRow(newFormPage(FKS, FKS.pages.find((p) => p.id === id)!, {}, '2026-10-10T09:00:00.000Z'), 'mittel', 'r', { cells: { formation: 'TLF' } }))

afterEach(() => { vi.unstubAllGlobals(); resetConnectivityForTests(true) })

// owner: «maybe add a print option»
describe('the Tafel prints its own pages', () => {
  it('sends the same sheets the Rapport carries, one or all, with the Einsatz on them', () => {
    const body = tafelPrintPayload([page('ef'), page('mittel')], { id: 'inc', title: 'Brand' }, undefined, new Date('2026-10-10T16:05:00Z'))
    expect(body.incident).toEqual({ id: 'inc', title: 'Brand' })
    const pages = body.boardPages as { title: string }[]
    expect(pages.map((p) => p.title)).toEqual(['Erste Führung', 'Mittel'])
    expect(body.boardMap).toBeUndefined() // no scene, no Lagekarte render asked for
  })

  it('posts to the Tafel endpoint and hands the PDF to the browser', async () => {
    const fetch = vi.fn(async () => new Response('%PDF', { status: 200 }))
    vi.stubGlobal('fetch', fetch)
    URL.createObjectURL = vi.fn(() => 'blob:x')
    URL.revokeObjectURL = vi.fn()
    await printTafelPages([page('ef')], { id: 'inc 1', title: 'Brand Haus 4' })
    expect(fetch).toHaveBeenCalledWith('/api/incidents/inc%201/tafel/pdf', expect.objectContaining({ method: 'POST' }))
  })

  it('offline it says so instead of failing — before asking, and when the request gets no answer', async () => {
    const fetch = vi.fn(async () => { throw new TypeError('Failed to fetch') })
    vi.stubGlobal('fetch', fetch)
    await expect(printTafelPages([page('ef')], { id: 'inc', title: 'Brand' })).rejects.toBeInstanceOf(TafelPrintOffline)
    resetConnectivityForTests(false)
    fetch.mockClear()
    await expect(printTafelPages([page('ef')], { id: 'inc', title: 'Brand' })).rejects.toBeInstanceOf(TafelPrintOffline)
    expect(fetch).not.toHaveBeenCalled()
  })

  it('a refusal by the server is an error, not «offline»', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('no', { status: 500 })))
    await expect(printTafelPages([page('ef')], { id: 'inc', title: 'Brand' })).rejects.not.toBeInstanceOf(TafelPrintOffline)
  })
})
