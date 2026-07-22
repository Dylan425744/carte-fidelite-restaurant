const qr = require('./qrCodeService');

const COULEUR_HEX = /^#[0-9A-Fa-f]{6}$/;

const THEMES = {
  'premium-violet': {
    id: 'premium-violet',
    nom: 'Premium violet',
    sombre: true,
    fond: '#15111F',
    accentFond: '#2A1E45',
    primaire: '#6C3CE9',
    secondaire: '#E8891F',
    texte: '#FFFFFF',
    texteAttenue: '#C9BFE8'
  },
  'ludique-cadeau': {
    id: 'ludique-cadeau',
    nom: 'Ludique cadeau',
    sombre: false,
    fond: '#FBF6EF',
    accentFond: '#F7E6D2',
    primaire: '#6C3CE9',
    secondaire: '#E8891F',
    texte: '#241B33',
    texteAttenue: '#726A80'
  }
};

const SUPPORTS = {
  'loyalty-square': {
    id: 'loyalty-square',
    nom: 'Sticker fidélité',
    description: 'Sticker NFC/QR carré · 100 × 100 mm',
    largeurMm: 100,
    hauteurMm: 100,
    themeParDefaut: 'premium-violet',
    lien: 'loyalty',
    titreParDefaut: 'Votre carte de fidélité',
    sousTitreParDefaut: 'Apple Wallet & Google Wallet'
  },
  'review-square': {
    id: 'review-square',
    nom: 'Sticker avis Google',
    description: 'Sticker NFC/QR carré · 100 × 100 mm',
    largeurMm: 100,
    hauteurMm: 100,
    themeParDefaut: 'ludique-cadeau',
    lien: 'review',
    titreParDefaut: 'Un avis = une chance de gagner',
    sousTitreParDefaut: 'Laissez un avis Google'
  },
  'loyalty-poster-a5': {
    id: 'loyalty-poster-a5',
    nom: 'Affiche fidélité (carte à tampons)',
    description: 'Affiche A5 comptoir · 148 × 210 mm',
    largeurMm: 148,
    hauteurMm: 210,
    themeParDefaut: 'premium-violet',
    lien: 'loyalty',
    titreParDefaut: '',
    sousTitreParDefaut: ''
  }
};

