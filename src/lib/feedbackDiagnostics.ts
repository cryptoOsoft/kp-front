// The Diagnose-Datei: the part of a Rückmeldung that makes it actionable.
//
// Everything else in the sheet is prose — what the operator typed and a six-line technical
// block. That is enough to say «es ist abgestürzt» and not enough to find anything, so every
// such report used to cost a round trip that begins «hast du die genaue Fehlermeldung». By
// then the app has been reloaded and the moment is gone. This module is that round trip,
// answered in advance: it asks the station's own server for the crash traces it has been
// holding (backend/app/telemetry/recent.py) and hands the operator a file to attach.
//
// It is a FILE and not more text in the mail body for one reason: a mailto: URL carries the
// body as a percent-encoded query string, and browsers and mail clients truncate it — some
// silently, around 2 kB. A stack trace is exactly the thing that would be cut. A file is also
// what a GitHub issue wants, and what the operator can read before deciding to send.
//
// Nothing here decides what the file CONTAINS: the server built and sanitised it. The rule
// that the app never shows the operator one thing and sends another holds by construction,
// because this downloads what it displays.

import { apiGet } from './api'

/** What the server hands back. Deliberately loose about `errors` — the entries are the
 *  server's shape, they travel verbatim into the file, and re-declaring them here would
 *  create a second definition to keep in sync for no gain. */
export interface DiagnosticsBundle {
  generatedAt: string
  app: string
  release: string
  device: string
  errors: unknown[]
  errorsKept: number
  note: string
}

/** `kp-front-diagnose-2026-09-09.json` — dated, so two of them in a Downloads folder are
 *  distinguishable, and prefixed with the app so a maintainer holding both apps' files can
 *  tell them apart before opening either. */
export function diagnosticsFilename(bundle: Pick<DiagnosticsBundle, 'app' | 'generatedAt'>): string {
  const day = bundle.generatedAt.slice(0, 10) || new Date().toISOString().slice(0, 10)
  return `${bundle.app}-diagnose-${day}.json`
}

/** Fetch the bundle. Rejects like any other API call — the caller decides what a failure
 *  means, and in the sheet it means "offer the routes that need no server". */
export function fetchDiagnostics(): Promise<DiagnosticsBundle> {
  return apiGet<DiagnosticsBundle>('/api/diag/export')
}

/** Save the bundle to the device. Returns the filename so the UI can name it in the note
 *  that tells the operator what to attach — «hänge diagnose.json an» is only useful if it
 *  matches what actually landed in Downloads.
 *
 *  The object URL is revoked on the next frame rather than immediately: Safari on iPadOS
 *  navigates to it asynchronously and a synchronous revoke races the download away. */
export function saveDiagnostics(bundle: DiagnosticsBundle): string {
  const name = diagnosticsFilename(bundle)
  const blob = new Blob([JSON.stringify(bundle, null, 2)], { type: 'application/json' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = name
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 0)
  return name
}
