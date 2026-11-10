// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ApiError, CONNECTOR_TIMEOUT_MS } from './api'
import { downloadPdf } from './download'

const PATH = '/api/incidents/inc/report/pdf'
const pdf = () => new Response('%PDF', { status: 200 })
const form = () => { const f = new FormData(); f.append('payload', '{}'); return f }
/** the `<a download>` names the page was asked to save under */
let saved: string[]

beforeEach(() => {
  saved = []
  URL.createObjectURL = vi.fn(() => 'blob:x')
  URL.revokeObjectURL = vi.fn()
  vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (this: HTMLAnchorElement) { saved.push(this.download) })
})
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks() })

// The Rapport, Tafel and Zeitplan PDF were three bare `fetch` calls (sweep 09.11.2026 · CODE.3):
// no bound, no session renewal, and the server's refusal replaced by a status number.
describe('downloadPdf', () => {
  it('saves the answer under the given name', async () => {
    const fetchMock = vi.fn(async () => pdf())
    vi.stubGlobal('fetch', fetchMock)
    await downloadPdf(PATH, form(), 'Einsatzrapport_Brand.pdf')
    expect(fetchMock).toHaveBeenCalledWith(PATH, expect.objectContaining({ method: 'POST' }))
    expect(saved).toEqual(['Einsatzrapport_Brand.pdf'])
  })

  it('renews an expired session once and sends the PDF request again', async () => {
    const answers = [new Response('', { status: 401 }), new Response('{}', { status: 200 }), pdf()]
    const fetchMock = vi.fn(async (_url: string) => answers.shift() ?? pdf())
    vi.stubGlobal('fetch', fetchMock)
    await downloadPdf(PATH, form(), 'Tafel.pdf')
    expect(fetchMock.mock.calls.map(([url]) => url)).toEqual([PATH, '/api/auth/refresh', PATH])
    expect(saved).toEqual(['Tafel.pdf'])
  })

  it('throws the server’s own words on a refusal and saves nothing', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ detail: 'Einsatz ist archiviert' }), { status: 409 })))
    await expect(downloadPdf(PATH, form(), 'x.pdf')).rejects.toMatchObject({ status: 409, detail: 'Einsatz ist archiviert' })
    expect(saved).toEqual([])
  })

  it('bounds the render with the long leash, and a render that ran out of it reads as a timeout', async () => {
    const bound = vi.spyOn(AbortSignal, 'timeout')
    const fetchMock = vi.fn(async (_url: string, _init: RequestInit) => { throw new DOMException('timed out', 'TimeoutError') })
    vi.stubGlobal('fetch', fetchMock)
    const err: unknown = await downloadPdf(PATH, form(), 'x.pdf').catch((e: unknown) => e)
    expect(bound).toHaveBeenCalledWith(CONNECTOR_TIMEOUT_MS)
    expect(fetchMock.mock.calls[0][1].signal).toBeInstanceOf(AbortSignal)
    expect(err).toBeInstanceOf(ApiError)
    expect(err).toMatchObject({ status: 0, timedOut: true })
  })
})
