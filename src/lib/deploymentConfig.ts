// Deployment-config resolution layer (Phase 1.B · T1.5).
//
// A single kp-front build serves many fire-brigade deployments. The static `appConfig`
// (src/config/appConfig.ts) carries the sensible defaults; each deployment can OVERRIDE
// a curated subset of them at runtime via the backend's PUBLIC `GET /api/config` endpoint
// (no auth, like /api/auth/roster). This module fetches that override blob once at boot,
// caches it for offline, and exposes a synchronous accessor that read sites consult BEFORE
// falling back to appConfig.
//
// Contract (camelCase, every field optional/possibly-empty — a fresh deployment returns
// mostly-empty objects). This type mirrors the backend response exactly; keep in sync.

import type { ObjectCategoryRule } from './karte/categories'
import { isOpenableUrl, type ReportLink } from './reportLinks'

export interface DeploymentAssets {
  logo?: string | null
  /** letterhead on the printed Einsatzrapport; falls back to `logo` when unset */
  reportLogo?: string | null
  iconPng192?: string | null
  iconPng512?: string | null
  favicon?: string | null
}

export interface DeploymentIdentity {
  appName?: string | null
  /** the Karte's menu button label (≤ 8, schemas · SHORT_NAME_MAX); unset → the menu symbol */
  shortName?: string | null
  locale?: string | null
  accentColor?: string | null
  assets?: DeploymentAssets | null
  helpIntro?: string | null
  kommandant?: string | null // pre-fills the rapport's Kommandant signature line
  demoMode?: boolean | null
  demoNote?: string | null
}

export interface DeploymentDefaultView {
  center?: [number, number] | null // [lon, lat] WGS84
  centerLv95?: [number, number] | null // [E, N] LV95
  zoom?: number | null
}

export interface DeploymentGeocoder {
  defaultLocality?: string | null
  bboxLv95?: string | null
}

export interface DeploymentExternalLink {
  label?: string | null
  /** URL template; supports {E}/{N} (LV95 easting/northing) and {lng}/{lat} (WGS84). */
  urlTemplate?: string | null
}

export interface DeploymentMap {
  defaultView?: DeploymentDefaultView | null
  geocoder?: DeploymentGeocoder | null
  externalLinks?: DeploymentExternalLink[] | null
  /** «Karte & Objekte»: the station's object colours — ordered rules, first match wins
   *  (lib/karte/categories). Unset = every object red, a key box its FKS glyph. */
  objectCategories?: ObjectCategoryRule[] | null
}

export interface DeploymentReferenceLayer {
  id?: string
  group?: string
  label?: string
  icon?: string
  kind?: 'wms' | 'wmts' | 'geojson'
  tiles?: string[] | null
  geojson?: unknown | null
  vectorKind?: string | null
  symbol?: string | null
  color?: string | null
  nightColor?: string | null
  opacity?: number | null
  maxzoom?: number | null
  attribution?: string | null
  /** Einsatz categories (German labels, see `incidentCategories`) that auto-show this layer when an
   *  incident of that category is created / re-categorized */
  autoActivate?: string[] | null
}

export interface DeploymentPartner {
  feuerwehr?: string[]
  sanitaet?: string[]
  polizei?: string[]
  chemiewehr?: string[]
  zivilschutz?: string[]
}

/** One data-driven suggestion list: the options offered for a given symbol's field
 *  (combobox prefill — free typing always stays possible). `field === 'title'` targets
 *  the symbol's TITLE input; any other key targets that detail row. This replaces the old
 *  fixed vehicleTypes/luefterTypes/… fields so a deployment can attach a list to ANY
 *  symbol field, not just the six the app once hardcoded. */
export interface FleetAttributeList {
  symbol: string
  field: string
  options: string[]
}

/** One station vehicle for the Alarmierungs-/Ausrückzeiten grid (rapport form, paper
 *  Erfassungsblatt, milestone matching). `id` = the sender's device name (Traccar). */
export interface FleetVehicle {
  id: string
  label: string
  winfapAlias?: string | null
}

export interface DeploymentFleet {
  /** station vehicles for the Zeiten grid — empty/absent hides every vehicle-times surface */
  vehicles?: FleetVehicle[]
  /** Data-driven per-symbol suggestion lists (the editable surface going forward). */
  attributeLists?: FleetAttributeList[]
  /** The «Herkunft» list – where a vehicle that is not the own Feuerwehr comes from
   *  (Stützpunkt, Zivilschutz, Wache Nord …). ONE list for every vehicle symbol and every live
   *  GPS vehicle (lib/symbols · symbolFieldOptions); free typing stays possible. Absent or empty
   *  = no suggestions. */
  origins?: string[]
  // ── legacy fixed lists (pre-attributeLists) — still read as a fallback so existing
  // stored configs keep working; the admin editor migrates them into attributeLists on
  // first edit. Don't add new code paths against these. ──
  vehicleTypes?: string[]
  luefterTypes?: string[]
  kleinloeschTypes?: string[]
  partner?: DeploymentPartner | null
}

/** Map a legacy fixed-field fleet config onto the data-driven attributeLists shape, so the
 *  admin editor and the symbol resolver see one uniform representation. Empty lists are
 *  dropped. Returns [] for an absent/empty fleet. */
export function legacyFleetToAttributeLists(fleet: DeploymentFleet | null | undefined): FleetAttributeList[] {
  if (!fleet) return []
  const out: FleetAttributeList[] = []
  const push = (symbol: string, field: string, options: string[] | undefined) => {
    if (options && options.length) out.push({ symbol, field, options })
  }
  push('VKF Fahrzeug', 'title', fleet.vehicleTypes)
  push('VKF Luefter mobil', 'Typ', fleet.luefterTypes)
  push('FW Kleinloeschgeraet', 'Typ', fleet.kleinloeschTypes)
  push('VKF Bereich Feuerwehr', 'Einheit', fleet.partner?.feuerwehr)
  push('VKF Bereich Sanitaet', 'Einheit', fleet.partner?.sanitaet)
  push('VKF Bereich Polizei', 'Einheit', fleet.partner?.polizei)
  return out
}

