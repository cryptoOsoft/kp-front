// German copy · measuring, shapes, object Verlauf rows, the tool dock.
// One slice of the canonical `de` catalogue, assembled in ../de.ts — read the rules at the
// top of that file before adding or renaming a key here.

export const drawingCopy = {
  measure: {
    modeLine: 'Strecke',
    modeArea: 'Fläche',
    clear: 'Zurücksetzen',
    // the + in the middle of every segment — the same label on Karte and Plan, because it is
    // the same gesture
    insertPoint: 'Punkt einfügen',
    // the arrow grip past an open line end — dragging it appends one point
    extendLine: 'Linie verlängern',
    deleteNode: 'Gedrückt halten zum Löschen, am Computer Rechtsklick',
    // Der blaue Ring am Ziel: er läuft, solange das Ende darüber steht, und erst wenn er voll
    // ist, klinkt die Linie ein. Wer früher loslässt, setzt den Punkt einfach dorthin.
    snapConnect: 'Halten zum Verbinden',
    // Derselbe Ring in Rot, an der alten Anschlussstelle: wegziehen, bis er voll ist, dann ist
    // das Ende frei. Kurz davor loslassen und es springt zurück.
    snapRelease: 'Wegziehen zum Lösen',
    // Der offene Ring am Ende eines Schlauchs, an dem niemand hängt – sichtbar, sobald ein
    // Truppmarker in der Hand ist oder die Leitung ausgewählt ist. Ein freies Ende soll das
    // sagen, statt still dazuliegen.
    distance: 'Distanz',
    perimeter: 'Umfang',
    // Wie breit und wie hoch die Fläche am Boden ist — das Rechteck, das sie belegt, in
    // Ost-West und Nord-Süd. Nicht entlang ihrer eigenen Achsen: eine gezeichnete Fläche hat
    // keine, und die Frage wird gegen die Karte gestellt, auf die man schaut.
    boxWidth: 'Breite',
    boxHeight: 'Höhe',
    area: 'Fläche',
    hoses: 'Schläuche',
    profile: 'Höhenprofil',
    ascent: 'Aufstieg',
    descent: 'Abstieg',
    min: 'Tiefster',
    max: 'Höchster',
    profileLoading: 'Höhenprofil wird geladen …',
    profileNone: 'Kein Höhenprofil verfügbar',
    hintLine: 'Mind. 2 Punkte für die Distanz',
    hintArea: 'Mind. 3 Punkte für den Flächeninhalt',
    // «Messen» und «Zeichnen» massen zweimal dasselbe: die Strecke war gemessen, und wer sie
    // behalten wollte, musste sie ein zweites Mal ziehen. Der Knopf macht aus den gemessenen
    // Punkten eine echte Linie – ab da gilt die normale Linienbearbeitung.
    adoptLine: 'Als Linie übernehmen',
    // Das Gegenstück für die Fläche: der gemessene Umriss wird zur gezeichneten Fläche,
    // statt ihn ein zweites Mal von Hand nachzuziehen.
    adoptArea: 'Als Fläche übernehmen',
  },
  shapes: {
    sectionTitle: 'Formen',
    kindLabel: 'Form',
    color: 'Farbe',
    size: 'Grösse',
    sizeSmaller: 'Kleiner',
    sizeBigger: 'Grösser',
    // Eine Rotation hat zwei Grössen, und sie bedeuten Verschiedenes: wie weit gependelt
    // wird, und wie breit die Schlaufe gezeichnet ist.
    lengthLabel: 'Länge',
    lengthShorter: 'Kürzer',
    lengthLonger: 'Länger',
    rotate: 'Drehen',
    resizeHint: 'Ecke ziehen zum Skalieren',
    // Ein Rechteck hat zwei Achsen und je einen Griff dafür – waagrecht die Breite, senkrecht
    // die Höhe. Dieselbe Aufteilung wie bei der Rotation (Länge/Breite), nur heissen die Achsen
    // hier anders: ein Rechteck pendelt nicht.
    heightLabel: 'Höhe',
    boxWidthHint: 'Griff ziehen – Breite',
    boxHeightHint: 'Griff ziehen – Höhe',
    endHint: 'Ende ziehen – Strecke und Richtung',
    // Die Strichstärke der Form – dieselben drei Stufen wie bei einer gezeichneten Fläche,
    // weil eine Form eine vorgeformte Fläche ist (lib/shapes · SHAPE_STROKE_DEFAULT).
    strokeLabel: 'Strichstärke',
    // Ein Rechteck ist eine vorgeformte Fläche – es beantwortet dieselben Fragen wie eine
    // gezeichnete (Füllung, Farbe, Strichstärke) und dazu die eine, die nur es hat: ob die
    // Ecken rund sind oder scharf. Eine von Hand gezogene Fläche hat die Ecken ihrer Punkte.
    cornersLabel: 'Ecken',
    cornersRound: 'Rund',
    cornersSharp: 'Eckig',
    // Pfeil-Ende «->|»: der Stopp-Balken quer zur Spitze (Entwicklungsgrenze)
    stopLabel: 'Stopp-Balken',
    // FKS Vegetationsbrand S. 52: die Schlaufe wird MIT ihrem Träger gezeichnet
    // («Rotation-Helikopter», «Rotation TLF»). Ohne Träger bleibt sie eine reine Pendelbahn.
    carrierLabel: 'Träger',
    carrierNone: 'Ohne',
    carrierHeli: 'Heli',
    carrierTlf: 'TLF',
    moveHint: 'Korb ziehen – Richtung und Reichweite',
    names: { arrow: 'Pfeil', cloud: 'Rauch', square: 'Rechteck', rotation: 'Rotation' } as Record<string, string>,
  },
  log: {
    audioNote: 'Audionotiz',
    symbolPlaced: 'Symbol «{name}» gesetzt',
    shapePlaced: '{name} platziert',
    notePlaced: 'Notiz gesetzt',
    teamPlaced: '{name} auf der Karte gesetzt',
    /** Every drawn shape opens on ONE row shape, named by lib/drawingEdit · drawingLogName —
     *  «Fläche gezeichnet», «Absperrkreis gezeichnet», «Rettungsachse gezeichnet», «Zeichnung
     *  gezeichnet». Replaced the three separate rows on 31.08.: a line reported «Zeichnung
     *  erstellt» whatever it had been drawn with, and closed on «… gelöscht», so creation and
     *  deletion of the same object did not even use the same verb. */
    shapeDrawn: '{name} gezeichnet',
    objectMoved: '{name} verschoben',
    // Gefahrentafel-Andocken (lib/docking): the bond and its release, as Verlauf rows
    placardDocked: '{name} angedockt an «{host}»',
    placardUndocked: '{name} von «{host}» gelöst',
    // …und derselbe Bund für einen Truppmarker (15.09.)
    teamDocked: '{name} bei «{host}»',
    teamUndocked: '{name} von «{host}» gelöst',
    /** Die Passung eines Plans wurde korrigiert: alles, was auf diesem Blatt gezeichnet ist,
     *  steht damit an einem anderen Ort auf der Karte. Eine Zeile, nicht n Zeilen. */
    referenceRebaked: 'Referenz angepasst – {n} Objekte neu verortet',
    /** ⚠️ Dieselbe Wirkung, andere Ursache — und darum eine andere Zeile. Hier hat die App
     *  das Blatt vermessen und die Passung mit denselben Passpunkten in der richtigen Form
     *  neu gelöst; «Referenz angepasst» würde dem Bediener eine Korrektur zuschreiben, die er
     *  nie vorgenommen hat. Der Verlauf ist ein Protokoll dessen, was geschehen ist, nicht
     *  dessen, was jemand getan haben könnte. */
    referenceRemeasured: 'Blattform gemessen – {n} Objekte neu verortet',
    /** ⚠️ Die dritte Ursache: der Server hat die Änderung abgelehnt, und die Passung steht wieder
     *  so da wie vorher. Die Objekte stehen ebenfalls wieder dort, wo sie standen – niemand hat
     *  etwas verschoben, und darum gibt es hier auch keinen ↶: Es gibt nichts zurückzunehmen.
     *  Ohne die Zeile hätte der Verlauf «Referenz angepasst» ein zweites Mal behauptet. */
    referenceRolledBack: 'Referenz-Änderung verworfen – Speichern fehlgeschlagen',
    /** …und die Passung wurde ENTFERNT («Referenz zurücksetzen»). Dabei verschiebt sich nichts:
     *  Was auf dem Blatt gezeichnet ist, bleibt dort UND behält seine zuletzt berechnete Position
     *  auf der Karte – letzte bekannte Wahrheit, wie ein Fahrzeug, das aufgehört hat zu melden.
     *  Genau darum braucht es die Zeile: die Rückverortung meldet 0 verschobene Objekte, und ohne
     *  sie stünde über eine bewusste Handlung gar nichts im Verlauf. Zwei Fassungen, weil «0
     *  Objekte behalten ihre letzte Position» keine Aussage ist. */
    referenceDropped: 'Referenz entfernt',
    referenceDroppedKept: 'Referenz entfernt – {n} Objekte behalten ihre letzte Position',
    /** …und das Gegenstück: ein Blatt OHNE Passung wurde VON HAND mit der Karte verknüpft
     *  (zweiter Passpunkt gesetzt, Vorschlag übernommen, Passung übertragen). Die Zeile kommt aus
     *  der Handlung selbst – ein Plan, der bloss fertig lädt, schreibt nichts. «Verortet», nicht
     *  «neu verortet»: vorher stand das Gezeichnete nirgends auf der Karte. Ohne Objekte steht die
     *  Zeile ohne Zahl, wie «Referenz entfernt». (georefTwins · handLinkRow) */
    referenceLinked: 'Plan mit Karte verknüpft – {plan}',
    referenceLinkedPlaced: 'Plan mit Karte verknüpft – {plan} – {n} Objekte verortet',
    /** ⚠️ «entfernt», nicht mehr «gelöscht» (25.09.2026): seit «Gelöscht / erledigt» (objectDone)
     *  heisst «Feuer gelöscht» ein GELÖSCHTES Feuer. Ein Objekt, das von Karte oder Plan genommen
     *  wird, ist «entfernt» – das Wort des Knopfs (copy · remove). Geschriebene Zeilen behalten
     *  ihr «gelöscht» (append-only). */
    objectDeleted: '{name} entfernt',
    drawingDeleted: 'Zeichnung entfernt',
    // «Zeichnung entfernt» after a lasso selection over eleven objects isn't imprecise, it is
    // wrong – the singular claims there was only one.
    selectionDeleted: '{n} Objekte entfernt',
    duplicated: 'Objekt dupliziert',
    undo: 'Aktion rückgängig gemacht',
    redo: 'Aktion wiederhergestellt',
    // ⚠️ Der Verlauf ist append-only: eine Rücknahme LÖSCHT die Zeile von vorhin nicht, sie
    // schreibt eine neue dazu. Und sie benennt, was zurückgenommen wurde – seit ein ↶ auf der
    // Karte eine Atemschutz-Aktion treffen kann, wäre «Aktion rückgängig gemacht» eine Zeile,
    // die auf Papier niemand mehr zuordnen kann.
    undoNamed: '{action} rückgängig gemacht',
    redoNamed: '{action} wiederhergestellt',
    journalNote: 'Notiz',
    // ⚠️ EDITING the Kroki, not just placing and removing on it (10.08.). A symbol got one row
    // when it appeared and one when it went, and everything in between — the Stockwerk, the name
    // of the Einsatzleiter typed into its field, the Anzahl, eine Ausbreitung — changed the
    // picture the Einsatz is led from without a single line in the record. Each of these names
    // the VALUE: «Stockwerk geändert» would send a reader to the replay for the one thing a
    // printed rapport cannot do.
    entityEdited: '{name}: {changes}',
    fieldSet: '{field}: {value}',
    fieldChanged: '{field} auf {value} geändert',
    fieldCleared: '{field} entfernt',
    /** ⚠️ Dieselben zwei Aussagen OHNE Wert – für den einen Fall, in dem der Wert den Namen der
     *  Zeile wiederholen würde. Eine Linie mit Pfeil-Abschluss heisst «Pfeil» (drawingLogName),
     *  und mit «{name}: {changes}» davor stand am 03.09. «Pfeil: Abschluss: Pfeil» im Rapport.
     *  Der Wert steht dann schon als erstes Wort der Zeile; siehe lib/drawingEdit. */
    fieldSetPlain: '{field} gesetzt',
    fieldChangedPlain: '{field} geändert',
    labelSet: 'Beschriftung «{value}»',
    labelCleared: 'Beschriftung entfernt',
    floorSet: 'Geschoss {value}',
    floorCleared: 'Geschoss entfernt',
    floorRangeSet: 'Geschosse {from} – {to}',
    floorRangeCleared: 'Geschoss-Bereich entfernt',
    countSet: 'Anzahl {n}',
    spreadSet: 'Ausbreitung erfasst',
    spreadCleared: 'Ausbreitung entfernt',
    // ⚠️ The note is QUOTED (reversed 11.08.; it used to be the bare «Notiz erfasst»). A note is
    // the sentence somebody wrote BECAUSE the symbol could not say it — a row announcing that
    // such a sentence exists elsewhere is no record of it, least of all on a printed Rapport
    // where the Kroki cannot be clicked.
    noteWritten: 'Notiz «{value}»',
    notesCleared: 'Notiz entfernt',
    /** a Fläche / Linie / Absperrkreis given a name — same rule as the note above. Naming a shape
     *  is how «die Fläche da» becomes «Sammelplatz», and it used to reach the document without a
     *  row: the Verlauf said a Fläche had been drawn and never what it turned out to be. */
    drawingLabelSet: '{kind} «{value}»',
    drawingLabelCleared: '{kind}: Beschriftung entfernt',
    /** «Zurück auf Stand am Einsatzort» (24.09.2026, lib/gpsReturn): the Leitung had followed a
     *  vehicle off site, and was put back as it stood when following began. The row names the
     *  moment and the vehicle, because the Rapport's Kroki shows only the result. */
    gpsReverted: '{name}: zurück auf Stand am Einsatzort ({time}), von {vehicle} gelöst',
    /** …the vehicle out of the feed: no placeholder in its place */
    gpsRevertedBare: '{name}: zurück auf Stand am Einsatzort ({time})',
    /** «Am Einsatzort lösen» that took a DRIVE out of the line — a change of the record, so a row;
     *  a release that removes nothing stays silent like every other detach */
    gpsReleasedOnSite: '{name}: am Einsatzort von {vehicle} gelöst, Fahrt entfernt',
    gpsReleasedOnSiteBare: '{name}: am Einsatzort gelöst, Fahrt entfernt',
    // ⚠️ `line: 'Linie'`, not 'Zeichnung' (31.08.): the tool is called Linie everywhere else, and
    // «Zeichnung» named a shape by the fact that somebody drew it — which every row here already
    // says. A line that carries a preset reports THAT instead (lib/lineStyle · linePresetLabel).
    drawKinds: { area: 'Fläche', line: 'Linie', circle: 'Absperrkreis' } as Record<string, string>,
  },
  /** «Gelöscht / erledigt» statt löschen (review item 21b, 24.09.2026, lib/objectDone). Das Feuer
   *  im EG war aus, also wurde das Symbol um 20:40 GELÖSCHT – und der Rapport zeigte danach keinen
   *  Brand mehr. Jetzt bleibt ein erledigtes Symbol stehen, grau, mit der Uhrzeit; «Entfernen» ist
   *  nur noch für eine Fehleingabe. */
  objectDone: {
    /** ⚠️ EIN Wort, nach Familie: ein Feuer ist «gelöscht», alles andere «erledigt»
     *  (appConfig.symbols.fireFamily). `title` steht am Zeilenanfang, `inline` mitten im Satz. */
    word: {
      fire: { title: 'Gelöscht', inline: 'gelöscht' },
      other: { title: 'Erledigt', inline: 'erledigt' },
    },
    /** die Kachel im Fuss des Symbol-Editors – EIN Wort für jede Familie (D8, 27.09.2026: das
     *  Feuer ist gelöscht, das Symbol erledigt; der Doppelname «Gelöscht / erledigt» war die
     *  Brücke vom alten «Löschen» und ist gefallen). `actionHint` ist ihr title. Seit 31.10.2026
     *  ein Schalter: gesetzt bleibt dieselbe Kachel stehen, gedrückt, und `reopenHint` ist ihr
     *  Name – ein Tippen setzt das Symbol wieder aktiv. */
    action: 'Erledigt',
    actionHint: 'bleibt grau sichtbar',
    reopenHint: 'Erledigt – wieder aktiv setzen',
    /** der gesetzte Zustand im Kopf des Editors und auf dem Rapport: «erledigt 20:40» */
    state: '{word} {time}',
    /** Der Knopf selbst heisst überall «Entfernen» (copy · remove); auf einem Symbol mit «Gelöscht /
     *  erledigt» sagt dieser Hinweis, wofür er noch da ist: für die Fehleingabe. */
    removeHint: 'nur bei Fehleingabe',
    /** Verlauf: «Feuer EG gelöscht» – was und wo. Das Wann ist der Zeitstempel der Zeile selbst,
     *  derselbe Moment, den `done.at` hält; eine Uhrzeit in Klammern sagte es zweimal. */
    logDone: '{name} {word}',
    logReopened: '{name} wieder aktiv',
  },
  // unified, append-only journal (Verlauf) shared by Karte + Plan
  // PHONE: the «+» tile's word and the first section of its sheet (lib/toolFold · Palette) —
  // Linie · Fläche · Absperrkreis · Notiz · Trupp leave the bar for it
  addSheet: { tile: 'Hinzufügen', tools: 'Zeichnen & Trupp' },
  toolDock: {
    colorGroup: 'Farbe',
    colorName: '{group} {n}',
    widthName: 'Linienstärke {n} px',
    // Tap-away while a node draft is in progress no longer discards silently (29.08.):
    // a committable draft auto-commits with this toast, whose «Rückgängig» hands the
    // shape BACK as an editable draft rather than merely deleting it.
    autoCommitted: '{name} gespeichert',
    autoCommitUndo: 'Rückgängig',
    // A fragment below the minimum (1-point line, 2-point area) has nothing to keep.
    draftDiscarded: 'Unvollständige Zeichnung verworfen',
    // «… noch offen» (27.10.2026): an open drawing that is being left asks — lib/draftMachine ·
    // askOpenDraft. The pill marks the open drawing on the sheet / the map.
    openTitle: '{name} noch offen',
    openMessage: 'Die Zeichnung ist noch nicht abgeschlossen.',
    openSave: 'Speichern',
    openDiscard: 'Verwerfen',
    openContinue: 'Weiterzeichnen',
    openPill: '{name} offen',
  },
} as const
