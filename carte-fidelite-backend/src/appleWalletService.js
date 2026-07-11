// Ce fichier gere tout ce qui concerne Apple Wallet, via le service WalletWallet
// (walletwallet.dev), qui signe les cartes a notre place gratuitement,
// sans avoir besoin d'un compte developpeur Apple payant.

const BASE_URL = 'https://api.walletwallet.dev/api/passes';

// Construit l'ensemble complet des champs de la carte (design + contenu).
// Utilise a l'identique pour la creation ET la mise a jour, pour eviter
// tout champ manquant qui ferait echouer une mise a jour silencieusement.
function construireChampsCarte(client) {
  return {
    barcodeValue: client.id,
    barcodeFormat: 'QR',
    logoText: process.env.NOM_RESTAURANT,
    organizationName: process.env.NOM_RESTAURANT,
    description: `Carte de fidélité ${process.env.NOM_RESTAURANT}`,
    // Palette Bravocard : violet electrique en fond, texte nuage, labels lavande clair
    backgroundColor: 'rgb(108, 60, 233)',
    foregroundColor: 'rgb(255, 249, 243)',
    labelColor: 'rgb(216, 205, 240)',
    primaryFields: [
      { key: 'points', label: 'Points', value: String(client.points) }
    ],
    secondaryFields: [
      { key: 'nom', label: 'Client', value: client.nom }
    ]
  };
}

// Cree une nouvelle carte pour un client.
// Renvoie le serialNumber (a sauvegarder dans Supabase) et le shareUrl
// (le lien a envoyer au client pour qu'il ajoute sa carte).
async function creerPasseApple(client) {
  const reponse = await fetch(BASE_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${process.env.WALLETWALLET_API_KEY}`
    },
    body: JSON.stringify(construireChampsCarte(client))
  });

  if (!reponse.ok) {
    const erreur = await reponse.text();
    throw new Error(`Erreur creation passe Apple Wallet: ${erreur}`);
  }

  const donnees = await reponse.json();
  return {
    serialNumber: donnees.serialNumber,
    shareUrl: donnees.shareUrl
  };
}

// Attend un court instant, utilise entre deux tentatives
function attendre(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// Met a jour le solde de points (et tout le reste de la carte, par securite)
// sur une carte deja creee, grace a son serialNumber garde en base de donnees.
// Reessaie une fois en cas d'echec reseau ponctuel.
async function mettreAJourPasseApple(serialNumber, client, tentative = 1) {
  const reponse = await fetch(`${BASE_URL}/${serialNumber}`, {
    method: 'PUT',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${process.env.WALLETWALLET_API_KEY}`
    },
    body: JSON.stringify(construireChampsCarte(client))
  });

  if (!reponse.ok) {
    const erreur = await reponse.text();

    if (tentative < 2) {
      console.log(`Echec mise a jour Apple Wallet, nouvelle tentative... (${erreur})`);
      await attendre(1500);
      return mettreAJourPasseApple(serialNumber, client, tentative + 1);
    }

    throw new Error(`Erreur mise a jour passe Apple Wallet apres 2 tentatives: ${erreur}`);
  }

  return true;
}

module.exports = { creerPasseApple, mettreAJourPasseApple };
