// German copy · incident and standing links, shared positions.
// One slice of the canonical `de` catalogue, assembled in ../de.ts — read the rules at the
// top of that file before adding or renaming a key here.

export const linksCopy = {
  // Einsatz-Link (/l/<token>) — the view opened straight out of the alert message: no login, one
  // Einsatz, read-only. Whoever reads this is standing somewhere in the dark at night with
  // exactly this one screen – so every message says what to do now.
  incidentLink: {
    opening: 'Einsatz wird geöffnet …',
    // A 404 can be a race: the alert reaches the phone faster than the Einsatz reaches kp-front.
    // This is the only state that resolves itself.
    pendingTitle: 'Einsatz noch nicht verfügbar',
    pendingHint: 'Der Alarm ist eben erst eingetroffen. Wird automatisch nochmals versucht …',
    notReadyTitle: 'Dieser Einsatz ist nicht abrufbar.',
    notReadyHint: 'Der Link gilt nur, solange der Einsatz läuft. Kam der Alarm eben erst, ist der Einsatz vielleicht noch nicht bereit – sonst bei der Einsatzleitung melden.',
    invalidTitle: 'Dieser Link gilt nicht mehr.',
    invalidHint: 'Öffne den Link direkt aus der aktuellen Alarmmeldung.',
    disabledTitle: 'Einsatz-Links sind bei dieser Feuerwehr nicht freigeschaltet.',
    disabledHint: 'Die Einsatzleitung kann sie in der Konfiguration aktivieren.',
    offlineTitle: 'Kein Empfang',
    offlineHint: 'Ohne Verbindung lässt sich der Einsatz nicht öffnen.',
    errorTitle: 'Der Server antwortet nicht.',
    errorHint: 'Bleibt es dabei: bei der Einsatzleitung melden.',
    retry: 'Erneut versuchen',
    // an Atemschutz-Link reloaded while its Einsatz is closed (staging r6, F2): the page asks
    // once a minute and opens the board by itself after «Wieder öffnen»
    closedTitle: 'Einsatz abgeschlossen',
    closedAt: 'Abgeschlossen um {time}.',
    closedHint: 'Wird der Einsatz wieder geöffnet, erscheint die Tafel hier von selbst.',
    // the Einsatz could not be loaded after opening the link (signal gone) – the landing page
    // says so instead of showing an empty incident list
    unavailable: 'Dieser Einsatz ist gerade nicht abrufbar. Seite neu laden, sobald du wieder Empfang hast.',
  },
  // Standing links (Stations-Terminal /terminal + fixe Atemschutz-URL /l/s…): the states such
  // a page can be in besides «the app» — src/link/StandingApp renders them. Both bind to
  // «whichever Einsatz is open», so «kein Einsatz» and «mehrere Einsätze» are ordinary states
  // here, not failures.
  standingLink: {
    idleTitle: 'Kein laufender Einsatz',
    /* ⚠️ EIN Satz je Fläche, und sie sagen verschiedene Dinge (09.09., Entwurf B). Das Terminal
     * ist ein Bildschirm, der von selbst umschaltet – niemand steht davor und wartet. Der
     * laminierte QR ist ein Stück Papier an der Überwachungstafel: wer davorsteht, hat gerade
     * gescannt und will wissen, warum nichts kommt. Der gemeinsame `idleHint` sagte beiden das
     * eine («sobald ein Alarm eingeht»), was auf dem Papier schlicht die falsche Antwort war –
     * eine Übung ist kein Alarm, und der Code gilt für sie genauso.
     * ⚠️ NICHT hier: «Die Karte hängen lassen …». Vom Maintainer am 09.09. gestrichen – die
     * Karte hängt bereits, und ein Satz, der das Offensichtliche beruhigt, liest sich, als
     * gäbe es einen Grund zur Sorge. */
    idleHintTerminal: 'Geht ein Alarm ein, wechselt dieser Bildschirm von selbst auf den Einsatz.',
    idleHintAs: 'Sobald ein Einsatz oder eine Übung läuft, öffnet dieser Code die Atemschutzüberwachung.',
    // Die Kopfzeile des Wartezustands: welche Fläche das hier ist. Beim Terminal hinter dem
    // Namen der Wehr, beim QR allein – wer den Code scannt, steht in der eigenen Station.
    terminalKicker: 'Stations-Terminal',
    // Der Beleg, dass die Anzeige nicht eingefroren ist: der Zeitstempel des letzten Polls
    // (STANDING_POLL_MS, 10 s). Ohne ihn ist ein ruhiger Bildschirm nicht von einem toten zu
    // unterscheiden – und genau das ist die Frage, die vor einem leeren Terminal aufkommt.
    checkedLabel: 'Zuletzt geprüft',
    chooseTitle: 'Mehrere Einsätze laufen',
    chooseHint: 'Wähle, welchen Einsatz diese Anzeige zeigen soll.',
    exerciseTag: 'Übung',
    notEnrolledTitle: 'Dieses Gerät ist nicht als Stations-Terminal eingerichtet.',
    notEnrolledHint: 'In der Verwaltung unter «Links & Zugänge» den Einrichtungs-Link erzeugen und auf diesem Gerät öffnen.',
    asInvalidTitle: 'Dieser Atemschutz-Code gilt nicht mehr.',
    asInvalidHint: 'Der Code wurde erneuert. In der Verwaltung den aktuellen QR-Code drucken und aufhängen.',
    disabledTitle: 'Diese Funktion ist nicht freigeschaltet.',
    disabledHint: 'Die Verwaltung kann sie unter «Links & Zugänge» aktivieren.',
  },
  // Standort teilen — the question put to your own phone and what the pill says afterwards.
  // Deliberately without marketing text: who sees what and when is spelled out in full, because
  // that is exactly the question somebody asks at 3am before tapping «Ja».
  sharePosition: {
    askTitle: 'Standort teilen?',
    askBody: 'Der Kommandoposten sieht dann auf der Karte, wo du bist – damit klar ist, wer wo arbeitet (z. B. beim Wassertransport) und wer erreichbar ist.',
    askWho: 'Sichtbar nur für den Kommandoposten. Andere, die den Einsatz-Link haben, sehen deinen Standort nicht.',
    askHowLong: 'Nur solange dieser Einsatz läuft. Beim Abschluss wird der Standort gelöscht.',
    askBackground: 'Wenn du das Handy sperrst, wird nichts mehr übermittelt – die letzte Position bleibt mit Zeitangabe stehen.',
    // No more «du wirst nur einmal gefragt»: the permission persists, but the sharing itself has
    // to be switched on deliberately for every Einsatz (compass menu).
    askAgain: 'Bei jedem Einsatz musst du das Teilen selbst einschalten – es startet nie von allein.',
    pickTitle: 'Wer bist du?',
    pickHint: 'Damit dein Punkt auf der Karte einen Namen hat.',
    // Bei jedem neuen Einsatz wird nochmals gefragt: auf einem Tablet, das herumgereicht wird,
    // stünde sonst der Name des letzten Einsatzes auf der Karte.
    pickAgain: 'Neuer Einsatz – bitte bestätige nochmals, wer du bist. Der zuletzt gewählte Name steht zuoberst.',
    pickLast: 'zuletzt',
    search: 'Name suchen …',
    yes: 'Ja, Standort teilen',
    no: 'Nein, danke',
    // compass menu: the one row that switches sharing on and off
    menuOff: 'Standort teilen',
    menuOn: 'Standort teilen – ein',
    // Reasons why the row currently doesn't work. It does NOT disappear — a control that
    // vanishes into thin air is indistinguishable from a feature that was never built.
    menuClosed: 'Nur solange der Einsatz läuft',
    menuDemo: 'Demo: simuliert – dein Standort wird nicht abgefragt',
    // While sharing: stopping has to be stated just as plainly as starting — a device sending a
    // person's location must not hide the way to stop.
    menuOnHint: 'Tippen zum Beenden',
    // pill in the header
    on: 'Standort geteilt',
    starting: 'Standort wird gesucht …',
    paused: 'Standort pausiert',
    pausedHint: 'Das Handy übermittelt nichts, solange die App im Hintergrund oder das Display gesperrt ist. App wieder öffnen, dann läuft es weiter.',
    denied: 'Standort gesperrt',
    deniedHint: 'Die Standortfreigabe ist für diese Seite blockiert. Das lässt sich nur in den Browser-Einstellungen wieder erlauben.',
    taken: 'Name bereits vergeben',
    takenHint: 'Ein anderes Gerät teilt unter diesem Namen. Wähle deinen Namen neu oder bitte die Einsatzleitung, den alten Standort zu entfernen.',
    failing: 'Standort kommt nicht an',
    failingHint: 'Das Handy findet deinen Standort, aber der Server nimmt ihn nicht entgegen – meist fehlender Empfang. Es wird weiter versucht.',
    // A reason for still searching, not a state of its own: indoors/in a cellar a phone happily
    // reports an accuracy of several hundred metres, and such a dot on the map would be a lie.
    impreciseHint: 'Der Empfang ist noch zu ungenau für einen Punkt auf der Karte. Draussen wird es meist innert Sekunden besser.',
    lastAt: 'Zuletzt {t}',
    stop: 'Standort nicht mehr teilen',
    change: 'Namen ändern',
    // Einstellungen: ONLY the permission, not the sharing itself. Switching it on happens in the
    // compass menu on the map, freshly for every Einsatz.
    settingsLabel: 'Standort verwenden',
    settingsHint: 'Erlaubt diesem Gerät, deinen Standort zu verwenden. Geteilt wird erst, wenn du es auf der Karte einschaltest.',
    settingsAs: 'Als {name}',
    // Einstellungen: the name row under «Standort verwenden» — the value is the button
    settingsName: 'Name auf der Karte',
    settingsNameSub: 'So sieht dich der Kommandoposten – tippen zum Ändern',
  },
  // Anwesenheit list: live position next to the name. Deliberately neutral – far away is the
  // normal case (Wassertransport), not a warning.
  livePosition: {
    chip: '{d} · vor {n} min',
    chipNow: '{d} · jetzt',
    atScene: 'Am Einsatzort',
    tapHint: 'Auf der Karte zeigen',
  },
  // Präsentationsmodus (docs/presentation.md): the «Präsentieren» card in «Einsatz teilen» and the
  // pill bottom-centre. «Zeigen» is the switch that turns a tap into a fading pointer and a drag into a
  // fading line.
  presentation: {
    title: 'Präsentieren',
    lede: 'Wer diesen Link oder den Einsatz offen hat, folgt deinem Bildschirm. Alle können zeigen, nichts wird gespeichert.',
    start: 'Starten',
    runningMine: 'Du präsentierst gerade.',
    runningOther: '{name} präsentiert gerade.',
    takeOver: 'Übernehmen',
    needsServer: 'Braucht Verbindung zum Server.',
    youPresent: 'Du präsentierst',
    followersNone: 'noch niemand folgt',
    followersOne: '1 folgt',
    followersMany: '{n} folgen',
    presents: '{name} präsentiert',
    follow: 'Folgen',
    following: 'Folgst',
    zeigen: 'Zeigen',
    end: 'Beenden',
    leave: 'Nicht mehr folgen',
    followAgain: 'Wieder folgen',
    // the × on a ring's or a line's name: takes that mark off every screen (owner, 09.11.2026)
    unmark: 'Ausblenden',
    hint: 'Zeigen ist an – tippen setzt einen Punkt, ziehen zeichnet eine Linie, verschieben mit zwei Fingern',
    link: 'Link',
    me: 'Ich',
    askName: 'Dein Name für die anderen',
    namePlaceholder: 'Vorname Name',
    pill: 'Präsentation',
    startFailed: 'Präsentation nicht gestartet – braucht Verbindung zum Server.',
    endFailed: 'Präsentation nicht beendet – nochmals versuchen.',
    full: 'Präsentation voll – zu viele Teilnehmende über einen Link. Später nochmals «Folgen».',
  },
} as const
