const fs = require('fs');
const path = require('path');
const sharp = require('sharp');
const qr = require('./qrCodeService');
const catalogue = require('./marketingTemplateCatalog');

const COULEUR_HEX = /^#[0-9A-Fa-f]{6}$/;
const RACINE_PUBLIQUE = path.join(__dirname, '..', 'public');
// Source visuelle unique : remplacer ce fichier suffit pour actualiser tous les
// modèles, sans toucher aux gabarits ni aux QR codes réels.
const ROUE_OFFICIELLE = path.join(RACINE_PUBLIQUE, 'marketing-assets', 'bravocard-wheel-official.svg');
const WALLET_OFFICIEL = path.join(RACINE_PUBLIQUE, 'marketing-assets', 'bravocard-wallet-enrollment-official.svg');

function echapperXml(valeur) {
  return String(valeur == null ? '' : valeur).replace(/&/g, '&amp;').replace(/</g, '&lt;')
    .replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&apos;');
}

function nettoyerCouleur(valeur, defaut) {
  const texte = String(valeur || '').trim();
  return COULEUR_HEX.test(texte) ? texte.toUpperCase() : defaut;
}

function couleurRgb(hex) {
  const valeur = nettoyerCouleur(hex, '#000000').slice(1);
  return [0, 2, 4].map(index => Number.parseInt(valeur.slice(index, index + 2), 16));
}

function couleurHex(rgb) {
  return `#${rgb.map(canal => Math.max(0, Math.min(255, Math.round(canal))).toString(16).padStart(2, '0')).join('')}`.toUpperCase();
}

function melangerCouleurs(couleur, destination, proportion) {
  const source = couleurRgb(couleur);
  const cible = couleurRgb(destination);
  return couleurHex(source.map((canal, index) => canal + (cible[index] - canal) * proportion));
}

function luminance(couleur) {
  const canaux = couleurRgb(couleur).map(canal => {
    const normalise = canal / 255;
    return normalise <= .03928 ? normalise / 12.92 : ((normalise + .055) / 1.055) ** 2.4;
  });
  return .2126 * canaux[0] + .7152 * canaux[1] + .0722 * canaux[2];
}

function texteContraste(couleur) {
  return luminance(couleur) > .43 ? '#24102F' : '#FFFFFF';
}

function paletteWallet(style) {
  const primaire = nettoyerCouleur(style.primaire, '#7C4DFF');
  const secondaire = nettoyerCouleur(style.secondaire, '#D8B56A');
  const fond = melangerCouleurs(primaire, '#08060D', .76);
  return {
    primaire,
    secondaire,
    profond: melangerCouleurs(primaire, '#000000', .64),
    fond,
    fondSecondaire: melangerCouleurs(secondaire, '#08060D', .78),
    texte: texteContraste(fond)
  };
}

function texteLimite(valeur, defaut, longueur = 90) {
  const texte = String(valeur ?? '').trim() || defaut;
  return texte.length > longueur ? `${texte.slice(0, longueur - 1).trim()}…` : texte;
}

function tailleTexte(texte, largeur, base, minimum, ratio = 0.55) {
  return Math.max(minimum, Math.min(base, largeur / (Math.max(1, String(texte).length) * ratio)));
}

function decouperLignes(texte, longueurMax = 24, maximum = 2) {
  const mots = String(texte || '').trim().split(/\s+/).filter(Boolean);
  if (!mots.length) return [];
  const lignes = [];
  for (const mot of mots) {
    const derniere = lignes[lignes.length - 1];
    if (!derniere || (derniere.length + mot.length + 1 > longueurMax && lignes.length < maximum)) lignes.push(mot);
    else lignes[lignes.length - 1] = `${derniere} ${mot}`;
  }
  return lignes.slice(0, maximum);
}

function initiales(nom) {
  return String(nom || 'Bravocard').split(/\s+/).filter(Boolean).slice(0, 2).map(mot => mot[0]).join('').toUpperCase() || 'B';
}

function donneesImagesRestaurant(restaurant) {
  return [
    restaurant.communication_logo_url, restaurant.logo_url, restaurant.apple_logo_url,
    restaurant.google_program_logo_url, restaurant.google_wide_logo_url,
    restaurant.google_hero_image_url, restaurant.apple_strip_url
  ].filter(Boolean).map(String);
}

