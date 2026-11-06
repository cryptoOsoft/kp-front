// Whether a presentation runs on an Einsatz, as the workspace follow last heard it (backend
// api/incidents · PRESENTATION_HEADER: the id, or «none»). The Präsentationsmodus follow
// (workspace/usePresentation) runs ONLY while this names one, so an Einsatz nobody presents costs
// no request of its own – the workspace poll every device parks anyway carries the marker and is
// woken by a start or an end (perf journey `idle`, 06.11.2026; docs/presentation.md).
//
// Unknown (never heard) reads as «none»: the poll sends that belief, and the server answers at
// once only when it is wrong – the common case parks as usual and costs nothing extra at boot.

import { useCallback, useSyncExternalStore } from 'react'

const markers = new Map<string, string | null>()
const listeners = new Set<() => void>()

/** The running presentation's id on `incidentId`, or null for none (and for never heard). */
export const presentationMarker = (incidentId: string): string | null => markers.get(incidentId) ?? null

/** What the workspace poll heard – or what this device itself just did (start, end). */
export function setPresentationMarker(incidentId: string, id: string | null) {
  if ((markers.get(incidentId) ?? null) === id && markers.has(incidentId)) return
  markers.set(incidentId, id)
  for (const l of listeners) l()
}

export function subscribePresentationMarker(fn: () => void): () => void {
  listeners.add(fn)
  return () => { listeners.delete(fn) }
}

export function usePresentationMarker(incidentId: string): string | null {
  const get = useCallback(() => presentationMarker(incidentId), [incidentId])
  return useSyncExternalStore(subscribePresentationMarker, get, get)
}

/** The header's value as a marker (null = none / absent). */
export const parsePresentationHeader = (raw: string | null): string | null | undefined =>
  raw === null ? undefined : raw === 'none' || raw === '' ? null : raw

/** test seam */
export const resetPresentationMarkers = () => markers.clear()
