# Board templates – the Tafel's pages

The Tafel has a **page strip**: «Skizze» (the free board, unchanged) plus the pages a board
template offers under «+ Seite». The bundled set is the FKS «Erste Führung» poster and five sheets
from the FKS Handbuch Führung Grossereignisse (09/2022, Kap. 8). A station can replace that set
with its own copy, distributed the same way as the checklists. Built 10.10.2026. The owner's
decisions behind it are in the research notes, §6: strict 1:1 with the FKS poster, a live mini
Karte in the Lagekarte box, spreadsheet keys, an empty Tafel at the start, and a station set that
replaces the bundled one.

| Where | What |
|---|---|
| `src/data/boardTemplates/fks-erste-fuehrung.json` | The bundled set. It is also the starting point of a station copy. |
| `src/lib/boardTemplate.ts` | The client's model of `board-template/1`, `labelText` and the tolerant `isBoardTemplate` gate. |
| `src/lib/boardForm.ts` | A page added to an Einsatz: its snapshot, its values and the edits. `formForPdf` resolves it for print. |
| `src/lib/boardFormNav.ts` | The keyboard, as a pure function. |
| `src/lib/boardTemplates.ts` | Loads `tafel:*` datasets through IndexedDB, with the bundled set as the fallback. The Whiteboard reads it when the Tafel is first shown, never at boot. |
| `src/components/TafelFormPage.tsx`, `TafelPageStrip.tsx`, `MiniKarte.tsx` | The page, the strip and the Lagekarte box. |
| `src/components/TafelPendenzen.tsx`, `src/lib/pendenzenPage.ts`, `src/workspace/useTafelPendenzen.ts` | The «Aufträge / Pendenzen» page: a `live` section, its Verlauf rows and its print. |
| `backend/app/board_templates.py` | The pydantic contract (`extra="forbid"`). |
| `docs/board-template.schema.json` | The JSON Schema generated from that contract (`just board-template-schema`). A pytest pins the two together. |
| `backend/app/admin_board_templates.py` | The `schema \| example \| validate \| load \| push \| show` CLI. |
| `backend/app/report_board.py` | Draws each page in the Rapport. |

## How the Tafel uses a template

- **A new Tafel starts empty.** The strip shows «Skizze» and «+ Seite», and nothing else. No
  page is forced on anyone, and there are no «Womit beginnen?» cards.
- **«+ Seite»** (on a phone just «+», labelled «Seite hinzufügen») lists the pages of the
  station's set by their titles only — no template name heading them, no sheet numbers (the FKS
  numbers 8.1 … stay in the template's `source` and in this doc). A page that is already on the
  Tafel is marked «schon da», and tapping it goes to that page — unless the page is
  **repeatable** (`repeatable: true`): it stays on offer, and each tap adds a page of its own,
  numbered in the strip, the title and on paper («Konzept», «Konzept 2», …, `lib/boardForm ·
  pageTitles`; the numbers close up when one is removed). Each instance has its own values, its
  own ↶ steps, its own sheet in the print, and the remembered page works per instance. The
  bundled set repeats **Konzept** (several concepts) and **Rapport** (the next Rapport); the
  Erste Führung, the Problemerfassung, Mittel, Verbindungen and Aufträge / Pendenzen are one per
  Einsatz — what does not fit on them continues on the «Fortsetzung».
- A page's header carries its title only; which template file and version it came from stays in
  its data and on the paper's footer.
- **Its timeline** stands under the page's last box and in the paper's footer, right corner:
  «Erstellt 26.10.2026, 11:24 · zuletzt bearbeitet 26.10.2026, 14:05» (owner, 26.10.2026: the
  printed page dates itself, not only the Verlauf; `lib/boardForm · pageStamp`). Both on the server
  clock: when the page was added (`at`) and its latest cell stamp (`t`). Until something is written,
  only «Erstellt».
