// Per-incident workspace blob: get/put + the live-follow poll. The blob is opaque here — the
// App owns its `Saved` structure; we only move it to/from the server. Offline caching + the
// debounced merge-on-save engine live alongside in ./workspaceSync.
import { parsePresentationHeader, presentationMarker, setPresentationMarker } from '../presentationMarker'
import { ApiError, apiBeacon, apiGet, apiGetRaw, apiPut, LONG_POLL_TIMEOUT_MS } from '../api'
import type { Trupp } from '../../types'
import type { Out } from './wire'
import { reportIncidentClosed, reportIncidentReopened } from '../incidentClosed'

/** The blob on the wire. The app's typed view is `Saved` (lib/workspace): a `Saved` is a
 *  Workspace as it stands, and the way back in is sanitizeWorkspace, never a cast. */
export type Workspace = Record<string, unknown>
/** What every workspace route answers: the blob (null on a `slim` save) and its revision. */
type WorkspaceOut = Out<'WorkspaceOut'>

/** Which sync engine saved (backend api/incidents · X-Workspace-Writer): the follower read asks
 *  with the same id, and a range of revisions that is nothing but this engine's own saves comes
 *  back as a bodyless 304 instead of the blob it just sent (see pollWorkspaceSince). Only the
 *  engine whose state holds the save may send it — never a save made around it. */
const writerHeader = (writer?: string): Record<string, string> | undefined =>
  writer ? { 'X-Workspace-Writer': writer } : undefined

export const getWorkspace = (id: string) =>
  apiGet<WorkspaceOut>(`/api/incidents/${id}/workspace`)
// `slim=1`: only the revision comes back (workspace null). The engine reads nothing but the
// rev off a push (workspaceSync · pushCurrent), and the full echo doubled the wire cost of
// every save at field blob sizes. An older backend ignores the flag and keeps echoing — the
// type already allows both answers.
// `edited_at` (review of #235): when the newest edit in this save was made — a closed Einsatz
// takes a save made before its close (backend · happened_after_close). Omitted when unknown.
export const putWorkspace = (id: string, workspace: Workspace, base_rev: number, edited_at?: string, writer?: string) =>
  apiPut<WorkspaceOut>(`/api/incidents/${id}/workspace?slim=1`, {
    workspace,
    base_rev,
    ...(edited_at ? { edited_at } : {}),
  }, writerHeader(writer))
/** Fire-and-forget workspace PUT for page teardown — survives the document unloading.
 *  `slim=1` here saves only server-side serialisation: the response is never read. */
export const putWorkspaceBeacon = (id: string, workspace: Workspace, base_rev: number, edited_at?: string) =>
  apiBeacon(`/api/incidents/${id}/workspace?slim=1`, { workspace, base_rev, ...(edited_at ? { edited_at } : {}) }, 'PUT')

// --- the trupp slice on its own ------------------------------------------------------------
// An Atemschutz-Link session (auth · AuthUser.link_kind) may write the Überwachungstafel and
// nothing else, so the full workspace PUT 403s for it. Same route shape, same request/response
// contract (`base_rev` in, `{workspace, workspace_rev}` out, 409 on a race) — the server folds
// the trupps into the current blob and merges the rest itself. WorkspaceSync's `slice: 'trupps'`
// option routes its push and its teardown beacon here; everything else about the engine is
// unchanged.
// ⚠️ Each slice carries the `schemaVersion` of the blob it was cut from (since 30.10.2026): the
// server refuses a slice older than its stored blob, which a build that could not read everything
// would otherwise overwrite wholesale (backend workspace_kinds · refuse_older_build).
export const putWorkspaceTrupps = (id: string, trupps: readonly Trupp[], base_rev: number, edited_at?: string, writer?: string, schemaVersion?: number) =>
  apiPut<WorkspaceOut>(`/api/incidents/${id}/workspace/trupps`, {
    trupps,
    base_rev,
    ...(edited_at ? { edited_at } : {}),
    ...(schemaVersion != null ? { schemaVersion } : {}),
  }, writerHeader(writer))
/** Teardown twin of putWorkspaceTrupps — see putWorkspaceBeacon. */
export const putWorkspaceTruppsBeacon = (id: string, trupps: readonly Trupp[], base_rev: number, edited_at?: string, schemaVersion?: number) =>
  apiBeacon(`/api/incidents/${id}/workspace/trupps`, { trupps, base_rev, ...(edited_at ? { edited_at } : {}), ...(schemaVersion != null ? { schemaVersion } : {}) }, 'PUT')

// --- the record slice on its own -----------------------------------------------------------
// The `el` role (Einsatzleiter function, 07.09.2026) may write the operational RECORD —
// Anwesenheit/Zeitplan, Mittel, Checklisten, Rapport + Beilagen — and nothing else; the full
// workspace PUT 403s for it. The body is a whole `workspace` object like the editor PUT, but
// the server applies ONLY its RECORD_WORKSPACE_KEYS over its own stored blob (api/incidents ·
// put_workspace_record, capture.py's proven merge), so the tactical picture is bounded
// server-side whatever this client sends. Same contract otherwise — `base_rev` in, rev out,
// 409 on a race. WorkspaceSync's `slice: 'record'` routes here.
// The record route reads the version off its `workspace` (the server keeps only record keys of it).
const stamped = (workspace: Workspace, schemaVersion?: number): Workspace =>
  schemaVersion != null ? { ...workspace, schemaVersion } : workspace
