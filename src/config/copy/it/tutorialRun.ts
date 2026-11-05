// Italian copy · the running tutorial (pill, step card, step list, done card).
// One slice of the `it` overlay, assembled in ../it.ts; the German base is ../de/tutorialRun.ts.

import type { Copy, Localizable } from '../index'

export const tutorialRunCopy: Localizable<Pick<Copy, 'tutorialRun'>> = {
  tutorialRun: {
    pill: 'Esercitarsi {n}/{m}',
    skip: 'Salta',
    next: 'Avanti',
    show: 'Mostra',
    quit: 'Termina',
  },
}
