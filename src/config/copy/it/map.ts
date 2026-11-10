// Italian copy · the Karte: tools, nav, views, hints.
// One slice of the `it` overlay, assembled in ../it.ts; the German base is ../de/map.ts.

import type { Copy, Localizable } from '../index'

type Keys =
  | 'mapTools' | 'planTools' | 'nav' | 'mapViews' | 'toast' | 'dockHints' | 'map'

export const mapCopy: Localizable<Pick<Copy, Keys>> = {
  mapTools: [
    { id: 'select', icon: 'select', label: 'Selezione', kind: 'tool', alt: { id: 'lasso', icon: 'marquee', label: 'Multiplo' } },
    { id: 'symbol-slot', slot: true, icon: '', label: '' },
    { id: 'line', icon: 'pen', label: 'Linea', kind: 'tool' },
    { id: 'area', icon: 'area', label: 'Superficie', kind: 'tool' },
    { id: 'circle', icon: 'circle', label: 'Perimetro di sicurezza', kind: 'tool' },
    { id: 'note', icon: 'type', label: 'Nota', kind: 'tool' },
    { id: 'team', icon: 'flag', label: 'Squadra', kind: 'tool' },
    { id: 'measure', icon: 'measure', label: 'Misura', kind: 'tool' },
  ],
  planTools: [
    { id: 'pan', icon: 'select', label: 'Selezione', alt: { id: 'lasso', icon: 'marquee', label: 'Multiplo' } },
    { id: 'symbol-slot', slot: true, icon: '', label: '' },
    { id: 'line', icon: 'pen', label: 'Linea' },
    { id: 'area', icon: 'area', label: 'Superficie' },
    { id: 'circle', icon: 'circle', label: 'Perimetro di sicurezza' },
    { id: 'text', icon: 'type', label: 'Nota' },
    { id: 'resource', icon: 'flag', label: 'Squadra' },
    { id: 'measure', icon: 'measure', label: 'Misura' },
  ],
  nav: {
    zoomIn: 'Ingrandisci',
    zoomOut: 'Riduci',
    fit: 'Adatta',
    resetNorth: 'Orienta a nord',
    centerIncident: 'Centra sull’intervento',
    coords: 'Rileva coordinate',
    coordsHint: 'Tocca la carta per fissare',
    coordsLocked: 'Fissato – ✕ per terminare',
    coordsExit: 'Chiudi coordinate',
    autoMode: 'Automatico',
    deviceMode: 'Dispositivo',
    dayMode: 'Giorno',
    nightMode: 'Notte',
  },
  toast: {
    audioSaved: 'Nota audio salvata ({secs}s)',
    micDenied: 'Nessun accesso al microfono – annotato come segnaposto',
    micFailed: 'Impossibile avviare la registrazione',
    merged: 'Modifiche unite',
  },
  dockHints: {
    lasso: 'Trascina con un dito un riquadro attorno a più oggetti. Con due dita la carta continua a spostarsi. Toccando di nuovo «Multiplo» si torna alla Selezione.',
    line: 'Trascina sulla carta o tocca i punti per disegnare una linea. Colore, spessore e stile si scelgono poi nell’editor.',
    lineFreehand: 'Trascina per disegnare una linea. Per singoli punti: «Punti». Colore, spessore e stile si scelgono poi nell’editor.',
    lineNodes: 'Tocca i punti, concludi con ✓. Colore, spessore e stile si scelgono poi nell’editor.',
    area: 'Trascinando si disegna il contorno a mano libera – per un fronte di fuoco senza angoli. Oppure tocca almeno tre vertici, concludi con ✓.',
    circle: 'Trascina dal centro verso il bordo per impostare il raggio in metri. Raggio e riempimento si regolano poi nell’editor.',
    note: 'Tocca la carta per inserire una nota.',
    shape: 'Tocca la carta per posizionare la forma. Attiva «Posiziona più» per metterne più di seguito.',
    rotationStart: 'Toccare il primo punto — dove si preleva l’acqua. Tenere premuto su un simbolo finché l’anello si chiude per posare il punto esattamente lì.',
    rotationEnd: 'Toccare il secondo punto — l’incendio. Toccando due volte lo stesso punto si posa una Rotazione di lunghezza standard.',
    measure: 'Tocca i punti sulla carta. La distanza mostra lunghezza e profilo altimetrico, la superficie mostra area e perimetro. Trascina i punti per spostarli, il + al centro di un segmento inserisce un punto intermedio, tieni premuto un punto (clic destro sul computer) per rimuoverlo.',

    team: 'Tocca la carta e scegli la squadra dall\'elenco. Trascina per spostarla.',
  },
  map: {
    incidentHere: 'Luogo d’intervento',
    youHere: 'La mia posizione',
    glLost: 'Visualizzazione della mappa interrotta',
    glLostHint: 'Il dispositivo ha rilasciato il contesto grafico della mappa. Le tue voci sono salvate.',
    glLostAction: 'Ricostruisci mappa',
    noTilesTitle: 'Nessuna mappa di base salvata per questa zona',
    noTilesSub: 'Offline – oggetti e linee sono mostrati senza mappa',
    noTilesAction: 'Prontezza offline',
    noTilesDismiss: 'Nascondi',
  },
  mapViews: {
    title: 'Viste',
    north: 'Verso nord',
    fit: 'Adatta',
    locate: 'La mia posizione',
    save: 'Salva la vista',
    hint: 'Una vista salva la carta com\'è – posizione, zoom e rotazione. Tocca una vista salvata per saltarci (p. es. tra una panoramica a nord e la carta girata come sei posizionato). Pressione lunga sulla bussola: adatta subito.',
    rename: 'Rinomina',
    delete: 'Elimina',
    saved: 'Vista salvata',
    deleteTitle: 'Elimina la vista',
    deleteMsg: 'Eliminare «{name}»?',
  },
}
