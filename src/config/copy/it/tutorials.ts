// Italian copy · «Üben»: the tutorial catalogue, tracks, start sheet and the Hilfe's «Ausprobieren».
// One slice of the `it` overlay, assembled in ../it.ts; the German base is ../de/tutorials.ts.

import type { Copy, Localizable } from '../index'

export const tutorialsCopy: Localizable<Pick<Copy, 'tutorials'>> = {
  tutorials: {
    menu: 'Esercitarsi',
    titles: {
      zurechtfinden: 'Orientarsi',
      einsatzEroeffnen: 'Aprire un intervento',
      lageZeichnen: 'Mappa – disegnare la situazione',
      planGebaeude: 'Piano & edificio',
      tafel: 'Lavagna',
      checkliste: 'Check-list in intervento',
      trupps: 'Squadre',
      notfall: 'Emergenza APR',
      anwesenheit: 'Presenze & orario',
      material: 'Materiale',
      verlauf: 'Giornale',
      rapport: 'Rapporto & chiusura',
      nachschlagen: 'Consultare check-list & istruzioni',
      wiedergabe: 'Replay, offline, secondo dispositivo',
      objektbesuch: 'Visita oggetto',
    },
    tracks: {
      fu: 'Supporto alla condotta',
      el: 'Condotta d’intervento',
      as: 'Sorveglianza APR',
      alle: 'Per tutti',
    },
    minutes: '{n}\u00A0min',
    summaries: {
      zurechtfinden: 'Ricerca, edificio, livelli, misurare',
      einsatzEroeffnen: 'Scegliere un oggetto, aprire come esercizio',
      lageZeichnen: 'Veicolo, condotta, perimetro, nota',
      planGebaeude: 'Aprire un piano, posare un simbolo, cambiare piano',
      tafel: 'Compilare un modulo, schizzare, nuova pagina',
      checkliste: 'Spuntare, traguardo, disegnare dalla lista',
      trupps: 'Annunciare, contatto radio, compito, ritiro',
      notfall: 'Dare l’emergenza, squadra di sicurezza, terminare',
      anwesenheit: 'Segnare presente, assegnare, turno',
      material: 'Dal catalogo, provenienza, osservazione',
      verlauf: 'Messaggio, pendenza, correzione',
      rapport: 'Dati d’intervento, scheda, chiusura',
      nachschlagen: 'Cercare un apparecchio, aprire un capitolo',
      wiedergabe: 'Riavvolgere, tornare al live, offline',
      objektbesuch: 'Avviare una visita, rispondere alle domande',
    },
    sheet: {
      lede: 'Sui pulsanti veri – l’app nota quando un passo è fatto. ✓ = fatto su questo dispositivo.',
      filterLabel: 'Filtrare per funzione',
      all: 'Tutti',
      chips: {
        fu: 'Supporto alla condotta',
        el: 'Condotta d’intervento',
        as: 'APR',
      },
      doneCount: '{done} di {n} fatti',
      done: 'Fatto',
      resume: 'Riprendere',
      interrupted: 'Interrotto · passo {n}',
      running: 'In corso · passo {n}',
      tagOffline: 'offline',
      tagUebung: 'Esercizio di prova',
    },
    help: {
      try: 'Provare',
      what: '{title}\u00A0· {minutes}',
    },
  },
}
