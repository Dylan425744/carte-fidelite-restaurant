const crypto = require('crypto');

// "standard" verrouille la roue comme un tour normal (gain reel ou perdu).
// "rejouer" ne verrouille rien : le client peut relancer immediatement.
const LOTS_PAR_DEFAUT = [
  { label: 'Menu offert', icone: '🍽️', probabilite: 5, type: 'standard' },
  { label: '-10% addition', icone: '🏷️', probabilite: 20, type: 'standard' },
  { label: 'Dessert offert', icone: '🍰', probabilite: 10, type: 'standard' },
  { label: 'Boisson offerte', icone: '🥤', probabilite: 30, type: 'standard' },
  { label: 'Rejouez', icone: '🔁', probabilite: 15, type: 'rejouer' },
  { label: 'Perdu !', icone: '🙈', probabilite: 20, type: 'standard' }
];

const NB_LOTS_MIN = 2;
const NB_LOTS_MAX = 8;

// Nombre de jours avant que le cadeau devienne utilisable, et pendant combien
// de jours il reste valable une fois debloque.
const DELAI_AVANT_CADEAU_JOURS = 1;
const DUREE_VALIDITE_CADEAU_JOURS = 7;

function lotsRestaurant(restaurant) {
  if (Array.isArray(restaurant?.roue_lots) && restaurant.roue_lots.length >= NB_LOTS_MIN) {
    return restaurant.roue_lots;
  }
  return LOTS_PAR_DEFAUT;
}

function validerLots(lotsRecus) {
  if (!Array.isArray(lotsRecus) || lotsRecus.length < NB_LOTS_MIN || lotsRecus.length > NB_LOTS_MAX) {
    throw new Error(`La roue doit contenir entre ${NB_LOTS_MIN} et ${NB_LOTS_MAX} lots.`);
  }
  return lotsRecus.map((lot, index) => {
    const label = String(lot?.label || '').trim();
    const icone = String(lot?.icone || '').trim();
    const probabilite = Number(lot?.probabilite);
    const type = lot?.type === 'rejouer' ? 'rejouer' : 'standard';
    if (!label || label.length > 40) {
      throw new Error(`Le lot ${index + 1} doit avoir un nom entre 1 et 40 caractères.`);
    }
    if (!icone || [...icone].length > 4) {
      throw new Error(`Le lot ${index + 1} doit avoir un pictogramme (emoji).`);
    }
    if (!Number.isFinite(probabilite) || probabilite <= 0 || probabilite > 100) {
      throw new Error(`Le lot ${index + 1} doit avoir une probabilité entre 1 et 100.`);
    }
    return { label, icone, probabilite, type };
  });
}

function validerCouleur(valeur) {
  const texte = String(valeur || '').trim().toUpperCase();
  if (!texte) return null;
  if (!/^#[0-9A-F]{6}$/.test(texte)) throw new Error('La couleur doit être au format #6C3CE9.');
  return texte;
}

// Tirage pondere generique : fonctionne pour n'importe quel jeu de lots
// (par defaut ou personnalise par le restaurant), plus de constante globale.
function tirerUnLot(lots) {
  const total = lots.reduce((somme, lot) => somme + Number(lot.probabilite || 0), 0);
  let tirage = Math.random() * total;
  for (let index = 0; index < lots.length; index += 1) {
    tirage -= Number(lots[index].probabilite || 0);
    if (tirage < 0) {
      const lot = lots[index];
      return { index, label: lot.label, icone: lot.icone, type: lot.type === 'rejouer' ? 'rejouer' : 'standard' };
    }
  }
  const dernierIndex = lots.length - 1;
  const dernierLot = lots[dernierIndex];
  return { index: dernierIndex, label: dernierLot.label, icone: dernierLot.icone, type: dernierLot.type === 'rejouer' ? 'rejouer' : 'standard' };
}

function calculerValiditeCadeau() {
  const maintenant = new Date();
  const dateDebut = new Date(maintenant);
  dateDebut.setDate(dateDebut.getDate() + DELAI_AVANT_CADEAU_JOURS);
  dateDebut.setHours(0, 0, 0, 0);
  const dateFin = new Date(dateDebut);
  dateFin.setDate(dateFin.getDate() + DUREE_VALIDITE_CADEAU_JOURS);
  dateFin.setHours(23, 59, 59, 0);
  return { dateDebut, dateFin };
}

// Code court a dicter/presenter au comptoir : lettres+chiffres sans caracteres
// ambigus (0/O, 1/I) pour eviter les erreurs de lecture.
function genererCodeRetrait() {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let code = '';
  for (let i = 0; i < 6; i += 1) {
    code += alphabet[crypto.randomInt(alphabet.length)];
  }
  return code;
}

module.exports = {
  LOTS_PAR_DEFAUT,
  NB_LOTS_MIN,
  NB_LOTS_MAX,
  lotsRestaurant,
  validerLots,
  validerCouleur,
  tirerUnLot,
  calculerValiditeCadeau,
  genererCodeRetrait
};
