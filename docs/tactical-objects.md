# Tactical objects on the Karte and the plans

One object, two surfaces: how a tactical object is stored, anchored, projected and undone
(`lib/tacticalObjects`, `lib/planProjection`). Module rules live in `lib/gpsReturn`,
`lib/useGpsFollow`, `lib/useObjectStore`, `lib/objectDone`, `lib/georefTwins`,
`lib/lineAttachments`, `lib/replay` and `app/api/plan_scales.py`. Moved here from AGENTS.md on
2026-10-08 and 2026-10-18 (parity, the symbol pack), wording unchanged.

## Lage ↔ Plan parity and the symbol pack

- **Lage and Plan should stay as close as possible in every regard** – same tools, controls,
  and behavior. Only the implementation that *must* differ because of the drawing surface /
  relative coordinate system may diverge. Shared logic lives in `ToolDock`, `DrawEditor`,
  `SelectionBar` and `src/lib/lineStyle.ts` / `src/lib/selectionTransform.ts`; the renderers stay
  separate only for that surface-specific part.
- **The twins are one module each** (sweep wave 2, 24.10.2026), so parity holds by construction,
  not by review: the magnet of a line being drawn (`lib/useDraftMagnet` – line-start exception,
  start-radius claim, dwell, release only if armed, the «Angekuppelt» joints; each surface hands
  in only its projection and target walk, `lineAttachments · lineEndTargets` /
  `candidateAttachment`; the Lage's walk is `components/mapMagnetTargets`, its magnets
  `components/useMapMagnet`), the draft contract (`lib/draftMachine` – ✓ «Fertig», and
  the «Speichern · Verwerfen · Weiterzeichnen» question when an open drawing is left, 27.10.2026,
  which replaced the A6 tap-away auto-commit), «mit verbundenen Leitungen entfernen» (`lineAttachments · detachEnds`; the Lage sends
  it as ONE `draw.edit` per line, both ends in it – `detachDrawings` – so replay keeps both ends moved),
  ⌘D (`lib/duplicate`), and the armed tool + per-team trails + note-panel closing rules
  (`useTacticalSelection · usePlacement`, `lib/useHiddenTrails`, `lib/useNotePanelClosing`).
