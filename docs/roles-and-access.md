# Roles and access

Who may write what: the incident roles, the separate deployment admin, and the incident links. The
allowlists live in `backend/app/auth/incident_link.py`. Moved here from AGENTS.md on 2026-10-08,
wording unchanged.

## Incident roles, the deployment admin and links

- **Role gating** – product model is three incident roles: `editor` (FU / can mutate incident
  state), `el` (Einsatzleiter function, 07.09.2026 – reads everything, writes ONLY the record
  domains: Anwesenheit/Zeitplan, Mittel, Checklisten, Rapport + Beilagen, via the
  server-enforced `PUT …/workspace/record` slice (`RECORD_WORKSPACE_KEYS`, plus the crew
  filing's markers, unioned onto the stored Trupps — `RECORD_CREW_FILED_KEY`, 22.10.2026), audit-event
  appends limited to the record vocabulary (`EL_EVENT_PREFIXES`), Verlauf rows of any kind like an
  editor's (the el writes Lagemeldungen through the composer; a row is append-only and
  attributable, so a wider vocabulary costs the record nothing – lead's call, 22.10.2026), media
  uploads, and — since
  10.09.2026 — the EINSATZDATEN at the head of that record: `PATCH /incidents/{id}` limited to
  the fields «Einsatzdaten bearbeiten» sends (`EL_META_FIELDS`); the full workspace PUT, the
  trupps slice, the incident lifecycle (`status`, `is_archived`, `report_done_at`) and
  everything tactical stay 403 for it), and `viewer`
  (read-only). The Führungsansicht is the LOGIN's (`el_view_default`, the admin's Benutzer · «Führungsansicht»);
  the per-device toggle in the Einstellungen is gone (05.10.2026, owner: «drop Führungsansicht in settings. We
  can use users») and a stored `prefs.elView` is ignored. Frontend: `isEl` behaves like an editor's Führungsansicht (`tacticalLocked`
  on, `readOnly` off) with `canEditRecord` unlocking the four surfaces, `canEditMeta` the
  Einsatzdaten panel, and the sync pushing `slice: 'record'`. ⚠️ **A door the role cannot go
  through is not drawn** — hidden, never disabled-without-a-reason (3am test, 25.09.2026). A
  READ-OUT is not a door: it stays, disabled in the `.wb-object:disabled` recipe (full opacity,
  its own words and tone, no tap). So a locked session (el, Führungsansicht, viewer, replay) keeps
  the building's name and the Plan sheet behind the Objekt chip (Massstab and a linked Karte,
  their words and lamps) as read-outs — an unchecked automatic fit must never look like a
  checked one, whoever is looking — but gets no «Anderes Gebäude wählen» (the locked picker has
  no «Übernehmen»), none of the Passung's actions, no calibration, no «Gebäude drehen». On
  the Lage and the Plan alike a locked session SELECTS every object (a Linie, Fläche or
  Absperrkreis on the Plan too – never dragged) and reads its panel: a Form its figures, a
  Leitung its Inhalt, Stockwerk, Leitung-Nr. and Trupp, a live vehicle its Fahrer, a
  Gefahrentafel its Schutzabstand, a symbol its Beschriftung – read-outs, not faded controls. It
  gets no rotate/resize handle, no ghost-trail «Spur löschen» (the label is a read-out), no vehicle
  «GPS» / «Hier festhalten» / Fahrer edit (the Führungsansicht included); a Trupp marker keeps
  «Im Atemschutz zeigen» and «Spur ein/aus», which change nothing shared. A Tafel page's Tendenz
  and «erledigt» are read-outs; the empty-sheet hint and the views menu's «Eine Ansicht speichert
  …» teach writers only (RBAC audit 22.10.2026). Every
  session that cannot share links (`canShareLink` false: el, Führungsansicht, viewer, link) gets
  no «Weitergeben» section, and so sends no GET for a link it may not read. The `el` also gets no
  saved-view writes, no vehicle override, no «Wieder öffnen», no transcription
  and no checklist «Zeichnen» link. No locked session (`tacticalLocked`: el, Führungsansicht,
  viewer, link, replay) gets the Plan's «Anderes Objekt wählen»; its object chip stays a read-out
  (RBAC audit 22.10.2026). A session that may write nothing (`roleReadOnly`: viewer, view and
  alarm links, a refused Atemschutz-Link) writes no Verlauf row at all – `pushEvent` refuses it,
  the composer does not mount (a checklist's «Verlauf» link opens the Verlauf instead), a due
  Wiedervorlage has no «Erledigt» / «+10 min», and a Trupp card's «+ Auftrag» is a read-out –
  because whatever it took would stay on that device and raise «Speicher voll». The Atemschutz
  alarm rings on every device, but only a session that writes the Trupps (`canEditTrupps`: FU,
  Atemschutz-Link) records the crossing. Machine seeds of keys outside the record slice (plan
  bindings, the floor-pack Gebäude) run only where the push carries the whole blob
  (`canWriteBlob`: an editor's session). The legacy `commander` value has been migrated away: the stored role,
  the `Literal`/type unions, the `CurrentEditor` dependency, and `user?.role === 'editor'` checks
  all use `editor` now. Do not reintroduce `commander`, and do not add deployment-admin power to the
  incident role model. Deployment administration is **separated** behind the `ADMIN_SECRET` env var:
  the `/admin` UI and admin-write API (config, branding, system, user CRUD, geodata/objects) gate on
  `get_current_admin` / `CurrentAdmin` (a secret-backed admin-session cookie via `/api/admin/login`),
  not the editor role; the `admin_geodata`/`admin_objects` `push` CLI uses `KP_ADMIN_SECRET`. It's
  **fail-closed** – unset `ADMIN_SECRET` → admin endpoints 403, never the editor PIN. Incident
  endpoints stay on `CurrentEditor`, with ONE exception: the Atemschutz-Link (a QR minted from a
  running Einsatz that lets a non-FU operate only the Atemschutzüberwachung) writes through
  `CurrentAtemschutzWriter` on exactly three routes – `PUT …/workspace/trupps`, `POST …/journal`
  (`kind: 'team'` rows only, a `patchOf` only onto its own rows) and `POST …/events`
  (`atemschutz.*` only); the allowlist and the
  liveness rules live in `backend/app/auth/incident_link.py`. ⚠️ Every link kind may also
  `POST /api/diag/client-error` (24.09.2026), even with a dead session (liveness-exempt). The
  route needs no session and is throttled per source in its own handler. Without it, a crash on
  a responder's phone got a 403 and never reached the log. Its read half, `GET /api/diag/export`,
  stays off every list. A refusal logs its reason server-side (`kpfront.linkscope`) and never
  sends it to the holder. Never widen the full workspace PUT
  to a link session. **A link is the literal page and touches nothing on the device** (02.09.):
  its cookie has to be site-wide (an `<img>` carries no header), so the PAGE says which session
  it is asking with — `X-Incident-Link: off` from the app and `/admin`, `use` from the
  handed-over Atemschutz board, nothing from a subresource or an alarm/view link page
  (`src/lib/linkMode.ts` ↔ `LINK_MODE_HEADER`). Consequences to keep true: the bare site after a
  link visit is whoever it was before, an Atemschutz link no longer signs the phone out to win
  precedence, `logout` is off the allowlist, and **no link surface offers «Abmelden»** — leaving
  a link is closing the page, and coming back is the link URL. Two rules that fall out of the
  same model and are easy to break: a page sending `use` with no live link session is **401, never
  the device's login** (falling through would turn a lapsed board into the phone owner's account),
  and the device's own «Abmelden» **does** clear the link cookie — headerless requests (typed
  address, `<img>`, service worker) answer as the link guest otherwise. That «Abmelden» **always
  confirms** (23.09.2026, `lib/logoutConfirm`), in one card that adds the offline and the
  unsent-entries cost when there is one.
