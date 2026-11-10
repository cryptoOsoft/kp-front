// Every Objektbesuche route in ONE module (docs/object-visits.md · «Field API», «Admin»), so the
// paths can be adjusted in one place if the server names a route differently. Typed, thin — the
// policy (when to send, what a refusal means) lives in outbox.ts.

import { appConfig } from '../config/appConfig'
import { ApiError, apiGet, apiPost, apiPut, apiRequestRaw, throwResponseError, UPLOAD_REQUEST_TIMEOUT_MS } from '../lib/api'
import type {
  Catalogue, DeliveryRow, NotifyState, PutAccepted, Revision, ServerVisit, VisitDoc, VisitSummary,
} from './types'

const FIELD = '/api/object-visits'
const ADMIN = '/api/admin/object-visits'

const seg = (s: string) => encodeURIComponent(s)

export const OV_ROUTES = {
  catalogue: `${FIELD}/catalogue`,
  list: (q: string) => `${FIELD}${q ? `?${q}` : ''}`,
  visit: (id: string) => `${FIELD}/${seg(id)}`,
  attachment: (id: string, attId: string) => `${FIELD}/${seg(id)}/attachments/${seg(attId)}`,
  revisions: (id: string) => `${FIELD}/${seg(id)}/revisions`,
  revision: (id: string, n: number) => `${FIELD}/${seg(id)}/revisions/${n}`,
  report: (id: string, revision?: number | null) => `${FIELD}/${seg(id)}/report.pdf${revision != null ? `?revision=${revision}` : ''}`,
  adminList: (q: string) => `${ADMIN}${q ? `?${q}` : ''}`,
  adminDeliveries: `${ADMIN}/deliveries`,
  adminRetry: `${ADMIN}/deliveries/retry`,
  adminTest: (destination: string) => `${ADMIN}/destinations/${seg(destination)}/test`,
  adminExport: (q: string) => `${ADMIN}/export.zip${q ? `?${q}` : ''}`,
  adminNotify: `${ADMIN}/notify`,
} as const

/** The credential the organizer's key is stored under (group `object_visits`). */
export const INTEGRATION_KEY_CREDENTIAL = 'object_visits_integration_key'

/** A new organizer key: 32 random bytes, base64url — minted in the browser, shown exactly once,
 *  stored write-only through the credentials API. */
