// German copy · the Karte: tools, nav, views, hints.
// One slice of the canonical `de` catalogue, assembled in ../de.ts — read the rules at the
// top of that file before adding or renaming a key here.

export const mapCopy = {
  // kind drives how the tool-rail button reads & behaves:
  //   'tool'   — modal, sticky (flat, lights up while active)
  //   'action' — one-shot, fires & gives toast feedback (push-button look)
  //   'mode'   — switches the whole surface (push-button look)
  mapTools: [
    // ONE list, no dividers (22.09.2026): the rail used to draw a hairline before the create
    // group, and it read as noise beside the one seam that matters — the footer's generic
    // controls, which the rail separates itself. Symbol leads the create tools as a plain tool.
    // Auswahl carries Mehrfach as its SECOND state (05.09.) instead of a rail slot of its own:
    // tapping the already-armed Auswahl swaps glyph AND word to Mehrfach, tapping again swaps
    // back. Both keys keep working ([[V]] / [[W]]) — this is chrome, not a new tool.
    { id: 'select', icon: 'select', label: 'Auswahl', kind: 'tool', alt: { id: 'lasso', icon: 'marquee', label: 'Mehrfach' } },
    { id: 'symbol-slot', slot: true, icon: '', label: '' },
    { id: 'line', icon: 'pen', label: 'Linie', kind: 'tool' },
    { id: 'area', icon: 'area', label: 'Fläche', kind: 'tool' },
    { id: 'circle', icon: 'circle', label: 'Absperrkreis', kind: 'tool' },
    // (no divider between Absperrkreis and Notiz — it cost a rail row to separate two groups
    // that are both «etwas auf die Karte setzen»; the one before Symbol followed it on 22.09.)
    { id: 'note', icon: 'type', label: 'Notiz', kind: 'tool' },
    { id: 'team', icon: 'flag', label: 'Trupp', kind: 'tool' },
    { id: 'measure', icon: 'measure', label: 'Messen', kind: 'tool' },
  ],
  // Plan/whiteboard tool list — mirrors mapTools' ordering (Auswahl · Symbol · then the create
  // tools) so the two shared tool rails read the same. Symbol leads the create group as a plain
  // tool, one undivided list — the same as mapTools.
  planTools: [
    // …and the same two-state Auswahl the Karte has: 'pan' IS the plan's Auswahl, Mehrfach is
    // the second tap on it. Lage ↔ Plan parity — one interaction, both surfaces.
    { id: 'pan', icon: 'select', label: 'Auswahl', alt: { id: 'lasso', icon: 'marquee', label: 'Mehrfach' } },
    { id: 'symbol-slot', slot: true, icon: '', label: '' },
    // single Linie tool (Freihand-drag ↔ Punkte toggle lives in its dock), mirroring the Karte map
    { id: 'line', icon: 'pen', label: 'Linie' },
    { id: 'area', icon: 'area', label: 'Fläche' },
    { id: 'circle', icon: 'circle', label: 'Absperrkreis' },
    { id: 'text', icon: 'type', label: 'Notiz' },
    { id: 'resource', icon: 'flag', label: 'Trupp' },
    // Messen: node-based distance/area on the plan (uses the calibrated scale). Calibration
    // itself is reached via the always-visible Massstab trust chip, not a separate rail button.
    { id: 'measure', icon: 'measure', label: 'Messen' },
  ],
  nav: {
    zoomIn: 'Vergrössern',
    zoomOut: 'Verkleinern',
    fit: 'Einpassen',
    resetNorth: 'Nach Norden ausrichten',
    centerIncident: 'Auf Einsatz zentrieren',
    coords: 'Koordinaten abgreifen',
    coordsHint: 'Auf Karte klicken zum Festhalten',
    // the readout's ✕ (and Esc, and the toolbar button) all END the mode — a locked point is
    // never cycled back into aiming, which is what used to swallow the next map tap (02.09.)
    coordsLocked: 'Festgehalten – ✕ zum Beenden',
    coordsExit: 'Koordinaten beenden',
    autoMode: 'Automatisch',
    // 'device' follows the OS light/dark setting (prefers-color-scheme), 'auto' the daylight
    deviceMode: 'Gerät',
    dayMode: 'Tag',
    nightMode: 'Nacht',
  },
  // saved map views (camera bookmarks) — opened from the multi-purpose compass
  mapViews: {
    title: 'Ansichten',
    north: 'Nach Norden',
    fit: 'Einpassen',
    locate: 'Mein Standort',
    save: 'Ansicht speichern',
    hint: 'Eine Ansicht speichert Position, Zoom und Drehung der Karte. Tippe eine gespeicherte Ansicht an, um dorthin zu wechseln, z. B. zwischen der Nordübersicht und einer in deine Blickrichtung gedrehten Ansicht. Kompass lange drücken: Karte direkt einpassen.',
    rename: 'Umbenennen',
    delete: 'Löschen',
    saved: 'Ansicht gespeichert',
    deleteTitle: 'Ansicht löschen',
    deleteMsg: '«{name}» löschen?',
  },
  toast: {
    audioSaved: 'Audionotiz gespeichert ({secs}s)',
    micDenied: 'Kein Mikrofonzugriff – als Platzhalter vermerkt',
    // the mic WAS granted; the recorder itself would not start (unsupported format/hardware)
    micFailed: 'Aufnahme konnte nicht gestartet werden',
    merged: 'Änderungen zusammengeführt',
  },
  // help shown by the info (ℹ) button on each tool dock — the instructions
  // that used to sit in the bottom hint bar
  dockHints: {
    lasso: 'Mit einem Finger einen Rahmen um mehrere Objekte ziehen. Mit zwei Fingern verschiebt sich weiterhin die Karte. Nochmals auf «Mehrfach» tippen führt zurück zur Auswahl.',
    line: 'Auf der Karte ziehen oder Punkte tippen, um eine Linie zu zeichnen. Farbe, Breite und Stil danach im Editor.',
    /** …per input mode, because the two take different gestures: «Freihand» draws only with a
     *  drag (a tap does nothing), «Punkte» only with taps and ✓. These and `area` are the Karte's
     *  AND the Plan's (WbControls), so they name no surface (UX sweep M4, 20.10.2026): a node
     *  draft finishes on ✓ on both, never on a double tap — that zooms, as everywhere. */
    lineFreehand: 'Ziehen, um eine Linie zu zeichnen. Für einzelne Punkte: «Punkte». Farbe, Breite und Stil danach im Editor.',
    lineNodes: 'Punkte tippen, mit ✓ abschliessen. Farbe, Breite und Stil danach im Editor.',
    area: 'Ziehen zeichnet den Umriss frei – für einen Brandrand, der keine Ecken hat. Oder mindestens drei Eckpunkte tippen, mit ✓ abschliessen.',
    circle: 'Von der Mitte zum Rand ziehen setzt den Radius in Metern. Radius und Füllung danach im Editor anpassen.',
    note: 'Auf die Karte tippen, um eine Notiz zu setzen – sie öffnet sich direkt zum Tippen. Grösse, Farbe und Klartext danach im Panel der Notiz.',
    team: 'Auf die Karte tippen und den Trupp aus der Liste wählen. Zum Verschieben ziehen.',
    shape: 'Auf die Karte tippen, um die Form zu platzieren. «Mehrere platzieren» einschalten, um mehrere nacheinander zu setzen.',
    // Eine Rotation ist eine Strecke zwischen zwei Orten, also wird sie auch so gelegt:
    // erst der Wasserbezug, dann die Brandstelle. Auf einem Symbol halten, bis der Ring
    // zu ist, setzt den Punkt genau darauf.
    rotationStart: 'Ersten Punkt tippen – dort, wo das Wasser bezogen wird. Auf einem Zeichen halten, bis der Ring voll ist, setzt den Punkt genau darauf.',
    rotationEnd: 'Zweiten Punkt tippen – die Brandstelle. Nochmals auf denselben Punkt tippen legt eine Rotation in Standardlänge hin.',
    measure: 'Punkte auf die Karte tippen. Strecke zeigt Distanz und Höhenprofil, Fläche zeigt Flächeninhalt und Umfang. Punkte ziehen zum Verschieben, das + in der Mitte einer Strecke setzt einen Zwischenpunkt, einen Punkt gedrückt halten (am Computer Rechtsklick) entfernt ihn.',
  },
  map: {
    incidentHere: 'Einsatzort',
    youHere: 'Mein Standort',
    // the 6px ink dot on a glyph whose name did not fit: it says a name EXISTS here, and
    // selecting the symbol always brings it back (the selection is exempt from suppression)
    // WebGL context loss (iPad reclaims the GPU in the background) — the map goes blank while
    // everything around it still works, so it needs naming and a way out.
    glLost: 'Kartenansicht unterbrochen',
    glLostHint: 'Das Gerät hat die Grafikanzeige der Karte freigegeben. Deine Einträge sind gespeichert.',
    glLostAction: 'Karte neu aufbauen',
    // offline with no cached basemap for this view: the map is a flat colour with symbols on it,
    // and nothing said why. One Meldeleiste row per Einsatz, gone the moment the link is back.
    noTilesTitle: 'Keine Basiskarte für diesen Ausschnitt gespeichert',
    noTilesSub: 'Offline – Objekte und Linien werden ohne Karte gezeigt',
    noTilesAction: 'Offline-Bereitschaft',
    noTilesDismiss: 'Ausblenden',
  },
} as const
