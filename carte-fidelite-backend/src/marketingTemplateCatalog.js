const TYPES_SUPPORT = {
  wallet: {
    id: 'wallet',
    nom: 'Faire ajouter la carte Wallet',
    description: 'Le client scanne le flyer pour installer sa carte de fidélité.',
    lien: 'loyalty',
    titreParDefaut: 'Votre fidélité mérite mieux',
    sousTitreParDefaut: 'Carte de fidélité'
  },
  wheel: {
    id: 'wheel',
    nom: 'Collecter un avis & lancer la roue',
    description: 'Le client scanne, laisse son avis puis tente de gagner un cadeau.',
    lien: 'review',
    titreParDefaut: 'Faites tourner la roue et gagnez !',
    sousTitreParDefaut: 'Tentez votre chance à chaque visite'
  }
};

const FORMATS = {
  'a6-portrait': { id: 'a6-portrait', nom: 'A6 portrait', description: 'Format unique · 105 × 148 mm', largeurMm: 105, hauteurMm: 148 }
};

const STYLES = {
  premium: {
    id: 'premium', nom: 'Premium', description: 'Sombre, profond et sophistiqué', sombre: true,
    fond: '#15111F', surface: '#241B33', primaire: '#7C4DFF', secondaire: '#CDBCF6', accent: '#D6B15E', texte: '#FFFFFF', texteAttenue: '#D5CBE7', police: 'Helvetica, Arial, sans-serif'
  },
  fun: {
    id: 'fun', nom: 'Fun', description: 'Énergique, coloré et généreux', sombre: false,
    fond: '#FFF5E7', surface: '#FFE1B8', primaire: '#6C3CE9', secondaire: '#FFB38C', accent: '#FF7A3D', texte: '#271934', texteAttenue: '#6D5C75', police: 'Helvetica, Arial, sans-serif'
  },
  minimal: {
    id: 'minimal', nom: 'Minimal', description: 'Clair, précis et intemporel', sombre: false,
    fond: '#F7F7F5', surface: '#FFFFFF', primaire: '#17171D', secondaire: '#D7D7D2', accent: '#8A8A86', texte: '#17171D', texteAttenue: '#62625E', police: 'Helvetica, Arial, sans-serif'
  },
  'street-food': {
    id: 'street-food', nom: 'Street food', description: 'Franc, contrasté et urbain', sombre: true,
    fond: '#171717', surface: '#292929', primaire: '#FF4D2E', secondaire: '#FFD95C', accent: '#FFCC00', texte: '#FFFFFF', texteAttenue: '#D4D4D4', police: 'Arial Black, Helvetica, sans-serif'
  },
  elegant: {
    id: 'elegant', nom: 'Élégant', description: 'Raffiné, chaleureux et éditorial', sombre: true,
    fond: '#17251F', surface: '#23372E', primaire: '#315B49', secondaire: '#F0E3CA', accent: '#C9A46A', texte: '#FFFDF8', texteAttenue: '#D8D0C2', police: 'Georgia, Times New Roman, serif'
  },
  modern: {
    id: 'modern', nom: 'Moderne', description: 'Graphique, net et contemporain', sombre: false,
    fond: '#EEF4FF', surface: '#FFFFFF', primaire: '#2357FF', secondaire: '#A9C4FF', accent: '#00A88F', texte: '#101B3A', texteAttenue: '#52617E', police: 'Helvetica, Arial, sans-serif'
  }
};

const PHOTOS_DEFAUT = [
  ['food-flatlay.webp', 'Cuisine généreuse'], ['pizza-restaurant.webp', 'Restaurant italien'],
  ['burger-restaurant.webp', 'Burger gourmand'], ['ramen-restaurant.webp', 'Ramen japonais'],
  ['pizza-wings-frites.webp', 'Pizza, ailes et frites'], ['petit-dejeuner-gourmand.webp', 'Petit-déjeuner gourmand'],
  ['tacos-mexicains.webp', 'Tacos mexicains'], ['bol-healthy.webp', 'Cuisine healthy'],
  ['rooftop-cocktail.webp', 'Rooftop de nuit'], ['surf-sunset.webp', 'Coucher de soleil'],
  ['lac-montagne-turquoise.webp', 'Lac de montagne'], ['foret-lac-bois-flotte.webp', 'Nature']
].map(([fichier, nom]) => ({ id: fichier.replace('.webp', ''), nom, url: `/wallet-banners/${fichier}`, source: 'Bravocard' }));

const ANCIENS_SUPPORTS = {
  'loyalty-square': { kind: 'wallet', format_layout: 'a6-portrait' },
  'review-square': { kind: 'wheel', format_layout: 'a6-portrait' },
  'loyalty-poster-a5': { kind: 'wallet', format_layout: 'a6-portrait' }
};

function listerTypes() { return Object.values(TYPES_SUPPORT); }
function listerFormats() { return Object.values(FORMATS); }
function listerStyles() { return Object.values(STYLES); }

module.exports = { TYPES_SUPPORT, FORMATS, STYLES, PHOTOS_DEFAUT, ANCIENS_SUPPORTS, listerTypes, listerFormats, listerStyles };
