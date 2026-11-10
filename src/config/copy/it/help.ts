// Italian copy · the «Funktionen & Hilfe» overlay.
// One slice of the `it` overlay, assembled in ../it.ts; the German base is ../de/help.ts.

import type { Copy, Localizable } from '../index'

export const helpCopy: Localizable<Pick<Copy, 'help'>> = {
  help: {
    menu: 'Funzioni e aiuto',
    title: 'Cosa può fare KP Front?',
    contents: 'Indice',
    close: 'Chiudi',
    introFallback: 'KP Front è la conduzione digitale della situazione e dell’intervento dei tuoi pompieri: carta della situazione tattica, piani degli oggetti, sorveglianza dell’autoprotezione e un diario condiviso – tutto in tempo reale su più dispositivi contemporaneamente.',
    sections: [
      {
        id: 'ueberblick', title: 'Panoramica', icon: 'info',
        blocks: [
          { kind: 'intro' },
          { kind: 'sub', text: 'Le quattro aree di lavoro (barra sinistra)', only: 'wide' },
          { kind: 'sub', text: 'Le aree di lavoro (barra in basso)', only: 'phone' },
          { kind: 'list', items: [
            '**Situazione** – la carta tattica con simboli, linee, superfici e i livelli delle condotte.',
            '**Piano** – i piani degli oggetti (Moduli 1–6, sagome degli edifici) come lavagna, piano per piano.',
            '**Checklist** – checklist d’intervento eseguibili.',
            '**Squadre** – sorveglianza delle squadre impiegate con tempo e pressione, con e senza autoprotezione.',
          ] },
          { kind: 'note', text: 'Principio guida: utilizzabile alle 3 di notte, dopo sei mesi senza pratica. Riconoscere invece di ricordare, usabile con i guanti e offline.' },
        ],
      },
      {
        id: 'karte-objekte', title: 'Mappa & oggetti – senza intervento', icon: 'pin',
        blocks: [
          { kind: 'lead', text: 'Senza un intervento aperto, KP Front arriva qui: la carta del corpo con tutti i suoi oggetti, per consultare e prepararsi. Non è un intervento – misurare, segnare e consultare avviene solo su questo dispositivo, e nulla viene salvato.' },
          { kind: 'sub', text: 'Ricerca e oggetti' },
          { kind: 'list', items: [
            'Il campo in alto cerca **indirizzi e oggetti**. Un risultato apre le sue informazioni: pericoli, idranti vicini e i **piani d’oggetto**.',
            'Ogni oggetto è contornato sulla carta con i suoi edifici e porta il suo nome; toccarlo lo apre. Toccare un altro edificio mostra ciò che il registro ne sa.',
            'I piani dell’oggetto scelto stanno nella barra sinistra e si aprono nello stesso lettore di piani dell’intervento – solo in lettura. Il pulsante in basso a sinistra riporta all’oggetto.',
          ], only: 'wide' },
          { kind: 'list', items: [
            'La ricerca in alto a destra trova **indirizzi e oggetti**. Un risultato apre le sue informazioni: pericoli, idranti vicini e i **piani d’oggetto**.',
            'Ogni oggetto è contornato sulla carta con i suoi edifici e porta il suo nome; toccarlo lo apre. Toccare un altro edificio mostra ciò che il registro ne sa.',
            'I piani sono righe nelle informazioni dell’oggetto e si aprono nello stesso lettore di piani dell’intervento – solo in lettura. «Indietro» in basso riporta alla carta.',
          ], only: 'phone' },
          { kind: 'list', items: [
            '**Visita oggetto** e **Segnala** nelle informazioni avviano il rilevamento, dove il corpo lo ha predisposto.',
          ] },
          { kind: 'sub', text: 'Strumenti' },
          { kind: 'list', items: [
            '**Posa punto** – un punto con indirizzo e coordinate (LV95 + WGS84) da copiare. Anche una pressione lunga sulla carta libera ne posa uno.',
            '**Misura** – distanza o area.',
            '**Merci pericolose** – inserire il numero ONU: le indicazioni ADR/ERG e le distanze come cerchi attorno al punto scelto.',
            '**Livelli** – condotte, idranti, radar meteo e i dati della stazione; un’impostazione propria, indipendente da ogni intervento.',
            '**Checklist** – le checklist e le guide degli apparecchi del corpo da leggere, con una ricerca propria.',
          ] },
          { kind: 'list', only: 'keyboard', items: [
            'Con la tastiera: tutte le scorciatoie di questa vista in **Scorciatoie da tastiera** › «Mappa & oggetti».',
          ] },
          { kind: 'note', text: 'Quando un intervento è in corso, compare nella barra in alto – rosso, arancione per un esercizio – e un tocco lo apre. Un allarme viene mostrato, ma mai aperto da sé.' },
        ],
      },
      {
        id: 'navigation', title: 'Navigazione e interfaccia', icon: 'cursor',
        blocks: [
          { kind: 'lead', text: 'Tre zone fisse: la barra delle aree a sinistra, la barra dell’intervento in alto, la barra degli strumenti a destra.', only: 'wide' },
          { kind: 'lead', text: 'Due barre in basso, una in alto: in fondo la barra delle aree, sopra la barra degli strumenti, in alto la barra dell’intervento.', only: 'phone' },
          { kind: 'sub', text: 'Barre in basso', only: 'phone' },
          { kind: 'list', only: 'phone', items: [
            'La **barra delle aree** in fondo ha cinque caselle: Carta, Piani, Checklist, Squadre e Rapporto. **Piani** e **Rapporto** raggruppano più pagine (Rapporto, Presenza, Materiale): toccare di nuovo la casella o tenerla premuta apre la scelta.',
            'Sopra, la **barra degli strumenti** della carta o del piano. **+** è l’unica porta verso tutto ciò che vi si posiziona.',
            'Un pulsante che porta solo un simbolo dice il suo nome quando lo si **tiene premuto**. Nelle **Impostazioni**, «Etichette delle barre» scrive le parole sotto in modo permanente.',
          ] },
          { kind: 'sub', text: 'Barra sinistra', only: 'wide' },
          { kind: 'list', items: [
            'Cambia area di lavoro: **Mappa** (Situazione), i **Piani** (Moduli/edifici), **Checklist**, **Autoprotezione**.',
            'Trascinando il bordo destro della barra la si espande con le etichette o la si richiude.',
          ], only: 'wide' },
          { kind: 'sub', text: 'Barra dell’intervento in alto' },
          { kind: 'list', items: [
            'A sinistra il nome dell’intervento con il **Menu** (cambia intervento, giorno/notte, questo aiuto …) e l’orologio.',
            'A destra **Annulla/Ripristina**, **Diario** e **+ Voce**.',
          ], only: 'wide' },
          { kind: 'list', only: 'phone', items: [
            'A sinistra il nome dell’intervento con il **Menu** (chiudi intervento, cambia intervento, impostazioni, prontezza offline, questo aiuto …); a destra **Annulla** e il **Diario**.',
            'Il pulsante rotondo in basso a destra è **+ Voce**.',
          ] },
          { kind: 'sub', text: 'Barra dei messaggi' },
          { kind: 'list', items: [
            'Subito sotto la barra dell’intervento c’è **una** striscia per tutto ciò che è in sospeso e resta finché qualcuno non agisce: una squadra di autoprotezione in ritardo, un nuovo allarme, un promemoria scaduto, dati d’allarme non verificati, un aggiornamento pronto. Ogni messaggio è una riga sotto l’altra – niente più schede che si coprono a vicenda.',
            'L’ordine è fisso, non cronologico: prima l’**autoprotezione**, poi l’**allarme**, poi il **promemoria**. Ciò che aspetta qualcuno sta sempre sopra ciò che sparisce da sé.',
            'Agiscono solo i pulsanti con etichetta, la **✕** e – se il messaggio porta da qualche parte – il suo **titolo**. Toccare la riga altrove non fa nulla: leggere non deve essere la stessa cosa che agire. Se non c’è nulla in sospeso, la striscia non esiste.',
          ] },
          { kind: 'sub', text: 'Barra degli strumenti a destra', only: 'wide' },
          { kind: 'list', items: [
            'Gli strumenti di disegno e posizionamento.',
            'Sotto, nell’angolo in basso a destra, la **barra di visualizzazione** – sempre visibile, anche quando gli strumenti scorrono: sulla carta **Livelli** e **Viste** (la bussola), sul piano **Adatta** e la freccia del nord; con il mouse anche **−** e **+**.',
          ], only: 'wide' },
        ],
      },
      {
        id: 'tastatur', title: 'Scorciatoie da tastiera', icon: 'type', only: 'keyboard',
        blocks: [
          { kind: 'lead', text: 'Con la tastiera tutto è raggiungibile senza mouse. Le scorciatoie non fanno nulla mentre si scrive in un campo, né dietro una finestra aperta. Dove una casella ha un tasto, la sua lettera vi è scritta – in entrambe le barre, nella barra di visualizzazione in basso a destra e su «Registro» e «Voce» in alto (finché «Mostra le scorciatoie da tastiera» è attivo nelle **Impostazioni**).' },
          { kind: 'sub', text: 'Cambiare area' },
          { kind: 'list', items: [
            'I numeri aprono il modulo di piano con quel numero – quali esistono dipende dai moduli di questo corpo: [[1]] modulo 1, [[2]] o [[3]] il modulo «2/3», [[4]] modulo 4 …',
            '[[K]] Mappa · [[C]] Checklist · [[A]] Squadre (A come Atemschutz) · [[P]] Presenze · [[M]] Materiale · [[R]] Rapporto – ogni volta la prima lettera della parola TEDESCA, perché è a questa che il tasto è legato.',
            '[[⌘]] [[[]] / [[⌘]] [[]]] scorre tutte le aree una alla volta (anche Dintorni ed Edificio, che non hanno numero).',
          ] },
          { kind: 'sub', text: 'Strumenti (uguali in Situazione e Piano)' },
          { kind: 'list', items: [
            '[[V]] Selezione · [[W]] Selezione multipla · [[S]] Simbolo · [[L]] Linea · [[F]] Area · [[U]] Perimetro · [[N]] Nota · [[T]] Squadra · [[D]] Misura.',
          ] },
          { kind: 'sub', text: 'Modifica' },
          { kind: 'list', items: [
            '[[⌘]] [[Z]] Annulla · [[⌘]] [[⇧]] [[Z]] Ripristina · [[⌘]] [[D]] Duplica · [[⌫]] elimina la selezione.',
            '[[Esc]] torna indietro di un livello a ogni pressione finché la carta è libera: un simbolo in posa → rilevamento coordinate → Livelli / Viste → lo strumento → il pannello della nota → la selezione. In un campo [[Esc]] lascia solo il campo; chiude la **Voce** e ne tiene il testo per la prossima volta.',
          ] },
          { kind: 'sub', text: 'Vista e pannelli' },
          { kind: 'list', items: [
            '[[+]] / [[−]] Zoom · [[0]] Adatta · [[G]] La mia posizione · [[X]] Formato coordinate. «Verso nord» non ha tasto – a questo serve la bussola, sempre visibile e che ruota con la carta.',
            '[[J]] Registro · [[E]] Voce · [[B]] Livelli · [[⌘]] [[,]] Impostazioni · [[?]] questo aiuto.',
            'Sulla **lavagna**, [[Pag↑]] / [[Pag↓]] sfogliano le sue pagine.',
          ] },
          { kind: 'sub', text: 'Mappa & oggetti (senza intervento)' },
          { kind: 'list', items: [
            'Gli stessi tasti dove esiste la stessa cosa: [[K]] Mappa · [[C]] Checklist · i numeri i moduli dell’oggetto scelto · [[D]] Misura · [[B]] Livelli · [[G]] La mia posizione · [[0]] Adatta · [[+]] / [[−]] Zoom · [[⌘]] [[,]] Impostazioni · [[?]] questo aiuto.',
            'In più, ciò che esiste solo qui: [[P]] Posa punto (P come Punkt) · [[U]] Merci pericolose (U come numero ONU) · [[/]] o [[⌘]] [[K]] la ricerca.',
            '[[Esc]] torna passo per passo alla carta: ricerca → Viste → strumento → piano aperto → selezione.',
          ] },
        ],
      },
      {
        id: 'lage', title: 'Situazione – carta', icon: 'map',
        blocks: [
          { kind: 'lead', text: 'La carta tattica sopra lo sfondo cartografico reale (area d’intervento e dintorni).' },
          { kind: 'list', items: [
            '**Mappa di base** (in alto nel pannello livelli) cambia lo sfondo: Carto, OpenStreetMap o satellite.',
            '**Viste** – la bussola in basso a destra – offre **Verso nord**, **Adatta**, **La mia posizione**, **Rileva coordinate** e le viste salvate; con il mouse **−** e **+** stanno accanto. Durante il rilevamento, tocca la carta per fissare un punto (LV95 + WGS84).',
            '**Vento** mostrato in continuo (direzione + temperatura), così la direzione di propagazione è subito chiara.',
            '**Veicoli** appaiono in tempo reale via GPS (nome + orientamento), la propria posizione come punto blu fisso.',
            '**Info edificio** in basso a sinistra indica i pericoli dell’edificio sul luogo d’intervento (⚠ gas · PV) e apre la sua scheda: pericoli, **Misure immediate** e Osservazioni in alto, i dati dei registri sotto. La prima volta che questo dispositivo apre l’intervento, la scheda si apre da sola perché venga letta – la carta resta utilizzabile. ✕ la chiude; poi la riapre il chip. Un altro luogo o oggetto con contenuto la mostra di nuovo.',
          ] },
        ],
      },
      {
        id: 'ebenen', title: 'Livelli e dati', icon: 'layers',
        blocks: [
          { kind: 'lead', text: 'Tramite **Livelli** mostri i dati delle condotte e dei pericoli – ordinati per tipo.' },
          { kind: 'list', items: [
            '**Situazione** – simboli tattici, veicoli, schizzi e note.',
            '**Corpo** – costruzioni sotterranee (autorimesse, rifugi, gallerie) dalla misurazione ufficiale, tratteggiate dallo zoom strada; visibili per impostazione predefinita.',
            '**Acqua** – idranti, condotte, saracinesche, sorgenti.',
            '**Acque reflue** – acque nere/miste, acque chiare/meteoriche, pozzetti / caditoie.',
            '**Gas** – condotte.',
            '**Elettricità** – linee, impianti FV.',
            '**Pericoli** – piene, profondità di allagamento.',
          ] },
          { kind: 'lead', text: 'Ogni livello può essere mostrato/nascosto e regolato nell’opacità.' },
          { kind: 'list', items: [
            '**Scarica la carta per l’offline** (nell’area Livelli) precarica i tasselli della carta, i piani, i simboli e i geodati per il luogo d’intervento.',
          ] },
          { kind: 'note', text: 'I dati delle condotte coprono l’area d’intervento configurata e sono disponibili localmente – funzionano anche offline.' },
        ],
      },
      {
        id: 'zeichnen', title: 'Disegno e simboli', icon: 'pen',
        blocks: [
          { kind: 'lead', text: 'Strumenti della barra destra in modalità Situazione.' },
          { kind: 'list', items: [
            '**Simbolo** – il segno tattico (FKS/VKF). Selezione rapida dei segni più comuni o ricerca in tutta la libreria. Tocca per posizionare; con «Posiziona più» ne metti più di seguito.',
            '**Forme** – nella stessa finestra, dopo i pericoli: **Freccia** e **Rettangolo**, per tutto ciò che non ha un segno tattico. La maniglia ruota, l’angolo allunga il rettangolo (la freccia resta proporzionale – una punta deformata si legge male). Sulla freccia, **Barra di arresto** aggiunge la barra di traverso alla punta – il limite di propagazione: fin qui, e lì fermato.',
            '**Selezione** – tocca gli oggetti, spostali, modificali nell’editor.',
            '**Multiplo** – tocca di nuovo **Selezione** mentre è attiva: il pulsante passa a Multiplo (simbolo e parola) e trascinando un riquadro selezioni più simboli/disegni in una volta. Un ulteriore tocco riporta a Selezione.',
            '**Linea** – trascina o tocca i punti; lo stile si sceglie poi nell’editor: **Mano libera**, **Freccia** o **Asse di salvataggio**. Sotto, la **Terminazione** – **Nessuna**, **Freccia**, **Freccia con stop** (la stessa barra di traverso alla punta) o **Tratto**; **Inverti il senso** la porta all’altra estremità senza spostare la linea.',
            '**Superficie** – tocca i vertici (area indicata da 3 punti in poi); trascina/inserisci/elimina i vertici.',
            '**Perimetro di sicurezza** – trascina dal centro al bordo per impostare il raggio in metri (riempimento regolabile).',
            '**Nota** – testo libero direttamente sulla carta.',
            '**Misura** – distanza (distanza + profilo altimetrico) o superficie (area + perimetro). Trascina i punti per spostarli, tocca la linea per inserire punti intermedi, clic destro per rimuovere un punto.',
            '**Trasporto d’acqua** – sotto il profilo altimetrico di una distanza o in una condotta: scegliere Ø della manichetta, portata, fonte (idrante, stagno, pompa) e pressione d’entrata; il grafico mostra la pressione lungo la condotta, **Tutte le pompe automatiche** posiziona le pompe. **Mettere sulla carta come condotta** conserva il calcolo, **Pompe sulla mappa** le disegna come simboli.',
          ] },
          { kind: 'sub', text: 'Preimpostazioni dei simboli' },
          { kind: 'lead', text: 'Ogni simbolo porta solo i comandi sensati: **Rotazione** per i segni orientati (frecce, scale, pareti), **Quantità** dove più elementi contano, **Piano** o un **intervallo di piani** (es. scala/ascensore), **Propagazione** per le situazioni di danno – più i campi di immissione adatti (es. nome, sostanza, stato).' },
        ],
      },
      {
        id: 'wassertransport', title: 'Trasporto d’acqua', icon: 'drop',
        blocks: [
          { kind: 'lead', text: 'Calcola una condotta di trasporto: quanta pressione arriva dove, e dove devono stare le pompe. Un **aiuto alla pianificazione** – le fonti dei numeri sono dietro la **ⓘ** nell’intestazione (AGV, FKS).' },
          { kind: 'sub', text: 'Disegnare la condotta' },
          { kind: 'list', items: [
            'Disegnare una **Linea** lungo la strada, **dalla fonte all’intervento** – l’acqua scorre dal primo all’ultimo punto. Toccare la condotta, aprire **Misura** e toccare **Calcolare il trasporto d’acqua**.',
            'Oppure provare prima: **Misurare › Distanza**, poi **Calcolare il trasporto d’acqua** sotto il profilo altimetrico. **Mettere sulla carta come condotta** riprende la distanza con tutto il calcolo.',
            'Direzione sbagliata? **⇄** nell’intestazione la inverte, il disegno resta. La lettera all’inizio della condotta (**H**, **W**, **P**) mostra dov’è la fonte.',
          ] },
          { kind: 'sub', text: 'Fonte, acqua, pressione in entrata' },
          { kind: 'list', items: [
            '**Ø del tubo** (in una condotta, la sua riga **Tubo**) – 55, 75, 2× 75 o 110 mm; la perdita di carico viene dalla tabella AGV.',
            '**Acqua** – la portata che deve arrivare in fondo (l/min). Scegliere una proposta o digitare un’altra quantità.',
            '**Fonte** – idrante, stagno o pompa. La **pressione in entrata** è quella con cui la condotta vi inizia: la pressione statica all’idrante, la pressione in uscita di una pompa. Uno stagno non ne ha – la prima pompa sta alla fonte.',
          ] },
          { kind: 'sub', text: 'Leggere il diagramma' },
          { kind: 'list', items: [
            'La linea nera è la **pressione** lungo la condotta, sotto il **terreno**. Le fasce: verde **buono** sopra 3 bar, giallo **scarso** 2–3 bar, rosso **troppo poco** sotto 2 bar.',
            'I punti **P1**, **P2** … sono le pompe – messe automaticamente dove la pressione scende a 2 bar (FKS: una pompa ha bisogno di almeno 2 bar in entrata). Sulla mappa portano gli stessi nomi.',
            'Passare sopra il diagramma o toccarlo mostra la pressione in quel punto – la mappa segna il punto.',
            'Sotto, **salita/discesa** e **pressione in fondo**. **Tubi** indica la riserva a parte, p. es. «34 + 3 di riserva × 20 m».',
          ] },
          { kind: 'sub', text: 'Spostare le pompe' },
          { kind: 'list', items: [
            'Toccare una pompa mostra dove sta, la sua **pressione in entrata** e la **pressione in uscita** (regolabile con **−**/**+**).',
            '**Trascinare** una pompa – di lato nel diagramma o lungo la condotta sulla mappa – la fissa lì («a mano»); le pompe successive vengono ricalcolate. **Tutte le pompe automatiche** ripristina tutto.',
            '**Sulla mappa** disegna le pompe come motopompe sulla mappa e sullo schizzo stampato. Toccare una pompa sulla mappa apre la condotta con la **Misura** aperta.',
          ] },
          { kind: 'sub', text: 'Avvisi' },
          { kind: 'list', items: [
            '**Pompa 1: pressione in entrata sotto 2 bar** – una pompa messa a mano sta troppo lontano; avvicinarla alla fonte o toccare **Tutte le pompe automatiche**. **Nessuna pressione**: lì non arriva più acqua.',
            '**Più del solito** – molte pompe; accanto, quante ne servirebbero con un altro Ø del tubo.',
            '**Calcolato senza profilo altimetrico** (offline, fuori dalla Svizzera) e **fuori dalla tabella AGV** – i numeri sono stimati.',
            'Un avviso di pompa viene annotato una volta nella **cronologia** quando compare, e così arriva nel rapporto.',
          ] },
        ],
      },
      {
        id: 'plan', title: 'Piano – moduli ed edifici', icon: 'doc',
        blocks: [
          { kind: 'lead', text: 'Una lavagna per oggetto sopra i piani dei moduli/edifici. Piano per piano, con strumenti propri.' },
          { kind: 'list', items: [
            'In basso a sinistra, accanto alla scala, l’**indirizzo** dell’oggetto caricato – toccalo per sceglierne un altro. L’oggetto determina i piani nella barra a sinistra.',
            '**Simbolo**, **Selezione**, **Disegna** (colore/spessore/tipo di linea), **Nota** (testo), **Squadra**.',
            '**Piani** come pila: con i pulsanti **PS/PI** sul piano aggiungi un livello sopra/sotto.',
            '**Zoom/Adatta** in basso nella barra degli strumenti, come sulla carta.',
            '**Squadre** (squadre) come marcatori colorati; mostrare/nascondere le **Tracce** ne rivela il percorso. I tag delle squadre la cui squadra è «uscita» vengono attenuati/barrati.',
            '**Scala** – tocca le due estremità della scala stampata e inserisci la lunghezza reale. Da lì linee e superfici indicano metri veri (Misura, come strumento a sé, esiste solo sulla carta).',
            'Un foglio **collegato alla mappa** misura già da sé – così come la pila dei piani dell’edificio, che conosce la propria dimensione dalla pianta. Lì il tag dice **rif. auto** invece di offrire una calibrazione; toccandolo si apre la corrispondenza, oppure dice da dove viene la scala. A mano si calibra solo ciò che non è collegato.',
            '**Una nota veloce a mano?** Il piano è la superficie da schizzo: disegna liberamente, barra, scarabocchia. La carta resta strutturata (simboli, linee, note), così rapporto e diario restano puliti.',
          ] },
          { kind: 'sub', text: 'Collega alla mappa (georeferenza)' },
          { kind: 'list', items: [
            '**Collega alla mappa**, in basso sul piano, posa questo foglio sulla carta: il piano cede metà della superficie e la mappa si mette accanto. Su un telefono non c’è spazio per entrambe – lì un selettore **Mappa / Modulo** passa dall’una all’altra. Tocca lo stesso punto su entrambe le superfici – uno spigolo di casa, un idrante, un incrocio. **L’ordine non conta**: una metà posata trova da sé la sua controparte, e si può passare da una superficie all’altra a piacere. Due punti bastano per posare il foglio.',
            'Il **semaforo** nella barra dice in ogni momento a che punto si è: due punti risolvono in modo esatto e quindi **non verificato** – solo il terzo misura lo scarto («4 punti · ⌀ 1.2 m»). **Verifica la sovrapposizione** posa il contorno del foglio sulla carta per un controllo a vista.',
            'Trascinando una croce la si sposta, toccandola si apre **Sposta**, **Elimina punto** o **Mantieni**. Un tocco su **collegato** apre la **Corrispondenza** con coppie e scarto; **Trasferisci** copia i punti di riferimento su un altro modulo dello stesso oggetto, **Reimposta** li elimina (con richiesta di conferma). **Chiudi** non scarta nulla – ciò che è posato è già salvato.',
            'Da lì **entrambe le superfici mostrano gli stessi oggetti** – non una copia, lo stesso oggetto: toccarlo mostra i dati, trascinarlo lo sposta, stessi vertici e stesse maniglie da entrambe le parti.',
            'Dove un oggetto **sta** lo decide l’ultima mano che lo ha posato: trascinato su un foglio sta sul foglio – e si sposta con la correzione dell’adattamento. Trascinato sulla carta sta a terra. Un adattamento corretto riposiziona tutto ciò che sta su quel foglio – una riga nel diario, che un ↶ annulla. **Formato del foglio misurato** è lo stesso riposizionamento senza alcun gesto: l’app ha misurato il foglio aperto e risolto l’adattamento nella sua vera forma. **Reimpostare** un riferimento non perde nulla: foglio e carta mantengono entrambi ciò che mostrano.',
            'Nei **Livelli** ogni foglio collegato riceve una riga propria («Piano (modulo 2)»): il foglio stesso, come immagine sotto la carta. Gli oggetti posati su di esso non hanno più bisogno di una riga – appartengono al livello su cui sono stati posati.',
          ] },
          { kind: 'note', text: '**Da che parte è girato l’edificio?** Un tocco sulla **freccia del nord** in alto a destra sulla pila dei piani apre la finestrella «Ruota l’edificio»: un cursore **Rotazione** con anteprima, più **Nord in alto** e **Ruota sull’asse maggiore** con un tocco ciascuno. Il contorno gira con essa, le marcature restano dove stanno sull’edificio – e le pagine dei piani stampate mostrano l’angolo impostato.' },
        ],
      },
      {
        id: 'atemschutz', title: 'Squadre e sorveglianza autoprotezione', icon: 'stopwatch',
        blocks: [
          { kind: 'lead', text: 'Sorveglianza senza lacune di ogni squadra ARA secondo FKS – il segnale di sicurezza è il **tempo dall’ultimo contatto radio**, non un tempo residuo stimato.' },
          { kind: 'sub', text: 'Creare una squadra' },
          { kind: 'list', items: [
            '**Chi entra**: tre posti, quello in alto è il **capogruppo** – toccando una riga lo si designa, la **✕** lo toglie. Una squadra più grande aggiunge semplicemente righe.',
            'La **ricerca persona** raggiunge tutto l’organico, non solo i presenti; accanto a ogni nome sta ciò che lo sconsiglia (assente, in rimessa, già in una squadra). **(+)** registra un ospite (pompieri vicini) – aggiunto nello stesso momento alla presenza, come la stessa persona.',
            'La **pressione d’ingresso** (bar) e il **canale radio** stanno di fianco.',
            'Sotto il **compito**: tipo (con autoprotettore Salvare, Spegnere, Perlustrare, Mettere in sicurezza, Ricognizione, Altro; senza autoprotettore Traffico, Sanitario, Approvvigionamento idrico, Mettere in sicurezza, Messa a disposizione, Altro), **obiettivo / luogo** in chiaro, **n. linea** (le linee già disegnate sono proposte di fianco) e il **colore** su mappa e piano.',
            'Il compito non trattiene nessuno: **Annunciare la squadra** funziona anche senza. La scheda riporta allora **«compito aperto»**, e toccandolo si apre il modulo.',
            'Quanto digitato sopravvive alla chiusura con **✕** o a un clic di fianco – solo **Annulla** lo scarta.',
          ] },
          { kind: 'sub', text: 'Sorveglianza per squadra' },
          { kind: 'list', items: [
            'In grande l’orologio **Dall’ultimo contatto**: verde **Contatto ok** → giallo **Contatto in scadenza** → rosso **In ritardo** (nessun contatto entro ~5 min) con allarme.',
            '**Contatto** (pulsante grande) conferma il contatto radio e azzera l’orologio.',
            '**Pressione** regolala direttamente con ± e applicala con **Conferma** – vale come contatto e viene registrata; un clic errato senza conferma non cambia nulla. La pressione bassa diventa rossa.',
            'Stato **Annunciata → In intervento → Ritiro → Fuori**. Il **Ritiro** si può revocare con **Continua**; una squadra fuori rientra in sorveglianza con **Rientrare** (nuova bombola) — il **registro delle pressioni del primo impiego resta** e compare per intero sul rapporto.',
            'Le squadre fuori mantengono il loro posto sulla lavagna (grigie e attenuate) invece di finire in una sezione a parte — la scheda che cerchi è dove era.',
            'Una **squadra cancellata** sparisce solo dalla lavagna: sul rapporto resta, con tutto ciò che è stato misurato, indicata come «rimossa dalla lavagna». **Squadre rimosse** nell’intestazione la riporta indietro — l’avviso «annulla» è la porta veloce, non l’unica.',
            '**Diario** per squadra (espandibile) mostra ogni contatto con ora e pressione.',
            '**Modifica** (matita) adatta compito, obiettivo/piano o squadra durante l’intervento.',
            'Chi è sotto autoprotezione non si può congedare nella **Presenza** – toccando la sua riga si salta alla scheda di quella squadra, evidenziata per un momento.',
            'Le squadre in ritardo salgono in alto e in cima appare un contatore. La **campanella** silenzia l’allarme per dispositivo – suono **e** notifica, e solo fino alla fine di questo intervento. Se è rossa, il browser non ha sbloccato l’audio: toccarla. La tavola stessa non è mai muta. Tutto finisce nel diario.',
            'Ogni squadra si può posizionare sul piano (pulsante «mostra sul piano»).',
          ] },
        ],
      },
      {
        id: 'anwesenheit', title: 'Presenza e personale', icon: 'people',
        blocks: [
          { kind: 'lead', text: 'Chi è in intervento, e da quando a quando — la base del foglio del personale e delle ore. L’organico viene dall’amministrazione; qui si registra solo chi c’è oggi.' },
          { kind: 'sub', text: 'Registrare' },
          { kind: 'list', items: [
            'Toccando una riga si passa avanti: **libero → presente → uscito → libero**. Il primo «presente» parte dall’**ora d’allarme** (di solito si tocca dopo l’arrivo); un rientro parte da adesso.',
            'Ogni riga accetta un’**annotazione** («autista TLF», «ferito, sostituito 21:40»). Dice che cosa ha fatto questa persona qui e finisce sul foglio del personale. Se una riga passa per errore su «libero», l’annotazione torna al prossimo «presente».',
            '**Sul posto** o in **magazzino** è una coppia nella riga — la risposta a «chi si potrebbe ancora richiamare». L’intestazione mostra la ripartizione appena qualcuno è in magazzino.',
            '**Altra persona** registra chi non è in organico (pompieri vicini, ospite). È un’affermazione su questo intervento, non sull’appartenenza al corpo.',
            'Chi è **sotto autoprotezione** non si può congedare — un tocco salta invece alla scheda della sua squadra.',
          ] },
          { kind: 'sub', text: 'Correggere' },
          { kind: 'list', items: [
            '**Annulla / ripristina** riprende l’ultimo tocco (barra in alto; sul telefono nell’intestazione della presenza). Il diario tiene entrambi: il tocco e la correzione.',
            'Orari sbagliati? I **chip orari** della riga correggono da/a — anche un blocco precedente, se qualcuno è stato qui due volte.',
            'Le tre viste in alto: **Presenza** (chi c’è), **Programma** (chi è disponibile quando), **Turni** (i cambi come bande).',
          ] },
          { kind: 'note', text: 'La registrazione funziona anche **via QR** (cartello in magazzino): chi si iscrive lì compare qui — ed entrambe le parti possono toccare la stessa persona senza perdere nulla.' },
        ],
      },
      {
        id: 'mittel', title: 'Materiale', icon: 'box',
        blocks: [
          { kind: 'lead', text: 'Che cosa è stato impiegato — dal catalogo del corpo o registrato liberamente. Il rapporto ne stampa la lista del materiale.' },
          { kind: 'list', items: [
            'Il **catalogo** viene dall’amministrazione, con unità e provenienza («sul TLF», «Pio»). **+** aumenta la quantità, la riga resta.',
            '**Altro materiale** registra ciò che il catalogo non conosce — bastano denominazione e quantità.',
            'Dove un simbolo sulla carta rappresenta un materiale (ventilatore, assorbente), la sua scheda offre **«registra come mezzo»**: un tocco invece della stessa cosa registrata due volte.',
            'Portare una quantità a **0** non toglie la riga dal verbale — il rapporto mostra che cosa è stato impiegato e che cosa è stato ritirato.',
          ] },
        ],
      },
      {
        id: 'zeitplan', title: 'Programma e turni', icon: 'clock',
        blocks: [
          { kind: 'lead', text: 'La seconda e la terza vista della presenza: non «chi c’è» ma **chi è disponibile quando** — per un intervento che dura più di un turno.' },
          { kind: 'list', items: [
            'Nel **programma** ogni persona ha la sua riga; trascinando (o con la matita) si pianifica una finestra di disponibilità. È un **piano**, non un verbale: non scrive alcuna presenza — quella nasce solo quando qualcuno tocca davvero.',
            '**Confermato** (pieno) o **proposto** (vuoto) — la differenza tra «viene» e «potrebbe venire».',
            'L’**intervallo** in alto decide quante ore si vedono insieme.',
            'In **Turni** le stesse finestre sono raggruppate in bande con un nome («notte 22–06»): creare una banda non scrive alcun turno, e cancellarne una non cancella alcuna disponibilità.',
            'Entrambe le viste si stampano: dal **menu stampante** nell’intestazione — **piano turni** o **disponibilità**, come PDF o direttamente sulla stampante del magazzino.',
          ] },
        ],
      },
      {
        id: 'checkliste', title: 'Checklist', icon: 'check',
        blocks: [
          { kind: 'lead', text: 'Due colonne: compiti eseguibili e un prontuario tattico ricercabile.' },
          { kind: 'list', items: [
            '**Compiti** – checklist d’intervento (es. supporto alla conduzione, rapporto di situazione) con indicatore di avanzamento; spunta le voci, le diramazioni seguono procedure a più livelli.',
            '**Tattica · parole chiave** – cerca una parola chiave e apri la voce corrispondente (con codice colore dei pericoli e schizzi).',
            'Quando si rileva un allarme, una parola chiave adatta viene proposta automaticamente.',
          ] },
          { kind: 'lead', text: 'Lo stato viene conservato e sincronizzato su tutti i dispositivi.' },
        ],
      },
      {
        id: 'verlauf', title: 'Diario e voce', icon: 'verlauf',
        blocks: [
          { kind: 'lead', text: 'Un diario condiviso e continuo tra Situazione e Piano – la cronaca dell’intervento.' },
          { kind: 'list', items: [
            '**+ Voce** (in alto a destra): un tocco breve apre l’immissione testo. **Tieni premuto** per aprire due campi – **nota vocale** per prima, **foto** oltre. Il dito scorre su uno dei due e rilascia. Il pulsante stesso diventa una **✕**: rilasciare senza aver scorso annulla e non lascia nulla. La registrazione parte – e la fotocamera si apre – solo al rilascio. Si possono allegare foto anche nella voce stessa.',
            'Da **due lettere** in poi vengono proposti nomi – organico, materiale, organizzazioni partner, veicoli e gruppi d’allarme. Toccandone uno si inserisce il nome intero; è evidenziato nel diario e sul rapporto stampato. Non c’è un campo «da» separato: la frase dice già chi ha segnalato. Anche i posti **EL** e **Stv. EL** fanno parte del vocabolario: scrivendo il posto si ottiene il nome («EL (Widmer Céline)»), scrivendo il nome si ottiene il posto.',
            'Appena la frase termina con un nome, accanto compaiono **→** e **←** — un tocco scrive la freccia, e «EL → ambulanza: paziente stabile» si legge come il protocollo radio che il diario è. Sulla carta diventa «->».',
            'Finché il campo è **vuoto**, sono pronti i chip iniziali: prima **EL →**, poi le formulazioni già usate in questo intervento (altrimenti la lista del corpo). Restano finché non si digita davvero — un secondo chip si aggiunge al primo.',
            'Le azioni rilevanti (simbolo posizionato, disegno creato/rimosso …) finiscono automaticamente nel diario.',
            '**Annulla/Ripristina** vale per Situazione, Piano – e per la **Presenza**, dove riprende l’ultimo tocco (sul telefono la coppia sta nell’intestazione della presenza).',
            'Una voce del diario con un luogo, se toccata, riporta al punto sulla carta o sul piano; foto e note vocali si aprono/riproducono direttamente nel diario.',
            '**Avvia riproduzione** riproduce Situazione e Piano a un momento precedente (cursore temporale; durante la riproduzione la modifica è bloccata).',
          ] },
        ],
      },
      {
        id: 'einsatz', title: 'Gestire gli interventi', icon: 'swap',
        blocks: [
          { kind: 'lead', text: 'Tutto nel menu dell’intervento (nome in alto a sinistra).' },
          { kind: 'list', items: [
            '**Cambia intervento** tra gli interventi aperti; **Nuovo intervento** (luogo selezionabile sulla carta).',
            '**Pool allarmi** – rileva gli allarmi in arrivo (solo dove è collegata una sorgente allarmi).',
            '**Interventi** – apri l’archivio / interventi precedenti.',
            '**Chiudi intervento** chiude l’intervento in corso – lo stesso dialogo del rapporto, con lo stesso contatore di ciò che resta aperto.',
          ] },
        ],
      },
      {
        id: 'rapport', title: 'Rapporto e chiusura', icon: 'doc',
        blocks: [
          { kind: 'lead', text: 'Il **rapporto d’intervento** è un’area propria nella barra di sinistra, sotto Materiale ([[R]]) – un foglio di rilevamento precompilato, non un modulo da zero. Si completa lungo tutto l’intervento, non solo alla fine.' },
          { kind: 'list', items: [
            'Su schermi larghi due colonne: a sinistra il **modulo** da compilare (allarme, breve rapporto, orari, osservazioni, riscontro alla centrale d’intervento), a destra il **confronto** da spuntare (presenze, materiale, organizzazioni partner, foto).',
            'Sotto il titolo sta ciò che è stato rilevato – e, come pastiglie a sé, ciò che è **ancora aperto**: orari, presenze, materiale, capo intervento, breve rapporto, riscontro alla centrale. Nulla di tutto ciò blocca mai la stampa.',
            'Il **dettaglio del croquis** sta come campo accanto al modulo: spostare, ingrandire, **verticale/orizzontale** e lo **stato del croquis** – quale momento mostra l’immagine, con segni dove è successo qualcosa. Si stampa esattamente ciò che è a schermo; non c’è un passaggio di conferma.',
            '**Rapporto d’intervento (PDF)** genera il rapporto finito – reso lato server, un solo pulsante. Il **▾** accanto apre **«Sezioni»**: cosa finisce sulla carta (croquis, piani, protezione respiratoria, presenze, materiale, cronologia, foto, prova di verifica dettagliata). Il menu resta aperto mentre si spunta.',
            'Dove un corpo gestisce una **stampante di sede**: **Stampa** mette il rapporto nella sua coda. Messo in coda non è stampato – finché un lavoro resta in sospeso compare come **stampa in sospeso** sotto la testata del rapporto, con **Verifica** e **Annulla**. Il rapporto vale come prodotto solo quando la stampante annuncia «stampato».',
            'Se il corpo ha depositato moduli propri (Amministrazione › Rapporto), alla fine, sotto il ritaglio dello schizzo, compare **Moduli e link** – un elenco da spuntare. **Apri** richiama il modulo con parola chiave, luogo, data e capo intervento già compilati, per quanto il link lo preveda. La spunta si mette a mano: l’app non vede se un modulo è stato inviato.',
            'Se qualcosa non torna nel record – una catena di verifica interrotta, una nota vocale senza trascrizione, una foto ancora in coda – accanto ai pulsanti compare una **pastiglia arancione di avviso**. Conta i punti e li apre; se tutto è in ordine non compare affatto.',
            'Persona di contatto e riscontro alla centrale hanno un **Non applicabile** a fine riga – per il falso allarme o la perdita d’olio dove non esistono. È una risposta, non un salto: viene registrata e appare così nel rapporto.',
            '**Chiudi intervento** chiude l’intervento e fissa l’ora di fine. Le foto e le note vocali non ancora caricate partono prima; se non è possibile (offline) **restano salvate** e partiranno alla prossima apertura — la conferma dice quante.',
            '**Condividere** (in fondo al rapporto, e sotto **Condividi l’intervento** nel menu): un link a questo solo intervento – carta, piani, diario, foto, orari. Sola lettura, senza login, nulla è modificabile. Per la centrale, il CI e un corpo vicino durante l’intervento – e per il comune e i corpi vicini dopo: resta valido oltre la chiusura, finché qualcuno non lo revoca.',
          ] },
          { kind: 'note', text: 'Un intervento chiuso si può **riaprire** – le aggiunte successive compaiono nella cronologia e nel rapporto come **integrazioni**, e nulla va perso.' },
        ],
      },
      {
        id: 'erfassung', title: 'Rilevamento tramite QR', icon: 'cam',
        blocks: [
          { kind: 'lead', text: 'Dove un corpo ha attivato il rilevamento (Amministrazione › Rilevamento), un **poster QR** in rimessa apre la vista di rilevamento – senza login, per tutti quelli senza accesso a un tablet.' },
          { kind: 'list', items: [
            'Si sceglie l’intervento in corso; **presenze** e **materiale** si rilevano dal proprio telefono.',
            'Un nome avanza toccandolo: **non presente → rimessa → sul posto → uscito**. La **ⓘ** accanto alla ricerca lo ripete, compreso il significato dell’ora accanto (da = arrivo, a = partenza).',
            'I dati confluiscono nello **stesso intervento** del tablet del posto comando e vengono uniti (con un avviso da controllare in caso di scostamento).',
            'Come ripiego c’è il **foglio di rilevamento vuoto (PDF)** da stampare e completare a mano.',
          ] },
        ],
      },
      {
        id: 'sync', title: 'Multi-dispositivo e offline', icon: 'check',
        blocks: [
          { kind: 'lead', text: 'Tutti i dispositivi vedono lo stesso intervento in tempo reale.' },
          { kind: 'list', items: [
            'Le modifiche vengono condivise automaticamente; il distintivo di sincronizzazione in alto mostra lo stato (salvato/in attesa).',
            'La modifica simultanea viene unita per oggetto (vince la modifica più recente).',
            '**Sola lettura**: osservatori e telefoni vedono la situazione in tempo reale, senza gli strumenti tattici.',
          ] },
          { kind: 'sub', text: 'Offline' },
          { kind: 'list', items: [
            'La **Preparazione offline** nelle **Impostazioni** ([[⌘]] [[,]]) è su **Automatico**: l’app installata scarica da sé carta, piani, simboli e livelli di riferimento poco dopo l’apertura di un intervento – senza dialoghi, senza notifiche. Vengono presi **tutti** i livelli cartografici configurati, anche quello ora nascosto: l’esperienza dice che lo si attiva quando la rete è già andata. **Solo manuale** lascia il compito al pulsante **Carica tutto per l’offline**.',
            'Quanto viene caricato dipende dal **Raggio offline** (anch’esso nelle Impostazioni, vale solo su questo dispositivo): raggio più piccolo = download più rapido e più leggero.',
            'Che cosa sia davvero pronto lo dice la **Prontezza offline** nel menu dell’intervento – riga per riga: carta, piani, simboli, merci pericolose, livelli di riferimento, personale, memoria del dispositivo. **Meteo** e **Ricerca oggetti** richiedono una connessione e vi figurano come «solo online».',
            'Affidabile offline è solo l’**app installata**. In una scheda del browser la memoria può essere svuotata in qualsiasi momento, e la scheda dovrebbe essere ancora aperta al prossimo intervento.',
            'Senza rete continua a funzionare tutto ciò che sta sul dispositivo: disegnare e posare simboli, autoprotezione, presenze, materiale, diario e rapporto. Foto e note vocali restano salvate e partono più tardi.',
            'Appena la rete torna, le modifiche escono da sé e vengono unite con gli altri dispositivi – per oggetto, vince la modifica più recente. Finché qualcosa è in attesa, lo dice il distintivo di sincronizzazione in alto.',
          ] },
        ],
      },
      {
        id: 'bedienung', title: 'Uso e giorno/notte', icon: 'move',
        blocks: [
          { kind: 'sub', text: 'Tocca e trascina (touch/iPad)' },
          { kind: 'list', items: [
            'Un dito sposta la carta/il piano; due dita zoomano (pinch).',
            'Anche un dito solo zooma: **doppio tocco** ingrandisce; **toccare, premere di nuovo e trascinare** zooma in modo continuo – verso il basso ingrandisce, verso l’alto riduce. Uguale su carta e piano, con la **Selezione**. Uno strumento ha la precedenza: dove tocca (punti, misura, aggiungi, nota, cerchio …) ogni tocco è suo; dove traccia (mano libera, selezione multipla) il doppio tocco zooma ancora. Due dita zoomano sempre. Una linea o una superficie fatta punto per punto si conclude con ✓, mai con un doppio tocco.',
            'Toccando di nuovo **Selezione** il pulsante passa a **Multiplo**: un riquadro trascinato seleziona più oggetti; gli oggetti selezionati si spostano trascinando.',
            'Un pulsante che porta solo un segno dice la sua parola se lo **tieni premuto**: dopo un breve istante la parola compare come fumetto sopra di esso, su touch con una breve vibrazione. Rilasciando **non** si attiva il pulsante: chiedere che cosa sia una cosa non deve anche farla. Con il mouse basta passarci sopra.',
          ] },
          { kind: 'sub', text: 'Mouse', only: 'keyboard' },
          { kind: 'list', only: 'keyboard', items: [
            'Lo scorrimento zooma; il **clic destro** (o tocco prolungato) su un punto di misura/linea lo rimuove, un clic su una linea inserisce un punto intermedio.',
          ] },
          { kind: 'sub', text: 'Tasti', only: 'keyboard' },
          { kind: 'list', only: 'keyboard', items: [
            '[[Esc]] torna indietro di un livello – strumento, pannello aperto, selezione (l’ordine completo in **Scorciatoie da tastiera**).',
            '[[Canc]] / [[Backspace]] elimina la selezione (non mentre si scrive in un campo).',
          ] },
          { kind: 'sub', text: 'Giorno / notte' },
          { kind: 'list', items: [
            'Commutabile nel menu dell’intervento – la modalità notte attenua carta e interfaccia per il buio.',
          ] },
        ],
      },
      {
        id: 'verwaltung', title: 'Amministrazione e dati della stazione', icon: 'gear',
        blocks: [
          { kind: 'lead', text: 'Tutto ciò che vale per l’intero corpo – personale, gradi, veicoli, materiale, livelli cartografici, piani oggetto, checklist – si gestisce in **Amministrazione**, non durante un intervento. L’accesso ha una password propria, non è il PIN d’intervento.' },
          { kind: 'sub', text: 'La cartella di lavoro (Excel)' },
          { kind: 'list', items: [
            'In **Daten › Arbeitsmappe** gli elenchi del corpo stanno in un unico file Excel: scaricarlo, modificarlo in Excel, Numbers o LibreOffice, ricaricarlo. Otto fogli – Mannschaft, Dienstgrade, Fahrzeuge, Mittel, Mittel-Bestände, Quellen, Partnerorganisationen, Symbolfelder (i nomi delle schede restano in tedesco).',
            'Prima di scrivere arriva sempre un’**anteprima**: foglio per foglio, che cosa sarebbe nuovo, che cosa cambia, che cosa scompare – e ogni riga rifiutata con foglio e numero di riga. Fino alla conferma non viene scritto nulla, e annullare non scrive nulla.',
            'Ricaricare lo stesso file non cambia proprio nulla. Il download è quindi anche il modello – e si può prendere senza rischi solo per guardarlo.',
          ] },
          { kind: 'note', text: '**Un foglio assente non è un foglio vuoto.** Togliere un intero foglio dal file lascia quell’elenco invariato. Cancellarne solo le righe lasciando la riga di intestazione lo svuota – ed è esattamente così che si svuota un elenco di proposito.' },
          { kind: 'note', text: '**«Manca» significa due cose.** Una persona che manca nel foglio Mannschaft viene **disattivata**, mai cancellata – gli interventi chiusi risolvono il suo nome tramite quella riga. Un identificativo che manca in uno degli altri elenchi viene **rimosso**. L’anteprima usa queste due parole e nomina le righe invece di contarle.' },
          { kind: 'sub', text: 'Se qualcosa va storto lo stesso' },
          { kind: 'list', items: [
            'Ogni modifica agli **elenchi** conserva lo stato precedente: **Sicherung › Letzte Änderungen** li elenca con l’orario e ne ripristina uno – che abbia scritto un modulo, la cartella di lavoro o un terminale.',
            '**Il personale non è lì dentro.** Le persone sono record propri, non configurazione – un import che tocca solo il foglio Mannschaft non compare affatto sotto «Letzte Änderungen». In compenso lì non viene mai cancellato nessuno, solo disattivato: annullare significa riattivare. Per ripristinare l’intero elenco si usa il file scaricato prima dell’import.',
            'La cartella di lavoro **non è un backup**: copre solo gli elenchi. Il backup è l’export JSON sotto **Sicherung**.',
          ] },
        ],
      },
    ],

    search: 'Cerca nella guida …',
    searchHint: 'Prova un\'altra parola chiave – la ricerca copre titoli e testo.',
  },
}
