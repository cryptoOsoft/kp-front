// French copy · the running tutorial (pill, step card, step list, done card).
// One slice of the `fr` overlay, assembled in ../fr.ts; the German base is ../de/tutorialRun.ts.

import type { Copy, Localizable } from '../index'

export const tutorialRunCopy: Localizable<Pick<Copy, 'tutorialRun'>> = {
  tutorialRun: {
    pill: 'S\'exercer {n}/{m}',
    skip: 'Passer',
    next: 'Suivant',
    show: 'Montrer',
    quit: 'Terminer',
  },
}