export interface DeploymentDoctrine {
  defaultFunkkanal?: number | null
  /** default channel for a Trupp OHNE Atemschutz — stations that run their Sektionen on a
   *  separate channel set it here; unset means «same as defaultFunkkanal» */
  defaultFunkkanalEinfach?: number | null
  funkkanalMin?: number | null
  funkkanalMax?: number | null
  alarmBar?: number | null
  /** the lower Alarmdruck while a Trupp is in Rückzug (lib/atemschutz · alarmBarFor) */
  alarmBarRueckzug?: number | null
  contactIntervalMin?: number | null
  contactGraceSec?: number | null
  defaultPressureBar?: number | null
  /** the lowest Eingangsdruck taken without a question; 0 = never ask (components/TruppForm) */
  entryPressureMin?: number | null
  pressureStep?: number | null
  pressureMax?: number | null
  cylinderLiters?: number | null
  estConsumptionLPerMin?: number | null
  /** station colour per Auftrag (auftrag id → CSS colour) — what a Trupp with that order starts
   *  in, still overridable per Trupp. Absent/empty = the automatic one-colour-per-Trupp palette. */
  auftragColors?: Record<string, string> | null
  /** the station's Ausrüstung list for a Trupp (types · Trupp.equipment), short labels as they
   *  print on a card. Absent/empty = the shipped national default (appConfig.atemschutz.equipment). */
  equipment?: { id: string; label: string }[] | null
  /** metres the nearest object with plans may lie from the Einsatzadresse before the Plan warns
   *  «nicht die Einsatzadresse» (useObjectPlans · objectNearbyOnly). Absent = 25. */
  nearbyObjectWarnM?: number | null
  /** the Ø a Leitung that stores none reads as (lib/hydraulics · hoseDefaults). Absent = 40. */
  defaultLineHose?: HoseSize | null
  /** the Ø a Wassertransport in Messen starts on, never 40 (hydraulics · RELAY_HOSE_SIZES).
   *  Absent = 75. */
  defaultRelayHose?: HoseSize | null
}

/** One Dienstgrad in the station's ordered rank list. Mirrors backend `RankConfig`. Position
 *  in `DeploymentRoster.ranks` is the seniority order (most senior first). */
export interface RankConfig {
  key: string
  label: string
  abbr?: string
  tier?: 'officer' | 'nco' | 'crew'
}

export interface DeploymentRoster {
  /** Where people come from — a label, not a switch. `'snapshot'` = a roster file another
   *  system publishes, to the contract in docs/CONFIGURATION.md §4c; what actually reads one is
   *  the `roster_snapshot_source` credential (backend · roster_snapshot_sync). Nothing in the UI
   *  branches on this value. */
  source?: 'manual' | 'divera' | 'snapshot' | null
  /** Roster-snapshot poll interval in minutes (5–1440, default 60). Mirrors backend
   *  `schemas.RosterConfig.snapshotIntervalMin`; read only by the server. */
  snapshotIntervalMin?: number | null
  /** More than this share (%) of the active people deactivated by one snapshot run is held for
   *  an admin (default 20; 0 = never unattended, 100 = no cap). Read only by the server. */
  snapshotMaxDeactivatePct?: number | null
  /** Ordered ranks, most senior first. Empty/absent → the in-code Swiss default in rank.ts. */
  ranks?: RankConfig[]
  /** How a crew member's name reads, station-wide. `'last-first'` («Müller Hans») is the
   *  default and what Divera already delivers; a station that runs its lists the other way
   *  round sets `'first-last'`. One order for everybody: the alternative is two operators
   *  reading the same Trupp card differently, and a Rapport whose spelling depends on which
   *  device printed it. The backend serves display names already in this order — the frontend
   *  only needs it to know which token is the SURNAME (see abbreviateName). */
  nameOrder?: 'last-first' | 'first-last' | null
  /** How much the NIGHTLY Mannschaftsabgleich may do on its own (Divera only; every other
   *  source ignores it). `'safe'` is the shipped level: joins, renames and Dienstgrade are
   *  applied, a member who left is counted and reported («N Abgänge warten») but never
   *  deactivated — a disappearance is as often a broken feed as a resignation. `'full'` also
   *  deactivates those (never a deletion: past Einsätze keep their names), `'off'` runs
   *  nothing unattended. Mirrors backend `schemas.RosterConfig.autoSync`. */
  autoSync?: 'off' | 'safe' | 'full' | null
}

/** One SharePoint folder this deployment pulls one area's station data from. Addressing only —
 *  ⚠️ no credential lives in the config document (they are in the encrypted credential store).
 *  Mirrors backend `schemas.SharePointSource`; read-only in this app. */
export interface DeploymentSharePointSource {
  area: string
  /** the site's address out of the browser's URL bar */
  siteUrl?: string | null
  /** …or the document library's id, when a tenant admin handed it over directly */
  driveId?: string | null
  /** display name of a non-default document library */
  library?: string | null
  /** folder INSIDE that library; empty = its root */
  path?: string | null
  /** sub-folder names the pull walks past («Grosspläne», «Archiv») */
  ignore?: string[] | null
}

/** One entry of the station-wide Mittel (material) catalogue: a material that crews routinely
 *  use up and want billed/reported (`Stk` Lüfter, `l` Schaummittel, `Sack` Bindemittel …).
 *  `unit` is the default unit the entry seeds with (still editable per incident). */
export interface DeploymentMittelStock {
  /** source id (matches a DeploymentMittelSource.id) where this many are normally carried */
  source: string
  qty: number
}

export interface DeploymentMittelItem {
  id: string
  label: string
  unit?: string
  /** grouping bucket for the picker + Bestand view (e.g. "Ölwehr", "Geräte"); free string */
  category?: string
  /** standard load-out per source (the station's nominal stock + where it lives). Drives the
   *  used/available readout and the Bestand overview. Sources omitted ⇒ none there. Optional. */
  stock?: DeploymentMittelStock[]
  /** tactical-symbol pack name this material corresponds to (e.g. "VKF Luefter mobil") —
   *  placing that symbol on Lage/Plan offers logging the material. Without it, a loose
   *  label↔symbol-name token match still applies (see lib/mittel · materialForSymbol). */
  symbol?: string
  /**
   * …and WHICH of that symbol's variants this material is, keyed on the symbol's own fields.
   *
   * ⚠️ One symbol is routinely several materials. A station has «Lüfter», «Hochleistungslüfter»
   * and «Exhauster» in its catalogue and exactly ONE «VKF Luefter mobil» to place, told apart by
   * the `Typ` field it already configures in `fleet.attributeLists`. Matching on the symbol name
   * alone can only ever offer the first of the three, so it offered the wrong one — and an
   * Exhauster was simply never findable.
   *
   * Every entry in a clause must hold — `{ Typ: 'Exhauster' }` matches a Lüfter whose Typ says
   * Exhauster. A LIST of clauses is an OR: any one of them matching is enough. That is not a
   * theoretical nicety — a Lüfter set to **saugen** IS an Exhauster whatever its Typ says, so the
   * honest rule is «Typ = Exhauster ODER Luftrichtung = saugen», and an AND-only schema could
   * express neither half without losing the other.
   *
   * The pseudo-field `Luftrichtung` reads the symbol's airflow (`saugen` / `blasen`). Matching is
   * case- and umlaut-insensitive, like every other name match here. A material carrying `when`
   * outranks a bare `symbol` match, so the general «Lüfter» stays the fallback for a symbol that
   * names no variant.
   */
  when?: Record<string, string> | Record<string, string>[]
  /** Counted off the Atemschutz-Tafel instead of a symbol (lib/mittel · truppPlacedCount):
   *  'person' = one per crew member of every live AS-Trupp (Atemschutzgerät), 'trupp' = one per
   *  live AS-Trupp. File/CLI only, like `when` – the Arbeitsmappe preserves it on an id match. */
  perAtemschutz?: 'person' | 'trupp'
  /** An Ausrüstung id (Trupp.equipment · retthaube/wbk/multiwarn …): one per live Trupp of any
   *  kind that carries it in. File/CLI only, like `when`. */
  equipment?: string
  /** true = consumable (used up → Nachschub list); false/absent = equipment that must come
   *  back (gets the per-line Retablierung status: zurück / vor Ort / defekt). */
  verbrauchbar?: boolean
}

