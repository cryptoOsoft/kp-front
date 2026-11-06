# Undo and redo

The one undo timeline: the rule, how an act joins the timeline and what a remote merge does to
it (`lib/undoTimeline`, `lib/undoKeys`). Moved here from AGENTS.md on 2026-10-08 (the rule on
2026-10-18), wording unchanged.

## The rule

- **Undo/redo – every mutating op should be undoable, scoped to the workspace.** ONE
  chronological timeline for the whole Einsatz (`lib/undoTimeline`), driven by the TopBar's ↶ ↷
  and by Cmd/Ctrl+Z on every surface – so «take back the last thing that happened» never asks
  which surface you are standing on. Three ways to join it – delegating, closure and the
  confirm-with-undo toast – and the choice is decided by what the domain already owns (below,
  with what a remote merge does to the timeline).
  Deliberately NOT undoable: append-only records (Verlauf rows, audit events – corrections are
  new appended rows), device preferences (Ebenen, Einstellungen sheet) and server-side incident
  metadata (`PATCH /incidents`). Add undo for new mutations; don't skip it.

## How an act joins the timeline

One act spanning several domains uses `UndoTimeline.group`. A toast's dropper removes the
recorded group from either stack, including a group reduced to one part before it closed.

- *Delegating* – the domain keeps its own history and the entry calls it: the Karte's document
  (`useUndoableDoc` through `useObjectStore`), a Plan's per-document history (`useBoardDoc`),
  and the synced slices (`useUndoableSlice` – Anwesenheit, Mittel, Checklisten, **Rapport**,
  **Zeitplan**). Always through a **ref**: the entry outlives the render that pushed it.
- *Closure* – the entry carries its own inverse, for a domain with no stack: the
  Atemschutz-Tafel, the Gebäude one-shots (floor add/remove, building replace, Drehung),
  Rapport-Beilagen, Ansichten (`rememberOneShot`), a Pendenz corrected on the Tafel's «Aufträge /
  Pendenzen» page (its inverse is another appended correction, `workspace/useTafelPendenzen`).
- *Grouped* – one act over the Tafel and the Checklisten (05.11.2026, `lib/problemLink`): a
  problem's Tendenz set on a page writes the checklist's, a checklist problem deleted on a page un-ticks
  it – the board write and the slice write are ONE step (`UndoTimeline.group('plan')`,
  `usePlanTafelPages · editPage`). The bin's toast «… gelöscht · Rückgängig» takes back the step
  on top of ↶ (the same `stepHistory`), and declines once that is no longer its step.
- *Confirm-with-undo toast* – the fast door beside the header pair, for a one-shot that
  destroys something (a Geschoss, a Beilage, an Anwesenheits-Block, a Pendenz's «Erledigt» —
  whose inverse is an APPENDED `reopened` row, since 23.09.2026; and the **Abschluss** itself,
  since 23.10.2026: «Rapport abgeschlossen» carries «Wieder öffnen» for 10 s, `lib/useIncidentLifecycle ·
  completeRapport` → `reopenNow` — the same reopen «Alle Einsätze» runs without its confirm, and
  a reopen the server refuses is said, not retried). It does the inverse
  itself and **drops its timeline entry** (`push` returns the dropper), so an act is never
  undoable twice. ⚠️ …and it writes the SAME counter-row the ↶ would (25.09.2026,
  `IncidentWorkspace · oneShotUndoToast`): a storey restored from the toast used to leave
  «Geschoss 3. OG entfernt» alone on the printed Einsatzjournal. The Rapport prints the ↶ / ↷
  rows as well (`report · journalRows`) — a taken-back act is two rows, on paper too. ⚠️ And a
  counter-row exists only beside the row it counters (26.09.2026): a one-shot whose act wrote
  no row undoes silently (`rememberOneShot(…, 'silent')`), and a ↶ of an act the paper does not
  print (a move) is not printed either (`report · historyCountersPrintedRow`).
