# The Atemschutz board

The Trupps page: the phone board, the one card every board wears, the Trupp form and its
questions, and what the record keeps (`components/AtemschutzView`; the card and the phone row in
`components/TruppCard`, the form in `components/TruppForm`). Module rules live in
`lib/truppLeader`, `lib/contactEcho`, `components/TruppSheets`,
`components/AtemschutzAlarmMeldung` and `lib/meldeleisteHost`. Moved here from AGENTS.md on
2026-10-08, wording unchanged.

## The board

- **The Atemschutz phone board of the full app** (`AtemschutzView · phoneMode` = phone and not the
  handed-over Tafel; PR #212 and its follow-up, 24./25.09.2026, Übung 23.09.): sections Drin ·
  Sicherungstrupp · Bereit · Draussen, «Drin» by urgency with the 2 s freeze, «Druck | Kontakt»
  with words, one `PressureSheet`. The tablet grid and the Tafel are NOT this board, except where
  a rule below says «every board» — their CARD is (see «The opened card …»). The rules:
  - *The opened card is the row grown downwards* (owner, staging 26.09.2026): the same frame and
    tone, the same line (`RowLine`: dot · name · clock) and the same «Druck 240 bar | Kontakt» pair
    (`TruppPair`) in the same place, collapsed or open, in every tier — opening only ADDS the
    Kennzeile (the tier in words where there is one; the ⋯ at its end), the note,
    Rückzug / Raus, the Sockel line and the Verlauf. No band, no second Kontakt, no Druck row. The
    whole first line is the collapse toggle. ONE card on every board since 29.09.2026 (owner:
    «assimilate the tablet / desktop view closer / equal to the mobile view»): the tablet grid, the
    desktop and the handed-over Tafel (grid and phone focus) wear this same card — line · 2×2
    tiles · state words · note · fact chips · one terse foot that ENDS with the ⋯ (29.09.2026, owner
    pick B — as the facts' last chip it wrapped onto a 44px row of its own). What differs is only
    what the board has room for: on the grid every card stands open (the line is not a toggle, no
    chevron), the hand-set order keeps its ‹ › in the ⋯, and a card on a board without state heads
    (grid, Tafel — `headed` false) says «Bereit» in its state line, which on the phone is the
    section head. The state line never says what the card's colour already says (29.09.2026,
    owner: «drop the überfällig – if the card is red it's pretty obvious»; «the draussen subtitle
    is probably not even required»): fällig / überfällig live on for a screen reader only
    (`.sr-only`), and an out Trupp's card carries no «Draussen» — it keeps the words colour cannot
    carry (the Alarmdruck with its limit, the stopped clock, «Nicht eingesetzt», «Bereit», a work
    squad's state). An überfällig card has NO red wash since 24.10.2026 (sweep M3, G.7 – red for
    danger, a quiet ground): the red left edge, the red clock and the red «Kontakt» carry it. No
    glyph at the clock for überfällig, the Alarmdruck or fällig (30.10.2026, owner: «we don't need
    the triangle thing. red and notfall is already enough»; before that «remove the ugly clock
    icon» for fällig) — the digits' colour is the tier, on the link's tabs too, and the WORD
    («Überfällig», «Alarmdruck», «Fällig») stays in the row's and the tab's spoken name and the
    card's `role=status` line for a screen reader (`truppCardText · tierMark`); only the Notfall
    banner keeps a red wash. A Trupp still at the
    door has no «–:––» (30.10.2026, owner: «show the next action rather than the empty time»):
    its phone row wears «Im Einsatz» in the clock's place (`TruppCard · RowEnter`, the
    Sicherungstrupp row's button), its opened card leaves that cell empty because the «Im
    Einsatz» tile stands right under the line, and a viewer's cell is empty. The link's tabs
    say «Bereit» instead (see «The Atemschutz-Link board» below). The Druck is the pressure tile → `PressureSheet` everywhere; the
    tablet's ± stepper with «Bestätigen», the band with the 40px clock, the tablet's grey
    Kennzeile with its blue Auftrag, the top status edge and the «Verlauf · zuletzt: … Druck 300
    bar» preview are gone — do not bring any of them back for the tablet. The handed-over phone
    board wears no card at all (see «The Atemschutz-Link board» below).
  - *The Schätzung stays readable on the card's foot* (29.09.2026, owner: «we still need the
    schätzung clearly visible»): the terse foot keeps its word and full ink — «1 d 11 h ·
    Schätzung ≈ 0 bar ⌄» — and the word, not a dimmed grey, is what keeps it from being read as a
    logged Druck, and it is never red (24.10.2026, sweep M3). Its alarm case is the note under
    the tiles – «Alarmdruck 100 bar (Schätzung)», number included – as a quiet
    outlined box (grey edge, `--ink-dim` 14/700, no tint, no ⚠ of its own): the red clock
    already says the card is in alarm.
  - *Rückzug and Raus are equal tiles on every board* (29.09.2026): both framed grey, «Rückzug»
    amber only at or under the Trupp's Alarmdruck (`.actAlarm`). A permanently amber «Rückzug
    melden» says «warning» about a Trupp at 300 bar.
  - *«Rückzug» is a badge in the head, not a chip* (31.10.2026, owner: «filled pill in the head,
    but just with an icon»): a Trupp in Rückzug wears a 26px filled amber circle (`--amber`,
    icon `--on-amber`, the Rückzug tile's own `undo` glyph) after its name in `RowLine`, so the
    collapsed row, the opened card and the phone page all show it; `aria-label` and `title` are the
    status word («Rückzug»). `flex: none` – a long name ellipsises before the badge or the clock
    is squeezed. It is not a tier: the side line stays amber only for «Fällig». A Notfall page
    draws its own head (`pageHead`) and so not this badge.
  - *Crew names are never cut* (31.10.2026, owner): the crew chip wraps BETWEEN people only – each
    name is a nowrap span, the « · » is the break – and grows by a line each time; no ellipsis,
    the 36px floor stays (`.factCrew` / `.crewName`). The other chips keep their ellipsis.
  - *A Trupps section head* (Drin · Sicherungstrupp · Bereit · Draussen, and the grid's
    Atemschutz / Weitere Trupps) is the eyebrow and the count badge — no hairline rule to the
    edge (29.09.2026); the boundary is the air above the head — ONE number, 26px (`.sectSecond`),
    and on the phone board ONE adjacency rule gives it to every section after the first, the
    Sicherungstrupp zone included (`.phoneBoard > * + :is(.sect, .safetyZone)`, 30.09.2026:
    Sicherungstrupp and Draussen sat flush on the card above). A head keeps 12px to its first
    card. Never give a section its own top/bottom margins.

## The Atemschutz-Link board (the handed-over phone board, `lite && compact`)

Redesigned 30.10.2026 (sweep #20/#21/#24, owner pick R1 on AB after three mock rounds: «r1 is
good but we don't need the triangle thing. red and notfall is already enough»):

- *The head* is a band, like the tab rail under it (field notes 31.10.2026): `--surface` fill and
  a hairline on its inner side (`.head.headCompact`), where Surface.module.css makes the in-app
  phone board's head «the page's first row, not a band» (it sits flat between the app's top bar
  and bottom bars). The link board has no top bar, so head and rail frame the screen
  symmetrically; the notch is the shell's padding (`.as-link-shell`). It is the Einsatz in full on two lines — its title, then «Adresse · ✓ 12:12» (the save
  stamp's bare time is back now that it has a line of its own) — still the door to the ⌄ popover
  (title, address, the long «Gespeichert um …», and the link's way back «Der Link führt zurück …»
  as one line; it was a once-per-device toast until the link dropped toasts, sweep #23). ↶ ↷ 🔔
  without frames; a muted or blocked bell keeps its tint.
- *No card*: the open Trupp is a flat PAGE — no frame, tint or edge; the tier is on its tab and in
  its clock's colour — and the page scrolls (`.focusCard` is the port; sweep #21 found the card
  clipped). Every page opens with the NAME at 32px (`--fs-6`) and the clock at 40px with what it counts
  under it («SEIT LETZTEM KONTAKT»); a crew at the door says «Bereit» there (`TruppCard · page`).
- *Read at the top, tap at the bottom* (31.10.2026, owner pick «A – Tasten nach unten»: the page
  was top-heavy, the lower half empty where the thumb is): the head, the state words, the note,
  the chips and the foot line («0:21 min · Schätzung ≈ 298 bar ⌄ ⋯») stand on top; the SAME
  tiles stand at the page's foot, right over the tab rail — «Notfall» full width first (reachable,
  but away from the thumb's resting spot), then Rückzug | Raus, then «Druck | Kontakt» lowest and
  64px tall (the others keep 48px). Every state keeps its tiles (Fortsetzen, Notfall beendet,
  Im Einsatz with «Nicht eingesetzt», Wieder in den Einsatz) – only their place moves. The order
  is the DOM's (`TruppCard · page`), so the tab order follows it; the page grows to the port's
  height and `.pageActs` takes the free air with `margin-top: auto`. Taller than the screen, the
  page scrolls and the tiles follow the content – never a fixed bar over it. The Notfall page
  follows the same order under its own head (its «Sicherungstrupp einsetzen» stays in the head).
  The in-app board, the tablet grid and the wide Tafel keep the card's order (tiles under the line).
- *The Notfall Trupp's own page IS the Notfall* (`AtemschutzNotfall · NotfallPageHead`): a red
  rail down the left and a red tint over the whole page, «NOTFALL SEIT 12:12», the name big and
  red, both clocks named («seit Notfall», «seit letztem Kontakt»), then «Sicherungstrupp einsetzen
  <name>» with «Anderer ⌄» beside it (the same candidate menu as «Sicherungstrupp bestimmen»),
  then the Trupp's own tiles. No banner on this board, and no ⚠ in this head.
- *Any other tab during a Notfall*: a solid red strip under the head, «Notfall · Schmid Peter
  0:09 ›» — a tap switches to that Trupp's tab; the strip carries no Sicherung button (its page
  does). One strip per Notfall Trupp up to two, from three on one «3 Notfälle ›» to the first
  (`lib/notfall · notfallStrips`). The page under it stays neutral. The solid red is the red
  darkened to 78 % (`--nf-fill`) so white text reaches AA in both themes.
- *The tab row*: a flat bar — no framed chips — names at 16px (may wrap to two lines), the state
  as a line under the name (`truppCardText · tabState`): «Bereit» green, «Rückzug 0:49» amber,
  the clock otherwise. The open tab wears a soft ink wash; a Notfall (red) tab is red whether
  open or not, filled when open. The tab draws no ⚠ either (owner, 30.10.2026) – a red
  tier's word is `.sr-only` in the tab for a screen reader. «+ Trupp» is a narrow last cell.

## The Trupp form and its questions

- *A door answers the same question the same way* (29.09.2026): the Trupp form and the Auftrag
  sheet share their Ziel and Leitung controls — a plain `ClearableInput` for the Ziel, and
  `TruppSheets · LeitungField` («keine · Ltg n · Nr. …») for the Leitung. «Nr. …» turns into
  the stepper in its own place in the chip row, and a typed number lives there only, never as a
  chip as well (28.10.2026, owner).
- *The form asks Druck and Kanal in the sheets that ask them on the card* (30.09.2026, owner):
  one row each in every mode, «Eingangsdruck 300 bar ›» / «Funkkanal 11 ›», opening the Druck
  sheet (20-bar grid, the form's value filled — `PressureSheet · chosen`) or the Kanal sheet
  (`KanalPickSheet`, pad, or the ± stepper with tap-to-type and «Übernehmen» for a range too
  wide for keys). A tap fills the draft and closes; nothing is written until the form's save.
  The sheets are NESTED in the form's popup (their host stops pointerdown so the form's swipe
  does not move with them); Escape closes the sheet, never the form. The grid and the pad never
  sit inline in the form, and the «Standard: … — Ändern» fold is gone. The low-Eingangsdruck
  «Ändern» opens the Druck sheet; the lock after the Austritt and «Gleiche / Neue Flasche» are
  unchanged. The form's ± steppers are gone — do not bring them back.
- *The Trupp form is a bottom sheet there, with the due clocks above it* (D1 ⑥): at most two
  due/overdue Trupps, most urgent first, each with a live «Kontakt» that confirms without
  leaving the form. The pinned set holds 2 s after a tap and the row just confirmed reads
  «✓ Bestätigt», disabled — it stays under the finger. The rows sit INSIDE the popup (under the
  scrim they would be outside presses). Grab bar + swipe-to-close, which is «not now».
- *A kept draft belongs to ONE state of the Trupp* (`draftKeep`, every width): only «Abbrechen»
  and a save the board CONFIRMED drop it (a «Zurück» on any question in front of the save
  returns to a filled form), but an edit / re-entry draft is keyed on the Trupp as the form
  opened it (sortie + every field the form writes, `truppDraftStamp`) — a new sortie, or a
  Leitung linked on the Karte meanwhile, opens a fresh form. «Gleiche / Neue Flasche» is never
  kept. A door that answers a field (`presetAuftrag`: «Bestimmen» → «Sichern») beats a draft.
- *An edit is a PATCH* (every width, 25.09.2026): only the field groups the form touched
  (`truppFieldGroupsChanged` against the form's own untouched values) are written, onto the
  Trupp as it stands NOW (`truppEditPatch`); a touched group another device changed since the
  form opened is said in one line first, «Zurück zum Formular» focused. A Gast typed into the
  form reaches the Anwesenheit only at the save (`fileGuests`, after every question) — never
  from the picker, and Enter in «Person suchen» only takes a listed person.

- *One person in two active Trupps is a band, not a guess* (audit F05; owner pick B, 26.10.2026):
  the form refuses a double assignment on one device, but two offline devices can each make one
  half and the merge keeps both. `DoubleAssignmentBanner` stands above the sections («Müller Hans
  in 2 Trupps», both clocks running), the named cards wear a steady amber ring, and «Bleibt in
  Trupp …» takes the person out of the other crew(s) after the radio check
  (`useTruppActions · keepInOneTrupp`): crew fields only, works on a deployed crew because it
  corrects a record rather than moving anybody, one Verlauf row and one undo step each. A choice
  that would empty a crew is not offered.

## The Sicherungstrupp, the Abschluss and the record

- *The Sicherungstrupp has ONE place* (D1 ⑦): between Drin and the rest while anybody is in or
  waiting — a quiet dashed slot while nobody is inside, amber from the first crew in, gone once
  every Trupp is out. «Bestimmen» = a waiting Trupp's Auftrag becomes «Sichern» (an ordinary
  edit) or a new one registered on «Sichern». Its first Eintritt writes «Sicherungstrupp
  eingesetzt». The Abschluss (every width) asks about every Atemschutz-Trupp still angemeldet
  that was never inside (a Reserve after earlier sorties was — read the log, `entryTime` is
  cleared on a re-park): «Zur Tafel» (focused) / «Als «nicht eingesetzt» schliessen». Not while
  a crew is still inside, and the stand-down runs only after the FINAL «Abschliessen», re-checked
  against the Trupps as they stand then — a crew sent in meanwhile never gets an Austritt.
  Crews still INSIDE are the Abschluss's own FIRST question, by name («2 Trupps sind noch drin:
  Trupp 1 (…), Trupp 2 (…).»), «Zur Tafel» focused, closing anyway the quiet answer — and after
  the Abschluss the app lands on HOME (useIncidentLifecycle · completeRapport, 05.10.2026; home is «Karte &
  Objekte» since 16.10.2026), never opens another: the closed Einsatz is forgotten on the device
  and `prefs.landedAt` keeps a cold start at home too, until one is opened by hand or a NEWER alarm arrives (pickBootIncident).
  A Sicherungstrupp wears «SiTr» on its row and card at every width, sent in or not.
