// German copy · the Rapport: Auswertung, report, preflight.
// One slice of the canonical `de` catalogue, assembled in ../de.ts — read the rules at the
// top of that file before adding or renaming a key here.

export const reportCopy = {
  // Einsatzrapport: print preflight (ReportPreflight) + the printed document (ReportPrintView)
  // Auswertung — the optional internal Beilage of the Rapport PDF (lib/auswertung, F7 09.10.2026):
  // key figures, swimlanes, Lehren. ⚠️ No «→» in these: the paper is Helvetica (reportPdfDirect · forPaper).
  auswertung: {
    heading: 'Auswertung',
    note: 'Für die Nachbesprechung – aus den Daten des Einsatzes abgeleitet, nicht Teil des unterzeichneten Rapports.',
    missing: '—',
    firstOnScene: 'Alarm bis 1. Fahrzeug vor Ort',
    firstOnSceneDef: 'Von der Alarmierung bis zur frühesten «Vor Ort»-Zeit eines Fahrzeugs (Alarmierungs- / Ausrückzeiten).',
    firstAs: 'Alarm bis 1. Atemschutz-Eintritt',
    firstAsDef: 'Von der Alarmierung bis zum ersten Eintritt eines Trupps unter Atemschutz.',
    contacts: 'Funkkontakte eingehalten',
    contactsSub: '{n} überfällig von {total}',
    contactsDef: 'Anteil der Funkkontakt-Intervalle unter Atemschutz, die endeten, bevor der Trupp überfällig war ({n} min + {g}). Ein Intervall läuft vom Eintritt oder einem Kontakt bis zum nächsten Kontakt, Druck, Rückzug oder Austritt; ein offenes zählt erst, wenn es überfällig wurde. Die Zeit zwischen Abschluss und Wiedereröffnen zählt nicht.',
    contactsDefNoGrace: 'Anteil der Funkkontakt-Intervalle unter Atemschutz, die endeten, bevor der Trupp überfällig war ({n} min). Ein Intervall läuft vom Eintritt oder einem Kontakt bis zum nächsten Kontakt, Druck, Rückzug oder Austritt; ein offenes zählt erst, wenn es überfällig wurde. Die Zeit zwischen Abschluss und Wiedereröffnen zählt nicht.',
    longestAs: 'Längster Atemschutz-Einsatz',
    longestAsDef: 'Längste abgeschlossene Zeit eines Trupps unter Atemschutz, Eintritt bis Austritt.',
    total: 'Einsatzdauer',
    totalDef: 'Von der Alarmierung bis zum Einsatzende.',
    totalRunning: 'Einsatz läuft noch',
    truppLane: 'Trupp {no} · {name}',
    groupPhases: 'Phasen (Checkliste)',
    groupVehicles: 'Fahrzeuge',
    groupTrupps: 'Trupps',
    groupMilestones: 'Meilensteine',
    noTimeline: 'Keine Fahrzeug-, Trupp- oder Checklisten-Zeiten erfasst.',
    legendTravel: 'Anfahrt',
    legendScene: 'vor Ort',
    legendReturn: 'Rückfahrt',
    legendAs: 'unter Atemschutz',
    legendWork: 'im Einsatz ohne Atemschutz',
    legendStandby: 'bereit',
    legendContact: 'Funkkontakt',
    legendFaellig: 'Kontakt fällig',
    legendUeberfaellig: 'überfällig',
    legendMilestone: 'Meilenstein',
    legendPhase: 'Phase: erster bis letzter Haken',
    footnotesHead: 'Definitionen',
    lehrenSeePage1: 'Lehren / Sicherheit: siehe Seite 1',
    graceMin: '{n} min',
    graceSec: '{n} s',
  },
  report: {
    // Rapportangaben by field key – the Verlaufszeile that records a change names the field with
    // these (lib/report · META_FIELD_LABELS reads, lib/captureClient for the QR poster too: one
    // map, sweep C.3). The two «Entfällt» answers write their own sentences but still need a label.
    metaFieldLabels: {
      einsatzleiter: 'Einsatzleiter', kontaktperson: 'Kontaktperson', kommandant: 'Kommandant',
      kontaktpersonTelefon: 'Telefon Kontaktperson',
      summary: 'Kurzbericht', remarks: 'Bemerkungen', lehren: 'Lehren',
      endedAt: 'Einsatzende', ausgeruecktAt: 'Ausgerückt', alarmiertAt: 'Alarmierung',
      gerettete: 'Gerettete', rueckmeldungElz: 'Rückmeldung ELZ',
      partnerContacts: 'Partnerorganisationen', gruppen: 'Alarmzeiten', fahrzeuge: 'Fahrzeugzeiten',
      mittelConfirmedNone: 'Material «keine»', erfasser: 'Erfasser', krokiPrint: 'Kroki-Ausschnitt',
      kontaktpersonNone: 'Kontaktperson', rueckmeldungNone: 'Rückmeldung ELZ',
    } as Record<string, string>,
    erfasser: 'Erfasst durch',
    // print view chrome
    back: 'Zurück',
    print: 'Drucken',
    pdf: 'PDF herunterladen',
    pdfBusy: 'PDF wird erstellt …',
    pdfFailed: 'PDF konnte nicht erstellt werden.',
    // Haupt-Rapport form rows (value or write-in line)
    keyword: 'Stichwort',
    einsatzleiter: 'Einsatzleiter',
    // the printed EL SUCCESSION when the Einsatzleitung rotated mid-Einsatz — one continuous
    // chain, «Meier (bis 14:20), Huber (ab 14:20)» (lib/reportPdfDirect · einsatzleiterForPdf).
    // Fragments in brackets, so they read inside the field's own line.
    einsatzleitungBis: '{name} (bis {t})',
    einsatzleitungAb: '{name} (ab {t})',
    kontaktperson: 'Kontaktperson',
    gerettete: 'Gerettete (Personen / Tiere)',
    gerettetePersonen: 'Personen',
    geretteteTiere: 'Tiere',
    // the singulars — «1 Person» / «1 Tier»; the count picks its noun (lib/report · _geretteteText)
    gerettetePerson: 'Person',
    geretteteTier: 'Tier',
    alarmierung: 'Alarmierung',
    ausgerueckt: 'Ausgerückt',
    rueckmeldungElz: 'Rückmeldung ELZ',
    incidentId: 'Einsatz-ID',
    // text blocks
    alarmMessage: 'Alarmmeldung',
    partnerOrgs: 'Partnerorganisationen',
    remarks: 'Bemerkungen',
    lehren: 'Lehren / Sicherheit',
    // section headers + tables
    kroki: 'Kroki',
    krokiState: '{title} · Stand {at}',
    atemschutz: 'Atemschutzüberwachung',
    truppEntry: 'Eintritt',
    mittel: 'Material (Menge eintragen)',
    journal: 'Einsatzjournal',
    photo: 'Foto',
    transcript: 'Transkript',
    // fallback plan name when a plan-doc has no code/title
    planFallback: 'Plan',
    // proofLabel (Prüfnachweis-Status, printed + preflight)
    proofOffline: 'Prüfung nicht möglich (offline)',
    proofIntact: 'Hash-Kette intakt',
    proofBroken: 'Hash-Kette unterbrochen',
    proofBrokenAt: 'Hash-Kette unterbrochen bei #{seq}',
    // journalArea — the "Bereich" column value for a printed journal row. The names are the app's
    // own surface names (copy.modes), so a row can be found again where it was created. A
    // hand-written row prints its Art instead (journal.entryTypes – «Info» for the plain one).
    // ⚠️ «Trupps», mit dem Bereich (copy.modes, 04.09.). Die Spalte sammelt JEDE Truppzeile —
    // auch die eines Trupps ohne Atemschutz —, und «Atemschutz» über einer Zeile «Verkehrstrupp
    // angemeldet» wäre auf einem Rechtsdokument schlicht falsch. Der gedruckte ABSCHNITT heisst
    // weiterhin «Atemschutzüberwachung» (report.atemschutz): der benennt den Sicherheitsnachweis.
    areaAtemschutz: 'Trupps',
    areaAnwesenheit: 'Anwesenheit',
    areaMittel: 'Material',
    areaChecklist: 'Checkliste',
    areaRapport: 'Rapport',
    // ⚠️ Die Zeilen, die der SERVER selbst schreibt (Rapport abgeschlossen, Einsatz
    // abgeschlossen, Einsatz wiedereröffnet). Sie tragen weder `kind` noch `surface`, fielen
    // deshalb bis 04.09. ans Ende der Kette durch und standen im gedruckten Journal unter
    // «Kroki» – ein Abschluss, den niemand auf der Karte ausgelöst hat. Kein Bereich der App,
    // sondern der Einsatz selbst: «System».
    areaSystem: 'System',
    // ⚠️ «Kroki» again (10.08.), reversing the 09.08. rename to «Lage». The reasoning then was
    // that this column names SURFACES and the Kroki is the printed picture. In the hand it read
    // the other way round: somebody looking for what happened to the tactical picture searched
    // the export for «Kroki», found a column full of «Lage», and concluded the entries were
    // gone. The word people look for wins over the taxonomy.
    areaLage: 'Kroki',
    // describeDrawing — short tactical labels for a drawing in the report
    drawCircle: 'Absperrkreis',
    drawAreaLabeled: 'Abschnitt «{label}»',
    drawArea: 'Fläche',
    drawRescueAxis: 'Rettungsachse',
    drawMeasureArrow: 'Masspfeil',
    drawLine: 'Linie',
  },
  // Einsatzrapport drucken — preflight sheet (ReportPreflight)
  wheel: {
    invalidTime: 'Bitte eine gültige Uhrzeit eingeben (00:00–23:59).',
    day: 'Tag',
    hour: 'Stunde',
    minute: 'Minute',
    now: 'Jetzt',
    ok: 'OK',
  },
  // Digitale Unterschriften auf dem Rapport (15.10.2026, lib/reportSignature). Freiwillig: die
  // Karte «Unterschriften» in der rechten Spalte, nach den Partnerorganisationen (Reihenfolge des
  // Papiers). Unterschrieben = gesperrt; eine Änderung danach macht die Unterschrift ungültig.
  signature: {
    cardTitle: 'Unterschriften',
    optional: 'optional',
    count: '{n} von 2',
    invalid: 'ungültig',
    runningHint: 'Nach dem Abschluss hier unterschreiben – ohne Stift und Papier.',
    roleEl: 'Einsatzleiter',
    roleKdt: 'Kommandant',
    sign: 'Unterschreiben',
    resign: 'Neu unterschreiben',
    locked: 'Rapport gesperrt',
    change: 'Ändern',
    changeTitle: 'Unterschriften aufheben?',
    changeMsg: 'Wer den Rapport ändert, muss ihn danach neu unterschreiben. Die alten Unterschriften bleiben im Verlauf.',
    changeConfirm: 'Ändern',
    sheetTitle: 'Rapport unterschreiben',
    viewPdf: 'PDF ansehen',
    zeiten: 'Alarm {from} · Ende {to}',
    personen: '{n} Personen',
    positionen: '{n} Positionen',
    signsAs: 'Unterschreibt als',
    name: 'Name',
    namePlaceholder: 'Name wählen',
    elNameHint: 'Derselbe Eintrag wie «Einsatzleiter» im Rapport.',
    kdtNameHint: 'Vorgabe aus den Einstellungen – eine Stellvertretung wählt sich selbst.',
    padHint: 'Hier mit dem Finger unterschreiben',
    padAria: 'Unterschriftenfeld',
    clear: 'Löschen',
    cancel: 'Abbrechen',
    confirm: 'Unterschreiben',
    // ⚠️ Verlauf-Zeilen und die Zeile unter der Unterschrift auf dem Papier: kein «→» (Helvetica)
    logSigned: 'Rapport unterschrieben: {role} {name} (Prüfsumme {sum})',
    logVoided: 'Unterschriften aufgehoben – der Rapport wird geändert',
    failed: 'Unterschrift nicht gespeichert – bitte nochmals versuchen',
  },
  preflight: {
    pdfFull: 'Einsatzrapport (PDF)',
    pdfBusy: 'PDF wird erstellt …',
    // The Rapport is its own surface like Anwesenheit or Mittel – no print dialog any more. The
    // title was «Einsatzrapport drucken» for as long as the sheet only opened to be printed.
    title: 'Einsatzrapport',
    // One line under the title, in the tone of the other surfaces («12 anwesend · 3 gegangen ·
    // 28 Mannschaft»): what is captured first, then the verdict. The open points are NAMED –
    // «unvollständig» on its own sends you searching.
    // The head carries the numbers; what is still missing stands next to it as its own chips and
    // is allowed to wrap — as one sentence it turned into «… noch offen: Kurzberi…», i.e. it cut
    // off exactly the information the line exists for.
    headAllRecorded: 'alle Angaben erfasst',
    headStillOpen: 'offen',
    // Handy (≤600px): die drei Reiter, die den Rapport in drei Bildschirme statt fünf teilen.
    // Tablet und Desktop sehen sie nie — siehe ReportPreflight · PhoneTab.
    tabsLabel: 'Teil des Rapports',
    tabs: { bericht: 'Bericht', werwas: 'Personal & Mittel', beilagen: 'Beilagen' },
    sectionBericht: 'Bericht & Beteiligte',
    sectionZeiten: 'Zeiten',
    sectionNachbearbeitung: 'Nachbearbeitung',
    // …split out of the same field the Alarmmeldung arrives in (see lib/alarmText): the message
    // text is the only part of it a human wrote.
    vehicleOrder: 'Ausrückeordnung',
    einsatzplan: 'Einsatzplan',
    stichwort: 'Stichwort',
    einsatzart: 'Art',
    ort: 'Ort',
    fromDispatch: 'Aus den Einsatzdaten',
    edit: 'Bearbeiten',
    alarmMessage: 'Alarmmeldung',
    alarmierung: 'Alarmierung',
    notRecorded: 'Nicht erfasst',
    summaryLabel: 'Kurzbericht',
    summaryPlaceholder: 'Was ist passiert / was wurde angetroffen?',
    einsatzleiterLabel: 'Einsatzleiter',
    einsatzleiterPlaceholder: 'Wählen oder eingeben',
    kontaktpersonLabel: 'Kontaktperson',
    kontaktpersonClear: 'Kontaktperson leeren',
    kontaktpersonPlaceholder: 'Eigentümer / Melder',
    // Der Name und die Nummer sind EIN Fakt (dieselbe Zeile, dieselbe Person) – aber die Nummer
    // ist das, was die Nachbearbeitung braucht: der Rückruf an den Eigentümer am nächsten Tag.
    kontaktpersonTelefon: 'Telefon Kontaktperson',
    kontaktpersonTelefonClear: 'Telefon leeren',
    kontaktpersonTelefonPlaceholder: 'Telefonnummer',
    kontaktpersonCall: 'Kontaktperson anrufen',
    // Die dritte Antwort auf Kontaktperson und Rückmeldung ELZ. «Nicht ausgefüllt» und «gibt es
    // nicht» sind zwei verschiedene Aussagen: ein Fehlalarm im leeren Altersheim hat niemanden zu
    // nennen, und ohne diesen Ausweg blieb der Schritt für immer offen – vor jedem Druck stand
    // «Angaben fehlen noch», also genau der Dialog, der auf einem echten Einsatz zählen soll.
    // Bewusst nur das Wort, ohne erfundene Begründung: die Antwort lautet «gibt es nicht».
    entfaellt: 'Entfällt',
    entfaelltUndo: 'Ändern',
    incidentEndLabel: 'Einsatzende',
    // Plausibility of the Einsatzzeiten — a hint, not a block: printing always happens.
    zeitBeforeAlarm: 'Liegt vor der Alarmierung ({t})',
    zeitBeforeAusgerueckt: 'Liegt vor dem Ausrücken ({t})',
    zeitFuture: 'Liegt in der Zukunft',
    now: 'Jetzt',
    // Printing ALWAYS happens — a half-filled Rapport that gets finished by hand in the Magazin
    // is a genuine way of working. But the PDF leaves the building and is the version that gets
    // filed: so name once what is missing, and then let it go.
    // Nach dem Export: das Papier existiert, alle Mindestangaben sind drin – offen ist nur noch
    // die Buchhaltung. Ein Einsatz wird nur archiviert, wenn jemand weiss, dass er das tun muss;
    // sonst bleibt er für immer offen stehen. Deshalb sagt es die Oberfläche an genau dieser
    // Stelle einmal selbst – als Band unter dem Kopf (`bandDone`), nicht als Dialog und nicht
    // als Toast daneben (#31, 30.10.2026): es blockiert nichts.
    // the guide strip under the head after a jump from «n offen» (#14, 28.10.2026), and the
    // Abschluss band that now stands as soon as everything is recorded (#15)
    guideNext: 'Nächster offener Punkt',
    guideLast: 'Letzter offener Punkt',
    guideLeft: 'noch {n} offen',
    guideHide: 'Hinweis ausblenden',
    bandReady: 'Alles erfasst · Nächster Schritt',
    bandPdf: 'Einsatzrapport (PDF) erstellen',
    bandDone: 'Rapport erstellt · Nächster Schritt',
    bandZipLead: 'Danach für die Ablage:',
    bandLater: 'Später',
    exportIncompleteTitle: 'Angaben fehlen noch',
    // …once the last open point is answered IN that confirm (lib/abschlussOpen · abschlussSheet)
    exportCompleteTitle: 'Alle Angaben erfasst',
    exportIncompleteLead: 'Noch offen:',
    exportIncompleteMsg: 'Der Rapport lässt sich trotzdem erstellen – die offenen Felder bleiben leer und können von Hand ergänzt werden.',
    remarksLabel: 'Bemerkungen',
    remarksPlaceholder: 'Optional',
    lehrenLabel: 'Lehren / Sicherheit',
    lehrenPlaceholder: 'Erkenntnisse, Sicherheitshinweise (optional)',
    geretteteLabel: 'Gerettete',
    // Das Rettungs-Symbol trägt beide Zahlen schon (Anzahl Personen im Zähler, «Anzahl Tiere» im
    // Feld) – der Streifen sagt, was auf der Karte steht, und füllt auf Tipp. Gleiche Form wie
    // «Gesetzt, aber nicht erfasst» im Material (mittel.lageStrip).
    geretteteLageStrip: 'Auf der Karte: {list}',
    geretteteLagePersonen: '{n} Personen',
    geretteteLageTiere: '{n} Tiere',
    geretteteLageTake: 'Übernehmen',
    gerettetePersonen: 'Personen',
    geretteteTiere: 'Tiere',
    // ⚠️ «Keine», nicht «Entfällt» (04.09., Rapport-Review). Ein leeres Feld hiess bisher
    // gleichzeitig «niemand gerettet», «nicht abgeklärt», «nicht erfasst» und «hier nicht
    // relevant»; mit dieser Antwort heisst leer nur noch das dritte. Das Wort ist «Keine»,
    // weil eine Rettung entweder stattgefunden hat oder nicht – anders als eine Kontaktperson,
    // die es bei einem Fehlalarm schlicht nicht GIBT (darum dort «Entfällt»).
    geretteteNone: 'Keine',
    geretteteNoneHint: 'Nichts gerettet',
    // …und was auf dem Papier steht, wenn die Frage beantwortet wurde
    geretteteNonePrint: 'keine',
    gruppenLabel: 'Alarmierung Gruppen',
    fahrzeugeLabel: 'Ausrückzeiten der Fahrzeuge',
    ausgeruecktDerived: 'aus den Fahrzeugzeiten übernommen',
    vorOrtShort: 'vor Ort',
    zurueckShort: 'zurück',
    // The vehicle table (24.09.2026, D2): what the SERVER observed from the GPS positions,
    // display only. an = first arrival, ab = last departure, both GPS fix times.
    gpsTableTitle: 'Fahrzeuge GPS · live',
    gpsTableNote: 'Zeiten aus den GPS-Positionen, vom Server erfasst',
    gpsColFzg: 'Fzg',
    gpsColStatus: 'Status',
    gpsColAn: 'an',
    gpsColAb: 'ab',
    gpsColFahrten: 'Fahrten',
    gpsColPos: 'Pos.',
    gpsStatusScene: 'vor Ort',
    gpsStatusAway: 'unterwegs',
    gpsAgeSec: 'vor {n} s',
    gpsAgeMin: 'vor {n} min',
    gpsAgeHour: 'vor {n} h',
    gpsAgeStale: 'Position veraltet',
    // …and on paper, where a vehicle was on scene more than once (a supply vehicle shuttling to the depot)
    fahrtenCount: '{n} Fahrten',
    rueckmeldungLabel: 'Rückmeldung ELZ',
    rueckmeldungName: 'Name',
    // ⚠️ Nicht bloss «Zeit»: das Feld steht jetzt neben dem Einsatzende, und zwei Zeitfelder
    // untereinander, von denen eines «Zeit» heisst, sagen nicht welche Zeit gemeint ist.
    rueckmeldungZeit: 'Zeit Rückmeldung ELZ',
    // Sections — no longer a block on the page: printing happens immediately with whatever is
    // set; ticking happens in the menu behind the ▾ next to «Einsatzrapport (PDF)».
    sectionsHead: 'Abschnitte',
    printMenu: 'Weitere Druckoptionen',
    toggleKroki: 'Kroki',
    plansAnnotated: 'Pläne mit Anmerkungen ({n})',
    toggleGebaeude: 'Gebäude – Geschosse ({n})',
    toggleTafel: 'Tafel – Seiten ({n})',
    plansAll: 'Alle Pläne',
    toggleAtemschutz: 'Atemschutzüberwachung ({n})',
    toggleAttendance: 'Anwesenheit ({n})',
    toggleMittel: 'Material ({n})',
    toggleJournal: 'Einsatzjournal',
    togglePendenzen: 'Aufträge / Pendenzen ({n})',
    toggleAttachments: 'Fotos ({n})',
    // the Beilagen in ORIGINAL quality as one ZIP + manifest — for the digital Ablage
    archiveZip: 'Beilagen herunterladen (ZIP)',
    // Fotos: pictures that belong to the RAPPORT (ID, damage), not into the Verlauf.
    // ⚠️ The upload only takes `image/*`. As long as that holds, the surface is called «Fotos»
    // and not «Beilagen» – a word that promises a PDF Beilage it cannot accept.
    krokiAtLabel: 'Kroki-Stand',
    // Verlauf row for when somebody changes the Rapportangaben — the content of the document
    // that gets signed must not change without a trace.
    // «Rapportangaben geändert: Bemerkungen» said that something happened to something – the
    // least a record can say. Short fields name their new value, free text only says whether it
    // was written, overwritten or emptied (the Verlauf is not a second copy of the Rapport).
    logMetaChanged: 'Rapportangaben: {fields}',
    metaValue: '{label} «{value}»',
    metaWritten: 'geschrieben',
    metaRewritten: 'überarbeitet',
    // ⚠️ «entfernt», nicht «geleert» (04.09., Rapport-Review). «Rückmeldung ELZ geleert» ist
    // technisch richtig und semantisch offen: Feldinhalt gelöscht? Rückmeldung zurückgesetzt?
    // Person entfernt? Zeitpunkt entfernt? Der Rest dieser Datei sagt für genau denselben
    // Vorgang längst «entfernt» (Beschriftung, Stockwerk, Ausbreitung, Partner-Bemerkung) –
    // und die Hausregel dahinter (25.08.): gelöscht wird ein Record, entfernt wird eine
    // Angabe, deren Träger bestehen bleibt.
    metaCleared: 'entfernt',
    // ⚠️ THE STRUCTURED FIELDS SAY WHAT THEY BECAME (10.08.). Six fields used to write nothing
    // but their own name — «Rückmeldung ELZ», «Partnerorganisationen», «Alarmzeiten» — so the
    // Verlauf recorded that a field had been touched and never what it now said. Worse, each of
    // them is edited one row at a time, and every row started its own 4-Sekunden-Fenster: three
    // taps on the Partnerliste printed three byte-identical rows, which read as a bug in the log
    // rather than as three decisions. A row that names the organisation is both useful AND
    // distinguishable from the row before it, so this fixes the duplicates by fixing the text.
    metaRueckmeldung: 'Rückmeldung ELZ durch {name} um {t}',
    metaRueckmeldungTime: 'Rückmeldung ELZ um {t}',
    metaRueckmeldungName: 'Rückmeldung ELZ durch {name}',
    metaGerettete: 'Gerettete: {value}',
    // «Keine» ist eine ausgesprochene Antwort und wird als solche festgehalten – wie bei
    // Kontaktperson und Rückmeldung ELZ (metaNoneOn/Off).
    metaGeretteteNone: 'Gerettete: keine',
    metaGeretteteNoneOff: 'Gerettete: «keine» widerrufen',
    metaPartnerAdded: 'Partnerorganisation {org} ergänzt',
    metaPartnerRemoved: 'Partnerorganisation {org} entfernt',
    metaPartnerNote: 'Partnerorganisation {org} – Bemerkung: {note}',
    metaPartnerNoteCleared: 'Partnerorganisation {org} – Bemerkung entfernt',
    // an organisation whose name is still being typed: named as such rather than as «‹› ergänzt»
    metaPartnerUnnamed: 'Partnerorganisation erfasst',
    metaGruppe: 'Alarmzeit {gruppe}: {t}',
    metaGruppeCleared: 'Alarmzeit {gruppe} entfernt',
    metaFahrzeugAus: '{fahrzeug} ausgerückt {t}',
    metaFahrzeugVorOrt: '{fahrzeug} vor Ort {t}',
    metaFahrzeugZurueck: '{fahrzeug} zurück {t}',
    metaFahrzeugCleared: '{fahrzeug}: Zeit entfernt',
    // the two states read identically as «Material «keine»» — one of them says the opposite
    metaMittelNoneOn: 'Material: «keine verwendet» bestätigt',
    metaMittelNoneOff: 'Material: «keine verwendet» widerrufen',
    // «Entfällt» ist eine bewusste Antwort und wird als solche festgehalten – eine leere Zeile
    // im Record sieht aus wie etwas Vergessenes, und genau dafür gibt es die beiden Felder.
    metaNoneOn: '{label}: entfällt',
    metaNoneOff: '{label}: «entfällt» widerrufen',
    krokiOrientation: 'Ausrichtung',
    krokiPortrait: 'Hoch',
    krokiLandscape: 'Quer',
    krokiAtNow: 'Jetzt',
    krokiAtFailed: 'Kroki zu diesem Zeitpunkt konnte nicht rekonstruiert werden – gedruckt wird der aktuelle Stand.',
    partnersLabel: 'Partnerorganisationen',
    partnerOrg: 'Organisation (z. B. Polizei)',
    partnerOrgShort: 'Organisation',
    partnerNote: 'Bemerkung (z. B. übernimmt Verkehr)',
    // ⚠️ Ohne Beispiel: auf einer frei eingegebenen Zeile teilt sich die Bemerkung den Platz
    // mit dem Organisationsfeld und dem Papierkorb – das Beispiel wurde dort mitten im Wort
    // abgeschnitten («Bemerkung (z. B. ü»), was schlimmer aussieht als gar keines.
    partnerNoteShort: 'Bemerkung',
    partnersNone: 'keine erfasst',
    partnerAdd: 'Organisation hinzufügen',
    // the field's placeholder — the verb is the framed «+» beside it (27.09.2026, slim sweep ·
    // mockup 5); partnerAdd stays the accessible name of both
    partnerPlaceholder: 'Organisation …',
    // Ein «Bereich Polizei» auf dem Kroki ist bereits die Antwort auf «war die da?» – der
    // Streifen sagt, was auf der Karte steht, und kreuzt die Zeilen erst auf Tipp an. Gleiche
    // Form und gleiches Versprechen wie bei den Geretteten (geretteteLageStrip): der Rapport
    // hält fest, was jemand geschrieben hat, nicht was die App ausgerechnet hat.
    partnerLageStrip: 'Auf der Karte: {list}',
    partnerLageTake: 'Übernehmen',
    attachmentsHead: 'Fotos',
    attachmentsAdd: 'Foto hinzufügen',
    attachmentsOpen: 'Foto gross ansehen',
    attachmentsCount: '{n} Foto(s)',
    attachmentsNone: 'keine',
    attachmentsCaption: 'Bildlegende (z. B. «Ausweis Lenker»)',
    attachmentsPending: 'noch nicht hochgeladen',
    attachmentsFailed: 'Foto {name} konnte nicht hochgeladen werden – es erscheint nicht im Druck.',
    // Was ↶ zurücknimmt, in der Sprache der Beilage – und der Toast, der das Löschen sofort
    // zurückholt (Bestätigen-mit-Rückgängig, wie beim Geschoss).
    attachmentAdded: 'Foto hinzugefügt',
    attachmentCaptioned: 'Bildlegende',
    attachmentRemoved: 'Foto entfernt',
    // «Formulare & Links» – die eigenen Formulare der Wehr (Verwaltung › Rapport). Der ganze
    // Abschnitt fehlt, wo keine konfiguriert sind, darum braucht es keinen leeren Zustand.
    linksHead: 'Formulare & Links',
    // ── Weitergeben: der Lese-Link auf den ganzen Einsatz ──
    // Eigene Sektion unter der Checkliste (Entscheid 01.09.). Der Link ist ein Ergebnis des
    // Rapports, kein Häkchen – und die Warnung steht UNTER der Adresse, nicht in einem Tooltip:
    // sie ist das eine, was jemand gelesen haben muss, bevor er ihn verschickt.
    // ⚠️ EINE Zeile (29.09.2026): der Reiter sagt schon «lesen»; die fünf Zeilen darunter sagten
    // es nochmals und schoben «Link erstellen» auf dem Handy unter den Falz – im Teilen-Blatt und
    // wortgleich in «Weitergeben». Die lange Erklärung (beide Zielgruppen, beide Zeiträume) steht
    // jetzt in der Hilfe, «Rapport & Abschluss». Vor und nach dem Erstellen derselbe Satz: «bis du
    // ihn aufhebst» sagt der Knopf «Link aufheben» direkt darunter.
    shareHead: 'Weitergeben',
    shareLede: 'Kein Login, gilt auch nach dem Abschluss.',
    shareLiveLede: 'Kein Login, gilt auch nach dem Abschluss.',
    shareCreate: 'Link erstellen',
    shareBusy: 'Link wird erstellt …',
    // Solange die Antwort noch aussteht: «noch nicht gefragt» ist nicht «gibt es keinen», und
    // solange das offen ist, darf die Karte weder «Link erstellen» noch eine Adresse behaupten.
    shareLoading: 'Link wird geladen …',
    // …und wenn die Frage gar nicht beantwortet wurde (offline, Server weg). ⚠️ Das ist NICHT
    // «gibt es keinen»: bis 04.09. verschluckte das Blatt den Fehler und stand danach entweder
    // ewig auf «wird geladen» oder — schlimmer — auf «Link erstellen» über einem Link, den es
    // längst gab. Also sagt es, was passiert ist, und bietet die Frage nochmals an; erstellt
    // wird erst wieder, wenn die Antwort da ist.
    shareLoadFailed: 'Link konnte nicht geladen werden.',
    shareRetry: 'Erneut versuchen',
    shareCreateFailed: 'Link erstellen fehlgeschlagen',
    shareCopy: 'Adresse kopieren',
    shareCopied: 'Kopiert',
    // Der QR ist die eigentliche Übergabe im Einsatz: Tablet hinhalten statt Adresse diktieren.
    shareScan: 'Mit der Kamera scannen',
    // Öffnet die Teilen-Funktion des Geräts (Threema, WhatsApp, Mail) — nur wo es eine gibt.
    shareSend: 'Senden …',
    shareWarn: 'Wer den Link hat, sieht den ganzen Einsatz – Namen der Anwesenden, Fotos und den '
      + 'vollständigen Verlauf.',
    shareRevoke: 'Link aufheben',
    // ⚠️ Heisst so, wie der Reiter darüber heisst («Ganzer Einsatz»), und NICHT «Einsatz-Link»:
    // so hiess der abgeschaffte zweite Lese-Link, und in der Verwaltung heisst so weiterhin der
    // Schlüssel der Alarmierung. Ein Name pro Link.
    shareRevokeTitle: 'Link zum ganzen Einsatz aufheben?',
    shareRevokeBody: 'Die Adresse funktioniert danach nicht mehr. Wer sie gerade offen hat, sieht '
      + 'ab sofort nichts mehr. Ein neuer Link lässt sich jederzeit erstellen – er ist dann eine '
      + 'andere Adresse.',
    shareRevokeConfirm: 'Ja, aufheben',
    shareRevokeFailed: 'Link aufheben fehlgeschlagen',
    // ── Zweite Art Link: «Nur Atemschutz – bedienen» (01.09.) ──
    // Ein Einsatz kann seine Atemschutz-Überwachung abgeben: wer den Link öffnet, bekommt die
    // Tafel dieses einen Einsatzes auf dem eigenen Handy und bedient sie. Beide Arten wohnen im
    // selben Blatt, ganz oben die Wahl – darum ist die Zeile darunter kein Satz, sondern das
    // eine Wort, das die beiden unterscheidet (lesen ↔ bedienen).
    // ⚠️ Diese Wahl IST seit 03.09. die Auswahl: die zwei Reiter stehen für die zwei Türen von
    // «Teilen», ein Menü davor gibt es nicht mehr. Nach dem Abschluss fällt der Atemschutz-Reiter
    // weg (der Link stirbt mit dem Einsatz) – dann steht das Blatt ohne Wahl da.
    // ⚠️ «Link», nie «Code» (02.09.): geteilt wird eine Adresse – QR ist nur einer der Wege,
    // sie aufs andere Gerät zu bringen, und der ganze übrige Abschnitt sagt schon «Link».
    shareKindLabel: 'Was der Link freigibt',
    // EINZEILIG seit 27.09.2026 (slim sweep, 4b): «Ganzer Einsatz / nur lesen» und «Nur Trupps /
    // bedienen» waren die einzigen zweizeiligen Segmente der App. Was «Ganzer» und «Nur» trugen,
    // sagen «lesen / bedienen» deutlicher – ein Schlüssel pro Reiter, der «·» gehört zum String.
    shareKindFull: 'Einsatz · lesen',
    // ⚠️ «Trupps» (04.09.), wie der Bereich heisst (copy.modes) — der Reiter benennt die TÜR, und
    // die Tür führt auf die Trupp-Tafel. Was hinter ihr bedient wird, ist trotzdem die
    // Atemschutzüberwachung, und genau das muss der Lauftext darunter weiterhin sagen: der Link
    // gibt eine Sicherheitsaufgabe aus der Hand, nicht eine Liste.
    shareKindAtem: 'Trupps · bedienen',
    shareAsLede: 'Wer den Link öffnet, sieht nur die Trupp-Tafel dieses Einsatzes – die '
      + 'Atemschutzüberwachung – und bedient sie mit: Trupp anmelden, Kontakt, Druck, Rückzug, '
      + 'Draussen. Keine Karte, kein Verlauf. Gilt, bis der Einsatz abgeschlossen ist.',
    // «… oder bis du ihn aufhebst» sagt der rote Knopf «Link aufheben» direkt darunter (27.09.2026)
    shareAsLiveLede: 'Gilt bis zum Abschluss.',
    shareAsWarn: 'Was hier eingetragen wird, steht im Rapport unter «Atemschutzüberwachung». Gib den '
      + 'Link nur an die Person, die überwacht.',
    // …und heisst wie der Reiter darüber («Nur Trupps»), dieselbe Regel wie bei shareRevokeTitle:
    // ein Name pro Link.
    shareAsRevokeTitle: 'Link zur Trupp-Tafel aufheben?',
    shareAsRevokeBody: 'Die Adresse funktioniert danach nicht mehr. Wer die Tafel gerade offen '
      + 'hat, kann ab sofort nichts mehr eintragen. Ein neuer Link lässt sich jederzeit erstellen '
      + '– er ist dann eine andere Adresse.',
    // ⚠️ Hier stand bis 03.09. eine dritte Art Link: der Einsatz-Link der Alarmierung, von Hand
    // erzeugt. Er sagte denselben Satz wie der Lese-Link oben, brauchte aber den Schlüssel der
    // Wehr und starb mit dem Abschluss – also war er als Übergabe immer die schlechtere Hälfte
    // derselben Sache. Weg ist nur die Tür: die Alarmierung schreibt diesen Link weiterhin in
    // jeden Alarm, und die App löst ihn weiterhin ein (lib/incidentLink).
    linksCount: '{done} von {n} erledigt',
    linksOpen: 'Öffnen',
    // Der Haken sagt «ich habe das erledigt» – die App sieht nie, ob ein Formular abgeschickt
    // wurde, darum setzt sie ihn nie selbst.
    linksMarkDone: '{title} als erledigt markieren',
    linksMarkOpen: '{title} wieder als offen markieren',
    linksDoneAt: 'erledigt · {at}',
    // Nach dem Öffnen einmal nachfragen: der Tab ist weg, der Haken wäre sonst vergessen.
    linksOpened: '{title} geöffnet.',
    linksOpenedAction: 'Erledigt',
    linksOpenFailed: '{title} konnte nicht geöffnet werden – der Browser hat das Fenster blockiert.',
    toggleDetailedAudit: 'Detaillierter Prüfnachweis',
    toggleAuswertung: 'Auswertung (intern)',
    // «Detaillierter Prüfnachweis» doesn't say what is being ticked – nobody ticks what they
    // don't understand. It is about the bookkeeping rows in the printed Verlauf (who changed
    // what when), which are otherwise filtered out. The Prüfnachweis status above is unaffected.
    // Kroki-Ausschnitt: a field on the Rapport surface (WYSIWYG), no dialog before printing any
    // more – which is also why there is nothing left to «übernehmen».
    krokiHead: 'Kroki-Ausschnitt',
    framingHint: 'Karte verschieben und zoomen – gedruckt wird genau dieser Ausschnitt.',
    // Until 09.08. the crop did not follow along: picked once at 22:20, printed unchanged at
    // 01:30 — with everything added since then outside it, and nobody saying so.
    framingFollows: 'Folgt der Karte',
    framingFollowOn: 'Der Ausschnitt wächst mit der Karte mit. Verschieben schaltet das ab.',
    // An arrow instead of zooming out: what lies outside is usually a Hydrant two streets away,
    // and shrinking half the picture for that costs more than it gains.
    framingOutside: '{n} ausserhalb – antippen zum Anpassen',
    // Die Legende der Vorschau ist die Legende des Blattes: der Server ersetzt jede Zeichnungs-
    // Beschriftung und jede Symbol-Caption durch eine nummerierte Scheibe und druckt die Worte
    // darunter. Eine Scheibe, die nicht ganz in den Rahmen passt, wird weggeschnitten – die
    // Zeile fehlt dann auf dem Blatt, und das ist die folgenreichste Wirkung des Verschiebens.
    framingLegend: 'Legende',
    framingLegendEmpty: 'nichts Beschriftetes im Ausschnitt',
    framingLegendMissing: '{n} ohne Nummer – die Scheibe passt nicht ganz aufs Blatt.',
    framingLegendPending: 'wird beim Loslassen nachgeführt …',
    framingDiscOut: 'Kommt nicht in die Legende – die Scheibe passt nicht ganz aufs Blatt.',
    // Kontrolle section
    controlHead: 'Kontrolle',
    // THE chip in the Rapport head (23.09.2026 — the separate «noch offen» chips under the title
    // are gone at every width): what is still open, and the warnings about the record, each
    // counted in its own words (lib/abschlussOpen · controlChipLabel). «Hinweis(e)» said both.
    // «{n} offen», not «{n} noch offen» (27.09.2026, slim sweep · mockup 2): the number keeps
    // its unit and nothing else — the chip is amber and counts, «noch» said what amber says.
    // ONE wording for ONE number: the phone's «Einsatz» tile and the page chooser take the
    // same words through controlChipLabel, so they lose the «noch» with it.
    controlOpen: '{n} offen',
    // the phone's word on the PDF tile («PDF ▾»); the tablet shows pdfFull
    pdfShort: 'PDF',
    controlHint: '1 Hinweis',
    controlHints: '{n} Hinweise',
    // the heading of the open steps inside the chip's popover
    controlOpenHead: 'Noch offen',
    plansPrintNone: 'Pläne werden nicht gedruckt – bei Bedarf im Menü ▾ zuschalten.',
    plansPrintAnnotated: '{n} Pläne mit Anmerkungen werden gedruckt.',
    plansPrintAll: 'Alle Pläne werden gedruckt.',
    missingTranscripts: '{n} Audioeintrag/-einträge ohne Transkript – fürs Protokoll nachtragen.',
    fixTranscripts: 'Im Verlauf ergänzen',
    // Names WHO and WHY. On paper it said «N Person(en) ohne verwertbare Zeiten» – a number over
    // an abstraction nobody could do anything with. Most common cause: an open block inheriting
    // the Einsatzende, which lies BEFORE its own start.
    unresolvedHours: '{names}: Zeiten laufen rückwärts oder fehlen – nicht in den Einsatzstunden.',
    pendingMedia: '{n} Foto/Audio noch nicht hochgeladen – wird bei Verbindung ergänzt; auf anderen Geräten evtl. noch nicht sichtbar.',
    pendingMediaConfirm: '{n} Foto/Audio noch nicht hochgeladen – bleiben auf diesem Gerät gespeichert',
    // Kein fehlendes Feld, sondern ein Zustand: Es hat nie jemand gemeldet, dass diese Trupps
    // zurück sind. Ab dem Abschluss stehen ihre Uhren auf dem Einsatzende – das hier ist der
    // letzte Moment, in dem gefragt wird. Ohne Zahlwort-Plural: «Noch im Einsatz: 1» liest sich
    // genauso wie «Noch im Einsatz: 3».
    truppsDeployedConfirm: 'Noch im Einsatz: {n} – nie rausgemeldet',
    stateNote: 'Stand: ganzer Einsatz bis Rapport-Erstellung ({at}).',
  },
  // Station print relay — «Ausdrucken» (preflight + capture)
  printRelay: {
    send: 'Ausdrucken',
    sending: 'Wird gesendet …',
    // ⚠️ «In der Warteschlange», nicht «gesendet». Eingereiht ist nicht gedruckt: was die App
    // weiss, ist dass der Auftrag in einer Warteschlange liegt. «Gesendet» klang nach erledigt –
    // und war die erste Hälfte der Geschichte, die damit endete, den Einsatz abschliessen zu
    // dürfen, obwohl kein Blatt existierte.
    queued: 'In der Warteschlange',
    // live status toast follows the job: Warteschlange → wird gedruckt → gedruckt / fehlgeschlagen
    printing: 'Wird gedruckt …',
    printed: 'Gedruckt',
    printFailed: 'Druck fehlgeschlagen – Drucker prüfen',
    // the same three stages as a chain INSIDE that toast — short, they stand next to each other
    stepQueued: 'In der Warteschlange',
    stepPrinting: 'Wird gedruckt',
    stepPrinted: 'Gedruckt',
    // Ein unerledigter Auftrag ist ein ZUSTAND und lebt am Rapportkopf, nicht im Toast: das
    // Polling gibt nach 90 s auf, danach las den Auftrag niemand je wieder.
    jobOpen: 'Druckauftrag offen',
    jobOpenSince: 'Seit {t} in der Warteschlange',
    jobCheck: 'Prüfen',
    jobCancel: 'Abbrechen',
    jobUnreachable: 'Druckauftrag nicht erreichbar – Verbindung prüfen',
    // 404 vom Relay: der 7-Tage-Sweep des Backends hat den Auftrag weggeräumt – genau der Fall
    // «Relay war eine Woche down». Ohne eigene Antwort blieb das Band für immer stehen, und
    // «Prüfen» sagte «nicht erreichbar» über einen Host, der soeben geantwortet hatte. Kein
    // «Rapport erstellt»-Stempel: ob je ein Blatt herauskam, weiss niemand – der Satz sagt das.
    jobGone: 'Druckauftrag nicht mehr auffindbar – falls kein Ausdruck herauskam, erneut drucken.',
    // every print goes through a confirm modal — no accidental paper (2026-07-18)
    confirmTitle: 'Ausdrucken',
    confirmMsg: 'Einsatzrapport an den Stationsdrucker senden?',
    confirmBtn: 'Ausdrucken',
    undo: 'Rückgängig',
    cancelled: 'Druckauftrag abgebrochen',
    undoTooLate: 'Zu spät – der Auftrag ist schon beim Drucker',
    failed: 'Senden an Stationsdrucker fehlgeschlagen',
    online: 'Stationsdrucker erreichbar',
    offline: 'Stationsdrucker offline',
    // ⚠️ Nur der Titel, kein Erklärtext. «Der Auftrag wird gedruckt, sobald das Relay wieder
    // erreichbar ist» war der Satz, der Einreihen wie Drucken klingen liess – und danach stand
    // «Rapport erstellt» auf dem Schirm. Der Titel ist die ganze Aussage.
    offlineConfirmTitle: 'Stationsdrucker offline',
    offlineConfirmBtn: 'Trotzdem senden',
  },
} as const
