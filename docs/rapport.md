# The Rapport

What the printed Einsatzrapport carries (`src/lib/report.ts`, `src/lib/reportPdfDirect.ts`,
`src/lib/auswertung.ts`, `backend/app/report`, `backend/app/kroki.py`). Moved here from AGENTS.md on 2026-10-08,
wording unchanged.

## Offline attachments

Rapport-Beilagen store their prepared photo bytes in the incident's media queue before the
first upload (`useRowMediaUpload`, `mediaQueue · target: 'attachment'`). They contribute to the
shared pending/error/storage status and retry on reconnect. After a reload, the queue restores
a fresh session URL on the existing attachment; after upload it replaces only that row's URL,
keeping its caption. A deleted attachment is never recreated by a late upload or restore. Undo
snapshots learn the uploaded URL too, so undo/redo cannot put back an expired session URL after
the queue has acknowledged its bytes. A queue entry without a target remains journal media.

## Abschluss – the «Noch offen» sheet (23.10.2026)

`useAbschluss · confirmAndComplete` asks the one closing question over `lib/abschluss`'s
Mindestangaben (`abschlussOpenItems`). Every row is a link to its field, and since the 3am sweep
(owner's point 4) a row also carries its own **button**: «Nichts verwendet» (Material),
«Entfällt» (Kontaktperson, Rückmeldung ELZ) write the same fields the Rapport's buttons write and
the sheet stays open, re-reading itself (`ConfirmSpec · refresh`) — the row stays as a done one,
the lead sentence and the button follow («Abschliessen» once nothing is open). «Wählen»
(Einsatzleiter) and «Schreiben» (Kurzbericht) leave for the focused field. Anwesenheit and
Abweichungen have no one-tap answer. An empty **Einsatzende is pre-filled with «jetzt»** on the
deployment clock (`serverNowIso`), shown as a done row with «Ändern» in the step's own place on
the list; the close writes it before
the handover, so «Einsatzende» (the step `zeiten`) is only open on a sheet that may not write the Rapport. The success
toast carries «Wieder öffnen» for 10 s (docs/undo.md). Close and reopen stamps come off
`lib/serverClock`, like the Rapport's own «Jetzt» buttons.

**The print's «Angaben fehlen noch» is the same list (31.10.2026)**: both confirms take rows,
order and buttons from ONE builder (`lib/abschlussOpen · abschlussSheet`); only the words around
the list are each one's own. The print lists the Mindestangaben only – a Trupp still out and the
pending uploads are closing questions – and pre-fills nothing: its Einsatzende row offers «Jetzt
setzen». Answered to the last row, the title reads «Alle Angaben erfasst» and the «trotzdem» note
goes; an answer given there is on the PDF made from that same tap (`ReportPreflight · startOutput`).

The Einsatzdaten card has no pencil (31.10.2026): the card is the pointer's target, its heading
«Aus den Einsatzdaten» the keyboard's (a `role="button"` span – a `<button>` would be disabled
with the Rapport's fieldset while the Einsatzdaten may still be edited).

## The strip under the head – the guide and the Abschluss band (28.10.2026)

Owner picks 14 «top strip» and 15B (`ReportPreflight · RpStrip`, one size for both, outside the
scrolling body so it stays visible with the keyboard up):

- **The open points are in page order** (`lib/abschluss · ABSCHLUSS_STEPS`): Kurzbericht ·
  Einsatzleiter · Kontaktperson · Einsatzende · Rückmeldung ELZ, then Anwesenheit · Material ·
  Abweichungen – the «n offen» list, the confirms and the guide all read that order. The step
  `zeiten` is labelled «Einsatzende», the field that is actually missing.
- **The guide**: a jump from the «n offen» list (or the «Angaben fehlen noch» confirm) leaves a
  strip «Nächster offener Punkt · noch N offen / <Punkt>»; a tap is the same jump to it
  (`nextOpenStep`: the next open one down the page, wrapping, never the current one). «Letzter
  offener Punkt» when only that one is left; at the last open point the strip is gone. ✕ puts it
  away until the next jump from the list. It never becomes the PDF button.
- **The Abschluss band, one step earlier**: as soon as nothing is open and no PDF exists, the green
  strip says «Alles erfasst · Nächster Schritt / Einsatzrapport (PDF) erstellen» (no «Später» –
  it goes away by itself). Once the PDF exists: «Rapport erstellt · Nächster Schritt / Einsatz
  abschliessen», ✕ = «Später», and under it «Danach für die Ablage: Beilagen herunterladen (ZIP)»
  when the server holds Beilagen. The band is the only announcement – no «Rapport erstellt» toast
  beside it (owner #31, 30.10.2026) – so a fresh PDF brings back a band put away with «Später».

## Unterschriften – signing on the screen (15.10.2026)

The two Visum lines (Einsatzleiter, Kommandant) can be signed with a finger instead of a pen.
**Optional**, never asked for: the «Unterschriften» card in the right-hand column, after the
Partnerorganisationen (the paper's order; on a phone in «Personal & Mittel»). Owner decisions and
the three mockup rounds: `docs/planning/signature-2026-10-15/` (local, gitignored).

- **What is signed** is the signed part of the paper form – Haupt-Rapport + Personal + Material –
  as SHA-256 over a canonical JSON of the SAME payload the PDF is composed from, with every
  Beilage left out (`reportPdfDirect · signedPartOf`, `reportSignature · signatureScope`). The
  Journal is a Beilage: a late Funk row is a Nachtrag and does not touch a signature. Times,
  Personal, Material, Kurzbericht, Einsatzleiter … do.
- **Only on a closed Einsatz**, and a signature counts only if it was made after the LATEST close
  (`last_closed_at`): «Wieder öffnen» ends every signature without anybody voiding it.
- **Signed = locked.** While a signature holds, the Rapport's form is read-only. «Ändern» (one
  confirm) voids every live signature; nothing is deleted – voided ones stay in
  `Saved.reportSignatures` with `voidedAt`/`voidReason` and in the Verlauf.
- **The server never refuses a save to keep a signature valid.** An offline tablet's Anwesenheit
  must still arrive. Validity is COMPUTED on every device (hash of now vs hash at signing); a
  signature that no longer holds shows «ungültig ›» and a tap signs anew.
- **Who signs**: name + drawn strokes, the same trust as a pen (the login is a shared station
  account). The Einsatzleiter's name IS the Rapport's Einsatzleiter (written back when signing);
  the Kommandant's defaults to `identity.kommandant`, and a deputy picks themselves.
- **Stored**: the SHAPE of the strokes only (integers in a 1000-wide box) – no timing, no pressure
  (PRIVACY.md). Each signing writes a Verlauf row («Rapport unterschrieben: …, Prüfsumme …») and a
  hash-chained audit event (`report.signature.add` / `.void`).
- **On paper** (`app/report · _draw_signature`): the strokes sit on the line beside the name,
  «Ort, Datum» is filled in (`map.geocoder.defaultLocality` without its postcode), and a small line
  says «Am Bildschirm unterschrieben … · Prüfsumme …». A signature that no longer holds is not
  sent; its line prints empty. **Decision E stands**: the printed paper is the record – the
  strokes are only how its signature got onto it. No PDF is stored, no PDF seal.
- **Legal standing (19.10.2026)**: a *simple* electronic signature – not an advanced or qualified
  one under ZertES (SR 943.03), so it does not satisfy a statutory written form (OR Art. 14). Of
  the advanced signature's four criteria it misses «sole control» and «uniquely linked to the
  signer» (shared login, no key), and the Prüfsumme detects a change only inside the app (no key,
  no outside timestamp). Hence «Am Bildschirm», never «digital», on the paper. A recipient who
  needs the written form gets a printout signed by hand.

## The Einsatzjournal on paper

- **Zeit and Bereich are as wide as their widest label** (`app/report` · journal `col_w`, capped at
  29 / 38 mm): ReportLab breaks a word that does not fit its cell, and the fixed 24 mm Bereich
  printed «Sofortmassna / hme» on every such row (23.10.2026).
- **A one-day Einsatz prints the time alone** («07:03»); the date stands once in the heading,
  «Einsatzjournal · 23.10.2026» (`reportPdfDirect · oneDay` → `ReportPayload.journalDay`). Rows
  across midnight keep «Datum Zeit» on every row.

## What the figure pages carry

- **What the Rapport's figure pages carry (18.09.2026).** The **Kroki is the picture**; everything
  else is opt-in or earns its page. Four rules, each from a printed review:
  - **Objektpläne are OFF by default** (`report · defaultReportOptions.annotatedPlans`). A linked
    sheet counts as «annotated» the moment the Karte's objects project onto it, so «on when there
    are any» stapled every linked plan to every rapport. They are reference material the station already owns.
  - **The Gebäude is its own section** (`options.gebaeude`, on), not one of the «Pläne»: it
    carries the Einsatz's own work. Only storeys with content print
    (`reportPdfDirect · usedStackFloors`); an untouched stack prints no page.
  - **A legend line says what the thing IS** – «Art · Bezeichnung · Status»
    (`symbols · symbolLegendText`), for every symbol. ⚠️ Not `symbolCaptionText`: the screen's
    value-only caption is an answer without its question once lifted into a legend. A symbol's own
    `caption: 'off'` is a screen declutter and is not read; only «Beschriftungen aus» silences it.
    A «Gelöscht / erledigt» symbol ends its line on that Status with its time («Feuer · gelöscht
    20:40», 24.09.2026) and prints grey, never absent.
  - **One figure-page template** (`app/report · figure_pages`): heading, then the muted «Einsatz ·
    Stand …» line, picture, legend – for the Kroki, a plan sheet and a Gebäude page alike. A new
    kind of figure page joins that list; it does not get a layout block of its own. Orientation is
    per kind ON PURPOSE: the Kroki is a free crop (the operator's choice), a plan sheet has the
    shape its author gave it (the bitmap decides).
  - **A sheet the renderer throws on keeps its place** (23.10.2026): heading plus «Seite «…»
    konnte nicht gedruckt werden.», logged at ERROR. It used to be skipped with a warning – and
    from 22.07. to 23.10.2026 that silently dropped every Tafel-Skizze with a Linie or Fläche,
    because plan points are `[x, y, floor]` and `kroki · _overlay_board_annos` unpacked two. The
    renderer reads `p[0], p[1]`; the client sends the points as stored.
  - **An attached Leitung end is coupled by the SERVER** (`kroki · _snap_attached_ends`, fed by
    `startAt` / `endAt` + the entity `id`; a branch off a Teilstück by `startAtLine` / `endAtLine`
    onto the fork's prong tip – `_snap_line_joints`, one geometry with the glyph: `_fork_dims`). The client has no projection and ends the line on a
    fixed ground footprint; the glyph is sized in pixels, so only the sheet's own view can land the
    end on it. ⚠️ And the fallback fit mirrors the PANEL: the ceiling is
    `report · krokiFitMaxZoom` (20; 21 for a COMPACT Lage under 30 m – one level past the basemap's
    last sharp one, so a single-building cluster is not 15 % of the sheet). That is a MapLibre
    camera zoom, one level tighter than the 256-px projection: `app/report · _kroki_fit_max_z` = +1.
    On paper the count badge is a WHITE chip like the storey badge – the numbered legend discs are
    the only dark marks on the sheet.

## The Auswertung sheet (09.10.2026, F7)

- **A debrief lives on paper, not on a screen** (owner: «maybe just on the pdf export?»). The
  optional «Auswertung» is the LAST sheet of the Rapport, landscape: key figures, swimlanes, and a
  pointer «Lehren / Sicherheit: siehe Seite 1» – the Lehren themselves print once, on page 1 with
  the signed record. It is internal – the signed part above it is what leaves the station, so it is the sheet
  that comes off the stack. `ReportOptions.auswertung` is **off by default** (owner, 10.10.2026 – it
  was seeded «ticked when a crew went in under Atemschutz» on 2026-10-09): the operator ticks
  «Auswertung (intern)» in the PDF ▾ menu, and that pick is kept for the Einsatz. It is OFF for the
  QR-Erfassung's own PDF too; a viewer link cannot make a PDF at all.
- **Derived on the client, printed by the server.** `lib/auswertung` reads the record where the
  ISO stamps are and sends minute offsets + finished strings in the deployment's language
  (`app/report · AuswertungIn`) – the same split as `personalSummary`. Nothing is estimated: a
  figure without its data prints «—», a vehicle that never reported vor Ort gets a dot, not a bar.
- **«Funkkontakte eingehalten» is the board's own rule.** An interval runs from the Eintritt or a
  contact (Kontakt, Druck, Alarm, Rückzug, Wiedereinstieg) to the next one or the Austritt;
  fällig past the interval, überfällig past interval + grace (`atemschutz · contactSeverity`). An
  interval still open counts only once it was already overdue. Watched = under PA, read per run
  off `paOn`/`paOff`. ⚠️ The clock also restarts at a REOPEN with no reading in the log
  (`reopenClocks · closedPauses`): the closed stretch is cut out, or it reads as an overrun. A
  Trupp taken off the Tafel ends at its `removedAt`; one that never went in is not drawn.
- **The axis is clamped** to alarm − 2 h … Einsatzende (or now) + 2 h, at most a week: one
  mistyped date must not squeeze the whole picture into a hairline. The figures still read the
  record as it is.
- **Greyscale first.** Most station printers are mono: fällig carries a sparse hatch, überfällig a
  dense cross-hatch on top of their amber/red, and the chart is canvas strokes (never a bitmap).
  Milestones are numbered diamonds with the words in a list underneath – the Kroki's rule, numbers
  on the picture and words in the legend.
