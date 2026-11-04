import { splitDuplicateTruppIds } from './mergeWorkspace'
import { nextTruppNo } from './placedTrupps'
import type { ReportSignature } from './reportSignature'
import { ghostCounterNames } from './truppTrails'
import type { TruppTrail } from './truppTrails'
import type { AttendanceState, BoardAnno, BoardDoc, BoardKind, BoardPoint, BuildingDoc, CameraView, DrawKind, Drawing, Entity, EntityKind, GeoTrailPoint, LayerDef, LayerId, LngLat, MittelEntry, ReportAttachment, Shift, ShiftBand, TimelineEvent, TrailPoint, Trupp, TruppReading, WeatherData } from '../types'
import { appConfig } from '../config/appConfig'
import { layers as initialLayers, planDocuments } from '../data/demoIncident'
import { referenceLayersFromConfig } from './deploymentConfig'
import { UNDERGROUND_LAYER_ID, undergroundLayerDef } from './underground'
import { keyCartoTileTemplates, retinaCartoTileTemplates } from './carto'
import { loadLayerPrefs } from './layerPrefs'
import { isSafeColor } from './shapes'
import { HOSE_SIZES } from './hydraulics'
import { sanitizeSvgResult } from './sanitizeSvg'
import { minPoints } from './vertexOps'
import { isFormData } from './boardForm'
import type { ChecklistState } from './checklists'
import { objectsFromLegacy, viewsOf, type TacticalObject } from './tacticalObjects'
import { bearing360 } from './planProjection'
import { isIncidentPlanBinding, type IncidentPlanBinding } from './incidentPlanBindings'
import type { KrokiView } from './report'
import type { Workspace } from './api/workspace'
import type { PlanScale } from './planScale'
import type { VehicleOverrides } from './useVehicleLayer'

/** Per-plan distance calibration, keyed by PlanDocument id (see lib/planScale). */
export type PlanScales = Record<string, PlanScale>

/** One partner-organisation contact row in the report (Polizei, Sanität, Werkhof …). */
export interface PartnerContact {
  org: string
  name?: string
  phone?: string
  note?: string
}

export interface ReportMeta {
  alarmText?: string
  summary?: string
  startedAt?: string
  endedAt?: string
  remarks?: string
  /** Lehren / Sicherheit — debrief notes (what to learn, safety observations) for the rapport */
  lehren?: string
  /** Kontaktperson on scene (owner / Melder / person in charge) */
  kontaktperson?: string
  /** Kontaktperson's phone number — kept next to the name so the Nachbearbeitung (a callback
   *  about the damage, the owner who has to be reached tomorrow) does not depend on someone
   *  having copied it into the Kurzbericht. Free text as typed; dialing normalizes (telHref). */
  kontaktpersonTelefon?: string
  /** «Entfällt» — the Kontaktperson step ANSWERED rather than left blank.
   *
   *  A Fehlalarm in an empty Altersheim and an Ölspur on a Kantonsstrasse have nobody to name,
   *  and without a way of saying so the step stayed open forever: the rapport could never reach
   *  complete, and every single print opened with «Angaben fehlen noch» — the dialog that has to
   *  mean something on the Einsatz where something really is missing. Same escape
   *  `mittelConfirmedNone` has given the Mittel step all along; «nicht ausgefüllt» and «gibt es
   *  nicht» are two different answers and only one of them was recordable. */
  kontaktpersonNone?: boolean
  /** Einsatzleiter — picked from the Mannschaft roster (free text allowed) */
  einsatzleiter?: string
  /** Alarmierungszeit (prefilled from the Divera alarm / incident start) */
  alarmiertAt?: string
  /** Ausrückzeit — manual for now; future enhancement: derive from first vehicle GPS movement. */
  ausgeruecktAt?: string
  /** contact details of the Partnerorganisationen involved */
  partnerContacts?: PartnerContact[]
  /** Abschluss-Assistent: «keine Mittel verwendet» explicitly confirmed — the Mittel step
   *  counts as complete with zero entries only when someone said so, never by silence. */
  mittelConfirmedNone?: boolean
  /** Alarmierzeit per alarmed Gruppe — ids from config `alarms.groups`; prefilled by
   *  the milestone webhook, `manual: true` entries are the operator's and never
   *  auto-overwritten. Unknown ids render as unmatched lines, never dropped. */
  gruppen?: GruppeZeit[]
  /** Fahrzeug timeline (Ausrückzeit / Vor Ort / Zurück) — ids from config
   *  `fleet.vehicles`; same prefill/manual semantics as `gruppen`. The header
   *  Ausgerückt is DERIVED from these once any exist (deriveAusgerueckt). */
  fahrzeuge?: FahrzeugZeit[]
  /** How the Kroki was framed for the LAST print of this Einsatz — the crop, the moment it
   *  shows, and the page shape. Remembered so a reprint (a correction, a second copy for the
   *  Gemeinde) comes out of the same window instead of being framed from scratch. */
  krokiPrint?: { view?: KrokiView; at?: string; landscape?: boolean }
  /** When a rapport was last PRODUCED from this Einsatz — a PDF downloaded, or a station print
   *  job the relay has reported `done`. It is what lets the Rapport say «der Einsatz ist noch
   *  offen» at the one moment that is actually true — the paper exists, everything is filled in,
   *  and only the bookkeeping is left. In the blob rather than on the device because the Einsatz
   *  is worked on from several of them: whoever opens the Rapport next should see that the paper
   *  has already been made.
   *
   *  ⚠️ A QUEUED job does NOT stamp this (fixed 22.08.). It used to be set the instant the job
   *  left the device — including straight after the confirm that said «Stationsdrucker offline» —
   *  and this stamp alone drives the «Rapport erstellt. Der Einsatz ist noch offen –
   *  abschliessen?» band. So the app offered to close an Einsatz whose rapport did not exist on
   *  any sheet of paper anywhere. See `printJob` for the state in between. */
  reportMadeAt?: string
  /** The station print job this rapport is waiting on: set when it is queued, cleared when the
   *  relay reports a terminal status. «In der Warteschlange» is a state of its own, not a
   *  weaker «gesendet» — so it lives on the blob (visible after a reload and on the next
   *  device) rather than only inside the toast that announced it, which is gone in seconds. */
  printJob?: { id: string; at: string }
  /** Gerettete: people / animals (counts; absent ≠ 0 — absent means not recorded) */
  gerettete?: { personen?: number; tiere?: number }
  /** «Keine» — nobody and nothing was rescued, said out loud (04.09., Rapport-Review).
   *
   *  ⚠️ The whole point is that `gerettete` being absent no longer has to carry four meanings at
   *  once. On the 03.09. Rapport the field was empty, and empty could mean: nobody was rescued ·
   *  it was never looked into · it was rescued but not recorded · it does not apply here. With
   *  this flag, empty means exactly one of them — not recorded — and the other answer has
   *  somewhere to go. Same escape `kontaktpersonNone`, `rueckmeldungNone` and
   *  `mittelConfirmedNone` already are; the word is «Keine» rather than «Entfällt» because a
   *  rescue is a thing that either happened or did not, not a section that can be irrelevant. */
  geretteteNone?: boolean
  /** who recorded via the Erfassung (/e/) — comma-separated, each person once */
  erfasser?: string
  /** Rückmeldung to the ELZ: who reported back, and when */
  rueckmeldungElz?: { name?: string; at?: string }
  /** «Entfällt» for the Rückmeldung ELZ — the same deliberate answer as `kontaktpersonNone`,
   *  for the Einsatz the ELZ was never told about because there was nothing to tell. */
  rueckmeldungNone?: boolean
  /** Which of the station's Rapport-Links (config `report.links`, see lib/reportLinks) have
   *  been dealt with on THIS Einsatz — link id → the instant it was ticked.
   *
   *  ⚠️ The tick is always a person's, never the app's: opening a form tells us nothing about
   *  whether it was submitted, so nothing here is ever set automatically. It lives in the blob
   *  rather than on the device because the Einsatz is worked from several of them — whoever
   *  opens the Rapport next has to see that the Getränke-Formular is already away. */
  linksDone?: Record<string, string>
}

