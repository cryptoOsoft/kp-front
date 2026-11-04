# What lands in the Verlauf – and what doesn't

The **Verlauf** is the human-readable incident chronicle. It is *not* a log of every operator
action, and that is deliberate: a journal that records every nudge of a symbol is one in which
you can no longer find the Funkspruch.

This page pins down **which action lands where**, so nobody relies on something being in the
Verlauf that was never written there. As of 2026-09-10.

## There are two records, not one

| | Verlauf | Audit/replay stream |
|---|---|---|
| Written by | `log()` / `logPlan()` → `journal.append` | `emit(op, payload)` (`src/lib/useAuditEvents.ts` · `emit`) |
| Lands in | `POST /api/incidents/{id}/journal` | `POST /api/incidents/{id}/events` |
| Form | plain-text rows, append-only | machine-readable, **hash-chained** |
| Visible | in the Verlauf, on the printed Rapport | only in replay / review |

`backend/app/models.py` · `JournalEntry` says it itself: the audit stream is *"the hash-chained AUDIT
record of committed domain actions"*, the journal store *"the operational journal store"*.

**Important:** `emit()` creates **no** Verlauf row. Everything listed below as *audit only* is
legally on the record, but invisible to anyone reading the Verlauf.

On top of that there is a third, small source: the server writes lifecycle rows itself
(`backend/app/api/journal.py` · `append_system_row`) – incident closed, reopened,
Nachalarm, automatic archival (untouched, stale, and an Übung idle for `alarms.exerciseAutoCloseHours`:
«Automatisch abgeschlossen (Übung)»).

## What the server observes (since 24.09.2026)

Observations of the outside world are written by the scheduler, never by a
device (`docs/ARCHITECTURE.md` · «The server observes»). Their rows carry derived ids, `t: ""`
(clients render the time from `at`) and German text, like the other server rows:

| Row | Id | `at` | When |
|---|---|---|---|
| «TLF vor Ort» | `vps-<n>-scene-gps-<device>` | the tracker's FIRST report inside 150 m (Traccar `deviceTime`) | the vehicle's first arrival only; later arrivals are trips, counted in `reportMeta.fahrzeuge[].gps.fahrten` and printed as «3 Fahrten», never rows. No row when the external geofence already wrote «TLF vor Ort 19:23» for it (first writer wins) |
| «TLF hat den Einsatzort verlassen» | `vps-<n>-away-gps-<device>` | the tracker's FIRST report beyond 300 m | the LAST departure only: written once the vehicle stayed away 20 min, or when observation ends — so it appears late but stands where it happened. A tracker the config cannot name writes no row where the external geofence is writing (it may name it differently) |
| «Wind dreht: W → NO (286° → 66°) · Lüfter prüfen» | `wxd-<observed_at>` | the confirming reading | a turn ≥ 45° at ≥ 10 km/h, held over two readings on the same side, from one source + station; the devices show it once on the Meldeleiste for 30 min from the row's `writtenAt` (`WindShiftMeldung`, ✕ is remembered per device) |
| «Automatische Beobachtung beendet (24 h ohne Eintrag) …» | `obs-end-<last activity>` | 24 h after the last human write | once per quiet spell of an OPEN, observed Einsatz; observation resumes at the next human write |

Audit only (no row): `vehicle.presence` (every transition and the silent baseline, source
`gps`) and `weather.observe` (every reading, source `weather`, id `wx:<incident>:<observed_at>`
— the replay's wind badge). Rows written before the deploy by the devices (`vp-` rows stamped
when a device noticed, `weather.observe` per device) stay as they are; the server's own `vps-`
rows are written beside them, never swallowed by them. An older build's new ones are dropped at
the endpoints.

## Atemschutz: the full cycle is on the record

Every Trupp row names the Trupp as `Trupp N (Gruppenführer …)` since 12.09.
([`trupp-naming.md`](trupp-naming.md) §4): safety rows (angemeldet, Eintritt, Kontakt, Druck,
Rückzug, Austritt, Alarm) spell out the whole crew, « / » between the names, and so do the edit
rows («bearbeitet», since 25.09.2026); housekeeping rows (platziert, Leitung, entfernt,
wiederhergestellt, nicht mehr gesetzt) name the leader only. `truppLogName` in `src/lib/atemschutz.ts` is the one formatter. Rows written before
that date keep their `Trupp {Gruppenführer}` wording – the log is append-only.

