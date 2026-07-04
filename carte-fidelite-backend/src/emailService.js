// Ce fichier gere l'envoi des emails automatiques via Brevo,
// un service gratuit qui fonctionne meme sur les hebergements gratuits
// (contrairement a Gmail/SMTP, bloque par Render sur le plan gratuit)

async function envoyerEmail(destinataire, sujet, texte) {
  const reponse = await fetch('https://api.brevo.com/v3/smtp/email', {
    method: 'POST',
    headers: {
      'api-key': process.env.BREVO_API_KEY,
      'Content-Type': 'application/json',
      'Accept': 'application/json'
    },
    body: JSON.stringify({
      sender: {
        name: process.env.NOM_RESTAURANT,
        email: process.env.BREVO_SENDER_EMAIL
      },
      to: [{ email: destinataire }],
      subject: sujet,
      textContent: texte
    })
  });

  if (!reponse.ok) {
    const erreur = await reponse.text();
    throw new Error(`Erreur envoi email Brevo: ${erreur}`);
  }
}

async function envoyerEmailAvis(emailDestinataire, nomClient) {
  const nomRestaurant = process.env.NOM_RESTAURANT;
  const lienAvis = process.env.LIEN_AVIS_GOOGLE;

  const texte =
    `Bonjour ${nomClient},\n\n` +
    `Merci d'etre venu(e) chez ${nomRestaurant} aujourd'hui !\n\n` +
    `Votre avis compte enormement pour nous. Auriez-vous 30 secondes pour nous laisser un avis Google ?\n\n` +
    `${lienAvis}\n\n` +
    `A tres bientot,\n` +
    `L'equipe de ${nomRestaurant}`;

  await envoyerEmail(emailDestinataire, `Merci de votre visite chez ${nomRestaurant} !`, texte);
}

async function envoyerEmailBienvenue(emailDestinataire, nomClient, lienWallet) {
  const nomRestaurant = process.env.NOM_RESTAURANT;

  const texte =
    `Bonjour ${nomClient},\n\n` +
    `Merci de rejoindre notre programme de fidelite !\n\n` +
    `Ajoutez votre carte a Google Wallet en cliquant ici :\n${lienWallet}\n\n` +
    `A tres bientot,\n` +
    `L'equipe de ${nomRestaurant}`;

  await envoyerEmail(emailDestinataire, `Bienvenue chez ${nomRestaurant} !`, texte);
}

module.exports = { envoyerEmailAvis, envoyerEmailBienvenue };
