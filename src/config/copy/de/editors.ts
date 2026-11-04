// German copy · the symbol / drawing editors, top bar and small controls.
// One slice of the canonical `de` catalogue, assembled in ../de.ts — read the rules at the
// top of that file before adding or renaming a key here.

export const editorsCopy = {
  contextPanel: {
    titlePlaceholder: 'Bezeichnung …',
    // ⚠️ The generic Fahrzeug is the ONE symbol whose label is its identity («TLF», nicht
    // «Fahrzeug»), so it keeps an editable name — as a field down here rather than as the panel
    // header. Every other symbol's header says which symbol it is and is read-only; was etwas
    // Besonderes über eines zu sagen ist, gehört in die Notizen.
    labelField: 'Bezeichnung',
    floor: 'Geschoss',
    floorFrom: 'Von Geschoss',
    floorTo: 'Bis Geschoss',
    floorNone: '–',
    // FKS Entwicklung (spread) section
    spread: 'Entwicklung',
    spreadH: 'Horizontal',
    spreadV: 'Vertikal',
    spreadBounded: 'Grenze',
    // ⚠️ Der Balken gehört zu SEINEM Pfeil, nicht zur Achse: eine Front, die beidseits läuft
    // und nur an einer Brandmauer steht, ist ein Symbol. Auf einem ausgeschalteten Pfeil
    // schaltet «Grenze» die Richtung gleich mit ein — sonst kostet der Normalfall zwei Tipps.
    spreadBoundedTitle: 'Entwicklungsgrenze – Ausbreitung hier gestoppt',
    spreadDirTitles: { left: 'nach links', right: 'nach rechts', up: 'Obergeschoss (↑)', down: 'Untergeschoss (↓)' } as Record<string, string>,
    count: 'Anzahl',
    rotation: 'Drehung',
    // ⚠️ The Anzahl gets the noun it is counting. A “Patientensammelstelle · Anzahl 12” makes a
    // reader ask «Anzahl was» on the one symbol where the number IS the message — and the Kroki
    // prints the label, so the paper inherits the question. Keyed per symbol; anything not listed
    // keeps the plain «Anzahl».
    countBySymbol: {
      'VKF Patientensammelstelle': 'Anzahl Patienten',
      'VKF Sanitaetshilfsstelle': 'Anzahl Patienten',
      'FW Verwundetennest': 'Anzahl Verwundete',
      'VKF Totensammelstelle': 'Anzahl Verstorbene',
      'VKF Sammelstelle': 'Anzahl Unverletzte',
      'VKF Rettungen': 'Anzahl Personen',
    } as Record<string, string>,
    rotationVehicle: 'Fahrzeug',
    rotationFan: 'Lüfter',
    rotationLadder: 'Leiter',
    // Lüfter airflow direction — Einblasen (blows away from the fan, Überdruck) vs Absaugen
    // (arrow reversed to point into the fan; the fan sits in the space but draws air out)
    airflow: 'Luftrichtung',
    airflowBlow: 'Einblasen',
    airflowExtract: 'Absaugen',
    center: 'Zentrieren',
    // Georeferenz-Zwilling: das Fenster spiegelt ein Objekt der anderen Fläche und ist deshalb
    // ganz gesperrt. Diese eine Zeile führt dorthin, wo es wirklich liegt – und bearbeitbar ist.
    toOriginal: 'Zum Original',
    resetGps: 'GPS',
    resetGpsTitle: 'Auf GPS-Position und -Kurs zurücksetzen',
    // The Kroki is printed hours later. A Fahrzeug that has since driven home takes its symbol
    // with it — the picture then shows no TLF at an Einsatz that had one. «Festhalten» writes
    // the CURRENT position as an override; «GPS» next to it is the way back, so there is no
    // second Fahrzeug behaviour anybody has to remember.
    pinGps: 'Festhalten',
    pinGpsTitle: 'Fahrzeug hier festhalten – es bleibt stehen, auch wenn es wegfährt',
    logPinned: '{name} festgehalten',
    // (The «vor Ort» / «hat den Einsatzort verlassen» rows are written by the SERVER since
    // 25.09.2026, in German like every server-written row — backend · app/vehicle_presence.)
    // Remove a self-reported position from the Kommandoposten: somebody drives home with sharing
    // still on, or a phone dies on its last fix – the dot then claims a Kraft is somewhere it
    // is not.
    // short enough to fit next to «Zentrieren» in the action row – the long explanation sits in
    // the tooltip below it, not on the button
    stopSharing: 'Standort entfernen',
    stopSharingTitle: 'Selbstgemeldete Position dieser Person entfernen. Sie kann danach jederzeit wieder teilen.',
    stopSharingFailed: 'Standort konnte nicht entfernt werden.',
    // Driver of a LIVE Fahrzeug: the GPS feed knows where it is, never who is at the wheel. The
    // placeholder is one word (24.09.2026) – the long one ran past the phone sheet's field.
    driverLabel: 'Fahrer',
    driverPlaceholder: 'Name',
    rotateHint: 'Griff ziehen zum Ausrichten',
    // on-canvas caption override for this one symbol (Standard = follow the device default)
    caption: 'Beschriftung',
    captionDefault: 'Standard',
    captionOff: 'Aus',
    captionAuto: 'Auto',
    captionAll: 'Alle',
    notes: 'Notizen',
    notesPlaceholder: 'Allgemeine Notizen …',
    /** a Messpunkt's readings under its fields, newest first (ReadingHistory) */
    readingHistory: 'Verlauf',
    /** the ⓘ beside a Messpunkt's values (ReadingParts · ReadingInfo, sweep 28.10.2026 #2b): the
     *  rows are built from the preset's alarm limits, so a station's own limits explain themselves.
     *  The unit per measured field key; {n} a limit; {min} the preset's staleMin. */
    readingInfo: 'Grenzwerte',
    readingInfoLabel: 'Was die Messwerte bedeuten',
    readingUnits: { CO: 'ppm', Ex: '%UEG', 'O₂': 'Vol-%', 'H₂S': 'ppm' } as Record<string, string>,
    readingAtLeast: 'ab {n}',
    readingBelow: 'unter {n}',
    readingOr: 'oder',
    readingInfoLevels: 'Gelb = A1 (Voralarm) erreicht, rot = A2 (Hauptalarm) erreicht.',
    readingInfoStale: 'Mit Alter (z. B. 18′) und nur der Rahmen farbig = älter als {min} min.',
    removeField: 'Feld löschen',
    // the ⇄ square at the end of the Einsatzleiter glyph's EL row (title/aria). Says what HAPPENS,
    // not what the button is: an Ablösung is «übergeben», and both Anwesenheits-Bemerkungen follow
    // the swap by themselves.
    swapEl: 'Führung übergeben',
    fieldKeyPlaceholder: 'Bezeichnung',
    /** an empty box (27.09.2026 — it said «Wert»): a person field asks for a name, any other
     *  repeats its own label ({label}) with an ellipsis */
    fieldNamePlaceholder: 'Name …',
    fieldValuePlaceholder: '{label} …',
    // ⚠️ A field whose value needs a UNIT has to say so in the box. «Kapazität: 80» is ambiguous
    // between litres and cubic metres on the one number a Wasserversorgung is planned from —
    // and the placeholder is the cheapest place to settle it, since it costs nothing to ignore.
    fieldPlaceholders: {
      'Kapazität': 'z. B. 80 m³',
    } as Record<string, string>,
    // two fields with the same label collapse into one on save – {key} = that label
    duplicateField: '«{key}» gibt es schon – nur der letzte Wert bleibt erhalten.',
    // UN-Nr → Stoff auto-fill (Gefahrentafel). unField/stoffField are the detail-row
    // keys the lookup reads/writes (must match the preset's `fields`). The summary is
    // read-only and always carries the "ungeprüft" caveat (dataset not expert-reviewed).
    unField: 'UN-Nr.',
    stoffField: 'Stoff',
    // the Stoff search row's placeholder (the Gas/Chemie/Tafel substance combobox)
    stoffSearch: 'Stoff suchen oder eingeben …',
    unHazardTitle: 'Gefahrgut (ADR)',
    // What the ADR codes MEAN (Feldtest 07.09.: «keine Ahnung, was 6.1 heisst») — shown
    // beside every code so the readout explains itself. Class AND label codes in one map
    // (they overlap); an unknown code prints bare.
    adrMeanings: {
      '1': 'Explosive Stoffe',
      '1.4': 'Explosive Stoffe (geringe Gefahr)',
      '1.5': 'Explosive Stoffe (sehr unempfindlich)',
      '1.6': 'Explosive Stoffe (extrem unempfindlich)',
      '2': 'Gase',
      '2.1': 'Entzündbares Gas',
      '2.2': 'Nicht entzündbares, nicht giftiges Gas',
      '2.3': 'Giftiges Gas',
      '3': 'Entzündbare flüssige Stoffe',
      '4.1': 'Entzündbare feste Stoffe',
      '4.2': 'Selbstentzündliche Stoffe',
      '4.3': 'Bildet mit Wasser entzündbare Gase',
      '5.1': 'Entzündend (oxidierend) wirkende Stoffe',
      '5.2': 'Organische Peroxide',
      '6.1': 'Giftige Stoffe',
      '6.2': 'Ansteckungsgefährliche Stoffe',
      '7': 'Radioaktive Stoffe',
      '7E': 'Radioaktive Stoffe (spaltbar)',
      '7X': 'Radioaktive Stoffe',
      '8': 'Ätzende Stoffe',
      '9': 'Verschiedene gefährliche Stoffe',
      '9A': 'Lithiumbatterien',
    } as Record<string, string>,
    // Verpackungsgruppe: the danger GRADE, which the bare Roman numeral does not say.
    packingGroups: { I: 'hohe Gefahr', II: 'mittlere Gefahr', III: 'geringe Gefahr' } as Record<string, string>,
    // the ADR name as the readout's hero line — the word the Einsatz's Gefahrentafel field uses
    // («Stoff»); only «Karte & Objekte» asks for it (UnHazardSection · nameHero), the Tafel has
    // its own field. Since review round 7 the eye sees the name alone, so this word is the screen
    // reader's label for it.
    unSubstance: 'Stoff',
    unClass: 'Klasse',
    unKemler: 'Gefahrnummer',
    unLabels: 'Gefahrzettel',
    unPacking: 'Verpackungsgruppe',
    unNoMatch: 'UN-Nr. nicht in ADR-Tabelle gefunden',
    // ERG 2024 response block (bundled, offline): guide number + TIH-Distanzen — Planungshilfe
    ergGuide: 'ERG-Leitfaden',
    ergPolymerization: 'Polymerisationsgefahr (P) – Behälter kann gewaltsam bersten',
    ergIsolate: 'Isolation (kleine Menge)',
    ergProtectDay: 'Schutzabstand Tag',
    ergProtectNight: 'Schutzabstand Nacht',
    ergLarge: 'Grosse Menge',
    ergTable3: 'siehe ERG Tabelle 3 (Behälter/Wind)',
    ergDayShort: 'Tag',
    ergNightShort: 'Nacht',
    // why the ring on the Karte uses the day or the night distance (lib/ergRings · ergDayNote):
    // the sun at the placard, «Nacht · Sonnenuntergang 16:42»
    ergSunrise: 'Sonnenaufgang {t}',
    ergSunset: 'Sonnenuntergang {t}',
    // The Schutzabstand rings on the Karte (lib/ergRings, Feldtest Manuel 07.09.): the
    // control sits under the distances it draws, and the ergSource caveat covers both.
    // Andocken (lib/docking): the panel row that makes the invisible bond visible
    dockedTo: 'Angedockt an «{name}»',
    dockedRelease: 'Lösen',
    // one tap turns an ERG distance into a real Absperrkreis around the symbol. Since 23.09.2026
    // an ICON-ONLY 44px button (the Absperrkreis tool's own ⊙), so this is its accessible name
    // and the hold-tooltip — it says what appears, where «Übernehmen» only said that something did
    ergAdopt: 'Absperrkreis übernehmen',
    ergRingsLabel: 'Radius auf der Karte',
    ergRingsOff: 'Aus',
    ergRingsSmall: 'Klein',
    ergRingsLarge: 'Gross',
    ergSource: 'Quelle: {v} (PHMSA) – Planungshilfe, nicht validiert',
    ergCameoLabel: 'CAMEO Chemicals (ERG-Details)',
    // the decoded Gefahrnummer hazards (the tactical "kann ich löschen?" answer); the
    // water line is shown red+bold when the Kemler code carries a leading "X".
    unWater: 'Reagiert gefährlich mit Wasser – KEIN Wasser einsetzen!',
    // Deep link to the Cefic ERI card (online; opens in the browser — no live auto-fetch,
    // offline-first). ERI cards are the fire-crew first-action cards for chemical transport
    // accidents; the result list opens with the UN number pre-filled, one tap from the card
    // (GESTIS, the previous target, has no by-UN deep link). `{un}`/`{name}` fill in;
    // p_lang/lang pick the site language — each copy overlay carries its own URL.
    unLookupLabel: 'ERI-Card (Cefic)',
    unLookupUrl: 'https://www.ericards.net/psp/ericards.psp_search_result?p_lang=3&lang=3&unnumber={un}',
    // Kemler/Gefahrnummer decoded hazard meanings (decodeKemler) — the tactical readout.
    // keyed by ADR hazard digit; `kemlerDoubled` = a doubled digit (intensified hazard).
    kemler: {
      '2': 'Gas (Austritt unter Druck oder durch Reaktion)',
      '3': 'Entzündbarer flüssiger Stoff / Gas',
      '4': 'Entzündbarer fester Stoff',
      '5': 'Brandfördernd (oxidierend)',
      '6': 'Giftig / Ansteckungsgefahr',
      '7': 'Radioaktiv',
      '8': 'Ätzend',
      '9': 'Gefahr einer spontanen heftigen Reaktion',
    } as Record<string, string>,
    kemlerDoubled: 'Verstärkte Gefahr (verdoppelte Ziffer)',
  },
  drawingEditor: {
    area: 'Fläche',
    // «Linie», the tool's own word (sweep E.8) – the Verlauf dropped «Zeichnung» on 31.08.
    drawing: 'Linie',
    circle: 'Absperrkreis',
    radius: 'Radius',
    fill: 'Füllung',
    // FKS: eine betroffene Fläche wird schraffiert, nicht gewaschen (Brandzone/Flächenbrand)
    fillHatch: 'Schraffiert',
    move: 'Verschieben',
    // Getippt statt gezogen: ✥ und ⟳ schalten die Direktbedienung auf der Fläche ein. Die
    // Leiste klebt unten in der Mitte – nach UNTEN ziehen geht dort nicht, also übernimmt in
    // diesem Zustand die ganze Karte bzw. der ganze Plan die Geste.
    moveArmed: 'Verschieben aktiv – zum Bewegen ziehen',
    rotateArmed: 'Drehen aktiv – zum Drehen ziehen',
    // die feste Auswahl-Leiste unten an Karte und Plan (SelectionBar) — Gruppenname für
    // Screenreader; ihre drei Knöpfe tragen move / shapes.rotate / delete
    selectionBar: 'Auswahl',
    points: 'Punkte',
    color: 'Farbe',
    width: 'Stärke',
    lineStyle: 'Linie',
    lineSolid: 'Durchgezogen',
    lineDashed: 'Gestrichelt',
    // FKS Vegetationsbrand S. 52 — Linienarten, nicht eigene Objekte: die Dreieckskette ist eine
    // Haltelinie (N nass · T trocken · G Gegenfeuer, als Beschriftung der Linie), die Ringkette
    // die Wasserabwurfzone.
    lineHalteliniUp: 'Haltelinie – Zähne oberhalb',
    lineHalteliniDown: 'Haltelinie – Zähne unterhalb',
    lineAbwurfzone: 'Wasserabwurfzone',
    label: 'Text',
    labelPlaceholder: 'Beschriftung …',
    areaLabelPlaceholder: 'z. B. Sektor A',
    // ── Abschnitt auf der Fläche (FKS Einsatzführung 3.5.2) ──
    // ⚠️ «Abschnittschef», nicht «Leiter» (18.09.2026): «Leiter» ist im Feuerwehrdeutsch das
    // Gerät an der Fassade, und «Leitung» heisst in dieser App die gezogene Schlauchleitung –
    // beide Wörter sind auf der Karte schon vergeben. Abschnittschef ist der FKS-Begriff für
    // die Person, die den Abschnitt führt (FKS Einsatzführung 3.5.2).
    abschnittLeiter: 'Abschnittschef',
    abschnittLeiterPlaceholder: 'Person wählen …',
    abschnittAuftrag: 'Auftrag',
    abschnittAuftragPlaceholder: 'z. B. Brandbekämpfung',
    abschnittMaxHint: 'FKS-Richtwert: höchstens 3–4 Abschnitte.',
    marker: 'Marker',
    markerPlaceholder: 'z. B. R',
    arrow: 'Pfeilspitze',
    ending: 'Abschluss',
    endingNone: 'Keiner',
    endingArrow: 'Pfeil',
    endingArrowStop: 'Pfeil mit Stopp',
    endingTeilstueck: 'Teilstück',
    // ⚠️ Was der Halte-/Hover-Tooltip auf den vier Bildern sagt (Segmented · explain): WAS es ist,
    // in einer Zeile — «Pfeil mit Stopp» heisst Entwicklungsgrenze, das Teilstück ist eine Gabel
    // mit drei Anschlüssen. Keine Folgen: dass ein gelöschtes Teilstück seine Linien freigibt,
    // sagt `removeEMessage` in dem Moment, in dem es tatsächlich passiert.
    endingNoneWhat: 'Ohne Abschluss',
    endingArrowWhat: 'Pfeilspitze',
    endingArrowStopWhat: 'Pfeil mit Stopp-Balken – Entwicklungsgrenze',
    endingTeilstueckWhat: 'Teilstück – Gabel mit drei Anschlüssen',
    // Dreht die Punktreihenfolge um – der Abschluss (Pfeil bzw. Teilstück-«E») sitzt danach am
    // anderen Ende. Die Linie selbst bleibt, wo sie ist.
    reverse: 'Richtung umkehren',
    content: 'Typ',
    contentPlain: 'Wasser',
    lineNo: 'Leitung Nr.',
    // Two Leitungen with the same number make the number ambiguous — and the number is what the
    // Atemschutzüberwachung recognises its Leitung by.
    lineNoDuplicate: 'Leitung {n} gibt es hier schon',
    trupp: 'Gehört zu Trupp',
    truppShow: 'Trupp {name} zeigen',
    truppNone: 'Kein Trupp',
    // The Trupp that laid this Leitung is back out. It stays in the field – it is the entry that
    // says who was on this Leitung – just marked as «draussen».
    truppOut: 'draussen',
    floorTag: 'Geschoss',
    // «Art» on the Gebäude stack (round 3): a drawn line is a Linie or a Wand, and switches
    kind: 'Art',
    kindLine: 'Linie',
    kindWand: 'Wand',
    kindWandBlocked: 'Ein Trupp ist auf dieser Leitung – zuerst den Trupp lösen.',
    kindWandStoreys: 'Diese Linie geht über mehrere Geschosse – eine Wand liegt auf einem.',
    distance: 'Länge',
    // Messung group: the numbers of an already drawn line (length, Schläuche, elevation profile)
    measurement: 'Messung',
    showOnMap: 'Auf Karte',
    inputMode: 'Eingabe',
    modeFreehand: 'Freihand',
    modeNodes: 'Punkte',
    on: 'An',
    off: 'Aus',
    // the same pair when the row is a QUESTION («Übung?»): OnOff `question`
    no: 'Nein',
    yes: 'Ja',
    lock: 'Sperren',
    lockHint: 'Sperrt die Form gegen versehentliches Verschieben; halte das Schloss in der Mitte gedrückt zum Entsperren.',
    // map LockChip on a locked drawing (short-hold to unlock)
    unlockHold: 'Zum Entsperren gedrückt halten',
    connections: 'Verbindungen',
    connectedStart: 'Anfang',
    connectedEnd: 'Ende',
    connectedLines: 'Verbundene Linien ({n})',
    line: 'Linie',
    lineLabelNo: 'Leitung {n}',
    route: 'Verlauf',
    routeDirect: 'Direkt',
    routeTrace: 'Spur',
    detachConnection: 'Verbindung lösen',
    gpsFollowing: 'GPS folgt aktiv',
    gpsMovingAway: 'Fahrzeug bewegt sich weg',
    gpsContinue: 'Weiter folgen',
    /** ⚠️ Says WHERE (24.09.2026): «Hier lösen» read as «here, where the vehicle is now», and in
     *  the line editor that is what it did — the depot spike of 23.09.2026. Letting go of a GPS end
     *  now always happens at the Einsatzort (lib/gpsReturn · onSiteCoords). */
    gpsDetachOnSite: 'Am Einsatzort lösen',
    /** a traced hose may be KEPT (24.09.2026): let go where the end stands now, the drive stays
     *  as the laid hose. Also the only release offered where the on-site point is not known. */
    gpsDetachHere: 'Hier lösen (Spur behalten)',
    /** the Meldung's ✕ on a «stopped» row */
    gpsDismiss: 'Ausblenden',
    gpsPause: 'Folgen stoppen',
    // ── The Meldung when a coupled vehicle drives off / comes back (GpsFollowMeldung, D3) ──
    gpsAwayTitle: '{vehicle} fährt weg, {distance} vom Einsatzort',
    gpsAwayTitleBare: '{vehicle} fährt weg',
    /** ⚠️ The sub-line is ONE line on a 360px phone (~44 characters) — keep these short */
    gpsAwaySub: '{lines} endet noch am Einsatzort.',
    gpsAwaySubMany: '{lines} enden noch am Einsatzort.',
    /** the PRIMARY move of that Meldung: let go, with the end where it is — on site */
    gpsKeepOnSite: 'Am Einsatzort lassen',
    /** following was stopped after the line had traced the drive */
    gpsStoppedTitle: '{vehicle} · {distance} vom Einsatzort',
    gpsStoppedTitleBare: '{vehicle} · Folgen gestoppt',
    gpsStoppedSub: 'Folgen gestoppt. {lines} zeigt die Fahrt.',
    gpsStoppedSubMany: 'Folgen gestoppt. {lines} zeigen die Fahrt.',
    /** the vehicle is on site again while the line still follows it (TLF went to refill) */
    gpsBackTitle: '{vehicle} wieder am Einsatzort',
    gpsBackSub: '{lines} zeigt die Fahrt seit {time}.',
    gpsBackSubMany: '{lines} zeigen die Fahrt seit {time}.',
    gpsRevert: 'Zurück auf Stand am Einsatzort',
    gpsRevertAt: 'Zurück auf Stand am Einsatzort ({time})',
    /** the ↶ bubble's word for that step */
    gpsRevertStep: '{name} zurück auf Stand am Einsatzort',
    // ── The line editor while an end follows (DrawEditor · the GPS block at the top) ──
    gpsFollowingHead: '{line} · folgt {vehicle} seit {time}',
    gpsFollowingHeadBare: '{line} · folgt {vehicle}',
    gpsStoppedHead: '{line} · Folgen gestoppt · {vehicle}',
    gpsDistanceNow: 'jetzt {distance} entfernt',
    hiddenTarget: 'Ziel ausgeblendet',
    revealTarget: 'Ebene einblenden',
    removeConnectedTitle: '{name} entfernen',
    removeConnectedMessage: '{n} Linien werden gelöst.',
    removeEMessage: 'Teilstück löschen? {n} angeschlossene Linien werden gelöst.',
  },
  topBar: {
    offline: 'Offline',
    tiles: 'Tiles',
    recording: 'REC',
    // Caveat on a stalled GPS picture: the Fahrzeuge deliberately do NOT disappear, so the
    // freeze has to be labelled – otherwise hours-old positions look as authoritative as
    // one-minute-old ones.
    gpsFrozen: 'GPS eingefroren',
    gpsFrozenHint: 'Der Live-GPS-Feed antwortet nicht. Die Fahrzeuge stehen auf ihrer zuletzt bekannten Position.',
  },
  // shared compact ±stepper chrome (Stepper.tsx — used everywhere incl. the Einstellungen sheet)
  stepper: {
    less: 'weniger',
    more: 'mehr',
    reset: 'zurücksetzen',
    typeToEnter: 'Tippen zum Eingeben',
  },
  // imperative confirm dialog (lib/ui) default button labels
  confirm: {
    ok: 'OK',
    cancel: 'Abbrechen',
  },
  // custom dropdown (Combo.tsx)
  combo: {
    // (`customDefault` ist weg, 11.09.: die statische «Eingeben …»-Zeile, die ein zweites Feld
    //  aufmachte, gibt es nicht mehr – getippt wird in der Suchzeile, übernommen mit `useTyped`.)
    empty: 'Keine Auswahl',
    officersOnly: 'nur Offiziere',
    // Deliberately NOT auto-focused: this stays a tap picker, and a keyboard that opens by
    // itself covers exactly the list it filters on a tablet.
    searchPlaceholder: 'Person suchen …',
    // The Gast-door skin of the same row (Feldtest Manuel, 07.09.): with the free-type
    // escape the search field doubles as the input for a NEW value, and the query-carrying
    // commit row mirrors «als Gast hinzufügen» — short, because long values ellipsize.
    searchOrType: 'Suchen oder eingeben …',
    useTyped: '«{name}» verwenden',
  },
} as const
