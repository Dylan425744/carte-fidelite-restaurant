// Ce fichier gere l'envoi des emails automatiques (avis Google, bienvenue, etc.)
// Utilise ton compte Gmail existant, gratuitement.

const nodemailer = require('nodemailer');

const transporteur = nodemailer.createTransport({
  service: 'gmail',
  auth: {
    user: process.env.GMAIL_USER,
    pass: process.env.GMAIL_APP_PASSWORD
  }
});

async function envoyerEmailAvis(emailDestinataire, nomClient) {
  const nomRestaurant = process.env.NOM_RESTAURANT;
  const lienAvis = process.env.LIEN_AVIS_GOOGLE;

  const contenu = {
    from: process.env.GMAIL_USER,
    to: emailDestinataire,
    subject: `Merci de votre visite chez ${nomRestaurant} !`,
    text:
      `Bonjour ${nomClient},\n\n` +
      `Merci d'etre venu(e) chez ${nomRestaurant} aujourd'hui !\n\n` +
      `Votre avis compte enormement pour nous. Auriez-vous 30 secondes pour nous laisser un avis Google ?\n\n` +
      `${lienAvis}\n\n` +
      `A tres bientot,\n` +
      `L'equipe de ${nomRestaurant}`
  };

  await transporteur.sendMail(contenu);
}

async function envoyerEmailBienvenue(emailDestinataire, nomClient, lienWallet) {
  const nomRestaurant = process.env.NOM_RESTAURANT;

  const contenu = {
    from: process.env.GMAIL_USER,
    to: emailDestinataire,
    subject: `Bienvenue chez ${nomRestaurant} !`,
    text:
      `Bonjour ${nomClient},\n\n` +
      `Merci de rejoindre notre programme de fidelite !\n\n` +
      `Ajoutez votre carte a Google Wallet en cliquant ici :\n${lienWallet}\n\n` +
      `A tres bientot,\n` +
      `L'equipe de ${nomRestaurant}`
  };

  await transporteur.sendMail(contenu);
}

module.exports = { envoyerEmailAvis, envoyerEmailBienvenue };