export interface GruppeZeit {
  id: string
  alarmedAt?: string
  /** set by an operator edit — the milestone webhook keeps its hands off */
  manual?: boolean
}

export interface FahrzeugZeit {
  id: string
  ausgerueckt?: string
  vorOrt?: string
  zurueck?: string
  manual?: boolean
  /** What the SERVER observed from GPS (backend · app/vehicle_presence, 24.09.2026). Written by
   *  the scheduler only, never by a device; read by the vehicle table and the Rapport's «n
   *  Fahrten» (lib/vehiclePresence). `manual` protects the times above, not this. */
  gps?: FahrzeugGps
}

export interface FahrzeugGps {
  zone: 'scene' | 'away'
  /** the Traccar device id — the live fix age comes from the positions feed under it */
  device?: number
  /** first arrival on scene (the tracker's report time, Traccar `deviceTime`) */
  an?: string
  /** last departure from scene (same clock) — NOT `zurueck`, which is «back at the depot» */
  ab?: string
  /** stays on scene — 3 for a vehicle that shuttled to the depot twice */
  fahrten?: number
  /** the Rapport clocks the server stamped first (first writer wins against the geofence) */
  owns?: 'vorOrt'[]
}

/** Per-incident, SYNCED operational settings — part of the workspace blob, so they
 *  apply identically on every device monitoring this incident (unlike device prefs
 *  like theme/symbol-size which live in the cookie). Absent fields fall back to the
 *  appConfig doctrine defaults. */
export interface IncidentSettings {
  /** Atemschutz Funkkontakt-Intervall (min): contact fällig (amber) from this mark.
   *  Safety-critical, so it MUST be shared across devices — hence synced, not a pref. */
  contactIntervalMin?: number
  /** grace period (sec) on top of the interval before the hard überfällig alarm fires */
  contactGraceSec?: number
  /** default Funkkanal a new Atemschutz-Trupp is seeded with (FKS standard: 11) */
  defaultFunkkanal?: number
}

/** The safety values, in the order the Einstellungen sheet asks them. */
export const SAFETY_KEYS = ['contactIntervalMin', 'contactGraceSec', 'defaultFunkkanal'] as const

/**
 * The station range of the Atemschutz contact clock (owner, 26.10.2026, audit F02): the
 * Funkkontakt-Intervall in minutes and the Nachfrist in seconds. One rule for the /admin doctrine
 * field, a stored per-Einsatz override (dropped at load when outside, below) and the push sweep —
 * the backend twin is `alarm_validation · CONTACT_INTERVAL_MIN / CONTACT_GRACE_SEC`.
 */
export const CONTACT_BOUNDS = {
  contactIntervalMin: { min: 1, max: 30 },
  contactGraceSec: { min: 0, max: 300 },
} as const

/** The words `Trupp.status` may hold (types · Trupp.status; backend `TruppStatus`). */
const TRUPP_STATUSES: ReadonlySet<string> = new Set<Trupp['status']>(['angemeldet', 'aktiv', 'rueckzug', 'ueberfaellig', 'raus'])

// The persisted-workspace model, extracted from App's god component: the `Saved` blob
// shape, the editable `Doc`, and the pure functions that normalize/derive App's initial
// state from a blob. No React here — kept separate so hooks/components can share it.

export type Doc = { entities: Entity[]; drawings: Drawing[] }

/** The persisted workspace blob — opaque to the backend; the frontend owns its shape. */
export type Saved = {
  entities: Entity[]; drawings: Drawing[]; recent: string[]
  /** The unified tactical objects (schema 2, docs/tactical-objects.md) — ONE record per
   *  object, whatever surface it stands on; `entities`/`drawings`/`board` above become its
   *  derived views. Both are written on save: the views keep an un-updated device rendering
   *  (its next save drops `objects`, and the loader re-unifies from the views — only baked
   *  bodies are lost, and the write-through regenerates those). Absent = a legacy blob;
   *  deriveInitial migrates it on load. */
  objects?: TacticalObject[]
  layerState: { id: LayerId; visible: boolean; opacity?: number }[]; timeline: TimelineEvent[]
  board?: BoardDoc; activePlanId?: string; activeModule?: string
  /** the manually-picked Einsatzobjekt (PlanPicker «anderes Objekt»), synced per incident so it
   *  survives switching incidents AND shows the same plans on every device. Undefined → the
   *  auto-surfaced nearest object. (Was a single global device cookie; now lives in the blob.) */
  pickedObjectId?: string
  /** per-plan distance calibration (planId → scale factor); lets the Plan whiteboard show
   *  real metres once a printed reference is measured. See lib/planScale. */
  planScale?: PlanScales
  /** selected building promoted into the floor-stack ("Gebäude" doc) */
  building?: BuildingDoc | null
  /** manual position/orientation overrides for live GPS vehicles, keyed by entity id */
  vehicleOverrides?: VehicleOverrides
  /** per-incident checklist tick state (templateId → ticks + chosen branches) */
  checklists?: ChecklistState
  /** Atemschutzüberwachung: monitored breathing-apparatus teams */
  trupps?: Trupp[]
  /** per-incident attendance (who is physically present), keyed by Person id */
  attendance?: AttendanceState
  /** per-incident Mittel (material-use) — append-only event log; current state derived */
  mittel?: MittelEntry[]
  /** Schichtenplanung: planned availability per person (a PLAN, never the attendance record) */
  shifts?: Shift[]
  /** Schichtenplanung: the named time windows the Schichten grid puts up as columns. Inert —
   *  a band assigns nobody; a shift joins one by carrying its `bandId`. */
  bands?: ShiftBand[]
  /** saved map views (camera bookmarks): position + zoom + rotation, shared with the team */
  cameraViews?: CameraView[]
  /** «Spuren» a Trupp marker left behind — the searched area, kept by the incident after the
   *  chip/marker that recorded it was removed (lib/truppTrails). A NEW key only: the markers'
   *  own `trail` fields are untouched, so an older client reads this incident unchanged and
   *  simply does not draw the ghosts. */
  trails?: TruppTrail[]
  /** Einsatzrapport metadata: supplemental bookkeeping text, not tactical state. */
  reportMeta?: ReportMeta
  /** Beilagen: photos that belong to the Rapport (documents, damage) rather than to the Verlauf */
  attachments?: ReportAttachment[]
  /** the Rapport's digital signatures (lib/reportSignature): appended, only ever voided, never
   *  deleted — a RECORD key, so it is accepted on a closed Einsatz, where signing happens */
  reportSignatures?: ReportSignature[]
  /** the exact plan sheets this incident opened — dataset revision + approved fit, frozen at
   *  first open so a later station replacement/approval never moves an operational backdrop
   *  (lib/incidentPlanBindings). First binding per sheet wins; corrections ride `override`. */
  planBindings?: IncidentPlanBinding[]
  /** per-incident synced operational settings (see IncidentSettings) */
  settings?: IncidentSettings
  /** When the dispatch's guesses (Stichwort, Kategorie, Ort) were confirmed or corrected — the
   *  «Einsatzdaten prüfen» banner's one-shot stamp, see lib/incidentAlerts · needsIntakeReview.
   *
   *  On the blob rather than on the device because the question is asked ONCE of the crew, not
   *  once of every tablet: until 25.08. this was a localStorage set, so the Einsatz that had
   *  already been checked at the desk still nagged the phone, the second tablet and everyone who
   *  joined later. Whoever taps «Passt» stamps it here, and the next poll retires the banner
   *  everywhere. Only an editor can write it; the device set stays as the offline fallback. */
  intakeReviewedAt?: string
  /** weather reading at the reconstructed instant — populated only by the replay fold
   *  (from `weather.observe` events), never persisted in live saves. */
  weather?: WeatherData | null
  schemaVersion?: number
}

