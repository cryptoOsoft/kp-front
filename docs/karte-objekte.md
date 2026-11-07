# Karte & Objekte

Status: 🟡 in progress (from 2026-10-16). The station reads and the `/karte` viewer are built; the
home switch (Karte & Objekte as the start when no Einsatz is open), the menu sheet, the
Einsatz-menu entry back to the viewer and deliberate offline downloads follow in their own changes.

«Karte & Objekte» is the station's reference viewer **outside an Einsatz**: a member looks at the
station area, an object's plans and notes, the register facts of any building, and starts an
Objektbesuch from there – without opening an Einsatz to get the data. It is read-only for
operational and station data, and it has its own view state: nothing it does moves, selects or
binds anything in an Einsatz.

## Who may read

Account sessions – `editor`, `el` and `viewer` alike – and the deployment-admin session. Every
incident link (alarm, view, Atemschutz, terminal) and the Erfassungs-Poster's capture token get
**403** (`backend/app/api/station_reference.py · get_station_reader`; the link allowlist does not
name these routes either). A link is scoped to one Einsatz and must never become a door onto the
station's register. Starting an Objektbesuch from the viewer stays governed by
`objectVisits.captureRoles` ([`object-visits.md`](object-visits.md)).

## `GET /api/reference/objects`

Every station object in one payload, which the client searches and keeps for offline:

```jsonc
{
  "objects": [{
    "id": "<uuid>", "name": "Schloss Musterdorf",
    "kind": "einsatzobjekt" | "objekt",
    "address": "Schlossgasse 9", "locality": null,              // locality: the town, only when not the home town
    "lat": 47.52, "lng": 7.57,                                    // null when the station has none
    "outline": "auto" | "building" | "none",                      // the station's outline choice
    "aliases": ["Schlossgasse 9 - Wasserschloss"],
    "plans": [{ "id": "plan:<uuid>:modul23", "module": "modul23", "code": "2/3", "title": "…",
                "pages": 3 | null, "georef": true, "version": 2, "updatedAt": "…" }],
    "floors": [{ "index": -1, "name": null }, { "index": 0, "name": "Hauptebene" }],
    "egid": null, "footprint": { "type": "MultiPolygon", "coordinates": [ … ] } | null,
    "underground": { "type": "MultiPolygon", … } | null,          // a named row's garages/shelters, drawn dashed
    "measures": "…", "remarks": "…", "measuresSource": "Modul 1 · Stand 03.2026", "updatedAt": "…",
    "lastVisit": { "id": "ov-…", "checklist": "Kontrolle Schlüsselhülse", "date": "…", "defects": 1 } | null
  }],
  "generatedAt": "…"
}
```

How each field is derived – none of them is a new column:

- **All objects**, including the plan-less ones an Objektbesuche organizer created (the stops of
  its Kontrollgang). The Einsatz pickers (`/api/objects`) leave those out on purpose; the viewer
  lists them.
- **`kind`**: `einsatzobjekt` when the object carries a Modul-PDF, `objekt` otherwise.
  ⚠️ **There is no `depot` (key box) any more** (owner, review round 3, 17.10.2026: «Mühlematt-
  strasse 24 doesn't have a key box … I think we can just highlight buildings / building groups»).
  It was guessed from a `fwo-schlue` ref or «Schlüssel…» in the name — but that ref only says the
  object is on the organizer's yearly Kontrollgang (FWO Admin's FU tours of 2026 carry a SchlüHü
  id for their stops, Einsatzobjekte with plans among them). Every object is a building or a group of
  buildings now, drawn like every other. The API never sends `depot`; a client reads an older
  server's or an older cached catalogue's `depot` as `objekt` (`lib/api/stationReference ·
  withRetiredKinds`).
- **`address`** — for every object where one is knowable (review round 2, 17.10.2026: six plan-less
  objects sent `null` and the viewer printed the kind word): the station's own
  address; else the NAME when it is a street + number («Mühlemattstrasse 24», «Bienenstrasse 28
  (EH)» → «Bienenstrasse 28»); else the register's (GWR) address at the pin, which the footprint
  job asks once per coordinate (`object_footprints · place_at`, never per view). `null` only when
  none of the three exists. **`locality`** is the town only when it is NOT the home town
  (`map.geocoder.defaultLocality`): the station's stored `objects.locality`, else the town of the
  register entry at the pin. The client prints «address, locality» («Erlenstrasse 60, Therwil»);
  the home town is never sent.
- **`outline`** — the station's choice in /admin («Lage korrigieren», below): `auto` = the rule
  under `footprint`; `building` = only the building at the pin; `none` = no outline at all — the
  viewer then draws NO OSM fallback either (`lib/karte/places · objectBuildings`).
- **`aliases`**: the plan library's folder name when it differs from the name and address, and
  the names of objects merged into this one (`admin_objects_repair merge`, docs/AGENT-RUNBOOK.md).
- **`plans`**: the object's PDF datasets with bytes, by module. `code` is the module key without
  «modul» («23» → «2/3»). `pages` comes only from a tile manifest the server already wrote
  (`plan_tiles.stored_page_count`) – the listing never opens every PDF – so it is `null` when
  unknown. `georef` is true when the CURRENT revision has an approved fit that passes the same
  gate as `GET /api/reference/{id}/alignments` (`plan_floors.fit_publishable`).
- **`floors`**: the Geschosse of the current revisions' floor packs, by signed index; the words
  («EG», «1. OG») are the client's copy (`lib/whiteboard · floorLabel`), the station's own name wins.
- **`egid`**: no station source carries one today, so it is `null`.
- **`footprint`**: EVERY building the object stands for, as one MultiPolygon, the building its
  point lies in first (review 17.10.2026: Schulhaus Hüslimatt is five buildings on several parcels,
  and only one was red). Derived by the scheduler, never per request, from official data
  (`app/object_footprints`), for every object, and only read here — first match wins:
  1. **the addresses in its NAME** (review round 3, 17.10.2026 — owner: «outline all the
     houses»): an object named by a row of houses («Stallenmattstrasse 2-14, Kaibmattweg 1-5
     (EH)», «Hohestrasse 136-158», «Auf der Wacht 14&16») is every building of every address the
     name covers. `app/address_ranges` reads the name and the plan folder alias («<address> -
     <name>»): street + numbers, ranges («2-14»), lists («14&16», «2, 4»), letters («128a-b»,
     «134f»). It counts only when the name holds a range or a list — «Sägestrasse 9» or «Hof
     Thürkauf, Im Buech 15, Im Buech 20» are left to the steps below. A number covers its
     lettered siblings (14 → 14, 14a) and a range the numbers in it that EXIST — **one side of
     the street when both ends have one parity** (owner, round 3: «you can assume that it's only
     the same side»: 136-158 → the even numbers, 27-29 → 27, 27a, 29), both sides when they differ
     (1-16). The register is the cadastral survey's
     Gebäudeadressen (`ms:HADR` on the same AV WFS) on those streets within 600 m of the point,
     in the town of the one nearest the point; each address's building is the survey footprint
     with its EGID, else the footprint its door point lies in. An address with no surface
     building is, in the survey, mostly an underground garage («(EH)» = Einstellhalle) or a
     shelter: its Einzelobjekt (`ms:SOSF`, «unterirdisches Gebäude» / «Unterstand», same open AV
     WFS) is served apart as **`underground`** and the viewer draws it as a DASHED outline in the
     object's colour — part of the object, tappable (owner, round 3: «if the garages are …
     accessible … in the default maps that we are using, it would be cool»; the station's Modul 1
     shows them too). Used when it finds at least one surface building and at most 60
     (`MAX_RANGE_BUILDINGS`, counting houses, not garages; more is logged — a name read wrong). No
     neighbour guard: the name is the station's own word for which houses the object is;
  2. the object's point in an allowed swissTLM3D **use area** (school, college/university,
     hospital, sports ground, swimming pool, cemetery, zoo, substation — the `landuse` layer of
     swisstopo's base vector tiles, z14) → every building whose centroid lies in it;
  3. else its cadastral **parcel** (geo.admin identify, `ch.swisstopo-vd.amtliche-vermessung`) →
     every building on it;
  4. else the one building its point lies in.
  The buildings are the cadastral survey's own footprints (amtliche Vermessung, Bodenbedeckung
  «Gebäude», geodienste.ch's open AV WFS, served in WGS84 — measured 17.10.2026 against swisstopo
  REFRAME on the LV95 originals: ≤ 1.3 cm). Steps 2 and 3 are skipped when too big to be one object
  (area > 150 000 m², parcel > 60 000 m², more than 15 buildings — an estate of unrelated firms)
  or when they hold ANOTHER station object's point: two catalogue objects on one parcel never
  claim each other's buildings (why «Stallenmattstrasse 1-14 …» and its near-duplicate «2-14 …»,
  points 55 m apart on one 8 100 m² parcel and in no building, had no outline before step 1). Sheds under 30 m² on the grounds are not the
  object's. `null` (nothing official at the point, not derived yet, a source switched off with
  `FOOTPRINT_AREA_TILES=` / `FOOTPRINT_BUILDINGS_WFS=`) → the viewer outlines the OSM building
  that CONTAINS the object's coordinate, as before. Never a building by proximity alone.
  What a source said is stored per coordinate (`reference/object-footprints.json` beside the
  building snapshot), so a moved or new object is asked once (≤ 20 points per two-minute tick),
  a catalogue change re-derives without asking anybody, and a failed ask is retried after an hour
  and never stored as «nothing there». A name's addresses are stored the same way, per point and
  per what the name says (`ranges`), so a renamed object is asked again and nothing else is. A footprint is served only while the object still stands
  on the point it was derived for.
- **`lastVisit`**: the latest COMPLETED Objektbesuch (drafts and discarded visits are not visits
  that happened), only where the station runs the module or for the admin session.

## Where an object is, and how the station corrects it

An object's position comes from its import: the station's private importer and `admin_objects
load/push` write the manifest's `lat`/`lng`, the SharePoint pull geocodes the folder's address
when it creates an object, `admin_objects_repair geocode-missing` / `repair-sharepoint-keys` fill the
ones without. ⚠️ **None of them may take a fuzzy match** (review round 2, 17.10.2026: ARA Birsig,
«Erlenstrasse 60» without its town — `geocode()` appended the home locality, swisstopo had no
Erlenstrasse in Oberwil and answered «Vorderbergstrasse 60, 4104 Oberwil», 1.1 km from the real
place in Therwil). They all go through `geocode.locate`: an EXACT street + number, inside the
region bias's bbox (`map.geocoder.bboxLv95` — the brigade's area, never a hard-coded town list),
the home town first; one match elsewhere in the area is taken (with its town), several towns and
none of them home is **ambiguous** — the object is left without a position and the census /
log names it for the station. A name that is no address finds nothing. The Einsatz's own
`geocode()` (an operator looking at the pin a moment later) is unchanged.