- **Alerts and requests per session** (RBAC audit, 22.10.2026). A due Wiedervorlage rings – tone
  and OS notification – only for the sessions that can tick it off, `editor` and `el`
  (`RemindersHost · alert`); a viewer or a link shows the due row silently and its Pendenzen ring
  and text as read-outs. The Atemschutz alarm is unchanged and rings everywhere. A lost tab lock
  says so (banner + the «Eintrag» toast) to every session that writes the Verlauf, the `el`
  included. A link page never asks for what its allowlist refuses: no Traccar, weather or radar
  poll and no Gebäude card on a view link (`liveFeeds`), none of those on the Atemschutz-Link's
  Tafel either (it shows none), no Overpass warm-up and no audio waveform (`…/peaks`) on any
  link, and no push subscription from a page whose own link session answers
  (`linkPageOwnsSession`). An `el`'s Rapport one-shots (Beilagen) audit their ↶/↷ as
  `report.undo`/`report.redo`, which its event scope keeps.

## The viewer's window (since 2026-10-21)

A `viewer` account (the «Fahrer» tile: one PIN for every driver, left signed in on vehicle
tablets) reads the **running** Einsätze and those **last closed within
`access.viewerHistoryDays`** (default 7; `0` = running only; CONFIGURATION.md §1f) – not the
archive. Outside that window an Einsatz does not exist for it: `GET /incidents` leaves it out,
and every route naming its `incident_id` – or a `media_id` of it – answers 404, never 403, so
the tile cannot probe which Einsätze there were. One check for every route:
`get_current_user` → `auth/viewer_scope · enforce_viewer_window`; the list uses
`viewer_window_clause`, the same condition in SQL. A reopened Einsatz is running again and
readable. `editor`, `el`, the deployment admin and link sessions are untouched. «Karte &
Objekte» is station data, not an Einsatz, and stays fully readable.

