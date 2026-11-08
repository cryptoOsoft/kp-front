# Plans, the Gebäude stack and alignments

Rules for prepared floors, plan alignment and how plan sheets are fetched and drawn. The
module-level rules live in `lib/storeyClip`, `lib/footprintPick`, `components/PlanCompass`,
`app/plan_markers.py`, `app/reference_buildings.py`, `lib/pdfBytes` and `lib/planTiles`; the data
flow is in [`objektplaene-architecture.md`](objektplaene-architecture.md). Moved here from
AGENTS.md on 2026-10-08, wording unchanged.

## Prepared Gebäude floors

- **Prepared Gebäude floors belong to their frozen plan binding.** A Modul-6 stack stores
  `pack.bindingId`; changing the selected Einsatzobjekt must not retarget its backdrop or ink.
  Prepared floors cannot be added or deleted in the incident. A pack stack is BUILT in one place,
  `lib/floorPackBinding · packBuildingDoc` — the Einsatz's seed (`useGeorefFits`) and the read-only
  Gebäude of «Karte & Objekte» (`lib/karte/gebaeude`, [`karte-objekte.md`](karte-objekte.md)) both call it. Floor drawings may connect in
  pairs across PDF pages; resolve those joins in a common frame, never independently centre
  each crop. **A storey may BE several drawings** (`PlanFloor.part`, 16.09.2026 – two wings of one
  1. OG): each drawing is a row with its own region and its own join, all on one page, and the
  storey is still ONE tile, ONE index and one surface for ink, Trupps and symbols. Every join
  shift is keyed by (index, part); a shift per storey can only place one wing. A symbol's Von/Bis range is one object shown and selectable on every covered floor.
  Dragging it one storey moves the whole range (0–2 → 1–3), with one undo step; range controls
  change coverage, and old single-floor values remain readable without inventing assignments.
  Removing a storey never deletes a range that still covers another one: it shrinks to the
  storeys left, and a home on the removed storey moves to the lowest of them.
  A Linie/Fläche dragged or turned WHOLE keeps its shape: at a tile's edge the translation stops,
  never each vertex (`whiteboard · floorGeometry.moveRigid`, 24.09.2026 — the per-vertex clamp
  flattened a Leitung onto the tile's rim in the field). Dragged ONTO another storey tile (body
  drag, or the bar's ✥ with the selection's centre over it), it goes to that storey (27.10.2026,
  `grundriss · shiftStoreys`): every storey it is on shifts by the same step, a symbol's Von/Bis
  with it, the target tile lights up, one ↶. A docked line, a turn, or a step that would put any
  vertex off the stack keeps it on its storeys; a single vertex still changes storey by its own grip.
  - *A storey's acts live in its LABEL* (29.09.2026). The label shows the word only («4. OG»,
    «EG», a custom name); the signed chip comes back only when a custom name hides the order. A
    tap opens a Menu «Ausblenden · Geschoss entfernen» — Ausblenden is a way of looking
    (device-local, on read-only surfaces too, the folded strip is the way back), «Geschoss
    entfernen» is the danger row and stays the owner's confirm-with-undo (workspace/useGebaeudeActions ·
    removeFloor). No eye and no bin on the canvas: delete is the rarest act on this surface.
    «Kopieren nach …» (27.10.2026) sits in the same menu (not on a read-only surface). The label
    lies above the create tools' drawing layer, so it opens with any tool armed – the Wand stays
    armed, and under it a click on the label used to start a wall (`e2e/gebaeude-storey-menu.mjs`).

## The Grundriss on the storey stack

The Einsatz sketch of a building (owner picks 27.10.2026; peace time has the PDF plans). Rules in
`lib/grundriss`; how the Wand tool draws is `lib/draftMachine`'s.

- **A Wand is a Linie with a `role`**, no object kind of its own. The role says LAYOUT: it is
  what carries Durchgänge and is copied. A Wand lives on ONE storey – no Von/Bis for it. (Weg
  and Raum presets were dropped on 27.10.2026, round 2: a route is drawn with the normal Linie, a
  room with Wände.)
- **A Durchgang sits on a Wand** (`onWall`). Placed or dropped within ~30 screen px of a Wand on
  its storey it snaps onto the nearest segment, turned along it (no swing arc); further away it
  stands free and `onWall` is cleared. On the stack the Durchgang tool places «mehrere» by default;
  the ✕ beside the armed pill or Escape stops it.
  A mouse shows the door where the click would put it.
