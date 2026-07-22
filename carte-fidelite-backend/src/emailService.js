// Ce fichier gere l'envoi des emails automatiques via Brevo,
// un service gratuit qui fonctionne meme sur les hebergements gratuits
// (contrairement a Gmail/SMTP, bloque par Render sur le plan gratuit)

const COULEUR_FOND = '#f5f3f8';
const COULEUR_ENTETE = '#1b1030';
const COULEUR_VIOLET = '#7148e8';
const COULEUR_VIOLET_CLAIR = '#b79cf4';
const COULEUR_TEXTE = '#211b2b';
const COULEUR_SECONDAIRE = '#716777';

function echapperHtml(valeur) {
  return String(valeur == null ? '' : valeur)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/**
 * Gabarit HTML commun a tous les emails Bravocard : un en-tete de marque,
 * une zone de contenu libre, un bouton d'action facultatif, et un pied de
 * page discret. Ecrit en tableaux + styles inline pour rester fiable dans
 * les clients email les plus stricts (Outlook, Gmail, etc.).
 */
function construireEmailHtml({ contenuHtml, bouton = null, nomRestaurant }) {
  const boutonHtml = bouton
    ? `<tr><td style="padding:4px 32px 8px;">
        <a href="${echapperHtml(bouton.lien)}" style="display:inline-block;background:${COULEUR_VIOLET};color:#ffffff;text-decoration:none;font-weight:700;padding:14px 30px;border-radius:99px;font-size:14px;font-family:Arial,Helvetica,sans-serif;">${echapperHtml(bouton.texte)}</a>
      </td></tr>`
    : '';

  return `<!doctype html>
<html lang="fr">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"></head>
<body style="margin:0;padding:0;background:${COULEUR_FOND};">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${COULEUR_FOND};padding:32px 16px;">
    <tr><td align="center">
      <table role="presentation" width="480" cellpadding="0" cellspacing="0" style="max-width:480px;width:100%;background:#ffffff;border-radius:16px;overflow:hidden;box-shadow:0 4px 18px rgba(35,23,48,.06);">
        <tr><td style="background:${COULEUR_ENTETE};padding:24px 32px;">
          <span style="font-family:Arial,Helvetica,sans-serif;color:#ffffff;font-size:19px;font-weight:800;">Bravo<span style="color:${COULEUR_VIOLET_CLAIR};">card</span></span>
        </td></tr>
        <tr><td style="padding:34px 32px 6px;font-family:Arial,Helvetica,sans-serif;color:${COULEUR_TEXTE};font-size:14px;line-height:1.6;">
          ${contenuHtml}
        </td></tr>
        ${boutonHtml}
        <tr><td style="padding:22px 32px;background:#faf8fc;border-top:1px solid #eee7f2;">
          <p style="margin:0;color:${COULEUR_SECONDAIRE};font-size:11px;line-height:1.6;font-family:Arial,Helvetica,sans-serif;">
            Cet email vous est envoye par ${echapperHtml(nomRestaurant || 'votre restaurant')} via Bravocard, la carte de fidelite digitale.
          </p>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`;
}

async function envoyerEmail(destinataire, sujet, texte, html = null) {
  if (!process.env.BREVO_API_KEY) {
    throw new Error('Le service email Bravocard n’est pas configuré.');
  }

  // L'adresse technique utilisée pour authentifier Brevo ne doit jamais être
  // exposée aux clients. Tous les messages Bravocard utilisent exclusivement
  // l'adresse publique de la marque.
  const emailPublic = 'contact@bravocard.fr';
  const corps = {
    sender: {
      name: process.env.BREVO_SENDER_NAME || 'Bravocard',
      email: emailPublic
    },
    replyTo: { name: 'Bravocard', email: emailPublic },
    to: [{ email: destinataire }],
    subject: sujet,
    textContent: texte
  };
  if (html) corps.htmlContent = html;

  const reponse = await fetch('https://api.brevo.com/v3/smtp/email', {
    method: 'POST',
    headers: {
      'api-key': process.env.BREVO_API_KEY,
      'Content-Type': 'application/json',
      'Accept': 'application/json'
    },
    body: JSON.stringify(corps)
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

  const html = construireEmailHtml({
    nomRestaurant: 'Bravocard',
    contenuHtml: `
      <p style="margin:0 0 14px;font-size:19px;font-weight:800;font-family:Arial,Helvetica,sans-serif;color:${COULEUR_TEXTE};">Bonjour ${echapperHtml(nom)},</p>
      <p style="margin:0 0 10px;">${echapperHtml(introduction)}</p>
      <p style="margin:0 0 4px;color:${COULEUR_SECONDAIRE};font-size:12px;">Identifiant</p>
      <p style="margin:0 0 18px;font-weight:700;">${echapperHtml(destinataire)}</p>
      <p style="margin:0;">Choisissez votre nouveau mot de passe grâce au bouton ci-dessous. Ce lien est valable 30 minutes.</p>
    `,
    bouton: { texte: 'Choisir mon mot de passe', lien }
  });

  await envoyerEmail(
    destinataire,
    nouveauCompte ? 'Activez votre accès Bravocard' : 'Réinitialisez votre mot de passe Bravocard',
    texte,
    html
  );
}

/**
 * Email envoye 1h apres l'inscription du client (carte ajoutee au telephone).
 * L'accroche met en avant le cadeau a gagner en premier plan, la mention de
 * l'avis en second plan, pour ne pas donner d'excuse a la flemme.
 */
async function envoyerEmailBienvenue(emailDestinataire, nomClient, restaurant, lienAvis) {
  const nomRestaurant = restaurant?.nom || 'votre restaurant';

  const texte =
    `Bonjour ${nomClient},\n\n` +
    `Tentez de gagner un cadeau chez ${nomRestaurant}, simplement en laissant un avis sur votre expérience :\n${lienAvis}\n\n` +
    `Cela prend moins d'une minute, et un tour de roue vous attend juste après.\n\n` +
    `À très bientôt,\n` +
    `L'équipe de ${nomRestaurant}`;

  const html = construireEmailHtml({
    nomRestaurant,
    contenuHtml: `
      <p style="margin:0 0 4px;font-size:13px;color:${COULEUR_SECONDAIRE};">Bonjour ${echapperHtml(nomClient)},</p>
      <p style="margin:0 0 6px;font-size:22px;font-weight:800;font-family:Arial,Helvetica,sans-serif;color:${COULEUR_TEXTE};line-height:1.3;">Tentez de gagner un cadeau</p>
      <p style="margin:0 0 18px;font-size:14px;color:${COULEUR_SECONDAIRE};">en laissant un avis sur votre expérience chez ${echapperHtml(nomRestaurant)}</p>
      <p style="margin:0;">Cela prend moins d'une minute, et un tour de roue vous attend juste après pour tenter de repartir avec une récompense.</p>
    `,
    bouton: { texte: 'Tenter ma chance', lien: lienAvis }
  });

  await envoyerEmail(emailDestinataire, `Tentez de gagner un cadeau chez ${nomRestaurant}`, texte, html);
}

/**
 * Email envoye ~1h apres un passage en caisse (scan du restaurateur), avec
 * le meme principe : le cadeau d'abord, l'avis ensuite.
 */
async function envoyerEmailAvis(emailDestinataire, nomClient, restaurant, lienRoue) {
  const nomRestaurant = restaurant?.nom || 'votre restaurant';
  const lienAvis = restaurant?.lien_avis_google || '';

  const texte =
    `Bonjour ${nomClient},\n\n` +
    `Merci d'être venu(e) chez ${nomRestaurant} !\n\n` +
    `Tentez de gagner un cadeau en laissant un avis sur votre passage :\n${lienRoue}\n\n` +
    `À très bientôt,\n` +
    `L'équipe de ${nomRestaurant}`;

  const html = construireEmailHtml({
    nomRestaurant,
    contenuHtml: `
      <p style="margin:0 0 4px;font-size:13px;color:${COULEUR_SECONDAIRE};">Bonjour ${echapperHtml(nomClient)},</p>
      <p style="margin:0 0 6px;font-size:22px;font-weight:800;font-family:Arial,Helvetica,sans-serif;color:${COULEUR_TEXTE};line-height:1.3;">Tentez de gagner un cadeau</p>
      <p style="margin:0 0 18px;font-size:14px;color:${COULEUR_SECONDAIRE};">en laissant un avis sur votre passage chez ${echapperHtml(nomRestaurant)}</p>
      <p style="margin:0;">Merci d'être venu(e) ! Un tour de roue vous attend dès que votre avis est envoyé.</p>
    `,
    bouton: { texte: 'Tenter ma chance', lien: lienRoue }
  });

  await envoyerEmail(emailDestinataire, `Tentez de gagner un cadeau chez ${nomRestaurant} !`, texte, html);
}

function formaterDateLisible(iso) {
  return new Date(iso).toLocaleDateString('fr-FR', { day: 'numeric', month: 'long' });
}

async function envoyerEmailCadeau(emailDestinataire, nomClient, restaurant, label, icone, valideDu, valideAu, codeRetrait) {
  const nomRestaurant = restaurant?.nom || 'votre restaurant';
  const texte =
    `Bonjour ${nomClient},\n\n` +
    `Vous avez gagné : ${label} !\n\n` +
    `Utilisable du ${formaterDateLisible(valideDu)} au ${formaterDateLisible(valideAu)}.\n\n` +
    `Pour en profiter, présentez simplement ce code au comptoir de ${nomRestaurant} :\n\n` +
    `  ${codeRetrait}\n\n` +
    `À très bientôt,\n` +
    `L'équipe de ${nomRestaurant}`;

  const html = construireEmailHtml({
    nomRestaurant,
    contenuHtml: `
      <p style="margin:0 0 4px;font-size:13px;color:${COULEUR_SECONDAIRE};">Bonjour ${echapperHtml(nomClient)},</p>
      <p style="margin:0 0 18px;font-size:22px;font-weight:800;font-family:Arial,Helvetica,sans-serif;color:${COULEUR_TEXTE};line-height:1.3;">Félicitations, vous avez gagné !</p>
      <p style="margin:0 0 20px;font-size:16px;font-weight:700;color:${COULEUR_VIOLET};">${echapperHtml(label)}</p>
      <p style="margin:0 0 4px;color:${COULEUR_SECONDAIRE};font-size:12px;">Utilisable du ${formaterDateLisible(valideDu)} au ${formaterDateLisible(valideAu)}</p>
      <p style="margin:18px 0 6px;color:${COULEUR_SECONDAIRE};font-size:12px;">Présentez ce code au comptoir de ${echapperHtml(nomRestaurant)}</p>
      <p style="margin:0;padding:14px 18px;background:#f5f2fa;border-radius:10px;display:inline-block;font-family:'Courier New',monospace;font-size:22px;font-weight:800;letter-spacing:3px;color:${COULEUR_TEXTE};">${echapperHtml(codeRetrait)}</p>
    `
  });

  await envoyerEmail(emailDestinataire, `Vous avez gagné ${label} chez ${nomRestaurant} !`, texte, html);
}

async function envoyerEmailRecompense(emailDestinataire, nomClient, restaurant) {
  const nomRestaurant = restaurant?.nom || 'votre restaurant';
  const descriptionRecompense = restaurant?.description_recompense || 'une récompense spéciale';

  const texte =
    `Bonjour ${nomClient},\n\n` +
    `Félicitations ! Vous avez atteint le seuil de points chez ${nomRestaurant}.\n\n` +
    `Vous avez droit à : ${descriptionRecompense}\n\n` +
    `Présentez simplement votre carte de fidélité lors de votre prochaine visite pour en profiter.\n\n` +
    `Merci pour votre fidélité,\n` +
    `L'équipe de ${nomRestaurant}`;

  const html = construireEmailHtml({
    nomRestaurant,
    contenuHtml: `
      <p style="margin:0 0 4px;font-size:13px;color:${COULEUR_SECONDAIRE};">Bonjour ${echapperHtml(nomClient)},</p>
      <p style="margin:0 0 18px;font-size:22px;font-weight:800;font-family:Arial,Helvetica,sans-serif;color:${COULEUR_TEXTE};line-height:1.3;">Félicitations, votre récompense vous attend !</p>
      <p style="margin:0 0 18px;">Vous avez atteint le seuil de points chez ${echapperHtml(nomRestaurant)}. Vous avez droit à :</p>
      <p style="margin:0 0 18px;font-size:16px;font-weight:700;color:${COULEUR_VIOLET};">${echapperHtml(descriptionRecompense)}</p>
      <p style="margin:0;">Présentez simplement votre carte de fidélité lors de votre prochaine visite pour en profiter.</p>
    `
  });

  await envoyerEmail(emailDestinataire, `Félicitations, votre récompense vous attend chez ${nomRestaurant} !`, texte, html);
}

module.exports = {
  envoyerEmail,
  envoyerEmailAccesCompte,
  envoyerEmailAvis,
  envoyerEmailCadeau,
  envoyerEmailBienvenue,
  envoyerEmailRecompense
};
