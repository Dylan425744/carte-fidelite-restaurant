// Niveaux VIP (Bronze / Argent / Or), calcules a partir du total de points
// gagnes depuis toujours par le client (jamais remis a zero), independamment
// du solde utilisable qui repart a 0 a chaque recompense recuperee. Sans
// quoi un client fidele redescendrait injustement de niveau juste apres
// avoir profite de sa recompense.

const NIVEAUX = ['bronze', 'argent', 'or'];
const LIBELLES = { bronze: 'Bronze', argent: 'Argent', or: 'Or' };

function nettoyerTexteOptionnel(valeur, longueurMax, nomChamp) {
  const texte = String(valeur || '').trim().replace(/\s+/g, ' ');
  if (texte.length > longueurMax) {
    throw new Error(`${nomChamp} ne peut pas dépasser ${longueurMax} caractères.`);
  }
  return texte;
}

function calculerNiveau(restaurant, pointsCumules) {
  if (!restaurant?.vip_actif) return null;

  const points = Number(pointsCumules) || 0;
  const seuilOr = Number(restaurant.vip_seuil_or);
  const seuilArgent = Number(restaurant.vip_seuil_argent);

  if (Number.isFinite(seuilOr) && seuilOr > 0 && points >= seuilOr) return 'or';
  if (Number.isFinite(seuilArgent) && seuilArgent > 0 && points >= seuilArgent) return 'argent';
  return 'bronze';
}

function libelleNiveau(niveau) {
  return LIBELLES[niveau] || '';
}

function rangNiveau(niveau) {
  return NIVEAUX.indexOf(niveau);
}

// Multiplicateur de points applique au moment du scan. Toujours 1 (aucun
// bonus) si le systeme de niveaux ou l'option bonus n'est pas active.
function obtenirMultiplicateur(restaurant, niveau) {
  if (!restaurant?.vip_actif || !restaurant?.vip_bonus_actif || !niveau) return 1;
  if (niveau === 'or') return Number(restaurant.vip_multiplicateur_or) || 1;
  if (niveau === 'argent') return Number(restaurant.vip_multiplicateur_argent) || 1;
  return 1;
}

// Texte d'avantage affiche sur la carte et a destination de l'equipe au
// comptoir. Vide si l'option avantage manuel n'est pas active.
function obtenirAvantageTexte(restaurant, niveau) {
  if (!restaurant?.vip_actif || !restaurant?.vip_avantage_manuel_actif || !niveau) return '';
  if (niveau === 'or') return String(restaurant.vip_avantage_or || '').trim();
  if (niveau === 'argent') return String(restaurant.vip_avantage_argent || '').trim();
  return '';
}

function construireMiseAJourVip(donnees) {
  const actif = Boolean(donnees.vip_actif);
  const avantageManuelActif = Boolean(donnees.vip_avantage_manuel_actif);
  const bonusActif = Boolean(donnees.vip_bonus_actif);

  const nombreOuNull = valeur =>
    (valeur === '' || valeur === null || valeur === undefined) ? null : Number(valeur);

  const seuilArgent = nombreOuNull(donnees.vip_seuil_argent);
  const seuilOr = nombreOuNull(donnees.vip_seuil_or);

  if (actif) {
    if (!Number.isInteger(seuilArgent) || seuilArgent < 1) {
      throw new Error('Le seuil du niveau Argent doit être un nombre entier positif.');
    }
    if (!Number.isInteger(seuilOr) || seuilOr <= seuilArgent) {
      throw new Error('Le seuil du niveau Or doit être un nombre entier supérieur au seuil Argent.');
    }
  }

  const avantageArgent = nettoyerTexteOptionnel(donnees.vip_avantage_argent, 90, 'L’avantage Argent');
  const avantageOr = nettoyerTexteOptionnel(donnees.vip_avantage_or, 90, 'L’avantage Or');
  if (avantageManuelActif && (!avantageArgent || !avantageOr)) {
    throw new Error('Renseignez l’avantage Argent et l’avantage Or avant d’activer l’avantage manuel.');
  }

  const multiplicateurArgent = nombreOuNull(donnees.vip_multiplicateur_argent);
  const multiplicateurOr = nombreOuNull(donnees.vip_multiplicateur_or);
  if (bonusActif) {
    if (!Number.isFinite(multiplicateurArgent) || multiplicateurArgent < 1 || multiplicateurArgent > 5) {
      throw new Error('Le multiplicateur Argent doit être compris entre 1 et 5.');
    }
    if (!Number.isFinite(multiplicateurOr) || multiplicateurOr < 1 || multiplicateurOr > 5) {
      throw new Error('Le multiplicateur Or doit être compris entre 1 et 5.');
    }
  }

  return {
    vip_actif: actif,
    vip_seuil_argent: seuilArgent,
    vip_seuil_or: seuilOr,
    vip_avantage_manuel_actif: avantageManuelActif,
    vip_avantage_argent: avantageArgent,
    vip_avantage_or: avantageOr,
    vip_bonus_actif: bonusActif,
    vip_multiplicateur_argent: multiplicateurArgent,
    vip_multiplicateur_or: multiplicateurOr
  };
}

function serialiserReglagesVip(restaurant) {
  return {
    vip_actif: Boolean(restaurant.vip_actif),
    vip_seuil_argent: restaurant.vip_seuil_argent ?? null,
    vip_seuil_or: restaurant.vip_seuil_or ?? null,
    vip_avantage_manuel_actif: Boolean(restaurant.vip_avantage_manuel_actif),
    vip_avantage_argent: restaurant.vip_avantage_argent || '',
    vip_avantage_or: restaurant.vip_avantage_or || '',
    vip_bonus_actif: Boolean(restaurant.vip_bonus_actif),
    vip_multiplicateur_argent: restaurant.vip_multiplicateur_argent ?? null,
    vip_multiplicateur_or: restaurant.vip_multiplicateur_or ?? null
  };
}

module.exports = {
  NIVEAUX,
  calculerNiveau,
  libelleNiveau,
  rangNiveau,
  obtenirMultiplicateur,
  obtenirAvantageTexte,
  construireMiseAJourVip,
  serialiserReglagesVip
};
