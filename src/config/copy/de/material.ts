// German copy · Material (Mittel) and checklists.
// One slice of the canonical `de` catalogue, assembled in ../de.ts — read the rules at the
// top of that file before adding or renaming a key here.

export const materialCopy = {
  // Mittel surface (MittelView) — manual material capture for Rapport / resupply
  mittel: {
    title: 'Material',
    summary: (n: number) => (n === 1 ? '1 Position' : `${n} Positionen`),
    summaryEmpty: 'Noch nichts erfasst',
    add: 'Material',
    // «In Verwendung» ist ein Filter-Knopf auf der Suchzeile, kein Tab mehr – die Bezeichnung
    // bleibt, sie ist jetzt Tooltip und aria-label. (viewLabel/viewList sind mit dem Tab weg.)
    viewBySource: 'In Verwendung',
    // the category filter's WORD on a wide head (22.09.2026)
    categoryFilterWord: 'Filtern',
    // Suche + Kategorie-Filter, gebaut wie in der Anwesenheit: eine Zeile über der Liste
    noSource: 'Ohne Zuordnung',
    searchPlaceholder: 'Suchen …',
    categoryFilterLabel: 'Nach Kategorie filtern',
    categoryAll: 'Alle',
    categoryOther: 'Übrige',
    // trailing group for free-typed (incident-local) lines in the unified list
    customGroup: 'Weitere',
    // remaining-stock readout: dots up to 7 Stück, «noch N» beyond; aria/tooltip spells it out
    noch: 'noch {n}',
    stockAria: '{label}: noch {remaining} von {total}',
    // Kompakte Ruhezeile: eine unberührte Position (0 verwendet) zeigt nur Bezeichnung,
    // Restbestand und dieses «+» statt des ganzen ±Stellers – ein voller Katalog ist sonst auf
    // dem Telefon zwei Zeilen pro Position, von denen die zweite nur eine Null zeigt. Der erste
    // Tipp setzt 1 UND klappt die Zeile auf den ±Steller auf: ein Tipp, nicht zwei.
    addOne: '{label} erfassen',
    // …ausser die Position liegt auf mehreren Fahrzeugen und mehr als eines führt sie: dann
    // klappt der Tipp die Quellen auf und fragt «von wo», statt eine zu raten.
    addPickSource: '{label} – Quelle wählen',
    emptyTitle: 'Noch kein Material erfasst.',
    emptyHint: 'Erfasse mit «+ Material», was verbraucht wurde – fürs Rapport und um zu sehen, ob Nachschub nötig ist.',
    emptyReadonly: 'Noch kein Material erfasst.',
    // Composer
    composerTitle: 'Material erfassen',
    materialLabel: 'Material',
    materialPlaceholder: 'Material wählen',
    // the OPEN picker's own search row — Combo defaults this to «Person suchen …» (built for
    // roster fields), which is the wrong noun for a material/unit/Quelle picker
    materialSearchPlaceholder: 'Material suchen …',
    customMaterial: 'Anderes Material',
    // Suchen heisst erfassen (11.09.): Was die Suchzeile nicht findet, wird aus der Suchzeile
    // heraus erfasst – die Zeile trägt die Eingabe selbst, also sagt sie, was der Tipp tut,
    // statt den Composer mit leerem Feld zu öffnen und denselben Namen ein zweites Mal zu
    // verlangen. ⚠️ Mit «», weil hier ein GETIPPTER Name steht; `addOne` («{label} erfassen»)
    // bucht dagegen eine Katalogposition, die sich selbst benennt.
    composerFromQuery: '«{name}» erfassen',
    unitLabel: 'Einheit',
    unitPlaceholder: 'Einheit',
    unitSearchPlaceholder: 'Einheit suchen …',
    sourceLabel: 'Quelle',
    sourcePlaceholder: 'Quelle (optional)',
    sourceSearchPlaceholder: 'Quelle suchen …',
    // ⚠️ The configured Fahrzeuge are the usual answer, never the whole one. Material comes off a
    // Nachbarwehr's TLF, out of the Depot, from the Werkhof, off a lorry that happened to be
    // there — and the picker offered no way to say so, so those lines were recorded with no
    // Quelle at all and the Rapport could not say where anything came from. Getippt wird seit
    // 11.09. in der Suchzeile des Pickers selbst (`combo.useTyped`) – die eigene Zeile
    // «Andere Quelle eingeben …» dafür ist damit weg.
    qtyLabel: 'Menge',
    save: 'Speichern',
    cancel: 'Abbrechen',
    removeRow: 'Auf 0 setzen',
    // deleting happens immediately with an undo toast; the Verlauf is kept
    removedToast: '«{label}» gelöscht',
    // Verlauf rows
    logSet: '{label}: {menge} {unit}',
    logRemoved: '{label} auf 0 gesetzt',
    logDeleted: '{label} gelöscht',
    // an un-delete (the removal's «Rückgängig») is its own sentence
    logRestored: '{label} wiederhergestellt',
    logNote: '{label} – Bemerkung: {note}',
    logStock: '{label} – Bestand: {stock}',
    // Angehängt an eine gesetzte Menge: WOHER die Zahl kommt. Ohne sie sagt die Zeile nur,
    // wie viel jetzt dort liegt – auf Papier wird der Verlauf aber gelesen, um zu sehen, was
    // passiert ist. Entfällt bei einer erstmals erfassten Position (es gibt kein «vorher»).
    logBefore: '(vorher {n})',
    noteLabel: 'Bemerkung',
    notePlaceholder: 'z. B. an Werkhof übergeben',
    // Pencil dialog on a self-captured row: correct label/unit/source/stock after the fact – it
    // is captured once and read for the whole Einsatz
    editLabel: 'Eintrag bearbeiten',
    stockLabel: 'Bestand',
    deleteLine: 'Eintrag löschen',
    // Symbol→Mittel: the reconciliation strip above the list. Third home of this offer
    // (28.08.): as a toast it was missed, as a row in the symbol's card it was only seen by
    // whoever re-opened the symbol. Now the SHEET says what stands on Karte/Plan and is not
    // recorded yet — one sentence, one button, gone once the counts agree (or dismissed).
    // {list} = «2× Lüfter mobil · Ölbinder»
    lageStrip: 'Gesetzt, aber nicht erfasst: {list}',
    lageStripTake: 'Übernehmen',
    lageStripHide: 'Vorschläge ausblenden',
    // Ambiguous set (several catalogue candidates for a symbol and/or several stocked sources):
    // one-tap would book a guess, so the button announces the intermediate step («…») and opens
    // the picker sheet instead. Fully unambiguous sets keep the one-tap «Übernehmen».
    lageStripCapture: 'Erfassen …',
    // The picker sheet: one group per open symbol (radio rows: Typ + Quelle + Restbestand), the
    // unambiguous rest pre-ticked below, a counting footer button that books everything at once.
    lagePickTitle: 'Gesetzt, aber nicht erfasst',
    lagePickSub: '{n} Symbole auf Karte/Plan sind noch nicht im Material. Welche waren es?',
    lagePickSubOne: 'Ein Symbol auf Karte/Plan ist noch nicht im Material. Welches war es?',
    lagePickGroupHint: 'Symbol auf Karte/Plan',
    lagePickGroupSourceHint: 'Quelle?',
    lagePickUnambiguous: 'Eindeutig',
    lagePickUnambiguousSub: 'wird ohne Rückfrage erfasst',
    lagePickOpen: 'Noch {n} Fragen offen',
    lagePickOpenOne: 'Noch 1 Frage offen',
    lagePickConfirm: '{n} Positionen erfassen',
    lagePickConfirmOne: '1 Position erfassen',
    // Retablierung per equipment row (consumable Mittel end up in the resupply list)
  },
  // Checkliste surface (ChecklistsView · ChecklistRunner · ChecklistReference)
  checklists: {
    railLabel: 'Checklisten',
    showList: 'Liste anzeigen',
    groupTasks: 'Aufgaben',
    // ONE placeholder for the library search wherever it stands – the Einsatz rail and the Karte
    // home, tablet and phone (sweep F.10, 23.10.2026: it had three). Short, because the phone
    // field is narrow and the surface already says what it holds; searchAria carries the words.
    searchPlaceholder: 'Suchen …',
    searchAria: 'Anleitung oder Checkliste suchen',
    // the rail's group of the Stichworte the Einsatz title names (ChecklistsView)
    groupMatching: 'Passend',
    none: 'Keine Checklisten konfiguriert.',
    pickEntry: 'Stichwort wählen oder suchen.',
    // runner
    done: 'erledigt',
    variantLabel: 'Variante',
    pickVariant: 'Variante wählen, um die Aufgaben zu sehen.',
    milestoneTitle: 'Meilenstein – erscheint im Verlauf',
    // the word the flag wears on the row (22.09.2026): the tooltip above is what a mouse
    // reads, and a tablet reads nothing — a lone glyph said «something», not what
    milestoneTag: 'wird im Verlauf notiert',
    // un-ticking a milestone — by tap or by ↶ — APPENDS this beside the ☑ row (lib/useChecklistActions)
    milestoneUndone: 'Meilenstein zurückgenommen: {text}',
    // a `problems` list (Problemerfassung, 05.11.2026): a tick is a problem on the Tafel
    trendLabel: 'Tendenz',
    trendAria: 'Tendenz von «{text}»',
    onTafel: 'auf der Tafel',
    forTafel: 'für die Tafel vorgemerkt',
    actionLabels: { journal: 'Verlauf', plan: 'Plan', draw: 'Zeichnen' } as Record<string, string>,
    // reference reader: hazard-colour badge labels
    hazardLabels: { red: 'Brand', orange: 'Gefahren', green: 'Verkehr', yellow: 'Technik', blue: 'Wasser' } as Record<string, string>,
    diagramAlt: 'Diagramm Seite {page}',
    diagramOpen: 'Diagramm vergrössern',
    // Anleitungen (kind: manual, 05.10.2026) — read-only Geräte-Anleitungen (ManualReader)
    groupManuals: 'Anleitungen',
    manualUpdated: 'Stand {date}',
    manualWarning: 'Achtung:',
    manualImageAlt: 'Bild zu Schritt {n}',
    manualImageOpen: 'Bild vergrössern',
    manualSource: 'Quelle: {source}',
    // the devices and the Karte's Checkliste surface (DeviceManuals, ChecklistLibrary, 19.10.2026)
    chapters: '{n} Kapitel',
    chapterOf: 'Kapitel {k} von {n}',
    chapterN: 'Kapitel {k}',
    chapterNav: 'Kapitel',
    groupChecklists: 'Checklisten',
    readOnlyTag: 'zum Lesen',
    readOnly: 'Zum Lesen. Abgehakt wird im Einsatz.',
    points: '{n} Punkte',
    phases: '{n} Phasen',
    hitKeyword: 'Stichwort «{k}»',
    searchEverything: 'Eine Suche über alles – Gerät, Titel, Stichworte, Schritte.',
    back: 'Zurück',
  },
} as const
