// German copy · the Einsatz wizard (intake).
// One slice of the canonical `de` catalogue, assembled in ../de.ts — read the rules at the
// top of that file before adding or renaming a key here.

export const intakeCopy = {
  // "Einsatz eröffnen" / "Einsatzdaten bearbeiten". An alarm opens its Einsatz by itself,
  // so this panel is for the two remaining jobs: a manual create (fully analog Einsatz,
  // three location methods — Objekt · Adresse · Karte) and correcting what the dispatch
  // got wrong on an incident that is already running.
  intake: {
    titleNew: 'Einsatz eröffnen',
    // …and with «Übung: Ja» the form says what it is about to open (sweep F.8)
    titleNewExercise: 'Übung eröffnen',
    // --- Standort section ---
    addressLabel: 'Adresse',
    addressPlaceholder: 'Strasse Nr, PLZ Ort',
    addressSearching: 'Wird gesucht …',
    addressNoHits: 'Keine Adresse gefunden',
    // «Aus Plänen» · «Auf Karte» (27.09.2026, slim sweep · mockup 4a): the app's last two-line
    // buttons. The verb «setzen» is where the buttons sit (under the address); «Feuerwehrpläne»
    // is the only source of objects the app has, and the list that folds open says so.
    objectButton: 'Aus Plänen',
    objectSearchPlaceholder: 'Objekt oder Adresse suchen …',
    objectNear: 'In der Nähe',
    objectNoHits: 'Keine Objekte gefunden',
    objectPlans: (n: number) => (n === 1 ? '1 Plan' : `${n} Pläne`),
    objectNoPlans: 'keine Pläne',
    mapPickButton: 'Auf Karte',
    hereButton: 'Hier',
    hereFailed: 'Standort nicht verfügbar',
    coordSet: 'Koordinate gesetzt',
    coordNone: 'Kein Standort – wird ohne Koordinate eröffnet',
    // the edit form: the Einsatz is already open, so nothing «wird eröffnet» any more
    coordNoneEdit: 'Kein Standort – Einsatz ohne Koordinate',
    coordClear: 'Standort entfernen',
    // The fold over the literal coordinate (owner, 18.09.2026) — see EinsatzWizard.
    coordFold: 'Koordinaten',
    // --- Stichwort section ---
    titleLabel: 'Stichwort / Titel',
    titlePlaceholder: 'z. B. Gebäudebrand Schulhaus',
    categoryLabel: 'Kategorie',
    // Übungen stay fully operable, but do not feed the statistics and are the only ones
    // that can be deleted (Alle Einsätze)
    // an OnOff row since 28.09.2026: the name on the row, the consequence under it
    exerciseLabel: 'Übung',
    exerciseSub: 'Zählt nicht zur Einsatzstatistik',
    // «Hier» moves the Einsatzort to the device's location. On a running Einsatz it always asks
    // first – the form is usually opened in the Magazin to correct an address, and a mis-tap
    // takes the map, the Kroki, the tile stock and the Objektpläne along with it.
    moveConfirmTitle: 'Einsatzort verschieben?',
    moveConfirmMsg: 'Der Einsatzort wird auf deinen jetzigen Standort gesetzt – {d} vom bisherigen entfernt. Karte, Kroki-Ausschnitt und die Objektpläne in der Nähe richten sich danach.',
    moveConfirmBtn: 'Verschieben',
    alarmTextUnavailable: 'Alarmmeldung konnte nicht geladen werden – bleibt unverändert',
    detailsPlaceholder: 'Zusätzliche Angaben zur Meldung',
    // --- Actions ---
    open: 'Einsatz eröffnen',
    openExercise: 'Übung eröffnen',
    opening: 'Wird eröffnet …',
    demoBlocked: 'In der Demo deaktiviert – hier lässt sich kein neuer Einsatz eröffnen.',
    cancel: 'Abbrechen',
    errorCreate: 'Erstellen fehlgeschlagen',
    errorTake: 'Übernahme fehlgeschlagen',
    errorUpdate: 'Aktualisierung fehlgeschlagen',
    // --- edit mode + result toasts ---
    editTitle: 'Einsatzdaten bearbeiten',
    save: 'Speichern',
    saving: 'Speichert …',
    created: 'Einsatz erstellt',
    taken: 'Alarm übernommen',
    updated: 'Einsatz aktualisiert',
    alarmTime: 'Alarmzeit',
    alarmMessage: 'Alarmmeldung',
    // --- Divera pool + incoming banner + in-map review ---
    addressUnknown: 'Adresse unbekannt',
    alarmOpen: 'Öffnen',
    alarmOpening: 'Öffne …',
    dismiss: 'Verwerfen',
    manualIncident: 'Manueller Einsatz',
    // --- attach: split/Nachalarm dispatch joins an existing incident instead of a duplicate ---
    attach: 'Zu bestehendem Einsatz hinzufügen',
    attachShort: 'Zu Einsatz',
    attachConfirmTitle: '«{alarm}» zu diesem Einsatz hinzufügen?',
    attachHint: 'Die Meldung landet im Verlauf, GPS-Zeiten folgen automatisch. Stichwort und Standort des Einsatzes bleiben unverändert.',
    attachConfirm: 'Hinzufügen',
    attachDone: 'Alarm zum Einsatz hinzugefügt',
    attachError: 'Hinzufügen fehlgeschlagen',
    newDiveraAlarm: 'Neuer Alarm',
    hide: 'Ausblenden',
    fromDivera: 'Aus der Alarmquelle übernommen',
    // Zeilentitel in der Meldeleiste; fromDivera darunter ist der Untertitel. Die Zeile
    // ERSETZT die 700px-Karte mit Meldung und Kategorie-Combo — geprüft wird beim
    // Bearbeiten, bestätigt wird mit «Passt».
    reviewTitle: 'Einsatzdaten prüfen',
    noLocationOnMap: 'Kein Standort – auf Karte setzen',
    ok: 'Passt',
    // The VKF Schadenkategorien are the SERVER's (`categoryLabels` on GET /api/config, from
    // backend app/divera.py CATEGORY_LABELS) – read through `incidentCategories()`.
    // DISPLAY labels for the category picker, keyed by the German category VALUE (the server's
    // `categoryLabels` values). de = identity (German→German); en/fr/it translate. The stored/
    // submitted value stays the German label — only the option TEXT localizes; the picker
    // falls back to the German label when a translation is missing.
    kategorienLabels: {
      'Brandbekämpfung': 'Brandbekämpfung',
      'Strassenrettung': 'Strassenrettung',
      'Technische Hilfeleistung': 'Technische Hilfeleistung',
      'Elementarereignis': 'Elementarereignis',
      'Ölwehr': 'Ölwehr',
      'Chemiewehr': 'Chemiewehr',
      'Strahlenwehr': 'Strahlenwehr',
      'Einsatz Bahnanlagen': 'Einsatz Bahnanlagen',
      'BMA / unechte Alarme': 'BMA / unechte Alarme',
      'Gerettete Tiere': 'Gerettete Tiere',
      'Dienstleistungen': 'Dienstleistungen',
      'Diverse Einsätze': 'Diverse Einsätze',
    } as Record<string, string>,
  },
} as const
