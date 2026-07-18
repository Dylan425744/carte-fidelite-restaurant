const crypto = require('crypto');
const QRCode = require('qrcode');
const PDFDocument = require('pdfkit');
const supabase = require('./supabaseClient');

const BUCKET = 'restaurant-marketing';
const VERSION_MISE_EN_PAGE = 2;

function urlPubliqueBase() {
  return String(process.env.MARKETING_PUBLIC_BASE_URL || 'https://bravocard.fr')
    .replace(/\/$/, '');
}

function lienPublicRestaurant(restaurant) {
  return `${urlPubliqueBase()}/r/${encodeURIComponent(restaurant.public_qr_token)}`;
}

function urlFichier(path) {
  if (!path) return null;
  return supabase.storage.from(BUCKET).getPublicUrl(path).data.publicUrl;
}

function serialiserSupports(restaurant) {
  return {
    statut: restaurant.marketing_assets_status || 'pending',
    lien_public: restaurant.public_qr_token ? lienPublicRestaurant(restaurant) : null,
    qr_svg_url: urlFichier(restaurant.qr_svg_path),
    qr_png_url: urlFichier(restaurant.qr_png_path),
    flyer_pdf_url: urlFichier(restaurant.flyer_pdf_path),
    version: Number(restaurant.marketing_assets_version || 1),
    actualise_le: restaurant.marketing_assets_updated_at || null,
    erreur: restaurant.marketing_assets_error || null
  };
}

async function assurerJeton(restaurant) {
  if (restaurant.public_qr_token) return restaurant;
  const token = crypto.randomBytes(18).toString('hex');
  const { data, error } = await supabase
    .from('restaurants')
    .update({ public_qr_token: token })
    .eq('id', restaurant.id)
    .select('*')
    .single();
  if (error) throw error;
  return data;
}

function creerFlyer(restaurant, qrPng, lien) {
  return new Promise((resolve, reject) => {
    const document = new PDFDocument({ size: 'A5', margin: 0, info: {
      Title: `Flyer fidélité ${restaurant.nom}`,
      Author: 'Bravocard'
    } });
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
      .text('VOTRE FIDÉLITÉ, DANS VOTRE TÉLÉPHONE', 32, 42, {
        width: largeur - 64,
        characterSpacing: 0.8
      });
    document.fillColor('#FFFFFF').fontSize(28).font('Helvetica-Bold')
      .text(restaurant.nom || 'Votre restaurant', 32, 78, { width: largeur - 64, align: 'left' });
    document.fillColor('#E8E5F2').fontSize(16).font('Helvetica')
      .text('Scannez. Ajoutez la carte. Cumulez vos avantages.', 32, 145, {
        width: largeur - 64,
        lineGap: 4
      });

    const tailleQr = 225;
    const xQr = (largeur - tailleQr) / 2;
    const yQr = 215;
    document.roundedRect(xQr - 15, yQr - 15, tailleQr + 30, tailleQr + 30, 18).fill('#FFFFFF');
    document.image(qrPng, xQr, yQr, { width: tailleQr, height: tailleQr });

    document.fillColor('#FFFFFF').fontSize(18).font('Helvetica-Bold')
      .text('Scannez pour créer votre carte', 32, yQr + tailleQr + 42, {
        width: largeur - 64,
        align: 'center'
      });
    document.fillColor('#B9B5C7').fontSize(9).font('Helvetica')
      .text('bravocard.fr · Carte de fidélité digitale', 45, yQr + tailleQr + 73, {
        width: largeur - 90,
        align: 'center'
      });
    document.fillColor('#BBAEFF').fontSize(11).font('Helvetica-Bold')
      .text('PROPULSÉ PAR BRAVOCARD', 32, hauteur - 45, {
        width: largeur - 64,
        align: 'center',
        characterSpacing: 1
      });
    document.end();
  });
}

async function televerser(path, contenu, contentType) {
  const { error } = await supabase.storage.from(BUCKET).upload(path, contenu, {
    contentType,
    upsert: true,
    cacheControl: '31536000'
  });
  if (error) throw error;
}

async function assurerSupportsMarketing(restaurantRecu, options = {}) {
  let restaurant = await assurerJeton(restaurantRecu);
  const versionActuelle = Number(restaurant.marketing_assets_version || 1);
  const complet = restaurant.marketing_assets_status === 'ready' &&
    versionActuelle >= VERSION_MISE_EN_PAGE &&
    restaurant.qr_svg_path && restaurant.qr_png_path && restaurant.flyer_pdf_path;
  if (complet && !options.force) return serialiserSupports(restaurant);

  const version = options.force
    ? Math.max(VERSION_MISE_EN_PAGE, versionActuelle + 1)
    : Math.max(VERSION_MISE_EN_PAGE, versionActuelle);
  await supabase.from('restaurants').update({
    marketing_assets_status: 'generating',
    marketing_assets_error: null
  }).eq('id', restaurant.id);

  try {
    const lien = lienPublicRestaurant(restaurant);
    const optionsQr = {
      errorCorrectionLevel: 'Q',
      margin: 4,
      color: { dark: '#11111AFF', light: '#FFFFFFFF' }
    };
    const [svg, png] = await Promise.all([
      QRCode.toString(lien, { ...optionsQr, type: 'svg' }),
      QRCode.toBuffer(lien, { ...optionsQr, type: 'png', width: 1200 })
    ]);
    const flyer = await creerFlyer(restaurant, png, lien);
    const prefixe = `${restaurant.id}`;
    const chemins = {
      qr_svg_path: `${prefixe}/qr-v${version}.svg`,
      qr_png_path: `${prefixe}/qr-v${version}.png`,
      flyer_pdf_path: `${prefixe}/flyer-v${version}.pdf`
    };
    await Promise.all([
      televerser(chemins.qr_svg_path, Buffer.from(svg), 'image/svg+xml'),
      televerser(chemins.qr_png_path, png, 'image/png'),
      televerser(chemins.flyer_pdf_path, flyer, 'application/pdf')
    ]);

    const { data, error } = await supabase.from('restaurants').update({
      ...chemins,
      marketing_assets_status: 'ready',
      marketing_assets_version: version,
      marketing_assets_updated_at: new Date().toISOString(),
      marketing_assets_error: null
    }).eq('id', restaurant.id).select('*').single();
    if (error) throw error;
    return serialiserSupports(data);
  } catch (erreur) {
    await supabase.from('restaurants').update({
      marketing_assets_status: 'error',
      marketing_assets_error: String(erreur.message || erreur).slice(0, 500)
    }).eq('id', restaurant.id);
    throw erreur;
  }
}

module.exports = {
  BUCKET,
  assurerSupportsMarketing,
  lienPublicRestaurant,
  serialiserSupports
};
