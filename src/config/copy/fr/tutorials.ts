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
    minutes: '{n}\u00A0min',
    summaries: {
      zurechtfinden: 'Recherche, bâtiment, couches, mesurer',
      einsatzEroeffnen: 'Choisir un objet, ouvrir en exercice',
      lageZeichnen: 'Véhicule, conduite, périmètre, note',
      planGebaeude: 'Ouvrir un plan, placer un symbole, changer d’étage',
      tafel: 'Remplir un formulaire, esquisser, nouvelle page',
      checkliste: 'Cocher, jalon, dessiner depuis la liste',
      trupps: 'Annoncer, contact radio, mission, retrait',
      notfall: 'Déclencher l’urgence, groupe de sécurité, terminer',
      anwesenheit: 'Annoncer présent, attribuer, service',
      material: 'Du catalogue, provenance, remarque',
      verlauf: 'Message, tâche ouverte, correction',
      rapport: 'Données d’intervention, fiche, clôture',
      nachschlagen: 'Chercher un appareil, ouvrir un chapitre',
      wiedergabe: 'Revenir en arrière, retour au direct, hors ligne',
      objektbesuch: 'Démarrer une visite, répondre aux questions',
    },
    sheet: {
      lede: 'Sur les vrais boutons – l’app remarque quand une étape est faite. ✓ = fait sur cet appareil.',
      filterLabel: 'Filtrer par fonction',
      all: 'Tous',
      chips: {
        fu: 'Appui à la conduite',
        el: 'Conduite d’intervention',
        as: 'ARI',
      },
      doneCount: '{done} sur {n} faits',
      done: 'Fait',
      resume: 'Reprendre',
      interrupted: 'Interrompu · étape {n}',
      running: 'En cours · étape {n}',
      tagOffline: 'hors ligne',
      tagUebung: 'Exercice d’apprentissage',
    },
    help: {
      try: 'Essayer',
      what: '{title}\u00A0· {minutes}',
    },
  },
}
