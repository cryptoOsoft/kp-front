// English copy · the running tutorial (pill, step card, step list, done card).
// One slice of the `en` overlay, assembled in ../en.ts; the German base is ../de/tutorialRun.ts.

import type { Copy, Localizable } from '../index'

export const tutorialRunCopy: Localizable<Pick<Copy, 'tutorialRun'>> = {
  tutorialRun: {
    pill: 'Practise {n}/{m}',
    skip: 'Skip',
    next: 'Next',
    show: 'Show',
    quit: 'End',
  },
}
