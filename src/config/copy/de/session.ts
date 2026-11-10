// German copy · demo, login, boot, errors, updates, install, session.
// One slice of the canonical `de` catalogue, assembled in ../de.ts — read the rules at the
// top of that file before adding or renaming a key here.

export const sessionCopy = {
  // Login gate (face picker + PIN pad)
  demo: {
    ribbon: 'DEMO',
    ariaLabel: 'Demo-Instanz mit synthetischen Daten',
    actionBlocked: 'In der Demo nicht möglich.',
    welcome: {
      title: 'Willkommen bei KP Front',
      intro: 'Ein vorbereiteter Einsatz mit erfundenen Daten. Zeichne, führe Trupps und probiere die Lageführung frei aus.',
      reloadWarn: 'Alle Besucher arbeiten gemeinsam. Die Demo wird um Mitternacht und Mittag zurückgesetzt.',
      canTitle: 'Das kannst du ausprobieren',
      can: [
        'Karte und Plan bearbeiten',
        'Atemschutz und Material führen',
        'Objektpläne und Rapport öffnen',
      ],
      cta: 'Los geht’s',
      meta: 'Keine echten Einsatzdaten – neue Einsätze sind gesperrt',
    },
  },
  login: {
    subtitle: 'Führungsunterstützung',
    pinEnter: 'PIN eingeben',
    connectionFailed: 'Verbindung zum Server fehlgeschlagen',
    loadingRoster: 'Personal wird geladen …',
    noUsers: 'Keine Benutzer hinterlegt',
    whoAreYou: 'Wer bist du?',
    // the banner above the grid while this device holds unsent work of an account (lib/
    // unsentAccounts, sweep 09.11.2026 UX.2): one line per account, {name} from the roster –
    // or `unsentFormer` in its place when the roster no longer lists the account
    unsentTitle: 'Ungesendete Änderungen von {name}',
    unsentFormer: 'einem früheren Konto',
    unsentLogin: 'Als {name} anmelden',
    unsentMore: 'und {n} weitere',
    unsentBody: 'Sie liegen nur auf diesem Gerät und werden erst übertragen, wenn sich dieses Konto hier anmeldet.',
    loginFailed: 'Anmeldung fehlgeschlagen',
    pleaseWait: 'Bitte kurz warten …',
    clearDigit: 'Löschen',
    // the ✓ key on the pad — a PIN submits deliberately, never on some Nth digit
    submitPin: 'Anmelden',
    retry: 'Erneut versuchen',
    // a 403 on the roster: this device still holds the cookie of an Einsatz-Link whose Einsatz
    // has ended, and every retry fails identically until that session is dropped
    // status 0 on the roster: the shared «Gespeicherte Einsätze bleiben offline verfügbar» is
    // not true from HERE — a device that reaches the login screen is not signed in any more
    offlineHint: 'Ohne Verbindung ist keine Anmeldung möglich. Gespeicherte Einsätze öffnen sich nur, wenn dieses Gerät noch angemeldet war.',
    // optional second door onto the SAME accounts (backend auth/microsoft) — only drawn when the
    // station set it up; the PIN tiles above stay the way in at the Schadenplatz
    microsoft: 'Mit Microsoft anmelden',
    // ?msLogin=<reason> on the way back from Microsoft
    microsoftErrors: {
      cancelled: 'Microsoft-Anmeldung abgebrochen.',
      expired: 'Die Microsoft-Anmeldung hat zu lange gedauert. Bitte nochmals.',
      failed: 'Microsoft-Anmeldung fehlgeschlagen. Bitte nochmals oder mit PIN anmelden.',
      unknown: 'Dieses Microsoft-Konto ist für KP Front nicht freigeschaltet. Bitte mit PIN anmelden oder den Admin fragen.',
      inactive: 'Das zugehörige Konto ist deaktiviert. Bitte den Admin fragen.',
    },
  },
  // boot Splash: shown while the /me probe, the incident list or a lazy chunk settles. If a
  // stage takes unusually long the splash grows a status line + an action, so a stalled launch
  // is never a dead screen the operator can only escape by killing the app.
  splash: {
    stuck: 'Start dauert länger als gewöhnlich',
    stuckHint: 'Verbindung schwach oder Server nicht erreichbar. Gespeicherte Einsätze sind offline verfügbar.',
    reload: 'Neu starten',
  },
  // render-throw fallback (ErrorBoundary). Escalates on a repeat crash of the same Einsatz:
  // reloading auto-reopens it, so after the second crash the escape actions take over.
  errorBoundary: {
    title: 'Ein Fehler ist aufgetreten',
    body: 'Die Ansicht konnte nicht geladen werden. Deine lokalen Änderungen sind gespeichert und bleiben erhalten.',
    bodyRepeat: 'Dieser Einsatz lässt sich nicht öffnen – auch nach dem Neuladen nicht. Schliesse ihn, um zur Übersicht zu kommen; die gespeicherten Daten bleiben auf dem Server.',
    reload: 'Neu laden',
    closeIncident: 'Einsatz schliessen',
    discardLocal: 'Lokale Kopie verwerfen',
    discardLocalHint: 'Verwirft nur die Kopie auf diesem Gerät und lädt den Einsatz neu vom Server. Noch nicht synchronisierte Änderungen von diesem Gerät gehen dabei verloren.',
    // …and why it is greyed out while offline (ErrorBoundary · discardBlocked)
    discardLocalOffline: 'Ohne Verbindung nicht möglich – der Einsatz liesse sich danach nicht neu vom Server laden.',
    discardLocalOfflineUnsynced: 'Änderungen von diesem Gerät sind noch nicht übertragen.',
    // the ROOT boundary's repeat crash (launcher, login, a lazy chunk — no Einsatz to close):
    // «App zurücksetzen» drops only the cached incident list and user, never a workspace cache
    bodyRepeatRoot: 'Die App startet nicht – auch nach dem Neuladen nicht. Setze die lokalen Listen zurück; gespeicherte Einsätze und Änderungen bleiben erhalten.',
    resetShell: 'App zurücksetzen',
    resetShellHint: 'Leert nur die Einsatzliste und die Anmeldedaten auf diesem Gerät. Einsätze und ihre Änderungen bleiben gespeichert.',
  },
  // one surface's render-throw fallback (SurfaceBoundary): the card sits INSIDE the view, the
  // rest of the Einsatz — rail, top bar, Meldeleiste, the Atemschutz alarm — keeps running
  surfaceError: {
    title: 'Diese Ansicht konnte nicht geladen werden',
    body: 'Der übrige Einsatz läuft weiter – die Atemschutzüberwachung bleibt aktiv, deine Änderungen sind gespeichert.',
    retry: 'Ansicht neu aufbauen',
    toMap: 'Zur Karte',
    repeatHint: 'Diese Ansicht stürzt wiederholt ab – bitte in der Rückmeldung melden.',
  },
  // the tactical symbol pack failed to load (useSymbols): Karte and Kroki run without glyphs
  // rather than never mounting; the Meldeleiste row offers the reload
  symbols: {
    loadFailedTitle: 'Symbolbibliothek konnte nicht geladen werden',
    loadFailedSub: 'Karte und Kroki laufen ohne Symbolgrafiken weiter',
    retry: 'Erneut versuchen',
    dismiss: 'Ausblenden',
  },
  // PWA update prompt (UpdateBanner). A new build installs and waits (registerType 'prompt')
  // instead of reloading mid-incident; the operator applies it when it's safe.
  update: {
    // ⚠️ Zwei Wege, weil zwei Geräteklassen: auf iOS bleibt es beim Neustart (die Aktivierung
    // in der laufenden App hängt sich dort auf, Entscheid 2026-07-09), überall sonst genügt
    // ein Tipp – dort hilft Schliessen allein oft nicht, weil ein vergessener Browser-Tab den
    // alten Stand festhält (16.09.2026).
    available: 'Update bereit',
    hint: 'Wird beim Neustart aktiv – App schliessen & neu öffnen.',
    hintApply: 'Ein Tipp genügt – die App lädt kurz neu.',
    apply: 'Jetzt aktualisieren',
    applying: 'Wird aktualisiert …',
    dismiss: 'Ausblenden',
    updated: 'Aktualisiert – {v}',
  },
  // "Als App installieren" nudge + guide (InstallBanner/InstallGuide). Only in a plain
  // browser tab — installed (standalone) the whole surface disappears. The guide detects the
  // platform and shows ONLY this device's steps; {share} renders the iOS share glyph inline.
  install: {
    menu: 'Als App installieren',
    bannerTitle: 'KP Front als App installieren',
    bannerHint: 'Offline-fähig, Vollbild, eigenes Symbol.',
    bannerAction: 'Anleitung',
    // the ✕'s name, like every plain dismiss in the Meldeleiste (20.10.2026, S10): it hides the
    // nudge for good on this device, so «Später» promised a «later» that never came
    dismiss: 'Ausblenden',
    title: 'Als App installieren',
    why: 'Installiert läuft KP Front wie eine App: offline verfügbar am Einsatzort, im Vollbild ohne Browser-Leiste, mit eigenem Symbol auf dem Home-Bildschirm.',
    nativeButton: 'Jetzt installieren',
    nativeHint: 'Der Browser fragt kurz nach – mit «Installieren» bestätigen.',
    manualIntro: 'Oder manuell:',
    installed: 'Installiert! KP Front ab jetzt über das App-Symbol starten.',
    alreadyStandalone: 'KP Front läuft bereits als installierte App.',
    ios: {
      intro: 'Auf iPad/iPhone:',
      steps: [
        'Teilen-Symbol {share} in der Symbolleiste antippen',
        '«Zum Home-Bildschirm» wählen',
        'Mit «Hinzufügen» bestätigen',
      ] as string[],
      note: 'Falls «Zum Home-Bildschirm» fehlt: Seite in Safari öffnen.',
    },
    android: {
      intro: 'In Chrome auf Android:',
      steps: [
        'Menü ⋮ oben rechts antippen',
        '«App installieren» wählen',
        'Bestätigen',
      ] as string[],
      note: 'In anderen Browsern: Menü → «Zum Startbildschirm hinzufügen».',
    },
    desktop: {
      intro: 'In Chrome oder Edge:',
      // The menu first, not the icon: the install icon in the address bar appears ONLY while the
      // page is installable and not yet installed, and Chrome has moved it several times across
      // versions. Somebody who looks for it and can't find it concludes the instructions are
      // wrong. The menu path is always there.
      steps: [
        'Browser-Menü ⋮ oben rechts öffnen',
        '«KP Front installieren» wählen und bestätigen',
      ] as string[],
      note: 'Das Menü führt den Eintrag je nach Version direkt oder unter «Speichern und teilen». Steht rechts in der Adressleiste ein Installations-Symbol, geht es auch damit. Fehlt beides, ist KP Front auf diesem Gerät bereits installiert.',
    },
    macSafari: {
      intro: 'In Safari auf dem Mac:',
      steps: [
        'Menü «Ablage» öffnen',
        '«Zum Dock hinzufügen» wählen',
        'Mit «Hinzufügen» bestätigen',
      ] as string[],
      note: '',
    },
    unsupported: 'Dieser Browser unterstützt die Installation nicht. Am besten die Seite in Chrome, Edge oder Safari öffnen und dort installieren.',
  },
  // Die Meldeleiste — der eine Streifen unter der Kopfleiste. Er rangiert, was ansteht (Klasse
  // vor Zeit) und zeigt die oberste Meldung; sichtbar steht dort sonst nur «+n». Diese drei
  // Wörter sind für Screenreader und Tooltips da, nicht für die Zeile selbst.
  meldeleiste: {
    region: 'Meldungen',
    // Auf der Trupp-Tafel steht nur die dringendste Meldung offen (staging r3): zwei Zeilen
    // deckten am Telefon die Uhr des ersten Trupps zu. Der Rest ist eine Zahl, die aufklappt.
    more: '+{n} weitere Meldung',
    moreMany: '+{n} weitere Meldungen',
    less: 'Weniger anzeigen',
  },
  // single-editor tab lock: a second browser tab on the SAME incident is read-only
  // the session cookie expired mid-Einsatz (api.ts · SESSION_EXPIRED_EVENT): every request 401s
  // and nothing used to say so. No ✕ — the row ends only by signing in again.
  session: {
    expiredTitle: 'Anmeldung abgelaufen',
    expiredHint: 'Änderungen bleiben auf diesem Gerät und werden nach der Anmeldung synchronisiert',
    // …naming the account, where the device knows it: on a shared tablet «nach der Anmeldung»
    // holds only for the SAME account (sweep 09.11.2026, UX.2)
    expiredHintNamed: 'Änderungen bleiben auf diesem Gerät und werden nach der Anmeldung von {name} synchronisiert',
    relogin: 'Neu anmelden',
    // an Einsatz opened by ANOTHER account while unsent edits of {name} for it are parked on this
    // device (ForeignUnsentMeldung): they are neither shown nor sent until {name} signs in here.
    // {name} is `login.unsentFormer` when the roster no longer lists the account.
    foreignUnsentTitle: 'Nicht übertragene Änderungen von {name} auf diesem Gerät',
    foreignUnsentSub: '{name} muss sich hier anmelden',
    foreignUnsentFormerSub: 'Sie bleiben auf diesem Gerät gespeichert',
    foreignUnsentDismiss: 'Ausblenden',
  },
  tabLock: {
    title: 'In einem anderen Tab geöffnet',
    hint: 'Dieser Tab ist nur zum Lesen – die Bearbeitung läuft im anderen Tab.',
    takeOver: 'Hier bearbeiten',
  },
} as const
