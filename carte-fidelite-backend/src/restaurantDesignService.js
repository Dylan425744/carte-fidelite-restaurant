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

function construireMiseAJourDesign(donnees, proAutorise) {
  const preset = String(donnees.apple_color_preset || '').trim().toLowerCase();

  if (!PRESETS_APPLE.includes(preset)) {
    throw new Error('La couleur Apple Wallet choisie est invalide.');
  }

  const miseAJour = {
    wallet_barcode_format: donnees.wallet_barcode_format === 'QR_CODE' ? 'QR_CODE' : 'CODE_128',
    apple_color_preset: preset,
    apple_logo_text: nettoyerTexte(donnees.apple_logo_text, 32, 'Le nom affiché'),
    apple_points_label: nettoyerTexte(donnees.apple_points_label, 28, 'Le libellé des points'),
    apple_card_label: nettoyerTexte(donnees.apple_card_label, 28, 'Le libellé de la carte'),
    design_updated_at: new Date().toISOString()
  };

  if (!proAutorise) {
    return miseAJour;
  }

  const couleur = String(donnees.apple_custom_color || '').trim().toUpperCase();
  if (couleur && !/^#[0-9A-F]{6}$/.test(couleur)) {
    throw new Error('La couleur personnalisée doit être au format #1B1030.');
  }

  miseAJour.apple_custom_color = couleur || null;
  miseAJour.apple_logo_url = validerImage(donnees.apple_logo_url, 'Le logo');
  miseAJour.apple_strip_url = validerImage(donnees.apple_strip_url, 'La bannière');
  miseAJour.apple_icon_url = validerImage(donnees.apple_icon_url, 'L’icône');
  miseAJour.apple_program_name = nettoyerTexteOptionnel(
    donnees.apple_program_name,
    48,
    'Carte fidélité'
  );
  miseAJour.apple_reward_text = nettoyerTexteOptionnel(
    donnees.apple_reward_text,
    90,
    'Récompense à débloquer'
  );
  miseAJour.apple_terms = nettoyerTexteOptionnel(
    donnees.apple_terms,
    500,
    'Conditions du programme disponibles auprès du restaurant.'
  );

  return miseAJour;
}

function serialiserRestaurant(restaurant, proDisponible) {
  const proAutorise = Boolean(proDisponible && restaurant.apple_pro_design);

  return {
    id: restaurant.id,
    nom: restaurant.nom,
    slug: restaurant.slug,
    actif: restaurant.actif !== false,
    design_enabled: restaurant.design_enabled !== false,
    apple_pro_design: Boolean(restaurant.apple_pro_design),
    pro_disponible: Boolean(proDisponible),
    pro_autorise: proAutorise,
    apple_color_preset: PRESETS_APPLE.includes(restaurant.apple_color_preset)
      ? restaurant.apple_color_preset
      : 'dark',
    apple_logo_text: restaurant.apple_logo_text || 'Bravocard',
    apple_points_label: restaurant.apple_points_label || 'POINTS SUR 100',
    wallet_barcode_format: restaurant.wallet_barcode_format === 'QR_CODE' ? 'QR_CODE' : 'CODE_128',
    apple_card_label: restaurant.apple_card_label || 'FIDÉLITÉ',
    apple_custom_color: proAutorise ? restaurant.apple_custom_color || '' : '',
    apple_logo_url: proAutorise ? restaurant.apple_logo_url || '' : '',
    apple_strip_url: proAutorise ? restaurant.apple_strip_url || '' : '',
    apple_icon_url: proAutorise ? restaurant.apple_icon_url || '' : '',
    apple_program_name: restaurant.apple_program_name || 'Carte fidélité',
    apple_reward_text: restaurant.apple_reward_text || restaurant.description_recompense || 'Récompense à débloquer',
    apple_terms: restaurant.apple_terms || 'Conditions du programme disponibles auprès du restaurant.',
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
  verifierCodeAcces
};