type LegacyBoardAnno = Omit<BoardAnno, 'kind'> & { kind: BoardAnno['kind'] | 'trupp' }
const TEAM_COLORS = appConfig.drawing.colors

// Rauch used to be a `kind:'shape'` cloud; it is now the real «VKF Rauch» symbol (detail modal
// + Entwicklung/spread, both surfaces). Idempotently convert any already-placed cloud — map
// entity OR plan anno — so it gains the symbol behaviour: keep id/coord (or x,y,floor)/rotation,
// drop the shape-only sizing (symbols are fixed-scale; extent is expressed via spread). A no-op
// once no clouds remain, so it can run on every load without a schema-version bump.
export const RAUCH_SYMBOL = 'VKF Rauch'
export function migrateRauchCloud<T extends { kind?: string }>(a: T): T {
  const o = a as Record<string, unknown>
  if (o.kind !== 'shape' || o.shape !== 'cloud') return a
  const next: Record<string, unknown> = { ...o, kind: 'symbol', symbol: RAUCH_SYMBOL, label: 'Rauch' }
  delete next.shape; delete next.sizeM; delete next.sizeN; delete next.color
  return next as unknown as T
}

// Per-plan normalization: migrate the old 'trupp' kind to 'resource', and give every team
// an accent colour (cycled from the palette) so older saved docs — which predate per-team
// colours — still get distinguishable trails.
export const normalizeBoard = (board?: BoardDoc): BoardDoc => {
  if (!board) return {}
  return Object.fromEntries(Object.entries(board).map(([id, annos]) => {
    let teamIdx = 0
    return [id, annos.map((anno) => {
      const legacy = anno as LegacyBoardAnno
      const a = migrateRauchCloud(legacy.kind === 'trupp' ? { ...legacy, kind: 'resource' as const } : { ...anno })
      if (a.kind === 'resource') a.color = a.color ?? TEAM_COLORS[teamIdx++ % TEAM_COLORS.length]
      return a
    })]
  }))
}

/** Version stamped into every saved blob (App's buildPayload). Bump on a breaking shape
 *  change and add a stepwise migration in `sanitizeWorkspace` for the older versions. */
// v2 (09.09.): the unified `objects` collection joins the blob.
// The legacy collections are still written as views, so a v1 reader renders — see Saved.objects.
// v3 (10.10.2026): Tafel pages (board kind `form`). A v2 build cannot keep what it cannot read in
// every path, so the SERVER keeps a v3 kind for it: a save stamped below the version a stored
// object's kind came with never removes that object (backend · workspace_kinds).
export const WORKSPACE_SCHEMA_VERSION = 3

/** Result of the load gate: the sanitized blob plus an honest account of what happened. */
export interface WorkspaceGate {
  ws: Saved | null
  /** malformed entries dropped (from collections) or wrong-typed fields reset */
  dropped: number
  /** blob was stamped by a NEWER app version — loaded best-effort, caller should warn */
  newerSchema: boolean
}

/** What the gate SAYS about a blob (useWorkspaceBlob's Meldungen). A blob from a newer build is
 *  ONE message, «Neuere App-Version nötig»: what this build skipped in it is newer things it does
 *  not know, not damage, so it is never also «n beschädigte Einträge» (sweep 30.10.2026 #19). */
export const gateReport = (g: WorkspaceGate): { newer: boolean; skipped: number } =>
  ({ newer: g.newerSchema, skipped: g.newerSchema ? 0 : g.dropped })

const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v)
const hasId = (v: unknown): v is Record<string, unknown> & { id: string } => isObj(v) && typeof v.id === 'string' && v.id.length > 0
const num = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v)

// --- Shape predicates ---------------------------------------------------------------------
// One malformed OBJECT in a synced collection used to take every device down together: the
// gate below only asked «object with a string id», and the first consumer of a `line` whose
// `coords` was null was a first-render useMemo — so the boundary fired before any surface
// mounted, «Neu laden» re-pulled the same blob, and «Lokale Kopie verwerfen» too (verified
// 25.07.). These predicates ask the question each renderer would otherwise ask by throwing.

/** Every member of a string union as a Set, checked BOTH ways at compile time: each listed value
 *  must be in the union (`readonly T[]`), and every union member must be listed (the intersection
 *  with `Complete` collapses to `never` when one is missing). So a kind added to `types.ts`
 *  without a row here fails `tsc` instead of being silently dropped from every incident. */
type Complete<T extends string, U extends readonly string[]> = Exclude<T, U[number]> extends never ? unknown : never
const kindSet = <T extends string>() => <const U extends readonly T[]>(u: U & Complete<T, U>): ReadonlySet<string> => new Set<string>(u)
const ENTITY_KINDS = kindSet<EntityKind>()(['symbol', 'vehicle', 'note', 'photo', 'shape', 'team', 'person'])
const DRAW_KINDS = kindSet<DrawKind>()(['line', 'area', 'circle'])
/** every board kind this build draws (and the server's version table lists – lib/boardKinds.test) */
export const BOARD_KINDS = kindSet<BoardKind>()(['draw', 'area', 'circle', 'text', 'symbol', 'shape', 'resource', 'form'])
/** the pre-'resource' board kind, still accepted at the gate because normalizeBoard migrates it */
const LEGACY_BOARD_KINDS: ReadonlySet<string> = new Set([...BOARD_KINDS, 'trupp'])
/** fewest vertices a drawing of each kind can render with (a circle is its centre) */
const MIN_DRAW_PTS: Record<DrawKind, number> = { circle: 1, line: 2, area: 3 }
/** The numbers that describe the ARTWORK of an object — its outline weight, its wash, the box the
 *  glyph is stretched into. Anything unusable is dropped at the gate (sanitizeWorkspace ·
 *  fixDrawProps) rather than carried into the renderers' arithmetic, where a NaN paints an empty
 *  shape and a string paints a shape nobody chose. Mirrored server-side
 *  (backend/app/schemas.py · _NUMERIC_DRAWING_KEYS). */
