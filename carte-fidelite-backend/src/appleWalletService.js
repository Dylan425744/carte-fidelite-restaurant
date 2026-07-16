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
function designProActive() {
  return obtenirVariableEnvironnement(
    'WALLETWALLET_PRO_DESIGN',
    'false'
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
function ajouterDesignPro(champs) {
  if (!designProActive()) {
    return champs;
  }

  // Encre Bravocard, la couleur sombre principale de la marque.
  champs.color = '#1B1030';

  const logoBravocard = obtenirVariableEnvironnement(
    'BRAVOCARD_LOGO_URL'
  );

  const banniereBravocard = obtenirVariableEnvironnement(
    'BRAVOCARD_STRIP_URL'
  );

  const iconeBravocard = obtenirVariableEnvironnement(
    'BRAVOCARD_ICON_URL'
  );

  const logoRestaurant = obtenirVariableEnvironnement(
    'RESTAURANT_LOGO_URL'
  );

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
function construireChampsCarte(client) {
  verifierClient(client);

  const nomRestaurant = obtenirVariableEnvironnement(
    'NOM_RESTAURANT',
    'Votre restaurant'
  );

  const nomClient = obtenirNomCompletClient(client).toUpperCase();
  const points = obtenirNombrePoints(client);

  const champs = {
    barcodeValue: String(client.id),
    barcodeFormat: 'Code128',

    /*
     * Sans logo personnalisé, "Bravocard" apparaît en texte.
     * Avec le design Pro, le logo PNG remplacera visuellement ce texte.
     */
    logoText: 'Bravocard',

    organizationName: nomRestaurant,

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
    colorPreset: 'dark',

    /*
     * Zone située en haut à droite sur Apple Wallet.
     */
    headerFields: [
      {
        label: 'RESTAURANT',
        value: nomRestaurant
      }
    ],

    /*
     * Élément central principal de la carte.
     * Apple et Google affichent surtout le premier primaryField.
     */
    primaryFields: [
      {
        label: 'POINTS FIDÉLITÉ',
        value: String(points),

        /*
         * Lorsqu'un solde change, Apple peut afficher cette notification :
         * "Votre solde est maintenant de 80 points."
         */
        changeMessage: 'Votre solde est maintenant de %@ points.'
      }
    ],

    /*
     * Informations affichées sous le nombre de points.
     */
    secondaryFields: [
      {
        label: 'CLIENT',
        value: nomClient
      },
      {
        label: 'CARTE',
        value: 'FIDÉLITÉ'
      }
    ],

    /*
     * Informations visibles lorsque le client ouvre les détails de la carte.
     *
     * Le dernier champ sert aussi de base aux futures notifications
     * marketing personnalisées.
     */
    backFields: [
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
      },
      {
        label: 'NOTIFICATIONS',
        value: ' ',
        changeMessage: '%@'
      }
    ]
  };

  return ajouterDesignPro(champs);
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
async function creerPasseApple(client) {
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
      body: JSON.stringify(construireChampsCarte(client))
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
        body: JSON.stringify(construireChampsCarte(client))
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

  return true;
}

module.exports = {
  creerPasseApple,
  mettreAJourPasseApple
};
