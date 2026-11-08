// English copy · the «Funktionen & Hilfe» overlay.
// One slice of the `en` overlay, assembled in ../en.ts; the German base is ../de/help.ts.

import type { Copy, Localizable } from '../index'

export const helpCopy: Localizable<Pick<Copy, 'help'>> = {
  help: {
    menu: 'Features & help',
    title: 'What can KP Front do?',
    contents: 'Contents',
    close: 'Close',
    search: 'Search help …',
    searchHint: 'Try another keyword – headings and body text are both searched.',
    introFallback: 'KP Front is your brigade’s digital situation and incident command: a tactical situation map, object plans, SCBA monitoring and a shared log – all live across multiple devices at once.',
    sections: [
      {
        id: 'ueberblick', title: 'Overview', icon: 'info',
        blocks: [
          { kind: 'intro' },
          { kind: 'sub', text: 'The four work areas (left rail)', only: 'wide' },
          { kind: 'sub', text: 'The work areas (bar at the bottom)', only: 'phone' },
          { kind: 'list', items: [
            '**Situation** – the tactical map with symbols, lines, areas and the utility layers.',
            '**Plan** – the object plans (Modules 1–6, building outlines) as a whiteboard, storey by storey.',
            '**Checklist** – runnable incident checklists.',
            '**Teams** – monitoring of deployed teams with time and pressure, with and without SCBA.',
          ] },
          { kind: 'note', text: 'Guiding principle: usable at 3am, after six months without practice. Recognition over recall, usable with gloves and offline.' },
        ],
      },
      {
        id: 'karte-objekte', title: 'Map & objects – no incident', icon: 'pin',
        blocks: [
          { kind: 'lead', text: 'With no incident open, KP Front lands here: the brigade’s map with all its objects, to look things up and prepare. This is not an incident – measuring, marking and looking things up happens on this device only, and none of it is saved.' },
          { kind: 'sub', text: 'Search & objects' },
          { kind: 'list', items: [
            'The field at the top searches **addresses and objects**. A hit opens its details: hazards, hydrants nearby and the **object plans**.',
            'Every object is outlined on the map with its buildings and carries its name; tap it to open it. Tapping another building shows what the register knows about it.',
            'The selected object’s plans stand in the left rail and open in the same plan reader as in an incident – read-only. The button at the bottom left leads back to the object.',
          ], only: 'wide' },
          { kind: 'list', items: [
            'The search at the top right finds **addresses and objects**. A hit opens its details: hazards, hydrants nearby and the **object plans**.',
            'Every object is outlined on the map with its buildings and carries its name; tap it to open it. Tapping another building shows what the register knows about it.',
            'The plans are rows in the object’s details and open in the same plan reader as in an incident – read-only. «Back» at the bottom leads to the map.',
          ], only: 'phone' },
          { kind: 'list', items: [
            '**Object visit** and **Report** in the details start the capture, where the brigade has set it up.',
          ] },
          { kind: 'sub', text: 'Tools' },
          { kind: 'list', items: [
            '**Drop pin** – a point with its address and coordinates (LV95 + WGS84) to copy. A long press on free map drops one too.',
            '**Measure** – distance or area.',
            '**Dangerous goods** – enter the UN number: the ADR/ERG facts and the distances as rings around the chosen point.',
            '**Layers** – utilities, hydrants, weather radar and the station data; a setting of its own, independent of any incident.',
            '**Checklist** – the brigade’s checklists and device guides to read, with their own search.',
          ] },
          { kind: 'list', only: 'keyboard', items: [
            'With a keyboard: every shortcut of this view is under **Keyboard shortcuts** › «Map & objects».',
          ] },
          { kind: 'note', text: 'When an incident is running it stands in the bar at the top – red, amber for an exercise – and a tap opens it. A dispatch is shown but never opened by itself.' },
        ],
      },
      {
        id: 'navigation', title: 'Navigation & interface', icon: 'cursor',
        blocks: [
          { kind: 'lead', text: 'Three fixed zones: the area rail on the left, the incident bar on top, the tool rail on the right.', only: 'wide' },
          { kind: 'lead', text: 'Two bars at the bottom, one on top: the area bar at the very bottom, the tool bar above it, the incident bar on top.', only: 'phone' },
          { kind: 'sub', text: 'Bottom bars', only: 'phone' },
          { kind: 'list', only: 'phone', items: [
            'The **area bar** at the very bottom has five tiles: Map, Plans, Checklist, Teams and Report. **Plans** and **Report** stand for several pages (Report, Attendance, Materiel): tap the tile again or hold it to open the chooser.',
            'Above it, the **tool bar** of the map or the plan. **+** is the one door to everything that is put on it.',
            'A button that carries only an icon says its word when you **hold it down**. In **Settings**, «Rail labels» writes the words underneath for good.',
          ] },
          { kind: 'sub', text: 'Left rail', only: 'wide' },
          { kind: 'list', items: [
            'Switches the work area: **Map** (Situation), the **Plans** (Modules/buildings), **Checklist**, **SCBA**.',
            'Dragging the right edge of the rail expands it with labels, or collapses it again.',
          ], only: 'wide' },
          { kind: 'sub', text: 'Top incident bar' },
          { kind: 'list', items: [
            'On the left, the incident name with the **Menu** (switch incident, day/night, this help …) and the clock.',
            'On the right, **Undo/Redo**, **Log** and **+ Entry**.',
          ], only: 'wide' },
          { kind: 'list', only: 'phone', items: [
            'On the left, the incident name with the **Menu** (close incident, switch incident, settings, offline readiness, this help …); on the right, **Undo** and the **Log**.',
            'The round button at the bottom right is **+ Entry**.',
          ] },
          { kind: 'sub', text: 'Message strip' },
          { kind: 'list', items: [
            'Directly under the incident bar sits **one** strip for everything that is pending and stays until somebody acts: an overdue SCBA team, a fresh dispatch, a due reminder, unchecked dispatch data, a waiting update. Every message is one row below the next – no more cards covering each other.',
            'The order is fixed, not by arrival: **SCBA** first, then the **dispatch**, then the **reminder**. What waits for somebody always outranks what goes away by itself.',
            'Only the labelled buttons act, the **✕** and – where the message has somewhere to go – its **title**. A tap anywhere else on the row does nothing: reading must not be the same as acting. With nothing pending the strip is not there at all.',
          ] },
          { kind: 'sub', text: 'Right tool rail', only: 'wide' },
          { kind: 'list', items: [
            'The drawing and placement tools.',
            'Below them, in the bottom-right corner, the **view bar** – always visible, even when the tools scroll: on the map **Layers** and **Views** (the compass), on the plan **Fit** and the north arrow; with a mouse also **−** and **+**.',
          ], only: 'wide' },
        ],
      },
      {
        id: 'tastatur', title: 'Keyboard shortcuts', icon: 'type', only: 'keyboard',
        blocks: [
          { kind: 'lead', text: 'With a keyboard everything is reachable without a mouse. Shortcuts do nothing while you are typing in a text field, nor behind an open window. Where a tile has a key, its letter is printed on it – in both rails, in the view bar at the bottom right and on «Log» and «Entry» at the top (while «Show keyboard shortcuts» is on in **Settings**).' },
          { kind: 'sub', text: 'Switching areas' },
          { kind: 'list', items: [
            'Numbers open the plan module with that number – which ones exist depends on this brigade’s modules: [[1]] module 1, [[2]] or [[3]] the «2/3» module, [[4]] module 4 …',
            '[[K]] Map · [[C]] Checklist · [[A]] Teams (A as in Atemschutz) · [[P]] Attendance · [[M]] Materiel · [[R]] Report – each is the first letter of the GERMAN word, because that is what the key is bound to.',
            '[[⌘]] [[[]] / [[⌘]] [[]]] steps through all areas one at a time (including Surroundings and Building, which have no number).',
          ] },
          { kind: 'sub', text: 'Tools (identical in Situation and Plan)' },
          { kind: 'list', items: [
            '[[V]] Select · [[W]] Multi-select · [[S]] Symbol · [[L]] Line · [[F]] Area · [[U]] Cordon · [[N]] Note · [[T]] Team · [[D]] Measure.',
          ] },
          { kind: 'sub', text: 'Editing' },
          { kind: 'list', items: [
            '[[⌘]] [[Z]] Undo · [[⌘]] [[⇧]] [[Z]] Redo · [[⌘]] [[D]] Duplicate · [[⌫]] deletes the selection.',
            '[[Esc]] takes back one layer per press until the map is clear: a symbol being placed → capturing coordinates → Layers / Views → the tool → the note panel → the selection. In a field [[Esc]] only leaves the field; it closes the **Entry** and keeps its text for the next time.',
          ] },
          { kind: 'sub', text: 'View & panels' },
          { kind: 'list', items: [
            '[[+]] / [[−]] Zoom · [[0]] Fit · [[G]] My location · [[X]] Coordinate format. «Face north» has no key – that is what the compass is for, always visible and turning with the map.',
            '[[J]] Log · [[E]] Entry · [[B]] Layers · [[⌘]] [[,]] Settings · [[?]] this help.',
            'On the **board**, [[PgUp]] / [[PgDn]] page through its sheets.',
          ] },
          { kind: 'sub', text: 'Map & objects (no incident)' },
          { kind: 'list', items: [
            'The same keys where the same thing exists: [[K]] Map · [[C]] Checklist · numbers the modules of the selected object · [[D]] Measure · [[B]] Layers · [[G]] My location · [[0]] Fit · [[+]] / [[−]] Zoom · [[⌘]] [[,]] Settings · [[?]] this help.',
            'Plus what only exists here: [[P]] Drop pin (P as in Punkt) · [[U]] Dangerous goods (U as in UN number) · [[/]] or [[⌘]] [[K]] the search.',
            '[[Esc]] steps back towards the map: search → Views → tool → open plan → selection.',
          ] },
        ],
      },
      {
        id: 'lage', title: 'Situation – map', icon: 'map',
        blocks: [
          { kind: 'lead', text: 'The tactical map over the real map background (operational area and surroundings).' },
          { kind: 'list', items: [
            '**Base map** (top of the layers panel) switches the background: Carto, OpenStreetMap or satellite.',
            '**Views** – the compass at the bottom right – holds **Face north**, **Fit**, **My location**, **Capture coordinates** and the saved views; with a mouse **−** and **+** stand beside it. When capturing, tap the map to fix a point (LV95 + WGS84).',
            '**Wind** is shown continuously (direction + temperature) so the spread direction is immediately clear.',
            '**Vehicles** appear live via GPS (name + heading), your own position as a calm blue dot.',
            '**Building info** at the bottom left names the hazards of the building at the incident address (⚠ gas · PV) and opens its card: hazards, **Immediate measures** and Remarks at the top, the register facts below. The first time this device opens the incident, the card opens by itself so it gets read – the map stays usable. ✕ closes it; after that the chip opens it. A different address or object with content shows it once more.',
          ] },
        ],
      },
      {
        id: 'ebenen', title: 'Layers & data', icon: 'layers',
        blocks: [
          { kind: 'lead', text: 'Via **Layers** you show the utility and hazard data – ordered by type.' },
          { kind: 'list', items: [
            '**Situation** – tactical symbols, vehicles, sketches & notes.',
            '**Station** – underground structures (garages, shelters, tunnels) from the official survey, dashed from street zoom; shown by default.',
            '**Water** – hydrants, mains, valves, sources.',
            '**Sewer** – foul/combined, storm/clean, manholes / gullies.',
            '**Gas** – mains.',
            '**Power** – lines, PV systems.',
            '**Hazards** – flooding, inundation depth.',
          ] },
          { kind: 'lead', text: 'Every layer can be shown/hidden and its opacity adjusted.' },
          { kind: 'list', items: [
            '**Download map for offline** (in the Layers area) pre-loads map tiles, plans, symbols and geodata for the incident location.',
          ] },
          { kind: 'note', text: 'The utility data covers the configured operational area and is available locally – it works offline too.' },
        ],
      },
      {
        id: 'zeichnen', title: 'Drawing & symbols', icon: 'pen',
        blocks: [
          { kind: 'lead', text: 'Tools in the right rail in Situation mode.' },
          { kind: 'list', items: [
            '**Symbol** – the tactical symbol (FKS/VKF). Quick-pick of the most common symbols or search the whole library. Tap to place; turn on "Place several" to set several in a row.',
            '**Shapes** – in the same window, behind the hazards: **Arrow** and **Rectangle**, for everything that has no tactical symbol. The handle rotates, the corner stretches the rectangle (the arrow stays proportional – a distorted head reads badly). On the arrow, **Stop bar** adds the bar across its tip – the spread limit: this far, and stopped there.',
            '**Select** – tap objects, move them, adjust in the editor.',
            '**Multi** – tap **Select** again while it is active: the button switches to Multi (icon and word), and dragging a frame selects several symbols/drawings at once. Another tap switches back to Select.',
            '**Line** – drag or tap points; the style is chosen afterwards in the editor: **Freehand**, **Arrow** or **Rescue axis**. Below it the **Ending** – **None**, **Arrow**, **Arrow with stop** (the same bar across the tip) or **Section**; **Reverse direction** moves it to the other end without moving the line.',
            '**Area** – tap corner points (area shown from 3 points); drag/insert/delete corners.',
            '**Cordon** – drag from the centre to the edge to set the radius in metres (fill adjustable).',
            '**Note** – free text directly on the map.',
            '**Measure** – distance (length + elevation profile) or area (area + perimeter). Drag points to move, tap the line to insert intermediate points, right-click to remove a point.',
            '**Water relay** – below a distance’s elevation profile or in a hose line: choose hose Ø, flow, source (hydrant, pond, pump) and inlet pressure; the chart shows the pressure along the line, **All pumps automatic** places the pumps. **Put on the map as a line** keeps the calculation, **Pumps on map** draws them as symbols.',
          ] },
          { kind: 'sub', text: 'Symbol presets' },
          { kind: 'lead', text: 'Each symbol brings only the controls that make sense: **Rotation** for directional symbols (arrows, ladders, walls), **Count** where several matter, **Storey** or a **storey range** (e.g. stairs/lift), **Spread** for damage situations – plus matching input fields (e.g. name, substance, status).' },
        ],
      },
      {
        id: 'plan', title: 'Plan – modules & buildings', icon: 'doc',
        blocks: [
          { kind: 'lead', text: 'One whiteboard per object over the module/building plans. Storey by storey, with its own tools.' },
          { kind: 'list', items: [
            'Bottom left, beside the scale, shows the loaded object’s **address** – tap it to pick another. The object decides the plans in the left bar.',
            '**Symbol**, **Select**, **Draw** (colour/width/line style), **Note** (text), **Team**.',
            '**Storeys** as a stack: use the **UF/BF** buttons on the plan to add a floor above/below.',
            '**Zoom/Fit** at the bottom of the tool rail, just like on the map.',
            '**Teams** (crews) as coloured markers; toggling **Trails** shows their path. Team chips whose crew is "out" are greyed out/struck through.',
            '**Scale** – tap the two ends of the printed scale bar and enter the real length. After that lines and areas read in real metres (Measure as a tool of its own exists only on the map).',
            'A sheet **linked to the map** already measures by itself – as does the building floor stack, which knows its size from the footprint. There the chip reads **ref. auto** instead of offering a calibration; tapping it opens the fit, or says where the scale comes from. Only an unlinked sheet is calibrated by hand.',
            '**Quick hand note?** The plan is the sketch surface: draw freely, strike through, scribble. The map stays structured (symbols, lines, notes) so the report and the log stay clean.',
          ] },
          { kind: 'sub', text: 'Link to map (georeference)' },
          { kind: 'list', items: [
            '**Link to map** at the bottom of the plan puts this sheet onto the map: the plan gives up half the surface and the map sits beside it. On a phone there is no room for both – there a **Map / Module** switch moves between them. Tap the same spot on both surfaces – a house corner, a hydrant, a junction. **Order does not matter**: a half that has been set finds its counterpart by itself, and you may switch between the surfaces at will. Two points are enough to lay the sheet down.',
            'The **traffic light** in the bar says where you stand at all times: two points solve exactly and are therefore **unchecked** – only the third measures the deviation («4 points · ⌀ 1.2 m»). **Check the fit** lays the sheet outline over the map for a visual check.',
            'Dragging a cross moves it, tapping it opens **Move**, **Delete point** or **Keep**. A tap on **linked** opens the **Fit** with pairs and deviation; **Transfer** copies the reference points to another module of the same object, **Reset** deletes them (with a confirmation). **Close** discards nothing – what has been set is saved already.',
            'From then on **both surfaces show the same objects** – no copy, the same object: tap to see the details, drag to move, the same vertices and handles on either side.',
            'Where an object **stands** is decided by the last hand that placed it: dragged onto a sheet it stands on the sheet – and moves along when the fit is corrected. Dragged onto the map it stands on the ground. A corrected fit relocates everything standing on that sheet – one row in the journal, and one ↶ takes it back. **Sheet shape measured** is the same relocation without a hand involved: the app measured the opened sheet and re-solved the fit at its true shape. **Resetting** a reference loses nothing: sheet and map both keep what they show.',
            'In **Layers** every linked sheet gets one row of its own («Plan (Module 2)»): the sheet itself, as an image under the map. The objects on it need no row any more – they belong to the layer they were placed on.',
          ] },
          { kind: 'note', text: '**Which way is the building facing?** A tap on the **north arrow** top right on the floor stack opens the small window «Rotate building»: a **Rotation** slider with live preview, plus **North up** and **Rotate to long axis** as one tap each. The outline turns with it, the markings stay where they sit on the building – and the printed floor pages show the angle you set.' },
        ],
      },
      {
        id: 'atemschutz', title: 'Teams & SCBA monitoring', icon: 'stopwatch',
        blocks: [
          { kind: 'lead', text: 'Gap-free monitoring of every SCBA team per FKS – the safety signal is the **time since last radio contact**, not an estimated remaining time.' },
          { kind: 'sub', text: 'Create a team' },
          { kind: 'list', items: [
            '**Who goes in**: three slots, the top one is the **team leader** – tapping a row promotes that person, the **✕** removes them. A larger team simply adds rows.',
            'The **person search** reaches the whole roster, not only those present; beside each name stands whatever argues against them (not present, at the station, already in a team). **(+)** records a guest (mutual aid) – added to the attendance at the same time, as the same person.',
            '**Entry pressure** (bar) and **radio channel** sit beside it.',
            'Below that the **assignment**: type (under SCBA Rescue, Extinguish, Search, Secure, Recon, Other; without SCBA Traffic, Medical, Water supply, Secure, Standby, Other), **target / location** in plain text, **line no.** (lines already drawn are offered beside it) and the **colour** on the map and plan.',
            'The assignment holds nobody up: **register team** works without it. The card then reads **«no task yet»**, and tapping that opens the form.',
            'What is typed survives closing the window with **✕** or a tap outside – only **Cancel** discards it.',
          ] },
          { kind: 'sub', text: 'Monitoring per team' },
          { kind: 'list', items: [
            'Large: the clock **Since last contact**: green **Contact ok** → amber **Contact due** → red **Overdue** (no contact within ~5 min) with an alarm.',
            '**Contact** (large button) confirms radio contact and resets the clock.',
            '**Pressure** adjusted directly with ± and applied with **Confirm** – that counts as contact and is logged; a misclick without confirming changes nothing. Low pressure turns red.',
            'Status **Registered → Deployed → Withdrawing → Out**. **Withdraw** can be reverted with **Continue**; an out team returns to monitoring with **Re-deploy** (new cylinder) — the **pressure log of the first deployment is kept** and prints in full on the report.',
            'Teams that are out keep their slot on the board (grey and dimmed) instead of moving into a section of their own — the card you are looking for is where it was.',
            'A **removed team** only leaves the board: it still prints on the report, with everything that was measured, marked «removed from board». **Removed teams** in the header brings it back — the «undo» toast is the quick door, not the only one.',
            '**Log** per team (expandable) shows every contact with time and pressure.',
            '**Edit** (pencil) adjusts assignment, target/storey or team mid-incident.',
            'Somebody under SCBA cannot be signed out in **Attendance** – tapping their row jumps to that team\'s card and highlights it briefly instead.',
            'Overdue teams move to the top and a counter appears. The **bell** mutes the alarm per device – sound **and** notification, and only until this incident ends. If it is red the browser has not released audio: tap it. The board itself is never muted. Everything lands in the log.',
            'Each team can be placed on the plan (the "show on plan" button).',
          ] },
        ],
      },
      {
        id: 'anwesenheit', title: 'Attendance & personnel', icon: 'people',
        blocks: [
          { kind: 'lead', text: 'Who is on this incident, and from when to when — the basis for the personnel sheet and the hours. The roster comes from the admin area; this only records who is here today.' },
          { kind: 'sub', text: 'Recording' },
          { kind: 'list', items: [
            'Tapping a row cycles it: **free → present → left → free**. The first «present» starts at the **alarm time** (ticking usually happens later than arriving); a return starts now.',
            'Every row takes a **remark** («driver TLF», «injured, relieved 21:40»). It describes what this person did here and prints on the personnel sheet. If a row is cycled to «free» by accident, the remark is back with the next «present».',
            '**On scene** or at the **station** is a pair in the row — the answer to «who could still be called in». The header shows the split as soon as somebody is at the station.',
            '**Add person** records somebody who is not on the roster (neighbouring brigade, guest). That is a statement about this incident, not about brigade membership.',
            'Anybody **under SCBA** cannot be signed off — a tap jumps to that team\'s card instead.',
          ] },
          { kind: 'sub', text: 'Correcting' },
          { kind: 'list', items: [
            '**Undo / redo** takes back the last tap (top bar; on a phone in the attendance header). The log keeps both: the tap and the correction.',
            'Times wrong? The **time chips** in the row correct from/to — including an earlier block if somebody was here twice.',
            'The three views on top: **Attendance** (who is here), **Schedule** (who is available when), **Shifts** (relief as bands).',
          ] },
          { kind: 'note', text: 'Recording also runs **by QR** (a poster at the station): whoever signs in there appears here — and both sides may touch the same person without anything being lost.' },
        ],
      },
      {
        id: 'mittel', title: 'Material', icon: 'box',
        blocks: [
          { kind: 'lead', text: 'What was used — from the brigade catalogue or recorded freely. The report prints the material list from it.' },
          { kind: 'list', items: [
            'The **catalogue** comes from the admin area, with unit and source («on the TLF», «Pio»). **+** raises the amount; the row stays.',
            '**Other material** records something the catalogue does not know — a name and an amount are enough.',
            'Where a symbol on the map or a plan stands for a material (fan, oil binder) that is not logged yet, a **strip above the list** says so: «Placed, but not logged». **Log them** records everything missing with the source from the stock – one tap instead of recording the same thing twice.',
            'Setting an amount to **0** does not remove the row from the record — the report shows what was used and what was taken back.',
          ] },
        ],
      },
      {
        id: 'zeitplan', title: 'Schedule & shifts', icon: 'clock',
        blocks: [
          { kind: 'lead', text: 'The second and third view of the attendance: not «who is here» but **who is available when** — for an incident that outlasts one shift.' },
          { kind: 'list', items: [
            'In the **schedule** every person has a row; dragging (or the pen) plans an availability window. It is a **plan**, not a record: it writes no attendance — that only happens when somebody actually taps.',
            '**Confirmed** (solid) or **proposed** (hollow) — the difference between «is coming» and «could come».',
            'The **range** on top decides how many hours are visible at once.',
            'In **shifts** the same windows are grouped into named bands («night 22–06»): creating a band writes no shift, and deleting a band deletes no availability.',
            'Both views print: via the **printer menu** in the header — **shift plan** or **availabilities**, as a PDF or straight to the station printer.',
          ] },
        ],
      },
      {
        id: 'checkliste', title: 'Checklist', icon: 'check',
        blocks: [
          { kind: 'lead', text: 'Two columns: runnable tasks and a searchable tactics reference.' },
          { kind: 'list', items: [
            '**Tasks** – incident checklists (e.g. command support, situation report) with progress; tick items off, branches follow multi-step procedures.',
            '**Tactics · keywords** – search a keyword and open the matching entry (with hazard colour code and sketches).',
            'When an alarm is taken over, a matching keyword is suggested automatically.',
          ] },
          { kind: 'lead', text: 'The state is preserved and synced to all devices.' },
        ],
      },
      {
        id: 'verlauf', title: 'Log & entry', icon: 'verlauf',
        blocks: [
          { kind: 'lead', text: 'A shared, running log across Situation and Plan – the incident chronicle.' },
          { kind: 'list', items: [
            '**+ Entry** (top right): a short tap opens text input. **Press and hold** unfolds two fields – **voice memo** first, **photo** beyond it. Slide onto one and let go. The button itself becomes an **✕** meanwhile: releasing without having slid cancels and leaves nothing behind. Nothing records, and no camera opens, until you let go. Photos can be attached in the entry itself too.',
            'From **two letters** on, names are suggested – personnel, material, partner organisations, vehicles and alarm groups. Tapping one inserts the whole name; it is highlighted in the log and on the printed report. There is no separate «from» field: the sentence already says who reported it. The posts **EL** and **Stv. EL** are part of the vocabulary too: write the post and you get the name («EL (Widmer Céline)»), write the name and you get the post.',
            'As soon as the sentence ends on a name, **→** and **←** are offered beside it — one tap writes the arrow, and «EL → ambulance: patient stable» reads like the radio log the journal is. On paper it becomes «->».',
            'While the field is still **empty**, starter chips stand ready: **EL →** first, then the phrases already used on this incident (otherwise the brigade\'s list). They stay until something is actually typed — a second chip appends to the first.',
            'Significant actions (symbol placed, drawing created/removed …) land in the log automatically.',
            '**Undo/Redo** applies to Situation, Plan – and to **Attendance**, where it takes back the last tap (on a phone the pair sits in the attendance header).',
            'A log entry with a location jumps back to the spot in map or plan when tapped; photos and voice notes can be opened/played directly in the log.',
            '**Start replay** plays Situation and Plan back to an earlier point in time (time slider; editing is locked while doing so).',
          ] },
        ],
      },
      {
        id: 'einsatz', title: 'Manage incidents', icon: 'swap',
        blocks: [
          { kind: 'lead', text: 'Everything in the incident menu (name top left).' },
          { kind: 'list', items: [
            '**Switch incident** between open incidents; **New incident** (location selectable on the map).',
            '**Alarm pool** – take over incoming alarms (only where an alarm source is connected).',
            '**Incidents** – open the archive / earlier incidents.',
            '**Close incident** closes out the running incident – the same dialog as in the report, with the same count of what is still open.',
          ] },
        ],
      },
      {
        id: 'rapport', title: 'Report & closing out', icon: 'doc',
        blocks: [
          { kind: 'lead', text: 'The **incident report** is its own area in the left rail, below Materiel ([[R]]) – a pre-filled capture sheet, not a form from scratch. It is filled in across the whole incident, not only at the end.' },
          { kind: 'list', items: [
            'On wide screens, two columns: on the left the **form** to type in (alerting, short report, times, remarks, feedback to the dispatch centre), on the right the **reconciliation** to tick off (attendance, materiel, partner organisations, photos).',
            'Under the title stands what has been captured – and, as chips of their own, what is **still open**: times, attendance, materiel, incident commander, short report, dispatch feedback. None of it ever blocks printing.',
            'The **sketch excerpt** sits as a field next to the form: pan, zoom, **portrait/landscape**, and the **sketch time** – which moment the picture shows, with marks where something happened. What prints is exactly what is on screen; there is no confirmation step.',
            '**Incident report (PDF)** produces the finished report – rendered server-side, one button. The **▾** beside it opens **«Sections»**: what goes on paper (sketch, plans, SCBA, attendance, materiel, log, photos, detailed audit record). The menu stays open while you tick.',
            'Where a brigade runs a **station printer**: **Print** puts the report in its queue. Queued is not printed – while a job is outstanding it stands as an **open print job** under the report head, with **Check** and **Cancel**. Only when the printer reports «printed» does the report count as produced.',
            'If the brigade has stored its own forms (Administration › Report), **Forms & links** appears below the photos – a list to tick off. **Open** calls the form up with keyword, location, date and incident commander already filled in, as far as the link allows. The tick is set by hand: the app cannot see whether a form was submitted.',
            'If something about the record is off – a broken audit chain, a voice memo without a transcript, a photo still queued – an **orange notice chip** appears next to the buttons. It counts the points and opens them; when everything is in order it does not appear at all.',
            'Contact person and dispatch feedback carry a **Not applicable** at the end of the line – for the false alarm or the oil spill where neither exists. That is an answer, not a skip: it is recorded and reads that way on the report.',
            '**Close incident** closes the incident and records the time it ended. Photos and voice memos that have not been uploaded are sent first; if that is impossible (offline) they are **kept** and go out the next time the incident is opened — the confirmation says how many.',
            '**Share** (at the bottom of the report, and **Share incident** in the incident menu): a link to this incident alone – map, plans, log, photos, times. Read-only, no login, nothing can be changed. For dispatch, the IC and a neighbouring brigade during the incident – and for the municipality and neighbouring brigades afterwards: it outlives the closure until somebody revokes it.',
          ] },
          { kind: 'note', text: 'A closed incident can be **reopened** – later additions appear in the log and the report as **addenda**, and nothing is lost.' },
        ],
      },
      {
        id: 'erfassung', title: 'Capture by QR code', icon: 'cam',
        blocks: [
          { kind: 'lead', text: 'Where a brigade has enabled capture (Administration › Capture), a **QR poster** in the fire station opens the capture view – no login, for everyone without access to a tablet.' },
          { kind: 'list', items: [
            'The running incident is picked; **attendance** and **material** can be captured on your own phone.',
            'A name is stepped on by tapping it: **not present → station → on site → left**. The **ⓘ** next to the search says so again, including what the time beside it means (from = arrival, to = departure).',
            'The entries flow into the **same incident** as the command-post tablet and are merged (with a note to check where they disagree).',
            'As a fallback there is the **blank capture sheet (PDF)** to print and fill in by hand.',
          ] },
        ],
      },
      {
        id: 'sync', title: 'Multi-device & offline', icon: 'check',
        blocks: [
          { kind: 'lead', text: 'All devices see the same incident live.' },
          { kind: 'list', items: [
            'Changes are shared automatically; the sync badge on top shows the state (saved/pending).',
            'Concurrent editing is merged per object (latest change wins).',
            '**Read-only**: viewers and phones see the situation live, without the tactical tools.',
          ] },
          { kind: 'sub', text: 'Offline' },
          { kind: 'list', items: [
            '**Offline preparation** in **Settings** ([[⌘]] [[,]]) is set to **Automatic**: the installed app fetches map, plans, symbols and reference layers by itself shortly after an incident is opened – no dialog, no toast. **Every** configured map layer comes along, including the one currently hidden: experience says it gets switched on once the network is already gone. **Manual only** leaves that to the **Load everything for offline** button.',
            'How much is loaded is set by the **Offline radius** (Settings as well, this device only): a smaller radius = a faster, smaller download.',
            'What is actually ready is shown by **Offline readiness** in the incident menu – row by row: map, plans, symbols, hazmat, reference layers, personnel, device storage. **Weather** and **Object search** need a connection and stand there as «online only».',
            'Only the **installed app** is reliably offline. In a browser tab the storage can be cleared at any time, and the tab would have to still be open at the next incident.',
            'Without a network everything on the device keeps working: drawing and placing symbols, SCBA, attendance, materiel, log and report. Photos and voice notes stay stored and go out later.',
            'As soon as there is a network again the changes go out by themselves and are merged with the other devices – per object, latest change wins. While anything is pending, the sync badge on top says so.',
          ] },
        ],
      },
      {
        id: 'bedienung', title: 'Operation & day/night', icon: 'move',
        blocks: [
          { kind: 'sub', text: 'Tap & drag (touch/iPad)' },
          { kind: 'list', items: [
            'One finger pans the map/plan; two fingers zoom (pinch).',
            'One finger zooms too: **double-tap** zooms in; **tap, then press again and drag** zooms smoothly – down to zoom in, up to zoom out. The same on the map and the plan, with **Select**. A tool comes first: where it taps (points, measure, add, note, circle …) every tap is its own; where it drags (freehand, multi-select) a double-tap still zooms. Two fingers always zoom. A line or area tapped out point by point is finished with ✓, never with a double-tap.',
            'Tapping **Select** again switches the button to **Multi**: dragging a frame selects several objects; selected objects are moved by dragging.',
            'A button that carries nothing but an icon says its word when you **hold it down** – after a short moment the word appears as a bubble above it, on touch with a short buzz. Letting go does **not** trigger the button: asking what something is must not also do it. With a mouse, hovering is enough.',
          ] },
          { kind: 'sub', text: 'Mouse', only: 'keyboard' },
          { kind: 'list', only: 'keyboard', items: [
            'Scroll to zoom; **right-click** (or long press) on a measure/line point removes it, clicking a line inserts an intermediate point.',
          ] },
          { kind: 'sub', text: 'Keys', only: 'keyboard' },
          { kind: 'list', only: 'keyboard', items: [
            '[[Esc]] takes back one layer – tool, open panel, selection (the full order is under **Keyboard shortcuts**).',
            '[[Del]] / [[Backspace]] deletes the selection (not while typing in a field).',
          ] },
          { kind: 'sub', text: 'Day / night' },
          { kind: 'list', items: [
            'Toggled in the incident menu – night mode dims the map and interface for the dark.',
          ] },
        ],
      },
      {
        id: 'verwaltung', title: 'Administration & station data', icon: 'gear',
        blocks: [
          { kind: 'lead', text: 'Anything that holds for the whole brigade – crew, ranks, vehicles, materials, map layers, object plans, checklists – is maintained under **Administration**, not during an incident. Getting in takes its own password, not the incident PIN.' },
          { kind: 'sub', text: 'The workbook (Excel)' },
          { kind: 'list', items: [
            'Under **Daten › Arbeitsmappe** the brigade’s lists come as one Excel file: download it, edit it in Excel, Numbers or LibreOffice, upload it back. Eight sheets – Mannschaft, Dienstgrade, Fahrzeuge, Mittel, Mittel-Bestände, Quellen, Partnerorganisationen, Symbolfelder (the tab names stay German).',
            'A **preview** always comes before any writing: sheet by sheet, what would be new, what changes, what falls away – and every refused row with its sheet and row number. Nothing is written until you confirm, and cancelling writes nothing.',
            'Uploading the same file again changes nothing at all. The download is therefore also the template – and safe to fetch just to look at.',
          ] },
          { kind: 'note', text: '**An absent sheet is not an empty sheet.** Deleting a whole sheet from the file leaves that list untouched. Deleting only its rows and leaving the header row clears it – which is exactly how you empty a list on purpose.' },
          { kind: 'note', text: '**«Missing» means two different things.** A person missing from the Mannschaft sheet is **deactivated**, never deleted – closed incidents resolve their name through that row. An id missing from any of the other lists is **removed**. The preview uses those two words and names the rows rather than counting them.' },
          { kind: 'sub', text: 'When something goes wrong anyway' },
          { kind: 'list', items: [
            'Every change to the **lists** keeps the previous state: **Sicherung › Letzte Änderungen** lists them with a timestamp and puts one back – whether a form, the workbook or a terminal wrote it.',
            '**The crew is not in there.** People are their own records, not configuration – an import that touches only the Mannschaft sheet does not appear under «Letzte Änderungen» at all. In exchange nobody is ever deleted there, only deactivated: undoing it means re-activating. To put the whole list back, use the file you downloaded before the import.',
            'The workbook is **not a backup**: it covers the lists only. The backup is the JSON export under **Sicherung**.',
          ] },
        ],
      },
    ],
  },
}