function echapperXml(valeur) {
  return String(valeur == null ? '' : valeur)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function nettoyerCouleur(valeur, valeurParDefaut) {
  const texte = String(valeur || '').trim();
  return COULEUR_HEX.test(texte) ? texte : valeurParDefaut;
}

function ajusterTexte(texte, longueurMax, valeurParDefaut) {
  const valeur = String(texte ?? '').trim() || valeurParDefaut;
  if (valeur.length <= longueurMax) return valeur;
  return `${valeur.slice(0, longueurMax - 1).trim()}…`;
}

// Il n'existe pas de mesure de police reelle cote serveur (pas de DOM/Canvas) :
// cette estimation (largeur ~= longueur x taille x ratio) suffit a eviter qu'un
// texte personnalise trop long ne deborde du support imprime.
function tailleAjustee(texte, largeurDisponibleMm, tailleBase, tailleMin, ratioCaractere = 0.58) {
  const longueur = Math.max(1, String(texte || '').length);
  const largeurEstimee = longueur * tailleBase * ratioCaractere;
  if (largeurEstimee <= largeurDisponibleMm) return tailleBase;
  return Math.max(tailleMin, largeurDisponibleMm / (longueur * ratioCaractere));
}

function initialesNom(nom) {
  const initiales = String(nom || 'Bravocard')
    .split(/\s+/).filter(Boolean).slice(0, 2)
    .map(mot => mot[0]).join('').toUpperCase();
  return initiales || 'B';
}

async function logoEnDataUri(url) {
  if (!url || !/^https:\/\//i.test(url)) return null;
  try {
    const reponse = await fetch(url, { signal: AbortSignal.timeout(4000) });
    if (!reponse.ok) return null;
    const type = reponse.headers.get('content-type') || 'image/png';
    if (!/^image\/(png|jpeg|webp)/i.test(type)) return null;
    const tampon = Buffer.from(await reponse.arrayBuffer());
    if (tampon.length > 2 * 1024 * 1024) return null;
    return `data:${type};base64,${tampon.toString('base64')}`;
  } catch {
    return null;
  }
}

// Badge en haut a gauche : logo du restaurant si disponible, sinon ses initiales
// sur un rond de couleur (meme principe que les avatars du tableau de bord).
function badgeRestaurant(x, y, rayon, nom, logoDataUri, couleurFond, couleurTexte) {
  if (logoDataUri) {
    return `<clipPath id="clipLogo"><circle cx="${x}" cy="${y}" r="${rayon}"/></clipPath>
      <circle cx="${x}" cy="${y}" r="${rayon}" fill="#FFFFFF"/>
      <image href="${logoDataUri}" x="${x - rayon}" y="${y - rayon}" width="${rayon * 2}" height="${rayon * 2}" preserveAspectRatio="xMidYMid slice" clip-path="url(#clipLogo)"/>`;
  }
  return `<circle cx="${x}" cy="${y}" r="${rayon}" fill="${couleurFond}"/>
    <text x="${x}" y="${y + rayon * 0.34}" font-family="Helvetica, Arial, sans-serif" font-weight="700" font-size="${rayon * 0.95}" fill="${couleurTexte}" text-anchor="middle">${echapperXml(initialesNom(nom))}</text>`;
}

// Trois arcs concentriques radiant depuis un point (symbole "sans contact"
// universel), construits mathematiquement pour rester parfaitement centres
// entre eux (angles identiques a rayons croissants), plutot que des arcs
// approximatifs qui se chevauchent de façon illisible.
function pictogrammeNfc(x, y, taille, couleur) {
  const echelle = taille / 15;
  const angleDebut = (20 * Math.PI) / 180;
  const angleFin = (70 * Math.PI) / 180;
  const arcs = [5, 9.5, 14].map(rayon => {
    const x1 = rayon * Math.cos(angleDebut);
    const y1 = -rayon * Math.sin(angleDebut);
    const x2 = rayon * Math.cos(angleFin);
    const y2 = -rayon * Math.sin(angleFin);
    return `<path d="M ${x1.toFixed(2)} ${y1.toFixed(2)} A ${rayon} ${rayon} 0 0 0 ${x2.toFixed(2)} ${y2.toFixed(2)}"/>`;
  }).join('');
  return `<g transform="translate(${x} ${y}) scale(${echelle})" fill="none" stroke="${couleur}" stroke-width="1.8" stroke-linecap="round">
    <circle cx="0" cy="0" r="1.6" fill="${couleur}" stroke="none"/>
    ${arcs}
  </g>`;
}

function miniRoue(x, y, rayon) {
  const couleurs = ['#6C3CE9', '#E8891F', '#2DB985', '#317FD6', '#E9687C', '#8A58E9'];
  const point = angleDeg => {
    const rad = ((angleDeg - 90) * Math.PI) / 180;
    return [x + rayon * Math.cos(rad), y + rayon * Math.sin(rad)];
  };
  const segments = couleurs.map((couleur, index) => {
    const angleDepart = (index * 360) / couleurs.length;
    const angleFin = ((index + 1) * 360) / couleurs.length;
    const [x1, y1] = point(angleDepart);
    const [x2, y2] = point(angleFin);
    return `<path d="M ${x} ${y} L ${x1.toFixed(2)} ${y1.toFixed(2)} A ${rayon} ${rayon} 0 0 1 ${x2.toFixed(2)} ${y2.toFixed(2)} Z" fill="${couleur}"/>`;
  }).join('');
  return `<g>${segments}
    <circle cx="${x}" cy="${y}" r="${rayon}" fill="none" stroke="#FFFFFF" stroke-width="1.4"/>
    <circle cx="${x}" cy="${y}" r="${rayon * 0.24}" fill="#FFFFFF"/>
    <path d="M ${x - rayon * 0.14} ${y - rayon - 2.6} L ${x + rayon * 0.14} ${y - rayon - 2.6} L ${x} ${y - rayon + 1.4} Z" fill="#FFFFFF"/>
  </g>`;
}

function badgeCentPourcent(x, y, rayon, couleur) {
  return `<g>
    <circle cx="${x}" cy="${y}" r="${rayon}" fill="${couleur}"/>
    <circle cx="${x}" cy="${y}" r="${rayon - 1.2}" fill="none" stroke="#FFFFFF" stroke-width="0.8" stroke-dasharray="2 1.6"/>
    <text x="${x}" y="${y - rayon * 0.16}" font-family="Helvetica, Arial, sans-serif" font-weight="700" font-size="${rayon * 0.56}" fill="#FFFFFF" text-anchor="middle">100%</text>
    <text x="${x}" y="${y + rayon * 0.42}" font-family="Helvetica, Arial, sans-serif" font-weight="700" font-size="${rayon * 0.22}" letter-spacing="0.15" fill="#FFFFFF" text-anchor="middle">GAGNANT</text>
  </g>`;
}

function construireLoyaltySquare(contexte) {
  const { theme, nomRestaurant, logoDataUri, titre, sousTitre, qrCarte } = contexte;
  const titreTaille = tailleAjustee(titre, 84, 6.6, 4.2);
  return `
    <rect width="100" height="100" fill="${theme.fond}"/>
    <circle cx="100" cy="0" r="34" fill="${theme.accentFond}" opacity="0.9"/>
    <circle cx="0" cy="100" r="26" fill="${theme.accentFond}" opacity="0.6"/>
    ${badgeRestaurant(13, 13, 7, nomRestaurant, logoDataUri, theme.primaire, '#FFFFFF')}
    <text x="94" y="15" font-family="Helvetica, Arial, sans-serif" font-weight="700" font-size="2.6" letter-spacing="0.3" fill="${theme.texteAttenue}" text-anchor="end">BRAVOCARD</text>
    <text x="50" y="30" font-family="Helvetica, Arial, sans-serif" font-weight="700" font-size="${titreTaille}" fill="${theme.texte}" text-anchor="middle">${echapperXml(titre)}</text>
    <text x="50" y="38.5" font-family="Helvetica, Arial, sans-serif" font-weight="400" font-size="3.3" fill="${theme.texteAttenue}" text-anchor="middle">${echapperXml(sousTitre)}</text>
    <rect x="30" y="44" width="40" height="40" rx="5" fill="#FFFFFF"/>
    ${qr.qrIntegrable(qrCarte, 36, 50, 28)}
    ${pictogrammeNfc(27, 90, 5, theme.secondaire)}
    <text x="38" y="91" font-family="Helvetica, Arial, sans-serif" font-weight="700" font-size="3.1" fill="${theme.texte}">Touchez ou scannez</text>
    <text x="50" y="94.6" font-family="Helvetica, Arial, sans-serif" font-weight="400" font-size="2.35" fill="${theme.texteAttenue}" text-anchor="middle">Aucune application à télécharger</text>
  `;
}

function construireReviewSquare(contexte) {
  const { theme, nomRestaurant, logoDataUri, titre, toujoursGagnant, qrAvis } = contexte;
  // Le badge "100% gagnant" est ancre au bord de la roue (pas du titre) pour ne
  // jamais chevaucher un nom de restaurant ou un titre personnalise plus long.
  const titreTaille = tailleAjustee(titre, 80, 5.6, 3.8);
  return `
    <rect width="100" height="100" fill="${theme.fond}"/>
    <circle cx="0" cy="0" r="30" fill="${theme.accentFond}" opacity="0.8"/>
    ${badgeRestaurant(13, 13, 7, nomRestaurant, logoDataUri, theme.primaire, '#FFFFFF')}
    <text x="94" y="15" font-family="Helvetica, Arial, sans-serif" font-weight="700" font-size="2.6" letter-spacing="0.3" fill="${theme.primaire}" text-anchor="end">BRAVOCARD</text>
    <text x="50" y="27" font-family="Helvetica, Arial, sans-serif" font-weight="700" font-size="${titreTaille}" fill="${theme.texte}" text-anchor="middle">${echapperXml(titre)}</text>
    ${miniRoue(48, 46, 10)}
    ${toujoursGagnant ? badgeCentPourcent(70, 39, 7.5, theme.secondaire) : ''}
    <text x="50" y="61.5" font-family="Helvetica, Arial, sans-serif" font-weight="400" font-size="3" fill="${theme.texteAttenue}" text-anchor="middle">Avis Google → Roue → Cadeau</text>
    <rect x="37" y="65" width="26" height="26" rx="4" fill="#FFFFFF" stroke="${theme.accentFond}" stroke-width="0.6"/>
    ${qr.qrIntegrable(qrAvis, 41, 69, 18)}
    ${pictogrammeNfc(29, 91.5, 4.6, theme.secondaire)}
    <text x="37" y="93.6" font-family="Helvetica, Arial, sans-serif" font-weight="700" font-size="2.9" fill="${theme.texte}">Touchez ou scannez</text>
  `;
}

// Rangee de jetons de progression (type carte a tampons). Le dernier jeton
// porte le pictogramme cadeau pour marquer la recompense a debloquer.
function rangeeTampons(x, y, largeurDisponible, nombre, couleur) {
  const rayon = Math.min(4.2, (largeurDisponible / nombre) * 0.36);
  const pas = nombre > 1 ? largeurDisponible / (nombre - 1) : 0;
  let jetons = '';
  for (let i = 0; i < nombre; i += 1) {
    const cx = nombre > 1 ? x + i * pas : x + largeurDisponible / 2;
    const dernier = i === nombre - 1;
    jetons += dernier
      ? `<circle cx="${cx}" cy="${y}" r="${rayon}" fill="${couleur}"/><text x="${cx}" y="${y + rayon * 0.4}" font-size="${rayon * 1.2}" text-anchor="middle">🎁</text>`
      : `<circle cx="${cx}" cy="${y}" r="${rayon}" fill="none" stroke="${couleur}" stroke-width="0.6"/>`;
  }
  return `<g>${jetons}</g>`;
}

function construireLoyaltyPosterA5(contexte) {
  const { theme, nomRestaurant, logoDataUri, nombreTampons, recompense, citation, qrCarte } = contexte;
  const largeurPage = 148;
  const hauteurPage = 210;
  const margeSecurite = 8;
  const largeurUtile = largeurPage - margeSecurite * 2;
  const recompenseTaille = tailleAjustee(recompense, largeurUtile, 6.4, 4.2, 0.52);
  const citationTaille = tailleAjustee(citation, largeurUtile - 30, 3.2, 2.4);

  return `
    <rect width="${largeurPage}" height="${hauteurPage}" fill="${theme.fond}"/>
    <rect width="${largeurPage}" height="18" fill="${theme.primaire}"/>
    <text x="${largeurPage / 2}" y="11.5" font-family="Helvetica, Arial, sans-serif" font-weight="700" font-size="4.4" letter-spacing="0.6" fill="#FFFFFF" text-anchor="middle">PROGRAMME DE FIDÉLITÉ OFFICIEL</text>

    ${badgeRestaurant(largeurPage / 2, 40, 15, nomRestaurant, logoDataUri, theme.primaire, '#FFFFFF')}

    <text x="${largeurPage / 2}" y="68" font-family="Helvetica, Arial, sans-serif" font-weight="700" font-size="8" fill="${theme.texte}" text-anchor="middle">${nombreTampons} visites cumulées</text>
    <text x="${largeurPage / 2}" y="78" font-family="Helvetica, Arial, sans-serif" font-weight="700" font-size="${recompenseTaille}" fill="${theme.primaire}" text-anchor="middle">= ${echapperXml(recompense)}</text>

    <text x="${margeSecurite}" y="94" font-family="Helvetica, Arial, sans-serif" font-weight="700" font-size="2.6" letter-spacing="0.4" fill="${theme.texteAttenue}">VOTRE PROGRESSION</text>
    ${rangeeTampons(margeSecurite + 6, 105, largeurUtile - 12, Math.min(nombreTampons, 10), theme.primaire)}

    <rect x="${largeurPage / 2 - 32}" y="115" width="64" height="12" rx="6" fill="${theme.secondaire}"/>
    <text x="${largeurPage / 2}" y="123" font-family="Helvetica, Arial, sans-serif" font-weight="700" font-size="3.6" fill="#FFFFFF" text-anchor="middle">🎁 ${echapperXml(recompense)}</text>

    <line x1="${margeSecurite}" y1="136" x2="${largeurPage - margeSecurite}" y2="136" stroke="${theme.accentFond}" stroke-width="0.6"/>

    <rect x="${margeSecurite}" y="144" width="40" height="40" rx="4" fill="#FFFFFF"/>
    ${qr.qrIntegrable(qrCarte, margeSecurite + 4, 148, 32)}
    <text x="${margeSecurite + 46}" y="153" font-family="Helvetica, Arial, sans-serif" font-weight="700" font-size="4.4" fill="${theme.texte}">Scannez pour rejoindre</text>
    ${pictogrammeNfc(margeSecurite + 46, 164, 4, theme.secondaire)}
    <text x="${margeSecurite + 55}" y="166" font-family="Helvetica, Arial, sans-serif" font-size="3" fill="${theme.texteAttenue}">Ouvrez l'appareil photo</text>
    ${pictogrammeNfc(margeSecurite + 46, 176, 4, theme.secondaire)}
    <text x="${margeSecurite + 55}" y="178" font-family="Helvetica, Arial, sans-serif" font-size="3" fill="${theme.texteAttenue}">Ajoutez à votre wallet</text>

    <rect x="${margeSecurite}" y="188" width="${largeurUtile}" height="10" rx="3" fill="${theme.accentFond}"/>
    <text x="${margeSecurite + 4}" y="194.5" font-family="Helvetica, Arial, sans-serif" font-weight="700" font-size="2.6" fill="${theme.texteAttenue}">LIEN DIRECT</text>
    <text x="${largeurPage - margeSecurite - 4}" y="194.5" font-family="Helvetica, Arial, sans-serif" font-size="2.6" fill="${theme.texte}" text-anchor="end">${echapperXml(contexte.lienAffiche)}</text>

    <text x="${largeurPage / 2}" y="204" font-family="Helvetica, Arial, sans-serif" font-style="italic" font-size="${citationTaille}" fill="${theme.texteAttenue}" text-anchor="middle">${echapperXml(citation)}</text>
  `;
}

const CONSTRUCTEURS = {
  'loyalty-square': construireLoyaltySquare,
  'review-square': construireReviewSquare,
  'loyalty-poster-a5': construireLoyaltyPosterA5
};

function resoudreTheme(restaurant, support, parametres) {
  const themeId = THEMES[parametres.theme] ? parametres.theme
    : (THEMES[restaurant.communication_theme] ? restaurant.communication_theme : support.themeParDefaut);
  const base = THEMES[themeId];
  return {
    ...base,
    primaire: nettoyerCouleur(parametres.primary_color, nettoyerCouleur(restaurant.communication_primary_color, nettoyerCouleur(restaurant.couleur_principale, base.primaire))),
    secondaire: nettoyerCouleur(parametres.secondary_color, nettoyerCouleur(restaurant.communication_secondary_color, nettoyerCouleur(restaurant.couleur_secondaire, base.secondaire)))
  };
}

function lienPourSupport(support, restaurant, marketing) {
  return support.lien === 'review'
    ? marketing.lienAvisRestaurant(restaurant)
    : marketing.lienPublicRestaurant(restaurant);
}

// Construit le contenu SVG (sans l'enveloppe racine) d'un support, a partir des
// donnees du restaurant et des parametres de personnalisation (query params du
// frontend). Utilisee a la fois par l'apercu en direct et par l'export final :
// c'est la meme fonction, donc l'apercu est garanti identique au fichier telecharge.
async function construireSupport(restaurant, parametresRecus, marketing) {
  const support = SUPPORTS[parametresRecus.support];
  if (!support) throw new Error('Support de communication inconnu.');

  const theme = resoudreTheme(restaurant, support, parametresRecus);
  const lien = lienPourSupport(support, restaurant, marketing);
  const qrGenere = await qr.genererQr(lien);
  const logoUrl = String(
    parametresRecus.logo_url || restaurant.communication_logo_url || restaurant.logo_url || restaurant.apple_logo_url || ''
  ).trim();
  const logoDataUri = await logoEnDataUri(logoUrl);

  const tamponsParDefaut = Math.min(10, Math.max(2, Math.round(
    Number(restaurant.seuil_recompense || 100) / Number(restaurant.points_per_scan || 10)
  )));

  const contexte = {
    theme,
    nomRestaurant: restaurant.nom,
    logoDataUri,
    titre: ajusterTexte(parametresRecus.title, 60, support.titreParDefaut),
    sousTitre: ajusterTexte(parametresRecus.subtitle, 60, support.sousTitreParDefaut),
    toujoursGagnant: parametresRecus.always_winner === undefined
      ? Boolean(restaurant.always_winner)
      : parametresRecus.always_winner === 'true' || parametresRecus.always_winner === true,
    nombreTampons: Math.min(10, Math.max(2, Number(parametresRecus.nombre_tampons) || tamponsParDefaut)),
    recompense: ajusterTexte(
      parametresRecus.recompense,
      60,
      restaurant.reward_title || restaurant.description_recompense || restaurant.apple_reward_text || 'Une récompense offerte'
    ),
    citation: ajusterTexte(parametresRecus.citation, 90, 'La fidélité, ça se mérite. Et ça se récompense.'),
    lienAffiche: 'bravocard.fr',
    qrCarte: qrGenere,
    qrAvis: qrGenere
  };

  const contenu = CONSTRUCTEURS[support.id](contexte);
  return { contenu, support, theme, lien };
}

function listerThemes() {
  return Object.values(THEMES).map(theme => ({ id: theme.id, nom: theme.nom, sombre: theme.sombre, primaire: theme.primaire, secondaire: theme.secondaire }));
}

function listerSupports() {
  return Object.values(SUPPORTS).map(support => ({
    id: support.id,
    nom: support.nom,
    description: support.description,
    largeur_mm: support.largeurMm,
    hauteur_mm: support.hauteurMm,
    theme_par_defaut: support.themeParDefaut,
    titre_par_defaut: support.titreParDefaut,
    sous_titre_par_defaut: support.sousTitreParDefaut
  }));
}

function serialiserBranding(restaurant) {
  return {
    communication_theme: THEMES[restaurant.communication_theme] ? restaurant.communication_theme : 'premium-violet',
    communication_primary_color: nettoyerCouleur(restaurant.communication_primary_color, ''),
    communication_secondary_color: nettoyerCouleur(restaurant.communication_secondary_color, ''),
    communication_logo_url: restaurant.communication_logo_url || '',
    reward_title: restaurant.reward_title || '',
    reward_description: restaurant.reward_description || '',
    always_winner: Boolean(restaurant.always_winner),
    lien_avis_google: restaurant.lien_avis_google || ''
  };
}

function validerUrlHttpsOuVide(valeur, nomChamp) {
  const texte = String(valeur || '').trim();
  if (!texte) return null;
  if (!/^https:\/\//i.test(texte) || texte.length > 500) {
    throw new Error(`${nomChamp} doit être une adresse https valide.`);
  }
  return texte;
}

function validerCouleurStricte(valeur, nomChamp) {
  const texte = String(valeur || '').trim().toUpperCase();
  if (!texte) return null;
  if (!COULEUR_HEX.test(texte)) {
    throw new Error(`${nomChamp} doit être au format #6C3CE9.`);
  }
  return texte;
}

// Valide les reglages de personnalisation avant enregistrement en base (contrairement
// a resoudreTheme/nettoyerCouleur utilises pour l'apercu, ici une valeur invalide
// doit bloquer l'enregistrement avec un message clair plutot que d'etre ignoree.
function validerMiseAJourBranding(donnees) {
  const theme = String(donnees.communication_theme || '').trim();
  if (theme && !THEMES[theme]) {
    throw new Error('Le thème choisi est invalide.');
  }
  return {
    communication_theme: theme || 'premium-violet',
    communication_primary_color: validerCouleurStricte(donnees.communication_primary_color, 'La couleur principale'),
    communication_secondary_color: validerCouleurStricte(donnees.communication_secondary_color, 'La couleur secondaire'),
    communication_logo_url: validerUrlHttpsOuVide(donnees.communication_logo_url, 'Le logo'),
    reward_title: donnees.reward_title ? String(donnees.reward_title).trim().slice(0, 60) : null,
    reward_description: donnees.reward_description ? String(donnees.reward_description).trim().slice(0, 160) : null,
    always_winner: Boolean(donnees.always_winner)
  };
}

module.exports = {
  THEMES,
  SUPPORTS,
  construireSupport,
  listerThemes,
  listerSupports,
  serialiserBranding,
  validerMiseAJourBranding
};
