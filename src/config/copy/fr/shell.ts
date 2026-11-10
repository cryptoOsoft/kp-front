// French copy · the app shell: loading, modes, the nav rail, Trupp finden, the Ebenen panel.
// One slice of the `fr` overlay, assembled in ../fr.ts; the German base is ../de/shell.ts.

import type { Copy, Localizable } from '../index'

type Keys =
  | 'loading' | 'loadingSubtitle' | 'modes' | 'navRail' | 'truppFinder' | 'panels' | 'layerPanel'

export const shellCopy: Localizable<Pick<Copy, Keys>> = {
  loading: 'Chargement …',
  loadingSubtitle: 'Chargement de la carte et de la bibliothèque de symboles …',
  // «Binômes», comme `atemschutz.boardTitle` — la surface porte aussi les binômes sans ARI, et
  // «ARI» au-dessus d’un binôme circulation était faux (voir la note dans de/shell.ts).
  modes: { map: 'Carte', plans: 'Plan', checklists: 'Checklist', atemschutz: 'Binômes', anwesenheit: 'Présence', rapport: 'Rapport',
    mittel: 'Matériel',
  },
  navRail: { map: 'Carte', plansGroup: 'Plans', plansChoose: 'Choisir le plan', pageGroup: 'Choisir la page', assign: 'Attribuer le plan', expand: 'Déplier', collapse: 'Replier', resize: 'Ajuster la barre',
    scrollMore: 'Afficher plus', viewBar: 'Affichage',
  },
  panels: { layers: 'Couches', history: 'Journal' },
  layerPanel: {
    stateVisible: 'visible, masquer',
    stateHidden: 'masqué, afficher',
    opacity: 'Opacité',
    showAll: 'Tout afficher',
    hideAll: 'Tout masquer',
    reset: 'Standard',
    custom: 'Sélection personnalisée',
    loading: 'Chargement …',
    loadingOf: 'Chargement … {done} sur {total}',
    loadEmpty: 'Aucune donnée dans cette couche',
    loadFailed: 'Non chargé – désactiver puis réactiver',
  },

  truppFinder: {
    title: 'Trouver un binôme',
    placeholder: 'Binôme ou nom …',
    noMatches: 'Aucun binôme trouvé',
    empty: 'Aucun binôme placé.',
    emptyHint: 'Les binômes se placent sur la situation ou sur un plan – depuis la fiche du binôme sous «Binômes» ou avec l\'outil binôme.',
    raus: 'sorti',
  },
}
