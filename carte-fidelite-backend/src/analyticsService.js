const supabase = require('./supabaseClient');

function normaliserPeriode(valeur) {
  const jours = Number.parseInt(valeur || 30, 10);
  if (!Number.isInteger(jours)) return 30;
  return Math.max(7, Math.min(jours, 365));
}

async function obtenirStatistiques(restaurantId, periode = 30) {
  const jours = normaliserPeriode(periode);
  const { data, error } = await supabase.rpc('obtenir_statistiques_restaurant', {
    p_restaurant_id: restaurantId,
    p_jours: jours
  });

  if (error) throw error;
  return data || {
    periode_jours: jours,
    indicateurs: {},
    evolution: [],
    jours_semaine: [],
    top_clients: [],
    wallets: {}
  };
}

module.exports = { normaliserPeriode, obtenirStatistiques };
