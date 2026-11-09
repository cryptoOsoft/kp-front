// Client side of the server-composed Einsatzrapport PDF (see backend app/report).
//
// The payload is pure DATA — form fields, the Kroki scene, plan references + annotations.
// The server renders the map (raster tiles + the
// shared symbol pack), the plan pages (pdfium) and loads journal photos from its own media
// store; nothing is captured or uploaded from the browser anymore.

import { downloadBlob } from './download'
import { pad2 } from './format'
import { linkSessionHeaders } from './linkMode'

// Mirror api.ts's base so a cross-origin deployment still resolves (Vite proxies /api in dev).
const BASE = import.meta.env.VITE_KP_RUECK_URL ?? ''

/** POST the payload to the composer, then download the returned PDF. Throws on a non-2xx
 *  response so the caller can surface an error toast. */
export interface ReportTransport {
  /** override endpoint (e.g. the capture view's poster-token route) */
  url: string
  headers?: Record<string, string>
}

export async function downloadReportPdf(
  incidentId: string,
  payload: unknown,
  filenameHint: string,
  transport?: ReportTransport,
): Promise<void> {
  const form = new FormData()
  form.append('payload', JSON.stringify(payload))

  const res = await fetch(transport?.url ?? `${BASE}/api/incidents/${encodeURIComponent(incidentId)}/report/pdf`, {
    method: 'POST',
    credentials: 'include',
    // A bare `fetch` (the answer is a PDF blob, not JSON), so the session-mode header the api
    // client adds for free has to be spread by hand — see api · rawFetch for the invariant.
    // Ahead of the transport's own headers, which carry the capture poster token and never this.
    headers: { ...linkSessionHeaders(), ...transport?.headers },
    body: form,
  })
  if (!res.ok) throw new Error(`Rapport-PDF fehlgeschlagen (${res.status})`)

  const blob = await res.blob()
  downloadBlob(blob, `Einsatzrapport_${filenameHint || 'Einsatz'}.pdf`)
}

/** One part of a filename: letters (umlauts included), digits, space, - and _ survive, every run
 *  of spaces becomes one `_`. */
const filenamePart = (s: string): string =>
  Array.from(s).filter((c) => /[\p{L}\p{N} \-_]/u.test(c)).join('').trim().replace(/\s+/g, '_').slice(0, 60)

/**
 * The name the downloaded Rapport goes by, after «Einsatzrapport_»: when the Einsatz began (local
 * time, HHMM – no `:` in a filename), its Stichwort and its address –
 * `20261109_1126_Zimmerbrand_Schlossgasse_9_9999_Musterdorf`. A folder of rapports sorts by date,
 * and the 47th «Zimmerbrand» no longer lands as «Zimmerbrand (47)» (Manuel 09.11.2026).
 * `startedAt`: the Rapport's own start where it was corrected, else the Alarmierungszeit. The
 * server's Content-Disposition (backend · report_filename) still names the title alone; the
 * browser saves under this name.
 */
export function reportFilenameHint({ title, address, startedAt }: { title: string; address?: string | null; startedAt?: string | null }): string {
  const d = startedAt ? new Date(startedAt) : null
  const stamp = d && !Number.isNaN(d.getTime())
    ? `${d.getFullYear()}${pad2(d.getMonth() + 1)}${pad2(d.getDate())}_${pad2(d.getHours())}${pad2(d.getMinutes())}`
    : ''
  return [stamp, filenamePart(title), filenamePart(address ?? '')].filter(Boolean).join('_')
}
