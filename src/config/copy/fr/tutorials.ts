// French copy · «Üben»: the tutorial catalogue, tracks, start sheet and the Hilfe's «Ausprobieren».
// One slice of the `fr` overlay, assembled in ../fr.ts; the German base is ../de/tutorials.ts.

import type { Copy, Localizable } from '../index'

export const tutorialsCopy: Localizable<Pick<Copy, 'tutorials'>> = {
  tutorials: {
    menu: 'S\'exercer',
    titles: {
      zurechtfinden: 'S\'orienter',
      einsatzEroeffnen: 'Ouvrir une intervention',
      lageZeichnen: 'Carte – dessiner la situation',
      planGebaeude: 'Plan & bâtiment',
      tafel: 'Tableau',
      checkliste: 'Check-list en intervention',
      trupps: 'Groupes',
      notfall: 'Urgence ARI',
      anwesenheit: 'Présence & horaire',
      material: 'Matériel',
      verlauf: 'Journal',
      rapport: 'Rapport & clôture',
      nachschlagen: 'Consulter check-lists & modes d’emploi',
      wiedergabe: 'Relecture, hors ligne, deuxième appareil',
      objektbesuch: 'Visite d’objet',
    },
    tracks: {
      fu: 'Appui à la conduite',
      el: 'Conduite d’intervention',
      as: 'Surveillance ARI',
      alle: 'Pour tous',
    },
    minutes: '{n} min',
  },
}
