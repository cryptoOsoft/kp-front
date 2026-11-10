// German copy · the Plan whiteboard, notes and entities.
// One slice of the canonical `de` catalogue, assembled in ../de.ts — read the rules at the
// top of that file before adding or renaming a key here.

export const whiteboardCopy = {
  // data-layer messages (lib/incidents): generated incident title + client-side GeoJSON checks
  incidents: {
    migratedTitle: 'Migrierter Arbeitsstand',
    geojsonNotJson: 'Keine gültige JSON-Datei.',
    geojsonNotFc: 'Kein GeoJSON FeatureCollection.',
    geojsonNotWgs84: 'Koordinaten wirken wie LV95, nicht WGS84 [lng, lat]. Vorher nach EPSG:4326 umprojizieren.',
  },
  entities: {
    noteSubtitle: 'Notiz',
    fallbackObjectName: 'Objekt',
  },
  notes: {
    deleteTitle: 'Notiz entfernen',
    deleteMsg: 'Diese Notiz enthält Text. Wirklich entfernen?',
    // note styling — shared by the Karte map and the Plan whiteboard (same controls in the
    // armed-tool dock before placing and in the detail panel afterwards)
    section: 'Notiz',
    content: 'Text',
    size: 'Grösse',
    sizeS: 'Klein',
    sizeM: 'Normal',
    sizeL: 'Gross',
    look: 'Darstellung',
    lookPill: 'Zettel',
    lookPlain: 'Klartext',
    color: 'Farbe',
    done: 'Fertig',
  },
  whiteboard: {
    pan: 'Auswahl',
    team: 'Trupp',
    draw: 'Zeichnen',
    text: 'Notiz',
    symbol: 'Symbol',
    line: 'Linie',
    area: 'Fläche',
    // the Gebäude stack's Grundriss preset of the Linie (27.10.2026): its dock toggle, the armed
    // pill's second word and «… offen»
    grundriss: { wand: 'Wand' },
    dockHints: {
      wand: 'Punkte tippen – nahe am rechten Winkel rastet die Wand gerade oder rechtwinklig ein, sonst läuft sie frei. Den letzten Punkt nochmals tippen oder ✓ beendet sie, der erste Punkt schliesst sie. Das Werkzeug bleibt aktiv.',
      draw: 'Auf den Plan ziehen, um frei zu zeichnen. Farbe, Breite und Stil danach im Editor.',
      circle: 'Von der Mitte zum Rand ziehen setzt den Radius. Radius, Farbe und Füllung danach im Editor anpassen – in echten Metern, sobald der Massstab kalibriert ist.',
      text: 'Auf den Plan tippen, um eine Notiz zu setzen – sie öffnet sich direkt zum Tippen. Grösse, Farbe und Klartext danach im Panel der Notiz.',
      resource: 'Auf den Plan tippen, um einen Trupp zu setzen. Zum Verschieben ziehen.',
      scale: 'Die zwei Endpunkte des gedruckten Massstabs antippen, dann die reale Länge eingeben. Danach zeigen Linien mit «Länge» echte Meter.',
      measure: 'Punkte auf den Plan tippen. «Strecke» zeigt die Distanz, «Fläche» den Inhalt + Umfang – in echten Metern, sobald der Massstab kalibriert ist. Punkte ziehen zum Verschieben, einen Punkt gedrückt halten entfernt ihn.',
    },
    // Plan-Massstab (calibrate against a printed scale bar so plan lines read in metres)
    scale: {
      tool: 'Massstab',
      promptTitle: 'Massstab festlegen',
      promptBody: 'Reale Länge der abgegriffenen Strecke (z. B. der Massstabsbalken):',
      unit: 'm',
      confirm: 'Übernehmen',
      cancel: 'Abbrechen',
      // The chip floats ABOVE the plan, so every word costs plan. The icon already says
      // «Massstab»; the text only says where you stand.
      chipCalibrated: 'Ref. {m} m',
      chipAuto: 'Ref. auto',
      chipAutoHint: 'Ref. automatisch – Massstab aus der Kartenverknüpfung',
      // the Gebäude floor-stack (A7): the scale comes from the footprint's ground size, not a fit
      chipAutoStackHint: 'Ref. automatisch – Massstab aus dem Gebäudegrundriss',
      chipUncalibrated: 'nicht kalibriert',
      recalibrate: 'Neu kalibrieren',
      calibrate: 'Massstab kalibrieren',
      calibrateHint: 'Zwei Punkte des Massstabs antippen',
      stale: 'Massstab neu prüfen',
      saved: 'Massstab kalibriert ({m} m Referenz)',
      // #3: persist a calibration station-wide (across incidents) so plans measure out of the box
      persistTitle: 'Massstab merken?',
      saveAll: 'Für alle Pläne',
      saveThis: 'Nur dieser Plan',
      savedAll: 'Als Standard-Massstab gespeichert',
      savedThis: 'Massstab für diesen Plan gespeichert',
      /** ⚠️ Der Massstab landet im STATIONS-Dokument, nicht im Einsatz — das kann scheitern
       *  (kein Empfang, oder jemand anders hat das Dokument inzwischen geändert). Die beiden
       *  Zeilen darüber wurden früher gemeldet, bevor überhaupt jemand geantwortet hatte. */
      saveFailed: 'Massstab speichern fehlgeschlagen',
      needsCalibration: 'Massstab festlegen: die zwei Enden des Massstabs antippen',
      needsCalibrationViewer: 'Messen erst möglich, wenn der Massstab kalibriert ist',
    },
    // «Karte verknüpfen» – die Paarung markanter Punkte, die den Plan auf die Karte legt
    // (lib/georef · fitSimilarity, lib/georefMode). Zwei Punkte genügen; erst der dritte misst.
    georef: {
      chipUnlinked: 'Karte verknüpfen',
      // ⚠️ Der Chip sagt EIN Wort: dass dieses Blatt an der Karte hängt. Die Güte stand früher
      // daneben («Verknüpft · ⌀ 10.8 m») – ein Satz in einer Reihe von Dreiwort-Pillen, und eine
      // Zahl ohne «aus wie vielen Paaren» sagt nichts. Der Farbton trägt weiterhin, ob die
      // Passung gemessen ist; die Zahl steht einen Tipp entfernt in der Passung.
      chipLinked: 'Verknüpft',
      // die Güte selbst – in der Passung und in den Ebenen-Zeilen der Zwillinge: «aus 2 Punkten»
      // heisst exakt gelöst und damit UNGEMESSEN, eine Zahl gibt es erst ab dem dritten Punkt
      // (georef · residualClaim).
      chipTwoPoints: 'aus 2 Punkten',
      chipResidual: '⌀ {m} m',
      linkTitle: 'Plan mit der Karte verknüpfen',
      openQuality: 'Referenz prüfen und korrigieren',
      // ⚠️ Die Naht trägt KEINE Beschriftung mehr – weder «KARTE VERKNÜPFEN» noch «Karte
      // geliehen». Beides war Erklärung des Layouts statt Anweisung; die Leiste am Fuss sagt,
      // welcher Modus läuft und was als Nächstes zu tippen ist. Die gestrichelte Linie genügt.
      // Die eine Anweisung des minimalen Panels – ein Satz, sonst nichts.
      // ⚠️ Beispiele und «Reihenfolge egal» standen bis 15.09. hier mit auf der Zeile: drei
      // Aussagen in einer Anweisung, die man mitten im Tippen liest. Sie stehen jetzt im (i)
      // darunter (`freeOrderTip`), wo man sie beim ersten Mal sucht und danach nie wieder.
      freeOrderTap: 'Dieselbe Stelle auf Modul und Karte antippen',
      // hinter dem (i), auf beiden Formfaktoren: woran man eine gute Stelle erkennt
      freeOrderTip: 'Gut sind eindeutige Punkte – Hausecke, Hydrant, Wegkreuzung. Die Reihenfolge ist egal, gesetzte Hälften suchen sich ihr Gegenstück selber.',
      // ── die schmale Telefon-Leiste (Sweep 27.10.2026 #13, Mock A) ──────────────────────────
      // Die Anleitung steht hinter dem Status-Knopf «0/2 Paare ⓘ»: GENAU was zu tun ist, in der
      // Reihenfolge, in der man es tut – statt eines Satzes unter der Taste, den niemand liest.
      howTitle: 'So wird verknüpft',
      howStep1: 'Eine eindeutige Stelle {onPlan} unter das Fadenkreuz schieben – Hausecke, Hydrant, Wegkreuzung – und «+» tippen.',
      howStep2: 'Zur Karte wechseln, dieselbe Stelle unter das Fadenkreuz schieben und «+» tippen.',
      howStep3: 'Dasselbe mit einer zweiten Stelle, möglichst weit weg von der ersten. Bei 2/2 liegt der Plan auf der Karte.',
      howOrder: 'Die Reihenfolge ist egal – mit der Karte anfangen geht genauso.',
      howThird: 'Freiwillig: ein dritter Punkt prüft die Verknüpfung und zeigt, wie genau sie ist (⌀ in Metern).',
      // «Verschieben» bewaffnet, am Telefon: dort tippt man nicht auf die Fläche, man zielt
      movePhone: 'Punkt {n} verschieben – die neue Stelle unter das Fadenkreuz schieben, dann «+».',
      // WO auf dem Plan: mit seinem Namen (PLANS' Beschriftung, «Wasser», «Modul 1»), sonst das Wort
      onPlanNamed: 'auf «{name}»',
      onPlanUnnamed: 'auf dem Modul',
      // «Verschieben» ist bewaffnet: der nächste Tipp auf dieser Fläche setzt genau diese Hälfte
      moveMap: 'Punkt {n} verschieben – neue Stelle auf der Karte antippen, der alte verschwindet.',
      movePlan: 'Punkt {n} verschieben – neue Stelle auf dem Modul antippen, der alte verschwindet.',
      title: 'Karte verknüpfen',
      // offene Hälften: gesetzt, aber noch ohne Gegenstück auf der anderen Fläche
      barOpen: '{n} offen',
      // Zähler je Fläche – die Statuszeile «Karte 3 · Modul 2».
      // ⚠️ Steht NUR, wenn die beiden Zahlen auseinanderlaufen (15.09.): «Karte 3 · Modul 3» war
      // eine Zeile, die nie etwas meldete. Ungleich heisst «eine Hälfte hängt» – und genau dann
      // ist der Zähler die Warnung, als die er gedacht war (GeorefMode · georefStatus).
      sideProgress: 'Karte {map} · Modul {plan}',
      // Statuszeile, zweite Hälfte: WO die offene Hälfte fehlt. Das bernsteinfarbene Kreuz, das
      // dasselbe sagt, steht unter Umständen auf der Fläche, die das Telefon gerade nicht zeigt.
      statusOpenMap: 'Punkt {n} fehlt noch auf der Karte.',
      statusOpenPlan: 'Punkt {n} fehlt noch {onPlan}.',
      statusOpenMapMany: '{k} Punkte fehlen noch auf der Karte.',
      statusOpenPlanMany: '{k} Punkte fehlen noch {onPlan}.',
      statusOpenBoth: 'Offene Punkte auf der Karte und {onPlan} – gleiche Stellen finden sich automatisch.',
      statusSelected: 'Punkt {n} ausgewählt – daneben tippen wählt ab.',
      // ⚠️ `cancel` gehört noch der Rückfrage vor «Alle Punkte zurücksetzen» – dort bricht es
      // wirklich etwas ab. Der Ausstieg aus dem Modus heisst `closeMode`: er verwirft nichts.
      cancel: 'Abbrechen',
      // Der Weg hinaus, solange noch keine brauchbare Verknüpfung steht. ⚠️ NICHT «Abbrechen»:
      // gesetzte Punkte werden laufend gespeichert, der Ausstieg nimmt nichts zurück. Wer den
      // Knopf drückte, um eine schiefe Ausrichtung loszuwerden, fand den Plan danach trotzdem
      // verknüpft. Zum Wegwerfen gibt es «Alle Punkte zurücksetzen», mit Rückfrage.
      closeMode: 'Schliessen',
      done: 'Fertig',
      // ⚠️ OHNE Nummer. Die Taste wirkt auf der sichtbaren Fläche, und welche Nummer der Tipp
      // bekommt, entscheidet die Zuordnung – die Zahl stünde also gelegentlich falsch da.
      placePoint: 'Punkt setzen',
      targetOutside: 'Fadenkreuz zuerst auf die sichtbare Fläche bewegen',
      // Sichtprüfung nach dem Ausrichten: der Blattumriss liegt auf der Karte, man sieht sofort,
      // ob die Ecken zusammenfallen. Einmalig – kein Dauer-Layer.
      checkFit: 'Deckung prüfen',
      checkOpacity: 'Sichtbarkeit der Modul-Deckung',
      checkMap: 'Karte',
      checkPlan: 'Modul',
      crossTitle: 'Punkt {n} – ziehen verschiebt, antippen zeigt Optionen',
      pendingCrossTitle: 'Punkt {n} offen – ziehen verschiebt, antippen zeigt Optionen',
      // das kleine Popover eines angetippten Kreuzes – ersetzt den unsichtbaren Aufnehm-Zustand,
      // dessen einzige Ausgänge Esc (auf Touch unsichtbar), Löschen oder Neu-Setzen waren
      pointN: 'Punkt {n}',
      popMove: 'Verschieben',
      popKeep: 'Behalten',
      popResidual: 'Rest {m} m',
      popOpen: 'offen',
      // steht im Popover einer OFFENEN Hälfte: so entsteht ein Paar von Hand (bleibt fix)
      popPairHint: 'Zum Zuordnen den offenen Punkt auf der anderen Fläche antippen',
      detailsTitle: 'Details zur Passung',
      saveFailed: 'Verknüpfung speichern fehlgeschlagen',
      // Passungs-Anzeige. ⚠️ EINE Zeile zur Güte, mehr nicht: Blattbreite, Drehung und die
      // Restfehler je Punkt standen hier, weil sie sich rechnen liessen – gelesen hat sie
      // niemand mitten im Einsatz. Was zählt, ist «wie viele Paare» und «wie weit daneben».
      qualityTitle: 'Passung',
      pairs: 'Paare',
      // aus 3 Paaren gemessen; bei 2 Paaren steht stattdessen chipTwoPoints (georef · residualClaim)
      qualityDeviation: 'Abweichung ⌀ {m} m',
      // ⚠️ Anweisungen, keine Vorhaltungen (29.08.): zuerst, was zu TUN ist – fett auf der
      // Karte –, nach dem Gedankenstrich der Grund. «kleine Tippfehler wirken über den ganzen
      // Plan» war die Folge ohne den Ausweg.
      warnTwoPoints: 'Zwei Paare lösen exakt – erst ein dritter Punkt zeigt, wie gut die Passung wirklich ist.',
      warnCollinear: 'Den nächsten Punkt abseits der Linie setzen – die bisherigen liegen fast auf einer Linie, quer dazu ist die Lage unbestimmt.',
      warnBaseline: 'Den nächsten Punkt weiter weg setzen – die Punkte liegen erst {m} m auseinander, grössere Abstände machen die Passung stabiler.',
      // ── Ampel (lib/georefMode · georefLamp) ────────────────────────────────────────────────
      // ⚠️ Sie steht die ganze Zeit im Balken, nicht erst in der Passung. Der Balken zählte
      // bisher Paare («2 Paare») – eine Zahl, zu der niemand eine Meinung haben kann. Was fehlt,
      // ist der Satz, der sagt, ob das reicht und was der nächste Punkt daran ändert. Genau den
      // liest niemand, der ihn in einem Panel einen Tipp weiter suchen müsste.
      lampNoneHead: 'Noch keine Verknüpfung',
      lampNoneBody: 'Zwei Punkte legen den Plan auf die Karte.',
      lampOneHead: '1 Punkt gesetzt',
      lampOneBody: 'Der zweite legt den Plan auf die Karte.',
      lampTwoHead: '2 Punkte – exakt, aber ungeprüft',
      lampGoodHead: '{n} Punkte · ⌀ {m} m',
      // Die Zahl bekommt ihren Satz. «⌀ 1.4 m» allein sagt nicht, ob man weitermachen soll.
      lampGoodBody: 'Genau genug, um Symbole zwischen Plan und Karte zu spiegeln.',
      addThird: 'Dritten Punkt setzen',
      // ── übernommene automatische Ausrichtung (kind 'auto' pairs, lib/georef) ──────────────
      // Die zwei Blattecken-Paare sind synthetisch: die Flächen sprechen die HERKUNFT aus,
      // statt Punkte zu zählen, die niemand gesetzt hat («2 Paare» wirkte wie erfunden).
      lampAutoHead: 'Automatisch ausgerichtet',
      // die Station hat den automatischen Vorschlag geprüft und freigegeben (Admin › Objektpläne)
      lampApprovedHead: 'Von der Station freigegeben',
      // …und eine freigegebene Passung gilt als VERKNÜPFT (18.09.2026): kein «ungemessen»,
      // kein Warnton. Ein ⌀ steht trotzdem nicht da – aus zwei synthetischen Paaren gibt es
      // keinen zu berechnen; der Satz sagt stattdessen, wer für die Passung geradesteht.
      lampApprovedBody: 'Die Station hat die Deckung geprüft und diese Passung freigegeben.',
      chipAuto: 'ungemessen',
      warnAuto: 'Referenzpunkte setzen, um die Passung zu messen – bisher gilt die Sichtprüfung der Deckung.',
      autoAddPoints: 'Referenzpunkte setzen',
      // genau EIN eigener Punkt neben der Automatik (zwei ersetzen sie – settleSlots)
      autoOneHead: 'Automatisch ausgerichtet · 1 Punkt',
      autoOneBody: 'Ein zweiter Punkt ersetzt die Automatik durch echte Referenzpunkte.',
      autoOnePoint: '1 Punkt',
      // «Fertig»/«Schliessen» mit offenen Hälften: sagen, was wegfiel, statt still zu schlucken
      openDroppedOne: 'Offener Punkt verworfen – ein Referenzpunkt braucht beide Flächen',
      openDroppedMany: '{k} offene Punkte verworfen – ein Referenzpunkt braucht beide Flächen',
      // ab dem dritten Paar: es gibt keinen «vierten Punkt» zu lehren, nur noch einen weiteren
      addMore: 'Punkte hinzufügen',
      transfer: 'Übertragen',
      transferTitle: 'Passung übertragen',
      transferBody: 'Die Referenzpunkte von {source} werden kopiert. Danach kann jedes Modul separat angepasst werden.',
      transferLinked: 'bereits verknüpft',
      transferCompleted: 'übertragen',
      transferReplaceTitle: 'Passung von {target} ersetzen?',
      transferReplaceBody: 'Die vorhandenen Referenzpunkte von {target} werden durch die Passung von {source} ersetzt.',
      transferDone: 'Passung auf {target} übertragen – Deckung dort prüfen',
      reset: 'Zurücksetzen',
      resetTitle: 'Referenz zurücksetzen?',
      resetBody: 'Die Verknüpfung zwischen diesem Plan und der Karte wird gelöscht. Die Punkte müssen danach neu gesetzt werden.',
      resetDone: 'Referenz zurückgesetzt',
      // In der Leiste des laufenden Modus: alle Paare weg, der Modus bleibt an – man setzt ja
      // sofort neu. «Abbrechen» daneben behält, was steht.
      clearPoints: 'Zurücksetzen',
      clearTitle: 'Alle Punkte zurücksetzen?',
      clearBody: 'Die gesetzten Punkte werden gelöscht, die Verknüpfung des Plans mit der Karte fällt damit weg. Das Setzen beginnt von vorn.',
      // ein aufgenommener Punkt: entweder neu setzen (antippen) oder ganz weg
      removePoint: 'Punkt löschen',
      // In den Ebenen bekommt jedes verknüpfte Blatt seine eigene Zeile (lib/georefTwins ·
      // planRasterRows): das Blatt selbst als Bild unter der Tinte der Karte. Der Plan-Code steht
      // drin, damit «welches Blatt liegt hier?» keine Rückfrage ist. Die Objekte darauf brauchen
      // keine Zeile mehr – sie sind gewöhnliche Objekte und gehören zu ihrer eigenen Ebene.
      layerGroupPlans: 'Pläne',
      layerPlanImage: 'Plan ({plan})',
      // ⚠️ Das EINZIGE, was einem Blatt noch geliehen statt gehört: der Live-Feed (Fahrzeuge und
      // geteilte Standorte, lib/planProjection · liveOverlay). Kein Datensatz, darum auch kein
      // Objekt – der Titel sagt, woher er kommt und dass Ziehen die Karte mitnimmt.
      twinFromMap: '{name} – gespiegelt von der Karte. Antippen zeigt die Angaben, Ziehen verschiebt das Original.',
      // Rückfallname eines Symbols ohne Beschriftung: das Wort steht im Etikett, damit die
      // Plakette nie leer bleibt (lib/entityGlyph, lib/georefTwins · contentTwinName).
      twinUnnamed: 'Symbol',
    },
    finishShape: 'Fertig',
    cancelShape: 'Abbrechen',
    insertVertex: 'Punkt einfügen',
    dragVertex: 'Eckpunkt ziehen, gedrückt halten zum Löschen',
    dragRadius: 'Radius ziehen',
    groupDeleteTitle: 'Auswahl entfernen',
    groupDeleted: 'Auswahl entfernt',
    groupDeletedN: '{n} Objekte vom Plan entfernt',
    placeText: 'Notiz auf Plan gesetzt',
    placeSymbol: 'Symbol «{name}» auf Plan gesetzt',
    placeLine: 'Linie auf Plan gezeichnet',
    placeArea: 'Fläche auf Plan gezeichnet',
    placeWand: 'Wand auf Plan gezeichnet',
    placeCircle: 'Absperrkreis auf Plan gezeichnet',
    placeTeam: '{name} auf Plan gesetzt',
    selectTrupp: 'Welcher Trupp?',
    newTeam: 'Neuer Trupp',
    // A Trupp stands in exactly ONE place. Tapping it again in this list MOVES it — what was
    // meant was almost always a second Trupp. Hence greyed out instead of selectable.
    truppPlacedHere: 'schon hier',
    showTrupp: 'Bei den Trupps zeigen',
    markPosition: 'Position markieren',
    positionMarked: '{name}: Position markiert',
    // The trash on a Trupp marker that carries a Spur asks WHICH of the two goes (18.09.2026,
    // the app's own Menu): the marker alone leaves the searched area behind as a Geister-Spur,
    // and the record is only destroyed where the operator said so. Both löschen rows are danger
    // rows, and both confirm first.
    removeMarker: 'Marker entfernen',
    removeMarkerTrail: 'Marker und Spur entfernen',
    clearTrail: 'Spur entfernen',
    clearTrailConfirm: 'Alle {n} markierten Positionen von {name} entfernen? Die Spur verschwindet von Karte und Plan.',
    trailCleared: '{name}: Spur entfernt',
    trails: 'Spuren',
    trailsOn: 'Spuren einblenden',
    trailsOff: 'Spuren ausblenden',
    ghostTrailHint: 'Spur von {name} – der Truppmarker wurde entfernt',
    ghostTrailTitle: 'Spur von {name}',
    ghostTrailAsk: 'Der Truppmarker wurde entfernt, seine Spur ist geblieben. Den Trupp am Ende der Spur wieder platzieren – oder die Spur entfernen?',
    ghostTrailRestore: 'Trupp wieder platzieren',
    ghostTrailRestored: '{name} wieder platziert – Spur übernommen',
    // Umbenennen eines losen Trupp-Markers auf eine Nummer, die schon vergeben ist (ein Trupp,
    // ein anderer Marker oder eine Spur trägt sie) – abgelehnt, der alte Name bleibt
    teamNameTaken: '{name} ist schon vergeben – der Name bleibt',
    textPlaceholder: 'Notiz …',
    blankHint: 'Leeres Blatt – mit Linie, Fläche, Notiz, Symbol oder Trupp beschriften',
    osmLoading: 'Gebäudeumrisse werden geladen …',
    osmError: 'Gebäudeumrisse (OSM) nicht erreichbar',
    osmEmpty: 'Keine Gebäude in diesem Bereich',
    osmRetry: 'Erneut versuchen',
    osmPickHint: 'Gebäude antippen, dann übernehmen',
    // ⚠️ Nur noch für ein Gebäude OHNE Georeferenz (vor 23.08. gewählt): dessen Umriss lässt
    // sich nicht wiederfinden, die Auswahl fängt also wirklich bei null an. Mit Georeferenz ist
    // der bestehende Umriss vorgewählt – siehe osmPickHintAmend.
    osmPickHintReplace: 'Gebäude antippen, dann übernehmen – ersetzt das bestehende Gebäude',
    // Steht über der Leiste, sobald das bestehende Gebäude wiedergefunden und vorgewählt ist:
    // «Anderes Gebäude wählen» heisst fast immer ergänzen, nicht von vorn anfangen.
    osmPickHintAmend: 'Das bestehende Gebäude ist markiert – weitere antippen zum Ergänzen, dann übernehmen',
    // Steht über der Leiste, wenn noch kein Gebäude gewählt ist und die App den Umriss am
    // Einsatzort vorgewählt hat (lib/footprintPick): ein Vorschlag, den man prüft – nie übernommen,
    // bevor jemand «Übernehmen» tippt.
    osmPickHintHere: 'Gebäude am Einsatzort ist markiert – prüfen, dann übernehmen.',
    // ⚠️ Zahl in Klammern, damit ein Umriss wie mehrere passt. Das ist ein Verlust, kein Hinweis:
    // was hier fehlt (offline, Kartenausschnitt verschoben, in OSM geändert), fällt beim
    // Übernehmen weg – lieber laut gesagt als stillschweigend aus der Auswahl genommen.
    osmPickMissing: 'Umrisse des bestehenden Gebäudes fehlen hier ({n}) – sie fallen beim Übernehmen weg.',
    osmTransfer: 'Übernehmen ({n})',
    osmClear: 'Auswahl leeren',
    addFloorUp: 'Obergeschoss hinzufügen',
    noFloorPlan: 'Kein Geschossplan',
    stairTo: 'Weiter zu {floor}',
    stairFrom: 'Von {floor}',
    climbUp: 'Ein Geschoss höher weiter',
    climbDown: 'Ein Geschoss tiefer weiter',
    climbBack: 'Zurück auf {floor}',
    addFloorDown: 'Untergeschoss hinzufügen',
    // the ↶ of «+ OG / + UG», naming the storey (no toast since 27.10.2026; its Verlauf row comes with #226)
    floorAddedStep: '{floor} hinzugefügt',
    floorHide: 'Geschoss ausblenden',
    // the storey label's menu (29.09.2026, sweep K5): «Ausblenden · Geschoss entfernen»
    floorHideShort: 'Ausblenden',
    floorMenu: '{name}: ausblenden oder entfernen',
    floorShow: 'einblenden',
    floorHidden: 'ausgeblendet',
    removeFloor: 'Geschoss entfernen',
    removeFloorConfirm: '{floor}: {n} Markierungen dieses Geschosses werden entfernt oder gekürzt. Geschoss trotzdem entfernen?',
    removeFloorConfirmOne: '{floor}: 1 Markierung dieses Geschosses wird entfernt oder gekürzt. Geschoss trotzdem entfernen?',
    floorRemoved: 'Geschoss entfernt',
    /** the Verlauf row for the act itself (25.09.2026) — it used to write only its ↶ row */
    floorRemovedLog: 'Geschoss {floor} entfernt',
    floorRemovedLogMarks: 'Geschoss {floor} entfernt – {n} Markierungen entfernt oder gekürzt',
    floorRestoredLog: 'Geschoss {floor} wiederhergestellt',
    // «Kopieren nach …» in the storey label's menu (27.10.2026): the storey's Grundriss onto others
    storeyCopy: {
      menu: 'Kopieren nach …',
      // A · Stapel (owner pick, round 3): the title names the storey, one line says what goes,
      // every storey a row, the button names the result
      title: '{name} kopieren',
      walls: '{n} Wände',
      wallsOne: '1 Wand',
      // «3× Durchgang»: the count with the symbol's name, so no plural has to be guessed
      symbolCount: '{n}× {name}',
      empty: 'leer',
      // what a target already holds – the copy lands on top of it
      adds: '{what} – kommt dazu',
      source: 'Vorlage',
      stays: 'Leitungen, Trupps und Gefahren bleiben.',
      all: 'Alle',
      none: 'Keine',
      toOne: 'Auf {name} kopieren',
      toMany: 'Auf {n} Geschosse kopieren',
      // the picked storeys already hold all of it (a Treppe spanning them) – said, never a silent close
      nothingNew: 'Nichts kopiert – das steht dort schon.',
      pick: 'Geschoss wählen',
      nothing: 'Auf {name} gibt es noch keinen Grundriss zum Kopieren – keine Wand, kein Gebäude-Symbol.',
      targets: 'Geschosse',
      done: 'Grundriss kopiert: {list}',
      doneItem: '{n} nach {floor}',
    },
    floorAddedLog: 'Geschoss {floor} hinzugefügt',
    buildingReplaced: 'Gebäude ersetzt',
    buildingReplacedMarks: 'Gebäude ersetzt – {n} Markierungen entfernt',
    buildingReplacedKept: 'Gebäude gewechselt – Geschosse behalten',
    buildingReplacedCarried: 'Gebäude gewechselt – {n} Markierungen übertragen',
    buildingReplacedCarriedDropped: 'Gebäude gewechselt – {n} übertragen, {d} weggefallen',
    /** Ein Gebäude zum ersten Mal übernommen (noch kein Stapel da) — der ↶-Schritt dafür. */
    buildingTaken: 'Gebäude übernommen',
    replaceBuilding: 'Anderes Gebäude wählen',
    replaceBuildingConfirm: 'Der bisherige Geschoss-Stapel wird verworfen und durch den neuen Umriss ersetzt.',
    // ⚠️ Der LEGACY-Fall: ein Gebäude ohne Georeferenz lässt sich nicht auf dem Boden verorten,
    // also gibt es nichts, woran die Markierungen hängen könnten. Sie liegen im Koordinaten-
    // system des ALTEN Umrisses und würden auf einem anderen stillschweigend woanders bedeuten.
    // Sie gehen weg – aber nie ungefragt und nie ohne Rückweg.
    replaceBuildingConfirmMarks: 'Auf den Geschossen stehen {n} Markierungen. Sie hängen am bisherigen Umriss und lassen sich nicht auf einen anderen übertragen – sie werden entfernt. «Rückgängig» im Hinweis holt sie zurück.',
    // Trägt das bestehende Gebäude eine Georeferenz, wird umgerechnet statt verworfen: jede
    // Markierung geht über den BODEN in den neuen Umriss, behält also den Ort, den sie meint,
    // statt den Platz, den sie im alten Rechteck hatte. Die Geschosse kommen mit.
    replaceBuildingConfirmKeep: 'Der neue Umriss tritt an die Stelle des bisherigen. Die Geschosse bleiben erhalten.',
    replaceBuildingConfirmCarry: 'Der neue Umriss tritt an die Stelle des bisherigen. Die Geschosse bleiben, und {n} Markierungen werden mit übertragen – sie behalten ihren Ort am Boden.',
    // ⚠️ Was nicht mehr auf dem neuen Umriss liegt, wird weggelassen und nicht an den Rand
    // geschoben: eine an eine falsche Wand geheftete Markierung liest sich wie Wissen.
    replaceBuildingConfirmCarryDrop: '{n} Markierungen werden auf den neuen Umriss übertragen und behalten ihren Ort am Boden. {d} liegen nicht mehr darauf und fallen weg. «Rückgängig» im Hinweis holt alles zurück.',
    // ⚠️ Der Weg zurück zur Auswahl. «Umrisse» und «Gebäude» sind EINE Kachel in der Leiste
    // (23.08.) – wer ein anderes Gebäude will, tippt hier, nicht auf eine zweite Kachel.
    backToBuilding: 'Zurück zum Gebäude',
    // Beschriftung dieser einen Kachel. Sie nennt das Ziel («Gebäude»), nicht das Mittel
    // («Umrisse») – ob schon ein Stockwerkstapel existiert, sagt das GLYPH (Footprint vs.
    // Stockwerke), nicht das Wort: «Kein Gebäude» las sich in einer Leiste aus Substantiven
    // schräg (entfernt 25.08.).
    railBuilding: 'Gebäude',
    otherObject: 'Anderes Objekt',
    // The object decides which plans are loaded – that is why it sits on the plan surface, above
    // the plans it determines. The label names the thing first («Objekt»), then the name: what
    // you look for when you sit down is «bin ich beim richtigen Gebäude?».
    objectLabel: 'Objekt',
    objectNone: 'Kein Objekt',
    // The chip now only names the name – «Objekt» labelled the field, and that is exactly what
    // the value already says. The verb now sits where it was missing entirely: in the read-aloud
    // text.
    objectIs: 'Einsatzobjekt: {name}',
    objectSwitch: 'Einsatzobjekt: {name} – anderes Objekt wählen',
    objectSwitchShort: 'Anderes Objekt wählen',
    // Das Blatt hinter dem Objekt-Chip (Sweep 28.10.2026 #8, Wahl des Owners «Leiste B + Blatt A»):
    // die Leiste trägt nur noch das Objekt mit EINEM Lämpchen, ein Tipp zeigt Objekt, Karte und
    // Massstab mit dem, was man als Nächstes tun kann (components/PlanFactsSheet).
    facts: {
      title: 'Plan · {name}',
      // was der Chip einem Screenreader sagt – das Lämpchen allein ist kein Wort
      chipLabel: '{name} – Objekt, Karte und Massstab',
      chipLabelBuilding: '{name} – Gebäude und Massstab',
      switchObject: 'anderes Objekt wählen',
      switchBuilding: 'anderes Gebäude wählen',
      karte: 'Karte',
      unlinked: 'nicht verknüpft',
      unlinkedNote: 'Verknüpfen legt den Plan auf die Karte – Symbole erscheinen dann auch dort, und der Massstab kommt mit.',
      link: 'Karte verknüpfen',
      scaleStale: 'neu prüfen',
      scaleFromFit: 'aus der Kartenverknüpfung – kein eigenes Kalibrieren nötig',
      scaleFromFootprint: 'aus dem Gebäudegrundriss – kein eigenes Kalibrieren nötig',
      scaleByHand: 'von Hand kalibriert',
      scaleStaleNote: 'von Hand kalibriert – das Blatt hat seither eine andere Form',
      scaleNoneLinkable: 'kommt mit der Kartenverknüpfung – oder von Hand am gedruckten Massstab',
      scaleNone: 'am gedruckten Massstab kalibrieren, dann zeigen Linien echte Meter',
    },
    // The auto-surfaced object is only the NEAREST one with plans, not the Einsatzadresse: the
    // chip turns amber and carries the distance; the full sentence is what a screen reader gets.
    objectNearby: '{name} · {distance} entfernt',
    objectNearbyLabel: 'Nächstes Objekt in {distance} – nicht die Einsatzadresse',
    // …and a banner over the sheet, once per Einsatz and object (Whiteboard · nearbyBanner): both
    // addresses side by side, a door to the picker. After ✕ only the chip keeps saying it.
    nearbyBannerTitle: 'Nächstes Objekt, nicht die Einsatzadresse.',
    nearbyBannerBody: 'Einsatz: {incident} · Plan: {object} ({distance}).',
    nearbyBannerNoAddress: 'ohne Adresse',
    objectActive: 'Pläne von «{name}»',
    objectReset: 'Auf nächstes Objekt zurücksetzen',
    // tapping an object in the picker swaps the plans of EVERY module at once, so it
    // is gated behind a confirmation to avoid an accidental tap blowing away context.
    objectSwitchConfirmTitle: 'Anderes Objekt laden',
    objectSwitchConfirm: 'Die Pläne aller Module werden auf «{name}» umgestellt. Aktuelles Objekt wechseln?',
    objectSwitchConfirmCta: 'Objekt laden',
    // Gebäudeview orientation: the footprint auto-rotates so its longest axis runs
    // horizontal; the north arrow shows the applied rotation; the toggle is reversible.
    northLabel: 'N',
    northTitle: 'Nordrichtung – Gebäude auf Längsachse gedreht',
    orientAsDrawn: 'Wie gezeichnet',
    northUnknownTitle: 'Norden unbekannt – Plan nicht mit der Karte verknüpft',
    orientNorthUp: 'Norden oben',
    orientLongAxis: 'Auf Längsachse drehen',
    // the rotation popover the north dial opens (30.08. – replaces the hidden dial drag)
    orientMenuTitle: 'Gebäude drehen',
    orientSliderLabel: 'Drehung',
    // the dial's word in the rail (shown with «Beschriftung · Wörter»): the door, or the read-out
    orientRail: 'Drehen',
    northRail: 'Norden',
  },
  // the Tafel's pages (10.10.2026, docs/board-templates.md): the free «Skizze» plus the pages a
  // board template offers (FKS «Erste Führung», FKS 8.1 …) — the page strip, the «+ Seite» list,
  // the form pages themselves and their undo / Verlauf wording
  tafel: {
    strip: 'Tafel-Seiten',
    skizze: 'Skizze',
    addPage: 'Seite',
    addPageTitle: 'Seite hinzufügen',
    alreadyThere: 'schon da',
    pageAdded: 'Seite «{page}» hinzugefügt',
    pageEdited: '{page} geändert',
    pageRemoved: 'Seite «{page}» entfernt',
    removePage: 'Seite entfernen',
    print: 'Drucken',
    printThis: 'Diese Seite',
    printAll: 'Alle Seiten ({n})',
    printBusy: 'PDF wird erstellt …',
    printOffline: 'Drucken braucht die Verbindung zum Server. Die Seite ist gespeichert – drucken, sobald das Gerät wieder online ist.',
    printFailed: 'Die Seite konnte nicht gedruckt werden – bitte nochmals versuchen.',
    // the page's timeline on screen and paper (lib/boardForm · pageStamp)
    stampCreated: 'Erstellt {at}',
    stampEdited: 'zuletzt bearbeitet {at}',
    removeTitle: 'Seite entfernen?',
    removeMsg: 'Alles, was auf «{page}» steht, geht mit. Rückgängig (↶) holt es zurück.',
    mapLabel: 'Lagekarte – tippen öffnet die Karte',
    mapOpen: 'Zur Karte',
    mapPrint: 'Im Rapport: die Karte zum Zeitpunkt des Drucks',
    head: { title: 'Einsatz', address: 'Adresse', alarm: 'Alarm', el: 'Einsatzleiter' },
    tag: 'Stichwort',
    done: 'Erledigt',
    trendNone: 'Tendenz offen',
    trendUp: 'wird schlimmer',
    trendSame: 'gleich',
    trendDown: 'entspannt sich',
    trendTitle: 'Tendenz: {trend} – tippen zum Wechseln',
    keysHint: 'Enter: nächste Zeile · Tab: nächste Spalte · Shift+Enter: Zeilenumbruch',
    lineBreak: 'Zeilenumbruch',
    reorder: 'Verschieben (ziehen, oder Alt+↑ / Alt+↓)',
    cellCap: 'Ein Feld fasst {n} Zeichen – für mehr einen Eintrag im Verlauf schreiben.',
    // the Einsatz's problems on every problem section (lib/problemLink, 05.11.2026, owner pick 7A)
    areaPick: 'Bereich',
    areaNone: 'Kein Bereich',
    fromChecklist: 'aus der Checkliste',
    checklistLegend: 'aus der Checkliste – Löschen nimmt dort den Haken weg',
    // the bin at the end of the row one stands in (all tables, the problem boxes)
    deleteRow: 'Zeile löschen',
    rowDeleted: '«{text}» gelöscht',
    rowDeletedEmpty: 'Zeile gelöscht',
    rowDeletedTick: '«{text}» gelöscht – Haken in der Checkliste entfernt',
  },
} as const