const DRAW_NUMBERS = ['aspect', 'fillOpacity', 'rotation', 'rotation2', 'sizeM', 'sizeN', 'strokeW', 'width'] as const
/** …of which these are bearings, and a bearing is said once: in [0, 360) (planProjection · bearing360). */
const BEARINGS = ['rotation', 'rotation2'] as const

const lngLat = (v: unknown): v is LngLat =>
  Array.isArray(v) && v.length === 2 && num(v[0]) && num(v[1]) && Math.abs(v[0]) <= 180 && Math.abs(v[1]) <= 90
const boardPt = (v: unknown): v is BoardPoint => Array.isArray(v) && (v.length === 2 || v.length === 3) && v.every(num)
const isReading = (v: unknown): v is TruppReading => isObj(v) && typeof v.t === 'string' && num(v.bar) && typeof v.kind === 'string'
const isGeoTrailPt = (v: unknown): v is GeoTrailPoint => isObj(v) && lngLat(v.coord) && typeof v.t === 'string'
const isTrailPt = (v: unknown): v is TrailPoint => isObj(v) && num(v.x) && num(v.y) && typeof v.t === 'string'
/** A ghost trail is only a trail while it still holds the points it was made of — one with
 *  neither frame filled draws nothing and would only ever be a row nobody can see or delete. */
/** a signature that can be shown and printed: its role, signer, scope hash and strokes are there */
const isReportSignature = (v: unknown): v is ReportSignature =>
  hasId(v) && (v.role === 'el' || v.role === 'kdt') && typeof v.name === 'string' && typeof v.at === 'string'
  && typeof v.scope === 'string' && isObj(v.strokes) && Array.isArray((v.strokes as { d?: unknown }).d)
const isTruppTrail = (v: unknown): v is TruppTrail =>
  hasId(v) && typeof v.sourceId === 'string' && (Array.isArray(v.points) || Array.isArray(v.geo))

/** A map entity the markers can place: known kind and a finite, in-range [lng, lat]. */
export const isEntity = (v: unknown): v is Entity =>
  hasId(v) && typeof v.kind === 'string' && ENTITY_KINDS.has(v.kind) && lngLat(v.coord)
/** A drawing the map can render: known kind, enough finite vertices for it, and a radius for a circle. */
export const isDrawing = (v: unknown): v is Drawing =>
  hasId(v) && typeof v.kind === 'string' && DRAW_KINDS.has(v.kind)
  && Array.isArray(v.coords) && v.coords.length >= MIN_DRAW_PTS[v.kind as DrawKind] && v.coords.every(lngLat)
  && (v.kind !== 'circle' || num(v.radiusM))
/** A plan annotation the Whiteboard can draw: ink needs enough finite vertices, everything else an anchor. */
export const isBoardAnno = (v: unknown): v is BoardAnno =>
  hasId(v) && typeof v.kind === 'string' && LEGACY_BOARD_KINDS.has(v.kind)
  // a Tafel page is sheet-wide (no anchor) and renders its lists straight away — a malformed
  // one is dropped here, not thrown there (lib/boardForm · isFormData)
  && (v.kind === 'form' ? isFormData(v.form)
    : v.kind === 'draw' || v.kind === 'area'
      ? Array.isArray(v.pts) && v.pts.length >= minPoints(v.kind) && v.pts.every(boardPt)
      : num(v.x) && num(v.y))
/** The board kinds this build DRAWS on a sheet (a Tafel page is drawn as a page, not on it). */
const DRAWN_BOARD_KINDS: ReadonlySet<string> = new Set([...LEGACY_BOARD_KINDS].filter((k) => k !== 'form'))
export const isDrawnBoardKind = (kind: string): boolean => DRAWN_BOARD_KINDS.has(kind)
/**
 * A board object this build does not understand — a kind it has never heard of, or a Tafel page
 * it cannot draw (lib/boardForm · isFormData) — but must KEEP. ⚠️ The rule for every board
 * object (review of #338, 10.10.2026): such a PASSENGER rides through load, merge and save
 * untouched and is never drawn. Dropping it at the gate made this device's next save a deletion
 * for every device that does understand it (an older build deleting a newer build's Tafel pages).
 * The server keeps the same promise for builds older than a kind (backend · workspace_kinds).
 */
export const isPassengerAnno = (v: unknown): boolean =>
  hasId(v) && typeof v.kind === 'string' && v.kind.length > 0
  && (!LEGACY_BOARD_KINDS.has(v.kind) || (v.kind === 'form' && !isFormData(v.form)))
/** A Gebäude doc the floor-stack can open: at least one finite storey and a footprint of some shape. */
export const isBuilding = (v: unknown): v is BuildingDoc =>
  isObj(v) && Array.isArray(v.floors) && v.floors.length > 0 && v.floors.every(num)
  && (Array.isArray(v.rings) || Array.isArray(v.ring) || Array.isArray(v.src))

/**
 * Gate + sanitize a workspace blob BEFORE deriveInitial: a cached (IndexedDB) or server blob
 * can be stale, hand-edited, or written by a different app version, and one malformed entry
 * must never take down a live incident. Version-gate first (a newer blob loads best-effort
 * and is flagged; an older one runs stepwise migrations — none exist yet), then keep every
 * well-formed entry and drop the malformed rest, counting losses so the caller can surface
 * them instead of failing silently. Deliberately predicate-based (the shape predicates above),
 * not a full schema: deep validation belongs to the type system at write time, this is the
 * last-line crash guard at read time.
 *
 * Two verbs, on purpose: geometry that cannot render is DROPPED (the object is unusable), while
 * the string fields the panels `.trim()` / `.localeCompare()` are COERCED to '' — a Trupp without
 * a name is still a crew under air, and losing its clock over a missing label is the wrong trade.
 */
