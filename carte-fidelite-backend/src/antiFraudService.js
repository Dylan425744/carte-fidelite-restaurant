const supabase = require('./supabaseClient');

const REGLAGES_PAR_DEFAUT = Object.freeze({
  enabled: true,
  cooldown_minutes: 10,
  max_scans_per_day: 5,
  max_points_per_scan: 10,
  max_points_per_day: 50
});

const MESSAGES_BLOCAGE = Object.freeze({
  duplicate_scan: 'Cette carte vient déjà d’être scannée. Patientez avant de recommencer.',
  daily_scan_limit: 'La limite quotidienne de passages pour cette carte est atteinte.',
  points_per_scan_limit: 'Le nombre de points demandé dépasse la limite autorisée par scan.',
  daily_points_limit: 'La limite quotidienne de points pour cette carte est atteinte.'
});

function estErreurPermission(erreur) {
  const texte = `${erreur?.code || ''} ${erreur?.message || ''}`.toLowerCase();
  return texte.includes('permission denied') || texte.includes('42501');
}

function entierDansIntervalle(valeur, minimum, maximum, libelle) {
  const nombre = Number.parseInt(valeur, 10);
  if (!Number.isInteger(nombre) || nombre < minimum || nombre > maximum) {
    throw new Error(`${libelle} doit être compris entre ${minimum} et ${maximum}.`);
  }
  return nombre;
}

function serialiserReglages(reglages, pointsParScan = REGLAGES_PAR_DEFAUT.max_points_per_scan) {
  const minimumParScan = Math.max(1, Number(pointsParScan) || REGLAGES_PAR_DEFAUT.max_points_per_scan);
  return {
    enabled: reglages?.enabled !== false,
    cooldown_minutes: Number(reglages?.cooldown_minutes || REGLAGES_PAR_DEFAUT.cooldown_minutes),
    max_scans_per_day: Number(reglages?.max_scans_per_day || REGLAGES_PAR_DEFAUT.max_scans_per_day),
    max_points_per_scan: Math.max(
      Number(reglages?.max_points_per_scan || REGLAGES_PAR_DEFAUT.max_points_per_scan),
      minimumParScan
    ),
    max_points_per_day: Number(reglages?.max_points_per_day || REGLAGES_PAR_DEFAUT.max_points_per_day)
  };
}

async function obtenirReglages(restaurantId) {
  const [resultatReglages, resultatRestaurant] = await Promise.all([
    supabase
      .from('fraud_settings')
      .select('enabled, cooldown_minutes, max_scans_per_day, max_points_per_scan, max_points_per_day')
      .eq('restaurant_id', restaurantId)
      .maybeSingle(),
    supabase.from('restaurants').select('points_per_scan').eq('id', restaurantId).single()
  ]);
  if (resultatReglages.error) throw resultatReglages.error;
  if (resultatRestaurant.error) throw resultatRestaurant.error;
  return serialiserReglages(
    resultatReglages.data || REGLAGES_PAR_DEFAUT,
    resultatRestaurant.data?.points_per_scan
  );
}

async function enregistrerReglages(restaurantId, donnees) {
  const { data: restaurant, error: erreurRestaurant } = await supabase
    .from('restaurants')
    .select('points_per_scan')
    .eq('id', restaurantId)
    .single();
  if (erreurRestaurant) throw erreurRestaurant;
  const pointsParScan = Math.max(1, Number(restaurant.points_per_scan) || 10);
  const reglages = {
    restaurant_id: restaurantId,
    enabled: donnees.enabled !== false,
    cooldown_minutes: entierDansIntervalle(
      donnees.cooldown_minutes,
      1,
      1440,
      'Le délai entre deux scans'
    ),
    max_scans_per_day: entierDansIntervalle(
      donnees.max_scans_per_day,
      1,
      100,
      'La limite de scans quotidiens'
    ),
    max_points_per_scan: Math.max(pointsParScan, entierDansIntervalle(
      donnees.max_points_per_scan, 1, 500, 'La limite de points par scan'
    )),
    max_points_per_day: entierDansIntervalle(
      donnees.max_points_per_day,
      1,
      5000,
      'La limite de points quotidiens'
    ),
    updated_at: new Date().toISOString()
  };

  const { data, error } = await supabase
    .from('fraud_settings')
    .upsert(reglages, { onConflict: 'restaurant_id' })
    .select('enabled, cooldown_minutes, max_scans_per_day, max_points_per_scan, max_points_per_day')
    .single();

  if (error) throw error;
  return serialiserReglages(data, pointsParScan);
}