- *The record is kept whole* (staging walk-through r2, 25.09.2026): the Gäste the form files at
  its save are filed QUIETLY and named once in the crew's «Unter AS: …» row — the crew filing
  knows them (`IncidentWorkspace · fileTruppGuest`) instead of reading a render-old Anwesenheit
  and filing them again. A session that cannot write the record (the Atemschutz-Link) files and
  logs nothing; every device that can OBSERVES the Trupps and files a missing crew under derived
  ids (`lib/crewFiling`) — ONCE per (Trupp, person): the Trupp's `crewFiled` marker (grow-only,
  merged as a union, kept by every undo restore; an `el` sends it with the record slice, which
  the server unions onto its Trupps — docs/sync-and-offline.md) records who was filed or already there, so a
  person somebody takes OFF the Anwesenheit is never written back by another device (the
  ghost-trail trap). «Entfernen» on a crew INSIDE asks first («Raus melden» focused), and
  every removal raises the confirm-with-undo toast. «Nicht eingesetzt» is a VISIBLE quiet button
  on its own row — never beside «Im Einsatz», not hidden in the ⋮ (owner review 26.09.2026) —
  answered by a confirm-with-undo toast, and its log row reads «Nicht eingesetzt», never
  «Austritt». A question dialog of the Tafel has a TITLE that states the fact, at most one short
  body line, and the verbs on its buttons (recognition over reading, same review).
  No «#N» on the row or the card (30.09.2026, owner: «the group leader name needs more space …
  drop the number #»): the leader's name is the label, a step larger (17.5px, 16.5 ≤ 760px) with
  12px to the clock; the number stays in the TruppFinder and the Verlauf. The handed-over phone board opens on the most
  urgent crew inside; the Eintrag FAB floats over the phone Trupps page (27.10.2026) and the list
  ends above it with the shared `--fab-safe` foot (28.10.2026); an opened card's foot row keeps the
  FAB's column free while it stands under the circle (`data-az-fab-foot`).