Two rules that fall out of it: a surface that persists on every **keystroke** classifies its
writes so a burst of typing is ONE step and a value/row appearing or disappearing is its own
(`lib/reportUndo`, `UndoableSlice.set`'s `coalesce`); and a remote hydrate closes the open
fold windows — the Rapport's typing burst (`lastReportStep`), the Bildlegende
(`lastCaptionStep`), the Gebäude-Drehung (`lastReorient`) — and re-opens a plan gesture whose
step the merge took: the store's sheet-step token (`useObjectStore · rebaseObjects`) and the
Whiteboard's first-movement checkpoint (`useBoardDoc · set`) each lay a fresh step at the
gesture's next sample.
- ⚠️ **A remote merge drops only the steps it INVALIDATED** (25.09.2026, `lib/undoKeys`,
  `UndoTimeline.rebase`) — this REVERSES the 08.09. rule that dropped the whole timeline on
  every hydrate, which with three devices greyed ↶ out within ~2 s of any save anywhere.
  `applyWorkspace` diffs the live state against the merged one record by record, at or coarser
  than the merge's own granularity (`WORKSPACE_RECORDS`: an object/Trupp/Mittel row by id, an
  Anwesenheit by person, a Rapport field by name, `building:` whole; `planview:<planId>` for a
  sheet whose drawn view moved, `planview:*` when a fit field did). The diff is by value and
  insensitive to key order ONLY (an `undefined` property counts as absent): array order and
  every value are compared exactly — the merge's own comparison (`undoKeys · sameValue` IS
  `lib/jsonEqual`), so «the merge changed this record» and «this side changed it» never
  disagree about a re-sorted value. Every entry says which records its undo/redo TOUCH
  (`touches`): every record it writes, AND every record one of those values LINKS to — a
  placard's `dockedTo`, a Leitung end's attachment target, a `truppId`, a Gebäude body's
  `building:` (`objectRefs` / `annoRefs`, old value and new) — because re-stating a link means
  «where the target is NOW», and a ↷ that re-docks onto a host another device moved would land
  at the old spot. The merge drops each entry that touches a changed record, plus — walking in
  the order the steps would be taken — every entry behind a dropped one that touches a record
  the dropped one touched (its effect is now permanent). An entry with no `touches` is dropped
  by any real change, and so is everything older. An echo drops nothing. The delegating
  domains then keep exactly the steps whose entries survived (`step`), RE-LAID onto the merged
  state as a patch of the records each wrote (`rebaseHistory`; an open Karte drag via
  `rebasePending`) — the Karte store per object, the slices per record — so no snapshot carries
  a pre-merge value of a record the merge changed. A Plan's stack is whole-sheet VIEW snapshots
  (an absent anno is a deletion), so it cannot be re-laid: it survives only WHOLE
  (`planStackTouches` names the stack's every object, link and its view), cut by step id
  (`keepPlanSteps`). The confirm-with-undo toasts are guarded too: `undoToast(…, guard)`
  declines with «Nicht mehr rückgängig machbar» once a merge changed a record it would write or
  link to (or its entry is no longer `standing`); a toast whose target lives outside the
  workspace checks the target itself (`georefStillIs`, `mittel · tombstoneStands`). The whole
  bookkeeping runs through `carryUndoThroughMerge`: if any of it throws, the old rule applies
  (timeline cleared, every history dropped, the merged state still lands). ⚠️ ↶ never turns
  into an older act SILENTLY (staging r3, F8): when a merge drops the step ↶ would have taken
  back, one line says so («Letzter Schritt nicht mehr rückgängig machbar – ein anderes Gerät
  hat … geändert», `onTopDropped`), and the header's label and flash caption name the SURFACE
  in front of an action that does not already say it («Trupps · Trupp 1 (…): Ausrüstung: WBK»,
  `undoTimeline · undoCaption`, `copy.undoSurfaces`) — the Verlauf row keeps the bare action. Add an entry ⇒ give
  it a `touches` that covers EVERYTHING its undo and redo write, and every record those values
  link to; add an id-valued link field ⇒ add it to `objectRefs`; add a synced slice ⇒ its
  `WORKSPACE_RECORDS` row (tsc asks) AND its entry in `liveWs` (tsc asks too, `RecordedField`).
  A Trupp's grow-only `crewFiled` marker is not part of its record here, because every Trupp
  inverse keeps the live one (`keepCrewFiled`).
