// French copy · the Karte: tools, nav, views, hints.
// One slice of the `fr` overlay, assembled in ../fr.ts; the German base is ../de/map.ts.

import type { Copy, Localizable } from '../index'

type Keys =
  | 'mapTools' | 'planTools' | 'nav' | 'mapViews' | 'toast' | 'dockHints' | 'map'

export const mapCopy: Localizable<Pick<Copy, Keys>> = {
  mapTools: [
    { id: 'select', icon: 'select', label: 'Sélection', kind: 'tool', alt: { id: 'lasso', icon: 'marquee', label: 'Multiple' } },
    { id: 'symbol-slot', slot: true, icon: '', label: '' },
    { id: 'line', icon: 'pen', label: 'Ligne', kind: 'tool' },
    { id: 'area', icon: 'area', label: 'Surface', kind: 'tool' },
    { id: 'circle', icon: 'circle', label: 'Périmètre de sécurité', kind: 'tool' },
    { id: 'note', icon: 'type', label: 'Note', kind: 'tool' },
    { id: 'team', icon: 'flag', label: 'Équipe', kind: 'tool' },
    { id: 'measure', icon: 'measure', label: 'Mesurer', kind: 'tool' },
  ],
  planTools: [
    { id: 'pan', icon: 'select', label: 'Sélection', alt: { id: 'lasso', icon: 'marquee', label: 'Multiple' } },
    { id: 'symbol-slot', slot: true, icon: '', label: '' },
    { id: 'line', icon: 'pen', label: 'Ligne' },
    { id: 'area', icon: 'area', label: 'Surface' },
    { id: 'circle', icon: 'circle', label: 'Périmètre de sécurité' },
    { id: 'text', icon: 'type', label: 'Note' },
    { id: 'resource', icon: 'flag', label: 'Équipe' },
    { id: 'measure', icon: 'measure', label: 'Mesurer' },
  ],
  nav: {
    zoomIn: 'Agrandir',
    zoomOut: 'Réduire',
    fit: 'Ajuster',
    resetNorth: 'Orienter au nord',
    centerIncident: 'Centrer sur l’intervention',
    coords: 'Relever les coordonnées',
    coordsHint: 'Toucher la carte pour fixer',
    coordsLocked: 'Fixé – ✕ pour terminer',
    coordsExit: 'Quitter les coordonnées',
    autoMode: 'Automatique',
    deviceMode: 'Appareil',
    dayMode: 'Jour',
    nightMode: 'Nuit',
  },
  toast: {
    audioSaved: 'Note audio enregistrée ({secs}s)',
    micDenied: 'Pas d’accès au micro – noté comme marqueur',
    micFailed: 'L’enregistrement n’a pas pu démarrer.',
    merged: 'Modifications fusionnées',
  },
  dockHints: {
    lasso: 'Tirez un cadre autour de plusieurs objets avec un doigt. Deux doigts déplacent toujours la carte. Toucher «Multiple» une nouvelle fois ramène à Sélection.',
    line: 'Glissez sur la carte ou touchez des points pour tracer une ligne. Couleur, épaisseur et style se choisissent ensuite dans l’éditeur.',
    lineFreehand: 'Glissez pour tracer une ligne. Pour des points isolés : « Points ». Couleur, épaisseur et style se choisissent ensuite dans l’éditeur.',
    lineNodes: 'Touchez des points, terminez avec ✓. Couleur, épaisseur et style se choisissent ensuite dans l’éditeur.',
    area: 'Glisser trace le contour à main levée – pour un front de feu sans angles. Ou touchez au moins trois sommets, terminez avec ✓.',
    circle: 'Glissez du centre vers l’extérieur pour fixer le rayon en mètres. Ajustez ensuite le rayon et le remplissage dans l’éditeur.',
    note: 'Touchez la carte pour poser une note.',
    shape: 'Touchez la carte pour placer la forme. Activez « Placer plusieurs » pour en poser plusieurs à la suite.',
    rotationStart: 'Toucher le premier point — là où l’eau est puisée. Maintenir sur un symbole jusqu’à ce que l’anneau se ferme pour poser le point dessus.',
    rotationEnd: 'Toucher le second point — le sinistre. Toucher deux fois le même point pose une Rotation de longueur standard.',
    measure: 'Touchez des points sur la carte. La distance affiche la longueur et le profil altimétrique, la surface affiche l’aire et le périmètre. Tirez les points pour déplacer, le + au milieu d’un segment insère un point intermédiaire, maintenez un point (clic droit sur ordinateur) pour le supprimer.',

    team: 'Touche la carte et choisis le binôme dans la liste. Glisse pour le déplacer.',
  },
  map: {
    incidentHere: 'Lieu d’intervention',
    youHere: 'Ma position',
    glLost: 'Affichage de la carte interrompu',
    glLostHint: 'L’appareil a libéré le contexte graphique de la carte. Vos saisies sont enregistrées.',
    glLostAction: 'Reconstruire la carte',
    noTilesTitle: 'Aucun fond de carte enregistré pour cette zone',
    noTilesSub: 'Hors ligne – objets et lignes affichés sans carte',
    noTilesAction: 'Préparation hors ligne',
    noTilesDismiss: 'Masquer',
  },
  mapViews: {
    title: 'Vues',
    north: 'Vers le nord',
    fit: 'Ajuster',
    locate: 'Ma position',
    save: 'Enregistrer la vue',
    hint: 'Une vue enregistre la carte telle qu\'elle est – position, zoom et rotation. Touche une vue enregistrée pour y sauter (p. ex. entre une vue générale au nord et la carte tournée comme tu es placé). Appui long sur la boussole : ajuster directement.',
    rename: 'Renommer',
    delete: 'Supprimer',
    saved: 'Vue enregistrée',
    deleteTitle: 'Supprimer la vue',
    deleteMsg: 'Supprimer «{name}» ?',
  },
}
