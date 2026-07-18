// Ce fichier gere l'envoi des emails automatiques via Brevo,
// un service gratuit qui fonctionne meme sur les hebergements gratuits
// (contrairement a Gmail/SMTP, bloque par Render sur le plan gratuit)

async function envoyerEmail(destinataire, sujet, texte) {
  if (!process.env.BREVO_API_KEY || !process.env.BREVO_SENDER_EMAIL) {
    throw new Error('Le service email Bravocard n’est pas configuré.');
  }
  const reponse = await fetch('https://api.brevo.com/v3/smtp/email', {
    method: 'POST',
    headers: {
      'api-key': process.env.BREVO_API_KEY,
      'Content-Type': 'application/json',
      'Accept': 'application/json'
    },
    body: JSON.stringify({
      sender: {
        name: process.env.BREVO_SENDER_NAME || 'Bravocard',
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

async function envoyerEmailAccesCompte(destinataire, nom, lien, nouveauCompte = false) {
  const introduction = nouveauCompte
    ? 'Votre compte professionnel Bravocard vient d’être créé.'
    : 'Nous avons reçu une demande de réinitialisation pour votre compte Bravocard.';
  const texte =
    `Bonjour ${nom},\n\n` +
    `${introduction}\n\n` +
    `Votre identifiant est : ${destinataire}\n\n` +
    `Choisissez un nouveau mot de passe grâce à ce lien sécurisé, valable 30 minutes :\n${lien}\n\n` +
    `Si vous n’êtes pas à l’origine de cette demande, ignorez simplement cet email.\n\n` +
    `L’équipe Bravocard`;

  await envoyerEmail(
    destinataire,
    nouveauCompte ? 'Activez votre accès Bravocard' : 'Réinitialisez votre mot de passe Bravocard',
    texte
  );
}

async function envoyerEmailAvis(emailDestinataire, nomClient, lienRoue) {
  const nomRestaurant = process.env.NOM_RESTAURANT;
  const lienAvis = process.env.LIEN_AVIS_GOOGLE;

  const texte =
    `Bonjour ${nomClient},\n\n` +
    `Merci d'être venu(e) chez ${nomRestaurant} aujourd'hui !\n\n` +
    `Votre avis compte énormément pour nous. Laissez-nous un avis Google en 30 secondes :\n\n` +
    `${lienAvis}\n\n` +
    `Une fois votre avis laissé, revenez ici pour tourner la roue des cadeaux :\n${lienRoue}\n\n` +
    `À très bientôt,\n` +
    `L'équipe de ${nomRestaurant}`;

  await envoyerEmail(emailDestinataire, `Merci de votre visite chez ${nomRestaurant} !`, texte);
}

async function envoyerEmailBienvenue(emailDestinataire, nomClient, restaurant, lienWallet, lienAppleWallet, codeParrainage, lienParrainage) {
  const nomRestaurant = restaurant?.nom || process.env.NOM_RESTAURANT || 'votre restaurant';

  let texte =
    `Bonjour ${nomClient},\n\n` +
    `Merci de rejoindre notre programme de fidélité !\n\n` +
    `Ajoutez votre carte à Google Wallet en cliquant ici :\n${lienWallet}\n\n`;

  if (lienAppleWallet) {
    texte += `Ou ajoutez-la à Apple Wallet en cliquant ici :\n${lienAppleWallet}\n\n`;
  }

  if (codeParrainage) {
    texte += `Votre code de parrainage personnel : ${codeParrainage}\n`;
    if (lienParrainage) texte += `Partagez ce lien avec vos proches :\n${lienParrainage}\n`;
    texte += '\n';
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

module.exports = {
  envoyerEmail,
  envoyerEmailAccesCompte,
  envoyerEmailAvis,
  envoyerEmailBienvenue,
  envoyerEmailRecompense
};
