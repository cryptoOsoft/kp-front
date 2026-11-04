// German copy · incident switcher, archive, history, Abschluss, data sources, replay.
// One slice of the canonical `de` catalogue, assembled in ../de.ts — read the rules at the
// top of that file before adding or renaming a key here.

export const incidentCopy = {
  // TopBar incident switcher dropdown
  incidentSwitcher: {
    noIncident: 'Kein Einsatz',
    savedAt: 'Gespeichert um {t}',
    // the card's clock pill (27.09.2026, slim sweep · mockup 10): the glyph is the label, the
    // full sentence is its title (startedFull)
    startedRow: '{t} · {d}',
    startedFull: 'Einsatzbeginn {t} · {d}',
    saved: 'Gespeichert',
    badgePending: 'Nicht synchronisiert – wird gespeichert',
    badgeOffline: 'Offline – lokal gespeichert, wird synchronisiert sobald wieder verbunden',
    badgeError: 'Synchronisierung fehlgeschlagen – lokal gespeichert, wird erneut versucht',
    // Storage full: the other states promise «lokal gespeichert» – and that is exactly what does
    // NOT hold here, the changes only live for this app session.
    badgeStorage: 'Speicher voll – Änderungen sind NICHT lokal gesichert und gehen beim Schliessen verloren',
    offlineShort: 'Offline',
    errorShort: 'Sync-Fehler',
    storageShort: 'Speicher voll',
    // …and its Meldeleiste row (S1, 20.10.2026): the state that loses work says so where messages stand
    storageMeldung: 'Speicher voll – Änderungen nicht lokal gesichert',
    storageMeldungSub: 'App offen lassen und Einträge sichern – beim Schliessen gehen sie sonst verloren.',
    // one-shot warning toasts (useIncidentSync) — once per episode
    syncErrorToast: 'Synchronisierung fehlgeschlagen – Änderungen sind lokal gespeichert.',
    syncOfflineToast: 'Immer noch offline – Änderungen werden lokal gespeichert.',
    // clock skew (useIncidentSync · X-Server-Time): device-local timestamps feed the legal
    // record, so a clock minutes off is said once per episode — same wording as the capture
    // surface's skew line (capture.clockSkew)
    clockSkewToast: 'Die Uhr dieses Geräts weicht um {n} Minuten ab – erfasste Zeiten prüfen.',
    // Boot: the incident list came out of the offline cache
    bootOffline: 'Offline – gespeicherte Daten werden angezeigt.',
    // Boot: the server REFUSED the list (not silence — that takes the cached list above); the
    // launcher then shows no Einsätze and this says why
    bootListFailed: 'Einsatzliste konnte nicht geladen werden',
    // A human's open (launch card / switcher / banner / Verlauf) failed and the server gave no
    // usable reason of its own (App · openIncident)
    openFailed: 'Einsatz konnte nicht geöffnet werden',
    // …because the server could not be asked and no workspace is cached on this device
    openFailedNoCache: 'Dieser Einsatz ist auf diesem Gerät nicht gespeichert – Verbindung nötig',
    syncNow: 'Jetzt synchronisieren',
    // The button used to run silently: on an already-synced Einsatz — the normal case — a tap
    // looked exactly like no tap at all. Now the icon spins while it runs and a message says
    // what came of it.
    syncDone: 'Alles synchronisiert',
    syncFailedToast: 'Synchronisieren fehlgeschlagen – Änderungen bleiben lokal gespeichert.',
    // group titles in the menu: this Einsatz first (its card), then WHICH Einsatz, then the app.
    incidents: 'Einsätze',
    app: 'App',
    // …und die Tür zu allem, was vorbei ist: im Menü stehen nur laufende Einsätze.
    allIncidents: 'Alle Einsätze',
    report: 'Einsatzrapport',
    // Correct Adresse, Kategorie, Stichwort — the same form as when opening. Also sits in the
    // Rapport («Aus den Einsatzdaten › Bearbeiten»); in the menu, because a wrong location gets
    // noticed long before anybody opens the Rapport.
    editMeta: 'Einsatzdaten bearbeiten',
    archive: 'Einsatz abschliessen',
    // Kurzformen für die Aktionen IN der Karte des aktiven Einsatzes: die Karte nennt den
    // Einsatz schon in der Titelzeile, das Wort davor wäre dreimal dasselbe. Die vollen
    // Beschriftungen bleiben als title/aria-label an den Knöpfen.
    editMetaShort: 'Bearbeiten',
    archiveShort: 'Abschliessen',
    // der Zähler schon im Menü, damit die Prüfung sichtbar ist, bevor jemand drückt
    archiveOpen: '{n} offen',
    // «Teilen» in der Karte des aktiven Einsatzes — die zweite Tür zum Einsatz-Link, der bis
    // 01.09. nur im Rapport stand. Mitten im Einsatz will ihn jemand einer Nachbarwehr
    // hinhalten und nicht dafür die Abschluss-Fläche öffnen. Gleiche Fläche wie dort.
    share: 'Einsatz teilen',
    shareShort: 'Teilen',
    noOpenIncidents: 'Keine offenen Einsätze',
    logout: 'Abmelden',
    // «Abmelden» ALWAYS asks (23.09.2026, lib/logoutConfirm): afterwards this device opens no
    // Einsatz without a PIN. Offline and/or with something unsent, the SAME card adds what it
    // costs on top — one ask, not a second dialog model for the expensive case.
    logoutTitle: 'Abmelden?',
    logoutMsg: 'Danach öffnet dieses Gerät Einsätze erst wieder nach einer Anmeldung mit PIN.',
    logoutOffline: 'Eine neue Anmeldung ist erst wieder mit Netz möglich – bis dahin öffnet dieses Gerät keinen Einsatz.',
    logoutUnsyncedOne: '1 Eintrag ist noch nicht übertragen. Er bleibt auf diesem Gerät und wird gesendet, sobald du dich wieder anmeldest.',
    logoutUnsyncedMany: '{n} Einträge sind noch nicht übertragen. Sie bleiben auf diesem Gerät und werden gesendet, sobald du dich wieder anmeldest.',
    // …where only the Einsatz itself (Karte, Pläne, lists) is still unsent, no countable entry
    logoutUnsyncedChanges: 'Änderungen sind noch nicht übertragen. Sie bleiben auf diesem Gerät und werden gesendet, sobald du dich wieder anmeldest.',
    appVersion: 'App-Version (Build)',
  },
  // Persistentes Band, solange ein abgeschlossener Einsatz nur-lesend offen ist (ArchivedBanner).
  // ⚠️ EIN WORTPAAR für den ganzen Lebenslauf: abschliessen / wieder öffnen. «Archiviert» und
  // «reaktivieren» waren zwei weitere Wörter für dieselbe Sache – drei Vokabeln für einen
  // Zustandswechsel, den man im Einsatz nicht nachschlagen geht. «Archiv» bleibt frei für das,
  // was es beschreibt: die Liste.
  archived: {
    title: 'Einsatz abgeschlossen',
    // r3, F10: der Rapport bleibt nach dem Abschluss korrigierbar (Nachträge) – alles andere nicht
    hint: 'Der Rapport bleibt korrigierbar (Nachträge) – für alles andere wieder öffnen.',
    // …und wer gar nichts wieder öffnen kann (Link-Sitzungen)
    hintViewOnly: 'Nur ansehen.',
    // …and who corrects the Rapport but reopens nothing (the el, a Führungsansicht)
    hintRapport: 'Der Rapport bleibt korrigierbar (Nachträge).',
    back: 'Zurück',
    reactivate: 'Wieder öffnen',
    // offline (05.10.2026): «Wieder öffnen» is the server's call (it writes the reopen boundary
    // the Atemschutz clocks restart from), so it is said up front, not discovered by a failure
    reactivateOffline: 'Braucht Verbindung zum Server',
    // the Einsatz card's closed pill (27.10.2026, sweep #5 B): the CURRENT close time, a tap opens the exits
    closedAt: 'Abgeschlossen {t}',
    // …and «Wieder öffnen» while it runs (#6): the reopen is three server round trips
    reopening: 'Wird geöffnet …',
    reactivateNeedsServer: 'Wieder öffnen braucht Verbindung zum Server – der Einsatz bleibt abgeschlossen. Online nochmals versuchen.',
    // N3 (25.09.2026): das Einsatz wurde auf einem ANDEREN Gerät abgeschlossen, während es hier
    // offen war — die Meldeleiste sagt, warum der Bildschirm eben nur-lesend geworden ist.
    closedElsewhere: 'Einsatz wurde auf einem anderen Gerät abgeschlossen ({t})',
    closedElsewhereSub: 'Der Rapport bleibt korrigierbar (Nachträge) – für alles andere wieder öffnen.',
    // …und was dieses Gerät danach noch schicken wollte (ein Kontakt, eine Tafel-Änderung von
    // offline): nicht übernommen, aber nicht verloren.
    closedRefusedOne: '1 Eintrag dieses Geräts kam nach dem Abschluss und wurde nicht mehr übernommen. Er bleibt auf diesem Gerät gespeichert.',
    closedRefused: '{n} Einträge dieses Geräts kamen nach dem Abschluss und wurden nicht mehr übernommen. Sie bleiben auf diesem Gerät gespeichert.',
    closedExport: 'Einträge sichern',
    closedDismiss: 'Ausblenden',
    // …und der Weg zurück: auf einem anderen Gerät «Wieder öffnen» — der Bildschirm ist wieder live
    reopenedElsewhere: 'Einsatz wurde auf einem anderen Gerät wieder geöffnet ({t})',
    // r3, F10: der Rapport eines abgeschlossenen Einsatzes bleibt korrigierbar – und sagt es
    rapportClosedHint: 'Einsatz abgeschlossen – Änderungen am Rapport erscheinen als Nachträge.',
    // …und die Atemschutz-Link-Tafel, deren Halter nichts wieder öffnen kann
    linkClosedTitle: 'Einsatz abgeschlossen – diese Tafel zeigt nur noch an',
    // D1: der Link wurde für seinen eigenen Einsatz abgelehnt (widerrufen) – nichts mehr annehmen
    linkRefusedTitle: 'Dieser Link gilt nicht mehr – diese Tafel zeigt nur noch an',
    reopenedElsewhereSub: 'Wieder bearbeitbar – spätere Einträge erscheinen als Nachträge.',
    // was beim Abschluss zurückgestellt wurde, geht jetzt raus – als Nachtrag
    reopenedParkedOne: 'Wieder bearbeitbar. 1 Eintrag dieses Geräts, der nach dem Abschluss nicht übernommen wurde, wird jetzt nachgesendet – als Nachtrag.',
    reopenedParked: 'Wieder bearbeitbar. {n} Einträge dieses Geräts, die nach dem Abschluss nicht übernommen wurden, werden jetzt nachgesendet – als Nachträge.',
  },
  // Einsätze history list
  history: {
    title: 'Einsätze',
    empty: 'Noch keine Einsätze.',
    emptySub: 'Eröffnete und abgeschlossene Einsätze erscheinen hier.',
    // a viewer's window (docs/roles-and-access.md · «The viewer's window»): the list's foot
    // line, and its empty state – «Noch keine Einsätze» was false after a quiet week
    windowNote: 'Hier stehen die laufenden Einsätze und die der letzten {n} Tage.',
    windowNoteOne: 'Hier stehen die laufenden Einsätze und die des letzten Tages.',
    windowNoteRunning: 'Hier stehen nur die laufenden Einsätze.',
    emptyWindow: 'Keine Einsätze.',
    noLocation: 'ohne Ort',
    searchPlaceholder: 'Einsatz suchen …',
    groupOpen: 'Offen',
    groupToday: 'Heute',
    groupWeek: 'Letzte 7 Tage',
    offlineNote: 'Offline: Ansehen geht, Abschliessen und Wieder öffnen brauchen Verbindung zum Server.',
    // a running Einsatz's span in its row: «seit 14:00» (no end yet)
    since: 'seit {t}',
    reactivate: 'Wieder öffnen',
    reactivateConfirmTitle: 'Einsatz wieder öffnen',
    reactivateConfirmMsg: 'Der Einsatz wird wieder geöffnet und ist bearbeitbar. Spätere Änderungen erscheinen im Verlauf und Rapport als Nachträge.',
    reactivateConfirmBtn: 'Wieder öffnen',
    statusArchived: 'Abgeschlossen',
    archiveConfirmTitle: 'Einsatz abschliessen',
    archiveConfirmMsg: 'Der Einsatz wird abgeschlossen und das Einsatzende festgehalten. Spätere Ergänzungen erscheinen im Verlauf und Rapport als Nachträge.',
    archiveConfirmBtn: 'Abschliessen',
    // hard delete — Übungen only (the backend rejects everything else); deliberately NOT
    // undoable, hence the danger confirm instead of confirm-with-undo
    deleteExercise: 'Löschen',
    deleteConfirmTitle: 'Übung löschen',
    deleteConfirmMsg: 'Die Übung wird mit allen Daten (Verlauf, Fotos, Rapport) endgültig gelöscht. Das kann nicht rückgängig gemacht werden.',
    deleteConfirmBtn: 'Endgültig löschen',
    deleted: 'Übung gelöscht',
    // quick filters over the list (27.10.2026): Ernstfall | Übung, one Einsatzart, Rapport offen
    filterAria: 'Einsätze filtern',
    filterKindHead: 'Ernstfall / Übung',
    filterAll: 'Alle',
    filterReal: 'Ernstfall',
    filterExercise: 'Übung',
    filterType: 'Einsatzart',
    filterRapportOpen: 'Rapport offen',
    filterNoHits: 'Kein Einsatz passt zu diesen Filtern.',
    deleteFailed: 'Löschen fehlgeschlagen',
  },
  // Abschluss-Assistent — the guided closing ritual over the EXISTING views. Every small
  // incident is a training run on the big-incident tool (practice rationale, 2026-07-08).
  abschluss: {
    leftEarly: ' · bis {t}',
    steps: {
      zeiten: 'Einsatzende',
      anwesenheit: 'Anwesenheit',
      mittel: 'Material',
      einsatzleiter: 'Einsatzleiter',
      kontaktperson: 'Kontaktperson',
      kurzbericht: 'Kurzbericht',
      rueckmeldung: 'Rückmeldung ELZ',
      abweichungen: 'Abweichungen',
    },
    ausgerueckt: 'Ausgerückt',
    ende: 'Einsatzende',
    // «anwesend», the word the chooser and the Anwesenheit head use for this count (29.09.2026) —
    // «erfasst» beside «anwesend» read as two different numbers
    personen: '{n} anwesend',
    von: 'von',
    bis: 'bis',
    mittelCount: (n: number) => (n === 1 ? '1 Position' : `${n} Positionen`),
    mittelNone: 'Nichts verwendet',
    complete: 'Einsatz abschliessen',
    backToRapport: 'Zurück zum Rapport',
    confirmTitle: 'Einsatz abschliessen',
    confirmMsg: 'Der Rapport wird als abgeschlossen markiert und der Einsatz abgeschlossen. Spätere Korrekturen bleiben möglich und erscheinen als Nachträge.',
    confirmBtn: 'Abschliessen',
    // …und wenn noch etwas offen ist, sagt es der Knopf. Abschliessen ist erlaubt – das ist der
    // Ort, an dem das ausgesprochen wird, statt hinter einem gleich beschrifteten Knopf.
    confirmAnyway: 'Trotzdem abschliessen',
    /* Ein Atemschutz-Trupp, der beim Abschluss noch ANGEMELDET ist (24.09.2026, D1 ⑦): typisch
       der Sicherungstrupp, der bereitstand und nie hinein musste. Vor der eigentlichen Frage
       gestellt; «nicht eingesetzt» ist derselbe Abschluss wie auf der Karte (Trupp … nicht
       eingesetzt). */
    registeredOne: '1 Trupp noch angemeldet ({list}).',
    registeredMany: '{n} Trupps noch angemeldet ({list}).',
    registeredSafety: '{name}, Sicherungstrupp',
    registeredToBoard: 'Zur Tafel',
    registeredTitle: 'Noch angemeldet',
    registeredStandDown: 'Als «nicht eingesetzt» schliessen',
    // Trupps, die beim Abschluss noch DRIN sind: eine eigene, erste Frage
    insideOne: '1 Trupp ist noch drin: {list}.',
    insideMany: '{n} Trupps sind noch drin: {list}.',
    insideTrupp: 'Trupp {name}',
    insideClose: 'Trotzdem abschliessen',
    insideTitle: 'Trupps noch drin',
    // die sichere, fokussierte Antwort auf der Liste der offenen Punkte
    confirmBack: 'Zurück',
    // The rows' own answers, as buttons (3am sweep, 23.10.2026; lib/abschlussOpen · fixes), on the
    // Abschluss and – since 31.10.2026 – the print's «Angaben fehlen noch». «Jetzt setzen» stands
    // mostly on the print's list: the Abschluss pre-fills an empty Einsatzende with «jetzt».
    fix: {
      zeiten: 'Jetzt setzen',
      mittel: 'Nichts verwendet',
      einsatzleiter: 'Wählen',
      kontaktperson: 'Entfällt',
      kurzbericht: 'Schreiben',
      rueckmeldung: 'Entfällt',
    },
    // the pre-filled Einsatzende row: «Einsatzende · jetzt 23:41», written with the close
    endeNow: 'jetzt {t}',
    endeChange: 'Ändern',
    done: 'Rapport abgeschlossen',
    // «Wieder öffnen» on the success toast, 10 s (3am sweep, 23.10.2026): the same reopen as
    // «Alle Einsätze», without its confirm – the toast IS the confirm-with-undo
    reopen: 'Wieder öffnen',
    // what an Abschluss left in the media queue stands in the Meldeleiste while it is there — it
    // was the closing toast's second half (S3, 20.10.2026; components/MediaPendingMeldung)
    mediaPendingTitle: '{n} Foto/Audio von «{title}» noch nicht hochgeladen',
    mediaPendingSub: 'Bleiben auf diesem Gerät gespeichert und gehen beim nächsten Öffnen raus.',
    mediaPendingDismiss: 'Ausblenden',
    failed: 'Abschluss fehlgeschlagen',
    corrected: 'Stunden korrigiert: {name}',
    attendanceRemoved: '{name} Anwesenheit entfernt',
  },
  // Datenquellen panel (reference datasets + objects)
  datenquellen: {
    title: 'Datenquellen',
    uploaded: 'Hochgeladen',
    uploadFailed: 'Upload fehlgeschlagen',
    invalidFilename: 'Dateiname ergibt keine gültige Kennung',
    layerAdded: 'Ebene «{name}» hinzugefügt – beim nächsten Laden sichtbar',
    addLayerFailed: 'Konnte Ebene nicht hinzufügen',
    // ⚠️ Die Konfiguration wurde zwischen Lesen und Schreiben anderswo geändert (CLI, Verwaltung,
    // zweites Tablet). Nochmals drücken liest neu und legt die Ebene sauber obendrauf – blind
    // überschreiben würde genau das kaputtmachen, wogegen der Schutz eingebaut wurde.
    layerConflict: 'Die Kartenebenen wurden gerade an anderer Stelle geändert. Bitte nochmals «Hinzufügen» drücken.',
    // ⚠️ Etwas anderes als ein Konflikt: die Konfiguration liess sich gar nicht erst lesen (die
    // Antwort war nicht das Dokument – Portal-Seite, Proxy-Fehler, Offline-Hülle). Nochmals
    // drücken hilft hier nie, deshalb steht hier auch nicht «nochmals versuchen».
    layerNoVersion: 'Die Konfiguration konnte nicht gelesen werden – die Ebene wurde nicht gespeichert. Bitte die Verbindung prüfen und die Seite neu laden.',
    globalDatasets: 'Globale Datensätze',
    objectsCount: 'Objekte',
    replace: 'Ersetzen',
    adminOnlyNote: 'Datensätze ersetzen oder eine neue Ebene hinzufügen kann nur, wer /admin in diesem Browser entsperrt hat (ADMIN_SECRET).',
    newGeoLayer: 'Neue Geo-Ebene …',
    chooseGeojson: 'GeoJSON wählen …',
    labelPlaceholder: 'Bezeichnung (z. B. Hydranten)',
    groupPlaceholder: 'Gruppe (z. B. Wasser)',
    defaultGroup: 'Referenz',
    kindLines: 'Linien',
    kindPoints: 'Punkte',
    color: 'Farbe',
    adding: 'Wird geladen …',
    add: 'Hinzufügen',
    geojsonNoteBefore: 'GeoJSON in WGS84 [lng, lat]. Wird als globaler Datensatz ',
    geojsonNoteAfter: ' gespeichert.',
    incidentObjects: 'Einsatzobjekte',
    plansWord: 'Pläne',
    nearby: 'In der Nähe ({n})',
    allOther: 'Alle übrigen Objekte',
    allObjects: 'Alle Objekte',
  },
  // sync the roster with the configured personnel source
  personnelSync: {
    title: 'Personal mit {provider} synchronisieren',
    unknownError: 'Unbekannter Fehler',
    syncFailed: 'Synchronisierung fehlgeschlagen',
    countNew: 'neu',
    countUpdated: 'aktualisiert',
    countUnchanged: 'unverändert',
    countStale: 'nicht mehr bei {provider}',
    querying: '{provider} wird abgefragt …',
    done: 'Synchronisierung abgeschlossen.',
    resultCreated: '{n} neu angelegt',
    resultUpdated: '{n} aktualisiert',
    resultReactivated: ' (davon {n} reaktiviert)',
    resultUnchanged: '{n} unverändert',
    resultDeactivated: '{n} deaktiviert',
    staleHide: '{n} nicht mehr bei {provider} vorhandene Personen ausblenden (bleiben für alte Einsätze erhalten, werden nicht gelöscht)',
    syncing: 'Synchronisiere …',
    sync: 'Synchronisieren',
  },
  // PlanPicker (manually pick an Einsatzobjekt)
  planPicker: {
    searchPlaceholder: 'Name oder Adresse suchen …',
    autoNextObject: 'Automatisch nächstes Objekt',
    loading: 'Objekte werden geladen …',
    loadFailed: 'Objekte konnten nicht geladen werden.',
    noObject: 'Kein Objekt gefunden.',
    planOne: 'Plan',
    planMany: 'Pläne',
    mapNote: 'Koordinaten teils ungenau – Liste ist massgebend.',
    mapUnavailable: 'Kartenbild nicht verfügbar.',
    hideMap: 'Karte ausblenden',
    showMap: 'Karte einblenden',
  },
  // time-travel replay scrubber (ReplayBar)
  replay: {
    region: 'Verlauf-Wiedergabe',
    banner: 'VERLAUF · WIEDERGABE',
    subtitle: 'Schreibgeschützte Ansicht der Vergangenheit',
    backToLive: 'Zurück zu Live',
    loadFailed: 'Verlauf konnte nicht geladen werden.',
    loading: 'Verlauf wird geladen …',
    transport: 'Wiedergabe',
    skipBack: 'Vorheriges Ereignis',
    skipFwd: 'Nächstes Ereignis',
    pause: 'Pause',
    // idle spans: what the playback skips, and what sits on the track as a gap
    skipped: 'übersprungen {span}',
    gapTitle: '{span} ohne Ereignis',
    sinceAlarm: '{span} seit Alarm',
    speed: 'Geschwindigkeit',
    timepoint: 'Zeitpunkt',
    now: 'Jetzt',
    // Verlaufsspur + mitlaufender Untertitel unter dem Balken
    laneLabel: 'Verlauf',
    captionOpen: 'im Verlauf',
    laneEntries: '{n} Einträge',
    captionNone: 'Kein Eintrag zu diesem Zeitpunkt',
  },
} as const
