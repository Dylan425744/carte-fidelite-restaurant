const crypto = require('crypto');
const supabase = require('./supabaseClient');

const ALPHABET_CODE = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const REGLAGES_PAR_DEFAUT = Object.freeze({
  enabled: true,
  sponsor_points: 20,
  referee_points: 20
});

function estErreurPermission(erreur) {
  return erreur?.code === '42501' || /permission denied/i.test(erreur?.message || '');
}

function normaliserCode(code) {
  return String(code || '')
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '')
    .slice(0, 12);
}

function normaliserEmail(email) {
  return String(email || '').trim().toLowerCase();
}

function normaliserTelephone(telephone) {
  return String(telephone || '').replace(/\D/g, '');
}

function genererCode() {
  const octets = crypto.randomBytes(9);
  let code = 'BRV';

  for (let index = 0; index < 9; index += 1) {
    code += ALPHABET_CODE[octets[index] % ALPHABET_CODE.length];
  }

  return code;
}

function obtenirBasePublique() {
  return String(
    process.env.PUBLIC_BASE_URL ||
    process.env.RENDER_EXTERNAL_URL ||
    'https://carte-fidelite-restaurant.onrender.com'
  ).replace(/\/$/, '');
}

function construireLienParrainage(slug, code) {
  if (!slug || !code) return null;

  const parametres = new URLSearchParams({
    restaurant: String(slug),
    ref: normaliserCode(code)
  });

  return `${obtenirBasePublique()}/creer-carte.html?${parametres.toString()}`;
}

async function obtenirReglages(restaurantId) {
  const { data, error } = await supabase
    .from('referral_settings')
    .select('restaurant_id, enabled, sponsor_points, referee_points, updated_at')
    .eq('restaurant_id', restaurantId)
    .maybeSingle();

  if (error) throw error;
  return data || { restaurant_id: restaurantId, ...REGLAGES_PAR_DEFAUT };
}

async function enregistrerReglages(restaurantId, donnees) {
  const sponsorPoints = Number.parseInt(donnees.sponsor_points, 10);
  const refereePoints = Number.parseInt(donnees.referee_points, 10);

  if (!Number.isInteger(sponsorPoints) || sponsorPoints < 1 || sponsorPoints > 500) {
    throw new Error('Les points du parrain doivent être compris entre 1 et 500.');
  }

  if (!Number.isInteger(refereePoints) || refereePoints < 1 || refereePoints > 500) {
    throw new Error('Les points du filleul doivent être compris entre 1 et 500.');
  }

  const miseAJour = {
    restaurant_id: restaurantId,
    enabled: donnees.enabled !== false,
    sponsor_points: sponsorPoints,
    referee_points: refereePoints,
    updated_at: new Date().toISOString()
  };

  const { data, error } = await supabase
    .from('referral_settings')
    .upsert(miseAJour, { onConflict: 'restaurant_id' })
    .select('restaurant_id, enabled, sponsor_points, referee_points, updated_at')
    .single();

  if (error) throw error;
  return data;
}

async function assurerCodeClient(clientId, restaurantId) {
  const { data: existant, error: erreurLecture } = await supabase
    .from('referral_codes')
    .select('code')
    .eq('client_id', clientId)
    .maybeSingle();

  if (erreurLecture) throw erreurLecture;
  if (existant) return existant.code;

  for (let tentative = 0; tentative < 5; tentative += 1) {
    const code = genererCode();
    const { data, error } = await supabase
      .from('referral_codes')
      .insert({ client_id: clientId, restaurant_id: restaurantId, code })
      .select('code')
      .single();

    if (!error) return data.code;
    if (error.code !== '23505') throw error;
  }

  throw new Error('Impossible de générer un code de parrainage unique.');
}

async function obtenirInvitation(restaurantId, codeRecu) {
  const code = normaliserCode(codeRecu);
  if (!code) return null;

  const reglages = await obtenirReglages(restaurantId);
  if (!reglages.enabled) {
    throw new Error('Le programme de parrainage est momentanément désactivé.');
  }

  const { data, error } = await supabase
    .from('referral_codes')
    .select('code, client_id, clients!referral_codes_client_id_fkey(id, nom, email, telephone)')
    .eq('restaurant_id', restaurantId)
    .eq('code', code)
    .maybeSingle();

  if (error) throw error;
  if (!data?.clients) throw new Error('Ce code de parrainage est invalide.');

  return {
    code,
    sponsor: data.clients,
    sponsor_points: reglages.sponsor_points,
    referee_points: reglages.referee_points
  };
}