- **The armed tool's readout is one pill** (`components/ArmedToolPill`, `lib/armedTool`,
  23.10.2026, 3am sweep point 3 – owner: «a small little info thing at the bottom that now you're
  placing symbol XYZ and that's it»). Bottom centre of the Karte, the Einsatz map, a Plan and the
  Tafel, tablet and phone: the tool's glyph (a symbol's own SVG) and its name («F Feuer»,
  «Linie · Freihand», «Fläche · Punkte», «Absperrkreis»), no sentence, no button, pointer events
  pass through. The symbol tool has no option dock any more – the pill is its readout, «Mehrere
  platzieren» is a 44 px toggle with its word beside the pill, and the way out is the ✕ beside that
  toggle or Escape on the Karte and the Plan alike (27.10.2026: with «Mehrere platzieren» on, the
  Plan's Escape did nothing and there was no ✕ – no way to stop placing Durchgänge). The other tools keep their option docks (Freihand ↔ Punkte, ✓,
  Strecke ↔ Fläche, Trupp finden). On a phone the pill stands on the floating row (above the dock
  while one is out). While Messen is armed there is no pill, on any size – its results panel
  stands in that spot (sweep 30.10.2026 #3: the pill covered the Distanz on a tablet).
  The row never ellipsises (sweep 30.10.2026 #8, «Fahrze…»): when it does not fit, the name folds
  first and the glyph stands alone (the name stays its aria-label), then «Mehrere platzieren»
  folds to its ⟳ (a hold says the word) – measured on the top bar's ladder
  (`ArmedToolPill · fitArmedPill`), so a wider screen gives the words back.
- **One detail card, one set of controls** (`components/ContextPanel`, owner decisions
  31.10.2026). The Karte and every plan open the SAME card for a symbol, so a control added or
  removed there is added or removed on both surfaces. «Erledigt» is ONE toggle in the foot, in
  the same spot whether the matter is open or over: set, the tile stands pressed (check, green
  tint) and a tap reopens it; when it was set is the header's subtitle («Schadenlage · erledigt
  10:57»), which a read-only card shows too. Both directions stay ordinary undoable prop edits
  (`lib/objectDone`). There is no «Auf {plan} zeigen» / «Auf Karte zeigen» door any more: every
  object is drawn on the Karte and on its linked plans alike, so the door showed the same thing
  again. And no «+ Feld»: a symbol's rows are its preset; a free row an older Einsatz carries still
  renders with its editable key and ✕, but nothing adds a new one – a remark goes into Notizen.
- **A new line starts from the plain default, always** (`useMapDrawing · DRAW_DEFAULTS`,
  `usePlanDraft · INK_DEFAULTS`, 23.10.2026): the surface's colour, width, solid, no marker, no
  arrowhead – whatever the last line was edited to. Until then the DrawEditor wrote every style
  edit back as the next line's template, so an Absperrung's chain marker rode into the next hose
  line. Styling is done in the editor, after the draw, on that one drawing.
- **Tactical symbols are our own pack.** `public/tactical-symbols.json` is KP-Front-authored
  artwork following the FKS Faltkarte conventions, generated by `tools/gen_symbols.py` – edit
  the generator, never the JSON, and re-run `python3 tools/gen_symbols.py emit` (a `review`
  mode renders a sign-off grid). Names/categories are compatibility keys referenced across
  appConfig/copy/backend config; keep them stable.
- **A measured value IS the mark** (the Messpunkt, 26./27.10.2026). A preset's `readout`
  (appConfig) names the fields that are measured values («CO», «Ex», «O₂», «H₂S»); such a symbol
  draws as one pill – a small Messgerät and the worst gas – instead of its glyph, on the Karte, the
  Plan and the Gebäude alike (`lib/symbols · symbolReading`, `TacticalSymbol · measured`). The
  worst gas is the one at the highest alarm stage – on a tie the one furthest past its limit –
  so an «Ex 12» is never hidden behind a harmless «CO 14». The preset's `alarm` holds the detector's two stages per gas: calm ink below
  A1, amber from A1 (Voralarm), red from A2 (Hauptalarm); O₂ alarms both ways. After the preset's
  `staleMin` the colour moves to the outline and the age shows («18′»). A point not yet measured
  is the dashed pill with the icon alone. The label pass books the pill as the glyph's footprint –
  it is never suppressed – and every other place that prints a value keys it (caption «Alle», the
  printed legend), because a bare «180» names nothing.
- **A Messpunkt keeps its readings** (`SymbolProps.readings`). Every field commit that changes a
  measured value appends a row (`recordReading`); rows are never rewritten, so two tablets merge
  as a union (`lib/mergeWorkspace · withMergedSymbolReadings`), and «one radio report typed gas by
  gas is one reading» is a display rule (`readingRows`). The panel shows a calm/amber/red bar under each
  gas, the decimal keypad on each gas field, an ⓘ «Grenzwerte» built from the preset's `alarm`
  (`ReadingInfo` – limits and colours only, never what to do) and the list under the fields; the
  Gebäude lists every Messpunkt beside its storey (`StackReadings`), and the «Messungen» chip – on
  the Karte and every plan – wears the worst value and lists every Messpunkt of the Einsatz,
  worst first, wherever it is anchored (`lib/readingsList`, `ReadingsChip`); a row goes to the
  point on its own surface. ONE order everywhere (`compareReadings`, 28.10.2026): stage, measured
  before empty, fresh before stale, how far past the limit, newest reading.

## One object, two surfaces

- **One object, two surfaces — there are no twins any more** (10.09.2026). A tactical
  object is ONE record in one collection (`src/lib/tacticalObjects.ts`), carrying up to two
  bodies of the same thing: `entity` XOR `drawing` is what the Karte draws, `sheet {planId,
  anno}` is what one plan sheet draws. The three legacy collections (`entities` / `drawings` /
  `board`) survive only as VIEWS of it, and the blob still carries them so an older client can
  read a newer incident.
  - **The sheet body's PRESENCE is the anchor.** An object hand-placed on a sheet carries
    `sheet`: the sheet coordinates are its truth, and its map body is BAKED through the plan's
    georeference (`bakeGeoBody`) and re-baked when that fit changes. An object hand-placed on the
    Karte carries no `sheet` at all: geo is its truth, and a linked sheet draws it by PROJECTING
    it through the same fit (`src/lib/planProjection.ts`). Both derivations are pure, and they
    are **inverse in geometry AND in absence** — a projected anno handed back off a sheet becomes
    the stored sheet body verbatim, so an asymmetry between them would rotate, resize or displace
    the object a little on every flip, and an absent field materialising as `0` or `''` would
    invent one. Where one converts (the sheet's own turn into and out of the paper's frame, for
    BOTH bearings; metres into sheet fractions and back, at the same default an unsized object is
    drawn at) the other undoes it, and the comment at each says so. ⚠️ The absence half is
    normalised on the way BACK, not on the way out: an object with no bearing genuinely IS turned
    by `rotationDeg` in the paper's frame, so the projection has to state that — and «points
    north» is the same fact as «has no bearing», so the bake returns the shorter one
    (`turnedToGround`). Without it every ordinary unturned Fahrzeug acquired `rotation: 0` on its
    first flip. ⚠️ **The DOC seam converts bearings too** (24.09.2026, Feueralarm-Übung 23.09.):
    a Karte write hands back the GROUND bearing, and `annoAfterMapEdit` once spread it into the
    PAPER's frame for every sheet-anchored object, changed or not — each «Karte write → bake»
    cycle turned the glyph by −`rotationDeg` (a Lüfter reached 66 735°, and turning one turned
    all). Now `sheetBearings` keeps an unchanged bearing verbatim and sends a changed one through
    `turnedToSheet`; `applyDocToObjects` hands an object whose map body did not change back as
    the same record; both conversions answer in [0, 360); and the load gate
    (`sanitizeWorkspace`) brings any stored bearing into [0, 360) by mod alone.
    Pinned by `sheetBearingRoundtrip.test.ts`. A field that cannot be said in both units — a note's width, a label's nudge —
    does not cross at all: it is preserved through the bake instead (`BAKE_PRESERVED`), because a
    number that means two distances is worse in the record than no number.
  - **Last hand-placement owns the truth.** A drag flips the anchor to the surface it happened
    on: dragging a sheet-anchored object on the Karte DROPS its sheet body, dragging a map object
    onto a sheet CREATES one. Both seams (`applyDocToObjects`, `applyBoardToObjects`) therefore
    read a document as a GESTURE rather than as the truth, in four readings each — unchanged is
    nothing, a prop edit writes through to the OTHER body, a positional edit flips the anchor,
    and absence deletes the whole object, because deleting an object deletes the object.
    ⚠️ The flip is between the Karte and PAPER, never between two sheets (24.09.2026): a move of
    the Gebäude's ink on a sheet it is lent to is written back INTO the Gebäude through both fits
    (that sheet's → ground → the stack's), storey and per-vertex storeys intact, and the Gebäude
    keeps it. It used to flip, and a 0.3° ⟳ on Modul 1 took a 1. OG Leitung off its storey (prod
    23.09.2026). Only a HAND drag that leaves the Gebäude's paper (a Brand dragged out onto the
    street), or a stack with no fit to write through, still re-homes it to the sheet it happened on.
  - ⚠️ **A MACHINE write never flips an anchor.** Only a hand places something. The live-GPS pass
    re-routes attached Leitungen several times a minute, and read as a placement it tore
    plan-drawn hoses off their sheet with nobody touching anything; such writers pass
    `gesture: false` and their position crosses through the fit instead. Both store writers take
    it — `setDocRaw` and, since 24.09.2026, `setBoard` (it hard-coded «gesture»): a plan ↶/↷
    restoring a snapshot (`usePlanStacks · planStepAt`, `useBoardDoc`), the Trupp sweeps that move a marker
    (`settleAtHoseEnd`, `unlinkTruppLine`), a Gebäude amend and a storey removal. A writer that
    rewrites what a sheet OWNS hands the lent annos back untouched (`tacticalObjects ·
    withOwnAnnos`) — the Gebäude amend carried the Karte's projections through the old building
    frame and they came back «moved». So does «Geschoss entfernen» and the ↶ of «Geschoss
    hinzufügen» (24.09.2026, `stackFloors · removeStorey` / `withoutOwnOnStorey`): a Karte object
    SHOWN on a storey is not the storey's, and swept out of the view it was deleted outright. It
    stays on the Karte and simply finds no tile. The removal's confirm asks only about what the
    SAME sweep loses (`removeStorey · lost`, `lib/storeyRemoval`) — «n Markierungen … entfernt oder
    gekürzt» — and a storey showing only Karte objects goes without asking; the toast still undoes
    it. And the seam honours it per object: a lent anno
    handed back exactly as shown folds to the SAME record (`applyBoardToObjects`), never through
    the bake — which lost a note's text and laid a store step for nothing.