## Station reference reads

«Karte & Objekte» (`/api/reference/objects`, `/api/reference/building`, since 2026-10-16) is for
ACCOUNT sessions – `editor`, `el`, `viewer` alike – and the deployment admin. Every incident link
and the Erfassungs-Poster's capture token get 403: a link is scoped to one Einsatz and must never
become a door onto the station's whole register (`api/station_reference · get_station_reader`,
and the link allowlist does not name these routes). What a role may do from there – start an
Objektbesuch – stays `objectVisits.captureRoles`.

The service worker enforces the same boundary (`public/sw-media-cache.js`): only known account
clients may use the station's reference caches. After an idle worker restart (which does not
fire `controllerchange`), an unknown client is asked to re-announce its current session. The
page replies with its latest context, including any denial; no old grant is persisted or
inferred from the cache owner. Workbox's asynchronous session hooks await that reply before
reading or storing reference data, preserving the existing cache strategies for account clients.
Link clients and clients that cannot affirm an account session fetch every
`/api/reference/*` resource from the server with `cache: 'no-store'`, including pinned plans,
tiles and checklist images; an explicit `X-Incident-Link: use` wins immediately. A cached
account response must never replace a link's 403. Account clients keep their offline reference
caches. The station catalogue and building-point reads are always `NetworkOnly` in Workbox;
their offline copy already lives in IndexedDB (`lib/api/stationReference`).

## «Üben»: the Lern-Übung door (since 2026-11-05)

A tutorial runs on a real Einsatz, «Lernen · <Modul>», that `POST /api/incidents/lernen` creates
for an `editor` **and an `el`** (`CurrentLernOpener`, its own dependency so widening the record
door never widens who may create an incident; no link session, 403 in the demo). The client
sends only the tutorial's id; the server sets everything else – `is_exercise` and
`exercise_since_creation` on, `source='training'`, the German title, the seeded scene
(`backend/app/tutorial_seed.py`) – and reuses the station's newest open Lern-Übung, renamed,
before it creates another. The title stays German whatever the device's language: it is part
of the Einsatz record, which every device shows alike. The `el` may also `DELETE` a Lern-Übung – an Übung since
creation **and** `source='training'` – so the done card's «Übung löschen» works for it
(`IncidentDeleter`); any other Übung stays the editors' to delete, as before. The RBAC-audit
S1 property holds: an `el` still cannot create a real Einsatz, because a Lern-Übung cannot be
marked real by it (`PATCH is_exercise: false` on a `source='training'` incident is 403 for a
non-editor), and a real Einsatz – or one flipped to Übung later – still takes the admin door.
A Lern-Übung is invisible to the station machinery (`models · LERN_UEBUNG_SOURCE`): it never
holds a real alarm in the pool, the standing links (Stations-Terminal, fixe Atemschutz-URL)
never bind to it nor offer it in «choose», and the server sweeps (vehicle presence, vehicle
track, weather) never write into it.

## Hardening from the RBAC audit (22.10.2026)

- **Hard delete without the Verwaltung** needs an Übung **created as one and never marked real**
  (`incidents.exercise_since_creation`). «Übung» stays an Einsatzdaten field (editor and el), so
  a real Einsatz flipped to Übung is stats-excluded but takes the admin door (archived, admin
  session, WARNING log) like any real one. Rows from before the column count as created-Übung
  only if their hash chain holds no Übung toggle at all.
- **`via` is the server's stamp.** An Atemschutz link's rows get `atemschutz-link` /
  `atemschutz-fix`, the Erfassungs-Poster's `capture`, everyone else's none – a client-sent `via`
  is dropped. A link or the poster may `patchOf` (retract, reword) only a row of its own channel;
  the poster writes no `kind` at all.
