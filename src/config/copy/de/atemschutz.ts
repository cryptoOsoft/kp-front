// German copy · the Trupps board (Atemschutz) and line decorations.
// One slice of the canonical `de` catalogue, assembled in ../de.ts — read the rules at the
// top of that file before adding or renaming a key here.

import type { LineContent } from '../../../types'

export const atemschutzCopy = {
  atemschutz: {
    title: 'Atemschutzüberwachung',
    // Der Titel über der Tafel in der VOLLEN App (Mock «Sektionen», 03.09.): die Fläche trägt seit
    // 03.09. beide Abschnitte – die Atemschutzkarten oben, die Arbeitstrupps darunter –, und
    // «Atemschutzüberwachung» über einer Zeile «Verkehr» wäre schlicht falsch. Die abgegebene
    // Tafel («Tafel pur») behält `title`: dort gibt es nur den Atemschutz.
    boardTitle: 'Trupps',
    /* ── Die abgeschnittene Titelzeile als Tür (09.09., Mock 01) ────────────────────────────
     * Der einzeilige Kopf kauft seine Zeile damit, dass der Einsatzname dort endet, wo die
     * Knöpfe anfangen. Was abgeschnitten ist, muss erreichbar bleiben – und niemand sucht es
     * woanders als an der Zeile selbst. `headDetailOpen` beschriftet den Knopf (also die
     * Handlung), `headDetailTitle` benennt die Fläche, die aufgeht.
     * ⚠️ «Einsatz», nicht «Details»: was aufgeht, sind Stichwort, Adresse und der Stand –
     * die Angaben zum Einsatz, nicht eine Einstellungsfläche. */
    headDetailOpen: 'Einsatzangaben anzeigen',
    headDetailTitle: 'Einsatz',
    // Abschnittsköpfe der Tafel. Die Linie ist die Trennung, das Wort das Versprechen: was oben
    // steht, wird überwacht – was unten steht, nicht.
    sectionAtemschutz: 'Atemschutz',
    sectionAtemschutzEmpty: 'Zurzeit ist kein Trupp unter Atemschutz.',
    sectionPlain: 'Weitere Trupps',
    // «Art des Trupps» – die EINE Entscheidung beim Anlegen, danach nicht mehr änderbar
    // (types · Trupp.kind). Beide Optionen sagen, was sie mitbringen, nicht was sie sind.
    kindLabel: 'Art des Trupps',
    kindAtemschutz: 'Unter Atemschutz',
    kindPlain: 'Ohne Atemschutz',
    // Das kleine Zeichen an einer Truppzeile in den AUSWAHLEN («Welcher Trupp?» auf Karte und
    // Plan, Trupp-Suche): dort stehen Atemschutz- und Arbeitstrupps in EINER Liste, und wer
    // gleich unter Presslufatmer geht, ist die Zeile, die man beim Platzieren nicht verwechseln
    // darf. Kurz, weil es neben dem Namen sitzt – dasselbe Kürzel, das die Anwesenheit auf die
    // Personenzeile schreibt (personnel · roleAtemschutz).
    asMark: 'AS',
    empty: 'Noch kein Trupp in Überwachung.',
    emptyHint: 'Lege einen Trupp an, um die Überwachung zu starten.',
    newTrupp: 'Trupp anmelden',
    // «Überwachung abgeben» — der QR neben der Glocke: die Tafel dieses Einsatzes auf ein
    // fremdes Handy geben, damit jemand ohne Login nur den Atemschutz bedient. Nur für
    // Bearbeiter, und nicht auf der abgegebenen Tafel selbst.
    shareLink: 'Überwachung abgeben',
    // …gefaltet im engen Kopf (Handy): das eine Wort unter dem QR-Zeichen
    shareLinkShort: 'Abgeben',
    // …und wenn schon ein Link läuft. Der Knopf sagt nur, DASS es einen gibt – wer ihn drückt,
    // sieht im Blatt alles Weitere.
    shareLinkOn: 'Überwachung abgeben – ein Link ist aktiv',
    // Shown ONCE per device on the handed-over «Tafel pur» (AtemschutzView, field feedback
    // 02.09.: ein versehentliches Schliessen im Browser brauchte danach wieder den Zugang).
    // Reassurance, not an instruction. ⚠️ Es geht um den LINK, nie um dieses Gerät: der Link
    // meldet niemanden an, und genau diesen Eindruck darf der Satz nicht erwecken (02.09.).
    linkReentryHint: 'Der Link führt zurück auf diese Tafel – wird die Seite versehentlich geschlossen, einfach den QR-Code nochmals öffnen.',
    /** the «+ Trupp» tab on the handed-over phone board (AtemschutzView · focusMode) */
    /* ── Der Stapel: das Trupp-Formular auf dem Telefon (TruppForm · stack, 04.09.) ───────────
     * Löst den zweischrittigen Wizard ab (02.–04.09.). DREI Abschnitte, die immer alle sichtbar
     * sind; genau einer ist offen, die geschlossenen lesen ihre Antwort im Klartext vor. Damit
     * ist weder etwas hinter einem Schritt versteckt noch unter einer Falz – und «Trupp anmelden»
     * steht vom ersten Moment an im Fuss, statt hinter einem «Weiter», das nichts fragt.
     * ⚠️ Die Titel sind die der FELDER, nicht Fragen: eine zugeklappte Zeile trägt ihre Antwort
     * daneben, und «Was machen sie? · Retten – 2. OG» liest sich als Dialog, nicht als Formular.
     * ⚠️ «Auftrag & Leitung» ist EIN Abschnitt (04.09.): die Leitung ist Teil dessen, was der
     * Trupp tut, und ein eigener vierter Abschnitt für eine Zahl kostete eine Zeile, die man auf
     * dem Telefon der Mannschaftsliste wegnimmt. */
    /** die zugeklappte Mannschaftszeile, solange niemand gewählt ist – der einzige Abschnitt,
     *  den keine Vorgabe beantworten kann */
    /** «Meier Thomas (GF) · Huber Simon» – der Gruppenführer trägt sein Kürzel mit */
    stackPressure: '{n} bar',
    // Sync-/Uhr-Status im Tafelkopf (Sicherheitsreview 01.09.): die EINE Fläche, an der ein
    // Leben hängt, sagt selbst, ob ihr Stand gesichert und ihre Uhr richtig ist. Leise reicht
    // incidentSwitcher.savedAt; laut trägt der Chip das Kurzlabel des Zustands plus, wie alt
    // der letzte gesicherte Stand ist. Kurz (25.09.2026): der Kopf ist auf dem Telefon EINE Zeile,
    // «– Stand» schnitt dort den Chip ab; der ganze Satz steht im title/aria-label.
    syncStand: '{status} · {t}',
    // Geräteuhr-Chip (>3 Min. Abweichung, CLOCK_SKEW_WARN_MIN): jede Kontaktuhr auf der Tafel
    // ist Date.now() dieses Geräts. {d} trägt das Vorzeichen (+ = Gerät geht vor); die
    // Langfassung (Tooltip) ist incidentSwitcher.clockSkewToast – gleiche Formulierung wie die
    // Erfassungs-App (capture.clockSkew).
    clockSkewChip: 'Geräteuhr weicht ab ({d} Min.)',
    // create / edit / re-deploy form (one shared form, section labels + per-mode titles)
    formCreateTitle: 'Trupp anmelden',
    formEditTitle: 'Trupp bearbeiten',
    // «in den Einsatz», nie «einrücken» (09.09.) – siehe die Notiz bei entryAskTitle
    formRedeployTitle: 'Wieder in den Einsatz',
    sectionTeam: 'Trupp',
    // «Auftrag» über den sechs Kacheln (27.09.2026, slim sweep 6) – nicht mehr «Art»: das Wort stand
    // direkt unter «Art des Trupps», und die Karte sagt schon «Auftrag» (editFieldLabels)
    auftragLabel: 'Auftrag',
    // DISPLAY labels for the Auftrag types, keyed by the auftrag `id`. ONE flat map over BOTH
    // lists (appConfig.atemschutz.auftrag = unter Atemschutz, .auftragEinfach = ohne) — which is
    // why `sichern` and `anderes` read the same on both kinds of card: they ARE the same id.
    // de = current German labels; en/fr/it translate. The stored auftrag value is always the id —
    // only the label localizes; falls back to the config label when a key is missing.
    auftragLabels: {
      retten: 'Retten',
      loeschen: 'Löschen',
      absuchen: 'Absuchen',
      sichern: 'Sichern',
      erkunden: 'Erkunden',
      verkehr: 'Verkehr',
      sanitaet: 'Sanität',
      wasser: 'Wasserversorgung',
      bereitstellung: 'Bereitstellung',
      anderes: 'Anderes',
    } as Record<string, string>,
    // DISPLAY labels for the shipped Ausrüstung ids (config · atemschutz.equipment), same
    // arrangement as auftragLabels: the stored value is the id, a station's own list (doctrine ·
    // equipment) carries its labels itself and falls back to the config label when a key is missing
    // (lib/report · truppEquipmentLabels).
    equipmentLabels: {
      retthaube: 'Retthaube',
      wbk: 'WBK',
      multiwarn: 'Multiwarn',
    } as Record<string, string>,
    // Das Feld im Trupp-Formular (nur unter Atemschutz) – Mehrfach-Chips aus atemschutzEquipment()
    equipmentLabel: 'Ausrüstung',
    // KURZ-Tags für die Kennzeile der Karte, pro geliefertem Id; eine Station-eigene Id ohne
    // Eintrag hier zeigt ihr volles Label (components/TruppCard)
    equipmentShort: {
      retthaube: 'RH',
      wbk: 'WBK',
      multiwarn: 'MW',
    } as Record<string, string>,
    // «Ziel» (27.09.2026, slim sweep 6): der Auftrag ist die Kachelzeile darüber, das Feld ist das
    // Ziel – wie auf der Karte und im Auftrag-Sheet (editFieldLabels.ziel)
    zielLabel: 'Ziel',
    // EIN Platzhalter für jede Art – bis 03.09. stand hier «z. B. 2OG links» und nur bei Art
    // «Anderes» der allgemeine Satz. Ein Stockwerk ist Atemschutz-Vokabular: unter Art «Verkehr»
    // oder «Sanität» schlug das Beispiel einen Ort vor, den es dort gar nicht gibt. «Wo / was …»
    // stimmt für beide Arten von Trupp und für jeden Eintrag beider Auftragslisten – und fragt
    // nicht mehr, den Auftrag zu beschreiben, der gerade gewählt wurde.
    zielPlaceholder: 'Wo / was …',
    zielClear: 'Ziel leeren',
    // Order of the cards on the board. Überfällige Trupps ALWAYS sit at the top – that is not a
    // setting, it is the reason this board exists.
    orderLabel: 'Reihenfolge',
    orderUrgency: 'Dringlichkeit',
    orderManual: 'Wie gesetzt',
    orderAuftrag: 'Auftrag',
    orderName: 'Name',
    moveBack: 'Nach oben holen',
    moveForward: 'Nach unten stellen',
    leaderLabel: 'Gruppenführer',
    // (`guestNamePlaceholder` / `teamAdd` / `typeName` sind mit dem zweiten Feld weg, zu dem sie
    //  gehörten – siehe `teamGuestAdd` unten. Seit 11.09. gilt das auch für PersonField: dort
    //  trägt die Suchzeile den Namen ein und `combo.useTyped` beschriftet die Übernahme.)
    // Trupp selection (TruppTeam) — a list to tap instead of three fixed fields. The three
    // fields could name a Trupp but not rearrange it: whoever was typed first was Gruppenführer
    // forever. The star is the correction, and it costs one tap.
    teamSearchPlaceholder: 'Person suchen …',
    /* ── Die Chip-Zeile (nur Telefon, 05.09.) ───────────────────────────────────────────────
     * Auf 375px kosteten drei aufklappende Slot-Zeilen plus eine dauernd sichtbare
     * Mannschaftsliste die halbe Form. Der Trupp ist dort EINE umbrechende Chip-Zeile, und die
     * Liste erscheint erst beim Tippen. Auf Tablet/Desktop bleibt alles, wie es war. Eine leere
     * Chip-Zeile zeigt nichts (09.09.) – die Suche direkt darunter ist bereits die Antwort. */
    teamSearchMore: 'Weitere Person suchen …',
    // Das EINE, was unter der Chip-Zeile noch steht (09.09., Feldtest: die alte Zeile war
    // «blabla») – dass ein Tipp auf den Namen ihn zum Gruppenführer macht. Erst ab zwei Personen
    // gezeigt (TruppTeam): bei 0 oder 1 sagt «wer führt» nichts.
    // «Name antippen», nicht «Chip antippen» – Feldtest 08.09.: «Chip» ist UI-Jargon,
    // der Name ist das, was die Person auf dem Bildschirm tatsächlich sieht.
    teamHintChips: 'Name antippen = Gruppenführer',
    // a placed marker whose name was never typed – it still has to be findable, and «Trupp»
    // is what it is. Only ever shown in a list, never written onto the record.
    truppFallbackName: 'Trupp',
    leaderBadge: 'GF',
    makeLeader: '{name} als Gruppenführer',
    teamRemove: '{name} aus dem Trupp nehmen',
    // somebody who is already in another active Trupp: visible, but not selectable – one person,
    // one Trupp. Hiding them meant the search simply found nothing.
    teamTaken: 'in einem Trupp',
    // Typed by hand, i.e. with no link to the roster – a Gast, a Nachbarwehr, an AdF whose
    // roster row never synced. The SAME word the Anwesenheit uses for the same person
    // (anwesenheit.guestBadge): one thing, one name for it, on both screens.
    teamManual: 'Gast',
    // Die Gast-Tür, seit 04.09. die LETZTE Zeile der Mannschaftsliste statt eines eigenen
    // «Name eingeben»-Links darunter: das Suchfeld ist auch die Namenseingabe, und diese Zeile
    // erscheint nur, solange etwas getippt ist. Sie trägt den getippten Namen selbst, damit die
    // Zeile sagt, was der Tipp tut, statt ein zweites Feld zu öffnen, das es nochmals sagt.
    // ⚠️ Nur noch «Gast» (04.09., Feldtest – die Zeile lief über): der getippte Name steht mit
    // drin, und bei einem langen Namen blieb vom Satz «"lkjlkjlkjlkj" als Gast / Nachbarwe…»
    // übrig – abgeschnitten war ausgerechnet das Wort, das sagt, was der Tipp tut. «Gast» ist
    // dasselbe Wort, das die Anwesenheit für dieselbe Person führt (anwesenheit.guestBadge ·
    // teamManual oben), und eine Nachbarwehr wird hier genauso erfasst; das musste die Zeile nie
    // aufzählen. (Die Zeile kürzt sauber mit Ellipse – ComboMenu.module.css · .name –, aber eine
    // Beschriftung, die auf die Ellipse baut, ist keine.)
    // ⚠️ «hinzufügen», nicht «erstellen»: die Person kommt zu einem Trupp dazu, der schon da ist.
    teamGuestAdd: '«{name}» als Gast hinzufügen',
    // Leitung: the same number as on the drawn Leitung (Karte/Plan) — that is how Trupp and
    // Schlauchleitung find each other, without anybody typing anything twice.
    // «Leitung» über den Chips «keine · Ltg 1 · …» (27.09.2026; vorher «Leitung Nr.» über einem
    // Stepper mit «Gezeichnet:»-Zeile) – dieselben Chips wie im Auftrag-Sheet (lineNone / lineChip)
    lineNoLabel: 'Leitung',
    lineLegacyNote: 'Früher erfasst: «{value}»',
    // der letzte Chip: eine Nummer, die noch nicht gezeichnet ist, tippt man im alten Stepper ein
    lineTyped: 'Nr. …',
    lineTakeTitle: 'Leitung {n} ist vergeben',
    lineTakeMsg: 'Auf Leitung {n} ist Trupp {from}. Neu Trupp {to} darauf?',
    lineTakeConfirm: 'Übernehmen',
    // ein Trupp pro Leitung (15.09.): die Leitung ist belegt, der Link wird verweigert
    lineHeldToast: 'Leitung ist von Trupp {name} belegt.',

    lineOptTaken: 'Trupp {name} ist auf dieser Leitung',
    lineShow: 'Leitung auf der Karte zeigen',
    logLineLinked: 'Trupp {name} auf Leitung {n}',
    logLineUnlinked: 'Trupp {name}: Leitung gelöst',
    // Die Leiste am ausgewählten Truppmarker auf der Karte («Ein Etikett», 15.09.): sie nennt
    // BEIDE Seiten, bevor sie sie trennt – welche Leitung, welcher Trupp –, weil der Knopf
    // daneben «Lösen» heisst und sonst offen liesse, was gelöst wird.
    // Quittung des Lösens auf der Karte – die Handlung selbst steht als Zeile im Verlauf
    // (logLineUnlinked), der Toast trägt nur das «Rückgängig».
    lineUnlinkedToast: 'Leitung gelöst',
    // Gesetzter Trupp ⇄ Atemschutz-Trupp – dieselbe Regel wie bei der Leitung: die beiden finden
    // in beliebiger Reihenfolge zueinander, und einer steht für genau einen Trupp. Das Symbol
    // bleibt beim Lösen stehen; es gehört dann einfach zu niemandem mehr.
    markerLabel: 'Atemschutz-Trupp',
    markerNone: 'Kein Trupp',
    markerPick: 'Gesetzten Trupp übernehmen',
    markerOptTaken: 'Gehört zu Trupp {name}',
    markerTakeTitle: 'Trupp {from} steht hier',
    markerTakeMsg: 'Der gesetzte Trupp gehört zu Trupp {from}. Neu Trupp {to}?',
    markerTakeConfirm: 'Übernehmen',
    logMarkerUnlinked: 'Trupp {name} ist nicht mehr gesetzt',
    // Ein gesetzter Trupp sagt «hier steht die Mannschaft» – die Tafel sagt beim angemeldeten
    // Trupp «noch niemand drin». Beim Platzieren wird deshalb gefragt, statt die Kontaktuhr
    // ungefragt zu starten: ein Sicherungstrupp wird genau deshalb ans Fahrzeug gesetzt.
    // «Im Einsatz», nie «einrücken» (09.09.): im Feuerwehr-Sprachgebrauch heisst einrücken
    // ZURÜCK ins Magazin – der Knopf sagte für die Hälfte der Leser das Gegenteil. Die Aktion
    // trägt jetzt den Namen des Zustands, den sie herstellt (status.aktiv).
    entryAskTitle: 'Trupp in den Einsatz?',
    entryAskMsg: 'Trupp {name} ist angemeldet, aber noch nicht im Einsatz. Jetzt in den Einsatz? Die Kontaktuhr läuft ab sofort.',
    entryAskCancel: 'Noch nicht',
    pressureLabel: 'Eingangsdruck',
    newPressureLabel: 'Neuer Eingangsdruck',
    // ⚠️ «Trupp bearbeiten» shows the Eingangsdruck too. It used to be the one field the form
    // hid, so a mistyped 200 for 300 at der Anmeldung could only be corrected by deleting the
    // Trupp — and the Eingangsdruck is what every Verbrauchsrechnung and the tiefster Druck on
    // the Rapport are measured against. Correcting it does NOT touch the contact clock: this is
    // a correction of what was written down, not a new Druckmeldung (that is the card's ± ).
    editPressureLabel: 'Eingangsdruck korrigieren',
    editPressureHint: 'Korrigiert den erfassten Eingangsdruck – zählt nicht als Funkkontakt.',
    funkkanalSection: 'Funkkanal',
    funkkanalDown: 'Funkkanal runter',
    funkkanalUp: 'Funkkanal hoch',
    funkkanalUnit: 'Kanal',
    clearName: 'Name leeren',
    notPresent: 'nicht anwesend',
    noRoster: 'Kein Personal verfügbar',
    officersOnly: 'nur Offiziere',
    assignedConflict: '{name} ist bereits in einem anderen Trupp.',
    /**
     * …und der eine Griff, der das auflöst (11.09.): die Person aus dem anderen Trupp nehmen und
     * hier weitermachen. Vorher war die Warnung eine Sackgasse – sie nannte das Hindernis, und
     * beseitigen liess es sich nur, indem man dieses Formular verwarf, den anderen Trupp suchte,
     * ihn bearbeitete und von vorne begann.
     *
     * ⚠️ «verschieben», nicht «entfernen»: die Person verlässt den einen Trupp NICHT, sie wechselt
     * in diesen. Was im anderen Trupp passiert, ist die Folge – und steht als eine Verlaufszeile
     * dort (`logMovedOut`), nicht als Abgang und Zugang in zweien.
     */
    assignedTransfer: 'In diesen Trupp verschieben',
    /**
     * …und wann es diesen Griff NICHT gibt (11.09.): der andere Trupp ist im Einsatz.
     *
     * Seine Kontaktuhr läuft, sein Eintritt ist gestempelt, und die Atemschutzüberwachung wacht
     * über genau diese Mannschaft. Sie hier still umzuschreiben hiesse, eine laufende Überwachung
     * auf eine Mannschaft zu stellen, die so nie eingerückt ist. Der Satz sagt deshalb, warum
     * kein Knopf danebensteht – die Korrektur gehört in die «Bearbeiten» jenes Trupps, wo sie
     * bewusst geschieht und protokolliert wird (lib/atemschutz · truppTransferState).
     */
    assignedConflictDeployed: '{name} ist in einem Trupp, der im Einsatz ist.',
    // when the slot is linked but nameless — used to be a German literal in the code
    assignedFallbackName: 'Diese Person',
    // «Speichern» blocked (TruppForm · attemptSubmit, field feedback 02.09.): a
    // short toast alongside the flash on the field itself, so a blocked tap explains itself
    // instead of just sitting there. One per reason, in the same order canSubmit checks them.
    saveBlockedTeam: 'Zuerst einen Gruppenführer eintragen.',
    // Der Auftrag blockiert das Anmelden NICHT (14.09., Feldentscheid – hebt die Pflicht vom
    // 04.09. wieder auf): ein Trupp wird bereitgestellt und bekommt seinen Auftrag oft erst
    // später über «Bearbeiten»; die Karte führt die Lücke als «Auftrag offen». Nur «Anderes»
    // braucht sein Wort, weil die Kachel allein nichts sagt.
    auftragMissingHint: 'Auftrag fehlt – der Trupp wird mit «Auftrag offen» angemeldet.',
    saveBlockedAuftrag: '«Anderes» braucht ein Ziel.',
    saveBlockedPressure: 'Eingangsdruck fehlt.',
    cancel: 'Abbrechen',
    save: 'Speichern',
    // der Fuss des Formulars: ein Verb – der Titel «Trupp anmelden» steht darüber (27.09.2026);
    // der Knopf auf der leeren Tafel sagt weiter newTrupp
    start: 'Anmelden',
    reenterSubmit: 'Im Einsatz',
    // Second path when re-entering: new cylinder, new Auftrag, but not under PA yet – the Trupp
    // waits as a Sicherungstrupp and is started later with «Im Einsatz».
    reenterStandby: 'Bereitstellen',
    reenterStandbyHint: 'Trupp als Reserve anmelden – die Kontaktuhr startet erst mit «Im Einsatz».',
    // ⚠️ Im TRUPP-FORMULAR wird die Farbe nicht mehr gewählt (04.09.) – auf keinem Gerät, auch
    // nicht auf dem Tablet: sie war die einzige Angabe, die dort nie jemand gesetzt hat, und auf
    // dem Telefon kostete sie einen ganzen Abschnitt. Ein Trupp, der vorher mit gewählter Farbe
    // angelegt wurde, behält sie (TruppForm reicht `color` nur noch durch).
    // Die Truppfarbe wird nirgends mehr gewählt (15.09.): automatisch (Auftragsfarbe der Wehr,
    // sonst die nächste freie). «Automatisch» bleibt als Wort der Auftragsfarben-Tabelle.
    colorAuto: 'Automatisch',
    // board card
    sinceContact: 'Seit letztem Kontakt',
    elapsed: 'Einsatzzeit',
    // Break clock: how long the Trupp has been out. The Einsatzzeit stands still from «Raus» on
    // (it is finished), this one runs instead – that is the number the Überwacher needs for the
    // recovery time before the next Einsatz. It labels the closed ROW's clock (AtemschutzView ·
    // collapsedClock) and it belongs to Atemschutz alone: a work squad has no recovery rule, so
    // its out row says nothing here. The open card's band does NOT use it (22.09.): the word
    // «Draussen» already heads that band, and the sub-line said it twice.
    outFor: 'Draussen seit',
    // ⚠️ APP ONLY, same split as `actExitPlain` below – der ausgehändigte Link behält «Draussen
    // seit» für jeden Trupp, AS oder nicht.
    outForPlain: 'Ohne Auftrag seit',
    estimated: 'Geschätzter Druck',
    /* ⚠️ Dieselbe Zahl, kurz – für die eine Zeile, die vom Sockel stehen bleibt (09.09.). Dort
     * steht sie neben «Druck 240 bar», und «Geschätzter Druck» daneben liest sich als zweiter
     * Druck statt als Schätzung desselben. Das «≈» vor dem Wert sagt den Rest, der volle Wortlaut
     * samt Herkunft steht im aufgeklappten Verlauf. NICHT als Ersatz für `estimated` verwenden:
     * wo Platz ist, gilt das ganze Wort. */
    estimatedShort: 'Schätzung',
    estimatedHint: 'Planungshilfe – bis genügend Druckverlauf vorliegt, geschätzt mit {liters} L Flasche und {rate} L/min Verbrauch. Ersetzt keine Druckmeldung.',
    estimatedHintHistory: 'Planungshilfe – aus dem bestätigten Druckverbrauch dieses Trupps hochgerechnet. Ersetzt keine Druckmeldung.',
    estimatedSourceHistory: 'aus {count} Druckwerten · Stand {time}',
    estimatedSourceFallback: '{rate} L/min angenommen · Stand {time}',
    currentPressure: 'Druck',
    lowestPressure: 'Tiefster',
    // Alarmdruck on the Trupp card. The «Schätzung» variant applies when only the projection has
    // reached the threshold – an estimate must never sound like a reported Druckmeldung.
    alarmNote: 'Alarmdruck {bar} bar erreicht',
    alarmNoteEst: 'Alarmdruck {bar} bar (Schätzung)',
    lineField: 'Leitung',
    edit: 'Bearbeiten',
    // per-Trupp contact/pressure log (expandable on the card)
    verlauf: 'Verlauf',
    // the ⋯ on the card: Bearbeiten · Platzieren · Leitung · Sortierung · Entfernen, as words
    cardMenu: 'Weitere Aktionen',
    // ⚠️ Die Unterzeile eines Trupps, der NIE im Einsatz war (truppNeverDeployed): keine laufende
    // Uhr, sondern die Uhrzeit der Anmeldung. Bis 04.09. stand über ihm «Draussen seit» und eine
    // tickende, fette Uhr – ein Sicherungstrupp, der nie unter Atemschutz war, las sich damit wie
    // einer in der Erholungspause, und die Uhr drängte auf etwas, was niemand tun muss.
    bandRegisteredAt: 'angemeldet um',
    // the folded timing rows, now the head of the Verlauf
    lastContactAt: 'Letzter Kontakt',
    nextContactDue: 'Nächster fällig',
    contactIntervalLabel: 'Kontakt-Intervall',
    contactIntervalValue: '{min} min',
    // ⚠️ «Alarmdruck» and «Rückzug» are the two rows the printed Atemschutz-Journal is read for.
    // Both used to be indistinguishable on it — the Alarmdruck as one «Druck» among a column of
    // them, the Rückzug as a plain «Kontakt».
    readingKind: {
      // ⚠️ «Eintritt», nicht «Eingerückt» (04.09., Feldtest Manuel). Diese Liste ist das
      // Protokoll des Trupps, und das Protokoll spricht Eintritt/Austritt – die Karte stand mit
      // «Eingerückt» zwischen «Angemeldet» und «Austritt» und als einzige Zeile quer dazu. Auf
      // dem gedruckten Blatt steht dasselbe Wort (report.truppEntry); die Taste heisst seit
      // 09.09. «Im Einsatz» (siehe die Notiz bei entryAskTitle).
      registered: 'Angemeldet', entry: 'Eintritt', contact: 'Kontakt', pressure: 'Druck',
      // ⚠️ «Austritt», nicht «Draussen» (04.09., Rapport-Review). Diese Spalte heisst «Art» und
      // benennt das EREIGNIS – der Trupp ist ausgetreten. «Draussen» ist der Zustand danach, und
      // der steht auf der Karte («Draussen», «Draussen seit»). Auf dem gedruckten Blatt las die
      // Zeile deshalb quer zu ihren Nachbarn: «Angemeldet / Eintritt / Draussen».
      // ⚠️ «Rückzug abgebrochen», nicht «Wiedereinstieg» (04.09., Feldtest Manuel). Niemand ist
      // wieder eingestiegen: der Trupp war nie draussen, sondern auf dem Rückweg, und der Rückzug
      // wurde abgeblasen. «Wiedereinstieg» behauptete einen Vorgang, den es nicht gab – auf dem
      // Blatt direkt neben der Zeile, die den Rückzug selbst festhält.
      alarm: 'Alarmdruck', rueckzug: 'Rückzug', exit: 'Austritt', resume: 'Rückzug abgebrochen',
      // Die beiden Enden der überwachten Strecke, wenn die Art nachträglich geändert wurde
      // (types · TruppReading). «Unter Atemschutz» trägt den Eingangsdruck der Flasche, die
      // in diesem Moment aufgedreht wurde – der Eintritt des Trupps bleibt, wo er war.
      paOn: 'Unter Atemschutz', paOff: 'Atemschutz beendet',
      // die beiden Enden eines Atemschutznotfalls (F1, 08.10.2026) – im Protokoll des Trupps
      notfall: 'Notfall ausgelöst', notfallEnde: 'Notfall beendet',
      // a `crew` row prints its names (AtemschutzView · readingLabel); this is the fallback word
      crew: 'Mannschaft',
    } as Record<string, string>,
    /**
     * Die Eintritts-Ablesung eines Trupps OHNE Atemschutz, auf der Karte selbst – «Eingerückt –
     * ohne Atemschutz» (04.09., Feldtest Manuel). Dieselbe Frage wie im Verlauf (siehe
     * `logEntryNoAs`), nur an der anderen Stelle, an der sie gelesen wird.
     *
     * ⚠️ Nach der HEUTIGEN Art des Trupps beschriftet, nicht nach dem Zustand von damals: wurde
     * die Art mitten im Einsatz geändert, stehen die `paOn`/`paOff`-Zeilen ohnehin genau dort im
     * Protokoll und sagen es genauer, als eine nachträglich umgedeutete Eintrittszeile es könnte.
     */
    readingNoAs: '{what} – ohne Atemschutz',
    // contact-clock state words (carry the state as TEXT, not colour alone — colourblind-safe)
    clockOk: 'Kontakt ok',
    // R3: ein abgeschlossener Einsatz alarmiert nicht – die Uhr steht beim Abschluss
    clockFrozen: 'Stand beim Abschluss',
    clockWarn: 'Kontakt fällig',
    clockOverdue: 'Überfällig',
    // the phone row's short tier word (truppCardText · tierMark, B5): no glyph since 30.10.2026
    // (the amber carries it), so this is the row's aria-label only
    rowDue: 'Fällig',
    // …and the same block on a PRESSURE alarm: same three lines, but the number is the bar the
    // Trupp dropped to, not a clock. The word must never read «Überfällig» there – the Verlauf
    // and the Rapport record two different events, and a radio check does not fix this one.
    clockAlarmPressure: 'Alarmdruck',
    clockAlarmLimit: 'Grenze {bar} bar',
    // header alarm badge (n = number of Trupps at tier 2) — a BUTTON: it jumps to the most
    // urgent one, the way the TopBar chip jumps to this board. ⚠️ «Alarm», not «überfällig»:
    // since 10.08. the Alarmdruck counts too, and the badge must not name only half of what it
    // counts. The key name stays `overdueBadge` – it is read from four locales and a rename buys
    // nothing; en/fr/it were re-worded with it («in alarm» / «en alarme» / «in allarme»). A
    // function, not a template, since German inflects the count: «1 Alarm» vs. «N Alarme».
    overdueBadge: (n: number) => (n === 1 ? '1 Alarm' : `${n} Alarme`),
    overdueBadgeGo: 'Zu Trupp {name} – dringendster Alarm',
    // cross-surface TopBar chip (shown on any surface while a Trupp is fällig/überfällig)
    chipHint: 'Atemschutz – antippen zur Überwachung',
    // ⚠️ Die Zeile in der Meldeleiste, die den Alarmton benennt – und dieselben Worte in der
    // OS-Benachrichtigung. Bis 23.08. hörte man auf jeder anderen Seite einen Ton und sah dazu
    // einen Chip und einen Punkt; WOFÜR er schlug, stand nirgends. Zwei Gründe, zwei Wortlaute:
    // ein überfälliger Trupp wird angefunkt, ein Trupp am Alarmdruck wird zurückgezogen – ein
    // Funkspruch behebt den zweiten Fall nicht.
    alarmRowOverdue: 'Atemschutz überfällig – {name}',
    alarmRowOverdueSub: 'Kein Funkkontakt – sofort Kontakt herstellen.',
    alarmRowPressure: 'Alarmdruck erreicht – {name}',
    alarmRowPressureSub: '{bar} bar, Grenze {line} bar – Rückzug anordnen.',
    // Mehrere Trupps aus demselben Grund teilen sich EINE Zeile (15.09.): die Gruppenführer, der
    // dringendste zuerst; «Zum Trupp» landet auf ihm.
    alarmRowOverdueMany: 'Atemschutz überfällig – {count} Trupps: {names}',
    alarmRowPressureMany: 'Alarmdruck erreicht – {count} Trupps: {names}',
    alarmRowPressureManySub: 'Rückzug anordnen.',
    // Die einzige Taste der Zeile. Keine ✕: ein überfälliger Trupp lässt sich nicht wegwischen.
    alarmRowGo: 'Zum Trupp',
    // …ausser für ein Gerät, das den Trupp gar nicht beenden KANN (Viewer, Führungsansicht): dort
    // stünde die Zeile sonst für immer. «Zur Kenntnis genommen» beendet sie nur auf diesem Gerät.
    alarmRowAck: 'Zur Kenntnis genommen',
    alarmRowReadOnly: 'nur lesend',
    // back from an opened card to the compact row it was opened from (only shown in that mode —
    // «Übersicht» rather than «Einklappen», because what you go back to is the comparison)
    collapse: 'Zur Übersicht',
    // lifecycle action buttons — «Im Einsatz» statt «Einrücken» (09.09.): der Knopf trägt den
    // Namen des Zustands, den er herstellt; einrücken heisst im Feuerwehrdeutsch das Gegenteil
    actEnter: 'Im Einsatz',
    actContact: 'Kontakt',
    actRueckzug: 'Rückzug melden',
    actContinue: 'Fortsetzen',
    actExit: 'Raus melden',
    /* ⚠️ Die KACHELN der Handy-Karte (26.09.2026, phone card slim-down): nur das Verb, ohne
     * «melden» – die aufgeklappte Karte sagt «Rückzug · Raus» neben «Kontakt» und dem Druck, und
     * vier Kacheln nebeneinander tragen keine zwei Wörter. Die Langformen (`actRueckzug`,
     * `actExit`) bleiben der Tablet-Karte, dem Bestätigungsdialog («Raus melden» als sichere
     * Antwort) und dem Screenreader-Namen der Kachel. */
    tileRueckzug: 'Rückzug',
    tileExit: 'Raus',
    /* ── Die Mini-Sheets der Handy-Karte (26.09.2026, phone card slim-down; components/TruppSheets) ──
     * Ein Chip auf der Karte öffnet EIN kurzes Sheet für genau diese Angabe. Titel sind die
     * bestehenden Feldnamen (`editFieldLabels`, `funkkanalUnit`); hier nur, was es dort noch nicht gab. */
    // die zweite Titelzeile: «Hirter Stephan · Trupp 2» – wessen Sheet über der abgedunkelten Tafel steht
    quickTrupp: 'Trupp {no}',
    // das Kanal-Pad hat kein Speichern – der eine Satz sagt, dass ein Tipp wählt und schliesst
    kanalSheetHint: 'Antippen wählt und schliesst.',
    // die Zahlen-Sheets aus dem Trupp-Formular übernehmen nur ins Formular (30.09.2026) – «Speichern» wäre gelogen
    formPickTake: 'Übernehmen',
    // die Leitung-Chips: «keine · Ltg 1 · Ltg 2 …»
    lineNone: 'keine',
    lineChip: 'Ltg {n}',
    // der gestrichelte Chip auf der Handy-Karte, wo der Auftrag fehlt (die Tablet-Kennzeile behält
    // «Auftrag offen»); das «+» gehört zum Wort – ein Chip, der etwas hinzufügt
    auftragAdd: '+ Auftrag',
    // ⚠️ APP ONLY (09.09., Feldtest) – ein Trupp ohne Atemschutz meldet einen erledigten Auftrag,
    // keinen Funkkontakt. Die ausgehändigte Link-Tafel bleibt bei «Raus melden», für JEDEN
    // Trupp: das ist der eine Bildschirm, den eine externe Person bekommt, und er darf nicht
    // plötzlich anders sprechen (TruppCard · plainWords).
    actExitPlain: 'Auftrag erledigt',
    actReenter: 'Wieder in den Einsatz',
    // A Sicherungstrupp mostly does NOT go in. Until 08.08. you could only delete it – i.e. throw
    // away the one thing proving it stood ready. It is now closed out like any other: under
    // «Draussen», with a break clock, ready to re-enter at any time.
    actNotDeployed: 'Nicht eingesetzt',
    // status word and Verlauf row for exactly this case: «draussen» claims it had been inside
    statusNotDeployed: 'Nicht eingesetzt',
    statusRemoved: 'Von Tafel entfernt',
    logNotDeployed: 'Trupp {name} nicht eingesetzt',
    remove: 'Entfernen',
    // removal happens immediately, no dialog and no toast — the way back is the global ↶
    // pair and the «Entfernte Trupps» menu (09.09.). ONE exception (11.09., field wish): a
    // Trupp that never went in gets asked whether it should be stood down as «nicht
    // eingesetzt» instead — that is the honest record for a Sicherungstrupp that stood
    // ready, while Entfernen is for the erroneous Anmeldung.
    removeUnusedTitle: 'Trupp war nicht im Einsatz',
    removeUnusedMsg: '{name} als «nicht eingesetzt» abmelden statt entfernen? Der Trupp bleibt auf der Tafel bereit – «Entfernen» ist für irrtümliche Anmeldungen.',
    place: 'Platzieren',
    placeWhere: 'Wohin platzieren?',
    placeNoTarget: 'Kein Plan vorhanden – zuerst über «Gebäude» in der Leiste ein Gebäude wählen.',
    showOnPlan: 'Auf Plan zeigen',
    showOnMap: 'Auf der Karte zeigen',
    // der Marker ist an ein Symbol angedockt (lib/docking): wo der Trupp steht, auf der Kennzeile
    dockedAt: 'bei «{host}»',
    // …und dieselbe Bindung vom SYMBOL aus gelesen (ContextPanel, 15.09.): die Zeile am
    // angedockten Symbol nennt beide Seiten, bevor «Lösen» sie trennt – dieselbe Grammatik wie
    // joinLabel an der Leitung. {who} ist der Trupp («Trupp 4», truppTerm über die Nummer) oder,
    // an einem Marker ohne Trupp, dessen eigener Name.
    dockLabel: '{who} · bei «{host}»',
    // Überschrift der Gruppe am Symbol – wortgleich mit contextPanel.dockedTo («Angedockt an …»)
    dockedTeams: 'Angedockt',
    preEntryHint: 'Noch nicht im Einsatz – «Im Einsatz» drücken, sobald der Trupp unter Atemschutz vorgeht.',
    // Die Glocke: ein Knopf, drei ehrliche Zustände (siehe useAtemschutzMute). Jeder sagt, was
    // GERADE gilt, und nennt seine Reichweite – die Beschriftung war früher die Handlung
    // («Alarmton ausschalten», also ist er an), ein Versprechen, das der Knopf nicht halten
    // konnte: ohne freigegebenen Ton meldete er «an» über einem stummen AudioContext.
    alarmArmed: 'Alarm an – Ton und Benachrichtigung. Antippen schaltet stumm.',
    alarmMuted: 'Alarm stumm – Ton und Benachrichtigung, bis zum Ende dieses Einsatzes. Antippen schaltet ein.',
    alarmBlocked: 'Ton nicht freigegeben – der Browser hat die Freigabe verweigert. Antippen, sonst meldet nur die Benachrichtigung.',
    // …und wo selbst DIE Benachrichtigung nicht existiert (notificationsSupported() false – ein
    // gewöhnlicher Safari-Tab auf iOS kennt keine Web Notifications): das obige Versprechen wäre
    // hier eine falsche Beruhigung, also sagt der Knopf ehrlich, dass antippen die einzige
    // Reichweite ist, die es überhaupt geben kann.
    alarmBlockedNoFallback: 'Ton nicht freigegeben – antippen aktiviert ihn. Dieser Browser kann keine Benachrichtigung anzeigen.',
    // Appended to the bell's label on the public DEMO only (isDemoMode, AtemschutzView ·
    // bellLabel): the demo deliberately mutes tone + notification (useAtemschutzAlarm's `demo`
    // gate), so a tester pressing «Kontakt» and hearing nothing has no way to tell «broken» from
    // «deliberately quiet» without this line (field question, 02.09.: «Wie sollte dieser Alarm
    // erfolgen?»).
    alarmDemoNote: 'Demo – Ton und Benachrichtigung sind auf dieser Instanz deaktiviert.',
    restoreMenu: 'Entfernte Trupps',
    // the bell's WORD on a wide head (22.09.2026; the honest state stays in the tooltip/aria)
    alarmWord: 'Alarmton',
    alarmMutedWord: 'Stumm',
    alarmBlockedWord: 'Ton freigeben',
    restoreItem: '{name} wiederherstellen',
    // OS notification when a Trupp goes überfällig while the app is backgrounded
    alarmNotifyTitle: 'Atemschutz überfällig',
    alarmNotifyBody: 'Trupp {name} überfällig – Kontakt herstellen.',
    // status labels
    status: { angemeldet: 'Angemeldet', aktiv: 'Im Einsatz', rueckzug: 'Rückzug', ueberfaellig: 'Überfällig', raus: 'Draussen' } as Record<string, string>,
    // ⚠️ APP ONLY, same split as `actExitPlain` – überschreibt nur das «Draussen» aus
    // `truppStatusLabel` für einen Trupp ohne Atemschutz; «Nicht eingesetzt» / «Von Tafel
    // entfernt» bleiben unverändert, die gelten für jeden Trupp gleich.
    statusPlainOut: 'Ohne Auftrag',
    /**
     * Wie ein Trupp im Fliesstext heisst – «Trupp Meier Anna».
     *
     * Ein Trupp trägt keine Nummer: sein Name IST der Name des Gruppenführers (types · Trupp.name).
     * Genau deshalb braucht der Verlauf diese Form. Als blosser Personenname wäre der Trupp vom
     * Menschen nicht zu unterscheiden – und die Person steht ohnehin schon im Wortschatz. Mit dem
     * Wort davor ist er ein eigener Begriff: er wird im Journal und auf dem Rapport als Trupp
     * markiert, und wer «Trupp» tippt, bekommt alle Trupps dieses Einsatzes vorgeschlagen
     * (lib/journalLinks · journalVocabulary).
     *
     * ⚠️ Wortgleich mit den Logzeilen unten («Trupp {name}: Austritt»), damit die App ihre eigenen
     * Zeilen wiedererkennt. Wird das hier geändert, ohne die Zeilen mitzuändern, markiert der
     * Verlauf seine eigenen Einträge nicht mehr.
     */
    truppTerm: 'Trupp {name}',
    // Verlauf templates ({name}, {bar}, {status})
    //
    // ⚠️ ZWEI Fassungen, und die Wahl trifft der Druck, nicht die Länge der Zeile (04.09.,
    // Feldtest): «– Eingangsdruck 0 bar» stand unter jedem Trupp OHNE Atemschutz, der gar keine
    // Flasche hat, und unter jedem, dessen Druck beim Anmelden noch nicht erfasst war. Eine
    // Messung, die niemand gemacht hat, in einem Rechtsdokument. 0 bar ist nie ein echter
    // Eingangsdruck – dieselbe Regel gilt für den erneuten Eintritt weiter unten.
    logRegister: 'Trupp {name} angemeldet – Eingangsdruck {bar} bar',
    logRegisterPlain: 'Trupp {name} angemeldet',
    // Zwei Geräte haben im selben Moment dieselbe Nummer vergeben; die Zusammenführung lässt sie
    // einem und gibt den anderen die nächste freie (lib/truppNumbers). EINE Zeile pro Wechsel –
    // die früheren Zeilen bleiben unter der alten Nummer stehen, diese verbindet die beiden.
    logRenumbered: 'Trupp {name} heisst jetzt Trupp {no}',
    // …und ein loser Trupp-Marker, mit den Namen, die er auf dem Bild trug
    logRenumberedChip: '{from} heisst jetzt {to}',
    logSafetyFunkkanal: 'Funkkanal {from} → {to}',
    logPlaced: 'Trupp {name} auf Plan platziert',
    logPlacedMap: 'Trupp {name} auf der Karte platziert',
    placeLage: 'Karte',
    // ⚠️ «Eintritt», nicht «eingerückt» (04.09., Rapport-Review). Im Feuerwehrdeutsch heisst
    // einrücken zuerst einmal: zurück ins Magazin. Die Zeile sagte also im Verlauf das Gegenteil
    // dessen, was passiert war – und die Atemschutzübersicht daneben schrieb für denselben
    // Moment längst «Eintritt». Ein Wort für eine Sache, und zwar das, das auf Papier stimmt.
    // Seit 09.09. sagen auch die Knöpfe nicht mehr «Einrücken», sondern «Im Einsatz» / «Raus
    // melden» (siehe die Notiz bei entryAskTitle) – die Verlaufszeile bleibt beim Papierwort.
    logEntry: 'Trupp {name}: Eintritt',
    /**
     * …und dieselbe Zeile für einen Trupp OHNE Atemschutz (04.09., Feldtest Manuel).
     *
     * Auf seinem Rapport stand «Atemschutz beendet» um 16:15 und gleich darunter ein blosses
     * «Eingerückt» – wer das liest, kann nicht sagen, ob die Mannschaft mit oder ohne Maske
     * hineingegangen ist, und genau das ist die Frage, die man an eine Eintrittszeile stellt.
     *
     * ⚠️ Nur die EINTRITTS-Zeilen (Eintritt, erneuter Eintritt) tragen den Zusatz. Auf jeder
     * Kontakt- und Druckmeldung wäre er Tapete, und der Atemschutz-Eintritt bleibt unverändert:
     * er ist der Normalfall, und sein Eingangsdruck sagt es ohnehin.
     */
    logEntryNoAs: 'Trupp {name}: Eintritt – ohne Atemschutz',
    /** …und der Sicherungstrupp, der hineingeht (24.09.2026, D1 ⑦): er wird nur geschickt, wenn
     *  drinnen etwas schiefgeht – die Zeile, nach der eine Rekonstruktion zuerst sucht. Abgeleitet
     *  vom Trupp (Auftrag «Sichern», erster Eintritt), nicht vom Knopf (useTruppActions ·
     *  setTruppStatus). */
    logSafetyEntry: 'Trupp {name}: Sicherungstrupp eingesetzt',
    logContact: 'Trupp {name}: Kontakt bestätigt',
    logPressure: 'Trupp {name}: Druck {bar} bar',
    // Rückzug and Fortsetzen reset the contact clock; that has to be in the Verlauf, otherwise
    // the clock jumps in the record for no visible reason.
    // ⚠️ Die Zeile SAGT, was passiert, statt einen Kontakt zu behaupten (04.09., Feldtest
    // Manuel). «Gilt als Funkkontakt» las sich wie ein bestätigter Funkspruch, den niemand
    // quittiert hat; gemeldet hat der Trupp seinen Rückzug, und die Folge davon ist, dass die
    // Kontaktuhr neu läuft. Am Verhalten ändert sich nichts – nur daran, was dazu im Protokoll
    // steht (useTruppActions · setTruppStatus · impliesContact).
    logRueckzug: 'Trupp {name} meldet Rückzug – Kontaktuhr zurückgesetzt',
    /**
     * ⚠️ EINE Zeile, die zuerst sagt, was aus dem Rückzug wurde (04.09., Feldtest Manuel).
     * Vorher standen «Rückzug» und «Einsatz fortgesetzt» direkt untereinander – gelesen wie ein
     * Widerspruch, weil nichts die beiden verband. Jetzt nimmt die zweite Zeile die erste
     * ausdrücklich zurück und sagt im selben Satz, was stattdessen gilt.
     * ⚠️ «gilt als Funkkontakt» fällt hier weg: mehr als zwei Halbsätze liest an der Tafel
     * niemand. Dass der Kontakt zählt, steht in der Rückzugszeile darüber und – mit Uhrzeit – in
     * der Ablesung selbst (readingKind.resume, dieselben Worte).
     */
    logContinue: 'Trupp {name}: Rückzug abgebrochen – Einsatz fortgesetzt',
    // The normal case: the row SAYS what changed. «Auftrag angepasst» used to appear even when
    // an AdF had been taken out of the Trupp – and that is exactly what somebody asks about
    // afterwards.
    logEditFields: 'Trupp {name}: {changes}',
    changeLeader: 'Gruppenführer {from} → {to}',
    changeMemberOut: '{names} aus dem Trupp genommen',
    changeMemberIn: '{names} dazugekommen',
    /**
     * …und WER JETZT DRIN IST (04.09., Feldtest Manuel).
     *
     * Die Zeile zählte bisher nur die Differenz auf. Wer sie sechs Monate später liest, muss die
     * Mannschaft daraus im Kopf zusammenrechnen – aus einer Anmeldezeile weiter oben und zwei
     * Halbsätzen hier. Die Antwort steht jetzt daneben, im selben Satz.
     *
     * ⚠️ Die Namen mit « / », wie überall sonst, wo diese App eine Mannschaft schreibt
     * (lib/atemschutz · truppLogName): die Zeile ist bereits eine Komma-Liste von Änderungen, und
     * eine zweite Komma-Liste darin liest sich als deren Fortsetzung.
     * ⚠️ Nur wenn sich die Zusammensetzung geändert hat – ein reiner Wechsel des Gruppenführers
     * ist dieselbe Mannschaft und braucht sie nicht.
     */
    changeCrewNow: 'Neu: {crew}',
    /**
     * Die Mannschaftsänderungen auf der Atemschutz-Seite des Rapports (12.09., docs/trupp-naming.md
     * §5): datierte Zeilen im Einsatz-Zyklus, in dem sie geschahen, gelesen aus den `crew`-Zeilen
     * des Protokolls (lib/report · truppCrewHistory). {to}/{from} ist der andere Trupp – seine
     * Nummer, oder sein Gruppenführer, wo er noch keine trägt.
     */
    crewChange: {
      leader: 'Gruppenführer {from} → {to}',
      movedTo: '{name} → Trupp {to}',
      movedFrom: '{name} von Trupp {from}',
      left: '{name} aus dem Trupp genommen',
      joined: '{name} dazugekommen',
    },
    /**
     * Der Wechsel, als EINE Zeile beim abgebenden Trupp (11.09.) – ausgelöst vom Knopf in der
     * Warnung «bereits in einem anderen Trupp» (`assignedTransfer`).
     *
     * ⚠️ Eine Zeile, nicht zwei. Als Abgang hier und Zugang dort gelesen, sähe der Verlauf nach
     * zwei Ereignissen aus, zwischen denen jemand nirgends war – und die Zeile im aufnehmenden
     * Trupp steht ohnehin: seine Anmeldung bzw. seine Bearbeitungszeile nennt die neue Mannschaft
     * vollständig. Was hier fehlte, ist WOHIN, und genau das sagt diese.
     * ⚠️ {name} ist der abgebende Trupp, {person} die Person, {to} der aufnehmende Trupp.
     */
    logMovedOut: 'Trupp {name}: {person} in Trupp {to} gewechselt',
    /** …und wenn der aufnehmende Trupp noch keinen Namen trägt (er wird gerade erst angemeldet,
     *  oder die Person IST sein Gruppenführer): dann ist «Trupp {to}» entweder leer oder wörtlich
     *  derselbe Name, der im selben Satz schon steht. Beides ist keine Auskunft – die Anmeldung
     *  direkt darunter nennt den neuen Trupp. */
    logMovedOutPlain: 'Trupp {name}: {person} in einen anderen Trupp gewechselt',
    /**
     * Eine Person in ZWEI Trupps im Einsatz (Audit F05, 25.10.2026): zwei Geräte haben sie offline
     * je in einen anderen Trupp eingeteilt, der Abgleich behält beide. Auf EINEM Gerät verhindert
     * das Formular den Fall (`assignedConflict`). Das Band über DRIN nennt Person und Trupps, beide
     * Uhren laufen weiter, und erst die Wahl nach dem Funkspruch nimmt die Person aus dem anderen
     * Trupp – eine Verlaufszeile, rückgängig machbar (useTruppActions · keepInOneTrupp).
     */
    doubleTitle: '{person} in {n} Trupps',
    doubleText: 'Beide Kontaktuhren laufen. Per Funk klären, in welchem Trupp {person} ist:',
    doubleKeep: 'Bleibt in Trupp {trupp}',
    logDoubleResolved: 'Trupp {name}: {person} ausgetragen – war doppelt eingeteilt, ist in Trupp {to}',
    // ⚠️ Says WHAT the Auftrag now is, not that a field was touched. «Auftrag angepasst» was the
    // one line on this row that named nothing: read back an hour later it could mean a new order,
    // a corrected floor or a typo fixed in the Ziel, and the Verlauf is read precisely to find out
    // which. The words are the ones the card carries.
    changeAuftragTo: 'Auftrag {auftrag}',
    changeAuftragCleared: 'Auftrag entfernt',
    changeLine: 'Leitung {n}',
    changeLineCleared: 'Leitung gelöst',
    /**
     * ⚠️ VON → NACH, wie beim Eingangsdruck (04.09., Feldtest Manuel: «Trupp Antoine DJ:
     * Funkkanal 12» – gesetzt? geändert? bloss bestätigt?). Dieselbe Sprache, die die
     * Sicherheitswerte längst sprechen (`logSafetyFunkkanal`), also eine Stimme für eine Sache.
     * Beim ERSTEN Kanal gibt es kein Vorher, das man nennen könnte: dann sagt die Zeile, dass er
     * gesetzt wurde – ein «– → 12» wäre ein Strich, den niemand lesen muss.
     */
    changeFunkkanal: 'Funkkanal {from} → {to}',
    changeFunkkanalSet: 'Funkkanal {n} gesetzt',
    changeFunkkanalCleared: 'Funkkanal entfernt',
    changeColor: 'Farbe geändert',
    // Die Ausrüstung, als Liste der Kurzlabels – oder «keine», wenn alles abgewählt wurde: eine
    // Zeile «Ausrüstung:» ohne Wort dahinter liest sich wie ein abgebrochener Satz
    // (useTruppActions · setTruppEquipment).
    changeEquipment: 'Ausrüstung: {list}',
    changeEquipmentNone: 'Ausrüstung: keine',
    // A corrected Eingangsdruck names BOTH numbers: the record has to show what it used to say,
    // because everything derived from it (Verbrauch, tiefster Druck) was computed from the old one.
    changePressure: 'Eingangsdruck {from} → {to} bar',
    /**
     * …ausser die Flasche wurde GERADE ERST aufgedreht (04.09., Feldtest Manuel).
     *
     * Beim Hochstufen auf «Unter Atemschutz» stand vorher 0 bar – ein Wert, den niemand gemessen
     * hat –, und «Eingangsdruck 0 → 300 bar» las sich wie ein Anstieg im Zylinder. Es gibt kein
     * Vorher: die Flasche ist neu, und die Zeile sagt das. Gleiche Bauweise wie beim ersten
     * Funkkanal (`changeFunkkanalSet`).
     * ⚠️ In die andere Richtung steht hier GAR NICHTS: «Eingangsdruck 300 → 0 bar» beim
     * Zurückstufen las sich wie ein gemessener Absturz auf null. Dass die Überwachung endet,
     * sagt bereits «nicht mehr unter Atemschutz» in derselben Zeile – und alles Gemessene bleibt
     * im Druckprotokoll stehen (useTruppActions · editTrupp · kindPatch).
     */
    changePressureSet: 'Eingangsdruck {n} bar',
    // Die einzige Änderung im Formular, die eine Überwachung ein- oder ausschaltet – deshalb
    // steht sie in der Verlaufszeile immer zuerst (useTruppActions · truppEditChanges).
    changeKindPa: 'jetzt unter Atemschutz',
    changeKindPlain: 'nicht mehr unter Atemschutz',
    // Rückfrage, bevor einem Trupp im Einsatz die Überwachung genommen wird. Sie zählt auf,
    // was aufhört – nicht, was passiert: was aufhört, ist das, was niemand merkt.
    kindOffTitle: '{name}: Atemschutz-Überwachung beenden?',
    kindOffMsg: 'Der Trupp ist im Einsatz. Ohne Atemschutz laufen Kontaktuhr und Druck nicht '
      + 'weiter, und es gibt keinen Alarm mehr für ihn. Alles bisher Erfasste bleibt im Verlauf '
      + 'und im Rapport.',
    kindOffConfirm: 'Überwachung beenden',
    logExit: 'Trupp {name}: Austritt',
    /* ── Handy-Tafel und Druckwahl (24.09.2026, Übung 23.09. – siehe TruppSheets · PressureSheet; Kopf seit 29.09.2026 = die Frage + «Name · Trupp N») ── */
    logExitBar: 'Trupp {name}: Austritt – Restdruck {bar} bar',
    actPressure: 'Druck',
    pressureSheetTitle: 'Druck',
    pressureSheetHint: 'Tippen speichert – zählt als Kontakt.',
    exitSheetTitle: 'Restdruck',
    exitSheetHint: 'Tippen meldet raus – tiefster Wert der Mannschaft.',
    exitNoBar: 'Ohne Druck raus',
    phoneSectionIn: 'Drin',
    phoneSectionReady: 'Bereit',
    phoneSectionOut: 'Draussen',
    safetyTitle: 'Sicherungstrupp',
    // «Bestimmen» am Abschnittskopf SICHERUNGSTRUPP (26.09.2026, phone card slim-down) – der
    // gestrichelte Kasten «Kein Sicherungstrupp · Ein Trupp ist drin» ist weg; der Kopf steht wie
    // DRIN/DRAUSSEN, und der leere Abschnitt IST die Aussage
    safetyPick: 'Bestimmen',
    /* ── Handy-Tafel, zweite Runde (24.09.2026, D1 ⑥ ⑦ ⑧a, Punkt 2) ─────────────────────────── */
    // «Bestimmen» mit bereiten Trupps: einen davon nehmen oder einen neuen anmelden
    safetyPickTitle: 'Sicherungstrupp bestimmen',
    safetyPickNew: 'Neuen Trupp anmelden (Sichern)',
    // die fälligen Trupps über dem Anmelde-Sheet (Bereichsname für Screenreader)
    pinnedLabel: 'Fällige Trupps',
    // Kontakt, den ein ANDERES Gerät vor weniger als 60 s schon bestätigt hat (lib/contactEcho)
    // Titel = die Tatsache, eine Zeile = wer und wann, die Verben auf den Knöpfen (Review 26.09.2026)
    contactEchoTitle: 'Kontakt schon bestätigt',
    contactEchoWho: 'Trupp {n}',
    contactEchoMsg: '{name} · vor {s} s auf einem anderen Gerät',
    contactEchoAgain: 'Nochmals bestätigen',
    contactEchoOk: 'OK',
    /* ── Staging-Durchgang 25.09.2026 ── */
    // Bearbeiten als Patch: ein Feld, das inzwischen ein anderes Gerät geändert hat
    editConflictOne: '{field} wurde inzwischen auf einem anderen Gerät geändert: {now} – trotzdem überschreiben?',
    editConflictMany: '{fields} wurden inzwischen auf einem anderen Gerät geändert – trotzdem überschreiben?',
    editConflictOverwrite: 'Überschreiben',
    editConflictBack: 'Zurück zum Formular',
    editFieldLabels: { crew: 'Mannschaft', auftrag: 'Auftrag', ziel: 'Ziel', lineNo: 'Leitung', funkkanal: 'Funkkanal', pressure: 'Eingangsdruck', kind: 'Art des Trupps', equipment: 'Ausrüstung' },
    // die erste Druckmeldung nach dem Eintritt: ersetzt einen Eingangsdruck, den niemand gesetzt hat, und ist ein Kontakt
    logFirstPressure: 'Trupp {name}: Kontakt – erste Druckmeldung {bar} bar ersetzt den Eingangsdruck {from} bar',
    logFirstPressureSame: 'Trupp {name}: Kontakt – erste Druckmeldung {bar} bar (wie Eingangsdruck)',
    pressureSheetFirst: 'Erste Druckmeldung – ersetzt den Eingangsdruck {bar} bar, zählt als Kontakt',
    // der Knopf im Kopf der Tafel trägt auch am Handy sein Wort
    newTruppShort: 'Trupp',
    /* ── Staging-Durchgang 2, 25.09.2026 ── */
    // jede Entfernung sagt es – mit Rückgängig (bestätigen-mit-Rückgängig, docs/undo.md)
    removedToast: 'Trupp {name} entfernt',
    // «Nicht eingesetzt» vom sichtbaren Knopf der Karte – mit Rückgängig (Review 26.09.2026)
    notDeployedToast: 'Trupp {name}: nicht eingesetzt',
    /* ── Atemschutznotfall (F1, 08.10.2026) ──────────────────────────────────────────────────
     * EIN Trupp in Not, von einer Person gesagt (gehaltenes «Notfall»), nicht aus einer Uhr
     * abgeleitet. Wortlaut bewusst kurz und neutral («Notfall», «Sicherungstrupp einsetzen») –
     * er bildet das AS-Notfallvorgehen (FwDV 7 / FKS) ab und wird von AS-Instruktoren geprüft. */
    notfall: {
      // die Kachel auf der Karte – halten löst aus (lib/nodeHold; die Kachel füllt sich, bis es gilt)
      act: 'Notfall',
      actHint: 'Gedrückt halten löst den Notfall aus',
      end: 'Notfall beendet',
      endHint: 'Gedrückt halten beendet den Notfall',
      // ein blosses Tippen: die Kachel sagt es an ihrer eigenen Stelle (kurz, statt ihres Worts)
      holdHint: 'Gedrückt halten',
      // Kopfzeile des Notfall-Banners auf der Tafel und der Zeile in der Meldeleiste
      title: 'Notfall',
      who: 'Trupp {name}',
      since: 'seit {time}',
      stateWord: 'Notfall seit {time}',
      // die Fakten: letzter Ort, letzter Druck mit Alter, Funkkanal
      placeMap: 'Karte',
      placeMapAt: 'Karte · bei {host}',
      bar: '{bar} bar',
      barAge: 'vor {age}',
      barEntry: 'Eingangsdruck',
      // EIN Fakt: der Druck und woher er stammt – «300 bar (Eingangsdruck)», «220 bar (vor 5 min)»
      barWith: '{bar} ({when})',
      kanal: 'Kanal {n}',
      contact: 'Kontakt {time}',
      // die erste angebotene Handlung
      sitrDeploy: 'Sicherungstrupp einsetzen',
      sitrPickTitle: 'Welcher Sicherungstrupp?',
      sitrNone: 'Kein Sicherungstrupp bereit',
      sitrDefine: 'Sicherungstrupp bestimmen',
      // der Atemschutz-Link (Entwurf R1, 30.10.2026): die Seite des Notfall-Trupps nennt beide Uhren,
      // «Anderer» öffnet die Liste aller anderen Trupps; auf einem anderen Reiter ein rotes Band
      pageSince: 'seit Notfall',
      pageContact: 'seit letztem Kontakt',
      sitrOther: 'Anderer',
      sitrOtherLabel: 'Einen anderen Trupp als Sicherungstrupp bestimmen',
      stripOne: 'Notfall · {name}',
      stripMany: '{n} Notfälle',
      sitrInside: 'Sicherungstrupp {name} drin seit {time}',
      goTo: 'Zum Trupp',
      // die ganze Kopfzeile des Banners (Screenreader): «Zum Trupp 1 (Binggeli Michael / …)»
      goToWho: 'Zum {name}',
      // die Meldeleiste
      rowTitle: 'Notfall – Trupp {name}',
      // der Verlauf (und damit das Einsatzjournal im Rapport)
      logTrigger: 'Trupp {name}: Notfall ausgelöst',
      factPlace: 'Ort {place}',
      factContact: 'letzter Kontakt {time}',
      factBar: '{bar} bar ({time})',
      factBarEntry: 'Eingangsdruck {bar} bar',
      factKanal: 'Kanal {n}',
      logEnd: 'Trupp {name}: Notfall beendet – Dauer {dur}',
      // «Raus» beendet einen laufenden Notfall: die Zeile neben dem Austritt
      logEndOut: 'Trupp {name}: Notfall beendet – Dauer {dur} – Trupp draussen',
      logSafetyEntry: 'Trupp {name}: Sicherungstrupp eingesetzt – Notfall Trupp {target}, {dur} nach Auslösung',
      // «Sicherungstrupp bestimmen» im Banner nimmt einen bestehenden Trupp (auch einen drinnen): sein
      // Auftrag wird «Sichern», der bisherige bleibt in dieser Zeile stehen
      logSafetyDesignated: 'Trupp {name}: als Sicherungstrupp bestimmt – Notfall Trupp {target}',
      logSafetyWas: 'bisher {auftrag}',
      logAtClose: 'Trupp {name}: Notfall beim Abschluss nicht beendet',
      // bestätigen-mit-Rückgängig: ein Fehlgriff ist billig zurückzunehmen und bleibt im Verlauf
      toast: 'Notfall Trupp {name} ausgelöst',
      // Benachrichtigung (Ton, OS, Web-Push)
      notifyTitle: 'Atemschutz-Notfall – {name}',
      notifyBody: 'Notfall seit {time} – Sicherungstrupp einsetzen.',
      // der ruhige Hinweis beim Eintritt eines AS-Trupps, wenn niemand sichert
      noSafetyHint: 'Kein Sicherungstrupp bereit',
      // der Abschluss fragt zuerst danach
      abschlussTitle: 'Notfall läuft noch',
      abschlussMsg: '{list} – noch nicht beendet.',
      abschlussClose: 'Trotzdem abschliessen',
      // «Entfernen» on a Trupp in a Notfall is refused until it is ended (review of #300)
      removeBlocked: 'Erst «Notfall beendet» halten – ein Trupp im Notfall bleibt auf der Tafel',
    },
    // «Entfernen» auf einem Trupp, der DRIN ist: zuerst fragen, «Raus melden» ist die sichere Antwort
    removeInsideTitle: 'Trupp {name} ist drin – erst rausmelden?',
    removeInsideMsg: 'Entfernen nimmt den Trupp von der Tafel und aus jedem Alarm. Meist ist gemeint: Der Trupp ist draussen.',
    // der Weg hinein für einen Trupp, der nie drin war («Wieder» wäre falsch)
    actEnterFirst: 'In den Einsatz',
    contactDone: 'Bestätigt',
    // Eingangsdruck eines Trupps, der schon raus ist: gesperrt (Punkt 2)
    pressureLockedLabelPlain: 'Eingangsdruck',
    pressureLocked: 'Trupp ist raus',
    pressureLockedWhyExit: 'Trupp ist raus, Restdruck {bar} bar',
    // …und die EINE Plausibilitätsfrage: ein Eingangsdruck unter dem Stationsminimum
    // (doctrine.entryPressureMin). Die Zahl steht auf dem Knopf.
    entryLowTitle: 'Eingangsdruck tief',
    entryLowMsg: '{bar} bar – üblich ab {min} bar',
    entryLowConfirm: '{bar} bar übernehmen',
    entryLowChange: 'Ändern',
    bottleAsk: 'Vor {min} min raus, zuletzt {bar} bar. Welche Flasche?',
    bottleAskNow: 'Gerade raus, zuletzt {bar} bar. Welche Flasche?',
    bottleSame: 'Gleiche Flasche',
    bottleNew: 'Neue Flasche',
    saveBlockedBottle: 'Gleiche oder neue Flasche wählen',
    logReenter: 'Trupp {name}: erneuter Eintritt – Eingangsdruck {bar} bar',
    /** …ohne Flasche, also ohne die Zahl – siehe die Notiz bei `logRegister`. ⚠️ Das ist NICHT
     *  dasselbe wie «ohne Atemschutz»: hier fehlt bloss die Messung. Ein Trupp, der ohne
     *  Atemschutz zurückgeht, sagt das ausdrücklich (`logReenterNoAs`). */
    logReenterPlain: 'Trupp {name}: erneuter Eintritt',
    /** …und der Trupp, der ohne Atemschutz zurückgeht – siehe `logEntryNoAs`. */
    logReenterNoAs: 'Trupp {name}: erneuter Eintritt – ohne Atemschutz',
    logStandby: 'Trupp {name} bereitgestellt – noch kein Eintritt',
    /* ── Was die Zeile über den Einsatz sagt, den sie ERÖFFNET (09.09., Feldentscheid) ─────────
     * Anmeldung, Bereitstellung und erneuter Eintritt sind die drei Zeilen, die einen Einsatz
     * eröffnen – und sie nannten bisher nur Mannschaft und Eingangsdruck. Wer den Verlauf später
     * liest, soll den Einsatz daraus rekonstruieren können, ohne die Tafel daneben zu haben:
     * Auftrag, Ziel, Leitung, Kanal. Die schlanken Lebenslaufzeilen (Eintritt, Austritt, Rückzug,
     * Kontakt) bleiben schlank – dort wäre derselbe Zusatz auf jeder Zeile Tapete, und was sich
     * ÄNDERT, sagt ohnehin die Bearbeitungszeile (useTruppActions · truppEditChanges).
     * Kurzformen, weil der Zusatz an eine Zeile gehängt wird, die schon steht («Ltg. 1 · Kanal
     * 11»); die Langformen bleiben den Änderungszeilen (changeLine, changeFunkkanalSet). Fehlt
     * ein Feld, steht es nicht da – erfunden wird nichts. */
    logDetailLine: 'Ltg. {n}',
    logDetailFunk: 'Kanal {n}',
    /** ⚠️ Nur dort, wo die Zeile es nicht schon selber sagt (logReenterNoAs, logEntryNoAs) –
     *  sonst stünde «ohne Atemschutz» zweimal in einem Satz. */
    logDetailNoAs: 'ohne Atemschutz',
    logAlarm: 'Atemschutz-Alarm: Trupp {name} – {status}',
    /**
     * …und wann er vorbei war, und wodurch (04.09., Rapport-Review).
     *
     * Der Verlauf hielt bisher nur den Beginn fest. Auf dem gedruckten Rapport stand damit eine
     * Reihe von «Überfällig» ohne ein einziges Ende – und wer das später liest, kann nicht
     * unterscheiden zwischen «der Trupp wurde erreicht», «der Trupp kam heraus» und «der Alarm
     * lief ins Leere». Genau diese Unterscheidung ist der Nachweis, den die
     * Atemschutzüberwachung schuldet.
     *
     * Die Zeile wird NICHT von Hand quittiert: quittiert wird ein Alarm dadurch, dass seine
     * Ursache weg ist. Was sie beendet hat, steht deshalb im Text – aus der letzten Messung des
     * Trupps gelesen, also aus derselben Reihe, die das Druckprotokoll druckt.
     */
    logAlarmCleared: 'Atemschutz-Alarm beendet: Trupp {name} – {reason}',
    alarmClearedBy: {
      exit: 'Austritt',
      contact: 'Funkkontakt',
      pressure: 'Druckmeldung',
      rueckzug: 'Rückzug',
      resume: 'Einsatz fortgesetzt',
    } as Record<string, string>,
    /** Fallback, wenn die letzte Messung nichts hergibt – der Alarm ist trotzdem beendet, und
     *  eine Zeile, die das sagt, ist mehr wert als gar keine. */
    alarmClearedOther: 'Kontakt wiederhergestellt',
    // …und wenn die Kontaktuhr durch «Wieder öffnen» neu lief: kein Funkkontakt, sondern das (D5)
    alarmClearedByReopen: 'Kontaktuhr neu gestartet (wieder geöffnet)',
    // The Alarmdruck used to be visible only on the card – the record was missing the moment the
    // Trupp had to turn back. Only on CROSSING it, not on every value below it.
    //
    // ⚠️ This REPLACES the plain `logPressure` row for that one reading – it does not follow it.
    // Both were written, so the crossing arrived as «Druck 100 bar» and «Alarmdruck 100 bar
    // erreicht» on two lines in the same minute: the same event twice, which on a printed
    // Atemschutz-Journal reads as two Druckmeldungen. `{bar}` is therefore the READING, not the
    // threshold – the number that was measured is the fact, and «Alarmdruck erreicht» already
    // says what it means. The threshold itself is station doctrine and stands on the Rapport.
    logPressureAlarm: 'Trupp {name}: Druck {bar} bar – Alarmdruck erreicht',
    // A Trupp disappearing from the board is the one action that used to leave nothing behind at
    // all – the toast was gone and the Trupp had never existed.
    logRemoved: 'Trupp {name} entfernt',
    logRestored: 'Trupp {name} wiederhergestellt',
    // Der Einsatz wird abgeschlossen, während ein Trupp noch als drin geführt ist (staging r3 F4):
    // eine Zeile pro Trupp, damit der Verlauf sagt, was beim Abschluss offen war – ein Austritt
    // wird NICHT erfunden. Auf dem Rapport endet der Einsatz des Trupps mit dem Zusatz unten.
    logInsideAtClose: 'Trupp {name} beim Abschluss noch drin',
    cycleEndAtClose: '{t} (beim Abschluss noch drin)',
    // Nach «Wieder öffnen»: die Kontaktuhr eines Trupps, der noch drin steht, läuft ab dem
    // Wiederöffnen neu – die geschlossene Zeit zählt nicht als Zeit ohne Kontakt (r3, F4).
    logClockRestart: 'Trupp {name}: Kontaktuhr neu gestartet – Einsatz wieder geöffnet',
  },
  // FKS hose-line device-letter labels (line decoration editor + tooltips)
  lineDecor: {
    W: 'Wasser',
    WW: 'Wasserwerfer',
    S: 'Schaum',
    H: 'Hydroschild',
    P: 'Pulver',
    // FKS Vegetationsbrand S. 52 — welche Art Haltelinie. Dieselbe Stelle wie beim
    // Druckleitungs-Buchstaben, weil es dieselbe Frage ist: was für eine Linie ist das.
    N: 'Nasse Haltelinie',
    T: 'Trockene Haltelinie',
    G: 'Gegenfeuer',
  } satisfies Record<LineContent, string>,
} as const
