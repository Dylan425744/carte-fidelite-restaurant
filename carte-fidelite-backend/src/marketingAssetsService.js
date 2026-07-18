const crypto = require('crypto');
const QRCode = require('qrcode');
const PDFDocument = require('pdfkit');
const supabase = require('./supabaseClient');

const BUCKET = 'restaurant-marketing';
const VERSION_MISE_EN_PAGE = 3;

function urlPubliqueBase() {
  return String(process.env.MARKETING_PUBLIC_BASE_URL || 'https://bravocard.fr').replace(/\/$/, '');
}

function lienPublicRestaurant(restaurant) {
  return `${urlPubliqueBase()}/r/${encodeURIComponent(restaurant.public_qr_token)}`;
}

function lienAvisRestaurant(restaurant) {
  return `${urlPubliqueBase()}/avis/${encodeURIComponent(restaurant.public_qr_token)}`;
}

function urlFichier(chemin) {
  if (!chemin) return null;
  return supabase.storage.from(BUCKET).getPublicUrl(chemin).data.publicUrl;
}

function offreAvecSecondQr(restaurant) {
  return ['pro', 'premium'].includes(restaurant._marketing_plan);
}

async function enrichirOffre(restaurant) {
  if (!restaurant.billing_owner_user_id) return { ...restaurant, _marketing_plan: 'starter' };
  const { data, error } = await supabase.from('user_profiles')
    .select('subscription_plan').eq('user_id', restaurant.billing_owner_user_id).maybeSingle();
  if (error) throw error;
  return { ...restaurant, _marketing_plan: data?.subscription_plan || 'starter' };
}

function serialiserSupports(restaurant) {
  const secondQr = offreAvecSecondQr(restaurant);
  return {
    statut: restaurant.marketing_assets_status || 'pending',
    lien_public: restaurant.public_qr_token ? lienPublicRestaurant(restaurant) : null,
    qr_svg_url: urlFichier(restaurant.qr_svg_path),
    qr_png_url: urlFichier(restaurant.qr_png_path),
    flyer_pdf_url: urlFichier(restaurant.flyer_pdf_path),
    secondaire_disponible: secondQr,
    lien_avis_public: secondQr ? lienAvisRestaurant(restaurant) : null,
    lien_avis_google: restaurant.lien_avis_google || '',
    secondary_qr_svg_url: secondQr ? urlFichier(restaurant.secondary_qr_svg_path) : null,
    secondary_qr_png_url: secondQr ? urlFichier(restaurant.secondary_qr_png_path) : null,
    version: Number(restaurant.marketing_assets_version || 1),
    actualise_le: restaurant.marketing_assets_updated_at || null,
    erreur: restaurant.marketing_assets_error || null
  };
}

async function assurerJeton(restaurant) {
  if (restaurant.public_qr_token) return restaurant;
  const { data, error } = await supabase.from('restaurants')
    .update({ public_qr_token: crypto.randomBytes(18).toString('hex') })
    .eq('id', restaurant.id).select('*').single();
  if (error) throw error;
  return data;
}

function creerFlyer(restaurant, qrCarte, qrAvis = null) {
  return new Promise((resolve, reject) => {
    const document = new PDFDocument({ size: 'A5', margin: 0, info: { Title: `Flyer ${restaurant.nom}`, Author: 'Bravocard' } });
    const morceaux = [];
    document.on('data', morceau => morceaux.push(morceau));
    document.on('end', () => resolve(Buffer.concat(morceaux)));
    document.on('error', reject);
    const largeur = document.page.width;
    const hauteur = document.page.height;
    document.rect(0, 0, largeur, hauteur).fill('#11111A');
    document.circle(largeur - 35, 35, 115).fill('#6D4AFF');
    document.circle(15, hauteur - 10, 105).fill('#392572');
    document.fillColor('#BBAEFF').fontSize(8).font('Helvetica-Bold')
      .text('VOTRE FIDELITE, DANS VOTRE TELEPHONE', 32, 42, { width: largeur - 64, characterSpacing: 0.8 });
    document.fillColor('#FFFFFF').fontSize(27).font('Helvetica-Bold')
      .text(`Bienvenue chez ${restaurant.nom || 'votre restaurant'}`, 32, 78, { width: largeur - 64 });
    document.fillColor('#E8E5F2').fontSize(15).font('Helvetica')
      .text('Scannez. Ajoutez la carte. Cumulez vos avantages.', 32, 153, { width: largeur - 64, lineGap: 4 });

    const taille = qrAvis ? 145 : 225;
    const y = 225;
    const xCarte = qrAvis ? 47 : (largeur - taille) / 2;
    document.roundedRect(xCarte - 15, y - 15, taille + 30, taille + 30, 18).fill('#FFFFFF');
    document.image(qrCarte, xCarte, y, { width: taille, height: taille });
    if (qrAvis) {
      const xAvis = largeur - 47 - taille;
      document.roundedRect(xAvis - 15, y - 15, taille + 30, taille + 30, 18).fill('#FFFFFF');
      document.image(qrAvis, xAvis, y, { width: taille, height: taille });
      document.fillColor('#FFFFFF').fontSize(11).font('Helvetica-Bold')
        .text('CREER MA CARTE', xCarte - 15, y + taille + 25, { width: taille + 30, align: 'center' })
        .text('DONNER MON AVIS', xAvis - 15, y + taille + 25, { width: taille + 30, align: 'center' });
    } else {
      document.fillColor('#FFFFFF').fontSize(17).font('Helvetica-Bold')
        .text(`Scannez pour creer votre carte chez ${restaurant.nom}`, 32, y + taille + 42, { width: largeur - 64, align: 'center' });
    }
    document.fillColor('#B9B5C7').fontSize(9).font('Helvetica')
      .text(`Programme fidelite de ${restaurant.nom} · bravocard.fr`, 45, y + taille + 76, { width: largeur - 90, align: 'center' });
    document.fillColor('#BBAEFF').fontSize(11).font('Helvetica-Bold')
      .text('PROPULSE PAR BRAVOCARD', 32, hauteur - 45, { width: largeur - 64, align: 'center', characterSpacing: 1 });
    document.end();
  });
}