export function sanitizeWorkspace(raw: unknown): WorkspaceGate {
  if (raw == null) return { ws: null, dropped: 0, newerSchema: false }
  if (!isObj(raw)) return { ws: null, dropped: 1, newerSchema: false }
  let dropped = 0
  // `ok` is a plain boolean for the id-only collections (hasId narrows to less than T); the
  // shape-gated ones pass a real predicate and read as T either way
  const arr = <T,>(v: unknown, ok: (x: unknown) => boolean, fix?: (x: T) => T): T[] | undefined => {
    if (v == null) return undefined
    if (!Array.isArray(v)) { dropped++; return undefined }
    const kept = v.filter(ok) as T[]
    dropped += v.length - kept.length
    return fix ? kept.map(fix) : kept
  }
  const rec = <T,>(v: unknown): T | undefined => {
    if (v == null) return undefined
    if (!isObj(v)) { dropped++; return undefined }
    return v as T
  }
  const str = (v: unknown): string | undefined => (typeof v === 'string' ? v : undefined)
  // Coerce the named string fields on one object to strings; a present wrong-typed value counts
  // as a reset, an absent one is quietly '' (an older writer simply did not know the field).
  const strFields = <T extends object>(o: T, keys: (keyof T & string)[]): T => {
    const r = o as Record<string, unknown>
    if (keys.every((k) => typeof r[k] === 'string')) return o
    const out = { ...r }
    for (const k of keys) if (typeof out[k] !== 'string') { if (out[k] != null) dropped++; out[k] = '' }
    return out as T
  }
  // A third verb, for the handful of fields that end up INSIDE the artwork: they are REMOVED, so
  // the renderer falls back to its own default. A colour becomes an SVG attribute value on both
  // surfaces and on paper (lib/shapes), and a cached or synced blob is free text — one carrying a
  // quote used to close that attribute and open an event handler in the next operator's browser
  // (SEC-01). Mirrored at the write end (backend/app/schemas.py · _scrub_drawing_props), so this
  // is what protects a device whose IndexedDB copy predates that.
  const fixDrawProps = <T extends object>(o: T): T => {
    const r = o as Record<string, unknown>
    let out: Record<string, unknown> | undefined
    if (r.color != null && !isSafeColor(r.color)) { out = { ...r }; delete out.color; dropped++ }
    // a Leitung's Ø outside the four (lib/hydraulics · HOSES) would throw in the Wassertransport's
    // plan: dropped, so the line reads as the default 75 mm
    if (r.hose != null && !(HOSE_SIZES as readonly unknown[]).includes(r.hose)) { out = out ?? { ...r }; delete out.hose; dropped++ }
    for (const k of DRAW_NUMBERS) {
      if (r[k] == null || num(r[k])) continue
      out = out ?? { ...r }
      delete out[k]
      dropped++
    }
    // ⚠️ …and a bearing outside [0, 360) loads as its mod-360 equivalent (24.09.2026). The
    // Feueralarm of 23.09. stored Lüfter at 66 735° and 3 931° (lib/tacticalObjects ·
    // sheetBearings): they paint the same either way, but a number that size is no bearing anyone
    // can read or step back by hand. Mod ONLY — never «repaired» toward what the operator meant —
    // and not counted as a loss, because nothing was lost.
    for (const k of BEARINGS) {
      const v = (out ?? r)[k]
      if (!num(v) || (v >= 0 && v < 360)) continue
      out = out ?? { ...r }
      out[k] = bearing360(v)
    }
    // …and `symbolSvg`, a live-vehicle/twin glyph that also ends up in the DOM (lib/symbolRender ·
    // TacticalSymbol → dangerouslySetInnerHTML). The render sink already sanitises it, but a
    // poisoned STORED value must be cleaned as it loads — not merely hidden at paint — so a device
    // whose IndexedDB copy predates this gate, and every reader that is NOT TacticalSymbol (the
    // ContextPanel's own sink), see safe markup. A clean glyph is left byte-for-byte untouched
    // (only a hostile one is rewritten/dropped, and only that counts). SEC-01.
    if (typeof r.symbolSvg === 'string' && r.symbolSvg) {
      const res = sanitizeSvgResult(r.symbolSvg)
      if (res.modified) {
        out = out ?? { ...r }
        if (res.svg) out.symbolSvg = res.svg
        else delete out.symbolSvg
        dropped++
      }
    }
    return (out ?? o) as T
  }
  const fixTrupp = (t: Trupp): Trupp => {
    let o = fixDrawProps(strFields(t, ['name'])) as Trupp & { readings?: unknown; equipment?: unknown }
    // The words that decide monitoring (audit F01): an unknown `kind` is removed — absent means
    // Atemschutz, so the crew stays watched — and an unknown `status` becomes the phase its stamps
    // say. Kept as stored, the next edit of the crew would be refused by the server.
    if (o.kind != null && o.kind !== 'atemschutz' && o.kind !== 'einfach') {
      const { kind: _drop, ...rest } = o
      o = rest
      dropped++
    }
    if (o.status != null && !TRUPP_STATUSES.has(o.status)) {
      o = { ...o, status: o.exitTime ? 'raus' : o.entryTime ? 'aktiv' : 'angemeldet' }
      dropped++
    }
    // The crew lists every label trims (lib/atemschutz · truppLogName): a `null` in there threw on
    // every device (audit F03). Only the bad entries go — the crew, its clocks and the rest stay.
    for (const key of ['members', 'memberPersonIds'] as const) {
      const v: unknown = o[key]
      if (v == null) continue
      const ok = Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : []
      if (Array.isArray(v) && ok.length === v.length) continue
      o = { ...o, [key]: ok }
      dropped++
    }
    if (o.leaderPersonId != null && typeof o.leaderPersonId !== 'string') {
      const { leaderPersonId: _drop, ...rest } = o
      o = rest
      dropped++
    }
    // the Ausrüstung ids (types · Trupp.equipment): a list of non-empty strings, each once, or
    // nothing at all — a stray object or number in there would reach the card and the Rapport
    if (o.equipment != null) {
      const ids = Array.isArray(o.equipment)
        ? [...new Set(o.equipment.filter((x): x is string => typeof x === 'string' && x.trim() !== ''))] : []
      if (!Array.isArray(o.equipment) || ids.length !== o.equipment.length) dropped++
      const { equipment: _drop, ...rest } = o
      o = ids.length ? { ...rest, equipment: ids } : rest
    }
    if (o.readings == null) return o
    const readings = arr<TruppReading>(o.readings, isReading)
    return { ...o, readings }
  }
  // board needs one level more: normalizeBoard maps over each doc's anno ARRAY, so a
  // non-array value (or non-object anno) would crash it — and past that, the Whiteboard
  // derefs `pts` / `x` / `y` per kind
  const board = ((): BoardDoc | undefined => {
    const b = rec<Record<string, unknown>>(raw.board)
    if (!b) return undefined
    const out: BoardDoc = {}
    for (const [k, v] of Object.entries(b)) {
      const annos = arr<BoardAnno>(v, (a): a is BoardAnno => isBoardAnno(a) || isPassengerAnno(a),
        (a: BoardAnno) => (isPassengerAnno(a) ? a : fixDrawProps(a.trail == null ? a : { ...a, trail: arr<TrailPoint>(a.trail, isTrailPt) })))
      if (annos) out[k] = annos
    }
    return out
  })()
  // Numeric doctrine overrides: anything that is not a usable number is REMOVED, not kept —
  // `NaN * 60` in the überfällig arithmetic silently disables the alarm, and an absent key
  // falls back to the station doctrine. Only the Nachfrist may be zero (a real setting).
  const settings = ((): IncidentSettings | undefined => {
    const s = rec<Record<string, unknown>>(raw.settings)
    if (!s) return undefined
    const out: IncidentSettings = {}
    for (const key of SAFETY_KEYS) {
      const v = s[key]
      if (v == null) continue
      const ok = num(v) && (key === 'defaultFunkkanal'
        ? v > 0 && Number.isInteger(v)
        : v >= CONTACT_BOUNDS[key].min && v <= CONTACT_BOUNDS[key].max)
      if (ok) out[key] = v
      else dropped++
    }
    return out
  })()
  const building = ((): BuildingDoc | null | undefined => {
    if (raw.building == null) return raw.building
    if (isBuilding(raw.building)) return raw.building
    dropped++
    return null // deriveInitial reads null as «no Gebäude»; a half doc would crash the Kroki
  })()
  // The unified objects (schema 2): each body passes the same shape gate its legacy
  // collection did — a malformed body is dropped from the object, an object with no valid
  // body left is dropped whole. Presence of `sheet` is the anchor, so it needs planId + anno.
  const objects = ((): TacticalObject[] | undefined => {
    if (raw.objects == null) return undefined
    if (!Array.isArray(raw.objects)) { dropped++; return undefined }
    const out: TacticalObject[] = []
    for (const v of raw.objects) {
      if (!hasId(v)) { dropped++; continue }
      const entity = isEntity(v.entity)
        ? migrateRauchCloud(fixDrawProps(v.entity.trail == null ? v.entity : { ...v.entity, trail: arr<GeoTrailPoint>(v.entity.trail, isGeoTrailPt) }))
        : (v.entity != null ? (dropped++, undefined) : undefined)
      const drawing = entity == null && isDrawing(v.drawing)
        ? fixDrawProps(v.drawing)
        : (entity == null && v.drawing != null ? (dropped++, undefined) : undefined)
      const sheet = ((): TacticalObject['sheet'] => {
        if (v.sheet == null) return undefined
        const s = v.sheet as Record<string, unknown>
        if (!isObj(s) || typeof s.planId !== 'string') { dropped++; return undefined }
        // a passenger is kept exactly as it came (isPassengerAnno) — no fix-up, no migration
        if (isPassengerAnno(s.anno)) return { planId: s.planId, anno: s.anno as BoardAnno }
        if (!isBoardAnno(s.anno)) { dropped++; return undefined }
        const anno = migrateRauchCloud(fixDrawProps(s.anno.trail == null ? s.anno : { ...s.anno, trail: arr<TrailPoint>(s.anno.trail, isTrailPt) }))
        return { planId: s.planId, anno }
      })()
      if (!entity && !drawing && !sheet) { dropped++; continue }
      out.push({ id: v.id, entity, drawing, sheet })
    }
    return out
  })()
  const sv = typeof raw.schemaVersion === 'number' ? raw.schemaVersion : undefined
  const ws: Saved = {
    objects,
    entities: (arr<Entity>(raw.entities, isEntity, (e) => fixDrawProps(e.trail == null ? e : { ...e, trail: arr<GeoTrailPoint>(e.trail, isGeoTrailPt) })) ?? []).map(migrateRauchCloud),
    drawings: arr<Drawing>(raw.drawings, isDrawing, fixDrawProps) ?? [],
    recent: arr<string>(raw.recent, (x) => typeof x === 'string') ?? [],
    layerState: arr<Saved['layerState'][number]>(raw.layerState, (x) => hasId(x) && typeof x.visible === 'boolean') ?? [],
    timeline: arr<TimelineEvent>(raw.timeline, hasId, (e) => strFields(e, ['text', 't'])) ?? [],
    board,
    activePlanId: str(raw.activePlanId),
    activeModule: str(raw.activeModule),
    pickedObjectId: str(raw.pickedObjectId),
    planScale: rec<PlanScales>(raw.planScale),
    building,
    vehicleOverrides: rec<VehicleOverrides>(raw.vehicleOverrides),
    checklists: rec<ChecklistState>(raw.checklists),
    trupps: ((list) => {
      // two Trupps under one id (audit F04) — split before anything merges by id (mergeWorkspace ·
      // splitDuplicateTruppIds); each removed copy or renamed crew counts as a repair
      if (!list) return list
      const split = splitDuplicateTruppIds(list)
      dropped += split.repaired
      return split.list
    })(arr<Trupp>(raw.trupps, hasId, fixTrupp)),
    attendance: rec<AttendanceState>(raw.attendance),
    mittel: arr<MittelEntry>(raw.mittel, hasId, (e) => strFields(e, ['label', 'unit'])),
    shifts: arr<Shift>(raw.shifts, hasId),
    bands: arr<ShiftBand>(raw.bands, hasId, (b) => strFields(b, ['label'])),
    cameraViews: arr<CameraView>(raw.cameraViews, hasId),
    trails: arr<TruppTrail>(raw.trails, isTruppTrail),
    reportMeta: rec<ReportMeta>(raw.reportMeta),
    attachments: arr<ReportAttachment>(raw.attachments, hasId),
    reportSignatures: arr<ReportSignature>(raw.reportSignatures, isReportSignature),
    planBindings: arr<IncidentPlanBinding>(raw.planBindings, isIncidentPlanBinding),
    settings,
    intakeReviewedAt: str(raw.intakeReviewedAt),
    schemaVersion: sv,
  }
  return { ws, dropped, newerSchema: sv != null && sv > WORKSPACE_SCHEMA_VERSION }
}

