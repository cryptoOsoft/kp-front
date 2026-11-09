# STATION DATA – configure a brigade deployment

KP Front runs without station data, but a field-ready deployment normally adds its own
branding, map defaults, reference layers, object plans, checklists, and integrations. Keep
that material in a **separate private repository** and load it into the deployment with the
generic tools in this repository.

The private repository is not a KP Front fork or runtime dependency. It is the station's
reviewable source of truth for configuration and licensed or operational data.

> **You do not have to work this way.** Every kind of data below can also be entered in the
> browser at `/admin`, one item at a time – a map layer on **Kartenebenen**, an Einsatzobjekt and
> its Modul-PDFs on **Objektpläne**, a checklist template and its diagram pages on
> **Checklisten**, the config on the Station pages, and the list-shaped data (Mannschaft,
> Dienstgrade, Fahrzeuge, Mittel, Quellen, Partnerorganisationen, Symbolfelder) through the
> **Arbeitsmappe** `.xlsx`. Most stations run entirely that way and never create the repository
> this page describes.
>
> This page is for the other case: **the whole library in one reviewable, repeatable run.** A
> manifest is what you want when the data is licensed and its provenance has to be recorded, when
> a second deployment has to come up identically, when an importer regenerates it from a GIS
> export, or when you want the change reviewed before it is live. The two doors write the same
> rows, so you can mix them.