A Trupp or loose «Trupp N» marker whose number a merge gave to another device's Trupp
(two devices minted it at once, [`trupp-naming.md`](trupp-naming.md) §7) writes ONE row,
«Trupp {name} heisst jetzt Trupp {no}» (`lib/truppNumbers` · `renumberRow`, copy
`atemschutz.logRenumbered`; a chip «{from} heisst jetzt {to}», `logRenumberedChip`), under the
derived id `trn-<id>-<from>-<to>`, so the devices that all noticed it – the resolving one and the
Atemschutz-Link included – leave one row between them.

A newly registered Trupp creates a Verlauf row – «Trupp {name} angemeldet»
(`truppActions/lifecycle.ts` · `logRegister`). Whoever thinks it's missing is usually just not looking
at the Verlauf while registering: Atemschutz is its own view.

**Closed since 2026-08-17** (this used to be listed here as a gap): removing (`logRemoved`,
«Trupp {name} entfernt») and restoring (`logRestored`) write their row. A colour change is a
clause of the edit row («Farbe geändert», `atemschutz.changeColor` in
`truppActions/lifecycle` · `truppEditChanges`); since 04.09.2026 the Trupp form no longer offers a
colour, so it only fires if a stored colour actually differs.
A deleted Trupp is only soft-removed anyway (`removedAt`) and keeps printing on the
Rapport as «Von Tafel entfernt».

Everything else on the Atemschutz board is in the Verlauf: placing, radio contact, pressure
report, status change, editing, returning, linking/unlinking a Leitung, alarm escalation.

⚠️ **The Sicherungstrupp going in says so** (2026-09-24): the first Eintritt of an
Atemschutz-Trupp on Auftrag «Sichern» writes «Trupp N (…): Sicherungstrupp eingesetzt»
(`logSafetyEntry`) instead of the plain «Eintritt» – whether it came from the phone slot's
«Einsetzen» or the card's «Im Einsatz». Derived from the Trupp, not from the button. The log row
underneath is an ordinary `entry`, and ↶ takes it back like any Eintritt. The Abschluss's
«Als «nicht eingesetzt» schliessen» writes the existing «Trupp … nicht eingesetzt» row, one per
Trupp still angemeldet. «Bestimmen» at the Sicherungstrupp head on an existing Trupp is an
ordinary edit («Auftrag Sichern»). The Notfall banner's «Sicherungstrupp bestimmen» (2026-10-30)
can also name a crew that is inside: its own row «Trupp N (…): als Sicherungstrupp bestimmt –
Notfall Trupp M (…) – bisher Löschen» (`notfall.logSafetyDesignated`, `useTruppActions ·
designateSafety`), because that crew never writes a first Eintritt again; one ↶ step. A crew
that is out goes through its re-entry form on «Sichern» and writes the re-entry rows. A double contact answered «OK» (another device confirmed it < 60 s ago)
writes nothing at all.

⚠️ **The first Druck after the Eintritt is a Kontakt that says what it replaced** (2026-09-25):
within 3 min of the Eintritt, with no reading yet and an Eingangsdruck nobody set, a Druckmeldung
writes ONE row — «Trupp N (…): Kontakt – erste Druckmeldung 260 bar ersetzt den Eingangsdruck 300
bar» (`logFirstPressure`) — resets the contact clock and appends a `contact` log row beside the
corrected baseline. It used to be only an edit row («Eingangsdruck 300 → 260 bar») with no Kontakt.
A double tap on «Kontakt» writes one row, not two.

⚠️ **The crew reaches the Anwesenheit once, and the row names people** (2026-09-25, staging r2):
the Gäste a Trupp form files at its save are filed quietly and named in the crew's ONE «Unter AS:
…» row (never twice, never by id). A crew registered on the Atemschutz-Link writes no «erfasst»
row there (the link cannot write the Anwesenheit); an editor device that sees the Trupp files the
crew under derived ids and writes that one row under a derived row id (`atc-<truppId>-…`,
lib/crewFiling), so several devices write it once — and only once per (Trupp, person): the
Trupp's `crewFiled` marker keeps a deliberate deletion from the Anwesenheit deleted. «Nicht eingesetzt» closes a Trupp with an
`exit` log row that is LABELLED «Nicht eingesetzt» on the card and on the Rapport, never
«Austritt» (lib/atemschutz · isStandDownExit).

⚠️ **Two contact kinds have been kinds of their own since 2026-08-19**, no longer «Kontakt»: the
**exit** («Ausgerückt») and the **re-entry** after a Rückzug. The safety clock is untouched by
this – a re-entry resets it just like a contact does – but the printed Atemschutz journal now
reads as a chronology instead of breaking off mid-deployment.

