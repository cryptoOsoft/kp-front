// French copy · the «Funktionen & Hilfe» overlay.
// One slice of the `fr` overlay, assembled in ../fr.ts; the German base is ../de/help.ts.

import type { Copy, Localizable } from '../index'

export const helpCopy: Localizable<Pick<Copy, 'help'>> = {
  help: {
    menu: 'Fonctions et aide',
    title: 'Que fait PC Front ?',
    contents: 'Sommaire',
    close: 'Fermer',
    introFallback: 'PC Front est la conduite d’intervention numérique de votre corps de sapeurs-pompiers : carte de situation tactique, plans d’objet, surveillance de la protection respiratoire et un journal partagé – le tout en direct sur plusieurs appareils à la fois.',
    sections: [
      {
        id: 'ueberblick', title: 'Aperçu', icon: 'info',
        blocks: [
          { kind: 'intro' },
          { kind: 'sub', text: 'Les quatre espaces de travail (barre de gauche)', only: 'wide' },
          { kind: 'sub', text: 'Les espaces de travail (barre du bas)', only: 'phone' },
          { kind: 'list', items: [
            '**Situation** – la carte tactique avec symboles, lignes, surfaces et les couches des réseaux.',
            '**Plan** – les plans d’objet (modules 1–6, contours de bâtiment) sous forme de tableau blanc, étage par étage.',
            '**Checklist** – listes de contrôle d’intervention à dérouler.',
            '**Binômes** – surveillance des binômes engagés avec temps et pression, avec ou sans ARI.',
          ] },
          { kind: 'note', text: 'Principe directeur : utilisable à 3 h du matin, après six mois sans entraînement. Reconnaître plutôt que retenir, utilisable avec des gants et hors ligne.' },
        ],
      },
      {
        id: 'navigation', title: 'Navigation et interface', icon: 'cursor',
        blocks: [
          { kind: 'lead', text: 'Trois zones fixes : la barre des espaces à gauche, la barre d’intervention en haut, la barre d’outils à droite.', only: 'wide' },
          { kind: 'lead', text: 'Deux barres en bas, une en haut : tout en bas la barre des espaces, au-dessus la barre d’outils, en haut la barre d’intervention.', only: 'phone' },
          { kind: 'sub', text: 'Barres du bas', only: 'phone' },
          { kind: 'list', only: 'phone', items: [
            'La **barre des espaces** tout en bas a cinq cases : Carte, Plans, Checklist, Binômes et Rapport. **Plans** et **Rapport** regroupent plusieurs pages (Rapport, Présence, Matériel) : toucher la case une seconde fois ou la maintenir ouvre le choix.',
            'Au-dessus, la **barre d’outils** de la carte ou du plan. **+** est l’unique porte vers tout ce qu’on y place.',
            'Un bouton qui ne porte qu’un symbole dit son nom quand on le **maintient appuyé**. Dans les **Réglages**, «Étiquettes des barres» écrit les mots dessous en permanence.',
          ] },
          { kind: 'sub', text: 'Barre de gauche', only: 'wide' },
          { kind: 'list', items: [
            'Change d’espace de travail : **Carte** (Situation), les **Plans** (modules/bâtiments), **Checklist**, **ARI**.',
            'En mode Situation, **Couches** et le sélecteur de **Carte** sont épinglés en bas – toujours visibles.',
            'Tirer le bord droit de la barre la déplie avec les libellés ou la replie.',
          ], only: 'wide' },
          { kind: 'sub', text: 'Barre d’intervention (haut)' },
          { kind: 'list', items: [
            'À gauche, le nom de l’intervention avec le **Menu** (changer d’intervention, jour/nuit, cette aide …) et l’horloge.',
            'À droite, **Annuler/Rétablir**, **Journal** et **+ Entrée**.',
          ], only: 'wide' },
          { kind: 'list', only: 'phone', items: [
            'À gauche, le nom de l’intervention avec le **Menu** (clore l’intervention, changer d’intervention, réglages, préparation hors ligne, cette aide …) ; à droite **Annuler** et le **Journal**.',
            'Le bouton rond en bas à droite est **+ Entrée**.',
          ] },
          { kind: 'sub', text: 'Bandeau de messages' },
          { kind: 'list', items: [
            'Juste sous la barre d’intervention se trouve **un** bandeau pour tout ce qui est en attente et le reste jusqu’à ce que quelqu’un agisse : un binôme ARI en retard, une nouvelle alarme, un rappel échu, des données d’alarme non vérifiées, une mise à jour prête. Chaque message est une ligne sous la précédente – plus de cartes qui se recouvrent.',
            'L’ordre est fixe, pas chronologique : d’abord l’**ARI**, puis l’**alarme**, puis le **rappel**. Ce qui attend quelqu’un passe toujours avant ce qui disparaît de soi-même.',
            'Seuls les boutons libellés agissent, le **✕** et – si le message mène quelque part – son **titre**. Toucher la ligne ailleurs ne fait rien : lire ne doit pas être la même chose qu’agir. Si rien n’est en attente, le bandeau n’existe pas.',
          ] },
          { kind: 'sub', text: 'Barre d’outils (droite)', only: 'wide' },
          { kind: 'list', items: [
            'Les outils de dessin et de placement ; épinglée en bas, la navigation de carte (zoom, ajuster, coordonnées).',
          ], only: 'wide' },
        ],
      },
      {
        id: 'tastatur', title: 'Raccourcis clavier', icon: 'type', only: 'keyboard',
        blocks: [
          { kind: 'lead', text: 'Avec un clavier, tout est accessible sans souris. Les raccourcis restent sans effet pendant la saisie dans un champ de texte. Lorsqu’une zone de l’une des deux barres, ou «Journal» et «Entrée» en haut, possède une touche, celle-ci est inscrite dessus.' },
          { kind: 'sub', text: 'Changer de zone' },
          { kind: 'list', items: [
            'Les chiffres ouvrent le module de plan portant ce numéro – ceux qui existent dépendent des modules du corps : [[1]] module 1, [[2]] ou [[3]] le module « 2/3 », [[4]] module 4 …',
            '[[K]] Carte · [[C]] Checklist · [[A]] Binômes (A comme Atemschutz) · [[P]] Présence · [[M]] Matériel · [[R]] Rapport – chaque touche est la première lettre du mot ALLEMAND, car c’est à elle que le raccourci est lié.',
            '[[⌘]] [[[]] / [[⌘]] [[]]] parcourt toutes les zones une à une (y compris Environs et Bâtiment, qui n’ont pas de numéro).',
          ] },
          { kind: 'sub', text: 'Outils (identiques en Situation et en Plan)' },
          { kind: 'list', items: [
            '[[V]] Sélection · [[W]] Sélection multiple · [[S]] Symbole · [[L]] Ligne · [[F]] Surface · [[U]] Périmètre · [[N]] Note · [[T]] Binôme · [[D]] Mesurer (carte seulement).',
          ] },
          { kind: 'sub', text: 'Édition' },
          { kind: 'list', items: [
            '[[⌘]] [[Z]] Annuler · [[⌘]] [[⇧]] [[Z]] Rétablir · [[⌘]] [[D]] Dupliquer.',
            '[[Esc]] ferme dans l’ordre : outil → panneau ouvert → sélection. [[⌫]] supprime la sélection.',
          ] },
          { kind: 'sub', text: 'Affichage et panneaux' },
          { kind: 'list', items: [
            '[[+]] / [[−]] Zoom · [[0]] Ajuster · [[G]] Ma position · [[X]] Format des coordonnées. « Vers le nord » n’a pas de touche – c’est le rôle de la boussole, toujours visible et qui tourne avec la carte.',
            '[[J]] Journal · [[E]] Entrée · [[B]] Couches · [[⌘]] [[,]] Réglages · [[?]] cette aide.',
          ] },
        ],
      },
      {
        id: 'lage', title: 'Situation – carte', icon: 'map',
        blocks: [
          { kind: 'lead', text: 'La carte tactique par-dessus le fond de carte réel (zone d’intervention et environs).' },
          { kind: 'list', items: [
            '**Fond de carte** (en haut du panneau des couches) change le fond : Carto, OpenStreetMap ou satellite.',
            '**Agrandir/Réduire**, **Ajuster** et **Relever les coordonnées** en bas de la barre de droite. Lors du relevé, toucher la carte pour fixer un point (LV95 + WGS84) ; la boussole se réoriente au nord.',
            '**Vent** affiché en continu (direction + température) pour que la direction de propagation soit immédiatement visible.',
            '**Véhicules** apparaissent en direct par GPS (nom + orientation), votre propre position sous forme de point bleu discret.',
            '**Info bâtiment** en bas à gauche indique les dangers du bâtiment sur le lieu d’intervention (⚠ gaz · PV) et ouvre sa fiche : dangers, **Mesures immédiates** et Remarques en haut, les données des registres en dessous. À la première ouverture de l’intervention sur cet appareil, la fiche s’ouvre d’elle-même pour être lue – la carte reste utilisable. ✕ la ferme ; ensuite, la puce la rouvre. Un autre lieu ou objet avec du contenu l’affiche une nouvelle fois.',
          ] },
        ],
      },
      {
        id: 'ebenen', title: 'Couches et données', icon: 'layers',
        blocks: [
          { kind: 'lead', text: 'Via **Couches**, vous affichez les données des réseaux et des dangers – classées par type.' },
          { kind: 'list', items: [
            '**Situation** – symboles tactiques, véhicules, croquis et notes.',
            '**Corps** – constructions souterraines (garages, abris, tunnels) de la mensuration officielle, en tirets dès le zoom rue ; affichées par défaut.',
            '**Eau** – hydrantes, conduites, vannes, sources.',
            '**Eaux usées** – eaux sales/mixtes, eaux pluviales/propres, regards / grilles.',
            '**Gaz** – conduites.',
            '**Électricité** – lignes, installations PV.',
            '**Dangers** – crues, profondeur d’inondation.',
          ] },
          { kind: 'lead', text: 'Chaque couche peut être affichée/masquée et son opacité réglée.' },
          { kind: 'list', items: [
            '**Charger la carte hors ligne** (dans l’espace Couches) précharge les tuiles de carte, plans, symboles et géodonnées du lieu d’intervention.',
          ] },
          { kind: 'note', text: 'Les données des réseaux couvrent la zone d’intervention configurée et sont disponibles localement – elles fonctionnent aussi hors ligne.' },
        ],
      },
      {
        id: 'zeichnen', title: 'Dessin et symboles', icon: 'pen',
        blocks: [
          { kind: 'lead', text: 'Outils de la barre de droite en mode Situation.' },
          { kind: 'list', items: [
            '**Symbole** – le symbole tactique (FKS/VKF). Sélection rapide des symboles les plus courants ou recherche dans toute la bibliothèque. Toucher pour placer ; avec « Placer plusieurs », en poser plusieurs à la suite.',
            '**Formes** – dans la même fenêtre, après les dangers : **Flèche** et **Rectangle**, pour tout ce qui n’a pas de symbole tactique. La poignée fait pivoter, le coin étire le rectangle (la flèche reste proportionnelle – une pointe déformée se lit mal). Sur la flèche, **Barre d’arrêt** ajoute la barre en travers de la pointe – la limite de propagation : jusqu’ici, et arrêté là.',
            '**Sélection** – toucher des objets, les déplacer, les ajuster dans l’éditeur.',
            '**Multiple** – toucher **Sélection** une nouvelle fois pendant qu’elle est active : le bouton passe sur Multiple (icône et mot), et tirer un cadre sélectionne plusieurs symboles/dessins à la fois. Un nouveau toucher ramène à Sélection.',
            '**Ligne** – glisser ou toucher des points ; le style se choisit ensuite dans l’éditeur : **Main levée**, **Flèche** ou **Axe de sauvetage**. En dessous, la **Terminaison** – **Aucune**, **Flèche**, **Flèche avec arrêt** (la même barre en travers de la pointe) ou **Tronçon** ; **Inverser le sens** la place à l’autre bout sans déplacer la ligne.',
            '**Surface** – toucher les sommets (surface affichée dès 3 points) ; tirer/insérer/supprimer des sommets.',
            '**Périmètre de sécurité** – glisser du centre vers le bord fixe le rayon en mètres (remplissage réglable).',
            '**Note** – texte libre directement sur la carte.',
            '**Mesurer** – distance (longueur + profil altimétrique) ou surface (aire + périmètre). Tirer les points pour déplacer, toucher la ligne pour insérer des points intermédiaires, clic droit pour supprimer un point.',
          ] },
          { kind: 'sub', text: 'Préréglages des symboles' },
          { kind: 'lead', text: 'Chaque symbole n’apporte que les réglages utiles : **Rotation** pour les symboles orientés (flèches, échelles, parois), **Nombre** quand plusieurs comptent, **Étage** ou une **plage d’étages** (p. ex. escalier/ascenseur), **Propagation** pour les sinistres – plus les champs de saisie adaptés (p. ex. nom, substance, statut).' },
        ],
      },
      {
        id: 'plan', title: 'Plan – modules et bâtiments', icon: 'doc',
        blocks: [
          { kind: 'lead', text: 'Un tableau blanc par objet par-dessus les plans de module/bâtiment. Étage par étage, avec ses propres outils.' },
          { kind: 'list', items: [
            'En bas à gauche, à côté de l’échelle, l’**adresse** de l’objet chargé – toucher pour en choisir un autre. L’objet détermine les plans de la barre de gauche.',
            '**Symbole**, **Sélection**, **Dessiner** (couleur/épaisseur/type de ligne), **Note** (texte), **Équipe**.',
            '**Étages** en pile : avec les boutons **étage sup./sous-sol** sur le plan, ajouter un niveau au-dessus/en dessous.',
            '**Zoom/Ajuster** en bas de la barre d’outils, comme sur la carte.',
            '**Équipes** (binômes) sous forme de marqueurs colorés ; afficher/masquer les **Traces** montre leur trajet. Les pastilles d’équipe dont le binôme est « sorti » sont grisées/barrées.',
            '**Échelle** – toucher les deux extrémités de l’échelle imprimée et saisir la longueur réelle. Ensuite, lignes et surfaces affichent de vrais mètres (Mesurer, comme outil propre, n’existe que sur la carte).',
            'Une feuille **liée à la carte** mesure déjà d’elle-même – de même que la pile d’étages du bâtiment, qui connaît sa taille d’après l’emprise. La pastille y indique **réf. auto** au lieu d’une calibration ; la toucher ouvre l’ajustement ou dit d’où vient l’échelle. On ne calibre à la main que ce qui n’est pas lié.',
            '**Une note rapide à la main ?** Le plan est la surface de croquis : dessiner librement, barrer, griffonner. La carte reste structurée (symboles, lignes, notes) pour que le rapport et le journal restent propres.',
          ] },
          { kind: 'sub', text: 'Lier à la carte (géoréférence)' },
          { kind: 'list', items: [
            '**Lier à la carte**, en bas du plan, pose cette feuille sur la carte : le plan cède la moitié de la surface et la carte se place à côté. Sur un téléphone il n’y a pas de place pour les deux – un sélecteur **Carte / Module** passe alors de l’une à l’autre. Toucher le même endroit sur les deux surfaces – un angle de maison, une borne hydrante, un croisement. **L’ordre n’a pas d’importance** : une moitié posée trouve seule son homologue, et on peut passer d’une surface à l’autre à volonté. Deux points suffisent à poser la feuille.',
            'Le **feu tricolore** dans la barre dit en permanence où l’on en est : deux points donnent une solution exacte et donc **non vérifiée** – seul le troisième mesure l’écart (« 4 points · ⌀ 1.2 m »). **Vérifier la superposition** pose le contour de la feuille sur la carte pour un contrôle visuel.',
            'Tirer une croix la déplace, la toucher ouvre **Déplacer**, **Supprimer le point** ou **Garder**. Toucher **lié** ouvre l’**Ajustement** avec le nombre de paires et l’écart ; **Transférer** copie les points de référence sur un autre module du même objet, **Réinitialiser** les supprime (avec confirmation). **Fermer** n’abandonne rien – ce qui est posé est déjà enregistré.',
            'Dès lors, **les deux surfaces montrent les mêmes objets** – pas une copie, le même objet : le toucher montre les données, le tirer le déplace, mêmes sommets et mêmes poignées des deux côtés.',
            'Là où un objet **se trouve** est décidé par la dernière main qui l’a posé : tiré sur une feuille, il est sur la feuille – et suit la correction de l’ajustement. Tiré sur la carte, il est au sol. Un ajustement corrigé replace tout ce qui est posé sur cette feuille – une ligne au journal, qu’un ↶ annule. **Format du plan mesuré** est le même repositionnement sans intervention : l’app a mesuré la feuille ouverte et résolu l’ajustement à sa vraie forme. **Réinitialiser** une référence ne perd rien : la feuille et la carte gardent toutes deux ce qu’elles montrent.',
            'Dans les **Couches**, chaque feuille liée reçoit une ligne propre (« Plan (module 2) ») : la feuille elle-même, en image sous la carte. Les objets qui y sont posés n’ont plus besoin de ligne – ils appartiennent à la couche sur laquelle ils ont été posés.',
          ] },
          { kind: 'note', text: '**Dans quel sens se trouve le bâtiment ?** Un toucher sur la **flèche du nord** en haut à droite de la pile d’étages ouvre la petite fenêtre « Pivoter le bâtiment » : un curseur **Rotation** avec aperçu, plus **Nord en haut** et **Pivoter sur le grand axe** en un seul geste. Le contour tourne avec, les marquages restent où ils sont sur le bâtiment – et les pages d’étage imprimées montrent l’angle réglé.' },
        ],
      },
      {
        id: 'atemschutz', title: 'Binômes et surveillance ARI', icon: 'stopwatch',
        blocks: [
          { kind: 'lead', text: 'Surveillance sans faille de chaque binôme ARI selon FKS – le signal de sécurité est le **temps depuis le dernier contact radio**, et non une autonomie restante estimée.' },
          { kind: 'sub', text: 'Annoncer le binôme' },
          { kind: 'list', items: [
            '**Qui entre** : trois emplacements, celui du haut est le **chef de binôme** – toucher une ligne le désigne, le **✕** le retire. Un binôme plus grand ajoute simplement des lignes.',
            'La **recherche de personne** atteint tout l’effectif, pas seulement les présents ; à côté de chaque nom figure ce qui s’y oppose (absent, au dépôt, déjà dans un binôme). **(+)** enregistre un invité (renfort voisin) – ajouté en même temps à la présence, comme la même personne.',
            'La **pression d’entrée** (bar) et le **canal radio** sont juste à côté.',
            'En dessous, la **mission** : type (sous APR Sauver, Éteindre, Fouiller, Sécuriser, Reconnaître, Autre ; sans APR Circulation, Sanitaire, Alimentation en eau, Sécuriser, Mise à disposition, Autre), **but / lieu** en clair, **n° de conduite** (les conduites déjà dessinées sont proposées à côté) et la **couleur** sur la carte et le plan.',
            'La mission ne retient personne : **Annoncer le binôme** fonctionne sans elle. La carte affiche alors **« mission ouverte »**, et un toucher dessus ouvre le formulaire.',
            'Ce qui est saisi survit à une fermeture par **✕** ou par un clic à côté – seul **Annuler** l’efface.',
          ] },
          { kind: 'sub', text: 'Surveillance par binôme' },
          { kind: 'list', items: [
            'En grand, l’horloge **Depuis le dernier contact** : vert **Contact ok** → orange **Contact à faire** → rouge **En retard** (pas de contact en ~5 min) avec alarme.',
            '**Contact** (grand bouton) confirme le contact radio et réinitialise l’horloge.',
            '**Pression** réglée directement avec ± puis appliquée avec **Confirmer** – cela compte comme un contact et est journalisé ; une fausse manœuvre sans confirmer ne change rien. Une pression basse passe au rouge.',
            'Statut **Annoncé → En intervention → Repli → Sorti**. **Repli** peut être annulé avec **Poursuivre** ; un binôme sorti revient à la surveillance avec **Réengager** (nouvelle bouteille) — le **relevé de pression du premier engagement est conservé** et figure entièrement sur le rapport.',
            'Les binômes sortis gardent leur place sur le tableau (gris et atténués) au lieu de passer dans une section à part — la carte que vous cherchez est là où elle était.',
            'Un **binôme supprimé** ne quitte que le tableau : il figure toujours sur le rapport, avec tout ce qui a été mesuré, marqué «retiré du tableau». **Groupes retirés** dans l’en-tête le ramène — le message «annuler» est la porte rapide, pas la seule.',
            '**Journal** par binôme (dépliable) montre chaque contact avec l’heure et la pression.',
            '**Modifier** (crayon) ajuste la mission, le but/étage ou l’équipe en cours d’intervention.',
            'Une personne sous ARI ne peut pas être désengagée dans la **Présence** – toucher sa ligne saute à la carte de ce binôme et la met brièvement en évidence.',
            'Les binômes en retard remontent en haut et un compteur apparaît. La **cloche** coupe l’alarme par appareil – son **et** notification, et seulement jusqu’à la fin de cette intervention. Si elle est rouge, le navigateur n’a pas autorisé le son : la toucher. Le tableau lui-même n’est jamais muet. Tout est consigné au journal.',
            'Chaque binôme peut être placé sur le plan (bouton « montrer sur le plan »).',
          ] },
        ],
      },
      {
        id: 'anwesenheit', title: 'Présence et personnel', icon: 'people',
        blocks: [
          { kind: 'lead', text: 'Qui est engagé, et de quand à quand — la base de la feuille de personnel et des heures. L’effectif vient de l’administration ; ici on note seulement qui est là aujourd’hui.' },
          { kind: 'sub', text: 'Saisir' },
          { kind: 'list', items: [
            'Toucher une ligne la fait avancer : **libre → présent → parti → libre**. Le premier «présent» commence à l’**heure d’alarme** (on saisit en général après l’arrivée) ; un retour commence maintenant.',
            'Chaque ligne accepte une **remarque** («chauffeur TLF», «blessé, relevé 21:40»). Elle dit ce que cette personne a fait ici et figure sur la feuille de personnel. Si une ligne passe par «libre» par erreur, la remarque revient au prochain «présent».',
            '**Sur place** ou au **local** forme une paire dans la ligne — la réponse à «qui pourrait-on encore appeler». L’en-tête montre la répartition dès que quelqu’un est au local.',
            '**Autre personne** saisit quelqu’un qui n’est pas sur la liste (renfort, invité). C’est une affirmation sur cette intervention, pas sur l’effectif.',
            'Une personne **sous ARI** ne peut pas être désinscrite — un toucher saute à la carte de son groupe.',
          ] },
          { kind: 'sub', text: 'Corriger' },
          { kind: 'list', items: [
            '**Annuler / rétablir** reprend la dernière saisie (barre du haut ; sur téléphone dans l’en-tête de la présence). Le journal garde les deux : la saisie et la correction.',
            'Heures fausses ? Les **puces horaires** de la ligne corrigent de/à — aussi un bloc antérieur si la personne est venue deux fois.',
            'Les trois vues en haut : **Présence** (qui est là), **Horaire** (qui est disponible quand), **Tours** (relèves en bandes).',
          ] },
          { kind: 'note', text: 'La saisie fonctionne aussi **par QR** (affiche au local) : qui s’y inscrit apparaît ici — et les deux côtés peuvent toucher la même personne sans rien perdre.' },
        ],
      },
      {
        id: 'mittel', title: 'Matériel', icon: 'box',
        blocks: [
          { kind: 'lead', text: 'Ce qui a été engagé — depuis le catalogue du corps ou saisi librement. Le rapport en imprime la liste de matériel.' },
          { kind: 'list', items: [
            'Le **catalogue** vient de l’administration, avec unité et provenance («sur le TLF», «Pio»). **+** augmente la quantité, la ligne reste.',
            '**Autre matériel** saisit ce que le catalogue ne connaît pas — une désignation et une quantité suffisent.',
            'Là où un symbole de la carte représente du matériel (ventilateur, absorbant), sa fiche propose **«saisir comme moyen»** : un toucher plutôt que la même chose saisie deux fois.',
            'Mettre une quantité à **0** ne retire pas la ligne du procès-verbal — le rapport montre ce qui a été engagé et ce qui a été repris.',
          ] },
        ],
      },
      {
        id: 'zeitplan', title: 'Horaire et tours', icon: 'clock',
        blocks: [
          { kind: 'lead', text: 'Les deuxième et troisième vues de la présence : non pas «qui est là» mais **qui est disponible quand** — pour une intervention qui dure plus d’un tour.' },
          { kind: 'list', items: [
            'Dans l’**horaire** chaque personne a sa ligne ; tirer (ou le crayon) planifie une fenêtre de disponibilité. C’est un **plan**, pas un procès-verbal : il n’écrit aucune présence — celle-ci naît quand quelqu’un touche vraiment.',
            '**Confirmé** (plein) ou **proposé** (creux) — la différence entre «vient» et «pourrait venir».',
            'La **plage** en haut décide du nombre d’heures visibles à la fois.',
            'Dans **Tours**, les mêmes fenêtres sont groupées en bandes nommées («nuit 22–06») : créer une bande n’écrit aucun tour, et supprimer une bande ne supprime aucune disponibilité.',
            'Les deux vues s’impriment : via le **menu imprimante** de l’en-tête — **plan des tours** ou **disponibilités**, en PDF ou directement sur l’imprimante du local.',
          ] },
        ],
      },
      {
        id: 'checkliste', title: 'Checklist', icon: 'check',
        blocks: [
          { kind: 'lead', text: 'Deux colonnes : des tâches à dérouler et un référentiel tactique consultable.' },
          { kind: 'list', items: [
            '**Tâches** – listes de contrôle d’intervention (p. ex. conduite, rapport de situation) avec barre de progression ; cocher les points, les embranchements suivent des procédures à plusieurs étapes.',
            '**Tactique · mots-clés** – rechercher un mot-clé et ouvrir l’entrée correspondante (avec code couleur des dangers et croquis).',
            'Lors de la reprise d’une alarme, un mot-clé adapté est proposé automatiquement.',
          ] },
          { kind: 'lead', text: 'L’état est conservé et synchronisé sur tous les appareils.' },
        ],
      },
      {
        id: 'verlauf', title: 'Journal et entrée', icon: 'verlauf',
        blocks: [
          { kind: 'lead', text: 'Un journal partagé et continu à travers Situation et Plan – la chronique de l’intervention.' },
          { kind: 'list', items: [
            '**+ Entrée** (en haut à droite) : un appui court ouvre la saisie de texte. **Maintenir appuyé** déplie deux champs – **note vocale** en premier, **photo** au-delà. Le doigt glisse sur l’un des deux puis relâche. Le bouton devient alors une **✕** : relâcher sans avoir glissé annule et ne laisse rien. L’enregistrement ne démarre – et l’appareil photo ne s’ouvre – qu’au relâchement. Des photos peuvent aussi être jointes dans l’entrée même.',
            'Dès **deux lettres**, des noms sont proposés – effectif, matériel, organisations partenaires, véhicules et groupes d’alarme. Un toucher insère le nom entier ; il est mis en évidence dans le journal et sur le rapport imprimé. Il n’y a pas de champ « de » séparé : la phrase dit déjà qui a annoncé. Les postes **EL** et **Stv. EL** font aussi partie du vocabulaire : écrire le poste donne le nom («EL (Widmer Céline)»), écrire le nom donne le poste.',
            'Dès que la phrase se termine par un nom, **→** et **←** sont proposés à côté — un toucher écrit la flèche, et «EL → ambulance : patient stable» se lit comme le protocole radio qu’est le journal. Sur le papier cela devient «->».',
            'Tant que le champ est **vide**, des puces de départ attendent : d’abord **EL →**, puis les formulations déjà utilisées sur cette intervention (sinon la liste du corps). Elles restent jusqu’à ce que l’on tape vraiment — une deuxième puce s’ajoute à la première.',
            'Les actions importantes (symbole posé, dessin créé/supprimé …) sont consignées automatiquement au journal.',
            '**Annuler/Rétablir** s’applique à Situation, Plan – et à la **Présence**, où il reprend la dernière saisie (sur téléphone, la paire est dans l’en-tête de la présence).',
            'Une entrée de journal avec un lieu ramène à l’endroit dans la carte ou le plan quand on la touche ; photos et notes vocales s’ouvrent/se lisent directement dans le journal.',
            '**Démarrer la relecture** rejoue Situation et Plan à un instant antérieur (curseur temporel ; l’édition est bloquée pendant ce temps).',
          ] },
        ],
      },
      {
        id: 'einsatz', title: 'Gérer les interventions', icon: 'swap',
        blocks: [
          { kind: 'lead', text: 'Tout dans le menu d’intervention (nom en haut à gauche).' },
          { kind: 'list', items: [
            '**Changer d’intervention** parmi les interventions ouvertes ; **Nouvelle intervention** (lieu choisissable sur la carte).',
            '**Pool d’alarmes** – reprendre les alarmes entrantes (uniquement là où une source d’alarme est raccordée).',
            '**Interventions** – ouvrir l’archive / les interventions antérieures.',
            '**Clore l’intervention** clôture l’intervention en cours – le même dialogue que dans le rapport, avec le même compteur de ce qui reste ouvert.',
          ] },
        ],
      },
      {
        id: 'rapport', title: 'Rapport et clôture', icon: 'doc',
        blocks: [
          { kind: 'lead', text: 'Le **rapport d’intervention** est une zone à part dans la barre de gauche, sous Matériel ([[R]]) – une feuille de saisie préremplie, pas un formulaire à partir de zéro. Il se complète tout au long de l’intervention, pas seulement à la fin.' },
          { kind: 'list', items: [
            'Sur les écrans larges, deux colonnes : à gauche le **formulaire** à remplir (alarme, bref rapport, heures, remarques, retour à la centrale d’engagement), à droite la **mise en concordance** à cocher (présences, matériel, organisations partenaires, photos).',
            'Sous le titre figure ce qui est saisi – et, sous forme de pastilles distinctes, ce qui est **encore ouvert** : heures, présences, matériel, chef d’intervention, bref rapport, retour à la centrale. Rien de tout cela ne bloque jamais l’impression.',
            'L’**extrait du croquis** se trouve à côté du formulaire : déplacer, zoomer, **portrait/paysage** et l’**état du croquis** – quel moment l’image montre, avec des repères là où quelque chose s’est produit. Ce qui s’imprime est exactement ce qui est à l’écran ; il n’y a pas d’étape de confirmation.',
            '**Rapport d’intervention (PDF)** produit le rapport fini – rendu côté serveur, un seul bouton. Le **▾** à côté ouvre **« Sections »** : ce qui part sur le papier (croquis, plans, protection respiratoire, présences, matériel, journal, photos, preuve de vérification détaillée). Le menu reste ouvert pendant que l’on coche.',
            'Là où un corps exploite une **imprimante de caserne** : **Imprimer** met le rapport dans sa file d’attente. Mis en file n’est pas imprimé – tant qu’un travail reste en suspens, il figure comme **impression en attente** sous l’en-tête du rapport, avec **Vérifier** et **Annuler**. Le rapport ne compte comme établi que lorsque l’imprimante annonce «imprimé».',
            'Si le corps a déposé ses propres formulaires (Administration › Rapport), **Formulaires et liens** apparaît sous les photos – une liste à cocher. **Ouvrir** appelle le formulaire avec le mot-clé, le lieu, la date et le chef d’intervention déjà remplis, dans la mesure où le lien le prévoit. La coche se met à la main : l’application ne voit pas si un formulaire a été envoyé.',
            'Si quelque chose cloche dans l’enregistrement – une chaîne de vérification rompue, une note vocale sans transcription, une photo encore en file d’attente –, une **pastille d’avertissement orange** apparaît à côté des boutons. Elle compte les points et les ouvre ; si tout est en ordre, elle n’apparaît pas.',
            'La personne de contact et le retour à la centrale portent un **Sans objet** en fin de ligne – pour la fausse alarme ou la nappe d’huile où ni l’un ni l’autre n’existe. C’est une réponse, pas un contournement : elle est consignée et figure ainsi au rapport.',
            '**Clore l’intervention** clôt l’intervention et fixe l’heure de fin. Les photos et notes vocales non encore envoyées partent d’abord ; si c’est impossible (hors ligne), elles sont **conservées** et partiront à la prochaine ouverture — la confirmation dit combien.',
            '**Transmettre** (en bas du rapport, et sous **Partager l’intervention** dans le menu de l’intervention) : un lien vers cette intervention uniquement – carte, plans, journal, photos, heures. Lecture seule, sans connexion, rien ne peut être modifié. Pour la centrale, le CI et un corps voisin pendant l’intervention – et pour la commune et les corps voisins après : il reste valable au-delà de la clôture, jusqu’à ce que quelqu’un le révoque.',
          ] },
          { kind: 'note', text: 'Une intervention close peut être **rouverte** – les compléments ultérieurs apparaissent dans le journal et dans le rapport comme **ajouts**, et rien n’est perdu.' },
        ],
      },
      {
        id: 'erfassung', title: 'Saisie par QR code', icon: 'cam',
        blocks: [
          { kind: 'lead', text: 'Là où un corps a activé la saisie (Administration › Saisie), un **poster QR** au dépôt ouvre la vue de saisie – sans connexion, pour tous ceux qui n’ont pas accès à une tablette.' },
          { kind: 'list', items: [
            'On choisit l’intervention en cours ; les **présences** et le **matériel** se saisissent depuis son propre téléphone.',
            'Un nom avance en le touchant : **absent → dépôt → sur place → parti**. Le **ⓘ** à côté de la recherche le redit, y compris ce que signifie l’heure à côté (de = arrivée, à = départ).',
            'Les données rejoignent la **même intervention** que la tablette du poste de commandement et sont fusionnées (avec un avis de contrôle en cas d’écart).',
            'En repli, il existe la **feuille de saisie vierge (PDF)** à imprimer et à compléter à la main.',
          ] },
        ],
      },
      {
        id: 'sync', title: 'Multi-appareils et hors ligne', icon: 'check',
        blocks: [
          { kind: 'lead', text: 'Tous les appareils voient la même intervention en direct.' },
          { kind: 'list', items: [
            'Les modifications sont partagées automatiquement ; le badge de synchro en haut indique l’état (enregistré/en attente).',
            'Les éditions simultanées sont fusionnées par objet (la modification la plus récente l’emporte).',
            '**Lecture seule** : les observateurs et les téléphones voient la situation en direct, sans les outils tactiques.',
          ] },
          { kind: 'sub', text: 'Hors ligne' },
          { kind: 'list', items: [
            'La **Préparation hors ligne** dans les **Réglages** ([[⌘]] [[,]]) est sur **Automatique** : l’application installée va chercher d’elle-même carte, plans, symboles et couches de référence peu après l’ouverture d’une intervention – sans dialogue, sans notification. **Toutes** les couches cartographiques configurées sont chargées, y compris celle qui est masquée : l’expérience montre qu’on l’active une fois le réseau déjà perdu. **Manuel seulement** laisse cela au bouton **Tout charger pour le hors ligne**.',
            'La quantité chargée dépend du **Rayon hors ligne** (également dans les Réglages, valable uniquement sur cet appareil) : un rayon plus petit = un téléchargement plus rapide et plus léger.',
            'Ce qui est réellement prêt est indiqué par la **Préparation hors ligne** du menu d’intervention – ligne par ligne : carte, plans, symboles, matières dangereuses, couches de référence, personnel, stockage de l’appareil. **Météo** et **Recherche d’objets** exigent une connexion et y figurent comme « en ligne seulement ».',
            'Seule l’**application installée** est fiable hors ligne. Dans un onglet de navigateur, le stockage peut être vidé à tout moment, et l’onglet devrait encore être ouvert à la prochaine intervention.',
            'Sans réseau, tout ce qui est sur l’appareil continue de fonctionner : dessiner et poser des symboles, ARI, présence, matériel, journal et rapport. Photos et notes vocales restent enregistrées et partent plus tard.',
            'Dès que le réseau revient, les modifications partent d’elles-mêmes et sont fusionnées avec les autres appareils – par objet, la modification la plus récente l’emporte. Tant que quelque chose est en attente, le badge de synchro en haut le dit.',
          ] },
        ],
      },
      {
        id: 'bedienung', title: 'Utilisation et jour/nuit', icon: 'move',
        blocks: [
          { kind: 'sub', text: 'Toucher et glisser (tactile/iPad)' },
          { kind: 'list', items: [
            'Un doigt déplace la carte/le plan ; deux doigts zooment (pincer).',
            'Un seul doigt zoome aussi : **toucher deux fois** zoome ; **toucher, puis appuyer de nouveau et tirer** zoome en continu – vers le bas pour agrandir, vers le haut pour réduire. Pareil sur la carte et le plan, avec la **Sélection**. Un outil a la priorité : là où il touche (points, mesure, ajouter, note, cercle …), chaque toucher lui appartient ; là où il trace (main levée, sélection multiple), toucher deux fois zoome toujours. Deux doigts zooment toujours. Une ligne ou une surface posée point par point se termine avec ✓, jamais en touchant deux fois.',
            'Toucher **Sélection** une nouvelle fois fait passer le bouton sur **Multiple** : un cadre tiré sélectionne plusieurs objets ; les objets sélectionnés se déplacent en les tirant.',
            'Un bouton qui ne porte qu’un pictogramme dit son mot quand on le **maintient enfoncé** : après un court instant, le mot apparaît en bulle au-dessus, avec une brève vibration sur tactile. Relâcher ne déclenche **pas** le bouton : demander ce qu’est une chose ne doit pas la faire en même temps. À la souris, il suffit de survoler.',
          ] },
          { kind: 'sub', text: 'Souris', only: 'keyboard' },
          { kind: 'list', only: 'keyboard', items: [
            'La molette zoome ; **clic droit** (ou appui long) sur un point de mesure/de ligne le supprime, un clic sur une ligne insère un point intermédiaire.',
          ] },
          { kind: 'sub', text: 'Touches', only: 'keyboard' },
          { kind: 'list', only: 'keyboard', items: [
            '[[Échap]] annule l’outil actif ou désélectionne.',
            '[[Suppr]] / [[Retour arrière]] supprime la sélection (pas pendant la saisie dans un champ).',
          ] },
          { kind: 'sub', text: 'Jour / nuit' },
          { kind: 'list', items: [
            'Commutable dans le menu d’intervention – le mode nuit atténue la carte et l’interface pour l’obscurité.',
          ] },
        ],
      },
      {
        id: 'verwaltung', title: 'Administration et données de la station', icon: 'gear',
        blocks: [
          { kind: 'lead', text: 'Tout ce qui vaut pour l’ensemble du corps – personnel, grades, véhicules, matériel, couches cartographiques, plans d’objet, checklists – se gère sous **Administration**, pas pendant une intervention. L’accès a son propre mot de passe, ce n’est pas le NIP d’intervention.' },
          { kind: 'sub', text: 'Le classeur (Excel)' },
          { kind: 'list', items: [
            'Sous **Daten › Arbeitsmappe**, les listes du corps forment un seul fichier Excel : le télécharger, le modifier dans Excel, Numbers ou LibreOffice, le réimporter. Huit feuilles – Mannschaft, Dienstgrade, Fahrzeuge, Mittel, Mittel-Bestände, Quellen, Partnerorganisationen, Symbolfelder (les noms d’onglet restent en allemand).',
            'Une **prévisualisation** précède toujours l’écriture : feuille par feuille, ce qui serait nouveau, ce qui change, ce qui disparaît – et chaque ligne refusée avec sa feuille et son numéro. Rien n’est écrit avant la confirmation, et annuler n’écrit rien.',
            'Réimporter le même fichier ne change absolument rien. Le téléchargement est donc aussi le modèle – et on peut le prendre sans risque juste pour regarder.',
          ] },
          { kind: 'note', text: '**Une feuille absente n’est pas une feuille vide.** Supprimer une feuille entière du fichier laisse cette liste inchangée. N’en supprimer que les lignes en gardant la ligne de titre la vide – c’est exactement ainsi qu’on vide une liste volontairement.' },
          { kind: 'note', text: '**«Absent» veut dire deux choses.** Une personne absente de la feuille Mannschaft est **désactivée**, jamais supprimée – les interventions clôturées résolvent son nom par cette ligne. Un identifiant absent d’une des autres listes est **supprimé**. La prévisualisation emploie ces deux mots et nomme les lignes au lieu de les compter.' },
          { kind: 'sub', text: 'Si malgré tout ça tourne mal' },
          { kind: 'list', items: [
            'Chaque modification des **listes** conserve l’état précédent : **Sicherung › Letzte Änderungen** les liste avec l’heure et en restaure un – que l’auteur soit un formulaire, le classeur ou un terminal.',
            '**Le personnel n’y figure pas.** Les personnes sont des enregistrements propres, pas de la configuration – un import qui ne touche que la feuille Mannschaft n’apparaît pas du tout sous «Letzte Änderungen». En contrepartie personne n’y est jamais supprimé, seulement désactivé : annuler revient à réactiver. Pour restaurer la liste entière, reprenez le fichier téléchargé avant l’import.',
            'Le classeur n’est **pas une sauvegarde** : il ne couvre que les listes. La sauvegarde est l’export JSON sous **Sicherung**.',
          ] },
        ],
      },
    ],

    search: 'Rechercher dans l\'aide …',
    searchHint: 'Essaie un autre mot-clé – la recherche porte sur les titres et le texte.',
  },
}
