/*
 * Cancelled map requests (`AbortError`) are filtered only at `lib/mapError`, not globally.
 * Timeouts, actual map failures and aborts outside the map still reach the client-error sink.
 */

import { reportClientError } from './reportError'

/** Map requests are cancelled during reloads, source changes and navigation. MapLibre can
 * forward that cancellation through its error event; it is not a failed map operation. Keep
 * this exception at the map boundary: an AbortError in unrelated application code still
 * belongs in the client-error sink, as do map timeouts, network failures and rendering errors. */
export function reportMapError(error: unknown): void {
  if (error && typeof error === 'object' && 'name' in error && error.name === 'AbortError') return
  reportClientError(error ?? new Error('map error'), { kind: 'error' })
}