**What you need:** a workstation with a checkout of this repository and
[`uv`](https://docs.astral.sh/uv/), because every command below is `cd backend && uv run python -m
app.admin_*`. The station server needs neither – it stays Docker-only and receives the data over
HTTPS with `push` ([Load it](#load-it--push-to-a-station-load-on-a-developer-machine)).

## Start from the synthetic example

[`examples/demo-data/`](../examples/demo-data/) is the public, working example of the same
pattern. Copy it outside the KP Front repository, replace the synthetic content, and keep the
new repository private:

```text
kp-front-data-muster/
  config.json
  report-logo.png          the brandmark, loaded into the `logo` / `reportLogo` slots
  geodata.manifest.json
  hydrant.geojson          the GeoJSON the manifest names – flat, next to it
  wasserleitung.geojson
  objects.manifest.json
  plans/<object-id>/
  checklists.manifest.json
  checklists/
  tafel.manifest.json      the Tafel's pages (board-template/1) – the example points at the bundled
                           FKS set in src/data/boardTemplates/; your copy names its own page files
  load.sh                  the whole sequence, in order – the example's `load`s into a dev
                           database; a station's own script runs the same steps with `push`
  gen_water.py             optional source-specific importer, beside what it writes
  incident.workspace.json  demo only: the live demo's baked Lage/Plan scene (app.demo_reset)
  README.md                what each file is and which CLI loads it
```

That is `examples/demo-data/` as it actually is – flat, because every manifest path is relative
to its own manifest file and a folder buys nothing. Nest them if you prefer; adjust the manifest
paths to match.

Use the CLI examples and schemas as the authoritative starting point:

```bash
cd backend
uv run python -m app.admin_config example
uv run python -m app.admin_geodata example
uv run python -m app.admin_objects example
uv run python -m app.admin_checklists example
```

(`admin_branding` has no `example`/`schema` – its input is an image file. Its five slots are
`logo`, `reportLogo`, `favicon`, `iconPng192` and `iconPng512`; the last two are the installed
app's home-screen icons and must be square PNGs – [`CONFIGURATION.md` §3a](CONFIGURATION.md).)

The complete field contract, including accepted properties and formats, is in
[`CONFIGURATION.md`](CONFIGURATION.md).

## What belongs in the private repository

| Data | Typical source | KP Front input (as-code) | The browser instead |
| --- | --- | --- | --- |
| Identity, map, fleet, doctrine, Dienstgrade | Station decisions | `config.json` | the Station pages; Dienstgrade + Fahrzeuge also via the **Arbeitsmappe** |
| Brandmark and Rapport letterhead | The Wehr's own logo | SVG or PNG, loaded per slot with `admin_branding` | Station › Station & Karte |
| Hydrants and utility layers | GIS exports, WFS/WMS, open data | WGS84 GeoJSON + `geodata.manifest.json` | Station › **Kartenebenen** (one layer; a replace bumps the version in place) |
| Einsatzobjekte | Object register or plan library | `objects.manifest.json` | Station › **Objektpläne** (no UUID typed – see below) |
| Object plans | Approved pre-incident plans | PDF files referenced by the object manifest | Station › **Objektpläne**, per Modul slot |
| Checklists, playbooks and Anleitungen | Station doctrine, device manuals | Template JSON, optional images, and `checklists.manifest.json` (format: [`CONFIGURATION.md` §9f](CONFIGURATION.md#9f-admin_checklists--checklist-templates)) | Station › **Checklisten**, incl. image assets and deletion |
| The Tafel's pages (FKS «Erste Führung» …) | The station's copy of the bundled FKS set | `board-template/1` JSON + `tafel.manifest.json` (format: [`board-templates.md`](board-templates.md)) – a station set REPLACES the bundled one | Station › **Tafel-Vorlagen** |
| Mittel, Quellen, Partnerorganisationen, Symbolfeld-Optionen | Station decisions | `config.json` | the **Arbeitsmappe** `.xlsx` – there is no form for these ([`CONFIGURATION.md` §9h](CONFIGURATION.md#9h-the-station-workbook--one-xlsx-for-the-list-shaped-data)) |
| Mannschaft | Divera sync, or the station's own list | – **personal data: keep it out of the repo unless the repo is as protected as the roster is** | Divera sync, a CSV import, or the **Arbeitsmappe** ([`CONFIGURATION.md`](CONFIGURATION.md) §4a/§4b) |
| Source adapters | GIS, DMS, or roster-specific APIs | Optional scripts maintained by the station | – |

Do not copy restricted data into KP Front itself. Record the source, licence, refresh owner,
and refresh frequency in the private repository. Source-specific importers also belong there;
the public app only defines and validates their output formats.

## Validate before loading

Validation is offline and does not change a deployment:

```bash
cd backend
uv run python -m app.admin_config validate ../../kp-front-data-muster/config.json
uv run python -m app.admin_geodata validate ../../kp-front-data-muster/geodata.manifest.json
uv run python -m app.admin_objects validate ../../kp-front-data-muster/objects.manifest.json
uv run python -m app.admin_checklists validate ../../kp-front-data-muster/checklists.manifest.json
```

Important boundaries:

- Map GeoJSON must use WGS84 `[longitude, latitude]`. The app never reprojects: LV95-looking
  coordinates are **rejected**, so convert them in your own importer first.
- Every manifest path is relative to its manifest file.
- IDs must remain stable across refreshes so objects and layers update in place.
- **The two doors address the same Einsatzobjekt, and you write a `key`, not a UUID.** The browser
  form on **Objektpläne** takes the same human `key` a manifest does (`schulhaus-dorfmatt`) and
  hashes it to the identical uuid5 the CLI derives, showing the derived id live – so an object
  created in the browser is *updated* by a later manifest run carrying the same key, and not
  duplicated. Case and surrounding whitespace are ignored on both sides.
  ⚠️ A manifest entry may carry an explicit `"id"` UUID instead, and `examples/demo-data/objects.manifest.json`
  does – that is the shape a **generated** manifest has, where the importer wrote back the uuid5
  it derived. Never invent one by hand, and never copy the example's: a reused or mistyped UUID
  creates a second Einsatzobjekt instead of updating the first
  (`backend/app/admin_objects.py` · `ObjectEntry.id`). Hand-maintained manifests use `key`.
- Only data that the station may redistribute to its operators should be loaded.

## Load it – `push` to a station, `load` on a developer machine

**The order matters in one place: branding after the config, never before** – why, in
[`CONFIGURATION.md` §9a](CONFIGURATION.md#9a-what-all-of-them-share). Everything after that is
independent.

[`examples/demo-data/load.sh`](../examples/demo-data/load.sh) is the worked version of exactly
this sequence, written with `load` against a dev database. A station's own script is the same
steps in the same order with `push` (below):

```text
1  admin_config      config.json
2  admin_branding    logo / reportLogo        ← after the config, never before
3  admin_geodata     geodata.manifest.json
4  admin_objects     objects.manifest.json
5  admin_checklists  checklists.manifest.json
6  admin_board_templates  tafel.manifest.json
7  seed_personnel    ⚠️ demo only – see below
```

⚠️ **Step 7 is not a station step.** `app.seed_personnel` inserts the **synthetic Musterdorf
crew** (`app/demo_reset.py` · `DEMO_PEOPLE`) so a demo or a dev database has people for
Anwesenheit and Schichtenplanung. It reads nothing from your repository and there is no
station-data equivalent of it: a real crew arrives from the roster provider, a CSV import on
**Personal**, or the Arbeitsmappe – [`CONFIGURATION.md` §4](CONFIGURATION.md). It is additive and
harmless (existing names are left alone, nothing is deleted), but running it against a station
deployment puts 28 invented people in the roster. Leave it out of your own script.

Which verb belongs where is [`CONFIGURATION.md`
§9a](CONFIGURATION.md#9a-what-all-of-them-share); below is what each one looks like.

### To a station, from a workstation (`push`)

This is the way to load a station deployment. **Postgres is deliberately not reachable from
outside the compose network**, so there is no "connect to the deployment database from your
laptop" path, and the server needs no toolchain: `push` sends the files to the running
deployment's API. All six CLIs have it.

```bash
export KP_BASE_URL=https://kp-front.example.ch
export KP_ADMIN_SECRET='<deployment admin secret>'

cd backend
uv run python -m app.admin_config     push ../../kp-front-data-muster/config.json
uv run python -m app.admin_branding   push logo       ../../kp-front-data-muster/report-logo.png
uv run python -m app.admin_branding   push reportLogo ../../kp-front-data-muster/report-logo.png
uv run python -m app.admin_geodata    push ../../kp-front-data-muster/geodata.manifest.json
uv run python -m app.admin_objects    push ../../kp-front-data-muster/objects.manifest.json
uv run python -m app.admin_checklists push ../../kp-front-data-muster/checklists.manifest.json
uv run python -m app.admin_board_templates push ../../kp-front-data-muster/tafel.manifest.json
```

`push --dry-run` authenticates and reports without writing – on **five** of the six.
⚠️ `admin_branding` is the odd one out twice over: it has no `--dry-run` (its input is one image
file, so there is nothing to preview), and its secret flag is `--secret`, not the
`--admin-secret` the others take. `KP_ADMIN_SECRET` / `KP_BASE_URL` from the environment work
for all six, which is why the block above needs neither flag.

`admin_config` refuses a push that
would **empty** a section that currently has content – that is what publishing a stale file looks
like – and `--force` is how you say you meant it. Every write keeps the document it replaced;
`admin_config history` / `restore <id>` is the way back. Details:
[`CONFIGURATION.md`](CONFIGURATION.md) §9. `admin_objects` refuses a push none of whose object ids
the deployment has, while it already has objects – that push would duplicate every one of them
(a manifest from another id scheme) – and `--allow-create` is how you say they really are new.

### On a developer machine or a dev database (`load`)

`load` writes straight to the database in `DATABASE_URL` and to the local media folder. That
fits `just dev` and the demo. It does **not** fit a Docker-only station server: the host has no
`uv`, and inside the container your files are not there
([`DEPLOYMENT.md` §4](DEPLOYMENT.md#running-the-clis-on-a-host-that-has-only-docker)). Use `push`
for a station.

```bash
cd backend
uv run python -m app.admin_config     load ../../kp-front-data-muster/config.json
uv run python -m app.admin_branding   load logo       ../../kp-front-data-muster/report-logo.png
uv run python -m app.admin_branding   load reportLogo ../../kp-front-data-muster/report-logo.png
uv run python -m app.admin_geodata    load ../../kp-front-data-muster/geodata.manifest.json
uv run python -m app.admin_objects    load ../../kp-front-data-muster/objects.manifest.json
uv run python -m app.admin_checklists load ../../kp-front-data-muster/checklists.manifest.json
uv run python -m app.admin_board_templates load ../../kp-front-data-muster/tafel.manifest.json
```

`/admin` writes the same rows through forms and uploads, and most stations do everything there.
Object plans, geodata and checklists are **not terminal-only** – each has its own admin page
for a single item, and the two doors are interchangeable. This repository is for the parts that
want to be reviewable and repeatable: the whole library in one run, a manifest an importer
regenerates, a second deployment that has to come up identically, and the handful of fields no
form exposes (a layer's `nightColor` / `opacity` / `maxzoom` / `symbol` / `autoActivate`,
`mittel.units`, `alarmKeywords`, `roster.source`, `mittel.catalogue[].when`,
`fleet.vehicles[].winfapAlias` – where the form-less ones are set:
[`SETUP.md` §3](SETUP.md#what-still-needs-a-file)).
Never commit database URLs, admin secrets, API credentials, personal rosters, or operational data
to the public repository.

## Definition of ready

⚠️ **Ready is not the same as complete.** Nothing below asks for a full inventory, and none of
these lists has to be finished before the app is worth running – see *You do not owe anyone a
complete inventory* in [`SETUP.md`](SETUP.md) §4. A station with a dozen Mittel, four vehicles
and the handful of objects it actually gets sent to is ready; the rest arrives when a real
Einsatz shows what was missing.

A technical owner should be able to confirm all of the following:

- `/ready` reports both database and storage as healthy.
- `/api/config` shows the intended station identity and map defaults.
- A known hydrant or reference feature appears at the expected location.
- An incident at a known object offers the correct plans.
- Station checklists open and remain available after preparing the device for offline use.
- The seeded account's PIN (`SEED_PIN`) has been changed after the first login, and
  `ADMIN_SECRET` – generated by `setup.sh`, there is no default – is kept where the station's
  admins can find it.
- Data provenance, permissions, refresh commands, and recovery ownership are documented privately.

This is the same boundary used by an operational station deployment: public application code,
private station inputs, repeatable validation, and an explicit load or push step.
