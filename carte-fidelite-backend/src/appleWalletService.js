// Ce fichier gère tout ce qui concerne Apple Wallet via WalletWallet.
// WalletWallet signe et héberge les passes sans que Bravocard ait besoin
// de gérer directement les certificats Apple.
//
// Documentation API :
// https://api.walletwallet.dev/api/passes

const BASE_URL = 'https://api.walletwallet.dev/api/passes';

const DELAI_AVANT_NOUVELLE_TENTATIVE_MS = 1500;
const DELAI_MAX_REQUETE_MS = 15000;

/**
 * Vérifie qu'une variable d'environnement contient une vraie valeur.
 */
function obtenirVariableEnvironnement(nom, valeurParDefaut = '') {
  const valeur = process.env[nom];

  if (typeof valeur !== 'string' || valeur.trim() === '') {
    return valeurParDefaut;
  }

  return valeur.trim();
}

/**
 * Retourne le nom complet du client.
 *
 * Compatible avec plusieurs structures possibles :
 * - client.nomComplet
 * - client.nom_complet
 * - client.prenom + client.nom
 * - client.nom uniquement
 * - client.prenom uniquement
 */
function obtenirNomCompletClient(client) {
  if (client.nomComplet) {
    return String(client.nomComplet).trim();
  }

  if (client.nom_complet) {
    return String(client.nom_complet).trim();
  }

  if (client.prenom && client.nom) {
    return `${String(client.prenom).trim()} ${String(client.nom).trim()}`;
  }

  if (client.nom) {
    return String(client.nom).trim();
  }

  if (client.prenom) {
    return String(client.prenom).trim();
  }

  return 'CLIENT';
}

/**
 * Retourne un nombre de points propre et sûr.
 */
function obtenirNombrePoints(client) {
  const points = Number(client.points);

  if (!Number.isFinite(points) || points < 0) {
    return 0;
  }

  return Math.floor(points);
}

/**
 * Vérifie les données indispensables avant de contacter WalletWallet.
 */
function verifierClient(client) {
  if (!client || typeof client !== 'object') {
    throw new Error(
      'Impossible de créer la carte Apple Wallet : le client est manquant.'
    );
  }

  if (
    client.id === undefined ||
    client.id === null ||
    String(client.id).trim() === ''
  ) {
    throw new Error(
      'Impossible de créer la carte Apple Wallet : le client ne possède pas d’identifiant.'
    );
  }
}

/**
 * Indique si les options visuelles Pro doivent être envoyées.
 *
 * Sur Render, cette variable pourra être définie ainsi :
 * WALLETWALLET_PRO_DESIGN=true
 *
 * Si elle n'est pas activée, la carte fonctionne avec le thème violet gratuit.
 */
function designProDisponible() {
  return obtenirVariableEnvironnement(
    'WALLETWALLET_PRO_DESIGN',
    'true'
  ).toLowerCase() === 'true';
}

/**
 * Ajoute les options visuelles Pro uniquement lorsqu'elles sont activées.
 *
 * Variables facultatives :
 * - BRAVOCARD_LOGO_URL
 * - BRAVOCARD_STRIP_URL
 * - BRAVOCARD_ICON_URL
 * - RESTAURANT_LOGO_URL
 *
 * Les URLs doivent commencer par https://
 */
function ajouterDesignPro(champs, restaurant = null) {
  const proAutorise = designProDisponible();

  if (!proAutorise) {
    return champs;
  }

  // La couleur précise est réservée au compte WalletWallet Pro.
  champs.color = restaurant?.apple_custom_color || '#1B1030';

  const valeurDesign = (champ, variableEnvironnement) => {
    if (restaurant && Object.prototype.hasOwnProperty.call(restaurant, champ)) {
      return String(restaurant[champ] || '').trim();
    }
    return obtenirVariableEnvironnement(variableEnvironnement);
  };
  const logoBravocard = valeurDesign('apple_logo_url', 'BRAVOCARD_LOGO_URL');
  const banniereBravocard = valeurDesign('apple_strip_url', 'BRAVOCARD_STRIP_URL');
  const iconeBravocard = valeurDesign('apple_icon_url', 'BRAVOCARD_ICON_URL');

  const logoRestaurant = restaurant
    ? ''
    : obtenirVariableEnvironnement('RESTAURANT_LOGO_URL');

  /*
   * Le logo Bravocard doit être un PNG transparent contenant :
   * - "Bravo" en #EDEAF5
   * - "card" en gris lavande clair
   *
   * C'est ce qui permettra d'avoir les deux parties du nom
   * dans des couleurs différentes.
   */
  if (logoBravocard) {
    champs.logoURL = logoBravocard;
  }

  /*
   * La bannière est facultative.
   * Lorsqu'elle est présente, WalletWallet utilise une disposition
   * de type carte de fidélité/store card plus visuelle.
   */
  if (banniereBravocard) {
    champs.stripURL = banniereBravocard;
  }

  /*
   * Cette icône apparaît principalement dans les notifications Apple Wallet.
   */
  if (iconeBravocard) {
    champs.iconURL = iconeBravocard;
  }

  /*
   * Le logo du restaurant peut apparaître dans la zone visuelle secondaire.
   */
  if (logoRestaurant) {
    champs.thumbnailURL = logoRestaurant;
  }

  return champs;
}