/** One configured source a material can be drawn from (vehicle / depot / …). Optional on every
 *  Mittel entry; the picker offers exactly this list. Mirrors backend `MittelSource`. */
export interface DeploymentMittelSource {
  id: string
  label: string
}

export interface DeploymentMittel {
  /** station catalogue offered first in the `+ Mittel` picker */
  catalogue?: DeploymentMittelItem[]
  /** sources (vehicles/depot/…) offered when attributing a material to where it came from */
  sources?: DeploymentMittelSource[]
  /** common unit suggestions for custom («Anderes Mittel») entries; free text always allowed */
  units?: string[]
}

export interface DeploymentIntegrations {
  // env-derived flags — named *Configured (NOT *Enabled)
  diveraConfigured?: boolean
  traccarConfigured?: boolean
  /** STT engine reachable (env stt_base_url) — gates the player's Transkribieren button */
  sttConfigured?: boolean
  /** CARTO Basemaps browser key; public by design and restricted to deployment domains. */
  cartoBasemapKey?: string | null
  /** «Mit Microsoft anmelden» is set up (backend auth/microsoft) — gates the login screen's button. */
  microsoftLoginConfigured?: boolean
  personnel?: ProviderCapability
  alarms?: ProviderCapability
  vehicles?: ProviderCapability
  providers?: ProviderRegistration[]
}

export interface ProviderCapability {
  provider?: string | null
  configured: boolean
  capabilities: string[]
}

export interface ProviderRegistration {
  provider: string
  domain: 'personnel' | 'alarms' | 'vehicles'
  configured: boolean
  active: boolean
  capabilities: string[]
}

/**
 * The name to put in front of a user when a sentence has to NAME the source — «übernimm einen
 * Divera-Alarm», «Nicht mehr in Divera». `null` when this station has no such provider.
 *
 * ⚠️ Copy must never hard-code «Divera». It is one alarm source among several (the app went
 * provider-neutral for exactly this reason), and a station running on something else — or on
 * nothing, entering every Einsatz by hand — was being told to take an alarm from a product it
 * does not have. The neutral sentence is the DEFAULT and the provider variant is the exception,
 * so a new provider costs nothing and an unconfigured station is never sent looking.
 *
 * ⚠️ Gated on the `pool` CAPABILITY, not on `configured` alone. The sentence this feeds says
 * «übernimm einen X-Alarm», and only a source with a pool HAS an alarm to take: a station on
 * the generic webhook (`generic-webhook · auto-open · lifecycle`) never sees one, because its
 * Einsätze open by themselves. Naming that source pointed the operator at an affordance the
 * app does not render — the same mistake as the hard-coded «Divera», one level down.
 * `admin/DataView` gates its Alarmquelle panel on the identical capability.
 */
export function alarmProviderName(): string | null {
  const i = getDeploymentConfig().integrations
  const p = i?.alarms
  if (p?.configured && p.provider && p.capabilities?.includes('pool')) return providerLabel(p.provider)
  // legacy flag, still served by older backends that predate the provider registry
  return !p?.provider && i?.diveraConfigured ? providerLabel('divera') : null
}

/** …the same for the roster's source — «Mannschaft aus X synchronisieren», «Nicht mehr in X». */
export function personnelProviderName(): string | null {
  const i = getDeploymentConfig().integrations
  const p = i?.personnel
  if (p?.configured && p.provider) return providerLabel(p.provider)
  return i?.diveraConfigured ? providerLabel('divera') : null
}

/** Display label for a provider slug ('divera' → 'Divera'); the slug stays the wire format. */
export const providerLabel = (slug: string): string =>
  slug ? slug.charAt(0).toUpperCase() + slug.slice(1) : slug

/** One configurable Objektplan module: its tile display + the importer's parsing rule.
 *  Mirrors backend `ModuleConfig`. The frontend uses only the display fields. */
export interface DeploymentModule {
  id: string
  code?: string
  title?: string
  subtitle?: string
  orientation?: 'portrait' | 'landscape'
  order?: number
  icon?: string
  match?: string | null
  combinedWith?: string[] | null
  family?: boolean
  /** render this module's PDF as a plain viewer (no drawing) — on a family it applies to all
   *  its sub-slots (e.g. all Modul 5 - PV documentation sheets) */
  viewer?: boolean
  /** how this module's sheets get onto the Karte — see `moduleAlignment` for the default */
  alignment?: ModuleAlignment
  /** hide this module's tile in an Einsatz whose object has a floor pack – the Gebäude stack
   *  shows its pages instead (decided 14.09.2026; FWO sets it on Modul 6). Default off: the
   *  original sheet keeps sections, legend and title block the stack drops. */
  hideWhenGebaeude?: boolean
}

export type ModuleAlignment = 'auto' | 'manual' | 'none'

/** The station's choice for a sheet: `auto` = the server proposes a fit (admin approves it,
 *  the field may ask for one), `manual` = reference points by hand only, `none` = never on the
 *  map. Unset means auto for Modul 1/2/2-3 and none otherwise; a family sub-slot
 *  (`modul5-wasser1`) inherits its family's entry. Mirrors `module_alignment` in the backend —
 *  keep the two in step, the worker and the field chip must agree. */
export function moduleAlignment(modules: DeploymentModule[] | null | undefined, planId: string): ModuleAlignment {
  const list = modules && modules.length ? modules : DEFAULT_MODULES
  const entry = list.find((m) => m.id === planId) ?? list.find((m) => m.family && planId.startsWith(`${m.id}-`))
  if (entry?.alignment) return entry.alignment
  return planId === 'modul1' || planId === 'modul2' || planId === 'modul2-3' ? 'auto' : 'none'
}