⚠️ **The alarm is written once per cycle**, not per tick. An overdue contact clock used to write
the same row every few seconds; the next one is only due after a radio contact that has reset
the clock. Sound and system notification deliberately do **not** hang off it.

## Deliberately silent

| Area | Why |
|---|---|
| Zeitplan / shifts | `src/lib/useShiftActions.ts` · `useShiftActions` (doc comment): *«attendance is a RECORD … a plan is not, and logging each nudge of a chip would bury the operational journal under bookkeeping»* |
| Checklists | only milestones create a row (`src/lib/useChecklistActions.ts` · `milestoneRow`): «☑ …» on a tick, and since 23.09.2026 the appended correction «Meilenstein zurückgenommen: …» (↶ glyph, Bereich «Checkliste») on an un-tick – by tap and by ↶ alike (`describeStep`), one row per step, ☑ again on a re-tick or ↷ |
| Editing drawings (color, style, geometry) | operator action, not an event – see the doctrine note below |

The doctrine lives in the AdFU workflow description: *«Der Verlauf ist keine automatische
Einsatzchronik … Der AdFU sollte nicht jede Bedienhandlung protokollieren.»*

## The Meldeleiste (23.08.) writes nothing of its own

The Meldeleiste – the single message strip under the top bar that replaced the nine banners –
is a **display, not a record**: that a message appeared or was swiped away is written nowhere.
What is *done* on it runs through the same handlers as everywhere else and therefore writes
the same rows:

- **«Erledigt»** on a due Wiedervorlage (follow-up reminder) appends the done row
  (`useReminders.ts` · `doneLog`), **«+10 min»** the postpone row – exactly the rows the
  check-off ring in the Verlauf writes. One obligation per row: since 23.08. **every** due
  Wiedervorlage has its own row on the strip («2 Erinnerungen fällig» named two and
  completed one).
  Since 23.09.2026 both doors are **confirm-with-undo** (`useReminders` · `completeReminder`):
  the toast «Pendenz erledigt: … · Rückgängig» (and ↶) appends **«Pendenz wieder offen: …»** /
  «Erinnerung wieder offen: …» (`reminder.op: 'reopened'`) beside the done row, which stays;
  ↷ appends a fresh done row. The toast drops its ↶ entry, so the act is never taken back twice.
- The **Atemschutz alarm row** reads the same fold that plays the sound and writes nothing
  new – the alarm's Verlauf row is created once per cycle as before (see above).
- **Swiping away (✕), take-over navigation, «Zum Trupp»** write nothing – view, not
  content. Taking over an alarm itself writes through its existing path.

## Drawings: creating, naming and deleting are on the record – arranging is not

The review of 21.08. noted that the word **«Fläche»** did not appear on this page. The finding
was a gap in the *docs*, not in the Verlauf – this is what the truth looks like
(`src/lib/useMapDrawing.ts`, copy keys in `src/config/copy/de/drawing.ts` · `log` – the copy
is split per surface into `src/config/copy/de/<surface>.ts` since 2026-10-09):

- **Creating writes:** ONE row shape for every drawn shape, «{name} gezeichnet» (`shapeDrawn`,
  since 31.08.), named by `lib/drawingEdit` · `drawingLogName` – «Fläche gezeichnet»,
  «Absperrkreis gezeichnet», a line preset's own name or «Linie gezeichnet». On the Plan: «Fläche
  auf Plan gezeichnet» / «Linie auf Plan gezeichnet» / «Absperrkreis auf Plan gezeichnet»
  (`whiteboard.placeArea` / `placeLine` / `placeCircle`, written by `Whiteboard.tsx`) – **since 23.08. with
  annotation, point and floor**, so that the jump from the row selects the object instead of
  merely opening the building. Older rows stay without coordinates (append-only) and keep
  opening only the Plan, as before.
- **Naming writes one row** – «Fläche «Sammelplatz»» (`drawingLabelSet` /
  `drawingLabelCleared`), on leaving the field, not per keystroke: the name is the one edit
  that says what the shape *is*, and it used to reach the document silently.
- **Deleting writes** «Zeichnung entfernt» / «{n} Objekte entfernt».
- **Arranging does not write:** color, style, geometry, vertices are operator actions and
  land only in the audit stream (`draw.edit`) – that's the deliberate silence from the table
  above, and it applies to the Fläche just like to every other drawing.

