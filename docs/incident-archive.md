# Einsatz-Ablage – filing closed Einsätze into SharePoint

Status: 🟡 built 2026-11-11, off by default (`incidentArchive.enabled`). Code:
`backend/app/incident_archive.py` (the module header is the short version of this page),
`backend/app/api/incident_archive_admin.py`, the «Ablage» column of `/admin` › Einsätze
(`src/admin/IncidentHistoryView.tsx`).

When an Einsatz is **closed**, the server copies its material, one way, into the station's
SharePoint: the photos into a photo archive folder, the Rapport-PDF, the Sprachnotizen and the
Beilagen into a report folder – one folder per Einsatz each. KP Front keeps the record; the folders
only receive copies. The copy doubles as the station's off-site backup of its closed Einsätze, so
it retries until it worked, never uploads a file twice and never deletes or overwrites anything
remotely.

It reuses the Objektbesuche delivery's writer and credentials
([`object-visits-sharepoint.md`](object-visits-sharepoint.md)): the `sharepoint_export` app
registration with `Sites.Selected` **write** on the site. Folders on that same site need no second
grant.

## Rules that are easy to break

- **Closing never waits for SharePoint.** The close (`PATCH /api/incidents/{id}` with
  `is_archived: true`) writes one outbox row in its own transaction and nothing else; SharePoint
  down, credentials missing or the module misconfigured changes nothing about closing.
- **An Übung is never filed** (`is_exercise`), neither is an Einsatz that is deleted or still
  running, nor one the auto-archive sweep put away (`alarms.autoArchiveDays` – nobody closed it;
  «Ablegen» in `/admin` files it by hand). An Übung marked real after its close is filed then.
- **A Rapport-Beilage is a document, not a picture.** Photos the Rapport lists as Beilagen
  (workspace `attachments`, «Ausweis Lenker») go to the report folder as «Beilage NN», never into
  the photo archive.
- **Nothing remote is ever deleted or overwritten.** A new Rapport gets a new file
  («Einsatzrapport v2.pdf»); a medium already filed is never sent again; a folder a person moved
  keeps receiving (it is addressed by id).
- **No address in a folder name.** `{stichwort}` is the Einsatz title with the incident's own
  address cut out; `{kategorie}` never carries one.
- **Nothing in the section is secret, but it is internal:** `GET /api/config` serves
  `incidentArchive.destinations` to an admin session only.

## Deployment config – section `incidentArchive`

```jsonc
"incidentArchive": {
  "enabled": false,
  "destinations": [{
    "id": "sharepoint", "kind": "sharepoint", "enabled": true,
    "siteUrl": "https://example.sharepoint.com/sites/Feuerwehr", "library": "Dokumente",
    "photoFolder": "Fotoarchiv/{year}/{date} {stichwort}",
    "reportFolder": "Einsätze/{year}/{date} {stichwort}"
  }]
}
```

Both patterns are paths below the library. **The levels before the first placeholder must exist**
(`Fotoarchiv`, `Einsätze` above – a 404 there is a configuration error, the row fails); the levels
from there on are created as needed.

| Placeholder | Value |
|---|---|
| `{date}` | the alarm date (`started_at`, Europe/Zurich) as `yyyy.mm.dd` |
| `{year}` | its year |
| `{stichwort}` | the Einsatz title without the incident's address (whole, «Strasse Nr» and the bare street name are cut out), at most 60 characters; empty → `{kategorie}` |
| `{kategorie}` | the Einsatz-Kategorie (`incidents.type`), else «Einsatz» |
| `{short}` | the last 4 hex characters of the incident id |

Values are sanitised like the Objektbesuche' (`" * : < > ? / \ |` and leading/trailing dots and
spaces removed): a value never adds a level.

Validation (refused at load and on `PUT /api/config`): `id` lower-case `[a-z0-9_-]`, unique;
`siteUrl` https; patterns plain paths (no `..`, no empty level); only the placeholders above; the
**last level needs a placeholder** (otherwise every Einsatz would share one folder). At most 5
destinations.

## What lands where

```
<photoFolder>   e.g. Fotoarchiv/2026/2026.07.15 Ölspur/
  01 14.32.jpg · 02 14.35.jpg …           photos, in upload order, upload time (Europe/Zurich)
<reportFolder>  e.g. Einsätze/2026/2026.07.15 Ölspur/
  Einsatzrapport.pdf                      the newest Rapport-PDF at the first filing
  Einsatzrapport v2.pdf                   a Rapport of different content filed later (Nachtrag)
  Sprachnotiz 01 14.40.webm …             the Sprachnotizen
  Beilage 01 15.02.pdf · Beilage 02 15.10.jpg …   the Beilagen: kind `file`, and Rapport-Beilagen photos
```

- Originals, byte for byte, as stored (`media.storage_key`). Names carry the number and the
  upload time only – no names of people, no captions. The number counts per kind over what is
  already filed (`remote_items.counters`), so a name once given never goes to another file.
