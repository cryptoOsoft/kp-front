// German copy · the «Funktionen & Hilfe» overlay.
// One slice of the canonical `de` catalogue, assembled in ../de.ts — read the rules at the
// top of that file before adding or renaming a key here.

// Help overlay content model (authored as data so it bundles offline, no markdown dep).
// Inline markup in `lead`/`sub`/list items: **bold** for emphasis, [[Key]] for keyboard chips.
// `only` (29.09.2026) — a block or section that describes ONE kind of device: 'phone' (the two
// bars at the bottom), 'wide' (the rails left and right), 'keyboard' (shortcuts, mouse: never on
// a phone, nor on a touch-only tablet). Help that describes the tablet on a phone contradicts the
// screen it is read on. Absent = every device. See HelpOverlay · helpDevice.
export type HelpOnly = 'phone' | 'wide' | 'keyboard'
export type HelpBlock =
  | { kind: 'intro' } // the per-station helpIntro (or introFallback)
  | { kind: 'lead'; text: string; only?: HelpOnly }
  | { kind: 'sub'; text: string; only?: HelpOnly }
  | { kind: 'note'; text: string; only?: HelpOnly }
  | { kind: 'list'; items: string[]; only?: HelpOnly }
export interface HelpSection { id: string; title: string; icon: string; blocks: HelpBlock[]; only?: HelpOnly }

