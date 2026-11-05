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
    minutes: '{n}\u00A0min',
    summaries: {
      zurechtfinden: 'Search, building, layers, measuring',
      einsatzEroeffnen: 'Pick an object, open it as an exercise',
      lageZeichnen: 'Vehicle, line, cordon, note',
      planGebaeude: 'Open a plan, place a symbol, change storey',
      tafel: 'Fill in a form, sketch, add a page',
      checkliste: 'Tick off, milestone, draw from the list',
      trupps: 'Register, radio contact, task, withdrawal',
      notfall: 'Raise the emergency, rescue team, end it',
      anwesenheit: 'Mark present, assign, shift',
      material: 'From the catalogue, source, remark',
      verlauf: 'Message, open item, correction',
      rapport: 'Incident data, record sheet, closing',
      nachschlagen: 'Search a device, open a chapter',
      wiedergabe: 'Rewind, back to live, offline readiness',
      objektbesuch: 'Start a visit, answer questions',
    },
    sheet: {
      lede: 'On the real buttons – the app notices when a step is done. ✓ = done on this device.',
      filterLabel: 'Filter by role',
      all: 'All',
      chips: {
        fu: 'Command support',
        el: 'Incident command',
        as: 'SCBA',
      },
      doneCount: '{done} of {n} done',
      done: 'Done',
      resume: 'Resume',
      interrupted: 'Interrupted · step {n}',
      running: 'Running · step {n}',
      tagOffline: 'offline',
      tagUebung: 'Practice exercise',
    },
    help: {
      try: 'Try it',
      what: '{title}\u00A0· {minutes}',
    },
  },
}