export interface InitialState {
  doc: Doc; layers: LayerDef[]; timeline: TimelineEvent[]; recent: string[]
  /** the unified store `doc`/`board` are views of — seeded into the workspace's objects ref */
  objects: TacticalObject[]
  board: BoardDoc; building: BuildingDoc | null; vehicleOverrides: VehicleOverrides; activePlanId: string
  checklists: ChecklistState
  trupps: Trupp[]
  attendance: AttendanceState
  mittel: MittelEntry[]
  shifts: Shift[]
  bands: ShiftBand[]
  cameraViews: CameraView[]
  trails: TruppTrail[]
  attachments: ReportAttachment[]
  reportSignatures: ReportSignature[]
  planScale: PlanScales
  reportMeta: ReportMeta
  settings: IncidentSettings
  /** frozen sheet bindings (see Saved.planBindings) */
  planBindings: IncidentPlanBinding[]
  pickedObjectId?: string
  /** shared «Einsatzdaten geprüft» stamp (see Saved.intakeReviewedAt) */
  intakeReviewedAt?: string
}

/** InitialState keys a remote/merged workspace does NOT hand to a setter:
 *  - `activePlanId` is device-local (which plan THIS device is looking at; `Saved.activePlanId`
 *    is `'local'` in MERGE_POLICY), so another device's merge must not move it;
 *  - `doc` and `board` are VIEWS of `objects` — `replaceObjects` swaps them with it. */
type NotApplied = 'activePlanId' | 'doc' | 'board'

/** One setter per slice a merged workspace replaces — the applyWorkspace contract.
 *
 *  ⚠️ Typed against InitialState, so a synced slice added there without a setter here fails
 *  `tsc` (mergeWorkspace checks the other half: every synced `Saved` field has an InitialState
 *  slot). Until 25.09.2026 applyWorkspace was a hand-kept list of setter calls that had skipped
 *  `mittel`: another device's Mittel entries never reached this device's screen, and its next
 *  save — whose ancestor did hold them — read them as local deletions (delete wins). */