export const putWorkspaceRecord = (id: string, workspace: Workspace, base_rev: number, writer?: string, schemaVersion?: number) =>
  apiPut<WorkspaceOut>(`/api/incidents/${id}/workspace/record`, {
    workspace: stamped(workspace, schemaVersion),
    base_rev,
  }, writerHeader(writer))
/** Teardown twin of putWorkspaceRecord — see putWorkspaceBeacon. */
export const putWorkspaceRecordBeacon = (id: string, workspace: Workspace, base_rev: number, schemaVersion?: number) =>
  apiBeacon(`/api/incidents/${id}/workspace/record`, { workspace: stamped(workspace, schemaVersion), base_rev }, 'PUT')

// clock-skew watch (mirrors captureClient · onServerTime): workspace responses carry
// X-Server-Time (backend · api_server_time middleware), and the live-follow poll is the one
// request every device — editor and viewer alike — repeats for the whole session, so it is the
// sampling point. Header absent (older backend) → silent. useIncidentSync registers, computes
// the skew and surfaces it; only one listener is ever needed (one workspace per app).
let serverTimeListener: ((iso: string) => void) | null = null
export function onWorkspaceServerTime(fn: ((iso: string) => void) | null): void { serverTimeListener = fn }

/** What one round of the live follow brought: the blob (another device saved), only this
 *  engine's own saves (`ownRev` — the revision the server is at, held here already), or null
 *  (unchanged). */
export type WorkspaceFollow = { workspace: Workspace | null; workspace_rev: number } | { ownRev: number } | null

/**
 * Live-follow poll: 304 → null (unchanged); 200 → the current workspace + rev.
 *
 * `wait` turns it into a LONG POLL: the server holds the request open (~20 s) until another
 * device's save bumps the revision, so a cross-device edit arrives in the time the write takes
 * to commit instead of on the next beat. The answer is the same 304/200 either way — a caller
 * that can't hold a connection open (backgrounded tab) simply passes `wait: false`.
 *
 * `signal` aborts a held request. Mandatory in practice for the waiting form: without it a
 * torn-down loop would stay pinned to a request for up to 20 s.
 *
 * `writer` is the asking engine's id (`WorkspaceSync · writerId`, the one its saves carry). Every
 * save wakes every follower, the saving device's own too, which then downloaded the whole blob it
 * had just sent (~38 KB gzipped on the busiest Einsatz on record) — on every edit (18.10.2026).
 * With the id, a range of revisions that is nothing but this engine's saves is the 304 with
 * `X-Workspace-Rev` → `{ ownRev }`. The server decides, and only from what it has on record:
 * any revision it cannot vouch for as this engine's is the blob, as before.
 */
export async function pollWorkspaceSince(
  id: string,
  sinceRev: number,
  /** `open`: whether the caller shows the Einsatz as running — the server answers at once, rather
   *  than parking, when that is no longer true (a close or reopen it would otherwise sit out) */
  opts?: { wait?: boolean; signal?: AbortSignal; open?: boolean; onLifecycle?: (open: boolean) => void; writer?: string },
): Promise<WorkspaceFollow> {
  const wait = opts?.wait ?? false
  const believed = opts?.open === undefined ? '' : `&open=${opts.open ? 1 : 0}`
  const writer = opts?.writer ? `&writer=${encodeURIComponent(opts.writer)}` : ''
  // the Präsentationsmodus marker this device holds (lib/presentationMarker) – a wrong one is
  // answered at once, so a presentation that runs is heard within the round
  const presenting = `&presentation=${encodeURIComponent(presentationMarker(id) ?? 'none')}`
  const res = await apiGetRaw(`/api/incidents/${id}/workspace?since=${sinceRev}${wait ? '&wait=1' : ''}${believed}${writer}${presenting}`, {
    signal: opts?.signal,
    timeoutMs: wait ? LONG_POLL_TIMEOUT_MS : undefined,
  })
  // before the status branches: the 304 "nothing new" answer carries the clock too, and on a
  // quiet incident it is the ONLY answer — the skew watch must not depend on edits happening
  const serverTime = res.headers.get('X-Server-Time')
  if (serverTime) serverTimeListener?.(serverTime)
  // …and whether the Einsatz is still running, on the 304 too (backend · _lifecycle_headers).
  // A close never moves the revision, so this header is the only way a follower hears of it
  // (N3, 25.09.2026). Absent (an older backend) → silent, as before.
  const marker = parsePresentationHeader(res.headers.get('X-Presentation'))
  if (marker !== undefined) setPresentationMarker(id, marker)
  const open = res.headers.get('X-Incident-Open')
  if (open === '0' || open === '1') opts?.onLifecycle?.(open === '1')
  if (open === '0') {
    reportIncidentClosed({ incidentId: id, closedAt: res.headers.get('X-Incident-Closed-At'), source: 'poll' })
  } else if (open === '1') {
    // …and «Wieder öffnen» elsewhere comes back the same way (App acts only on a closed view)
    reportIncidentReopened({ incidentId: id, source: 'poll' })
  }
  if (res.status === 304) {
    // only this engine's own saves since `sinceRev` (backend · only_own_writes): nothing to fetch,
    // but the follow must park at the server's revision next, not ask about these again
    const own = Number(res.headers.get('X-Workspace-Rev'))
    return Number.isInteger(own) && own > sinceRev ? { ownRev: own } : null
  }
  if (!res.ok) throw new ApiError(res.status, 'Workspace-Poll fehlgeschlagen')
  return res.json()
}