async function synchroniserAvecProgramme(restaurantId, pointsParScan) {
  const minimum = entierDansIntervalle(pointsParScan, 1, 100, 'Les points par passage');
  const { data: existant, error: erreurLecture } = await supabase
    .from('fraud_settings')
    .select('max_points_per_scan, max_points_per_day')
    .eq('restaurant_id', restaurantId)
    .maybeSingle();
  if (erreurLecture) throw erreurLecture;

  const miseAJour = {
    restaurant_id: restaurantId,
    max_points_per_scan: Math.max(Number(existant?.max_points_per_scan || 0), minimum),
    max_points_per_day: Math.max(Number(existant?.max_points_per_day || 0), minimum),
    updated_at: new Date().toISOString()
  };
  const { error } = await supabase.from('fraud_settings').upsert(miseAJour, {
    onConflict: 'restaurant_id'
  });
  if (error) throw error;
}

async function enregistrerScan(restaurantId, clientId, points) {
  const { data, error } = await supabase.rpc('enregistrer_scan_securise', {
    p_restaurant_id: restaurantId,
    p_client_id: clientId,
    p_points: points
  });

  if (error) throw error;
  const resultat = Array.isArray(data) ? data[0] : data;
  if (!resultat) throw new Error('Le contrôle anti-fraude n’a renvoyé aucun résultat.');

  return {
    autorise: Boolean(resultat.autorise),
    motif: resultat.motif || null,
    message: resultat.motif
      ? MESSAGES_BLOCAGE[resultat.motif] || 'Ce scan a été bloqué par la protection anti-fraude.'
      : null,
    scan_id: resultat.scan_id || null,
    nouveau_solde: Number(resultat.nouveau_solde || 0),
    prochaine_autorisation: resultat.prochaine_autorisation || null
  };
}

async function obtenirTableauAntiFraude(restaurantId) {
  const debutJour = new Date();
  debutJour.setHours(0, 0, 0, 0);
  const debutSemaine = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);

  const [reglages, alertes, bloqueesAujourdhui, alertesSemaine, critiques, scansProteges] =
    await Promise.all([
      obtenirReglages(restaurantId),
      supabase
        .from('fraud_alerts')
        .select('id, alert_type, severity, status, attempted_points, details, created_at, reviewed_at, clients(id, nom)')
        .eq('restaurant_id', restaurantId)
        .order('created_at', { ascending: false })
        .limit(50),
      supabase
        .from('fraud_alerts')
        .select('id', { count: 'exact', head: true })
        .eq('restaurant_id', restaurantId)
        .gte('created_at', debutJour.toISOString()),
      supabase
        .from('fraud_alerts')
        .select('id', { count: 'exact', head: true })
        .eq('restaurant_id', restaurantId)
        .gte('created_at', debutSemaine.toISOString()),
      supabase
        .from('fraud_alerts')
        .select('id', { count: 'exact', head: true })
        .eq('restaurant_id', restaurantId)
        .eq('severity', 'high')
        .eq('status', 'new'),
      supabase
        .from('scans')
        .select('id', { count: 'exact', head: true })
        .eq('restaurant_id', restaurantId)
    ]);

  const erreurs = [alertes, bloqueesAujourdhui, alertesSemaine, critiques, scansProteges]
    .map(resultat => resultat.error)
    .filter(Boolean);
  if (erreurs.length) throw erreurs[0];

  return {
    reglages,
    statistiques: {
      bloques_aujourdhui: Number(bloqueesAujourdhui.count || 0),
      alertes_7j: Number(alertesSemaine.count || 0),
      critiques_a_traiter: Number(critiques.count || 0),
      scans_proteges: Number(scansProteges.count || 0)
    },
    alertes: (alertes.data || []).map(alerte => ({
      id: alerte.id,
      type: alerte.alert_type,
      gravite: alerte.severity,
      statut: alerte.status,
      points_tentes: Number(alerte.attempted_points || 0),
      details: alerte.details || {},
      date: alerte.created_at,
      date_traitement: alerte.reviewed_at,
      client: alerte.clients?.nom || 'Client supprimé'
    }))
  };
}

async function traiterAlerte(restaurantId, alerteId, statut = 'reviewed') {
  if (!['reviewed', 'dismissed'].includes(statut)) {
    throw new Error('Le statut de traitement est invalide.');
  }

  const { data, error } = await supabase
    .from('fraud_alerts')
    .update({ status: statut, reviewed_at: new Date().toISOString() })
    .eq('id', alerteId)
    .eq('restaurant_id', restaurantId)
    .select('id, status, reviewed_at')
    .maybeSingle();

  if (error) throw error;
  if (!data) throw new Error('Alerte introuvable.');
  return data;
}

module.exports = {
  REGLAGES_PAR_DEFAUT,
  estErreurPermission,
  enregistrerReglages,
  enregistrerScan,
  synchroniserAvecProgramme,
  obtenirTableauAntiFraude,
  traiterAlerte
};