/** The national default Objektplan module catalogue — mirrors the backend's
 *  `EXAMPLE_CONFIG['modules']` in `app/admin_config.py`. A deployment that doesn't override
 *  `modules` runs on exactly these, so the admin viewer shows them as the in-force catalogue
 *  ("die mitgelieferten Standard-Module") rather than an empty "nothing configured" state.
 *  Keep in sync with the backend list. */
export const DEFAULT_MODULES: DeploymentModule[] = [
  { id: 'modul1', code: 'M1', title: 'Übersicht', order: 1, orientation: 'portrait', match: String.raw`modul\s*1(?!\s*[-–/]\s*\d)`, alignment: 'auto' },
  { id: 'modul2', code: 'M2', title: 'Umgebung', order: 2, match: String.raw`modul\s*2(?!\s*[-–/]\s*\d)`, alignment: 'auto' },
  { id: 'modul3', code: 'M3', title: 'Objektplan', order: 3, match: String.raw`modul\s*3(?!\s*[-–/]\s*\d)` },
  { id: 'modul2-3', code: '2/3', title: 'Umgebung & Objekt', order: 4, match: String.raw`modul\s*2\s*[-–/]\s*3`, combinedWith: ['modul2', 'modul3'], alignment: 'auto' },
  // Modul 6 = Geschosspläne: a reference PDF you SCROLL, not annotate (building annotation lives on
  // the interactive Gebäude floor-stack) — so it opens in the plain multi-page viewer by default.
  { id: 'modul6', code: 'M6', title: 'Gebäudepläne', order: 6, orientation: 'portrait', viewer: true, match: String.raw`modul\s*6` },
  // The sub-slot capture takes a trailing number, so «Modul 5 - Wasser 1» and
  // «Modul 5 - Wasser 2» are two plans rather than one overwriting the other. Must stay
  // identical to MODULE_RULES in fwo-schlühü's backend/tools/hub_client.py — the two
  // decide what a plan is CALLED, and a divergence puts the same sheet under two ids
  // with no error anywhere.
  { id: 'modul5', code: 'M5', title: 'Spezialpläne', order: 5, family: true, match: String.raw`modul\s*5(?:\s*[-–—]\s*([0-9A-Za-zÄÖÜäöü]+(?:\s+\d+)?))?` },
  // «Modul 5 – Zusatz» is supplementary documentation (evacuation notes, tenant lists): read,
  // never marked up – so it opens in the plain scrolling viewer like Modul 6 (Bastian, 14.09.2026).
  // The other sub-slots (Wasser, PV) stay the station's call through its own catalogue.
  { id: 'modul5-zusatz', code: 'ZUS', title: 'Zusatz', order: 5, viewer: true, match: String.raw`modul\s*5\s*[-–—/]\s*zusatz` },
  { id: 'modul4', code: 'M4', title: 'Spezialplan', order: 7, match: String.raw`modul\s*4` },
]

export interface DeploymentConfig {
  identity?: DeploymentIdentity
  map?: DeploymentMap
  referenceLayers?: DeploymentReferenceLayer[]
  modules?: DeploymentModule[]
  fleet?: DeploymentFleet
  doctrine?: DeploymentDoctrine
  roster?: DeploymentRoster
  mittel?: DeploymentMittel
  /** journal composer: station Textbausteine (quick phrases); empty → app defaults */
  journal?: { quickPhrases?: string[] | null }
  /** station alarm groups for the Alarmierungs-/Ausrückzeiten grid — empty hides it */
  alarms?: { groups?: AlarmGroup[] | null }
  /** Einsatzrapport form presets (Partnerorganisationen checkbox row) */
  report?: {
    partnerOrgs?: string[] | null
    /** how the bracketed Einsatzstunden figure rounds — see lib/attendanceHours · roundedMinutes */
    hoursRounding?: { stepMin?: number | null; graceMin?: number | null } | null
    /** how short a break still counts as ONE stretch on the Personalblatt — see
     *  lib/attendanceIntervals · mergeCloseBlocks. 0 switches merging off entirely. */
    attendanceMergeGapMin?: number | null
    /** the station's own paperwork as links on the Rapport — see lib/reportLinks. Empty or
     *  absent = the section does not exist on this deployment's Rapport at all. */
    links?: ReportLink[] | null
  }
  /** Rows of the «Einrichtung» card this station ticked off by hand. Some rows can never
   *  become true on derived facts alone — a station happy with the built-in vehicles never
   *  writes `fleet.vehicles` — so a tick is the escape hatch, and it lives in the synced
   *  document rather than on the device (backend · schemas.SetupConfig). */
  setup?: { acknowledged?: string[] | null }
  /** Which SharePoint folders this deployment pulls, and how often. Written as config-as-code,
   *  read here — /admin shows it and never edits it. */
  sharepoint?: {
    intervalMinutes?: number | null
    sources?: DeploymentSharePointSource[] | null
  }
  /** Objektbesuche (docs/object-visits.md · «Deployment config»). Off unless `enabled`. */
  objectVisits?: DeploymentObjectVisits | null
  /** how far back a `viewer` account reads (CONFIGURATION.md §1f) – the SERVER enforces it; the
   *  app only says it, under «Alle Einsätze» (HistoryPanel · windowDays) */
  access?: { viewerHistoryDays?: number | null }
  integrations?: DeploymentIntegrations
  /** The Einsatz Kategorien, category key → the German label stored on the incident, in picker
   *  order. Response-only and derived (backend · divera.CATEGORY_LABELS): the one copy. */
  categoryLabels?: Record<string, string>
  /** Opaque version token of the document the SERVER holds, off GET/PUT. Sent back as
   *  `If-Match` on the next save, so a tab holding an hour-old draft is refused instead of
   *  silently reverting whatever anybody changed since (backend · api/config · put_config).
   *  Response-only: the backend ignores it on the way in, and the editor never edits it. */
  version?: string | null
}

/** One place a visit is filed to, one-way (docs/object-visits.md · «Delivery»). */
export interface ObjectVisitDestination {
  id: string
  kind: 'sharepoint'
  enabled?: boolean
  /** `every-sync` files every ready revision (drafts too), `completed` only completed ones */
  timing?: 'every-sync' | 'completed'
  siteUrl?: string | null
  library?: string | null
  root?: string | null
  objectFolder?: string | null
  visitFolder?: string | null
  /** where a visit at a place (no object) is filed, below `root` (default
   *  «Allgemeine Meldungen/{date} {checklist} ({short})») */
  locationFolder?: string | null
}

