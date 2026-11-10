# Architecture

How KP Front is put together and where its data comes from. For the reference-geodata flow
specifically, see [`geodata-architecture.md`](geodata-architecture.md); for the per-deployment
config contract, [`CONFIGURATION.md`](CONFIGURATION.md); for running it,
[`DEPLOYMENT.md`](DEPLOYMENT.md).

The shape in one sentence: a tablet-first **PWA** talks to a single **FastAPI** service that
serves the app same-origin, owns a **PostgreSQL** database and an asset store, and is the only
thing that reaches **external services** – one deployment per station, no multi-tenancy.

## Overview

![KP Front architecture overview](architecture.svg)

The whole system on one page, drawn on 2026-10-13 from `backend/app` on `main`. Its source is
[`architecture.excalidraw`](architecture.excalidraw): open it in any Excalidraw (excalidraw.com or
a self-hosted one), edit, and export the SVG over `architecture.svg` – the two files change
together. The Mermaid diagrams below are the per-topic views; keep them in step with it.

Every integration on the right is optional: an unset credential leaves its scheduler job ticking
as a no-op (see [The scheduler](#the-scheduler)), and a station that connects nothing still has a
complete, offline-capable command tool.

## System context

```mermaid
flowchart TB
  subgraph CLIENT["Browser – installable PWA (tablet / phone)"]
    UI["Lage · Plan · Tafel · Rapport<br/>React + TypeScript + MapLibre GL"]
    SW["Service worker (Workbox)<br/>app-shell precache · runtime cache · offline"]
    LS[("IndexedDB<br/>incident doc · write queues<br/>+ localStorage for device prefs")]
    ADM["/admin – Verwaltung<br/>ADMIN_SECRET session"]
    DOORS["No-login doors<br/>Erfassungs-Poster · Einsatz-Link · Stations-Terminal"]
    UI --- SW
    UI --- LS
  end

  subgraph DEP["Deployment – one per station (single-tenant)"]
    API["FastAPI service<br/>serves the SPA same-origin (no CORS)<br/>auth · workspace sync · audit · admin"]
    SCHED["Scheduler (one leader)<br/>observes · polls · pushes"]
    REND["Server-side renderers<br/>Kroki · Rapport PDF · plan tiles · alignment"]
    EGR["Integration clients<br/>SSRF-guarded · credentials env, else /admin"]
    DB[("PostgreSQL<br/>incidents · events · config + history<br/>roster · credentials (encrypted)")]
    FILES[("Asset storage (volume / S3)<br/>plans · media · reference GeoJSON · symbols")]
    API --- DB
    API --- FILES
    API --> REND
    API --> EGR
    SCHED --> EGR
    SCHED --> DB
  end

  subgraph INBOUND["Inbound – they call us"]
    DIVW["Divera webhook · FireHub<br/>generic POST /api/alarms"]
    ORG["fwo-admin / fwo-stats<br/>/api/integrations (Objektbesuche)"]
  end

  subgraph EXT["Outbound – backend only"]
    DIV["Divera 24/7<br/>alarm poll · roster"]
    TRC["Traccar<br/>vehicle GPS"]
    GEO["geo.admin<br/>geocoder · GWR / BFE"]
    OSM["Overpass<br/>building outlines"]
    WX["MeteoSwiss → Open-Meteo<br/>weather · radar"]
    CARTO["CARTO<br/>basemap for Rapport / Kroki"]
    MS["Microsoft 365<br/>SharePoint pull · export · Entra login"]
    S3P["S3 plan library<br/>plan_pull"]
    IDX["Station index<br/>roster snapshot"]
    OUT["Web Push · incident webhooks → KP Rück<br/>speech-to-text · healthcheck ping"]
  end

  TILES["Raster map tiles<br/>swisstopo WMTS · OSM · canton WMS · CARTO"]
  PRIV["Station's private data repo<br/>config · geodata · plans · checklists · Tafel"]
  CLI["Station CLIs<br/>admin_config · admin_geodata · admin_objects · …"]

  UI -->|"/api/* – same-origin, JWT cookie"| API
  ADM --> API
  DOORS -->|"capture secret / link token"| API
  DIVW --> API
  ORG -->|"Bearer key"| API
  EGR --> EXT
  UI -. "tiles fetched directly by the browser" .-> TILES
  PRIV -. manifests .-> CLI
  CLI -->|"load (DATABASE_URL) · push (ADMIN_SECRET)"| DB
```

## Where the data comes from

| Data | Source | How it reaches the app | Offline |
| --- | --- | --- | --- |
| Tactical symbols (FKS) | KP-Front-authored (`tools/gen_symbols.py`) | bundled `public/tactical-symbols.json`, also seeded into the reference store | ✅ cached |
| Hazmat UN-Nr → Stoff (ADR) | UNECE ADR table | static `public/un-hazard.json` (lib/unHazard) | ✅ in-app |
| Base map tiles | swisstopo WMTS · OSM · canton WMS | **browser fetches tile servers directly** | ⚠️ pre-cached areas only – a per-device setting (Offline-Vorbereitung) can pre-cache automatically shortly after an incident opens, instead of relying on the manual «Alles für offline laden» |
| Geocoding / address search | swisstopo geo.admin | backend proxy `GET /api/geocode` | ✗ online only |
| Weather / wind | MeteoSwiss → Open-Meteo fallback | backend proxy `GET /api/weather`; recorded by the scheduler (`weather.observe`) | last value cached |
| Weather layer (radar) | MeteoSwiss radar (ODIM HDF5, open data) | polled by the backend in EVERY serving process (`weather_layer.py`, every 5 min), not by the leader — it is a display cache that records nothing; devices read `GET /api/weather/layer` and `GET /api/weather/radar/{key}.png` | last answer kept, greyed with «Stand hh:mm» once stale |
| Alarm + roster | Divera 24/7 | webhook + the scheduler's poll → pool; devices read `/api/divera/pool`, `/api/personnel` | roster cached |
| Live vehicle GPS | Traccar | backend proxy `/api/traccar` (one cached answer per 10 s); «vor Ort»/«verlassen» observed by the scheduler | ✗ live only |
| Reference geodata (hydrants, Leitungskataster, canton WMS) | the station's own (often private) data repo | `admin_geodata` → reference store + `config.referenceLayers` (see [`geodata-architecture.md`](geodata-architecture.md)) | ✅ GeoJSON cached (WMS tiles online) |
| Object plans (Einsatzobjekte + Modul-PDFs) | the station's data repo, its SharePoint, or an S3 plan library | `admin_objects`, the SharePoint pull (60 s tick) or `plan_pull` (hourly, `PLANS_S3_*`) → reference store; tile pyramids rendered server-side | ✅ tiles via the service worker ([`plans-and-buildings.md`](plans-and-buildings.md)) |
| Checklists · Tafel templates | the station's data repo or SharePoint | `admin_checklists` / `admin_board_templates` (or the SharePoint pull) → reference store | ✅ cached |
| Gebäude-Steckbrief | GWR + BFE registers on geo.admin (keyless) | backend proxy `GET /api/incidents/{id}/building` | last answer per Einsatz in IndexedDB ([`building-card.md`](building-card.md)) |
| Building outlines («Umrisse») | OpenStreetMap via Overpass | backend proxy `POST /api/overpass/buildings` – never from the browser | server cache (6 h) |
| Roster from elsewhere | a published `roster-snapshot/1` file, found through the station index | scheduler job `roster_snapshot` ([`CONFIGURATION.md`](CONFIGURATION.md) §4c–4d) | roster cached |
| Alarms from other systems | FireHub webhook · generic `POST /api/alarms` | inbound intake, auto-opens an Einsatz ([`ALARM-INTEGRATIONS.md`](ALARM-INTEGRATIONS.md)) | – |
| Voice-memo transcripts | any OpenAI-compatible speech-to-text endpoint | backend `POST {stt_base_url}/v1/audio/transcriptions` | ✗ online only |
| Incident state · Verlauf · exports | **the operator (this app)** | workspace sync + append-only event log in Postgres | ✅ IndexedDB + queued sync |

Three classes: **bundled** (offline, ships in the app), **backend-proxied** (cached, one
SSRF-guarded client per service), and **browser-direct** (raster tiles only). No station data
is bundled – see the geodata doc for why.

What leaves the server unasked is outbound only and never carries a credential to the browser:
Web Push notifications, the incident webhooks (`incident.created` / `alarm.attached`, e.g. to
KP Rück's slip printer), Objektbesuche filed to SharePoint and the dead-man's-switch ping
(`HEALTHCHECK_PING_URL`, every 60 s).

## Backend modules

```mermaid
flowchart LR
  subgraph EDGE["FastAPI routers (/api/*)"]
    AUTH["auth<br/>PIN → JWT · Microsoft (opt.) · roles · rate-limit"]
    INC["incidents · journal · media<br/>workspace sync (LWW + rev)"]
    EVT["events<br/>append-only Verlauf"]
    CFG["config · admin · credentials<br/>GET (public) / write via CLI/admin"]
    REF["reference · objects · plan_alignments<br/>symbols · geodata · plans"]
    PERS["personnel<br/>roster (Divera / manual / CSV / snapshot)"]
    INTAKE["alarms · firehub · divera<br/>inbound intake"]
    DOORS["capture · incident_link<br/>no-login doors"]
    ORGAPI["integrations<br/>organizer API (Bearer key)"]
    PROXY["traccar · geocode · building<br/>weather · overpass · push"]
  end

  subgraph CORE["Core services"]
    AUD["audit.py<br/>hash-chain + snapshots"]
    STG["storage.py<br/>local volume / S3"]
    REND["kroki · app/report · plan_tiles<br/>plan_alignment_worker · audio"]
    CRED["credentials.py · egress.py<br/>encrypted store · SSRF floor"]
    SCHED["scheduler.py<br/>one leader (advisory lock)"]
  end

  DB[("PostgreSQL")]
  FILES[("Asset storage")]
  EXTSVC["External APIs"]

  AUTH --> DB
  INC --> AUD --> DB
  EVT --> AUD
  CFG --> DB
  PERS --> DB
  INTAKE --> DB
  DOORS --> AUD
  ORGAPI --> DB
  REF --> STG --> FILES
  REF --> REND --> STG
  PROXY --> CRED --> EXTSVC
  SCHED --> CRED
  SCHED --> AUD
```

Auth is a PIN-kiosk login issuing JWTs in httpOnly cookies. Product roles are **editor** (FU /
incident editing), **el** (Einsatzleiter function, added 2026-09-07: full read, but writes only
the operational record – Anwesenheit/Zeitplan, Mittel, Checklisten, Rapport + Beilagen –
through a server-enforced workspace slice; the tactical picture stays editor-only) and
**viewer** (read-only); the stored backend value was migrated from the
legacy `commander` name to `editor` on 2026-06-30. Deployment administration is separated
behind its own `ADMIN_SECRET` env var: the `/admin` UI and admin-write API (config, branding,
system, user CRUD, geodata/objects) gate on a secret-backed admin-session cookie, never on the
incident editor role, and it is fail-closed – an unset `ADMIN_SECRET` returns 403 on every
admin endpoint rather than falling back to the editor PIN.
Incident state is one workspace blob per incident; the audit trail (`audit.py`) hash-chains
every change and keeps fold snapshots (one gzipped copy of the blob per save) so an incident
can be replayed and verified (`GET /api/incidents/{id}/verify`).

### The server observes; devices never write observations

Everything the app merely OBSERVES about the outside world is recorded by the scheduler (one
leader per deployment, `scheduler.py` · PostgreSQL advisory lock), once, stamped with the time
the fact is about — never by a device. Decided after the Feueralarm-Übung of 23.09.2026, where
every editor device wrote what it noticed, when it noticed: all five vehicles «vor Ort» at
19:43 (the moment a tablet woke up; GPS said 19:23–19:28), one weather reading up to five
times, and 469 Divera polls.

The observer is **active** for an incident that is open, has a real coordinate (not 0/0) and
was started OR written to by a person within the last 24 h (a journal row or an audit event
that is not one of the observers' own — they never keep an incident alive by themselves);
Übungen included. When an open incident goes quiet for 24 h, observation ends with ONE Verlauf
row (`obs-end-…`) and resumes by itself at the next human write. Every observer walks the
incidents in id order: each holds incident row locks until its commit, and two orders could
deadlock. The presence memory changes only after the tick's commit, so a failed tick loses
nothing, and a new scheduler leader starts from the record.

«The time» of a presence transition is the tracker's own report time, Traccar's `deviceTime`
(not `fixTime`, not the server's receipt), capped at the server's now.

| Observation | Where | Record |
| --- | --- | --- |
| Fahrzeug «vor Ort» / «verlassen» | `vehicle_presence.py`, inside the 30 s GPS sweep (`_vehicle_samples_sweep`); rings ≤ 150 m / ≥ 300 m, 90 s settle, stamped with the FIRST report in the new zone | a `vehicle.presence` audit event per transition (`vp:<device>:<n>`, the restart memory); Verlauf rows for the first arrival and the last departure only (`vps-<n>-<zone>-gps-<device>`, the departure once the vehicle stayed away 20 min or observation ends); `reportMeta.fahrzeuge[].gps` (zone, an, ab, Fahrten) for the vehicle table and the Rapport — server-owned, kept on every client save (`keep_server_gps`); `vorOrt` first-writer-wins against the external geofence (`api/alarms · apply_milestones`). Never `zurueck`: that is «back at the depot», the geofence's |
| Wetter | `observations.py`, every 10 min (`_weather_sweep`), past the request cache | one `weather.observe` event per reading, `wx:<incident>:<observed_at>` (the shape the replay reads) |
| Winddrehung | `observations.py` — ≥ 45° at ≥ 10 km/h, held over two readings on the same side, from one source + station | one Verlauf row `wxd-<observed_at>` with `writtenAt`; devices show it once on the Meldeleiste for 30 min from `writtenAt` |
| Divera-Alarme | `_divera_tick`: 30 s while no incident runs, 120 s while one does, exponential back-off on 429 | the pool; the webhook stays the primary intake, devices only READ `/api/divera/pool` |
| Fahrzeugpositionen | `traccar.cached_vehicle_positions`: one Traccar answer per 10 s for every device (keyed by the credential identity; single-flight; errors are not cached) | — (the map's live layer) |

A derived id makes a second writer (a restart, a rolling deploy) converge rather than
duplicate. A device on an older build still writes its own presence rows (`vp-…`) and weather
events; the journal and events endpoints acknowledge and drop them (`api/journal ·
observed_by_server`, `api/events · SERVER_OBSERVED_OPS`). Rows it wrote BEFORE the deploy stay
(append-only) — the server's rows have their own id shape (`vps-`), so an old row can never
swallow the server's; an incident running across the deploy may show both. The fake fleet (`TRACCAR_FAKE`) feeds the same sweep, so
all of it runs on dev and demo data.

#### Rules an observer keeps

- ⚠️ **The server observes; devices never write observations** (24.09.2026, design D2 after
  the Feueralarm-Übung of 23.09.2026). A fact about the OUTSIDE world — a vehicle arrived or
  left, the weather, a new Divera alarm — is recorded by the scheduler, once, stamped with
  the time the fact is about: «vor Ort» / «verlassen» on the tracker's report time (Traccar
  `deviceTime`, capped at now) inside the 30 s
  sweep (`app/vehicle_presence`), a `weather.observe` per reading and the wind-shift row
  every 10 min (`app/observations`), the Divera poll (30 s idle / 120 s while an Einsatz
  runs, but 30 s for the first 10 min after an alarm while the crew answers; back-off on
  429). Why: a device writes what it noticed WHEN it noticed — five
  vehicles «vor Ort» at 19:43 because a tablet woke up (GPS said 19:23–19:28), one weather
  reading ×5, 469 Divera polls — and writes nothing while every screen sleeps. Devices only
  READ (the pool, the Verlauf, the `reportMeta.fahrzeuge[].gps` block behind the Rapport's
  «Fahrzeuge GPS · live» table); an older build's own copies are acknowledged and dropped at
  the endpoints (`api/journal · observed_by_server`, `api/events · SERVER_OBSERVED_OPS`). A
  new observation ⇒ a scheduler job registered unconditionally (no-op when unconfigured) with
  a derived id, never a device-side effect. Three rules an observer keeps (review 25.09.2026):
  its memory changes only AFTER the commit (`vehicle_presence · Tick.commit` — a failed tick
  must not lose a transition); it walks incidents in id order (row locks, deadlock); and what
  it writes is SERVER-OWNED — `reportMeta.fahrzeuge[].gps` is put back on every client save
  (`keep_server_gps`). `zurueck` is «back at the depot» and stays the geofence's. «Active» =
  a human write within 24 h, never the observers' own. Full table: `docs/ARCHITECTURE.md`.

### The scheduler

Observing is one of several things the leader does. Every credential-driven job is registered
unconditionally and no-ops on a tick where its credential is missing – that is what lets an
admin connect an integration from the browser without a restart (`scheduler.py`, comment above
the registrations).

| Job | Cadence | Does |
| --- | --- | --- |
| `divera_poll` | 30 s idle / 120 s during an Einsatz | the alarm pool (table above) |
| `vehicle_samples` | 30 s | GPS track + «vor Ort» / «verlassen» (table above) |
| `weather_observe` | 10 min | weather record + wind shift (table above) |
| `push_sweep` | 30 s | Web Push for überfällige Trupps, Alarmdruck and due Wiedervorlagen (`push.py`) |
| `heartbeat` | 60 s | the dead-man's-switch ping to `HEALTHCHECK_PING_URL`, only if `/ready`'s data-layer check passes |
| `sharepoint_pull` | 60 s tick | station data from SharePoint into the existing importers ([`sharepoint-connector.md`](sharepoint-connector.md)) |
| `object_visit_delivery` | 30 s | files Objektbesuche into SharePoint ([`object-visits-sharepoint.md`](object-visits-sharepoint.md)) |
| `roster_snapshot` | `roster.snapshotIntervalMin` | a published roster file into `personnel` |
| `personnel_autosync` | nightly, ~04:17 | the Divera roster, where `roster.autoSync` asks for it |
| `plan_pull` | hourly | an S3 plan library – boot-gated on `PLANS_S3_*`, the only job that is |
| `plan_alignments` · `plan_tiles` | 10 s · 15 s, idle once done | CV alignment of each plan revision; tile pyramids per plan PDF |
| `auto_archive` | hourly | archives untouched auto-opened and stale Einsätze and idle Übungen (`alarms.autoArchiveDays`, `alarms.staleIncidentDays`, `alarms.exerciseAutoCloseHours`) |
| `positions_sweep` · `visit_hashes_sweep` | hourly · daily | deletes expired shared positions and visit-dedup rows (privacy promises, always on) |
| `print_jobs_sweep` | hourly | deletes station-printer jobs (each holds a Rapport PDF) after 7 days, relay configured or not |
| `object_footprints` | 120 s, idle once every object is asked | «Karte & Objekte»: the buildings of each station object, the Einsatzgebiet's houses and the underground buildings from the official sources ([`karte-objekte.md`](karte-objekte.md)) |
| `credentials_refresh` | 30 s | keeps the credential snapshot fresh |
| `weather_radar` | 5 min, every process | the radar display cache – not leader-only, records nothing |
| `demo_reset` | `DEMO_RESET_CRON` (Europe/Zurich), or every `DEMO_RESET_SECONDS` | the public demo only: wipes and reseeds the synthetic incident and roster – registered only when one of the two is set |

## Configuration: four layers

```mermaid
flowchart TB
  subgraph PREC["Resolution order – highest wins, falls back downward"]
    direction TB
    L4["4 · Per-incident – workspace blob (synced, any user)"]
    L2["2 · Per-station – deployment_config DB row (CLI/config files primary; admin UI helper)"]
    L1["1 · National defaults – code (appConfig.ts · config.py)"]
    L4 --> L2 --> L1
  end
  L3["3 · Secrets – env vars (boot secrets); integration credentials in env or /admin (encrypted, env wins)"]
  L3 -. "configures" .-> L2
```

A station's config is a single `deployment_config` row served at `GET /api/config` and applied
at boot to override the code defaults. Edit it as code with
`uv run python -m app.admin_config <schema|example|validate|diff|load>`. Every full-document
write passes the same guards (`config_guard.py`) and keeps the document it replaces
(`config_history.py`, `admin_config history|restore`). See
[`CONFIGURATION.md`](CONFIGURATION.md).

Integration credentials (Divera, Traccar, Web Push, speech-to-text, webhooks, CARTO, the
healthcheck URL, SharePoint, Microsoft login, the station index, the organizer key) can be set
at `/admin` → Anbindungen and are stored encrypted with a key derived from `SECRET_KEY`; a value
in `.env` wins and locks the field ([`DEPLOYMENT.md`](DEPLOYMENT.md) §4).

### Station data and the CLIs

Station data never lives in this repository. It reaches a deployment through one of three doors,
which all write the same rows ([`STATION-DATA.md`](STATION-DATA.md)):

- **the browser** – `/admin`, one item at a time, plus the Arbeitsmappe `.xlsx` for list-shaped data;
- **SharePoint** – the scheduler's read-only pull feeds the same importers;
- **config as code** – a private data repo with manifests, loaded by the station CLIs.

The CLIs run from `backend/` as `uv run python -m app.<cli>` and share one shape
(`admin_cli.py`): validate a file, `load` it into the database `DATABASE_URL` points at, or
`push` it to a running deployment over its HTTP API with `ADMIN_SECRET`. Reading and generating
also works inside the running container ([`DEPLOYMENT.md`](DEPLOYMENT.md) §4).

| CLI | Loads | `just` recipes |
| --- | --- | --- |
| `admin_config` | the `deployment_config` row (schema · example · validate · diff · load · history · restore) | `config-*` |
| `admin_geodata` | reference layers: GeoJSON + `referenceLayers` | `geodata-load` / `-push` |
| `admin_objects` | Einsatzobjekte + their Modul-PDFs | `objects-load` / `-push` |
| `admin_checklists` | checklist templates + diagram pages | `checklists-load` / `-push` |
| `admin_board_templates` | the Tafel's page templates | `board-templates-load` / `-push` |
| `admin_branding` | logo, report logo, favicon | – |

Operations tools of the same family: `admin_postcheck` (the read-only post-Einsatz check, `just
postcheck`), `backup` (a coherent SQL + blob pair), `gen_vapid`, `admin_visits`, and for test
and demo data `fake_scenario` and `demo_reset`.

## Sync & audit flow

```mermaid
sequenceDiagram
  participant A as Device A (editor)
  participant API as FastAPI
  participant DB as PostgreSQL
  participant B as Device B
  A->>API: PUT workspace (full blob + base_rev)
  opt revision conflict
    API-->>A: 409 (current workspace + rev)
    A->>A: three-way merge by id, apply merged document locally
    A->>API: retry merged workspace + current rev
  end
  API->>DB: append IncidentEvent (hash-chained)
  API->>DB: store workspace + workspace_rev++
  API-->>A: 200 (new rev)
  B->>API: GET workspace?since=rev&wait=1&writer=B (long poll)
  API-->>B: 200 newer blob – or 304 unchanged
  Note over A,API: A's own poll, woken by A's save: 304 + X-Workspace-Rev (only A's saves since)
  Note over API,DB: /api/incidents/{id}/verify re-walks the chain (tamper check)
```

The browser also keeps the incident in **IndexedDB** (`src/lib/idb.ts`; localStorage is only a
fallback for small device preferences) and queues writes while offline, so the
app keeps working without connectivity and reconciles on reconnect.

Workspace writes, journal rows and client audit events have separate durable queues. The
shared saved indicator combines all three: it cannot turn green while one queue still has
pending or rejected work. Failed local persistence is reported separately from failed upload.
The journal offers one recovery notice with retry and a JSON export of unsent entries.

Client audit events use a stable `client_id`, unique within an incident. The server serializes
appends under the incident row lock and returns the existing event for an identical retry;
reusing an ID for different content or authorship fails the whole batch. The hash chain remains
unchanged. Events without an ID retain legacy append behavior. The browser queue is scoped to
incident and actor, survives reload, and removes events only after an acknowledged response;
teardown beacons may safely be delivered again. Journal rows retain their existing idempotent IDs.

Tab promotion reloads the previous writer's IndexedDB queue before persisting. Initial cache
reads merge entries captured while the read was in flight. Legacy localStorage migrations
remove their source only after IndexedDB confirms the replacement write.

Alarm-bearing workspace fields are validated at the shared save boundary against the stored
incident. Unchanged malformed legacy rows are retained, so an unrelated edit can still save;
new or changed invalid rows are rejected. Revision conflicts remain conflicts, and no save
bypasses drawing sanitization or alarm validation.

## Deployment

One image, built in two stages (Vite SPA → `dist/`, then the FastAPI app that serves it),
running next to PostgreSQL; an optional Caddy container terminates TLS. Runs on Railway or
self-hosted via docker-compose. Full guide in [`DEPLOYMENT.md`](DEPLOYMENT.md).

```mermaid
flowchart LR
  USER["Operator (browser)"]
  CADDY["Caddy (optional)<br/>auto-HTTPS"]
  APP["app container<br/>uvicorn – FastAPI + built SPA"]
  PG[("postgres:16<br/>pgdata volume")]
  VOL[("storage volume<br/>media · plans · reference data")]
  USER --> CADDY --> APP
  USER -->|"plain HTTP / LAN"| APP
  APP --> PG
  APP --- VOL
```

## Why it's shaped this way

- **Single service, same-origin** → no CORS, cookies stay httpOnly/SameSite, one thing to
  deploy and back up.
- **Single-tenant (one deployment per station)** → data isolation is trivial; config is one row.
- **Backend is the only egress** → external API credentials never touch the browser, and every
  outbound call is SSRF-guarded and cacheable.
- **Append-only, hash-chained history** → the incident record is tamper-evident and replayable,
  suitable as a legal record.
- **The server observes, devices never write observations** → a vehicle's arrival, the weather
  and a new Divera alarm are facts about the world, not about a screen: one writer, stamped with
  the time of the fact, whether or not any device is awake (see above).
- **Bundle nothing station-specific** → clean open-source posture; each station brings its own
  branding, config, and geodata.
