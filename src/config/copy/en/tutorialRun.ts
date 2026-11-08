// English copy · the running tutorial (pill, step card, step list, done card, the steps).
// One slice of the `en` overlay, assembled in ../en.ts; the German base is ../de/tutorialRun.ts.

import type { Copy, Localizable } from '../index'

export const tutorialRunCopy: Localizable<Pick<Copy, 'tutorialRun'>> = {
  tutorialRun: {
    pill: 'Practise {n}/{m}',
    pillOpen: 'All steps',
    pause: 'Pause',
    paused: 'Paused – carry on under «Practise».',
    skip: 'Skip',
    next: 'Next',
    show: 'Show',
    quit: 'End',
    stepOf: '{n}/{m}',
    soon: 'Next up: {step}',
    goTo: 'This continues on «{surface}».',
    goToHint: 'Tap it in the bar below.',
    goToHintRail: 'Tap it in the bar on the left.',
    manualTag: 'Next',
    skippedTag: 'skipped',
    sandboxFailed: 'Could not create the practice exercise – practising on this exercise instead.',
    sandboxRefused: 'Could not create the practice exercise. Practising only runs on an exercise – please try again later.',
    notYet: '«{title}» is still being built – coming soon.',
    done: {
      title: 'Done – {title}',
      ended: 'Ended – {title}',
      sub: '{n} of {m} steps · {t} min',
      uebungNote: 'The exercise «{incident}» is no longer needed.',
      delete: 'Delete exercise',
      keep: 'Keep',
      close: 'Close',
      continueWith: 'Continue with',
      deleteFailed: 'Could not delete the exercise – it stays in «All incidents».',
    },
    steps: {
      lageZeichnen: {
        place: {
          title: 'Put a tender on the map',
          instruction: 'Put a tender (TLF) on the map.',
          hint: '«Symbol» in the tool bar, search «TLF», then tap the map.',
          hintPhone: '«Add», search «TLF», then tap the map.',
          done: 'Tender placed',
        },
        move: {
          title: 'Move the tender to the fire',
          instruction: 'Move the tender to the fire.',
          hint: 'With «Select», drag the tender.',
          done: 'Tender moved',
        },
        line: {
          title: 'Hose line from tender to hydrant',
          instruction: 'Draw a hose line from the tender to the hydrant.',
          hint: '«Line» in the tool bar, then tap the tender and the hydrant.',
          hintPhone: '«Add» → «Line», then tap the tender and the hydrant.',
          done: 'Line drawn',
        },
        circle: {
          title: 'Cordon around the fire',
          instruction: 'Drag a cordon around the fire.',
          hint: '«Cordon», then drag outwards from the fire.',
          hintPhone: '«Add» → «Cordon», then drag outwards from the fire.',
          done: 'Cordon drawn',
        },
        note: {
          title: 'A note at the access road',
          instruction: 'Write a note at the access road.',
          hint: '«Note», tap the access road and type.',
          hintPhone: '«Add» → «Note», tap the access road and type.',
          done: 'Note placed',
        },
        undoRedo: {
          title: 'Undo, then redo',
          instruction: 'Take the last step back – and bring it back again.',
          hint: '↶ in the top bar, then ↷. It works on every page of the incident.',
          done: 'Back and here again',
        },
        theme: {
          title: 'Day and night view',
          instruction: 'For the night there is a dark colour scheme.',
          hint: 'Incident menu → Settings → Colour scheme. «Automatic» switches at dusk by itself.',
          done: 'Colour scheme found',
        },
      },
    },
  },
}