export interface DeploymentObjectVisits {
  enabled?: boolean | null
  /** account roles that may capture; the rest read (default editor + el) */
  captureRoles?: ('editor' | 'el' | 'viewer')[] | null
  /** hours a completed visit may still be corrected before it goes view-only (default 24,
   *  0 = at once, null = never locks). The SERVER enforces it — see objectVisits/lock. */
  lockAfterHours?: number | null
  /** the fields a Korrekturvorschlag can name (opaque ids for the organizer) */
  proposalFields?: { id: string; label: string }[] | null
  destinations?: ObjectVisitDestination[] | null
}

export interface AlarmGroup {
  id: string
  label: string
  /** display hint on paper/form ('Rot', 'Grün', …) */
  color?: string | null
  winfapAlias?: string | null
  /** marks the day-duty group (drives the derived Tagespikett flag) */
  tagespikett?: boolean
}

import { apiGet } from './api'
import { idbGet, idbSet } from './idb'
import { wgs84ToLV95, lv95ToWgs84 } from './geo'
import { appConfig } from '../config/appConfig'
import { DEFAULT_ATTENDANCE_MERGE_GAP_MIN } from './attendanceIntervals'
import type { HoseSize, LayerDef, PlanDocument } from '../types'

const CACHE_KEY = 'kp-front-deployment-config'

// Module-level resolved singleton. Read sites call getDeploymentConfig() which returns
// this — it stays {} until loadDeploymentConfig() resolves at boot (before first render),
// so an early read is always safe (every field is optional → callers fall back to appConfig).
let resolved: DeploymentConfig = {}
// Config can be loaded twice during demo boot: an anonymous request starts before first paint,
// then authentication immediately asks again for the session-only capabilities. A slow first
// response must never overwrite the newer authenticated one.
let loadGeneration = 0

/**
 * Keep the session-only parts of the config across an ANONYMOUS answer.
 *
 * `/api/config` is public and withholds two things from a caller without a session, silently
 * (backend api/config · get_config): the CARTO basemap key and the Rapport's Formular links.
 * The boot fetch runs before `/me`, and when the access cookie has expired while the refresh
 * cookie is still good, it IS that anonymous caller — the endpoint never 401s, so nothing
 * refreshes the session first. The keyless answer then replaced a keyed one here and in the
 * offline cache: the basemap printed «API key required» on its tiles for the rest of the
 * session (field report 02.09.), and an OFFLINE boot afterwards built keyless tile URLs that no
 * longer matched the tiles the service worker had cached under `?key=`.
 *
 * Both values are deployment-stable, so an answer that lacks one where the previous answer had
 * it is read as «withheld», never as «removed» — a station that really rotates its key serves the
 * new one on the next session-bearing load, which every login and every boot probe makes.
 */
export function carrySessionOnly(prev: DeploymentConfig, next: DeploymentConfig): DeploymentConfig {
  let out = next
  const prevKey = prev.integrations?.cartoBasemapKey
  if (prevKey && !next.integrations?.cartoBasemapKey) {
    out = { ...out, integrations: { ...out.integrations, cartoBasemapKey: prevKey } }
  }
  const prevLinks = prev.report?.links
  if (prevLinks?.length && !next.report?.links?.length) {
    out = { ...out, report: { ...out.report, links: prevLinks } }
  }
  return out
}

function readCache(): Promise<DeploymentConfig | null> {
  return idbGet<DeploymentConfig>(CACHE_KEY).then((v) => (v && typeof v === 'object' ? v : null))
}

/**
 * Fetch the deployment override blob from the PUBLIC `/api/config`, cache it for offline,
 * and store it in the module singleton. NEVER throws — a failed fetch (offline, server down,
 * misconfigured) must never white-screen the app; it simply means unbranded appConfig
 * defaults. On a network error we fall back to the last cached value if present, else `{}`.
 */
export async function loadDeploymentConfig(): Promise<DeploymentConfig> {
  const generation = ++loadGeneration
  try {
    const cfg = await apiGet<DeploymentConfig>('/api/config')
    const fetched = cfg && typeof cfg === 'object' ? cfg : {}
    // what this device last knew — the singleton, or on a cold boot the offline copy
    const prev = Object.keys(resolved).length ? resolved : (await readCache()) ?? {}
    const next = carrySessionOnly(prev, fetched)
    if (generation === loadGeneration) {
      resolved = next
      void idbSet(CACHE_KEY, resolved) // durable copy for offline boot; in-memory singleton is enough this session
    }
    return next
  } catch {
    // network / server failure — fall back to the cached value (offline tablets), else empty
    const cached = (await readCache()) ?? {}
    if (generation === loadGeneration) resolved = cached
    return cached
  }
}

/**
 * The boot read, awaited BEFORE `createRoot`: for as long as it is pending the operator looks at
 * the static boot cover with nothing to tap. NEVER throws.
 *
 * **A device that has booted before renders from its cached copy at once** and refreshes in the
 * background (cold-start sweep 01.11.2026). Waiting for the network first put a whole round trip –
 * on a phone waking its radio often a second or more – in front of every launch, for a document
 * that changes a few times a year. The fresh answer lands in the singleton (read sites pick it up
 * on their next render, a value read once at mount on the next launch) and is handed to
 * `onFresh`, which re-applies the branding. The locale switches from the next launch.
 *
 * **A first boot** (no cache) races the network against `budgetMs`. Past the budget it resolves
 * with what is there (`{}`) and lets the load keep running: a usable app with default chrome beats
 * a perfectly branded wait.
 */
export async function bootDeploymentConfig(
  budgetMs: number,
  onFresh: (cfg: DeploymentConfig) => void,
): Promise<DeploymentConfig> {
  const cached = await readCache()
  if (cached) {
    resolved = cached
    void loadDeploymentConfig().then(onFresh)
    return cached
  }
  const load = loadDeploymentConfig()
  let timer: ReturnType<typeof setTimeout> | undefined
  const budget = new Promise<'timeout'>((res) => { timer = setTimeout(() => res('timeout'), budgetMs) })
  const winner = await Promise.race([load, budget])
  clearTimeout(timer)
  return winner === 'timeout' ? resolved : winner
}

/** The Einsatz wizard's Kategorie picker: the server's German labels, in its order. These are
 *  the stored VALUES (`incident.type`); the option text is translated through
 *  `copy.intake.kategorienLabels`. Empty until a config that carries them has loaded – the
 *  wizard then sends no category and the server derives one. */
export function incidentCategories(): string[] {
  return Object.values(resolved.categoryLabels ?? {})
}

/** Synchronous accessor returning the resolved singleton ({} until loadDeploymentConfig
 *  resolves). The PRIMARY read path — config resolves before first render, so read sites
 *  do `getDeploymentConfig().X ?? appConfig.X`. */
export function getDeploymentConfig(): DeploymentConfig {
  return resolved
}

