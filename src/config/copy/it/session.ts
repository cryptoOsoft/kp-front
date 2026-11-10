// Italian copy · demo, login, boot, errors, updates, install, session.
// One slice of the `it` overlay, assembled in ../it.ts; the German base is ../de/session.ts.

import type { Copy, Localizable } from '../index'

type Keys =
  | 'demo' | 'login' | 'splash' | 'errorBoundary' | 'surfaceError' | 'symbols' | 'update'
  | 'install' | 'meldeleiste' | 'session' | 'tabLock'

export const sessionCopy: Localizable<Pick<Copy, Keys>> = {
  login: {
    subtitle: 'Supporto alla conduzione',
    pinEnter: 'Inserisci PIN',
    connectionFailed: 'Connessione al server non riuscita',
    loadingRoster: 'Caricamento effettivo…',
    noUsers: 'Nessun utente registrato',
    whoAreYou: 'Chi sei?',
    unsentTitle: 'Modifiche non inviate di {name}',
    unsentFormer: 'un account precedente',
    unsentLogin: 'Accedi come {name}',
    unsentMore: 'e altri {n}',
    unsentBody: 'Si trovano solo su questo dispositivo e vengono trasmesse solo quando questo account accede qui.',
    loginFailed: 'Accesso non riuscito',
    pleaseWait: 'Attendi un momento…',
    clearDigit: 'Cancella',
    submitPin: 'Accedi',
    retry: 'Riprova',
    offlineHint: 'Senza connessione non è possibile accedere. Gli interventi salvati si aprono solo se questo dispositivo era ancora connesso.',
    microsoft: 'Accedi con Microsoft',
    microsoftErrors: {
      cancelled: 'Accesso Microsoft annullato.',
      expired: 'L’accesso Microsoft ha richiesto troppo tempo. Riprova.',
      failed: 'Accesso Microsoft non riuscito. Riprova o accedi con il PIN.',
      unknown: 'Questo account Microsoft non è abilitato per KP Front. Accedi con il PIN o chiedi all’admin.',
      inactive: 'L’account collegato è disattivato. Chiedi all’admin.',
    },
  },
  splash: {
    stuck: 'L’avvio richiede più tempo del solito',
    stuckHint: 'Connessione debole o server non raggiungibile. Gli interventi salvati sono disponibili offline.',
    reload: 'Riavvia',
  },
  errorBoundary: {
    title: 'Si è verificato un errore',
    body: 'Impossibile caricare la vista. Le tue modifiche locali sono salvate e restano intatte.',
    bodyRepeat: 'Questo intervento non si apre – nemmeno dopo il ricaricamento. Chiudilo per tornare alla panoramica; i dati salvati restano sul server.',
    reload: 'Ricarica',
    closeIncident: 'Chiudi intervento',
    discardLocal: 'Elimina copia locale',
    discardLocalHint: 'Elimina solo la copia su questo dispositivo e ricarica l’intervento dal server. Le modifiche di questo dispositivo non ancora sincronizzate andranno perse.',
    discardLocalOffline: 'Non possibile senza connessione – l’intervento non potrebbe poi essere ricaricato dal server.',
    discardLocalOfflineUnsynced: 'Alcune modifiche di questo dispositivo non sono ancora state trasmesse.',
    bodyRepeatRoot: 'L’app non si avvia – nemmeno dopo il ricaricamento. Reimposta gli elenchi locali; interventi e modifiche salvati restano conservati.',
    resetShell: 'Reimposta app',
    resetShellHint: 'Svuota solo l’elenco degli interventi e i dati di accesso su questo dispositivo. Interventi e relative modifiche restano salvati.',
  },
  surfaceError: {
    title: 'Questa vista non è stata caricata',
    body: 'Il resto dell’intervento continua – il monitoraggio autoprotettori resta attivo, le tue modifiche sono salvate.',
    retry: 'Ricostruisci vista',
    toMap: 'Alla mappa',
    repeatHint: 'Questa vista si blocca ripetutamente – segnalalo nel feedback.',
  },
  symbols: {
    loadFailedTitle: 'La libreria dei simboli non è stata caricata',
    loadFailedSub: 'Mappa e schizzo continuano senza grafiche dei simboli',
    retry: 'Riprova',
    dismiss: 'Nascondi',
  },
  update: {
    available: 'Aggiornamento pronto',
    hint: 'Attivo al prossimo avvio – chiudere completamente l’app e riaprirla.',
    hintApply: 'Basta un tocco – l’app si ricarica brevemente.',
    apply: 'Aggiorna ora',
    applying: 'Aggiornamento …',
    dismiss: 'Nascondi',
    updated: 'Aggiornato – {v}',
  },
  install: {
    menu: 'Installa come app',
    bannerTitle: 'Installa KP Front come app',
    bannerHint: 'Offline, schermo intero, icona propria.',
    bannerAction: 'Guida',
    dismiss: 'Nascondi',
    title: 'Installa come app',
    why: 'Installata, KP Front funziona come un’app: disponibile offline sul posto, a schermo intero senza barra del browser, con la propria icona nella schermata Home.',
    nativeButton: 'Installa ora',
    nativeHint: 'Il browser chiederà conferma – confermare con «Installa».',
    manualIntro: 'Oppure manualmente:',
    installed: 'Installata! D’ora in poi avviare KP Front dall’icona dell’app.',
    alreadyStandalone: 'KP Front è già in esecuzione come app installata.',
    ios: {
      intro: 'Su iPad/iPhone:',
      steps: [
        'Toccare il simbolo di condivisione {share} nella barra degli strumenti',
        'Scegliere «Aggiungi alla schermata Home»',
        'Confermare con «Aggiungi»',
      ],
      note: 'Se «Aggiungi alla schermata Home» manca: aprire la pagina in Safari.',
    },
    android: {
      intro: 'In Chrome su Android:',
      steps: [
        'Toccare il menu ⋮ in alto a destra',
        'Scegliere «Installa app»',
        'Confermare',
      ],
      note: 'In altri browser: menu → «Aggiungi a schermata Home».',
    },
    desktop: {
      intro: 'In Chrome o Edge:',
      steps: [
        'Aprire il menu del browser ⋮ in alto a destra',
        'Scegliere «Installa KP Front» e confermare',
      ],
      note: 'A seconda della versione la voce è diretta o sotto «Salva e condividi». Se a destra nella barra degli indirizzi appare un’icona di installazione, funziona anche quella. Se manca tutto, KP Front è già installato su questo dispositivo.',
    },
    macSafari: {
      intro: 'In Safari su Mac:',
      steps: [
        'Aprire il menu «File»',
        'Scegliere «Aggiungi al Dock»',
        'Confermare con «Aggiungi»',
      ],
      note: '',
    },
    unsupported: 'Questo browser non supporta l’installazione. Meglio aprire la pagina in Chrome, Edge o Safari e installare lì.',
  },
  meldeleiste: {
    region: 'Messaggi',
    more: '+{n} altro messaggio',
    moreMany: '+{n} altri messaggi',
    less: 'Mostra meno',
  },
  session: {
    expiredTitle: 'Accesso scaduto',
    expiredHint: 'Le modifiche restano su questo dispositivo e si sincronizzano dopo l’accesso',
    expiredHintNamed: 'Le modifiche restano su questo dispositivo e si sincronizzano dopo l’accesso di {name}',
    relogin: 'Accedi di nuovo',
    foreignUnsentTitle: 'Modifiche non trasmesse di {name} su questo dispositivo',
    foreignUnsentSub: '{name} deve accedere qui',
    foreignUnsentFormerSub: 'Restano salvate su questo dispositivo',
    foreignUnsentDismiss: 'Nascondi',
  },
  tabLock: {
    title: 'Aperto in un’altra scheda',
    hint: 'Questa scheda è in sola lettura – la modifica è attiva nell’altra scheda.',
    takeOver: 'Modifica qui',
  },
  demo: {
    ribbon: 'DEMO',
    ariaLabel: 'Istanza dimostrativa con dati fittizi',
    actionBlocked: 'Non possibile nella demo.',
    welcome: {
      title: 'Benvenuto su PC Fronte',
      intro: 'Un intervento preparato con dati fittizi. Disegna, conduci le squadre e prova liberamente la gestione della situazione.',
      reloadWarn: 'Tutti i visitatori lavorano insieme. La demo si azzera a mezzanotte e a mezzogiorno.',
      canTitle: 'Cosa puoi provare',
      can: ['Modificare carta e piano', 'Condurre squadre ARA e materiale', 'Aprire piani d’oggetto e rapporto'],
      cta: 'Si parte',
      meta: 'Nessun dato reale – la creazione di interventi è bloccata',
    },
  },
}
