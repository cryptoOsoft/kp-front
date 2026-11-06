// French copy · the running tutorial (pill, step card, step list, done card, the steps).
// One slice of the `fr` overlay, assembled in ../fr.ts; the German base is ../de/tutorialRun.ts.

import type { Copy, Localizable } from '../index'

export const tutorialRunCopy: Localizable<Pick<Copy, 'tutorialRun'>> = {
  tutorialRun: {
    pill: 'S\'exercer {n}/{m}',
    pillOpen: 'Toutes les étapes',
    pause: 'Pause',
    paused: 'En pause – reprendre sous «S\'exercer».',
    skip: 'Passer',
    next: 'Suivant',
    show: 'Montrer',
    quit: 'Terminer',
    stepOf: '{n}/{m}',
    soon: 'Ensuite : {step}',
    goTo: 'La suite se passe sur «{surface}».',
    goToHint: 'Touchez-le dans la barre en bas.',
    goToHintRail: 'Touchez-le dans la barre à gauche.',
    manualTag: 'Suivant',
    skippedTag: 'passée',
    sandboxFailed: 'Impossible de créer l\'exercice d\'apprentissage – on s\'exerce sur cet exercice.',
    sandboxRefused: 'Impossible de créer l\'exercice d\'apprentissage. On ne s\'exerce que sur un exercice – réessayez plus tard.',
    done: {
      title: 'Réussi – {title}',
      ended: 'Terminé – {title}',
      sub: '{n} étapes sur {m} · {t} min',
      uebungNote: 'L\'exercice «{incident}» n\'est plus nécessaire.',
      delete: 'Supprimer l\'exercice',
      keep: 'Garder',
      close: 'Fermer',
      continueWith: 'Continuer avec',
      deleteFailed: 'Impossible de supprimer l\'exercice – il reste dans «Toutes les interventions».',
    },
    steps: {
      lageZeichnen: {
        place: {
          title: 'Placer un TP sur la carte',
          instruction: 'Placez un tonne-pompe (TLF) sur la carte.',
          hint: '«Symbole» dans la barre d\'outils, cherchez «TLF», puis touchez la carte.',
          hintPhone: '«Ajouter», cherchez «TLF», puis touchez la carte.',
          done: 'TP placé',
        },
        move: {
          title: 'Déplacer le TP vers le foyer',
          instruction: 'Déplacez le TP vers le foyer.',
          hint: 'Avec «Sélection», faites glisser le TP.',
          done: 'TP déplacé',
        },
        line: {
          title: 'Conduite du TP à la borne',
          instruction: 'Tracez une conduite du TP à la borne hydrante.',
          hint: '«Ligne» dans la barre d\'outils, puis touchez le TP et la borne.',
          hintPhone: '«Ajouter» → «Ligne», puis touchez le TP et la borne.',
          done: 'Conduite tracée',
        },
        circle: {
          title: 'Périmètre autour du foyer',
          instruction: 'Tirez un périmètre de sécurité autour du foyer.',
          hint: '«Périmètre de sécurité», puis tirez depuis le foyer vers l\'extérieur.',
          hintPhone: '«Ajouter» → «Périmètre de sécurité», puis tirez depuis le foyer vers l\'extérieur.',
          done: 'Périmètre tracé',
        },
        note: {
          title: 'Une note à l\'accès',
          instruction: 'Écrivez une note à l\'accès.',
          hint: '«Note», touchez l\'accès et écrivez.',
          hintPhone: '«Ajouter» → «Note», touchez l\'accès et écrivez.',
          done: 'Note placée',
        },
        undoRedo: {
          title: 'Annuler, puis rétablir',
          instruction: 'Annulez la dernière étape – puis rétablissez-la.',
          hint: '↶ dans la barre du haut, puis ↷. Valable sur chaque page de l\'intervention.',
          done: 'Annulé et rétabli',
        },
        theme: {
          title: 'Vue de jour et de nuit',
          instruction: 'Pour la nuit, il existe un schéma de couleurs sombre.',
          hint: 'Menu de l\'intervention → Réglages → Schéma de couleurs. «Automatique» bascule seul au crépuscule.',
          done: 'Schéma de couleurs trouvé',
        },
      },
    },
  },
}
