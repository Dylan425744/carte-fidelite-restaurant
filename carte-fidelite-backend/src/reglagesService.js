// Reglages : informations generales du restaurant, centralisees en un seul
// endroit. Ces valeurs servent de defaut pour Wallet, la roue et le kit de
// communication quand ceux-ci n'ont pas ete personnalises individuellement :
// une personnalisation specifique deja faite n'est jamais ecrasee.

const { validerImage, nettoyerTexte } = require('./restaurantDesignService');
const roueService = require('./roueService');

const NOMS_GENERIQUES = ['restaurant', 'commerce', 'mon restaurant', 'test', 'nouveau restaurant'];

function nettoyerTexteOptionnel(valeur, longueurMax, nomChamp) {
  const texte = String(valeur || '').trim().replace(/\s+/g, ' ');
  if (texte.length > longueurMax) {
    throw new Error(`${nomChamp} ne peut pas dépasser ${longueurMax} caractères.`);
  }
  return texte || null;
}

function validerCouleurHex(valeur, nomChamp) {
  const couleur = String(valeur || '').trim().toUpperCase();
  if (!couleur) return null;
  if (!/^#[0-9A-F]{6}$/.test(couleur)) {
    throw new Error(`${nomChamp} doit être au format #1B1030.`);
  }
  return couleur;
}

function validerUrlHttps(valeur, nomChamp) {
  const texte = String(valeur || '').trim();
  if (!texte) return null;
  try {
    const url = new URL(texte);
    if (url.protocol === 'https:') return texte;
  } catch {
    // Le message commun ci-dessous explique le format attendu.
  }
  throw new Error(`${nomChamp} doit être une adresse commençant par https://.`);
}

function validerEmail(valeur, nomChamp) {
  const texte = String(valeur || '').trim().toLowerCase();
  if (!texte) return null;
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(texte)) {
    throw new Error(`${nomChamp} n’est pas une adresse email valide.`);
  }
  return texte;
}

function construireMiseAJourIdentite(donnees) {
  return {
    nom: nettoyerTexte(donnees.nom, 80, 'Le nom du restaurant'),
    logo_url: validerImage(donnees.logo_url, 'Le logo'),
    couleur_principale: validerCouleurHex(donnees.couleur_principale, 'La couleur principale'),
    couleur_secondaire: validerCouleurHex(donnees.couleur_secondaire, 'La couleur secondaire'),
    reglages_identite_confirme: true
  };
}

function construireMiseAJourContact(donnees) {
  return {
    telephone: nettoyerTexteOptionnel(donnees.telephone, 30, 'Le téléphone'),
    adresse: nettoyerTexteOptionnel(donnees.adresse, 200, 'L’adresse'),
    email_public: validerEmail(donnees.email_public, 'L’adresse email'),
    site_web: validerUrlHttps(donnees.site_web, 'Le site internet'),
    reglages_contact_confirme: true
  };
}

function construireMiseAJourProgramme(donnees) {
  const seuil = Number.parseInt(donnees.seuil_recompense, 10);
  const pointsParScan = Number.parseInt(donnees.points_per_scan, 10);

  if (!Number.isInteger(seuil) || seuil < 1 || seuil > 100000) {
    throw new Error('Le seuil de récompense doit être compris entre 1 et 100000.');
  }
  if (!Number.isInteger(pointsParScan) || pointsParScan < 1 || pointsParScan > 100) {
    throw new Error('Les points par passage doivent être compris entre 1 et 100.');
  }

  return {
    seuil_recompense: seuil,
    points_per_scan: pointsParScan,
    description_recompense: nettoyerTexteOptionnel(donnees.description_recompense, 90, 'La récompense') || 'Récompense à débloquer',
    reglages_programme_confirme: true
  };
}

function construireMiseAJourAvis(donnees) {
  return {
    lien_avis_google: validerUrlHttps(donnees.lien_avis_google, 'Le lien d’avis Google'),
    reglages_avis_confirme: true
  };
}

function nomReellementConfigure(nom) {
  const texte = String(nom || '').trim().toLowerCase();
  return Boolean(texte) && !NOMS_GENERIQUES.includes(texte);
}

/**
 * Determine, section par section, si le restaurateur a reellement configure
 * son restaurant (pas seulement visite la page). Sert a la fois a l'etat
 * global de Reglages et aux points brillants du menu.
 */
function calculerCompletion(restaurant) {
  // Une rubrique est consideree comme utilisable des qu'une information utile
  // y est presente. On ne force pas le restaurateur a remplir chaque champ :
  // un telephone suffit par exemple a terminer la rubrique Contact.
  const identite = Boolean(
    nomReellementConfigure(restaurant.nom) ||
    restaurant.logo_url ||
    restaurant.couleur_principale ||
    restaurant.couleur_secondaire
  );
  const contact = Boolean(
    restaurant.telephone ||
    restaurant.adresse ||
    restaurant.email_public ||
    restaurant.site_web
  );
  const programme = Boolean(
    Number(restaurant.points_per_scan) > 0 ||
    Number(restaurant.seuil_recompense) > 0 ||
    restaurant.description_recompense
  );
  const avis = Boolean(restaurant.lien_avis_google);
  // La roue possede des lots par defaut reellement jouables. Elle est donc
  // prete meme avant une personnalisation explicite.
  const roue = roueService.lotsRestaurant(restaurant).length >= roueService.NB_LOTS_MIN;
  const designApple = Boolean(
    restaurant.apple_logo_url || restaurant.apple_strip_url || restaurant.apple_icon_url ||
    restaurant.apple_logo_text || restaurant.apple_custom_color ||
    restaurant.logo_url || restaurant.couleur_principale || nomReellementConfigure(restaurant.nom)
  );
  const designGoogle = Boolean(
    restaurant.google_program_logo_url || restaurant.google_wide_logo_url ||
    restaurant.google_hero_image_url || restaurant.google_custom_color ||
    restaurant.logo_url || restaurant.couleur_principale || nomReellementConfigure(restaurant.nom)
  );
  const marketing = Boolean(
    restaurant.public_qr_token || restaurant.qr_png_path || restaurant.flyer_pdf_path ||
    restaurant.communication_logo_url || restaurant.logo_url
  );

  const sections = { identite, contact, programme, avis, roue, designApple, designGoogle, marketing };
  const total = Object.keys(sections).length;
  const faites = Object.values(sections).filter(Boolean).length;

  return {
    sections,
    complet: faites === total,
    pourcentage: Math.round((faites / total) * 100)
  };
}

function serialiserReglages(restaurant) {
  return {
    nom: restaurant.nom || '',
    logo_url: restaurant.logo_url || '',
    couleur_principale: restaurant.couleur_principale || '',
    couleur_secondaire: restaurant.couleur_secondaire || '',
    telephone: restaurant.telephone || '',
    adresse: restaurant.adresse || '',
    email_public: restaurant.email_public || '',
    site_web: restaurant.site_web || '',
    seuil_recompense: Number(restaurant.seuil_recompense || 100),
    points_per_scan: Number(restaurant.points_per_scan || 10),
    description_recompense: restaurant.description_recompense || '',
    lien_avis_google: restaurant.lien_avis_google || '',
    completion: calculerCompletion(restaurant)
  };
}

module.exports = {
  construireMiseAJourIdentite,
  construireMiseAJourContact,
  construireMiseAJourProgramme,
  construireMiseAJourAvis,
  calculerCompletion,
  serialiserReglages
};