- *The Eingangsdruck is guarded, once* (item 2, every width): locked in «Bearbeiten» once the
  Trupp is raus (pointing at the exit's Restdruck); below `doctrine.entryPressureMin` (default
  270, `/admin › Doktrin`) the form asks ONE question with the value on the button and «Ändern»
  focused. No upper bound, no second plausibility rule.
A question whose «yes» WRITES something a reflex must not (these three) puts the safe answer
first: `ConfirmSpec · safeAnswer` ('cancel' | 'alt') fills and focuses it, not red. Every
question MOUNTS FRESH (`Overlays` keys the card per request, staging r3 F5): a chain answered
and re-asked in one render batch kept the node, and the focus of the «Trotzdem abschliessen»
just tapped stood on the next question's same button — Enter closed through «vermisst».
- *One act, one ↶* (staging r3 F1): a Trupp save — create, edit, re-entry — is ONE timeline
  step with the Gäste it files and the Funktion it writes (`undoTimeline · group`,
  `IncidentWorkspace · openTruppSave`, the save's Anwesenheit writes folded into one slice
  step). ↶ reads «Trupp N … angemeldet» and takes the Trupp and its filing back together.
- *Closing over a crew inside is said* (staging r3 F4): the final «Trotzdem abschliessen»
  writes «Trupp N (…) beim Abschluss noch drin» per crew and no Austritt; the Rapport ends
  that sortie at the close with the same words while the Einsatz is closed.