- **Presentation stays equivalent, and nothing is lent that is owned.** Each surface draws the
  other's objects with its OWN native chrome and sizing (map `symPx`, board `symBase`) — no
  projection tone, no reduced opacity, no twin-only band — and every capability the surface has
  applies: selection, the `SelectionBar`, the marquee, the magnet, the fat-finger fan, Delete.
  A sheet is never shown its own objects back through the projection, nor a sibling sheet's
  — with ONE exception: the Gebäude stack's ink shows on every other linked sheet, its storey as
  a badge (14.09.2026, `planProjection · projectOntoSheet`), because the building is where a
  Brand is marked and the Übersicht is where it is read. The stack itself never shows another
  sheet's ink, and plan A's work never clutters plan B. What IS lent is only what is not a record
  — the live vehicle and responder feed (`planProjection · liveOverlay`, `PlanLiveLayer`),
  read-only but for the one gesture it always had: dropping a Fahrzeug writes the same
  held-in-place override the Karte writes.

- **A Verlauf photo on the Karte is an object; on a sheet it is only shown** (F16, 08.10.2026).
  «Auf Karte setzen» (lib/photoGeo) places an ordinary `kind: 'photo'` entity at the position the
  picture's EXIF names, with its view cone from `heading`; it names its picture by Verlauf row +
  index (`photoOf`), never by URL, because a picture placed offline is a session `blob:`. The
  projection still answers `null` for it — media, not a place on the paper — and a georeferenced
  sheet SHOWS it read-only instead (`planProjection · photoOverlay`, `PlanPhotoMarks`): a tap
  opens the picture, moving or removing it is the Karte's. Not on the Gebäude stack (a GPS fix
  has no storey), and nothing at all on a sheet without a georeference. Where a phone hands over
  a position and where it does not: the header of `lib/exif.ts`.

