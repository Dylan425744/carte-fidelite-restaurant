const jwt = require('jsonwebtoken');
const { GoogleAuth } = require('google-auth-library');
const supabase = require('./supabaseClient');
const vipService = require('./vipService');

const PORTEE_GOOGLE = 'https://www.googleapis.com/auth/wallet_object.issuer';
const CACHE_CLASSE_MS = 10 * 60 * 1000;
const cacheClasses = new Map();

const COULEURS_PRESET = Object.freeze({
  dark: '#17171D', blue: '#07547A', green: '#0E3B2E',
  red: '#74324B', purple: '#2B174A', orange: '#7B3023'
});

function verifierConfigurationGoogle() {
  for (const nom of ['GOOGLE_ISSUER_ID', 'GOOGLE_SERVICE_ACCOUNT_EMAIL', 'GOOGLE_PRIVATE_KEY']) {
    if (!process.env[nom]) throw new Error(`Configuration Google Wallet absente : ${nom}.`);
  }
}

function getLegacyClassId() {
  return `${process.env.GOOGLE_ISSUER_ID}.${process.env.GOOGLE_ISSUER_ID}.carte_fidelite_coin_des_amis`;
}

function getRestaurantClassId(restaurant) {
  if (!restaurant?.id) throw new Error('Le restaurant est obligatoire pour Google Wallet.');
  if (restaurant.google_wallet_class_id) return restaurant.google_wallet_class_id;
  const suffixe = String(restaurant.id).replace(/[^a-zA-Z0-9_-]/g, '');
  return `${process.env.GOOGLE_ISSUER_ID}.restaurant_${suffixe}`;
}

function getObjectId(clientId) {
  const idPropre = String(clientId || '').replace(/-/g, '');
  if (!idPropre) throw new Error('Le client est obligatoire pour Google Wallet.');
  return `${process.env.GOOGLE_ISSUER_ID}.client_${idPropre}`;
}

function urlPublique(valeur) {
  const texte = String(valeur || '').trim();
  try {
    const url = new URL(texte);
    return url.protocol === 'https:' ? texte : null;
  } catch {
    return null;
  }
}

function imageGoogle(url, description) {
  const uri = urlPublique(url);
  if (!uri) return null;
  return {
    sourceUri: { uri },
    contentDescription: {
      defaultValue: { language: 'fr-FR', value: description }
    }
  };
}

