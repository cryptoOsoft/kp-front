// German copy · the RUNNING tutorial («Üben», 05.11.2026): the pill, the Sprechblase (step card),
// the step list behind the pill, the ✓ moment, the done card, and each tutorial's steps. One
// slice of the canonical `de` catalogue, assembled in ../de.ts — read the rules at the top of
// that file first. The catalogue's names and the start sheet are ../de/tutorials.ts.
//
// `steps.<tutorial>.<step>` is keyed like lib/tutorials/steps (tsc refuses a step without its
// words): `title` is the step's row in the list and on the done card, `instruction` + `hint` are
// the Sprechblase, `hintPhone` replaces the hint where the phone reaches the tool another way
// (the «+ Hinzufügen» sheet), `done` is the ✓ moment. The copy asks for the SPECIFIC act (a
// Leitung from the TLF to the Hydrant); the check accepts the broad one (any line).

export const tutorialRunCopy = {
  tutorialRun: {
    /** the pill at the top: «Üben 3/7» */
    pill: 'Üben {n}/{m}',
    /** the pill's own name – a tap opens the step list */
    pillOpen: 'Alle Schritte',
    /** the pill's ✕ – keeps the step, the «Üben» sheet offers «Fortsetzen» */
    pause: 'Pausieren',
    paused: 'Pausiert – unter «Üben» geht es weiter.',
    skip: 'Überspringen',
    next: 'Weiter',
    show: 'Zeigen',
    quit: 'Beenden',
    /** the dots' read-out and the list's head: «3/7» */
    stepOf: '{n}/{m}',
    /** under the ✓, for the ~1.5 s before the next step comes by itself (O3) */
    soon: 'Gleich: {step}',
    /** standing on another surface than the step's */
    goTo: 'Weiter geht es auf «{surface}».',
    goToHint: 'Unten in der Leiste antippen.',
    goToHintRail: 'Links in der Leiste antippen.',
    /** the list's marker on a step the app cannot see (W) */
    manualTag: 'Weiter',
    skippedTag: 'übersprungen',
    /** POST /incidents/lernen failed – the run stays on the open Übung */
    sandboxFailed: 'Lern-Übung konnte nicht angelegt werden – geübt wird auf dieser Übung.',
    /** …and the open Einsatz is a real one: nothing is practised on it */
    sandboxRefused: 'Lern-Übung konnte nicht angelegt werden. Geübt wird nur auf einer Übung – bitte später nochmals.',
    /** a row whose tutorial has no steps yet (Round 1: all but T2) – instead of a tap that does nothing */
    notYet: '«{title}» ist noch in Arbeit – bald hier.',
    done: {
      title: 'Geschafft – {title}',
      /** «Beenden» before the last step */
      ended: 'Beendet – {title}',
      /** «6 von 7 Schritten · 5:40 Min.» */
      sub: '{n} von {m} Schritten · {t} Min.',
      uebungNote: 'Die Übung «{incident}» wird nicht mehr gebraucht.',
      /** owner pick G = A / O9: filled primary with the bin, «Behalten» beside it */
      delete: 'Übung löschen',
      keep: 'Behalten',
      close: 'Schliessen',
      continueWith: 'Weiter mit',
      deleteFailed: 'Übung konnte nicht gelöscht werden – sie bleibt in «Alle Einsätze».',
    },
    steps: {
      lageZeichnen: {
        place: {
          title: 'Ein TLF auf die Lage setzen',
          instruction: 'Setze ein TLF auf die Lage.',
          hint: '«Symbol» in der Werkzeugleiste, «TLF» suchen, dann auf die Karte tippen.',
          hintPhone: '«Hinzufügen», «TLF» suchen, dann auf die Karte tippen.',
          done: 'TLF gesetzt',
        },
        move: {
          title: 'Das TLF an die Brandstelle schieben',
          instruction: 'Schiebe das TLF an die Brandstelle.',
          hint: 'Mit «Auswahl» das TLF ziehen.',
          done: 'TLF verschoben',
        },
        line: {
          title: 'Leitung vom TLF zum Hydranten',
          instruction: 'Zeichne eine Leitung vom TLF zum Hydranten.',
          hint: '«Linie» in der Werkzeugleiste, dann TLF und Hydrant antippen.',
          hintPhone: '«Hinzufügen» → «Linie», dann TLF und Hydrant antippen.',
          done: 'Leitung gezeichnet',
        },
        circle: {
          title: 'Absperrkreis um die Brandstelle',
          instruction: 'Ziehe einen Absperrkreis um die Brandstelle.',
          hint: '«Absperrkreis», dann von der Brandstelle nach aussen ziehen.',
          hintPhone: '«Hinzufügen» → «Absperrkreis», dann von der Brandstelle nach aussen ziehen.',
          done: 'Absperrkreis gezogen',
        },
        note: {
          title: 'Eine Notiz an die Zufahrt',
          instruction: 'Schreibe eine Notiz an die Zufahrt.',
          hint: '«Notiz», an die Zufahrt tippen und schreiben.',
          hintPhone: '«Hinzufügen» → «Notiz», an die Zufahrt tippen und schreiben.',
          done: 'Notiz gesetzt',
        },
        undoRedo: {
          title: 'Rückgängig, dann wiederholen',
          instruction: 'Nimm den letzten Schritt zurück – und hol ihn wieder.',
          hint: '↶ oben in der Kopfleiste, dann ↷. Das gilt für jede Seite des Einsatzes.',
          done: 'Zurück und wieder da',
        },
        theme: {
          title: 'Tag- und Nachtansicht',
          instruction: 'Für die Nacht gibt es ein dunkles Farbschema.',
          hint: 'Einsatz-Menü → Einstellungen → Farbschema. «Automatisch» schaltet bei Dämmerung selbst.',
          done: 'Farbschema gefunden',
        },
      },
    },
  },
} as const