- ⚠️ **The aspect the fit is solved in is its own stored fact** (`measuredArByPlan`), NOT
  `PlanScale.ar`. `ar` is half of a pair — a sheet's ground width is `ar · mPerU` — so
  correcting it in place silently rescales every measured distance on that plan. The measured
  aspect says only «this sheet is this shape»; correcting it re-solves the fit from the SAME
  pairs (a pair is an aspect-independent statement), so `fitSignature` changes and the ordinary
  journalled re-bake does the rest. The surface holding the bitmap writes it, once per sheet per
  session, past the same 2 % drift calibration staleness uses. It matters because a replaced
  Modul PDF leaves a stale `ar` that staleness CANNOT catch (it is measured against the very
  aspect being looked for, and the pairs were fitted at the same wrong one), and a wrong aspect
  is now a wrong position in the record rather than a tilted picture.

- ⚠️ Known limitation, ACCEPTED and not to be re-opened without a decision: the flip is a FIELD
  REMOVAL, and `mergeWorkspace` merges an object field-wise last-writer-wins — a concurrent edit
  still carrying the dropped sheet body brings it back. Absence cannot say «deliberately
  dropped»; a tombstone or an explicit anchor enum could, and that is a schema change nobody has
  asked for. Replay is unaffected: it folds VIEWS, so a sheet there shows only what was recorded
  on it.
