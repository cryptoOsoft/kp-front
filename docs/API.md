# API reference

KP Front's backend is a single FastAPI service that **serves the SPA same-origin** and exposes
its HTTP API under `/api/*`. There is no separate API host and no CORS surface – one deployment
is one station (single-tenant). Most users never touch the API directly: the app is the client,
and per-station setup goes through `/admin` in a browser, or through the
[admin CLIs](#configuration--data-cli) where a station wants its config as reviewable files. This
page is for integrators and contributors.

## OpenAPI schema

The full contract is committed as [`openapi.json`](openapi.json) (regenerate with `just openapi`).

The frontend reads its wire types off the same file: `just openapi` also writes
`src/lib/api/schema.d.ts` (`pnpm openapi:types`, kept fresh by `src/lib/api/schema.test.ts`), and
the types in `src/lib/api/*` are aliases of it (`src/lib/api/wire.ts` · `Out<…>` / `In<…>`), so a
field renamed or retyped on the server fails `tsc` in the client. Where the client deliberately
differs – a field an older cached copy lacks, a field only the device writes – the alias says so
(`CachedWithout`, an intersection). A response the server types only as `dict` stays hand-typed in
the client; a hand-typed request body is checked against the server's model with `Fits`.

Interactive docs (`/docs` Swagger, `/redoc`, `/openapi.json`) are served **in development**. In
production they are **off by default** – set `EXPOSE_API_DOCS=true` to enable them on a deployed
instance for integration work.

| Environment | `/docs`, `/openapi.json` |
| --- | --- |
| dev (`uv run uvicorn …`) | always on |
| production | off, unless `EXPOSE_API_DOCS=true` |

## Authentication

PIN-kiosk flow issuing JWTs as **httpOnly cookies** (single-origin, so no tokens in JS):

1. `GET /api/auth/roster` – public list of login tiles (active users, no secrets).
2. `POST /api/auth/login` `{user_id, pin}` – sets `access_token` + `refresh_token` cookies.
3. `POST /api/auth/refresh` – rotates the pair; `POST /api/auth/logout` revokes them.
4. `GET /api/auth/me` – the current user.

**Two authorization layers:**

- **Incident role** – `editor` (can mutate incident state), `el` (Einsatzleiter function,
  since 2026-09-07: reads everything, writes ONLY the record domains – attendance/shifts/bands,
  mittel, checklists, reportMeta/attachments/reportSignatures – through `PUT …/workspace/record`, plus journal
  rows, record-vocabulary events, media uploads and, since 2026-09-10, the Einsatzdaten
  correction: `PATCH /incidents/{id}` restricted to `EL_META_FIELDS` (title, type, priority,
  text, address, lat, lng, started_at, is_exercise) – the lifecycle fields `status`,
  `is_archived` and `report_done_at` stay editor-only), and `viewer` (read-only). Mutating
  incident endpoints require `editor`; the record slice, journal/event appends, media
  uploads and the Einsatzdaten fields of the incident PATCH admit `el` too.
- **Deployment admin** – the `/admin` surface and admin-write endpoints (config, branding,
  system, user CRUD, geodata/objects) require an **admin session**, unlocked by the deployment
  `ADMIN_SECRET` via `POST /api/admin/login` `{secret}` – separate from the editor PIN, and
  fail-closed when `ADMIN_SECRET` is unset. See [CONFIGURATION.md](CONFIGURATION.md) §5.

## Endpoint groups

| Prefix | Purpose | Auth |
| --- | --- | --- |
| `/api/auth/*` | login / refresh / logout / me; user CRUD (`/users`) | public · admin (user CRUD) |
| `/api/auth/microsoft/*` | optional «Mit Microsoft anmelden»: `start` redirects to the tenant, `callback` sets an ordinary account session – never an admin one ([`microsoft-login.md`](microsoft-login.md)) | public · 404 until configured |
| `/api/admin/*` | admin-session login / logout | secret |
| `/api/admin/session` | whether admin is configured at all and whether this browser holds an admin session – never the secret | public |
| `/api/config`, `/api/branding`, `/api/system` | deployment config (`PUT` needs `If-Match`; `POST /validate` is the dry run; a write that would empty a populated section is 409 unless `?force=true`), branding assets, maintenance status incl. connector states and the `setup` block | read public (config) · admin (writes) |
| `/api/integrations/credentials*` | integration credentials + their audit trail (see below) | admin |
| `/api/integrations/*` (the rest) | the Objektbesuche organizer API: catalogue, objects by the organizer's own ids, visit programmes and lists, the change feed, visits, reports and photos ([`object-visits.md`](object-visits.md)) | organizer key (`Authorization: Bearer`, fail-closed) |
| `/api/station-workbook/*` | the station-data `.xlsx` – export, preview, import (see below) | admin |
| `/api/incidents/*` | incident CRUD, workspace sync, notes, append-only events (`…/{id}/events`, `snapshot`, `samples`, `state`, `verify`); `PUT …/workspace/record` is the record slice an `el` session may write; a workspace save (full, `…/trupps` or `…/record`) stamped with an older `schemaVersion` than the stored blob is **409 `workspace_older_build`** – the slices send `schemaVersion` since 30.10.2026, one without it counts as 3 ([`sync-and-offline.md`](sync-and-offline.md)); whole-incident hard delete is the narrow exception | editor (mutations, incl. deleting an **Übung** created as one) · `el` (record slice, journal, Einsatzdaten, a Lern-Übung: `POST …/lernen` and deleting one) · admin (hard delete of a real, archived Einsatz) |
| `/api/objects/*`, `/api/reference/*` | object library + plans, reference geodata layers; `GET /api/reference/{id}/alignments?v=N` serves the station-approved fit of one plan revision | read auth · admin (writes) |
| `/api/reference/objects`, `/api/reference/building` | «Karte & Objekte»: every station object (key boxes included) with plans, floors and last visit; the Gebäude card's register facts for any point, no incident ([`karte-objekte.md`](karte-objekte.md)) | account sessions + admin · never a link (403) |
| `/api/admin/plan-alignments/*` | the pre-computed plan alignments: list (metadata only – never the building outlines), outline (one sheet’s reference geometry, drawn per review tile), preview (`?thumbnail=true`), approve (with optional corrected pairs), reject, retry, undo, and `PUT …/floors` – the whole Geschoss list of one revision, replaced as one document: each row is a `page` + signed `index` + `part` (a storey drawn in several pieces – two wings of one 1. OG – has one row per drawing, each with its own `clip` and `join`; absent = 0). Nothing reaches an incident before an approval. Every row carries `marker_notes` (list and detail): what this revision's own `§` markers said – `warnings[]` as codes plus `storeys_found`/`storeys_written`/`geo_pairs`, `null` on an unmarked sheet – so a plan that prepared nothing can say why | admin |
| `/api/plan-scales` | the station document (Massstäbe, Georeferenzen, measured sheet aspects); `PUT` carries `If-Match`, a stale token is 409 – a headerless PUT is still accepted for one release | auth |
| `/api/sharepoint/*` | the SharePoint pull: status per area, run now, probe the tenant | admin |
| `/api/media/*` | photo / audio upload + serve | editor |
| `/api/personnel/*`, `/api/divera/*`, `/api/traccar/*` | roster, alarm/roster pull, vehicle GPS | editor |
| `/api/weather`, `/api/geocode` | wind badge, address search (backend-proxied) | auth |
| `/api/overpass/*` | building outlines for «Umrisse», proxied to the Overpass mirrors | auth |
| `/api/georef/*` | `POST /suggest` – automatic plan alignment, streamed as NDJSON; 503 without the `georef` extra | editor |
| `/api/push/*` | VAPID public key, Web-Push subscribe / unsubscribe | auth |
| `/api/alarms`, `/api/firehub/*` | generic alarm intake (`POST /api/alarms`, `…/milestones`) and the FireHub webhook – each auto-opens an incident ([`ALARM-INTEGRATIONS.md`](ALARM-INTEGRATIONS.md)) | `ALARM_WEBHOOK_SECRET` (`?secret=` or `X-Webhook-Secret`, fail-closed) |
| `/api/capture/*` | the Erfassungs-Poster: reachable incidents, roster, the attendance part of the workspace, journal, Rapport-Beilage; `/secret` mints, rotates or disables the poster token | poster token (fail-closed) · admin (`/secret`) |
| `/api/stats/*` | `GET /incidents` – the read-only statistics export ([`STATS-EXPORT.md`](STATS-EXPORT.md)); `/secret` manages its token | stats token (fail-closed) · admin (`/secret`) |
| `/api/object-visits/*` | Objektbesuche field API: catalogue, visits, attachments, revisions, report PDF | auth (writes per `objectVisits.captureRoles`; never a link session) · admin (read) |
| `/api/admin/object-visits/*` | Objektbesuche admin view: every visit, the delivery outbox and retry, notify settings, destination test, ZIP export | admin |
| `/api/incidents/{id}/report/pdf`, `…/tafel/pdf`, `…/zeitplan/pdf` | `POST` – render the Einsatzrapport, the Tafel and the Zeitplan as PDF (read-only output) | auth |
| `/api/incidents/{id}/presentation` | the Präsentationsmodus: `GET` the live poll (`client`, `known`, `since`, `wait=1`), `POST` start, `DELETE` end, `POST …/signal` join · leave · view · pointer – in memory, never stored ([`presentation.md`](presentation.md)) | auth (poll, signal – the view and alarm links too) · editor (start, end) |
| `/api/incident-link/*` | exchange an alerting system's link token for a read-only session on one incident (`/l/<token>`); the two **standing** links – the Stations-Terminal (`/l/t<secret>`, enrolls a device cookie) and the fixed Atemschutz URL (`/l/s<secret>`) – bind to whichever Einsatz is open; key management and rotation for all three | station keys (session) · admin (keys) · fail-closed |
| `/api/diag/client-error` | client error sink (bounded, logged at WARNING) | none |
| `/api/diag/export` | the Diagnose-Datei: the last 50 sanitised crashes, to attach to a bug report | auth (never a link session) |
| `/api/diag/telemetry*` | telemetry status (incl. the queued payloads verbatim), consent on/off, install-id rotation | admin |

The exact request/response shapes are in [`openapi.json`](openapi.json) / the live `/docs`.

**`POST /api/incidents/lernen`** – the «Üben» door (05.11.2026). Body `{ "tutorial": "<id>" }`, one
of the tutorials that run on a seeded Übung (`LernUebungIn`; anything else is 422). Answers
`IncidentFull` plus `reused`: the station's newest OPEN Lern-Übung (`source='training'`, Übung
since creation, title «Lernen ·») renamed to this tutorial with its workspace kept, or – only
when there is none – a new one, seeded around the station's map centre with its roster
(`backend/app/tutorial_seed.py`) and audited as `incident.create`. Editor and `el`; 403 in the
demo and for every other session. Who may delete or change it: [`roles-and-access.md`](roles-and-access.md) › «Üben».