## The Atemschutznotfall (F1, 08.10.2026)

One Trupp in distress, said by a person — never derived from a clock (`types · Trupp.notfallAt`,
`lib/atemschutz · truppInNotfall / safetyReady / notfallFacts`, `components/AtemschutzNotfall`).
Wording mirrors the AS emergency procedure (FwDV 7 / FKS) and is kept neutral and short
(«Notfall», «Sicherungstrupp einsetzen»); the station's AS instructors check it before it is
reworded.

- *Raised and ended by a HOLD* (`NotfallHold`, `lib/nodeHold` — the app's one deliberate hold,
  250 ms arm, fired at 825 ms): «Notfall» is a full-width tile under Rückzug | Raus (on the link
  board's page above them, «Read at the top, tap at the bottom») on an Atemschutz-Trupp that is inside, framed grey like its neighbours (colour is state). While held
  the WHOLE tile fills left→right in step with the hold (red; green for «Notfall beendet»; a
  `scaleX` layer, no reflow, tracking the hold under reduced motion too) and shows full for a beat
  when it fires — not a ring around the glyph (owner feedback 10.10.2026: it read as «loading»). A
  tap only says how: the tile's word becomes «Gedrückt halten» for 1.6 s, in place, no toast; a
  click without a pointer (keyboard) asks one question.
  «Notfall beendet» replaces it on the Trupp in one. Never on a closed Einsatz or a viewer.
- *What it writes* (`truppActions/clock · triggerNotfall / endNotfall`): `notfallAt` on the Trupp
  (the Notfall clock on every device through the trupps slice — a Link-Tafel writes it too), a
  `notfall` / `notfallEnde` row in the Trupp's own log (the Atemschutz page of the Rapport; its
  bar is the last KNOWN value, never printed as measured), ONE Verlauf row with the facts as they
  stood — place (Auftrag/Ziel + the symbol's plan/storey or Karte), last Kontakt, last Druck with
  its time, Kanal — and `atemschutz.notfall` / `.notfallEnde` events. The end row names the
  duration; the status is untouched. «Raus» on a crew in a Notfall ENDS it in the same act (owner,
  10.10.2026: «draussen also means we have the emergency completed»): the `notfallEnde` reading
  joins the exit row, «… Notfall beendet – Dauer … – Trupp draussen» stands beside the Austritt,
  the end event and the server's end push are a held end's (`push · notfall_changes` only sees
  `notfallAt` gone), and ONE ↶ step restores both (`setTruppStatus · endsNotfall`). Both are on the ↶ timeline; the
  trigger also raises the confirm-with-undo toast (same counter-row). A Sicherungstrupp sent in
  while a Notfall runs writes «… Sicherungstrupp eingesetzt – Notfall Trupp N (…), m:ss min nach
  Auslösung».
- *It outranks everything*: `truppAlarm` answers tier 2 with reason `notfall` before any clock,
  in the field or not (a crew reported out on an older build keeps it until «beendet»). The tone,
  the OS notification, the TopBar chip («Notfall · name» and the Notfall clock), the hose tone,
  `MELDUNG_RANK.notfall = 0` (above the überfällig row and a dispatch) and the server push sweep
  (`push.py · due_trupps`, keyed on the trigger) all read it. The Web Push leaves the moment the
  save commits (`push.py · notify_notfall_changes`, from `apply_workspace_put` — every save path),
  claiming the SAME crossing key the 30 s sweep uses, so the sweep is the fallback and never a
  second push; «Notfall beendet» is pushed once into the same tray entry. Not for an Übung or the
  demo. The überfällig/Alarmdruck
  row never names a Trupp in a Notfall (one emergency, one row). A NEW Notfall re-arms a bell
  muted earlier in the Einsatz (`useAtemschutzMute · arm`) — and so does an ended one that ↶
  brings back with its original trigger (`lib/notfall · freshNotfallKeys`); on the server the end
  releases that Notfall's crossing key (and a raise its end key), so the re-raise is pushed at
  once and takes the tray entry back from «beendet» (`push · notify_notfall_changes`).
- *On the Tafel* the strip's row steps aside for a sticky banner at the top of every board but the
  Atemschutz-Link's phone board (its own page and red strips, above):
  who, the clock, the facts, and the first offer «Sicherungstrupp einsetzen» — the ready
  Sicherungstrupp's ordinary Eintritt (several ⇒ a menu, none ⇒ «Sicherungstrupp bestimmen» with
  «Kein Sicherungstrupp bereit» as its second line, one inside ⇒ «… drin seit hh:mm»).
  «Sicherungstrupp bestimmen» names ANY other Atemschutz-Trupp not in a Notfall (30.10.2026,
  owner pick «Becomes Sicherung»: a crew busy in the building may be the closest help), grouped
  Bereit · Drin · Draussen (`lib/atemschutz · safetyCandidates`), then «Neuen Trupp anmelden
  (Sichern)». A crew bereit or inside turns «Sichern» in one act (`designateSafety`: clock
  untouched, its own Verlauf row with the old Auftrag, one ↶) — the banner then offers it or
  names it «drin»; a crew that is out needs a fresh bottle, so its pick opens its re-entry form
  on «Sichern». It is a Trupp CARD in its alarm tone (owner feedback 10.10.2026, four rounds:
  the first banner was a widget of kicker, clock column, wrapped names, facts and two rows of
  buttons, ~270 px on a 390 px phone): the phone card's frame (`.trow.trowCard.trowCrit`) and ⚠
  plus the SAME name the crew's card head shows («Binggeli Michael», `lib/atemschutz ·
  truppHeadName`; «⚠ Trupp 1» over it did not read as the same crew). *Phone*: the card's own
  head line (⚠ name, the card's 25 px clock, ›; the whole line «Zum Trupp», aria «Zum Trupp 1
  (Binggeli Michael / …)») and the one act at the banner's width — no facts line, the card right
  below shows Druck and Kanal. *Wide boards* (tablet / desktop grid): ONE slim row, «⚠ name» with
  the facts («Notfall seit 11:11 · Löschen · 300 bar (Eingangsdruck) · Kanal 11») beside it or
  under the name when they do not fit, never cut, then the act at its own width, then the clock
  and › — name side and clock side both lead to the card. The facts are always in the alert's
  aria label, the Meldeleiste row and the Verlauf. The crew's OWN card wears the same ⚠ in its
  dot's place. A
  viewer gets the head and the note only. All banners share one sticky stack; with several
  Notfälle there are no facts. The board measures the stack (`--nf-h` on the port: its scroll
  padding, and the parking scroll of the phone's opened card), so an opened card lands below the
  banners, never under them. Elsewhere the Meldeleiste row offers
  the same first (exactly one ready ⇒ it goes in and the Tafel opens).
- *Ready* is what the board models: under PA, Auftrag «Sichern», angemeldet. An Atemschutz-Trupp
  going in while none is ready gets one calm toast («Kein Sicherungstrupp bereit»), never a
  question.
- *Sync*: `notfallAt` merges per field; two devices holding at once raise ONE Notfall from the
  EARLIER hold (`mergeWorkspace · mergeTrupp`); «beendet» on one side survives an unrelated edit
  on the other.
- *Review of #300 (09.10.2026)*: a CLOSED Einsatz pushes no Atemschutz alarm at all, Notfall
  included (sweep and save path — nobody can end it on a frozen Tafel); two simultaneous holds
  keep ONE `notfall` reading (the earlier) and the moved trigger is claimed, never pushed again;
  a Trupp in a Notfall cannot be removed from the board until «Notfall beendet».
- *The Abschluss* asks about a running Notfall first («Zur Tafel» focused); closing anyway writes
  «Notfall beim Abschluss nicht beendet» per Trupp.

## The alarm while another surface is in front (16.10.2026)

The contact clock, the Alarmdruck, the Rückzug line and the Notfall alarm whenever an Einsatz is
open — also while «Karte & Objekte» or the Objektbesuche stand in front of it. `IncidentWorkspace`
stays mounted there with `covered` (App): no screen, no keys, but the same `AtemschutzAlarmHost`
(tone, OS notification with its sound and vibration, the Verlauf rows), the same live poll that
ends an alarm with a Funkkontakt from another device, and the same `AtemschutzAlarmMeldungen` /
`AtemschutzNotfallMeldungen` rows over the surface in front, whose «Zum Trupp» brings the Einsatz
back on this board at that card. Until then the Objektbesuche over an Einsatz unmounted it and
the alarm went silent. Details: docs/karte-objekte.md · «Home»; pinned by
`IncidentWorkspace.harness.lifecycle.test.tsx` · (k).
