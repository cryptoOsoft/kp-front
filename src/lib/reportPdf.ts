// Client side of the server-composed Einsatzrapport PDF (see backend app/report).
//
// The payload is pure DATA — form fields, the Kroki scene, plan references + annotations.
// The server renders the map (raster tiles + the
// shared symbol pack), the plan pages (pdfium) and loads journal photos from its own media
// store; nothing is captured or uploaded from the browser anymore.

import { downloadBlob, downloadPdf } from './download'
import { linkSessionHeaders } from './linkMode'

/** Another way to reach the composer than the signed-in app's: the capture view's poster-token
 *  route, on a phone that has no session. */
export interface ReportTransport {
  /** override endpoint (a path on this origin) */
  url: string
  headers?: Record<string, string>
}

/** POST the payload to the composer, then download the returned PDF. Throws on a non-2xx
 *  response so the caller can surface an error toast. */
export async function downloadReportPdf(
  incidentId: string,
  payload: unknown,
  filenameHint: string,
  transport?: ReportTransport,
): Promise<void> {
  const form = new FormData()
  form.append('payload', JSON.stringify(payload))
  const filename = `Einsatzrapport_${filenameHint || 'Einsatz'}.pdf`
  if (!transport) return downloadPdf(`/api/incidents/${encodeURIComponent(incidentId)}/report/pdf`, form, filename)

  // The capture view stays on a bare `fetch`: its poster token is the whole authentication, so
  // there is no session for the API client to renew, and a 401 there must not be read as «this
  // device's login expired». Its caller bounds the request (CaptureApp · printRapport). The
  // session-mode header the client adds for free rides by hand, ahead of the transport's own.
  const res = await fetch(transport.url, {
    method: 'POST',
    credentials: 'include',
    headers: { ...linkSessionHeaders(), ...transport.headers },
    body: form,
  })
  if (!res.ok) throw new Error(`Rapport-PDF fehlgeschlagen (${res.status})`)
  downloadBlob(await res.blob(), filename)
}

/** Sanitise an incident title into a safe filename fragment (mirrors the server side). */
export function reportFilenameHint(title: string): string {
  return Array.from(title).filter((c) => /[\p{L}\p{N} \-_]/u.test(c)).join('').trim().replace(/\s+/g, '_').slice(0, 60)
}
