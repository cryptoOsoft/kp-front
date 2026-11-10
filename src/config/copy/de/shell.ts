// German copy · the app shell: loading, modes, the nav rail, Trupp finden, the Ebenen panel.
// One slice of the canonical `de` catalogue, assembled in ../de.ts — read the rules at the
// top of that file before adding or renaming a key here.

export const shellCopy = {
  loading: 'Wird geladen …',
  loadingSubtitle: 'Karte & Symbolbibliothek werden geladen …',
  // ⚠️ «Trupps», nicht «Atemschutz» (04.09.). Die Fläche führt seit 03.09. BEIDE Arten Trupp — die
  // Atemschutztrupps oben, die Arbeitstrupps darunter (atemschutz.sectionPlain) —, und ein Bereich,
  // der «Atemschutz» heisst, sagt einem Verkehrstrupp, er gehöre nicht hierher. Der Schlüssel bleibt
  // `atemschutz`: er benennt die Route, nicht das Wort auf dem Schild. Die Taste bleibt ebenfalls
  // [[A]] (lib/hotkeys · SURFACE_KEY) — Tasten umzustellen kostet die Hand mehr als der Name ihr
  // bringt. Was «Atemschutzüberwachung» heisst, heisst weiterhin so: der gedruckte Abschnitt
  // (report.atemschutz), sein Haken (preflight.toggleAtemschutz) und die abgegebene Tafel
  // (atemschutz.title) — das sind Namen des Sicherheitsnachweises, nicht des Bereichs.
  modes: { map: 'Karte', plans: 'Plan', checklists: 'Checkliste', atemschutz: 'Trupps', anwesenheit: 'Anwesenheit', mittel: 'Material', rapport: 'Rapport' },
  // the left navigation rail (Karte · Pläne group · Checkliste · Trupps)
  // (no «Objekt wählen» any more: the rail is pure navigation, the object sits on the
  //  plan surface – see whiteboard.objectLabel)
  navRail: { map: 'Karte', plansGroup: 'Pläne', plansChoose: 'Plan wählen', pageGroup: 'Seite wählen', assign: 'Plan zuweisen', expand: 'Ausklappen', collapse: 'Einklappen', resize: 'Leiste anpassen', scrollMore: 'Weitere anzeigen',
    // the accessible name of the tool rail's view bar (ToolRail · Ebenen · Ansichten · zoom, tablet/laptop)
    viewBar: 'Ansicht' },
  // «Trupp finden» – the one place that answers «wo steht Trupp 2», across Karte UND Pläne.
  // Deliberately the same shape as «Welcher Trupp?»: a short list you tap, no surface of its own.
  truppFinder: {
    title: 'Trupp finden',
    // «oder Name»: the list searches the people in a Trupp too — the foot said so a second time until 29.09.2026
    placeholder: 'Trupp oder Name …',
    noMatches: 'Kein Trupp gefunden',
    // shown INSTEAD of the list when nothing is placed anywhere — the honest answer, and it
    // says where a Trupp comes from rather than leaving an empty box
    empty: 'Noch kein Trupp platziert.',
    emptyHint: 'Trupps werden auf der Karte oder auf einem Plan platziert – über die Truppkarte unter «Trupps» oder das Trupp-Werkzeug.',
    // the row's own status word, when the Trupp board says the Trupp has come back out
    raus: 'raus',
  },
  panels: { layers: 'Ebenen', history: 'Verlauf' },
  // LayerPanel: the toggle aria-label appends one of these state words after the layer name
  layerPanel: {
    stateVisible: 'sichtbar, ausblenden',
    stateHidden: 'ausgeblendet, einblenden',
    // Der Regler unter einer eingeblendeten Ebene – im Screenreader hinter dem Ebenennamen,
    // damit «Deckkraft» sagt, wovon.
    opacity: 'Deckkraft',
    // Schnellzugriffe oben im Panel: alles ein/aus, zurück zum Standard des Einsatztyps
    showAll: 'Alle ein',
    hideAll: 'Alle aus',
    reset: 'Standard',
    // Ebenen-Knopf, wenn die Ebenen weder Standard noch «Alle ein/aus» sind (05.10.2026):
    // ein Punkt am Knopf, dieses Wort im Screenreader und Tooltip
    custom: 'Eigene Auswahl',
    /* Eine GeoJSON-Ebene (Leitungen, Hydranten …) lädt eine mehrere Megabyte grosse Datei.
       Die Zeile sagt selbst, wie weit sie ist – mit Zahlen, sobald der Server die Grösse
       mitschickt, sonst nur mit dem Lade-Symbol (Owner, Review-Runde 7, 20.10.2026). */
    loading: 'Wird geladen …',
    loadingOf: 'Wird geladen … {done} von {total}',
    loadEmpty: 'Keine Daten in dieser Ebene',
    loadFailed: 'Nicht geladen – aus- und wieder einschalten',
  },
} as const