/**
 * Atemschutz doctrine numbers, resolved deployment override → appConfig national default.
 * THE read path for every doctrine number — read sites must not consult `appConfig.atemschutz`
 * directly for these (that skips the station's config). Call inside a component/function, not
 * at module level: a module-level capture would freeze the pre-boot empty config.
 */
export function atemschutzDoctrine() {
  const d = resolved.doctrine ?? {}
  const a = appConfig.atemschutz
  const alarmBar = d.alarmBar ?? a.alarmBar
  // A zero line is reserved for the public demo and disables BOTH pressure alarms. For a
  // working line, keep the shipped Rückzug default but never let it sit above the active line:
  // that would make a withdrawing Trupp alarm earlier than one still going in.
  const alarmBarRueckzug = alarmBar === 0
    ? 0
    : Math.min(d.alarmBarRueckzug ?? a.alarmBarRueckzug, alarmBar)
  return {
    pressureStep: d.pressureStep ?? a.pressureStep,
    pressureMax: d.pressureMax ?? a.pressureMax,
    defaultPressureBar: d.defaultPressureBar ?? a.defaultPressureBar,
    entryPressureMin: d.entryPressureMin ?? a.entryPressureMin,
    alarmBar,
    alarmBarRueckzug,
    contactIntervalMin: d.contactIntervalMin ?? a.contactIntervalMin,
    contactGraceSec: d.contactGraceSec ?? a.contactGraceSec,
    defaultFunkkanal: d.defaultFunkkanal ?? a.defaultFunkkanal,
    // unset falls back to the station's (then the shipped) AS channel — one channel unless split
    defaultFunkkanalEinfach: d.defaultFunkkanalEinfach ?? d.defaultFunkkanal ?? a.defaultFunkkanal,
    funkkanalMin: d.funkkanalMin ?? a.funkkanalMin,
    funkkanalMax: d.funkkanalMax ?? a.funkkanalMax,
    cylinderLiters: d.cylinderLiters ?? a.cylinderLiters,
    estConsumptionLPerMin: d.estConsumptionLPerMin ?? a.estConsumptionLPerMin,
  }
}

/** How far (m) the auto-surfaced object may lie from the Einsatzadresse before the Plan warns
 *  that it is only the nearest one – the station's doctrine, else the shipped 25 m. */
export function nearbyObjectWarnM(): number {
  return resolved.doctrine?.nearbyObjectWarnM ?? appConfig.defaults.nearbyObjectWarnM
}

/**
 * The station's colour per Atemschutz-Auftrag (auftrag id → colour) — the colour a Trupp with
 * that order starts in. Empty by default: out of the box a Trupp's colour means IDENTITY (each
 * one different), and a station that would rather read the Lage by ROLE («alle Löschtrupps rot»)
 * configures it here. Either way the per-Trupp pick still wins (see Trupp.color).
 */
export function atemschutzAuftragColors(): Record<string, string> {
  const c = resolved.doctrine?.auftragColors
  return c && typeof c === 'object' ? c : {}
}

/**
 * The Ausrüstung a Trupp can be sent in with (types · Trupp.equipment) — the station's own list
 * (`doctrine.equipment`) where one is configured, else the shipped default. THE read path, like
 * `atemschutzDoctrine()`: nothing reads `appConfig.atemschutz.equipment` directly. Entries
 * without an id or a label are dropped at the boundary, and a list that is empty after that
 * falls back to the default rather than offering nothing.
 */
export function atemschutzEquipment(): { id: string; label: string }[] {
  const own = (resolved.doctrine?.equipment ?? []).filter((e) =>
    !!e && typeof e === 'object' && typeof e.id === 'string' && e.id.trim() !== '' && typeof e.label === 'string' && e.label.trim() !== '')
  return own.length ? own : appConfig.atemschutz.equipment
}

/**
 * How the station spells crew names. Default `'last-first'` — that is what the Divera sync
 * writes and how a Feuerwehr list is sorted and called out. Everything that DISPLAYS a name
 * gets it from the backend already in this order; this accessor exists for the few places
 * that have to take a name APART again (abbreviating for a chip, sorting a local list).
 */
/**
 * How short a break between two recorded presence blocks still reads as one stretch on the
 * Rapport, in minutes (see lib/attendanceIntervals · mergeCloseBlocks). Default 15.
 *
 * A station number, not a per-incident one: whether a ten-minute gap is «a break» or «two
 * deployments» is a Weisung that has to mean the same on every sheet the Wehr files. `0` prints
 * every recorded block exactly as recorded.
 */
export function attendanceMergeGapMin(): number {
  const v = resolved.report?.attendanceMergeGapMin
  return typeof v === 'number' && Number.isFinite(v) && v >= 0 ? v : DEFAULT_ATTENDANCE_MERGE_GAP_MIN
}

/**
 * The station's «Formulare & Links» for the Rapport, gated at the boundary: a row without a
 * title, without an id or without an openable http(s) URL is not a link anybody could use, so
 * it is dropped here rather than rendered as a dead row on the Rapport (see lib/reportLinks).
 * An empty result means the section does not appear at all.
 */
export function reportLinks(): ReportLink[] {
  return (resolved.report?.links ?? []).filter((l) =>
    !!l && !!l.id?.trim() && !!l.title?.trim() && isOpenableUrl(l.url ?? ''))
}

/** The Objektbesuche module as this device knows it: on/off and who may capture. The catalogue's
 *  own `canCapture` is the server's word and wins where it is known (objectVisits/catalogue). */
/** The station's object categories for «Karte & Objekte» (`map.objectCategories`, raw — read
 *  through lib/karte/categories · categoryRules). */
export function objectCategoryRules(): ObjectCategoryRule[] {
  const raw = resolved.map?.objectCategories
  return Array.isArray(raw) ? raw : []
}

/** The window a completed Objektbesuch may still be corrected in, where the config names none —
 *  what /admin shows in an empty field (backend `schemas.ObjectVisitsConfig.lockAfterHours`). */
export const DEFAULT_VISIT_LOCK_HOURS = 24

// ⚠️ `lockAfterHours` is deliberately NOT read here: the lock is the server's rule and every
// visit carries the `lockedAt` it produced (objectVisits/lock). Only /admin edits the number.
export function objectVisitsConfig(): { enabled: boolean; captureRoles: string[] } {
  const ov = resolved.objectVisits
  const roles = Array.isArray(ov?.captureRoles) ? ov.captureRoles.filter((r) => typeof r === 'string') : null
  return { enabled: ov?.enabled === true, captureRoles: roles ?? ['editor', 'el'] }
}