**Three routes outside `/api/*`**, all unauthenticated because the caller has no session to
offer – a container runtime, a monitor, or the browser itself:

| Route | Purpose |
| --- | --- |
| `GET /health` | liveness, static by design. Returns `status`, `service`, `version` **plus `commit` and `built_at`** – the build, not just the release, so a from-source `main` is distinguishable from a three-day-old published image (`Settings.build`) |
| `GET /ready` | readiness: probes the database *and* the storage volume. Point container and platform healthchecks here – `/health` reports ok with an unreachable database |
| `GET /manifest.webmanifest` | the PWA manifest, **generated per deployment** rather than served from `dist/`: the build-time file is the base and the station's `identity.appName`, `locale`, `accentColor` and app icons are overlaid on it. Never 500s (any garbage degrades to the built manifest), never cached, never authenticated |

## Integration credentials – `/api/integrations/*`

The integration settings a station may set from `/admin` → Anbindungen instead of `.env` –
exactly the fields in `FIELDS` in [`backend/app/credentials.py`](../backend/app/credentials.py):
the Divera keys, Traccar, VAPID, STT, CARTO, the alarm webhook secret, the print agent secret, the monitor
ping URL, the
three Azure app registrations (SharePoint pull, SharePoint export, Microsoft sign-in), the
Objektbesuche organizer key, the station index and the roster snapshot. Stored encrypted
(AES-256-GCM, key derived from `SECRET_KEY` via HKDF) and live without a restart. Contract and
reasoning: [`CONFIGURATION.md` §6](CONFIGURATION.md#6-environment-variables-secrets--infra--operator-not-admin).

| Route | Purpose |
| --- | --- |
| `GET /api/integrations/credentials` | every settable credential and where it comes from – `CredentialState[]` |
| `PUT /api/integrations/credentials/{name}` | set or replace one – body `{ "value": "…" }` (1–2048 chars) |
| `DELETE /api/integrations/credentials/{name}` | clear the stored value; the integration falls back to off |
| `GET /api/integrations/credentials-audit` | `?limit=` (default 30, capped at 200) – `CredentialAuditEntry[]`: `name`, `label`, `action`, `source`, `at`, `by` (null = nobody was signed in behind it), newest first. **The record, never the values.** |

All four require an **admin session** – the same `ADMIN_SECRET` gate as the rest of `/admin`,
not the editor PIN. `{name}` is the lowercase field name (`divera_access_key`,
`vapid_private_key`, `alarm_webhook_secret`, …); an unknown one is `404`.

Three rules the shapes encode:

- **Secrets are write-only.** `CredentialState` carries `configured` and `source`
  (`env` | `stored` | `unset` | `unreadable`), and `value` **only** for a field flagged
  non-secret (`secret: false` – URLs and sources, public keys, Azure tenant/client ids, the STT
  model and language, the CARTO browser key, the Microsoft-login allow-list; the list is
  `FIELDS`). There is no admin level at which a Divera key becomes readable – setting and
  rotating from a phone at 3am beats SSH, exfiltrating from one does not.
- **`.env` wins.** A field the environment supplies reports `source: "env"` and refuses both
  `PUT` and `DELETE` with **409**, naming the env var in `CredentialState.env` so the page can
  say where the value comes from. "Supplied" means *differs from the declared default* – a
  compose passthrough that materialises the app's own default (`STT_MODEL`, `STT_LANGUAGE`) is
  not a deployer decision. Which variables `docker-compose.yml` passes:
  [`CONFIGURATION.md` §6](CONFIGURATION.md#6-environment-variables-secrets--infra--operator-not-admin).
- **`unreadable` is not `unset`.** A row that will not decrypt (i.e. `SECRET_KEY` was rotated)
  reports `source: "unreadable"` and `configured: false`, so the operator is told to set it
  again rather than sent looking for a setting they already made.

## Station workbook – `/api/station-workbook/*`

One `.xlsx` a station downloads, edits and uploads back; sheets `Mannschaft`, `Dienstgrade`,
`Fahrzeuge`, `Mittel`, `Mittel-Bestände`, `Quellen`, `Partnerorganisationen`, `Symbolfelder`.
**Admin session on all three routes**, and **upsert only** – there is no replace mode and no
mode parameter to add one to. What it does and does not cover:
[`CONFIGURATION.md` §9h](CONFIGURATION.md#9h-the-station-workbook--one-xlsx-for-the-list-shaped-data).

| Route | Request | Response |
| --- | --- | --- |
| `GET /api/station-workbook/export` | – | the `.xlsx` bytes (`application/vnd.openxmlformats-officedocument.spreadsheetml.sheet`), `Content-Disposition: attachment; filename="stationsdaten-<YYYY-MM-DD>.xlsx"`. ⚠️ `openapi.json` types this `200` as JSON with an empty schema – that is FastAPI's default for a bare `Response`, not the contract |
| `POST /api/station-workbook/preview` | `multipart/form-data`, `file` | `WorkbookPreview` – **writes nothing** |
| `POST /api/station-workbook/import` | `multipart/form-data`, `file` + optional `digest` | `WorkbookImportResult` |

`WorkbookPreview` is the confirmation screen's whole payload: `sheets[]`, `errors[]`,
`warnings[]`, `emptied[]`, `digest`, `ok`. One `SheetImpact` per sheet carries `sheet`,
`present`, `rows`, `created`, `updated`, `unchanged`, `removed[]` (named, capped at 8),
`removed_total` and `removal_kind` – `"removed"` | `"deactivated"` | `"none"`. Those last two
words are the contract, not phrasing: a person missing from `Mannschaft` is **deactivated**
(closed incidents resolve names through the row), an id missing from an id-keyed sheet is
**removed**. A sheet that is not in the file at all comes back `present: false` and changes
nothing.

`digest` is the SHA-256 the preview reported for the bytes it read. Sent back to `import` it is
verified against the uploaded file and a mismatch is **409** – the file was edited between
preview and confirm. It is deliberately **optional**, so a script may import without previewing;
the confirm handshake is an operator guarantee, not an enforced protocol. `import` is
all-or-nothing (`ok: false` → **400**, nothing written), and every write that changes the
**config** keeps the document it replaced under source `workbook`, so «Letzte Änderungen» can undo
that half.

⚠️ **The Mannschaft half is not covered by config history.** Personnel live in their own table;
`keep_previous` runs only when a config section actually changed, so a Mannschaft-only import
writes no history row at all. What limits the damage instead: a person missing from the sheet is
**deactivated, never deleted** (past incidents still reference them), so the reverse is a
re-activation rather than a recovery. The undo for the roster is the export taken **before** the
import.

Refusals: a filename not ending `.xlsx` → **400**, an empty file → **400**, over
`MAX_UPLOAD_MB` → **413**. Refused rows come back in `errors[]` as
`«<Blatt> Zeile <N> – <reason>»`, or `«Blatt <Blatt> – <reason>»` where the fault is the sheet
rather than one row (header mismatch, dropping a `Quelle` stock still points at, dropping a
`Dienstgrad` somebody still carries).

## Configuration & data CLI

Per-station config and reference data can be **config-as-code**, applied with six sibling CLIs
(run from `backend/`, or prefixed with `docker compose exec app` on a Docker-only host; `just
config-*` / `geodata-load` / `objects-load` wrap the common ones). Each of the six now also has a
browser equivalent for one item at a time – see
[`CONFIGURATION.md` §9](CONFIGURATION.md#9-loading-station-data-with-the-admin-clis) for which
door to use when:

| CLI | Manages | Example |
| --- | --- | --- |
| `python -m app.admin_config` | the `deployment_config` document (identity, map, fleet, doctrine, roster, …) | `just config-example`, `just config-load <file>` |
| `python -m app.admin_branding` | branding assets – the five slots `logo`, `reportLogo`, `favicon`, `iconPng192`, `iconPng512` | `push reportLogo <file>`, `show` |
| `python -m app.admin_geodata` | reference geodata layers (hydrants, WMS) | `just geodata-load <manifest>` |
| `python -m app.admin_objects` | object library + Modul-PDF plans | `just objects-load <manifest>` |
| `python -m app.admin_checklists` | checklist templates + playbook diagram assets | `validate <manifest>`, `push <manifest>` |
| `python -m app.admin_board_templates` | the Tafel's board templates (`board-template/1`, [`board-templates.md`](board-templates.md)) | `just board-templates-load <manifest>`, `just board-templates-push <manifest>` |

**Which verbs each one has:**

| | `schema` | `example` | `validate` | `diff` | `load` | `push` | `show` |
| --- | :-: | :-: | :-: | :-: | :-: | :-: | :-: |
| `admin_config` | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| `admin_branding` | – | – | – | – | ✅ | ✅ | ✅ |
| `admin_geodata` | ✅ | ✅ | ✅ | – | ✅ | ✅ | ✅ |
| `admin_objects` | ✅ | ✅ | ✅ | – | ✅ | ✅ | ✅ |
| `admin_checklists` | ✅ | ✅ | ✅ | – | ✅ | ✅ | ✅ |
| `admin_board_templates` | ✅ | ✅ | ✅ | – | ✅ | ✅ | ✅ |

`admin_config` also has `history` / `restore`. **All six support `push`** – `admin_config push`
landed in `55c4a94`, so nothing needs a database connection any more. Which verb to use where is
[`CONFIGURATION.md` §9a](CONFIGURATION.md#9a-what-all-of-them-share); the short version is `push`
for a running deployment, `load` only where the database and the storage directory are both the
deployment's own.

### Starting templates

Four manifest/config templates are committed in `backend/`. **Only one of them validates as
committed** – the other three deliberately reference files that are not in this repository,
because the PDFs, GeoJSON and checklist JSON they point at are station data:

| Template | `validate` out of the box | What it still needs |
| --- | --- | --- |
| `config.example.json` | ✅ passes | nothing – but don't edit it in place: it is generated from the built-in template (`admin_config example`) and CI fails on drift. Copy it out of the checkout and edit the copy |
| `geodata.manifest.example.json` | ❌ `layer 'lk-hydrant' file not found: hydrant.geojson` | a WGS84 GeoJSON next to the manifest, or drop the `geojson` entry and keep the WMS one |
| `objects.manifest.example.json` | ❌ `plan 'modul1' file not found: plans/dorfmatt/modul1.pdf` | a `plans/dorfmatt/` folder with the four Modul-PDFs it names |
| `checklists.manifest.example.json` | ❌ `entry 'fu-aktion' template file not found` | three template JSONs under `checklists/` plus the two diagram images |

They are shape references, not runnable starting points. **For something that actually runs,
copy [`examples/demo-data/`](../examples/demo-data/)** – manifests *and* the files they point at,
loaded in the right order by [`load.sh`](../examples/demo-data/load.sh).

Full data contract in [CONFIGURATION.md](CONFIGURATION.md); the station-data workflow is
[STATION-DATA.md](STATION-DATA.md).

### One CLI that is not config-as-code: `admin_visits`

`python -m app.admin_visits` prints the visit counters (`--days N`, `--totals`, `--prune`) —
the terminal half of `GET /api/admin/visits`. It reads only; there is nothing to load or push.

It exists for the **public demo**, which is the one deployment that sets `VISIT_STATS=true`.
Everywhere else the counters are never written, so this prints an empty table for ever. What
is counted, and what deliberately is not, is [`backend/app/visits.py`](../backend/app/visits.py);
the promise made to visitors is [PRIVACY.md](../PRIVACY.md) § «Counting visitors without
recognising them».

### After every Einsatz: `admin_postcheck`

`python -m app.admin_postcheck <incident-id|latest> [--logs app.jsonl] [--http http.jsonl]`
(`just postcheck …`) is the read-only morning-after check. It lists the devices seen, their
crashes and render storms, HTTP errors and 409 bursts, clock jumps, duplicate events, PIN prompts
and the vehicle «vor Ort / verlassen» rows against the GPS. It exits 1 when there are findings.
It never writes: the session is switched to read-only before the first query. `--dump <dir>`
reads a post-mortem's JSON dumps instead of a database. How to get the Railway logs, and what
counts as a finding: [`backend/README.md`](../backend/README.md#the-post-einsatz-check-admin_postcheck).
