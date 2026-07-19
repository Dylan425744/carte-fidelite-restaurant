const PDFDocument = require('pdfkit');
const SVGtoPDF = require('svg-to-pdfkit');
const sharp = require('sharp');

const DPI_IMPRESSION = 300;

function mmVersPt(mm) {
  return (mm * 72) / 25.4;
}

// Sharp/librsvg appliquent un double facteur d'echelle quand le SVG declare une
// unite physique (mm/in) sur width/height : la densite sert a la fois a convertir
// l'unite ET a mettre a l'echelle le rendu, ce qui double l'effet. En declarant
// plutot une largeur/hauteur "equivalent px a 72dpi" (mm / 25.4 * 72) avec un
// viewBox en millimetres, un seul facteur d'echelle s'applique et le PNG obtenu
// fait exactement mm / 25.4 * dpi pixels (verifie empiriquement).
function mmVersPxReference72(mm) {
  return (mm * 72) / 25.4;
}

// Construit l'enveloppe <svg> racine autour d'un contenu deja positionne en
// unites millimetriques (viewBox = les dimensions reelles du support).
// pourRaster=true prepare le document pour sharp (voir mmVersPxReference72),
// sinon les dimensions restent en "mm" reels, correctes pour un export .svg
// ouvert tel quel dans un logiciel d'impression.
function envelopperSvg(contenuInterne, largeurMm, hauteurMm, { pourRaster = false } = {}) {
  const largeur = pourRaster ? mmVersPxReference72(largeurMm) : `${largeurMm}mm`;
  const hauteur = pourRaster ? mmVersPxReference72(hauteurMm) : `${hauteurMm}mm`;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${largeur}" height="${hauteur}" viewBox="0 0 ${largeurMm} ${hauteurMm}">${contenuInterne}</svg>`;
}

function versSvg(contenuInterne, largeurMm, hauteurMm) {
  return envelopperSvg(contenuInterne, largeurMm, hauteurMm, { pourRaster: false });
}

async function versPng(contenuInterne, largeurMm, hauteurMm, { dpi = DPI_IMPRESSION } = {}) {
  const svg = envelopperSvg(contenuInterne, largeurMm, hauteurMm, { pourRaster: true });
  return sharp(Buffer.from(svg), { density: dpi }).png().toBuffer();
}

function versPdf(contenuInterne, largeurMm, hauteurMm) {
  const svg = envelopperSvg(contenuInterne, largeurMm, hauteurMm, { pourRaster: false });
  const largeurPt = mmVersPt(largeurMm);
  const hauteurPt = mmVersPt(hauteurMm);
  return new Promise((resolve, reject) => {
    const document = new PDFDocument({ size: [largeurPt, hauteurPt], margin: 0 });
    const morceaux = [];
    document.on('data', morceau => morceaux.push(morceau));
    document.on('end', () => resolve(Buffer.concat(morceaux)));
    document.on('error', reject);
    SVGtoPDF(document, svg, 0, 0, { width: largeurPt, height: hauteurPt, assumePt: false });
    document.end();
  });
}

module.exports = { DPI_IMPRESSION, mmVersPt, versSvg, versPng, versPdf };
