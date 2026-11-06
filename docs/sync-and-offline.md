# Sync, offline and the closed Einsatz

Rules for the sync engine, the outboxes and the record that span modules: the model
(IndexedDB, «Saved», merge by id, passengers, ids, append-only, the server observing), the review
regression contracts, the closed Einsatz and derived ids. The per-module rules sit at the top of
the module they concern (`lib/connectivity`, `lib/eventScope`, `lib/jsonEqual`,
`lib/mergeWorkspace`, `lib/api/workspaceSync`, `lib/serverClock`, …). Moved here from AGENTS.md on
2026-10-08 and 2026-10-18 (the model), wording unchanged.

## The model

- **A silent startup update stays one visual opening** (2026-10-26). Immediately before an
  automatic service-worker reload, `snailLaunch` saves its animation clock in a tab-local,
  one-shot `sessionStorage` stamp. `index.html` consumes it before paint (expires after 30 s),
  continues the static SVG with negative animation delays and seeds React's launch clock.
  A surrendered update clears the stamp too. Ordinary opens and deliberate reloads still show
  the entrance; unavailable storage never blocks the update. The actual install/activation/reload path is covered by
  `e2e/snail-update.spec.ts` with service workers enabled.
- **Operational browser state lives in IndexedDB, not localStorage.** `src/lib/idb.ts` is the
  storage layer (localStorage only as its degradation fallback), `src/lib/storageMigration.ts`
  moved legacy operational keys over once. IndexedDB holds incident workspaces, pending sync,
  media queue metadata, reference/checklist/object metadata, and readiness; localStorage holds
  only tiny device flags (update banners, install prompts, once-per-device hints) and migration
  flags. UI copy/locale/defaults/storage keys live in `src/config/appConfig.ts`; the neutral
  fallback incident is `src/data/demoIncident.ts`.
- **A Leitung's pumps keep their terrain offline** (05.11.2026). The pumps a Leitung draws
  («Pumpen auf Karte», `lib/linePumps`) are planned on the swisstopo height profile of its path.
  The page shares one in-memory copy per path (`lib/profile · loadProfile`); across a reload the
  service worker's `height-profiles` cache answers the same URL offline (`vite.config` ·
  runtimeCaching: network first, 4 s timeout, 300 paths / 30 days). A path never fetched online
  has no profile and plans on flat ground, as the editor says («Ohne Höhenprofil gerechnet»).
- **Saved means every operational queue is acknowledged.** Workspace, journal and client audit
  outboxes and the media upload queue contribute to the shared sync status. Preserve rejected
  entries for retry/export; a failed IndexedDB write must never claim local durability. Hydrate
  and merge a predecessor's queue before a promoted tab writes it. A failed IndexedDB READ is not
  a miss: every hydrate that writes back reads through `idbRead` and never writes over a slot it
  could not read. Client audit events carry a stable `client_id` through retries; a beacon does
  not acknowledge delivery.
- **A save that changed only the Trupps travels as the trupp slice** (18.10.2026). An editor's
  push whose blob differs from the server copy it is based on (`entry.base` at `baseRev`) in
  `trupps` and nothing else goes `PUT …/workspace/trupps`, the Atemschutz-Link's route, instead
  of the whole document: a Funkkontakt sent ~100 KB of JSON (~38 KB gzipped) per tap on the
  busiest Einsatz on record. Not a new kind of save: the route stores the server's blob at that
  revision with these Trupps, so the result is the same blob, under the same conditional UPDATE,
  409 and merge, closed-Einsatz rule, validation and audit. A 422 from the slice (it validates
  every Trupp; the full save keeps an unchanged legacy row) falls back to the full PUT; no
  ancestor, or any other key changed, is the full PUT as before (`workspaceSync · onlyTruppsChanged`).