function couleurRestaurant(restaurant) {
  const personnalisee = String(restaurant.google_custom_color || '').toUpperCase();
  if (/^#[0-9A-F]{6}$/.test(personnalisee)) return personnalisee;
  // A defaut d'une couleur propre a Google Wallet, on reprend la couleur
  // generale du restaurant (Reglages).
  const generale = String(restaurant.couleur_principale || '').toUpperCase();
  if (/^#[0-9A-F]{6}$/.test(generale)) return generale;
  return COULEURS_PRESET.dark;
}

function logoParDefaut() {
  const base = String(process.env.PUBLIC_BASE_URL || 'https://bravocard.fr').replace(/\/$/, '');
  return `${base}/logo-bravocard-encadre.png`;
}

// Position de proximite (Reglages > Geolocalisation). Google notifie
// automatiquement les clients proches avec un texte generique impose par
// la plateforme (pas de message personnalisable, contrairement a Apple).
// Toujours un tableau, jamais undefined : vide des que le reglage est
// desactive ou incomplet, pour que la classe perde bien la position au
// prochain envoi plutot que de simplement arreter d'etre mise a jour.
function construireLocalisationsGoogle(restaurant) {
  if (!restaurant?.geoloc_actif) return [];
  const latitude = Number(restaurant.geoloc_latitude);
  const longitude = Number(restaurant.geoloc_longitude);
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return [];
  return [{ latitude, longitude }];
}

function construireClasseFidelite(restaurant) {
  const nom = String(restaurant.wallet_display_name || restaurant.nom || 'Bravocard').trim().slice(0, 80);
  // Google ne lit jamais les libelles de personnalisation Apple. Son rendu
  // repose sur le programme general du restaurant.
  const carteLabel = 'FIDÉLITÉ';

  // Images propres a Google Wallet : jamais celles d'Apple. Le logo rond
  // retombe sur le logo general du restaurant (Reglages) puis, en dernier
  // recours, sur le logo Bravocard par defaut (Google l'exige). La banniere
  // et le logo large restent facultatifs et vides si non configures.
  const logo = imageGoogle(restaurant.google_program_logo_url, `Logo ${nom}`) ||
    imageGoogle(restaurant.logo_url, `Logo ${nom}`) ||
    imageGoogle(logoParDefaut(), 'Logo Bravocard');
  const logoLarge = imageGoogle(restaurant.google_wide_logo_url, `Logo large ${nom}`);
  const banniere = imageGoogle(restaurant.google_hero_image_url, `Bannière ${nom}`);

  const lignesCarte = [
    {
      oneItem: {
        item: { firstValue: { fields: [{ fieldPath: 'object.loyaltyPoints.balance' }] } }
      }
    },
    carteLabel
      ? {
          twoItems: {
            startItem: {
              firstValue: { fields: [{ fieldPath: "object.textModulesData['client']" }] }
            },
            endItem: {
              firstValue: { fields: [{ fieldPath: "object.textModulesData['type_carte']" }] }
            }
          }
        }
      : {
          oneItem: {
            item: { firstValue: { fields: [{ fieldPath: "object.textModulesData['client']" }] } }
          }
        }
  ];

  return {
    id: getRestaurantClassId(restaurant),
    issuerName: nom.slice(0, 20),
    programName: nom.slice(0, 20),
    programLogo: logo,
    hexBackgroundColor: couleurRestaurant(restaurant),
    accountNameLabel: 'CLIENT',
    accountIdLabel: 'IDENTIFIANT',
    locations: construireLocalisationsGoogle(restaurant),
    ...(logoLarge ? { wideProgramLogo: logoLarge } : {}),
    ...(banniere ? { heroImage: banniere } : {}),
    classTemplateInfo: {
      cardTemplateOverride: {
        cardRowTemplateInfos: lignesCarte
      }
    }
  };
}

function construireObjetFidelite(client, restaurant) {
  const seuilRecompense = Math.max(1, Number.parseInt(restaurant.seuil_recompense || 100, 10));
  const pointsLabel = String(restaurant.wallet_points_label || `Points sur ${seuilRecompense}`).trim();
  const carteLabel = String(restaurant.wallet_card_label || 'FIDÉLITÉ').trim();
  const recompense = String(restaurant.wallet_reward_text || restaurant.description_recompense || '').trim();

  // Niveau VIP (Reglages > Niveaux VIP), calcule a partir du cumul de
  // points jamais remis a zero. Google n'a pas de champ de niveau par
  // client au sens strict : on utilise le second emplacement de points,
  // prevu pour afficher du texte plutot qu'un nombre.
  const niveauVip = vipService.calculerNiveau(restaurant, client.points_cumules);
  const libelleNiveauVip = vipService.libelleNiveau(niveauVip);
  const avantageVip = vipService.obtenirAvantageTexte(restaurant, niveauVip);

  const objet = {
    id: getObjectId(client.id),
    classId: getRestaurantClassId(restaurant),
    state: 'ACTIVE',
    accountId: client.id,
    accountName: client.nom,
    loyaltyPoints: {
      label: pointsLabel,
      balance: { int: Number.parseInt(client.points || 0, 10) }
    },
    barcode: {
      type: restaurant.wallet_barcode_format === 'QR_CODE' ? 'QR_CODE' : 'CODE_128',
      value: client.scan_code || client.id,
      alternateText: client.scan_code || ''
    },
    textModulesData: [
      { id: 'client', header: 'CLIENT', body: client.nom },
      ...(carteLabel ? [{ id: 'type_carte', header: 'CARTE', body: carteLabel }] : []),
      ...(recompense ? [{ id: 'recompense', header: 'RÉCOMPENSE', body: recompense }] : []),
      ...(avantageVip ? [{ id: 'avantage_vip', header: `AVANTAGE ${libelleNiveauVip.toUpperCase()}`, body: avantageVip }] : []),
      ...(restaurant.telephone ? [{ id: 'telephone', header: 'TÉLÉPHONE', body: String(restaurant.telephone) }] : []),
      ...(restaurant.adresse ? [{ id: 'adresse', header: 'ADRESSE', body: String(restaurant.adresse) }] : []),
      ...(restaurant.email_public ? [{ id: 'contact', header: 'CONTACT', body: String(restaurant.email_public) }] : [])
    ]
  };

  if (client.referral_code) {
    objet.textModulesData.push({
      id: 'code_parrainage',
      header: 'CODE PARRAINAGE',
      body: String(client.referral_code)
    });
  }

  const liens = [
    ...(restaurant.site_web ? [{ id: 'site_restaurant', uri: restaurant.site_web, description: 'Site du restaurant' }] : []),
    ...(client.referral_link ? [{ id: 'parrainage', uri: client.referral_link, description: 'Parrainer un proche' }] : [])
  ];
  if (liens.length) objet.linksModuleData = { uris: liens };
  return objet;
}

async function obtenirClientGoogle() {
  verifierConfigurationGoogle();
  const auth = new GoogleAuth({
    credentials: {
      client_email: process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL,
      private_key: process.env.GOOGLE_PRIVATE_KEY.replace(/\\n/g, '\n')
    },
    scopes: [PORTEE_GOOGLE]
  });
  return auth.getClient();
}

function statutErreur(erreur) {
  return Number(erreur?.response?.status || erreur?.code || 0) || null;
}

function resumerErreurGoogle(erreur) {
  const statut = statutErreur(erreur);
  const messageApi = erreur?.response?.data?.error?.message;
  const message = String(messageApi || erreur?.message || 'Erreur Google Wallet inconnue')
    .replace(/[\r\n]+/g, ' ')
    .slice(0, 240);
  return { statut, message };
}

async function enregistrerEtatClasse(restaurant, changements) {
  if (!restaurant?.id) return;
  const { error } = await supabase
    .from('restaurants')
    .update(changements)
    .eq('id', restaurant.id);
  if (error) console.error('État Google Wallet non enregistré:', error.message);
}

async function assurerClasseRestaurant(restaurant, options = {}) {
  const classId = getRestaurantClassId(restaurant);
  const cache = cacheClasses.get(classId);
  if (!options.force && cache && Date.now() - cache.date < CACHE_CLASSE_MS) return cache.classe;

  const clientGoogle = await obtenirClientGoogle();
  const urlClasse = `https://walletobjects.googleapis.com/walletobjects/v1/loyaltyClass/${encodeURIComponent(classId)}`;
  const payload = construireClasseFidelite({ ...restaurant, google_wallet_class_id: classId });

  try {
    let classe;
    try {
      const lecture = await clientGoogle.request({ url: urlClasse, method: 'GET' });
      classe = lecture.data;
    } catch (erreurLecture) {
      if (statutErreur(erreurLecture) !== 404) throw erreurLecture;
      const creation = await clientGoogle.request({
        url: 'https://walletobjects.googleapis.com/walletobjects/v1/loyaltyClass',
        method: 'POST',
        data: { ...payload, reviewStatus: 'UNDER_REVIEW' }
      });
      classe = creation.data;
    }

    if (options.force && classe) {
      // Une classe deja approuvee par Google refuse un PATCH qui la laisse
      // "APPROVED" implicitement : il faut repasser explicitement par
      // UNDER_REVIEW a chaque modification, sans quoi Google renvoie une 400.
      const donneesPatch = { ...payload, reviewStatus: 'UNDER_REVIEW' };
      delete donneesPatch.id;
      const miseAJour = await clientGoogle.request({
        url: urlClasse,
        method: 'PATCH',
        data: donneesPatch
      });
      classe = miseAJour.data;
    }

    cacheClasses.set(classId, { date: Date.now(), classe });
    await enregistrerEtatClasse(restaurant, {
      google_wallet_class_id: classId,
      google_wallet_class_status: String(classe?.reviewStatus || 'unknown').toLowerCase(),
      google_wallet_synced_at: new Date().toISOString(),
      google_wallet_sync_error: null
    });
    return classe;
  } catch (erreur) {
    const resume = resumerErreurGoogle(erreur);
    await enregistrerEtatClasse(restaurant, {
      google_wallet_class_id: classId,
      google_wallet_sync_error: `${resume.statut || 'inconnu'} - ${resume.message}`,
      google_wallet_synced_at: new Date().toISOString()
    });
    throw erreur;
  }
}

function creerLienGoogleWallet(client, restaurant) {
  verifierConfigurationGoogle();
  const objetFidelite = construireObjetFidelite(client, restaurant);
  const claims = {
    iss: process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL,
    aud: 'google',
    typ: 'savetowallet',
    payload: { loyaltyObjects: [objetFidelite] }
  };
  const clePrivee = process.env.GOOGLE_PRIVATE_KEY.replace(/\\n/g, '\n');
  const token = jwt.sign(claims, clePrivee, { algorithm: 'RS256' });
  return `https://pay.google.com/gp/v/save/${token}`;
}

async function memoriserObjetClient(client) {
  const objectId = getObjectId(client.id);
  if (client.google_wallet_object_id === objectId) return objectId;
  const { error } = await supabase
    .from('clients')
    .update({ google_wallet_object_id: objectId })
    .eq('id', client.id);
  if (error) console.error('Identifiant Google Wallet non enregistré:', error.message);
  return objectId;
}

async function mettreAJourPointsWallet(client, restaurant) {
  await assurerClasseRestaurant(restaurant);
  const clientGoogle = await obtenirClientGoogle();
  const objet = construireObjetFidelite(client, restaurant);
  try {
    await clientGoogle.request({
      url: `https://walletobjects.googleapis.com/walletobjects/v1/loyaltyObject/${encodeURIComponent(objet.id)}`,
      method: 'PATCH',
      data: {
        classId: objet.classId,
        accountId: objet.accountId,
        accountName: objet.accountName,
        loyaltyPoints: objet.loyaltyPoints,
        barcode: objet.barcode,
        textModulesData: objet.textModulesData,
        ...(objet.linksModuleData ? { linksModuleData: objet.linksModuleData } : {})
      }
    });
    await memoriserObjetClient(client);
    return true;
  } catch (erreur) {
    console.error('Erreur mise à jour Google Wallet:', resumerErreurGoogle(erreur).message);
    return false;
  }
}

async function creerObjetWallet(client, restaurant) {
  await assurerClasseRestaurant(restaurant);
  const clientGoogle = await obtenirClientGoogle();
  const objet = construireObjetFidelite(client, restaurant);
  try {
    await clientGoogle.request({
      url: 'https://walletobjects.googleapis.com/walletobjects/v1/loyaltyObject',
      method: 'POST',
      data: objet
    });
    await memoriserObjetClient(client);
    return true;
  } catch (erreur) {
    if (statutErreur(erreur) === 409) {
      return mettreAJourPointsWallet(client, restaurant);
    }
    console.error('Erreur création objet Google Wallet:', resumerErreurGoogle(erreur).message);
    return false;
  }
}

async function synchroniserObjetWallet(client, restaurant) {
  const misAJour = await mettreAJourPointsWallet(client, restaurant);
  if (misAJour) return true;
  return creerObjetWallet(client, restaurant);
}

async function diagnostiquerSynchronisationObjetWallet(client, restaurant) {
  try {
    await assurerClasseRestaurant(restaurant);
  } catch (erreurClasse) {
    return { succes: false, action: 'echec_classe', erreur: resumerErreurGoogle(erreurClasse) };
  }

  const clientGoogle = await obtenirClientGoogle();
  const objet = construireObjetFidelite(client, restaurant);
  try {
    await clientGoogle.request({
      url: `https://walletobjects.googleapis.com/walletobjects/v1/loyaltyObject/${encodeURIComponent(objet.id)}`,
      method: 'PATCH',
      data: {
        classId: objet.classId,
        accountId: objet.accountId,
        accountName: objet.accountName,
        loyaltyPoints: objet.loyaltyPoints,
        barcode: objet.barcode,
        textModulesData: objet.textModulesData,
        ...(objet.linksModuleData ? { linksModuleData: objet.linksModuleData } : {})
      }
    });
    await memoriserObjetClient(client);
    return { succes: true, action: 'mise_a_jour' };
  } catch (erreurMiseAJour) {
    if (statutErreur(erreurMiseAJour) !== 404) {
      return { succes: false, action: 'echec_mise_a_jour', erreur: resumerErreurGoogle(erreurMiseAJour) };
    }
    try {
      await clientGoogle.request({
        url: 'https://walletobjects.googleapis.com/walletobjects/v1/loyaltyObject',
        method: 'POST',
        data: objet
      });
      await memoriserObjetClient(client);
      return { succes: true, action: 'creation' };
    } catch (erreurCreation) {
      return { succes: false, action: 'echec_creation', erreur: resumerErreurGoogle(erreurCreation) };
    }
  }
}

async function configurerModeleCarte(restaurant) {
  await assurerClasseRestaurant(restaurant, { force: true });
  return true;
}

/**
 * Marque un objet Google Wallet comme expire : la carte s'affiche aussitot
 * comme invalide dans l'application, sur tous les appareils du client.
 * A n'appeler qu'au moment d'une suppression VRAIMENT definitive (purge de
 * la corbeille), jamais lors d'une simple mise en corbeille.
 */
async function revoquerObjetGoogle(objectId) {
  if (!objectId) return false;
  try {
    const clientGoogle = await obtenirClientGoogle();
    await clientGoogle.request({
      url: `https://walletobjects.googleapis.com/walletobjects/v1/loyaltyObject/${encodeURIComponent(objectId)}`,
      method: 'PATCH',
      data: { state: 'EXPIRED' }
    });
    return true;
  } catch (erreur) {
    if (statutErreur(erreur) === 404) return true;
    console.error('Erreur révocation Google Wallet:', resumerErreurGoogle(erreur).message);
    return false;
  }
}

async function envoyerNotificationWallet(client, titre, message, campagneId) {
  const clientGoogle = await obtenirClientGoogle();
  const objectId = getObjectId(client.id);
  const identifiantMessage = `bravocard_${String(campagneId).replace(/-/g, '')}`;
  await clientGoogle.request({
    url: `https://walletobjects.googleapis.com/walletobjects/v1/loyaltyObject/${encodeURIComponent(objectId)}/addMessage`,
    method: 'POST',
    data: {
      message: { id: identifiantMessage, header: titre, body: message, messageType: 'TEXT_AND_NOTIFY' }
    }
  });
  return true;
}

module.exports = {
  assurerClasseRestaurant,
  construireClasseFidelite,
  construireObjetFidelite,
  creerLienGoogleWallet,
  mettreAJourPointsWallet,
  creerObjetWallet,
  synchroniserObjetWallet,
  diagnostiquerSynchronisationObjetWallet,
  configurerModeleCarte,
  envoyerNotificationWallet,
  getLegacyClassId,
  getObjectId,
  getRestaurantClassId,
  revoquerObjetGoogle
};
