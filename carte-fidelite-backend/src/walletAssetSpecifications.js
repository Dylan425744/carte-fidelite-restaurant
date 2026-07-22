// Source unique de verite pour tout ce qui touche aux images Apple Wallet et
// Google Wallet : dimensions, ratios, formats, poids. Utilisee a la fois cote
// serveur (validation a l'upload) et exposee au frontend (affichage des
// dimensions, validation avant envoi) via GET /api/wallet-asset-specifications.
//
// Ne jamais dupliquer une dimension ailleurs dans le code : si une valeur
// change, elle ne doit changer qu'ici.
//
// Sources verifiees (juillet 2026) :
// - Apple : https://www.walletwallet.dev/blog/anatomy-of-an-apple-wallet-pass/
// - Google : https://developers.google.com/wallet/retail/loyalty-cards/resources/brand-guidelines

// WalletWallet (Apple) refuse toute image au dela de 1 Mo, meme si Google
// Wallet accepte davantage : chaque plateforme garde donc sa propre limite.
const POIDS_MAX_OCTETS_APPLE = 1 * 1024 * 1024;
const POIDS_MAX_OCTETS_GOOGLE = 2 * 1024 * 1024;

const SPECIFICATIONS = {
  apple: {
    logo: {
      id: 'apple_logo',
      champDb: 'apple_logo_url',
      plateforme: 'apple',
      nom: 'Logo',
      requis: false,
      largeurRecommandee: 320,
      hauteurRecommandee: 100,
      ratio: 3.2,
      largeurMin: 160,
      hauteurMin: 50,
      formats: ['png'],
      poidsMaxOctets: POIDS_MAX_OCTETS_APPLE,
      zoneSecurite: null,
      description: 'Affiché en haut à gauche de la carte, à la place du nom écrit. PNG transparent recommandé.'
    },
    icone: {
      id: 'apple_icon',
      champDb: 'apple_icon_url',
      plateforme: 'apple',
      nom: 'Icône',
      requis: false,
      largeurRecommandee: 87,
      hauteurRecommandee: 87,
      ratio: 1,
      largeurMin: 58,
      hauteurMin: 58,
      formats: ['png'],
      poidsMaxOctets: POIDS_MAX_OCTETS_APPLE,
      zoneSecurite: null,
      description: 'Utilisée dans les notifications verrouillées de l’iPhone. Doit être carrée.'
    },
    banniere: {
      id: 'apple_strip',
      champDb: 'apple_strip_url',
      plateforme: 'apple',
      nom: 'Bande décorative',
      requis: false,
      largeurRecommandee: 1125,
      hauteurRecommandee: 369,
      ratio: 3.05,
      largeurMin: 375,
      hauteurMin: 123,
      formats: ['png'],
      poidsMaxOctets: POIDS_MAX_OCTETS_APPLE,
      zoneSecurite: null,
      description: 'Bande visuelle affichée sous le nom du programme.'
    }
  },
  google: {
    logoRond: {
      id: 'google_program_logo',
      champDb: 'google_program_logo_url',
      plateforme: 'google',
      nom: 'Logo rond',
      requis: true,
      largeurRecommandee: 660,
      hauteurRecommandee: 660,
      ratio: 1,
      largeurMin: 660,
      hauteurMin: 660,
      formats: ['png'],
      poidsMaxOctets: POIDS_MAX_OCTETS_GOOGLE,
      zoneSecurite: { forme: 'cercle', margeProportion: 0.15 },
      description: 'Google masque automatiquement ce logo dans un cercle. Laissez une marge de 15 % autour de l’élément principal pour qu’il ne soit pas coupé.'
    },
    logoLarge: {
      id: 'google_wide_logo',
      champDb: 'google_wide_logo_url',
      plateforme: 'google',
      nom: 'Logo large',
      requis: false,
      largeurRecommandee: 1280,
      hauteurRecommandee: 400,
      ratio: 3.2,
      largeurMin: 640,
      hauteurMin: 200,
      formats: ['png'],
      poidsMaxOctets: POIDS_MAX_OCTETS_GOOGLE,
      zoneSecurite: null,
      description: 'Logo texte pleine largeur, remplace le logo rond dans certains affichages. Utilisez du blanc sur fond sombre ou du noir sur fond clair, PNG transparent.'
    },
    heroImage: {
      id: 'google_hero_image',
      champDb: 'google_hero_image_url',
      plateforme: 'google',
      nom: 'Image Hero',
      requis: false,
      largeurRecommandee: 1032,
      hauteurRecommandee: 336,
      ratio: 3.07,
      largeurMin: 516,
      hauteurMin: 168,
      formats: ['png'],
      poidsMaxOctets: POIDS_MAX_OCTETS_GOOGLE,
      zoneSecurite: null,
      description: 'Bannière principale affichée en pleine largeur de la carte.'
    }
  },
  general: {
    logo: {
      id: 'general_logo',
      champDb: 'logo_url',
      plateforme: 'general',
      nom: 'Logo du restaurant',
      requis: false,
      largeurRecommandee: 512,
      hauteurRecommandee: 512,
      ratio: 1,
      largeurMin: 256,
      hauteurMin: 256,
      formats: ['png'],
      poidsMaxOctets: POIDS_MAX_OCTETS_GOOGLE,
      zoneSecurite: null,
      description: 'Utilisé par défaut partout où aucune image spécifique n’est définie (Wallet, emails, flyers).'
    }
  }
};