function verifierIdentiteDistincte(invitation, nouveauClient) {
  if (!invitation) return;

  const memeEmail = normaliserEmail(invitation.sponsor.email) ===
    normaliserEmail(nouveauClient.email);
  const telephoneParrain = normaliserTelephone(invitation.sponsor.telephone);
  const telephoneFilleul = normaliserTelephone(nouveauClient.telephone);
  const memeTelephone = telephoneParrain && telephoneFilleul &&
    telephoneParrain === telephoneFilleul;

  if (memeEmail || memeTelephone) {
    throw new Error('Le parrain et le filleul doivent être deux personnes différentes.');
  }
}

async function enregistrerInvitation(restaurantId, referredClientId, invitation) {
  if (!invitation) return null;

  const { data, error } = await supabase
    .from('referrals')
    .insert({
      restaurant_id: restaurantId,
      sponsor_client_id: invitation.sponsor.id,
      referred_client_id: referredClientId,
      referral_code: invitation.code,
      status: 'pending'
    })
    .select('id, status, created_at')
    .single();

  if (error) throw error;
  return data;
}

async function validerAuPremierScan(filleulId, scanId) {
  const { data, error } = await supabase.rpc('valider_parrainage_en_attente', {
    p_filleul_id: filleulId,
    p_scan_id: scanId
  });

  if (error) throw error;
  return Array.isArray(data) ? data[0] || null : data || null;
}

async function obtenirTableauParrainage(restaurantId) {
  let reglages;
  let codes;
  let parrainages;

  try {
    [reglages, codes, parrainages] = await Promise.all([
      obtenirReglages(restaurantId),
      supabase
        .from('referral_codes')
        .select('client_id', { count: 'exact', head: true })
        .eq('restaurant_id', restaurantId),
      supabase
        .from('referrals')
        .select(
          'id, status, referral_code, sponsor_points_awarded, referee_points_awarded, created_at, validated_at, parrain:clients!referrals_sponsor_client_id_fkey(id, nom), filleul:clients!referrals_referred_client_id_fkey(id, nom)'
        )
        .eq('restaurant_id', restaurantId)
        .order('created_at', { ascending: false })
        .limit(50)
    ]);
  } catch (erreur) {
    if (!estErreurPermission(erreur)) throw erreur;

    return {
      indisponible: true,
      reglages: { restaurant_id: restaurantId, ...REGLAGES_PAR_DEFAUT },
      statistiques: {
        codes_actifs: 0,
        en_attente: 0,
        valides: 0,
        clients_acquis: 0,
        points_distribues: 0
      },
      invitations: []
    };
  }

  if (codes.error) throw codes.error;
  if (parrainages.error) throw parrainages.error;

  const lignes = parrainages.data || [];
  const valides = lignes.filter(ligne => ligne.status === 'validated');

  return {
    reglages,
    statistiques: {
      codes_actifs: codes.count || 0,
      en_attente: lignes.filter(ligne => ligne.status === 'pending').length,
      valides: valides.length,
      clients_acquis: valides.length,
      points_distribues: valides.reduce(
        (total, ligne) => total + Number(ligne.sponsor_points_awarded || 0) +
          Number(ligne.referee_points_awarded || 0),
        0
      )
    },
    invitations: lignes.map(ligne => ({
      id: ligne.id,
      code: ligne.referral_code,
      statut: ligne.status,
      parrain: ligne.parrain?.nom || 'Client supprimé',
      filleul: ligne.filleul?.nom || 'Client supprimé',
      points_parrain: ligne.sponsor_points_awarded,
      points_filleul: ligne.referee_points_awarded,
      created_at: ligne.created_at,
      validated_at: ligne.validated_at
    }))
  };
}

module.exports = {
  assurerCodeClient,
  construireLienParrainage,
  enregistrerInvitation,
  enregistrerReglages,
  estErreurPermission,
  obtenirInvitation,
  obtenirReglages,
  obtenirTableauParrainage,
  validerAuPremierScan,
  verifierIdentiteDistincte
};