function listerPhotos(restaurant) {
  const personnalisees = [
    [restaurant.google_hero_image_url, 'Photo Google Wallet'],
    [restaurant.apple_strip_url, 'Bannière Apple Wallet'],
    [restaurant.google_wide_logo_url, 'Bannière du restaurant']
  ].filter(([url]) => Boolean(url)).map(([url, nom], index) => ({ id: `restaurant-${index + 1}`, nom, url, source: 'Restaurant' }));
  const vus = new Set();
  return [...personnalisees, ...catalogue.PHOTOS_DEFAUT].filter(photo => !vus.has(photo.url) && vus.add(photo.url));
}

function urlPrivee(url) {
  try {
    const hote = new URL(url).hostname.toLowerCase();
    return hote === 'localhost' || hote === '::1' || hote.endsWith('.local') ||
      /^127\./.test(hote) || /^10\./.test(hote) || /^192\.168\./.test(hote) || /^169\.254\./.test(hote) ||
      /^172\.(1[6-9]|2\d|3[01])\./.test(hote);
  } catch { return true; }
}

async function imageEnDataUri(url, { autorisees = [] } = {}) {
  const valeur = String(url || '').trim();
  if (!valeur) return null;
  if (valeur.startsWith('/wallet-banners/')) {
    const nom = path.basename(valeur);
    const fichier = path.join(RACINE_PUBLIQUE, 'wallet-banners', nom);
    if (!fs.existsSync(fichier)) return null;
    const png = await sharp(fs.readFileSync(fichier)).png({ compressionLevel: 9 }).toBuffer();
    return `data:image/png;base64,${png.toString('base64')}`;
  }
  if (!/^https:\/\//i.test(valeur) || urlPrivee(valeur) || (autorisees.length && !autorisees.includes(valeur))) return null;
  try {
    const reponse = await fetch(valeur, { signal: AbortSignal.timeout(5000), redirect: 'follow' });
    if (!reponse.ok) return null;
    const type = String(reponse.headers.get('content-type') || '').split(';')[0].toLowerCase();
    if (!['image/png', 'image/jpeg', 'image/webp'].includes(type)) return null;
    const tampon = Buffer.from(await reponse.arrayBuffer());
    if (!tampon.length || tampon.length > 4 * 1024 * 1024) return null;
    const png = type === 'image/png' ? tampon : await sharp(tampon).png({ compressionLevel: 9 }).toBuffer();
    return `data:image/png;base64,${png.toString('base64')}`;
  } catch { return null; }
}

function resoudreParametres(parametres = {}) {
  const ancien = catalogue.ANCIENS_SUPPORTS[parametres.support] || {};
  const kind = catalogue.TYPES_SUPPORT[parametres.kind] ? parametres.kind : (ancien.kind || 'wallet');
  const formatId = catalogue.FORMATS[parametres.format_layout] ? parametres.format_layout : (ancien.format_layout || 'a6-portrait');
  const aliasStyle = { 'premium-violet': 'premium', 'ludique-cadeau': 'fun' }[parametres.style || parametres.theme];
  const styleId = catalogue.STYLES[parametres.style] ? parametres.style : (aliasStyle || 'premium');
  return { kind, formatId, styleId };
}

function lienPourType(type, restaurant, marketing) {
  return type.lien === 'review' ? marketing.lienAvisRestaurant(restaurant) : marketing.lienPublicRestaurant(restaurant);
}

function appliquerAttributPalette(svg, balise, classe, attribut, valeur) {
  const expression = new RegExp(`<${balise}\\b([^>]*\\bclass="[^"]*\\b${classe}\\b[^"]*"[^>]*)>`, 'g');
  return svg.replace(expression, (ouverture, attributs) => {
    const autoFermante = /\/\s*$/.test(attributs);
    let propres = attributs.replace(/\/\s*$/, '').replace(new RegExp(`\\s${attribut}="[^"]*"`, 'g'), '');
    return `<${balise}${propres} ${attribut}="${valeur}"${autoFermante ? '/' : ''}>`;
  });
}

function roueFixe(x, y, taille, style) {
  let source = fs.readFileSync(ROUE_OFFICIELLE, 'utf8');
  const primaire = nettoyerCouleur(style.primaire, '#663ED7');
  const secondaire = nettoyerCouleur(style.secondaire, '#CDBCF6');
  const accent = nettoyerCouleur(style.accent, '#D6B15E');
  const couleursStops = {
    'wheel-primary-stop': primaire,
    'wheel-primary-deep-stop': melangerCouleurs(primaire, '#000000', .58),
    'wheel-secondary-stop': secondaire,
    'wheel-secondary-light-stop': melangerCouleurs(secondaire, '#FFFFFF', .52),
    'wheel-border-stop': melangerCouleurs(primaire, '#000000', .2),
    'wheel-accent-stop': accent,
    'wheel-accent-light-stop': melangerCouleurs(accent, '#FFFFFF', .58)
  };
  for (const [classe, couleur] of Object.entries(couleursStops)) {
    source = appliquerAttributPalette(source, 'stop', classe, 'stop-color', couleur);
  }
  source = appliquerAttributPalette(source, 'text', 'wheel-text-light', 'fill', texteContraste(primaire));
  source = appliquerAttributPalette(source, 'text', 'wheel-text-dark', 'fill', texteContraste(secondaire));
  const interieur = source.replace(/^.*?<svg[^>]*>/s, '').replace(/<\/svg>\s*$/s, '');
  return `<svg x="${x}" y="${y}" width="${taille}" height="${taille}" viewBox="0 0 1200 1200" overflow="visible" aria-label="Roue cadeau officielle">${interieur}</svg>`;
}

function walletFixe(x, y, largeur, hauteur, style, viewBox = '0 0 1000 1400') {
  let source = fs.readFileSync(WALLET_OFFICIEL, 'utf8');
  const palette = paletteWallet(style);
  const couleursStops = {
    'wallet-primary-stop': palette.primaire,
    'wallet-primary-deep-stop': palette.profond,
    'wallet-secondary-stop': palette.secondaire
  };
  for (const [classe, couleur] of Object.entries(couleursStops)) {
    source = appliquerAttributPalette(source, 'stop', classe, 'stop-color', couleur);
  }
  source = appliquerAttributPalette(source, 'circle', 'wallet-secondary-fill', 'fill', palette.secondaire);
  source = appliquerAttributPalette(source, 'text', 'wallet-secondary-fill', 'fill', palette.secondaire);
  source = appliquerAttributPalette(source, 'g', 'wallet-text-fill', 'fill', palette.texte);
  source = appliquerAttributPalette(source, 'text', 'wallet-text-fill', 'fill', palette.texte);
  source = appliquerAttributPalette(source, 'circle', 'wallet-primary-stroke', 'stroke', palette.primaire);
  source = appliquerAttributPalette(source, 'path', 'wallet-primary-stroke', 'stroke', palette.primaire);
  for (const balise of ['g', 'line']) {
    source = appliquerAttributPalette(source, balise, 'wallet-secondary-stroke', 'stroke', palette.secondaire);
  }
  const interieur = source.replace(/^.*?<svg[^>]*>/s, '').replace(/<\/svg>\s*$/s, '');
  return `<svg x="${x}" y="${y}" width="${largeur}" height="${hauteur}" viewBox="${viewBox}" preserveAspectRatio="xMidYMid meet" overflow="hidden" aria-label="Illustration officielle d'ajout Wallet">${interieur}</svg>`;
}

function walletDynamique(ctx, x, y, largeur, hauteur, viewBox = '0 0 1000 1400') {
  const { nomRestaurant, logo, style, qrGenere, titre, sousTitre, suffixe } = ctx;
  const palette = paletteWallet(style);
  const couleurEntete = palette.texte;
  const lignesTitre = decouperLignes(String(titre).toUpperCase(), 25, 2);
  const tailleTitre = Math.max(32, Math.min(70, 720 / (Math.max(10, ...lignesTitre.map(ligne => ligne.length)) * .55)));
  const lignesSousTitre = decouperLignes(String(sousTitre).toUpperCase(), 50, 2);
  const tailleNom = Math.max(20, Math.min(43, 560 / (Math.max(8, nomRestaurant.length) * .56)));
  const tailleNomCarte = Math.max(11, Math.min(21, 225 / (Math.max(8, nomRestaurant.length) * .55)));
  const idLogo = `wallet-logo-${suffixe}`;
  const badge = logo
    ? `<defs><clipPath id="${idLogo}"><circle cx="300" cy="78" r="39"/></clipPath></defs><circle cx="300" cy="78" r="43" fill="#FFFFFF"/><image href="${logo}" x="261" y="39" width="78" height="78" preserveAspectRatio="xMidYMid slice" clip-path="url(#${idLogo})"/>`
    : `<circle cx="300" cy="78" r="42" fill="${palette.primaire}"/><circle cx="300" cy="78" r="36" fill="none" stroke="${palette.secondaire}" stroke-width="2"/><text x="300" y="92" fill="${texteContraste(palette.primaire)}" font-family="Georgia, serif" font-size="43" font-weight="700" text-anchor="middle">${echapperXml(initiales(nomRestaurant).slice(0, 1))}</text>`;
  return `<svg x="${x}" y="${y}" width="${largeur}" height="${hauteur}" viewBox="${viewBox}" preserveAspectRatio="xMidYMid meet" overflow="hidden" aria-label="Contenu personnalisé du restaurant">
    ${badge}
    <text x="360" y="84" fill="${couleurEntete}" font-family="Georgia, Times New Roman, serif" font-size="${tailleNom}" font-weight="700">${echapperXml(nomRestaurant)}</text>
    <text x="362" y="116" fill="${palette.secondaire}" font-family="Helvetica, Arial, sans-serif" font-size="16" font-weight="800" letter-spacing="5">CARTE DE FIDÉLITÉ</text>
    ${lignesTitre.map((ligne, index) => `<text x="500" y="${190 + index * 72}" fill="${couleurEntete}" font-family="Georgia, Times New Roman, serif" font-size="${tailleTitre}" font-weight="700" letter-spacing="2" text-anchor="middle">${echapperXml(ligne)}</text>`).join('')}
    ${lignesSousTitre.map((ligne, index) => `<text x="500" y="${307 + index * 28}" fill="${palette.secondaire}" font-family="Helvetica, Arial, sans-serif" font-size="21" font-weight="800" letter-spacing="3" text-anchor="middle">${echapperXml(ligne)}</text>`).join('')}
    <g transform="rotate(-4 360 760)">
      <text x="208" y="515" fill="#FFFFFF" font-family="Georgia, Times New Roman, serif" font-size="${tailleNomCarte}" font-weight="700">${echapperXml(nomRestaurant)}</text>
      <text x="448" y="613" fill="${texteContraste(palette.secondaire)}" font-family="Georgia, serif" font-size="20" font-weight="700" text-anchor="middle">${echapperXml(initiales(nomRestaurant).slice(0, 1))}</text>
    </g>
    <g id="restaurant-real-wallet-qr" transform="rotate(7 710 820)">${qr.qrIntegrable(qrGenere, 577, 644, 230)}</g>
  </svg>`;
}

function fondWallet(ctx) {
  const palette = paletteWallet(ctx.style);
  const id = `fond-wallet-${ctx.suffixe}`;
  return `<defs>
    <linearGradient id="${id}" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${palette.fondSecondaire}"/><stop offset=".46" stop-color="${palette.fond}"/><stop offset="1" stop-color="#07060A"/></linearGradient>
    <radialGradient id="${id}-lueur" cx="80%" cy="18%" r="70%"><stop offset="0" stop-color="${palette.primaire}" stop-opacity=".28"/><stop offset="1" stop-color="${palette.primaire}" stop-opacity="0"/></radialGradient>
  </defs><rect width="${ctx.largeur}" height="${ctx.hauteur}" fill="url(#${id})"/><rect width="${ctx.largeur}" height="${ctx.hauteur}" fill="url(#${id}-lueur)"/>`;
}

function walletOfficiel(ctx, x, y, largeur, hauteur, viewBox = '0 0 1000 1400') {
  return `${walletFixe(x, y, largeur, hauteur, ctx.style, viewBox)}${walletDynamique(ctx, x, y, largeur, hauteur, viewBox)}`;
}

function badgeRestaurant(x, y, rayon, nom, logo, style, suffixe) {
  if (logo) return `<defs><clipPath id="logo-${suffixe}"><circle cx="${x}" cy="${y}" r="${rayon}"/></clipPath></defs>
    <circle cx="${x}" cy="${y}" r="${rayon + .7}" fill="#FFFFFF"/><image href="${logo}" x="${x - rayon}" y="${y - rayon}" width="${rayon * 2}" height="${rayon * 2}" preserveAspectRatio="xMidYMid slice" clip-path="url(#logo-${suffixe})"/>`;
  return `<circle cx="${x}" cy="${y}" r="${rayon}" fill="${style.primaire}"/><text x="${x}" y="${y + rayon * .34}" fill="#fff" font-family="Helvetica, Arial, sans-serif" font-size="${rayon * .88}" font-weight="800" text-anchor="middle">${echapperXml(initiales(nom))}</text>`;
}

function decorStyle(styleId, style, largeur, hauteur, variante) {
  const inverse = variante % 2 === 1;
  if (styleId === 'minimal') return `<line x1="${inverse ? largeur * .08 : 0}" y1="${hauteur * .11}" x2="${inverse ? largeur * .92 : largeur}" y2="${hauteur * .11}" stroke="${style.primaire}" stroke-width="1"/><circle cx="${inverse ? largeur * .9 : largeur * .1}" cy="${hauteur * .91}" r="${Math.min(largeur, hauteur) * .025}" fill="${style.primaire}"/>`;
  if (styleId === 'street-food') return `<path d="M0 ${hauteur * (inverse ? .66 : .82)}L${largeur} ${hauteur * (inverse ? .82 : .64)}V${hauteur}H0Z" fill="${style.secondaire}" opacity=".18"/><text x="${inverse ? largeur * .16 : largeur * .96}" y="${hauteur * .96}" font-size="${Math.min(largeur, hauteur) * .11}" fill="${style.primaire}" opacity=".18" text-anchor="end">///</text>`;
  if (styleId === 'elegant') return `<circle cx="${largeur * (inverse ? .08 : .92)}" cy="${hauteur * .06}" r="${Math.min(largeur, hauteur) * .22}" fill="none" stroke="${style.primaire}" stroke-width=".5" opacity=".4"/><line x1="${largeur * .08}" y1="${hauteur * (inverse ? .88 : .91)}" x2="${largeur * .92}" y2="${hauteur * (inverse ? .88 : .91)}" stroke="${style.primaire}" stroke-width=".5"/>`;
  if (styleId === 'modern') return `<rect x="${inverse ? 0 : largeur * .76}" y="0" width="${largeur * .24}" height="${hauteur * .18}" fill="${style.secondaire}" opacity=".2"/><circle cx="${largeur * (inverse ? .92 : .08)}" cy="${hauteur * .91}" r="${Math.min(largeur, hauteur) * .06}" fill="${style.primaire}" opacity=".18"/>`;
  const decalage = variante % 2 ? .88 : .94;
  return `<circle cx="${largeur * decalage}" cy="${hauteur * .05}" r="${Math.min(largeur, hauteur) * .28}" fill="${style.surface}" opacity=".8"/><circle cx="${largeur * .04}" cy="${hauteur * .96}" r="${Math.min(largeur, hauteur) * .18}" fill="${style.secondaire}" opacity=".12"/>`;
}

function fondSupport(ctx) {
  const { largeur: w, hauteur: h, style, styleId, photo, variante, suffixe } = ctx;
  const hauteurPhoto = ctx.formatId === 'square' ? h * .33 : h * .34;
  return `<rect width="${w}" height="${h}" fill="${style.fond}"/>${decorStyle(styleId, style, w, h, variante)}
    ${photo ? `<defs><clipPath id="photo-${suffixe}"><rect width="${w}" height="${hauteurPhoto}"/></clipPath><linearGradient id="voile-${suffixe}" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#000" stop-opacity=".08"/><stop offset="1" stop-color="${style.fond}" stop-opacity=".92"/></linearGradient></defs><image href="${photo}" width="${w}" height="${hauteurPhoto}" preserveAspectRatio="xMidYMid slice" clip-path="url(#photo-${suffixe})"/><rect width="${w}" height="${hauteurPhoto}" fill="url(#voile-${suffixe})"/>` : ''}`;
}

function marque(ctx, compacte = false) {
  const { largeur: w, marge: m, nomRestaurant, logo, photo, style, suffixe } = ctx;
  const r = compacte ? 5.2 : Math.min(8, w * .052);
  const couleurEntete = photo ? '#FFFFFF' : style.texte;
  return `${badgeRestaurant(m + r, m + r, r, nomRestaurant, logo, style, suffixe)}
    <text x="${m + r * 2 + 4}" y="${m + r + 1.7}" fill="${couleurEntete}" font-family="${style.police}" font-size="${compacte ? 4 : Math.min(6.2, w * .03)}" font-weight="800">${echapperXml(nomRestaurant)}</text>
    <text x="${w - m}" y="${m + r + 1}" fill="${photo ? '#FFFFFF' : style.texteAttenue}" font-family="Helvetica, Arial, sans-serif" font-size="${compacte ? 2.2 : 3.2}" font-weight="700" letter-spacing=".45" text-anchor="end">BRAVOCARD</text>`;
}

function blocQr(ctx, x, y, taille, libelle) {
  const { style, qrGenere } = ctx;
  const bord = Math.max(2.5, taille * .09);
  return `<rect x="${x - bord}" y="${y - bord}" width="${taille + bord * 2}" height="${taille + bord * 2}" rx="${bord}" fill="#FFFFFF"/>
    ${qr.qrIntegrable(qrGenere, x, y, taille)}
    <text x="${x + taille / 2}" y="${y + taille + bord + 4}" fill="${style.texte}" font-family="Helvetica, Arial, sans-serif" font-size="${Math.max(2.4, taille * .08)}" font-weight="800" text-anchor="middle">${echapperXml(libelle)}</text>`;
}

// La carte QR est un composant indépendant posé au-dessus de la roue. Elle
// reprend la composition du visuel de référence, mais contient toujours le QR
// réellement généré pour le restaurant courant.
function carteQrRoue(ctx, x, y, largeur, angle = 7) {
  const { style, qrGenere } = ctx;
  const hauteur = largeur * .94;
  const rayon = largeur * .075;
  const qrTaille = largeur * .57;
  const qrX = x + (largeur - qrTaille) / 2;
  const qrY = y + largeur * .105;
  const centreX = x + largeur / 2;
  const centreY = y + hauteur / 2;
  const epaisseur = Math.max(.45, largeur * .012);
  const coin = largeur * .09;
  return `<g id="restaurant-real-qr-card" transform="rotate(${angle} ${centreX} ${centreY})">
    <rect x="${x + largeur * .035}" y="${y + largeur * .065}" width="${largeur}" height="${hauteur}" rx="${rayon}" fill="#160D22" opacity=".2"/>
    <rect x="${x}" y="${y}" width="${largeur}" height="${hauteur}" rx="${rayon}" fill="#FCFBF8" stroke="#E6E0E9" stroke-width="${epaisseur * 1.6}"/>
    <rect x="${x + largeur * .035}" y="${y + largeur * .035}" width="${largeur * .93}" height="${hauteur - largeur * .07}" rx="${rayon * .7}" fill="none" stroke="${style.primaire}" stroke-opacity=".65" stroke-width="${epaisseur}"/>
    <path d="M${x + coin * .7} ${y + coin * 1.35}v-${coin * .55}h${coin * .55} M${x + largeur - coin * .7} ${y + coin * 1.35}v-${coin * .55}h-${coin * .55}
      M${x + coin * .7} ${y + hauteur - coin * 1.35}v${coin * .55}h${coin * .55} M${x + largeur - coin * .7} ${y + hauteur - coin * 1.35}v${coin * .55}h-${coin * .55}"
      fill="none" stroke="${style.primaire}" stroke-width="${epaisseur * 1.25}" stroke-linecap="round" stroke-linejoin="round"/>
    ${qr.qrIntegrable(qrGenere, qrX, qrY, qrTaille)}
    <text x="${centreX}" y="${y + hauteur * .82}" fill="#17111D" font-family="Helvetica, Arial, sans-serif" font-size="${largeur * .075}" font-weight="900" text-anchor="middle">SCANNEZ &amp; <tspan fill="${style.primaire}">GAGNEZ</tspan></text>
    <text x="${centreX}" y="${y + hauteur * .9}" fill="#302A34" font-family="Helvetica, Arial, sans-serif" font-size="${largeur * .052}" letter-spacing="${largeur * .003}" text-anchor="middle">VOTRE CADEAU</text>
  </g>`;
}

function rendreCarre(ctx) {
  const { largeur: w, hauteur: h, marge: m, style, type, titre, sousTitre } = ctx;
  const titleSize = tailleTexte(titre, w - 2 * m, 6.7, 4.1);
  if (type.id === 'wallet') {
    return `${fondWallet(ctx)}${walletOfficiel(ctx, 0, 0, w, h, '0 0 1000 1000')}`;
  }
  return `${fondSupport(ctx)}${marque(ctx, true)}
    <text x="${w / 2}" y="27" fill="${style.texte}" font-family="${style.police}" font-size="${titleSize}" font-weight="800" text-anchor="middle">${echapperXml(titre)}</text>
    <text x="${w / 2}" y="34" fill="${style.texteAttenue}" font-family="Helvetica, Arial, sans-serif" font-size="2.45" text-anchor="middle">${echapperXml(sousTitre)}</text>
    ${roueFixe(7, 35, 61, style)}${carteQrRoue(ctx, 54, 56, 40, 7)}`;
}

function rendrePortrait(ctx) {
  const { largeur: w, hauteur: h, marge: m, style, type, titre, sousTitre, formatId } = ctx;
  const echelle = formatId === 'a4-portrait' ? 1.7 : 1;
  const heroFin = h * .34;
  const titleSize = tailleTexte(titre, w - 2 * m, 8.2 * echelle, 5.2 * echelle);
  if (type.id === 'wallet') {
    return `${fondWallet(ctx)}${walletOfficiel(ctx, 0, 0, w, h)}`;
  }
  const grand = formatId === 'a4-portrait';
  const roueTaille = grand ? 125 : 70;
  const roueX = grand ? 18 : 7;
  const roueY = grand ? 143 : 73;
  const carteLargeur = grand ? 86 : 49;
  const carteX = grand ? 108 : 50;
  const carteY = grand ? 182 : 91;
  return `${fondSupport(ctx)}${marque(ctx)}
    <text x="${w / 2}" y="${heroFin + 13 * echelle}" fill="${style.texte}" font-family="${style.police}" font-size="${titleSize}" font-weight="800" text-anchor="middle">${echapperXml(titre)}</text>
    <text x="${w / 2}" y="${heroFin + 22 * echelle}" fill="${style.texteAttenue}" font-family="Helvetica, Arial, sans-serif" font-size="${3.1 * echelle}" text-anchor="middle">${echapperXml(sousTitre)}</text>
    ${roueFixe(roueX, roueY, roueTaille, style)}
    ${carteQrRoue(ctx, carteX, carteY, carteLargeur, 7)}
    <text x="${w / 2}" y="${h - m}" fill="${style.texteAttenue}" font-family="Helvetica, Arial, sans-serif" font-size="${2.4 * echelle}" text-anchor="middle">Avis Google → validation → roue cadeau</text>`;
}

async function construireSupport(restaurant, parametresRecus, marketing) {
  const { kind, formatId, styleId } = resoudreParametres(parametresRecus);
  const type = catalogue.TYPES_SUPPORT[kind];
  const format = catalogue.FORMATS[formatId];
  const baseStyle = catalogue.STYLES[styleId];
  const style = {
    ...baseStyle,
    primaire: nettoyerCouleur(parametresRecus.primary_color, nettoyerCouleur(restaurant.communication_primary_color, baseStyle.primaire)),
    secondaire: nettoyerCouleur(parametresRecus.secondary_color, nettoyerCouleur(restaurant.communication_secondary_color, baseStyle.secondaire)),
    accent: nettoyerCouleur(parametresRecus.accent_color, baseStyle.accent || '#D6B15E')
  };
  const lien = lienPourType(type, restaurant, marketing);
  const qrGenere = await qr.genererQr(lien, { marge: 4, correction: 'H' });
  const imagesRestaurant = donneesImagesRestaurant(restaurant);
  const logoUrl = String(parametresRecus.logo_url || restaurant.communication_logo_url || restaurant.logo_url || restaurant.apple_logo_url || restaurant.google_program_logo_url || '').trim();
  const photoUrl = String(parametresRecus.photo_url || '').trim();
  const photosAutorisees = listerPhotos(restaurant).map(photo => photo.url);
  const [logo, photo] = await Promise.all([
    imageEnDataUri(logoUrl, { autorisees: imagesRestaurant }),
    imageEnDataUri(photoUrl, { autorisees: photosAutorisees })
  ]);
  const variante = Math.max(0, Math.min(9, Number.parseInt(parametresRecus.variant, 10) || 0));
  const ctx = {
    largeur: format.largeurMm, hauteur: format.hauteurMm,
    marge: formatId === 'a4-portrait' ? 14 : 7,
    type, formatId, styleId, style, variante,
    suffixe: `${kind}-${formatId}-${styleId}-${variante}`.replace(/[^a-z0-9-]/g, ''),
    nomRestaurant: texteLimite(restaurant.nom, 'Votre restaurant', 45), logo, photo,
    titre: texteLimite(parametresRecus.title, type.titreParDefaut, 72),
    sousTitre: texteLimite(parametresRecus.subtitle, type.sousTitreParDefaut, 100),
    qrGenere
  };
  const contenu = formatId === 'square' ? rendreCarre(ctx) : rendrePortrait(ctx);
  return { contenu, support: { id: `${kind}-${formatId}`, largeurMm: format.largeurMm, hauteurMm: format.hauteurMm }, style, lien };
}

function normaliserReglage(reglage, kind) {
  const type = catalogue.TYPES_SUPPORT[kind];
  const formatId = catalogue.FORMATS[reglage?.format_layout] ? reglage.format_layout : 'a6-portrait';
  const style = catalogue.STYLES[reglage?.style] ? reglage.style : (kind === 'wheel' ? 'fun' : 'premium');
  return {
    format_layout: formatId, style,
    primary_color: nettoyerCouleur(reglage?.primary_color, catalogue.STYLES[style].primaire),
    secondary_color: nettoyerCouleur(reglage?.secondary_color, catalogue.STYLES[style].secondaire),
    accent_color: nettoyerCouleur(reglage?.accent_color, catalogue.STYLES[style].accent || '#D6B15E'),
    photo_url: String(reglage?.photo_url || '').slice(0, 500),
    title: texteLimite(reglage?.title, type.titreParDefaut, 72),
    subtitle: texteLimite(reglage?.subtitle, type.sousTitreParDefaut, 100),
    variant: Math.max(0, Math.min(9, Number.parseInt(reglage?.variant, 10) || 0))
  };
}

function reglagesParDefaut(restaurant) {
  const existants = restaurant.communication_generator_settings && typeof restaurant.communication_generator_settings === 'object'
    ? restaurant.communication_generator_settings : {};
  return { wallet: normaliserReglage(existants.wallet, 'wallet'), wheel: normaliserReglage(existants.wheel, 'wheel') };
}

function serialiserBranding(restaurant) {
  const ancienStyle = { 'premium-violet': 'premium', 'ludique-cadeau': 'fun' }[restaurant.communication_theme] || 'premium';
  return {
    communication_theme: ancienStyle,
    communication_primary_color: nettoyerCouleur(restaurant.communication_primary_color, ''),
    communication_secondary_color: nettoyerCouleur(restaurant.communication_secondary_color, ''),
    communication_logo_url: restaurant.communication_logo_url || '',
    generator_settings: reglagesParDefaut(restaurant)
  };
}

function validerUrlHttpsOuVide(valeur, nomChamp) {
  const texte = String(valeur || '').trim();
  if (!texte) return null;
  if (!/^https:\/\//i.test(texte) || texte.length > 500 || urlPrivee(texte)) throw new Error(`${nomChamp} doit être une adresse HTTPS publique valide.`);
  return texte;
}

function validerMiseAJourBranding(donnees) {
  const style = catalogue.STYLES[donnees.communication_theme] ? donnees.communication_theme : 'premium';
  const settings = donnees.generator_settings && typeof donnees.generator_settings === 'object' ? donnees.generator_settings : {};
  return {
    communication_theme: style === 'fun' ? 'ludique-cadeau' : 'premium-violet',
    communication_primary_color: nettoyerCouleur(donnees.communication_primary_color, catalogue.STYLES[style].primaire),
    communication_secondary_color: nettoyerCouleur(donnees.communication_secondary_color, catalogue.STYLES[style].secondaire),
    communication_logo_url: validerUrlHttpsOuVide(donnees.communication_logo_url, 'Le logo'),
    communication_generator_settings: {
      wallet: normaliserReglage(settings.wallet, 'wallet'),
      wheel: normaliserReglage(settings.wheel, 'wheel')
    }
  };
}

module.exports = {
  construireSupport,
  listerTypes: catalogue.listerTypes,
  listerFormats: catalogue.listerFormats,
  listerStyles: catalogue.listerStyles,
  listerPhotos,
  serialiserBranding,
  validerMiseAJourBranding
};
