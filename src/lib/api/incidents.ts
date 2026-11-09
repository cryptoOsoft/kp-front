// Incident CRUD + the offline-resilient active list, plus the one-time legacy-workspace
// migration. Other incident subresources live in sibling modules: workspace blob (./workspace),
// audit events (./events), media (./media).
import { apiDelete, apiGet, apiPatch, apiPost } from '../api'
import { idbGet, idbSet, readThrough } from '../idb'
import { appConfig } from '../../config/appConfig'
import { putWorkspace, type Workspace } from './workspace'
import type { CachedWithout, In, Out } from './wire'

// --- Types (the server's, ./wire) ---------------------------------------------------
// the running rule lives in a leaf (lib/incidentRunning) so incidentClosed can ask it without an
// import ring back through this module and ./workspace
export { isIncidentRunning } from '../incidentRunning'

/**
 * The Einsatzende the record states when nobody entered one: the CURRENT close. After «Wieder
 * öffnen» and a second close, every device and the printed Rapport kept the FIRST close — the
 * Einsatzdauer, the «Einsatzende» line and the end of every Anwesenheit interval — while the
 * Austritte and the close rows sat later on the same paper (D2). `closed_at` stays the first
 * close and marks the Nachträge (lib/verlauf · isNachtrag, lib/report · journalRows); this is
 * everything else.
 */
export function closeTimeOf(i: Pick<IncidentMeta, 'closed_at' | 'last_closed_at'>): string | null {
  return i.last_closed_at ?? i.closed_at ?? null
}

/** One Einsatz as the list and meta routes serve it. `priority` is 'HIGH' | 'LOW' from Divera and
 *  the intake, but a plain string on the server (the demo writes 'NORMAL'); `source` is 'divera' |
 *  'manual' | 'migrated' | a generic intake slug, `source_ref` the foreign alarm id of one;
 *  `auto_opened` = created by an alarm without a human; `is_exercise` = Übung (stats-excluded);
 *  `report_done_at` the Abschluss-Assistent's bookmark (rapportStatus.ts). `last_closed_at` is the
 *  CURRENT close (D2, 25.09.2026) where `closed_at` keeps the first; `exercise_since_creation` =
 *  Übung since creation, never marked real — the only kind an editor may hard-delete;
 *  `editor_opened_at` / `capture_*` are the QR ↔ KP cross-visibility. Those five are optional
 *  here because a list cached before they existed lacks them. */
export type IncidentMeta = CachedWithout<Out<'IncidentMeta'>,
  'last_closed_at' | 'exercise_since_creation' | 'editor_opened_at' | 'capture_writes' | 'capture_last_at'>
export type IncidentFull = IncidentMeta & Pick<Out<'IncidentFull'>, 'text' | 'map_workspace_json' | 'details_json'>
/** `started_at` is the Alarmierungszeit — backdatable so an analog incident can be nachgetragen. */
export type IncidentCreate = In<'IncidentCreate'>

// --- Incidents ----------------------------------------------------------------------
export const listIncidents = (archived?: boolean, limit?: number) => {
  const params = [
    archived === undefined ? null : `archived=${archived}`,
    limit === undefined ? null : `limit=${limit}`,
  ].filter(Boolean).join('&')
  return apiGet<IncidentMeta[]>(`/api/incidents${params ? `?${params}` : ''}`)
}

// Offline support: cache the active (non-archived) incident list so an installed PWA can
// reopen the last incident with no signal (its workspace blob is already in WorkspaceSync's
// per-incident cache). The list itself is NetworkOnly for the SW, so we cache it here.
const INCIDENT_LIST_CACHE = 'kp-front-incidents'
/** A cache entry that is not a list at all is no list. The launcher filters this on every
 *  offline boot, so a corrupt entry used to throw at the root boundary on every launch, with
 *  no incident open to escape from. */
const isIncidentList = (v: unknown): v is IncidentMeta[] => Array.isArray(v)
export async function cacheIncidentList(list: IncidentMeta[]): Promise<void> {
  await idbSet(INCIDENT_LIST_CACHE, list)
}
/** The cached list, or [] — see `isIncidentList`. */
export async function readCachedIncidentList(): Promise<IncidentMeta[]> {
  const cached = await idbGet<unknown>(INCIDENT_LIST_CACHE)
  return isIncidentList(cached) ? cached : []
}
/** Fetch the active list online (and cache it); when the server could not be asked (offline,
 *  timeout, or a gateway in front of a restarting server — api · isUnverifiable) fall back to
 *  the cache. A real refusal (401, 500, …) still throws: that is an answer, not silence. */
export async function listIncidentsResilient(): Promise<{ list: IncidentMeta[]; offline: boolean }> {
  const { source, value } = await readThrough<IncidentMeta[]>(INCIDENT_LIST_CACHE, () => listIncidents(false), {
    validate: isIncidentList,
    fallback: () => [],
  })
  return { list: value, offline: source !== 'network' }
}
/** `listIncidentsResilient` for the callers that ask at the same moment: the boot list and the
 *  watch's first round start in one commit and used to send two identical requests. While a
 *  round is in flight every caller gets its answer; nothing is kept once it has landed.
 *
 *  ⚠️ Not for a list read AFTER a write (a take, a create, the legacy migration): that one must
 *  be sent after the write, so it calls `listIncidentsResilient` itself. */
let listInFlight: ReturnType<typeof listIncidentsResilient> | null = null
export function listIncidentsShared(): ReturnType<typeof listIncidentsResilient> {
  listInFlight ??= listIncidentsResilient().finally(() => { listInFlight = null })
  return listInFlight
}
export const getIncident = (id: string) => apiGet<IncidentFull>(`/api/incidents/${id}`)
export const createIncident = (body: IncidentCreate) => apiPost<IncidentFull>('/api/incidents', body)
// `text` (Meldungstext / Alarmmeldung) is not part of IncidentMeta but the backend PATCH
// accepts it (and started_at) — the Einsatzdaten panel corrects both in place.
export const patchIncident = (id: string, body: Partial<IncidentMeta> & { text?: string | null }) =>
  apiPatch<IncidentFull>(`/api/incidents/${id}`, body)
export const archiveIncident = (id: string) => patchIncident(id, { is_archived: true })
export const reactivateIncident = (id: string) => patchIncident(id, { is_archived: false })
/** Hard delete — the backend only permits this for Übungen (403 otherwise). */
export const deleteIncident = (id: string) => apiDelete(`/api/incidents/${id}`)

/** One-time migration: move the legacy single-workspace localStorage blob into a new
 *  "Migrierter Arbeitsstand" incident. Returns the new incident, or null if nothing to
 *  migrate / already migrated. */
const MIGRATION_FLAG = 'kp-front-migrated-v1'
export async function migrateLegacyWorkspace(
  legacyKeys: string[],
): Promise<IncidentFull | null> {
  if (localStorage.getItem(MIGRATION_FLAG)) return null
  let blob: Workspace | null = null
  for (const k of legacyKeys) {
    try {
      const raw = localStorage.getItem(k)
      if (raw) {
        const parsed = JSON.parse(raw)
        if (parsed && Array.isArray(parsed.entities)) {
          blob = parsed
          break
        }
      }
    } catch {
      /* skip corrupt */
    }
  }
  if (!blob) {
    localStorage.setItem(MIGRATION_FLAG, '1')
    return null
  }
  const inc = await createIncident({ title: appConfig.copy.incidents.migratedTitle })
  await putWorkspace(inc.id, blob, inc.workspace_rev)
  localStorage.setItem(MIGRATION_FLAG, '1')
  return inc
}
