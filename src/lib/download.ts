import { apiRequestRaw, CONNECTOR_TIMEOUT_MS, throwResponseError } from './api'

// Trigger a browser "save file" for an in-memory Blob. The object URL is revoked on a short
// delay (not immediately) so large blobs — e.g. a server-rendered PDF — stay alive long enough
// for the download to start in every browser.
export function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 5000)
}

// Download a same-origin URL WITHOUT navigating to it. `location.assign` on a file response
// walked the only window of an installed PWA onto iOS' quick-look page, which has no way back
// (Feldtest 08.09., «bleibt hier stecken»). An anchor with `download` saves in place — the
// server's Content-Disposition names the file — and a browser that ignores the attribute falls
// back to the old navigation, no worse than before. Streamed by the browser, so a large ZIP
// never sits in JS memory the way a Blob would.
export function downloadUrl(url: string): void {
  const a = document.createElement('a')
  a.href = url
  a.download = ''
  document.body.appendChild(a)
  a.click()
  a.remove()
}

/**
 * POST `form` to an API route that answers with a PDF (Rapport, Tafel, Zeitplan) and save the
 * answer as `filename`. Through the API client, so the request is bounded, renews an expired
 * session once and carries the link-mode header like every other call; a refusal throws
 * `ApiError` with the server's own words, no answer at all throws `ApiError(0, …)`.
 * A render takes far longer than a JSON call, hence the long bound.
 */
export async function downloadPdf(path: string, form: FormData, filename: string): Promise<void> {
  const res = await apiRequestRaw(path, { method: 'POST', body: form }, CONNECTOR_TIMEOUT_MS)
  if (!res.ok) return throwResponseError(res)
  downloadBlob(await res.blob(), filename)
}