/**
 * Construit l'ensemble complet des champs de la carte.
 *
 * Cette fonction est utilisée à l'identique lors de la création
 * et lors de chaque mise à jour.
 */
function construireChampsCarte(client, restaurant = null) {
  verifierClient(client);

  const nomRestaurant =
    restaurant?.nom ||
    obtenirVariableEnvironnement('NOM_RESTAURANT', 'Votre restaurant');
  const titreNotification = restaurant?.notification_title_override
    ? String(restaurant.notification_title_override).trim().slice(0, 64)
    : nomRestaurant;

  const valeurConfiguree = (champ, valeurParDefaut = '') => {
    if (!restaurant || restaurant[champ] === null || restaurant[champ] === undefined) {
      return valeurParDefaut;
    }
    return String(restaurant[champ]).trim();
  };
  const logoText = valeurConfiguree('apple_logo_text', 'Bravocard');
  const pointsLabel = valeurConfiguree('apple_points_label', 'POINTS SUR 100');
  const carteLabel = valeurConfiguree('apple_card_label', 'FIDÉLITÉ');
  const nomProgramme = valeurConfiguree('apple_program_name', 'Carte fidélité');
  const texteRecompense = valeurConfiguree(
    'apple_reward_text',
    restaurant?.description_recompense || 'Récompense à débloquer'
  );
  const conditions = valeurConfiguree(
    'apple_terms',
    'Conditions du programme disponibles auprès du restaurant.'
  );
  const presetsAutorises = ['dark', 'blue', 'green', 'red', 'purple', 'orange'];
  const colorPreset = presetsAutorises.includes(restaurant?.apple_color_preset)
    ? restaurant.apple_color_preset
    : 'dark';

  const nomClient = obtenirNomCompletClient(client).toUpperCase();
  const points = obtenirNombrePoints(client);
  const lienParrainage = client.referral_link || null;
  const codeParrainage = client.referral_code || null;

  const champs = {
    barcodeValue: String(client.scan_code || client.id),
    barcodeFormat: restaurant?.wallet_barcode_format === 'QR_CODE' ? 'QR' : 'Code128',

    /*
     * Sans logo personnalisé, "Bravocard" apparaît en texte.
     * Avec le design Pro, le logo PNG remplacera visuellement ce texte.
     */
    // Apple utilise organizationName comme titre de la notification Wallet.
    // Pendant une campagne, le serveur fournit un titre temporaire afin
    // d'afficher exactement celui saisi par le restaurateur.
    organizationName: titreNotification,

    description: `Carte de fidélité ${nomRestaurant} propulsée par Bravocard`,

    /*
     * Empêche un client de partager sa carte personnelle avec quelqu'un d'autre.
     */
    sharingProhibited: true,

    /*
     * Thème le plus sombre disponible gratuitement.
     * Si WALLETWALLET_PRO_DESIGN=true, la couleur exacte #1B1030
     * sera ajoutée automatiquement par ajouterDesignPro().
     */
    colorPreset,

    /*
     * Zone située en haut à droite sur Apple Wallet.
     */
    headerFields: [
      {
        label: pointsLabel,
        value: String(points),
        changeMessage: 'Vous avez maintenant %@ points.'
      }
    ],

    /*
     * Élément central principal de la carte.
     * Apple et Google affichent surtout le premier primaryField.
     */
    primaryFields: nomProgramme ? [{ label: 'PROGRAMME', value: nomProgramme }] : [],

    /*
     * Informations affichées sous le nombre de points.
     */
    secondaryFields: [
      { label: 'CLIENT', value: nomClient },
      ...(texteRecompense ? [{ label: 'RÉCOMPENSE', value: texteRecompense }] : [])
    ],

    /*
     * Informations visibles lorsque le client ouvre les détails de la carte.
     *
     * Le dernier champ sert aussi de base aux futures notifications
     * marketing personnalisées.
     */
    backFields: [
      ...(conditions ? [{ label: 'CONDITIONS', value: conditions }] : []),
      {
        label: 'PROGRAMME DE FIDÉLITÉ',
        value: `Cette carte vous permet de cumuler des points chez ${nomRestaurant}.`
      },
      {
        label: 'UTILISATION',
        value:
          'Présentez le code-barres de cette carte au commerçant afin de créditer ou utiliser vos points.'
      },
      {
        label: 'IDENTIFIANT DE LA CARTE',
        value: String(client.id)
      },
      {
        label: 'PROPULSÉ PAR',
        value: 'Bravocard'
      }
    ]
  };

  if (logoText) champs.logoText = logoText;

  if (codeParrainage) {
    champs.backFields.push({
      label: 'CODE DE PARRAINAGE',
      value: String(codeParrainage)
    });
  }

  if (lienParrainage) {
    champs.backFields.push({
      label: 'PARRAINER UN PROCHE',
      value: lienParrainage
    });
  }

  // Le dernier message reste dans les détails de la carte. Apple exige que le
  // modèle changeMessage contienne %@, remplacé par la nouvelle valeur du
  // champ. Un séparateur invisible horodaté garantit qu'un message identique
  // envoyé une seconde fois est tout de même détecté comme une modification.
  if (restaurant?.last_notification_message) {
    const dateEnvoi = restaurant.last_notification_sent_at
      ? new Date(restaurant.last_notification_sent_at).toLocaleString('fr-FR', {
          timeZone: 'Europe/Paris',
          dateStyle: 'short',
          timeStyle: 'short'
        })
      : 'maintenant';

    const horodatage = restaurant.last_notification_sent_at
      ? new Date(restaurant.last_notification_sent_at).getTime()
      : Date.now();
    const marqueInvisible = '\u2063'.repeat(
      (Math.abs(Number.isFinite(horodatage) ? horodatage : Date.now()) % 31) + 1
    );

    champs.backFields.push({
      label: restaurant.last_notification_title || 'MESSAGE DU RESTAURANT',
      value: `${restaurant.last_notification_message}${marqueInvisible}`,
      changeMessage: '%@'
    });
    champs.backFields.push({
      label: 'ENVOYÉ LE',
      value: dateEnvoi
    });
  }

  return ajouterDesignPro(champs, restaurant);
}

