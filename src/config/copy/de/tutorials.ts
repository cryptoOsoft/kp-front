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
    minutes: '{n} Min.',
  },
} as const
