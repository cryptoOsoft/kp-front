// German copy · Anwesenheit, Anrückend, Zeitplan and Schichten.
// One slice of the canonical `de` catalogue, assembled in ../de.ts — read the rules at the
// top of that file before adding or renaming a key here.

export const anwesenheitCopy = {
  // Anwesenheit surface (AnwesenheitView)
  anwesenheit: {
    title: 'Anwesenheit',
    // free remark per person for THIS Einsatz («Fahrer TLF», «abgelöst 21:40»)
    noteLabel: 'Bemerkung',
    notePlaceholder: 'z. B. Fahrer TLF',
    logNote: '{name} – Bemerkung: {note}',
    // The three Anwesenheit Verlauf rows. Until 09.08. they were German literals in the code — on
    // a French installation the journal was German in exactly these places, and the Rapport
    // prints it the way it was captured.
    logPresent: '{name} anwesend',
    logPresentAgain: '{name} wieder anwesend',
    logLeft: '{name} gegangen',
    // At the Einsatzort or still in the Magazin — the answer to «wen könnte ich noch nachziehen».
    // The entry holds only the CURRENT state; the Verlauf holds when it changed.
    ortScene: 'Vor Ort',
    ortStation: 'Magazin',
    ortToScene: '{name} an den Einsatzort schicken',
    ortToStation: '{name} ins Magazin setzen',
    logOrtScene: '{name} vor Ort',
    logOrtStation: '{name} im Magazin',
    // header line: how many are here first, then where they are
    summaryOrt: '{scene} vor Ort · {station} Magazin',
    // Somebody who isn't on the roster at all (guest, neighbouring Wehr, not synced yet).
    // Deliberately NOT a roster entry: they were here tonight – that is a statement about this
    // Einsatz, not about the Wehr.
    logGuestAdded: '{name} als weitere Person erfasst',
    // …und wenn der Name gleich in ein Rollenfeld getippt wurde (Fahrer, Stv., Einsatzleiter):
    // eine Zeile, nicht zwei. Erfasst und wofür, in derselben Bewegung.
    logGuestAddedAs: '{name} als weitere Person erfasst – {role}',
    // Die Gast-Tür, seit 11.09. die LETZTE Zeile der Mannschaftsliste statt eines «+» mit Dialog
    // dahinter: das Suchfeld ist auch die Namenseingabe, und diese Zeile erscheint nur, solange
    // etwas getippt ist. Sie trägt den getippten Namen selbst, damit die Zeile sagt, was der Tipp
    // tut, statt ein zweites Feld zu öffnen, das dieselbe Frage nochmals stellt. (Mit ihr sind
    // `addGuestTitle`/`addGuestHint`/`addGuestName`/`addGuestPlaceholder` weggefallen – der
    // Dialog, den sie beschrifteten, existiert nicht mehr.)
    // ⚠️ «Gast», dasselbe Wort wie auf dem Badge, das die neue Zeile gleich trägt (guestBadge)
    // und wie im Trupp-Picker (atemschutz.teamGuestAdd): eine Sache, ein Wort dafür, auf jedem
    // Bildschirm. ⚠️ «hinzufügen», nicht «erfassen»: die Person kommt zu einer Liste dazu.
    addGuest: '«{name}» als Gast hinzufügen',
    guestBadge: 'Gast',
    removeGuest: 'Person löschen',
    // Whoever takes on a role is present too – the remark is set automatically along with it, but
    // only if none has been written by hand yet.
    // one row per person, not one for the Anwesenheit and a second one for the role
    logPresentAs: '{name} anwesend – {role}',
    // Ein ganzer Trupp auf EINER Zeile. Die Namen sind, was gelesen wird – das Feld, aus dem die
    // Funktion kommt, ist es nicht (und «Bemerkung» war ohnehin falsch: bemerkt hat niemand
    // etwas, die App hat eine Funktion gesetzt).
    logRoleGroup: 'Unter {role}: {list}',
    // …und dieselbe Zeile für einen Trupp OHNE Atemschutz (04.09., Feldtest). «Unter AS» über
    // einem Verkehrstrupp war eine falsche Aussage darüber, wo jemand war – und «Unter Trupp»
    // wäre kein Deutsch. Eigene Zeile, gleiche Sache: die Namen sind, was gelesen wird.
    logRoleGroupTrupp: 'Im Trupp: {list}',
    // ⚠️ The record is APPEND-ONLY, so a step back cannot remove the tap's own row — it writes
    // the correction beside it, naming whoever moved.
    undoTap: 'Letzten Tipp zurücknehmen',
    redoTap: 'Tipp wiederherstellen',
    undone: 'Anwesenheit zurückgenommen: {names}',
    redone: 'Anwesenheit wiederhergestellt: {names}',
    roleEinsatzleiter: 'Einsatzleiter',
    // ⚠️ The SHORT form, for inside a sentence. A Verlaufszeile names the person and then
    // says what they are — «Rückmeldung an ELZ durch Widmer Céline (EL)» — and the full
    // doctrine word there is four syllables for one letter of information, on a surface
    // that is read in a hurry. The list itself keeps the whole word.
    roleEinsatzleiterShort: 'EL',
    // «Stv.» on the Einsatzleiter symbol: also a role, and without a remark the deputy was the
    // only one on the list with no reason given
    roleEinsatzleiterStv: 'Stv. Einsatzleiter',
    roleEinsatzleiterStvShort: 'Stv. EL',
    roleFahrer: 'Fahrer {vehicle}',
    // «Bedienung» on a placed device (Lüfter, Pumpe, Absperrung …) – the person operating it,
    // built like «Fahrer TLF»: the word plus the symbol's own label.
    roleBedienung: 'Bedienung {symbol}',
    // the Funktion written on an Offizier-Symbol, forwarded to that person's Anwesenheits-
    // Bemerkung — «Offizier SiBe», «Offizier Lüften». Without one: just «Offizier».
    roleOffizier: 'Offizier {funktion}',
    // somebody in an Atemschutz-Trupp — the same fact the picker states as «unter AS», written
    // onto their Anwesenheits-Zeile so the Personalblatt can tell them from the crew that stayed
    // at the Magazin. Short, because it shares a narrow column with «Fahrer TLF».
    roleAtemschutz: 'AS',
    // ⚠️ …und für einen Trupp OHNE Atemschutz (04.09., Feldtest). Bis dahin bekam JEDES
    // Truppmitglied «AS» auf seine Anwesenheitszeile – auch der Verkehrstrupp, der nie eine
    // Flasche gesehen hat. Der Verlauf druckt diese Bemerkung hinter den Namen (lib/journalLinks),
    // also stand «Müller Hans (AS)» in einem Rechtsdokument über jemanden, der nicht unter
    // Atemschutz war. Dieselbe Unterscheidung, die die Personenliste längst macht
    // («unter AS» / «im Trupp»), nur auf der Zeile selbst.
    roleTrupp: 'Trupp',
    /**
     * …und der GRUPPENFÜHRER dieses Trupps – «AS-GF», «Trupp-GF» (04.09., Feldtest).
     *
     * Die Zeile «Trupp Brunner Thomas / Müller Hans / Schmid Peter angemeldet» nannte drei
     * gleichwertige Namen; wer für den Trupp antwortet, stand nirgends. Es ist eine FUNKTION,
     * keine Verzierung der Logzeile: hier eingetragen, druckt der Verlauf sie ohnehin hinter den
     * Namen (lib/journalLinks), und sie steht zusätzlich auf der Anwesenheitsliste und auf dem
     * Personalblatt – wo ein Wort in einer einzelnen Logzeile nie hingekommen wäre.
     *
     * ⚠️ EIN Token mit Bindestrich, nicht «GF, AS». Die Bemerkung ist eine Komma-Liste von
     * Funktionen («AS-GF, Fahrer PIO»), und «GF» als eigenes Glied liesse offen, wovon jemand
     * Gruppenführer ist – und würde beim nächsten Job zwischen zwei fremde Glieder rutschen.
     * ⚠️ Auch allein sinnvoll: bei einem Ein-Mann-Trupp sagt «AS-GF» weiterhin, was die Person
     * IST – anders als ein Zusatz in der Logzeile, der dort niemanden mehr unterschieden hätte.
     */
    roleLeader: '{role}-GF',
    roleOffizierPlain: 'Offizier',
    // Soft warning in the person picker (Atemschutz): whoever already has a role is probably
    // already committed – they can still be picked, always.
    // ⚠️ The ROLE, nothing in front of it. «schon:» read as a refusal on a row that refuses
    // nothing, and the note sits in the same slot as «in einem Trupp» / «nicht anwesend», which
    // both simply state what somebody is. So does this one.
    alreadyBooked: '{role}',
    // Hints, never blocks: the app says what it knows and lets people decide.
    conflictUnderPa: '{name} ist unter AS – Trupp {trupp}.',
    // …und dasselbe für einen Trupp OHNE Atemschutz (types · TruppKind `einfach`, 03.09.):
    // «unter AS» über einem Verkehrstrupp wäre eine falsche Aussage darüber, wo jemand war.
    conflictInTrupp: '{name} ist im Trupp {trupp}.',
    // the same thing as a short badge ON the list row — that is where it is decided, not after
    // ⚠️ «AS», not «PA» (10.08.). PA is the Pressluftatmer — the device. What this badge says
    // is that somebody is under ATEMSCHUTZ, which is the doctrine word, the name of the board
    // and the name of the whole surface. One thing, one abbreviation.
    statusUnderPa: 'unter AS',
    // …und für einen Trupp ohne Atemschutz (siehe conflictInTrupp). Gleicher Slot, gleiche Länge.
    statusInTrupp: 'im Trupp',
    conflictElInTrupp: '{name} ist Einsatzleiter und zugleich im Trupp {trupp}.',
    conflictLeft: '{name} ist als «gegangen» erfasst.',
    // ⚠️ No «{total} Mannschaft». How big the Wehr is is the one number everybody already
    // knows; on the line that answers «wie steht es gerade» it was a constant among two counts
    // that move.
    // ⚠️ «gegangen» LAST, after the Ort split. The line reads left to right as «how many are
    // here, where are they» — and «gegangen» is the only count that is about people who are not
    // part of that picture any more, so it belongs at the end rather than between the two
    // numbers that describe the crew on hand.
    summary: '{present} anwesend',
    summaryLeft: '{left} gegangen',
    reload: 'Personal neu laden',
    loading: 'Wird geladen …',
    // ⚠️ Das Feld sucht UND erfasst (11.09., wie im Trupp-Picker seit 04.09.): wen die
    // Mannschaftsliste nicht kennt, den nimmt die letzte Zeile der Liste als Gast auf. Der
    // Platzhalter sagt das aber NICHT mehr (18.09.): «Suchen …» ist die app-weite Beschriftung
    // jeder Suchzeile, und die Gast-Tür steht als eigene letzte Zeile in der Liste.
    searchPlaceholder: 'Suchen …',
    statusFrei: 'nicht anwesend',
    statusPresent: 'anwesend',
    statusLeft: 'gegangen',
    // Zwei Filter-Knöpfe: Grad (Mannschafts-Glyphe) und Zustand (Trichter). Die Legende IST
    // das Zustand-Menü – jede Zeile trägt ihr Zeichen, also wird dort auch nachgeschaut.
    filterLabel: 'Filtern',
    statusAll: 'Alle',
    // ⚠️ «Nach Status filtern», nicht «Was bedeuten die Zeichen?». Das Menü filtert – dass man
    // daneben auch nachschaut, was der Punkt bedeutet, ist ein Nebeneffekt und kein Titel.
    statusFilterLabel: 'Nach Status filtern',
    noteOnly: 'Nur mit Bemerkung',
    loadFailedTitle: 'Personal konnte nicht geladen werden.',
    loadFailedHint: 'Offline oder Server nicht erreichbar. Zuletzt geladene Liste bleibt erhalten.',
    emptyTitle: 'Noch kein Personal erfasst.',
    // same rule as emptyApp.bodyEditor: name the source only where there is one to name
    emptyHint: 'Personal wird in der Verwaltung erfasst oder synchronisiert.',
    emptyHintSync: 'Synchronisiere das Personal aus {provider}.',
    retry: 'Erneut versuchen',
    // ⚠️ Nennt die TASTE, die den Trupp löst, und zwar wie sie heisst (04.09.). «zuerst Trupp
    // draussen melden» war eine Umschreibung: auf der Tafel steht «Raus melden», und wer eine
    // Anweisung liest, sucht danach das Wort daraus. Auch nicht mehr «Atemschutz-Trupp» – die
    // Sperre gilt für JEDEN Trupp (lib/personnel · assignedPersonIds), auch den ohne Atemschutz.
    lockedTitle: 'Im Trupp – zuerst über «Raus melden» austreten',
    notInDivera: 'Nicht mehr auf der Personalliste',
    notInSource: 'Nicht mehr in {provider}',
    weg: 'weg',
    // …and the one-tap version of the same question, on ALL three tabs (18.09.2026): a ✓ in the
    // search row narrows the list to whoever is «Vor Ort» right now. The button is a state, not
    // an instruction, so it names the filter and lets `aria-pressed` say whether it is on.
    onlyPresent: 'Nur Anwesende',
    rankFilterLabel: 'Nach Grad filtern',
    rankAll: 'Alle',
    // Return: the third tap deletes (clears), so returning gets a button of its own. It opens a
    // NEW Anwesenheit block; the first one keeps its von–bis.
    backAgain: 'Wieder da',
    // «Block» was workshop language – nobody on the ground thinks in blocks. They are Zeiten.
    // Anwesenheit sheets: the same shape as the Schichten view, so both read the same way
    von: 'von',
    bis: 'bis',
    addBlock: 'Neue Zeit ab jetzt',
    blockSplit: '{name}: neue Zeit – die laufende wurde beendet',
    blockRemoved: 'Zeit von {name} gelöscht',
    blockRemove: 'Zeit löschen',
    blocksTitle: 'Anwesenheit – {name}',
    blocksSection: 'Erfasste Zeiten',
    blocksNone: 'Noch nicht anwesend gewesen.',
    openBlocks: 'Anwesenheit von {name} öffnen',
    openBlocksNote: 'Anwesenheit von {name} öffnen – Bemerkung erfasst',
    statusNote: 'Bemerkung',
    stillHere: 'noch da',
    // Head of the time card: what this row IS. Not a switch – an Anwesenheit is running or has
    // ended, and the list decides that, not this sheet.
    running: 'läuft',
    ended: 'beendet',
    // on the head of the Zeitplan card, on hover: it looks like a heading
    flip: 'umschalten',
    // Switch over the same Mannschaft, three views: who is HERE, who can be there WHEN
    // (continuous time, person-major), and who staffs WHICH window (discrete time, Schicht-major).
    // «Anwes.» and not «Anwesenheit»: only abbreviated do three segments fit on 390 px (~278 px
    // available, ~250 needed). The third one belongs here and not in the ⋯ menu – a whole way of
    // working does not sit behind three dots.
    viewList: 'Anwesenheit',
    viewPlan: 'Zeitplan',
    viewBands: 'Schichten',
    viewLabel: 'Ansicht',
  },
  // «Anrückend» — die Divera-Rückmeldungen über der Anwesenheit (AnrueckendBlock, X1 08.10.2026).
  // Nur ja / nein und Namen (Besitzer, 09.10.2026). ⚠️ Eine Divera-Antwort ist KEINE Anwesenheit:
  // erst «da» erfasst jemanden. «kommt nicht» steht in einer eigenen, gedämpften Gruppe — mit ✕
  // und dem Wort, nie nur als Farbe.
  anrueckend: {
    title: 'Anrückend',
    sourceBare: 'Divera',
    coming: (n: number) => (n === 1 ? '1 kommt' : `${n} kommen`),
    notComing: (n: number) => (n === 1 ? '1 kommt nicht' : `${n} kommen nicht`),
    here: (n: number) => `${n} da`,
    notComingGroup: (n: number) => `Kommt nicht (${n})`,
    notComingWord: 'kommt nicht',
    checkIn: 'da',
    checkInLabel: '{name} ist da – als anwesend erfassen',
    allHere: 'Alle, die kommen wollten, sind erfasst.',
    unmapped: (n: number) => (n === 1 ? '1 Rückmeldung ohne Eintrag in der Mannschaftsliste' : `${n} Rückmeldungen ohne Eintrag in der Mannschaftsliste`),
    hint: 'Eine Divera-Antwort ist keine Anwesenheit – erst «da» erfasst jemanden.',
    collapse: 'Anrückend einklappen',
    expand: 'Anrückend aufklappen',
  },
  // Schicht planning – the command form «Zeitplan» (who × time), purely planning: planned bars
  // are hollow, actual Anwesenheit is filled. The plan never writes.
  zeitplan: {
    title: 'Zeitplan',
    summary: '{planned} eingeplant · {present} jetzt da',
    summaryEmpty: 'Noch nichts geplant',
    add: 'Schicht',
    from: 'von',
    to: 'bis',
    remove: 'Schicht löschen',
    removed: 'Schicht {name} gelöscht',
    // A swipe and a drag fire as easily as a mis-tap – so they get the same undo as deleting.
    // The planned⇄fixed toggle does not: a second tap takes that back.
    added: 'Schicht für {name} geplant',
    moved: 'Schicht von {name} verschoben',
    conflict: 'Doppelt eingeteilt – zwei Schichten zur selben Zeit',
    // The one mistake this form is meant to find – so it is spoken out loud instead of sitting as
    // a 12px glyph on a filled bar, where it has the lowest contrast of the whole surface (and
    // whose explanation was stuck in a `title` that a touchscreen never shows).
    // Reported, not refused: at 3am a double entry is a hint to take a look.
    conflictTitleOne: 'Eine Person ist doppelt eingeteilt.',
    conflictTitleMany: '{n} Personen sind doppelt eingeteilt.',
    conflictWho: '{name} · {from}–{to}',
    conflictMore: '… und {n} weitere',
    // The path differs per surface: on the time axis the tap switches directly, in the band grid
    // it asks first when the time reaches beyond the Wache. So the sentence names the GOAL, not
    // the mechanics – otherwise it would be wrong on one of the two.
    conflictFix: 'Eine der beiden Einteilungen antippen und auf «verfügbar» setzen – die Zeit selbst bleibt stehen.',
    conflictShort: 'doppelt eingeteilt',
    // A Schicht whose «bis» lies before its «von» is not drawn at all. This badge stands in its
    // place, so the row doesn't stay silent.
    brokenShift: 'Diese Schicht endet vor ihrem Anfang – zum Korrigieren antippen',
    now: 'jetzt',
    coverage: 'Deckung',
    coverageHint: 'Drei Linien: grau verfügbar, blau eingeteilt, grün tatsächlich anwesend – wo die grüne Linie einbricht, ist die Lücke.',
    // The coverage row expands: the curve says WHERE the gap is, the numbers say HOW MANY.
    // Collapsed by default – the shape reads at a glance, the digits cost three lines.
    coverageExpand: 'Zahlen zeigen – wie viele verfügbar, eingeteilt und anwesend sind',
    coverageCollapse: 'Zahlen ausblenden',
    planned: 'verfügbar',
    actual: 'anwesend',
    emptyTitle: 'Noch keine Schicht geplant.',
    emptyHint: 'Plane pro Person, von wann bis wann sie verfügbar ist. Der Plan verändert die Anwesenheit nicht – abgehakt wird sie weiterhin in der Anwesenheitsliste.',
    legendHint: 'Hohl = verfügbar · gefüllt = eingeteilt · grün = tatsächlich anwesend',
    print: 'Zeitplan drucken',
    // TWO sheets, picked separately – they answer different questions, so which one was meant is
    // asked rather than guessed. Pick the sheet first, then the route: the sheet names its
    // content and offers printer and PDF. That keeps the confirmation before printing (paper
    // comes out of the machine before a toast has faded), without needing four menu entries.
    sheetSchichtplan: 'Schichtplan …',
    sheetVerfuegbarkeiten: 'Verfügbarkeiten …',
    sheetSchichtplanTitle: 'Schichtplan',
    sheetVerfuegbarkeitenTitle: 'Verfügbarkeiten',
    // «66 Personen · 2 Schichten · Stand 09:14» – the number doubles as a check that the filter
    // above is set the way it was meant to be. Both counts inflect on their own («1 Person»,
    // «1 Schicht») – as functions, like `intake.objectPlans`, so the singular isn't lost when
    // composed into the sentence below.
    peopleCount: (n: number) => (n === 1 ? '1 Person' : `${n} Personen`),
    bandsCount: (n: number) => (n === 1 ? '1 Schicht' : `${n} Schichten`),
    sheetContent: '{people} · Stand {t}',
    sheetContentBands: '{people} · {bands} · Stand {t}',
    sheetSchichtplanHint: 'Die Wachen quer, die Namen längs, Häkchen dazwischen – das Führungsformular, wie es die Mannschaft kennt.',
    sheetVerfuegbarkeitenHint: 'Wer von wann bis wann kann, unabhängig von jeder Schicht – auch alle, die in keiner stehen.',
    pdf: 'Als PDF',
    pdfBusy: 'PDF wird erstellt …',
    paperMenu: 'Aufs Papier',
    printFailed: 'Zeitplan konnte nicht gedruckt werden.',
    // head of the name column – as on the printed form
    who: 'Wer',
    editTitle: 'Schichten – {name}',
    plannedSection: 'Verfügbarkeit & Einteilung',
    actualSection: 'Tatsächlich anwesend',
    actualHint: 'Kommt aus der Anwesenheit und wird dort erfasst – der Zeitplan ändert sie nicht.',
    actualNone: 'Noch nicht anwesend gewesen.',
    plannedNone: 'Noch keine Verfügbarkeit erfasst.',
    addShift: 'Schicht erstellen',
    shiftAdded: 'Schicht erstellt',
    stillHere: 'noch da',
    // Head of the time card: what this row IS. Not a switch – an Anwesenheit is running or has
    // ended, and the list decides that, not this sheet.
    running: 'läuft',
    ended: 'beendet',
    // on the head of the Zeitplan card, on hover: it looks like a heading
    flip: 'umschalten',
    done: 'Fertig',
    // direct operation on the grid – like the paper form you fill in
    fromStart: 'ab Beginn',
    sheetHint: 'Zeiten hier anpassen, Zustand rechts umschalten. Gelöscht wird nur hier.',
    laneHint: 'Ziehen erfasst die Verfügbarkeit. Balken antippen teilt die Person ein. Ziehen verschiebt den Balken. Gedrückt halten öffnet die Schichten.',
    // the (i) tap-toggle above the gesture explainer — title only, so it costs no line of its own
    laneHintShow: 'Bedienung anzeigen',
    laneHintHide: 'Bedienung ausblenden',
    // Three states of a row: what somebody OFFERS, what was ASSIGNED out of it, and what actually
    // happened. A bar tap switches the first two, the third comes from the Anwesenheit and is
    // never written here.
    available: 'verfügbar',
    confirmed: 'eingeteilt',
    toggleHint: 'Tippen macht daraus «{state}»',
    zoomIn: 'Zeitraum enger',
    zoomOut: 'Zeitraum weiter',
    horizonUntil: 'bis {t}',
    horizon: 'Zeitraum',
    openFor: 'Schichten von {name} öffnen',
    planAt: 'Schicht für {name} planen',
    dragFrom: 'Beginn ziehen',
    // right-click menu on a bar: name the states instead of cycling through them
    editEntry: 'Bearbeiten …',
    dragTo: 'Ende ziehen',
  },
  // Schichtbänder (BandGrid) — the transpose of the Zeitplan. The Zeitplan is person-major over
  // continuous time («pick a person, draw when»); here the column is a named time window and per
  // person you only decide WHO. That removes time entry entirely: one tap per cell instead of
  // open sheet · pick von · pick bis · close.
  schichten: {
    title: 'Schichten',
    // head of the name column, as on the printed Führungsformular
    who: 'Wer',
    // The ONE way in: no suggestion, no adopting from a bar, no harvesting.
    addBand: 'Schicht definieren',
    addBandFirst: 'Erste Schicht definieren',
    emptyTitle: 'Noch keine Schicht.',
    emptyHint: 'Leg die Zeitfenster an, die du besetzen willst – danach wird pro Person nur noch angetippt.',
    emptyAxisHint: 'Oder im Zeitplan pro Person frei einzeichnen.',
    // The band sheet: creating and editing share one surface
    sheetAddTitle: 'Schicht erstellen',
    sheetEditTitle: 'Schicht bearbeiten',
    labelField: 'Name',
    labelPlaceholder: 'Früh',
    // The reassurance the whole design rests on: creating one assigns nobody.
    sheetHint: 'Die Schicht wird für das ganze Personal angelegt. Jede Zelle beginnt leer.',
    create: 'Erstellen',
    save: 'Speichern',
    // the bare word (UX sweep F4 rework, 21.10.2026, owner: «Schichtband löschen» wrapped onto two
    // lines in the footer) – the sheet's title names the band, so the button needn't; and it no
    // longer reads «Schicht löschen», which is one person's stretch (zeitplan.remove). «löschen»,
    // not «entfernen»: the band record itself is destroyed – what survives are the people's
    // times, which are records of their own. The toast says «Schichtband».
    removeBand: 'Löschen',
    // What gets deleted is the BAND, not the planning: the Schichten remain as freehand ones.
    // This is the one path on which real planning would otherwise vanish silently.
    removeBandHint: 'Gelöscht wird nur die Spalte – die eingeteilten Zeiten bleiben als freihändige im Zeitplan stehen.',
    removedBand: 'Schichtband «{label}» gelöscht',
    // When a band is moved: no silent coupling in either direction.
    moveTitle: 'Zeiten mitziehen?',
    moveMsg: '{n} Personen sind auf die alten Zeiten eingeteilt. Sollen ihre Zeiten mitziehen?',
    moveYes: 'Mitziehen',
    moveNo: 'Nur die Schicht',
    // Header numbers of a column. Two bare digits side by side («0  8») don't say which is which
    // – the legend in the WER column names them once for all columns, instead of labelling every
    // column twice. Counted proportionally: the number answers «wie viele habe ich in diesem
    // Fenster», not «wie viele Häkchen sehe ich».
    countsAria: '{available} verfügbar, {planned} geplant',
    // The same two words as the coverage curve in the Zeitplan – one surface, one vocabulary.
    // This used to say «frei» and «fix», which were two names for the same two states.
    available: 'verfügbar',
    confirmed: 'geplant',
    // Somebody with freehand times and no band would otherwise show up empty everywhere – like
    // somebody who offered nothing. The badge names the real time, so the grid doesn't claim that.
    ownTimes: 'eigene Zeiten ausserhalb jeder Schicht: {times}',
    ownTimesMore: '{first} +{n}',
    // Cell: a Schicht with a bandId whose times deviate from the band. It shows its real time and
    // is never deleted by tapping – there is hand-drawn planning behind it.
    deviating: '{name}: {from}–{to} statt {bandFrom}–{bandTo}',
    cellAria: '{name} in {band}',
    // One word only fits a window in which ONE state holds throughout. «Verfügbar 09–11» and
    // «geplant 10–20» inside a Wache of 07–12 are three states (nothing, offered, assigned);
    // there is no true word for that, so the cell says «teilweise» and the strip below it shows
    // where what lies.
    // A cell speaks about ITS column: if the time runs to the end of the Wache, the only news is
    // its start – and vice versa. Shorter than a full range, and more precise.
    cellFrom: 'ab {t}',
    cellUntil: 'bis {t}',
    partial: 'teilweise',
    partialHint: 'Nicht alle davon decken die ganze Schicht ab.',
    // A tap on a mixed cell has no unambiguous continuation – otherwise it would flip between two
    // states without either one ever holding for the whole window.
    resolveTitle: 'Teils verfügbar, teils geplant',
    resolveMsg: '{name} ist in {band} teilweise eingeteilt und teilweise nur verfügbar. Was soll für dieses Fenster gelten?',
    // ⚠ A Schicht has ONE state: if it reaches beyond the Wache, the change carries along.
    resolveGap: 'Der Rest der Schicht ist von dieser Person nicht abgedeckt – das bleibt so.',
    // One dragged span becomes three objects – you find that out beforehand, not afterwards.
    splitTitle: 'Wird geteilt',
    splitChanges: 'ändert sich',
    splitKeeps: 'bleibt {state}',
    // Only the middle piece changes – that is the point of the cut.
    splitNote: 'Nur das Stück innerhalb der Schicht ändert sich; ausserhalb bleibt alles, wie es ist.',
    crossTitle: 'Reicht über die Schicht hinaus',
    crossMsg: 'Diese Zeit von {name} läuft über {band} hinaus. Was soll für dieses Fenster gelten?',
    resolveAvailable: 'Alles auf verfügbar',
    resolveConfirmed: 'Alles auf geplant',
    resolveCancel: 'Abbrechen',
    conflict: 'Doppelt eingeteilt – zwei Schichten zur selben Zeit',
    // right-click on a cell: name the states instead of cycling through them
    editEntry: 'Bearbeiten …',
    scrollHint: 'Waagrecht rollen für weitere Schichten',
  },
} as const