**«Lage korrigieren»** (Verwaltung › Objektpläne › an object › Lage; `admin/ObjectPositionSheet`):
an aerial (SWISSIMAGE) with the pin to tap or drag, the register search (`GET
/api/objects/position-search`, the area's exact matches first, home town first, the town said),
a «Dorthin» offer when the register puts the object's own address more than 60 m from its pin,
the outline the Karte draws today (dashed), and the outline choice (Automatisch / Nur Gebäude am
Punkt / Kein Umriss). `PUT /api/objects/{id}/position` (editors and the admin session only):

- marks the object `position_source = 'station'` — from then on `PUT /api/objects/{id}` (the
  manifest push), `admin_objects load`, the SharePoint pull and an organizer keep the station's
  `lat`/`lng`; the admin mask shows the coordinates read-only with the reason;
- a register pick also writes the address and the town (`objects.locality`, never the home town);
- appends `object_position_events` (before/after snapshot, who) — `GET …/position/history`;
  `POST …/position/undo` takes the LAST correction back, mark included (one step, then 409);
- the footprint job re-derives at the next tick (≤ 2 min): a new point is asked like any other,
  and the outline choice is part of the job's signature.

## `GET /api/reference/building?lat=&lng=[&address=][&lang=]`

The Gebäude card's `BuildingOut` ([`building-card.md`](building-card.md)) for any point, without
an incident: the same register lookup and cache (`api/building · fill_registers` →
`building_facts.registers_cached`), the same `registers` / `gwr_status` / `pv_status` states, the
same source and date fields for «Register-Hinweis».

`object` is set **only on an exact street + number match**: the register's address of the building
found (or, when the register has none, the searched `address`) equals a catalogue object's. Two
objects at one door → the one with plans. A neighbour ten metres
away is never «the building», because its gas valve would read exactly like this one's. `visit` follows
the object, under the same module rule as `lastVisit`.

⚠️ Both routes live on their own router, mounted before `api/reference`: that router's
`/{dataset_id}` would otherwise answer `/reference/objects` as a dataset called «objects».

## The viewer (`/karte`)

`src/components/karte/` — its own lazy chunk, mounted by `App` for the `/karte` route (deep link:
`/karte?objekt=<id>` selects an object; the address follows the selection without a history
entry). It is the app's home with no Einsatz open (below), and over an open one it is reached from
the Einsatz menu's «Einsatz verlassen»; a deep link at start opens no Einsatz behind it (the same rule as `/besuche`).
Not for a link session.

Where the code lives: `KarteApp` is the wiring between the concerns (what a selection, a tool or a
tap does to the others) and the markup; each concern is a hook beside it — `useKarteCatalogue`
(the start view, the deep link, the catalogue), `useKarteArrival`, `useKarteLayers` (the layers,
object colours, the aligned plan, Ebenen's rows), `useKarteOffline`, `useKarteOutlines`,
`useKarteTools`, `useKarteSession` (the address, the kept view), `useKarteMenu`, `useKarteSearch`,
`useKarteCamera` (framing, the way back, the compass), `useKartePlace` (register, addresses,
visits, hydrants), `useKartePointer` (hover and hold), `useKarteOverlays`, `useKarteTags`,
`useKarteKeys` (the keyboard, below). The pure
rules are `lib/karte/*` — `selection` (what a point hits), `overlays` (what the map draws),
`camera`, `places`, `labels` and the rest.

What it reuses, so nothing forks:

| Piece | Reused from |
|---|---|
| map, layers, vehicles, measure path, georef raster, weather radar | `MapView` (read-only, no drawings: its base props only, none of the tactical ones — `components/mapViewProps`) + `MapLayers` (a `polygons` overlay kind draws the outlines) |
| Ebenen | `LayerPanel`, under its OWN device key (`kp.layers.karte`, `lib/karte/session`), without the Einsatz-only layers (taktisch, Skizzen, Personen) and the catalogue's «Unterirdische Bauten» (its own Station row stands in); the radar's choice too (`kp.karte.radar`) |
| tools | the Einsatz's `ToolRail` (tablet) / the folded `navrail` bar (phone: Karte · Checkliste │ Messen · Gefahrgut · Ebenen — «Checkliste» below), `ToolDock` + `MeasurePanel` WITHOUT «Als Linie/Fläche übernehmen» (and without a line saying it is not saved — nothing here is), stacked on the phone like an Einsatz's: dock 8px above the bar, readout 8px above the dock (sweep 30.10.2026 #7), one bar lower because the Karte has no tool bar, `MapViewsButton` without saved views |
| weather | `useWeather` + `WeatherBadge` |
| plans | the NavRail classes and `PlanGlyph` (tablet rail), rows in the object's panel; a module opens in the Einsatz's plan reader — the Plan surface's `Whiteboard`, read-only, on the current revision (below); the Gebäude is the same `Whiteboard` on the Einsatz's floor stack (`lib/floorPackBinding · floorPackOf` / `packBuildingDoc`, below) |
| plan titles | the module catalogue the Einsatz's plan chooser labels its tiles from (`lib/planOrder · moduleCatalogue`), through `lib/karte/plans · planTitle` (below) |
| the phone sheet | Ebenen's own: `.layers-card`, `overlays/SheetGrab`, `overlays/useSwipeDismiss` |
| register facts | `lib/buildingCard` (chips, source line); «Register-Hinweis» folds the hint and the source line (below) |
| Gefahrgut | `UnHazardSection` — the Gefahrentafel's ADR/ERG block, extracted from `ContextPanel` |
| building outlines | the object's own `footprint` (above); for every other building and an object without one, the Umriss picker's `/api/overpass/buildings` (station snapshot first), loaded per grid cell (`lib/karte/outlines`) |

The rules that are easy to break:

- **The keyboard is the Einsatz's where the two have the same thing** (owner, 07.11.2026:
  «the keyboard shortcuts … also in the peacetime mode»). `lib/karte/hotkeys · resolveKarteHotkey`
  decodes on top of `lib/hotkeys · resolveHotkey`, so K Karte · C Checkliste · 1–9 the selected
  object's module · D Messen · B Ebenen · G Mein Standort · 0 Einpassen · + − zoom (the map, or the
  open plan through the reader's `fitRef` / `keysRef`) · ⌘ , Einstellungen · ? Hilfe mean the same
  in both. Only what the Einsatz has no surface for is the viewer's own: **P** Punkt setzen, **U**
  Gefahrgut (UN number), **/** and **⌘ K** the search; every other Einsatz key decodes to nothing
  here and is never claimed. Escape peels one layer back towards the plain map: search → compass
  menu → armed tool → open plan → selection. The letters stand on the tiles from the same tables
  (`KARTE_TOOL_KEY` through ToolRail's `toolKey`, `SURFACE_KEY` on Karte · Checkliste,
  `PANEL_KEY` on Ebenen). ⚠️ Nothing reaches the viewer while one of App's sheets is over it
  (`keysOff`: Einstellungen, Hilfe, Rückmeldung, the demo welcome …), nor with its own menu or
  «Auf diesem Gerät» open, nor from inside a dialog or a field.
- **Own state, never an Einsatz's.** No workspace, no saved drawing, no plan binding, no journal
  row. Measurements, the Gefahrgut rings and a dropped pin are component state; only the Ebenen and
  the view (`KarteView`: frame, selected object, open plan or the Checkliste, in sessionStorage) are kept —
  `karteViewSnapshot` is the one door into storage (`lib/karte/karte.test.ts` pins it).
- **A building is an object only by official data, containment or an exact address.** An object
  is drawn as its `footprint` (the buildings its name, use area or parcel give, above), else as
  the OSM outline that CONTAINS its own coordinate (`lib/karte/places · objectBuildings`); a tap
  on ANY of its buildings opens it (a building two objects claim — a named row and a house of it
  that is an object of its own — opens the one whose point stands in it), and the selected
  object's buildings all wear the strong style. A tapped building opens an object otherwise only
  when the register's street + number equals the object's. No outline under a point → no
  building.
- **A tap on a plain building selects ONE house** (Karte Haus round 1, 19.10.2026 — owner: «no
  differentiation between Storchenweg 2, 4, or 6»): the survey's footprint under the finger
  ([«Die Häuser»](#die-häuser-karte-haus-round-1) below), never OSM's block of a terraced row. OSM's
  outline only where the survey's set has no house (a shed, outside the Einsatzgebiet), before the
  set arrived, or with it off (`lib/karte/outlines · ringsAround`).
- **Object or house — the switch** (owner, Karte Haus round 1 · variant A, 19.10.2026: «it's very
  hard to click the underlying building if there is a plan on top of it»). A tap on one of the
  buildings of an object that HAS several opens the object as before and remembers that building
  (dashed blue). Right under the panel head, the app's `Segmented` (round 2, owner: «the toggle changes height
  and isn't using the normal style»; its picked half a neutral surface pill since review round 4,
  not the blue choice fill — the panel's one rhythm, below): **Objekt** (no plan count since
  27.10.2026 – the tiles right under it show the plans) |
  **<the house's street>** («Dieses Haus» until the register, asked at the tapped point as a
  building tap asks, names it), one line per half — a long street ends in «…», so the switch has
  the same height on both levels and for every name. One tap switches, both ways, on the tablet
  and the phone sheet. The map reveals the house that was TAPPED (moving only when it is under the
  panel or sheet), not the object's point where its tag sits a block away (owner, round 2:
  «Amselstrasse 30 … moves to the label of the entire block»); search and In der Nähe still fly to
  the object. The house level
  is the building panel for that ONE ring (blue), «Teil von <Objekt>» under its name, the switch
  still there — and the register rule above never throws it back to the object (`Sel.of`). The
  level sticks while the taps stay on the same object (on house level another of its buildings
  opens as a house); another object opens at object level. Search, a list row or a tag open the
  object without a house, so no switch.
- **Hover is the mouse's** (owner, Karte Haus round 1: «a hover state with cursor change»). Only
  `pointerType === 'mouse'` moves count — a finger never shows a hover state. The pointer cursor
  over whatever a click opens (an object's building, a plain building, a tag), the normal one
  elsewhere and while a tool takes the taps (Messen, Punkt, Gefahrgut's centre). Over an object's
  building all its buildings brighten, the one under the cursor gets a white line and a label
  beside the cursor names the object (kind + name); over a plain building a thin blue line, no
  label. The mouse over a hydrant on the map (its layer on): «39 m südlich von <selected place>»
  («Hydrant» with nothing selected), its In der Nähe row lights up; a hydrant stays not clickable.
- ⚠️ **The tag sits ON the object's point** (owner, review round 3, 17.10.2026: «do not move the
  location of the marker»). Centred on the coordinate the station set, exactly where the dot is;
  the placement pass decides only WHETHER it shows, and a tag at a side edge slides inward at most
  until 16 px of it still cover the point. A long name folds onto two, at most three, balanced
  lines at 280 px (owner, Karte Haus round 2: «long labels should fold» — «Stallenmattstrasse 2-14,
  Kaibmattweg 1-5, Stallenrain 1 (EH)» ran off both screen edges); the placement pass measures the
  folded size on its off-screen twin. A folded tag's box is as wide as its longest line, not the
  280 px (Karte Haus round 3: «boxes fitted to the width»): CSS cannot shrink a wrapped box, so
  the twin's lines are measured and the tag gets that width inline (`e2e/karte-tag-fit.mjs`). Round 1 hung the tag under its building's south edge,
  round 2 moved it inside its own building when that spot was another object's — both put the
  name somewhere the point is not, and that read as a moved marker.
- **A tag is the name, never a plan count** (owner, round 3: «we just care that there are
  plans»). Whether an object has plans is its colour: the station's category (below), or, with
  no categories configured, the default look — ink rim, dot and outline with plans (the named
  token `--obj-plans`: near-white at night, near-black by day; owner's pick 7A, 23.10.2026 — it was
  red, and red is danger's: the running Einsatz's chip is now the Karte's one red), a faded grey rim
  and dot without (`Karte.module.css · .bare`). No count on any tag or row; the sheet's plan rows are
  the only list of plans.
- **Dots, and a name only where it fits** (owner, 17.10.2026; `lib/karte/labels`). Below z16 every
  object is a small dot (a 32 px tap target); no text. From z16 on a tag only where it fits: one
  greedy pass in screen space once the map has settled, the selected object first (always
  tagged), then Einsatzobjekte, then more plans; a tag that would cover another tag or the chrome
  (top bar, bottom bar, an open panel or sheet, the rails — every child of the surface but the
  map) stays a dot. Outlines draw from z15 as before. The pass also runs every 200 ms WHILE the
  map moves, and decides the tags in a ring around the map too (0.6 × its longer side): a pan
  brings the next tags in already standing, not on release (owner, 25.10.2026). The map's own tags
  go first, exactly as without the ring – a tag just off the map never displaces one on it
  (`components/karte/useKarteTags`, `placeTags · pad`; check: `e2e/karte-tags-pan.mjs`).
- **No key boxes on the map** (owner, round 3): no FKS «Schlüsseldepot» symbol, kicker, note or
  mark. The objects once drawn that way are objects like any other — outline, dot, tag, colour.
- **A turn let go just off north lands on north** (owner, review round 6, 18.10.2026: «add a small
  snap to north too like other places»). Two fingers (past the twist gate's 12°) or the mouse's
  right-drag that come to rest within `NORTH_SNAP_DEG` (10°, owner round 7: «a little bit stronger»; round 6 had 5°) of north ease onto exactly north in
  200 ms; further out the map stays turned and the compass's «Nach Norden» is the way back. The
  Karte and the Einsatz alike — it lives in `MapView` (`lib/mapTwist · createNorthSnap`). Never
  mid-gesture, never for the keyboard or a programmatic bearing. MapLibre's own `bearingSnap`
  (7°, a fixed 1 s ease nobody read as a snap) is off, so this is the one rule. Check on a running
  stack: `e2e/karte-north-snap.mjs`.
- **Holding the compass goes to where I stand** (owner, Karte Haus round 2: «the user's location
  … is more likely than the entire village»). One GPS fix, then zoom ≥ 17 on it, as the menu's
  «Mein Standort» row; no position (denied, timed out, no GPS) fits the station's objects as
  before. The menu's «Einpassen» row stays, and its ⓘ says what the hold does (`ViewsApi.hold`).
  The Einsatz's compass still holds to «Einpassen».
- **«In der Nähe» is distance only**, and the panel says so in a sentence (owner, Karte Haus round
  1: «prioritize … based on proximity and not based on their type»). ONE list, nearest first, at
  most five rows: station objects within `NEARBY_RADIUS_M` (160 m) and hydrants mixed
  (`lib/karte/places · nearbyPlaces`). The nearest hydrant is always in it, however far — in place
  of the fifth row when five closer things fill it (no «Nächster» tag since 20.10.2026: the order says it). A hydrant row is tinted
  blue, titled «Hydrant» (the FireGIS export has no numbers; the old «Hydrant 632» was an index)
  with the compass direction from the selected place (8 directions) under it. The mouse over the
  row (a tap on touch, which keeps it until tapped again) shows that hydrant on the map: a ring on
  it, a dashed line from the selected place, the metres at the line's middle; the map moves when
  it is off-screen or under the panel, and a new selection clears it. A TAP on a hydrant row also
  switches the Hydranten Ebene on, kept like a toggle in Ebenen (owner, Karte Haus round 2); the
  mouse over a row never changes the layers. A house never lists its own object. «From the selected place» is the house that was
  tapped whenever there is one — also on object level (owner, 19.10.2026: a row of 21 houses is not
  stood at its catalogue point) — else the object's point (search, tag, a list row).
- **The panel, in one order** (owner, 17.10.2026 · review round 2; its top 27.10.2026 · mocks
  2B/2C), the same for an object on the phone and on the tablet: head (kind, name, address, ✕) ·
  the station's word (Sofortmassnahmen, then Bemerkungen, no source line since 27.10.2026 — what matters most in
  a hurry) · Pläne & Module as tiles, two to a line (the plan's name only, offline the «auf diesem
  Gerät» mark — below) · Gebäude laut Register as bullets (the hazards first, each with ⚠ and its word) · In der Nähe ·
  Objektbesuche · the actions LAST, «Objektbesuch» and «Melden». A plain building or a dropped pin keeps that order with what
  it has (Register as the same bullets, In der Nähe, Melden; a pin also «Koordinaten kopieren»), a
  plan-less object too (no tiles). Every part is a top-level section with its head — no card
  around the first ones, no tabs (owner, 27.10.2026: «keep everything top level»). The action row is two equal halves where both labels fit; else the longer
  label takes what it needs, and where the two do not fit one line (French/Italian at 390 px) each
  gets a row of its own — a label is never cut (owner, review round 5: «koordinaten kopieren clips
  the button»). No «Messen ab hier» (Messen is the bar's / the rail's) and no
  «Objektplan auf der Karte» row: the aligned plan is switched in Ebenen (`Pläne` group, the
  viewer's `karte:objektplan` twin), which keeps the capability. Section titles are the sheet's
  group heads (eyebrow, no glyph); a missing or quiet fact is a line, not a box — only a warning
  (no coordinates, the register unreachable) keeps its box.
- **One rhythm** (owner, Karte Haus review round 4: «do a ui hierarchy pass. it feels like some
  buttons are larger than others»; picked mock A, the phone sheet too): one size per role in the
  panel. Every list row is 44px with a 14px title (round 6) and its quiet sub on the title's line («Hydrant südlich»; it
  wraps under the title only where the two do not fit) and its read-out one step smaller; a plan
  tile is as tall and its words as big, behind a document glyph (the Gebäude with the floors
  glyph). The switch is 36px and neutral, the ✕ 32px, the register lines the size and weight of the
  Sofortmassnahmen (read-only facts, not buttons; a hazard's bullet is the amber ⚠, nothing else),
  the actions the app's 44px button. All of it is the panel's own (`Karte.module.css` · «one rhythm»): the global `ListRow`
  (search, library, Objektbesuche) and the Einsatz's Gebäude card keep their sizes.
- **On a phone the panel is the Ebenen sheet** (owner, 17.10.2026 · R2: «a full slide-up like for
  "ebenen" and not this half thing»). `KartePanel` wears `.layers-card` there, so it IS that sheet:
  flush with the bottom edge and both sides, over the bar, the hero corner, hugging its content up
  to Ebenen's cap, the grab bar on top, pushed down to close (`useSwipeDismiss`; the head is the
  handle, a scrolled body scrolls), the toasts moved out of its way like for Ebenen. One height,
  no peek. It sits over the bar but under the top bar (`--z-chrome-raised`), so the menu button and the
  search still open over it. ✕ or a push down closes the SHEET only: the place stays selected —
  outline, tag, pin, `?objekt=` — and a tap on it again brings the sheet back; a tap on empty map
  deselects. A dropped point (Punkt setzen) is the exception: it exists only for its panel, so
  closing that takes it off the map (28.10.2026, owner). A place selected on a phone is framed in the strip above the sheet (the deep link's
  first frame too). The tablet keeps the left panel, its rail and ✕ = deselect.
- **A plan opens in the Einsatz's plan reader, read-only** (owner R2: «the normal pdf viewer we
  have just without the annotation»). `KartePlans · KartePlanBoard` mounts the Plan surface's own
  `Whiteboard` (the lazy chunk, `workspace/lazySurfaces`) on the plan's current revision: the page,
  pan/zoom and the floating ± / Einpassen a locked device reads a plan with — and for a module the
  catalogue marks `viewer` (Modul 6, PV) the same scrolling reader the Einsatz opens there. It is
  handed no Einsatz: `readOnly` (no tools, editors or floor controls), `slimTools` off (no Auswahl
  on an empty sheet), `linkViewer` (no Maßstab / Passung chips — no door to a calibration or to
  «Karte verknüpfen»), no annotations, and every writer a no-op (`onChange`, `log`, `emit`, the
  history); no `incidentId`, `onCalibrate` or `onObjectSwitch`. Its bottom-left row is hidden: the
  Karte's chip row («Zurück» on the phone, the object's name on the tablet) is the way back,
  and so is the bar's Karte tab. No «Auf der Karte» beside it (owner, review round 3,
  17.10.2026: struck as not needed — the aligned plan stays switchable in Ebenen). `KarteApp.test`
  pins what is handed in.
- ⚠️ **The plan lies out exactly like an Einsatz's** (owner, review round 4, 17.10.2026: «use the
  same display like we have for our plans normally -> not this clipping here»). The reader keeps
  the box of an Einsatz's plan with no tool bar under it — on a phone ending 18px above the one
  bar, on a tablet the whole surface — and its own fit (`lib/whiteboard · containFit` with
  `bottomInset`) keeps the floating row free; the Karte's chip row stands exactly where the
  reader's own `.wb-botleft` would (8px above the bar on a phone, 16px off the foot beside the rail
  on a tablet). The Karte's root wears `.phone-tools` (its docks stack like an Einsatz's), so
  `Karte.module.css` must keep the reader out of that two-bar box. Round 3 ended the reader a
  whole chip row higher AND let the fit reserve the row again.
  The box is only what the FIT measures: what is drawn is full-bleed (owner, round 4: a plan
  dragged down «doesn't neatly go behind all of the other bottom UI elements»). On the phone the
  stage does not clip at the box (`.wb-canvas { overflow: visible }`), so a dragged page slides on
  under «Zurück» and the bar to the screen's foot, with the stage's own ground behind it; the
  chrome floats over the plan.
- **The Gebäude is the Einsatz's, without editing** (owner, review round 4: «literally 1:1 the
  same as in the normal incident just without editing»). `KartePlans · KarteGebaeudeBoard` binds
  the object's floor pack IN MEMORY exactly as an Einsatz binds it (`lib/karte/gebaeude ·
  objectFloorBinding`: the first plan whose published metadata names floors, the approval on page
  0 else the first with an aspect — `useObjectPlans`' rule, under its sheet id), and from there
  runs the Einsatz's own pipeline: `floorPackOf` → the frame measured off the pages
  (`trimmedPackFrame`, bounded by `PACK_TRIM_MS`) → `packBuildingDoc` (the one builder of a pack
  stack, which the Einsatz's seed in `useGeorefFits` calls too) → the same read-only `Whiteboard`
  with `building` and `floorPack`. Storey labels, «Ausblenden», the stack's zoom and the compass
  are there; no building pick (`onBuildingFace` absent), no storey added or removed (`readOnly` + a
  pack stack), no compass turn (`onReorient` absent), no tools. A pack the station has not aligned
  takes the page's own size (the tile manifest) for the fit's aspect — an Einsatz would show no
  stack there; with neither, the plain storey list of round 2 stands in (`KarteFloors`). Nothing
  of it is stored.
- **The plan says when it is still sharpening** (owner, review round 3: «if you zoom in quickly
  before things have loaded, everything is blurry … we're obviously not fully offline like with a
  normal incident»). In an Einsatz the tiles are on the device ahead of time; here they come over
  the network on demand, and the soft underlay looks the same whether the detail is on its way or
  will never come. `KartePlanBoard` provides `lib/planSharpness · PlanSharpnessContext`, and the
  reader reports the CURRENT view: `PlanTileLayer` from its pending/failed detail tiles (quiet while
  the underlay itself is cold — the reader's own «PDF wird geladen …» speaks then), the pdf.js path
  from a preview standing in for the full bake or a deep-zoom refine pass not yet landed. The chip
  stands top centre under the bar, never takes a tap, and shows only after 300 ms of «not sharp»
  (a quick load never flashes): «Schärfere Ansicht wird geladen …» with the Shell trail, «Schärfere
  Ansicht nur mit Netz» when a tile could not be had offline, «Schärfere Ansicht konnte nicht
  geladen werden» online. Once the view is sharp and the device online, the reader fetches the
  tiles a 2× zoom of the SAME area would ask for (at most 48, low priority, each once — never a
  whole plan), so a quick zoom is sharp sooner; the service worker keeps them (`plan-tiles`). The
  Einsatz's Plan surface provides no context: no chip, no fetching ahead there.
- **The finger's hold answers what a mouse answers on hover** (owner, review round 7, 20.10.2026:
  «also on mobile highlight the building outlines on hold so we know what we're pressing before we
  let go» + «the point setting option should also occur automatically if you just long press on the
  map»). A touch has no hover, so the press itself says what it is about to open, in the mouse's
  own outline (`KarteApp · outlined`): the building or object under the finger lights up the moment
  it lands, and the release opens it exactly as a tap always did. On FREE map — no building, no
  object under it — the same hold sets a point instead, after `lib/useLongPress · LONG_PRESS_MS`
  (500 ms, the one beat every still hold in the app answers on), with the short buzz and Android's
  context menu suppressed. The release that follows is not a tap: it would deselect the pin the
  hold just set. Any movement past the drag tolerance is a pan and cancels both.
  - **The split is the owner's own** (grilling, 20.10.2026): «long press sets a point only on free
    map. On a building/object: the hold highlights the outline and releasing opens the building —
    no point there.» It is not widened: no pin over a building, no label beside the finger.
  - **⚠️ The hold never arms under a tool** (owner, review round 3, 17.10.2026: «I can't delete
    nodes when measuring because it wants to create a point»). The first long-press-to-pin fired
    everywhere, including under a held measure node — the hold that removes the node
    (`MapView · vertexPress`) — dropping a pin and leaving Messen, and it was removed for that.
    The gate that brought it back is the one that already existed: while Messen, «Punkt setzen» or
    Gefahrgut's centre takes the map's taps (`lib/karte/camera · toolTakesTaps`) the surface's hold
    does nothing at all, and neither does the outline. `KarteApp.test` holds a node under Messen
    and checks that no pin appears and the node still goes.
- **A tool that waits for a tap takes every tap** (owner, review round 4, 17.10.2026: «while
  measuring we should also be able to measure on top of objects (not have the objects get
  highlighted)»). While Messen, «Punkt setzen» or Gefahrgut's centre (rings on) is armed, a tap on
  an object's outline, dot or name tag is a tap on the map at that spot: the dots and tags let the
  finger through (`pointer-events: none`), nothing is selected or highlighted, no sheet opens; the
  objects stay drawn (`lib/karte/camera · toolTakesTaps`).
- **Closing a selection gives the camera back** (owner, round 4: «… revert the position again so
  it doesn't constantly push the map south»). Selecting frames the place in the strip above the
  phone's sheet (beside the tablet's panel) with MapLibre's camera padding, which stays on the map
  after the move — so each select/close used to leave the map a sheet's height further south. The
  camera before the selection (centre, zoom, padding) is kept and eased back to (350 ms) when the
  sheet closes (✕, pushed down, a tap on empty map); a second selection while one is open keeps
  the first one's camera; a move the user makes themselves (a MapLibre `movestart` with an
  `originalEvent`) drops it, and the map stays where they put it. A pick from the search is a
  deliberate jump: closing it keeps the place and only drops the padding (centred on the whole
  map). The rule is pure: `lib/karte/camera · returnOnSelect / cameraOnClose`.
- **Back from a plan, the object is in focus** (owner, review round 6: «sometimes the object isn't
  neatly in focus like it should be»). A tap selects in place (the map only moves when the place
  is under the panel), so the object stood wherever it was tapped — at the bottom right, say —
  and stayed there after a plan. Leaving a plan or the Gebäude for the map now eases the selected
  object's point into the middle of the free map (500 ms, the zoom kept); ✕ still gives back the
  camera from before the selection. On the tablet the free map is right of the panel and left of
  the tool rail, under the bar, from the rails' published widths (`--rail-w`, `--vrail-w`), so the
  expanded rail (round 5's chevron) moves it too — the fixed 440 px it replaced put a searched
  object 68 px under an expanded rail's panel (`lib/karte/camera · besidePanel`; the same frame for
  a search pick, a deep link and «Objektplan»). Checked in a browser by
  `e2e/karte-plan-back-camera.mjs`.
- **A plan tile is the plan's name, nothing else** (owner, review round 4: «just "modul 1",
  "modul 2", etc. is enough»; 27.10.2026: «spelled out as Wasser, and then with 1 or 2 if there
  are multiple … the same way as for photovoltaic, where it's just PV»). ONE rule, `lib/navRail ·
  planLabel`, read by every place a plan is named — these tiles, both rails, the phone's «Plan
  wählen», the Objektbesuch and the Verknüpfen toggle: «Modul 1», «Modul 2/3», «Modul 4»,
  «PV», «RWA», «Wasser», «Wasser 2», «PV 15» — a numbered module «Modul N», a sub-slot its own
  word (up to three letters upper-cased, a longer one capitalised), never «Modul 5-…» and never
  a lone letter. From the module key, never a file title or the catalogue's code («M4», «W»). No
  title, no «PDF · 1 Seite · auf Karte ausgerichtet», no number badge; the «Gebäude» tile says
  «Gebäude». Offline the ●/◐/○ mark trails the words (its word for a screen reader in the label).
  A key that is no module key says the plan's title.
- **Plan titles** (`lib/karte/plans · planTitle`, the tablet rail and the view label): many sheets in the real catalogue are titled by
  their file name, «<object> – <module key>» («Migros – modul2», «Sägestrasse 8 - Schulhaus
  Hüslimatt – modul2-3»). Such a title gives way to the catalogue's title for the key («Wie komme
  ich herein», «Zugang & Objekt», «Photovoltaik»); a clean title («Übersicht», «Gemeindehaus –
  Übersicht») stays. A family sub-slot without an entry says its own name («Wasser»), a numbered
  sibling keeps its number («Wasser 2»), an unknown key reads «Modul N». The tablet rail's tile
  names (its accessible label) read the document's title; the panel's tiles, the expanded rail's
  words and the view label read `planLabel` (above) – the title overflows a 216px rail.
- **A head that is still being looked up is a skeleton**, never «Gebäude» or «…» in place of a
  name: a tapped building until the register answers (a searched address is named at once), a
  dropped pin until its address is known. A plain building carries no «Kein Stationsobjekt …»
  box — the kicker says «Gebäude» and the line under the name says «Kein Stationsobjekt» once
  known. Nothing more is added about what the station did not record.
- **«Register-Hinweis» is tap to open** (owner, review round 4: «should be tap to open and this
  blabla (gwr, stand, etc.) should all be hidden by default»). Under «Gebäude laut Register» the
  lines stand, and so does «Registereintrag Grenzweg 7, nicht Grenzweg 1» right under them when
  the register's building is another address's (owner: keep it visible — the lines may be about
  the other building). The hint («Aus den Bundesregistern … Vor Ort prüfen.») and the source line
  (the registers and their Stand, the device's copy) are folded behind the «Register-Hinweis»
  toggle (`aria-expanded`), folded again for every place. The Einsatz's
  Gebäude card (`BuildingCard`) wears the SAME disclosure since review round 7 — it was a `title=`
  tooltip, which a finger never sees (owner, 20.10.2026): the button, what it opens and the aria
  contract are `components/BuildingFacts` · `RegisterHintButton` / `RegisterHintBody`, each
  surface in its own rhythm – but there it stands OPEN each time the card opens (sweep 30.10.2026
  #6, building-card.md); this peacetime panel keeps it folded. Its tags and the station's notes are
  the panel's own pieces there too (`RegisterTags`, `StationNotes` – Karte Haus round 3), so the
  two cannot drift apart.
- **Missing is said – what was ASKED for and not answered.** A register that could not be asked,
  a place never looked at offline: each gets its sentence, and nothing reads as «no hazard». What
  the station simply never recorded is NOT announced: the closing «Keine Gefahrenangaben der
  Station erfasst …» line went with review round 7, for objects and for plain buildings alike
  (owner, 20.10.2026: «knowing that there could be something but it isn't filled doesn't help
  anyone in case of an emergency»). The panel simply ends with its actions. A dropped pin keeps
  its factual first sentence («Kein Stationsobjekt an diesem Punkt.») without the «Fehlende
  Angaben heissen nicht …» tail.
- **The panel remembers where it was scrolled to** (owner, 20.10.2026): leaving an Einsatzobjekt
  for a plan, an Objektbesuch or the other level and coming back puts «Objektbesuch» back under
  the thumb instead of the top of the sheet. Per place (`KartePanel · scrollKey`), the last 12,
  restored once the sections that were still loading have made the body tall enough again.
  Another object starts at the top.
- **Doors by role.** «Objektbesuch» / «Melden» only for `objectVisits.captureRoles`
  (and only where the module runs); every other account reads the visits with a one-line reason.
- **Search** finds objects on the device first — name, address, aliases, folded umlauts, every
  word of the query — ranked name before alias/address, plans before none, then distance (`lib/karte/search`). Objects without coordinates are found and marked «ungefähr»
  (their place on the map comes from geocoding the address). Addresses follow from
  `/api/geocode/search`, online only, and say so offline. **With nothing typed** the search lists
  the 30 objects nearest the map centre, nearest first, each with its distance, the hint lines
  under them (`nearestObjects`; owner, review round 11: «have more items to scroll through» — it
  was six featured Einsatzobjekte); objects without coordinates are found by typing. A row is
  glyph · name · address · distance — no plan count (owner, review round 2, 17.10.2026: «just the address is
  enough»; the sheet lists the plans; since round 3 the map tag carries no count either).
- **The address, never the kind word in its place** (review round 2). Plain objects are often
  named by their address with none stored; an object's address is the stored one, else
  its name when the name is street + number, else none (`lib/karte/places · objectAddress`). A
  name that already says it is printed once, as the title: a list row then reads «<place> ·
  <kind>» under it (`objectRowSub`), the head only the place (`objectHeadSub` — its kicker says
  the kind). An object with no address at all is described by its kind in a list.
- **Ebenen: «Alle ein» / «Alle aus» / «Standard»** (review round 2), the Einsatz's three chips
  over the viewer's own layers (`lib/karte/layerPresets`). «Standard» is the deployment's default
  set as the viewer opens with no device choice, the Basiskarte included; «Alle» / «Keine» switch
  every overlay, never the Basiskarte. The viewer's station rows (Stationsobjekte, category rows)
  are layers here: on in «Standard», switched by both chips — whatever rows the panel lists, none
  is named in the code. The aligned plan on the map is not (a plan backdrop is switched on on
  purpose, and the Einsatz's chips leave plan rasters alone too). The radar: off with «Standard»
  and «Alle aus», left by «Alle ein», no chip lit while it is on. Transparencies stay.
- **Ebenen: Grundkarte, then «Station»** (owner, review round 4: «it's the most relevant one in
  this case»; round 5: «move grundkarte above station»): under the three chips come the base-map
  tiles, then the station group — Stationsobjekte and the colour categories — above Inhalte, Wasser
  and Wetter (`LayerPanel · leadTwinGroups`). The Einsatz's Ebenen keep their order.
- **Typing on a phone** (review round 3, 17.10.2026 — round 2's keyboard handling did nothing on
  the owner's real iPhone). The bar is the menu button + a **search button** (its twin since round 4); the tablet keeps
  its field. Search and **Gefahrgut** are slide-ups with Ebenen's frame (`KarteKeySheet`): the field
  is the first line with the ✕ beside it, the results / the readout scroll under it. The search
  opens with the keyboard up (`primeKeyboard` inside the tap); a pick closes it and selects; it
  stays (at its Ebenen height) when the keyboard goes, until a pick or ✕ — a tap on the map then
  only lets the keyboard go. Gefahrgut likewise stays with its result after ✓; a tap on its tab
  with no UN number opens it with the caret in the field and the number pad up, with a number set
  it opens on the result without the keyboard (a Gefahrgut restored with the session never takes
  the caret — only a tap may raise iOS's keyboard). The map is not moved for the rings.
  - With the keyboard up the sheet keeps its height but stands **on the keyboard's top edge**,
    never taller than the room under the top bar less a 24 px strip of map
    (`lib/iosKeyboard · useKeySheet`, pure `keyboardTop` / `keySheetBox`).
  - Why round 2 failed: it trusted iOS to report its pan as `visualViewport.offsetTop` and
    counter-placed the card from that (`--vv-pan`). On the iPhone the page moved by ~the keyboard
    without that number saying so (the top bar, translated by it, never came back), and a drag on
    anything not scrolling moved it again. Now three guards that do not depend on one reading:
    the field is focused without a pan (`focusWithoutPan` / `noPanTouchEnd`, the react-aria
    technique), any pan that still happens is undone with `scrollTo(0, 0)` (rate-limited:
    `mayCorrect`), and while a field has the caret a touchmove nothing under the finger can scroll
    is cancelled (`useTypingLock`).
  - **A drag on the list closes the keyboard** (owner's pick, review round 11, after rounds 5–10
    tried to let the list scroll WITH the keyboard up — that intent is retired). Like iOS Mail's
    search: a vertical drag that starts on the sheet's list blurs the field once it has travelled
    8 px (`lib/iosKeyboard · useDragClosesKeyboard`, pure `isListDrag`); the keyboard goes, the
    sheet drops to its normal place and the list scrolls without keys. A tap on a row (less
    travel) still opens it with the keys up; a drag on the grab bar still moves and closes the
    sheet and keeps the caret; a tap on the field brings the keys back. Search and Gefahrgut alike.
    Why: the round-10 readout from the installed app showed #406 holding the window (`scrollY 0`)
    but iOS panning the VISUAL viewport under the drag (`vv … pan 72`, not undoable from script)
    and the list never scrolling (`list 0/169`); the emulation showed the page lock cancelling a
    pull at the list's top, and on iOS a cancelled first touchmove kills the native scroll for the
    whole touch. So nothing on the list is cancelled any more: the page lock leaves
    `[data-drag-closes-keys]` alone (`useTypingLock`), and the sheet's own guard
    (`overlays/useMobileScrollLock · useScrollOnlyIn`) cancels a drag only where nothing under
    the finger can scroll at all (the background guard, round 6) — a list's ends are
    `overscroll-behavior`'s. The keys-up placement (#405/#406) stays for typing.
    · Check: `e2e/karte-search-scroll.mjs`, both frames, empty search (now 30 rows), typed and
    Gefahrgut — keys up, a push up / pull down on a row: field blurred, sheet off the keys, no
    move cancelled, the sheet not pulled, bar and map unmoved; the list scrolls in the same touch
    (modelled) and in the next drag; a tap's wobble keeps the caret. Red on the base (18 in the
    app frame: every move on the list cancelled, the field kept). WebKit on Linux has no native
    touch scroll, so whether iOS keeps scrolling the list in the touch that closed the keyboard
    only the iPhone shows; either way the next drag scrolls it.
  - **Only the list scrolls** (owner, review round 4: «scrolling in the main search bar is rather
    ugly and moves everything»). The grab bar and the field line are the sheet's handle; a drag
    over the results is the list's alone — it never pulls the sheet, even at the list's top
    (`useSwipeDismiss · headOnly`), and the list neither rubber-bands nor hands its scroll on to
    the page at its ends (`overscroll-behavior: none`). The search sheet stands at its full
    height from the first frame (`KarteKeySheet · fill`), so a result list that grows or shrinks
    under the typing never moves the field. The iOS page lock above stays.
  - **Round 5** (owner, 18.10.2026: «Scrolling in the search input still messes up things and
    doesnt work (gefahrgut scroll works though)» — the whole sheet/page moves instead of the list,
    worse with the keyboard up). Three causes found, each now fixed for both sheets:
    · the search field took its caret back with Safari's own focus, which scrolls the page to the
    field — Gefahrgut's never did (`noPanTouchEnd`, now on the search field too; the caret lands at
    the end of the query);
    · the page lock judged every touchmove on its own, so a first move a pixel sideways read as
    «sideways, nothing scrolls that way» and was cancelled — on iOS that kills the list's scroll
    for the whole touch. It now shares the modal lock's one-decision-per-touch gate
    (`overlays/useMobileScrollLock · touchGate`), and a first move with no vertical part passes
    over a list with room either way;
    · when iOS panned the page anyway, the sheet's cap was measured from the layout's top, so its
    top — the field — slid up under the bar by the whole pan. `keySheetBox` takes the pan off the
    cap: the field keeps its place on the screen and the sheet's foot stays on the keys.
    Check: `node e2e/karte-search-scroll.mjs <stack>` (WebKit, iPhone 13; synthetic touches and a
    keyboard stand-in — what it models and what it cannot is in its head), Gefahrgut as the green
    reference. **On the iPhone** (rounds 5–11, removed in round 12): `/karte?debug=scroll` laid a
    live readout over the top bar — the visual viewport and iOS's pan, the sheet's and the field's
    top on the screen, the list's scroll, and per touchmove passed / cancelled / not cancelable,
    and since round 7 what moved during the last touch (`KarteScrollDebug`).
  - **Round 6** (owner, 18.10.2026, `?debug=scroll`: «when i typed it works, without typing it
    fails (empty state)»). With nothing typed the body holds the six featured Einsatzobjekte and
    the two hint lines — SHORTER than the full-height sheet once the keyboard is down, so the list
    has nothing to scroll, and `overscroll-behavior` only holds on a box that overflows: iOS
    handed the drag on to the page and the whole sheet moved. The page lock could not catch it
    (it guards only while a field has the caret). Now the sheet itself cancels a touchmove over
    its body that nothing under the finger can take, keyboard or not (`KarteKeySheet` →
    `overlays/useMobileScrollLock · useScrollOnlyIn`, the same per-touch gate): a list that cannot scroll moves nothing,
    one that can still scrolls and stops at its ends (since round 11 by `overscroll-behavior` alone:
    a direction cancel at an end killed the touch's scroll). Gefahrgut's sheet with a short readout had
    the same hole and has the same fix. The check models the hand-off (a first move not cancelled
    over a list with nothing to scroll = the page moved) and runs the empty search with and
    without the keyboard.
  - **Round 7** (owner, 18.10.2026, screen recording: empty search, keyboard up, a finger on a row
    pulls down — the whole sheet slides down with it while the top bar holds). The rule is the
    owner's pick: a drag on the list never moves the sheet; the list scrolls if it can, otherwise
    nothing happens; only the grab bar (or the ✕) moves or closes the sheet. That is what the code
    already does (`useSwipeDismiss · headOnly`, and a row is a button, which never starts the
    pull), and the check now proves it with the sheet's own POINTER gesture in the loop: the
    owner's pull (list at its top, down–up–down in one touch, also with a first move a pixel
    sideways) leaves the sheet's top unchanged during and after, empty and typed, keyboard up and
    down, Gefahrgut the same, while the same pull on the grab bar moves the sheet and a long one
    closes it. With the pull re-enabled on the body the check goes red. In the video the map moves
    too and a scroll indicator shows at the right edge, so the mover is native
    (iOS), which WebKit on Linux cannot run: `?debug=scroll` now also records, per touch and for a
    second after the lift, what moved (top bar, sheet, map, iOS's pan, `scrollY`), every element
    that scrolled, the sheet's own pull, `data-kb` flips and the `--ks-bottom` range — one
    screenshot after the drag names the mover.
  - **Round 8** (owner, 18.10.2026 evening: «in the browser the search scroll works now but in the
    pwa it still fails» — the installed home-screen app on build 131a42a, as in the round-7 video).
    The installed app has no address bar, so `?debug=scroll` could never be switched on there.
    **Five quick taps on the build line** at the foot of the app menu (`v… · <sha> · <date>`)
    switched the readout on and off on that device (`lib/scrollDebug`, localStorage, a toast
    «Diagnose an / aus»; all removed in round 12); `?debug=scroll` / `?debug=off` set the same flag.
    The readout's first line named the frame: `app` (standalone) or `tab`, innerWidth×innerHeight,
    the document's client/scroll height and scrollTop, the screen height and the safe-area insets
    top/bottom; the «Δ» line added how innerHeight and the visual viewport's height changed during
    the touch.
    What WebKit proved: `e2e/karte-search-scroll.mjs` now runs every check in two frames — the
    browser tab and the installed app emulated as closely as WebKit on Linux allows
    (`display-mode: standalone` and `navigator.standalone` true, the web view below the opaque
    status bar at 393×793 with safe area 0/34 written in for `env()`, the recording's 362 px
    keyboard). All green in both: the app runs the same code in both frames (nothing on the
    Karte's search path asks `isStandalone`), the sheet stands where the owner's video has it
    before the drag (top 92, foot on the keys at 431), and neither the document, body nor
    `#root` has room to scroll. So the mover in the installed app is iOS's own (the video's long
    scroll indicator at the right edge is a document-sized scroller), which only the readout on
    the owner's phone can name.
  - **Round 9** (owner's capture with the readout in the installed app, 18.10.2026 19:08). It named
    the mover: with the keyboard up, the first touch makes iOS **collapse `innerHeight` to the
    visual viewport** (793 → 424) and **scroll the window** by the rest (`scrollY` and the visual
    viewport's `offsetTop` 369), while the document and the frame `position: fixed` is laid out in
    stay 793 tall (`doc 793/793`). `keyboardTop` measured the keyboard from the live
    `innerHeight` — now 424 − (369 + 424) → «no keyboard» — so the sheet dropped its keyboard
    placement and stood for a 793-px screen in a window scrolled by 369: its field above the
    screen. (The readout printed −516 for the sheet; the frames show it at −147 — in the collapse
    iOS's rects already include the scroll, so «less the pan» counted it twice. The readout now
    also prints the raw rect.) Safari tabs never shrink `innerHeight`.
    · The keyboard placement measures from the app's **full height** (`lib/iosKeyboard ·
    fullViewHeight`: the larger of `innerHeight` and `documentElement.clientHeight`, which stayed
    793 throughout the capture — stateless, follows a rotation; not the screen less the safe area:
    852 − 0 ≠ 793 under the opaque status bar). A keyboard is up when the visual viewport is
    clearly shorter than that, and its top edge is the visual viewport's bottom — also when the
    pan has swallowed the whole keyboard (369 + 424 = 793: the sheet stands at `bottom: 0` and its
    cap less the pan keeps its top at 92 on the screen, where it stood before the touch).
    · The page lock also looks again a beat after a touch with the caret up (`useTypingLock`): the
    collapse scrolls the window during the touch faster than the rate-limited `scrollTo(0, 0)` may
    answer and then fires nothing. The placement no longer depends on that undo — the sheet is
    right with the window scrolled and after iOS honours the `scrollTo`. The document is not bound
    to the live height: that would touch every surface of the app, and the placement suffices.
    · The readout's first line carries the reference (`ref 793`).
    · Check: `e2e/karte-search-scroll.mjs`'s app frame models the collapse (innerHeight and
    scrollY report it, the layout stays 793) with the capture's numbers, both with the scroll kept
    and after a `scrollTo(0, 0)`, plus the owner's pull on a row in that state; red on the base
    (placement off, sheet top −147, field −123), green now. What only the iPhone proves: that iOS
    keeps the fixed frame at 793 while the sheet is placed (the capture shows it did with the
    placement off). `useKeyboardInset` (the root's `data-kb`, `--vv-foot`, the Einsatz's sheets)
    read the live `innerHeight` the same way — since 18.10. it measures from `fullViewHeight` too
    (docs/ui-conventions.md, `e2e/einsatz-keyboard.mjs`).
  - **Round 10** (owner, installed app, 18.10.2026 20:28: «still doesn't work reliably. sometimes
    it does»). The readout showed round 9's placement holding (`ref 793`, sheet on the keys after
    the touch), but DURING the touch iOS collapses `innerHeight` in **steps** (793 → 756 → 711 →
    690 → 666 … and back) and scrolls the window by exactly each step (`scrollY = 793 −
    innerHeight`: 82, 8 …); the document stays 793 tall, so there is always room. The undo came a
    frame late (`requestAnimationFrame`) and was rate-limited to six a second (`mayCorrect`):
    every step painted the app ridden up for a frame, the sheet re-placed for a pan that the undo
    had already taken back, and after six steps nothing undid it for the rest of the touch
    («sometimes it does»). The readout's «Δ» counts the scroll twice (rects already include it,
    round 9): the frames show the bar and the sheet off by up to ~10 px, the uncompensated map
    behind them by the whole scroll.
    · `useTypingLock` undoes a pan **in the scroll / resize event itself**, and a scroll that is
    exactly the collapse (`isCollapseScroll`: `innerHeight` below the full height, the scroll no
    larger than the shrink) is undone every time — only other pans keep `mayCorrect`.
    · While the lock is on (the Karte on a phone), the root is as tall as the **live** window:
    `html[data-typing-lock] { height: var(--live-h); overflow: hidden }` (02-base.css), `--live-h`
    = `innerHeight` written in the same event. `position: fixed` and the placement are unaffected
    (`documentElement.clientHeight` stays the full 793). Whether iOS bounds its scroll by the
    root's box or by the initial containing block (which no CSS shrinks) only the phone can say,
    so both guards stay.
    · The readout's first line adds the root's computed height and its scrollTop (`html 711 top 0`).
    · Check: the app frame runs the collapse in the capture's steps during a finger on a row and
    reads the bar, sheet, field and map on the screen one frame after each step, with iOS's scroll
    bounded by the root's box (`html`) and by the 793-px frame (`icb`): red on the base (37–127 px),
    green now; each guard alone turns its own variant green (the live height `html`, the
    same-event undo both).
  - **Round 12** (owner, installed app, 18.10.2026 21:30 — the last round before main; scrolling
    works). Three closing touches, search and Gefahrgut alike:
    · «fix the bottom margin»: the list stopped a safe-area band (34 px) above the sheet's foot,
    cut by a hard line — Ebenen's card keeps the home indicator's inset as its own padding. The
    key sheets drop it and carry the inset as the list's end padding instead, inside the scroll
    (`Karte.module.css · .keySheet .keyBody`, 12 px + the inset; 12 px on the keys): the list runs
    to the sheet's bottom edge and its last line scrolls clear of the home indicator.
    · «a small animation when starting to scroll»: when the keys go (the drag that closes them,
    round 11) or come (a tap on the field), the sheet glides between its two places in 0.22 s on
    the app's `--ease` instead of jumping — `bottom`, `height`, `max-height` and the corners, on the
    sheet itself, so the list inside keeps scrolling under the finger. Only that switch animates
    (`lib/iosKeyboard · useKeySheet` writes `data-ks-move` for `KS_MOVE_MS` after `data-kb` comes or
    goes); a re-placement on the keys (iOS's pan, the collapse) stays instant. Reduced motion: no glide.
    · The scroll readout is gone (`KarteScrollDebug`, `lib/scrollDebug`, `?debug=scroll`, the five
    taps on the build line, the localStorage flag and its «Diagnose an / aus» toast).
    `e2e/karte-search-scroll.mjs` stays the regression check and now also checks the foot (the
    list to the sheet's edge, its end clear of the home indicator — red on the base) and the
    glide (the sheet's transitions held halfway: its top between its two places, both ways).
  - No «AutoFill Contact»: both fields come from one helper (`lib/typingField`) — a `search-…`
    name (Safari offers no contact AutoFill on a search), autocomplete / autocorrect /
    autocapitalise / spell check off, `enterKeyHint`, numeric for the UN field, and their label /
    placeholder words broken by an invisible word joiner (`defuseAutofill`) so Safari's keyword
    guess («Adresse», «Nr.») finds nothing. Messen, Ebenen and the Einsätze menu have no text field.
  - What is proven where: the shots run Playwright **WebKit** (iPhone 13 descriptor) with an iOS
    stand-in that shrinks the visual viewport, moves the page on focus (both as a window scroll
    and as an `offsetTop` pan) and moves it again under an uncancelled drag; the round-2 code
    reproduces the owner's screenshots there. The real keyboard, Safari's focus scroll and its
    AutoFill heuristics are only proven on the iPhone.
- **One card explains the map** (owner, review round 7: «the info tooltip at the bottom has
  different padding and coloration from the info button that you get when measuring»). «Auf die
  Karte tippen, um einen Punkt zu setzen.» and the Messen dock's ⓘ are the SAME surface now, not
  two look-alikes a hand's width apart: `DockInfo · MapHelpCard`, the message surface at the foot
  of the map (on a phone in the message lane). `MeasurePanel · MapHint` renders it with
  `role="status"` — an instruction that appeared because a tool was armed — and the ⓘ with
  `role="tooltip"`. Hints use the width they need (review round 2): max-content up to 440 px, the
  bars' width on a phone.
- **A measure readout steps off the line, not off the node** (owner, review round 7: «when
  measuring and setting a lot of nodes close together, the distances between the nodes can be
  clipped by the nodes themselves»). Each «18 m» stands perpendicular to the segment it ends,
  always on that segment's left in SCREEN space, so a row of close nodes gets a readable column of
  numbers beside the path (`lib/measureLabelPlace`, unit-tested; the map's bearing turns the
  geographic direction into the screen one, so the chips keep their side while the map rotates).
  The chip is anchored by the edge that faces its node, so its own width runs away from the path —
  a segment shorter than the label cannot push it over the neighbouring node either. The area
  mode's single centroid label has no segment and keeps its place above the point.
- **The bar's and the sheets' controls are the app's** (owner, review round 4: «the search icon
  being round, the (x) size …»): the phone's search button is the menu button's twin (44 px, the
  one corner, its frame) with the bar's 16 px glyph; every ✕ of the viewer — object sheet, search,
  Gefahrgut, Ebenen, phone and tablet — is the global `.ip-x` (36 px, 18 px glyph), 12 px in from
  the sheet's edge — except beside a field: the search's and Gefahrgut's ✕ is the field's height
  (44 px, owner's pick B: «field and ✕ in one row»); the phone's ⊙ / compass buttons wear the floating family's row height and edge.
- **Gefahrgut names the substance** (owner, round 4: «we also need to know the name (show it as
  attribute)»): the readout's first row is «Stoff» — the word of the Gefahrentafel's own field —
  with the ADR Table A name (`lib/unHazard · substanceName`: the curated English name on an English
  UI, else the German; Table A has no French or Italian names). The table holds one row per UN
  number. The Gefahrentafel's readout does not repeat it: its «Stoff» field already shows it.
- **Visits hand over** to the existing capture: `/besuche/neu?object=<id>&from=karte` for an
  object, `/besuche/neu?lat=&lng=&label=[&address=]&from=karte` for a building or a pin (contract
  C1, label «bei <Adresse>» within 60 m of a pin, else «Gesetzter Punkt»). **«Melden»** (something
  is wrong or missing here: hydrant, access, key box, plan …) is the same hand-over with
  `&checkliste=fehlermeldung` (`lib/karte/places · REPORT_CHECKLIST`): the new-visit screen takes
  the station's «Fehlermeldung» checklist when the catalogue has it — station data
  (kp-front-data), never bundled — and falls back to its chooser when not; a reload resumes an
  open Fehlermeldung draft, never an unrelated draft at the same object
  (`objectVisits/store · findOpenDraft`). An existing visit opens
  at `/besuche/<id>?from=karte`. The viewer stays «entered» while that visit is open, and a visit
  opened from it has no Übersicht behind it: its «Zurück» (to its work list or the Übersicht)
  lands on the viewer's own address again — read views and reports included (`App` · `ovReturn`).
- **Alarms** reach the viewer through the Meldeleiste and the same two banners as the
  Objektbesuche; nothing switches by itself. A running Einsatz is the red chip in the bar (a strip
  under it on a phone); a tap opens it.
- **«Update verfügbar»** (review round 7, owner: no word of a new version on the new home): the
  viewer mounts the Einsatz's own `UpdateBanner`, so a waiting build is the same calm row in the
  same strip — «Jetzt aktualisieren» everywhere but iOS, «App schliessen & neu öffnen» there,
  dismissible, back for the next deploy — and the one-shot «Aktualisiert – v…» toast follows an
  update reload that lands here. A covered Einsatz behind the viewer paints no update row of its
  own, and `consumeJustUpdated` is one-shot app-wide, so neither is ever said twice.

## Checkliste (owner, 19.10.2026)

Beside the map the viewer has a second surface, **«Checkliste»**: the station's checklists and
device Anleitungen to read in peace time — the Einsatz tab's word and glyph
(`appConfig.copy.modes.checklists`, `checklist`), because the same content lives there.

- **Who owns what.** The Karte (`KarteApp`) hosts `<ChecklistLibrary query={…} />` and nothing
  more: it gives it the frame and the bar's search words. Everything inside — the lists, the device
  pages, the reader, the selection (kept per tab) — is the library's (`components/ChecklistLibrary`).
  Read-only: nothing is ticked or stored.
- **The frame** is the Einsatz surfaces' own (`Surface.module.css · .shell`, composed by
  `Karte.module.css · .library`): under the bar, beside the tablet rail, above the phone bar, pushed
  down by the Meldeleiste (`--ml-push`) and ending on the keyboard (`--vv-foot`). On a phone with an
  Einsatz running it starts under the red strip. The library fills it and never positions itself.
  The map stays mounted behind the app's wash, so the way back finds it where it was.
- **Phone bar** (variant A, fixed): `Karte · Checkliste │ Messen · Gefahrgut · Ebenen` — the two
  surfaces, a hairline, the map's tools. The bar never changes: a tool tapped on the Checkliste
  goes back to the Karte with that tool armed. On the Checkliste the bar holds «Menü ▾» and an
  inline field («Anleitung, Checkliste, Stichwort»); the round search button, the pin and the
  compass are the map's.
- **Tablet rail**: always there with Karte and Checkliste; a selected object's plans hang under a
  hairline as before. It is the Einsatz's NavRail in behaviour (owner, review round 5: «we can't
  expand the left toolbar so people might not know what it actually is»): the «Ausklappen» chevron
  on top and the grip widen it to 216px with the words beside the glyphs, open per mount like the
  Einsatz's. «Beschriftung» (Einstellungen) puts the word under each glyph, as on every other bar
  of the viewer and the Einsatz (owner, 07.11.2026 – the view bar's words beside unlabelled
  rails read as a fault) – and ⚠️ unlike the Einsatz's NavRail the chevron and grip STAY with the
  words on (`.rail-keeps-exp`; losing them was the regression fixed on 20.10.2026), so `labels` is
  not handed to `useRail`, which collapses a labelled rail. The right `ToolRail`, its view bar,
  the plan reader's rail and the phone bar read the same preference. It publishes `--rail-w` through
  `lib/useRail`, which the object panel, the plan reader, the floor list and this surface sit beside. On the Checkliste the right `ToolRail` is gone (as on a plan) and the bar's
  field searches the library; the map's own search words are kept for the way back.
- **Remembered** like the plan: `KarteView.surface = 'checkliste'` (`lib/karte/session`), back
  after an Objektbesuch, an Einsatz or a reload — unless a deep link (`?objekt=`) asks for another
  object, which opens on the map. The Einsatz menu's row then reads «… zurück zu Checkliste» and the
  way back «Wieder bei Checkliste».
- Opening it closes the map's tools and lists (the Karte tab's rule); the selected object stays.
- **The home**: Geräte (photo cards on a phone), the checklists «zum Lesen», then each reference
  template's Stichworte as a group of its own (Taktik · Stichworte, Grundlagen · Infos) — on a
  phone too, nothing folded (owner, review round 2: «keep things top level and just requiring
  some more scrolling»). A Stichwort's back row goes to the list (or to the search it came from).
- **One list for both places** (owner, round 3, 20.10.2026: «the landing is the reference»). The
  Einsatz Checkliste rail draws the same groups and rows (`components/ChecklistRail` on the shared
  `ListRow` / `ListGroup`): white cards with 56px rows and device photo cards on a phone, compact
  rows on the column's ground beside a document. The Einsatz keeps its order (Aufgaben first,
  Anleitungen last) and its ticks (a list's «40%» at its row's end).
- **An Anleitung's ways** (owner pick, round 3): ONE back row on top naming the level («‹ TLF»,
  `BackRow`), nothing else up there; at the foot one row of two equal buttons «‹ 2 Kabine» |
  «4 Saugbetrieb ›». The step text is the Taktik reader's 14px.
- **The native back steps up one level** (owner, review round 6, 20.10.2026: «swipe from the left
  to go back one section … if there's a native thing we can use»). Every level deeper is one
  counted history entry (`lib/historyTrail` over `objectVisits/route · pushAppEntry`): on a phone
  the list → a page (a device, an Anleitung, a checklist, a Stichwort) → a device's chapter; beside
  the list column a device → its chapter. So iOS's edge swipe in the installed app (offered exactly
  when there is an entry to go back to), Android's back gesture and the browser's ‹ pop one level,
  and the back row is the same step (a walk back, not a second way). A chapter's «‹ 2 Kabine» |
  «4 Saugbetrieb ›» replaces its level – no entry per neighbour. No gesture code of our own. Leaving
  the surface (the Karte, a plan, another Einsatz tab, «Einsatz verlassen») walks its entries back
  first, so the 05.10. rule holds: nothing behind the operational screens. A page that comes back
  (Karte ↔ Checkliste, a reload) gets its levels pushed again. The same in the Einsatz Checkliste.
  Known limit: a picture opened in the viewer has no entry, so a back swipe under it steps the
  page beneath.
- **The reading pane** (owner pick A, review round 5, 20.10.2026: «the entire point of the card is
  to show the content»): beside the list column the pane IS the surface – the list's white, a
  hairline between them, no white card inset on grey. Every reader in it (Anleitung, device page
  with its picture as a wide header, Stichwort, checklist) is ONE centred column of 760px;
  pictures at most 600px wide and 60% of the screen tall, at their own proportions
  (`Checklists.module.css · .cl-main`). The same in the Einsatz Checkliste (one set of
  components). The Stichwort's 2-column flow above 980px is gone with it. Phone and the ≤760px
  one-page layout: unchanged, the content on the page ground.
- **The device pictures paint at once** on every open after the first (review round 2: they popped
  in each time). Two parts: the asset URL carries its version (`?v=`, `lib/checklists ·
  checklistAssetUrl`), answered immutable and cache-first by the service worker, so nothing asks
  the server again; and the cards and the device page show a held `blob:` copy
  (`lib/heldPictures`), because with a worker WebKit hands every new `<img>` to it and paints the
  picture after the first frame. Check: `e2e/checkliste-pictures.mjs --sw` against a built app.

## Object colours (`map.objectCategories`)

Owner, 17.10.2026: colour the objects so that objects with plans, water plans, PV systems … are
told apart. The station sets ordered rules in the deployment config (Verwaltung › Station &
Karte › «Objektfarben», schema `ObjectCategoryConfig`), FIRST match wins:
`{ id, label: "…" | { de, fr, it, en }, color: "#rrggbb" | "ink", match: { kinds?: [einsatzobjekt|objekt], modules?: [glob…] } }`.
A rule matches when every condition it names holds (none named = catch-all); `modules` globs
match the object's plan modules (`modul5-pv*` = `modul5-pv`, `-pv15`, `-pv20`). An object no rule
takes keeps the default look: ink (`--obj-plans`, owner's pick 7A, 23.10.2026), grey without
plans. No rules = that default map.

- **`"ink"` (admin: «Tinte»)** is a colour like a hex (owner, 25.10.2026): the category draws
  exactly like the default – dot, tag rim and outline in `--obj-plans`, near-black by day,
  near-white at night, repainted on the flip – but keeps its own Ebenen row and on/off switch
  (its glyph in ink). Parsed as `color: null` (`lib/karte/categories`), so every reader falls back
  to the ink it uses for an object without a category. FWO's «Einsatzpläne» uses it.

- **Order = precedence.** FWO's order (owner, review round 5, 18.10.2026: «emergency plans have
  precedence over PV or water (ie red first then blue then yellow)»): Einsatzpläne – red until
  7A, `"ink"` since 25.10.2026 – (`modul1*`, `modul2*`, `modul3*`, `modul4*`, `modul6*`) → Wasser
  blue (`modul5-wasser*`) → Photovoltaik amber (`modul5-pv*`) → ohne Pläne grey
  (`kinds: [einsatzobjekt, objekt]`). An object with an Einsatzplan AND a PV or water module is
  ink. Do not use `modul*` for the Einsatzpläne rule: it also matches the `modul5-*` modules and
  would take every PV/water object.

- ⚠️ `kinds: ["depot"]` is **retired** (review round 3): the schema still accepts it, so an
  existing config stays valid, and it matches NO object — a rule naming only `depot` paints
  nothing (it must never turn into a catch-all); beside other kinds it is ignored. The admin
  card no longer offers it.
- The proposal for a station (staging, review rounds 2–3): «Mit Plänen» red `#dc2626`
  `{ kinds: [einsatzobjekt] }`, then «Ohne Pläne» grey `#64748b` `{ kinds: [objekt] }`, with the
  module rules (PV, Wasser) above them. A «Schlüsseldepots» rule has nothing left to colour —
  drop it.
- The map draws the object's dot, tag rim and outline (normal and selected) in the category's
  colour (`lib/karte/categories`).
- **Ebenen** has one row per rule under «Station» (glyph in the colour, «n Objekte»): off takes
  that category's objects off the map — outline, dot, tag and tap; the selected object stays. A
  device preference like the objects row (not kept across reloads).
- Pick colours that stay apart for the colour-blind (no red against green) and that read on the
  light, dark and aerial base maps.

## «Unterirdische Bauten» (owner, review round 4)

«can we show all subterraneous objects through our firegis database?» — FireGIS's
`av_gebunterird` is the official survey's underground buildings; the same features are in the
open AV WFS (geodienste.ch, Einzelobjekte `ms:SOSF`), so no FireGIS file is needed and every
deployment gets it. Drawn: `Art = unterirdisches_Gebaeude` and (owner on #383) the underground
traffic structures `Tunnel_Unterfuehrung_Galerie` — the survey has no other such type, and none
as lines. Not `Unterstand`.

- **Ebenen row** «Unterirdische Bauten» under «Station», **ON by default and part of «Standard»**
  (owner, review round 5, 18.10.2026: «activate underground by default and also show it on the
  normal map»; round 4 had it off); «Alle ein» / «Alle aus» switch it like any row. Not kept across
  reloads, like the other Station rows: switched off it stays off for the visit, a reload shows it
  again.
- **The Einsatz map too** (round 5): the same layer as an Einsatz Ebenen row (`lib/underground` ·
  `undergroundLayerDef`, id `unterirdisch`), a real `LayerDef` after the deployment's reference
  layers, in its own group named like the Karte's («Station»), shown right under the plans
  («Pläne», owner, review round 6: «move unterirdische bauten below pläne in the emergency
  version»; `LayerPanel · groupsAfterTwins`). ON by default and part of the
  Einsatz «Standard»; switched like any Einsatz layer (device prefs per Einsatz, «Alle ein / aus»,
  the replay's `layer.toggle`). An Einsatz opened before round 5 gets it on too (a layer the device
  prefs do not name keeps its default). Drawn first of the map's overlays, so under the ERG rings,
  the drawings and every Lage symbol; not tappable. Never from an incident link (alarm, view,
  Atemschutz, terminal): the route refuses those sessions, so the row is not offered there and
  nothing is asked. «Karte & Objekte» keeps its own row (with the count and the loading state)
  and leaves the catalogue's out (`lib/karte/session · viewerLayers`).
- **Not on the Tafel's «Lagekarte» box nor the Rapport's Kroki**: both draw the Lage, not reference
  data (the box passes no prepared overlays — no ERG rings either; the print renders base map +
  Lage only).
- **On the map:** every underground structure of the Einsatzgebiet as a dashed outline in the neutral
  ink (`--ink-dim`, never an object's red or a category colour), no fill, from z16 (street zoom),
  under the objects — an object's own dashed garage keeps its colour on top. Not tappable: a tap
  goes to whatever is above or under it, as before.
- **The area is the Einsatzgebiet** (owner on #383, not the geocoder's 27 × 18 km box): the
  municipalities of `map.serviceArea.municipalities` (BFS numbers), else the one the map centre
  (`map.defaultView`) lies in, as swisstopo's official boundaries (swissBOUNDARIES3D over the
  geocoder's host) — united with 500 m around every station object, so an object in the next
  village (ARA Birsig in Therwil) keeps its surroundings. A structure counts when any corner lies
  in that area.
- **Data:** `app/underground` asks the WFS for the municipalities' box and each outside object's
  surroundings in 3 km cells (a full cell is split), keeps each structure once, and stores ONE
  compact GeoJSON MultiPolygon (`reference/underground.json`). It rides the footprint job
  (`scheduler` · `_object_footprints_tick`): asked once, then weekly or when the area (a
  municipality, the map centre, an object's point) or the source changes; a failed ask keeps the
  stored set and waits an hour. FWO (Oberwil 2771 + the objects' surroundings, 18.10.2026): 1 058
  structures (392 of them outside Oberwil, 99 around the ARA), 243 KB, 58 KB gzipped, 3 s. No
  device ever asks the WFS.
- **`GET /api/reference/underground[?have=<fetchedAt>]`** (same readers as the catalogue):
  `{enabled, fetchedAt, count, geometry}`; `enabled: false` when off, `fetchedAt: null` before the
  first ask, `unchanged: true` without geometry when the device already holds that set. The
  device keeps it in IndexedDB (`lib/api/stationReference` · `loadUnderground`), asks the first
  time the row is on per visit (`lib/underground` · `useUnderground`, the Karte and the Einsatz
  alike), and draws its copy offline; the service worker leaves the route alone (`NetworkOnly`,
  vite.config). A refusal (401/403) never shows the copy.
- **Off:** `UNDERGROUND_WFS=` (empty).

## Die Häuser (Karte Haus round 1)

A tap on a plain building used the OSM outline under the finger, and OSM maps Storchenweg 2/4/6 as
ONE polygon; the official survey has one footprint per house (Bodenbedeckung `ms:LCSF`,
`Art = Gebaeude` — what object footprints are made of). `app/houses` is `app/underground`'s pattern
for that layer:

- **Area, cadence, failure** exactly as «Unterirdische Bauten» (it reuses `underground ·
  station_area / resolve / fetch`): the Einsatzgebiet ∪ 500 m around every object, asked by the
  footprint job once, then weekly or when the area or source changes; a failed ask keeps the stored
  set and waits an hour. ONE request at a time, in 1 km cells (a dense quarter has ~1 700 houses
  per km²): geodienste.ch answers a burst of parallel asks with 502s. Every house kept once.
- **Stored** as one GeoJSON MultiPolygon in `reference/houses.json`, no properties (the register
  is asked at the tap's point, as before). FWO (Oberwil 2771 + 160 objects' surroundings,
  19.10.2026): 6 657 houses, 1.46 MB, 319 KB gzipped, 9 s.
- **`GET /api/reference/houses[?have=<fetchedAt>]`** answers like `/underground`. The Karte asks it
  once per page load (`lib/karte/outlines · useHouses`, `lib/api/stationReference · loadHouses`),
  keeps it in IndexedDB for offline and indexes it by the OSM cell grid (a house under every cell
  its box touches).
- **A tap** matches the cell's houses first and OSM only when no house contains the point
  (`ringsAround`): never both, so OSM's block cannot win over the house in it. Objects keep their
  own buildings (above); an object without any still falls back to the OSM outline at its point.
- **OSM over a house is dropped** (Karte Haus round 4, 20.10.2026 — owner: «two outlines …
  hoverable/clickable», Bottmingerstrasse 44, 55 / Talstrasse 1). OSM traces roofs, the survey
  walls, so most OSM outlines stick out of a house by a band, or cover two; the band opened the OSM
  outline. `osmBeside` drops every OSM outline the houses cover by ≥ 10 %, or that covers ≥ 50 % of
  one house, once per cell (sampled overlap; the cell's list is cached per house set). A sliver
  along a shared wall does not count. Of the ~8 900 OSM outlines in the station's snapshot ~4 600
  go; the ones left touch no house (sheds, carports, outside the Einsatzgebiet). Densest cell
  ~20 ms on a desktop.
  The Einsatz's Umriss picker keeps OSM (`/api/overpass/buildings`).
- **Off:** `HOUSES_WFS=` (empty) — taps use OSM outlines again.

## Offline

The viewer never downloads anything on its own for offline use; it READS what the device already
holds and says so (`src/lib/karte/availability.ts` decides, `components/karte/useKarteOffline.ts`
and `KarteDevice.tsx` probe). No «ganze Station herunterladen»: that would be several GB (owner,
16.10.2026); deliberate downloads of chosen objects or areas come later.

| What | Where it is kept | Filled by |
|---|---|---|
| object catalogue | IndexedDB `kp-front-station-objects` (one entry) | every online open of `/karte` |
| register facts of a building | IndexedDB `kp-front-station-building:<where>`, the last 300 kept (index `kp-front-station-building-index`) | every building / object looked at online |
| plan PDF | the service worker's `reference-plans` cache, per revision URL | opening an untiled plan once online |
| plan tiles | `plan-tile-manifests` (the manifest) + `plan-tiles` (every tile), per revision | opening a tiled plan once online (the reader fetches the whole pyramid, `lib/planTilePrefetch`) |
| Gebäude storeys, aligned plan | the plan's pages (PDF or tiles) + the revision's alignment metadata (IndexedDB, `lib/api/reference`) | opening Gebäude / the aligned plan once online |
| base map | the service worker's `map-tiles` cache | looking at the area, or an Einsatz's Offline-Vorbereitung |
| Unterirdische Bauten | IndexedDB `kp-front-station-underground` (one entry, ~250 KB for FWO) | opening the Karte or an Einsatz once online with the row on (the default) |
| the houses a building tap selects | IndexedDB `kp-front-station-houses` (one entry, ~1.5 MB for FWO) | opening the Karte once online |
| Gefahrgut (UN/ADR) | bundled with the app | — |

What the surface shows offline:

- **«Auf diesem Gerät» opens with «Alarm auf diesem Gerät»** (3am sweep §1, 23.10.2026): the four
  readiness rows (installed · Benachrichtigung · Alarm-Abo · Anmeldung) with their one-tap fixes,
  the Testalarm and the opt-out – the same as under Einstellungen › Gerät. Since 28.10.2026 (owner's
  pick 17A) they fold into ONE line with no heading: «✓ Alarm bereit · Getestet am …» with the
  Testalarm on it and a ⌄ that opens the green rows and the opt-out; a row that is amber
  («Alarm bereit · 1 Hinweis …») or red («Kein Alarm auf diesem Gerät») always stands open under it
  (`karte/AlarmReadiness`, rules in `lib/alarmReadiness`; the push side in
  [`divera-connector.md`](divera-connector.md)). The home's nudge card (`AlarmNudgeCard`, under the
  bar) shows only when a row is red or nothing was checked for 90 days, never while an Einsatz runs,
  never under the menu or the search; «Später» hides it 30 days, «Keine Alarme auf diesem Gerät»
  for good. Green = no card, not a line.
- **The bar's «Offline» chip** (a dot only on the phone) stands where the weather was and opens
  **«Auf diesem Gerät»**: Objektkatalog · Karte (this view) · Pläne (PDFs of the whole catalogue) ·
  Gebäuderegister · Gefahrgut · Adresssuche · Wetter/Fahrzeuge · Gerätespeicher (Pläne counts the
  plans that open here, by the rule above), each with ● on
  this device / ◐ partly / ○ only online AND the same in words. The Gebäuderegister is never ●: only
  buildings already looked at are stored.
- **A plan is held when the reader that will open it has what it needs** (`availability ·
  planLamp`): ● its PDF, or every tile of its pyramid; ◐ no PDF but the underlay tiles of every
  page — the whole sheet opens, a deeper zoom says «Schärfere Ansicht nur mit Netz»; ○ neither.
  ⚠️ A TILED plan opened online fetches its tiles and never its PDF (review round 3: the Karte said
  «PDF nicht gespeichert» offline for a plan its tiles open perfectly), so the PDF alone is never
  the rule, and no PDF is downloaded to make a lamp green. The probe reads the manifest from
  `plan-tile-manifests` and the tile cache's keys ONCE (`openPlanTilesProbe`), never one lookup per
  tile; `tilesHeld` decides.
- **The plan tiles** carry ●/◐/○ after the words; a plan the device does not hold is dimmed
  (its label says «Nicht auf diesem Gerät gespeichert»), but stays tappable – the surface then says
  the plan is not stored instead of a reader spinning on a dead fetch. The tablet rail dims the
  same tiles. Gebäude is ● only when every revision's alignment metadata is stored and every
  storey's pages are fully (PDF or every tile), ◐ when some storeys are, or only as underlay (the
  stack then says some are missing). «Objektplan auf der Karte» is offered offline
  only when the aligned plan's PDF and metadata are both stored.
- **The base map:** where the device holds neither a tile nor a parent MapLibre could scale up (4
  levels), the viewer HATCHES the tile (a `polygons` overlay with `hatch`, the Schraffur pattern),
  so a blank area reads as «no map stored» and objects stay on top. Probed only while offline or
  while «Auf diesem Gerät» is open, 300 ms after the map settles, at most 96 tiles a view. The
  first base tile that fails offline also raises the Einsatz's «Keine Basiskarte» Meldung
  (`NoBasemapMeldung`, here with its action «Verfügbarkeit»), once per visit, withdrawn when the
  link is back.
- **A base map in two looks is a stale cache, not two maps** (the «seam», review 17.10.2026). The
  `map-tiles` cache is cache-first for 30 days under the tile's URL; when a provider re-renders
  under the same URL (CARTO's GL-rendered Dark Matter, autumn 2026: buildings now LIGHTER than the
  ground, blue-grey roads), a device shows old tiles where it holds them and new ones elsewhere,
  with a sharp edge at the tile border. `lib/tilePurge` names each such change and deletes its
  tiles once per device, on the first boot ONLINE (offline the old look beats no map); a miss is
  fetched past the HTTP cache (`fetchOptions: { cache: 'no-cache' }`, vite.config) so CARTO's
  `immutable` answer cannot bring the old tile straight back. A provider changes its look again →
  add a purge entry.
- **A sharp base map on a retina screen** (owner, review round 4: «check why the map is so
  blurry»). The base rasters are 256 px tiles on MapLibre's 512 px zoom grid (`MapLayers` ·
  `tileSize={256}`), so each tile covers 256 CSS px: on a 3× iPhone every source pixel was blown up
  three times. A screen with `devicePixelRatio > 1` now asks CARTO for its `@2x` tile (512 px, the
  same area and label size; `lib/carto` · `withCartoRetina`): 1.5× on a phone, 1:1 on an iPad. It is
  decided where the layer list is derived (`workspace` · `builtinAndConfigLayers`), so the map,
  the Einsatz's offline download, the coverage probe and the readiness sheet all name the same
  tile — this is the Einsatz's map too. The Rapport's compositor gets the 1× template
  (`krokiPayload`, it lays 256 px). A 2× tile costs ~3× the bytes: the Offline-Vorbereitung's
  pre-flight prices it so (`storageBudget` · `tileBytesFor`). The 1× CARTO tiles a retina device
  held are dropped once (`tilePurge` · `carto-retina-2026-10`); a 1× screen keeps them. OSM and
  swisstopo have no 2× tiles; swisstopo's swissimage goes to z20 (was capped at 19, so the closest
  zoom stretched z19 four times). **The viewer stops at the visible base's last sharp level**
  (owner on #383): its last tile level drawn 1:1, i.e. map zoom `maxzoom − 1` on the 512 px grid
  (`lib/mapView` · `baseMaxMapZoom`: CARTO and swissimage 19, OSM 18) instead of 21, which stretched
  the last level 2–4×; switching to a base that ends sooner clamps the view. **Karte only**
  (`MapView` · `zoomCapAtBase`): the Einsatz map and the Tafel's Lagekarte keep 21 for precise
  symbol placement, the base soft past its last level there. Regression check, WebKit with the iPhone 13
  descriptor: `node e2e/karte-basemap-sharpness.mjs --base <app>` (red above 1.5 device px per
  tile px or on overzoom; its header says how it stands in for CARTO's keyed tiles).
- **Search:** station objects are found on the device; the address search says it needs the
  network. **Objektbesuche** say they need the network and name the catalogue's last visit.
- The catalogue shown from the device is replaced by the server's as soon as it answers again
  (`lib/connectivity · onReachable`, the `online` event), without touching the selection.

⚠️ «●» only for what a probe actually FOUND. Without a service worker controlling the page (a dev
server, a first visit) nothing is served from Cache Storage once the network is gone, so every
cache-backed row reads «nur online» – never a guess. A failed IndexedDB read is not «held» either.

## Home (owner, 16.10.2026 · variant B)

With no Einsatz open, an **account** lands on the viewer at `/` instead of the old launcher card.
`lib/karte/home` holds the decision and its tests:

- **`bootPlan`** names what a list boot does, in the order it always did: a launch into a surface
  (`/besuche…`, `/karte…`) opens nothing behind it; else `pickBootIncident` (a fresh alarm-created
  Einsatz under 3 h, the remembered one, the first open one, the stay after an Abschluss, the
  crash-loop skip) and the closed-return (`shouldReopenClosed`) — **unchanged**; only «nothing to
  resume» is new: home. «Einsatz abschliessen» and «Zurück» from a closed Einsatz land there too.
- **`appScreen`** picks the screen: the Objektbesuche surface, the viewer, the boot's splash, an
  Einsatz — and the launcher card only for a **link session** whose Einsatz could not be fetched
  (it has no station to look at). A visitor who is not signed in still gets the login screen.
- **The menu button** (top left of the bar; owner, review round 5: «i dont like the "einsätze"
  being the main top button» — it said «Einsätze ▾» until then) wears **the station**: its
  uploaded mark (`identity.assets.logo`, fitted to 24 px high, max. 48 px wide) and/or its short
  name (`identity.shortName`, ≤ 8 characters, Verwaltung › Station & Karte › «Kurzname»; FWO:
  «FWO»), then ▾. Neither set → a neutral menu symbol (☰ ▾), never the word «Einsätze»; a mark that
  does not load steps back to the symbol. Phone and tablet alike (the tablet's «keiner offen / 1
  läuft» sub line went with the word — the red chip beside it names the running Einsatz). A small
  **red dot** on its corner while an Einsatz runs or an alarm waits (it was a count); the count is
  in its accessible name: «Menü – <appName>, 2 offen».
- **The running chip** (owner's pick 6A, 23.10.2026, sweep F.2) names the first REAL Einsatz —
  an Übung only when nothing but Übungen runs — with its short address, and ONE «+N» for every other
  open one, Einsätze and Übungen together (no separate Übung count). The name opens that Einsatz;
  «+N» opens the menu, which lists them all. It stands in the bar on both devices — on a phone
  between the menu button and the search (owner: «there is enough space in the peacetime mode»; it
  was a strip under the bar), where it takes what the two leave: the title and the address end in
  «…», «+N» never gives way. Only the phone's Checkliste, whose bar holds the library's field, keeps
  it as a strip under the bar. The Einsatz's own bar (IncidentSwitcher, the title ▾) is not this button.
- **The arrival** (owner, 20.10.2026, after Wispr Flow's streak grid: «a very subtle loading
  animation for the stuff that arrives» — picked «Welle» from a gallery of real-app clips). The
  catalogue answers in one go and the dots and name tags used to land in one frame; now each
  marker fades in a few milliseconds after its western neighbour, 420 ms across the screen and
  260 ms per marker (`lib/karte/arrival` · `arrivalDelays`, with tests; `Karte.module.css` ·
  `.arrive`). The wave waits for the basemap — the markers stand invisible until the map's first
  settled frame (`onSettled`, MapLibre's `idle`; offline it comes at once) or 4 s at the latest,
  because a wave over a blank canvas is one nobody sees. Computed ONCE from the view of that
  moment, without the map, and only for markers mounted in the 2.5 s after it: one mounting
  mid-wave joins where the wave stands (`waveDelay`) — a tag replacing its dot stands at once if
  the dot had already arrived — and after the window every mount is instant, motion on an
  interaction reads as lag. The objects' outlines, which answer a viewport fetch after the map, fade in over
  280 ms when their layer first stands (`MapLayers` · `FilledOverlay`, `fadeIn`); a pan's new rings
  update the source and never fade. The weather chip grows into the bar instead of shoving its
  edge out (`10-journal.css` · `tb-chip-in`). Not animated, on purpose: the app menu and the search
  rows (the owner's call, same day), and nothing on the Einsatz's Lage. Reduced motion: the
  global zero-duration rule in `03-map.css`; the visual suite runs with it, so no baseline moved.
- **The menu** (the button above) opens **the same menu as inside an Einsatz** (owner,
  17.10.2026 — it was the old launcher card with big launch buttons): one component,
  `panels/AppMenuRows`, renders the rows under the Einsatz menu's card (`IncidentSwitcher`) and the
  whole of this sheet, so the two cannot drift. Here it has no card (no Einsatz is being worked
  on): the «Einsätze» label, the running Einsätze as rows (laufende Zeit · title · short address —
  the one the viewer covers too, whose row only steps the viewer aside), the alarms waiting to be
  taken (bell · «Neuer Alarm» · title · address · «Öffnen», and the × that hides one on this
  device only — both locked while a take runs), «Alle Einsätze», «Einsatz eröffnen» (editors);
  then «App»: Objektbesuche, Einstellungen, **«Auf diesem Gerät»** (the viewer's own availability
  sheet, in the slot the Einsatz menu gives «Offline-Bereitschaft», which is about an open
  Einsatz), Funktionen & Hilfe, Installieren where offered; who is signed in with Abmelden, the
  build label. With nothing running and nothing to take, one quiet line says «Keine offenen
  Einsätze». The Rückmeldung prompt (`trouble`) heads the sheet. App hands the handlers to
  `components/HomeMenus · HomeMenu`; the viewer only opens and closes the sheet (`einsaetze.render(close, onDevice)`). The
  red dot is running Einsätze + alarms waiting to be taken. The old card (`components/HomeMenus · LauncherBody`) is
  left only for a link session whose Einsatz could not be fetched.
- **Alarms** show in the Meldeleiste and the banner (no «Anhängen»: no Einsatz is being worked on
  screen); nothing switches by itself. Taking one keeps the 12 s «Alarm übernommen · Rückgängig»,
  and the undo returns to the viewer, not into another open Einsatz.
- **From an Einsatz:** **«Einsatz verlassen»** (owner, 17.10.2026; it was «Karte & Objekte» in the
  «App» group) — about this Einsatz, so in the Einsätze group as the first action under the
  running rows, above «Alle Einsätze», with the map glyph (never the Abmelden one). «verlassen» must
  not read as closing, so the sub line says the Einsatz runs on: «Läuft weiter · zurück zu
  <Objekt · Modul>» when this device has a viewer state, else «Läuft weiter · zur Karte». Never
  for a link session (no `onOpenKarte`). It replaces the address with `/karte` (no history entry — the operational
  screens have none, `objectVisits/route`; the Einsatz's own entries, its Checkliste's levels, are
  walked back first), and the viewer says «Wieder bei …» once. The way
  back is the red chip or the sheet's row, which only step the viewer aside; opening ANOTHER
  Einsatz leaves the viewer in the same step.
- **⚠️ The Einsatz behind stays alive — its Atemschutz alarm above all** (lead decision,
  16.10.2026: silence on a breathing-apparatus timer is the one failure we can't have at 3am).
  `IncidentWorkspace` stays MOUNTED with `covered` while the viewer — or the Objektbesuche, which
  had the same hole — is in front: every hook keeps running (sync, live poll, Verlauf, mute), it
  renders no map, plan or bars and listens to no keys, and it keeps exactly two things on: the
  alarm host (the same tone, and the OS notification with its sound and vibration) and the alarm
  rows in the Meldeleiste over the surface in front — overdue / Alarmdruck / Rückzug per Trupp,
  and the Notfall. «Zum Trupp» brings the Einsatz back (`App · uncoverEinsatz`, nothing reopens)
  on the Atemschutz board at that card. Pinned by `IncidentWorkspace.harness.lifecycle.test.tsx` · (k).
- **The viewer state** (`KarteView` in sessionStorage: frame, object, open plan / Gebäude, the open
  tool by name only, and the label for «Zurück zu …») is per device and per tab session. It is
  written only after the catalogue has answered, so an early exit cannot blank it, and it never
  touches the Einsatz.
