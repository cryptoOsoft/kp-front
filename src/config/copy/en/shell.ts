// English copy · the app shell: loading, modes, the nav rail, Trupp finden, the Ebenen panel.
// One slice of the `en` overlay, assembled in ../en.ts; the German base is ../de/shell.ts.

import type { Copy, Localizable } from '../index'

type Keys =
  | 'loading' | 'loadingSubtitle' | 'modes' | 'navRail' | 'truppFinder' | 'panels' | 'layerPanel'

export const shellCopy: Localizable<Pick<Copy, Keys>> = {
  loading: 'Loading …',
  loadingSubtitle: 'Loading map & symbol library …',
  // «Teams», matching `atemschutz.boardTitle` — the surface carries work squads too, so naming it
  // «SCBA» told a traffic-control team it was in the wrong place (see de/shell.ts for the full note).
  modes: { map: 'Map', plans: 'Plan', checklists: 'Checklist', atemschutz: 'Teams', anwesenheit: 'Attendance', mittel: 'Material', rapport: 'Report' },
  navRail: { map: 'Map', plansGroup: 'Plans', plansChoose: 'Choose plan', pageGroup: 'Choose page', assign: 'Assign plan', expand: 'Expand', collapse: 'Collapse', resize: 'Resize bar',
    scrollMore: 'Show more', viewBar: 'View',
  },
  panels: { layers: 'Layers', history: 'Log' },
  layerPanel: {
    stateVisible: 'visible, hide',
    stateHidden: 'hidden, show',
    opacity: 'Opacity',
    showAll: 'Show all',
    hideAll: 'Hide all',
    reset: 'Default',
    custom: 'Custom',
    // a GeoJSON layer (pipes, hydrants …) downloads a multi-megabyte file: the row says how far
    // it has got, with figures once the server sends a size, otherwise with the loader alone
    loading: 'Loading …',
    loadingOf: 'Loading … {done} of {total}',
    loadEmpty: 'No data in this layer',
    loadFailed: 'Not loaded – switch off and on to retry',
  },

  truppFinder: {
    title: 'Find a team',
    placeholder: 'Team or name …',
    noMatches: 'No team found',
    empty: 'No team placed yet.',
    emptyHint: 'Teams are placed on the situation or on a plan — from the team card under «Teams» or with the team tool.',
    raus: 'out',
  },
}