/** The general folder a visit at a place goes to — the first segment of the first enabled
 *  destination's `locationFolder` («Allgemeine Meldungen»); null without a destination (the
 *  visit then stays in KP Front and its export). For the «Ort» card's «Ablage» line only — the
 *  server files (object_visit_delivery · folder_segments). */
export function placeFilingFolder(): string | null {
  const dest = (resolved.objectVisits?.destinations ?? []).find((d) => d && d.enabled !== false)
  if (!dest) return null
  const pattern = (dest.locationFolder ?? '').trim() || 'Allgemeine Meldungen/{date} {checklist} ({short})'
  return pattern.replace(/\\/g, '/').split('/').map((p) => p.trim()).find(Boolean) ?? null
}

export function rosterNameOrder(): 'last-first' | 'first-last' {
  return resolved.roster?.nameOrder === 'first-last' ? 'first-last' : 'last-first'
}

/**
 * The station's display name for brand lockups (login, boot splash, empty state).
 * Falls back to the product name when a deployment hasn't set its identity, so every
 * surface reads the same wordmark — never the code-default `appConfig.appName`.
 */
export function deploymentName(): string {
  return resolved.identity?.appName ?? 'KP Front'
}

/**
 * Compact-address display: strip a locality (the deployment's own town) from an address.
 * In a single-town deployment every list row repeats «Oberwil (BL), …» — pure noise; an
 * OUT-of-town address keeps its town and thereby stands out. Handles both source formats:
 * the Divera prefix («Oberwil (BL), Grenzweg 1») and the swisstopo suffix
 * («Grenzweg 3, 4104 Oberwil»). Pure — the config-bound wrapper is shortAddress below.
 */
export function stripLocality(address: string, locality: string | null | undefined): string {
  // locality config is free-form («4104 Oberwil BL», «Oberwil (BL)») — reduce to the town
  // name by dropping PLZ + canton tokens
  const town = (locality ?? '')
    .replace(/\([A-Z]{2}\)/g, '')
    .split(/[\s,]+/)
    .filter((t) => t && !/^\d{4,5}$/.test(t) && !/^[A-Z]{2}$/.test(t))
    .join(' ')
    .trim()
  if (!town) return address
  const t = town.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const stripped = address
    .replace(new RegExp(`^${t}(\\s*\\([A-Z]{2}\\)|\\s+[A-Z]{2})?\\s*,\\s*`, 'i'), '')
    .replace(new RegExp(`\\s*,?\\s*(\\d{4,5}\\s+)?${t}(\\s*\\([A-Z]{2}\\)|\\s+[A-Z]{2})?\\s*$`, 'i'), '')
    .trim()
  return stripped || address
}

/**
 * stripLocality against the deployment's configured home town (map.geocoder.defaultLocality).
 * For compact LIST rows and banners only — Einsatzdaten, Rapport, and the ReviewBanner's
 * address check keep the full address (formal record / verification surfaces).
 */
export function shortAddress(address: string | null | undefined): string | null {
  if (!address) return null
  return stripLocality(address, resolved.map?.geocoder?.defaultLocality)
}

/** True on demo deployments — drives the persistent DEMO ribbon. Off for real stations. */
export function isDemoMode(): boolean {
  return resolved.identity?.demoMode === true
}

/** Optional demo note (e.g. login credentials / reset cadence), shown on the login screen.
 *  Only while demoMode is ON: the note is independent config, so a station that started from
 *  the demo dataset and switched demo mode off kept announcing «PIN 000000 für alle» on its
 *  real login screen. The field stays (it comes back with demoMode); it is just not shown. */
export function demoNote(): string | null {
  if (!isDemoMode()) return null
  const n = resolved.identity?.demoNote
  return n && n.trim() ? n : null
}

/**
 * What the menu button at the top left of «Karte & Objekte» wears (review round 5, owner: the
 * station's short name or its mark instead of «Einsätze»): the uploaded brandmark (`assets.logo`
 * — only an UPLOADED one, never the bundled favicon fallback, which is KP Front's and not the
 * station's) and `identity.shortName`. Both null → the caller draws a neutral menu symbol.
 */
export function deploymentMenuMark(): { mark: string | null; short: string | null } {
  const id = resolved.identity
  const short = id?.shortName?.trim()
  return { mark: id?.assets?.logo || null, short: short || null }
}

/**
 * The station's brand logo for the brand lockups (login, empty state). Falls back to the
 * bundled favicon when a deployment hasn't uploaded one, so every surface shows the same mark.
 */
export function deploymentLogo(): string {
  return resolved.identity?.assets?.logo ?? '/favicon.svg'
}

/**
 * The station's default map centre as WGS84 `[lng, lat]`, or null if unconfigured. Prefers
 * the WGS84 `center`; else converts LV95 `centerLv95` (the backend rejects both set). Used to
 * anchor surfaces that open without an incident yet — e.g. the intake map-picker — on the
 * brigade's own area instead of a neutral country-centroid fallback.
 */
export function deploymentDefaultCenter(): [number, number] | null {
  const dv = resolved.map?.defaultView
  if (dv?.center) return dv.center
  if (dv?.centerLv95) return lv95ToWgs84(dv.centerLv95[0], dv.centerLv95[1]) as [number, number]
  return null
}

/**
 * The per-station reference layers (hydrants, Leitungskataster, canton WMS, …) as renderable
 * `LayerDef`s, derived from the deployment config. These are STATION DATA — they live in the
 * config/reference store, never bundled in the repo — so `deriveInitial` appends them to the
 * built-in app layers (base maps + operational Lage layers). All start hidden; the operator
 * toggles them in the Ebenen panel. Empty when no station has loaded any (fresh OSS deploy).
 *
 * Two shapes (`kind`): a `geojson` layer carries a same-origin `geojson` URL (the reference
 * store, e.g. `/api/reference/geo:hydrant`, written by `admin_geodata load`); a `wms`/`wmts`
 * layer carries raster `tiles` template(s). Entries missing their required source are skipped.
 */
export function referenceLayersFromConfig(): LayerDef[] {
  return mapReferenceLayers(resolved.referenceLayers)
}

/** The station's configured Objektplan module tiles → `PlanDocument[]` (display only), sorted by
 *  `order`. Empty when `modules` is unconfigured (caller keeps the bundled catalog). Generative
 *  families (`family`) are skipped — their tiles are synthesized data-driven from the backend. */
export function modulesFromConfig(): PlanDocument[] {
  const mods = resolved.modules
  if (!Array.isArray(mods) || mods.length === 0) return []
  return mods
    .filter((m) => m.id && !m.family)
    .slice()
    .sort((a, b) => (a.order ?? 0) - (b.order ?? 0))
    .map((m) => ({
      id: m.id,
      code: m.code ?? m.id,
      title: m.title ?? '',
      subtitle: m.subtitle ?? '',
      imageUrl: '',
      orientation: m.orientation ?? 'landscape',
      ...(m.icon ? { icon: m.icon } : {}),
      ...(m.viewer ? { viewer: true } : {}),
    }))
}