- ⚠️ **A slice session owns its slice, never the blob** (RBAC audit S4, 22.10.2026). The `el`
  (`slice: 'record'`) and the Atemschutz-Link (`slice: 'trupps'`) push one slice, and the server
  stores ITS blob with that slice in it — so that, not the pushed blob, is the new ancestor
  (`workspaceSync · landedSlice`), and a slice session's merge keeps the server's copy of every
  key it cannot push, plus its own `'local'` view keys (`sliceMerged`). The engine used to take
  the whole pushed blob as «on the server»: whatever the session held outside its slice passed
  for synced and the next adopt dropped it without a word. Two things had lived there: (1) the
  crew filing's `trupps[].crewFiled` an `el` stamps — now carried by the record slice as
  `truppCrewFiled: {truppId: keys}` and UNIONED onto the stored Trupps by the server
  (`api/incidents · RECORD_CREW_FILED_KEY`, nothing else of a Trupp is read), so an el phone
  beside a Link files a crew once and a member it took off stays off; (2) unsynced work of a
  WIDER role — an editor demoted to `el`, signed out by the role change, signs in again with
  its Lage edits in the cache. Every cache entry is stamped with the push shape that made it
  (`CacheEntry.shape`); a slice session opening a dirty entry of another shape parks a copy in
  `kp-front-ws-<id>::__role__:<owner>` first (durable-or-abort, like a foreign owner's work),
  then sends the record part as before. The copy is counted in the Verlauf's role note («… für
  diese Rolle nicht vorgesehen», beside the audit events refused for the role) and exported by
  «Einträge sichern» (`workspaceRoleParked`); nothing re-sends it. An entry from before the stamp
  is never parked.
- **The Verlauf outbox is per identity** (RBAC audit S5, 22.10.2026): `kp-journal-<id>:<user
  id>:<link kind | login>`, like the audit store's. One slot per Einsatz was shared by every
  identity on the device, so an Atemschutz-Link opened on the FU's own phone sent the FU's unsent
  Meldung as the link (a 403 — and the board froze as «Link widerrufen») and the FU's Trupp rows
  stamped `via: atemschutz-link`. The device LOGIN adopts the shared pre-22.10. slot once and
  deletes it after its own snapshot landed; a link page never reads it. And a link page reads
  only a refused READ of its own workspace/Verlauf/events as «Link widerrufen» (`api ·
  LINK_REFUSED_EVENT`): the server words every link refusal alike, so a write's 403 says nothing
  about the link, and the live follow reads every round.
- **The live follow never hands a device back its own save** (18.10.2026). Every save wakes every
  parked follower, the saving device's own long poll too, which downloaded the whole blob it had
  just sent (~38 KB gzipped per Funkkontakt on the busiest Einsatz on record) and threw it away.
  Each sync engine has a `writerId` (`WorkspaceSync`, per engine — one login runs on three
  tablets); its saves send it (`X-Workspace-Writer`) and its follow asks with it (`writer=`).
  When every revision after the poll's `since` is a save of that engine, the server answers 304 +
  `X-Workspace-Rev` (`live_wait · only_own_writes`) and the follow parks at that revision at once
  (`useIncidentSync`, `{ ownRev }`) — an answer, so no ease-off. ⚠️ The server decides only from
  what it has on record: a revision by anyone else, by a path that records no writer (capture,
  the alarm webhook, the admin import), on another worker, before a restart or out of the
  32-revision window is the blob, as before. So another device's change is never held back: in
  the range → the blob; after it → the re-armed poll is already behind and is answered at once.
  Only the engine whose state holds a save may send its id (never a save made around it, never a
  beacon). Guarded on the real stack by `e2e/live-follow.spec.ts`, with two real engines in
  `lib/liveFollow.twoDevice.test.ts`, and the rule in `backend/tests/test_long_poll.py`.
