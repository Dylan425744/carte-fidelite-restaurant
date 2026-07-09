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
    `Merci d'être venu(e) chez ${nomRestaurant} aujourd'hui !\n\n` +
    `Votre avis compte énormément pour nous. Auriez-vous 30 secondes pour nous laisser un avis Google ?\n\n` +
    `${lienAvis}\n\n` +
    `À très bientôt,\n` +
    `L'équipe de ${nomRestaurant}`;

  await envoyerEmail(emailDestinataire, `Merci de votre visite chez ${nomRestaurant} !`, texte);
}

async function envoyerEmailBienvenue(emailDestinataire, nomClient, lienWallet, lienAppleWallet) {
  const nomRestaurant = process.env.NOM_RESTAURANT;

  let texte =
    `Bonjour ${nomClient},\n\n` +
    `Merci de rejoindre notre programme de fidélité !\n\n` +
    `Ajoutez votre carte à Google Wallet en cliquant ici :\n${lienWallet}\n\n`;

  if (lienAppleWallet) {
    texte += `Ou ajoutez-la à Apple Wallet en cliquant ici :\n${lienAppleWallet}\n\n`;
  }

  texte += `À très bientôt,\n` + `L'équipe de ${nomRestaurant}`;

  await envoyerEmail(emailDestinataire, `Bienvenue chez ${nomRestaurant} !`, texte);
}

async function envoyerEmailRecompense(emailDestinataire, nomClient) {
  const nomRestaurant = process.env.NOM_RESTAURANT;
  const descriptionRecompense = process.env.DESCRIPTION_RECOMPENSE || 'une récompense spéciale';

  const texte =
    `Bonjour ${nomClient},\n\n` +
    `Félicitations ! Vous avez atteint le seuil de points chez ${nomRestaurant}.\n\n` +
    `Vous avez droit à : ${descriptionRecompense}\n\n` +
    `Présentez simplement votre carte de fidélité lors de votre prochaine visite pour en profiter.\n\n` +
    `Merci pour votre fidélité,\n` +
    `L'équipe de ${nomRestaurant}`;

  await envoyerEmail(emailDestinataire, `Félicitations, votre récompense vous attend chez ${nomRestaurant} !`, texte);
}

module.exports = { envoyerEmailAvis, envoyerEmailBienvenue, envoyerEmailRecompense };