**Two exceptions, and each is a row: a GPS-coupled Leitung loses a drive** (since 24.09.2026,
`src/lib/gpsReturn.ts`, `useMapDrawing · revertGpsFollow` / `releaseGpsOnSite`). A Leitung end
coupled to a vehicle's GPS that has *followed* the vehicle off site traced the drive into the
line. Taking that drive out again is not arranging – it changes the hose line the Rapport prints –
so both acts that do it write ONE row (icon `pen`), naming every line of the one vehicle the tap
acted on:

| Act | Row | ↶ |
|---|---|---|
| «Zurück auf Stand am Einsatzort» – the line exactly as it stood when following began, detached there | «{Leitungen}: zurück auf Stand am Einsatzort ({hh:mm}), von {Fahrzeug} gelöst» (`gpsReverted`; `gpsRevertedBare` without the vehicle when it is out of the feed) | one step, its bubble «{Leitungen} zurück auf Stand am Einsatzort rückgängig gemacht» |
| «Am Einsatzort lassen» / «Am Einsatzort lösen» that CUT a trace back to its on-site end | «{Leitungen}: am Einsatzort von {Fahrzeug} gelöst, Fahrt entfernt» (`gpsReleasedOnSite` / `…Bare`) | one step |

The audit stream gets `draw.edit` (the new coords) + `draw.detach`, so the replay folds the same
line. The acts around them stay silent, like every other attachment change: «Weiter folgen»,
«Folgen stoppen», «Hier lösen (Spur behalten)» (it keeps the drive: nothing leaves the record),
«Am Einsatzort lassen» on an end that never traced, a hand dragging the end off (audit
`draw.edit` / `draw.detach` only). The GPS Meldungen themselves («TLF fährt weg · 340 m vom
Einsatzort», «TLF wieder am Einsatzort») write nothing – they are the Meldeleiste, see above – and
answering the «back» offer with «Weiter folgen» or waving a «stopped» row away with ✕ is
remembered on the device only.

Why a real log can still show 0 «Fläche» hits: on the Lage people draw mostly with lines and
symbols – the row appears the moment somebody drags out a Fläche.

## One object, two surfaces: what a reference change writes (2026-09-10)

⚠️ **The transfer is gone, and so is the row it wrote.** «Hierher übertragen» existed because an
object lived on exactly one surface and had to be *moved* between them; it does not any more. An
object is ONE record whose position is knowable on both surfaces (`src/lib/tacticalObjects.ts`),
and dragging it from one to the other is an ordinary drag that flips its anchor. There is no
committed «transfer» to write down, and the two rows `twinTransferredToMap` /
`twinTransferredToPlan` are deleted. Rows already written stay: the journal is append-only.

**Dragging an object between the surfaces writes nothing of its own.** A drag on the Karte writes
«{name} verschoben» (`objectMoved`) exactly as it always did, wherever the object was standing
before; a drag on a sheet is a plan edit and stays as silent as every other one (see the doctrine
table above). What *is* on the record is the object's position, in both views – see the audit half
below.

**What a changed GEOREFERENCE writes – four rows, because they are four different acts**
(`src/IncidentWorkspace.tsx`, the `linkedPlans` effect; the wording lives in
`config/copy/*` · `log`, the decision in `src/lib/georefTwins.ts` · `fitChangeCause`):

| Row | When | ↶ |
|---|---|---|
| «Referenz angepasst – {n} Objekte neu verortet» (`referenceRebaked`) | a **hand** corrected the fit: moved a cross, transferred a Passung | yes – one step for all n |
| «Blattform gemessen – {n} Objekte neu verortet» (`referenceRemeasured`) | the **app** measured the sheet and re-solved the SAME pairs in a truer shape (`noteMeasuredAspect`) | yes |
| «Referenz entfernt» / «… – {n} Objekte behalten ihre letzte Position» (`referenceDropped` / `referenceDroppedKept`) | «Referenz zurücksetzen»: the fit is gone, and **nothing moves** – both bodies stand where they stood | no – nothing moved |
| «Referenz-Änderung verworfen – Speichern fehlgeschlagen» (`referenceRolledBack`) | the station document PUT was refused (409 or offline) and the optimistic write was rolled back | no – the correction above it never stuck |
| «Plan mit Karte verknüpft – {plan}» / «… – {n} Objekte verortet» (`referenceLinked` / `referenceLinkedPlaced`) | a **hand** linked a sheet that had NO fit (second pair placed, «Übernehmen», «Passung übertragen»). Written by the ACT (`georefMode · noteHandLink` → `georefTwins · handLinkRow`), not by this effect, which reads a first link as a seed like a plan finishing loading (24.09.2026) | no own step – the act's own ↶ (the binding's step, «Übernehmen»'s undo toast) |

