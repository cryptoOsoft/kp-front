// The Präsentationsmodus wire (backend api/presentation): the live poll, start/end and the
// signals. Ephemeral by construction – nothing here goes through an outbox: offline, the feature
// is simply not there (docs/presentation.md).

import { apiDelete, apiGet, apiPost, LONG_POLL_TIMEOUT_MS } from '../api'
import type { In } from './wire'
import type { PresentationState } from '../presentation'

const base = (incidentId: string) => `/api/incidents/${encodeURIComponent(incidentId)}/presentation`

/** One round of the follow: parks (`wait`) while nothing changed for a device that knows
 *  presentation `known` ('' = none) up to message `since`. */
export function pollPresentation(incidentId: string, q: { client: string; known: string; since: number; wait: boolean }, signal?: AbortSignal) {
  const qs = new URLSearchParams({ client: q.client, known: q.known, since: String(q.since) })
  if (q.wait) qs.set('wait', '1')
  return apiGet<PresentationState>(`${base(incidentId)}?${qs}`, { signal, timeoutMs: q.wait ? LONG_POLL_TIMEOUT_MS : undefined })
}

export const startPresentation = (incidentId: string, client: string) =>
  apiPost<PresentationState>(base(incidentId), { client })

export const endPresentation = (incidentId: string) => apiDelete(base(incidentId))

export type PresentationSignal = In<'PresentationSignal'>

export const sendPresentationSignal = (incidentId: string, signal: PresentationSignal) =>
  apiPost<void>(`${base(incidentId)}/signal`, signal)
