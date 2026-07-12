// Ce fichier gere tout ce qui concerne Google Wallet :
// - creer le lien "Ajouter a Google Wallet" pour un nouveau client
// - mettre a jour le solde de points sur une carte deja enregistree

const jwt = require('jsonwebtoken');
const { GoogleAuth } = require('google-auth-library');

function getClassId() {
  return `${process.env.GOOGLE_ISSUER_ID}.${process.env.GOOGLE_ISSUER_ID}.carte_fidelite_coin_des_amis`;
}

function getObjectId(clientId) {
  // Google Wallet impose des identifiants sans tirets, on nettoie l'UUID
  const idPropre = clientId.replace(/-/g, '');
  return `${process.env.GOOGLE_ISSUER_ID}.client_${idPropre}`;
}

function construireObjetFidelite(client) {
  return {
    id: getObjectId(client.id),
    classId: getClassId(),
    state: 'ACTIVE',
    accountId: client.id,
    accountName: client.nom,
    loyaltyPoints: {
      label: 'Points fidélité',
      balance: { int: client.points }
    },
    barcode: {
      type: 'QR_CODE',
      value: client.id
    },
    textModulesData: [
      { id: 'client', header: 'CLIENT', body: client.nom },
      { id: 'type_carte', header: 'CARTE', body: 'FIDÉLITÉ' }
    ]
  };
}

// A appeler UNE SEULE FOIS pour configurer la disposition personnalisee
// de la carte (positionne les lignes Client / Carte cote a cote, sous les points).
// Ne pas rappeler a chaque client, ça configure la classe entiere une fois pour toutes.
async function configurerModeleCarte() {
  const auth = new GoogleAuth({
    credentials: {
      client_email: process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL,
      private_key: process.env.GOOGLE_PRIVATE_KEY.replace(/\\n/g, '\n')
    },
    scopes: ['https://www.googleapis.com/auth/wallet_object.issuer']
  });

  const client_auth = await auth.getClient();
  const url = `https://walletobjects.googleapis.com/walletobjects/v1/loyaltyClass/${getClassId()}`;

  const donnees = {
    classTemplateInfo: {
      cardTemplateOverride: {
        cardRowTemplateInfos: [
          {
            twoItems: {
              startItem: {
                firstValue: {
                  fields: [{ fieldPath: "object.textModulesData['client']" }]
                }
              },
              endItem: {
                firstValue: {
                  fields: [{ fieldPath: "object.textModulesData['type_carte']" }]
                }
              }
            }
          }
        ]
      }
    }
  };

  await client_auth.request({ url, method: 'PATCH', data: donnees });
  return true;
}

// Genere le lien que le client clique pour ajouter sa carte a Google Wallet
function creerLienGoogleWallet(client) {
  const objetFidelite = construireObjetFidelite(client);

  const claims = {
    iss: process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL,
    aud: 'google',
    typ: 'savetowallet',
    payload: {
      loyaltyObjects: [objetFidelite]
    }
  };

  const clePrivee = process.env.GOOGLE_PRIVATE_KEY.replace(/\\n/g, '\n');
  const token = jwt.sign(claims, clePrivee, { algorithm: 'RS256' });

  return `https://pay.google.com/gp/v/save/${token}`;
}

// Met a jour le solde de points sur une carte deja existante dans Google Wallet
async function mettreAJourPointsWallet(client) {
  const auth = new GoogleAuth({
    credentials: {
      client_email: process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL,
      private_key: process.env.GOOGLE_PRIVATE_KEY.replace(/\\n/g, '\n')
    },
    scopes: ['https://www.googleapis.com/auth/wallet_object.issuer']
  });

  const client_auth = await auth.getClient();
  const objectId = getObjectId(client.id);

  const url = `https://walletobjects.googleapis.com/walletobjects/v1/loyaltyObject/${objectId}`;

  try {
    await client_auth.request({
      url,
      method: 'PATCH',
      data: {
        loyaltyPoints: {
          label: 'Points',
          balance: { int: client.points }
        }
      }
    });
    return true;
  } catch (erreur) {
    console.error('Erreur mise a jour Google Wallet:', erreur.message);
    return false;
  }
}

// Cree l'objet Wallet sur les serveurs Google (a faire une fois, avant meme
// que le client ait clique sur "Ajouter au Wallet"), pour pouvoir ensuite
// le mettre a jour meme si le client n'a pas encore ouvert le lien
async function creerObjetWallet(client) {
  const auth = new GoogleAuth({
    credentials: {
      client_email: process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL,
      private_key: process.env.GOOGLE_PRIVATE_KEY.replace(/\\n/g, '\n')
    },
    scopes: ['https://www.googleapis.com/auth/wallet_object.issuer']
  });

  const client_auth = await auth.getClient();
  const url = 'https://walletobjects.googleapis.com/walletobjects/v1/loyaltyObject';

  try {
    await client_auth.request({
      url,
      method: 'POST',
      data: construireObjetFidelite(client)
    });
    return true;
  } catch (erreur) {
    // Si l'objet existe deja, Google renvoie une erreur qu'on peut ignorer
    console.log('Info creation objet Wallet:', erreur.message);
    return false;
  }
}

module.exports = {
  creerLienGoogleWallet,
  mettreAJourPointsWallet,
  creerObjetWallet,
  configurerModeleCarte
};