export type WorkspaceAppliers = { [K in Exclude<keyof InitialState, NotApplied>]-?: (value: InitialState[K]) => void }

/** Hand every applied slice of `next` to its setter, in the order `set` lists them. */
export function applyInitialState(next: InitialState, set: WorkspaceAppliers): void {
  for (const k of Object.keys(set) as (keyof WorkspaceAppliers)[]) (set[k] as (value: unknown) => void)(next[k])
}

// the plan a fresh emergency opens on: Modul 1 (the Übersicht), falling back to the first
// document only if that slot is ever removed from the catalogue
const defaultPlanId = planDocuments.find((p) => p.id === 'modul1')?.id ?? planDocuments[0].id

/**
 * Switch ON every layer whose `autoActivate` names the incident's category (the German
 * label, e.g. "Brandbekämpfung" → hydrants – see `incidentCategories`). Additive only — it never hides a
 * layer, and layers already visible pass through unchanged (same array identity when
 * nothing matches, so it's safe in setState updaters).
 */
export function autoActivateLayers(layers: LayerDef[], kategorie: string | null | undefined): LayerDef[] {
  if (!kategorie) return layers
  const hit = layers.some((l) => !l.visible && l.autoActivate?.includes(kategorie))
  if (!hit) return layers
  return layers.map((l) => (!l.visible && l.autoActivate?.includes(kategorie) ? { ...l, visible: true } : l))
}

/** The newest Atemschutz timestamp in a workspace (entry / contact / reading), or null if it has
 *  no Trupp clocks at all. Identifies a demo SEED: the server's 12 h reset writes new stamps, an
 *  operator's own edits move it forward, and everything else leaves it exactly where it was. */
export function latestTruppStamp(ws: Saved): number | null {
  const stamps: number[] = []
  for (const t of ws.trupps ?? []) {
    for (const iso of [t.entryTime, t.lastContactTime]) {
      const ms = iso ? Date.parse(iso) : NaN
      if (!Number.isNaN(ms)) stamps.push(ms)
    }
    for (const r of t.readings ?? []) { const ms = Date.parse(r.t); if (!Number.isNaN(ms)) stamps.push(ms) }
  }
  return stamps.length ? Math.max(...stamps) : null
}

/**
 * The wall-clock instant a demo seed's newest Trupp timestamp is pinned to — REMEMBERED, per tab,
 * for as long as the seed is the same one.
 *
 * Re-deriving it on every load (which is what happened until 2026-08-06) meant a plain browser
 * refresh re-pinned the newest stamp to «now» and every contact clock jumped BACKWARDS — a Trupp
 * at 0:35 came back at 0:08, and differently per Trupp depending on how it sat relative to the
 * newest stamp. On a monitoring surface that is the one direction a clock must never move: it
 * makes the time since the last Funkkontakt look shorter than it is. Anchoring once per (incident,
 * seed) means the demo still opens un-alarmed, and from then on its clocks only run forward.
 *
 * Per TAB (sessionStorage), on purpose: a refresh keeps its anchor, a new visitor in a new tab
 * gets a fresh, un-alarmed scene. A seed the server has since reset carries a different stamp and
 * therefore a new anchor.
 */
export function demoClockAnchor(incidentId: string, seedStamp: number, now: number, store?: Storage): number {
  const key = `kp.demoClock.${incidentId}.${seedStamp}`
  try {
    const s = store ?? (typeof sessionStorage === 'undefined' ? undefined : sessionStorage)
    if (!s) return now
    const stored = Number(s.getItem(key))
    if (Number.isFinite(stored) && stored > 0) return stored
    s.setItem(key, String(now))
  } catch { /* private mode / disabled storage: an un-anchored demo is still a working demo */ }
  return now
}

/**
 * Demo only: slide the Atemschutz (SCBA) Trupp clocks so the scene reads as fresh when the visitor
 * ARRIVES instead of at the server's last reset. Otherwise someone landing late in the reset window
 * sees Trupps already überfällig and the alarm fires the moment they get there. Every Trupp
 * timestamp is shifted by one offset so the most-recent contact lands at `at`, preserving the
 * relative timing (who's been in longest, contact gaps).
 *
 * `at` is the ANCHOR, not the current time — see demoClockAnchor: it is fixed on the first open of
 * a seed, so the clocks keep running afterwards instead of resetting on every refresh.
 */
export function rebaseDemoClocks(ws: Saved, at: number): Saved {
  const trupps = ws.trupps
  if (!trupps?.length) return ws
  const newest = latestTruppStamp(ws)
  if (newest == null) return ws
  const offset = at - newest
  const shift = (iso: string): string => {
    const ms = iso ? Date.parse(iso) : NaN
    return Number.isNaN(ms) ? iso : new Date(ms + offset).toISOString()
  }
  return {
    ...ws,
    trupps: trupps.map((t) => ({
      ...t,
      entryTime: shift(t.entryTime),
      lastContactTime: shift(t.lastContactTime),
      readings: t.readings?.map((r) => ({ ...r, t: shift(r.t) })),
    })),
  }
}

/** The `workspace_rev` a freshly seeded demo incident carries (backend · demo_reset writes 1).
 *  Anything above it means a visitor's own save has landed on the server. */
export const DEMO_SEED_REV = 1

/**
 * Demo only: the fetched workspace with its Atemschutz clocks pinned to this visitor's arrival —
 * but ONLY while the incident is still the untouched server seed.
 *
 * ⚠️ The rev gate is the whole point (field report 02.09.). Demo edits persist and sync like a
 * real station's, so the demo Einsatz is shared: Manuel opened the Atemschutzüberwachung on a
 * phone while it stood open on a PC, and the phone's «seit letztem Kontakt» started again at 0:00
 * against the PC's 4:19 for the same Trupp. The anchor is per tab, so every device that joined
 * re-pinned the newest contact to ITS own arrival — and then pushed those shifted stamps back
 * into the shared record on the next save, dragging everybody else's clocks with it. On the one
 * surface where a clock reading short is a safety failure.
 *
 * With the gate, the rebase does what it was built for — a late visitor lands on a fresh scene
 * rather than a screaming alarm — and stops the moment the incident becomes a worked, shared
 * record: from the first save on, every device reads the same real timestamps.
 */
export function demoSeedRebase(ws: Workspace, incidentId: string, rev: number, now: number = Date.now()): Saved {
  // read as the app wrote it: an untouched demo seed is the server's own write (demo_reset), and
  // the boot gate (sanitizeWorkspace) still checks the blob after this
  const seed = ws as Saved
  if (rev > DEMO_SEED_REV) return seed
  const stamp = latestTruppStamp(seed)
  return stamp == null ? seed : rebaseDemoClocks(seed, demoClockAnchor(incidentId, stamp, now))
}

/** Built-in app layers (base maps + operational Lage layers) + the station's reference layers
 *  from the deployment config. Append config layers only when their id is new, so the same
 *  layer can never appear twice during a transition where a def lives in both places. */