⚠️ **The same visible effect is not the same act.** The first two both move every symbol on that
sheet and both are one journalled step, but «Referenz angepasst» over a measurement credits the
operator with a correction nobody made, and the ↶ then offers to take back an act that never
happened. The last two earn **no undo step at all**: nothing moved, so there is nothing to step
back to, and a stack entry for it would be a step the operator never took.

⚠️ **A deleted reference has to say so itself.** Nothing moves when a fit vanishes, so the re-bake
honestly reports 0 – and without its own row the Verlauf would say *nothing whatever* about an act
somebody performed on purpose, after which every symbol on that sheet stands on a ground position
nothing will correct again.

### The audit half: two views, and the events that keep them coherent

Replay reconstructs the three legacy views (`entities` / `drawings` / `board`) out of a snapshot
plus folded events (`src/lib/replay.ts`), and it stays view-based on purpose – an object would
have to be projected through a fit, and the only fit a replay has is *today's*.

- **An anchor flip emits a PAIR.** The surface a finger is on speaks its own document only, so a
  map drag of a sheet-anchored object emits `entity.move` **plus** the `board.delete` for the anno
  that left the sheet, and a plan drag of a projected one emits `board.add` **plus** the
  `entity.move` to the freshly baked ground point. The store is what reports the flip
  (`tacticalObjects · anchorChanges`), because neither surface can see it. Without the second half
  the scrub showed one object twice, or in neither place. Audit only – no Verlauf row.
- **`board.move` is folded** (since 2026-09-10). It is what the plan surface emits on every native
  release – Trupp chip, Absperrkreis, stroke body, SelectionBar group – and nothing folded it, so a
  symbol advanced on a Modul sheet stood still in the replay until the next snapshot. Audit only.
- **The georef re-bake emits nothing**, deliberately: n `entity.move` rows would put n placements
  into the record that nobody made. The **snapshot** carries it – the re-bake marks the workspace
  dirty and the save that follows is snapshotted server-side. Between the two, a scrub shows the
  pre-correction positions. That is the one place the fold's coverage stops.

## «Gelöscht / erledigt» and «Entfernen» (2026-09-24)

Übung 23.09.2026: the fire on the EG was out, so somebody **deleted** the Feuer symbol at 20:40 –
the Rapport's plan then showed no fire at all, and the plan wrote no row for the deletion (the
Karte does). Review item 21b split the two acts (`src/lib/objectDone.ts`):

