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
    minutes: '{n} min',
  },
}