- **A page is ONE board anno** of kind `form` on the Tafel's own sheet (`board['tafel']`). The
  anno carries the page *snapshot* and everything written on it. So adding a page, every
  committed cell and removing a page are each one ↶ step on the Tafel's history, and a page syncs
  and works offline like a note. The Whiteboard keeps the pages away from everything positional
  (`Whiteboard · formAnnos`). Every ink commit gets the pages put back on, so a stroke can never
  drop one. A page, or any board object of a kind a build does not know, is a **passenger**: kept
  untouched at the load gate, in every merge and save, and guarded on the server against builds
  that predate it ([`sync-and-offline.md`](sync-and-offline.md#the-model)).
- **Two devices on one page** merge cell by cell (`lib/boardFormMerge`): different cells both
  survive; the same cell changed on both keeps the later edit (each cell carries the server-clock
  time it was committed, `t`) and writes a Verlauf row naming the page, the cell and both values.
  A cell that has the keyboard follows the other device's value until it is typed into.
- **The audit** hears the cells that changed (`board.edit` · `form.delta`), not the whole page.
- **Values are keyed by id** (section, box, column, row), never by position or label. A station
  can rename «Wer» to «Zuständig» without losing a word.
- **The snapshot.** When a page is added, the page as it stands in the station file is copied
  into the Einsatz, together with the template's id and version. Later edits to the file never
  change an open or archived Einsatz, nor its Rapport.
- **Switching pages**: tap a tab, or press PageUp / PageDown while no field has focus. There is
  no swipe, because a swipe pans the board. The strip is the app's segmented control in its tabs
  form, standing where every other surface says «which place»: in the bottom-left row where a
  plan's Objekt chip stands, in its floating look (above the phone's bars and beside
  the FAB, right of the rail on a tablet). Many pages scroll sideways inside it, the open one in
  view; «+ Seite» stays in view and opens upwards. A page pads its foot by that row, so its last
  ruling scrolls above the strip. Which page a device shows is local to
  that device: remembered per Einsatz in IndexedDB (`lib/tafelPages`, never in the workspace),
  restored when the Tafel opens, «Skizze» when the page is gone. A device that has not picked a
  page on an Einsatz yet opens the Skizze — except on the public demo (`identity.demoMode`), where
  it opens the first page in the strip, so a visitor meets the seeded, filled «Erste Führung»
  instead of an empty sheet (`backend/tests/test_demo_tafel.py` keeps that page first).
- **Unsaved typing is never lost**: a cell writes on blur, when the app goes to the background
  (`visibilitychange`, `pagehide`) and when it unmounts. On a closed Einsatz the draft is parked
  on the device (`lib/draftKeep`) instead of written.
- **Removing a page** asks first when something is written on it. ↶ brings it back either way.
- **Deleting a row** (05.11.2026, owner pick 7A): a bin stands at the end of the row one is in –
  every written table row, and every line of a problem box – in a column of its own, outside the
  ruled cells (`TafelFormPage · BinButton`, 44 px, shown while the row holds the focus; its press
  keeps the focus, so iOS does not take the row away under the finger). One ↶ step; a toast says
  what went, with «Rückgängig». A pre-printed row has no bin: it belongs to the template.

### The Einsatz's problems (05.11.2026)

The Erste Führung's Problemerfassung box, the page «Problemerfassung» and a `problems` checklist
(CONFIGURATION.md §9f) show ONE list of problems (`lib/problemLink`, owner pick 7A):

- A section takes part with `problems: true` – a `quad` (each box is a **Bereich**: its id is the
  Bereich's id) or a `table` (its first text column is the problem, its trend column the
  Tendenz, its `area` column the Bereich). The bundled pages: `ef › problem` and
  `problem-tendenz › probleme`, which got a «Bereich» column (Front / Ordnung / Sanität /
  Spezielles – the ids of the four boxes).
- A row typed on the page stands in the box of its Bereich, a line typed in a box stands on the
  page with its Bereich, and a ticked checklist item stands on both. Each problem lives in ONE
  place (its tick, its line, its row); every other surface shows it in a **view** built at draw
  time (`problemView`), so a page added later shows everything ticked or written before it, and
  an un-tick or a deletion takes the problem off every page at once. An edit on a view is split
  back (`splitProblemEdit`): words, Tendenz and Bereich go to the problem's home; the page's own
  columns for it (Reaktion, Priorität, its place in the order, a box's Stichwort) stay on the
  page as a **satellite** – a row or line stored under the problem's view id (`ck~…`, `ln~…`,
  `rw~…`). Everything is a form cell or a checklist key, so it merges per cell and per item.
- A problem from the checklist wears the checklist icon, and its words are the checklist's
  (read-only, like a pre-printed cell; its Bereich is its phase's). Its Tendenz writes the checklist's
  (`TemplateState.trends`, beside the tick, so an un-tick keeps it for the re-tick).
  Deleting it on the Tafel un-ticks it – «„…" gelöscht – Haken in der Checkliste entfernt ·
  Rückgängig». A problem typed on the Tafel is never matched to, nor written into, the checklist.
  The page's legend says it: «aus der Checkliste – Löschen nimmt dort den Haken weg».
- Printed (the page's «Drucken», the Rapport) as drawn: the view, the Bereich as its word.
- A page added before the link (its snapshot has no `problems`) keeps showing its own entries.

### The keyboard (like a spreadsheet)

| Key | Does |
|---|---|
| Enter | Commits the cell and moves **down**: the next row, same column. In a Problemerfassung box it moves to the next line. On the last line it moves to the box's empty line. |
| Enter on the empty trailing row | Leaves the list for the next section's first cell, so nobody gets stuck in a list. |
| Tab / Shift+Tab | Moves **across**: the next column, or the next box to the right (Front → Ordnung → Sanität → Spezialprobleme, staying on the same line). It wraps to the next row and then to the next section. Shift+Tab is the exact way back. |
| Shift+Enter, Alt+Enter | A line break inside the cell — a Problemerfassung entry too, which prints with its breaks. On a touch screen a «Zeilenumbruch» key (↵, 44 px) sits in the focused cell. |
| Alt+↑ / Alt+↓ (⌥ on a Mac) | Moves the entry the cell belongs to up / down — a problem line, a Massnahme, a Mittel or Verbindungen row, a row written under the Abspracherapport's fixed ones (those stay fixed). One ↶ step, with what was typed in the cell. |
| Esc | Restores the stored value. A second Esc lets go of the field. |

- In a «Wann» (`time`) cell, `1124` is stored as `11:24`. Under a finger (`pointer: coarse`) a tap
  on a time cell opens THE time picker (`WheelPopover`: wheels, «Jetzt», «Leeren») instead of the
  soft keyboard, and its answer is one commit (20.10.2026, owner: «with keyboard / desktop type,
  otherwise wheel»); a mouse and a hardware keyboard keep typing.
- Enter on a row that has words and an empty Wann fills in the current time. This is part of the
  same commit, so ↶ takes it back.
- An IME composition (Safari: `keyCode` 229) never commits or moves.
- **Every box you see is a tap target.** A table's ruled empty rows on screen (as many as the
  section's `height` leaves after the entries) lead into the one empty row under the last entry:
  a tap on any of them puts the caret there, in the same column. Under the Abspracherapport's
  pre-printed rows, an added row has Bezeichnung and Ort as free text; its Signatur stays blank.
- **Every ruling is the standard height**, never stretched (owner: «just keep things fixed»).
  When a neighbour in the same grid row is taller, the leftover height gets more standard
  rulings, each a tap target like the others (`TafelFormPage · useFillCounts`), or plain space when less than one
  ruling is left. A box grows only when its own rulings are all written, one ruling at a time.
  On paper the same: every table rules at the sheet's one ruling height.
- **Entries stack from the top, in the order you give them** (owner, 10.10.2026 evening: «allow
  for manual reordering»). Writing always lands directly under the last entry, and Enter after
  writing goes to the next free line. An emptied entry closes up: the ones below move up. A
  trend or a tick on its own is not content.
- **Reordering**: drag an entry by the grip at its left edge (pointer or finger, ≥ 44 px; the
  page scrolls when the finger nears its top or bottom edge; Esc cancels), or Alt+↑ / Alt+↓.
  Each move is one ↶ step. An entry moves within its own list; there is no dragging from one
  Problemerfassung box into another.
- **The order on two devices**: each entry carries an order key (`ord`, `lib/orderKey` —
  fractional indexing), and a move writes only the moved entry's key. Two devices moving
  different entries both keep their moves; the same entry moved on both keeps the later move
  (a tie is settled the same on every device); two entries appended at once are both kept, in a
  fixed order. A move is never a conflict row. Pages from the builds of 10.10.2026 (which kept a
  `slot` per entry) read in that order with the gaps closed, and get keys on their next write.
- DOM order is template order, so the iOS ↑↓ bar follows it. Pre-printed cells (Signatur,
  Bezeichnung, Traktandum) are text, not inputs, so neither Tab nor the iOS bar stops on them.
  `enterkeyhint` is «next», and «done» on the last field.

### The Lagekarte box

A `map` section shows a small, **read-only, live** view of the Einsatz-Karte (`MiniKarte`). It
uses the same base and reference layers, the same symbol images, the same placed objects and the
same drawings, framed on what the Einsatz has placed. A tap opens the Karte.

It is cheap on purpose:

- The MapLibre instance exists only while a page with a map box is on screen. It rides the
  Whiteboard's lazy chunk; a chunk of its own split shared modules out of the App chunk and cost
  the cold start ten requests.
- It takes no input (`interactive={false}`, `inert`).
- It refits only when the extent of the Lage moves.

In the Rapport, the box gets a server-side Kroki render of the scene at print time,
auto-framed and without captions.

### The «Aufträge / Pendenzen» page

Bundled since 05.11.2026 (owner pick 6A): the BGV form's columns as our own page, without its
branding — **Was · Wer · Prio. · Status · Zeit**. Its one section is `live` (`source:
"pendenzen"`): a **view on the Verlauf**, not a form. It lists every Pendenz and Erinnerung of the
Einsatz since its start (`lib/reminders · pendenzLedger`), open and done, in the order they were
raised; a done row is struck through and stays. Nothing of it lives in the page's values — the
anno carries the snapshot only — so a Pendenz from the composer is on the page the moment it is
written, and a tick on either side is the same tick.

- **Status** is two ticks: «Erteilt» with the creation time, ticked by itself (owner, 05.11.: no
  new state), and «Erledigt» with its time — the Verlauf's own tick, confirm-with-undo; un-ticking
  takes it back (`reopened`). **Prio.** 1 = «dringend», a tap sets or clears it. **Zeit** is an
  Erinnerung's time with a bell, red «überfällig» once past and open. **Wer** is the item's
  assignee.
- **A row typed on the page** becomes a Pendenz in the Verlauf when the row is left (Enter, Tab
  off «Wer», a tap elsewhere) — one `created` row with Was, Wer and Prio. together, marked
  `origin: 'tafel'` — and says once «Als Pendenz im Verlauf eingetragen · 14:31 · Name». The
  Verlauf's Pendenzen block marks it «von der Tafel»; a tap there opens the page.
- **Changing Was / Wer / Prio.** of an item appends a correction (a `note` row carrying `edit`,
  types · `reminder.edit`), never a mutation. ↶ appends the correction back. An emptied Was keeps
  its words.
- **◷** at the end of «Was» opens the Verlauf on the item's row. No grip: the order is the order
  of issue. **No bin** either (unlike the other tables, above): a row here is a Verlauf record,
  which is never deleted — what is done is ticked off, and stays on the page struck through.
- Who may tick or write is who may write the Verlauf (editor, el); a viewer reads the page.
- ⚠️ A build from before 05.11.2026 keeps the page as it keeps any section type it does not know
  (`isUsableSection`): the page stays, syncs and prints its title, the section is not drawn —
  never dropped. The Verlauf rows it reads as before: a correction is one more Meldung there.
- Every act's Verlauf row: [`verlauf-coverage.md`](verlauf-coverage.md).

## Printing a page

«Drucken» in a page's header (next to the delete; also on a closed Einsatz) makes a PDF of that
page — with more than one page, «Alle Seiten» too. The sheets are the Rapport's own (same
renderer, A4 in the template's paper), composed without the Rapport around them
(`POST /api/incidents/{id}/tafel/pdf`, `lib/tafelPrint`). The server draws the paper, so
printing needs the connection: offline the app says so calmly, the page stays saved. An
Einsatz-Link session cannot print it (the pages carry names, like the Rapport).

## Exports

- **The Rapport PDF** carries every page («Tafel – Seiten» in the print menu, on by default).
- **«Einträge sichern»** carries the workspace saves a closed Einsatz refused — the pages ride
  in them like every other part of the workspace — and the audit rows, each Tafel edit as the
  cells it changed (`board.edit` · `form.delta`).
- **The statistics export** (`/api/stats`) does NOT carry the pages: it is figures and the
  capture-domain fields only, never the workspace's free text, and the Tafel is free text.
- **The capture poster's Rapport** does not carry them either: its token sees the capture
  domain only, never the workspace.

## The Rapport

- **Pages.** Each form page prints on a sheet of its own, in its own layout, right after the
  Aufträge. The «Aufträge / Pendenzen» page prints as a plain table of its columns (rows from the
  Verlauf at print time, ruled empty rows under them), but in the Rapport **only while its
  «Aufträge / Pendenzen» section is switched off**: that section is the same list from the same
  source, with the Meldungen, printed right before the Tafel — twice would be the same list
  twice (`reportPdfDirect · tafelPayload`). «Drucken» on the page always prints it. The Erste Führung prints as the A3 poster on A4 portrait, which has the same
  proportions. Sheet 8.1 prints landscape.
- **Empty boxes** print as ruled empty boxes, so the paper can still be filled in by hand.
- **Overflow.** Nothing written is cut off. A box shrinks its type down to 6.5 pt, and whatever
  still does not fit continues in a «Fortsetzung» table that flows over as many pages as it
  needs (`report_board · Continuation`).
- **Header** labels (Einsatz, Adresse …) print in the report's language.
- **The Skizze** prints as a blank-base plan page when it carries ink. That closes the old «the
  Tafel's ink never reaches paper» gap.
- **Switch.** Everything above sits behind one entry in the print menu, «Tafel – Seiten (n)»,
  which is on by default.
- **Fonts.** Trend arrows (➚ = ➘) are drawn as vector arrows, because Helvetica has no glyph for them.
- **Heads** take the lines they need (up to three), every line printed. A label keeps a symbol
  group together with no-break spaces (`➚\u00a0=\u00a0➘`) and breaks a long word at its soft
  hyphen (`Entwicklungs\u00adtendenz`) — on screen the same: heads break at their soft hyphens
  only (the browser's dictionary picked «Entwicklungsten-denz»). Soft hyphens (`­`)
  in a label split it where the poster does, as in «Patienten-sammelstelle».

## Writing a station template

1. **Start from the bundled file.** Download it from `/admin › Tafel-Vorlagen` («FKS-Vorlage
   herunterladen»), or copy `src/data/boardTemplates/fks-erste-fuehrung.json`.
2. **Change the copy.**
   - Give it your own `id` (for example `fw-oberwil`) and raise `version` whenever you change it.
   - Keep the ids of what you keep.
   - Reorder the arrays to reorder the page.
   - Delete a section or a column to drop it, or set `hidden: true`.
3. **Store it.** Put it in the private data repo as `tafel/<id>.json` and list it in
   `tafel.manifest.json` (`admin_board_templates example` prints the shape).
4. **Check it.** Run `uv run python -m app.admin_board_templates validate tafel.manifest.json`.
   The check is strict: an unknown key is an error, with its path, never silently ignored.
5. **Publish it.**
   - `just board-templates-push tafel.manifest.json --base https://… ` (with `KP_ADMIN_SECRET`)
     uploads every template as `tafel:<id>`. The `tafel:*` datasets the manifest does not list
     are only **listed** as prune candidates (an /admin upload looks the same); add `--prune` to
     delete them. `--dry-run` shows both lists. An empty manifest is refused.
   - A template's `id` must match `^[a-z0-9][a-z0-9-]*$` and equal its `tafel:<id>` slot; the
     server refuses anything else.
   - `/admin › Tafel-Vorlagen` does the same for one file.

⚠️ **A station set replaces the bundled one.** As soon as one `tafel:*` dataset is stored, only
the station's templates are offered, and «Erste Führung» comes back only if the station copy
contains it. Removing the last station template brings back the bundled set.

### The format (`board-template/1`)

The schema is [`board-template.schema.json`](board-template.schema.json).

**Labels.** A label is either a string or `{ "de": …, "fr": …, "it": …, "en": … }`. German is
required and is the fallback.

**Ids.** Every id matches `^[a-z0-9][a-z0-9-]*$`. Ids must be unique among their siblings.

**Template**

| Key | Meaning |
|---|---|
| `schema` | Always `board-template/1`. |
| `id` | The template's id. |
| `version` | Raise it on every change. |
| `title` | The template's title. |
| `source` | Optional. Printed in the page footer. |
| `pages[]` | The pages. |

**Page**

| Key | Meaning |
|---|---|
| `id`, `title` | The page's id and title. |
| `code` | Optional. A sheet number, kept as metadata only; the app never shows it. |
| `paper` | `portrait` or `landscape`. |
| `columns` | `1` or `2`. A phone always uses one column. |
| `header` | Switch for the Einsatz · Adresse · Alarm · Einsatzleiter line. |
| `hidden` | When true, the page is not offered. |
| `repeatable` | When true, the page may be added more than once (see «+ Seite» above). |
| `sections[]` | The page's sections. |

**Every section** has `id`, `type` and these optional keys:

| Key | Meaning |
|---|---|
| `title`, `subtitle` | Headings. |
| `span` | `2` takes a whole row of a two-column page. |
| `height` | Height on paper in ruled rows. For a table, it is also how many empty rows it prints. |
| `hidden` | When true, the section is not shown. |

**Section types**

| `type` | What | Keys |
|---|---|---|
| `quad` | Boxes with one problem per line (Problemerfassung) | `cells[]` (`id`, `label`, 1–4 of them, row-major). Switches: `trend` (➚ = ➘ per line), `tag` («Stichwort» per line), `problems` (the Einsatz's problems, above). |
| `map` | The Lagekarte: the live mini Karte on screen, a snapshot on paper | – |
| `table` | Rows × columns | `columns[]` (see below), `fixedRows[]` (`id`, `cells` = the pre-printed values of the fixed columns, `hidden`), `addRows` (default: yes unless fixed rows exist), `seed: "vehicles"` (pre-fills the first typed column with the vehicles the Einsatz knows), switches `done` (an «Erledigt» tick per row) and `problems` (the Einsatz's problems, above). |
| `text` | Free text fields (Konzept, Antrag …) | `fields[]` (`id`, `label`, `tone`, `type`), `layout`. |
| `live` | A table derived from the Einsatz, not written on the page | `source` (`pendenzen`: the Verlauf's Pendenzen and Erinnerungen), `columns[]` (`id`, `label`, `w`, `hidden`) — the source's own column ids only (`was`, `wer`, `prio`, `status`, `zeit`): rename, reorder, re-weigh or hide them, never invent one. |

**Table columns** have `id`, `label` and these optional keys:

| Key | Meaning |
|---|---|
| `type` | `text`, `time` (Wann), `trend`, `symbol` (a printed Signatur, see below), `index` (a numbered disc) or `area` (a problem's Bereich: a menu of `options`). |
| `options` | An `area` column's choices: `[{ "id", "label" }]`, the ids of the problem quad's boxes. Required with `area`, refused without. |
| `fixed` | The value is pre-printed by the row. |
| `w` | Relative width. On a phone it also scales a text column's minimum: by its weight over the table's narrowest text column, between 1.25× and 2.5× the width a head needs; time, trend, Signatur and index columns keep 1×. The table scrolls sideways (28.10.2026, `boardTemplate · colMinScale`). |
| `hidden` | When true, the column is not shown. |

**Text fields**

- `tone` is `plus` / `minus` (the Variante's green and red boxes) or `shade` (a grey box for a
  given value).
- `type` is `text` or `time`.
- `layout` is `stack`, `row`, or `split` (the first field on top, the rest side by side under
  it).

**Signaturen** (`symbol` columns) are drawn as on the poster, in `BoardSignature.tsx` and
`report_board · draw_signature`. The poster's six are `patientensammelstelle`,
`sanitaetshilfsstelle`, `rettungsachse`, `standort-einsatzleitung`, `sammelstelle-unverletzte`
and `warteraum`. The two extras are `wasserbezug` and `absperrung`. A new key must be added to
both files.

### The switches in the FKS file

The bundled FKS file is strict 1:1, so every extra the staging «Erstes Plakat» had is a switch
that is **off** — except the trend ➚ = ➘ per problem, which the owner wants on (staging round 2;
`sections[problem].trend`, printed too). A station turns one on in its own copy:

| Switch | Where |
|---|---|
| Header line Einsatz · Adresse · Alarm · Einsatzleiter | `pages[ef].header: true` |
| «Stichwort» per problem | `sections[problem].tag: true` |
| «Erledigt» tick per Massnahme | `sections[massnahmen].done: true` |
| Wasserbezug / Absperrung in the Abspracherapport | `fixedRows[wasserbezug \| absperrung].hidden: false` |

## The bundled pages

| Page | Source | Layout |
|---|---|---|
| Erste Führung | FKS Plakat A3 V 1.0/10.09.2019 (DE/FR/IT) | 2 × 3 boxes, as the poster |
| 8.1 Problemerfassung | Handbuch p. 145 | landscape table: Bereich (ours, 05.11.2026) · Problem/Ereignis · Entwicklungstendenz ➚ = ➘ · Notwendige Reaktion · Priorität |
| 8.6 Mittel | Handbuch p. 153 | table: Formation · Personal/Mittel · Auftrag/Wo · Wann, 23 rows |
| 8.8 Verbindungen | Handbuch p. 155 | table: Funktion/Standort/Name · Kanal · Rufname/Telefon-Nr. · Wann |
| 8.9 Konzept | Handbuch p. 156 | Auftrag · Eigene Mittel · Auflagen · Variante 1/2 (+ / –) · Antrag · Begründung |
| 8.11 Rapport | Handbuch p. 158 | the eight Traktanden + Wer, and Datum / Zeit of the next Rapport |
| Aufträge / Pendenzen | the BGV form «Aufträge / Pendenzen», our own layout (no BGV branding) | `live` table: Was · Wer · Prio. · Status (Erteilt / Erledigt + time) · Zeit, from the Verlauf |

- The French and Italian words come from the FKS posters and the FR/IT editions of the Handbuch.
- The English is our own translation.
- One obvious typo in the official French text was corrected: «collectteur» → «collecteur».