- **Sync supports task-scoped collaboration.** Multiple editors may work different domains in the
  same incident (e.g. Atemschutz + Lage drawing); this is not shared-cursor co-editing of the same
  object. Cross-domain concurrent edits must merge. Mergeable collections merge three-way **by
  `id`** (`mergeById` in `mergeWorkspace.ts`; delete beats concurrent edit; server-then-local
  order). Same-object conflicts can stay simple for now. To add a synced field: add it to
  `Saved` and give it a row in `MERGE_POLICY` (`mergeWorkspace.ts`) – the map is checked against
  `Saved` at compile time, so a field without a policy fails `tsc` instead of silently merging
  as «this device wins» (23.09.2026). (`Person`/roster is the exception – it carries
  `updatedAt` because it's pulled from Divera, not merged.)
- ⚠️ **An object kind a build does not understand is a passenger, never dropped** (review of
  #338, 10.10.2026). An older build that opened a Tafel with pages on it filtered the unknown
  `form` objects out at the load gate and its next full save deleted every page. So: (1) the
  client gate (`sanitizeWorkspace` · `isPassengerAnno`) keeps any board object of a kind it does
  not draw, untouched, and every merge and save carries it along (`isDrawnBoardKind` splits
  drawing from riding); (2) the server guards builds that predate the rule: a full save whose
  `schemaVersion` is older than a kind (`backend/app/data/board_kinds.json`, read as
  `app/workspace_kinds.py` · `BOARD_KIND_SINCE`) gets the stored objects of that kind put back
  (`keep_newer_board_kinds`). A new board kind → bump `WORKSPACE_SCHEMA_VERSION`
  (`src/lib/workspace.ts`, now 3) and give it its row in `board_kinds.json`;
  `src/lib/boardKinds.test.ts` fails on a `BoardKind` without one.
  ⚠️ **…and a build OLDER than the blob writes nothing to it** (sweep 30.10.2026 #19). The kind
  guard covers board objects only, and an old build loses more than those: its full save lacks
  every entry its gate skipped and every top-level key its `buildPayload` does not know, and its
  Trupp or record slice replaces those keys wholesale with what it kept. So:
  - **the server refuses it whole** — a save stamped below the stored blob's `schemaVersion` is
    409 `workspace_older_build`, nothing written, nothing merged (`workspace_kinds ·
    refuse_older_build`, checked in `apply_workspace_put` after the revision, so a refused save
    always sits on the current blob). The full PUT reads the blob's own stamp (none = 1); the
    `…/trupps` and `…/record` slices send `schemaVersion` since 30.10.2026, and one without it
    counts as 3 (`UNVERSIONED_SLICE_VERSION`) — so builds already in the field stay current
    until a blob is stamped 4. Not guarded: the capture page (a fresh read and a pure change on
    the raw blob per tap — it never skipped anything) and the server's own writers. Data safety
    over an old phone's convenience (lead call 30.10.2026): an older build's Rapport correction on
    a closed Einsatz is refused too, where the kind guard used to let it through;
  - **the client never merges or re-sends it** (`workspaceSync · parkOlderBuild`): the save is
    parked in the role slot (exported by «Einträge sichern»), the server's blob goes to the view;
  - **an older build reads newer data read-only** (`gateReport(...).newer` →
    `workspace/access · olderBuild`; the Verlauf and audit outboxes still deliver), looks for the
    newer build and reloads into it by itself (`swUpdate · requireNewerBuild`, any time — nothing
    can be in progress on a read-only view), and only when none arrives does one row stand,
    «Neuere App-Version nötig» + «Aktualisieren». What the old gate skipped is not reported as
    «beschädigte Einträge»: it is newer, not broken. A build from before 30.10.2026 does not know
    the code: it reads the 409 as a revision conflict, merges and is refused up to four times,
    keeps the save dirty with the sync lamp on error, and tries again on its backoff (at most once
    a minute) until it is updated — nothing it sends lands.
  A Tafel page is ONE object but merges **atom by atom** (`lib/boardFormMerge`: a cell, a line,
  a field), the later edit (`t`, server clock) winning a true clash and writing a Verlauf row.
  The Checklisten merge **per tick** (`mergeWorkspace · mergeChecklists`, 05.11.2026): two
  devices ticking different items of one list both keep their tick (it was per list, and one
  was lost). A problem's Tendenz sits beside the ticks (`trends`, merged per item too), so an
  un-tick and a concurrent Tendenz on the same item both stand. The Tafel's problems are
  derived from both, never copied (`lib/problemLink`) – so they need no merge of their own.
- **IDs are prefixed timestamps, not UUIDs** – `newId(prefix)` from `src/lib/ids.ts`
  (`<prefix><ms>-<seq><rand>`) for EVERY record the app mints and syncs — Verlauf rows
  included (`newRowId(tag?)`), Mittel events, patch rows, Gäste, Pendenzen. A per-device
  counter is not enough: one login on three tablets (Übung 23.09.2026) had each counter at
  0, and the journal's idempotency-by-id silently dropped the second device's row. Ids
  already stored keep their old shape (never rewrite them); a reader that needs to know
  what wrote a row reads the tag (`isPlayerRowId`), never a parsed timestamp. Deliberately
  DERIVED ids (`ght-<markerId>`, `vp-…`, `azal-`/`azcl-`) stay deterministic — two devices
  must mint the same one ([Observed facts get derived ids](#observed-facts-get-derived-ids)).
  Offline-friendly, no DB roundtrip; don't reach for `crypto.randomUUID()`.
- **Incident records are append-only where it matters.** Verlauf is the human operational journal
  plus selected meaningful system events; audit/events record committed domain actions. Don't add
  mutate/delete shortcuts for production records; lifecycle changes (reminders, media transcripts,
  corrections) are *new appended events* with state derived from them. **A row carries what was
  said, not a pointer to it** (reversed 11.08.): a Notiz, a Fläche's name, a Druckmeldung print
  their actual text/value, because the Rapport is read on paper where nothing can be clicked. The
  row is also the ONE string the Verlauf, the Rapport and the hash chain all read – so a re-shown
  reminder carries its bare text alongside (`reminder.text`) rather than the row being re-parsed.
  What reaches the Verlauf: [`verlauf-coverage.md`](verlauf-coverage.md).
- **The server observes; devices never write observations** – a fact about the outside world
  (vehicle presence, weather, Divera alarms) is recorded once by the scheduler
  ([`ARCHITECTURE.md`](ARCHITECTURE.md#the-server-observes-devices-never-write-observations)).
  What the devices still observe gets a derived id (below).

## Live but never synced: the Präsentationsmodus (05.11.2026)

A presentation is a way of LOOKING at the Einsatz together, so it has none of the machinery above:
no synced field, no `MERGE_POLICY` row, no IndexedDB, no outbox – offline it is simply not there.
Whether one runs rides the workspace follow: every workspace read, the 304 included, carries
`X-Presentation` (the id or `none`), the poll sends the marker it holds (`presentation=`, answered
at once when wrong), and a start or an end wakes the parked polls – like the lifecycle headers
(`X-Incident-Open`). Only while that marker names one does a device run a third long poll
(`live_wait` topic `presentation`), so an Einsatz nobody presents costs no request. It is held in
the server's memory, and the record gets exactly two server rows, «Präsentation gestartet /
beendet». The rules: [`presentation.md`](presentation.md).

## Review regression contracts (02.10.2026)

- Journal lifecycle boundaries and the `sys` id namespace belong to the server. Neither a
  client row nor a patch targeting a system row may create, retract or edit them; the client
  alarm clock ignores ordinary journal rows carrying lifecycle-looking metadata.
- A failed conflict PUT still hands the merged union to the live view before another edit.
  Re-sending parked workspace saves first commits their replacement cache entry, with transfer
  markers for crash-safe retry, before clearing the parked originals.
- Blob data never falls back to JSON storage. Failed local media persistence retains bytes in
  memory and reports storage failure. Pending uploads retry with a bounded delay; exhausted
  uploads wait for explicit retry. Rendering the queue must never trigger an upload loop.
- An upload that landed leaves a stored **receipt** in the media queue (server URL, bytes
  dropped) until the Verlauf link it enriches is acknowledged; a reload replays it, and a row
  already carrying the URL is not patched twice (`mediaQueue` / `useMediaQueue` headers, audit
  F06 25.10.2026). A receipt keeps the badge amber; it is not counted as a pending capture.
  A Rapport-Beilage's receipt waits for the workspace save instead (`sync.hasUnsynced`), and a
  receipt for a retracted row links nothing and retires once the Verlauf is synced.

## Adversarial audit contracts (25.10.2026)

- **No quiet monitoring stop.** Only `kind: 'einfach'` exempts a Trupp from the contact clock —
  absent and unknown words stay monitored on the board (`isAtemschutzTrupp`) and in the push sweep.
  The server refuses an unknown `kind`/`status`, a non-text crew list and a second Trupp under
  one id on a NEW or changed row; an unchanged stored row still rides (`alarm_validation`), on the
  slice route as on the full PUT, so one old record cannot lock a tablet out of its saves.
- **The load gate repairs what the server would now refuse** (`sanitizeWorkspace`, counted): an
  unknown kind is removed, an unknown status becomes the phase its stamps say, broken crew entries
  go (the crew and its clocks stay), and two different Trupps under one id are split — the second
  gets the derived id `<id>~2`, so every device converges on the same one.
- **A conflict that spans records is shown, never resolved by a Map.** A person in two active
  Trupps after a merge is a banner on the board with an explicit choice
  ([`atemschutz-board.md`](atemschutz-board.md#the-trupp-form-and-its-questions)).

## A closed Einsatz

⚠️ **A closed Einsatz keeps its RECORD, not its operation, and every device hears the close**
(25.09.2026, staging N3: two devices ran a closed Einsatz for minutes and wrote a Kontakt and
two «Überfällig» rows into it). Server (`incident_service · incident_closed`): once `is_open` is
false, a live write MADE AFTER THE CLOSE is 409 `{code: 'incident_closed', closed_at}` — judged
by when it happened (rows `at`, events `occurred_at`, saves `edited_at`, all on the
server-aligned clock, +120 s tolerance; no stamp ⇒ by arrival), never by when it arrived: a
Kontakt from before the close is a true fact and prints as a Nachtrag. Live = events outside
the record vocabulary (`EL_EVENT_PREFIXES`), Verlauf rows of kind `team`/`symbol`/`layer`/
`vehicle` without a `conflict` payload, the trupps slice, and a full save that changes a key
outside `RECORD_WORKSPACE_KEYS` and `VIEW_WORKSPACE_KEYS` (the revision check runs FIRST, and an
entry the server already holds is the idempotent success, not a refusal). The record slice,
record events, Meldungen/patch rows, `PATCH`, media and «Wieder öffnen» are untouched. Every
workspace read — the 304 too — carries `X-Incident-Open`/`X-Incident-Closed-At`; a lifecycle
`PATCH` and the auto-archive sweep wake the parked followers, and a poll carrying `open=` that
no longer matches is answered at once. Client (`lib/incidentClosed`): the poll header, a
refusal and the list watch (a suspicion, verified) all `reportIncidentClosed`; App flips the
meta IN PLACE (`closedMetaFor`, never for the Einsatz this device is closing, never a jump
elsewhere), and `IncidentWorkspace` derives `readOnly` from `isIncidentRunning` live, so the
alarm, the GPS pass, the presence log, the weather stamp and the Wiedervorlagen stop, with one
Meldeleiste row («… auf einem anderen Gerät abgeschlossen (hh:mm)»). The closing device drains
its Verlauf and audit outboxes before the archive `PATCH`. The outboxes keep DELIVERING on a
closed view (`outboxReadOnly`), and a refused write is parked — journal `refused`, audit
`closed` (apart from the role bucket `refused`), the workspace's `::__refused__` slots, whose
record part is re-saved at once through the record route and whose ancestor goes straight
back on screen. Parked entries are exported by «Einträge sichern», keep the lamp amber until
then, and are SENT again once the Einsatz runs again. A plain 409 on the workspace is still
the revision conflict: test the code first. «Wieder öffnen» elsewhere comes back the same way
(`X-Incident-Open: 1`, the same wake, the list watch, `reopenedMetaFor`) on EVERY device that
shows the Einsatz closed, however it came to (a close signal, its own close, «Alle Einsätze» —
forceReadOnly goes too), with its own row naming the reopen row's time. The live poll claims
`open=` from the server's last `X-Incident-Open`, never only from the view, and a held poll that
answers at once with nothing new eases off — a closed view must never spin (it did, 3.4/s). «Anhängen» is never offered onto a closed Einsatz.
**«Wieder öffnen» on the Einsatz on screen flips it live in place** (27.10.2026, sweep #6): the PATCH's
answer is the new meta, the live-followed workspace stays mounted — the same flip a reopen
elsewhere makes (`lib/useIncidentLifecycle` · reopenNow). It used to refetch the Einsatz twice
and remount, serially (3.2 s against 0.5 s for the PATCH at 300 ms latency and a 4× slower CPU).
**«Wieder öffnen» needs the server — there is no offline reopen** (05.10.2026, asked for after an
Übung in airplane mode). The reopen boundary row is server-owned (`sys` namespace, review
contract above), the Atemschutz alarm HOLDS until it has arrived (`reopenPending`), and the
crews' restart rows derive their ids from it — so an Einsatz reopened offline would run its
Tafel with no Überfällig alarm for as long as the device stays offline. Offline the doors stay
(useOnline is a hint) but say so: «Braucht Verbindung zum Server» in the Einsatz card's closed fold, one
line over «Alle Einsätze», and an unreachable server answers with `reactivateNeedsServer`, not
a raw network error. An offline reopen would need a client-stamped reopen time and a
precondition on the close it saw (`last_closed_at`, so a later close elsewhere wins), a local
provisional boundary for the alarm, the reopen sent BEFORE any outbox on reconnect, and closed
signals for that Einsatz ignored until then — a design, not a patch.
After the close the RAPPORT stays editable (`canEditRapport`, one line at its top: «Änderungen
… erscheinen als Nachträge») – until it is SIGNED: a signature that still holds locks the form,
«Ändern» voids it, and a change that arrives anyway makes it «ungültig», never refused
([`rapport.md`](rapport.md) · Unterschriften; `reportSignatures` is a record key, 15.10.2026); the Tafel, Karte, Anwesenheit/Mittel/Checklisten stay read-only
until «Wieder öffnen». Every row the server accepts on a closed Einsatz is stamped
`receivedAfterClose` and prints as a Nachtrag whatever its time — except a row the Abschluss
itself wrote between the confirm and the close (`atClose`, set by `useAbschluss · markClosing`;
honoured up to 120 s past the close, `verlauf · isNachtrag`). A reopen clears
`report_done_at` (a running Einsatz is not «Rapport fertig»), keeps `closed_at` (the first
Einsatzende, which marks the Nachträge — so the Einsatzuhr ignores it while the Einsatz runs),
and writes its boundary row with `lifecycle: 'reopened'`; every crew still inside restarts its
contact clock at that row's `at`, one `azro-<row>-<Trupp>` row each, and the alarm holds until
the row has arrived (`lib/reopenClocks`); the alarm that restart ends names the reopen
(`contactRestartedAt`), never a Funkkontakt — read off the Trupp the alarm engine EVALUATED
(`logAlarmCleared(id, turnus, seen)`), not the parent's state, which gets the restart one effect
later, so every tablet writes the same reason under the one derived id — and the pressure estimate skips the closed
interval (`pausedFrom` → `contactRestartedAt`, `atemschutz · estimatePressure`). The Atemschutz-Link of a closed Einsatz says «diese
Tafel zeigt nur noch an» and follows once a minute (`pollBackoff · minDelayMs`): a link
session on a closed Einsatz is answered 409 `incident_closed` + `X-Incident-Open: 0` on the
Einsatz's own routes (before any key check — every close, the second too), and a link page
refused 403 on its workspace/Verlauf/events freezes read-only (`api · LINK_REFUSED_EVENT`). A
per-Einsatz Atemschutz link RELOADED while closed gets the same 409 from the exchange (no cookie;
the alarm link's (src, ref) exchange keeps its one 404) and shows «Einsatz abgeschlossen», asking
again once a minute so a reopen opens the board by itself (`link/LinkApp · ClosedCard`). The
link KEY is not revoked by a close, on purpose: the QR panel shows it standing and a reopen
revives it. `closed_at` is the FIRST close (Nachträge only); `last_closed_at` is stamped on
every close and is the Einsatzende the clock, the Rapport and the Anwesenheit ends default to
(`api/incidents · closeTimeOf`); the PDF prints the Nachtrag mark under the row's time. A
closed Tafel alarms nothing (no badge, no red; «Stand beim Abschluss»), the lifecycle row
expires after two minutes and never covers the Rapport.

## Observed facts get derived ids

- ⚠️ **What every device OBSERVES is recorded under a DERIVED id, once** (24.09.2026). One
  login is routinely open on three devices, and each runs the same engines — the Atemschutz
  alarm clock (the one observation still on the devices: it is about the device's own Tafel,
  not the outside world). A row or event such an engine writes must carry an id every device
  computes identically from the fact itself, so the server's idempotency keeps one: Verlauf
  rows `azal-`/`azcl-<trupp>-<turnus>` (alarm), and the audit event beside an observed row
  `observedEventId(rowId, actor)` with a payload free of anything device-local. The server's
  own observers derive theirs the same way (`vps-<n>-<zone>-gps-<device>`, `wx:<incident>:<observed_at>`,
  `wxd-<observed_at>`), so a restart or a second worker converges.
  Audit ids are ACTOR-scoped (the server binds a `client_id` to its author; two accounts each
  observed it). The server treats a same-id, same-author, same-op, same-payload event with a
  different `occurred_at` as the duplicate (the first observation's time is kept) — a
  different payload under one id stays a 409. A hand-performed act keeps a fresh `newId`.
