// Italian copy · the running tutorial (pill, step card, step list, done card, the steps).
// One slice of the `it` overlay, assembled in ../it.ts; the German base is ../de/tutorialRun.ts.

import type { Copy, Localizable } from '../index'

export const tutorialRunCopy: Localizable<Pick<Copy, 'tutorialRun'>> = {
  tutorialRun: {
    pill: 'Esercitarsi {n}/{m}',
    pillOpen: 'Tutti i passi',
    pause: 'Pausa',
    paused: 'In pausa – si continua sotto «Esercitarsi».',
    skip: 'Salta',
    next: 'Avanti',
    show: 'Mostra',
    quit: 'Termina',
    stepOf: '{n}/{m}',
    soon: 'Subito: {step}',
    goTo: 'Si continua su «{surface}».',
    goToHint: 'Toccalo nella barra in basso.',
    goToHintRail: 'Toccalo nella barra a sinistra.',
    manualTag: 'Avanti',
    skippedTag: 'saltato',
    sandboxFailed: 'Impossibile creare l\'esercitazione di apprendimento – ci si esercita su questa esercitazione.',
    sandboxRefused: 'Impossibile creare l\'esercitazione di apprendimento. Ci si esercita solo su un\'esercitazione – riprova più tardi.',
    notYet: '«{title}» è ancora in preparazione – presto qui.',
    done: {
      title: 'Fatto – {title}',
      ended: 'Terminato – {title}',
      sub: '{n} passi su {m} · {t} min',
      uebungNote: 'L\'esercitazione «{incident}» non serve più.',
      delete: 'Elimina esercitazione',
      keep: 'Tieni',
      close: 'Chiudi',
      continueWith: 'Continua con',
      deleteFailed: 'Impossibile eliminare l\'esercitazione – resta in «Tutti gli interventi».',
    },
    steps: {
      lageZeichnen: {
        place: {
          title: 'Mettere un\'autopompa sulla carta',
          instruction: 'Metti un\'autopompa (TLF) sulla carta.',
          hint: '«Simbolo» nella barra degli strumenti, cerca «TLF», poi tocca la carta.',
          hintPhone: '«Aggiungi», cerca «TLF», poi tocca la carta.',
          done: 'Autopompa posata',
        },
        move: {
          title: 'Spostare l\'autopompa al focolaio',
          instruction: 'Sposta l\'autopompa al focolaio.',
          hint: 'Con «Selezione», trascina l\'autopompa.',
          done: 'Autopompa spostata',
        },
        line: {
          title: 'Condotta dall\'autopompa all\'idrante',
          instruction: 'Traccia una condotta dall\'autopompa all\'idrante.',
          hint: '«Linea» nella barra degli strumenti, poi tocca autopompa e idrante.',
          hintPhone: '«Aggiungi» → «Linea», poi tocca autopompa e idrante.',
          done: 'Condotta tracciata',
        },
        circle: {
          title: 'Perimetro intorno al focolaio',
          instruction: 'Traccia un perimetro di sicurezza intorno al focolaio.',
          hint: '«Perimetro di sicurezza», poi trascina dal focolaio verso l\'esterno.',
          hintPhone: '«Aggiungi» → «Perimetro di sicurezza», poi trascina dal focolaio verso l\'esterno.',
          done: 'Perimetro tracciato',
        },
        note: {
          title: 'Una nota all\'accesso',
          instruction: 'Scrivi una nota all\'accesso.',
          hint: '«Nota», tocca l\'accesso e scrivi.',
          hintPhone: '«Aggiungi» → «Nota», tocca l\'accesso e scrivi.',
          done: 'Nota posata',
        },
        undoRedo: {
          title: 'Annulla, poi ripeti',
          instruction: 'Annulla l\'ultimo passo – e poi ripetilo.',
          hint: '↶ nella barra in alto, poi ↷. Vale per ogni pagina dell\'intervento.',
          done: 'Annullato e ripetuto',
        },
        theme: {
          title: 'Vista diurna e notturna',
          instruction: 'Per la notte c\'è uno schema di colori scuro.',
          hint: 'Menu dell\'intervento → Impostazioni → Schema di colori. «Automatico» cambia da solo al crepuscolo.',
          done: 'Schema di colori trovato',
        },
      },
    },
  },
}
