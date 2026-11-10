// Italian copy · the app shell: loading, modes, the nav rail, Trupp finden, the Ebenen panel.
// One slice of the `it` overlay, assembled in ../it.ts; the German base is ../de/shell.ts.

import type { Copy, Localizable } from '../index'

type Keys =
  | 'loading' | 'loadingSubtitle' | 'modes' | 'navRail' | 'truppFinder' | 'panels' | 'layerPanel'

export const shellCopy: Localizable<Pick<Copy, Keys>> = {
  loading: 'Caricamento …',
  loadingSubtitle: 'Caricamento mappa e libreria simboli …',
  // «Squadre», come `atemschutz.boardTitle` — la superficie porta anche le squadre senza APR, e
  // «Autoprotezione» sopra una squadra viabilità era semplicemente falso (vedi la nota in de/shell.ts).
  modes: { map: 'Mappa', plans: 'Piano', checklists: 'Checklist', atemschutz: 'Squadre', anwesenheit: 'Presenza', rapport: 'Rapporto',
    mittel: 'Materiale',
  },
  navRail: { map: 'Mappa', plansGroup: 'Piani', plansChoose: 'Scegli piano', pageGroup: 'Scegli pagina', assign: 'Assegna piano', expand: 'Espandi', collapse: 'Comprimi', resize: 'Adatta barra',
    scrollMore: 'Mostra altri', viewBar: 'Visualizzazione',
  },
  panels: { layers: 'Livelli', history: 'Diario' },
  layerPanel: {
    stateVisible: 'visibile, nascondi',
    stateHidden: 'nascosto, mostra',
    opacity: 'Opacità',
    showAll: 'Mostra tutti',
    hideAll: 'Nascondi tutti',
    reset: 'Standard',
    custom: 'Selezione personalizzata',
    loading: 'Caricamento …',
    loadingOf: 'Caricamento … {done} di {total}',
    loadEmpty: 'Nessun dato in questo livello',
    loadFailed: 'Non caricato – disattivare e riattivare',
  },

  truppFinder: {
    title: 'Trova una squadra',
    placeholder: 'Squadra o nome …',
    noMatches: 'Nessuna squadra trovata',
    empty: 'Nessuna squadra posata.',
    emptyHint: 'Le squadre si posano sulla situazione o su un piano – dalla scheda della squadra sotto «Squadre» o con lo strumento squadra.',
    raus: 'uscito',
  },
}
