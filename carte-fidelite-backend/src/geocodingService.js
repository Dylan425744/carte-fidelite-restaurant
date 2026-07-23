// Convertit une adresse texte en coordonnees GPS via Nominatim (OpenStreetMap).
// Choisi parce qu'il est gratuit et ne demande aucune cle API a configurer,
// contrairement a Google Geocoding : rien a mettre en place pour nous ni
// pour le restaurateur. Nominatim demande simplement de s'identifier via
// un User-Agent et de rester a un usage raisonnable, ce qui correspond
// exactement a ce cas (un calcul ponctuel a chaque changement d'adresse).

const NOMINATIM_URL = 'https://nominatim.openstreetmap.org/search';
const DELAI_MAX_REQUETE_MS = 8000;

async function geocoderAdresse(adresse) {
  const texte = String(adresse || '').trim();
  if (!texte) return null;

  const url = `${NOMINATIM_URL}?format=json&limit=1&q=${encodeURIComponent(texte)}`;
  const controleur = new AbortController();
  const minuteur = setTimeout(() => controleur.abort(), DELAI_MAX_REQUETE_MS);

  try {
    const reponse = await fetch(url, {
      headers: { 'User-Agent': 'Bravocard/1.0 (https://bravocard.fr)' },
      signal: controleur.signal
    });
    if (!reponse.ok) return null;

    const resultats = await reponse.json();
    const premier = Array.isArray(resultats) ? resultats[0] : null;
    if (!premier) return null;

    const latitude = Number(premier.lat);
    const longitude = Number(premier.lon);
    if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return null;

    return { latitude, longitude };
  } catch (erreur) {
    console.error('Géocodage impossible pour cette adresse:', erreur.message);
    return null;
  } finally {
    clearTimeout(minuteur);
  }
}

module.exports = { geocoderAdresse };
