// German copy · the Verlauf / journal and error sentences.
// One slice of the canonical `de` catalogue, assembled in ../de.ts — read the rules at the
// top of that file before adding or renaming a key here.

export const journalCopy = {
  journal: {
    delivery: {
      failedTitleOne: '1 Eintrag nicht übertragen',
      failedTitle: '{n} Einträge nicht übertragen',
      storageTitle: 'Einträge nicht sicher gespeichert',
      storageBody: 'App offen lassen und Einträge sichern. Beim Schliessen können diese Einträge verloren gehen.',
      savedBody: 'Auf diesem Gerät gespeichert. Auf anderen Geräten fehlen diese Einträge.',
      offlineBody: 'Auf diesem Gerät gespeichert. Die Übertragung wird automatisch erneut versucht, sobald eine Verbindung besteht.',
      retry: 'Erneut versuchen',
      retrying: 'Wird versucht …',
      export: 'Einträge sichern',
      short: 'Einträge nicht übertragen',
      // 24.09.2026: audit events this ROLE can never write (the `el` phone's Atemschutz alarm) —
      // parked on the device, not an error, but still exportable. No «Erneut versuchen».
      // 22.10.2026 (RBAC S4): also unsynced saves a wider role left on this device (a role change)
      refusedTitleOne: '1 Eintrag für diese Rolle nicht vorgesehen',
      refusedTitle: '{n} Einträge für diese Rolle nicht vorgesehen',
      refusedBody: 'Der Server nimmt diese Einträge von dieser Anmeldung nicht an – etwa Änderungen von vor einem Rollenwechsel. Sie bleiben auf diesem Gerät und können gesichert werden; der Verlauf ist davon nicht betroffen.',
      // 25.09.2026 (N3): was nach dem Abschluss des Einsatzes noch ankam — nicht übernommen, gesichert
      closedTitleOne: '1 Eintrag nach dem Abschluss nicht übernommen',
      closedTitle: '{n} Einträge nach dem Abschluss nicht übernommen',
      closedBody: 'Der Einsatz war bereits abgeschlossen, als diese Einträge den Server erreichten. Sie stehen nicht im Verlauf, bleiben aber auf diesem Gerät und können gesichert werden. Wird der Einsatz wieder geöffnet, werden sie nachgesendet.',
      // die Statusleuchte, solange solche Einträge nur auf dem Gerät liegen
      closedShort: 'Einträge nach dem Abschluss nicht übernommen – sichern',
    },
    open: 'Verlauf',
    add: 'Eintrag',
    addHint: 'Tippen für Eintrag, halten und auf Sprachnotiz oder Foto schieben',
    title: 'Verlauf',
    empty: 'Noch keine Ereignisse erfasst.',
    surfaceMap: 'Karte',
    surfacePlan: 'Plan',
    replay: 'Wiedergabe starten',
    // activity strip above the list: WHEN something happened, as a position rather than a row
    stripLabel: 'Zeitstrahl – tippen, um zur passenden Stelle zu springen',
    replayHint: 'Karte und Plan zu einem früheren Zeitpunkt abspielen',
    // composer
    // «Verlauf» is the place, «Eintrag» the thing, on every screen (29.09.2026): the door says
    // «Eintrag», the list «Verlauf» — «Journaleintrag» was a third word for the same row.
    // «Einsatzjournal» survives only as the PRINTED section's name (report · journal).
    composerTitle: 'Neuer Eintrag',
    textPlaceholder: 'Was ist passiert? Meldung, Beobachtung, Entscheid …',
    record: 'Aufnehmen',
    recordStop: 'Aufnahme stoppen',
    discardAudio: 'Aufnahme verwerfen',
    // ONE upload button for everything that is picked rather than captured: Bild, Aufnahme,
    // Dokument. What was picked decides where it lands (lib/audioImport · classifyPick).
    attachUpload: 'Datei hochladen',
    // short form for the phone row, where the three media buttons get a third of the width each
    attachUploadShort: 'Datei',
    attachLabel: 'Beilage',
    attachDiscard: 'Beilage entfernen',
    attachOpen: 'Beilage herunterladen',
    attachOffline: 'Datei-Upload benötigt eine Verbindung. Datei später erneut auswählen.',
    attachTooLarge: 'Datei ist zu gross. Maximum: {max} MB.',
    attachUnsupported: 'Dieser Dateityp wird nicht unterstützt.',
    attachUploadFailed: 'Datei-Upload fehlgeschlagen. Verbindung prüfen und erneut versuchen.',
    // ⚠️ Same reason as audioImportDropped below: a picked file cannot be handed back on the
    // next open, so a composer that closes with one on it says so.
    attachDropped: 'Beilage «{name}» verworfen – bitte neu auswählen.',
    // ⚠️ A Beilage has no plate in the Rapport the way a photo does (the file itself travels in
    // the Beilagen-ZIP), so the printed line NAMES it – otherwise a row that is only a document
    // prints as an empty timestamped line (lib/report · journalRows).
    attachPrint: 'Beilage: {names}',
    attachPrintMany: 'Beilagen: {names}',
    // one recording per Eintrag – a pick with several audio files keeps the first and says
    // out loud which ones it did not take (no silent loss)
    attachAudioExtra: 'Nur eine Aufnahme pro Eintrag – «{names}» nicht übernommen.',
    // external voice-memo import
    audioClipLabel: 'Sprachnotiz',
    audioImportLabel: 'Externe Audioaufnahme',
    audioStartLabel: 'Aufnahme begann',
    audioStartHint: 'Startzeit anhand der Sprachmemo kontrollieren.',
    audioStartConfirm: 'Startzeit bestätigen',
    audioImportedNote: 'Externe Audioaufnahme ({duration})',
    audioDiscardImport: 'Audiodatei verwerfen',
    audioUploading: 'Wird hochgeladen …',
    audioOffline: 'Audio-Upload benötigt eine Verbindung. Datei später erneut auswählen.',
    audioTooLarge: 'Audiodatei ist zu gross. Maximum: {max} MB.',
    audioUnsupported: 'Dieses Audioformat wird nicht unterstützt.',
    audioUploadFailed: 'Upload fehlgeschlagen. Verbindung prüfen und erneut versuchen.',
    // ⚠️ Said out loud when the composer closes with an unsaved imported memo on it. Everything
    // else on the sheet is handed back on the next open (lib/draftKeep); this one cannot be —
    // its preview URL is released on close and the file itself is up to 100 MB.
    audioImportDropped: 'Externe Audioaufnahme «{name}» verworfen – bitte neu auswählen.',
    // audio player (Durchhören)
    playerOpen: 'Durchhören',
    editEntry: 'Text bearbeiten',
    removeEntry: 'Eintrag löschen',
    entryRemoved: 'Eintrag gelöscht',
    playerEntryHere: 'Eintrag an dieser Stelle',
    playerEntryPlaceholder: 'Was war zu hören? Meldung, Entscheid …',
    playerEntries: 'Einträge in dieser Aufnahme',
    playerNoEntries: 'Noch keine Einträge in diesem Zeitfenster.',
    playerSkipBack: '15 Sekunden zurück',
    playerSkipFwd: '15 Sekunden vor',
    playerSpeed: 'Wiedergabegeschwindigkeit',
    playerSeek: 'Wiedergabeposition',
    playerOffline: 'Wiedergabe benötigt eine Verbindung.',
    // speech-to-text drafts in the player (fail-closed: button only when konfiguriert)
    sttTranscribe: 'Transkribieren',
    sttRunning: 'Transkription läuft … Das kann einige Minuten dauern.',
    sttFailed: 'Transkription fehlgeschlagen: {error}',
    sttRetry: 'Erneut versuchen',
    sttErrorGeneric: 'Server nicht erreichbar',
    sttBanner: '{n} Entwürfe erkannt – prüfen und übernehmen.',
    sttTakeAll: 'Alle übernehmen',
    sttTake: 'Übernehmen',
    sttDismiss: 'Verwerfen',
    sttEmpty: 'Keine Sprache erkannt.',
    photo: 'Foto',
    photoNote: 'Foto',
    photoOpen: 'Foto gross ansehen',
    discardPhoto: 'Foto verwerfen',
    // offline media upload queue — status chip on a Verlauf row whose photo/audio is not yet
    // on the server (captured offline; will upload automatically when reconnected)
    mediaPending: 'Wird geladen',
    mediaFailed: 'Nicht geladen',
    // rows appended after the Einsatzende (archive → reopen, the correction path)
    nachtrag: 'Nachtrag',
    // a hand-written line corrected later (append-only patch — both wordings stay in the record)
    corrected: 'korrigiert {t}',
    /**
     * Eine Zeile, die die App wiederholt hat, während sich nichts änderte — zusammengefasst auf
     * die erste, mit ihrer Zahl (lib/verlauf · repeatRuns).
     *
     * ⚠️ Die Zahl ist die GESAMTZAHL, nicht die Zahl der Wiederholungen (04.09., Feldtest
     * Manuel). «2× wiederholt» liess beides zu – zwei Vorkommen oder eine plus zwei –, und auf
     * dem Rapport steht für dieselbe Zeile «2×». Ein Wort für eine Zahl: hier wie dort ist es,
     * wie oft die Meldung insgesamt im Protokoll steht.
     */
    repeated: 'insgesamt {n}×',
    repeatedTitle: 'So oft steht diese Meldung insgesamt im Protokoll – jede einzelne bleibt erhalten.',
    correctHint: 'Der ursprüngliche Wortlaut bleibt im Protokoll.',
    // die Zeile kam über den Atemschutz-Link herein — von einem Handy, das nur die Tafel
    // bedient und darum bewusst nach keinem Namen gefragt wurde (types · TimelineEvent.via)
    viaAtemschutzLink: 'Atemschutz-Link',
    viaAtemschutzLinkTitle: 'Eingetragen auf der abgegebenen Atemschutz-Tafel.',
    // ── the row's detail sheet (owner's pick 8, sweep E.4): the message is the title, a meta line
    // under it «16:30:56 · Sofortmassnahme · von Hand erfasst» (time · Art/Bereich · Quelle), then a
    // fact table for what the meta line does not say ──
    // ⚠️ Only lines with an answer are printed. A sheet of «–» teaches nothing and turns the one
    // fact that IS there (a correction, a repeat) into something to hunt for.
    // …written by hand vs. logged by the app — the meta line's last part, so lower case. The second
    // is why the pen is missing on that row, so the sheet says it (and the hint under it) rather
    // than leaving an operator tapping a button that is not there.
    detailSourceManual: 'von Hand erfasst',
    detailSourceSystem: 'von der App erfasst',
    detailSourceSystemHint: 'Systemzeilen sind nicht bearbeitbar',
    detailAttachments: 'Beilagen',
    detailAttachmentsN: '{n} Bilder',
    detailAttachmentsOne: 'Ein Bild',
    detailCorrected: 'Korrigiert',
    // the FIRST wording, kept by the append-only patch chain (lib/journalStore · display)
    detailCorrectedFirst: 'zuerst: {text}',
    detailRepeated: 'Wiederholt',
    detailRepeatedN: 'insgesamt {n}× bis {t}',
    detailNachtrag: 'Nachtrag',
    detailNachtragHint: 'nach Einsatzende erfasst',
    // system row appended when a three-way sync merge saw BOTH sides (KP tablet and
    // QR-Erfassung/server) change the SAME person's attendance to different values —
    // last-writer-wins stays, but the divergence is said, not silent (append-only record)
    // ⚠️ Says WHAT diverged, not that something did. «Abweichende Angaben wurden zusammengeführt»
    // left the reader with a name and an instruction and nothing to check: the usual case is two
    // Funktionen on the same person, and that is a sentence, not a mystery. The merge itself is
    // unchanged (last writer wins) — this row only reports it.
    attendanceConflict: 'Anwesenheit {name}: {what} – bitte prüfen.',
    // ⚠️ BEIDE Funktionen, und keine davon als «verworfen». Wer das liest, muss entscheiden,
    // welche stimmt – dafür braucht er beide nebeneinander. Welche gerade im Datensatz steht,
    // ist eine Folge der Zusammenführung (jüngste gewinnt) und nicht die Frage, die sich stellt.
    /* ⚠️ Diese Bruchstücke stehen NIE für sich: sie werden mit « · » aneinandergereiht und in
       `attendanceConflict` eingesetzt, das «Anwesenheit {name}: » bereits davorgeschrieben hat.
       Jedes von ihnen sagte das Wort «erfasst» noch einmal, und der Status sagte «Anwesenheit»
       noch einmal – gedruckt kam «Anwesenheit Stich Markus: Anwesenheit abweichend erfasst ·
       unterschiedliche Zeiten erfasst – bitte prüfen.» heraus (03.09.). Was doppelt dasteht,
       steht hier nicht mehr. */
    attendanceConflictTwoNotes: 'zwei Funktionen – «{a}» und «{b}»',
    // eine Seite trug keine – dann gibt es nichts zu vergleichen, nur eine zu prüfen
    attendanceConflictOneNote: 'Funktion «{a}» nur auf einem Gerät',
    attendanceConflictStatus: 'Status abweichend',
    attendanceConflictOrt: 'Standort abweichend',
    attendanceConflictTimes: 'unterschiedliche Zeiten',
    // nothing above matched — an entry gained a field this row does not know about yet
    attendanceConflictOther: 'abweichende Angaben zusammengeführt',
    /* ⚠️ Eine Abweichung wird ENTSCHIEDEN, nicht bloss quittiert (04.09., Rapport-Review). Der
       Rapport vom 03.09. wurde um 11:41 mit drei offenen «bitte prüfen»-Zeilen abgeschlossen –
       und ein Warnhinweis im Verlauf beweist nicht, dass jemand hingeschaut hat. Die Auflösung
       ist eine eigene, angehängte Zeile: sie nennt, was übernommen wurde und wer es entschieden
       hat, und lässt die Zeile stehen, die gewarnt hat. */
    attendanceConflictResolved: 'Abweichung {name} geprüft – {taken}, {by}',
    attendanceConflictByUnknown: 'ohne Namen',
    // die zwei Seiten, wo bekannt beim Namen genannt – siehe attendanceConflict · sideLabel
    attendanceConflictFromKp: 'Angabe vom Kommandoposten',
    attendanceConflictFromCapture: 'Angabe vom Erfassungsbogen',
    attendanceConflictKeepBoth: 'beide Angaben stimmen so',
    attendanceConflictOpenEnd: 'offen',
    // die Knöpfe auf der Karte
    attendanceConflictTake: '{side} übernehmen',
    attendanceConflictKeep: 'Beide stimmen so',
    attendanceConflictOpenCount: '{n} offen',
    // system row appended when a three-way sync merge saw BOTH sides change the SAME
    // Atemschutz-Trupp concurrently (e.g. Druckmeldung on the tablet, Funkkontakt on the
    // phone). Unlike attendance the merge is field-level and drops nothing — the row exists
    // because two devices wrote one SCBA record at once, and that gets human eyes.
    truppConflict: 'Atemschutz {name}: Änderungen von zwei Geräten zusammengeführt – bitte prüfen.',
    tafelConflict: 'Tafel «{page}» · {where}: auf zwei Geräten gleichzeitig geändert – «{kept}» gilt (später), «{lost}» überschrieben. Bitte prüfen.',
    tafelRemovedKept: 'Tafel «{page}»: auf einem Gerät entfernt, auf einem anderen danach noch beschrieben – die Seite bleibt. Bitte prüfen.',
    tafelRemovedLost: 'Tafel «{page}» entfernt – auf einem anderen Gerät vorher noch geschrieben: {cells}. Bitte prüfen.',
    quickPhrasesAria: 'Textbausteine',
    typeLabel: 'Art',
    // «Info» is the normal case and prints NO badge — a badge on every row is wallpaper. The
    // words come from the Führungsrhythmus (BGV Behelf Schadenplatz).
    // ⚠️ ONE spelling. There used to be a short form («Sofort») for the composer's chips and the
    // full word for the Verlauf, so the chip you pressed and the line it wrote named two
    // different things. «Sofortmassnahme» is a doctrine word — abbreviating it is what made the
    // chip read as a hurry rather than as a kind of entry.
    entryTypes: { info: 'Info', auftrag: 'Auftrag', sofort: 'Sofortmassnahme' } as Record<string, string>,
    // ⚠️ The SAME words, with the break points written in (soft hyphens, U+00AD). Display only:
    // the chip is the narrowest control on the sheet and the long one has to wrap there, and
    // «Sofortm-assn-ahme» is what an engine without a German dictionary makes of it. The record
    // keeps `entryTypes` — an invisible character has no business in the row's own text.
    entryTypesWrap: { info: 'Info', auftrag: 'Auftrag', sofort: 'Sofort­massnahme' } as Record<string, string>,
    send: 'Erfassen',
    saved: 'Eintrag erfasst',
    // audio-note transcript editing (Verlauf row)
    transcriptPlaceholder: 'Transkript ergänzen',
    transcriptSave: 'Speichern',
    transcriptEdit: 'Transkript bearbeiten',
    transcriptAdd: 'Transkript ergänzen',
    // ── the clock beside the ring: when this entry has to come back ──
    // ⚠️ There is no «Eintrag · Erinnerung» mode any more (17.08.). An Erinnerung is not a second
    // kind of row, it is an entry that also carries a due time — so these words name a PROPERTY of
    // the entry, not a surface to switch to.
    // ⚠️ The arrow is a WORD-shaped suggestion, not a control: it inserts « → » and nothing else.
    arrowTitle: 'Pfeil einsetzen – wer an wen',
    arrowBackTitle: 'Pfeil einsetzen – wer von wem',
    dueHead: 'Erinnern',
    dueNone: 'Ohne Erinnerung',
    dueSetTitle: 'Erinnert um {t}',
    dueExactTitle: 'Erinnern um',
    dayToday: 'Heute',
    dayTomorrow: 'Morgen',
    duePast: 'Zeitpunkt liegt in der Vergangenheit',
    reminderExact: 'Uhrzeit …',
    reminderChips: [5, 10, 15, 30, 60] as number[],
    reminderChipLabel: 'in {n} min',
    reminderTomorrow: ' · morgen',
    reminderSaved: 'Erinnerung gesetzt',
    // ⚠️ The row a reminder writes WHEN IT IS SET. It used to carry the bare reminder text, so
    // the Verlauf held «Lüfter prüfen» among a hundred other lines and the only row that said
    // the word «Erinnerung» was the one saying it had been done — the record showed an answer
    // with no question. The Fälligkeit belongs in it too: what was decided at 21:40 was not
    // «Lüfter prüfen», it was «Lüfter prüfen, um 22:10».
    reminderCreated: 'Erinnerung gesetzt für {t}: {text}',
    // due banner + actions
    dueTitle: 'Erinnerung fällig',
    dueOne: 'Erinnerung fällig',
    dueDone: 'Erledigt',
    dueSnooze: '+10 min',
    dueOpen: 'In Verlauf öffnen',
    openCount: '{n} offen',
    // ⚠️ Offene Erinnerungen are held at the TOP of the Verlauf, out of chronological order.
    // Everything else in this list is where it happened, because the Verlauf is the record —
    // but a Wiedervorlage is the one row that is about the FUTURE, and on a busy Einsatz it
    // was thirty rows up within ten minutes. Held here it cannot be scrolled past; the row it
    // came from stays in its place in the chronology, this is a second view of it.
    openRemindersHead: 'Pendenzen',
    openReminderGo: 'Zum Eintrag springen',
    doneLog: 'Erinnerung erledigt: {text}',
    // «Rückgängig» on an erledigt toast (or ↶) appends this beside the done row — append-only,
    // the done row stays (lib/useReminders · completeReminder)
    reopenLog: 'Erinnerung wieder offen: {text}',
    snoozeLog: 'Erinnerung +{mins} min: {text}',
    // Verlauf reminder row: due label + done toggle (checklist-style)
    dueAtLabel: 'fällig {t}',
    overdueLabel: 'überfällig',
    markDoneTitle: 'Als erledigt markieren',
    // «wieder in …» auf der Erledigt-Zeile — legt eine NEUE Wiedervorlage mit gleichem Text an
    againChip: '{mins} min',
    againTitle: 'In {mins} Minuten wieder daran erinnern',
    // ── Legende ───────────────────────────────────────────────────────────────────────────
    // The Verlauf row's 26px disc carries the Bereich (it replaced a chip that printed the same
    // word the sentence already carried). A glyph has to be LEARNED, so the drawer's head keeps
    // a legend that names them — opened by a tap, never by itself, and never remembered: it
    // answers one question once, for somebody who reads words rather than shapes.
    legend: 'Legende',
    legendPendenzOpen: 'Pendenz offen',
    legendPendenzUrgent: 'Pendenz dringend',
    legendPendenzDone: 'Pendenz erledigt',
    // ── Suche ─────────────────────────────────────────────────────────────────────────────
    // The lens beside the legend. Tapped, the search field REPLACES the head row until its ✕
    // closes it (mock verlauf-02, 14.09.). Filters live, with the person search's tolerance
    // (lib/journalSearch): umlauts either way, one typo from four letters, every word must match.
    search: 'Im Verlauf suchen',
    searchPlaceholder: 'Suchen …',
    searchClose: 'Suche schliessen',
    // «2 von 42» – matching rows of all rows, live while typing
    searchCount: '{n} von {m}',
    searchEmpty: 'Nichts zu «{q}»',
    searchEmptyHint: 'Gesucht wird im Text sowie in Namen von Personen und Trupps. Ein Tippfehler ist erlaubt.',
    // ── Filter ────────────────────────────────────────────────────────────────────────────
    // The funnel beside the lens (feat 37 · B, 23.09.2026). Its categories are NOT words of its
    // own: they are the Bereiche the disc, the legend and the Rapport's «Bereich» column already
    // say (entryTypes, noteChip, report · areaLage …), so nothing is named twice. The ticks
    // OR together and AND with the search (lib/journalFilter).
    filter: 'Verlauf filtern',
    filterArt: 'Art des Eintrags',
    filterArea: 'Bereich',
    filterAll: 'Alle zeigen',
    // the one-line strip under the head while a filter is on: «Gefiltert: Auftrag · Pendenz»
    filterActive: 'Gefiltert:',
    filterEmpty: 'Keine Einträge in dieser Auswahl',
    filterEmptyHint: '«Alle zeigen» hebt den Filter auf.',
    // ── Pendenzen ─────────────────────────────────────────────────────────────────────────
    // The ○ switch beside the Art chips. THREE states on one control; the accessible name says
    // what a tap will leave behind, because the ring alone cannot.
    // ⚠️ `openStates[0]` is what the resting ring announces — «offen halten», an instruction, not
    // a status. The other two are statuses, because by then it is one.
    openStates: ['Offen halten', 'Bleibt offen – steht in den Pendenzen', 'Dringend – steht zuoberst'] as string[],
    pendenzSaved: 'Pendenz erfasst',
    pendenzUrgentSaved: 'Pendenz erfasst – dringend',
    // an undatierte Pendenz never called itself an Erinnerung, so its done row must not either
    pendenzDoneLog: 'Pendenz erledigt: {text}',
    pendenzReopenLog: 'Pendenz wieder offen: {text}',
    // Meldungen ON a Pendenz — written in the ORDINARY composer, opened from the item's row
    noteOnTitle: 'Meldung',
    noteOnLabel: 'zu ',
    noteOnClear: 'Verknüpfung lösen',
    // The ○ switch's menu. ⚠️ «Neue Pendenz» is deliberately the FIRST row and «Meldung zu» the
    // heading of the second block: the menu has to read as one question — what is this line? — so
    // that «a new open item» and «a report on an existing one» are visibly the same kind of answer
    // rather than two features that happen to share a control.
    linkPendenzTitle: 'Meldung zu',
    pendenzNew: 'Neue Pendenz',
    pendenzNewUrgent: 'Dringende Pendenz',
    pendenzNotOpen: 'Nicht offen halten',
    noteSaved: 'Meldung erfasst',
    noteChip: 'Pendenz',
    noteOpen: 'Meldung erfassen',
    // the list's time column: when it was raised. Tapping it swaps the whole column to the age —
    // «seit wann läuft das» is the question, and on a long Einsatz the clock stops answering it.
    // ⚠️ BARE, and short enough for the 38px column the Verlauf's own clock sits in. «vor 32 min»
    // wrapped to three lines there and turned every row into a paragraph. The column is a toggle
    // between two readings of one instant, so the words are not what tells them apart — «21:58»
    // against «32′» could not be confused for each other if they tried.
    ageLabel: '{n}′',
    ageLabelHours: '{n} h',
    ageToggle: 'Zeit / Alter umschalten',
    openState: 'offen',
    // the Pendenzen block's mark on an item typed on the Tafel's «Aufträge / Pendenzen» page;
    // a tap opens that page
    fromTafel: 'von der Tafel',
    fromTafelTitle: 'Auf der Tafel eingetragen – tippen öffnet die Seite',
  },
  // ── The Tafel's «Aufträge / Pendenzen» page (05.11.2026, lib/pendenzenPage) ────────────────
  // A view on the Verlauf's Pendenzen and Erinnerungen: every act on the page appends a Verlauf
  // row in these words, so the record says where it happened.
  tafelPendenzen: {
    createdLog: 'Pendenz von der Tafel ({page}): {text}',
    createdWer: ' · Wer: {wer}',
    createdUrgent: ' · dringend',
    // a correction of Was / Wer / Prio. — `{changes}` joins the parts below with « · »
    editLog: 'Auf der Tafel geändert ({text}): {changes}',
    editWas: 'Was: {v}',
    editWer: 'Wer: {v}',
    editWerCleared: 'Wer entfernt',
    editUrgent: 'Prio. 1 (dringend)',
    editNotUrgent: 'ohne Prio.',
    doneLog: 'Erledigt auf der Tafel: {text}',
    reopenLog: 'Auf der Tafel wieder offen: {text}',
    erteilt: 'Erteilt',
    erledigt: 'Erledigt',
    erinnerung: 'Erinnerung',
    overdue: 'überfällig',
    prio: 'Prio. 1 – dringend',
    prioOff: 'Prio. 1 (dringend) setzen',
    prioOn: 'Prio. 1 (dringend) – tippen zum Entfernen',
    toVerlauf: 'Im Verlauf zeigen',
    // shown once, under a row just typed on the page: `{by}` is « · Name» or nothing
    saved: 'Als Pendenz im Verlauf eingetragen · {t}{by}',
    newRow: 'Neue Pendenz …',
    empty: 'Noch keine Pendenzen. Eine Zeile hier wird zur Pendenz im Verlauf – und jede Pendenz aus dem Verlauf steht hier.',
    emptyRo: 'Noch keine Pendenzen im Verlauf.',
  },
  errors: {
    updateFailed: 'Aktualisierung fehlgeschlagen',
    // a 422 field error the server sent without its own message (lib/api · ApiError.fields)
    invalidValue: 'Ungültiger Wert',
    // the error report's one row past its cap of distinct signatures (lib/reportError)
    moreSignatures: 'weitere Fehlersignaturen (über {n})',
    // network failures, both with ApiError status 0 — the app falls back to its offline caches
    // either way; the wording only tells the operator WHICH kind of dead line they have.
    serverUnreachable: 'Netzwerkfehler – Server nicht erreichbar',
    serverUnreachableHint: 'Kein Netz, oder der Server ist unter dieser Adresse nicht da. Gespeicherte Einsätze bleiben offline verfügbar.',
    serverTimeout: 'Server antwortet nicht – Zeitüberschreitung',
    serverTimeoutHint: 'Die Verbindung steht, es kommt nur nichts zurück – typisch für ein sterbendes WLAN. Gespeicherte Einsätze bleiben offline verfügbar.',
    // What an HTTP status MEANS, for when the server sent no message of its own (a 502 from the
    // reverse proxy is an HTML page, not our JSON). «HTTP 502» names the plumbing; it doesn't say
    // whether the tablet, the link or the server is at fault, whether waiting helps, or whether
    // the Einsatz data is safe — which is all the operator actually needs at 3am.
    httpUnauthorized: 'Anmeldung abgelaufen',
    httpUnauthorizedHint: 'Bitte neu anmelden.',
    httpForbidden: 'Keine Berechtigung',
    httpForbiddenHint: 'Dieses Konto darf das nicht. Mit einem Konto mit Bearbeitungsrecht anmelden.',
    httpNotFound: 'Vom Server nicht gefunden',
    httpNotFoundHint: 'Diese Adresse kennt der Server nicht. Möglicherweise läuft dort eine andere Version.',
    httpTooLarge: 'Datei zu gross',
    httpTooLargeHint: 'Der Server nimmt Dateien dieser Grösse nicht an.',
    httpStale: 'Seite veraltet',
    httpStaleHint: 'Diese Seite kennt einen älteren Stand. Neu laden und die Änderung wiederholen.',
    httpTooMany: 'Zu viele Versuche',
    httpTooManyHint: 'Kurz warten, dann nochmals versuchen.',
    httpRejected: 'Anfrage abgelehnt',
    httpRejectedHint: 'Der Server hat die Anfrage zurückgewiesen.',
    httpGateway: 'Server nicht erreichbar',
    httpGatewayHint: 'Der Server antwortet nicht – vermutlich startet er gerade neu. Gleich nochmals versuchen; gespeicherte Einsätze bleiben offline verfügbar.',
    httpServerError: 'Fehler auf dem Server',
    httpServerErrorHint: 'Die Anfrage kam an, der Server kam damit nicht zurecht. Nochmals versuchen – bleibt es dabei, liegt es nicht am Gerät.',
    /** the raw status, kept visible in small print: useless in the moment, decisive on the phone
     *  to whoever runs the server */
    httpCode: 'Fehlercode {code}',
  },
} as const
