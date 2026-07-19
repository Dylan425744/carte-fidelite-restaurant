const QRCode = require('qrcode');

function urlValide(url) {
  if (!url) return false;
  try {
    const analyse = new URL(url);
    return analyse.protocol === 'https:' || analyse.protocol === 'http:';
  } catch {
    return false;
  }
}

// Genere un QR code et renvoie son contenu SVG interne (viewBox + chemins), pret a
// etre imbrique dans un <svg> parent via qrIntegrable(). Le QR reste ainsi vectoriel
// dans le support final (PDF/PNG/SVG) et ne devient jamais flou a l'impression.
async function genererQr(url, { marge = 1, correction = 'Q' } = {}) {
  if (!urlValide(url)) {
    throw new Error('Impossible de générer un QR code : le lien est vide ou invalide.');
  }
  const svgComplet = await QRCode.toString(url, {
    type: 'svg',
    errorCorrectionLevel: correction,
    margin: marge,
    color: { dark: '#11111AFF', light: '#FFFFFFFF' }
  });
  const correspondance = svgComplet.match(/<svg[^>]*viewBox="([^"]+)"[^>]*>([\s\S]*)<\/svg>/i);
  if (!correspondance) {
    throw new Error('Le QR code généré est invalide.');
  }
  return { viewBox: correspondance[1], contenu: correspondance[2] };
}

// Place un QR deja genere dans un carre x/y/taille du support, en conservant ses
// proportions (un QR n'est jamais deforme).
function qrIntegrable(qr, x, y, taille) {
  return `<svg x="${x}" y="${y}" width="${taille}" height="${taille}" viewBox="${qr.viewBox}">${qr.contenu}</svg>`;
}

module.exports = { urlValide, genererQr, qrIntegrable };