/**
 * Attend avant une nouvelle tentative.
 */
function attendre(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Lit proprement la réponse de WalletWallet.
 *
 * Certaines erreurs sont retournées en JSON, d'autres sous forme de texte.
 */
async function lireReponse(reponse) {
  const texte = await reponse.text();

  if (!texte) {
    return {};
  }

  try {
    return JSON.parse(texte);
  } catch {
    return {
      message: texte
    };
  }
}

/**
 * Transforme une erreur WalletWallet en message lisible.
 */
function obtenirMessageErreur(donnees, statut) {
  if (donnees && typeof donnees.error === 'string') {
    return donnees.error;
  }

  if (donnees && typeof donnees.message === 'string') {
    return donnees.message;
  }

  return `Erreur HTTP ${statut}`;
}

/**
 * Effectue une requête vers WalletWallet avec un délai maximum.
 */
async function envoyerRequeteWalletWallet(url, options) {
  const controleur = new AbortController();

  const minuteur = setTimeout(() => {
    controleur.abort();
  }, DELAI_MAX_REQUETE_MS);

  try {
    return await fetch(url, {
      ...options,
      signal: controleur.signal
    });
  } finally {
    clearTimeout(minuteur);
  }
}

/**
 * Crée une nouvelle carte pour un client.
 *
 * La création n'est volontairement pas relancée automatiquement :
 * si WalletWallet a créé la carte mais que la réponse réseau s'est perdue,
 * une nouvelle tentative pourrait créer un doublon.
 */
async function creerPasseApple(client, restaurant = null) {
  const cleApi = obtenirVariableEnvironnement(
    'WALLETWALLET_API_KEY'
  );

  if (!cleApi) {
    throw new Error(
      'La variable WALLETWALLET_API_KEY est absente sur Render.'
    );
  }

  let reponse;

  try {
    reponse = await envoyerRequeteWalletWallet(BASE_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${cleApi}`
      },
      body: JSON.stringify(construireChampsCarte(client, restaurant))
    });
  } catch (erreur) {
    if (erreur.name === 'AbortError') {
      throw new Error(
        'La création de la carte Apple Wallet a dépassé le délai autorisé.'
      );
    }

    throw new Error(
      `Erreur réseau pendant la création de la carte Apple Wallet : ${erreur.message}`
    );
  }

  const donnees = await lireReponse(reponse);

  if (!reponse.ok) {
    throw new Error(
      `Erreur création passe Apple Wallet : ${obtenirMessageErreur(
        donnees,
        reponse.status
      )}`
    );
  }

  if (!donnees.serialNumber || !donnees.shareUrl) {
    throw new Error(
      'WalletWallet a répondu, mais le serialNumber ou le shareUrl est manquant.'
    );
  }

  return {
    serialNumber: donnees.serialNumber,
    shareUrl: donnees.shareUrl
  };
}

/**
 * Met à jour une carte existante.
 *
 * Contrairement à une création, un PUT peut être relancé sans créer
 * une deuxième carte. Une nouvelle tentative est donc autorisée
 * pour les erreurs réseau, les erreurs serveur et les limitations temporaires.
 */
async function mettreAJourPasseApple(
  serialNumber,
  client,
  restaurant = null,
  tentative = 1
) {
  const cleApi = obtenirVariableEnvironnement(
    'WALLETWALLET_API_KEY'
  );

  if (!cleApi) {
    throw new Error(
      'La variable WALLETWALLET_API_KEY est absente sur Render.'
    );
  }

  if (
    serialNumber === undefined ||
    serialNumber === null ||
    String(serialNumber).trim() === ''
  ) {
    throw new Error(
      'Impossible de mettre à jour Apple Wallet : serialNumber manquant.'
    );
  }

  let reponse;

  try {
    reponse = await envoyerRequeteWalletWallet(
      `${BASE_URL}/${encodeURIComponent(String(serialNumber))}`,
      {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${cleApi}`
        },
        body: JSON.stringify(construireChampsCarte(client, restaurant))
      }
    );
  } catch (erreur) {
    const erreurTemporaire =
      erreur.name === 'AbortError' ||
      erreur instanceof TypeError;

    if (erreurTemporaire && tentative < 2) {
      console.warn(
        'Échec réseau Apple Wallet, nouvelle tentative dans 1,5 seconde.'
      );

      await attendre(DELAI_AVANT_NOUVELLE_TENTATIVE_MS);

      return mettreAJourPasseApple(
        serialNumber,
        client,
        restaurant,
        tentative + 1
      );
    }

    if (erreur.name === 'AbortError') {
      throw new Error(
        'La mise à jour Apple Wallet a dépassé le délai autorisé.'
      );
    }

    throw new Error(
      `Erreur réseau pendant la mise à jour Apple Wallet : ${erreur.message}`
    );
  }

  const donnees = await lireReponse(reponse);

  if (!reponse.ok) {
    const erreurTemporaire =
      reponse.status === 429 ||
      reponse.status >= 500;

    if (erreurTemporaire && tentative < 2) {
      console.warn(
        `Échec temporaire Apple Wallet (${reponse.status}), nouvelle tentative dans 1,5 seconde.`
      );

      await attendre(DELAI_AVANT_NOUVELLE_TENTATIVE_MS);

      return mettreAJourPasseApple(
        serialNumber,
        client,
        restaurant,
        tentative + 1
      );
    }

    throw new Error(
      `Erreur mise à jour passe Apple Wallet : ${obtenirMessageErreur(
        donnees,
        reponse.status
      )}`
    );
  }

  return donnees;
}

module.exports = {
  construireChampsCarte,
  creerPasseApple,
  designProDisponible,
  mettreAJourPasseApple
};