- **Doors ride on their wall in the board funnel** (`Whiteboard · writeBoard` → `carryDoors`):
  every write that moves a Wand – body drag, ✥ / ⟳, a vertex grip, a drop on another storey –
  takes its doors along in the SAME step (same segment, same fraction; a corner added or removed
  re-projects). A write that deletes the Wand lets its doors go where they stand. ↶ / ↷ restores
  pass untouched. A door the write moved itself is left as written.
- **«Kopieren nach …»** copies a storey's Grundriss – every Wand and every symbol of the
  library's «Gebäude» category, never Leitungen, Trupps, Gefahren, Notizen or Messpunkte – as
  INDEPENDENT copies (new ids, the target's storey, `onWall` remapped to the copied wall) onto the
  picked storeys, on top of what is there. A ranged symbol (Treppe 0–3) already covering a target
  is skipped there; every other lands with that storey as its only one. One commit = one ↶, and a
  toast names how many went where. The sheet (`components/StoreyCopySheet`, round 3: «Stapel»)
  shows every storey top to bottom – the source as «Vorlage», each other one a checkbox row that
  says what it already holds – and one button that names the result («Auf 1. OG kopieren»).

## Drawing a Grundriss

Sketching a building on the floor stack during an Einsatz (27.10.2026, the owner's picks on the
`range.html` prototype). In peace time the station has PDF plans; this is for the Einsatz only.

- **The Wand is a preset of the Linie, not a new object kind.** The Linie dock on the stack adds
  «Wand» (`components/WbControls · WbToolDocks`); the only Grundriss preset since round 2
  (27.10.2026) – a route is a plain Linie, a room is drawn with Wände. A Wand is an ordinary
  `draw` anno with `BoardAnno.role: 'wand'` and its own look (`usePlanDraft · GRUNDRISS_STYLE`:
  dark and solid). The role says the anno is LAYOUT: no Leitung couples onto a Wand end, and its
  own ends dock onto nothing (`Whiteboard · planCandidatesAt`, `useWbVertexEdit · vertDown`).
  A Wand lives on ONE storey – no Von/Bis.
- **Linie ↔ Wand afterwards:** the line editor's «Art» row (near its foot) switches a drawn line
  (`lib/grundriss · wallRolePatch`, one ↶): to a Wand it takes the Wand look and drops the hose
  fields – refused while a Trupp is on the line or the line climbs storeys (`grundriss ·
  wandBlock`); back to a Linie its Durchgänge let go as when the Wand is deleted, it gets the
  surface's default line width, and the Wand colour becomes the default ink. Since 28.10.2026 (owner, Lage ↔ Plan parity) the row is on every
  Plan sheet and on the Karte too (`useMapDrawing · setDrawingWallRole`, `Drawing.role`); the Wand
  TOOL, its snapping and the Durchgänge stay the stack's. A Wand writes no Verlauf row on either
  surface, its ends dock onto nothing and no Leitung couples onto them, and `role` crosses with
  the line between the Karte and a sheet (`tacticalObjects · SHARED_PATH_PROPS`, `planProjection ·
  projectOnto`). The Karte DRAWS a Wand at 5 px over a light casing (`grundriss · WAND_MAP_PX`),
  readable on the satellite and night map; the record keeps the 2 px. The audit patch carries every cleared field as `null` (`grundriss ·
  wallRoleWire`), so the Wiedergabe replays the switch both ways.
- **The Wand stays armed** – each piece is committed (one ↶) and the next tap starts the next
  one; a plain Linie still lands selected in its editor. It always draws in Punkte. A piece
  finishes on ✓ or a tap on its last point; a tap on the first point of a Wand with ≥3 points
  closes it (`usePlanDraft · tapPoint / tapDraftVertex`). A point that goes straight back along
  the piece just drawn commits that piece and starts the next one there, so a wall is never laid
  over itself (`lib/planSnap · backtracks`).
- **Snapping is a ring and nothing else** (`lib/planSnap`, pure; the owner: «just an easy way to
  snap things»). Magenta ring = it catches, small grey dot = free; a mouse also gets the ring
  following the pointer and a rubber band from the last point, a finger sees the ring while it
  presses (a drag still pans). A Wand point lands, in this order, on: a corner or end within ~14
  screen px; where its right-angle line crosses an edge in reach; the nearest edge in reach; the
  right angle alone, when it runs within 9° of horizontal, vertical, or along / across the piece
  before it; else exactly where it was tapped (round 2, owner: «prefer 90° and snapping, but
  allow other angles»). A target always wins over the angle. Targets on the same storey: the
  Wände, the edges and corners of every Fläche, the open piece's own points, and the building
  outline (`Whiteboard · stackOutlinePx`). **Dragging a Wand's corner** – of the open piece
  still being drawn, or of a finished Wand – lands by the same rule against both of its
  neighbours, with the same ring (`usePlanDraft · snapDraftVertex` / `snapWallVertex`, called
  from `useWbVertexEdit · draftVertMove` / `vertMove`). **Moving Wände whole** (body drag, ✥, a
  group, also onto another storey) snaps rigidly: the move shifts so the nearest Wand corner of the
  selection lands on a corner, else an edge, of the storey it goes to – the selection itself is no
  target, the shape never changes, doors ride along, same ring (`planSnap · snapMove` via
  `usePlanDraft · snapMoveOf`). A selection without a Wand moves unsnapped. A plain Linie in Punkte mode on the stack snaps only
  onto the centre of a Durchgang, a Türe or a Treppe – that is how a Leitung is laid through
  doors and up the stairs. The stored point is exactly the snapped one.
- **An open drawing looks open and is never left unasked.** While a Punkte drawing is in the
  hand it is drawn in amber marching dashes with a pulsing «Wand offen» pill at its last point,
  and its rail tile carries an amber dot – on the Plan and on the Karte. Leaving it (another tool
  or mode, ✕, Escape, a selection landing, tapping another storey while a Wand is open) asks «Speichern · Verwerfen · Weiterzeichnen» (`lib/draftMachine · releaseDraft /
  askOpenDraft`); a fragment too short to commit goes silently. Two leaves cannot be answered
  and commit with a toast instead: the document itself going away, and arming «Karte verknüpfen».

## Automatic alignments and their approval

- **The field never asks for an automatic alignment** (13.09.2026; the unreachable client path –
  chooser, request, proposal review on «Deckung prüfen» – was deleted on 25.10.2026). Out there a
  sheet's link to the map has exactly two states: set by hand with reference points («Karte
  verknüpfen» in the Plan sheet behind the Objekt chip arms the point flow directly), or «Verknüpft» because the station approved the
  server's proposal (next bullet). The matcher is server-side (`app/georef_suggest.py`, evaluation
  + provenance in the gitignored `docs/planning/auto-alignment/`): it segments the sheet and
  matches it against OSM building rings via the Overpass proxy. Its heavy CV deps are the
  **optional `georef` dependency group** (`uv sync --extra georef`), installed in the production
  image since 11.09.2026 (`Dockerfile`, both `uv sync` lines). It runs only in the alignment worker
  (`app/plan_alignment_compute.py`); the field's `POST /api/georef/suggest` and its
  `integrations.autoAlignConfigured` flag were deleted on 25.10.2026. The honesty rules are
  load-bearing: an automatic fit is stored as exactly **two pairs `kind: 'auto'`** (more would fabricate zero-residual evidence); while any
  auto pair is in the fit no surface ever claims a ⌀ — but **whether it is called «ungemessen»
  depends on the APPROVAL** (18.09.2026): an unapproved automatic fit reads «Automatisch
  ausgerichtet · ungemessen» in the amber tone, while a fit the admin greenlit on Objektpläne is a
  plain **«verknüpft»** everywhere — chip tone, lamp («Von der Station freigegeben», green),
  Passung, Ebenen row — with the residual simply OMITTED rather than replaced by a word that calls
  a reviewed reference doubtful. The signal is the binding, never a heuristic on the pairs:
  `incidentPlanBindings · incidentBindingApproved` (`source === 'approved'` and no operator
  `override`), threaded into `georefChip` / `georefLamp` / `GeorefQuality` / `georefPlans`; one
  operator-set pair of their own is a correction in progress and brings the «ungemessen» wording
  back. Auto anchors are ghosted, badged «A», excluded from every count, and the SECOND
  operator-set pair drops them (`georefMode · settleSlots`); score ≤ 6 = confident, under the
  template ceiling (12 · m1 16) = amber «Deckung nachprüfen», above = «kein Vorschlag» — and an
  **m1 result is never confident**.
