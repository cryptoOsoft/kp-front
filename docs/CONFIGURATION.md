# CONFIGURATION – what a station must provide, and in what format

**Status:** Live configuration contract. The Tier-2 config layer is implemented as a DB-backed
`deployment_config` document. **Two doors write it and they write the same rows:** forms at
`/admin`, which is where a station normally administers itself, and the CLI/config-file
tooling, which is the same document as a file – for config you want reviewed, versioned or
reproduced on a second deployment.

This document is the **data contract** every other piece builds on: what a station keeps in its
private config/data repo, what the CLI validates and loads, what the admin UI visualizes, and what
the backend validates.

**In a hurry?** Setting a station up for the first time: [§9](#9-loading-station-data-with-the-admin-clis)
is the load order and the six CLIs. Looking for an environment variable:
[§6](#6-environment-variables-secrets--infra--operator-not-admin). Looking for a field of the
config JSON: [§1](#1-deployment-config-the-json-the-deployment-owner-edits).

## Contents

- [0. The four layers (recap)](#0-the-four-layers-recap)
  - [0a. For developers – where a setting lives, station data, coordinates](#0a-for-developers--where-a-setting-lives-station-data-coordinates)
- [1. Deployment config – the JSON document](#1-deployment-config-the-json-the-deployment-owner-edits)
  - [Where each section is edited](#where-each-section-is-edited)
  - [1a. `alarmKeywords` – the station's own alarm vocabulary](#1a-alarmkeywords--the-stations-own-alarm-vocabulary)
  - [1b. `report.hoursRounding` – Einsatzstunden on the printed rapport](#1b-reporthoursrounding--einsatzstunden-on-the-printed-rapport)
  - [1c. `report.attendanceMergeGapMin` – two ticks that are one arrival](#1c-reportattendancemergegapmin--two-ticks-that-are-one-arrival)
  - [1d. `report.links` – the station's own forms, on the Rapport](#1d-reportlinks--the-stations-own-forms-on-the-rapport)
  - [1e. `objectVisits` – the optional Objektbesuche module](#1e-objectvisits--the-optional-objektbesuche-module)
  - [`doctrine.alarmBarRueckzug` – the quieter line on Rückzug](#doctrinealarmbarrueckzug--the-quieter-line-for-a-trupp-on-rückzug)
  - [`doctrine.entryPressureMin` – the one question about a low Eingangsdruck](#doctrineentrypressuremin--the-one-question-about-a-low-eingangsdruck)
  - [`doctrine.nearbyObjectWarnM` – when the nearest object is «nicht die Einsatzadresse»](#doctrinenearbyobjectwarnm--when-the-nearest-object-is-nicht-die-einsatzadresse)
- [2. Reference / Werkleitungs layers – station-supplied](#2-reference--werkleitungs-layers--station-supplied-nothing-bundled)
  - [2a. Raster layer (WMS / WMTS)](#2a-raster-layer-wms--wmts--paste-a-url-template) ·
    [2b. Vector layer (GeoJSON)](#2b-vector-layer-geojson--for-pointslines-you-own)
- [3. Uploaded assets & their formats](#3-uploaded-assets--their-formats)
  - [3a. Branding](#3a-branding) · [3b. Hydrants – GeoJSON](#3b-hydrants--geojson) ·
    [3c. Plans (object plans) – PDF](#3c-plans-object-plans--pdf)
- [4. Roster / personnel](#4-roster--personnel)
  - [4a. `"divera"`](#4a-divera--auto-sync) · [4b. `"manual"`](#4b-manual--csv-import--hand-entry) ·
    [4c. `"snapshot"` – the roster-snapshot contract](#4c-snapshot--a-roster-file-somebody-else-publishes)
    [4d. The station index – one address for all station data](#4d-the-station-index--one-address-for-all-station-data)
- [5. User accounts, roles, and deployment administration](#5-user-accounts-roles-and-deployment-administration)
- [6. Environment variables (secrets / infra)](#6-environment-variables-secrets--infra--operator-not-admin)
  - [The integration credentials – env **or** `/admin`](#the-integration-credentials--env-or-admin--anbindungen)
  - [6a. Objektplan-Pull](#6a-objektplan-pull-fetch-modul-pdfs-instead-of-having-them-pushed-in)
  - [6b. Three things that look like env vars and are not](#6b-three-things-that-look-like-env-vars-and-are-not)
  - [6c. SharePoint-Pull – the station's own folders](#6c-sharepoint-pull-the-stations-own-folders-imported-on-a-schedule)
  - [6d. Connector health (what `GET /api/system` reports)](#6d-connector-health-what-get-apisystem-reports)
- [7. What ships with the app (no config needed)](#7-what-ships-with-the-app-no-config-needed)
- [8. Empty state (a brand-new deployment)](#8-empty-state-a-brand-new-deployment)
- [9. Loading station data with the admin CLIs](#9-loading-station-data-with-the-admin-clis)
  - [9a. What all of them share (`load` vs `push`, the order)](#9a-what-all-of-them-share)
  - [9b. `admin_config` – the deployment config](#9b-admin_config--the-deployment-config)
  - [9c. `admin_branding` – the five branding slots](#9c-admin_branding--the-five-branding-slots)
  - [9d. `admin_geodata` – reference layers](#9d-admin_geodata--reference-layers)
  - [9e. `admin_objects` – Einsatzobjekte + Modul-PDFs](#9e-admin_objects--einsatzobjekte--modul-pdfs)
  - [9f. `admin_checklists` – checklist templates](#9f-admin_checklists--checklist-templates)
  - [9g. Maintenance tools (`reset_roster`, `demo_export`, `admin_visits`)](#9g-maintenance-tools-reset_roster-demo_export-admin_visits)
  - [9h. The station workbook – one `.xlsx` for the list-shaped data](#9h-the-station-workbook--one-xlsx-for-the-list-shaped-data)
- [10. Out of scope for this doc](#10-out-of-scope-for-this-doc)

> **Section numbers are stable.** §1–§8 keep the numbers other documents and code comments
> already cite. The CLI sections were renumbered once (2026-08-16) into the order you run them:
> the old §9b/§9c/§9d/§9e are now §9b/§9d/§9f/§9g.

---

## 0. The four layers (recap)

| Layer | What | Where | Editable by |
|-------|------|-------|-------------|
| **Defaults** | National/safe fallbacks (FKS doctrine, symbol presets) | `src/config/appConfig.ts` | developers |
| **Deployment config** ← *this doc* | Per-station settings + uploaded assets | DB `deployment_config` row + asset storage | technical deployment owner – forms at `/admin`, or the same rows as a config file via CLI |
| **Secrets / infra** | DB URL, API keys, session secret | environment variables, **or** – for the integration credentials (🔐 in §6) – the encrypted `integration_credentials` table | operator (deploy time) · an **admin** at `/admin` → Anbindungen for those. **Env wins and locks the field** (§6) |
| **Per-incident settings** | Live operational knobs (synced) | workspace blob (`IncidentSettings`) | any **user**, in-incident |

**Resolution:** per-incident overrides deployment config overrides defaults. **An empty
deployment config is valid** – the app must run as a generic, empty station (see `§8 Empty
state`).

### 0a. For developers – where a setting lives, station data, coordinates

The code-side rules behind the layers (moved here from AGENTS.md on 2026-10-18, wording
unchanged):

- **A setting lives in one of three places – pick by who owns it, not by what is easiest to
  reach.** (1) *Device preference* – theme (day/night/auto), symbol scale, rail words, shortcut
  letters («Tastenkürzel anzeigen», `keyHints`, default ON – the letter badge on both rails,
  `.rail-key`, shown only with hover + a fine pointer; letters from `lib/hotkeys`), offline
  radius, screen wake: cookie via `src/lib/prefs.ts`, not synced, surfaced in the **Einstellungen
  sheet** (`src/components/panels/SettingsSheet.tsx`), which since 28.08. carries device prefs
  plus per-device utilities and **nothing else**. (2) *Station doctrine* – Funkkontakt-Intervall,
  Nachfrist, Funkkanal, Auftragsfarben: deployment config `doctrine.*`, edited **only** in
  `/admin › Doktrin` (`DoctrineSection` in `src/admin/ConfigSections.tsx`) and read **only**
  through `atemschutzDoctrine()` in `src/lib/deploymentConfig.ts`, never off
  `appConfig.atemschutz`. These left the sheet on purpose (99c4348): station configuration
  belongs where whoever set it up changes it, not under the finger of an unknowing operator at
  3am – do not re-add a doctrine editor to any in-app surface. (3) *Synced per-incident state* –
  the workspace blob (`IncidentSettings` in `src/lib/workspace.ts`: `contactIntervalMin`,
  `contactGraceSec`, `defaultFunkkanal`, each defaulting from `doctrine`). Overrides already
  written there keep applying as the layer above doctrine, but no surface offers new ones; add
  here only when the value must genuinely differ *per Einsatz* and be identical on every device.
- **One deployment = one station** (**single-tenant**, no multi-tenancy). Edit a station's
  config as code: `cd backend && uv run python -m app.admin_config
  <schema|example|validate|diff|load>` (§9b); it's served at `GET /api/config` and applied at
  boot to override `appConfig` defaults. Integration credentials are read through
  `app.credentials.get(name)`, never off `settings` (`backend/app/credentials.py`, §6).
- **Reference geodata, object plans, and checklists are station data, never bundled.**
  Hydrants/Leitungskataster/canton-WMS layers, Modul PDFs, and the FU/EL checklist templates +
  playbook diagrams don't live in this repo – they're loaded into a deployment from a *private
  data repo* via `admin_geodata` / `admin_objects` / `admin_checklists` (each a
  `schema|example|validate|load|push|show` CLI keyed off `KP_ADMIN_SECRET`; they share their
  flags, refusals and push session with `admin_config`/`admin_branding` via `app/admin_cli.py`;
  §9). The frontend turns config geodata into map layers (`referenceLayersFromConfig` →
  `deriveInitial`); missing object plans fall back only to OSM outlines + `Tafel`, never bundled
  `/public` PDFs (§3c); checklist templates are fetched from the `checklists:<id>` reference
  datasets, falling back to one neutral bundled example – never a station's real lists (§9f).
  The Tafel's board templates ride the same pipeline (`admin_board_templates`, `tafel:<id>`);
  their bundled FKS set is public FKS material, and a station set REPLACES it rather than joining
  it ([`board-templates.md`](board-templates.md)). GeoJSON must be WGS84 `[lng,lat]` (LV95 is
  rejected, §3b).
- **Coordinates are WGS84 `[lng, lat]` wherever the map renders.** LV95 only at the edges via
  `src/lib/geo.ts` (`wgs84ToLV95` / `lv95ToWgs84` / `fmtLV95`), the `centerLv95` config option,
  and the geocoder bbox.

---

## 1. Deployment config (the JSON the deployment owner edits)

One JSON document, stored as the single `deployment_config` row, returned by `GET /api/config`.
**Every field is optional**; anything omitted falls back to the national default.

### Where each section is edited

**The browser is the primary path for nearly all of it.** The `admin_*` CLIs (§9) write the same
rows and are not deprecated – they are the config-as-code route, for a setup you want reviewed,
versioned and reproducible on a second deployment. This table is the answer to "do I need a file
for this?"; the German names are the pages in the left-hand `/admin` nav.

| Section | Browser | Where |
|---------|---------|-------|
| `identity.*` (`appName`, `shortName`, `locale`, `accentColor`, `helpIntro`, `kommandant`) | ✅ | Station › **Station & Karte** |
| `identity.assets` | ✅ | the branding uploads – **not** part of this document (see the ⚠️ below and §3a) |
| `map.defaultView`, `map.geocoder.*` | ✅ | Station › **Station & Karte** |
| `map.buildingRegister` | ❌ | config-as-code only (`admin_config`); unset = on in CH ([`building-card.md`](building-card.md)) |
| `map.serviceArea.municipalities` | ❌ | config-as-code only (`admin_config`); the Einsatzgebiet's BFS numbers for «Unterirdische Bauten» and the houses a building tap selects – unset = the municipality at `map.defaultView` ([`karte-objekte.md`](karte-objekte.md)) |
| `map.objectCategories` | ✅ | Station › **Station & Karte** › «Objektfarben» ([`karte-objekte.md`](karte-objekte.md) · Object colours) |
| `map.externalLinks` | ✅ | Station › **Station & Karte** – ⚠️ editable, but as shipped its only renderer is the field app's «Datenquellen» panel, which is **unreachable**. Configuring it changes nothing anybody can see today |
| `referenceLayers` – raster (WMS/WMTS) and GeoJSON, incl. the file upload | ✅ | Station › **Kartenebenen** (§2) |
| `referenceLayers[].nightColor` · `.opacity` · `.maxzoom` · `.symbol` · `.autoActivate` | ❌ | file only – the forms **merge** over the stored row, so a CLI-set value survives an edit |
| `modules` (the Objektplan-Modul catalogue) | ❌ | **file only** – the Objektpläne page lists the catalogue read-only; the objects and their PDFs are what you edit there ([`objektplaene-architecture.md`](objektplaene-architecture.md)) |
| `doctrine.*` | ✅ | Station › **Doktrin** |
| `journal.*` | ✅ | Station › **Journal** |
| `report.hoursRounding`, `.attendanceMergeGapMin`, `.reversePrintOrder`, `.links` | ✅ | Station › **Rapport** (§1b–§1d) |
| `report.partnerOrgs` | ✅ | Station › **Rapport** – **and** the Arbeitsmappe (§9h) |
| `alarms.autoArchiveDays`, `.staleIncidentDays`, `.captureWindowHours`, `.webhooks`, `.groups` | ✅ | Station › **Alarme & Einsätze** |
| `alarms.exerciseAutoCloseHours` | ❌ | config-as-code only (`admin_config`); default 12 – an Übung closes itself that many hours after its last human change |
| `alarms.groups[].winfapAlias` · `.tagespikett` | ❌ | dead fields – see the note under `alarms` below |
| `fleet.vehicles` | ✅ | Station › **Fahrzeuge & Symbole** – **and** the Arbeitsmappe (§9h) |
| `fleet.attributeLists` | ✅ | the Arbeitsmappe's «Symbolfelder» sheet (§9h) – ⚠️ **not** the «Fahrzeuge & Symbole» page: the table there is a viewer with no editor |
| `fleet.partner.*` | ✅ | the Arbeitsmappe only (§9h) – ⚠️ it is the **legacy** shape, see the caveat in §9h |
| `mittel.catalogue`, `mittel.sources` (incl. `catalogue[].stock`) | ✅ | the Arbeitsmappe only (§9h) |
| `mittel.catalogue[].when`, `.perAtemschutz`, `.equipment`, `fleet.vehicles[].winfapAlias` | ❌ | **preserved but not editable** through the Arbeitsmappe (§9h); a file is the only way to set them |
| `roster.nameOrder` | ✅ | Personen › **Personal** (§4) |
| `roster.source` | ❌ | **file only** – «Personal» edits the crew and the name order, never where the crew comes from ([`SETUP.md` §4](SETUP.md)) |
| `roster.autoSync` | ❌ | **file only** – how much the nightly Divera sync may do on its own (§4a) |
| `roster.diveraResponses` | ❌ | **file only** – what each Divera Rückmelde-Status means for «Anrückend» (§4a) |
| `roster.ranks` | ✅ | the CSV import's «Grade zuordnen» → `adopt` (§4b) – **and** the Arbeitsmappe (§9h). There is no rank *form* |
| `mittel.units` | ❌ | **file only** – the Arbeitsmappe does not carry it |
| `alarmKeywords` | ❌ | **file only** – it is a paste-a-document, not a fill-a-form (§1a) |
| `sharepoint.intervalMinutes`, `.sources` | ❌ | **file only** – which folders the station pulls from is set up once and then wants to be reviewable and reproducible (§6c). The four Azure **credentials** are in the browser, at `/admin` → Anbindungen › SharePoint; System › SharePoint-Anbindung is the read-out |

Two things that are **not** part of this document and are managed on their own pages: the
integration credentials (`/admin` → **Anbindungen**, §6) and the three database-stored tokens
in §6b. Einsatzobjekte + Modul-PDFs and checklist templates are not config paths either, and
both now have browser pages – §9e and §9f.

> ⚠️ **Every write replaces the WHOLE document.** There are no partial writes – the admin UI, the
> CLIs and the backup importer all upsert the complete row. Four consequences you have to know,
> and each of them is a guard `PUT /api/config` applies to **every** caller – a browser, a CLI
> push, a script, an agent (`backend/app/config_guard.py`):
>
> 1. **`identity.assets` is not editable through this document.** The branding slots are written
>    by the upload endpoints (`POST` / `DELETE /api/branding/{slot}`) and by `admin_branding push`,
>    because the URLs behind them only exist once a blob has been stored. A `PUT` or a `load` that
>    omits or nulls them **carries the stored values over** instead of clearing them. Removing a
>    logo means `DELETE /api/branding/{slot}`. `referenceLayers` is carried the same way whenever
>    the submitted document **does not mention the key at all** – the layers are written by
>    `admin_geodata` and the SharePoint pull, and a caller that never names the section is not
>    asking for anything to happen to it. Sending `"referenceLayers": []` **is** naming it, and
>    goes to point 3.
> 2. **`PUT /api/config` requires optimistic concurrency from everybody.** `GET` returns an
>    opaque `version` (a hash of the stored document); send it back as `If-Match` and a write
>    against a document somebody else has changed since is refused with **409** instead of
>    silently winning. The Verwaltung does this on every autosave – without it, a browser tab left
>    open reverted a whole station's config on the next nudge of one unrelated field. A write
>    with **no** `If-Match` is refused with **428 Precondition Required** (the response's `ETag`
>    is the token to come back with).
>
>    The version check, history snapshot and replacement run under the same database row lock
>    (`deployment_config.config_row(lock=True)`). A second simultaneous save therefore checks
>    the version AFTER the first commits. Branding, rank adoption, geodata and workbook imports
>    take the same lock before deriving the document they preserve; workbook previews stay
>    read-only. Taking the lock only after planning would still overwrite a newer save.
>
>    ⚠️ Two earlier versions of this guard each left a hole. Merely making the header optional
>    protects only tabs new enough to send it, and the tab that does the damage is by definition
>    an old one – the demo was clobbered a second time that way. Requiring it of *browsers only*
>    (detected by `Sec-Fetch-Site` / `Origin`, which `curl` and `httpx` do not send) then left the
>    exemption to every script and every agent. All the in-repo writers send it; a raw `curl`
>    script of your own needs one extra `GET`.
> 3. **A write that would EMPTY a populated section is refused** with **409** and a body naming
>    the sections (`{"error": "would_empty_sections", "emptiedSections": [...], "override":
>    "?force=true"}`). Publishing an old document over a newer one is the shape of every one of
>    these incidents, and it reports success while a station quietly loses its Dienstgrade, its
>    Doktrin or its Partnerorganisationen. A write that means it repeats the request with
>    **`?force=true`** – the same decision `load`/`push --force` is (§9b).
> 4. **Keys the schema dropped come back as `warnings`**, not as an error: `["ignored: identitiy
>    — did you mean identity?"]`. Every model is `extra="ignore"` (which is what lets an older
>    deployment read a newer document), so a typo configures nothing and used to be answered with
>    a plain **200**. The write still happened – a warning is a report, not a refusal.
>
> **`POST /api/config/validate` is the dry run in front of all of that** (admin-only, writes
> nothing). Body = the candidate document; the answer says `valid`, `errors` (as
> `field.path: message` lines), `warnings`, `emptiedSections`, `changedSections` and the current
> `version` – so the follow-up `PUT` carries a correct `If-Match` instead of a guess. ⚠️ A
> document that fails the schema is **200 with `valid: false`**, never 422: the endpoint reports a
> verdict on a document, and a 422 would make «this document is wrong» and «this request is wrong»
> the same answer.
>
> The schema itself is committed at [`config.schema.json`](config.schema.json) – the same JSON
> Schema `admin_config schema` prints, regenerated with `just config-schema` (which `just openapi`
> runs) and guarded by a pytest, so reading the contract needs neither a Python toolchain nor a
> running server.

```jsonc
{
  "identity": {
    "appName": "Feuerwehr Musterdorf",        // shown in title bar, login, help; default "KP Front"
    "shortName": "FWM",                         // the menu button at the top left of «Karte & Objekte»
                                                //    (≤ 8 characters, trimmed; longer → 422). Beside
                                                //    the uploaded `assets.logo` if there is one.
                                                //    Unset → a neutral menu symbol (or the logo alone)
    "locale": "de-CH",                          // "de-CH" | "en" | "fr" | "it" (the Sprache picker);
                                                //    another tag resolves by its primary subtag,
                                                //    an unknown one falls back to German
    "accentColor": "#c4161c",                   // HEX ONLY (#rgb/#rgba/#rrggbb/#rrggbbaa, `#`
                                                //    optional on input, stored lowercase with it);
                                                //    anything else is refused with 422. Flows
                                                //    through the --accent token system AND becomes
                                                //    the manifest's hex-only `theme_color` (§14).
                                                //    A value stored BEFORE this rule is read as
                                                //    unset rather than refused, so an old row
                                                //    cannot lock a station out of /admin.
    "assets": {                                 // ⚠️ READ-ONLY here – written by the branding
                                                //    endpoints / `admin_branding`; see the note
                                                //    above and §3 for upload rules
      "logo": "logo.svg",                        // ref into asset storage
      "reportLogo": "report-logo.svg",           // letterhead; falls back to `logo` when unset
      "favicon": "favicon.svg",
      "iconPng192": "icon-192.png",              // installed-PWA home-screen icons, square PNG
      "iconPng512": "icon-512.png"
    },
    "helpIntro": "… ist die digitale Lage- und Einsatzführung der Feuerwehr Musterdorf …",
    "kommandant": "Maj Hans Muster",            // pre-fills the Kommandant signature line on the Einsatzrapport
    "demoNote": null                            // demo deployments only: a note on the login screen
                                                //    (e.g. the shared PIN), shown only while
                                                //    identity.demoMode is true
  },

  "map": {
    "defaultView": {
      "center": [7.55604, 47.51510],            // [lon, lat] WGS84 …
      "centerLv95": null,                         // … OR [easting, northing] EPSG:2056 (one of the two)
      "zoom": 16
    },
    "geocoder": {
      "defaultLocality": "4104 Musterdorf BL",   // appended to bare street addresses; "" = none
                                                 // (skipped once the operator types a locality
                                                 //  themselves – a PLZ, or anything after a
                                                 //  comma – and its town ranks hits first)
      "bboxLv95": "2598000,1252000,2625000,1270000"  // "minE,minN,maxE,maxN" to rank local hits; "" = national
                                                 // (also the region whose official street names
                                                 //  the backend caches to retry a typo –
                                                 //  «haupstrasse 12» → «Hauptstrasse 12»)
    },
    "serviceArea": { "municipalities": [2771] }, // the Einsatzgebiet (BFS numbers) for «Unterirdische
                                                 // Bauten»; [] = the municipality at defaultView. The
                                                 // station's objects get 500 m around them either way
    "buildingRegister": null,                    // the Gebäude card's federal-register half (GWR + BFE):
                                                 // null = on wherever the Einsatzort lies in CH,
                                                 // false = never ask them (docs/building-card.md)
    "objectCategories": [                        // «Karte & Objekte»: the station's object colours.
      {                                          // Ordered, FIRST match wins; [] = the default look (ink)
        "id": "pv",                              // [a-z0-9_-], unique
        "label": { "de": "Photovoltaik", "fr": "Photovoltaïque" },  // or one string
        "color": "#f59e0b",                      // #rrggbb or "ink" (the default look, per theme): dot, tag rim, outline
        "match": { "modules": ["modul5-pv*"] }   // kinds? ["einsatzobjekt"|"objekt"] («depot» retired: matches nothing),
      }                                          // modules? globs (* any run, ? one char);
    ]                                            // both named = both must hold; none = catch-all
  },

  "referenceLayers": [ /* see §2 – entirely station-supplied, none bundled */ ],

  "fleet": {
    // Station vehicles for the Alarmierungs-/Ausrückzeiten grid (rapport form, paper
    // Erfassungsblatt, milestone webhook matching, stats export). `id` should equal the
    // sender's device name (Traccar convention). Empty = every vehicle-times surface hidden.
    // Edit on Verwaltung › Fahrzeuge & Symbole or on the «Fahrzeuge» sheet of the Arbeitsmappe
    // (§9h) – the latter carries `winfapAlias` over on an id match but cannot set it.
    "vehicles": [],                               // e.g. { "id": "tlf", "label": "TLF", "winfapAlias": "TLF" }
    // Data-driven Auswahl-Vorschläge: each entry attaches a suggestion list to one symbol
    // field. `field` is "title" (the symbol's title combobox) or a detail-row key (e.g. "Typ",
    // "Einheit"). Free typing in the Lage always stays possible – these only prefill. Edit on
    // the «Symbolfelder» sheet of the Arbeitsmappe (§9h) or in the config JSON via CLI.
    // ⚠️ Verwaltung › Fahrzeuge & Symbole only SHOWS them – that table has no editor.
    "attributeLists": [
      { "symbol": "VKF Fahrzeug",          "field": "title",   "options": ["TLF", "ADL", "HLF", "ELW"] },
      { "symbol": "VKF Luefter mobil",     "field": "Typ",     "options": ["Überdruck", "Elektro", "Akku"] },
      { "symbol": "FW Kleinloeschgeraet",  "field": "Typ",     "options": ["Wasser", "Schaum", "CO₂"] },
      { "symbol": "VKF Bereich Feuerwehr", "field": "Einheit", "options": ["Stützpunkt", "Nachbarwehr"] },
      { "symbol": "VKF Bereich Sanitaet",  "field": "Einheit", "options": ["Rettungsdienst", "Rega"] },
      { "symbol": "VKF Bereich Polizei",   "field": "Einheit", "options": ["Kantonspolizei"] },
      // what an Offizier on the Lage is DOING – the sector they were given, not their rank
      { "symbol": "FW Offizier",           "field": "Funktion",
        "options": ["Of-Front", "Lüften", "Atemschutz", "Retten", "Logistik"] }
    ]
    // Legacy fixed fields (vehicleTypes/luefterTypes/kleinloeschTypes/partner) are still
    // accepted as a compatibility fallback; normalize them into attributeLists in config.
  },

  "doctrine": {                                  // FKS defaults shown; override per corps
    "defaultFunkkanal": 11,                       // null = no preset (national default)
    "defaultFunkkanalEinfach": null,              // default channel for Trupps OHNE Atemschutz;
                                                  // null = same as defaultFunkkanal
    "funkkanalMin": 1, "funkkanalMax": 9999,     // the two defaults above stay inside this
                                                  // range (/admin › Doktrin holds others back)
    "alarmBar": 100,                              // Alarmdruck (bar) for a Trupp AT WORK. One line
                                                  // on the way in – the older 60-bar
                                                  // «Mindestdruck» tier was dropped 2026-07-27.
                                                  // 0 is reserved for identity.demoMode deployments
    "alarmBarRueckzug": 50,                       // …and the quieter line once the Trupp is on
                                                  // RÜCKZUG. Must not exceed alarmBar – see below
    "contactIntervalMin": 5,                      // SCBA contact interval – "Kontakt fällig" (amber), 1–30 min
    "contactGraceSec": 60,                        // Nachfrist after the interval before the überfällig alarm, 0–300 s
                                                  // (one range for doctrine, per-Einsatz overrides and push –
                                                  // CONTACT_BOUNDS / alarm_validation; out of range = shipped value)
    "defaultPressureBar": 300, "pressureStep": 10, "pressureMax": 320,
    "entryPressureMin": 270,                      // below this Eingangsdruck the Trupp form asks
                                                  // once; 0 = never ask – see below
    "cylinderLiters": 7,                          // the two numbers behind the air estimate
    "estConsumptionLPerMin": 50,                  // («noch ≈ N bar») on the Trupp card
    "auftragColors": null,                        // starting colour per Auftrag id, e.g.
                                                  // { "loeschen": "#e8392b" }; null = every Trupp
                                                  // its own colour (overridable per Trupp)
    "nearbyObjectWarnM": 25,                      // Modul-Pläne: warn «nicht die Einsatzadresse»
                                                  // only beyond this many metres – see below
    "equipment": [                                // Ausrüstung a Trupp can take in – short labels,
      { "id": "retthaube", "label": "Retthaube" }, // printed on the card and the Rapport. Absent /
      { "id": "wbk", "label": "WBK" },             // empty = these three shipped defaults. Ids are
      { "id": "multiwarn", "label": "Multiwarn" }  // what a Trupp stores – renaming one orphans
    ]                                             // the Trupps that carry it (they print the id)
  },

  "roster": {
    "source": "manual",                           // "divera" | "manual" (CSV/hand) |
                                                  // "snapshot" (a published roster file) – see §4
    "nameOrder": "last-first",                    // "last-first" (Meier Hans, default) |
                                                  // "first-last" (Hans Meier) – applies to every
                                                  // surface: lists, map tags, Rapport, print
    "autoSync": "safe",                           // how much the NIGHTLY Divera sync may do:
                                                  // "safe" (default – joins/renames/Grade, never
                                                  // deactivates), "full" (also deactivates the
                                                  // members who left), "off" – see §4a
    "diveraResponses": {},                        // Divera Rückmelde-Status → "coming" |
                                                  // "not_coming" | "other", by id ("13") or name
                                                  // ("Komme nicht"); "other" = ignored;
                                                  // unset = read off the name – §4a
    // The station's Dienstgrade, MOST SENIOR FIRST – the order here IS the seniority order.
    // `key` is what a CSV import and a roster snapshot match on (§4b, §4c); `abbr` is the short
    // badge in lists; `tier` drives the «nur Offiziere» picker filter and the Anwesenheit
    // grouping. Empty = the frontend's in-code Swiss default (`src/lib/rank.ts`). Edited on the
    // «Dienstgrade» sheet of the Arbeitsmappe (§9h) or by a CSV import's `adopt` (§4b) – there
    // is no rank form. A Dienstgrad somebody still carries cannot be dropped.
    "ranks": [
      { "key": "maj",  "label": "Major",        "abbr": "Maj", "tier": "officer" },
      { "key": "wm",   "label": "Wachtmeister", "abbr": "Wm",  "tier": "nco" },
      { "key": "sdt",  "label": "Soldat",       "abbr": "Sdt", "tier": "crew" }
    ]
  },

  "mittel": {                                    // material-use sheet (Mittel): billing/report + "brauchen wir mehr?"
    // Station catalogue of materials/equipment crews use up OR deploy (consumables like Ölbinder
    // AND reusable gear like Lüfter/Wärmebildkamera). `unit` seeds the entry's default unit
    // (editable per incident); `category` groups the picker + Bestand view; optional `stock` is
    // the nominal per-source load-out (→ used/available readout + the Bestand overview, where
    // sources omitted = none there). Anything not listed → type «Anderes Material» in-app.
    "catalogue": [
      { "id": "oelbinder",        "label": "Ölbinder (Granulat)", "unit": "Sack", "category": "Ölwehr" },
      { "id": "luefter",          "label": "Lüfter",              "unit": "Stk",  "category": "Geräte",
        "stock": [ { "source": "tlf", "qty": 1 }, { "source": "pio", "qty": 1 } ] },   // → MoWa: none
      { "id": "atemschutzgeraet", "label": "Atemschutzgerät",     "unit": "Stk",  "category": "Atemschutz",
        "perAtemschutz": "person" },                // ← counted off the Atemschutz-Tafel: one per crew member of
                                                    //   every live AS-Trupp ("trupp" = one per AS-Trupp instead)
      { "id": "wbk",              "label": "Wärmebildkamera",     "unit": "Stk",  "category": "Atemschutz",
        "equipment": "wbk" }                        // ← one per live Trupp (any kind) carrying that Ausrüstung id
                                                    //   (doctrine.equipment / the shipped retthaube·wbk·multiwarn)
    ],
    "sources": [                                  // where a Mittel was drawn from – optional per entry,
      { "id": "tlf",     "label": "TLF" },        // typically the vehicles + the depot. The picker
      { "id": "pio",     "label": "Pio" },        // offers exactly this list (no free-typed sources).
      { "id": "magazin", "label": "Magazin" }     // `stock[].source` references these ids.
    ],
    "units": ["Stk", "l", "Sack", "Flasche", "Dose"]  // unit suggestions for custom entries; free text always ok
    // `catalogue`, `catalogue[].stock` and `sources` are edited on the «Mittel», «Mittel-Bestände»
    // and «Quellen» sheets of the Arbeitsmappe (§9h) – there is no form for them. `units` is NOT
    // in the workbook and is carried over untouched by it: a config file is the only way to set it.
    // `catalogue[].when` (the symbol-variant rule – `{"Typ": "Exhauster"}`, a list of clauses
    // being an OR), `perAtemschutz` and `equipment` are likewise preserved by the workbook on an
    // id match, never written by it: a file or the CLI is the only way to set them. All three feed
    // the «Gesetzt, aber nicht erfasst» strip of the Mittel sheet – `symbol`/`when` from what
    // stands on Lage/Plan, the other two from the Trupps on the Atemschutz-Tafel.
  },

  "alarms": {                                    // alarm auto-archive + intake extras
                                                  // NOTE: auto-open is no longer a setting – every alarm
                                                  // opens its Einsatz on arrival, on every path. The old
                                                  // "autoOpen"/"autoOpenPriorities"/"autoOpenKeywords"
                                                  // keys are still ACCEPTED and IGNORED (dropped in the
                                                  // next MAJOR); what they used to buy – test alarms and
                                                  // Nachbarhilfe not being counted – is now the stats
                                                  // export's editor_opened_at filter, docs/STATS-EXPORT.md
    "autoArchiveDays": 7,                         // archive untouched auto-opened incidents (never any
                                                  // workspace sync) after N days; 0 = sweep off
    "staleIncidentDays": 30,                      // …and incidents that WERE worked on but never closed,
                                                  // N days after the last edit. Never stamps report_done_at
                                                  // (the Rapport was not finished) and stays reversible via
                                                  // Reaktivieren; the Verlauf records why. 0 = off
    "exerciseAutoCloseHours": 12,                 // an Übung (never an Ernstfall) closes itself N hours
                                                  // after its last HUMAN change (a GPS/weather row is
                                                  // none); Verlauf «Automatisch abgeschlossen (Übung)»,
                                                  // reopenable as usual. 0 = off
    "captureWindowHours": 12,                     // how long the Erfassungs-Poster link (below) reaches
                                                  // an incident after it opened
    "webhooks": [],                               // outbound: POST on every incident creation (payload +
                                                  // adapters: docs/ALARM-INTEGRATIONS.md); fail-open
    "groups": []                                  // station alarm groups for the Alarmierungs-/Ausrück-
                                                  // zeiten grid (rapport form, Erfassungsblatt, milestone
                                                  // webhook, stats export). Empty = grid hidden. Example:
                                                  // { "id": "g2", "label": "Gr. 2", "color": "Rot" }
                                                  // ⚠️ `color` is NOT a colour – see below
  },

  "alarmKeywords": null,                         // the station's OWN alarm vocabulary – see §1a.
                                                 // admin sessions only; withheld from anonymous GET.
                                                  // null / omitted (normal) = the vocabulary shipped
                                                  // in backend/app/data/alarm_keywords.json

  "report": {                                    // Einsatzrapport form presets
    "partnerOrgs": [],                            // Partnerorganisationen checkbox row (paper + form);
                                                  // empty = no preset row, free text stays possible
    "reversePrintOrder": true,                    // station printer ejects face-up → reverse the
                                                  // relayed document; the download stays in order
    "hoursRounding": {                            // the BRACKETED Einsatzstunden figure – see §1b
      "stepMin": 30,
      "graceMin": 5
    },
    "attendanceMergeGapMin": 15,                  // presence blocks less than this far apart print
                                                  // as ONE stretch on the Personalblatt – see §1c;
                                                  // 0 = print every recorded block as recorded
    "links": []                                   // the station's own forms, as a tick-off list on
                                                  // the Rapport – see §1d. Empty = no such section
  },

  "integrations": {                              // ⚠️ ACCEPTED AND IGNORED. Availability is
    "diveraEnabled": false,                       // derived from the env credentials (§6), never
    "traccarEnabled": false                       // from this block; `GET /api/config` answers
  }                                               // with `diveraConfigured`/`traccarConfigured`
                                                  // instead. Setting these turns nothing on.
}
```

> **Validation:** the CLI/backend reject malformed config and CRS ambiguity (both `center` and
> `centerLv95` set). Asset-reference validation is tied to the asset-upload path; until then,
> config review should verify referenced files exist in the deployment store.

### `doctrine.alarmBarRueckzug` – the quieter line for a Trupp on Rückzug

`alarmBar` is one line, and it is the line for a Trupp **still working**. `alarmBarRueckzug` is
the second, *lower* one that applies once a Trupp's status is `rueckzug`: the order to come out
has been given, so holding the crew to the working Alarmdruck would make the card warn for the
entire walk back – and a warning that runs for ten minutes is one nobody looks at. Below the
Rückzug line it speaks up again, which is a crew that is genuinely late getting out. (This is not
the old 60-bar «Mindestdruck» second tier, which was dropped in 2026-07 and is not coming back;
that was a second line on the way *in*.)

Both halves of the app read it – the browser card and audible alarm (`src/lib/atemschutz.ts` ·
`alarmBarFor`) and the **killed-app Web Push** sweep on the server (`backend/app/push.py`), which
is why it is not a display preference.

| | |
| --- | --- |
| Range | integer, `> 0` and `≤ 300`; **must not exceed `alarmBar`** – a document that does is refused with the reason |
| Unset in the config | the shipped `50` applies, clamped to `alarmBar` if a station chooses a lower working line |
| Shipped value | `50`, in the CLI template (`admin_config example`) and in the frontend defaults (`src/config/appConfig.ts`) |
| Turning the distinction off | set it **equal to `alarmBar`** |

`alarmBar = 0` is reserved for deployments with `identity.demoMode = true`. The public demo seed
uses it, and both effective pressure lines become zero so one visitor's test does not generate
alarms for somebody else. A normal station configuration with zero is refused and keeps the
shipped `100`/`50` defaults. This exception applies to the working line only;
`alarmBarRueckzug` itself remains a positive config value.

Set it on **Station › Doktrin**, next to the Alarmdruck, or in the config file. It was file-only
until 2026-08-30, so a station configured entirely in the browser before that never set it and ran
on the fallback while a CLI-template station adopted a 50-bar Rückzug line it never chose – worth
one look at the field if that describes you. Either way, write the number down in your own
doctrine: it is a safety threshold, not a preference.

### `doctrine.entryPressureMin` – the one question about a low Eingangsdruck

On the Übung of 2026-09-23 the Restdruck had nowhere to go, so it was typed into «Eingangsdruck
korrigieren» after the Austritt, and the Rapport shows crews going in with 60, 170 and 180 bar.
The exit has its own Restdruck since then, the Eingangsdruck of a Trupp that is out is locked,
and an Eingangsdruck **below `entryPressureMin`** earns exactly one question in the Trupp form –
at the Anmeldung, on a re-entry with a *new* cylinder, or when corrected while the Trupp is
inside or registered: «180 bar ist für einen Eintritt tief (Station: ab 270). Stimmt das, meldet
der Trupp gleich einen Alarm bei ≤100.» with «Ändern» / «180 bestätigen». Nothing is refused,
and there is deliberately no upper bound: a low entry is sometimes simply true.

| | |
| --- | --- |
| Range | integer, `0`–`300`; `0` switches the question off |
| Unset in the config | the shipped `270` applies |
| Shipped value | `270`, in the CLI template (`admin_config example`) and the frontend defaults (`src/config/appConfig.ts`) |
| Never asked for | the station's own `defaultPressureBar`, and «Gleiche Flasche» on a re-entry (that bar is the Restdruck) |

⚠️ **A station on 200-bar cylinders lowers it** – to about `180` – or sets `0`. The shipped 270 is
sized for 300-bar bottles; left there, every full 200-bar cylinder typed in by hand would be
questioned (the station's own `defaultPressureBar` is exempt, a corrected 190 is not), and a
question asked every time is one nobody reads.

Frontend only – the server stores it and never checks a reading against it. Set it on **Station ›
Doktrin**, under the Eingangsdruck, or in the config file; read through `atemschutzDoctrine()`.

### `doctrine.nearbyObjectWarnM` – when the nearest object is «nicht die Einsatzadresse»

When an Einsatz address matches no station object, the Plan's Modul-Pläne offer the nearest one
with an amber chip and banner («Nächstes Objekt, nicht die Einsatzadresse»). The warning shows
only when that object lies **farther than `nearbyObjectWarnM` metres** from the Einsatzort: an
Einsatz addressed by the object's own name («Mühlemattcenter») matches no address but sits at
0 m, and a warning that is usually wrong teaches people to ignore the one that is right (sweep
E.6, 23.10.2026).

| | |
| --- | --- |
| Range | integer, `0`–`500` m; `0` warns on every address mismatch |
| Unset in the config | `25` |

Set it on **Station › Doktrin** or in the config file. A stored value outside the range is served
as `25` and logged, the rest of the document stays.

### ⚠️ `alarms.groups[].color` is not a colour

It is the **parenthetical printed after the group's Bezeichnung** on the two paper documents:
`"label": "Gr. 2"` plus `"color": "Rot"` prints **«Gr. 2 (Rot)»** on the Einsatzrapport's
Alarmierungs-/Ausrückzeiten grid (`src/lib/report.ts`) and on the paper Erfassungsblatt
(`src/admin/capturePdf.ts`). Free text – nothing parses it, nothing renders it as a colour, and
no CSS or map surface reads it. The name is a historical accident. The form on **Alarme &
Einsätze** calls it «Zusatz in Klammern (optional)» and previews the printed line, which is what
the field actually is; a station using its groups' colours as names («Rot», «Grün») is why it
looks like one.

`alarms.groups[].winfapAlias` and `alarms.groups[].tagespikett` are **read by nothing in this
repository.** They still validate, they still round-trip, and the admin form deliberately gives
them no input while merging them through untouched – but do not build on them: they are dropped
at the next MAJOR, together with the `autoOpen*` keys above.

---

## 1a. `alarmKeywords` – the station's own alarm vocabulary

Incoming alarms are classified from the words in their title: a **damage category** (the FKS
Schadenkategorie stored on the incident) and a **priority** (`HIGH` wakes everyone; everything
else is `LOW`). The words that do that are German fire-service words – `FEUER`, `VU`,
`MED USTÜ` – and they ship with the app in
[`backend/app/data/alarm_keywords.json`](../backend/app/data/alarm_keywords.json). **Nearly
every station should leave this alone.** The file is not vendor-specific: it is what a Swiss
brigade's dispatch text looks like, whoever delivers it.

Set `alarmKeywords` when that is not what *your* dispatch text looks like – another language,
another Stichwort set, another alerting system.

**It replaces the shipped vocabulary wholesale.** There is no per-keyword merging: the moment
you set it, your block is the entire vocabulary and the shipped words are gone for this
deployment. That is deliberate. Two half-vocabularies that combine somewhere are impossible to
read at 3am, and «which keywords are running» has to have one answer in one place. **So to add
a single keyword, copy the shipped file, add your line to the copy, and paste the whole thing
in** – the file is the starting point, not a base to patch.

```jsonc
"alarmKeywords": {
  "schema_version": 1,                            // the shape this block was written against
  "keyword_to_category": {
    "pairs": [                                    // ORDERED: first keyword found in the
      ["INCENDIE", "brandbekaempfung"],           // uppercased title wins. Keywords must be
      ["ACCIDENT", "strassenrettung"]             // UPPERCASE – matching uppercases the title
    ]
  },
  "fallback_category": "diverse_einsaetze",       // used when nothing matches
  "high_priority_keywords": {
    "groups": [                                   // any match in title+text ⇒ HIGH. The grouping
      { "group": "Feu",                           // is for the reader; order means nothing here.
        "keywords": ["INCENDIE", "FUMÉE"] }       // Only life-threatening words belong here.
    ]
  }
}
```

Categories are **keys, not labels**: they must be ones the app has a German label for –
`brandbekaempfung`, `elementarereignis`, `strassenrettung`, `technische_hilfeleistung`,
`oelwehr`, `chemiewehr`, `strahlenwehr`, `einsatz_bahnanlagen`, `bma_unechte_alarme`,
`dienstleistungen`, `gerettete_tiere`, `diverse_einsaetze`. A vocabulary routing anywhere else
is rejected, because those alarms would silently file under «Diverse Einsätze».

> **An invalid block fails the load; it is never ignored.** `admin_config validate|load` and
> `PUT /api/config` refuse the whole document and write nothing – a lowercase keyword (dead
> data that would never fire), a duplicate keyword (the later one unreachable), an empty list,
> an unknown category, a `schema_version` this build does not understand. A vocabulary that was
> quietly dropped would classify alarms wrongly and say nothing, and you would find out from an
> alarm that did not wake anybody.

**Checking which vocabulary is running**, without opening the database:

```bash
curl -s http://localhost:8001/api/config | jq .alarmVocabulary
# { "source": "shipped", "schemaVersion": 1, "titleKeywords": 19,
#   "highPriorityKeywords": 41, "fallbackCategory": "diverse_einsaetze" }
```

`source` is `"shipped"` or `"deployment"`. `validate`, `diff` and `load` print the same line.
A saved change is live on the next alarm (the resolved vocabulary is cached for at most a
minute, and a `PUT` clears the cache immediately).

Two things this does **not** reach: the *matcher* (kp-front matches every keyword as a plain
substring – the shipped file records where kp-rueck differs) and the German category **labels**,
which are the app's, not the station's. And `alarmKeywords` is deployment data: unlike the
shipped file it is never checksummed and never compared against kp-rueck.

**Who can read it back.** `GET /api/config` is public – the login screen needs branding before
anyone can log in – and `alarmKeywords` is withheld from anonymous callers. The
words are not secret (the shipped vocabulary is on GitHub), but nothing in the frontend reads
them: matching is entirely server-side, so publishing a station's wording pre-login would be
surface for nothing. An **admin session gets the full block**, which is not a detail: the admin
UI does a full-document `PUT`, so a section the admin never received is a section the next
unrelated edit would silently delete.

Three more are withheld (RBAC audit, 22.10.2026), emptied rather than removed so the answer looks
like a station that configured none: **`alarms.webhooks` and `sharepoint.sources` reach an admin
session only** – addresses the server talks to, and a webhook URL is often a capability (a
`sig=`, a `?secret=`); no client but `/admin` reads them. **`objectVisits.destinations` reaches
every PIN session** (the Objektbesuch's «Ablage» line reads it) but no anonymous caller and no
link, like `report.links`.

What stays public either way is the `alarmVocabulary` **summary** – `source`
(`shipped` | `deployment`), `schemaVersion` and counts, never the words – so "is my override
live?" is answerable without a session. The CLI is unaffected: `admin_config` reads the
database directly rather than through the API.

---

## 1b. `report.hoursRounding` – Einsatzstunden on the printed rapport

The rapport carries one summary line under the roster:

```
6 Anwesende · Einsatzstunden 14:35 · gerundet 16:00
```

**The first figure is raw** – every person's presence blocks summed to the minute, never rounded.
That is what actually happened, and it is what the second figure has to be checkable against.

**The second is the Sold convention.** Each person's own time is rounded UP to the next `stepMin`
block, but only once `graceMin` past the previous one; the rounded values are then summed. With
the shipped default (`stepMin: 30`, `graceMin: 5`):

| served | counts as |
| --- | --- |
| 0:00 – 0:05 | 0:00 |
| 0:06 – 0:35 | 0:30 |
| 0:36 – 1:05 | 1:00 |
| 1:06 – 1:35 | 1:30 |

The grace is what stops a crew that stayed three minutes over the half hour from being counted a
whole block for it.

**Rounding is per person, then summed – never on the total.** Three people at 0:20 each are 1:00
raw and 1:30 rounded; rounding the total instead would say 1:00 and quietly make the answer depend
on how many people happened to come.

A station that counts whole hours sets `{"stepMin": 60, "graceMin": 10}`. Set it in the admin UI
under **Rapport → Rundung**, which shows a worked example under the two fields; the value is the
same on every rapport that station prints.

**The rule itself is NOT printed on the sheet.** It is identical on every rapport a station ever
produces, so printing it would repeat the same sentence on every sheet forever – it belongs in the
Weisung, next to the other conventions the people signing these sheets already work to. The
figure it produces is checkable against the raw number beside it, which is why the raw one is
printed at all.

⚠️ This is a summary for the person signing the sheet, not accounting. Sold and kantonale
Statistik are computed in WinFAP from the recorded von–bis, and the per-person Stunden columns
stay off the paper deliberately (field-classification decision, 2026-07-17).

---

## 1c. `report.attendanceMergeGapMin` – two ticks that are one arrival

Presence is recorded in blocks: somebody arrives, leaves, comes back. Two blocks a minute apart
are almost never two deployments – they are a corrected mis-tap, or the QR poster and the tablet
recording the same arrival from two sides. Printed as recorded that came out as two lines under
one name:

```
Keller Laura        08.08. 22:11 – 08.08. 22:58
                    08.08. 22:59 – 08.08. 23:20
```

…which reads as a person who went home during an Einsatz that never stopped. With the shipped
default of 15 minutes the sheet prints one stretch, `22:11 – 23:20`.

**The record keeps both blocks.** Only the rapport merges them, and the Anwesenheit surface still
shows and edits exactly what was recorded – that is where a wrong tick is corrected. The
Einsatzstunden follow the same merge, so the hours under the roster add up to the lines above them.

**A station number, not a per-incident one.** Whether a ten-minute gap is «a break» or «two
deployments» is a Weisung, and it has to mean the same on every sheet the Wehr files – so it is
not something an EL settles at 3am. A Wehr that runs long deployments with real Ablösungen and
wants every one of them on paper sets `0`.

---

## 1d. `report.links` – the station's own forms, on the Rapport

Every Wehr has paperwork that lives outside this app and still has to be filled in after an
Einsatz: a Getränke-Abrechnung for the Gemeinde, a Schadenmeldung for the Versicherung, an
internal form. `report.links` puts them on the Rapport as a tick-off list under the Beilagen –
title, an optional note saying *when* it has to be filled in, and a link that opens it.

**The shipped default is an empty list, and that is the intended state for most deployments** –
these forms are one station's own, so no default here could ever be right for another. Configure
none and the section does not exist: no empty card, no chip, nothing explaining a feature this
station does not use. Edit the list in **Verwaltung › Rapport**; a row whose URL is not
`http`/`https` is dropped rather than rendered as a link the app will not open.

An illustrative entry (the ids below are made up – yours come from your own form):

```json
"links": [
  {
    "id": "getraenke",
    "title": "Getränkeabrechnung Gemeinde",
    "note": "Nur wenn Getränke bezogen wurden",
    "url": "https://forms.example.ch/getraenke?usp=pp_url&entry.111111111={einsatzleiter}&entry.222222222=Einsatz {datum}"
  }
]
```

### Placeholders

The URL may carry `{platzhalter}` tokens, substituted **URL-encoded** at the moment the link is
opened – so the form comes up with the incident already in it instead of blank:

| Token | Value |
|---|---|
| `{stichwort}` | the alarm title |
| `{ort}` | the address |
| `{datum}` | date of the Alarmierung (`14.08.2026`) |
| `{alarmzeit}` | Alarmierung, date **and** time |
| `{einsatzende}` | Einsatzende, date and time |
| `{einsatzleiter}` · `{kontaktperson}` | the two names off the Rapport |
| `{kurzbericht}` | the Kurzbericht text |
| `{wehr}` | the station's own name (`identity.appName`, falling back to `KP Front`) |

An **empty** field resolves to an empty string (a rapport is written while the Einsatz runs). An
**unknown** token is left standing verbatim: a typo then shows up as `{einsatzort}` in the preview
in Verwaltung and in the opened form, which is the only way anybody would ever find it. Only the
substituted values are encoded – the separators typed between them stay literal, because the same
string carries the `&` and `=` that hold the query together.

**Google Forms**: press *«Link zum Vorausfüllen abrufen»* in the form, type sample values, copy
the link, then swap the sample values for placeholders. The resulting URL has the shape
`?usp=pp_url&entry.<feld-id>=<wert>`. Anything else that prefills from the query string works the
same way.

### ⚠️ A placeholder sends incident data to whoever hosts the form

This is the part to think about before configuring one. `{ort}` is the incident address,
`{einsatzleiter}` and `{kontaktperson}` are named individuals, and `{kurzbericht}` is free text
that in this line of work routinely describes what was found at an address – including health
details about the people who live there. Put one in a link and that data travels **in the URL**
to whoever runs the form. `noreferrer` does not help here: the data *is* the address being
opened. It lands in the form provider's logs, in the operator's browser history, and is visible
to any browser extension on that device.

Use the narrow tokens (`{datum}`, `{stichwort}`, `{wehr}`) for third-party forms, and keep
`{kurzbericht}`, `{ort}` and the two names for forms your own Gemeinde or Kanton hosts. A
Google Form means Google. See [`PRIVACY.md`](../PRIVACY.md).

**The links are withheld from anonymous callers.** `GET /api/config` is unauthenticated by
design (the login screen needs the station's branding before anyone logs in), but `report.links`
is served only to a **signed-in** session – a PIN user or an admin. A prefill URL is a
capability: whoever holds it can submit to that form. An anonymous caller sees `links: []`,
byte-identical to a station that has configured none, so the withholding does not announce
itself either.

The app reads the config at boot, *before* login, so the very first fetch on a fresh device
comes back without them; the login re-reads it (`lib/auth` · `login`), and every later boot
already carries the session cookie.

That means "everyone with the station PIN", not "everyone". It is not a secret store: anyone who
can open the Rapport can read the URL, and it is in their browser history the moment they use
it. Do not put a token, a key or a secret path in a link, and prefer a form that is itself
restricted (Google Forms can require a sign-in from your own organisation) over one that is
open to whoever has the address.

### What it deliberately is not

- **Not printed.** The rapport is the record; a to-do list of links is not part of it.
- **Not an Abschluss-Assistent step.** A station's own paperwork does not belong in this app's
  completion model, and it must never be able to hold up an archive.
- **Not in the Verlauf.** Ticking off the Getränkeabrechnung says nothing about the Einsatz, and
  the Verlauf is the record of the Einsatz (`lib/report · META_QUIET`).
- **Never ticked automatically.** Opening a form says nothing about whether it was submitted. The
  app offers the tick once, when the operator **comes back** from the form – offered at the press
  it would expire on a tab that had just lost focus. The tick is per-incident, lives in the
  workspace blob, and merges per link id, so two devices ticking two different forms keep both.

### 1e. `objectVisits` – the optional Objektbesuche module

Off unless `objectVisits.enabled` is `true`. `captureRoles` (default `["editor","el"]`) says who may
record a visit, `lockAfterHours` (default `24`) how long after its completion a visit may still be
corrected before it goes view-only – `0` locks it at once, `null` never locks it, and the server
enforces it, not only the app («Station › Objektbesuche › Korrektur-Fenster»).
`proposalFields` is the station's field list for Korrekturvorschläge, and
`destinations[]` are the SharePoint folders the server files visits into (a visit at a place, with
no object, goes to the destination's `locationFolder`, «Allgemeine Meldungen/…» by default). The full contract – the
visit document, the APIs, the delivery – is [`object-visits.md`](object-visits.md); setting up a
destination is [`object-visits-sharepoint.md`](object-visits-sharepoint.md). No credential lives in
the section (`GET /api/config` serves `destinations` to PIN sessions only – «Who can read it back», §1a): the writer's app registration is the
`sharepoint_export` credential group, the organizer's key `object_visits_integration_key`.

### 1f. `access` – how far back a read-only account reads

`access.viewerHistoryDays` (default `7`, `0`–`3650`): a `viewer` account (the «Fahrer» tile) reads
the running Einsätze and those last closed within this many days; older ones answer 404 for it.
`0` = only the running ones. Server-enforced on every route; `editor` and `el` always read the
whole record. Config-as-code only – no field in `/admin`; set it with `admin_config` (show → patch
→ load). Rules and rationale: [`roles-and-access.md`](roles-and-access.md#the-viewers-window-since-2026-10-21).

---

## 2. Reference / werkleitungs layers – **station-supplied, nothing bundled**

No layers ship with the app except the swisstopo/OSM base maps (§7). Every operational
reference layer (hydrant, water/gas/electricity mains, hazard zones) is entered by the station.
Two kinds, mirroring the existing `LayerDef`:

### 2a. Raster layer (WMS / WMTS) – *paste a URL template*
```jsonc
{
  "id": "bl-hochwasser",
  "group": "Gefahren",                 // Wasser | Abwasser | Gas | Strom | Gefahren | (custom)
  "label": "Hochwasser",
  "icon": "drop",                       // drop | warn | hex | map | sat
  "kind": "wms",                        // "wms" | "wmts"
  "tiles": ["https://geowms.example.ch/?SERVICE=WMS&VERSION=1.1.1&REQUEST=GetMap&FORMAT=image/png&TRANSPARENT=true&SRS=EPSG:3857&WIDTH=256&HEIGHT=256&LAYERS=<LAYER>&BBOX={bbox-epsg-3857}"],
  "opacity": 65,
  "maxzoom": 21,
  "attribution": "© Geodaten Kanton …"
}
```
- The endpoint **must support EPSG:3857** tiling (`{bbox-epsg-3857}` / `{z}/{x}/{y}`) and **must
  send CORS headers** (the browser fetches it directly).
- Station gets the URL + layer name from its canton/commune GIS GetCapabilities.
- **Add one in the browser** at `/admin` → **Kartenebenen**: label, id, group, WMS/WMTS, the tile
  URL templates (one per line) and the attribution. The form **merges** over the stored row rather
  than rebuilding it, so `nightColor`, `opacity`, `maxzoom`, `symbol` and `autoActivate` – which
  have no input – survive an edit made next to them. Setting *those* still needs a config file or
  a manifest, and a whole library still wants `admin_geodata` (§9d).

### 2b. Vector layer (GeoJSON) – *for points/lines you own*
```jsonc
{
  "id": "hydrant",
  "group": "Wasser",
  "label": "Hydranten",
  "icon": "drop",
  "kind": "geojson",
  "geojson": "/api/reference/geo:hydrant",  // same-origin reference-store URL; a browser
                                        //   upload appends `?v=<version>` (see below)
  "vectorKind": "point",                // "point" | "line"
  "symbol": "SI Ueberflurhydrant",       // optional: render points as this FKS symbol
  "color": "#0f52b5",
  "nightColor": "#5b9bff",
  "attribution": "© Wasserversorgung Musterdorf",
  "autoActivate": ["Brandbekämpfung"]     // optional: Einsatz categories that auto-show this layer
}
```

`autoActivate` (also valid on raster layers) names the **Einsatz categories** – the German
VKF `kategorien` values (`Brandbekämpfung`, `Elementarereignis`, `Ölwehr`, …) – for which the
layer switches itself visible: when an incident of that category is opened for the first time,
and additively when an incident is later re-categorized (a BMA that turns out to be a real
fire brings the hydrants up). It only ever turns layers **on**, and once the operator has
toggled layers in an incident their choice is authoritative – a deliberately hidden layer is
not re-forced on reopen. Unset = the layer never auto-activates (the default).
You never write the `geojson` URL by hand. Two doors put the file in the reference store and
write this render config (with the resolved `/api/reference/geo:<slug>` URL) into
`referenceLayers`:

- **`/admin` → Kartenebenen**, for one layer at a time – upload the `.geojson`, fill in the
  label/group/colour, and it is live. **Replacing** the file later bumps the dataset **version in
  place**: the same layer id, a new `/api/reference/geo:<slug>?v=<n>` URL, so every device's
  service-worker cache misses and re-fetches instead of serving last year's hydrants. It does not
  mint a sibling layer. WGS84 is enforced in the browser, with a reprojection hint on rejection.
- **The `admin_geodata` CLI** (§9d), from a *manifest* – a layer entry plus a `file:` pointing at
  the GeoJSON. This is the path for a whole library at once, and for the fields the form has no
  input for (`nightColor`, `opacity`, `maxzoom`, `symbol`, `autoActivate`).

Restricted data (e.g. utility cadastre) stays in a **private data repo**, never in this one.

---

## 3. Uploaded assets & their formats

Stored in the asset store – a directory on the deployment's volume, `MEDIA_STORAGE_DIR`. There
is no object-storage backend for assets; back the volume up (`DEPLOYMENT.md` §6). Upload size
follows `MAX_UPLOAD_MB` (§6; default 110).

### 3a. Branding

| Slot | Asset | Format | Notes |
|------|-------|--------|-------|
| `logo` | Logo | SVG (preferred) or PNG | shown in login/header; transparent background |
| `reportLogo` | Report logo | SVG (preferred) or PNG | letterhead above the title on the printed Einsatzrapport – **empty falls back to the Logo**. Its own slot because a mark carrying the station's full name reads badly in a header and right on paper. |
| `favicon` | Favicon | SVG or ICO | browser tab |
| `iconPng192` | App icon 192 | **square PNG**, 192×192 | home-screen icon of the installed app |
| `iconPng512` | App icon 512 | **square PNG**, 512×512 | home-screen icon and splash screen |

`POST`/`DELETE /api/branding/{slot}` and `admin_branding` (§9c) accept those five slots, nothing
else. The two app icons are validated on their **bytes**, not their Content-Type: a non-PNG is
refused with 415, a non-square or wrongly-sized image with 422 naming the size you actually
uploaded. A larger square export is accepted and scaled down (nominal edge up to 4×), so a 1024²
icon is fine for either slot.

This validation does not make arbitrary SVG a safe untrusted document. Branding SVG is served
with a route-specific sandbox CSP, but a deployment-admin-supplied `symbols:*` catalogue is
rendered as inline tactical markup. In the supported one-station/custom model, the deployment
admin and private station-data repo are therefore a trusted code-equivalent boundary. Managed
hosting or delegated/untrusted upload access requires SVG sanitization plus an application-wide
CSP first; see [`SECURITY.md`](../SECURITY.md#accepted-single-station-deployment-constraints).

`/manifest.webmanifest` is **served by the backend**, not shipped as a static file: it takes the
built manifest and overlays `identity.appName`, `identity.locale`, `accentColor` (as `theme_color`)
and whichever of the two icons exist. A deployment that has uploaded neither keeps the bundled
KP Front icons, and any garbage in the config degrades to the built manifest rather than erroring –
this file is fetched by every tablet on every load.

⚠️ **iOS captures the home-screen icon when the app is added and never re-reads it.** A tablet that
already has KP Front on its home screen keeps the old icon until it is removed and re-added. This
is the usual "the rebrand didn't work" report, and it is not fixable from the server.

### 3b. Hydrants – GeoJSON
- **Type:** `FeatureCollection` of `Point` features.
- **CRS:** **WGS84 (EPSG:4326), `[lng, lat]`** – per RFC 7946. The app does **not** reproject;
  `admin_geodata` and the upload panel **reject** LV95-looking coordinates. Convert at the edge
  first (the private data repo's `leitungskataster_to_geojson.py` reprojects LV95 → WGS84).
- **Properties (all optional; geometry is the only requirement):**
  | property | meaning | example |
  |----------|---------|---------|
  | `type` | Über-/Unterflur | `"Überflurhydrant"` |
  | `nummer` / `id` | hydrant label | `"OH 045"` |
  | `leistung` | flow | `"1600 l/min"` |
  | `nennweite` | diameter | `"DN 150"` |
  | `druck` | static pressure | `"4.5 bar"` |
  - Unknown properties are ignored; they surface in the symbol detail panel.

### 3c. Plans (object plans) – PDF
- One PDF per module. The **module key** is parsed from the filename/field; accepted forms
  (already normalized in `useObjectPlans`):
  `modul1`, `modul2`, `modul3`, **`modul2-3` / `2-3` / `Modul 2/3` / `modul2_3`** (combined
  Zugang+Objekt sheet → single 2/3 tile), `modul6`.
- Module meaning (FKS object-plan doctrine):
  | key | title | content |
  |-----|-------|---------|
  | `modul1` | Übersicht | situation / access overview |
  | `modul2` | Wie komme ich herein | surroundings + accesses |
  | `modul3` | Was finde ich drinnen | Haupthahn, BMA, RWA |
  | `modul2-3` | Zugang & Objekt | combined 2+3 on one sheet |
  | `modul6` | Gebäudepläne | floor plans |
- Built-in, non-uploaded plan tiles (always available): `osm` (live OSM building outlines) and
  `tafel` (blank sketch sheet).
- **Objects** (which plans belong to which building) come from the backend object library
  (`/api/objects`, and `/api/incidents/{id}/objects` for the ones near an incident); a station
  with no object data simply has no object plans – the `osm` and `tafel` sheets still work.

---

## 4. Roster / personnel

`roster.source` selects how `Person` records are populated.

`roster.nameOrder` selects how they are **spelled**, station-wide: `"last-first"` (default,
«Meier Hans» – what Divera delivers and how crew lists and Soldblätter sort) or `"first-last"`
(«Hans Meier»). It is applied when a name is served, not when it is stored, so flipping it takes
effect on every device at once and needs no re-sync – but a name already frozen into a printed
Rapport or a closed incident keeps the spelling it was captured with. Set it in the admin UI
under **Personal**; everything downstream (lists, map tags, the Rapport, the print) follows,
including the abbreviated Trupp tag («Meier H.»), which uses the order to tell surname from
given name.

**How a module's sheets get onto the Karte** is the catalogue's choice too: `modules[].alignment`
is `auto` (the server computes a proposal for every sheet of the module, the admin approves it on
Objektpläne › Plan-Ausrichtung, and the field's «Karte verknüpfen» chip offers «Automatisch
ausrichten»), `manual` (reference points by hand only – the sheet waits on the review wall as
«Kein Vorschlag»), or `none` (never on the map, no review row). Unset means `auto` for `modul1`,
`modul2` and `modul2-3` and `none` for everything else; a family sub-slot inherits its family's
entry. The Modul-Katalog on the Objektpläne page shows the resolved value per module («Karte»
column), so what a station opted into is visible where the modules are listed. Proposals need
the server's `georef` extra and an Overpass mirror (§6); without them `auto` degrades to the
manual flow and the admin page says so.

**A module can step behind the Gebäude** (14.09.2026): `modules[].hideWhenGebaeude: true` hides
that module's tile in an Einsatz whose object carries a floor pack (Objektpläne › Plan-Ausrichtung
› Geschosse) – the Gebäude stack then shows the pack's pages. Default off, because the original
sheet keeps what the stack drops (sections, legend, title block); Oberwil sets it on `modul6`.
An object without a pack shows the module as before. Resolved like `viewer` (exact entry, numbered
sibling, family).

### 4a. `"divera"` – auto-sync
- Requires a Divera access key in env (§6). The backend syncs Divera personnel → `Person`.
- No file needed. The admin UI shows the synced roster and offers preview-then-execute sync; it
  is **not** locked – hand entry and CSV import keep working, and a sync never wipes a rank an
  admin set. Synced people carry a `divera` external identity, which is what the sync reconciles
  on; people you added by hand have none and are left alone.

**`roster.autoSync` – how much the nightly run may do on its own** (since 2026-09-11). The sync
used to be manual-only, so a roster was as current as the last time somebody remembered to press
the button. It now also runs once a night (04:17 Europe/Zurich, jittered), at one of three
levels:

| value | what the nightly run does |
|-------|---------------------------|
| `"safe"` | **the default.** Applies joins, renames and Dienstgrad changes. A member who has left Divera is **counted and left active** – a disappearance is as often a broken feed or a scope change as a resignation. The outstanding number is reported on System › Verbindungen, so the departures are visible rather than silently applied |
| `"full"` | the same, and the stale members are **deactivated** (`is_active = false`). Never a deletion: every past Einsatz and Rapport keeps its names |
| `"off"` | nothing unattended. «Mannschaft synchronisieren» in the admin UI still works exactly as before |

Two guarantees hold at every level. A run that fetched **no members at all** applies nothing and
is recorded as a failure – against an empty consumer list every member of the station is stale,
so one API hiccup would otherwise empty the Wehr overnight. And a run that fails never moves
«zuletzt synchronisiert»: the System card shows the last attempt and the last success separately,
because a green tick standing through a fortnight of refused keys is the failure this connector
is most likely to have.

**`roster.diveraResponses` – what a Divera answer means** (since 2026-10-08). The Anwesenheit's
«Anrückend» block sorts the Divera Rückmeldungen into *kommen* / *kommen nicht*; *other* answers
are ignored
(docs/divera-connector.md › Rückmeldungen). Divera has no such flag: each Einheit names its own
statuses, so the default is read off the status **name** – «nicht», «kein», «abwesend»,
«verhindert» → `not_coming` (checked first: «Komme nicht» also contains «komme»); «komm»,
«unterwegs», «einsatzbereit», «N min» → `coming`; a status that promises minutes → `coming`;
anything else → `other`. Only an Einheit whose words the default misreads sets this:

```jsonc
"roster": {
  "diveraResponses": {
    "17": "other",             // by status id (Divera › Verwaltung › Status) – an id beats a name
    "Bereitschaft": "coming"   // by name, case- and accent-insensitive
  }
}
```

The setting changes only the grouping, of what the poll stores from then on. Nobody is ever
marked present by an answer.

### 4b. `"manual"` – CSV import + hand entry
- Admin imports a CSV and/or adds people in the UI. **CSV columns:**
  | column | required | meaning |
  |--------|----------|---------|
  | `name` | ✅ | display name ("Meier Anna") |
  | `rank` | – | Dienstgrad, matched case/accent-insensitively against `roster.ranks` `key`/`label`/`abbr`; a value the list does not know **stops the import before anything is written** – see below |
  | `provider` | – | provider key an external identity is filed under (`personnel_external_identities.provider`) |
  | `external_id` | – | that provider's id for this person; required whenever `provider` is given |
  | `divera_id` | – | legacy spelling of `provider=divera` + `external_id`, accepted during the compatibility window – prefer the two columns above |
- Encoding UTF-8, comma-separated, header row required. Extra columns ignored. A row carrying a
  `provider`/`external_id` pair already known **updates** that person; everything else is added.
- The admin UI's «Beispiel-CSV herunterladen» button writes the minimal form (`name,rank`).

**Unknown Dienstgrade are decided before the import runs.** `POST /api/personnel/import-csv/preview`
reads the file and writes nothing; it answers with every rank value the station's list does not
cover, **grouped by value** (three people spelled `Sdt` are one entry, not three warnings) plus
the people behind it and a spelling proposal. The Verwaltung shows that as «Grade zuordnen», and
each value gets one of three answers, sent back to `POST /api/personnel/import-csv` in the
`decisions` form field:

| action | meaning |
|--------|---------|
| `map` | put the value on an existing rank (`rank` = its key) – for this file only |
| `adopt` | take it into the station's `roster.ranks` as a new rank, appended at the end (junior-most). **Writes config**, so it needs an admin session |
| `skip` | import those people without a Dienstgrad – reported back in the result |

A value with no decision is refused with `409` and **nothing** is written – not the ranks, not the
people. That is the point: the previous contract imported everybody, dropped the ranks it did not
recognise and listed them afterwards under a green success badge.

⚠️ `adopt` on a station whose `roster.ranks` is empty writes the shipped Swiss default list **plus**
the new ranks. The default was already the effective list (every reader falls back to it), so
storing only the adopted ones would strand every person already carrying `wm` or `kpl`.

### 4c. `"snapshot"` – a roster file somebody else publishes

Some stations keep their personnel list somewhere else entirely – a municipal HR system, a
cantonal register, a sibling application (fwo-admin), a spreadsheet. `"snapshot"` is for exactly
that case: **that system publishes a JSON file, and this deployment reads it.** It is one
personnel provider among several. It is selectable, it is disconnectable, and it is never
required – disconnecting it leaves every local person exactly where they were, because local
personnel are canonical and a provider only attaches identity and provenance.

Nothing about a particular publisher is built into the app: any URL or file a deployment can
read works, the schema names no vendor, and **KP Rück reads the same file with byte-identical
rules** (`backend/app/roster_snapshot.py` + `roster_snapshot_ingest.py`, pinned by checksum in
both repositories) – so a station running both apps publishes one file and feeds both the same
way.

#### Turning it on

| what | where | default |
|------|-------|---------|
| the source – an `https://` address, plain `http://` only inside the station's own network, or an absolute path on the server (`/data/roster.json`, `file:///…`) | **/admin › Anbindungen › Personenstamm (Snapshot)**, or `ROSTER_SNAPSHOT_SOURCE` in `.env` | empty = **off**, nothing fetched |
| a bearer token, sent as `Authorization: Bearer …` and **only over https** | same card, or `ROSTER_SNAPSHOT_TOKEN` | none |
| how often to poll (minutes, 5–1440) | `roster.snapshotIntervalMin` (config document, §1) | `60` |
| the deactivation cap (% of the active people one run may deactivate) | `roster.snapshotMaxDeactivatePct` | `20` |

The source is a credential rather than a config field because the config document is public
(`GET /api/config`) and travels in the Sicherung export; the address is readable on the card so
an operator can check it is the right file – put anything secret in the token, not in a query
string. `roster.source` stays a label: setting it to `"snapshot"` fetches nothing, and leaving it
on `"divera"` does not stop a configured snapshot. Divera's nightly sync and the CSV import keep
working beside it; if a station runs both feeds, each writes what it carries and the later run
wins a name, so most stations run one.

**What a run does** (`app/roster_snapshot_sync.py`, rules in `app/roster_snapshot_ingest.py`):

1. Fetch the bytes (≤ 5 MB, 30 s). An unchanged file (same sha256 as the last applied one) is
   skipped by the scheduled poll; «Jetzt abrufen» always reconciles.
2. Validate against the contract – including the medical-key guard below. **Any failure – an
   unreachable URL, a 404, a missing file, an invalid or medically-keyed document, a file older
   than the one already applied or stamped more than 5 minutes in the future, a run that crashes
   while writing – changes nothing**: the roster stays as the last good snapshot
   left it, and the System card shows the reason next to «Stand der Datei» of that last good one.
3. Match every person in the file to a local person, in this order: the snapshot's own key
   (`provider` + `external_id`); any identity the entry lists (`divera: 4711` finds the person
   the Divera sync created – **no duplicates, and the Divera link stays**); a name exactly one
   local person carries. Two candidates is `ambiguous_name`, identities pointing at two people –
   or at a person who already holds a different id at that provider, also one only found by name
   – is `conflicting_identity`; both are skipped and reported, never created a second time. An
   entry may not list an identity under the file's own `provider` (its id there is
   `external_id`) – the contract refuses such a file. **An existing identity link is never rewritten.**
4. Write: create the new people, update name / first / last / rank (a rank key the station does
   not define is reported, and the stored rank is left alone), attach missing identity links,
   reactivate people the file lists as active. Deactivate people the file lists as inactive and
   – only for `complete: true` – people carrying this provider's key whom the file no longer
   lists. Never anyone else: hand-entered people and people only Divera knows are never touched
   by absence. **Never deleted**: old Einsätze and Rapporte keep resolving the name. **Never
   mid-Einsatz**: a person mentioned in an Einsatz that is not archived keeps their place; the
   deactivation is postponed («Wartet auf das Einsatzende») and a later run applies it, even if
   the file has not changed. **While a Divera key is set**, people linked to Divera keep the
   name they have – the nightly Divera sync owns those names, and two feeds renaming each other
   is noise in every list.
5. **The cap.** A run that would deactivate more than `snapshotMaxDeactivatePct` of the active
   people (at least one is always allowed; `0` = never unattended, `100` = no cap) is **held**:
   nothing at all is written, the System card says «angehalten» with the numbers and lists who
   would go, and **«Abgänge übernehmen»** (admin, asks first) applies it. A run that would leave
   **no** active person is refused even then.
6. Record the outcome report (`roster-snapshot-outcome/1`) on `connector_states.roster_snapshot`,
   served on `GET /api/system` and read on System › Verbindungen; a file whose `generated_at`
   has not moved for 7 days is flagged as stale.

On demand: **«Jetzt abrufen»** on that card, or `POST /api/personnel/snapshot/sync`
(`{"force": true}` releases a held run, and also overrides the «older than applied» guard – the
way out when a publisher's wrong clock left a last-good from the future). Both need the admin
session.

#### Producing the file

- **Contract:** [`roster-snapshot.schema.json`](roster-snapshot.schema.json) (JSON Schema).
- **Worked example:** `backend/roster.snapshot.example.json`.
- **From a spreadsheet:** [`scripts/roster_snapshot_from_csv.py`](../scripts/roster_snapshot_from_csv.py)
  – standard library only, no app needed. Columns `external_id` (your stable key – never reuse
  or renumber one), `display_name`, optional `first_name`, `last_name`, `rank` (a rank *key*),
  `active` and any number of `id:<provider>` columns (`id:divera`); **every other column is
  dropped and named on stderr**, so a Tauglichkeit date in the export never reaches the file.
  Example input: [`roster-snapshot.example.csv`](roster-snapshot.example.csv).
  ```bash
  python3 scripts/roster_snapshot_from_csv.py export.csv --provider meine-wehr --out /data/roster.json
  ```
  `--out` writes atomically, so a deployment polling that path never reads half a file; run it
  from cron next to a self-hosted stack and point the source at the path.
- **Validate a file you produced** – no database, no network, no deployment needed:
  ```bash
  cd backend && uv run python -m app.roster_snapshot validate my-roster.json
  # OK: complete snapshot from 'musterdorf-personalstamm', 4 people (3 active), …
  ```
  `schema`, `outcome-schema` and `example` print the contract and a starting point.

**The document:**

| field | required | meaning |
|-------|----------|---------|
| `schema` | ✅ | `"roster-snapshot/1"` – the contract this file is written to |
| `schema_version` | ✅ | `1`. A consumer that does not know the version refuses the file rather than guessing |
| `generated_at` | ✅ | RFC 3339 **with offset**, when the publisher built the file. A consumer shows the age and warns when it stops moving – a feed that silently froze is the failure a puller cannot see from the inside |
| `provider` | ✅ | the key identities from this file are filed under (`^[a-z][a-z0-9_-]{1,31}$`, ≤32 chars). One station may read two snapshots; this is what keeps them apart |
| `complete` | ✅ | `true` = a statement about **everyone**, so a local person carrying this provider's identity and absent from the file has left and may be **deactivated** (never deleted – old Einsätze keep resolving the name). `false` = says nothing about absence, and a consumer must not act on it |
| `count` | ✅ | restated by the publisher and checked against `people`. A truncated upload must never read as "most of the brigade left" |
| `people` | ✅ | at least one. A file listing nobody is a broken publish, not an empty brigade |

**One person:**

| field | required | meaning |
|-------|----------|---------|
| `external_id` | ✅ | the publisher's own stable key, ≤255 chars. The only thing a consumer may match on without guessing – names change, keys must not |
| `display_name` | ✅ | how the person appears in a picker ("Meier Anna") |
| `first_name`, `last_name` | – | when the publisher holds them split |
| `rank` | – | a **key** from this station's `roster.ranks` (§1), never a label – the publisher does not have to know how you spell "Wachtmeister". A key you do not define imports the person without a rank and is reported |
| `active` | – | default `true`. `false` = on file, no longer operational |
| `identities` | – | up to 8 `{ "provider": …, "external_id": … }` pairs – the same person's id in *other* systems, landing in `personnel_external_identities` |

`identities` is how a snapshot says "the person this file calls `pers-0001` is the one your
alerting system calls 4711" **without either product growing a column named after a vendor**.
There is deliberately no `divera_id`-shaped field: vendor columns are deprecated here and in
KP Rück, and a contract that named one alerting system would be wrong for every station using a
different one.

#### 🔴 No medical fields, ever

A personnel file is where Arztuntersuchungs-Termine, Tauglichkeiten, Impfungen and absences
live in most fire-service systems. **None of them may appear in a roster snapshot**, and that
is not a request: `parse_snapshot` scans every key of an incoming document and **refuses the
whole file** – naming the key and the reason – if one looks medical, in German, English, French
or Italian. The same check runs over the schema itself in CI, so the guarantee survives future
edits of the contract rather than depending on whoever reviews them.

That is also why the document carries **no free-form `metadata` map and no `qualifications`
list**. A string map's keys are data, so no schema can see inside it, and a raw qualification
list is precisely where "Atemschutz-Tauglichkeit bis 2027" would arrive wearing a name no check
can object to. `rank` is the derived, non-medical projection the app actually uses.

Honest limit: the check reads *names*. Nothing stops a publisher writing medical information
into `display_name`. Do not.

#### What a consumer has to be able to say afterwards

A roster that quietly loses people corrupts every attendance figure derived from it, invisibly.
So the shape of the answer was fixed before anything implemented the question:
[`roster-snapshot-outcome.schema.json`](roster-snapshot-outcome.schema.json) is the report every
ingestion run produces (and the System card reads) – `matched` / `created` / `updated` / `deactivated`,
every person it **could not place** with the reason (`no_identity_match`, `ambiguous_name`,
`conflicting_identity`, `absent_from_snapshot`, `inactive_in_snapshot`), every `rank` key it did
not recognise, and `refused` for "I changed nothing, and here is why". **Unmapped people are
counted and flagged, never silently dropped.**

#### Versioning

`schema` and `schema_version` are bumped only when the *shape* changes. The two schema files are
generated from `backend/app/roster_snapshot.py` by `just roster-schema`; a test fails when the
committed copies drift from the code (the same arrangement [`openapi.json`](openapi.json) has),
and a second test pins their checksums because KP Rück holds byte-identical copies – editing the
contract is a two-repository change.

> Whichever source is set, the **app stays usable with an empty roster** – every person picker
> (Einsatzleiter, Fahrer, Trupp names) offers free-typing, so a station can run before importing
> anyone (§8). And `roster.source` is a *preference*, not a lock: CSV import and hand entry
> remain available on every setting.

### 4d. The station index – one address for all station data

Owner decision X6/X7 (09.10.2026): a station keeps its shared data in **one place** and feeds
both apps the same way. That place is a folder – on a web server, an object store, or next to a
self-hosted stack – with an **`index.json`** that lists the data files in it **by kind**, each
with its contract version and sha256. KP Front and KP Rück each get ONE setting, the address of
that index, and read the kinds they understand. The reader (`backend/app/station_index.py`) and
the builder script are byte-identical in both repositories.

```json
{
  "schema": "station-index/1",
  "schema_version": 1,
  "generated_at": "2026-10-09T04:00:00+00:00",
  "provider": "musterdorf",
  "files": [
    { "kind": "roster", "path": "roster.json", "schema": "roster-snapshot/1",
      "sha256": "<64 hex>", "bytes": 1234 }
  ]
}
```

- **Contract:** [`station-index.schema.json`](station-index.schema.json), example
  [`station-index.example.json`](station-index.example.json); `cd backend && uv run python -m
  app.station_index validate index.json` checks one without a network.
- **Turning it on:** /admin › Anbindungen › **Stationsdaten (Index)** – `STATION_INDEX_SOURCE`
  (an `https://` address of the `index.json`, or its absolute path on the server) and optional
  `STATION_INDEX_TOKEN` (bearer, https only, sent to the index and to its siblings, which always
  live on the same host). Empty = off.
- **Which roster is read:** when the index lists a `roster`, that one – the rest of §4c applies
  unchanged (matching, the hold, the report on System › Verbindungen, which now also says the
  roster came «über den Stationsdaten-Index» and names listed kinds this version does not read).
  When the index lists no roster, the **direct** `ROSTER_SNAPSHOT_SOURCE` of §4c is read as
  before – that setting stays as the fallback, and a station that set it needs to change nothing.
  An index that is set but cannot be read is an error on the card, never a silent fallback.
- **What is checked:** a listed file is read only when it hashes to the index's sha256 (and has
  its `bytes`, if given) – a file swapped after the index was written is refused for that run and
  the roster stays as it was. Paths are relative (`roster.json`, `personal/roster.json`), never
  `..`, absolute or another host. A kind this version knows is read only at the version it
  implements (`roster-snapshot/1`).
- **Writing the index:** put the data files in the folder, then run
  `python3 scripts/station_index_build.py <folder> --provider <key>` (stdlib only). It lists every
  `*.json` whose top-level `schema` is `<kind>-snapshot/<n>`, skips the rest, and writes
  `index.json` atomically – last, so the checksums are the files' final ones. fwo-admin, an HR
  export or a cron job all end with that one step.

#### The other kinds – reserved, not read yet

`vehicles`, `groups` and `keywords` are **reserved kind names**; an index may list them today and
both apps report them as «noch nicht gelesen». They are not ingested yet because each would write
station configuration that is edited by hand today (`fleet.vehicles`, `alarms.groups`,
`alarmKeywords` here; the vehicles table in KP Rück), and doing that from a feed is a change of who
owns the data, not a mapping. The intended shapes follow the roster's envelope (`schema`,
`schema_version`, `generated_at`, `provider`, `complete`, `count`, items with a stable
`external_id` and `identities[]`, no free-form maps):

| kind | contract | items |
|---|---|---|
| `vehicles` | `vehicles-snapshot/1` | `external_id`, `call_sign` (Funkrufname), `type` key, `active`, `identities` (e.g. a `traccar` device id) |
| `groups` | `groups-snapshot/1` | `external_id`, `name`, `members` (roster `external_id`s), `identities` (e.g. a Divera group id) |
| `keywords` | `keywords-snapshot/1` | the existing `alarmKeywords` document (§1a) inside the envelope |

---

## 5. User accounts, roles, and deployment administration

Not part of `deployment_config` – operational users are managed separately from station config.
The product role model is deliberately small:

- **Login:** pick your name from the roster → enter your **PIN** (fast at 3am, per-person
  identity for the audit trail). JWT access (8h) + refresh (90d, `refresh_token_expire_days` – was
  7d until 23.10.2026: an alarm push has to open into a live session, and a volunteer's alarms are
  weeks apart) with rotation + revocation.
- **Roles:** `editor` (FU / Einsatzleitung support; can mutate incident state), `el`
  (Einsatzleiter function, since 2026-09-07: reads everything, edits only Anwesenheit/Zeitplan,
  Material, Checklisten and the Rapport incl. Beilagen – server-enforced) and `viewer`
  (read-only display/follow mode). The stored role value was migrated from the legacy `commander`
  name to `editor` on 2026-06-30.
- **Deployment administration:** does not depend on being an incident editor. The `/admin` UI
  and the admin-write API (config, branding, system, user CRUD, geodata/objects) are gated on the
  **`ADMIN_SECRET`** env var (a deploy-time secret), *separate* from the editor PIN. Unlock once
  with the secret to get a short admin session; the `admin_geodata`/`admin_objects` `push` CLI
  authenticates the same way (`KP_ADMIN_SECRET`). **Fail-closed:** if `ADMIN_SECRET` is unset the
  admin surface is disabled (every admin endpoint returns 403) – it never falls back to the editor
  PIN. Use it for config/user maintenance, not for 3am incident work.
- **Account source of truth:** preferably config/CLI/seed file for deployers, with the admin UI
  for inspection, PIN reset, deactivation, and simple changes. **PIN reset is admin-driven** (no
  email recovery).
- **Changing a PIN is admin-only – there is no self-service PIN change.**
  `POST /api/auth/users/{id}/pin` is the only way a PIN is set after account creation, and it is
  gated on the admin session (`backend/app/auth/router.py`), so a person who wants a new PIN asks
  whoever holds the `ADMIN_SECRET`. The «PIN ändern» action exists only in `/admin` → Personen –
  a logged-in user has no screen to change their own PIN, and there is no recovery flow to go
  looking for.

---

## 6. Environment variables (secrets / infra – operator, not admin)

Set at deploy time, never in the repo. **The 🔐 ones are also settable from the browser** –
see the rule immediately below; everything else in the table really is deploy-time only.

### The integration credentials – env **or** `/admin` → Anbindungen

The station's integration settings – the three Divera keys, the Traccar trio, the VAPID trio, the
four STT settings, the CARTO browser key, `ALARM_WEBHOOK_SECRET`, `PRINT_AGENT_SECRET`,
`HEALTHCHECK_PING_URL`, the
four SharePoint-pull fields (§6c), the three SharePoint-export fields, the four «Mit Microsoft
anmelden» fields, the Objektbesuche organizer key, and the source and token of the station index
(§4d) and of the roster snapshot (§4c) – no longer have to come from `.env`. The authoritative
list is `FIELDS` in `backend/app/credentials.py`. An admin can set and rotate them at `/admin` →
**Anbindungen**, where they are stored **encrypted** in the `integration_credentials` table (AES-256-GCM, key
derived from `SECRET_KEY` via HKDF-SHA256, the credential's own name as AAD) and take effect
**without a restart** – the resolver re-reads the stored half every 30 s and immediately on a
write. They are marked 🔐 in the table below.

Four rules, and none of them is optional reading:

1. **A value in `.env` wins and locks the field.** The browser shows it as server-set, names the
   variable, and offers no input; the API answers **409** to a `PUT` or `DELETE`. **Existing
   deployments therefore change behaviour not at all.** "Supplied" means *different from the
   application's own default* – `docker-compose.yml` materialises the application default for
   `STT_MODEL` and `STT_LANGUAGE`, and a compose passthrough is not a deployer's decision.
   (`VAPID_SUBJECT` is passed through **blank** for exactly this reason: a fallback that
   differed from the declared default would have read as a choice and locked VAPID-Kontakt out
   of the browser on every compose install. Blank means unset, and unset resolves to
   `mailto:kp-front@localhost`.)
2. **Secrets are write-only.** They can be set and rotated over the API, never read back. Every
   field flagged non-secret in `FIELDS` is readable because each earns it individually:
   `TRACCAR_URL` (a hostname the System card already prints), `ROSTER_SNAPSHOT_SOURCE` and
   `STATION_INDEX_SOURCE` (an operator checks it is the right file), `VAPID_PUBLIC_KEY` (already
   handed to every logged-in browser), `VAPID_SUBJECT`, `STT_BASE_URL`, `STT_MODEL`,
   `STT_LANGUAGE`, the tenant and client ids of all three Azure app registrations (compared
   against the Azure portal; useless without the secret), `SHAREPOINT_SECRET_EXPIRES` (a date,
   not a credential), `ENTRA_LOGIN_ACCOUNTS` («who may get in this way» is what an admin has to
   check), and `CARTO_API_KEY`. The CARTO key is the deliberate exception: CARTO requires it in
   every browser tile URL, so domain restrictions in CARTO – not secrecy – prevent use
   elsewhere. **Readable is not public**, though: `/api/config` serves it only to a caller that
   already holds a session (PIN user, admin, or an incident link) and withholds it from
   anonymous ones – see the row in the table below. `TRACCAR_EMAIL` is *not* readable – it is
   half of a credential pair – and neither is `HEALTHCHECK_PING_URL`, whose one misuse is
   pinging it so the monitor believes a dead station is alive.
3. **Rotating `SECRET_KEY` now costs more than the PINs.** It is the key the credentials are
   sealed with, so a rotation makes **every stored credential undecryptable** on top of breaking
   every PIN. They then report as «unlesbar» – never as «nicht konfiguriert» – and that
   integration is off until somebody sets it again. Same never-rotate rule as always, one more
   consequence: [`DEPLOYMENT.md`](DEPLOYMENT.md) §SECRET_KEY.
4. **Who set what is recorded.** `GET /api/integrations/credentials-audit` and the «Letzte
   Änderungen» list on the page carry name, action (`set` / `rotated` / `cleared`), when and by
   whom – **never a value**, not even encrypted. A row with no name means nobody was signed in
   behind the write (the installer, a script).

**What deliberately stays env-only, and why:**

| Stays in `.env` | Because |
|---|---|
| `SECRET_KEY` | it peppers the PINs in the database it would live in, and seals the credential table itself |
| `ADMIN_SECRET` | it gates writing the very document it would live in |
| `KP_TELEMETRY_ENABLED`, `KP_TELEMETRY_DSN` | the deployer's veto **over** the admin UI – an admin-settable veto is not a veto |
| `REQUIRE_PLAN_DIGEST` | it guards the config a stale automated publish would overwrite |
| `DATABASE_URL`, `POSTGRES_*`, `APP_PORT`, `APP_BIND`, `DOMAIN`, `COOKIE_SECURE`, `KP_FRONT_TAG` | host-level: read before a database connection exists, or by `docker-compose.yml` rather than by the app |
| everything else in the table below | not an integration credential – seeding, caps, tuning, provider URLs, the S3 pull keys |

The `PLANS_S3_*` pair is the one genuinely secret-shaped thing that is **not** in the store: the
plan pull is scheduled at boot from the environment (§6a), not per tick.

🔐 = also settable at `/admin` → **Anbindungen** (encrypted in the database; a value here wins
and locks the field – see the rule above).

| Env var | Purpose |
|---------|---------|
| `ENVIRONMENT` (or `APP_ENV`) | **the switch five other things hang off**, and the one a non-compose self-hoster has to set by hand. `production`/`prod`/`staging` → production; `development`/`dev`/`local`/`test` → not. Unset, it is inferred: production **only** on Railway (detected from its injected `RAILWAY_*` variables), otherwise development (`backend/app/config.py` · `is_production`). Production makes `SECRET_KEY` mandatory and `SEED_PIN` mandatory, turns on Secure cookies, hides `/docs`, and hands schema ownership to Alembic instead of create-from-models. `docker-compose.yml` pins it to `production` and Railway is detected, so only a third path – a bare `uv run uvicorn` behind your own proxy – has to set it, and forgetting it there is a deployment that generates a new `SECRET_KEY` on every restart |
| `DATABASE_URL` | Postgres connection (`postgresql://…`; auto-upgraded to asyncpg) |
| `SECRET_KEY` | JWT signing + PIN pepper (≥32 chars; **required in prod**) |
| `ADMIN_SECRET` | unlocks the `/admin` UI + admin-write API/CLI, separate from the editor PIN (≥16 chars; empty = admin disabled, fail-closed) |
| `MIGRATION_BACKUP_DIR` | where `backend/start.sh` writes the **pre-migration dump** before it lets Alembic run (default `<MEDIA_STORAGE_DIR>/backups`, newest 5 kept). Point it at a different volume if you want the safety dumps off the media disk. ⚠️ This directory is not optional: when a migration is pending and the dump cannot be written, the boot is **refused** rather than migrating an un-backed-up database ([`DEPLOYMENT.md` §5](DEPLOYMENT.md#5-updating); `ALLOW_MIGRATION_WITHOUT_BACKUP=1` overrides deliberately) |
| `MEDIA_STORAGE_DIR` | local asset/media dir. The application default is `data/storage`, but **the published image bakes `/mnt/data/storage`** (`Dockerfile`) and `docker-compose.yml` overrides it to `/data/storage` for the named `storage` volume – so on Railway the volume must be mounted at **`/mnt/data`** and on compose you leave this alone ([`DEPLOYMENT.md` §3a](DEPLOYMENT.md#3a-railway-in-order)). **There is no S3 media backend** – the asset store is a directory on a volume, full stop (`app/storage.py`). The only S3 the app speaks is the optional Objektplan-Pull below. |
| `PUBLIC_URL` | this deployment's public origin (e.g. `https://front.example.org`), used to compose absolute links in outbound webhooks (the capture URL on an alarm slip). Empty = those links are omitted |
| `TRUSTED_FORWARDED_HOPS` | how many trusted reverse-proxy hops sit in front of the app (`backend/app/auth/client_ip.py`). `X-Forwarded-For` is plain and forgeable, so it is honoured only to the depth declared here – **safe default `0`**: the header is ignored and the direct peer keys the per-source login/rate throttle. ⚠️ Behind exactly one proxy (Railway, the compose `tls` profile's Caddy) set `1`, or every request keys on the proxy's own address and the throttle collapses into one shared bucket – the backend warns at startup about that shape. Add one per additional trusted proxy |
| `APP_BIND` | *(read by `docker-compose.yml`, not by the app)* which host address the app's port is published on: `0.0.0.0` (default) for a trusted LAN, `127.0.0.1` as soon as anything terminates TLS in front. ⚠️ A published port is open whatever `ufw` says. The four shapes and why: [`DEPLOYMENT.md` §3](DEPLOYMENT.md#app_port-and-app_bind) |
| 🔐 `DIVERA_ACCESS_KEY`, `DIVERA_WEBHOOK_SECRET` | if `diveraEnabled` |
| 🔐 `DIVERA_PERSONNEL_ACCESS_KEY` | optional second Divera key used **only** for the «Personal» pull. It must belong to a user whose read scope includes members' Qualifikationen – the alarm key above usually does not – and it is what makes the roster sync derive a Dienstgrad. Empty = falls back to `DIVERA_ACCESS_KEY` (names only, no rank) |
| 🔐 `ALARM_WEBHOOK_SECRET` | generic alarm intake `POST /api/alarms` for non-Divera alerting systems – auto-opens an incident per alarm, idempotent on `source`+`source_id` (nothing set anywhere = endpoint disabled, fail-closed). Create it during the integration handoff and paste the same value into `/admin` → Anbindungen and the sender; it is write-only and deliberately not pre-generated at install – [`ALARM-INTEGRATIONS.md`](ALARM-INTEGRATIONS.md) §1 |
| 🔐 `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT` | Web Push for killed-app alarms + new-alarm push. Generate the pair once – on a Docker-only host `docker compose exec app uv run python -m app.gen_vapid`, or `cd backend && uv run python -m app.gen_vapid` where the toolchain is installed – then paste both halves into `/admin` → Anbindungen, which takes effect without a restart. `./scripts/setup.sh` does exactly that on a fresh install, into the credential store rather than into `.env`. Nothing set anywhere = push disabled, fail-closed. ⚠️ Generate **once** and keep the pair stable: rotating it invalidates every stored subscription |
| 🔐 `PRINT_AGENT_SECRET` | station print relay: «An Stationsdrucker» queues the Einsatzrapport-PDF for an on-site agent (any always-on box with a CUPS queue). The agent serves KP Front *and* KP Rück from one install – see [`tools/PRINT-AGENT.md`](../tools/PRINT-AGENT.md). Nothing set anywhere = agent endpoints 403 and the button never renders, fail-closed. It is deliberately not minted by the installer: this secret *is* the switch, so setting it renders «An Stationsdrucker» on the Rapport and on the capture poster for a station that owns no printer, and turns the System card's print-relay row from «nicht konfiguriert» into a permanently offline connector. Generate it on the agent's own machine with `openssl rand -hex 32` and paste the same value into `/admin` → Anbindungen |
| 🔐 `HEALTHCHECK_PING_URL` | dead-man's switch: **the job GETs this URL every 60 s** (healthchecks.io or any cron monitor), so the monitor alerts when the pings *stop*. Catches the class an HTTP probe of `/ready` cannot: a container stopped with nothing replacing it, or a wedged event loop. Point it at a check with a **1 min period and ~3 min grace** – matching the 60 s cadence, so two missed pings raise it. Nothing set anywhere = the heartbeat job still runs but returns on its first line, so nothing is pinged; a failed ping is logged and swallowed, so a monitoring outage never disturbs the deployment. The «Einrichtung» card on the admin landing page links straight to this field |
| 🔐 `SHAREPOINT_TENANT_ID`, `SHAREPOINT_CLIENT_ID`, `SHAREPOINT_CLIENT_SECRET`, `SHAREPOINT_SECRET_EXPIRES` | the Azure app registration behind the SharePoint pull ([§6c](#6c-sharepoint-pull-the-stations-own-folders-imported-on-a-schedule)), read-only, client-credentials flow. ⚠️ These four – like every 🔐 credential from here down to `ENTRA_LOGIN_*`, sixteen in all – have **no `Settings` field**: they were introduced after the credential table existed, so the environment half is read straight off the process environment and the normal path is the browser. The two ids are readable (an operator compares them against the Azure portal); the secret is write-only. `SHAREPOINT_SECRET_EXPIRES` is not a credential but the ISO date (`JJJJ-MM-TT`) the secret lapses on – Azure caps it at 24 months and says nothing when it does, so this is what the System card counts down. Nothing set = no pull, fail-closed |
| 🔐 `OBJECT_VISITS_INTEGRATION_KEY` | the Objektbesuche organizer's bearer key for `/api/integrations` ([`object-visits.md`](object-visits.md)); ≥ 24 characters, write-only, no `Settings` field (read off the environment, normally set in the browser). Unset = the organizer API answers 403 |
| 🔐 `SHAREPOINT_EXPORT_TENANT_ID`, `SHAREPOINT_EXPORT_CLIENT_ID`, `SHAREPOINT_EXPORT_CLIENT_SECRET` | a SECOND Azure app registration, the only one KP Front writes with: the Objektbesuche delivery files visit reports into a destination folder ([`object-visits-sharepoint.md`](object-visits-sharepoint.md)), `Sites.Selected` **write** on one site. Separate from the pull's read-only registration on purpose. No `Settings` fields; ids readable, secret write-only. Incomplete = no delivery, fail-closed |
| 🔐 `STATION_INDEX_SOURCE`, `STATION_INDEX_TOKEN` | the station index ([§4d](#4d-the-station-index--one-address-for-all-station-data)): the address or absolute path of the station's `index.json`, plus an optional bearer token sent only over https (to the index and its same-host siblings). When the index lists a roster it replaces the direct roster source below. No `Settings` fields; the source is readable, the token write-only. Unset = nothing fetched |
| 🔐 `ROSTER_SNAPSHOT_SOURCE`, `ROSTER_SNAPSHOT_TOKEN` | the station's published roster file ([§4c](#4c-snapshot--a-roster-file-somebody-else-publishes)): an `https://` address (plain `http://` only on the station's own network) or an absolute path on the server, plus an optional bearer token sent only over https. No `Settings` fields (read off the environment, normally set in the browser); the source is readable, the token write-only. Unset = nothing fetched |
| 🔐 `ENTRA_LOGIN_TENANT_ID`, `ENTRA_LOGIN_CLIENT_ID`, `ENTRA_LOGIN_CLIENT_SECRET`, `ENTRA_LOGIN_ACCOUNTS` | optional «Mit Microsoft anmelden» ([`microsoft-login.md`](microsoft-login.md)): a THIRD Azure app registration, sign-in only (delegated `openid profile`), redirect URI `<PUBLIC_URL>/api/auth/microsoft/callback`. `ENTRA_LOGIN_ACCOUNTS` is the allow-list, `objectid=username, …` (Entra object id → existing KP Front username; a sign-in name is refused since 22.10.2026). No `Settings` field, settable from `/admin › Anbindungen`; the secret is write-only, the rest readable. Any one unset = no button, routes 404 |
| 🔐 `TRACCAR_URL`, `TRACCAR_EMAIL`, `TRACCAR_PASSWORD` | if `traccarEnabled` |
| 🔐 `STT_BASE_URL`, `STT_API_KEY`, `STT_MODEL`, `STT_LANGUAGE` | speech-to-text for the audio player's Transkribieren (OpenAI-compatible `/v1/audio/transcriptions`; base URL without `/v1` – Groq: `https://api.groq.com/openai`, OpenAI: `https://api.openai.com`, or a self-hosted faster-whisper server). Empty base URL = off, fail-closed. **Audio is sent to that server** – prefer self-hosted for sensitive deployments |
| 🔐 `CARTO_API_KEY` | browser key for the built-in CARTO Voyager and Dark Matter raster basemaps. Request it for the deployment domains at [CARTO Basemaps](https://carto.com/basemaps/apikey/). The runtime config appends it as `?key=` to every CARTO tile template the BROWSER fetches – map pickers, the admin object map, offline downloads. **⚠️ Restrict it to the deployment domains in CARTO**: it is necessarily visible in browser requests, and that restriction rather than secrecy is what stops it being spent elsewhere. Never commit a real value. Two things narrow it further: `/api/config` hands it only to callers that already hold a session (PIN user, admin, or an incident link – the login screen draws no map and does not get it), and **Rapport/Kroki tiles are fetched server-side with this same credential**, so the browser's copy never travels in a request body, a log line or a tile-cache filename. Empty = the provider's unkeyed/watermarked response is shown. |
| `PLANS_S3_ENDPOINT`, `PLANS_S3_BUCKET`, `PLANS_S3_PREFIX`, `PLANS_S3_REGION`, `PLANS_S3_ACCESS_KEY_ID`, `PLANS_S3_SECRET_ACCESS_KEY`, `PLANS_PULL_INTERVAL_MINUTES` | Objektplan-Pull – see [§6a](#6a-objektplan-pull-fetch-modul-pdfs-instead-of-having-them-pushed-in) (empty endpoint/bucket/key/secret = no pull, fail-closed). **These are the only `S3_`-shaped variables the app reads**, and they are prefixed `PLANS_S3_` – there is no bare `S3_ACCESS_KEY_ID` |
| `MAX_UPLOAD_MB` | request-body cap for multipart uploads (default 110 – must stay above the media endpoint's 100 MB per-file cap) |
| `REQUIRE_PLAN_DIGEST` | make `PUT /api/objects/{id}/plans/{module}` **refuse an automated publish** (admin secret, no logged-in user – i.e. `admin_objects push`) that does not declare the SHA-256 of the bytes it carries. A declared digest is verified everywhere, always; this only decides whether one is *mandatory*, and only for machines – a person uploading a PDF in the admin UI is never affected. Unset = auto: on for the public demo (`DEMO_RESET_CRON`/`DEMO_RESET_SECONDS`), off for a station, so an older `admin_objects` keeps working. ⚠️ It is a **wrong-tree** guard, and deliberately server-side: the `sha256` pin in `objects.manifest.json` cannot catch a stale checkout, because such a checkout brings a stale manifest *and* a stale CLI. Turning it on means a publisher too old to name its own bytes is refused – which is precisely the publisher you do not want |
| `GEOCODER_URL` | address-autocomplete endpoint (default the swisstopo SearchServer – see the caveat below) |
| `GEOCODER_DEFAULT_LOCALITY` | locality appended to a bare street address typed without a postal code, so «Hauptstrasse 12» resolves in this brigade's own village rather than the first Hauptstrasse in the country. **The fallback only**: a station normally sets `map.geocoder.defaultLocality` in the config document ([§1](#1-deployment-config-the-json-the-deployment-owner-edits)) and that wins – this matters on a deployment with no config document yet (`app/geocode.py` · `_resolve_bias`). Empty = unbiased national search |
| `REPORT_TILE_HOSTS` | extra tile hosts the **server** may fetch a basemap from while it renders the Kroki into the Einsatzrapport, comma-separated. The three providers the app itself offers are built in (`app/kroki.py` · `_TILE_PROVIDER_HOSTS`); this is the escape hatch for a station running its own tile server, and a Kroki naming any other host renders without a basemap instead. ⚠️ Env only on purpose: the tile template arrives in a caller's request body, so who may add a destination has to be whoever runs the deployment, not whoever is logged in |
| `PUSH_EXTRA_HOSTS` | extra Web-Push service hosts the alarm sender may deliver to, comma-separated, matched as host suffixes. The four major browser push services are built in (`app/push.py` · `_PUSH_SERVICE_HOSTS`); a subscription naming anything else is refused. ⚠️ Env only for the same reason as `REPORT_TILE_HOSTS` – the endpoint arrives in a caller's request body (security audit SEC-09) |
| `OVERPASS_MIRRORS` | comma-separated https Overpass endpoints behind the «Umrisse» building-outline surface, raced fastest-first. **Privacy-relevant:** the query is a bounding box around the incident, so it leaves the station – and the shipped third mirror is hosted in Russia. Called by the backend, never the browser (`app/overpass.py`), so this one variable is the whole control. Override with your own Overpass to keep it in-house, or set it **empty to switch the surface off**. ⚠️ Empty means off, not "use the default" – so `.env.example` ships the line commented out rather than blank ([`PRIVACY.md`](../PRIVACY.md)) |
| `FOOTPRINT_AREA_TILES`, `FOOTPRINT_BUILDINGS_WFS` | where «Karte & Objekte» learns every building a station object stands for (`app/object_footprints`, [`karte-objekte.md`](karte-objekte.md)): swisstopo's base vector tiles for the use area (default `https://vectortiles.geo.admin.ch/tiles/ch.swisstopo.base.vt/v1.0.0`, the tileset root: `/{z}/{x}/{y}.pbf` is appended) and the open cadastral survey's WFS for the building footprints (default `https://geodienste.ch/db/av_0/deu`); the parcel comes from the `GEOCODER_URL` host. Asked by the scheduler once per object coordinate, never by the browser — what leaves the station is a station object's coordinate. **Either one empty = off**: the map then outlines the OSM building an object's point lies in |
| `UNDERGROUND_WFS` | «Unterirdische Bauten» in the Karte's Ebenen (`app/underground`, [`karte-objekte.md`](karte-objekte.md)): the open cadastral survey's WFS (default `https://geodienste.ch/db/av_0/deu`) asked by the scheduler for every underground building and tunnel (`ms:SOSF`, `Art = unterirdisches_Gebaeude` / `Tunnel_Unterfuehrung_Galerie`) in the Einsatzgebiet — `map.serviceArea.municipalities`, else the municipality at `map.defaultView` (boundaries from the `GEOCODER_URL` host), plus 500 m around every station object. Once, then weekly. **Empty = off**: the row then says «nicht verfügbar» |
| `HOUSES_WFS` | the houses a building tap in «Karte & Objekte» selects (`app/houses`, [`karte-objekte.md`](karte-objekte.md)): the same WFS (default `https://geodienste.ch/db/av_0/deu`) asked by the scheduler for every house footprint (`ms:LCSF`, `Art = Gebaeude`) in the same area as `UNDERGROUND_WFS`, one request at a time in 1 km cells. Once, then weekly. **Empty = off**: a tap then opens the OSM outline (a terraced row as one block) |
| `EXPOSE_API_DOCS` | serve `/docs`, `/redoc` and `/openapi.json` on a **production** deployment (always on in dev). Default off |
| `SEED_DATABASE`, `DEV_CREATE_ALL` | dev seeding / auto-create tables. `DEV_CREATE_ALL` does nothing in production – it is gated by `not is_production()`, so on compose (which pins `ENVIRONMENT=production`) Alembic owns the schema whatever it says |
| `SEED_PIN` | **Required in production** when `SEED_DATABASE` is on: the 6–12-digit PIN the seeded account gets. The seed file's own PIN is public, so the backend refuses to boot without this rather than create a login anyone knows |

> ⚠️ **On compose, a variable only exists if `docker-compose.yml` names it.** Compose's `.env` is
> read for *interpolation*, not handed to the container – so a line in `.env` that the
> `environment:` block does not reference reaches nothing, silently. `REQUIRE_PLAN_DIGEST` and
> `DEV_CREATE_ALL` were documented here and missing there until 2026-08-30, and
> `TRUSTED_FORWARDED_HOPS`, `REPORT_TILE_HOSTS`, `PUSH_EXTRA_HOSTS` and
> `GEOCODER_DEFAULT_LOCALITY` until 2026-09-11 – the first of those being the one where the
> silence cost something, since a `1` in `.env` that never arrives leaves the per-source throttle
> collapsed with nothing to see. The sixteen credentials without a `Settings` field
> (`SHAREPOINT_*`, `SHAREPOINT_EXPORT_*`, `OBJECT_VISITS_INTEGRATION_KEY`, `STATION_INDEX_*`,
> `ROSTER_SNAPSHOT_*`, `ENTRA_LOGIN_*`) followed until 2026-10-13; a backend test now fails when a
> credential is missing from `docker-compose.yml` or `.env.example`. Two are still deliberately
> absent: `MIGRATION_BACKUP_DIR` (a second volume is a compose-file edit anyway) and
> `ALLOW_MIGRATION_WITHOUT_BACKUP`, which is a one-off override you pass on the command line
> (`docker compose run -e ALLOW_MIGRATION_WITHOUT_BACKUP=1 …`) rather than a setting a station
> leaves lying in `.env`.
>
> If you add one yourself, note the second half of the trap: compose materialises a named
> variable as an **empty string** when `.env` does not set it, and only some of these fields
> tolerate that. `EXPOSE_API_DOCS`, `VISIT_STATS`, `TRACCAR_FAKE` and `KP_TELEMETRY_ENABLED` have
> an explicit blank-is-false coercion in `app/config.py`; `REQUIRE_PLAN_DIGEST`, `DEV_CREATE_ALL`
> and every numeric setting do **not**, so a blank fallback for those crashes the boot with a
> pydantic validation error. Give them a fallback that parses – which is what the file does.

Weather (MeteoSwiss/Open-Meteo) and the swisstopo geocoder need **no** credentials – public
endpoints, national, work everywhere *in Switzerland*. The same holds for the Karte's weather
layer (MeteoSwiss radar); a station outside Switzerland sets `WEATHER_LAYER_ENABLED=false`, and
the Ebenen offer no «Niederschlag». One honest limitation: the geocoder client speaks the swisstopo SearchServer API shape only, so outside Switzerland address
autocomplete simply returns nothing (map-pick still works). `GEOCODER_URL` exists to point at
a *compatible* endpoint (e.g. a proxy) – it is **not** a generic-geocoder swap point for
Nominatim/Google/etc.

With a `map.geocoder.bboxLv95` set, the autocomplete also tolerates a typo in the street name:
the backend keeps the region's official street names (swisstopo Strassenverzeichnis, fetched
in the background on first use and refreshed weekly) and retries an empty search once with the
one street that is a single letter away – «haupstrasse 12» finds Hauptstrasse 12. Without a
bbox there is no dictionary and nothing changes (`app/street_dictionary.py`).

### 6a. Objektplan-Pull (fetch Modul-PDFs instead of having them pushed in)

A station whose plan library is maintained elsewhere can publish it to an **S3-compatible
bucket** and let the deployment fetch from there on a schedule, instead of giving that system an
`ADMIN_SECRET` – a credential for the entire admin API – so it can push. The bucket holds
`plans/index.json` (object id, module, filename, size, **sha256**, address – metadata, never
bytes) and `plans/<object-id>/<module>.pdf`; only a checksum that actually changed is
downloaded, and it lands as the same `plan:<obj>:<module>` dataset a manual upload writes.

Any S3-compatible store works – MinIO, Backblaze B2, a hosted bucket, AWS – and a **read-only**
key is enough; nothing about a provider is built into the app. `PLANS_S3_PREFIX` is optional,
`PLANS_S3_REGION` is whatever your provider's docs say verbatim. Existing plans are **never
deleted** by a pull, and a malformed or incomplete index refuses the whole run rather than
ingesting half of it. Fail-closed: no endpoint/bucket/key/secret → no job is scheduled, nothing
is fetched, and plans stay exactly as they were loaded. Index format and the reasoning:
[`objektplaene-architecture.md`](objektplaene-architecture.md).

### 6b. Three things that look like env vars and are not

Each of these is a **token or key stored in the database** and managed in the admin UI, not set
at deploy time. They are listed here because that is where people go looking for them. (Unlike
the 🔐 credentials above, these three have **no** environment variable at all – there is
nothing to put in `.env` and nothing that could outrank the stored value.)

| Feature | Where it is managed | What it does |
|---------|---------------------|--------------|
| **Erfassungs-Poster** (station capture) | `/admin` → System › Links & Zugänge: activate / rotate / disable, print the A4 poster | Scanning it opens `/e/<token>`, where attendance, Material and notes for incidents of the last `alarms.captureWindowHours` are recorded **without a login**. Fail-closed: no token → the whole `/api/capture/*` surface answers 403. Rotation invalidates every printed poster at once. |
| **Statistik-Export** | `/admin` → System › Links & Zugänge | `GET /api/stats/incidents?year=` returns one flat read-only JSON record per incident (metadata, Zeiten, Anwesenheit von–bis, Mittel totals, Rapport status) for external analytics – auth via the `X-Stats-Token` header or `?t=`. Fail-closed: no token → 403. Full field reference: [`STATS-EXPORT.md`](STATS-EXPORT.md). |
| **Einsatz-Link** (read-only link into one incident) | `/admin` → System › Anbindungen: show, rotate or delete the station's `incident_link_key` | Copy the key into the alerting system, which signs a token with it and puts `/l/<token>` into the alert it sends out. A responder taps that on a personal phone and sees **one** incident the way a `viewer` does – no login, nothing that writes, prints or costs money – for as long as the Einsatz runs: closing or archiving it revokes every open link at once (12 h is the backstop for the one nobody closes). Fail-closed: no key → the link surface answers 403 and nothing exists, which is also what an existing deployment gets from the migration. Rotation or deletion invalidates every link already sent out and requires reconfiguring the alerting system. Trust model and reachable surface: [`ALARM-INTEGRATIONS.md`](ALARM-INTEGRATIONS.md) §4. |

### 6c. SharePoint-Pull (the station's own folders, imported on a schedule)

The second pull, and the one a station without a publishing pipeline can actually use: point the
deployment at the SharePoint/OneDrive folders it already keeps its documents in, and Objektpläne,
Geodaten, Checklisten and the Arbeitsmappe are imported on a schedule. **Read-only and
pull-only** – nothing is ever written back to SharePoint.

It is split the way everything else in this doc is. The **credentials** (Azure tenant id, client
id, client secret, plus the date the secret expires) are four of the 🔐 integration credentials
above, set at `/admin` → Anbindungen › SharePoint. The **folders** are config-as-code, in the
document's `sharepoint` section:

```jsonc
"sharepoint": {
  "intervalMinutes": 60,          // poll cadence, 1…10080; default 60
  "sources": [
    // One entry per area, and every one of them optional and independent. Different sites,
    // different libraries, different folders per area — configure only what you have.
    { "area": "plans",      "siteUrl": "https://contoso.sharepoint.com/sites/kommando",
      "path": "Einsatzpläne", "ignore": ["Grosspläne", "Archiv"] },
    { "area": "geodata",    "siteUrl": "https://contoso.sharepoint.com/sites/gis",
      "library": "Geodaten", "path": "export/wgs84" },
    { "area": "checklists", "siteUrl": "https://contoso.sharepoint.com/sites/kommando",
      "path": "Checklisten" },
    { "area": "workbook",   "driveId": "b!Xy…", "path": "" }
  ]
}
```

| Field | Meaning |
|-------|---------|
| `area` | `plans` · `geodata` · `checklists` · `workbook`. **At most one entry per area** – a listing is read as the complete statement of what that area holds, and two half-statements cannot be told from one broken one. |
| `siteUrl` | The site's address as it appears in a browser's URL bar. Resolved to its document library by the server. |
| `driveId` | The library id, when a tenant admin hands it over directly. Give **exactly one** of `siteUrl` / `driveId`. |
| `library` | Display name of the document library, when it is not the site's default one. Optional. |
| `path` | The folder inside that library; empty = its root. The per-area naming convention applies **below** this folder, never above it. |
| `ignore` | Folder **names** directly under `path` that the pull walks past – the category folders that live among the station data («Grosspläne», «Archiv»). Names, not paths and not globs: an operator copies what SharePoint shows them, and a pattern that quietly matches one folder more than it was meant to is the accident this list exists to prevent. Compared without regard to case or Unicode spelling. |

**Naming inside a source folder** – the full walkthrough, including the Azure app registration,
is [`sharepoint-connector.md`](sharepoint-connector.md):

```
plans/       <Objektordner>/<Modul>.pdf    e.g. «Hauptstrasse 24 - Gemeindeverwaltung/Modul 2-3.pdf»
geodata/     <layer-id>.geojson            + optional <layer-id>.json sidecar (label, colours, symbol)
checklists/  <template>.json               + diagrams as <template>-p<page>.jpg|png|webp|svg
workbook/    <anything>.xlsx               exactly one .xlsx in the folder
```

**Which Modul-Slot a PDF belongs to is decided by `modules[].match`** – the station's own
filename regex, tested case-insensitively against the file name, first hit in config order
claims the file. That contract is the `modules` catalogue's own (§1, file-only) and predates the
pull; the connector is a reader of it, not a second parser beside it. So `Modul 1.pdf`,
`modul1.pdf` and `Modul 2-3.pdf` all land where the station already expects, and nothing is
renamed. A `family` module's capture group becomes a sub-slot – `Modul 5 - Wasser 1.pdf` →
`modul5-wasser-1` – and a sub-slot needs **no catalogue entry of its own**, because the admin
sheet derives a family's slots from the stored plans for the same reason
(`src/admin/ObjectSheet` · `planSlots`). `combinedWith` is a **display** rule and is deliberately
not expanded here: one sheet is stored once. A file no rule claims is skipped and logged; a
deployment whose catalogue carries no `match` at all imports nothing and reports `needs_review`.

⚠️ **Two files claiming one slot is refused, loudly.** If two PDFs in a folder resolve to the
same module id, **neither** is imported and the area reports `needs_review` naming both – one
would otherwise overwrite the other with nothing said anywhere. The realistic cause is a family
`match` whose capture stops too early: Feuerwehr Oberwil's stored `modul5` rule captures
`([0-9A-Za-zÄÖÜäöü]+)`, so `Modul 5 - Wasser 1.pdf` and `Modul 5 - Wasser 2.pdf` both read as
`modul5-wasser`. The shipped default takes a trailing number – `([0-9A-Za-zÄÖÜäöü]+(?:\s+\d+)?)`
– and is the fix. A generated id that would not fit `ReferenceDataset.module` (`String(16)`) is
skipped with the id named, rather than carried into a write that 500s on Postgres.

**A folder that yields no Modul slot yields no Einsatzobjekt.** `ignore` states that intent for
the folders a station knows about; this is the net under the one nobody listed. A production
deployment carries an object named «Grosspläne», addressed «Grosspläne», with zero plans,
because an earlier importer created the object first and matched file names afterwards.

**The object key is the folder name**, NFC-composed and hashed to the same `uuid5` the
`admin_objects` CLI and the admin UI mint (§9e). A station that has been loading plans by hand
and then points at SharePoint therefore **updates** its Einsatzobjekte instead of growing a
second copy of every one of them. An object the connector has never seen is created with the
folder name for a name; a name or address somebody has since typed is never overwritten.

> ⚠️ **Composition matters and only the connector composes today.** macOS hands out file names
> decomposed (`u`+U+0308) where Graph and a keyboard hand out the composed `ü`; the two look
> identical everywhere and hash to two different uuid5. `object_id_for_key` itself is left
> alone on purpose – composing inside it would re-key every object whose stored id came from a
> decomposed name, which is the fix and the damage in one commit. Existing duplicates are a
> merge somebody chooses to run, not a side effect of a deploy.

**What it refuses to do.** A listing that carries nothing for an area that previously had
something **aborts the run and changes nothing** – the same guard `admin_config load` applies to a
config file that would empty a section, and for the same reason: an empty folder is far more often
a broken sync than a decision. A file that disappears is recorded as *missing from source* and its
record is **left in place**; nothing is ever hard-deleted by a poll. The Arbeitsmappe keeps its
confirmation: the connector runs the same planner the admin preview runs and applies it only when
nothing is refused, nothing is emptied and nobody would be deactivated – otherwise the area
reports `needs_review` and waits for a person.

**Health.** `/admin` → System › SharePoint-Anbindung shows, per area, the last **successful**
sync (deliberately not the last attempt), imported/skipped/missing counts, and a red state for an
authentication failure. It also counts down the client secret's expiry, which is the guaranteed
failure two years in: Azure caps a secret at 24 months and says nothing when it lapses. «Jetzt
abgleichen» runs the same mechanism the scheduler runs.

Fail-closed: no credentials, or no `sources` → nothing is fetched and nothing changes.

### 6d. Connector health (what `GET /api/system` reports)

Since 2026-09-11 the three polling connectors keep the same kind of record SharePoint has kept
since it shipped, and `GET /api/system` (admin) serves it in the `connectors` list:

| id | written by |
|----|-----------|
| `divera_alarms` | the 120 s alarm poll **and** every authenticated webhook delivery – the webhook is the primary intake, so a station running on it alone is not stale |
| `traccar` | the 30 s vehicle-sample sweep. Its writes are throttled to roughly five minutes, because «still working» does not change twice a minute; a transition – the first failure after successes – is never throttled |
| `divera_personnel` | the nightly Mannschaft sync **and** a hand-triggered `POST /api/personnel/sync/execute`, so «zuletzt synchronisiert» is true whoever pressed it |

Each row carries `lastAttempt`, `lastSuccess`, `lastError` (ISO-8601 / null) and a small `counts`
object beside the existing `configured` boolean; the rows that record nothing carry the same keys
as `null`. **The two timestamps are separate on purpose** – a failed run never moves
`lastSuccess`, so a green tick left standing through a fortnight of refused keys cannot happen.
`state` is derived from the last outcome only (`offline` after a failure, `online` after a
success, `null` before the first run): what counts as *stale* depends on how often a station
expects the connector to fire, so that judgement stays with the surface rather than being
guessed here. `lastError` never carries a credential.

The same response carries a `setup` block – the nine «Einrichtung» predicates (`rows[].id` /
`.done`), the rows hand-ticked in `setup.acknowledged`, and `complete` folding the two – derived
server-side so anything that is not the admin card can ask whether a station is set up.

---

## 7. What ships with the app (no config needed)

- **Base maps:** swisstopo (farbig/grau/SWISSIMAGE via WMTS), OpenStreetMap, Carto (incl. the
  night theme), Esri/OpenTopo. National coverage, day one.
- **FKS symbol set:** the KP-Front-authored library (`public/tactical-symbols.json`, generated
  by `tools/gen_symbols.py`) + presets + display names. **Not station-editable** – keeps
  stations interoperable.
- **Weather/wind, geocoder:** national public services.
- **Alarm keyword vocabulary:** the German fire-service words that turn an alarm title into a
  category and a priority (`backend/app/data/alarm_keywords.json`). Station-overridable, but
  only if your dispatch text is genuinely different – see §1a.

---

## 8. Empty state (a brand-new deployment)

A deployment with an empty config must be fully operable:
- swisstopo base map, centered on a neutral default until `map.defaultView` is set;
- no reference layers, no hydrants, no plans, no roster – and **nothing errors**;
- every person/unit picker offers **free-type entry** (no "select from empty list" dead-ends);
- optional layers/integrations that aren't configured are shown as "nicht konfiguriert", never
  as empty-but-implied-complete.

---

## 9. Loading station data with the admin CLIs

Everything a station provides – the config document, its brandmark, reference layers, object
plans, checklists, the Tafel's board templates – is loaded by one of six sibling CLIs in
`backend/app/`. The sixth, `admin_board_templates` (`just board-templates-load` /
`board-templates-push`), has no section of its own here: it travels exactly like
`admin_checklists` (§9f) and is documented in [`board-templates.md`](board-templates.md).

**None of them is the only door any more.** Every one of those six now has a browser
equivalent for working on **one thing at a time**: the config on the Station pages, the
brandmark on Station & Karte, a map layer on **Kartenebenen**, an Einsatzobjekt and its
Modul-PDFs on **Objektpläne**, a checklist template and its diagram pages on **Checklisten**, a
board template on **Tafel-Vorlagen** – plus the Arbeitsmappe (§9h) for the list-shaped data. That
is where a station normally administers itself, and none of it needs a terminal.

**What the CLIs are still for** is the other half of the job: a whole library in one run, a
manifest that is reviewed and versioned in a private data repo, a station reproduced on a second
deployment, and the handful of fields no form exposes. Station files are private and **never
committed** (`backend/private/` is gitignored).

> **On a host that has nothing but Docker** – which is the whole list [`SETUP.md`](SETUP.md) asks
> for – prefix any of these with `docker compose exec app`, run from the installation directory:
>
> ```bash
> docker compose exec app uv run python -m app.admin_config show
> docker compose exec app uv run python -m app.admin_objects schema
> docker compose exec app uv run python -m app.gen_vapid
> ```
>
> The image carries `uv` and the application, and the working directory inside it is already
> `backend/`, so nothing has to be installed. **The honest limit: reading and generating work in
> the container; `load` and `push` of a file *you* wrote do not.** The container holds the
> repository's `*.example.json` templates and nothing else – your manifest, your GeoJSON and your
> Modul-PDFs are on your workstation, and a `load` cannot open a file it cannot see. For those,
> `uv` on a machine that has the files is still the answer.

### 9a. What all of them share

**The loop is the same:** `schema` → author the file → `validate` → (`diff`, config only) →
`load` **or** `push`. Invalid input prints precise `field.path: message` lines and exits
non-zero, having written nothing. The one exception is `admin_branding`, whose input is an image
rather than a document: it has only `load`, `push` and `show`. Verb matrix:
[`API.md`](API.md#configuration--data-cli).

**`load` vs `push` – pick by where you are standing:**

| | `load` | `push` |
|---|---|---|
| talks to | the database in `DATABASE_URL`, and the **local** `MEDIA_STORAGE_DIR` | a **running** deployment's HTTP API |
| authenticates with | nothing (it is the database) | `KP_BASE_URL` + `KP_ADMIN_SECRET` (the deployment's `ADMIN_SECRET`) |
| run it | server-side, or against a local dev DB | from a workstation, against a remote deployment |
| files land | wherever the CLI is running | on the **server's own volume** – which is the point |

A `load` run from a workstation against a remote database writes the blobs to your laptop and
the rows to the server, leaving rows pointing at files nobody can serve. That is what `push`
exists to prevent. `admin_config` is the exception with no files of its own, so it can also be
loaded remotely by injecting the database URL (§9b).

**The order matters, in one place:** branding is loaded **after** the config, never before –
`admin_config load` replaces the whole document and `identity.assets` is part of it, so a
brandmark uploaded first is wiped by the config that follows (§1). Everything else is
independent.

**A worked example that gets all of this right** is
[`examples/demo-data/load.sh`](../examples/demo-data/load.sh) – the six steps that turn an empty
instance into the synthetic Musterdorf station, in the order that works, with the branding trap
commented in place. It is the file to copy when writing a station's own `load.sh`:

```text
1  admin_config      load  config.json
2  admin_branding    load  logo / reportLogo        ← after the config, never before
3  admin_geodata     load  geodata.manifest.json
4  admin_objects     load  objects.manifest.json
5  admin_checklists  load  checklists.manifest.json
6  seed_personnel                                    (additive; the crew, so Anwesenheit has people)
```

### 9b. `admin_config` – the deployment config

A station's config is a JSON file (matching §1) loaded with `backend/app/admin_config.py`. This
is the preferred path for technical deployment owners and LLM-assisted edits: reviewable config
file, schema validation, diff, then load.

`schema`/`example`/`validate` need no DB. `diff`/`show`/`load`/`history`/`restore` hit the
configured `DATABASE_URL` – `diff` included, because the thing it compares your file against is
the *stored* document, so it opens a session like `show` does. `push` needs neither, only a
reachable deployment.

```bash
# from backend/ – or prefix with `docker compose exec app` on a Docker-only host (§9)
uv run python -m app.admin_config schema            # the config JSON Schema (the contract)
uv run python -m app.admin_config example           # a populated sample to edit
uv run python -m app.admin_config validate private/<station>.config.json   # parse+validate, no write
uv run python -m app.admin_config diff private/<station>.config.json       # what would change vs stored
uv run python -m app.admin_config load private/<station>.config.json       # validate + upsert (DB-direct)
uv run python -m app.admin_config push private/<station>.config.json       # → running deployment (KP_BASE_URL / KP_ADMIN_SECRET)
uv run python -m app.admin_config show              # print the stored config
uv run python -m app.admin_config history           # the configs this one replaced, newest first
uv run python -m app.admin_config restore <id>      # put one of them back
```

`push --dry-run` authenticates and reports without writing. Both `load` and `push` take
`--force` (see the refusal below). Without a Python toolchain the same loop is three HTTP calls:
`GET /api/config` → `POST /api/config/validate` → `PUT /api/config` with `If-Match` (§1).

> ⚠️ **`load`/`push` refuse to empty a section that currently has content** (exit 2), listing
> exactly what would go – `roster.ranks`, `doctrine.alarmBar`, `report.partnerOrgs`. That is what
> publishing an OLD config file looks like, and it is how the public demo lost its Dienstgrade,
> its Atemschutz-Doktrin and its Partnerorganisationen while every step reported success. Check
> the file is the one you meant (`admin_config diff`), and pass `--force` if the emptying is
> genuinely intended – a station dropping its Partnerliste is a real edit. `push --force` sends
> `?force=true` with it, because **the server refuses the same write** (§1, point 3): the guard is
> no longer a courtesy of the command you happened to use.
>
> **Every write keeps the document it replaced** (`deployment_config_history`), whichever path
> made it – the Verwaltung, a CLI push, a branding upload. `history` lists them with when and by
> what, `restore <id>` puts one back, and the restore is itself kept, so stepping back is
> reversible too. This is the safety net that does not depend on having anticipated the write
> path: **a station has no seed file to rebuild from**, so without it a bad `load` is permanent.

Because the config document carries no files, it is the one CLI that can also be loaded
DB-direct against a remote deployment. Against the Railway production DB from a workstation,
inject the public proxy URL (no secrets printed):

```bash
railway run -s Postgres -- bash -lc \
  'cd backend && DATABASE_URL="$DATABASE_PUBLIC_URL" uv run python -m app.admin_config load private/<station>.config.json'
```

`push` is the simpler answer whenever the deployment is reachable over HTTP.

The empty/neutral default row is seeded on first boot (`seed_config.py`); this CLI overwrites
it with the station's values. An empty config is always valid (§8).

### 9c. `admin_branding` – the five branding slots

The brandmark is not part of the config document (§1): the URLs behind `identity.assets` only
exist once a blob has been stored, so the slots are written by the upload path, not by a `PUT`.
`backend/app/admin_branding.py` is that path for a terminal – the admin UI does the same thing
through a browser.

```bash
# from backend/ – or prefix with `docker compose exec app` on a Docker-only host (§9)
uv run python -m app.admin_branding load  reportLogo <station>/report-logo.png   # DB-direct + local blob store
uv run python -m app.admin_branding push  reportLogo <station>/report-logo.svg   # → running deployment
uv run python -m app.admin_branding show                                          # the URLs a deployment serves
```

**Five slots, and only five:** `logo`, `reportLogo`, `favicon`, `iconPng192` and `iconPng512` –
the same allowlist the upload endpoints enforce (`app/api/branding.py`). What each one is for,
and the format and size rules the two icon slots are validated against: §3a.

`load` writes the blob under a key derived from the **slot**, so re-running it overwrites in
place instead of leaving a new orphan behind every time – which is what makes it safe in a
nightly demo reset. Removing a brandmark is `DELETE /api/branding/{slot}` (or the admin UI), not
an empty config field.

⚠️ **Load it after the config, never before** – the ordering trap in §9a.

### 9d. `admin_geodata` – reference layers

Reference layers (§2) are loaded separately from the rest of the config, because they pair
render config with GeoJSON **files**. A station keeps those files + a **manifest** in a private
data repo and loads them with `backend/app/admin_geodata.py` – the GeoJSON goes into the
reference store (served at `/api/reference/geo:<slug>`) and the render config is written into
`deployment_config.referenceLayers`.

```bash
# from backend/ – or prefix with `docker compose exec app` on a Docker-only host (§9)
uv run python -m app.admin_geodata schema             # the manifest-entry JSON Schema
uv run python -m app.admin_geodata example            # a sample manifest to edit
uv run python -m app.admin_geodata validate <dir>/geodata.manifest.json   # + validates every GeoJSON (no DB)
uv run python -m app.admin_geodata load <dir>/geodata.manifest.json       # upload files + write referenceLayers
uv run python -m app.admin_geodata push <dir>/geodata.manifest.json       # → running deployment (KP_BASE_URL / KP_ADMIN_SECRET)
uv run python -m app.admin_geodata show               # print the stored referenceLayers
```

A manifest entry is a `referenceLayers` entry (§2) plus, for a `geojson` layer, a `file:`
(local GeoJSON, relative to the manifest) instead of a pre-resolved URL. GeoJSON is validated
as a **WGS84 `[lng, lat]`** FeatureCollection (LV95 rejected, §3b). Layer `id`s match what the
frontend persists as `layerState`, so saved layer visibility carries across a refresh.

**Storage caveat for remote loads.** A full `load` writes the GeoJSON to the *local*
`MEDIA_STORAGE_DIR`, so run it **server-side** for a fresh deployment – or use `push`, which
goes through the API so the server writes its own volume. There is also
**`load --config-only`** (inject `DATABASE_PUBLIC_URL`, like `admin_config`): it writes just
`referenceLayers` and never touches files, for the case where the files are already on the
server. The in-app **Datenquellen** upload is a third route, good for a one-off correction.

### 9e. `admin_objects` – Einsatzobjekte + Modul-PDFs

The station's pre-planned objects (a site + its Modul-PDFs, §3c) are station data in the same
sense as the geodata: a `plans/` folder of PDFs plus an `objects.manifest.json` in the private
data repo, loaded with `backend/app/admin_objects.py`. Each object becomes an `ObjectSite` row,
each PDF a `plan:<object-id>:<module>` reference dataset served at `/api/reference/<id>` and
surfaced automatically on an incident near that object.

```bash
# from backend/ – or prefix with `docker compose exec app` on a Docker-only host (§9)
uv run python -m app.admin_objects schema             # the manifest-object JSON Schema
uv run python -m app.admin_objects example            # a sample manifest to edit
uv run python -m app.admin_objects validate <dir>/objects.manifest.json  # + checks every referenced PDF (no DB)
uv run python -m app.admin_objects load <dir>/objects.manifest.json      # upsert objects + copy PDFs (DB + storage)
uv run python -m app.admin_objects push <dir>/objects.manifest.json      # → running deployment (KP_BASE_URL / KP_ADMIN_SECRET)
uv run python -m app.admin_objects show               # print the stored objects + plan counts
```

The manifest is a JSON list of objects, or `{"objects": [...]}`. Per object: **`key` or `id`**
(give one, not neither), `name`, and optionally `address`, `lat`, `lng`, `sourceKey`,
`sourceNote`, plus `plans[]`. Each plan entry needs `module` (the app slot – `modul1` …
`modul6`, or a named Modul-5 sub-slot like `modul5-wasser`; see §3c for what the modules mean)
and `file` (relative to the manifest), and may carry `title`, `sourceNote` and `sha256`.

- **Every object needs a stable identity, and `key` is the one a person should write.** `key`
  is the station's own name for the site (`"key": "schulhaus-dorfmatt"`), hashed to a fixed
  uuid5 that becomes the `id` – so the same key addresses the same Einsatzobjekt from any
  checkout, forever, and retyping it next year *updates* the object. Case and surrounding
  whitespace are ignored. This is what the shipped `objects.manifest.example.json` uses.
- **`id` is the machine form.** A generated manifest (a station importer) writes the uuid5 it
  derived and omits `key`. ⚠️ Never invent a UUID by hand: the upsert matches on `id` and
  nothing else, so one reused or mistyped digit silently creates a *second* object rather than
  updating the first. That is why the example stopped shipping a literal UUID.
- `key` is independent of `sourceKey`, which is what the scheduled plan pull matches on.
- **`sha256`, when present, is verified on every upload** – and `REQUIRE_PLAN_DIGEST` (§6) can
  make declaring it mandatory for machine publishers.
- `load` copies PDFs into the local store (server-side only); `push` uploads them through the
  API so the server writes its own volume. `--dry-run` is available on both.

### 9f. `admin_checklists` – checklist templates

Checklist templates (the FU action list, the Lagerapport agenda, the EL tactical playbook, the
device Anleitungen) are station data too: one `ChecklistTemplate` JSON per list – plus images for
`reference` and `manual` templates – and a `checklists.manifest.json`, kept in the private data repo and
loaded with `backend/app/admin_checklists.py`. Each template becomes a `checklists:<id>`
reference dataset (diagram pages as `checklists:<id>:p<N>`), served at
`/api/reference/checklists:<id>` and fetched + offline-cached by the Checkliste surface
(`loadTemplates` in `src/lib/checklists.ts`). With nothing loaded, the app falls back to one
neutral bundled example (`src/data/checklists/generic-action.json`) – never a station's real
lists.

```bash
# from backend/ – or prefix with `docker compose exec app` on a Docker-only host (§9)
uv run python -m app.admin_checklists schema             # the manifest-entry JSON Schema
uv run python -m app.admin_checklists example            # a sample manifest to edit
uv run python -m app.admin_checklists validate <dir>/checklists.manifest.json  # + checks every template/asset (no DB)
uv run python -m app.admin_checklists load <dir>/checklists.manifest.json      # upsert templates + assets (writes DB + storage)
uv run python -m app.admin_checklists push <dir>/checklists.manifest.json      # → running deployment (KP_BASE_URL / KP_ADMIN_SECRET)
uv run python -m app.admin_checklists show               # list stored templates + asset counts
```

The manifest is the single place a station controls checklist rail ordering (`order`), and
`load`/`push` **prune** stale `checklists:*` datasets not in the manifest, so renamed or removed
lists don't linger.

#### Template kinds

| `kind` | What it is | Body | Ticked? | Images |
| --- | --- | --- | --- | --- |
| `action` | a task list (FU phases) | `phases[].items[]` (+ `branches`) | yes, per Einsatz | – |
| `rapport` | the Lagerapport agenda | `phases[].items[]` | yes, per Einsatz | – |
| `reference` | Merkblätter / tactical playbook (Stichworte) | `entries[].content[]` | no | `{"type": "image", "page": N}` blocks |
| `manual` | an **Anleitung** for one device (05.10.2026) | `device` + `steps[]` | no | `steps[].images[].page` |
| `visit` | an Objektbesuch checklist – [`object-visits.md`](object-visits.md); optional `targets` (`["object"]` default, `"location"` = usable at a place without an object) | `phases[].items[]` | answered on the visit | – |

A `reference` entry's `diveraKeywords` put it in the Einsatz Checkliste's **«Passend»** group,
above «Aufgaben», when the Einsatz title (its Stichwort) names one of them. Only the title is
matched, never the Kategorie. A title word matches when it is the keyword or ENDS in it: `BRAND`
matches «Kellerbrand», but `GAS` never matches «Schlossgasse». Word endings count only for
keywords of 5+ letters (`EIS` does not match «Kreis»). They never count in a street name, meaning
a word ending in strasse/str./gasse/weg/allee/rain/ring/platz or followed by a house number
(`STRASSE` does not match «Hauptstrasse»). They also never count for a word that is a
keyword itself: «Zimmerbrand» is the `ZIMMERBRAND` hit only, so it does not also bring up every
entry that lists `BRAND`. A keyword of several words (`PKW BRAND`) matches as a
phrase of whole words. A keyword in `diveraKeywords` makes its entry show for every title it
matches: `BRAND` on an entry puts that entry up for every fire. At most four entries show. The most specific comes first: the longest keyword hit, then
the most keywords hit, then the entries' own order. No match means no group
(`matchEntries` in `src/lib/checklists.ts`).

Images are manifest `assets` (`{"page": N, "file": "…jpg|png|webp|svg"}`), stored as
`checklists:<id>:p<N>`; only `reference` and `manual` entries may carry them. Each kind's
shape is checked by `app/checklist_templates.py · template_problem` on every door (CLI,
`/admin › Checklisten`, the SharePoint pull).

#### Anleitungen (`kind: "manual"`)

A device's instructions – «Stromerzeuger starten», «Hebekissen einsetzen» – as big numbered
steps. They are **read, never ticked**: no state, no progress, nothing in the Verlauf or the
Rapport. Anleitungen are grouped by `device` (19.10.2026): one tile per device with its picture
(the `cover` of its first chapter that names one, otherwise the first step image of its
chapters) and «n Kapitel», or the
title when the device has a single Anleitung. A device with several opens a page with its
chapters numbered in manifest `order`; a chapter shows «Kapitel k von n», a back row «‹ device» on
top and the previous and next chapter at its foot («‹ 2 Kabine» | «4 Saugbetrieb ›»). Devices are listed in manifest `order` too, so the order of the manifest
entries is the order on screen. Two places show them, with the same tiles and pages: the Einsatz
**Checkliste** tab, as the last group of its rail (the picker search matches the title, the
`device` and the `keywords`), and the **Checkliste** surface of Karte & Objekte outside an
Einsatz (`ChecklistLibrary`), devices first, where the search also covers the steps, the
checklist items and the Stichwort texts, and the action checklists are shown read-only.
Pictures are prefetched into the service worker's `checklist-assets` cache as soon as the
templates load (`warmManualImages` in `src/lib/checklists.ts`), so an Anleitung opened for the
first time without network still shows them. Their URLs carry the asset's version (`?v=`), so a
replaced picture is fetched once under its new address and never again after.

```json
{
  "id": "stromerzeuger",
  "kind": "manual",
  "title": "Stromerzeuger starten",
  "device": "Stromerzeuger 8 kVA",
  "subtitle": "optional one-line intro under the title",
  "version": 3,
  "updated": "2026-09-14",
  "source": "Bedienungsanleitung Hersteller, Kap. 4",
  "keywords": ["generator", "notstrom"],
  "cover": 2,
  "steps": [
    { "text": "Standort im Freien wählen.",
      "warning": "Nie in geschlossenen Räumen betreiben – Kohlenmonoxid." },
    { "text": "Treibstoffhahn öffnen, bei kaltem Motor Choke schliessen.",
      "hint": "Ölstand nur bei waagrechtem Gerät ablesen.",
      "images": [{ "page": 1, "caption": "Bedienfeld" }] }
  ]
}
```

| Field | Required | Meaning |
| --- | --- | --- |
| `device` | ✅ | the Gerät; the picker groups by it (same string = same group) |
| `steps[].text` | ✅ | the step, shown big and numbered; phone numbers become tappable |
| `steps[].details` | – | sub-points of the step (a list of strings), shown as a bullet list under it |
| `steps[].warning` | – | a red «Achtung:» line – what hurts people or the device |
| `steps[].hint` | – | a quiet tip line |
| `steps[].images[]` | – | `{ "page": N, "caption"? }` – an asset page of this entry: a photo, or a page of the device's PDF manual exported as an image (one image per PDF page) |
| `cover` | – | the asset page shown as the device's picture (its tile and page) – a step picture, or a photo of its own no step shows; without it the first step image. The device takes the cover of its first chapter that has one |
| `updated` | – | «Stand», `YYYY-MM-DD` |
| `keywords` | – | extra search words (model names, «Generator») |
| `subtitle`, `version`, `source` | – | intro line, your own version counter, «Quelle:» footer |

`admin_checklists validate` refuses an Anleitung whose steps or `cover` show a `page` the
manifest entry has no asset for – a blank box where the picture should be is exactly what must
not happen at 3am. A manifest entry (page 2 is the cover photo above, which no step shows):

```json
{ "id": "stromerzeuger", "kind": "manual", "title": "Stromerzeuger starten",
  "file": "checklists/stromerzeuger.json", "order": 10,
  "assets": [{ "page": 1, "file": "checklists/assets/stromerzeuger-p1.jpg" },
             { "page": 2, "file": "checklists/assets/stromerzeuger-geraet.jpg" }] }
```

`examples/demo-data/` carries two worked examples (`musterdorf-stromerzeuger`,
`musterdorf-hebekissen`) with SVG pictures; `/admin › Checklisten` offers a neutral one as
«Beispiel-Vorlage: Anleitung».

### 9g. Maintenance tools (`reset_roster`, `demo_export`, `admin_visits`)

Three further CLIs that no station meets, but somebody looking after a deployment does. They used
to be documented only in their own docstrings, which nearly cost them their lives twice during
clean-ups – a module nothing imports and no document mentions looks like dead code.

**`reset_roster` – put the user list back to the seed file.** Unlike `seed.py`, which only
creates missing users and never touches an existing PIN, this one *enforces*: it updates every
user from the seed file (display name, role, colour **and** PIN) and deactivates everyone not in
it. Deactivated, not deleted – foreign keys onto incidents, notes and media stay intact, and the
crew list still shows only the seeded people.

```bash
# from backend/ – with the TARGET environment's SECRET_KEY (the PIN pepper) and DATABASE_URL
SECRET_KEY=<target> DATABASE_URL=<target-public> SEED_PIN=<6–12 digits> \
  uv run python -m app.reset_roster
```

The `SECRET_KEY` is not optional: it peppers the PIN hashes. With the wrong one you get a list
nobody can log into.

`SEED_PIN` is not optional either, and it is the same rule as at boot: this tool writes the PIN it
is given onto **every** user in the seed file, and it **refuses one of the well-known PINs**
(`backend/app/auth/security.py · TRIVIAL_PINS`) rather than resetting a station's editor to the
`000000` that ships in `seed_users.json`. The refusal happens before any database work, so a
rejected run changes nothing. Note the consequence of "every user": a seed file carrying distinct
PINs per person collapses to the one you pass – the same thing `seed.py` does at boot.

**`demo_export` – write the demo scene back into the seed file.** The public demo keeps changes
through the day. To rearrange the pre-placed symbols, hose lines or the building, do it live in
the app and then bake the result into `examples/demo-data/incident.workspace.json`:

```bash
DATABASE_URL=<demo Postgres public URL> uv run python -m app.demo_export
```

It only reads; the single thing written is the repo file. The hand-placed keys are kept
(`entities`, `drawings`, `building`, `board`, `layerState`, `recent`) – the collections the
nightly reset recreates anyway (`trupps`, `mittel`, `attendance` …) are dropped, so they do not
freeze into the seed. Commit the result; the nightly reset reads from it.

**`admin_visits` – read the visit counters from a terminal.** The counterpart to
`GET /api/admin/visits`: the last 30 days one block per day, `--days N` for another window,
`--totals` for the window's sums, `--prune` to delete dedup rows past the retention window.

```bash
# from backend/ – on Railway: railway run uv run python -m app.admin_visits
DATABASE_URL=<target> uv run python -m app.admin_visits --totals
```

It reads the two aggregate tables `VISIT_STATS` writes, and that flag is off everywhere except
the public demo – so **on a station this prints an empty table, permanently and by design**
(`app/visits.py`, and [`PRIVACY.md`](../PRIVACY.md) § «Counting visitors without recognising
them»). It is listed here so nobody mistakes it for a station tool, or for dead code.

### 9h. The station workbook – one `.xlsx` for the list-shaped data

Not a CLI, and the reason it sits in this section: for the parts of a station that are simply
**lists**, this is the bulk door, and for several of them it is the only one. `/admin` → Daten →
**Arbeitsmappe** downloads one `.xlsx` holding what the station has today, the station edits it in
whatever it already uses, and uploads it back. Admin session on all three routes; the API shapes
are in [`API.md`](API.md#station-workbook--apistation-workbook).

| Sheet | Writes |
|---|---|
| `Mannschaft` | the personnel rows (name, Grad, provider + external id, active) – **not** config |
| `Dienstgrade` | `roster.ranks` |
| `Fahrzeuge` | `fleet.vehicles` |
| `Mittel` | `mittel.catalogue` |
| `Mittel-Bestände` | `mittel.catalogue[].stock` (the per-source load-out) |
| `Quellen` | `mittel.sources` |
| `Partnerorganisationen` | one `Kategorie` column splitting into `report.partnerOrgs` (`Rapport`) and `fleet.partner.*` (the five others) |
| `Symbolfelder` | `fleet.attributeLists`, one row per option |

**It is upsert only. There is no replace mode and there never will be one** – deleting is
expressible only as a row missing from a sheet that is *present*. Which is why the next two rules
are the whole safety model, and why a volunteer must not have to rediscover either of them.

#### ⚠️ An absent sheet is not an empty sheet

A sheet that is **not in the file** leaves its section exactly as it was. A sheet that **is** in
the file with nothing but its header row **clears** that section. That is deliberate, and it is
how you empty a list on purpose – but it means deleting the `Fahrzeuge` tab to "leave the
vehicles alone" and deleting its rows are two very different acts. The preview says which one it
read: an absent sheet shows «nicht in der Datei – bleibt unverändert» instead of zeros.

#### ⚠️ "Absent" means two different things

A **person** missing from a present `Mannschaft` sheet is **deactivated**, never deleted – closed
incidents resolve their names through that row, so deleting one would rewrite history. An **id**
missing from an id-keyed sheet (`Dienstgrade`, `Fahrzeuge`, `Mittel`, `Quellen`, and the composite
keys behind `Mittel-Bestände`, `Partnerorganisationen`, `Symbolfelder`) is **removed** from the
list. The preview uses those two German words and names the rows rather than counting them.

#### Nothing is written until a preview is confirmed

The upload is planned first and the plan is the confirmation screen: per sheet what would be
created, updated, left alone, removed or deactivated; which sections would end up **empty**; every
warning; and every **refused row with its sheet and row number** (`<Blatt> Zeile <N> – …`, or
`Blatt <Blatt> – …` where the fault is the sheet rather than one row). A single refused row refuses the
whole file – it is all-or-nothing, and nothing is written. The preview reports the SHA-256 of the
bytes it read and the confirm sends it back, so a file edited in between is refused (**409**)
rather than imported against a plan that no longer describes it.

**Re-importing an unmodified export changes nothing at all** – byte-identical config, no personnel
row touched, no history row written. That is the property that makes it safe to download the
workbook just to look at it.

⚠️ **…with one limitation: a config that is already inconsistent exports into a file the import
refuses.** The export writes out whatever the document holds; the import applies the referential
rules above to all of it. Four stored states come back as a refusal you did not cause: a
`catalogue[].stock` entry filed under a `source` that is not in `mittel.sources`; the same id
twice in `roster.ranks`, `fleet.vehicles`, `mittel.catalogue` or `mittel.sources`; two
`report.partnerOrgs`/`fleet.partner.*` names in one category that differ only in case, spacing or
accents (`Zivilschutz` / `zivilschutz`, `Öko` / `Oko`); and any of those lists carrying an **empty
label**. A config written by the forms
or by an earlier workbook import cannot get into those states – a hand-edited or CLI-pushed one
can. **The workbook door stays shut until the config is repaired elsewhere** (Sicherung →
export, edit the JSON, import; or `admin_config`). The row and the reason are named in the
preview, which is where you find out which one it is. (Ids the config *already* holds are
deliberately exempt from the format rule, so an old non-slug `Kennung` is never the cause.)

Every write that *does* change a **config section** keeps the document it replaced, filed under
source `workbook`, so «Letzte Änderungen» undoes that half the same way it undoes a form edit (§9b).

⚠️ **The Mannschaft is not in that safety net.** Personnel are rows in their own table, and
`keep_previous` runs only when a config section actually changed — so an import that touches *only*
the `Mannschaft` sheet writes **no history row at all**, and «Letzte Änderungen» will not show it.
Two things limit what that costs: a person missing from the sheet is **deactivated, not deleted**
(past incidents, notes and media still reference them), so undoing it is a re-activation rather than
a recovery; and the workbook is its own undo — the export you take before an import is the file that
puts the roster back. The one genuinely irreversible edit is a **rename** of a person carrying a
provider identity, which drops the stored first/last split; the preview warns when that would
happen.

#### What it does not cover, and what it will not touch

- **It is not a backup.** It covers list-shaped station data only. The backup is the Sicherung
  JSON export plus «Letzte Änderungen» – [`DEPLOYMENT.md`](DEPLOYMENT.md) §6.
- **`mittel.units` is not in the workbook** and is carried over untouched, as are `identity`,
  `map`, `doctrine`, `referenceLayers`, `modules`, `alarms`, `alarmKeywords`, `report.links` and
  `journal`. A config file is the only way to set `mittel.units`.
- **`mittel.catalogue[].when`, `.perAtemschutz`, `.equipment` and `fleet.vehicles[].winfapAlias`
  are preserved but not editable.** They have no column; they are re-attached on an **id** match.
  Change a `Kennung` in the sheet and the row is a delete plus a create, so those – and that
  entry's `stock` – are lost with it.
- **Renaming a person can cost their name order.** Someone who carries a provider identity (a
  Divera id) *and* a stored first/last split loses that split when the sheet renames them, and then
  stops following `roster.nameOrder` – they stand exactly as the cell spells them. The preview
  warns only when this would actually happen.
- **Two referential refusals**, both checked against the state *after* the import, so re-grading
  and dropping in one file is fine: a `Quelle` cannot be dropped while stock still points at it,
  and a `Dienstgrad` cannot be dropped while anybody still carries it – including inactive people.
- **Key cells are read as text or refused, never repaired.** Excel corrupts ids for a living
  (leading zeros, `2-1` becoming a date); a key cell that does not survive that is quoted back at
  you rather than rewritten to something plausible. Formulas cannot leak in either – the file is
  read values-only.
- ⚠️ **`fleet.partner.*` is the legacy shape.** The five non-`Rapport` Partnerkategorien feed the
  `Einheit` suggestion on the partner symbols only as a **fallback**: a `Symbolfelder` row for the
  same symbol and field wins over them. And only `Feuerwehr`, `Sanität` and `Polizei` map to a
  symbol at all – `Chemiewehr` and `Zivilschutz` round-trip faithfully and are read by nothing.
  For anything you want to be certain is live, use the `Symbolfelder` sheet.
- Unknown tabs are **warned about, never silently ignored**; a file that is not `.xlsx` (400), an
  empty one (400) or one over `MAX_UPLOAD_MB` (413) is refused before anything is parsed.

---

## 10. Out of scope for this doc
- **Device preferences** and **per-incident settings** (`IncidentSettings`) – neither is part of
  the deployment config; where each lives, and why the three doctrine values are set only at
  `/admin` › Doktrin since commit `99c4348`: [§0a](#0a-for-developers--where-a-setting-lives-station-data-coordinates).
