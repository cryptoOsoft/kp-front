// German copy · «Üben»: the tutorial catalogue's names, the tracks, the start sheet and the
// «Ausprobieren» button in the Hilfe. One slice of the canonical `de` catalogue, assembled in
// ../de.ts — read the rules at the top of that file before adding or renaming a key here.
// The RUNNING tutorial's words (card, pill, steps, done card) are ../de/tutorialRun.ts.

export const tutorialsCopy = {
  tutorials: {
    /** the menu row under «App» (owner, 05.11.2026: «Üben», a verb like «Messen») */
    menu: 'Üben',
    /** one tutorial per id (lib/tutorials/catalogue) – no noun for «a tutorial» anywhere
     *  (owner pick O6, 05.11.2026): titles and «Üben» carry it */
    titles: {
      zurechtfinden: 'Zurechtfinden',
      einsatzEroeffnen: 'Einsatz eröffnen',
      lageZeichnen: 'Karte – die Lage zeichnen',
      planGebaeude: 'Plan & Gebäude',
      tafel: 'Tafel',
      checkliste: 'Checkliste im Einsatz',
      trupps: 'Trupps',
      notfall: 'Atemschutznotfall',
      anwesenheit: 'Anwesenheit & Zeitplan',
      material: 'Material',
      verlauf: 'Verlauf',
      rapport: 'Rapport & Abschluss',
      nachschlagen: 'Checkliste & Anleitungen nachschlagen',
      wiedergabe: 'Wiedergabe, Offline, zweites Gerät',
      objektbesuch: 'Objektbesuch',
    },
    tracks: {
      fu: 'Führungsunterstützung',
      el: 'Einsatzleitung',
      as: 'Atemschutz-Überwachung',
      alle: 'Für alle',
    },
    /** a no-break space: «4 Min.» never splits over two lines */
    minutes: '{n}\u00A0Min.',
    /** each row's quiet line on the «Üben» sheet: what you will do, in the app's words */
    summaries: {
      zurechtfinden: 'Suche, Gebäude, Ebenen, Messen',
      einsatzEroeffnen: 'Objekt wählen, als Übung eröffnen',
      lageZeichnen: 'Fahrzeug, Leitung, Absperrkreis, Notiz',
      planGebaeude: 'Plan öffnen, Symbol setzen, Geschoss wechseln',
      tafel: 'Formular ausfüllen, skizzieren, neue Seite',
      checkliste: 'Abhaken, Meilenstein, Zeichnen aus der Liste',
      trupps: 'Anmelden, Funkkontakt, Auftrag, Rückzug',
      notfall: 'Notfall auslösen, Sicherungstrupp, beenden',
      anwesenheit: 'Anwesend melden, zuteilen, Schicht',
      material: 'Aus dem Katalog, Quelle, Bemerkung',
      verlauf: 'Meldung, Pendenz, Korrektur',
      rapport: 'Einsatzdaten, Erfassungsblatt, Abschluss',
      nachschlagen: 'Gerät suchen, Kapitel öffnen',
      wiedergabe: 'Zurückspulen, zurück zu Live, Offline-Bereitschaft',
      objektbesuch: 'Besuch starten, Fragen beantworten',
    },
    /** the «Üben» sheet (owner pick S = B «Eine Liste», 05.11.2026) */
    sheet: {
      lede: 'An den echten Knöpfen – die App merkt, wenn ein Schritt sitzt. ✓ = auf diesem Gerät erledigt.',
      /** the filter chips; the chip says «Atemschutz», the group head the track's full name */
      filterLabel: 'Nach Funktion filtern',
      all: 'Alle',
      chips: {
        fu: 'Führungsunterstützung',
        el: 'Einsatzleitung',
        as: 'Atemschutz',
      },
      doneCount: '{done} von {n} erledigt',
      done: 'Erledigt',
      resume: 'Fortsetzen',
      /** 1-based step of an interrupted run / of the one running now */
      interrupted: 'Unterbrochen · Schritt {n}',
      running: 'Läuft · Schritt {n}',
      /** the tag on a row: runs without an Übung (works offline) / opens a «Lernen ·» Übung */
      tagOffline: 'offline',
      tagUebung: 'Lern-Übung',
    },
    /** the button under a Hilfe section's title (owner pick H = A): «▶ Ausprobieren · Trupps · 6 Min.»;
     *  the no-break spaces keep «6 Min.» whole and the «·» with the title where the line wraps */
    help: {
      try: 'Ausprobieren',
      what: '{title}\u00A0· {minutes}',
    },
  },
} as const