- **Plan alignments are pre-computed server-side and published only by explicit approval**
  (11.09.2026). Every distinct byte version of a Modul-PDF is pinned as an immutable
  `plan_revisions` row (`plans.py · store_plan` — identical bytes are a metadata refresh, old
  blobs are never deleted) and queues one durable `plan_alignments` job the scheduler worker
  prepares (`plan_alignment_worker`, claim/lease/CAS; the CV match from the same `georef`
  extra). An admin reviews and approves on the Objektpläne page (`admin/PlanAlignmentReview`,
  `/api/admin/plan-alignments`); nothing is published by computing, fetching or selecting.
  Approved fits surface at `GET /api/reference/{id}/alignments?v=N`, and an incident FREEZES
  what it opened as an `IncidentPlanBinding` in the workspace blob (`lib/incidentPlanBindings`:
  exact dataset revision + fit; first binding wins, corrections are an `override`, an override
  with empty pairs is a deliberate disconnect — a later replacement or approval never moves a
  running Einsatz's backdrop). ⚠️ The one thing a frozen binding may still GAIN is its `floors`,
  once and only from the SAME dataset revision (`fillBindingFloors`, also inside
  `mergeIncidentPlanBindings`; `useObjectPlans` asks once per session): absent floors are an
  answer not given yet — bound before the pack was published, or by a device with an older
  cached answer — and a stack whose `pack.bindingId` names a floor-less binding reads «Kein
  Geschossplan» on every storey (prod, 20.09.2026). Floors that exist are never replaced. Bound sheets carry `incident:` georef keys, routed by
  `stationPlanScale · georefForPlan`; legacy fits under existing ink are preserved, never
  silently replaced.

## Plan PDFs and the tile pyramid

- **A plan sheet is drawn from a server-side TILE PYRAMID; pdf.js is the fallback** (21.09.2026).
  pdf.js walks a page's whole display list on every render, whatever the canvas size: the
  Gymnasium's A1 Modul 6 (357 000 paths) cost 4.5 s a pass on a desktop and 10 s+ on a tablet, and
  its 0.29 mm room stamps need ~600 dpi — a raster no tablet can hold, so the pixel budget
  (`lib/pdfRenderBudget`) capped it to mush. `app/plan_tiles.py` renders every current plan
  revision ONCE with PDFium into lossless-WebP tiles (512 px, top level 600 dpi, ~10 MB for that
  A1): a scheduler tick fills pyramids a few seconds at a time (`fill_once`; the page is loaded
  once per BATCH because loading parses it, each block is encoded before the next is drawn, and
  `malloc_trim` hands PDFium's ~200 MB back), and a cold tile is rendered on demand with its
  block. The fill walks documents of up to 12 pages on its own and EVERY `modul6` (a floor pack is
  one Geschoss per page, however many); a long PV/RWA document renders on demand only. Tiles are DERIVED: own storage root `plan-tiles/`, skipped by `app.backup`, regenerable.
  `GET /api/reference/{id}/tiles?v=N` is the manifest (revalidated — `complete` is live),
  `…/tiles/{v}/{page}/{z}/{x}/{y}` a tile (the revision is in the PATH → immutable), both under
  the same session/link narrowing as the PDF itself (`auth/incident_link`). Client:
  `lib/planTiles` is the pure half (level by the √2 rule, visible tiles, the stitched multi-page
  layout — ⚠️ which must never drift from `PdfViewport · render`, ink is stored in it);
  `PlanTileLayer` (board) and `FloorPage · TiledFloorPage` (Gebäude storeys) mount an always-there
  small UNDERLAY plus the on-screen tiles of the level the zoom asks for, so a device holds about
  two screenfuls of pixels for any sheet at any depth. A surface that provides
  `lib/planSharpness · PlanSharpnessContext` (only the Karte's reader, 17.10.2026) hears whether
  the current view's detail is still loading or could not be had, and has the next level over the
  same area fetched ahead; without it the board behaves as before. Tile overlap against seams is half a
  PIXEL, never a constant of the unit square. `lib/planTileRaster · composeTiles` gives the
  Karte backdrop and the ink scan their pixels without a bake, and a
  tiled sheet is never pre-baked. `lib/planTilePrefetch` fetches an object's complete pyramids
  through the service worker (public/sw-tile-store.js: tiles cache-first, manifests network-first,
  both in IndexedDB and purged on denial) so a sheet is whole offline. No
  pyramid (unpinned/bundled PDF, >80 pages, PDFium cannot read it, a tile that cannot be had
  offline) ⇒ every caller keeps the pdf.js path unchanged.
- **The plain reader (`PdfScroller`) has ONE section switcher** (27.10.2026): viewer-only plans
  (Modul 6, Zusatz – e.g. Evakuationspläne) and the plans on an Objektbesuch open in the app,
  pages top to bottom. Its sections are the PDF's top-level bookmarks (`lib/pdfJumps`, pdf.js
  `getOutline`), else its page numbers; the one being read is marked, a tapped one goes to the
  top. It stands at the bottom: on a phone the docked strip above the nav bar (`PhoneTabBar`, like
  the Einsatzrapport), on a tablet in the board's floating row beside the object chips (where the
  Tafel's page strip stands); a reader in its own overlay (Objektbesuch) keeps it at its foot. Its last button is «Öffnen in …» (the `external`
  glyph): the system share sheet with the file, a download where files cannot be shared
  (`lib/pdfShare`, from the bytes the reader already holds). Zoom stays gestures only.