/** A numbered sub-slot sibling → the slot it is a copy of: `modul5-wasser2` → `modul5-wasser`.
 *  `\D+` after the module number keeps a combined sheet out (`modul2-3` has no word part), and
 *  the bare `modul5` never matches, so neither can lose its own entry. */
const SUB_SLOT_SIBLING = /^(modul\d+-\D+)\d+$/

/** Whether a resolved plan slot is viewer-only (plain PDF, no drawing). Checks the exact module
 *  config, then the slot a numbered sibling belongs to, else a `family` module whose id is the
 *  slot's prefix (modul5 → modul5-pv). False when unconfigured. */
export function moduleViewer(id: string): boolean {
  // fall back to the national defaults when the deployment didn't configure modules, so the
  // built-in viewer flags (e.g. Modul 6 = scroll-only) still apply.
  const mods = Array.isArray(resolved.modules) && resolved.modules.length ? resolved.modules : DEFAULT_MODULES
  const exact = mods.find((m) => m.id === id && !m.family)
  if (exact) return !!exact.viewer
  // ⚠️ An object with «Wasser 1» AND «Wasser 2» holds them as `modul5-wasser1`/`modul5-wasser2`
  // (useObjectPlans · normModule keeps the trailing number, or the second waterplan overwrites
  // the first). The catalogue configures the SLOT — `modul5-wasser` — so without this step the
  // numbered siblings fall past their own entry onto the family default and open viewer-only:
  // no annotation surface, and no «Karte verknüpfen» at all (Whiteboard · canGeoref).
  const base = SUB_SLOT_SIBLING.exec(id)?.[1]
  const sibling = base ? mods.find((m) => m.id === base && !m.family) : undefined
  if (sibling) return !!sibling.viewer
  const family = mods.find((m) => m.family && (id === m.id || id.startsWith(`${m.id}-`)))
  return !!family?.viewer
}

/** Does the catalogue hide this module's tile once the object has a floor pack? Resolved like
 *  `moduleViewer`: exact entry, then the numbered sibling's slot, then the family. */
export function moduleHiddenWithGebaeude(id: string): boolean {
  const mods = Array.isArray(resolved.modules) && resolved.modules.length ? resolved.modules : DEFAULT_MODULES
  const exact = mods.find((m) => m.id === id && !m.family)
  if (exact) return !!exact.hideWhenGebaeude
  const base = SUB_SLOT_SIBLING.exec(id)?.[1]
  const sibling = base ? mods.find((m) => m.id === base && !m.family) : undefined
  if (sibling) return !!sibling.hideWhenGebaeude
  const family = mods.find((m) => m.family && (id === m.id || id.startsWith(`${m.id}-`)))
  return !!family?.hideWhenGebaeude
}

/** Pure mapper (exported for tests): `DeploymentReferenceLayer[]` → `LayerDef[]`, skipping
 *  entries that lack an id or their required source (geojson URL / tile templates). */
export function mapReferenceLayers(refs: DeploymentReferenceLayer[] | undefined): LayerDef[] {
  if (!Array.isArray(refs)) return []
  return refs.flatMap((r): LayerDef[] => {
    if (!r || !r.id) return []
    const common = {
      id: r.id,
      group: r.group ?? 'Referenz',
      label: r.label ?? r.id,
      icon: r.icon ?? 'map',
      base: false,
      visible: false,
      opacity: r.opacity ?? 100,
      maxzoom: r.maxzoom ?? undefined,
      attribution: r.attribution ?? undefined,
      autoActivate: Array.isArray(r.autoActivate) && r.autoActivate.length ? r.autoActivate : undefined,
    }
    if (r.kind === 'geojson') {
      // Only a string (a same-origin URL) is renderable here; an inline object isn't supported.
      if (typeof r.geojson !== 'string' || !r.geojson) return []
      return [{
        ...common,
        geojson: r.geojson,
        vectorKind: r.vectorKind === 'point' ? 'point' : 'line',
        symbol: r.symbol ?? undefined,
        color: r.color ?? undefined,
        nightColor: r.nightColor ?? undefined,
      }]
    }
    // wms / wmts → raster overlay; needs at least one tile template
    if (Array.isArray(r.tiles) && r.tiles.length > 0) {
      return [{ ...common, tiles: r.tiles }]
    }
    return []
  })
}

/**
 * Apply the deployment's branding at boot (called once in main.tsx after loadDeploymentConfig).
 * Sets the document title and the --accent CSS custom property.
 *
 * --accent defaults to the brigade red (var(--red)) and currently drives only the
 * brand-identity surface (the login/splash pulse). The semantic palette (warn/danger
 * --red, selection --blue) is intentionally NOT brand-driven; broadening --accent into a
 * full brandable palette is a deliberate later (admin/branding) task, not Phase 1.
 */
export function applyDeploymentBranding(cfg: DeploymentConfig): void {
  const appName = cfg.identity?.appName
  if (appName) document.title = appName
  const accent = cfg.identity?.accentColor
  if (accent) document.documentElement.style.setProperty('--accent', accent)

  // Runtime favicon: point the document's <link rel="icon"> at the uploaded asset
  // (creating the link if the page has none). Null-safe — an unset favicon leaves the
  // build-time default in place.
  const favicon = cfg.identity?.assets?.favicon
  if (favicon) {
    let link = document.querySelector<HTMLLinkElement>('link[rel="icon"]')
    if (!link) {
      link = document.createElement('link')
      link.rel = 'icon'
      document.head.appendChild(link)
    }
    link.href = favicon
  }
}

/**
 * Station-supplied external map deep-links for the given incident coords (Datenquellen panel).
 * Each config entry's `urlTemplate` is filled with {E}/{N} (LV95) and {lng}/{lat} (WGS84).
 * Returns [] when no links are configured — so a generic deployment shows none.
 */
export function externalMapLinks(lng: number, lat: number): { label: string; href: string }[] {
  const links = resolved.map?.externalLinks
  if (!Array.isArray(links) || links.length === 0) return []
  const [e, n] = wgs84ToLV95(lng, lat)
  const fill = (t: string) =>
    t.replaceAll('{E}', e.toFixed(2)).replaceAll('{N}', n.toFixed(2))
      .replaceAll('{lng}', String(lng)).replaceAll('{lat}', String(lat))
  return links
    .filter((l): l is { label: string; urlTemplate: string } => !!l?.label && !!l?.urlTemplate)
    .map((l) => ({ label: l.label, href: fill(l.urlTemplate) }))
}