| Act | Verlauf row | Audit | ↶ |
|---|---|---|---|
| «Gelöscht / erledigt» (the «Erledigt» toggle in the foot of a damage/hazard symbol's editor sheet – never offered for a Fahrzeug, a KP, a Hydrant) | «Feuer EG gelöscht» – a Feuer is «gelöscht», every other symbol «erledigt» (`objectDone.logDone`), with the storey it stands on | `entity.edit` **and** `board.edit` with `{ done: {at, by?} }` – both views, see below | yes – one prop-edit step; the ↶ writes its own «… rückgängig gemacht» |
| «Wieder aktiv» (the pressed «Erledigt» tapped again) | «Feuer EG wieder aktiv» (`objectDone.logReopened`) | the same op with `{ done: null }` – `null`, because JSON drops `undefined` and the replay would fold an empty patch and keep the symbol grey | yes |
| «Entfernen» (single object) on the **Plan** | «Feuer entfernt» – the Karte's own `log.objectDeleted`, named the way the Karte names it (`drawingEdit · annoLogName`), carried as `subjectId` | `board.delete` | yes, as before |

- **One act, one row.** Each row is written by the act's own handler (`IncidentWorkspace ·
  setEntityDone`, `Whiteboard · setAnnoDone` / `usePlanRemoval · logRemoved`) and nowhere else:
  the store fold writes none, the Karte's edit-settle window (`entityEditChanges`) does not read
  `done`, and a plan removal of a *projected* Karte object goes through the plan's handler only.
- **Replay stays coherent because the act emits BOTH views' op** – the pair, like an anchor flip.
  The surface a finger is on speaks its own document, and the replay folds views: a mark on a
  plan also emits `entity.edit` (the Karte's baked or own body; a symbol with no map body folds to
  nothing), and a mark on the Karte of a sheet-anchored symbol also emits `board.edit` for the
  sheet that owns it. With one op only, the other replayed view stayed red until the next
  snapshot. (Other symbol props do not do this yet; `done` does because the record's claim «the
  fire was out at 20:40» must hold in both views.)
- ⚠️ **Accepted limitation, same as every object prop:** objects merge WHOLE (`mergeById`,
  last-writer-wins per object), so device A's «Wieder aktiv» and device B's concurrent edit of the
  same symbol (say its Anzahl) can leave the picture with B's version – still grey – while the
  Verlauf holds A's «Feuer EG wieder aktiv». The row stays true as a record of the act; the
  picture follows the merge.
- **A group** of several removed on the Plan keeps «{n} Objekte vom Plan entfernt»; a «group» of
  one writes the single-object row. An empty Notiz writes nothing, as on the Karte.
- ⚠️ **The two acts never share a verb** (decided 2026-09-25). Every removal row – Karte and
  Plan, every object kind – says «entfernt», the word of its button «Entfernen»: `objectDeleted`
  «{name} entfernt», `drawingDeleted` «Zeichnung entfernt», `selectionDeleted` «{n} Objekte
  entfernt», `groupDeleted` / `groupDeletedN` «Auswahl entfernt» / «{n} Objekte vom Plan
  entfernt». «gelöscht» is left to the extinguished Feuer. Rows written before keep «… gelöscht»
  – the journal is append-only, and the Rapport prints the row text as written.
- **Audited app-wide after the second staging walk-through (2026-09-25).** Every other template
  that takes something off the picture says «entfernt» too: `atemschutz.logRemoved` «Trupp {name}
  entfernt» (the Trupp leaves the board; the Rapport already said «Von Tafel entfernt»),
  `whiteboard.trailCleared` «{name}: Spur entfernt», `whiteboard.floorRemoved` «Geschoss
  entfernt» (the ↶ label) plus the storey removal's own new row `floorRemovedLog` /
  `floorRemovedLogMarks`; and the buttons and confirms before them («Spur entfernen», «Marker und
  Spur entfernen», «Geschoss entfernen», «… entfernt oder gekürzt»). Kept on «gelöscht»: records
  that are not on the picture – a Verlauf Eintrag, a Schicht, an Anwesenheits-Zeit, a Mittel
  line, a saved Ansicht, an Übung. `config/copy/removalWords.test.ts` pins the picture's set.

## A taken-back act is two rows – on paper too (2026-09-25)

Round 3 of the staging walk-through: the printed Einsatzjournal described things that had been
taken back. Two causes, both closed:

- **The Rapport now prints the ↶ / ↷ rows** (`lib/report · journalRows`, `kind: 'history'`, and
  the plain «Aktion rückgängig gemacht» rows it used to omit by text). With only the first half,
  «Symbol «Feuer» gesetzt» stood on paper next to a Kroki that showed no fire. The journal is
  append-only, so both rows print, in order.
- **Every undo that RESTORES something writes its counter-row, whichever door it came through.**
  A confirm-with-undo toast is the same act as the header's ↶ (`IncidentWorkspace ·
  oneShotUndoToast`): it writes the same row the timeline would, then drops the timeline entry.
  - Gebäude storey removed: «Geschoss 3. OG entfernt» (with the markings it took, if any) →
    «Geschoss 3. OG wiederhergestellt» from the toast or ↶ (`whiteboard.floorRestoredLog`), and
    ↷ writes «entfernt» again.
  - Storey added, Gebäude replaced: the toast writes the same «… rückgängig gemacht» the ↶
    writes (it wrote nothing).
  - A Trupp undocked from its host: the toast's re-dock writes «{name} bei «{host}»».
  - An Anwesenheit row cleared: the toast writes «Anwesenheit wiederhergestellt: {name}».
  Toasts that undo an act which wrote no row (a shift, a Rapport-Beilage, an attendance block)
  still write none: there is nothing on the record for them to answer.
- ⚠️ **The rule, stated once (final walk-through, 2026-09-26, D6): a counter-row exists only
  beside the row it counters.** Writing side: a one-shot whose act wrote no row takes its ↶ / ↷
  silently (`rememberOneShot(…, 'silent')`) – an Ansicht saved, renamed or deleted, the Gebäude
  Drehung, a Gebäude swap, a Rapport-Beilage added, captioned or removed. (The audit chain still
  gets the step: `undo`/`redo`, and `report.undo`/`report.redo` for a Rapport one, so an `el`'s
  event scope keeps it – RBAC audit, 22.10.2026.) Paper side: a move
  writes a row on screen but never prints (`report · printableTacticalText`), so its ↶ / ↷ does
  not print either (`report · historyCountersPrintedRow`) – «KP Front verschoben rückgängig
  gemacht» stood alone on paper. A ↶ row that names no act (the old «Aktion rückgängig gemacht»,
  a domain word like «Änderung auf der Karte») still prints: it is the record's only statement
  that something was taken back.
- **Storey rows name their storey** (`subjectId` `storey:<n>`, `lib/storeyRemoval ·
  storeySubject`), so the repeat fold keeps removals and restores apart («entfernt 2×» /
  «wiederhergestellt 2×» on paper, where the order was entfernt, wiederhergestellt, entfernt,
  wiederhergestellt) and never folds two storeys. Adding a storey writes «Geschoss 4. OG
  hinzugefügt» now (it wrote nothing), taken back as «… entfernt».
- **A ↶ / ↷ row ends every repeat run** (`lib/verlauf · repeatRuns`). «Gefahrentafel angedockt» ·
  ↶ · «… angedockt» again within two minutes folded into ONE row «2×» – the paper then said the
  placard was docked twice with nothing in between (F2c). It was two acts; the dock row has one
  writer (the hand's own gesture, `IncidentWorkspace · finishEntityMove`), carried placards and
  merges write none, and journal rows merge by id. («Lösen» in the placard's panel gets its
  «… von «{host}» gelöst» row in PR #232.)

## What a Verlauf row can carry since 17.08.

The row is no longer just text and a timestamp. Four properties have been added, and all four
are **properties of an entry**, not row kinds of their own – which is why they fit existing
incidents without a migration:

| Property | What it means | Where it shows |
|---|---|---|
| **Pendenz** (open ring) | the row is not done; its own thread of **Meldungen** | at the top of the Verlauf, urgent first; on the Rapport as «Aufträge / Pendenzen» with «offen» |
| **Fälligkeit** (reminder) | Wiedervorlage with **day** and time; a moment in the past is rejected | clock in the meta row; on the Rapport «fällig HH:MM» |
| **Korrektur** | a typed row was rewritten; both wordings stay in the record and in the hash chain | «korrigiert HH:MM»; on the Rapport additionally «ursprünglich: ‹…›» |
| **Transcript sections** | the words of a voice memo, each with an offset into the recording | subtitle lines under the row, same on paper |

⚠️ **Only what a human typed is correctable** – composer entries, Meldungen,
Nachdokumentation. **Never** what the app wrote about an action: «Trupp 2 eingerückt»
is the record of an event, and rewriting that sentence would mean letting the journal claim an
action that never happened that way. The entry kind alone cannot tell the two apart (a
checklist tick is a row too), the icon has to weigh in.

⚠️ **A Pendenz hangs off the lifecycle event, never off `entryType: 'auftrag'`.** Bound to the
field, every Auftrag row ever written – running incidents and archive alike – would have
become a forever-open Pendenz nobody can check off.

⚠️ **Repetitions are collapsed on READ**, not on write (`lib/verlauf` ·
`repeatRuns`): the first row appears with a «6×» marker, all repetitions stay in the
append-only record. **Hand-written rows are never collapsed** – whoever types the same thing
twice meant it twice.

**Since 23.08. the chip in front of the row is gone** – the row is a grid of
time · disc · sentence · trailing footnotes. The 26px disc carries the **section the printed
Rapport names** (Anwesenheit, Mittel, Atemschutz, Auftrag …; the mapping itself arrived
on 19.08.), and becomes the check-off ring on a Pendenz; Nachtrag, «korrigiert» and «6×» sit as
footnotes after the sentence instead of before it – since 27.10.2026 on a line UNDER it, with the
missing-transcript and upload chips and a done Pendenz's «wieder in» pills, so the trailing group
holds the row's own controls only and the sentence
keeps the row's width (a phone broke «Audionoti|z (24s)» between NACHTRAG, ⚠ Transkript and the
play circle). ⚠️ **Only what is drawn changed** – what is
written, printed and hashed did not: the row renders `e.text` byte for byte, and old rows with
old icons keep being classified by the existing rules exactly as before (both nailed down by
tests, `Journal.test.tsx`).

**A row is a tap only where it still leads somewhere** (28.10.2026, owner: «only things we can
actually click on if they still exist»; `lib/verlauf` · `rowTarget`): a Wiedergabe makes every row
a tap (it sets the moment); otherwise a row opens its detail sheet, or jumps to its map object,
map point or plan object – and only while that object is still there (`liveTargets`: the Karte
objects and drawings, the plan catalog, the plan's objects; a duplicated line lands on the copy). A **removal row** (the ✕ glyph) is never a jump;
a pre-23.08. plan row without an `annoId` still lands on its plan; a map point (`coord`) always
lands.

## Closed (2026-08-07)

- **The Erfassung writes to the Verlauf.** Every poster mutation runs through `saveAction`
  (`src/lib/captureClient.ts`), which appends a row after the accepted workspace write –
  with «(QR)», because the legal document has to state that no signed-in person is behind it.
  Best effort: the state is already saved, and a poster is a phone at the station door – a
  failed journal write must not make the tap fail, but it is logged loudly.
- **Rapport details and partner organisations write a row** – one per save, naming
  *which* fields changed (`changedReportMetaFields`, `src/lib/report.ts`).

⚠️ **Superseded 2026-08-28 (commit `99c4348`):** this section used to also list the Atemschutz
safety values (contact interval, grace period, default Funkkanal) writing a row with old and
new value when changed from the in-app Einstellungen sheet (`changedSafetySettings`,
`src/lib/workspace.ts`). That sheet no longer offers those fields at all – they are station
doctrine, set only from `/admin` › Doktrin, which does not write to the Verlauf. The dead
`changedSafetySettings` code path was removed on 2026-09-23; `git show 99c4348^:src/lib/workspace.ts`
has it if an in-incident safety editor ever comes back.

## Closed since then (2026-08-17 to 2026-08-19)

Three of the six gaps below are closed. They are named here so nobody reopens them from an old
version of this file:

- **Removing an attendance block** writes its row (`useAttendanceActions.ts` ·
  `abschluss.attendanceRemoved`). On top of that, **attendance as a whole is now undoable**,
  with its own stack and a correction row in the Verlauf that names who was moved.
  ⚠️ That row carries the icon `people`, **not** `undo`: the section is derived from the icon,
  and `undo` is also the icon of the Atemschutz-Rückzug – so the row used to print under
  «Atemschutz». Older rows are retroactively classified correctly via the copy template.
- **Naming a drawing** writes **one** row instead of one per keystroke. The field patches
  silently while typing (one undo step for the whole edit) and writes, on leaving or with
  Enter, what the label *is* – instead of narrating the way there.
- **The remark of a partner organisation** reaches the Verlauf and thus the printed
  Journal. It used to go only into the Rapport field. **Deleting** a remark now says so too.

**Partially closed:** corrections to the alarm time, address, Stichwort (dispatch keyword) and
priority create an audit event (`meta.change`, `_TRACKED_META` in `backend/app/api/incidents.py`) –
but still **no Verlauf row**. Whoever reads the Verlauf does not see the correction.

## Gaps – known, not yet closed

These are **not** covered by the doctrine: they concern the content of the record itself,
not operator actions. Ordered by operational impact.

1. **Corrections to the incident data** are in the audit, not in the Verlauf (see above).
   `started_at` is a field of the legal document and even carries its own
   `started_at_source = "manual"` – but nobody can look the change itself up in the Verlauf.
2. **Changing the line number of a drawn hose line** – audit only (`truppActions/lines.ts` ·
   `atemschutz.line.renumber`). This number is what maps which Trupp works on which
   Leitung – so the mapping can be shifted silently. ⚠️ Since 19.08. a renumber pulls the
   number onto the Trupp (**via the anchor, never via the number**), so the mapping *is*
   correct – but the shift is still recorded only machine-readably.
3. *(closed 2026-09-24, see «Gelöscht / erledigt» above)* ~~Deleting a single Plan annotation~~.
4. **Rapport attachments** – adding/removing audit only, the image caption not at all
   (`src/IncidentWorkspace.tsx`, Rapport attachments block).
5. **Driver of a GPS vehicle** and **creating a building** have no channel. *(Adding and removing a
   storey write their own rows since 2026-09-25/26 – «Geschoss 4. OG hinzugefügt», «Geschoss 3.
   OG entfernt» with the markings it took or cut short.)*

*(The file paths deliberately carry no line numbers: this file has gone stale twice because
`IncidentWorkspace.tsx` moved, not because the behavior changed.)*

## If you add something

- An action that changes the **content of the record** belongs in the Verlauf.
  An action that only changes the **view** belongs at most in the audit stream.
- Deleting and creating belong in the same channel. The asymmetry is what makes people
  believe nothing is recorded at all.
- The Verlauf is append-only: a correction is a new row, never an edited one.

## Rules for new rows

**Deleting and creating belong in the same channel, on both surfaces**: a single object removed
on a Plan writes the Karte's «{name} entfernt» (24.09.2026, `drawingEdit · annoLogName`, as a
`subjectId`, never a jump target), and «Gelöscht / erledigt» writes «Feuer EG gelöscht» /
«Feuer EG wieder aktiv» from the act itself — one row per act ([`docs/verlauf-coverage.md`](verlauf-coverage.md)).
