// Data layer for the kp-front backend. The implementation is split by domain under ./api/*;
// this module is the UI's one entry point to the ten modules below: everything outside src/lib
// imports them from `lib/incidents` (eslint `no-restricted-imports` holds it), so a component
// test mocks one module and the surface can be reorganised without touching the call sites.
// src/lib itself – the data layer – imports ./api/* directly (a barrel import there invites
// cycles). Re-exports are explicit (not `export *`) so a symbol's origin stays greppable and an
// unused one shows up (knip).
//
//   ./api/incidents     — incident CRUD + offline-resilient list + legacy migration
//   ./api/workspace     — the per-incident workspace blob (get/put/beacon/poll)
//   ./api/workspaceSync — WorkspaceSync: offline cache + debounced merge-on-save engine
//   ./api/events        — audit event ingest + hash-chain verify
//   ./api/media         — photo/audio upload
//   ./api/divera        — Divera alarm pool (take/attach)
//   ./api/personnel     — Mannschaft roster + Divera sync
//   ./api/geo           — intake address geocoder
//   ./api/objects       — Feuerwehrpläne objects + their plan datasets
//   ./api/reference     — reference datasets + per-station reference-layer config

export {
  listIncidents, cacheIncidentList, readCachedIncidentList, listIncidentsResilient, listIncidentsShared,
  getIncident, createIncident, patchIncident, archiveIncident, reactivateIncident,
  deleteIncident, migrateLegacyWorkspace,
} from './api/incidents'
export type { IncidentCreate, IncidentMeta, IncidentFull } from './api/incidents'
export { isIncidentRunning, closeTimeOf } from './api/incidents'

export { pollWorkspaceSince } from './api/workspace'
export type { Workspace } from './api/workspace'

export { WorkspaceSync, discardWorkspaceCache } from './api/workspaceSync'
export type { SyncStatus } from './api/workspaceSync'

export { verifyChain } from './api/events'

export { uploadMedia } from './api/media'

export { getDiveraPool, refreshDiveraPool, takeDiveraAlarm, attachDiveraAlarm, getDiveraResponses } from './api/divera'
export type { DiveraAlarm, DiveraResponses } from './api/divera'

export { listPersonnel, personnelSyncPreview, personnelSyncExecute } from './api/personnel'
export type { PersonnelSyncPreview, PersonnelSyncResult } from './api/personnel'

export { geocodeSearch, geocodeReverse } from './api/geo'
export type { GeoHit } from './api/geo'

export {
  listObjects, objectsNearIncidentResilient, getObjectResilient,
} from './api/objects'
export type { ObjectWithPlans } from './api/objects'

export {
  listReference, referenceUrl, uploadReference, upsertReferenceLayer, inspectGeojson,
  geoDatasetId, geoLayerUrl, isGeoDataset, floorKey, joinKey,
  getApprovedPlanAlignments, storedPlanAlignments,
} from './api/reference'
export type { ReferenceDataset, PlanFloor } from './api/reference'
