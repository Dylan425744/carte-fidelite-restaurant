// Ce fichier gere tout ce qui concerne Apple Wallet, via le service WalletWallet
// (walletwallet.dev), qui signe les cartes a notre place gratuitement,
// sans avoir besoin d'un compte developpeur Apple payant.

const BASE_URL = 'https://api.walletwallet.dev/api/passes';

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
    body: JSON.stringify({
      barcodeValue: client.id,
      barcodeFormat: 'QR',
      logoText: process.env.NOM_RESTAURANT,
      primaryFields: [
        { key: 'points', label: 'Points', value: String(client.points) }
      ]
    })
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

// Met a jour le solde de points sur une carte deja creee,
// grace a son serialNumber garde en base de donnees.
async function mettreAJourPasseApple(serialNumber, client) {
  const reponse = await fetch(`${BASE_URL}/${serialNumber}`, {
    method: 'PUT',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${process.env.WALLETWALLET_API_KEY}`
    },
    body: JSON.stringify({
      primaryFields: [
        { key: 'points', label: 'Points', value: String(client.points) }
      ]
    })
  });

  if (!reponse.ok) {
    const erreur = await reponse.text();
    throw new Error(`Erreur mise a jour passe Apple Wallet: ${erreur}`);
  }

  return true;
}

module.exports = { creerPasseApple, mettreAJourPasseApple };
