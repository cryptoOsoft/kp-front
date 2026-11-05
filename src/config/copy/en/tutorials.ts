// English copy · «Üben»: the tutorial catalogue, tracks, start sheet and the Hilfe's «Ausprobieren».
// One slice of the `en` overlay, assembled in ../en.ts; the German base is ../de/tutorials.ts.

import type { Copy, Localizable } from '../index'

export const tutorialsCopy: Localizable<Pick<Copy, 'tutorials'>> = {
  tutorials: {
    menu: 'Practise',
    titles: {
      zurechtfinden: 'Finding your way',
      einsatzEroeffnen: 'Open an incident',
      lageZeichnen: 'Map – drawing the situation',
      planGebaeude: 'Plan & building',
      tafel: 'Board',
      checkliste: 'Checklist during an incident',
      trupps: 'Teams',
      notfall: 'SCBA emergency',
      anwesenheit: 'Attendance & schedule',
      material: 'Material',
      verlauf: 'Log',
      rapport: 'Report & closing',
      nachschlagen: 'Looking up checklists & manuals',
      wiedergabe: 'Replay, offline, second device',
      objektbesuch: 'Object visit',
    },
    tracks: {
      fu: 'Command support',
      el: 'Incident command',
      as: 'SCBA monitoring',
      alle: 'For everyone',
    },
    minutes: '{n} min',
  },
}