export function mintIntegrationKey(): string {
  const bytes = new Uint8Array(32)
  crypto.getRandomValues(bytes)
  let bin = ''
  for (const b of bytes) bin += String.fromCharCode(b)
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

export const getCatalogue = () => apiGet<Catalogue>(OV_ROUTES.catalogue)

export interface ListFilter {
  object?: string
  workRef?: string
  mine?: boolean
  lifecycle?: string
  limit?: number
}

function filterQuery(f: ListFilter = {}): string {
  const p = new URLSearchParams()
  if (f.object) p.set('object', f.object)
  if (f.workRef) p.set('workRef', f.workRef)
  if (f.mine) p.set('mine', '1')
  if (f.lifecycle) p.set('lifecycle', f.lifecycle)
  if (f.limit) p.set('limit', String(f.limit))
  return p.toString()
}

export const listVisits = (f?: ListFilter) => apiGet<VisitSummary[]>(OV_ROUTES.list(filterQuery(f)))
export const getVisit = (id: string) => apiGet<ServerVisit>(OV_ROUTES.visit(id))
export const getRevisions = (id: string) => apiGet<Revision[]>(OV_ROUTES.revisions(id))

/** A body the server may send either bare or wrapped in FastAPI's `{detail: …}`. */
async function readBody(res: Response): Promise<Record<string, unknown>> {
  try {
    const j = (await res.json()) as unknown
    if (j && typeof j === 'object') {
      const d = (j as { detail?: unknown }).detail
      return d && typeof d === 'object' && !Array.isArray(d) ? (d as Record<string, unknown>) : (j as Record<string, unknown>)
    }
  } catch { /* not JSON */ }
  return {}
}

export type PutResult =
  | { kind: 'accepted'; answer: PutAccepted }
  | { kind: 'conflict'; revision: number; visit: ServerVisit }

/**
 * `PUT /{id}` with `{opId, baseRevision, doc}`. A revision conflict comes back as a value (the
 * caller merges); every other refusal throws the app's `ApiError` (status + German detail +
 * `code`), and a network failure throws `ApiError(0)`.
 */
export async function putVisit(id: string, body: { opId: string; baseRevision: number | null; doc: VisitDoc }): Promise<PutResult> {
  const res = await apiRequestRaw(OV_ROUTES.visit(id), {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  if (res.status === 409) {
    const b = await readBody(res.clone())
    if (b.code === 'revision_conflict' && b.visit && typeof b.visit === 'object') {
      return { kind: 'conflict', revision: Number(b.revision), visit: b.visit as ServerVisit }
    }
  }
  if (!res.ok) return throwResponseError(res)
  return { kind: 'accepted', answer: (await res.json()) as PutAccepted }
}

/** Hex SHA-256 of a blob — what `X-Content-SHA256` carries and what the server checks. */
export async function sha256Hex(blob: Blob): Promise<string> {
  const buf = await blob.arrayBuffer()
  const digest = await crypto.subtle.digest('SHA-256', buf)
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).join('')
}

/** `PUT /{id}/attachments/{attId}` with the raw bytes. 201 new · 200 already stored — both are
 *  success. A refusal throws `ApiError` (409 `attachment_conflict`, 422 hash/type/size).
 *
 *  ⚠️ «Stored» only on an answer that SAYS so: our server's JSON naming this id and this hash. A
 *  2xx that is not that — a captive portal's HTML, an interception proxy — is treated as the
 *  server not having been reached (`ApiError(0)`): counted as uploaded, the photo would be
 *  released from the device while the server never got it. */
export async function putAttachment(visitId: string, attId: string, blob: Blob, type: string, sha256: string): Promise<{ id: string; sha256: string; size: number }> {
  const res = await apiRequestRaw(OV_ROUTES.attachment(visitId, attId), {
    method: 'PUT',
    headers: { 'Content-Type': type, 'X-Content-SHA256': sha256 },
    body: blob,
  }, UPLOAD_REQUEST_TIMEOUT_MS)
  if (!res.ok) return throwResponseError(res)
  const body = (await res.json().catch(() => null)) as { id?: unknown; sha256?: unknown; size?: unknown } | null
  const said = body && typeof body === 'object' ? body : {}
  if (said.id !== attId || typeof said.sha256 !== 'string' || said.sha256.toLowerCase() !== sha256.toLowerCase()) {
    throw new ApiError(0, appConfig.copy.errors.serverUnexpected)
  }
  return { id: attId, sha256, size: typeof said.size === 'number' ? said.size : blob.size }
}

/** The bytes of a stored report / photo as a Blob (a bare fetch carries no JSON). */
export async function fetchBlob(path: string): Promise<Blob> {
  const res = await apiRequestRaw(path, { method: 'GET' }, UPLOAD_REQUEST_TIMEOUT_MS)
  if (!res.ok) return throwResponseError(res)
  return res.blob()
}

export const attachmentUrl = (visitId: string, attId: string, thumb = false) =>
  `${OV_ROUTES.attachment(visitId, attId)}${thumb ? '?thumb=1' : ''}`

// --- admin -------------------------------------------------------------------------------

export const adminListVisits = (f?: ListFilter) => apiGet<VisitSummary[]>(OV_ROUTES.adminList(filterQuery(f)))
export const adminDeliveries = () => apiGet<DeliveryRow[]>(OV_ROUTES.adminDeliveries)
export const adminRetryDeliveries = (destination: string, visitId?: string) =>
  apiPost<{ retried: number }>(OV_ROUTES.adminRetry, visitId ? { destination, visitId } : { destination })
export const adminTestDestination = (destination: string) =>
  apiPost<{ ok: boolean; status?: number | null; detail?: string | null; webUrl?: string | null }>(OV_ROUTES.adminTest(destination))
export const adminExportUrl = (f?: ListFilter) => OV_ROUTES.adminExport(filterQuery(f))
/** Who gets «Neuer Objektbesuch» (docs/object-visits.md · Notification) — read, and set as the whole list. */
export const adminNotify = () => apiGet<NotifyState>(OV_ROUTES.adminNotify)
export const adminSetNotify = (userIds: string[]) => apiPut<NotifyState>(OV_ROUTES.adminNotify, { userIds })

/** Did the server say the module is off (`404 {code: object_visits_disabled}`)? */
export const isModuleDisabled = (e: unknown): boolean =>
  e instanceof ApiError && e.status === 404 && e.code === 'object_visits_disabled'