function builtinAndConfigLayers(): LayerDef[] {
  const seen = new Set(initialLayers.map((l) => l.id))
  const config = referenceLayersFromConfig().filter((l) => !seen.has(l.id))
  // «Unterirdische Bauten» (lib/underground, review round 5): after the deployment's own reference
  // layers, on by default — a config layer of the same id wins, like a built-in one
  const under = config.some((l) => l.id === UNDERGROUND_LAYER_ID) ? [] : [undergroundLayerDef()]
  return [...initialLayers, ...config, ...under]
    // the screen's tile resolution first (lib/carto · wantsRetinaTiles: 2× tiles on a retina
    // screen — the blurry map of review round 4), then the key: one address per tile everywhere
    .map((l) => keyCartoTileTemplates(retinaCartoTileTemplates(l)))
}

/** The layer list an Einsatz of this category opens with when no device/blob state exists —
 *  what the Ebenen panel's «Zurücksetzen» returns to (same derivation deriveInitial seeds). */
/**
 * Give every unnumbered Trupp its number — the migration for records written before `Trupp.no`
 * existed (docs/trupp-naming.md §6). Numbered ones keep theirs; the rest are numbered in
 * registration order (first reading's timestamp, else list position) from the first number no
 * Trupp AND no placed chip («Trupp N», the same counter) already carries. Pure and idempotent:
 * closed incidents render with the same rule on every load and are never rewritten; an open one
 * persists the numbers with its next write.
 */
export function numberTrupps(trupps: Trupp[], chipNames: Iterable<string | undefined> = []): Trupp[] {
  const unnumbered = trupps.filter((t) => typeof t.no !== 'number')
  if (!unnumbered.length) return trupps
  const at = (t: Trupp) => Date.parse(t.readings?.[0]?.t ?? '') || 0
  const order = [...unnumbered].sort((a, b) => at(a) - at(b) || trupps.indexOf(a) - trupps.indexOf(b))
  let next = nextTruppNo(trupps, chipNames)
  const assigned = new Map(order.map((t) => [t.id, next++]))
  return trupps.map((t) => (assigned.has(t.id) ? { ...t, no: assigned.get(t.id) } : t))
}

export function defaultLayers(incidentType?: string | null): LayerDef[] {
  return autoActivateLayers(builtinAndConfigLayers(), incidentType)
}

/**
 * Derive App's initial state slices from an incident's workspace blob (or empty for a
 * brand-new incident — no demo seed; a fresh incident starts blank). `prefs` carries the
 * remembered surface/plan so reopening the SAME incident honours it. `incidentType` (the
 * Einsatz category) pre-activates matching reference layers — but only where no layer state has
 * been persisted for this device yet, so a deliberate hide is never overridden on reopen.
 *
 * ⚠️ Which Ebenen are on comes from the DEVICE (lib/layerPrefs), with the blob's `layerState` as
 * a one-time seed — see the layer block below.
 */
export function deriveInitial(
  ws: Saved | null,
  incidentId: string,
  prefs: { incidentId?: string; activePlanId?: string; pickedObject?: { incidentId: string; objectId: string } },
  incidentType?: string | null,
): InitialState {
  // The unified store is authoritative from schema 2 on; a legacy blob (or a v2 blob
  // re-saved by an un-updated device, which drops `objects`) unifies from its collections.
  // `doc` and `board` below are its VIEWS — phase 1 renders them exactly as before.
  const objects = ws?.objects ?? objectsFromLegacy(ws?.entities, ws?.drawings, normalizeBoard(ws?.board))
  const { entities, drawings, board } = viewsOf(objects)
  const allLayers = builtinAndConfigLayers()
  /* Which Ebenen to open with is a DEVICE question (lib/layerPrefs): what this tablet was last
   * looking at, not what somebody else's phone was. The blob's `layerState` is only the seed, for
   * a device that has never said — an incident recorded before 05.09., or a second device joining
   * one — so nothing an existing workspace carries is lost, and nothing new is imposed. */
  const saved = loadLayerPrefs(incidentId) ?? (ws?.layerState?.length ? ws.layerState : undefined)
  let layers = saved
    ? allLayers.map((l) => { const s = saved.find((x) => x.id === l.id); return s ? { ...l, visible: s.visible, opacity: s.opacity } : l })
    : allLayers
  // A workspace whose selected base map no longer exists (base defs were trimmed) would
  // otherwise render NO background — fall back to the first base (Carto, the default).
  if (!layers.some((l) => l.base && l.visible)) {
    const fallbackId = layers.find((l) => l.base)?.id
    if (fallbackId) layers = layers.map((l) => (l.id === fallbackId ? { ...l, visible: true } : l))
  }
  // Category-driven pre-activation (hydrants for a fire, …) — fresh workspaces only:
  // once a layer state has been persisted, the operator's own toggles are authoritative.
  if (!saved) layers = autoActivateLayers(layers, incidentType)
  const ids = new Set(entities.map((e) => e.id))
  const timeline = (ws?.timeline ?? []).map((e) => (e.entityId && !ids.has(e.entityId) ? { ...e, entityId: undefined } : e))
  return {
    doc: { entities, drawings }, layers, timeline, objects,
    recent: ws?.recent ?? [], board,
    building: ws?.building ?? null, vehicleOverrides: ws?.vehicleOverrides ?? {},
    // honour the remembered plan only when reopening the SAME incident — a new emergency
    // starts on Modul 1, not on whatever plan the last incident left in the cookie
    activePlanId: (prefs.incidentId === incidentId ? prefs.activePlanId : undefined)
      ?? ws?.activePlanId ?? ws?.activeModule ?? defaultPlanId,
    checklists: ws?.checklists ?? {},
    // numbered on the way in (see numberTrupps): a chip standing on any surface counts too
    trupps: numberTrupps(ws?.trupps ?? [], [
      ...entities.filter((e) => e.kind === 'team').map((e) => e.label),
      ...Object.values(board).flat().filter((a) => a.kind === 'resource').map((a) => a.text),
      // …and every ghost trail: a deleted chip that left a Spur used its number too
      ...ghostCounterNames(ws?.trails),
    ]),
    attendance: ws?.attendance ?? {},
    mittel: ws?.mittel ?? [],
    shifts: ws?.shifts ?? [],
    bands: ws?.bands ?? [],
    cameraViews: ws?.cameraViews ?? [],
    trails: ws?.trails ?? [],
    attachments: ws?.attachments ?? [],
    reportSignatures: ws?.reportSignatures ?? [],
    planScale: ws?.planScale ?? {},
    reportMeta: ws?.reportMeta ?? {},
    settings: ws?.settings ?? {},
    planBindings: ws?.planBindings ?? [],
    intakeReviewedAt: ws?.intakeReviewedAt,
    // synced per incident; one-time import of the legacy device-cookie pick for THIS incident so
    // an in-flight manual pick isn't dropped on upgrade (the blob value wins thereafter).
    pickedObjectId: ws?.pickedObjectId
      ?? (prefs.pickedObject?.incidentId === incidentId ? prefs.pickedObject.objectId : undefined),
  }
}
