# Documentation

This folder holds KP Front's longer-form documentation: the product concept and the
per-deployment configuration and deployment contracts – the slower-moving "why" and "how".
Day-to-day priorities and plans are discussed in GitHub issues and discussions.

**Status legend:** 🟢 reflects shipped behaviour · 🟡 partially implemented · 🔵 proposed /
not yet built.

## Foundations

The product intent and the "why" (who it's for, the operating model, the standalone
requirement) now live in the [root README](../README.md).

| Doc | Status | What it is |
| --- | --- | --- |
| [`SETUP.md`](SETUP.md) | 🟢 | **Start here for a new station.** The ordered path from an empty Docker host to a deployment that can run an incident: boot, take over the seeded account, station config, station data, integrations, backups – plus the gotchas that catch people and a pre-field checklist. Links to the reference docs below rather than repeating them. |
| [`AGENT-RUNBOOK.md`](AGENT-RUNBOOK.md) | 🟢 | The same path as `SETUP.md`, stripped to commands – for an automation agent, or a human who wants no prose. The four walls a terminal cannot climb (DNS, the Azure app registration, the Divera portal, the Railway volume), the headless Day-0 sequence (install → verify → admin session → accounts → config-as-code → station data in mandatory order → credentials), machine-readable progress via the `setup` block on `GET /api/system`, and what ongoing maintenance runs itself versus what stays human. |
| [`ARCHITECTURE.md`](ARCHITECTURE.md) | 🟢 | System overview: how the PWA, FastAPI service, Postgres, and external sources fit together, plus where each dataset comes from. A one-page overview drawing ([`architecture.excalidraw`](architecture.excalidraw) → `architecture.svg`), Mermaid diagrams for system context, backend modules, config layers, sync/audit flow, and deployment, the scheduler's jobs, and the station-data CLIs. |
| [`CONFIGURATION.md`](CONFIGURATION.md) | 🟢 | Live data contract for per-deployment configuration: every field of the document, the four config layers (and §0a for developers: where a setting lives, station data never bundled, WGS84 vs LV95), reference-data formats, roster/auth notes, and empty-state rules. Two doors write these rows – forms at `/admin` (where a station normally lives) and the CLIs, for config that should be reviewable, versioned and reproducible on a second deployment. Its §4c publishes the **roster-snapshot contract** – [`roster-snapshot.schema.json`](roster-snapshot.schema.json) and [`roster-snapshot-outcome.schema.json`](roster-snapshot-outcome.schema.json), the versioned shape of a roster file another system publishes and this one reads – polled from a URL or a path once a source is set, with the reading rules (matching, the deactivation hold, the outcome report) byte-identical with KP Rück's, and a stdlib CSV → snapshot generator for stations without an HR system. Its §4d is the **station index** ([`station-index.schema.json`](station-index.schema.json)): one `index.json` listing a station's data files by kind with checksums, so both apps take ONE address – the roster is read through it today, `vehicles`/`groups`/`keywords` are reserved and documented. The alarm-intake payload is pinned separately by [`alarm-intake-conformance.json`](alarm-intake-conformance.json) – the cases KP Rück and this app must answer identically, plus the ones they legitimately answer differently, so a station running both can build its dispatch integration once. |
| [`STATION-DATA.md`](STATION-DATA.md) | 🟢 | Practical path from the synthetic example to a private, field-ready station-data repository: layout, provenance, validation, loading, and readiness checks. |
| [`ALARM-INTEGRATIONS.md`](ALARM-INTEGRATIONS.md) | 🟢 | Alarm in/out for any station: generic `POST /api/alarms` intake (auto-open, idempotent, fail-closed), milestone enrichment (`/api/alarms/milestones`), outbound `alarms.webhooks` on incident-create (payload schema, fail-open), the kp-rueck QR-slip example adapter, and the trust models for the Erfassungs-Poster and the read-only Einsatz-Link (`/l/<token>`, one incident, allowlisted, fail-closed). |
| [`STATS-EXPORT.md`](STATS-EXPORT.md) | 🟢 | API reference for the read-only statistics feed `GET /api/stats/incidents`: auth/token model, params, full field table, consumer notes (WinFAP matching). |
| [`geodata-architecture.md`](geodata-architecture.md) | 🟢 | How per-station reference geodata flows from external sources → a private data repo → the deployment → the map. Mermaid diagrams of the ingest paths (`admin_geodata` CLI / API push / `/admin` → Kartenebenen) and the runtime render. |
| [`objektplaene-architecture.md`](objektplaene-architecture.md) | 🟢 | How the brigade's pre-planned Einsatzobjekte + Modul-PDFs flow from the OneDrive plan library → import/geocode CLI → the deployment, and auto-surface by proximity on incident load. Mermaid diagrams of the importer, refresh path, and runtime render; notes the skipped Modul 4 / 5 (Wasser/PV). Also the optional **pull** – fetching plans from an S3-compatible bucket instead of handing a plan-library system an `ADMIN_SECRET` to push with – and the **pre-computed alignment**: plan revisions, the worker, the admin's approval, what an incident freezes, and **floor packs** – a PDF's pages as the storeys of the Gebäude stack, by hand or read from `§` markers on the sheet. |
| [`plan-markers/`](plan-markers/README.md) | 🟢 | **For whoever draws the station's building plans** (in German, like its reader): the `§` text tags that let a Modul-6 PDF state its own storeys, the join points that stack them, and – with two `§GEO` coordinates – its place on the map, so the Gebäude stack and the map fit arrive with the import instead of being set by hand in `/admin`. Icon set (SVG), Affinity notes, two sample sheets and the script that builds them; `just plan-markers <pdf>` is the dry run. How the server treats what it reads: [`objektplaene-architecture.md`](objektplaene-architecture.md#floor-packs-and--markers--a-pdf-that-says-what-it-is). |
| [`sharepoint-connector.md`](sharepoint-connector.md) | 🟢 | Setting up the **SharePoint pull** at a station, written for a volunteer who has never opened the Azure portal: the app registration, `Sites.Selected` consent, the client secret and its expiry, the per-area folder conventions, and reading the System card when something stops. Read-only and pull-only – nothing is ever written back. Field reference: [`CONFIGURATION.md` §6c](CONFIGURATION.md#6c-sharepoint-pull-the-stations-own-folders-imported-on-a-schedule). |
| [`object-visits.md`](object-visits.md) | 🟢 | **Objektbesuche** (optional module, off by default; live since 2026-10-03): the technical contract the backend, the field app, the admin and an outside organizer build against – ids, the visit document, the field/organizer/admin APIs, the `objectVisits` config section, and the one-way delivery outbox. Setting up a SharePoint destination: [`object-visits-sharepoint.md`](object-visits-sharepoint.md). |
| [`karte-objekte.md`](karte-objekte.md) | 🟡 | **Karte & Objekte** (from 2026-10-16): the station reference viewer outside an Einsatz – who may read it, the two station reads (`/api/reference/objects`, `/api/reference/building`), how an object kind, a plan's code, floors and «auf der Karte» are derived, the `/karte` viewer (what it reuses, its own view state, containment-only outlines, search ranking, the hand-over to Objektbesuche) and the rules that keep a register hint from posing as an object's fact. |
| [`divera-connector.md`](divera-connector.md) | 🟢 | Setting up the **Divera 24/7** integration at a station: the two accesskeys and why they are not the same one, the alarm webhook (primary) beside the server's poll (fallback: every 30 s while no Einsatz runs, 120 s while one does), what happens when an alarm lands – including the 4 h split-dispatch guard – the nightly Mannschaft sync with `roster.autoSync`'s three levels, and the alarm's Rückmeldungen shown as «Anrückend» in the Anwesenheit. Read-only: KP Front never writes to Divera. Portal specifics are quoted from Divera's own documentation where verifiable and stated as an outcome where the UI is tier- or version-dependent. |
| [`DEPLOYMENT.md`](DEPLOYMENT.md) | 🟢 | Self-hosting / deployment guide: docker-compose quick start (HTTP or auto-HTTPS), config split, updating, backups, data-protection operating notes, and troubleshooting. Tested on a VPS; runs alongside the Railway deployment. |
| [`RUNNING-BOTH.md`](https://github.com/feuerwehr-oberwil/kp-rueck/blob/main/docs/RUNNING-BOTH.md) | 🟢 | **Lives in the kp-rueck repo** (one copy, so the two can't drift). For stations running KP Front *and* KP Rück on one host: the three places two independent stacks collide – host ports (only one can own 443), `PUBLIC_URL` meaning something different in each, and per-deployment alarm secrets with non-interchangeable payloads. |
| [`API.md`](API.md) | 🟢 | HTTP API reference for integrators/contributors: same-origin `/api/*` surface, auth (PIN/JWT + admin-secret), endpoint groups, the config/data CLIs, and where the committed [`openapi.json`](openapi.json) / dev `/docs` live. |
| [`verlauf-coverage.md`](verlauf-coverage.md) | 🟢 | Which operator actions reach the **Verlauf**, which only reach the hash-chained audit/replay stream, and which reach neither. Names the deliberate silences (Zeitplan, Checklisten, drawing edits), the four rows a changed **Georeferenz** writes and which of them earn a ↶, what the replay's two views need from the stream (the anchor-flip pair, `board.move`, and the re-bake that deliberately emits nothing), and the remaining gaps – incident-data corrections, hose-line renumbering and single Plan-annotation deletes are audit-only. Read before assuming something is on the record. |
| [`trupp-naming.md`](trupp-naming.md) | 🟢 | Design record (2026-09-12) for the **Trupp identity** (`Trupp N`, one sequence per incident including unlinked chips), how the leader stays primary on board and map with the number as a badge, the `crew` reading that gives the Rapport a reconstructable crew history, the one journal row shape and the « / » crew separator. Implemented the same day; the page maps each decision to its code. §7 (2026-09-25): two devices minting the same number at once are settled by the merge. |
| [`SOURCEMAPS.md`](SOURCEMAPS.md) | 🟢 | Turning a minified field stack from the `kpfront.clienterror` log line into source positions: the hidden sourcemaps every build writes, taking them from the server or from a rebuild of the reporting build (`scripts/symbolicate.mjs`), and what makes a rebuild line up. |
| [`glossary.md`](glossary.md) | 🟢 | German domain-term glossary (Lage, Verlauf, Atemschutz, …) for non-German contributors. |

## Conventions by topic

The rules that span modules, moved out of [`AGENTS.md`](../AGENTS.md) on 2026-10-08 and
2026-10-18 (wording unchanged). `AGENTS.md` keeps what every change has to know and points here; a rule about one module
lives in a comment at the top of that module.

| Doc | Status | What it is |
| --- | --- | --- |
| [`sync-and-offline.md`](sync-and-offline.md) | 🟢 | The model (IndexedDB vs localStorage, «saved» = every queue acknowledged, merge by id and `MERGE_POLICY`, passenger kinds, `newId` ids, append-only rows, the server observing), the review regression contracts of 2026-10-02, the closed Einsatz (what still writes, what is refused and parked, every device hearing the close, why there is no offline reopen) and derived ids for what every device observes. |
| [`undo.md`](undo.md) | 🟢 | The rule (every mutating op undoable, what is deliberately not), how an act joins the one undo timeline (delegating, closure, confirm-with-undo toast), the counter-rows the Rapport prints, and what a remote merge invalidates. |
| [`tactical-objects.md`](tactical-objects.md) | 🟢 | Lage ↔ Plan parity and the shared editors, the generated symbol pack, one object on two surfaces: the sheet body as anchor, the last hand-placement owning the truth, machine writes that never flip an anchor, presentation, the measured aspect, the accepted limitation, attachments across documents, the word «twin». |
| [`building-card.md`](building-card.md) | 🟢 | The **Gebäude** chip on the Karte and in the plan's chip row, opening its card (since 2026-10-09): GWR facts + BFE PV by EGID as «Register-Hinweis», the Einsatzobjekt's Sofortmassnahmen/Bemerkungen (`measures`/`remarks`, manual), the last Objektbesuch; per-source failure and the offline copy; the card opening by itself the first time a device shows the Karte (since 2026-10-10). |
| [`plans-and-buildings.md`](plans-and-buildings.md) | 🟢 | Prepared Gebäude floors and their frozen binding, automatic alignments and their approval and what a running Einsatz freezes, the tile pyramid and its pdf.js fallback. |
| [`ui-conventions.md`](ui-conventions.md) | 🟢 | Tokens, the numbered `src/styles/` cascade, the scales and the style-debt ratchet, breakpoints, editor sheets (one control per kind of question), the button components, overlays (the `src/lib/overlays/` primitives, what stays hand-rolled) and the three phone shapes, the button spec (corner, messages, the floating family, materials, selected, primary, delete, close, fields, small roles) and the touch vocabulary. |
| [`phone-layout.md`](phone-layout.md) | 🟢 | The phone's two bottom bars, the page heads and what a page looks like on a phone. |
| [`atemschutz-board.md`](atemschutz-board.md) | 🟢 | The Trupps board: the one card every board wears, section heads, the Trupp form and its questions, the Sicherungstrupp, the Atemschutznotfall, the Abschluss and what the record keeps. |
| [`copy-and-wording.md`](copy-and-wording.md) | 🟢 | The copy mechanics (`appConfig.copy`, German first, `Localizable` overlays, locale per deployment, the two caveats) and which word a screen uses: Karte/Kroki, Geschoss/Arbeitsfläche, Verlauf/Eintrag, Entfernen vs gelöscht, the two failure shapes, «leeren», search placeholders. |
| [`board-templates.md`](board-templates.md) | 🟢 | The Tafel's pages: the page strip, a page as one board anno with its template snapshot, the spreadsheet keyboard, entries reordered by hand, repeatable pages, the live mini Karte, how each page prints – and how a station writes and publishes its own `board-template/1` set (it replaces the bundled FKS one). |
| [`rapport.md`](rapport.md) | 🟢 | What the Rapport's figure pages carry: the Kroki as the picture, opt-in Objektpläne, the Gebäude section, legend lines, one figure-page template, server-coupled Leitung ends – and how it is signed on the screen. |
| [`presentation.md`](presentation.md) | 🟡 | The **Präsentationsmodus** (from 2026-11-05): one editor presents, devices and view-link holders follow the surface and section and point with fading named rings; nothing but «gestartet/beendet» reaches the record; the in-memory broker on the live-wait long poll, how it ends (Beenden, takeover, close, 60 s quiet), who may send what. |
| [`roles-and-access.md`](roles-and-access.md) | 🟢 | The incident roles (`editor`, `el`, `viewer`), what the `el` may write, the separate deployment admin behind `ADMIN_SECRET`, the Atemschutz-Link allowlist and the link-session rules. |
| [`microsoft-login.md`](microsoft-login.md) | 🟢 | Optional **«Mit Microsoft anmelden»** (since 2026-10-09) onto existing named accounts: what to register in Entra (redirect URI, delegated `openid profile`), the four credentials, the allow-list format. Off unless all four are set; the PIN is never replaced. |

## Testing ([`testing/`](testing/))

Printable/manual verification material for internal release checks and training-table validation.

| Doc | Status | What it is |
| --- | --- | --- |
| [`testing/ci.md`](testing/ci.md) | 🟢 | CI execution and local validation: tests, ratchets and holds (lint baseline, coverage floor, bundle budget, the jsdom hold, the e2e guard, the visual and performance gates), critical-module mutation testing and its runner canary, the branch-protected gate, parallel static/coverage/backend checks, one production image shared by isolated browser suites, stable required checks and measuring turnaround. |
| [`testing/manual-limit-test-cards.md`](testing/manual-limit-test-cards.md) | 🟡 | Printable manual test cards for release confidence, limit-finding, offline/sync drills, 118 Magazin Kroki replays, tabletop-game scenarios, report/print checks, and field ergonomics. |
| [`testing/fat-incident.md`](testing/fat-incident.md) | 🟢 | Does a **large or long Einsatz** make the app worse? The synthetic fat incident (calibrated against the busiest real ones), `pnpm bench` for the pure hot paths and `just fat-perf` for a real backend plus a CPU-throttled browser, how to read the numbers, and the first recorded run (2026-09-26): a long Einsatz costs nothing on the device, 10× the busiest real one is fine, the first limit is the Karte's DOM markers at a few hundred symbols, and snapshot storage grows with blob size × saves, which is why snapshots have been stored gzipped since then. |
| [`testing/perf-journeys.md`](testing/perf-journeys.md) | 🟢 | Did this change make the app **slower**? CI walks what a crew does on the busiest Einsatz on record (cold start through the kiosk, a reload, every surface, Linien and Absperrkreise, Meldungen, Funkkontakte, an idle minute) and gates requests, bytes, writes, memory left behind and interaction times against a baseline from a GitHub runner. How noise is kept out, what to do when the check is red (`just perf-accept`), and what the first walks found. |
| [`testing/visual-regression.md`](testing/visual-regression.md) | 🟢 | Did this change the **look** by accident? CI shoots nine frozen states (Lage, Plan, Trupps, Verlauf, Rapport, kiosk; tablet and phone, one night) and compares them pixel by pixel with committed baselines. How the clock, data, network and fonts are pinned, the threshold and why it is in pixels, what to do when the check is red, and the rules for accepting a baseline (`just visual-accept`, «Visual baselines»). |
| [`testing/restore-drill-2026-07-02.md`](testing/restore-drill-2026-07-02.md) | 🟢 | Record of an actual backup-restore drill (2026-07-02): what was restored, how long it took, and what the drill found. A worked example for a station running its own drill. |

## Historical

- [`../mockups/`](../mockups/) – early look-and-feel explorations (HTML mockups). Kept for
  reference; the chosen direction was "Karte Minimal". Not maintained. Only `app-lage.html` and
  `nav-concepts.html` are tracked – the rest of the folder is deliberately local (`.gitignore`).
  The former `docs/design-concepts/` directory is gone – superseded by the React app itself.

## Not in this repository

Internal working documents – the roadmap, point-in-time audits, feature planning, operating
notes – stay local and are not published. They are snapshots of a moment, they go stale fast,
and a half-finished register of past worries is a worse answer to "is this software any good?"
than the [CHANGELOG](../CHANGELOG.md), the
[known limitations](../README.md#known-limitations), and the
[open issues](https://github.com/feuerwehr-oberwil/kp-front/issues) – all of which are current.

Per-station data (config, rosters, reference geodata, object plans, checklists) is never in this
repository either – see [`STATION-DATA.md`](STATION-DATA.md).

**Two documents every operating station writes for itself**, because they are one Wehr's
decisions and no template could be right for another – the reader would file it instead of
deciding:

- **A data-retention policy** – data type → retention period → reason. Required by
  [`DEPLOYMENT.md`](DEPLOYMENT.md) §6; the answer is your canton's (DSG / IDG) and your
  Kommando's.
- **Operating rules** – who deploys, who holds the backups and has done a restore drill, who
  resets a PIN, what happens during an outage at 03:00.

The technical facts they build on are in [`DEPLOYMENT.md`](DEPLOYMENT.md) (backups, restore,
`.env`), [`PRIVACY.md`](../PRIVACY.md) (what leaves the deployment at all) and
[`verlauf-coverage.md`](verlauf-coverage.md) (what is on the record in the first place).

**Running KP Front and KP Rück at the same station** is documented once, in the sibling project:
[`RUNNING-BOTH.md`](https://github.com/feuerwehr-oberwil/kp-rueck/blob/main/docs/RUNNING-BOTH.md).
One copy on purpose – nothing in it is specific to either repository, and two copies of a document
about two moving systems is two documents to keep true. The two applications stay completely
independent deployments; that guide is only about not doing the shared setup work twice.