export const helpCopy = {
  help: {
    menu: 'Funktionen & Hilfe',
    title: 'Was kann KP Front?',
    contents: 'Inhalt',
    close: 'Schliessen',
    // The help is long and gets opened during an Einsatz with a concrete question, not to be
    // read — the search filters the table of contents AND the sections (on a phone there is no
    // table of contents, so filtering the sections is the whole search there).
    search: 'Hilfe durchsuchen …',
    searchHint: 'Anderes Stichwort versuchen – gesucht wird in Überschriften und Text.',
    // Fallback intro when the station has not configured a helpIntro of its own.
    introFallback: 'KP Front ist die digitale Lage- und Einsatzführung deiner Feuerwehr: taktische Karte, Objektpläne, Atemschutzüberwachung und ein gemeinsames Verlaufsprotokoll – alles live auf mehreren Geräten gleichzeitig.',
    // Content of the help sections. Inline markup: **bold** for emphasis, [[Taste]] for
    // keyboard chips. blocks: lead/sub/list/note are rendered in HelpOverlay.
    sections: [
      {
        id: 'ueberblick', title: 'Überblick', icon: 'info',
        blocks: [
          { kind: 'intro' },
          { kind: 'sub', text: 'Die Arbeitsbereiche (linke Leiste)', only: 'wide' },
          { kind: 'sub', text: 'Die Arbeitsbereiche (Leiste unten)', only: 'phone' },
          { kind: 'list', items: [
            '**Karte** – die taktische Karte mit Symbolen, Linien, Flächen und den Werkleitungs-Ebenen.',
            '**Pläne** – Module und Gebäudeansichten dieser Wehr als taktische Arbeitsflächen, geschossweise.',
            '**Checkliste** – abarbeitbare Einsatz-Checklisten.',
            '**Trupps** – Überwachung der eingesetzten Trupps mit Zeit und Druck, mit und ohne Atemschutz.',
            '**Anwesenheit** – wer im Einsatz ist, mit Zeiten und Bemerkung; auch Gäste («Weitere Person»).',
            '**Material** – was eingesetzt wurde, aus dem Katalog oder frei erfasst.',
            '**Rapport** – der Einsatzrapport: ein vorausgefülltes Formular, das über den ganzen Einsatz hinweg ergänzt und am Schluss gedruckt wird.',
          ] },
          { kind: 'note', text: 'Leitgedanke: bedienbar um 3 Uhr morgens, nach einem halben Jahr ohne Übung. Wiedererkennen statt auswendig lernen, mit Handschuhen und offline nutzbar.' },
        ],
      },
      {
        id: 'navigation', title: 'Navigation & Oberfläche', icon: 'cursor',
        blocks: [
          { kind: 'lead', text: 'Drei feste Zonen: die Bereichsleiste links, die Einsatzleiste oben, die Werkzeugleiste rechts.', only: 'wide' },
          { kind: 'lead', text: 'Zwei Leisten unten, eine oben: ganz unten die Bereichsleiste, darüber die Werkzeugleiste, oben die Einsatzleiste.', only: 'phone' },
          { kind: 'sub', text: 'Untere Leisten', only: 'phone' },
          { kind: 'list', only: 'phone', items: [
            'Die **Bereichsleiste** ganz unten hat fünf Felder: Karte, Pläne, Checkliste, Trupps und Rapport. **Pläne** und **Rapport** stehen für mehrere Seiten (Rapport, Anwesenheit, Material): das Feld nochmals antippen oder gedrückt halten öffnet die Auswahl.',
            'Darüber die **Werkzeugleiste** der Karte bzw. des Plans. **+** ist die eine Tür zu allem, was darauf gesetzt wird.',
            'Ein Knopf, auf dem nur ein Zeichen steht, sagt sein Wort, wenn man ihn **gedrückt hält**. In den **Einstellungen** schreibt «Beschriftung der Werkzeugleisten» die Wörter dauerhaft darunter.',
          ] },
          { kind: 'sub', text: 'Linke Leiste', only: 'wide' },
          { kind: 'list', items: [
            'Mit Tastatur und Maus steht an den Feldern der linken und der rechten Leiste, die ein Tastaturkürzel haben, der Buchstabe dazu (abschaltbar in den **Einstellungen**: «Tastenkürzel anzeigen»). Alle Kürzel stehen unter **Tastaturkürzel**.',
            'Im Kartenbereich sind **Ebenen** und der **Karten**-Umschalter unten angeheftet – immer sichtbar.',
            'Am rechten Rand der Leiste ziehen klappt sie mit Beschriftungen auf bzw. wieder zu.',
          ], only: 'wide' },
          { kind: 'sub', text: 'Obere Einsatzleiste' },
          { kind: 'list', items: [
            'Links der Einsatz-Name mit dem **Menü** (Einsatz abschliessen, Einsatz wechseln, Einstellungen, Offline-Bereitschaft, diese Hilfe …) und der **Einsatzuhr**.',
            'Rechts **Rückgängig/Wiederherstellen**, **Verlauf** und **+ Eintrag**.',
          ], only: 'wide' },
          { kind: 'list', only: 'phone', items: [
            'Links der Einsatz-Name mit dem **Menü** (Einsatz abschliessen, Einsatz wechseln, Einstellungen, Offline-Bereitschaft, diese Hilfe …), rechts **Rückgängig** und der **Verlauf**.',
            'Der runde Knopf unten rechts ist **+ Eintrag**.',
          ] },
          { kind: 'sub', text: 'Meldeleiste' },
          { kind: 'list', items: [
            'Direkt unter der Einsatzleiste liegt **ein** Streifen für alles, was ansteht und liegen bleibt, bis jemand etwas tut: ein überfälliger Atemschutztrupp, ein neuer Alarm, eine fällige Erinnerung, ungeprüfte Alarmangaben, ein bereitstehendes Update. Jede Meldung ist eine Zeile untereinander – keine Karten mehr, die sich gegenseitig verdecken.',
            'Die Reihenfolge ist fest, nicht nach Eingang: zuerst der **Atemschutz**, dann der **Alarm**, dann die **Erinnerung**. Was auf jemanden wartet, steht immer über dem, was von selbst wieder verschwindet.',
            'Es wirken nur die beschrifteten Knöpfe, das **✕** und – wo die Meldung einen Ort hat – ihr **Titel**. Ein Tipp irgendwo sonst auf die Zeile tut nichts: Lesen darf nicht dasselbe sein wie Handeln. Steht nichts an, ist der Streifen gar nicht da.',
          ] },
          { kind: 'sub', text: 'Rechte Werkzeugleiste', only: 'wide' },
          { kind: 'list', items: [
            'Die Zeichen- und Platzierwerkzeuge; unten angeheftet die Karten-Navigation (Zoom, Einpassen, Koordinaten).',
          ], only: 'wide' },
        ],
      },
      {
        id: 'tastatur', title: 'Tastaturkürzel', icon: 'type', only: 'keyboard',
        blocks: [
          { kind: 'lead', text: 'Wer mit Tastatur arbeitet, erreicht alles ohne Maus. Kürzel wirken nicht, während in einem Textfeld getippt wird. Wo ein Feld in der linken Leiste eine Taste hat, steht sie darauf.' },
          { kind: 'sub', text: 'Bereiche wechseln' },
          { kind: 'list', items: [
            'Zahlen öffnen das Plan-Modul mit dieser Nummer – welche es gibt, richtet sich nach den Modulen dieser Wehr: [[1]] Modul 1, [[2]] oder [[3]] das Modul «2/3», [[4]] Modul 4 …',
            '[[K]] Karte · [[C]] Checkliste · [[A]] Trupps (A wie Atemschutz) · [[P]] Anwesenheit · [[M]] Material · [[R]] Rapport – jeweils der erste Buchstabe des Bereichs (Anwesenheit: P wie Personal).',
            '[[⌘]] [[[]] / [[⌘]] [[]]] blättert Schritt für Schritt durch alle Bereiche (auch Umgebung und Gebäude, die keine Nummer haben).',
          ] },
          { kind: 'sub', text: 'Werkzeuge (Karte & Plan gleich)' },
          { kind: 'list', items: [
            '[[V]] Auswahl · [[W]] Mehrfach wählen · [[S]] Symbol · [[L]] Linie · [[F]] Fläche · [[U]] Umkreis · [[N]] Notiz · [[T]] Trupp · [[D]] Messen (nur Karte).',
          ] },
          { kind: 'sub', text: 'Bearbeiten' },
          { kind: 'list', items: [
            '[[⌘]] [[Z]] Rückgängig · [[⌘]] [[⇧]] [[Z]] Wiederherstellen · [[⌘]] [[D]] Duplizieren.',
            '[[Esc]] schliesst der Reihe nach: Werkzeug → offenes Panel → Auswahl. [[⌫]] löscht die Auswahl.',
          ] },
          { kind: 'sub', text: 'Ansicht & Panels' },
          { kind: 'list', items: [
            '[[+]] / [[−]] Zoom · [[0]] Einpassen · [[G]] Mein Standort · [[X]] Koordinaten-Format. «Nach Norden» hat keine Taste – dafür ist der Kompass da, der immer sichtbar ist und mitdreht.',
            '[[J]] Verlauf · [[E]] Eintrag · [[B]] Ebenen · [[⌘]] [[,]] Einstellungen · [[?]] diese Hilfe.',
          ] },
        ],
      },
      {
        id: 'lage', title: 'Karte – die taktische Karte', icon: 'map',
        blocks: [
          { kind: 'lead', text: 'Die taktische Karte über dem realen Kartenhintergrund (Einsatzgebiet und Umgebung).' },
          { kind: 'list', items: [
            '**Grundkarte** (zuoberst im Ebenen-Panel) wechselt den Hintergrund: Carto, OpenStreetMap oder Satellit.',
            '**Vergrössern/Verkleinern**, **Einpassen** und **Koordinaten abgreifen** in der rechten Leiste unten. Beim Abgreifen auf die Karte tippen, um einen Punkt (LV95 + WGS84) festzuhalten; der Kompass richtet wieder nach Norden aus.',
            '**Wind** wird laufend angezeigt (Richtung + Temperatur), damit die Ausbreitungsrichtung sofort ersichtlich ist.',
            '**Fahrzeuge** erscheinen live per GPS (Name + Ausrichtung), die eigene Position als ruhiger blauer Punkt.',
            '**Gebäude-Info** unten links nennt, was das Gebäude am Einsatzort an Gefahren hat (⚠ Gas · PV), und öffnet den Steckbrief: Gefahren, **Sofortmassnahmen** und Bemerkungen zuoberst, darunter die Register-Angaben. Beim ersten Öffnen des Einsatzes auf diesem Gerät geht er von selbst auf, damit er gelesen wird – die Karte bleibt bedienbar. ✕ schliesst ihn; danach öffnet ihn der Chip. Bei einem anderen Einsatzort oder Objekt mit Inhalt erscheint er nochmals.',
          ] },
        ],
      },
      {
        id: 'ebenen', title: 'Ebenen & Daten', icon: 'layers',
        blocks: [
          { kind: 'lead', text: 'Über **Ebenen** blendest du die Werkleitungs- und Gefahren-Daten ein – geordnet nach Typ.' },
          { kind: 'list', items: [
            '**Inhalte** – Taktische Zeichen, Fahrzeuge, Skizzen & Notizen.',
            '**Station** – Unterirdische Bauten (Tiefgaragen, Schutzräume, Tunnel) aus der amtlichen Vermessung, gestrichelt ab Strassenzoom; standardmässig eingeblendet.',
            'Welche Ebenen es gibt, hängt an den Geodaten dieser Wehr – nichts davon ist mitgeliefert. Üblich sind:',
            '**Abwasser** – Schmutz/Misch, Regen/Rein, Schächte / Gully.',
            '**Gas** – Leitungen.',
            '**Strom** – Leitungen, PV-Anlagen.',
            '**Gefahren** – Hochwasser, Überschwemmungstiefe.',
          ] },
          { kind: 'lead', text: 'Jede Ebene lässt sich ein-/ausblenden und in der Deckkraft regeln.' },
          { kind: 'list', items: [
            '**Karte offline laden** (im Ebenen-Bereich) lädt Kartenkacheln, Pläne, Symbole und Geodaten für den Einsatzort vor.',
          ] },
          { kind: 'note', text: 'Die Werkleitungsdaten decken das konfigurierte Einsatzgebiet ab und sind lokal verfügbar – sie funktionieren auch offline.' },
        ],
      },
      {
        id: 'zeichnen', title: 'Zeichnen & Symbole', icon: 'pen',
        blocks: [
          { kind: 'lead', text: 'Werkzeuge der rechten Leiste auf der Karte.' },
          { kind: 'list', items: [
            '**Symbol** – das taktische Zeichen (FKS/VKF). Schnellwahl der häufigsten Zeichen oder Suche in der ganzen Bibliothek. Tippen platziert; mit «Mehrere platzieren» mehrere nacheinander setzen.',
            '**Formen** – im selben Fenster, hinter den Gefahren: **Pfeil** und **Rechteck**, für alles, wofür es kein taktisches Zeichen gibt. Der Griff dreht, die Ecke zieht das Rechteck in die Länge (der Pfeil bleibt proportional, eine verzerrte Spitze liest sich schlecht). Beim Pfeil schaltet **Stopp-Balken** den Querbalken quer zur Spitze ein – die Entwicklungsgrenze: bis hier, und dort gestoppt.',
            '**Auswahl** – Objekte antippen, verschieben, im Editor anpassen.',
            '**Mehrfach** – nochmals auf **Auswahl** tippen, während sie aktiv ist: der Knopf wechselt auf Mehrfach (Zeichen und Wort), und ein gezogener Rahmen wählt mehrere Symbole/Zeichnungen auf einmal aus. Ein weiterer Tipp führt zurück zur Auswahl.',
            '**Linie** – ziehen oder Punkte tippen; der Stil wird danach im Editor gewählt: **Freihand**, **Pfeil** oder **Rettungsachse**. Darunter der **Abschluss** – **Keiner**, **Pfeil**, **Pfeil mit Stopp** (derselbe Querbalken an der Spitze) oder **Teilstück**; **Richtung umkehren** setzt ihn ans andere Ende, ohne die Linie zu verschieben.',
            '**Fläche** – Eckpunkte tippen (ab 3 Punkten mit Flächeninhalt); Eckpunkte ziehen/einfügen/löschen.',
            '**Absperrkreis** – von der Mitte zum Rand ziehen setzt den Radius in Metern (Füllung einstellbar).',
            '**Notiz** – freier Text direkt auf die Karte.',
            '**Messen** – Strecke (Distanz + Höhenprofil) oder Fläche (Inhalt + Umfang). Punkte ziehen verschiebt, Tippen auf die Linie setzt Zwischenpunkte, Rechtsklick entfernt einen Punkt.',
          ] },
          { kind: 'sub', text: 'Symbol-Voreinstellungen' },
          { kind: 'lead', text: 'Jedes Symbol bringt nur die sinnvollen Regler mit: **Drehung** bei gerichteten Zeichen (Pfeile, Leitern, Wände), **Anzahl** wo mehrere zählen, **Geschoss** bzw. ein **Geschoss-Bereich** (z. B. Treppe/Lift), **Ausbreitung** bei Schadenlagen – plus passende Eingabefelder (z. B. Name, Stoff, Status).' },
        ],
      },
      {
        id: 'plan', title: 'Plan – Module & Gebäude', icon: 'doc',
        blocks: [
          { kind: 'lead', text: 'Pro Objekt eine Arbeitsfläche über den Modul- und Gebäudeplänen – geschossweise, mit eigenen Werkzeugen.' },
          { kind: 'list', items: [
            'Unten links, neben dem Massstab, steht die **Adresse** des geladenen Objekts – antippen wählt ein anderes. Das Objekt bestimmt die Pläne in der linken Leiste.',
            '**Symbol**, **Auswahl**, **Zeichnen** (Farbe/Stärke/Linienart), **Notiz** (Text), **Trupp**.',
            '**Geschosse** als Stapel: mit den **OG/UG**-Knöpfen am Plan ein Geschoss darüber/darunter hinzufügen.',
            '**Zoom/Einpassen** unten in der Werkzeugleiste, wie auf der Karte.',
            '**Trupps** als farbige Marker; **Spuren** ein-/ausblenden zeigt ihren Weg. Trupp-Chips, deren Trupp «raus» ist, werden ausgegraut/durchgestrichen.',
            '**Massstab** – die zwei Endpunkte des gedruckten Massstabsbalken antippen und die reale Länge eingeben. Danach zeigen Linien und Flächen echte Meter (Messen als eigenes Werkzeug gibt es nur auf der Karte).',
            'Ein Blatt, das mit der Karte **verknüpft** ist, misst schon von selbst – ebenso der Geschoss-Stapel des Gebäudes, der seine Grösse aus dem Grundriss kennt. Dort steht statt der Kalibrierung **Ref. auto**; ein Tipp darauf öffnet die Passung bzw. sagt, woher der Massstab kommt. Von Hand kalibriert wird nur, was nicht verknüpft ist.',
            '**Schnelle Handnotiz?** Der Plan ist die Skizzenfläche: frei zeichnen, durchstreichen, kritzeln. Die Karte bleibt strukturiert (Symbole, Linien, Notizen), damit Rapport und Verlauf sauber bleiben.',
          ] },
          { kind: 'sub', text: 'Karte verknüpfen (Georeferenz)' },
          { kind: 'list', items: [
            'Der Knopf **Karte verknüpfen** unten am Plan legt dieses Blatt auf die Karte: der Plan gibt die halbe Fläche frei, daneben liegt die Karte. Am Telefon reicht der Platz für beides nicht – dort schaltet die Leiste unten zwischen **Karte** und dem Plan, man schiebt die Stelle unter das Fadenkreuz und tippt **+**; die Lupe unten links zeigt, worauf es steht, und der Status **0/2** öffnet die Schritte. Dieselbe Stelle auf beiden Flächen setzen – Hausecke, Hydrant, Wegkreuzung. **Die Reihenfolge ist egal**: gesetzte Hälften suchen sich ihr Gegenstück selber, und man darf beliebig zwischen den Flächen wechseln. Zwei Punkte genügen fürs Auflegen.',
            'Die **Ampel** in der Leiste sagt die ganze Zeit, woran man ist: zwei Punkte lösen exakt und sind damit **ungeprüft** – erst der dritte misst die Abweichung («4 Punkte · ⌀ 1.2 m»). **Deckung prüfen** legt den Blattumriss zur Sichtprüfung auf die Karte.',
            'Ein gesetztes Kreuz **ziehen** verschiebt es, **antippen** öffnet **Verschieben**, **Punkt löschen** oder **Behalten**. Ein Tipp auf **Verknüpft** öffnet die **Passung** mit Paaren und Abweichung; **Übertragen** kopiert die Referenzpunkte auf ein anderes Modul desselben Objekts, **Zurücksetzen** löscht sie (mit Rückfrage). **Schliessen** verwirft nichts – Gesetztes ist längst gespeichert.',
            'Ab da zeigen **beide Flächen dieselben Objekte** – keine Kopie, dasselbe Objekt: antippen zeigt die Angaben, ziehen verschiebt, Eckpunkte und Griffe sind auf beiden Seiten dieselben.',
            'Wo ein Objekt **steht**, entscheidet die zuletzt setzende Hand: auf ein Blatt gezogen, steht es auf dem Blatt – und wird mitverschoben, wenn die Passung korrigiert wird. Auf die Karte gezogen, steht es am Boden. Eine korrigierte Passung verortet alles, was auf dem Blatt steht, neu – eine Zeile im Verlauf, ein ↶ nimmt sie zurück. **Blattform gemessen** ist dieselbe Neuverortung ohne Handgriff: die App hat das geöffnete Blatt vermessen und die Passung in der richtigen Form neu gelöst. Beim **Zurücksetzen** der Referenz geht nichts verloren: Blatt und Karte behalten beide, was sie zeigen.',
            'In den **Ebenen** bekommt jedes verknüpfte Blatt eine eigene Zeile («Plan (Modul 2)»): das Blatt selbst als Bild unter der Karte. Die Objekte darauf brauchen keine eigene Zeile mehr – sie gehören zu der Ebene, auf der sie gesetzt wurden.',
          ] },
          { kind: 'note', text: '**Gebäude** ist EINE Kachel in der linken Leiste: solange keines gewählt ist (Umriss-Symbol), zeigt sie die Gebäudeumrisse live von OpenStreetMap – Gebäude antippen, übernehmen, und aus der Kachel wird der Geschoss-Stapel. Hat der Einsatz einen Ort, ist das Gebäude dort schon markiert – prüfen und übernehmen genügt. Unten links führt «Anderes Gebäude wählen» zurück zur Auswahl. **Modul 6** (Geschosspläne) ist standardmässig ein reiner Blätter-/Zoom-Betrachter – annotiert wird auf dem Geschoss-Stapel des Gebäudes, nicht auf dem Modul-6-PDF. Ob ein Modul Betrachter ist, steht in der Modul-Konfiguration dieser Wehr.' },
          { kind: 'note', text: '**Wie herum steht das Gebäude?** Ein Tipp auf den **Nordpfeil** oben rechts auf dem Geschoss-Stapel öffnet das kleine Fenster «Gebäude drehen»: ein Regler **Drehung** mit Vorschau, dazu **Norden oben** und **Auf Längsachse drehen** als je ein Tipp. Der Umriss dreht sich mit, die Markierungen bleiben, wo sie am Gebäude liegen – und die gedruckten Geschossseiten zeigen den eingestellten Winkel.' },
        ],
      },
      {
        id: 'atemschutz', title: 'Trupps & Atemschutz\u00ADüberwachung', icon: 'stopwatch',
        blocks: [
          { kind: 'lead', text: 'Lückenlose Überwachung jedes Atemschutztrupps nach FKS – das Sicherheitssignal ist die **Zeit seit dem letzten Funkkontakt**, nicht eine geschätzte Restzeit.' },
          { kind: 'sub', text: 'Trupp anmelden' },
          { kind: 'list', items: [
            '**Wer geht rein**: drei Slots, der oberste ist der **GF** – die ganze Zeile antippen macht jemanden zum Gruppenführer, das **✕** entfernt ihn. Ein grösserer Trupp hängt einfach weitere Zeilen an.',
            'Über die **Personensuche** wird das ganze Personal gefunden, nicht nur die Anwesenden; neben jedem Namen steht, was dagegen spricht (nicht anwesend, Magazin, schon in einem Trupp). **(+)** erfasst einen Gast (Nachbarwehr) – der landet zugleich in der Anwesenheit und gilt dort als derselbe Mensch.',
            '**Eingangsdruck** (bar) und **Funkkanal** stehen rechts daneben.',
            'Darunter der **Auftrag**: Art (unter Atemschutz Retten, Löschen, Absuchen, Sichern, Erkunden, Anderes; ohne Atemschutz Verkehr, Sanität, Wasserversorgung, Sichern, Bereitstellung, Anderes), **Ziel / Ort** in Klartext, **Leitung Nr.** (die bereits gezeichneten Leitungen stehen als Schnellwahl daneben) und die **Farbe** auf Karte und Plan.',
            'Der Auftrag hält niemanden auf: **Trupp anmelden** geht auch ohne ihn. Die Karte trägt dann **«Auftrag offen»**, und ein Tipp darauf öffnet das Formular.',
            'Getippte Angaben bleiben erhalten, wenn das Fenster mit **✕** oder per Klick daneben geschlossen wird – nur **Abbrechen** verwirft sie.',
          ] },
          { kind: 'sub', text: 'Überwachung pro Trupp' },
          { kind: 'list', items: [
            'Gross die Uhr **Seit letztem Kontakt**: grün **Kontakt ok** → nach {contactMin} min gelb **Kontakt fällig** → nach weiteren {graceSec} s rot **Überfällig** mit Alarm. Beide Werte gelten für diese Wehr und stehen in den Einsatz-Einstellungen ([[⌘]] [[,]]).',
            '**Kontakt** (grosser Knopf) bestätigt den Funkkontakt und stellt die Uhr zurück.',
            '**Druck** direkt mit ± einstellen und mit **Bestätigen** übernehmen – das zählt als Kontakt und wird protokolliert; ein Fehlklick ohne Bestätigen ändert nichts. Niedriger Druck wird rot.',
            'Status **Angemeldet → Im Einsatz → Rückzug → Draussen**. **Rückzug melden** lässt sich mit **Fortsetzen** widerrufen; ein draussener Trupp geht mit **Wieder in den Einsatz** (neue Flasche) zurück in die Überwachung – der **Druckverlauf der ersten Ausrückung bleibt dabei erhalten** und steht später vollständig auf dem Rapport.',
            'Draussene Trupps behalten ihren Platz auf der Tafel (grau und gedämpft) statt in einen eigenen Abschnitt zu wandern – die Karte, die du suchst, steht dort, wo sie vorher stand.',
            'Ein **entfernter Trupp** verschwindet nur von der Tafel: auf dem Rapport steht er weiter, mit allem, was gemessen wurde, und als **«Von Tafel entfernt»**. Über **Entfernte Trupps** in der Kopfzeile kommt er zurück – der «Rückgängig»-Hinweis ist die schnelle Tür, nicht die einzige.',
            '**Verlauf** je Trupp (ausklappbar) zeigt jeden Kontakt mit Uhrzeit und Druck.',
            '**Bearbeiten** (Stift) passt Auftrag / Ziel oder Trupp mitten im Einsatz an.',
            'Wer unter AS ist, lässt sich in der **Anwesenheit** nicht abmelden – ein Tipp auf die Zeile springt stattdessen auf die Karte dieses Trupps und hebt sie kurz hervor.',
            'Überfällige Trupps rücken nach oben, oben erscheint ein Zähler. Die **Glocke** schaltet den Alarm pro Gerät stumm – Ton **und** Benachrichtigung, und nur bis zum Ende dieses Einsatzes. Zeigt sie rot, hat der Browser den Ton nicht freigegeben: antippen. Die Tafel selbst wird nie stumm. Alles landet im Verlauf.',
            'Jeder Trupp lässt sich auf dem Plan platzieren (Knopf «auf Plan zeigen»).',
          ] },
        ],
      },
      // ⚠️ Anwesenheit und Mittel fehlten hier bis 18.08. — die zwei Flächen, an denen ein AdF als
      // erstes landet, standen in einer Hilfe mit sechzehn Abschnitten nur nebenbei. Der Tipp-Zyklus
      // der Anwesenheit ist nirgends sonst erklärt.
      {
        id: 'anwesenheit', title: 'Anwesenheit', icon: 'people',
        blocks: [
          { kind: 'lead', text: 'Wer im Einsatz ist, von wann bis wann – die Grundlage für Personalblatt und Stunden. Die Mannschaft kommt aus der Verwaltung; hier wird nur festgehalten, wer heute da ist.' },
          { kind: 'sub', text: 'Erfassen' },
          { kind: 'list', items: [
            'Eine Zeile **antippen** schaltet weiter: **frei → anwesend → gegangen → frei**. «Anwesend» beginnt beim ersten Mal ab der **Alarmzeit** (getippt wird meist später als angekommen), bei einer Rückkehr ab jetzt.',
            'Jede Zeile hat eine **Bemerkung** («Fahrer TLF», «verletzt, abgelöst 21:40»). Sie beschreibt, was diese Person hier getan hat, und steht auf dem Personalblatt. Wird eine Zeile versehentlich auf «frei» gestellt, ist die Bemerkung beim nächsten «anwesend» wieder da.',
            'Wer **vor Ort** oder im **Magazin** ist, steht als Paar in der Zeile – die Antwort auf «wen könnte ich noch nachziehen». In der Kopfzeile steht die Aufteilung, sobald jemand im Magazin ist.',
            '**Weitere Person** erfasst jemanden, der nicht auf der Personalliste steht (Nachbarwehr, Gast). Das ist eine Aussage über diesen Einsatz, nicht über die Mitgliedschaft der Wehr.',
            'Wer **unter Atemschutz** ist, lässt sich nicht abmelden – ein Tipp springt stattdessen auf die Karte des Trupps.',
          ] },
          { kind: 'sub', text: 'Korrigieren' },
          { kind: 'list', items: [
            '**Rückgängig / Wiederherstellen** nimmt den letzten Tipp zurück (Kopfleiste, am Telefon in der Kopfzeile der Anwesenheit). Der Verlauf behält beides: den Tipp und die Korrektur.',
            'Zeiten stimmen nicht? Die **Zeit-Chips** in der Zeile korrigieren von/bis – auch für einen früheren Block, wenn jemand zweimal da war.',
            'Die drei Ansichten oben: **Anwesenheit** (wer ist da), **Zeitplan** (wer ist wann verfügbar), **Schichten** (Ablösungen als Bänder).',
          ] },
          { kind: 'note', text: 'Die Erfassung läuft auch **per QR** (Aushang am Magazin): wer sich dort einträgt, erscheint hier – und beide Seiten dürfen dieselbe Person anfassen, ohne dass etwas verloren geht.' },
        ],
      },
      {
        id: 'mittel', title: 'Material', icon: 'box',
        blocks: [
          { kind: 'lead', text: 'Was eingesetzt wurde – aus dem Katalog der Wehr oder frei erfasst. Der Rapport druckt daraus die Materialliste.' },
          { kind: 'list', items: [
            'Der **Katalog** kommt aus der Verwaltung, mit Einheit und Bestand («auf dem TLF», «Pio»). **+** erhöht die Menge, die Zeile bleibt stehen.',
            '**Anderes Material** erfasst etwas, das der Katalog nicht kennt – Bezeichnung und Menge genügen.',
            'Steht auf Karte oder Plan ein Symbol für ein Material (Lüfter, Ölbinder), das noch nicht erfasst ist, sagt es eine **Leiste über der Liste**: «Gesetzt, aber nicht erfasst». **Übernehmen** erfasst alles Fehlende mit der Quelle aus dem Bestand – einmal tippen, statt dieselbe Sache zweimal zu erfassen.',
            'Eine Menge auf **0** zu setzen entfernt die Zeile nicht aus dem Protokoll – der Rapport zeigt, was eingesetzt und was zurückgenommen wurde.',
          ] },
        ],
      },
      {
        id: 'zeitplan', title: 'Zeitplan & Schichten', icon: 'clock',
        blocks: [
          { kind: 'lead', text: 'Die zweite und dritte Ansicht der Anwesenheit: nicht «wer ist da», sondern **wer ist wann verfügbar** – für einen Einsatz, der länger dauert als eine Schicht.' },
          { kind: 'list', items: [
            'Im **Zeitplan** liegt jede Person auf einer Zeile; ziehen (oder der Stift) plant ein Verfügbarkeitsfenster. Das ist ein **Plan**, kein Protokoll: er schreibt keine Anwesenheit – die entsteht erst, wenn jemand wirklich antippt.',
            '**Zugesagt** (voll) oder **Vorschlag** (hohl) – der Unterschied zwischen «kommt» und «könnte».',
            'Der **Zeitraum** oben bestimmt, wie viele Stunden auf einmal zu sehen sind.',
            'In **Schichten** werden dieselben Fenster zu benannten Bändern gruppiert («Nacht 22–06»): ein Band anzulegen schreibt keine Schicht, und eine gelöschte Zeile löscht keine Verfügbarkeit.',
            'Beide Ansichten drucken: über das **Drucker-Menü** in der Kopfzeile – **Schichtplan** oder **Verfügbarkeiten**, als PDF oder direkt auf den Stationsdrucker.',
          ] },
        ],
      },
      {
        id: 'checkliste', title: 'Checkliste', icon: 'check',
        blocks: [
          { kind: 'lead', text: 'Zwei Spalten: abarbeitbare Aufgaben und ein durchsuchbares Taktik-Nachschlagewerk.' },
          { kind: 'list', items: [
            '**Aufgaben** – Einsatz-Checklisten (z. B. FU, Lagerapport) mit Fortschrittsanzeige; Punkte abhaken, Verzweigungen folgen mehrstufigen Abläufen.',
            '**Taktik · Stichworte** – Stichwort suchen und den passenden Eintrag öffnen (mit Gefahren-Farbcode und Skizzen).',
            'Bei einem übernommenen Alarm wird automatisch ein passendes Stichwort vorgeschlagen.',
          ] },
          { kind: 'lead', text: 'Der Stand bleibt erhalten und wird auf alle Geräte synchronisiert.' },
        ],
      },
      {
        id: 'verlauf', title: 'Verlauf & Eintrag', icon: 'history',
        blocks: [
          { kind: 'lead', text: 'Ein gemeinsames, fortlaufendes Protokoll über Karte und Plan – der Verlauf des Einsatzes.' },
          { kind: 'list', items: [
            '**+ Eintrag** (oben rechts): kurz tippen öffnet die Texteingabe. **Gedrückt halten** klappt zwei Felder auf – **Sprachnotiz** zuerst, **Foto** dahinter. Der Finger schiebt auf eines davon und lässt los. Der Knopf selbst wird dabei zum **✕**: loslassen, ohne geschoben zu haben, bricht ab und hinterlässt nichts. Erst beim Loslassen läuft die Aufnahme bzw. öffnet die Kamera. Fotos lassen sich auch im Eintrag selbst anhängen.',
            'Ab **zwei Buchstaben** werden Namen vorgeschlagen – Personal, Material, Partnerorganisationen, Fahrzeuge und Alarmgruppen, dazu die Posten **EL** und **Stv. EL**. Angetippt wird der ganze Name eingesetzt; im Verlauf und auf dem gedruckten Rapport ist er hervorgehoben. Wer den Posten schreibt, bekommt den Namen dazu («EL (Widmer Céline)»), und wer den Namen schreibt, den Posten. Ein eigenes «Von»-Feld gibt es nicht: der Satz sagt schon, wer gemeldet hat.',
            'Sobald der Satz auf einem Namen endet, stehen **→** und **←** als Vorschlag daneben: ein Tipp schreibt den Pfeil, und «EL → Sanität: Patient stabil» liest sich wie das Funkprotokoll, das der Verlauf ist. Auf dem Papier wird daraus «->».',
            'Solange das Feld **leer** ist, stehen Startchips bereit: zuerst **EL →**, danach die Textbausteine, die auf diesem Einsatz schon geschrieben wurden (sonst die Liste der Wehr). Sie bleiben stehen, bis wirklich getippt wird – ein zweiter Chip hängt sich an den ersten an.',
            'Wesentliche Aktionen (Symbol gesetzt, Zeichnung erstellt/entfernt …) landen automatisch im Verlauf.',
            '**Rückgängig/Wiederherstellen** gilt für Karte, Plan – und für die **Anwesenheit**: dort nimmt es den letzten Tipp zurück (am Telefon stehen die beiden Pfeile in der Kopfzeile der Anwesenheit).',
            'Ein Verlaufseintrag mit Ort springt beim Antippen zurück auf die Stelle in Karte oder Plan; Fotos und Sprachnotizen lassen sich direkt im Verlauf öffnen/abspielen.',
            'Ein **Vertipper** lässt sich korrigieren: der **Stift** in der Zeile steht auf allem, was jemand selber getippt hat – nicht auf dem, was die App über eine Aktion geschrieben hat («Trupp 2 eingerückt»). Die Zeile trägt danach **korrigiert HH:MM**; der ursprüngliche Wortlaut bleibt im Protokoll und in der Prüfkette.',
            '**Wiedergabe starten** spielt Karte und Plan zu einem früheren Zeitpunkt ab (Zeitschieber; Bearbeiten ist dabei gesperrt).',
          ] },
          { kind: 'sub', text: 'Pendenzen' },
          { kind: 'list', items: [
            'Der **Ring** neben «Info · Auftrag · Sofortmassnahme» macht aus einem Eintrag eine **Pendenz**: sie bleibt offen, bis sie abgehakt ist. Ein Tipp auf den Ring öffnet die Auswahl – **Neue Pendenz**, **Dringende Pendenz**, oder eine bereits offene, an die dieser Eintrag als **Meldung** gehängt wird.',
            'Offene Pendenzen stehen **oben im Verlauf**, dringende zuoberst, danach die ältesten. Die Zeit sagt, **wann sie erteilt wurden**; ein Tipp darauf zeigt stattdessen das Alter. Der Ring links hakt sie ab.',
            'Eine Pendenz sammelt **Meldungen**: die Zeile antippen schreibt eine dazu – mit allem, was ein Eintrag kann, also auch als Sprachnotiz oder Foto. Alle Meldungen stehen unter ihrer Pendenz, und im Verlauf trägt jede den Anfang der Pendenz als Verweis; ein Tipp darauf springt zu ihr.',
            'Eine Pendenz hat von sich aus **keine Fälligkeit** – auf dem Schadenplatz meldet sich niemand zur Uhrzeit zurück. Wer eine will, tippt die **Uhr** neben dem Ring: **in 5/10/15/30/60 Minuten** oder **Uhrzeit …** mit Tag und Zeit – in derselben Zeitauswahl wie überall (Walzen, oder die Zeit eintippen), heute oder an einem der nächsten Tage; ein Zeitpunkt, der schon vorbei ist, lässt sich nicht übernehmen. Eine Erinnerung ist damit keine eigene Sorte Zeile mehr, sondern ein Eintrag, der sich zusätzlich selber meldet – mit Art, Foto und Sprachnotiz wie jeder andere. In der Liste steht die Fälligkeit als Zeit neben der Zeile.',
            'Auf dem Rapport erscheinen sie als **«Aufträge / Pendenzen»** mit Was, Wer, Erteilt und Erledigt; noch offene stehen als **offen** da. Der Abschnitt lässt sich in **«Abschnitte»** abwählen.',
          ] },
          { kind: 'note', text: '**Wer** wird nicht abgefragt: der Satz nennt ihn. «Werkhof Oberwil stellt Absperrmaterial» genügt – der markierte Name landet als Wer auf dem Rapport.' },
        ],
      },
      {
        id: 'einsatz', title: 'Einsätze verwalten', icon: 'swap',
        blocks: [
          { kind: 'lead', text: 'Alles im Einsatz-Menü (Name oben links).' },
          { kind: 'list', items: [
            '**Einsatz wechseln** zwischen den offenen Einsätzen; **Neuer Einsatz** (Ort auf der Karte wählbar).',
            '**Alarm-Pool** – eingehende Alarme übernehmen (nur wo eine Alarmquelle angebunden ist).',
            '**Einsätze** – Archiv/frühere Einsätze öffnen.',
            '**Einsatz abschliessen** schliesst den laufenden Einsatz ab – derselbe Dialog wie im Rapport, mit demselben Zähler dessen, was noch offen ist.',
          ] },
        ],
      },
      {
        id: 'rapport', title: 'Rapport & Abschluss', icon: 'doc',
        blocks: [
          { kind: 'lead', text: 'Der **Einsatzrapport** ist eine eigene Fläche in der linken Leiste, unter Material ([[R]]) – ein vorausgefülltes Erfassungsblatt, kein Formular von null. Er wird über den ganzen Einsatz hinweg ergänzt, nicht erst am Schluss.' },
          { kind: 'list', items: [
            'Auf breiten Schirmen zwei Spalten: links das **Formular** zum Tippen (Alarmierung, Kurzbericht, Zeiten, Bemerkungen, Rückmeldung ELZ), rechts der **Abgleich** zum Abhaken (Anwesenheit, Material, Partnerorganisationen, Fotos).',
            'Unter dem Titel steht, was erfasst ist – und als eigene Chips, was **noch offen** ist: Zeiten, Anwesenheit, Material, Einsatzleiter, Kurzbericht, Rückmeldung ELZ. Nichts davon blockiert je den Druck.',
            'Der **Kroki-Ausschnitt** liegt als Feld neben dem Formular: verschieben, zoomen, **Hoch/Quer** und der **Kroki-Stand** – welchen Zeitpunkt das Bild zeigt, mit Strichen dort, wo etwas passiert ist. Gedruckt wird genau das, was auf dem Schirm steht; es gibt keinen Bestätigungsschritt.',
            '**Einsatzrapport (PDF)** erzeugt den fertigen Rapport – serverseitig gerendert, ein Knopf. Das **▾** daneben öffnet **«Abschnitte»**: was aufs Papier kommt (Kroki, Pläne, Atemschutz, Anwesenheit, Material, Verlauf, Fotos, detaillierter Prüfnachweis). Das Menü bleibt beim Anhaken offen.',
            'Wo eine Wehr einen **Stationsdrucker** betreibt: **Ausdrucken** reiht den Rapport dort ein. Eingereiht ist nicht gedruckt – solange der Auftrag hängt, steht er als **offener Druckauftrag** unter dem Rapportkopf, mit **Prüfen** und **Abbrechen**. Erst wenn der Drucker «gedruckt» meldet, gilt der Rapport als erstellt.',
            'Hat die Wehr eigene Formulare hinterlegt (Verwaltung › Rapport), steht unter den Fotos **Formulare & Links** – eine Liste zum Abhaken. **Öffnen** ruft das Formular auf, mit Stichwort, Ort, Datum und Einsatzleiter bereits ausgefüllt, soweit der Link das vorsieht. Der Haken wird von Hand gesetzt: ob ein Formular abgeschickt wurde, sieht die App nicht.',
            'Stimmt etwas mit dem Datensatz nicht – eine unterbrochene Prüfkette, eine Sprachnotiz ohne Transkript, ein Foto noch in der Warteschlange –, erscheint neben den Knöpfen ein **oranger Hinweis-Chip**. Er zählt die Punkte und öffnet sie; ist alles in Ordnung, erscheint er gar nicht.',
            'Kontaktperson und Rückmeldung ELZ haben am Ende der Zeile ein **Entfällt** – für den Fehlalarm oder die Ölspur, wo es beides nicht gibt. Das ist eine Antwort, keine Übergehung: sie wird festgehalten und steht so im Rapport.',
            '**Einsatz abschliessen** schliesst den Einsatz ab und hält das Einsatzende fest. Fotos und Sprachnotizen, die noch nicht hochgeladen sind, werden vorher gesendet; geht das nicht (offline), **bleiben sie gespeichert** und gehen beim nächsten Öffnen raus – die Bestätigung sagt, wie viele.',
            '**Weitergeben** (unten im Rapport, und im Einsatz-Menü unter **Einsatz teilen**): ein Link auf genau diesen Einsatz – Karte, Pläne, Verlauf, Fotos, Zeiten. Nur lesen, kein Login, nichts lässt sich ändern. Für Zentrale, EL und Nachbarwehr mitten im Einsatz – und für Gemeinde und Nachbarwehr danach: er gilt über den Abschluss hinaus, bis ihn jemand aufhebt.',
          ] },
          { kind: 'note', text: 'Ein abgeschlossener Einsatz lässt sich **wieder öffnen** – spätere Ergänzungen erscheinen in Verlauf und Rapport als **Nachträge**, nichts geht verloren.' },
        ],
      },
      {
        id: 'erfassung', title: 'Erfassung per QR', icon: 'cam',
        blocks: [
          { kind: 'lead', text: 'Wo eine Wehr die Erfassung aktiviert hat (Verwaltung › Erfassung), öffnet ein **QR-Poster** im Magazin die Erfassungs-Ansicht – ohne Login, für alle ohne Tablet-Zugriff.' },
          { kind: 'list', items: [
            'Der laufende Einsatz wird gewählt; **Anwesenheit** und **Material** lassen sich am eigenen Handy erfassen.',
            'Ein Name wird durch Antippen weitergeschaltet: **nicht anwesend → Magazin → Vor Ort → gegangen**. Das **ⓘ** neben der Suche sagt es nochmals, samt der Bedeutung der Zeit daneben (von = Ankunft, bis = Weggang).',
            'Die Angaben fliessen in **denselben Einsatz** wie am KP-Tablet und werden zusammengeführt (bei Abweichungen mit Hinweis zum Prüfen).',
            'Als Rückfall gibt es das **leere Erfassungsblatt (PDF)** zum Ausdrucken und Nachtragen von Hand.',
          ] },
        ],
      },
      {
        id: 'sync', title: 'Mehrgeräte & Offline', icon: 'check',
        blocks: [
          { kind: 'lead', text: 'Alle Geräte sehen denselben Einsatz live.' },
          { kind: 'list', items: [
            'Änderungen werden automatisch geteilt; das Sync-Abzeichen oben zeigt den Stand (gespeichert/ausstehend).',
            'Gleichzeitige Bearbeitung wird pro Objekt zusammengeführt (jüngste Änderung gewinnt).',
            '**Nur-Lesen**: Betrachter und Telefone sehen die Karte live, ohne die taktischen Werkzeuge.',
          ] },
          { kind: 'sub', text: 'Offline' },
          { kind: 'list', items: [
            '**Offline-Vorbereitung** in den **Einstellungen** ([[⌘]] [[,]]) steht auf **Automatisch**: die installierte App holt Karte, Pläne, Symbole und Referenzebenen kurz nach dem Öffnen eines Einsatzes von selbst – ohne Dialog, ohne Toast. Mitgeladen wird **jede** eingerichtete Kartenebene, auch die gerade ausgeblendete: eingeblendet wird sie erfahrungsgemäss erst, wenn das Netz schon weg ist. **Nur manuell** überlässt das dem Knopf **Alles für offline laden**.',
            'Wie viel geladen wird, bestimmt der **Offline-Umkreis** (ebenfalls Einstellungen, gilt nur auf diesem Gerät): kleinerer Umkreis = schnellerer, kleinerer Download.',
            'Was tatsächlich bereit ist, sagt **Offline-Bereitschaft** im Einsatz-Menü – Zeile für Zeile: Karte, Pläne, Symbole, Gefahrgut, Referenzebenen, Personal, Gerätespeicher. **Wetter** und **Objektsuche** brauchen eine Verbindung und stehen dort als «nur online».',
            'Verlässlich offline ist nur die **installierte App**. In einem Browser-Tab kann der Speicher jederzeit geleert werden, und der Tab müsste beim nächsten Einsatz noch offen sein.',
            'Ohne Netz läuft weiter, was auf dem Gerät liegt: zeichnen und Symbole setzen, Atemschutz, Anwesenheit, Material, Verlauf und Rapport. Fotos und Sprachnotizen bleiben gespeichert und gehen später raus.',
            'Sobald wieder Netz da ist, gehen die Änderungen von selbst hinaus und werden mit den anderen Geräten zusammengeführt – pro Objekt, jüngste Änderung gewinnt. Solange etwas aussteht, sagt es das Sync-Abzeichen oben.',
          ] },
        ],
      },
      {
        id: 'bedienung', title: 'Bedienung & Tag/Nacht', icon: 'move',
        blocks: [
          { kind: 'sub', text: 'Tippen & Ziehen (Touch/iPad)' },
          { kind: 'list', items: [
            'Ein Finger schiebt die Karte/den Plan; zwei Finger zoomen (Pinch).',
            'Auch mit einem Finger: **doppeltippen** zoomt hinein; **tippen, nochmals drücken und ziehen** zoomt stufenlos – nach unten hinein, nach oben hinaus. Gleich auf Karte und Plan, mit der **Auswahl**. Ein Werkzeug hat Vorrang: wo es tippt (Punkte, Messen, Hinzufügen, Notiz, Kreis …), gehört jedes Tippen ihm; wo es zieht (Freihand, Mehrfach), zoomt Doppeltippen weiter. Zwei Finger zoomen immer. Linie und Fläche aus Punkten schliesst ✓ ab, nie ein Doppeltippen.',
            'Nochmals auf **Auswahl** tippen schaltet den Knopf auf **Mehrfach**: ein gezogener Rahmen wählt mehrere Objekte; ausgewählte Objekte verschiebt man durch Ziehen.',
          ] },
          { kind: 'sub', text: 'Maus', only: 'keyboard' },
          { kind: 'list', only: 'keyboard', items: [
            'Scrollen zoomt; **Rechtsklick** (oder langes Tippen) auf einen Mess-/Linienpunkt entfernt ihn, Klick auf eine Linie fügt einen Zwischenpunkt ein.',
          ] },
          { kind: 'sub', text: 'Tasten', only: 'keyboard' },
          { kind: 'list', only: 'keyboard', items: [
            '[[Esc]] bricht das aktive Werkzeug ab bzw. hebt die Auswahl auf.',
            '[[Entf]] / [[Backspace]] löscht die Auswahl (nicht beim Tippen in ein Feld).',
          ] },
          { kind: 'sub', text: 'Beschriftete Leisten' },
          { kind: 'list', items: [
            'In den **Einstellungen** ([[⌘]] [[,]]) unter «Beschriftung der Werkzeugleisten»: **Ein** schreibt unter jedes Zeichen der beiden Leisten sein Wort. Für alle, die die Symbole noch nicht auswendig kennen – die Leiste wird dafür etwas breiter, und «Ausklappen» braucht es dann nicht mehr. Auf dem **Telefon** ist sie von Anfang an ein.',
            'Ist sie aus, bleibt es beim Zeichen; ein Tipp auf **Ausklappen** zeigt die Namen für so lange, wie die Leiste offen bleibt.',
            'Überall sonst gilt: einen Knopf, auf dem nur ein Zeichen steht, **gedrückt halten** – nach einem kurzen Moment steht sein Wort als Blase darüber, auf Touch mit einem kurzen Summen. Das Loslassen löst den Knopf dabei **nicht** aus: fragen, was etwas ist, darf es nicht gleich auch tun. An der Maus genügt Draufzeigen.',
          ] },
          { kind: 'sub', text: 'Tag / Nacht' },
          { kind: 'list', items: [
            'In den **Einstellungen** ([[⌘]] [[,]]) unter «Farbschema»: Automatisch (folgt dem Tageslicht), Tag oder Nacht. Der Nachtmodus dämpft Karte und Oberfläche fürs Dunkle.',
          ] },
        ],
      },
      // Die Stationsdaten stehen hier, weil die zwei Regeln der Arbeitsmappe sonst nur in einer
      // Anleitung für Selbst-Betreiber stünden – und wer gleich die Mannschaft überschreibt,
      // liest die nicht. Kurz gehalten: die Verwaltung erklärt sich auf ihren eigenen Seiten,
      // hier steht das, was man vorher wissen muss.
      {
        id: 'verwaltung', title: 'Verwaltung & Stationsdaten', icon: 'gear',
        blocks: [
          { kind: 'lead', text: 'Was für die ganze Wehr gilt – Personal, Dienstgrade, Fahrzeuge, Material, Kartenebenen, Objektpläne, Checklisten – wird unter **Verwaltung** gepflegt, nicht im Einsatz. Der Zugang dorthin ist ein eigenes Passwort, nicht die Einsatz-PIN.' },
          { kind: 'sub', text: 'Die Arbeitsmappe (Excel)' },
          { kind: 'list', items: [
            'Unter **Daten › Arbeitsmappe** gibt es die Listen der Wehr als eine einzige Excel-Datei: herunterladen, in Excel, Numbers oder LibreOffice bearbeiten, wieder hochladen. Acht Blätter – Mannschaft, Dienstgrade, Fahrzeuge, Mittel, Mittel-Bestände, Quellen, Partnerorganisationen, Symbolfelder (die Blätter heissen so, wie sie in der Datei stehen).',
            'Vor dem Schreiben kommt immer eine **Vorschau**: Blatt für Blatt, was neu wäre, was sich ändert, was wegfällt – und jede abgelehnte Zeile mit Blatt und Zeilennummer. Bis zur Bestätigung ist nichts geschrieben, und Abbrechen schreibt nichts.',
            'Dieselbe Datei nochmals hochgeladen ändert gar nichts. Der Download ist damit auch die Vorlage – und man kann ihn gefahrlos nur zum Nachschauen holen.',
          ] },
          { kind: 'note', text: '**Ein fehlendes Blatt ist kein leeres Blatt.** Ein Blatt ganz aus der Datei zu löschen lässt diese Liste unverändert. Nur die Zeilen zu löschen und die Titelzeile stehen zu lassen leert sie – genau so leert man eine Liste absichtlich.' },
          { kind: 'note', text: '**«Fehlt» heisst zweierlei.** Eine Person, die im Blatt «Mannschaft» fehlt, wird **deaktiviert** und nie gelöscht – abgeschlossene Einsätze lösen ihren Namen über diese Zeile auf. Eine Kennung, die in einer der anderen Listen fehlt, wird **entfernt**. Die Vorschau benennt beides mit genau diesen Wörtern und zählt es nicht nur.' },
          { kind: 'sub', text: 'Wenn doch etwas schiefgeht' },
          { kind: 'list', items: [
            'Jede Änderung an den **Listen** hebt den Stand von vorher auf: **Sicherung › Letzte Änderungen** zeigt sie mit Zeitpunkt und holt einen davon zurück – egal ob ein Formular, die Arbeitsmappe oder das Terminal geschrieben hat.',
            '**Das Personal steht dort nicht drin.** Personen sind keine Konfiguration, sondern eigene Einträge – ein Import, der nur das Blatt Mannschaft anfasst, taucht unter «Letzte Änderungen» gar nicht auf. Dafür wird dort auch nie jemand gelöscht, nur deaktiviert: rückgängig heisst wieder aktivieren. Wer die Liste als Ganzes zurückholen will, nimmt die Datei, die er vor dem Import heruntergeladen hat.',
            'Die Arbeitsmappe ist **keine Sicherung**: sie deckt nur die Listen ab. Die Sicherung ist der JSON-Export unter **Sicherung**.',
          ] },
        ],
      },
    ] as HelpSection[],
  },
} as const