- **`GET /api/config`**: `alarms.webhooks` and `sharepoint.sources` reach an admin session only;
  `objectVisits.destinations` every PIN session, no anonymous caller, no link
  (CONFIGURATION.md §1a).
- **A role change ends the account's sessions** (`revoke_sessions`, like a PIN reset): a device
  learns its role at sign-in. The last active editor cannot be demoted to `el` or `viewer`.
- **A viewer's Rapport-PDF embeds its own Einsatz's media only** – the window applies to what
  the composer opens, not just to `GET /api/media`.
- **The el reads «Anrückend»** (`GET /divera/responses`, `CurrentRecordWriter`): it marks
  attendance like an editor. The rest of `/api/divera` stays editor-only.
- **Who a push wakes** (owner's pick): the Atemschutz alarms go to every subscribed browser;
  «Neuer Einsatz» only to `editor` accounts, «Wiedervorlage fällig» to `editor` and `el`
  (`push.py · role_recipients`, read when the push leaves). A viewer tablet, and a kiosk
  subscription without an account, hear only the Atemschutz alarms. Links never subscribe.
- **«Standort teilen» posts under one name per device, held until let go.** No account or link
  is tied to a roster person, so the name is the device's pick; a name another device holds is
  409 however quiet that device has gone, until it stops, an editor removes the dot, the Einsatz
  closes or the TTL sweep drops it. Posting under a new name drops the device's old dot
  (`api/person_positions.py`). Viewer and link sessions share like anyone else.
- **A link reads no station keys**: no account UUIDs (`created_by` on the Einsatz, `user_id` on
  its events) and no Divera ids on the roster (`is_link_session`). The Traccar host and the
  upstream error text reach the deployment admin only; `/traccar/trails?minutes=` stops at 240.
- **A secret is compared as bytes** (`secret_token · secret_matches`): a non-ASCII token is the
  uniform 401, never a 500. The Microsoft login matches the Entra object id only
  ([`microsoft-login.md`](microsoft-login.md)).
- **Every link kind is narrowed like the view link**: `/api/objects/{id}` and Objektpläne only
  for the objects this Einsatz surfaced, other reference datasets only as furniture (geodata,
  symbols, Checklisten, Tafel templates), no `/api/objects` register list, no inactive personnel.

## The record surfaces for a session that cannot write them (22.10.2026)

The door rule above, applied to the Rapport, Anwesenheit and lifecycle (RBAC audit, round 2):

- **Rapport** for a session that cannot edit it (`canEditRapport` false: viewer, view link, a
  closed Einsatz it may not correct; a signed Rapport too): every field is a read-out – the
  value, or «Nicht erfasst» – with no «Jetzt», «Entfällt», steppers, pickers or ✕. The
  Kontaktperson keeps its working `tel:`. No «n offen» chip, phone-tab dot or Rapport-tile count
  (the editor's to-do list), no «Formulare & Links», no Unterschriften card until a signature
  exists, no «Im Verlauf ergänzen» without `canWriteRecord`. «Nichts verwendet» (Mittel) is the
  el's answer as much as the editor's.
- **Anwesenheit**: the Zeitplan and Schichten tabs and their paper are gated on the shift data,
  not on the writers – a viewer reads and prints them. The person's sheet (Zeiten, Bemerkung)
  opens read-only. Writer hints (empty roster «Synchronisiere …», «Hier korrigieren …», the
  Trupp-lock title, the Zeitplan's gesture help) are not shown.
- A disabled tick (`TickRow`) is a read-out at full opacity.
- **Closed Einsatz**: «… für alles andere wieder öffnen» only beside «Wieder öffnen»; the el and a
  Führungsansicht hear «Der Rapport bleibt korrigierbar», a viewer «Nur ansehen». The
  Führungsansicht reopens and closes nothing (no «Wieder öffnen» in the Einsatz card's closed pill or in «Alle
  Einsätze»).
- **«Alle Einsätze»** tells a viewer its window in a foot line (read from
  `access.viewerHistoryDays` in `GET /api/config`); the Einsatz card says «Gespeichert» only to a
  session that saves.

## Signing in with Microsoft (optional)

Since 09.10.2026 a station can add «Mit Microsoft anmelden» beside the PIN tiles
([`microsoft-login.md`](microsoft-login.md)). It is a second door onto the SAME named accounts:
an Entra identity reaches only the account an admin listed it against (`ENTRA_LOGIN_ACCOUNTS`),
with that account's own role. It never creates an account, never grants deployment-admin power,
and never replaces the PIN. Off (no button, routes 404) unless all four credentials are set.