- **The folder is chosen once per Einsatz and pattern** (`remote_items.folders`) and kept: a
  Nachtrag weeks later files into the same folder even after its title changed or a person moved
  it. A folder name another Einsatz (or a person) already uses gets « (2)», « (3)» – two Einsätze
  never share a folder. Nothing is created for a pattern that has nothing to receive.
- **The Rapport-PDF.** The server composes every Rapport-PDF but stores none of them
  ([`rapport.md`](rapport.md) · Decision E) – except, while the Ablage is on, the newest one an
  `editor` or `el` composed for the Einsatz (download or station printer, in reading order):
  `incident_archive_reports`, one per Einsatz, bytes in storage. Its `content_sha` hashes the
  payload without `generatedAt`, so the same Rapport printed twice is one version; a Nachtrag, a
  signature or another option is another. A pass files the kept PDF when its content has not been
  filed yet, as the next version. An Einsatz closed without a PDF is filed without one (the admin
  column says «ohne Rapport-PDF»); a PDF composed afterwards on the closed Einsatz is filed then.
- **What owes a pass:** the close; a photo, Sprachnotiz or Beilage that reaches a closed Einsatz
  (the offline queue after the close); a kept Rapport of new content on a closed Einsatz; an Übung
  marked real on a closed Einsatz; «Ablegen» in `/admin`. What is captured while a reopened Einsatz
  runs is filed at its next close.

## Delivery

- Outbox row per `(destination, incident)` – `incident_archive_deliveries`: `wanted` (bumped by
  each reason above), `state` (`pending|delivered|failed|paused`), `attempts`, `next_attempt_at`,
  `lease_owner`, `lease_until`, `last_error`, `failed_fingerprint`, `delivered_at`, `remote_items`
  (`folders: {<rendered pattern>: {path, id}}`, `media: {<media id>: <drive item id>}`,
  `counters: {photo, audio, beilage}`, `reports: [{sha, version, name, item, composedAt}]`).
- Worker: APScheduler job `incident_archive` every 30 s on the scheduler leader, registered
  unconditionally and idle while the module is off, no destination is enabled or the credentials
  are incomplete. Housekeeping, then claim one due row (`FOR UPDATE SKIP LOCKED`, 10-minute lease),
  upload what `remote_items` does not hold – the Rapport first, then Sprachnotizen and Beilagen,
  then photos, one file in memory at a time, **at most 25 files per pass** (a big Einsatz is filed
  over several passes, each keeping its progress) – and finish by compare-and-swap on the lease:
  `delivered`, or `pending` again when more is owed or `wanted` moved meanwhile.
- Idempotent: every upload is a PUT of `…/items/{folder}:/{name}:/content` with a name that
  depends only on the record, and `remote_items` is persisted after a failure too. A lost response
  is answered by uploading the same bytes to the same name once more; a Rapport version whose
  answer was lost is remembered (`remote_items.reportTry`), so a newer Rapport never takes its name. A folder's chosen path is
  remembered before it is created, so a lost create finds it again instead of making « (2)».
- Failures: 401/403/404 and a file missing from storage → `failed` (no automatic retry until
  «Erneut versuchen», a destination change or new `sharepoint_export` credentials – the row keeps a
  fingerprint of both). 409/412/429/5xx/network → backoff 1 min · 5 min · 15 min · 1 h · 6 h (cap),
  stays `pending`, for as long as it takes. A destination switched off – or the module – pauses its
  rows (kept); switched on, they resume. The Einsatz deleted → its row goes with it (CASCADE); what
  was filed stays.

## Admin – `/api/admin/incident-archive` (admin session)

`GET` → `{enabled, deliveries: [{incidentId, destination, state, attempts, nextAttemptAt,
lastError, deliveredAt, folders, reportVersions, filedMedia}]}` (newest change first) ·
`POST /retry {incidentId?}` → `{retried: n}`: failed → pending (all, or that Einsatz); for a closed
real Einsatz with no row yet (closed before the Ablage was on) it enqueues it. 409 while off.

UI: `/admin` › Einsätze shows an **«Ablage»** column while the Ablage is on: per destination
«abgelegt» / «ausstehend» / «pausiert» / «Fehler» with the error, the folders (copyable), «ohne
Rapport-PDF», and «Erneut versuchen» on a Fehler; «beim Abschluss» for a running Einsatz, «Übung –
wird nicht abgelegt», and «nicht abgelegt» + «Ablegen» for a closed one the Ablage has not seen.

## Setting it up

1. The `sharepoint_export` registration and its three credentials as for the Objektbesuche
   ([`object-visits-sharepoint.md`](object-visits-sharepoint.md) §1–§2). A destination on another
   site needs that site granted too (`Sites.Selected` is per site).
2. Make sure the fixed levels of both patterns exist in the library.
3. Add the section with `enabled: true` (config-as-code, `admin_config`; there is no form).
4. Close a test Einsatz that is **not** an Übung, watch `/admin` › Einsätze › «Ablage».