async function televerser(chemin, contenu, contentType) {
  const { error } = await supabase.storage.from(BUCKET).upload(chemin, contenu, {
    contentType, upsert: true, cacheControl: '31536000'
  });
  if (error) throw error;
}

async function assurerSupportsMarketing(restaurantRecu, options = {}) {
  let restaurant = await enrichirOffre(await assurerJeton(restaurantRecu));
  const secondQr = offreAvecSecondQr(restaurant);
  const versionActuelle = Number(restaurant.marketing_assets_version || 1);
  const complet = restaurant.marketing_assets_status === 'ready' &&
    versionActuelle >= VERSION_MISE_EN_PAGE && restaurant.qr_svg_path && restaurant.qr_png_path &&
    restaurant.flyer_pdf_path && (!secondQr || (restaurant.secondary_qr_svg_path && restaurant.secondary_qr_png_path));
  if (complet && !options.force) return serialiserSupports(restaurant);

  const version = options.force ? Math.max(VERSION_MISE_EN_PAGE, versionActuelle + 1) : Math.max(VERSION_MISE_EN_PAGE, versionActuelle);
  await supabase.from('restaurants').update({ marketing_assets_status: 'generating', marketing_assets_error: null }).eq('id', restaurant.id);
  try {
    const optionsQr = { errorCorrectionLevel: 'Q', margin: 4, color: { dark: '#11111AFF', light: '#FFFFFFFF' } };
    const lienCarte = lienPublicRestaurant(restaurant);
    const [svg, png] = await Promise.all([
      QRCode.toString(lienCarte, { ...optionsQr, type: 'svg' }),
      QRCode.toBuffer(lienCarte, { ...optionsQr, type: 'png', width: 1200 })
    ]);
    const [svgAvis, pngAvis] = secondQr ? await Promise.all([
      QRCode.toString(lienAvisRestaurant(restaurant), { ...optionsQr, type: 'svg' }),
      QRCode.toBuffer(lienAvisRestaurant(restaurant), { ...optionsQr, type: 'png', width: 1200 })
    ]) : [null, null];
    const flyer = await creerFlyer(restaurant, png, pngAvis);
    const prefixe = String(restaurant.id);
    const chemins = {
      qr_svg_path: `${prefixe}/qr-v${version}.svg`,
      qr_png_path: `${prefixe}/qr-v${version}.png`,
      flyer_pdf_path: `${prefixe}/flyer-v${version}.pdf`,
      secondary_qr_svg_path: secondQr ? `${prefixe}/qr-avis-v${version}.svg` : null,
      secondary_qr_png_path: secondQr ? `${prefixe}/qr-avis-v${version}.png` : null
    };
    const televersements = [
      televerser(chemins.qr_svg_path, Buffer.from(svg), 'image/svg+xml'),
      televerser(chemins.qr_png_path, png, 'image/png'),
      televerser(chemins.flyer_pdf_path, flyer, 'application/pdf')
    ];
    if (secondQr) televersements.push(
      televerser(chemins.secondary_qr_svg_path, Buffer.from(svgAvis), 'image/svg+xml'),
      televerser(chemins.secondary_qr_png_path, pngAvis, 'image/png')
    );
    await Promise.all(televersements);
    const { data, error } = await supabase.from('restaurants').update({
      ...chemins, marketing_assets_status: 'ready', marketing_assets_version: version,
      marketing_assets_updated_at: new Date().toISOString(), marketing_assets_error: null
    }).eq('id', restaurant.id).select('*').single();
    if (error) throw error;
    return serialiserSupports({ ...data, _marketing_plan: restaurant._marketing_plan });
  } catch (erreur) {
    await supabase.from('restaurants').update({ marketing_assets_status: 'error', marketing_assets_error: String(erreur.message || erreur).slice(0, 500) }).eq('id', restaurant.id);
    throw erreur;
  }
}

module.exports = { BUCKET, assurerSupportsMarketing, creerFlyer, lienAvisRestaurant, lienPublicRestaurant, serialiserSupports };
