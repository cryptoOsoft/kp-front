# The Gebäude card

Status: 🟢 shipped (KP Front idea F5, 2026-10-09; opens by itself the first time since 2026-10-10).

The **Gebäude** chip stands in the bottom-left chip row of the **Karte**, and in the **Plan**'s
chip row beside the Objekt chip whenever an Objekt is bound, and on the Gebäude stack beside the
building chip (`components/BuildingFloat`; not on a phone's plan, whose one-line row needs the
room for the Objekt's name). On a phone it is part of the Karte's one floating row, left of the FAB.
Closed, it names the hazards as glyph + word («⚠ Gebäude-Info · Gas · PV»), or just «Gebäude-Info»
– the same words on every surface and size (owner pick C8, 05.11.2026; the phone and the plan's
row said «⚠ Gas» alone until then). A tap opens the card docked one row above it.
The card is non-modal, like the Passung: the map stays live, and ✕, the chip or Esc close it.
Until 09.10.2026 the card sat in the incident menu; the owner wanted it «on the map directly».

## It opens by itself the first time

Owner, 10.10.2026: the Sofortmassnahmen must be read, not merely be one tap away. So the first
time **this device** shows the Karte of an Einsatz whose building has anything to show – the card
opens by itself, still docked and non-modal: the map stays live and the operator keeps working
(`lib/buildingFirstOpen`, wired in `IncidentWorkspace` → `MapControls` → `BuildingFloat · autoOpen`).
Until 30.10.2026 only a hazard (Gas, Heizöl, PV), Sofortmassnahmen or Bemerkungen opened it;
since the sweep of that day (#6, owner pick «Both») Geschosse, Baujahr or a last Objektbesuch do
too, on every new Einsatz. A building with nothing at all has no chip and no card, so nothing opens.

- **Once per device per Einsatz per building.** The flag is device-local view state in IndexedDB
  (`kp-front-building-read:<incidentId>`), never the synced workspace: another tablet on the same
  Einsatz has its own operator who has not read it. A building is the Einsatzort the answer was
  asked for plus its Objekt, so an address corrected in «Bearbeiten» or a manual Objekt pick that
  brings new content shows the card once again.
- **Read means closed** – ✕, Esc or the chip. A card left open when the operator leaves the Karte
  or the app is killed was not dismissed and comes back the next time the Karte is shown. The chip
  stays to reopen it.
- **When.** Never under the opening cover (`lib/bootCover`): it opens after the snail has faded.
  Only on the Karte – an Einsatz that opens on another surface shows it the first time the Karte
  is shown – and not while the operator has the Ebenen, Ansichten, the Verlauf, the composer or the
  Offline-Vorbereitung open over it; it waits until they are back on the bare Karte. Building data
  that arrives later (an offline open, then online) opens it when it first arrives with content.
  Not in a replay (Wiedergabe), a closed Einsatz, a tab that lost the one-tab lock, or the
  Atemschutz-Link, whose Tafel has no Karte. The Plan's chip row never opens it by itself.
- **What must be read stands first**, so it is in view without scrolling (on a phone the card is
  at most 56 % of the screen high), in two steps under one heading style (owner, 27.10.2026: «a
  clear two-step thing: first "Sofortmassnahmen" then "Gebäude"»): **Sofortmassnahmen** and
  Bemerkungen (no source line – «drop the source»; only a NEIGHBOUR's notes are named, «Schloss
  Musterdorf · in der Nähe (118 m)», because they read exactly like this building's), then
  **Gebäude** – the hazard lines first, then the register facts, bullets of the Sofortmassnahmen's
  size and weight (the Karte panel's `RegisterLines`) – then the last Objektbesuch. There is no head
  row: the FIRST section's heading carries the ✕ at its right end, and «Register-Hinweis» (the
  source line right under it, FOLDED each time the card opens, as on the Karte panel – Manuel
  09.11.2026; open since sweep 30.10.2026 #6 until then; a tap opens it) always sits on the «Gebäude» heading's row – [GEBÄUDE ·
  Register-Hinweis · ✕] when there are no Sofortmassnahmen (owner, 27.10.2026: the empty head
  row was wasted). «Gebäude» is the card's accessible name. Every bullet is one size, `--fs-2`.

The chip is not pinned to the building on the map, for three reasons. The Lage is drawn exactly
at the Einsatzort, so a pinned chip would cover the Brandherd and the first vehicles. It would
move with every pan. And it would have no plan-side twin. The chip row is the same place on both
surfaces, and the floating row already budgets for it, with the message lane standing above it.
The Plan skips the chip where it skips the Objekt chip: on the Gebäude floor stack and on the Tafel.
It also skips it on a **phone**'s plan. That row is one line beside the FAB, and «⚠ Gas · PV»
squeezed the Objekt chip down to its glyph, so «which object are these plans of» went unanswered.
On a phone the Karte's chip is one tap away.

The card answers «what is this building» from four sources. Each one is optional and fails on its own:

| Half | Source | What it shows | Source line |
|---|---|---|---|
| Register facts | GWR (`ch.bfs.gebaeude_wohnungs_register`, identify at the Einsatzort) | Gebäudeklasse, Geschosse, Wohnungen (per Stockwerk and their Zimmer), Baujahr or Bauperiode, heating and hot-water generator + energy source, Zivilschutzraum, a status other than «bestehend» | «GWR ‹street› · Stand ‹export date›», «Heizung erfasst ‹date›» |
| Plants | BFE `ch.bfe.elektrizitaetsproduktionsanlagen`, joined **by EGID** | «PV 35.6 kW», other plants by their register label | «BFE abgefragt ‹date›» |
| Modul-1 notes | `ObjectSite.measures` / `remarks` / `measures_source` | the Einsatzobjekt's Sofortmassnahmen and Bemerkungen, one per line | «‹Objekt› · ‹source›», or «‹Objekt› · in der Nähe (‹m› m)» |
| Last visit | `object_visits` (completed, latest `visited_at`) | «Letzter Objektbesuch ‹date› · ‹n› Mängel» | the date itself |

The rules (3am tenet):

- **«Register-Hinweis», never a fact.** A heating entry can be years old, and only plants
  registered with Pronovo are in the BFE list, so «no PV in the register» is not «no PV».
  Every fact carries its source and date.
- **Hazards are a glyph and a word**: gas and oil (heating, or a hot-water boiler that adds a
  fuel the heating does not name) and PV are lines whose bullet is the amber warn glyph – same
  size and weight as every other line, the glyph marks them.
  Never colour alone.
- **What makes the heat stands next to the fuel**: «Heizung Gas, Heizkessel für mehrere
  Gebäude» (that boiler may stand in the next building). A second heating system only when the
  register names one; hot water only when it is not the same fuel in the same kind of generator
  as a heating system («Warmwasser Elektro, Elektroboiler» behind a heat pump).
- **The Wohnungen are one line**: «9 Wohnungen · EG 3 · 1. OG 6 (Maisonette) · 2–4 Zi.» –
  existing flats only (`wstat` 3004), counted on their entrance storey; per storey only from two
  flats up and only when every flat names its storey. The count drops out when the Gebäudeklasse
  already says it («Einfamilienhaus»).
- **Nothing that nags.** A failed source, a building with no register entry, an object without
  notes draw nothing. A card with nothing to say is not drawn.
- The object is the plan rail's (`api/objects · ranked_objects_near`: address match, then the
  nearest within 400 m) or the operator's manual pick. When it was found by distance only, the
  card says «in der Nähe», because a neighbour's gas valve reads exactly like ours.

## API

`GET /api/incidents/{id}/building?lang=de|fr|it|en[&object=<uuid>]` → `BuildingOut`
(`backend/app/api/building.py`). `registers` says whether the federal registers were asked at all:
`off` (`map.buildingRegister: false`), `outside_ch` (the point is outside Switzerland's bounding
box), `no_location`. `gwr_status` / `pv_status` separate «could not be asked» (`error`) from
«had nothing» (`none` / `ok` with an empty list). The answer holds keys and numbers; the words
are the app's copy (`appConfig.copy.building`) in all four locales.

The alarm link may read it (it is live information about its own Einsatz). The visit half is left
out for every link session, and the Rapport view link may not ask at all. The object routes
(`/api/objects…`, `…/{id}/objects`) leave `measures`/`remarks`/`measures_source` out for every link
session, because the view link reaches them for its Rapport's plans, not for the station's notes.

Outside an Einsatz, «Karte & Objekte» asks the same registers for any point:
`GET /api/reference/building?lat=&lng=[&address=]` answers the same `BuildingOut` through the same
lookup (`api/building · fill_registers`), and names an `object` only on an EXACT street + number
match, never by distance ([`karte-objekte.md`](karte-objekte.md)).

The building is the GWR entry within 60 m (`MAX_DISTANCE_M`) of the Einsatzort; among those, one
whose street + number equals the incident's wins, otherwise the nearest. identify's search radius
is in pixels of a pretend image, so `identify_tolerance_px` sizes it to reach 60 m east–west, and the
result limit is high enough that the building is never cut. identify answers in no order.

## Caching and offline

- Server: per point + street, in-process. The answer is language-free (the plants keep the
  register's own labels in all four languages and are decoded per request). A clean answer is kept
  for a day; an answer with a failed source for two minutes, so a blip heals by itself. Concurrent
  requests for one key share one lookup (`building_facts.registers_cached`).
- Device: `lib/api/building.ts · buildingResilient` keeps the last answer per Einsatz in IndexedDB,
  stamped with the place it was asked for (`buildingWhere`: address + point), and serves it when
  the server cannot be asked, but only for the same place. A fresh answer in which a source failed
  keeps that source's half from the last good one: the GWR half only for the same place, the PV half
  only for the same EGID. A corrected address must never carry the old building's gas heating
  along. The hook fetches when the Einsatz opens (not when the menu does, so the copy is on the
  device before anybody needs it), and again when the address or point changes, when the manual
  object pick changes, and when the device comes back online.

## Sofortmassnahmen and Bemerkungen are station data, typed by hand

KP Front has no structured source for them. FireGIS prints them on the Modul-1 sheet. They get
into the app in two ways:

- **Verwaltung › Objektpläne**: the object mask has «Sofortmassnahmen», «Bemerkungen» and «Quelle».
- **`admin_objects`**: the manifest keys `measures`, `remarks` and `measuresSource` per object.
  They are written only when present, so a manifest without them never wipes what Verwaltung
  typed. `""` clears them.

Reading them off a station's PDFs is station-specific tooling and stays outside this repository.
The PDFs carry a text layer, but the text runs in no useful order: map labels clipped out of view
are mixed in. Read by position instead: the box between the «Sofortmassnahmen:» and «Bemerkungen:»
headings, in body size.

## Code lists

GWR Merkmalskatalog (4.3, current on housing-stat.ch on 2026-10-20), cross-checked against the
register's decoded popup on 2026-10-08 and, for the class, generator and storey codes, on
2026-10-20 with one live building per code (`backend/app/building_facts.py`): `genh*`/`genw*` → `gas` 7520, `oil` 7530, `wood` 7540–7543,
`district` 7580–7582, `air` 7501, `geothermal` 7510–7512, `water` 7513, `electricity` 7560, `solar`
7570, `waste_heat` 7550, `other` 7599 (and any code newer than the table), nothing for 7500 «keine»
and 7598 «unbestimmt». `gbaup` 8011–8023 → «≤1918» … «≥2016».

`gklas` → `single_family` 1110, `two_family` 1121, `multi_family` 1122, `home` 1130 (Wohngebäude
für Gemeinschaften), `hotel` 1211–1212, `office` 1220, `retail` 1230, `restaurant` 1231, `transport`
1241, `garage` 1242, `industry` 1251, `storage` 1252, `culture` 1261–1262, `school` 1263, `hospital`
1264, `sports_hall` 1265, `church` 1272, `monument` 1273, `collective` 1275, `farm` 1271 and
1276–1278; nothing for 1274 «sonstige Hochbauten» or a newer code.
`gwaerzh*`/`gwaerzw*` → `heat_pump` 7410–7411/7610, `solar_thermal` 7420–7421/7620, `boiler`
7430–7435/7630–7634, `stove` 7436, `chp` 7440–7441/7640, `electric_storage` 7450–7451,
`electric_direct` 7452, `heat_exchanger` 7460–7461/7660, `electric_boiler` 7650–7651; the odd
heating codes 7411, 7421 … are «für mehrere Gebäude» (`shared`). Nothing for 7400/7600 «kein
Wärmeerzeuger» and 7499/7699 «andere». `wstwk` 3100 Parterre → 0, 3101–3199 → 1. … Stock,
3401–3419 → 1. … Untergeschoss.
