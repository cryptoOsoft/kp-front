// German copy · photos, weather, PDF, Einstellungen, Feedback, offline and empty states.
// One slice of the canonical `de` catalogue, assembled in ../de.ts — read the rules at the
// top of that file before adding or renaming a key here.

export const panelsCopy = {
  // full-size picture viewer (openPhoto) — a photo used to open in a new tab, which leaves the
  // installed app on iOS
  photoViewer: {
    title: 'Foto',
    download: 'Herunterladen',
  },
  // a Verlauf photo that knows where it was taken (EXIF, lib/photoGeo) — detail sheet, save
  // toast, the photo marker on the Karte and on a georeferenced Plan
  photoGeo: {
    place: 'Auf Karte setzen',
    placeN: '{n} Fotos auf Karte setzen',
    show: 'Auf Karte zeigen',
    placedStep: 'Foto auf Karte gesetzt',
    logPlaced: 'Foto auf Karte gesetzt',
    logPlacedN: '{n} Fotos auf Karte gesetzt',
    where: 'Aufnahmeort',
    whereN: 'Aufnahmeort Foto {n}',
    distance: '{d} vom Einsatzort',
    facing: 'Blick nach {dir}',
    takenAt: 'aufgenommen {t}',
    tooFar: 'Zu weit weg für die Karte',
    marker: 'Foto vom Verlauf',
    markerTaken: 'Foto vom Verlauf · aufgenommen {t}',
    planMark: 'Foto – auf der Karte verschieben oder entfernen',
    // the device position stands in for a photo without EXIF position (lib/devicePosition)
    sourceExif: 'Ort aus dem Foto',
    sourceDevice: 'Standort des Geräts',
    accuracy: '± {m} m',
    askTitle: 'Standort zu Fotos speichern?',
    askMessage: 'Die Kamera gibt KP Front keinen Aufnahmeort mit. Mit dem Standort dieses Geräts lässt sich ein Foto auf der Karte setzen.',
    askNote: 'Gespeichert wird nur die Position, und nur in der Nähe des Einsatzes. Änderbar unter Einstellungen.',
    askYes: 'Standort verwenden',
    askNo: 'Nicht verwenden',
    settingsLabel: 'Standort zu Fotos',
    settingsHint: 'Hat ein Foto keinen Aufnahmeort, gilt der Standort dieses Geräts – nur in der Nähe des Einsatzes',
    locatedLate: 'Foto mit Standort',
  },
  // running incident clock in the TopBar
  einsatzuhr: {
    title: 'Einsatzdauer – Beginn {t}',
    /** aria/labels for the tap-to-cycle clock modes */
    modeElapsed: 'Einsatzdauer',
    modeNow: 'Uhrzeit',
    modeStart: 'Einsatzbeginn',
  },
  // self-contained location picker for the intake wizard (MapPicker)
  mapPicker: {
    title: 'Standort auf Karte setzen',
    // the ‹ in the head: back to the form, the location as it was (no «Abbrechen» below, 30.10.2026)
    back: 'Zurück, ohne Standort zu übernehmen',
    // the line under the fixed pin while the centre's address is being looked up
    looking: 'Adresse wird gesucht …',
    confirm: 'Standort übernehmen',
  },
  // weather badge + popover (TopBar · WeatherBadge) — condition labels, cardinals, readout rows
  weather: {
    label: 'Wetter',
    details: 'Wetterdetails',
    // friendly catch-all error — raw fetch/server error texts never reach the UI
    unavailable: 'Wetterdaten zurzeit nicht verfügbar',
    from: 'aus',
    cardinals: ['N', 'NO', 'O', 'SO', 'S', 'SW', 'W', 'NW'] as string[],
    cardinalsLong: ['Nord', 'Nordost', 'Ost', 'Südost', 'Süd', 'Südwest', 'West', 'Nordwest'] as string[],
    windTitle: 'Wind {dir} ({deg}°)',
    detailsHint: ' – für Details tippen',
    windDir: 'Windrichtung',
    windSpeed: 'Windstärke',
    gust: 'Böen',
    precip: 'Niederschlag',
    station: 'Station',
    source: 'Quelle',
    meteoRadar: 'MeteoSchweiz Niederschlagsradar',
    // Target of the weather badge — the MeteoSchweiz radar page in the deployment's language
    // (every locale overrides with its own admin.ch variant). No coordinate deep link is
    // possible; {lat}/{lng} are substituted in case a future target accepts them.
    detailsUrl: 'https://www.meteoschweiz.admin.ch/service-und-publikationen/applikationen/niederschlag.html',
    conditions: {
      clear: 'Klar', fair: 'Heiter', partly: 'Teils bewölkt', overcast: 'Bedeckt',
      fog: 'Nebel', drizzle: 'Niesel', rain: 'Regen', snow: 'Schnee',
      rainShowers: 'Regenschauer', snowShowers: 'Schneeschauer', thunder: 'Gewitter', cloudy: 'Bewölkt',
    } as Record<string, string>,
    // The wind-shift Meldung (24.09.2026, D2). Its words are the server's Verlauf row
    // («Wind dreht: W → NO (286° → 66°) · Lüfter prüfen»); these two are its doors.
    windShiftOpen: 'Im Verlauf öffnen',
    windShiftDismiss: 'Ausblenden',
  },
  // The Karte's weather LAYER (components/WeatherLayer, backend app/weather_layer): the
  // MeteoSwiss radar in Ebenen and its floating pill.
  weatherLayer: {
    group: 'Wetter',
    radar: 'Niederschlag (Radar)',
    radarSub: 'MeteoSchweiz · letzte Stunde',
    attribution: 'Radar © MeteoSchweiz',
    radarTitle: 'Niederschlagsradar',
    play: 'Letzte Stunde abspielen',
    pause: 'Anhalten (zurück auf aktuell)',
    frameSlider: 'Radarbild wählen',
    frameAgo: 'vor {minutes} min',
    latest: 'aktuell',
    legendLight: 'schwach',
    legendUnit: 'mm/h · Radar-Schätzung',
    legendHeavy: 'stark',
    radarPending: 'Noch kein Radarbild – wird geladen.',
    radarUnavailable: 'Radar zurzeit nicht verfügbar.',
    stale: 'Stand {time} – veraltet',
  },
  // PDF rendering — status line in PdfScroller + first-load placeholder in PdfViewport (Plan)
  pdf: {
    loading: 'PDF wird geladen …',
    failed: 'PDF konnte nicht geladen werden.',
    retry: 'Erneut versuchen',
    // the reader's sections (PdfScroller · lib/pdfJumps): the PDF's own bookmarks, else its page
    // numbers – and the way OUT of the app: «Öffnen in …», the share sheet with the file (lib/pdfShare)
    jumps: 'Inhalt',
    page: 'Seite {n}',
    openIn: 'Öffnen in …',
    // WARUM es nicht ging – eine Zeile unter der Meldung, damit ein Gerät im Einsatz nicht
    // einfach «geht nicht» meldet. Zuordnung: lib/pdfDiagnosis.ts.
    reason: {
      stale: 'Die App läuft auf einer alten Version – App schliessen und neu öffnen.',
      offline: 'Keine Verbindung – das PDF ist auf diesem Gerät nicht gespeichert.',
      missing: 'Das PDF ist auf dem Server nicht mehr vorhanden.',
      denied: 'Die Anmeldung gilt nicht mehr – neu anmelden.',
      timeout: 'Der Server hat nicht geantwortet.',
      unsupported: 'Dieser Browser ist zu alt für die PDF-Anzeige.',
      unknown: 'Grund unbekannt.',
    },
  },
  // Einstellungen sheet (device prefs + synced per-incident settings)
  settings: {
    title: 'Einstellungen',
    deviceGroup: 'Gerät',
    colorScheme: 'Farbschema',
    // Two sliders, not one size: an unlinked Modul-2/3 sheet is a whole floor on one page and
    // needs far smaller symbols than the map. A georeferenced sheet follows Karte automatically.
    symbolSizeMap: 'Symbolgrösse auf der Karte',
    symbolSizeMapSub: 'Taktische Zeichen auf der Karte und verknüpften Modulplänen',
    symbolSizeBoard: 'Symbolgrösse in Modulen',
    symbolSizeBoardSub: 'Taktische Zeichen auf nicht verknüpften Modulplänen',
    symbolCaptions: 'Beschriftungen',
    symbolCaptionsSub: 'Kennwert unter dem Symbol',
    railLabels: 'Beschriftung der Werkzeugleisten',
    railLabelsSub: 'Wort unter jedem Zeichen in den beiden Leisten',
    // Gerätepräferenz, Standard AN (lib/prefs · keyHints): der Buchstabe auf jedem Feld beider Leisten
    keyHints: 'Tastenkürzel anzeigen',
    keyHintsSub: 'Buchstaben an den Werkzeugleisten – nur auf Geräten mit Tastatur und Maus.',
    captionsOff: 'Aus',
    captionsAuto: 'Auto',
    captionsAll: 'Alle',
    offlineRadius: 'Offline-Umkreis',
    offlineRadiusSub: 'Karte & Leitungen um den Einsatz',
    // Offline-Vorbereitung: automatic self-warm shortly after opening an Einsatz (installed app
    // only). Two states — see lib/prefs · offlineAuto for why there is no «nur WLAN» tier.
    offlineAuto: 'Offline-Vorbereitung',
    offlineAutoSub: 'Lädt Karte und Pläne kurz nach dem Öffnen des Einsatzes automatisch herunter',
    keepScreenOn: 'Bildschirm eingeschaltet lassen',
    keepScreenOnSub: 'Verhindert das Abdunkeln während des Einsatzes',
    // No «Führungsansicht» row any more (05.10.2026): it is the login's, set in the admin's
    // Benutzer (admin · members · elViewDefault), not a per-device switch.
    deviceFoot: 'Gilt nur auf diesem Gerät. Kleinerer Umkreis = schnellerer, kleinerer Offline-Download.',
    contactInterval: 'Atemschutz-Funkkontakt',
    grace: 'Nachfrist',
    funkkanal: 'Funkkanal',
    // per-device utility: the blank paper Erfassungsblatt (hand-fill fallback), generated
    // from the current roster + Mittel catalogue — same generator as the admin's
    utilityGroup: 'Vorlagen',
    blankSheet: 'Leeres Erfassungsblatt (PDF)',
    blankSheetSub: 'Papierblatt zum Handausfüllen',
    blankSheetDownload: 'Herunterladen',
    blankSheetFailed: 'PDF fehlgeschlagen – nochmals versuchen',
    feedbackRow: 'Rückmeldung geben',
    feedbackRowSub: 'Was umständlich war oder gefehlt hat',
    feedbackOpen: 'Schreiben',
  },
  // Rückmeldung — the feedback composer + the prompt after something went wrong. Nothing here
  // is sent automatically: the app writes the text, the operator sends it (see lib/feedbackReport).
  feedback: {
    title: 'Rückmeldung',
    // shown on the launcher when a trouble event is waiting to be asked about
    promptTitle: 'Kurz gefragt',
    promptDismiss: 'Nicht jetzt',
    promptOpen: 'Kurz schildern',
    // one per TroubleKind — the prompt asks about the specific thing that happened
    promptFor: {
      crashLoop: 'Die App ist in einem Einsatz mehrmals abgestürzt. Was hast du gerade gemacht?',
      crash: 'Die App ist zuletzt einmal abgestürzt. Was hast du gerade gemacht?',
      renderStorm: 'Die App hat sich in einem Einsatz festgerechnet – vermutlich war sie träge oder der Akku schnell leer. Was war gerade offen?',
      storageFull: 'Auf diesem Gerät war der Speicher voll. Ist dabei etwas verlorengegangen?',
      syncConflict: 'Zwei Geräte hatten unterschiedliche Stände. Hat am Ende etwas gefehlt?',
    },
    // the same labels, in the report itself
    kinds: {
      crashLoop: 'wiederholter Absturz im selben Einsatz',
      crash: 'Absturz der Oberfläche',
      renderStorm: 'Dauerlast der Oberfläche',
      storageFull: 'Gerätespeicher voll',
      syncConflict: 'Sync-Konflikt beim Zusammenführen',
    },
    subject: 'Rückmeldung',
    intro: 'Was ist passiert, und was hättest du erwartet? Ein, zwei Sätze genügen.',
    placeholder: 'z. B. «Trupp auf Rückweg gesetzt, dann war der Bildschirm weiss.»',
    techTitle: 'Das wird mitgeschickt',
    techNote: 'Sonst nichts – keine Einsatzdaten, keine Adressen, keine Namen. Die App macht '
      + 'von sich aus keinen Screenshot.',
    // The two routes. Nothing is transmitted by the app itself any more, so these are not
    // «alternatives to sending» – they are the sending, and the operator picks which one.
    routeGithub: 'Als GitHub-Issue melden',
    routeGithubBadge: 'empfohlen',
    routeGithubNote: 'Öffnet ein vorausgefülltes Formular. Du siehst den Stand der Meldung '
      + 'später und wirst benachrichtigt, wenn sie erledigt ist. Braucht ein GitHub-Konto.',
    routeMail: 'Per E-Mail schicken',
    routeMailBadge: 'ohne Konto',
    routeMailNote: 'Geht immer, auch ohne GitHub. Antwort kommt direkt per Mail zurück.',
    next: 'Weiter',
    // The Diagnose-Datei. `{n}` is the number of recorded errors, `{name}` the filename that
    // landed in Downloads – naming it is the difference between «hänge die Datei an» and a
    // person hunting through a folder.
    diagNote: 'Beide Wege: die Diagnose-Datei ({n}) wird beim Weiterklicken gesichert – im '
      + 'Issue bzw. in der Mail anhängen. Ohne sie fehlt die eigentliche Fehlermeldung.',
    diagNoteEmpty: 'Beide Wege: es sind zurzeit keine Fehlerprotokolle aufgezeichnet. '
      + 'Beschreib einfach, was passiert ist.',
    diagCount: '{n} Fehlerprotokolle',
    diagCountOne: '1 Fehlerprotokoll',
    diagLine: 'Fehler: ',
    diagSaved: 'Diagnose-Datei «{name}» gesichert – bitte anhängen.',
    diagFailed: 'Diagnose-Datei liess sich nicht erstellen – die Meldung geht trotzdem.',
    privacy: 'Nichts wird automatisch gesendet. Du entscheidest, ob, wie und an wen.',
    close: 'Schliessen',
    tech: {
      version: 'Version:',
      locale: 'Sprache:',
      device: 'Gerät:  ',
      viewport: 'Fenster:',
      network: 'Netz:   ',
      event: 'Vorfall:',
      online: 'online',
      offline: 'offline',
      noDescription: '(keine Beschreibung)',
    },
  },
  // Offline-Bereitschaft readiness diagnostics
  offline: {
    title: 'Offline-Bereitschaft',
    // Shown in a browser tab instead of the readiness list: a tab is no reliable offline state
    // (iOS clears caches after days without use, and the tab then has to still be open at all).
    // Rather than claim a Bereitschaft that won't hold at 3am, the card says what is missing and
    // leads to the install – or says that there is none here.
    browserTitle: 'Offline zuverlässig als installierte App',
    browserBody: 'Im Browser ist die Offline-Speicherung nicht dauerhaft gewährleistet. Karten, Pläne und Leitungen können vom Browser entfernt werden. Für einen verlässlichen Offline-Betrieb KP Front als App installieren.',
    // Platforms with no install path (desktop Firefox …) — say honestly that there is nothing to
    // install here, instead of pointing at instructions that don't exist.
    browserNoInstall: 'Dieses Gerät bietet keine Installation an. Für den Einsatz offline KP Front auf dem Tablet oder Handy installieren.',
    syncedAgo: 'Einsatzdaten {ago} synchronisiert',
    offline: 'Offline – lokal gespeichert',
    pending: 'Wird gespeichert …',
    error: 'Sync-Fehler – lokal gespeichert',
    agoNever: 'noch nicht',
    agoJustNow: 'gerade eben',
    agoMin: 'vor {n} Min',
    agoHour: 'vor {n} Std',
    checking: 'wird geprüft …',
    ready: 'bereit',
    notLoaded: 'nicht geladen',
    loading: 'wird geladen …',
    rowSymbols: 'Symbole',
    rowHazmat: 'Gefahrgut (UN/ADR)',
    rowMap: 'Karte',
    noLayer: 'keine Ebene',
    rowPlans: 'Pläne',
    noObject: 'kein Objekt',
    rowLeitung: 'Referenzebenen',
    geoAllReady: 'alle {n} bereit',
    geoSome: '{cached}/{total} geladen',
    rowWeather: 'Wetter',
    weatherUnreachable: 'nicht erreichbar',
    onlineOnly: 'nur online',
    rowPersonnel: 'Personal',
    personnelCount: '{n} Personen',
    rowObjectSearch: 'Objektsuche',
    // Device storage — the readiness row that never existed: a full device stores NOTHING
    // offline, no matter how green every other row is.
    rowStorage: 'Gerätespeicher',
    storageFree: '{size} frei',
    storageUnknown: 'Gerät meldet keinen Speicherstand',
    storageFullShort: 'Voll – nichts wird lokal gesichert',
    storageFull: 'Speicher voll – Änderungen sind nicht lokal gesichert',
    // Pre-flight check for «Alles für offline laden»: the offline stock and the Einsatzrapport
    // share the same storage, so a map download must not crowd the Rapport out.
    dlTightTitle: 'Wenig Speicher auf diesem Gerät',
    dlTightMsg: 'Der Download braucht ≈ {need}, frei sind {free}. Reduziert wird das ganze Gebiet geladen, aber weniger detailliert (etwa {pct} % der Kartenkacheln). Der Einsatzrapport behält so Platz.',
    dlTightConfirm: 'Reduziert laden',
    dlNoSpace: 'Zu wenig Speicher für den Offline-Vorrat (nur {free} frei). Bitte Platz auf dem Gerät freigeben.',
    loadingForOffline: 'Wird für offline geladen …',
    // aborts the running download; the tiles already stored stay stored
    cancel: 'Abbrechen',
    loadAll: 'Alles für offline laden',
    foot: 'Lädt Karte, Pläne, Symbole und Leitungen für diesen Einsatz auf dieses Gerät. Wetter und Objektsuche brauchen eine Verbindung und sind offline nicht verfügbar.',
    // workspace load gate (lib/workspace sanitizeWorkspace): honest reporting, never silent
    wsDropped: '{n} beschädigte Einträge beim Laden übersprungen',
    // a blob from a newer build: this build fetches it and reloads by itself; the row stands only
    // when it cannot (offline) — the view is read-only meanwhile (sweep 30.10.2026 #19)
    wsNewer: 'Neuere App-Version nötig',
    wsNewerSub: 'Bis dahin nur ansehen – Änderungen sind gesperrt.',
    wsNewerAction: 'Aktualisieren',
    // both stand in the Meldeleiste while true (S3, 20.10.2026); the skipped-entries row has the ✕
    wsDroppedDismiss: 'Ausblenden',
    // LayerPanel offline-download button + the App map-download toasts
    // Drei Ergebnisse, drei Nachrichten – nicht eine Nachricht mit unterschiedlichen Zahlen.
    // «Karte offline verfügbar (0 Kacheln)» war grün, mit Haken, für einen Download, der nichts
    // geladen hatte; die Zahl in der Klammer, die alles widerlegte, liest um 03:10 niemand.
    dlDone: 'Karte offline bereit – {n} Kacheln',
    dlDoneCapped: 'Karte offline bereit – Ausschnitt begrenzt, {n} Kacheln',
    dlPartial: 'Teilweise geladen – {n} von {total}. Am Rand des Ausschnitts fehlt die Karte.',
    // begrenzt UND unvollständig: ohne den Zusatz versprach «Weiterladen» Kacheln, die der
    // Speicher-Deckel gleich wieder ausschliesst
    dlPartialCapped: 'Teilweise geladen – {n} von {total}, Ausschnitt begrenzt. Am Rand fehlt die Karte.',
    dlNone: 'Nichts geladen – kein Netz. Die Karte ist am Einsatzort nicht verfügbar.',
    // alles 404, nichts angekommen: die Quelle HAT geantwortet – «kein Netz» wäre die falsche
    // Diagnose. Bewusst ohne «Nochmals»: dieselben 404 kämen wieder.
    dlNoCoverage: 'Nichts geladen – die Kartenquelle kennt dieses Gebiet nicht. Kartenebene bzw. Kachel-URL prüfen.',
    dlContinue: 'Weiterladen',
    dlRetry: 'Erneut versuchen',
    dlFailed: 'Offline-Download fehlgeschlagen',
  },
  // App empty state — shown when no incident is open (viewer vs. editor variants)
  emptyApp: {
    title: 'Kein offener Einsatz',
    bodyViewer: 'Zurzeit ist kein Einsatz aktiv.',
    // ⚠️ The NEUTRAL sentence is the default; the one naming the Alarmquelle is the exception.
    // «übernimm einen Divera-Alarm» was shown to every station — including the ones running on
    // another source, and the ones entering every Einsatz by hand, who were being pointed at a
    // product they do not have. Which name (if any) appears comes from
    // deploymentConfig · alarmProviderName().
    bodyEditor: 'Eröffne einen Einsatz.',
    bodyEditorAlarm: 'Eröffne einen Einsatz oder übernimm einen {provider}-Alarm.',
    history: 'Verlauf',
  },
  // «Neuer Einsatz» banner — announces an Einsatz that appeared mid-session (auto-open, a
  // generic incoming alarm, or a take on another device); never switches automatically.
  incidentAlert: {
    kicker: 'Neuer Einsatz',
    switch: 'Wechseln',
    open: 'Öffnen',
    // the ✕'s name — it hides this Einsatz's row for good on this device (useIncidentWatch),
    // so it is the one Meldeleiste dismiss word, not «Später» (20.10.2026, S10)
    dismiss: 'Ausblenden',
  },
} as const
