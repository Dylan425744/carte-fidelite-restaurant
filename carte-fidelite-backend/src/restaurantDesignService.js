const crypto = require('crypto');

const PRESETS_APPLE = ['dark', 'blue', 'green', 'red', 'purple', 'orange'];
const TAILLE_MAX_IMAGE = 700000;

function nettoyerTexteOptionnel(valeur, longueurMax, valeurParDefaut = '') {
  const texte = String(valeur || '').trim().replace(/\s+/g, ' ');
  if (texte.length > longueurMax) {
    throw new Error(`Ce texte ne peut pas dépasser ${longueurMax} caractères.`);
  }
  return texte || valeurParDefaut;
}

function nettoyerTexte(valeur, longueurMax, nomChamp) {
  const texte = String(valeur || '').trim();

  if (!texte) {
    throw new Error(`${nomChamp} est obligatoire.`);
  }

  if (texte.length > longueurMax) {
    throw new Error(`${nomChamp} ne peut pas dépasser ${longueurMax} caractères.`);
  }

  return texte;
}

function normaliserSlug(valeur) {
  const slug = String(valeur || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');

  if (!slug || slug.length > 60) {
    throw new Error('Le lien du commerce doit contenir entre 1 et 60 caractères.');
  }

  return slug;
}

function genererCodeAcces() {
  return `bravo_${crypto.randomBytes(24).toString('base64url')}`;
}

function hacherCodeAcces(code) {
  return crypto.createHash('sha256').update(String(code || '')).digest('hex');
}

function verifierCodeAcces(code, hashAttendu) {
  if (!code || !hashAttendu || !/^[a-f0-9]{64}$/i.test(hashAttendu)) {
    return false;
  }

  const hashRecu = hacherCodeAcces(code);
  return crypto.timingSafeEqual(
    Buffer.from(hashRecu, 'hex'),
    Buffer.from(hashAttendu, 'hex')
  );
}

function validerImage(valeur, nomChamp) {
  const image = String(valeur || '').trim();

  if (!image) {
    return null;
  }

  if (image.length > TAILLE_MAX_IMAGE) {
    throw new Error(`${nomChamp} est trop lourde. Utilisez une image de moins de 500 Ko.`);
  }

  if (/^data:image\/png;base64,[a-z0-9+/=\r\n]+$/i.test(image)) {
    return image;
  }

  try {
    const url = new URL(image);
    if (url.protocol === 'https:') {
      return image;
    }
  } catch {
    // Le message commun ci-dessous explique le format accepté.
  }

  throw new Error(`${nomChamp} doit être un fichier PNG ou une adresse HTTPS.`);
}

function construireMiseAJourDesign(donnees) {
  const preset = String(donnees.apple_color_preset || 'dark').trim().toLowerCase();

  if (!PRESETS_APPLE.includes(preset)) {
    throw new Error('La couleur Apple Wallet choisie est invalide.');
  }

  const miseAJour = {
    wallet_barcode_format: donnees.wallet_barcode_format === 'QR_CODE' ? 'QR_CODE' : 'CODE_128',
    apple_color_preset: preset,
    wallet_display_name: nettoyerTexteOptionnel(donnees.wallet_display_name, 80),
    wallet_points_label: nettoyerTexteOptionnel(donnees.wallet_points_label, 28),
    wallet_card_label: nettoyerTexteOptionnel(donnees.wallet_card_label, 28),
    wallet_reward_text: nettoyerTexteOptionnel(donnees.wallet_reward_text, 90),
    apple_logo_text: nettoyerTexteOptionnel(donnees.apple_logo_text, 32),
    apple_points_label: nettoyerTexteOptionnel(donnees.apple_points_label, 28),
    apple_card_label: nettoyerTexteOptionnel(donnees.apple_card_label, 28),
    design_updated_at: new Date().toISOString()
  };

  const couleur = String(donnees.apple_custom_color || '').trim().toUpperCase();
  if (couleur && !/^#[0-9A-F]{6}$/.test(couleur)) {
    throw new Error('La couleur personnalisée doit être au format #1B1030.');
  }

  miseAJour.apple_custom_color = couleur || null;
  const couleurGoogle = String(donnees.google_custom_color || '').trim().toUpperCase();
  if (couleurGoogle && !/^#[0-9A-F]{6}$/.test(couleurGoogle)) {
    throw new Error('La couleur Google Wallet doit être au format #1B1030.');
  }
  miseAJour.google_custom_color = couleurGoogle || null;
  miseAJour.apple_logo_url = validerImage(donnees.apple_logo_url, 'Le logo Apple');
  miseAJour.apple_strip_url = validerImage(donnees.apple_strip_url, 'La bande décorative Apple');
  miseAJour.apple_icon_url = validerImage(donnees.apple_icon_url, 'L’icône Apple');
  miseAJour.google_program_logo_url = validerImage(donnees.google_program_logo_url, 'Le logo rond Google');
  miseAJour.google_wide_logo_url = validerImage(donnees.google_wide_logo_url, 'Le logo large Google');
  miseAJour.google_hero_image_url = validerImage(donnees.google_hero_image_url, 'L’image Hero Google');
  miseAJour.apple_reward_text = nettoyerTexteOptionnel(
    donnees.apple_reward_text,
    90
  );
  miseAJour.apple_terms = nettoyerTexteOptionnel(
    donnees.apple_terms,
    500
  );

  return miseAJour;
}

function serialiserRestaurant(restaurant, proDisponible) {
  const valeurOuDefaut = (valeur, valeurParDefaut) =>
    valeur === null || valeur === undefined ? valeurParDefaut : String(valeur);
  return {
    id: restaurant.id,
    nom: restaurant.nom,
    slug: restaurant.slug,
    logo_url: restaurant.logo_url || '',
    couleur_principale: restaurant.couleur_principale || '',
    couleur_secondaire: restaurant.couleur_secondaire || '',
    telephone: restaurant.telephone || '',
    adresse: restaurant.adresse || '',
    email_public: restaurant.email_public || '',
    site_web: restaurant.site_web || '',
    points_per_scan: Number(restaurant.points_per_scan || 10),
    seuil_recompense: Number(restaurant.seuil_recompense || 100),
    description_recompense: restaurant.description_recompense || '',
    lien_avis_google: restaurant.lien_avis_google || '',
    actif: restaurant.actif !== false,
    design_enabled: restaurant.design_enabled !== false,
    apple_pro_design: Boolean(restaurant.apple_pro_design),
    pro_disponible: Boolean(proDisponible),
    // Compatibilite avec les anciennes versions du tableau de bord. Le studio
    // Wallet appartient desormais a tous les restaurants, quel que soit le plan.
    pro_autorise: true,
    apple_design_autorise: true,
    google_design_autorise: true,
    apple_color_preset: PRESETS_APPLE.includes(restaurant.apple_color_preset)
      ? restaurant.apple_color_preset
      : 'dark',
    apple_logo_text: restaurant.apple_logo_text || '',
    wallet_display_name: valeurOuDefaut(restaurant.wallet_display_name, restaurant.nom || ''),
    wallet_points_label: valeurOuDefaut(
      restaurant.wallet_points_label,
      `POINTS SUR ${Number(restaurant.seuil_recompense || 100)}`
    ),
    wallet_card_label: valeurOuDefaut(restaurant.wallet_card_label, 'FIDÉLITÉ'),
    wallet_reward_text: valeurOuDefaut(
      restaurant.wallet_reward_text,
      restaurant.description_recompense || 'Récompense à débloquer'
    ),
    apple_points_label: valeurOuDefaut(restaurant.apple_points_label, 'POINTS SUR 100'),
    wallet_barcode_format: restaurant.wallet_barcode_format === 'QR_CODE' ? 'QR_CODE' : 'CODE_128',
    apple_card_label: valeurOuDefaut(restaurant.apple_card_label, 'FIDÉLITÉ'),
    apple_custom_color: restaurant.apple_custom_color || '',
    google_custom_color: restaurant.google_custom_color || '',
    apple_logo_url: restaurant.apple_logo_url || '',
    apple_strip_url: restaurant.apple_strip_url || '',
    apple_icon_url: restaurant.apple_icon_url || '',
    google_program_logo_url: restaurant.google_program_logo_url || '',
    google_wide_logo_url: restaurant.google_wide_logo_url || '',
    google_hero_image_url: restaurant.google_hero_image_url || '',
    apple_reward_text: valeurOuDefaut(
      restaurant.apple_reward_text,
      restaurant.description_recompense || 'Récompense à débloquer'
    ),
    apple_terms: valeurOuDefaut(
      restaurant.apple_terms,
      'Conditions du programme disponibles auprès du restaurant.'
    ),
    design_updated_at: restaurant.design_updated_at || null,
    acces_configure: Boolean(restaurant.design_access_token_hash)
  };
}

module.exports = {
  PRESETS_APPLE,
  construireMiseAJourDesign,
  genererCodeAcces,
  hacherCodeAcces,
  nettoyerTexte,
  normaliserSlug,
  serialiserRestaurant,
  validerImage,
  verifierCodeAcces
};