// Ecart de ratio tolere avant de proposer un recadrage plutot que d'accepter
// l'image telle quelle. Un ecart de ratio n'est jamais bloquant en soi.
const TOLERANCE_RATIO = 0.08;

function listerSpecifications() {
  return SPECIFICATIONS;
}

function obtenirSpecification(plateforme, id) {
  return SPECIFICATIONS[plateforme]?.[id] || null;
}

function trouverSpecificationParChampDb(champDb) {
  for (const groupe of Object.values(SPECIFICATIONS)) {
    for (const specification of Object.values(groupe)) {
      if (specification.champDb === champDb) return specification;
    }
  }
  return null;
}

/**
 * Calcule un statut honnete pour une image importee, sans jamais bloquer
 * uniquement a cause d'un ratio imparfait (seulement trop petite, mauvais
 * format ou trop lourde sont bloquants).
 */
function validerDimensionsImage(plateforme, id, { largeur, hauteur, poidsOctets, format }) {
  const specification = obtenirSpecification(plateforme, id);
  if (!specification) {
    return { statut: 'inconnu', message: 'Type d’image inconnu pour cette plateforme.', bloquant: true };
  }

  const formatNettoye = String(format || '').toLowerCase().replace(/^\./, '');
  if (!specification.formats.includes(formatNettoye)) {
    return {
      statut: 'format_non_supporte',
      message: `Formats acceptés : ${specification.formats.join(', ').toUpperCase()}.`,
      bloquant: true
    };
  }

  if (Number(poidsOctets) > specification.poidsMaxOctets) {
    const maxMo = (specification.poidsMaxOctets / (1024 * 1024)).toFixed(1);
    return {
      statut: 'fichier_trop_lourd',
      message: `Ce fichier dépasse ${maxMo} Mo.`,
      bloquant: true
    };
  }

  if (largeur < specification.largeurMin || hauteur < specification.hauteurMin) {
    return {
      statut: 'trop_petite',
      message: `Trop petite pour rester nette (minimum ${specification.largeurMin} × ${specification.hauteurMin} px).`,
      bloquant: true
    };
  }

  const ratioImage = largeur / hauteur;
  const ecartRatio = Math.abs(ratioImage - specification.ratio) / specification.ratio;

  if (ecartRatio <= TOLERANCE_RATIO) {
    return { statut: 'conforme', message: 'Dimensions conformes.', bloquant: false };
  }

  return {
    statut: 'acceptable_avec_recadrage',
    message: `Le ratio recommandé est ${specification.ratio.toFixed(2)}:1. Un recadrage est proposé pour l’ajuster.`,
    bloquant: false
  };
}

module.exports = {
  SPECIFICATIONS,
  listerSpecifications,
  obtenirSpecification,
  trouverSpecificationParChampDb,
  validerDimensionsImage
};
